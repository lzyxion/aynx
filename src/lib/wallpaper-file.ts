// 원격 창은 메인 PC 의 열기 대화상자를 못 쓰므로 이 기기에서 고른 그림의 바이트를 `wallpaper_set_bytes` 로 올린다.
import { pickDeviceFiles } from "$lib/browser/device-pick";
import { invoke } from "$lib/ipc";
import type { Tr } from "$lib/session";
import { rawUploadTooBig } from "$lib/sftp";

/** Rust `wallpaper.rs` 의 `ALLOWED_EXTS` 와 같은 목록 — 웹뷰가 디코드할 수 있는 것만 */
export const WALLPAPER_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"] as const;

export const WALLPAPER_ACCEPT = WALLPAPER_EXTENSIONS.map((ext) => "." + ext).join(",");

/** Rust `wallpaper.rs` 의 `MAX_BYTES`(50MB) 와 같은 값 — 원격 창에서는 `rawBodyLimit` 가 원시 본문 상한(15MiB)으로 줄인다 */
export const WALLPAPER_MAX_BYTES = 50 * 1024 * 1024;

export type DeviceWallpaperPick = { file: File } | { error: string } | null;

/** 원격 창 전용 — 첫 `await` 앞에서 고르기 창을 연다 — 몸짓 사슬 */
export async function pickDeviceWallpaper(tr: Tr): Promise<DeviceWallpaperPick> {
  const [file] = await pickDeviceFiles(WALLPAPER_ACCEPT, false);
  if (!file) return null;
  const tooBig = rawUploadTooBig(file.size, WALLPAPER_MAX_BYTES, "files.transfer.toobig.upload", tr, true);
  return tooBig === null ? { file } : { error: tooBig };
}

/** 원본 이름은 헤더 `x-file-name`(퍼센트 인코딩)이고 Rust 는 확장자를 고르는 데만 쓴다 */
export async function uploadWallpaper(file: File): Promise<string> {
  const body = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("wallpaper_set_bytes", body, { headers: { "x-file-name": encodeURIComponent(file.name) } });
}
