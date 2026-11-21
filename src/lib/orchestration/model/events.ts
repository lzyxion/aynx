import type { Key } from "$lib/i18n/keys";
import { keyOf, keyText, type Tr } from "./text";
import type { Actor, OrchNotice, RunChanged, RunProgress } from "./types";

/** `archive`(복원)는 seq 가 그대로라 seq 비교보다 먼저 본다 */
export function changeAction(ev: RunChanged, watching: string | null, known: number | null): "refetch" | "skip" | "closed" {
  if (watching === null) return "refetch";
  if (ev.runId !== watching) return "skip";
  if (ev.closed) return "closed";
  if (ev.archive) return "refetch";
  if (known !== null && ev.seq <= known) return "skip";
  return "refetch";
}

/** 진행 사건은 seq 가 그대로라 `changeAction` 으로는 서지 않는다 */
export function progressAction(ev: RunProgress, watching: string | null): "refetch" | "skip" {
  return watching !== null && ev.runId === watching ? "refetch" : "skip";
}

export const RESYNC_MS = 30_000;

export function resyncDue(visible: boolean, syncedAt: number | null, now: number): boolean {
  return visible && syncedAt !== null && now - syncedAt >= RESYNC_MS;
}

export const LIST_REFRESH_MS = 3_000;

export function listRefreshDue(visible: boolean, syncedAt: number | null, now: number): boolean {
  return visible && syncedAt !== null && now - syncedAt >= LIST_REFRESH_MS;
}

/** 목록에 없으면(닫혔다 · 서버가 바뀌었다) 다시 읽어 상세가 "없음" 을 정하게 한다 */
export function resyncAction(list: readonly { runId: string; latestSeq: number }[], watching: string, known: number | null): "refetch" | "skip" {
  const r = list.find((x) => x.runId === watching);
  if (!r || known === null) return "refetch";
  return r.latestSeq > known ? "refetch" : "skip";
}

/** 서버 `bump` 의 낱말 전부(시험이 지킨다) · 옛 파일의 낱말도 둔다 */
export const ACTION_KEY: Record<string, Key> = {
  run_started: "orch.action.run_started",
  task_created: "orch.action.task_created",
  task_updated: "orch.action.task_updated",
  human_paused: "orch.action.human_paused",
  human_resumed: "orch.action.human_resumed",
  human_stopped: "orch.action.human_stopped",
  human_continued: "orch.action.human_continued",
  run_ended: "orch.action.run_ended",
  limit_reached: "orch.action.limit_reached",
  coordinator_exited: "orch.action.coordinator_exited",
  run_adopted: "orch.action.run_adopted",
  persist_failed: "orch.action.persist_failed",
  persist_recovered: "orch.action.persist_recovered",
  album_changed: "orch.action.album_changed",
  album_renamed: "orch.action.album_renamed",
  generation_bumped: "orch.action.generation_bumped",
  producer_woken: "orch.action.producer_woken",
  worker_spawning: "orch.action.worker_spawning",
  worktree_created: "orch.action.worktree_created",
  worker_started: "orch.action.worker_started",
  spawn_failed: "orch.action.spawn_failed",
  worker_state: "orch.action.worker_state",
  bootstrap_waiting: "orch.action.bootstrap_waiting",
  worker_stopping: "orch.action.worker_stopping",
  worker_stopped: "orch.action.worker_stopped",
  stop_unconfirmed: "orch.action.stop_unconfirmed",
  worker_exited: "orch.action.worker_exited",
  worktree_removed: "orch.action.worktree_removed",
  worker_reported: "orch.action.worker_reported",
  task_accepted: "orch.action.task_accepted",
  task_rejected: "orch.action.task_rejected",
  prompt_sending: "orch.action.prompt_sending",
  prompt_sent: "orch.action.prompt_sent",
  prompt_rejected: "orch.action.prompt_rejected",
  human_intervened: "orch.action.human_intervened",
  human_returned: "orch.action.human_returned",
  recovery_done: "orch.action.recovery_done",
  worker_stalled: "orch.action.worker_stalled",
  worker_committed: "orch.action.worker_committed",
  commit_rejected: "orch.action.commit_rejected",
  worker_auto_stopped: "orch.action.worker_auto_stopped",
  auto_stop_armed: "orch.action.auto_stop_armed",
  auto_stop_cancelled: "orch.action.auto_stop_cancelled",
  task_integrating: "orch.action.task_integrating",
  integration_candidate: "orch.action.integration_candidate",
  integration_committing: "orch.action.integration_committing",
  task_integrated: "orch.action.task_integrated",
  recovered_integrated: "orch.action.recovered_integrated",
  integration_aborted: "orch.action.integration_aborted",
  run_held: "orch.action.run_held",
  hold_released: "orch.action.hold_released",
  run_done: "orch.action.run_done",
  integration_conflict: "orch.action.integration_conflict",
  resolver_spawning: "orch.action.resolver_spawning",
  human_reconciled: "orch.action.human_reconciled",
  integration_exported: "orch.action.integration_exported",
  integration_merged: "orch.action.integration_merged",
  integration_auto_merged: "orch.action.integration_auto_merged",
  auto_merge_stopped: "orch.action.auto_merge_stopped",
  verify_awaiting_approval: "orch.action.verify_awaiting_approval",
  verify_approved: "orch.action.verify_approved",
  verify_started: "orch.action.verify_started",
  verify_finished: "orch.action.verify_finished",
  human_override_verify: "orch.action.human_override_verify",
  reviewer_spawning: "orch.action.reviewer_spawning",
  review_place_created: "orch.action.review_place_created",
  reviewer_reported: "orch.action.reviewer_reported",
  review_invalidated: "orch.action.review_invalidated",
  review_ended: "orch.action.review_ended",
  turn_started: "orch.action.turn_started",
  turn_ended: "orch.action.turn_ended",
  turn_requested: "orch.action.turn_requested",
  worker_blocked: "orch.action.worker_blocked",
  worker_closed: "orch.action.worker_closed",
  worker_idle: "orch.action.worker_idle",
  worker_turn_ended: "orch.action.worker_turn_ended",
  reviewer_turn_ended: "orch.action.reviewer_turn_ended",
  exit_unconfirmed: "orch.action.exit_unconfirmed",
  verify_needs_human: "orch.action.verify_needs_human",
  server_temp_cleaned: "orch.action.server_temp_cleaned",
  server_temp_discarded: "orch.action.server_temp_discarded",
  run_cleaned: "orch.action.run_cleaned",
};

