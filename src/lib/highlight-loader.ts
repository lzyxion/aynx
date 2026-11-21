/**
 * 강조기(`highlight.ts`)를 늦게 부른다 — 메인 청크에 들지 않는다. 받기 전의 코드 보기는 평문이다.
 * 실패한 약속은 버려서 다음 코드 보기가 다시 시도한다.
 */
export type Highlighter = typeof import("$lib/highlight");

let loaded: Highlighter | null = null;
let pending: Promise<Highlighter> | null = null;

export function loadedHighlighter(): Highlighter | null {
  return loaded;
}

export function loadHighlighter(): Promise<Highlighter> {
  pending ??= import("$lib/highlight").then(
    (m) => (loaded = m),
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}
