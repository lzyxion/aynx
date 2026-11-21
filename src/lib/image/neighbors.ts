// 이미지 타일의 같은 폴더 이웃 — 그 폴더 목록에서 그림만 골라 지금 그림의 자리와 이전/다음을 정한다(순수).
// - 차례는 백엔드 목록 그대로다(Rust `fs_entry::sort_entries`) — 여기서 다시 정렬하지 않는다(두 규칙이 갈라지지 않게).
// - 지금 그림은 이름으로 찾는다(경로 글자가 `C:/a/b.png` · `C:\a\b.png` 처럼 달라도 짝이 맞게) · 지금 그림이 숨김이면 그것만은 남긴다.

import { imageMime } from "$lib/browser/preview";
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";

/** 그 폴더의 그림 목록과 지금 그림의 자리(-1 = 목록에 없다 — 지워졌거나 아직 안 보인다) */
export interface ImageSiblings {
  list: SftpEntry[];
  index: number;
  /** `index` 가 -1 일 때 지금 그림이 있던(들어갈) 빈자리 — 이전 = `list[gap-1]` · 다음 = `list[gap]`([`withoutCurrent`]) */
  gap?: number;
}

export function imageBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

export function imageSiblings(entries: readonly SftpEntry[], currentPath: string, caseInsensitive: boolean): ImageSiblings {
  const name = imageBaseName(currentPath);
  const same = (e: SftpEntry) => e.name === name || (caseInsensitive && e.name.toLowerCase() === name.toLowerCase());
  const list = entries.filter((e) => !isDirLike(e) && imageMime(e.name) !== null && (!e.hidden || same(e)));
  let index = list.findIndex((e) => e.name === name);
  if (index < 0 && caseInsensitive) index = list.findIndex(same);
  return { list, index };
}

export function neighborPath(s: ImageSiblings, dir: 1 | -1): string | null {
  let at: number;
  if (s.index >= 0) at = s.index + dir;
  else if (s.gap !== undefined) at = dir < 0 ? s.gap - 1 : s.gap;
  else return null;
  return at >= 0 && at < s.list.length ? s.list[at].path : null;
}

export function withoutCurrent(s: ImageSiblings, currentPath: string): ImageSiblings {
  if (s.index >= 0) return { list: s.list.filter((_, i) => i !== s.index), index: -1, gap: s.index };
  const name = imageBaseName(currentPath).toLowerCase();
  let gap = 0;
  while (gap < s.list.length && s.list[gap].name.toLowerCase() < name) gap++;
  return { list: s.list, index: -1, gap };
}

export function withoutEntry(entries: readonly SftpEntry[], gonePath: string, caseInsensitive: boolean): readonly SftpEntry[] {
  const name = imageBaseName(gonePath);
  let at = entries.findIndex((e) => e.name === name);
  if (at < 0 && caseInsensitive) at = entries.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
  return at < 0 ? entries : entries.filter((_, i) => i !== at);
}

export function siblingCounter(s: ImageSiblings): { at: number; total: number } | null {
  if (s.index < 0 || s.list.length < 2) return null;
  return { at: s.index + 1, total: s.list.length };
}
