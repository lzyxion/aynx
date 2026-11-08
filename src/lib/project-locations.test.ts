import { describe, expect, it } from "vitest";
import { locationsForProject, matchProjectLocation, normalizedLocationPath, openHereFirst, openLocationMarkers, projectOpenPlan, worktreeTabsVerdict, type OpenLocation, type ProjectFolder } from "./project-locations";

const folders: ProjectFolder[] = [
  { projectId: "local", host: null, path: "C:/src/api" },
  { projectId: "local", host: null, path: "C:/src/api/worktrees/feature" },
  { projectId: "nested", host: null, path: "C:/src/api/packages/nested" },
  { projectId: "remote", host: "Dev", path: "/srv/api" },
  { projectId: "remote", host: "Dev", path: "/srv/api/wt/nested" },
];
const location = (over: Partial<OpenLocation> = {}): OpenLocation => ({
  workspaceId: "A", tabId: "tab-a", paneId: "pane-a", host: null, folder: "C:/src/api", ...over,
});

describe("host + folder location matching", () => {
  it("local Windows separators/case and path boundaries", () => {
    expect(matchProjectLocation(location({ folder: "c:\\SRC\\API\\src\\" }), folders)?.projectId).toBe("local");
    expect(matchProjectLocation(location({ folder: "C:/src/api-neighbor" }), folders)).toBeNull();
    expect(normalizedLocationPath("C:/", null)).toBe("c:");
  });
  it("longest known worktree or nested project wins over a saved projectId hint", () => {
    expect(matchProjectLocation(location({ folder: "C:/src/api/worktrees/feature/src" }), folders)?.path).toBe(folders[1].path);
    expect(matchProjectLocation(location({ folder: "C:/src/api/packages/nested/src", projectId: "local" }), folders)?.projectId).toBe("nested");
    expect(matchProjectLocation(location({ folder: null, projectId: "local" }), folders)).toBeNull();
  });
  it("host alias matches case-insensitively, remote paths stay case-sensitive", () => {
    expect(matchProjectLocation(location({ host: "dev", folder: "/srv/api/wt/nested/src" }), folders)?.path).toBe(folders[4].path);
    expect(matchProjectLocation(location({ host: null, folder: "/srv/api" }), folders)).toBeNull();
    expect(matchProjectLocation(location({ host: "other", folder: "/srv/api" }), folders)).toBeNull();
    expect(matchProjectLocation(location({ host: "dev", folder: "/srv/API" }), folders)).toBeNull();
  });
  it("remote home from an aux pane expands saved project paths", () => {
    const opened = location({ host: "dev", folder: "/home/dev/api/src", remoteHome: "/home/dev" });
    const known = [{ projectId: "remote", host: "dev", path: "~/api" }];
    expect(matchProjectLocation(opened, known)?.projectId).toBe("remote");
    expect(locationsForProject("remote", [opened], known, "~/api")).toEqual([opened]);
  });
  it("a worktree's pane does not count as a pane in the main folder", () => {
    const opens = [location({ folder: "C:/src/api/worktrees/feature/src" })];
    expect(locationsForProject("local", opens, folders)).toHaveLength(1);
    expect(locationsForProject("local", opens, folders, "C:/src/api")).toHaveLength(0);
    expect(locationsForProject("local", opens, folders, folders[1].path)).toHaveLength(1);
  });
});
describe("workspace markers and open plan", () => {
  const workspaces = [{ id: "A", name: "Alpha" }, { id: "B", name: "Beta" }, { id: "C", name: "Gamma" }];
  it("here dot, one elsewhere name plus count, and stable open-here-first ordering", () => {
    const markers = openLocationMarkers([location(), location({ workspaceId: "B" }), location({ workspaceId: "B" }), location({ workspaceId: "C" })], "A", workspaces);
    expect(markers.here).toBe(true);
    expect(markers.badge).toBe("Beta ↗ +1");
    expect(markers.elsewhere.map((w) => w.id)).toEqual(["B", "C"]);
    expect(openHereFirst(["a", "b", "c", "d"], (id) => id === "b" || id === "d")).toEqual(["b", "d", "a", "c"]);
    expect(openLocationMarkers([], "A", workspaces)).toEqual({ here: false, elsewhere: [], badge: null });
  });
  it("focuses the most recently focused current-workspace pane, including aux", () => {
    const recent = location({ paneId: "aux:pane", aux: true, focusedAt: 20 });
    expect(projectOpenPlan([location({ focusedAt: 10 }), recent, location({ workspaceId: "B", focusedAt: 30 })], "A", true)).toEqual({ kind: "focus", location: recent });
  });
  it("elsewhere alone opens here, lone plain start reuses, project start creates a tab", () => {
    expect(projectOpenPlan([location({ workspaceId: "B" })], "A", false)).toEqual({ kind: "new" });
    expect(projectOpenPlan([], "A", true)).toEqual({ kind: "reuse" });
    expect(projectOpenPlan([], "A", false)).toEqual({ kind: "new" });
  });
});

