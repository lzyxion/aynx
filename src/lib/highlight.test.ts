import { describe, expect, it } from "vitest";
import { highlight, isHighlightable, tooLargeToHighlight, HIGHLIGHT_MAX_LINES } from "$lib/highlight";
import { langOf } from "$lib/doc-lang";

/** 트리의 글자를 이어 붙인다 — 강조가 글자를 바꾸지 않았는지 */
type N = { type: string; value?: string; children?: N[] };
const textOf = (n: N): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));

describe("highlight", () => {
  it("doc-lang 이 돌려주는 언어는 전부 등록돼 있다", () => {
    const samples = ["a.sh", "a.ps1", "a.bat", "a.py", "a.js", "a.ts", "a.json", "a.yaml", "a.toml", "a.ini", "a.rs", "a.go", "a.c", "a.cpp", "a.java", "a.sql", "a.xml", "a.css", "Dockerfile", "/etc/nginx/x.conf", "Makefile", "a.diff", "a.md"];
    for (const s of samples) expect(isHighlightable(langOf(s)), s).toBe(true);
  });

  it("펜스 별칭도 된다", () => {
    for (const a of ["ts", "js", "sh", "shell", "zsh", "yml", "ps1", "toml", "html", "rs", "py", "docker"]) expect(isHighlightable(a), a).toBe(true);
    expect(isHighlightable("brainfuck")).toBe(false);
    expect(isHighlightable("")).toBe(false);
    expect(isHighlightable(null)).toBe(false);
  });

  it("트리의 글자는 원문과 같다 · <script> 는 글자 노드", () => {
    const code = 'const a = "<script>alert(1)</script>";\n// done\n';
    const tree = highlight(code, "ts");
    expect(tree).not.toBeNull();
    expect(textOf(tree as N)).toBe(code);
    const html = highlight("<img src=x onerror=alert(1)>", "html");
    expect(textOf(html as N)).toBe("<img src=x onerror=alert(1)>");
  });

  it("모르는 언어 · 너무 큰 글은 null", () => {
    expect(highlight("x", "nope")).toBeNull();
    expect(highlight("x", null)).toBeNull();
    const big = "a\n".repeat(HIGHLIGHT_MAX_LINES + 1);
    expect(tooLargeToHighlight(big)).toBe(true);
    expect(highlight(big, "ts")).toBeNull();
    expect(tooLargeToHighlight("a\n".repeat(100))).toBe(false);
  });
});
