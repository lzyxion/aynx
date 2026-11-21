import { invoke } from "../ipc";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { isRemote, type Project } from "$lib/projects";
import { changesKey, parseWorktreeChanges, type WorktreeChanges } from "$lib/worktree-changes";

/**
 * 워크트리 변경 배지의 창 사본. 시계는 없다(주기 폴링 금지) — 목록을 읽은 뒤와 그 워크트리의 턴이 끝났을 때만 읽는다.
 * 원격은 이미 붙은 세션이 있을 때만 묻는다.
 */

const changes = $state<Record<string, WorktreeChanges>>({});
/** 열쇠마다 순번 — 늦게 온 옛 답이 새 답을 덮지 않게 */
const seqs: Record<string, number> = {};

export function worktreeChangesOf(projectId: string, path: string): WorktreeChanges | undefined {
  return changes[changesKey(projectId, path)];
}

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
