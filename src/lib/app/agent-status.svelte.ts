import { invoke, listen, type UnlistenFn } from "../ipc";
import {
  acceptSeq,
  admitHookSignal,
  agentStatus,
  emptyAgentSignals,
  foldAgentStatus,
  forgetHook,
  hasHookMaterial,
  isHookSignalEvent,
  parseAgentStatesSnapshot,
  parseAgentStateWire,
  signalsFromWire,
  subagentCount,
  type AgentSignals,
  type AgentStateWire,
  type AgentStatus,
  type HookSignalEvent,
} from "$lib/agent-status";
import { aiDisplayName } from "$lib/pane-icons";
import type { TabDotAgent } from "$lib/tab-dot";
import { findPaneByStream, listPanes, type PaneSpec, type TabSpec } from "$lib/session";
import { clearSignalAttested, markAgentEnded, markSignalAttested, paneAi } from "$lib/app/titles.svelte.js";
import { activeTabId, focusTile, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { clearAgentUnseen, hasAgentUnseen, markAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { notifyAgent } from "$lib/app/agent-notify";
import { agentBannerSignal, dropAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { agentNotifyKind } from "$lib/agent-notify";
import {
  agentCliStarted,
  agentLinkOf,
  agentSessionRestarted,
  linkAgentSession,
  noteConversationSignal,
  scheduleConversationRefresh,
  unlinkAgentSession,
} from "$lib/app/agent-sessions.svelte.js";
import { noteHookVersion } from "$lib/app/hook-version-notice";
import { dropTurn, turnBegan, turnEnded, turnSoFar, turnTool } from "$lib/app/agent-turn";
import { refreshWorktreeChangesAfterTurn } from "$lib/app/worktrees.svelte.js";
import { refreshPaneGitAfterTurn } from "$lib/app/pane-git.svelte.js";

/**
 * 에이전트 상태 점의 저장소 — 상태의 권위는 Rust `src-tauri/src/agent_state.rs` 표이고 창은 그 결과를 적는다.
 * 이미 본 seq 의 상태는 버리되 알림 · 배너 같은 곁일은 이벤트마다 돈다(이 창이 그 이벤트를 처음 본 것이다).
 * 출력 · OSC 133 `C`/`A` 는 점을 정하지 않는다 — 붙여 넣기 준비 · 셸 복귀 판정에만 쓴다.
 * [`agentSessionStart`] · [`dropAgent`] 는 창의 표시만 지운다 — 이관으로 떠나는 타일도 그 길이라 Rust 표를 건드리면 안 된다.
 * 1초 시계는 신호를 든 타일이 있을 때만 돈다.
 */

const signals = $state<Record<string, AgentSignals>>({});
const seqOf = new Map<string, number>();
/** 판정 재료가 아니라 `AgentSignals` 밖에 둔다 · 새 명령(`C`) · 새 세션이 지운다 */
const turnStarted = $state<Record<string, number>>({});
let now = $state(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
/**
 * [`agentPromptReturned`] 의 문지기 — 세션이 막 열려 셸이 처음 그리는 프롬프트를 "끝남" 으로 읽지 않게.
 * 컴포넌트가 아니라 모듈에 있어 이관 · 재마운트를 건너 산다.
 */
const commandRunning = new Set<string>();
const commandStartedAt = new Map<string, number>();
/** 반응형이 아니다 — 500ms 마다 오는 출력이 아무것도 다시 그리게 하지 않게 */
const lastOutput = new Map<string, number>();

const hookListeners = new Set<(paneId: string, event: HookSignalEvent) => void>();

export function onAgentHookSignal(fn: (paneId: string, event: HookSignalEvent) => void): () => void {
  hookListeners.add(fn);
  return () => void hookListeners.delete(fn);
}

export function agentCommandStartedAt(paneId: string): number | null {
  return commandRunning.has(paneId) ? (commandStartedAt.get(paneId) ?? null) : null;
}

function syncClock(): void {
  const need = Object.keys(signals).length > 0;
  if (need && clock === null) clock = setInterval(() => (now = Date.now()), 1000);
  else if (!need && clock !== null) {
    clearInterval(clock);
    clock = null;
  }
}

export function isAgentPane(pane: PaneSpec): boolean {
  return agentKindOf(pane) !== null;
}

export function agentKindOf(pane: PaneSpec): string | null {
  if (pane.kind === "local" || pane.kind === "ssh") return paneAi(pane);
  return null;
}

function note(paneId: string, key: "exitedAt"): void {
  const at = Date.now();
  const cur = signals[paneId];
  if (cur) cur[key] = at;
  else {
    signals[paneId] = { ...emptyAgentSignals(), [key]: at };
    syncClock();
  }
  now = at;
}

function adoptWire(paneId: string, wire: AgentStateWire): boolean {
  if (!acceptSeq(seqOf.get(paneId), wire.seq)) return false;
  seqOf.set(paneId, wire.seq);
  const cur = signals[paneId];
  if (!cur && !hasHookMaterial(wire)) return true;
  signals[paneId] = signalsFromWire(wire, cur?.exitedAt ?? null);
  if (!cur) syncClock();
  now = Date.now();
  return true;
}

/** 곁일(알림 · 배너 · 안 봄)은 없다 — 지나간 사건을 다시 일으키지 않는다 */
function adoptSnapshotRow(stream: string, wire: AgentStateWire): void {
  const pane = paneForStream(stream)?.pane;
  if (!pane) return;
  if (pane.kind !== "local" && pane.kind !== "ssh") return;
  const admit = admitHookSignal(isAgentPane(pane), wire.cli);
  if (!admit.admit) return;
  if (admit.attest !== null) markSignalAttested(pane.id, admit.attest);
  adoptWire(pane.id, wire);
}

function paneForStream(stream: string): { pane: PaneSpec; tab: TabSpec } | null {
  for (const tab of residentWindowTabs()) {
    const pane = findPaneByStream(tab.root, stream);
    if (pane) return { pane, tab };
  }
  return null;
}

async function pullAgentStates(onlyStream?: string): Promise<void> {
  const rows = parseAgentStatesSnapshot(await invoke<unknown>("agent_states_snapshot").catch(() => []));
  for (const [stream, wire] of rows) {
    if (onlyStream === undefined || stream === onlyStream) adoptSnapshotRow(stream, wire);
  }
}

/** `agent-signal` 을 이미 듣고 있어도 된다 — seq 가 가른다 */
export function syncAgentStates(): Promise<void> {
  return pullAgentStates();
}

export function agentStateResumed(pane: PaneSpec): void {
  void pullAgentStates(pane.historyStreamId ?? pane.id);
}

/** 점을 정하지 않는다 — 포커스 보고 · 크기 맞춤의 다시 그리기도 출력이라 "실행 중" 으로 잘못 읽힌다 */
export function agentOutput(pane: PaneSpec): void {
  if (isAgentPane(pane)) lastOutput.set(pane.id, Date.now());
}

export function agentLastOutputAt(paneId: string): number | null {
  return lastOutput.get(paneId) ?? null;
}

/** 재연결로 넘어가는 끊김에서는 부르지 않는다 */
export function agentExit(pane: PaneSpec): void {
  if (isAgentPane(pane)) note(pane.id, "exitedAt");
  clearSignalAttested(pane.id);
  dropAgentBanner(pane.id);
  clearAgentUnseen([pane.id]);
}

/**
 * `Terminal` 이 `oncommand` 보고 뒤에 부른다 — 타일 신원이 도는 명령을 읽은 다음이어야 한다.
 * `replayed`(다시 붙기의 링 재생)면 연결을 건드리지 않는다 — 명세 사본으로 다시 이은 연결이 산다.
 */
export function agentCommandStarted(pane: PaneSpec, replayed = false): void {
  if (!isAgentPane(pane)) return;
  if (!replayed) agentCliStarted(pane.id);
  commandRunning.add(pane.id);
  commandStartedAt.set(pane.id, Date.now());
  delete turnStarted[pane.id];
  dropTurn(pane.id);
  clearAgentUnseen([pane.id]);
  forgetHookSignals(pane, replayed ? "replay" : "cli-start");
}

/**
 * Claude 는 Esc 로 끊을 때 훅이 오지 않는다 — 서버 표에 알리고 방송으로 풀린다(여기서 신호를 직접 고치지 않는다).
 * Codex 는 `Interrupt` 훅이 와 같은 사건이 한 번 더 올 수 있다 — 끝난 뒤의 둘째는 서버가 버린다.
 */
export function noteAgentInterrupted(pane: PaneSpec): void {
  void invoke("agent_state_interrupt", { stream: pane.historyStreamId ?? pane.id }).catch(() => {});
}

/**
 * 새 CLI · 셸 복귀는 창만 보므로 Rust 표에도 알린다 — 안 그러면 다음 전이가 옛 서브 에이전트 집합을 이어받아 완료가 서지 않는다.
 * `cause` 는 Rust `agent_state::ForgetCause` 와 같은 글자 — 서버 장부의 띄우며 적은 연결이 이것으로 갈린다.
 */
function forgetHookSignals(pane: PaneSpec, cause: "cli-start" | "replay" | "shell-return"): void {
  void invoke("agent_state_forget", { stream: pane.historyStreamId ?? pane.id, cause }).catch(() => {});
  const cur = signals[pane.id];
  if (!cur) return;
  signals[pane.id] = forgetHook(cur);
}

/**
 * 에이전트 명령이 돈 뒤 출력을 낸 적이 있을 때의 `A` 만 센다 — 세션이 막 열려 그리는 첫 프롬프트는 세지 않는다.
 * [`markAgentEnded`] 를 빼면 autorun 이 남아 헤더가 계속 "Claude Code" 로 읽힌다.
 */
export function agentPromptReturned(pane: PaneSpec): void {
  if (!commandRunning.delete(pane.id)) return;
  commandStartedAt.delete(pane.id);
  if (!isAgentPane(pane) || !lastOutput.has(pane.id)) return;
  markAgentEnded(pane.id);
  clearSignalAttested(pane.id);
  unlinkAgentSession(pane.id);
  forgetHookSignals(pane, "shell-return");
  clearAgentUnseen([pane.id]);
  dropTurn(pane.id);
  delete turnStarted[pane.id];
}

/** Rust `src-tauri/src/agent_signal.rs` 의 `payload` 와 같은 모양 */
export interface AgentSignalPayload {
  /** `AYNX_STREAM` = `historyStreamId ?? id` */
  stream: string;
  event: HookSignalEvent;
  /** Rust 가 `agent_signal::WAITING_DETAILS` 밖의 값은 버린다 */
  detail?: string | null;
  at?: number;
  /** Rust 가 UUID 모양만 통과시킨다 */
  session?: string | null;
  /** 없으면 4판 이하 스크립트 */
  hookVersion?: number | null;
  /** Rust `agent_hooks::SCRIPT_VERSION` */
  hookLatest?: number | null;
  seq?: number;
  /** 정보용 — 점은 `agentState` 의 재료로 `agentStatus` 가 정한다 */
  state?: AgentStatus | null;
  agentState?: unknown;
  completed?: boolean;
  notify?: boolean;
  /** 서브 에이전트 id — 없으면 그 서브 에이전트 신호는 세지 않는다 */
  agent?: string | null;
  /** Rust `agent_signal::CLI_IDS` 둘만 통과 — 분류되지 않은 타일을 그 CLI 의 타일로 치는 근거다 */
  cli?: string | null;
}

/**
 * 이벤트는 모든 창에 방송된다 — 이 창의 타일이 아닌 스트림은 버려 알림이 그 타일을 쥔 창 하나에서만 뜬다. 돌려주는 값은 하네스가 본다.
 * 모든 로컬 타일 · 에이전트 활성화가 켜진 호스트의 원격 타일이 신호 토큰을 받으므로 손으로 친 `claude` 도 온다.
 */
export function agentSignal(payload: AgentSignalPayload): boolean {
  if (!isHookSignalEvent(payload.event) || typeof payload.stream !== "string") return false;
  const found = paneForStream(payload.stream);
  if (found) {
    const { pane, tab } = found;
    if (payload.event === "session-end") return agentCliEnded(pane, payload);
    // 신호로 붙인 분류 표식은 이관 짐에 싣지 않는다 — 넘어간 창에는 다음 신호가 다시 붙인다
    if (pane.kind !== "local" && pane.kind !== "ssh") return false;
    const admit = admitHookSignal(isAgentPane(pane), payload.cli);
    if (!admit.admit) return false;
    if (admit.attest !== null) markSignalAttested(pane.id, admit.attest);
    for (const fn of hookListeners) fn(pane.id, payload.event);
    // `start` 가 새 시각을 적기 전에 읽는다
    const turnStart = turnStarted[pane.id] ?? null;
    const wire = parseAgentStateWire(payload.agentState);
    if (wire !== null) adoptWire(pane.id, wire);
    const step = { completed: payload.completed === true, notify: payload.notify === true };
    const running = payload.event === "start" || payload.event === "tool" || payload.event === "tool-done";
    // 가림막이 덮고 있으면 활성 탭이라도 보이지 않는다 — 가려진 동안 끝난 턴은 "안 봄" 이다
    if (step.completed) {
      if (tab.id !== activeTabId() || veilVisible()) markAgentUnseen(pane.id);
      else clearAgentUnseen([pane.id]);
    } else if (running) clearAgentUnseen([pane.id]);
    if (payload.event === "start") {
      turnStarted[pane.id] = signals[pane.id]?.signalRunningAt ?? Date.now();
      turnBegan(pane);
    }
    if (payload.event === "tool-done") turnTool(pane.id);
    if (typeof payload.session === "string" && payload.session !== "") {
      const kind = agentKindOf(pane);
      if (kind) linkAgentSession(pane.id, kind, payload.session);
    }
    // 사람이 끊은 턴도 그 사이 파일을 바꿨을 수 있다
    if (payload.event === "stop" || payload.event === "interrupt" || step.completed) {
      scheduleConversationRefresh();
      refreshWorktreeChangesAfterTurn(pane);
      refreshPaneGitAfterTurn(pane.id);
    }
    noteHookVersion(pane, agentKindOf(pane), payload.hookVersion, payload.hookLatest);
    // 새 알림보다 먼저 — 권한 물음 뒤의 `stop` 은 권한 항목을 풀고 곧이어 끝남 항목이 선다
    agentBannerSignal(pane.id, payload.event);
    const notify = agentNotifyKind(payload.event, payload.detail) === "permission" ? "permission" : step.notify ? "stop" : null;
    // 알리지 않는 완료 · 권한 물음에서는 셈을 이어 간다 — 메인이 다시 돈 뒤의 `stop` 이 서브 에이전트의 도구까지 센다
    const count = step.notify ? turnEnded(pane.id) : notify ? turnSoFar(pane.id) : null;
    if (notify) {
      notifyAgent(pane, notify, agentKindOf(pane), turnStart === null ? null : Date.now() - turnStart, {
        tools: count?.tools ?? null,
        files: count?.files ?? null,
        conversation: agentLinkOf(pane.id),
      });
    }
    return true;
  }
  return false;
}

/** 분류를 새로 붙이지 않는다 — 끝남 신호로 AI 타일이 되면 안 된다 · Rust 표는 이미 항목을 지웠다 */
function agentCliEnded(pane: PaneSpec, payload: AgentSignalPayload): boolean {
  if (pane.kind !== "local" && pane.kind !== "ssh") return false;
  const wire = parseAgentStateWire(payload.agentState);
  if (wire !== null) adoptWire(pane.id, wire);
  if (!isAgentPane(pane)) return false;
  markAgentEnded(pane.id);
  clearSignalAttested(pane.id);
  unlinkAgentSession(pane.id);
  dropAgentBanner(pane.id);
  clearAgentUnseen([pane.id]);
  dropTurn(pane.id);
  delete turnStarted[pane.id];
  return true;
}

export function listenAgentSignals(): Promise<UnlistenFn> {
  return listen<AgentSignalPayload>("agent-signal", (ev) => {
    agentSignal(ev.payload);
    // 어느 창의 스트림이든 본다
    noteConversationSignal(ev.payload);
  });
}

export function agentSessionStart(paneId: string): void {
  agentSessionRestarted(paneId);
  clearSignalAttested(paneId);
  // 이 창의 표시만 지운다 — 이관으로 떠나는 `dropAgent` 도 여기를 지나므로 Rust 를 건드리면 안 된다.
  // seq 기억을 버려도 된다 — 표의 seq 는 전체 계수기라 다음 값이 늘 더 크다.
  seqOf.delete(paneId);
  commandRunning.delete(paneId);
  commandStartedAt.delete(paneId);
  lastOutput.delete(paneId);
  delete turnStarted[paneId];
  dropTurn(paneId);
  clearAgentUnseen([paneId]);
  if (!(paneId in signals)) return;
  delete signals[paneId];
  syncClock();
}

export function dropAgent(paneId: string): void {
  agentSessionStart(paneId);
  unlinkAgentSession(paneId);
  dropAgentBanner(paneId);
}

export function agentStatusOf(pane: PaneSpec): AgentStatus | null {
  const sig = signals[pane.id];
  return sig ? agentStatus(sig, now, hasAgentUnseen(pane.id)) : null;
}

/** 점이 없어도 산다 — 탭의 명령 점(`tabStatus`)이 이 타일의 `running` 을 접지 않는 기준이다 */
export function isLiveAgentPane(pane: PaneSpec): boolean {
  return isAgentPane(pane) && (signals[pane.id]?.exitedAt ?? null) === null;
}

export function agentSignalsOf(paneId: string): AgentSignals | null {
  return signals[paneId] ?? null;
}

export function agentSubagentsOf(paneId: string): number {
  return subagentCount(signals[paneId]);
}

/** 반응형이 아니다 — [`agentSignalsOf`] 와 같은 자리에서 바뀐다 */
export function agentSeqOf(paneId: string): number | null {
  return seqOf.get(paneId) ?? null;
}

export function agentTurnStartedAt(paneId: string): number | null {
  return turnStarted[paneId] ?? null;
}

/**
 * 점이 없는 AI 타일도 싣는다 — 그 탭의 활동 폴백을 가리는 근거다. 활성 탭도 계산한다(`tabStatus` · `tabBells` 와 다르다) —
 * 분할된 옆 타일의 에이전트가 손을 기다리는지는 화면만으로 바로 읽히지 않는다.
 */
export function tabAgents(): Record<string, TabDotAgent[]> {
  const out: Record<string, TabDotAgent[]> = {};
  for (const tab of residentWindowTabs()) {
    const agents = listPanes(tab.root)
      .filter(isLiveAgentPane)
      .map((pane) => {
        const kind = agentKindOf(pane) ?? "";
        const state = agentStatusOf(pane);
        return {
          name: aiDisplayName(kind) ?? kind,
          state,
          // 점 없이 수만 서지 않게
          subagents: state === null ? 0 : agentSubagentsOf(pane.id),
          paneId: pane.id,
        };
      });
    if (agents.length > 0) out[tab.id] = agents;
  }
  return out;
}

export function focusAgentIn(tabId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const agents = listPanes(tab.root).filter(isLiveAgentPane);
  const want = foldAgentStatus(agents.map(agentStatusOf));
  const target = (want !== null ? agents.find((p) => agentStatusOf(p) === want) : undefined) ?? agents[0];
  if (target) focusTile(tabId, target.id);
}
