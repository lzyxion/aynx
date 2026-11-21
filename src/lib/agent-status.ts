/**
 * 에이전트 상태 점의 판정 — 근거는 훅 신호뿐이고 모르면 그리지 않는다(미상 점 없음).
 * 출력 · 벨 · OSC 제목 · 프롬프트 복귀로 추정하지 않는다 — 포커스 보고 · SIGWINCH 다시 그리기가 "실행 중" 으로 잘못 잡혔다.
 * 권한 대기는 시효가 없다 — 손을 오래 기다린 그때가 점이 가장 필요할 때다.
 *
 * 서브 에이전트: 메인의 `Stop` 이 백그라운드 서브 에이전트보다 먼저 온다 — 진행 중이 있으면 완료가 아니다.
 * 알림은 메인의 `stop` 으로 선 완료뿐이다 — 마지막 `subagent-stop` 에서 알리면 메인이 결과를 받아 아직 도는데 "끝남" 이 간다.
 * `start` 는 집합을 비우지 않는다 — 백그라운드 서브 에이전트는 턴을 넘어 산다.
 */

export type AgentStatus = "running" | "permission" | "finished";

/** 전부 `Date.now()` 밀리초 */
export interface AgentSignals {
  exitedAt: number | null;
  signalRunningAt: number | null;
  signalPermissionAt: number | null;
  /** 메인이 멈춘 뒤 마지막 서브 에이전트가 끝난 시각일 수도 있다 */
  signalStopAt: number | null;
  subagents: readonly string[];
  signalSubagentAt: number | null;
  mainStopped: boolean;
}

export function emptyAgentSignals(): AgentSignals {
  return {
    exitedAt: null,
    signalRunningAt: null,
    signalPermissionAt: null,
    signalStopAt: null,
    subagents: [],
    signalSubagentAt: null,
    mainStopped: false,
  };
}

export function forgetHook(sig: AgentSignals): AgentSignals {
  return { ...emptyAgentSignals(), exitedAt: sig.exitedAt };
}

export function subagentCount(sig: AgentSignals | null | undefined): number {
  return sig ? sig.subagents.length : 0;
}

/** `Stop` 없이 CLI 가 죽어도 "실행 중" 이 영원히 남지 않게 */
export const AGENT_SIGNAL_TTL_MS = 10 * 60 * 1000;

export function lastHookSignal(sig: AgentSignals): "running" | "permission" | "stop" | null {
  let best: "running" | "permission" | "stop" | null = null;
  let at = -Infinity;
  // 순서가 곧 동률 규칙이다(끝 > 권한 > 실행) — 권한 물음을 거절하면 같은 시각에 `stop` 이 온다
  for (const [kind, v] of [
    ["running", sig.signalRunningAt],
    ["permission", sig.signalPermissionAt],
    ["stop", sig.signalStopAt],
  ] as const) {
    if (v !== null && v >= at) {
      best = kind;
      at = v;
    }
  }
  return best;
}

export function agentStatus(sig: AgentSignals, now: number, unseen: boolean): AgentStatus | null {
  if (sig.exitedAt !== null) return null;
  const busy = sig.subagents.length > 0;
  let last = lastHookSignal(sig);
  if (last === "stop" && busy) last = lastHookSignal({ ...sig, signalStopAt: null }) ?? "running";
  switch (last) {
    case "stop":
      return unseen ? "finished" : null;
    case "permission":
      return "permission";
    case "running": {
      const live = busy
        ? Math.max(sig.signalRunningAt ?? -Infinity, sig.signalStopAt ?? -Infinity, sig.signalSubagentAt ?? -Infinity)
        : (sig.signalRunningAt ?? -Infinity);
      return now - live < AGENT_SIGNAL_TTL_MS ? "running" : null;
    }
    default:
      return null;
  }
}

/**
 * Rust `src-tauri/src/agent_signal.rs` 의 `SignalEvent` 와 같은 글자. `session` 은 대화 id 를 싣는 연결 전용(상태 재료를 바꾸지 않는다) ·
 * `interrupt` 는 끝으로 두되 완료 · 알림은 아니다.
 */
