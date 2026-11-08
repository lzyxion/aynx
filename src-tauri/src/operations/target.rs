//! 대상 하나 실행 — [`run_one_target`](권한 재검사(빠른 실패) → 전역 예산 → 라우팅/위임 자동 접속 →
//! **권한 재검사(실행 직전)** → exec → 분류·저장).
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

/// **실행 시점 권한 재검사** — 이 대상에 exec 채널을 열어도 되는가. **순수 함수**(테스트 대상).
///
/// 승인과 실행 **사이**에 호스트의 AI 권한이 내려갈 수 있으므로(타일 팝오버·호스트 폼·파일 편집),
/// 실행 직전 그 문이 아직 살아 있는지 다시 본다 — 판정은 작업안 대상 자격과 같은 누적 `read && propose`:
/// - `delegated:<alias>` id: 그 별칭의 권한(거울에 없어도 — 아직 접속 안 된 위임 대상).
/// - 창 타일: 거울(`ctx`)의 [`crate::context::ai_plan_eligible`] — 원격 타일은 호스트 별칭의 권한.
///   **로컬 타일·별칭 없는 원격 타일·거울에 없는 id 는 거부**한다(실행 권한이 없다).
///
/// `identity`/`connect` 는 재검사하지 않는다: 신원은 접속 때 잠겼고(A1) 라이브 전송은 이미 검증된
/// 그것이라, `connect` 는 **새 open** 만 지배한다.
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

/// 재검사가 막으면 그 대상의 **실패 결과**를, 통과하면 `None` — **순수 함수**(테스트 대상).
///
/// 판정은 [`delegated_propose_still_live`] 그대로(위임 표에 그 호스트가 있고 단계가 'Ask' 이상 —
/// 누적 `read && propose`). 결과 형식은 다른 대상 실패와 같다: `Failed` · 시작=끝 시각 · `error_class` 한 줄.
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

/// 지금의 위임 표·거울로 [`permission_recheck_failure`] 를 돌린다. 위임 표는 **매번 파일에서 새로** 읽고
/// (캐시 없음 — 방금 내린 권한이 곧바로 보인다), 컨텍스트 잠금은 판정에 필요한 칸만 복제하고 바로 푼다
/// (`.await` 위로 들고 가지 않는다 — 이 함수는 동기다).
fn recheck_permission_now(env: &OpEnv, stream_id: &str) -> Option<TargetResult> {
    let delegation = crate::delegation::Delegation::load_default();
    let ctx = env
        .ctx
        .lock()
        .ok()
        .and_then(|m| m.get(stream_id).map(crate::context::permission_view));
    permission_recheck_failure(stream_id, ctx.as_ref(), &delegation)
}

/// 자동 접속 실패를 사람이 읽는 한 줄로 — `error_class` 에 실린다(비밀번호/키는 담기지 않는다).
///
/// [`crate::ssh::SshOpenError`] 는 프런트 직렬화용 enum 이라 `Display` 가 없다. 여기선 분류 이름
/// 한 조각만 뽑는다(호스트 키 변수의 fingerprint 등 원시 필드는 굳이 노출하지 않는다).
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
        // 헤드리스는 암호구를 묻지 않으므로(`KeyUnlock::Skip`) 이 갈래는 원래 오지 않는다.
        // 그래도 **경로는 싣지 않는다** — 오류 분류 한 줄에 파일 경로를 흘릴 이유가 없다.
        PassphraseRequired { .. } => tr!(
            ko: "개인키에 암호구가 걸려 있음 (무상호작용 접속은 묻지 않음)",
            en: "The private key is passphrase-protected (a non-interactive connection never asks)",
        ),
        PasswordRequired { message, .. } | Auth { message, .. } | Other { message, .. } => {
            message.clone()
        }
    }
}

