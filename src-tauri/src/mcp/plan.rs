//! 작업안 도구 — `create_execution_plan` · `request_execution` · `get_operation` · 대상 자격 게이트([`plan_target_id_eligible`]).
//!
//! 불변식:
//! - ⛔ **실행이 없다** — PTY write 도, SSH exec 도, 원시 `send_command` 도 없다. 저장·검토 요청·읽기뿐.
//! - 승인·거절·취소는 여기 없다 — `crate::operations` 의 Tauri 명령뿐(AI 는 자가 승인 못 한다).
//! - 위임(`crate::delegation`)은 **읽기만** 한다 — 고치는 길은 Tauri 명령뿐.
//! - 대상 자격은 **원격 호스트의 AI 권한**(누적 `read && propose`)이다 — 로컬 타일 · 호스트 목록 밖 원격 타일은 대상이 될 수 없다
//!   ([`crate::context::ai_plan_eligible`]).
//! - 작업안 잠금은 컨텍스트 잠금보다 늘 나중이고, emit 은 잠금 밖이다.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::SessionContext;
use crate::operations::{self, OperationStore};

use super::*;

/// 동시 실행 상한은 [`crate::settings::MAX_MAX_CONCURRENCY`] 를 재사용한다(여기 두 벌 두지 않는다).
const PLAN_TIMEOUT_MIN: u32 = 1;
const PLAN_TIMEOUT_MAX: u32 = 3600;

/// 없음 → `default`, 음수 아닌 정수 → `[min, max]` 로 클램프, 그 밖 → 오류(잘못 준 값을 조용히 기본값으로 바꾸지 않는다).
pub(super) fn clamp_int_arg(
    v: Option<&Value>,
    default: u32,
    min: u32,
    max: u32,
    name: &str,
) -> Result<u32, String> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(val) => match val.as_u64() {
            Some(n) => Ok(n.clamp(min as u64, max as u64) as u32),
            None => Err(format!("{name} must be an integer in {min}..{max}")),
        },
    }
}

/// `cwd` · `validate` · `idempotencyKey` 가 같은 규칙이다. 문자열이 아니면 `None`(오류 아님).
fn optional_text_arg(args: &Value, name: &str) -> Result<Option<String>, String> {
    let Some(raw) = args.get(name).and_then(Value::as_str) else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{name} cannot be empty"));
    }
    if trimmed.contains('\0') {
        return Err(format!("{name} contains a NUL byte"));
    }
    if trimmed.len() > 4096 {
        return Err(format!("{name} is too long (4096 bytes at most)"));
    }
    Ok(Some(trimmed.to_string()))
}

/// 승인 요약의 두 필수 인자(docs/log/2026-10-21-approval-summary.md) — `create_execution_plan` · `create_db_write_plan` 이 함께 쓴다.
pub(super) fn declaration_args(args: &Value) -> Result<(String, operations::Effect), String> {
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .and_then(operations::analysis::clean_summary)
        .ok_or_else(|| {
            "The summary argument is required — one or two plain sentences telling the person reviewing it what this plan does (300 characters at most)".to_string()
        })?;
    let effect = args
        .get("effect")
        .and_then(Value::as_str)
        .and_then(operations::Effect::parse)
        .ok_or_else(|| "The effect argument is required — \"read\", \"write\" or \"delete\": the strongest thing this plan does to its targets".to_string())?;
    Ok((summary, effect))
}

/// 타일 토큰으로 왔고 그 타일이 거울에 있을 때만.
pub(super) fn requester_label(caller: &crate::orchestration::Caller, map: &HashMap<String, SessionContext>) -> Option<String> {
    let crate::orchestration::Caller::Tile { stream } = caller else {
        return None;
    };
    let c = map.get(stream)?;
    let label = c.label.trim();
    let code = c.code.trim();
    let text = match (code.is_empty(), label.is_empty()) {
        (true, true) => return None,
        (true, false) => label.to_string(),
        (false, true) => code.to_string(),
        (false, false) => format!("{code} {label}"),
    };
    Some(text.chars().take(80).collect())
}

