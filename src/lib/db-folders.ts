/**
 * 독 DB 칸의 폴더 모델 — 호스트 독의 폴더와 같은 규칙. 폴더는 연결의 `folder` 경로 글자로만 있다.
 * - 신원 스냅샷은 이 칸을 보지 않는다 — 폴더를 옮겨도 AI 권한이 풀리지 않는다.
 * - 꾸밈 · 빈 폴더는 곁 파일 `db-folders.json` 에 산다 — `db-connections.json` 은 세션 서버도 읽는 배열이라 모양을 바꾸면 옛 판 서버가 못 읽는다.
 * - 이름 변경 · 옮기기 · 해제는 모두 경로 접두사 다시 쓰기 한 번이다(Rust `sessions_meta::rewrite_group_path` 와 같은 뜻).
 */
import { canDropGroupInto, lastSegment, normalizeGroupPath, uniqueFolderName } from "$lib/host-folders";
import { dbDockRows, type DbDockConn } from "$lib/db-dock";
import { nextDbCopyName, type DbConn } from "$lib/db-conn";
import { compareNames, compareRecent } from "$lib/list-order";

/** 둘 다 비어도 항목이 있으면 폴더가 선다(빈 폴더) */
export interface DbFolderMeta {
  icon?: string;
  color?: string;
}

export type DbFolderMap = Record<string, DbFolderMeta>;

/** 모양이 어긋난 항목은 버린다 · 없거나 깨졌으면 빈 표 */
export function parseDbFolderMeta(raw: string | null | undefined): DbFolderMap {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: DbFolderMap = {};
  for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
    const path = normalizeGroupPath(k);
    if (path === "" || !m || typeof m !== "object" || Array.isArray(m)) continue;
    const r = m as Record<string, unknown>;
    const meta: DbFolderMeta = {};
    if (typeof r.icon === "string" && r.icon.trim() !== "") meta.icon = r.icon.trim();
    if (typeof r.color === "string" && r.color.trim() !== "") meta.color = r.color.trim();
    out[path] = meta;
  }
  return out;
}

/** 경로순 — 같은 표면 같은 글자라 저장 생략이 산다 */
export function serializeDbFolderMeta(map: DbFolderMap): string {
  const sorted: DbFolderMap = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  return JSON.stringify(sorted, null, 2);
}

/** `""` = 최상위 */
export function dbFolderOf(c: Pick<DbConn, "folder">): string {
  return normalizeGroupPath(c.folder);
}

function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

export type DbTreeRow =
  | {
      kind: "folder";
      key: string;
      fullPath: string;
      label: string;
      /** 하위 폴더 포함 — 검색 중이면 걸린 수 */
      count: number;
      depth: number;
      expanded: boolean;
      /** 검색이 저절로 펼쳤다 — ← 로 접을 것이 없다 */
      auto: boolean;
    }
  | (DbDockConn & { depth: number; folder: string });

/** 연결 키(`conn:`)와 섞이지 않는다 */
export function dbFolderKey(path: string): string {
  return `f:${path}`;
}

function childFolders(paths: Iterable<string>, dir: string): string[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const child = p.slice(prefix.length).split("/")[0];
    if (child !== "") seen.add(child);
  }
  return [...seen].sort(compareNames);
}

export function dbChildFolderNames(conns: readonly DbConn[], meta: DbFolderMap, parent: string): Set<string> {
  return new Set(childFolders([...conns.map(dbFolderOf), ...Object.keys(meta)], parent));
}

/**
 * 검색 중이면 걸린 연결의 조상 폴더를 저절로 펼치고 빈 폴더는 서지 않는다(호스트 트리와 같다).
 * `recentOf` = "최근" 정렬 — 연결 자신의 접속 시각만 쓴다. 경유 호스트의 이력은 빌리지 않는다(같은 서버의 DB 여럿이 한 시각으로 묶이지 않게).
 */
export function dbDockTree(
  conns: readonly DbConn[],
  meta: DbFolderMap,
  expanded: ReadonlySet<string>,
  query: string,
  match: (query: string, text: string) => boolean,
  recentOf?: (id: string) => number | null,
): DbTreeRow[] {
  const q = query.trim();
  const searching = q !== "";
  const folderOf = new Map(conns.map((c) => [c.id, dbFolderOf(c)]));
  const hitIds = searching ? new Set(dbDockRows(conns, q, match).map((c) => c.id)) : null;
  const rows = dbDockRows(conns, "", match)
    .map((c) => ({ ...c, folder: folderOf.get(c.id) ?? "" }))
    .filter((c) => hitIds === null || hitIds.has(c.id) || (c.folder !== "" && match(q, c.folder)));
  // 이름순인 줄을 안정 정렬로 다시 세운다 — 시각이 같으면 이름순이 남는다
  if (recentOf) {
    rows.sort((a, b) => compareRecent(recentOf(a.id), recentOf(b.id)));
  }
  const paths = [...rows.map((r) => r.folder), ...(searching ? [] : Object.keys(meta))];
  const out: DbTreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    for (const label of childFolders(paths, dir)) {
      const fullPath = dir === "" ? label : `${dir}/${label}`;
      const open = searching || expanded.has(fullPath);
      const count = rows.filter((r) => under(r.folder, fullPath)).length;
      out.push({ kind: "folder", key: dbFolderKey(fullPath), fullPath, label, count, depth, expanded: open, auto: searching });
      if (open) walk(fullPath, depth + 1);
    }
    for (const r of rows) if (r.folder === dir) out.push({ ...r, depth });
  };
  walk("", 0);
  return out;
}

