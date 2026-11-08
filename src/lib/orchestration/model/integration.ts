/**
 * 통합 · 검증 — 검증 확인 인자 · 실패 덮어쓰기 · 보류 막대 · Run 완료 단추 · 통합 칩 · 충돌 · 보고 파일 · 검증 칸 상한.
 */

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

/** 사람 확인 대기 시한(ms — 서버 `verify::APPROVAL_TTL_MS` 와 같다) */
export const VERIFY_APPROVAL_TTL_MS = 30 * 60 * 1000;

/** 그 Task 의 사람 확인 대기 Job(있으면) — 보드 [검증 실행] 의 대상 */
export function awaitingVerify(run: Pick<RunDetail, "jobs">, taskId: string): IntegrationJobView | null {
  return (run.jobs ?? []).find((j) => j.taskId === taskId && j.phase === "awaiting-approval") ?? null;
}

/**
 * [검증 실행] 몸 — 확인 대화가 보인 값 그대로(후보 · 명령 해시 · 통합 머리). 하나라도 없으면 `null`(단추를 내지 않는다).
 * 서버는 지금 값과 다르면 `approval-stale` 로 거절한다.
 */
export function approveVerifyArgs(
  run: Pick<RunDetail, "verify" | "integration">,
  job: Pick<IntegrationJobView, "jobId" | "candidate" | "old" | "phase">,
): { jobId: string; candidate: string; commandSha: string; old: string } | null {
  if (job.phase !== "awaiting-approval" || !job.candidate || !job.old || !run.verify) return null;
  if (run.integration && run.integration.expectedHead !== job.old) return null;
  return { jobId: job.jobId, candidate: job.candidate, commandSha: run.verify.commandSha, old: job.old };
}

/**
 * [검증 실패인데 수락] 대상 — 그 Task 의 **마지막** Job 이 실패한 검증으로 끝났고(통과 · 취소 아님) Task 가 보고됨일 때만.
 */
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

/** 보류 사유 → 문구 키(서버 `HoldReason` 전부 — 시험이 지킨다) */
export const HOLD_REASON_KEY: Record<HoldReason, Key> = {
  "integration-diverged": "orch.hold.integration-diverged",
  "persist-failed": "orch.hold.persist-failed",
  "cleanup-pending": "orch.hold.cleanup-pending",
  "repo-identity-changed": "orch.hold.repo-identity-changed",
};

/**
 * 보류 막대 — 문구(모르는 사유는 날 낱말) · [보류 풀기] 가 서는가 · [조정] 이 서는가(통합 ref 어긋남은 [조정]으로만 — 3단계) ·
 * [맡기기 편집 ›] 이 서는가(저장소 신원이 바뀜 — 3a: 사람이 보고 맡기기를 다시 세운 뒤 보류를 푼다).
 */
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
      // persist-failed · cleanup-pending · 모르는 사유 — 서버가 [보류 풀기] 를 다시 판정한다.
      return { text, release: true, reconcile: false, delegation: false };
  }
}

/** Run 완료를 막는 것(서버 `integrate::completable` 의 낱말 전부 — 시험이 지킨다) */
export const BLOCKER_KEY: Record<string, Key> = {
  "run-state": "orch.complete.blocker.run-state",
  "tasks-open": "orch.complete.blocker.tasks-open",
  "integration-running": "orch.complete.blocker.integration-running",
  "workers-alive": "orch.complete.blocker.workers-alive",
  "verify-running": "orch.complete.blocker.verify-running",
  "review-active": "orch.complete.blocker.review-active",
  "on-hold": "orch.complete.blocker.on-hold",
};

/**
 * [Run 완료] 단추 — 살아 있는 Run(running · paused)에만 보이고, 서버가 완료할 수 있다고 할 때만 켠다. 꺼졌으면 막는 것들을
 * 사람 문구로 한 줄. 옛 서버(칸 없음)면 단추를 숨긴다.
 */
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

/** 그 Task 의 끝나지 않은 통합 작업(Run 당 하나 — 통합 중 칩 · [통합 취소]) */
export function liveJob(run: Pick<RunDetail, "jobs">, taskId: string): IntegrationJobView | null {
  return (run.jobs ?? []).find((j) => j.taskId === taskId && !["integrated", "conflict", "aborted"].includes(j.phase)) ?? null;
}

/** 통합 작업 단계 → 문구 키(통합 설계 2-4) */
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

