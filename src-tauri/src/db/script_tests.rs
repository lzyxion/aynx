//! **스크립트 실행기 시험**(쿼리 타일 2단계 — `db::script`).
//!
//! - 순수(늘 돈다): 문장 나누기(달러 인용 · 주석 · 문자열 · 세미콜론 · 해석마다 다른 경계) · 사전 검증(하나라도 거절이면 실행 0) · 상한 ·
//!   UTF-16 자리 · 결과 예산 · 시계.
//! - SQLite(늘 돈다 — 임시 파일): 실행기를 엔진 연결에 바로 — 커밋 · 첫 오류에서 전부 되돌림 · 사전 거절 · 읽기 전용 · 작업 안 ·
//!   시한 · 취소 · `RETURNING` 영향 행 수.
//! - 실제 서버(`#[ignore]` + 환경변수 — `tx_tests` 와 같은 변수): 표(`table::script`)를 그대로 — PG 직결 · PgBouncer transaction ·
//!   MySQL 8.4 · MariaDB 11.
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55432/postgres
//! AYNX_TEST_PG_POOLER=127.0.0.1:56432
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53306/
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53307/
//! cargo test --lib db::script_tests -- --ignored --nocapture --test-threads=1
//! ```

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use mysql_async::prelude::Queryable;
use serde_json::{json, Value};
use tokio_postgres::NoTls;
use zeroize::Zeroizing;

use super::conns::{self, DbConn, DbEngine, DbTlsMode};
use super::guard::{split_script, GuardError};
use super::net::OpenSecrets;
use super::script::{self, Ctl, PlanError, ScriptMode, ScriptOut};
use super::sqlite::Sqlite;
use super::table::{self, ConnRef, Engine};
use super::{Dialect, QueryOut};
use crate::ssh::open::SharedCreds;

// ---------------------------------------------------------------------------
// 순수 — 나누기 · 계획 · 예산
// ---------------------------------------------------------------------------

fn pieces(sql: &str, d: Dialect) -> Vec<&str> {
    split_script(sql, d).unwrap_or_else(|e| panic!("{sql:?}: {e:?}")).into_iter().map(|(s, e)| &sql[s..e]).collect()
}

#[test]
fn split_script_follows_quotes_comments_dollar_quotes_and_semicolons() {
    let pg = Dialect::Postgres;
    // 끝 세미콜론 · 빈 문장 · 앞뒤 주석은 범위 밖.
    assert_eq!(pieces("  SELECT 1; ;; -- 끝\n SELECT 2;  /* 꼬리 */ ", pg), vec!["SELECT 1", "SELECT 2"]);
    // 문자열 · 인용 식별자 · 주석 안의 `;` 는 가르지 않는다.
    assert_eq!(
        pieces("SELECT 'a;b', \"c;d\" /* ; */ -- ;\n; SELECT E'x\\';y'", pg),
        vec!["SELECT 'a;b', \"c;d\"", "SELECT E'x\\';y'"]
    );
    // PG 달러 인용 함수 본문 — 본문 안의 `;` 는 문장 하나.
    let f = "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN PERFORM 1; RETURN 2; END $body$;\nSELECT f()";
    assert_eq!(pieces(f, pg).len(), 2);
    assert!(pieces(f, pg)[0].ends_with("$body$"));
    assert_eq!(pieces("DO $$ BEGIN RAISE NOTICE 'x;y'; END $$; SELECT 1", pg).len(), 2);
    // 중첩 블록 주석(PG).
    assert_eq!(pieces("SELECT 1 /* a /* ; */ ; */ ; SELECT 2", pg), vec!["SELECT 1", "SELECT 2"]);
    // MySQL — `#` 주석 · 백틱 · `--` 는 공백이 있어야 주석.
    let my = Dialect::Mysql;
    assert_eq!(pieces("SELECT 1 # ;\n; SELECT `a;b` FROM t; SELECT 5 --1\n", my), vec!["SELECT 1", "SELECT `a;b` FROM t", "SELECT 5 --1"]);
    // SQLite — `[식별자]`.
    assert_eq!(pieces("SELECT [a;b] FROM t; SELECT 2", Dialect::Sqlite), vec!["SELECT [a;b] FROM t", "SELECT 2"]);
}

#[test]
fn split_script_refuses_ambiguous_boundaries_delimiter_and_empty() {
    // MySQL 백슬래시 — `NO_BACKSLASH_ESCAPES` 이면 둘째 문장이 따로 선다(DELETE) → 해석마다 경계가 달라 거절.
    assert_eq!(split_script("SELECT 'a\\'; DELETE FROM t; -- '", Dialect::Mysql), Err(GuardError::Ambiguous));
    // PG 표준 문자열의 `\'` 도 같은 꼴(백슬래시 해석에서는 끝나지 않는다).
    assert_eq!(split_script("SELECT 'C:\\'; SELECT 2", Dialect::Postgres), Err(GuardError::Ambiguous));
    // 모든 해석에서 끝나지 않음.
    assert_eq!(split_script("SELECT 1; SELECT 'x", Dialect::Postgres), Err(GuardError::Unterminated));
    // DELIMITER(클라이언트 명령).
    assert_eq!(
        split_script("DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;", Dialect::Mysql),
        Err(GuardError::Delimiter)
    );
    // 빈 글 · 주석뿐.
    assert_eq!(split_script(" ;; -- x\n", Dialect::Sqlite), Err(GuardError::Empty));
    // MySQL 실행 주석.
    assert_eq!(split_script("SELECT 1; /*!50000 DROP TABLE t */", Dialect::Mysql), Err(GuardError::ExecutableComment));
    for e in [GuardError::Ambiguous, GuardError::Delimiter] {
        assert!(!e.message().is_empty());
    }
}

