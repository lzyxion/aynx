import { describe, expect, it } from "vitest";
import { workspaceDots, rawWorkspaceDots, mergeWorkspaceDots } from "./status";
import { leafOf, newStartPane, type TabSpec, type Tr } from "$lib/session";

const tr: Tr = (key) => key;
const tab = (id: string, workspaceId: string): TabSpec => ({ id, workspaceId, title: id, root: leafOf(newStartPane()) });

describe("workspace raw status fold", () => {
  it("includes the selected tab, folds per workspace and keeps the existing priority", () => {
    const tabs = [tab("a1", "A"), tab("a2", "A"), tab("b1", "B")];
    const dots = workspaceDots(tabs,
      { a1: { state: "fail", name: "shell", others: 0 }, b1: { state: "running", name: "shell", others: 0 } },
      { a2: [{ name: "Claude", state: "finished" }] }, { b1: true }, tr);
    expect(dots.A?.winner).toMatchObject({ source: "agent", state: "finished" });
    expect(dots.B?.winner).toMatchObject({ source: "command", state: "running" });
    const permission = workspaceDots(tabs,
      { a1: { state: "fail", name: "shell", others: 0 } },
      { a2: [{ name: "Claude", state: "permission" }] }, {}, tr);
    expect(permission.A?.winner).toMatchObject({ source: "agent", state: "permission" });
    expect(permission.B).toBeNull();
  });
  it("folds fail before agent running, success before activity, and excludes cold tabs", () => {
    const tabs = [tab("a1", "A"), tab("a2", "A"), tab("b1", "B")];
    const dots = workspaceDots(tabs,
      { a1: { state: "fail", name: "shell", others: 0 }, b1: { state: "ok", name: "shell", others: 0 } },
      { a2: [{ name: "Codex", state: "running" }] }, { b1: true }, tr);
    expect(dots.A?.winner).toMatchObject({ source: "command", state: "fail" });
    expect(dots.B?.winner).toMatchObject({ source: "command", state: "ok" });
    expect(dots.C).toBeUndefined();
  });
});

describe("global workspace raw dots", () => {
  it("merges every window with the same priority and removes a departed window's contribution", () => {
    const local = workspaceDots([tab("a", "A")], { a: { state: "fail", name: "shell", others: 0 } }, {}, {}, tr);
    const reports = [{ A: { source: "agent", state: "running" } as const }, { A: { source: "agent", state: "permission" } as const }];
    expect(mergeWorkspaceDots(local, reports, tr).A?.winner).toMatchObject({ source: "agent", state: "permission" });
    expect(mergeWorkspaceDots(local, reports.slice(0, 1), tr).A?.winner).toMatchObject({ source: "command", state: "fail" });
  });
  it("sends no titles, paths, command lines or opt-in data", () => {
    const local = workspaceDots([tab("a", "A")], {}, { a: [{ name: "private title", state: "finished" }] }, {}, tr);
    const raw = rawWorkspaceDots(local);
    expect(raw).toEqual({ A: { source: "agent", state: "finished" } });
    expect(JSON.stringify(raw)).not.toContain("private title");
    expect(mergeWorkspaceDots({}, [raw], tr).A?.winner).toMatchObject({ source: "agent", state: "finished" });
  });
});
