//! GUI 쪽 **오케스트레이션 껍데기**(2026-10-14 · 설계 G 2단계) — Run 표 · 역할 토큰은 세션 서버에 산다(`crate::orchestration`).
//! 여기 있는 것은 같은 이름의 Tauri 명령(전부 `async fn`)이고, 몸은 서버 op 하나씩이다(`ai_proxy` 와 같은 틀).
//!
//! | Tauri 명령 | 서버 op | 인자 → 답 |
//! | --- | --- | --- |
//! | [`orchestration_pause`] · [`orchestration_resume`] · [`orchestration_stop`] | 같은 이름 | `runId` → — |
//! | [`orchestration_snapshot`] | 같은 이름 | → 모든 Run 요약(orphaned 포함) |
//! | [`orchestration_run`] | 같은 이름 | `runId` → 상세(Task · 타임라인 · 남은 한도) |
//! | [`orchestration_set_task_state`] | 같은 이름 | `runId, taskId, version, state` → `{task, latestSeq}` |
//! | [`orchestration_archive`] | 같은 이름 | `runId` → `{runId, archivedAt}`([보관]) |
//! | [`orchestration_archive_list`] | 같은 이름 | → 보관함 줄들 |
//! | [`orchestration_restore`] | 같은 이름 | `runId` → `{runId, state}`([복원]) |
//! | [`orchestration_delete_archived`] | 같은 이름 | `runId` → `{runId, refsRemoved}`([영구 삭제] — 원격은 재확인) |
//! | [`orchestration_stop_worker`] | 같은 이름 | `runId, attemptId` → `{attemptId, state}`(작업자 하나 [중단] — 3단계) |
//! | [`orchestration_wt_remove`] | 같은 이름 | `runId, path, deleteBranch` → 지운 결과(보수적 — 서버 `orchestration::worktree`) |
//! | [`orchestration_review_task`] | 같은 이름 | `runId, taskId, version, decision` → `{task, accepted, flipped, latestSeq}`(4단계 — [수락] · [반려] · 뒤집기) |
//! | [`orchestration_report_drift`] | 같은 이름 | `runId` → 보고 뒤 변경 목록(4단계) |
//! | [`orchestration_report_files`] | 같은 이름 | `runId, taskId, reportId?` → 보고의 바뀐 파일 목록(조정자 `get_diff` 와 같은 것) |
//! | [`orchestration_complete_run`] | 같은 이름 | `runId` → `{runId, state}`(통합 설계 3-4 — [Run 완료], 사람만) |
//! | [`orchestration_release_hold`] | 같은 이름 | `runId` → `{runId, state}`(통합 설계 2-1 — 보류 해제: 의도 저장 실패 · 정리 대기만) |
//! | [`orchestration_cancel_integration`] | 같은 이름 | `runId, taskId` → `{task, jobId, job}`(통합 설계 4-4 — 통합 [취소], 커밋 단계 전만) |
//! | [`orchestration_reconcile_preview`] | 같은 이름 | `runId` → `{expectedHead, currentHead, integrated[…]}`(통합 설계 4-5 — [조정] 재료) |
//! | [`orchestration_reconcile`] | 같은 이름 | `runId, mode, confirmed, seenHead?, rejectTasks` → `{runId, mode, head}`(통합 설계 4-5 — [조정]) |
//! | [`orchestration_export`] | 같은 이름 | `runId` → `{runId, branch, head}`(통합 설계 N1 — [브랜치로 내보내기]) |
//! | [`orchestration_merge_preview`] | 같은 이름 | `runId` → 병합 전 검사(`album_merge.rs` — 저장소를 바꾸지 않는다) |
//! | [`orchestration_merge`] | 같은 이름 | `runId, expectHead, expectTarget` → `{merged, commit?, reason?, preview?}`([병합] — 사람만 · 원격은 재확인) |
//! | [`orchestration_approve_verify`] | 같은 이름 | `runId, jobId, candidate, commandSha, old` → `{runId, jobId, phase}`(통합 설계 5-1 — [검증 실행], 사람 확인) |
//! | [`orchestration_override_verify`] | 같은 이름 | `runId, jobId, verifyId, candidate` → `{runId, jobId, phase}`(통합 설계 5-4 — [검증 실패인데 수락]) |
//! | [`orchestration_cleanup_preview`] | 같은 이름 | `runId` → `{worktrees, refs, tempPending, exportBranch}`(통합 설계 6-2 · 6-3 — [정리] 재료) |
//! | [`orchestration_cleanup`] | 같은 이름 | `runId, worktrees, refs, deleteBranches` → `{worktrees, refs, failed, temps}`(통합 설계 6-3 — [정리]) |
//! | [`orchestration_discard_temp`] | 같은 이름 | `runId, path` → `{path, removed}`(통합 설계 6-2 — [그래도 지우기]) |
//!
//! - **Run 을 여는 명령은 없다**(3차 6단계): Run 은 프로듀서 채팅의 `start_run`(MCP)으로만 열린다. 사람의 시작 명령 · 시작 대화의 기준 줄 ·
//!   [이어 가기](복구 길은 `adopt_run`) · worktree 목록 명령은 걷었다. **검증 명령은 저장소 맡기기(`delegation::repo` 의 Tauri 명령)에서만**
//!   정하고 Run 은 시작 때 사본을 고정한다. 승인 · 덮어쓰기는 아래 두 명령뿐이고 MCP 에는 없다.
//!
//! - (3a) 작업자 재료 틀(GUI 의 `prepare_spawn` 환경)은 걷었다 — 작업자는 헤드리스 턴이라 GUI 재료가 필요 없다(세션 서버 혼자 띄운다).
//!   2차의 [돌려주기] · [복구 완료] · [유지] 명령도 걷었다(개입 · 붙여넣기 · 보고 뒤 자동 종료가 없다).
//!
//! - 변화는 서버 이벤트 `orchestration-changed {runId, seq}` 를 GUI 가 같은 이름으로 창에 중계한다(`client::RELAYED`).
//! - **조정자 토큰은 없다**: 조정자는 서버가 띄울 때 뽑은 **프로듀서 채팅 토큰**(`crate::chat_token` 종류 `producer`)에 서버 표가 붙인 역할이다
//!   (묶음은 `start_run` · `adopt_run` 이 서버 잠금 안에서 세운다 — GUI 는 묶지 않는다). 타일 토큰 · 채팅 토큰 값은 Tauri 명령 · 프런트 · 로그로
//!   가지 않는다(시험 `tile_token_never_reaches_frontend` · `chat_token_never_reaches_frontend`). 1단계의 프로듀서 표지 명령과
//!   3차 4단계의 [이 타일의 MCP 거두기](`orchestration_revoke_tile` — 2단계 단계 6 뒤 부르는 곳이 없어졌다)는 걷었다.
//! - 실패 문구는 서버가 만든 `[이유] 사람 문구`(표시 언어 — 몸에 `lang` 을 싣는다).

