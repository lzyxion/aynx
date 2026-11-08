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
 * **에이전트 상태 점의 저장소** — 타일별 훅 신호와 1초 시계 (docs/log/2026-10-01-agent-status-three.md ·
 * 처음 판 docs/log/2026-09-24-agent-status-dot.md).
 *
 * 규칙(신호 → 점 셋 · 없으면 `null`)은 순수 모듈 `$lib/agent-status` 에 있고, 여기는 신호를 **받아 두는**
 * 자리다. 점을 정하는 것은 Rust 의 `agent-signal` 이벤트(에이전트 훅 — [`listenAgentSignals`])와 세션 종료뿐이다.
 * `Terminal.svelte` 가 올리는 출력 · OSC 133 `C`/`A` 는 **점을 정하지 않는다** — 새 AI 타일이 붙여 넣기를
 * 받을 준비가 됐나(`agentLastOutputAt` · `agentCommandStartedAt`)와 에이전트가 끝나 셸로 돌아왔나
 * ([`agentPromptReturned`] — 타일 신원이 셸로 돌아간다)에만 쓰인다. 받는 쪽은 `Tabs.svelte` 의
 * 점([`tabAgents`])과 점 클릭([`focusAgentIn`]), 독 · 대시보드 · 상태바 칩.
 *
 * ## AI 타일만
 *
 * 보고 함수는 타일 명세를 받아 **여기서** AI 타일인지 가른다([`isAgentPane`]) — 판정을 다시
 * 짓지 않고 표시 층이 이미 쓰는 것을 빌린다: 로컬 · SSH 모두 `paneAi`(autorun → 도는 명령 → 제목 —
 * `$lib/pane-identity` 의 `aiOf`). 원격 셸에서 손으로 띄운 CLI 도 AI 타일이다(2026-10-07).
 * AI 가 아닌 타일의 신호는 받지 않는다 — 셸마다 계량기를 돌릴 이유가 없다.
 *
 * ## 상태의 권위는 Rust 표 (세션 서버 설계 9절 ① · 2026-10-08)
 *
 * 훅 신호의 **전이**(서브 에이전트 집합 · 완료 · 알림 판정)는 Rust `src-tauri/src/agent_state.rs` 가 한다.
 * 여기는 그 결과를 받아 적는다 — 부팅([`syncAgentStates`])·이관 재부착([`agentStateResumed`])에서 스냅숏, 그 뒤로는
 * `agent-signal` 페이로드의 `agentState`(+`seq`)를 그대로. 이미 본 seq 의 **상태**는 버린다(알림 · 배너 같은 곁일은
 * 이벤트마다 그대로 돈다 — 이 창이 그 이벤트를 처음 본 것이다). 점 판정(시효 · 안 봄)과 분류(`isAgentPane` ·
 * `admitHookSignal` · `attestedAgents`)는 그대로 창의 일이다.
 *
 * 지우기는 역할을 가른다: Rust 표는 **세션 단위**(새 세션 · 닫기 — `agent_signal::issue`/`revoke`)로 스스로 지우고,
 * 창만 보는 사건(새 CLI `C` · 셸 복귀 `A`)은 창이 [`forgetHookSignals`] 에서 Rust 에도 알린다(`agent_state_forget`).
 * 종료 표식(`exitedAt`)과 이 창의 표시 칸을 비우는 [`agentSessionStart`]·[`dropAgent`] 는 창의 표시만 지운다 —
 * 이관으로 떠나는 타일도 그 길을 지나므로 Rust 표를 건드리면 안 된다.
 *
 * ## 시계는 필요할 때만
 *
 * "실행 신호가 10분 묵었다"(`AGENT_SIGNAL_TTL_MS`)는 사건이 아니라 시간의 흐름이라 무엇인가 다시 계산을
 * 일으켜야 한다. 1초 시계를 두되 **신호를 든 타일이 하나라도 있을 때만** 돈다 — 에이전트를 안 쓰는
 * 사람의 앱은 아무것도 째깍이지 않는다.
 */

/** 타일 id → 훅 신호 · 종료 (AI 타일만 키가 있다) */
const signals = $state<Record<string, AgentSignals>>({});
/**
 * 타일 id → 마지막으로 적은 Rust 표의 seq — 스냅숏과 이벤트가 어느 순서로 와도 늦은 값이 이긴다([`acceptSeq`]).
 * 화면에 그릴 값이 아니라 반응형이 아니다.
 */
const seqOf = new Map<string, number>();
/**
 * 타일 id → **지금 턴이 시작된 시각**(훅 `start` = `UserPromptSubmit`). 대시보드 세션 칸 AI 카드의
 * "14분째" 가 이것을 읽는다(docs/log/2026-09-25-agent-board.md). 판정(`agentStatus`)은 이 값을
 * 쓰지 않는다 — 그래서 `AgentSignals` 에 넣지 않고 따로 둔다(순수 규칙의 입력이 늘지 않게).
 * 새 명령(`C`)·새 세션이 지운다 — 지난 에이전트의 턴을 새 CLI 에 물려주지 않는다.
 */
