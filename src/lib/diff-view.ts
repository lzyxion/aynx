/**
 * **diff 타일** 순수 층 (docs/log/2026-10-05-diff-tile.md).
 *
 * 백엔드 답 읽기(throw 없음) · 범위 글자 · 줄 짓기(한 줄 [`unifiedRows`] · 나란히 [`splitRows`]) · 폭 규칙(나란히 ·
 * 좁은 모드) · 파일 사이 걸음. 읽는 때 · 여는 길은
 * `app/diff-view.svelte.ts`, 그리는 것은 `DiffView.svelte`, 무엇을 무엇과 견주나는 Rust `diff_view.rs` 머리말.
 *
 * 줄의 **열쇠**([`lineKey`])는 한 파일 안에서 유일하다 — 맥락 `옛:새` · 더함 `-:새` · 뺌 `옛:-`. 고르기 · 코멘트 자리 ·
 * 나란히 보기의 칸이 모두 이 열쇠로 같은 줄을 가리킨다(보기를 바꿔도 코멘트가 같은 줄에 남는다).
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다.
 */

import type { DiffScopeKind, DiffSpec, DiffViewMode, Tr } from "$lib/session";

export type { DiffScopeKind, DiffSpec, DiffViewMode } from "$lib/session";

/**
 * 나란히 보기를 고를 수 있는 타일 폭(px) — 이보다 좁으면 단추가 흐려진다. 처음엔 1100 이었으나 175% 배율 화면에서 최대화한
 * 창이 CSS 1100px 이라 타일(~1046px)로는 영영 닿지 않아 900 으로 내렸다(2026-10-05 실기).
 */
export const SPLIT_MIN_WIDTH = 900;
/** 좁은 모드의 경계(px) — 이보다 좁으면 파일 목록이 드롭다운으로 접힌다(브랜치 타일과 같은 경계) */
export const NARROW_MAX_WIDTH = 720;
/** 한 번에 그리는 줄 덩어리 — 덩어리마다 `content-visibility` 로 화면 밖은 건너뛴다 */
export const ROW_CHUNK = 200;
/** 파일 목록 상한 — Rust `branch_graph::MAX_FILES` 의 짝 */
export const MAX_FILES = 500;
/** 한 파일 diff 의 줄 상한 — Rust `diff_view::MAX_DIFF_LINES` 의 짝(안내 문구) */
export const MAX_DIFF_LINES = 20_000;

/** 알려진 범위인가 */
export const isDiffScope = (v: unknown): v is DiffScopeKind => v === "branch" || v === "commit" || v === "wip" || v === "range";

/** 백엔드로 보내는 범위 — Rust `DiffScope` (camelCase) */
export interface DiffScopeArgs {
  kind: DiffScopeKind;
  branch?: string;
  worktree?: string;
  commit?: string;
  /** `range` 의 시작 커밋 */
  base?: string;
}

/** 명세 → 백엔드 범위. `wip` 인데 워크트리가 없거나 `commit` 인데 커밋이 없으면 `null`(읽지 않는다) */
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

// ---------------------------------------------------------------------------
// 답의 모양 — Rust `diff_view.rs` (snake_case 를 여기서 camelCase 로)
// ---------------------------------------------------------------------------

export type DiffGroup = "committed" | "uncommitted";

/** 파일 목록의 한 줄 */
export interface DiffEntry {
  path: string;
  oldPath: string | null;
  status: "M" | "A" | "D" | "R";
  added: number | null;
  deleted: number | null;
  binary: boolean;
  group: DiffGroup;
}

/** 커밋 고르개의 한 줄 */
export interface DiffCommit {
  hash: string;
  subject: string;
  time: number;
}

/** 목록 명령의 답 */
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

/** 파일 하나의 diff */
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

/** 목록 답 → 모양. **throw 하지 않는다** — 어긋난 줄은 버리고, 통째로 어긋나면 `null` */
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

/** 파일 하나의 답 → 모양 (throw 없음) */
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

// ---------------------------------------------------------------------------
// 범위 글자 · 합계 · 경로
// ---------------------------------------------------------------------------

export const shortHash = (h: string | null | undefined): string => (h ?? "").slice(0, 7);

/**
 * 머리줄의 범위 글자(모노) — 목업 그대로:
 * `merge-base 3f2a91c … HEAD a1b2c3d + 작업 폴더` · `9f8e7d6^ … 9f8e7d6` · `HEAD … 작업 폴더`.
 * 뿌리 커밋은 `빈 트리 … 9f8e7d6`, 병합 커밋은 `9f8e7d6 (병합)`.
 */
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

/** 파일 묶음의 합계 — `+142 −38` (모르는 줄 수는 0) */
export function entriesTotal(files: readonly DiffEntry[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const f of files) {
    added += f.added ?? 0;
    deleted += f.deleted ?? 0;
  }
  return { added, deleted };
}

/** 경로 → 흐린 폴더 + 이름 (`src/lib/` · `auth.ts`) */
export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
}

