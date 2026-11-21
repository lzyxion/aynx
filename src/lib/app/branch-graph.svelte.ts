import { invoke } from "../ipc";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { repoStatusOf } from "$lib/app/git-repo";
import { livePaneFor, liveSessionFor, remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { projectById, projects } from "$lib/app/project-list.svelte.js";
import { loadWorktrees, worktreesOf } from "$lib/app/worktrees.svelte.js";
import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { openDoc } from "$lib/app/panes.svelte.js";
import { activeTab, focusTile, focusedPane, openPaneHere, tabOfPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { placeOf, projectFolders } from "$lib/dock-dots";
import { isRemote, type Project } from "$lib/projects";
import { listPanes, newBranchesPane, type PaneSpec } from "$lib/session";
import {
  joinWorktreeFile,
  parseCommitFiles,
  parseCommitGraph,
  parseWipFiles,
  type CommitFiles,
  type CommitGraph,
  type WipFiles,
} from "$lib/branch-graph";

/**
 * 브랜치 타일(커밋 그래프) — 시계는 없다(주기 폴링 금지). 원격은 그 호스트에 이미 붙은 세션이 있을 때만 읽는다 —
 * 보려고 새 접속을 열지 않는다(docs/log/2026-10-04-commit-graph.md).
 */

export type GraphRead =
  | { state: "ok"; graph: CommitGraph }
  | { state: "offline" }
  | { state: "notRepo" }
  | { state: "error"; message: string };

export type FilesRead<T> = { state: "ok"; files: T } | { state: "offline" } | { state: "error"; message: string };

const messageOf = (e: unknown) => stripReason(e instanceof Error ? e.message : String(e));

/** 호스트 · 경로만 본다 — 앨범 그래프는 프로젝트로 등록되지 않은 저장소도 읽는다 */
export async function readCommitGraph(p: Pick<Project, "host" | "path">, mainLimit: number): Promise<GraphRead> {
  try {
    let raw: unknown;
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      raw = await invoke<unknown>("ssh_git_commit_graph", { id, repo: p.path, mainLimit });
    } else {
      raw = await invoke<unknown>("git_commit_graph", { repo: p.path, mainLimit });
    }
    const graph = parseCommitGraph(raw);
    return graph ? { state: "ok", graph } : { state: "error", message: t("app.branches.error.shape") };
  } catch (e) {
    // 저장소가 아닌지는 구조적으로 한 번 더 묻는다 — git 의 오류 문구는 로케일을 탄다
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: messageOf(e) };
  }
}

async function readFiles<T>(
  p: Project,
  local: string,
  remote: string,
  args: Record<string, string>,
  parse: (raw: unknown) => T | null,
): Promise<FilesRead<T>> {
  try {
    let raw: unknown;
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      raw = await invoke<unknown>(remote, { id, repo: p.path, ...args });
    } else {
      raw = await invoke<unknown>(local, { repo: p.path, ...args });
    }
    const files = parse(raw);
    return files ? { state: "ok", files } : { state: "error", message: t("app.branches.error.shape") };
  } catch (e) {
    return { state: "error", message: messageOf(e) };
  }
}

export function readCommitFiles(p: Project, hash: string): Promise<FilesRead<CommitFiles>> {
  return readFiles(p, "git_commit_files", "ssh_git_commit_files", { hash }, parseCommitFiles);
}

export function readWipFiles(p: Project, path: string): Promise<FilesRead<WipFiles>> {
  return readFiles(p, "git_worktree_wip_files", "ssh_git_worktree_wip_files", { path }, parseWipFiles);
}

/** 다른 탭의 것은 찾지 않는다 — 그리로 초점이 건너가면 왜 탭이 바뀌었는지 헷갈린다 */
function findBranchesPane(projectId: string): { tabId: string; pane: PaneSpec } | null {
  const tab = activeTab();
  if (!tab) return null;
  for (const pane of listPanes(tab.root)) {
    if (pane.kind === "branches" && pane.branchGraph?.projectId === projectId) return { tabId: tab.id, pane };
  }
  return null;
}

