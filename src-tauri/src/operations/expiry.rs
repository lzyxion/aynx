//! 검토 대기 만료(TTL).
//!
//! 불변식: 타이머가 없다 — 잠금을 이미 쥔 읽기·전이 경로의 첫 줄에서 판정하고, 이벤트·감사는 **잠금 밖에서** 낸다.
//! 종료·실행 상태는 시계가 건드리지 않는다(봉해진 결과가 사라진다).

use std::collections::HashMap;

use super::*;

/// 대기의 `expires_at` 이 `None`(TTL 0 일 때 요청됨)이면 영원히 기다린다 — 그때의 답을 뒤늦게 뒤집지 않는다.
pub(crate) fn expire_stale(
    map: &mut HashMap<String, Operation>,
    now_ms: u64,
    ttl_ms: u64,
) -> Vec<String> {
    if ttl_ms == 0 {
        return Vec::new();
    }
    let now = now_ms as i64;
    let mut expired: Vec<String> = map
        .values_mut()
        .filter(|op| match op.state {
            OperationState::Draft => op.created_at.saturating_add(ttl_ms) <= now_ms,
            OperationState::AwaitingApproval => op.expires_at.is_some_and(|e| e <= now),
            _ => false,
        })
        .map(|op| {
            op.state = OperationState::Expired;
            op.operation_id.clone()
        })
        .collect();
    // 이벤트 · 감사가 결정적이도록 id 로 세운다.
    expired.sort();
    expired
}

/// `0` 이면 만료 없음. 디스크(`settings.toml`)를 읽는다 — UI 스레드에서 부르지 않는다.
pub(crate) fn approval_ttl_ms() -> u64 {
    crate::settings::automation_prefs().approval_ttl_minutes as u64 * 60_000
}

/// 잠금 안에서 만료하고 알릴 거리만 뽑는다 — 알림은 잠금 밖의 [`announce_expired`].
pub(crate) fn sweep_expired(
    map: &mut HashMap<String, Operation>,
    ttl_ms: u64,
) -> Vec<(String, String, Vec<String>)> {
    expire_stale(map, now_ms(), ttl_ms)
        .into_iter()
        .map(|id| {
            let (command, targets) = map
                .get(&id)
                .map(|op| (op.command.clone(), op.targets.clone()))
                .unwrap_or_default();
            (id, command, targets)
        })
        .collect()
}

/// 잠금 밖에서 부른다. `audit` 가 `None` 이면 감사는 건너뛴다 — MCP 요청 스레드는 `Audit` 을 쥐지 않아 이벤트만 낸다(`McpSignal::emit_state`).
pub(crate) fn announce_expired(
    emit: &EmitFn,
    audit: Option<&crate::audit::Audit>,
    expired: Vec<(String, String, Vec<String>)>,
) {
    for (id, command, targets) in expired {
        emit(
            EVT_STATE,
            serde_json::json!({ "operationId": id, "state": OperationState::Expired }),
        );
        if let Some(audit) = audit {
            audit.log(crate::audit::AuditRecord::user_action(
                "expired",
                id,
                command,
                targets,
                now_ms(),
            ));
        }
    }
}
