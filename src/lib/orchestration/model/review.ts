import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { AcceptedView, AttemptKind, AttemptView, DriftView, ReportOutcome, ReportView, ReviewStateView, ReviewVerdict, RunDetail, RunState, TaskView, WaiverView } from "./types";
import { ATTEMPT_STATE_KEY, KIND_KEY } from "./worker";

// ── 역할 이력 · 수락 규칙 충족 · 되돌림 · 면제 ──

export function roleOutcomeText(outcome: string, tr: Tr): string {
  if (outcome === "pass" || outcome === "changes-requested") return keyText(VERDICT_KEY, outcome, tr);
  if (outcome === "success" || outcome === "failure" || outcome === "blocked") return keyText(OUTCOME_KEY, outcome, tr);
  return keyText(ATTEMPT_STATE_KEY, outcome, tr);
}

export const VERDICT_KEY: Record<ReviewVerdict, Key> = {
  pass: "orch.verdict.pass",
  "changes-requested": "orch.verdict.changes-requested",
};

export interface RoleStep {
  attemptId: string;
  name: string;
  kind: AttemptKind | string;
  outcome: string;
  text: string;
  tone: "good" | "bad" | "plain";
}

/** 이름이 없으면(옛 파일) 종류 낱말 */
export function roleSteps(task: Pick<TaskView, "roleHistory">, tr: Tr): RoleStep[] {
  return (task.roleHistory ?? []).map((h) => {
    const name = h.roleName?.trim() || h.role || keyText(KIND_KEY, h.kind, tr);
    const good = h.outcome === "pass" || h.outcome === "success";
    const bad = ["changes-requested", "failure", "blocked", "stop-unconfirmed", "exit-unconfirmed"].includes(h.outcome);
    return { attemptId: h.attemptId, name, kind: h.kind, outcome: h.outcome, text: roleOutcomeText(h.outcome, tr), tone: good ? "good" : bad ? "bad" : "plain" };
  });
}

export interface JudgmentRow {
  reviewId: string;
  roleName: string;
  verdict: ReviewVerdict | string;
  at: number;
  state: string;
}

export function judgmentRows(d: Pick<RunDetail, "reviewReports" | "attempts">, taskId: string, tr: Tr): JudgmentRow[] {
  const atts = new Map((d.attempts ?? []).map((a) => [a.id, a]));
  return (d.reviewReports ?? [])
    .filter((r) => r.taskId === taskId)
    .map((r) => ({
      reviewId: r.reviewId,
      roleName: atts.get(r.attemptId)?.roleName?.trim() || tr("orch.attempt.role.reviewer"),
      verdict: r.verdict,
      at: r.at,
      state: r.state,
    }))
    .sort((x, y) => x.at - y.at);
}

export interface ReadinessRule {
  roleName: string;
  have: number;
  need: number;
  last: string;
  text: string;
}

export function readinessLine(
  task: Pick<TaskView, "acceptReadiness">,
  tr: Tr,
): { ok: boolean; delegationOff: boolean; rules: ReadinessRule[] } | null {
  const r = task.acceptReadiness;
  if (!r) return null;
  const rules = (r.unmet ?? []).map((u) => {
    const roleName = u.roleName?.trim() || u.role;
    const last = u.last === "none" ? tr("orch.readiness.last.none") : keyText(VERDICT_KEY, u.last, tr);
    return { roleName, have: u.have, need: u.need, last: u.last, text: tr("orch.readiness.rule", { role: roleName, have: u.have, need: u.need, last }) };
  });
  return { ok: r.ok === true, delegationOff: r.delegation === "not-active", rules };
}

export function waiverNoteNeeded(task: Pick<TaskView, "acceptReadiness" | "state">): boolean {
  const r = task.acceptReadiness;
  return task.state === "reported" && !!r && r.ok === false && (r.unmet ?? []).length > 0;
}

export function waiverTexts(list: readonly WaiverView[] | null | undefined, tr: Tr): string[] {
  return (list ?? []).map((w) =>
    w.rule === "review"
      ? tr("orch.reviewer.waived")
      : tr("orch.waived.rule", { role: w.roleName?.trim() || w.role || "?", have: w.have, need: w.need }),
  );
}

