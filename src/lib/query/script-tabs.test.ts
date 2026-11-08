import { describe, expect, it } from "vitest";
import { QUERY_DRAFT_MAX, QUERY_SCRIPTS_MAX, canonQueryTabs } from "$lib/session";
import { addTab, closeTab, moveTab, renameTab, savedText, setTabText, tabDirty, tabsFromSpec, toScripts, type ScriptTab } from "./script-tabs";

const tab = (n: number, text = "", title?: string): ScriptTab => ({ n, text, ...(title ? { title } : {}) });

describe("canonQueryTabs — 저장 모양", () => {
  it("옛 단일 초안은 그대로 sql 하나", () => {
    expect(canonQueryTabs({ sql: "SELECT 1" })).toEqual({ sql: "SELECT 1" });
    expect(canonQueryTabs({ sql: "  " })).toEqual({});
    expect(canonQueryTabs({})).toEqual({});
  });

  it("탭 하나 · n 1 · 이름 없음이면 예전 모양으로 접는다", () => {
    expect(canonQueryTabs({ scripts: [{ n: 1, sql: "SELECT 1" }], active: 1 })).toEqual({ sql: "SELECT 1" });
    expect(canonQueryTabs({ scripts: [{ n: 1 }], active: 1 })).toEqual({});
  });

  it("둘 이상 · 이름을 바꾼 탭이면 scripts + active", () => {
    expect(canonQueryTabs({ scripts: [{ n: 1, sql: "A" }, { n: 2 }], active: 2 })).toEqual({
      scripts: [{ n: 1, sql: "A" }, { n: 2 }],
      active: 2,
    });
    expect(canonQueryTabs({ scripts: [{ n: 1, title: " 정산 " }] })).toEqual({ scripts: [{ n: 1, title: "정산" }], active: 1 });
    expect(canonQueryTabs({ scripts: [{ n: 3, sql: "B" }] })).toEqual({ scripts: [{ n: 3, sql: "B" }], active: 3 });
  });

  it("못 쓸 칸은 그 탭만 버리고 active 가 없는 탭이면 첫 탭", () => {
    const c = canonQueryTabs({
      scripts: [{ n: 0 }, { n: 2, sql: "x".repeat(QUERY_DRAFT_MAX + 1) }, { n: 2 }, "junk", { n: 4, title: 7 }, { n: 1.5 }],
      active: 9,
    });
    expect(c).toEqual({ scripts: [{ n: 2 }, { n: 4 }], active: 2 });
  });

  it("상한을 넘는 뒤 탭은 버린다", () => {
    const many = Array.from({ length: QUERY_SCRIPTS_MAX + 3 }, (_, i) => ({ n: i + 1 }));
    expect(canonQueryTabs({ scripts: many }).scripts).toHaveLength(QUERY_SCRIPTS_MAX);
  });

  it("scripts 가 비거나 망가졌으면 옛 sql 로", () => {
    expect(canonQueryTabs({ scripts: [], sql: "S" })).toEqual({ sql: "S" });
    expect(canonQueryTabs({ scripts: "x", sql: "S" })).toEqual({ sql: "S" });
  });
});

describe("tabsFromSpec · toScripts", () => {
  it("옛 단일 초안 → 첫 탭 쿼리 1", () => {
    expect(tabsFromSpec({ sql: "SELECT 1" })).toEqual({ tabs: [{ n: 1, text: "SELECT 1" }], active: 1 });
    expect(tabsFromSpec({})).toEqual({ tabs: [{ n: 1, text: "" }], active: 1 });
  });

  it("탭 여럿을 되살리고 다시 내려 보낸다", () => {
    const back = tabsFromSpec({ scripts: [{ n: 1, sql: "A" }, { n: 3, title: "t" }], active: 3 });
    expect(back).toEqual({ tabs: [{ n: 1, text: "A" }, { n: 3, title: "t", text: "" }], active: 3 });
    expect(toScripts(back.tabs)).toEqual([{ n: 1, sql: "A" }, { n: 3, title: "t" }]);
  });

  it("빈 글 · 상한 초과는 sql 없이", () => {
    expect(toScripts([tab(1, "  "), tab(2, "x".repeat(QUERY_DRAFT_MAX + 1))])).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("savedText — 그 탭의 저장된 초안", () => {
    expect(savedText({ sql: "S" }, 1)).toBe("S");
    expect(savedText({ scripts: [{ n: 1 }, { n: 2, sql: "B" }] }, 2)).toBe("B");
    expect(savedText({ sql: "S" }, 2)).toBe("");
  });
});

describe("탭 조작", () => {
  it("새 탭은 가장 큰 번호 + 1 · 상한이면 null", () => {
    expect(addTab([tab(1), tab(4)])).toEqual({ tabs: [tab(1), tab(4), tab(5)], n: 5 });
    expect(addTab(Array.from({ length: QUERY_SCRIPTS_MAX }, (_, i) => tab(i + 1)))).toBeNull();
  });

  it("마지막 하나는 닫지 못한다", () => {
    expect(closeTab([tab(1)], 1, 1)).toBeNull();
  });

  it("고른 탭을 닫으면 오른쪽, 없으면 왼쪽", () => {
    expect(closeTab([tab(1), tab(2), tab(3)], 2, 2)).toEqual({ tabs: [tab(1), tab(3)], active: 3 });
    expect(closeTab([tab(1), tab(2), tab(3)], 3, 3)).toEqual({ tabs: [tab(1), tab(2)], active: 2 });
    expect(closeTab([tab(1), tab(2)], 1, 2)).toEqual({ tabs: [tab(1)], active: 1 });
    expect(closeTab([tab(1), tab(2)], 1, 9)).toBeNull();
  });

  it("이름 바꾸기 — 빈칸 걷기 · 비면 기본 이름", () => {
    expect(renameTab([tab(1), tab(2)], 2, "  정산  ")).toEqual([tab(1), tab(2, "", "정산")]);
    expect(renameTab([tab(1, "", "x")], 1, "   ")).toEqual([tab(1)]);
    expect(renameTab([tab(1)], 1, "가".repeat(80))[0].title).toHaveLength(60);
  });

  it("순서 바꾸기", () => {
    const ts = [tab(1), tab(2), tab(3)];
    expect(moveTab(ts, 3, 0).map((x) => x.n)).toEqual([3, 1, 2]);
    expect(moveTab(ts, 1, 9).map((x) => x.n)).toEqual([2, 3, 1]);
    expect(moveTab(ts, 7, 0).map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it("글 바꾸기 — 같은 글이면 같은 객체", () => {
    const ts = [tab(1, "a")];
    expect(setTabText(ts, 1, "a")[0]).toBe(ts[0]);
    expect(setTabText(ts, 1, "b")[0].text).toBe("b");
  });
});

describe("tabDirty — ●", () => {
  it("저장된 초안과 다르면 ●", () => {
    expect(tabDirty(tab(1, "SELECT 1"), "SELECT 1")).toBe(false);
    expect(tabDirty(tab(1, "SELECT 2"), "SELECT 1")).toBe(true);
  });

  it("빈 탭은 저장할 것이 없다 — 저장된 초안이 남아 있을 때만 ●", () => {
    expect(tabDirty(tab(1, "  "), "")).toBe(false);
    expect(tabDirty(tab(1, ""), "SELECT 1")).toBe(true);
  });

  it("상한을 넘는 글은 저장되지 않으니 늘 ●", () => {
    const big = "x".repeat(QUERY_DRAFT_MAX + 1);
    expect(tabDirty(tab(1, big), big)).toBe(true);
  });
});
