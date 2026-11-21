//! 순수 저장소 연산(검토 단계) — 명령 · MCP 핸들러는 잠금만 잡고 이쪽을 부른다.
//!
//! 불변식: 여기엔 **실행이 없다**(원시 `send_command` 도 없다) — 상태 표식과 대상 목록만 바꾼다. 명령·방식은 검토에서
//! 못 고친다(사용자는 "어디에" 만 좁힌다).

use std::collections::HashMap;

use crate::i18n::tr;

use super::*;

/// 부작용은 맵에 넣는 것뿐이다.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_plan(
    map: &mut HashMap<String, Operation>,
    operation_id: String,
    command: String,
    targets: Vec<String>,
    cwd: Option<String>,
    validate: Option<String>,
    mode: String,
    strategy: String,
    concurrency: u32,
    timeout_seconds: u32,
    title: Option<String>,
    reason: Option<String>,
    created_at: u64,
    idempotency_key: Option<String>,
) -> Operation {
    // 앱 분석은 AI 의 선언과 무관하게 원문으로 지금 매긴다.
    let analysis = super::analysis::analyze_plan(&command, validate.as_deref());
    let op = Operation {
        operation_id: operation_id.clone(),
        command,
        targets,
        cwd,
        validate,
        mode,
        strategy,
        concurrency,
        timeout_seconds,
        state: OperationState::Draft,
        created_at,
        // 초안도 만료를 면하지 못한다 — `expire_stale` 이 `created_at` + TTL 로 거둔다.
        requested_at: None,
        expires_at: None,
        title,
        reason,
        idempotency_key,
        approval_method: None,
        approve_all: false,
        cancelled_by_user: false,
        db: None,
        summary: None,
        effect: None,
        analysis: Some(analysis),
        mismatch: false,
        requested_by: None,
        target_labels: Default::default(),
    };
    map.insert(operation_id, op.clone());
    op
}

pub(crate) fn create_db_plan(
    map: &mut HashMap<String, Operation>,
    operation_id: String,
    plan: DbPlan,
    title: Option<String>,
    reason: Option<String>,
    created_at: u64,
    idempotency_key: Option<String>,
) -> Operation {
    let command = db_plan_text(&plan);
    let target = db_target_id(&plan.conn_id);
    let timeout = plan.timeout_seconds;
    let mut op = create_plan(
        map,
        operation_id.clone(),
        command,
        vec![target],
        None,
        None,
        "db".into(),
        "transaction".into(),
        1,
        timeout,
        title,
        reason,
        created_at,
        idempotency_key,
    );
    op.analysis = Some(super::analysis::analyze_db(&plan.statements));
    op.db = Some(plan);
    map.insert(operation_id, op.clone());
    op
}

/// AI 가 작업안에 붙인 선언 — MCP 두 도구가 저장 직후 얹는다.
pub(crate) struct Declaration {
    /// `clean_summary` 를 지난 것.
    pub summary: String,
    pub effect: super::analysis::Effect,
    pub requested_by: Option<String>,
    pub target_labels: std::collections::BTreeMap<String, String>,
}

pub(crate) fn declare(map: &mut HashMap<String, Operation>, operation_id: &str, d: Declaration) -> Option<Operation> {
    let op = map.get_mut(operation_id)?;
    op.mismatch = op.analysis.as_ref().is_some_and(|a| super::analysis::mismatch(d.effect, a.effect));
    // 분석은 선언을 모르므로 줄마다의 어긋남도 여기서 매긴다.
    if let Some(a) = op.analysis.as_mut() {
        for line in &mut a.lines {
            line.over = super::analysis::mismatch(d.effect, line.effect);
        }
    }
    op.summary = Some(d.summary);
    op.effect = Some(d.effect);
    op.requested_by = d.requested_by;
    op.target_labels = d.target_labels;
    Some(op.clone())
}

pub(crate) fn db_plan_text(plan: &DbPlan) -> String {
    plan.statements.iter().map(|s| format!("{};", s.sql)).collect::<Vec<_>>().join("\n")
}

/// 상태를 가리지 않는다 — AI 의 재시도가 어디에 있든 같은 작업안을 다시 보게. evict 되면 키도 함께 사라진다(색인 없음).
pub(crate) fn find_by_idempotency_key<'a>(
    map: &'a HashMap<String, Operation>,
    key: &str,
) -> Option<&'a Operation> {
    map.values()
        .find(|op| op.idempotency_key.as_deref() == Some(key))
}

