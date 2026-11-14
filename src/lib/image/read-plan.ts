// **이미지 타일의 읽기 계획** — 파일 크기(`stat`)로 어떻게 받을지 정한다(순수 · 잎에 가깝다).
//
// | 크기 | 계획 | 길 |
// | --- | --- | --- |
// | ≤ [`PREVIEW_MAX_BYTES`](20 MB) | `direct` | `FsBackend.readPreview` 한 번 — 미리 보기 패널과 같은 길 |
// | ~ [`IMAGE_CONFIRM_BYTES`](500 MB) 미만 | `progress` | `FsBackend.readImage` — 조각 · 진행 막대 · [취소] |
// | ≥ 500 MB | `confirm` → (그래도 열기) `progress` | 읽기 전에 한 번 묻는다 |
// | > [`IMAGE_MAX_BYTES`](1 GB) | `too-large` | 읽지 않는다 — 기본 앱 · 외부 편집기로 |
//
// 상한들은 이미지 타일에만 넓힌 것이다 — 미리 보기 패널과 `*_read_preview` 의 20 MB 는 그대로다. [`IMAGE_MAX_BYTES`] 는 Rust
// `text_file::IMAGE_MAX_BYTES` 의 짝이라 그쪽이 바뀌면 여기도 고친다.

import { PREVIEW_MAX_BYTES } from "$lib/browser/preview";

/** 이 크기 이상이면 읽기 전에 묻는다 */
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

/** 진행 막대의 몫(0~1) — 전체를 모르면 0 */
export function progressRatio(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) return 0;
  return Math.min(1, Math.max(0, done / total));
}
