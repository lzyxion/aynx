/**
 * 검토 · 수락 — 거친 역할 · 판정 이력 · 수락 규칙 충족 · 면제 · 되돌림 · 검토 줄 · 보고 고르기 · 사람 검토 단추 · 보고 뒤 변경.
 */

import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { AcceptedView, AttemptKind, AttemptView, DriftView, ReportOutcome, ReportView, ReviewStateView, ReviewVerdict, RunDetail, RunState, TaskView, WaiverView } from "./types";
import { ATTEMPT_STATE_KEY, KIND_KEY } from "./worker";

// ---------------------------------------------------------------------------
// 역할 이력 · 수락 규칙 충족 · 되돌림 · 면제(3차 3b — 설계 3-2a · 2-4)
// ---------------------------------------------------------------------------

/** 역할 이력의 결과 낱말 → 문구(판정 · 보고 결과 · `blocked` · Attempt 상태 — 모르면 날 낱말) */
export function roleOutcomeText(outcome: string, tr: Tr): string {
  if (outcome === "pass" || outcome === "changes-requested") return keyText(VERDICT_KEY, outcome, tr);
  if (outcome === "success" || outcome === "failure" || outcome === "blocked") return keyText(OUTCOME_KEY, outcome, tr);
  return keyText(ATTEMPT_STATE_KEY, outcome, tr);
}

/** 판정 낱말 → 문구 키 */
export const VERDICT_KEY: Record<ReviewVerdict, Key> = {
  pass: "orch.verdict.pass",
  "changes-requested": "orch.verdict.changes-requested",
};

/** 거친 역할 한 줄 */
export interface RoleStep {
  attemptId: string;
  name: string;
  kind: AttemptKind | string;
  outcome: string;
  text: string;
  /** 결과 쪽 색 — 좋음(pass · success) · 나쁨(changes-requested · failure · blocked · 종료 미확인) · 보통 */
  tone: "good" | "bad" | "plain";
}

/** Task 의 거친 역할(서버 `roleHistory` — 띄운 순서). 이름이 없으면(옛 파일) 종류 낱말 */
export function roleSteps(task: Pick<TaskView, "roleHistory">, tr: Tr): RoleStep[] {
  return (task.roleHistory ?? []).map((h) => {
    const name = h.roleName?.trim() || h.role || keyText(KIND_KEY, h.kind, tr);
    const good = h.outcome === "pass" || h.outcome === "success";
    const bad = ["changes-requested", "failure", "blocked", "stop-unconfirmed", "exit-unconfirmed"].includes(h.outcome);
    return { attemptId: h.attemptId, name, kind: h.kind, outcome: h.outcome, text: roleOutcomeText(h.outcome, tr), tone: good ? "good" : bad ? "bad" : "plain" };
  });
}

/** 판정 이력 한 줄(판정 역할 · 판정 · 시각 · current/stale/late) */
export interface JudgmentRow {
  reviewId: string;
  roleName: string;
  verdict: ReviewVerdict | string;
  at: number;
  state: string;
}

/** Task 의 판정 이력(시각순) — 판정 역할 이름은 그 Attempt 의 역할 사본(옛 파일은 "검토") */
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

/** 수락 규칙 충족 한 줄(규칙마다) */
export interface ReadinessRule {
  roleName: string;
  have: number;
  need: number;
  last: string;
  text: string;
}

/**
 * 수락 규칙 충족(`acceptReadiness` — 보고된 Task 만). 맡기기가 적용되지 않으면(`delegation: not-active`) `delegationOff`. 규칙이 다
 * 채워졌으면 `ok`. 규칙 하나 = "<역할> pass <have>/<need> · 마지막 <판정>".
 */
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

/** 사람 [수락] 곁의 "수락하면 규칙 면제로 기록됩니다" 를 보일까 — 규칙을 못 채운 보고된 Task 만(맡기기가 없으면 면제할 규칙이 없다) */
export function waiverNoteNeeded(task: Pick<TaskView, "acceptReadiness" | "state">): boolean {
  const r = task.acceptReadiness;
  return task.state === "reported" && !!r && r.ok === false && (r.unmet ?? []).length > 0;
}

/** 수락된 산출물의 면제 문구들 — "면제: <역할> pass <have>/<need>" · 옛 필수 검토 면제는 그 문구 */
export function waiverTexts(list: readonly WaiverView[] | null | undefined, tr: Tr): string[] {
  return (list ?? []).map((w) =>
    w.rule === "review"
      ? tr("orch.reviewer.waived")
      : tr("orch.waived.rule", { role: w.roleName?.trim() || w.role || "?", have: w.have, need: w.need }),
  );
}

/**
 * 유효한 수락이 넘은 규칙 — 서버 Task 보기의 `waived`(서버가 `waivers()` 로 옛 칸까지 읽어 준다)가 주, 없으면 산출물의 `waived`, 그것도
 * 없으면 옛 `reviewWaivedBy`(→ `{rule: "review"}` 한 줄 — 서버 `AcceptedArtifact::waivers` 와 같은 규칙).
 */
