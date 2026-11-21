//! 승인·취소 — 세션 서버의 몸 [`approve_in`]·[`cancel_in`] 과 그것을 부르는 GUI Tauri 명령 `approve_operation`·`cancel_operation`(**MCP 아님**).
//!
//! 불변식: 승인·취소는 **GUI 의 Tauri 명령뿐**이다 — MCP `tools/list` 에 없어 AI 는 자기 실행을 자가 승인 못 한다. 승인 등급 프레임
//! (op `ops_approve`)을 만드는 코드는 [`approve_operation`] 하나다(시험 `approve_frames_come_from_one_place`). 서버는 그 프레임을 믿고 끝내지
//! 않고 만료 → 게이트([`approval_reject_reason`])를 **다시** 본다(GUI 는 아무것도 판정하지 않는다). 승인은 `operation_id` 하나만 받고 명령
//! 문자열을 다시 받지 않는다(재주입 차단). 잠금을 쥔 채 `.await` 하지 않는다. 취소는 쓰기 등급(`ops_cancel`) — 실행을 멈추는 쪽이라 권한을 넓히지 않는다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::i18n::tr;

use super::*;

/// 작업안 평면 한 벌 — 세션 서버(`server::ai`)가 쥔다.
pub(crate) struct OpsPlane {
    pub env: OpEnv,
    pub ops: OperationStore,
    pub results: ResultStore,
    pub cancels: CancelStore,
    pub rate: Arc<AutoApprovalRate>,
    pub budget: Arc<tokio::sync::Semaphore>,
    pub audit: crate::audit::Audit,
    /// 사전 정책 자동 승인의 기억(서버 타이머 `operations::auto`).
    pub auto: super::auto::AutoState,
    pub unseen: super::notify::Unseen,
    /// DB 작업안 실행의 바깥(제품은 파일 · 볼트, 시험은 손으로 짠 것).
    pub db: Arc<dyn super::db_exec::DbWorld>,
}

impl OpsPlane {
    /// 진행 중인(승인됨·실행 중) 작업안 수 — 세션 서버의 고아 자진 종료 조건(`serve::Busy::plans`).
    pub(crate) fn in_progress(&self) -> usize {
        self.ops
            .lock()
            .map(|m| {
                m.values()
                    .filter(|o| matches!(o.state, OperationState::Approved | OperationState::Running))
                    .count()
            })
            .unwrap_or(0)
    }

    /// 서버가 끝난다 — 승인됨·실행 중 작업안을 `cancelled` 로 봉한다. 원격에서 이미 시작된 명령은 계속 돌 수 있다(협력적 한계).
    pub(crate) fn cancel_all_for_shutdown(&self) -> usize {
        if let Ok(cmap) = self.cancels.lock() {
            for flag in cmap.values() {
                flag.store(true, Ordering::SeqCst);
            }
        }
        let sealed: Vec<(String, String, Vec<String>)> = match self.ops.lock() {
            Ok(mut map) => {
                let ids: Vec<String> = map
                    .values()
                    .filter(|o| matches!(o.state, OperationState::Approved | OperationState::Running))
                    .map(|o| o.operation_id.clone())
                    .collect();
                ids.into_iter()
                    .filter_map(|id| {
                        finish(&mut map, &id, OperationState::Cancelled);
                        map.get(&id).map(|o| (id.clone(), o.command.clone(), o.targets.clone()))
                    })
                    .collect()
            }
            Err(_) => Vec::new(),
        };
        for (id, command, targets) in &sealed {
            self.audit.log(crate::audit::AuditRecord::user_action(
                "cancelled",
                id.clone(),
                command.clone(),
                targets.clone(),
                now_ms(),
            ));
            self.env
                .emit(EVT_STATE, json!({ "operationId": id, "state": OperationState::Cancelled }));
        }
        sealed.len()
    }
}

// ===========================================================================
// GUI — Tauri 명령. 몸은 세션 서버 op.
//
// ⛔ 이 둘은 `invoke_handler`(lib.rs)에만 등록되고 MCP `tools/list`·`tools_call` 에는 절대 넣지 않는다(경계 테스트로 못박음).
// ===========================================================================

