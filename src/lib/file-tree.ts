import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/**
 * 파일 타일의 트리 · 들어가기 보기의 줄 계산 (docs/log/2026-09-25-file-tree-view.md). 두 보기가 한 길로 그려져야 선택 · 끌기 · 메뉴가
 * 보기마다 갈리지 않는다.
 */

/** 맵에 키가 없으면 아직 한 번도 읽지 않았다 */
export type FolderState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; entries: readonly SftpEntry[] };

export type FileTreeRow =
  | {
      kind: "entry";
      /** 선택 id — 항목의 절대 경로(들어가기 보기와 같은 값) */
      id: string;
      entry: SftpEntry;
      depth: number;
      parent: string;
      expandable: boolean;
      /** 읽기에 실패한 폴더는 펼쳐 둔 것으로 치지 않는다 */
      expanded: boolean;
      error: string | null;
    }
  | { kind: "loading"; id: string; depth: number; parent: string }
  | { kind: "empty"; id: string; depth: number; parent: string }
  | { kind: "more"; id: string; depth: number; parent: string; hidden: number };

/** 가상 스크롤은 쓰지 않는다 — 러버밴드 · `scrollIntoView` · 끌기 표시가 그려진 DOM 줄을 보고 움직인다(`boxesIn`) */
export const TREE_PAGE = 500;

/** 곁줄 id 의 머리 — 경로에는 NUL 이 올 수 없어 경로와 겹치지 않는다 */
const AUX = "\u0000";

/** 키보드 커서가 앉을 수 있는 유일한 곁줄 */
export function moreRowId(parent: string): string {
  return `${AUX}more${AUX}${parent}`;
}

export function isAuxId(id: string): boolean {
  return id.startsWith(AUX);
}

export interface FileTreeOptions {
  tree: boolean;
  showHidden: boolean;
  expanded: ReadonlySet<string>;
  /** 타일마다 하나 — 접어도 남는다 */
  folders: ReadonlyMap<string, FolderState>;
  limits?: ReadonlyMap<string, number>;
  page?: number;
}

/** 숨김 필터는 층마다 건다(숨김 폴더 아래는 애초에 안 보인다). 정렬은 백엔드 것 그대로 */
export function fileTreeRows(
  root: string,
  rootEntries: readonly SftpEntry[],
  opts: FileTreeOptions,
): FileTreeRow[] {
  const out: FileTreeRow[] = [];
  const page = Math.max(1, opts.page ?? TREE_PAGE);
  const visible = (list: readonly SftpEntry[]) =>
    opts.showHidden ? list : list.filter((e) => !isHidden(e));

  const level = (parent: string, list: readonly SftpEntry[], depth: number, seen: Set<string>) => {
    const shown = visible(list);
    const cap = opts.tree ? Math.max(page, opts.limits?.get(parent) ?? page) : shown.length;
    const head = shown.length > cap ? shown.slice(0, cap) : shown;
    for (const entry of head) {
      const expandable = opts.tree && isDirLike(entry);
      const state = expandable ? opts.folders.get(entry.path) : undefined;
      const error = state?.status === "error" ? state.message : null;
      // 같은 경로가 조상에 이미 있으면(링크가 제 조상을 가리키는 고리) 펼친 것으로 치지 않는다
      const open = expandable && opts.expanded.has(entry.path) && error === null && !seen.has(entry.path);
      out.push({
        kind: "entry",
        id: entry.path,
        entry,
        depth,
        parent,
        expandable,
        expanded: open,
        error,
      });
      if (!open) continue;
      const child = depth + 1;
      if (state?.status === "ok") {
        if (visible(state.entries).length === 0) {
          out.push({ kind: "empty", id: `${AUX}empty${AUX}${entry.path}`, depth: child, parent: entry.path });
        } else {
          const next = new Set(seen);
          next.add(entry.path);
          level(entry.path, state.entries, child, next);
        }
      } else {
        out.push({ kind: "loading", id: `${AUX}loading${AUX}${entry.path}`, depth: child, parent: entry.path });
      }
    }
    if (shown.length > head.length) {
      out.push({
        kind: "more",
        id: moreRowId(parent),
        depth,
        parent,
        hidden: shown.length - head.length,
      });
    }
  };

  level(root, rootEntries, 0, new Set([root]));
  return out;
}

