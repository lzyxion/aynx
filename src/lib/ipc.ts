// 프런트에서 Tauri core·event 를 부르는 길은 여기 하나다 — 다른 파일은 두 패키지를 직접 부르지 않는다(`ipc.test.ts` 가 지킨다).
// 원격 웹은 전송을 바꿔 끼우지 않는다 — 관문의 폴리필(`src-tauri/src/remote/polyfill.js`)이 `window.__TAURI_INTERNALS__` 를 ws 로 세운다.

export { invoke, Channel, convertFileSrc } from "@tauri-apps/api/core";
export { listen, emit, emitTo, type UnlistenFn } from "@tauri-apps/api/event";

/** 원격 웹 클라이언트로 도는가 — 관문의 폴리필이 세운 표식. 폴리필은 앱 모듈보다 먼저 돌아 모듈을 읽을 때 한 번 정해진다 */
export const isRemote: boolean =
  typeof window !== "undefined" && (window as unknown as { __AYNX_REMOTE__?: boolean }).__AYNX_REMOTE__ === true;

/** `src-tauri/src/remote/ws.rs` 의 `MAX_MESSAGE`(16MiB)와 짝 — 넘으면 관문이 연결을 끊는다. 1MiB 는 머리 몫이다 */
export const REMOTE_RAW_MAX_BYTES = 15 * 1024 * 1024;

export function rawBodyLimit(limit: number, remoteWindow: boolean = isRemote): number {
  return remoteWindow ? Math.min(limit, REMOTE_RAW_MAX_BYTES) : limit;
}

/**
 * 원격 창에서 마스터 암호를 다시 확인한다(메인 PC 창이면 `true`). 관문이 막는 명령은 폴리필이 알아서 묻는다 —
 * 이 함수는 명령 하나로 막을 수 없는 화면 토글(로컬 타일 "AI 읽기 허용" 켜기)이 부른다.
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

export function remoteDeviceName(): string {
  if (!isRemote) return "";
  const name = (window as unknown as { __AYNX_REMOTE_DEVICE__?: unknown }).__AYNX_REMOTE_DEVICE__;
  return typeof name === "string" ? name : "";
}

/** 비밀이 아니다(`remote_devices_list` 가 이미 내보내는 값) */
export function remoteDeviceId(): string {
  if (!isRemote) return "";
  const id = (window as unknown as { __AYNX_REMOTE_DEVICE_ID__?: unknown }).__AYNX_REMOTE_DEVICE_ID__;
  return typeof id === "string" ? id : "";
}
