import {
  fuzzyMatch,
  hostMeta,
  hostSearchText,
  hostsInGroup,
  type GroupMeta,
  type HostEntry,
  type HostsDrag,
} from "$lib/hosts";
import type { Key } from "$lib/i18n/keys";
import { compareNames } from "$lib/list-order";

/**
 * 호스트 독의 폴더 트리 규칙 (docs/log/2026-09-25-hosts-tree.md).
 * 그룹은 `"prod/web"` 같은 경로 문자열로만 존재한다 — 백엔드에 폴더라는 실체가 없어 층은 매번 호스트들의 그룹 경로에서 유도한다.
 */

export function segmentsOf(raw: string | null | undefined): string[] {
  const s = raw?.trim();
  return s
    ? s
        .split("/")
        .map((x) => x.trim())
        .filter((x) => x !== "")
    : [];
}

export function normalizeGroupPath(raw: string | null | undefined): string {
  return segmentsOf(raw).join("/");
}

export function groupPathOf(host: HostEntry): string {
  return normalizeGroupPath(hostMeta(host).group);
}

export function lastSegment(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export type HostRow =
  | {
      kind: "folder";
      fullPath: string;
      label: string;
      /** 하위 폴더까지 합친 호스트 수 */
      count: number;
    }
  | {
      kind: "host";
      host: HostEntry;
    };

export type HostMenuTarget =
  | { kind: "group"; path: string; x: number; y: number }
  | { kind: "host"; host: HostEntry; x: number; y: number }
  | { kind: "bg"; x: number; y: number };

/**
 * 폴더는 `g:<전체 경로>`, 호스트는 `h:<별칭>` — 접두사가 없으면 같은 이름의 폴더와 호스트가 섞인다.
 * 같은 별칭 블록이 여러 번 나오면 두 줄이 같은 id 다 — 모든 조작이 별칭 하나를 대상으로 삼으니 일부러 그대로 둔다.
 */
export function rowId(row: HostRow): string {
  return row.kind === "folder" ? `g:${row.fullPath}` : `h:${row.host.name}`;
}

/**
 * 한 층 — 하위 폴더 먼저, 직속 호스트 뒤, 둘 다 이름순(`compareNames`).
 * 폴더는 호스트 그룹 경로와 그룹 메타 키의 합집합이다 — 메타를 빼면 "폴더 추가" 로 만든 빈 폴더가 사라진다.
 */
export function folderRows(
  list: HostEntry[],
  dir: string,
  meta: Record<string, GroupMeta>,
): HostRow[] {
  const prefix = dir === "" ? "" : dir + "/";
  const folders: { fullPath: string; label: string }[] = [];
  const seen = new Set<string>();
  const direct: HostEntry[] = [];

  function offerFolder(path: string) {
    if (!path.startsWith(prefix)) return;
    const child = path.slice(prefix.length).split("/")[0];
    if (child === "" || seen.has(child)) return;
    seen.add(child);
    folders.push({ fullPath: prefix + child, label: child });
  }

  for (const host of list) {
    const path = groupPathOf(host);
    if (path === dir) {
      direct.push(host);
      continue;
    }
    offerFolder(path);
  }
  for (const path of Object.keys(meta)) offerFolder(normalizeGroupPath(path));
  folders.sort((a, b) => compareNames(a.label, b.label));
  direct.sort((a, b) => compareNames(a.name, b.name));

  const rows: HostRow[] = [];
  for (const f of folders) {
    rows.push({
      kind: "folder",
      fullPath: f.fullPath,
      label: f.label,
      count: hostsInGroup(list, f.fullPath).length,
    });
  }
  for (const host of direct) rows.push({ kind: "host", host });
  return rows;
}

/**
 * `auto` 는 검색이 저절로 펼친 폴더다 — 저장하지 않는다. `lastOkAt` 은 마지막 성공 접속 시각(Unix ms) —
 * "몇 분 전" 으로 바꾸는 것은 화면 몫이라 이 모형은 "지금" 을 모른다.
 */
export type HostTreeRow =
  | (Extract<HostRow, { kind: "folder" }> & { depth: number; expanded: boolean; auto: boolean })
  | (Extract<HostRow, { kind: "host" }> & { depth: number; lastOkAt: number | null });

export interface HostTreeOptions {
  sortLevel?: (rows: HostRow[]) => HostRow[];
  /** 이력 표를 직접 받지 않는다 — `host-history.ts` 가 이 파일을 들이므로 거꾸로 들이면 타입 고리가 생긴다 */
  lastOkOf?: (alias: string) => number | null;
}

/** 검색 중에는 걸린 호스트를 품은 폴더를 전부 펼치고, 메타에만 있는 빈 폴더는 세우지 않는다 */
export function hostTreeRows(
  list: HostEntry[],
  meta: Record<string, GroupMeta>,
  expanded: ReadonlySet<string>,
  query: string,
  opts: HostTreeOptions = {},
): HostTreeRow[] {
  const sortLevel = opts.sortLevel ?? ((rows: HostRow[]) => rows);
  const lastOkOf = opts.lastOkOf ?? (() => null);
  const q = query.trim();
  const searching = q !== "";
  const src = searching ? list.filter((h) => fuzzyMatch(q, hostSearchText(h))) : list;
  const levelMeta = searching ? {} : meta;
  const out: HostTreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    for (const r of sortLevel(folderRows(src, dir, levelMeta))) {
      if (r.kind === "folder") {
        const open = searching || expanded.has(r.fullPath);
        out.push({ ...r, depth, expanded: open, auto: searching });
        if (open) walk(r.fullPath, depth + 1);
      } else {
        out.push({ ...r, depth, lastOkAt: lastOkOf(r.host.name) });
      }
    }
  };
  walk("", 0);
  return out;
}