/** ← 가 오르는 길 */
export function dbParentOfRow(row: DbTreeRow): string {
  if (row.kind === "folder") {
    const i = row.fullPath.lastIndexOf("/");
    return i < 0 ? "" : row.fullPath.slice(0, i);
  }
  return row.folder;
}

/** 드롭 · "새 DB 연결" 의 자리 */
export function dbFolderOfRow(row: DbTreeRow | undefined | null): string {
  if (!row) return "";
  return row.kind === "folder" ? row.fullPath : row.folder;
}

// ---------------------------------------------------------------------------
// 바꾸기 — 모두 (목록, 표) → 새 (목록, 표). 저장은 부르는 쪽
// ---------------------------------------------------------------------------

/** Rust `rewrite_group_path` 와 같은 뜻 — 걸리지 않으면 `null` */
function rewrite(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (!path.startsWith(`${from}/`)) return null;
  const rest = path.slice(from.length + 1);
  return to === "" ? rest : `${to}/${rest}`;
}

/** 목적지 키가 이미 있으면 옮겨 온 쪽이 이긴다(호스트 쪽과 같다). 해제(`to === ""`)면 그 폴더의 꾸밈은 버린다 */
export function renameDbFolder(
  conns: readonly DbConn[],
  meta: DbFolderMap,
  from: string,
  to: string,
): { conns: DbConn[]; meta: DbFolderMap } {
  const f = normalizeGroupPath(from);
  const t = normalizeGroupPath(to);
  if (f === "" || f === t || t.startsWith(`${f}/`)) return { conns: [...conns], meta: { ...meta } };
  const nextConns = conns.map((c) => {
    const p = rewrite(dbFolderOf(c), f, t);
    if (p === null) return c;
    const { folder: _old, ...rest } = c;
    return p === "" ? rest : { ...rest, folder: p };
  });
  const keep: DbFolderMap = {};
  const moved: DbFolderMap = {};
  for (const [k, m] of Object.entries(meta)) {
    const p = rewrite(k, f, t);
    if (p === null) keep[k] = m;
    else if (p !== "") moved[p] = m;
  }
  return { conns: nextConns, meta: { ...keep, ...moved } };
}

// ---------------------------------------------------------------------------
// 여러 줄 — 짐 하나(드래그 · 잘라내기/복사 · 제거가 같은 모양)
// ---------------------------------------------------------------------------

/** 값은 고른 줄 키들을 `\n` 으로 이은 것 — 독 안의 옮기기와 즐겨찾기로 받기(`favorite-drop.ts`)가 같은 상수를 본다 */
export const DB_DOCK_DRAG_TYPE = "application/x-aynx-db-dock";

export interface DbDockDrag {
  conns: string[];
  folders: string[];
}

export function dbDragEmpty(d: DbDockDrag | null | undefined): boolean {
  return !d || (d.conns.length === 0 && d.folders.length === 0);
}

/** 순서는 고른 차례가 아니라 `order`(보이는 순서)다 */
export function dbPayloadOfKeys(order: readonly string[], ids: ReadonlySet<string>): DbDockDrag {
  const conns: string[] = [];
  const folders: string[] = [];
  for (const key of order) {
    if (!ids.has(key)) continue;
    if (key.startsWith("f:")) folders.push(key.slice(2));
    else if (key.startsWith("conn:")) conns.push(key.slice(5));
  }
  return { conns, folders };
}

export function decodeDbDockDrag(raw: string): DbDockDrag {
  const keys = raw.split("\n").map((k) => k.trim()).filter((k) => k !== "");
  return dbPayloadOfKeys(keys, new Set(keys));
}

/** 다른 고른 폴더 아래에 든 폴더는 뺀다 — 따로 옮기면 하위 구조가 납작해진다 */
function topFolders(folders: readonly string[]): string[] {
  const set = [...new Set(folders.map(normalizeGroupPath).filter((p) => p !== ""))];
  return set.filter((p) => !set.some((o) => o !== p && p.startsWith(`${o}/`)));
}

/** 폴더와 함께 가므로 낱개 이동 · 복사에서 빠진다 */
function carriedIds(conns: readonly DbConn[], folders: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const c of conns) {
    const p = dbFolderOf(c);
    if (folders.some((f) => under(p, f))) out.add(c.id);
  }
  return out;
}

function withFolder(c: DbConn, dest: string): DbConn {
  const { folder: _old, ...rest } = c;
  return dest === "" ? rest : { ...rest, folder: dest };
}

