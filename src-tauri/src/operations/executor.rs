//! executor — 합성 [`compose_command`] · 취소 스위치 [`CancelStore`] · 전역 실행 예산 [`ExecBudget`] · 순차 canary 실행
//! [`execute`] · 봉인·보존·감사 `finalize`.
//!
//! 불변식: 실행은 `mode`/`strategy` 와 무관하게 **항상 순차 canary**(+선택 검증 프로브)다. 감사는 합성 전 **원시**
//! `command` 를 기록한다. 잠금은 **`.await` 위로 들고 가지 않는다**.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::i18n::tr;

use super::*;

/// 실행 작업 디렉터리를 명령에 **합성**한다 — 순수 함수(테스트 대상).
///
/// `cwd` 가 `None` 이면 명령을 그대로 돌려준다(합성 없음). `Some(dir)` 이면
/// `cd -- '<escaped>' && ( <command> )` 를 만든다: `dir` 은 각 `'` 를 `'\''` 로 바꿔 POSIX
/// 작은따옴표 안전하게 이스케이프하고, `cd --` 로 `-` 로 시작하는 디렉터리도 옵션이 아니라
/// 경로로 넘긴다. `cd` 가 실패하면 `&&` 뒤가 실행되지 않고 대상은 non-zero 로 끝난다(정확·안전).
///
/// SSH `exec` 는 원격 로그인 셸을 거치므로 이 합성이 통한다 — exec 채널은 PTY 만 미요청일 뿐
/// 셸을 안 거치는 게 아니다([`crate::ssh`] 의 exec 채널 주석).
pub(crate) fn compose_command(cwd: Option<&str>, command: &str) -> String {
    match cwd {
        None => command.to_string(),
        Some(dir) => {
            let escaped = dir.replace('\'', "'\\''");
            format!("cd -- '{escaped}' && ( {command} )")
        }
    }
}

/// 취소 플래그 저장소 — `operationId → 협력적 취소 스위치`. approve 가 심고 cancel 이 세운다.
pub type CancelStore = Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>;

/// 앱 전체 동시 SSH exec **상한**(백로그 #7) — 모든 작업안을 통틀어 동시에 도는 대상 실행 수의 천장.
///
/// 작업안마다 `concurrency` 세마포어가 따로 있지만 그건 **한 작업안 안**의 상한이라, 승인된 작업안이
/// 여럿 겹치면 전체 in-flight 가 무제한으로 는다(장시간 감시 운영에서 SSH 채널·메모리 폭증). 그래서
/// 모든 대상 실행이 지나는 단 하나의 길목([`run_one_target`])에서 이 **전역** permit 도 함께 쥔다 —
/// canary 도 예외 없이. 32 는 수십 호스트 동시 점검을 덮으면서 채널·메모리가 통제를 벗어나지 않는
/// 선이다(둘 다 적용: per-plan concurrency AND 이 전역 상한).
pub(super) const GLOBAL_EXEC_LIMIT: usize = 32;

/// 전역 실행 예산(모든 작업안이 같은 `Arc` 를 공유한다 — 세션 서버의 작업안 평면이 한 벌 쥔다). executor 태스크는
/// `.0` 을 클론해 들고 가 [`run_one_target`] 에서 permit 을 쥔다.
pub struct ExecBudget(pub Arc<tokio::sync::Semaphore>);

impl Default for ExecBudget {
    fn default() -> Self {
        ExecBudget(Arc::new(tokio::sync::Semaphore::new(GLOBAL_EXEC_LIMIT)))
    }
}

