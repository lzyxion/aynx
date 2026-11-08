//! 검토 UI 의 Tauri 명령 — `list_operations` · `operation_results` · `reject_operation` · `modify_operation_targets` — 와 그 몸.
//!
//! ③-3c 부터 작업안 저장소는 **세션 서버**에 산다. 위는 GUI 의 Tauri 명령(같은 이름·인자·반환 JSON — 몸은 서버 op), 아래는 서버
//! op 의 몸(`*_in` — `server::ai` 가 부른다). 불변식: 여기에 **승인·실행 짝은 없다**(그것은 `approval.rs`). 잠금은 짧게 쥐고,
//! 알림·감사는 잠금 밖에서. 목록·결과는 읽기 등급(목록은 게으른 만료를 돈다 — 예전 명령과 같다), 거절·대상 수정은 쓰기 등급.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::i18n::tr;
use crate::server::ipc::Grade;

use super::approval::OpsPlane;
use super::*;

/// 검토 UI 폴링용 — **대기(카드) + 최근(이력)** 을 나눠 돌려준다.
///
/// 대기는 오래된 것부터(검토 순서), 최근은 최신순(이력). 프런트는 `pending` 으로 카드·개수
/// 배지를, `recent` 로 지난 작업안을 그린다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationList {
    pub pending: Vec<Operation>,
    pub recent: Vec<Operation>,
}

// ---------------------------------------------------------------------------
// GUI — Tauri 명령(서버 op 프록시).
// ---------------------------------------------------------------------------

/// 작업안을 대기+최근으로 나눠 돌려준다(검토 UI 폴링) — 서버 op `ops_list`.
#[tauri::command]
pub async fn list_operations() -> Result<Value, String> {
    crate::server::ai_proxy::call(Grade::Read, "ops_list", json!({})).await
}

/// 한 작업안의 **대상별 결과** — 서버 op `ops_results`. 없으면 빈 맵.
#[tauri::command]
pub async fn operation_results(operation_id: String) -> Result<Value, String> {
    crate::server::ai_proxy::call(Grade::Read, "ops_results", json!({ "operationId": operation_id })).await
}

/// 작업안을 거절한다 — 서버 op `ops_reject`. **여기에도 승인·실행 짝은 없다**.
#[tauri::command]
pub async fn reject_operation(operation_id: String) -> Result<Value, String> {
    crate::server::ai_proxy::call(
        Grade::Write,
        "ops_reject",
        json!({ "operationId": operation_id, "lang": crate::server::ssh_proxy::lang() }),
    )
    .await
}

/// 검토 중 대상 목록을 고친다 — 서버 op `ops_modify_targets`. 명령·방식은 못 고친다.
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
// 세션 서버 — op 의 몸. 검토 대기 만료(TTL)가 설정 파일을 읽으므로 부르는 쪽(`server::ai`)이 블로킹 풀에서 부른다.
// ---------------------------------------------------------------------------

/// 작업안을 대기+최근으로 나눠 돌려준다.
///
/// **읽기 전에 만료부터 본다**([`expire_stale`]) — 목록은 관제판·상태바 배지·자동 승인 훅이
/// 모두 보는 **가장 자주 지나는 문**이라, TTL 을 지킬 자리로 여기가 첫째다. 만료된 것은
/// `recent` 로 내려가고 `operation-state{state:"expired"}` 가 나간다.
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

/// 한 작업안의 **대상별 결과**를 읽는다 — 관제판이 열릴 때 닫혀 있던 새 완료 실행을 되살린다.
///
/// **로컬 사용자 소유 화면**이라 발췌·검열이 없다(전문 그대로) — 프라이버시 게이트(옵트인 재검사·
/// 발췌)는 AI(MCP `get_operation_results`) 경로의 것이고, 여기는 사람이 자기 실행을 보는 자리다.
pub(crate) fn results_in(p: &OpsPlane, operation_id: &str) -> Result<HashMap<String, TargetResult>, String> {
    let map = p
        .results
        .lock()
        .map_err(|_| tr!(ko: "결과 저장소 잠금 실패", en: "Could not lock the result store"))?;
    Ok(map.get(operation_id).cloned().unwrap_or_default())
}

/// 작업안을 거절한다.
///
/// 책임성(백로그 #8): 거절도 감사에 남긴다(`event:"rejected"`) — 누가 무엇을 막았는지. 잠금 순서는
/// 작업안 먼저(전이) → 풀고 → 컨텍스트(라벨) → 감사 send(겹쳐 쥐지 않는다).
pub(crate) fn reject_in(p: &OpsPlane, operation_id: &str) -> Result<Operation, String> {
    let ttl_ms = approval_ttl_ms();
    let (op, expired) = {
        let mut map = p.ops.lock().map_err(
            |_| tr!(ko: "작업안 저장소 잠금 실패", en: "Could not lock the task plan store"),
        )?;
        // 만료가 먼저다 — 이미 시간이 지난 작업안은 거절이 아니라 만료로 끝난다(아래 `reject`
        // 가 "만료된 작업안입니다" 로 되돌려 말한다).
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

/// 검토 중 대상 목록을 고친다(선택 기능). 명령·방식은 못 고친다([`modify_targets`]).
///
/// 여기서도 만료가 먼저다 — 시간이 지난 대기의 대상을 고쳐 되살리지 못하게
/// ([`modify_targets`] 가 `is_open()` 으로 막는다).
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
