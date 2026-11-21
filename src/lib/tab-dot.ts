/**
 * 탭의 상태 표식 하나 — 한 자리에 하나만 그리고, 이기는 것은 우선순위다(높은 것 먼저) (docs/log/2026-09-26-tab-single-dot.md ·
 * docs/log/2026-10-01-agent-status-three.md · docs/log/2026-11-03-tab-status-glyphs.md):
 *   1. 에이전트 권한 대기 · 2. 에이전트 완료(안 봄) · 3. 명령 실패 · 4. 벨(안 봄) · 5. 에이전트 실행 중 · 6. 명령 실행 중 ·
 *   7. 명령 성공 · 8. 활동(폴백)
 * 활동 폴백은 살아 있는 AI 타일이 없을 때만 사실로 친다 — 에이전트 TUI 는 쉬지 않고 다시 그려 그 점이 늘 켜진다.
 */
import type { AgentStatus } from "$lib/agent-status";
import { findPane, type PaneSpec, type TabSpec, type Tr } from "$lib/session";
import type { PaneStatus } from "$lib/shell-integration";

export interface TabDotAgent {
  name: string;
  state: AgentStatus | null;
  subagents?: number;
  /** 이긴 사실이 에이전트면 탭 앞자리 아이콘이 이 타일을 따른다. 모르면 비운다 */
  paneId?: string;
}

export interface TabDotCommand {
  state: PaneStatus;
  name: string;
  others: number;
}

export type TabDotFact =
  | { source: "agent"; state: AgentStatus; name: string; count: number; subagents: number; paneId?: string }
  | { source: "command"; state: PaneStatus; name: string; others: number }
  | { source: "bell" }
  | { source: "activity" };

export interface TabDotInput {
  /** 보고 있는 탭이면 에이전트 상태만 뜬다 */
  active: boolean;
  /** 점이 없는 것(`null`)도 넘긴다 — 활동 폴백을 가린다 */
  agents?: readonly TabDotAgent[];
  command?: TabDotCommand;
  bell?: boolean;
  activity?: boolean;
}

export interface TabDotSources {
  activeId: string | null;
  agents: Readonly<Record<string, TabDotAgent[]>>;
  status: Readonly<Record<string, { state: PaneStatus; paneId: string; others: number }>>;
  bells: Readonly<Record<string, boolean>>;
  activity: Readonly<Record<string, boolean>>;
  paneName: (pane: PaneSpec) => string;
}

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
  winner: TabDotFact;
  /** 사실 전부, 우선순위 순 */
  label: string;
}

/** 작을수록 이긴다 (머리말의 1~8) */
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

/** 에이전트 순서(권한 대기 > 완료 > 실행 중)가 `foldAgentStatus` 와 같아야 이기는 점이 접힌 탭 상태와 같다 */
export function tabDotFacts(input: TabDotInput): TabDotFact[] {
  const facts: TabDotFact[] = [];
  const agentFacts = new Map<string, Extract<TabDotFact, { source: "agent" }>>();
  const agents = input.agents ?? [];
  for (const a of agents) {
    if (a.state === null) continue;
    const key = `${a.state}\u0000${a.name}`;
    const cur = agentFacts.get(key);
    const subagents = a.subagents ?? 0;
    // 묶음의 패널은 화면 순서로 처음 것 — 점을 누를 때 가는 타일(`focusAgentIn`)과 같은 쪽이다
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

export function tabHasUnseen(input: Pick<TabDotInput, "active" | "agents">): boolean {
  return !input.active && (input.agents ?? []).some((a) => a.state === "finished");
}

export function tabDot(input: TabDotInput, tr: Tr): TabDot | null {
  const facts = tabDotFacts(input);
  if (facts.length === 0) return null;
  return { winner: facts[0], label: facts.map((f) => factLabel(f, tr)).join(" · ") };
}

/** 워크스페이스는 활성 탭을 빼지 않는다 */
export function foldTabDots(inputs: readonly TabDotInput[], tr: Tr): TabDot | null {
  const facts = inputs.flatMap(tabDotFacts).sort((a, b) => rank(a) - rank(b));
  return facts.length === 0 ? null : { winner: facts[0], label: facts.map((f) => factLabel(f, tr)).join(" · ") };
}
