/**
 * **이미지 타일의 작은 지도 켬/끔** — 앱 전체에 한 번 기억한다(타일마다가 아니다 · 기본 켬 · 2026-11-14).
 *
 * `floating-dock-pin.svelte.ts` · `app/album-view.svelte.ts` 와 같은 판단으로 localStorage(창이 아니라 앱 오리진 단위)에 둔다: 이 컴퓨터에서
 * 이 사람이 그림을 어떻게 보는가 하는 화면 편의값이라 `settings.toml` 에 칸을 팔 무게가 아니고, `PaneSpec` 에 실으면 타일마다가 된다.
 * **끌 때만** `"1"` 이 적힌다(기본이 켬이라 키가 없으면 켬). 읽기 · 쓰기는 전부 try/catch — 막힌 환경이면 켬(기본)으로 선다.
 * 같은 창의 모든 이미지 타일은 이 `$state` 하나를 읽어 함께 바뀌고, 다른 창은 다시 띄울 때 따라온다(실시간 동기화는 하지 않는다).
 */

const STORAGE_KEY = "aynx:image-minimap-off";

function load(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

let shown = $state(load());

/** 작은 지도를 켜 두었는가(반응형) */
export function minimapOn(): boolean {
  return shown;
}

/** 켜고 끈다 — 켜면 저장값을 지운다(기본이 켬) */
export function setMinimapOn(on: boolean): void {
  shown = on;
  try {
    if (typeof localStorage === "undefined") return;
    if (on) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}
