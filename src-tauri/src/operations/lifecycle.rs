//! 실행 상태 전이(순수) — 승인 [`approve`] · [`mark_running`] · 봉인 [`finish`] · 보존 한도 [`finished_to_evict`] ·
//! 사람의 취소 표식 [`mark_cancelled_by_user`].
//!
//! 불변식: [`approve`] 는 순수 전이일 뿐 — 부르는 곳은 Tauri 명령 `approval::approve_operation` 하나다(MCP 아님).
//! `approval_method` 는 감사 기록과 **같은 값**(`"manual"`·`"auto"`)을 찍는다.

use std::collections::HashMap;

use crate::i18n::tr;

use super::*;

// ===========================================================================
// 단계 9 — 실행 브로커. 상태기계 전이 · 대상별 결과 · 분류·집계 (모두 순수, 테스트 대상).
//
// ⛔ 승인·취소는 **Tauri 명령 전용**이고 MCP 도구가 아니다([`approve_operation`]·
// [`cancel_operation`]). executor 는 저장된 작업안의 `operation_id` 로 `command`·`targets` 를
// 읽을 뿐, 명령 문자열을 다시 받지 않는다(AI 재주입 차단 · 보안 불변).
// ===========================================================================

/// 검토 대기 작업안을 **승인**한다(AwaitingApproval→Approved) — 순수 전이.
///
/// 승인은 여기서 상태 표식 하나만 바꾼다. 실제 실행(Running 전이 + exec)은 executor 태스크가
/// 잇는다. AwaitingApproval 이 아니면 오류다 — 초안은 아직 검토 요청 전이고, 나머지는 이미
/// 승인/실행/종료된 것이라 두 번 승인하지 않는다.
///
/// `method` 는 승인 방식(`"manual"`·`"auto"`) — 감사 기록과 같은 값을 [`Operation::approval_method`]
/// 에 찍는다(전이가 성공할 때만).
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

/// 승인된 작업안을 **실행 중**으로 옮긴다(Approved→Running) — executor 가 시작할 때 부른다.
pub(crate) fn mark_running(map: &mut HashMap<String, Operation>, operation_id: &str) {
    if let Some(op) = map.get_mut(operation_id) {
        if op.state == OperationState::Approved {
            op.state = OperationState::Running;
        }
    }
}

/// 끝난(종료 상태) 작업안인가 — 보존 한도가 세고 지우는 대상.
///
/// **Approved·Running 은 끝난 게 아니다**(실행 중) — 열린 상태(Draft·AwaitingApproval)와 함께
/// 보존 한도에서 제외한다. 종료 상태만: 거절·만료·성공·부분·실패·취소.
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

/// 보존 한도(백로그 #7) — 관제판을 오래 열어 둔 운영에서 끝난 작업안이 무한정 쌓이지 않게
/// 최근 N 개만 남긴다. `list_recent` 복구에 넉넉한 값이다.
pub(super) const FINISHED_RETENTION: usize = 100;

/// 끝난 작업안 중 **최근 `keep` 개를 넘긴 오래된 것들의 id** 를 돌려준다 — 순수 함수(테스트 대상).
///
/// created_at 최신순(동시각은 id 역순)으로 세어 `keep` 개까지 남기고 나머지를 evict 대상으로 준다.
/// **열린·실행 중 작업안(Draft·AwaitingApproval·Approved·Running)은 세지도 지우지도 않는다** —
/// 검토 대기·실행 중을 지우면 화면·executor 가 사라진다. [`finalize`] 가 이걸로 ops·results·cancels
/// 를 함께 정리한다.
pub(crate) fn finished_to_evict(map: &HashMap<String, Operation>, keep: usize) -> Vec<String> {
    let mut finished: Vec<(&str, u64)> = map
        .iter()
        .filter(|(_, op)| is_finished(op.state))
        .map(|(id, op)| (id.as_str(), op.created_at))
        .collect();
    if finished.len() <= keep {
        return Vec::new();
    }
    // 최신순 — created_at 내림차순, 동시각은 id 내림차순(결정적).
    finished.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(a.0)));
    finished
        .into_iter()
        .skip(keep)
        .map(|(id, _)| id.to_string())
        .collect()
}

/// 실행이 끝났다 — 집계 상태로 봉한다(Running→final). executor 가 마지막에 부른다.
pub(crate) fn finish(
    map: &mut HashMap<String, Operation>,
    operation_id: &str,
    final_state: OperationState,
) {
    if let Some(op) = map.get_mut(operation_id) {
        op.state = final_state;
    }
}

/// 사람의 취소를 찍는다 — 순수 전이(테스트 대상). 도는(승인됨·실행 중) 작업안이거나, 스위치를 올린
/// 사이 이미 봉해진 작업안에도 찍는다(취소가 그 봉인에 닿았을 수 있다 — 집계 상태는 건드리지 않는다).
/// 초안·대기·거절·만료는 실행된 적이 없어 찍지 않는다. 찍었으면 `true`.
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