use serde_json::{json, Value};

use super::ai_proxy::call;
use super::client;
use super::ipc::frame::{ALBUM_ARCHIVE_PROTOCOL, ALBUM_MERGE_PROTOCOL};
use super::ipc::Grade;
use super::ssh_proxy::lang;

/// 몸에 표시 언어를 얹어 보낸다(서버가 사람 문구를 그 언어로 만든다).
async fn ocall(kind: Grade, op: &str, mut body: Value) -> Result<Value, String> {
    if let Some(o) = body.as_object_mut() {
        o.insert("lang".into(), json!(lang()));
    }
    call(kind, op, body).await
}

/// 작업자 하나 [중단](사람 — 보드) — 트리 종료 · 확인 뒤 stopped.
#[tauri::command]
pub async fn orchestration_stop_worker(run_id: String, attempt_id: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_stop_worker",
        json!({ "runId": run_id, "attemptId": attempt_id }),
    )
    .await
}

/// Run 이 만든 worktree 하나를 지운다(사람 — 보드의 [worktree 지우기]). 규칙은 서버(`orchestration::worktree` 머리말).
#[tauri::command]
pub async fn orchestration_wt_remove(run_id: String, path: String, delete_branch: bool) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_wt_remove",
        json!({ "runId": run_id, "path": path, "deleteBranch": delete_branch }),
    )
    .await
}

