import { invoke } from "../ipc";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { isRemote, type Project } from "$lib/projects";
import { changesKey, parseWorktreeChanges, type WorktreeChanges } from "$lib/worktree-changes";

/**
 * **워크트리 변경 배지의 창 사본** — (프로젝트, 워크트리 경로) → 변경 상태
 * (docs/log/2026-09-29-worktree-badges.md, 소스 컨트롤 1단계).
 *
 * **읽는 때는 정해져 있다** — 시계는 없다(주기 폴링 금지):
 * - 독이 그 프로젝트의 워크트리 목록을 읽은 뒤(`app/worktrees.svelte.ts` 의 `loadWorktrees` — 펼침 · 새로고침 · 검색 ·
 *   로컬 새 워크트리 뒤 · 원격 `ready` 뒤 · 독이 보이게 될 때 · 독이 보이는 채로 창이 돌아올 때 다시 읽기가 모두 이 길을
 *   지난다 — docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md) 그 목록의 워크트리들에 한 번.
 * - 그 워크트리 폴더에 선 에이전트의 턴이 끝났다는 훅 신호(`stop`)가 올 때 그 워크트리만 한 번
 *   (`refreshWorktreeChangesAfterTurn` — `app/agent-status` 가 부른다).
 *
 * 원격은 목록과 같은 규칙이다: 그 호스트에 **이미 붙은 세션**이 있을 때만 exec 왕복 하나(`ssh_git_worktree_changes`),
 * 없으면 묻지 않고 사본도 그대로 둔다. 실패는 조용하다(배지가 없을 뿐 — 독의 목록 줄이 이미 git 의 실패를 말한다).
 */

const changes = $state<Record<string, WorktreeChanges>>({});
/** 읽기 순번 — 열쇠마다. 늦게 온 옛 답이 새 답을 덮지 않게 */
const seqs: Record<string, number> = {};

/** 그 워크트리의 변경 상태(아직 모르면 `undefined`) — 반응형 */
export function worktreeChangesOf(projectId: string, path: string): WorktreeChanges | undefined {
  return changes[changesKey(projectId, path)];
}

/**
 * 한 프로젝트의 워크트리 몇 개를 (다시) 읽는다 — 로컬은 `git_worktree_changes`, 원격은 붙은 세션의 exec 한 번.
 * 답에 없는 경로(폴더가 사라졌다 · 목록에 없다)는 사본에서 뺀다.
 */
export async function loadWorktreeChanges(p: Project, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  let command: string;
  let args: Record<string, unknown>;
  if (isRemote(p)) {
    const id = liveSessionFor(p.host);
    if (id === null) return;
    command = "ssh_git_worktree_changes";
    args = { id, repo: p.path, paths };
  } else {
    command = "git_worktree_changes";
    args = { repo: p.path, paths };
  }
  const mine: Record<string, number> = {};
  for (const path of paths) {
    const k = changesKey(p.id, path);
    mine[k] = seqs[k] = (seqs[k] ?? 0) + 1;
  }
  let got: WorktreeChanges[];
  try {
    got = parseWorktreeChanges(await invoke<unknown>(command, args));
  } catch (e) {
    console.warn("[worktree-changes] 변경 상태를 읽지 못했습니다:", e);
    return;
  }
  const byPath = new Map(got.map((c) => [c.path, c]));
  for (const path of paths) {
    const k = changesKey(p.id, path);
    if (seqs[k] !== mine[k]) continue;
    const c = byPath.get(path);
    if (c) changes[k] = c;
    else delete changes[k];
  }
}
