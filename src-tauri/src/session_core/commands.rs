//! 세션 코어의 kind 무관 Tauri 명령 — 스트림 열쇠 하나로 부르는 세션 서버 op 프록시다.
//!
//! - 서버의 같은 연결 위에서 차례로 처리되므로 리로드의 떨어뜨리기 → 새 페이지의 붙기 순서가 선다.
//! - 떨어뜨리기는 출력 싱크를 빼고 수문 임대를 풀 뿐이다 — 셸 · 전송로 · 포워드 · 신호 토큰 · 세션 로그 · 거울은 살고 꼬리 링도 계속 적는다.
//!   GUI 연결이 끊겨도(종료 · kill) 같다.
//! - 시청자의 쓰기 · 크기 · ACK 는 주와 같은 명령에 시청자의 열쇠를 싣는다. 닫기 · 체크포인트 · `detach_session` 은 주의 일이다(시청자 열쇠면 `[stale-lease]`).

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::Checkpoint;
use crate::server::ipc::Grade;

/// 임대만 푼다(세션은 산다). 이미 떨어져 있었으면 성공이다.
#[tauri::command]
pub async fn detach_session(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    checkpoint: Option<Checkpoint>,
    release: Option<bool>,
) -> Result<(), String> {
    crate::server::proxy::detach(&stream, session_epoch, lease_epoch, checkpoint, release.unwrap_or(false)).await
}

/// 막 떨어진 같은 임대도 받는다(`beforeunload`).
#[tauri::command]
pub async fn stash_checkpoint(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    checkpoint: Checkpoint,
) -> Result<(), String> {
    crate::server::proxy::call(
        Grade::Write,
        "checkpoint",
        serde_json::json!({
            "stream": stream,
            "sessionEpoch": session_epoch,
            "leaseEpoch": lease_epoch,
            "checkpoint": checkpoint,
        }),
    )
    .await
    .map(|_| ())
}

/// 서버에 닿지 못하면 "없음"(새로 연다). `kind` 는 프런트 계약에 남은 인자로 쓰지 않는다.
#[tauri::command]
pub async fn probe_session(stream: String, kind: Option<String>) -> Value {
    let _ = kind;
    match crate::server::proxy::probe(&stream).await {
        Some(v) => v,
        None => serde_json::json!({ "state": "none" }),
    }
}

/// SSH 재부착은 원격 autorun · 셸 통합 스니펫 · 훅 설치를 다시 보내지 않는다(새 접속의 일). `cols`·`rows` 가 없으면 크기를 건드리지 않는다.
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약(`open_local_session` 과 같은 이유)
#[tauri::command]
pub async fn attach_session(
    webview: tauri::Webview,
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    take: Option<bool>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    crate::server::proxy::attach(
        &label,
        &stream,
        expected_session_epoch,
        consumed,
        take,
        on_data,
        cols,
        rows,
    )
    .await
}

/// 주 임대를 빼앗지 않고 함께 본다. `sizeOwnerEligible`(기본 참)이 거짓이면 쳐도 크기 주인이 되지 않는다(폰).
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약
#[tauri::command]
pub async fn attach_session_viewer(
    webview: tauri::Webview,
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
    size_owner_eligible: Option<bool>,
) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    crate::server::proxy::attach_viewer(
        &label,
        &stream,
        expected_session_epoch,
        consumed,
        on_data,
        cols,
        rows,
        size_owner_eligible,
    )
    .await
}

/// 이미 떨어졌으면(예산 초과로 서버가 먼저 뗐다) `false`.
#[tauri::command]
pub async fn detach_session_viewer(stream: String, session_epoch: u64, lease_epoch: u64) -> Result<bool, String> {
    crate::server::proxy::detach_viewer(&stream, session_epoch, lease_epoch).await
}

/// 복원이 데려가지 않은 떨어진 세션은 닫지 않고 떨어진 세션 목록에 남긴다 — 끝난 잔해만 거둔다.
#[tauri::command]
pub async fn restore_done_sessions(webview: tauri::Webview, keep: Vec<String>) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    let keep = keep_for_server(keep, crate::server::client::negotiated_protocol());
    Ok(crate::server::proxy::call(
        Grade::Write,
        "restore_done",
        serde_json::json!({ "window": label, "keep": keep }),
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "closed": 0, "unclaimed": 0 })))
}

/// 쿼리 타일을 떨어진 세션으로 남기지 않는 옛 판 서버에는 DB 연결 열쇠(`query:` 머리)를 빼고 보낸다.
pub(crate) fn keep_for_server(keep: Vec<String>, negotiated: Option<u32>) -> Vec<String> {
    if negotiated.is_some_and(|p| p < crate::server::ipc::frame::DETACHED_DB_PROTOCOL) {
        return keep.into_iter().filter(|s| !s.starts_with(crate::reap::QUERY_STREAM_PREFIX)).collect();
    }
    keep
}

/// 아무 창도 데려가지 않은 것만 — 리로드 중인 창의 세션처럼 곧 다시 붙을 것은 빠진다.
#[tauri::command]
pub async fn detached_sessions(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    Ok(crate::server::proxy::detached_visible(&app).await)
}

/// 지금 떨어져 있을 때만 닫는다(그 사이 누가 붙었으면 `false`).
#[tauri::command]
pub async fn close_detached_session(stream: String) -> Result<bool, String> {
    crate::server::proxy::call(Grade::Write, "close_detached", serde_json::json!({ "stream": stream }))
        .await
        .map(|v| v.as_bool().unwrap_or(false))
}

#[tauri::command]
pub async fn set_session_ai_read(stream: String, on: bool) -> Result<(), String> {
    crate::server::proxy::call(Grade::Write, "session_ai_read", serde_json::json!({ "stream": stream, "on": on }))
        .await
        .map(|_| ())
}
