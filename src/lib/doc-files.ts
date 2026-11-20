import { isTextLike } from "$lib/doc-lang";
import type { TextScan } from "$lib/file-picker";
import { winNormalize } from "$lib/fs-backend";
import { compareNames } from "$lib/list-order";
import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/**
 * **문서 타일의 파일 곁 패널 — 줄 규칙** — 순수 모듈(2026-11-19).
 *
 * - [`folderRows`] — 폴더 목록(`backend.list(dir)`) → 둘러보기 줄: `..` → 폴더 → 파일, 이름은 [`compareNames`].
 * - [`hasParent`] — `..` 줄을 세우나(`parentOf(dir) !== dir`).
 * - [`samePath`] — 지금 문서 줄 강조의 경로 비교 하나.
 * - [`acceptFilesSeed`] — 이 타일에서 문서를 바꿀 때 옛 파일 칸이 넘긴 상태([`DocFilesSeed`] — `doc-swap.ts` 가 나른다)를 새 칸이 받을지.
 *
 * 폴더는 [`isDirLike`](심링크 폴더 포함) · 파일은 문서 타일로 열 수 있는 글 파일([`isTextLike`])만 · 숨김은
 * [`isHidden`] 으로 뺀다. 하위 폴더까지의 찾기 자료는 `file-picker.ts` 의 `scanTextFiles`(팔레트 "파일 열기…" 와 같다).
 * `doc/files-controller.svelte.ts` 가 쓴다.
 */

/** 둘러보기 목록이 그리는 줄 상한(`..` 는 세지 않는다) — 넘는 것은 "N개 더" 줄로 */
export const DOC_FILES_ROWS_MAX = 500;

/** 둘러보기 한 줄 — `up` 은 `..`(상위 폴더), `path` 는 들어가거나 여는 절대 경로 */
export interface DocFileRow {
  kind: "up" | "dir" | "file";
  name: string;
  path: string;
}

export interface FolderRows {
  rows: DocFileRow[];
  /** 상한에 걸려 그리지 않은 줄 수 */
  more: number;
}

/** 찾기 자료의 상태 — 질의가 비면 `idle` (`doc/files-controller.svelte.ts` 가 쥔다) */
export type DocFilesScan =
  | { state: "idle" }
  | { state: "scanning" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & TextScan);

/**
 * 파일 칸에서 골라 **이 타일에서** 문서를 바꿀 때 옛 칸이 새 칸에 넘기는 상태(2026-11-20 — 사용자 B 안). 갈아 끼우기는 새 `DocView` 라
 * 넘기지 않으면 폴더 · 목록 · 찾기 글 · 찾기 자료 · 고른 줄 · 목록 스크롤이 처음으로 돌아가 목록이 비었다 다시 찼다.
 * 값은 옛 컨트롤러가 그 순간 뜬 사본이다(`snapshot` — 상자는 통째로 바뀌는 `$state.raw` 라 그대로 넘겨도 된다).
 */
export interface DocFilesSeed {
  /** 어느 원본의 것인가(`FsBackend.key`) — 새 칸의 원본과 같을 때만 받는다 */
  key: string;
  dir: string;
  query: string;
  active: number;
  /** 둘러보기 줄 — `browseFor` 폴더의 것(`null` 이면 아직 읽은 적이 없다) */
  browse: FolderRows;
  browseFor: string | null;
  /** 둘러보기를 다 읽은 상태였다 — 받은 칸은 "읽는 중" 없이 그 줄로 선다 */
  ready: boolean;
  scan: DocFilesScan;
  /** `scan` 이 어느 원본 · 폴더의 것인가(컨트롤러의 `forKey`) */
  scanFor: string;
  /** 목록 상자의 스크롤(px) — 컨트롤러의 `listScroll`(새 칸의 `DocFiles` 는 설 때마다 이 값으로 선다) */
  scrollTop: number;
}

/**
 * 새 파일 칸이 넘겨받은 상태를 쓸지 — 원본(`key`)이 다르면 `null`(다른 곳의 폴더 · 줄이다). 훑는 중이던 찾기 자료는 옛 칸이 내려가며
 * 버린 일이라(`dispose`) 끝나지 않는다 — `idle` 로 바꿔 새 칸의 첫 읽기(`load` — 질의가 남아 있으면 다시 훑는다)가 이어받게 한다.
 */
export function acceptFilesSeed(seed: DocFilesSeed | null | undefined, key: string): DocFilesSeed | null {
  if (!seed || seed.key !== key) return null;
  return seed.scan.state === "scanning" ? { ...seed, scan: { state: "idle" } } : seed;
}

/** `..` 줄을 세우나 — 더 올라갈 곳이 있다(`FsBackend.parentOf` 는 꼭대기에서 자기 자신을 돌려준다) */
export function hasParent(dir: string, parentOf: (path: string) => string): boolean {
  return parentOf(dir) !== dir;
}

/**
 * 폴더 목록 → 둘러보기 줄. `parent` 가 있으면 맨 앞에 `..` 줄(부르는 쪽이 [`hasParent`] 로 정해 넘긴다).
 * 폴더 · 파일을 합쳐 많아야 `max` 줄(기본 [`DOC_FILES_ROWS_MAX`]) — 폴더가 먼저 자리를 갖는다.
 */
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

/**
 * 같은 경로인가 — 구분자가 `\` 인 백엔드(로컬 Windows)는 정규화([`winNormalize`] — `/` 섞임 · 꼬리 구분자) 뒤
 * 대소문자 무시, 그 밖(원격 POSIX)은 글자 그대로.
 */
export function samePath(a: string, b: string, sep: "/" | "\\"): boolean {
  if (sep === "\\") return winNormalize(a).toLowerCase() === winNormalize(b).toLowerCase();
  return a === b;
}
