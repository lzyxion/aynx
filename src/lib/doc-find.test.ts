import { describe, expect, it } from "vitest";
import { findMatches, firstFrom, joinChunks, locateMatch, revealOffset, stepMatch } from "$lib/doc-find";

describe("findMatches", () => {
  it("글자 그대로 · 겹치지 않게 앞에서부터", () => {
    expect(findMatches("aaaa", "aa", false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    // 정규식 글자도 글자다
    expect(findMatches("a.b a+b (x)", "a+b", false)).toEqual([{ start: 4, end: 7 }]);
    expect(findMatches("f(x) [y]", "(x)", true)).toEqual([{ start: 1, end: 4 }]);
  });

  it("대소문자 — 기본은 무시, 켜면 구분", () => {
    expect(findMatches("Foo foo FOO", "foo", false)).toHaveLength(3);
    expect(findMatches("Foo foo FOO", "foo", true)).toEqual([{ start: 4, end: 7 }]);
  });

  it("빈 질의는 일치 없음 · 상한에서 멈춘다", () => {
    expect(findMatches("abc", "", false)).toEqual([]);
    expect(findMatches("x".repeat(50), "x", false, 10)).toHaveLength(10);
  });

  it("한글 · 길이가 바뀌는 대소문자 글자에서도 자리가 맞다", () => {
    expect(findMatches("가나다 나다", "나다", false)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
    ]);
    const text = "İstanbul x";
    const m = findMatches(text, "x", false);
    expect(text.slice(m[0].start, m[0].end)).toBe("x");
  });
});

describe("joinChunks · locateMatch", () => {
  const P1 = {};
  const P2 = {};

  it("같은 덩어리는 틈 없이 · 덩어리가 바뀌면 줄바꿈 하나", () => {
    const j = joinChunks([
      { text: "ab", block: P1 },
      { text: "cd", block: P1 },
      { text: "ef", block: P2 },
    ]);
    expect(j.text).toBe("abcd\nef");
    expect(j.starts).toEqual([0, 2, 5]);
  });

  it("인라인 경계를 건너는 일치는 찾고, 덩어리 경계는 건너지 못한다", () => {
    const j = joinChunks([
      { text: "is **", block: P1 },
      { text: "bold", block: P1 },
      { text: "end", block: P2 },
    ]);
    expect(findMatches(j.text, "*bo", false)).toHaveLength(1);
    expect(findMatches(j.text, "boldend", false)).toEqual([]);
  });

  it("일치 → 토막 좌표 — 토막 끝에서 끝나는 일치는 다음 토막으로 새지 않는다", () => {
    const j = joinChunks([
      { text: "ab", block: P1 },
      { text: "cd", block: P1 },
      { text: "ef", block: P2 },
    ]);
    expect(locateMatch(j, { start: 1, end: 3 })).toEqual({ startChunk: 0, startOffset: 1, endChunk: 1, endOffset: 1 });
    expect(locateMatch(j, { start: 0, end: 2 })).toEqual({ startChunk: 0, startOffset: 0, endChunk: 0, endOffset: 2 });
    expect(locateMatch(j, { start: 5, end: 7 })).toEqual({ startChunk: 2, startOffset: 0, endChunk: 2, endOffset: 2 });
  });

  it("토막이 없으면 좌표도 없다", () => {
    expect(locateMatch(joinChunks([]), { start: 0, end: 1 })).toBeNull();
  });
});

describe("stepMatch", () => {
  it("다음 · 이전은 끝에서 돈다", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
  });

  it("고른 것이 없으면 처음 · 마지막, 일치가 없으면 -1", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});

describe("firstFrom", () => {
  const tops = [-200, -10, 0, 40, 900];
  const at = (i: number) => tops[i];

  it("보는 자리 이상인 첫 일치", () => {
    expect(firstFrom(tops.length, at, 0)).toBe(2);
    expect(firstFrom(tops.length, at, 41)).toBe(4);
  });

  it("모두 위에 있으면 처음 · 일치가 없으면 -1", () => {
    expect(firstFrom(tops.length, at, 1000)).toBe(0);
    expect(firstFrom(0, at, 0)).toBe(-1);
  });
});

describe("revealOffset", () => {
  it("이미 보이면 그대로", () => {
    expect(revealOffset(100, 300, 150, 20)).toBe(100);
  });

  it("밖이면 상자의 1/3 지점으로 · 음수는 0", () => {
    expect(revealOffset(100, 300, 1000, 20)).toBe(900);
    expect(revealOffset(500, 300, 50, 20)).toBe(0);
  });
});
