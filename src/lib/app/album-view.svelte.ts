/**
 * **앨범 목록의 보기(카드 · 줄)** — 앨범 목록 · 보관함에 적용하고(스튜디오 · 최근 칸은 그대로) 라이브러리 · 스튜디오 화면이 같은 값을 쓴다. 다음 실행에도 남는다.
 *
 * `floating-dock-pin.svelte.ts` 와 같은 판단으로 localStorage(앱 오리진 단위)에 둔다: 화면 편의값이라 `settings.toml` 에 칸을 팔 무게가 아니고,
 * 원격 창 · 폰은 자기 브라우저의 값을 가져 PC 와 따로 고를 수 있다. 읽기 · 쓰기는 전부 try/catch — 막힌 환경이면 카드(기본)로 선다.
 */
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

/** 지금 보기(반응형) */
export function albumView(): AlbumView {
  return view;
}

export function setAlbumView(next: AlbumView): void {
  view = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}
