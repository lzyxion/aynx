import { describe, expect, it } from "vitest";
import { DirtyBinding, DirtyTable, SaverTable } from "$lib/doc-dirty-table";

describe("DirtyTable", () => {
  it("같은 값을 다시 적으면 바뀌지 않았다고 말한다(반응형 사본을 새로 쓰지 않는다)", () => {
    const t = new DirtyTable();
    expect(t.set("pane-1", false)).toBe(false);
    expect(t.set("pane-1", true)).toBe(true);
    expect(t.set("pane-1", true)).toBe(false);
    expect(t.has("pane-1")).toBe(true);
    expect(t.set("pane-1", false)).toBe(true);
    expect(t.set("pane-1", false)).toBe(false);
    expect(t.has("pane-1")).toBe(false);
  });

  it("list 는 새 배열 · 넣은 순서", () => {
    const t = new DirtyTable();
    t.set("b", true);
    t.set("a", true);
    const l = t.list();
    expect(l).toEqual(["b", "a"]);
    l.push("x");
    expect(t.list()).toEqual(["b", "a"]);
  });
});

describe("SaverTable", () => {
  it("등록 없으면 false · 던지면 false · 결과를 돌려준다", async () => {
    const s = new SaverTable();
    expect(await s.request("p")).toBe(false);
    const off = s.register("p", async () => true);
    expect(await s.request("p")).toBe(true);
    off();
    expect(await s.request("p")).toBe(false);
    s.register("q", () => Promise.reject(new Error("x")));
    expect(await s.request("q")).toBe(false);
  });

  it("옛 등록을 풀어도 새 등록은 남는다", async () => {
    const s = new SaverTable();
    const offOld = s.register("p", async () => false);
    s.register("p", async () => true);
    offOld();
    expect(await s.request("p")).toBe(true);
  });
});

describe("DirtyBinding", () => {
  function setup() {
    const t = new DirtyTable();
    const b = new DirtyBinding((id, d) => void t.set(id, d));
    return { t, b };
  }

  it("같은 id 로 몇 번을 다시 돌아도(포커스 이동으로 상위가 다시 내려 줌) 참이 남는다", () => {
    const { t, b } = setup();
    b.sync("pane-1", true);
    b.sync("pane-1", true);
    b.sync("pane-1", true);
    expect(t.has("pane-1")).toBe(true);
  });

  it("값을 늘 그대로 따른다", () => {
    const { t, b } = setup();
    b.sync("pane-1", true);
    b.sync("pane-1", false);
    expect(t.has("pane-1")).toBe(false);
    b.sync("pane-1", true);
    expect(t.has("pane-1")).toBe(true);
  });

  it("id 가 값으로 바뀌면 옛 id 는 지우고 새 id 에 적는다", () => {
    const { t, b } = setup();
    b.sync("pane-1", true);
    b.sync("pane-2", true);
    expect(t.list()).toEqual(["pane-2"]);
  });

  it("id 가 없어지면 옛 id 를 지운다 · dispose 는 지운다", () => {
    const { t, b } = setup();
    b.sync("pane-1", true);
    b.sync(undefined, true);
    expect(t.has("pane-1")).toBe(false);
    b.sync("pane-3", true);
    b.dispose();
    expect(t.has("pane-3")).toBe(false);
  });
});
