//! 승인 게이트 — caps 하드 경계([`exceeds_limits`]) · 승인 거부 판정([`approval_reject_reason`]) · 자동 실행 위임 확인
//! ([`auto_execute_reject_reason`]) · 자동 승인 빈도 한도([`AutoApprovalRate`]·[`rate_limit_admit`]).
//!
//! 불변식: **수동과 자동은 다른 문을 지난다** — caps 는 둘 다, 정책·cwd 메타문자·validate·대상별 자동 실행 권한·
//! 빈도 한도는 `method == "auto"` 만. 프런트가 auto 로 불러도 Rust 가 여기서 독립적으로 다시 본다.
//! 대상별 자동 실행 권한은 **창 타일도 예외가 없다**(2026-10-07) — 원격 호스트의 단계가 'Auto' 인
//! 대상만 통과하고, 로컬·호스트 목록 밖 대상이 하나라도 섞이면 사람 승인으로 남는다.
//!
//! **모두 승인**(2026-10-23 — [`approve_all_plan`], docs/log/2026-10-23-approve-all.md): 대상이 **전부** 단계 'YOLO' 인
//! 작업안(원격 호스트 · DB 연결)은 자동 승인이 명령 정책(허용 목록 · 위험 · 메타문자 · 파이프 · cwd · validate)과 대상별 자동
//! 실행 문 · 빈도 한도를 건너뛴다. 그래도 남는 것: caps([`exceeds_limits`]) · 전체 스위치 `[automation] auto_approve` · 만료 ·
//! 감사 · 신원 스냅샷(호스트는 접속 때 · DB 는 실행 직전 재판정). 하나라도 'YOLO' 가 아니면 예전 자동 승인 규칙 그대로다.

use crate::i18n::tr;

/// **자동 승인 빈도 한도 상태**(슬라이스 A4c) — 지난 자동 승인 시각(epoch ms)들의 슬라이딩 창.
///
/// 자동 승인만 여기에 흔적을 남긴다(수동 승인은 절대 건드리지 않는다). [`approve_operation`](super::approval::approve_operation) 이
/// 모든 게이트를 통과한 **마지막 문**으로 [`rate_limit_admit`] 을 부를 때만 잠기고, 창 길이를
/// 넘긴 옛 타임스탬프는 그때 앞에서 버려진다(무한히 자라지 않는다).
#[derive(Default)]
pub struct AutoApprovalRate(pub std::sync::Mutex<std::collections::VecDeque<u64>>);

/// **슬라이딩 윈도우 빈도 한도** — 순수 함수(테스트 대상).
///
/// `now_ms - window_ms` 보다 오래된 타임스탬프를 앞에서 버리고, 남은 수가 `max` 미만이면 `now_ms`
/// 를 뒤에 넣고 `true`(허용). `max` 이상이면 **넣지 않고** `false`(한도 초과) — 거부된 승인이
/// 슬롯을 소모하지 않게 부르는 쪽이 마지막 문에서만 이걸 부른다. `max==0` 이면 언제나 `false`
/// (설정은 1 로 자르지만 헬퍼 자체도 견고하게).
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

/// 자동·수동 **공통 하드 경계** — 대상 수·동시 실행이 상한을 넘으면 거부 사유를 돌려준다(순수).
///
/// 단계 10b(자동 승인)의 요점은 "허용 범위 밖은 거부"다. 그 경계를 [`approve_operation`](super::approval::approve_operation) 진입에서
/// **무조건** 강제하는데(설정 `[automation]` 상한을 읽어 이 함수로 판정), 자동뿐 아니라 **수동
/// 승인에도** 같이 걸린다 — 프런트 정책 평가기가 버그여도, 사람이 큰 작업안을 눌러도 여기서 막힌다.
/// `None` = 통과, `Some(사유)` = 거부(그 문자열이 그대로 명령 오류로 올라간다).
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

