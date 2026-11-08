/**
 * **끝내기 모달**(독의 끝내기 단추 — 2026-10-28, 목업 3KjFm4MbLeTPXyPLzbSjmv) — 열림 여부와 세 갈래의 실행.
 *
 * 예전에는 [모든 세션 종료] 확인 상자(`askConfirm`) 하나였다. 이제 고르는 판 셋이다:
 * - **트레이로 숨기기** — 창을 모두 닫고 트레이에 남는다(세션은 산다 · 설정 `tray_on_close` 와 상관없이). 트레이가 있는 환경
 *   (`tray_status().supported` — 지금은 Windows)에서만 판이 선다. Rust `tray::app_hide_to_tray` → 주 창의 `quitAll`.
 * - **GUI 종료** — 앱 화면만 끝낸다(세션은 세션 서버에서 산다). 트레이 [GUI 종료] 와 같은 길(Rust `tray::app_quit_gui` →
 *   주 창의 `quitAll` — 저장 안 한 문서 확인).
 * - **모두 종료** — 세션 · 세션 서버 · 앱을 끝낸다. **두 번 묻지 않는다**(사용자 결정 — 판을 고르는 것이 곧 확인이다).
 *   트레이 [모든 세션 종료…] 의 확인 **뒤** 흐름과 같은 길(`app_end_all_sessions`).
 *
 * - **이 창 닫기** — 보조 창에서만(메인 창은 위 셋이 그 몫이다). 제목줄 창 단추를 끈 기본 모양에서는 보조 창을 닫는 길이 이것이다
 *   (`[app] window_controls` — 2026-10-28). 창의 X 와 같은 길(`winClose` — 그 창의 저장 안 한 문서를 묻는다).
 *
 * 원격 창에는 끝내기 단추가 없다(`Dock.svelte`) — 세 명령도 집 PC 전용이다(`remote/deny.rs` 의 `HOME_ONLY`).
 */

import { invoke } from "$lib/ipc";
import { winClose } from "$lib/app/window.svelte.js";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

/** 포커스 복귀 이름표 (`app/focus-return`) */
const FOCUS_QUIT = "quit-dialog";

let open = $state(false);

/** 끝내기 모달이 떠 있는가 — 떠 있는 동안 전역 키가 쉰다(`app/keys` 의 `anyModalOpen`) */
export function quitDialogOpen(): boolean {
  return open;
}

/** 연다 — 독의 끝내기 단추 */
export function openQuitDialog(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_QUIT);
  open = true;
}

/** 닫는다 — Esc · 막 바깥 누르기(취소 단추는 없다 — 목업) */
export function closeQuitDialog(): void {
  if (!open) return;
  open = false;
  returnFocus(FOCUS_QUIT);
}

/** 창을 모두 닫고 트레이에 남는다 — 세션은 산다 */
export function hideToTray(): void {
  open = false;
  void invoke("app_hide_to_tray").catch(() => {});
}

/** 이 창(보조 창)만 닫는다 — 창의 X 와 같은 길 */
export function closeThisWindow(): void {
  open = false;
  winClose();
}

/** GUI 만 끝낸다 — 세션은 산다 */
export function quitGui(): void {
  open = false;
  void invoke("app_quit_gui").catch(() => {});
}

/** 세션 · 세션 서버 · 앱을 모두 끝낸다 — 두 번 묻지 않는다(머리말) */
export function quitAll(): void {
  open = false;
  void invoke("app_end_all_sessions").catch(() => {});
}
