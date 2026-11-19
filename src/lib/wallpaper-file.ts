/**
 * **배경 그림 고르기의 순수 규칙 · 원격 창 갈래**(2026-11-19) — 상태(`wallpaper`)와 끝(`applyCopy`)은 `wallpaper.svelte.ts`.
 *
 * 메인 PC 창의 [이미지 선택…]은 메인 PC 의 열기 대화상자(`extensions` = [`WALLPAPER_EXTENSIONS`])를 열고 경로를 `wallpaper_set` 에 넘긴다.
 * 원격 창은 그 대화상자를 못 쓰므로 **이 기기의 고르기 창**(`accept` = 같은 목록의 [`WALLPAPER_ACCEPT`])에서 그림 하나를 받아 그
 * 바이트를 `wallpaper_set_bytes` 로 올린다 — 그 뒤(사본 · 설정에 걸기 · 색 다시 뽑기 · 다른 창에 알리기)는 두 창이 같다.
 */
import { pickDeviceFiles } from "$lib/browser/device-pick";
import { invoke } from "$lib/ipc";
import type { Tr } from "$lib/session";
import { rawUploadTooBig } from "$lib/sftp";

/** 받는 확장자 — Rust `wallpaper.rs` 의 `ALLOWED_EXTS` 와 **같은 목록**(웹뷰가 디코드할 수 있는 것만) */
export const WALLPAPER_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"] as const;

/** 브라우저 파일 고르기 창의 `accept` — [`WALLPAPER_EXTENSIONS`] 그대로 */
export const WALLPAPER_ACCEPT = WALLPAPER_EXTENSIONS.map((ext) => "." + ext).join(",");

/** Rust `wallpaper.rs` 의 `MAX_BYTES`(50MB) 와 같은 값 — 원격 창에서는 `rawBodyLimit` 가 원시 본문 상한(15MiB)으로 줄인다 */
export const WALLPAPER_MAX_BYTES = 50 * 1024 * 1024;

/** 이 기기에서 고른 결과 — 취소면 `null` */
export type DeviceWallpaperPick = { file: File } | { error: string } | null;

/**
 * **원격 창 전용** — 이 기기의 고르기 창(그림 하나)을 열고, 원격 창 상한을 넘는 그림은 올리기 전에 거절 문구로 돌려준다
 * (파일 타일의 올리기와 같은 `files.transfer.toobig.device.upload`). 첫 `await` 앞에서 고르기 창을 연다 — 몸짓 사슬.
 */
export async function pickDeviceWallpaper(tr: Tr): Promise<DeviceWallpaperPick> {
  const [file] = await pickDeviceFiles(WALLPAPER_ACCEPT, false);
  if (!file) return null;
  // 원격 창 갈래에서만 불리므로 `remoteWindow` 는 늘 참 — 메인 창 문구(`mainKey`)는 쓰이지 않는다.
  const tooBig = rawUploadTooBig(file.size, WALLPAPER_MAX_BYTES, "files.transfer.toobig.upload", tr, true);
  return tooBig === null ? { file } : { error: tooBig };
}

/**
 * 고른 그림의 바이트를 메인 PC 로 올려 배경으로 건다(`wallpaper_set_bytes`) — 돌려주는 값은 `wallpaper_set` 과 같은 **사본의 절대 경로**.
 * 모양은 `fs-ops.ts` 의 `localWriteFile` 과 같다 — 내용은 raw 바디, 원본 이름은 헤더 `x-file-name`(퍼센트 인코딩 · 확장자를 고르는 데만 쓴다).
 */
export async function uploadWallpaper(file: File): Promise<string> {
  const body = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("wallpaper_set_bytes", body, { headers: { "x-file-name": encodeURIComponent(file.name) } });
}
