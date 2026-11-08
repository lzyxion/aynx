import { describe, expect, it } from "vitest";
import { ERROR_LINE_MAX, errorFirstLine, isMermaidLang } from "$lib/mermaid-text";

describe("isMermaidLang", () => {
  it("대소문자·공백 무시", () => {
    expect(isMermaidLang("mermaid")).toBe(true);
    expect(isMermaidLang("Mermaid")).toBe(true);
    expect(isMermaidLang(" MERMAID ")).toBe(true);
  });
  it("다른 언어 · 빈 값", () => {
    expect(isMermaidLang("")).toBe(false);
    expect(isMermaidLang(null)).toBe(false);
    expect(isMermaidLang(undefined)).toBe(false);
    expect(isMermaidLang("mermaidjs")).toBe(false);
    expect(isMermaidLang("ts")).toBe(false);
  });
});

describe("errorFirstLine", () => {
  it("첫 비지 않은 줄", () => {
    expect(errorFirstLine(new Error("\nParse error on line 2:\n...A-->\n---^\nExpecting 'X'"))).toBe("Parse error on line 2:");
  });
  it("글자 · message 를 가진 객체 · 그 밖", () => {
    expect(errorFirstLine("boom")).toBe("boom");
    expect(errorFirstLine({ message: "a\r\nb" })).toBe("a");
    expect(errorFirstLine(42)).toBe("");
    expect(errorFirstLine(null)).toBe("");
  });
  it("길면 자른다", () => {
    const s = errorFirstLine("x".repeat(500));
    expect(s.length).toBe(ERROR_LINE_MAX);
    expect(s.endsWith("…")).toBe(true);
  });
});
