/**
 * Run · Task — 상태 표 · 상태 문장 · 사람 동작 · 목록 줄(AI 가 연 Run · blocked 수) · 맡기기 띠.
 */

import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { RunDetail, RunPersistView, RunState, RunSummary, TaskState, TaskView } from "./types";

/** 목록 한 줄의 blocked 수(모르는 값 · 음수는 0) */
export function blockedCount(r: Pick<RunSummary, "blocked">): number {
  const v = r.blocked;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// ---------------------------------------------------------------------------
// 보드
// ---------------------------------------------------------------------------

/**
 * 사람에게 보일 상태 — 서버 재시작 뒤의 끝난 앨범은 `orphaned`(읽기 전용)로 읽히지만, 사람에게는 재시작 전의 끝난 상태(완료 · 중단됨)다(2026-11-07 사용자).
 * 낱말 · 그림 · 사람 필요에만 쓴다. 할 수 있는 동작의 판정은 서버 상태 그대로다.
 */
export function shownRunState(state: RunState, previous: RunState | null | undefined): RunState {
  return state === "orphaned" && (previous === "done" || previous === "stopped") ? previous : state;
}

export const RUN_STATE_KEY: Record<RunState, Key> = {
  running: "orch.state.running",
  paused: "orch.state.paused",
  stopping: "orch.state.stopping",
  stopped: "orch.state.stopped",
  done: "orch.state.done",
  orphaned: "orch.state.orphaned",
};

export const TASK_STATE_KEY: Record<TaskState, Key> = {
  todo: "orch.task.state.todo",
  active: "orch.task.state.active",
  reported: "orch.task.state.reported",
  accepted: "orch.task.state.accepted",
  rejected: "orch.task.state.rejected",
  cancelled: "orch.task.state.cancelled",
  integrating: "orch.task.state.integrating",
  conflict: "orch.task.state.conflict",
};

/**
 * 보드 머리의 상태 문장(설계 D) — paused = "조율 멈춤 — 작업자는 계속 돎"(까닭이 조정자 종료 · 시간 한도면 덧붙인다),
 * stopping = "중단 요청 중", orphaned = 읽기 전용 안내(돌던 중 멈춘 앨범만 — 끝난 앨범은 할 일이 없어 띠를 세우지 않는다). 그 밖(running · stopped · done)은 칩으로 충분해 `null`.
 */
export function runStatePhrase(run: Pick<RunDetail, "state" | "pauseReason"> & Partial<Pick<RunDetail, "origin" | "previousState">>, tr: Tr): string | null {
  switch (shownRunState(run.state, run.previousState)) {
    case "paused":
      // 프로듀서 채팅이 연 앨범(2단계) — "같은 채팅에 말하거나 이어받기" · 사람이 연 앨범은 이어받기 문구만
      if (run.pauseReason === "coordinator-exited")
        return tr(run.origin?.producer ? "orch.phrase.paused.coordinatorChat" : "orch.phrase.paused.coordinator");
      if (run.pauseReason === "coordination-limit") return tr("orch.phrase.paused.limit");
      if (run.pauseReason === "hold") return tr("orch.phrase.paused.hold");
      return tr("orch.phrase.paused");
    case "stopping":
      return tr("orch.phrase.stopping");
    case "orphaned":
      return tr("orch.phrase.orphaned");
    default:
      return null;
  }
}

/**
 * **조율 멈춤 띠**(10-30 실기 — 재생 막대 바로 위 한 줄). paused 일 때만 — 짧은 문구(까닭마다 한 마디) · 긴 설명([`runStatePhrase`] — 툴팁).
 * 띠의 단추([재개] · [새 프로듀서로 이어받기])는 부르는 쪽이 사람 동작 판정(`runActions`)으로 고른다.
 */
export function pauseBand(
  run: Pick<RunDetail, "state" | "pauseReason"> & Partial<Pick<RunDetail, "origin">>,
  tr: Tr,
): { reason: string; text: string; title: string } | null {
  if (run.state !== "paused") return null;
  const reason =
    run.pauseReason === "coordinator-exited"
      ? "coordinator"
      : run.pauseReason === "coordination-limit"
        ? "limit"
        : run.pauseReason === "hold"
          ? "hold"
          : "paused";
  return { reason, text: tr(PAUSE_BAND_KEY[reason]), title: runStatePhrase(run, tr) ?? tr(PAUSE_BAND_KEY[reason]) };
}

const PAUSE_BAND_KEY: Record<string, Key> = {
  paused: "orch.pauseBand.paused",
  coordinator: "orch.pauseBand.coordinator",
  limit: "orch.pauseBand.limit",
  hold: "orch.pauseBand.hold",
};

/**
 * 사람 동작이 서는 상태 — 단추의 표시 판정(서버가 다시 판정한다). `resumeBlocked` = [재개] 를 보이되 끈다: paused 인데 조정자가 묶여 있지
 * 않다(서버 `no-coordinator` — 프로듀서 채팅이 `adopt_run` 으로 이어받아야 한다).
 */
export function runActions(
  state: RunState,
  coordinatorAttached: boolean,
): { pause: boolean; resume: boolean; resumeBlocked: boolean; stop: boolean; archive: boolean } {
  // (3차 6단계) [이어 가기]는 걷었다 — 조정자 CLI 가 끝나 멈춘 Run 은 다른 AI 타일이 `adopt_run` 으로 이어받는다(상태 문장이 안내한다).
  return {
    pause: state === "running",
    resume: state === "paused",
    resumeBlocked: state === "paused" && !coordinatorAttached,
    stop: state === "running" || state === "paused",
    archive: state === "done" || state === "stopped" || state === "orphaned",
  };
}

/** 저장 실패 분류 낱말(서버 `persist::SaveError::kind` 전부) → 문구 키 */
export const PERSIST_REASON_KEY: Record<string, Key> = {
  "disk-full": "orch.persist.reason.disk-full",
  "permission-denied": "orch.persist.reason.permission-denied",
  "read-only": "orch.persist.reason.read-only",
  "encode-failed": "orch.persist.reason.encode-failed",
  "io-error": "orch.persist.reason.io-error",
};

/**
 * 저장 실패 띠(F7) — 서버가 Run 상태를 디스크에 쓰지 못하는 중이면 머리 아래 경고 한 줄. 저장이 다시 되면(또는 옛 서버 — 칸 없음) `null`.
 * orphaned 도 보인다(재시작 복구가 남기는 판정이 저장되지 못했다).
 */
export function persistBand(persist: RunPersistView | null | undefined, tr: Tr): { reason: string; text: string } | null {
  const f = persist?.failing;
  if (!persist || persist.ok || !f) return null;
  return { reason: f.reason, text: tr("orch.persist.failing", { reason: keyText(PERSIST_REASON_KEY, f.reason, tr) }) };
}

/** Task 의 사람 동작(서버 `set_task_state` 규칙과 같다) — 취소: 수락 · 취소 아닌 것 / 다시 열기: 취소 · 반려 */
export function taskActions(task: Pick<TaskView, "state">, run: RunState): { cancel: boolean; reopen: boolean } {
  const live = run === "running" || run === "paused" || run === "stopping";
  return {
    // 통합 중인 Task 는 [통합 취소] 가 따로 있다(통합 설계 4-4 — 서버는 `task-busy`).
    cancel: live && task.state !== "accepted" && task.state !== "cancelled" && task.state !== "integrating",
    reopen: live && (task.state === "cancelled" || task.state === "rejected"),
  };
}
