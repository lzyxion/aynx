/**
 * 작업안 실행이 끝났을 때 토스트 · 알림 센터 · OS 알림이 함께 쓰는 문구 토막 — 셋이 같은 글자로 말해야 한다.
 * 문구는 `tr` 로 받는다 — 룬 모듈인 사전을 들여오면 vitest 가 이 파일을 못 읽는다.
 */

import { formatDuration, type Tr } from "$lib/finish-notify";
import type { Operation, OperationState, TargetResult } from "$lib/operations";
import { headlineOf } from "$lib/review-card";

/** 실행을 거친 종료만 — 거절 · 만료는 범위 밖이다 */
export type FinishedRunState = "succeeded" | "partial" | "failed" | "cancelled";

const FINISHED: ReadonlySet<string> = new Set(["succeeded", "partial", "failed", "cancelled"]);

export function isFinishedRun(state: OperationState | string): state is FinishedRunState {
  return FINISHED.has(state);
}

/** 토스트의 `ToastKind` · 알림 센터의 `NotificationLevel` 과 같은 세 값 */
export type RunLevel = "success" | "error" | "info";

export type RunTone = "good" | "bad" | "plain";

export interface RunOutcome {
  level: RunLevel;
  /** 검토 요청 때와 같은 [`headlineOf`] — 명령문 전문은 싣지 않는다 */
  headline: string;
  auto: boolean;
  approveAll: boolean;
  result: string;
  tone: RunTone;
  details: string[];
  duration: string | null;
  resultsKnown: boolean;
}

export type LabelOf = (targetId: string) => string | null | undefined;

export const MAX_FAILED_NAMES = 2;

const SHORT_ID = 8;

export function targetName(targetId: string, labelOf: LabelOf): string {
  const known = labelOf(targetId)?.trim();
  if (known) return known;
  if (targetId.startsWith("delegated:")) {
    const alias = targetId.slice("delegated:".length).trim();
    if (alias) return alias;
  }
  return targetId.length > SHORT_ID ? targetId.slice(0, SHORT_ID) : targetId;
}

function isFailedTarget(r: TargetResult | undefined): boolean {
  return r !== undefined && (r.state === "failed" || r.state === "timedOut" || r.state === "unknown");
}

export function failedNamesLine(names: readonly string[], tr: Tr): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_FAILED_NAMES).join(", ");
  const more = names.length - MAX_FAILED_NAMES;
  const list = more > 0 ? tr("app.opnotify.failedMore", { names: shown, n: more }) : shown;
  return tr("app.opnotify.failedNames", { names: list });
}