export function parentOfRow(row: HostRow): string {
  return row.kind === "folder" ? parentPath(row.fullPath) : groupPathOf(row.host);
}

export function folderOfRow(row: HostRow | undefined): string {
  if (!row) return "";
  return row.kind === "folder" ? row.fullPath : groupPathOf(row.host);
}

export function parseExpandedGroups(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** 바뀐 것이 없으면 같은 집합을 돌려준다 — 부르는 쪽이 저장을 건너뛰는 표시다 */
export function rebaseExpanded(set: ReadonlySet<string>, from: string, to: string): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const p of set) {
    if (p === from || p.startsWith(`${from}/`)) {
      changed = true;
      if (to !== "") next.add(to + p.slice(from.length));
    } else next.add(p);
  }
  return changed ? next : set;
}

/** 목록을 그리는 `folderRows` 를 그대로 쓴다 — 갈라지면 보이는 폴더와 "이미 있습니다" 의 기준이 어긋난다 */
export function childFolderNames(
  list: HostEntry[],
  parent: string,
  meta: Record<string, GroupMeta>,
): Set<string> {
  const out = new Set<string>();
  for (const row of folderRows(list, parent, meta)) {
    if (row.kind === "folder") out.add(row.label);
  }
  return out;
}

// ── 옮기기 ──

export function canNestInto(dragged: string | null, target: string): boolean {
  if (!dragged) return false;
  if (target === dragged) return false;
  if (target.startsWith(dragged + "/")) return false;
  if (parentPath(dragged) === target) return false;
  return true;
}

export function canDropGroupInto(dragged: string | null, path: string): boolean {
  if (!dragged) return false;
  if (path === "") return parentPath(dragged) !== "";
  return canNestInto(dragged, path);
}

/** 짐이 `null`(다른 창에서 온 드래그)이면 받아 두고 놓는 순간에 판정한다 */
export function canDropInto(payload: HostsDrag | null, path: string): boolean {
  if (!payload) return true;
  if (payload.hosts.length > 0) return true;
  return payload.groups.some((g) => canDropGroupInto(g, path));
}

/**
 * 드롭과 잘라내기 붙여넣기가 같이 쓴다. 끌린 폴더 아래의 호스트는 낱개 이동에서 뺀다 —
 * 폴더 이동이 이미 그들의 `group` 을 끌고 가므로, 낱개로 또 옮기면 하위 구조가 납작해진다.
 */
