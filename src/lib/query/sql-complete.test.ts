import { describe, expect, it } from "vitest";
import {
  blankNonCode,
  filterItems,
  identText,
  relsFromObjects,
  resolveRel,
  sqlComplete,
  statementRefs,
  wordAt,
  type CompleteInput,
  type Rel,
} from "./sql-complete";

describe("statementRefs — FROM / JOIN 별칭", () => {
  const refs = (sql: string, d: "postgres" | "mysql" | "sqlite" = "postgres") => {
    const r = statementRefs(blankNonCode(sql), d);
    return { refs: r.refs, aliases: Object.fromEntries([...r.aliases].map(([k, v]) => [k, `${v.schema ?? ""}.${v.name}`])) };
  };

  it("FROM t a · FROM t AS a · JOIN · 쉼표 목록", () => {
    const r = refs("SELECT * FROM orders o, items i JOIN customers AS c ON c.id = o.cid WHERE 1");
    expect(r.refs.map((x) => x.name)).toEqual(["orders", "items", "customers"]);
    expect(r.aliases).toMatchObject({ o: ".orders", c: ".customers", i: ".items", orders: ".orders" });
  });

  it("스키마 접두 · 인용 이름 · PG 는 인용 안 한 이름을 소문자로", () => {
    const r = refs('SELECT 1 FROM Public.Orders x LEFT JOIN "Sales"."Big Table" b ON true');
    expect(r.refs).toEqual([
      { schema: "public", name: "orders" },
      { schema: "Sales", name: "Big Table" },
    ]);
    expect(r.aliases.b).toBe("Sales.Big Table");
  });

  it("MySQL · SQLite 는 접지 않는다 · 백틱", () => {
    expect(refs("SELECT * FROM `My Tab` t", "mysql").aliases.t).toBe(".My Tab");
    expect(refs("SELECT * FROM Orders", "sqlite").refs).toEqual([{ schema: null, name: "Orders" }]);
  });

  it("키워드는 별칭이 아니다 · 하위 질의 · 함수는 건너뛴다", () => {
    const r = refs("SELECT * FROM t WHERE x IN (SELECT y FROM u) ORDER BY 1");
    expect(r.refs.map((x) => x.name)).toEqual(["t", "u"]);
    expect(r.aliases.where).toBeUndefined();
    expect(refs("SELECT * FROM (SELECT 1) s, generate_series(1, 3) g").refs).toEqual([]);
  });

  it("UPDATE · INSERT INTO · 문자열 · 주석 안의 FROM 은 아니다", () => {
    expect(refs("UPDATE accounts SET a = 1").refs.map((x) => x.name)).toEqual(["accounts"]);
    expect(refs("INSERT INTO logs (a) VALUES (1)").refs.map((x) => x.name)).toEqual(["logs"]);
    expect(refs("SELECT 'FROM fake' -- FROM nope\n FROM real").refs.map((x) => x.name)).toEqual(["real"]);
  });
});

describe("wordAt", () => {
  it("낱말 · 점 앞 이름 · 인용", () => {
    expect(wordAt("SELECT o.na", 11)).toMatchObject({ from: 9, word: "na", qualifier: ["o"] });
    expect(wordAt("SELECT s.t.", 11)).toMatchObject({ word: "", qualifier: ["s", "t"] });
    expect(wordAt('SELECT "My T".', 14)).toMatchObject({ qualifier: ["My T"], plainQualifier: [false] });
    expect(wordAt("SELECT sel", 10)).toMatchObject({ from: 7, word: "sel", qualifier: null });
  });

  it("숫자 · 숫자 뒤 점은 아니다", () => {
    expect(wordAt("SELECT 12", 9)).toBeNull();
    expect(wordAt("SELECT 1.", 9)).toBeNull();
  });
});

describe("identText", () => {
  it("필요할 때만 인용", () => {
    expect(identText("orders", "postgres")).toBe("orders");
    expect(identText("Orders", "postgres")).toBe('"Orders"');
    expect(identText("Orders", "sqlite")).toBe("Orders");
    expect(identText("order", "mysql")).toBe("`order`");
    expect(identText("a b", "sqlite")).toBe('"a b"');
  });
});

const rels: Rel[] = [
  { schema: "public", name: "orders", kind: "table" },
  { schema: "public", name: "customers", kind: "table" },
  { schema: "sales", name: "orders", kind: "table" },
  { schema: "sales", name: "v_top", kind: "view" },
];
const cols: Record<string, { name: string; type: string }[]> = {
  "public.orders": [
    { name: "id", type: "integer" },
    { name: "customer_id", type: "integer" },
  ],
  "public.customers": [{ name: "name", type: "text" }],
};

function input(text: string, extra: Partial<CompleteInput> = {}): CompleteInput {
  return {
    dialect: "postgres",
    text,
    pos: text.length,
    explicit: false,
    rels,
    schemas: ["public", "sales"],
    columns: (r) => cols[`${r.schema}.${r.name}`] ?? null,
    ...extra,
  };
}

