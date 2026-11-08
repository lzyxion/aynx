/**
 * **작업안 실행이 끝났다고 사람에게 무엇을 말할까** — 순수 모듈
 * (docs/log/2026-09-28-run-result-notify.md).
 *
 * 검토 카드에서 승인하고 하던 일로 돌아간 사람에게 "끝났고 결과가 이렇다" 를 알리는 표면이
 * 셋이다 — 토스트 · 알림 센터 · OS 알림. 셋이 **같은 사실을 같은 글자로** 말해야 하므로 토막을
 * 만드는 자리가 여기 하나다(`finish-notify.ts` 가 명령 끝 알림에서 같은 이유로 한 자리에 모은 것과
 * 같은 결).
 *
 * - 첫 줄은 대기 카드·검토 요청 OS 알림과 **같은 함수** [`headlineOf`] 다 — 검토를 요청받을 때 본
 *   글자와 결과로 돌아오는 글자가 같아야 "그게 이거구나" 를 눈으로 맞춘다.
 * - 둘째 줄은 **결과 한 토막**(색을 입는 `result`)과 곁 토막들(`details` · `duration`)이다.
 * - 가림막 아래에서는 **개수만** 말한다([`veiledLine`]) — 제목·호스트 이름·단추가 없다.
 *
 * 룬도 DOM 도 Tauri 도 없다 — 값을 받아 값을 준다. 이벤트·알린 집합·결과 읽기·발사는
 * `app/operation-notify.svelte.ts` 가 한다. 문구는 `tr` 로 들어온다(`finish-notify.ts` 머리말 —
 * 룬 모듈인 사전을 들여오면 vitest 가 이 파일을 못 읽는다).
 */

import { formatDuration, type Tr } from "$lib/finish-notify";
import type { Operation, OperationState, TargetResult } from "$lib/operations";
import { headlineOf } from "$lib/review-card";

/** 알림이 뜨는 종료 상태 — **실행을 거친 것만**. 거절·만료는 실행된 적이 없어 범위 밖이다. */
export type FinishedRunState = "succeeded" | "partial" | "failed" | "cancelled";

const FINISHED: ReadonlySet<string> = new Set(["succeeded", "partial", "failed", "cancelled"]);

/** 이 상태가 실행 결과 알림의 대상인가 (`rejected`·`expired`·진행 중은 아니다) */
export function isFinishedRun(state: OperationState | string): state is FinishedRunState {
  return FINISHED.has(state);
}

/** 결 — 토스트의 `ToastKind` · 알림 센터의 `NotificationLevel` 과 같은 세 값 */
export type RunLevel = "success" | "error" | "info";

/** 결과 토막의 색 — `good`(초록) · `bad`(오류색) · `plain`(무채 — 취소는 사람이 멈춘 것이다) */
export type RunTone = "good" | "bad" | "plain";

/** 끝난 실행 한 건을 사람에게 말할 토막들 */
export interface RunOutcome {
  level: RunLevel;
  /** 첫 줄 — [`headlineOf`]. 명령문 전문은 절대 아니다. */
  headline: string;
  /** 자동 승인으로 돈 실행인가 (`자동` 표식) */
  auto: boolean;
  /** 그 자동 승인이 '모두 승인'(대상이 전부 모두 승인 — 명령을 가리지 않음)이었나 (`모두 승인` 표식 · 2026-10-23) */
  approveAll: boolean;
  /** 둘째 줄의 머리 — 색을 입는 결과 토막 (`성공 3/3` · `canary 실패로 멈춤` …) */
  result: string;
  tone: RunTone;
  /** 결과 뒤에 붙는 곁 토막들 (`실패: web-02` · `나머지 2곳은 실행 안 함` …) — 시간은 따로 */
  details: string[];
  /** 걸린 시간 (`12.4초`) — 대상 결과의 시각에서 못 구하면 `null` */
  duration: string | null;
  /** 대상별 결과를 읽었는가 — `false` 면 상태만 말하는 물러선 문구다 */
  resultsKnown: boolean;
}

/** 대상 id → 사람이 읽는 이름. 모르면 `null`(그러면 [`targetName`] 이 스스로 줄인다). */
export type LabelOf = (targetId: string) => string | null | undefined;

/** 실패한 대상의 이름은 **둘까지** 적는다 — 나머지는 `외 N` 으로 센다 */
export const MAX_FAILED_NAMES = 2;

/** 이름을 모르는 대상의 id 를 줄이는 길이 — 알림 한 줄에 긴 난수를 싣지 않는다 */
const SHORT_ID = 8;

/**
 * 대상 하나의 이름 — 표가 아는 이름이 먼저, 그다음 위임 id(`delegated:<별칭>`)의 별칭,
 * 그래도 없으면 id 앞머리.
 */
