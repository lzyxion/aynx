/** 배율은 자연 폭(SVG `viewBox` 의 폭) 기준이다 — `null` 은 "맞춤"(mermaid 기본). 저장하지 않는다 */

export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3, 4];
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export type MermaidZoom = number | null;

/** 맞춤 배율(0.6699…)이 단계(0.67)와 같다고 볼 만큼 */
const EPS = 0.005;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** `fit` = 그린 폭 ÷ 자연 폭 */
export function effectiveZoom(z: MermaidZoom, fit: number): number {
  if (z !== null) return z;
  return fit > 0 && Number.isFinite(fit) ? fit : 1;
}

export function zoomIn(z: MermaidZoom, fit: number): number {
  const cur = effectiveZoom(z, fit);
  for (const s of ZOOM_STEPS) if (s > cur + EPS) return s;
  return ZOOM_MAX;
}

export function zoomOut(z: MermaidZoom, fit: number): number {
  const cur = effectiveZoom(z, fit);
  for (let k = ZOOM_STEPS.length - 1; k >= 0; k--) if (ZOOM_STEPS[k] < cur - EPS) return ZOOM_STEPS[k];
  return ZOOM_MIN;
}

export function wheelZoom(z: MermaidZoom, fit: number, deltaY: number): MermaidZoom {
  if (deltaY === 0) return z;
  return deltaY < 0 ? zoomIn(z, fit) : zoomOut(z, fit);
}

export function toggleZoom(z: MermaidZoom): MermaidZoom {
  return z === null ? 1 : null;
}

export function zoomPercent(z: MermaidZoom, fit: number): string {
  return `${Math.round(effectiveZoom(z, fit) * 100)}%`;
}

/** 기준점이 같은 자리에 남는 새 스크롤 — `offset` 은 상자 끝에서 기준점까지 */
export function anchoredScroll(scroll: number, offset: number, from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return Math.max(0, scroll);
  return Math.max(0, ((scroll + offset) * to) / from - offset);
}
