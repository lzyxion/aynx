import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

/**
 * **테마 프로필 빠른 전환 — 열림 상태** (docs/log/2026-09-28-profile-switcher.md).
 *
 * `switch-profile`(기본 `Ctrl+Shift+U`) · 명령 팔레트의 같은 이름 줄이 여기로 온다. 여는 순간 키보드가 있던
 * 자리를 적어 두고(`app/focus-return`) 닫으면 그리로 돌려준다 — 대개 터미널이다. 고른 카드 · 스크롤은
 * 컴포넌트(`ProfileSwitcher.svelte`)의 지역 상태라 `{#if}` 로 붙었다 떨어지며 저절로 비워진다.
 *
 * 창의 키 가드(`anyModalOpen`)와 Escape 사슬이 [`profileSwitcherVisible`] 을 본다 — 떠 있는 동안 전역 단축키가 쉬고
 * 키는 셸로 새지 않는다(포커스가 카드 줄에 있다).
 */

/** 포커스 복귀 이름표 (`app/focus-return`) */
const FOCUS_KEY = "profile-switcher";

let open = $state(false);

/** 떠 있나 — 반응형 */
export function profileSwitcherVisible(): boolean {
  return open;
}

export function openProfileSwitcher(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_KEY);
  open = true;
}

/** 닫는다 — 포커스는 연 자리로 (적용한 뒤에도 같다: 모양만 바뀌고 일하던 자리는 그대로다) */
export function closeProfileSwitcher(): void {
  if (!open) return;
  open = false;
  // 그림은 나가는 전이(180ms) 동안 남는다 — 카드 줄이 포커스를 쥔 채 남으면 돌려주기가 "누가 가져갔다" 로 읽고 물러선다
  const ae = typeof document === "undefined" ? null : document.activeElement;
  if (ae instanceof HTMLElement && ae.closest("[data-profile-switcher]")) ae.blur();
  returnFocus(FOCUS_KEY);
}

/** 단축키는 토글이다 — 떠 있는 동안은 카드 줄이 스스로 그 키를 보고 닫는다 (포커스가 거기 있다) */
export function toggleProfileSwitcher(): void {
  if (open) closeProfileSwitcher();
  else openProfileSwitcher();
}
