import type { HostEntry } from "$lib/hosts";
import type { Project } from "$lib/projects";
import type { DbDockConn } from "$lib/db-dock";

/**
 * 즐겨찾기 칸의 순수 규칙 (docs/log/2026-09-15-start-page-favorites.md). 칸에는 가리키는 말(별칭 · 프로젝트 id · DB 연결 id)만 담는다 —
 * 이름 · 아이콘을 베끼면 고친 뒤 옛 값을 보이고, DB 칸에는 주소 · 사용자 · 비밀번호를 담지 않는다.
 * 못 찾은 칸은 그릴 때 빠지기만 하고 저장소는 건드리지 않는다 — 잠시 주석 처리한 호스트가 돌아오면 칸도 살아난다.
 */

/** 넘치면 더하지 않는다 — 가장 오래된 것을 밀어내면 사람이 고정해 둔 칸이 소리 없이 사라진다 */
export const MAX_FAVORITES = 10;

/** 호스트 · 프로젝트 · DB 연결 참조만 남긴다. 구형 layout 항목은 parseFavorites에서 제외한다. */
export type Favorite =
  | { kind: "host"; alias: string }
  | { kind: "project"; id: string }
  | { kind: "db"; id: string };

/** 종류를 접두사로 붙이지 않으면 별칭이 `L3f2` 인 호스트와 그 id 의 프로젝트가 같은 칸으로 읽힌다 */
export function favoriteKey(fav: Favorite): string {
  if (fav.kind === "host") return `host:${fav.alias}`;
  if (fav.kind === "db") return `db:${fav.id}`;
  return `project:${fav.id}`;
}

export function sameFavorite(a: Favorite, b: Favorite): boolean {
  return favoriteKey(a) === favoriteKey(b);
}

export function hasFavorite(list: readonly Favorite[], fav: Favorite): boolean {
  const key = favoriteKey(fav);
  return list.some((f) => favoriteKey(f) === key);
}

/** 자리를 말하지 않으면 맨 뒤 — 앞에 끼우면 외운 칸들의 자리가 밀린다. 바뀐 게 없으면 같은 배열을 그대로 돌려준다(호출부가 `===` 로 안다) */
export function withFavorite(
  list: readonly Favorite[],
  fav: Favorite,
  beforeKey: string | null = null,
): readonly Favorite[] {
  if (!validFavorite(fav)) return list;
  if (hasFavorite(list, fav)) return list;
  if (list.length >= MAX_FAVORITES) return list;
  const at = beforeKey === null ? -1 : list.findIndex((f) => favoriteKey(f) === beforeKey);
  if (at < 0) return [...list, fav];
  return [...list.slice(0, at), fav, ...list.slice(at)];
}

export interface AddFavoritesResult {
  list: readonly Favorite[];
  added: Favorite[];
  existing: Favorite[];
  full: boolean;
}

export function withFavorites(
  list: readonly Favorite[],
  items: readonly Favorite[],
  beforeKey: string | null = null,
): AddFavoritesResult {
  let next = list;
  const added: Favorite[] = [];
  const existing: Favorite[] = [];
  let full = false;
  for (const fav of items) {
    if (!validFavorite(fav)) continue;
    if (hasFavorite(next, fav)) {
      existing.push(fav);
      continue;
    }
    if (next.length >= MAX_FAVORITES) {
      full = true;
      break;
    }
    next = withFavorite(next, fav, beforeKey);
    added.push(fav);
  }
  return { list: next, added, existing, full };
}

/**
 * 별칭 찾기는 대소문자를 무시한다(저장소 전체의 별칭 비교 기준) · `to` 칸이 이미 있으면 옛 칸은 빠진다 · 순서는 그대로
 * (docs/log/2026-09-17-host-rename-fanout.md).
 */
export function withRenamedHost(
  list: readonly Favorite[],
  from: string,
  to: string,
): readonly Favorite[] {
  const oldKey = from.trim().toLowerCase();
  const alias = to.trim();
  if (oldKey === "" || alias === "") return list;
  const isOld = (fav: Favorite) => fav.kind === "host" && fav.alias.trim().toLowerCase() === oldKey;
  if (!list.some(isOld)) return list;

  const renamed: Favorite = { kind: "host", alias };
  const out: Favorite[] = [];
  const seen = new Set<string>();
  for (const fav of list) {
    const next = isOld(fav) ? renamed : fav;
    const key = favoriteKey(next);
    if (seen.has(key)) continue; // 이름 변경이 만든 중복 — 앞의 칸이 이긴다
    seen.add(key);
    out.push(next);
  }
  return out;
}

