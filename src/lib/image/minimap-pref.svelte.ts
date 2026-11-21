/**
 * 이미지 타일의 작은 지도 켬/끔 — 앱 전체에 한 번 localStorage 에 기억한다(화면 편의값이라 `settings.toml` · `PaneSpec` 에 싣지 않는다).
 * 끌 때만 `"1"` 이 적힌다(키가 없으면 켬). 다른 창은 다시 띄울 때 따라온다(실시간 동기화는 하지 않는다).
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

export function minimapOn(): boolean {
  return shown;
}

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
