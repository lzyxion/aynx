/**
 * **쿼리 타일의 스크립트 실행** — 화면 규칙(쿼리 타일 2단계 — 10-13 결정, docs/log/2026-10-13-db-write-mcp-design.md). 순수.
 *
 * [실행](`Ctrl+Enter`)은 지금처럼 **문장 하나**(선택 영역 · 없으면 커서의 문장 — `statement-at`), [스크립트 실행](`Alt+X` — DBeaver
 * 관례)은 **여러 문장을 한 요청**으로 보낸다: 선택 영역이 있으면 그것, 없으면 편집기 글 전체. 나누기 · 검증 · 실행은 세션 서버가 한다
 * (`db::script` — 문장 경계도 서버의 렉서가 최종 판정이다. 여기 `statement-at` 과 어긋나면 서버 기준).
 *
 * 서버의 약속(화면이 그대로 밝힌다):
 * - 실행 **전에** 모든 문장을 검사한다 — 하나라도 거절이면 아무것도 실행하지 않는다(`refused`).
 * - 쓰기 모드면 **한 트랜잭션** — 첫 오류에서 멈추고 **전부 되돌린다**, 모두 성공하면 커밋.
 * - 읽기 전용이면 여러 조회를 `READ ONLY` 트랜잭션 하나로(늘 되돌림 — 바뀌는 것 없음).
 * - 트랜잭션 작업이 열려 있으면 **그 작업 안에서** 차례로(커밋하지 않는다 — [커밋] 은 사람이). 실행 한 번이 세이브포인트 하나다
 *   (10-14 결정 — 세 엔진 공통): 첫 오류 · 멈춤이면 **이번 실행분만** 되돌리고 작업은 그대로 열려 있다(`workUndone`). 엔진이 트랜잭션
 *   전체를 끝낸 경우(교착 · SQLite 되감김 · 끊김)만 작업이 끝난다(`workEnded`).
 * - 자동 커밋을 끈 쓰기 타일(`query/auto-commit`)은 작업이 없어도 커밋하지 않는다 — 바꾸는 문장이 있으면 서버가 작업을 저절로 열고 그
 *   안에서, 조회만이면 `READ ONLY` 트랜잭션 하나로(작업을 열지 않는다).
 */
import type { DbScriptResult } from "./query-backend";

/** [스크립트 실행] 이 보낼 글 — 선택 영역(공백만이 아니면), 아니면 글 전체. 보낼 것이 없으면 `null` */
export function scriptTarget(sql: string, sel: { from: number; to: number }): { from: number; to: number; text: string } | null {
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (to > from && sql.slice(from, to).trim() !== "") return { from, to, text: sql.slice(from, to) };
  if (sql.trim() === "") return null;
  return { from: 0, to: sql.length, text: sql };
}

/** 요약 줄의 색 — `ok`(커밋 · 끝까지) · `info`(읽기 전용 · 작업 안 — 커밋 전) · `err`(되돌림 · 거절 · 결과 불명 · 끊김) */
export type ScriptTone = "ok" | "info" | "err";

/** 요약 줄 — i18n 열쇠(`pane.query.script.sum.*`)와 값. `n` = 계획한 문장 수 · `done` = 성공한 수 · `k` = 멈춘 문장(1 기준) */
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
  // 자동 커밋 끔 · 작업 없음에서 이 실행이 작업을 저절로 열었고 첫 오류 · 멈춤으로 그 작업까지 닫혔다(10-14 실기 — "작업 유지" 가
  // 아니다). 서버는 `rolledBack` + `workClosed` 로 알리고, 그 전 서버(판 15 그대로)는 `workUndone` 인데 작업 칸이 열려 있지 않다.
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
      // 판 15 — 조회만 든 줄 안 스크립트의 한 문장이 데이터를 바꿔 엔진이 거절했다(다시 돌지 않았다 — 화면이 [트랜잭션 작업 시작] 을 단다).
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
      // 판 13 — 이번 실행분만 세이브포인트로 되돌렸다(작업은 열림 · 앞서 쌓은 변경은 그대로).
      return s("err", r.reason === "error" || !r.reason ? "pane.query.script.sum.workUndone" : "pane.query.script.sum.workUndoneStopped");
    case "workEnded":
      // 멈춘 문장(오류 · 취소 · 시한 — PG 는 그때 작업 전체를 되돌린다)이 있으면 되돌림, 없으면 문장이 작업을 스스로 끝냈다(결과 불명).
      return s("err", r.reason ? "pane.query.script.sum.workEnded" : "pane.query.script.sum.workEndedUnknown");
  }
}

/**
 * 편집기에서 짚을 자리 — 서버의 자리는 **보낸 글** 안의 UTF-16 위치라 보낸 글의 시작(`base` — 선택 영역이면 그 시작)을 더한다. 보낸 뒤
 * 편집기 글이 바뀌었으면(`same` 이 거짓) 짚지 않는다(엉뚱한 곳을 고르지 않게).
 */
export function editorRange(row: { start: number; end: number }, base: number, same: boolean): { from: number; to: number } | null {
  if (!same) return null;
  return { from: base + row.start, to: base + row.end };
}
