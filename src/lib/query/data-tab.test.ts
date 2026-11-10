import { describe, expect, it } from "vitest";
import {
  andCondition,
  cellCondition,
  cleanWhere,
  dataDefTarget,
  dataSelectSql,
  dataTabTitle,
  fkColumnIndex,
  fkCondition,
  fkValues,
  nextSort,
  pageOf,
  pageSizeOf,
  rowSpan,
  sqlLiteral,
  withPageSize,
  withSort,
  withWhere,
} from "./data-tab";
import { addTab, closeTab, findDataTab, renameTab, setTabData, tabDirty, tabsFromSpec, toScripts } from "./script-tabs";
import { QUERY_DATA_WHERE_MAX, QUERY_SCRIPTS_MAX, canonDataTab, canonQueryTabs, type QueryDataTab } from "$lib/session";
import type { DbQueryResult } from "./query-backend";

const users: QueryDataTab = { kind: "table", schema: "public", name: "users" };

describe("dataSelectSql — 조회 문장", () => {
  it("엔진 셋 — 이름은 늘 인용 · 첫 쪽은 OFFSET 없음 · 탐침은 한 줄 더", () => {
    expect(dataSelectSql("postgres", users, 0, 100, true)).toBe(`SELECT * FROM "public"."users" LIMIT 101`);
    expect(dataSelectSql("mysql", { schema: "shop", name: "or`ders" }, 0, 100, true)).toBe("SELECT * FROM `shop`.`or``ders` LIMIT 101");
    expect(dataSelectSql("sqlite", { schema: "main", name: "t" }, 0, 100, true)).toBe(`SELECT * FROM "t" LIMIT 101`);
  });
  it("WHERE 는 괄호로 · 정렬 열도 인용 · 쪽은 OFFSET", () => {
    const d = { ...users, where: "id > 10 OR name = 'a'", sort: { col: "Created At", dir: "desc" as const } };
    expect(dataSelectSql("postgres", d, 2, 100, true)).toBe(
      `SELECT * FROM "public"."users" WHERE (id > 10 OR name = 'a') ORDER BY "Created At" DESC LIMIT 101 OFFSET 200`,
    );
    expect(dataSelectSql("mysql", { name: "t", sort: { col: "a`b", dir: "asc" } }, 0, 500, true)).toBe("SELECT * FROM `t` ORDER BY `a``b` ASC LIMIT 501");
  });
  it("[SQL 로 열기] 글은 쪽 크기 그대로 + `;`", () => {
    expect(dataSelectSql("postgres", users, 1, 100, false)).toBe(`SELECT * FROM "public"."users" LIMIT 100 OFFSET 100;`);
  });
  it("줄 주석이 뒤를 먹지 않게 줄을 바꿔 닫는다", () => {
    expect(dataSelectSql("postgres", { name: "t", where: "id = 1 -- 메모" }, 0, 100, true)).toBe(`SELECT * FROM "t" WHERE (id = 1 -- 메모\n) LIMIT 101`);
    expect(dataSelectSql("mysql", { name: "t", where: "id = 1 # x" }, 0, 100, true)).toBe("SELECT * FROM `t` WHERE (id = 1 # x\n) LIMIT 101");
  });
});

describe("cleanWhere", () => {
  it("빈칸 · 끝 `;` · 앞 WHERE 를 걷는다", () => {
    expect(cleanWhere("  where id = 1 ;; ")).toBe("id = 1");
    expect(cleanWhere("WHERE\tx")).toBe("x");
    expect(cleanWhere("whereabouts = 1")).toBe("whereabouts = 1");
    expect(cleanWhere("   ")).toBe("");
  });
});

describe("정렬 순환 · 쪽", () => {
  it("▲ → ▼ → 없음 · 다른 열은 ▲ 부터", () => {
    const a = nextSort(undefined, "id");
    expect(a).toEqual({ col: "id", dir: "asc" });
    const b = nextSort(a, "id");
    expect(b).toEqual({ col: "id", dir: "desc" });
    expect(nextSort(b, "id")).toBeUndefined();
    expect(nextSort(b, "name")).toEqual({ col: "name", dir: "asc" });
  });
  it("쪽 크기 + 1 줄이면 다음 있음 · 보이는 줄은 쪽 크기만", () => {
    const r = (n: number): DbQueryResult => ({ columns: [{ name: "id", type: "" }], rows: Array.from({ length: n }, (_, i) => [i]), truncated: false, cellTruncated: false, elapsedMs: 1 });
    expect(pageOf(r(101), 100).hasNext).toBe(true);
    expect(pageOf(r(101), 100).result.rows.length).toBe(100);
    expect(pageOf(r(100), 100).hasNext).toBe(false);
    expect(pageOf(r(3), 100).result.rows.length).toBe(3);
    expect(rowSpan(2, 100, 100)).toEqual({ from: 201, to: 300 });
    expect(rowSpan(0, 100, 0)).toBeNull();
  });
  it("저장 모양 손잡이 — 기본값 · 빈 값은 칸을 지운다", () => {
    expect(pageSizeOf(users)).toBe(100);
    expect(withPageSize(users, 500)).toEqual({ ...users, pageSize: 500 });
    expect(withPageSize({ ...users, pageSize: 500 }, 100)).toEqual(users);
    expect(withSort({ ...users, sort: { col: "id", dir: "asc" } }, undefined)).toEqual(users);
    expect(withWhere(users, " where a = 1; ")).toEqual({ ...users, where: "a = 1" });
    expect(withWhere({ ...users, where: "a" }, "  ")).toEqual(users);
  });
});

