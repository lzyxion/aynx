/**
 * 대시보드 **세션 칸 — 타일마다 카드 한 장** (docs/log/2026-09-28-dashboard-session-cards.md).
 *
 * 앞선 판에는 같은 타일을 말하는 자리가 둘이었다: 에이전트 칸의 **에이전트 카드**(AI 타일만 —
 * `$lib/agent-board`)와 세션 칸 **목록 모드의 줄**(세션이 있는 타일 전부 — `./host-groups`). AI 타일은
 * 두 곳에 다른 말로 나왔고, 셸 타일은 한 곳에만 나왔다. 이제 **카드 한 틀**이다: AI 타일과 셸·SSH
 * 타일이 같은 상자 · 같은 상태 점 · 같은 순서 규칙을 쓰고, 다른 것은 아이콘과 맨 아랫줄뿐이다.
 *
 * ## 재료는 이미 있는 것만
 *
 * - **묶음** — [`groupSessions`](./host-groups.ts) 의 결과 그대로(묶는 축 · 중복 제거 · 안 붙은 위임을
 *   버리는 규칙이 그 한 곳에 있다). 여기서는 **다른 창의 타일 줄을 뺀다** — 카드 = 이 창의 타일(누르면
 *   그 타일로 간다)이고, 헤드리스 위임 세션만 예외로 점선 카드가 된다(누를 곳이 없다).
 * - **셸 상태** — 줄의 4상태(`synthState` 가 이미 합성한 값).
 * - **AI 상태** — `agentStatusOf` 의 점 셋 또는 `null`(탭 점과 같은 규칙 — docs/log/2026-10-01-agent-status-three.md).
 *   여기서는 카드의 다섯 상태로 옮기기만 한다.
 * - **AI 글자** — [`agentCardText`](../agent-board.ts)(프로젝트 · 워크트리 · 상태에 맞는 시각).
 *
 * 룬도 DOM 도 `invoke` 도 없다 — node vitest 로 바로 테스트한다.
 */

import { subagentCount, type AgentStatus } from "$lib/agent-status";
import { agentCardText, type AgentTileInput, type AgentTime } from "$lib/agent-board";
import type { ConsoleState, RawStatus } from "./console-rows";
import type { GroupRow, HostGroup } from "./host-groups";
// **타입만** 빌린다 — 둘 다 `invoke` 를 값으로 들이는 모듈이라 node 에서 못 읽는다.
import type { HostMeta } from "$lib/hosts";
import type { DelegationGrants } from "$lib/delegation";

/**
 * 카드의 **다섯 상태** — 요약 알약과 점이 같은 말을 쓴다.
 *
 * - `input` — 입력 대기(AI 가 손을 넘겼다 — 권한 대기 · 완료). **강조색은 여기에만** 쓴다(디자인 규칙:
 *   강조색 = 선택 · 주 동작 · 입력 대기). 카드 한 장의 글자와 점은 그 둘을 가른다(`agentStatus` — 세션 판의 칸 · 칩에서
 *   강조색 면은 권한 대기만이고 완료는 초록 면이다 · `tab-map.ts` 의 `cellFace`).
 * - `fail` — 마지막 명령이 0 아닌 코드로 끝났다(AI 는 에이전트가 끝났고 셸이 실패를 알렸을 때).
 * - `running` — 명령이 돌고 있다 / AI 턴이 진행 중이다.
 * - `idle` — 붙어 있고 조용하다(AI 타일인데 점이 없는 것도 여기).
 * - `off` — 세션이 없다(끊김).
 */
export type CardState = "input" | "fail" | "running" | "idle" | "off";

/** 카드의 종류 — 아이콘과 맨 아랫줄이 갈린다 */
export type CardKind = "ai" | "local" | "ssh" | "headless";

/** 카드 한 장 */
export interface SessionCard {
  /** 키 = streamId (타일을 옮겨도 카드가 안 튄다) */
  key: string;
  kind: CardKind;
  /** 누르면 갈 타일 — 헤드리스는 `null`(누를 곳이 없다) */
  tabId: string | null;
  paneId: string | null;
  state: CardState;
  /**
   * AI 카드의 점(권한 대기 · 완료 · 실행 중 — 없으면 `null`). 아랫줄 문구 · 상태 글자가
   * 읽는다. 셸 카드는 늘 `null`.
   */
  agentStatus: AgentStatus | null;
  /**
   * AI 카드의 **진행 중 서브 에이전트 수** — 점이 있을 때만 센다(점 없이 수만 서지 않게). 셸 카드는 0
   * (docs/log/2026-10-04-subagent-signals.md).
   */
  subagents: number;
  /** 안 본 결과(비활성 탭에서 끝난 명령) — "안 봄" 표식. 이 창의 타일만 가진다 */
  unseen: RawStatus;
  /**
   * 첫 줄. AI 는 프로젝트(모르면 탭 제목), SSH 는 `계정@호스트`(계정을 모르면 별칭), 로컬은 셸 이름.
   * 헤드리스는 `null` — 부르는 쪽이 사전의 "헤드리스" 로 채운다(이 모듈은 사전을 모른다).
   */
  title: string | null;
  /** 둘째 줄(고정폭) — AI 는 워크트리, 셸은 폴더. 모르면 `null` */
  sub: string | null;
  /** 신원 코드(`t1·p2`) — 헤드리스는 `null`(별칭이 이미 묶음 이름이다) */
  code: string | null;
  /** 에이전트 로고 이름 — AI 카드만 */
  ai: string | null;
  /** 상태 줄 오른쪽 경과의 기준 시각 — 모르면 `null` */
  since: number | null;
  /** AI 카드의 시각(무슨 시각인가까지) — 아랫줄 문구가 읽는다. 셸 카드는 `null` */
  agentTime: AgentTime;
  /** 도는(또는 마지막) 명령 · 표 한 칸 길이로 자른 것 · 종료 코드 — 셸·헤드리스 카드의 아랫줄 */
  command: string;
  commandShort: string;
  exit: number | null;
  /** 명령이 지금 도는가 — 도는 중이면 종료 코드 자리는 비어 있다 */
  running: boolean;
}

