/**
 * 이유 코드(서버 `orchestration::store::reason` · MCP 와 같은 낱말) — 목록 · 문구 키 표 · 실패 문자열 해석.
 */

import type { Key } from "$lib/i18n/keys";
import type { Tr } from "./text";

// ---------------------------------------------------------------------------
// 이유 코드(서버 `orchestration::store::reason` · MCP 와 같은 낱말)
// ---------------------------------------------------------------------------

export const ORCH_REASONS = [
  "not-found",
  "run-paused",
  "run-stopped",
  "run-orphaned",
  "stale-generation",
  "conflict",
  "dependency-cycle",
  "unknown-dependency",
  "too-many-tasks",
  "rate-limited",
  "too-many-waiters",
  "too-many-runs",
  "worker-limit",
  "invalid-argument",
  "invalid-state",
  "not-reported",
  "task-not-editable",
  "risk-not-confirmed",
  "not-a-repo",
  "limit-reached",
  "cli-not-allowed",
  "task-busy",
  "dependency-not-accepted",
  "needs-merge",
  "spawn-unavailable",
  "worktree-failed",
  "worktree-dirty",
  "worktree-in-use",
  "not-run-worktree",
  "branch-has-unmerged",
  "stale-attempt",
  "already-reported",
  "dirty-report",
  "not-success",
  "no-commit",
  "transcript-unavailable",
  "report-mismatch",
  "run-on-hold",
  "integration-busy",
  "integration-committing",
  "already-integrated",
  "integration-failed",
  "not-completable",
  "git-too-old",
  "git-unsupported",
  "export-checked-out",
  "export-branch-moved",
  "verify-failed",
  "verify-limit",
  "verify-unsupported",
  "approval-stale",
  "approval-expired",
  "review-active",
  "review-pending",
  "review-required",
  "review-changes-requested",
  "review-budget-exhausted",
  "symlink-outside",
  "cleanup-pending",
  "not-cleanable",
  // 앨범 보관함
  "worktrees-left",
  "archive-unreadable",
  // 3차 3a — 맡기기 · 역할 · 수락 규칙 · 헤드리스 턴
  "unknown-role",
  "role-invalid",
  "role-removed",
  "role-changed",
  "rework-limit",
  "accept-rule-unmet",
  "busy",
  "conversation-broken",
  "turn-limit",
  // 사람 [재개] — 조정자 없는 Run(AI 타일의 adopt_run 으로 이어받거나 중단)
  "no-coordinator",
  // F6 — 같은 Run 의 같은 requestId 를 다른 도구 · 다른 입력이 썼다(타일 단위 기록과 같은 낱말)
  "request-id-reused",
] as const;

export type OrchReason = (typeof ORCH_REASONS)[number];

