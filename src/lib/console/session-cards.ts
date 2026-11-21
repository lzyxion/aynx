/** 대시보드 세션 칸 — 타일마다 카드 한 장(AI · 셸 · SSH 가 한 틀). 카드 = 이 창의 타일 + 헤드리스 위임 세션. */

import { subagentCount, type AgentStatus } from "$lib/agent-status";
import { agentCardText, type AgentTileInput, type AgentTime } from "$lib/agent-board";
import type { ConsoleState, RawStatus } from "./console-rows";
import type { GroupRow, HostGroup } from "./host-groups";
// 타입만 빌린다 — 둘 다 `invoke` 를 값으로 들이는 모듈이라 node 에서 못 읽는다.
import type { HostMeta } from "$lib/hosts";
import type { DelegationGrants } from "$lib/delegation";

/** 강조색은 `input` 에만 쓴다(강조색 = 선택 · 주 동작 · 입력 대기) */
export type CardState = "input" | "fail" | "running" | "idle" | "off";

export type CardKind = "ai" | "local" | "ssh" | "headless";

export interface SessionCard {
  /** streamId — 타일을 옮겨도 카드가 안 튄다 */
  key: string;
  kind: CardKind;
  /** 헤드리스는 `null` */
  tabId: string | null;
  paneId: string | null;
  state: CardState;
  agentStatus: AgentStatus | null;
  /** 점이 있을 때만 센다 — 점 없이 수만 서지 않게 */
  subagents: number;
  unseen: RawStatus;
  /** 헤드리스는 `null` — 이 모듈은 사전을 모르니 부르는 쪽이 채운다 */
  title: string | null;
  sub: string | null;
  code: string | null;
  ai: string | null;
  since: number | null;
  agentTime: AgentTime;
  command: string;
  commandShort: string;
  exit: number | null;
  running: boolean;
}

export interface CardGroup {
  /** `host-groups` 의 묶음 키 그대로(소문자 별칭 · 로컬 `local:`) */
  key: string;
  name: string;
  local: boolean;
  address: string | null;
  meta: HostMeta | null;
  delegated: boolean;
  grants: DelegationGrants | null;
  cards: SessionCard[];
}

export type SessionSummary = Record<CardState, number>;

export const CARD_STATES: readonly CardState[] = ["input", "fail", "running", "idle", "off"];

export interface SessionCardInput {
  groups: readonly HostGroup[];
  /** 여기 든 타일은 AI 카드가 된다 */
  agents: ReadonlyMap<string, AgentTileInput>;
  order: ReadonlyMap<string, number>;
  cwds: ReadonlyMap<string, string>;
  addresses: ReadonlyMap<string, string>;
}

export interface SessionBoard {
  groups: CardGroup[];
  summary: SessionSummary;
  total: number;
}

/** 안 본 결과는 성공이어도 실패와 같은 단 — 끊긴 카드는 안 본 결과가 있어도 끝이다 */
function cardRank(c: SessionCard): number {
  if (c.state === "input") return 0;
  if (c.state === "fail") return 1;
  if (c.state === "off") return 4;
  if (c.unseen !== null) return 1;
  return c.state === "running" ? 2 : 3;
}

/**
 * AI 타일에 점이 없으면 유휴다 — 셸에게 `claude` 는 늘 도는 명령이라 셸 상태를 따르면 기다리는 에이전트가 도는 것처럼 보인다.
 * 세션 판 · 상태바 · 워크스페이스 목록의 배지가 모두 이 함수를 지난다 — 같은 타일을 다른 상태로 부르지 않게.
 */
export function cardStateOf(rowState: ConsoleState, agent: AgentStatus | null, ai = agent !== null): CardState {
  if (rowState === "disconnected") return "off";
  if (!ai) {
    if (rowState === "working") return "running";
    if (rowState === "fail") return "fail";
    return "idle";
  }
  if (agent === "permission" || agent === "finished") return "input";
  if (agent === "running") return "running";
  return "idle";
}

function cardOf(row: GroupRow, group: HostGroup, input: SessionCardInput): SessionCard | null {
  const headless = row.kind === "headless";
  if (!headless && (row.tabId === null || row.paneId === null)) return null;
  const tile = row.paneId !== null ? input.agents.get(row.paneId) : undefined;
  const cwd = row.paneId !== null ? (input.cwds.get(row.paneId) ?? null) : null;
  const base = {
    key: row.id,
    tabId: row.tabId,
    paneId: row.paneId,
    unseen: row.attention,
    code: headless ? null : row.code,
    command: row.command,
    commandShort: row.commandShort,
    exit: row.exit,
    running: row.running,
  };
  if (tile) {
    const text = agentCardText(tile);
    const agentStatus = row.state === "disconnected" ? null : tile.status;
    return {
      ...base,
      kind: "ai",
      state: cardStateOf(row.state, tile.status, true),
      agentStatus,
      subagents: agentStatus === null ? 0 : subagentCount(tile.signals),
      title: text.title,
      sub: text.sub,
      ai: tile.ai,
      since: text.time?.at ?? row.since,
      agentTime: text.time,
    };
  }
  let title: string | null = null;
  if (row.kind === "local") title = row.label;
  else if (row.kind === "ssh") title = row.account ? `${row.account}@${group.name}` : row.label || group.name;
  return {
    ...base,
    kind: row.kind,
    state: cardStateOf(row.state, null),
    agentStatus: null,
    subagents: 0,
    title,
    sub: cwd,
    ai: null,
    since: row.since,
    agentTime: null,
  };
}

export function buildSessionCards(input: SessionCardInput): SessionBoard {
  const summary: SessionSummary = { input: 0, fail: 0, running: 0, idle: 0, off: 0 };
  const orderOf = (c: SessionCard): number =>
    c.paneId !== null ? (input.order.get(c.paneId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  const groups: CardGroup[] = [];
  for (const g of input.groups) {
    const cards: SessionCard[] = [];
    for (const row of g.rows) {
      const card = cardOf(row, g, input);
      if (card) cards.push(card);
    }
    if (cards.length === 0) continue;
    cards.sort(
      (a, b) =>
        cardRank(a) - cardRank(b) ||
        orderOf(a) - orderOf(b) ||
        (a.code ?? a.key).localeCompare(b.code ?? b.key) ||
        a.key.localeCompare(b.key),
    );
    for (const c of cards) summary[c.state] += 1;
    groups.push({
      key: g.key,
      name: g.name,
      local: g.local,
      address: g.local ? null : (input.addresses.get(g.key) ?? null),
      meta: g.meta,
      delegated: g.delegated,
      grants: g.grants,
      cards,
    });
  }

  const best = (g: CardGroup): number => Math.min(...g.cards.map(cardRank));
  groups.sort(
    (a, b) => Number(b.local) - Number(a.local) || best(a) - best(b) || a.name.localeCompare(b.name),
  );

  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  return { groups, summary, total };
}
