//! 오케스트레이션 **서버 op**(사람 쪽 — GUI 의 같은 이름 Tauri 명령 `server::orchestration_proxy` 가 보낸다).
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `orchestration_snapshot` | 읽기 | → 모든 Run 요약(orphaned 포함) |
//! | `orchestration_run` | 읽기 | `{runId}` → 상세(타임라인 포함) |
//! | `orchestration_pause` · `_resume` · `_stop` | 쓰기 | `{runId}` → — |
//! | `orchestration_set_task_state` | 쓰기 | `{runId, taskId, version, state}` → `{task, latestSeq}` |
//! | `orchestration_archive` | 쓰기 | `{runId}` → `{runId, archivedAt}`([보관] — 끝난 앨범 · 남은 작업자 worktree · 서버 임시 자리가 없을 때만) |
//! | `orchestration_archive_list` | 읽기 | → 보관함 줄들(`{runId, name, repo, state, previousState, taskCount, archivedAt, exportedBranch, unexported, exportable}`) |
//! | `orchestration_restore` | 쓰기 | `{runId}` → `{runId, state}`([복원] — 끝난 기록으로만 · 프로세스 · 토큰 · 묶음 없음) |
//! | `orchestration_delete_archived` | 쓰기 | `{runId}` → `{runId, refsRemoved}`([영구 삭제] — 이 앨범의 ref 먼저, 그다음 파일) |
//! | `orchestration_stop_worker` | 쓰기 | `{runId, attemptId}` → `{attemptId, state}`(사람의 [중단] — 3단계) |
//! | `orchestration_wt_remove` | 쓰기 | `{runId, path, deleteBranch}` → `{path, removed, branch, branchDeleted, unlinkedLinks}`(보드의 [worktree 지우기]) |
//! | `orchestration_review_task` | 쓰기 | `{runId, taskId, version, decision: accept\|reject}` → `{task, accepted, flipped, latestSeq}`(사람의 [수락] · [반려] · 뒤집기 — 4단계) |
//! | `orchestration_report_drift` | 읽기 | `{runId}` → `[{attemptId, reportId, head, dirty, changedSinceReport, error?}]`("보고 뒤 변경" — 4단계) |
//! | `orchestration_worker_activity` | 읽기 | `{runId, detail?}` → `{attemptId: {status, recent{lastText, tools[≤3]}, changedCount, conversationChanged, lagging, lastGrowthAt, wip?}}`(보드 최근 활동 — 6단계, 보드가 보일 때만 · `detail` 의 칸에만 작업 중 파일 목록 `wip{files[{path, status, adds, dels, binary, uncommitted, untracked?}], fileCount, truncated, base, error?}` — 오케스트레이션 탭 ③ 작업자 상세) |
//! | `orchestration_worker_transcript` | 읽기 | `{runId, attemptId, before?, limit?}` → 기록 보기 한 쪽(**그 Attempt 의 고정 대화 파일만** — 6단계 [기록 보기]) |
//!
//! (3a) 2차의 [돌려주기] · [복구 완료] · [유지](`_return_control` · `_recover` · `_keep_worker`)는 걷었다 — 작업자는 헤드리스라 개입 · 결과를
//! 모르는 붙여넣기 · 보고 뒤 자동 종료가 없다.
//! | `orchestration_report_files` | 읽기 | `{runId, taskId, reportId?}` → 그 보고의 바뀐 파일 목록(조정자 `get_diff` 와 같은 것 — 통합 설계 3-1) |
//! | `orchestration_complete_run` | 쓰기 | `{runId}` → `{runId, state, latestSeq}`(사람의 [Run 완료] — 통합 설계 3-4, 조건을 못 채우면 `not-completable`) |
//! | `orchestration_release_hold` | 쓰기 | `{runId}` → `{runId, state, latestSeq}`(보류 해제 — `persist-failed` · `cleanup-pending` 만) |
//! | `orchestration_cancel_integration` | 쓰기 | `{runId, taskId}` → `{task, jobId, job, latestSeq}`(통합 [취소] — 커밋 단계 전만, 통합 설계 4-4) |
//! | `orchestration_reconcile_preview` | 읽기 | `{runId}` → `{expectedHead, currentHead, integrated[{taskId, title, integrationCommit, contained}]}`([조정] 재료 — 4-5) |
//! | `orchestration_reconcile` | 쓰기 | `{runId, mode: revert\|accept, confirmed?, seenHead?, rejectTasks?}` → `{runId, mode, head, latestSeq}`([조정] — 4-5) |
//! | `orchestration_export` | 쓰기 | `{runId}` → `{runId, branch, head, latestSeq}`([브랜치로 내보내기] — N1) |
//! | `orchestration_merge_preview` | 읽기 | `{runId}` → 병합 전 검사(`album_merge.rs` — 저장소를 바꾸지 않는다 · 판 27) |
//! | `orchestration_merge` | 쓰기 | `{runId, expectHead, expectTarget}` → `{merged, commit?, reason?, preview?}`([병합] — 사람 · 판 27) |
//! | `orchestration_approve_verify` | 쓰기 | `{runId, jobId, candidate, commandSha, old}` → `{runId, jobId, phase, latestSeq}`([검증 실행] — 통합 설계 5-1, 사람 확인 · 묶음) |
//! | `orchestration_override_verify` | 쓰기 | `{runId, jobId, verifyId, candidate}` → `{runId, jobId, phase}`([검증 실패인데 수락] — 5-4) |
//! | `orchestration_cleanup_preview` | 읽기 | `{runId}` → `{worktrees[], refs[], tempPending[], exportBranch}`([정리] 재료 — 통합 설계 6-2 · 6-3, 끝난 Run · orphaned) |
//! | `orchestration_cleanup` | 쓰기 | `{runId, worktrees[], refs[], deleteBranches?}` → `{worktrees, refs, failed, temps}`([정리] — 사람) |
//! | `orchestration_discard_temp` | 쓰기 | `{runId, path}` → `{path, removed}`(남긴 서버 임시 자리 [그래도 지우기] — 6-2) |
//!
//! (3차 6단계) **사람이 Run 을 여는 op 는 없다** — Run 은 프로듀서 채팅의 `start_run`(MCP · `start.rs`)으로만 열린다. 1단계의 프로듀서 표지
//! op 는 2단계 전환에 걷었다(표지 = 프로듀서 채팅 자체 — 사람이 오케스트레이션 탭에서 연 것). 걷은 것: 시작
//! (`orchestration_start_run` · 시작 대화의 미리 보기 `_start_preview`) · [이어 가기](`_continue` — 복구 길은 `adopt_run`) · 사람이 띄운 조정자
//! 타일 묶기(`_active_gen` · `_bind_coordinator`) · worktree 만들기 · 목록(`_wt_create` · `_wt_list` — 조정자 worktree 도구 셋과 함께 걷었다,
//! 헤드리스 설계 Q6). 검증 명령은 **저장소 맡기기**(Tauri — `delegation::repo`)에서만 정하고 Run 은 시작 때 사본을 고정한다.
//!
//! worktree 지우기(`orchestration_wt_remove`)는 사람 화면(보드)이 쓰는 **세션 서버 op 한 층**이다 — 몸은 `worktree.rs` 의 보수적 지우기.
//!
//! 불변식:
//! - 승인 등급 op 는 없다. 조정자(AI)는 이 op 들에 닿을 길이 없다 — 사람의 일시정지 · 재개 · 중단 · 수락 · 정리는 MCP 에 없다.
//! - 실패 문구는 `[이유] 사람 문구`(`crate::errors::with_reason`) — 이유 낱말은 MCP 와 같다.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use super::model::{Decision, TaskState};
use super::store::{reason, OrchError, Orchestration};
use crate::i18n::tr;
use crate::server::ipc::frame::code;
use crate::server::ipc::WireError;

