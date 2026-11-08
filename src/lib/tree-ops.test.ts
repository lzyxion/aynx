import { describe, expect, it } from "vitest";
import { autoPlaceTarget, movePaneDwindle, resizePaneStep } from "$lib/tree-ops";
import { DEFAULT_RATIO, listPanes, type PaneNode } from "$lib/session";
import { expectSameTiles, leaf, shape, split } from "../test/pane-tree";

// ---------------------------------------------------------------------------
// 키보드 타일 이동 · 크기 조절 = Hyprland dwindle (docs/log/2026-11-05-hyprland-tiling.md)
//
// 기대값은 Hyprland v0.57.1 의 `moveTargetInDirection` · `addTarget` · `resizeTarget` 을 16:9 캔버스에서 손으로 푼 것이다.
// 트리를 짓고 읽는 도우미는 `src/test/pane-tree.ts` 에 있다 (`session.test.ts` 와 공용).
// ---------------------------------------------------------------------------

const CANVAS = { w: 1600, h: 900 };
const move = (root: PaneNode, id: string, dir: "left" | "right" | "up" | "down") =>
  movePaneDwindle(root, id, dir, CANVAS);
const step = (root: PaneNode, id: string, dir: "left" | "right" | "up" | "down", px = 160) =>
  resizePaneStep(root, id, dir, px, CANVAS);

describe("movePaneDwindle — 떼었다가 그쪽 칸에 다시 끼운다", () => {
  it("직계 형제가 잎이고 그쪽으로 가면 둘이 자리를 바꾸고 비율은 기본값이다", () => {
    expect(shape(move(split("row", leaf("A"), leaf("B"), 0.3), "B", "left"))).toBe("(B | A)");
    expect(shape(move(split("col", leaf("A"), leaf("B"), 0.3), "A", "down"))).toBe("(B / A)");
    const next = move(split("row", leaf("A"), leaf("B"), 0.3), "A", "right");
    expect(next.type === "split" && next.ratio).toBe(DEFAULT_RATIO);
  });

  it("이웃 칸을 긴 변으로 쪼개 들어간다 — 초점이 칸의 뒤쪽이면 뒤에", () => {
    // A 는 800×900 → 세로가 길어 위아래로 쪼갠다. C 의 가운데(y 675)는 A 의 아래쪽이다.
    expect(shape(move(split("row", leaf("A"), split("col", leaf("B"), leaf("C"))), "C", "left"))).toBe(
      "((A / C) | B)",
    );
  });

  it("초점이 칸의 앞쪽이면 앞에 — B 는 A 의 위로 들어간다", () => {
    expect(shape(move(split("row", leaf("A"), split("col", leaf("B"), leaf("C"))), "B", "left"))).toBe(
      "((B / A) | C)",
    );
  });

  it("형제가 덩어리면 합쳐진 뒤의 칸으로 들어간다 — 경계의 동률은 트리 앞쪽", () => {
    // A 를 떼면 B(1600×450)/C. 초점 (801, 450) 은 B · C 의 경계 → B, 좌우로 쪼갠다.
    expect(shape(move(split("row", leaf("A"), split("col", leaf("B"), leaf("C"))), "A", "right"))).toBe(
      "((B | A) / C)",
    );
  });

  it("2×2 에서 아래로 — 아래 칸에 들어가고 그 윗줄은 형제가 채운다", () => {
    const grid = split("col", split("row", leaf("A"), leaf("B")), split("row", leaf("C"), leaf("D")));
    expect(shape(move(grid, "A", "down"))).toBe("(B / ((C | A) | D))");
  });

  it("화면 가장자리로 밀면 가장 가까운 칸에 다시 끼운다", () => {
    // A 를 떼면 B(1600×450)/C. 초점 (-1, 450) 에 가장 가까운 동률의 앞쪽 = B.
    expect(shape(move(split("row", leaf("A"), split("col", leaf("B"), leaf("C"))), "A", "left"))).toBe(
      "((A | B) / C)",
    );
    // 둘뿐이면 모양은 그대로이고 비율만 기본값이 된다 (Hyprland 와 같다).
    const next = move(split("row", leaf("A"), leaf("B"), 0.3), "A", "left");
    expect(shape(next)).toBe("(A | B)");
    expect(next.type === "split" && next.ratio).toBe(DEFAULT_RATIO);
  });

  it("건드리지 않은 분할의 비율 · 방향은 그대로다", () => {
    const root = split("row", split("col", leaf("A"), leaf("B"), 0.7), split("col", leaf("C"), leaf("D")), 0.3);
    const next = move(root, "D", "up");
    expect(shape(next)).toBe("((A / B) | (D / C))");
    if (next.type !== "split" || next.a.type !== "split") throw new Error("모양");
    expect(next.ratio).toBe(0.3);
    expect(next.a.ratio).toBe(0.7);
  });

  it("타일 객체의 신원이 유지된다 — 터미널이 재마운트되지 않는다", () => {
    const root = split("row", leaf("A"), split("col", leaf("B"), leaf("C")));
    const before = new Set(listPanes(root));
    const next = move(root, "C", "left");
    expect(new Set(listPanes(next))).toEqual(before);
    for (const spec of listPanes(next)) expect(before.has(spec)).toBe(true);
    expectSameTiles(root, next);
  });

  it("타일이 하나뿐이거나 없는 id 면 참조까지 그대로다", () => {
    const one = leaf("A");
    expect(move(one, "A", "left")).toBe(one);
    const root = split("row", leaf("A"), leaf("B"));
    expect(move(root, "없는-패널", "left")).toBe(root);
  });
});