export type HookSignalEvent =
  | "start"
  | "tool"
  | "tool-done"
  | "waiting"
  | "stop"
  | "subagent-start"
  | "subagent-stop"
  | "session-end"
  | "session"
  | "interrupt";

const HOOK_EVENTS: readonly string[] = [
  "start",
  "tool",
  "tool-done",
  "waiting",
  "stop",
  "subagent-start",
  "subagent-stop",
  "session-end",
  "session",
  "interrupt",
];

/** Rust `agent_signal::CLI_IDS` 와 같은 둘 */
export type SignalCli = "claude" | "codex";

export function signalCli(v: unknown): SignalCli | null {
  return v === "claude" || v === "codex" ? v : null;
}

/** AI 타일이 아니면 `cli` 를 실은 신호만 받아 그 CLI 로 분류한다 — 신호 토큰은 그 타일의 스트림에만 통하므로 근거가 된다 */
export function admitHookSignal(isAgent: boolean, cli: unknown): { admit: boolean; attest: SignalCli | null } {
  if (isAgent) return { admit: true, attest: null };
  const c = signalCli(cli);
  return c === null ? { admit: false, attest: null } : { admit: true, attest: c };
}

export function isHookSignalEvent(event: unknown): event is HookSignalEvent {
  return typeof event === "string" && HOOK_EVENTS.includes(event);
}

/**
 * `waiting` 의 `idle` · `other` · 범주 없음은 아무 칸에도 적지 않는다 — 완료 뒤 `idle` 이 와도 완료가 그대로 간다.
 * 권한 승인에는 훅이 없어 `tool-done` 까지 점이 권한 대기에 머문다.
 */
export function hookSignalKey(
  event: unknown,
  detail: unknown,
): "signalRunningAt" | "signalPermissionAt" | "signalStopAt" | null {
  switch (event) {
    case "start":
    case "tool":
    case "tool-done":
      return "signalRunningAt";
    case "waiting":
      return detail === "permission" ? "signalPermissionAt" : null;
    case "stop":
    case "interrupt":
      return "signalStopAt";
    default:
      return null;
  }
}

export interface HookStep {
  sig: AgentSignals;
  completed: boolean;
  notify: boolean;
}

/**
 * 앱은 이 함수를 부르지 않는다 — 같은 규칙을 Rust `agent_state::apply` 가 돈다. 명세 겸 테스트로 남긴다 — 고치면 둘을 함께.
 * 진행 중에 온 도구 신호는 `mainStopped` 를 풀지 않는다 — 메인 것인지 서브 에이전트 것인지 못 가린다.
 */
export function stepHookSignal(
  sig: AgentSignals,
  event: unknown,
  detail: unknown,
  agent: unknown,
  at: number,
): HookStep {
  const same: HookStep = { sig, completed: false, notify: false };
  const next: AgentSignals = { ...sig };
  let completed = false;
  const id = typeof agent === "string" && agent !== "" ? agent : null;
  switch (event) {
    case "start":
      next.signalRunningAt = at;
      next.mainStopped = false;
      break;
    case "tool":
    case "tool-done":
      next.signalRunningAt = at;
      if (sig.subagents.length === 0) next.mainStopped = false;
      break;
    case "waiting":
      if (hookSignalKey(event, detail) === null) return same;
      next.signalPermissionAt = at;
      break;
    case "stop":
      next.signalStopAt = at;
      next.mainStopped = true;
      completed = sig.subagents.length === 0;
      break;
    case "interrupt":
      next.signalStopAt = at;
      next.mainStopped = true;
      break;
    case "subagent-start":
      if (id === null) return same;
      if (!sig.subagents.includes(id)) next.subagents = [...sig.subagents, id];
      next.signalSubagentAt = at;
      break;
    case "subagent-stop":
      if (id === null || !sig.subagents.includes(id)) return same;
      next.subagents = sig.subagents.filter((x) => x !== id);
      next.signalSubagentAt = at;
      if (next.subagents.length === 0 && sig.mainStopped) {
        next.signalStopAt = at;
        completed = true;
      }
      break;
    case "session-end":
      return { sig: { ...emptyAgentSignals(), exitedAt: sig.exitedAt }, completed: false, notify: false };
    default:
      return same;
  }
  return { sig: next, completed, notify: completed && event === "stop" };
}

