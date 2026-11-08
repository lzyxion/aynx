/**
 * 모달 안 Tab 순환 — 포커스가 모달 뒤(타일·탭 줄·독)로 새지 않게 끝에서 처음으로 되감는다.
 *
 * 브라우저의 기본 이동은 그대로 두고 **양 끝에서만** 끼어든다: 마지막 칸에서 Tab, 첫 칸에서
 * Shift+Tab, 그리고 포커스가 모달 뿌리 자신(`tabindex="-1"`)에 있을 때. 숨긴 섹션(`hidden`)·
 * `inert` 안의 칸은 순회에서 뺀다 — 탭으로 갈린 폼은 안 보이는 칸이 DOM 에 남아 있다.
 *
 * 끼어들었으면 `true` (기본 동작과 전파를 이미 끊었다).
 */
const TABBABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

export function trapTab(ev: KeyboardEvent, root: HTMLElement): boolean {
  if (ev.key !== "Tab" || ev.ctrlKey || ev.altKey || ev.metaKey) return false;
  const controls = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
  const first = controls[0];
  const last = controls.at(-1);
  const focused = document.activeElement;
  if (
    !first ||
    !last ||
    focused === root ||
    !root.contains(focused) ||
    (!ev.shiftKey && focused === last) ||
    (ev.shiftKey && focused === first)
  ) {
    ev.preventDefault();
    ev.stopPropagation();
    (ev.shiftKey ? last : first)?.focus({ preventScroll: true });
    return true;
  }
  return false;
}