export function entryOrder(rows: readonly FileTreeRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.kind === "entry") ids.push(r.id);
  return ids;
}

export function navOrder(rows: readonly FileTreeRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.kind === "entry" || r.kind === "more") ids.push(r.id);
  return ids;
}

/** 붙여넣기 · 새 폴더 · 업로드의 대상 폴더 — 호스트 트리의 `folderOfRow` 와 같은 규칙 */
export function targetDirOf(row: FileTreeRow | null | undefined, root: string): string {
  if (!row) return root;
  if (row.kind === "entry") return isDirLike(row.entry) ? row.entry.path : row.parent;
  return row.parent;
}

/** 빈 바닥은 이 함수를 부르지 않는다(목록 상자가 받아 뿌리로 간다) */
export function dropDirOf(row: FileTreeRow): string {
  if (row.kind === "entry" && isDirLike(row.entry)) return row.entry.path;
  return row.parent;
}

export function parentRowId(rows: readonly FileTreeRow[], id: string): string | null {
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const up = rows.find((r) => r.kind === "entry" && r.entry.path === row.parent);
  return up ? up.id : null;
}

export function firstChildId(rows: readonly FileTreeRow[], id: string): string | null {
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) return null;
  const row = rows[at];
  const next = rows[at + 1];
  if (!next || next.depth !== row.depth + 1) return null;
  return next.kind === "entry" || next.kind === "more" ? next.id : null;
}

/** 한 글자면 지금 줄 다음부터(같은 글자를 거듭 치면 돈다), 두 글자 이상이면 지금 줄부터 찾는다 */
export function findByPrefix(
  rows: readonly FileTreeRow[],
  currentId: string | null,
  prefix: string,
): string | null {
  const needle = prefix.toLocaleLowerCase();
  if (needle === "") return null;
  const entries = rows.filter((r): r is Extract<FileTreeRow, { kind: "entry" }> => r.kind === "entry");
  const n = entries.length;
  if (n === 0) return null;
  const at = currentId === null ? -1 : entries.findIndex((r) => r.id === currentId);
  const start = at < 0 ? 0 : needle.length === 1 ? at + 1 : at;
  for (let k = 0; k < n; k += 1) {
    const r = entries[(start + k) % n];
    if (r.entry.name.toLocaleLowerCase().startsWith(needle)) return r.id;
  }
  return null;
}

/** 구분자는 둘 다 본다(로컬 `\` · 원격 `/`). `to` 가 `null` 이면 그 아래를 버린다. 바뀐 것이 없으면 같은 집합 */
export function rebasePaths(
  set: ReadonlySet<string>,
  from: string,
  to: string | null,
): ReadonlySet<string> {
  const under = (p: string) => p === from || p.startsWith(`${from}/`) || p.startsWith(`${from}\\`);
  if (![...set].some(under)) return set;
  const out = new Set<string>();
  for (const p of set) {
    if (!under(p)) out.add(p);
    else if (to !== null) out.add(to + p.slice(from.length));
  }
  return out;
}

/**
 * 이름 거르기(`Ctrl+I`) — 맞는 항목과 그 조상 폴더 줄만 남기고 곁줄은 뺀다(곁줄의 뜻은 거르지 않은 목록의 것이다).
 * `matched` 는 맞는 항목의 id 다 — 조상이라 남은 줄과 가른다.
 */
export function filterRows(
  rows: readonly FileTreeRow[],
  query: string,
): { rows: readonly FileTreeRow[]; matched: ReadonlySet<string>; count: number } {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return { rows, matched: new Set(), count: 0 };
  const byPath = new Map<string, Extract<FileTreeRow, { kind: "entry" }>>();
  for (const r of rows) if (r.kind === "entry") byPath.set(r.entry.path, r);
  const matched = new Set<string>();
  const keep = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "entry" || !r.entry.name.toLocaleLowerCase().includes(needle)) continue;
    matched.add(r.id);
    keep.add(r.id);
    for (let up = byPath.get(r.parent); up && !keep.has(up.id); up = byPath.get(up.parent)) keep.add(up.id);
  }
  return { rows: rows.filter((r) => keep.has(r.id)), matched, count: matched.size };
}

export function nameMatch(name: string, query: string): [number, number] | null {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return null;
  const at = name.toLocaleLowerCase().indexOf(needle);
  return at < 0 ? null : [at, at + needle.length];
}
