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
 * 가림막 아래에서는 토스트와 OS 알림이 개수만 말한다(제목 · 호스트 · 단추 없음). 알림 센터에는 전문을 적는다 — 센터는 가림막을 걷은 뒤에 연다.
 * 분리 창에는 걸지 않는다 — `operation-state` 는 모든 창에 방송되어 창 수만큼 운다.
 * 부팅 때 이미 끝나 있던 작업안은 "알린 것" 으로 씨를 뿌린다 — 리로드마다 쏟아지지 않게.
 */

const notified = new Set<string>();

let seeded = false;
let early: OperationStateEvent[] = [];

let started = false;

/** 메신저 보내기와 미전달 큐 꺼내기는 메인 PC 주 창 몫이라 원격 창은 건너뛴다 */
let remote = false;

let tally = $state<VeiledTally>(EMPTY_TALLY);

export function veiledTally(): VeiledTally {
  return tally;
}

export function resetVeiledTally(): void {
  tally = EMPTY_TALLY;
}

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

function findOp(list: OperationList, id: string): Operation | null {
  return list.recent.find((o) => o.operationId === id) ?? list.pending.find((o) => o.operationId === id) ?? null;
}

function openRun(id: string): void {
  openPlansAt(id);
}

function pushToast(level: RunOutcome["level"], text: string, opts: ToastOpts): number {
  if (level === "success") return toast.success(text, opts);
  if (level === "error") return toast.error(text, opts);
  return toast.info(text, opts);
}

async function announce(operationId: string, state: FinishedRunState): Promise<void> {
  const [list, results] = await Promise.all([listOperations(), operationResultsOrNull(operationId)]);
  const op = findOp(list, operationId);
  const labels = await labelsFor(op?.targets ?? Object.keys(results ?? {}));
  const outcome = outcomeOf(state, op, results, (id) => labels.get(id) ?? null, t);
  const text = plainLine(outcome);

  recordNotification({
    kind: "operation-finish",
    text,
    operationId,
    level: outcome.level,
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

  // 원격 창은 보내지 않는다 — 메인 PC 주 창이 이미 보낸다.
  if (!remote) messengerOperationResult(outcome);

  const veiled = veilVisible();

  if (veiled) tally = addToTally(tally, outcome.level);

  // 토스트는 작업안이 보이면 건너뛴다. 자동 승인된 실행은 늘 띄운다(사람이 본 적이 없다).
  if (shouldToast({ operationsShown: plansShown(), veiled, auto: outcome.auto })) {
    if (!veiled) {
      const tail = [...outcome.details, ...(outcome.duration ? [outcome.duration] : [])].join(" · ");
      pushToast(outcome.level, text, {
        detail: {
          head: outcome.headline,
          chip: outcome.approveAll ? t("app.opnotify.all") : outcome.auto ? t("app.opnotify.auto") : null,
          chipTitle: outcome.approveAll ? t("app.opnotify.all.title") : t("app.opnotify.auto.title"),
          lead: outcome.result,
          tone: outcome.tone,
          tail,
        },
        action:
          outcome.level === "success"
            ? undefined
            : { label: t("app.opnotify.open"), run: () => openRun(operationId) },
      });
    }
  }

  const notice = osNotice(
    outcome,
    {
      enabled: settings.current.automation.notify_operation_results,
      focused: windowFocused(),
      veiled,
    },
    // 합친 수가 아니라 이 건의 개수다.
    veiled ? veiledLine(addToTally(EMPTY_TALLY, outcome.level), t).text : "",
    t,
  );
  if (notice !== null) void notifyOs(notice.title, notice.body);
}

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
    // 미전달 큐는 꺼내면 비워진다 — 메인 PC 주 창의 몫(원격 창이 먼저 꺼내 가면 메인 PC 가 못 본다).
    if (!remote) await announceUnseen();
  })();
}

/** Rust `take_unseen_operation_results` 의 한 건 */
interface UnseenRun {
  operationId: string;
  state: string;
  title: string | null;
  command: string;
  auto: boolean;
  finishedAt: number;
}

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