/// 사람의 [수락] · [반려] · 뒤집기(4단계 — 보드). `decision` = `accept` · `reject`. 규칙은 서버(`orchestration::report`).
#[tauri::command]
pub async fn orchestration_review_task(run_id: String, task_id: String, version: u64, decision: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_review_task",
        json!({ "runId": run_id, "taskId": task_id, "version": version, "decision": decision }),
    )
    .await
}

/// 감독 사건 미확인 목록(리뷰 F11) — 주 창이 뜰 때 · 이벤트를 놓쳤을 때 꺼내 보인다(사건 id 로 한 번만). `recent: true` 면 확인된 최근
/// 사건(다시 뜬 주 창의 알림 센터 — 실기 b 고침 A).
#[tauri::command]
pub async fn orchestration_notices(recent: Option<bool>) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_notices", json!({ "recent": recent.unwrap_or(false) })).await
}

/// 감독 사건 확인 — 보인 사건 id 들을 서버 큐에서 뺀다.
#[tauri::command]
pub async fn orchestration_notices_ack(ids: Vec<String>) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_notices_ack", json!({ "ids": ids })).await
}

/// Run 저장소와 **같은 폴더**인 프로젝트 — 후보 경로 중 첫 번째의 번호(리뷰 F14 — 경로 동일성은 Rust 의 OS 함수 하나가 정한다,
/// `orchestration::progress::same_dir`). 파일 시스템을 묻으므로 블로킹 풀.
#[tauri::command]
pub async fn orchestration_same_dir_index(path: String, candidates: Vec<String>) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        candidates
            .iter()
            .position(|c| crate::orchestration::progress::same_dir(c, std::path::Path::new(&path)))
    })
    .await
    .map_err(|e| e.to_string())
}

/// 보드 최근 활동(6단계 — 보드가 보일 때만) — 산 작업자마다 고정 대화의 마지막 말 한 줄 · 최근 도구 셋 · 변경 파일 수 · 경고.
/// `detail`(오케스트레이션 탭 ③) = 작업자 상세가 열린 Attempt id — 그 칸에만 작업 중 파일 목록(+/−)을 더한다(경로는 서버가 Attempt 기록에서).
#[tauri::command]
pub async fn orchestration_worker_activity(run_id: String, detail: Option<String>) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_worker_activity", json!({ "runId": run_id, "detail": detail })).await
}

/// [기록 보기](6단계) — 기존 대화 기록 화면이 그 Attempt 의 **고정 대화 파일**을 한 쪽씩(끝에서 거꾸로 · 커서 `before`).
#[tauri::command]
pub async fn orchestration_worker_transcript(
    run_id: String,
    attempt_id: String,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<Value, String> {
    ocall(
        Grade::Read,
        "orchestration_worker_transcript",
        json!({ "runId": run_id, "attemptId": attempt_id, "before": before, "limit": limit }),
    )
    .await
}

/// "보고 뒤 변경"(4단계 — 보드가 열려 있을 때만) — 보고가 있는 worktree 의 지금 HEAD · 미커밋을 보고 때와 견준다.
#[tauri::command]
pub async fn orchestration_report_drift(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_report_drift", json!({ "runId": run_id })).await
}

/// 보고의 바뀐 파일 목록(통합 설계 3-1 — 보드의 [파일 목록]). 조정자 `get_diff` 가 보는 것과 같은 고정 OID 의 목록.
#[tauri::command]
pub async fn orchestration_report_files(run_id: String, task_id: String, report_id: Option<String>) -> Result<Value, String> {
    ocall(
        Grade::Read,
        "orchestration_report_files",
        json!({ "runId": run_id, "taskId": task_id, "reportId": report_id }),
    )
    .await
}

/// [Run 완료](통합 설계 3-4 — 사람만) — Task 전부 종결 · 진행 중 통합 없음 · 산 작업자 없음 · 보류 없음일 때만 `done`.
#[tauri::command]
pub async fn orchestration_complete_run(run_id: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_complete_run", json!({ "runId": run_id })).await
}

/// 보류 해제(통합 설계 2-1) — 의도 저장 실패 · 정리 대기만(통합 ref 어긋남은 [조정]으로만). Run 은 멈춘 채 — 재개는 따로.
#[tauri::command]
pub async fn orchestration_release_hold(run_id: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_release_hold", json!({ "runId": run_id })).await
}

/// 통합 [취소](통합 설계 4-4) — 커밋 단계 전의 통합 작업만 거둔다(Task 는 보고됨으로 — 수락 안 됨).
#[tauri::command]
pub async fn orchestration_cancel_integration(run_id: String, task_id: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_cancel_integration",
        json!({ "runId": run_id, "taskId": task_id }),
    )
    .await
}

