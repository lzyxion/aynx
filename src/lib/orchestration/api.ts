/**
 * **오케스트레이션 Tauri 명령의 얇은 껍데기**(2026-10-15 · 2b) — 몸은 GUI Rust `server::orchestration_proxy` → 세션 서버 op.
 * 실패는 `[이유] 사람 문구` 글자로 throw 된다(`model.ts` 의 `orchReasonText` 가 사람 문구로).
 *
 * **조정자 토큰을 읽는 명령은 없다** — 프로듀서 채팅 · 작업자의 토큰은 세션 서버가 쥔다(Rust 시험
 * `orchestration::tests` 의 "조정자 토큰이 프런트에 닿지 않는다" 가 이 폴더를 포함한 프런트 소스를 훑는다).
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

/** 이벤트 이름 — 서버가 낸 것을 GUI 가 같은 이름으로 창에 중계한다 */
export const RUN_CHANGED_EVENT = "orchestration-changed";

/** 이벤트 이름(F4) — 도는 턴의 진행 칸이 바뀌었다(`{runId, attemptId, turn}` — seq 를 올리지 않는다 · 보던 Run 의 보드만 다시 읽는다) */
export const RUN_PROGRESS_EVENT = "orchestration-progress";

/**
 * 이벤트 이름(F8) — 세션 서버가 이 GUI 연결로 가는 이벤트를 밀려 버렸다(`{dropped}` — 서버 `serve::EVENTS_LAGGED`). 어느 이벤트가 빠졌는지는
 * 모른다 — 보이는 보드 · 앨범 목록 요약이 한 번 다시 읽는다.
 */
export const EVENTS_LAGGED_EVENT = "events-lagged";

/** 이벤트 이름(3차 5단계 · Q3) — AI 가 연 · 이어받은 앨범의 탭을 배치할 때(`{runId, chat}` — 프로듀서 채팅 id) */

/**
 * **보드 자동 배치 장부**(3차 5단계 · Q3 → 2단계 단계 6) — 그 Run 의 프로듀서 채팅 잎을 든 탭을 가진 창이 묻는다. 그 세대에 처음 가져간 창만
 * `true`(이벤트 재전송 · 여러 창 · F5 에도 한 번 · 사람이 닫은 탭은 다시 열지 않는다). 장부는 세션 서버에 있고 **시도**를 적는다 — 배치 성공이
 * 아니다(F5). 열쇠는 채팅 id 하나(1단계의 스트림 열쇠는 서버가 거절한다).
 */

/** 작업자 하나 [중단](사람) — 트리 종료 확인 뒤 stopped */
export function stopWorker(runId: string, attemptId: string): Promise<{ attemptId: string; state: string | null }> {
  return invoke("orchestration_stop_worker", { runId, attemptId });
}

/** Run 이 만든 worktree 하나를 지운다(보수적 — 서버가 판정) */
export function removeRunWorktree(
  runId: string,
  path: string,
  deleteBranch: boolean,
): Promise<{ path: string; removed: boolean; branch: string | null; branchDeleted: boolean; unlinkedLinks: number }> {
  return invoke("orchestration_wt_remove", { runId, path, deleteBranch });
}

/** 사람의 [수락] · [반려] · 뒤집기(4단계) — 버전 비교(`conflict`)는 서버가 */
export function reviewTask(
  runId: string,
  taskId: string,
  version: number,
  decision: "accept" | "reject",
): Promise<{ task: TaskView; accepted: AcceptedView | null; flipped: boolean; latestSeq: number }> {
  return invoke("orchestration_review_task", { runId, taskId, version, decision });
}

/**
 * 보드 최근 활동(6단계) — 보드가 보일 때만(attemptId → 칸). 본문은 화면에만. `detail`(오케스트레이션 탭 ③) = 작업자 상세가 연 Attempt —
 * 그 칸에만 작업 중 파일 목록(`wip` — 파일별 +/−)이 더 온다(경로는 서버가 Attempt 기록에서 꺼낸다 — 여기서 주지 않는다).
 */
export function workerActivity(runId: string, detail?: string | null): Promise<Record<string, WorkerActivity>> {
  return invoke<Record<string, WorkerActivity>>("orchestration_worker_activity", { runId, detail: detail ?? null }).then((v) =>
    v && typeof v === "object" ? v : {},
  );
}

/**
 * [기록 보기](6단계) — 그 Attempt 의 **고정 대화 파일**의 한 쪽(기존 대화 기록 화면이 부른다 — 끝에서 거꾸로 · 커서 `before`).
 * 다른 대화는 이 길로 읽을 수 없다(서버가 고정 · 검증한 파일만). 본문은 이 화면에만.
 */
export function workerTranscript(
  runId: string,
  attemptId: string,
  before: number | null,
  limit?: number,
): Promise<TranscriptPage> {
  return invoke<TranscriptPage>("orchestration_worker_transcript", { runId, attemptId, before, limit: limit ?? null });
}

/** 보고의 바뀐 파일 목록(통합 설계 3-1 — 조정자 `get_diff` 와 같은 고정 OID 의 목록) */
export function reportFiles(runId: string, taskId: string, reportId: string | null): Promise<ReportFilesView> {
  return invoke<ReportFilesView>("orchestration_report_files", { runId, taskId, reportId });
}

