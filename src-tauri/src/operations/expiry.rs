//! 검토 대기 만료(TTL) — [`expire_stale`](순수 판정) · [`approval_ttl_ms`](설정) · [`sweep_expired`]·[`announce_expired`].
//!
//! 불변식: 타이머가 없다 — 잠금을 이미 쥔 읽기·전이 경로의 첫 줄에서 판정하고, 이벤트·감사는 **잠금 밖에서** 낸다.
//! 종료·실행 상태는 시계가 건드리지 않는다.

use std::collections::HashMap;

use super::*;

// ---------------------------------------------------------------------------
// 검토 대기 만료(TTL) — 백로그 #7. docs/log/2026-09-21-approval-ttl.md
// ---------------------------------------------------------------------------

/// **읽을 때 그 자리에서 만료시킨다** — 새로 만료된 작업안의 id 들. **순수 함수**(테스트 대상).
///
/// 두 규칙뿐이다:
/// - **Draft** — [`Operation::created_at`] 으로부터 `ttl_ms` 가 지났으면 만료. 검토 요청조차
///   없이 남은 초안이 저장소에 영원히 쌓이지 않게 한다.
/// - **AwaitingApproval** — [`Operation::expires_at`] 을 지났으면 만료. `None`(TTL 0 일 때
///   요청됐다)이면 **영원히 기다린다** — 그때의 답을 뒤늦게 뒤집지 않는다.
///
/// `ttl_ms == 0` 이면 아무것도 만료시키지 않는다(사용자가 "만료 없음" 을 골랐다). **종료·실행
/// 상태는 건드리지 않는다** — 이미 봉해진 작업안의 상태를 시계가 갈아 끼우면 결과가 사라진다.
///
/// ## 왜 타이머가 없나
///
/// 앱에 시계를 하나 더 두면 창·리로드마다 수명을 맞춰야 하고, 만료 하나 때문에 도는 스레드가
/// 생긴다. 만료는 **누군가 그 작업안을 볼 때만** 뜻이 있으므로(목록·승인·거절·MCP 읽기), 잠금을
/// 이미 쥐는 그 경로들의 첫 줄에서 판정한다 — "재발을 보기 전에 방어 기계를 늘리지 않는다"
/// (CLAUDE.md)와 같은 결이다.
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
    // HashMap 순회는 순서가 없다 — 이벤트·감사가 결정적이도록 id 로 세운다.
    expired.sort();
    expired
}

/// 설정의 검토 대기 만료(분)를 ms 로 — `0` 이면 `0`("만료 없음").
///
/// **디스크를 읽는다**(`settings.toml`) — 부르는 자리는 전부 `async` Tauri 명령이거나 MCP
/// 서버 스레드다(docs/conventions.md "Tauri 명령은 기본 async fn"). 그래서 이 모듈의 읽기
/// 명령 셋(`list_operations`·`reject_operation`·`modify_operation_targets`)이 2026-09-21 에
/// 동기에서 `async` 로 바뀌었다.
pub(crate) fn approval_ttl_ms() -> u64 {
    crate::settings::automation_prefs().approval_ttl_minutes as u64 * 60_000
}

/// 잠금을 쥔 채 만료를 처리하고 **알릴 거리**(id·명령·대상)를 뽑는다.
///
/// 잠금 밖에서 [`announce_expired`] 가 이벤트·감사로 내보낸다 — 느린 일을 잠금 위에서 하지
/// 않는다(docs/conventions.md).
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

/// 만료를 프런트(`operation-state`)와 감사에 알린다 — **잠금 밖에서**.
///
/// 이벤트는 앱 전역이라 어느 창에서 읽었든 모든 창이 본다. 감사는 `event:"expired"` 한 줄이다
/// (책임성 — 사람이 아니라 **시계**가 막았다는 사실도 남는다). `audit` 가 `None` 인 경로는
/// 조용히 건너뛴다.
///
/// **MCP 요청 스레드는 이 함수를 쓰지 않는다** — 그쪽은 [`crate::mcp::McpSignal::emit_state`]
/// 로 같은 이벤트([`EVT_STATE`])만 내보내고 감사는 남기지 않는다(`Audit` 을 쥐지 않는다 —
/// docs/log/2026-09-22-review-request-signal.md).
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
