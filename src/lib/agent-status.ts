/**
 * **에이전트 상태 판정** — 순수 규칙 하나 (docs/log/2026-10-01-agent-status-three.md ·
 * 처음 판 docs/log/2026-09-24-agent-status-dot.md).
 *
 * 점은 **세 가지뿐**이고, 근거는 **에이전트 훅 신호 하나**다 — 에이전트가 직접 말한 것만 그린다
 * (설정 › AI 의 에이전트 훅 — `src-tauri/src/agent_hooks.rs` — 을 설치한 사용자에게만 온다,
 * docs/log/2026-09-24-agent-hook-signals.md).
 *
 * | 상태 | 근거 | 점 |
 * | --- | --- | --- |
 * | `running` 실행 중 | 훅 `start`·`tool`·`tool-done`(`UserPromptSubmit`·`PreToolUse`·`PostToolUse`)이 가장 최근 | 초록이 숨 쉰다 |
 * | `permission` 권한 대기 | 훅 `waiting` 중 범주 `permission`(Claude Code `Notification` · Codex `PermissionRequest`)이 가장 최근 | 강조색 + 옅은 후광 |
 * | `finished` 완료 | 훅 `stop`(턴 끝)이 가장 최근이고 **그 타일을 아직 안 봤다**(`app/agent-unseen`) | 노랑 + 물결 |
 *
 * 그 밖은 전부 **점 없음(`null`)** 이다. "모르면 그리지 않는다" — 미상이라는 넷째 점은 없다.
 *
 * ## 규칙 (위에서 먼저 걸리는 것이 답)
 *
 * 1. 세션이 끝났다(`exitedAt`) → `null`.
 * 2. 훅 신호 셋(실행 · 권한 · 끝) 중 **가장 늦은 것**이 말한다. 같은 시각이면 끝 > 권한 > 실행
 *    (권한 물음을 거절하면 곧바로 `stop` 이 온다 — 손을 넘긴 쪽이 이긴다).
 *    - 끝 → 안 봤으면 `finished`, 봤으면 `null`. **보면 사라진다** — 수명은 벨의 안 본 표식과 같다
 *      (그 탭이 활성 탭이 되는 순간 거둔다). 보이는 타일에서 끝나면 처음부터 서지 않는다.
 *    - 권한 → `permission`. **시효가 없다** — 손을 기다리는 타일을 오래 놔 둔 그 순간이 점이 가장 필요할 때다.
 *    - 실행 → [`AGENT_SIGNAL_TTL_MS`](10분) 안이면 `running`, 넘으면 `null` — `Stop` 이 오지 않은 채
 *      CLI 가 죽었을 때 "실행 중" 이 영원히 남지 않게.
 * 3. 훅 신호가 하나도 없다 → `null` (훅 미설치 · 신호를 안 내는 에이전트 · 신호가 닿지 않는 원격).
 *
 * 훅 `waiting` 의 범주가 `idle`·`other`(한참 입력이 없다는 알림)거나 없으면(옛 스크립트) **아무 칸에도 적지
 * 않는다**([`hookSignalKey`]) — 완료 뒤 `idle` 이 와도 완료 · 안 봄의 수명이 그대로 간다.
 *
 * ## 서브 에이전트 — "메인이 멈췄고 + 진행 중 0개" 가 완료다 (docs/log/2026-10-04-subagent-signals.md)
 *
 * Claude Code 대화형 세션의 서브 에이전트는 기본이 **백그라운드**라(공식 문서 — fork mode), 메인이 서브
 * 에이전트를 띄워 두고 턴을 끝내면 `Stop` 이 서브 에이전트보다 **먼저** 온다. 훅 `subagent-start`·`subagent-stop`
 * (`SubagentStart`·`SubagentStop`, 스크립트 6판이 그 id 를 싣는다)으로 **진행 중인 서브 에이전트 id 집합**
 * (`subagents`)을 든다 — 상태 전이는 [`stepHookSignal`] 하나다:
 *
 * - 끝 신호가 가장 늦어도 **진행 중이 있으면 완료가 아니다** — 끝을 뺀 나머지(권한 · 실행)가 말한다. 실행
 *   시효는 서브 에이전트 신호 · 끝 신호까지 넣어 잰다(백그라운드 서브 에이전트가 일하는 동안 점이 꺼지지 않게).
 * - 마지막 `subagent-stop` 으로 0 이 되고 **메인이 멈춰 있으면**(`mainStopped`) 그 순간을 끝 시각으로 적고
 *   완료가 된다 — **점만 완료이고 알리지 않는다**(2026-10-21).
 * - **알림은 메인의 `stop` 으로 선 완료뿐이다.** 백그라운드 서브 에이전트가 끝나면 메인이 결과를 받아 다시 돌고
 *   (문서: 결과는 "a later turn" 의 완료 알림으로 메인에 닿는다) 그 턴의 `Stop` 이 진짜 끝이다. 예전에는 마지막
 *   `subagent-stop` 에서 알리고 그 뒤의 `Stop` 을 문지기로 삼켰는데, 그러면 메인이 아직 일하는 중에 "끝남" 이 왔다.
 * - **세지 않는 것**: id 가 없는 신호(옛 스크립트 · `.cmd` 가 첫 줄 1023자 안에서 못 찾음) · 모르는 id 의 끝
 *   (시작을 놓침 · 같은 끝이 두 번) — 음수가 되지 않는다. `start`(새 사용자 턴)는 집합을 비우지 않는다 —
 *   백그라운드 서브 에이전트는 턴을 넘어 산다(문서). 비우는 것은 새 CLI(OSC 133 `C`) · 셸 복귀 · 새 세션 ·
 *   타일 닫기뿐이다.
 * - 진행 중에 온 `tool`·`tool-done` 은 메인의 것인지 서브 에이전트의 것인지 가리지 못한다(입력의 `agent_id`
 *   를 읽지 않는다) — 그래서 진행 중이 있을 때의 도구 신호는 `mainStopped` 를 풀지 않는다.
 *
 * ## 판정에 쓰지 않는 것 (2026-10-01 에 뺐다)
 *
 * 출력 · 벨 · OSC 제목 · OSC 133 프롬프트 복귀로 실행/대기를 **추정**하던 규칙. 포커스가 바뀌면 xterm 이
 * 포커스 보고(`\x1b[I`·`\x1b[O` — Claude Code 가 `?1004` 를 켠다)를 보내 TUI 가 화면을 다시 그리고, 크기
 * 맞춤(SIGWINCH)도 다시 그려서, 그 출력이 "실행 중" 으로 잘못 잡혔다(타일 클릭 → 실행 중 · 탭 전환 → 미상).
 * 그 신호들은 다른 기능(새 AI 타일이 붙여 넣기를 받을 준비가 됐나 · 에이전트가 끝나 셸로 돌아왔나)에서는
 * 계속 쓰인다 — 표시 판정에서만 빠졌다. 사연은 docs/log/2026-10-01-agent-status-three.md.
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다 (`pane-identity.ts` 와 같은 이유).
 */

