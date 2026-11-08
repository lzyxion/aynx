import { describe, expect, it } from "vitest";
import type { DbScriptResult, DbScriptStmt, DbTxView } from "./query-backend";
import { editorRange, scriptSummary, scriptTarget } from "./script-run";

function stmt(index: number, over: Partial<DbScriptStmt> = {}): DbScriptStmt {
  return {
    index,
    start: index * 10,
    end: index * 10 + 8,
    keyword: "INSERT",
    columns: [],
    rows: [],
    truncated: false,
    cellTruncated: false,
    affected: 1,
    elapsedMs: 3,
    ...over,
  };
}

function res(over: Partial<DbScriptResult> = {}): DbScriptResult {
  return { outcome: "committed", total: 3, results: [stmt(0), stmt(1), stmt(2)], elapsedMs: 12, ...over };
}

describe("scriptTarget — [스크립트 실행] 이 보낼 글", () => {
  it("선택 영역이 있으면 그것(뒤집힌 선택도) · 없으면 글 전체", () => {
    const sql = "SELECT 1;\nSELECT 2;\nSELECT 3";
    expect(scriptTarget(sql, { from: 10, to: 19 })).toEqual({ from: 10, to: 19, text: "SELECT 2;" });
    expect(scriptTarget(sql, { from: 19, to: 10 })).toEqual({ from: 10, to: 19, text: "SELECT 2;" });
    expect(scriptTarget(sql, { from: 4, to: 4 })).toEqual({ from: 0, to: sql.length, text: sql });
  });
  it("공백뿐인 선택은 선택이 아니다 · 빈 글이면 보낼 것이 없다", () => {
    const sql = "SELECT 1;   SELECT 2";
    expect(scriptTarget(sql, { from: 9, to: 12 })?.text).toBe(sql);
    expect(scriptTarget("  \n ", { from: 0, to: 0 })).toBeNull();
  });
});

