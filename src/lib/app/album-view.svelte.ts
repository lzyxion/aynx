/** 앨범 목록의 보기(카드 · 줄) — `settings.toml` 이 아니라 localStorage 에 둔다: 원격 창 · 폰은 PC 와 따로 고른다. */
import { parseAlbumView, type AlbumView } from "$lib/orchestration/model/library";

const STORAGE_KEY = "aynx:orch-album-view";

function load(): AlbumView {
  try {
    if (typeof localStorage === "undefined") return "cards";
    return parseAlbumView(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "cards";
  }
}

let view = $state<AlbumView>(load());

export function albumView(): AlbumView {
  return view;
}

export function setAlbumView(next: AlbumView): void {
  view = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 무시 */
  }
}
