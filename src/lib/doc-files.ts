import { isTextLike } from "$lib/doc-lang";
import type { TextScan } from "$lib/file-picker";
import { winNormalize } from "$lib/fs-backend";
import { compareNames } from "$lib/list-order";
import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/** 문서 타일의 파일 곁 패널 — 줄 규칙(순수). */

/** `..` 는 세지 않는다 */
export const DOC_FILES_ROWS_MAX = 500;

export interface DocFileRow {
  kind: "up" | "dir" | "file";
  name: string;
  path: string;
}

export interface FolderRows {
  rows: DocFileRow[];
  more: number;
}

export type DocFilesScan =
  | { state: "idle" }
  | { state: "scanning" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & TextScan);

/**
 * 이 타일에서 문서를 바꿀 때 옛 파일 칸이 새 칸에 넘기는 상태 — 넘기지 않으면 새 `DocView` 의 목록이 비었다 다시 찬다.
 * 상자는 통째로 바뀌는 `$state.raw` 라 사본을 그대로 넘겨도 된다.
 */
export interface DocFilesSeed {
  /** `FsBackend.key` — 새 칸의 원본과 같을 때만 받는다 */
  key: string;
  dir: string;
  query: string;
  active: number;
  browse: FolderRows;
  /** `null` 이면 아직 읽은 적이 없다 */
  browseFor: string | null;
  ready: boolean;
  scan: DocFilesScan;
  scanFor: string;
  scrollTop: number;
}

/** 훑는 중이던 찾기는 옛 칸이 `dispose` 로 버려 끝나지 않는다 — `idle` 로 바꿔 새 칸의 첫 읽기가 이어받게 한다 */
export function acceptFilesSeed(seed: DocFilesSeed | null | undefined, key: string): DocFilesSeed | null {
  if (!seed || seed.key !== key) return null;
  return seed.scan.state === "scanning" ? { ...seed, scan: { state: "idle" } } : seed;
}

/** `FsBackend.parentOf` 는 꼭대기에서 자기 자신을 돌려준다 */
export function hasParent(dir: string, parentOf: (path: string) => string): boolean {
  return parentOf(dir) !== dir;
}

export function folderRows(
  entries: readonly SftpEntry[],
  opts: { parent?: string | null; max?: number } = {},
): FolderRows {
  const max = opts.max ?? DOC_FILES_ROWS_MAX;
  const byName = (a: SftpEntry, b: SftpEntry) => compareNames(a.name, b.name);
  const shown = entries.filter((e) => !isHidden(e));
  const dirs = shown.filter(isDirLike).sort(byName);
  const files = shown
    .filter((e) => !isDirLike(e) && (e.kind === "file" || e.kind === "symlink") && isTextLike(e.name))
    .sort(byName);
  const body: DocFileRow[] = [
    ...dirs.map((e): DocFileRow => ({ kind: "dir", name: e.name, path: e.path })),
    ...files.map((e): DocFileRow => ({ kind: "file", name: e.name, path: e.path })),
  ];
  const kept = body.slice(0, Math.max(0, max));
  const rows: DocFileRow[] =
    opts.parent != null ? [{ kind: "up", name: "..", path: opts.parent }, ...kept] : kept;
  return { rows, more: body.length - kept.length };
}

/** 구분자가 `\` 인 백엔드(로컬 Windows)는 정규화 뒤 대소문자 무시, 원격 POSIX 는 글자 그대로 */
export function samePath(a: string, b: string, sep: "/" | "\\"): boolean {
  if (sep === "\\") return winNormalize(a).toLowerCase() === winNormalize(b).toLowerCase();
  return a === b;
}
