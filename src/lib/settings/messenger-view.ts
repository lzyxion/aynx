/**
 * **설정 › 알림 › 채널 목록의 순수 판정**(메신저 다리 1b — docs/log/2026-11-18-messenger-bridge.md · 사용자 확정 목업 "설정 › 알림 › 채널").
 *
 * 채널 줄 머리의 상태 칩 · "연결됐는가" · Telegram 봇 상태(`messenger_bot_status`)의 모양 검사가 여기 있다. 룬도 DOM 도 Tauri 도 없어
 * vitest 로 그대로 돈다(`messenger-view.test.ts`). 화면은 `MessengerSettings.svelte` · `MessengerChannel.svelte`.
 *
 * - Discord · Slack 은 웹훅이 등록되면 연결된 것이다(`messenger_status`).
 * - Telegram 은 **봇 토큰이 있고(`configured`) 계정을 짝지었을 때(`paired`)** 연결된 것이다 — 토큰만 있으면 "계정 연결 대기".
 * - 봇 상태에는 토큰이 없다(백엔드가 `configured` 하나만 준다). 짝지은 이름 · 짝짓기를 청한 이름은 **남의 글자**라 글자로만 그린다.
 */

import type { Key } from "$lib/i18n/keys";
import type { MessengerChannel } from "$lib/messenger-notify";

/** 받는 고리(롱폴)의 상태 — `conflict` = 다른 프로그램이 같은 봇으로 글을 받는다(409) */
export type BotLink = "ok" | "conflict" | "error" | "off";

/** `messenger_bot_status` 의 답 */
export interface BotStatus {
  configured: boolean;
  /** 봇 사용자 이름(`@` 없이 올 수도 있다 — [`botHandle`]) */
  bot: string | null;
  paired: boolean;
  pairName: string | null;
  /** 짝짓기를 청한 계정 — 코드는 6자리 */
  pending: { code: string; name: string } | null;
  link: BotLink;
}

const LINKS: readonly BotLink[] = ["ok", "conflict", "error", "off"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** 백엔드 답 → 믿을 수 있는 모양. 모양이 아니면 `null`(모름) */
export function parseBotStatus(v: unknown): BotStatus | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.configured !== "boolean") return null;
  const p = o.pending as Record<string, unknown> | null | undefined;
  const pending =
    p && typeof p === "object" && typeof p.code === "string" && p.code !== ""
      ? { code: p.code, name: typeof p.name === "string" ? p.name : "" }
      : null;
  return {
    configured: o.configured,
    bot: str(o.bot),
    paired: o.paired === true,
    pairName: str(o.pairName),
    pending,
    link: LINKS.includes(o.link as BotLink) ? (o.link as BotLink) : "off",
  };
}

/** Telegram 이 "연결됨" 인가 — 토큰 + 짝지은 계정 */
export function botConnected(s: BotStatus | null): boolean {
  return !!s && s.configured && s.paired;
}

/** 봇 이름을 `@이름` 으로 — 없으면 빈 글자 */
export function botHandle(bot: string | null): string {
  if (!bot) return "";
  return bot.startsWith("@") ? bot : `@${bot}`;
}

/** 짝짓기 코드를 세 자리씩(`482 913`) — 여섯 자리가 아니면 그대로 */
export function formatPairCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** 상태 칩 한 개 — `StatusChip` 의 톤 + 문구 키 */
export interface ChannelChip {
  tone: "ok" | "bad" | "warn" | "idle" | "off" | "info";
  key: Key;
}

/** 머리줄 딸린 줄 — 칩들 + (있으면) 칩 뒤의 곁글 */
export interface ChannelHead {
  chips: ChannelChip[];
  /** 곁글 — `bot` = 봇 이름(계정 연결 대기) · `conflict` = 다른 프로그램이 이 봇을 쓴다 */
  aside: "bot" | "conflict" | null;
}

/** 연결된 채널의 보내기 칩 — 보내는 중(ok) · 보내기 꺼짐(idle) */
function sendChip(send: boolean): ChannelChip {
  return send
    ? { tone: "ok", key: "settings.messenger.status.sending" }
    : { tone: "idle", key: "settings.messenger.status.paused" };
}

const NONE: ChannelChip = { tone: "off", key: "settings.messenger.status.none" };

/** 웹훅 채널(Discord · Slack)의 머리 — 등록 안 됨(모름 포함) · 보내는 중 · 보내기 꺼짐 */
export function webhookHead(configured: boolean | null, send: boolean): ChannelHead {
  return { chips: [configured === true ? sendChip(send) : NONE], aside: null };
}

/**
 * Telegram 의 머리 — 목업의 여섯 상태:
 *
 * | 상태 | 칩 |
 * | --- | --- |
 * | 토큰 없음 · 모름 | 연결 안 됨(off) |
 * | 토큰만 | 계정 연결 대기(idle) + 곁글 `@봇` |
 * | 짝지음 | 보내는 중(ok) / 보내기 꺼짐(idle) · 말하기를 켰으면 말하기 켜짐(ok) |
 * | 받는 고리 `conflict` · `error` (토큰이 있을 때) | 위에 더해 글을 받지 못함(bad) · `conflict` 면 곁글 |
 */
export function telegramHead(s: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
  if (!s || !s.configured) return { chips: [NONE], aside: null };
  const chips: ChannelChip[] = [];
  let aside: ChannelHead["aside"] = null;
  if (!s.paired) {
    chips.push({ tone: "idle", key: "settings.messenger.status.pairing" });
    if (s.bot) aside = "bot";
  } else {
    chips.push(sendChip(send));
    if (chat) chips.push({ tone: "ok", key: "settings.messenger.status.chat" });
  }
  if (s.link === "conflict" || s.link === "error") {
    chips.push({ tone: "bad", key: "settings.messenger.status.no_receive" });
    if (s.link === "conflict") aside = "conflict";
  }
  return { chips, aside };
}

/** 채널이 "연결됨" 인가 — 웹훅은 등록, Telegram 은 토큰 + 짝(목록의 스위치 · 규칙 묶음이 본다) */
export function channelConnected(
  channel: MessengerChannel,
  webhooks: Partial<Record<MessengerChannel, boolean | null>>,
  bot: BotStatus | null,
): boolean {
  return channel === "telegram" ? botConnected(bot) : webhooks[channel] === true;
}

/**
 * **펼친 칸의 첫 · 끝**(`.slist.accordion` 의 `.g-first` · `.g-last` — `settings.css` "펼침 목록") — 펼친 칸은 묶음에서 떨어지고 그 위 · 아래
 * 이웃이 각자 묶음의 끝 · 첫 줄이 된다. `McpSection` 의 에이전트 목록과 같은 판정.
 */
export function accordionEdges(i: number, count: number, openIndex: number): { first: boolean; last: boolean } {
  return {
    first: i === 0 || (openIndex >= 0 && (i === openIndex || i === openIndex + 1)),
    last: i === count - 1 || (openIndex >= 0 && (i === openIndex || i === openIndex - 1)),
  };
}
