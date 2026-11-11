//! **Codex 검토 반영 1 통합 시험** — 작업 안 실행 · 끝내기의 판정(10-14). 실제 PostgreSQL · MySQL · MariaDB 가 있을 때만 돈다(`#[ignore]` +
//! 환경변수 — `tx_tests` 와 같은 변수 · 같은 도우미). 표(`table`)를 그대로 부르고, 가드가 막는 `CALL` 의 경계 판정만 엔진 겹을 바로 부른다
//! (`Mysql::query_in_work_unguarded`).
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55432/postgres
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53306/
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53307/
//! AYNX_TEST_PG_PAUSE=<PG 컨테이너 이름>      # 있으면 그 컨테이너를 잠깐 멈춰(docker pause) 응답 대기 중단을 잰다
//! cargo test --lib db::tx_verdict_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 회귀 대상(Codex 검토):
//! - MySQL `completion_type = 1`(CHAIN) 뒤에도 앱의 커밋 · 되돌리기 · 읽기 전용 길 · 스크립트 커밋이 숨은 트랜잭션을 남기지 않는다.
//! - `COMMIT` 한 뒤 `SIGNAL` 하는 프로시저 — 작업 안에서는 가드가 `CALL` 을 거절하고, 엔진 겹 혼자서도 "되돌림" 이 아니라 결과 불명.
//! - 세이브포인트를 지우는 프로시저 → 복구 실패 판정(작업 전체를 되돌림 · 결과 불명).
//! - 작업 안 스크립트의 **마지막** `SLEEP` 중 취소 → 앞 `INSERT` 가 남지 않는다(세 엔진 — SQLite 는 `tests`).
//! - 자동 커밋 끔 조회의 실행 중 읽기 전용 거절 → 다시 돌지 않는다(세션 잠금이 한 번만 잡힌다).
//! - MyISAM 변경의 되돌리기 → 경고 1196 을 결과에 밝힌다.
//! - (PG) 응답 대기 중단 → 실행 결과 미확인 · 연결 버림 · 작업은 끊김(서버가 되돌린다).

use std::str::FromStr;
use std::time::Duration;

use mysql_async::prelude::Queryable;
use serde_json::{json, Value};

use super::conns::{self, DbEngine};
use super::table::{self, Engine};
use super::tx_tests::{begin, env, my_count, open, pg_admin, pg_count, q, view, write_conns};
use super::RunEnd;

fn mysql_of(o: &table::Opened) -> std::sync::Arc<super::mysql::Mysql> {
    match table::engine_for_test(o.handle) {
        Engine::Mysql(m) => m,
        _ => panic!("MySQL 엔진이 아니다"),
    }
}

async fn end(o: &table::Opened, id: u64, commit: bool) -> Value {
    serde_json::to_value(table::tx_end(o.handle, o.lease, id, commit).await.unwrap()).unwrap()
}

// ---------------------------------------------------------------------------
// MySQL · MariaDB
// ---------------------------------------------------------------------------

