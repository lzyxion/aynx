// 트리 × 기하 — 화면 크기를 봐야 하는 배치 조작 (docs/log/2026-11-05-hyprland-tiling.md)
// Hyprland v0.57.1 dwindle(`DwindleAlgorithm.cpp`)을 따르고 `preserve_split = true` 와 같다 — 건드리지 않은 분할의 방향은 그대로다.

import type { FocusDir } from "$lib/layout";
import { clampRatio, closePane, insertSubtree, listPanes } from "$lib/session";
import type { PaneNode, PaneSide, PaneSplit, PaneSpec, SplitDir } from "$lib/session";

export function autoPlaceTarget(root: PaneNode, focusedId: string): string {
  const leaves = listPanes(root);
  const focused: PaneSpec | undefined = leaves.find((p) => p.id === focusedId) ?? leaves[0];
  return focused?.id ?? focusedId;
}

/** 탭 캔버스의 실제 크기 (px) */
export interface CanvasSize {
  w: number;
  h: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 틈(GAP) 없는 노드 상자다 — Hyprland 도 노드 상자로 고른다 */
function childBoxes(node: PaneSplit, box: Box): { a: Box; b: Box } {
  const ratio = clampRatio(node.ratio);
  if (node.dir === "row") {
    const w = box.w * ratio;
    return { a: { ...box, w }, b: { ...box, x: box.x + w, w: box.w - w } };
  }
  const h = box.h * ratio;
  return { a: { ...box, h }, b: { ...box, y: box.y + h, h: box.h - h } };
}

/** 트리 순서(a 먼저)로 낸다 — 거리 동률이면 트리 앞쪽이 이긴다 */
function leafBoxes(node: PaneNode, box: Box, out: { id: string; box: Box }[] = []): { id: string; box: Box }[] {
  if (node.type === "leaf") {
    out.push({ id: node.pane.id, box });
    return out;
  }
  const { a, b } = childBoxes(node, box);
  leafBoxes(node.a, a, out);
  leafBoxes(node.b, b, out);
  return out;
}

function pathTo(
  root: PaneNode,
  paneId: string,
  box: Box,
): { node: PaneSplit; box: Box; side: "a" | "b" }[] | null {
  if (root.type === "leaf") return root.pane.id === paneId ? [] : null;
  const kids = childBoxes(root, box);
  for (const side of ["a", "b"] as const) {
    const rest = pathTo(root[side], paneId, kids[side]);
    if (rest) return [{ node: root, box, side }, ...rest];
  }
  return null;
}

const axisOf = (dir: FocusDir): SplitDir => (dir === "left" || dir === "right" ? "row" : "col");
const isForward = (dir: FocusDir): boolean => dir === "right" || dir === "down";

/**
 * Hyprland `movewindow`(dwindle) — 자리 맞바꾸기가 아니라 떼었다가 그쪽 칸에 다시 끼운다.
 * 잎 객체를 그대로 옮겨야 터미널이 재마운트되지 않는다. 바뀐 것이 없으면 트리를 참조까지 그대로 돌려준다.
 */
export function movePaneDwindle(root: PaneNode, paneId: string, dir: FocusDir, size: CanvasSize): PaneNode {
  const canvas: Box = { x: 0, y: 0, w: size.w, h: size.h };
  const parent = pathTo(root, paneId, canvas)?.at(-1);
  if (!parent) return root;
  const rest = closePane(root, paneId);
  if (rest === null) return root;
  const me = parent.node[parent.side];
  const axis = axisOf(dir);
  const forward = isForward(dir);

  // 그쪽 직계 형제가 잎이면 둘이 자리를 바꾼다
  if (parent.node.dir === axis && parent.side === (forward ? "a" : "b")) {
    const partner = forward ? parent.node.b : parent.node.a;
    if (partner.type === "leaf") {
      return insertSubtree(rest, partner.pane.id, axis, me, forward ? "after" : "before");
    }
  }

  const mine = leafBoxes(root, canvas).find((l) => l.id === paneId)?.box;
  if (!mine) return root;
  const focal =
    axis === "row"
      ? { x: forward ? mine.x + mine.w + 1 : mine.x - 1, y: mine.y + mine.h / 2 }
      : { x: mine.x + mine.w / 2, y: forward ? mine.y + mine.h + 1 : mine.y - 1 };

  let target: { id: string; box: Box } | null = null;
  let best = Infinity;
  for (const leaf of leafBoxes(rest, canvas)) {
    const dx = Math.max(leaf.box.x - focal.x, 0, focal.x - (leaf.box.x + leaf.box.w));
    const dy = Math.max(leaf.box.y - focal.y, 0, focal.y - (leaf.box.y + leaf.box.h));
    const dist = dx * dx + dy * dy;
    if (dist < best) {
      best = dist;
      target = leaf;
    }
  }
  if (!target) return root;

  const { box } = target;
  const splitDir: SplitDir = box.w > box.h ? "row" : "col";
  const first = splitDir === "row" ? focal.x < box.x + box.w / 2 : focal.y < box.y + box.h / 2;
  const side: PaneSide = first ? "before" : "after";
  return insertSubtree(rest, target.id, splitDir, me, side);
}

/**
 * Hyprland `resizeactive` — `dir` 은 타일이 커지는 쪽이 아니라 분할선이 가는 쪽이다.
 * 바뀐 것이 없으면 트리를 참조까지 그대로 돌려준다.
 */
export function resizePaneStep(
  root: PaneNode,
  paneId: string,
  dir: FocusDir,
  stepPx: number,
  size: CanvasSize,
): PaneNode {
  const axis = axisOf(dir);
  const path = pathTo(root, paneId, { x: 0, y: 0, w: size.w, h: size.h });
  if (!path) return root;
  let index = path.length - 1;
  while (index >= 0 && path[index].node.dir !== axis) index -= 1;
  if (index < 0) return root;

  const { node, box } = path[index];
  const extent = axis === "row" ? box.w : box.h;
  if (!(extent > 0)) return root;
  const ratio = clampRatio(node.ratio + ((isForward(dir) ? 1 : -1) * stepPx) / extent);
  if (ratio === node.ratio) return root;

  let next: PaneNode = { ...node, ratio };
  for (let i = index - 1; i >= 0; i -= 1) {
    next = { ...path[i].node, [path[i].side]: next };
  }
  return next;
}
