/**
 * 사건 — `orchestration-changed` seq 판정 · 타임라인 사건 · 행위자 표 · 감독 사건(알림) 문구.
 */

import type { Key } from "$lib/i18n/keys";
import { keyOf, keyText, type Tr } from "./text";
import type { Actor, OrchNotice, RunChanged, RunProgress } from "./types";

/**
 * 이벤트 `orchestration-changed` 를 받았을 때 할 일 — 순수. 보고 있는 Run(`watching` — 없으면 목록)과 마지막으로 읽은 seq
 * (`known`) 로 가른다:
 * - `closed` → 목록이면 다시 읽기, 보던 Run 이면 `"closed"`(사라짐을 그린다).
 * - `archive`(복원 — seq 가 그대로) → 보던 Run 이면 다시 읽기(사라졌던 판이 돌아온다).
 * - 다른 Run 의 사건 → 목록이면 다시 읽기, 상세면 `"skip"`.
 * - 보던 Run 의 사건 → `seq > known` 일 때만 다시 읽기(이미 읽은 판보다 옛것 · 같은 것은 `"skip"` — 폭주 막기).
 */
export function changeAction(ev: RunChanged, watching: string | null, known: number | null): "refetch" | "skip" | "closed" {
  if (watching === null) return "refetch";
  if (ev.runId !== watching) return "skip";
  if (ev.closed) return "closed";
  if (ev.archive) return "refetch";
  if (known !== null && ev.seq <= known) return "skip";
  return "refetch";
}

/**
 * 이벤트 `orchestration-progress`(F4 — 도는 턴의 진행 칸)를 받았을 때 할 일 — 순수. **보던 Run 의 상세만** 다시 읽는다(seq 가 그대로라
 * `changeAction` 으로는 서지 않는다). 목록은 진행 칸을 그리지 않으니 건너뛴다.
 */
export function progressAction(ev: RunProgress, watching: string | null): "refetch" | "skip" {
  return watching !== null && ev.runId === watching ? "refetch" : "skip";
}

/** (F8) 보드 그물의 주기 — 이벤트를 놓쳐도 이만큼 뒤에는 서버의 seq 를 한 번 본다 */
export const RESYNC_MS = 30_000;

/**
 * (F8) 보드 그물 — 지금 서버 seq 를 확인할 때인가. 순수. **보일 때만** · 마지막으로 읽거나 확인한 뒤 [`RESYNC_MS`] 가 지났을 때만
 * (아직 한 번도 읽지 않았으면 — 첫 읽기가 도는 중 — 서지 않는다). 타이머는 따로 두지 않고 보드의 경과 시계(1초)에 얹는다.
 */
export function resyncDue(visible: boolean, syncedAt: number | null, now: number): boolean {
  return visible && syncedAt !== null && now - syncedAt >= RESYNC_MS;
}

/** 목록 화면을 다시 읽는 최소 간격(ms) — 창 복귀 · 필터를 연달아 눌러도 디스크를 자주 보지 않게 */
export const LIST_REFRESH_MS = 3_000;

/** 목록 화면을 지금 다시 읽어도 되나 — 순수. 보일 때만 · 마지막 읽기 뒤 [`LIST_REFRESH_MS`] 가 지났을 때만(첫 읽기가 도는 중이면 서지 않는다). */
export function listRefreshDue(visible: boolean, syncedAt: number | null, now: number): boolean {
  return visible && syncedAt !== null && now - syncedAt >= LIST_REFRESH_MS;
}

/**
 * (F8) 그물 확인의 판정 — 순수. 목록(`orchestration_snapshot`)의 그 Run 의 `latestSeq` 가 아는 seq 보다 **앞설 때만** 상세를 다시 읽는다.
 * 목록에 없으면(닫혔다 · 서버가 바뀌었다) 다시 읽어 상세가 "없음" 을 정하게 한다. 아는 seq 가 없으면 다시 읽는다.
 */
export function resyncAction(list: readonly { runId: string; latestSeq: number }[], watching: string, known: number | null): "refetch" | "skip" {
  const r = list.find((x) => x.runId === watching);
  if (!r || known === null) return "refetch";
  return r.latestSeq > known ? "refetch" : "skip";
}

/** 타임라인 사건 이름 — 아는 것은 사전, 모르는 것은 그대로(서버 `bump` 의 낱말 전부 — 시험이 지킨다 · 옛 파일 낱말도 둔다) */
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

