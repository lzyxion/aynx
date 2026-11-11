//! **트랜잭션 작업 통합 시험**(쿼리 타일 1단계 — 10-13 결정) — 실제 PostgreSQL · PgBouncer · MySQL · MariaDB 가 있을 때만 돈다
//! (`#[ignore]` + 환경변수 — `pg_tests` · `mysql_tests` 와 같은 변수). 표(`table`)의 공개 함수를 그대로 부른다(열기 · 문장 · 메타 ·
//! 커밋 · 되돌리기 · 떼어 두기 · 방치 시계). 연결 목록은 시험용 임시 파일(`conns::set_path_override`)이고, 비밀번호는 몸으로만 싣는다.
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55432/postgres
//! AYNX_TEST_PG_POOLER=127.0.0.1:56432          # PgBouncer transaction 모드(있으면 같은 시험을 풀러 뒤에서 한 번 더)
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53306/
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53307/
//! cargo test --lib db::tx_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! 표가 프로세스에 하나라 `--test-threads=1` 로 돈다.

use std::str::FromStr;
use std::time::Duration;

use mysql_async::prelude::Queryable;
use serde_json::{json, Value};
use tokio_postgres::NoTls;
use zeroize::Zeroizing;

use super::conns::{self, DbConn, DbEngine, DbTlsMode};
use super::definition::DefTarget;
use super::net::OpenSecrets;
use super::table::{self, ConnRef};
use crate::ssh::open::SharedCreds;

/// 시험의 서버 연결 번호(표의 `conns` 에 세워 둔다 — 없으면 열자마자 떼어 둔다).
pub(super) const CONN: u64 = 7_700_001;

pub(super) fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

pub(super) fn secrets(pw: &str) -> OpenSecrets {
    OpenSecrets {
        password: Some(Zeroizing::new(pw.to_string())),
        ssh: SharedCreds::default(),
        vault: true,
        from_vault: false,
    }
}

/// 연결 목록의 한 줄 — `(id, 엔진, host, port, database, user)`.
pub(super) type ConnRow<'a> = (&'a str, DbEngine, &'a str, u16, Option<&'a str>, &'a str);

