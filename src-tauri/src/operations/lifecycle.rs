//! 실행 상태 전이(순수).
//!
//! 불변식: [`approve`] 는 순수 전이일 뿐 — 부르는 곳은 승인 몸 `approval::approve_in_with` 하나다(MCP 아님).
//! `approval_method` 는 감사 기록과 **같은 값**(`"manual"`·`"auto"`)을 찍는다.
//! 승인 · 취소는 MCP 도구가 아니다. 실행기는 저장된 작업안을 `operation_id` 로 읽을 뿐 명령 문자열을 다시 받지 않는다(AI 재주입 차단).

use std::collections::HashMap;

use crate::i18n::tr;

use super::*;

pub(crate) fn approve(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
    method: &str,
) -> Result<Operation, String> {
    let op = map.get_mut(operation_id).ok_or_else(
        || tr!(ko: "그런 작업안이 없습니다: {operation_id}", en: "Task plan not found: {operation_id}"),
    )?;
    match op.state {
        OperationState::AwaitingApproval => {
            op.state = OperationState::Approved;
            op.approval_method = Some(method.to_string());
            Ok(op.clone())
        }
        OperationState::Draft => Err(tr!(
            ko: "아직 검토 요청되지 않은 작업안입니다",
            en: "This task plan has not been sent for review yet",
        )),
        OperationState::Rejected => Err(tr!(
            ko: "거절된 작업안은 승인할 수 없습니다",
            en: "A rejected task plan cannot be approved",
        )),
        OperationState::Expired => Err(tr!(
            ko: "만료된 작업안은 승인할 수 없습니다",
            en: "An expired task plan cannot be approved",
        )),
        OperationState::Approved | OperationState::Running => Err(tr!(
            ko: "이미 승인/실행 중인 작업안입니다",
            en: "This task plan is already approved or running",
        )),
        OperationState::Succeeded
        | OperationState::Partial
        | OperationState::Failed
        | OperationState::Cancelled => Err(tr!(
            ko: "이미 실행이 끝난 작업안입니다",
            en: "This task plan has already finished running",
        )),
    }
}

pub(crate) fn mark_running(map: &mut HashMap<String, Operation>, operation_id: &str) {
    if let Some(op) = map.get_mut(operation_id) {
        if op.state == OperationState::Approved {
            op.state = OperationState::Running;
        }
    }
}

fn is_finished(state: OperationState) -> bool {
    matches!(
        state,
        OperationState::Rejected
            | OperationState::Expired
            | OperationState::Succeeded
            | OperationState::Partial
            | OperationState::Failed
            | OperationState::Cancelled
    )
}

pub(super) const FINISHED_RETENTION: usize = 100;

/// 열린 · 실행 중 작업안은 세지도 지우지도 않는다 — 지우면 화면 · 실행기가 사라진다.
pub(crate) fn finished_to_evict(map: &HashMap<String, Operation>, keep: usize) -> Vec<String> {
    let mut finished: Vec<(&str, u64)> = map
        .iter()
        .filter(|(_, op)| is_finished(op.state))
        .map(|(id, op)| (id.as_str(), op.created_at))
        .collect();
    if finished.len() <= keep {
        return Vec::new();
    }
    finished.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(a.0)));
    finished
        .into_iter()
        .skip(keep)
        .map(|(id, _)| id.to_string())
        .collect()
}

pub(crate) fn finish(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
    final_state: OperationState,
) {
    if let Some(op) = map.get_mut(operation_id) {
        op.state = final_state;
    }
}

/// 스위치를 올린 사이 이미 봉해진 작업안에도 찍는다(취소가 그 봉인에 닿았을 수 있다) — 집계 상태는 건드리지 않는다.
pub(crate) fn mark_cancelled_by_user(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
) -> bool {
    match map.get_mut(operation_id) {
        Some(op)
            if !matches!(
                op.state,
                OperationState::Draft
                    | OperationState::AwaitingApproval
                    | OperationState::Rejected
                    | OperationState::Expired
            ) =>
        {
            op.cancelled_by_user = true;
            true
        }
        _ => false,
    }
}
