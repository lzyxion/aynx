/**
 * 패널 트리 → 화면 기하(순수). 타일 상자(`PaneHost.svelte`)와 분할선(`SplitView.svelte`)이 다른 컴포넌트라
 * 둘 다 이 함수로 같은 사각형을 얻어야 어긋나지 않는다 (docs/log/2026-09-02-pane-host.md).
 */

import {
  clampRatio,
  type PaneNode,
  type PaneSpec,
  type PaneSide,
  type PaneSplit,
  type SplitDir,
} from "$lib/session";

/** theme.css 의 `--gap` 토큰과 같은 값이어야 한다 */
export const GAP = 8;

/** `calc(<pct>% + <px>px)` 로 펴지는 길이 */
export interface Len {
  pct: number;
  px: number;
}

export interface Rect {
  x: Len;
  y: Len;
  w: Len;
  h: Len;
}

export interface PaneBox {
  pane: PaneSpec;
  rect: Rect;
}

export interface DividerBox {
  key: string;
  /** 트리 프록시 참조다 — 드래그가 `ratio` 를 직접 쓴다 */
  node: PaneSplit;
  dir: SplitDir;
  host: Rect;
  rect: Rect;
}

export interface Layout {
  panes: PaneBox[];
  lines: DividerBox[];
}

export const FULL_RECT: Rect = {
  x: { pct: 0, px: 0 },
  y: { pct: 0, px: 0 },
  w: { pct: 100, px: 0 },
  h: { pct: 100, px: 0 },
};

function cutOf(node: PaneSplit, span: Len): Len {
  const r = clampRatio(node.ratio);
  return { pct: span.pct * r, px: span.px * r + (node.px ?? 0) };
}

function walk(
  node: PaneNode,
  rect: Rect,
  key: string,
  panes: PaneBox[],
  lines: DividerBox[],
) {
  if (node.type === "leaf") {
    panes.push({ pane: node.pane, rect });
    return;
  }
  const half = GAP / 2;

  if (node.dir === "row") {
    // `cut` 은 부모 왼쪽 변에서 분할선 한가운데까지의 거리다
    const cut = cutOf(node, rect.w);
    const cutPct = rect.x.pct + cut.pct;
    const cutPx = rect.x.px + cut.px;
    const aW: Len = { pct: cut.pct, px: cut.px - half };
    const bX: Len = { pct: cutPct, px: cutPx + half };
    const bW: Len = { pct: rect.w.pct - cut.pct, px: rect.w.px - cut.px - half };
    walk(node.a, { ...rect, w: aW }, `${key}a`, panes, lines);
    walk(node.b, { ...rect, x: bX, w: bW }, `${key}b`, panes, lines);
    lines.push({
      key,
      node,
      dir: "row",
      host: rect,
      rect: {
        x: { pct: cutPct, px: cutPx - half },
        y: rect.y,
        w: { pct: 0, px: GAP },
        h: rect.h,
      },
    });
  } else {
    const cut = cutOf(node, rect.h);
    const cutPct = rect.y.pct + cut.pct;
    const cutPx = rect.y.px + cut.px;
    const aH: Len = { pct: cut.pct, px: cut.px - half };
    const bY: Len = { pct: cutPct, px: cutPx + half };
    const bH: Len = { pct: rect.h.pct - cut.pct, px: rect.h.px - cut.px - half };
    walk(node.a, { ...rect, h: aH }, `${key}a`, panes, lines);
    walk(node.b, { ...rect, y: bY, h: bH }, `${key}b`, panes, lines);
    lines.push({
      key,
      node,
      dir: "col",
      host: rect,
      rect: {
        x: rect.x,
        y: { pct: cutPct, px: cutPx - half },
        w: rect.w,
        h: { pct: 0, px: GAP },
      },
    });
  }
}

export function computeLayout(root: PaneNode, base: Rect = FULL_RECT): Layout {
  const panes: PaneBox[] = [];
  const lines: DividerBox[] = [];
  walk(root, base, "r", panes, lines);
  return { panes, lines };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const len = (l: Len) => `calc(${round(l.pct)}% + ${round(l.px)}px)`;

export const boxStyle = (r: Rect) =>
  `left:${len(r.x)};top:${len(r.y)};width:${len(r.w)};height:${len(r.h)}`;

export function toPx(l: Len, total: number): number {
  return (l.pct / 100) * total + l.px;
}

// ── 드랍 4분면 판정 ──
// 가장 가까운 변의 가장자리 40% 가 그 변의 영역이고, 한가운데는 "오른쪽" 이 기본이다 — 좌우 분할이 가장 흔한 쓰임이라서.

export const EDGE = 0.4;

export type DropZone = "left" | "right" | "top" | "bottom";

export const ZONE_SPLIT: Record<DropZone, { dir: SplitDir; side: PaneSide }> = {
  left: { dir: "row", side: "before" },
  right: { dir: "row", side: "after" },
  top: { dir: "col", side: "before" },
  bottom: { dir: "col", side: "after" },
};

export function zoneOf(rect: DOMRect, x: number, y: number): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "right";
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const dist: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  let best = dist[0];
  for (const d of dist) if (d[1] < best[1]) best = d;
  return best[1] < EDGE ? best[0] : "right";
}

