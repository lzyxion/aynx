//! 검토 UI 의 Tauri 명령(몸은 세션 서버 op)과 그 서버 몸(`*_in`).
//!
//! 불변식: 여기에 **승인 · 실행 짝은 없다**(그것은 `approval.rs`). 잠금은 짧게 쥐고 알림 · 감사는 잠금 밖에서.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::i18n::tr;
use crate::server::ipc::Grade;

use super::approval::OpsPlane;
use super::*;

/// 대기는 오래된 것부터(검토 순서), 최근은 최신순.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationList {
    pub pending: Vec<Operation>,
    pub recent: Vec<Operation>,
}

// ---------------------------------------------------------------------------
// GUI — Tauri 명령(서버 op 프록시).
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_operations() -> Result<Value, String> {
    crate::server::ai_proxy::call(Grade::Read, "ops_list", json!({})).await
}

#[tauri::command]
pub async fn operation_results(operation_id: String) -> Result<Value, String> {
    crate::server::ai_proxy::call(Grade::Read, "ops_results", json!({ "operationId": operation_id })).await
}

#[tauri::command]
pub async fn reject_operation(operation_id: String) -> Result<Value, String> {
    crate::server::ai_proxy::call(
        Grade::Write,
        "ops_reject",
        json!({ "operationId": operation_id, "lang": crate::server::ssh_proxy::lang() }),
    )
    .await
}

/// 명령 · 방식은 못 고친다 — 대상만.
#[tauri::command]
pub async fn modify_operation_targets(operation_id: String, targets: Vec<String>) -> Result<Value, String> {
    crate::server::ai_proxy::call(
        Grade::Write,
        "ops_modify_targets",
        json!({ "operationId": operation_id, "targets": targets, "lang": crate::server::ssh_proxy::lang() }),
    )
    .await
}

// ---------------------------------------------------------------------------
// 세션 서버 — op 의 몸. 만료(TTL)가 설정 파일을 읽으므로 블로킹 풀에서 부른다.
// ---------------------------------------------------------------------------

/// 읽기 전에 만료부터 본다 — 가장 자주 지나는 문이라 TTL 을 지키는 첫 자리다.
pub(crate) fn list_in(p: &OpsPlane) -> Result<OperationList, String> {
    let ttl_ms = approval_ttl_ms();
    let (list, expired) = {
        let mut map = p.ops.lock().map_err(
            |_| tr!(ko: "작업안 저장소 잠금 실패", en: "Could not lock the task plan store"),
        )?;
        let expired = sweep_expired(&mut map, ttl_ms);
        (
            OperationList {
                pending: list_pending(&map),
                recent: list_recent(&map),
            },
            expired,
        )
    };
    announce_expired(&p.env.emit, Some(&p.audit), expired);
    Ok(list)
}

/// 사람의 화면이라 발췌 · 검열 없이 전문 그대로 — 프라이버시 게이트는 MCP `get_operation_results` 경로의 것이다.
pub(crate) fn results_in(p: &OpsPlane, operation_id: &str) -> Result<HashMap<String, TargetResult>, String> {
    let map = p
        .results
        .lock()
        .map_err(|_| tr!(ko: "결과 저장소 잠금 실패", en: "Could not lock the result store"))?;
    Ok(map.get(operation_id).cloned().unwrap_or_default())
}

/// 잠금은 작업안 → 풀고 → 컨텍스트 순 — 겹쳐 쥐지 않는다.
pub(crate) fn reject_in(p: &OpsPlane, operation_id: &str) -> Result<Operation, String> {
    let ttl_ms = approval_ttl_ms();
    let (op, expired) = {
        let mut map = p.ops.lock().map_err(
            |_| tr!(ko: "작업안 저장소 잠금 실패", en: "Could not lock the task plan store"),
        )?;
        // 만료가 먼저다 — 시간이 지난 작업안은 거절이 아니라 만료로 끝난다.
        let expired = sweep_expired(&mut map, ttl_ms);
        (reject(&mut map, operation_id), expired)
    };
    announce_expired(&p.env.emit, Some(&p.audit), expired);
    let op = op?;
    let labels = p
        .env
        .ctx
        .lock()
        .map(|m| build_target_labels(&m, &op.targets))
        .unwrap_or_default();
    p.audit.log(
        crate::audit::AuditRecord::user_action(
            "rejected",
            op.operation_id.clone(),
            op.command.clone(),
            op.targets.clone(),
            now_ms(),
        )
        .with_labels(labels),
    );
    Ok(op)
}

/// 만료가 먼저다 — 시간이 지난 대기의 대상을 고쳐 되살리지 못하게.
pub(crate) fn modify_in(p: &OpsPlane, operation_id: &str, targets: Vec<String>) -> Result<Operation, String> {
    let ttl_ms = approval_ttl_ms();
    let (result, expired) = {
        let mut map = p.ops.lock().map_err(
            |_| tr!(ko: "작업안 저장소 잠금 실패", en: "Could not lock the task plan store"),
        )?;
        let expired = sweep_expired(&mut map, ttl_ms);
        (modify_targets(&mut map, operation_id, targets), expired)
    };
    announce_expired(&p.env.emit, Some(&p.audit), expired);
    result
}
