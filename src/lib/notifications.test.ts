import { describe, expect, it } from "vitest";
import {
  MAX_NOTIFICATIONS,
  PANEL_GAP,
  PANEL_MARGIN,
  addNotification,
  clearNotifications,
  hasUnread,
  markAllRead,
  notifyBadgeText,
  placeNotifyPanel,
  relativeTime,
  removeNotification,
  unreadCount,
  type NotificationEntry,
} from "$lib/notifications";
import type { Tr } from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";

/**
 * 알림 센터의 규칙 (docs/log/2026-09-25-notification-center.md).
 * 순수 모듈이라 그대로 돈다 — 목록을 받아 새 목록을 주는 함수들과 상자의 자리 셈뿐이다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

/** `n` 줄을 차례로 더한다 (id = 1..n, 시각 = id) */
function filled(n: number): NotificationEntry[] {
  let list: NotificationEntry[] = [];
  for (let i = 1; i <= n; i++) list = addNotification(list, { kind: "transfer", text: `t${i}` }, i, i);
  return list;
}

describe("addNotification — 새것이 앞, 넘치면 가장 오래된 것부터", () => {
  it("새 줄은 읽지 않은 채 맨 앞에 선다", () => {
    const list = addNotification(
      filled(2),
      { kind: "agent-stop", text: "done", paneId: "p1", level: "info" },
      3,
      300,
    );
    expect(list[0]).toEqual({ id: 3, kind: "agent-stop", text: "done", paneId: "p1", at: 300, read: false, level: "info" });
    expect(list.map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it("주지 않은 곁 필드는 아예 없다 (undefined 칸이 생기지 않는다)", () => {
    const [e] = addNotification([], { kind: "command-finish", text: "x" }, 1, 1);
    expect("paneId" in e).toBe(false);
    expect("level" in e).toBe(false);
    expect("operationId" in e).toBe(false);
    expect("run" in e).toBe(false);
  });

  it("작업안 실행 줄은 타일이 아니라 실행(`operationId`)과 토막을 싣는다", () => {
    const run = { headline: "로그 정리", auto: true, result: "성공 5/5", tone: "good" as const, details: [] };
    const [e] = addNotification(
      [],
      { kind: "operation-finish", text: "로그 정리 — 성공 5/5", operationId: "op-9", run, level: "success" },
      1,
      1,
    );
    expect(e.operationId).toBe("op-9");
    expect(e.run).toEqual(run);
    expect("paneId" in e).toBe(false);
  });

  it(`${MAX_NOTIFICATIONS}줄을 넘으면 가장 오래된 줄이 빠진다`, () => {
    const list = filled(MAX_NOTIFICATIONS + 5);
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list[0].id).toBe(MAX_NOTIFICATIONS + 5);
    expect(list.at(-1)?.id).toBe(6); // 1..5 가 빠졌다
  });
});

describe("읽음 · 지우기 · 비우기", () => {
  it("unreadCount 는 읽지 않은 줄만 센다", () => {
    expect(unreadCount(filled(3))).toBe(3);
    expect(unreadCount(markAllRead(filled(3)))).toBe(0);
    expect(unreadCount([])).toBe(0);
  });

  it("hasUnread 는 읽지 않은 줄이 하나라도 있을 때만 참이다", () => {
    expect(hasUnread([])).toBe(false);
    expect(hasUnread(filled(2))).toBe(true);
    expect(hasUnread(markAllRead(filled(2)))).toBe(false);
    const mixed = addNotification(markAllRead(filled(2)), { kind: "transfer", text: "new" }, 3, 3);
    expect(hasUnread(mixed)).toBe(true);
  });

  it("notifyBadgeText 는 100 이상을 99+ 로 접는다", () => {
    expect(notifyBadgeText(1)).toBe("1");
    expect(notifyBadgeText(99)).toBe("99");
    expect(notifyBadgeText(100)).toBe("99+");
    expect(notifyBadgeText(1234)).toBe("99+");
  });

  it("markAllRead — 다 읽었으면 같은 배열을 돌려준다(효과가 되돌지 않게)", () => {
    const read = markAllRead(filled(2));
    expect(read.every((e) => e.read)).toBe(true);
    expect(markAllRead(read)).toBe(read);
  });

  it("markAllRead 는 원본을 건드리지 않는다", () => {
    const list = filled(2);
    markAllRead(list);
    expect(list.every((e) => !e.read)).toBe(true);
  });

  it("removeNotification — 그 줄만, 없는 번호면 같은 배열", () => {
    const list = filled(3);
    expect(removeNotification(list, 2).map((e) => e.id)).toEqual([3, 1]);
    expect(removeNotification(list, 99)).toBe(list);
  });

  it("clearNotifications — 빈 목록", () => {
    expect(clearNotifications()).toEqual([]);
  });
});

describe("relativeTime — 사람이 읽는 '언제'", () => {
  const now = Date.UTC(2026, 8, 25, 12, 0, 0);
  it("단계별로 접는다 (한국어)", () => {
    expect(relativeTime(now - 5_000, now, ko)).toBe("방금");
    expect(relativeTime(now + 5_000, now, ko)).toBe("방금"); // 미래는 방금으로
    expect(relativeTime(now - 5 * 60_000, now, ko)).toBe("5분 전");
    expect(relativeTime(now - 3 * 3_600_000, now, ko)).toBe("3시간 전");
    expect(relativeTime(now - 2 * 86_400_000, now, ko)).toBe("2일 전");
  });

  it("일주일 너머는 날짜", () => {
    expect(relativeTime(now - 10 * 86_400_000, now, ko)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("영어도 사전을 지난다", () => {
    expect(relativeTime(now - 5 * 60_000, now, en)).toBe("5m ago");
    expect(relativeTime(now, now, en)).toBe("just now");
  });
});

describe("placeNotifyPanel — 띠의 안쪽으로, 창 안에", () => {
  const win = { width: 1000, height: 800 };
  const size = { width: 300, height: 200 };

  it("아래 띠 — 종 위로, 오른쪽 끝을 맞춘다", () => {
    const bell = { left: 970, right: 992, top: 778, bottom: 798 };
    expect(placeNotifyPanel(bell, size, win, "bottom")).toEqual({
      left: 692,
      top: 778 - PANEL_GAP - 200,
    });
  });

  it("위 띠 — 종 아래로", () => {
    const bell = { left: 970, right: 992, top: 40, bottom: 60 };
    expect(placeNotifyPanel(bell, size, win, "top")).toEqual({ left: 692, top: 60 + PANEL_GAP });
  });

  it("왼쪽 기둥 — 종 오른쪽으로, 아래 끝을 맞춘다", () => {
    const bell = { left: 4, right: 26, top: 770, bottom: 790 };
    expect(placeNotifyPanel(bell, size, win, "left")).toEqual({ left: 26 + PANEL_GAP, top: 590 });
  });

  it("오른쪽 기둥 — 종 왼쪽으로", () => {
    const bell = { left: 974, right: 996, top: 770, bottom: 790 };
    expect(placeNotifyPanel(bell, size, win, "right")).toEqual({
      left: 974 - PANEL_GAP - 300,
      top: 590,
    });
  });

  it("넘치면 여백 안으로 끌어들이고, 창보다 크면 왼쪽·위 끝을 지킨다", () => {
    const bell = { left: 0, right: 20, top: 10, bottom: 30 };
    expect(placeNotifyPanel(bell, size, win, "bottom")).toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
    const huge = { width: 2000, height: 2000 };
    expect(placeNotifyPanel(bell, huge, win, "top")).toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
  });

  // 띠의 **머리**에 서는 칸(`>_` 셸 메뉴 — docs/log/2026-09-25-plus-vs-shell-menu.md)
  it("align start · 아래 띠 — 칸 위로, 왼쪽 끝을 칸의 왼쪽에", () => {
    const cell = { left: 20, right: 48, top: 778, bottom: 798 };
    expect(placeNotifyPanel(cell, size, win, "bottom", "start")).toEqual({
      left: 20,
      top: 778 - PANEL_GAP - 200,
    });
  });

  it("align start · 위 띠 — 칸 아래로", () => {
    const cell = { left: 20, right: 48, top: 40, bottom: 60 };
    expect(placeNotifyPanel(cell, size, win, "top", "start")).toEqual({ left: 20, top: 60 + PANEL_GAP });
  });

  it("align start · 왼쪽 기둥 — 칸 오른쪽으로, 위 끝을 칸의 위에", () => {
    const cell = { left: 4, right: 26, top: 44, bottom: 70 };
    expect(placeNotifyPanel(cell, size, win, "left", "start")).toEqual({ left: 26 + PANEL_GAP, top: 44 });
  });

  it("align start · 오른쪽 기둥 — 칸 왼쪽으로", () => {
    const cell = { left: 974, right: 996, top: 44, bottom: 70 };
    expect(placeNotifyPanel(cell, size, win, "right", "start")).toEqual({
      left: 974 - PANEL_GAP - 300,
      top: 44,
    });
  });

  it("align start · 기둥 아래로 넘치면 창 안으로 끌어올린다", () => {
    const cell = { left: 4, right: 26, top: 700, bottom: 726 };
    expect(placeNotifyPanel(cell, size, win, "left", "start")).toEqual({
      left: 26 + PANEL_GAP,
      top: 800 - PANEL_MARGIN - 200,
    });
  });
});
