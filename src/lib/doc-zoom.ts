/** 문서 타일 글자 크기 — 퍼센트 정수(100 = 기본). `PaneSpec.docZoom` 에 적히고 100 이면 키가 없다. */

export const DOC_ZOOM_STEPS: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const DOC_ZOOM_DEFAULT = 100;
export const DOC_ZOOM_MIN = DOC_ZOOM_STEPS[0];
export const DOC_ZOOM_MAX = DOC_ZOOM_STEPS[DOC_ZOOM_STEPS.length - 1];

export function clampDocZoom(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  let best = DOC_ZOOM_STEPS[0];
  for (const s of DOC_ZOOM_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

export function docZoomIn(z: number): number {
  for (const s of DOC_ZOOM_STEPS) if (s > z) return s;
  return DOC_ZOOM_MAX;
}

export function docZoomOut(z: number): number {
  for (let k = DOC_ZOOM_STEPS.length - 1; k >= 0; k--) if (DOC_ZOOM_STEPS[k] < z) return DOC_ZOOM_STEPS[k];
  return DOC_ZOOM_MIN;
}

export function wheelDocZoom(z: number, deltaY: number): number {
  if (deltaY === 0) return z;
  return deltaY < 0 ? docZoomIn(z) : docZoomOut(z);
}
