//! 작업안 실행기.
//!
//! 불변식: 실행은 `mode`/`strategy` 와 무관하게 **항상 순차 canary**(+선택 검증 프로브)다. 감사는 합성 전 **원시**
//! `command` 를 기록한다. 잠금은 **`.await` 위로 들고 가지 않는다**.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::i18n::tr;

use super::*;

/// SSH `exec` 는 PTY 만 미요청일 뿐 원격 로그인 셸을 거치므로 이 합성이 통한다.
pub(crate) fn compose_command(cwd: Option<&str>, command: &str) -> String {
    match cwd {
        None => command.to_string(),
        Some(dir) => {
            let escaped = dir.replace('\'', "'\\''");
            format!("cd -- '{escaped}' && ( {command} )")
        }
    }
}

/// `operationId → 협력적 취소 스위치`.
pub type CancelStore = Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>;

/// 앱 전체 동시 SSH exec 상한 — 작업안별 `concurrency` 는 한 작업안 안의 상한이라 겹치면 무제한이 된다.
/// 모든 대상 실행(canary 포함)이 지나는 `run_one_target` 에서 함께 쥔다.
pub(super) const GLOBAL_EXEC_LIMIT: usize = 32;

/// 모든 작업안이 같은 `Arc` 를 공유한다 — 따로 만들면 전역 상한이 깨진다.
pub struct ExecBudget(pub Arc<tokio::sync::Semaphore>);

impl Default for ExecBudget {
    fn default() -> Self {
        ExecBudget(Arc::new(tokio::sync::Semaphore::new(GLOBAL_EXEC_LIMIT)))
    }
}

/// `targets[0]` 가 canary 다 — exit 0 이어야만 나머지를 돌린다(`mode`/`strategy` 와 무관하게 늘).
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
    if let Ok(mut map) = ops.lock() {
        mark_running(&mut map, &operation_id);
    }
    env.emit(
        EVT_STATE,
        serde_json::json!({ "operationId": operation_id, "state": OperationState::Running }),
    );

    // 감사(`finalize`)에는 합성본이 아니라 원시 `command` 를 넘긴다.
    let effective_command = compose_command(cwd.as_deref(), &command);

    let mut states: Vec<TargetState> = Vec::with_capacity(targets.len());

    // ── canary ──────────────────────────────
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

    // ── canary 사후 검증 ──
    // 결과 행을 만들지 않는 프로브다 — 진행/중단만 가르고 canary 자신의 결과는 그대로 둔다.
    if let Some(v) = validate.as_deref() {
        // 핸들이 안 풀리면 검증 실패로 본다(확인 못 한 상태를 나머지로 번지게 하지 않는다).
        let probe: Option<crate::ssh::ExecOutcome> = {
            let ssh_id = {
                let m = env.routing.lock().ok();
                m.and_then(|m| crate::routing::resolve(&m, first))
            };
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
        let passed = matches!(&probe, Some(o) if classify(o).0 == TargetState::Succeeded);
        if !passed {
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

    // ── 나머지 ──
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
            // 작업안별 permit 은 태스크 수명 동안 — 전역 예산은 run_one_target 안에서 따로 쥔다.
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
        // 패닉한 대상은 실패로 친다 — 집계가 성공을 부풀리지 않게.
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

/// 봉인 · 보존 한도 · 감사 종료 기록 — 감사 send 가 실패해도 실행에는 영향이 없다.
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
    // 취소 플래그를 빼지 않으면 샌다.
    if let Ok(mut cmap) = cancel_store.lock() {
        cmap.remove(operation_id);
        for id in &evicted {
            cmap.remove(id);
        }
    }
    // 이 작업안 자신의 결과는 남긴다 — 관제판 · MCP 가 곧 읽는다.
    if !evicted.is_empty() {
        if let Ok(mut rmap) = results.lock() {
            for id in &evicted {
                rmap.remove(id);
            }
        }
    }
    // 출력 꼬리는 켠 경우 · 공유 중인 대상만 담는다.
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

pub(super) fn live_exec_handle(id: u32) -> Option<crate::ssh::ExecHandle> {
    crate::ssh::handle_of(crate::ssh::table(), id)
        .filter(|h| !h.is_closed())
        .map(crate::ssh::ExecHandle::from)
}
