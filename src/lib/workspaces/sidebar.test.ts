import { describe, expect, it } from "vitest";
import { canDeleteWorkspace, reorderWorkspaceIds, stepWorkspaceId, workspaceDropBefore, workspaceRowTip } from "./sidebar";

describe("workspace deletion", () => {
  it("disables deletion until there is another workspace", () => {
    expect(canDeleteWorkspace(0)).toBe(false);
    expect(canDeleteWorkspace(1)).toBe(false);
    expect(canDeleteWorkspace(2)).toBe(true);
    expect(canDeleteWorkspace(8)).toBe(true);
  });
});

describe("workspace pointer reorder", () => {
  const ids = ["A", "B", "C", "D"];
  const rows = ids.map((id, i) => ({ id, top: 10 + i * 30, height: 26 }));

  it("returns a full permutation before a row or at the end without changing its input", () => {
    expect(reorderWorkspaceIds(ids, "A", "C")).toEqual(["B", "A", "C", "D"]);
    expect(reorderWorkspaceIds(ids, "D", "A")).toEqual(["D", "A", "B", "C"]);
    expect(reorderWorkspaceIds(ids, "B", null)).toEqual(["A", "C", "D", "B"]);
    expect(ids).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps the original array for self, adjacent, end and missing targets", () => {
    expect(reorderWorkspaceIds(ids, "B", "B")).toBe(ids);
    expect(reorderWorkspaceIds(ids, "B", "C")).toBe(ids);
    expect(reorderWorkspaceIds(ids, "D", null)).toBe(ids);
    expect(reorderWorkspaceIds(ids, "missing", "A")).toBe(ids);
    expect(reorderWorkspaceIds(ids, "A", "missing")).toBe(ids);
    const only = ["A"];
    expect(reorderWorkspaceIds(only, "A", null)).toBe(only);
  });

  it("uses row midpoints, including gaps and both ends", () => {
    expect(workspaceDropBefore(rows, 0)).toBe("A");
    expect(workspaceDropBefore(rows, 22)).toBe("A");
    expect(workspaceDropBefore(rows, 23)).toBe("B");
    expect(workspaceDropBefore(rows, 38)).toBe("B");
    expect(workspaceDropBefore(rows, 113)).toBeNull();
    expect(workspaceDropBefore([], 0)).toBeNull();
  });

  it("the midpoint preview produces the same drop permutation", () => {
    expect(reorderWorkspaceIds(ids, "A", workspaceDropBefore(rows, 85))).toEqual(["B", "C", "A", "D"]);
    expect(reorderWorkspaceIds(ids, "D", workspaceDropBefore(rows, 12))).toEqual(["D", "A", "B", "C"]);
  });
});

describe("workspace next/prev shortcut", () => {
  const ids = ["A", "B", "C"];
  it("steps in list order and wraps around", () => {
    expect(stepWorkspaceId(ids, "A", 1)).toBe("B");
    expect(stepWorkspaceId(ids, "C", 1)).toBe("A");
    expect(stepWorkspaceId(ids, "B", -1)).toBe("A");
    expect(stepWorkspaceId(ids, "A", -1)).toBe("C");
  });
  it("does nothing with one workspace or an unknown current", () => {
    expect(stepWorkspaceId(["A"], "A", 1)).toBeNull();
    expect(stepWorkspaceId(["A"], "A", -1)).toBeNull();
    expect(stepWorkspaceId([], null, 1)).toBeNull();
    expect(stepWorkspaceId(ids, null, 1)).toBeNull();
    expect(stepWorkspaceId(ids, "Z", 1)).toBeNull();
  });
});

describe("workspace row tip", () => {
  const tr = (key: string, params?: Record<string, string | number>) => `${key}|${params?.name}|${params?.n ?? ""}`;
  it("names the most urgent badge, then another window, then just the name", () => {
    expect(workspaceRowTip(tr, "W", { kind: "input", n: 2 }, true)).toBe("app.workspaces.cell.waiting|W|2");
    expect(workspaceRowTip(tr, "W", { kind: "fail", n: 1 }, false)).toBe("app.workspaces.cell.fail|W|1");
    expect(workspaceRowTip(tr, "W", { kind: "running", n: 3 }, false)).toBe("app.workspaces.cell.running|W|3");
    expect(workspaceRowTip(tr, "W", null, true)).toBe("app.workspaces.cell.away|W|");
    expect(workspaceRowTip(tr, "W", null, false)).toBe("W");
  });
});
