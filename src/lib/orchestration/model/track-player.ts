import type { AttemptView, RunDetail, TaskView } from "./types";
import { turnRunning } from "./album";
import { awaitingVerify } from "./integration";
import { isReviewer, reviewActions, reviewReport, validAccepted } from "./review";
import type { TrackNeed } from "./album";

export function trackAttempts(detail: Pick<RunDetail, "attempts">, taskId: string): AttemptView[] {
  return (detail.attempts ?? [])
    .map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => attempt.taskId === taskId)
    .sort((a, b) => b.attempt.startedAt - a.attempt.startedAt || b.index - a.index)
    .map(({ attempt }) => attempt);
}

export function currentTrackAttempt(detail: Pick<RunDetail, "attempts" | "state">, taskId: string, attemptId?: string | null): AttemptView | null {
  const attempts = trackAttempts(detail, taskId);
  const selected = attempts.find((a) => a.id === attemptId);
  if (selected) return selected;
  const running = detail.state === "orphaned" ? [] : attempts.filter(turnRunning);
  return running.find((a) => !isReviewer(a) && a.kind !== "judge")
    ?? running[0]
    ?? attempts.find((a) => a.state === "idle" && a.blocked)
    ?? attempts[0]
    ?? null;
}

export interface TrackNeighbor {
  task: TaskView;
  no: number;
}

export function trackNeighbors(detail: Pick<RunDetail, "tasks">, taskId: string): { prev: TrackNeighbor | null; next: TrackNeighbor | null } {
  const index = detail.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return { prev: null, next: null };
  return {
    prev: index > 0 ? { task: detail.tasks[index - 1], no: index } : null,
    next: index + 1 < detail.tasks.length ? { task: detail.tasks[index + 1], no: index + 2 } : null,
  };
}

export type TrackPresentationState = "waiting" | "playing" | "reviewing" | "blocked" | "verify" | "conflict" | "accepted" | "rejected" | "reported" | "cancelled" | "integrating";
export type TrackPresentationKey = `orch.player.state.${TrackPresentationState}`;

export function trackPresentation(detail: RunDetail, task: TaskView): { key: TrackPresentationKey } {
  const show = (state: TrackPresentationState) => ({ key: `orch.player.state.${state}` as TrackPresentationKey });
  if (task.state === "accepted" || task.state === "rejected" || task.state === "cancelled") return show(task.state);
  if (task.state === "conflict") return show("conflict");
  if (awaitingVerify(detail, task.id)) return show("verify");
  const attempts = trackAttempts(detail, task.id);
  if (attempts.some((a) => a.state === "idle" && a.blocked)) return show("blocked");
  if (task.state === "integrating") return show("integrating");
  if (detail.state !== "orphaned") {
    const running = attempts.filter(turnRunning);
    if (running.some((a) => !isReviewer(a) && a.kind !== "judge")) return show("playing");
    if (running.length > 0) return show("reviewing");
  }
  if (task.state === "reported") return show("reported");
  return show("waiting");
}

/** 수락 · 반려 뒤집기는 기다리는 관문이 아니라 넣지 않는다 */
export function trackHumanGate(detail: RunDetail, task: TaskView, need: TrackNeed | null): boolean {
  if (need) return true;
  if (task.state !== "reported") return false;
  const ra = reviewActions(task, reviewReport(detail, task), detail.state, !!validAccepted(detail, task.id)?.integrationCommit);
  return ra.accept && !ra.acceptFlip;
}

export function trackReviewCount(
  detail: Pick<RunDetail, "reviewReports">,
  task: Pick<TaskView, "id" | "acceptReadiness">,
): { have: number; need: number } | null {
  const unmet = task.acceptReadiness?.unmet ?? [];
  if (unmet.length > 0) return unmet.reduce((s, u) => ({ have: s.have + u.have, need: s.need + u.need }), { have: 0, need: 0 });
  const current = (detail.reviewReports ?? []).filter((r) => r.taskId === task.id && r.state === "current");
  if (current.length === 0) return null;
  return { have: current.filter((r) => r.verdict === "pass").length, need: current.length };
}
