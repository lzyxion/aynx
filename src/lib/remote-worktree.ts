/**
 * **원격 새 워크트리의 준비** — 순수 모듈 (2026-09-29 B안 · docs/log/2026-09-29-remote-worktree-after-connect.md).
 *
 * 새 SSH 타일이 접속한 뒤 · 첫 입력 전에 Rust(`remote_worktree::prepare`)가 그 전송로의 exec 로 저장소를 판정하고
 * 워크트리를 만든다. 그 사이의 단계를 이벤트 `ssh-worktree-prep` 로 타일에 알리고(표 `ticket` 으로 그 타일을 가리킨다),
 * 첫 커밋이 없으면 타일 위쪽 막대의 답을 `ssh_worktree_answer` 로 기다린다. 여기는 이벤트를 읽는 규칙만 둔다(vitest 가
 * 닿게) — 구독 · 답은 `app/remote-worktree.ts`, 막대는 `Terminal.svelte`.
 */

/** 준비 이벤트 이름 — Rust `remote_worktree::PREP_EVENT` 와 같은 글자 */
export const WORKTREE_PREP_EVENT = "ssh-worktree-prep";

/**
 * 단계 — `preparing`(판정 시작) · `ask`(첫 커밋이 없다 — 막대로 묻는다) · `committing`(빈 첫 커밋 중) · `ready`(만들었다) ·
 * `shell`(사람이 [셸로 열기]) · `failed`(판정·만들기 실패 — 평범한 셸로) · `identity`(git 신원이 없어 첫 커밋을 못 만들었다).
 */
export type WorktreePrepPhase = "preparing" | "ask" | "committing" | "ready" | "shell" | "failed" | "identity";

const PHASES: readonly WorktreePrepPhase[] = ["preparing", "ask", "committing", "ready", "shell", "failed", "identity"];

/** Rust `remote_worktree::PrepEvent` 와 1:1 */
export interface WorktreePrepEvent {
  ticket: string;
  phase: WorktreePrepPhase;
  /** 프로젝트 경로 (사람이 적은 꼴 — `~/api`) */
  repo: string;
  /** 만들 워크트리 폴더 (사람이 적은 꼴) */
  path: string;
  /** `ask` — HEAD 가 가리키는 브랜치 */
  branch: string | null;
  /** `failed` — 사유 한 줄 */
  message: string | null;
  /** `ready` — 브랜치를 새로 만들었나 */
  branchCreated: boolean | null;
}

/** 막대의 답 — Rust `remote_worktree::Answer` 의 글자 */
export type WorktreePrepAnswer = "commit" | "shell" | "cancel";

/** 준비가 끝난 단계인가 — 이 뒤로는 그 표의 이벤트가 오지 않는다 */
export function isFinalPrepPhase(phase: WorktreePrepPhase): boolean {
  return phase === "ready" || phase === "shell" || phase === "failed" || phase === "identity";
}

/**
 * 끝난 뒤 첫 입력이 **워크트리 없이 평범한 셸(홈)** 인가 — `ready` 만 워크트리 폴더에서 시작한다. 나머지 끝 단계는
 * Rust 가 시작 재료를 통째로 버렸다(타일도 그 폴더 · 에이전트를 잊는다 — 분할 · 재접속이 없는 폴더로 가지 않게).
 */
export function prepEndsInPlainShell(phase: WorktreePrepPhase): boolean {
  return phase === "shell" || phase === "failed" || phase === "identity";
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** 이벤트 페이로드 → [`WorktreePrepEvent`]. **throw 하지 않는다** — 모양이 어긋나면 `null` */
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
