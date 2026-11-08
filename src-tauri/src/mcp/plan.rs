//! 작업안 도구(단계 8) — `create_execution_plan` · `request_execution` · `get_operation`,
//! 대상 자격 게이트([`plan_target_id_eligible`])와 정수 인자 클램프([`clamp_int_arg`]).
//!
//! 불변식:
//! - ⛔ **실행이 없다** — PTY write 도, SSH exec 도, 원시 `send_command` 도 없다. 저장·검토 요청·읽기뿐.
//! - 승인·거절·취소는 여기 없다 — `crate::operations` 의 Tauri 명령뿐(AI 는 자가 승인 못 한다).
//! - 위임(`crate::delegation`)은 **읽기만** 한다 — 고치는 길은 호스트 폼·타일 AI 권한(Tauri 명령)뿐.
//! - 대상 자격은 **원격 호스트의 AI 권한**(누적 `read && propose`)이다 — 창 타일·헤드리스 세션이 같은
//!   별칭 권한을 따르고, 로컬 타일·호스트 목록 밖 원격 타일은 대상이 될 수 없다
//!   ([`crate::context::ai_plan_eligible`]).
//! - 작업안 잠금은 컨텍스트 잠금보다 늘 나중이고, emit 은 잠금 밖이다.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::SessionContext;
use crate::operations::{self, OperationStore};

use super::*;

// ---------------------------------------------------------------------------
// 단계 8 — 작업안 도구 (실행 0). `create_execution_plan` · `request_execution` · `get_operation`.
//
// ⛔ 여기에는 실행이 없다. PTY write 도, SSH exec 도, `send_command` 도 없다 — 세 도구는
// [`crate::operations`] 저장소에 **데이터를 넣고/상태 표식을 바꾸고/읽을** 뿐이다. 작업안 잠금은
// 이 함수들 안에서만 잡히므로 컨텍스트 잠금(이미 잡힌 `map`)보다 항상 나중이다(락 순서).
// ---------------------------------------------------------------------------

/// 작업안 `timeoutSeconds`(대상별 exec 타임아웃)의 허용 범위 — 1초..1시간. 동시 실행 상한은
/// settings 의 [`crate::settings::MAX_MAX_CONCURRENCY`] 를 재사용한다(여기 두 벌 두지 않는다).
const PLAN_TIMEOUT_MIN: u32 = 1;
const PLAN_TIMEOUT_MAX: u32 = 3600;

/// MCP 인자의 정수 필드를 검증·클램프한다 — **순수 함수**(테스트 대상).
///
/// - 없음(키 부재·`null`) → `default`.
/// - **음수 아닌 정수** → `[min, max]` 로 클램프(큰 값도 조용히 잘리지 않고 상한으로 — `as u32`
///   절단 제거). `as_u64` 는 정수 JSON 숫자만 `Some` 이라 여기 걸리는 것은 언제나 안전한 범위다.
/// - 그 밖(문자열·실수·음수) → **오류**. 잘못 준 값을 조용히 기본값으로 바꾸지 않고 되돌려 말한다.
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

/// `create_execution_plan` 의 선택 문자열 인자 하나(`cwd` · `validate` · `idempotencyKey` — 셋이
/// **같은 규칙**)를 검증한다.
///
/// 없거나 문자열이 아니면 `None`(오류 아님). 있으면 앞뒤 공백을 떼어 돌려주고, 떼어 낸 값이
/// 비어/공백뿐 → NUL 포함 → 4096 바이트 초과 순으로 검사해 오류 문장에 인자 이름을 넣는다.
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

/// **승인 요약의 두 필수 인자**(docs/log/2026-10-21-approval-summary.md) — `create_execution_plan` · `create_db_write_plan` 이 함께 쓴다.
///
/// - `summary` — 사람에게 보일 평문. 제어 글자를 걷고 빈칸을 접어 300자에서 자른다(오류가 아니다). 남는 것이 없으면 오류.
/// - `effect` — AI 의 선언 `read` · `write` · `delete`. 셋 밖이면 오류.
///
/// 오류 문구는 모델이 읽는 영어다(다른 인자 오류와 같은 결).
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

/// 요청한 AI 타일의 이름표 — 타일 토큰으로 왔고 그 타일이 거울에 있을 때만(코드 + 라벨). 전역 토큰 · 거울에 없는 타일은 `None`.
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

/// 대상 id → 사람이 읽는 이름(호스트 별칭 · 라벨 · 위임 별칭) — 메신저가 창 없이도 이름을 적게 작업안에 붙여 둔다.
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

/// **실행-계획 대상 자격 게이트** — 이 세션이 작업안 대상이 될 수 있는가. **순수 함수**(테스트 대상).
///
/// 읽기 가시성 [`crate::context::ai_readable`] 의 실행 짝이고, 판정은 [`crate::context::ai_plan_eligible`]
/// 한 곳이다: 원격 창 타일은 호스트 별칭(`host_alias`), 헤드리스 세션은 위임 별칭(`label`)의 누적
/// `read && propose`. **로컬 타일은 "AI 읽기 허용" 이 켜져 있어도 대상이 아니고**, 별칭 없는 원격 타일도
/// 아니다. 단계가 '읽기 전용' 인 호스트의 세션은 읽기만 되고 실행은 안 된다.
pub(super) fn plan_target_eligible(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    crate::context::ai_plan_eligible(ctx, delegation)
}

