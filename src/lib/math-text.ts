import type { KatexOptions } from "katex";

/**
 * **수식 그리기의 순수 규칙** — KaTeX 선택(보안 상한 포함)과 오류 한 줄. 그리기는 `MathView.svelte`, 받기는 `katex-loader.ts`.
 *
 * - `trust: false` — `\href` · `\url` · `\includegraphics` · `\htmlClass` · `\htmlId` · `\htmlStyle` · `\htmlData` 를
 *   막는다(문서가 링크 · 그림 요청 · 임의 속성을 HTML 에 심지 못한다). 막힌 명령은 글자(오류 색)로 남는다.
 * - `maxSize` · `maxExpand` — 거대한 상자 · 매크로 폭주(`\def\a{\a\a}`)로 웹뷰를 멈추지 못하게.
 * - `strict: "ignore"` — LaTeX 와 어긋나는 사소한 표기(유니코드 글자 등)는 그냥 그린다(경고를 콘솔에 쌓지 않는다).
 * - `throwOnError: true` — 문법 오류면 KaTeX 의 빨간 글자 대신 **원문을 그대로** 보이고 까닭을 흐린 툴팁으로 둔다
 *   (mermaid 와 같은 "잃는 것이 없게"). 그래서 오류는 받는 쪽이 잡는다.
 * - `output: "htmlAndMathml"` — 화면 읽기 프로그램이 MathML 을 읽는다(보이는 것은 HTML 쪽 — KaTeX CSS 가 MathML 을 숨긴다).
 */
export function katexOptions(displayMode: boolean): KatexOptions {
  return {
    displayMode,
    throwOnError: true,
    trust: false,
    strict: "ignore",
    maxSize: 20,
    maxExpand: 500,
    output: "htmlAndMathml",
  };
}

/** KaTeX 오류 → 한 줄(앞의 "KaTeX parse error: " 는 뗀다). 빈 글이면 빈 글자 */
export function mathErrorLine(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return (raw.split("\n")[0] ?? "").replace(/^KaTeX parse error:\s*/, "").trim();
}
