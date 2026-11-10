//! **AI 쓰기 작업안 시험**(쿼리 타일 3단계 3b — docs/log/2026-10-13-db-write-mcp-design.md B-6 · B-9 · D7). 제품 길 그대로다: MCP
//! `create_db_write_plan` · `request_execution`(`mcp::dispatch_full`) → 사람 승인(`approve_in_with(…, "manual")` — 파이프의 `ops_approve` 몸) →
//! 세션 서버 실행 태스크(`operations::db_exec`) → 다른 연결에서 확인. 사용자 볼트 · `delegation.toml` · `db-connections.json` 은 건드리지
//! 않는다 — 권한 · 연결 목록 · 비밀번호는 시험 세계(`World` — MCP 뒷면이자 실행기의 바깥)가 메모리로 쥔다.
//!
//! - 소스 훑기(늘): 쓰기 실행 모듈은 작업안 실행기만 부르고 사람 타일 표 · 3a 읽기 풀에 닿지 않는다 · 사전 검증 모듈은 연결을 모른다.
//! - SQLite(늘 — 임시 파일): 커밋 · `maxAffected` 초과 → 되돌림 · 문장 오류 → 되돌림 · 승인 전 권한 내림 · 대상 바뀜 → 실행 안 됨 ·
//!   거절 · 만료 → 아무것도 안 바뀜 · 자동 승인 거부 · 사전 거절 → 작업안 없음 · 감사에 값 없음.
//! - 실제 서버(`#[ignore]` + 환경변수 — `script_tests` 와 같은 변수): PG 직결 · PgBouncer transaction · MySQL 8.4 · MariaDB 11 — 같은 갈래 +
//!   실행 연결이 사람 타일과 다른 백엔드.
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55432/postgres
//! AYNX_TEST_PG_POOLER=127.0.0.1:56432
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53306/
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53307/
//! cargo test --lib db::ai_write_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 파일 자리(`db/tests/`): 승인 몸(`approve_in_with`)을 부르는 시험이라 제품 소스 훑기(`auto_approve_has_one_entry` — 시험 파일 ·
//! `/tests/` 는 건너뛴다)에 걸리지 않는 자리에 둔다.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::ai::{AiDb, AiOutcome, AiRequest, DbAiLevel, Grant, PasswordSource};
use super::conns::{DbConn, DbEngine, DbTlsMode};
use crate::audit::AuditRecord;
use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
use crate::delegation::Delegation;
use crate::mcp::{dispatch_full, DbEnv, McpSignal, RpcReply};
use crate::operations::approval::{approve_in_with, OpsPlane};
use crate::operations::db_exec::{DbFacts, DbWorld};
use crate::operations::{self, OpEnv, OperationState, OperationStore, ResultStore, TargetResult, TargetState};

// ---------------------------------------------------------------------------
// 소스 훑기
// ---------------------------------------------------------------------------