#[test]
fn plan_refuses_the_whole_script_when_one_statement_is_refused() {
    let pg = Dialect::Postgres;
    // 쓰기 — 사람의 트랜잭션 문장 · 트랜잭션 밖 전용 문장이 하나라도 있으면 아무것도 실행하지 않는다.
    for (sql, at) in [
        ("INSERT INTO t VALUES (1); COMMIT; INSERT INTO t VALUES (2)", 1),
        ("BEGIN; INSERT INTO t VALUES (1)", 0),
        ("INSERT INTO t VALUES (1); VACUUM t", 1),
        ("UPDATE t SET a = 1; SAVEPOINT s; SELECT 1", 1),
    ] {
        match script::plan(sql, pg, ScriptMode::Write) {
            Err(PlanError::Statement { index, .. }) => assert_eq!(index, at, "{sql}"),
            other => panic!("{sql}: {other:?}"),
        }
    }
    // PG DDL 은 트랜잭션 안에서 되돌려지므로 받는다.
    assert_eq!(script::plan("CREATE TABLE z(a int); INSERT INTO z VALUES (1); DROP TABLE z", pg, ScriptMode::Write).unwrap().len(), 3);
    // MySQL — 암묵 커밋(DDL) · 세션 잠금 · autocommit 거절, TEMPORARY 는 받는다.
    let my = Dialect::Mysql;
    for sql in ["INSERT INTO t VALUES (1); CREATE TABLE z(a int)", "TRUNCATE t", "SET autocommit = 0; SELECT 1", "LOCK TABLES t WRITE"] {
        assert!(matches!(script::plan(sql, my, ScriptMode::Write), Err(PlanError::Statement { .. })), "{sql}");
    }
    // 원자성을 증명할 수 없는 문장 — CALL · TEMPORARY · completion_type 도 거절(Codex 검토 반영 1).
    for (sql, at) in [
        ("CREATE TEMPORARY TABLE tt(a int); INSERT INTO tt VALUES (1)", 0),
        ("INSERT INTO t VALUES (1); CALL p()", 1),
        ("INSERT INTO t VALUES (1); DROP TEMPORARY TABLE tt", 1),
        ("SET completion_type = 1; SELECT 1", 0),
    ] {
        match script::plan(sql, my, ScriptMode::Write) {
            Err(PlanError::Statement { index, .. }) => assert_eq!(index, at, "{sql}"),
            other => panic!("{sql}: {other:?}"),
        }
        assert!(matches!(script::plan(sql, my, ScriptMode::InWork), Err(PlanError::Statement { .. })), "{sql}");
    }
    // 작업 안도 같은 규칙.
    assert!(matches!(script::plan("SELECT 1; ROLLBACK", my, ScriptMode::InWork), Err(PlanError::Statement { index: 1, .. })));
    // 읽기 전용 — 조회 첫 낱말만.
    assert!(matches!(
        script::plan("SELECT 1; INSERT INTO t VALUES (1)", Dialect::Sqlite, ScriptMode::ReadOnly),
        Err(PlanError::Statement { index: 1, err: GuardError::ReadOnly { .. }, .. })
    ));
    assert_eq!(script::plan("SELECT 1; WITH x AS (SELECT 2) SELECT * FROM x; PRAGMA table_info(t)", Dialect::Sqlite, ScriptMode::ReadOnly)
        .unwrap()
        .len(), 3);
    // 거절 답 — 실행 0, 자리 · 문구.
    let e = script::plan("SELECT 1;\nCOMMIT", pg, ScriptMode::Write).unwrap_err();
    let out = script::refused(&e);
    assert_eq!((out.outcome, out.results.len(), out.total), ("refused", 0, 2));
    let f = out.failed.unwrap();
    assert_eq!((f.index, f.start, f.end), (1, 10, 16));
    assert!(f.message.contains("COMMIT"), "{}", f.message);
    // 나누기부터 거절이면 자리 없이 문구.
    let out = script::refused(&script::plan("  ", pg, ScriptMode::Write).unwrap_err());
    assert!(out.failed.is_none() && out.message.is_some());
}

#[test]
fn plan_limits_statements_and_size_and_reports_utf16_positions() {
    let ok = "SELECT 1;".repeat(script::STATEMENTS_MAX);
    assert_eq!(script::plan(&ok, Dialect::Sqlite, ScriptMode::ReadOnly).unwrap().len(), script::STATEMENTS_MAX);
    let many = "SELECT 1;".repeat(script::STATEMENTS_MAX + 1);
    assert_eq!(script::plan(&many, Dialect::Sqlite, ScriptMode::ReadOnly).unwrap_err(), PlanError::TooMany(101));
    let big = format!("SELECT '{}'", "x".repeat(script::SCRIPT_BYTES_MAX));
    assert_eq!(script::plan(&big, Dialect::Sqlite, ScriptMode::ReadOnly).unwrap_err(), PlanError::TooLarge);
    for e in [PlanError::TooMany(101), PlanError::TooLarge] {
        assert!(!e.message().is_empty());
    }
    // 한글 · 이모지(UTF-16 둘) 뒤의 자리 — 화면 편집기의 글자 위치와 같다.
    let sql = "SELECT '가😀'; SELECT 2";
    let p = script::plan(sql, Dialect::Sqlite, ScriptMode::ReadOnly).unwrap();
    assert_eq!(p[0].text(), "SELECT '가😀'");
    let utf16: Vec<u16> = sql.encode_utf16().collect();
    let second = String::from_utf16(&utf16[14..22]).unwrap();
    assert_eq!(second, "SELECT 2");
    let out = script::refused(&script::plan("SELECT '가😀'; DELETE FROM t", Dialect::Sqlite, ScriptMode::ReadOnly).unwrap_err());
    let f = out.failed.unwrap();
    assert_eq!((f.start, f.end), (14, 27));
}

