import { invoke, listen } from "../ipc";
import {
  listOperations,
  operationResultsOrNull,
  type Operation,
  type OperationList,
  type OperationStateEvent,
} from "$lib/operations";
import {
  EMPTY_TALLY,
  addToTally,
  isFinishedRun,
  osNotice,
  outcomeOf,
  plainLine,
  shouldToast,
  targetName,
  veiledLine,
  type FinishedRunState,
  type RunOutcome,
  type VeiledTally,
} from "$lib/operation-notify";
import { windowTargetLookup } from "$lib/console/window-rows";
import { operationAlertGroup } from "$lib/dock-alert-groups";
import { listConsoleSessions } from "$lib/console/sessions";
import { notifyOs, windowFocused } from "$lib/app/os-notify";
import { messengerOperationResult } from "$lib/app/messenger";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { openPlansAt, plansShown } from "$lib/app/plans.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { toast, type ToastOpts } from "$lib/toast.svelte";
import { settings } from "$lib/settings.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **작업안 실행이 끝났다고 사람에게 알린다** — 앱 차원의 상주 모듈
 * (docs/log/2026-09-28-run-result-notify.md).
 *
 * 검토 카드에서 승인하고 하던 일로 돌아간 사람에게, 끝났다는 사실과 결과를 표면 셋에 뿌린다:
 *
 * | 표면 | 규칙 |
 * | --- | --- |
 * | 토스트 | 성공 3초 · 실패/일부 실패 6초 + [결과 보기] · 취소 3초 + [결과 보기]. 작업안(채팅 독 갈래 · 원격 덮개)이 보이면 건너뛴다 |
 * | 알림 센터 | **전부** 기록한다(성공까지). 줄을 누르면 그 실행으로 간다 |
 * | OS 알림 | 창이 앞에 없을 때만 · `[automation] notify_operation_results`(기본 켬) |
 *
 * 가림막 아래에서는 토스트와 OS 알림이 **개수만** 말한다(제목·호스트·단추 없음). 알림 센터에는
 * 전문을 적는다 — 센터를 여는 것은 가림막을 걷은 뒤다(센터는 가림막이 내려오면 스스로 닫힌다).
 *
 * 문구·판정은 순수 모듈 `$lib/operation-notify` 에 있다. 여기 있는 것은 이벤트·알린 집합·결과
 * 읽기·발사뿐이다.
 *
 * ## 규칙 셋 — 중복과 폭주를 막는다
 *
 * 1. **메인 창에서만** — `boot()` 이 `isMainWindow` 로 가른다(대기 카드 `app/pending-plans` 와 같은
 *    규칙). `operation-state` 는 모든 창에 방송되므로 분리 창까지 걸면 창 수만큼 운다.
 * 2. **작업안마다 한 번** — 알린 `operationId` 의 집합. 종료 상태 이벤트가 다시 와도(취소와 봉인이
 *    겹치는 등) 두 번 울리지 않는다. **이벤트만 듣는다** — 대시보드의 폴링·포커스 그물
 *    (`refreshOperations`)과 대기 카드의 30초 그물은 목록을 다시 읽을 뿐 이 모듈을 부르지 않으므로,
 *    그쪽이 끝난 작업안을 몇 번 다시 보든 알림은 늘지 않는다.
 * 3. **부팅·리로드 때 쏟아지지 않는다** — 시작할 때 이미 끝나 있던 작업안은 "알린 것" 으로 씨를
 *    뿌린다. 씨를 뿌리기 **전에** 온 이벤트는 모아 두었다가 씨 뒤에 거른다(그 사이 끝난 실행은
 *    씨에 들어 있으면 이미 끝난 것으로 치고, 아니면 알린다).
 *
 * 집합은 자라기만 한다 — 백엔드가 끝난 작업안을 100건까지만 들고 있으므로 이론상 작업안 수만큼
 * 자라지만, id 한 줄씩이고 앱이 한 번 켜진 동안의 실행 수라 문제가 되지 않는다.
 */

/** 알린(또는 부팅 때 이미 끝나 있던) 작업안 id */
const notified = new Set<string>();

/** 씨를 뿌렸는가 — 그 전에 온 이벤트는 `early` 에 모은다 */
let seeded = false;
let early: OperationStateEvent[] = [];

/** 두 번 걸리지 않게 하는 빗장 */
let started = false;

/**
 * 원격 창에서 도는가(R4 — `boot()` 이 원격 창에도 건다) — 메신저 보내기와 미전달 큐 꺼내기는 집 PC 주 창 몫이라 건너뛴다.
 * 토스트 · 알림 센터 · OS 알림(원격은 웹 알림)은 원격 기기의 사람에게 그대로.
 */
let remote = false;

/**
 * 가림막 아래에서 쌓는 개수 — **가림막 화면이 잠금 카드 밑에 그린다**(`Veil.svelte` · 2026-10-28 잠금 화면 통일 —
 * 예전에는 토스트 기둥에 개수 토스트를 따로 띄웠다). 가림막이 설 때 `resetVeiledTally()` 로 새로 센다.
 */
