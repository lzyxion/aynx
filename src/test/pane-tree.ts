import { expect } from "vitest";
import { DEFAULT_RATIO, countPanes, leafOf, listPanes } from "$lib/session";
import type { PaneLeaf, PaneNode, PaneSpec, SplitDir } from "$lib/session";

// ---------------------------------------------------------------------------
// 타일 트리 테스트 도우미 — `session.test.ts` 와 `tree-ops.test.ts` 가 함께 쓴다.
//
// 배치 조작이 두 파일로 갈리면서(docs/log/2026-09-05-refactor-structure.md) 같은 도우미가
// 두 벌이 될 뻔한 자리다. 트리를 짓는 말(`leaf`·`split`)과 결과를 읽는 말(`shape`·
// `expectSameTiles`)은 어느 쪽에서 보든 같은 뜻이므로 한 곳에 둔다.
//
// 이 파일은 `src/test/` 에 있어 vitest 의 `include`(`src/**/*.test.ts`)에 걸리지 않는다 —
// 테스트가 아니라 테스트가 import 하는 모듈이다.
//
// 패널 id 는 **손으로 짓는다** — 전역 카운터(`newLocalPane` 등)에 기대면 테스트 순서에 따라
// 번호가 달라진다. 나선 테스트만은 `paneOrder` 가 읽을 수 있게 `pane-N` 꼴을 쓴다.
// ---------------------------------------------------------------------------

export const spec = (id: string): PaneSpec => ({ id, kind: "local" });
export const leaf = (id: string): PaneLeaf => leafOf(spec(id));

export const split = (
  dir: SplitDir,
  a: PaneNode,
  b: PaneNode,
  ratio = DEFAULT_RATIO,
): PaneNode => ({
  type: "split",
  dir,
  ratio,
  a,
  b,
});

/**
 * 트리 모양을 한 줄 글자로 — `row` 는 `|`, `col` 은 `/`.
 * `((A|B)/(C|D))` 같은 문서의 그림을 그대로 견줄 수 있다.
 */
export function shape(node: PaneNode): string {
  if (node.type === "leaf") return node.pane.id;
  return `(${shape(node.a)} ${node.dir === "row" ? "|" : "/"} ${shape(node.b)})`;
}

/** 트리의 **잎 노드 객체**들 (`listPanes` 는 `PaneSpec` 만 준다) */
export function leafNodes(node: PaneNode): PaneLeaf[] {
  return node.type === "leaf" ? [node] : [...leafNodes(node.a), ...leafNodes(node.b)];
}

/**
 * 잎 노드·패널 명세의 **신원(===)** 이 통째로 보존되었는가 + 타일 개수가 그대로인가.
 *
 * 이 앱에서 이것이 곧 "터미널이 재마운트되지 않았다(= 세션이 안 끊겼다)" 이다
 * (docs/log/2026-09-04-tiling-move-resize.md — "단위 테스트가 매 케이스마다 잎 객체 신원·
 * 스펙 객체 신원·타일 개수를 함께 검사한다").
 */
export function expectSameTiles(before: PaneNode, after: PaneNode): void {
  const beforeLeaves = new Set<PaneLeaf>(leafNodes(before));
  const beforeSpecs = new Set<PaneSpec>(listPanes(before));
  const afterLeaves = leafNodes(after);

  expect(countPanes(after)).toBe(countPanes(before));
  expect(afterLeaves).toHaveLength(beforeLeaves.size);
  for (const node of afterLeaves) expect(beforeLeaves.has(node)).toBe(true);
  for (const pane of listPanes(after)) expect(beforeSpecs.has(pane)).toBe(true);
}
