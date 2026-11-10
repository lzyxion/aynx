/**
 * **DB 연결 폼의 [연결 테스트] — 순수 규칙**(2026-11-09 · 목업 "A안 칩"). 배선은 `app/query.svelte.ts` 의 `startConnTest` ·
 * `cancelConnTest`, 그리기는 `dialogs/DbPickerDialog.svelte`(바닥 줄 왼쪽 단추 + 그 옆 칩 하나).
 *
 * - 시험하는 것은 **저장할 바로 그 값**이다 — 초안은 저장과 같은 `conn-form` 의 `connOfRow` 로 만든다(부르는 쪽).
 * - 칩의 상태는 여섯(없음 · 연결하는 중 · 연결됨 · 실패 · 폼 오류 · 취소됨). 폼이 저장 검사를 못 지나도 **칩으로만** 알린다(폼 안 빨간
 *   줄은 [저장] 의 것 — 2026-11-09 사용자). **회차**([`ConnTestState.gen`])가 늦게 온 답을 버린다 — [취소] ·
 *   폼 칸 바꾸기 · 폼 다시 열기가 회차를 올린다(서버 쪽 시도는 제 시한(15초)에 스스로 끝난다).
 * - 칸을 하나라도 바꾸면 칩이 사라진다 — 비교는 폼의 **모든 칸**을 한 글자로 묶은 열쇠([`connFormKey`])다(저장 꼴이 아니라 폼 줄 —
 *   다듬기로 같아지는 칸도 사람이 만졌으면 지운다).
 * - **볼트**: 볼트 비밀번호로 물러날지는 **서버가** 정한다(저장된 줄과 대상이 같을 때만 — Rust `db::table::test_vault_allowed`). 화면은
 *   같은 눈의 사본([`connTestMayUseVault`] — AI 권한 칸의 `sameDbTarget`)으로 **잠긴 볼트를 열어 달라고 할지만** 고른다(아니면 묻지 않는다).
 * - 실패 갈래([`connTestReason`])는 이유 접두어(`[db-auth]` · `[db-password]`)를 먼저 보고, 나머지는 OS · 드라이버 문구의 고정 조각
 *   (`os error 10061` 같은 번호 — OS 언어와 무관)으로 가른다. 못 가르면 `failed`(연결 실패). 전체 문구는 말풍선에 그대로 보인다.
 */
import { hasReason } from "$lib/error-reason";
import { sameDbTarget } from "$lib/db-ai";
import type { DbConn } from "$lib/db-conn";
import type { ConnRow } from "./conn-form";
import type { DbTested } from "./query-backend";

/** 실패의 짧은 갈래 — 칩 글자(`app.query.form.test.reason.<갈래>`) */
export type ConnTestReason = "auth" | "host" | "refused" | "tls" | "timeout" | "failed";

export type ConnTestPhase =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "ok"; result: DbTested }
  | { kind: "error"; reason: ConnTestReason; message: string }
  /** 폼 값이 저장 검사를 못 지났다 — 서버에 가지 않았다(문구는 [저장] 의 폼 오류와 같다 — 테스트는 칩으로만 보인다) */
  | { kind: "invalid"; message: string }
  | { kind: "cancelled" };

/** 칩 하나의 상태 — `gen` 은 회차, `key` 는 시험을 시작할 때의 폼 열쇠 */
export interface ConnTestState {
  gen: number;
  key: string;
  phase: ConnTestPhase;
}

export function idleConnTest(gen = 0): ConnTestState {
  return { gen, key: "", phase: { kind: "idle" } };
}

/** 폼의 모든 칸 → 한 글자(칸이 바뀌었는지만 본다 — 값은 밖으로 나가지 않는다) */
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

/** 시작 — 회차를 올리고 "연결하는 중" */
export function beginConnTest(s: ConnTestState, key: string, now: number): ConnTestState {
  return { gen: s.gen + 1, key, phase: { kind: "running", startedAt: now } };
}

