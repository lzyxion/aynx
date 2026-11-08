import { describe, expect, it } from "vitest";
import katex from "katex";
import { DOC_TILE_MD, headingLines, parseInline, parseMarkdown, type MdInline } from "$lib/markdown";
import { sectionLines } from "$lib/doc-edit-preview";
import { katexOptions, mathErrorLine } from "$lib/math-text";

const txt = (text: string): MdInline => ({ kind: "text", text });
const m = (text: string): MdInline => ({ kind: "math", text });
const on = (s: string) => parseInline(s, { math: true });

describe("인라인 수식 — 수식인 것", () => {
  it("$…$", () => {
    expect(on("넓이는 $\\pi r^2$ 이다")).toEqual([txt("넓이는 "), m("\\pi r^2"), txt(" 이다")]);
    expect(on("$x$")).toEqual([m("x")]);
    expect(on("($a+b$).")).toEqual([txt("("), m("a+b"), txt(").")]);
  });

  it("GitHub 의 $`…`$ 꼴 — 안은 그대로 TeX", () => {
    expect(on("값 $`\\sqrt{2}`$ 끝")).toEqual([txt("값 "), m("\\sqrt{2}"), txt(" 끝")]);
    expect(on("$``a`b``$")).toEqual([m("a`b")]);
  });

  it("안의 \\$ 는 TeX 달러라 닫는 짝이 아니다", () => {
    expect(on("$a \\$ b$")).toEqual([m("a \\$ b")]);
  });

  it("한 문단 안에서 줄을 건너도 된다", () => {
    expect(on("$a +\nb$")).toEqual([m("a +\nb")]);
  });
});

describe("인라인 수식 — 글자로 남는 것", () => {
  it("가격 · 셸 변수", () => {
    expect(on("$5 and $10")).toEqual([txt("$5 and $10")]);
    expect(on("costs $5, or $6")).toEqual([txt("costs $5, or $6")]);
    expect(on("$HOME/$USER")).toEqual([txt("$HOME/$USER")]);
    expect(on("echo $PATH:$HOME")).toEqual([txt("echo $PATH:$HOME")]);
    expect(on("US$5 와 US$6")).toEqual([txt("US$5 와 US$6")]);
  });

  it("여는 $ 뒤 · 닫는 $ 앞이 공백이면 아니다", () => {
    expect(on("$ x$")).toEqual([txt("$ x$")]);
    expect(on("$x $")).toEqual([txt("$x $")]);
    expect(on("a $ b $ c")).toEqual([txt("a $ b $ c")]);
  });

  it("닫는 $ 뒤에 숫자 · 글자가 붙으면 아니다", () => {
    expect(on("$x$5")).toEqual([txt("$x$5")]);
    expect(on("$x$abc")).toEqual([txt("$x$abc")]);
  });

  it("$$ 줄기는 인라인이 아니다 · 빈 $$ 도", () => {
    expect(on("a $$x$$ b")).toEqual([txt("a $$x$$ b")]);
    expect(on("$$")).toEqual([txt("$$")]);
  });

  it("\\$ 는 글자 $ — 여는 짝이 되지 않는다", () => {
    expect(on("\\$x$")).toEqual([txt("$x$")]);
    expect(parseInline("\\$5")).toEqual([txt("$5")]);
  });

  it("인라인 코드 속 $ 는 무시 — 코드가 이긴다", () => {
    expect(on("`$x$` 와 $y$")).toEqual([{ kind: "code", text: "$x$" }, txt(" 와 "), m("y")]);
    // 여는 $ 뒤의 코드 속 $ 는 닫는 짝이 아니다
    expect(on("$a `b$` c$")).toEqual([m("a `b$` c")]);
  });

  it("짝 없는 $`…` 는 글자", () => {
    expect(on("$`x` 끝")).toEqual([txt("$"), { kind: "code", text: "x" }, txt(" 끝")]);
  });

  it("math 선택을 끄면(기록 보기) 그대로 글자", () => {
    expect(parseInline("$x$ 와 $`y`$")).toEqual([txt("$x$ 와 $"), { kind: "code", text: "y" }, txt("$")]);
    expect(parseMarkdown("$$\nx\n$$")).toEqual([{ kind: "p", inlines: [txt("$$\nx\n$$")] }]);
  });
});

