import {
  parseFavorites,
  reorderFavorites,
  serializeFavorites,
  withFavorites,
  withRenamedHost,
  withoutFavorite,
  type AddFavoritesResult,
  type Favorite,
} from "$lib/favorites";

/**
 * 즐겨찾기 목록의 상태와 localStorage 저장 (docs/log/2026-09-15-start-page-favorites.md). localStorage 인 까닭: 이 컴퓨터에서 이 사람이
 * 무엇을 고정해 두었는가 라는 화면 편의값이다 — 배치 파일과는 수명이 다르고(탭을 다 닫아도 남는다), 웹뷰의 localStorage 는 앱(오리진) 단위다.
 * 접근 자체가 throw 할 수 있어 읽기 · 쓰기를 전부 try/catch 로 감싼다.
 */

/** 앱 접두사로 다른 저장값과 섞이지 않게 한다 */
const STORAGE_KEY = "aynx:favorites";

function load(): Favorite[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = parseFavorites(raw);
    // 이관된 레이아웃 즐겨찾기는 백업하고 정리한다. 깨진 localStorage는 조용히 건너뛴다.
    if (raw && Array.isArray(JSON.parse(raw)) && JSON.parse(raw).some((f: { kind?: string } | null) => f?.kind === "layout")) {
      try {
        if (localStorage.getItem("aynx:favorites-before-workspaces") === null)
          localStorage.setItem("aynx:favorites-before-workspaces", raw);
        localStorage.setItem(STORAGE_KEY, serializeFavorites(parsed));
      } catch { /* 저장을 못 해도 이번 창은 정리된 메모리 목록을 쓴다 */ }
    }
    return parsed;
  } catch {
    return [];
  }
}

function persist(list: readonly Favorite[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, serializeFavorites(list));
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}

let list = $state<Favorite[]>(load());

export function favorites(): readonly Favorite[] {
  return list;
}

export function addFavorites(items: readonly Favorite[], beforeKey: string | null = null): AddFavoritesResult {
  const result = withFavorites(list, items, beforeKey);
  if (result.list !== list) {
    list = [...result.list];
    persist(list);
  }
  return result;
}

export function removeFavorite(fav: Favorite): void {
  const next = withoutFavorite(list, fav);
  if (next === list) return;
  list = [...next];
  persist(list);
}

export function renameFavoriteHost(from: string, to: string): boolean {
  const next = withRenamedHost(list, from, to);
  if (next === list) return false;
  list = [...next];
  persist(list);
  return true;
}

/** 인자가 [`favoriteKey`] 인 까닭 — 짐에 칸 전체를 담으면 놓는 순간의 목록과 어긋날 수 있다 */
export function moveFavorite(fromKey: string, toKey: string | null): void {
  const next = reorderFavorites(list, fromKey, toKey);
  if (next === list) return;
  list = [...next];
  persist(list);
}
