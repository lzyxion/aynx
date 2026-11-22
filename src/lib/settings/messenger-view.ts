/**
 * 설정 › 알림 › 메신저 채널 목록의 순수 판정.
 * 봇 상태에는 토큰이 없다(백엔드가 `configured` 하나만 준다). 짝지은 이름 · 짝짓기를 청한 이름은 남의 글자라 글자로만 그린다.
 */

import type { Key } from "$lib/i18n/keys";
import type { MessengerChannel } from "$lib/messenger-notify";

/** 받는 고리(롱폴)의 상태 — `conflict` = 다른 프로그램이 같은 봇으로 글을 받는다(409) */
export type BotLink = "ok" | "conflict" | "error" | "off";

export type BotChannel = "telegram" | "discord" | "slack";

export const BOT_CHANNELS: readonly BotChannel[] = ["telegram", "discord", "slack"];

export type DualChannel = "discord" | "slack";

export const DUAL_CHANNELS: readonly DualChannel[] = ["discord", "slack"];

/** `id` 는 DOM id 다(연결 전 몸통 · 바꾸기 칸이 같은 id) */
export interface TokenField {
  id: string;
  label: Key;
  placeholder: string;
}

export function tokenFields(channel: BotChannel): TokenField[] {
  const bot: TokenField = {
    id: `messenger-${channel}-token`,
    label: "settings.messenger.bot.token.label",
    placeholder: channel === "telegram" ? "123456789:AA…" : channel === "discord" ? "MTIz….Gx….…" : "xoxb-…",
  };
  if (channel !== "slack") return [bot];
  return [bot, { id: "messenger-slack-app-token", label: "settings.messenger.slack.app_token.label", placeholder: "xapp-…" }];
}

/** Slack 은 `"<봇>\n<앱>"` 한 글자열로 넘긴다 — 서버가 접두사로 가르므로 칸 순서는 뜻이 없다. 빈 칸이 있으면 `null` */
export function joinTokens(values: readonly string[]): string | null {
  const parts = values.map((v) => v.trim());
  return parts.length > 0 && parts.every((p) => p !== "") ? parts.join("\n") : null;
}

export const SLACK_MANIFEST = `display_information:
  name: Aynx
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Aynx
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:history
settings:
  event_subscriptions:
    bot_events:
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false`;

