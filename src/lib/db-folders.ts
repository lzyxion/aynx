/**
 * **독 DB 칸의 폴더 모델** — 호스트 독의 폴더(`host-folders.ts` · docs/log/2026-09-25-hosts-tree.md)와 같은 규칙을 DB 연결에 건다
 * (10-15 사용자 요청 — 10-13 의 "묶음 없이 한 목록" 을 바꿨다).
 *
 * - 폴더는 **경로 문자열**(`"운영/웹"`)로만 있다 — 연결 줄의 `folder` 칸(`db-connections.json` · 없으면 최상위)이 호스트의 `group` 몫.
 *   접속 · AI 권한 신원 스냅샷은 이 칸을 보지 않는다(폴더를 옮겨도 권한이 풀리지 않는다 — Rust `DbIdentity` · 프런트 `sameDbTarget`).
 * - 폴더의 아이콘 · 색과 **빈 폴더의 존재**는 곁 파일 `db-folders.json`(경로 → `{ icon?, color? }`) — 호스트의 `sessions.toml`
 *   `[groups]` 몫이다. 연결 목록에 섞지 않는 까닭: 그 파일은 배열 하나이고 세션 서버도 읽는다(모양을 바꾸면 옛 판 서버가 못 읽는다).
 * - 한 층은 **폴더 먼저 · 연결 뒤**, 둘 다 **이름순**(`compareNames` — 호스트 · 프로젝트 칸과 같은 비교). 정렬 단추가 "최근" 이면
 *   연결만 다시 선다([`dbDockTree`] 의 `recentOf`). 끌어서 순서를 바꾸는 기능은 호스트 독에도 없다.
 * - 이름 변경 · 옮기기 · 해제는 모두 **경로 접두사 다시 쓰기 한 번**(Rust `sessions_meta::rewrite_group_path` 와 같은 뜻 — `to === ""`
 *   면 정확히 그 폴더의 연결은 최상위로, 아래 폴더는 한 단 올라간다).
 *
 * 순수 — DOM · 룬 없음. 경로 도구(`normalizeGroupPath` · `lastSegment` · `parentPath` · `canDropGroupInto`)는 호스트 쪽 것을 그대로 쓴다.
 */
import { canDropGroupInto, lastSegment, normalizeGroupPath, uniqueFolderName } from "$lib/host-folders";
import { dbDockRows, type DbDockConn } from "$lib/db-dock";
import { nextDbCopyName, type DbConn } from "$lib/db-conn";
import { compareNames, compareRecent } from "$lib/list-order";

/** 폴더 하나의 꾸밈 — 둘 다 비어도 항목이 있으면 폴더가 선다(빈 폴더) */
export interface DbFolderMeta {
  icon?: string;
  color?: string;
}

/** `db-folders.json` — 폴더 경로 → 꾸밈 */
export type DbFolderMap = Record<string, DbFolderMeta>;

/** 곁 파일 글자 → 표(모양이 어긋난 항목은 버린다 · 없거나 깨졌으면 빈 표). 경로는 다듬은 꼴로 */
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

/** 표 → 곁 파일 글자(경로순 — 같은 표면 같은 글자라 저장 생략이 산다) */
export function serializeDbFolderMeta(map: DbFolderMap): string {
  const sorted: DbFolderMap = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  return JSON.stringify(sorted, null, 2);
}

/** 연결이 놓인 폴더(`""` = 최상위) */
export function dbFolderOf(c: Pick<DbConn, "folder">): string {
  return normalizeGroupPath(c.folder);
}

/** `path` 가 `dir` 이거나 그 아래인가 */
function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** 트리의 한 줄 — 폴더(`f:<경로>`) 또는 연결(`DbDockConn` — 키 `conn:<id>`) */
export type DbTreeRow =
  | {
      kind: "folder";
      key: string;
      fullPath: string;
      label: string;
      /** 아래(하위 폴더 포함) 연결 수 — 검색 중이면 걸린 수 */
      count: number;
      depth: number;
      expanded: boolean;
      /** 검색이 저절로 펼쳤다(저장된 펼침과 무관 — ← 로 접을 것이 없다) */
      auto: boolean;
    }
  | (DbDockConn & { depth: number; folder: string });

/** 폴더 줄의 키 — 연결 키(`conn:`)와 섞이지 않는다 */
export function dbFolderKey(path: string): string {
  return `f:${path}`;
}

/** `dir` 바로 아래 폴더 이름들(이름순) — 연결의 폴더와 곁 파일 키(빈 폴더)의 조상까지 합친다 */
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

