import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { PaneSpec, TabSpec } from "$lib/session/spec";
import type { OpenLocation } from "$lib/project-locations";
import type { Project } from "$lib/projects";
import type { FileChange } from "$lib/context";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

const state = vi.hoisted(() => {
  vi.stubGlobal("$state", <T>(value: T) => value);
  return { tab: null as TabSpec | null, locations: [] as OpenLocation[], reveal: vi.fn(), newTab: vi.fn(), here: vi.fn(), start: vi.fn(), applyInstructions: vi.fn(async (_projectId: string, _path: string): Promise<FileChange[]> => []) };
});
vi.mock("$lib/app/tabs.svelte.js", () => ({ activeTab: () => state.tab, openInNewTab: state.newTab, openPaneHere: state.here }));
vi.mock("$lib/app/workspaces.svelte.js", () => ({ currentWorkspaceId: () => "A" }));
vi.mock("$lib/app/project-locations.svelte.js", () => ({ projectLocations: () => state.locations, revealProjectLocation: state.reveal }));
vi.mock("$lib/app/agent-sessions.svelte.js", () => ({ projectStartPaneFor: state.start }));
vi.mock("$lib/app/project-list.svelte.js", () => ({ projects: () => [], putProjectLocal: vi.fn(), dropProjectLocal: vi.fn() }));
vi.mock("$lib/app/panes.svelte.js", () => ({ defaultShellId: async () => "pwsh", knownAiClis: async () => [] }));
vi.mock("$lib/app/hosts.svelte.js", () => ({ lookupHost: () => null }));
vi.mock("$lib/app/worktrees.svelte.js", () => ({ loadWorktrees: vi.fn(), worktreesOf: () => undefined, listProjectWorktrees: vi.fn() }));
vi.mock("$lib/app/remote-home.svelte.js", () => ({ liveSessionFor: () => null }));
vi.mock("$lib/app/recent-worktrees.svelte.js", () => ({ recordProjectFolderOpen: vi.fn() }));
vi.mock("$lib/context", () => ({ worktreeSetupCount: async () => 0, setAgentHooksRemote: vi.fn(), instructionsApplyWorktree: state.applyInstructions }));
vi.mock("$lib/clipboard", () => ({ writeClipboard: vi.fn() }));
vi.mock("$lib/app/prompts.svelte.js", () => ({ rememberTarget: vi.fn() }));
vi.mock("$lib/app/focus-return.svelte.js", () => ({ rememberFocusOrigin: vi.fn(), returnFocus: vi.fn() }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: vi.fn((key: string) => key) }));
vi.mock("$lib/toast.svelte.js", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("$lib/app/git-repo", () => ({ createProjectFolder: vi.fn(async () => ({ path: "~/created", branch: "main" })), GitIdentityError: class extends Error {}, initRepoAt: vi.fn(), repoStatusOf: vi.fn() }));
vi.mock("$lib/app/remote-hooks", () => ({ installRemoteHooksOn: vi.fn() }));

import { openProjectInNewWorktree, openProject, openProjectHere, openProjectWorktree, openProjectForm, setProjectField, setProjectFormKind, setProjectParent, submitProjectForm } from "./projects.svelte.js";
afterAll(() => vi.unstubAllGlobals());
const project: Project = { id: "P", name: "api", host: null, path: "C:/api", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };
const pane: PaneSpec = { id: "start", kind: "start" };
beforeEach(() => {
  vi.clearAllMocks();
  state.applyInstructions.mockReset();
  state.applyInstructions.mockResolvedValue([]);
  state.tab = { id: "tab", title: "plain", root: { type: "leaf", pane: { ...pane } } };
  state.locations = [];
  state.start.mockResolvedValue({ ...pane, id: "project-start", startProject: { projectId: "P", folder: project.path } });
});
it("open here focuses an existing tab/pane without making a pane", async () => {
  const existing: OpenLocation = { workspaceId: "A", tabId: "existing", paneId: "existing-pane", host: null, folder: project.path };
  state.locations = [existing];
  await openProject(project);
  expect(state.reveal).toHaveBeenCalledExactlyOnceWith(existing);
  expect(state.start).not.toHaveBeenCalled();
  expect(state.newTab).not.toHaveBeenCalled();
  expect(state.here).not.toHaveBeenCalled();
});
it("lone plain start tab is reused with title, projectFolder and projectId", async () => {
  await openProject(project);
  expect(state.newTab).not.toHaveBeenCalled();
  expect(state.here).toHaveBeenCalledOnce();
  expect(state.tab).toMatchObject({ title: "api", pinnedTitle: "api", projectFolder: "C:/api", projectId: "P" });
});
it("a project start is kept and the worktree opens in a new tab", async () => {
  state.tab!.root = { type: "leaf", pane: { ...pane, startProject: { projectId: "P", folder: project.path } } };
  const worktree = { path: "C:/api-wt/feature", branch: "feature", head: null, bare: false, detached: false };
  await openProjectWorktree(project, worktree);
  expect(state.newTab).toHaveBeenCalledWith(expect.anything(), "api · feature", worktree.path, "P");
  expect(state.here).not.toHaveBeenCalled();
});
it("explicit open in this tab adds a tile even when the location is already open", async () => {
  state.locations = [{ workspaceId: "A", paneId: "existing", host: null, folder: project.path }];
  await openProjectHere(project);
  expect(state.here).toHaveBeenCalledOnce();
  expect(state.reveal).not.toHaveBeenCalled();
});

it.each([false, true])("create/register payload has no workspace membership (create=%s)", async (create) => {
  vi.mocked(invoke).mockImplementation(async (_cmd, args) => ({ ...(args as { project: object }).project, id: "new" }));
  openProjectForm(undefined, "dev");
  setProjectField("name", "new");
  setProjectField("path", "~/new");
  if (create) { setProjectFormKind("create"); setProjectParent("~/projects"); }
  await submitProjectForm();
  const payload = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "project_upsert")?.[1] as { project: object };
  expect(payload).toBeDefined();
  expect(payload.project).not.toHaveProperty("workspaceId");
});
it.each([null, "dev"])("opening forwards explicit identity (host=%s)", async (host) => {
  state.tab!.root = { type: "leaf", pane: { ...pane, startProject: { projectId: "other", folder: "/other" } } };
  const p = { ...project, host };
  await openProject(p);
  expect(state.newTab).toHaveBeenCalledWith(expect.anything(), p.name, host ? undefined : p.path, p.id);
  await openProjectHere(p);
  expect(state.here).toHaveBeenCalledWith(expect.anything(), p.name, p.id);
});

