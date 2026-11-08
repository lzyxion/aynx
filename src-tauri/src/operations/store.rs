//! 순수 저장소 연산(검토 단계) — 초안 [`create_plan`] · 멱등 키 [`find_by_idempotency_key`] · 검토 요청 [`request`] ·
//! 읽기·목록 · 거절 [`reject`] · 대상 수정 [`modify_targets`]/[`dedup_targets`] · 대상 무효화 [`invalidate_for_target`].
//!
//! 불변식: 여기엔 **실행이 없다**(원시 `send_command` 도 없다) — 상태 표식과 대상 목록만 바꾼다. 명령·방식은 검토에서
//! 못 고친다(사용자는 "어디에" 만 좁힌다).

use std::collections::HashMap;

use crate::i18n::tr;

use super::*;

// ---------------------------------------------------------------------------
// 순수 저장소 연산 (테스트 대상) — 명령·MCP 핸들러는 잠금만 잡고 이쪽을 부른다.
// ---------------------------------------------------------------------------

/// 초안을 만들어 저장한다(→[`OperationState::Draft`]). 저장된 작업안을 그대로 돌려준다.
///
/// **부작용은 맵에 넣는 것뿐**이다 — 검토 요청도, 실행도 아니다. 검토 요청은 [`request`] 가,
/// (없는) 실행은 어디에도 없다.
#[allow(clippy::too_many_arguments)]
// 백로그 #7 **완료**(2026-09-21): 대기 작업안 TTL 은 [`expire_stale`] 이 한다 — 오래된 Draft 는
// `created_at` 기준으로, AwaitingApproval 은 [`request`] 가 찍은 `expires_at` 기준으로 만료된다
// (타이머 없이 읽기·전이 경로에서 그 자리에서 — docs/log/2026-09-21-approval-ttl.md). 멱등 키도
// 구현됨(`idempotency_key` + [`find_by_idempotency_key`]: AI 재시도로 같은 작업안이 중복 저장·중복
// 실행되지 않게). 끝난 작업안 보존 한도(finished_to_evict)가 주된 누수를 막고, evict 되면 그 키도
// 함께 사라진다 — 별도 색인·프룬 로직이 없다.
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
    // 앱 분석은 원문으로 **지금** 매긴다 — AI 의 선언(`declare`)과 무관하게(옛 꼴로 만든 작업안도 분석은 갖는다).
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
        // 초안은 아직 **요청되지 않았다** — 두 시각 다 비어 있다. 그래도 만료는 면하지 못한다:
        // 검토 요청 없이 남은 초안은 [`expire_stale`] 이 `created_at` + TTL 로 거둔다.
        requested_at: None,
        expires_at: None,
        title,
        reason,
        idempotency_key,
        // 승인 전 — [`approve`] 가 찍는다.
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

/// **DB 쓰기 작업안**의 초안(3b)을 저장한다 — 대상은 `db:<연결 id>` 하나, 실행 방식 칸은 고정(`mode = "db"` · `strategy = "transaction"` ·
/// 동시 1 · 시간 = 문장마다 시한). `command` 는 문장들을 `;` 와 줄바꿈으로 이은 글(표시 · 감사 · 옛 화면용). 부작용은 맵에 넣는 것뿐이다.
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

/// AI 가 작업안에 붙인 **선언**(승인 요약) — MCP 두 도구가 저장 직후 [`declare`] 로 얹는다.
pub(crate) struct Declaration {
    /// 다듬은 설명([`super::analysis::clean_summary`] 를 지난 것)
    pub summary: String,
    pub effect: super::analysis::Effect,
    /// 요청한 AI 타일의 이름표(알 때만)
    pub requested_by: Option<String>,
    /// 대상 id → 이름(알 때만)
    pub target_labels: std::collections::BTreeMap<String, String>,
}

/// 저장된 작업안에 선언을 얹고 **선언과 분석이 어긋나는가**를 매긴다(분석이 없으면 어긋남 없음). 고친 작업안을 돌려준다.
pub(crate) fn declare(map: &mut HashMap<String, Operation>, operation_id: &str, d: Declaration) -> Option<Operation> {
    let op = map.get_mut(operation_id)?;
    op.mismatch = op.analysis.as_ref().is_some_and(|a| super::analysis::mismatch(d.effect, a.effect));
    // 줄마다도 — 카드가 선언보다 센 줄만 따로 물들인다(분석은 선언을 모르므로 여기서 매긴다).
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

/// DB 작업안의 문장들을 한 글로(`문장;` 을 줄마다).
pub(crate) fn db_plan_text(plan: &DbPlan) -> String {
    plan.statements.iter().map(|s| format!("{};", s.sql)).collect::<Vec<_>>().join("\n")
}

/// 멱등 키로 기존 작업안을 찾는다 — 순수 함수(테스트 대상). 같은 키를 가진 **첫** 작업안을 돌려준다.
///
/// 상태를 가리지 않는다(draft·awaitingApproval·approved·running·finished 전부 대상) — 요점은 AI 의
/// 재시도가 **어디에 있든 같은 작업안을 그대로 다시 보게** 하는 것이다. 색인 없이 (작은·메모리 전용)
/// 저장소를 훑는다: evict 로 사라진 작업안은 키도 함께 사라지므로 프룬 로직이 필요 없다.
/// [`crate::mcp`] 의 `create_execution_plan` 이 저장 전에 이걸로 재시도를 걸러 낸다.
pub(crate) fn find_by_idempotency_key<'a>(
    map: &'a HashMap<String, Operation>,
    key: &str,
) -> Option<&'a Operation> {
    map.values()
        .find(|op| op.idempotency_key.as_deref() == Some(key))
}