/// 메신저가 창 없이도 이름을 적게 작업안에 붙여 둔다.
fn target_labels(targets: &[String], map: &HashMap<String, SessionContext>) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    for id in targets {
        let name = match map.get(id) {
            Some(c) => c.host_alias.clone().filter(|a| !a.trim().is_empty()).unwrap_or_else(|| c.label.clone()),
            None => crate::routing::delegated_alias_of(id).map(str::to_string).unwrap_or_default(),
        };
        let name: String = name.trim().chars().take(64).collect();
        if !name.is_empty() {
            out.insert(id.clone(), name);
        }
    }
    out
}

/// 로컬 타일은 "AI 읽기 허용" 이 켜져 있어도 대상이 아니고, 별칭 없는 원격 타일도 아니다.
pub(super) fn plan_target_eligible(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    crate::context::ai_plan_eligible(ctx, delegation)
}

/// 거울에 없어도 `delegated:<alias>` 꼴이고 그 별칭에 `read`+`propose` 가 함께 위임됐으면 자격이 있다 — 실행 때 executor 가
/// `connect` 위임 아래 자동 접속한다(`connect` 는 여기서 보지 않는다).
pub(super) fn plan_target_id_eligible(
    id: &str,
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> bool {
    if let Some(c) = map.get(id) {
        if plan_target_eligible(c, delegation) {
            return true;
        }
    }
    if let Some(alias) = crate::routing::delegated_alias_of(id) {
        return delegation.propose_granted(alias);
    }
    false
}

/// `create_execution_plan` — 초안을 **저장**한다(실행 없음). 자격 없는 대상 id 는 조용히 뺀다(존재를 흘리지 않는다).
///
/// 같은 호스트 노트는 넣지 않는다 — 거울에 안정 host 키가 없어 `label` 로 지어내면 로컬 셸 등에서 오탐이 난다.
pub(super) fn create_execution_plan(
    caller: &crate::orchestration::Caller,
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    ops: &OperationStore,
    args: Option<&Value>,
) -> Result<Value, String> {
    let args = args.ok_or_else(|| "Arguments are required".to_string())?;
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "The command argument is required".to_string())?;
    let raw_targets = args
        .get("targets")
        .and_then(Value::as_array)
        .ok_or_else(|| "A targets array is required".to_string())?;

    let filtered: Vec<String> = raw_targets
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| plan_target_id_eligible(id, map, delegation))
        .map(str::to_string)
        .collect();
    let targets = operations::dedup_targets(filtered);
    if targets.is_empty() {
        return Err("No session can be a target — only remote sessions whose host's AI permission is 'Ask' or higher can be targets (local sessions and hosts that are not in the host list never can)".into());
    }

    // 앱 분석은 저장 때 원문으로 따로 매긴다(`operations::analysis`).
    let (summary, effect) = declaration_args(args)?;

    let mode = args
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("adhoc")
        .to_string();
    let strategy = args
        .get("strategy")
        .and_then(Value::as_str)
        .unwrap_or("rolling")
        .to_string();
    let concurrency = clamp_int_arg(
        args.get("concurrency"),
        1,
        crate::settings::MIN_MAX_CONCURRENCY,
        crate::settings::MAX_MAX_CONCURRENCY,
        "concurrency",
    )?;
    let timeout_seconds = clamp_int_arg(
        args.get("timeoutSeconds"),
        60,
        PLAN_TIMEOUT_MIN,
        PLAN_TIMEOUT_MAX,
        "timeoutSeconds",
    )?;
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);
    let reason = args
        .get("reason")
        .and_then(Value::as_str)
        .map(str::to_string);

    // 잘못된 cwd 는 targets 처럼 조용히 버리지 않는다 — 흘려보내면 엉뚱한 디렉터리에서 실행된다.
    let cwd = optional_text_arg(args, "cwd")?;

    // validate — 자동 승인일 때는 이 명령도 안전 술어를 통과해야 한다.
    let validate = optional_text_arg(args, "validate")?;

    let idempotency_key = optional_text_arg(args, "idempotencyKey")?;

    let operation_id = operations::new_operation_id()
        .ok_or_else(|| "No randomness source to make a task plan id".to_string())?;

    let op = {
        let mut opmap = ops
            .lock()
            .map_err(|_| "Could not lock the task plan store".to_string())?;
        // 멱등 재생 — 조회와 생성을 같은 잠금 획득 안에서 한다(거의 동시의 같은 호출 둘이 둘 다 만들지 못하게).
        if let Some(key) = idempotency_key.as_deref() {
            if let Some(existing) = operations::find_by_idempotency_key(&opmap, key) {
                let existing = existing.clone();
                return Ok(plan_reply(existing));
            }
        }
        let decl = operations::Declaration {
            summary,
            effect,
            requested_by: requester_label(caller, map),
            target_labels: target_labels(&targets, map),
        };
        operations::create_plan(
            &mut opmap,
            operation_id.clone(),
            command.to_string(),
            targets,
            cwd,
            validate,
            mode,
            strategy,
            concurrency,
            timeout_seconds,
            title,
            reason,
            operations::now_ms(),
            idempotency_key,
        );
        operations::declare(&mut opmap, &operation_id, decl).ok_or_else(|| "internal: the saved task plan vanished".to_string())?
    };
    Ok(plan_reply(op))
}