/// 대상 하나를 끝까지 돌린다 — 라우팅 해석 → exec → 결과 저장·emit. 집계용 최종 상태를 돌려준다.
///
/// 실행 대상은 **라우팅 표로 살아 있는 SSH 로 풀리는 것만**이다(보안 불변 #5). 안 풀리면
/// (세션 닫힘/미공유/로컬) 실행하지 않고 `Failed`(대상 없음)로 남긴다.
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
    // 시작 전에 취소됐으면 아무것도 열지 않는다 — Cancelled(전역 예산도 잡지 않는다).
    if cancel.load(Ordering::SeqCst) {
        let mut r = TargetResult::pending();
        r.state = TargetState::Cancelled;
        r.ended_at = Some(now_ms());
        r.error_class = Some(tr!(ko: "시작 전 취소됨", en: "Cancelled before start"));
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Cancelled;
    }

    // **권한 재검사 ① (빠른 실패)** — 승인과 실행 사이에 호스트의 AI 권한이 'Ask' 아래로
    // 내려갔으면 예산을 잡지도 채널을 열지도 않고 여기서 Failed 로 끝낸다([`delegated_propose_still_live`]).
    // `delegated:<alias>` id 는 거울 없이 별칭으로(아직 접속 안 된 위임 대상도 건너뛰지 않는다), 창 타일은
    // 거울의 호스트 별칭으로 본다 — 로컬·별칭 없는 창 대상은 거부된다(창 타일도 예외가 없다, 2026-10-07).
    // **이것만으로는 '실행 직전' 이 아니다** — 아래 예산 대기(상한 없음)와 자동 접속이 긴 `.await` 라
    // 그 사이 철회를 놓친다. 진짜 관문은 `run_exec` 바로 앞의 재검사 ② 다.
    if let Some(r) = recheck_permission_now(&env, &stream_id) {
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Failed;
    }

    // 앱 전체 실행 예산(백로그 #7) — 모든 작업안을 통틀어 동시 실행을 GLOBAL_EXEC_LIMIT 로 묶는다.
    // **canary 를 포함해 모든 대상이 이 길목을 지나므로** 여기서 permit 을 쥔다(태스크 수명 동안).
    // 예산이 꽉 차면 여기서 대기한다(백프레셔). 세마포어는 닫히지 않아 acquire 는 실패하지 않는다.
    // 잠금(store) 위에서 await 하지 않는다 — 이 acquire 는 어떤 store 잠금도 잡기 전이다.
    let _budget_permit = budget.acquire().await;

    // 살아 있는 SSH 로 푼다. 못 풀면 실행하지 않는다.
    // 후속(백로그 #5 UX): 승인을 **접속 세대**(연결 회차)에 묶어 재연결·철회 후 재검토를 요구할 수
    // 있다. 지금은 이 런타임 라우팅 해석이 철회·재연결된 대상을 안전하게 Failed(대상 없음)로
    // 떨어뜨리므로 안전·프라이버시엔 문제없다 — 세대 바인딩은 편의 개선이라 미룬다.
    let mut ssh_id = {
        let m = env.routing.lock().ok();
        m.and_then(|m| crate::routing::resolve(&m, &stream_id))
    };

    // **위임 자동 접속(A2b)** — 안 풀리는데 대상이 `delegated:<alias>` 면, connect 위임 아래 지금 접속을
    // 세운다. 경계는 [`crate::headless::connect_delegated`] 의 관문(connect_granted → 신원 스냅샷 → 무상호작용
    // 인증)이 강제한다 — connect=true 로 위임됐고 신원이 일치하는 그 대상에만 붙고, 다른 어떤 호스트
    // 에도 붙지 않는다. 라우팅 잠금은 위 resolve 안에서 이미 풀렸다(await 위로 잠금을 들고 가지
    // 않는다). 접속이 서면 라우팅을 다시 풀어 exec 로 흐르고, connect 위임이 없거나 접속이 실패하면
    // 실행하지 않고 Failed 로 남긴다.
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

    // 실행기는 세션 서버 안에 산다(③-3c) — SSH 전송로를 같은 프로세스의 표에서 바로 쥔다(명령은 아래 승인된 작업안의 글자
    // 그대로 — 이 실행기가 조립한다).
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

    // **권한 재검사 ② (실행 직전)** — 예산 대기·자동 접속(둘 다 긴 `.await`)을 지난 **뒤** 다시 본다.
    // 슬롯이 꽉 찬 동안이나 접속을 세우는 동안 사용자가 권한을 끔/읽기 전용으로 내렸으면, 이미 승인돼
    // 줄 선 이 대상은 옛 판단으로 시작하지 않고 Failed 로 끝난다(다른 대상은 각자 자기 재검사를 본다).
    // 여기서 `run_exec` 까지는 `.await` 가 없다 — 판정과 채널 열기 사이에 끼어들 틈이 없다.
    // 자동 접속으로 막 선 연결은 건드리지 않는다 — 실행만 막는다(위의 다른 실패 갈래와 같다).
    if let Some(r) = recheck_permission_now(&env, &stream_id) {
        store_and_emit(&env, &results, &operation_id, &stream_id, r);
        return TargetState::Failed;
    }

    // Running 을 먼저 알린다(시작 시각 포함).
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
