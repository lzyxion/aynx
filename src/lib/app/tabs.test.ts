import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { TabSpec } from "$lib/session";

// 도메인 상태만 검사한다 — 화면·백엔드는 스텁, 트리 조작은 실제 구현을 쓴다.
vi.hoisted(() => { vi.stubGlobal("$state", <T>(value: T) => value); });
vi.mock("$lib/app/workspace-status.svelte.js", () => ({ focusAuxTile: vi.fn() }));
vi.mock("$lib/app/workspaces.svelte.js", () => ({
  bootWorkspaces: vi.fn(), currentWorkspaceId: () => "A",
  ensureWorkspaceKeys: (tab: TabSpec) => { tab.workspaceId = "A"; },
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
vi.mock("$lib/app/window.svelte.js", () => ({ isMainWindow: true, isRemote: false }));
vi.mock("$lib/settings.svelte.js", () => ({ settings: {} }));
vi.mock("$lib/layout-anim.svelte.js", () => ({ CLOSE_SLIDE_DELAY_MS: 120, noteTileClosing: vi.fn(() => false), withLayoutAnim: vi.fn((mutate: () => unknown) => mutate()) }));
vi.mock("$lib/keybindings", () => ({ displayCombo: vi.fn(), effectiveCombo: vi.fn() }));
vi.mock("$lib/app/doc-dirty.svelte.js", () => ({ isDocDirty: () => false, setDocDirty: vi.fn() }));
vi.mock("$lib/app/unsaved-docs", () => ({ confirmUnsavedClose: vi.fn() }));
vi.mock("$lib/app/db-tx", () => ({ confirmDbTxClose: vi.fn(async () => true), dbTxPanes: () => [], hasOpenDbTx: () => false }));

import { leafOf, listPanes, newLocalPane, newTab, splitPane } from "$lib/session";
import { noteTileClosing, withLayoutAnim } from "$lib/layout-anim.svelte.js";
import {
  activeTabId, closePaneIn, detachPane, detachPaneLeavingStart, focusPane, isLoneStart,
  movePane, openTab, paneOf, promotePane, residentWindowTabs, syncPanes, toggleSync, toggleZoom,
  restoreNotice, revealPane, unzoomFor,
} from "./tabs.svelte.js";
import { revealResidentPane } from "$lib/workspaces/runtime";

afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  residentWindowTabs().splice(0);
  syncPanes.clear();
  vi.clearAllMocks();
});

function singleTab(): TabSpec {
  const tab = newTab();
  tab.root = leafOf(newLocalPane());
  return openTab(tab);
}

function expectStart(tab: TabSpec, movedId: string) {
  const panes = listPanes(tab.root);
  expect(panes).toHaveLength(1);
  expect(panes[0].kind).toBe("start");
  expect(panes[0].id).not.toBe(movedId);
  expect(paneOf(tab)).toBe(panes[0].id);
  expect(syncPanes.get(tab.id)?.size).toBe(0);
  expect(isLoneStart(tab)).toBe(true);
  expect(residentWindowTabs()).toContain(tab);
}

it.each(["detach", "handoff"])("마지막 타일 떼기는 시작 타일·포커스·동시 입력을 함께 정리한다 (%s)", (kind) => {
  const tab = singleTab();
  const pane = listPanes(tab.root)[0];
  toggleSync(tab.id);
  if (kind === "detach") expect(detachPane(pane.id)).toBe(pane);
  else detachPaneLeavingStart(tab, pane.id);
  expectStart(tab, pane.id);
  expect(withLayoutAnim).toHaveBeenCalled();
});

it("다른 탭 타일 옆으로 마지막 타일을 옮기면 원래 탭은 사라진다", () => {
  const from = singleTab();
  const pane = listPanes(from.root)[0];
  const target = singleTab();
  const targetPane = listPanes(target.root)[0];
  toggleSync(from.id);
  toggleSync(target.id);
  movePane(pane.id, targetPane.id, "row", "after");
  expect(residentWindowTabs()).toEqual([target]);
  expect(syncPanes.has(from.id)).toBe(false);
  expect(listPanes(target.root)).toEqual([targetPane, pane]);
  expect(paneOf(target)).toBe(pane.id);
  expect(syncPanes.get(target.id)?.has(pane.id)).toBe(true);
  expect(activeTabId()).toBe(target.id);
});

it.each(["before", "end"])("마지막 타일 승격은 원래 탭을 없애고 지정한 탭 순서와 제목 상속을 지킨다 (%s)", (position) => {
  const from = singleTab();
  const pane = listPanes(from.root)[0];
  from.name = "배포";
  const next = singleTab();
  toggleSync(from.id);
  promotePane(pane.id, position === "before" ? next.id : null);
  const ordered = residentWindowTabs();
  const promoted = ordered.find((tab) => tab.id !== from.id && tab.id !== next.id)!;
  expect(ordered).not.toContain(from);
  expect(syncPanes.has(from.id)).toBe(false);
  expect(ordered.map((tab) => tab.id)).toEqual(position === "before" ? [promoted.id, next.id] : [next.id, promoted.id]);
  expect(listPanes(promoted.root)).toEqual([pane]);
  expect(promoted.name).toBe(from.name);
  expect(promoted.title).toBe(from.title);
  expect(paneOf(promoted)).toBe(pane.id);
  expect(syncPanes.has(promoted.id)).toBe(false);
  expect(activeTabId()).toBe(promoted.id);
});

it("타일이 여럿인 탭에서 하나를 다른 탭으로 옮기면 원래 탭은 남는다", () => {
  const from = singleTab();
  const pane = listPanes(from.root)[0];
  const stay = newLocalPane();
  from.root = splitPane(from.root, pane.id, "row", stay);
  const target = singleTab();
  movePane(pane.id, listPanes(target.root)[0].id, "row", "after");
  expect(residentWindowTabs()).toEqual([from, target]);
  expect(listPanes(from.root)).toEqual([stay]);
});

it("여럿인 탭에서도 떼는 길은 최대화와 포커스·포함 집합을 함께 정리한다", () => {
  const tab = singleTab();
  const pane = listPanes(tab.root)[0];
  const remaining = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", remaining);
  toggleSync(tab.id);
  focusPane(tab.id, pane.id);
  toggleZoom(tab.id, pane.id);
  detachPane(pane.id);
  expect(tab.zoomedPaneId).toBeNull();
  expect(listPanes(tab.root)).toEqual([remaining]);
  expect(paneOf(tab)).toBe(remaining.id);
  expect([...syncPanes.get(tab.id)!]).toEqual([remaining.id]);
});

it("포커스만 옮기는 열기(이미 있는 칸) — 다른 타일이 최대화 중이면 풀고, 최대화된 그 타일이면 그대로 둔다", () => {
  const tab = singleTab();
  const shell = listPanes(tab.root)[0];
  const doc = newLocalPane();
  tab.root = splitPane(tab.root, shell.id, "row", doc);
  toggleZoom(tab.id, shell.id);
  unzoomFor(tab, shell.id);
  expect(tab.zoomedPaneId).toBe(shell.id);
  unzoomFor(tab, doc.id);
  expect(tab.zoomedPaneId).toBeNull();
  unzoomFor(tab, doc.id); // 최대화가 없으면 아무 일도 없다
  expect(tab.zoomedPaneId).toBeNull();
});

it("이미 있는 타일로 가기(revealPane) — 다른 타일로 가면 최대화를 풀고, 최대화된 그 타일 자신이면 유지한다", () => {
  const tab = singleTab();
  const shell = listPanes(tab.root)[0];
  const doc = newLocalPane();
  tab.root = splitPane(tab.root, shell.id, "row", doc);
  // 워크스페이스 전환·탭 찾기는 `workspaces/runtime` 의 몫이다 — 여기서는 넘겨받은 `select` 만 그대로 부른다.
  const select = (_tabs: readonly TabSpec[], id: string, cb: { select: (t: TabSpec, id: string) => void }) => { cb.select(tab, id); return true; };
  vi.mocked(revealResidentPane).mockImplementationOnce(select).mockImplementationOnce(select);
  toggleZoom(tab.id, shell.id);
  revealPane(shell.id);
  expect(tab.zoomedPaneId).toBe(shell.id);
  expect(paneOf(tab)).toBe(shell.id);
  revealPane(doc.id);
  expect(tab.zoomedPaneId).toBeNull();
  expect(paneOf(tab)).toBe(doc.id);
});

it("닫힘 유령은 사람이 타일 하나를 닫을 때만 — 떼어 내기 · 이관 · 마지막 타일(탭 닫기)에는 없다", () => {
  const tab = singleTab();
  const pane = listPanes(tab.root)[0];
  const other = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", other);
  closePaneIn(tab.id, other.id);
  expect(noteTileClosing).toHaveBeenCalledExactlyOnceWith(other.id);
  vi.mocked(noteTileClosing).mockClear();
  const third = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", third);
  detachPane(third.id);
  const fourth = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", fourth);
  detachPaneLeavingStart(tab, fourth.id);
  closePaneIn(tab.id, pane.id); // 마지막 타일 — 탭 닫기로 간다
  expect(noteTileClosing).not.toHaveBeenCalled();
});

it("차례 닫기 — 유령이 섰을 때만 옆 타일의 미끄러짐을 늦춘다", () => {
  const tab = singleTab();
  const pane = listPanes(tab.root)[0];
  const a = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", a);
  vi.mocked(noteTileClosing).mockReturnValueOnce(true);
  closePaneIn(tab.id, a.id);
  expect(vi.mocked(withLayoutAnim).mock.calls.at(-1)?.[1]).toBe(120);
  const b = newLocalPane();
  tab.root = splitPane(tab.root, pane.id, "row", b);
  closePaneIn(tab.id, b.id); // 유령 없음(연타 · 움직임 줄이기 등) — 곧바로
  expect(vi.mocked(withLayoutAnim).mock.calls.at(-1)?.[1]).toBe(0);
});

it("자기 자신 위에 놓으면 시작 타일을 만들지 않고 그대로 둔다", () => {
  const tab = singleTab();
  const pane = listPanes(tab.root)[0];
  movePane(pane.id, pane.id, "row", "before");
  expect(listPanes(tab.root)).toEqual([pane]);
  expect(withLayoutAnim).not.toHaveBeenCalled();
});

it("stay — 옮긴 타일은 받는 탭의 포커스가 되지만 보던 탭은 그대로다", () => {
  const target = singleTab();
  const targetPane = listPanes(target.root)[0];
  const viewed = singleTab();
  const pane = listPanes(viewed.root)[0];
  const rest = newLocalPane();
  viewed.root = splitPane(viewed.root, pane.id, "row", rest);
  movePane(pane.id, targetPane.id, "row", "after", { stay: true });
  expect(activeTabId()).toBe(viewed.id);
  expect(listPanes(viewed.root)).toEqual([rest]);
  expect(listPanes(target.root)).toEqual([targetPane, pane]);
  expect(paneOf(target)).toBe(pane.id);
});

it("stay — 보던 탭이 아닌 탭의 마지막 타일을 빼 오면 그 탭만 사라지고 보던 탭은 그대로다", () => {
  const from = singleTab();
  const pane = listPanes(from.root)[0];
  const viewed = singleTab();
  movePane(pane.id, listPanes(viewed.root)[0].id, "row", "before", { stay: true });
  expect(residentWindowTabs()).toEqual([viewed]);
  expect(activeTabId()).toBe(viewed.id);
  const other = singleTab();
  const third = singleTab();
  movePane(listPanes(third.root)[0].id, listPanes(other.root)[0].id, "col", "after", { stay: true });
  expect(residentWindowTabs()).toEqual([viewed, other]);
  // 보던 탭이 사라지는 이동이었으므로 그때만 받는 탭으로 간다
  expect(activeTabId()).toBe(other.id);
});

it("다른 워크스페이스의 마지막 탭에서 마지막 타일을 빼면 탭은 시작 타일로 남는다", () => {
  const away = singleTab();
  away.workspaceId = "B";
  const pane = listPanes(away.root)[0];
  const here = singleTab();
  movePane(pane.id, listPanes(here.root)[0].id, "row", "after", { stay: true });
  expect(residentWindowTabs()).toEqual([away, here]);
  expect(listPanes(away.root)[0].kind).toBe("start");
  expect(listPanes(here.root)).toContainEqual(pane);
  expect(activeTabId()).toBe(here.id);

  const away2 = singleTab();
  away2.workspaceId = "C";
  const pane2 = listPanes(away2.root)[0];
  promotePane(pane2.id, null);
  expect(residentWindowTabs()).toContain(away2);
  expect(listPanes(away2.root)[0].kind).toBe("start");
  expect(listPanes(residentWindowTabs().at(-1)!.root)).toEqual([pane2]);
  expect(residentWindowTabs().at(-1)!.workspaceId).toBe("A");
});

it("옮긴 뒤에도 같은 워크스페이스에 탭이 있으면 마지막 타일의 탭은 예전처럼 사라진다(받는 탭이 다른 워크스페이스여도)", () => {
  const from = singleTab();
  from.workspaceId = "B";
  const sibling = singleTab();
  sibling.workspaceId = "B";
  const here = singleTab();
  movePane(listPanes(from.root)[0].id, listPanes(here.root)[0].id, "row", "after", { stay: true });
  expect(residentWindowTabs()).toEqual([sibling, here]);
});

it("복원 안내 — 연결 대기 타일(붙기 시도 뒤에도 남은 것)이 없으면 탭 수만, 있으면 자동/수동 (세션 코어 ②-2)", () => {
  expect(restoreNotice(2, 0, false)).toBe("tabs");
  expect(restoreNotice(2, 0, true)).toBe("tabs");
  expect(restoreNotice(2, 1, true)).toBe("auto");
  expect(restoreNotice(2, 1, false)).toBe("manual");
  expect(restoreNotice(0, 0, false)).toBeNull();
});
