//! **DB 대상 실행**(쿼리 타일 3단계 3b — docs/log/2026-10-13-db-write-mcp-design.md B-6 · D7) — 사람이 승인한 DB 작업안(`Operation.db`)을
//! 돈다. 부르는 곳은 승인의 몸 `approval::approve_in_with` 하나(사람의 `manual` 승인 뒤 — DB 작업안이 `auto` 로 오는 길은 연결이 'YOLO'
//! 일 때뿐이다(2026-10-23 — 그때도 아래 불변식은 그대로다).
//!
//! ## 불변식
//!
//! - **실행 직전 다시 판정한다** — 승인과 실행 사이에 연결의 AI 권한이 'Ask' 아래로 내려가거나(폼 · 독 · 설정 · 파일 편집) 연결이
//!   다른 서버를 가리키게 바뀌면(신원 스냅샷 — 작업안을 만들 때 뜬 것과 지금 것) 실행하지 않는다. 판정은 두 번이다: 연결을 열기 **전**
//!   (빠른 실패)과 연 **뒤** 첫 문장 **직전**(열기는 SSH 경유 · TLS 로 긴 `.await` 다 — SSH 대상의 재검사 ②와 같은 까닭).
//! - **승인 대기 중에는 아무것도 열지 않는다** — 연결 · 트랜잭션은 이 함수(승인 뒤)에서만 선다.
//! - 연결은 `db::ai_write` 의 **쓰기 연결**(실행 한 번 동안만 — 사람 타일 · 3a 읽기 풀과 따로)이고, 실행은 2단계 실행기 + 영향 행 상한이다.
//! - 결과 · 감사에 **값이 없다** — 감사(`finished` 줄의 `dbWrite`)는 문장의 첫 낱말 · 영향 행 · ms · 결과뿐, 결과 칸(`TargetResult.db`)의 행은
//!   사람 화면과(지금 읽기 권한이 있을 때만) MCP 가 본다.
//! - 자동 재실행이 없다 — 결과 불명(커밋 답 유실)은 그대로 `unknown` 이다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::db::ai::{self, DbAiLevel, Denied, Grant, PasswordSource};
use crate::db::ai_write::{self, WriteRun};
use crate::db::conns::DbConn;
use crate::delegation::Delegation;
use crate::i18n::tr;

use super::*;

/// 재판정에 쓰는 사실 — 권한 파일 · 연결 목록 · 경유 별칭이 지금 가리키는 곳.
pub(crate) struct DbFacts {
    pub delegation: Delegation,
    pub conns: Vec<DbConn>,
    /// 경유 별칭 → `user@host:port`(못 펴면 없음).
    pub via_targets: HashMap<String, String>,
}

/// DB 실행이 바깥에서 얻는 것 — 제품은 [`LiveDb`](파일 · 볼트), 시험은 손으로 짠 것(사용자 파일 · 볼트를 건드리지 않게).
pub(crate) trait DbWorld: Send + Sync {
    /// 지금의 사실(블로킹 — 파일을 읽는다).
    fn facts(&self) -> DbFacts;
    /// 비밀번호를 어디서(제품은 늘 볼트).
    fn password(&self) -> PasswordSource;
}

/// 제품 — `delegation.toml` · `db-connections.json` · `~/.ssh/config` 를 매번 새로 읽고, 비밀번호는 볼트에서.
pub(crate) struct LiveDb;

impl DbWorld for LiveDb {
    fn facts(&self) -> DbFacts {
        let conns = crate::db::conns::path()
            .and_then(|p| crate::db::conns::load_at(&p).ok())
            .map(|l| l.conns)
            .unwrap_or_default();
        let via_targets = conns
            .iter()
            .filter_map(|c| c.via.as_deref())
            .filter_map(|v| crate::delegation::database::current_via_target(v).map(|t| (v.to_string(), t)))
            .collect();
        DbFacts { delegation: Delegation::load_default(), conns, via_targets }
    }

