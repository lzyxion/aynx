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
 * **브랜치 타일(커밋 그래프) — 읽기 · 여는 길** (docs/log/2026-10-04-commit-graph.md · 처음 모양은
 * docs/log/2026-09-29-branch-graph.md).
 *
 * 읽는 때는 정해져 있다 — 타일이 뜰 때 · [새로 고침] · [이전 커밋 더 보기] · 줄을 고를 때(그 커밋 · 그 워크트리의 파일).
 * **시계는 없다**(주기 폴링 금지). 에이전트 턴이 끝나면 `app/branch-graph-stale` 의 순번만 오르고 타일은 "새 변경 있음"
 * 한 줄을 세울 뿐이다.
 *
 * 원격은 1단계와 같은 규칙이다: 그 호스트에 **이미 붙은 세션**이 있을 때만 exec 한 번, 없으면 `offline`
 * ("접속 후 표시됩니다"). 무언가를 보려고 새 접속을 열지 않는다. 원격 그래프는 파일 경로를 꺼내지 않고, 경로는 사람이
 * 줄을 골랐을 때 부르는 파일 명령 둘에서만 나온다.
 */

/** 그래프 읽기의 결말 */
export type GraphRead =
  | { state: "ok"; graph: CommitGraph }
  | { state: "offline" }
  | { state: "notRepo" }
  | { state: "error"; message: string };

/** 파일 읽기의 결말 */
export type FilesRead<T> = { state: "ok"; files: T } | { state: "offline" } | { state: "error"; message: string };

const messageOf = (e: unknown) => stripReason(e instanceof Error ? e.message : String(e));

/**
 * 그 저장소의 커밋 그래프를 읽는다(`mainLimit` = 주 줄 앞부분 길이) — 실패는 결말 하나로(throw 없음).
 * 호스트 · 경로만 본다 — 앨범 그래프는 프로젝트로 등록되지 않은 저장소도 읽는다.
 */
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
    // 저장소가 아닌지는 구조적으로 한 번 더 묻는다(git 의 오류 문구는 로케일을 탄다 — 독 목록과 같은 길).
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: messageOf(e) };
  }
}

/** 파일 명령 하나 — 로컬 · 원격 짝, 결말 하나로 */
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

/** 커밋 하나에서 바뀐 파일 — 사람이 그 줄을 골랐을 때만 */
export function readCommitFiles(p: Project, hash: string): Promise<FilesRead<CommitFiles>> {
  return readFiles(p, "git_commit_files", "ssh_git_commit_files", { hash }, parseCommitFiles);
}

/** 워크트리 하나의 커밋 안 한 파일 — 사람이 그 ✎ 줄을 골랐을 때만 */
export function readWipFiles(p: Project, path: string): Promise<FilesRead<WipFiles>> {
  return readFiles(p, "git_worktree_wip_files", "ssh_git_worktree_wip_files", { path }, parseWipFiles);
}

/**
 * **지금 탭에서** 그 프로젝트의 브랜치 타일 — 없으면 `null`. 다른 탭의 것은 찾지 않는다: 그리로 초점이 건너가면
 * 사람은 왜 탭이 바뀌었는지 헷갈린다(10-16 사용자 결정). 다른 탭에 있으면 지금 탭에 하나 더 연다.
 */
function findBranchesPane(projectId: string): { tabId: string; pane: PaneSpec } | null {
  const tab = activeTab();
  if (!tab) return null;
  for (const pane of listPanes(tab.root)) {
    if (pane.kind === "branches" && pane.branchGraph?.projectId === projectId) return { tabId: tab.id, pane };
  }
  return null;
}

/**
 * **브랜치 그래프를 연다** — 독 워크트리 줄의 배지 · 프로젝트/워크트리 우클릭 "브랜치 그래프" · 팔레트가 모두 이리로 온다.
 *
 * 지금 탭에 그 프로젝트의 브랜치 타일이 이미 있으면 새로 세우지 않고 그리로 초점을 옮기고, `branch` 가 있으면 그것을
 * 고른다. 없으면 **지금 탭에 분할로** 연다(새 탭이 아니다 — 검토는 일하던 타일 곁에서 한다). 에이전트 고리가 서려면 독이
 * 그 프로젝트의 워크트리 목록을 읽어 둬야 해서, 아직이면 한 번 읽는다.
 */
