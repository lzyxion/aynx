import { invoke } from "../ipc";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { loadWorktrees } from "$lib/app/worktrees.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { isRemote, type Project } from "$lib/projects";
import { nothingToDelete, parseBranchChoices, type BranchChoices } from "$lib/worktree-branch";
import { parseAddPreview, type AddPreview } from "$lib/worktree-add";

/** 브랜치 삭제 상자 · 새 워크트리 미리 보기 재료 — 판정의 원본은 Rust `worktree_branch.rs` 다. 원격은 이미 붙은 세션이 있을 때만. */

const FOCUS_KEY = "worktree-branch";

interface BranchDialog {
  project: Project;
  /** 원격이면 여는 순간 잡은 세션 — 실행까지 같은 전송로로 간다 */
  sessionId: number | null;
  choices: BranchChoices;
  picked: string | null;
  busy: boolean;
}

let dialog = $state<BranchDialog | null>(null);
let opening = false;

export function worktreeBranchDialog(): BranchDialog | null {
  return dialog;
}

export function worktreeBranchOpen(): boolean {
  return dialog !== null;
}

function reasonOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

export async function openBranchDelete(p: Project): Promise<void> {
  if (opening || dialog) return;
  const remote = isRemote(p);
  const sessionId = remote ? liveSessionFor(p.host) : null;
  if (remote && sessionId === null) {
    toast.info(t("app.projects.worktrees.branch.needSession"));
    return;
  }
  opening = true;
  let choices: BranchChoices;
  try {
    const raw =
      sessionId !== null
        ? await invoke<unknown>("ssh_git_worktree_branch_choices", { id: sessionId, repo: p.path })
        : await invoke<unknown>("git_worktree_branch_choices", { repo: p.path });
    choices = parseBranchChoices(raw);
  } catch (e) {
    showNotice(reasonOf(e));
    return;
  } finally {
    opening = false;
  }
  if (nothingToDelete(choices)) {
    showNotice(t("app.projects.worktrees.branch.noDeletable"));
    return;
  }
  rememberFocusOrigin(FOCUS_KEY);
  dialog = { project: p, sessionId, choices, picked: choices.deletable[0] ?? null, busy: false };
}

export function pickBranch(branch: string): void {
  if (dialog && !dialog.busy) dialog.picked = branch;
}

export function cancelWorktreeBranch(): void {
  if (dialog?.busy) return;
  dialog = null;
  returnFocus(FOCUS_KEY);
}

function close(): void {
  dialog = null;
  returnFocus(FOCUS_KEY);
}

/** 명령 글자는 Rust 가 짓는다. */
export async function submitWorktreeBranch(): Promise<void> {
  const d = dialog;
  if (!d || d.busy || !d.picked) return;
  const { project: p, sessionId, picked } = d;
  const [cmd, args] =
    sessionId !== null
      ? ["ssh_git_branch_delete", { id: sessionId, repo: p.path, branch: picked }]
      : ["git_branch_delete", { repo: p.path, branch: picked }];
  d.busy = true;
  try {
    const raw = await invoke<unknown>(cmd, args);
    close();
    toast.success(t("app.projects.worktrees.branch.deleted", { branch: String(raw) }));
  } catch (e) {
    close();
    showNotice(t("app.projects.worktrees.branch.deleteRefused", { branch: picked, reason: reasonOf(e) }));
  }
  // 실패해도 트리는 다시 읽는다 — 그사이 셸에서 바뀐 것이 거절의 까닭일 수 있다.
  void loadWorktrees(p);
}

/** 원격은 이것 때문에 새로 접속하지 않는다 — 없거나 실패하면 `null` 이고 상자는 미리 보기 없이 선다. */
export async function readAddPreview(p: Project): Promise<AddPreview | null> {
  const sessionId = isRemote(p) ? liveSessionFor(p.host) : null;
  if (isRemote(p) && sessionId === null) return null;
  try {
    const raw =
      sessionId !== null
        ? await invoke<unknown>("ssh_git_worktree_add_preview", { id: sessionId, repo: p.path })
        : await invoke<unknown>("git_worktree_add_preview", { repo: p.path });
    return parseAddPreview(raw);
  } catch {
    return null;
  }
}