/** 그 층에 이미 있는 폴더 이름 — 새 폴더 · 이름 변경의 겹침 검사(화면과 같은 규칙) */
export function dbChildFolderNames(conns: readonly DbConn[], meta: DbFolderMap, parent: string): Set<string> {
  return new Set(childFolders([...conns.map(dbFolderOf), ...Object.keys(meta)], parent));
}

/**
 * **독 트리의 줄들** — 최상위부터 한 층씩(폴더 먼저 · 연결 뒤, 둘 다 이름순) · 펼친 폴더 아래를 재귀로 이어 붙인다.
 * 검색어가 있으면 걸린 연결만 남기고 그 조상 폴더를 **저절로 펼친다**(`auto`) — 빈 폴더는 서지 않는다(호스트 트리와 같다).
 * 검색 규칙은 예전 한 목록(`dbDockRows`) 그대로 + 폴더 경로(폴더 이름을 치면 그 안의 연결이 선다).
 *
 * `recentOf` 가 있으면 **"최근" 정렬**(독 정렬 단추 `[hosts] sort` — 호스트 · 프로젝트 칸과 같은 칸, 2026-10-20): 층마다 연결만
 * **그 연결 자신의** 마지막 성공 접속(연결 id → 시각 — DB 접속 기록 `db-history.ts`, 사람 쿼리 타일의 접속만 적힌다)이 늦은 순으로
 * 다시 서고(기록 없는 연결은 뒤에서 이름순), 폴더는 이름순 제자리다(호스트 트리의 `sortRowsByRecent` 와 같은 결). 경유 호스트의
 * 이력은 빌리지 않는다 — "최근 연 DB" 이지 "최근 붙은 서버의 DB" 가 아니다(같은 서버의 DB 여럿이 한 시각으로 묶이지 않게).
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
  // 이미 이름순인 줄을 안정 정렬로 다시 세운다 — 시각이 같으면(둘 다 없음 포함) 이름순이 남는다
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

/** 줄의 부모 폴더 — 폴더 줄은 제 부모, 연결 줄은 제 폴더(← 가 오르는 길) */
export function dbParentOfRow(row: DbTreeRow): string {
  if (row.kind === "folder") {
    const i = row.fullPath.lastIndexOf("/");
    return i < 0 ? "" : row.fullPath.slice(0, i);
  }
  return row.folder;
}

/** 줄이 가리키는 폴더 — 폴더 줄은 그 폴더, 연결 줄은 그 연결이 든 폴더(드롭 · "새 DB 연결" 의 자리) */
export function dbFolderOfRow(row: DbTreeRow | undefined | null): string {
  if (!row) return "";
  return row.kind === "folder" ? row.fullPath : row.folder;
}

// ---------------------------------------------------------------------------
// 바꾸기 — 모두 (목록, 표) → 새 (목록, 표). 저장은 부르는 쪽(`app/db-dock.svelte.ts`)
// ---------------------------------------------------------------------------

/** 경로 하나를 다시 쓴다 — 걸리지 않으면 `null`, 최상위로 가면 `""` (Rust `rewrite_group_path` 와 같은 뜻) */
function rewrite(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (!path.startsWith(`${from}/`)) return null;
  const rest = path.slice(from.length + 1);
  return to === "" ? rest : `${to}/${rest}`;
}

/**
 * **폴더 경로 접두사 `from` → `to`** — 이름 바꾸기 · 옮기기(중첩 · 최상위로) · 해제(`to === ""`)가 모두 이것 하나다. 연결의 `folder` 와
 * 곁 파일의 키가 함께 옮겨지고, 목적지 키가 이미 있으면 **옮겨 온 쪽이 이긴다**(호스트 쪽과 같다). 해제면 정확히 그 폴더의 꾸밈은 버린다.
 * 자기 아래로 옮기기(순환)는 아무것도 하지 않는다.
 */
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
// 여러 줄 — 짐 하나(드래그 · 잘라내기/복사 · 제거가 같은 모양 — 호스트 독의 `HostsDrag` · `payloadOfIds` 와 같은 결)
// ---------------------------------------------------------------------------

/**
 * 독 DB 칸의 드래그 짐 종류 — 값은 고른 줄 키들(연결 `conn:<id>` · 폴더 `f:<경로>`)을 `\n` 으로 이은 것. 독 안의 옮기기
 * (`DbList.svelte`)와 즐겨찾기로 받기(`favorite-drop.ts` — 연결만 받는다)가 같은 상수를 본다.
 */
export const DB_DOCK_DRAG_TYPE = "application/x-aynx-db-dock";