    fn password(&self) -> PasswordSource {
        PasswordSource::Vault
    }
}

/// 제품의 세계.
pub(crate) fn live_db() -> Arc<dyn DbWorld> {
    Arc::new(LiveDb)
}

/// **재판정** — 이 작업안을 지금 실행해도 되는가. 되면 증표, 안 되면 사람이 읽는 까닭. **순수**(시험 대상).
///
/// 셋을 본다: 연결이 지금 목록에 있다 · 그 연결의 단계(+ `delegation.toml` 의 신원 스냅샷)가 'Ask' 다 · 지금 연결의 신원이
/// 작업안을 만들 때의 신원과 같다(같은 서버 · 같은 DB · 같은 사용자 · 같은 경유 대상 — 그 사이 권한을 새 대상에 다시 줬더라도, 사람이
/// 검토한 것은 옛 대상이다).
pub(crate) fn db_recheck(plan: &DbPlan, facts: &DbFacts) -> Result<Grant, String> {
    let Some(conn) = facts.conns.iter().find(|c| c.id == plan.conn_id) else {
        return Err(tr!(
            ko: "DB 연결이 목록에 없어 실행하지 않았습니다(지워졌습니다)",
            en: "Not run — the database connection is no longer in the list (it was deleted)",
        ));
    };
    let vt = conn.via.as_deref().and_then(|v| facts.via_targets.get(v)).map(String::as_str);
    let grant = ai::authorize(&facts.delegation, conn, vt, DbAiLevel::Approve).map_err(|d| match d {
        Denied::Off => tr!(
            ko: "DB 연결의 AI 권한이 꺼졌거나 대상이 바뀌어 실행하지 않았습니다",
            en: "Not run — the connection's AI permission is off or its target changed",
        ),
        Denied::Below(_) => tr!(
            ko: "DB 연결의 AI 권한이 'Ask' 아래로 내려가 실행하지 않았습니다",
            en: "Not run — the connection's AI permission dropped below 'Ask'",
        ),
    })?;
    // 만들 때의 스냅샷이 없으면(만들 때 늘 뜨므로 제품에서는 없는 일) 같다고 볼 근거가 없다 — 실행하지 않는다.
    match &plan.identity {
        Some(made) if made.same(&grant.identity()) => Ok(grant),
        _ => Err(tr!(
            ko: "작업안을 만든 뒤 DB 연결의 대상(주소 · DB · 사용자 · 경유)이 바뀌어 실행하지 않았습니다",
            en: "Not run — the connection's target (address, database, user or jump host) changed after the plan was made",
        )),
    }
}

/// 지금의 사실로 재판정(파일 읽기는 작업 스레드에서).
async fn recheck_now(world: &Arc<dyn DbWorld>, plan: &DbPlan) -> Result<Grant, String> {
    let w = Arc::clone(world);
    let facts = tokio::task::spawn_blocking(move || w.facts())
        .await
        .map_err(|_| "The database task failed (worker thread)".to_string())?;
    db_recheck(plan, &facts)
}

/// 실행 결과 → 대상 칸.
fn target_result(run: &WriteRun, started: u64) -> (TargetState, TargetResult) {
    let state = match (run.outcome, run.reason) {
        ("committed", _) => TargetState::Succeeded,
        ("unknown", _) => TargetState::Unknown,
        // 사람이 멈췄고 되돌려졌다 — 남은 것이 없다(깨끗한 취소).
        ("rolledBack", Some("cancelled")) => TargetState::Cancelled,
        _ => TargetState::Failed,
    };
    let mut r = TargetResult::pending();
    r.state = state;
    r.stdout = run.summary.clone();
    r.stderr = run.error.clone().unwrap_or_default();
    r.error_class = run.error.as_ref().and_then(|e| e.lines().next().map(str::to_owned));
    r.started_at = Some(started);
    r.ended_at = Some(now_ms());
    r.db = Some(run.value.clone());
    (state, r)
}

