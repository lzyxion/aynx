/**
 * **사용자 앱 아이콘 자르기의 순수 계산** — 그림 위의 정사각 영역(그림 화소 좌표)과 화면 무대(정사각 상자) 사이의 변환 · 이동 ·
 * 모서리 끌기 · 휠 확대 · 내보낼 한 변 (docs/log/2026-10-22-custom-app-icon.md). 그리기 · 포인터 배선은 `dialogs/AppIconCropDialog.svelte`.
 *
 * 영역은 늘 그림 안에 있고(`clampCrop`) 정사각이다. 무대는 그림을 "contain" 으로 가운데에 놓는다(`fitStage`). 잎 모듈이다.
 */

/** 그림 화소 좌표의 정사각 영역 — 왼쪽 위 `(x, y)` · 한 변 `size` */
export interface Crop {
  x: number;
  y: number;
  size: number;
}

/** 그림을 무대에 놓은 모양 — 배율(무대 px / 그림 px)과 그림 왼쪽 위의 무대 좌표 */
export interface Stage {
  scale: number;
  left: number;
  top: number;
}

/** 모서리 — 끄는 쪽. 반대 모서리가 고정점이다 */
export type Corner = "nw" | "ne" | "sw" | "se";

/** 영역 한 변의 하한(그림 px) — 그림이 이보다 작으면 그림의 짧은 변이 하한이다 */
export const MIN_CROP = 16;
/** 내보낼 PNG 한 변의 범위 — 작으면 캔버스가 키우고(Rust 는 256px 로 맞춘다), 크면 줄여 보낸다(바이트 · 디코드 메모리) */
export const OUT_MIN = 256;
export const OUT_MAX = 1024;

/** 그림 `w×h` 를 한 변 `box` 무대에 "contain" 으로 가운데 놓는다 */
export function fitStage(w: number, h: number, box: number): Stage {
  const scale = Math.min(box / w, box / h);
  return { scale, left: (box - w * scale) / 2, top: (box - h * scale) / 2 };
}

/** 처음 영역 — 짧은 변 전체를 쓰는 가운데 정사각 */
export function initialCrop(w: number, h: number): Crop {
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

/** 영역 한 변의 하한 — [`MIN_CROP`] 과 그림 짧은 변 중 작은 것 */
function minSide(w: number, h: number): number {
  return Math.min(MIN_CROP, w, h);
}

/** 영역을 그림 안으로 — 한 변은 [하한, 짧은 변], 위치는 그림 밖으로 나가지 않게 */
export function clampCrop(c: Crop, w: number, h: number): Crop {
  const size = Math.min(Math.max(c.size, minSide(w, h)), Math.min(w, h));
  return {
    x: Math.min(Math.max(c.x, 0), w - size),
    y: Math.min(Math.max(c.y, 0), h - size),
    size,
  };
}

/** 영역을 그림 px `(dx, dy)` 만큼 옮긴다(한 변은 그대로) */
export function moveCrop(c: Crop, dx: number, dy: number, w: number, h: number): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, w, h);
}

/**
 * 모서리를 그림 px `(dx, dy)` 만큼 끈다 — 반대 모서리를 고정점으로 정사각을 늘이고 줄인다. 한 변의 변화는 두 축 변화의
 * 평균(대각선 쪽으로 끈 만큼)이고, 고정점에서 그 방향으로 그림 끝까지가 상한이다.
 */
export function resizeCrop(c: Crop, corner: Corner, dx: number, dy: number, w: number, h: number): Crop {
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "sw" || corner === "se" ? 1 : -1;
  // 고정점(반대 모서리) — 오른쪽으로 끌면 왼쪽 변이, 아래로 끌면 위 변이 고정이다.
  const ax = sx > 0 ? c.x : c.x + c.size;
  const ay = sy > 0 ? c.y : c.y + c.size;
  const room = Math.min(sx > 0 ? w - ax : ax, sy > 0 ? h - ay : ay);
  const want = c.size + (sx * dx + sy * dy) / 2;
  const size = Math.min(Math.max(want, minSide(w, h)), room);
  return { x: sx > 0 ? ax : ax - size, y: sy > 0 ? ay : ay - size, size };
}

/** 가운데를 그대로 두고 한 변을 `factor` 배로(휠 확대 · 축소) */
export function zoomCrop(c: Crop, factor: number, w: number, h: number): Crop {
  const size = Math.min(Math.max(c.size * factor, minSide(w, h)), Math.min(w, h));
  const cx = c.x + c.size / 2;
  const cy = c.y + c.size / 2;
  return clampCrop({ x: cx - size / 2, y: cy - size / 2, size }, w, h);
}

/** 영역의 무대 좌표(그리기용) */
export function cropOnStage(c: Crop, s: Stage): { left: number; top: number; size: number } {
  return { left: s.left + c.x * s.scale, top: s.top + c.y * s.scale, size: c.size * s.scale };
}

/** 내보낼 PNG 한 변 — 영역 한 변(그림 px)을 [`OUT_MIN`]..[`OUT_MAX`] 로 자른다 */
export function outputSide(c: Crop): number {
  return Math.min(OUT_MAX, Math.max(OUT_MIN, Math.round(c.size)));
}

/**
 * 미리보기 상자(한 변 `box` px)의 CSS 배경 — 영역이 상자를 꽉 채우게 그림을 놓는다(`background-size` · `background-position`).
 * 둥근 모양은 CSS `clip-path` 가 맡는다([`PREVIEW_CLIP`]).
 */
export function previewBackground(c: Crop, w: number, h: number, box: number): { size: string; position: string } {
  const k = box / c.size;
  return { size: `${w * k}px ${h * k}px`, position: `${-c.x * k}px ${-c.y * k}px` };
}

/**
 * 결과 아이콘과 같은 둥근 사각 — Rust `app_icon/user.rs` 의 `INSET`(5.2) · `RADIUS`(46) 를 256px 에 대한 비율로 옮긴 것.
 * 미리보기가 저장될 모양을 그대로 보여 준다(값을 바꾸면 그쪽과 함께).
 */
export const PREVIEW_CLIP = `inset(${((5.2 / 256) * 100).toFixed(3)}% round ${((46 / 256) * 100).toFixed(3)}%)`;
