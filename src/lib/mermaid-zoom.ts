/**
 * **mermaid 다이어그램 확대 · 축소의 규칙** — 순수 모듈. 상자 · 휠 · 끌기 · 단추는 `MermaidView` 가 쥔다.
 *
 * 배율은 **자연 폭(SVG `viewBox` 의 폭) 기준**이다 — 100% 는 mermaid 가 그린 제 크기. `null` 은 "맞춤"(mermaid 기본:
 * 타일보다 넓으면 타일 폭에 맞춰 줄고, 좁으면 제 크기)이다. 배율은 그 다이어그램의 한때 값이고 저장하지 않는다.
 */

/** 단추 · `Ctrl+휠` 이 밟는 배율 단계(자연 폭 기준) */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3, 4];
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** 배율 — `null` 은 맞춤 */
export type MermaidZoom = number | null;

/** 단계 사이 비교의 여유 — 맞춤 배율(0.6699…)이 단계(0.67)와 같다고 볼 만큼 */
const EPS = 0.005;

/** 한계 안으로 — 숫자가 아니면 100% */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * 지금 보이는 배율 — 맞춤이면 그 순간의 맞춤 배율(`fit` — 그린 폭 ÷ 자연 폭, 상자보다 좁으면 1). `fit` 을 못 쟀으면 1.
 */
export function effectiveZoom(z: MermaidZoom, fit: number): number {
  if (z !== null) return z;
  return fit > 0 && Number.isFinite(fit) ? fit : 1;
}

/** 한 단계 크게 — 지금 보이는 배율보다 **큰** 첫 단계. 맨 위면 그대로 */
export function zoomIn(z: MermaidZoom, fit: number): number {
  const cur = effectiveZoom(z, fit);
  for (const s of ZOOM_STEPS) if (s > cur + EPS) return s;
  return ZOOM_MAX;
}

/** 한 단계 작게 — 지금 보이는 배율보다 **작은** 마지막 단계. 맨 아래면 그대로 */
export function zoomOut(z: MermaidZoom, fit: number): number {
  const cur = effectiveZoom(z, fit);
  for (let k = ZOOM_STEPS.length - 1; k >= 0; k--) if (ZOOM_STEPS[k] < cur - EPS) return ZOOM_STEPS[k];
  return ZOOM_MIN;
}

/** `Ctrl+휠` — 위로 굴리면(`deltaY < 0`) 크게. 0 이면 그대로 */
export function wheelZoom(z: MermaidZoom, fit: number, deltaY: number): MermaidZoom {
  if (deltaY === 0) return z;
  return deltaY < 0 ? zoomIn(z, fit) : zoomOut(z, fit);
}

/** 더블클릭 — 맞춤이면 100%, 아니면 맞춤 */
export function toggleZoom(z: MermaidZoom): MermaidZoom {
  return z === null ? 1 : null;
}

/** 배율 단추의 글자 — 정수 %(맞춤이면 그 순간의 맞춤 배율) */
export function zoomPercent(z: MermaidZoom, fit: number): string {
  return `${Math.round(effectiveZoom(z, fit) * 100)}%`;
}

/**
 * 배율을 바꾼 뒤 **기준점이 같은 자리에 남게** 하는 새 스크롤 — `offset` 은 상자 왼쪽(위) 끝에서 기준점까지(포인터 ·
 * 상자 가운데), `scroll` 은 바꾸기 전 스크롤. 내용 좌표를 배율 비로 늘리고 다시 뺀다. 음수면 0.
 */
export function anchoredScroll(scroll: number, offset: number, from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return Math.max(0, scroll);
  return Math.max(0, ((scroll + offset) * to) / from - offset);
}
