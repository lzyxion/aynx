/**
 * **세션 목록 판의 탭 지도** — 워크스페이스마다 한 줄 · 탭마다 카드 한 장 · 카드 안에 그 탭의 실제 타일 배치 축소판
 * (2026-11-02 — 세 묶음 카드 격자를 걷었다, 목업 VgJHqZzBPQyKsqWJmhKSKM E안).
 *
 * 재료는 판이 이미 받는 것 그대로다 — 카드(`window-cards.ts` → `session-cards.ts` 의 `SessionCard` · 상태는 `cardStateOf`
 * 한 함수)와 이 창의 탭(트리 · 제목 · 소속 워크스페이스). 그래서 지도의 칸 색 · 요약 칩의 수 · 독 배지가 같은 타일을 다른
 * 상태로 부르지 않는다(요약 수는 `sheetBuckets` 의 묶음에서 센다 — [`mapSummary`]).
 *
 * - **칸** = 탭 트리의 잎 하나(분할 방향 · 비율 그대로 — [`miniLayout`]). 카드가 있는 잎(세션 타일)은 그 카드의 상태
 *   (면은 [`cellFace`] · 오른쪽 위 표식은 [`cellMark`]), 카드가 없는 잎(문서 · 파일 · 쿼리 …)은 `card: null` — 판이 흐린 칸에 그 타일 아이콘으로 그린다
 *   (배치 모양이 실제와 같게).
 * - **탭** = 이 창의 탭 전부(파일 · DB 타일만 있는 탭도 — 2026-11-03 사용자). 순서는 탭 바 순서. 탭 카드 이름 줄의 표식은
 *   탭 줄과 같은 `tabDot` 이다(이 모듈은 입력을 모른다 — 판이 `tabDotInput` 으로 짓는다).
 * - **보조 창의 타일**(주 창에서만 카드 판에 든다)은 트리를 모른다 — 그 창의 탭 하나를 카드 한 장으로, 칸은 카드 순서대로
 *   가로로 같은 폭이다(`root: null`). 표식 입력은 카드에서 짓는다([`auxTabDotInput`]).
 * - 헤드리스 위임 카드 · 누를 곳이 없는 카드는 뺀다(`sheetBuckets` 와 같은 규칙).
 *
 * 룬도 DOM 도 `invoke` 도 없다 — node vitest 로 바로 테스트한다.
 */

import type { Pulse } from "$lib/orchestration/model";
import { aiDisplayName } from "$lib/pane-icons";
import { clampRatio, type PaneNode } from "$lib/session";
import { foldStatus } from "$lib/shell-integration";
import type { TabDotInput } from "$lib/tab-dot";
import type { SessionCard } from "./session-cards";
import { sheetCounts, type SheetBuckets } from "./session-sheet";

