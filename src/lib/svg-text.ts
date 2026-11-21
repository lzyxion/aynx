/**
 * ```svg 블록의 순수 규칙. SVG 글을 정화하지 않는다 — 그리기는 `blob:` 주소의 `<img>` 하나뿐이라(`innerHTML` 로 붙이지 않는다)
 * 스크립트가 돌지 않고 바깥 자원도 읽지 않는다(`doc-images.ts` 머리말과 같은 규칙). 이 전제가 깨지면 정화가 필요하다.
 */

/** UTF-8 바이트 */
export const SVG_MAX_BYTES = 512 * 1024;

export function isSvgLang(lang: string | null | undefined): boolean {
  return (lang ?? "").trim().toLowerCase() === "svg";
}

export function svgPlan(text: string): "draw" | "large" | "not-svg" {
  // UTF-8 은 UTF-16 한 칸에 3바이트를 넘지 않는다(써로게이트 쌍은 2칸에 4바이트)
  if (text.length * 3 > SVG_MAX_BYTES && new TextEncoder().encode(text).byteLength > SVG_MAX_BYTES) return "large";
  return /<svg[\s>/]/i.test(text) ? "draw" : "not-svg";
}