export function actionLabel(action: string, tr: Tr): string {
  return keyText(ACTION_KEY, action, tr);
}

export const ACTOR_KEY: Record<Actor, Key> = {
  human: "orch.actor.human",
  coordinator: "orch.actor.coordinator",
  worker: "orch.actor.worker",
  server: "orch.actor.server",
  reviewer: "orch.actor.reviewer",
};

// ── 감독 사건 ──

/** 서버 `orchestration::notice::EVT_NOTICE` 와 같은 값 */
export const NOTICE_EVENT = "orchestration-notice";

/** 서버 `notice::kind_word` 와 맞춘다(시험이 지킨다) */
export const NOTICE_KEY: Record<string, Key> = {
  "worker-exited": "orch.notice.worker-exited",
  "reviewer-exited": "orch.notice.reviewer-exited",
  "exit-unconfirmed": "orch.notice.exit-unconfirmed",
  "spawn-failed": "orch.notice.spawn-failed",
  limit: "orch.notice.limit",
  "coordinator-exited": "orch.notice.coordinator-exited",
  "run-ended": "orch.notice.run-ended",
  "auto-merge-stopped": "orch.notice.auto-merge-stopped",
  "commit-rejected": "orch.notice.commit-rejected",
  "persist-failed": "orch.notice.persist-failed",
  "integration-diverged": "orch.notice.integration-diverged",
  "integration-conflict": "orch.notice.integration-conflict",
  "integration-unsupported": "orch.notice.integration-unsupported",
  "integration-failed": "orch.notice.integration-failed",
  "verify-approval": "orch.notice.verify-approval",
  "verify-failed": "orch.notice.verify-failed",
  "review-changes-requested": "orch.notice.review-changes-requested",
  "cleanup-pending": "orch.notice.cleanup-pending",
  "worker-blocked": "orch.notice.worker-blocked",
  "worker-idle": "orch.notice.worker-idle",
  "turn-timeout": "orch.notice.turn-timeout",
  "verify-needs-human": "orch.notice.verify-needs-human",
  "repo-identity-changed": "orch.notice.repo-identity-changed",
  "run-adopted": "orch.notice.run-adopted",
  "wake-limit": "orch.notice.wake-limit",
  "wake-ignored": "orch.notice.wake-ignored",
  "wake-failed": "orch.notice.wake-failed",
  "wake-turn-timeout": "orch.notice.wake-turn-timeout",
};

/** 서버 `wake::off_reason` 중 알리는 셋 */
const WAKE_LIMIT_KEY: Record<string, Key> = {
  "segment-max": "orch.notice.wake-limit.segment-max",
  "run-max": "orch.notice.wake-limit.run-max",
  unresponsive: "orch.notice.wake-limit.unresponsive",
};

export function noticeKey(kind: string): Key {
  return keyOf(NOTICE_KEY, kind) ?? "orch.notice.other";
}

export function noticeText(
  n: Pick<OrchNotice, "kind" | "runName" | "taskTitle" | "attemptId"> & Partial<Pick<OrchNotice, "detail">>,
  tr: (k: Key, v?: Record<string, string | number>) => string,
): string {
  const task = n.taskTitle?.trim() || n.attemptId || "";
  if (n.kind === "coordinator-exited" && n.detail === "already-paused") {
    return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr("orch.notice.coordinator-exited.paused")}`;
  }
  if (n.kind === "wake-limit") {
    return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr(keyOf(WAKE_LIMIT_KEY, n.detail ?? "") ?? "orch.notice.wake-limit")}`;
  }
  const vars: Record<string, string> = n.detail ? { task, reason: n.detail } : { task };
  return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr(noticeKey(n.kind), vars)}`;
}

/** 토스트를 오래 띄운다 */
export function noticeUrgent(kind: string): boolean {
  return (
    kind === "verify-approval" ||
    kind === "worker-blocked" ||
    kind === "verify-needs-human" ||
    kind === "auto-merge-stopped" ||
    kind === "repo-identity-changed"
  );
}
