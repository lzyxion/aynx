/**
 * 하단 가운데 독의 고정(핀) — 앱 하나에 하나, localStorage 에 둔다(`settings.toml` 칸이 아니다). 다른 창의 값은 다시 띄울 때 따라온다.
 */

/** 켜져 있을 때만 `"1"` 이 적힌다 */
const STORAGE_KEY = "aynx:floating-dock-pinned";

function load(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let pinned = $state(load());

export function dockPinned(): boolean {
  return pinned;
}

export function setDockPinned(on: boolean): void {
  pinned = on;
  try {
    if (typeof localStorage === "undefined") return;
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}
