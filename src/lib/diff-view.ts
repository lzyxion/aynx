/**
 * diff 타일의 순수 층. 줄 열쇠([`lineKey`])는 한 파일 안에서 유일하다 — 고르기 · 코멘트 자리 · 나란히 보기의 칸이 모두
 * 이 열쇠로 같은 줄을 가리킨다(보기를 바꿔도 코멘트가 같은 줄에 남는다).
 */

import type { DiffScopeKind, DiffSpec, DiffViewMode, Tr } from "$lib/session";

export type { DiffScopeKind, DiffSpec, DiffViewMode } from "$lib/session";

/** 올리지 않는다 — 175% 배율 화면에서 최대화한 창의 타일(~1046px)이 닿아야 한다 */
export const SPLIT_MIN_WIDTH = 900;
/** 브랜치 타일과 같은 경계 */
export const NARROW_MAX_WIDTH = 720;
export const ROW_CHUNK = 200;
/** Rust `branch_graph::MAX_FILES` 의 짝 */
export const MAX_FILES = 500;
/** Rust `diff_view::MAX_DIFF_LINES` 의 짝(안내 문구) */
export const MAX_DIFF_LINES = 20_000;

export const isDiffScope = (v: unknown): v is DiffScopeKind => v === "branch" || v === "commit" || v === "wip" || v === "range";

/** Rust `DiffScope` (camelCase) */
export interface DiffScopeArgs {
  kind: DiffScopeKind;
  branch?: string;
  worktree?: string;
  commit?: string;
  base?: string;
}

export function scopeArgs(spec: DiffSpec): DiffScopeArgs | null {
  const branch = spec.branch?.trim() || undefined;
  if (spec.scope === "branch") return branch ? { kind: "branch", branch } : null;
  if (spec.scope === "commit") {
    const commit = spec.commit?.trim();
    return commit ? { kind: "commit", commit, ...(branch ? { branch } : {}) } : null;
  }
  if (spec.scope === "range") {
    const base = spec.base?.trim();
    const commit = spec.tip?.trim();
    const worktree = spec.worktreePath?.trim();
    return base && commit ? { kind: "range", base, commit, ...(worktree ? { worktree } : {}) } : null;
  }
  const worktree = spec.worktreePath?.trim();
  return worktree ? { kind: "wip", worktree, ...(branch ? { branch } : {}) } : null;
}

// ── 답의 모양 — Rust `diff_view.rs` (snake_case 를 여기서 camelCase 로) ──

export type DiffGroup = "committed" | "uncommitted";

export interface DiffEntry {
  path: string;
  oldPath: string | null;
  status: "M" | "A" | "D" | "R";
  added: number | null;
  deleted: number | null;
  binary: boolean;
  group: DiffGroup;
}

export interface DiffCommit {
  hash: string;
  subject: string;
  time: number;
}

export interface DiffFiles {
  main: string | null;
  branch: string | null;
  base: string | null;
  tip: string | null;
  worktree: string | null;
  head: string | null;
  merge: boolean;
  root: boolean;
  files: DiffEntry[];
  commits: DiffCommit[];
  commitsTruncated: boolean;
  wipCount: number | null;
  truncated: boolean;
}

export type LineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  noNewline: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  binary: boolean;
  hunks: DiffHunk[];
  truncated: boolean;
  added: number;
  deleted: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? Math.floor(n) : null;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseEntry(raw: unknown): DiffEntry | null {
  const o = obj(raw);
  const path = str(o?.path);
  const st = o?.status;
  if (!o || !path || (st !== "M" && st !== "A" && st !== "D" && st !== "R")) return null;
  return {
    path,
    oldPath: str(o.old_path),
    status: st,
    added: count(o.added),
    deleted: count(o.deleted),
    binary: o.binary === true,
    group: o.group === "uncommitted" ? "uncommitted" : "committed",
  };
}

/** throw 하지 않는다 — 어긋난 줄은 버리고, 통째로 어긋나면 `null` */
export function parseDiffFiles(raw: unknown): DiffFiles | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.files)) return null;
  const commits: DiffCommit[] = [];
  for (const item of arr(o.commits)) {
    const c = obj(item);
    const hash = str(c?.hash);
    const time = num(c?.time);
    if (c && hash && time !== null) commits.push({ hash, subject: typeof c.subject === "string" ? c.subject : "", time });
  }
  return {
    main: str(o.main),
    branch: str(o.branch),
    base: str(o.base),
    tip: str(o.tip),
    worktree: str(o.worktree),
    head: str(o.head),
    merge: o.merge === true,
    root: o.root === true,
    files: o.files.map(parseEntry).filter((e): e is DiffEntry => e !== null),
    commits,
    commitsTruncated: o.commits_truncated === true,
    wipCount: count(o.wip_count),
    truncated: o.truncated === true,
  };
}

function parseLine(raw: unknown): DiffLine | null {
  const o = obj(raw);
  const k = o?.kind;
  if (!o || (k !== "ctx" && k !== "add" && k !== "del")) return null;
  return {
    kind: k,
    oldNo: count(o.old_no),
    newNo: count(o.new_no),
    text: typeof o.text === "string" ? o.text : "",
    noNewline: o.no_newline === true,
  };
}

