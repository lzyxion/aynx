/**
 * **쿼리 타일의 트랜잭션 작업** — 화면 규칙(쿼리 타일 1단계 — 10-13 결정, docs/log/2026-10-13-db-write-mcp-design.md). 순수(시각 ·
 * 서버 호출 · 묻는 창은 주입).
 *
 * 작업은 **앱이 소유한다** — 쓰기 모드에서 [트랜잭션 작업 시작] 으로 열고, 문장은 지금처럼 하나씩(같은 연결 · 같은 트랜잭션 — SELECT
 * 로 확인 가능), [커밋] · [되돌리기] 로만 끝난다. 끝나면 대기다(새 작업을 저절로 열지 않는다). 사람이 친 `BEGIN` · `COMMIT` 은 서버
 * 가드가 계속 거절한다.
 *
 * - 상태는 서버의 것이다(`db::tx::TxView` — 세션 서버 `db_tx` · `db_query` · `db_open` 의 `tx` · 이벤트 `db-state {state: "tx"}`).
 *   화면은 받은 순간(`at`)을 함께 적어 두고 그 뒤 흐른 시간만 더한다(프로세스끼리 시계를 맞추지 않는다).
 * - **방치 상한**(무활동 10분 · 1분 전 경고)의 시계도 서버에 있다 — 화면의 시계는 표시일 뿐이고, 경고 · 되돌림은 서버 이벤트로 온다.
 *   [연장] 은 그 시계를 새로 재게 한다(상태 조회 · 트리 새로 고침은 시계를 늘리지 않는다).
 * - 끝난 뒤의 셋(`errorRolledBack` · `unknown` · `disconnected`)은 다음 작업을 열 때까지 눈에 띄게 남는다. 커밋 · 되돌림 · 방치
 *   되돌림은 결과 알림 한 줄.
 */
import type { DbTxEnded, DbTxView } from "./query-backend";

/** 화면이 쥔 작업 상태 — 서버의 꼴 + 받은 순간(ms, `Date.now()`) */
export interface TxSeen {
  view: DbTxView;
  at: number;
}

/** 작업이 열려 있는가(끝내는 중 포함 — 그동안도 상태를 깨는 조작은 막는다) */
export function txOpen(t: TxSeen | null): boolean {
  return t !== null && (t.view.state === "open" || t.view.state === "ending");
}

/** 지금 화면이 아는 작업 id — 문장 · 끝내기 · 연장에 싣는다(0 = 작업 없음) */
export function txIdOf(t: TxSeen | null): number {
  return txOpen(t) ? t!.view.id : 0;
}

/** `ms` → `00:42` · `12:05` · `1:02:03` */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** 실행 줄의 작업 상태(`● 트랜잭션 · 3문장 · 00:42`) — 열린 작업이 없으면 `null` */
export interface TxChip {
  statements: number;
  /** 시작 뒤 흐른 시간 */
  elapsed: string;
  /** 방치 상한까지 남은 시간(ms) */
  idleLeftMs: number;
  /** 1분 전 경고 — 강조와 [연장] */
  warn: boolean;
  /** 커밋 · 되돌리기를 보냈다(단추를 막는다) */
  ending: boolean;
}

export function txChip(t: TxSeen | null, now: number): TxChip | null {
  if (!t || !txOpen(t)) return null;
  const passed = Math.max(0, now - t.at);
  const left = Math.max(0, (t.view.idleLeftMs ?? t.view.idleLimitMs) - passed);
  return {
    statements: t.view.statements,
    elapsed: formatClock((t.view.startedAgoMs ?? 0) + passed),
    idleLeftMs: left,
    warn: t.view.warn || left <= t.view.warnMs,
    ending: t.view.state === "ending",
  };
}

/** 실행 줄 작업 단추들의 모양 — `running` = 문장이 도는 중 · `busy` = 작업 op 를 보낸 중 */
export interface TxButtons {
  /**
   * [트랜잭션 작업 시작] — 쓰기 모드 · 작업 없음이면 보인다. **수동 커밋(자동 커밋 끔)에서도 남는다**(Codex 검토 반영 2 — 끔이면 변경
   * 문장이 작업을 저절로 열지만, 조회부터 한 작업으로 묶거나 `SELECT … FOR UPDATE` 로 먼저 잠그려면 명시적으로 연다)
   */
  begin: { shown: boolean; disabled: boolean };
  /** [커밋] · [되돌리기] — 작업이 열려 있을 때만 */
  end: { shown: boolean; disabled: boolean };
  /** [연장] — 경고 중일 때만 */
  extend: { shown: boolean; disabled: boolean };
}

export function txButtons(o: {
  writable: boolean;
  tx: TxSeen | null;
  now: number;
  running: boolean;
  busy: boolean;
  connected: boolean;
}): TxButtons {
  const open = txOpen(o.tx);
  const chip = txChip(o.tx, o.now);
  const blocked = !o.connected || o.busy || o.running;
  return {
    begin: { shown: o.writable && !open, disabled: blocked },
    end: { shown: open, disabled: blocked || (chip?.ending ?? false) },
    extend: { shown: open && (chip?.warn ?? false), disabled: !o.connected || o.busy || (chip?.ending ?? false) },
  };
}

