import { describe, expect, it } from "vitest";
import { cellsEqual, filterLabel, filterRows, withFilter, type RowFilter } from "./grid-filter";
import type { Cell } from "./query-backend";

const rows: Cell[][] = [
  [1, "a", null],
  [2, "b", "x"],
  [3, "a", "y"],
  [4, null, "x"],
];

const f = (col: number, op: "eq" | "ne", value: Cell, name = `c${col}`): RowFilter => ({ col, name, op, value });

describe("받은 행 거르기", () => {
  it("같음 — NULL 은 NULL 끼리만 · 큰 정수 글자는 수로", () => {
    expect(cellsEqual(null, null)).toBe(true);
    expect(cellsEqual(null, "")).toBe(false);
    expect(cellsEqual("", null)).toBe(false);
    expect(cellsEqual("01", "1")).toBe(true);
    expect(cellsEqual(1, "1")).toBe(true);
    expect(cellsEqual("a", "b")).toBe(false);
    expect(cellsEqual(true, true)).toBe(true);
  });

  it("eq · ne · NULL", () => {
    expect(filterRows(rows, [f(1, "eq", "a")]).map((r) => r[0])).toEqual([1, 3]);
    expect(filterRows(rows, [f(1, "ne", "a")]).map((r) => r[0])).toEqual([2, 4]);
    expect(filterRows(rows, [f(1, "eq", null)]).map((r) => r[0])).toEqual([4]);
    expect(filterRows(rows, [f(2, "ne", null)]).map((r) => r[0])).toEqual([2, 3, 4]);
  });

  it("여럿은 AND · 없으면 같은 배열", () => {
    expect(filterRows(rows, [f(1, "eq", "a"), f(2, "ne", null)]).map((r) => r[0])).toEqual([3]);
    expect(filterRows(rows, [])).toBe(rows);
  });

  it("바꾸기 · 더하기(같은 조건은 한 번)", () => {
    const a = f(1, "eq", "a");
    const b = f(2, "eq", "x");
    expect(withFilter([a], b, "replace")).toEqual([b]);
    expect(withFilter([a], b, "add")).toEqual([a, b]);
    expect(withFilter([a, b], f(1, "eq", "a"), "add")).toEqual([a, b]);
    expect(withFilter([a], f(1, "ne", "a"), "add")).toHaveLength(2);
    expect(withFilter([f(2, "eq", null)], f(2, "eq", null), "add")).toHaveLength(1);
  });

  it("칩 글자", () => {
    expect(filterLabel(f(1, "eq", "a", "name"))).toBe("name = 'a'");
    expect(filterLabel(f(0, "ne", 3, "id"))).toBe("id <> 3");
    expect(filterLabel(f(0, "eq", null, "id"))).toBe("id IS NULL");
    expect(filterLabel(f(0, "ne", null, "id"))).toBe("id IS NOT NULL");
    expect(filterLabel(f(0, "eq", true, "ok"))).toBe("ok = true");
    const long = filterLabel(f(0, "eq", "x".repeat(50), "t"));
    expect(long.endsWith("…'")).toBe(true);
    expect(long.length).toBeLessThan(45);
  });
});
