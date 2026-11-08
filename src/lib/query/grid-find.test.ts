import { describe, expect, it } from "vitest";
import { CELL_SHOWN_MAX, firstMatchFromRow, gridMatches, matchesInRows, shownCellText } from "./grid-find";

const table = [
  ["alpha", "Beta", "x"],
  ["gamma", "alphabet", "ALPHA"],
  ["", "a.b", "(a)"],
];
const at = (r: number, c: number) => table[r][c];

describe("gridMatches", () => {
  it("행 → 열 → 칸 안 자리 차례 · 대소문자 기본 무시", () => {
    expect(gridMatches(3, 3, at, "alpha", false)).toEqual([
      { r: 0, c: 0, start: 0, end: 5 },
      { r: 1, c: 1, start: 0, end: 5 },
      { r: 1, c: 2, start: 0, end: 5 },
    ]);
  });

  it("대소문자 구분을 켜면 그 글자만", () => {
    expect(gridMatches(3, 3, at, "ALPHA", true)).toEqual([{ r: 1, c: 2, start: 0, end: 5 }]);
  });

  it("글자 그대로(정규식 글자도 글자) · 한 칸 안 여러 일치", () => {
    expect(gridMatches(3, 3, at, "a.b", false)).toEqual([{ r: 2, c: 1, start: 0, end: 3 }]);
    expect(gridMatches(3, 3, at, "(a)", false)).toEqual([{ r: 2, c: 2, start: 0, end: 3 }]);
    expect(gridMatches(1, 1, () => "aXaXa", "a", false).map((m) => m.start)).toEqual([0, 2, 4]);
  });

  it("빈 질의 · 빈 표는 없음, 상한에서 멈춘다", () => {
    expect(gridMatches(3, 3, at, "", false)).toEqual([]);
    expect(gridMatches(0, 3, at, "a", false)).toEqual([]);
    expect(gridMatches(100, 1, () => "aaaa", "a", false, 10)).toHaveLength(10);
  });

  it("칸에 그리는 글자는 앞 400자 — 그 뒤는 찾지 않는다", () => {
    const long = "x".repeat(CELL_SHOWN_MAX) + "needle";
    expect(shownCellText(long)).toHaveLength(CELL_SHOWN_MAX);
    expect(shownCellText("short")).toBe("short");
    expect(gridMatches(1, 1, () => shownCellText(long), "needle", false)).toEqual([]);
  });
});

describe("보이는 줄 · 처음 고를 일치", () => {
  const ms = [0, 0, 2, 5, 5, 9].map((r, i) => ({ r, c: 0, start: i, end: i + 1 }));

  it("행 구간 [first, last) 의 일치 번호 구간", () => {
    expect(matchesInRows(ms, 0, 1)).toEqual({ from: 0, to: 2 });
    expect(matchesInRows(ms, 1, 5)).toEqual({ from: 2, to: 3 });
    expect(matchesInRows(ms, 5, 10)).toEqual({ from: 3, to: 6 });
    expect(matchesInRows(ms, 10, 20)).toEqual({ from: 6, to: 6 });
  });

  it("맨 위 행 이상인 첫 일치 — 모두 위면 처음으로 돈다 · 없으면 -1", () => {
    expect(firstMatchFromRow(ms, 0)).toBe(0);
    expect(firstMatchFromRow(ms, 3)).toBe(3);
    expect(firstMatchFromRow(ms, 10)).toBe(0);
    expect(firstMatchFromRow([], 0)).toBe(-1);
  });
});