/** 옛 `reviewWaivedBy` 까지 읽는다 — 서버 `AcceptedArtifact::waivers` 와 같은 규칙 */
export function acceptedWaivers(
  task: Pick<TaskView, "waived">,
  acc: Pick<AcceptedView, "waived" | "reviewWaivedBy"> | null | undefined,
): WaiverView[] {
  if (task.waived && task.waived.length > 0) return task.waived;
  if (acc?.waived && acc.waived.length > 0) return acc.waived;
  return acc?.reviewWaivedBy ? [{ rule: "review", need: 1, have: 0 }] : [];
}

export function reworkText(task: Pick<TaskView, "rework">, tr: Tr): { text: string; atLimit: boolean } | null {
  const r = task.rework;
  if (!r) return null;
  const max = typeof r.max === "number" ? r.max : null;
  if (r.used === 0 && max === null) return null;
  return { text: tr("orch.rework", { used: r.used, max: max ?? "—" }), atLimit: max !== null && r.used > max };
}

export function hasJudges(d: Pick<RunDetail, "roles">): boolean {
  return (d.roles ?? []).some((r) => r.kind === "judge");
}

// ── 검토자 ──

export interface ReviewLine {
  state: ReviewStateView["state"];
  summary: string;
  findings: string[];
  required: boolean;
  budgetLeft: number | null;
}

export function reviewLine(d: RunDetail, task: TaskView): ReviewLine | null {
  const rs = d.reviewState?.[task.id];
  const state = rs?.state ?? "none";
  const required = d.requireReview === true;
  if (state === "none" && !(required && task.state === "reported")) return null;
  return {
    state,
    summary: rs?.summary ?? "",
    findings: rs?.findings ?? [],
    required,
    budgetLeft: typeof d.remaining?.reviews === "number" ? d.remaining.reviews : null,
  };
}

export const REVIEW_STATE_KEY: Record<ReviewStateView["state"], Key> = {
  none: "orch.reviewer.state.none",
  pending: "orch.reviewer.state.pending",
  pass: "orch.reviewer.state.pass",
  "changes-requested": "orch.reviewer.state.changes-requested",
};

/** 옛 서버면 칸이 없다 = 작업자 */
export function isReviewer(a: AttemptView): boolean {
  return a.role === "reviewer";
}

export interface ReviewTurnLine {
  phase: "running" | "ended" | "failed";
  reason: string | null;
  model: string | null;
  attemptId: string;
}

const LIVE_ATTEMPT: ReadonlySet<string> = new Set(["spawning", "running", "starting", "ready", "working", "stopping"]);

/** 프로세스 쪽 사실만(도는가 · 왜 끝났나 · 어느 모델) — 판정은 `reviewLine` 이 따로 보인다 */
export function reviewTurnLine(d: Pick<RunDetail, "attempts" | "reviewState">, task: Pick<TaskView, "id">): ReviewTurnLine | null {
  const reportId = d.reviewState?.[task.id]?.reportId ?? null;
  const mine = (d.attempts ?? []).filter(
    (a) => isReviewer(a) && a.taskId === task.id && (reportId === null || a.reviewOf?.reportId === reportId),
  );
  if (mine.length === 0) return null;
  const a = mine.reduce((x, y) => (y.startedAt >= x.startedAt ? y : x));
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const model = last?.model ?? null;
  if (!last) return LIVE_ATTEMPT.has(a.state) ? { phase: "running", reason: null, model, attemptId: a.id } : null;
  if (last.outcome === "running") return { phase: "running", reason: null, model, attemptId: a.id };
  if (last.outcome === "ok") return { phase: "ended", reason: null, model, attemptId: a.id };
  const reason =
    last.outcome === "failed" ? (last.reason ?? "failed") : last.reason ? `${last.outcome}:${last.reason}` : last.outcome;
  return { phase: "failed", reason, model, attemptId: a.id };
}

