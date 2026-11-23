import { describe, expect, it } from "vitest";
import type { DbObject, DbObjects } from "./query-backend";
import { listColumns, listRows, moveCursor, nextListSort, rowsText, shownFolder } from "./object-list";

const o = (name: string, more: Partial<DbObject> = {}): DbObject => ({ kind: "table", name, ...more });

describe("객체 목록 탭 — 칸", () => {
  it("종류마다 칸 · SQLite 는 행 · 설명 없음", () => {
    expect(listColumns("postgres", "table")).toEqual(["name", "kind", "rows", "comment"]);
    expect(listColumns("postgres", "foreign")).toEqual(["name", "kind", "rows", "comment"]);
    expect(listColumns("mysql", "view")).toEqual(["name", "kind", "comment"]);
    expect(listColumns("postgres", "function")).toEqual(["name", "args", "returns", "comment"]);
    expect(listColumns("mysql", "procedure")).toEqual(["name", "args", "comment"]);
    expect(listColumns("postgres", "type")).toEqual(["name", "kind", "comment"]);
    expect(listColumns("sqlite", "table")).toEqual(["name", "kind"]);
    expect(listColumns("sqlite", "view")).toEqual(["name", "kind"]);
  });
});

describe("객체 목록 탭 — 종류 고르기", () => {
  const data: DbObjects = { objects: [o("v1", { kind: "view" }), o("t1"), o("f1", { kind: "function", args: "" })], truncated: ["function"] };

  it("원하는 종류가 있으면 그것, 없거나 안 정했으면 방언 순서의 첫 종류", () => {
    expect(shownFolder("postgres", data, "function")?.kind).toBe("function");
    expect(shownFolder("postgres", data, "function")?.truncated).toBe(true);
    expect(shownFolder("postgres", data, undefined)?.kind).toBe("table");
    expect(shownFolder("postgres", data, "sequence")?.kind).toBe("table");
    expect(shownFolder("sqlite", data, "function")?.kind, "방언에 없는 종류").toBe("table");
    expect(shownFolder("postgres", { objects: [], truncated: [] }, "table")).toBeNull();
  });
});

describe("객체 목록 탭 — 찾기 · 정렬", () => {
  const items = [o("orders", { rows: 10 }), o("Users", { rows: 300 }), o("logs"), o("order_lines", { rows: 2 })];

  it("찾기는 대소문자 없이 이름 안", () => {
    expect(listRows(items, " ORDER ", null).map((x) => x.name)).toEqual(["orders", "order_lines"]);
    expect(listRows(items, "", null)).toEqual(items);
    expect(listRows(items, "zzz", null)).toEqual([]);
  });

  it("정렬 순환 — 오름 → 내림 → 없음 · 다른 칸이면 오름", () => {
    expect(nextListSort(null, "name")).toEqual({ col: "name", dir: "asc" });
    expect(nextListSort({ col: "name", dir: "asc" }, "name")).toEqual({ col: "name", dir: "desc" });
    expect(nextListSort({ col: "name", dir: "desc" }, "name")).toBeNull();
    expect(nextListSort({ col: "name", dir: "desc" }, "rows")).toEqual({ col: "rows", dir: "asc" });
  });

  it("이름 · 행 정렬 — 행 수 없는 줄은 늘 아래 · 원본은 그대로", () => {
    expect(listRows(items, "", { col: "name", dir: "asc" }).map((x) => x.name)).toEqual(["logs", "order_lines", "orders", "Users"]);
    expect(listRows(items, "", { col: "rows", dir: "asc" }).map((x) => x.name)).toEqual(["order_lines", "orders", "Users", "logs"]);
    expect(listRows(items, "", { col: "rows", dir: "desc" }).map((x) => x.name)).toEqual(["Users", "orders", "order_lines", "logs"]);
    expect(items[0].name).toBe("orders");
  });

  it("행 글자 — 없으면 흐린 —", () => {
    expect(rowsText(undefined)).toBe("—");
    expect(rowsText(1234.6)).toBe((1235).toLocaleString());
    expect(rowsText(0)).toBe("0");
  });
});

describe("객체 목록 탭 — 키보드", () => {
  it("↑ ↓ Home End PageUp PageDown — 끝에서 멈춘다", () => {
    expect(moveCursor(-1, "ArrowDown", 5, 3)).toBe(0);
    expect(moveCursor(4, "ArrowDown", 5, 3)).toBe(4);
    expect(moveCursor(0, "ArrowUp", 5, 3)).toBe(0);
    expect(moveCursor(2, "End", 5, 3)).toBe(4);
    expect(moveCursor(2, "Home", 5, 3)).toBe(0);
    expect(moveCursor(1, "PageDown", 5, 3)).toBe(4);
    expect(moveCursor(4, "PageUp", 5, 3)).toBe(1);
    expect(moveCursor(9, "ArrowUp", 5, 3), "목록이 줄었으면 끝에서").toBe(3);
  });

  it("빈 목록 · 다른 키는 받지 않는다", () => {
    expect(moveCursor(0, "ArrowDown", 0, 3)).toBeNull();
    expect(moveCursor(0, "KeyA", 5, 3)).toBeNull();
  });
});