export function withoutFavorite(list: readonly Favorite[], fav: Favorite): readonly Favorite[] {
  const key = favoriteKey(fav);
  const next = list.filter((f) => favoriteKey(f) !== key);
  return next.length === list.length ? list : next;
}

/** 상태바 선두단(`status-items.ts` 의 `reorder`) · 탭 스트립과 같은 계약이다 — 세 줄이 같은 몸짓이라 규칙이 갈리면 안 된다. 바뀐 게 없으면 같은 배열 */
export function reorderFavorites(
  list: readonly Favorite[],
  fromKey: string,
  toKey: string | null,
): readonly Favorite[] {
  if (fromKey === toKey) return list;
  const from = list.findIndex((f) => favoriteKey(f) === fromKey);
  if (from < 0) return list;
  if (toKey !== null && !list.some((f) => favoriteKey(f) === toKey)) return list;
  const rest = list.filter((f) => favoriteKey(f) !== fromKey);
  const at = toKey === null ? rest.length : rest.findIndex((f) => favoriteKey(f) === toKey);
  const next = [...rest.slice(0, at), list[from], ...rest.slice(at)];
  const same = next.every((fav, i) => favoriteKey(fav) === favoriteKey(list[i]));
  return same ? list : next;
}

function validFavorite(fav: Favorite): boolean {
  return fav.kind === "host" ? fav.alias.trim() !== "" : fav.id.trim() !== "";
}

/** 절대 throw 하지 않는다 — 모양이 어긋난 항목만 버린다 */
export function parseFavorites(raw: string | null | undefined): Favorite[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Favorite[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let fav: Favorite | null = null;
    if (o.kind === "host" && typeof o.alias === "string" && o.alias.trim() !== "") {
      fav = { kind: "host", alias: o.alias.trim() };
    } else if (o.kind === "project" && typeof o.id === "string" && o.id.trim() !== "") {
      fav = { kind: "project", id: o.id.trim() };
    } else if (o.kind === "db" && typeof o.id === "string" && o.id.trim() !== "") {
      fav = { kind: "db", id: o.id.trim() };
    }
    if (!fav) continue;
    const key = favoriteKey(fav);
    if (seen.has(key)) continue; // 중복은 앞의 것이 이긴다 (순서가 곧 자리다)
    seen.add(key);
    out.push(fav);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** 같은 목록이면 같은 글자 — 저장 전 비교가 이 결과를 쓴다 */
export function serializeFavorites(list: readonly Favorite[]): string {
  return JSON.stringify(
    list.map((f) => (f.kind === "host" ? { kind: "host", alias: f.alias } : { kind: f.kind, id: f.id })),
  );
}

export type ResolvedFavorite =
  | { key: string; fav: Favorite; kind: "host"; host: HostEntry }
  | { key: string; fav: Favorite; kind: "project"; project: Project }
  | { key: string; fav: Favorite; kind: "db"; conn: DbDockConn };

export function favoriteName(fav: ResolvedFavorite): string {
  if (fav.kind === "host") return fav.host.name;
  if (fav.kind === "db") return fav.conn.name;
  return fav.project.name;
}

export function favoriteTitle(
  fav: ResolvedFavorite,
  tr: (key: "app.projects.start.fav.title" | "app.projects.badge.local", params?: Record<string, string>) => string,
): string {
  if (fav.kind === "host") return fav.host.name;
  if (fav.kind === "db") return fav.conn.tabName;
  const host = fav.project.host?.trim() ?? "";
  return tr("app.projects.start.fav.title", {
    name: fav.project.name,
    where: host !== "" ? host : tr("app.projects.badge.local"),
  });
}

export function resolveFavorites(
  favs: readonly Favorite[],
  hosts: readonly HostEntry[],
  projects: readonly Project[] = [],
  dbs: readonly DbDockConn[] = [],
): ResolvedFavorite[] {
  const byAlias = new Map(hosts.map((h) => [h.name, h]));
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const byDb = new Map(dbs.map((c) => [c.id, c]));
  const out: ResolvedFavorite[] = [];
  for (const fav of favs) {
    const key = favoriteKey(fav);
    if (fav.kind === "host") {
      const host = byAlias.get(fav.alias);
      if (host) out.push({ key, fav, kind: "host", host });
    } else if (fav.kind === "db") {
      // 지운 연결은 삭제 흐름이 저장에서도 뺀다(`app/db-conns` 의 `forgetDbFavorites`)
      const conn = byDb.get(fav.id);
      if (conn) out.push({ key, fav, kind: "db", conn });
    } else {
      const project = byProject.get(fav.id);
      if (project) out.push({ key, fav, kind: "project", project });
    }
  }
  return out;
}
