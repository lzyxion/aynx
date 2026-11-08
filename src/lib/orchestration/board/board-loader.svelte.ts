// **오케스트레이션 보드의 조회 상태** — `RunBoard.svelte` 에서 그대로 옮긴 로더(2026-10-27 분할 5차).
// `RunBoard` 가 하나 만들고(`createBoardLoader` — 주소 · 보이는지 · 타일 id 는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: Run 목록 · 상세 · 읽는 중 · 없음 · 오류 · 아는 seq(**이벤트가 이보다 앞설 때만 다시 읽는다** — `changeAction`) ·
// 읽는 중에 온 사건의 한 번 더 읽기(`again`) · "보고 뒤 변경"(`drift` — 5초에 한 번까지) · 최근 활동(`activity` — 3초에 한 번까지 ·
// 미룬 것은 한 번 뒤에 · 작업자 상세가 열려 있으면 그 칸에 작업 중 파일 목록 — `detailAttempt`) · 변화 이벤트 · 진행 이벤트(F4 — seq 그대로 · 보던 Run 만)와 세션 서버 재연결 · 이벤트 놓침(F8 `events-lagged`)
// 구독(`subscribe` — 해제 함수를 돌려준다) · 그물(F8 `resyncIfDue` — 보일 때 30초에 한 번 목록의 seq 를 보고 앞설 때만 다시 읽는다 ·
// 타이머 없이 `RunBoard` 의 경과 시계에 얹힌다).
//
// **`$effect` 는 여기 없다** — 주소가 바뀔 때 다시 읽기 · 구독 · 사건 때/주기 확인 · 경과 시계 효과는 `RunBoard` 에 원래 자리 ·
// 순서 그대로 남아 이 로더의 메서드를 부른다. 보드당 조회 소유자는 이 로더 하나다(카드마다 구독하지 않는다).
// 공통 실행 `act`(busy · 실행 뒤 다시 읽기)와 확인 대상 고정(`confirm-pin`)은 `RunBoard` 에 있다.
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

/** `RunBoard` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface BoardLoaderHost {
  /** 보드 주소(`pane.run.runId`) — 없으면 목록 */
  readonly runId: string | null;
  /** 보드가 보이는가 */
  readonly visible: boolean;
  /** 이 보드 타일의 id — 머리줄 이름(화면용 사본)을 명세에 적을 때 쓴다(`noteRunBoard` — 프롭 객체를 직접 고치지 않는다) */
  readonly paneId: string;
  /** 작업자 상세가 연 Attempt(오케스트레이션 탭 ③) — 있으면 최근 활동이 그 칸에 작업 중 파일 목록(+/−)을 더 받는다 */
  readonly detailAttempt?: string | null;
}