/** 이유 → 문구 키(`orch.reason.<code>`) */
export const ORCH_REASON_KEY: Record<OrchReason, Key> = {
  "not-found": "orch.reason.not-found",
  "run-paused": "orch.reason.run-paused",
  "run-stopped": "orch.reason.run-stopped",
  "run-orphaned": "orch.reason.run-orphaned",
  "stale-generation": "orch.reason.stale-generation",
  conflict: "orch.reason.conflict",
  "dependency-cycle": "orch.reason.dependency-cycle",
  "unknown-dependency": "orch.reason.unknown-dependency",
  "too-many-tasks": "orch.reason.too-many-tasks",
  "rate-limited": "orch.reason.rate-limited",
  "too-many-waiters": "orch.reason.too-many-waiters",
  "too-many-runs": "orch.reason.too-many-runs",
  "worker-limit": "orch.reason.worker-limit",
  "invalid-argument": "orch.reason.invalid-argument",
  "invalid-state": "orch.reason.invalid-state",
  "not-reported": "orch.reason.not-reported",
  "task-not-editable": "orch.reason.task-not-editable",
  "risk-not-confirmed": "orch.reason.risk-not-confirmed",
  "not-a-repo": "orch.reason.not-a-repo",
  "limit-reached": "orch.reason.limit-reached",
  "cli-not-allowed": "orch.reason.cli-not-allowed",
  "task-busy": "orch.reason.task-busy",
  "dependency-not-accepted": "orch.reason.dependency-not-accepted",
  "needs-merge": "orch.reason.needs-merge",
  "spawn-unavailable": "orch.reason.spawn-unavailable",
  "worktree-failed": "orch.reason.worktree-failed",
  "worktree-dirty": "orch.reason.worktree-dirty",
  "worktree-in-use": "orch.reason.worktree-in-use",
  "not-run-worktree": "orch.reason.not-run-worktree",
  "branch-has-unmerged": "orch.reason.branch-has-unmerged",
  "stale-attempt": "orch.reason.stale-attempt",
  "already-reported": "orch.reason.already-reported",
  "dirty-report": "orch.reason.dirty-report",
  "not-success": "orch.reason.not-success",
  "no-commit": "orch.reason.no-commit",
  "transcript-unavailable": "orch.reason.transcript-unavailable",
  "report-mismatch": "orch.reason.report-mismatch",
  "run-on-hold": "orch.reason.run-on-hold",
  "integration-busy": "orch.reason.integration-busy",
  "integration-committing": "orch.reason.integration-committing",
  "already-integrated": "orch.reason.already-integrated",
  "integration-failed": "orch.reason.integration-failed",
  "not-completable": "orch.reason.not-completable",
  "git-too-old": "orch.reason.git-too-old",
  "git-unsupported": "orch.reason.git-unsupported",
  "export-checked-out": "orch.reason.export-checked-out",
  "export-branch-moved": "orch.reason.export-branch-moved",
  "verify-failed": "orch.reason.verify-failed",
  "verify-limit": "orch.reason.verify-limit",
  "verify-unsupported": "orch.reason.verify-unsupported",
  "approval-stale": "orch.reason.approval-stale",
  "approval-expired": "orch.reason.approval-expired",
  "review-active": "orch.reason.review-active",
  "review-pending": "orch.reason.review-pending",
  "review-required": "orch.reason.review-required",
  "review-changes-requested": "orch.reason.review-changes-requested",
  "review-budget-exhausted": "orch.reason.review-budget-exhausted",
  "symlink-outside": "orch.reason.symlink-outside",
  "cleanup-pending": "orch.reason.cleanup-pending",
  "not-cleanable": "orch.reason.not-cleanable",
  "worktrees-left": "orch.reason.worktrees-left",
  "archive-unreadable": "orch.reason.archive-unreadable",
  "unknown-role": "orch.reason.unknown-role",
  "role-invalid": "orch.reason.role-invalid",
  "role-removed": "orch.reason.role-removed",
  "role-changed": "orch.reason.role-changed",
  "rework-limit": "orch.reason.rework-limit",
  "accept-rule-unmet": "orch.reason.accept-rule-unmet",
  busy: "orch.reason.busy",
  "conversation-broken": "orch.reason.conversation-broken",
  "turn-limit": "orch.reason.turn-limit",
  "no-coordinator": "orch.reason.no-coordinator",
  "request-id-reused": "orch.reason.request-id-reused",
};

/** 실패 문구(`[이유] 사람 문구`)의 이유 코드 — 모르는 코드 · 코드 없음이면 `null` */
export function orchReasonOf(message: string): OrchReason | null {
  const m = /\[([a-z-]+)\]/.exec(message);
  if (!m) return null;
  return (ORCH_REASONS as readonly string[]).includes(m[1]) ? (m[1] as OrchReason) : null;
}

/**
 * 실패를 사람 문구로 — 서버가 이미 표시 언어로 만든 문구(`[이유] …`)면 대괄호만 떼어 그대로, 이유 코드뿐이거나 문구가 비면
 * 표의 문구. 이유가 없는 실패(서버에 닿지 못함 등)는 받은 글자 그대로.
 */
export function orchReasonText(message: string, tr: Tr): string {
  const reason = orchReasonOf(message);
  if (reason === null) return message.trim();
  const rest = message.replace(`[${reason}]`, "").trim();
  return rest !== "" ? rest : tr(ORCH_REASON_KEY[reason]);
}