/// **작업안을 승인하고 실행을 시작한다** — Tauri 명령 전용(**MCP 아님**). **승인 등급 프레임을 만드는 유일한 자리**다
/// (`server::client::request_approve`). 이 명령은 아무것도 판정하지 않는다.
#[tauri::command]
pub async fn approve_operation(operation_id: String, approval_method: Option<String>) -> Result<Value, String> {
    crate::server::client::request_approve(
        "ops_approve",
        json!({
            "operationId": operation_id,
            "approvalMethod": approval_method,
            "lang": crate::server::ssh_proxy::lang(),
        }),
    )
    .await
    .map_err(crate::server::ai_proxy::wire_message)
}

/// **실행을 취소한다** — Tauri 명령 전용(**MCP 아님**). 서버 op `ops_cancel`(쓰기 등급).
#[tauri::command]
pub async fn cancel_operation(operation_id: String) -> Result<(), String> {
    crate::server::ai_proxy::call(
        crate::server::ipc::Grade::Write,
        "ops_cancel",
        json!({ "operationId": operation_id }),
    )
    .await
    .map(|_| ())
}

// ===========================================================================
// 세션 서버 — 승인·취소의 몸
// ===========================================================================

/// 세션 서버 op `ops_approve`(승인 등급)의 몸. 승인 시그니처에 명령 문자열을 **절대 받지 않는다**(AI 재주입 차단).
/// 자동(`approval_method=="auto"`)은 정책([`crate::policy`])까지 **서버가** 재검증한다 — GUI 가 auto 로 불러도 여기가 경계다.
pub(crate) fn approve_in(
    p: &OpsPlane,
    operation_id: String,
    approval_method: Option<String>,
) -> Result<Operation, String> {
    approve_in_with(
        p,
        operation_id,
        approval_method,
        crate::settings::automation_prefs(),
        crate::delegation::Delegation::load_default,
    )
}

