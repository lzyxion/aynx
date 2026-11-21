import type { KatexOptions } from "katex";

/**
 * KaTeX 선택 — 보안 상한을 여기 한 곳에 둔다.
 * `trust: false` — 문서가 링크 · 그림 요청 · 임의 속성을 HTML 에 심지 못하게. `maxSize` · `maxExpand` — 거대한 상자 · 매크로 폭주로 웹뷰를 멈추지 못하게.
 * `throwOnError: true` — 오류면 원문을 그대로 보인다(받는 쪽이 잡는다).
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

export function mathErrorLine(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return (raw.split("\n")[0] ?? "").replace(/^KaTeX parse error:\s*/, "").trim();
}
