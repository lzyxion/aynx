import {
  DEFAULT_MESSENGER_AWAY_AFTER_MIN,
  DEFAULT_MESSENGER_COMMAND_MIN_SECS,
  DEFAULT_MESSENGER_WHEN,
  MESSENGER_AWAY_MAX_MIN,
  MESSENGER_WHENS,
  type MessengerChannel,
} from "$lib/messenger-notify";
import {
  DEFAULT_NOTIFY_AFTER_SECS,
  DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  NOTIFY_AFTER_MAX_SECS,
} from "./options";
import { settings } from "./store.svelte.js";

export function setNotifyTurnEnd(on: boolean) {
  settings.current.ai.notify_turn_end = on ? undefined : false;
}

export function setNotifyPermission(on: boolean) {
  settings.current.ai.notify_permission = on ? undefined : false;
}

export function setNotifySideChat(on: boolean) {
  settings.current.ai.notify_side_chat = on ? undefined : false;
}

export function setNotifyFocusedAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_NOTIFY_FOCUSED_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.ai.notify_focused_after_secs =
    clamped === DEFAULT_NOTIFY_FOCUSED_AFTER_SECS ? undefined : clamped;
}

export function setOscNotify(on: boolean) {
  settings.current.terminal.osc_notify = on ? undefined : false;
}

/**
 * `0` 은 지우지 않는다 — 끄기는 "안 정함" 과 다른 상태다(기본이 켬이라 지우면 되살아난다). 기본값과 같을 때만 지운다.
 * 이 파일의 다른 초 · 분 칸도 같은 규칙이다.
 */
export function setNotifyAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_NOTIFY_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.terminal.notify_after_secs =
    clamped === DEFAULT_NOTIFY_AFTER_SECS ? undefined : clamped;
}

// ── 메신저 알림 `[messenger]` ──

export function setMessengerWhen(key: string) {
  const valid = Object.hasOwn(MESSENGER_WHENS, key) ? key : DEFAULT_MESSENGER_WHEN;
  settings.current.messenger.when = valid === DEFAULT_MESSENGER_WHEN ? undefined : valid;
}

export function setMessengerAgentStop(on: boolean) {
  settings.current.messenger.agent_stop = on ? undefined : false;
}

export function setMessengerAgentPermission(on: boolean) {
  settings.current.messenger.agent_permission = on ? undefined : false;
}

export function setMessengerCommandMinSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_MESSENGER_COMMAND_MIN_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.messenger.command_min_secs =
    clamped === DEFAULT_MESSENGER_COMMAND_MIN_SECS ? undefined : clamped;
}

export function setMessengerOsc(on: boolean) {
  settings.current.messenger.osc = on ? undefined : false;
}

export function setMessengerOperationResults(on: boolean) {
  settings.current.messenger.operation_results = on ? undefined : false;
}

export function setMessengerOperationPending(on: boolean) {
  settings.current.messenger.operation_pending = on ? undefined : false;
}

export function setMessengerIncludeSummary(on: boolean) {
  settings.current.messenger.include_summary = on ? undefined : false;
}

export function setMessengerIncludeCommand(on: boolean) {
  settings.current.messenger.include_command = on ? true : undefined;
}

export function setMessengerIncludeConversation(on: boolean) {
  settings.current.messenger.include_conversation = on ? undefined : false;
}

/** 칸 이름 = 채널 이름(`[messenger] discord` · `slack` · `telegram`) */
export function setMessengerChannel(channel: MessengerChannel, on: boolean) {
  settings.current.messenger[channel] = on ? undefined : false;
}

/** 원격 창은 말하기를 켜지 못한다 — 화면은 손잡이를 잠그고, 저장은 `remote/deny.rs` 의 `settings_home_only` 가 거절한다. Discord · Slack 도 같다 */
export function setMessengerTelegramChat(on: boolean) {
  settings.current.messenger.telegram_chat = on ? true : undefined;
}

export function setMessengerDiscordChat(on: boolean) {
  settings.current.messenger.discord_chat = on ? true : undefined;
}

export function setMessengerSlackChat(on: boolean) {
  settings.current.messenger.slack_chat = on ? true : undefined;
}

/** `0` 은 "가림막만" 이라 지우지 않는다 */
export function setMessengerAwayAfterMin(min: number) {
  const v = Number.isFinite(min) ? Math.max(0, Math.round(min)) : DEFAULT_MESSENGER_AWAY_AFTER_MIN;
  const clamped = Math.min(MESSENGER_AWAY_MAX_MIN, v);
  settings.current.messenger.away_after_min =
    clamped === DEFAULT_MESSENGER_AWAY_AFTER_MIN ? undefined : clamped;
}
