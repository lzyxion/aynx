import { getCurrentWindow } from "@tauri-apps/api/window";
import { takeTearToken } from "$lib/tear";
import { invoke, isRemote } from "$lib/ipc";

export { isRemote };

/** 이 창이 어떻게 태어났는가 · 창 자신에 대한 조작. 창 제어는 전부 오류를 삼킨다 — 닫히는 중인 창에서도 UI 가 멈추지 않게. */

/**
 * 분리로 태어난 창이면 이관 번호 — 그 창은 시작 탭을 만들면 안 된다. `takeTearToken` 은 1회용이고 동기여야 해서 모듈 로드 때 붙잡는다.
 */
export const tearToken = takeTearToken();

const appWindow = getCurrentWindow();

/** 메인 창은 마지막 탭을 닫아도 남는다. 원격 창은 주 창이 아니다 — 메인 PC 주 창 묶음(자동 승인 · 대기 카드 · 페어링 확인 등)이 원격에서 돌지 않는다. */
export const isMainWindow = !isRemote && appWindow.label === "main";

// ── 커스텀 타이틀바 창 제어 ──

let maximized = $state(false);

export function winMaximized(): boolean {
  return maximized;
}

/** 메인 창은 `visible:false` 로 태어나 스플래시가 칠해진 뒤 이것으로 뜬다. 이미 보이는 창에 불러도 무해하다(F5 가 이 길을 다시 탄다). */
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

/** Tauri 는 처리기의 `Promise` 를 기다린 뒤 `preventDefault()` 가 없었으면 창을 부순다 — 그래서 저장 확인을 여기서 기다릴 수 있다. */
export function onWindowClose(
  handler: (cancel: () => void) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested((ev) => handler(() => ev.preventDefault()));
}

export function closeThisWindow(): void {
  void appWindow.close();
}
