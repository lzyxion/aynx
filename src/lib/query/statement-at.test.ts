import { describe, expect, it } from "vitest";
import { runTarget, splitStatements, statementAt } from "./statement-at";

const texts = (sql: string, d: "sqlite" | "postgres" | "mysql" = "sqlite") =>
  splitStatements(sql, d).map((s) => sql.slice(s.start, s.end));

describe("splitStatements — 서버 가드와 같은 렉서", () => {
  it("최상위 ; 로 가르고 앞뒤 공백 · 끝 ; · 빈 문장은 뺀다", () => {
    expect(texts("  SELECT 1;\n\nSELECT 2 ;;  ")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(texts("")).toEqual([]);
    expect(texts(" ;; -- only\n/* x */")).toEqual([]);
  });

  it("따옴표 · 백틱 · 대괄호 안의 ; 는 경계가 아니다", () => {
    expect(texts("SELECT 'a;b', \"c;d\", `e;f`, [g;h]; SELECT 2")).toEqual(["SELECT 'a;b', \"c;d\", `e;f`, [g;h]", "SELECT 2"]);
    expect(texts("SELECT 'it''s;'; SELECT 3")).toEqual(["SELECT 'it''s;'", "SELECT 3"]);
  });

  it("주석 안의 ; 는 경계가 아니고, 문장 바깥의 주석은 문장에 들지 않는다", () => {
    expect(texts("-- a;b\nSELECT 1 /* ; */ + 1; /* tail; */")).toEqual(["SELECT 1 /* ; */ + 1"]);
  });

  it("PG — $tag$ · 중첩 블록 주석 · E'' 의 백슬래시", () => {
    expect(texts("SELECT $$a;b$$; SELECT $x$ ; $x$", "postgres")).toEqual(["SELECT $$a;b$$", "SELECT $x$ ; $x$"]);
    expect(texts("SELECT 1 /* a /* b; */ c; */ + 2; SELECT 2", "postgres")).toEqual(["SELECT 1 /* a /* b; */ c; */ + 2", "SELECT 2"]);
    expect(texts("SELECT E'a\\';b'; SELECT 2", "postgres")).toEqual(["SELECT E'a\\';b'", "SELECT 2"]);
    // 표준 문자열(백슬래시 아님) — 'a\' 에서 끝난다
    expect(texts("SELECT 'a\\'; SELECT 2", "postgres")).toEqual(["SELECT 'a\\'", "SELECT 2"]);
    // 식별자 안의 $ 는 표지가 아니다
    expect(texts("SELECT a$1; SELECT 2", "postgres")).toEqual(["SELECT a$1", "SELECT 2"]);
  });

  it("MySQL — # 주석 · -- 뒤 공백 · 백슬래시 이스케이프", () => {
    expect(texts("SELECT 1 # x;y\n; SELECT 2", "mysql")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(texts("SELECT 1 --1; SELECT 2", "mysql")).toEqual(["SELECT 1 --1", "SELECT 2"]);
    expect(texts("SELECT 'a\\';b'; SELECT 2", "mysql")).toEqual(["SELECT 'a\\';b'", "SELECT 2"]);
  });

  it("안 닫힌 따옴표는 끝까지가 한 문장이다", () => {
    expect(texts("SELECT 1; SELECT 'oops; SELECT 3")).toEqual(["SELECT 1", "SELECT 'oops; SELECT 3"]);
  });
});

describe("statementAt — 커서가 놓인 문장", () => {
  const sql = "SELECT 1;\n\n-- note\nSELECT 2;\nSELECT 3";
  const at = (cursor: number) => {
    const st = statementAt(sql, "sqlite", cursor);
    return st ? sql.slice(st.start, st.end) : null;
  };

  it("문장 안 · 닫는 ; 바로 뒤까지는 그 문장", () => {
    expect(at(0)).toBe("SELECT 1");
    expect(at(3)).toBe("SELECT 1");
    expect(at(9)).toBe("SELECT 1"); // ; 바로 뒤
    expect(at(sql.indexOf("SELECT 2") + 2)).toBe("SELECT 2");
    expect(at(sql.length)).toBe("SELECT 3");
  });

  it("문장 사이(빈 줄 · 주석)면 앞 문장", () => {
    expect(at(10)).toBe("SELECT 1"); // 빈 줄
    expect(at(sql.indexOf("note"))).toBe("SELECT 1");
  });

  it("앞 문장이 없으면(맨 위 공백 · 주석) 다음 문장", () => {
    const s = "  -- top\n  SELECT 9;";
    const st = statementAt(s, "sqlite", 1);
    expect(st && s.slice(st.start, st.end)).toBe("SELECT 9");
  });

  it("문장이 없으면 null", () => {
    expect(statementAt("  -- nothing", "sqlite", 3)).toBeNull();
  });
});

describe("runTarget — 선택이 먼저, 아니면 커서의 문장", () => {
  const sql = "SELECT 1; SELECT 2";
  it("공백만이 아닌 선택은 그대로(역방향 선택도)", () => {
    expect(runTarget(sql, "sqlite", { from: 10, to: 18 })?.text).toBe("SELECT 2");
    expect(runTarget(sql, "sqlite", { from: 18, to: 10 })).toEqual({ from: 10, to: 18, text: "SELECT 2" });
  });
  it("빈 · 공백 선택은 커서의 문장", () => {
    expect(runTarget(sql, "sqlite", { from: 3, to: 3 })?.text).toBe("SELECT 1");
    expect(runTarget("SELECT 1;  SELECT 2", "sqlite", { from: 9, to: 10 })?.text).toBe("SELECT 1");
  });
  it("보낼 것이 없으면 null", () => {
    expect(runTarget("", "sqlite", { from: 0, to: 0 })).toBeNull();
  });
});
