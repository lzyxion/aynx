import { describe, expect, it } from "vitest";
import { canDragCell, cellDropPlan, type SheetLeaf } from "./sheet-drag";

const leaf = (over: Partial<SheetLeaf> & { orch?: unknown } = {}): SheetLeaf =>
  ({ tab: { id: "t1", ...(over.orch ? { orch: over.orch } : {}) }, kind: over.kind ?? "local" }) as SheetLeaf;

describe("canDragCell", () => {
  it("이 창의 평범한 타일은 끌 수 있다", () => {
    for (const kind of ["local", "ssh", "sftp", "localfs", "doc"] as const) expect(canDragCell(leaf({ kind }), false), kind).toBe(true);
  });

  it("보조 창 칸 · 오케스트레이션 탭 · 시작 타일 · 폰 배치는 끌 수 없다", () => {
    expect(canDragCell(null, false)).toBe(false);
    expect(canDragCell(leaf({ orch: { view: "library" } }), false)).toBe(false);
    expect(canDragCell(leaf({ kind: "start" }), false)).toBe(false);
    expect(canDragCell(leaf(), true)).toBe(false);
  });
});

describe("cellDropPlan", () => {
  it("다른 칸 위 = 그 자리로 이동 — 4분면이 방향을 정한다", () => {
    const plan = cellDropPlan("a", "b", leaf(), "left");
    expect(plan).toMatchObject({ outcome: "move", accept: true, effect: "move", preview: "zone", split: { dir: "row", side: "before" } });
    expect(cellDropPlan("a", "b", leaf(), "bottom").split).toEqual({ dir: "col", side: "after" });
  });

  it("자기 칸 · 보조 창 칸 · 오케스트레이션 탭은 받지 않는다", () => {
    expect(cellDropPlan("a", "a", leaf(), "left").accept).toBe(false);
    expect(cellDropPlan("a", "b", null, "left").accept).toBe(false);
    expect(cellDropPlan("a", "b", leaf({ orch: { view: "library" } }), "left").accept).toBe(false);
  });

  it("시작 타일 위는 상자 전체 미리보기(교체)", () => {
    expect(cellDropPlan("a", "b", leaf({ kind: "start" }), "left").preview).toBe("all");
  });
});