/// executor 태스크 — 승인된 작업안을 **순차 canary → 나머지 동시 실행**으로 돌린다.
///
/// **`targets[0]` 가 canary 다** — 이 첫 대상을 홀로 돌려 **종료 코드 0**(성공 조건은 exit 0 뿐,
/// 서비스 정상 여부까지 보장하지 않는다)이어야만 나머지를 `concurrency` 만큼 동시에 돌린다. 첫
/// 대상이 실패(·타임아웃·취소)하면 나머지는 실행하지 않고 전부 Cancelled 로 남긴다
/// ([`canary_proceed`]). 이 canary-우선은 `mode`/`strategy` 값과 무관하게 **항상 강제**된다. 끝나면
/// 대상 상태들을 집계해([`aggregate`]) 작업안 상태를 봉하고 프런트에 알린다.
///
/// `cwd` 가 `Some` 이면 exec 채널에 넘길 명령을 [`compose_command`] 로 **한 번** 합성해
/// (`cd -- <dir> && ( 명령 )`) canary·나머지 모두 그것을 쓴다. **감사는 합성 전 원시 `command`**
/// 를 기록한다(finalize 에 원시 `command` 를 넘긴다) — `Operation.command` 도 덮지 않는다.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute(
    env: OpEnv,
    ops: OperationStore,
    results: ResultStore,
    cancel: Arc<AtomicBool>,
    cancel_store: CancelStore,
    budget: Arc<tokio::sync::Semaphore>,
    audit: AuditSink,
    operation_id: String,
    command: String,
    cwd: Option<String>,
    validate: Option<String>,
    targets: Vec<String>,
    concurrency: u32,
    timeout: Duration,
) {
    // Approved → Running.
    if let Ok(mut map) = ops.lock() {
        mark_running(&mut map, &operation_id);
    }
    env.emit(
        EVT_STATE,
        serde_json::json!({ "operationId": operation_id, "state": OperationState::Running }),
    );

    // 실행에 쓸 명령은 cwd 를 합성해 **한 번만** 만든다(canary·나머지 공통). 감사에는 원시
    // `command` 가 그대로 간다 — 아래 finalize 호출에 `&command` 를 넘긴다(합성본이 아니다).
    let effective_command = compose_command(cwd.as_deref(), &command);

    let mut states: Vec<TargetState> = Vec::with_capacity(targets.len());

    // ── canary — 첫 대상(targets[0])을 홀로 돌린다 ──────────────────────────────
    let Some((first, rest)) = targets.split_first() else {
        finalize(
            &env,
            &ops,
            &results,
            &cancel_store,
            &audit,
            &operation_id,
            &command,
            &targets,
            &[],
            None,
        );
        return;
    };
    let first_state = run_one_target(
        env.clone(),
        Arc::clone(&results),
        Arc::clone(&budget),
        Arc::clone(&cancel),
        operation_id.clone(),
        first.clone(),
        effective_command.clone(),
        timeout,
    )
    .await;
    states.push(first_state);

    if !canary_proceed(first_state) {
        // canary 실패 — 나머지는 돌리지 않고 전부 취소로 남긴다.
        for stream_id in rest {
            let mut r = TargetResult::pending();
            r.state = TargetState::Cancelled;
            r.ended_at = Some(now_ms());
            r.error_class = Some(tr!(
                ko: "canary 실패로 취소됨",
                en: "Cancelled — the canary failed",
            ));
            store_and_emit(&env, &results, &operation_id, stream_id, r);
            states.push(TargetState::Cancelled);
        }
        finalize(
            &env,
            &ops,
            &results,
            &cancel_store,
            &audit,
            &operation_id,
            &command,
            &targets,
            &states,
            None,
        );
        return;
    }

    // ── canary 사후 검증(A4d) — canary 가 exit 0 이어도 서비스가 정상이라는 보장은 없다
    // (`systemctl restart nginx` 는 nginx 가 곧 죽어도 0). `validate` 가 있으면 **canary 대상에서**
    // 그 명령을 돌려 exit 0 이어야만 나머지로 번진다. 이건 새 대상 결과 행을 만들지 않는 **프로브**다
    // — 진행/중단만 가르고, canary 대상 자신의 결과(Succeeded)는 그대로 둔다. `None` 이면 이 블록을
    // 통째로 건너뛰어 예전(canary exit 0 → 나머지) 행동 그대로다.
    if let Some(v) = validate.as_deref() {
        // canary 대상의 살아 있는 SSH 핸들을 run_one_target 과 같은 경로(라우팅 resolve → u32 →
        // handle_of)로 푼다. canary 가 방금 돌았으니 풀려야 정상이지만, 안 풀리면 검증을 **실패**로
        // 본다(안전한 방향 — 확인 못 한 상태를 나머지로 번지게 하지 않는다). await 위로 잠금을
        // 들고 가지 않는다(resolve 잠금은 블록 안에서 풀린다).
        let probe: Option<crate::ssh::ExecOutcome> = {
            let ssh_id = {
                let m = env.routing.lock().ok();
                m.and_then(|m| crate::routing::resolve(&m, first))
            };
            // 실행기는 세션 서버 안에 산다(③-3c) — SSH 전송로를 같은 프로세스의 표에서 바로 쥔다.
            let handle = ssh_id.and_then(live_exec_handle);
            match handle {
                Some(h) => Some(
                    crate::ssh::run_exec(
                        h,
                        compose_command(cwd.as_deref(), v),
                        timeout,
                        Arc::clone(&cancel),
                    )
                    .await,
                ),
                None => None,
            }
        };
        // 통과 = 검증 프로브가 exit 0(취소·타임아웃·전송 오류 아님) — classify 로 판정을 통일한다.
        let passed = matches!(&probe, Some(o) if classify(o).0 == TargetState::Succeeded);
        if !passed {
            // 검증 실패 — 나머지는 돌리지 않고 전부 취소로 남긴다(사유를 error_class 에 담는다).
            let reason = validation_abort_reason(probe.as_ref());
            for stream_id in rest {
                let mut r = TargetResult::pending();
                r.state = TargetState::Cancelled;
                r.ended_at = Some(now_ms());
                r.error_class = Some(reason.clone());
                store_and_emit(&env, &results, &operation_id, stream_id, r);
                states.push(TargetState::Cancelled);
            }
            finalize(
                &env,
                &ops,
                &results,
                &cancel_store,
                &audit,
                &operation_id,
                &command,
                &targets,
                &states,
                None,
            );
            return;
        }
    }

    // ── 나머지 — per-plan concurrency 만큼 동시에(전역 예산은 run_one_target 안에서 또 묶는다) ──
    let limit = concurrency.max(1) as usize;
    let sem = Arc::new(tokio::sync::Semaphore::new(limit));
    let mut set = tokio::task::JoinSet::new();
    for stream_id in rest {
        let permit_sem = Arc::clone(&sem);
        let env = env.clone();
        let results = Arc::clone(&results);
        let budget = Arc::clone(&budget);
        let cancel = Arc::clone(&cancel);
        let operation_id = operation_id.clone();
        let stream_id = stream_id.clone();
        let command = effective_command.clone();
        set.spawn(async move {
            // per-plan 세마포어가 이 작업안 안의 동시 실행을 묶는다(permit 은 태스크 수명 동안).
            // 전역 예산은 run_one_target 안에서 별도로 쥔다 — 둘 다 통과해야 exec 이 돈다.
            let _permit = permit_sem.acquire_owned().await;
            run_one_target(
                env,
                results,
                budget,
                cancel,
                operation_id,
                stream_id,
                command,
                timeout,
            )
            .await
        });
    }
    while let Some(joined) = set.join_next().await {
        // 태스크가 패닉하면 그 대상은 실패로 친다(집계가 성공을 부풀리지 않게).
        states.push(joined.unwrap_or(TargetState::Failed));
    }

    finalize(
        &env,
        &ops,
        &results,
        &cancel_store,
        &audit,
        &operation_id,
        &command,
        &targets,
        &states,
        None,
    );
}

