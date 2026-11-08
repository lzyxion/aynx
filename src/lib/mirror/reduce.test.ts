import { describe, expect, it } from "vitest";
import type { PaneSpec } from "$lib/session/spec";
import { buildSnapshot, type MirrorSnapshot } from "./snapshot";
import { liveKeys, paneKeyOf, pickMirrorWorkspace, reduceMirror, type MirrorLocal } from "./reduce";
import { mirrorTileMode } from "./tile-policy";

// 원격 웹 R2-B — 받은 스냅숏을 원격 창의 탭으로. 같은 타일은 같은 id(시청자가 다시 붙지 않게), 원격의 고름은 집 PC 가 바꿀 때까지.

const term = (id: string, key: string, extra: Partial<PaneSpec> = {}): PaneSpec => ({
  id,
  kind: "local",
  tileKey: key,
  historyStreamId: `s-${key}`,
  ...extra,
});

function snapOf(opts: {
  active: string;
  tabs: { id: string; key: string; panes: PaneSpec[]; focus?: string; zoom?: string }[];
}): MirrorSnapshot {
  return buildSnapshot({
    source: "home",
    workspace: { id: "w", name: "W" },
    activeTabId: opts.active,
    tabs: opts.tabs.map((t) => ({
      id: t.id,
      tabKey: t.key,
      title: t.id,
      zoomedPaneId: t.zoom ?? null,
      root:
        t.panes.length === 1
          ? { type: "leaf", pane: t.panes[0] }
          : { type: "split", dir: "row", ratio: 0.5, a: { type: "leaf", pane: t.panes[0] }, b: { type: "leaf", pane: t.panes[1] } },
    })),
    focusOf: (tab) => opts.tabs.find((t) => t.id === tab.id)?.focus ?? null,
  });
}

const leafIds = (r: ReturnType<typeof reduceMirror>) =>
  r.tabs.map((t) => (t.root.type === "leaf" ? [t.root.pane.id] : [t.root.a, t.root.b].map((n) => (n.type === "leaf" ? n.pane.id : "?"))));

const localOf = (activeId: string | null, focus: Record<string, string> = {}): MirrorLocal => ({
  activeId,
  focusOf: (id) => focus[id] ?? null,
  zoomOf: () => null,
});

