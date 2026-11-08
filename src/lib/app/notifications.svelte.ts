import {
  MAX_NOTIFICATIONS,
  addNotification,
  clearNotifications,
  hasUnread,
  markAllRead,
  removeNotification,
  type NotificationEntry,
  type NotificationInput,
} from "$lib/notifications";

/**
 * **지난 알림 목록** — 알림 센터(상태바 맨 끝의 종)가 읽는 창 하나의 기록
 * (docs/log/2026-09-25-notification-center.md). 규칙(자르기·읽음·지우기)은 순수 모듈
 * `$lib/notifications` 에 있고, 여기 있는 것은 `$state` 한 칸과 그것을 바꾸는 손잡이들뿐이다.
 *
 * ## 무엇이 여기 적히나
 *
 * **이미 사람에게 띄운 알림만** — 토스트든 OS 알림이든 실제로 나간 것:
 * `app/finish-notify.ts`(긴 명령 끝남) · 전송
 * 완료/실패 토스트(`app/boot` 의 편집 왕복 업로드 · `app/transfer` 의 올리기 · 파일 타일의
 * 복사·이동). 판정이 "알리지 않는다" 였던 것은 적지 않는다 — 알림 센터는 "아까 뜬 것" 을
 * 되짚는 자리이지 모든 사건의 로그가 아니다. **아무 토스트나 담지 않는다**(복사 완료·오류 안내
 * 같은 즉답은 그 자리에서 끝난 말이다).
 *
 * 에이전트 알림(턴 끝 · 권한 물음)은 **여기 적지 않는다** — 2026-09-27 부터 배너 저장소
 * (`app/agent-banners.svelte.ts`)가 해결 전후를 함께 쥐고, 알림 센터가 두 기록을 합쳐 그린다. 종의 **숫자 배지**는
 * 이 목록의 "읽지 않음" 을 세지 않는다(승인 대기 + 해결되지 않은 에이전트 알림만 — docs/log/2026-09-27-agent-banners.md).
 * "읽음" 은 두 자리에만 쓰인다: 센터를 열 때의 "새로 온 줄" 점, 그리고 2026-10-24 부터 **종 모서리의 점**(숫자가 0 이고
 * 읽지 않은 줄이 있을 때 — `hasUnreadNotifications`). 점은 수를 말하지 않는다 — 알림 칸을 열면 읽음이 되어 사라진다.
 *
 * ## 창마다 따로 · 메모리에만 — **일부러 저장하지 않는다**
 *
 * 줄이 가리키는 타일은 이 창에 산다(분리 창의 타일은 그 창의 것이다). 그래서 목록도 창마다
 * 하나다 — 이벤트를 방송해 모으지 않는다.
 *
 * 그리고 **디스크에 쓰지 않는다.** 이 줄들에는 명령줄이 그대로 들어 있다(`finishMessage` 가
 * 명령 머리를 적는다) — 비밀번호를 인자로 넘긴 명령이나 토큰이 박힌 URL 도 예외가 아니다.
 * 세션 로깅이 세션별 옵트인인 것과 같은 이유로, 사용자가 켜지 않은 기록을 파일로 남기지
 * 않는다(CLAUDE.md "보안 제약"). 앱을 끄면 사라지는 것이 의도다.
 */

let list = $state<readonly NotificationEntry[]>([]);

/** 창 안에서만 유일한 번호 — 지우기(×)의 손잡이 */
let seq = 0;

/**
 * 알림 한 줄을 적는다 — 알림을 **실제로 띄운 자리**가 부르는 유일한 쓰기.
 * 부르는 쪽은 토스트/OS 알림을 띄운 바로 그 줄에서 같은 문구로 한 번 부르면 된다.
 */
export function recordNotification(input: NotificationInput): void {
  list = addNotification(list, input, ++seq, Date.now());
}

/**
 * **이미 띄운 적 있는** 알림 한 줄을 그때 시각으로 다시 적는다 — 읽음으로(점을 세우지 않는다) · 시각 순 자리에. 지금은 하나뿐: 오케스트레이션
 * 감독 사건(서버가 확인된 최근 사건을 메모리에 쥔다 — F5 · 웹뷰 재부착으로 다시 뜬 주 창이 이 목록을 잃지 않게, 실기 b 고침 A). 디스크에는 여전히
 * 쓰지 않는다.
 */
export function recordPastNotification(input: NotificationInput, at: number): void {
  const [entry] = addNotification([], input, ++seq, at);
  list = [...list, { ...entry, read: true }].sort((a, b) => b.at - a.at).slice(0, MAX_NOTIFICATIONS);
}

/** 지난 알림 — 새것이 앞 */
export function notificationList(): readonly NotificationEntry[] {
  return list;
}

/** 읽지 않은 줄이 있나 — 상태바 종의 점(2026-10-24)이 읽는다. 수는 세지 않는다 */
export function hasUnreadNotifications(): boolean {
  return hasUnread(list);
}

/** 전부 읽음으로 — 알림 센터가 열려 있는 동안 부른다(다 읽었으면 아무것도 바뀌지 않는다) */
export function markNotificationsRead(): void {
  const next = markAllRead(list);
  if (next !== list) list = next;
}

/** 한 줄 지우기 (×) */
export function dismissNotification(id: number): void {
  const next = removeNotification(list, id);
  if (next !== list) list = next;
}

/** 모두 지우기 */
export function clearNotificationHistory(): void {
  if (list.length > 0) list = clearNotifications();
}