/// `approvalTtlSeconds` 는 지금 설정된 만료 시간이라 초안 단계에서도 읽을 수 있다(`null` = 만료 없음).
pub(super) fn plan_reply(op: operations::Operation) -> Value {
    let ttl_ms = operations::approval_ttl_ms();
    let (operation_id, requested_at, expires_at) =
        (op.operation_id.clone(), op.requested_at, op.expires_at);
    json!({
        "operationId": operation_id,
        "operation": op,
        "requestedAt": requested_at,
        "expiresAt": expires_at,
        "approvalTtlSeconds": if ttl_ms == 0 { Value::Null } else { json!(ttl_ms / 1000) },
    })
}

/// `request_execution` — 검토를 요청한다(draft→awaitingApproval). **실행 아님.**
///
/// 우편함 한 줄은 남기지 않는다 — 같은 말을 화면 위 검토 대기 카드가 한다(docs/log/2026-09-22-review-card.md).
pub(super) fn request_execution(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
) -> Result<Value, String> {
    let operation_id = args
        .and_then(|a| a.get("operationId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The operationId argument is required".to_string())?;

    // 감사 한 줄은 남지 않는다 — 이 스레드에는 `Audit` 이 없다(`operations::announce_expired` 의 `audit: None` 경로와 같은 이유).
    let ttl_ms = operations::approval_ttl_ms();
    let (expired, op) = {
        let mut opmap = ops
            .lock()
            .map_err(|_| "Could not lock the task plan store".to_string())?;
        let expired = operations::expire_stale(&mut opmap, operations::now_ms(), ttl_ms);
        let op = operations::request(&mut opmap, operation_id, operations::now_ms(), ttl_ms)?;
        (expired, op)
    };

    for id in expired {
        signal.emit_state(&id, operations::OperationState::Expired);
    }
    // 배지·카드·관제판이 30초 폴링을 기다리지 않게 지금 알린다.
    signal.emit_state(
        &op.operation_id,
        operations::OperationState::AwaitingApproval,
    );
    Ok(with_ttl(
        serde_json::to_value(&op).unwrap_or(Value::Null),
        ttl_ms,
    ))
}

/// 읽기 전에 만료부터 본다 — 기다리는 AI 가 "기다리라" 는 답만 영원히 받지 않게. 감사 한 줄은 없다(이 스레드에는 `Audit` 이 없다).
pub(super) fn get_operation(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
) -> Result<Value, String> {
    let operation_id = args
        .and_then(|a| a.get("operationId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The operationId argument is required".to_string())?;
    let ttl_ms = operations::approval_ttl_ms();
    let (expired, found) = {
        let mut opmap = ops
            .lock()
            .map_err(|_| "Could not lock the task plan store".to_string())?;
        let expired = operations::expire_stale(&mut opmap, operations::now_ms(), ttl_ms);
        let found = operations::get(&opmap, operation_id)
            .map(|op| with_ttl(serde_json::to_value(op).unwrap_or(Value::Null), ttl_ms));
        (expired, found)
    };

    for id in expired {
        signal.emit_state(&id, operations::OperationState::Expired);
    }
    found.ok_or_else(|| format!("No such task plan: {operation_id}"))
}
