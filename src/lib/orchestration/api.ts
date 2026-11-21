/**
 * 오케스트레이션 Tauri 명령의 얇은 껍데기 — 실패는 `[이유] 사람 문구` 글자로 throw 된다.
 * 토큰을 읽는 명령은 없다 — 프로듀서 채팅 · 작업자의 토큰은 세션 서버가 쥔다(Rust `orchestration::tests` 가 명령 목록을 훑는다).
 */

import { invoke } from "../ipc";
import type { ArtistInput, ArtistProfile } from "./artist-form";
import type { MergePreview, MergeResult } from "./model/merge";

import type {
  ArchivedAlbum,
  AcceptedView,
  CleanupPreview,
  CleanupResult,
  DriftView,
  ReconcilePreview,
  ReportFilesView,
  RunDetail,
  RunSummary,
  TaskView,
  WorkerActivity,
} from "$lib/orchestration/model";
import type { TranscriptPage } from "$lib/context";

export const ARTISTS_CHANGED_EVENT = "orchestration-artists-changed";
export function artistList(): Promise<ArtistProfile[]> {
  return invoke("orchestration_artist_list");
}
export function artistSet(input: ArtistInput): Promise<ArtistProfile> {
  return invoke("orchestration_artist_set", { input });
}
export function artistRemove(id: string): Promise<boolean> {
  return invoke("orchestration_artist_remove", { id });
}

export const RUN_CHANGED_EVENT = "orchestration-changed";

/** `{runId, attemptId, turn}` — seq 를 올리지 않는다 */
export const RUN_PROGRESS_EVENT = "orchestration-progress";

/** 서버 `serve::EVENTS_LAGGED` — 어느 이벤트가 빠졌는지 모르므로 보이는 화면이 한 번 다시 읽는다 */
export const EVENTS_LAGGED_EVENT = "events-lagged";

export function stopWorker(runId: string, attemptId: string): Promise<{ attemptId: string; state: string | null }> {
  return invoke("orchestration_stop_worker", { runId, attemptId });
}

export function removeRunWorktree(
  runId: string,
  path: string,
  deleteBranch: boolean,
): Promise<{ path: string; removed: boolean; branch: string | null; branchDeleted: boolean; unlinkedLinks: number }> {
  return invoke("orchestration_wt_remove", { runId, path, deleteBranch });
}

export function reviewTask(
  runId: string,
  taskId: string,
  version: number,
  decision: "accept" | "reject",
): Promise<{ task: TaskView; accepted: AcceptedView | null; flipped: boolean; latestSeq: number }> {
  return invoke("orchestration_review_task", { runId, taskId, version, decision });
}

/** 본문은 화면에만. `detail` 칸에만 `wip` 이 더 온다 — 경로는 서버가 Attempt 기록에서 꺼낸다(여기서 주지 않는다) */
export function workerActivity(runId: string, detail?: string | null): Promise<Record<string, WorkerActivity>> {
  return invoke<Record<string, WorkerActivity>>("orchestration_worker_activity", { runId, detail: detail ?? null }).then((v) =>
    v && typeof v === "object" ? v : {},
  );
}

/** 그 Attempt 의 고정 대화 파일만 — 다른 대화는 이 길로 읽을 수 없다. 본문은 이 화면에만. */
export function workerTranscript(
  runId: string,
  attemptId: string,
  before: number | null,
  limit?: number,
): Promise<TranscriptPage> {
  return invoke<TranscriptPage>("orchestration_worker_transcript", { runId, attemptId, before, limit: limit ?? null });
}

/** 조정자 `get_diff` 와 같은 고정 OID 의 목록 */
export function reportFiles(runId: string, taskId: string, reportId: string | null): Promise<ReportFilesView> {
  return invoke<ReportFilesView>("orchestration_report_files", { runId, taskId, reportId });
}

/** 답의 `serverTemp` 는 서버 임시 자리만 센다 — 작업자 worktree · 브랜치는 남는다([정리]) */
export function completeRun(runId: string): Promise<unknown> {
  return invoke("orchestration_complete_run", { runId });
}

/** 의도 저장 실패 · 정리 대기만. Run 은 멈춘 채로 남는다 */
export function releaseHold(runId: string): Promise<unknown> {
  return invoke("orchestration_release_hold", { runId });
}

/** 올리기 전의 통합 작업만 */
export function cancelIntegration(runId: string, taskId: string): Promise<unknown> {
  return invoke("orchestration_cancel_integration", { runId, taskId });
}

export function reconcilePreview(runId: string): Promise<ReconcilePreview> {
  return invoke<ReconcilePreview>("orchestration_reconcile_preview", { runId });
}

