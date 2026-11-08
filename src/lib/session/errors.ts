// 세션 열기 실패 — invoke 거부 페이로드 → `SessionError` 정규화 · 사람이 읽는 문구 · 원인 힌트 · `SessionOpenError`.

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

/**
 * invoke 거부 페이로드를 `SessionError` 로 정규화한다.
 * 태그 필드는 `kind` 가 계약이지만 known_hosts 모듈 스타일(`status`: unknown/changed)도 받아 준다.
 * 모양을 못 알아보면 `other` 로 떨어뜨린다 — 명령 미등록("command X not found") 도 여기로 온다.
 */
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
        // 아래 셋은 2026-09-16 에 붙었다 — `known_hosts::check` 를 그대로 직렬화한
        // 페이로드(`status`)에는 없으므로 없을 때를 견딘다.
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
        // 옛 백엔드에는 없던 칸이라 "없으면 거짓" 이다 (호스트 키의 셋과 같은 규칙).
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

/** `{ cause, jump?, inner? }` 를 받아 낸다. 모양이 아니면 `null` (진단이 없는 실패다) */
function parseDiag(raw: unknown): OpenDiag | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cause = asCause(o.cause);
  if (cause === null) return null;
  const diag: OpenDiag = { cause };
  if (typeof o.jump === "string") diag.jump = o.jump;
  const inner = asCause(o.inner);
  if (inner !== null) diag.inner = inner;
  // 백엔드는 켜졌을 때만 싣는다 (`false` 는 필드가 아예 없다) — 옛 페이로드와 같은 모양이다.
  if (o.identities_only === true) diag.identitiesOnly = true;
  return diag;
}

/**
 * **다음에 할 일 한 줄** — 오류 문구 아래 흐리게 붙는 안내. 없으면 `null`.
 *
 * 문구(`describeSessionError`)가 "무슨 일이 있었나" 라면 이쪽은 "그래서 어디를 보라" 다.
 * 둘을 한 문장으로 잇지 않는 이유는 화면에서 **톤이 다르고**(사실 / 제안), 배너의 사유 칸이
 * 한 줄로 잘리는 자리라 제안까지 밀어 넣으면 둘 다 안 보이기 때문이다.
 *
 * **경유 실패는 안쪽 사유의 힌트를 쓴다** — "경유 호스트에서 실패" 는 이미 문구가 말했고,
 * 사람이 다음에 할 일은 그 경유 호스트에서 무엇이 틀렸는가(포트·이름·키)에 달려 있다.
 * 안쪽을 모르면 경유 자신의 힌트로 떨어진다.
 *
 * `other` 에는 힌트가 없다 — 모르는 실패에 그럴듯한 제안을 붙이면 사람을 엉뚱한 곳으로 보낸다.
 */
export function openErrorHint(err: SessionError, tr: Tr): string | null {
  const diag = "diag" in err ? err.diag : undefined;
  if (!diag) return null;
  const cause = diag.cause === "jump" ? (diag.inner ?? "jump") : diag.cause;
  if (cause === "other") return null;
  const hint = tr(`pane.error.hint.${cause}`);
  // `IdentitiesOnly yes` 는 사유가 아니라 **꼬리 한 마디**다 — "가진 키를 다 내 봤는데
  // 거부됐다" 와 "지정한 키 하나만 내 봤다" 는 다음에 할 일이 다르다.
  return diag.identitiesOnly ? hint + tr("pane.error.hint.identities_only") : hint;
}

/** 아무 오류나 받아 힌트 한 줄로 (없으면 `null`) — `describeOpenError` 의 짝 */
export function openErrorHintOf(e: unknown, tr: Tr): string | null {
  return openErrorHint(sessionErrorOf(e, tr), tr);
}

/** 터미널에 그대로 찍을 안내 문구 (여러 줄이면 `\n` 구분) */
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
      // 3번 다 틀렸을 때만 여기까지 온다 (그전에는 모달이 다시 뜼다)
      return tr("pane.error.password", { reason: err.message });
    case "auth":
      return tr("pane.error.auth", { reason: err.message });
    case "passphrase_required":
      // 한 키에 3번 다 틀렸을 때만 여기까지 온다 (그전에는 모달이 다시 뜬다).
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

/**
 * 아무 오류나 받아 분기 가능한 `SessionError` 로.
 * `openSession` 은 언제나 `SessionOpenError` 를 던지므로 보통은 첫 줄에서 끝난다.
 */
export function sessionErrorOf(e: unknown, tr: Tr): SessionError {
  return e instanceof SessionOpenError ? e.detail : parseSessionError(e, tr);
}

/** 아무 오류나 받아 사람이 읽는 문구로 (openSession 의 catch 에서 사용) */
export function describeOpenError(e: unknown, tr: Tr): string {
  return describeSessionError(sessionErrorOf(e, tr), tr);
}

/**
 * invoke 인자를 만든다. **호출(시도)마다 새 Channel 을 만든다** — Tauri 채널은
 * invoke 한 번에 묶이는 자원이라, 거부된 invoke 에 실렸던 채널을 재시도에 재사용하면
 * 데이터가 허공으로 가 화면이 조용히 검게 남는다 (비밀번호 재시도에서 실제로 발생한 버그).
 */

/** `openSession` 이 던지는 유일한 오류 타입 */
export class SessionOpenError extends Error {
  readonly detail: SessionError;
  constructor(detail: SessionError) {
    // 진단용 메시지다 — 화면은 `detail` 을 받아 `describeSessionError(detail, t)` 를 따로 부른다.
    super(describeSessionError(detail, koTr));
    this.name = "SessionOpenError";
    this.detail = detail;
  }
}
