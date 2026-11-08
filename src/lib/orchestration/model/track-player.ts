/** 트랙 화면의 선택과 안내. 서버 보기만 읽고 경로·조회·화면 상태는 바꾸지 않는다. */
import type { AttemptView, RunDetail, TaskView } from "./types";
import { turnRunning } from "./album";
import { awaitingVerify } from "./integration";
import { isReviewer, reviewActions, reviewReport, validAccepted } from "./review";
import type { TrackNeed } from "./album";

/** 시도와 검토는 시작 시각이 최신인 것부터. 같은 시각이면 장부의 뒤쪽이 먼저다. */
export function trackAttempts(detail: Pick<RunDetail, "attempts">, taskId: string): AttemptView[] {
  return (detail.attempts ?? [])
    .map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => attempt.taskId === taskId)
    .sort((a, b) => b.attempt.startedAt - a.attempt.startedAt || b.index - a.index)
    .map(({ attempt }) => attempt);
}

/** 명시한 시도는 같은 트랙 안에서만 선택한다. 기본 선택은 도는 작업·검토, 막힘, 최신 기록 순이다. */
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

/** 이웃은 시도 수와 무관하게 앨범의 트랙 순서를 따른다. 끝에서 반대편으로 돌지 않는다. */
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

/** 트랙의 전체 상태 안내. 과거 시도를 보고 있어도 사람 관문과 현재 트랙 상태가 먼저 보인다. */
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

/**
 * 오른쪽 칸 첫 카드가 **사람 확인** 모양(호박)인가 — 트랙의 사람 필요 까닭(`trackNeed`)이 있거나, 보고된 트랙을 사람이 수락할 수 있을 때.
 * 이미 수락된 트랙의 [반려로 뒤집기] · 반려된 트랙의 [수락으로 뒤집기] 는 사람의 선택일 뿐 기다리는 관문이 아니라 넣지 않는다.
 */
export function trackHumanGate(detail: RunDetail, task: TaskView, need: TrackNeed | null): boolean {
  if (need) return true;
  if (task.state !== "reported") return false;
  const ra = reviewActions(task, reviewReport(detail, task), detail.state, !!validAccepted(detail, task.id)?.integrationCommit);
  return ra.accept && !ra.acceptFlip;
}

/**
 * 상태 카드의 "검토 n / m" — 못 채운 수락 규칙이 있으면 그 규칙들의 통과 수 / 필요 수, 없으면 이 트랙의 지금 유효한 판정의 통과 / 전체.
 * 둘 다 없으면 `null`(칸을 두지 않는다 — 지어낸 숫자 없음).
 */
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
