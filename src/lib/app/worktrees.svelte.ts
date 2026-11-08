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

/**
 * **워크트리 사본** — 프로젝트마다 git 워크트리 목록 한 벌 (docs/log/2026-09-24-worktrees.md "독의 트리").
 *
 * `app/projects.svelte.ts` 에 살던 것을 떼어 냈다(2026-09-26 프로젝트 시작 화면 —
 * docs/log/2026-09-26-project-start-screen.md). 지난 대화 저장소(`app/agent-sessions`)가 이 사본을 읽고,
 * 프로젝트 층이 이제 지난 대화 저장소를 읽는다(프로젝트를 열 때 "이 폴더에 지난 대화가 있나" 를 묻는다) —
 * 사본이 프로젝트 층에 남아 있으면 두 파일이 서로를 부른다. 부르는 쪽이 한 문으로 들어오게
 * `app/projects.svelte.ts` 가 그대로 다시 내보낸다.
 */

/**
 * 워크트리 목록 — 로컬은 `git_worktree_list`, 원격은 **그 호스트에 이미 붙은 세션**의 exec
 * 왕복 하나(`ssh_git_worktree_list` — 붙은 세션은 `app/remote-home` 의 `liveSessionFor`). 목록 하나
 * 보려고 새 접속을 열지 않는다 — 세션이 없으면
 * `offline`(옆목록이 "접속 후 표시됩니다" 한 줄).
 */
