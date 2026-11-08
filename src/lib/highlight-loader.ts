/**
 * **강조기를 늦게 부른다** — `highlight.ts`(lowlight + highlight.js 언어들)는 메인 청크에 들지 않고, 처음
 * 강조가 필요할 때 한 번 받아 온다(문서 보기 B6 · docs/log/2026-09-27-doc-tile.md).
 *
 * 받아 오기 전의 코드 보기는 **평문**이고, 도착하면 그 자리에서 강조된다(글자는 같고 색만 붙는다 —
 * 줄 높이·폭이 그대로라 흔들림이 없다). 한 번 받은 뒤에는 [`loadedHighlighter`] 가 곧바로 모듈을 주므로
 * 다음 코드 보기는 첫 프레임부터 강조된다.
 *
 * 받는 데 실패하면(청크 파일이 없는 등) 평문으로 남는다 — 강조는 꾸밈이고, 글은 이미 보이고 있다.
 * 실패한 약속은 버려서 다음 코드 보기가 다시 시도한다.
 */
export type Highlighter = typeof import("$lib/highlight");

let loaded: Highlighter | null = null;
let pending: Promise<Highlighter> | null = null;

/** 이미 받았으면 그 모듈, 아니면 `null` (부르는 쪽은 평문으로 그리고 [`loadHighlighter`] 를 기다린다) */
export function loadedHighlighter(): Highlighter | null {
  return loaded;
}

/** 강조기를 받는다 — 여러 곳이 동시에 불러도 받기는 한 번 */
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
