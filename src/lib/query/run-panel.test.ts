import { describe, expect, it } from "vitest";
import type { DbQueryResult, DbScriptResult, DbScriptStmt } from "./query-backend";
import {
  doneStatus,
  hasTabBar,
  initialPick,
  initialTab,
  lineMarks,
  oneLine,
  panelCounts,
  queryErrorPanel,
  queryPanel,
  resultTabs,
  runMarks,
  scriptPanel,
  strongerStatus,
} from "./run-panel";

// 문장 셋 — 자리는 이 글 안의 것(서버가 주는 것과 같은 규칙: 첫 코드 글자 ~ 마지막 코드 글자, 끝 `;` 없음)
const SQL = "UPDATE a SET x = 1;\nINSERT INTO a VALUES (1);\nUPDATE a\n  SET x = 3;";
const S0 = { start: 0, end: 18 };
const S1 = { start: 20, end: 44 };
const S2 = { start: 46, end: 66 };

function stmt(index: number, at: { start: number; end: number }, over: Partial<DbScriptStmt> = {}): DbScriptStmt {
  return { index, ...at, keyword: "UPDATE", columns: [], rows: [], truncated: false, cellTruncated: false, affected: 1, elapsedMs: 2, ...over };
}

function res(over: Partial<DbScriptResult> = {}): DbScriptResult {
  return { outcome: "committed", total: 3, results: [stmt(0, S0), stmt(1, S1), stmt(2, S2)], elapsedMs: 9, ...over };
}

const q = (over: Partial<DbQueryResult> = {}): DbQueryResult => ({
  columns: [],
  rows: [],
  truncated: false,
  cellTruncated: false,
  elapsedMs: 4,
  ...over,
});

describe("문장 자리 — 시험 글의 자리가 렉서와 같다", () => {
  it("S0 · S1 · S2", () => {
    expect(SQL.slice(S0.start, S0.end)).toBe("UPDATE a SET x = 1");
    expect(SQL.slice(S1.start, S1.end)).toBe("INSERT INTO a VALUES (1)");
    expect(SQL.slice(S2.start, S2.end)).toBe("UPDATE a\n  SET x = 3");
  });
});

describe("doneStatus — 성공한 문장들의 상태는 실행의 끝이 정한다", () => {
  it("남는 것 · 되돌려진 것 · 결과 불명", () => {
    expect(doneStatus(res())).toBe("ok");
    expect(doneStatus(res({ outcome: "readOnly" }))).toBe("ok");
    expect(doneStatus(res({ outcome: "work" }))).toBe("ok");
    expect(doneStatus(res({ outcome: "rolledBack", reason: "error" }))).toBe("undone");
    expect(doneStatus(res({ outcome: "workUndone", reason: "error", tx: { state: "open" } as never }))).toBe("undone");
    expect(doneStatus(res({ outcome: "disconnected" }))).toBe("undone");
    expect(doneStatus(res({ outcome: "workEnded", reason: "error" }))).toBe("undone");
    expect(doneStatus(res({ outcome: "workEnded" }))).toBe("unknown");
    expect(doneStatus(res({ outcome: "unknown" }))).toBe("unknown");
  });
  it("저절로 연 작업까지 닫힌 실행은 되돌림", () => {
    expect(doneStatus(res({ outcome: "rolledBack", workClosed: true }))).toBe("undone");
  });
});

