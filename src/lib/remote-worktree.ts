/** 준비 이벤트 이름 — Rust `remote_worktree::PREP_EVENT` 와 같은 글자 */
export const WORKTREE_PREP_EVENT = "ssh-worktree-prep";

/** `identity` = git 신원이 없어 첫 커밋을 못 만들었다 */
export type WorktreePrepPhase = "preparing" | "ask" | "committing" | "ready" | "shell" | "failed" | "identity";

const PHASES: readonly WorktreePrepPhase[] = ["preparing", "ask", "committing", "ready", "shell", "failed", "identity"];

/** Rust `remote_worktree::PrepEvent` 와 1:1 */
export interface WorktreePrepEvent {
  ticket: string;
  phase: WorktreePrepPhase;
  /** 사람이 적은 꼴(`~/api`) */
  repo: string;
  path: string;
  branch: string | null;
  message: string | null;
  branchCreated: boolean | null;
}

/** 막대의 답 — Rust `remote_worktree::Answer` 의 글자 */
export type WorktreePrepAnswer = "commit" | "shell" | "cancel";

/** 이 뒤로는 그 표의 이벤트가 오지 않는다 */
export function isFinalPrepPhase(phase: WorktreePrepPhase): boolean {
  return phase === "ready" || phase === "shell" || phase === "failed" || phase === "identity";
}

/** `ready` 만 워크트리 폴더에서 시작한다 — 나머지 끝 단계는 Rust 가 시작 재료를 통째로 버렸다(없는 폴더로 가지 않게) */
export function prepEndsInPlainShell(phase: WorktreePrepPhase): boolean {
  return phase === "shell" || phase === "failed" || phase === "identity";
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parsePrepEvent(raw: unknown): WorktreePrepEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ticket = str(o.ticket);
  const phase = str(o.phase) as WorktreePrepPhase | null;
  if (!ticket || !phase || !PHASES.includes(phase)) return null;
  return {
    ticket,
    phase,
    repo: str(o.repo) ?? "",
    path: str(o.path) ?? "",
    branch: str(o.branch),
    message: str(o.message),
    branchCreated: typeof o.branchCreated === "boolean" ? o.branchCreated : null,
  };
}
