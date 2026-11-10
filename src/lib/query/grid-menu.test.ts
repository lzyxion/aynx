import { describe, expect, it } from "vitest";
import { isGroup, type PaneMenuRow } from "$lib/pane/pane-menu";
import { UI_ICONS } from "$lib/ui-icons.generated";
import { gridMenuRows, type GridMenuCtx } from "./grid-menu";

const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k}${JSON.stringify(p)}` : k);
const base: GridMenuCtx = { dataTab: true, bytes: false, charting: false, follow: null, refs: [] };
const ids = (rows: PaneMenuRow[]) => rows.map((r) => (isGroup(r) ? `${r.flyout}▸` : r.action));

describe("gridMenuRows", () => {
  it("클립보드 → 필터 순서, 따라갈 것이 없으면 거기서 끝", () => {
    expect(ids(gridMenuRows(base, tr))).toEqual(["tool:copy", "copy-as▸", "filter▸"]);
  });

  it("정방향 · 역방향 외래 키는 맨 아래 한 무리", () => {
    const rows = gridMenuRows({ ...base, follow: "customers", refs: [{ table: "orders", columns: ["customer_id"], ok: true }] }, tr);
    expect(ids(rows)).toEqual(["tool:copy", "copy-as▸", "filter▸", "tool:follow", "refs▸"]);
    const refs = rows.at(-1)!;
    expect(isGroup(refs) && refs.separator).toBe(false);
    expect(isGroup(refs) && refs.children.map((c) => [c.action, c.label, c.hint])).toEqual([["tool:ref:0", "orders", "customer_id"]]);
  });

  it("역방향만 있으면 그 줄 앞에 구분선 · 전부 못 따라가면 흐림", () => {
    const rows = gridMenuRows({ ...base, refs: [{ table: "orders", columns: ["customer_id"], ok: false }] }, tr);
    const refs = rows.at(-1)!;
    expect(isGroup(refs) && [refs.separator, refs.disabled]).toEqual([true, true]);
  });

  it("이진 칸은 필터를 흐리고, 쿼리 탭은 '거르기에 더하기'", () => {
    const rows = gridMenuRows({ ...base, dataTab: false, bytes: true }, tr);
    const f = rows.find((r) => isGroup(r) && r.flyout === "filter")!;
    expect(isGroup(f) && f.disabled).toBe(true);
    expect(isGroup(f) && f.children.map((c) => c.label)).toContain("pane.query.cell.filter.addLocal");
  });

  it("아이콘 이름은 생성 목록에 있다", () => {
    const rows = gridMenuRows({ ...base, follow: "t", refs: [{ table: "x", columns: ["a"], ok: true }] }, tr);
    for (const r of rows) if (r.icon) expect(UI_ICONS).toHaveProperty(r.icon);
  });
});
