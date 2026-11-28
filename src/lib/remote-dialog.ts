// 원격 창(브라우저)에는 네이티브 대화상자가 없다 — 앱이 `window.__AYNX_REMOTE_UI__` 를 걸면 폴리필(`src-tauri/src/remote/polyfill.js`)이
// 앱 모달로 보낸다. 여기 있는 것은 그 모달의 단추 · 문구 고르기뿐이다.
import type { Key } from "$lib/i18n/keys";

/** 플러그인 JS 의 `buttonsToRust` 가 만드는 모양 그대로. 없으면 `Ok` 하나 */
export type DialogButtons =
  | "Ok"
  | "OkCancel"
  | "YesNo"
  | "YesNoCancel"
  | { OkCancelCustom: [string, string] }
  | { YesNoCancelCustom: [string, string, string] }
  | { OkCustom: string }
  | null
  | undefined;

export interface DialogChoice {
  label?: string;
  key?: Key;
  result: string;
  primary: boolean;
  cancel: boolean;
}

const YES: Key = "app.remoteDialog.yes";
const NO: Key = "app.remoteDialog.no";
const OK: Key = "app.remoteDialog.ok";
const CANCEL: Key = "app.actions.cancel";

/**
 * 취소 쪽이 왼쪽, 강조가 오른쪽 끝. 결과 글자는 플러그인이 견주는 값 그대로다(`ask` = `"Yes"` · `confirm` = `"Ok"` · 사용자 이름이면 그 이름).
 */
export function dialogChoices(buttons: unknown): DialogChoice[] {
  const b = buttons as DialogButtons;
  if (b === "YesNo") {
    return [
      { key: NO, result: "No", primary: false, cancel: true },
      { key: YES, result: "Yes", primary: true, cancel: false },
    ];
  }
  if (b === "OkCancel") {
    return [
      { key: CANCEL, result: "Cancel", primary: false, cancel: true },
      { key: OK, result: "Ok", primary: true, cancel: false },
    ];
  }
  if (b === "YesNoCancel") {
    return [
      { key: CANCEL, result: "Cancel", primary: false, cancel: true },
      { key: NO, result: "No", primary: false, cancel: false },
      { key: YES, result: "Yes", primary: true, cancel: false },
    ];
  }
  if (b && typeof b === "object") {
    if ("OkCancelCustom" in b && Array.isArray(b.OkCancelCustom)) {
      const [ok, cancel] = b.OkCancelCustom.map(String);
      return [
        { label: cancel, result: cancel, primary: false, cancel: true },
        { label: ok, result: ok, primary: true, cancel: false },
      ];
    }
    if ("YesNoCancelCustom" in b && Array.isArray(b.YesNoCancelCustom)) {
      const [yes, no, cancel] = b.YesNoCancelCustom.map(String);
      return [
        { label: cancel, result: cancel, primary: false, cancel: true },
        { label: no, result: no, primary: false, cancel: false },
        { label: yes, result: yes, primary: true, cancel: false },
      ];
    }
    if ("OkCustom" in b && typeof b.OkCustom === "string") {
      return [{ label: b.OkCustom, result: b.OkCustom, primary: true, cancel: true }];
    }
  }
  return [{ key: OK, result: "Ok", primary: true, cancel: true }];
}

export function escapeResult(choices: readonly DialogChoice[]): string {
  return (choices.find((c) => c.cancel) ?? choices[choices.length - 1])?.result ?? "Ok";
}

/** 경고 · 오류면 취소 쪽 — Enter 한 번에 세션이 닫히지 않게 */
export function initialFocus(choices: readonly DialogChoice[], kind: unknown): number {
  const careful = kind === "warning" || kind === "error";
  const i = careful ? choices.findIndex((c) => c.cancel) : choices.findIndex((c) => c.primary);
  return i >= 0 ? i : choices.length - 1;
}

// ── 재확인(REAUTH) ──

export interface ReauthReply {
  status: number;
  data: { ticket?: unknown; error?: unknown; retryAfterMs?: unknown };
}

export function reauthTicketOf(r: ReauthReply): string | null {
  return r.status === 200 && typeof r.data.ticket === "string" && r.data.ticket !== "" ? r.data.ticket : null;
}

export function reauthFailure(r: ReauthReply): { key: Key; params?: Record<string, number> } {
  const ms = Number(r.data.retryAfterMs);
  const s = Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : 0;
  if (r.status === 0) return { key: "app.remoteReauth.fail.offline" };
  if (r.status === 429) return s > 0 ? { key: "app.remoteReauth.fail.limited", params: { s } } : { key: "app.remoteReauth.fail.limitedNow" };
  if (r.status === 401 && r.data.error === "session") return { key: "app.remoteReauth.fail.session" };
  if (r.status === 401) return s > 0 ? { key: "app.remoteReauth.fail.wrongLimited", params: { s } } : { key: "app.remoteReauth.fail.wrong" };
  if (r.status === 503) return { key: "app.remoteReauth.fail.server" };
  return { key: "app.remoteReauth.fail.other" };
}

/** Rust `deny::command_label` 과 같은 말이다. 모르는 이름은 `null`(부르는 쪽이 받은 글자 그대로 보인다) */
export function reauthWhatKey(cmd: string): Key | null {
  switch (cmd) {
    case "approve_operation":
      return "app.remoteReauth.what.approve_operation";
    case "modify_operation_targets":
      return "app.remoteReauth.what.modify_operation_targets";
    case "delegation_set_target":
      return "app.remoteReauth.what.delegation_set_target";
    case "db_ai_set":
      return "app.remoteReauth.what.db_ai_set";
    case "orchestration_approve_verify":
      return "app.remoteReauth.what.orchestration_approve_verify";
    case "orchestration_override_verify":
      return "app.remoteReauth.what.orchestration_override_verify";
    case "producer_album_start":
      return "app.remoteReauth.what.producer_album_start";
    case "orchestration_album_widen":
      return "app.remoteReauth.what.orchestration_album_widen";
    case "orchestration_delete_archived":
      return "app.remoteReauth.what.orchestration_delete_archived";
    case "orchestration_merge":
      return "app.remoteReauth.what.orchestration_merge";
    case "set_session_ai_read":
      return "app.remoteReauth.what.set_session_ai_read";
    case "chat_tile_goal_start":
      return "app.remoteReauth.what.chat_tile_goal_start";
    default:
      return null;
  }
}

/** 표 없이 기다린 시간이 이보다 길면 확인 뒤 표를 새로 받는다(표 60초 — `auth.rs` REAUTH_TTL) */
export const REAUTH_FRESH_MS = 45_000;
