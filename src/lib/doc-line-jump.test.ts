import { describe, expect, it } from "vitest";
import { DOC_TILE_MD, blockStartLines, parseMarkdown } from "$lib/markdown";
import { blockAtLine, jumpLineIndex, viewLineCount } from "$lib/doc-line-jump";

describe("보이는 줄 수", () => {
  it("끝 줄바꿈 하나는 세지 않는다 — CodeView 와 같다", () => {
    expect(viewLineCount("")).toBe(0);
    expect(viewLineCount("\n")).toBe(0);
    expect(viewLineCount("a")).toBe(1);
    expect(viewLineCount("a\n")).toBe(1);
    expect(viewLineCount("a\nb")).toBe(2);
    expect(viewLineCount("a\n\n")).toBe(2);
    expect(viewLineCount("a\r\nb\r\n")).toBe(2);
  });
});

describe("줄 번호 → 보이는 줄", () => {
  const text = "one\ntwo\nthree\n";

  it("1 기준을 0 기준으로", () => {
    expect(jumpLineIndex(1, text, false)).toBe(0);
    expect(jumpLineIndex(3, text, false)).toBe(2);
  });

  it("0 이하는 첫 줄", () => {
    expect(jumpLineIndex(0, text, false)).toBe(0);
  });

  it("넘치면 마지막 줄 — 잘린 보기면 버린다", () => {
    expect(jumpLineIndex(99, text, false)).toBe(2);
    expect(jumpLineIndex(99, text, true)).toBeNull();
    // 잘렸어도 보이는 범위 안이면 간다
    expect(jumpLineIndex(2, text, true)).toBe(1);
  });

  it("빈 글 · 숫자 아님은 버린다", () => {
    expect(jumpLineIndex(1, "", false)).toBeNull();
    expect(jumpLineIndex(Number.NaN, text, false)).toBeNull();
  });
});

describe("최상위 블록의 시작 줄", () => {
  it("블록과 같은 길이 · 같은 순서 — 블록 사이 빈 줄은 건너뛴다", () => {
    const src = "# 제목\n\n첫 단락\n이어진 줄\n\n- a\n- b\n\n```ts\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const starts = blockStartLines(src);
    expect(starts).toHaveLength(parseMarkdown(src).length);
    expect(starts).toEqual([0, 2, 5, 8, 12]);
  });

  it("머리말은 0, 각주 구역은 자리 없음(null) — 문서 타일 선택", () => {
    const src = "---\ntitle: x\n---\n\n본문[^1]\n\n[^1]: 각주 글\n";
    const blocks = parseMarkdown(src, DOC_TILE_MD);
    const starts = blockStartLines(src, DOC_TILE_MD);
    expect(blocks.map((b) => b.kind)).toEqual(["frontmatter", "p", "footnotes"]);
    expect(starts).toEqual([0, 4, null]);
  });

  it("인용 · 알림은 블록 하나 — 여는 줄이 시작", () => {
    const src = "앞\n\n> [!NOTE]\n> 안\n> - 목록\n\n뒤\n";
    expect(blockStartLines(src)).toEqual([0, 2, 6]);
  });

  it("밑줄식 제목 · 수식 블록 · CRLF", () => {
    expect(blockStartLines("제목\n===\n\n글\n")).toEqual([0, 3]);
    expect(blockStartLines("글\n\n$$\nx\n$$\n\n끝\n", { math: true })).toEqual([0, 2, 6]);
    expect(blockStartLines("a\r\n\r\nb\r\n")).toEqual([0, 2]);
  });

  it("parseMarkdown 의 결과는 그대로다", () => {
    const src = "# a\n\nb\n\n- c\n";
    expect(parseMarkdown(src)).toEqual(parseMarkdown(src, {}));
    expect(parseMarkdown(src)).toHaveLength(blockStartLines(src).length);
  });
});

describe("줄 → 블록", () => {
  const starts = [0, 2, 5, 8, null];

  it("그 줄이 든 블록 — 시작 줄 이하의 마지막", () => {
    expect(blockAtLine(starts, 0)).toBe(0);
    expect(blockAtLine(starts, 3)).toBe(1);
    expect(blockAtLine(starts, 5)).toBe(2);
    expect(blockAtLine(starts, 7)).toBe(2);
  });

  it("넘친 줄은 마지막 블록 — 자리 없는 각주 구역은 고르지 않는다", () => {
    expect(blockAtLine(starts, 999)).toBe(3);
  });

  it("첫 블록 위의 빈 줄은 첫 블록", () => {
    expect(blockAtLine([3, 6], 0)).toBe(0);
    expect(blockAtLine([null, 4], 1)).toBe(1);
  });

  it("고를 블록이 없으면 null", () => {
    expect(blockAtLine([], 0)).toBeNull();
    expect(blockAtLine([null], 0)).toBeNull();
  });
});