export function openBranchGraph(p: Project, branch?: string | null): void {
  const b = branch?.trim() || null;
  const found = findBranchesPane(p.id);
  if (found) {
    if (b && found.pane.branchGraph) found.pane.branchGraph = { ...found.pane.branchGraph, branch: b };
    focusTile(found.tabId, found.pane.id);
  } else {
    const pane = newBranchesPane(p.id, b);
    pane.branchGraph = { ...(pane.branchGraph ?? { projectId: p.id }), name: p.name };
    // 빈 탭을 대신하면 탭 제목은 "브랜치 · <프로젝트>"(`placePane` 의 `loneTileTitle` — 이름이 먼저 서 있어야 한다)
    openPaneHere(pane, undefined, p.id);
  }
  if (worktreesOf(p.id) === undefined) void loadWorktrees(p);
}

/**
 * 타일 하나가 **어느 프로젝트 · 어느 워크트리에 있는가** — 팔레트 "브랜치 그래프" 가 지금 타일의 프로젝트를 고를 때.
 * 셸은 지금 폴더(모르면 시작 폴더), 파일 타일 · 문서는 그 경로, 시작 화면은 그 주소, 브랜치 타일은 자기 프로젝트,
 * 그 밖은 프로젝트 탭의 폴더. 판정은 독의 에이전트 점과 같은 `placeOf`(가장 깊은 등록 폴더)다.
 */
function placeOfPane(pane: PaneSpec | null, tabFolder: string | null): { projectId: string; worktree: string | null } | null {
  if (pane?.kind === "branches" && pane.branchGraph?.projectId) return { projectId: pane.branchGraph.projectId, worktree: null };
  if (pane?.kind === "start" && pane.startProject) return { projectId: pane.startProject.projectId, worktree: pane.startProject.folder };
  let at: { host: string | null; start: string | null; current: string | null } | null = null;
  if (pane?.kind === "local") at = { host: null, start: pane.cwd?.trim() || null, current: localReportedFolder(pane) };
  else if (pane?.kind === "ssh" && !pane.adhoc && pane.alias?.trim())
    at = { host: pane.alias.trim(), start: pane.cwd?.trim() || null, current: reportedCwd(pane.id)?.trim() || null };
  else if ((pane?.kind === "localfs" || pane?.kind === "doc" || pane?.kind === "sftp") && pane.path)
    at = { host: pane.alias?.trim() || null, start: null, current: pane.path };
  const folders = projectFolders(projects(), worktreesOf, remoteHomeOf);
  const found =
    (at ? placeOf(at, folders, remoteHomeOf) : null) ??
    (tabFolder ? placeOf({ host: null, start: tabFolder, current: null }, folders, remoteHomeOf) : null);
  return found ? { projectId: found.projectId, worktree: found.worktree } : null;
}

/** 팔레트 "브랜치 그래프" — 지금 타일의 프로젝트(워크트리 안이면 그 브랜치를 고른 채) */
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

/**
 * 머리줄 브랜치 칩 — **그 타일이 선 프로젝트**의 브랜치 타일을 그 브랜치를 고른 채 연다(`openBranchGraphHere` 와 같은
 * 판정 · 같은 여는 길). 등록된 프로젝트 밖의 저장소면 팔레트와 같은 알림 한 줄이다(브랜치 타일은 프로젝트 단위다).
 */
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

/**
 * 타일에서 고른 브랜치 · 알아낸 프로젝트 이름을 명세에 적는다 — 브랜치는 배치 파일에 실리고(복원하면 그 브랜치를 고른 채),
 * 이름은 머리줄 글자뿐이다(저장하지 않는다). 객체를 통째로 새로 단다(분할 복제가 같은 객체를 나눠 들지 않게).
 */
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

/**
 * 바뀐 파일 하나를 **기존 문서 보기 타일**로 연다 — 브랜치 타일 곁(미리 보기 자리 규칙 그대로 — `openDoc`). 원격이면 그
 * 호스트에 붙은 SSH 타일의 세션을 빌린다(원격 문서의 기존 길). 붙은 타일이 없으면 알림 한 줄.
 */
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

/** [그 타일로] — 그 에이전트 타일로 초점 */
export function focusPaneAnywhere(paneId: string): void {
  const tab = tabOfPane(paneId);
  if (tab) focusTile(tab.id, paneId);
}