/// 감사의 DB 칸(값 없음).
fn audit_of(plan: &DbPlan, run: &WriteRun) -> crate::audit::AuditDbWrite {
    crate::audit::AuditDbWrite {
        conn_id: plan.conn_id.clone(),
        engine: plan.engine.clone(),
        max_affected: plan.max_affected,
        total_affected: run.total_affected,
        outcome: run.outcome.to_string(),
        reason: run.reason.map(str::to_owned),
        statements: run
            .audit
            .iter()
            .map(|(keyword, affected, ms)| crate::audit::AuditDbStmt {
                keyword: keyword.clone(),
                affected: *affected,
                elapsed_ms: *ms,
            })
            .collect(),
    }
}

/// **DB 작업안 실행 태스크** — 재판정 → 쓰기 연결 → 재판정 → 한 트랜잭션 → 결과 · 감사 · 봉인. 승인 몸이 spawn 한다.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_db(
    env: OpEnv,
    ops: OperationStore,
    results: ResultStore,
    cancel: Arc<AtomicBool>,
    cancel_store: CancelStore,
    audit: AuditSink,
    world: Arc<dyn DbWorld>,
    operation_id: String,
    command: String,
    plan: DbPlan,
) {
    if let Ok(mut map) = ops.lock() {
        mark_running(&mut map, &operation_id);
    }
    env.emit(EVT_STATE, serde_json::json!({ "operationId": operation_id, "state": OperationState::Running }));
    let target = db_target_id(&plan.conn_id);
    let targets = vec![target.clone()];
    let started = now_ms();
    let stmt_ms = (plan.timeout_seconds.max(1) as u64) * 1000;
    let statements: Vec<String> = plan.statements.iter().map(|s| s.sql.clone()).collect();

    let run = 'run: {
        if cancel.load(Ordering::SeqCst) {
            break 'run None;
        }
        // 재판정 ① — 열기 전(빠른 실패).
        let grant = match recheck_now(&world, &plan).await {
            Ok(g) => g,
            Err(m) => break 'run Some(WriteRun::not_run(m, plan.max_affected)),
        };
        let mut running = TargetResult::pending();
        running.state = TargetState::Running;
        running.started_at = Some(started);
        store_and_emit(&env, &results, &operation_id, &target, running);
        let conn = match ai_write::open(&grant, &world.password()).await {
            Ok(c) => c,
            Err(m) => break 'run Some(WriteRun::not_run(m, plan.max_affected)),
        };
        if cancel.load(Ordering::SeqCst) {
            break 'run None;
        }
        // 재판정 ② — 실행 직전(열기의 긴 기다림 뒤). 여기서 첫 문장까지는 `.await` 가 판정뿐이다.
        if let Err(m) = recheck_now(&world, &plan).await {
            break 'run Some(WriteRun::not_run(m, plan.max_affected));
        }
        let run = ai_write::run(&conn, &statements, plan.max_affected, stmt_ms, Arc::clone(&cancel)).await;
        drop(conn);
        Some(run)
    };

    let (state, db_audit) = match run {
        None => {
            let mut r = TargetResult::pending();
            r.state = TargetState::Cancelled;
            r.started_at = Some(started);
            r.ended_at = Some(now_ms());
            r.error_class = Some(tr!(ko: "시작 전 취소됨(아무것도 실행하지 않음)", en: "Cancelled before start (nothing ran)"));
            store_and_emit(&env, &results, &operation_id, &target, r);
            (TargetState::Cancelled, None)
        }
        Some(run) => {
            let (state, r) = target_result(&run, started);
            store_and_emit(&env, &results, &operation_id, &target, r);
            (state, Some(audit_of(&plan, &run)))
        }
    };
    finalize(&env, &ops, &results, &cancel_store, &audit, &operation_id, &command, &targets, &[state], db_audit);
}
