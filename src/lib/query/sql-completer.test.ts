import { describe, expect, it, vi } from "vitest";
import { createSqlCompleter } from "./sql-completer";
import type { DbTableDetail } from "./query-backend";

const detail = (cols: string[]): DbTableDetail =>
  ({
    columns: cols.map((name) => ({ name, type: "int", notNull: false, default: null, pk: 0 })),
    indexes: [],
    constraints: [],
    foreignKeys: [],
    referencedBy: [],
    triggers: [],
    partitions: [],
    truncated: [],
  }) as unknown as DbTableDetail;

function setup(over: { canRead?: () => boolean; fail?: boolean } = {}) {
  let conn = { handle: 1, lease: 1 };
  let t = 0;
  const read = vi.fn(async (_h: number, _l: number, _s: string | null, table: string) => {
    if (over.fail) throw new Error("[db-busy]");
    return detail([`${table}_id`]);
  });
  const onread = vi.fn();
  const c = createSqlCompleter({
    dialect: () => "postgres",
    conn: () => conn,
    canRead: over.canRead ?? (() => true),
    onread,
    read,
    now: () => t,
  });
  c.note({ handle: 1, lease: 1, kind: "schemas", schemas: ["public"] });
  c.note({ handle: 1, lease: 1, kind: "objects", schema: "public", objects: { objects: [{ kind: "table", name: "orders" }], truncated: [] } });
  return {
    c,
    read,
    onread,
    setConn: (h: number) => (conn = { handle: h, lease: 1 }),
    tick: (ms: number) => (t += ms),
  };
}

const labels = (a: { items: { label: string; kind: string }[] } | null) => a?.items.filter((i) => i.kind === "column").map((i) => i.label);

describe("createSqlCompleter", () => {
  it("처음 필요할 때 한 번 읽고 캐시한다 · 읽는 동안 알린다", async () => {
    const s = setup();
    const text = "SELECT o. FROM orders o";
    expect(labels(await s.c.complete(text, 9, false))).toEqual(["orders_id"]);
    expect(labels(await s.c.complete(text, 9, false))).toEqual(["orders_id"]);
    expect(s.read).toHaveBeenCalledTimes(1);
    expect(s.read).toHaveBeenCalledWith(1, 1, "public", "orders");
    expect(s.onread.mock.calls).toEqual([[true], [false]]);
  });

  it("바쁘면 열 없이 넘어가고 다음에 다시", async () => {
    let busy = true;
    const s = setup({ canRead: () => !busy });
    const text = "SELECT o. FROM orders o";
    expect(labels(await s.c.complete(text, 9, false))).toEqual([]);
    expect(s.read).not.toHaveBeenCalled();
    busy = false;
    expect(labels(await s.c.complete(text, 9, false))).toEqual(["orders_id"]);
  });

  it("실패는 조용히 · 잠시 뒤에만 다시 읽는다", async () => {
    const s = setup({ fail: true });
    const text = "SELECT o. FROM orders o";
    expect(labels(await s.c.complete(text, 9, false))).toEqual([]);
    await s.c.complete(text, 9, false);
    expect(s.read).toHaveBeenCalledTimes(1);
    s.tick(10_000);
    await s.c.complete(text, 9, false);
    expect(s.read).toHaveBeenCalledTimes(2);
  });

  it("트리가 읽은 구조는 다시 읽지 않는다 · 연결이 바뀌면 버린다", async () => {
    const s = setup();
    s.c.note({ handle: 1, lease: 1, kind: "detail", schema: "public", name: "orders", detail: detail(["a", "b"]) });
    expect(labels(await s.c.complete("SELECT orders.", 14, false))).toEqual(["a", "b"]);
    expect(s.read).not.toHaveBeenCalled();
    // 다른 연결의 알림은 받지 않는다
    s.c.note({ handle: 9, lease: 1, kind: "detail", schema: "public", name: "orders", detail: detail(["zz"]) });
    expect(labels(await s.c.complete("SELECT orders.", 14, false))).toEqual(["a", "b"]);
    s.setConn(2);
    expect(await s.c.complete("SELECT orders.", 14, false)).toBeNull(); // 표를 모른다(트리가 아직)
  });
});