/** 에이전트 고리가 서려면 그 프로젝트의 워크트리 목록이 읽혀 있어야 한다 — 아직이면 한 번 읽는다 */
export function openBranchGraph(p: Project, branch?: string | null): void {
  const b = branch?.trim() || null;
  const found = findBranchesPane(p.id);
  if (found) {
    if (b && found.pane.branchGraph) found.pane.branchGraph = { ...found.pane.branchGraph, branch: b };
    focusTile(found.tabId, found.pane.id);
  } else {
    const pane = newBranchesPane(p.id, b);
    pane.branchGraph = { ...(pane.branchGraph ?? { projectId: p.id }), name: p.name };
    // 이름이 먼저 서 있어야 빈 탭을 대신할 때 탭 제목(`loneTileTitle`)이 선다
    openPaneHere(pane, undefined, p.id);
  }
  if (worktreesOf(p.id) === undefined) void loadWorktrees(p);
}

function placeOfPane(pane: PaneSpec | null, tabFolder: string | null): { projectId: string; worktree: string | null } | null {
  if (pane?.kind === "branches" && pane.branchGraph?.projectId) return { projectId: pane.branchGraph.projectId, worktree: null };
  if (pane?.kind === "start" && pane.startProject) return { projectId: pane.startProject.projectId, worktree: pane.startProject.folder };
  let at: { host: string | null; start: string | null; current: string | null } | null = null;
  if (pane?.kind === "local") at = { host: null, start: pane.cwd?.trim() || null, current: localReportedFolder(pane) };
  else if (pane?.kind === "ssh" && !pane.adhoc && pane.alias?.trim())
    at = { host: pane.alias.trim(), start: pane.cwd?.trim() || null, current: reportedCwd(pane.id)?.trim() || null };
  else if ((pane?.kind === "localfs" || pane?.kind === "doc" || pane?.kind === "image" || pane?.kind === "sftp") && pane.path)
    at = { host: pane.alias?.trim() || null, start: null, current: pane.path };
  const folders = projectFolders(projects(), worktreesOf, remoteHomeOf);
  const found =
    (at ? placeOf(at, folders, remoteHomeOf) : null) ??
    (tabFolder ? placeOf({ host: null, start: tabFolder, current: null }, folders, remoteHomeOf) : null);
  return found ? { projectId: found.projectId, worktree: found.worktree } : null;
}

export function openBranchGraphHere(): void {
  const tab = activeTab();
  const at = placeOfPane(focusedPane(), tab?.projectFolder?.trim() || null);
  const p = at ? projectById(at.projectId) : null;
  if (!at || !p) {
    showNotice(t("app.branches.open.noProject"));
    return;
  }
  const listing = worktreesOf(p.id);
  const branch =
    at.worktree && listing?.state === "ok" ? (listing.list.find((w) => w.path === at.worktree)?.branch ?? null) : null;
  openBranchGraph(p, branch);
}

export function openBranchGraphOfPane(paneId: string, branch: string | null): void {
  const tab = tabOfPane(paneId);
  const pane = tab ? (listPanes(tab.root).find((p) => p.id === paneId) ?? null) : null;
  const at = placeOfPane(pane, tab?.projectFolder?.trim() || null);
  const p = at ? projectById(at.projectId) : null;
  if (!at || !p) {
    showNotice(t("app.branches.open.noProject"));
    return;
  }
  openBranchGraph(p, branch);
}

/** 객체를 통째로 새로 단다 — 분할 복제가 같은 객체를 나눠 들지 않게 */
export function noteBranchGraph(paneId: string, patch: { branch?: string; name?: string }): void {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.id !== paneId || pane.kind !== "branches" || !pane.branchGraph) continue;
      const cur = pane.branchGraph;
      const next = { ...cur, ...patch };
      if (next.branch !== cur.branch || next.name !== cur.name) pane.branchGraph = next;
      return;
    }
  }
}

export function openBranchFile(paneId: string, p: Project, worktree: string, rel: string): void {
  const tab = tabOfPane(paneId);
  if (!tab) return;
  let source: { paneId: string; alias: string } | undefined;
  if (isRemote(p)) {
    const live = livePaneFor(p.host, tab.id);
    if (!live) {
      showNotice(t("app.doc.open.offline"));
      return;
    }
    source = live;
  }
  openDoc({ tabId: tab.id, nearPaneId: paneId, path: joinWorktreeFile(worktree, rel), source });
}

export function focusPaneAnywhere(paneId: string): void {
  const tab = tabOfPane(paneId);
  if (tab) focusTile(tab.id, paneId);
}