fn code_of(rel: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(rel);
    let text = std::fs::read_to_string(&p).unwrap();
    let body = match text.find("#[cfg(test)]\nmod tests").or_else(|| text.find("#[cfg(test)]\r\nmod tests")) {
        Some(i) => &text[..i],
        None => &text[..],
    };
    body.lines()
        .map(|l| match l.find("//") {
            Some(i) => &l[..i],
            None => l,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn all_sources() -> Vec<std::path::PathBuf> {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut v = Vec::new();
    walk(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut v);
    v
}

/// 시험 `db_ai_write_is_reached_only_by_the_operations_executor`(3b) — 쓰기 실행 모듈(`db::ai_write`)을 부르는 제품 코드는 작업안 실행기
/// (`operations/db_exec.rs`) 하나다(MCP · Tauri 명령 · 서버 op 에서 닿지 않는다). 그 모듈은 사람 타일의 표(항목 · 임대 · 작업)와 3a 읽기
/// 풀(`acquire` · `POOL`)에 닿지 않고, 쓰기 연결은 버려질 때 닫힌다. 사전 검증 모듈(`db::ai_plan`)은 연결 · 엔진을 모른다.
#[test]
fn db_ai_write_is_reached_only_by_the_operations_executor() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for f in all_sources() {
        let rel = f.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        if rel.ends_with("tests.rs") || rel.contains("/tests/") || rel == "db/ai_write.rs" || rel == "db.rs" {
            continue;
        }
        let code = code_of(&rel);
        if code.contains("ai_write") {
            assert_eq!(rel, "operations/db_exec.rs", "{rel} 가 db::ai_write 에 닿는다");
        }
    }
    let w = code_of("db/ai_write.rs");
    for needle in [
        "table::lookup", "table::open", "table::query", "table::script", "table::close", "table::detach", "table::set_write", "table::set_auto_commit", "table::tx_",
        "&TABLE", "by_stream", "by_handle", "lease", "ConnRef", "POOL", "acquire(", "ai::run(",
    ] {
        assert!(!w.contains(needle), "db/ai_write.rs 에 {needle}");
    }
    assert!(w.contains("impl Drop for WriteConn") && w.contains("self.engine.shutdown()"), "쓰기 연결은 버려지면 닫힌다");
    assert!(w.contains("with_affected_cap(max_affected)"), "영향 행 상한을 건다");
    assert!(w.contains("ScriptMode::Write"), "2단계 쓰기 실행기(한 트랜잭션)");
    let p = code_of("db/ai_plan.rs");
    for needle in ["connect", "Pg::", "Mysql::", "Sqlite::", "table::", "execute(", "spawn", "set_write", "open("] {
        assert!(!p.contains(needle), "db/ai_plan.rs 에 {needle} — 사전 검증은 연결을 모른다");
    }
}

// ---------------------------------------------------------------------------
// 시험 세계 — MCP 뒷면 + 실행기의 바깥
// ---------------------------------------------------------------------------

struct World {
    conns: Mutex<Vec<DbConn>>,
    doc: Mutex<String>,
    password: Option<String>,
    audits: Mutex<Vec<AuditRecord>>,
}

impl World {
    fn new(conns: Vec<DbConn>, password: Option<&str>) -> Arc<World> {
        Arc::new(World {
            conns: Mutex::new(conns),
            doc: Mutex::new(String::new()),
            password: password.map(str::to_owned),
            audits: Mutex::default(),
        })
    }

    /// 그 연결의 단계를 지금 연결 신원으로 적는다(끔이면 지운다).
    fn grant(&self, id: &str, level: DbAiLevel) {
        let conn = self.conns.lock().unwrap().iter().find(|c| c.id == id).cloned().unwrap();
        let mut doc = self.doc.lock().unwrap();
        *doc = upsert_database_in_doc(&doc, id, &DbIdentity::of(&conn, None), level, Some(true)).unwrap();
    }

    fn delegation(&self) -> Delegation {
        Delegation::parse(&self.doc.lock().unwrap()).unwrap()
    }
}

impl AiDb for World {
    fn connections(&self) -> Vec<DbConn> {
        self.conns.lock().unwrap().clone()
    }
    fn via_target(&self, _alias: &str) -> Option<String> {
        None
    }
    fn run(&self, _grant: &Grant, _req: AiRequest) -> Result<AiOutcome, String> {
        Err("this test world does not read".into())
    }
    fn audit(&self, rec: AuditRecord) {
        self.audits.lock().unwrap().push(rec);
    }
}

impl DbWorld for World {
    fn facts(&self) -> DbFacts {
        DbFacts { delegation: self.delegation(), conns: self.connections(), via_targets: Default::default() }
    }
    fn password(&self) -> PasswordSource {
        PasswordSource::Given(self.password.clone())
    }
}

fn plane(world: &Arc<World>, audit_dir: Option<std::path::PathBuf>) -> OpsPlane {
    OpsPlane {
        env: OpEnv {
            emit: Arc::new(|_: &str, _: Value| {}),
            ctx: crate::context::Store::default(),
            routing: crate::routing::RoutingTable::default(),
        },
        ops: OperationStore::default(),
        results: ResultStore::default(),
        cancels: Default::default(),
        rate: Arc::new(Default::default()),
        budget: operations::ExecBudget::default().0,
        audit: crate::audit::Audit::in_dir(audit_dir),
        auto: Default::default(),
        unseen: Default::default(),
        db: Arc::clone(world) as Arc<dyn DbWorld>,
    }
}

/// MCP 도구 하나(블로킹 — 요청 스레드와 같다) → `(isError, 글)`.
fn mcp(world: &Arc<World>, ops: &OperationStore, name: &str, args: Value) -> (bool, String) {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
    let d = world.delegation();
    let env = DbEnv::new(Arc::clone(world) as Arc<dyn AiDb>);
    let results: ResultStore = Default::default();
    let RpcReply::Json(s) = dispatch_full(&Default::default(), ops, &results, &McpSignal::default(), &body.to_string(), || d, &env) else {
        panic!("알림")
    };
    let v: Value = serde_json::from_str(&s).unwrap();
    let r = &v["result"];
    (r["isError"].as_bool().unwrap_or(false), r["content"][0]["text"].as_str().unwrap().to_string())
}

fn tool_names(world: &Arc<World>) -> Vec<String> {
    let d = world.delegation();
    let env = DbEnv::new(Arc::clone(world) as Arc<dyn AiDb>);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
    let RpcReply::Json(s) = dispatch_full(&Default::default(), &Default::default(), &Default::default(), &McpSignal::default(), &body, || d, &env)
    else {
        panic!()
    };
    let v: Value = serde_json::from_str(&s).unwrap();
    v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

/// MCP 로 만들고 검토 요청까지 — 작업안 id.
fn propose(world: &Arc<World>, ops: &OperationStore, conn: &str, statements: &[&str], max_affected: u64) -> String {
    let (err, text) = mcp(
        world,
        ops,
        "create_db_write_plan",
        json!({ "summary": "시험 문장", "effect": "write", "connId": conn, "statements": statements, "maxAffected": max_affected, "title": "시험", "timeoutSeconds": 20 }),
    );
    assert!(!err, "만들기: {text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["operation"]["state"], "draft", "{v}");
    let id = v["operationId"].as_str().unwrap().to_string();
    let (err, text) = mcp(world, ops, "request_execution", json!({ "operationId": id }));
    assert!(!err, "검토 요청: {text}");
    id
}

fn manual(p: &OpsPlane, id: &str) -> Result<operations::Operation, String> {
    approve_in_with(p, id.to_string(), Some("manual".into()), crate::settings::AutomationPrefs::default(), Delegation::default)
}

/// 끝날 때까지 기다린다 — 봉한 상태와 그 대상 칸.
async fn finished(p: &OpsPlane, id: &str) -> (OperationState, TargetResult) {
    for _ in 0..600 {
        let state = p.ops.lock().unwrap()[id].state;
        if !matches!(state, OperationState::Approved | OperationState::Running) {
            let rs = operations::results_snapshot(&p.results, id);
            assert_eq!(rs.len(), 1, "대상은 db:<id> 하나");
            assert!(rs[0].0.starts_with("db:"));
            return (state, rs[0].1.clone());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("작업안이 끝나지 않았다");
}

fn outcome(r: &TargetResult) -> (&str, Option<&str>) {
    let db = r.db.as_ref().expect("db 결과");
    (db["outcome"].as_str().unwrap(), db.get("reason").and_then(Value::as_str))
}

// ---------------------------------------------------------------------------
// SQLite — 늘 돈다
// ---------------------------------------------------------------------------

fn sqlite_conn(id: &str, path: &std::path::Path) -> DbConn {
    DbConn {
        id: id.into(),
        name: format!("{id} 이름"),
        engine: DbEngine::Sqlite,
        via: None,
        path: Some(path.to_string_lossy().to_string()),
        host: None,
        port: None,
        database: None,
        user: None,
        tls_mode: None,
        tls_ca: None,
        folder: None,
    }
}

fn sqlite_rows(file: &std::path::Path) -> Vec<(i64, String)> {
    let c = rusqlite::Connection::open(file).unwrap();
    let mut st = c.prepare("SELECT id, v FROM t ORDER BY id").unwrap();
    st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
}

fn audit_text(dir: &std::path::Path) -> String {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().filter_map(|e| std::fs::read_to_string(e.path()).ok()).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

/// SQLite — 작업안 생성 → 사람 승인 → 서버 실행(커밋 · 다른 연결에서 보임) · `maxAffected` 초과 → 되돌림 · 문장 오류 → 되돌림 · 승인 전 권한
/// 내림 · 대상 바뀜 → 실행 안 됨 · 거절 · 만료 → 그대로 · 자동 승인 거부 · 사전 거절 → 작업안 없음 · 감사에 값 없음.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sqlite_write_plan_runs_only_after_a_person_approves() {
    let dir = std::env::temp_dir().join(format!("aynx-aiw-sqlite-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("app.db");
    let other = dir.join("other.db");
    for f in [&file, &other] {
        let c = rusqlite::Connection::open(f).unwrap();
        c.execute_batch(
            "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL); \
             INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'e');",
        )
        .unwrap();
    }
    let before = sqlite_rows(&file);
    let id = "AiW_sqlite_01";
    let world = World::new(vec![sqlite_conn(id, &file)], None);
    let audit_dir = dir.join("audit");
    let p = plane(&world, Some(audit_dir.clone()));

    // 단계마다 — 도구는 늘 목록에 있고(2026-11-09) 판정은 호출마다: 끔 = 없는 연결 / 읽기 전용 = 거절 / 승인 후 실행 = 통한다(아래).
    let ask = |w: &Arc<World>| mcp(w, &p.ops, "create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": id, "statements": ["DELETE FROM t"], "maxAffected": 5 }));
    assert!(tool_names(&world).iter().any(|n| n == "create_db_write_plan"), "끔이어도 목록에 있다");
    let (err, text) = ask(&world);
    assert!(err && text.contains("Unknown database connection"), "{text}");
    world.grant(id, DbAiLevel::Read);
    assert!(tool_names(&world).iter().any(|n| n == "create_db_write_plan"), "읽기 전용이어도 목록에 있다");
    let (err, text) = ask(&world);
    assert!(err && text.contains("needs 'Ask'"), "{text}");
    world.grant(id, DbAiLevel::Approve);
    assert!(tool_names(&world).iter().any(|n| n == "create_db_write_plan"));
    assert!(p.ops.lock().unwrap().is_empty(), "권한이 모자라면 작업안이 생기지 않는다");

    // 사전 거절 — 트랜잭션 문장 · 한 항목에 두 문장 · maxAffected 없음 → 작업안 없음.
    for args in [
        json!({ "summary": "s", "effect": "delete", "connId": id, "statements": ["UPDATE t SET v = 'x'", "COMMIT"], "maxAffected": 5 }),
        json!({ "summary": "s", "effect": "delete", "connId": id, "statements": ["DELETE FROM t; DELETE FROM t"], "maxAffected": 5 }),
        json!({ "summary": "s", "effect": "delete", "connId": id, "statements": ["DELETE FROM t"] }),
    ] {
        let (err, text) = mcp(&world, &p.ops, "create_db_write_plan", args.clone());
        assert!(err, "{args} → {text}");
    }
    assert!(p.ops.lock().unwrap().is_empty(), "사전 거절이면 작업안이 생기지 않는다");

    // 1) 커밋 — 다른 연결에서 보인다 · RETURNING 행 · 문장별 영향 행.
    let op = propose(&world, &p.ops, id, &["UPDATE t SET v = 'new' WHERE id <= 2", "INSERT INTO t VALUES (10, 'ten') RETURNING id"], 3);
    {
        let map = p.ops.lock().unwrap();
        let o = &map[&op];
        let plan = o.db.as_ref().unwrap();
        assert_eq!((o.targets.clone(), plan.max_affected, plan.statements.len()), (vec![format!("db:{id}")], 3, 2));
        // AI 가 읽는 작업안에 주소 · 경로 · 신원 스냅샷이 없다.
        let js = serde_json::to_string(o).unwrap();
        assert!(!js.contains("app.db") && !js.contains("identity"), "{js}");
    }
    // 자동 승인은 늘 거부 — 정책을 다 열어도.
    let open_prefs = crate::settings::AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["*".into(), "UPDATE".into()],
        ..Default::default()
    };
    let e = approve_in_with(&p, op.clone(), Some("auto".into()), open_prefs.clone(), Delegation::default).unwrap_err();
    assert!(e.contains("DB") || e.contains("Database"), "{e}");
    assert_eq!(p.ops.lock().unwrap()[&op].state, OperationState::AwaitingApproval);
    assert_eq!(sqlite_rows(&file), before, "승인 대기 중에는 아무것도 바뀌지 않는다");
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, r.state), (OperationState::Succeeded, TargetState::Succeeded), "{r:?}");
    assert_eq!(outcome(&r), ("committed", None));
    let db = r.db.clone().unwrap();
    assert_eq!(db["totalAffected"], 3);
    assert_eq!(db["statements"][0]["affected"], 2);
    assert_eq!(db["statements"][1]["rows"], json!([[10]]));
    let after = sqlite_rows(&file);
    assert_eq!(&after[..2], &[(1, "new".to_string()), (2, "new".to_string())]);
    assert!(after.contains(&(10, "ten".to_string())));

    // 2) maxAffected 초과 → 커밋 전에 전부 되돌림.
    let snap = sqlite_rows(&file);
    let op = propose(&world, &p.ops, id, &["UPDATE t SET v = 'z' WHERE id = 1", "UPDATE t SET v = 'z'"], 2);
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r)), (OperationState::Failed, ("rolledBack", Some("maxAffected"))), "{r:?}");
    assert!(r.error_class.as_deref().unwrap_or("").contains('2'), "{r:?}");
    assert_eq!(sqlite_rows(&file), snap, "상한 초과 — 데이터 그대로");

    // 3) 문장 오류 → 전부 되돌림.
    let op = propose(&world, &p.ops, id, &["UPDATE t SET v = 'err' WHERE id = 3", "INSERT INTO t VALUES (1, 'dup')"], 5);
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r)), (OperationState::Failed, ("rolledBack", Some("error"))), "{r:?}");
    assert_eq!(r.db.as_ref().unwrap()["failed"]["index"], 1);
    assert_eq!(sqlite_rows(&file), snap, "문장 오류 — 데이터 그대로");

    // 4) 승인 대기 중 권한을 내림 → 실행하지 않는다.
    let op = propose(&world, &p.ops, id, &["DELETE FROM t WHERE id = 5"], 1);
    world.grant(id, DbAiLevel::Read);
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r).0), (OperationState::Failed, "notRun"), "{r:?}");
    assert!(r.error_class.as_deref().unwrap().contains("'Ask'"));
    assert_eq!(sqlite_rows(&file), snap);
    world.grant(id, DbAiLevel::Approve);

    // 5) 승인 대기 중 연결이 다른 파일을 가리키게 바뀌고 새 대상에 권한을 다시 줌 → 사람이 검토한 대상이 아니다, 실행하지 않는다.
    let op = propose(&world, &p.ops, id, &["DELETE FROM t WHERE id = 5"], 1);
    world.conns.lock().unwrap()[0].path = Some(other.to_string_lossy().to_string());
    world.grant(id, DbAiLevel::Approve);
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r).0), (OperationState::Failed, "notRun"), "{r:?}");
    assert_eq!(sqlite_rows(&other).len(), 5, "바뀐 대상도 그대로");
    world.conns.lock().unwrap()[0].path = Some(file.to_string_lossy().to_string());
    world.grant(id, DbAiLevel::Approve);

    // 6) 거절 · 만료 → 아무것도 안 바뀐다.
    let op = propose(&world, &p.ops, id, &["DELETE FROM t"], 10);
    crate::operations::commands::reject_in(&p, &op).unwrap();
    assert!(manual(&p, &op).is_err());
    let op2 = propose(&world, &p.ops, id, &["DELETE FROM t"], 10);
    p.ops.lock().unwrap().get_mut(&op2).unwrap().expires_at = Some(1);
    assert!(manual(&p, &op2).is_err());
    assert_eq!(p.ops.lock().unwrap()[&op2].state, OperationState::Expired);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(sqlite_rows(&file), snap, "거절 · 만료 — 그대로");
    assert!(operations::results_snapshot(&p.results, &op).is_empty(), "실행 칸도 없다");

    // 감사 — 승인 · 끝 줄이 남고, 값(행)은 없다.
    let mut text = String::new();
    for _ in 0..50 {
        text = audit_text(&audit_dir);
        if text.matches("\"dbWrite\"").count() >= 4 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(text.contains("\"maxAffected\":3") && text.contains("\"totalAffected\":3") && text.contains("\"outcome\":\"committed\""), "{text}");
    assert!(text.contains("\"reason\":\"maxAffected\""), "{text}");
    assert!(!text.contains("\"ten\"") && !text.contains("[[10]]"), "감사에 결과 값: {text}");
    drop(p);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 시험 `auto_never_approves_db_targets`(B-9) — 서버 안 자동 승인 진입점(`sweep` → `approve_in(…, "auto")`)이 DB 작업안을 **시도조차 하지
/// 않고**, 직접 `auto` 로 불러도 정책 · 대상 권한 · 빈도 판정 **전에** 거부한다. 게이트의 대상 권한 문도 `db:` 를 늘 막는다.
#[tokio::test]
async fn auto_never_approves_db_targets() {
    let dir = std::env::temp_dir().join(format!("aynx-aiw-auto-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("a.db");
    rusqlite::Connection::open(&file).unwrap().execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL)").unwrap();
    let id = "AiW_auto_0001";
    let world = World::new(vec![sqlite_conn(id, &file)], None);
    world.grant(id, DbAiLevel::Approve);
    let p = plane(&world, None);
    let op = propose(&world, &p.ops, id, &["INSERT INTO t VALUES (1, 'x')"], 1);
    let open = crate::settings::AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["*".into(), "INSERT".into(), "INSERT INTO t VALUES (1, 'x');".into()],
        auto_max_per_window: 100,
        ..Default::default()
    };
    // 훑기는 DB 작업안을 후보로 고르지 않는다.
    let pending: Vec<operations::Operation> = p.ops.lock().unwrap().values().cloned().collect();
    assert!(operations::auto::candidates(&pending, &Default::default(), &Default::default(), &open, |_| false).is_empty());
    let mut called = 0;
    operations::auto::sweep_with(&p, &open, Delegation::default, |_| {
        called += 1;
        Err("부르면 안 된다".into())
    });
    assert_eq!(called, 0, "자동 승인 훑기는 DB 작업안을 시도하지 않는다");
    // 직접 auto 로 — 게이트 전에 거부, 대기 그대로.
    let e = approve_in_with(&p, op.clone(), Some("auto".into()), open.clone(), Delegation::default).unwrap_err();
    assert!(e.contains("DB") || e.contains("Database"), "{e}");
    assert_eq!(p.ops.lock().unwrap()[&op].state, OperationState::AwaitingApproval);
    assert!(p.rate.0.lock().unwrap().is_empty(), "빈도 한도 칸도 먹지 않는다");
    // 대상 권한 문(그물).
    assert!(operations::auto_execute_reject_reason(&[format!("db:{id}")], &Default::default(), &Delegation::default()).is_some());
    // DB 작업안의 대상은 고칠 수 없다.
    assert!(operations::commands::modify_in(&p, &op, vec!["w:1".into()]).is_err());
    let n: i64 = rusqlite::Connection::open(&file).unwrap().query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 시험 `approve_all_auto_approves_db_write_plans`(2026-10-23 — 모두 승인) — 연결이 'YOLO'(`all`)이면 훑기가 DB 작업안을 후보로 고르고
/// `approve_in(…, "auto")` 가 승인한다 — 실행은 예전 길 그대로(재판정 · 쓰기 연결 · 한 트랜잭션 · 커밋). 전체 스위치가 꺼지면 사람을 기다리고,
/// 연결의 대상이 바뀌면(스냅샷 어긋남) 모두 승인이 아니다. 'Ask' 는 여전히 거부된다(`auto_never_approves_db_targets`).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn approve_all_auto_approves_db_write_plans() {
    let dir = std::env::temp_dir().join(format!("aynx-aiw-all-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("a.db");
    rusqlite::Connection::open(&file).unwrap().execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL)").unwrap();
    let id = "AiW_all_00001";
    let world = World::new(vec![sqlite_conn(id, &file)], None);
    world.grant(id, DbAiLevel::All);
    let p = plane(&world, None);
    let on = crate::settings::AutomationPrefs { auto_approve: true, ..Default::default() };
    let off = crate::settings::AutomationPrefs { auto_approve: false, ..Default::default() };
    // 'YOLO' 에서도 작업안 도구는 선다(승인 후 실행 이상).
    assert!(tool_names(&world).iter().any(|n| n == "create_db_write_plan"));
    let op = propose(&world, &p.ops, id, &["INSERT INTO t VALUES (1, 'x')"], 1);
    let pr = &p;
    let auto = |prefs: &crate::settings::AutomationPrefs| {
        let prefs = prefs.clone();
        move |id: &str| approve_in_with(pr, id.to_string(), Some("auto".into()), prefs.clone(), Delegation::default)
    };

    // 전체 스위치 끔 — 시도하지 않고, 직접 불러도 거부 · 대기 그대로.
    assert_eq!(operations::auto::sweep_with(&p, &off, Delegation::default, auto(&off)), 0);
    assert!(approve_in_with(&p, op.clone(), Some("auto".into()), off.clone(), Delegation::default).is_err());
    assert_eq!(p.ops.lock().unwrap()[&op].state, OperationState::AwaitingApproval);

    // 대상이 바뀌면 모두 승인이 아니다(스냅샷 어긋남 → 끔으로 읽힌다).
    let real = world.conns.lock().unwrap()[0].path.clone();
    world.conns.lock().unwrap()[0].path = Some(dir.join("other.db").to_string_lossy().to_string());
    let e = approve_in_with(&p, op.clone(), Some("auto".into()), on.clone(), Delegation::default).unwrap_err();
    assert!(e.contains("DB") || e.contains("Database"), "{e}");
    world.conns.lock().unwrap()[0].path = real;

    // 켬 — 훑기가 승인하고 실행기가 커밋한다.
    assert_eq!(operations::auto::sweep_with(&p, &on, Delegation::default, auto(&on)), 1);
    let o = p.ops.lock().unwrap()[&op].clone();
    assert!(o.approve_all && o.approval_method.as_deref() == Some("auto"), "{o:?}");
    let (state, r) = finished(&p, &op).await;
    assert_eq!(state, OperationState::Succeeded, "{r:?}");
    assert_eq!(outcome(&r).0, "committed");
    let n: i64 = rusqlite::Connection::open(&file).unwrap().query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 시험 `db_plan_recheck_before_execute`(B-9) — 재판정은 순수다: 권한 'Ask' + 지금 신원 = 만들 때 신원일 때만 증표. 내림 · 끔 · 지움 ·
/// 대상 바뀜(권한을 새 대상에 다시 줬어도)은 실행하지 않는다.
#[test]
fn db_plan_recheck_before_execute() {
    use crate::operations::db_exec::db_recheck;
    let file = std::path::Path::new("C:/nowhere/x.db");
    let conn = sqlite_conn("AiW_recheck01", file);
    let world = World::new(vec![conn.clone()], None);
    world.grant(&conn.id, DbAiLevel::Approve);
    let plan = operations::DbPlan {
        conn_id: conn.id.clone(),
        conn_name: conn.name.clone(),
        engine: "sqlite".into(),
        database: None,
        through_ssh: false,
        statements: vec![],
        max_affected: 1,
        timeout_seconds: 30,
        identity: Some(DbIdentity::of(&conn, None)),
    };
    assert!(db_recheck(&plan, &world.facts()).is_ok());
    world.grant(&conn.id, DbAiLevel::Read);
    assert!(db_recheck(&plan, &world.facts()).is_err(), "내림");
    world.grant(&conn.id, DbAiLevel::Off);
    assert!(db_recheck(&plan, &world.facts()).is_err(), "끔");
    world.grant(&conn.id, DbAiLevel::Approve);
    world.conns.lock().unwrap()[0].path = Some("C:/nowhere/y.db".into());
    world.grant(&conn.id, DbAiLevel::Approve);
    let why = db_recheck(&plan, &world.facts()).err().expect("대상 바뀜");
    assert!(why.contains("바뀌") || why.contains("changed"), "{why}");
    world.conns.lock().unwrap().clear();
    assert!(db_recheck(&plan, &world.facts()).is_err(), "지움");
}

// ---------------------------------------------------------------------------
// 실제 서버(Docker) — `#[ignore]` + 환경변수
// ---------------------------------------------------------------------------

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn net_conn(id: &str, engine: DbEngine, host: &str, port: u16, database: Option<&str>, user: &str) -> DbConn {
    DbConn {
        id: id.into(),
        name: id.into(),
        engine,
        via: None,
        path: None,
        host: Some(host.into()),
        port: Some(port),
        database: database.map(str::to_owned),
        user: Some(user.into()),
        tls_mode: Some(DbTlsMode::Disable),
        tls_ca: None,
        folder: None,
    }
}

/// 사람 타일을 표로 연다(그 연결 줄을 시험 연결 목록 파일에 — `conns::set_path_override`) — 손잡이 · 임대.
async fn open_tile(stream: &str, conn: &DbConn, pw: &str) -> super::table::Opened {
    let dir = std::env::temp_dir().join(format!("aynx-aiw-tile-{}-{}", conn.id, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("db-connections.json");
    std::fs::write(&file, serde_json::to_string(&[conn]).unwrap()).unwrap();
    super::conns::set_path_override(Some(file));
    super::table::conn_opened(7_700_401);
    let secrets = super::net::OpenSecrets { password: Some(zeroize::Zeroizing::new(pw.to_string())), ssh: Default::default(), vault: true, from_vault: false };
    match super::table::open(stream.into(), stream.into(), 7_700_401, super::table::ConnRef { id: conn.id.clone() }, secrets).await {
        Ok(o) => o,
        Err(super::net::OpenError::Msg(m)) => panic!("타일 열기: {m}"),
        Err(super::net::OpenError::Ssh(e)) => panic!("ssh {e:?}"),
    }
}

/// 엔진마다 같은 꼴 — `count` 는 다른 연결에서 세는 함수(관리 연결), `pid_sql` 은 백엔드 번호, `pid_insert` 는 그 번호를 적는 문장.
#[allow(clippy::too_many_arguments)]
async fn net_suite<F, Fut>(label: &str, conn: DbConn, pw: &str, pid_sql: &str, pid_insert: &str, refused: &[&str], count: F)
where
    F: Fn(&'static str) -> Fut,
    Fut: std::future::Future<Output = i64>,
{
    let world = World::new(vec![conn.clone()], Some(pw));
    world.grant(&conn.id, DbAiLevel::Approve);
    let p = plane(&world, None);
    let id = conn.id.as_str();
    let make = |stmts: Vec<String>, max: u64| {
        let (w, ops) = (Arc::clone(&world), Arc::clone(&p.ops));
        let id = id.to_string();
        async move {
            tokio::task::spawn_blocking(move || {
                let s: Vec<&str> = stmts.iter().map(String::as_str).collect();
                propose(&w, &ops, &id, &s, max)
            })
            .await
            .unwrap()
        }
    };

    // 사전 거절(엔진마다) — 작업안 없음.
    for sql in refused {
        let (w, ops, sql_s) = (Arc::clone(&world), Arc::clone(&p.ops), sql.to_string());
        let id_s = id.to_string();
        let (err, text) = tokio::task::spawn_blocking(move || {
            mcp(&w, &ops, "create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": id_s, "statements": [sql_s], "maxAffected": 10 }))
        })
        .await
        .unwrap();
        assert!(err, "{label}: 거절돼야 한다 {sql} → {text}");
        println!("MEASURE {label} refused {sql:?} → {}", text.chars().take(140).collect::<String>());
    }
    assert!(p.ops.lock().unwrap().is_empty());

    // 사람 타일 — 쓰기를 켜고 트랜잭션 작업을 연 채(풀러 뒤에서도 그 백엔드에 고정된다) 백엔드 번호를 읽는다.
    let tile = open_tile(&format!("aiw-tile-{label}"), &conn, pw).await;
    super::table::set_write(tile.handle, tile.lease, true).await.unwrap();
    let tx = super::table::tx_begin(tile.handle, tile.lease).await.unwrap().id;
    let human = super::table::query(tile.handle, tile.lease, pid_sql.into(), "q".into(), 10, 5_000, Some(tx)).await.unwrap();
    let human_pid = human.rows[0][0].to_string().trim_matches('"').to_string();

    // 1) 커밋 — 다른 연결에서 보인다 · 실행 연결은 사람 타일과 다른 백엔드.
    let op = make(vec!["UPDATE w3_t SET v = 'new' WHERE id <= 2".into(), pid_insert.into()], 3).await;
    assert_eq!(count("w3_new").await, 0, "{label}: 승인 전엔 아무것도");
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r)), (OperationState::Succeeded, ("committed", None)), "{label}: {r:?}");
    assert_eq!(count("w3_new").await, 2, "{label}: 다른 연결에서 커밋이 보인다");
    let ai_pid = count("w3_pid").await.to_string();
    println!("MEASURE {label} pid human={human_pid} ai={ai_pid}");
    assert_ne!(human_pid, ai_pid, "{label}: 실행 연결은 사람 타일과 다른 백엔드");
    super::table::tx_end(tile.handle, tile.lease, tx, false).await.unwrap();
    super::table::close(tile.handle, None).unwrap();
    super::conns::set_path_override(None);

    // 2) maxAffected 초과 → 되돌림.
    let op = make(vec!["UPDATE w3_t SET v = 'z'".into()], 2).await;
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r)), (OperationState::Failed, ("rolledBack", Some("maxAffected"))), "{label}: {r:?}");
    assert_eq!(count("w3_z").await, 0, "{label}: 상한 초과 — 그대로");
    assert_eq!(count("w3_new").await, 2);

    // 3) 문장 오류 → 되돌림.
    let op = make(vec!["UPDATE w3_t SET v = 'z' WHERE id = 3".into(), "INSERT INTO w3_t VALUES (1, 'dup')".into()], 5).await;
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r)), (OperationState::Failed, ("rolledBack", Some("error"))), "{label}: {r:?}");
    assert_eq!(count("w3_z").await, 0, "{label}: 문장 오류 — 그대로");

    // 4) 승인 전 권한 내림 → 실행 안 됨.
    let op = make(vec!["UPDATE w3_t SET v = 'z'".into()], 10).await;
    world.grant(id, DbAiLevel::Read);
    manual(&p, &op).unwrap();
    let (state, r) = finished(&p, &op).await;
    assert_eq!((state, outcome(&r).0), (OperationState::Failed, "notRun"), "{label}: {r:?}");
    assert_eq!(count("w3_z").await, 0);
    world.grant(id, DbAiLevel::Approve);

    // 5) 거절 · 만료 → 그대로.
    let op = make(vec!["UPDATE w3_t SET v = 'z'".into()], 10).await;
    crate::operations::commands::reject_in(&p, &op).unwrap();
    let op2 = make(vec!["UPDATE w3_t SET v = 'z'".into()], 10).await;
    p.ops.lock().unwrap().get_mut(&op2).unwrap().expires_at = Some(1);
    assert!(manual(&p, &op2).is_err());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(count("w3_z").await, 0, "{label}: 거절 · 만료 — 그대로");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL (+ AYNX_TEST_PG_POOLER)"]
