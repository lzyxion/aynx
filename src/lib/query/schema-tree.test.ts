import { describe, expect, it } from "vitest";
import type { DbObjects, DbTableColumn, DbTableDetail } from "./query-backend";
import {
  columnList,
  countLabel,
  detailParts,
  findRelation,
  fkArrow,
  fkTarget,
  folderKey,
  groupFolders,
  insertText,
  keyAction,
  leafInsertText,
  leafName,
  matchSpan,
  nameMatches,
  normFilter,
  objectKey,
  partKey,
  relationFor,
  revealKeys,
  schemaKey,
  signature,
  skipSchemaLevel,
  toggled,
  visibleRows,
  withExpanded,
  type Load,
  type TreeInput,
  type TreeRow,
} from "./schema-tree";

const detail = (over: Partial<DbTableDetail> = {}): DbTableDetail => ({
  columns: [],
  indexes: [],
  constraints: [],
  foreignKeys: [],
  referencedBy: [],
  triggers: [],
  partitions: [],
  truncated: [],
  ...over,
});

const pgPublic: DbObjects = {
  objects: [
    { kind: "table", name: "users" },
    { kind: "table", name: "logs", sub: "partitioned" },
    { kind: "view", name: "v_users" },
    { kind: "function", name: "f1", args: "a integer", returns: "integer" },
    { kind: "function", name: "f1", args: "a text, b text", returns: "text" },
    { kind: "sequence", name: "users_id_seq" },
  ],
  truncated: [],
};

const ok = <T>(value: T): Load<T> => ({ state: "ok", value });

function input(over: Partial<TreeInput> = {}): TreeInput {
  return {
    dialect: "postgres",
    schemas: ["public", "audit"],
    expanded: new Set(),
    objects: new Map(),
    details: new Map(),
    ...over,
  };
}

const shape = (rows: TreeRow[]) =>
  rows.map((r) => {
    const label =
      r.type === "schema"
        ? r.schema
        : r.type === "folder"
          ? `[${r.folder.kind} ${countLabel(r.folder)}]`
          : r.type === "object"
            ? r.object.name
            : r.type === "part"
              ? `{${r.folder.part} ${countLabel(r.folder)}}`
              : r.type === "column"
                ? `.${r.column.name}`
                : r.type === "leaf"
                  ? `- ${"name" in r.leaf.item && r.leaf.item.name ? r.leaf.item.name : r.leaf.part}`
                  : `(${r.note})`;
    return `${"  ".repeat(r.level)}${label}`;
  });

describe("폴더 나누기", () => {
  it("방언의 폴더 순서 · 빈 폴더 숨김 · 개수 · 잘림 표시", () => {
    const f = groupFolders("postgres", { ...pgPublic, truncated: ["function"] });
    expect(f.map((x) => x.kind)).toEqual(["table", "view", "function", "sequence"]);
    expect(f.map(countLabel)).toEqual(["2", "1", "2+", "1"]);
  });

  it("방언 목록에 없는 종류는 버린다", () => {
    const f = groupFolders("sqlite", { objects: [{ kind: "function", name: "x" }, { kind: "view", name: "v" }], truncated: [] });
    expect(f.map((x) => x.kind)).toEqual(["view"]);
  });
});