export function targetName(targetId: string, labelOf: LabelOf): string {
  const known = labelOf(targetId)?.trim();
  if (known) return known;
  if (targetId.startsWith("delegated:")) {
    const alias = targetId.slice("delegated:".length).trim();
    if (alias) return alias;
  }
  return targetId.length > SHORT_ID ? targetId.slice(0, SHORT_ID) : targetId;
}

/** 이 대상 상태는 "실패" 로 적는가 — 성공도, 시작 전 취소도 아닌 끝 */
function isFailedTarget(r: TargetResult | undefined): boolean {
  return r !== undefined && (r.state === "failed" || r.state === "timedOut" || r.state === "unknown");
}

/** 실패한 이름들 → `web-02, db-01 외 1` (없으면 `null`) */
export function failedNamesLine(names: readonly string[], tr: Tr): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_FAILED_NAMES).join(", ");
  const more = names.length - MAX_FAILED_NAMES;
  const list = more > 0 ? tr("app.opnotify.failedMore", { names: shown, n: more }) : shown;
  return tr("app.opnotify.failedNames", { names: list });
}

/**
 * 걸린 시간 — 대상 결과들의 **가장 이른 시작 ~ 가장 늦은 끝**. 둘 중 하나라도 없으면 `null`
 * (시작 전에 취소된 대상은 끝만 있고 시작이 없다 — 그런 칸은 시작 쪽에서 빠진다).
 */
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
 * **canary 에서 멈췄는가** — 첫 대상(`targets[0]`)이 성공하지 못했고 나머지는 **시작조차 안 한**
 * 취소로만 남았다. 백엔드 executor 가 canary 실패 때 나머지를 `Cancelled`(시작 시각 없음)로
 * 채우는 모양 그대로다(`operations.rs` 의 `canary_proceed` 뒤).
 *
 * 대상이 하나뿐이면 canary 갈래가 아니다(멈춘 "나머지" 가 없다). 집계가 `partial` 인 경우도
 * 받는다 — canary 가 상태 불명(`unknown`)으로 끝나면 백엔드가 `partial` 로 봉한다.
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
 * **canary 사후 검증에서 멈췄는가** — canary 명령은 성공(exit 0)했는데 `validate` 명령이 실패해
 * 나머지를 돌리지 않았다.
 *
 * 백엔드가 이 판을 따로 표시하지 않으므로 **모양**으로 읽는다(`operations.rs` 의 `execute` —
 * 검증 실패 루프): canary 대상은 제 결과 그대로 `succeeded`(검증 프로브는 결과 행을 만들지 않는다),
 * 나머지는 전부 **시작 시각 없는 `cancelled`**(`error_class` 에 사유 문장), 집계는
 * `aggregate([Succeeded, Cancelled…])` = `partial`. 검증 명령의 종료 코드는 구조화된 칸에 없고 사유
 * **문장** 안에만 있어서 싣지 않는다(문구를 맞춰 보고 가르지 않는다 — docs/conventions.md 의 "이유
 * 코드").
 *
 * 사람의 취소와 섞이지 않는 근거: 나머지 대상은 취소 스위치를 본 **시작 전 취소**일 때만
 * `startedAt` 이 비고(그 밖의 모든 끝 — 실패·위임 회수·접속 실패 — 은 시작 시각을 찍는다), 검증을
 * 통과하면 첫 나머지 대상이 곧바로 시작한다. 그래서 "canary 성공 + 나머지 전부 시작 전 취소" 는
 * 검증이 막은 판이다 — `validate` 가 없는 작업안이면 이 갈래로 읽지 않는다(그때는 사람이 멈춘 것이다).
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

/**
 * [`outcomeOf`] 가 작업안에서 읽는 칸만 — 살아 있는 `Operation` 도, 감사 로그에서 되살린 실행
 * (`run-history.ts` 의 `runPlan`)도 이 모양이다. 대시보드 기록 보기가 결과 알림과 **같은 글자**로 말하는
 * 근거다(docs/log/2026-09-28-run-history.md).
 */
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

/**
 * 끝난 실행 한 건 → 말할 토막들. **순수 함수** (테스트: `operation-notify.test.ts`).
 *
 * - `state` 는 이벤트가 실어 온 종료 상태다(권위). `op` 는 제목·대상·승인 방식을 읽는 데만 쓴다 —
 *   목록을 못 읽었으면 `null` 이고, 그때 첫 줄은 "작업안" 이다.
 * - `results` 는 `operation_results` 한 번 — 못 읽었거나(`null`) 비었으면 **상태만 말하는
 *   물러선 문구**로 간다(`실패 · 대상별 결과는 작업안에서`). 이벤트에는 상태만 실리므로 결과를
 *   못 읽어도 알림은 떠야 한다.
 */
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

  // **사람의 취소가 먼저다** — 집계는 `partial`(일부 성공 + 나머지 시작 전 취소)이어도 사람이 멈춘
  // 것이다. 모양으로 짐작하지 않고 Rust 가 찍은 사실(`cancelledByUser`)을 본다 — 그래서 검증 통과 직후에
  // 누른 취소가 `canary 검증 실패로 멈춤` 으로 읽히던 틈도 닫힌다(docs/log/2026-09-28-run-history.md).
  // 실제로 실패한 대상이 있었으면 그 이름은 남긴다(상태 불명은 실패로 세지 않는다 — 취소가 끊은 것이다).
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

  // canary 에서 멈춤 — "나머지는 건드리지 않았다" 를 같이 말해야 사람이 안심한다.
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

  // canary 검증에서 멈춤 — canary 명령은 돌았고 성공했지만, 검증이 막아 나머지는 건드리지 않았다.
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

/** 둘째 줄 전부 — 결과 · 곁 토막 · 시간 (토스트의 부제 · 알림 센터 기록의 본문) */
export function subLine(o: RunOutcome): string {
  return [o.result, ...o.details, ...(o.duration ? [o.duration] : [])].join(" · ");
}

/** 한 줄로 — `nginx 설정 재적용 — 일부 실패 2/3 · 실패: web-02 · 8.2초` (접근성 문구 · 기록 본문) */
export function plainLine(o: RunOutcome): string {
  return `${o.headline} — ${subLine(o)}`;
}

// ---------------------------------------------------------------------------
// 가림막 아래 — 개수만
// ---------------------------------------------------------------------------

/** 가림막이 걸린 동안 끝난 실행 수 — 결마다 */
export interface VeiledTally {
  success: number;
  error: number;
  info: number;
}

export const EMPTY_TALLY: VeiledTally = { success: 0, error: 0, info: 0 };

/** 한 건 더한다 (새 값) */
export function addToTally(t: VeiledTally, level: RunLevel): VeiledTally {
  return { ...t, [level]: t[level] + 1 };
}

/**
 * 가림막 아래의 둘째 줄 — `실패 1건` · `실패 1건 · 성공 2건`. **제목도 호스트도 없다** — 토스트
 * 기둥(120)이 가림막(115)보다 위라서, 자리를 비운 사이 지나가는 사람에게 보이는 글자다.
 * 순서는 무거운 것부터(실패 → 취소 → 성공), 결은 그중 가장 무거운 것이다.
 */
export function veiledLine(t: VeiledTally, tr: Tr): { level: RunLevel; text: string } {
  const parts: string[] = [];
  if (t.error > 0) parts.push(tr("app.opnotify.veiled.error", { n: t.error }));
  if (t.info > 0) parts.push(tr("app.opnotify.veiled.info", { n: t.info }));
  if (t.success > 0) parts.push(tr("app.opnotify.veiled.success", { n: t.success }));
  const level: RunLevel = t.error > 0 ? "error" : t.info > 0 ? "info" : "success";
  return { level, text: parts.join(" · ") };
}

// ---------------------------------------------------------------------------
// 어디에 띄우나
// ---------------------------------------------------------------------------

/** [`shouldToast`] 가 보는 바깥 사실 */
export interface ToastFacts {
  /** **작업안**(채팅 독 갈래 · 원격 덮개)이 지금 보이는가 — 결과가 이미 눈앞이다 */
  operationsShown: boolean;
  /** 가림막이 걸렸는가 — 걸렸으면 개수만 띄운다(칸이 보여도 가림막이 덮고 있다) */
  veiled: boolean;
  /**
   * **사전 정책 자동 승인으로 돈 실행인가**(10-22) — 그렇다면 작업안 칸이 보여도 띄운다. 사람은 이 작업안을 한 번도 보지 않았다:
   * 검토 카드는 곧 자동 승인될 대기를 그리지 않고(`autoPending`), 작업안 칸에서는 승인 · 실행이 수십 ms 안에 지나가 눈에 남지 않는다.
   * 그 순간의 유일한 흔적이 이 토스트다. 사람이 승인한 실행은 예전 그대로(결과가 이미 눈앞이다).
   */
  auto?: boolean;
}

/** 토스트를 띄울 것인가 — 작업안 칸을 보고 있을 때만 건너뛴다(자동 승인된 실행은 늘 띄운다 · 알림 센터 기록은 늘 남는다) */
export function shouldToast(f: ToastFacts): boolean {
  return f.veiled || f.auto === true || !f.operationsShown;
}

/** [`osNotice`] 가 보는 바깥 사실 */
export interface OsFacts {
  /** `[automation] notify_operation_results` */
  enabled: boolean;
  /** 이 창이 지금 사람 앞에 있는가 (`app/os-notify` 의 `windowFocused()`) */
  focused: boolean;
  veiled: boolean;
}

/**
 * OS 알림 한 장 — 창이 앞에 없고 설정이 켜져 있을 때만. 본문은 **한 줄 요약과 결과 토막까지**다
 * (OS 알림 센터는 지나간 알림을 이력으로 쌓으므로 명령문 전문·실패한 호스트 목록을 싣지 않는다).
 * 가림막이 걸려 있으면 본문도 개수만(`veiledText`)이다.
 */
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