describe("sqlComplete", () => {
  it("한 글자는 저절로 뜨지 않고 Ctrl+Space 면 뜬다", () => {
    expect(sqlComplete(input("SELECT s"))).toBeNull();
    expect(sqlComplete(input("SELECT s", { explicit: true }))).not.toBeNull();
    expect(sqlComplete(input("SELECT ", { explicit: true }))?.from).toBe(7);
  });

  it("별칭 뒤 점 — 그 표의 열만(형 · 표)", () => {
    const p = sqlComplete(input("SELECT o. FROM orders o", { pos: 9 }))!;
    expect(p.items.map((i) => i.label)).toEqual(["id", "customer_id"]);
    expect(p.items[0]).toMatchObject({ kind: "column", detail: "integer · orders" });
  });

  it("표 이름 뒤 점 · 스키마.표 뒤 점 · 스키마 뒤 점 = 그 스키마의 표", () => {
    expect(sqlComplete(input("SELECT customers."))!.items.map((i) => i.label)).toEqual(["name"]);
    expect(sqlComplete(input("SELECT public.orders."))!.items.map((i) => i.label)).toEqual(["id", "customer_id"]);
    const s = sqlComplete(input("SELECT * FROM sales."))!;
    expect(s.items.map((i) => `${i.label}:${i.detail}`)).toEqual(["orders:table", "v_top:view"]);
    expect(sqlComplete(input("SELECT nope."))).toBeNull();
  });

  it("점이 아니면 문장의 표 열 + 표 + 스키마 + 키워드 · 기본 스키마 밖은 접두", () => {
    const p = sqlComplete(input("SELECT cu FROM orders", { pos: 9 }))!;
    const labels = p.items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "customer_id", "orders", "customers", "v_top", "public", "SELECT"]));
    expect(labels).not.toContain("name"); // customers 는 문장에 없다
    expect(p.items.find((i) => i.label === "v_top")).toMatchObject({ apply: "sales.v_top", detail: "view · sales" });
    expect(p.items.find((i) => i.label === "SELECT")?.apply).toBe("select"); // 소문자로 치면 소문자로
  });

  it("모르는 열은 missing · 치는 중인 표 이름은 읽지 않는다", () => {
    const p = sqlComplete(input("SELECT x. FROM sales.v_top x", { pos: 9 }))!;
    expect(p.items).toEqual([]);
    expect(p.missing).toEqual([{ schema: "sales", name: "v_top", kind: "view", known: true }]);
    expect(sqlComplete(input("SELECT * FROM unknown_tab"))!.missing).toEqual([]);
  });

  it("문자열 · 주석 안에서는 뜨지 않는다", () => {
    expect(sqlComplete(input("SELECT 'or"))).toBeNull();
    expect(sqlComplete(input("SELECT 1 -- or"))).toBeNull();
  });

  it("다른 문장의 표는 섞지 않는다", () => {
    const text = "SELECT * FROM customers;\nSELECT id FROM orders WHERE cu";
    const labels = sqlComplete(input(text))!.items.filter((i) => i.kind === "column").map((i) => i.label);
    expect(labels).toEqual(["id", "customer_id"]);
  });

  it("WHERE 칸 — 표 · 스키마 없이", () => {
    const p = sqlComplete(input("SELECT * FROM orders WHERE cu", { relations: false, keywords: ["AND"] }))!;
    expect(p.items.map((i) => i.label)).toEqual(["id", "customer_id", "AND"]);
  });
});

describe("resolveRel · relsFromObjects · filterItems", () => {
  it("스키마 없는 이름은 기본 스키마 먼저", () => {
    expect(resolveRel({ schema: null, name: "orders" }, rels, "postgres").schema).toBe("public");
    expect(resolveRel({ schema: "sales", name: "ORDERS" }, rels, "postgres")).toMatchObject({ schema: "sales", known: true });
    expect(resolveRel({ schema: null, name: "zz" }, rels, "postgres")).toMatchObject({ known: false });
  });

  it("관계 종류만 · 구체화 뷰 = view", () => {
    const r = relsFromObjects("s", {
      objects: [
        { kind: "table", name: "a" },
        { kind: "matview", name: "m" },
        { kind: "function", name: "f" },
      ],
      truncated: [],
    });
    expect(r).toEqual([
      { schema: "s", name: "a", kind: "table" },
      { schema: "s", name: "m", kind: "view" },
    ]);
  });

  it("앞부분 일치 먼저 · 포함 · 가중 · 다 친 것은 빼기", () => {
    const items = [
      { label: "AND", kind: "keyword" as const },
      { label: "brand", kind: "column" as const, boost: 2 },
      { label: "android", kind: "column" as const, boost: 2 },
      { label: "and", kind: "column" as const },
    ];
    expect(filterItems(items, "and").map((i) => i.label)).toEqual(["android", "brand"]);
    expect(filterItems(items, "", 2).map((i) => i.label)).toEqual(["brand", "android"]);
  });
});