/// 대상 상태들을 집계해 작업안을 봉하고 프런트에 알린다.
///
/// 여기에 **감사(단계 10a) 종료 기록**이 얹힌다 — 실행 로직·상태기계는 그대로고, 봉인된 집계
/// 상태와 대상별 결과를 감사 채널로 한 줄 보낼 뿐이다. `audit.tx` 가 `None`(로거 꺼짐)이거나
/// send 가 실패해도 실행에는 영향이 없다.
#[allow(clippy::too_many_arguments)]
pub(super) fn finalize(
    env: &OpEnv,
    ops: &OperationStore,
    results: &ResultStore,
    cancel_store: &CancelStore,
    audit: &AuditSink,
    operation_id: &str,
    command: &str,
    targets: &[String],
    states: &[TargetState],
    db_write: Option<crate::audit::AuditDbWrite>,
) {
    let final_state = aggregate(states);
    // 상태를 봉하고, **보존 한도**(백로그 #7)로 오래된 끝난 작업안을 골라낸다(잠금 안에서 한 번에).
    let evicted = if let Ok(mut map) = ops.lock() {
        finish(&mut map, operation_id, final_state);
        let ev = finished_to_evict(&map, FINISHED_RETENTION);
        for id in &ev {
            map.remove(id);
        }
        ev
    } else {
        Vec::new()
    };
    // 이 작업안의 취소 플래그는 끝났으니 뺀다(안 그러면 누수) + evict 된 것들의 플래그도. (잠금 별도)
    if let Ok(mut cmap) = cancel_store.lock() {
        cmap.remove(operation_id);
        for id in &evicted {
            cmap.remove(id);
        }
    }
    // evict 된 끝난 작업안의 결과 행렬도 뺀다 — **이 작업안 자신의 결과는 남긴다**(관제판·MCP 가 곧
    // 읽는다; retention=100 안에 있어 evict 대상이 아니다). reap-되거둠과 겹쳐도 remove 는 멱등이라 무해.
    if !evicted.is_empty() {
        if let Ok(mut rmap) = results.lock() {
            for id in &evicted {
                rmap.remove(id);
            }
        }
    }
    // 감사 — 종료 기록(순수 부가). 결과 저장소를 읽어 대상별 요약을 담는다(출력 꼬리는 켠 경우 ·
    // 공유 중인 대상만 — `AuditSink::excerpt_targets`).
    if let Some(tx) = &audit.tx {
        let excerpt_for = audit.excerpt_targets(targets);
        let record = crate::audit::AuditRecord::finished(
            operation_id.to_string(),
            command.to_string(),
            targets.to_vec(),
            audit_target_results(results, operation_id, targets, &excerpt_for),
            op_state_name(final_state),
            now_ms(),
        )
        .with_db_write(db_write);
        let _ = tx.send(record);
    }
    env.emit(
        EVT_STATE,
        serde_json::json!({ "operationId": operation_id, "state": final_state }),
    );
}

/// 라우팅이 푼 SSH 세션 id → exec 손잡이(세션 서버 표의 살아 있는 전송로). 없거나 닫혔으면 `None`.
pub(super) fn live_exec_handle(id: u32) -> Option<crate::ssh::ExecHandle> {
    crate::ssh::handle_of(crate::ssh::table(), id)
        .filter(|h| !h.is_closed())
        .map(crate::ssh::ExecHandle::from)
}
