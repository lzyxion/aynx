/**
 * **KaTeX 를 늦게 부른다** — 수식(`$…$` · `$$…$$` · ```math)은 문서 보기 타일에서만, 그것도 수식이 있는 문서에서만 그린다.
 * KaTeX 본체 · CSS · 글꼴(woff2 등 — CSS 가 `url()` 로 부른다)은 메인 청크에 들지 않고 처음 그릴 수식이 생길 때 한 번
 * 받아 온다(`mermaid-loader.ts` · `highlight-loader.ts` 와 같은 모양). CSS 도 동적 `import()` 라 vite 가 따로 떼어 둔다 —
 * 글꼴은 그 CSS 가 실제로 그 글자를 그릴 때 웹뷰가 받는다.
 *
 * 받는 데 실패하면 약속을 버려 다음 수식이 다시 시도한다 — 부르는 쪽(`MathView`)은 원문을 그대로 보이고 있다.
 */
export type Katex = typeof import("katex").default;

let pending: Promise<Katex> | null = null;
let loaded: Katex | null = null;

/** KaTeX 를 받는다 — 여러 곳이 동시에 불러도 받기는 한 번. CSS 가 붙은 뒤에 풀린다(글자 모양이 먼저 서지 않게) */
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

/** 이미 받아 왔으면 그것 — 다시 그려지는 수식이 첫 프레임부터 그림이게(원문이 한 번 번쩍이지 않게) */
export function loadedKatex(): Katex | null {
  return loaded;
}
