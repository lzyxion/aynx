import { tick } from "svelte";
import { focusedPane } from "$lib/app/tabs.svelte.js";
import { focusPaneBody } from "$lib/pane/focus";

/** 세션 목록 판의 열림 상태 — 판은 덮개다: 타일 크기를 바꾸지 않는다(터미널 refit · PTY resize 가 나가지 않는다) */

let open = $state(false);
let returnTo: HTMLElement | null = null;

/** 곧 숨는(`inert`) 자리라 포커스를 돌려줄 곳으로 적지 않는다 */
const TRANSIENT = "[data-floating-status-dock], [role='menu']";

export function sessionSheetOpen(): boolean {
  return open;
}

export function openSessionSheet(): void {
  if (open) return;
  if (typeof document !== "undefined") {
    const el = document.activeElement;
    returnTo = el instanceof HTMLElement && el !== document.body && !el.closest(TRANSIENT) ? el : null;
  }
  open = true;
}

/** `restore` 가 거짓이면(줄 고르기 · 모달) 돌려주지 않는다 — 그쪽이 포커스를 가져간다 */
export function closeSessionSheet(restore = true): void {
  if (!open) return;
  open = false;
  const back = returnTo;
  returnTo = null;
  if (typeof document === "undefined") return;
  // 판은 나가는 전이 동안 남는다 — 판 안의 포커스를 먼저 놓지 않으면 돌려주기 · `revealPane` 이 "누가 가져갔다" 로 읽고 물러서
  // 판이 사라질 때 포커스가 `<body>` 로 떨어진다.
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && ae.closest("[data-session-sheet]")) ae.blur();
  if (!restore) return;
  void tick().then(() => {
    const el = document.activeElement;
    const lost = el === null || el === document.body || el === document.documentElement;
    if (!lost) return;
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      return;
    }
    const pane = focusedPane();
    if (pane) focusPaneBody(pane.id);
  });
}

export function toggleSessionSheet(): void {
  if (open) closeSessionSheet();
  else openSessionSheet();
}
