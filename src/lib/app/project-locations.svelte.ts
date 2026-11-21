import { invoke } from "../ipc";
import { requestWindow } from "$lib/workspaces/window-events";
import { tick } from "svelte";
import { listPanes } from "$lib/session/tree";
import type { PaneSpec } from "$lib/session/spec";
import { isSavedSplit, type SavedNode, type SavedLeaf } from "$lib/tabs";
import { expandRemotePath, type Project } from "$lib/projects";
import { locationsForProject, openLocationMarkers, worktreeTabsVerdict, type OpenLocation, type ProjectFolder } from "$lib/project-locations";
import { projects } from "./project-list.svelte.js";
import { worktreesOf } from "./worktrees.svelte.js";
import { recentOpens } from "./recent-worktrees.svelte.js";
import { remoteHomeOf } from "./remote-home.svelte.js";
import { localReportedFolder, reportedCwd } from "./pane-cwd.svelte.js";
import { paneFocusedAt, residentWindowTabs, revealPane } from "./tabs.svelte.js";
import { auxProjectLocations, focusAuxTile } from "./workspace-status.svelte.js";
import { currentWorkspaceId, switchWorkspace, workspaceList, workspacePlacement, workspaceMainWindow } from "./workspaces.svelte.js";

export function paneProjectLocation(pane: PaneSpec, projectFolder?: string): { host: string | null; folder: string | null; remoteHome: string | null } | null {
  if (pane.adhoc || !["local", "ssh", "start", "localfs", "sftp", "doc", "image", "branches", "diff"].includes(pane.kind)) return null;
  if (pane.kind === "start" && !pane.startProject) return null;
  const host = pane.startProject?.host ?? ((pane.kind === "ssh" || pane.kind === "sftp" || ((pane.kind === "doc" || pane.kind === "image") && pane.alias)) ? pane.alias ?? null : null);
  const reported = host ? reportedCwd(pane.id) : localReportedFolder(pane);
  const folder = reported || pane.startProject?.folder || pane.cwd || pane.restart?.cwd || (pane.kind === "localfs" || pane.kind === "sftp" ? pane.path : undefined) || (!host ? projectFolder : undefined);
  return { host, remoteHome: host ? remoteHomeOf(host) : null, folder: folder ? expandRemotePath(folder, host ? remoteHomeOf(host) : null) : null };
}
export function knownProjectFolders(): ProjectFolder[] {
  return projects().flatMap((project) => {
    const host = project.host || null;
    const listing = worktreesOf(project.id);
    const recent = recentOpens().filter((entry) => entry.projectId === project.id && entry.worktree).map((entry) => entry.worktree!);
    return [project.path, ...recent, ...(listing?.state === "ok" ? listing.list.map((worktree) => worktree.path) : [])].map((path) => ({
      projectId: project.id, host, path: expandRemotePath(path, host ? remoteHomeOf(host) : null),
    }));
  });
}
export function worktreeTabsOf(project: Project, worktreePath: string): { close: string[]; mixed: number } {
  const host = project.host || null;
  const target: ProjectFolder = { projectId: project.id, host, path: expandRemotePath(worktreePath, host ? remoteHomeOf(host) : null) };
  const tabs = residentWindowTabs().map((tab) => ({
    tabId: tab.id,
    locations: listPanes(tab.root).map((pane) => {
      const place = paneProjectLocation(pane, tab.projectFolder);
      return place ? { ...place, projectId: tab.projectId } : null;
    }),
  }));
  return worktreeTabsVerdict(tabs, target, knownProjectFolders());
}
function savedPanes(node: SavedNode): SavedLeaf[] {
  return isSavedSplit(node) ? [...savedPanes(node.a), ...savedPanes(node.b)] : [node];
}
/** `live` · `saved` 를 따로 돌려준다 — 부르는 쪽이 그 사이에 보조 창의 살아 있는 자리를 끼운다(같은 시각이면 앞이 먼저다) */
export function openPaneLocations<E extends Pick<OpenLocation, "host" | "folder">>(
  place: (pane: PaneSpec, projectFolder?: string) => E | null,
  aux: readonly OpenLocation[] = [],
): { live: (OpenLocation & E)[]; saved: (OpenLocation & E)[] } {
  const resident = residentWindowTabs();
  const live: (OpenLocation & E)[] = resident.flatMap((tab) => listPanes(tab.root).flatMap((pane) => {
    const at = place(pane, tab.projectFolder);
    return at && tab.workspaceId ? [{ ...at, workspaceId: tab.workspaceId, tabId: tab.id, paneId: pane.id,
      tabKey: tab.tabKey, tileKey: pane.tileKey, projectId: tab.projectId, focusedAt: paneFocusedAt(pane.id) }] : [];
  }));
  const out: (OpenLocation & E)[] = [];
  const scope = workspacePlacement();
  for (const workspace of workspaceList()) {
    // materialized main 탭은 runtime이 권위다. 알려진 aux는 보고된 live cwd가 권위다.
    const saved = workspace.savedTabs.filter((tab) => {
      if (resident.some((live) => live.tabKey === tab.tabKey)) return false;
      if (aux.some((live) => live.tabKey === tab.tabKey)) return false;
      if (tab.placement.kind === "aux" && workspace.id === currentWorkspaceId()) return false;
      return tab.placement.kind === "aux" ? scope.kind !== "aux" || tab.placement.groupId !== scope.groupId : !workspaceMainWindow() || !workspace.materialized;
    });
    for (const savedTab of saved) {
      for (const leaf of savedPanes(savedTab.root)) {
        const pane = { ...leaf, id: "saved:" + leaf.tileKey } as PaneSpec;
        const at = place(pane, savedTab.projectFolder);
        if (at) out.push({ ...at, workspaceId: workspace.id, tabKey: savedTab.tabKey, tileKey: pane.tileKey,
          projectId: savedTab.projectId, aux: savedTab.placement.kind === "aux", focusedAt: workspace.lastActive.tileKey === pane.tileKey ? workspace.lastActive.at : 0 });
      }
    }
  }
  return { live, saved: out };
}
export function openProjectLocations(): OpenLocation[] {
  const aux = auxProjectLocations();
  const { live, saved } = openPaneLocations(paneProjectLocation, aux);
  return [...live, ...aux, ...saved];
}
export function projectLocations(project: Project, path?: string): OpenLocation[] {
  const host = project.host || null;
  const folders = knownProjectFolders();
  const expanded = path === undefined ? undefined : expandRemotePath(path, host ? remoteHomeOf(host) : null);
  if (expanded) folders.push({ projectId: project.id, host, path: expanded });
  return locationsForProject(project.id, openProjectLocations(), folders, expanded);
}
export function projectMarkers(project: Project, path?: string) {
  return openLocationMarkers(projectLocations(project, path), currentWorkspaceId(), workspaceList());
}
export async function revealProjectLocation(location: OpenLocation): Promise<void> {
  if (workspaceMainWindow() && location.workspaceId !== currentWorkspaceId()) switchWorkspace(location.workspaceId);
  if (location.paneId && (location.aux ? focusAuxTile(location.paneId) : revealPane(location.paneId))) return;
  if (location.aux) {
    const known = auxProjectLocations().find((pane) => pane.tileKey === location.tileKey);
    if (known?.paneId && focusAuxTile(known.paneId)) return;
    if (workspaceMainWindow()) {
      const labels = await invoke<string[]>("workspace_windows");
      for (const label of labels.filter((label) => label !== "main")) {
        const focused = await requestWindow(label, { kind: "focus", tileKey: location.tileKey });
        if (focused === true) { await invoke("focus_window", { label }); return; }
      }
    }
  }
  if (!workspaceMainWindow()) {
    const focused = await requestWindow("main", { kind: "focus", workspaceId: location.workspaceId, tabKey: location.tabKey, tileKey: location.tileKey });
    if (focused === true) await invoke("focus_window", { label: "main" });
    return;
  }
  switchWorkspace(location.workspaceId);
  await tick();
  const tab = residentWindowTabs().find((tab) => tab.tabKey === location.tabKey);
  const pane = tab && listPanes(tab.root).find((pane) => pane.tileKey === location.tileKey);
  if (pane) revealPane(pane.id);
}
