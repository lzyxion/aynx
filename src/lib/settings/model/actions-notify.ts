// 설정 화면 **알림** 손잡이 — 턴 끝·권한 물음 · 긴 명령 · 프로그램 알림(OSC 9·777) · 메신저
// (`NotificationsSection` · `MessengerSettings`). 작업안 알림 둘은 `actions-automation.ts`.
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

/**
 * Claude Code 턴 끝 알림 켬/끔. 켜는 것이 기본이므로 **끌 때만** 값을 남긴다
 * (`setLocalShellIntegration` 과 같은 규칙).
 */
export function setNotifyTurnEnd(on: boolean) {
  settings.current.ai.notify_turn_end = on ? undefined : false;
}

/** Claude Code 권한 물음 알림 켬/끔 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setNotifyPermission(on: boolean) {
  settings.current.ai.notify_permission = on ? undefined : false;
}

/** 사이드 채팅 끝남 · 권한 물음 알림 켬/끔 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setNotifySideChat(on: boolean) {
  settings.current.ai.notify_side_chat = on ? undefined : false;
}

/**
 * 보고 있는 타일의 턴 알림 임계(초) — [`setNotifyAfterSecs`] 와 같은 규칙(`0` 은 지우지 않고, 기본값과 같을 때만 지운다).
 */
export function setNotifyFocusedAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_NOTIFY_FOCUSED_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.ai.notify_focused_after_secs =
    clamped === DEFAULT_NOTIFY_FOCUSED_AFTER_SECS ? undefined : clamped;
}

/**
 * 프로그램 알림(OSC 9 · 777). 켜는 것이 기본이므로 **끌 때만** 값을 남긴다
 * (`setOsc52Clipboard` 와 같은 규칙). 핸들러가 시퀀스마다 이 값을 읽으므로 바로 적용된다.
 */
export function setOscNotify(on: boolean) {
  settings.current.terminal.osc_notify = on ? undefined : false;
}

/**
 * 긴 명령 완료 알림의 임계(초)를 정한다. **`0` 은 지우지 않는다** — 끄기는 "안 정함" 과
 * 다른 상태다(기본이 켬이므로 지우면 되살아난다). 기본값과 같은 값을 고르면 그때만 지운다.
 *
 * **바로 적용된다**: 알림 판정이 명령이 끝나는 순간에 `settings.notifyAfterSecs` 를 읽는다.
 */
export function setNotifyAfterSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_NOTIFY_AFTER_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.terminal.notify_after_secs =
    clamped === DEFAULT_NOTIFY_AFTER_SECS ? undefined : clamped;
}

// ---------------------------------------------------------------------------
// 메신저 알림 — `[messenger]` (docs/log/2026-09-27-discord-notify.md). 규칙은 늘 같다:
// 기본값으로 되돌리면 칸을 지운다(파일에 안 적힌다), 숫자 둘은 `0` 을 살린다.
// ---------------------------------------------------------------------------

/** 언제 — `away` · `always` (모르는 키는 기본으로) */
export function setMessengerWhen(key: string) {
  const valid = Object.hasOwn(MESSENGER_WHENS, key) ? key : DEFAULT_MESSENGER_WHEN;
  settings.current.messenger.when = valid === DEFAULT_MESSENGER_WHEN ? undefined : valid;
}

/** 에이전트 턴 끝 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerAgentStop(on: boolean) {
  settings.current.messenger.agent_stop = on ? undefined : false;
}

/** 에이전트 권한 물음 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerAgentPermission(on: boolean) {
  settings.current.messenger.agent_permission = on ? undefined : false;
}

/** 긴 명령 하한(초) — `0` 은 끔이라 지우지 않는다([`setNotifyFocusedAfterSecs`] 와 같은 규칙) */
export function setMessengerCommandMinSecs(secs: number) {
  const v = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : DEFAULT_MESSENGER_COMMAND_MIN_SECS;
  const clamped = Math.min(NOTIFY_AFTER_MAX_SECS, v);
  settings.current.messenger.command_min_secs =
    clamped === DEFAULT_MESSENGER_COMMAND_MIN_SECS ? undefined : clamped;
}

/** 프로그램 알림(OSC 9·777) — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerOsc(on: boolean) {
  settings.current.messenger.osc = on ? undefined : false;
}

/** 작업안 실행 결과(③-4) — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerOperationResults(on: boolean) {
  settings.current.messenger.operation_results = on ? undefined : false;
}

/** 작업안 승인 대기(승인 요약) — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerOperationPending(on: boolean) {
  settings.current.messenger.operation_pending = on ? undefined : false;
}

/** AI 설명 싣기(승인 대기 알림) — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setMessengerIncludeSummary(on: boolean) {
  settings.current.messenger.include_summary = on ? undefined : false;
}

/** 명령 줄 싣기 — 끔이 기본이라 **켤 때만** 값을 남긴다 */
export function setMessengerIncludeCommand(on: boolean) {
  settings.current.messenger.include_command = on ? true : undefined;
}

/** 대화 내용 싣기 — 끔이 기본이라 **켤 때만** 값을 남긴다 (글자는 Rust 가 붙인다 — `messenger.rs`) */
export function setMessengerIncludeConversation(on: boolean) {
  settings.current.messenger.include_conversation = on ? true : undefined;
}

/**
 * 채널마다 보내기 — 켬이 기본이라 **끌 때만** 값을 남긴다. 칸 이름 = 채널 이름(`[messenger] discord` · `slack`)
 * (docs/log/2026-09-28-messenger-channels.md).
 */
export function setMessengerChannel(channel: MessengerChannel, on: boolean) {
  settings.current.messenger[channel] = on ? undefined : false;
}

/** 자리 비움 무입력(분) — `0` 은 "가림막만" 이라 지우지 않는다 */
export function setMessengerAwayAfterMin(min: number) {
  const v = Number.isFinite(min) ? Math.max(0, Math.round(min)) : DEFAULT_MESSENGER_AWAY_AFTER_MIN;
  const clamped = Math.min(MESSENGER_AWAY_MAX_MIN, v);
  settings.current.messenger.away_after_min =
    clamped === DEFAULT_MESSENGER_AWAY_AFTER_MIN ? undefined : clamped;
}
