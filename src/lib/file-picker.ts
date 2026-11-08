import { isTextLike } from "$lib/doc-lang";
import { fuzzyMatch } from "$lib/hosts";
import type { SftpEntry } from "$lib/sftp-browser";
import type { PaneSpec, TabSpec } from "$lib/session";
import { startDirFor } from "$lib/start-dir";

/**
 * **팔레트 "파일 열기…"** — 순수 층 (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
 *
 * - [`filePickerRoot`] — 포커스된 타일에서 **어느 폴더를(로컬/원격) 뿌리로** 훑을까.
 * - [`textEntries`] — 훑은 파일 중 문서 보기로 열 것만([`isTextLike`] — 파일 타일의 더블클릭과 같은 판정 하나).
 * - [`filterFiles`] — 팔레트와 같은 부분수열 매칭([`fuzzyMatch`]) + 이름에 맞은 줄을 위로.
 * - [`listRemoteShallow`] — 원격은 **뿌리 한 층 + 하위 폴더 한 층**까지만(느린 링크 보호 — 재귀 훑기는 SFTP
 *   왕복이 폴더 수만큼이다).
 *
 * 화면(`FilePicker.svelte`)과 저장소(`app/file-picker.svelte.ts`)가 이것을 쓴다.
 */

/** 원격 문서가 빌릴 세션의 주인 (`app/panes.svelte.ts` 의 `DocSource` 와 같은 모양) */
export interface PickerSource {
  paneId: string;
  alias: string;
}

/**
 * 훑을 뿌리 — `root` 가 `null` 이면 **홈**(여는 자리가 백엔드의 `home()` 을 묻는다).
 * 원격이면 `source` 가 세션을 가진 ssh 터미널이다.
 */
export type FilePickerRoot =
  | { where: "local"; root: string | null }
  | { where: "remote"; root: string | null; source: PickerSource };

export interface FilePickerRootInput {
  /** 지금 탭의 포커스된 타일 (없으면 `null`) */
  focused: Pick<PaneSpec, "id" | "kind" | "path" | "alias" | "sourcePaneId"> | null;
  /**
   * 포커스된 **터미널**의 지금 폴더 — 로컬 셸이면 여는 자리가 풀어 둔 값(OSC 7 → `local_cwd` · WSL 은 이 컴퓨터의
   * 경로로 옮긴 것), ssh 셸이면 OSC 7 그대로. 모르면 `null`.
   */
  focusedCwd?: string | null;
  /** 포커스된 **SFTP 타일**이 지금 보는 폴더(`sftpDirOf`) — 없으면 `path` 로 떨어진다 */
  sftpDir?: string | null;
  /** 지금 탭 — 로컬 쪽 규칙(프로젝트 폴더)에 쓴다 */
  tab: Pick<TabSpec, "projectFolder" | "root"> | null;
}

/** 경로의 부모 폴더(구분자 둘 다 본다). 뿌리(`C:\` · `/`)의 파일이면 그 뿌리. 모르면 `null` */
export function parentDir(path: string): string | null {
  const trimmed = path.trim();
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (i < 0) return null;
  const head = trimmed.slice(0, i);
  if (head === "") return trimmed[0]; // `/a.md` → `/`
  if (/^[A-Za-z]:$/.test(head)) return `${head}${trimmed[i]}`; // `C:\a.md` → `C:\`
  return head;
}

const trimmedOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * 포커스된 타일 → 훑을 뿌리 (`null` = 열 곳이 없다 — 원본을 잃은 SFTP · 원격 문서).
 *
 * | 타일 | 뿌리 |
 * | --- | --- |
 * | ssh 터미널 | 원격 · 셸의 지금 폴더(OSC 7), 모르면 홈 |
 * | SFTP 파일 타일 | 원격(빌리던 터미널) · 보고 있는 폴더 |
 * | 원격 문서 | 원격(빌리던 터미널) · 그 파일의 폴더 |
 * | 로컬 문서 | 로컬 · 그 파일의 폴더 |
 * | 그 밖(로컬 셸 · AI · 로컬 파일 · 시작 화면 …) | 로컬 · 새 터미널의 시작 폴더 규칙 그대로([`startDirFor`] — 포커스된 타일의 폴더 → 프로젝트 탭의 폴더 → 홈) |
 */