/// 승인 진입의 **거부 판정**(순수) — [`approve_operation`](super::approval::approve_operation) 이 상태 전이 전에 부른다.
///
/// 두 겹이다:
/// 1. **caps 하드 경계**([`exceeds_limits`]) — 수동·자동 공통. 대상 수·동시 실행 상한.
/// 2. **자동 승인 정책**([`crate::policy::should_auto_approve`]) — `method == "auto"` 일 때만.
///    프런트(`policy.ts`)가 auto 로 불러도 Rust 가 위험·구획 분해·allowlist·상한을 **독립적으로
///    다시** 본다: 프런트 정책 평가기 버그가 정책 밖 자동 승인을 뚫지 못한다(백엔드가 경계).
///
/// **수동**(`method != "auto"`)은 caps 만 본다 — 사람이 권위라 위험 명령도 승인할 수 있고, 위험
/// 판정은 UI 자문으로만 남는다. `None` = 통과, `Some(사유)` = 거부(그 문자열이 명령 오류로 올라간다).
///
/// `cwd`(백로그 #9): 실행 작업 디렉터리가 있으면 **자동 승인일 때만** 셸 메타문자가 없어야 한다
/// ([`crate::policy::has_shell_metachar`] 재사용) — 이상한 cwd 가 무인 자동 승인을 타고 넘어가지
/// 못하게 하는 배제의 연장이다. **이 규칙은 구획 분해(2026-09-16)로도 바뀌지 않는다** — `cwd` 는
/// 명령이 아니라 디렉터리 문자열이라 체이닝을 허용할 이유가 없다(오히려 AI 가 `cd x && …` 대신
/// `cwd` 를 쓰게 만드는 것이 이번 변경의 권고다). **수동은 cwd 를 이 검사로 막지 않는다**.
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
        // cwd 는 자동 승인에서 셸 메타문자가 없어야 한다 — 사람이 안 본 실행이 이상한 디렉터리
        // 문자열(치환·체이닝 등)을 타지 못하게. 수동은 사람이 권위라 이 검사를 걸지 않는다.
        if let Some(dir) = cwd {
            if crate::policy::has_shell_metachar(dir) {
                return Some(tr!(
                    ko: "자동 승인은 작업 디렉터리에 셸 메타문자가 있으면 거부합니다",
                    en: "Auto-approval rejects a working directory that contains shell metacharacters",
                ));
            }
        }
        // validate(A4d)는 canary 성공 뒤 canary 대상에서 도는 **AI 가 준 명령**이라, 자동 승인
        // 경로에서 실행되기 전에 본 명령과 **같은 안전 술어**를 독립적으로 통과해야 한다 —
        // 그래서 같은 함수([`crate::policy::command_passes_auto_policy`])를 쓴다: 구획 분해 성공
        // + 구획마다 위험 아님 + 구획마다 (평탄 allowlist OR 구조적 규칙). 명령이 체이닝을
        // 구획 단위로 통과할 수 있게 된 뒤에도 validate 의 바닥은 명령과 **똑같다**(더 느슨하지도
        // 빡빡하지도 않다). **수동은 걸지 않는다** — 사람이 카드에서 validate 를 보고 승인한다.
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

/// `method=="auto"` 전용 — 모든 대상이 **자동 실행 권한**을 받았는가(순수·테스트 대상).
///
/// [`approval_reject_reason`] 이 명령·상한·전역 정책(#10b)을 통과시킨 **뒤에** 대상별로 한 번 더
/// 보는 문이다: 자동 승인은 allowlist 명령이라도 대상마다 그 호스트의 누적 `read && propose &&
/// auto_execute`(단계 'Auto')가 있어야 무인 실행이 된다(A0 계약). 하나라도 없으면 사람이
/// 읽을 거부 사유를 돌려준다.
///
/// - `delegated:<alias>` id: 그 별칭의 권한(거울에 없어도 — 아직 접속 안 된 위임 대상).
/// - 창 타일 id: 거울(`ctx`)에서 찾아 [`crate::context::ai_auto_executable`] — 원격 타일은 호스트 별칭의
///   권한, **로컬 타일·별칭 없는 원격 타일·거울에 없는 id 는 거부**한다. 예전에는 창 대상이 이 문을
///   통째로 건너뛰어, 권한을 하나도 안 준 호스트의 타일도 자동 승인으로 무인 실행될 수 있었다.
///
/// `ctx` 는 정체성만 든 스냅샷이어도 된다([`crate::context::permission_snapshot`]).
/// `None` = 통과(모든 대상에 자동 실행 권한이 있거나 대상이 없다).
pub(crate) fn auto_execute_reject_reason(
    targets: &[String],
    ctx: &std::collections::HashMap<String, crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Option<String> {
    for id in targets {
        // DB 대상(쿼리 타일 3b)은 허용 목록으로 고르는 자동 실행이 없다 — 'YOLO' 가 아니면 사람 승인(승인 몸이 먼저 막지만 이 문도
        // 막는다). 모두 승인 작업안은 이 문에 오지 않는다([`approve_all_plan`] 이 먼저 넘긴다).
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

/// **이 작업안의 대상이 전부 'YOLO' 인가**(2026-10-23 — 순수 · 시험 대상). 참이면 자동 승인이 명령 정책 · 대상별 자동 실행 문 ·
/// 빈도 한도를 건너뛴다([`approve_in_with`](super::approval::approve_in_with) · 훑기 후보 [`super::auto::candidates`]).
///
/// - 대상이 없으면 거짓.
/// - **DB 작업안**(`db` 가 있다 — 대상은 `db:<id>` 하나): 실행 직전 재판정과 **같은 길**([`super::db_exec::db_recheck`] — 연결이
///   목록에 있고 · 신원 스냅샷이 맞고 · 만들 때의 대상과 같다)을 지나고 그 단계가 [`DbAiLevel::All`](crate::delegation::database::DbAiLevel::All)
///   일 때만. 사실(`db_facts`)이 없으면 거짓(닫힌 쪽).
/// - 원격 대상: `delegated:<alias>` 는 그 별칭의 [`approve_all_granted`](crate::delegation::Delegation::approve_all_granted), 창 타일은
///   거울의 호스트 별칭([`crate::context::ai_approve_all`]). 로컬 타일 · 별칭 없는 원격 · 거울에 없는 id · DB 대상이 섞이면 거짓.
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

/// 모두 승인 작업안의 **승인 판정**(순수) — caps 와 전체 스위치만 본다. `None` = 통과.
///
/// 명령 정책(허용 목록 · 위험 · 메타문자 · cwd · validate) · 대상별 자동 실행 문 · 빈도 한도는 **보지 않는다**(그것이 이 단계의 뜻이다).
/// 전체 스위치 `[automation] auto_approve` 가 꺼져 있으면 모두 승인 대상도 사람을 기다린다.
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
