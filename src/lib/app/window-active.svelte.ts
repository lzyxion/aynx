// 이 창이 지금 활성(포커스 + 보임)인가 — 창이 뒤로 가면 로컬 파일 타일 감시가 OS 디렉터리 핸들을 닫는다.
// Tauri `onFocusChanged` 를 쓰지 않는다 — 원격 웹 창에서도 같은 뜻으로 돌아야 하고, 타일 안 iframe 으로 포커스가 들어가도
// `document.hasFocus()` 는 참으로 남는다. 알림 배너와 같은 판정(`windowFocused`)이라 창 하나에 두 기준이 서지 않는다.
import { windowFocused } from "$lib/app/os-notify";

let active = $state(windowFocused());

if (typeof window !== "undefined") {
  const sync = () => (active = windowFocused());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
}

export function windowActive(): boolean {
  return active;
}
