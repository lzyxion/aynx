/**
 * 세션 목록 판의 탭 지도 — 워크스페이스마다 한 줄 · 탭마다 카드 한 장 · 카드 안에 그 탭의 타일 배치 축소판.
 * 보조 창의 탭은 이 창에 트리가 없어 칸을 카드 순서대로 가로 같은 폭으로 놓는다.
 */

import type { Pulse } from "$lib/orchestration/model";
import { aiDisplayName } from "$lib/pane-icons";
import { clampRatio, type PaneNode } from "$lib/session";
import { foldStatus } from "$lib/shell-integration";
import type { TabDotInput } from "$lib/tab-dot";
import type { SessionCard } from "./session-cards";
import { sheetCounts, type SheetBuckets } from "./session-sheet";

/** 탭 본문을 1 × 1 로 본 비율 */
export interface MiniBox {
  paneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapCell extends MiniBox {
  card: SessionCard | null;
}

export interface MapTab {
  /** 보조 창이면 `라벨:탭` (카드의 `tabId` 그대로) */
  id: string;
  /** 보조 창 탭이면 `null` — 이 모듈은 사전을 모르니 부르는 쪽이 채운다 */
  title: string | null;
  current: boolean;
  cells: MapCell[];
}

export interface MapRow {
  id: string | null;
  name: string | null;
  tabs: MapTab[];
}

export interface MapTabInput {
  id: string;
  title: string;
  workspaceId: string | null;
  root: PaneNode;
}

export interface TabMapInput {
  tabs: readonly MapTabInput[];
  workspaces: readonly { id: string; name: string }[];
  cards: readonly SessionCard[];
  activeTabId: string | null;
  /** 보조 창 타일(카드의 `paneId`) → 워크스페이스 id */
  auxOwners: ReadonlyMap<string, string>;
}

/** 고정 px(오케스트레이션 탭의 프로듀서 칸)은 축소판에서 버린다 */
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

/** 카드 상태에서 입력 대기를 권한 대기 · 완료로 가른 것 */
export type CellFace = "permission" | "finished" | "fail" | "running" | "idle" | "off";

export function cellFace(card: SessionCard): CellFace {
  if (card.state === "input") return card.agentStatus === "finished" ? "finished" : "permission";
  return card.state;
}

/**
 * 오케스트레이션 플레이어 칸의 면 — 세션 카드가 없어 앨범의 맥박으로 정한다. 끝난 앨범은 면이 지워질 때가 없어 칠하지 않는다.
 * `vivid` = 아이콘을 흐리지 않는다.
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

/** 우선순위는 `$lib/tab-dot` 의 탭 표식과 같아야 한다 — 벨은 면을 칠하지 않는다 */
export type CellMark = "permission" | "finished" | "fail" | "bell" | "running" | "command";

export function cellMark(card: SessionCard | null, bell: boolean): CellMark | null {
  const face = card ? cellFace(card) : null;
  if (face === "permission" || face === "finished" || face === "fail") return face;
  if (bell) return "bell";
  if (face !== "running") return null;
  return card?.kind === "ai" ? "running" : "command";
}

/** 보조 창 탭의 명령 표 · 벨 · 활동은 이 창에 없어 카드에서 짓는다 — 그래서 벨 · 안 본 명령 성공 · 활동은 서지 않는다 */
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

/** `session-sheet.ts` 의 `bucketCards` 가 세는 카드와 같아야 한다 — 다르면 칸 색과 요약 수가 어긋난다 */
function onSheet(card: SessionCard): boolean {
  return card.kind !== "headless" && card.tabId !== null && card.paneId !== null;
}

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

/** 수가 곧 칸 색의 범례다 — 따로 범례 줄은 헷갈려서 걷었다 */
export interface MapSummary {
  permission: number;
  finished: number;
  fail: number;
  running: number;
  idle: number;
  off: number;
}

/** 실행 중은 독 요약 줄과 같은 `sheetCounts` 에서 센다 */
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