/** 하나라도 옮겨지면 참 */
export function canDropDbInto(drag: DbDockDrag | null, dest: string, conns: readonly DbConn[]): boolean {
  if (!drag || dbDragEmpty(drag)) return false;
  const tops = topFolders(drag.folders);
  if (tops.some((f) => canDropGroupInto(f, dest))) return true;
  const carried = carriedIds(conns, tops);
  return drag.conns.some((id) => {
    const c = conns.find((d) => d.id === id);
    return c !== undefined && !carried.has(id) && dbFolderOf(c) !== dest;
  });
}

/** 폴더를 먼저 옮긴다 — 아래 연결 · 꾸밈이 함께 간다. 저장은 부르는 쪽이 한 번에 */
export function moveDbInto(
  conns: readonly DbConn[],
  meta: DbFolderMap,
  drag: DbDockDrag,
  dest: string,
): { conns: DbConn[]; meta: DbFolderMap; moved: { from: string; to: string }[] } | null {
  if (!canDropDbInto(drag, dest, conns)) return null;
  const tops = topFolders(drag.folders);
  const carried = carriedIds(conns, tops);
  let next = { conns: [...conns], meta: { ...meta } };
  const moved: { from: string; to: string }[] = [];
  for (const f of tops) {
    if (!canDropGroupInto(f, dest)) continue;
    const to = dest === "" ? lastSegment(f) : `${dest}/${lastSegment(f)}`;
    next = renameDbFolder(next.conns, next.meta, f, to);
    moved.push({ from: f, to });
  }
  const ids = new Set(drag.conns.filter((id) => !carried.has(id)));
  next.conns = next.conns.map((c) => (ids.has(c.id) && dbFolderOf(c) !== dest ? withFolder(c, dest) : c));
  return { ...next, moved };
}

export interface DbPasteNotice {
  key: "app.hosts.paste.selfcopy";
  params: { name: string };
}

/** 볼트 비밀번호는 옮기지 않는다. 폴더를 자기 자신이나 자기 안으로 복사하는 것은 거절한다 */
export function planDbPasteCopy(
  conns: readonly DbConn[],
  meta: DbFolderMap,
  drag: DbDockDrag,
  dest: string,
  newId: () => string,
): { conns: DbConn[]; meta: DbFolderMap; copied: number; notices: DbPasteNotice[] } {
  const list = [...conns];
  const nextMeta: DbFolderMap = { ...meta };
  const notices: DbPasteNotice[] = [];
  const seen = new Set<string>();
  let copied = 0;
  const copyOne = (src: DbConn, folder: string) => {
    list.push(withFolder({ ...src, id: newId(), name: nextDbCopyName(list, src.name, src.via) }, folder));
    copied += 1;
  };
  const taken = dbChildFolderNames(conns, meta, dest);
  for (const g of topFolders(drag.folders)) {
    if (dest === g || dest.startsWith(`${g}/`)) {
      notices.push({ key: "app.hosts.paste.selfcopy", params: { name: lastSegment(g) } });
      continue;
    }
    const name = uniqueFolderName(lastSegment(g), taken);
    taken.add(name);
    const root = dest === "" ? name : `${dest}/${name}`;
    for (const c of conns) {
      const p = dbFolderOf(c);
      if (!under(p, g) || seen.has(c.id)) continue;
      seen.add(c.id);
      copyOne(c, root + p.slice(g.length));
    }
    for (const [k, m] of Object.entries(meta)) if (under(k, g)) nextMeta[root + k.slice(g.length)] = { ...m };
    // 뿌리 폴더는 연결이 없어도 서야 한다(빈 폴더의 존재 증거)
    nextMeta[root] ??= {};
  }
  for (const id of drag.conns) {
    if (seen.has(id)) continue;
    const c = conns.find((d) => d.id === id);
    if (!c) continue;
    seen.add(id);
    copyOne(c, dest);
  }
  return { conns: list, meta: nextMeta, copied, notices };
}

/** 지운 id 의 볼트 비밀번호는 부르는 쪽이, AI 권한 블록은 Rust `db_conn_save` 가 걷는다 */
export function removeDbItems(
  conns: readonly DbConn[],
  meta: DbFolderMap,
  drag: DbDockDrag,
): { conns: DbConn[]; meta: DbFolderMap; removed: string[] } {
  const tops = topFolders(drag.folders);
  const doomed = carriedIds(conns, tops);
  for (const id of drag.conns) if (conns.some((c) => c.id === id)) doomed.add(id);
  const nextMeta: DbFolderMap = {};
  for (const [k, m] of Object.entries(meta)) if (!tops.some((f) => under(k, f))) nextMeta[k] = m;
  return {
    conns: conns.filter((c) => !doomed.has(c.id)),
    meta: nextMeta,
    removed: conns.filter((c) => doomed.has(c.id)).map((c) => c.id),
  };
}

export function dbFolderNameProblem(
  name: string,
  taken: ReadonlySet<string>,
): "app.hosts.folder.name.empty" | "app.hosts.folder.name.slash" | "app.hosts.folder.name.dup" | null {
  const n = name.trim();
  if (n === "") return "app.hosts.folder.name.empty";
  if (n.includes("/")) return "app.hosts.folder.name.slash";
  if (taken.has(n)) return "app.hosts.folder.name.dup";
  return null;
}
