// **이 창이 지금 활성인가** — 반응형 값 하나(docs/log/2026-10-21-file-tile-auto-refresh.md "상위 폴더 이름 바꾸기 잠금").
// 로컬 파일 타일 감시가 읽는다: 창이 뒤로 가면 감시를 걷어 OS 디렉터리 핸들을 닫는다(사람이 탐색기에서 상위 폴더를 고칠 수 있게).
//
// 출처는 웹 표준 `focus` · `blur` · `visibilitychange` + 판정 `windowFocused()`(`app/os-notify` — `document.hasFocus() && !document.hidden`)
// 이다. Tauri `getCurrentWindow().onFocusChanged` 가 아닌 이유:
// - **원격 웹 창(브라우저 탭)에서도 같은 뜻으로 돈다** — 폴리필에는 창 이벤트가 없지만 브라우저 탭의 포커스 · 가시성은 이 셋이 그대로 말한다.
// - 타일 안의 iframe(문서 미리 보기 등)으로 포커스가 들어가면 창 `blur` 는 오지만 `document.hasFocus()` 는 참으로 남는다 — 창 단위
//   포커스(Tauri)보다 "이 페이지가 사람 앞에 있나" 에 맞고, 최소화는 `document.hidden` 이 가른다.
// - 알림 배너(`AgentNotifyBanners`)가 이미 같은 판정을 쓴다 — 창 하나에 두 기준이 서지 않는다.
// 창마다 웹뷰가 따로라 이 모듈도 창마다 따로다(창별 판정이 저절로 선다).
import { windowFocused } from "$lib/app/os-notify";

let active = $state(windowFocused());

if (typeof window !== "undefined") {
  const sync = () => (active = windowFocused());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
}

/** 이 창이 지금 활성(포커스 + 보임)인가 — `$effect` · `$derived` 안에서 읽으면 따라간다 */
export function windowActive(): boolean {
  return active;
}
