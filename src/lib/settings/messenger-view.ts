/**
 * **설정 › 알림 › 채널 목록의 순수 판정**(메신저 다리 1b — docs/log/2026-11-18-messenger-bridge.md · 사용자 확정 목업 "설정 › 알림 › 채널").
 *
 * 채널 줄 머리의 상태 칩 · "연결됐는가" · 봇 상태(`messenger_bot_status`)의 모양 검사가 여기 있다. 룬도 DOM 도 Tauri 도 없어
 * vitest 로 그대로 돈다(`messenger-view.test.ts`). 화면은 `MessengerSettings.svelte` · `MessengerChannel.svelte`.
 *
 * - Slack 은 웹훅이 등록되면 연결된 것이다(`messenger_status`).
 * - Telegram 은 **봇 토큰이 있고(`configured`) 계정을 짝지었을 때(`paired`)** 연결된 것이다 — 토큰만 있으면 "계정 연결 대기".
 * - Discord 는 **한 번에 한 방식**이다(2026-11-19 사용자 A안) — 웹훅(알림만)이면 등록으로, 봇(알림 + 말하기)이면 Telegram 과 같은 규칙으로
 *   연결된 것이다. 어느 쪽인지는 `messenger_status` 의 `via` 와 봇 상태가 말한다([`discordMode`]). 몸통의 "연결 방식" 고르기 · 바꾸기 확인 ·
 *   머리줄 방식 칩은 [`discordView`] · [`discordKind`].
 * - 봇 상태에는 토큰이 없다(백엔드가 `configured` 하나만 준다). 짝지은 이름 · 짝짓기를 청한 이름은 **남의 글자**라 글자로만 그린다.
 */

import type { Key } from "$lib/i18n/keys";
import type { MessengerChannel } from "$lib/messenger-notify";

/** 받는 고리(롱폴)의 상태 — `conflict` = 다른 프로그램이 같은 봇으로 글을 받는다(409) */
export type BotLink = "ok" | "conflict" | "error" | "off";

/** 봇이 있는 채널 — `messenger_bot_*` 명령의 `channel` */
export type BotChannel = "telegram" | "discord";

export const BOT_CHANNELS: readonly BotChannel[] = ["telegram", "discord"];

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

/** `messenger_status` 의 답 — `via` 는 Discord 만 뜻이 있다(웹훅 · 봇 · 없음). 옛 백엔드는 `via` 를 주지 않는다 */
export interface HookStatus {
  configured: boolean;
  via: "webhook" | "bot" | null;
}

/** 백엔드 답 → 믿을 수 있는 모양. 모양이 아니면 등록 안 됨 */
export function parseHookStatus(v: unknown): HookStatus {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const configured = o.configured === true;
  const via = o.via === "webhook" || o.via === "bot" ? o.via : null;
  return { configured, via: configured ? via : null };
}

/** Discord 칸이 지금 보이는 방식 — 봇 토큰이 있으면 봇, 웹훅만 있으면 웹훅, 둘 다 없으면 고르기 */
export type DiscordMode = "none" | "webhook" | "bot";

/**
 * Discord 의 방식 — 봇 상태의 `configured` 나 `via: "bot"` 이면 봇(봇 상태를 못 읽었어도 웹훅 칸을 내밀지 않는다 — 백엔드가
 * 그 상태의 웹훅 등록을 거절한다), 그 밖에 등록돼 있으면 웹훅(`via` 가 없는 옛 답도), 아니면 없음.
 */
export function discordMode(hook: HookStatus | null, bot: BotStatus | null): DiscordMode {
  if (bot?.configured || hook?.via === "bot") return "bot";
  return hook?.configured ? "webhook" : "none";
}

/** Discord 의 두 방식 — "연결 방식" 줄의 고르기 */
export type DiscordVia = "bot" | "webhook";

/**
 * Discord 몸통에 서는 것(2026-11-19 목업 "Discord 채널 줄" ①–⑥) — "연결 방식" 줄은 늘 맨 위이고, 그 밑이:
 *
 * | 방식 · 고른 것 | 몸통 |
 * | --- | --- |
 * | 없음 · 봇 / 웹훅 | `bot` / `webhook` — 그 방식의 칸 하나(확인 없이 등록) |
 * | 봇 · 봇 / 웹훅 · 웹훅 | `bot` / `webhook` — 연결된 몸통 그대로(①④ · 봇의 계정 연결 대기도) |
 * | 웹훅 · 봇 | `to-bot` — 봇 토큰 칸 + 바꾸기 확인(②③) |
 * | 봇 · 웹훅 | `to-webhook` — 웹훅 주소 칸 + 바꾸기 확인(⑤⑥) |
 */
