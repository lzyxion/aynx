/**
 * **탭의 상태 표식 하나** (docs/log/2026-09-26-tab-single-dot.md · 에이전트 점 셋은 docs/log/2026-10-01-agent-status-three.md ·
 * 모양 = M3 글리프 + 벨 합침은 docs/log/2026-11-03-tab-status-glyphs.md).
 *
 * 탭에는 한때 점이 둘 섰다 — 에이전트 점(`agentStatus`)과 명령 점(`tabStatus`, 없으면 활동 폴백).
 * 안 보는 탭에서 "권한 대기" 옆에 "명령 성공" 이 나란히 서면 어느 쪽이 탭의 말인지 읽는 데 한 박자가
 * 더 든다. 그래서 **한 자리에 하나**만 그리고, 이기는 것은 아래 우선순위다(높은 것 먼저):
 *
 *   1. 에이전트 권한 대기   — 손을 기다린다. 사람을 부르는 표식
 *   2. 에이전트 완료(안 봄) — 보이지 않는 사이 턴이 끝났다. 그 탭을 보면 사라진다
 *   3. 명령 실패
 *   4. 벨(안 봄)            — 예전엔 점 옆에 따로 선 고리였다. 한 자리에 하나 규칙으로 합쳤다(2026-11-03)
 *   5. 에이전트 실행 중
 *   6. 명령 실행 중
 *   7. 명령 성공
 *   8. 활동(폴백)
 *
 * 보이는 조건은 출처마다 그대로다: 에이전트 실행 중 · 권한 대기는 **지금의 상태**라 활성 탭에도 뜨고
 * (완료는 표식이 그 탭을 보는 순간 거둬지므로 안 보는 탭에만 선다), 명령·활동은 **안 본 결과**라 안 보는
 * 탭에만 뜬다(벨도 같다). 점이 없는 에이전트(`null` — 훅 신호가 없다 · 완료를 봤다)는 사실이 아니다.
 * 활동 폴백은 명령 상태가 없고 그 탭에 **살아 있는 AI 타일이 없을 때만** 사실로 친다 — 에이전트 TUI 는
 * 쉬지 않고 다시 그리므로(포커스 보고 · 크기 맞춤) 그 점은 늘 켜져 같은 말을 되풀이한다
 * (2026-09-24-agent-status-dot.md 의 09-26 덧붙임).
 *
 * 말풍선은 이긴 것 하나가 아니라 **그 탭의 사실 전부**를 우선순위 순으로 ` · ` 로 잇는다 —
 * 점은 하나로 접혀도 접힌 사실은 한 번 가리키면 읽힌다. 사실마다 **어느 타일의 말인지** 이름을
 * 단다: 에이전트는 에이전트 이름("Claude Code 권한 대기", 같은 이름·같은 상태가 둘이면
 * "Claude Code ×2 권한 대기"), 명령은 그 상태를 정한 타일의 이름("PowerShell 7 명령 실패", 다른
 * 타일에도 결과가 있으면 "… 외 N"). 활동은 탭 단위로만 기록돼 이름 없이 그대로다.
 *
 * **진행 중인 서브 에이전트**(docs/log/2026-10-04-subagent-signals.md)는 에이전트 사실에 수(`subagents`)로
 * 붙는다 — 같은 사실로 묶인 타일들의 합. 말풍선은 "Claude Code 실행 중 (서브 에이전트 2개 진행 중)", 그리는
 * 쪽은 이긴 사실의 수를 점 옆 작은 글자로 단다. 점의 우선순위는 바뀌지 않는다.
 *
 * 순수 모듈이다 — 모양(클래스)은 그리는 쪽(`Tabs.svelte`)이 `source`·`state` 로 고르고, 이름은
 * 부르는 쪽이 지어 넘긴다.
 */
import type { AgentStatus } from "$lib/agent-status";
import { findPane, type PaneSpec, type TabSpec, type Tr } from "$lib/session";
import type { PaneStatus } from "$lib/shell-integration";