// ---------------------------------------------------------------------------
// 감독 사건(리뷰 F11 — 서버가 사건 id 와 함께 만든다 · `app/orchestration-notify` 가 주 창에서 한 번 보인다)
// ---------------------------------------------------------------------------

/** 서버 이벤트 — 감독 사건 하나(`orchestration::notice::EVT_NOTICE`) */
export const NOTICE_EVENT = "orchestration-notice";

/** 감독 사건 종류 → 문구 키(서버 `notice::kind_word` + `raise` 하는 종류 전부 — 시험이 지킨다). (3차 6단계) 2차 PTY 작업자의 종류(권한 ·
 * 첫 화면 · 멈춤 · 복구)는 걷었다 — 큐는 서버 메모리라 업데이트(서버 교체) 뒤에는 남지 않는다 */
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
  // 헤드리스 작업자 · 앨범 권한
  "worker-blocked": "orch.notice.worker-blocked",
  "worker-idle": "orch.notice.worker-idle",
  "turn-timeout": "orch.notice.turn-timeout",
  "verify-needs-human": "orch.notice.verify-needs-human",
  "repo-identity-changed": "orch.notice.repo-identity-changed",
  // 이미 열린 앨범 이어받기
  "run-adopted": "orch.notice.run-adopted",
  // 2단계 단계 4 — 앱이 깨움(꺼짐 · 무시 · 전송 실패 · 깨움 턴 시한 — 실기 b 고침 A: 빠져 "사람이 볼 일" 으로 보였다)
  "wake-limit": "orch.notice.wake-limit",
  "wake-ignored": "orch.notice.wake-ignored",
  "wake-failed": "orch.notice.wake-failed",
  "wake-turn-timeout": "orch.notice.wake-turn-timeout",
};

/** `wake-limit` 의 까닭 낱말(`detail` — 서버 `wake::off_reason` 중 알리는 셋) → 문구 키 */
const WAKE_LIMIT_KEY: Record<string, Key> = {
  "segment-max": "orch.notice.wake-limit.segment-max",
  "run-max": "orch.notice.wake-limit.run-max",
  unresponsive: "orch.notice.wake-limit.unresponsive",
};

/** 사건 종류 → 문구 키(모르는 종류는 `orch.notice.other` — 예외 없음) */
export function noticeKey(kind: string): Key {
  return keyOf(NOTICE_KEY, kind) ?? "orch.notice.other";
}

/** 알림 한 줄의 글자 — `Run · <이름> — <사건>`. 작업자 사건은 Task 제목(없으면 Attempt id)을 싣는다. */
export function noticeText(
  n: Pick<OrchNotice, "kind" | "runName" | "taskTitle" | "attemptId"> & Partial<Pick<OrchNotice, "detail">>,
  tr: (k: Key, v?: Record<string, string | number>) => string,
): string {
  // (3차 5단계) Run 이 없는 사건 — 저장소 이름만(앞 머리 "Run · " 없이). 앱 밖 변경은 따로 문구.

  const task = n.taskTitle?.trim() || n.attemptId || "";
  // 사람이 이미 멈춘(보류 · 조율 한도 포함) 앨범에서 프로듀서가 끝났다 — "멈췄습니다" 가 아니라 "이미 멈춰 있었다"(서버 `detail: already-paused` · 실기 10-29).
  if (n.kind === "coordinator-exited" && n.detail === "already-paused") {
    return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr("orch.notice.coordinator-exited.paused")}`;
  }
  if (n.kind === "wake-limit") {
    return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr(keyOf(WAKE_LIMIT_KEY, n.detail ?? "") ?? "orch.notice.wake-limit")}`;
  }
  // `detail` 은 짧은 낱말(거절 사유 · 한도 이름)뿐 — 문구가 `{reason}` 을 쓰는 종류(`commit-rejected`)만 그 자리에 싣는다.
  const vars: Record<string, string> = n.detail ? { task, reason: n.detail } : { task };
  return `${tr("orch.notice.prefix", { run: n.runName })} — ${tr(noticeKey(n.kind), vars)}`;
}

/** 이 사건이 사람 개입이 급한 종류인가(토스트를 오래) — 검증 확인 · 맡기기 밖이 필요한 작업자 · 무인 검증 보류 · 저장소 신원 바뀜 */
export function noticeUrgent(kind: string): boolean {
  return (
    kind === "verify-approval" ||
    kind === "worker-blocked" ||
    kind === "verify-needs-human" ||
    kind === "auto-merge-stopped" ||
    kind === "repo-identity-changed"
  );
}
