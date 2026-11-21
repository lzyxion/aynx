/**
 * 끝내기 모달. [모두 종료]는 두 번 묻지 않는다 — 판을 고르는 것이 곧 확인이다(사용자 결정).
 * 세 명령은 메인 PC 전용이다(`remote/deny.rs` 의 `HOME_ONLY`).
 */

import { invoke } from "$lib/ipc";
import { winClose } from "$lib/app/window.svelte.js";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

const FOCUS_QUIT = "quit-dialog";

let open = $state(false);

export function quitDialogOpen(): boolean {
  return open;
}

export function openQuitDialog(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_QUIT);
  open = true;
}

export function closeQuitDialog(): void {
  if (!open) return;
  open = false;
  returnFocus(FOCUS_QUIT);
}

export function hideToTray(): void {
  open = false;
  void invoke("app_hide_to_tray").catch(() => {});
}

export function closeThisWindow(): void {
  open = false;
  winClose();
}

export function quitGui(): void {
  open = false;
  void invoke("app_quit_gui").catch(() => {});
}

export function quitAll(): void {
  open = false;
  void invoke("app_end_all_sessions").catch(() => {});
}
