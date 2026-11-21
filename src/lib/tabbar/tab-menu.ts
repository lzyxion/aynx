/** 탭 줄 메뉴들이 함께 쓰는 키 처리 */

export const menuRows = (el: HTMLElement | null): HTMLElement[] =>
  el ? [...el.querySelectorAll<HTMLElement>(".menu-row:not(:disabled)")] : [];

/** 시험에서 DOM 없이 넘긴다 */
type Box = { contains(node: Node | null): boolean } | null;

/**
 * 창 캡처 단계의 Escape 가 닫을 메뉴 — 캡처여야 한다: 포커스가 xterm 이면 Escape 를 셸로 보내고 전파를 끊어 버블 단계에 오지 않는다.
 * IME 가 켜져 있으면 Escape 가 `key: "Process"` 로 올 수 있어 물리 키 `code` 도 본다(조합 중이어도 닫는다 — 사용자 결정).
 * 목록 안에서 난 Escape 는 제 키 처리가 받는다 — 여기서 먹지 않는다. 끌기 중이면 부르는 쪽이 `ws` 를 거짓으로 넘긴다.
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

/** Enter 는 버튼이 받는다 */
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