/// 이 파일이 받는 op 인가.
pub(crate) fn is_op(op: &str) -> bool {
    matches!(
        op,
        "orchestration_snapshot"
            | "orchestration_run"
            | "orchestration_pause"
            | "orchestration_resume"
            | "orchestration_stop"
            | "orchestration_set_task_state"
            | "orchestration_archive"
            | "orchestration_archive_list"
            | "orchestration_restore"
            | "orchestration_delete_archived"
            | "orchestration_stop_worker"
            | "orchestration_wt_remove"
            | "orchestration_review_task"
            | "orchestration_report_drift"
            | "orchestration_worker_activity"
            | "orchestration_worker_transcript"
            | "orchestration_notices"
            | "orchestration_notices_ack"
            | "orchestration_report_files"
            | "orchestration_complete_run"
            | "orchestration_release_hold"
            | "orchestration_cancel_integration"
            | "orchestration_reconcile_preview"
            | "orchestration_reconcile"
            | "orchestration_export"
            | "orchestration_merge_preview"
            | "orchestration_merge"
            | "orchestration_approve_verify"
            | "orchestration_override_verify"
            | "orchestration_cleanup_preview"
            | "orchestration_cleanup"
            | "orchestration_discard_temp"
    )
}

/// [정리](통합 설계 6-3).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanupBody {
    run_id: String,
    #[serde(default)]
    worktrees: Vec<String>,
    #[serde(default)]
    refs: Vec<String>,
    #[serde(default)]
    delete_branches: bool,
}