describe("worktreeTabsVerdict — tabs closed with a removed worktree", () => {
  const known: ProjectFolder[] = [
    { projectId: "p", host: null, path: String.raw`C:\src\app` },
    { projectId: "p", host: null, path: String.raw`C:\src\app-wt\fe` },
    { projectId: "p", host: null, path: String.raw`C:\src\app-wt\fe2` },
    { projectId: "r", host: "Dev", path: "~/api" },
    { projectId: "r", host: "Dev", path: "~/api-wt/fe" },
  ];
  const target: ProjectFolder = { projectId: "p", host: null, path: String.raw`C:\src\app-wt\fe` };
  const loc = (folder: string | null, host: string | null = null, remoteHome: string | null = null) => ({ host, folder, remoteHome });
  it("closes tabs whose every tile is inside, separators and case ignored on Windows", () => {
    const v = worktreeTabsVerdict(
      [
        { tabId: "a", locations: [loc("c:/SRC/app-wt/FE/src"), loc(String.raw`C:\src\app-wt\fe`)] },
        { tabId: "b", locations: [loc(String.raw`C:\src\app-wt\fe2`)] },
        { tabId: "c", locations: [loc(String.raw`C:\src\app`)] },
      ],
      target,
      known,
    );
    expect(v).toEqual({ close: ["a"], mixed: 0 });
  });
  it("fe does not swallow fe2 or fe-old (path boundary)", () => {
    const v = worktreeTabsVerdict([{ tabId: "x", locations: [loc("C:/src/app-wt/fe-old")] }], target, known);
    expect(v).toEqual({ close: [], mixed: 0 });
  });
  it("mixed tabs are kept and counted; unrelated tabs are not counted", () => {
    const v = worktreeTabsVerdict(
      [
        { tabId: "m", locations: [loc("C:/src/app-wt/fe"), loc("C:/src/app")] },
        { tabId: "u", locations: [null, loc("C:/src/app-wt/fe")] },
        { tabId: "n", locations: [null] },
      ],
      target,
      known,
    );
    expect(v).toEqual({ close: [], mixed: 2 });
  });
  it("a deeper registered folder inside the worktree owns its own tiles", () => {
    const nested = [...known, { projectId: "q", host: null, path: "C:/src/app-wt/fe/packages/q" }];
    const v = worktreeTabsVerdict([{ tabId: "q", locations: [loc("C:/src/app-wt/fe/packages/q/src")] }], target, nested);
    expect(v).toEqual({ close: [], mixed: 0 });
  });
  it("target missing from the known list still matches", () => {
    const v = worktreeTabsVerdict([{ tabId: "a", locations: [loc("C:/src/app-wt/fe")] }], target, [known[0]]);
    expect(v.close).toEqual(["a"]);
  });
  it("remote: same alias (case-insensitive) with ~ expanded, paths case-sensitive, local tiles never match", () => {
    const rt: ProjectFolder = { projectId: "r", host: "Dev", path: "~/api-wt/fe" };
    const v = worktreeTabsVerdict(
      [
        { tabId: "r1", locations: [loc("/home/u/api-wt/fe/src", "dev", "/home/u")] },
        { tabId: "r2", locations: [loc("/home/u/api-wt/FE", "dev", "/home/u")] },
        { tabId: "l", locations: [loc("/home/u/api-wt/fe")] },
      ],
      rt,
      known,
    );
    expect(v).toEqual({ close: ["r1"], mixed: 0 });
  });
});
