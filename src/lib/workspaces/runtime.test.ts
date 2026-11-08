import { describe, expect, it } from "vitest";
import { leafOf, newStartPane, type TabSpec } from "$lib/session";
import { revealResidentPane, switchResidentWorkspace } from "./runtime";

const tab = (workspaceId: string): TabSpec => ({ id: workspaceId + "-tab", workspaceId, title: workspaceId, root: leafOf(newStartPane()) });

describe("workspace runtime", () => {
  it("materializes only once and preserves resident tab/leaf objects while switching", () => {
    const a = tab("A");
    const resident = [a];
    const pane = a.root;
    const list = [{ id: "A", materialized: true }, { id: "B", materialized: false }];
    let current = "A";
    let count = 0;
    const order: string[] = [];
    const switchTo = (id: string) => switchResidentWorkspace(id, current, list, {
      remember: () => { order.push("remember"); },
      materialize: (workspace) => {
        count += 1;
        order.push("materialize");
        resident.push(tab(workspace.id));
        workspace.materialized = true;
      },
      setCurrent: (id) => { order.push("current"); current = id; },
      restore: () => { order.push("restore"); },
    });
    switchTo("B");
    const b = resident[1];
    expect(order).toEqual(["remember", "materialize", "current", "restore"]);
    switchTo("A");
    switchTo("B");
    expect(count).toBe(1);
    expect(resident[0]).toBe(a);
    expect(resident[0].root).toBe(pane);
    expect(resident[1]).toBe(b);
  });

  it("reveal switches the pane's workspace before selecting only that pane's tab", () => {
    const a = tab("A");
    const b = tab("B");
    const paneId = b.root.type === "leaf" ? b.root.pane.id : "";
    const calls: unknown[] = [];
    expect(revealResidentPane([a, b], paneId, {
      switchWorkspace: (id, selection) => calls.push(["switch", id, selection]),
      select: (tab, paneId) => calls.push(["select", tab.id, paneId]),
    })).toBe(true);
    expect(calls).toEqual([["switch", "B", { tabId: b.id, paneId }], ["select", b.id, paneId]]);
    expect(revealResidentPane([a], "missing", {
      switchWorkspace: () => { throw new Error("must not switch"); },
      select: () => { throw new Error("must not select"); },
    })).toBe(false);
  });
});
