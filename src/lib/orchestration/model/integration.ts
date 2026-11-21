import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { AttemptView, ConflictInfoView, HoldReason, IntegrationJobView, JobPhase, ReportFileView, RunDetail, RunHoldView, TaskView, VerifyOutcome } from "./types";

export const VERIFY_OUTCOME_KEY: Record<VerifyOutcome, Key> = {
  pass: "orch.verify.outcome.pass",
  fail: "orch.verify.outcome.fail",
  timeout: "orch.verify.outcome.timeout",
  cancelled: "orch.verify.outcome.cancelled",
  "modified-tracked": "orch.verify.outcome.modified-tracked",
  "spawn-failed": "orch.verify.outcome.spawn-failed",
  "symlink-outside": "orch.verify.outcome.symlink-outside",
  "stop-unconfirmed": "orch.verify.outcome.stop-unconfirmed",
};

/** 서버 `verify::APPROVAL_TTL_MS` 와 같은 값 */
export const VERIFY_APPROVAL_TTL_MS = 30 * 60 * 1000;

export function awaitingVerify(run: Pick<RunDetail, "jobs">, taskId: string): IntegrationJobView | null {
  return (run.jobs ?? []).find((j) => j.taskId === taskId && j.phase === "awaiting-approval") ?? null;
}

/** 확인 대화가 보인 값 그대로 — 서버는 지금 값과 다르면 `approval-stale` 로 거절한다 */
export function approveVerifyArgs(
  run: Pick<RunDetail, "verify" | "integration">,
  job: Pick<IntegrationJobView, "jobId" | "candidate" | "old" | "phase">,
): { jobId: string; candidate: string; commandSha: string; old: string } | null {
  if (job.phase !== "awaiting-approval" || !job.candidate || !job.old || !run.verify) return null;
  if (run.integration && run.integration.expectedHead !== job.old) return null;
  return { jobId: job.jobId, candidate: job.candidate, commandSha: run.verify.commandSha, old: job.old };
}

export function overridableVerify(
  run: Pick<RunDetail, "jobs" | "verify" | "integration">,
  task: Pick<TaskView, "id" | "state">,
): { jobId: string; verifyId: string; candidate: string; outcome: VerifyOutcome; exitCode: number | null } | null {
  if (!run.verify || task.state !== "reported") return null;
  const jobs = (run.jobs ?? []).filter((j) => j.taskId === task.id);
  const last = jobs[jobs.length - 1];
  const v = last?.verify;
  if (!last || last.phase !== "aborted" || !v || v.outcome === "pass" || v.outcome === "cancelled") return null;
  if (run.integration && last.old && run.integration.expectedHead !== last.old) return null;
  return { jobId: last.jobId, verifyId: v.verifyId, candidate: v.candidate, outcome: v.outcome, exitCode: v.exitCode ?? null };
}

/** 서버 `HoldReason` 전부(시험이 지킨다) */
export const HOLD_REASON_KEY: Record<HoldReason, Key> = {
  "integration-diverged": "orch.hold.integration-diverged",
  "persist-failed": "orch.hold.persist-failed",
  "cleanup-pending": "orch.hold.cleanup-pending",
  "repo-identity-changed": "orch.hold.repo-identity-changed",
};

/** 통합 ref 어긋남은 [조정]으로만 푼다 · 저장소 신원이 바뀌면 앨범 권한 단추를 함께 세운다 */
export function holdBar(
  hold: RunHoldView | null | undefined,
  tr: Tr,
): { text: string; release: boolean; reconcile: boolean; delegation: boolean } | null {
  if (!hold) return null;
  const text = keyText(HOLD_REASON_KEY, hold.reason, tr);
  switch (hold.reason) {
    case "integration-diverged":
      return { text, release: false, reconcile: true, delegation: false };
    case "repo-identity-changed":
      return { text, release: true, reconcile: false, delegation: true };
    default:
      // 모르는 사유도 — 서버가 [보류 풀기] 를 다시 판정한다.
      return { text, release: true, reconcile: false, delegation: false };
  }
}

/** 서버 `integrate::completable` 의 낱말 전부(시험이 지킨다) */
export const BLOCKER_KEY: Record<string, Key> = {
  "run-state": "orch.complete.blocker.run-state",
  "tasks-open": "orch.complete.blocker.tasks-open",
  "integration-running": "orch.complete.blocker.integration-running",
  "workers-alive": "orch.complete.blocker.workers-alive",
  "verify-running": "orch.complete.blocker.verify-running",
  "review-active": "orch.complete.blocker.review-active",
  "on-hold": "orch.complete.blocker.on-hold",
};

