// **이미지 타일의 보기 셈** — 맞춤 배율 · 커서 자리 기준 확대 · 이동 경계 · 배율 단계 · 작은 지도 사각형(순수 · 잎 모듈).
//
// 좌표는 전부 **그림 상자(무대) 안의 px** 다. 보기는 `{ scale, x, y }` — 그림의 왼쪽 위가 무대의 (x, y) 에 오고 한 그림 px 이
// `scale` 화면 px 이다. 화면(`ImageView`)은 이 값으로 `transform` 만 건다 — DOM · 이벤트 · 타이머는 여기 없다.
//
// 규칙:
// - **맞춤**은 그림이 무대 안에 다 들어오는 배율이되 **1 을 넘지 않는다**(작은 그림을 크게 늘리지 않는다 — 그때 맞춤 = 1:1).
// - 이동은 그림이 무대보다 작은 축에서는 가운데에 묶이고, 큰 축에서는 무대 밖으로 빈 곳이 보이지 않게 묶인다([`clampPan`]).
// - 확대 · 축소는 **커서 자리가 그대로 남게**(그 자리의 그림 점이 커서 밑에 머문다) 한 뒤 이동 경계로 묶는다([`zoomAt`]).
// - 배율은 [`ZOOM_MIN`] ~ [`ZOOM_MAX`] 로 묶는다. 저장하지 않는다(열 때마다 맞춤 — `PaneSpec` 에 칸이 없다).

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 지금 보기 — 배율 · 그림 왼쪽 위의 무대 안 자리 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** 배율 하한 · 상한 — 아주 큰 그림의 맞춤이 하한보다 작으면 맞춤이 이긴다([`clampScale`] 의 `fit`) */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 32;

/** 배율 목록(머리줄 `42% ▾`)의 단계 — 맞춤은 따로 맨 위 줄이다 */
export const ZOOM_PRESETS: readonly number[] = [0.5, 1, 2, 4];

/** `+` · `-` 한 번의 곱 */
export const ZOOM_STEP = 1.25;

/** 같은 배율로 볼 여유 — 부동소수 오차로 "맞춤보다 크다" 가 깜빡이지 않게 */
const EPS = 1e-6;

const good = (s: Size): boolean => s.w > 0 && s.h > 0 && Number.isFinite(s.w) && Number.isFinite(s.h);

/** 맞춤 배율 — 그림이 무대에 다 들어오는 배율, **1 을 넘지 않는다**. 크기를 모르면 1 */
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

/** 한 축의 이동 경계 — 그림이 작으면 가운데, 크면 빈 곳이 보이지 않게 */
function clampAxis(at: number, len: number, box: number): number {
  if (len <= box) return (box - len) / 2;
  return Math.min(0, Math.max(box - len, at));
}

/** 보기를 이동 경계로 묶는다 */
export function clampPan(view: View, img: Size, box: Size): View {
  return {
    scale: view.scale,
    x: clampAxis(view.x, img.w * view.scale, box.w),
    y: clampAxis(view.y, img.h * view.scale, box.h),
  };
}

/** 그 배율로 무대 가운데에 둔 보기 */
export function centered(img: Size, box: Size, scale: number): View {
  return { scale, x: (box.w - img.w * scale) / 2, y: (box.h - img.h * scale) / 2 };
}

/** 맞춤 보기 */
export function fitView(img: Size, box: Size): View {
  return centered(img, box, fitScale(img, box));
}

/**
 * **커서 자리 기준 확대 · 축소** — `at`(무대 안 px) 밑의 그림 점이 바뀐 배율에서도 `at` 에 머물게 옮긴 뒤 경계로 묶는다.
 * 배율은 [`clampScale`] 로 묶는다.
 */
export function zoomAt(view: View, img: Size, box: Size, next: number, at: Point): View {
  const scale = clampScale(next, fitScale(img, box));
  if (view.scale <= 0) return clampPan(centered(img, box, scale), img, box);
  const ix = (at.x - view.x) / view.scale;
  const iy = (at.y - view.y) / view.scale;
  return clampPan({ scale, x: at.x - ix * scale, y: at.y - iy * scale }, img, box);
}