describe("reduceMirror", () => {
  const one = snapOf({ active: "tab-1", tabs: [{ id: "tab-1", key: "A", panes: [term("pane-1", "t1")], focus: "pane-1" }] });

  it("gives remote ids and follows the home active tab on first sight", () => {
    const r = reduceMirror(one, null, null, new Map());
    expect(r.tabs.map((t) => [t.id, t.workspaceId])).toEqual([["htab-1", "w"]]);
    expect(leafIds(r)).toEqual([["hpane-1"]]);
    expect(r.activeId).toBe("htab-1");
    expect(r.focus).toEqual({ "htab-1": "hpane-1" });
  });

  it("keeps ids and the same pane object when home splits a tile", () => {
    const r1 = reduceMirror(one, null, null, new Map());
    const p1 = r1.tabs[0].root.type === "leaf" ? r1.tabs[0].root.pane : null;
    const split = snapOf({
      active: "tab-1",
      tabs: [{ id: "tab-1", key: "A", panes: [term("pane-1", "t1"), term("pane-2", "t2", { shell: "cmd" })], focus: "pane-2" }],
    });
    const r2 = reduceMirror(split, r1.memory, localOf("htab-1"), new Map());
    expect(leafIds(r2)).toEqual([["hpane-1", "hpane-2"]]);
    const a = r2.tabs[0].root.type === "split" && r2.tabs[0].root.a.type === "leaf" ? r2.tabs[0].root.a.pane : null;
    expect(a).toBe(p1); // 그대로 — PaneHost 의 상자 · 시청자가 다시 붙지 않는다
    expect(r2.focus["htab-1"]).toBe("hpane-2"); // 집 PC 가 포커스를 옮겼다 — 따라간다
  });

  it("replaces the pane object when home changed that tile", () => {
    const r1 = reduceMirror(one, null, null, new Map());
    const changed = snapOf({ active: "tab-1", tabs: [{ id: "tab-1", key: "A", panes: [term("pane-1", "t1", { tmux: "x" })] }] });
    const r2 = reduceMirror(changed, r1.memory, localOf("htab-1"), new Map());
    const p = r2.tabs[0].root.type === "leaf" ? r2.tabs[0].root.pane : null;
    expect(p?.tmux).toBe("x");
    expect(p?.id).toBe("hpane-1");
  });

  it("keeps the remote's own tab pick until home switches tabs", () => {
    const two = snapOf({
      active: "tab-1",
      tabs: [
        { id: "tab-1", key: "A", panes: [term("pane-1", "t1")] },
        { id: "tab-2", key: "B", panes: [term("pane-2", "t2")] },
      ],
    });
    const r1 = reduceMirror(two, null, null, new Map());
    expect(r1.activeId).toBe("htab-1");
    // 원격이 탭 2 를 골랐다 — 집 PC 의 다른 변화(제목)에는 그대로.
    const retitled = { ...two, tabs: two.tabs.map((t) => ({ ...t, title: "x" })) };
    const r2 = reduceMirror(retitled, r1.memory, localOf("htab-2"), new Map());
    expect(r2.activeId).toBe("htab-2");
    // 집 PC 가 탭을 바꾸면 따라간다.
    const switched = { ...two, activeTabId: "tab-2" };
    const r3 = reduceMirror(switched, r2.memory, localOf("htab-1"), new Map());
    expect(r3.activeId).toBe("htab-2");
    // 원격이 고른 탭이 사라지면 집 PC 의 탭으로.
    const gone = snapOf({ active: "tab-2", tabs: [{ id: "tab-2", key: "B", panes: [term("pane-2", "t2")] }] });
    const r4 = reduceMirror(gone, r3.memory, localOf("htab-1"), new Map());
    expect(r4.activeId).toBe("htab-2");
  });

  it("recognises tiles by tileKey when ids are reissued (saved-layout source)", () => {
    const r1 = reduceMirror(one, null, null, new Map());
    const reissued = snapOf({ active: "tab-9", tabs: [{ id: "tab-9", key: "A", panes: [term("pane-44", "t1")] }] });
    const r2 = reduceMirror(reissued, r1.memory, localOf("htab-1"), new Map());
    expect(r2.tabs[0].id).toBe("htab-1");
    expect(leafIds(r2)).toEqual([["hpane-1"]]);
  });

  it("maps a borrowed source pane to its remote id", () => {
    const s = snapOf({
      active: "tab-1",
      tabs: [
        {
          id: "tab-1",
          key: "A",
          panes: [term("pane-1", "t1", { kind: "ssh", alias: "web" }), { id: "pane-2", kind: "sftp", tileKey: "t2", alias: "web", sourcePaneId: "pane-1" }],
        },
      ],
    });
    const r = reduceMirror(s, null, null, new Map());
    const b = r.tabs[0].root.type === "split" && r.tabs[0].root.b.type === "leaf" ? r.tabs[0].root.b.pane : null;
    expect(b?.sourcePaneId).toBe("hpane-1");
  });

  it("shows a placeholder for query tiles until the remote opens its own", () => {
    const q: PaneSpec = { id: "pane-5", kind: "query", tileKey: "q5", query: { connId: "c1", name: "app.db" } };
    const s = snapOf({ active: "tab-1", tabs: [{ id: "tab-1", key: "A", panes: [term("pane-1", "t1"), q] }] });
    const r1 = reduceMirror(s, null, null, new Map());
    expect(r1.placeholders).toEqual(["hpane-5"]);
    expect(r1.placeholderKeys["hpane-5"]).toBe(paneKeyOf(q));
    const own: PaneSpec = { id: "rpane-77", kind: "query", tileKey: "fresh", query: { connId: "c1" } };
    const r2 = reduceMirror(s, r1.memory, localOf("htab-1"), new Map([[paneKeyOf(q), own]]));
    expect(r2.placeholders).toEqual([]);
    const b = r2.tabs[0].root.type === "split" && r2.tabs[0].root.b.type === "leaf" ? r2.tabs[0].root.b.pane : null;
    expect(b).toBe(own);
    expect(liveKeys(s).has(paneKeyOf(q))).toBe(true);
  });

  it("never hands out the same id twice", () => {
    const dup = snapOf({ active: "tab-1", tabs: [{ id: "tab-1", key: "A", panes: [term("pane-1", "t1"), { id: "pane-1", kind: "local" }] }] });
    const r = reduceMirror(dup, null, null, new Map());
    const ids = leafIds(r)[0];
    expect(new Set(ids).size).toBe(2);
  });
});