export function runDurationMs(results: Readonly<Record<string, TargetResult>>): number | null {
  let start = Infinity;
  let end = -Infinity;
  for (const r of Object.values(results)) {
    if (typeof r.startedAt === "number" && Number.isFinite(r.startedAt)) start = Math.min(start, r.startedAt);
    if (typeof r.endedAt === "number" && Number.isFinite(r.endedAt)) end = Math.max(end, r.endedAt);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

/**
 * 백엔드가 canary 실패 때 나머지를 시작 시각 없는 `Cancelled` 로 채우는 모양으로 읽는다(`operations/executor.rs`).
 * canary 가 `unknown` 으로 끝나면 집계가 `partial` 이라 그것도 받는다.
 */
export function isCanaryStop(op: Pick<Operation, "targets">, results: Readonly<Record<string, TargetResult>>): boolean {
  if (op.targets.length < 2) return false;
  const [first, ...rest] = op.targets;
  if (!isFailedTarget(results[first])) return false;
  return rest.every((id) => {
    const r = results[id];
    return r !== undefined && r.state === "cancelled" && r.startedAt == null;
  });
}

/**
 * canary 는 성공했는데 `validate` 가 막은 판 — 백엔드가 따로 표시하지 않아 모양으로 읽는다(사유 문장으로 가르지 않는다).
 * `validate` 가 없으면 같은 모양이 사람의 시작 전 취소이므로 이 갈래로 읽지 않는다.
 */
export function isValidateStop(
  op: Pick<Operation, "targets" | "validate">,
  results: Readonly<Record<string, TargetResult>>,
): boolean {
  if (op.validate == null || op.validate.trim() === "") return false;
  if (op.targets.length < 2) return false;
  const [first, ...rest] = op.targets;
  if (results[first]?.state !== "succeeded") return false;
  return rest.every((id) => {
    const r = results[id];
    return r !== undefined && r.state === "cancelled" && r.startedAt == null;
  });
}

const LEVEL: Record<FinishedRunState, RunLevel> = {
  succeeded: "success",
  partial: "error",
  failed: "error",
  cancelled: "info",
};

/** 감사 로그에서 되살린 실행(`run-history.ts` 의 `runPlan`)도 이 모양이라 기록 보기가 결과 알림과 같은 글자로 말한다 */
export type RunPlan = Pick<
  Operation,
  "title" | "command" | "targets" | "validate" | "approvalMethod" | "approveAll" | "cancelledByUser"
>;

const TONE: Record<FinishedRunState, RunTone> = {
  succeeded: "good",
  partial: "bad",
  failed: "bad",
  cancelled: "plain",
};

/** `state` 는 이벤트가 실어 온 종료 상태(권위)다 — 결과를 못 읽어도 알림은 떠야 한다 */
export function outcomeOf(
  state: FinishedRunState,
  op: RunPlan | null,
  results: Readonly<Record<string, TargetResult>> | null,
  labelOf: LabelOf,
  tr: Tr,
): RunOutcome {
  const headline = op ? headlineOf(op) || tr("app.opnotify.untitled") : tr("app.opnotify.untitled");
  const base = {
    level: LEVEL[state],
    tone: TONE[state],
    headline,
    auto: op?.approvalMethod === "auto",
    approveAll: op?.approvalMethod === "auto" && op?.approveAll === true,
  };

  const targets = op?.targets.length ? op.targets : Object.keys(results ?? {});
  const known = results !== null && targets.length > 0 && targets.some((id) => results[id] !== undefined);
  if (!known || results === null) {
    return {
      ...base,
      result: tr(`app.opnotify.word.${state}`),
      details: [tr("app.opnotify.unavailable")],
      duration: null,
      resultsKnown: false,
    };
  }

  const ms = runDurationMs(results);
  const duration = ms === null ? null : formatDuration(ms, tr);
  const n = targets.length;
  const ok = targets.filter((id) => results[id]?.state === "succeeded").length;

  // 사람의 취소를 먼저 본다 — 모양으로 짐작하면 검증 통과 직후의 취소가 검증 실패로 읽힌다.
  if (op?.cancelledByUser) {
    const hardFailed = targets
      .filter((id) => results[id]?.state === "failed" || results[id]?.state === "timedOut")
      .map((id) => targetName(id, labelOf));
    const names = failedNamesLine(hardFailed, tr);
    return {
      ...base,
      level: "info",
      tone: "plain",
      result: tr("app.opnotify.cancelled"),
      details: [...(ok > 0 ? [tr("app.opnotify.cancelledAfter", { ok, n })] : []), ...(names ? [names] : [])],
      duration: null,
      resultsKnown: true,
    };
  }

  if ((state === "failed" || state === "partial") && op && isCanaryStop(op, results)) {
    const first = op.targets[0];
    const r = results[first];
    const name = targetName(first, labelOf);
    const why =
      r.exitCode !== null && r.exitCode !== undefined
        ? tr("app.opnotify.canaryExit", { name, code: r.exitCode })
        : r.state === "timedOut"
          ? tr("app.opnotify.canaryTimeout", { name })
          : name;
    return {
      ...base,
      level: "error",
      tone: "bad",
      result: tr("app.opnotify.canary"),
      details: [why, tr("app.opnotify.canaryRest", { n: n - 1 })],
      duration: null,
      resultsKnown: true,
    };
  }

  if (state === "partial" && op && isValidateStop(op, results)) {
    return {
      ...base,
      level: "error",
      tone: "bad",
      result: tr("app.opnotify.validate"),
      details: [targetName(op.targets[0], labelOf), tr("app.opnotify.canaryRest", { n: n - 1 })],
      duration: null,
      resultsKnown: true,
    };
  }

  if (state === "cancelled") {
    return {
      ...base,
      result: tr("app.opnotify.cancelled"),
      details: ok > 0 ? [tr("app.opnotify.cancelledAfter", { ok, n })] : [],
      duration: null,
      resultsKnown: true,
    };
  }

  const failed = targets.filter((id) => isFailedTarget(results[id])).map((id) => targetName(id, labelOf));
  const names = state === "succeeded" ? null : failedNamesLine(failed, tr);
  return {
    ...base,
    result: tr(`app.opnotify.${state}`, { ok, n }),
    details: names === null ? [] : [names],
    duration,
    resultsKnown: true,
  };
}

export function subLine(o: RunOutcome): string {
  return [o.result, ...o.details, ...(o.duration ? [o.duration] : [])].join(" · ");
}

export function plainLine(o: RunOutcome): string {
  return `${o.headline} — ${subLine(o)}`;
}

// ── 가림막 아래 — 개수만 ──

export interface VeiledTally {
  success: number;
  error: number;
  info: number;
}

export const EMPTY_TALLY: VeiledTally = { success: 0, error: 0, info: 0 };

export function addToTally(t: VeiledTally, level: RunLevel): VeiledTally {
  return { ...t, [level]: t[level] + 1 };
}

/** 제목 · 호스트를 싣지 않는다 — 토스트 기둥(120)이 가림막(115)보다 위라 자리를 비운 사이 보이는 글자다 */
export function veiledLine(t: VeiledTally, tr: Tr): { level: RunLevel; text: string } {
  const parts: string[] = [];
  if (t.error > 0) parts.push(tr("app.opnotify.veiled.error", { n: t.error }));
  if (t.info > 0) parts.push(tr("app.opnotify.veiled.info", { n: t.info }));
  if (t.success > 0) parts.push(tr("app.opnotify.veiled.success", { n: t.success }));
  const level: RunLevel = t.error > 0 ? "error" : t.info > 0 ? "info" : "success";
  return { level, text: parts.join(" · ") };
}

// ── 어디에 띄우나 ──

export interface ToastFacts {
  operationsShown: boolean;
  veiled: boolean;
  /** 자동 승인된 실행은 작업안 칸이 보여도 띄운다 — 사람이 한 번도 못 봤고 이 토스트가 유일한 흔적이다 */
  auto?: boolean;
}

export function shouldToast(f: ToastFacts): boolean {
  return f.veiled || f.auto === true || !f.operationsShown;
}

export interface OsFacts {
  /** `[automation] notify_operation_results` */
  enabled: boolean;
  focused: boolean;
  veiled: boolean;
}

/** OS 알림 센터는 이력으로 쌓이므로 명령문 전문 · 실패 호스트 목록을 싣지 않는다 */
export function osNotice(
  o: RunOutcome,
  f: OsFacts,
  veiledText: string,
  tr: Tr,
): { title: string; body: string } | null {
  if (!f.enabled || f.focused) return null;
  const title = tr("app.opnotify.title");
  if (f.veiled) return { title, body: veiledText };
  return { title, body: `${o.headline} — ${o.result}` };
}
