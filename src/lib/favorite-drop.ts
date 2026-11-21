import { decodeHostsDrag, HOSTS_DRAG_TYPE } from "$lib/hosts";
import { PROJECT_DRAG_TYPE } from "$lib/projects";
import { DB_DOCK_DRAG_TYPE, decodeDbDockDrag } from "$lib/db-folders";
import type { Favorite } from "$lib/favorites";

/**
 * 받지 않는 짐이면(`favoriteDropKind` 가 `null`) `preventDefault` 도 안 한다 — 본문의 호스트 드롭 · 타일 분할 드롭이 그대로 산다.
 * `dragover` 에서는 종류만 보이므로 종류 판정과 값 풀기를 나눈다.
 */

export type FavoriteDropKind = "host" | "project" | "db";

export function favoriteDropKind(types: readonly string[] | null | undefined): FavoriteDropKind | null {
  if (!types) return null;
  if (types.includes(PROJECT_DRAG_TYPE)) return "project";
  if (types.includes(HOSTS_DRAG_TYPE)) return "host";
  if (types.includes(DB_DOCK_DRAG_TYPE)) return "db";
  return null;
}

/** 폴더는 받지 않는다 — 칸은 가리키는 말 하나이고 폴더는 그 아래 전부를 뜻한다. 섞여 있으면 항목만 받는다 */
export function droppedFavorites(kind: FavoriteDropKind, read: (type: string) => string): Favorite[] {
  if (kind === "project") {
    const id = read(PROJECT_DRAG_TYPE).trim();
    return id === "" ? [] : [{ kind: "project", id }];
  }
  if (kind === "db") {
    return decodeDbDockDrag(read(DB_DOCK_DRAG_TYPE)).conns.map((id): Favorite => ({ kind: "db", id }));
  }
  return decodeHostsDrag(read(HOSTS_DRAG_TYPE)).hosts.map((alias): Favorite => ({ kind: "host", alias }));
}