/** 탭 안의 살아 있는 AI 타일 하나 — 보여 줄 에이전트 이름과 지금 점(없으면 `null`) */
export interface TabDotAgent {
  name: string;
  state: AgentStatus | null;
  /** 그 타일에서 진행 중인 서브 에이전트 수 — 없으면 0 (점이 없는 타일은 늘 0 으로 넘긴다) */
  subagents?: number;
  /** 그 타일의 패널 id — 이긴 사실이 에이전트면 탭 앞자리 아이콘이 이 타일을 따른다. 워크스페이스 접기처럼 모르면 비운다 */
  paneId?: string;
}

/** 탭의 명령 상태 — 접힌 값과, 그 값을 정한 타일의 이름 · 결과가 있는 다른 타일 수 */
export interface TabDotCommand {
  state: PaneStatus;
  name: string;
  others: number;
}

/** 점 하나가 말하는 사실 하나 */
export type TabDotFact =
  | { source: "agent"; state: AgentStatus; name: string; count: number; subagents: number; paneId?: string }
  | { source: "command"; state: PaneStatus; name: string; others: number }
  | { source: "bell" }
  | { source: "activity" };

export interface TabDotInput {
  /** 이 탭이 지금 보고 있는 탭인가 — 그러면 에이전트 상태만 뜬다 */
  active: boolean;
  /** 그 탭의 살아 있는 AI 타일들(화면 순서) — 점이 없는 것(`null`)도 넘긴다(활동 폴백을 가린다) */
  agents?: readonly TabDotAgent[];
  command?: TabDotCommand;
  /** 안 보는 사이 벨이 울렸다 — 명령·활동처럼 안 보는 탭에만 사실이다 */
  bell?: boolean;
  activity?: boolean;
}

/** 탭 줄과 세션 판이 같은 표식을 그리는 재료 — 탭 id 로 찾는 표들 */
export interface TabDotSources {
  activeId: string | null;
  agents: Readonly<Record<string, TabDotAgent[]>>;
  /** 명령 상태 — 접힌 값 · 그 값을 정한 타일 · 다른 타일 수 */
  status: Readonly<Record<string, { state: PaneStatus; paneId: string; others: number }>>;
  bells: Readonly<Record<string, boolean>>;
  activity: Readonly<Record<string, boolean>>;
  paneName: (pane: PaneSpec) => string;
}

/** 탭 하나의 표식 입력 — 탭 칸(`Tabs.svelte`)과 세션 판 탭 카드(`SessionSheet.svelte`)가 이 한 벌을 쓴다 */
export function tabDotInput(tab: Pick<TabSpec, "id" | "root">, s: TabDotSources): TabDotInput {
  const c = s.status[tab.id];
  const pane = c ? findPane(tab.root, c.paneId) : null;
  return {
    active: tab.id === s.activeId,
    agents: s.agents[tab.id],
    command: c ? { state: c.state, name: pane ? s.paneName(pane) : "", others: c.others } : undefined,
    bell: s.bells[tab.id],
    activity: s.activity[tab.id],
  };
}

export interface TabDot {
  /** 이긴 사실 — 점의 모양·색과 클릭(에이전트면 그 타일로)을 정한다 */
  winner: TabDotFact;
  /** 말풍선·`aria-label` — 사실 전부, 우선순위 순 */
  label: string;
}

/** 우선순위 — 작을수록 이긴다 (머리말의 1~8) */
function rank(f: TabDotFact): number {
  if (f.source === "agent") {
    if (f.state === "permission") return 1;
    if (f.state === "finished") return 2;
    return 5; // running
  }
  if (f.source === "command") {
    if (f.state === "fail") return 3;
    if (f.state === "running") return 6;
    return 7; // ok
  }
  if (f.source === "bell") return 4;
  return 8; // activity
}

