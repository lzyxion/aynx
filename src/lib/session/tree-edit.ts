// 패널 트리 바꾸기(순수 함수).
// 불변식: 입력 트리를 수정하지 않고, 바뀌지 않은 가지와 잎 객체는 참조 그대로 재사용한다(`pane.id` 유지 = 세션 유지).
// 대상이 없어 바뀔 것이 없으면 입력 트리를 참조까지 그대로 돌려준다 — 호출부가 `!==` 로 판별한다.

import { clonePane, leafOf, paneOrder } from "./factory";
import type { PaneNode, PaneSpec, SplitDir } from "./spec";
import { DEFAULT_RATIO, findPane } from "./tree";

export type PaneSide = "before" | "after";

/** `subtree` 는 복사하지 않고 그대로 붙인다 — 잎 객체와 `pane.id` 가 유지되어야 옮겨진 터미널이 재마운트되지 않는다 */
export function insertSubtree(
  root: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  subtree: PaneNode,
  side: PaneSide,
): PaneNode {
  if (root.type === "leaf") {
    if (root.pane.id !== targetPaneId) return root;
    return {
      type: "split",
      dir,
      ratio: DEFAULT_RATIO,
      a: side === "before" ? subtree : root,
      b: side === "before" ? root : subtree,
    };
  }
  const a = insertSubtree(root.a, targetPaneId, dir, subtree, side);
  if (a !== root.a) return { ...root, a };
  const b = insertSubtree(root.b, targetPaneId, dir, subtree, side);
  if (b !== root.b) return { ...root, b };
  return root;
}

export function flipDir(dir: SplitDir): SplitDir {
  return dir === "row" ? "col" : "row";
}

/** 하위 방향을 번갈아 줘야 줄이 아니라 격자가 된다(한 방향이면 호스트 6개가 세로 띠 여섯). 빈 배열은 부르지 않는다 */
export function tiledSubtree(panes: PaneSpec[], dir: SplitDir): PaneNode {
  if (panes.length <= 1) return leafOf(panes[0]);
  const mid = Math.ceil(panes.length / 2);
  const inner = flipDir(dir);
  return {
    type: "split",
    dir,
    ratio: DEFAULT_RATIO,
    a: tiledSubtree(panes.slice(0, mid), inner),
    b: tiledSubtree(panes.slice(mid), inner),
  };
}

export function splitPaneWith(
  root: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  newPane: PaneSpec,
  side: PaneSide,
): PaneNode {
  return insertSubtree(root, targetPaneId, dir, leafOf(newPane), side);
}

/**
 * 나선(dwindle) — 대상은 포커스가 아니라 가장 최근 칸(가장 깊은 잎, 같으면 생성 순번이 큰 쪽)이다. 포커스를 기준으로 삼으면
 * 첫 칸을 클릭하는 순간 나선이 그 자리에서 다시 시작된다. 순번 필드는 따로 두지 않는다 — `pane-N` 이 곧 순번이다.
 * 깊이 `d % 4`: 0 오른쪽 · 1 아래 · 2 왼쪽 · 3 위(docs/log/2026-09-04-spiral-tiling.md).
 */
export function spiralInsert(
  root: PaneNode,
  newPane: PaneSpec,
  seqOf: (pane: PaneSpec) => number = (pane) => paneOrder(pane.id),
): PaneNode {
  const spot = spiralPlacement(root, seqOf);
  return insertSubtree(root, spot.paneId, spot.dir, leafOf(newPane), spot.side);
}

export function spiralPlacement(
  root: PaneNode,
  seqOf: (pane: PaneSpec) => number = (pane) => paneOrder(pane.id),
): { paneId: string; dir: SplitDir; side: PaneSide } {
  const target = newestLeaf(root, seqOf, 0);
  const dir: SplitDir = target.depth % 2 === 0 ? "row" : "col";
  const side: PaneSide = target.depth % 4 <= 1 ? "after" : "before";
  return { paneId: target.pane.id, dir, side };
}

function newestLeaf(
  node: PaneNode,
  seqOf: (pane: PaneSpec) => number,
  depth: number,
): { pane: PaneSpec; depth: number } {
  if (node.type === "leaf") return { pane: node.pane, depth };
  const a = newestLeaf(node.a, seqOf, depth + 1);
  const b = newestLeaf(node.b, seqOf, depth + 1);
  if (a.depth !== b.depth) return a.depth > b.depth ? a : b;
  return seqOf(a.pane) >= seqOf(b.pane) ? a : b;
}

/** `fresh` 를 넘기면 그 명세로 — 호출부가 새 id 를 미리 알아 포커스를 옮길 수 있게. 없으면 [`clonePane`] */
export function splitPane(
  root: PaneNode,
  paneId: string,
  dir: SplitDir,
  fresh?: PaneSpec,
): PaneNode {
  const src = fresh ?? findPane(root, paneId);
  if (!src) return root;
  return splitPaneWith(root, paneId, dir, fresh ?? clonePane(src), "after");
}

/** 마지막 하나였으면 `null` — 호출부는 그것을 "탭을 닫아라" 로 읽는다 */
export function closePane(root: PaneNode, paneId: string): PaneNode | null {
  if (root.type === "leaf") return root.pane.id === paneId ? null : root;
  const a = closePane(root.a, paneId);
  if (a === null) return root.b;
  if (a !== root.a) return { ...root, a };
  const b = closePane(root.b, paneId);
  if (b === null) return root.a;
  if (b !== root.b) return { ...root, b };
  return root;
}

/** 새 패널 객체를 복사하지 않고 그대로 심는다 — `pane.id` 가 곧 새 타일의 신원이다 */
export function replacePane(root: PaneNode, paneId: string, pane: PaneSpec): PaneNode {
  if (root.type === "leaf") return root.pane.id === paneId ? { type: "leaf", pane } : root;
  const a = replacePane(root.a, paneId, pane);
  const b = a === root.a ? replacePane(root.b, paneId, pane) : root.b;
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

export function replacePaneWithNode(root: PaneNode, paneId: string, node: PaneNode): PaneNode {
  if (root.type === "leaf") return root.pane.id === paneId ? node : root;
  const a = replacePaneWithNode(root.a, paneId, node);
  const b = a === root.a ? replacePaneWithNode(root.b, paneId, node) : root.b;
  return a === root.a && b === root.b ? root : { ...root, a, b };
}