export function planMoveInto(
  payload: HostsDrag,
  path: string,
  list: HostEntry[],
): { renames: { from: string; to: string }[]; names: string[] } {
  const movable = payload.groups.filter((g) => canDropGroupInto(g, path));
  const carried = new Set<string>();
  for (const g of payload.groups) for (const h of hostsInGroup(list, g)) carried.add(h.name);
  const names = payload.hosts.filter((n) => !carried.has(n));
  const renames = movable.map((g) => ({
    from: g,
    to: path === "" ? lastSegment(g) : `${path}/${lastSegment(g)}`,
  }));
  return { renames, names };
}

/** 호스트 복제와 같은 규칙 — `-copy` → `-copy-2` … */
export function uniqueFolderName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let name = `${base}-copy`;
  for (let n = 2; taken.has(name); n++) name = `${base}-copy-${n}`;
  return name;
}

export interface PasteCopyPlan {
  items: { name: string; group: string | null }[];
  metaWrites: { path: string; icon: string | null; color: string | null }[];
  /** 문구가 아니라 문구 키 — 순수 모듈이라 사전을 들이지 않는다 */
  notices: { key: Key; params: Record<string, string> }[];
}

/** 호스트가 없는 폴더는 그룹 메타 항목이 유일한 존재 증거다 — 메타를 안 옮기면 빈 하위 폴더가 사라진다 */
export function planPasteCopy(
  payload: HostsDrag,
  dest: string,
  list: HostEntry[],
  meta: Record<string, GroupMeta>,
  defaultFolderIcon: string,
): PasteCopyPlan {
  const items: PasteCopyPlan["items"] = [];
  const metaWrites: PasteCopyPlan["metaWrites"] = [];
  const notices: PasteCopyPlan["notices"] = [];
  const seen = new Set<string>();
  const taken = childFolderNames(list, dest, meta);

  for (const g of payload.groups) {
    if (dest === g || dest.startsWith(`${g}/`)) {
      notices.push({ key: "app.hosts.paste.selfcopy", params: { name: lastSegment(g) } });
      continue;
    }
    const name = uniqueFolderName(lastSegment(g), taken);
    taken.add(name);
    const newRoot = dest === "" ? name : `${dest}/${name}`;
    for (const h of hostsInGroup(list, g)) {
      if (seen.has(h.name)) continue;
      seen.add(h.name);
      const rest = groupPathOf(h).slice(g.length).replace(/^\//, "");
      items.push({ name: h.name, group: rest ? `${newRoot}/${rest}` : newRoot });
    }
    let rooted = false;
    for (const [raw, m] of Object.entries(meta)) {
      const path = normalizeGroupPath(raw);
      if (path !== g && !path.startsWith(`${g}/`)) continue;
      const icon = m.icon?.trim() || null;
      const color = m.color?.trim() || null;
      if (!icon && !color) continue;
      const to = newRoot + path.slice(g.length);
      if (to === newRoot) rooted = true;
      metaWrites.push({ path: to, icon, color });
    }
    if (!rooted) metaWrites.push({ path: newRoot, icon: defaultFolderIcon, color: null });
  }

  for (const n of payload.hosts) {
    if (seen.has(n)) continue;
    seen.add(n);
    items.push({ name: n, group: dest === "" ? null : dest });
  }

  return { items, metaWrites, notices };
}

export function affectedHosts(payload: HostsDrag, list: HostEntry[]): string[] {
  const names = new Set(payload.hosts);
  for (const g of payload.groups) for (const h of hostsInGroup(list, g)) names.add(h.name);
  return [...names];
}

export function groupMetaPathsUnder(groups: string[], meta: Record<string, GroupMeta>): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const raw of Object.keys(meta)) {
      const path = normalizeGroupPath(raw);
      if (path !== g && !path.startsWith(`${g}/`)) continue;
      out.push(path);
    }
  }
  return out;
}

/** 순서는 `order`(보이는 순서)를 따른다 — `Set` 순서(고른 차례)를 쓰면 같은 것을 골라도 매번 다른 배치가 된다 */
export function payloadOfIds(order: readonly string[], ids: ReadonlySet<string>): HostsDrag {
  const hosts: string[] = [];
  const groups: string[] = [];
  for (const id of order) {
    if (!ids.has(id)) continue;
    if (id.startsWith("g:")) groups.push(id.slice(2));
    else hosts.push(id.slice(2));
  }
  return { hosts, groups };
}