/** "서브 에이전트 N개 진행 중" — 탭 점 말풍선 · 대시보드 카드의 수 말풍선이 같은 말을 쓴다 */
export function subagentsLabel(n: number, tr: Tr): string {
  return n === 1 ? tr("app.agent.subagents.one") : tr("app.agent.subagents.many", { n });
}

function factLabel(f: TabDotFact, tr: Tr): string {
  if (f.source === "agent") {
    const name = f.count > 1 ? `${f.name} ×${f.count}` : f.name;
    const fact = tr(`app.tabs.dot.agent.${f.state}`, { name });
    return f.subagents > 0 ? tr("app.tabs.dot.subagents", { fact, subagents: subagentsLabel(f.subagents, tr) }) : fact;
  }
  if (f.source === "command") {
    const name = f.others > 0 ? tr("app.tabs.dot.more", { name: f.name, n: f.others }) : f.name;
    return tr(`app.tabs.dot.command.${f.state}`, { name });
  }
  if (f.source === "bell") return tr("app.tabs.bell");
  return tr("app.tabs.activity.title");
}

/**
 * 그 탭에 지금 보이는 사실들 — 우선순위 순. 에이전트는 (상태 · 이름) 마다 한 사실로 묶는다 —
 * 같은 에이전트 둘이 같은 상태면 `count` 2. 우선순위의 에이전트 순서(권한 대기 > 완료 > 실행 중)가
 * `foldAgentStatus` 와 같아 이기는 점은 접힌 탭 상태와 같다.
 */
export function tabDotFacts(input: TabDotInput): TabDotFact[] {
  const facts: TabDotFact[] = [];
  const agentFacts = new Map<string, Extract<TabDotFact, { source: "agent" }>>();
  const agents = input.agents ?? [];
  for (const a of agents) {
    if (a.state === null) continue;
    const key = `${a.state}\u0000${a.name}`;
    const cur = agentFacts.get(key);
    const subagents = a.subagents ?? 0;
    // 묶음의 패널(`paneId`)은 화면 순서로 처음 것 — 점을 누를 때 가는 타일(`focusAgentIn`)과 같은 쪽이다
    if (cur) {
      cur.count++;
      cur.subagents += subagents;
    } else agentFacts.set(key, { source: "agent", state: a.state, name: a.name, count: 1, subagents, paneId: a.paneId });
  }
  facts.push(...agentFacts.values());
  if (!input.active) {
    if (input.bell) facts.push({ source: "bell" });
    if (input.command) facts.push({ source: "command", ...input.command });
    else if (input.activity && agents.length === 0) facts.push({ source: "activity" });
  }
  return facts.sort((a, b) => rank(a) - rank(b));
}

/**
 * 그 탭에 **완료(안 봄)** 가 있는가 — 탭 배경을 옅은 강조색으로 칠할지(`Tabs.svelte` 의 `.tab.unseen`).
 * 활성 탭은 이미 보고 있으므로 늘 거짓이다(표식도 그 탭을 보는 순간 거둬진다 — 이중 안전).
 */
export function tabHasUnseen(input: Pick<TabDotInput, "active" | "agents">): boolean {
  return !input.active && (input.agents ?? []).some((a) => a.state === "finished");
}

/** 탭의 점 하나 — 보일 사실이 없으면 `null`(점 없음) */
export function tabDot(input: TabDotInput, tr: Tr): TabDot | null {
  const facts = tabDotFacts(input);
  if (facts.length === 0) return null;
  return { winner: facts[0], label: facts.map((f) => factLabel(f, tr)).join(" · ") };
}

/** 여러 탭의 원시 사실을 같은 우선순위로 접는다(workspace는 활성 탭을 제외하지 않는다). */
export function foldTabDots(inputs: readonly TabDotInput[], tr: Tr): TabDot | null {
  const facts = inputs.flatMap(tabDotFacts).sort((a, b) => rank(a) - rank(b));
  return facts.length === 0 ? null : { winner: facts[0], label: facts.map((f) => factLabel(f, tr)).join(" · ") };
}