/// **대상 id 하나가 작업안 대상이 될 자격이 있는가** — 라이브 거울 기준 **또는** not-live 위임 기준.
/// **순수 함수**(테스트 대상). `create_execution_plan` 의 필터가 대상마다 이걸 부른다.
///
/// 두 길 중 하나면 자격:
/// - (a) 거울에 있고 [`plan_target_eligible`] 을 통과(창 타일·헤드리스 세션 — 그 별칭의 `read && propose`).
/// - (b) 거울에 없어도 `delegated:<alias>` 꼴이고 delegation.toml 이 그 별칭에 **`read`+`propose` 를 함께
///   위임**(A2b — 아직 접속 안 된 위임 대상). 실행 시점에 executor 가 `connect` 위임 아래 자동
///   접속한다([`crate::operations`]). `read` 는 AI 가 그 대상을 참조할 수 있음을, `propose` 는 실행
///   제안을 위임했음을 뜻한다 — 둘 다 있어야 not-live 대상을 계획에 넣는다(`connect` 는 실행 시점의
///   자동 접속 게이트라 여기서 보지 않는다).
///
/// 살아 있는 헤드리스 세션은 (a)가 잡는다(거울에 있고 id 도 `delegated:<alias>` 라 propose 로 통과). (b)는
/// **거울에 아직 없을 때만** 갈림길이 된다.
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
        // `propose_granted` 는 누적 판정(`read && propose`)이다.
        return delegation.propose_granted(alias);
    }
    false
}

