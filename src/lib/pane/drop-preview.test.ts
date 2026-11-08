// 미리보기와 실제 삽입이 같은 기하를 낸다는 계약 — 방향·비율·중첩·입력 불변을 함께 본다.
import { describe, expect, it } from "vitest";
import { computeLayout } from "$lib/layout";
import { dropPreview } from "./drop-preview";
import { insertSubtree, listPanes, type PaneNode, type PaneSide, type SplitDir } from "$lib/session";

const leaf = (id: string): PaneNode => ({ type: "leaf", pane: { id, kind: "local" } });
const split = (dir: SplitDir, a: PaneNode, b: PaneNode, ratio = 0.5): PaneNode =>
  ({ type: "split", dir, ratio, a, b });

const trees = [
  leaf("pane-1"),
  split("row", leaf("pane-1"), leaf("pane-2"), 0.31),
  split("col", leaf("pane-1"), split("row", leaf("pane-2"), leaf("pane-3"), 0.72), 0.63),
  split("row",
    split("col", leaf("pane-1"), leaf("pane-2"), 0.27),
    split("col", leaf("pane-3"), split("row", leaf("pane-4"), leaf("pane-5"), 0.44), 0.68),
    0.38,
  ),
];
const directions: [string, SplitDir, PaneSide][] = [
  ["왼쪽", "row", "before"],
  ["오른쪽", "row", "after"],
  ["위", "col", "before"],
  ["아래", "col", "after"],
];

function freezeTree(node: PaneNode): void {
  if (node.type === "leaf") Object.freeze(node.pane);
  else {
    freezeTree(node.a);
    freezeTree(node.b);
  }
  Object.freeze(node);
}

describe("dropPreview", () => {
  for (const [index, root] of trees.entries()) {
    for (const target of listPanes(root)) {
      for (const [label, dir, side] of directions) {
        it(`트리 ${index + 1} · ${target.id} · ${label}: 실제 삽입과 같은 pct+px, 입력 불변`, () => {
          const before = JSON.stringify(root);
          const originals = listPanes(root);
          freezeTree(root);
          const incoming = leaf("incoming");
          const actual = computeLayout(insertSubtree(root, target.id, dir, incoming, side)).panes;
          const expectedRects = new Map(actual.filter((b) => b.pane.id !== "incoming")
            .map((b) => [b.pane.id, b.rect]));
          const expectedGhost = actual.find((b) => b.pane.id === "incoming")?.rect;
          const preview = dropPreview(root, target.id, dir, side);
          expect(preview).toEqual({ rects: expectedRects, ghost: expectedGhost });
          expect([...preview!.rects.keys()]).toEqual(originals.map((p) => p.id));
          expect(JSON.stringify(root)).toBe(before);
          listPanes(root).forEach((pane, i) => expect(pane).toBe(originals[i]));
        });
      }
    }
  }

  it("대상이 없으면 null", () => {
    for (const root of trees) {
      for (const [, dir, side] of directions) {
        expect(dropPreview(root, "missing", dir, side)).toBeNull();
      }
    }
  });

  it("같은 탭 이동의 source 는 원래 자리에 남고 대상 쪽만 접힌다", () => {
    const root = split("row", leaf("source"), leaf("target"), 0.36);
    const original = computeLayout(root).panes;
    const preview = dropPreview(root, "target", "col", "before")!;
    expect(preview.rects.size).toBe(2);
    expect(preview.rects.get("source")).toEqual(original[0].rect);
    expect(preview.rects.get("target")).not.toEqual(original[1].rect);
  });

  it("탭 서브트리를 넣어도 고스트는 그 잎들이 차지할 전체 슬롯이다", () => {
    const root = trees[3];
    const subtree = split("col", leaf("incoming-a"), leaf("incoming-b"), 0.3);
    for (const [, dir, side] of directions) {
      const preview = dropPreview(root, "pane-3", dir, side)!;
      const actual = computeLayout(insertSubtree(root, "pane-3", dir, subtree, side)).panes;
      const [a, b] = actual.filter((box) => box.pane.id.startsWith("incoming-"));
      expect(a.rect.x).toEqual(preview.ghost.x);
      expect(a.rect.y).toEqual(preview.ghost.y);
      expect(a.rect.w).toEqual(preview.ghost.w);
      expect(b.rect.w).toEqual(preview.ghost.w);
      // 서브트리 끝점을 다시 더하면 부동소수 오차가 생긴다. 원본 rect 비교는 위에서 정확히 한다.
      expect(b.rect.y.pct + b.rect.h.pct)
        .toBeCloseTo(preview.ghost.y.pct + preview.ghost.h.pct, 10);
      expect(b.rect.y.px + b.rect.h.px)
        .toBeCloseTo(preview.ghost.y.px + preview.ghost.h.px, 10);
      for (const box of actual.filter((box) => !box.pane.id.startsWith("incoming-"))) {
        expect(preview.rects.get(box.pane.id)).toEqual(box.rect);
      }
    }
  });
});
