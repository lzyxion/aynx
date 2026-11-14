import { describe, expect, it } from "vitest";
import { hexOf, hexRgbOf, sameRange, searchColors, selectionRows } from "$lib/term/search-paint";

const r = (sx: number, sy: number, ex: number, ey: number) => ({ start: { x: sx, y: sy }, end: { x: ex, y: ey } });

describe("selectionRows — 선택 범위를 줄마다의 칸으로", () => {
  it("한 줄 — 끝 x 는 미포함", () => {
    expect(selectionRows(r(4, 10, 9, 10), 80)).toEqual([{ y: 10, x: 4, width: 5 }]);
  });

  it("줄을 넘은 매치 — 첫 줄은 끝까지 · 다음 줄은 0 부터", () => {
    expect(selectionRows(r(77, 3, 2, 4), 80)).toEqual([
      { y: 3, x: 77, width: 3 },
      { y: 4, x: 0, width: 2 },
    ]);
  });

  it("빈 조각은 내지 않는다", () => {
    expect(selectionRows(r(80, 3, 0, 4), 80)).toEqual([]);
  });
});

describe("sameRange — 검색이 만든 선택인가", () => {
  it("네 값이 모두 같아야 같다", () => {
    expect(sameRange(r(1, 2, 3, 2), r(1, 2, 3, 2))).toBe(true);
    expect(sameRange(r(1, 2, 3, 2), r(1, 2, 4, 2))).toBe(false);
    expect(sameRange(r(1, 2, 3, 2), r(1, 3, 3, 3))).toBe(false);
  });

  it("어느 쪽이든 없으면 같지 않다", () => {
    expect(sameRange(undefined, r(0, 0, 1, 0))).toBe(false);
    expect(sameRange(r(0, 0, 1, 0), null)).toBe(false);
    expect(sameRange(null, null)).toBe(false);
  });
});

describe("hexOf", () => {
  it("두 자리 소문자 · 범위 밖은 자른다", () => {
    expect(hexOf(0, 15, 255)).toBe("#000fff");
    expect(hexOf(-3, 300, 127.6)).toBe("#00ff80");
  });
});

describe("hexRgbOf — 바탕 hex 의 RGB 만(알파와 상관없이)", () => {
  it("터미널 투명도의 `#rrggbb00` 도 RGB 가 산다 — 캔버스로 재면 알파 0 이라 `#000000` 이 되던 것", () => {
    expect(hexRgbOf("#12140d00")).toBe("#12140d");
    expect(hexRgbOf("#12140D80")).toBe("#12140d");
  });

  it("짧은 꼴 · 알파 없는 꼴 · 앞뒤 공백", () => {
    expect(hexRgbOf("#abc")).toBe("#aabbcc");
    expect(hexRgbOf("#abc0")).toBe("#aabbcc");
    expect(hexRgbOf(" #0b111c ")).toBe("#0b111c");
  });

  it("hex 가 아니면 `null` — 캔버스로 잰다", () => {
    expect(hexRgbOf(undefined)).toBeNull();
    expect(hexRgbOf("")).toBeNull();
    expect(hexRgbOf("rgb(1, 2, 3)")).toBeNull();
    expect(hexRgbOf("#12345")).toBeNull();
    expect(hexRgbOf("#zzzzzz")).toBeNull();
  });
});

describe("searchColors — 캔버스가 없으면", () => {
  it("예전 기본값의 불투명 #RRGGBB 를 낸다", () => {
    const c = searchColors({ accent: "color-mix(in srgb, #fff 50%, transparent)", onAccent: "#000" }, "#101010");
    for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
