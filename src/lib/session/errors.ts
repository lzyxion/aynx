// 세션 열기 실패 — invoke 거부 페이로드 → `SessionError` 정규화 · 문구 · 원인 힌트 · `SessionOpenError`.

import { OPEN_CAUSES, type OpenCause, type OpenDiag, type SessionError } from "./contract";
import { koTr } from "./ko-tr";
import type { Tr } from "./spec";

function describeUnknown(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 태그는 `kind` 가 계약이지만 known_hosts 모듈 스타일(`status`: unknown/changed)도 받는다. 모양을 못 알아보면 `other` */
export function parseSessionError(e: unknown, tr: Tr): SessionError {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const raw = typeof o.kind === "string" ? o.kind : typeof o.status === "string" ? o.status : "";
    const tag =
      raw === "unknown" ? "host_key_unknown" : raw === "changed" ? "host_key_changed" : raw;
    if (tag === "host_key_unknown" || tag === "host_key_changed") {
      return {
        kind: tag,
        fingerprint:
          typeof o.fingerprint === "string" ? o.fingerprint : tr("pane.error.unknown_value"),
        key_type: typeof o.key_type === "string" ? o.key_type : tr("pane.error.unknown_value"),
        // `known_hosts::check` 를 그대로 직렬화한 페이로드(`status`)에는 아래 넷이 없다.
        host: typeof o.host === "string" ? o.host : null,
        port: typeof o.port === "number" ? o.port : null,
        noStore: o.no_store === true,
        oldFingerprint: typeof o.old_fingerprint === "string" ? o.old_fingerprint : null,
      };
    }
    if (tag === "passphrase_required" && typeof o.path === "string") {
      return {
        kind: "passphrase_required",
        path: o.path,
        fingerprint: typeof o.fingerprint === "string" ? o.fingerprint : null,
        wrong: o.wrong === true,
        storedRejected: o.stored_rejected === true,
      };
    }
    if (tag === "password_required" || tag === "auth" || tag === "other") {
      const parsed: SessionError = {
        kind: tag,
        message: typeof o.message === "string" ? o.message : describeUnknown(e),
        storedRejected: o.stored_rejected === true,
      };
      const diag = parseDiag(o.diag);
      if (diag) parsed.diag = diag;
      return parsed;
    }
  }
  return { kind: "other", message: describeUnknown(e) };
}

/** 모르는 코드는 버린다 — 나중에 늘어난 사유를 옛 화면이 힌트로 잘못 그리지 않게 */
function asCause(v: unknown): OpenCause | null {
  return typeof v === "string" && (OPEN_CAUSES as readonly string[]).includes(v)
    ? (v as OpenCause)
    : null;
}

function parseDiag(raw: unknown): OpenDiag | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cause = asCause(o.cause);
  if (cause === null) return null;
  const diag: OpenDiag = { cause };
  if (typeof o.jump === "string") diag.jump = o.jump;
  const inner = asCause(o.inner);
  if (inner !== null) diag.inner = inner;
  if (o.identities_only === true) diag.identitiesOnly = true;
  return diag;
}

/**
 * 오류 문구 아래 흐리게 붙는 "다음에 할 일" — 배너의 사유 칸이 한 줄로 잘리는 자리라 문구와 한 문장으로 잇지 않는다.
 * 경유 실패는 안쪽 사유의 힌트를 쓴다. `other` 에는 힌트가 없다 — 모르는 실패에 그럴듯한 제안을 붙이면 사람을 엉뚱한 곳으로 보낸다.
 */
export function openErrorHint(err: SessionError, tr: Tr): string | null {
  const diag = "diag" in err ? err.diag : undefined;
  if (!diag) return null;
  const cause = diag.cause === "jump" ? (diag.inner ?? "jump") : diag.cause;
  if (cause === "other") return null;
  const hint = tr(`pane.error.hint.${cause}`);
  return diag.identitiesOnly ? hint + tr("pane.error.hint.identities_only") : hint;
}

export function openErrorHintOf(e: unknown, tr: Tr): string | null {
  return openErrorHint(sessionErrorOf(e, tr), tr);
}

/** 여러 줄이면 `\n` 구분 */
export function describeSessionError(err: SessionError, tr: Tr): string {
  switch (err.kind) {
    case "host_key_unknown":
      return tr("pane.error.host_key.unknown", {
        type: err.key_type,
        fingerprint: err.fingerprint,
      });
    case "host_key_changed":
      return [
        tr("pane.error.host_key.changed.head"),
        tr("pane.error.host_key.changed.type", { type: err.key_type }),
        ...(err.oldFingerprint
          ? [tr("pane.error.host_key.changed.old", { fingerprint: err.oldFingerprint })]
          : []),
        tr("pane.error.host_key.changed.new", { fingerprint: err.fingerprint }),
        tr("pane.error.host_key.changed.tail1"),
        tr("pane.error.host_key.changed.tail2"),
        tr("pane.error.host_key.changed.tail3"),
      ].join("\n");
    case "password_required":
      return tr("pane.error.password", { reason: err.message });
    case "auth":
      return tr("pane.error.auth", { reason: err.message });
    case "passphrase_required":
      return tr("pane.error.passphrase", { path: err.path });
    case "cancelled":
      return tr("pane.error.cancelled");
    case "password_cancelled":
      return tr("pane.error.password_cancelled");
    case "passphrase_cancelled":
      return tr("pane.error.passphrase_cancelled");
    default:
      return tr("pane.error.other", { reason: err.message });
  }
}

export function sessionErrorOf(e: unknown, tr: Tr): SessionError {
  return e instanceof SessionOpenError ? e.detail : parseSessionError(e, tr);
}

export function describeOpenError(e: unknown, tr: Tr): string {
  return describeSessionError(sessionErrorOf(e, tr), tr);
}

/** `openSession` 이 던지는 유일한 오류 타입 */
export class SessionOpenError extends Error {
  readonly detail: SessionError;
  constructor(detail: SessionError) {
    // 진단용 메시지다 — 화면은 `detail` 로 `describeSessionError(detail, t)` 를 따로 부른다.
    super(describeSessionError(detail, koTr));
    this.name = "SessionOpenError";
    this.detail = detail;
  }
}
