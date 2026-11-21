// 이미지 타일의 보기 셈 — 순수. 좌표는 그림 상자(무대) 안의 px · 보기 `{ scale, x, y }` 는 그림 왼쪽 위가 무대의 (x, y) 에 오고 그림 1px = `scale` 화면 px 이다.
// - 맞춤은 1 을 넘지 않는다(작은 그림을 크게 늘리지 않는다 — 그때 맞춤 = 1:1) · 배율은 저장하지 않는다(열 때마다 맞춤 — `PaneSpec` 에 칸이 없다).

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** 배율 하한 · 상한 — 아주 큰 그림의 맞춤이 하한보다 작으면 맞춤이 이긴다([`clampScale`] 의 `fit`) */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 32;

export const ZOOM_PRESETS: readonly number[] = [0.5, 1, 2, 4];

export const ZOOM_STEP = 1.25;

/** 같은 배율로 볼 여유 — 부동소수 오차로 "맞춤보다 크다" 가 깜빡이지 않게 */
const EPS = 1e-6;

const good = (s: Size): boolean => s.w > 0 && s.h > 0 && Number.isFinite(s.w) && Number.isFinite(s.h);

export function fitScale(img: Size, box: Size): number {
  if (!good(img) || !good(box)) return 1;
  return Math.min(1, box.w / img.w, box.h / img.h);
}

/** 배율을 [`ZOOM_MIN`] ~ [`ZOOM_MAX`] 로 — 단 맞춤이 하한보다 작으면 그 맞춤까지는 내려간다(맞춤 단추가 늘 먹게) */
export function clampScale(scale: number, fit = 1): number {
  const lo = Math.min(ZOOM_MIN, fit);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(lo, scale));
}

function clampAxis(at: number, len: number, box: number): number {
  if (len <= box) return (box - len) / 2;
  return Math.min(0, Math.max(box - len, at));
}

export function clampPan(view: View, img: Size, box: Size): View {
  return {
    scale: view.scale,
    x: clampAxis(view.x, img.w * view.scale, box.w),
    y: clampAxis(view.y, img.h * view.scale, box.h),
  };
}

export function centered(img: Size, box: Size, scale: number): View {
  return { scale, x: (box.w - img.w * scale) / 2, y: (box.h - img.h * scale) / 2 };
}

export function fitView(img: Size, box: Size): View {
  return centered(img, box, fitScale(img, box));
}

export function zoomAt(view: View, img: Size, box: Size, next: number, at: Point): View {
  const scale = clampScale(next, fitScale(img, box));
  if (view.scale <= 0) return clampPan(centered(img, box, scale), img, box);
  const ix = (at.x - view.x) / view.scale;
  const iy = (at.y - view.y) / view.scale;
  return clampPan({ scale, x: at.x - ix * scale, y: at.y - iy * scale }, img, box);
}

export function zoomCentered(view: View, img: Size, box: Size, next: number): View {
  return zoomAt(view, img, box, next, { x: box.w / 2, y: box.h / 2 });
}

export function panBy(view: View, img: Size, box: Size, dx: number, dy: number): View {
  return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, img, box);
}

/** 휠 한 번의 배율 곱 — 한 번에 너무 튀지 않게 묶는다 */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const k = Math.exp(-deltaY * 0.0015);
  return Math.min(2, Math.max(0.5, k));
}

export function stepScale(scale: number, dir: 1 | -1): number {
  return dir > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
}

export function percentOf(scale: number): number {
  return Math.max(1, Math.round(scale * 100));
}

export const NO_ZOOM_LABEL = "—";

export function zoomLabel(scale: number | null): string {
  return scale === null ? NO_ZOOM_LABEL : `${percentOf(scale)}%`;
}

/** 배율 목록의 한 단계 줄이 골라진 것인가 — 맞춤 보기면 어느 단계도 아니다(맞춤 줄만 — 작은 그림의 맞춤이 곧 100% 여도) */
export function presetChecked(fit: boolean, scale: number, preset: number): boolean {
  return !fit && Math.abs(scale - preset) < EPS;
}

/**
 * [맞춤 | 1:1] 의 켬은 하나만 — 배율 목록의 체크와 같은 규칙이다([`presetChecked`]).
 */
export function zoomPressed(hasPicture: boolean, fit: boolean, scale: number): { fit: boolean; actual: boolean } {
  if (!hasPicture) return { fit: false, actual: false };
  return { fit, actual: presetChecked(fit, scale, 1) };
}

export function aboveFit(scale: number, img: Size, box: Size): boolean {
  return scale > fitScale(img, box) + EPS;
}

export function canPan(view: View, img: Size, box: Size): boolean {
  return img.w * view.scale > box.w + EPS || img.h * view.scale > box.h + EPS;
}

export function minimapSize(img: Size, max = 160): Size {
  if (!good(img)) return { w: max, h: max };
  const k = max / Math.max(img.w, img.h);
  return { w: Math.max(1, Math.round(img.w * k)), h: Math.max(1, Math.round(img.h * k)) };
}

export function minimapRect(view: View, img: Size, box: Size, map: Size): { x: number; y: number; w: number; h: number } {
  if (!good(img) || view.scale <= 0) return { x: 0, y: 0, w: map.w, h: map.h };
  const kx = map.w / img.w;
  const ky = map.h / img.h;
  const x0 = Math.max(0, -view.x / view.scale);
  const y0 = Math.max(0, -view.y / view.scale);
  const x1 = Math.min(img.w, (box.w - view.x) / view.scale);
  const y1 = Math.min(img.h, (box.h - view.y) / view.scale);
  return { x: x0 * kx, y: y0 * ky, w: Math.max(0, x1 - x0) * kx, h: Math.max(0, y1 - y0) * ky };
}

export function centerOnMap(view: View, img: Size, box: Size, map: Size, at: Point): View {
  if (!good(img) || !good(map)) return view;
  const ix = (at.x / map.w) * img.w;
  const iy = (at.y / map.h) * img.h;
  return clampPan({ scale: view.scale, x: box.w / 2 - ix * view.scale, y: box.h / 2 - iy * view.scale }, img, box);
}
