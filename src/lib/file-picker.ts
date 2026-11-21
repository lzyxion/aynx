import { isTextLike } from "$lib/doc-lang";
import { fuzzyMatch } from "$lib/hosts";
import type { SftpEntry } from "$lib/sftp-browser";
import type { PaneSpec, TabSpec } from "$lib/session";
import { startDirFor } from "$lib/start-dir";

/** 팔레트 "파일 열기…" 와 문서 타일 파일 칸의 찾기가 쓰는 순수 층 (docs/log/2026-09-27-doc-tile.md "A — 여는 길") */

/** `app/panes.svelte.ts` 의 `DocSource` 와 같은 모양 */
export interface PickerSource {
  paneId: string;
  alias: string;
}

/** `root` 가 `null` 이면 홈(여는 자리가 백엔드의 `home()` 을 묻는다) */
export type FilePickerRoot =
  | { where: "local"; root: string | null }
  | { where: "remote"; root: string | null; source: PickerSource };

export interface FilePickerRootInput {
  focused: Pick<PaneSpec, "id" | "kind" | "path" | "alias" | "sourcePaneId"> | null;
  /** 로컬 셸이면 여는 자리가 풀어 둔 값(OSC 7 → `local_cwd` · WSL 은 이 컴퓨터의 경로로 옮긴 것), ssh 셸이면 OSC 7 그대로 */
  focusedCwd?: string | null;
  sftpDir?: string | null;
  tab: Pick<TabSpec, "projectFolder" | "root"> | null;
}

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

/** `null` = 열 곳이 없다(원본을 잃은 SFTP · 원격 문서). 그 밖의 타일은 새 터미널의 시작 폴더 규칙 그대로([`startDirFor`]) */
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

/** `rel` 은 뿌리에서의 상대 경로(`/` 로 잇는다), `path` 는 여는 데 쓰는 절대 경로 */
export interface PickerFile {
  rel: string;
  path: string;
}

/** 판정은 `doc-lang.ts` 의 [`isTextLike`] 하나 — 파일 타일의 더블클릭과 같다 */
export function textEntries(files: readonly PickerFile[]): PickerFile[] {
  return files.filter((f) => isTextLike(f.rel));
}

function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/** 매칭은 상대 경로 전체에(`docs/a` 로 폴더까지 좁힌다), 순위는 이름이 먼저 — 같은 등급 안은 들어온 순서 */
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

/** 로컬 목록(`file_index.rs` 의 `SKIP_DIRS`)과 같은 뜻의 짧은 사본 */
const REMOTE_SKIP = new Set([".git", ".hg", ".svn", "node_modules", "target", "dist", ".svelte-kit", ".cache", ".venv", "venv", "__pycache__"]);

export interface ShallowList {
  files: PickerFile[];
  /** 한 층 아래 폴더를 다 보지 못했다(폴더 수 상한 · 읽기 실패) — 두 층보다 깊은 것은 원래 보지 않는다 */
  truncated: boolean;
}

/** 원격은 뿌리 한 층 + 하위 폴더 한 층까지만 — 재귀 훑기는 SFTP 왕복이 폴더 수만큼이라 느린 링크를 막는다. 뿌리를 못 읽으면만 던진다 */
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

/** Rust `list_text_files` 의 `limit` */
const LOCAL_SCAN_LIMIT = 20000;

export interface TextScanBackend {
  list(path: string): Promise<SftpEntry[]>;
  listTextFiles?(
    root: string,
    limit: number,
  ): Promise<{ root: string; files: PickerFile[]; truncated: boolean }>;
}

/** `root` 는 실제로 훑은 뿌리(로컬은 Rust 가 푼 값) */
export interface TextScan {
  root: string;
  files: PickerFile[];
  truncated: boolean;
  shallow: boolean;
}

export async function scanTextFiles(b: TextScanBackend, root: string): Promise<TextScan> {
  if (b.listTextFiles) {
    const idx = await b.listTextFiles(root, LOCAL_SCAN_LIMIT);
    return { root: idx.root, files: textEntries(idx.files), truncated: idx.truncated, shallow: false };
  }
  const got = await listRemoteShallow((p) => b.list(p), root);
  return { root, files: textEntries(got.files), truncated: got.truncated, shallow: true };
}

export function splitRel(rel: string): { dir: string; name: string } {
  const i = rel.lastIndexOf("/");
  return i < 0 ? { dir: "", name: rel } : { dir: rel.slice(0, i), name: rel.slice(i + 1) };
}