describe("줄 펴기 — 기본 접힘", () => {
  it("처음에는 스키마 이름만", () => {
    expect(shape(visibleRows(input()))).toEqual(["public", "audit"]);
  });

  it("스키마를 펼치면 읽는 중 → 폴더(접힘) → 폴더를 펼치면 객체 → 관계를 펼치면 구조 폴더 → 컬럼", () => {
    const expanded = new Set([schemaKey("public")]);
    expect(shape(visibleRows(input({ expanded, objects: new Map([["public", { state: "loading" }]]) })))).toEqual([
      "public",
      "  (loading)",
      "audit",
    ]);
    const objects = new Map([["public", ok(pgPublic)]]);
    expect(shape(visibleRows(input({ expanded, objects })))).toEqual([
      "public",
      "  [table 2]",
      "  [view 1]",
      "  [function 2]",
      "  [sequence 1]",
      "audit",
    ]);
    const users = objectKey("public", pgPublic.objects[0]);
    const cols: DbTableColumn[] = [{ name: "id", type: "integer", notNull: true, default: null, pk: 1 }];
    const rows = visibleRows(
      input({
        expanded: new Set([schemaKey("public"), folderKey("public", "table"), folderKey("public", "function"), users, partKey(users, "columns")]),
        objects,
        details: new Map([[users, ok(detail({ columns: cols }))]]),
      }),
    );
    expect(shape(rows)).toEqual([
      "public",
      "  [table 2]",
      "    users",
      "      {columns 1}",
      "        .id",
      "    logs",
      "  [view 1]",
      "  [function 2]",
      "    f1",
      "    f1",
      "  [sequence 1]",
      "audit",
    ]);
    // 겹지정 함수는 열쇠가 갈린다 · 함수는 펼칠 수 없다.
    const fns = rows.filter((r) => r.type === "object" && r.object.kind === "function");
    expect(new Set(fns.map((r) => r.key)).size).toBe(2);
    expect(fns.every((r) => r.type === "object" && !r.expandable)).toBe(true);
  });

  it("빈 스키마 · 실패 · 잘린 폴더는 안내 줄", () => {
    const expanded = new Set([schemaKey("public"), schemaKey("audit"), folderKey("public", "table")]);
    const objects = new Map<string, Load<DbObjects>>([
      ["public", ok({ objects: [{ kind: "table", name: "t" }], truncated: ["table"] })],
      ["audit", { state: "error", message: "permission denied" }],
    ]);
    expect(shape(visibleRows(input({ expanded, objects })))).toEqual([
      "public",
      "  [table 1+]",
      "    t",
      "    (truncated)",
      "audit",
      "  (error)",
    ]);
    const empty = new Map([["public", ok({ objects: [], truncated: [] } as DbObjects)]]);
    expect(shape(visibleRows(input({ schemas: ["public"], expanded, objects: empty })))).toEqual(["public", "  (empty)"]);
  });

  it("SQLite 의 main 하나면 스키마 단계를 건너뛴다(폴더가 맨 위)", () => {
    expect(skipSchemaLevel("sqlite", ["main"])).toBe(true);
    expect(skipSchemaLevel("sqlite", ["main", "aux"])).toBe(false);
    expect(skipSchemaLevel("postgres", ["public"])).toBe(false);
    const objects = new Map([["main", ok<DbObjects>({ objects: [{ kind: "table", name: "t" }, { kind: "view", name: "v" }], truncated: [] })]]);
    expect(shape(visibleRows(input({ dialect: "sqlite", schemas: ["main"], objects })))).toEqual(["[table 1]", "[view 1]"]);
  });
});

describe("키보드", () => {
  const objects = new Map([["public", ok(pgPublic)]]);
  const expanded = new Set([schemaKey("public"), folderKey("public", "table")]);
  const rows = visibleRows(input({ expanded, objects }));
  const users = objectKey("public", pgPublic.objects[0]);

  it("↑↓ · Home · End — 안내 줄은 건너뛴다", () => {
    expect(keyAction(rows, null, "ArrowDown")).toEqual({ kind: "focus", key: schemaKey("public") });
    expect(keyAction(rows, schemaKey("public"), "ArrowDown")).toEqual({ kind: "focus", key: folderKey("public", "table") });
    expect(keyAction(rows, schemaKey("public"), "ArrowUp")).toBeNull();
    expect(keyAction(rows, schemaKey("public"), "End")).toEqual({ kind: "focus", key: schemaKey("audit") });
    const loading = visibleRows(input({ expanded: new Set([schemaKey("public")]) }));
    expect(keyAction(loading, schemaKey("public"), "ArrowDown")).toEqual({ kind: "focus", key: schemaKey("audit") });
  });

  it("→ 접힘이면 펼치기 · 펼쳐 있으면 첫 자식 / ← 펼쳐 있으면 접기 · 아니면 부모", () => {
    expect(keyAction(rows, schemaKey("audit"), "ArrowRight")).toEqual({ kind: "expand", key: schemaKey("audit") });
    expect(keyAction(rows, schemaKey("public"), "ArrowRight")).toEqual({ kind: "focus", key: folderKey("public", "table") });
    expect(keyAction(rows, folderKey("public", "table"), "ArrowLeft")).toEqual({ kind: "collapse", key: folderKey("public", "table") });
    expect(keyAction(rows, users, "ArrowLeft")).toEqual({ kind: "focus", key: folderKey("public", "table") });
    expect(keyAction(rows, users, "ArrowRight")).toEqual({ kind: "expand", key: users });
    // 펼칠 수 없는 잎 — → 는 할 일 없음.
    const fn = visibleRows(input({ expanded: new Set([...expanded, folderKey("public", "function")]), objects })).find(
      (r) => r.type === "object" && r.object.kind === "function",
    )!;
    expect(keyAction([fn], fn.key, "ArrowRight")).toBeNull();
  });

  it("Enter — 스키마·폴더는 펴고 접기, 객체는 고르기", () => {
    expect(keyAction(rows, schemaKey("public"), "Enter")).toEqual({ kind: "collapse", key: schemaKey("public") });
    expect(keyAction(rows, folderKey("public", "view"), "Enter")).toEqual({ kind: "expand", key: folderKey("public", "view") });
    expect(keyAction(rows, users, "Enter")).toEqual({ kind: "activate", key: users });
    expect(keyAction(rows, users, "x")).toBeNull();
  });
});

