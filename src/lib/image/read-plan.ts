// 이미지 타일의 읽기 계획 — 파일 크기(`stat`)로 어떻게 받을지 정한다(순수).
// 상한들은 이미지 타일에만 넓힌 것이다 — 미리 보기 패널과 `*_read_preview` 의 20 MB 는 그대로다.

import { PREVIEW_MAX_BYTES } from "$lib/browser/preview";

export const IMAGE_CONFIRM_BYTES = 500 * 1024 * 1024;

/** 이미지 타일이 받는 그림의 상한 — Rust `text_file::IMAGE_MAX_BYTES` 와 같은 값 */
export const IMAGE_MAX_BYTES = 1024 * 1024 * 1024;

export type ImageReadPlan = "direct" | "progress" | "confirm" | "too-large";

/** 크기 → 계획. `confirmed` 는 사람이 [그래도 열기] 를 눌렀는가(그 파일 그 크기에 한 번) */
export function imageReadPlan(size: number, confirmed: boolean): ImageReadPlan {
  if (!Number.isFinite(size) || size < 0) return "direct";
  if (size > IMAGE_MAX_BYTES) return "too-large";
  if (size <= PREVIEW_MAX_BYTES) return "direct";
  if (size >= IMAGE_CONFIRM_BYTES && !confirmed) return "confirm";
  return "progress";
}

export function progressRatio(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) return 0;
  return Math.min(1, Math.max(0, done / total));
}