describe("DDL 대상 · 이름", () => {
  it("파티션은 테이블로 · 방언이 주지 않는 종류는 null", () => {
    expect(dataDefTarget("postgres", { kind: "partition", schema: "p", name: "m_2024" })).toEqual({ schema: "p", kind: "table", name: "m_2024" });
    expect(dataDefTarget("sqlite", { kind: "view", schema: "main", name: "v" })).toEqual({ schema: "main", kind: "view", name: "v" });
    expect(dataDefTarget("mysql", { kind: "matview", name: "x" })).toBeNull();
  });
  it("SQLite main 은 이름에서 뺀다", () => {
    expect(dataTabTitle("sqlite", { schema: "main", name: "t" })).toBe("t");
    expect(dataTabTitle("postgres", users)).toBe("public.users");
  });
});

describe("canonDataTab · canonQueryTabs — 데이터 탭 저장", () => {
  it("모양을 고른다 — 키 순서 · 못 쓸 곁칸은 떨어진다", () => {
    expect(canonDataTab({ name: "t", kind: "view", where: "  ", sort: { col: "", dir: "asc" }, pageSize: 7, extra: 1 })).toEqual({ kind: "view", name: "t" });
    expect(Object.keys(canonDataTab({ pageSize: 500, sort: { col: "a", dir: "desc" }, where: "x", name: "t", schema: "s", kind: "table" })!)).toEqual([
      "kind",
      "schema",
      "name",
      "where",
      "sort",
      "pageSize",
    ]);
    expect(canonDataTab({ kind: "table", name: "t", where: "x".repeat(QUERY_DATA_WHERE_MAX + 1) })).toEqual({ kind: "table", name: "t" });
  });
  it("못 쓸 데이터 칸이면 그 탭만 버린다(빈 쿼리 탭으로 바꾸지 않는다)", () => {
    expect(canonDataTab({ kind: "function", name: "f" })).toBeNull();
    expect(canonDataTab({ kind: "table", name: "" })).toBeNull();
    expect(canonDataTab({ kind: "table", name: "t", schema: 3 })).toBeNull();
    const c = canonQueryTabs({ scripts: [{ n: 1, sql: "SELECT 1" }, { n: 2, data: { kind: "nope", name: "t" } }, { n: 3, data: users }], active: 3 });
    expect(c).toEqual({ scripts: [{ n: 1, sql: "SELECT 1" }, { n: 3, data: users }], active: 3 });
  });
  it("데이터 탭 하나뿐이어도 예전 모양(sql 하나)으로 접지 않는다", () => {
    expect(canonQueryTabs({ scripts: [{ n: 1, data: users }] })).toEqual({ scripts: [{ n: 1, data: users }], active: 1 });
  });
  it("명세 ↔ 탭이 데이터 칸을 그대로 오간다 · 글 · 이름은 싣지 않는다", () => {
    const { tabs, active } = tabsFromSpec({ scripts: [{ n: 1 }, { n: 4, data: users, title: "x", sql: "SELECT 9" } as never], active: 4 });
    expect(active).toBe(4);
    expect(tabs[1]).toEqual({ n: 4, text: "", data: users });
    expect(toScripts(tabs)).toEqual([{ n: 1 }, { n: 4, data: users }]);
  });
});

