/**
 * **mermaid 를 늦게 부른다** — mermaid(다이어그램 → SVG)는 크고(d3 · 배치 엔진 · 다이어그램 종류별 청크) 문서 보기
 * 타일의 ```mermaid 블록에만 쓰이므로 메인 청크에 들지 않는다. 처음 그릴 블록이 생길 때 한 번 받아 온다
 * (`highlight-loader.ts` · `doc-editor-loader.ts` 와 같은 모양).
 *
 * 받는 데 실패하면(청크 파일이 없는 등) 약속을 버려 다음 블록이 다시 시도한다 — 부르는 쪽(`MermaidView`)은
 * 원문 코드 블록 위에 오류 한 줄을 남긴다. 글은 이미 보이고 있다.
 */
export type Mermaid = typeof import("mermaid").default;

let pending: Promise<Mermaid> | null = null;

/** mermaid 를 받는다 — 여러 곳이 동시에 불러도 받기는 한 번 */
export function loadMermaid(): Promise<Mermaid> {
  pending ??= import("mermaid").then(
    (m) => m.default,
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}
