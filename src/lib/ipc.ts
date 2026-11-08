// 프런트에서 Tauri core·event 를 부르는 길은 여기 하나 — 원격 웹(R1)이 전송을 바꿔 끼우는 자리.
//
// 지금(R0)은 `@tauri-apps/api/core` · `@tauri-apps/api/event` 를 그대로 다시 내보낼 뿐이다 — 이름·서명·동작이
// 바뀌지 않는다. `src/` 의 다른 파일은 저 두 패키지를 직접 부르지 않는다(시험 `ipc.test.ts` 가 소스를 훑어 지킨다).
// 시험의 `vi.mock("@tauri-apps/api/core" | "@tauri-apps/api/event")` 는 이 파일을 거쳐도 그대로 먹는다.
//
// 범위 밖(그대로 직접 부른다): `@tauri-apps/plugin-*` · `api/window` · `api/webview` · `api/path` · `api/app`.
// 잎 모듈이다 — 앱 모듈을 부르지 않는다.
//
// 원격 웹(R1a-3)은 전송을 **바꿔 끼우지 않는다** — 관문이 앱 셸의 첫 스크립트로 폴리필(`src-tauri/src/remote/polyfill.js`)을 끼워
// `window.__TAURI_INTERNALS__` 를 ws 로 세우므로 같은 번들이 그대로 돈다. 프런트가 아는 것은 표식 하나([`isRemote`])뿐이다.

export { invoke, Channel, convertFileSrc } from "@tauri-apps/api/core";
export { listen, emit, emitTo, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * **원격 웹 클라이언트로 도는가**(R1a-3) — 관문의 폴리필이 세운 표식. 원격 창은 브라우저 탭이라 창 조작·탐색기로 끌어내기·
 * 집 PC 전용 묶음(`isMainWindow`)이 없다. 모듈을 읽는 순간 한 번 정해진다(폴리필은 앱 모듈보다 먼저 돈다).
 */
export const isRemote: boolean =
  typeof window !== "undefined" && (window as unknown as { __AYNX_REMOTE__?: boolean }).__AYNX_REMOTE__ === true;

/**
 * **원격 창에서 마스터 암호를 다시 확인한다**(R1a-4 — 설계 3절 단계 3). 집 PC 창이면 묻지 않고 `true`. 원격이면 폴리필의 칸이
 * 뜨고(마스터가 없으면 칸 없이 통과) 통과하면 `true`, 취소·실패면 `false`. 관문이 막는 명령(승인 · 호스트·DB AI 권한 …)은
 * 폴리필이 알아서 묻는다 — 이 함수는 **명령 하나로 막을 수 없는 화면 토글**(로컬 타일 "AI 읽기 허용" 켜기)이 부른다.
 */
export async function confirmRemoteMaster(what: string): Promise<boolean> {
  if (!isRemote) return true;
  const ask = (window as unknown as { __AYNX_REMOTE_REAUTH__?: (what: string) => Promise<boolean> })
    .__AYNX_REMOTE_REAUTH__;
  if (typeof ask !== "function") return false;
  try {
    return (await ask(what)) === true;
  } catch {
    return false;
  }
}

/**
 * **이 원격 기기의 이름**(R1a-5) — 원격 창이면 관문이 부팅 표에 실은 이름(상태바 "원격 — <이름>"), 집 PC 창이면 빈 글자.
 * 이름을 바꾸면 다음 새로 고침부터 보인다.
 */
export function remoteDeviceName(): string {
  if (!isRemote) return "";
  const name = (window as unknown as { __AYNX_REMOTE_DEVICE__?: unknown }).__AYNX_REMOTE_DEVICE__;
  return typeof name === "string" ? name : "";
}

/**
 * 이 원격 기기의 id(10-20 — 폰 설정의 [이 기기 페어링 해제]가 원격 허용 명령 `remote_device_revoke` 에 넘긴다). 관문이 부팅 표에 싣는다 —
 * 비밀이 아니다(기기 목록 `remote_devices_list` 가 이미 내보내는 값). 집 PC 창 · 모르면 빈 글자.
 */
export function remoteDeviceId(): string {
  if (!isRemote) return "";
  const id = (window as unknown as { __AYNX_REMOTE_DEVICE_ID__?: unknown }).__AYNX_REMOTE_DEVICE_ID__;
  return typeof id === "string" ? id : "";
}
