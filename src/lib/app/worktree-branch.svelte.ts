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

/**
 * **워크트리의 브랜치 — 브랜치 삭제 상자 · 새 워크트리 미리 보기 재료** (docs/log/2026-10-01-worktree-branch-ops.md ·
 * docs/log/2026-10-05-worktree-one-to-one.md · 모달은 `WorktreeBranchDialog.svelte`, 순수 규칙은 `$lib/worktree-branch` ·
 * `$lib/worktree-add`, 판정의 원본은 Rust `worktree_branch.rs`).
 *
 * 브랜치 삭제는 워크트리 제거(`app/projects.svelte.ts` 의 `confirmRemoveWorktree`)와 같은 모양이다: 원격은 그 호스트에
 * **붙은 세션**이 있어야 하고(없으면 알림 한 줄), 여는 순간 그 세션을 잡아 실행까지 같은 전송로로 간다. 상자를 띄우기
 * **전에** 재료(`*_branch_choices`)를 한 번 읽어, 지울 것이 없으면 상자 없이 알림 한 줄로 말한다. 성공하면 알림 + 그
 * 프로젝트의 트리를 다시 읽는다. 슬롯 "새 브랜치…" 는 2026-10-05 에 뺐다(워크트리 = 브랜치 1:1).
 */

const FOCUS_KEY = "worktree-branch";

interface BranchDialog {
  project: Project;
  /** 원격이면 여는 순간 잡은 세션 */
  sessionId: number | null;
  choices: BranchChoices;
  /** 고른 브랜치 */
  picked: string | null;
  busy: boolean;
}

let dialog = $state<BranchDialog | null>(null);
/** 재료를 읽는 중 — 같은 메뉴를 두 번 눌러 상자가 둘 뜨지 않게 */
let opening = false;

/** 상자가 그리는 값 (반응형) */
export function worktreeBranchDialog(): BranchDialog | null {
  return dialog;
}

/** 전역 키가 쉬어야 하는가 (`app/keys.svelte.ts` 의 목록) */
export function worktreeBranchOpen(): boolean {
  return dialog !== null;
}

function reasonOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

/** 메뉴 항목 "브랜치 삭제…" 의 문 — 재료를 읽고, 지울 것이 없으면 알림 한 줄, 있으면 상자를 연다(어느 줄에서든 — 저장소 단위). */
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

/**
 * [삭제] — 명령 글자는 Rust 가 짓는다. 거절(병합되지 않은 커밋 · 그사이 바뀐 것)은 상자를 닫고
 * "브랜치 X 은(는) 남겼습니다: <git 의 첫 줄>" 을 알림으로.
 */
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

/**
 * "새 워크트리에서 열기…" 상자의 브랜치 콤보박스 재료 — 상자가 열릴 때 한 번(`$lib/worktree-add`).
 * 원격은 **이미 붙은 세션**이 있을 때만 읽는다(이것 때문에 새로 접속하지 않는다). 없거나 읽기가 실패하면 `null` —
 * 상자는 미리 보기 줄 · 제안 목록 없이 예전처럼 선다(조용히). 판정의 원본은 실행 때의 Rust 다.
 */
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
