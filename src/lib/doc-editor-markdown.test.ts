import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, ensureSyntaxTree } from "@codemirror/language";
import { inlineMathSpan, markdownMode } from "./doc-editor-markdown";

/** 글 → 칠한 토막 `[노드 이름, 글]` (이름 없는 평문은 뺀다) */
function tokens(doc: string): [string, string][] {
  const state = EditorState.create({ doc, extensions: [StreamLanguage.define(markdownMode)] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  const out: [string, string][] = [];
  tree?.iterate({
    enter(n) {
      if (n.type.isTop || n.name === "") return;
      out.push([n.name, state.sliceDoc(n.from, n.to)]);
    },
  });
  return out;
}

/** 그 이름의 토막 글만 */
const named = (doc: string, name: string) => tokens(doc).filter(([n]) => n === name).map(([, t]) => t);

describe("inlineMathSpan — markdown.ts 의 inlineMathAt 과 같은 규칙", () => {
  const span = (s: string, i = s.indexOf("$")) => {
    const m = inlineMathSpan(s, i);
    return m && s.slice(m.from, m.to);
  };

  it("$…$ · $`…`$", () => {
    expect(span("a $x^2$ b")).toBe("x^2");
    expect(span("$`a$b`$")).toBe("a$b");
  });

  it("금액 · 셸 변수 · 붙은 글자는 수식이 아니다", () => {
    expect(span("$5 and $10")).toBeNull();
    expect(span("$HOME/$USER")).toBeNull();
    expect(span("US$5$")).toBeNull();
    expect(span("$ x$")).toBeNull();
    expect(span("$x $")).toBeNull();
    expect(span("$$x$$")).toBeNull();
  });

  it("안의 \\$ · 인라인 코드 속 $ 는 닫는 짝이 아니다", () => {
    expect(span("$a\\$b$")).toBe("a\\$b");
    expect(span("$a `$` b$")).toBe("a `$` b");
  });
});

describe("markdownMode — 수식", () => {
  it("인라인 수식 — 표식 · 본문 · TeX 명령어", () => {
    expect(tokens("a $\\frac{1}{2}$ b")).toEqual([
      ["mathMark", "$"],
      ["texCommand", "\\frac"],
      ["math", "{1}{2}"],
      ["mathMark", "$"],
    ]);
    expect(named("$`x`$", "mathMark")).toEqual(["$`", "`$"]);
  });

  it("금액 · 이스케이프 · 인라인 코드 속 $ 는 칠하지 않는다", () => {
    expect(named("$5 and $10", "math")).toEqual([]);
    expect(named("\\$x$ y", "math")).toEqual([]);
    expect(tokens("`$x$`")).toEqual([["monospace", "`$x$`"]]);
  });

  it("$$ 블록 — 한 줄 꼴 · 여러 줄 꼴", () => {
    expect(tokens("$$ E = mc^2 $$")).toEqual([
      ["mathMark", "$$"],
      ["math", " E = mc^2 "],
      ["mathMark", "$$"],
    ]);
    expect(tokens("$$\na = b\n\nc $$\n뒤")).toEqual([
      ["mathMark", "$$"],
      ["math", "a = b"],
      ["math", "c "],
      ["mathMark", "$$"],
    ]);
    // 한 줄에 짝이 둘이면 블록이 아니다(인라인 규칙도 `$$` 를 읽지 않는다)
    expect(named("$$a$$ 와 $$b$$", "math")).toEqual([]);
  });

  it("```math 본문은 수식, 다른 울타리 속 $ 는 코드", () => {
    expect(tokens("```math\n\\int x\n```")).toEqual([
      ["meta", "```math"],
      ["texCommand", "\\int"],
      ["math", " x"],
      ["meta", "```"],
    ]);
    expect(named("```\n$$\nx $y$\n$$\n```", "math")).toEqual([]);
    expect(named("```\n$$\nx\n$$\n```\n$z$", "math")).toEqual(["z"]);
  });
});

describe("markdownMode — 각주", () => {
  it("참조 [^id] — 이름에 공백 · 대괄호가 없을 때만", () => {
    expect(named("글[^1] 과 [^note]", "footnoteRef")).toEqual(["[^1]", "[^note]"]);
    expect(named("[^a b] [^] \\[^1]", "footnoteRef")).toEqual([]);
  });

  it("정의 줄은 머리만 — 뒤 글은 본문(안의 참조 · 수식은 칠한다)", () => {
    expect(tokens("[^1]: 설명 $x$")).toEqual([
      ["footnoteDef", "[^1]:"],
      ["mathMark", "$"],
      ["math", "x"],
      ["mathMark", "$"],
    ]);
  });

  it("코드 스팬 · 울타리 속 [^x] 는 칠하지 않는다", () => {
    expect(named("`[^1]`", "footnoteRef")).toEqual([]);
    expect(named("```\n[^1]: x [^2]\n```", "footnoteDef")).toEqual([]);
    expect(named("```\n[^1]: x [^2]\n```", "footnoteRef")).toEqual([]);
  });
});