/// 이미 대기면 시각을 다시 찍지 않는다 — 재시도로 만료가 늘면 TTL 이 뜻을 잃는다.
/// 오류 문구는 영어 리터럴이다 — 부르는 곳은 MCP `request_execution` 뿐이고 읽는 것은 모델이다.
pub(crate) fn request(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
    now_ms: u64,
    ttl_ms: u64,
) -> Result<Operation, String> {
    let op = map
        .get_mut(operation_id)
        .ok_or_else(|| format!("Task plan not found: {operation_id}"))?;
    match op.state {
        OperationState::Draft => {
            op.state = OperationState::AwaitingApproval;
            op.requested_at = Some(now_ms as i64);
            op.expires_at = (ttl_ms > 0).then(|| now_ms.saturating_add(ttl_ms) as i64);
        }
        OperationState::AwaitingApproval => {}
        OperationState::Rejected => {
            return Err("A rejected task plan cannot be requested again".into())
        }
        OperationState::Expired => {
            return Err("An expired task plan cannot be requested again".into())
        }
        OperationState::Approved | OperationState::Running => {
            return Err("This task plan is already approved or running".into())
        }
        OperationState::Succeeded
        | OperationState::Partial
        | OperationState::Failed
        | OperationState::Cancelled => {
            return Err("This task plan has already finished running".into())
        }
    }
    Ok(op.clone())
}

pub(crate) fn get<'a>(
    map: &'a HashMap<String, Operation>,
    operation_id: &str,
) -> Option<&'a Operation> {
    map.get(operation_id)
}

pub(crate) fn list_pending(map: &HashMap<String, Operation>) -> Vec<Operation> {
    let mut list: Vec<Operation> = map
        .values()
        .filter(|op| op.state == OperationState::AwaitingApproval)
        .cloned()
        .collect();
    list.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.operation_id.cmp(&b.operation_id))
    });
    list
}

pub(crate) fn list_recent(map: &HashMap<String, Operation>) -> Vec<Operation> {
    let mut list: Vec<Operation> = map
        .values()
        .filter(|op| op.state != OperationState::AwaitingApproval)
        .cloned()
        .collect();
    list.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.operation_id.cmp(&a.operation_id))
    });
    list
}

pub(crate) fn reject(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
) -> Result<Operation, String> {
    let op = map.get_mut(operation_id).ok_or_else(
        || tr!(ko: "그런 작업안이 없습니다: {operation_id}", en: "Task plan not found: {operation_id}"),
    )?;
    match op.state {
        OperationState::Draft | OperationState::AwaitingApproval => {
            op.state = OperationState::Rejected;
        }
        OperationState::Rejected => {}
        OperationState::Expired => {
            return Err(tr!(ko: "만료된 작업안입니다", en: "This task plan has expired"))
        }
        OperationState::Approved | OperationState::Running => {
            return Err(tr!(
                ko: "이미 승인/실행 중인 작업안은 취소로 멈춥니다",
                en: "A task plan that is already approved or running is stopped by cancelling it",
            ))
        }
        OperationState::Succeeded
        | OperationState::Partial
        | OperationState::Failed
        | OperationState::Cancelled => {
            return Err(tr!(
                ko: "이미 실행이 끝난 작업안입니다",
                en: "This task plan has already finished running",
            ))
        }
    }
    Ok(op.clone())
}

pub(crate) fn modify_targets(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
    targets: Vec<String>,
) -> Result<Operation, String> {
    let op = map.get_mut(operation_id).ok_or_else(
        || tr!(ko: "그런 작업안이 없습니다: {operation_id}", en: "Task plan not found: {operation_id}"),
    )?;
    if !op.state.is_open() {
        return Err(tr!(
            ko: "종료된 작업안은 대상을 고칠 수 없습니다",
            en: "The targets of a finished task plan cannot be changed",
        ));
    }
    // 다른 연결로 옮기면 검토한 것과 다른 일이 된다.
    if op.db.is_some() {
        return Err(tr!(
            ko: "DB 작업안은 대상을 고칠 수 없습니다(연결 하나 — 거절하고 다시 만들게 하세요)",
            en: "A database task plan's target cannot be changed (one connection — reject it and have a new one made)",
        ));
    }
    op.targets = dedup_targets(targets);
    Ok(op.clone())
}

/// 중복은 명령을 두 번 돌리거나 결과 행렬(streamId 키)을 덮어쓴다 — 첫 등장 순서를 보존한다.
pub(crate) fn dedup_targets(targets: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    targets
        .into_iter()
        .filter(|t| seen.insert(t.clone()))
        .collect()
}

/// 사라진 세션을 향한 열린 작업안이 유효한 척 남지 않게 만료시킨다. 잠금 순서는 컨텍스트 먼저, 작업안 나중.
pub(crate) fn invalidate_for_target(map: &mut HashMap<String, Operation>, target: &str) -> usize {
    let mut changed = 0;
    for op in map.values_mut() {
        if op.state.is_open() && op.targets.iter().any(|t| t == target) {
            op.state = OperationState::Expired;
            changed += 1;
        }
    }
    changed
}
