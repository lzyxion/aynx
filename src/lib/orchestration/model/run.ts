import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { RunDetail, RunPersistView, RunState, RunSummary, TaskState, TaskView } from "./types";

export function blockedCount(r: Pick<RunSummary, "blocked">): number {
  const v = r.blocked;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// ── 보드 ──

/**
 * 서버 재시작 뒤의 끝난 앨범은 `orphaned` 로 읽히지만 사람에게는 재시작 전의 끝난 상태다.
 * 낱말 · 그림 · 사람 필요에만 쓴다 — 할 수 있는 동작의 판정은 서버 상태 그대로다.
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

export function runStatePhrase(run: Pick<RunDetail, "state" | "pauseReason"> & Partial<Pick<RunDetail, "origin" | "previousState">>, tr: Tr): string | null {
  switch (shownRunState(run.state, run.previousState)) {
    case "paused":
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

/** 서버가 다시 판정한다. `resumeBlocked` — 조정자가 묶여 있지 않다(서버 `no-coordinator` — 프로듀서 채팅이 `adopt_run` 으로 이어받아야 한다) */
export function runActions(
  state: RunState,
  coordinatorAttached: boolean,
): { pause: boolean; resume: boolean; resumeBlocked: boolean; stop: boolean; archive: boolean } {
  return {
    pause: state === "running",
    resume: state === "paused",
    resumeBlocked: state === "paused" && !coordinatorAttached,
    stop: state === "running" || state === "paused",
    archive: state === "done" || state === "stopped" || state === "orphaned",
  };
}

/** 서버 `persist::SaveError::kind` 전부 */
export const PERSIST_REASON_KEY: Record<string, Key> = {
  "disk-full": "orch.persist.reason.disk-full",
  "permission-denied": "orch.persist.reason.permission-denied",
  "read-only": "orch.persist.reason.read-only",
  "encode-failed": "orch.persist.reason.encode-failed",
  "io-error": "orch.persist.reason.io-error",
};

/** orphaned 도 보인다 — 재시작 복구가 남기는 판정이 저장되지 못했다 */
export function persistBand(persist: RunPersistView | null | undefined, tr: Tr): { reason: string; text: string } | null {
  const f = persist?.failing;
  if (!persist || persist.ok || !f) return null;
  return { reason: f.reason, text: tr("orch.persist.failing", { reason: keyText(PERSIST_REASON_KEY, f.reason, tr) }) };
}

/** 서버 `set_task_state` 규칙과 같다 */
export function taskActions(task: Pick<TaskView, "state">, run: RunState): { cancel: boolean; reopen: boolean } {
  const live = run === "running" || run === "paused" || run === "stopping";
  return {
    // 통합 중인 Task 는 [통합 취소] 가 따로 있다(서버는 `task-busy`).
    cancel: live && task.state !== "accepted" && task.state !== "cancelled" && task.state !== "integrating",
    reopen: live && (task.state === "cancelled" || task.state === "rejected"),
  };
}