/** 통합 칩(통합 설계 7절 — 보드 머리): 짧은 머리 · 통합된 Task 수 · 내보내기 상태. 옛 Run(통합 없음)이면 `null` */
export function integrationChip(
  run: Pick<RunDetail, "integration" | "accepted">,
): { head: string; integrated: number; exported: "none" | "current" | "stale" } | null {
  const i = run.integration;
  if (!i) return null;
  const integrated = (run.accepted ?? []).filter((a) => !a.revokedAt && !!a.integrationCommit).length;
  const exported = !i.exportedHead ? "none" : i.exportedHead === i.expectedHead ? "current" : "stale";
  return { head: i.expectedHead, integrated, exported };
}

/** 충돌 한 줄 — 항목 수 · 종류(겹치지 않게) · 사람 필요 여부(통합 설계 4-6) */
export function conflictSummary(info: ConflictInfoView, tr: Tr): string {
  const kinds = [...new Set(info.entries.flatMap((e) => e.kinds))].join(", ");
  const n = info.entries.length + (info.more ?? 0);
  const base = tr("orch.conflict.summary", { n, kinds });
  return info.needsHuman ? `${base} · ${tr("orch.conflict.needsHuman")}` : base;
}

/** 충돌 안내 한 줄 — 텍스트 충돌이면 해결 작업자 안내, 아니면 사람(반려) 안내(통합 설계 3b · 4-6) */
export function conflictHintKey(info: Pick<ConflictInfoView, "needsHuman">): Key {
  return info.needsHuman ? "orch.conflict.hint" : "orch.conflict.hint.text";
}

/** Task 의 현재 Attempt 가 충돌 해결 Attempt 면 그것(보드 "해결 중" 칩) — 없으면 `null` */
export function resolverOf(
  task: Pick<TaskView, "currentAttempt" | "state">,
  attempts: readonly Pick<AttemptView, "id" | "resolves" | "state">[] | null | undefined,
): Pick<AttemptView, "id" | "resolves" | "state"> | null {
  if (!task.currentAttempt || task.state !== "active") return null;
  const a = (attempts ?? []).find((x) => x.id === task.currentAttempt);
  return a && a.resolves ? a : null;
}

/** 거둔 통합의 까닭 낱말 → 사람 문구(모르는 낱말은 그대로) */
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

/** 그 Task 의 마지막 통합 작업이 거둬졌으면 그 까닭(보고됨으로 돌아온 Task 의 안내 한 줄) */
export function lastAbortedJob(run: Pick<RunDetail, "jobs">, taskId: string): string | null {
  const jobs = (run.jobs ?? []).filter((j) => j.taskId === taskId);
  const last = jobs[jobs.length - 1];
  return last && last.phase === "aborted" ? (last.outcome?.reason ?? "aborted") : null;
}

/** 의존 여럿 · 전부 수락 · 아직 todo — 병합이 사람 몫이라는 안내(통합 ref 가 없는 옛 Run 에만 — 새 Run 은 통합 머리에서 띄운다) */
export function needsMergeHint(task: Pick<TaskView, "state" | "dependsOn">, run: Pick<RunDetail, "integration" | "tasks">): boolean {
  if (run.integration) return false;
  if (task.state !== "todo" || task.dependsOn.length < 2) return false;
  return task.dependsOn.every((dep) => run.tasks.find((x) => x.id === dep)?.state === "accepted");
}

/** 파일 상태 글자(보드 목록 — git 의 한 글자 관례) */
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

// ---------------------------------------------------------------------------
// 수락 전 검증 칸의 공용 상한(저장소 맡기기 편집 — `settings/OrchRepoEditor.svelte` · `VerifyFields.svelte` · `delegation.ts`)
// ---------------------------------------------------------------------------
// (3차 6단계) 사람의 Run 시작 대화(칸 · 검증 `validateStart` · 서버 인자 `StartRequest` · 기준 줄 `StartPreview`)는 걷었다 — Run 은 AI 타일의
// `start_run` 으로만 열리고, 검증 · 한도는 맡기기의 값이다.

export const VERIFY_COMMAND_MAX = 1000;
export const VERIFY_TIMEOUT_DEFAULT = 10;
export const VERIFY_TIMEOUT_MAX = 60;

/** 쉼표 · 줄바꿈으로 나눈 목록(빈 낱말 버림) */
export function splitList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
}