export function filePickerRoot(i: FilePickerRootInput): FilePickerRoot | null {
  const f = i.focused;
  if (f?.kind === "ssh") {
    return { where: "remote", root: trimmedOrNull(i.focusedCwd), source: { paneId: f.id, alias: f.alias ?? "" } };
  }
  if (f?.kind === "sftp") {
    if (!f.sourcePaneId) return null;
    return {
      where: "remote",
      root: trimmedOrNull(i.sftpDir) ?? trimmedOrNull(f.path),
      source: { paneId: f.sourcePaneId, alias: f.alias ?? "" },
    };
  }
  if (f?.kind === "doc") {
    const dir = parentDir(f.path ?? "");
    if ((f.alias?.trim() ?? "") !== "") {
      if (!f.sourcePaneId) return null;
      return { where: "remote", root: dir, source: { paneId: f.sourcePaneId, alias: f.alias ?? "" } };
    }
    if (dir) return { where: "local", root: dir };
  }
  const root = startDirFor({ focused: f, focusedCwd: i.focusedCwd, tab: i.tab, purpose: "shell" });
  return { where: "local", root: root ?? null };
}

/** 고르는 목록의 한 줄 — `rel` 은 뿌리에서의 상대 경로(`/` 로 잇는다), `path` 는 여는 데 쓰는 절대 경로 */
export interface PickerFile {
  rel: string;
  path: string;
}

/** 문서 보기로 열 것만 — 판정은 `doc-lang.ts` 의 [`isTextLike`] 하나 */
export function textEntries(files: readonly PickerFile[]): PickerFile[] {
  return files.filter((f) => isTextLike(f.rel));
}

/** 마지막 조각 */
function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/**
 * 질의로 좁히고 줄을 세운다 — 부분수열 매칭은 **상대 경로 전체**에(`docs/a` 로 폴더까지 좁힌다), 순위는 이름이
 * 먼저다: ① 이름이 질의로 시작 ② 이름에 질의가 이어져 있음 ③ 이름에 부분수열 ④ 경로에만 부분수열. 같은 등급 안은
 * 들어온 순서(얕은 것 먼저 — 로컬 목록은 넓이 우선이다). 빈 질의는 그대로. 많아야 `max` 줄.
 */
export function filterFiles(files: readonly PickerFile[], query: string, max = 200): PickerFile[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (q === "") return files.slice(0, max);
  const ranked: Array<{ f: PickerFile; rank: number; i: number }> = [];
  files.forEach((f, i) => {
    if (!fuzzyMatch(q, f.rel)) return;
    const name = nameOf(f.rel).toLowerCase();
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : fuzzyMatch(q, name) ? 2 : 3;
    ranked.push({ f, rank, i });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.slice(0, max).map((r) => r.f);
}

/** 원격 얕은 목록에서 들어가지 않는 폴더 — 로컬 목록(`file_index.rs` 의 `SKIP_DIRS`)과 같은 뜻의 짧은 사본 */
const REMOTE_SKIP = new Set([".git", ".hg", ".svn", "node_modules", "target", "dist", ".svelte-kit", ".cache", ".venv", "venv", "__pycache__"]);

/** 원격 얕은 목록의 결과. 두 층보다 깊은 것은 원래 보지 않는다(화면이 늘 한 줄로 말한다) — `truncated` 는 그 밖의 잘림 */
export interface ShallowList {
  files: PickerFile[];
  /** 한 층 아래 폴더를 다 보지 못했다(폴더 수 상한 · 읽기 실패) */
  truncated: boolean;
}

/**
 * **원격: 뿌리 한 층 + 하위 폴더 한 층** — `list` 는 그 백엔드의 목록 함수(SFTP). 폴더는 이름순으로 많아야
 * `maxDirs` 개까지 들어간다. 하위 폴더 하나를 못 읽어도 전체는 실패하지 않는다(뿌리만 예외 — 던진다).
 */
export async function listRemoteShallow(
  list: (path: string) => Promise<SftpEntry[]>,
  root: string,
  maxDirs = 64,
): Promise<ShallowList> {
  const base = root.replace(/\/+$/, "") || "/";
  const relOf = (dirRel: string, name: string) => (dirRel === "" ? name : `${dirRel}/${name}`);
  const isDir = (e: SftpEntry) => e.kind === "dir" || (e.kind === "symlink" && e.linkIsDir);
  const isFile = (e: SftpEntry) => e.kind === "file" || (e.kind === "symlink" && !e.linkIsDir);
  const top = await list(base);
  const files: PickerFile[] = top.filter(isFile).map((e) => ({ rel: e.name, path: e.path }));
  const dirs = top.filter((e) => isDir(e) && !REMOTE_SKIP.has(e.name));
  let truncated = dirs.length > maxDirs;
  for (const d of dirs.slice(0, maxDirs)) {
    try {
      for (const e of await list(d.path)) {
        if (isFile(e)) files.push({ rel: relOf(d.name, e.name), path: e.path });
      }
    } catch {
      truncated = true;
    }
  }
  return { files, truncated };
}
