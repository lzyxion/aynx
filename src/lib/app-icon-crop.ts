/** 사용자 앱 아이콘 자르기의 순수 계산 — 영역은 그림 화소 좌표의 정사각이고 늘 그림 안에 있다 */

export interface Crop {
  x: number;
  y: number;
  size: number;
}

/** `scale` = 무대 px / 그림 px */
export interface Stage {
  scale: number;
  left: number;
  top: number;
}

/** 끄는 쪽 — 반대 모서리가 고정점이다 */
export type Corner = "nw" | "ne" | "sw" | "se";

export const MIN_CROP = 16;
/** 작으면 캔버스가 키우고(Rust 는 256px 로 맞춘다), 크면 줄여 보낸다 */
export const OUT_MIN = 256;
export const OUT_MAX = 1024;

export function fitStage(w: number, h: number, box: number): Stage {
  const scale = Math.min(box / w, box / h);
  return { scale, left: (box - w * scale) / 2, top: (box - h * scale) / 2 };
}

export function initialCrop(w: number, h: number): Crop {
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

function minSide(w: number, h: number): number {
  return Math.min(MIN_CROP, w, h);
}

export function clampCrop(c: Crop, w: number, h: number): Crop {
  const size = Math.min(Math.max(c.size, minSide(w, h)), Math.min(w, h));
  return {
    x: Math.min(Math.max(c.x, 0), w - size),
    y: Math.min(Math.max(c.y, 0), h - size),
    size,
  };
}

export function moveCrop(c: Crop, dx: number, dy: number, w: number, h: number): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, w, h);
}

export function resizeCrop(c: Crop, corner: Corner, dx: number, dy: number, w: number, h: number): Crop {
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "sw" || corner === "se" ? 1 : -1;
  const ax = sx > 0 ? c.x : c.x + c.size;
  const ay = sy > 0 ? c.y : c.y + c.size;
  const room = Math.min(sx > 0 ? w - ax : ax, sy > 0 ? h - ay : ay);
  const want = c.size + (sx * dx + sy * dy) / 2;
  const size = Math.min(Math.max(want, minSide(w, h)), room);
  return { x: sx > 0 ? ax : ax - size, y: sy > 0 ? ay : ay - size, size };
}

export function zoomCrop(c: Crop, factor: number, w: number, h: number): Crop {
  const size = Math.min(Math.max(c.size * factor, minSide(w, h)), Math.min(w, h));
  const cx = c.x + c.size / 2;
  const cy = c.y + c.size / 2;
  return clampCrop({ x: cx - size / 2, y: cy - size / 2, size }, w, h);
}

export function cropOnStage(c: Crop, s: Stage): { left: number; top: number; size: number } {
  return { left: s.left + c.x * s.scale, top: s.top + c.y * s.scale, size: c.size * s.scale };
}

export function outputSide(c: Crop): number {
  return Math.min(OUT_MAX, Math.max(OUT_MIN, Math.round(c.size)));
}

export function previewBackground(c: Crop, w: number, h: number, box: number): { size: string; position: string } {
  const k = box / c.size;
  return { size: `${w * k}px ${h * k}px`, position: `${-c.x * k}px ${-c.y * k}px` };
}

/** Rust `app_icon/user.rs` 의 `INSET`(5.2) · `RADIUS`(46) 를 256px 비율로 옮긴 값 — 바꾸면 그쪽과 함께 */
export const PREVIEW_CLIP = `inset(${((5.2 / 256) * 100).toFixed(3)}% round ${((46 / 256) * 100).toFixed(3)}%)`;