describe("넣을 이름 · 표시 · 상태", () => {
  it("정규화 이름(인용) — 함수는 여는 괄호까지 · SQLite main 생략", () => {
    expect(insertText("postgres", "public", { kind: "function", name: "f1", args: "a integer" })).toBe('"public"."f1"(');
    expect(insertText("postgres", 'we"ird', { kind: "sequence", name: "s" })).toBe('"we""ird"."s"');
    expect(insertText("mysql", "shop", { kind: "procedure", name: "p`x", args: "" })).toBe("`shop`.`p``x`(");
    expect(insertText("sqlite", "main", { kind: "table", name: "t" })).toBe('"t"');
    expect(insertText("sqlite", "aux", { kind: "view", name: "v" })).toBe('"aux"."v"');
  });

  it("함수 꼴 이름", () => {
    expect(signature({ kind: "function", name: "f1", args: "a integer", returns: "integer" })).toBe("f1(a integer) → integer");
    expect(signature({ kind: "procedure", name: "p", args: "" })).toBe("p()");
    expect(signature({ kind: "table", name: "t" })).toBe("t");
  });

  it("펼침 목록 바꿔 끼우기 · 컬럼을 읽을 관계 찾기", () => {
    expect(toggled(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggled(["a"], "a", true)).toEqual(["a"]);
    const objects = new Map([["public", ok(pgPublic)]]);
    expect(relationFor(objects, objectKey("public", pgPublic.objects[2]))).toEqual({ schema: "public", name: "v_users" });
    expect(relationFor(objects, objectKey("public", pgPublic.objects[3]))).toBeNull();
    expect(relationFor(objects, schemaKey("public"))).toBeNull();
    expect(relationFor(new Map(), objectKey("public", pgPublic.objects[0]))).toBeNull();
  });

  it("이름에 NUL 이 아닌 어떤 글자가 와도 열쇠가 겹치지 않는다", () => {
    expect(folderKey("a", "table")).not.toBe(folderKey("a\u0001", "table"));
    expect(objectKey("s", { kind: "table", name: "a.b" })).not.toBe(objectKey("s.a", { kind: "table", name: "b" }));
  });
});

// ── 테이블 구조 폴더(10-13) ─────────────────────────────────────────────

const orders = detail({
  columns: [
    { name: "id", type: "integer", notNull: true, default: null, pk: 1 },
    { name: "customer_id", type: "integer", notNull: false, default: null, pk: 0 },
  ],
  indexes: [
    { name: "orders_pkey", columns: ["id"], unique: true, primary: true, method: "btree" },
    { name: "o_expr", columns: [null, "id"], unique: false, primary: false },
  ],
  constraints: [{ name: "orders_pkey", type: "primary", columns: ["id"] }],
  foreignKeys: [
    {
      name: "fk_c",
      schema: "public",
      table: "orders",
      columns: ["customer_id"],
      refSchema: "sales",
      refTable: "customers",
      refColumns: ["id"],
      onDelete: "CASCADE",
    },
  ],
  referencedBy: [
    { schema: "public", table: "lines", columns: ["order_id"], refSchema: "public", refTable: "orders", refColumns: ["id"] },
  ],
  triggers: [{ name: "trg", detail: "BEFORE INSERT" }],
  truncated: ["triggers"],
});

describe("테이블 구조 폴더", () => {
  const users = objectKey("public", pgPublic.objects[0]);
  const objects = new Map([["public", ok(pgPublic)]]);
  const base = [schemaKey("public"), folderKey("public", "table"), users];

  it("구조 폴더는 정한 순서 · 빈 폴더 숨김 · 개수(잘림 +)", () => {
    expect(detailParts(orders).map((p) => `${p.part} ${countLabel(p)}`)).toEqual([
      "columns 2",
      "indexes 2",
      "constraints 1",
      "foreignKeys 1",
      "referencedBy 1",
      "triggers 1+",
    ]);
    expect(detailParts(detail({ columns: orders.columns })).map((p) => p.part)).toEqual(["columns"]);
  });

  it("관계를 펼치면 구조 폴더(접힘) → 폴더를 펼치면 잎 · 잘린 폴더는 안내 줄", () => {
    const details = new Map([[users, ok(orders)]]);
    expect(shape(visibleRows(input({ schemas: ["public"], expanded: new Set(base), objects, details })))).toEqual([
      "public",
      "  [table 2]",
      "    users",
      "      {columns 2}",
      "      {indexes 2}",
      "      {constraints 1}",
      "      {foreignKeys 1}",
      "      {referencedBy 1}",
      "      {triggers 1+}",
      "    logs",
      "  [view 1]",
      "  [function 2]",
      "  [sequence 1]",
    ]);
    const open = new Set([...base, partKey(users, "foreignKeys"), partKey(users, "referencedBy"), partKey(users, "triggers")]);
    const rows = visibleRows(input({ schemas: ["public"], expanded: open, objects, details }));
    expect(shape(rows).slice(3, 13)).toEqual([
      "      {columns 2}",
      "      {indexes 2}",
      "      {constraints 1}",
      "      {foreignKeys 1}",
      "        - fk_c",
      "      {referencedBy 1}",
      "        - referencedBy",
      "      {triggers 1+}",
      "        - trg",
      "        (truncated)",
    ]);
    // 키보드 — 구조 폴더는 Enter 로 펴고 접고, 잎 · 컬럼은 고르기.
    const fkPart = partKey(users, "foreignKeys");
    expect(keyAction(rows, fkPart, "Enter")).toEqual({ kind: "collapse", key: fkPart });
    expect(keyAction(rows, partKey(users, "columns"), "Enter")).toEqual({ kind: "expand", key: partKey(users, "columns") });
    const leaf = rows.find((r) => r.type === "leaf")!;
    expect(keyAction(rows, leaf.key, "Enter")).toEqual({ kind: "activate", key: leaf.key });
    expect(keyAction(rows, leaf.key, "ArrowLeft")).toEqual({ kind: "focus", key: fkPart });
    expect(keyAction(rows, users, "ArrowRight")).toEqual({ kind: "focus", key: partKey(users, "columns") });
  });

  it("구조를 읽는 중 · 실패는 안내 줄", () => {
    const loading = visibleRows(input({ schemas: ["public"], expanded: new Set(base), objects, details: new Map([[users, { state: "loading" }]]) }));
    expect(shape(loading).slice(2, 4)).toEqual(["    users", "      (loading)"]);
    const failed = visibleRows(
      input({ schemas: ["public"], expanded: new Set(base), objects, details: new Map([[users, { state: "error", message: "denied" }]]) }),
    );
    expect(failed[3]).toMatchObject({ type: "note", note: "error", message: "denied" });
  });

  it("잎을 누르면 넣을 글자 — 엔진마다 그 이름을 쓰는 자리의 꼴", () => {
    const idx = { part: "indexes" as const, item: orders.indexes[0] };
    expect(leafInsertText("postgres", "public", idx)).toBe('"public"."orders_pkey"');
    expect(leafInsertText("mysql", "shop", idx)).toBe("`orders_pkey`");
    expect(leafInsertText("sqlite", "main", idx)).toBe('"orders_pkey"');
    const trg = { part: "triggers" as const, item: orders.triggers[0] };
    expect(leafInsertText("postgres", "public", trg)).toBe('"trg"');
    expect(leafInsertText("mysql", "shop", trg)).toBe("`shop`.`trg`");
    expect(leafInsertText("postgres", "public", { part: "columns", item: orders.columns[1] })).toBe('"customer_id"');
    expect(leafInsertText("sqlite", "main", { part: "constraints", item: { type: "primary", columns: ["id"] } })).toBeNull();
    expect(leafInsertText("postgres", "public", { part: "foreignKeys", item: orders.foreignKeys[0] })).toBeNull();
  });

  it("외래 키 화살표 · 따라갈 테이블", () => {
    expect(fkArrow("foreignKeys", orders.foreignKeys[0], "public")).toBe("(customer_id) → sales.customers(id)");
    expect(fkArrow("referencedBy", orders.referencedBy[0], "public")).toBe("lines(order_id) → (id)");
    expect(fkTarget("foreignKeys", orders.foreignKeys[0])).toEqual({ schema: "sales", table: "customers" });
    expect(fkTarget("referencedBy", orders.referencedBy[0])).toEqual({ schema: "public", table: "lines" });
    expect(columnList([null, "a"], "식")).toBe("(식, a)");
  });

  it("따라가기 — 관계 찾기(정확히 → 대소문자 무시) · 펼칠 조상 · 펼침 목록 더하기", () => {
    const data: DbObjects = {
      objects: [
        { kind: "function", name: "Users" },
        { kind: "table", name: "Users" },
        { kind: "view", name: "users" },
      ],
      truncated: [],
    };
    expect(findRelation(data, "users")).toEqual({ kind: "view", name: "users" });
    expect(findRelation(data, "USERS")).toEqual({ kind: "table", name: "Users" });
    expect(findRelation(data, "nope")).toBeNull();
    const t = { kind: "table" as const, name: "t" };
    expect(revealKeys("postgres", ["public"], "public", t)).toEqual([schemaKey("public"), folderKey("public", "table")]);
    expect(revealKeys("sqlite", ["main"], "main", t)).toEqual([folderKey("main", "table")]);
    expect(withExpanded(["a"], ["a", "b", "b"])).toEqual(["a", "b"]);
  });
});

// ── 이름 필터(10-13) ────────────────────────────────────────────────────

describe("이름 필터 — 읽어 온 것만", () => {
  const users = objectKey("public", pgPublic.objects[0]);
  const objects = new Map<string, Load<DbObjects>>([["public", ok(pgPublic)]]);
  const details = new Map([[users, ok(orders)]]);

  it("비교 꼴 · 일치 · 강조 자리", () => {
    expect(normFilter("  Ord ")).toBe("ord");
    expect(normFilter(undefined)).toBe("");
    expect(nameMatches("Orders", "ord")).toBe(true);
    expect(nameMatches("orders", "")).toBe(false);
    expect(matchSpan("my_Orders", "ORD")).toEqual([3, 6]);
    expect(matchSpan("orders", "  ")).toBeNull();
    expect(matchSpan("abc", "z")).toBeNull();
    expect(countLabel({ items: [1, 2, 3], truncated: true, matched: 2 })).toBe("2/3+");
    expect(leafName({ part: "referencedBy", item: orders.referencedBy[0] })).toBe("lines");
  });

  it("일치한 잎의 조상은 펼쳐 보이고 · 없는 가지는 숨기고 · 폴더 개수는 일치/전체 · 펼친 목록은 그대로", () => {
    // 아무것도 펼치지 않았어도 — 객체 이름 일치(함수 둘) + 읽어 둔 구조의 컬럼 일치(users.customer_id).
    const expanded = new Set<string>();
    const rows = visibleRows(input({ expanded, objects, details, filter: "C" }));
    expect(shape(rows)).toEqual([
      "(unread)",
      "public",
      "  [table 1/2]",
      "    users",
      "      {columns 1/2}",
      "        .customer_id",
      "      {foreignKeys 1/1}",
      "        - fk_c",
    ]);
    expect(rows[0]).toMatchObject({ type: "note", note: "unread", count: 1 });
    expect(expanded.size).toBe(0);
  });

  it("이름이 일치한 관계 아래는 평소처럼 펼친 목록을 따른다", () => {
    const base = [schemaKey("public"), folderKey("public", "table"), users];
    const rows = visibleRows(input({ schemas: ["public"], expanded: new Set(base), objects, details, filter: "users" }));
    expect(shape(rows)).toEqual([
      "public",
      "  [table 1/2]",
      "    users",
      "      {columns 2}",
      "      {indexes 2}",
      "      {constraints 1}",
      "      {foreignKeys 1}",
      "      {referencedBy 1}",
      "      {triggers 1+}",
      "  [view 1/1]",
      "    v_users",
      "  [sequence 1/1]",
      "    users_id_seq",
    ]);
  });

  it("일치 없음 · 안 읽은 스키마는 세기만 · SQLite main 하나면 스키마 줄 없이", () => {
    expect(shape(visibleRows(input({ schemas: ["public"], objects, filter: "zzz" })))).toEqual(["(nomatch)"]);
    expect(shape(visibleRows(input({ objects: new Map(), filter: "a" })))).toEqual(["(unread)", "(nomatch)"]);
    const lite = new Map<string, Load<DbObjects>>([["main", ok({ objects: [{ kind: "table", name: "orders" }], truncated: [] })]]);
    expect(shape(visibleRows(input({ dialect: "sqlite", schemas: ["main"], objects: lite, filter: "ORD" })))).toEqual(["[table 1/1]", "  orders"]);
  });

  it("필터를 지우면 원래 펼침", () => {
    const expanded = new Set([schemaKey("public")]);
    const before = shape(visibleRows(input({ schemas: ["public"], expanded, objects })));
    visibleRows(input({ schemas: ["public"], expanded, objects, details, filter: "id" }));
    expect(shape(visibleRows(input({ schemas: ["public"], expanded, objects, filter: "  " })))).toEqual(before);
  });
});
