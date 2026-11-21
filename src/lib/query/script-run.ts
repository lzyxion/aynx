/**
 * [스크립트 실행]은 여러 문장을 한 요청으로 보낸다 — 나누기 · 검증 · 실행은 세션 서버(`db::script`)가 하고, 문장 경계도 서버 렉서가
 * 최종이다(`statement-at` 과 어긋나면 서버 기준). 서버의 약속:
 * - 하나라도 거절이면 아무것도 실행하지 않는다 · 쓰기 모드면 한 트랜잭션(첫 오류에서 전부 되돌림 · 모두 성공하면 커밋).
 * - 트랜잭션 작업 안이면 커밋하지 않고 실행 한 번이 세이브포인트 하나다 — 오류 · 멈춤이면 이번 실행분만 되돌리고 작업은 열려 있다.
 *   엔진이 트랜잭션 전체를 끝낸 경우(교착 · SQLite 되감김 · 끊김)만 작업이 끝난다(`workEnded`).
 * - 자동 커밋을 끈 쓰기 타일은 작업이 없어도 커밋하지 않는다 — 바꾸는 문장이 있으면 서버가 작업을 저절로 연다.
 */
import type { DbScriptResult } from "./query-backend";

export function scriptTarget(sql: string, sel: { from: number; to: number }): { from: number; to: number; text: string } | null {
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (to > from && sql.slice(from, to).trim() !== "") return { from, to, text: sql.slice(from, to) };
  if (sql.trim() === "") return null;
  return { from: 0, to: sql.length, text: sql };
}

export type ScriptTone = "ok" | "info" | "err";

/** `n` = 계획한 문장 수 · `done` = 성공한 수 · `k` = 멈춘 문장(1 기준) */
export interface ScriptSummary {
  tone: ScriptTone;
  key:
    | "pane.query.script.sum.committed"
    | "pane.query.script.sum.errorRolledBack"
    | "pane.query.script.sum.cancelledRolledBack"
    | "pane.query.script.sum.timedOutRolledBack"
    | "pane.query.script.sum.commitFailed"
    | "pane.query.script.sum.readOnly"
    | "pane.query.script.sum.readOnlyError"
    | "pane.query.script.sum.readOnlyStopped"
    | "pane.query.script.sum.needsWork"
    | "pane.query.script.sum.refused"
    | "pane.query.script.sum.refusedSplit"
    | "pane.query.script.sum.unknown"
    | "pane.query.script.sum.disconnected"
    | "pane.query.script.sum.work"
    | "pane.query.script.sum.workError"
    | "pane.query.script.sum.workStopped"
    | "pane.query.script.sum.workUndone"
    | "pane.query.script.sum.workUndoneStopped"
    | "pane.query.script.sum.workClosed"
    | "pane.query.script.sum.workClosedStopped"
    | "pane.query.script.sum.workEnded"
    | "pane.query.script.sum.workEndedUnknown";
  vars: { n: number; done: number; k: number };
}

export function scriptSummary(r: DbScriptResult): ScriptSummary {
  const done = r.results.length;
  const vars = { n: r.total, done, k: (r.failed?.index ?? done) + 1 };
  const s = (tone: ScriptTone, key: ScriptSummary["key"]): ScriptSummary => ({ tone, key, vars });
  // 저절로 연 작업이 첫 오류 · 멈춤으로 함께 닫혔다("작업 유지" 가 아니다). 옛 서버는 `workUndone` 인데 작업 칸이 열려 있지 않은 꼴로 알린다.
  const closed =
    (r.outcome === "rolledBack" && r.workClosed === true) || (r.outcome === "workUndone" && r.tx !== undefined && r.tx.state !== "open");
  if (closed) {
    return s("err", r.reason === "error" || !r.reason ? "pane.query.script.sum.workClosed" : "pane.query.script.sum.workClosedStopped");
  }
  switch (r.outcome) {
    case "committed":
      return s("ok", "pane.query.script.sum.committed");
    case "rolledBack":
      if (r.reason === "cancelled") return s("err", "pane.query.script.sum.cancelledRolledBack");
      if (r.reason === "timedOut") return s("err", "pane.query.script.sum.timedOutRolledBack");
      if (r.reason === "commitFailed") return s("err", "pane.query.script.sum.commitFailed");
      return s("err", "pane.query.script.sum.errorRolledBack");
    case "readOnly":
      if (r.needsWork) return s("err", "pane.query.script.sum.needsWork");
      if (r.reason === "error") return s("err", "pane.query.script.sum.readOnlyError");
      if (r.reason) return s("err", "pane.query.script.sum.readOnlyStopped");
      return s("info", "pane.query.script.sum.readOnly");
    case "refused":
      return s("err", r.failed ? "pane.query.script.sum.refused" : "pane.query.script.sum.refusedSplit");
    case "unknown":
      return s("err", "pane.query.script.sum.unknown");
    case "disconnected":
      return s("err", "pane.query.script.sum.disconnected");
    case "work":
      if (r.reason === "error") return s("err", "pane.query.script.sum.workError");
      if (r.reason) return s("err", "pane.query.script.sum.workStopped");
      return s("info", "pane.query.script.sum.work");
    case "workUndone":
      return s("err", r.reason === "error" || !r.reason ? "pane.query.script.sum.workUndone" : "pane.query.script.sum.workUndoneStopped");
    case "workEnded":
      return s("err", r.reason ? "pane.query.script.sum.workEnded" : "pane.query.script.sum.workEndedUnknown");
  }
}

/** 서버의 자리는 **보낸 글** 안의 UTF-16 위치다 — 보낸 뒤 편집기 글이 바뀌었으면 짚지 않는다 */
export function editorRange(row: { start: number; end: number }, base: number, same: boolean): { from: number; to: number } | null {
  if (!same) return null;
  return { from: base + row.start, to: base + row.end };
}
