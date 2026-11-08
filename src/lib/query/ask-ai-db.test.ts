import { describe, expect, it } from "vitest";
import { ASK_SQL_MAX, buildDbAskText, clipHead, dbAskSummary, type DbAskInput } from "./ask-ai-db";

/**
 * 쿼리 타일 "AI 에 묻기"(쿼리 타일 3b) — 넘길 글. 사전은 열쇠를 그대로 돌려주는 가짜(`tr`)로 — 칸이 어디에 들어가는지만 본다.
 */
const tr = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

function input(over: Partial<DbAskInput> = {}): DbAskInput {
  return {
    connId: "Ab3dEf9hJk2L",
    connName: "운영 DB",
    engine: "PostgreSQL",
    database: "app",
    level: "read",
    sql: "SELECT id FROM users WHERE email = 'x'",
    selection: false,
    error: null,
    ...over,
  };
}

describe("buildDbAskText", () => {
  it("연결(이름 · 엔진 · DB · connId · 단계) · SQL 펜스 · 끝 줄바꿈 하나", () => {
    const s = buildDbAskText(input(), tr);
    expect(s.startsWith("pane.query.ask.lead\n")).toBe(true);
    expect(s).toContain("name=운영 DB");
    expect(s).toContain("engine=PostgreSQL");
    expect(s).toContain("id=Ab3dEf9hJk2L");
    expect(s).toContain("level=pane.query.ask.level.read");
    expect(s).toContain("database=pane.query.ask.database(name=app)");
    expect(s).toContain("pane.query.ask.sql.editor\n```sql\nSELECT id FROM users WHERE email = 'x'\n```");
    expect(s.endsWith("```\n")).toBe(true);
  });

  it("선택 영역 · 마지막 오류(한 줄로) · 빈 편집기", () => {
    const s = buildDbAskText(input({ selection: true, error: 'relation "x"\n does not exist' }), tr);
    expect(s.startsWith("pane.query.ask.lead.error")).toBe(true);
    expect(s).toContain("pane.query.ask.sql.selection");
    expect(s).toContain('pane.query.ask.error(message=relation "x" does not exist)');
    expect(buildDbAskText(input({ sql: "  \n " }), tr)).toContain("pane.query.ask.sql.none");
  });

  it("**결과 행의 값은 넣을 자리가 없다** — 입력 칸이 연결 · SQL · 오류뿐이고, 글은 그것들로만 짓는다", () => {
    // 입력 칸 — 행 · 칸 값을 받는 칸이 없다(형으로 지킨다). 새 칸이 생기면 이 목록과 머리말 근거를 함께 고친다.
    expect(Object.keys(input()).sort()).toEqual(["connId", "connName", "database", "engine", "error", "level", "selection", "sql"]);
    const s = buildDbAskText(input({ sql: "SELECT 1", error: null }), tr);
    const lines = s.trimEnd().split("\n");
    expect(lines).toEqual([
      "pane.query.ask.lead",
      expect.stringContaining("pane.query.ask.conn("),
      "pane.query.ask.sql.editor",
      "```sql",
      "SELECT 1",
      "```",
    ]);
  });

  it("긴 SQL 은 앞 8 KB 까지 · 잘렸다고 적는다 · 제어 문자(ESC)는 걷는다", () => {
    const long = "SELECT '" + "가".repeat(5000) + "'";
    const s = buildDbAskText(input({ sql: long }), tr);
    expect(s).toContain(`pane.query.ask.sql.cut(kb=${ASK_SQL_MAX / 1024})`);
    expect(new TextEncoder().encode(s).length).toBeLessThan(ASK_SQL_MAX + 1024);
    const esc = buildDbAskText(input({ sql: "SELECT 1\u001b[201~; rm -rf /" }), tr);
    expect(esc).not.toContain("\u001b");
  });

  it("clipHead · 요약", () => {
    expect(clipHead("abc", 10)).toEqual(["abc", false]);
    expect(clipHead("가나다", 7)).toEqual(["가나", true]);
    expect(dbAskSummary("운영 DB", "\n  SELECT * FROM t\nWHERE 1")).toBe("운영 DB · SELECT * FROM t");
    expect(dbAskSummary("운영 DB", "")).toBe("운영 DB");
    expect(dbAskSummary("a", "x".repeat(40), 10)).toBe("a · " + "x".repeat(9) + "…");
  });
});