const turnStarted = $state<Record<string, number>>({});
/** 판정의 "지금" — 시계가 1초마다, 훅 신호가 올 때마다 밀어 올린다 */
let now = $state(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
/**
 * 에이전트 명령(OSC 133 `C`)이 돌기 시작했고 아직 프롬프트(`A`)로 돌아오지 않은 타일 —
 * [`agentPromptReturned`] 의 문지기. 세션이 막 열려 셸이 **처음** 그리는 프롬프트(autorun 을
 * 치기 전)는 이 표에 없어 "끝남" 으로 읽히지 않는다. 화면에 그릴 값이 아니라 반응형이 아니고,
 * 컴포넌트가 아니라 모듈에 있어 이관·재마운트를 건너 산다(도는 중에 탭을 떼어 가도 `/exit` 를 안다).
 */
const commandRunning = new Set<string>();
/**
 * 그 에이전트 명령(`C`)이 **시작된 시각** — 블록을 AI 타일에 넘기는 길이 "새로 연 AI 타일이 CLI 를 띄웠나" 를
 * 가르는 데 쓴다(`$lib/ask-ai` 의 `readyForPaste` · docs/log/2026-09-28-ask-ai-block.md). [`commandRunning`] 과
 * 같은 자리에서 적고 지운다 — 화면에 그릴 값이 아니라 반응형이 아니다.
 */
const commandStartedAt = new Map<string, number>();
/**
 * AI 타일의 **마지막 출력 시각** — 점을 정하지 않는다(docs/log/2026-10-01-agent-status-three.md). 읽는 곳 둘:
 * 새 AI 타일이 붙여 넣기를 받을 준비가 됐나(`$lib/ask-ai` 의 `readyForPaste` — CLI 가 그린 뒤 조용해졌나)와
 * 프롬프트 복귀의 문지기([`agentPromptReturned`] — 에이전트가 무엇이든 그린 뒤의 `A` 만 끝으로 센다).
 * 화면에 그릴 값이 아니라 반응형이 아니다 — 500ms 마다 오는 출력이 아무것도 다시 그리게 하지 않는다.
 */
const lastOutput = new Map<string, number>();

/**
 * 받아들인 훅 신호의 구독자 — 로컬 AI 타일의 로딩 덮개(`term/ai-veil.ts`)가 "CLI 가 섰다" 를 듣는다(Claude `SessionStart` →
 * `session`). 점 · 알림과 무관한 곁 귀라 반응형이 아니다.
 */
const hookListeners = new Set<(paneId: string, event: HookSignalEvent) => void>();

/** 이 창의 타일에 받아들인 훅 신호를 듣는다 — 돌려받은 함수로 그만 듣는다 */
export function onAgentHookSignal(fn: (paneId: string, event: HookSignalEvent) => void): () => void {
  hookListeners.add(fn);
  return () => void hookListeners.delete(fn);
}

/** 그 AI 타일에서 에이전트 명령이 시작된 시각 (돌고 있지 않거나 모르면 `null`) */
export function agentCommandStartedAt(paneId: string): number | null {
  return commandRunning.has(paneId) ? (commandStartedAt.get(paneId) ?? null) : null;
}

/** 시계를 켤지 끌지 — 신호를 든 타일이 있을 때만 돈다 */
function syncClock(): void {
  const need = Object.keys(signals).length > 0;
  if (need && clock === null) clock = setInterval(() => (now = Date.now()), 1000);
  else if (!need && clock !== null) {
    clearInterval(clock);
    clock = null;
  }
}

/**
 * 이 타일이 **에이전트 타일**인가 — 로컬 · SSH 모두 `paneAi`(autorun → 도는 명령 → 제목).
 * 반응형이다(②③ 갈래는 도는 명령·제목을 읽는다).
 */
export function isAgentPane(pane: PaneSpec): boolean {
  return agentKindOf(pane) !== null;
}

/**
 * 이 타일이 돌리는 **에이전트의 로고 이름**(`"claude"`·`"codex"`) — AI 타일이 아니면 `null`.
 * [`isAgentPane`] 의 몸통이다(판정이 한 벌). 상태바 칩의 배지 · 대시보드 카드의 로고가 읽는다
 * (docs/log/2026-09-26-agent-logo-badges.md). 반응형이다.
 */
export function agentKindOf(pane: PaneSpec): string | null {
  // 로컬 · SSH 가 같은 세 갈래(autorun → 도는 명령 → 제목 — `$lib/pane-identity` 의 `aiOf`). autorun 에이전트가
  // 끝났으면(프롬프트 복귀 · `markAgentEnded`) 그 갈래는 건너뛴다 — 원격 셸에서 손으로 띄운 CLI 도 AI 타일이다.
  if (pane.kind === "local" || pane.kind === "ssh") return paneAi(pane);
  return null;
}

/** 시각 한 칸을 적는다(세션 종료) — AI 타일인지는 부르는 쪽이 이미 갈랐다. 훅 신호는 [`record`] 가 적는다 */
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

/**
 * Rust 표의 항목 하나를 이 타일에 적는다 — 이미 본 seq 면 버린다(`false`). 재료가 없는 항목(`waiting` 의 `idle` 만
 * 받은 …)으로는 새 칸을 만들지 않는다. 종료 표식은 창의 것이라 그대로 둔다.
 */
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

/**
 * 스냅숏 한 줄을 그 스트림의 타일에 적는다 — 이벤트와 **같은 문지기**(`admitHookSignal`: AI 타일이거나 표가 `cli` 를
 * 안다)를 지난다. 곁일(알림 · 배너 · 안 봄)은 없다 — 지나간 사건을 다시 일으키지 않는다.
 */
function adoptSnapshotRow(stream: string, wire: AgentStateWire): void {
  const pane = paneForStream(stream)?.pane;
  if (!pane) return;
  if (pane.kind !== "local" && pane.kind !== "ssh") return;
  const admit = admitHookSignal(isAgentPane(pane), wire.cli);
  if (!admit.admit) return;
  if (admit.attest !== null) markSignalAttested(pane.id, admit.attest);
  adoptWire(pane.id, wire);
}

/** 이 스트림의 이 창 타일과 그 탭(사이드 채팅은 v2 부터 타일이 아니다 — 신호를 받지 않는다) */
function paneForStream(stream: string): { pane: PaneSpec; tab: TabSpec } | null {
  for (const tab of residentWindowTabs()) {
    const pane = findPaneByStream(tab.root, stream);
    if (pane) return { pane, tab };
  }
  return null;
}

/** Rust 표를 받아 이 창의 타일에 적는다(`onlyStream` 이면 그 스트림만) — 실패는 삼킨다(다음 신호가 채운다) */
async function pullAgentStates(onlyStream?: string): Promise<void> {
  const rows = parseAgentStatesSnapshot(await invoke<unknown>("agent_states_snapshot").catch(() => []));
  for (const [stream, wire] of rows) {
    if (onlyStream === undefined || stream === onlyStream) adoptSnapshotRow(stream, wire);
  }
}

/**
 * 부팅 — 이 창의 타일들의 에이전트 상태를 Rust 표에서 받아 채운다(새 창 · 떼어 낸 창). `boot` 가 탭을 세운 뒤 부른다.
 * `agent-signal` 을 이미 듣고 있어도 된다 — seq 가 가른다.
 */
export function syncAgentStates(): Promise<void> {
  return pullAgentStates();
}

/**
 * 다른 창에서 넘어온 타일이 살아 있는 세션에 다시 붙었다(`Terminal` 의 `resumeSession`) — 그 스트림의 상태를
 * Rust 표에서 받는다. 예전에는 다음 신호까지 점이 비었다(리뷰 R12).
 */
export function agentStateResumed(pane: PaneSpec): void {
  void pullAgentStates(pane.historyStreamId ?? pane.id);
}

/**
 * 출력이 왔다 — `Terminal` 이 500ms 에 한 번으로 줄여 올린다 (보고 있는 탭도). **점을 정하지 않는다** —
 * 포커스 보고 · 크기 맞춤의 다시 그리기도 출력이라 "실행 중" 으로 잘못 읽혔다
 * (docs/log/2026-10-01-agent-status-three.md). 시각만 [`lastOutput`] 에 둔다.
 */
export function agentOutput(pane: PaneSpec): void {
  if (isAgentPane(pane)) lastOutput.set(pane.id, Date.now());
}

/** 그 AI 타일의 마지막 출력 시각 (모르면 `null`) — 점을 정하지 않는다([`lastOutput`]) */
export function agentLastOutputAt(paneId: string): number | null {
  return lastOutput.get(paneId) ?? null;
}

/** 세션이 끝났다 — 재연결로 넘어가는 끊김은 끝이 아니다(`handleExit` 의 종료 갈래에서만) */
export function agentExit(pane: PaneSpec): void {
  if (isAgentPane(pane)) note(pane.id, "exitedAt");
  clearSignalAttested(pane.id); // 신호로 붙은 분류는 그 세션 것이다 — 끝나면 거둔다
  dropAgentBanner(pane.id); // 세션이 끝났다 — 그 타일의 배너는 저절로 해결
  clearAgentUnseen([pane.id]); // 끝남은 점이 없다 — 안 봄도 함께 거둔다
}

/**
 * 셸이 **명령을 시작했다** (OSC 133 `C`). AI 타일이면 "지금 에이전트가 돈다" 로 적어 두고, 지난 에이전트가
 * 남긴 훅 신호 · 안 봄은 버린다 — 같은 타일에서 `claude` 를 다시 쳤으면 새 CLI 는 자기 훅으로 다시 말한다.
 * `Terminal` 이 `oncommand` 보고(타일 신원이 도는 명령을 읽는 자리) **뒤에** 부른다.
 *
 * 타일 ↔ 대화 연결도 새 CLI 몫으로 비운다(`agentCliStarted` — 재개로 띄운 것은 남는다 · 2026-10-20). `replayed` 는 다시 붙기의 링
 * 재생(이미 지난 `C`)이라는 뜻 — 그때는 연결을 건드리지 않는다(F5 · 웹뷰 재부착이 명세 사본으로 다시 이은 연결이 산다).
 */
export function agentCommandStarted(pane: PaneSpec, replayed = false): void {
  if (!isAgentPane(pane)) return;
  if (!replayed) agentCliStarted(pane.id);
  commandRunning.add(pane.id);
  commandStartedAt.set(pane.id, Date.now());
  delete turnStarted[pane.id];
  dropTurn(pane.id);
  clearAgentUnseen([pane.id]); // 새 CLI — 지난 에이전트의 "안 봄" 을 물려주지 않는다
  forgetHookSignals(pane, replayed ? "replay" : "cli-start");
}

/**
 * 지난 에이전트가 남긴 훅 신호(진행 중 서브 에이전트 포함)를 버린다 — 종료 표식은 둔다(세션 단위다).
 * 이 사건(새 CLI · 셸 복귀)은 창만 보므로 **Rust 표에도 알린다** — 안 그러면 다음 신호의 전이가 옛 서브 에이전트
 * 집합을 이어받아 완료가 서지 않는다. 표는 그 스트림의 항목을 지우고, 다음 신호부터 새 seq 로 다시 선다.
 *
 * `cause` 는 그 사건 — 서버 장부의 **띄우며 적은 연결**(재개 autorun — `app/agent-sessions` 의 `linkResumedAutorun`)이 이것으로 갈린다:
 * `cli-start` 첫 번은 그 재개 명령 자신이라 남고 그 뒤는 놓이며, `replay`(링 재생)는 손대지 않고, `shell-return` 은 놓는다
 * (Rust `agent_state::ForgetCause`).
 */
/**
 * **대화 면 [중지]**(2026-11-02) — 그 타일 TUI 에 Esc 를 보낸 뒤 서버 표에 "사람이 끊음" 을 알린다(`agent_state_interrupt`). Claude 는 Esc 로
 * 끊을 때 훅이 하나도 오지 않아(실측) 실행 중 표시 · 탭 점이 다음 신호까지 남았다. 서버가 실행 · 권한 대기일 때만 `interrupt` 를 적고
 * `agent-signal` 로 방송한다 — 창 · 탭 점은 그 사건으로 풀린다(여기서 신호를 직접 고치지 않는다 · 상태의 권위는 서버 표). 다음 훅 신호(새
 * 프롬프트 · 도구)면 다시 실행이다. Codex 는 Esc 에 `Interrupt` 훅이 와(타일 장식) 같은 사건이 한 번 더 올 수 있다 — 끝난 뒤의 둘째는 서버가 버린다.
 */
export function noteAgentInterrupted(pane: PaneSpec): void {
  void invoke("agent_state_interrupt", { stream: pane.historyStreamId ?? pane.id }).catch(() => {});
}

function forgetHookSignals(pane: PaneSpec, cause: "cli-start" | "replay" | "shell-return"): void {
  void invoke("agent_state_forget", { stream: pane.historyStreamId ?? pane.id, cause }).catch(() => {});
  const cur = signals[pane.id];
  if (!cur) return;
  signals[pane.id] = forgetHook(cur);
}

/**
 * 셸 프롬프트가 **돌아왔다** (OSC 133 `A`) — 에이전트 CLI 가 끝나 셸로 돌아왔다
 * (docs/log/2026-09-24-agent-status-dot.md "끝남 — 프롬프트 복귀"). 에이전트 TUI 는 `A` 를 내지 않으므로
 * 에이전트 명령이 돈 뒤(`agentCommandStarted`)이고 그 에이전트가 출력을 낸 적이 있을 때의 `A` 만 센다 —
 * 세션이 막 열려 그리는 첫 프롬프트는 세지 않는다.
 *
 * 세는 순간 그 타일의 **신원이 셸로 돌아간다**([`markAgentEnded`]): autorun 은 "우리가 띄웠다" 는 사실이라
 * 에이전트가 끝나도 남아, 그대로 두면 헤더가 계속 "Claude Code" 라 읽힌다. 신원이 돌아가면 AI 타일이 아니므로
 * 점도 없다 — 남은 훅 신호 · 안 봄 · 턴도 함께 버린다.
 */
export function agentPromptReturned(pane: PaneSpec): void {
  if (!commandRunning.delete(pane.id)) return;
  commandStartedAt.delete(pane.id);
  if (!isAgentPane(pane) || !lastOutput.has(pane.id)) return;
  markAgentEnded(pane.id);
  clearSignalAttested(pane.id); // 셸로 돌아왔다 — 신호로 붙은 분류도 거둔다
  unlinkAgentSession(pane.id); // 그 대화는 이 타일에서 끝났다
  forgetHookSignals(pane, "shell-return");
  clearAgentUnseen([pane.id]);
  dropTurn(pane.id);
  delete turnStarted[pane.id];
}

/** Rust `agent-signal` 이벤트의 페이로드 (`src-tauri/src/agent_signal.rs` 의 `payload`) */
export interface AgentSignalPayload {
  /** 타일의 스트림 id (`AYNX_STREAM` = `historyStreamId ?? id`) */
  stream: string;
  event: HookSignalEvent;
  /**
   * `waiting` 의 범주(`permission` · `idle` · `other`) — Rust 가 이 셋 밖의 값은 버린다
   * (`agent_signal::WAITING_DETAILS`). 옛 훅 스크립트는 싣지 않는다.
   */
  detail?: string | null;
  /** Rust 가 받은 시각(epoch ms) — 판정은 다른 신호와 같은 시계(`Date.now()`)로 적는다 */
  at?: number;
  /**
   * 에이전트의 **대화 id** — 훅 스크립트 4판이 `start`·`stop` 에 싣는다(Rust 가 UUID 모양만 통과시킨다 ·
   * docs/log/2026-09-26-agent-sessions.md). 옛 스크립트는 없다(Codex 는 `--no-daemon` 으로 돌 때 온다).
   */
  session?: string | null;
  /**
   * 보낸 훅 스크립트의 판 — 5판부터 싣는다. 없으면(`null`) 4판 이하다
   * (docs/log/2026-09-27-remote-hook-version.md).
   */
  hookVersion?: number | null;
  /** 이 앱이 설치하는 판(Rust `agent_hooks::SCRIPT_VERSION`) — 이것과 견줘 옛 판을 알린다 */
  hookLatest?: number | null;
  /** Rust 표가 매긴 순번(`agent_state`) — `agentState.seq` 와 같다 */
  seq?: number;
  /** 전이 결과(시효 · 안 봄 전) — 정보용이다. 점은 `agentState` 의 재료로 `agentStatus` 가 정한다 */
  state?: AgentStatus | null;
  /** Rust 표의 항목 전체 — 이 창이 적는 값(`AgentStateWire`) */
  agentState?: unknown;
  /** 이 신호로 완료가 섰다(Rust 전이) */
  completed?: boolean;
  /** 그 완료를 알린다(Rust 전이의 답 — 메인의 `stop` 으로 선 완료만) */
  notify?: boolean;
  /**
   * **서브 에이전트 id** — 훅 스크립트 6판이 `subagent-start`·`subagent-stop` 에 싣는다(Rust 가 영숫자·`_`·`-`
   * 64자만 통과시킨다 · docs/log/2026-10-04-subagent-signals.md). 없으면 그 서브 에이전트 신호는 세지 않는다.
   */
  agent?: string | null;
  /**
   * **어느 CLI 의 훅인가**(`claude`·`codex`) — 훅 스크립트 8판이 모든 신호에 싣는다(Rust 가 둘만 통과시킨다 ·
   * `agent_signal::CLI_IDS`). 분류되지 않은 타일을 그 CLI 의 타일로 치는 근거다([`agentSignal`]). 옛 스크립트는 없다.
   */
  cli?: string | null;
}

/**
 * **에이전트 훅 신호** 하나를 받는다 (docs/log/2026-09-24-agent-hook-signals.md).
 *
 * `start`·`tool`·`tool-done`(도구가 끝났다 — 승인한 도구 포함) → 실행, `waiting` 중 범주 `permission`
 * (권한 물음) → 권한, `stop`(턴 끝, 프롬프트가 떴다) → 끝 — 가르는 것은 순수 층의 [`hookSignalKey`].
 * `waiting` 의 `idle`·`other`(한참 입력 대기)는 점을 바꾸지 않는다 — 알림 · 배너 같은 나머지 일은 그대로
 * 지난다. 점은 이 신호로만 정해진다(docs/log/2026-10-01-agent-status-three.md).
 *
 * 원격(SSH) 타일의 훅도 같은 이벤트로 온다 — 서버의 원격 포워드를 지나 이 PC 의 `/agent-signal` 에
 * 닿는다(docs/log/2026-09-24-remote-agent-signals.md). 창은 로컬·원격을 가리지 않는다.
 *
 * 이벤트는 **모든 창에 방송**되고 저장소는 창마다 하나라, 스트림이 이 창의 타일이 아니면 조용히
 * 버린다(그 타일을 쥔 창이 받는다 — 탭을 떼어 가도 스트림 id 는 따라간다). AI 타일이 아니면
 * [`note`] 가 버린다. 돌려주는 값은 받았는가 — 하네스가 본다.
 *
 * **완료**(`stop` 인데 진행 중인 서브 에이전트가 없다 · 메인이 멈춘 뒤 마지막 `subagent-stop`)면 점이 완료가 되고, 메인의
 * `stop` 으로 선 완료면 **알림**도 한 번 낸다([`notifyAgent`] — docs/log/2026-09-25-agent-stop-notify.md · 서브 에이전트의 끝은
 * 알리지 않는다 — 메인이 결과를 받아 다시 돌고 그 `stop` 이 알린다, 2026-10-21). 완료 · 알림 판정은
 * Rust 표의 전이 `agent_state::apply` 다(페이로드의 `completed`·`notify` — 규칙 명세는 순수 층 `stepHookSignal`)(docs/log/2026-10-04-subagent-signals.md) — 서브 에이전트가 도는 동안의 `stop`
 * 은 점을 실행 중에 두고 알리지 않는다.
 * 여기서 부르면 방송을 받는 창 중 그 타일을 쥔 창 하나에서만 뜬다. `waiting` 은 범주가 `permission`
 * (권한 물음)일 때만 알린다 — 같은 `Notification` 훅이 `stop` 뒤 한참 입력이 없을 때(`idle`)도 울려,
 * 그것까지 알리면 한 턴에 두 번 온다(`agentNotifyKind` · docs/log/2026-09-25-shell-claude-signals.md).
 *
 * 평범한 셸 타일(AI 타일로 열지 않은 것)에서 손으로 친 `claude` 도 여기로 온다 — 모든 로컬 타일이
 * 신호 전용 토큰을 받는다. 그 타일이 에이전트 타일로 읽히는 근거는 `isAgentPane`(로컬은 OSC 133 의
 * 도는 명령 · 제목)이고, 셸 통합이 없는 셸(cmd.exe)은 제목이 "Claude Code" 가 아니면 버려진다.
 * 원격도 같다 — 호스트의 에이전트 활성화가 켜졌으면 그 호스트의 모든 원격 타일이 신호 토큰을 받는다(2026-10-27 · 판정은
 * 세션 서버 Rust `ssh::open::signal_stream` — 호스트 AI 권한은 관여하지 않는다). 그런 타일이 아직 AI 로 분류되지 않았어도 신호가 `cli`(스크립트 8판)를 실었으면 그 CLI 의
 * 타일로 친다(`$lib/pane-identity` 의 ③′ — tmux 안의 `codex` 는 제목이 폴더 이름이라 다른 갈래로는 못 알아본다).
 * `cli` 없는 옛 신호는 분류된 **뒤의** 것만 잡힌다.
 */
export function agentSignal(payload: AgentSignalPayload): boolean {
  if (!isHookSignalEvent(payload.event) || typeof payload.stream !== "string") return false;
  const found = paneForStream(payload.stream);
  if (found) {
    const { pane, tab } = found;
    if (payload.event === "session-end") return agentCliEnded(pane, payload);
    // 분류되지 않은 타일이라도 신호가 **어느 CLI 인지** 밝혔으면(스크립트 8판 `cli`) 그 CLI 의 타일로 치고 받는다 —
    // 신호 토큰은 이 타일의 스트림에만 통한다(2026-10-08 · tmux 안에서 손으로 띄운 `codex`). `cli` 없는 옛 신호는 버린다.
    // 표식은 이관 짐에 싣지 않는다 — 넘어간 창에는 다음 신호가 다시 붙인다.
    if (pane.kind !== "local" && pane.kind !== "ssh") return false;
    const admit = admitHookSignal(isAgentPane(pane), payload.cli);
    if (!admit.admit) return false;
    if (admit.attest !== null) markSignalAttested(pane.id, admit.attest);
    for (const fn of hookListeners) fn(pane.id, payload.event);
    // 이번 턴의 길이 — 알림(보고 있는 타일도 긴 턴이면 알린다)이 읽는다. `start` 가 새 시각을 적기 **전**에 읽는다.
    const turnStart = turnStarted[pane.id] ?? null;
    // 상태는 Rust 표가 셈한 값을 그대로 적는다(이미 본 seq 면 상태만 건너뛴다 — 곁일은 이 창이 처음 보는 사건이라 돈다).
    // 완료 · 알림도 Rust 전이의 답이다.
    const wire = parseAgentStateWire(payload.agentState);
    if (wire !== null) adoptWire(pane.id, wire);
    const step = { completed: payload.completed === true, notify: payload.notify === true };
    const running = payload.event === "start" || payload.event === "tool" || payload.event === "tool-done";
    // **완료 · 안 봄** — 완료가 보이지 않는 타일에서 섰으면 표식을 붙이고(점 "완료"), 보이는 타일이면 처음부터
    // 서지 않는다. 새 턴(`start`·`tool`·`tool-done`)이 서면 거둔다. 권한 물음 · `idle` · 서브 에이전트가 도는 동안의
    // `stop` 은 건드리지 않는다. "보인다" 는 벨과 같은 말이다 — 그 타일이 이 창의 활성 탭에 있다.
    // **가림막이 덮고 있으면 보이지 않는다**(2026-10-07 실기) — 활성 탭이라도 가려진 동안 끝난 턴은 "안 봄" 이라
    // 가림막의 대기 중 수에 들고, 걷은 뒤에도 완료 점이 남는다.
    if (step.completed) {
      if (tab.id !== activeTabId() || veilVisible()) markAgentUnseen(pane.id);
      else clearAgentUnseen([pane.id]);
    } else if (running) clearAgentUnseen([pane.id]);
    if (payload.event === "start") {
      turnStarted[pane.id] = signals[pane.id]?.signalRunningAt ?? Date.now();
      turnBegan(pane); // 메신저 둘째 줄의 셈(도구 수 · 변경 도장) — `app/agent-turn`
    }
    if (payload.event === "tool-done") turnTool(pane.id);
    // 4판 훅은 `start`·`stop` 에 대화 id 를 싣는다 — 이 타일 = 이 대화 (지난 대화 목록의 "열림").
    if (typeof payload.session === "string" && payload.session !== "") {
      const kind = agentKindOf(pane);
      if (kind) linkAgentSession(pane.id, kind, payload.session);
    }
    // 사람이 끊은 턴(`interrupt` — 2026-11-02)도 그 사이 파일을 바꿨을 수 있다
    if (payload.event === "stop" || payload.event === "interrupt" || step.completed) {
      scheduleConversationRefresh();
      // 그 워크트리의 변경 배지를 한 번 다시 읽는다(턴이 파일을 바꿨을 것이다 — docs/log/2026-09-29-worktree-badges.md).
      refreshWorktreeChangesAfterTurn(pane);
      // 머리줄 브랜치 칩도 한 번 — 턴이 브랜치를 바꿨을 수 있다(`app/pane-git`)
      refreshPaneGitAfterTurn(pane.id);
    }
    // 옛 판 스크립트 — 그 호스트에 한 번 다시 설치를 권한다(원격은 아무도 갈아 쓰지 않는다). 신호는 그대로 받는다.
    noteHookVersion(pane, agentKindOf(pane), payload.hookVersion, payload.hookLatest);
    // 배너 — 에이전트가 넘어갔으면 그 타일의 알림이 저절로 풀린다(새 턴 · 답한 권한). 새 알림보다 **먼저**:
    // 권한 물음 뒤의 `stop` 은 권한 항목을 풀고 곧이어 끝남 항목이 선다(docs/log/2026-09-27-agent-banners.md).
    agentBannerSignal(pane.id, payload.event);
    // 권한 물음은 그대로 알리고, 턴 끝은 **메인의 `stop` 으로 선 완료**일 때만(`step.notify`).
    const notify = agentNotifyKind(payload.event, payload.detail) === "permission" ? "permission" : step.notify ? "stop" : null;
    // 턴의 셈 — 알리는 완료면 꺼내고 지운다. 서브 에이전트로 선(알리지 않는) 완료 · 서브 에이전트가 도는 동안의
    // `stop` · 권한 물음은 이어진다(메인이 결과를 받아 다시 돈 뒤의 `stop` 이 서브 에이전트의 도구까지 센다 —
    // 메인이 다시 돌지 않으면 다음 `start` 가 새로 센다)
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

/**
 * CLI 가 끝났다(훅 9판 `session-end` — 2026-10-08). 셸 복귀 표식(OSC 133 `A`)이 없는 tmux 타일도 이것으로 "CLI 나감" 을 안다 —
 * 예전에는 tmux 안에서 CLI 를 나가도 세션이 끝날 때까지 AI 로 보였다. 셸 복귀([`agentPromptReturned`])와 같은 정리를 하되
 * Rust 표는 이미 항목을 지웠다(알리지 않는다). **분류를 새로 붙이지 않는다** — 끝남 신호로 AI 타일이 되면 안 된다.
 */
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

/** `agent-signal` 을 듣는다 — 창마다(메인·떼어 낸 창) `mountAppListeners` 가 건다. */
export function listenAgentSignals(): Promise<UnlistenFn> {
  return listen<AgentSignalPayload>("agent-signal", (ev) => {
    agentSignal(ev.payload);
    // 어느 창의 스트림이든 — 지난 대화의 "열림" 장부(세션 서버)가 바뀌었을 사건이면 다시 읽는다
    noteConversationSignal(ev.payload);
  });
}

/** 새 세션이 섰다(첫 접속·재연결·종료 뒤 다시 붙기) — 옛 세션의 신호를 버리고 처음부터 본다 */
export function agentSessionStart(paneId: string): void {
  agentSessionRestarted(paneId);
  clearSignalAttested(paneId); // 신호로 붙은 분류는 옛 세션 것이다
  // 이 창의 표시만 지운다 — Rust 표는 새 세션의 토큰 발급에서 스스로 비웠다(이관으로 떠나는 `dropAgent` 도 여기를
  // 지나므로 Rust 를 건드리면 안 된다). seq 기억도 버린다 — 표의 seq 는 전체 계수기라 다음 값이 늘 더 크다.
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

/** 타일이 사라졌다 — 신호를 버린다 (`dropBell` 과 같은 자리) */
export function dropAgent(paneId: string): void {
  agentSessionStart(paneId);
  unlinkAgentSession(paneId);
  dropAgentBanner(paneId); // 타일이 사라졌다(닫힘 · 다른 창으로 떠남) — 배너는 저절로 해결
}

/**
 * 한 타일의 지금 점 — 없으면 `null`(훅 신호가 없다 · 완료를 이미 봤다 · 실행 신호가 시효를 넘겼다 · 세션이
 * 끝났다). AI 타일인지는 부르는 쪽이 가른다. 반응형이다.
 */
export function agentStatusOf(pane: PaneSpec): AgentStatus | null {
  const sig = signals[pane.id];
  return sig ? agentStatus(sig, now, hasAgentUnseen(pane.id)) : null;
}

/**
 * 에이전트가 **살아 있는** 타일인가 — AI 타일이고 세션이 끝나지 않았다(점이 없어도 산다). 탭의 명령 점
 * (`tabStatus`)이 이 타일의 `running` 을 접지 않는 기준이고(docs/log/2026-09-24-agent-status-dot.md
 * 2026-09-26 덧붙임), 탭 · 상태바 칩이 "이 타일은 에이전트" 라 세는 선이다. 에이전트 CLI 가 끝나 셸로
 * 돌아온 타일은 신원이 셸로 돌아가 `isAgentPane` 에서 이미 빠진다([`agentPromptReturned`]).
 */
export function isLiveAgentPane(pane: PaneSpec): boolean {
  return isAgentPane(pane) && (signals[pane.id]?.exitedAt ?? null) === null;
}

/**
 * 한 타일의 **신호 사본**(없으면 `null`) — 대시보드 세션 칸의 AI 카드가 "몇 분 전" 을 고르는 재료다
 * (`$lib/agent-board` 의 `agentTime`). 반응형으로 읽힌다.
 */
export function agentSignalsOf(paneId: string): AgentSignals | null {
  return signals[paneId] ?? null;
}

/**
 * 그 타일에서 **진행 중인 서브 에이전트 수** — 훅 `subagent-start`·`subagent-stop` 으로 센다
 * (docs/log/2026-10-04-subagent-signals.md). 탭 점 · 대시보드 카드가 점 옆 작은 수로 그린다. 반응형이다.
 */
export function agentSubagentsOf(paneId: string): number {
  return subagentCount(signals[paneId]);
}

/** 그 타일에 마지막으로 적은 Rust 표의 seq — 모르면 `null`(옛 서버 · 아직 신호 없음). 반응형이 아니다 — [`agentSignalsOf`] 와 같은 자리에서 바뀐다 */
export function agentSeqOf(paneId: string): number | null {
  return seqOf.get(paneId) ?? null;
}

/** 그 타일의 지금 턴이 시작된 시각(훅 `start`) — 모르면 `null` */
export function agentTurnStartedAt(paneId: string): number | null {
  return turnStarted[paneId] ?? null;
}

/**
 * 탭 id → 그 탭의 **살아 있는** AI 타일들(화면 순서) — 에이전트 이름과 지금 점(없으면 `null`). 접기(권한 대기 >
 * 완료 > 실행 중)는 탭 점(`$lib/tab-dot`)이 하고, 말풍선이 이름으로 어느 타일인지 밝힌다
 * (docs/log/2026-09-26-tab-single-dot.md). 점이 없는 AI 타일도 싣는다 — 그 탭의 활동 폴백을 가리는 근거다.
 * AI 타일이 없는 탭은 키가 없다.
 *
 * **활성 탭도 계산한다** — `tabStatus`·`tabBells` 와 다른 점이다. 실행 중 · 권한 대기는 **지금의 상태**다:
 * 보고 있는 탭 안에도 타일이 여럿이고, 분할된 옆 타일의 에이전트가 손을 기다리는지는 화면만으로 바로
 * 읽히지 않는다. 완료는 안 본 탭에만 선다(그 탭을 보는 순간 표식이 거둬진다).
 */
export function tabAgents(): Record<string, TabDotAgent[]> {
  const out: Record<string, TabDotAgent[]> = {};
  for (const tab of residentWindowTabs()) {
    const agents = listPanes(tab.root)
      .filter(isLiveAgentPane)
      .map((pane) => {
        const kind = agentKindOf(pane) ?? "";
        const state = agentStatusOf(pane);
        // 진행 중 서브 에이전트 수는 점이 있을 때만 싣는다(점 없이 수만 서지 않게)
        return {
          name: aiDisplayName(kind) ?? kind,
          state,
          subagents: state === null ? 0 : agentSubagentsOf(pane.id),
          paneId: pane.id, // 이긴 에이전트 사실이면 탭 앞자리 아이콘이 이 타일을 따른다
        };
      });
    if (agents.length > 0) out[tab.id] = agents;
  }
  return out;
}

/**
 * 점을 눌렀다 — 그 탭에서 **점과 같은 상태**인 첫 AI 타일로 간다(벨·완료 토스트의 "보기" 와 같은
 * `focusTile`). 권한 대기 > 완료 > 실행 중 순이라 손을 기다리는 그 타일로 곧장 간다.
 */
export function focusAgentIn(tabId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab) return;
  const agents = listPanes(tab.root).filter(isLiveAgentPane);
  const want = foldAgentStatus(agents.map(agentStatusOf));
  const target = (want !== null ? agents.find((p) => agentStatusOf(p) === want) : undefined) ?? agents[0];
  if (target) focusTile(tabId, target.id);
}