describe("resizePaneStep — 그 축의 가장 가까운 분할선을 민다", () => {
  const ratioOf = (node: PaneNode) => (node.type === "split" ? node.ratio : null);

  it("방향은 분할선이 가는 쪽이다 — 포커스가 어느 쪽이든 같다", () => {
    const root = split("row", leaf("A"), leaf("B"));
    expect(ratioOf(step(root, "A", "right"))).toBeCloseTo(0.6);
    expect(ratioOf(step(root, "B", "right"))).toBeCloseTo(0.6);
    expect(ratioOf(step(root, "A", "left"))).toBeCloseTo(0.4);
    expect(ratioOf(step(root, "B", "left"))).toBeCloseTo(0.4);
  });

  it("상하는 col 분할을 민다 · 그 축의 분할이 없으면 참조까지 그대로다", () => {
    const col = split("col", leaf("A"), leaf("B"));
    expect(ratioOf(step(col, "B", "down", 90))).toBeCloseTo(0.6);
    const row = split("row", leaf("A"), leaf("B"));
    expect(step(row, "A", "up")).toBe(row);
  });

  it("가장 가까운 조상만 바꾼다 · 민 거리는 그 분할의 실제 폭으로 계산한다", () => {
    // B 는 오른쪽 절반(800px) 안의 (B | C) — 160px = 그 분할의 0.2.
    const inner = split("row", leaf("B"), leaf("C"));
    const left = leaf("A");
    const root = split("row", left, inner);
    const next = step(root, "B", "right");
    if (next.type !== "split") throw new Error("모양");
    expect(next.ratio).toBe(0.5);
    expect(next.a).toBe(left); // 건드리지 않은 가지는 참조 그대로
    expect(ratioOf(next.b)).toBeCloseTo(0.7);
  });

  it("축이 다른 분할은 건너뛰고 올라간다", () => {
    const root = split("row", leaf("A"), split("col", leaf("B"), leaf("C")));
    const next = step(root, "C", "left");
    expect(ratioOf(next)).toBeCloseTo(0.4);
    if (next.type !== "split") throw new Error("모양");
    expect(ratioOf(next.b)).toBe(0.5);
  });

  it("한계에 닿아 더 못 밀면 참조까지 그대로다 · 없는 id 도", () => {
    const root = split("row", leaf("A"), leaf("B"));
    let at = root as PaneNode;
    for (let i = 0; i < 20; i += 1) at = step(at, "A", "right");
    expect(step(at, "A", "right")).toBe(at);
    expect(step(root, "없는-패널", "right")).toBe(root);
  });
});

describe("autoPlaceTarget — 자동 배치가 쪼갤 칸", () => {
  it("포커스 타일이다", () => {
    const root = split("row", leaf("A"), leaf("B"));
    expect(autoPlaceTarget(root, "A")).toBe("A");
    expect(autoPlaceTarget(root, "B")).toBe("B");
  });

  it("없는 id 면 첫 잎이 대상이다", () => {
    expect(autoPlaceTarget(split("row", leaf("A"), leaf("B")), "없는-패널")).toBe("A");
  });
});