fn row_out(rows: usize, cell: &str) -> QueryOut {
    QueryOut {
        columns: vec![],
        rows: (0..rows).map(|_| vec![json!(cell)]).collect(),
        truncated: false,
        cell_truncated: false,
        affected: None,
        elapsed_ms: 0,
        tx: None,
    }
}

#[test]
fn ctl_keeps_results_within_the_budget_and_stops_on_cancel_or_deadline() {
    let flag = Arc::new(AtomicBool::new(false));
    let ctl = Ctl::new(flag.clone(), 1000, Duration::from_secs(60));
    // 한 칸 ≈ 1 KiB · 한 결과 4000줄 ≈ 4 MiB — 셋째부터 예산(8 MiB)을 넘는다.
    let cell = "y".repeat(1024);
    let a = ctl.keep(row_out(4000, &cell));
    let b = ctl.keep(row_out(4000, &cell));
    let c = ctl.keep(row_out(4000, &cell));
    assert!(!a.truncated && a.rows.len() == 4000);
    assert!(b.rows.len() + c.rows.len() < 8000, "뒤 결과의 행부터 빠진다");
    assert!(c.truncated && c.rows.len() < 4000);
    let d = ctl.keep(row_out(10, &cell));
    assert!(d.truncated && d.rows.is_empty(), "예산이 다 했으면 행 없이");
    let d = ctl.keep(row_out(0, ""));
    assert!(!d.truncated, "행이 없는 결과는 그대로");
    // 시계 — 문장 시한은 남은 전체 시간을 넘지 않는다 · 취소면 다음 문장을 시작하지 않는다.
    assert_eq!(ctl.begin_stmt(), Some(1000));
    ctl.end_stmt();
    assert_eq!(ctl.stopped(), None);
    flag.store(true, Ordering::SeqCst);
    assert_eq!(ctl.begin_stmt(), None);
    assert_eq!(ctl.stopped(), Some(script::Stop::Cancelled));
    let short = Ctl::new(Arc::new(AtomicBool::new(false)), 5000, Duration::from_millis(200));
    let ms = short.begin_stmt().unwrap();
    assert!(ms <= 200, "{ms}");
    std::thread::sleep(Duration::from_millis(220));
    assert_eq!(short.begin_stmt(), None);
    assert_eq!(short.stopped(), Some(script::Stop::TimedOut));
}

// ---------------------------------------------------------------------------
// SQLite — 실행기를 엔진 연결에 바로
// ---------------------------------------------------------------------------

fn sqlite_file(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "aynx-script-test-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("s.db");
    let c = rusqlite::Connection::open(&file).unwrap();
    c.execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, v INT); INSERT INTO t VALUES (1, 1), (2, 2), (3, 3);").unwrap();
    (dir, file)
}