/// [병합] — 확인 창이 본 값 그대로(그사이 바뀌었으면 하지 않는다).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeBody {
    run_id: String,
    expect_head: String,
    expect_target: String,
}

/// [그래도 지우기](통합 설계 6-2).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscardBody {
    run_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoticeAckBody {
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunIdBody {
    run_id: String,
}

/// 최근 활동(6단계) — `detail` = 작업자 상세가 열린 Attempt(오케스트레이션 탭 ③ — 그 칸에 작업 중 파일 목록을 더 싣는다).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityBody {
    run_id: String,
    #[serde(default)]
    detail: Option<String>,
}

/// [검증 실행](통합 설계 5-1) — 확인 대화가 보인 값 그대로(묶음).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApproveVerifyBody {
    run_id: String,
    job_id: String,
    candidate: String,
    command_sha: String,
    old: String,
}

/// [검증 실패인데 수락](통합 설계 5-4).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverrideVerifyBody {
    run_id: String,
    job_id: String,
    verify_id: String,
    candidate: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttemptBody {
    run_id: String,
    attempt_id: String,
}

/// [기록 보기] 한 쪽(6단계) — 커서 `before` 는 기록 보기와 같은 것(줄의 시작 바이트).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerTranscriptBody {
    run_id: String,
    attempt_id: String,
    #[serde(default)]
    before: Option<u64>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WtRemoveBody {
    run_id: String,
    path: String,
    #[serde(default)]
    delete_branch: bool,
}


/// 감독 사건 목록 — `recent: true` = 확인된 최근 사건 · 거짓 = 미확인 목록.
#[derive(Deserialize)]
struct NoticesBody {
    recent: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetTaskStateBody {
    run_id: String,
    task_id: String,
    version: u64,
    state: TaskState,
}

/// 보고의 파일 목록(보드 — 조정자 `get_diff` 의 목록과 같다).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportFilesBody {
    run_id: String,
    task_id: String,
    #[serde(default)]
    report_id: Option<String>,
}

/// [조정](통합 설계 4-5).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReconcileBody {
    run_id: String,
    mode: String,
    #[serde(default)]
    confirmed: bool,
    #[serde(default)]
    seen_head: Option<String>,
    #[serde(default)]
    reject_tasks: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskBody {
    run_id: String,
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewBody {
    run_id: String,
    task_id: String,
    version: u64,
    decision: String,
}

fn bad_body() -> WireError {
    WireError::new(code::BAD_BODY, "bad orchestration request body")
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|_| bad_body())
}