/** 호스트 하나 = 머리줄 + 카드들 */
export interface CardGroup {
  /** `host-groups` 의 묶음 키 그대로 (소문자 별칭 · 로컬 `local:`) */
  key: string;
  name: string;
  local: boolean;
  /** 머리줄의 `user@HostName` — 모르면 `null` */
  address: string | null;
  meta: HostMeta | null;
  /** 접속 위임이 적힌 호스트인가 (`AI 위임` 칩) */
  delegated: boolean;
  grants: DelegationGrants | null;
  cards: SessionCard[];
}

/** 위 요약 줄 — 상태마다 카드 수 (0 인 알약은 부르는 쪽이 그리지 않는다) */
export type SessionSummary = Record<CardState, number>;

/** 요약 알약의 순서 — 묶음 안 카드 순서와 같은 말이다 */
export const CARD_STATES: readonly CardState[] = ["input", "fail", "running", "idle", "off"];

/** [`buildSessionCards`] 의 재료 */
export interface SessionCardInput {
  /** `groupSessions` 의 결과 (이 창의 타일 + 앱 전역 세션 뷰를 호스트로 묶은 것) */
  groups: readonly HostGroup[];
  /** 이 창의 AI 타일 — `paneId` → 재료. 여기 든 타일은 AI 카드가 된다 */
  agents: ReadonlyMap<string, AgentTileInput>;
  /** 화면 순서(탭 순 · 탭 안 왼쪽/위 먼저) — `paneId` → 순번. 같은 순위끼리의 마지막 기준 */
  order: ReadonlyMap<string, number>;
  /** 타일의 폴더 — `paneId` → 셸이 알린 폴더(없으면 시작 폴더). 모르면 없다 */
  cwds: ReadonlyMap<string, string>;
  /** 소문자 별칭 → `user@HostName` (머리줄) */
  addresses: ReadonlyMap<string, string>;
}

export interface SessionBoard {
  groups: CardGroup[];
  summary: SessionSummary;
  /** 카드 수 (칸 단추의 숫자) */
  total: number;
}

/**
 * 묶음 안 순서 — **입력 대기 → 실패 · 안 본 결과 → 작업 중 → 유휴 → 끊김**. 안 본 결과는 성공이어도
 * 실패와 같은 단에 선다("가서 봐야 할 것" 이라는 뜻이 같다). 끊긴 카드는 안 본 결과가 있어도 끝이다.
 */
function cardRank(c: SessionCard): number {
  if (c.state === "input") return 0;
  if (c.state === "fail") return 1;
  if (c.state === "off") return 4;
  if (c.unseen !== null) return 1;
  return c.state === "running" ? 2 : 3;
}

/**
 * 줄의 4상태(+ AI 타일이면 그 에이전트 상태) → 카드의 **다섯 상태**. 순수 함수.
 *
 * - 셸 타일(`agent === null`) — `working` → 작업 중, `fail` → 실패, `disconnected` → 끊김, 그 밖 유휴.
 * - AI 타일(`ai`) — 끊겼으면 무엇이든 `off`. 권한 대기 · 완료는 입력 대기, 실행 중은 작업 중, **점이 없으면**
 *   유휴다 — 훅 신호 없이 "작업 중" 이라 말하면(셸에게 `claude` 는 늘 도는 명령이다) 기다리는 에이전트를 도는
 *   것처럼 보이게 한다. 에이전트가 끝나 셸로 돌아온 타일은 AI 타일이 아니다 — 셸 규칙을 따른다.
 *
 * 세션 목록 판의 카드 · 상태바 세션 칸의 배지 · 탭 줄 워크스페이스 목록 줄의 배지(`console/session-sheet.ts` 의
 * `sheetBadge`)도 이 함수 하나를 지난다 — 세 자리가 같은 타일을 다른 상태로 부르지 않게. (예전엔 상태바 세션 칩도
 * 지났다 — 칩은 2026-10-07 에 걷었다.)
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

/** 줄 하나 → 카드 한 장 (다른 창의 줄은 `null`) */
function cardOf(row: GroupRow, group: HostGroup, input: SessionCardInput): SessionCard | null {
  const headless = row.kind === "headless";
  if (!headless && (row.tabId === null || row.paneId === null)) return null; // 다른 창 — 이 창의 카드가 아니다
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

/**
 * 묶음 → 카드 판. 순수 함수.
 *
 * - 카드 = **이 창의 타일**(AI · 셸 · SSH) + **헤드리스 위임 세션**. 다른 창의 타일은 뺀다.
 * - 묶음 안 순서: [`cardRank`] → 화면 순서 → 신원 코드 → 키 (안정).
 * - 묶음 순서: **로컬 먼저**, 그다음 가장 급한 카드의 단 → 이름.
 * - 카드가 하나도 없는 묶음(다른 창 타일뿐)은 빠진다.
 */
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