/** 끝난 작업의 알림 — `notice` = 결과 알림 한 줄(조용히) · `alert` = 눈에 띄게(사람이 닫을 때까지) */
export interface TxEndNote {
  level: "notice" | "alert";
  /** i18n 열쇠(`pane.query.tx.ended.*`) */
  key:
    | "pane.query.tx.ended.committed"
    | "pane.query.tx.ended.rolledBack"
    | "pane.query.tx.ended.idleRolledBack"
    | "pane.query.tx.ended.errorRolledBack"
    | "pane.query.tx.ended.unknown"
    | "pane.query.tx.ended.disconnected";
  statements: number;
  /** 서버가 실은 사연(엔진 오류 · 결과 불명의 까닭) */
  message?: string;
}

export function txEndNote(e: DbTxEnded): TxEndNote {
  const base = { statements: e.statements, message: e.message };
  switch (e.outcome) {
    case "committed":
      return { level: "notice", key: "pane.query.tx.ended.committed", ...base };
    case "rolledBack":
      return { level: "notice", key: "pane.query.tx.ended.rolledBack", ...base };
    case "idleRolledBack":
      return { level: "alert", key: "pane.query.tx.ended.idleRolledBack", ...base };
    case "errorRolledBack":
      return { level: "alert", key: "pane.query.tx.ended.errorRolledBack", ...base };
    case "unknown":
      return { level: "alert", key: "pane.query.tx.ended.unknown", ...base };
    case "disconnected":
      return { level: "alert", key: "pane.query.tx.ended.disconnected", ...base };
  }
}

/**
 * 새로 받은 상태가 **새 결과**를 알리는가 — 같은 끝난 작업을 두 번 알리지 않게(응답 · 이벤트 · 상태 조회가 같은 결과를 실어 온다).
 * 알린 작업 id 를 부르는 쪽이 들고 있다.
 */
export function freshEnded(view: DbTxView, announced: number | null): DbTxEnded | null {
  const e = view.ended;
  if (!e || e.id === announced) return null;
  return e;
}

/**
 * [실행] · [스크립트 실행] 을 막을 때인가(Codex 검토 반영 2) — 도는 문장 · 작업 op(시작 · 커밋 · 되돌리기 · 연장)를 보낸 중 · 쓰기 ·
 * 자동 커밋을 바꾸는 중 · 끝내는 중. 서버도 같은 순간을 바쁨으로 거절하지만(연결별 조정 장치 — 판 15), 화면이 먼저 막아 커밋과 실행이
 * 엇갈려 보이지 않게 한다.
 */
export function runBlocked(o: { connected: boolean; running: boolean; txBusy: boolean; switching: boolean; tx: TxSeen | null }): boolean {
  return !o.connected || o.running || o.txBusy || o.switching || o.tx?.view.state === "ending";
}

/**
 * [커밋] · [되돌리기] 를 보낸다 — 화면에도 **끝내는 중**을 적는다(Codex 검토 반영 2). 그래야 그 답이 오기 전에 끊김 이벤트가 먼저 닿아도
 * [`txAfterDisconnect`] 가 "끊김 = 되돌림" 으로 앞질러 적지 않는다(커밋이었다면 결과 불명일 수 있다).
 */
export function txSending(t: TxSeen | null, now: number): TxSeen | null {
  if (!t || t.view.state !== "open") return t;
  return { at: now, view: { ...t.view, state: "ending" } };
}

/**
 * 보낸 [커밋] · [되돌리기] 가 **답 없이** 실패했는데 그 사이 연결을 잃었다(끊김 이벤트 · 전송 실패) — 서버에 다시 물을 수 없다. 커밋이었다면
 * 반영됐는지 모른다(`unknown` — 결과 불명 틀), 되돌리기였다면 끊김이 곧 되돌림이다(`disconnected`). 끝내는 중이 아니면 그대로.
 */
export function txEndLost(t: TxSeen | null, commit: boolean, now: number): TxSeen | null {
  if (!t || t.view.state !== "ending") return t;
  return {
    at: now,
    view: {
      ...t.view,
      id: 0,
      state: commit ? "unknown" : "disconnected",
      startedAgoMs: undefined,
      idleLeftMs: undefined,
      warn: false,
      ended: { id: t.view.id, outcome: commit ? "unknown" : "disconnected", statements: t.view.statements },
    },
  };
}

/**
 * 연결이 끊겼다(서버 이벤트 `db-state {state: "disconnected"}`) — 열린 작업이 있었으면 서버가 되돌렸다. 화면은 다시 연결하기 전까지
 * 서버에 물을 수 없으니 그 결과를 스스로 적는다(다시 열면 새 연결이라 작업은 없다).
 */
export function txAfterDisconnect(t: TxSeen | null, now: number): TxSeen | null {
  // 끝내는 중(커밋을 보냄)이면 그 답(결과 불명 등)이 따로 온다 — 여기서 앞질러 적지 않는다.
  if (!t || t.view.state !== "open") return t;
  return {
    at: now,
    view: {
      ...t.view,
      id: 0,
      state: "disconnected",
      startedAgoMs: undefined,
      idleLeftMs: undefined,
      warn: false,
      ended: { id: t.view.id, outcome: "disconnected", statements: t.view.statements },
    },
  };
}