/** 목록 안에서 파일 하나의 열쇠 — 같은 경로가 두 묶음(커밋된 것 · 커밋 안 한 것)에 다 있을 수 있다 */
export const entryKey = (e: Pick<DiffEntry, "group" | "path">): string => `${e.group}:${e.path}`;

/** 파일 사이 걸음 — `[` = -1 · `]` = +1. 끝에서 멈춘다. 지금 것이 없으면 처음(또는 끝) */
export function stepEntry(files: readonly DiffEntry[], currentKey: string | null, dir: -1 | 1): DiffEntry | null {
  if (files.length === 0) return null;
  const i = currentKey === null ? -1 : files.findIndex((f) => entryKey(f) === currentKey);
  if (i < 0) return dir > 0 ? files[0] : files[files.length - 1];
  const j = Math.min(files.length - 1, Math.max(0, i + dir));
  return files[j];
}

/**
 * 처음 고를 파일 — 명세의 파일(커밋 안 한 묶음을 먼저 찾지 않는다: 같은 경로면 커밋된 것) → 없으면 첫 파일.
 * `prefer` 는 그 묶음을 먼저 본다(✎ 줄에서 열면 커밋 안 한 것).
 */
export function pickEntry(files: readonly DiffEntry[], want: string | undefined, prefer?: DiffGroup): DiffEntry | null {
  if (want) {
    const hit =
      (prefer ? files.find((f) => f.path === want && f.group === prefer) : undefined) ?? files.find((f) => f.path === want);
    if (hit) return hit;
  }
  return files[0] ?? null;
}

/** [문서로 열기] 를 누를 수 있나 — 워크트리가 있고 지워진 파일이 아니다. 아니면 까닭의 문구 키 */
export function docBlock(entry: DiffEntry | null, worktree: string | null): "noWorktree" | "deleted" | "noFile" | null {
  if (!entry) return "noFile";
  if (!worktree) return "noWorktree";
  if (entry.status === "D") return "deleted";
  return null;
}

// ---------------------------------------------------------------------------
// 폭 규칙
// ---------------------------------------------------------------------------

/** 나란히 보기를 고를 수 있나 */
export const canSplit = (width: number): boolean => width >= SPLIT_MIN_WIDTH;
/** 좁은 모드인가 */
export const isNarrow = (width: number): boolean => width > 0 && width < NARROW_MAX_WIDTH;
/** 실제로 그릴 보기 — 고른 것이 나란히여도 폭이 모자라면 한 줄 */
export const effectiveView = (want: DiffViewMode | undefined, width: number): DiffViewMode =>
  want === "split" && canSplit(width) ? "split" : "unified";

// ---------------------------------------------------------------------------
// 줄 짓기
// ---------------------------------------------------------------------------

/** 한 파일 안에서 유일한 줄 열쇠 */
export const lineKey = (l: Pick<DiffLine, "oldNo" | "newNo">): string => `${l.oldNo ?? "-"}:${l.newNo ?? "-"}`;

/** 헝크 머리줄 글자 `@@ -38,9 +38,14 @@ impl Refresher` */
export function hunkHeader(h: DiffHunk): string {
  const tail = h.section ? ` ${h.section}` : "";
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${tail}`;
}

/** 한 줄 보기의 한 줄 */
export type UnifiedRow =
  | { type: "hunk"; key: string; header: string }
  | { type: "line"; key: string; line: DiffLine };

/** 한 줄 보기 — 헝크마다 머리줄 한 줄 + 줄들 */
export function unifiedRows(file: DiffFile): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  file.hunks.forEach((h, i) => {
    out.push({ type: "hunk", key: `h${i}`, header: hunkHeader(h) });
    for (const line of h.lines) out.push({ type: "line", key: lineKey(line), line });
  });
  return out;
}

/** 나란히 보기의 한 줄 — 왼쪽(옛) · 오른쪽(새). 칸이 비면 빗금 채움 */
export type SplitRow =
  | { type: "hunk"; key: string; header: string }
  | { type: "pair"; key: string; left: DiffLine | null; right: DiffLine | null };

/**
 * 나란히 보기 — 맥락은 양쪽에 같은 줄, 이어진 뺌 덩어리와 더함 덩어리는 **나란히 짝지어** 긴 쪽만큼 줄을 세우고 짧은 쪽은
 * 빈 칸(빗금)이다. 줄의 열쇠는 오른쪽(새) 줄이 있으면 그것, 없으면 왼쪽 것.
 */
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
        // 더함 뒤에 다시 뺌이 오면 앞 덩어리를 닫는다(뺌 → 더함 짝만 나란히).
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

/** 덩어리로 자르기 — 화면 밖 덩어리는 그리기를 건너뛴다(`content-visibility`) */
export function chunks<T>(rows: readonly T[], size = ROW_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** 줄 표식 — 더함 `+` · 뺌 `−`(목업의 마이너스 글자) · 맥락 빈칸 */
export const signOf = (k: LineKind): string => (k === "add" ? "+" : k === "del" ? "−" : "");
