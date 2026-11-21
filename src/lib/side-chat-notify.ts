/**
 * 사이드 채팅의 끝남 · 권한 물음을 알리는 규칙 — 순수 모듈(`[ai] notify_side_chat`). 띄우는 쪽은 `app/side-chat-notify.ts`.
 *
 * AI 타일 알림과 스위치도 표도 따로다 — 짧은 질문이 잦아 타일 알림만 원하는 사람에게 함께 울리면 안 된다.
 * 알림 글에는 채팅 제목과 고정 문구만 싣는다(대화 본문 없음 · 메신저로 보내지 않는다).
 */

import type { BannerKind } from "$lib/agent-banners";
import type { Key } from "$lib/i18n/keys";
import type { Outcome } from "$lib/side-chat-api";

export type SideChatNotifyKind = "finished" | "failed" | "permission";

/** `"os"` = OS 알림 + 배너 */
export type SideChatNotify = "none" | "banner" | "os";

export function bannerKindOfSideChat(kind: SideChatNotifyKind): BannerKind {
  return kind === "finished" ? "stop" : kind;
}

/** 사람이 다른 창(원격 웹 · 폰)에서 그 채팅에 답했을 때 이 창의 배너가 남지 않게 */
export function sideChatResolvedBy(ev: { turnStarted: boolean; permissionsCleared: boolean }): readonly BannerKind[] {
  if (ev.turnStarted) return ["stop", "failed", "permission"];
  return ev.permissionsCleared ? ["permission"] : [];
}

/** 끊은 턴(`interrupted`)은 사람이 한 일이라 알리지 않는다 */
export function sideChatTurnNotifyKind(outcome: Outcome): SideChatNotifyKind | null {
  if (outcome === "ok") return "finished";
  return outcome === "error" ? "failed" : null;
}

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

export function sideChatNotifyText(
  kind: SideChatNotifyKind,
  title: string,
  tr: (key: Key, params?: Record<string, string | number>) => string,
): string {
  return tr(TEXT[kind], { title });
}
