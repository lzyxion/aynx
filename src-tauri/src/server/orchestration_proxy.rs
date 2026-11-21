//! GUI 쪽 오케스트레이션 껍데기 — Run 표 · 역할 토큰은 세션 서버에 산다(`crate::orchestration`). 명령은 전부 `async fn` 이고 몸은 서버 op 하나씩이다.
//!
//! - **Run 을 여는 명령은 없다** — Run 은 사람의 [새 앨범] 시작(`producer_album_start`)으로만 열린다. 검증 명령은 [새 앨범] 구성에서만 정하고
//!   Run 은 시작 때 사본을 고정한다. 검증 승인 · 실패 덮어쓰기는 아래 두 명령뿐이고 MCP 에는 없다.
//! - **조정자 토큰은 없다** — 조정자는 프로듀서 채팅 토큰에 서버 표가 붙인 역할이고 GUI 는 묶지 않는다. 타일 토큰 · 채팅 토큰 값은 Tauri 명령 ·
//!   프런트 · 로그로 가지 않는다(시험 `tile_token_never_reaches_frontend` · `chat_token_never_reaches_frontend`).
//! - 실패 문구는 서버가 만든 `[이유] 사람 문구`(표시 언어 — 몸에 `lang` 을 싣는다).

use serde_json::{json, Value};

use super::ai_proxy::call;
use super::client;
use super::ipc::frame::{ALBUM_ARCHIVE_PROTOCOL, ALBUM_MERGE_PROTOCOL};
use super::ipc::Grade;
use super::ssh_proxy::lang;

/// 서버가 사람 문구를 몸의 `lang` 으로 만든다.
async fn ocall(kind: Grade, op: &str, mut body: Value) -> Result<Value, String> {
    if let Some(o) = body.as_object_mut() {
        o.insert("lang".into(), json!(lang()));
    }
    call(kind, op, body).await
}

#[tauri::command]
pub async fn orchestration_stop_worker(run_id: String, attempt_id: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_stop_worker",
        json!({ "runId": run_id, "attemptId": attempt_id }),
    )
    .await
}

#[tauri::command]
pub async fn orchestration_wt_remove(run_id: String, path: String, delete_branch: bool) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_wt_remove",
        json!({ "runId": run_id, "path": path, "deleteBranch": delete_branch }),
    )
    .await
}

/// `decision` = `accept` · `reject`.
#[tauri::command]
pub async fn orchestration_review_task(run_id: String, task_id: String, version: u64, decision: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_review_task",
        json!({ "runId": run_id, "taskId": task_id, "version": version, "decision": decision }),
    )
    .await
}

/// `recent: true` 면 확인된 최근 사건까지(다시 뜬 주 창의 알림 센터).
#[tauri::command]
pub async fn orchestration_notices(recent: Option<bool>) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_notices", json!({ "recent": recent.unwrap_or(false) })).await
}

#[tauri::command]
pub async fn orchestration_notices_ack(ids: Vec<String>) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_notices_ack", json!({ "ids": ids })).await
}

/// 경로 동일성은 Rust 의 OS 함수 하나(`orchestration::progress::same_dir`)가 정한다.
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

/// `detail` = 작업자 상세가 열린 Attempt id — 파일 경로는 서버가 Attempt 기록에서 읽는다.
#[tauri::command]
pub async fn orchestration_worker_activity(run_id: String, detail: Option<String>) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_worker_activity", json!({ "runId": run_id, "detail": detail })).await
}

/// 그 Attempt 의 **고정 대화 파일**만 — 커서 `before`.
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

#[tauri::command]
pub async fn orchestration_report_drift(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_report_drift", json!({ "runId": run_id })).await
}

/// 조정자 `get_diff` 가 보는 것과 같은 고정 OID 의 목록.
#[tauri::command]
pub async fn orchestration_report_files(run_id: String, task_id: String, report_id: Option<String>) -> Result<Value, String> {
    ocall(
        Grade::Read,
        "orchestration_report_files",
        json!({ "runId": run_id, "taskId": task_id, "reportId": report_id }),
    )
    .await
}