export const AGENT_STATUS_RANK: Record<AgentStatus, number> = { permission: 0, finished: 1, running: 2 };

export function foldAgentStatus(list: readonly (AgentStatus | null)[]): AgentStatus | null {
  let best: AgentStatus | null = null;
  for (const s of list) {
    if (s !== null && (best === null || AGENT_STATUS_RANK[s] < AGENT_STATUS_RANK[best])) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rust 표의 몫 — 상태의 권위는 Rust `src-tauri/src/agent_state.rs` 다
// ---------------------------------------------------------------------------

/** `state` 는 시효 · 안 봄을 얹기 전의 전이 결과라 점에 쓰지 않는다 — 점은 [`agentStatus`] 가 정한다 */
export interface AgentStateWire {
  cli: SignalCli | null;
  state: AgentStatus | null;
  agentRunId: string | null;
  seq: number;
  at: number;
  subagents: string[];
  lastEvent: string | null;
  signalRunningAt: number | null;
  signalPermissionAt: number | null;
  signalStopAt: number | null;
  signalSubagentAt: number | null;
  mainStopped: boolean;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseAgentStateWire(v: unknown): AgentStateWire | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const seq = numOrNull(o.seq);
  if (seq === null) return null;
  const state = o.state === "running" || o.state === "permission" || o.state === "finished" ? o.state : null;
  return {
    cli: signalCli(o.cli),
    state,
    agentRunId: strOrNull(o.agentRunId),
    seq,
    at: numOrNull(o.at) ?? 0,
    subagents: Array.isArray(o.subagents) ? o.subagents.filter((x): x is string => typeof x === "string") : [],
    lastEvent: strOrNull(o.lastEvent),
    signalRunningAt: numOrNull(o.signalRunningAt),
    signalPermissionAt: numOrNull(o.signalPermissionAt),
    signalStopAt: numOrNull(o.signalStopAt),
    signalSubagentAt: numOrNull(o.signalSubagentAt),
    mainStopped: o.mainStopped === true,
  };
}

export function parseAgentStatesSnapshot(v: unknown): [string, AgentStateWire][] {
  if (!Array.isArray(v)) return [];
  const out: [string, AgentStateWire][] = [];
  for (const row of v) {
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const wire = parseAgentStateWire(row[1]);
    if (wire) out.push([row[0], wire]);
  }
  return out;
}

/** 스냅숏이 이벤트보다 늦거나 이벤트가 거꾸로 와도 늦은 값이 이긴다 — seq 는 Rust 표가 매긴다 */
export function acceptSeq(have: number | null | undefined, seq: number): boolean {
  return have === null || have === undefined || seq > have;
}

/** 종료 표식은 창의 것이다 */
export function signalsFromWire(w: AgentStateWire, exitedAt: number | null): AgentSignals {
  return {
    exitedAt,
    signalRunningAt: w.signalRunningAt,
    signalPermissionAt: w.signalPermissionAt,
    signalStopAt: w.signalStopAt,
    subagents: [...w.subagents],
    signalSubagentAt: w.signalSubagentAt,
    mainStopped: w.mainStopped,
  };
}

/** 재료 없는 항목(`waiting` 의 `idle` 만 받은 …)으로 새 칸을 만들지 않는다 */
export function hasHookMaterial(w: AgentStateWire): boolean {
  return (
    w.signalRunningAt !== null ||
    w.signalPermissionAt !== null ||
    w.signalStopAt !== null ||
    w.signalSubagentAt !== null ||
    w.subagents.length > 0
  );
}