export async function listProjectWorktrees(p: Project): Promise<WorktreeListing> {
  try {
    if (isRemote(p)) {
      const id = liveSessionFor(p.host);
      if (id === null) return { state: "offline" };
      // 트리의 점이 `~/api` 타일을 git 의 `/root/api` 줄과 맞대려면 홈이 있어야 한다 — 별칭마다
      // 한 번이고 이미 알면 왕복이 없다. 못 알아내도 목록은 그대로 읽는다(점만 글자 비교로 돈다).
      await ensureRemoteHome(p.host);
      return {
        state: "ok",
        list: parseWorktrees(await invoke<unknown>("ssh_git_worktree_list", { id, repo: p.path })),
      };
    }
    return { state: "ok", list: parseWorktrees(await invoke<unknown>("git_worktree_list", { repo: p.path })) };
  } catch (e) {
    // 목록이 실패하면 **왜** 인지 구조적으로 한 번 더 묻는다(git 의 오류 문구는 로케일을 탄다 —
    // docs/log/2026-09-28-project-create.md). 저장소가 아니면 독이 오류 대신 [git 저장소로 초기화] 를 세운다.
    const status = await repoStatusOf(isRemote(p) ? p.host : null, p.path);
    if (status?.kind === "notRepo") return { state: "notRepo" };
    return { state: "error", message: stripReason(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * 프로젝트 id → 그 워크트리 목록. **읽는 때는 정해져 있다**: 펼칠 때 · 이 창에서 만들거나
 * 지운 뒤 · 독의 "새로고침" · 검색어를 처음 칠 때(아직 안 읽은 것만) · 프로젝트 독이 보이게 될 때와 보이는 채로 창이
 * 돌아올 때(펼친 것만 · 3초 거름 — docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md). 시계로 다시 읽지 않는다
 * — 셸에서 만든 워크트리는 다음 펼침·새로고침·독 열기에 보인다(앱은 워크트리를 소유하지 않는다).
 */
const worktreeCache = $state<Record<string, WorktreeListing>>({});
/** 읽기 순번 — 늦게 온 옛 답이 새 목록을 덮지 않게 (옆목록 시절의 `wtSeq` 와 같은 뜻) */
const worktreeSeq: Record<string, number> = {};

/**
 * 프로젝트마다 마지막으로 목록 읽기를 **시작한** 시각과, 지금 읽는 중인 프로젝트 — 독이 보일 때·창이 돌아올 때의
 * 다시 읽기(`app/projects.svelte.ts` 의 `refreshShownWorktrees`)가 간격·중복을 거르는 재료다. 그리지 않으니 반응형이 아니다.
 */
const lastReadAt: Record<string, number> = {};
const reading = new Set<string>();

/** 다시 읽기 거름의 재료 (읽기 전용 사본이 아니라 그대로 — 부르는 쪽은 읽기만 한다) */
export function worktreeReadState(): { lastAt: Readonly<Record<string, number>>; inFlight: ReadonlySet<string> } {
  return { lastAt: lastReadAt, inFlight: reading };
}

/** 그 프로젝트의 워크트리 사본 (아직 안 읽었으면 `undefined`) — 반응형 */
export function worktreesOf(id: string): WorktreeListing | undefined {
  return worktreeCache[id];
}

/**
 * 한 프로젝트의 워크트리를 (다시) 읽는다. 이미 목록이 있으면 새 답이 올 때까지 **그 목록을
 * 그대로 둔다** — 새로고침마다 "읽는 중…" 으로 깜박이지 않게. 원격은 붙어 있는 세션이 없으면
 * 왕복 없이 곧바로 `offline` 이다([`listProjectWorktrees`]).
 */
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
  // 목록을 읽은 김에 그 워크트리들의 변경 배지도 한 번(주 폴더 빼고 — docs/log/2026-09-29-worktree-badges.md).
  if (r.state === "ok") void loadWorktreeChanges(p, changePathsOf(r.list));
}

/**
 * 이 창에서 워크트리를 만든 뒤 — 독이 그 프로젝트를 **읽어 둔 적이 있을 때만** 한 번 다시 읽는다(폴링 아님).
 * 로컬은 만든 자리(`openProjectInNewWorktree`), 원격은 새 타일의 준비가 `ready` 로 끝나고 그 세션이 선 뒤
 * (`Terminal.svelte` — docs/log/2026-09-29-remote-worktree-after-connect.md). 프로젝트가 사라졌으면 아무것도 안 한다.
 */
export function reloadWorktreesAfterCreate(projectId: string): void {
  const p = projectById(projectId);
  if (p && worktreesOf(p.id)) void loadWorktrees(p);
}

/**
 * 로컬 폴더가 **워크트리 줄**(주 폴더 자리 빼고)이면 그 브랜치 — 독이 그 프로젝트의 목록을 이미 읽어 둔 때만(읽으러 가지 않는다).
 * 모르면 `null`. AI 타일 로딩 덮개(`term/AiVeil.svelte`)의 "경로 · 브랜치" 가 읽는다.
 */
export function localWorktreeBranchAt(cwd: string): string | null {
  const at = placeOf({ host: null, start: cwd, current: null }, projectFolders(projects(), worktreesOf), remoteHomeOf);
  if (!at?.worktree || at.main) return null;
  const listing = worktreesOf(at.projectId);
  if (listing?.state !== "ok") return null;
  return listing.list.find((w) => w.path === at.worktree)?.branch ?? null;
}

/**
 * 에이전트 턴이 끝났다(훅 `stop` — `app/agent-status`) — 그 타일이 선 워크트리(주 폴더 빼고)의 변경 배지만 한 번 다시
 * 읽는다(docs/log/2026-09-29-worktree-badges.md). 타일의 자리는 독의 에이전트 점과 같은 판정(`placeOf` — 지금 폴더 →
 * 시작 폴더, 가장 깊은 등록 폴더)이고, 독이 그 프로젝트의 목록을 읽어 둔 적이 없으면 아무것도 하지 않는다.
 */
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
  // 브랜치 그래프 타일의 "새 변경 있음" 한 줄 — 주 폴더에서 끝난 턴도 브랜치를 바꿀 수 있다(docs/log/2026-09-29-branch-graph.md).
  if (at) markBranchGraphStale(at.projectId);
  if (!at?.worktree) return;
  const listing = worktreesOf(at.projectId);
  if (listing?.state !== "ok" || !changePathsOf(listing.list).includes(at.worktree)) return;
  const p = projectById(at.projectId);
  if (p) void loadWorktreeChanges(p, [at.worktree]);
}
