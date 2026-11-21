/** 알림 센터의 지난 알림 목록 규칙 — 순수 모듈(문구는 `tr` 로 받는다 — 룬 모듈인 사전을 들여오면 테스트가 못 읽는다). */

import type { Tr } from "$lib/finish-notify";
import type { AlertGroup } from "$lib/dock-alert-groups";

/**
 * 기록하는 자리가 정해져 있어 종류도 그만큼이다. `operation-finish` 만 타일이 아니라 실행(`operationId`)을 가리킨다.
 * `side-chat` 은 이 목록에 적히지 않는다 — 독 알림 칸이 사이드 채팅 배너 줄의 그림을 고를 때만 쓰는 이름이다(`DockAlerts` 의 `kindOf`).
 */
export type NotificationKind =
  | "agent-stop"
  | "agent-permission"
  | "command-finish"
  | "transfer"
  | "program-notify"
  | "operation-finish"
  | "orchestration"
  | "side-chat";

/** 글자는 기록할 때 만들어 둔다 — 언어를 바꿔도 지난 줄은 그때 뜬 글자 그대로다(`text` 와 같은 규칙) */
export interface RunNotificationParts {
  headline: string;
  auto: boolean;
  result: string;
  tone: "good" | "bad" | "plain";
  /** 시간은 싣지 않는다 */
  details: string[];
}

/** 토스트의 `ToastKind` 와 같은 세 값 */
export type NotificationLevel = "info" | "success" | "error";

export interface NotificationEntry {
  /** 창 안에서만 유일하다 */
  id: number;
  kind: NotificationKind;
  text: string;
  /** 탭은 누를 때 다시 찾는다 */
  paneId?: string;
  operationId?: string;
  run?: RunNotificationParts;
  at: number;
  read: boolean;
  level?: NotificationLevel;
  /** 기록하는 순간 정한다(`$lib/dock-alert-groups`) */
  group?: AlertGroup;
  short?: string;
}

/** 번호 · 시각 · 읽음은 저장하는 쪽이 붙인다 */
export interface NotificationInput {
  kind: NotificationKind;
  text: string;
  paneId?: string;
  operationId?: string;
  run?: RunNotificationParts;
  level?: NotificationLevel;
  group?: AlertGroup;
  short?: string;
}

/** 메모리에만 사는 목록이라 상한이 없으면 며칠 켜 둔 앱에서 그대로 샌다 */
export const MAX_NOTIFICATIONS = 100;

/** 새것이 앞이다(목록이 그리는 순서) */
export function addNotification(
  list: readonly NotificationEntry[],
  input: NotificationInput,
  id: number,
  at: number,
): NotificationEntry[] {
  const entry: NotificationEntry = { id, kind: input.kind, text: input.text, at, read: false };
  if (input.paneId !== undefined) entry.paneId = input.paneId;
  if (input.level !== undefined) entry.level = input.level;
  if (input.operationId !== undefined) entry.operationId = input.operationId;
  if (input.run !== undefined) entry.run = input.run;
  if (input.group !== undefined) entry.group = input.group;
  if (input.short !== undefined) entry.short = input.short;
  return [entry, ...list].slice(0, MAX_NOTIFICATIONS);
}

/** 이미 다 읽었으면 같은 배열 — 상자가 열린 동안 효과가 이 함수를 되부르므로 `$state` 에 다시 넣어도 반응이 일지 않게 */
export function markAllRead(list: readonly NotificationEntry[]): readonly NotificationEntry[] {
  if (list.every((e) => e.read)) return list;
  return list.map((e) => (e.read ? e : { ...e, read: true }));
}

export function removeNotification(
  list: readonly NotificationEntry[],
  id: number,
): readonly NotificationEntry[] {
  const at = list.findIndex((e) => e.id === id);
  if (at < 0) return list;
  return [...list.slice(0, at), ...list.slice(at + 1)];
}

export function clearNotifications(): NotificationEntry[] {
  return [];
}

export function unreadCount(list: readonly NotificationEntry[]): number {
  let n = 0;
  for (const e of list) if (!e.read) n++;
  return n;
}

/** 상태바 종의 점 — 수는 세지 않는다(숫자 배지는 승인 대기 + 해결되지 않은 에이전트 알림만 센다) */
export function hasUnread(list: readonly NotificationEntry[]): boolean {
  return list.some((e) => !e.read);
}

export function notifyBadgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** 시계가 뒤로 가 음수가 나오면 "방금" 으로 접는다(`tmux.ts` 의 `relativeCreated` 와 같은 규칙) */
export function relativeTime(at: number, now: number, tr: Tr): string {
  const sec = Math.floor((now - at) / 1000);
  if (!Number.isFinite(sec)) return "";
  if (sec < 60) return tr("app.notify.ago.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("app.notify.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return tr("app.notify.ago.hours", { n: hour });
  const day = Math.floor(hour / 24);
  if (day < 7) return tr("app.notify.ago.days", { n: day });
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 상자의 자리 ──

export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const PANEL_MARGIN = 8;
export const PANEL_GAP = 4;

/**
 * 상태바는 네 가장자리 어디에도 서므로 상자는 띠의 안쪽으로 펼친다. 창보다 크면 왼쪽 · 위 끝이 보이는 쪽을 고른다(제목과 첫 줄).
 * `align: "start"` 는 띠의 머리에 서는 칸(상태바 `>_` 의 셸 메뉴)의 몫이다.
 */
export function placeNotifyPanel(
  anchor: AnchorRect,
  size: { width: number; height: number },
  win: { width: number; height: number },
  position: "top" | "bottom" | "left" | "right",
  align: "start" | "end" = "end",
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (position === "bottom" || position === "top") {
    left = align === "start" ? anchor.left : anchor.right - size.width;
    top = position === "bottom" ? anchor.top - PANEL_GAP - size.height : anchor.bottom + PANEL_GAP;
  } else {
    left = position === "left" ? anchor.right + PANEL_GAP : anchor.left - PANEL_GAP - size.width;
    top = align === "start" ? anchor.top : anchor.bottom - size.height;
  }
  const clamp = (v: number, span: number, room: number) =>
    Math.max(PANEL_MARGIN, Math.min(v, room - PANEL_MARGIN - span));
  return {
    left: Math.round(clamp(left, size.width, win.width)),
    top: Math.round(clamp(top, size.height, win.height)),
  };
}