export function completeAction(
  run: Pick<RunDetail, "state" | "completable">,
  tr: Tr,
): { show: boolean; enabled: boolean; why: string | null } {
  const live = run.state === "running" || run.state === "paused";
  if (!live || !run.completable) return { show: false, enabled: false, why: null };
  if (run.completable.ok) return { show: true, enabled: true, why: null };
  const list = run.completable.blockers.map((b) => keyText(BLOCKER_KEY, b, tr)).join(", ");
  return { show: true, enabled: false, why: tr("orch.complete.blocked", { list }) };
}

export function liveJob(run: Pick<RunDetail, "jobs">, taskId: string): IntegrationJobView | null {
  return (run.jobs ?? []).find((j) => j.taskId === taskId && !["integrated", "conflict", "aborted"].includes(j.phase)) ?? null;
}

export const JOB_PHASE_KEY: Record<JobPhase, Key> = {
  prepared: "orch.job.phase.prepared",
  candidate: "orch.job.phase.candidate",
  "awaiting-approval": "orch.job.phase.awaiting-approval",
  verifying: "orch.job.phase.verifying",
  committing: "orch.job.phase.committing",
  integrated: "orch.job.phase.integrated",
  conflict: "orch.job.phase.conflict",
  aborted: "orch.job.phase.aborted",
};

export function integrationChip(
  run: Pick<RunDetail, "integration" | "accepted">,
): { head: string; integrated: number; exported: "none" | "current" | "stale" } | null {
  const i = run.integration;
  if (!i) return null;
  const integrated = (run.accepted ?? []).filter((a) => !a.revokedAt && !!a.integrationCommit).length;
  const exported = !i.exportedHead ? "none" : i.exportedHead === i.expectedHead ? "current" : "stale";
  return { head: i.expectedHead, integrated, exported };
}

export function conflictSummary(info: ConflictInfoView, tr: Tr): string {
  const kinds = [...new Set(info.entries.flatMap((e) => e.kinds))].join(", ");
  const n = info.entries.length + (info.more ?? 0);
  const base = tr("orch.conflict.summary", { n, kinds });
  return info.needsHuman ? `${base} · ${tr("orch.conflict.needsHuman")}` : base;
}

export function conflictHintKey(info: Pick<ConflictInfoView, "needsHuman">): Key {
  return info.needsHuman ? "orch.conflict.hint" : "orch.conflict.hint.text";
}

export function resolverOf(
  task: Pick<TaskView, "currentAttempt" | "state">,
  attempts: readonly Pick<AttemptView, "id" | "resolves" | "state">[] | null | undefined,
): Pick<AttemptView, "id" | "resolves" | "state"> | null {
  if (!task.currentAttempt || task.state !== "active") return null;
  const a = (attempts ?? []).find((x) => x.id === task.currentAttempt);
  return a && a.resolves ? a : null;
}

export function integrationAbortText(reason: string, tr: Tr): string {
  const [head, detail] = reason.split(":", 2) as [string, string | undefined];
  const known: Record<string, Key> = {
    moved: "orch.integration.abort.moved",
    cancelled: "orch.integration.abort.cancelled",
    stopped: "orch.integration.abort.stopped",
    generation: "orch.integration.abort.generation",
    "persist-failed": "orch.integration.abort.persist-failed",
    "git-unsupported": "orch.integration.abort.git-unsupported",
    "integration-failed": "orch.integration.abort.integration-failed",
    "no-git-identity": "orch.integration.abort.no-git-identity",
    crashed: "orch.integration.abort.crashed",
    "verify-failed": "orch.integration.abort.verify-failed",
    "approval-expired": "orch.integration.abort.approval-expired",
    "verify-required": "orch.integration.abort.verify-required",
  };
  const key = known[head];
  if (!key) return reason;
  return tr(key, { detail: detail ?? "" });
}

export function lastAbortedJob(run: Pick<RunDetail, "jobs">, taskId: string): string | null {
  const jobs = (run.jobs ?? []).filter((j) => j.taskId === taskId);
  const last = jobs[jobs.length - 1];
  return last && last.phase === "aborted" ? (last.outcome?.reason ?? "aborted") : null;
}

/** 통합 ref 가 없는 옛 Run 에만 — 새 Run 은 통합 머리에서 띄운다 */
export function needsMergeHint(task: Pick<TaskView, "state" | "dependsOn">, run: Pick<RunDetail, "integration" | "tasks">): boolean {
  if (run.integration) return false;
  if (task.state !== "todo" || task.dependsOn.length < 2) return false;
  return task.dependsOn.every((dep) => run.tasks.find((x) => x.id === dep)?.state === "accepted");
}

export function fileStatusLetter(s: ReportFileView["status"]): string {
  switch (s) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "type-changed":
      return "T";
    case "unmerged":
      return "U";
    default:
      return "?";
  }
}

// ── 수락 전 검증 칸의 공용 상한 ──

export const VERIFY_COMMAND_MAX = 1000;
export const VERIFY_TIMEOUT_DEFAULT = 10;
export const VERIFY_TIMEOUT_MAX = 60;

export function splitList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
}