async fn my_verdicts(url: &str, id: &str, label: &str) {
    let opts = mysql_async::Opts::from_url(url).unwrap();
    let pw = opts.pass().unwrap_or_default().to_string();
    let port = opts.tcp_port();
    let file = write_conns(&format!("v-{label}"), &[(id, DbEngine::Mysql, "127.0.0.1", port, Some("txs6"), "root")]);
    let mut a = mysql_async::Conn::new(opts.clone()).await.expect("관리 연결");
    // 함수 · 프로시저를 만드는 시험 준비(이진 로그가 켜진 서버) — 이 시험 전용 컨테이너다.
    let _ = a.query_drop("SET GLOBAL log_bin_trust_function_creators = 1").await;
    a.query_drop(
        "DROP DATABASE IF EXISTS txs6; CREATE DATABASE txs6; \
         CREATE TABLE txs6.t(id INT PRIMARY KEY, v INT) ENGINE=InnoDB; \
         CREATE TABLE txs6.m(id INT PRIMARY KEY) ENGINE=MyISAM; \
         INSERT INTO txs6.t VALUES (1, 1)",
    )
    .await
    .unwrap();
    for ddl in [
        "CREATE PROCEDURE txs6.chain_on() SET SESSION completion_type = 1",
        "CREATE PROCEDURE txs6.commit_signal() BEGIN INSERT INTO txs6.t VALUES (500, 0); COMMIT; \
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boom after commit'; END",
        "CREATE PROCEDURE txs6.drop_sp_fail() BEGIN RELEASE SAVEPOINT aynx_run; \
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'savepoint gone'; END",
        "CREATE PROCEDURE txs6.drop_sp_ok() RELEASE SAVEPOINT aynx_run",
        "CREATE FUNCTION txs6.f_ins() RETURNS INT MODIFIES SQL DATA BEGIN INSERT INTO txs6.t VALUES (900, 0); RETURN 1; END",
    ] {
        a.query_drop(ddl).await.unwrap_or_else(|e| panic!("{ddl}: {e}"));
    }
    let stream = format!("txs6-{label}");
    let o = open(&stream, id, &pw).await;
    table::set_write(o.handle, o.lease, true).await.unwrap();
    let m = mysql_of(&o);

    // ── ① completion_type = 1(CHAIN) — 앱의 종료문은 체인 없이 끝난다(숨은 트랜잭션 없음) ──
    q(&o, "CALL chain_on()", 0).await.expect("자동 커밋 단문의 CALL 은 받는다");
    let ct = q(&o, "SELECT @@SESSION.completion_type", 0).await.unwrap().rows;
    assert!(ct == vec![vec![json!("CHAIN")]] || ct == vec![vec![json!(1)]], "{label}: 세션이 CHAIN 이다: {ct:?}");
    let id1 = begin(&o).await;
    q(&o, "INSERT INTO t VALUES (10, 10)", id1).await.unwrap();
    let v = end(&o, id1, true).await;
    assert_eq!(v["ended"]["outcome"], "committed", "{v}");
    assert!(!m.tx_flags().await.0, "{label}: 커밋 뒤 숨은(체인) 트랜잭션이 없다");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.t WHERE id = 10").await, 1);
    let id2 = begin(&o).await;
    q(&o, "INSERT INTO t VALUES (11, 11)", id2).await.unwrap();
    assert_eq!(end(&o, id2, false).await["ended"]["outcome"], "rolledBack");
    assert!(!m.tx_flags().await.0, "{label}: 되돌리기 뒤 숨은 트랜잭션이 없다");
    // 자동 커밋 끔의 조회 길(START TRANSACTION READ ONLY … ROLLBACK)도 체인 없이.
    assert!(!table::set_auto_commit(o.handle, o.lease, false).unwrap());
    q(&o, "SELECT COUNT(*) FROM t", 0).await.unwrap();
    assert!(!m.tx_flags().await.0, "{label}: 읽기 전용 길 뒤 숨은 트랜잭션이 없다");
    assert!(table::set_auto_commit(o.handle, o.lease, true).unwrap());
    // 스크립트(자동 커밋 켬 = 한 트랜잭션 → 커밋)도.
    let s = table::script(o.handle, o.lease, "INSERT INTO t VALUES (12, 12); INSERT INTO t VALUES (13, 13)".into(), "c".into(), 100, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!(s.outcome, "committed", "{s:?}");
    assert!(!m.tx_flags().await.0, "{label}: 스크립트 커밋 뒤 숨은 트랜잭션이 없다");
    // 사람은 completion_type 을 바꾸지 못한다(가드).
    let e = q(&o, "SET SESSION completion_type = 1", 0).await.unwrap_err();
    assert!(e.contains("completion_type"), "{e}");
    m.raw_for_test("SET SESSION completion_type = 0").await;

    // ── ② COMMIT 뒤 SIGNAL 하는 프로시저 — 작업 안에서는 가드가 CALL 을 거절 · 엔진 겹 혼자서도 "되돌림" 이 아니라 결과 불명 ──
    let id3 = begin(&o).await;
    let e = q(&o, "CALL commit_signal()", id3).await.unwrap_err();
    assert!(e.contains("CALL"), "{e}");
    assert_eq!(view(&o)["state"], "open");
    let (r, verdict) = m.query_in_work_unguarded("CALL txs6.commit_signal()").await;
    assert!(r.is_err(), "{r:?}");
    assert!(matches!(verdict, Some(RunEnd::Unknown(_))), "{label}: COMMIT 뒤 SIGNAL = 결과 불명이어야 한다: {verdict:?}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.t WHERE id = 500").await, 1, "실제로 커밋됐다 — '되돌림' 이라 하면 거짓");
    assert!(!m.in_tx());
    let _ = table::tx_state(o.handle, o.lease); // 표 칸을 엔진에 맞춘다(시험이 표를 건너뛰었다)

    // ── ③ 세이브포인트를 지우는 프로시저 — 복구 실패 → 작업 전체를 되돌림 · 결과 불명 ──
    let id4 = begin(&o).await;
    q(&o, "INSERT INTO t VALUES (20, 20)", id4).await.unwrap();
    let (r, verdict) = m.query_in_work_unguarded("CALL txs6.drop_sp_fail()").await;
    assert!(r.is_err());
    match &verdict {
        Some(RunEnd::Unknown(msg)) => assert!(msg.contains("세이브포인트") || msg.contains("savepoint"), "{msg}"),
        other => panic!("{label}: 복구 실패여야 한다: {other:?}"),
    }
    assert!(!m.in_tx() && !m.tx_flags().await.0, "더 실행하지 않게 작업 전체를 되돌렸다");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.t WHERE id = 20").await, 0);
    let _ = table::tx_state(o.handle, o.lease);
    let id5 = begin(&o).await;
    q(&o, "INSERT INTO t VALUES (21, 21)", id5).await.unwrap();
    let (r, verdict) = m.query_in_work_unguarded("CALL txs6.drop_sp_ok()").await;
    assert!(r.is_ok() && matches!(verdict, Some(RunEnd::Unknown(_))), "{label}: 성공했지만 세이브포인트를 못 풂 = 복구 실패: {verdict:?}");
    assert!(!m.in_tx());
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.t WHERE id = 21").await, 0);
    let _ = table::tx_state(o.handle, o.lease);

    // ── ④ 작업 안 스크립트의 마지막 SLEEP 중 취소 — 앞 INSERT 가 남지 않는다(SLEEP 은 끊겨도 오류 없이 1) ──
    let id6 = begin(&o).await;
    let (h, l) = (o.handle, o.lease);
    let run = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO t VALUES (30, 30); SELECT SLEEP(10)".into(), "sl".into(), 100, 30_000, Some(id6)).await
    });
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(table::cancel(o.handle, "sl").unwrap(), "도는 스크립트를 끊었다");
    let s = run.await.unwrap().unwrap();
    assert_eq!((s.outcome, s.reason), ("workUndone", Some("cancelled")), "{label}: {s:?}");
    assert_eq!(view(&o)["state"], "open");
    assert_eq!(q(&o, "SELECT COUNT(*) FROM t WHERE id = 30", id6).await.unwrap().rows, vec![vec![json!(0)]], "{label}: 취소한 실행은 남지 않는다");
    // 단문의 SLEEP 취소도 성공으로 돌아오지 않는다.
    let (h, l) = (o.handle, o.lease);
    let run = tokio::spawn(async move { table::query(h, l, "SELECT SLEEP(10)".into(), "s1".into(), 100, 30_000, Some(id6)).await });
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(table::cancel(o.handle, "s1").unwrap());
    let r = run.await.unwrap();
    assert!(r.as_ref().is_err_and(|m| m.contains("[cancelled]")), "{label}: {r:?}");
    assert_eq!(view(&o)["state"], "open");
    end(&o, id6, false).await;

    // ── ⑤ 자동 커밋 끔 조회의 실행 중 읽기 전용 거절 — 다시 돌지 않는다(세션 잠금이 한 번만) ──
    assert!(!table::set_auto_commit(o.handle, o.lease, false).unwrap());
    let s = table::script(o.handle, o.lease, "SELECT GET_LOCK('txs6k', 0); SELECT f_ins()".into(), "ro".into(), 100, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!(s.outcome, "readOnly", "{s:?}");
    let f = s.failed.as_ref().expect("멈춘 문장");
    assert!(f.message.contains("[트랜잭션 작업 시작]") || f.message.contains("[Start transaction]"), "{f:?}");
    assert!(!f.message.contains("[db-needs-work]"), "스크립트 줄에는 이유 코드를 싣지 않는다: {f:?}");
    assert!(s.needs_work, "판 15 — 화면이 [트랜잭션 작업 시작] 단추를 세우는 표지: {s:?}");
    assert_eq!(view(&o)["id"], 0, "작업을 열지 않는다");
    let e = q(&o, "SELECT f_ins()", 0).await.unwrap_err();
    assert!(e.contains("[db-needs-work]"), "{e}");
    assert_eq!(view(&o)["id"], 0);
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.t WHERE id = 900").await, 0);
    assert!(table::set_auto_commit(o.handle, o.lease, true).unwrap());
    let r1 = q(&o, "SELECT RELEASE_LOCK('txs6k')", 0).await.unwrap().rows;
    let r2 = q(&o, "SELECT RELEASE_LOCK('txs6k')", 0).await.unwrap().rows;
    assert_eq!((r1, r2), (vec![vec![json!(1)]], vec![vec![json!(null)]]), "{label}: GET_LOCK 은 한 번만 잡혔다(다시 돌지 않았다)");

    // ── ⑥ 비트랜잭션 테이블(MyISAM) — 되돌리기가 경고 1196 을 결과에 밝힌다 ──
    let id7 = begin(&o).await;
    q(&o, "INSERT INTO m VALUES (1)", id7).await.unwrap();
    let v = end(&o, id7, false).await;
    assert_eq!(v["ended"]["outcome"], "rolledBack");
    let note = v["ended"]["message"].as_str().unwrap_or_default();
    assert!(note.contains("1196"), "{label}: {v}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs6.m").await, 1, "MyISAM 은 되돌려지지 않았다");
    // 작업 안 단문의 실패(MyISAM 두 줄 중 둘째가 중복) — 이번 실행만 되돌리되 1196 · 남는 잠금을 밝힌다.
    let id8 = begin(&o).await;
    let e = q(&o, "INSERT INTO m VALUES (2), (1)", id8).await.unwrap_err();
    assert!(e.contains("1062") && e.contains("1196"), "{label}: {e}");
    assert!(e.contains("잠금") || e.contains("lock"), "{e}");
    assert_eq!(view(&o)["state"], "open");
    end(&o, id8, false).await;

    table::close(o.handle, None).unwrap();
    a.query_drop("DROP DATABASE IF EXISTS txs6").await.unwrap();
    let _ = a.disconnect().await;
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL 8.4"]
async fn mysql_tx_verdicts() {
    let Some(url) = env("AYNX_TEST_MY_URL") else {
        eprintln!("AYNX_TEST_MY_URL 없음 — 건너뜀");
        return;
    };
    my_verdicts(&url, "Test6_my-direct", "mysql").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB 11"]
async fn mariadb_tx_verdicts() {
    let Some(url) = env("AYNX_TEST_MARIA_URL") else {
        eprintln!("AYNX_TEST_MARIA_URL 없음 — 건너뜀");
        return;
    };
    my_verdicts(&url, "Test6_maria-direct", "mariadb").await;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

/// 멈춘 컨테이너는 시험이 실패해도 다시 깨운다.
struct Unpause(String);

impl Drop for Unpause {
    fn drop(&mut self) {
        let _ = std::process::Command::new("docker").args(["unpause", &self.0]).output();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL (+ AYNX_TEST_PG_PAUSE)"]
async fn pg_tx_verdicts() {
    let Some(url) = env("AYNX_TEST_PG_URL") else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let cfg = tokio_postgres::Config::from_str(&url).unwrap();
    let pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let port = cfg.get_ports()[0];
    let id = "Test6_pg-direct";
    let file = write_conns("v-pg", &[(id, DbEngine::Postgres, "127.0.0.1", port, Some("postgres"), "postgres")]);
    let a = pg_admin(&url).await;
    a.batch_execute(
        "DROP TABLE IF EXISTS txs6_t; CREATE TABLE txs6_t(id int PRIMARY KEY, v int); \
         CREATE OR REPLACE FUNCTION txs6_f() RETURNS int LANGUAGE sql AS $$ INSERT INTO txs6_t VALUES (900, 0) RETURNING 1 $$",
    )
    .await
    .unwrap();
    let o = open("txs6-pg", id, &pw).await;
    table::set_write(o.handle, o.lease, true).await.unwrap();

    // ── 작업 안 스크립트의 마지막 pg_sleep 중 취소 — 앞 INSERT 가 남지 않는다 ──
    let id1 = begin(&o).await;
    let (h, l) = (o.handle, o.lease);
    let run = tokio::spawn(async move {
        table::script(h, l, "INSERT INTO txs6_t VALUES (30, 30); SELECT pg_sleep(10)".into(), "sl".into(), 100, 30_000, Some(id1)).await
    });
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert!(table::cancel(o.handle, "sl").unwrap());
    let s = run.await.unwrap().unwrap();
    assert_eq!((s.outcome, s.reason), ("workUndone", Some("cancelled")), "{s:?}");
    assert_eq!(q(&o, "SELECT count(*)::int FROM txs6_t WHERE id = 30", id1).await.unwrap().rows, vec![vec![json!(0)]]);
    end(&o, id1, false).await;

    // ── 자동 커밋 끔 조회의 실행 중 읽기 전용 거절 — 다시 돌지 않는다(세션 advisory lock 이 겹치지 않는다) ──
    assert!(!table::set_auto_commit(o.handle, o.lease, false).unwrap());
    let s = table::script(o.handle, o.lease, "SELECT pg_advisory_lock(4242); SELECT txs6_f()".into(), "ro".into(), 100, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!(s.outcome, "readOnly", "{s:?}");
    assert!(s.failed.as_ref().is_some_and(|f| f.message.contains("[트랜잭션 작업 시작]") || f.message.contains("[Start transaction]")), "{s:?}");
    assert_eq!(view(&o)["id"], 0);
    let e = q(&o, "SELECT txs6_f()", 0).await.unwrap_err();
    assert!(e.contains("[db-needs-work]"), "{e}");
    assert_eq!(pg_count(&a, "SELECT count(*) FROM txs6_t WHERE id = 900").await, 0);
    assert!(table::set_auto_commit(o.handle, o.lease, true).unwrap());
    let r1 = q(&o, "SELECT pg_advisory_unlock(4242)", 0).await.unwrap().rows;
    let r2 = q(&o, "SELECT pg_advisory_unlock(4242)", 0).await.unwrap().rows;
    assert_eq!((r1, r2), (vec![vec![json!(true)]], vec![vec![json!(false)]]), "advisory lock 은 한 번만 잡혔다(다시 돌지 않았다)");

    // ── 응답 대기 중단 — 실행 결과 미확인 · 연결 버림 · 작업은 끊김(서버가 되돌린다) ──
    if let Some(name) = env("AYNX_TEST_PG_PAUSE") {
        let id2 = begin(&o).await;
        q(&o, "INSERT INTO txs6_t VALUES (40, 40)", id2).await.unwrap();
        let paused = Unpause(name.clone());
        let out = std::process::Command::new("docker").args(["pause", &name]).output().expect("docker pause");
        assert!(out.status.success(), "{out:?}");
        let started = std::time::Instant::now();
        let r = table::query(o.handle, o.lease, "SELECT 1".into(), "pz".into(), 100, 1_000, Some(id2)).await;
        let took = started.elapsed();
        drop(paused);
        let e = r.unwrap_err();
        assert!(e.contains("기다리기를 멈추고") || e.contains("stopped waiting"), "{e}");
        assert!(e.starts_with("[db-unconfirmed]"), "판 15 — 결과 미확인 이유 코드: {e}");
        assert!(!e.contains("이번 실행만 되돌렸습니다") && !e.contains("Only this run was rolled back"), "되돌림이라 하지 않는다: {e}");
        let v = view(&o);
        assert_eq!(v["ended"]["outcome"], "disconnected", "{v}");
        eprintln!("MEASURE pg 응답 대기 중단 {took:?} → {}", v["ended"]["outcome"]);
        // 서버는 닫힌 소켓을 보고 그 트랜잭션을 되돌린다.
        let mut gone = false;
        for _ in 0..50 {
            if pg_count(&a, "SELECT count(*) FROM txs6_t WHERE id = 40").await == 0
                && pg_count(&a, "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'Aynx' AND state LIKE 'idle in transaction%'").await == 0
            {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert!(gone, "버린 연결의 트랜잭션은 서버가 되돌렸다");
        // 그 연결은 다시 쓰지 않는다 — 같은 타일이 열면 새로 붙는다.
        let o2 = open("txs6-pg", id, &pw).await;
        assert!(!o2.reattached, "버린 연결에는 다시 붙지 않는다");
        table::close(o2.handle, None).unwrap();
    } else {
        eprintln!("AYNX_TEST_PG_PAUSE 없음 — 응답 대기 중단은 건너뜀");
        table::close(o.handle, None).unwrap();
    }
    a.batch_execute("DROP TABLE IF EXISTS txs6_t; DROP FUNCTION IF EXISTS txs6_f()").await.unwrap();
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

/// 판 15 — 실행 결과 미확인은 `[db-unconfirmed]` 이유 코드로 나간다(화면이 '결과 불명' 틀로 보인다 · AI 길은 `plain` 이 뗀다).
#[test]
fn unconfirmed_carries_its_reason_code() {
    let m = table::message(super::EngineError::Unconfirmed("모름".into()), true, false, 1_000);
    assert_eq!(m, "[db-unconfirmed] 모름");
    assert_eq!(super::ai::plain(&m), "모름");
    assert_eq!(table::message(super::EngineError::Message("보통".into()), false, false, 1_000), "보통");
}
