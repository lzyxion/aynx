import { describe, expect, it } from "vitest";
import type { PaneSpec, TabSpec } from "$lib/session/spec";
import {
  LAYOUT_OPS, anyWorkspace, findTabByKey, findTileByKey, homePane, parseLayoutRequest, refusalOf, requestPane, toWire, type LayoutRequest,
} from "./request";

// 원격 웹 R3 — 원격의 배치 바꾸기 요청: 원격 id → 집 PC 열쇠, 허용 칸만, 받는 쪽의 다시 거르기.

const keys = {
  tile: (id: string) => ({ hpane1: "k:t1", hpane2: "i:pane-2" })[id] ?? null,
  tab: (id: string) => ({ htab1: "k:tab1", htab2: "i:tab-2" })[id] ?? null,
};

const ai: PaneSpec = {
  id: "pane-9",
  kind: "local",
  tileKey: "own",
  historyStreamId: "s-1",
  deferred: true,
  shell: "pwsh",
  cwd: "C:/work",
  autorun: "claude",
  injectMcpToken: true,
  setup: { projectId: "p", repo: "C:/r", agent: null, agentName: null },
  worktree: { repo: "C:/r", name: "w" },
  restart: { autorun: "x" },
  openDelay: 300,
};

describe("requestPane / homePane", () => {
  it("keeps the mirror fields plus cwd · autorun · MCP marker, never ids or run machinery", () => {
    const out = requestPane({ ...ai, sourcePaneId: "hpane1" }, keys.tile);
    expect(out).toEqual({
      id: "",
      kind: "local",
      shell: "pwsh",
      cwd: "C:/work",
      autorun: "claude",
      injectMcpToken: true,
      sourcePaneId: "k:t1",
    });
    expect(requestPane({ ...ai, sourcePaneId: "gone" }, keys.tile)).not.toHaveProperty("sourcePaneId");
  });

  it("re-filters on the home side and gives the home id", () => {
    const wire = { ...ai, sourcePaneId: "k:t1" };
    const home = homePane(wire, "pane-40", (k) => (k === "k:t1" ? "pane-3" : null));
    expect(home.id).toBe("pane-40");
    expect(home.sourcePaneId).toBe("pane-3");
    for (const k of ["tileKey", "historyStreamId", "setup", "worktree", "restart", "openDelay"]) {
      expect(home).not.toHaveProperty(k);
    }
    expect(homePane({ ...wire, sourcePaneId: "k:zz" }, "pane-41", () => null)).not.toHaveProperty("sourcePaneId");
  });
});

describe("toWire", () => {
  it("maps remote ids to home keys", () => {
    expect(toWire({ op: "split", tile: "hpane1", dir: "row" }, keys)).toEqual({ op: "split", tile: "k:t1", dir: "row" });
    expect(toWire({ op: "moveTile", tile: "hpane1", target: "hpane2", dir: "col", side: "before" }, keys)).toEqual({
      op: "moveTile", tile: "k:t1", target: "i:pane-2", dir: "col", side: "before",
    });
    expect(toWire({ op: "reorderTab", tab: "htab2", before: null }, keys)).toEqual({ op: "reorderTab", tab: "i:tab-2", before: null });
    expect(toWire({ op: "closeTabs", tabs: ["htab1", "rtab-own", "htab2"] }, keys)).toEqual({ op: "closeTabs", tabs: ["k:tab1", "i:tab-2"] });
    expect(toWire({ op: "openPane", tab: "htab1", near: "nope", pane: ai, title: undefined }, keys)).toEqual({
      op: "openPane", tab: "k:tab1", pane: requestPane(ai, keys.tile),
    });
    expect(toWire({ op: "newTab" }, keys)).toEqual({ op: "newTab" });
    expect(toWire({ op: "newTab", workspace: "w2" }, keys)).toEqual({ op: "newTab", workspace: "w2" });
  });

  it("refuses targets the mirror does not know", () => {
    const bad: LayoutRequest[] = [
      { op: "closeTile", tile: "rpane-5" },
      { op: "closeTabs", tabs: ["x"] },
      { op: "renameTab", tab: "x", name: "a" },
      { op: "reorderTab", tab: "htab1", before: "x" },
      { op: "moveTile", tile: "hpane1", target: "x", dir: "row", side: "after" },
      { op: "openPane", tab: "x", pane: ai },
    ];
    for (const r of bad) expect(toWire(r, keys), r.op).toBeNull();
  });
});