export type DiscordView = "bot" | "webhook" | "to-bot" | "to-webhook";

/** 고르기의 기본 — 연결된 방식을 따른다(아무것도 없으면 봇) */
export function discordDefaultVia(mode: DiscordMode): DiscordVia {
  return mode === "webhook" ? "webhook" : "bot";
}

/** 방식 · 고른 것 → 몸통([`DiscordView`]). `picked` 가 `null` 이면 기본([`discordDefaultVia`]) */
export function discordView(mode: DiscordMode, picked: DiscordVia | null): DiscordView {
  const via = picked ?? discordDefaultVia(mode);
  if (mode === "webhook" && via === "bot") return "to-bot";
  if (mode === "bot" && via === "webhook") return "to-webhook";
  return via;
}

/** 바꾸기 몸통인가 — [연결] 이 곧바로 등록하지 않고 확인을 먼저 세운다 */
export function discordNeedsConfirm(view: DiscordView): boolean {
  return view === "to-bot" || view === "to-webhook";
}

/**
 * 바꾸기 칸 · [연결] · [바꾸기] 가 잠기는가 — 원격 창에서 어느 방향이든(봇 토큰을 넣거나 지운다 · `remote/deny.rs` HOME_ONLY). 연결 전 칸은
 * 몸통이 스스로 가린다(봇 토큰 칸만 잠김 — 웹훅 등록은 원격 허용).
 */
export function discordSwitchLocked(view: DiscordView, remote: boolean): boolean {
  return remote && discordNeedsConfirm(view);
}

/** 머리줄 첫 칩(종류 — 상태 아님) — 지금 서 있는 방식. 봇은 계정 연결 대기도 봇이다. 아무것도 없으면 `null` */
export function discordKind(mode: DiscordMode): Key | null {
  if (mode === "bot") return "settings.messenger.discord.kind.bot";
  if (mode === "webhook") return "settings.messenger.discord.kind.webhook";
  return null;
}

/** 봇 채널이 "연결됨" 인가 — 토큰 + 짝지은 계정 */
export function botConnected(s: BotStatus | null): boolean {
  return !!s && s.configured && s.paired;
}

/** 봇 이름 — Telegram 은 `@이름`(사용자 이름 꼴), Discord 는 그대로(`@` 는 이름의 일부가 아니다). 없으면 빈 글자 */
export function botHandle(bot: string | null, channel: BotChannel = "telegram"): string {
  if (!bot) return "";
  if (channel === "discord") return bot;
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
  /** 맨 앞의 종류 칩(Discord 의 봇 · 웹훅 — 점 없는 회색 칩 · 상태가 아니다). 다른 채널은 없다 */
  kind?: Key | null;
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
 * 봇 채널(Telegram · 봇으로 연결한 Discord)의 머리 — 목업의 여섯 상태:
 *
 * | 상태 | 칩 |
 * | --- | --- |
 * | 토큰 없음 · 모름 | 연결 안 됨(off) |
 * | 토큰만 | 계정 연결 대기(idle) + 곁글 `@봇` |
 * | 짝지음 | 보내는 중(ok) / 보내기 꺼짐(idle) · 말하기를 켰으면 말하기 켜짐(ok) |
 * | 받는 고리 `conflict` · `error` (토큰이 있을 때) | 위에 더해 글을 받지 못함(bad) · `conflict` 면 곁글 |
 */
export function botHead(s: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
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

/** Discord 의 머리 — 봇이면 봇 채널과 같고, 아니면 웹훅 채널과 같다(고르기 전 = 연결 안 됨). 맨 앞에 방식 칩([`discordKind`]) */
export function discordHead(mode: DiscordMode, bot: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
  const head = mode === "bot" ? botHead(bot, send, chat) : webhookHead(mode === "webhook", send);
  return { ...head, kind: discordKind(mode) };
}

/** 채널이 "연결됨" 인가 — Slack 은 등록, Telegram 은 토큰 + 짝, Discord 는 그 방식대로(목록의 스위치 · 규칙 묶음이 본다) */
export function channelConnected(
  channel: MessengerChannel,
  hooks: Partial<Record<MessengerChannel, HookStatus | null>>,
  bots: Partial<Record<BotChannel, BotStatus | null>>,
): boolean {
  if (channel === "telegram") return botConnected(bots.telegram ?? null);
  if (channel === "discord") {
    const mode = discordMode(hooks.discord ?? null, bots.discord ?? null);
    return mode === "bot" ? botConnected(bots.discord ?? null) : mode === "webhook";
  }
  return hooks[channel]?.configured === true;
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
