/**
 * **알림 센터의 규칙** — 순수 모듈 (docs/log/2026-09-25-notification-center.md).
 *
 * 상태바 맨 끝의 종(🔔)이 여는 상자는 두 가지를 한곳에 모은다: **승인 대기**(메인 창에서만 ·
 * 출처는 `app/pending-plans`)와 **지난 알림**(이 파일이 다루는 목록). 지난 알림은 이미 한 번
 * 떴던 것들 — 긴 명령이 끝났다 · Claude Code 턴이 끝났다 · 전송이 끝났다/실패했다 — 이고,
 * 토스트는 8초 뒤 사라지고 OS 알림은 알림 센터 너머로 흘러가 버리므로 "아까 뭐가 떴더라" 를
 * 되짚을 자리가 없었다.
 *
 * 룬도 DOM 도 Tauri 도 없다 — 목록을 받아 **새 목록**을 준다. 상태(`$state`)를 쥐는 쪽은
 * `app/notifications.svelte.ts` 이고, 이 파일은 vitest 로 그대로 돈다(`notifications.test.ts`).
 * 문구는 `tr` 로 들어온다 — `finish-notify.ts` 머리말과 같은 이유(룬 모듈인 사전을 들여오면
 * 이 파일을 테스트가 못 읽는다).
 */

import type { Tr } from "$lib/finish-notify";
import type { AlertGroup } from "$lib/dock-alert-groups";

/**
 * 무엇이 알렸나 — 기록하는 자리가 정해져 있어 종류도 그만큼이다(아무 토스트나 담지 않는다).
 * `agent-permission` 은 Claude Code 권한 물음(docs/log/2026-09-25-shell-claude-signals.md).
 * `program-notify` 는 타일 안 프로그램이 보낸 OSC 9 · OSC 777 알림
 * (docs/log/2026-09-26-osc-notify-inline-images.md).
 * `operation-finish` 는 작업안 실행이 끝났다(성공까지 전부 — 자리를 비운 사이 무엇이 돌았나를
 * 되짚는 자리다 · docs/log/2026-09-28-run-result-notify.md). 이 줄만 타일이 아니라 **실행**
 * (`operationId`)을 가리킨다.
 * `orchestration` 은 오케스트레이션 감독 사건(서버가 사건 id 와 함께 만든 것 — 권한 대기 · 복구 필요 … 리뷰 F11).
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

/**
 * 작업안 실행 줄의 **토막들** — 알림 센터가 목업대로 두 줄로 그린다(머리 `—` 색 입은 결과 /
 * `작업안 실행 · 곁 토막`). 글자는 기록할 때 이미 만들어 둔다(토스트와 같은 글자 — 언어를 바꿔도
 * 지난 줄은 그때 뜬 글자 그대로다, 다른 줄들의 `text` 와 같은 규칙).
 */
export interface RunNotificationParts {
  headline: string;
  /** 자동 승인으로 돈 실행인가 (`자동` 칩) */
  auto: boolean;
  /** 색을 입는 결과 토막 (`일부 실패 2/3`) */
  result: string;
  tone: "good" | "bad" | "plain";
  /** 결과 뒤 곁 토막들 (`실패: web-02` …) — 시간은 싣지 않는다(목업의 센터 줄) */
  details: string[];
}

/** 결 — 토스트의 `ToastKind` 와 같은 세 값(목록에서 실패만 오류색으로 칠한다) */
export type NotificationLevel = "info" | "success" | "error";

/** 지난 알림 한 줄 */
export interface NotificationEntry {
  /** 창 안에서만 유일한 번호 — 지우기(×)가 가리키는 손잡이 */
  id: number;
  kind: NotificationKind;
  /** 그때 띄운 문구 그대로 (토스트·OS 알림 본문) */
  text: string;
  /** 그 알림이 가리킨 타일 — 있으면 줄을 눌러 그 타일로 간다(탭은 **누를 때** 다시 찾는다) */
  paneId?: string;
  /** 그 알림이 가리킨 작업안 실행 — 있으면 줄을 눌러 대시보드 작업안 칸의 그 실행으로 간다 */
  operationId?: string;
  /** 작업안 실행 줄의 토막들 — 있으면 `text` 대신 이 모양으로 그린다 */
  run?: RunNotificationParts;
  /** 기록한 시각 (epoch ms) */
  at: number;
  /** 알림 센터를 열어 본 뒤인가 — `false` 인 줄이 있으면 종에 점이 선다(수는 세지 않는다 — `hasUnread`) */
  read: boolean;
  level?: NotificationLevel;
  /** 지난 알림 묶음의 열쇠 — 기록하는 순간 정한다(`$lib/dock-alert-groups`). 없으면 낱줄 */
  group?: AlertGroup;
  /** 묶음을 펼친 자식 줄의 짧은 글 — 출처 머리를 뗀 것(카드에 출처가 이미 있다). 없으면 `text` */
  short?: string;
}

/** 기록할 때 부르는 쪽이 주는 것 — 번호·시각·읽음은 저장하는 쪽이 붙인다 */
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

