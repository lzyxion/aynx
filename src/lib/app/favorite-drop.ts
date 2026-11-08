import { MAX_FAVORITES, type AddFavoritesResult } from "$lib/favorites";
import { droppedFavorites, type FavoriteDropKind } from "$lib/favorite-drop";
import { addFavorites } from "$lib/favorites.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **끌어다 놓아 즐겨찾기에 더하기** — 하단 독(`DockFavorites.svelte`)이 부른다
 * (2026-10-23 — 예전에는 시작 화면 줄의 `addAll` 이었고, 그 줄은 같은 날 걷었다). 놓은 자리(`beforeKey` — 그 칸 앞 · `null` = 맨 뒤)에 짐의 순서대로 끼우고,
 * 중복은 조용히 넘기고, 열 칸이 차면 거기서 멈추고 한 줄로 알린다. 무엇이 더해졌는지 돌려주어 받는 쪽이 새 칸 · 이미 있던 칸을
 * 강조할 수 있게 한다. 규칙은 순수 층(`favorites.ts` 의 `withFavorites` · `favorite-drop.ts`)에 있다.
 */
export function addDroppedFavorites(
  kind: FavoriteDropKind,
  read: (type: string) => string,
  beforeKey: string | null,
): AddFavoritesResult {
  const result = addFavorites(droppedFavorites(kind, read), beforeKey);
  if (result.full) showNotice(t("app.start.favorites.full", { max: MAX_FAVORITES }));
  return result;
}
