import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { APP_TITLE } from "$lib/app/instance";

/**
 * **OS 알림을 쏘는 자리 하나** — 권한 한 번 묻기 · 창이 앞에 있나 판정 · 실제 발사.
 *
 * 원래는 `app/finish-notify.ts` 안에만 있었다(docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 * 2026-09-22 에 **검토 요청 OS 알림**이 두 번째 손님이 되면서 밖으로 꺼냈다
 * (docs/log/2026-09-22-review-notify.md) — 베끼면 권한 캐시가 두 벌이 되어 권한 대화상자가
 * 두 번 뜨고, "창이 앞에 있나" 의 답이 두 자리에서 갈린다.
 *
 * 규칙(무엇을 언제 알릴 것인가)은 여기 없다 — 그쪽은 순수 모듈들이다
 * (`$lib/finish-notify` · `$lib/review-notify`). 여기 있는 것은 **바깥 사실과 부작용**뿐이다.
 */

/** 어느 창에서 보든 같은 제목 앞머리 — 알림 무리에서 이 앱의 것임을 알아보게(개발 인스턴스는 `aynx (dev)`) */
export const APP = APP_TITLE;

/**
 * OS 알림 권한 조회·요청을 **한 번만** 한다. 값은 `true`(허용) · `false`(거절·실패).
 *
 * 프로미스를 캐시하는 이유는 동시성이다 — 여러 타일에서 긴 명령이 한꺼번에 끝나면 권한
 * 대화상자가 여러 벌 뜬다. 거절도 캐시한다: 거절한 사람에게 명령이 끝날 때마다 다시 묻는
 * 것은 괴롭힘이다 (다시 묻고 싶으면 앱을 다시 켠다).
 *
 * **처음 쓸 때** 묻는다 — 부팅에서 미리 묻지 않는다: 알림을 한 번도 볼 일 없는 사용자
 * (임계를 껐거나 늘 창을 보고 있는)에게 권한 대화상자를 들이밀 이유가 없다.
 */
let permission: Promise<boolean> | null = null;

function allowed(): Promise<boolean> {
  permission ??= (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false; // 플러그인이 없다·권한 오류 — 부르는 쪽이 제 폴백으로 간다
    }
  })();
  return permission;
}

/**
 * 이 창이 지금 **사람 앞에 있는가**.
 *
 * `document.hasFocus()` 하나로는 최소화를 못 가른다(최소화된 창도 포커스를 쥔 것으로
 * 보고될 때가 있다). `document.hidden` 을 함께 보는 이유가 그것이다 — 둘 다 참일 때만
 * "보고 있다" 로 친다. 어느 쪽이든 못 읽으면 **안 보고 있다**로 떨어진다: 틀렸을 때의 대가가
 * 작은 쪽이다(OS 알림 한 줄 vs 아무도 못 본 토스트).
 */
export function windowFocused(): boolean {
  if (typeof document === "undefined") return false;
  return document.hasFocus() && !document.hidden;
}

/**
 * OS 알림 한 장을 띄운다 — **던지지 않는다**. `true` = 나갔다 · `false` = 못 나갔다
 * (권한 거절 · 플러그인 없음 · 발사 실패). 폴백을 무엇으로 할지는 부르는 쪽이 정한다.
 *
 * `sendNotification` 은 동기 함수라(프로미스가 아니다) 그 자리에서 던질 수 있다 — 그래서
 * `try` 로 감싼다. 감싸지 않으면 호출부의 `.catch` 가 잡을 수 없는 자리가 생긴다.
 */
export async function notifyOs(title: string, body: string): Promise<boolean> {
  if (!(await allowed())) return false;
  try {
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

/** 테스트·재시도용 — 권한 기억을 지운다 (다음 알림에서 다시 묻는다) */
export function resetNotifyPermission(): void {
  permission = null;
}