describe("mirrorTileMode", () => {
  it("classifies every tile kind", () => {
    expect(mirrorTileMode("local")).toBe("viewer");
    expect(mirrorTileMode("ssh")).toBe("viewer");
    for (const k of ["start", "localfs", "sftp", "doc", "branches", "diff", "run"]) expect(mirrorTileMode(k)).toBe("render");
    // 걷은 작업안 타일(2026-10-25)은 모르는 종류 — 자리 표시
    expect(mirrorTileMode("plans")).toBe("own");
    expect(mirrorTileMode("query")).toBe("own");
    expect(mirrorTileMode("something-new")).toBe("own");
  });
});

describe("pickMirrorWorkspace — 원격이 볼 워크스페이스(10-20)", () => {
  const live = new Set(["w1", "w2"]);
  it("처음 · 집 PC 가 바꿨으면 따라가고, 아니면 원격의 고름을 둔다", () => {
    expect(pickMirrorWorkspace("w1", null, "w2", live)).toBe("w1");
    expect(pickMirrorWorkspace("w1", "w1", "w2", live)).toBe("w2");
    expect(pickMirrorWorkspace("w2", "w1", "w1", live)).toBe("w2");
  });
  it("고른 것이 사라졌거나 cold 면 집 PC 의 지금 것", () => {
    expect(pickMirrorWorkspace("w1", "w1", "w3", live)).toBe("w1");
    expect(pickMirrorWorkspace("w1", "w1", null, live)).toBe("w1");
  });
});

