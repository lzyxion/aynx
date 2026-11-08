/**
 * **uPlot 을 늦게 부른다** — 쿼리 결과의 [차트](`query/ResultChart.svelte`)에만 쓰이므로 메인 청크에 들지 않고, 처음 [차트] 를 누를 때
 * 한 번 받아 온다(`katex-loader.ts` · `mermaid-loader.ts` 와 같은 모양). CSS 도 동적 `import()` 라 vite 가 따로 떼어 둔다.
 *
 * 받는 데 실패하면 약속을 버려 다음 [차트] 가 다시 시도한다 — 부르는 쪽은 오류 한 줄을 남기고, [표] 는 그대로 쓸 수 있다.
 */
// 형 선언은 `export = uPlot`(CJS 꼴)이고 번들이 읽는 것은 `uPlot.esm.js` 의 `export default` 다 — 형은 클래스 자체로 잡고,
// 값은 `default` 를 먼저 본다
export type UPlot = typeof import("uplot");

let pending: Promise<UPlot> | null = null;

/** uPlot 을 받는다 — 여러 곳이 동시에 불러도 받기는 한 번. CSS 가 붙은 뒤에 풀린다(범례가 맨 모양으로 먼저 서지 않게) */
export function loadUPlot(): Promise<UPlot> {
  pending ??= Promise.all([import("uplot"), import("uplot/dist/uPlot.min.css")]).then(
    ([m]) => (m as unknown as { default?: UPlot }).default ?? (m as unknown as UPlot),
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}
