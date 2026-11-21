import { invoke } from "../ipc";
import { stripReason } from "$lib/error-reason";
import { ensureRemoteHome, liveSessionFor, remoteHomeOf } from "$lib/app/remote-home.svelte.js";
import { repoStatusOf } from "$lib/app/git-repo";
import { projectById, projects } from "$lib/app/project-list.svelte.js";
import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { loadWorktreeChanges } from "$lib/app/worktree-changes.svelte.js";
import { markBranchGraphStale } from "$lib/app/branch-graph-stale.svelte.js";
import { placeOf, projectFolders } from "$lib/dock-dots";
import { isRemote, parseWorktrees, type Project, type WorktreeListing } from "$lib/projects";
import type { PaneSpec } from "$lib/session";
import { changePathsOf } from "$lib/worktree-changes";

/** 워크트리 사본 — 프로젝트마다 git 워크트리 목록 한 벌. */

/** 목록 하나 보려고 새 접속을 열지 않는다 — 원격에 붙은 세션이 없으면 `offline`. */
export async function listProjectWorktrees(p: Project): Promise<WorktreeListing> {
  try {
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      // 트리의 점이 `~/api` 타일을 git 의 `/root/api` 줄과 맞대려면 홈이 있어야 한다. 못 알아내도 목록은 읽는다.
      await ensureRemoteHome(p.host);
      return {
        state: "ok",
        list: parseWorktrees(await invoke<unknown>("ssh_git_worktree_list", { id, repo: p.path })),
      };
    }
    return { state: "ok", list: parseWorktrees(await invoke<unknown>("git_worktree_list", { repo: p.path })) };
  } catch (e) {
    // 왜인지 구조적으로 한 번 더 묻는다 — git 의 오류 문구는 로케일을 탄다(docs/log/2026-09-28-project-create.md).
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: stripReason(e instanceof Error ? e.message : String(e)) };
  }
}

/** 시계로 다시 읽지 않는다 — 앱은 워크트리를 소유하지 않는다(셸에서 만든 것은 다음 펼침 · 새로고침에 보인다). */
const worktreeCache = $state<Record<string, WorktreeListing>>({});
/** 늦게 온 옛 답이 새 목록을 덮지 않게 */
const worktreeSeq: Record<string, number> = {};

const lastReadAt: Record<string, number> = {};
const reading = new Set<string>();

export function worktreeReadState(): { lastAt: Readonly<Record<string, number>>; inFlight: ReadonlySet<string> } {
  return { lastAt: lastReadAt, inFlight: reading };
}

export function worktreesOf(id: string): WorktreeListing | undefined {
  return worktreeCache[id];
}

/** 이미 목록이 있으면 새 답이 올 때까지 그대로 둔다 — 새로고침마다 "읽는 중…" 으로 깜박이지 않게. */
export async function loadWorktrees(p: Project): Promise<void> {
  const seq = (worktreeSeq[p.id] ?? 0) + 1;
  worktreeSeq[p.id] = seq;
  lastReadAt[p.id] = Date.now();
  reading.add(p.id);
  if (worktreeCache[p.id]?.state !== "ok") worktreeCache[p.id] = { state: "loading" };
  let r: WorktreeListing;
  try {
    r = await listProjectWorktrees(p);
  } finally {
    // 더 늦게 시작한 읽기가 있으면 그것이 끝날 때 내린다
    if (worktreeSeq[p.id] === seq) reading.delete(p.id);
  }
  if (worktreeSeq[p.id] !== seq) return;
  worktreeCache[p.id] = r;
  if (r.state === "ok") void loadWorktreeChanges(p, changePathsOf(r.list));
}

export function reloadWorktreesAfterCreate(projectId: string): void {
  const p = projectById(projectId);
  if (p && worktreesOf(p.id)) void loadWorktrees(p);
}

/** 독이 이미 읽어 둔 목록에서만 찾는다(읽으러 가지 않는다) — 주 폴더면 `null`. */
export function localWorktreeBranchAt(cwd: string): string | null {
  const at = placeOf({ host: null, start: cwd, current: null }, projectFolders(projects(), worktreesOf), remoteHomeOf);
  if (!at?.worktree || at.main) return null;
  const listing = worktreesOf(at.projectId);
  if (listing?.state !== "ok") return null;
  return listing.list.find((w) => w.path === at.worktree)?.branch ?? null;
}

/** 타일의 자리는 독의 에이전트 점과 같은 판정(`placeOf`)이다. */
export function refreshWorktreeChangesAfterTurn(pane: PaneSpec): void {
  if (pane.kind !== "local" && (pane.kind !== "ssh" || pane.adhoc || !pane.alias?.trim())) return;
  const local = pane.kind === "local";
  const at = placeOf(
    {
      host: local ? null : (pane.alias?.trim() ?? null),
      start: pane.cwd?.trim() || null,
      current: local ? localReportedFolder(pane) : reportedCwd(pane.id)?.trim() || null,
    },
    projectFolders(projects(), worktreesOf, remoteHomeOf),
    remoteHomeOf,
  );
  // 주 폴더에서 끝난 턴도 브랜치를 바꿀 수 있다 — 워크트리 검사보다 앞에 둔다.
  if (at) markBranchGraphStale(at.projectId);
  if (!at?.worktree) return;
  const listing = worktreesOf(at.projectId);
  if (listing?.state !== "ok" || !changePathsOf(listing.list).includes(at.worktree)) return;
  const p = projectById(at.projectId);
  if (p) void loadWorktreeChanges(p, [at.worktree]);
}
