/**
 * **사이드 채팅이 끝났다 · 권한을 묻는다고 말하는 규칙** — 순수 모듈(`[ai] notify_side_chat`). 띄우는 쪽은 `app/side-chat-notify.ts`.
 *
 * AI 타일 알림(`$lib/agent-notify`)과 스위치도 표도 따로다 — 채팅에는 타일이 없고, 짧은 질문이 잦아 타일 알림만 원하는 사람에게 함께 울리면 안 된다.
 * 사람이 끊은 턴은 알리지 않는다. 알림 글에는 채팅 제목과 고정 문구만 싣는다(대화 본문 없음 · 메신저로 보내지 않는다).
 */

import type { BannerKind } from "$lib/agent-banners";
import type { Key } from "$lib/i18n/keys";
import type { Outcome } from "$lib/side-chat-api";

export type SideChatNotifyKind = "finished" | "failed" | "permission";

/** `"none"` = 알리지 않음 · `"banner"` = 창 안(AI 타일과 같은 배너 — 2026-11-13) · `"os"` = OS 알림 + 배너 */
export type SideChatNotify = "none" | "banner" | "os";

/** 알림 종류 → 배너 갈래(`$lib/agent-banners`) — 끝남은 타일의 턴 끝(`stop`)과 같은 모양이다 */
export function bannerKindOfSideChat(kind: SideChatNotifyKind): BannerKind {
  return kind === "finished" ? "stop" : kind;
}

/**
 * 채팅의 사건 하나가 **저절로 풀어 주는** 배너 갈래 — 타일의 훅 신호표(`$lib/agent-banners` 의 `resolvedBy`)와 같은 결이다.
 * 사람이 다른 창(원격 웹 · 폰)에서 그 채팅에 답했을 때 이 창의 배너가 남지 않게.
 *
 * | 사건 | 풀리는 것 | 왜 |
 * | --- | --- | --- |
 * | 새 턴(`turnStarted`) | 끝남 · 실패 · 권한 | 사람이 이미 그 채팅에서 다음 말을 걸었다 |
 * | 기다리는 권한이 0 이 됨 | 권한 | 사람이 답했다(또는 턴이 끝나 물음이 사라졌다) |
 */
export function sideChatResolvedBy(ev: { turnStarted: boolean; permissionsCleared: boolean }): readonly BannerKind[] {
  if (ev.turnStarted) return ["stop", "failed", "permission"];
  return ev.permissionsCleared ? ["permission"] : [];
}

/** 끝난 턴 → 알림 종류. 끊은 턴(`interrupted`)은 사람이 한 일이라 없다 */
export function sideChatTurnNotifyKind(outcome: Outcome): SideChatNotifyKind | null {
  if (outcome === "ok") return "finished";
  return outcome === "error" ? "failed" : null;
}

/**
 * | 스위치 | 창이 앞 | 그 채팅을 보는 중 | 결과 |
 * | --- | --- | --- | --- |
 * | 끔 | — | — | `none` |
 * | 켬 | 아니오 | — | `os` |
 * | 켬 | 예 | 예 | `none` — 화면이 이미 말했다 |
 * | 켬 | 예 | 아니오(독 닫힘 · 다른 채팅 · 작업안 갈래) | `banner` |
 */
export function shouldNotifySideChat(input: { enabled: boolean; windowFocused: boolean; chatShown: boolean }): SideChatNotify {
  if (!input.enabled) return "none";
  if (!input.windowFocused) return "os";
  return input.chatShown ? "none" : "banner";
}

const TEXT = {
  finished: "app.chatDock.notify.finished",
  failed: "app.chatDock.notify.failed",
  permission: "app.chatDock.notify.permission",
} as const satisfies Record<SideChatNotifyKind, Key>;

/** 알림 한 줄 — 배너의 "확인할 것" 줄 · OS 알림 · 지난 알림이 같은 글을 쓴다 */
export function sideChatNotifyText(
  kind: SideChatNotifyKind,
  title: string,
  tr: (key: Key, params?: Record<string, string | number>) => string,
): string {
  return tr(TEXT[kind], { title });
}
