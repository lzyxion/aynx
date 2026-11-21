/**
 * 트랜잭션 작업은 앱이 소유한다 — [트랜잭션 작업 시작] 으로 열고 [커밋] · [되돌리기] 로만 끝나며, 끝나면 대기다(새 작업을 저절로 열지
 * 않는다). 사람이 친 `BEGIN` · `COMMIT` 은 서버 가드가 계속 거절한다.
 * 상태와 방치 상한의 시계는 서버의 것이다 — 화면은 받은 순간(`at`) 뒤 흐른 시간만 더하고(프로세스끼리 시계를 맞추지 않는다),
 * 경고 · 되돌림은 서버 이벤트로 온다. [연장] 만 그 시계를 새로 재게 한다.
 */
import type { DbTxEnded, DbTxView } from "./query-backend";

/** `at` = 받은 순간(ms, `Date.now()`) */
export interface TxSeen {
  view: DbTxView;
  at: number;
}

/** 끝내는 중 포함 — 그동안도 상태를 깨는 조작은 막는다 */
export function txOpen(t: TxSeen | null): boolean {
  return t !== null && (t.view.state === "open" || t.view.state === "ending");
}

/** 0 = 작업 없음 */
export function txIdOf(t: TxSeen | null): number {
  return txOpen(t) ? t!.view.id : 0;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

export interface TxChip {
  statements: number;
  elapsed: string;
  idleLeftMs: number;
  warn: boolean;
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

/** `running` = 문장이 도는 중 · `busy` = 작업 op 를 보낸 중 */
export interface TxButtons {
  /**
   * 수동 커밋(자동 커밋 끔)에서도 남는다 — 끔이면 변경 문장이 작업을 저절로 열지만, 조회부터 한 작업으로 묶거나
   * `SELECT … FOR UPDATE` 로 먼저 잠그려면 명시적으로 연다
   */
  begin: { shown: boolean; disabled: boolean };
  end: { shown: boolean; disabled: boolean };
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

export interface TxEndNote {
  level: "notice" | "alert";
  key:
    | "pane.query.tx.ended.committed"
    | "pane.query.tx.ended.rolledBack"
    | "pane.query.tx.ended.idleRolledBack"
    | "pane.query.tx.ended.errorRolledBack"
    | "pane.query.tx.ended.unknown"
    | "pane.query.tx.ended.disconnected";
  statements: number;
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

/** 같은 끝난 작업을 두 번 알리지 않게 — 응답 · 이벤트 · 상태 조회가 같은 결과를 실어 온다 */
export function freshEnded(view: DbTxView, announced: number | null): DbTxEnded | null {
  const e = view.ended;
  if (!e || e.id === announced) return null;
  return e;
}

/** 서버도 같은 순간을 바쁨으로 거절하지만, 화면이 먼저 막아 커밋과 실행이 엇갈려 보이지 않게 한다 */
export function runBlocked(o: { connected: boolean; running: boolean; txBusy: boolean; switching: boolean; tx: TxSeen | null }): boolean {
  return !o.connected || o.running || o.txBusy || o.switching || o.tx?.view.state === "ending";
}

/**
 * 화면에도 **끝내는 중**을 적는다 — 그래야 답이 오기 전에 끊김 이벤트가 먼저 닿아도 [`txAfterDisconnect`] 가 "끊김 = 되돌림" 으로
 * 앞질러 적지 않는다(커밋이었다면 결과 불명일 수 있다).
 */
export function txSending(t: TxSeen | null, now: number): TxSeen | null {
  if (!t || t.view.state !== "open") return t;
  return { at: now, view: { ...t.view, state: "ending" } };
}

/**
 * 보낸 [커밋] · [되돌리기] 가 답 없이 실패했는데 그 사이 연결을 잃었다 — 커밋이었다면 반영됐는지 모르고(`unknown`), 되돌리기였다면
 * 끊김이 곧 되돌림이다(`disconnected`).
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

/** 열린 작업이 있었으면 서버가 되돌렸다 — 다시 연결하기 전에는 서버에 물을 수 없으니 화면이 그 결과를 스스로 적는다 */
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
