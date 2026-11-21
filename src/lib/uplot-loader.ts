// uPlot 을 메인 청크 밖에서 늦게 부른다.
// 형 선언은 `export = uPlot`(CJS 꼴)이고 번들이 읽는 것은 `uPlot.esm.js` 의 `export default` 다 — 값은 `default` 를 먼저 본다
export type UPlot = typeof import("uplot");

let pending: Promise<UPlot> | null = null;

/** CSS 가 붙은 뒤에 풀린다 — 범례가 맨 모양으로 먼저 서지 않게 */
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