let tally = $state<VeiledTally>(EMPTY_TALLY);

/** 가림막이 서 있는 동안 끝난 실행 수 (결마다) — 가림막 화면이 읽는다 */
export function veiledTally(): VeiledTally {
  return tally;
}

/** 가림막이 새로 설 때 센 것을 비운다 (`Veil.svelte` 의 onMount) */
export function resetVeiledTally(): void {
  tally = EMPTY_TALLY;
}

/**
 * 대상 id → 사람이 읽는 이름. 이 창의 타일이 먼저(대기 카드·대시보드와 **같은 표**
 * `windowTargetLookup`), 모르는 대상이 있으면 앱 전역 세션 목록(다른 창 · 헤드리스)을 한 번 더
 * 읽는다. 둘 다 모르면 순수 모듈의 `targetName` 이 위임 별칭 · id 앞머리로 줄인다.
 */
async function labelsFor(targets: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const [id, v] of windowTargetLookup(t)) map.set(id, v.label);
  } catch {
    // 표를 못 만들어도 알림은 뜬다(이름이 id 앞머리로 떨어질 뿐)
  }
  if (targets.some((id) => !map.has(id))) {
    try {
      for (const s of await listConsoleSessions()) if (s.label && !map.has(s.id)) map.set(s.id, s.label);
    } catch {
      // 위와 같다
    }
  }
  return map;
}

/** 작업안 하나를 목록에서 찾는다 — 두 칸 다 본다(어느 칸에 담기는지에 기대지 않는다) */
function findOp(list: OperationList, id: string): Operation | null {
  return list.recent.find((o) => o.operationId === id) ?? list.pending.find((o) => o.operationId === id) ?? null;
}

/** 결과 보기 — 작업안의 그 실행으로 (토스트 단추 · 알림 센터 줄이 같은 곳) */
function openRun(id: string): void {
  openPlansAt(id);
}

/** 토스트 한 장 — 결에 맞는 갈래로 */
function pushToast(level: RunOutcome["level"], text: string, opts: ToastOpts): number {
  if (level === "success") return toast.success(text, opts);
  if (level === "error") return toast.error(text, opts);
  return toast.info(text, opts);
}

/** 끝난 실행 한 건을 표면 셋에 뿌린다 */
async function announce(operationId: string, state: FinishedRunState): Promise<void> {
  // 목록(제목·대상·승인 방식)과 대상별 결과를 함께 읽는다 — 둘 다 실패해도 알림은 뜬다.
  const [list, results] = await Promise.all([listOperations(), operationResultsOrNull(operationId)]);
  const op = findOp(list, operationId);
  const labels = await labelsFor(op?.targets ?? Object.keys(results ?? {}));
  const outcome = outcomeOf(state, op, results, (id) => labels.get(id) ?? null, t);
  const text = plainLine(outcome);

  // ① 알림 센터 — **언제나 전문으로**(가림막 아래여도: 센터는 가림막을 걷은 뒤에 연다).
  recordNotification({
    kind: "operation-finish",
    text,
    operationId,
    level: outcome.level,
    // 같은 대상(서버들)에 돈 실행끼리 독 알림 칸에서 한 장으로 묶인다 — 이름은 결과 문구와 같은 표(`labels`)에서
    group:
      operationAlertGroup(
        (op?.targets ?? Object.keys(results ?? {})).map((id) => targetName(id, (x) => labels.get(x) ?? null)),
        (first, rest) =>
          rest > 0 ? t("app.notify.group.op.many", { first, n: rest }) : t("app.notify.group.op.one", { first }),
      ) ?? undefined,
    run: {
      headline: outcome.headline,
      auto: outcome.auto,
      result: outcome.result,
      tone: outcome.tone,
      details: outcome.details,
    },
  });

  // ①½ 메신저 — `[messenger] operation_results`(③-4). 보낼지는 메신저 규칙(켬 · 자리 비움)이 정한다.
  // 원격 창(R4)은 보내지 않는다 — 집 PC 주 창이 이미 보낸다(두 번 울리지 않게).
  if (!remote) messengerOperationResult(outcome);

  const veiled = veilVisible();

  // 가림막 아래의 개수 — 가림막 화면이 잠금 카드 밑에 그린다(토스트는 띄우지 않는다).
  if (veiled) tally = addToTally(tally, outcome.level);

  // ② 토스트 — 작업안이 보이면 건너뛴다(결과가 이미 눈앞이다). **자동 승인된 실행은 늘 띄운다**(10-22 — 사람이 본 적이 없다).
  if (shouldToast({ operationsShown: plansShown(), veiled, auto: outcome.auto })) {
    if (!veiled) {
      const tail = [...outcome.details, ...(outcome.duration ? [outcome.duration] : [])].join(" · ");
      pushToast(outcome.level, text, {
        detail: {
          head: outcome.headline,
          // 모두 승인(10-23)이면 표식이 그 이름을 말한다 — 명령을 가리지 않고 넘어간 실행이다.
          chip: outcome.approveAll ? t("app.opnotify.all") : outcome.auto ? t("app.opnotify.auto") : null,
          chipTitle: outcome.approveAll ? t("app.opnotify.all.title") : t("app.opnotify.auto.title"),
          lead: outcome.result,
          tone: outcome.tone,
          tail,
        },
        // 성공에는 단추가 없다 — 따로 볼 이유가 적고 알림 센터에 남는다(목업).
        action:
          outcome.level === "success"
            ? undefined
            : { label: t("app.opnotify.open"), run: () => openRun(operationId) },
      });
    }
  }

  // ③ OS 알림 — 창이 앞에 없을 때만. 권한이 거절돼 있으면 아무 일도 없다(토스트·센터가 이미 있다).
  const notice = osNotice(
    outcome,
    {
      enabled: settings.current.automation.notify_operation_results,
      focused: windowFocused(),
      veiled,
    },
    // OS 알림은 한 건에 한 장이라 합친 수가 아니라 **이 건의** 개수다(`실패 1건`).
    veiled ? veiledLine(addToTally(EMPTY_TALLY, outcome.level), t).text : "",
    t,
  );
  if (notice !== null) void notifyOs(notice.title, notice.body);
}

