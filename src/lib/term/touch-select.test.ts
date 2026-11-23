import { describe, expect, it } from "vitest";
import { dragRange, grabEnds, placeSelection, wordSpan, type CellKind } from "./touch-select";

/** `가` = 넓은 글자(두 칸) · 공백 = 빈 칸 */
function line(text: string): (col: number) => CellKind {
  const cells: CellKind[] = [];
  for (const ch of text) {
    if (ch === " ") cells.push("blank");
    else if (ch === "가") cells.push("text", "tail");
    else cells.push("text");
  }
  return (col) => cells[col] ?? "blank";
}

describe("wordSpan — 길게 누른 자리의 낱말", () => {
  it("공백으로만 끊는다 — 경로는 한 덩이", () => {
    const k = line("ls src/lib/a.ts  x");
    expect(wordSpan(k, 20, 7, 5)).toEqual({ row: 7, start: 3, end: 14 });
    expect(wordSpan(k, 20, 7, 0)).toEqual({ row: 7, start: 0, end: 1 });
  });

  it("빈 칸 · 줄 밖이면 없다", () => {
    const k = line("ab  cd");
    expect(wordSpan(k, 10, 0, 2)).toBeNull();
    expect(wordSpan(k, 10, 0, 9)).toBeNull();
    expect(wordSpan(k, 10, 0, 10)).toBeNull();
    expect(wordSpan(k, 10, 0, -1)).toBeNull();
  });

  it("넓은 글자의 뒤 칸을 눌러도 그 글자의 낱말 · 끝은 뒤 칸까지", () => {
    const k = line("a 가가 b");
    expect(wordSpan(k, 10, 0, 3)).toEqual({ row: 0, start: 2, end: 5 });
    expect(wordSpan(k, 10, 0, 5)).toEqual({ row: 0, start: 2, end: 5 });
  });

  it("줄 끝까지 찬 낱말은 마지막 칸에서 멈춘다", () => {
    expect(wordSpan(line("abcd"), 4, 0, 1)).toEqual({ row: 0, start: 0, end: 3 });
  });
});

describe("grabEnds — 손잡이를 잡으면 반대쪽 끝이 닻", () => {
  // 5줄 3칸 ~ 6줄 2칸(끝은 다음 칸 = 3)
  const sel = { start: { x: 3, y: 5 }, end: { x: 3, y: 6 } };

  it("시작 손잡이 = 마지막 칸이 닻 · 끝 손잡이 = 첫 칸이 닻", () => {
    expect(grabEnds("start", sel, 10)).toEqual({ anchor: { row: 6, start: 2, end: 2 }, moving: { row: 5, col: 3 } });
    expect(grabEnds("end", sel, 10)).toEqual({ anchor: { row: 5, start: 3, end: 3 }, moving: { row: 6, col: 2 } });
  });

  it("줄 끝까지 찬 선택(끝 = cols)의 마지막 칸은 그 줄의 끝 칸", () => {
    expect(grabEnds("end", { start: { x: 0, y: 2 }, end: { x: 10, y: 2 } }, 10).moving).toEqual({ row: 2, col: 9 });
  });

  it("닻에서 끌면 손잡이를 넘어가도 범위가 뒤집힌다", () => {
    const { anchor } = grabEnds("end", sel, 10);
    expect(dragRange(anchor, { row: 4, col: 8 }, 10)).toEqual({ col: 8, row: 4, length: 6 });
  });
});

describe("placeSelection — 손잡이 · 띠의 자리", () => {
  const g = { left: 10, top: 20, cellW: 8, cellH: 18, rows: 10, viewportY: 100, viewW: 300, viewH: 240 };

  it("시작 = 첫 칸 왼쪽 아래 · 끝 = 마지막 칸 오른쪽 아래 · 띠는 첫 줄 위", () => {
    const p = placeSelection({ start: { x: 2, y: 104 }, end: { x: 5, y: 105 } }, g, 40);
    expect(p.start).toEqual({ x: 26, y: 110 });
    expect(p.end).toEqual({ x: 50, y: 128 });
    expect(p.barTop).toBe(20 + 4 * 18 - 40 - 8);
  });

  it("위에 자리가 없으면 띠는 마지막 줄 아래(손잡이를 비켜서)", () => {
    const p = placeSelection({ start: { x: 0, y: 100 }, end: { x: 4, y: 101 } }, g, 40);
    expect(p.barTop).toBe(20 + 2 * 18 + 22 + 8);
  });

  it("화면 밖의 끝은 그리지 않는다 — 통째로 밖이면 띠도 없다", () => {
    const half = placeSelection({ start: { x: 0, y: 90 }, end: { x: 4, y: 103 } }, g, 40);
    expect(half.start).toBeNull();
    expect(half.end).not.toBeNull();
    expect(half.barTop).not.toBeNull();
    const out = placeSelection({ start: { x: 0, y: 50 }, end: { x: 4, y: 60 } }, g, 40);
    expect(out).toEqual({ start: null, end: null, barTop: null });
  });
});

describe("dragRange — 낱말에서 끈 자리까지", () => {
  const anchor = { row: 5, start: 3, end: 6 };

  it("낱말 안이면 낱말 그대로", () => {
    expect(dragRange(anchor, { row: 5, col: 4 }, 10)).toEqual({ col: 3, row: 5, length: 4 });
  });

  it("뒤로 끌면 낱말 앞에서 그 칸까지 · 줄을 넘으면 칸 수로 잇는다", () => {
    expect(dragRange(anchor, { row: 5, col: 8 }, 10)).toEqual({ col: 3, row: 5, length: 6 });
    expect(dragRange(anchor, { row: 7, col: 1 }, 10)).toEqual({ col: 3, row: 5, length: 19 });
  });

  it("앞으로 끌면 그 칸에서 낱말 끝까지", () => {
    expect(dragRange(anchor, { row: 5, col: 0 }, 10)).toEqual({ col: 0, row: 5, length: 7 });
    expect(dragRange(anchor, { row: 4, col: 8 }, 10)).toEqual({ col: 8, row: 4, length: 9 });
  });
});
