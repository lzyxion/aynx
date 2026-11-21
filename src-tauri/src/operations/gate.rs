//! 승인 게이트(순수).
//!
//! 불변식: **수동과 자동은 다른 문을 지난다** — caps 는 둘 다, 정책·cwd 메타문자·validate·대상별 자동 실행 권한·
//! 빈도 한도는 `method == "auto"` 만. 프런트가 auto 로 불러도 Rust 가 여기서 독립적으로 다시 본다.
//! 대상별 자동 실행 권한은 **창 타일도 예외가 없다** — 원격 호스트의 단계가 'Auto' 인
//! 대상만 통과하고, 로컬·호스트 목록 밖 대상이 하나라도 섞이면 사람 승인으로 남는다.
//!
//! **모두 승인**: 대상이 **전부** 단계 'YOLO' 인 작업안(원격 호스트 · DB 연결)은 자동 승인이 명령 정책(허용 목록 · 위험 · 메타문자 ·
//! 파이프 · cwd · validate)과 대상별 자동 실행 문 · 빈도 한도를 건너뛴다. 그래도 남는 것: caps · 전체 스위치 `[automation] auto_approve` ·
//! 만료 · 감사 · 신원 스냅샷(호스트는 접속 때 · DB 는 실행 직전 재판정). 하나라도 'YOLO' 가 아니면 보통 자동 승인 규칙이다(docs/log/2026-10-23-approve-all.md).

use crate::i18n::tr;

/// 자동 승인 시각들의 슬라이딩 창 — 수동 승인은 건드리지 않는다.
#[derive(Default)]
pub struct AutoApprovalRate(pub std::sync::Mutex<std::collections::VecDeque<u64>>);

/// 초과면 넣지 않는다 — 거부된 승인이 칸을 먹지 않게 승인 몸이 모든 게이트를 지난 마지막 문에서만 부른다.
pub(crate) fn rate_limit_admit(
    stamps: &mut std::collections::VecDeque<u64>,
    now_ms: u64,
    max: u32,
    window_ms: u64,
) -> bool {
    let cutoff = now_ms.saturating_sub(window_ms);
    while let Some(&front) = stamps.front() {
        if front < cutoff {
            stamps.pop_front();
        } else {
            break;
        }
    }
    if (stamps.len() as u64) < max as u64 {
        stamps.push_back(now_ms);
        true
    } else {
        false
    }
}

/// 자동 · 수동 공통 하드 경계 — 사람이 큰 작업안을 눌러도 여기서 막힌다.
pub(crate) fn exceeds_limits(
    targets: usize,
    concurrency: u32,
    max_targets: u32,
    max_concurrency: u32,
) -> Option<String> {
    if targets > max_targets as usize {
        return Some(tr!(
            ko: "대상 {targets}개가 자동화 상한(최대 {max_targets}개)을 넘어 승인할 수 없습니다",
            en: "{targets} targets exceed the automation limit (max {max_targets}) — cannot approve",
        ));
    }
    if concurrency > max_concurrency {
        return Some(tr!(
            ko: "동시 실행 {concurrency}가 자동화 상한(최대 {max_concurrency})을 넘어 승인할 수 없습니다",
            en: "Concurrency {concurrency} exceeds the automation limit (max {max_concurrency}) — cannot approve",
        ));
    }
    None
}

/// 수동은 caps 만 본다 — 사람이 권위라 위험 명령도 승인할 수 있다(위험 판정은 UI 자문).
/// 자동은 프런트가 무엇을 보냈든 정책 · cwd · validate 를 Rust 가 독립적으로 다시 본다.
pub(crate) fn approval_reject_reason(
    command: &str,
    targets: usize,
    concurrency: u32,
    cwd: Option<&str>,
    validate: Option<&str>,
    method: &str,
    prefs: &crate::settings::AutomationPrefs,
) -> Option<String> {
    if let Some(reason) = exceeds_limits(
        targets,
        concurrency,
        prefs.max_targets,
        prefs.max_concurrency,
    ) {
        return Some(reason);
    }
    if method == "auto" {
        if !crate::policy::should_auto_approve(command, targets, prefs) {
            return Some(tr!(
                ko: "자동 승인 정책에 맞지 않아 거부했습니다 (위험·allowlist·메타문자·상한 중 하나)",
                en: "Rejected — does not match the auto-approval policy (risk, allowlist, metacharacter, or limit)",
            ));
        }
        // cwd 는 명령이 아니라 디렉터리 문자열이라 구획 분해와 달리 체이닝을 허용할 이유가 없다 — 메타문자면 거부.
        if let Some(dir) = cwd {
            if crate::policy::has_shell_metachar(dir) {
                return Some(tr!(
                    ko: "자동 승인은 작업 디렉터리에 셸 메타문자가 있으면 거부합니다",
                    en: "Auto-approval rejects a working directory that contains shell metacharacters",
                ));
            }
        }
        // validate 도 AI 가 준 명령이다 — 본 명령과 같은 술어를 독립적으로 통과해야 한다(더 느슨하지도 빡빡하지도 않게).
        if let Some(v) = validate {
            if !crate::policy::command_passes_auto_policy(v, prefs) {
                return Some(tr!(
                    ko: "검증 명령이 자동 승인 정책에 맞지 않습니다",
                    en: "The validation command does not match the auto-approval policy",
                ));
            }
        }
    }
    None
}

