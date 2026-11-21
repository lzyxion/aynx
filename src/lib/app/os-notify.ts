import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { APP_TITLE } from "$lib/app/instance";

/** OS 알림은 여기 한 자리로만 — 베끼면 권한 캐시가 두 벌이 되어 권한 대화상자가 두 번 뜬다 */

export const APP = APP_TITLE;

/** 프로미스를 캐시한다(동시에 끝난 명령마다 대화상자가 뜨지 않게) · 거절도 캐시한다 · 부팅에서 미리 묻지 않는다 */
let permission: Promise<boolean> | null = null;

function allowed(): Promise<boolean> {
  permission ??= (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  return permission;
}

/** `hasFocus()` 만으로는 최소화를 못 가른다(최소화된 창도 포커스를 쥔 것으로 보고될 때가 있다) */
export function windowFocused(): boolean {
  if (typeof document === "undefined") return false;
  return document.hasFocus() && !document.hidden;
}

/** `sendNotification` 은 동기라 그 자리에서 던질 수 있다 — `try` 를 걷으면 호출부의 `.catch` 가 못 잡는다 */
export async function notifyOs(title: string, body: string): Promise<boolean> {
  if (!(await allowed())) return false;
  try {
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

export function resetNotifyPermission(): void {
  permission = null;
}
