import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/**
 * **파일 타일의 트리 모형** — 펼침 화살표로 폴더를 그 자리에서 여는 보기의 줄 계산
 * (docs/log/2026-09-25-file-tree-view.md).
 *
 * 호스트 트리의 `hostTreeRows`(`host-folders.ts`)와 같은 결의 **순수 함수**다. 다른 점은 하나 —
 * 호스트 목록은 한 번에 다 알지만 파일은 **폴더를 펼칠 때 처음 읽는다**(게으른 읽기). 그래서
 * 폴더마다 읽기 상태([`FolderState`])가 따로 있고, 줄에는 "읽는 중" · "비어 있음" · "N개 더
 * 보기" 같은 **곁줄**이 끼어든다. 무엇을 언제 읽을지는 화면(`SftpBrowser`)이 정하고, 이 파일은
 * "지금 아는 것으로 무엇을 그리는가" 만 답한다.
 *
 * **들어가기 보기도 이 함수로 그린다** (`tree: false`) — 뿌리 줄만 깊이 0 으로 편다. 한 목록
 * 상자(`FileList`)가 두 보기를 한 길로 그리므로 선택·끌기·메뉴가 보기마다 갈리지 않는다.
 */

/** 폴더 하나의 읽기 상태 — 없으면(맵에 키가 없으면) 아직 한 번도 읽지 않았다 */
export type FolderState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; entries: readonly SftpEntry[] };

/** 트리의 줄 하나 */
export type FileTreeRow =
  | {
      kind: "entry";
      /** 선택 id — 항목의 절대 경로 (들어가기 보기와 같은 값) */
      id: string;
      entry: SftpEntry;
      depth: number;
      /** 이 줄이 들어 있는 폴더의 절대 경로 (뿌리 줄이면 뿌리) */
      parent: string;
      /** 펼칠 수 있는가 — 트리 보기의 폴더(링크 포함)만 참 */
      expandable: boolean;
      /** 지금 펼쳐져 있는가 (읽기에 실패한 폴더는 펼쳐 둔 것으로 치지 않는다) */
      expanded: boolean;
      /** 이 폴더를 못 읽었다 — 줄 안에 한 줄로 적는다 (없으면 `null`) */
      error: string | null;
    }
  | { kind: "loading"; id: string; depth: number; parent: string }
  | { kind: "empty"; id: string; depth: number; parent: string }
  | { kind: "more"; id: string; depth: number; parent: string; hidden: number };

/**
 * 한 폴더에서 처음 그리는 줄 수 — 넘으면 "N개 더 보기" 줄이 선다. 누를 때마다 이만큼 더 편다.
 *
 * 가상 스크롤 대신 이 방법을 고른 이유: 러버밴드·`scrollIntoView`·끌기 표시가 전부 **그려진
 * DOM 줄**을 보고 움직인다(`boxesIn`). 줄을 창 밖에서 지우는 가상화는 그 셋을 다시 짜야 하지만,
 * 상한은 그들이 보는 세상을 그대로 둔다. `node_modules` 한 층(수천 개)을 펼쳐도 첫 그림은
 * 이 줄 수로 끝난다.
 */
export const TREE_PAGE = 500;

/** 곁줄 id 의 머리 — 경로와 절대 겹치지 않게 NUL 로 시작한다 (경로에는 NUL 이 올 수 없다) */
const AUX = "\u0000";

/** "N개 더 보기" 줄의 id — 키보드 커서가 앉을 수 있는 유일한 곁줄이다 */
export function moreRowId(parent: string): string {
  return `${AUX}more${AUX}${parent}`;
}

/** 이 id 가 곁줄("더 보기")의 것인가 */
export function isAuxId(id: string): boolean {
  return id.startsWith(AUX);
}

export interface FileTreeOptions {
  /** 트리 보기인가 — 거짓이면 들어가기 보기(뿌리 줄만, 상한 없음) */
  tree: boolean;
  showHidden: boolean;
  /** 펼친 폴더의 절대 경로 */
  expanded: ReadonlySet<string>;
  /** 폴더별 읽기 상태 (타일마다 하나 — 접어도 남는다) */
  folders: ReadonlyMap<string, FolderState>;
  /** 폴더별로 지금 몇 줄까지 펴 보였는가 — 없으면 [`TREE_PAGE`] */
  limits?: ReadonlyMap<string, number>;
  /** 한 번에 펴는 줄 수 (시험용으로 바꿀 수 있다) */
  page?: number;
}

/**
 * 뿌리 목록과 읽기 상태로 **그릴 줄**을 편다.
 *
 * - 트리 보기: 펼친 폴더 아래로 재귀. 펼쳤는데 아직 모르면 "읽는 중" 한 줄, 비었으면 "비어
 *   있음" 한 줄, 못 읽었으면 그 폴더 줄에 오류를 싣고 펼치지 않는다. 한 폴더의 줄이 상한을
 *   넘으면 나머지를 "N개 더 보기" 한 줄로 접는다(뿌리도 같다).
 * - 들어가기 보기: 뿌리 줄만, 펼침 없음, 상한 없음 — 예전 목록 그대로다.
 *
 * 숨김 필터는 층마다 건다(숨김 폴더 아래는 애초에 안 보인다). 정렬은 백엔드 것을 그대로 쓴다.
 */
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
        // 아직 모른다(읽는 중이거나 이제 읽을 차례) — 자리를 한 줄 잡아 둔다
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