describe("scriptPanel — 목록과 자리 맞추기", () => {
  it("이번 실행만 되돌림(목업 ①) — ↶ · ✕ · ·", () => {
    const r = res({
      outcome: "workUndone",
      reason: "error",
      results: [stmt(0, S0)],
      failed: { index: 1, ...S1, message: 'duplicate key value violates unique constraint "a_pkey"' },
      tx: { state: "open" } as never,
    });
    const l = scriptPanel(r, SQL, "postgres");
    expect(l.aligned).toBe(true);
    expect(l.rows.map((x) => x.status)).toEqual(["undone", "failed", "skipped"]);
    expect(l.rows[1].message).toContain("duplicate key");
    expect(l.rows[2].sql).toBe("UPDATE a SET x = 3");
    expect(panelCounts(l)).toEqual({ ok: 0, undone: 1, failed: 1, skipped: 1, unknown: 0, affected: 0 });
  });

  it("모두 커밋(목업 ②) — 영향 행 합", () => {
    const l = scriptPanel(res(), SQL, "postgres");
    expect(l.rows.map((x) => x.status)).toEqual(["ok", "ok", "ok"]);
    expect(panelCounts(l)).toMatchObject({ ok: 3, affected: 3 });
  });

  it("실행 전 거절 — 거절한 문장 ✕ · 나머지 실행 안 함", () => {
    const l = scriptPanel(res({ outcome: "refused", results: [], failed: { index: 2, ...S2, message: "no" } }), SQL, "postgres");
    expect(l.rows.map((x) => x.status)).toEqual(["skipped", "skipped", "failed"]);
  });

  it("취소 — 서버가 멈춘 문장을 따로 싣지 않아도 성공한 문장 바로 뒤가 멈춘 자리", () => {
    const l = scriptPanel(res({ outcome: "rolledBack", reason: "cancelled", results: [stmt(0, S0)] }), SQL, "postgres");
    expect(l.rows.map((x) => x.status)).toEqual(["undone", "failed", "skipped"]);
    expect(l.rows[1].stop).toBe("cancelled");
  });

  it("서버 자리가 렉서와 어긋나면 표시하지 않는다(줄은 서버가 준 것만)", () => {
    const l = scriptPanel(res({ results: [stmt(0, { start: 1, end: 18 }), stmt(1, S1), stmt(2, S2)] }), SQL, "postgres");
    expect(l.aligned).toBe(false);
    expect(runMarks(l, 0, false)).toEqual([]);
    expect(l.rows).toHaveLength(3);
  });

  it("문장 수가 다르면 표시하지 않고 실행 안 한 수만 센다", () => {
    const l = scriptPanel(res({ total: 5, outcome: "rolledBack", reason: "error", results: [stmt(0, S0)], failed: { index: 1, ...S1, message: "x" } }), SQL, "postgres");
    expect(l.aligned).toBe(false);
    expect(l.hidden).toBe(3);
    expect(panelCounts(l).skipped).toBe(3);
  });

  it("보낸 글을 모르면(다시 붙은 요약) 첫 낱말 · 표시 없음", () => {
    const l = scriptPanel(res({ detached: true }), null, "postgres");
    expect(l.aligned).toBe(false);
    expect(l.rows[0].sql).toBe("UPDATE");
  });
});

describe("단문", () => {
  it("성공 — 한 줄짜리 · 거터 ✓ 만(바탕 없음)", () => {
    const l = queryPanel(q({ affected: 2 }), "UPDATE a SET x = 1");
    expect(l.rows).toHaveLength(1);
    expect(runMarks(l, 10, true)).toEqual([{ from: 10, to: 28, status: "ok", tint: false }]);
  });

  it("실패 — ✕ 와 바탕 · 결과 불명은 ? 만", () => {
    const e = queryErrorPanel("error", "boom", "SELECT x")!;
    expect(runMarks(e, 0, true)).toEqual([{ from: 0, to: 8, status: "failed", tint: true, message: "boom" }]);
    const u = queryErrorPanel("unconfirmed", "lost", "UPDATE a")!;
    expect(runMarks(u, 0, true)[0]).toMatchObject({ status: "unknown", tint: false });
  });

  it("문장 탓이 아닌 실패는 목록 없음", () => {
    expect(queryErrorPanel("other", "x", "SELECT 1")).toBeNull();
  });
});

describe("runMarks · lineMarks — 편집기 줄", () => {
  const lineOf = (pos: number) => SQL.slice(0, pos).split("\n").length - 1;

  it("여러 줄짜리 문장은 모든 줄에", () => {
    const l = scriptPanel(res({ outcome: "rolledBack", reason: "error", results: [stmt(0, S0), stmt(1, S1)], failed: { index: 2, ...S2, message: "bad" } }), SQL, "postgres");
    const m = lineMarks(runMarks(l, 0, false), lineOf);
    expect([...m.entries()].map(([k, v]) => [k, v.status])).toEqual([
      [0, "undone"],
      [1, "undone"],
      [2, "failed"],
      [3, "failed"],
    ]);
  });

  it("한 줄에 여럿이면 실패가 이긴다", () => {
    const one = "SELECT 1; SELECT x";
    const m = lineMarks(
      [
        { from: 0, to: 8, status: "ok", tint: true },
        { from: 10, to: 18, status: "failed", tint: true, message: "x" },
      ],
      () => 0,
    );
    expect(m.get(0)).toEqual({ status: "failed", tint: true, message: "x" });
    expect(one.length).toBe(18);
    expect(strongerStatus("ok", "skipped")).toBe("ok");
    expect(strongerStatus("undone", "unknown")).toBe("unknown");
  });

  it("편집기 시작 자리(선택 영역)를 더한다", () => {
    const l = scriptPanel(res(), SQL, "postgres");
    expect(runMarks(l, 100, false)[0]).toMatchObject({ from: 100, to: 118 });
  });
});

