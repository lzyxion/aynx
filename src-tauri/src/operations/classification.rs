//! 실행 결과의 분류 · 집계(순수).
//!
//! 불변식: 시작 뒤 취소는 **상태 불명(Unknown)** 이지 깨끗한 취소가 아니다 — 집계도 그것을 `Cancelled` 로 뭉개지 않는다.

use crate::i18n::tr;

use super::*;

pub(crate) fn classify(
    outcome: &crate::ssh::ExecOutcome,
) -> (TargetState, Option<i64>, Option<String>) {
    if let Some(err) = &outcome.error {
        return (
            TargetState::Failed,
            None,
            Some(tr!(ko: "전송 오류: {err}", en: "Transport error: {err}")),
        );
    }
    if outcome.cancelled {
        // 시작 후 취소는 상태 불명 — 원격 명령이 이미 나가 계속 돌 수 있다.
        if outcome.launched {
            return (
                TargetState::Unknown,
                None,
                Some(tr!(
                    ko: "취소됨 — 원격 명령이 계속 돌 수 있어 상태 불명",
                    en: "Cancelled — the remote command may still be running, so the outcome is unknown",
                )),
            );
        }
        return (
            TargetState::Cancelled,
            None,
            Some(tr!(
                ko: "시작 전 취소됨(원격에서 아무것도 실행되지 않음)",
                en: "Cancelled before start (nothing ran on the remote)",
            )),
        );
    }
    if outcome.timed_out {
        return (
            TargetState::TimedOut,
            None,
            Some(tr!(ko: "타임아웃", en: "Timed out")),
        );
    }
    match outcome.exit_code {
        Some(0) => (TargetState::Succeeded, Some(0), None),
        Some(n) => (
            TargetState::Failed,
            Some(n),
            Some(tr!(ko: "종료 코드 {n}", en: "Exit code {n}")),
        ),
        None => (
            TargetState::Failed,
            None,
            Some(tr!(ko: "종료 코드를 받지 못함", en: "No exit code received")),
        ),
    }
}

pub(crate) fn canary_proceed(first: TargetState) -> bool {
    first == TargetState::Succeeded
}

/// canary 사후 검증 실패 때 **나머지** 대상에 실릴 취소 사유(canary 자신은 성공으로 남는다).
pub(crate) fn validation_abort_reason(outcome: Option<&crate::ssh::ExecOutcome>) -> String {
    let detail = match outcome {
        None => tr!(
            ko: "canary 대상을 살아 있는 SSH 로 풀지 못함",
            en: "could not resolve the canary target to a live SSH connection",
        ),
        Some(o) => classify(o)
            .2
            .unwrap_or_else(|| tr!(ko: "알 수 없는 사유", en: "unknown reason")),
    };
    tr!(
        ko: "canary 검증 실패로 취소됨 (검증 {detail})",
        en: "Cancelled — canary validation failed (validation: {detail})",
    )
}

/// 취소 · 불명만 남고 Unknown 이 섞이면 `Cancelled` 가 아니라 `Partial` 이다 — 새 집계 상태를 만들지 않고 Partial 에 얹는다.
pub(crate) fn aggregate(states: &[TargetState]) -> OperationState {
    if states.is_empty() {
        return OperationState::Failed;
    }
    let succeeded = states
        .iter()
        .filter(|s| **s == TargetState::Succeeded)
        .count();
    if succeeded == states.len() {
        return OperationState::Succeeded;
    }
    if succeeded > 0 {
        return OperationState::Partial;
    }
    if states.iter().all(|s| *s == TargetState::Cancelled) {
        return OperationState::Cancelled;
    }
    if states
        .iter()
        .all(|s| matches!(s, TargetState::Cancelled | TargetState::Unknown))
    {
        return OperationState::Partial;
    }
    OperationState::Failed
}
