import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { TabSpec } from "$lib/session";

// 원격 창(R2-B)의 탭 모듈 — 배치를 바꾸는 조작은 막히고(안내 한 줄), 거울 환원 결과만 탭이 된다. `tabs.test.ts` 와 같은 스텁에 원격 표식만 켰다.
vi.hoisted(() => { vi.stubGlobal("$state", <T>(value: T) => value); });
vi.mock("$lib/app/workspace-status.svelte.js", () => ({ focusAuxTile: vi.fn() }));
vi.mock("$lib/app/workspaces.svelte.js", () => ({
  bootWorkspaces: vi.fn(), currentWorkspaceId: () => "w",
  ensureWorkspaceKeys: (tab: TabSpec) => { tab.workspaceId = "w"; },
  flushWorkspaceSave: vi.fn(), scheduleWorkspaceSave: vi.fn(), switchWorkspace: vi.fn(),
}));
vi.mock("$lib/workspaces/runtime", () => ({ revealResidentPane: vi.fn() }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/app/bell.svelte.js", () => ({ clearBellMarks: vi.fn(), hasBellMark: () => false }));
vi.mock("$lib/app/agent-unseen.svelte.js", () => ({ clearAgentUnseen: vi.fn() }));
vi.mock("$lib/app/console.svelte.js", () => ({ bumpBlocks: vi.fn() }));
vi.mock("$lib/app/usage-view.svelte.js", () => ({ leaveCoverView: () => false, coverViewOpen: () => false }));
vi.mock("$lib/pane/tab-slide.svelte.js", () => ({ clearTabSlide: vi.fn(), requestTabSlide: vi.fn() }));
vi.mock("$lib/pane/focus", () => ({ focusPaneBody: vi.fn() }));
vi.mock("$lib/app/window.svelte.js", () => ({ isMainWindow: false, isRemote: true }));
vi.mock("$lib/settings.svelte.js", () => ({ settings: {} }));
vi.mock("$lib/layout-anim.svelte.js", () => ({ CLOSE_SLIDE_DELAY_MS: 120, noteTileClosing: vi.fn(() => false), withLayoutAnim: vi.fn((mutate: () => unknown) => mutate()) }));
vi.mock("$lib/keybindings", () => ({ displayCombo: vi.fn(), effectiveCombo: vi.fn() }));
vi.mock("$lib/app/doc-dirty.svelte.js", () => ({ isDocDirty: () => false, setDocDirty: vi.fn() }));
vi.mock("$lib/app/unsaved-docs", () => ({ confirmUnsavedClose: vi.fn() }));
vi.mock("$lib/app/db-tx", () => ({ confirmDbTxClose: vi.fn(async () => true), dbTxPanes: () => [], hasOpenDbTx: () => false }));

import { leafOf, newLocalPane, newTab } from "$lib/session";
import { showNotice } from "$lib/app/notice";
import {
  activeTabId, applyMirrorTabs, closePaneIn, currentWorkspaceTabs, mirrorLocalChoice, openTab, paneOf, pickTab,
  residentWindowTabs, splitActive, setRemoteLayoutSink, openPaneHere, renameTab, moveTile, closeTabsAsked, movePane,
  placePane, openPaneBeside, queueRemoteFileUi,
} from "./tabs.svelte.js";
import type { LayoutRequest } from "$lib/mirror/request";

afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  setRemoteLayoutSink(null);
  residentWindowTabs().splice(0);
  vi.clearAllMocks();
});