/// 거절 사유 → 사람 문구(표시 언어). 모르는 사유는 영어 원문.
fn human_text(e: &OrchError) -> String {
    match e.code {
        reason::NOT_FOUND => tr!(ko: "앨범 또는 트랙을 찾을 수 없습니다", en: "The album or track was not found"),
        reason::RUN_ORPHANED => tr!(
            ko: "세션 서버가 다시 시작되어 읽기 전용으로 남은 앨범입니다",
            en: "This album was left read-only by a session server restart"
        ),
        reason::RUN_STOPPED => tr!(ko: "이미 중단된 앨범입니다", en: "The album has already been stopped"),
        reason::TOO_MANY_RUNS => tr!(
            ko: "동시에 돌릴 수 있는 앨범은 {n}개입니다 — 하나를 중단한 뒤 시작하세요",
            en: "At most {n} albums can be active at once — stop one first",
            n = super::model::MAX_ACTIVE_RUNS
        ),
        reason::CONFLICT => tr!(
            ko: "그사이 트랙이 바뀌었습니다 — 다시 읽고 시도하세요",
            en: "The track changed meanwhile — reload and try again"
        ),
        reason::RISK_NOT_CONFIRMED => tr!(
            ko: "'전부 자동' 권한 모드는 위험 확인이 있어야 시작합니다",
            en: "The 'full auto' permission mode needs the risk confirmation"
        ),
        reason::NOT_A_REPO => tr!(
            ko: "저장소 폴더가 아닙니다(.git 이 없습니다)",
            en: "Not a repository folder (no .git)"
        ),
        reason::LIMIT_REACHED => tr!(
            ko: "조율 시간 한도가 지났습니다 — 중단하거나 새 앨범을 여세요",
            en: "The coordination time limit has passed — stop the album or start a new one"
        ),
        reason::INVALID_STATE => tr!(
            ko: "지금 상태에서는 할 수 없습니다 ({msg})",
            en: "Not possible in the current state ({msg})",
            msg = e.message
        ),
        reason::INVALID_ARGUMENT => tr!(ko: "입력이 올바르지 않습니다 ({msg})", en: "Invalid input ({msg})", msg = e.message),
        reason::WORKTREE_DIRTY => tr!(
            ko: "worktree 에 커밋하지 않은 변경이 있습니다 — 커밋하거나 버린 뒤 지우세요",
            en: "The worktree has uncommitted changes — commit or discard them first"
        ),
        reason::WORKTREE_IN_USE => tr!(
            ko: "이 worktree 에서 아티스트가 아직 돌고 있습니다 — 먼저 [중단] 하세요",
            en: "An artist is still running in this worktree — stop it first"
        ),
        reason::NOT_RUN_WORKTREE => tr!(
            ko: "이 앨범이 만든 worktree 만 여기서 지울 수 있습니다",
            en: "Only a worktree this album created can be removed here"
        ),
        reason::BRANCH_HAS_UNMERGED => tr!(
            ko: "브랜치에 병합되지 않은 커밋이 있어 아무것도 지우지 않았습니다 — 브랜치를 남기고 지우거나 먼저 병합하세요",
            en: "The branch has unmerged commits, so nothing was removed — keep the branch or merge it first"
        ),
        reason::WORKTREE_FAILED => tr!(ko: "worktree 작업이 실패했습니다 ({msg})", en: "The worktree operation failed ({msg})", msg = e.message),
        reason::NOT_REPORTED => tr!(
            ko: "보고된 트랙만 수락 · 반려할 수 있습니다",
            en: "Only a reported track can be accepted or rejected"
        ),
        reason::DIRTY_REPORT => tr!(
            ko: "아티스트가 커밋하지 않은 변경을 남긴 채 보고했습니다 — 수락할 수 없습니다(반려한 뒤 커밋하는 새 Attempt 로)",
            en: "The artist reported with uncommitted changes — it cannot be accepted (reject it and start a new attempt that commits)"
        ),
        reason::NOT_SUCCESS => tr!(
            ko: "실패 · 막힘 보고는 수락할 수 없습니다 — 반려만 됩니다",
            en: "A failure or blocked report cannot be accepted — reject it instead"
        ),
        reason::NO_COMMIT => tr!(
            ko: "보고에 커밋이 없어 수락할 수 없습니다",
            en: "The report has no commit, so it cannot be accepted"
        ),
        reason::GIT_FAILED => tr!(ko: "git 을 읽지 못했습니다 ({msg})", en: "Could not read git ({msg})", msg = e.message),
        reason::OUTPUT_TOO_LARGE => tr!(
            ko: "git 출력이 너무 커서 읽지 않았습니다",
            en: "The git output was too large to read"
        ),
        reason::RUN_ON_HOLD => tr!(
            ko: "앨범이 보류 중입니다 — 앨범 판의 보류 막대에서 먼저 풀어야 합니다",
            en: "The album is on hold — resolve it from the hold bar on the album page first"
        ),
        reason::INTEGRATION_BUSY => tr!(
            ko: "이 앨범의 다른 통합이 진행 중입니다 — 끝난 뒤 다시 하세요",
            en: "Another integration of this album is in progress — try again after it ends"
        ),
        reason::INTEGRATION_COMMITTING => tr!(
            ko: "통합을 올리는 중이라 취소할 수 없습니다 — 몇 초 뒤 다시 보세요",
            en: "The integration is being committed and cannot be cancelled — check again in a few seconds"
        ),
        reason::ALREADY_INTEGRATED => tr!(
            ko: "이미 통합 ref 에 올라간 수락입니다 — 되돌리려면 git 으로 직접 되돌리세요",
            en: "This acceptance is already in the integration ref — revert it with git yourself"
        ),
        reason::INTEGRATION_FAILED => tr!(ko: "통합에 실패했습니다 ({msg})", en: "The integration failed ({msg})", msg = e.message),
        reason::NOT_COMPLETABLE => tr!(
            ko: "아직 앨범을 완료할 수 없습니다 ({msg})",
            en: "The album cannot be completed yet ({msg})",
            msg = e.message
        ),
        reason::GIT_TOO_OLD => tr!(
            ko: "이 PC 의 git 이 너무 오래됐습니다 — 결과 통합에 git 2.42 이상이 필요합니다 ({msg})",
            en: "git on this PC is too old — integrating results needs git 2.42 or newer ({msg})",
            msg = e.message
        ),
        reason::GIT_UNSUPPORTED => tr!(
            ko: "이 저장소의 git 설정은 자동 통합 지원 밖입니다(병합 드라이버 · LFS 같은 필터 · renormalize · submodule) — 사람이 직접 합치세요",
            en: "This repository's git settings are outside automatic integration (merge drivers, filters such as LFS, renormalize, submodules) — merge it by hand"
        ),
        reason::EXPORT_CHECKED_OUT => tr!(
            ko: "내보낼 브랜치가 어느 worktree 에 체크아웃돼 있습니다 — 다른 브랜치로 옮긴 뒤 다시 하세요",
            en: "The export branch is checked out in a worktree — switch away from it and try again"
        ),
        reason::EXPORT_BRANCH_MOVED => tr!(
            ko: "내보낸 브랜치가 앱 밖에서 바뀌었습니다 — 덮어쓰지 않았습니다 ({msg})",
            en: "The exported branch was changed outside the app — it was not overwritten ({msg})",
            msg = e.message
        ),
        reason::VERIFY_FAILED => tr!(
            ko: "수락 전 검증이 통과하지 않았습니다 ({msg})",
            en: "The pre-acceptance verification did not pass ({msg})",
            msg = e.message
        ),
        reason::VERIFY_LIMIT => tr!(
            ko: "이 앨범의 검증 횟수 한도를 다 썼습니다",
            en: "This album has used up its verification limit"
        ),
        reason::VERIFY_UNSUPPORTED => tr!(
            ko: "이 OS 에서는 아직 수락 전 검증을 돌릴 수 없습니다",
            en: "Pre-acceptance verification is not supported on this OS yet"
        ),
        reason::APPROVAL_STALE => tr!(
            ko: "확인한 뒤 후보 · 명령 · 통합 머리가 바뀌었습니다 — 다시 보고 확인하세요",
            en: "The candidate, command or integration head changed since you looked — review it again"
        ),
        reason::APPROVAL_EXPIRED => tr!(
            ko: "검증 확인 대기 시간(30분)이 지났습니다 — 프로듀서가 다시 수락을 요청해야 합니다",
            en: "The verification approval window (30 minutes) has passed — the producer must request acceptance again"
        ),
        reason::CLEANUP_PENDING => tr!(
            ko: "서버 임시 폴더에 예상 밖 변경이 있거나 아직 쓰는 프로세스가 있어 지우지 않고 남겼습니다 — 앨범 판에서 보고 [그래도 지우기] 하세요 ({msg})",
            en: "A server temp folder has unexpected changes or a process may still use it, so it was kept — look at it on the album page and use [Remove anyway] ({msg})",
            msg = e.message
        ),
        reason::WORKTREES_LEFT => tr!(
            ko: "아티스트 worktree {n}개가 남아 있어 보관하지 않았습니다 — 먼저 정리하세요",
            en: "Artist worktrees left: {n}. The album was not archived — clean them up first",
            n = e.message
        ),
        reason::ARCHIVE_UNREADABLE => tr!(
            ko: "보관한 앨범 파일을 읽을 수 없어 아무것도 바꾸지 않았습니다 ({msg})",
            en: "The archived album file could not be read, so nothing was changed ({msg})",
            msg = e.message
        ),
        reason::NOT_CLEANABLE => tr!(
            ko: "[정리] 대상이 아닙니다 ({msg})",
            en: "Not something cleanup can remove ({msg})",
            msg = e.message
        ),
        reason::TRANSCRIPT_UNAVAILABLE => tr!(
            ko: "아티스트의 고정 대화를 아직 읽을 수 없습니다 ({msg})",
            en: "The artist's pinned conversation cannot be read yet ({msg})",
            msg = e.message
        ),
        _ => e.message.clone(),
    }
}

