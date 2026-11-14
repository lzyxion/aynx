// **이미지 타일의 같은 폴더 이웃** — 그 폴더 목록에서 그림만 골라 지금 그림의 자리와 이전/다음을 정한다(순수).
//
// - 차례는 **백엔드 목록 그대로**다 — 파일 타일의 기본 정렬과 같은 것(Rust `fs_entry::sort_entries`: 폴더 먼저 · 이름 소문자 오름차순).
//   여기서 다시 정렬하지 않는다(두 규칙이 갈라지지 않게).
// - 그림 판정은 `browser/preview.ts` 의 `imageMime` 표 하나다. 폴더 · 폴더를 가리키는 링크는 빠진다.
// - 숨김 파일은 파일 타일 기본(숨김 안 보임)과 같이 빼되, **지금 그림이 숨김이면 그것만은 남긴다**(제 자리를 잃지 않게).
// - 끝에서는 **멈춘다**(순환하지 않는다) — 머리줄의 `3 / 12` 가 끝을 말하고 단추가 흐려진다.
// - 지금 그림은 **이름으로** 찾는다(같은 폴더라 이름이 곧 열쇠 — 터미널에서 온 `C:/a/b.png` 와 목록의 `C:\a\b.png` 처럼 경로 글자가
//   달라도 짝이 맞는다). 로컬(대소문자 무시 파일 시스템)이면 대소문자를 가리지 않고 한 번 더 찾는다.
// - 지금 그림이 **없어지면**(파일 없음) [`withoutCurrent`] 가 목록에서 그것을 빼고 그 빈자리(`gap`)만 기억한다 — `3 / 12` 는 서지 않고
//   (사라진 그림을 세지 않는다) 이전/다음은 남은 이웃으로 간다. 이미 빠진 목록(다시 읽은 폴더)이면 빈자리는 목록 차례(이름 소문자 오름차순)
//   에서 그 이름이 들어갈 자리다 — 다시 정렬하지 않고 차례를 읽기만 한다.
// - 없어진 그림은 화면이 쥔 **폴더 목록 캐시에서도** 뺀다([`withoutEntry`]) — 다른 그림으로 옮겨도 다시 세지 않고 ← 로 되돌아가지 않는다.
//   다음에 폴더를 다시 읽으면(사람의 [다시 읽기] · 다른 폴더) 그 목록이 대신한다.

import { imageMime } from "$lib/browser/preview";
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";

/** 그 폴더의 그림 목록과 지금 그림의 자리(-1 = 목록에 없다 — 지워졌거나 아직 안 보인다) */
export interface ImageSiblings {
  list: SftpEntry[];
  index: number;
  /** `index` 가 -1 일 때 지금 그림이 있던(들어갈) 빈자리 — 이전 = `list[gap-1]` · 다음 = `list[gap]`([`withoutCurrent`]) */
  gap?: number;
}

/** 경로의 마지막 조각(구분자 둘 다) */
export function imageBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** 폴더 목록 → 그림만 · 지금 그림의 자리 */
export function imageSiblings(entries: readonly SftpEntry[], currentPath: string, caseInsensitive: boolean): ImageSiblings {
  const name = imageBaseName(currentPath);
  const same = (e: SftpEntry) => e.name === name || (caseInsensitive && e.name.toLowerCase() === name.toLowerCase());
  const list = entries.filter((e) => !isDirLike(e) && imageMime(e.name) !== null && (!e.hidden || same(e)));
  let index = list.findIndex((e) => e.name === name);
  if (index < 0 && caseInsensitive) index = list.findIndex(same);
  return { list, index };
}

/** 이전(`-1`) · 다음(`1`) 그림의 경로 — 끝이거나 지금 자리를 모르면 `null`(멈춘다) */
export function neighborPath(s: ImageSiblings, dir: 1 | -1): string | null {
  let at: number;
  if (s.index >= 0) at = s.index + dir;
  else if (s.gap !== undefined) at = dir < 0 ? s.gap - 1 : s.gap;
  else return null;
  return at >= 0 && at < s.list.length ? s.list[at].path : null;
}

/**
 * 지금 그림이 없어졌다(파일 없음) — 목록에서 빼고 빈자리를 남긴다(`index` -1 → `3 / 12` 없음 · 이웃은 빈자리 양옆).
 * 목록에 아직 있으면(폴더를 다시 읽기 전) 그 자리, 이미 없으면 목록 차례에서 그 이름이 들어갈 자리.
 */
export function withoutCurrent(s: ImageSiblings, currentPath: string): ImageSiblings {
  if (s.index >= 0) return { list: s.list.filter((_, i) => i !== s.index), index: -1, gap: s.index };
  const name = imageBaseName(currentPath).toLowerCase();
  let gap = 0;
  while (gap < s.list.length && s.list[gap].name.toLowerCase() < name) gap++;
  return { list: s.list, index: -1, gap };
}

/**
 * 없어진 그림을 폴더 목록(캐시)에서 뺀다 — 이름 짝은 [`imageSiblings`] 와 같다(그대로 · 로컬이면 대소문자 무시로 한 번 더). 없으면 받은 배열 그대로.
 */
export function withoutEntry(entries: readonly SftpEntry[], gonePath: string, caseInsensitive: boolean): readonly SftpEntry[] {
  const name = imageBaseName(gonePath);
  let at = entries.findIndex((e) => e.name === name);
  if (at < 0 && caseInsensitive) at = entries.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
  return at < 0 ? entries : entries.filter((_, i) => i !== at);
}

/** 머리줄 `3 / 12` — 자리를 모르거나 하나뿐이면 `null`(세우지 않는다) */
export function siblingCounter(s: ImageSiblings): { at: number; total: number } | null {
  if (s.index < 0 || s.list.length < 2) return null;
  return { at: s.index + 1, total: s.list.length };
}