/// 정책과 위임 표를 바깥에서 받는다(시험이 디스크 없이 게이트 전부를 지나게). 제품에서 부르는 곳은 [`approve_in`] 하나다
/// (시험 `server::tests::auto_approve_has_one_entry`).
pub(crate) fn approve_in_with(
    p: &OpsPlane,
    operation_id: String,
    approval_method: Option<String>,
    prefs: crate::settings::AutomationPrefs,
    delegation: impl FnOnce() -> crate::delegation::Delegation,
) -> Result<Operation, String> {
    // ── 권위 게이트 — 상태를 바꾸기 전에 무조건 판정한다 ──
    // 전이 뒤에 막으면 Approved 로 옮겨 놓고 executor 는 안 도는 유령 상태가 된다. `method=="auto"` 면 정책 전체를 서버가 독립적으로
    // 다시 강제한다 — 프런트 버그가 정책 밖 자동 승인을 뚫지 못하게. 출력 발췌 정책은 승인 시점 값을 executor 에 들려 보낸다.
    let excerpt = prefs.audit_output_excerpt;

    // 승인 방식 — 누락·빈 값이면 "manual". 게이트·감사 둘 다 이 값을 본다.
    let method = approval_method
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "manual".to_string());

    // 자동 경로 전용 — 대상별 자동 실행 권한(파일 I/O)과 컨텍스트의 정체성 스냅샷을 잠금 밖에서 미리 떠 둔다(락 순서: 컨텍스트 → 작업안,
    // 두 잠금을 겹쳐 쥐지 않는다). 수동 승인은 이 문을 열지 않는다 — propose 가 수동 문지기다.
    let auto_gate = if method == "auto" {
        let snapshot = p
            .env
            .ctx
            .lock()
            .map(|m| crate::context::permission_snapshot(&m))
            .map_err(
                |_| tr!(ko: "컨텍스트 저장소 잠금 실패", en: "Could not lock the context store"),
            )?;
        // 모두 승인의 DB 판정 재료 — DB 작업안일 때만, 작업안 잠금 밖에서 읽는다. 판정은 실행 직전 재판정과 같은 길(`db_exec::db_recheck`)이다.
        let is_db = p
            .ops
            .lock()
            .ok()
            .and_then(|m| get(&m, &operation_id).map(|o| o.db.is_some()))
            .unwrap_or(false);
        let db_facts = is_db.then(|| p.db.facts());
        Some((snapshot, delegation(), db_facts))
    } else {
        None
    };

    let (op, expired) = {
        let mut map = p.ops.lock().map_err(
            |_| tr!(ko: "작업안 저장소 잠금 실패", en: "Could not lock the task plan store"),
        )?;
        // 만료가 게이트보다 먼저다 — 늦게 깨어난 자동 승인이 옛 작업안을 들이밀어도 `Expired` 가 되어 [`approve`] 가 막는다.
        let expired = sweep_expired(&mut map, prefs.approval_ttl_minutes as u64 * 60_000);
        // 게이트와 전이를 한 덩어리로 묶는다 — 여기서 곧장 `return` 하면 방금 만료된 것들의 이벤트·감사가 통째로 사라진다.
        let outcome = (|| -> Result<Operation, String> {
            if let Some(existing) = get(&map, &operation_id) {
                // 모두 승인(docs/log/2026-10-23-approve-all.md): 대상이 전부 'YOLO' 면 caps 와 전체 스위치만 보고 넘긴다 —
                // 명령 정책 · 대상별 자동 실행 문 · 빈도 한도를 건너뛴다(빈도 칸도 먹지 않는다).
                if let Some((snapshot, delegation, db_facts)) = &auto_gate {
                    if approve_all_plan(&existing.targets, existing.db.as_ref(), snapshot, delegation, db_facts.as_ref()) {
                        if let Some(reason) =
                            approve_all_reject_reason(existing.targets.len(), existing.concurrency, &prefs)
                        {
                            return Err(reason);
                        }
                        let op = approve(&mut map, &operation_id, &method)?;
                        if let Some(m) = map.get_mut(&operation_id) {
                            m.approve_all = true;
                        }
                        return Ok(Operation { approve_all: true, ..op });
                    }
                }
                // DB 작업안은 (모두 승인이 아니면) 자동 승인이 없다 — SQL 은 첫 낱말 허용 목록으로 범위를 말할 수 없다
                // (`UPDATE … WHERE` 한 줄 차이로 전체 행). 시험 `auto_never_approves_db_targets`.
                if method == "auto" && (existing.db.is_some() || existing.targets.iter().any(|t| is_db_target(t))) {
                    return Err(tr!(
                        ko: "DB 작업안은 연결이 'YOLO' 일 때만 자동 승인합니다 — 사람이 검토 카드에서 승인해야 실행됩니다",
                        en: "Database task plans are auto-approved only when the connection is set to 'YOLO' — a person has to approve this one in the review card",
                    ));
                }
                if let Some(reason) = approval_reject_reason(
                    &existing.command,
                    existing.targets.len(),
                    existing.concurrency,
                    existing.cwd.as_deref(),
                    existing.validate.as_deref(),
                    &method,
                    &prefs,
                ) {
                    return Err(reason);
                }
                // 대상별 자동 실행 권한 — 하나라도 없으면 거부하고 사람이 승인하게 남긴다.
                if let Some((snapshot, delegation, _)) = &auto_gate {
                    if let Some(reason) =
                        auto_execute_reject_reason(&existing.targets, snapshot, delegation)
                    {
                        return Err(reason);
                    }
                }
                // 마지막 문 — 빈도 한도. **허용될 때만** now 를 기록해, 앞 게이트에 걸린 작업안이 슬롯을 먹지 않게 한다.
                // rate 잠금은 잡았다 놓고 전이는 그 뒤에 한다(두 잠금을 겹치게 쥐지 않는다).
                if method == "auto" {
                    let admitted = {
                        let mut stamps = p.rate.0.lock().map_err(
                            |_| tr!(ko: "빈도 한도 상태 잠금 실패", en: "Could not lock the rate-limit state"),
                        )?;
                        rate_limit_admit(
                            &mut stamps,
                            now_ms(),
                            prefs.auto_max_per_window,
                            prefs.auto_window_secs as u64 * 1000,
                        )
                    };
                    if !admitted {
                        return Err(tr!(
                            ko: "자동 승인 빈도 한도 초과 (창 {window}s 내 {count}건) — 사람 승인을 기다립니다",
                            en: "Auto-approval rate limit exceeded ({count} in a {window}s window) — waiting for a person to approve",
                            window = prefs.auto_window_secs,
                            count = prefs.auto_max_per_window,
                        ));
                    }
                }
            }
            approve(&mut map, &operation_id, &method)
        })();
        (outcome, expired)
    };
    announce_expired(&p.env.emit, Some(&p.audit), expired);
    let op = op?;

    // 감사 — 대상별 사람이-읽는 스냅샷을 로그 시점 거울에서 뽑아 얹는다.
    let labels = p
        .env
        .ctx
        .lock()
        .map(|m| build_target_labels(&m, &op.targets))
        .unwrap_or_default();
    p.audit.log(
        crate::audit::AuditRecord::approved(
            operation_id.clone(),
            op.command.clone(),
            op.targets.clone(),
            method,
            now_ms(),
        )
        .with_labels(labels)
        .with_plan(op.title.clone(), op.cwd.clone(), op.validate.clone())
        .with_ai_text(op.summary.clone(), op.reason.clone())
        .with_approve_all(op.approve_all),
    );

    // 취소 스위치 — executor 태스크와 cancel_in 이 같은 Arc 를 공유한다.
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut cmap) = p.cancels.lock() {
        cmap.insert(operation_id.clone(), Arc::clone(&cancel));
    }

    if let Ok(mut rmap) = p.results.lock() {
        let entry = rmap.entry(operation_id.clone()).or_default();
        for stream_id in &op.targets {
            entry.insert(stream_id.clone(), TargetResult::pending());
        }
    }

    // DB 작업안 — SSH exec 가 아니라 DB 실행 태스크(재판정 → 쓰기 연결 → 한 트랜잭션).
    if let Some(plan) = op.db.clone() {
        tokio::spawn(super::db_exec::execute_db(
            p.env.clone(),
            Arc::clone(&p.ops),
            Arc::clone(&p.results),
            cancel,
            Arc::clone(&p.cancels),
            AuditSink {
                tx: p.audit.sender(),
                ctx: Some(Arc::clone(&p.env.ctx)),
                excerpt,
            },
            Arc::clone(&p.db),
            operation_id,
            op.command.clone(),
            plan,
        ));
        return Ok(op);
    }

    // executor 태스크를 분리한다 — op 는 즉시 답한다(파이프의 다른 요청을 붙들지 않는다).
    tokio::spawn(execute(
        p.env.clone(),
        Arc::clone(&p.ops),
        Arc::clone(&p.results),
        cancel,
        Arc::clone(&p.cancels),
        Arc::clone(&p.budget),
        AuditSink {
            tx: p.audit.sender(),
            ctx: Some(Arc::clone(&p.env.ctx)),
            excerpt,
        },
        operation_id,
        op.command.clone(),
        op.cwd.clone(),
        op.validate.clone(),
        op.targets.clone(),
        op.concurrency,
        Duration::from_secs(op.timeout_seconds.max(1) as u64),
    ));

    Ok(op)
}

