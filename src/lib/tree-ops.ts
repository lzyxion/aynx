// ---------------------------------------------------------------------------
// 트리 × 기하 — 배치 조작 중 **화면 크기를 봐야 하는** 것들 (docs/log/2026-11-05-hyprland-tiling.md)
//
// `session.ts` 는 순수 트리·스펙, `layout.ts` 는 순수 기하다. 키보드 이동 · 크기 조절은 Hyprland dwindle 과 같게
// 실제 픽셀로 풀어야 해서(타일의 긴 변 · 분할선을 몇 px 밀까) 트리와 방향 낱말을 함께 쓴다. 이 파일은 둘을 import 하는
// **셋째 모듈**이고 화살표는 한 방향뿐이다:
//
//     session.ts  ←  layout.ts  ←  tree-ops.ts
//         ↖___________________________/
//
// 참고한 원본: Hyprland v0.57.1 `src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp`(`moveTargetInDirection` · `addTarget` ·
// `resizeTarget`). 설정은 End-4 와 같은 `preserve_split = true` — 건드리지 않은 분할의 방향은 그대로다.
// ---------------------------------------------------------------------------

import type { FocusDir } from "$lib/layout";
import { clampRatio, closePane, insertSubtree, listPanes } from "$lib/session";
import type { PaneNode, PaneSide, PaneSplit, PaneSpec, SplitDir } from "$lib/session";

/**
 * **자동 배치가 쪼갤 칸** (`app.tiling = focus` 경로 · 나선은 `spiralPlacement` 가 답한다) —
 * **포커스 타일**이다 (없는 id 면 첫 잎).
 */
export function autoPlaceTarget(root: PaneNode, focusedId: string): string {
  const leaves = listPanes(root);
  const focused: PaneSpec | undefined = leaves.find((p) => p.id === focusedId) ?? leaves[0];
  return focused?.id ?? focusedId; // 잎이 없는 트리는 없지만, 답을 지어내지 않는다
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

/** 분할의 두 칸 — 틈(GAP) 없는 노드 상자다. Hyprland 도 노드 상자로 고른다 */
function childBoxes(node: PaneSplit, box: Box): { a: Box; b: Box } {
  const ratio = clampRatio(node.ratio);
  if (node.dir === "row") {
    const w = box.w * ratio;
    return { a: { ...box, w }, b: { ...box, x: box.x + w, w: box.w - w } };
  }
  const h = box.h * ratio;
  return { a: { ...box, h }, b: { ...box, y: box.y + h, h: box.h - h } };
}

/** 잎마다 픽셀 상자 — **트리 순서**(a 먼저)로 낸다 */
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

/** 루트 → 잎 경로 — 지나온 분할과 그 상자, 잎이 든 쪽. 못 찾으면 `null` */
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
 * 타일을 `dir` 쪽으로 옮긴다 — Hyprland `movewindow`(dwindle). **자리 맞바꾸기가 아니라 떼었다가 그쪽 칸에 다시 끼운다.**
 *
 * 1. 타일 변에서 1px 바깥, 그 변의 가운데가 **초점**이다.
 * 2. 타일을 떼면 형제가 빈자리를 차지한다.
 * 3. 초점 아래 칸(화면 밖이면 가장 가까운 칸 · 동률이면 트리 앞쪽)을 둘로 쪼개 넣는다. 긴 변을 자르고
 *    (`w > h` = 좌우), 초점이 그 칸의 앞쪽 절반이면 앞에, 아니면 뒤에 놓는다.
 *
 * 예외 하나: 직계 형제가 **잎**이고 그쪽으로 움직이면 형제의 건너편으로 간다(분할 축도 움직인 축) — 둘이 자리를 바꾼다.
 *
 * ```
 * A | (B / C)   C ←   (A / C) | B      새 분할의 비율은 기본값이고, 나머지 분할의 비율 · 방향은 그대로다.
 * A | (B / C)   A →   (B | A) / C      원본과 같이 화면 가장자리로 밀어도 다시 끼운다(형제 쪽으로 합쳐진다).
 * ```
 *
 * 잎 객체를 그대로 옮기므로 터미널은 재마운트되지 않는다. 타일이 하나뿐이거나 못 찾으면 트리를 **참조까지 그대로** 돌려준다.
 */
export function movePaneDwindle(root: PaneNode, paneId: string, dir: FocusDir, size: CanvasSize): PaneNode {
  const canvas: Box = { x: 0, y: 0, w: size.w, h: size.h };
  const parent = pathTo(root, paneId, canvas)?.at(-1);
  if (!parent) return root; // 못 찾음 · 타일 하나뿐
  const rest = closePane(root, paneId);
  if (rest === null) return root;
  const me = parent.node[parent.side];
  const axis = axisOf(dir);
  const forward = isForward(dir);

  // 예외 — 그쪽에 있는 직계 형제가 잎이다
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

  // 초점 안의 칸은 거리 0 이라 "초점 아래 칸" 과 "가장 가까운 칸" 이 한 줄이다
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
 * 타일 쪽의 분할선을 `dir` 쪽으로 `stepPx` 만큼 민다 — Hyprland `resizeactive`(키보드 · 모서리 없음).
 *
 * 대상은 **그 축의 가장 가까운 조상 분할 하나**다. 방향은 "타일이 커지는 쪽" 이 아니라 **분할선이 가는 쪽**이다 —
 * `A | B` 에서 → 는 포커스가 어느 쪽이든 분할선을 오른쪽으로 민다. 그 축의 분할이 없으면(`A | B` 에서 ↑) 할 일이 없고,
 * 비율이 한계에 닿아 그대로면 트리를 **참조까지 그대로** 돌려준다.
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

  // 경로를 아래에서 위로 다시 짓는다 — 건드리지 않은 가지 · 잎은 참조 그대로
  let next: PaneNode = { ...node, ratio };
  for (let i = index - 1; i >= 0; i -= 1) {
    next = { ...path[i].node, [path[i].side]: next };
  }
  return next;
}
