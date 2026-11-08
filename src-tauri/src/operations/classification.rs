//! 분류·집계(순수) — exec 산출물 → 대상 상태 [`classify`] · canary 진행 [`canary_proceed`] · 검증 실패 사유
//! [`validation_abort_reason`] · 집계 [`aggregate`].
//!
//! 불변식: 시작 뒤 취소는 **상태 불명(Unknown)** 이지 깨끗한 취소가 아니다 — 집계도 그것을 `Cancelled` 로 뭉개지 않는다.

use crate::i18n::tr;

use super::*;

/// exec 산출물([`crate::ssh::ExecOutcome`])을 대상 상태·오류분류로 **분류**한다 — 순수 함수.
///
/// exec 원시는 사실만 담고 판정하지 않는다(전송로는 성공/실패를 모른다). 여기서 앱의 뜻을 매긴다:
/// 오류(채널 못 엶)·타임아웃·취소·exit 코드 순으로 본다.
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
        // 시작 후 취소(launched)는 깨끗한 취소가 아니라 **상태 불명** — 원격 명령이 이미 나갔으므로
        // 계속 돌 수 있다. 시작 전 취소(!launched)만 Cancelled(아무것도 실행되지 않음) — 슬라이스 A5.
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

/// canary 첫 대상 결과를 보고 **나머지를 돌릴지** 정한다 — 순수 함수.
///
/// 첫 대상이 exit 0(Succeeded)일 때만 나머지로 나아간다. 그 밖(실패·타임아웃·취소·대상 없음)은
/// 나머지를 돌리지 않고 전부 취소한다 — canary 의 존재 이유다(한 대에서 터지는 명령을 전부에
/// 뿌리지 않는다).
pub(crate) fn canary_proceed(first: TargetState) -> bool {
    first == TargetState::Succeeded
}

/// canary 사후 검증(A4d) 실패 시 나머지 대상에 실릴 **취소 사유**를 만든다 — 순수 함수(테스트 대상).
///
/// 검증 프로브의 산출물이 없으면(canary 대상을 살아 있는 SSH 로 못 풀었으면) 그 사실을, 있으면
/// [`classify`] 로 사람이 읽는 짧은 사유(종료 코드·타임아웃·취소·전송 오류)를 뽑아 붙인다.
/// canary 자신은 방금 성공했으므로 이 사유는 **나머지** 대상의 `error_class` 에만 실린다.
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

/// 대상 상태들 → 작업안 집계 상태 — 순수 함수.
///
/// 하나라도 성공하고 전부 성공이면 Succeeded, 일부만 성공이면 Partial(Unknown 은 "성공 아님"으로
/// 센다), 성공이 없으면 Failed. 성공이 없고 **남은 게 전부 취소**면 Cancelled(사용자가 멈춘 것이지
/// 실패한 게 아니다).
///
/// **상태 불명(Unknown)이 섞이면 깨끗한 취소로 보지 않는다**(슬라이스 A5): 성공이 없고 실패도 없이
/// 취소·불명만 남았는데 그 중 하나라도 Unknown 이면 `Cancelled` 가 아니라 **`Partial`** 이다 —
/// "정직하게 불확실"(원격에서 무언가 돌았을 수 있다)을 깨끗한 취소로 뭉개지 않는다. 새 집계 상태를
/// 만들지 않고 기존 Partial 에 얹는다(실행 뷰·감사가 이미 이해하는 "일부는 확실치 않음").
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
    // 성공 없음. 전부 취소면 깨끗한 취소.
    if states.iter().all(|s| *s == TargetState::Cancelled) {
        return OperationState::Cancelled;
    }
    // 실패 없이 취소·불명만 남았고 그 중 Unknown 이 하나라도 있으면(위 all-Cancelled 를 통과했으니
    // 반드시 Unknown 이 있다) 깨끗한 취소가 아니라 Partial(정직히 불확실).
    if states
        .iter()
        .all(|s| matches!(s, TargetState::Cancelled | TargetState::Unknown))
    {
        return OperationState::Partial;
    }
    OperationState::Failed
}