it("new local worktree waits for instructions before preparing or opening its tile", async () => {
  const path = "C:/api-wt/feature";
  vi.mocked(invoke).mockResolvedValue({ path, branch: "feature", branch_created: true });
  let finish!: (changes: FileChange[]) => void;
  state.applyInstructions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const opening = openProjectInNewWorktree(project, "feature");
  await vi.waitFor(() => expect(state.applyInstructions).toHaveBeenCalledExactlyOnceWith(project.id, path));
  expect(state.start).not.toHaveBeenCalled();
  expect(state.newTab).not.toHaveBeenCalled();
  finish([{ path: path + "/AGENTS.md", scope: "project", projectId: project.id, host: null, agent: null, action: "create", reason: null, block: "body" }]);
  await opening;
  expect(state.start).toHaveBeenCalledWith(project.id, path);
  expect(state.newTab).toHaveBeenCalledWith(expect.anything(), "api · feature", path, project.id);
  expect(t).toHaveBeenCalledWith("app.projects.worktree.instructionsApplied", { message: "app.projects.worktree.created", count: 1 });
  expect(toast.success).toHaveBeenCalledWith("app.projects.worktree.instructionsApplied", expect.anything());
});

it.each(["reject", "error", "skipped"])("new worktree still opens after instruction failure (%s)", async (failure) => {
  const path = "C:/api-wt/feature";
  vi.mocked(invoke).mockResolvedValue({ path, branch: "feature", branch_created: true });
  if (failure === "reject") {
    state.applyInstructions.mockRejectedValueOnce(new Error("[not-empty] failed"));
  } else {
    state.applyInstructions.mockResolvedValueOnce([{ path: path + "/AGENTS.md", scope: "project", projectId: project.id, host: null, agent: null, action: failure as "error" | "skipped", reason: "[not-empty] failed", block: null }]);
  }
  await openProjectInNewWorktree(project, "feature");
  expect(state.newTab).toHaveBeenCalledWith(expect.anything(), "api · feature", path, project.id);
  expect(t).toHaveBeenCalledWith("app.projects.worktree.instructionsFailed", { reason: "failed" });
  expect(toast.info).toHaveBeenCalledExactlyOnceWith("app.projects.worktree.instructionsFailed");
  expect(toast.success).toHaveBeenCalledWith("app.projects.worktree.created", expect.anything());
});
