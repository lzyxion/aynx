//! **AI DB 평면 시험**(쿼리 타일 3단계 3a — docs/log/2026-10-13-db-write-mcp-design.md B-9). MCP 경유(`mcp::dispatch_full` + 시험 뒷면 —
//! 진짜 `db::ai::run` 을 부르되 비밀번호는 몸으로) · 소스 훑기 · SQLite 는 늘 · 실제 서버는 `#[ignore]` + 환경변수(사용자 볼트 ·
//! `delegation.toml` · `db-connections.json` 은 건드리지 않는다 — 위임은 손으로 짠 것, 연결 목록은 시험 뒷면의 메모리).
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55433/postgres
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53316/
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53317/
//! cargo test --lib db::ai_tests -- --ignored --nocapture --test-threads=1
//! ```

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::ai::{self, AiDb, AiOutcome, AiRequest, DbAiLevel, Grant, PasswordSource};
use super::conns::{DbConn, DbEngine, DbTlsMode};
use crate::audit::AuditRecord;
use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
use crate::delegation::Delegation;
use crate::mcp::{dispatch_full, DbEnv, McpSignal, RpcReply};

// ---------------------------------------------------------------------------
// 소스 훑기
// ---------------------------------------------------------------------------

fn src(rel: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(rel);
    let text = std::fs::read_to_string(&p).unwrap();
    // 시험 모듈(`#[cfg(test)] mod tests`) 앞까지 · 주석 줄을 뺀 코드.
    let body = match text.find("#[cfg(test)]\nmod tests") {
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

/// 시험 `db_ai_connections_are_read_only_forever`(B-9) — AI 평면 코드에 쓰기로 바꾸는 길이 없다: 쓰기 전환 · 트랜잭션 작업 · 쓰기 ·
/// 작업 안 스크립트 · 가드의 쓰기 모드 · SQLite 쓰기 열기를 부르지 않고, 조회는 읽기 전용 스크립트 계획을 지난다.
#[test]
fn db_ai_connections_are_read_only_forever() {
    let code = src("db/ai.rs");
    for needle in [
        "set_write", "set_mode", "tx_begin", "tx_end", "ScriptMode::Write", "ScriptMode::InWork", "Mode::Transaction", "Mode::AutoCommit",
        "query_unguarded", ", true)", "writable: true",
    ] {
        assert!(!code.contains(needle), "db/ai.rs 에 {needle}");
    }
    assert!(code.contains("ScriptMode::ReadOnly"), "조회는 읽기 전용 계획을 지난다");
    assert!(code.contains("Sqlite::open(std::path::Path::new(&path), false)"), "SQLite 는 읽기 전용 열기");
    assert!(code.contains("if engine.writable()"), "쓰기 가능으로 보이면 거절하는 그물");
}

/// 시험 `db_ai_never_touches_tile_entries`(B-9) — AI 평면은 사람 타일의 표(항목 · 타일 열쇠 · 임대 · 작업)에 닿지 않는다. 표에서 빌리는
/// 것은 엔진 꼴 · 연결 해석 · 시한 그물 · 문구뿐이다.
#[test]
fn db_ai_never_touches_tile_entries() {
    let code = src("db/ai.rs");
    for needle in [
        "table::lookup", "table::open", "table::query", "table::script", "table::schema", "table::objects", "table::close", "table::detach",
        "table::reattach", "table::set_auto_commit", "&TABLE", "by_stream", "by_handle", "lease", "ConnRef",
    ] {
        assert!(!code.contains(needle), "db/ai.rs 에 {needle}");
    }
    let mut used: Vec<&str> = code.match_indices("table::").map(|(i, _)| {
        let rest = &code[i + "table::".len()..];
        let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_')).unwrap_or(rest.len());
        &rest[..end]
    }).collect();
    used.sort_unstable();
    used.dedup();
    for u in used.iter().filter(|u| !u.is_empty()) {
        assert!(["run_timed", "message", "resolve_conn"].contains(u), "db/ai.rs 가 table::{u} 를 부른다");
    }
}

// ---------------------------------------------------------------------------
// MCP 경유 시험 뒷면
// ---------------------------------------------------------------------------

/// 진짜 `ai::run` 을 부르는 시험 뒷면 — 연결 목록은 메모리, 비밀번호는 연결마다 몸으로(없으면 `None` = 볼트 — 시험엔 볼트가 없다).
struct TestDb {
    conns: Vec<DbConn>,
    passwords: HashMap<String, String>,
    rt: tokio::runtime::Handle,
    audits: Mutex<Vec<AuditRecord>>,
}

impl AiDb for TestDb {
    fn connections(&self) -> Vec<DbConn> {
        self.conns.clone()
    }
    fn via_target(&self, _alias: &str) -> Option<String> {
        None
    }
    fn run(&self, grant: &Grant, req: AiRequest) -> Result<AiOutcome, String> {
        let pw = PasswordSource::Given(self.passwords.get(&grant_id(grant)).cloned());
        self.rt.block_on(ai::run(grant, req, &pw))
    }
    fn audit(&self, rec: AuditRecord) {
        self.audits.lock().unwrap().push(rec);
    }
}

/// 증표의 연결 id(시험 — 증표 칸은 비공개라 감사 줄 대신 디버그 꼴에서 읽지 않고, 목록과 대조한다).
fn grant_id(g: &Grant) -> String {
    ai::grant_conn_id_for_test(g)
}

fn delegation(grants: &[(&DbConn, DbAiLevel)]) -> Delegation {
    let mut doc = String::new();
    for (c, level) in grants {
        doc = upsert_database_in_doc(&doc, &c.id, &DbIdentity::of(c, None), *level).unwrap();
    }
    Delegation::parse(&doc).unwrap()
}

fn call(db: &Arc<TestDb>, d: &Delegation, name: &str, args: Value) -> (bool, String) {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
    let d = d.clone();
    let env = DbEnv::new(Arc::clone(db) as Arc<dyn AiDb>);
    let reply = dispatch_full(&Default::default(), &Default::default(), &Default::default(), &McpSignal::default(), &body.to_string(), || d, &env);
    let RpcReply::Json(s) = reply else { panic!("알림") };
    let v: Value = serde_json::from_str(&s).unwrap();
    let r = &v["result"];
    (r["isError"].as_bool().unwrap_or(false), r["content"][0]["text"].as_str().unwrap().to_string())
}

fn ok(db: &Arc<TestDb>, d: &Delegation, name: &str, args: Value) -> Value {
    let (err, text) = call(db, d, name, args);
    assert!(!err, "{name}: {text}");
    serde_json::from_str(&text).unwrap()
}

fn refused(db: &Arc<TestDb>, d: &Delegation, id: &str, sql: &str) -> String {
    let (err, text) = call(db, d, "db_query", json!({ "connId": id, "sql": sql }));
    assert!(err, "거절돼야 한다: {sql} → {text}");
    // 사람 타일의 "쓰기를 켜라" 안내는 AI 에 뜻이 없다(사람의 쓰기 모드는 AI 연결에 번지지 않는다).
    assert!(!text.contains("위 띠") && !text.contains("bar above"), "{sql} → {text}");
    text
}

fn tool_names(db: &Arc<TestDb>, d: &Delegation) -> Vec<String> {
    let d = d.clone();
    let env = DbEnv::new(Arc::clone(db) as Arc<dyn AiDb>);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
    let RpcReply::Json(s) = dispatch_full(&Default::default(), &Default::default(), &Default::default(), &McpSignal::default(), &body, || d, &env) else {
        panic!()
    };
    let v: Value = serde_json::from_str(&s).unwrap();
    v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

fn assert_audit_has_no(db: &TestDb, secrets: &[&str]) {
    let audits = db.audits.lock().unwrap();
    assert!(!audits.is_empty());
    let line = serde_json::to_string(&*audits).unwrap();
    for s in secrets {
        assert!(!line.contains(s), "감사에 결과 값 {s}: {line}");
    }
}

// ---------------------------------------------------------------------------
// SQLite — 늘 돈다
// ---------------------------------------------------------------------------

fn sqlite_conn(id: &str, path: &str) -> DbConn {
    DbConn {
        id: id.into(),
        name: id.into(),
        engine: DbEngine::Sqlite,
        via: None,
        path: Some(path.into()),
        host: None,
        port: None,
        database: None,
        user: None,
        tls_mode: None,
        tls_ca: None,
        folder: None,
    }
}

/// SQLite — MCP 경유 `db_query` 는 읽기 전용(쓰기 · 트랜잭션 · 세션 바꾸기 · CTE 안 쓰기 · ATTACH 전부 거절, 파일 그대로) · 여러 문장은
/// 읽기 스크립트 · 구조만 단계에서 `db_query` 거절 · 끔이면 목록에 없음 · 감사에 값 없음.
#[test]
fn sqlite_ai_reads_only_through_mcp() {
    let dir = std::env::temp_dir().join(format!("aynx-ai-sqlite-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("app.db");
    let _ = std::fs::remove_file(&file);
    {
        let c = rusqlite::Connection::open(&file).unwrap();
        c.execute_batch(
            "CREATE TABLE t(id INTEGER PRIMARY KEY, secret TEXT); \
             INSERT INTO t VALUES (1, 'SQLITE-SECRET-1'), (2, 'SQLITE-SECRET-2'), (3, 'SQLITE-SECRET-3'); \
             CREATE VIEW v AS SELECT id FROM t;",
        )
        .unwrap();
    }
    let path = file.to_string_lossy().to_string();
    let read = sqlite_conn("AiSqlite_read1", &path);
    let schema = sqlite_conn("AiSqlite_sch01", &path);
    let off = sqlite_conn("AiSqlite_off01", &path);
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let db = Arc::new(TestDb {
        conns: vec![read.clone(), schema.clone(), off.clone()],
        passwords: HashMap::new(),
        rt: rt.handle().clone(),
        audits: Mutex::default(),
    });
    let d = delegation(&[(&read, DbAiLevel::Read), (&schema, DbAiLevel::Schema)]);

    let names = tool_names(&db, &d);
    assert!(names.iter().any(|n| n == "db_query"));
    let list = ok(&db, &d, "list_db_connections", json!({}));
    let ids: Vec<&str> = list.as_array().unwrap().iter().map(|r| r["connId"].as_str().unwrap()).collect();
    assert_eq!(ids, [read.id.as_str(), schema.id.as_str()], "끔은 목록에 없다");
    assert!(!list.to_string().contains("app.db"), "파일 경로를 내보내지 않는다");

    // 읽기.
    let r = ok(&db, &d, "db_query", json!({ "connId": read.id, "sql": "SELECT count(*) AS n FROM t" }));
    assert_eq!(r["rows"], json!([[3]]));
    let r = ok(&db, &d, "db_query", json!({ "connId": read.id, "sql": "SELECT id FROM t ORDER BY id", "maxRows": 2 }));
    assert_eq!((r["rowCount"].as_u64(), r["truncated"].as_bool()), (Some(2), Some(true)));
    let r = ok(&db, &d, "db_query", json!({ "connId": read.id, "sql": "SELECT 1; SELECT count(*) FROM v" }));
    assert_eq!((r["script"].as_bool(), r["outcome"].as_str()), (Some(true), Some("readOnly")));
    assert_eq!(r["statements"].as_array().unwrap().len(), 2);

    // 쓰기 · 트랜잭션 · 세션 바꾸기 — 전부 거절, 파일 그대로.
    for sql in [
        "INSERT INTO t VALUES (9, 'x')",
        "COMMIT; INSERT INTO t VALUES (9, 'x')",
        "SELECT 1; INSERT INTO t VALUES (9, 'x')",
        "WITH x AS (SELECT 1) DELETE FROM t",
        "UPDATE t SET secret = 'x'",
        "BEGIN",
        "PRAGMA query_only = 0",
        "ATTACH 'other.db' AS o",
        "CREATE TABLE z(a)",
        "DROP TABLE t",
    ] {
        refused(&db, &d, &read.id, sql);
    }
    let n: i64 = rusqlite::Connection::open(&file).unwrap().query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 3, "AI 경로는 아무것도 바꾸지 않았다");
    assert!(!dir.join("other.db").exists());

    // 구조만 — 구조 도구는 되고 조회는 거절(엔진에 닿지 않는다).
    let text = refused(&db, &d, &schema.id, "SELECT 1");
    assert!(text.contains("permission is 'Schema'"), "{text}");
    let objs = ok(&db, &d, "db_list_objects", json!({ "connId": schema.id }));
    assert!(objs.to_string().contains("\"t\""), "{objs}");
    let det = ok(&db, &d, "db_describe_table", json!({ "connId": schema.id, "table": "t" }));
    assert!(det["columns"].to_string().contains("secret"), "{det}");
    let def = ok(&db, &d, "db_get_definition", json!({ "connId": schema.id, "kind": "view", "name": "v" }));
    assert!(def["sql"].as_str().unwrap().contains("CREATE VIEW"), "{def}");
    assert!(!det.to_string().contains("SQLITE-SECRET"), "구조에 행이 없다");

    // 끔 — 없는 연결.
    let (err, text) = call(&db, &d, "db_list_schemas", json!({ "connId": off.id }));
    assert!(err && text.contains("Unknown database connection"), "{text}");

    assert_audit_has_no(&db, &["SQLITE-SECRET-1", "SQLITE-SECRET-2", "SQLITE-SECRET-3"]);
    ai::close_for_test(&[&read.id, &schema.id]);
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
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

/// 사람 타일을 표로 연다(그 연결 줄을 시험 연결 목록 파일에 — `conns::set_path_override`).
async fn open_tile(stream: &str, conn: &DbConn, pw: &str) -> super::table::Opened {
    let dir = std::env::temp_dir().join(format!("aynx-ai-tile-{}-{}", conn.id, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("db-connections.json");
    std::fs::write(&file, serde_json::to_string(&[conn]).unwrap()).unwrap();
    super::conns::set_path_override(Some(file));
    super::table::conn_opened(7_700_301);
    let secrets = super::net::OpenSecrets {
        password: Some(zeroize::Zeroizing::new(pw.to_string())),
        ssh: Default::default(),
    };
    match super::table::open(stream.into(), stream.into(), 7_700_301, super::table::ConnRef { id: conn.id.clone() }, secrets).await {
        Ok(o) => o,
        Err(super::net::OpenError::Msg(m)) => panic!("타일 열기: {m}"),
        Err(super::net::OpenError::Ssh(e)) => panic!("ssh {e:?}"),
    }
}

#[allow(clippy::too_many_arguments)]
/// 엔진마다 같은 꼴의 시험 — `pid_sql` 은 백엔드(연결) 번호를 돌려주는 문장, `refuse` 는 그 방언의 우회 시도들.
async fn net_suite(
    label: &str,
    engine: DbEngine,
    (host, port, user, pw): (&str, u16, &str, &str),
    database: Option<&str>,
    pid_sql: &str,
    refuse: &[&str],
    count_sql: &str,
    tile_insert: &str,
) {
    let read = net_conn(&format!("AiR_{label}_01"), engine, host, port, database, user);
    let schema = net_conn(&format!("AiS_{label}_01"), engine, host, port, database, user);
    let nopw = net_conn(&format!("AiN_{label}_01"), engine, host, port, database, user);
    let mut passwords = HashMap::new();
    passwords.insert(read.id.clone(), pw.to_string());
    passwords.insert(schema.id.clone(), pw.to_string());
    let db = Arc::new(TestDb {
        conns: vec![read.clone(), schema.clone(), nopw.clone()],
        passwords,
        rt: tokio::runtime::Handle::current(),
        audits: Mutex::default(),
    });
    let d = delegation(&[(&read, DbAiLevel::Read), (&schema, DbAiLevel::Schema), (&nopw, DbAiLevel::Read)]);

    // MCP 디스패치는 블로킹(요청 스레드와 같다) — 블로킹 풀에서.
    let run = |name: &'static str, args: Value| {
        let (db, d) = (Arc::clone(&db), d.clone());
        tokio::task::spawn_blocking(move || call(&db, &d, name, args))
    };

    let (err, text) = run("db_query", json!({ "connId": read.id, "sql": count_sql })).await.unwrap();
    assert!(!err, "{label}: {text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["rows"][0][0].to_string().trim_matches('"'), "3", "{label}: {v}");

    for sql in refuse {
        let (err, text) = run("db_query", json!({ "connId": read.id, "sql": *sql })).await.unwrap();
        assert!(err, "{label}: 거절돼야 한다 {sql} → {text}");
        assert!(!text.contains("위 띠") && !text.contains("bar above"), "{label}: {sql} → {text}");
        println!("MEASURE {label} refused {sql:?} → {}", text.chars().take(140).collect::<String>());
    }
    let (_, text) = run("db_query", json!({ "connId": read.id, "sql": count_sql })).await.unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["rows"][0][0].to_string().trim_matches('"'), "3", "{label}: 우회가 아무것도 바꾸지 않았다");

    // 구조만 → 조회 거절 · 구조는 된다.
    let (err, text) = run("db_query", json!({ "connId": schema.id, "sql": "SELECT 1" })).await.unwrap();
    assert!(err && text.contains("permission is 'Schema'"), "{label}: {text}");
    let (err, text) = run("db_describe_table", json!({ "connId": schema.id, "table": "aits_t" })).await.unwrap();
    assert!(!err && text.contains("secret"), "{label}: {text}");
    assert!(!text.contains("AITS-SECRET"), "{label}: 구조에 행이 없다");

    // 볼트 비밀번호 없음 → 안내 오류(사람이 쿼리 타일에서).
    let (err, text) = run("db_list_schemas", json!({ "connId": nopw.id })).await.unwrap();
    assert!(err && text.contains("query tile"), "{label}: {text}");
    println!("MEASURE {label} no password → {text}");

    // 사람 타일과 다른 백엔드 · 사람의 열린 트랜잭션에 닿지 않는다.
    let tile = open_tile(&format!("ai-tile-{label}"), &read, pw).await;
    let human = super::table::query(tile.handle, tile.lease, pid_sql.into(), "q".into(), 10, 5_000, None).await.unwrap();
    let (_, text) = run("db_query", json!({ "connId": read.id, "sql": pid_sql })).await.unwrap();
    let ai_pid: Value = serde_json::from_str(&text).unwrap();
    println!("MEASURE {label} pid human={} ai={}", human.rows[0][0], ai_pid["rows"][0][0]);
    assert_ne!(human.rows[0][0], ai_pid["rows"][0][0], "{label}: AI 는 따로 연 연결");
    super::table::set_write(tile.handle, tile.lease, true).await.unwrap();
    let tx = super::table::tx_begin(tile.handle, tile.lease).await.unwrap().id;
    super::table::query(tile.handle, tile.lease, tile_insert.into(), "q".into(), 10, 5_000, Some(tx)).await.unwrap();
    let (_, text) = run("db_query", json!({ "connId": read.id, "sql": count_sql })).await.unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["rows"][0][0].to_string().trim_matches('"'), "3", "{label}: 사람의 커밋 전 행이 AI 에 안 보인다");
    super::table::tx_end(tile.handle, tile.lease, tx, false).await.unwrap();
    super::table::close(tile.handle, None).unwrap();
    super::conns::set_path_override(None);

    assert_audit_has_no(&db, &["AITS-SECRET-1", "AITS-SECRET-2", "AITS-SECRET-3"]);
    let audits = db.audits.lock().unwrap().clone();
    assert!(audits.iter().any(|r| r.command == count_sql && r.db.as_ref().is_some_and(|x| x.outcome == "ok")));
    assert!(audits.iter().any(|r| r.db.as_ref().is_some_and(|x| x.outcome == "denied")));
    ai::close_for_test(&[&read.id, &schema.id, &nopw.id]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn pg_ai_reads_only_on_its_own_connection() {
    use std::str::FromStr;
    let Some(url) = env("AYNX_TEST_PG_URL") else { return };
    let cfg = tokio_postgres::Config::from_str(&url).unwrap();
    let (a, conn) = cfg.connect(tokio_postgres::NoTls).await.unwrap();
    tokio::spawn(conn);
    a.batch_execute(
        "DROP TABLE IF EXISTS aits_t; DROP SEQUENCE IF EXISTS aits_seq; CREATE SEQUENCE aits_seq; \
         CREATE TABLE aits_t(id int PRIMARY KEY, secret text); \
         INSERT INTO aits_t VALUES (1, 'AITS-SECRET-1'), (2, 'AITS-SECRET-2'), (3, 'AITS-SECRET-3');",
    )
    .await
    .unwrap();
    let host = match &cfg.get_hosts()[0] {
        tokio_postgres::config::Host::Tcp(h) => h.clone(),
        #[allow(unreachable_patterns)]
        _ => "127.0.0.1".into(),
    };
    let port = cfg.get_ports().first().copied().unwrap_or(5432);
    let user = cfg.get_user().unwrap().to_string();
    let pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    net_suite(
        "pg",
        DbEngine::Postgres,
        (&host, port, &user, &pw),
        cfg.get_dbname(),
        "SELECT pg_backend_pid()",
        &[
            "INSERT INTO aits_t VALUES (9, 'x')",
            "COMMIT; INSERT INTO aits_t VALUES (9, 'x')",
            "WITH x AS (DELETE FROM aits_t RETURNING id) SELECT * FROM x",
            "SELECT 1; DELETE FROM aits_t",
            "SET default_transaction_read_only = off",
            "SET TRANSACTION READ WRITE",
            "DO $$ BEGIN DELETE FROM aits_t; END $$",
            "CREATE TABLE aits_z(a int)",
            "COPY aits_t TO STDOUT",
            "SELECT nextval('aits_seq')",
        ],
        "SELECT count(*) FROM aits_t",
        "INSERT INTO aits_t VALUES (100, 'tile')",
    )
    .await;
    a.batch_execute("DROP TABLE IF EXISTS aits_t; DROP SEQUENCE IF EXISTS aits_seq").await.unwrap();
}

async fn mysql_case(var: &str, label: &str, engine: DbEngine) {
    use mysql_async::prelude::Queryable;
    let Some(url) = env(var) else { return };
    let opts = mysql_async::Opts::from_url(&url).unwrap();
    let mut a = mysql_async::Conn::new(opts.clone()).await.unwrap();
    a.query_drop(
        "CREATE DATABASE IF NOT EXISTS aits; DROP TABLE IF EXISTS aits.aits_t; \
         CREATE TABLE aits.aits_t(id int PRIMARY KEY, secret text) ENGINE=InnoDB; \
         INSERT INTO aits.aits_t VALUES (1, 'AITS-SECRET-1'), (2, 'AITS-SECRET-2'), (3, 'AITS-SECRET-3');",
    )
    .await
    .unwrap();
    let host = opts.ip_or_hostname().to_string();
    let port = opts.tcp_port();
    let user = opts.user().unwrap().to_string();
    let pw = opts.pass().unwrap().to_string();
    net_suite(
        label,
        engine,
        (&host, port, &user, &pw),
        Some("aits"),
        "SELECT CONNECTION_ID()",
        &[
            "INSERT INTO aits_t VALUES (9, 'x')",
            "COMMIT; INSERT INTO aits_t VALUES (9, 'x')",
            "SELECT 1; DELETE FROM aits_t",
            "SET SESSION TRANSACTION READ WRITE",
            "SET autocommit = 0",
            "SELECT * FROM aits_t INTO OUTFILE '/tmp/aits.txt'",
            "LOCK TABLES aits_t WRITE",
            "CREATE TABLE aits_z(a int)",
            "DELETE FROM aits_t",
            "CALL nothing_here()",
        ],
        "SELECT count(*) FROM aits_t",
        "INSERT INTO aits_t VALUES (100, 'tile')",
    )
    .await;
    a.query_drop("DROP DATABASE IF EXISTS aits").await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn mysql_ai_reads_only_on_its_own_connection() {
    mysql_case("AYNX_TEST_MY_URL", "my", DbEngine::Mysql).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn mariadb_ai_reads_only_on_its_own_connection() {
    mysql_case("AYNX_TEST_MARIA_URL", "maria", DbEngine::Mariadb).await;
}