/** 무대 가운데 기준 확대 · 축소(키 · 목록) */
export function zoomCentered(view: View, img: Size, box: Size, next: number): View {
  return zoomAt(view, img, box, next, { x: box.w / 2, y: box.h / 2 });
}

/** 끌어서 이동 — 경계로 묶는다 */
export function panBy(view: View, img: Size, box: Size, dx: number, dy: number): View {
  return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, img, box);
}

/** 휠 한 번의 배율 곱 — `deltaY` 가 음수(위로)면 확대. 한 번에 너무 튀지 않게 묶는다 */
export function wheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const k = Math.exp(-deltaY * 0.0015);
  return Math.min(2, Math.max(0.5, k));
}

/** `+` · `-` 한 단계 */
export function stepScale(scale: number, dir: 1 | -1): number {
  return dir > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP;
}

/** 머리줄 배율 글자 — 반올림한 % (0.42 → `42`) */
export function percentOf(scale: number): number {
  return Math.max(1, Math.round(scale * 100));
}

/** 그림이 없을 때(묻기 · 파일 없음 · 그리지 못함 · 받는 중 · 취소됨)의 배율 글자 — 말할 배율이 없다 */
export const NO_ZOOM_LABEL = "—";

/** 머리줄 배율 단추의 글자 — `42%`, 그림이 없으면(`null`) [`NO_ZOOM_LABEL`] */
export function zoomLabel(scale: number | null): string {
  return scale === null ? NO_ZOOM_LABEL : `${percentOf(scale)}%`;
}

/** 배율 목록의 한 단계 줄이 골라진 것인가 — 맞춤 보기면 어느 단계도 아니다(맞춤 줄만 — 작은 그림의 맞춤이 곧 100% 여도) */
export function presetChecked(fit: boolean, scale: number, preset: number): boolean {
  return !fit && Math.abs(scale - preset) < EPS;
}

/**
 * [맞춤 | 1:1] 의 켬 — **하나만** 켠다: 맞춤 보기면 [맞춤], 1:1 은 맞춤이 아닌 보기가 정확히 1 일 때(배율 목록의 체크와 같은 규칙 —
 * [`presetChecked`]). 그림이 없으면 둘 다 끈다.
 */
export function zoomPressed(hasPicture: boolean, fit: boolean, scale: number): { fit: boolean; actual: boolean } {
  if (!hasPicture) return { fit: false, actual: false };
  return { fit, actual: presetChecked(fit, scale, 1) };
}

/** 맞춤보다 크게 보는가 — 작은 지도는 그때만 선다 · 끌어서 이동도 그때만 뜻이 있다 */
export function aboveFit(scale: number, img: Size, box: Size): boolean {
  return scale > fitScale(img, box) + EPS;
}

/** 그림이 무대보다 커서 끌 곳이 있는가(어느 한 축이라도) */
export function canPan(view: View, img: Size, box: Size): boolean {
  return img.w * view.scale > box.w + EPS || img.h * view.scale > box.h + EPS;
}

/** 작은 지도의 크기 — 그림 비율 그대로, 긴 변이 `max` px */
export function minimapSize(img: Size, max = 160): Size {
  if (!good(img)) return { w: max, h: max };
  const k = max / Math.max(img.w, img.h);
  return { w: Math.max(1, Math.round(img.w * k)), h: Math.max(1, Math.round(img.h * k)) };
}

/** 작은 지도 위의 **지금 보는 사각형** — 지도 px(지도 밖으로 넘치지 않게 자른다) */
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

/** 작은 지도의 한 점(지도 px)을 무대 가운데로 — 지도를 누르거나 끌 때 */
export function centerOnMap(view: View, img: Size, box: Size, map: Size, at: Point): View {
  if (!good(img) || !good(map)) return view;
  const ix = (at.x / map.w) * img.w;
  const iy = (at.y / map.h) * img.h;
  return clampPan({ scale: view.scale, x: box.w / 2 - ix * view.scale, y: box.h / 2 - iy * view.scale }, img, box);
}