export function acceptedWaivers(
  task: Pick<TaskView, "waived">,
  acc: Pick<AcceptedView, "waived" | "reviewWaivedBy"> | null | undefined,
): WaiverView[] {
  if (task.waived && task.waived.length > 0) return task.waived;
  if (acc?.waived && acc.waived.length > 0) return acc.waived;
  return acc?.reviewWaivedBy ? [{ rule: "review", need: 1, have: 0 }] : [];
}

/** 되돌림 `used/max`(맡기기가 없으면 max 는 `—`) — 아무것도 없으면 `null` */
export function reworkText(task: Pick<TaskView, "rework">, tr: Tr): { text: string; atLimit: boolean } | null {
  const r = task.rework;
  if (!r) return null;
  const max = typeof r.max === "number" ? r.max : null;
  if (r.used === 0 && max === null) return null;
  return { text: tr("orch.rework", { used: r.used, max: max ?? "—" }), atLimit: max !== null && r.used > max };
}

/** 판정형 역할이 있나(보드의 "남은 판정" 칩) — 지금 맡기기의 역할(3차 6단계 — 옛 검토자 CLI 칸은 보기에 없다) */
export function hasJudges(d: Pick<RunDetail, "roles">): boolean {
  return (d.roles ?? []).some((r) => r.kind === "judge");
}

// ---------------------------------------------------------------------------
// 검토자(통합 설계 5단계)
// ---------------------------------------------------------------------------

/** 보드의 검토 줄 — 현재 보고의 검토 상태 · 판정 · 찾은 것 · 필수 여부 · 남은 예산 */
export interface ReviewLine {
  state: ReviewStateView["state"];
  summary: string;
  findings: string[];
  required: boolean;
  /** 남은 검토(옛 서버면 `null`) */
  budgetLeft: number | null;
}

/**
 * Task 의 검토 줄 — 순수. 서버의 `reviewState`(현재 보고의 마지막 유효 판정 · 활성 검토)를 그대로 보인다. 검토가 없을 때는
 * 필수(`requireReview`)이고 Task 가 보고된 상태일 때만 "검토 없음" 줄을 그리고, 그 밖에는 `null`(줄 없음).
 */
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

/** 검토 상태 → 문구 키 */
export const REVIEW_STATE_KEY: Record<ReviewStateView["state"], Key> = {
  none: "orch.reviewer.state.none",
  pending: "orch.reviewer.state.pending",
  pass: "orch.reviewer.state.pass",
  "changes-requested": "orch.reviewer.state.changes-requested",
};

/** 검토자 Attempt 인가(옛 서버면 칸이 없다 = 작업자) */
export function isReviewer(a: AttemptView): boolean {
  return a.role === "reviewer";
}

/** 보드 검토 칸의 턴 줄(3차 2단계 — 헤드리스 검토자) — 도는 중 · 끝 · 실패(사유 낱말) · 실효 모델 */
export interface ReviewTurnLine {
  phase: "running" | "ended" | "failed";
  /** 실패 낱말(`no-result` · `timeout` · `conversation-mismatch` …) — `failed` 일 때만 */
  reason: string | null;
  /** 실효 모델(Claude init) — 모르면 `null` */
  model: string | null;
  attemptId: string;
}

const LIVE_ATTEMPT: ReadonlySet<string> = new Set(["spawning", "running", "starting", "ready", "working", "stopping"]);

/**
 * Task 의 검토 칸에 보일 턴 줄 — 순수. 그 Task 의 **현재 보고**(서버 `reviewState.reportId`)를 검토한 검토자 Attempt 중 마지막 것의
 * 마지막 턴. 턴 기록이 없으면(옛 서버 · 아직 안 섬) 살아 있는 검토자면 "도는 중", 아니면 `null`. 판정은 `reviewLine` 이 따로 보인다 —
 * 이 줄은 프로세스 쪽 사실(도는가 · 왜 끝났나 · 어느 모델)이다.
 */
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
  // `failed` 는 사유 낱말 그대로, 그 밖(`timeout` · `stopped` · `stop-unconfirmed`)은 결과 낱말(+ 사유).
  const reason =
    last.outcome === "failed" ? (last.reason ?? "failed") : last.reason ? `${last.outcome}:${last.reason}` : last.outcome;
  return { phase: "failed", reason, model, attemptId: a.id };
}

export const REVIEW_TURN_KEY: Record<ReviewTurnLine["phase"], Key> = {
  running: "orch.reviewer.turn.running",
  ended: "orch.reviewer.turn.ended",
  failed: "orch.reviewer.turn.failed",
};

// ---------------------------------------------------------------------------
// 보고 · 수락(4단계)
// ---------------------------------------------------------------------------

export const OUTCOME_KEY: Record<ReportOutcome, Key> = {
  success: "orch.report.outcome.success",
  failure: "orch.report.outcome.failure",
  blocked: "orch.report.outcome.blocked",
};