/** 사람만. `accept` 는 확인 필수 · 본 머리에 묶인다 */
export function reconcile(
  runId: string,
  mode: "revert" | "accept",
  confirmed: boolean,
  seenHead: string | null,
  rejectTasks: string[],
): Promise<unknown> {
  return invoke("orchestration_reconcile", { runId, mode, confirmed, seenHead, rejectTasks });
}

/** 사람만 */
export function exportBranch(runId: string): Promise<{ branch: string; head: string }> {
  return invoke("orchestration_export", { runId });
}

export function mergePreview(runId: string): Promise<MergePreview> {
  return invoke("orchestration_merge_preview", { runId });
}

/** 사람만(원격은 재확인) — 창에서 본 값과 다르면 서버가 하지 않는다 */
export function mergeAlbum(runId: string, expectHead: string, expectTarget: string): Promise<MergeResult> {
  return invoke("orchestration_merge", { runId, expectHead, expectTarget });
}

export function reportDrift(runId: string): Promise<DriftView[]> {
  return invoke<DriftView[]>("orchestration_report_drift", { runId }).then((v) => (Array.isArray(v) ? v : []));
}

/* Run 을 여는 명령은 여기 두지 않는다 — Run 은 사람의 [새 앨범](`producer_album_start`)으로만 열린다. */

/** 사람만 — 확인 대화가 보인 후보 · 명령 해시 · 통합 머리에 묶인다(바뀌었으면 `[approval-stale]`) */
export function approveVerify(
  runId: string,
  args: { jobId: string; candidate: string; commandSha: string; old: string },
): Promise<unknown> {
  return invoke("orchestration_approve_verify", { runId, ...args });
}

/** 사람만 — 실패한 그 Job · 검증 · 후보에 묶인다 */
export function overrideVerify(runId: string, jobId: string, verifyId: string, candidate: string): Promise<unknown> {
  return invoke("orchestration_override_verify", { runId, jobId, verifyId, candidate });
}

export function pauseRun(runId: string): Promise<void> {
  return invoke("orchestration_pause", { runId });
}

export function resumeRun(runId: string): Promise<void> {
  return invoke("orchestration_resume", { runId });
}

export function stopRun(runId: string): Promise<void> {
  return invoke("orchestration_stop", { runId });
}

/** 기록 · ref 는 남는다. 남은 작업자 worktree · 서버 임시 자리가 있으면 서버가 거절한다 */
export function archiveRun(runId: string): Promise<{ runId: string; archivedAt: number }> {
  return invoke("orchestration_archive", { runId });
}

export function archivedAlbums(): Promise<ArchivedAlbum[]> {
  return invoke<ArchivedAlbum[]>("orchestration_archive_list");
}

/** 끝난 기록으로만 돌아온다(다시 돌지 않는다) */
export function restoreArchived(runId: string): Promise<{ runId: string; state: string }> {
  return invoke("orchestration_restore", { runId });
}

/** 내보낸 브랜치 · 병합된 커밋은 남는다. 원격 창은 재확인 */
export function deleteArchived(runId: string): Promise<{ runId: string; refsRemoved: number }> {
  return invoke("orchestration_delete_archived", { runId });
}

/** 끝난 Run · orphaned 만 */
export function cleanupPreview(runId: string): Promise<CleanupPreview> {
  return invoke<CleanupPreview>("orchestration_cleanup_preview", { runId });
}

/** 사람만 — 고른 worktree · ref 만. 브랜치는 `deleteBranches` 가 아니면 남긴다 */
export function cleanupRun(runId: string, worktrees: string[], refs: string[], deleteBranches: boolean): Promise<CleanupResult> {
  return invoke<CleanupResult>("orchestration_cleanup", { runId, worktrees, refs, deleteBranches });
}

/** 사람만 */
export function discardTemp(runId: string, path: string): Promise<{ path: string; removed: boolean }> {
  return invoke("orchestration_discard_temp", { runId, path });
}

export function runSnapshot(): Promise<RunSummary[]> {
  return invoke<RunSummary[]>("orchestration_snapshot").then((v) => (Array.isArray(v) ? v : []));
}

export function runDetail(runId: string): Promise<RunDetail> {
  return invoke<RunDetail>("orchestration_run", { runId });
}

export function setTaskState(
  runId: string,
  taskId: string,
  version: number,
  state: "cancelled" | "todo",
): Promise<{ task: TaskView; latestSeq: number }> {
  return invoke("orchestration_set_task_state", { runId, taskId, version, state });
}
