import { describe, expect, it } from "vitest";
import { docFormatEdit, type DocFormat } from "./doc-format";

/** 바꾼 뒤의 글 · 고른 글 */
function run(doc: string, from: number, to: number, kind: DocFormat) {
  const e = docFormatEdit(doc, from, to, kind);
  const next = doc.slice(0, e.from) + e.insert + doc.slice(e.to);
  return { next, sel: next.slice(Math.min(e.anchor, e.head), Math.max(e.anchor, e.head)), at: e.head };
}

describe("docFormatEdit — 감싸기", () => {
  it("고른 글을 감싸고 안쪽을 고른다", () => {
    expect(run("a word b", 2, 6, "bold")).toEqual({ next: "a **word** b", sel: "word", at: 8 });
    expect(run("a word b", 2, 6, "italic").next).toBe("a *word* b");
    expect(run("a word b", 2, 6, "strike").next).toBe("a ~~word~~ b");
    expect(run("a word b", 2, 6, "code").next).toBe("a `word` b");
  });

  it("빈 선택이면 표지 사이에 커서", () => {
    expect(run("ab", 1, 1, "bold")).toEqual({ next: "a****b", sel: "", at: 3 });
  });

  it("이미 감싸였으면 벗긴다 — 안쪽을 골랐어도 · 표지까지 골랐어도", () => {
    expect(run("a **word** b", 4, 8, "bold")).toEqual({ next: "a word b", sel: "word", at: 6 });
    expect(run("a **word** b", 2, 10, "bold").next).toBe("a word b");
  });

  it("거꾸로 고른 선택도 같다", () => {
    expect(run("a word b", 6, 2, "bold").next).toBe("a **word** b");
  });
});

describe("docFormatEdit — 링크 · 코드 블록", () => {
  it("링크는 url 을 골라 둔다", () => {
    expect(run("see docs", 4, 8, "link")).toEqual({ next: "see [docs](url)", sel: "url", at: 14 });
    expect(run("x", 1, 1, "link")).toEqual({ next: "x[](url)", sel: "", at: 2 });
  });

  it("코드 블록 — 줄 머리가 아니면 앞에 줄바꿈", () => {
    expect(run("let a = 1", 0, 9, "codeblock")).toEqual({ next: "```\nlet a = 1\n```", sel: "let a = 1", at: 13 });
    expect(run("x y", 2, 3, "codeblock").next).toBe("x \n```\ny\n```");
    expect(run("", 0, 0, "codeblock")).toEqual({ next: "```\n\n```", sel: "", at: 4 });
  });
});

describe("docFormatEdit — 줄 서식", () => {
  it("제목 — 붙이고, 같은 단계면 걷고, 다른 단계면 바꾼다", () => {
    expect(run("title", 2, 2, "h1").next).toBe("# title");
    expect(run("# title", 3, 3, "h1").next).toBe("title");
    expect(run("# title", 3, 3, "h2").next).toBe("## title");
  });

  it("목록 — 걸친 줄 전부, 빈 줄은 그대로, 번호는 차례로", () => {
    expect(run("a\nb\n\nc", 0, 6, "bullet").next).toBe("- a\n- b\n\n- c");
    expect(run("a\nb", 0, 3, "ordered").next).toBe("1. a\n2. b");
    expect(run("a", 0, 0, "task").next).toBe("- [ ] a");
  });

  it("모두 그 서식이면 걷고, 다른 목록이면 갈아 끼운다 — 들여쓰기는 남긴다", () => {
    expect(run("- a\n- b", 0, 7, "bullet").next).toBe("a\nb");
    expect(run("- a\n  - b", 0, 9, "ordered").next).toBe("1. a\n  2. b");
    expect(run("- [ ] a", 0, 0, "bullet").next).toBe("- a");
  });

  it("인용", () => {
    expect(run("a\nb", 0, 3, "quote").next).toBe("> a\n> b");
    expect(run("> a\n> b", 0, 7, "quote").next).toBe("a\nb");
  });

  it("끝이 다음 줄 머리에 걸린 선택은 그 줄을 넣지 않는다", () => {
    expect(run("a\nb\nc", 0, 4, "bullet").next).toBe("- a\n- b\nc");
  });
});