/** 축소판 칸의 자리 — 탭 본문을 1 × 1 로 본 비율 */
export interface MiniBox {
  paneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 지도 칸 하나 — 카드가 없으면 판에 카드가 없는 타일(흐린 빈 칸) */
export interface MapCell extends MiniBox {
  card: SessionCard | null;
}

/** 탭 카드 한 장 */
export interface MapTab {
  /** 누르면 갈 탭 — 보조 창이면 `라벨:탭` (카드의 `tabId` 그대로) */
  id: string;
  /** 보조 창 탭이면 `null` — 부르는 쪽이 사전의 이름으로 채운다(이 모듈은 사전을 모른다) */
  title: string | null;
  current: boolean;
  cells: MapCell[];
}

/** 워크스페이스 한 줄 — 소속이 없는 탭은 `id: null`(이름 칸 없이) */
export interface MapRow {
  id: string | null;
  name: string | null;
  tabs: MapTab[];
}

/** [`tabMap`] 이 읽는 탭 — 이 창의 상주 탭(`residentWindowTabs`)에서 부르는 쪽이 옮긴다 */
export interface MapTabInput {
  id: string;
  title: string;
  workspaceId: string | null;
  root: PaneNode;
}

export interface TabMapInput {
  /** 탭 바 순서 */
  tabs: readonly MapTabInput[];
  /** 워크스페이스 순서 · 이름 */
  workspaces: readonly { id: string; name: string }[];
  /** 판의 카드(카드 판 순서) */
  cards: readonly SessionCard[];
  activeTabId: string | null;
  /** 보조 창 타일(카드의 `paneId`) → 워크스페이스 id */
  auxOwners: ReadonlyMap<string, string>;
}

/**
 * 트리 → 축소판 칸. 잎 순서는 `listPanes` 와 같다(왼쪽 · 위 먼저). 비율은 화면과 같은 `clampRatio` 를 지난다 —
 * 고정 px(`px` — 오케스트레이션 탭의 프로듀서 칸만)은 축소판에서 버린다.
 */
export function miniLayout(root: PaneNode): MiniBox[] {
  const out: MiniBox[] = [];
  const walk = (node: PaneNode, x: number, y: number, w: number, h: number): void => {
    if (node.type === "leaf") {
      out.push({ paneId: node.pane.id, x, y, w, h });
      return;
    }
    const r = clampRatio(node.ratio);
    if (node.dir === "row") {
      walk(node.a, x, y, w * r, h);
      walk(node.b, x + w * r, y, w * (1 - r), h);
    } else {
      walk(node.a, x, y, w, h * r);
      walk(node.b, x, y + h * r, w, h * (1 - r));
    }
  };
  walk(root, 0, 0, 1, 1);
  return out;
}

/**
 * 칸 · 칩의 **면** — 카드 상태에서 입력 대기를 권한 대기 · 완료로 가른 것(탭 글리프와 색이 다르다 —
 * docs/log/2026-11-03-tab-status-glyphs.md). 입력 대기는 늘 둘 중 하나로 그려진다.
 */
export type CellFace = "permission" | "finished" | "fail" | "running" | "idle" | "off";

export function cellFace(card: SessionCard): CellFace {
  if (card.state === "input") return card.agentStatus === "finished" ? "finished" : "permission";
  return card.state;
}

/**
 * 오케스트레이션 플레이어 칸의 **면** — 세션 카드가 없는 칸이라 앨범의 맥박으로 정한다(2026-11-05 목업 Wv3EDizxihWcEarKNfoXPP A안).
 * 재생 · 검토 = 옅은 면(실행 중과 같은 세기) · 사람 필요 = 권한 대기와 같은 면. 끝난 앨범은 면이 지워질 때가 없어 칠하지 않는다.
 * `vivid` = 아이콘을 흐리지 않는다(쉼 · 로고만 조용한 칸처럼 흐리다).
 */
export function albumCell(pulse: Pulse): { face: "album-playing" | "album-reviewing" | "permission" | null; vivid: boolean } {
  switch (pulse) {
    case "playing":
      return { face: "album-playing", vivid: true };
    case "reviewing":
      return { face: "album-reviewing", vivid: true };
    case "attention":
    case "paused":
      return { face: "permission", vivid: true };
    case "done":
      return { face: null, vivid: true };
    default:
      return { face: null, vivid: false };
  }
}

/**
 * 칸 오른쪽 위의 **표식 하나** — 순서는 탭과 같다(권한 대기 > 완료 > 실패 > 벨 > 에이전트 실행 > 명령 실행 — `$lib/tab-dot`).
 * `bell` = 안 본 벨. 부르는 쪽이 탭 줄의 조건(`tabBells` — 지금 보는 탭은 없음)대로 넘긴다. 벨은 면을 칠하지 않는다.
 */
export type CellMark = "permission" | "finished" | "fail" | "bell" | "running" | "command";

export function cellMark(card: SessionCard | null, bell: boolean): CellMark | null {
  const face = card ? cellFace(card) : null;
  if (face === "permission" || face === "finished" || face === "fail") return face;
  if (bell) return "bell";
  if (face !== "running") return null;
  return card?.kind === "ai" ? "running" : "command";
}

/**
 * 보조 창 탭의 표식 입력 — 그 창의 탭 트리 · 명령 표 · 벨 · 활동은 이 창에 없어 카드에서 짓는다
 * (이 창의 탭은 `tabDotInput`). 그래서 벨 · 안 본 명령 성공 · 활동은 이 탭에 서지 않는다.
 */
export function auxTabDotInput(cells: readonly MapCell[]): TabDotInput {
  const cards = cells.flatMap((c) => (c.card ? [c.card] : []));
  const agents = cards
    .filter((c) => c.kind === "ai")
    .map((c) => ({
      name: aiDisplayName(c.ai ?? "") ?? c.ai ?? "",
      state: c.agentStatus,
      subagents: c.subagents,
      paneId: c.paneId ?? undefined,
    }));
  const shells = cards.filter((c) => c.kind !== "ai");
  const statusOf = (c: SessionCard) => (c.state === "running" || c.state === "fail" ? c.state : null);
  const state = foldStatus(shells.map(statusOf));
  const lead = shells.find((c) => statusOf(c) === state);
  const command =
    state && lead
      ? { state, name: lead.title ?? lead.code ?? lead.key, others: shells.filter((c) => statusOf(c) !== null).length - 1 }
      : undefined;
  return { active: false, agents, command };
}

/** 판에 오는 카드인가 — `sheetBuckets` 가 세는 카드와 같다(헤드리스 · 누를 곳 없는 카드는 뺀다) */
function onSheet(card: SessionCard): boolean {
  return card.kind !== "headless" && card.tabId !== null && card.paneId !== null;
}

/** 이 창의 탭 · 카드 → 워크스페이스마다 한 줄. 순수 함수. */
export function tabMap(input: TabMapInput): MapRow[] {
  const byPane = new Map<string, SessionCard>();
  for (const c of input.cards) if (onSheet(c)) byPane.set(c.paneId!, c);

  const rows = new Map<string | null, MapTab[]>();
  const push = (ws: string | null, tab: MapTab): void => {
    const list = rows.get(ws);
    if (list) list.push(tab);
    else rows.set(ws, [tab]);
  };

  const local = new Set<string>();
  for (const tab of input.tabs) {
    local.add(tab.id);
    const cells = miniLayout(tab.root).map((box) => ({ ...box, card: byPane.get(box.paneId) ?? null }));
    push(tab.workspaceId ?? null, { id: tab.id, title: tab.title, current: tab.id === input.activeTabId, cells });
  }

  // 보조 창의 탭 — 트리가 없으니 카드 순서대로 가로 같은 폭
  const aux = new Map<string, SessionCard[]>();
  for (const c of byPane.values()) {
    if (local.has(c.tabId!)) continue;
    const list = aux.get(c.tabId!);
    if (list) list.push(c);
    else aux.set(c.tabId!, [c]);
  }
  for (const [id, cards] of aux) {
    const w = 1 / cards.length;
    const cells = cards.map((card, i) => ({ paneId: card.paneId!, x: i * w, y: 0, w, h: 1, card }));
    push(input.auxOwners.get(cards[0].paneId!) ?? null, { id, title: null, current: false, cells });
  }

  // 줄 순서 — 소속 없는 탭이 먼저, 그다음 워크스페이스 목록 순서. 목록에 없는 id 는 끝에(이름 칸 없이)
  const out: MapRow[] = [];
  const none = rows.get(null);
  if (none) out.push({ id: null, name: null, tabs: none });
  for (const ws of input.workspaces) {
    const tabs = rows.get(ws.id);
    if (tabs) out.push({ id: ws.id, name: ws.name, tabs });
  }
  const known = new Set(input.workspaces.map((w) => w.id));
  for (const [id, tabs] of rows) if (id !== null && !known.has(id)) out.push({ id, name: null, tabs });
  return out;
}

/**
 * 판 머리 오른쪽의 상태 칩 — 권한 대기 · 완료 · 실패 · 실행 중 · 조용함 · 끊김. 수가 곧 칸 색의 범례다
 * (2026-11-02 — 아래 범례 줄은 헷갈려서 걷고 머리로 올렸다). 전체 수는 머리 왼쪽 "이 창 N개" 가 말한다.
 */
export interface MapSummary {
  permission: number;
  finished: number;
  fail: number;
  running: number;
  idle: number;
  off: number;
}

/** 판의 묶음 → 요약 수. 실행 중은 독 요약 줄과 같은 `sheetCounts` 에서 · 그 줄의 기다리는 수 = 권한 대기 + 완료 + 실패 */
export function mapSummary(buckets: SheetBuckets): MapSummary {
  const { running } = sheetCounts(buckets);
  const count = (list: readonly SessionCard[], face: CellFace) => list.filter((c) => cellFace(c) === face).length;
  const all = [...buckets.waiting, ...buckets.long, ...buckets.quiet];
  return {
    permission: count(buckets.waiting, "permission"),
    finished: count(buckets.waiting, "finished"),
    fail: count(buckets.waiting, "fail"),
    running,
    idle: count(all, "idle"),
    off: count(all, "off"),
  };
}
