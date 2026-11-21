//! 대상 하나 실행.
//!
//! 불변식: **라우팅으로 살아 있는 SSH 로 풀리는 대상만** 실행한다. 모든 대상(창 타일·헤드리스)은 실행 직전
//! — 예산 대기·자동 접속 같은 긴 `.await` 를 **모두 지난 뒤**, `run_exec` 바로 앞에서 — 그 호스트의 누적
//! `read && propose` 를 다시 보고(로컬·별칭 없는 창 대상은 거부), 자동 접속은 헤드리스 접속 권한 아래서만
//! 선다(위임 범위 확인). 잠금은 **`.await` 위로 들고 가지 않는다**.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;

use super::*;

/// 승인과 실행 사이에 권한이 내려갈 수 있어 다시 본다 — 로컬 타일 · 별칭 없는 원격 타일 · 거울에 없는 id 는 거부.
/// 신원 · `connect` 는 재검사하지 않는다 — 신원은 접속 때 잠겼고 `connect` 는 새 접속만 지배한다.
pub(super) fn delegated_propose_still_live(
    stream_id: &str,
    ctx: Option<&crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> bool {
    if let Some(alias) = crate::routing::delegated_alias_of(stream_id) {
        return delegation.propose_granted(alias);
    }
    ctx.is_some_and(|c| crate::context::ai_plan_eligible(c, delegation))
}

pub(super) fn permission_recheck_failure(
    stream_id: &str,
    ctx: Option<&crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Option<TargetResult> {
    if delegated_propose_still_live(stream_id, ctx, delegation) {
        return None;
    }
    let mut r = TargetResult::pending();
    r.state = TargetState::Failed;
    r.started_at = Some(now_ms());
    r.ended_at = Some(now_ms());
    r.error_class = Some(tr!(
        ko: "AI 권한이 'Ask' 아래로 내려가 실행하지 않았습니다",
        en: "Not run — the host's AI permission dropped below 'Ask'",
    ));
    Some(r)
}

/// 위임 표는 캐시 없이 매번 파일에서 읽는다 — 방금 내린 권한이 곧바로 보이게.
fn recheck_permission_now(env: &OpEnv, stream_id: &str) -> Option<TargetResult> {
    let delegation = crate::delegation::Delegation::load_default();
    let ctx = env
        .ctx
        .lock()
        .ok()
        .and_then(|m| m.get(stream_id).map(crate::context::permission_view));
    permission_recheck_failure(stream_id, ctx.as_ref(), &delegation)
}

/// 분류 한 줄만 — 지문 · 키 경로 같은 원시 필드는 싣지 않는다.
fn ssh_open_error_msg(e: &crate::ssh::SshOpenError) -> String {
    use crate::ssh::SshOpenError::*;
    match e {
        HostKeyUnknown { .. } => tr!(
            ko: "미상 호스트 키 (무상호작용 접속은 자동 수락하지 않음)",
            en: "Unknown host key (a non-interactive connection never auto-accepts one)",
        ),
        HostKeyChanged { .. } => tr!(
            ko: "호스트 키 변경 (무상호작용 접속은 자동 수락하지 않음)",
            en: "Host key changed (a non-interactive connection never auto-accepts one)",
        ),
        PassphraseRequired { .. } => tr!(
            ko: "개인키에 암호구가 걸려 있음 (무상호작용 접속은 묻지 않음)",
            en: "The private key is passphrase-protected (a non-interactive connection never asks)",
        ),
        PasswordRequired { message, .. } | Auth { message, .. } | Other { message, .. } => {
            message.clone()
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_one_target(
    env: OpEnv,
    results: ResultStore,
    budget: Arc<tokio::sync::Semaphore>,
    cancel: Arc<AtomicBool>,
    operation_id: String,
    stream_id: String,
    command: String,
    timeout: Duration,
) -> TargetState {
    if cancel.load(Ordering::SeqCst) {
        let mut r = TargetResult::pending();
        r.state = TargetState::Cancelled;
        r.ended_at = Some(now_ms());
        r.error_class = Some(tr!(ko: "시작 전 취소됨", en: "Cancelled before start"));
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Cancelled;
    }

    // 권한 재검사 ① — 빠른 실패일 뿐이다. 아래 예산 대기 · 자동 접속이 긴 `.await` 라 진짜 관문은 재검사 ② 다.
    if let Some(r) = recheck_permission_now(&env, &stream_id) {
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Failed;
    }

    // 전역 예산 — canary 를 포함해 모든 대상이 이 길목을 지난다. 어떤 저장소 잠금도 잡기 전에 기다린다.
    let _budget_permit = budget.acquire().await;

    let mut ssh_id = {
        let m = env.routing.lock().ok();
        m.and_then(|m| crate::routing::resolve(&m, &stream_id))
    };

    // 위임 자동 접속 — connect 위임이 있고 신원이 일치하는 그 대상에만 붙는다(관문은 `connect_delegated`).
    if ssh_id.is_none() {
        if let Some(alias) = crate::routing::delegated_alias_of(&stream_id) {
            let delegation = crate::delegation::Delegation::load_default();
            if !delegation.connect_granted(alias) {
                let mut r = TargetResult::pending();
                r.state = TargetState::Failed;
                r.started_at = Some(now_ms());
                r.ended_at = Some(now_ms());
                r.error_class = Some(tr!(
                    ko: "위임 자동 연결 실패: connect 위임 없음",
                    en: "Delegated auto-connect failed: no connect delegation",
                ));
                store_and_emit(&env, &results, &operation_id, &stream_id, r);
                return TargetState::Failed;
            }
            match crate::server::ai::connect_delegated(&env.ctx, &env.routing, alias).await {
                Ok(_) => {
                    ssh_id = {
                        let m = env.routing.lock().ok();
                        m.and_then(|m| crate::routing::resolve(&m, &stream_id))
                    };
                }
                Err(e) => {
                    let mut r = TargetResult::pending();
                    r.state = TargetState::Failed;
                    r.started_at = Some(now_ms());
                    r.ended_at = Some(now_ms());
                    r.error_class = Some(tr!(
                        ko: "위임 자동 연결 실패: {why}",
                        en: "Delegated auto-connect failed: {why}",
                        why = ssh_open_error_msg(&e),
                    ));
                    store_and_emit(&env, &results, &operation_id, &stream_id, r);
                    return TargetState::Failed;
                }
            }
        }
    }

    let handle = ssh_id.and_then(live_exec_handle);
    let Some(handle) = handle else {
        let mut r = TargetResult::pending();
        r.state = TargetState::Failed;
        r.started_at = Some(now_ms());
        r.ended_at = Some(now_ms());
        r.error_class = Some(tr!(
            ko: "대상 없음(살아 있는 SSH 연결로 풀리지 않음)",
            en: "No target (does not resolve to a live SSH connection)",
        ));
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Failed;
    };

    // 권한 재검사 ② — 실행 직전. 여기서 `run_exec` 까지 `.await` 를 넣지 않는다(판정과 채널 열기 사이에 틈이 생긴다).
    if let Some(r) = recheck_permission_now(&env, &stream_id) {
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Failed;
    }

    let started = now_ms();
    {
        let mut r = TargetResult::pending();
        r.state = TargetState::Running;
        r.started_at = Some(started);
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
    }

    let outcome = crate::ssh::run_exec(handle, command, timeout, Arc::clone(&cancel)).await;
    let (state, exit_code, error_class) = classify(&outcome);
    let r = TargetResult {
        state,
        exit_code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        stdout_truncated: outcome.stdout_truncated,
        stderr_truncated: outcome.stderr_truncated,
        started_at: Some(started),
        ended_at: Some(now_ms()),
        error_class,
        db: None,
    };
    store_and_emit(&env, &results, &operation_id, &stream_id, r);
    state
}