fn count(file: &std::path::Path, sql: &str) -> i64 {
    rusqlite::Connection::open(file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 계획 → 실행 → 화면 꼴(거절이면 거절 답).
async fn go_ctl(db: &Arc<Sqlite>, sql: &str, mode: ScriptMode, stmt_ms: u64, flag: Arc<AtomicBool>) -> ScriptOut {
    let plan = match script::plan(sql, Dialect::Sqlite, mode) {
        Ok(p) => p,
        Err(e) => return script::refused(&e),
    };
    let ctl = Arc::new(Ctl::new(flag, stmt_ms, script::SCRIPT_TIMEOUT));
    let run = script::execute(Engine::Sqlite(Arc::clone(db)), plan.clone(), mode, 100, Arc::clone(&ctl)).await.expect("실행");
    script::report(&plan, run, mode, &ctl, stmt_ms, 0)
}

async fn go(db: &Arc<Sqlite>, sql: &str, mode: ScriptMode) -> ScriptOut {
    go_ctl(db, sql, mode, 5_000, Arc::new(AtomicBool::new(false))).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sqlite_script_commits_rolls_back_whole_and_refuses_before_running() {
    let (dir, file) = sqlite_file("commit");
    let db = Arc::new(Sqlite::open(&file, false).unwrap());
    db.set_write(true).unwrap();
    // ── 3문장 성공 → 커밋(다른 연결에 보인다) · 문장별 영향 행 수 ──
    let r = go(&db, "INSERT INTO t VALUES (10, 10); UPDATE t SET v = v + 100 WHERE id <= 2; SELECT count(*) FROM t", ScriptMode::Write).await;
    assert_eq!((r.outcome, r.reason, r.total, r.results.len()), ("committed", None, 3, 3), "{r:?}");
    assert_eq!(r.results[0].out.affected, Some(1));
    assert_eq!(r.results[1].out.affected, Some(2));
    assert_eq!(r.results[2].out.rows, vec![vec![json!(4)]]);
    assert_eq!((r.results[1].index, r.results[1].keyword.as_str()), (1, "UPDATE"));
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE v > 100"), 2);
    assert!(db.is_autocommit() && !db.in_tx(), "트랜잭션을 열어 두지 않는다");
    // ── 2번째 오류 → 전부 되돌림(다른 연결에 1번째 변경이 없다) ──
    let r = go(&db, "INSERT INTO t VALUES (20, 20); INSERT INTO t VALUES (1, 1); INSERT INTO t VALUES (21, 21)", ScriptMode::Write).await;
    assert_eq!((r.outcome, r.reason, r.results.len()), ("rolledBack", Some("error"), 1), "{r:?}");
    let f = r.failed.as_ref().unwrap();
    assert_eq!(f.index, 1);
    assert!(f.message.contains("UNIQUE"), "{}", f.message);
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id IN (20, 21)"), 0);
    assert!(db.is_autocommit());
    // ── 사전 거절 → 아무것도 안 바뀐다 ──
    let r = go(&db, "INSERT INTO t VALUES (30, 30); BEGIN; INSERT INTO t VALUES (31, 31)", ScriptMode::Write).await;
    assert_eq!((r.outcome, r.failed.as_ref().map(|f| f.index)), ("refused", Some(1)));
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id >= 30"), 0);
    // ── DDL 도 트랜잭션 안에서 되돌려진다(SQLite) ──
    let r = go(&db, "CREATE TABLE made(a); INSERT INTO made VALUES (1); INSERT INTO nope VALUES (1)", ScriptMode::Write).await;
    assert_eq!(r.outcome, "rolledBack");
    assert_eq!(count(&file, "SELECT count(*) FROM sqlite_schema WHERE name = 'made'"), 0);
    // ── RETURNING — 행 상한(100) 너머까지 영향 행 수 ──
    let r = go(
        &db,
        "INSERT INTO t(id, v) WITH RECURSIVE n(i) AS (SELECT 1000 UNION ALL SELECT i + 1 FROM n WHERE i < 1249) SELECT i, i FROM n RETURNING id",
        ScriptMode::Write,
    )
    .await;
    assert_eq!(r.outcome, "committed", "{r:?}");
    assert_eq!((r.results[0].out.rows.len(), r.results[0].out.truncated, r.results[0].out.affected), (100, true, Some(250)));
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id >= 1000"), 250);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sqlite_script_read_only_and_inside_a_transaction() {
    let (dir, file) = sqlite_file("ro-work");
    let db = Arc::new(Sqlite::open(&file, false).unwrap());
    // ── 읽기 전용 — 여러 SELECT 를 한 READ ONLY 트랜잭션으로, 결과는 문장별 ──
    let r = go(&db, "SELECT count(*) FROM t; SELECT max(id) FROM t; SELECT 'x'", ScriptMode::ReadOnly).await;
    assert_eq!((r.outcome, r.results.len()), ("readOnly", 3), "{r:?}");
    assert_eq!(r.results[1].out.rows, vec![vec![json!(3)]]);
    let r = go(&db, "SELECT 1; SELECT * FROM nope; SELECT 3", ScriptMode::ReadOnly).await;
    assert_eq!((r.outcome, r.reason, r.results.len(), r.failed.as_ref().map(|f| f.index)), ("readOnly", Some("error"), 1, Some(1)));
    // 쓰기 모드가 아닌데 쓰기 모드로 부르면(상태가 바뀜) 실행 전 거절.
    let plan = script::plan("SELECT 1", Dialect::Sqlite, ScriptMode::Write).unwrap();
    let ctl = Arc::new(Ctl::new(Arc::new(AtomicBool::new(false)), 1000, script::SCRIPT_TIMEOUT));
    assert!(script::execute(Engine::Sqlite(Arc::clone(&db)), plan, ScriptMode::Write, 10, ctl).await.is_err());
    // ── 작업 안 — 커밋하지 않는다 · 실행 한 번이 세이브포인트 하나(10-14 결정) ──
    db.set_write(true).unwrap();
    db.tx_begin().unwrap();
    // 실행 A — 성공(작업에 남는다).
    let r = go(&db, "INSERT INTO t VALUES (40, 40); INSERT INTO t VALUES (41, 41)", ScriptMode::InWork).await;
    assert_eq!((r.outcome, r.results.len()), ("work", 2), "{r:?}");
    assert!(db.in_tx());
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id >= 40"), 0, "커밋 전 — 다른 연결엔 안 보인다");
    // 실행 B — 3문장 중 2번째 오류 → B 만 되돌림(42 도 사라진다) · 작업은 산다.
    let r = go(&db, "INSERT INTO t VALUES (42, 42); INSERT INTO t VALUES (40, 40); INSERT INTO t VALUES (43, 43)", ScriptMode::InWork).await;
    assert_eq!((r.outcome, r.reason, r.results.len(), r.failed.as_ref().map(|f| f.index)), ("workUndone", Some("error"), 1, Some(1)), "{r:?}");
    assert!(db.in_tx(), "이번 실행만 되돌림 — 작업은 산다");
    // 단문 실패도 그 실행만(세이브포인트) — 작업은 그대로.
    assert!(db.query("INSERT INTO t VALUES (41, 41)", 10).is_err());
    assert!(db.in_tx());
    // 작업 안 같은 연결에서는 A 만 보인다.
    let r = go(&db, "SELECT count(*) FROM t WHERE id >= 40", ScriptMode::InWork).await;
    assert_eq!(r.results[0].out.rows, vec![vec![json!(2)]], "{r:?}");
    db.tx_end(true).unwrap();
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id >= 40"), 2, "40 · 41(A) 만 — B 의 42 · 43 은 없다");
    // 세이브포인트가 남지 않았다(커밋으로 끝났고 다음 작업이 깨끗이 열린다).
    db.tx_begin().unwrap();
    db.tx_end(false).unwrap();
    // ── 자동 커밋을 끈 타일의 조회만 든 스크립트 — 쓰기 모드에서도 읽기 전용으로, 숨은 쓰기는 엔진이 거절 ──
    let r = go(&db, "SELECT count(*) FROM t; SELECT 2", ScriptMode::ReadOnly).await;
    assert_eq!((r.outcome, r.results.len()), ("readOnly", 2), "{r:?}");
    let plan = script::plan("SELECT 1; WITH a(v) AS (SELECT 9) INSERT INTO t(v) SELECT v FROM a", Dialect::Sqlite, ScriptMode::ReadOnly).unwrap();
    let ctl = Arc::new(Ctl::new(Arc::new(AtomicBool::new(false)), 5_000, script::SCRIPT_TIMEOUT));
    let run = script::execute(Engine::Sqlite(Arc::clone(&db)), plan, ScriptMode::ReadOnly, 10, ctl).await.unwrap();
    assert!(matches!(run.failed, Some(super::EngineError::ReadOnlyRefused(_))), "{run:?}");
    assert!(db.is_autocommit());
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE v = 9"), 0);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sqlite_script_time_limit_and_cancel_roll_everything_back() {
    let (dir, file) = sqlite_file("stop");
    let db = Arc::new(Sqlite::open(&file, false).unwrap());
    db.set_write(true).unwrap();
    let forever = "INSERT INTO t(v) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT i FROM n";
    // ── 문장 시한(300ms) — 시계가 끊고 전부 되돌린다 ──
    let r = go_ctl(&db, &format!("INSERT INTO t VALUES (50, 50); {forever}"), ScriptMode::Write, 300, Arc::new(AtomicBool::new(false))).await;
    assert_eq!((r.outcome, r.reason), ("rolledBack", Some("timedOut")), "{r:?}");
    assert!(r.failed.as_ref().unwrap().message.contains('1'), "시한 문구: {:?}", r.failed);
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id = 50"), 0);
    assert!(db.is_autocommit());
    // ── 취소 — 도는 문장을 끊고 전부 되돌린다 ──
    let flag = Arc::new(AtomicBool::new(false));
    let (d2, f2) = (Arc::clone(&db), Arc::clone(&flag));
    let h = tokio::spawn(async move { go_ctl(&d2, &format!("INSERT INTO t VALUES (51, 51); {forever}; INSERT INTO t VALUES (52, 52)"), ScriptMode::Write, 30_000, f2).await });
    tokio::time::sleep(Duration::from_millis(400)).await;
    flag.store(true, Ordering::SeqCst);
    db.interrupt();
    let r = h.await.unwrap();
    assert_eq!((r.outcome, r.reason), ("rolledBack", Some("cancelled")), "{r:?}");
    assert_eq!(count(&file, "SELECT count(*) FROM t WHERE id IN (51, 52)"), 0);
    // ── 문장 사이의 취소 — 다음 문장을 시작하지 않고 되돌린다 ──
    let flag = Arc::new(AtomicBool::new(true));
    let r = go_ctl(&db, "INSERT INTO t VALUES (53, 53)", ScriptMode::Write, 1000, flag).await;
    assert_eq!((r.outcome, r.reason, r.results.len()), ("rolledBack", Some("cancelled"), 0), "{r:?}");
    assert!(db.is_autocommit());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// 실제 서버 — 표(`table::script`)를 그대로 (`#[ignore]`)
// ---------------------------------------------------------------------------

/// 시험의 서버 연결 번호(표의 `conns` — 없으면 열자마자 떼어 둔다). 끊김 시험은 따로 둔다.
const CONN: u64 = 7_700_101;
const CONN_DROP: u64 = 7_700_102;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn secrets(pw: &str) -> OpenSecrets {
    OpenSecrets {
        password: Some(Zeroizing::new(pw.to_string())),
        ssh: SharedCreds::default(),
        vault: true,
        from_vault: false,
    }
}

type ConnRow<'a> = (&'a str, DbEngine, &'a str, u16, Option<&'a str>, &'a str);

fn write_conns(tag: &str, rows: &[ConnRow<'_>]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("aynx-script-it-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let list: Vec<DbConn> = rows
        .iter()
        .map(|(id, engine, host, port, db, user)| DbConn {
            id: id.to_string(),
            name: id.to_string(),
            engine: *engine,
            via: None,
            path: None,
            host: Some(host.to_string()),
            port: Some(*port),
            database: db.map(str::to_string),
            user: Some(user.to_string()),
            tls_mode: Some(DbTlsMode::Disable),
            tls_ca: None,
            folder: None,
        })
        .collect();
    let file = dir.join("db-connections.json");
    std::fs::write(&file, serde_json::to_string(&list).unwrap()).unwrap();
    conns::set_path_override(Some(file.clone()));
    file
}

async fn open_on(conn: u64, stream: &str, id: &str, pw: &str) -> table::Opened {
    table::conn_opened(conn);
    match table::open(stream.into(), stream.into(), conn, ConnRef { id: id.into() }, secrets(pw)).await {
        Ok(o) => o,
        Err(super::net::OpenError::Msg(m)) => panic!("열기 실패: {m}"),
        Err(super::net::OpenError::Ssh(e)) => panic!("ssh {e:?}"),
    }
}

/// 스크립트 — 화면처럼 작업 id 를 싣는다(행 상한 100 · 문장 시한 5초).
async fn s(o: &table::Opened, sql: &str, tx: u64) -> ScriptOut {
    table::script(o.handle, o.lease, sql.into(), "s".into(), 100, 5_000, Some(tx)).await.expect("스크립트")
}

fn affected(r: &ScriptOut) -> Vec<Option<u64>> {
    r.results.iter().map(|x| x.out.affected).collect()
}

fn tx_state(r: &ScriptOut) -> Value {
    serde_json::to_value(r.tx.as_ref().expect("tx")).unwrap()
}

// ── PostgreSQL ──

async fn pg_admin(url: &str) -> tokio_postgres::Client {
    let (c, conn) = tokio_postgres::Config::from_str(url).unwrap().connect(NoTls).await.expect("관리 연결");
    tokio::spawn(conn);
    c
}

async fn pg_count(a: &tokio_postgres::Client, sql: &str) -> i64 {
    a.query_one(sql, &[]).await.unwrap().get(0)
}

async fn pg_suite(a: &tokio_postgres::Client, id: &str, pw: &str, label: &str) {
    a.batch_execute("DROP TABLE IF EXISTS txs2_t; DROP TABLE IF EXISTS txs2_made; CREATE TABLE txs2_t(id int PRIMARY KEY, v int)")
        .await
        .unwrap();
    let o = open_on(CONN, &format!("txs2-pg-{label}"), id, pw).await;
    // ── 읽기 전용 스크립트 — 여러 SELECT 를 READ ONLY 트랜잭션 하나로 · 쓰기는 사전 거절 ──
    let r = s(&o, "SELECT 1; SELECT count(*)::int FROM txs2_t; SELECT 'x'", 0).await;
    assert_eq!((r.outcome, r.results.len()), ("readOnly", 3), "{r:?}");
    let r = s(&o, "SELECT 1; INSERT INTO txs2_t VALUES (1, 1)", 0).await;
    assert_eq!((r.outcome, r.failed.as_ref().map(|f| f.index)), ("refused", Some(1)));
    table::set_write(o.handle, o.lease, true).await.unwrap();

    // ── ① 3문장 성공 → 커밋 ──
    let r = s(&o, "INSERT INTO txs2_t VALUES (1, 1); INSERT INTO txs2_t VALUES (2, 2); UPDATE txs2_t SET v = v + 10", 0).await;
    assert_eq!((r.outcome, affected(&r)), ("committed", vec![Some(1), Some(1), Some(2)]), "{r:?}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE v > 10").await, 2);
    // ── ② 2번째 오류 → 전부 되돌림(다른 연결에 1번째 변경 없음) ──
    let r = s(&o, "INSERT INTO txs2_t VALUES (3, 3); INSERT INTO txs2_t VALUES (1, 1); INSERT INTO txs2_t VALUES (4, 4)", 0).await;
    assert_eq!((r.outcome, r.reason, r.results.len()), ("rolledBack", Some("error"), 1), "{r:?}");
    assert!(r.failed.as_ref().unwrap().message.contains("23505"), "{:?}", r.failed);
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id IN (3, 4)").await, 0);
    // ── ③ 사전 거절 — 아무것도 안 바뀐다 ──
    for sql in ["INSERT INTO txs2_t VALUES (5, 5); COMMIT; INSERT INTO txs2_t VALUES (6, 6)", "INSERT INTO txs2_t VALUES (5, 5); VACUUM txs2_t"] {
        let r = s(&o, sql, 0).await;
        assert_eq!((r.outcome, r.failed.as_ref().map(|f| f.index)), ("refused", Some(1)), "{sql}");
    }
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id >= 5").await, 0);
    // ── ④ PG DDL 도 스크립트 안에서 되돌려진다 ──
    let r = s(&o, "CREATE TABLE txs2_made(a int); INSERT INTO txs2_made VALUES (1); SELECT 1/0", 0).await;
    assert_eq!(r.outcome, "rolledBack");
    assert_eq!(pg_count(a, "SELECT count(*) FROM pg_class WHERE relname = 'txs2_made'").await, 0);
    // ── ⑤ RETURNING — 행 상한(100) 너머까지 정확한 영향 행 수(스크립트 · 단문 모두) ──
    let r = s(&o, "INSERT INTO txs2_t SELECT g, g FROM generate_series(100, 349) g RETURNING id", 0).await;
    let x = &r.results[0].out;
    assert_eq!((r.outcome, x.rows.len(), x.truncated, x.affected), ("committed", 100, true, Some(250)), "{r:?}");
    let q = table::query(o.handle, o.lease, "DELETE FROM txs2_t WHERE id >= 300 RETURNING id".into(), "q".into(), 10, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!((q.rows.len(), q.affected), (10, Some(50)));
    let q = table::query(o.handle, o.lease, "SELECT id FROM txs2_t".into(), "q".into(), 10, 5_000, Some(0)).await.unwrap();
    assert_eq!(q.affected, None, "SELECT 는 영향 행 수가 없다");
    // ── ⑥ 한 트랜잭션 = 한 백엔드(풀러 뒤에서도) ──
    let r = s(&o, "SELECT pg_backend_pid(); SELECT pg_backend_pid(); SELECT pg_backend_pid()", 0).await;
    let pids: Vec<&Value> = r.results.iter().map(|x| &x.out.rows[0][0]).collect();
    assert!(pids.windows(2).all(|w| w[0] == w[1]), "{pids:?}");
    // ── ⑦ 작업 중 스크립트 — 그 작업 안 · 커밋 안 함 · 오류면 그 실행만 되돌림(세이브포인트 — 10-14 결정) ──
    let tid = table::tx_begin(o.handle, o.lease).await.unwrap().id;
    let r = s(&o, "INSERT INTO txs2_t VALUES (6, 6); INSERT INTO txs2_t VALUES (7, 7)", tid).await;
    assert_eq!((r.outcome, tx_state(&r)["state"].as_str(), tx_state(&r)["statements"].as_u64()), ("work", Some("open"), Some(2)), "{r:?}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id IN (6, 7)").await, 0, "커밋 전");
    let r = s(&o, "INSERT INTO txs2_t VALUES (8, 8); SELECT 1/0", tid).await;
    assert_eq!((r.outcome, r.reason, tx_state(&r)["state"].as_str(), tx_state(&r)["statements"].as_u64()), ("workUndone", Some("error"), Some("open"), Some(2)), "{r:?}");
    table::tx_end(o.handle, o.lease, tid, true).await.unwrap();
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id IN (6, 7)").await, 2, "앞 실행(6 · 7)은 커밋됐다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id = 8").await, 0, "되돌린 실행(8)은 없다");
    a.batch_execute("DELETE FROM txs2_t WHERE id = 7").await.unwrap();
    // ── ⑧ 취소 → 전부 되돌림 ──
    let (h, l) = (o.handle, o.lease);
    let job = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO txs2_t VALUES (9, 9); SELECT pg_sleep(10); INSERT INTO txs2_t VALUES (10, 10)".into(), "s9".into(), 100, 30_000, Some(0)).await
    });
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(table::cancel(h, "s9").unwrap());
    let r = job.await.unwrap().unwrap();
    assert_eq!((r.outcome, r.reason), ("rolledBack", Some("cancelled")), "{r:?}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id IN (9, 10)").await, 0);
    // ── ⑨ 문장 시한 → 전부 되돌림 ──
    let r = table::script(h, l, "INSERT INTO txs2_t VALUES (11, 11); SELECT pg_sleep(5)".into(), "s".into(), 100, 300, Some(0)).await.unwrap();
    assert_eq!((r.outcome, r.reason), ("rolledBack", Some("timedOut")), "{r:?}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id = 11").await, 0);
    // ── ⑩ 실행 중 GUI 연결이 끊김 → 서버가 끝까지(커밋) · 트랜잭션을 열어 두지 않음 · 다시 붙으면 요약 ──
    let stream = format!("txs2-pg-drop-{label}");
    let d = open_on(CONN_DROP, &stream, id, pw).await;
    table::set_write(d.handle, d.lease, true).await.unwrap();
    let (h, l) = (d.handle, d.lease);
    let job = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO txs2_t VALUES (12, 12); SELECT pg_sleep(1.5); INSERT INTO txs2_t VALUES (13, 13)".into(), "sd".into(), 100, 30_000, Some(0)).await
    });
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(table::conn_gone(CONN_DROP), 1, "떼어 둔다");
    let r = job.await.unwrap().unwrap();
    assert_eq!(r.outcome, "committed", "떼어 두기는 스크립트를 끊지 않는다: {r:?}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs2_t WHERE id IN (12, 13)").await, 2);
    assert_eq!(pg_count(a, "SELECT count(*) FROM pg_stat_activity WHERE state LIKE 'idle in transaction%'").await, 0);
    let again = open_on(CONN_DROP, &stream, id, pw).await;
    assert!(again.reattached);
    let note = again.last_script.expect("다시 붙으면 요약");
    assert_eq!((note.outcome, note.detached, note.results.len()), ("committed", true, 3));
    assert!(open_on(CONN_DROP, &stream, id, pw).await.last_script.is_none(), "한 번만 건넨다");
    table::close(again.handle, None).unwrap();
    table::close(o.handle, None).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL (+ AYNX_TEST_PG_POOLER)"]
