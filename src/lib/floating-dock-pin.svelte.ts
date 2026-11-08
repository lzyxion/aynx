/**
 * **하단 가운데 독의 고정(핀)** — 켜면 독이 올라온 채 서 있다(커서가 떠나도 · 바깥을 눌러도 · Escape 에도 접히지 않는다 —
 * 2026-10-23). 모달 · 가림막 동안은 고정이어도 숨는다(`FloatingStatusDock` 의 `blocked`). 독은 타일 위에 떠 있을 뿐이라 캔버스
 * 여백 · 터미널 크기는 바뀌지 않는다.
 *
 * 값은 **앱 하나에 하나**이고 다음 실행에도 남는다 — `favorites.svelte.ts` · `status-order.svelte.ts` 와 같은 판단으로
 * localStorage(창이 아니라 앱 오리진 단위)에 둔다: 이 컴퓨터에서 이 사람이 독을 어떻게 두는가 하는 화면 편의값이라
 * `settings.toml` 에 칸을 팔 무게가 아니다. 읽기 · 쓰기는 전부 try/catch — 막힌 환경이면 꺼짐(기본)으로 선다.
 * 다른 창이 바꾼 값은 그 창을 다시 띄울 때 따라온다(실시간 동기화는 하지 않는다).
 */

/** localStorage 키 — 켜져 있을 때만 `"1"` 이 적힌다 */
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

/** 독이 고정되어 있는가(반응형) */
export function dockPinned(): boolean {
  return pinned;
}

/** 고정을 켜고 끈다 — 끄면 저장값을 지운다 */
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
