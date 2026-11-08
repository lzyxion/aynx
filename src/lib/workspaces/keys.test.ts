import { describe, expect, it } from "vitest";
import { adoptTab, leafOf, listPanes, newLocalPane, newStartPane, type TabSpec } from "$lib/session";
import { deserialize, parseTabFile, saveNode, serialize } from "$lib/tabs";
import { newTabKey, newTileKey } from "./schema";

it("tabKey/tileKey survive serialize, parse, deserialize and adoptTab while runtime IDs change", () => {
  const pane = newLocalPane();
  pane.tileKey = newTileKey();
  const tab: TabSpec = { id: "tab-original", tabKey: newTabKey(), workspaceId: "A", title: "test", root: leafOf(pane) };
  expect(saveNode(tab.root)).not.toHaveProperty("tileKey"); // 트리 명세만 저장할 때는 영속 키 포함을 명시해야 한다.
  const saved = parseTabFile(JSON.stringify(serialize([tab], tab.id)))!;
  const restored = deserialize(saved).tabs[0];
  expect(restored.id).not.toBe(tab.id);
  expect(restored.tabKey).toBe(tab.tabKey);
  expect(listPanes(restored.root)[0].tileKey).toBe(pane.tileKey);
  const adopted = adoptTab(tab, () => undefined);
  expect(adopted.id).not.toBe(tab.id);
  expect(adopted.tabKey).toBe(tab.tabKey);
  expect(adopted.workspaceId).toBe("A");
  expect(listPanes(adopted.root)[0].id).not.toBe(pane.id);
  expect(listPanes(adopted.root)[0].tileKey).toBe(pane.tileKey);
});

it("restores both split leaf keys independently of runtime IDs", () => {
  const left = newStartPane();
  const right = newStartPane();
  left.tileKey = newTileKey();
  right.tileKey = newTileKey();
  const tab: TabSpec = {
    id: "tab-split", tabKey: newTabKey(), title: "split",
    root: { type: "split", dir: "row", ratio: 0.5, a: leafOf(left), b: leafOf(right) },
  };
  const restored = deserialize(serialize([tab], tab.id)).tabs[0];
  expect(listPanes(restored.root).map((p) => p.tileKey)).toEqual([left.tileKey, right.tileKey]);
  expect(restored.tabKey).not.toBe(tab.id);
  expect(listPanes(restored.root).every((p) => p.tileKey !== p.id)).toBe(true);
});

describe("flag OFF persistence compatibility", () => {
  it("does not add optional workspace keys to a legacy tab or leaf", () => {
    const tab: TabSpec = { id: "tab-1", title: "test", root: leafOf(newStartPane()) };
    expect(serialize([tab], tab.id)).toEqual({ version: 1, activeIndex: 0, workspaces: [{ title: "test", root: { kind: "start" } }] });
  });
});

it("explicit projectId survives v2 persistence; legacy title/cwd never infer identity", () => {
  const tab: TabSpec = { id: "project-tab", projectId: "P1", tabKey: newTabKey(), workspaceId: "A", title: "same", root: leafOf(newLocalPane()) };
  const saved = parseTabFile(JSON.stringify(serialize([tab], tab.id)))!;
  expect(saved.workspaces[0].projectId).toBe("P1");
  expect(deserialize(saved).tabs[0].projectId).toBe("P1");
  expect(adoptTab(tab, () => undefined).projectId).toBe("P1");
  delete tab.projectId;
  tab.pinnedTitle = "same";
  tab.projectFolder = "/known/project";
  expect(deserialize(serialize([tab], tab.id)).tabs[0]).not.toHaveProperty("projectId");
});