/// `method=="auto"` 전용 — allowlist 명령이라도 대상마다 호스트 단계 'Auto' 가 있어야 무인 실행이 된다.
/// 로컬 타일 · 별칭 없는 원격 타일 · 거울에 없는 id 는 거부한다(창 대상도 이 문을 건너뛰지 않는다).
pub(crate) fn auto_execute_reject_reason(
    targets: &[String],
    ctx: &std::collections::HashMap<String, crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Option<String> {
    for id in targets {
        // DB 대상은 허용 목록 자동 실행이 없다 — 승인 몸이 먼저 막지만 이 문도 막는다.
        if super::is_db_target(id) {
            return Some(tr!(
                ko: "DB 작업안은 연결이 'YOLO' 일 때만 자동 승인합니다",
                en: "Database task plans are auto-approved only when the connection is set to 'YOLO'",
            ));
        }
        if let Some(alias) = crate::routing::delegated_alias_of(id) {
            if !delegation.auto_execute_granted(alias) {
                return Some(tr!(
                    ko: "Auto 권한이 없는 호스트가 대상에 있어 자동 승인할 수 없습니다: {alias}",
                    en: "A target host without the Auto AI permission is included — cannot auto-approve: {alias}",
                ));
            }
            continue;
        }
        match ctx.get(id) {
            Some(c) if crate::context::ai_auto_executable(c, delegation) => {}
            Some(c) if c.kind == "ssh" && c.host_alias.is_some() => {
                let alias = c.host_alias.as_deref().unwrap_or_default();
                return Some(tr!(
                    ko: "Auto 권한이 없는 호스트가 대상에 있어 자동 승인할 수 없습니다: {alias}",
                    en: "A target host without the Auto AI permission is included — cannot auto-approve: {alias}",
                ));
            }
            _ => {
                return Some(tr!(
                    ko: "호스트 AI 권한이 없는 대상(로컬 타일·호스트 목록 밖 타일)이 있어 자동 승인할 수 없습니다",
                    en: "A target without a host AI permission (a local tile or a tile whose host is not in the host list) is included — cannot auto-approve",
                ));
            }
        }
    }
    None
}

/// 대상이 전부 'YOLO' 인가 — 대상이 없거나 · DB 사실이 없거나 · 로컬 타일 · 별칭 없는 원격 · 거울에 없는 id 가 섞이면 거짓(닫힌 쪽).
/// DB 작업안은 실행 직전 재판정과 같은 `db_recheck` 를 지나야 한다.
pub(crate) fn approve_all_plan(
    targets: &[String],
    db: Option<&super::DbPlan>,
    ctx: &std::collections::HashMap<String, crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
    db_facts: Option<&super::db_exec::DbFacts>,
) -> bool {
    if targets.is_empty() {
        return false;
    }
    if let Some(plan) = db {
        return db_facts.is_some_and(|f| {
            super::db_exec::db_recheck(plan, f)
                .is_ok_and(|g| g.level() >= crate::delegation::database::DbAiLevel::All)
        });
    }
    targets.iter().all(|id| {
        if super::is_db_target(id) {
            return false;
        }
        if let Some(alias) = crate::routing::delegated_alias_of(id) {
            return delegation.approve_all_granted(alias);
        }
        ctx.get(id).is_some_and(|c| crate::context::ai_approve_all(c, delegation))
    })
}

/// 모두 승인은 caps 와 전체 스위치만 본다 — 스위치가 꺼져 있으면 'YOLO' 대상도 사람을 기다린다.
pub(crate) fn approve_all_reject_reason(
    targets: usize,
    concurrency: u32,
    prefs: &crate::settings::AutomationPrefs,
) -> Option<String> {
    if let Some(reason) = exceeds_limits(targets, concurrency, prefs.max_targets, prefs.max_concurrency) {
        return Some(reason);
    }
    if !prefs.auto_approve {
        return Some(tr!(
            ko: "자동 승인이 꺼져 있어(설정 › 자동 승인) 'YOLO' 대상도 사람 승인을 기다립니다",
            en: "Auto-approval is off (Settings › Auto-approval), so even 'YOLO' targets wait for a person",
        ));
    }
    None
}