/** 이벤트 한 건 — 종료 상태이고 처음 보는 작업안이면 알린다 */
function onState(ev: OperationStateEvent): void {
  if (!isFinishedRun(ev.state)) return;
  if (!seeded) {
    early.push(ev);
    return;
  }
  if (notified.has(ev.operationId)) return;
  // **먼저** 집합에 넣는다 — 결과를 읽는 사이 같은 이벤트가 다시 와도 두 번 울리지 않게.
  notified.add(ev.operationId);
  void announce(ev.operationId, ev.state);
}

/**
 * 훅을 건다 — **부팅에서 딱 한 번**, 메인 창에서만(`boot()` 이 `isMainWindow` 로 가른다).
 * 걷을 자리가 없다(메인 창이 닫히면 프로세스가 끝난다) — `startPendingPlans` 와 같은 모양이다.
 */
export function startOperationNotify(opts: { remote?: boolean } = {}): void {
  if (started) return;
  started = true;
  remote = opts.remote === true;
  // 이벤트부터 건다 — 씨를 뿌리는 사이에 끝난 실행을 흘리지 않게(그 사이 것은 `early` 에 모인다).
  void listen<OperationStateEvent>("operation-state", (e) => onState(e.payload));
  void (async () => {
    const list = await listOperations();
    for (const op of [...list.pending, ...list.recent]) {
      if (isFinishedRun(op.state)) notified.add(op.operationId);
    }
    seeded = true;
    const queued = early;
    early = [];
    for (const ev of queued) onState(ev);
    // 미전달 큐는 꺼내면 비워진다 — 집 PC 주 창의 몫(원격 창이 먼저 꺼내 가면 집 PC 가 못 본다).
    if (!remote) await announceUnseen();
  })();
}

/** 미전달 결과 한 건 — Rust `take_unseen_operation_results` */
interface UnseenRun {
  operationId: string;
  state: string;
  title: string | null;
  command: string;
  auto: boolean;
  finishedAt: number;
}

/**
 * **GUI 가 없던 동안 끝난 실행** — 세션 서버가 쥔 미전달 큐를 꺼내 한 줄로 알린다(③-4). 그동안은 OS 알림을 낼 GUI 가
 * 없었다(메신저는 서버가 이미 보냈다). 알림 센터에는 건마다 한 줄씩 남기고, 토스트는 수 하나만 — [결과 보기] 는 작업안
 * 타일로. 이미 끝나 있던 것으로 씨를 뿌렸으므로 같은 건이 이벤트로 다시 울리지 않는다.
 */
async function announceUnseen(): Promise<void> {
  let runs: UnseenRun[] = [];
  try {
    runs = (await invoke<UnseenRun[]>("take_unseen_operation_results")) ?? [];
  } catch {
    return;
  }
  if (!Array.isArray(runs) || runs.length === 0) return;
  for (const r of runs) {
    notified.add(r.operationId);
    const state = isFinishedRun(r.state as FinishedRunState) ? (r.state as FinishedRunState) : null;
    const level: RunOutcome["level"] = state === "succeeded" ? "success" : state === "cancelled" ? "info" : "error";
    const title = r.title?.trim() || t("app.opnotify.untitled");
    const word = state ? t(`app.opnotify.word.${state}`) : r.state;
    recordNotification({
      kind: "operation-finish",
      text: `${t("app.opnotify.title")} — ${title} · ${word}`,
      operationId: r.operationId,
      level,
    });
  }
  const latest = runs[runs.length - 1].operationId;
  toast.info(t("app.opnotify.whileAway", { n: runs.length }), {
    ms: 12000,
    action: { label: t("app.opnotify.open"), run: () => openRun(latest) },
  });
}