describe("script-tabs — 데이터 탭 규칙", () => {
  const base = tabsFromSpec({}).tabs;
  it("객체 하나에 탭 하나 · 번호는 쿼리 탭과 함께 늘어난다(다시 쓰지 않음)", () => {
    const a = addTab(base, { data: users })!;
    expect(a.n).toBe(2);
    expect(findDataTab(a.tabs, { schema: "public", name: "users" })?.n).toBe(2);
    expect(findDataTab(a.tabs, { schema: "other", name: "users" })).toBeNull();
    expect(findDataTab(a.tabs, { schema: null, name: "users" })).toBeNull();
    const b = addTab(a.tabs, { text: "SELECT 1" })!;
    expect(b.n).toBe(3);
    expect(b.tabs[2].text).toBe("SELECT 1");
    const c = closeTab(b.tabs, 3, 2)!;
    expect(addTab(c.tabs)!.n).toBe(4);
  });
  it("● 없음 · 이름 바꾸기 없음 · 조건 바꾸기", () => {
    const a = addTab(base, { data: users })!;
    expect(tabDirty(a.tabs[1], "x")).toBe(false);
    expect(renameTab(a.tabs, 2, "새 이름")[1]).toEqual(a.tabs[1]);
    const next = setTabData(a.tabs, 2, { ...users, where: "id > 1" });
    expect(next[1].data?.where).toBe("id > 1");
    expect(setTabData(a.tabs, 1, users)[0]).toEqual(a.tabs[0]);
  });
  it("상한이면 데이터 탭도 못 연다", () => {
    let tabs = base;
    for (let i = 1; i < QUERY_SCRIPTS_MAX; i++) tabs = addTab(tabs)!.tabs;
    expect(addTab(tabs, { data: users })).toBeNull();
  });
});

describe("칸으로 거르기 · 외래 키 조건", () => {
  it("리터럴 — 숫자 그대로 · 불리언은 엔진별 · 글자는 작은따옴표(MySQL 은 \ 도 두 번) · NULL · 바이트는 없음", () => {
    expect(sqlLiteral("postgres", 42)).toBe("42");
    expect(sqlLiteral("postgres", -1.5)).toBe("-1.5");
    expect(sqlLiteral("postgres", true)).toBe("true");
    expect(sqlLiteral("mysql", true)).toBe("1");
    expect(sqlLiteral("sqlite", false)).toBe("0");
    expect(sqlLiteral("postgres", "O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral("postgres", "a\\b")).toBe("'a\\b'");
    expect(sqlLiteral("mysql", "a\\b'c")).toBe("'a\\\\b''c'");
    expect(sqlLiteral("postgres", "9007199254740993")).toBe("'9007199254740993'");
    expect(sqlLiteral("postgres", null)).toBeNull();
    expect(sqlLiteral("postgres", { $bytes: 2, hex: "abcd" })).toBeNull();
  });

  it("칸 조건 — 같다 · 다르다 · NULL 은 IS (NOT) NULL · 열 이름은 엔진별 인용 · 바이트는 null", () => {
    expect(cellCondition("postgres", "user id", 7, "eq")).toBe('"user id" = 7');
    expect(cellCondition("mysql", "name", "x", "ne")).toBe("`name` <> 'x'");
    expect(cellCondition("sqlite", "deleted_at", null, "eq")).toBe('"deleted_at" IS NULL');
    expect(cellCondition("sqlite", "deleted_at", null, "ne")).toBe('"deleted_at" IS NOT NULL');
    expect(cellCondition("postgres", "blob", { $bytes: 1, hex: "00" }, "eq")).toBeNull();
  });

  it("조건에 더하기 — 비면 새 조건만 · 있으면 (지금) AND 새 · 줄 주석이면 ) 앞에서 줄바꿈", () => {
    expect(andCondition("", '"a" = 1')).toBe('"a" = 1');
    expect(andCondition("  where b > 2; ", '"a" = 1')).toBe('(b > 2) AND "a" = 1');
    expect(andCondition("b > 2 -- 메모", '"a" = 1')).toBe('(b > 2 -- 메모\n) AND "a" = 1');
  });

  it("외래 키 값 — 그 행의 FK 열 차례 · 열이 없거나 NULL · 바이트면 null", () => {
    const cols = [{ name: "id" }, { name: "org" }, { name: "team" }];
    expect(fkValues({ columns: ["org", "team"] }, cols, [1, 10, "t1"])).toEqual([10, "t1"]);
    expect(fkValues({ columns: ["org", "team"] }, cols, [1, 10, null])).toBeNull();
    expect(fkValues({ columns: ["gone"] }, cols, [1, 10, "t1"])).toBeNull();
    expect(fkValues({ columns: ["org"] }, cols, [1, { $bytes: 1, hex: "00" }, "t1"])).toBeNull();
  });

  it("외래 키 조건 — 참조열 = 값(여러 열은 AND) · 수가 어긋나면 null", () => {
    expect(fkCondition("postgres", ["id"], [10])).toBe('"id" = 10');
    expect(fkCondition("mysql", ["org_id", "code"], [10, "A"])).toBe("`org_id` = 10 AND `code` = 'A'");
    expect(fkCondition("postgres", ["a", "b"], [1])).toBeNull();
    expect(fkCondition("postgres", [], [])).toBeNull();
  });

  it("열 → 첫 외래 키 번호", () => {
    const m = fkColumnIndex([{ columns: ["org"] }, { columns: ["org", "team"] }]);
    expect(m.get("org")).toBe(0);
    expect(m.get("team")).toBe(1);
    expect(m.has("id")).toBe(false);
  });
});
