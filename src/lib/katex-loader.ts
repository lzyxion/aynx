/** KaTeX 본체 · CSS · 글꼴은 메인 청크에 들지 않는다 — 처음 그릴 수식이 생길 때 받는다. 실패하면 약속을 버려 다음 수식이 다시 시도한다 */
export type Katex = typeof import("katex").default;

let pending: Promise<Katex> | null = null;
let loaded: Katex | null = null;

/** CSS 가 붙은 뒤에 풀린다 — 글자 모양이 먼저 서지 않게 */
export function loadKatex(): Promise<Katex> {
  pending ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([m]) => (loaded = m.default),
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

/** 다시 그려지는 수식이 첫 프레임부터 그림이게(원문이 한 번 번쩍이지 않게) */
export function loadedKatex(): Katex | null {
  return loaded;
}