/// 연결 목록을 임시 파일 하나로.
pub(super) fn write_conns(tag: &str, rows: &[ConnRow<'_>]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("aynx-tx-test-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let conns: Vec<DbConn> = rows
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
    std::fs::write(&file, serde_json::to_string(&conns).unwrap()).unwrap();
    conns::set_path_override(Some(file.clone()));
    file
}

pub(super) async fn open(stream: &str, id: &str, pw: &str) -> table::Opened {
    table::conn_opened(CONN);
    // 창 이름 = 타일 열쇠 — 떼어 두기 시험이 다른 시험이 남긴 항목을 건드리지 않게.
    match table::open(stream.into(), stream.into(), CONN, ConnRef { id: id.into() }, secrets(pw)).await {
        Ok(o) => o,
        Err(super::net::OpenError::Msg(m)) => panic!("열기 실패: {m}"),
        Err(super::net::OpenError::Ssh(e)) => panic!("ssh {e:?}"),
    }
}

/// 작업 안 문장 — 화면처럼 작업 id 를 싣는다.
pub(super) async fn q(o: &table::Opened, sql: &str, tx: u64) -> Result<super::QueryOut, String> {
    table::query(o.handle, o.lease, sql.into(), "q".into(), 100, 5_000, Some(tx)).await
}

pub(super) fn tx_of(out: &super::QueryOut) -> Value {
    serde_json::to_value(out.tx.as_ref().expect("tx 칸")).unwrap()
}

pub(super) fn view(o: &table::Opened) -> Value {
    serde_json::to_value(table::tx_state(o.handle, o.lease).unwrap()).unwrap()
}

pub(super) async fn begin(o: &table::Opened) -> u64 {
    table::tx_begin(o.handle, o.lease).await.expect("작업 시작").id
}

fn def(kind: &str, name: &str) -> DefTarget {
    serde_json::from_value(json!({ "schema": null, "kind": kind, "name": name })).unwrap()
}

// ---------------------------------------------------------------------------
// PostgreSQL (+ PgBouncer transaction 모드)
// ---------------------------------------------------------------------------

pub(super) async fn pg_admin(url: &str) -> tokio_postgres::Client {
    let (c, conn) = tokio_postgres::Config::from_str(url).unwrap().connect(NoTls).await.expect("관리 연결");
    tokio::spawn(conn);
    c
}

pub(super) async fn pg_count(a: &tokio_postgres::Client, sql: &str) -> i64 {
    a.query_one(sql, &[]).await.unwrap().get(0)
}

/// 한 갈래(직결 또는 풀러)의 PG 시험 — `id` 의 연결로.
async fn pg_suite(a: &tokio_postgres::Client, id: &str, pw: &str, label: &str) {
    a.batch_execute("DROP TABLE IF EXISTS txs1_t; DROP TABLE IF EXISTS txs1_made; CREATE TABLE txs1_t(id int PRIMARY KEY, v int)")
        .await
        .unwrap();
    let stream = format!("txs1-pg-{label}");
    let o = open(&stream, id, pw).await;
    assert_eq!(o.tx.state, "none");
    table::set_write(o.handle, o.lease, true).await.unwrap();

    // ── 시작 → 같은 연결에서 보임 · 다른 연결엔 안 보임 → 메타(트리 · 구조 · DDL)가 작업 안에서 돌고 깨지 않음 → 커밋 ──
    let id1 = begin(&o).await;
    let r = q(&o, "INSERT INTO txs1_t VALUES (1, 10), (2, 20)", id1).await.unwrap();
    assert_eq!((r.affected, tx_of(&r)["statements"].as_u64()), (Some(2), Some(1)));
    let r = q(&o, "SELECT count(*)::int FROM txs1_t", id1).await.unwrap();
    assert_eq!(r.rows, vec![vec![json!(2)]], "같은 연결에서 보인다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 0, "다른 연결엔 안 보인다");
    // 작업 안에서 만든 테이블이 트리 · 구조 · DDL 에 보인다(같은 트랜잭션의 세이브포인트 — 다른 연결이면 안 보이고 잠금에 막힌다).
    q(&o, "CREATE TABLE txs1_made(a int, b text)", id1).await.unwrap();
    let schema = table::schema(o.handle, o.lease).await.unwrap();
    assert!(schema.to_string().contains("public"), "{schema}");
    let objs = table::objects(o.handle, o.lease, Some("public".into())).await.unwrap();
    assert!(objs.to_string().contains("txs1_made"), "작업 안의 새 테이블이 트리에: {objs}");
    let det = table::table_detail(o.handle, o.lease, None, "txs1_made".into()).await.unwrap();
    assert_eq!(det["columns"][1]["name"], "b");
    let d = table::definition(o.handle, o.lease, def("table", "txs1_made")).await.unwrap();
    assert!(d["sql"].as_str().unwrap().contains("CREATE TABLE"), "{d}");
    // 없는 객체의 메타 · 메타의 서버 오류도 작업을 깨지 않는다(세이브포인트로 되감는다).
    assert!(table::table_detail(o.handle, o.lease, None, "nope_zz".into()).await.is_err());
    assert!(table::definition(o.handle, o.lease, def("function", "nope_zz")).await.is_err());
    let r = q(&o, "UPDATE txs1_t SET v = v + 1", id1).await.expect("메타 뒤에도 작업이 산다");
    assert_eq!(r.affected, Some(2));
    // 사람이 친 SET LOCAL statement_timeout = 0 도 다음 문장 앞에서 덮인다(실행마다 세이브포인트 뒤에 다시 건다).
    let pid0 = q(&o, "SELECT pg_backend_pid()", id1).await.unwrap().rows[0][0].clone();
    q(&o, "SET LOCAL statement_timeout = 0", id1).await.unwrap();
    let slow = table::query(o.handle, o.lease, "SELECT pg_sleep(0.6)".into(), "q".into(), 10, 200, Some(id1)).await;
    let m = slow.expect_err("시간 제한");
    assert!(m.contains("이번 실행만") || m.contains("Only this run"), "10-14: PG 의 시간 초과는 그 실행만 되돌린다: {m}");
    assert_eq!(view(&o)["state"], "open", "작업은 산다");
    // 세이브포인트로 되감은 뒤에도 시한이 걸린다(ROLLBACK TO 가 SET LOCAL 을 되감아도 다음 실행이 다시 건다).
    let slow = table::query(o.handle, o.lease, "SELECT pg_sleep(0.6)".into(), "q".into(), 10, 200, Some(id1)).await;
    assert!(slow.is_err(), "되감은 뒤에도 statement_timeout 이 걸린다");
    let t0 = std::time::Instant::now();
    assert!(table::query(o.handle, o.lease, "SELECT pg_sleep(3)".into(), "q".into(), 10, 300, Some(id1)).await.is_err());
    assert!(t0.elapsed() < Duration::from_millis(2500), "긴 pg_sleep 도 시한에 끊긴다: {:?}", t0.elapsed());
    // 연결은 'idle in transaction (aborted)' 가 아니다 — 세이브포인트로 살아났고 다음 문장이 돈다(같은 백엔드).
    if label == "direct" {
        let st: String = a
            .query_one("SELECT state FROM pg_stat_activity WHERE application_name = 'Aynx' ORDER BY backend_start DESC LIMIT 1", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(st, "idle in transaction", "{st}");
    }
    let r = q(&o, "UPDATE txs1_t SET v = v + 1", id1).await.expect("오류 뒤에도 작업이 계속된다");
    assert_eq!(r.affected, Some(2));
    assert_eq!(q(&o, "SELECT pg_backend_pid()", id1).await.unwrap().rows[0][0], pid0, "같은 백엔드({label})");
    let back = serde_json::to_value(table::tx_end(o.handle, o.lease, id1, false).await.unwrap()).unwrap();
    assert_eq!(back["ended"]["outcome"], "rolledBack", "{back}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM pg_class WHERE relname = 'txs1_made'").await, 0, "되돌려져 테이블도 없다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 0);

    // ── 커밋 ──
    let id2 = begin(&o).await;
    assert_ne!(id2, id1);
    q(&o, "INSERT INTO txs1_t VALUES (3, 30)", id2).await.unwrap();
    // 트랜잭션 밖 전용 문장 — 가드가 미리 거절, 작업은 그대로.
    let m = q(&o, "VACUUM txs1_t", id2).await.unwrap_err();
    assert!(m.contains("VACUUM"), "{m}");
    assert_eq!(view(&o)["state"], "open");
    // 작업 중 백엔드 고정(풀러 뒤에서도 — 트랜잭션이 열린 동안 풀러는 같은 서버 연결을 준다).
    let p1 = q(&o, "SELECT pg_backend_pid()", id2).await.unwrap().rows[0][0].clone();
    for _ in 0..5 {
        // 다른 클라이언트가 그 사이 트랜잭션을 잡았다 놓는다.
        a.batch_execute("BEGIN; SELECT 1; COMMIT").await.unwrap();
        assert_eq!(q(&o, "SELECT pg_backend_pid()", id2).await.unwrap().rows[0][0], p1, "작업 동안 같은 백엔드({label})");
    }
    let done = table::tx_end(o.handle, o.lease, id2, true).await.unwrap();
    let dv = serde_json::to_value(&done).unwrap();
    assert_eq!((dv["state"].as_str(), dv["ended"]["outcome"].as_str(), dv["ended"]["statements"].as_u64()), (Some("none"), Some("committed"), Some(7)), "{dv}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 1);

    // ── PG 오류 → 그 실행만 되돌림(세이브포인트 — 10-14 결정) · 작업 계속 → 커밋하면 앞 실행만 ──
    let id3 = begin(&o).await;
    q(&o, "INSERT INTO txs1_t VALUES (4, 40)", id3).await.unwrap(); // 실행 A
    let pid3 = q(&o, "SELECT pg_backend_pid()", id3).await.unwrap().rows[0][0].clone();
    // 실행 B — 3문장 중 2번째 오류(23505) → B 전체(9 포함)만 되돌림.
    let s = table::script(o.handle, o.lease, "INSERT INTO txs1_t VALUES (9, 90); INSERT INTO txs1_t VALUES (3, 0); INSERT INTO txs1_t VALUES (10, 100)".into(), "s".into(), 100, 5_000, Some(id3))
        .await
        .unwrap();
    assert_eq!((s.outcome, s.reason, s.failed.as_ref().map(|f| f.index)), ("workUndone", Some("error"), Some(1)), "{s:?}");
    // 단문 오류도 그 실행만.
    let m = q(&o, "INSERT INTO txs1_t VALUES (3, 0)", id3).await.unwrap_err();
    assert!(m.contains("23505") && (m.contains("이번 실행만") || m.contains("Only this run")), "{m}");
    let v = view(&o);
    assert_eq!((v["state"].as_str(), v["id"].as_u64(), v["statements"].as_u64()), (Some("open"), Some(id3), Some(2)), "{v}");
    assert_eq!(q(&o, "SELECT count(*)::int FROM txs1_t", id3).await.unwrap().rows, vec![vec![json!(2)]], "작업 안에서는 3 · 4 만");
    assert_eq!(q(&o, "SELECT pg_backend_pid()", id3).await.unwrap().rows[0][0], pid3, "오류 뒤에도 같은 백엔드({label})");
    table::tx_end(o.handle, o.lease, id3, true).await.unwrap();
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2, "커밋 — A(4)만 더해졌다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t WHERE id IN (9, 10)").await, 0, "B 는 없다");
    a.batch_execute("DELETE FROM txs1_t WHERE id = 4").await.unwrap();
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 1);
    // 작업 밖 자동 커밋은 그대로 선다.
    q(&o, "INSERT INTO txs1_t VALUES (5, 50)", 0).await.unwrap();
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2);

    // ── 떼어 두기 동안 유지 · 다시 붙으면 같은 작업 ──
    let id4 = begin(&o).await;
    q(&o, "DELETE FROM txs1_t", id4).await.unwrap();
    assert_eq!(table::detach_window(&stream, &Default::default()), 1);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let o2 = open(&stream, id, pw).await;
    assert!(o2.reattached);
    assert_eq!((o2.tx.state, o2.tx.id, o2.tx.statements), ("open", id4, 1));
    assert!(table::tx_end(o.handle, o.lease, id4, true).await.unwrap_err().contains("[stale-lease]"));
    table::tx_end(o2.handle, o2.lease, id4, false).await.unwrap();
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2, "되돌림");

    // ── 방치 시계 — 경고 뒤 되돌림 ──
    table::set_tx_clock_for_test(Some((Duration::from_millis(1200), Duration::from_millis(600))));
    let id5 = begin(&o2).await;
    q(&o2, "INSERT INTO txs1_t VALUES (6, 60)", id5).await.unwrap();
    tokio::time::sleep(Duration::from_millis(800)).await;
    let w = view(&o2);
    assert_eq!((w["state"].as_str(), w["warn"].as_bool()), (Some("open"), Some(true)), "{w}");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let w = view(&o2);
    assert_eq!((w["state"].as_str(), w["ended"]["outcome"].as_str()), (Some("none"), Some("idleRolledBack")), "{w}");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2);
    table::set_tx_clock_for_test(None);

    // ── 자동 커밋 끔(10-14) — 조회는 트랜잭션을 열지 않는다 · 바꾸는 문장은 작업을 연다 · 숨은 쓰기도 ──
    assert!(!table::set_auto_commit(o2.handle, o2.lease, false).unwrap());
    let r = q(&o2, "SELECT count(*)::int FROM txs1_t", 0).await.unwrap();
    assert_eq!((r.rows.clone(), tx_of(&r)["state"].clone()), (vec![vec![json!(2)]], json!("none")));
    if label == "direct" {
        let st: String = a
            .query_one("SELECT state FROM pg_stat_activity WHERE application_name = 'Aynx' ORDER BY backend_start DESC LIMIT 1", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(st, "idle", "조회 뒤 열린 트랜잭션이 없다: {st}");
    }
    // 숨은 쓰기(허용 목록 첫 낱말 뒤의 INSERT) — 엔진이 실행 중에 읽기 전용으로 거절한다. 다시 돌지 않고 안내로 끝낸다(Codex 검토 반영 1 —
    // 그 앞의 부작용이 두 번 나지 않게). 작업은 열리지 않고 아무것도 들어가지 않는다.
    let m = q(&o2, "WITH x AS (INSERT INTO txs1_t VALUES (12, 120) RETURNING id) SELECT count(*)::int FROM x", 0).await.unwrap_err();
    assert!(m.contains("[db-needs-work]") && (m.contains("[트랜잭션 작업 시작]") || m.contains("[Start transaction]")), "{m}");
    assert_eq!(view(&o2)["id"], 0, "작업을 열지 않는다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t WHERE id = 12").await, 0);
    if label == "direct" {
        let st: String = a
            .query_one("SELECT state FROM pg_stat_activity WHERE application_name = 'Aynx' ORDER BY backend_start DESC LIMIT 1", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(st, "idle", "{st}");
    }
    // 작업 안에서 못 도는 문장은 작업을 열지 않고 안내.
    let m = q(&o2, "VACUUM txs1_t", 0).await.unwrap_err();
    assert!(m.contains("'자동 커밋'") || m.contains("'Auto-commit'"), "{m}");
    assert_eq!(view(&o2)["state"], "none");
    // 저절로 연 작업의 첫 실행이 실패(10-14 실기 — 중복 키) — 빈 작업까지 닫힌다: "작업 유지" 라 하지 않는다.
    let m = q(&o2, "INSERT INTO txs1_t VALUES (50, 0), (50, 0)", 0).await.unwrap_err();
    assert!(m.contains("23505") && (m.contains("열리지 않았습니다") || m.contains("no transaction was left open")), "{label}: {m}");
    assert!(!(m.contains("이번 실행만") || m.contains("Only this run")), "{label}: {m}");
    assert_eq!(view(&o2)["id"], 0, "{label}: 빈 작업은 닫힌다");
    let s = table::script(o2.handle, o2.lease, "UPDATE txs1_t SET v = 8888; INSERT INTO txs1_t VALUES (50, 0), (50, 0); UPDATE txs1_t SET v = 7777".into(), "s".into(), 100, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!((s.outcome, s.reason, s.work_closed, s.failed.as_ref().map(|f| f.index)), ("rolledBack", Some("error"), true, Some(1)), "{label}: {s:?}");
    assert_eq!(view(&o2)["id"], 0, "{label}: 빈 작업은 닫힌다");
    assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t WHERE v IN (8888, 7777)").await, 0);
    assert!(table::set_auto_commit(o2.handle, o2.lease, true).unwrap());

    // ── 커밋 응답 유실(보내기 전에 서버가 연결을 끊음) → 결과 불명 ──
    if label == "direct" {
        let id6 = begin(&o2).await;
        q(&o2, "INSERT INTO txs1_t VALUES (7, 70)", id6).await.unwrap();
        a.batch_execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'Aynx'").await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        // 끊김을 이미 알아챘으면(드라이버 연결 태스크가 끝남 — 보통) 커밋을 보내지 않고 '끊김' 으로 맞춘 뒤 `[db-tx-stale]`(화면이 상태를
        // 다시 읽는다 — 커밋을 보내기 전에 끊겼으니 결과는 분명히 되돌림), 아직 몰랐으면 보낸 뒤 결과 불명 · 끊김.
        let v = match table::tx_end(o2.handle, o2.lease, id6, true).await {
            Ok(v) => serde_json::to_value(v).unwrap(),
            Err(m) => {
                assert!(m.contains("[db-tx-stale]"), "{m}");
                view(&o2)
            }
        };
        assert!(matches!(v["state"].as_str(), Some("unknown") | Some("disconnected")), "{v}");
        eprintln!("MEASURE pg 커밋 전 끊김 → {}", v["state"]);
        assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2);

        // ── 쉬는 동안 서버가 백엔드를 끊음 → 표가 곧바로 '끊김'(10-13 실기: 10분 동안 '열림' 으로 남다 방치 시계가 죽은 연결을
        //    "되돌렸다" 고 적던 구멍) · 방치 상한이 지나도 그대로 · 끊긴 뒤에도 그 임대로 닫으면 표에서 빠진다(화면이 닫을 때 보낸다) ──
        let o3 = open(&stream, id, pw).await;
        assert!(!o3.reattached, "끊긴 연결에는 다시 붙지 않는다");
        table::set_write(o3.handle, o3.lease, true).await.unwrap();
        table::set_tx_clock_for_test(Some((Duration::from_millis(1500), Duration::from_millis(500))));
        let id7 = begin(&o3).await;
        q(&o3, "INSERT INTO txs1_t VALUES (8, 80)", id7).await.unwrap();
        a.batch_execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'Aynx'").await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let v = view(&o3);
        assert_eq!((v["state"].as_str(), v["ended"]["outcome"].as_str()), (Some("disconnected"), Some("disconnected")), "{v}");
        tokio::time::sleep(Duration::from_millis(1800)).await;
        let v = view(&o3);
        assert_eq!(v["ended"]["outcome"].as_str(), Some("disconnected"), "방치 시계가 죽은 연결을 되돌림으로 적지 않는다: {v}");
        table::set_tx_clock_for_test(None);
        assert_eq!(pg_count(a, "SELECT count(*) FROM txs1_t").await, 2);
        assert!(table::close(o3.handle, Some(o3.lease)).unwrap(), "끊긴 연결도 그 임대로 닫힌다");
        let m = table::tx_state(o3.handle, o3.lease).unwrap_err();
        assert!(m.contains("[session-gone]"), "표에서 빠졌다: {m}");
    }
    table::close(o2.handle, None).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL (+ AYNX_TEST_PG_POOLER)"]
async fn pg_transaction_work() {
    let Some(url) = env("AYNX_TEST_PG_URL") else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let cfg = tokio_postgres::Config::from_str(&url).unwrap();
    let pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let port = cfg.get_ports()[0];
    let pooler = env("AYNX_TEST_PG_POOLER").and_then(|v| v.rsplit_once(':').map(|(h, p)| (h.to_string(), p.parse::<u16>().unwrap())));
    let mut rows = vec![("Test1_pg-direct", DbEngine::Postgres, "127.0.0.1", port, Some("postgres"), "postgres")];
    if let Some((h, p)) = &pooler {
        rows.push(("Test1_pg-pooler", DbEngine::Postgres, h.as_str(), *p, Some("postgres"), "postgres"));
    }
    let file = write_conns("pg", &rows);
    let a = pg_admin(&url).await;
    pg_suite(&a, "Test1_pg-direct", &pw, "direct").await;
    if pooler.is_some() {
        pg_suite(&a, "Test1_pg-pooler", &pw, "pooler").await;
    }
    a.batch_execute("DROP TABLE IF EXISTS txs1_t; DROP TABLE IF EXISTS txs1_made").await.unwrap();
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

// ---------------------------------------------------------------------------
// MySQL · MariaDB
// ---------------------------------------------------------------------------

pub(super) async fn my_count(a: &mut mysql_async::Conn, sql: &str) -> i64 {
    a.query_first::<i64, _>(sql).await.unwrap().unwrap()
}

async fn my_suite(url: &str, id: &str, label: &str) {
    let opts = mysql_async::Opts::from_url(url).unwrap();
    let pw = opts.pass().unwrap_or_default().to_string();
    let port = opts.tcp_port();
    let file = write_conns(label, &[(id, DbEngine::Mysql, "127.0.0.1", port, Some("txs1"), "root")]);
    let mut a = mysql_async::Conn::new(opts.clone()).await.expect("관리 연결");
    a.query_drop(
        "DROP DATABASE IF EXISTS txs1; CREATE DATABASE txs1; \
         CREATE TABLE txs1.t(id INT PRIMARY KEY, v INT) ENGINE=InnoDB; \
         INSERT INTO txs1.t VALUES (1, 1), (2, 2), (3, 3)",
    )
    .await
    .unwrap();
    let stream = format!("txs1-{label}");
    let o = open(&stream, id, &pw).await;
    table::set_write(o.handle, o.lease, true).await.unwrap();

    // ── 시작 → 같은 연결에서 보임 · 다른 연결엔 안 보임 → 메타가 작업 안에서 돌고 깨지 않음 → 커밋 ──
    let id1 = begin(&o).await;
    q(&o, "INSERT INTO t VALUES (10, 10)", id1).await.unwrap();
    assert_eq!(q(&o, "SELECT COUNT(*) FROM t", id1).await.unwrap().rows, vec![vec![json!(4)]]);
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 3, "다른 연결엔 안 보인다");
    table::schema(o.handle, o.lease).await.unwrap();
    let objs = table::objects(o.handle, o.lease, None).await.unwrap();
    assert!(objs.to_string().contains("\"t\""), "{objs}");
    table::table_detail(o.handle, o.lease, None, "t".into()).await.unwrap();
    let d = table::definition(o.handle, o.lease, def("table", "t")).await.unwrap();
    assert!(d["sql"].as_str().unwrap().contains("CREATE TABLE"), "{d}");
    assert!(table::table_detail(o.handle, o.lease, None, "nope_zz".into()).await.is_err());
    assert_eq!(view(&o)["state"], "open", "메타(세션 SET · 조회)는 암묵 커밋하지 않는다");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 3, "메타 뒤에도 커밋되지 않았다");
    // DDL(암묵 커밋)은 작업 중 거절 · 임시 테이블은 받는다 — 작업은 그대로.
    let m = q(&o, "CREATE TABLE t2(a int)", id1).await.unwrap_err();
    assert!(m.contains("DDL"), "{m}");
    // 임시 테이블은 되돌려지지 않아 작업 안에서 거절한다(Codex 검토 반영 1) · CALL 도(경계를 증명할 수 없다) — 작업은 그대로.
    let m = q(&o, "CREATE TEMPORARY TABLE tmp1(a int)", id1).await.unwrap_err();
    assert!(m.contains("TEMPORARY"), "{m}");
    let m = q(&o, "CALL nope_p()", id1).await.unwrap_err();
    assert!(m.contains("CALL"), "{m}");
    assert_eq!(view(&o)["state"], "open", "거절은 작업을 건드리지 않는다");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 3);
    // 문장만 실패(1062 중복) → 작업은 계속(엔진 상태 플래그).
    let m = q(&o, "INSERT INTO t VALUES (1, 0)", id1).await.unwrap_err();
    assert!(m.contains("1062"), "{m}");
    let v = view(&o);
    assert_eq!((v["state"].as_str(), v["statements"].as_u64()), (Some("open"), Some(2)), "{v}");
    // 잠금 대기 초과(1205) — 문장만 되감기(innodb_rollback_on_timeout 기본 OFF) → 작업은 계속.
    q(&o, "SET SESSION innodb_lock_wait_timeout = 1", id1).await.unwrap();
    let mut b = mysql_async::Conn::new(opts.clone()).await.unwrap();
    b.query_drop("START TRANSACTION; UPDATE txs1.t SET v = 99 WHERE id = 2").await.unwrap();
    let m = q(&o, "UPDATE t SET v = 0 WHERE id = 2", id1).await.unwrap_err();
    assert!(m.contains("1205"), "{m}");
    assert_eq!(view(&o)["state"], "open", "1205 는 문장만 되감는다");
    b.query_drop("ROLLBACK").await.unwrap();
    // 실행 B(3문장 중 2번째 오류 1062) — 세이브포인트로 B 전체만 되돌림(20 도 사라진다) · 작업은 산다(10-14 결정).
    let s = table::script(o.handle, o.lease, "INSERT INTO t VALUES (20, 20); INSERT INTO t VALUES (1, 0); INSERT INTO t VALUES (21, 21)".into(), "s".into(), 100, 5_000, Some(id1))
        .await
        .unwrap();
    assert_eq!((s.outcome, s.reason, s.failed.as_ref().map(|f| f.index)), ("workUndone", Some("error"), Some(1)), "{s:?}");
    assert_eq!(view(&o)["state"], "open");
    assert_eq!(q(&o, "SELECT COUNT(*) FROM t WHERE id IN (20, 21)", id1).await.unwrap().rows, vec![vec![json!(0)]]);
    let done = serde_json::to_value(table::tx_end(o.handle, o.lease, id1, true).await.unwrap()).unwrap();
    assert_eq!(done["ended"]["outcome"], "committed", "{done}");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 4, "커밋 — 실패한 문장 앞의 것은 남았다");
    // 작업 밖 자동 커밋 쓰기 모드에서는 DDL 을 지금처럼 받는다.
    q(&o, "CREATE TABLE t3(a int)", 0).await.unwrap();

    // ── 교착(1213) — InnoDB 가 우리 트랜잭션 전체를 되감으면 "오류로 되돌려짐" ──
    let id2 = begin(&o).await;
    q(&o, "UPDATE t SET v = 100 WHERE id = 1", id2).await.unwrap();
    // 상대는 무겁게(많은 행을 바꿔) — InnoDB 는 가벼운 쪽을 희생자로 고른다.
    // (INSERT … SELECT 는 우리가 잠근 행에 공유 잠금을 청해 먼저 막힌다 — 값을 늘어놓는다.)
    let many: Vec<String> = (2000..2060).map(|i| format!("({i}, 0)")).collect();
    b.query_drop(format!("START TRANSACTION; INSERT INTO txs1.t VALUES {}; UPDATE txs1.t SET v = 7 WHERE id = 3", many.join(", ")))
        .await
        .unwrap();
    let blocker = tokio::spawn(async move {
        let r = b.query_drop("UPDATE txs1.t SET v = 8 WHERE id = 1").await;
        let _ = b.query_drop("ROLLBACK").await;
        r.is_ok()
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let r = q(&o, "UPDATE t SET v = 9 WHERE id = 3", id2).await;
    let v = view(&o);
    match r {
        Err(m) if m.contains("1213") => {
            assert_eq!((v["state"].as_str(), v["ended"]["outcome"].as_str()), (Some("errorRolledBack"), Some("errorRolledBack")), "{v}");
            assert!(m.contains("되돌") || m.contains("rolled back"), "{m}");
            eprintln!("MEASURE {label} 교착 1213 → 우리 쪽 희생 · 오류로 되돌려짐");
        }
        other => {
            // 상대가 희생자였다 — 우리 작업은 산다.
            eprintln!("MEASURE {label} 교착 상대가 희생 · 우리 = {other:?} · 상태 {}", v["state"]);
            assert_eq!(v["state"], "open");
            table::tx_end(o.handle, o.lease, id2, false).await.unwrap();
        }
    }
    let _ = blocker.await;
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t WHERE v = 100").await, 0);

    // ── 자동 커밋 끔(10-14) — 조회는 트랜잭션을 남기지 않는다(innodb_trx 0 · 메타데이터 잠금 없음) · 바꾸는 문장은 작업을 연다 · DDL 은 안내 ──
    assert!(!table::set_auto_commit(o.handle, o.lease, false).unwrap());
    let r = q(&o, "SELECT COUNT(*) FROM t", 0).await.unwrap();
    // 앞 교착이 남긴 상태(`errorRolledBack` — 다음 작업까지 남는다)일 수 있다 — 열린 작업이 없다는 것만 본다.
    assert!(tx_of(&r)["id"] == 0 && tx_of(&r)["state"] != "open", "{}", tx_of(&r));
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM information_schema.innodb_trx").await, 0, "{label}: 조회 뒤 열린 트랜잭션 없음");
    let m = q(&o, "CREATE TABLE t4(a int)", 0).await.unwrap_err();
    assert!(m.contains("'자동 커밋'") || m.contains("'Auto-commit'"), "{m}");
    assert_eq!(view(&o)["id"], 0, "DDL 거절은 작업을 열지 않는다");
    let r = q(&o, "UPDATE t SET v = 55 WHERE id = 1", 0).await.unwrap();
    assert_eq!(tx_of(&r)["state"], "open");
    let ida = tx_of(&r)["id"].as_u64().unwrap();
    // INFORMATION_SCHEMA 의 InnoDB 트랜잭션 표는 100ms 캐시라 잠깐 기다린다.
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert!(my_count(&mut a, "SELECT COUNT(*) FROM information_schema.innodb_trx").await >= 1);
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t WHERE v = 55").await, 0, "커밋 전");
    table::tx_end(o.handle, o.lease, ida, false).await.unwrap();
    // 저절로 연 작업의 첫 실행이 실패(10-14 실기) — 빈 작업까지 닫힌다: "작업 유지" · "행 잠금이 남을 수 있음" 을 말하지 않는다.
    let m = q(&o, "INSERT INTO t VALUES (1, 1)", 0).await.unwrap_err();
    assert!(m.contains("열리지 않았습니다") || m.contains("no transaction was left open"), "{label}: {m}");
    assert!(!(m.contains("이번 실행만") || m.contains("Only this run") || m.contains("행 잠금") || m.contains("row locks")), "{label}: {m}");
    assert_eq!(view(&o)["id"], 0, "{label}: 빈 작업은 닫힌다");
    let s = table::script(o.handle, o.lease, "UPDATE t SET v = 88 WHERE id = 1; INSERT INTO t VALUES (1, 1); UPDATE t SET v = 77 WHERE id = 2".into(), "s".into(), 100, 5_000, Some(0))
        .await
        .unwrap();
    assert_eq!((s.outcome, s.reason, s.work_closed, s.failed.as_ref().map(|f| f.index)), ("rolledBack", Some("error"), true, Some(1)), "{label}: {s:?}");
    let note = s.message.clone().unwrap_or_default();
    assert!(!(note.contains("행 잠금") || note.contains("row locks")), "{label}: {s:?}");
    assert_eq!(view(&o)["id"], 0, "{label}: 빈 작업은 닫힌다");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t WHERE v IN (88, 77)").await, 0);
    assert!(table::set_auto_commit(o.handle, o.lease, true).unwrap());

    // ── 되돌리기 · 쓰기 끄기 = 되돌림 ──
    let id3 = begin(&o).await;
    q(&o, "DELETE FROM t", id3).await.unwrap();
    table::tx_end(o.handle, o.lease, id3, false).await.unwrap();
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 4);
    let id4 = begin(&o).await;
    q(&o, "DELETE FROM t", id4).await.unwrap();
    table::set_write(o.handle, o.lease, false).await.unwrap();
    assert_eq!(view(&o)["ended"]["outcome"], "rolledBack");
    assert_eq!(my_count(&mut a, "SELECT COUNT(*) FROM txs1.t").await, 4);

    table::close(o.handle, None).unwrap();
    a.query_drop("DROP DATABASE IF EXISTS txs1").await.unwrap();
    let _ = a.disconnect().await;
    conns::set_path_override(None);
    let _ = std::fs::remove_dir_all(file.parent().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL 8.4"]
async fn mysql_transaction_work() {
    let Some(url) = env("AYNX_TEST_MY_URL") else {
        eprintln!("AYNX_TEST_MY_URL 없음 — 건너뜀");
        return;
    };
    my_suite(&url, "Test1_my-direct", "mysql").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB 11"]
async fn mariadb_transaction_work() {
    let Some(url) = env("AYNX_TEST_MARIA_URL") else {
        eprintln!("AYNX_TEST_MARIA_URL 없음 — 건너뜀");
        return;
    };
    my_suite(&url, "Test1_maria-dir", "maria").await;
}
