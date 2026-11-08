import { getCurrentWindow } from "@tauri-apps/api/window";
import { takeTearToken } from "$lib/tear";
import { invoke, isRemote } from "$lib/ipc";

/** 원격 웹 클라이언트로 도는가(R1a-3 — `$lib/ipc` 의 표식). 원격은 창 제어·끌어내기가 없고 주 창 묶음도 돌지 않는다. */
export { isRemote };

/**
 * **이 창은 어떻게 태어났는가 · 창 자신에 대한 조작**
 * (docs/log/2026-09-02-tear-out.md · 커스텀 타이틀바).
 *
 * `app/` 층에서 가장 먼저 확정되어야 하는 사실 둘을 든다:
 *
 * 1. **분리로 태어난 창인가** ([`tearToken`]) — 주소의 `#tear=<token>` 이 있으면 탭 분리로
 *    만들어진 창이다. 그 경우 시작 탭을 만들면 안 된다 (아무도 요청하지 않은 셸이 하나 뜬
 *    채 옮겨온 탭이 그 옆에 붙는다). 해시 읽기는 **동기**여야 하고 **한 번뿐**이라
 *    (`takeTearToken` 은 1회용), 모듈 초기화 시점에 붙잡아 둔다.
 * 2. **메인 창인가** ([`isMainWindow`]) — 메인 창은 마지막 탭을 닫아도 남는다
 *    (앱 자체가 사라지면 안 된다). 분리 창은 비면 스스로 닫힌다.
 *
 * 여기에 커스텀 타이틀바(`decorations:false`)의 창 제어 셋을 함께 둔다. 전부
 * fire-and-forget 로 오류를 삼킨다 — 권한이 없거나 창이 이미 닫히는 중이어도 UI 가
 * 멈추지 않게.
 */

/** 분리 창이면 그 이관 번호, 아니면 `null` (모듈 로드 시점에 **한 번** 읽는다) */
export const tearToken = takeTearToken();

const appWindow = getCurrentWindow();

/** 메인 창은 마지막 탭을 닫아도 남는다 (앱 자체가 사라지면 안 된다). 원격 창(`remote-*`)은 주 창이 아니다 — 자동 승인·대기 카드·
 * 떨어진 세션 안내·페어링 확인 같은 집 PC 주 창 묶음이 원격에서 돌지 않는다(설계 6절). */
export const isMainWindow = !isRemote && appWindow.label === "main";


// ---------------------------------------------------------------------------
// 커스텀 타이틀바 창 제어 (네이티브 버튼이 없으므로 직접 그린다)
// ---------------------------------------------------------------------------

let maximized = $state(false);

/** 지금 창이 최대화 상태인가 (타이틀바 아이콘이 읽는다) */
export function winMaximized(): boolean {
  return maximized;
}

/**
 * **이 창을 띄운다** — 메인 창은 `visible:false` 로 태어난다
 * (docs/log/2026-09-17-splash.md).
 *
 * 켜는 순간 보이던 **빈 투명 사각형**을 없애려고 창을 숨겨서 만들고, 스플래시가 한 번
 * 칠해진 뒤 `+page` 가 이것을 부른다. 즉 사용자가 보는 첫 프레임이 곧 스플래시다.
 *
 * 실패는 삼키고 한 줄만 남긴다 — 권한이 없거나(개발 중 capability 누락) 창이 이미 보이는
 * 상태여도 부팅이 멈출 이유가 없다. **이미 보이는 창에 불러도 무해하다**: 개발 서버의
 * 전체 리로드·F5 는 같은 창에서 이 경로를 다시 태우고, 분리 창은 애초에 보이는 채로 태어난다.
 */
export async function showThisWindow(): Promise<void> {
  try {
    await appWindow.show();
  } catch (err) {
    console.warn("[boot] 창을 띄우지 못했습니다", err);
  }
}

export const winMinimize = () => void appWindow.minimize().catch(() => {});
export const winToggleMax = () => void appWindow.toggleMaximize().catch(() => {});
export const winClose = () => void appWindow.close().catch(() => {});

/**
 * 최대화 상태를 따라간다 — 마운트에서 한 번 읽고 리사이즈마다 다시 읽는다.
 * 돌려주는 것은 정리 함수다 (`onMount` 의 반환값으로 그대로 쓴다).
 */
export function watchWindowMaximize(): () => void {
  let unlisten: (() => void) | null = null;
  void appWindow
    .isMaximized()
    .then((m) => (maximized = m))
    .catch(() => {});
  void appWindow
    .onResized(
      () =>
        void appWindow
          .isMaximized()
          .then((m) => (maximized = m))
          .catch(() => {}),
    )
    .then((fn) => (unlisten = fn))
    .catch(() => {});
  return () => unlisten?.();
}

/**
 * 창이 닫히는 순간을 받는다 (`onCloseRequested` 그대로 — 실패하면 아무것도 하지 않는다).
 *
 * 처리기는 `Promise` 를 돌려줘도 된다 — Tauri 는 그것을 **기다린 뒤** `preventDefault()` 가 없었으면 창을
 * 부순다. 그래서 저장 안 한 문서의 확인 대화를 여기서 기다릴 수 있다(docs/log/2026-09-27-doc-edit.md "F2").
 * 처리기가 받는 `cancel` 을 부르면 닫기가 취소된다.
 */
export function onWindowClose(
  handler: (cancel: () => void) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested((ev) => handler(() => ev.preventDefault()));
}

/** 이 창을 닫는다 (분리 창이 비었을 때) */
export function closeThisWindow(): void {
  void appWindow.close();
}