/// 검토를 요청한다(Draft→AwaitingApproval). **실행이 아니다** — 상태 표식 하나 바꿀 뿐이다.
///
/// 이미 AwaitingApproval 이면 그대로 둔다(멱등 — 시각도 **다시 찍지 않는다**: 재시도로 만료
/// 시계가 연장되면 TTL 이 뜻을 잃는다). 종료 상태(Rejected/Expired)는 되살리지 않는다.
///
/// `now_ms`·`ttl_ms` 는 만료 시계다: `requested_at = now`, `expires_at = now + ttl`
/// (`ttl_ms == 0` 이면 **만료 없음** → `None`). 판정은 [`expire_stale`] 이 한다.
///
/// **오류 문구는 영어 리터럴이다** — 이 함수를 부르는 곳은 MCP `request_execution` 하나뿐이고
/// (Tauri 명령에는 짝이 없다), 그 오류를 읽는 것은 사람이 아니라 모델이다([`crate::i18n`] 머리말).
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
        OperationState::AwaitingApproval => {} // 멱등 — 이미 검토 대기다(시계도 그대로).
        OperationState::Rejected => {
            return Err("A rejected task plan cannot be requested again".into())
        }
        OperationState::Expired => {
            return Err("An expired task plan cannot be requested again".into())
        }
        // 승인·실행이 시작됐거나 끝난 작업안은 다시 검토 요청할 수 없다(단계 9).
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

/// 작업안 하나를 읽는다. 없으면 `None`.
pub(crate) fn get<'a>(
    map: &'a HashMap<String, Operation>,
    operation_id: &str,
) -> Option<&'a Operation> {
    map.get(operation_id)
}

/// 검토 대기(AwaitingApproval) 작업안들 — **오래된 것부터**([`Operation::created_at`] 오름차순,
/// 동시각은 id 로). 검토 UI 의 **카드 목록**이 여기서 온다(먼저 들어온 것을 먼저 본다).
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

/// 대기 아닌 작업안들 — **최신순**([`Operation::created_at`] 내림차순, 동시각은 id 로).
/// 초안(요청 전)·거절·만료가 여기 든다(검토 UI 의 "최근" 이력).
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

/// 거절한다(→[`OperationState::Rejected`]). 열린 상태(Draft/AwaitingApproval)에서만 뜻이 있다.
///
/// 이미 Rejected 면 멱등. 만료된 것은 거절할 것도 없다(오류) — 상태를 되살리지 않는다.
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
        OperationState::Rejected => {} // 멱등.
        OperationState::Expired => {
            return Err(tr!(ko: "만료된 작업안입니다", en: "This task plan has expired"))
        }
        // 승인·실행이 시작된 뒤에는 거절이 아니라 **취소**다(단계 9 · [`cancel_operation`]).
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

/// 대상 목록을 고친다(검토 중 사용자가 대상을 빼거나 바꾼다). 열린 상태에서만.
///
/// **명령·방식은 못 고친다** — 계획의 뼈대는 AI 가 세운 그대로 두고, 사용자는 "어디에" 만
/// 좁힐 수 있게 한다(검토는 승인이 아니라 걸러 내기다).
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
    // DB 작업안의 대상은 연결 하나다 — 바꾸거나 더할 대상이 없다(다른 연결로 옮기면 검토한 것과 다른 일이 된다).
    if op.db.is_some() {
        return Err(tr!(
            ko: "DB 작업안은 대상을 고칠 수 없습니다(연결 하나 — 거절하고 다시 만들게 하세요)",
            en: "A database task plan's target cannot be changed (one connection — reject it and have a new one made)",
        ));
    }
    // 중복은 실행을 두 번 돌리거나 결과 행렬 키를 덮어쓴다 — 첫 등장 순서로 정리한다.
    op.targets = dedup_targets(targets);
    Ok(op.clone())
}

/// 대상 목록을 **첫 등장 순서를 보존**하며 중복 제거한다 — **순수 함수**(테스트 대상).
///
/// 작업안 대상은 같은 세션(streamId)을 두 번 담을 이유가 없다 — 중복은 그 대상에 명령을 두 번
/// 돌리거나 결과 행렬(streamId 키)을 덮어쓴다. [`crate::mcp`] 의 `create_execution_plan`(옵트인
/// 필터 뒤)과 [`modify_targets`] 가 함께 쓴다.
pub(crate) fn dedup_targets(targets: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    targets
        .into_iter()
        .filter(|t| seen.insert(t.clone()))
        .collect()
}

/// 한 대상 세션이 옵트아웃/닫혔다 — 그를 참조하는 **열린** 작업안을 [`OperationState::Expired`]
/// 로 바꾼다. 바뀐 개수를 돌려준다.
///
/// 종료 상태(Rejected/Expired)는 건드리지 않는다. 프라이버시·안전의 그물이다: 사라진 세션을
/// 향한 계획서가 검토 목록에 유효한 척 남지 않게 한다. [`crate::context`] 의 opt-out/drop
/// 경로가 부른다(컨텍스트 잠금 안쪽에서 — 락 순서: 컨텍스트 먼저, 작업안 나중).
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