/** 짝이 없는 `` ` `` 는 글자 그대로 */
export function codeSpans(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  const re = /`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), code: false });
    out.push({ text: m[1], code: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), code: false });
  return out;
}

/** `messenger_bot_status` 의 답 */
export interface BotStatus {
  configured: boolean;
  bot: string | null;
  paired: boolean;
  pairName: string | null;
  pending: { code: string; name: string } | null;
  link: BotLink;
}

const LINKS: readonly BotLink[] = ["ok", "conflict", "error", "off"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

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

/** `messenger_status` 의 답 — 옛 백엔드는 `via` 를 주지 않는다 */
export interface HookStatus {
  configured: boolean;
  via: "webhook" | "bot" | null;
}

export function parseHookStatus(v: unknown): HookStatus {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const configured = o.configured === true;
  const via = o.via === "webhook" || o.via === "bot" ? o.via : null;
  return { configured, via: configured ? via : null };
}

export type DualMode = "none" | "webhook" | "bot";

/** 봇 상태를 못 읽었어도 `via: "bot"` 이면 웹훅 칸을 내밀지 않는다 — 백엔드가 그 상태의 웹훅 등록을 거절한다 */
export function dualMode(hook: HookStatus | null, bot: BotStatus | null): DualMode {
  if (bot?.configured || hook?.via === "bot") return "bot";
  return hook?.configured ? "webhook" : "none";
}

export type DualVia = "bot" | "webhook";

/** `to-bot` · `to-webhook` = 연결된 방식을 바꾸는 몸통(확인을 먼저 세운다) */
export type DualView = "bot" | "webhook" | "to-bot" | "to-webhook";

export function dualDefaultVia(mode: DualMode): DualVia {
  return mode === "webhook" ? "webhook" : "bot";
}

export function dualView(mode: DualMode, picked: DualVia | null): DualView {
  const via = picked ?? dualDefaultVia(mode);
  if (mode === "webhook" && via === "bot") return "to-bot";
  if (mode === "bot" && via === "webhook") return "to-webhook";
  return via;
}

export function dualNeedsConfirm(view: DualView): boolean {
  return view === "to-bot" || view === "to-webhook";
}

/** 원격 창에서 방식 바꾸기는 어느 방향이든 잠긴다 — 봇 토큰을 넣거나 지운다(`remote/deny.rs` HOME_ONLY). 웹훅 등록만은 원격 허용 */
export function dualSwitchLocked(view: DualView, remote: boolean): boolean {
  return remote && dualNeedsConfirm(view);
}

export function dualKind(mode: DualMode): Key | null {
  if (mode === "bot") return "settings.messenger.kind.bot";
  if (mode === "webhook") return "settings.messenger.kind.webhook";
  return null;
}

export function botConnected(s: BotStatus | null): boolean {
  return !!s && s.configured && s.paired;
}

/** Telegram 만 `@이름` — Discord · Slack 의 `@` 는 이름의 일부가 아니다 */
export function botHandle(bot: string | null, channel: BotChannel = "telegram"): string {
  if (!bot) return "";
  if (channel !== "telegram") return bot;
  return bot.startsWith("@") ? bot : `@${bot}`;
}

/** 문장을 `mark` 앞뒤로 가른다(그 자리에 이름을 따로 그린다) — `mark` 가 한 번이 아니면 `null` */
export function splitAtMark(sentence: string, mark: string): [string, string] | null {
  const parts = sentence.split(mark);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

export function formatPairCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export interface ChannelChip {
  tone: "ok" | "bad" | "warn" | "idle" | "off" | "info";
  key: Key;
}

export interface ChannelHead {
  /** 종류 칩이다 — 상태가 아니다 */
  kind?: Key | null;
  chips: ChannelChip[];
  aside: "conflict" | null;
}

function sendChip(send: boolean): ChannelChip {
  return send
    ? { tone: "ok", key: "settings.messenger.status.sending" }
    : { tone: "idle", key: "settings.messenger.status.paused" };
}

const NONE: ChannelChip = { tone: "off", key: "settings.messenger.status.none" };

export function webhookHead(configured: boolean | null, send: boolean): ChannelHead {
  return { chips: [configured === true ? sendChip(send) : NONE], aside: null };
}

export function botHead(s: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
  if (!s || !s.configured) return { chips: [NONE], aside: null };
  const chips: ChannelChip[] = [];
  let aside: ChannelHead["aside"] = null;
  if (!s.paired) {
    chips.push({ tone: "idle", key: "settings.messenger.status.pairing" });
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

export function dualHead(mode: DualMode, bot: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
  const head = mode === "bot" ? botHead(bot, send, chat) : webhookHead(mode === "webhook", send);
  return { ...head, kind: dualKind(mode) };
}

export function telegramHead(s: BotStatus | null, send: boolean, chat: boolean): ChannelHead {
  return { ...botHead(s, send, chat), kind: s?.configured ? "settings.messenger.kind.bot" : null };
}

export function channelConnected(
  channel: MessengerChannel,
  hooks: Partial<Record<MessengerChannel, HookStatus | null>>,
  bots: Partial<Record<BotChannel, BotStatus | null>>,
): boolean {
  if (channel === "telegram") return botConnected(bots.telegram ?? null);
  const mode = dualMode(hooks[channel] ?? null, bots[channel] ?? null);
  return mode === "bot" ? botConnected(bots[channel] ?? null) : mode === "webhook";
}

/** `McpSection` 의 에이전트 목록과 같은 판정 */
export function accordionEdges(i: number, count: number, openIndex: number): { first: boolean; last: boolean } {
  return {
    first: i === 0 || (openIndex >= 0 && (i === openIndex || i === openIndex + 1)),
    last: i === count - 1 || (openIndex >= 0 && (i === openIndex || i === openIndex - 1)),
  };
}