/** throw 하지 않는다 */
export function parseDiffFile(raw: unknown): DiffFile | null {
  const o = obj(raw);
  const path = str(o?.path);
  if (!o || !path || !Array.isArray(o.hunks)) return null;
  const hunks: DiffHunk[] = [];
  for (const item of o.hunks) {
    const h = obj(item);
    if (!h) continue;
    hunks.push({
      oldStart: count(h.old_start) ?? 0,
      oldLines: count(h.old_lines) ?? 0,
      newStart: count(h.new_start) ?? 0,
      newLines: count(h.new_lines) ?? 0,
      section: typeof h.section === "string" ? h.section : "",
      lines: arr(h.lines)
        .map(parseLine)
        .filter((l): l is DiffLine => l !== null),
    });
  }
  return {
    path,
    oldPath: str(o.old_path),
    binary: o.binary === true,
    hunks,
    truncated: o.truncated === true,
    added: count(o.added) ?? 0,
    deleted: count(o.deleted) ?? 0,
  };
}

// ── 범위 글자 · 합계 · 경로 ──

export const shortHash = (h: string | null | undefined): string => (h ?? "").slice(0, 7);

export function rangeText(scope: DiffScopeKind, f: DiffFiles, tr: Tr): string {
  if (scope === "branch") {
    const left = tr("app.diff.range.branch", { base: shortHash(f.base), tip: shortHash(f.tip) });
    return f.worktree ? left + tr("app.diff.range.plusWorktree") : left;
  }
  if (scope === "commit") {
    const c = shortHash(f.tip);
    if (f.merge) return tr("app.diff.range.merge", { commit: c });
    if (f.root) return tr("app.diff.range.root", { commit: c });
    return tr("app.diff.range.commit", { commit: c });
  }
  if (scope === "range") return tr("app.diff.range.range", { base: shortHash(f.base), tip: shortHash(f.tip) });
  return tr("app.diff.range.wip");
}

export function entriesTotal(files: readonly DiffEntry[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const f of files) {
    added += f.added ?? 0;
    deleted += f.deleted ?? 0;
  }
  return { added, deleted };
}

export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
}

/** 같은 경로가 두 묶음(커밋된 것 · 커밋 안 한 것)에 다 있을 수 있다 */
export const entryKey = (e: Pick<DiffEntry, "group" | "path">): string => `${e.group}:${e.path}`;

export function stepEntry(files: readonly DiffEntry[], currentKey: string | null, dir: -1 | 1): DiffEntry | null {
  if (files.length === 0) return null;
  const i = currentKey === null ? -1 : files.findIndex((f) => entryKey(f) === currentKey);
  if (i < 0) return dir > 0 ? files[0] : files[files.length - 1];
  const j = Math.min(files.length - 1, Math.max(0, i + dir));
  return files[j];
}

export function pickEntry(files: readonly DiffEntry[], want: string | undefined, prefer?: DiffGroup): DiffEntry | null {
  if (want) {
    const hit =
      (prefer ? files.find((f) => f.path === want && f.group === prefer) : undefined) ?? files.find((f) => f.path === want);
    if (hit) return hit;
  }
  return files[0] ?? null;
}

/** 막는 까닭의 문구 키 — 누를 수 있으면 `null` */
export function docBlock(entry: DiffEntry | null, worktree: string | null): "noWorktree" | "deleted" | "noFile" | null {
  if (!entry) return "noFile";
  if (!worktree) return "noWorktree";
  if (entry.status === "D") return "deleted";
  return null;
}

// ── 폭 규칙 ──

export const canSplit = (width: number): boolean => width >= SPLIT_MIN_WIDTH;
export const isNarrow = (width: number): boolean => width > 0 && width < NARROW_MAX_WIDTH;
export const effectiveView = (want: DiffViewMode | undefined, width: number): DiffViewMode =>
  want === "split" && canSplit(width) ? "split" : "unified";

// ── 줄 짓기 ──

export const lineKey = (l: Pick<DiffLine, "oldNo" | "newNo">): string => `${l.oldNo ?? "-"}:${l.newNo ?? "-"}`;

export function hunkHeader(h: DiffHunk): string {
  const tail = h.section ? ` ${h.section}` : "";
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${tail}`;
}

export type UnifiedRow =
  | { type: "hunk"; key: string; header: string }
  | { type: "line"; key: string; line: DiffLine };

export function unifiedRows(file: DiffFile): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  file.hunks.forEach((h, i) => {
    out.push({ type: "hunk", key: `h${i}`, header: hunkHeader(h) });
    for (const line of h.lines) out.push({ type: "line", key: lineKey(line), line });
  });
  return out;
}

export type SplitRow =
  | { type: "hunk"; key: string; header: string }
  | { type: "pair"; key: string; left: DiffLine | null; right: DiffLine | null };

export function splitRows(file: DiffFile): SplitRow[] {
  const out: SplitRow[] = [];
  file.hunks.forEach((h, i) => {
    out.push({ type: "hunk", key: `h${i}`, header: hunkHeader(h) });
    let dels: DiffLine[] = [];
    let adds: DiffLine[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        const left = dels[k] ?? null;
        const right = adds[k] ?? null;
        out.push({ type: "pair", key: lineKey((right ?? left)!), left, right });
      }
      dels = [];
      adds = [];
    };
    for (const line of h.lines) {
      if (line.kind === "del") {
        if (adds.length > 0) flush();
        dels.push(line);
      } else if (line.kind === "add") {
        adds.push(line);
      } else {
        flush();
        out.push({ type: "pair", key: lineKey(line), left: line, right: line });
      }
    }
    flush();
  });
  return out;
}

export function chunks<T>(rows: readonly T[], size = ROW_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** 뺌은 하이픈이 아니라 마이너스 글자 `−` */
export const signOf = (k: LineKind): string => (k === "add" ? "+" : k === "del" ? "−" : "");