describe("anyWorkspace(10-20)", () => {
  it("닫기 · 이름 바꾸기만 집 PC 가 보지 않는 워크스페이스에서도 — 화면을 옮겨 겨누는 조작은 아니다", () => {
    expect(anyWorkspace({ op: "closeTile", tile: "k:a" })).toBe(true);
    expect(anyWorkspace({ op: "closeTabs", tabs: ["k:t"] })).toBe(true);
    expect(anyWorkspace({ op: "renameTab", tab: "k:t", name: "x" })).toBe(true);
    expect(anyWorkspace({ op: "fileUi", tile: "k:a", hidden: true })).toBe(true);
    for (const req of [
      { op: "split", tile: "k:a" },
      { op: "swapTile", tile: "k:a", dir: "up" },
      { op: "openBeside", tile: "k:a", pane: { id: "", kind: "local" } },
      { op: "reorderTab", tab: "k:t", before: null },
    ] as LayoutRequest[]) expect(anyWorkspace(req), req.op).toBe(false);
  });
});

describe("parseLayoutRequest", () => {
  it("accepts every op in its wire shape", () => {
    const p: PaneSpec = { id: "", kind: "local" };
    const samples: LayoutRequest[] = [
      { op: "newTab" },
      { op: "openPane", pane: p },
      { op: "openBeside", tile: "k:a", pane: p, dir: "row", side: "after" },
      { op: "replaceTile", tile: "k:a", pane: p },
      { op: "split", tile: "k:a" },
      { op: "tmuxTile", tile: "k:a", name: null },
      { op: "closeTile", tile: "k:a" },
      { op: "closeTabs", tabs: ["k:t"] },
      { op: "renameTab", tab: "k:t", name: "" },
      { op: "reorderTab", tab: "k:t", before: null },
      { op: "moveTile", tile: "k:a", target: "k:b", dir: "col", side: "before" },
      { op: "promoteTile", tile: "k:a", before: "k:t" },
      { op: "mergeTab", tab: "k:t", target: "k:b", dir: "row", side: "after" },
      { op: "swapTile", tile: "k:a", dir: "up" },
      { op: "expandTile", tile: "k:a", dir: "right" },
      { op: "openOrchTab", runId: "run-1", workspace: "w2" },
      { op: "fileUi", tile: "k:a", view: "icons", zoom: 3, places: false, preview: true, hidden: true },
    ];
    expect(samples.map((s) => s.op)).toEqual([...LAYOUT_OPS]);
    expect(parseLayoutRequest({ op: "openOrchTab" })).toEqual({ op: "openOrchTab" });
    expect(toWire({ op: "openOrchTab", runId: "run-1" }, { tile: () => null, tab: () => null })).toEqual({ op: "openOrchTab", runId: "run-1" });
    expect(parseLayoutRequest({ op: "newTab", workspace: "w2" })).toEqual({ op: "newTab", workspace: "w2" });
    for (const s of samples) expect(parseLayoutRequest(s), s.op).toEqual(s);
  });

  it("moveTile 의 stay 는 true 만 — 없으면 예전 그대로(세션 판 끌기 · 2026-11-04)", () => {
    const base = { op: "moveTile", tile: "k:a", target: "k:b", dir: "col", side: "before" };
    expect(parseLayoutRequest({ ...base, stay: true })).toEqual({ ...base, stay: true });
    expect(parseLayoutRequest(base)).toEqual(base);
    for (const stay of [false, 1, "true", null]) expect(parseLayoutRequest({ ...base, stay }), String(stay)).toBeNull();
    const keys = { tile: (id: string) => `k:${id}`, tab: (id: string) => `k:${id}` };
    expect(toWire({ op: "moveTile", tile: "a", target: "b", dir: "row", side: "after", stay: true }, keys)).toMatchObject({ stay: true });
  });

  it("fileUi — 값까지 엄격하게 · 열쇠로 바꿔 보낸다(파일 타일 보기 · 2026-11-04)", () => {
    expect(parseLayoutRequest({ op: "fileUi", tile: "k:a", hidden: false })).toEqual({ op: "fileUi", tile: "k:a", hidden: false });
    expect(parseLayoutRequest({ op: "fileUi", tile: "k:a", zoom: 0 })).toEqual({ op: "fileUi", tile: "k:a", zoom: 0 });
    for (const bad of [
      { op: "fileUi", tile: "k:a" },
      { op: "fileUi", hidden: true },
      { op: "fileUi", tile: "k:a", view: "tree" },
      { op: "fileUi", tile: "k:a", zoom: 5 },
      { op: "fileUi", tile: "k:a", zoom: -1 },
      { op: "fileUi", tile: "k:a", zoom: 1.5 },
      { op: "fileUi", tile: "k:a", zoom: "2" },
      { op: "fileUi", tile: "k:a", places: 1 },
      { op: "fileUi", tile: "k:a", preview: "yes" },
      { op: "fileUi", tile: "k:a", hidden: null },
      { op: "fileUi", tile: "k:a", hidden: true, autorun: "rm" },
    ]) expect(parseLayoutRequest(bad), JSON.stringify(bad)).toBeNull();
    const keys = { tile: (id: string) => (id === "a" ? "k:a" : null), tab: () => null };
    expect(toWire({ op: "fileUi", tile: "a", view: "compact", hidden: true }, keys)).toEqual({ op: "fileUi", tile: "k:a", view: "compact", hidden: true });
    expect(toWire({ op: "fileUi", tile: "own", hidden: true }, keys)).toBeNull();
  });

  it("refuses unknown ops and broken shapes", () => {
    for (const bad of [
      null,
      "split",
      { op: "exec", tile: "k:a" },
      { op: "split" },
      { op: "split", tile: "" },
      { op: "split", tile: "k:a", dir: "diag" },
      { op: "openPane", pane: { id: "" } },
      { op: "closeTabs", tabs: [] },
      { op: "swapTile", tile: "k:a", dir: "row" },
      { op: "renameTab", tab: "k:t", name: "x".repeat(201) },
      { op: "newTab", title: null },
      { op: "newTab", workspace: "" },
      { op: "openOrchTab", runId: "" },
      { op: "openOrchTab", runId: 3 },
      { op: "newTab", workspace: 3 },
    ]) {
      expect(parseLayoutRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("findTileByKey / findTabByKey", () => {
  const tabs: TabSpec[] = [
    {
      id: "tab-1",
      tabKey: "tab1",
      title: "a",
      root: {
        type: "split",
        dir: "row",
        ratio: 0.5,
        a: { type: "leaf", pane: { id: "pane-1", kind: "local", tileKey: "t1" } },
        b: { type: "leaf", pane: { id: "pane-2", kind: "local" } },
      },
    },
    { id: "tab-2", title: "b", root: { type: "leaf", pane: { id: "pane-3", kind: "start" } } },
  ];
  it("finds by persistent key or by id", () => {
    expect(findTileByKey(tabs, "k:t1")).toEqual({ tabId: "tab-1", paneId: "pane-1" });
    expect(findTileByKey(tabs, "i:pane-3")).toEqual({ tabId: "tab-2", paneId: "pane-3" });
    expect(findTileByKey(tabs, "k:pane-2")).toBeNull();
    expect(findTileByKey(tabs, "pane-2")).toBeNull();
    expect(findTabByKey(tabs, "k:tab1")).toBe("tab-1");
    expect(findTabByKey(tabs, "i:tab-2")).toBe("tab-2");
    expect(findTabByKey(tabs, "tab-2")).toBeNull();
  });
});

it("reads refusal heads", () => {
  expect(refusalOf("[mirror-no-home] closed")).toBe("no-home");
  expect(refusalOf(new Error("[mirror-unsaved]"))).toBe("unsaved");
  expect(refusalOf("[mirror-weird]")).toBeNull();
  expect(refusalOf("boom")).toBeNull();
});
