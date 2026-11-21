import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

const FOCUS_KEY = "profile-switcher";

let open = $state(false);

export function profileSwitcherVisible(): boolean {
  return open;
}

export function openProfileSwitcher(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_KEY);
  open = true;
}

export function closeProfileSwitcher(): void {
  if (!open) return;
  open = false;
  // 그림은 나가는 전이(180ms) 동안 남는다 — 카드 줄이 포커스를 쥔 채 남으면 돌려주기가 "누가 가져갔다" 로 읽고 물러선다
  const ae = typeof document === "undefined" ? null : document.activeElement;
  if (ae instanceof HTMLElement && ae.closest("[data-profile-switcher]")) ae.blur();
  returnFocus(FOCUS_KEY);
}

export function toggleProfileSwitcher(): void {
  if (open) closeProfileSwitcher();
  else openProfileSwitcher();
}