export const REVIEW_TURN_KEY: Record<ReviewTurnLine["phase"], Key> = {
  running: "orch.reviewer.turn.running",
  ended: "orch.reviewer.turn.ended",
  failed: "orch.reviewer.turn.failed",
};

// ── 보고 · 수락 ──

export const OUTCOME_KEY: Record<ReportOutcome, Key> = {
  success: "orch.report.outcome.success",
  failure: "orch.report.outcome.failure",
  blocked: "orch.report.outcome.blocked",
};

/** 서버 `review_in` 과 같은 고르기 */
export function reviewReport(
  run: Pick<RunDetail, "reports">,
  task: Pick<TaskView, "currentAttempt">,
): ReportView | null {
  const att = task.currentAttempt;
  if (!att) return null;
  return (run.reports ?? []).find((r) => r.attemptId === att && !r.late) ?? null;
}

export function lateReports(run: Pick<RunDetail, "reports">, taskId: string): ReportView[] {
  return (run.reports ?? []).filter((r) => r.taskId === taskId && r.late);
}

export function validAccepted(run: Pick<RunDetail, "accepted">, taskId: string): AcceptedView | null {
  const list = (run.accepted ?? []).filter((a) => a.taskId === taskId && !a.revokedAt);
  return list.length > 0 ? list[list.length - 1] : null;
}

export function lastRevoked(run: Pick<RunDetail, "accepted">, taskId: string): AcceptedView | null {
  const list = (run.accepted ?? []).filter((a) => a.taskId === taskId && !!a.revokedAt);
  return list.length > 0 ? list[list.length - 1] : null;
}

/** 서버 `dirty-report` · `not-success` · `no-commit` 과 같은 순서 */
export function acceptBlocker(r: Pick<ReportView, "outcome" | "dirty" | "commitOid" | "mismatch">): Key | null {
  if (r.outcome !== "success") return "orch.review.blocked.notSuccess";
  if (r.mismatch) return "orch.review.blocked.mismatch";
  if (r.dirty) return "orch.review.blocked.dirty";
  if (!r.commitOid) return "orch.review.blocked.noCommit";
  return null;
}

/**
 * 서버 `human_review` 규칙과 같다(서버가 다시 판정한다). 통합 ref 에 쌓인 수락은 서버가 반려를 `already-integrated` 로 거절하므로
 * [반려] 를 보이지 않는다 — 되돌리기는 사람이 git 으로.
 */
export function reviewActions(
  task: Pick<TaskView, "state">,
  report: Pick<ReportView, "outcome" | "dirty" | "commitOid" | "mismatch"> | null,
  run: RunState,
  integrated = false,
): { accept: boolean; acceptFlip: boolean; blocked: Key | null; reject: boolean; rejectFlip: boolean } {
  const live = run === "running" || run === "paused" || run === "stopping";
  const accept = live && !!report && (task.state === "reported" || task.state === "rejected");
  // 충돌한 Task 는 반려로 나간다.
  const reject = live && !integrated && (task.state === "reported" || task.state === "accepted" || task.state === "conflict");
  return {
    accept,
    acceptFlip: accept && task.state === "rejected",
    blocked: accept && report ? acceptBlocker(report) : null,
    reject,
    rejectFlip: reject && task.state === "accepted",
  };
}

export function wantsDrift(run: Pick<RunDetail, "reports" | "attempts" | "state">): boolean {
  if (run.state === "orphaned") return false;
  const withTree = new Set((run.attempts ?? []).filter((a) => !!a.worktree).map((a) => a.id));
  return (run.reports ?? []).some((r) => withTree.has(r.attemptId));
}

export function driftedAttempts(list: readonly DriftView[]): Set<string> {
  return new Set(list.filter((d) => d.changedSinceReport).map((d) => d.attemptId));
}

export function reportDiffRange(
  r: Pick<ReportView, "baseCommitOid" | "commitOid">,
): { base: string; tip: string } | null {
  return r.baseCommitOid && r.commitOid ? { base: r.baseCommitOid, tip: r.commitOid } : null;
}