describe("initialPick · oneLine", () => {
  it("실패 줄 → 행을 돌려준 마지막 문장 → 없음", () => {
    const failed = scriptPanel(res({ outcome: "rolledBack", reason: "error", results: [stmt(0, S0)], failed: { index: 1, ...S1, message: "x" } }), SQL, "postgres");
    expect(initialPick(failed)).toBe(1);
    const sel = scriptPanel(res({ results: [stmt(0, S0, { columns: [{ name: "a", type: "" }] }), stmt(1, S1), stmt(2, S2)] }), SQL, "postgres");
    expect(initialPick(sel)).toBe(0);
    expect(initialPick(scriptPanel(res(), SQL, "postgres"))).toBe(-1);
  });

  it("줄바꿈 · 빈칸을 하나로 · 길면 자른다", () => {
    expect(oneLine("SELECT  a,\n  b\tFROM t")).toBe("SELECT a, b FROM t");
    expect(oneLine("x".repeat(10), 5)).toBe("xxxx…");
  });
});

describe("결과 탭 — resultTabs · hasTabBar · initialTab", () => {
  const COL = { columns: [{ name: "a", type: "" }] };
  const rowsOf = (n: number) => ({ ...COL, rows: Array.from({ length: n }, () => [1]) as never });
  // 0 = 조회 3행, 1 = 바꾸는 문장(열 없음), 2 = 조회 0행
  const mixed = () => res({ outcome: "readOnly", results: [stmt(0, S0, rowsOf(3)), stmt(1, S1), stmt(2, S2, rowsOf(0))] });

  it("행을 돌려준(열이 있는) 문장만 · 1 기준 결과 번호 · 행 수 · 목록 자리", () => {
    const tabs = resultTabs(scriptPanel(mixed(), SQL, "postgres"));
    expect(tabs.map((x) => ({ no: x.no, row: x.row, rows: x.rows }))).toEqual([
      { no: 1, row: 0, rows: 3 },
      { no: 2, row: 2, rows: 0 },
    ]);
    expect(tabs[0].sql).toBe("UPDATE a SET x = 1");
  });

  it("실패 · 실행 안 함 줄과 다시 붙은 요약(detached)은 탭이 없다", () => {
    const l = scriptPanel(
      res({ outcome: "rolledBack", reason: "error", results: [stmt(0, S0, rowsOf(2))], failed: { index: 1, ...S1, message: "x" } }),
      SQL,
      "postgres",
    );
    expect(resultTabs(l).map((x) => x.row)).toEqual([0]); // 되돌려진 조회도 결과는 볼 수 있다
    expect(resultTabs(scriptPanel(mixed(), SQL, "postgres"), true)).toEqual([]);
  });

  it("탭 줄은 문장 둘 이상인 스크립트 실행 + 결과 탭이 있을 때만 — 단문은 없다", () => {
    const l = scriptPanel(mixed(), SQL, "postgres");
    expect(hasTabBar(l, true, resultTabs(l))).toBe(true);
    const one = queryPanel(q(rowsOf(5)), "SELECT 1");
    expect(hasTabBar(one, false, resultTabs(one))).toBe(false);
    // 한 문장짜리 스크립트도 탭 없이
    const single = scriptPanel(res({ total: 1, results: [stmt(0, S0, rowsOf(1))] }), null, "postgres");
    expect(hasTabBar(single, true, resultTabs(single))).toBe(false);
    // 결과 탭이 없으면([요약] 하나뿐) 세우지 않는다
    const none = scriptPanel(res(), SQL, "postgres");
    expect(hasTabBar(none, true, resultTabs(none))).toBe(false);
    expect(hasTabBar(null, true, [])).toBe(false);
  });

  it("처음 탭 — 실패 · 결과 불명 → 요약, 모두 성공 → 마지막 결과 탭, 결과 없음 → 요약", () => {
    const ok = scriptPanel(mixed(), SQL, "postgres");
    expect(initialTab(ok, resultTabs(ok))).toBe(2);
    const failed = scriptPanel(
      res({ outcome: "rolledBack", reason: "error", results: [stmt(0, S0, rowsOf(2))], failed: { index: 1, ...S1, message: "x" } }),
      SQL,
      "postgres",
    );
    expect(initialTab(failed, resultTabs(failed))).toBe("summary");
    const unknown = scriptPanel(res({ outcome: "unknown", results: [stmt(0, S0, rowsOf(1)), stmt(1, S1), stmt(2, S2)] }), SQL, "postgres");
    expect(initialTab(unknown, resultTabs(unknown))).toBe("summary");
    const none = scriptPanel(res(), SQL, "postgres");
    expect(initialTab(none, resultTabs(none))).toBe("summary");
  });
});