describe("reduceMirror — 여러 워크스페이스(10-20)", () => {
  function multi(home: string, active: Record<string, string>): MirrorSnapshot {
    const leaf = (p: PaneSpec) => ({ type: "leaf" as const, pane: p });
    return buildSnapshot({
      source: "home",
      workspace: { id: home, name: home },
      workspaces: [
        { id: "w1", name: "Home", activeTabId: active.w1 ?? null },
        { id: "w2", name: "회사", activeTabId: active.w2 ?? null },
        { id: "w3", name: "개인", cold: true, tabCount: 4, activeTabId: null },
      ],
      activeTabId: active[home] ?? null,
      tabs: [
        { id: "tab-1", tabKey: "A", title: "a", workspaceId: "w1", root: leaf(term("pane-1", "t1")) },
        { id: "tab-2", tabKey: "B", title: "b", workspaceId: "w2", root: leaf(term("pane-2", "t2")) },
        { id: "tab-3", tabKey: "C", title: "c", workspaceId: "w2", root: leaf(term("pane-3", "t3")) },
      ],
      focusOf: () => null,
    });
  }
  const local = (ws: string | null, picks: Record<string, string>): MirrorLocal => ({
    workspaceId: ws,
    activeOf: (w) => picks[w] ?? null,
    activeId: null,
    focusOf: () => null,
    zoomOf: () => null,
  });

  it("모든 워크스페이스의 탭을 소속과 함께 · 처음은 집 PC 의 지금 워크스페이스 · 워크스페이스마다 활성 탭", () => {
    const r = reduceMirror(multi("w1", { w1: "tab-1", w2: "tab-3" }), null, null, new Map());
    expect(r.tabs.map((t) => [t.id, t.workspaceId])).toEqual([
      ["htab-1", "w1"],
      ["htab-2", "w2"],
      ["htab-3", "w2"],
    ]);
    expect(r.workspaceId).toBe("w1");
    expect(r.activeId).toBe("htab-1");
    expect(r.activeByWs).toEqual({ w1: "htab-1", w2: "htab-3" });
  });

  it("원격이 다른 워크스페이스를 고르면 집 PC 가 바꿀 때까지 둔다 — 집 PC 는 그대로", () => {
    const s = multi("w1", { w1: "tab-1", w2: "tab-3" });
    const r1 = reduceMirror(s, null, null, new Map());
    // 원격이 w2 의 tab-2 를 골랐다
    const r2 = reduceMirror(s, r1.memory, local("w2", { w1: "htab-1", w2: "htab-2" }), new Map());
    expect([r2.workspaceId, r2.activeId]).toEqual(["w2", "htab-2"]);
    // 집 PC 가 w1 안에서 무엇을 바꿔도(같은 워크스페이스) 원격은 w2 그대로
    const r3 = reduceMirror(multi("w1", { w1: "tab-1", w2: "tab-3" }), r2.memory, local("w2", { w2: "htab-2" }), new Map());
    expect([r3.workspaceId, r3.activeId]).toEqual(["w2", "htab-2"]);
    // 집 PC 가 w2 로 가면 따라간다(그 워크스페이스의 집 PC 활성 탭으로)
    const r4 = reduceMirror(multi("w2", { w1: "tab-1", w2: "tab-3" }), r3.memory, local("w1", { w1: "htab-1", w2: "htab-2" }), new Map());
    expect([r4.workspaceId, r4.activeId]).toEqual(["w2", "htab-3"]);
  });

  it("집 PC 가 보지 않는 워크스페이스의 활성 탭이 바뀌면(원격 새 탭) 원격의 그 워크스페이스도 따라간다", () => {
    const r1 = reduceMirror(multi("w1", { w1: "tab-1", w2: "tab-2" }), null, null, new Map());
    const r2 = reduceMirror(multi("w1", { w1: "tab-1", w2: "tab-2" }), r1.memory, local("w2", { w2: "htab-2" }), new Map());
    expect(r2.activeId).toBe("htab-2");
    const r3 = reduceMirror(multi("w1", { w1: "tab-1", w2: "tab-3" }), r2.memory, local("w2", { w2: "htab-2" }), new Map());
    expect([r3.workspaceId, r3.activeId]).toEqual(["w2", "htab-3"]);
  });

  it("cold 는 고를 수 없다 — 원격의 고름이 cold 면 집 PC 의 지금 것 · 타일 id 는 워크스페이스를 바꿔도 같다", () => {
    const s = multi("w1", { w1: "tab-1", w2: "tab-2" });
    const r1 = reduceMirror(s, null, null, new Map());
    const r2 = reduceMirror(s, r1.memory, local("w3", {}), new Map());
    expect(r2.workspaceId).toBe("w1");
    expect(r2.activeByWs).not.toHaveProperty("w3");
    const r3 = reduceMirror(s, r2.memory, local("w2", {}), new Map());
    expect(r3.workspaceId).toBe("w2");
    expect(leafIds(r3)).toEqual(leafIds(r1));
    const paneOfTab = (r: ReturnType<typeof reduceMirror>, i: number) => (r.tabs[i].root.type === "leaf" ? r.tabs[i].root.pane : null);
    expect(paneOfTab(r3, 1)).toBe(paneOfTab(r1, 1)); // 같은 명세 객체를 다시 쓴다(시청자가 다시 붙지 않는다)
  });
});