describe("scriptSummary — 요약 한 줄", () => {
  it("커밋 · 읽기 전용 · 작업 안", () => {
    expect(scriptSummary(res())).toMatchObject({ tone: "ok", key: "pane.query.script.sum.committed", vars: { n: 3, done: 3 } });
    expect(scriptSummary(res({ outcome: "readOnly" })).key).toBe("pane.query.script.sum.readOnly");
    expect(scriptSummary(res({ outcome: "readOnly" })).tone).toBe("info");
    expect(scriptSummary(res({ outcome: "work" })).key).toBe("pane.query.script.sum.work");
  });
  it("k번째 문장에서 오류 — 전부 되돌림(k 는 1 기준)", () => {
    const r = res({
      outcome: "rolledBack",
      reason: "error",
      results: [stmt(0)],
      failed: { index: 1, start: 10, end: 18, message: "dup" },
    });
    expect(scriptSummary(r)).toEqual({ tone: "err", key: "pane.query.script.sum.errorRolledBack", vars: { n: 3, done: 1, k: 2 } });
  });
  it("멈춘 까닭마다 — 취소 · 시한 · 커밋 거절", () => {
    expect(scriptSummary(res({ outcome: "rolledBack", reason: "cancelled", results: [] })).key).toBe("pane.query.script.sum.cancelledRolledBack");
    expect(scriptSummary(res({ outcome: "rolledBack", reason: "timedOut", results: [stmt(0)] }))).toMatchObject({
      key: "pane.query.script.sum.timedOutRolledBack",
      vars: { k: 2 },
    });
    expect(scriptSummary(res({ outcome: "rolledBack", reason: "commitFailed" })).key).toBe("pane.query.script.sum.commitFailed");
    expect(scriptSummary(res({ outcome: "readOnly", reason: "error" })).key).toBe("pane.query.script.sum.readOnlyError");
    expect(scriptSummary(res({ outcome: "readOnly", reason: "cancelled" })).key).toBe("pane.query.script.sum.readOnlyStopped");
    expect(scriptSummary(res({ outcome: "work", reason: "error" })).key).toBe("pane.query.script.sum.workError");
    expect(scriptSummary(res({ outcome: "work", reason: "timedOut" })).key).toBe("pane.query.script.sum.workStopped");
  });
  it("판 13 — 작업 안 실패는 이번 실행분만 되돌림(작업은 유지)", () => {
    expect(scriptSummary(res({ outcome: "workUndone", reason: "error", results: [stmt(0)] }))).toMatchObject({
      tone: "err",
      key: "pane.query.script.sum.workUndone",
      vars: { k: 2 },
    });
    expect(scriptSummary(res({ outcome: "workUndone", reason: "cancelled" })).key).toBe("pane.query.script.sum.workUndoneStopped");
    expect(scriptSummary(res({ outcome: "workUndone", reason: "timedOut" })).key).toBe("pane.query.script.sum.workUndoneStopped");
  });
  it("10-14 실기 — 저절로 연 작업의 첫 실행이 실패해 작업까지 닫혔으면 '작업 유지' 가 아니라 전부 되돌림", () => {
    const failed = { index: 1, start: 10, end: 18, message: "duplicate" };
    const tx = (state: DbTxView["state"]): DbTxView => ({ id: state === "open" ? 4 : 0, state, statements: 0, idleLimitMs: 600_000, warnMs: 60_000, warn: false });
    // 서버(이 판) — rolledBack + workClosed
    const closed = res({ outcome: "rolledBack", reason: "error", workClosed: true, results: [stmt(0)], failed, tx: tx("none") });
    expect(scriptSummary(closed)).toMatchObject({ tone: "err", key: "pane.query.script.sum.workClosed", vars: { k: 2 } });
    expect(scriptSummary({ ...closed, reason: "cancelled" }).key).toBe("pane.query.script.sum.workClosedStopped");
    expect(scriptSummary({ ...closed, reason: "timedOut" }).key).toBe("pane.query.script.sum.workClosedStopped");
    // 표지가 없는 rolledBack 은 예전 그대로(자동 커밋 켬의 쓰기 스크립트)
    expect(scriptSummary({ ...closed, workClosed: undefined }).key).toBe("pane.query.script.sum.errorRolledBack");
    // 그 전 서버 — workUndone 인데 작업 칸이 열려 있지 않다 = 닫혔다
    const old = res({ outcome: "workUndone", reason: "error", results: [stmt(0)], failed, tx: tx("none") });
    expect(scriptSummary(old).key).toBe("pane.query.script.sum.workClosed");
    // 작업이 열려 있으면 그대로 "이번 실행만"
    expect(scriptSummary({ ...old, tx: tx("open") }).key).toBe("pane.query.script.sum.workUndone");
  });
  it("거절 · 결과 불명 · 끊김 · 작업이 끝남", () => {
    const refused = res({ outcome: "refused", results: [], failed: { index: 2, start: 20, end: 26, message: "no" } });
    expect(scriptSummary(refused)).toMatchObject({ key: "pane.query.script.sum.refused", vars: { k: 3 } });
    expect(scriptSummary(res({ outcome: "refused", total: 0, results: [], message: "빈 글" })).key).toBe("pane.query.script.sum.refusedSplit");
    expect(scriptSummary(res({ outcome: "unknown", message: "lost" })).key).toBe("pane.query.script.sum.unknown");
    expect(scriptSummary(res({ outcome: "disconnected" })).tone).toBe("err");
    expect(scriptSummary(res({ outcome: "workEnded", reason: "error" })).key).toBe("pane.query.script.sum.workEnded");
    expect(scriptSummary(res({ outcome: "workEnded", reason: "cancelled" })).key).toBe("pane.query.script.sum.workEnded");
    expect(scriptSummary(res({ outcome: "workEnded" })).key).toBe("pane.query.script.sum.workEndedUnknown");
  });
  it("판 15 — 조회만 든 줄 안 스크립트의 문장이 데이터를 바꿔 거절(needsWork) — 다시 돌지 않았다는 요약", () => {
    const r = res({ outcome: "readOnly", reason: "error", needsWork: true, results: [stmt(0)], failed: { index: 1, start: 10, end: 18, message: "안내" } });
    expect(scriptSummary(r)).toMatchObject({ tone: "err", key: "pane.query.script.sum.needsWork", vars: { k: 2 } });
    // 표지가 없으면 예전 그대로(읽기 전용 오류)
    expect(scriptSummary({ ...r, needsWork: undefined }).key).toBe("pane.query.script.sum.readOnlyError");
  });
});

describe("editorRange — 편집기에서 짚을 자리", () => {
  it("보낸 글의 시작을 더한다 · 글이 바뀌었으면 짚지 않는다", () => {
    expect(editorRange({ start: 10, end: 18 }, 100, true)).toEqual({ from: 110, to: 118 });
    expect(editorRange({ start: 10, end: 18 }, 0, false)).toBeNull();
  });
});