/// `create_execution_plan` — 초안을 **저장**한다(부작용 0, 실행 없음). 반환 `{operationId, operation}`.
///
/// 대상은 **AI 권한이 'Ask' 이상인 원격 세션만** 남기고 **중복 제거**한다: 자격 없는 id 는
/// 조용히 빼고(존재를 흘리지 않는다), 하나도 안 남으면 오류다. 실제 실행 동의는 뒤 단계의 승인·정책이
/// 따로 강제한다. `delegation` 은 부르는 쪽([`super::rpc`])이 요청 하나에 한 번 읽어 넘긴다.
///
/// `concurrency`·`timeoutSeconds` 는 [`clamp_int_arg`] 로 검증·클램프한다(조용한 기본값 대체·
/// `as u32` 절단 없음). **같은 호스트 노트는 넣지 않는다** — 거울에 안정 host 키가 없어(docs/internal/next.md)
/// `label` 로 지어내면 로컬 셸 등에서 오탐이 난다. host 키가 생기면 그때 `warnings` 로 붙인다.
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

    // 대상 자격을 정한다 → **중복 제거**(첫 등장 순서). 창 타일·헤드리스 세션 모두 그 호스트 별칭의
    // `read && propose` 가 문지기다([`plan_target_eligible`]). 위임은 요청 하나에 한 번 읽힌 것을 받는다.
    // 중복 제거는 같은 대상에 두 번 돌리거나 결과 키를 덮는 걸 막는다.
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

    // 승인 요약(필수) — AI 의 설명과 선언. 앱 분석은 저장 때 원문으로 따로 매긴다(`operations::analysis`).
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
    // 동시 실행·타임아웃은 검증·클램프한다 — 없으면 기본, 정수면 범위로 조이고, 그 밖(문자열·실수·
    // 음수)이면 오류다(조용한 기본값 대체·`as u32` 절단 없음). 동시 실행 상한은 settings 상수를 재사용.
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

    // cwd(백로그 #9, 선택) — 있으면 검증한다. targets 처럼 조용히 버리지 않는다: 잘못된 cwd 는
    // 흘려보내면 엉뚱한 디렉터리에서 실행되므로 오류로 되돌려 말한다. 비어/공백뿐·NUL·4096B 초과는
    // 거부하고, 앞뒤 공백은 떼어 저장한다(합성은 [`operations::compose_command`] 가 한다).
    let cwd = optional_text_arg(args, "cwd")?;

    // validate(A4d, 선택) — canary 성공 뒤 canary 대상에서 돌릴 사후 검증 명령. cwd 와 **똑같이**
    // 검증한다(비어/공백뿐·NUL·4096B 초과는 오류, 앞뒤 공백은 떼어 저장). exit 0 이어야 나머지로
    // 번진다([`operations::execute`]). 자동 승인일 때는 이 명령도 안전 술어를 통과해야 한다.
    let validate = optional_text_arg(args, "validate")?;

    // idempotencyKey(선택) — AI 가 요청마다 한 번 만드는 고유 토큰. cwd·validate 와 **똑같이**
    // 검증한다(비어/공백뿐·NUL·4096B 초과는 오류, 앞뒤 공백은 떼어 저장). 같은 키로 다시 부르면
    // 새 작업안을 만들지 않고 기존 작업안을 돌려준다(아래 잠금 안에서 조회).
    let idempotency_key = optional_text_arg(args, "idempotencyKey")?;

    let operation_id = operations::new_operation_id()
        .ok_or_else(|| "No randomness source to make a task plan id".to_string())?;

    let op = {
        let mut opmap = ops
            .lock()
            .map_err(|_| "Could not lock the task plan store".to_string())?;
        // 멱등 재생 — 조회와 생성을 **같은 잠금 획득** 안에서 한다: 키가 주어졌고 같은 키의 작업안이
        // 이미 있으면 새로 만들지 않고 그걸(지금 상태 그대로) 돌려준다(재시도 = 같은 op 재생). 없으면
        // 그대로 이어서 create_plan 한다 — 잠금을 계속 쥐고 있어 near-동시 동일 호출 둘이 둘 다 만들 수
        // 없다. 키가 없으면 이 갈래를 건너뛰어 예전 그대로 매번 새 작업안이다(하위 호환).
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

/// `create_execution_plan` 의 응답 한 모양 — `{operationId, operation, requestedAt, expiresAt,
/// approvalTtlSeconds}`.
///
/// 초안은 아직 요청 전이라 `requestedAt`·`expiresAt` 은 `null` 이다(`request_execution` 이
/// 찍는다). `approvalTtlSeconds` 는 **지금 설정된 만료 시간**이라 초안 단계에서도 읽을 수
/// 있다 — "검토를 요청하면 이만큼 기다린다" 를 미리 말해 준다(`null` = 만료 없음).
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
/// 상태 표식 하나를 바꾸고 **그 자리에서 창을 깨운다**(`operation-state` —
/// docs/log/2026-09-22-review-request-signal.md). 작업안 잠금은 상태 전이 동안만 잡고
/// **풀고 나서** 내보낸다 — 락 순서(컨텍스트→작업안)이고 emit 은 잠금 밖이다.
///
/// **우편함 한 줄은 남기지 않는다 (2026-09-22).** 한때 여기서 "작업안 검토 요청: …" 을
/// [`McpSignal::notice`] 에 남겨 6초짜리 토스트를 띄웠는데, 같은 말을 화면 위 검토 대기
/// 카드가 **대기가 0 이 될 때까지** 하고 있어 중복이었다
/// (docs/log/2026-09-22-review-card.md). 이 함수가 내는 신호는 이제 `operation-state`
/// 하나뿐이고, 그것을 `app/pending-plans` 가 받아 카드·배지·OS 알림을 함께 먹인다.
pub(super) fn request_execution(
    ops: &OperationStore,
    signal: &McpSignal,
    args: Option<&Value>,
) -> Result<Value, String> {
    let operation_id = args
        .and_then(|a| a.get("operationId"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The operationId argument is required".to_string())?;

    // 검토 대기 만료(TTL) — 요청 전에 **묵은 것부터 거둔다**. 거둔 id 들은 아래에서
    // `operation-state{expired}` 로 나간다(docs/log/2026-09-21-approval-ttl.md ·
    // 2026-09-22-review-request-signal.md). **감사 한 줄은 남지 않는다** — 이 스레드에는
    // `Audit` 이 없다(`operations::announce_expired` 의 `audit: None` 경로와 같은 이유).
    let ttl_ms = operations::approval_ttl_ms();
    let (expired, op) = {
        let mut opmap = ops
            .lock()
            .map_err(|_| "Could not lock the task plan store".to_string())?;
        let expired = operations::expire_stale(&mut opmap, operations::now_ms(), ttl_ms);
        let op = operations::request(&mut opmap, operation_id, operations::now_ms(), ttl_ms)?;
        (expired, op)
    }; // 작업안 잠금은 여기서 풀린다 — 내보내기는 그 뒤다.

    for id in expired {
        signal.emit_state(&id, operations::OperationState::Expired);
    }
    // 배지·카드·관제판이 30초 폴링을 기다리지 않게 **지금** 알린다. 사람이 읽을 한 줄은
    // 여기서 만들지 않는다 — 그 말은 화면 위 대기 카드가 한다(위 머리말).
    signal.emit_state(
        &op.operation_id,
        operations::OperationState::AwaitingApproval,
    );
    Ok(with_ttl(
        serde_json::to_value(&op).unwrap_or(Value::Null),
        ttl_ms,
    ))
}

/// `get_operation` — 작업안 하나를 읽는다(순수 읽기).
///
/// **읽기 전에 만료부터 본다** — 기다리는 AI 가 "기다리라" 는 답만 영원히 받지 않게 한다
/// ([`wait_for_operation`] 도 확인마다 같은 것을 한다).
/// 거둔 것은 `request_execution` 과 똑같이 `operation-state{expired}` 로 알린다(잠금 밖에서).
/// **감사 한 줄은 없다** — 이 스레드에는 `Audit` 이 없다(그쪽은 Tauri 경로의 몫이다).
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
    }; // 작업안 잠금은 여기서 풀린다 — emit 은 잠금 밖이다.

    for id in expired {
        signal.emit_state(&id, operations::OperationState::Expired);
    }
    found.ok_or_else(|| format!("No such task plan: {operation_id}"))
}