fn fail(e: OrchError) -> WireError {
    WireError::new(code::SESSION, crate::errors::with_reason(e.code, human_text(&e)))
}

/// op `orchestration_wt_remove` — 보수적 지우기(`worktree.rs` 머리말). 작업자가 아직 쓰면 `worktree-in-use`. **블로킹**(git).
/// 곁 기록은 서버에 꽂힌 자리(`Orchestration::sidecar` — 서버 시작이 `worktrees.json` 을 꽂는다 · 시험은 임시 자리).
pub(crate) fn wt_remove(orch: &Orchestration, run_id: &str, path: &str, delete_branch: bool) -> Result<Value, OrchError> {
    let (repo, _) = orch.run_paths(run_id)?;
    // 같은 실제 경로 열쇠로 "쓰는 중" 과 예약을 보고 지우는 동안 자리를 쥔다(리뷰 F4 — 이어 쓰기 · 다른 지우기와 서로 막는다).
    let key = orch.begin_worktree_removal(run_id, path)?;
    let sidecar = orch.sidecar();
    let r = super::worktree::remove_blocking(Path::new(&repo), path, delete_branch, run_id, sidecar.as_deref());
    if r.is_ok() {
        orch.note_worktree_removed(run_id, path);
    }
    orch.end_worktree_claim(run_id, &key);
    Ok(r?.to_json(path))
}