/** 그 Task 의 **검토 대상 보고** — 현재 Attempt 의 늦지 않은 보고(서버 `review_in` 과 같은 고르기). 없으면 `null` */
export function reviewReport(
  run: Pick<RunDetail, "reports">,
  task: Pick<TaskView, "currentAttempt">,
): ReportView | null {
  const att = task.currentAttempt;
  if (!att) return null;
  return (run.reports ?? []).find((r) => r.attemptId === att && !r.late) ?? null;
}

/** 그 Task 에 온 늦은 보고들(기록만 — 보드가 따로 표시) */
export function lateReports(run: Pick<RunDetail, "reports">, taskId: string): ReportView[] {
  return (run.reports ?? []).filter((r) => r.taskId === taskId && r.late);
}

/** 그 Task 의 유효한 수락(마지막 · 거둬지지 않은 것) */
export function validAccepted(run: Pick<RunDetail, "accepted">, taskId: string): AcceptedView | null {
  const list = (run.accepted ?? []).filter((a) => a.taskId === taskId && !a.revokedAt);
  return list.length > 0 ? list[list.length - 1] : null;
}

/** 그 Task 의 마지막 거둔 수락(뒤집힘 표시) */
export function lastRevoked(run: Pick<RunDetail, "accepted">, taskId: string): AcceptedView | null {
  const list = (run.accepted ?? []).filter((a) => a.taskId === taskId && !!a.revokedAt);
  return list.length > 0 ? list[list.length - 1] : null;
}

/** 수락이 막힌 까닭(서버 `dirty-report` · `not-success` · `no-commit` 과 같은 순서) — 수락할 수 있으면 `null` */
export function acceptBlocker(r: Pick<ReportView, "outcome" | "dirty" | "commitOid" | "mismatch">): Key | null {
  if (r.outcome !== "success") return "orch.review.blocked.notSuccess";
  if (r.mismatch) return "orch.review.blocked.mismatch";
  if (r.dirty) return "orch.review.blocked.dirty";
  if (!r.commitOid) return "orch.review.blocked.noCommit";
  return null;
}

/**
 * 사람의 검토 단추(서버 `human_review` 규칙과 같다 — 서버가 다시 판정한다):
 * - [수락]: Task 가 reported(또는 rejected — 뒤집기)이고 검토 대상 보고가 있을 때 보인다. 막힌 까닭이 있으면 꺼진 채 까닭을 단다.
 * - [반려]: Task 가 reported(또는 accepted — 뒤집기)일 때.
 * Run 이 running · paused · stopping 일 때만(orphaned · 끝난 Run 은 읽기 전용).
 * `integrated` = 그 Task 의 유효 수락이 이미 통합 ref 에 쌓였다(`validAccepted(..).integrationCommit`) — 서버가 반려를
 * `already-integrated` 로 거절하므로 [반려] 를 보이지 않는다(되돌리기는 사람이 git 으로 — 실기 10-31 사용자 결정 1안).
 * 수락 직후 통합 전의 짧은 틈에는 그대로 보인다.
 */
export function reviewActions(
  task: Pick<TaskView, "state">,
  report: Pick<ReportView, "outcome" | "dirty" | "commitOid" | "mismatch"> | null,
  run: RunState,
  integrated = false,
): { accept: boolean; acceptFlip: boolean; blocked: Key | null; reject: boolean; rejectFlip: boolean } {
  const live = run === "running" || run === "paused" || run === "stopping";
  const accept = live && !!report && (task.state === "reported" || task.state === "rejected");
  // 충돌한 Task 는 반려로 나간다(통합 설계 4-6 — 해결 Attempt 는 3b).
  const reject = live && !integrated && (task.state === "reported" || task.state === "accepted" || task.state === "conflict");
  return {
    accept,
    acceptFlip: accept && task.state === "rejected",
    blocked: accept && report ? acceptBlocker(report) : null,
    reject,
    rejectFlip: reject && task.state === "accepted",
  };
}

/**
 * "보고 뒤 변경" 을 읽을 까닭이 있는가 — 보고가 있고 그 Attempt 에 worktree 가 남아 있을 때만(보드가 열려 있을 때의 가벼운
 * 확인 — 없으면 부르지 않는다).
 */
export function wantsDrift(run: Pick<RunDetail, "reports" | "attempts" | "state">): boolean {
  if (run.state === "orphaned") return false;
  const withTree = new Set((run.attempts ?? []).filter((a) => !!a.worktree).map((a) => a.id));
  return (run.reports ?? []).some((r) => withTree.has(r.attemptId));
}

/** drift 목록 → Attempt id 의 집합(보고 뒤 바뀐 것만) */
export function driftedAttempts(list: readonly DriftView[]): Set<string> {
  return new Set(list.filter((d) => d.changedSinceReport).map((d) => d.attemptId));
}

/** 보고의 diff 범위 — 기준 커밋 · 보고 커밋이 다 있을 때만(없으면 `null` — 단추를 끈다) */
export function reportDiffRange(
  r: Pick<ReportView, "baseCommitOid" | "commitOid">,
): { base: string; tip: string } | null {
  return r.baseCommitOid && r.commitOid ? { base: r.baseCommitOid, tip: r.commitOid } : null;
}