/** 끌거나 담은 짐 — 연결 id 들과 폴더 경로들(보이는 순서). 독 안의 옮기기 · 잘라내기/복사 · 제거가 쓴다 */
export interface DbDockDrag {
  conns: string[];
  folders: string[];
}

/** 빈 짐인가 */
export function dbDragEmpty(d: DbDockDrag | null | undefined): boolean {
  return !d || (d.conns.length === 0 && d.folders.length === 0);
}

/** 고른 줄 키들을 짐으로 편다 — 순서는 `order`(보이는 순서)를 훑어 만든다(고른 차례가 아니라). 키는 연결 `conn:<id>` · 폴더 `f:<경로>` */
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

/** 드래그 짐의 글자(`DB_DOCK_DRAG_TYPE` 의 값) → 짐 — 실린 키 순서 그대로. 모르는 키 · 빈 줄은 버린다 */
export function decodeDbDockDrag(raw: string): DbDockDrag {
  const keys = raw.split("\n").map((k) => k.trim()).filter((k) => k !== "");
  return dbPayloadOfKeys(keys, new Set(keys));
}

/** 다른 고른 폴더 **아래에 든** 폴더는 뺀다 — 그 폴더와 함께 간다(따로 옮기면 하위 구조가 납작해진다) */
function topFolders(folders: readonly string[]): string[] {
  const set = [...new Set(folders.map(normalizeGroupPath).filter((p) => p !== ""))];
  return set.filter((p) => !set.some((o) => o !== p && p.startsWith(`${o}/`)));
}

/** 고른 폴더(하위 포함) 아래에 든 연결 id — 낱개 이동 · 복사에서 빠진다(폴더와 함께 간다) */
function carriedIds(conns: readonly DbConn[], folders: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const c of conns) {
    const p = dbFolderOf(c);
    if (folders.some((f) => under(p, f))) out.add(c.id);
  }
  return out;
}

/** 연결의 폴더 칸을 갈아 끼운다(`""` = 최상위 — 칸을 지운다) */
function withFolder(c: DbConn, dest: string): DbConn {
  const { folder: _old, ...rest } = c;
  return dest === "" ? rest : { ...rest, folder: dest };
}

/**
 * 짐을 `dest` 폴더(`""` = 최상위)에 놓는 데 **뜻이 있는가** — 하나라도 옮겨지면 참(호스트 독의 `canDropInto` 와 같은 결).
 * 거절 규칙은 한 줄일 때와 같다: 연결은 이미 그 폴더면 아니고, 폴더는 순환 · 제자리(`canDropGroupInto`).
 */
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

/**
 * 짐을 `dest` 에 놓은 뒤의 (목록, 표)와 옮긴 폴더들 — 뜻이 없으면 `null`. 드롭과 잘라내기 붙여넣기가 같은 값을 만든다.
 * **폴더를 먼저**(접두사 다시 쓰기 — 아래 연결 · 꾸밈이 함께 간다), 고른 폴더 아래에 있던 연결은 낱개 이동에서 뺀다(호스트 `planMoveInto`).
 * 옮길 수 없는 것(이미 그 폴더 · 순환)은 건너뛰고 나머지만 옮긴다. 저장은 부르는 쪽이 **한 번에**.
 */
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

/** [`planDbPasteCopy`] 가 거절한 것의 안내 — 문구 키(순수 모듈이라 사전을 들이지 않는다) */
export interface DbPasteNotice {
  key: "app.hosts.paste.selfcopy";
  params: { name: string };
}

/**
 * **복사 붙여넣기** — 연결은 복제(새 id · `<이름>-copy` — 한 줄 "복제" 와 같은 규칙, 볼트 비밀번호는 옮기지 않는다), 폴더는 그 아래를
 * 통째로(하위 구조 · 꾸밈까지 — 빈 폴더도 선다). 같은 층에 같은 이름의 폴더가 있으면 `-copy` 를 붙인다(호스트 `planPasteCopy`).
 * 폴더를 자기 자신이나 자기 안으로 복사하는 것은 거절(안내).
 */
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

/**
 * **고른 것을 지운 뒤**의 (목록, 표)와 지운 연결 id — 폴더는 "그 아래 연결을 전부 지우고 꾸밈(하위 포함)을 치운다" 는 뜻이다(호스트 독의
 * 제거와 같다). 지운 id 의 볼트 비밀번호는 부르는 쪽이, AI 권한 블록은 Rust `db_conn_save`(목록에서 빠진 id 의 `[[database]]`)가 걷는다.
 */
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

/** 폴더 이름 검사 — 새 폴더 · 이름 변경이 같은 셋(비었나 · `/` · 같은 층 겹침). 문구 키를 돌려준다 */
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