/** 점 셋 — 점이 없으면 `null` */
export type AgentStatus = "running" | "permission" | "finished";

/** 판정의 재료 — 타일 하나의 훅 신호와 세션 종료. 전부 `Date.now()` 밀리초, 없으면 `null` */
export interface AgentSignals {
  exitedAt: number | null;
  /** 훅이 "턴 시작 · 도구 사용 · 도구 끝" 을 알린 마지막 시각 (`start`·`tool`·`tool-done`) */
  signalRunningAt: number | null;
  /** 훅이 "권한을 묻는다" 를 알린 마지막 시각 (`waiting` + 범주 `permission`) */
  signalPermissionAt: number | null;
  /**
   * 훅이 "턴이 끝났다" 를 알린 마지막 시각 (`stop`) — 또는 메인이 멈춘 뒤 진행 중이던 마지막 서브 에이전트가
   * 끝난 시각(그때가 완료다 — [`stepHookSignal`])
   */
  signalStopAt: number | null;
  /** 진행 중인 서브 에이전트 id (`subagent-start` 로 들어오고 `subagent-stop` 으로 나간다) */
  subagents: readonly string[];
  /** 마지막 서브 에이전트 신호 시각 — 진행 중이 있을 때 실행 시효를 잰다 */
  signalSubagentAt: number | null;
  /** 메인이 멈춰 있는가 — `stop` 이 세우고, `start` 또는 진행 중이 없을 때의 도구 신호가 내린다 */
  mainStopped: boolean;
}

/** 빈 신호 — 저장소가 새 타일에 처음 적을 때의 모양 */
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

/** 지난 에이전트의 훅 신호만 버린 모양 — 종료 표식(세션 단위)은 둔다. 새 CLI(OSC 133 `C`) · 셸 복귀가 부른다 */
export function forgetHook(sig: AgentSignals): AgentSignals {
  return { ...emptyAgentSignals(), exitedAt: sig.exitedAt };
}

/** 진행 중인 서브 에이전트 수 (신호가 없으면 0) */
export function subagentCount(sig: AgentSignals | null | undefined): number {
  return sig ? sig.subagents.length : 0;
}

/** 훅의 "실행" 신호가 살아 있는 시효(ms) — 넘으면 점이 없다. 권한 · 끝 신호에는 시효가 없다. */
export const AGENT_SIGNAL_TTL_MS = 10 * 60 * 1000;