/** 폼이 틀렸다 — 서버에 가지 않고 곧바로 실패 칩(회차를 올려 도는 시도가 있으면 버린다 · 칸을 고치면 지워진다) */
export function invalidConnTest(s: ConnTestState, key: string, message: string): ConnTestState {
  return { gen: s.gen + 1, key, phase: { kind: "invalid", message } };
}

/** 지운다(취소 · 칸 바꾸기 · 폼 다시 열기) — 회차를 올려 도는 시도의 답을 버린다 */
export function resetConnTest(s: ConnTestState): ConnTestState {
  return idleConnTest(s.gen + 1);
}

/** 칸이 바뀌었다 — 칩이 있으면(도는 중 포함) 지운다. 그대로면 같은 상태 */
export function onConnFormChange(s: ConnTestState, key: string): ConnTestState {
  return s.phase.kind !== "idle" && s.key !== key ? resetConnTest(s) : s;
}

/** 답이 왔다 — 회차가 지금 것이고 아직 도는 중일 때만 받는다(아니면 그대로 — 버린다) */
export function finishConnTest(s: ConnTestState, gen: number, phase: ConnTestPhase): ConnTestState {
  return gen === s.gen && s.phase.kind === "running" ? { ...s, phase } : s;
}

/** 도는 중의 지난 초(내림 · 0 부터) */
export function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

// OS · 드라이버의 고정 조각 — 번호는 OS 언어와 무관하다(Windows WSA 번호 · POSIX errno). 문구 조각은 드라이버(영어 고정)와 앱 문구(한 · 영).
const TIMEOUT = /os error (10060|110)\b|timed? ?out|timeout|시간이 초과|시간 초과/i;
const HOST = /os error (11001|11002|11004|-2|-3)\b|no such host|failed to lookup address|name or service not known|nodename nor servname|호스트를 찾을 수 없|알려진 호스트가 없/i;
const REFUSED = /os error (10061|111)\b|connection refused|actively refused|거부/i;
const TLS = /\bTLS\b|\bSSL\b|certificate|인증서|인증 기관/i;

/**
 * 실패 문구 → 짧은 갈래 — **이유 접두어를 떼기 전** 문자열을 준다(없으면 뗀 것이라도). 순서: 인증 → 시간 초과 → 호스트 → 거절 → TLS →
 * 그 밖(네트워크 갈래를 TLS 보다 먼저 — "인증서를 확인하려고 붙지 못했습니다: 연결 거절" 은 거절이다).
 */
export function connTestReason(message: string): ConnTestReason {
  if (hasReason(message, "db-auth") || hasReason(message, "db-password")) return "auth";
  if (TIMEOUT.test(message)) return "timeout";
  if (HOST.test(message)) return "host";
  if (REFUSED.test(message)) return "refused";
  if (TLS.test(message)) return "tls";
  return "failed";
}

/** 테스트 한 번의 열쇠 — 서버가 비밀번호를 묻는 동안 경유 전송로를 이 열쇠에 세워 둔다(`dbtest-` 머리만 받는다) */
export function newConnTestStream(rand: () => number = Math.random): string {
  const part = () => Math.floor(rand() * 0x100000000).toString(36);
  return `dbtest-${part()}${part()}`;
}

/**
 * 볼트 잠금 해제를 물을까 — 저장된 연결을 편집 중(`orig` — 새 연결이면 `null`)이고 같은 id 이며 대상(엔진 · 경유 · 주소 · 포트 · DB ·
 * 사용자 · 파일)이 그대로일 때만. **판단의 진실은 서버**다 — 이것은 묻는 창을 띄울지만 정한다.
 */
export function connTestMayUseVault(orig: DbConn | null, draft: DbConn): boolean {
  return orig !== null && orig.id === draft.id && sameDbTarget(orig, draft);
}

/** 칩 하나의 그림 — `mark` = 앞 표식(돌기 · ✓ · ✕ · 없음), `label` = 칩 글자, `detail` = 말풍선(여러 줄 — 실패는 서버 문구 전체) */
export interface ConnTestChip {
  mark: "spin" | "ok" | "err" | "none";
  label: string;
  detail: string;
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** 상태 → 칩(없음이면 `null`) — 글자는 부르는 쪽 `tr`(i18n 키 `app.query.form.test.*`) */
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
