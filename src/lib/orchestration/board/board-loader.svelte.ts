// 오케스트레이션 보드의 조회 상태 — 보드당 조회 소유자는 이 로더 하나다(카드마다 구독하지 않는다).
// `$effect` 는 여기 두지 않는다 — 효과는 `RunBoard` 에 원래 순서대로 남아 이 로더의 메서드를 부른다.
import { untrack } from "svelte";
import { listen, type UnlistenFn } from "../../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  changeAction,
  driftedAttempts,
  listRefreshDue,
  orchReasonText,
  progressAction,
  resyncAction,
  resyncDue,
  wantsDrift,
  wantsActivity,
  type WorkerActivity,
  type RunChanged,
  type RunDetail,
  type RunProgress,
  type RunSummary,
} from "$lib/orchestration/model";
import { EVENTS_LAGGED_EVENT, RUN_CHANGED_EVENT, RUN_PROGRESS_EVENT, reportDrift, runDetail, runSnapshot, workerActivity } from "$lib/orchestration/api";
import { noteRunBoard } from "$lib/app/orchestration.svelte.js";

/** 게터라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface BoardLoaderHost {
  readonly runId: string | null;
  readonly visible: boolean;
  /** `noteRunBoard` 용 — 프롭 객체를 직접 고치지 않는다 */
  readonly paneId: string;
  readonly detailAttempt?: string | null;
}

export function createBoardLoader(h: BoardLoaderHost) {
  let detail = $state<RunDetail | null>(null);
  let list = $state<RunSummary[]>([]);
  let loading = $state(false);
  let missing = $state(false);
  let error = $state<string | null>(null);
  let drift = $state<Set<string>>(new Set());
  let driftAt = 0;
  let driftBusy = false;
  let activity = $state<Record<string, WorkerActivity>>({});
  let actAt = 0;
  let actBusy = false;
  let actLater: ReturnType<typeof setTimeout> | null = null;

  let knownSeq: number | null = null;
  let again = false;
  let syncedAt: number | null = null;
  let resyncBusy = false;

  async function load(): Promise<void> {
    if (loading) {
      again = true;
      return;
    }
    loading = true;
    try {
      do {
        again = false;
        const id = untrack(() => h.runId);
        if (id === null) {
          list = await runSnapshot();
          detail = null;
          missing = false;
          syncedAt = Date.now();
        } else {
          try {
            const d = await runDetail(id);
            if (untrack(() => h.runId) !== id) continue;
            detail = d;
            missing = false;
            knownSeq = d.latestSeq;
            syncedAt = Date.now();
            noteRunBoard(h.paneId, { runId: id, name: d.name });
          } catch (e) {
            if (/\[not-found\]/.test(String(e))) {
              detail = null;
              missing = true;
            } else {
              error = orchReasonText(String(e), t);
            }
          }
        }
      } while (again);
    } catch (e) {
      error = orchReasonText(String(e), t);
    } finally {
      loading = false;
    }
  }

  /** 줄의 남은 worktree 수는 앱 밖에서 지우면 사건 없이 낡는다(seq 그대로) — 그래서 목록은 따로 다시 읽는다 */
  function refreshList(at: number = Date.now()): void {
    if (untrack(() => h.runId) !== null || loading || !listRefreshDue(untrack(() => h.visible), syncedAt, at)) return;
    void load();
  }

  function forgetSeq(): void {
    knownSeq = null;
  }

  function subscribe(): () => void {
    let off: UnlistenFn | null = null;
    let dead = false;
    void listen<RunChanged>(RUN_CHANGED_EVENT, (ev) => {
      const act = changeAction(ev.payload, untrack(() => h.runId), knownSeq);
      if (act === "refetch") void load();
      else if (act === "closed") {
        detail = null;
        missing = true;
      }
    })
      .then((fn) => (dead ? fn() : (off = fn)))
      .catch(() => {});
    let offProgress: UnlistenFn | null = null;
    void listen<RunProgress>(RUN_PROGRESS_EVENT, (ev) => {
      if (progressAction(ev.payload, untrack(() => h.runId)) === "refetch") void load();
    })
      .then((fn) => (dead ? fn() : (offProgress = fn)))
      .catch(() => {});
    // 새 서버는 seq 축이 새로다 — 아는 seq 를 버리지 않으면 판이 옛 서버의 "실행 중" 으로 멈춘다.
    let offServer: UnlistenFn | null = null;
    void listen("session-server-connected", () => {
      knownSeq = null;
      void load();
    })
      .then((fn) => (dead ? fn() : (offServer = fn)))
      .catch(() => {});
    let offLagged: UnlistenFn | null = null;
    void listen(EVENTS_LAGGED_EVENT, () => void load())
      .then((fn) => (dead ? fn() : (offLagged = fn)))
      .catch(() => {});
    return () => {
      dead = true;
      off?.();
      offProgress?.();
      offServer?.();
      offLagged?.();
    };
  }

  /** 밀림 신호까지 빠진 경우의 그물 — 타이머를 따로 두지 않고 `RunBoard` 의 경과 시계가 부른다 */
  async function resyncIfDue(at: number): Promise<void> {
    if (loading || resyncBusy || !resyncDue(untrack(() => h.visible), syncedAt, at)) return;
    syncedAt = at;
    const id = untrack(() => h.runId);
    if (id === null) {
      void load();
      return;
    }
    resyncBusy = true;
    try {
      const all = await runSnapshot();
      if (untrack(() => h.runId) === id && resyncAction(all, id, knownSeq) === "refetch") void load();
    } catch {
    } finally {
      resyncBusy = false;
    }
  }

  async function checkDrift(force = false): Promise<void> {
    const d = untrack(() => detail);
    if (!d || !wantsDrift(d) || driftBusy) return;
    const at = Date.now();
    if (!force && at - driftAt < 5000) return;
    driftBusy = true;
    driftAt = at;
    try {
      drift = driftedAttempts(await reportDrift(d.runId));
    } catch {
    } finally {
      driftBusy = false;
    }
  }

  /** 간격 안에 온 요청은 한 번만 뒤로 미룬다 — 폭주하지 않고 마지막 변화는 놓치지 않게 */
  async function checkActivity(force = false): Promise<void> {
    const d = untrack(() => detail);
    const focus = untrack(() => h.detailAttempt ?? null);
    if (!d || (!wantsActivity(d) && !focus) || !untrack(() => h.visible)) return;
    const at = Date.now();
    if (actBusy || (!force && at - actAt < 3000)) {
      if (actLater === null) {
        actLater = setTimeout(() => {
          actLater = null;
          void checkActivity();
        }, Math.max(500, 3000 - (at - actAt)));
      }
      return;
    }
    actBusy = true;
    actAt = at;
    try {
      activity = await workerActivity(d.runId, focus);
    } catch {
    } finally {
      actBusy = false;
    }
  }

  function cancelActivityLater(): void {
    if (actLater !== null) {
      clearTimeout(actLater);
      actLater = null;
    }
  }

  return {
    get detail() {
      return detail;
    },
    set detail(v: RunDetail | null) {
      detail = v;
    },
    get list() {
      return list;
    },
    get loading() {
      return loading;
    },
    get missing() {
      return missing;
    },
    get error() {
      return error;
    },
    set error(v: string | null) {
      error = v;
    },
    get drift() {
      return drift;
    },
    get activity() {
      return activity;
    },
    load,
    forgetSeq,
    refreshList,
    subscribe,
    checkDrift,
    checkActivity,
    cancelActivityLater,
    resyncIfDue,
  };
}

export type BoardLoader = ReturnType<typeof createBoardLoader>;