async fn pg_write_plan() {
    use std::str::FromStr;
    let Some(url) = env("AYNX_TEST_PG_URL") else { return };
    let cfg = tokio_postgres::Config::from_str(&url).unwrap();
    let pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let port = cfg.get_ports()[0];
    let user = cfg.get_user().unwrap().to_string();
    let (a, c) = cfg.connect(tokio_postgres::NoTls).await.unwrap();
    tokio::spawn(c);
    let a = Arc::new(a);
    let pooler = env("AYNX_TEST_PG_POOLER").and_then(|v| v.rsplit_once(':').map(|(h, p)| (h.to_string(), p.parse::<u16>().unwrap())));
    let mut rows = vec![("direct", "127.0.0.1".to_string(), port)];
    if let Some((h, p)) = pooler {
        rows.push(("pooler", h, p));
    }
    for (label, host, port) in rows {
        a.batch_execute(
            "DROP TABLE IF EXISTS w3_t; DROP TABLE IF EXISTS w3_pid; CREATE TABLE w3_t(id int PRIMARY KEY, v text NOT NULL); \
             CREATE TABLE w3_pid(pid bigint); INSERT INTO w3_t SELECT g, 'v' || g FROM generate_series(1, 5) g;",
        )
        .await
        .unwrap();
        let conn = net_conn(&format!("AiW_pg_{label}"), DbEngine::Postgres, &host, port, cfg.get_dbname(), &user);
        let a2 = Arc::clone(&a);
        let count = move |what: &'static str| {
            let a = Arc::clone(&a2);
            async move {
                let sql = match what {
                    "w3_new" => "SELECT count(*) FROM w3_t WHERE v = 'new'",
                    "w3_z" => "SELECT count(*) FROM w3_t WHERE v = 'z'",
                    _ => "SELECT coalesce(max(pid), 0) FROM w3_pid",
                };
                let row = a.query_one(sql, &[]).await.unwrap();
                row.try_get::<_, i64>(0).unwrap_or_else(|_| row.get::<_, i32>(0) as i64)
            }
        };
        net_suite(
            &format!("pg-{label}"),
            conn,
            &pw,
            "SELECT pg_backend_pid()",
            "INSERT INTO w3_pid SELECT pg_backend_pid()",
            &["COMMIT", "VACUUM w3_t", "CREATE INDEX CONCURRENTLY w3_i ON w3_t(v)", "SET LOCAL statement_timeout = 0; DELETE FROM w3_t"],
            count,
        )
        .await;
    }
    a.batch_execute("DROP TABLE IF EXISTS w3_t; DROP TABLE IF EXISTS w3_pid").await.unwrap();
}