/// 세션 서버 op `ops_cancel` 의 몸 — 취소 스위치를 세운다(협력적). **원격에서 이미 시작된 명령은 계속 돌 수 있다**([`crate::ssh::run_exec`]).
pub(crate) fn cancel_in(p: &OpsPlane, operation_id: String) -> Result<(), String> {
    let armed = {
        let map = p
            .cancels
            .lock()
            .map_err(|_| tr!(ko: "취소 저장소 잠금 실패", en: "Could not lock the cancel store"))?;
        match map.get(&operation_id) {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    };
    // 사람이 멈췄다는 표식은 스위치가 살아 있던(= 아직 도는) 실행만 — 이미 끝난 실행은 사람이 멈춘 것이 아니다.
    if armed {
        if let Ok(mut map) = p.ops.lock() {
            mark_cancelled_by_user(&mut map, &operation_id);
        }
    }
    // 취소도 감사에 남긴다 — 작업안이 이미 사라졌으면 조용히 건너뛴다(best-effort). 잠금은 각각 짧게, 겹치지 않게.
    let snapshot = p
        .ops
        .lock()
        .ok()
        .and_then(|m| get(&m, &operation_id).map(|o| (o.command.clone(), o.targets.clone())));
    if let Some((command, targets)) = snapshot {
        let labels = p
            .env
            .ctx
            .lock()
            .map(|m| build_target_labels(&m, &targets))
            .unwrap_or_default();
        p.audit.log(
            crate::audit::AuditRecord::user_action(
                "cancelled",
                operation_id,
                command,
                targets,
                now_ms(),
            )
            .with_labels(labels),
        );
    }
    Ok(())
}
