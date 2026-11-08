import { describe, expect, it } from "vitest";
import type { DbDialect, DbObject, DbTableDetail } from "./query-backend";
import { blockInsert, definitionName, definitionTarget, sameTarget } from "./definition";
import type { DetailLeaf, TreeRow } from "./schema-tree";

const obj = (schema: string, object: DbObject): TreeRow => ({ type: "object", key: "k", level: 1, schema, object, expandable: false, expanded: false });
const leaf = (schema: string, table: string, l: DetailLeaf): TreeRow => ({ type: "leaf", key: "k", level: 3, schema, table, leaf: l });

const fk: DbTableDetail["foreignKeys"][number] = {
  name: "fk_c",
  schema: "sales",
  table: "lines",
  columns: ["order_id"],
  refSchema: "public",
  refTable: "orders",
  refColumns: ["id"],
};

describe("DDL 보기 — 어느 줄에 서나", () => {
  it("폴더의 객체 — 방언이 받는 종류만 · 함수는 인자까지", () => {
    expect(definitionTarget("postgres", obj("public", { kind: "function", name: "f", args: "a integer" }))).toEqual({
      schema: "public",
      kind: "function",
      name: "f",
      args: "a integer",
    });
    expect(definitionTarget("postgres", obj("public", { kind: "type", name: "e", sub: "enum" }))?.kind).toBe("type");
    expect(definitionTarget("mysql", obj("shop", { kind: "procedure", name: "p", args: "" }))?.args).toBe("");
    expect(definitionTarget("mysql", obj("shop", { kind: "sequence", name: "s" }))?.kind).toBe("sequence");
    expect(definitionTarget("sqlite", obj("main", { kind: "view", name: "v" }))).toEqual({ schema: "main", kind: "view", name: "v" });
  });

  it("테이블 아래 잎 — 인덱스 · 트리거 · 제약 · 외래 키 · 파티션(엔진마다)", () => {
    const idx: DetailLeaf = { part: "indexes", item: { name: "i", columns: ["a"], unique: false, primary: false } };
    const trg: DetailLeaf = { part: "triggers", item: { name: "t", detail: "BEFORE INSERT" } };
    const con: DetailLeaf = { part: "constraints", item: { name: "c", type: "check", columns: [] } };
    const anon: DetailLeaf = { part: "constraints", item: { type: "primary", columns: ["id"] } };
    expect(definitionTarget("postgres", leaf("public", "orders", idx))).toEqual({ schema: "public", kind: "index", name: "i", table: "orders" });
    expect(definitionTarget("sqlite", leaf("main", "orders", idx))?.kind).toBe("index");
    expect(definitionTarget("mysql", leaf("shop", "orders", idx)), "MySQL 인덱스는 테이블 정의 안").toBeNull();
    for (const d of ["postgres", "mysql", "sqlite"] as DbDialect[]) {
      expect(definitionTarget(d, leaf("s", "orders", trg))).toEqual({ schema: "s", kind: "trigger", name: "t", table: "orders" });
    }
    expect(definitionTarget("postgres", leaf("public", "orders", con))?.kind).toBe("constraint");
    expect(definitionTarget("mysql", leaf("shop", "orders", con))).toBeNull();
    expect(definitionTarget("postgres", leaf("public", "orders", anon)), "이름 없는 제약").toBeNull();
    // 외래 키는 가리키는 쪽 테이블의 제약 — 참조됨이면 다른 테이블.
    expect(definitionTarget("postgres", leaf("public", "orders", { part: "referencedBy", item: fk }))).toEqual({
      schema: "sales",
      kind: "constraint",
      name: "fk_c",
      table: "lines",
    });
    expect(definitionTarget("sqlite", leaf("main", "orders", { part: "foreignKeys", item: { ...fk, name: undefined } }))).toBeNull();
    expect(definitionTarget("postgres", leaf("public", "logs", { part: "partitions", item: { schema: "p", name: "logs_1" } }))).toEqual({
      schema: "p",
      kind: "table",
      name: "logs_1",
    });
  });

  it("컬럼 · 스키마 · 폴더 · 안내 줄에는 없다", () => {
    const col: TreeRow = { type: "column", key: "k", level: 3, schema: "s", column: { name: "a", type: "int", notNull: false, default: null, pk: 0 } };
    expect(definitionTarget("postgres", col)).toBeNull();
    expect(definitionTarget("postgres", { type: "schema", key: "k", level: 0, schema: "s", expanded: false })).toBeNull();
    expect(definitionTarget("postgres", { type: "note", key: "k", level: 0, note: "empty" })).toBeNull();
  });
});

describe("DDL 보기 — 이름 · 같은 대상", () => {
  it("머리줄 이름 — 스키마 · 딸린 테이블 · 인자, SQLite main 생략", () => {
    expect(definitionName("postgres", { schema: "public", kind: "function", name: "f", args: "a integer" })).toBe("public.f(a integer)");
    expect(definitionName("postgres", { schema: "public", kind: "trigger", name: "t", table: "orders" })).toBe("public.orders.t");
    expect(definitionName("postgres", { schema: "public", kind: "index", name: "i", table: "orders" })).toBe("public.i");
    expect(definitionName("sqlite", { schema: "main", kind: "table", name: "t" })).toBe("t");
    expect(definitionName("sqlite", { schema: "aux", kind: "table", name: "t" })).toBe("aux.t");
  });

  it("같은 대상 — 겹지정 함수는 인자가 가른다", () => {
    const a = { schema: "s", kind: "function" as const, name: "f", args: "a integer" };
    expect(sameTarget(a, { ...a })).toBe(true);
    expect(sameTarget(a, { ...a, args: "a text" })).toBe(false);
    expect(sameTarget(null, a)).toBe(false);
  });
});

describe("편집기에 넣기 — 앞뒤 글과 붙지 않게", () => {
  const sql = "CREATE TABLE t (a int);";
  it("빈 편집기 · 줄 머리 · 줄 가운데 · 뒤에 글", () => {
    expect(blockInsert("", 0, sql)).toBe(`${sql}\n`);
    expect(blockInsert("SELECT 1;\n", 10, sql)).toBe(`\n${sql}\n`);
    expect(blockInsert("SELECT 1;\n\n", 11, sql)).toBe(`${sql}\n`);
    expect(blockInsert("SELECT 1;", 9, sql)).toBe(`\n\n${sql}\n`);
    expect(blockInsert("SELECT 1;\nSELECT 2;", 10, `${sql}\n\n`)).toBe(`\n${sql}\n\n`);
    expect(blockInsert("ab", 1, sql)).toBe(`\n\n${sql}\n\n`);
    expect(blockInsert("ab", 99, sql)).toBe(`\n\n${sql}\n`);
  });
});