/// op 하나 — 블로킹 풀에서(영속 파일 쓰기). 몸 · 응답은 로그에 남기지 않는다(토큰 값은 이 op 들에 없다 — 3차 4단계부터 조정자 토큰 op 가 없다).
pub(crate) fn handle(op: &str, b: Value, orch: &Orchestration) -> Result<Value, WireError> {
    match op {
        "orchestration_snapshot" => Ok(orch.snapshot()),
        "orchestration_run" => {
            let a: RunIdBody = body(b)?;
            // 맡기기 상태 · 역할 · 수락 규칙은 지금 맡기기에서(3a — 보드 띠 · 역할 이력).
            orch.run_detail_fresh(&a.run_id).map_err(fail)
        }
        // 앨범 탭 배치(3차 5단계 — Q3): 처음 가져간 창만 `claim: true`(서버 장부 — 이벤트 재전송 · 여러 창 · F5 에도 한 번). 열쇠는 프로듀서
        // 채팅 id 하나(빈 글자는 거절).
        "orchestration_pause" => {
            let a: RunIdBody = body(b)?;
            orch.pause(&a.run_id).map(|()| Value::Null).map_err(fail)
        }
        "orchestration_resume" => {
            let a: RunIdBody = body(b)?;
            orch.resume(&a.run_id).map(|()| Value::Null).map_err(fail)
        }
        "orchestration_stop" => {
            let a: RunIdBody = body(b)?;
            orch.stop(&a.run_id).map(|()| Value::Null).map_err(fail)
        }
        "orchestration_set_task_state" => {
            let a: SetTaskStateBody = body(b)?;
            orch.set_task_state(&a.run_id, &a.task_id, a.version, a.state).map_err(fail)
        }
        "orchestration_archive" => {
            let a: RunIdBody = body(b)?;
            orch.archive_run(&a.run_id).map_err(fail)
        }
        "orchestration_archive_list" => Ok(orch.archived_list()),
        "orchestration_restore" => {
            let a: RunIdBody = body(b)?;
            orch.restore_archived(&a.run_id).map_err(fail)
        }
        "orchestration_delete_archived" => {
            let a: RunIdBody = body(b)?;
            orch.delete_archived(&a.run_id).map_err(fail)
        }
        "orchestration_stop_worker" => {
            let a: AttemptBody = body(b)?;
            orch.human_stop_worker(&a.run_id, &a.attempt_id).map_err(fail)
        }
        "orchestration_wt_remove" => {
            let a: WtRemoveBody = body(b)?;
            wt_remove(orch, &a.run_id, &a.path, a.delete_branch).map_err(fail)
        }
        "orchestration_review_task" => {
            let a: ReviewBody = body(b)?;
            let decision = match a.decision.as_str() {
                "accept" => Decision::Accepted,
                "reject" => Decision::Rejected,
                _ => return Err(bad_body()),
            };
            orch.human_review(&a.run_id, &a.task_id, a.version, decision).map_err(fail)
        }
        "orchestration_report_drift" => {
            let a: RunIdBody = body(b)?;
            orch.report_drift(&a.run_id).map_err(fail)
        }
        "orchestration_worker_activity" => {
            let a: ActivityBody = body(b)?;
            orch.worker_activity(&a.run_id, a.detail.as_deref()).map_err(fail)
        }
        "orchestration_worker_transcript" => {
            let a: WorkerTranscriptBody = body(b)?;
            orch.worker_transcript_page(&a.run_id, &a.attempt_id, a.before, a.limit).map_err(fail)
        }
        "orchestration_report_files" => {
            let a: ReportFilesBody = body(b)?;
            orch.report_files(&a.run_id, &a.task_id, a.report_id.as_deref()).map_err(fail)
        }
        "orchestration_complete_run" => {
            let a: RunIdBody = body(b)?;
            orch.complete_run(&a.run_id).map_err(fail)
        }
        "orchestration_release_hold" => {
            let a: RunIdBody = body(b)?;
            orch.release_hold(&a.run_id).map_err(fail)
        }
        "orchestration_cancel_integration" => {
            let a: TaskBody = body(b)?;
            orch.cancel_integration(&a.run_id, &a.task_id).map_err(fail)
        }
        "orchestration_reconcile_preview" => {
            let a: RunIdBody = body(b)?;
            orch.reconcile_preview(&a.run_id).map_err(fail)
        }
        "orchestration_reconcile" => {
            let a: ReconcileBody = body(b)?;
            orch.reconcile(&a.run_id, &a.mode, a.confirmed, a.seen_head.as_deref(), &a.reject_tasks)
                .map_err(fail)
        }
        "orchestration_export" => {
            let a: RunIdBody = body(b)?;
            orch.export_branch(&a.run_id).map_err(fail)
        }
        "orchestration_merge_preview" => {
            let a: RunIdBody = body(b)?;
            orch.merge_preview(&a.run_id).map_err(fail)
        }
        "orchestration_merge" => {
            let a: MergeBody = body(b)?;
            orch.merge_album(&a.run_id, &a.expect_head, &a.expect_target).map_err(fail)
        }
        "orchestration_approve_verify" => {
            let a: ApproveVerifyBody = body(b)?;
            orch.approve_verify(&a.run_id, &a.job_id, &a.candidate, &a.command_sha, &a.old).map_err(fail)
        }
        "orchestration_override_verify" => {
            let a: OverrideVerifyBody = body(b)?;
            orch.override_verify(&a.run_id, &a.job_id, &a.verify_id, &a.candidate).map_err(fail)
        }
        "orchestration_cleanup_preview" => {
            let a: RunIdBody = body(b)?;
            orch.cleanup_preview(&a.run_id).map_err(fail)
        }
        "orchestration_cleanup" => {
            let a: CleanupBody = body(b)?;
            orch.cleanup_run(&a.run_id, &a.worktrees, &a.refs, a.delete_branches).map_err(fail)
        }
        "orchestration_discard_temp" => {
            let a: DiscardBody = body(b)?;
            orch.discard_temp(&a.run_id, &a.path).map_err(fail)
        }
        // 감독 사건(리뷰 F11) — 미확인 목록 · 확인(사건 id 로 한 번만).
        "orchestration_notices" => {
            // `recent: true` = 확인된 최근 사건(다시 뜬 주 창의 알림 센터 — 실기 b 고침 A) · 거짓 = 미확인 목록.
            let a: NoticesBody = body(b)?;
            Ok(if a.recent { orch.notices_recent_view() } else { orch.notices_view() })
        }
        "orchestration_notices_ack" => {
            let a: NoticeAckBody = body(b)?;
            Ok(json!({ "acked": orch.notices_ack(&a.ids) }))
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}