/** 보드 조회 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createBoardLoader(h: BoardLoaderHost) {
  let detail = $state<RunDetail | null>(null);
  let list = $state<RunSummary[]>([]);
  let loading = $state(false);
  let missing = $state(false);
  let error = $state<string | null>(null);
  /** "보고 뒤 변경" 인 Attempt(4단계) — 보드가 보일 때만 가볍게 읽는다 */
  let drift = $state<Set<string>>(new Set());
  let driftAt = 0;
  let driftBusy = false;
  /** 최근 활동(6단계) — attemptId → 칸. 보드가 보일 때만 묻는다 */
  let activity = $state<Record<string, WorkerActivity>>({});
  let actAt = 0;
  let actBusy = false;
  let actLater: ReturnType<typeof setTimeout> | null = null;

  /** 마지막으로 읽은 판의 seq — 이벤트가 이보다 앞설 때만 다시 읽는다 */
  let knownSeq: number | null = null;
  /** 읽는 중에 온 사건 — 끝나면 한 번 더 읽는다(놓치지 않게) */
  let again = false;
  /** (F8) 마지막으로 서버에서 읽었거나 그물 확인을 한 시각 — 아직 없으면 `null` */
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
            // 머리줄 이름(화면용 사본) — 바뀔 때만 새 객체로(분할 복제가 같은 객체를 나눠 들지 않게 — `noteRunBoard`).
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

  /**
   * 목록 화면을 다시 읽는다(창 복귀 · 필터 · 느린 주기) — 줄의 남은 worktree 수는 앱 밖에서 지우면 사건 없이 낡는다(seq 그대로 · 그물 `resyncIfDue` 는
   * 산 앨범의 시계에만 얹힌다). 요약뿐이고 디스크는 끝난 앨범의 경로만 본다 · [`listRefreshDue`] 가 간격을 지킨다.
   */
  function refreshList(at: number = Date.now()): void {
    if (untrack(() => h.runId) !== null || loading || !listRefreshDue(untrack(() => h.visible), syncedAt, at)) return;
    void load();
  }

  /** 아는 seq 를 버린다 — 주소가 바뀌었을 때(다음 사건은 무엇이든 다시 읽는다) */
  function forgetSeq(): void {
    knownSeq = null;
  }

  /**
   * 변화 이벤트 · 세션 서버 재연결을 듣는다 — `RunBoard` 의 구독 `$effect`(보일 때만)가 부르고, 돌려준 함수가 그 효과의 정리다.
   */
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
    // F4 — 도는 턴의 진행 칸(seq 가 그대로인 사건 — 보던 Run 의 상세만 다시 읽는다 · 서버가 Attempt 마다 2초에 한 번까지로 줄인다).
    let offProgress: UnlistenFn | null = null;
    void listen<RunProgress>(RUN_PROGRESS_EVENT, (ev) => {
      if (progressAction(ev.payload, untrack(() => h.runId)) === "refetch") void load();
    })
      .then((fn) => (dead ? fn() : (offProgress = fn)))
      .catch(() => {});
    // 세션 서버가 바뀌었다(재시작 — 새 서버는 Run 을 orphaned 로 읽고 seq 축도 새로다) — 아는 seq 를 버리고 다시 읽는다.
    // 이 이벤트 없이는 판이 옛 서버의 "실행 중" 으로 멈춰 있다(7단계 실기).
    let offServer: UnlistenFn | null = null;
    void listen("session-server-connected", () => {
      knownSeq = null;
      void load();
    })
      .then((fn) => (dead ? fn() : (offServer = fn)))
      .catch(() => {});
    // F8 — 서버가 이 연결로 가는 이벤트를 밀려 버렸다(어느 것인지 모른다 · 진행 이벤트일 수도 있다) — seq 와 무관하게 한 번 다시 읽는다.
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

  /**
   * (F8) 그물 — 이벤트가 빠져도(밀림 신호까지 빠진 경우 포함) 보드가 옛 상태에 오래 머물지 않게. 보일 때 · 마지막 읽기/확인 뒤 30초가
   * 지났으면 목록(`orchestration_snapshot` — 요약뿐)에서 그 Run 의 seq 를 보고 **앞설 때만** 상세를 다시 읽는다. 목록 화면이면 그냥 다시 읽는다.
   * 타이머를 따로 두지 않는다 — `RunBoard` 의 경과 시계(산 Run 일 때 1초)가 부른다.
   */
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
      // 못 읽으면 다음 주기에 다시 본다.
    } finally {
      resyncBusy = false;
    }
  }

  /**
   * "보고 뒤 변경" 확인 — 보고가 있는 worktree 가 있을 때만 서버에 묻는다(git 몇 번 — 잠금 밖). `force` 가 아니면 5초에 한 번까지
   * (사건이 몰려도 폴링이 되지 않게).
   */
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
      // 못 읽으면 표시만 없다(보드의 다른 칸은 그대로).
    } finally {
      driftBusy = false;
    }
  }

  /**
   * 최근 활동(6단계) — 산 작업자가 있을 때만 서버에 묻는다(파일 끝 한 쪽 · git 몇 번 — 잠금 밖). `force` 가 아니면 3초에 한 번까지이고,
   * 그 사이에 온 요청은 **한 번만** 뒤로 미룬다(대화가 2초마다 자라도 폭주하지 않고, 마지막 변화는 놓치지 않게).
   */
  async function checkActivity(force = false): Promise<void> {
    const d = untrack(() => detail);
    const focus = untrack(() => h.detailAttempt ?? null);
    // 작업자 상세가 열려 있으면 산 작업자가 없어도 그 칸(작업 중 파일 목록)을 묻는다.
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
      // 못 읽으면 표시만 없다(보드의 다른 칸은 그대로).
    } finally {
      actBusy = false;
    }
  }

  /** 뒤로 미룬 활동 확인을 거둔다 — `RunBoard` 의 15초 주기 효과의 정리 */
  function cancelActivityLater(): void {
    if (actLater !== null) {
      clearTimeout(actLater);
      actLater = null;
    }
  }

  return {
    /** 주소의 Run 상세(목록이면 `null`) — [목록으로] 는 `null` 로 비운다 */
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
    /** 한 줄 오류 — 조회와 사람 동작(`act` · 패널 열기)이 함께 쓴다 */
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