async fn pg_script() {
    let Some(url) = env("AYNX_TEST_PG_URL") else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let cfg = tokio_postgres::Config::from_str(&url).unwrap();
    let pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let port = cfg.get_ports()[0];
    let pooler = env("AYNX_TEST_PG_POOLER").and_then(|v| v.rsplit_once(':').map(|(h, p)| (h.to_string(), p.parse::<u16>().unwrap())));
    let mut rows = vec![("Test2_pg-direct", DbEngine::Postgres, "127.0.0.1", port, Some("postgres"), "postgres")];
    if let Some((h, p)) = &pooler {
        rows.push(("Test2_pg-pooler", DbEngine::Postgres, h.as_str(), *p, Some("postgres"), "postgres"));
    }
    let file = write_conns("pg", &rows);
    let a = pg_admin(&url).await;
    pg_suite(&a, "Test2_pg-direct", &pw, "direct").await;
    if pooler.is_some() {
        pg_suite(&a, "Test2_pg-pooler", &pw, "pooler").await;
    }
    a.batch_execute("DROP TABLE IF EXISTS txs2_t; DROP TABLE IF EXISTS txs2_made").await.unwrap();
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

// ── MySQL · MariaDB ──

async fn my_count(a: &mut mysql_async::Conn, sql: &str) -> i64 {
    a.query_first::<i64, _>(sql).await.unwrap().unwrap()
}

async fn my_suite(url: &str, id: &str, label: &str) {
    let opts = mysql_async::Opts::from_url(url).unwrap();
    let pw = opts.pass().unwrap_or_default().to_string();
    let port = opts.tcp_port();
    let file = write_conns(label, &[(id, DbEngine::Mysql, "127.0.0.1", port, Some("txs2"), "root")]);
    let mut a = mysql_async::Conn::new(opts.clone()).await.expect("관리 연결");
    a.query_drop(
        "DROP DATABASE IF EXISTS txs2; CREATE DATABASE txs2; \
         CREATE TABLE txs2.t(id INT PRIMARY KEY, v INT) ENGINE=InnoDB",
    )
    .await
    .unwrap();
    let maria = a.query_first::<String, _>("SELECT VERSION()").await.unwrap().unwrap().to_lowercase().contains("mariadb");
    let o = open_on(CONN, &format!("txs2-{label}"), id, &pw).await;
    // ── 읽기 전용 스크립트 ──
    let r = s(&o, "SELECT 1; SELECT COUNT(*) FROM t; SHOW TABLES", 0).await;
    assert_eq!((r.outcome, r.results.len()), ("readOnly", 3), "{r:?}");
    table::set_write(o.handle, o.lease, true).await.unwrap();
    // ── ① 3문장 성공 → 커밋 ──
    let r = s(&o, "INSERT INTO t VALUES (1, 1); INSERT INTO t VALUES (2, 2); UPDATE t SET v = v + 10", 0).await;
    assert_eq!((r.outcome, affected(&r)), ("committed", vec![Some(1), Some(1), Some(2)]), "{r:?}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE v > 10").await, 2);
    // ── ② 2번째 오류 → 전부 되돌림 ──
    let r = s(&o, "INSERT INTO t VALUES (3, 3); INSERT INTO t VALUES (1, 1); INSERT INTO t VALUES (4, 4)", 0).await;
    assert_eq!((r.outcome, r.reason, r.results.len()), ("rolledBack", Some("error"), 1), "{r:?}");
    assert!(r.failed.as_ref().unwrap().message.contains("1062"), "{:?}", r.failed);
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id IN (3, 4)").await, 0);
    // ── ③ 사전 거절 — DDL(암묵 커밋) · DELIMITER · autocommit → 아무것도 안 바뀐다 ──
    let r = s(&o, "INSERT INTO t VALUES (5, 5); CREATE TABLE z(a INT); INSERT INTO t VALUES (6, 6)", 0).await;
    assert_eq!((r.outcome, r.failed.as_ref().map(|f| f.index)), ("refused", Some(1)), "{r:?}");
    let r = s(&o, "DELIMITER $$\nINSERT INTO t VALUES (5, 5)$$", 0).await;
    assert_eq!((r.outcome, r.failed.is_none(), r.message.is_some()), ("refused", true, true));
    let r = s(&o, "INSERT INTO t VALUES (5, 5); SET autocommit = 0", 0).await;
    assert_eq!(r.outcome, "refused");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id >= 5").await, 0);
    // ── ④ MariaDB RETURNING — 영향 행 수 = 돌려준 행 수(상한 너머까지) ──
    if maria {
        let values: Vec<String> = (100..250).map(|i| format!("({i}, {i})")).collect();
        let r = s(&o, &format!("INSERT INTO t VALUES {} RETURNING id", values.join(", ")), 0).await;
        let x = &r.results[0].out;
        assert_eq!((r.outcome, x.rows.len(), x.affected), ("committed", 100, Some(150)), "{r:?}");
        a.query_drop("DELETE FROM txs2.t WHERE id >= 100").await.unwrap();
    }
    // ── ⑤ 작업 중 스크립트 — 그 작업 안 · 오류면 그 실행만 세이브포인트로 되돌리고 작업은 계속(10-14 결정) ──
    let tid = table::tx_begin(o.handle, o.lease).await.unwrap().id;
    let r = s(&o, "INSERT INTO t VALUES (6, 6)", tid).await;
    assert_eq!(r.outcome, "work", "{r:?}");
    let r = s(&o, "INSERT INTO t VALUES (7, 7); INSERT INTO t VALUES (1, 1); INSERT INTO t VALUES (8, 8)", tid).await;
    assert_eq!((r.outcome, r.reason, r.results.len(), tx_state(&r)["state"].as_str()), ("workUndone", Some("error"), 1, Some("open")), "{r:?}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id = 6").await, 0, "커밋 전");
    table::tx_end(o.handle, o.lease, tid, true).await.unwrap();
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id IN (6, 7, 8)").await, 1, "6(앞 실행)만 — 7 은 되돌린 실행분");
    a.query_drop("DELETE FROM txs2.t WHERE id = 6; INSERT INTO txs2.t VALUES (7, 7)").await.unwrap();
    // ── ⑥ 취소 → 전부 되돌림(SLEEP 은 끊겨도 1 을 돌려준다 — 다음 문장 전에 멈춘다) ──
    let (h, l) = (o.handle, o.lease);
    let job = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO t VALUES (9, 9); SELECT SLEEP(10); INSERT INTO t VALUES (10, 10)".into(), "s9".into(), 100, 30_000, Some(0)).await
    });
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(table::cancel(h, "s9").unwrap());
    let r = job.await.unwrap().unwrap();
    assert_eq!((r.outcome, r.reason), ("rolledBack", Some("cancelled")), "{r:?}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id IN (9, 10)").await, 0);
    // ── ⑦ 실행 중 GUI 연결이 끊김 → 서버가 끝까지(커밋) · 열린 트랜잭션 없음 ──
    let stream = format!("txs2-{label}-drop");
    let d = open_on(CONN_DROP, &stream, id, &pw).await;
    table::set_write(d.handle, d.lease, true).await.unwrap();
    let (h, l) = (d.handle, d.lease);
    let job = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO t VALUES (12, 12); SELECT SLEEP(1.5); INSERT INTO t VALUES (13, 13)".into(), "sd".into(), 100, 30_000, Some(0)).await
    });
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(table::conn_gone(CONN_DROP), 1);
    let r = job.await.unwrap().unwrap();
    assert_eq!(r.outcome, "committed", "{r:?}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs2.t WHERE id IN (12, 13)").await, 2);
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM information_schema.innodb_trx").await, 0, "열린 트랜잭션 없음");
    let again = open_on(CONN_DROP, &stream, id, &pw).await;
    assert_eq!(again.last_script.map(|n| n.outcome), Some("committed"));
    table::close(again.handle, None).unwrap();
    table::close(o.handle, None).unwrap();
    a.query_drop("DROP DATABASE IF EXISTS txs2").await.unwrap();
    let _ = a.disconnect().await;
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL 8.4"]
async fn mysql_script() {
    let Some(url) = env("AYNX_TEST_MY_URL") else {
        eprintln!("AYNX_TEST_MY_URL 없음 — 건너뜀");
        return;
    };
    my_suite(&url, "Test2_my-direct", "mysql").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB 11"]
async fn mariadb_script() {
    let Some(url) = env("AYNX_TEST_MARIA_URL") else {
        eprintln!("AYNX_TEST_MARIA_URL 없음 — 건너뜀");
        return;
    };
    my_suite(&url, "Test2_maria-dir", "maria").await;
}