async fn my_case(var: &str, label: &str, engine: DbEngine) {
    use mysql_async::prelude::Queryable;
    let Some(url) = env(var) else { return };
    let opts = mysql_async::Opts::from_url(&url).unwrap();
    let pw = opts.pass().unwrap_or_default().to_string();
    let mut a = mysql_async::Conn::new(opts.clone()).await.unwrap();
    a.query_drop(
        "DROP DATABASE IF EXISTS w3; CREATE DATABASE w3; CREATE TABLE w3.w3_t(id INT PRIMARY KEY, v VARCHAR(20) NOT NULL) ENGINE=InnoDB; \
         CREATE TABLE w3.w3_pid(pid BIGINT) ENGINE=InnoDB; INSERT INTO w3.w3_t VALUES (1,'v1'),(2,'v2'),(3,'v3'),(4,'v4'),(5,'v5');",
    )
    .await
    .unwrap();
    let conn = net_conn(&format!("AiW_{label}_conn01"), engine, "127.0.0.1", opts.tcp_port(), Some("w3"), opts.user().unwrap());
    let shared = Arc::new(tokio::sync::Mutex::new(a));
    let s2 = Arc::clone(&shared);
    let count = move |what: &'static str| {
        let s = Arc::clone(&s2);
        async move {
            let sql = match what {
                "w3_new" => "SELECT count(*) FROM w3.w3_t WHERE v = 'new'",
                "w3_z" => "SELECT count(*) FROM w3.w3_t WHERE v = 'z'",
                _ => "SELECT coalesce(max(pid), 0) FROM w3.w3_pid",
            };
            s.lock().await.query_first::<i64, _>(sql).await.unwrap().unwrap()
        }
    };
    net_suite(
        label,
        conn,
        &pw,
        "SELECT CONNECTION_ID()",
        "INSERT INTO w3_pid SELECT CONNECTION_ID()",
        &["COMMIT", "ALTER TABLE w3_t ADD c INT", "SET autocommit = 0", "LOCK TABLES w3_t WRITE", "START TRANSACTION"],
        count,
    )
    .await;
    shared.lock().await.query_drop("DROP DATABASE IF EXISTS w3").await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL"]
async fn mysql_write_plan() {
    my_case("AYNX_TEST_MY_URL", "my", DbEngine::Mysql).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB"]
async fn mariadb_write_plan() {
    my_case("AYNX_TEST_MARIA_URL", "maria", DbEngine::Mariadb).await;
}
