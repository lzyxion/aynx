/**
 * DB 연결 폼의 [연결 테스트] 칩 규칙.
 *
 * - 회차(`gen`)가 늦게 온 답을 버린다 — 서버 쪽 시도는 제 시한에 스스로 끝난다.
 * - 칩을 지우는 비교는 저장 꼴이 아니라 폼의 모든 칸이다 — 다듬기로 같아지는 칸도 사람이 만졌으면 지운다.
 * - 볼트 비밀번호로 물러날지는 서버(Rust `db::table::test_vault_allowed`)가 정한다 — 화면은 잠긴 볼트를 열어 달라고 할지만 고른다.
 */
import { hasReason } from "$lib/error-reason";
import { sameDbTarget } from "$lib/db-ai";
import type { DbConn } from "$lib/db-conn";
import type { ConnRow } from "./conn-form";
import type { DbTested } from "./query-backend";

/** i18n `app.query.form.test.reason.<갈래>` */
export type ConnTestReason = "auth" | "host" | "refused" | "tls" | "timeout" | "failed";

export type ConnTestPhase =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "ok"; result: DbTested }
  | { kind: "error"; reason: ConnTestReason; message: string }
  /** 폼 값이 저장 검사를 못 지났다 — 서버에 가지 않았다 */
  | { kind: "invalid"; message: string }
  | { kind: "cancelled" };

/** `key` 는 시험을 시작할 때의 폼 열쇠 */
export interface ConnTestState {
  gen: number;
  key: string;
  phase: ConnTestPhase;
}

export function idleConnTest(gen = 0): ConnTestState {
  return { gen, key: "", phase: { kind: "idle" } };
}

/** 칸이 바뀌었는지만 본다 — 값은 밖으로 나가지 않는다 */
export function connFormKey(row: ConnRow): string {
  return JSON.stringify([
    row.id,
    row.name,
    row.engine,
    row.via,
    row.path,
    row.host,
    row.port,
    row.database,
    row.user,
    row.tlsMode,
    row.tlsCa,
    row.folder,
  ]);
}

export function beginConnTest(s: ConnTestState, key: string, now: number): ConnTestState {
  return { gen: s.gen + 1, key, phase: { kind: "running", startedAt: now } };
}

export function invalidConnTest(s: ConnTestState, key: string, message: string): ConnTestState {
  return { gen: s.gen + 1, key, phase: { kind: "invalid", message } };
}

export function resetConnTest(s: ConnTestState): ConnTestState {
  return idleConnTest(s.gen + 1);
}

export function onConnFormChange(s: ConnTestState, key: string): ConnTestState {
  return s.phase.kind !== "idle" && s.key !== key ? resetConnTest(s) : s;
}

export function finishConnTest(s: ConnTestState, gen: number, phase: ConnTestPhase): ConnTestState {
  return gen === s.gen && s.phase.kind === "running" ? { ...s, phase } : s;
}

export function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

// OS 오류 번호는 OS 언어와 무관하다(Windows WSA · POSIX errno) — 문구 조각은 드라이버(영어 고정)와 앱 문구(한 · 영)
const TIMEOUT = /os error (10060|110)\b|timed? ?out|timeout|시간이 초과|시간 초과/i;
const HOST = /os error (11001|11002|11004|-2|-3)\b|no such host|failed to lookup address|name or service not known|nodename nor servname|호스트를 찾을 수 없|알려진 호스트가 없/i;
const REFUSED = /os error (10061|111)\b|connection refused|actively refused|거부/i;
const TLS = /\bTLS\b|\bSSL\b|certificate|인증서|인증 기관/i;

/**
 * 이유 접두어를 떼기 전 문자열을 준다. 네트워크 갈래를 TLS 보다 먼저 본다 — "인증서를 확인하려고 붙지 못했습니다: 연결 거절" 은 거절이다.
 */
export function connTestReason(message: string): ConnTestReason {
  if (hasReason(message, "db-auth") || hasReason(message, "db-password")) return "auth";
  if (TIMEOUT.test(message)) return "timeout";
  if (HOST.test(message)) return "host";
  if (REFUSED.test(message)) return "refused";
  if (TLS.test(message)) return "tls";
  return "failed";
}

/** 서버는 `dbtest-` 머리만 받는다 */
export function newConnTestStream(rand: () => number = Math.random): string {
  const part = () => Math.floor(rand() * 0x100000000).toString(36);
  return `dbtest-${part()}${part()}`;
}

/** 판단의 진실은 서버다 — 이것은 묻는 창을 띄울지만 정한다 */
export function connTestMayUseVault(orig: DbConn | null, draft: DbConn): boolean {
  return orig !== null && orig.id === draft.id && sameDbTarget(orig, draft);
}

/** `detail` = 말풍선(실패는 서버 문구 전체) */
export interface ConnTestChip {
  mark: "spin" | "ok" | "err" | "none";
  label: string;
  detail: string;
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

export function connTestChip(phase: ConnTestPhase, now: number, tr: Tr): ConnTestChip | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "running": {
      const label = tr("app.query.form.test.running", { s: elapsedSeconds(phase.startedAt, now) });
      return { mark: "spin", label, detail: label };
    }
    case "ok": {
      const r = phase.result;
      const lines = [
        tr("app.query.form.test.detail.version", { v: r.serverVersion || r.dialect }),
        r.via ? tr("app.query.form.test.detail.via", { via: r.via }) : tr("app.query.form.test.detail.direct"),
        tr("app.query.form.test.detail.elapsed", { ms: r.elapsedMs }),
        tr("app.query.form.test.detail.note"),
      ];
      return { mark: "ok", label: tr("app.query.form.test.ok", { ms: r.elapsedMs }), detail: lines.join("\n") };
    }
    case "error":
      return { mark: "err", label: tr(`app.query.form.test.reason.${phase.reason}`), detail: phase.message };
    case "invalid":
      return { mark: "err", label: phase.message, detail: phase.message };
    case "cancelled":
      return { mark: "none", label: tr("app.query.form.test.cancelled"), detail: tr("app.query.form.test.detail.cancelled") };
  }
}