/** 항목 줄의 id 만, 보이는 순서대로 — 선택·끌기·마퀴가 쓰는 순서 */
export function entryOrder(rows: readonly FileTreeRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.kind === "entry") ids.push(r.id);
  return ids;
}

/** 키보드 커서가 앉을 수 있는 줄의 id — 항목 + "더 보기" (↑↓·Home·End 가 이 순서를 걷는다) */
export function navOrder(rows: readonly FileTreeRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.kind === "entry" || r.kind === "more") ids.push(r.id);
  return ids;
}

/**
 * **조작의 대상 폴더** — 붙여넣기 · 새 폴더 · 업로드/가져오기가 어디로 가는가
 * (호스트 트리의 `folderOfRow` 와 같은 규칙).
 *
 * 고른 줄이 폴더면 **그 폴더**, 파일이면 **그 파일이 든 폴더**, 곁줄이면 그 곁줄이 달린 폴더,
 * 아무것도 안 골랐으면 **뿌리**. 트리에는 "들어가 있는 폴더" 가 뿌리 하나뿐이라, 고른 줄이
 * 그 자리를 대신한다.
 */
export function targetDirOf(row: FileTreeRow | null | undefined, root: string): string {
  if (!row) return root;
  if (row.kind === "entry") return isDirLike(row.entry) ? row.entry.path : row.parent;
  return row.parent;
}

/**
 * **끌어 놓는 곳이 정하는 폴더** — 폴더 줄 = 그 폴더, 파일 줄·곁줄 = 그것이 든 폴더.
 * 빈 바닥은 이 함수를 부르지 않는다(목록 상자가 받아 뿌리로 간다).
 */
export function dropDirOf(row: FileTreeRow): string {
  if (row.kind === "entry" && isDirLike(row.entry)) return row.entry.path;
  return row.parent;
}

/** ← 가 올라갈 줄 — 이 줄이 든 폴더의 줄 id (뿌리 바로 아래면 `null`) */
export function parentRowId(rows: readonly FileTreeRow[], id: string): string | null {
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const up = rows.find((r) => r.kind === "entry" && r.entry.path === row.parent);
  return up ? up.id : null;
}

/** → 가 들어갈 줄 — 펼친 폴더 바로 아래의 첫 줄(커서가 앉을 수 있는 것만), 없으면 `null` */
export function firstChildId(rows: readonly FileTreeRow[], id: string): string | null {
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) return null;
  const row = rows[at];
  const next = rows[at + 1];
  if (!next || next.depth !== row.depth + 1) return null;
  return next.kind === "entry" || next.kind === "more" ? next.id : null;
}

/**
 * **글자 쳐서 고르기** — 이름이 `prefix` 로 시작하는 다음 항목 줄(대소문자 무시).
 *
 * 한 글자면 **지금 줄 다음부터** 찾는다(같은 글자를 거듭 치면 그 글자로 시작하는 줄들을
 * 돈다 — 탐색기의 관례). 두 글자 이상이면 지금 줄부터 찾는다(치는 동안 커서가 제자리에 있다).
 * 끝에 닿으면 처음으로 감싼다. 없으면 `null`.
 */
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

/**
 * 경로 집합에서 `from` 과 그 아래를 `to` 로 옮겨 적는다 — 폴더 이름을 바꾼 뒤 펼침이 따라가게
 * (호스트 트리의 `rebaseExpanded` 와 같은 뜻). 구분자는 둘 다 본다(로컬 `\` · 원격 `/`).
 * `to` 가 `null` 이면 그 아래를 버린다(지웠다). 바뀐 것이 없으면 **같은 집합**을 돌려준다.
 */
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
 * **이름 거르기** (필터 줄 — `Ctrl+I`, docs/log/2026-10-07-file-tile-dolphin.md) — 이름에 `query` 가 든(대소문자 무시)
 * 항목 줄과 **그 조상 폴더 줄**만 남긴다. 자세히 보기에서 펼쳐 둔 하위도 함께 거른다 — 깊은 곳의 맞는 파일이 어느 폴더
 * 안에 있는지가 그대로 보인다. 곁줄(읽는 중 · 비어 있음 · 더 보기)은 거르는 동안 뺀다(그 줄들의 뜻은 거르지 않은 목록의
 * 것이다). 빈 질의면 줄을 그대로 돌려준다.
 *
 * `matched` 는 **맞는** 항목의 id 다 — 조상이라 남은 줄과 가른다(화면이 조상을 흐리게 그린다). `count` 는 그 수.
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
    // 조상 사슬 — 이 줄이 든 폴더의 줄을 거슬러 오른다(뿌리 바로 아래면 사슬이 없다)
    for (let up = byPath.get(r.parent); up && !keep.has(up.id); up = byPath.get(up.parent)) keep.add(up.id);
  }
  return { rows: rows.filter((r) => keep.has(r.id)), matched, count: matched.size };
}

/** 이름 안에서 `query` 가 처음 맞는 자리 — `[시작, 끝)`, 없거나 빈 질의면 `null` (필터 줄의 강조) */
export function nameMatch(name: string, query: string): [number, number] | null {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return null;
  const at = name.toLocaleLowerCase().indexOf(needle);
  return at < 0 ? null : [at, at + needle.length];
}