/// [조정] 재료(통합 설계 4-5) — 기대 머리 · 지금 머리 · 통합된 Task 마다 지금 머리에 들어 있나.
#[tauri::command]
pub async fn orchestration_reconcile_preview(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_reconcile_preview", json!({ "runId": run_id })).await
}

/// [조정](통합 설계 4-5 — 사람만) — `revert`(되돌리기 · 사람이 올린 머리는 보존) · `accept`(받아들이기 — 확인 필수).
#[tauri::command]
pub async fn orchestration_reconcile(
    run_id: String,
    mode: String,
    confirmed: bool,
    seen_head: Option<String>,
    reject_tasks: Vec<String>,
) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_reconcile",
        json!({ "runId": run_id, "mode": mode, "confirmed": confirmed, "seenHead": seen_head, "rejectTasks": reject_tasks }),
    )
    .await
}

/// [브랜치로 내보내기](통합 설계 N1 — 사람만) — 통합 머리를 `orch-<run8>-int` 브랜치로(체크아웃돼 있거나 앱 밖에서 바뀌었으면 거절).
#[tauri::command]
pub async fn orchestration_export(run_id: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_export", json!({ "runId": run_id })).await
}

/// 판 27 미만 서버(업데이트 전에 뜬 세션 서버)면 병합 op 를 보내지 않는다.
fn merge_gate() -> Result<(), String> {
    if client::negotiated_protocol().is_some_and(|p| p < ALBUM_MERGE_PROTOCOL) {
        return Err(crate::errors::with_reason(
            crate::errors::SERVER_OUTDATED,
            crate::i18n::tr!(ko: "세션 서버를 다시 시작해야 쓸 수 있습니다", en: "Restart the session server to use this"),
        ));
    }
    Ok(())
}

/// [병합] 확인 창의 재료 — 커밋 안 한 변경 · 지금 브랜치 · 충돌 예상 · 숫자 칸. 저장소를 바꾸지 않는다.
#[tauri::command]
pub async fn orchestration_merge_preview(run_id: String) -> Result<Value, String> {
    merge_gate()?;
    ocall(Grade::Read, "orchestration_merge_preview", json!({ "runId": run_id })).await
}

/// [병합](사람만 — 원격은 재확인) — 내보낸 브랜치를 시작 때의 브랜치에 `git merge --no-ff`(push 없음). 창에서 본 값과 다르면 하지 않는다.
#[tauri::command]
pub async fn orchestration_merge(run_id: String, expect_head: String, expect_target: String) -> Result<Value, String> {
    merge_gate()?;
    ocall(
        Grade::Write,
        "orchestration_merge",
        json!({ "runId": run_id, "expectHead": expect_head, "expectTarget": expect_target }),
    )
    .await
}

/// [검증 실행](통합 설계 5-1 — 사람만) — 확인 대화가 보인 후보 · 명령 해시 · 통합 머리에 묶인다(바뀌었으면 `approval-stale`).
#[tauri::command]
pub async fn orchestration_approve_verify(
    run_id: String,
    job_id: String,
    candidate: String,
    command_sha: String,
    old: String,
) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_approve_verify",
        json!({ "runId": run_id, "jobId": job_id, "candidate": candidate, "commandSha": command_sha, "old": old }),
    )
    .await
}

/// [검증 실패인데 수락](통합 설계 5-4 — 사람만) — 실패한 그 Job · 검증 · 후보에 묶인다.
#[tauri::command]
pub async fn orchestration_override_verify(
    run_id: String,
    job_id: String,
    verify_id: String,
    candidate: String,
) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_override_verify",
        json!({ "runId": run_id, "jobId": job_id, "verifyId": verify_id, "candidate": candidate }),
    )
    .await
}

