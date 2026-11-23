/**
 * 객체 목록 탭의 규칙 — 칸 · 종류 고르기 · 찾기 · 정렬 · 키보드. 그림은 `ObjectList.svelte`.
 *
 * - 서버가 주는 것(`db_objects`)만 보인다 — 설명 · 행 수는 옛 서버면 없고, 없는 값은 "—".
 * - 정렬은 화면에서만이고 저장하지 않는다(고른 종류만 저장 — `QueryListTab.kind`).
 */
import type { QueryListKind } from "$lib/session";
import type { DbDialect, DbObject, DbObjects } from "./query-backend";
import { groupFolders, nameMatches, normFilter, type Folder } from "./schema-tree";

export type ListColumn = "name" | "kind" | "rows" | "comment" | "args" | "returns";

/** SQLite 는 설명 · 통계 행 수가 없다 */
export function listColumns(dialect: DbDialect, kind: QueryListKind): ListColumn[] {
  const lite = dialect === "sqlite";
  switch (kind) {
    case "table":
    case "matview":
    case "foreign":
      return lite ? ["name", "kind"] : ["name", "kind", "rows", "comment"];
    case "view":
      return lite ? ["name", "kind"] : ["name", "kind", "comment"];
    case "function":
      return ["name", "args", "returns", "comment"];
    case "procedure":
      return ["name", "args", "comment"];
    case "sequence":
    case "type":
      return lite ? ["name", "kind"] : ["name", "kind", "comment"];
  }
}

/** 원하는 종류가 그 스키마에 없으면 첫 종류 — 저장된 종류는 바꾸지 않는다(사람이 고를 때만) */
export function shownFolder(dialect: DbDialect, data: DbObjects, want: QueryListKind | undefined): Folder | null {
  const folders = groupFolders(dialect, data);
  return folders.find((f) => f.kind === want) ?? folders[0] ?? null;
}

export type ListSort = { col: "name" | "rows"; dir: "asc" | "desc" } | null;

/** 오름 → 내림 → 없음, 다른 칸이면 오름부터 */
export function nextListSort(cur: ListSort, col: "name" | "rows"): ListSort {
  if (!cur || cur.col !== col) return { col, dir: "asc" };
  return cur.dir === "asc" ? { col, dir: "desc" } : null;
}

/** 행 수가 없는 줄은 방향과 상관없이 아래 */
export function listRows(items: readonly DbObject[], filter: string, sort: ListSort): DbObject[] {
  const q = normFilter(filter);
  const out = q ? items.filter((o) => nameMatches(o.name, q)) : [...items];
  if (!sort) return out;
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.col === "name") return out.sort((a, b) => sign * a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out.sort((a, b) => {
    if (a.rows === undefined || b.rows === undefined) return (a.rows === undefined ? 1 : 0) - (b.rows === undefined ? 1 : 0);
    return sign * (a.rows - b.rows);
  });
}

export function rowsText(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString();
}

/** 표의 키보드 이동 — `null` 이면 그 키는 표가 받지 않는다 */
export function moveCursor(cur: number, key: string, total: number, page: number): number | null {
  if (total <= 0) return null;
  const last = total - 1;
  const at = Math.max(0, Math.min(last, cur));
  switch (key) {
    case "ArrowDown":
      return cur < 0 ? 0 : Math.min(last, at + 1);
    case "ArrowUp":
      return cur < 0 ? 0 : Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(last, at + Math.max(1, page));
    case "PageUp":
      return Math.max(0, at - Math.max(1, page));
    default:
      return null;
  }
}
