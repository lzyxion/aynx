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
 * 이미 사람에게 띄운 알림만 적는다. 에이전트 · 사이드 채팅 알림은 적지 않는다 — 배너 저장소(`app/agent-banners.svelte.ts`)가 쥐고 알림 센터가 합쳐 그린다.
 * 디스크에 쓰지 않는다 — 줄에 명령줄이 그대로 들어 있다(비밀번호 인자 · 토큰이 박힌 URL). 세션 로깅이 옵트인인 것과 같은 이유(CLAUDE.md "보안 제약").
 */

let list = $state<readonly NotificationEntry[]>([]);

let seq = 0;

export function recordNotification(input: NotificationInput): void {
  list = addNotification(list, input, ++seq, Date.now());
}

export function recordPastNotification(input: NotificationInput, at: number): void {
  const [entry] = addNotification([], input, ++seq, at);
  list = [...list, { ...entry, read: true }].sort((a, b) => b.at - a.at).slice(0, MAX_NOTIFICATIONS);
}

export function notificationList(): readonly NotificationEntry[] {
  return list;
}

export function hasUnreadNotifications(): boolean {
  return hasUnread(list);
}

export function markNotificationsRead(): void {
  const next = markAllRead(list);
  if (next !== list) list = next;
}

export function dismissNotification(id: number): void {
  const next = removeNotification(list, id);
  if (next !== list) list = next;
}

export function clearNotificationHistory(): void {
  if (list.length > 0) list = clearNotifications();
}
