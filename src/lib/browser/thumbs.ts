// 아이콘 보기의 그림 칸 — 순수 규칙. 상태(캐시 · 줄 · 동시 읽기)는 `thumbs.svelte.ts`.
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
import { imageMime, PREVIEW_MAX_BYTES } from "$lib/browser/preview";
import { ICON_ZOOM_SCALES } from "$lib/browser/file-view";

/** 원격(SFTP)이거나 원격 창이면 바이트가 네트워크를 탄다 */
export const THUMB_NET_MAX_BYTES = 2 * 1024 * 1024;

export const THUMB_CONCURRENCY = 3;

export const THUMB_CACHE_MAX = 300;

/** `theme.css` 의 `--tile-icon-size` 와 같은 값 */
const TILE_ICON_PX = 36;

const THUMB_EDGE_CAP = 256;

/** 로컬 타일을 메인 PC 에서 볼 때만 미리 보기 상한(`readPreview` 의 상한)까지 읽는다 */
export function thumbMaxBytes(localBackend: boolean, remoteWindow: boolean): number {
  return localBackend && !remoteWindow ? PREVIEW_MAX_BYTES : THUMB_NET_MAX_BYTES;
}

export function thumbable(entry: SftpEntry, maxBytes: number): boolean {
  if (isDirLike(entry) || imageMime(entry.name) === null) return false;
  return Number.isFinite(entry.size) && entry.size > 0 && entry.size <= maxBytes;
}

/** 파일이 바뀌지 않았으면 같은 열쇠다 — 백엔드가 다시 붙으면 `backendKey` 가 달라 옛 캐시는 자연히 안 쓰인다 */
export function thumbKey(backendKey: string, entry: SftpEntry): string {
  return `${backendKey}\u0000${entry.path}\u0000${entry.mtime}\u0000${entry.size}`;
}

/** 줄인 그림의 긴 변 — 가장 큰 확대 단계의 글리프 상자를 화면 픽셀로 덮는다 */
export function thumbEdge(dpr: number): number {
  const maxScale = Math.max(...ICON_ZOOM_SCALES);
  const ratio = Number.isFinite(dpr) && dpr > 1 ? dpr : 1;
  return Math.min(THUMB_EDGE_CAP, Math.ceil(TILE_ICON_PX * maxScale * ratio));
}

/** 비율 그대로 긴 변을 `edge` 안에 — 키우지는 않는다 */
export function fitWithin(w: number, h: number, edge: number): { w: number; h: number } {
  const s = Math.min(1, edge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}
