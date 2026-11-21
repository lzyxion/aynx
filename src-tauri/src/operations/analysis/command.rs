//! 셸 명령 · 셸 작업안 분석의 조립.

use super::command_lines::command_lines;
use super::shell_effect::analyze_flat;
use super::types::{stronger, PlanAnalysis, Verdict};

/// 2줄 이상이면 줄별 분석([`PlanAnalysis::lines`])도 단다.
pub(crate) fn analyze_command(cmd: &str) -> PlanAnalysis {
    let mut a = analyze_flat(cmd);
    a.lines = command_lines(cmd);
    a
}

/// 검증 명령도 canary 대상에서 돌므로 효과 · sudo 는 합치고, 줄(`lines`) · 프로그램 목록은 본 명령의 것만.
pub(crate) fn analyze_plan(command: &str, validate: Option<&str>) -> PlanAnalysis {
    let mut a = analyze_command(command);
    if let Some(v) = validate.filter(|v| !v.trim().is_empty()) {
        let b = analyze_flat(v);
        a.sudo |= b.sudo;
        let merged = stronger(
            Verdict { effect: a.effect, cause: a.cause.take() },
            Verdict { effect: b.effect, cause: b.cause },
        );
        a.effect = merged.effect;
        a.cause = merged.cause;
    }
    a
}
