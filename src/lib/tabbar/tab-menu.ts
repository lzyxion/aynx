/**
 * **탭 줄 메뉴들이 함께 쓰는 것** — `Tabs.svelte` 에서 그대로 옮겼다(탭 줄 · 워크스페이스 목록 · 접힌 탭 목록 · 탭 우클릭 메뉴).
 * - `menuRows` · `onListMenuKey` — 목록 안의 키(↑↓ · Home/End · Escape · Tab).
 */

export const menuRows = (el: HTMLElement | null): HTMLElement[] =>
  el ? [...el.querySelectorAll<HTMLElement>(".menu-row:not(:disabled)")] : [];

/** `contains` 만 쓰는 상자(시험에서 DOM 없이 넘긴다) */
type Box = { contains(node: Node | null): boolean } | null;

/**
 * **창 캡처 단계의 Escape** 가 탭 줄 메뉴를 닫을지 — 닫을 메뉴(우클릭 메뉴 `ctx` · 접힌 탭 목록 `more` · 워크스페이스 목록 `ws`)를 돌려준다.
 * 하나라도 참이면 부르는 쪽이 Escape 를 먹는다(`preventDefault` · `stopPropagation` — 메뉴만 닫고 셸로 보내지 않는다).
 *
 * 캡처여야 하는 이유: 포커스가 터미널(xterm)에 있으면 xterm 이 Escape 를 셸로 보내고 전파를 끊어 버블 단계의 창
 * 리스너에 오지 않는다(메뉴는 남고 셸만 Esc 를 받았다). 독 · 프로젝트 메뉴와 같은 관례(`ProjectMenu.svelte`).
 * - IME 조합 중이어도 메뉴가 열려 있으면 닫는다(2026-10-26 사용자 결정) — 조합 글자 취소는 입력기 몫이라 막지 않는다.
 *   한국어 IME 가 켜져 있으면 Escape 가 `key: "Process"`(keyCode 229)로 올 수 있어 물리 키 `code` 도 본다
 *   (`term/key-handlers.ts` 의 229 시임과 같은 판단).
 * - 접힌 탭 목록 **안**에서 난 Escape 는 목록의 키 처리(`onListMenuKey`)가 받아 포커스를 ⌄N 단추로 돌린다 — 여기서 먹지 않는다.
 * - 워크스페이스 목록(2026-10-27)도 같다 — 목록 · 줄의 우클릭 메뉴(`wsEls`) **안**의 Escape 는 제 키 처리가 받는다(목록은 닫고 단추로 ·
 *   우클릭 메뉴는 그것만 닫고 줄로). 끌기 중이면 부르는 쪽이 `ws` 를 거짓으로 넘긴다 — 그때 Escape 는 끌기만 취소한다(목록은 남는다).
 */
export function menuEscape(
  ev: { key: string; code: string; target: EventTarget | null },
  open: { ctx: boolean; more: boolean; moreEl: Box; ws?: boolean; wsEls?: readonly Box[] },
): { ctx: boolean; more: boolean; ws: boolean } {
  if (ev.key !== "Escape" && ev.code !== "Escape") return { ctx: false, more: false, ws: false };
  const target = ev.target as Node | null;
  const inMore = !!open.moreEl?.contains(target);
  const inWs = (open.wsEls ?? []).some((el) => !!el?.contains(target));
  return { ctx: open.ctx, more: open.more && !inMore, ws: !!open.ws && !inWs };
}

/**
 * 목록 안의 키(워크스페이스 목록 · 접힌 탭 목록) — ↑↓ · Home/End 로 줄을 옮기고, Escape 는 목록만
 * 닫는다(Enter 는 버튼이 받는다)
 */
export function onListMenuKey(ev: KeyboardEvent, el: HTMLElement | null, close: (back?: boolean) => void) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    close(true);
    return;
  }
  if (ev.key === "Tab") {
    close();
    return;
  }
  const rows = menuRows(el);
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    ev.key === "ArrowDown" ? (at + 1) % rows.length
    : ev.key === "ArrowUp" ? (at - 1 + rows.length) % rows.length
    : ev.key === "Home" ? 0
    : ev.key === "End" ? rows.length - 1
    : -1;
  if (next < 0 || rows.length === 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  rows[next]?.focus();
}