/**
 * 지난 알림을 몇 줄까지 남기나. 넘치면 **가장 오래된 것부터** 버린다 — 메모리에만 사는
 * 목록이라 끝없이 자라면 며칠 켜 둔 앱에서 그대로 새는 셈이고, 100줄 너머를 되짚는 사람은 없다.
 */
export const MAX_NOTIFICATIONS = 100;

/**
 * 한 줄을 더한다 — **새것이 앞**(목록이 그리는 순서 그대로)이고, 넘치면 꼬리(가장 오래된 것)를
 * 자른다.
 */
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

/**
 * 전부 읽음으로 — 이미 다 읽었으면 **같은 배열을 그대로** 돌려준다. 부르는 쪽이 `$state` 에
 * 다시 넣어도 반응이 일지 않게 하려는 것이다(상자가 열려 있는 동안 효과가 이 함수를 되부른다).
 */
export function markAllRead(list: readonly NotificationEntry[]): readonly NotificationEntry[] {
  if (list.every((e) => e.read)) return list;
  return list.map((e) => (e.read ? e : { ...e, read: true }));
}

/** 한 줄을 지운다 (없는 번호면 같은 배열) */
export function removeNotification(
  list: readonly NotificationEntry[],
  id: number,
): readonly NotificationEntry[] {
  const at = list.findIndex((e) => e.id === id);
  if (at < 0) return list;
  return [...list.slice(0, at), ...list.slice(at + 1)];
}

/** 전부 지운다 — 함수로 두는 것은 "비우기" 의 뜻을 한 자리에 적어 두려는 것뿐이다 */
export function clearNotifications(): NotificationEntry[] {
  return [];
}

/** 읽지 않은 줄 수 — 2026-09-25 에는 종의 배지가 더했다. 2026-09-27 부터 배지는 해결되지 않은 에이전트 알림만 센다(docs/log/2026-09-27-agent-banners.md) */
export function unreadCount(list: readonly NotificationEntry[]): number {
  let n = 0;
  for (const e of list) if (!e.read) n++;
  return n;
}

/**
 * 읽지 않은 줄이 하나라도 있나 — 상태바 종의 **점**(2026-10-24 A안)이 묻는다. 수를 세지 않는다: 점은 "새 것이 있다" 만
 * 말하고, 숫자 배지는 여전히 승인 대기 + 해결되지 않은 에이전트 알림만 센다(2026-09-27 결정).
 */
export function hasUnread(list: readonly NotificationEntry[]): boolean {
  return list.some((e) => !e.read);
}

/** 종의 숫자 배지 글자 — 100 이상은 `99+` 로 접는다(정확한 수는 툴팁이 말한다 · 2026-10-24) */
export function notifyBadgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * 목록 한 줄의 "언제" — `방금` · `5분 전` · `3시간 전` · `2일 전`. 앱이 켜져 있는 동안만 사는
 * 목록이라 일주일 너머는 드물지만, 그래도 날짜로 접는다(`2026-09-25`).
 *
 * 시계가 뒤로 가 음수가 나오면 "방금" 으로 접는다 — 틀린 미래를 말하지 않는다
 * (`tmux.ts` 의 `relativeCreated` 와 같은 규칙).
 */
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

// ---------------------------------------------------------------------------
// 상자의 자리 — 상태바가 어느 가장자리에 서든 종 옆에 붙는다
// ---------------------------------------------------------------------------

/** 자리를 잴 때 쓰는 사각형 (`DOMRect` 를 그대로 넘겨도 된다) */
export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 화면 가장자리·종과 띄워 둘 틈 */
export const PANEL_MARGIN = 8;
export const PANEL_GAP = 4;

/**
 * **알림 상자의 화면 좌표** (`position: fixed` 의 `left`·`top`).
 *
 * 상태바는 네 가장자리 어디에도 서므로 상자는 **띠의 안쪽**으로 펼친다:
 *
 * | 띠 | 상자 | 맞추는 모서리 |
 * | --- | --- | --- |
 * | 아래 | 종 **위** | 오른쪽 끝을 종의 오른쪽에 (종은 띠 오른쪽 끝에 선다) |
 * | 위 | 종 **아래** | 같다 |
 * | 왼쪽 | 종 **오른쪽** | 아래 끝을 종의 아래에 (종은 기둥 바닥에 선다) |
 * | 오른쪽 | 종 **왼쪽** | 같다 |
 *
 * 어느 쪽이든 창 밖으로 넘치면 여백 안으로 끌어들인다 — 상자가 창보다 크면 왼쪽·위 끝이
 * 보이는 쪽을 고른다(제목과 첫 줄을 읽어야 한다; 넘치는 부분은 상자 자신의 스크롤이 맡는다).
 *
 * **`align`** — 띠를 따라 어느 모서리를 맞추나. 기본 `"end"` 는 위 표 그대로(띠의 **끝**에 서는
 * 종·설정). `"start"` 는 띠의 **머리**에 서는 칸(선두단 — 상태바 `>_` 의 셸 메뉴,
 * docs/log/2026-09-25-plus-vs-shell-menu.md)의 몫이다: 가로 띠에서는 **왼쪽 끝**을 칸의 왼쪽에,
 * 세로 기둥에서는 **위 끝**을 칸의 위에 맞춘다. 띠의 안쪽으로 펼친다는 규칙은 같다.
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
