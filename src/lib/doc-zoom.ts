/**
 * **문서 타일 글자 크기의 규칙** — 순수 모듈. 휠 · 단추 · CSS 변수는 `DocView` 가 쥔다.
 *
 * 배율은 **퍼센트 정수**다(100 = 기본). 글자 크기만 바꾸는 배율이라(`zoom` 속성이 아니라 `font-size` 의 곱) 줄 바꿈이
 * 타일 폭에 맞춰 다시 흐른다. 타일의 것이라 `PaneSpec.docZoom` 에 적히고, **100 이면 키가 없다**.
 */

/** `Ctrl+휠` 이 밟는 단계(%) */
export const DOC_ZOOM_STEPS: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const DOC_ZOOM_DEFAULT = 100;
export const DOC_ZOOM_MIN = DOC_ZOOM_STEPS[0];
export const DOC_ZOOM_MAX = DOC_ZOOM_STEPS[DOC_ZOOM_STEPS.length - 1];

/**
 * 파일 · 배치에서 읽은 값 — 유한한 숫자면 **가장 가까운 단계**로(범위 밖은 끝 단계), 아니면 `null`.
 * 손으로 적은 130 을 버리기보다 가까운 125 로 두는 편이 크게 보고 싶던 뜻에 가깝다.
 */
export function clampDocZoom(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  let best = DOC_ZOOM_STEPS[0];
  for (const s of DOC_ZOOM_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** 한 단계 크게 — 지금보다 **큰** 첫 단계. 맨 위면 그대로 */
export function docZoomIn(z: number): number {
  for (const s of DOC_ZOOM_STEPS) if (s > z) return s;
  return DOC_ZOOM_MAX;
}

/** 한 단계 작게 — 지금보다 **작은** 마지막 단계. 맨 아래면 그대로 */
export function docZoomOut(z: number): number {
  for (let k = DOC_ZOOM_STEPS.length - 1; k >= 0; k--) if (DOC_ZOOM_STEPS[k] < z) return DOC_ZOOM_STEPS[k];
  return DOC_ZOOM_MIN;
}

/** `Ctrl+휠` — 위로 굴리면(`deltaY < 0`) 크게. 0 이면 그대로 */
export function wheelDocZoom(z: number, deltaY: number): number {
  if (deltaY === 0) return z;
  return deltaY < 0 ? docZoomIn(z) : docZoomOut(z);
}