/** 긴 변을 자른다. 컨테이너 크기를 아직 모르면(0 · 마운트 전) 예전 기본값 `"row"` (docs/log/2026-09-04-tiling-move-resize.md) */
export function autoSplitDir(rect: Rect, containerW: number, containerH: number): SplitDir {
  if (!(containerW > 0) || !(containerH > 0)) return "row";
  const w = toPx(rect.w, containerW);
  const h = toPx(rect.h, containerH);
  return w >= h ? "row" : "col";
}

// ── 방향 포커스 이동 ── (docs/log/2026-09-03-keys-ended-focus.md)
// 트리의 형제가 아니라 화면 사각형으로 푼다 — `row(a, col(b, c))` 에서 a 의 오른쪽 형제는 b 도 c 도 아니다.
// 후보는 진행 축에서 내 변을 넘어서고 수직 축에서 실제로 겹쳐야 한다(닿기만 하면 아니다). 감싸 돌지 않는다 — 방향 감각이 무너진다.
// `Len` 은 명목 1000px 로 편다 — 한 축 안의 대소 비교뿐이라 실제 크기가 답을 바꾸지 않고, 100 이면 GAP 이 묻힌다.

const NOMINAL = 1000;

/** GAP(8) 보다 한참 작아야 맞닿은 이웃과 겹치는 이웃을 가르는 판정이 흔들리지 않는다 */
const FEPS = 0.001;

export type FocusDir = "left" | "right" | "up" | "down";

/** a = 진행 축(방향이 가리키는 축) · p = 수직 축 */
interface Span {
  a0: number;
  a1: number;
  p0: number;
  p1: number;
}

function spanOf(rect: Rect, dir: FocusDir): Span {
  const horizontal = dir === "left" || dir === "right";
  const x0 = toPx(rect.x, NOMINAL);
  const x1 = x0 + toPx(rect.w, NOMINAL);
  const y0 = toPx(rect.y, NOMINAL);
  const y1 = y0 + toPx(rect.h, NOMINAL);
  return horizontal
    ? { a0: x0, a1: x1, p0: y0, p1: y1 }
    : { a0: y0, a1: y1, p0: x0, p1: x1 };
}

export function neighborInDirection(
  panes: PaneBox[],
  focusedId: string,
  dir: FocusDir,
): string | null {
  const me = panes.find((p) => p.pane.id === focusedId);
  if (!me) return null;
  return neighborOfRect(panes, me.rect, dir, new Set([focusedId]));
}

/** 가장자리 거리 → 겹침 길이 → 중심 거리 순으로 고른다 */
export function neighborOfRect(
  panes: readonly PaneBox[],
  region: Rect,
  dir: FocusDir,
  exclude?: ReadonlySet<string>,
): string | null {
  const from = spanOf(region, dir);
  const forward = dir === "right" || dir === "down";

  let bestId: string | null = null;
  let bestGap = Infinity;
  let bestOverlap = -Infinity;
  let bestCenter = Infinity;

  for (const box of panes) {
    if (exclude?.has(box.pane.id)) continue;
    const to = spanOf(box.rect, dir);

    const gap = forward ? to.a0 - from.a1 : from.a0 - to.a1;
    if (gap < -FEPS) continue;

    const overlap = Math.min(from.p1, to.p1) - Math.max(from.p0, to.p0);
    if (overlap <= FEPS) continue;

    const center = Math.abs((from.p0 + from.p1) / 2 - (to.p0 + to.p1) / 2);

    const better =
      gap < bestGap - FEPS ||
      (gap <= bestGap + FEPS &&
        (overlap > bestOverlap + FEPS ||
          (overlap >= bestOverlap - FEPS && center < bestCenter - FEPS)));
    if (!better) continue;

    bestId = box.pane.id;
    bestGap = gap;
    bestOverlap = overlap;
    bestCenter = center;
  }
  return bestId;
}