// 파일 타일 보기(2026-11-04) — 연타는 끝값 하나 · 타일마다 · 몸통이 없으면 조용히 버린다
it("묶어서 끝값 하나만 요청한다 — 안내는 없다", () => {
  vi.useFakeTimers();
  try {
    const sent: LayoutRequest[] = [];
    setRemoteLayoutSink((req) => sent.push(req));
    for (let zoom = 0; zoom <= 4; zoom++) queueRemoteFileUi("a", { zoom });
    queueRemoteFileUi("a", { hidden: true });
    queueRemoteFileUi("b", { view: "icons" });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([
      { op: "fileUi", tile: "a", zoom: 4, hidden: true },
      { op: "fileUi", tile: "b", view: "icons" },
    ]);
    setRemoteLayoutSink(null);
    queueRemoteFileUi("a", { preview: true });
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(2);
    expect(showNotice).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

function mirrored(id: string, paneIds: string[]): TabSpec {
  const panes = paneIds.map((p) => ({ ...newLocalPane(), id: p }));
  const root: TabSpec["root"] =
    panes.length === 1 ? leafOf(panes[0]) : { type: "split", dir: "row", ratio: 0.5, a: leafOf(panes[0]), b: leafOf(panes[1]) };
  return { id, title: id, workspaceId: "w", root };
}

it("blocks layout edits in a remote window with one notice while no request sink is set", () => {
  applyMirrorTabs([mirrored("htab-1", ["hpane-1"])], "htab-1", { "htab-1": "hpane-1" });
  const before = JSON.stringify(residentWindowTabs());
  openTab(newTab());
  splitActive("row");
  closePaneIn("htab-1", "hpane-1");
  expect(JSON.stringify(residentWindowTabs())).toBe(before);
  expect(showNotice).toHaveBeenCalledTimes(1); // 연타해도 안내는 한 번(몇 초에 한 번)
});

it("applies the mirror and keeps local tab picks", () => {
  applyMirrorTabs([mirrored("htab-1", ["hpane-1"]), mirrored("htab-2", ["hpane-2", "hpane-3"])], "htab-1", {
    "htab-1": "hpane-1",
    "htab-2": "hpane-3",
  });
  expect(currentWorkspaceTabs().map((t) => t.id)).toEqual(["htab-1", "htab-2"]);
  expect(activeTabId()).toBe("htab-1");
  pickTab("htab-2"); // 원격에서 고르기는 된다(집 PC 를 바꾸지 않는다)
  expect(activeTabId()).toBe("htab-2");
  expect(paneOf(currentWorkspaceTabs()[1])).toBe("hpane-3");
  const local = mirrorLocalChoice();
  expect(local.activeId).toBe("htab-2");
  expect(local.focusOf("htab-2")).toBe("hpane-3");
  // 집 PC 에서 탭이 사라지면 그 기록도 거둔다.
  applyMirrorTabs([mirrored("htab-1", ["hpane-1"])], "htab-1", { "htab-1": "hpane-1" });
  expect(activeTabId()).toBe("htab-1");
  expect(mirrorLocalChoice().focusOf("htab-2")).toBeNull();
});

// R3 — 요청 몸통이 걸리면 배치 함수는 트리를 바꾸지 않고 요청(원격 id)을 넘긴다.
it("turns layout edits into requests and leaves the mirror untouched", async () => {
  const sent: LayoutRequest[] = [];
  setRemoteLayoutSink((req) => sent.push(req));
  applyMirrorTabs([mirrored("htab-1", ["hpane-1", "hpane-2"])], "htab-1", { "htab-1": "hpane-2" });
  const before = JSON.stringify(residentWindowTabs());
  splitActive("col");
  closePaneIn("htab-1", "hpane-1");
  renameTab("htab-1", "빌드");
  moveTile("left");
  movePane("hpane-1", "hpane-2", "row", "before", { stay: true });
  const fresh = newLocalPane();
  openPaneHere(fresh);
  expect(openPaneBeside("htab-1", "hpane-1", fresh, "row")).toBe(true);
  expect(await closeTabsAsked(["htab-1"])).toBe(false);
  // 새 탭 + 같은 틱의 놓기 → 요청 하나(시작 타일 자리를 그 타일이 대신)
  const tab = openTab(newTab());
  const ssh = newLocalPane();
  placePane(tab, leafOf(ssh), paneOf(tab), "row", "after");
  await Promise.resolve();
  expect(JSON.stringify(residentWindowTabs())).toBe(before);
  expect(sent.map((r) => r.op)).toEqual([
    "split", "closeTile", "renameTab", "swapTile", "moveTile", "openPane", "openBeside", "closeTabs", "newTab",
  ]);
  expect(sent[0]).toEqual({ op: "split", tile: "hpane-2", dir: "col" });
  expect(sent.find((r) => r.op === "moveTile")).toMatchObject({ stay: true }); // 보던 탭 그대로 — 집 PC 화면이 튀지 않게
  expect(sent[3]).toEqual({ op: "swapTile", tile: "hpane-2", dir: "left" });
  expect(sent[5]).toMatchObject({ op: "openPane", tab: "htab-1", pane: fresh });
  expect(sent[8]).toEqual({ op: "newTab", pane: ssh, workspace: "w" });
  expect(showNotice).not.toHaveBeenCalled();
});