/** 가장 늦은 훅 신호의 종류 — 같은 시각이면 끝 > 권한 > 실행. 신호가 없으면 `null` */
export function lastHookSignal(sig: AgentSignals): "running" | "permission" | "stop" | null {
  let best: "running" | "permission" | "stop" | null = null;
  let at = -Infinity;
  // 뒤에 오는 것이 같은 시각에서 이긴다(`>=`) — 순서가 곧 동률 규칙이다.
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

/**
 * 신호 → 점 하나(없으면 `null`). 규칙은 모듈 머리말. `unseen` = 그 타일에 "끝남 · 아직 안 봄" 표식이
 * 있는가(`app/agent-unseen`).
 */
export function agentStatus(sig: AgentSignals, now: number, unseen: boolean): AgentStatus | null {
  if (sig.exitedAt !== null) return null;
  const busy = sig.subagents.length > 0;
  let last = lastHookSignal(sig);
  // 진행 중인 서브 에이전트가 있으면 끝은 완료가 아니다 — 끝을 뺀 나머지가 말하고, 없으면 실행 중.
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
 * 에이전트 훅(Claude Code · Codex)이 보내 오는 이벤트 아홉 (`src-tauri/src/agent_signal.rs` 의 `SignalEvent`). `session-end` 는
 * 훅 9판 — CLI 가 끝났다(`/clear` 는 스크립트가 거른다 · 2026-10-08). `session` 은 훅 10판 — Claude `SessionStart`(시작 · `/resume` ·
 * `/clear` · compact)가 대화 id 를 싣는 **연결 전용** 신호다(상태 재료를 바꾸지 않는다 — [`stepHookSignal`] 의 기본 갈래 · 2026-10-17).
 * `interrupt` 는 2026-11-02 — 사람이 턴을 끊었다(Codex `Interrupt` 훅 · 대화 면 [중지]) — 끝으로 두되 완료 · 알림은 아니다.
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

/** 훅 신호가 밝히는 CLI — Rust `agent_signal::CLI_IDS` 와 같은 둘 */
export type SignalCli = "claude" | "codex";

/** 페이로드의 `cli`(스크립트 8판) → 아는 이름, 그 밖(옛 스크립트의 `undefined`·`null` · 모르는 글자)은 `null` */
export function signalCli(v: unknown): SignalCli | null {
  return v === "claude" || v === "codex" ? v : null;
}

/**
 * 훅 신호 하나를 그 타일이 **받는가** — 이미 AI 타일이면 받는다(분류는 그대로 · `attest: null`). 아니면 신호가 `cli` 를
 * 실었을 때만 받고, 그 CLI 로 타일을 분류한다(`attest`) — 신호 토큰은 그 타일의 스트림에만 통하므로 근거가 된다
 * (2026-10-08). `cli` 없는 옛 신호는 지금처럼 버린다.
 */
export function admitHookSignal(isAgent: boolean, cli: unknown): { admit: boolean; attest: SignalCli | null } {
  if (isAgent) return { admit: true, attest: null };
  const c = signalCli(cli);
  return c === null ? { admit: false, attest: null } : { admit: true, attest: c };
}

/** 아는 훅 이벤트인가 — 모르는 것은 버린다 */
export function isHookSignalEvent(event: unknown): event is HookSignalEvent {
  return typeof event === "string" && HOOK_EVENTS.includes(event);
}

/**
 * 훅 이벤트(+`waiting` 의 범주) → 적을 칸. `start`·`tool`·`tool-done` 은 실행, `waiting` 은 범주가
 * `permission` 일 때만 권한, `stop` 은 끝. 그 밖(`waiting` 의 `idle`·`other`·범주 없음 · 모르는 이벤트)은
 * `null` — 상태를 바꾸지 않는다. `tool-done`(`PostToolUse`)은 권한 물음을 **승인한 뒤** 그 도구가 끝난
 * 순간이다 — 승인에는 훅이 없어 그 전까지 점이 권한 대기에 머문다(docs/log/2026-09-24-agent-hook-signals.md).
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

/** [`stepHookSignal`] 의 결과 */
export interface HookStep {
  sig: AgentSignals;
  /** 이 신호로 **완료**가 섰다 — `stop`(진행 중 0개) · 메인이 멈춘 뒤 마지막 `subagent-stop` */
  completed: boolean;
  /** 완료를 **알린다** — 메인의 `stop` 으로 선 완료만(서브 에이전트로 선 완료는 알리지 않는다) */
  notify: boolean;
}

/**
 * 훅 신호 하나 → 다음 신호 상태 (순수 — 받은 값을 고치지 않는다). 규칙은 모듈 머리말의 "서브 에이전트".
 *
 * **앱은 이 함수를 더 부르지 않는다**(세션 서버 설계 ① · 2026-10-08) — 같은 규칙을 Rust `agent_state::apply` 가 돌고,
 * 창은 그 결과(`agent-signal` 의 `agentState`)를 받아 적는다. 규칙의 명세 겸 테스트로 남겨 둔다 — 고치면 둘을 함께.
 *
 * | 이벤트 | 하는 일 |
 * | --- | --- |
 * | `start` | 실행 시각 · 메인 돈다 (서브 에이전트 집합은 둔다) |
 * | `tool`·`tool-done` | 실행 시각. 진행 중이 없을 때만 메인 돈다 |
 * | `waiting` + `permission` | 권한 시각 (그 밖의 범주는 그대로) |
 * | `stop` | 끝 시각 · 메인 멈춤. 진행 중이 없으면 완료 · 알림 |
 * | `subagent-start` + id | 집합에 더함(이미 있으면 그대로) · 서브 에이전트 시각 |
 * | `subagent-stop` + id | 집합에서 뺌 — 그래서 0 이 됐고 메인이 멈춰 있으면 끝 시각 = 지금 · 완료(알리지 않음) |
 * | 서브 에이전트 신호인데 id 가 없거나 모르는 id 의 끝 | 아무것도 바꾸지 않는다(세지 않는다) |
 * | `session-end` | CLI 가 끝났다 — 재료를 비운다(종료 표식만 둔다 · Rust 는 표에서 항목을 지운다) |
 * | `interrupt` | 사람이 끊었다 — 끝 시각 · 메인 멈춤. 완료 · 알림 아님(서브 에이전트 집합은 둔다) |
 * | `session` | 대화가 섰다 · 바뀌었다 — 재료는 그대로(연결 전용 · 대화 id 는 부르는 쪽이 `linkAgentSession` 으로) |
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
  // 서브 에이전트로 선 완료는 알리지 않는다 — 메인이 결과를 받아 다시 돌고, 그 `stop` 이 알린다.
  return { sig: next, completed, notify: completed && event === "stop" };
}

/** 접을 때의 급함 — 손을 기다리는 것이 가장 먼저 읽혀야 한다 */
export const AGENT_STATUS_RANK: Record<AgentStatus, number> = { permission: 0, finished: 1, running: 2 };

/**
 * AI 타일들을 **가장 급한 것 하나**로 접는다 (권한 대기 > 완료 > 실행 중). 점이 없는 타일(`null`)은 건너뛰고,
 * 그릴 것이 없으면 `null`.
 */
export function foldAgentStatus(list: readonly (AgentStatus | null)[]): AgentStatus | null {
  let best: AgentStatus | null = null;
  for (const s of list) {
    if (s !== null && (best === null || AGENT_STATUS_RANK[s] < AGENT_STATUS_RANK[best])) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rust 표의 몫 — 상태의 권위는 Rust `src-tauri/src/agent_state.rs` 다 (세션 서버 설계 9절 ①)
// ---------------------------------------------------------------------------

/**
 * Rust 에이전트 상태 표의 항목 한 줄 — `agent_states_snapshot` 의 값이자 `agent-signal` 페이로드의 `agentState`.
 * 판정 재료는 [`AgentSignals`] 와 같은 이름이다(종료 표식 `exitedAt` 만 창의 것이라 없다). `state` 는 시효 · 안 봄을
 * 얹기 전의 전이 결과라 점을 그리는 데 쓰지 않는다 — 점은 여전히 [`agentStatus`] 가 정한다.
 */
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

/** 받은 값 → 항목 (모양이 틀리면 `null` — `seq` 가 없으면 이어 받을 근거가 없다) */
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

/** `agent_states_snapshot` 의 답(`[스트림, 항목][]`) → 쓸 수 있는 줄만 */
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

/**
 * 이 seq 의 상태를 적는가 — 이미 본 것(같거나 낮은 seq)은 버린다. 스냅숏이 이벤트보다 늦게 도착하거나 이벤트가
 * 다른 스레드에서 거꾸로 와도 늦은 값이 이긴다(seq 는 Rust 표가 매긴다).
 */
export function acceptSeq(have: number | null | undefined, seq: number): boolean {
  return have === null || have === undefined || seq > have;
}

/** 항목 → 판정 재료. 종료 표식은 창의 것이라 지금 값을 그대로 둔다 */
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

/** 훅 신호 재료가 하나라도 있는가 — 없는 항목(`waiting` 의 `idle` 만 받은 …)으로 새 칸을 만들지 않는다 */
export function hasHookMaterial(w: AgentStateWire): boolean {
  return (
    w.signalRunningAt !== null ||
    w.signalPermissionAt !== null ||
    w.signalStopAt !== null ||
    w.signalSubagentAt !== null ||
    w.subagents.length > 0
  );
}
