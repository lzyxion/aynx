/**
 * **```svg 블록의 순수 규칙** — 그리기(`SvgView.svelte`)와 떼어 시험한다(2026-10-24 — 사이드 채팅 · 문서 보기 타일의 `diagrams`).
 *
 * 그리기는 `Blob(image/svg+xml)` → `blob:` 주소 → **`<img>` 하나**뿐이다(`innerHTML` 로 붙이지 않는다). `<img>` 문맥의 SVG 는
 * 스크립트가 돌지 않고 바깥 자원(`<image href>` · 글꼴 · CSS `@import`)도 읽지 않는다 — 문서 타일 그림(`doc-images.ts` 머리말) ·
 * 파일 타일 미리 보기와 같은 규칙이다. 그래서 여기서 SVG 글을 걸러 내지(정화) 않는다. 거르는 것은 크기와 "SVG 처럼 보이는가" 둘뿐이다.
 */

/** 이보다 긴 SVG 글(UTF-8 바이트)은 그리지 않고 원문 코드 블록으로 둔다 — 채팅 말 한 덩어리에 넉넉한 크기 */
export const SVG_MAX_BYTES = 512 * 1024;

/** 펜스 언어가 svg 인가 — 대소문자와 앞뒤 공백은 가리지 않는다 */
export function isSvgLang(lang: string | null | undefined): boolean {
  return (lang ?? "").trim().toLowerCase() === "svg";
}

/**
 * 그 글을 그림으로 그릴지.
 * - `draw` — 그린다
 * - `large` — [`SVG_MAX_BYTES`] 를 넘는다
 * - `not-svg` — `<svg` 여는 태그가 없다(설명 글 · 조각 — 원문 그대로가 낫다)
 */
export function svgPlan(text: string): "draw" | "large" | "not-svg" {
  // 글자 수 × 3 이 상한 안이면 재지 않아도 된다(UTF-8 은 한 글자에 3바이트를 넘지 않는다 — 써로게이트 쌍은 2칸에 4바이트)
  if (text.length * 3 > SVG_MAX_BYTES && new TextEncoder().encode(text).byteLength > SVG_MAX_BYTES) return "large";
  return /<svg[\s>/]/i.test(text) ? "draw" : "not-svg";
}