describe("블록 수식", () => {
  it("$$ 줄로 감싼 여러 줄", () => {
    expect(parseMarkdown("앞\n\n$$\na = b\n\nc\n$$\n\n뒤", { math: true })).toEqual([
      { kind: "p", inlines: [txt("앞")] },
      { kind: "math", text: "a = b\n\nc" },
      { kind: "p", inlines: [txt("뒤")] },
    ]);
  });

  it("한 줄 꼴 · 닫는 줄 앞 글", () => {
    expect(parseMarkdown("$$ E = mc^2 $$", { math: true })).toEqual([{ kind: "math", text: "E = mc^2" }]);
    expect(parseMarkdown("$$\na\nb $$", { math: true })).toEqual([{ kind: "math", text: "a\nb " }]);
  });

  it("문단 한가운데의 $$ 블록이 문단을 끊는다", () => {
    expect(parseMarkdown("글\n$$\nx\n$$", { math: true })).toEqual([
      { kind: "p", inlines: [txt("글")] },
      { kind: "math", text: "x" },
    ]);
  });

  it("```math 울타리", () => {
    expect(parseMarkdown("```math\n\\int_0^1 x\\,dx\n```", { math: true })).toEqual([{ kind: "math", text: "\\int_0^1 x\\,dx" }]);
    // 끄면 여느 코드 블록
    expect(parseMarkdown("```math\nx\n```")).toEqual([{ kind: "code", lang: "math", text: "x" }]);
  });

  it("닫지 않았거나 비었으면 글자 — 잃지 않는다", () => {
    expect(parseMarkdown("$$\nx", { math: true })).toEqual([{ kind: "p", inlines: [txt("$$\nx")] }]);
    expect(parseMarkdown("$$\n$$", { math: true })).toEqual([{ kind: "p", inlines: [txt("$$\n$$")] }]);
    expect(parseMarkdown("$$a$$ 와 $$b$$", { math: true })).toEqual([{ kind: "p", inlines: [txt("$$a$$ 와 $$b$$")] }]);
  });

  it("인용 속 수식 블록", () => {
    expect(parseMarkdown("> $$\n> x\n> $$", { math: true })).toEqual([{ kind: "quote", blocks: [{ kind: "math", text: "x" }] }]);
  });

  it("울타리 안의 $$ 는 코드", () => {
    expect(parseMarkdown("```\n$$\nx\n$$\n```", { math: true })).toEqual([{ kind: "code", lang: "", text: "$$\nx\n$$" }]);
  });
});

describe("수식과 제목 줄 짝", () => {
  it("$$ 블록 속 # 는 제목이 아니다 — headingLines · sectionLines 가 파서와 맞는다", () => {
    const src = "# 하나\n\n$$\n# 아님\n$$\n\n# 둘\n";
    const b = parseMarkdown(src, DOC_TILE_MD);
    expect(b.filter((x) => x.kind === "h")).toHaveLength(2);
    expect(headingLines(src, DOC_TILE_MD).map((h) => h.line)).toEqual([0, 6]);
    expect(sectionLines(src, b, DOC_TILE_MD).map((s) => s.line)).toEqual([0, 6]);
  });

  it("선택이 어긋나면 짝짓기가 쉰다(빈 목록) — 엉뚱한 절로 가지 않는다", () => {
    const src = "# 하나\n\n$$\n# 아님\n$$\n";
    expect(sectionLines(src, parseMarkdown(src, DOC_TILE_MD), { frontmatter: true })).toEqual([]);
  });
});

describe("KaTeX 선택 — 보안", () => {
  const render = (tex: string, display = false) => katex.renderToString(tex, katexOptions(display));

  it("trust:false — \\href · \\url · \\includegraphics · \\htmlClass 는 HTML 이 되지 않는다", () => {
    for (const tex of ["\\href{javascript:alert(1)}{x}", "\\url{https://evil.example}", "\\includegraphics{https://evil.example/a.png}", "\\htmlClass{x}{y}", "\\htmlStyle{color:red}{y}"]) {
      const html = render(tex);
      expect(html).not.toMatch(/<a\s/);
      expect(html).not.toMatch(/<img\s/);
      expect(html).not.toMatch(/class="x"/);
      expect(html).not.toMatch(/style="color:red"/);
    }
  });

  it("원문의 HTML 은 이스케이프된다", () => {
    const html = render("\\text{<script>alert(1)</script>}");
    expect(html).not.toContain("<script>");
  });

  it("문법 오류 · 매크로 폭주는 던진다(받는 쪽이 원문으로)", () => {
    expect(() => render("\\frac{1}{")).toThrow();
    expect(() => render("\\def\\a{\\a\\a}\\a")).toThrow();
  });

  it("오류 한 줄 — 머리말을 뗀다", () => {
    let msg = "";
    try {
      render("\\frac{1}{");
    } catch (e) {
      msg = mathErrorLine(e);
    }
    expect(msg).not.toMatch(/^KaTeX parse error/);
    expect(msg.length).toBeGreaterThan(0);
    expect(mathErrorLine("a\nb")).toBe("a");
    expect(mathErrorLine(null)).toBe("");
  });
});