/// [Run 완료] — 사람만.
#[tauri::command]
pub async fn orchestration_complete_run(run_id: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_complete_run", json!({ "runId": run_id })).await
}

/// 통합 ref 어긋남은 [조정]으로만 푼다. Run 은 멈춘 채 — 재개는 따로.
#[tauri::command]
pub async fn orchestration_release_hold(run_id: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_release_hold", json!({ "runId": run_id })).await
}

#[tauri::command]
pub async fn orchestration_cancel_integration(run_id: String, task_id: String) -> Result<Value, String> {
    ocall(
        Grade::Write,
        "orchestration_cancel_integration",
        json!({ "runId": run_id, "taskId": task_id }),
    )
    .await
}

#[tauri::command]
pub async fn orchestration_reconcile_preview(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_reconcile_preview", json!({ "runId": run_id })).await
}

/// [조정] — 사람만. `mode` = `revert` · `accept`.
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

/// [브랜치로 내보내기] — 사람만.
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

/// 저장소를 바꾸지 않는다.
#[tauri::command]
pub async fn orchestration_merge_preview(run_id: String) -> Result<Value, String> {
    merge_gate()?;
    ocall(Grade::Read, "orchestration_merge_preview", json!({ "runId": run_id })).await
}

/// [병합] — main 병합은 사람만(원격은 재확인). 창에서 본 값과 다르면 하지 않는다.
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

/// [검증 실행] — 사람만. 확인 대화가 보인 후보 · 명령 해시 · 통합 머리에 묶인다(바뀌었으면 `approval-stale`).
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

/// [검증 실패인데 수락] — 사람만. 실패한 그 Job · 검증 · 후보에 묶인다.
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

#[tauri::command]
pub async fn orchestration_cleanup_preview(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_cleanup_preview", json!({ "runId": run_id })).await
}

/// [정리] — 사람만.
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

/// [그래도 지우기] — 사람만.
#[tauri::command]
pub async fn orchestration_discard_temp(run_id: String, path: String) -> Result<Value, String> {
    ocall(Grade::Write, "orchestration_discard_temp", json!({ "runId": run_id, "path": path })).await
}

/// 조율 쓰기만 멈춘다(작업자는 계속 돈다).
#[tauri::command]
pub async fn orchestration_pause(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_pause", json!({ "runId": run_id })).await.map(|_| ())
}

#[tauri::command]
pub async fn orchestration_resume(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_resume", json!({ "runId": run_id })).await.map(|_| ())
}

#[tauri::command]
pub async fn orchestration_stop(run_id: String) -> Result<(), String> {
    ocall(Grade::Write, "orchestration_stop", json!({ "runId": run_id })).await.map(|_| ())
}

#[tauri::command]
pub async fn orchestration_snapshot() -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_snapshot", json!({})).await
}

#[tauri::command]
pub async fn orchestration_run(run_id: String) -> Result<Value, String> {
    ocall(Grade::Read, "orchestration_run", json!({ "runId": run_id })).await
}

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

#[tauri::command]
pub async fn orchestration_archive(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_archive", json!({ "runId": run_id })).await
}

/// 판 26 미만 서버면 빈 목록.
#[tauri::command]
pub async fn orchestration_archive_list() -> Result<Value, String> {
    if archive_gate().is_err() {
        return Ok(json!([]));
    }
    ocall(Grade::Read, "orchestration_archive_list", json!({})).await
}

#[tauri::command]
pub async fn orchestration_restore(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_restore", json!({ "runId": run_id })).await
}

/// 내보낸 브랜치 · 병합된 커밋은 그대로 둔다.
#[tauri::command]
pub async fn orchestration_delete_archived(run_id: String) -> Result<Value, String> {
    archive_gate()?;
    ocall(Grade::Write, "orchestration_delete_archived", json!({ "runId": run_id })).await
}
