import { MAX_FAVORITES, type AddFavoritesResult } from "$lib/favorites";
import { droppedFavorites, type FavoriteDropKind } from "$lib/favorite-drop";
import { addFavorites } from "$lib/favorites.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/** `beforeKey` — 그 칸 앞에 끼운다 · `null` = 맨 뒤 */
export function addDroppedFavorites(
  kind: FavoriteDropKind,
  read: (type: string) => string,
  beforeKey: string | null,
): AddFavoritesResult {
  const result = addFavorites(droppedFavorites(kind, read), beforeKey);
  if (result.full) showNotice(t("app.start.favorites.full", { max: MAX_FAVORITES }));
  return result;
}