/// [정리] 재료(통합 설계 6-2 · 6-3) — 작업자 worktree(지울 수 있나 · 기본 체크) · 이 Run 의 ref · 남긴 서버 임시 자리. 끝난 Run · orphaned 만.
#[tauri::command]
pub async fn orchestration_cleanup_preview(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_cleanup_preview", json!({ "runId": run_id })).await
}

/// [정리](통합 설계 6-3 — 사람만) — 고른 작업자 worktree(미커밋이면 거절 · 브랜치는 기본 남김) · 고른 ref(그 OID 로만).
#[tauri::command]
pub async fn orchestration_cleanup(
    run_id: String,
    worktrees: Vec<String>,
    refs: Vec<String>,
    delete_branches: bool,
) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_cleanup",
        json!({ "runId": run_id, "worktrees": worktrees, "refs": refs, "deleteBranches": delete_branches }),
    )
    .await
}

/// 남긴 서버 임시 자리 [그래도 지우기](통합 설계 6-2 — 사람만) — 소유 · 실제 경로 · 쓰는 프로세스 0 · 링크 먼저 걷기는 그대로.
#[tauri::command]
pub async fn orchestration_discard_temp(run_id: String, path: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_discard_temp", json!({ "runId": run_id, "path": path })).await
}

/// 일시정지 — 조율 쓰기만 멈춘다(작업자는 계속 돈다).
#[tauri::command]
pub async fn orchestration_pause(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_pause", json!({ "runId": run_id })).await.map(|_| ())
}

/// 재개.
#[tauri::command]
pub async fn orchestration_resume(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_resume", json!({ "runId": run_id })).await.map(|_| ())
}

/// 중단 — 즉시 새 조율을 막고 역할 토큰을 거둔다.
#[tauri::command]
pub async fn orchestration_stop(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_stop", json!({ "runId": run_id })).await.map(|_| ())
}

/// 모든 Run 요약(orphaned 포함). 서버에 닿지 못하면 오류 문구.
#[tauri::command]
pub async fn orchestration_snapshot() -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_snapshot", json!({})).await
}

/// Run 하나의 상세.
#[tauri::command]
pub async fn orchestration_run(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_run", json!({ "runId": run_id })).await
}

/// 사람의 Task 상태 바꾸기(2단계 — 취소 · 다시 열기).
#[tauri::command]
pub async fn orchestration_set_task_state(run_id: String, task_id: String, version: u64, state: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_set_task_state",
        json!({ "runId": run_id, "taskId": task_id, "version": version, "state": state }),
    )
    .await
}

/// 판 26 미만 서버(업데이트 전에 뜬 세션 서버)면 보관함 쓰기를 보내지 않는다.
fn archive_gate() -> Result<(), String> {
    if client::negotiated_protocol().is_some_and(|p| p < ALBUM_ARCHIVE_PROTOCOL) {
        return Err(crate::errors::with_reason(
            crate::errors::SERVER_OUTDATED,
            crate::i18n::tr!(ko: "세션 서버를 다시 시작해야 쓸 수 있습니다", en: "Restart the session server to use this"),
        ));
    }
    Ok(())
}

/// 끝난 앨범 [보관](파일은 `archived/` 로 · 기록과 ref 는 남는다).
#[tauri::command]
pub async fn orchestration_archive(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_archive", json!({ "runId": run_id })).await
}

/// 보관함 목록(판 26 미만 서버면 빈 목록).
#[tauri::command]
pub async fn orchestration_archive_list() -> Result<Value, String> {
    if archive_gate().is_err() {
        return Ok(json!([]));
    }
    ocall(Grade::Read, "orchestration_archive_list", json!({})).await
}

/// 보관한 앨범 [복원] — 끝난 기록으로만 돌아온다.
#[tauri::command]
pub async fn orchestration_restore(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_restore", json!({ "runId": run_id })).await
}

/// 보관한 앨범 [영구 삭제] — 이 앨범의 ref 와 파일(내보낸 브랜치 · 병합된 커밋은 그대로).
#[tauri::command]
pub async fn orchestration_delete_archived(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_delete_archived", json!({ "runId": run_id })).await
}