/**
 * [Run 완료](통합 설계 3-4 — 사람 · 3차 5단계부터 조정자 `complete_run` 도) — 완료 조건을 못 채우면 `[not-completable] …`. 답의 `serverTemp` 는
 * 서버 임시 자리만 센다(작업자 worktree · 브랜치는 남는다 — [정리]).
 */
export function completeRun(runId: string): Promise<unknown> {
  return invoke("orchestration_complete_run", { runId });
}

/** 보류 풀기(통합 설계 2-1) — 의도 저장 실패 · 정리 대기만. Run 은 멈춘 채로 남는다 */
export function releaseHold(runId: string): Promise<unknown> {
  return invoke("orchestration_release_hold", { runId });
}

/** 통합 [취소](통합 설계 4-4) — 올리기 전의 통합 작업만(커밋 중이면 `[integration-committing]`) */
export function cancelIntegration(runId: string, taskId: string): Promise<unknown> {
  return invoke("orchestration_cancel_integration", { runId, taskId });
}

/** [조정] 재료(통합 설계 4-5) — 기대 머리 · 지금 머리 · 통합된 Task 마다 지금 머리에 들어 있나 */
export function reconcilePreview(runId: string): Promise<ReconcilePreview> {
  return invoke<ReconcilePreview>("orchestration_reconcile_preview", { runId });
}

/** [조정](통합 설계 4-5 — 사람만) — `revert`(되돌리기) · `accept`(받아들이기 — 확인 필수 · 본 머리에 묶음) */
export function reconcile(
  runId: string,
  mode: "revert" | "accept",
  confirmed: boolean,
  seenHead: string | null,
  rejectTasks: string[],
): Promise<unknown> {
  return invoke("orchestration_reconcile", { runId, mode, confirmed, seenHead, rejectTasks });
}

/** [브랜치로 내보내기](통합 설계 N1 — 사람만) */
export function exportBranch(runId: string): Promise<{ branch: string; head: string }> {
  return invoke("orchestration_export", { runId });
}

/** [병합] 확인 창의 재료 — 저장소를 바꾸지 않는다 */
export function mergePreview(runId: string): Promise<MergePreview> {
  return invoke("orchestration_merge_preview", { runId });
}

/** [병합](사람만 — 원격은 재확인) — 창에서 본 값과 다르면 서버가 하지 않는다 */
export function mergeAlbum(runId: string, expectHead: string, expectTarget: string): Promise<MergeResult> {
  return invoke("orchestration_merge", { runId, expectHead, expectTarget });
}

/** "보고 뒤 변경"(4단계) — 보드가 열려 있을 때만 가볍게 */
export function reportDrift(runId: string): Promise<DriftView[]> {
  return invoke<DriftView[]>("orchestration_report_drift", { runId }).then((v) => (Array.isArray(v) ? v : []));
}

/*
 * (3차 6단계) Run 을 여는 명령은 없다 — Run 은 AI 타일의 `start_run`(MCP)으로만 열린다. 사람의 시작 · 시작 미리 보기 · [이어 가기] 명령은
 * 걷었다(복구 길은 다른 AI 타일의 `adopt_run`).
 */

/** [검증 실행](통합 설계 5-1 — 사람만) — 확인 대화가 보인 후보 · 명령 해시 · 통합 머리에 묶인다(바뀌었으면 `[approval-stale]`) */
export function approveVerify(
  runId: string,
  args: { jobId: string; candidate: string; commandSha: string; old: string },
): Promise<unknown> {
  return invoke("orchestration_approve_verify", { runId, ...args });
}

/** [검증 실패인데 수락](통합 설계 5-4 — 사람만) — 실패한 그 Job · 검증 · 후보에 묶인다 */
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

/** 끝난 앨범 [보관] — 라이브러리에서 뺀다(기록 · ref 는 남는다). 남은 작업자 worktree · 서버 임시 자리가 있으면 서버가 거절한다 */
export function archiveRun(runId: string): Promise<{ runId: string; archivedAt: number }> {
  return invoke("orchestration_archive", { runId });
}

/** 보관함 목록 */
export function archivedAlbums(): Promise<ArchivedAlbum[]> {
  return invoke<ArchivedAlbum[]>("orchestration_archive_list");
}

/** 보관한 앨범 [복원] — 끝난 기록으로만 돌아온다(다시 돌지 않는다) */
export function restoreArchived(runId: string): Promise<{ runId: string; state: string }> {
  return invoke("orchestration_restore", { runId });
}

/** 보관한 앨범 [영구 삭제] — 앨범 기록과 이 앨범의 ref(내보낸 브랜치 · 병합된 커밋은 남는다). 원격 창은 재확인 */
export function deleteArchived(runId: string): Promise<{ runId: string; refsRemoved: number }> {
  return invoke("orchestration_delete_archived", { runId });
}

/** [정리] 재료(통합 설계 6-2 · 6-3) — 끝난 Run · orphaned 만 */
export function cleanupPreview(runId: string): Promise<CleanupPreview> {
  return invoke<CleanupPreview>("orchestration_cleanup_preview", { runId });
}

/** [정리](사람) — 고른 작업자 worktree · ref 만. 브랜치는 `deleteBranches` 가 아니면 남긴다 */
export function cleanupRun(runId: string, worktrees: string[], refs: string[], deleteBranches: boolean): Promise<CleanupResult> {
  return invoke<CleanupResult>("orchestration_cleanup", { runId, worktrees, refs, deleteBranches });
}

/** 남긴 서버 임시 자리 [그래도 지우기](통합 설계 6-2 — 사람) */
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
