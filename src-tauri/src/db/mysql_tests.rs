//! **MySQL · MariaDB 통합 시험**(쿼리 타일 8단계) — 실제 서버 · 임시 sshd 가 있을 때만 돈다(`#[ignore]` + 환경변수). 사용자의
//! `~/.ssh/config`·`sessions.toml`·볼트는 건드리지 않는다(경유는 그 자리 대상 `AdhocTarget` · 비밀번호는 몸으로만).
//!
//! ```text
//! AYNX_TEST_MY_URL=mysql://root:<pw>@127.0.0.1:53306/          # MySQL 8.4 직결(root — 준비·읽기 전용 실측)
//! AYNX_TEST_MARIA_URL=mysql://root:<pw>@127.0.0.1:53307/       # MariaDB 11 직결
//! AYNX_TEST_MY_SSH=<user>:<pw>@127.0.0.1:2222                  # 임시 sshd(비밀번호 인증)
//! AYNX_TEST_MY_SSH_TARGET=mysql:3306                           # sshd 에서 본 MySQL 주소(같은 root 비밀번호)
//! AYNX_TEST_MY_SSH_CONTAINER=<sshd 컨테이너 이름>               # 전송로 사망 시험(docker restart)
//! cargo test --lib db::mysql_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! `MEASURE` 로 시작하는 줄은 실측 기록이다(docs/log 에 옮긴다). 긴 쿼리는 `SLEEP`/`BENCHMARK` 를 쓰지 않는다 — 끊겨도 오류 없이
//! 값을 돌려준다(스파이크 함정 4). 대신 큰 교차 조인을 센다.

use std::sync::Arc;
use std::time::{Duration, Instant};

use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::mysql::Mysql;
use super::net::{NetTarget, OpenError, OpenSecrets};
use super::{EngineError, QueryOut};
use crate::db::conns::DbTlsMode;
use crate::ssh::open::SharedCreds;
use crate::ssh::{AdhocTarget, HostKeyDecision, SshOpenError};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn opts(var: &str) -> Option<Opts> {
    Opts::from_url(&env(var)?).ok()
}

fn direct_target(o: &Opts, user: &str, db: Option<&str>) -> NetTarget {
    NetTarget {
        id: "Test8_my-direct".into(),
        host: o.ip_or_hostname().to_string(),
        port: o.tcp_port(),
        database: db.map(str::to_string),
        user: Some(user.into()),
        // 평문 — 아래 "TLS 없이 RSA 공개키 교환" 실측을 지킨다(TLS 는 db/tls_tests.rs).
        tls: DbTlsMode::Disable,
        tls_ca: None,
        via: None,
        adhoc: None,
    }
}

fn secrets(pw: Option<&str>) -> OpenSecrets {
    OpenSecrets {
        password: pw.map(|p| Zeroizing::new(p.to_string())),
        ssh: SharedCreds::default(),
    }
}

fn open_msg(r: Result<Mysql, OpenError>) -> String {
    match r {
        Ok(_) => "OK".into(),
        Err(OpenError::Msg(m)) => m,
        Err(OpenError::Ssh(e)) => format!("ssh {e:?}"),
    }
}

fn emsg(e: &EngineError) -> String {
    match e {
        EngineError::Interrupted => "Interrupted".into(),
        EngineError::Busy => "Busy".into(),
        EngineError::Message(m) | EngineError::ReadOnlyRefused(m) | EngineError::Unconfirmed(m) => m.clone(),
    }
}

fn one_line(s: &str) -> String {
    s.replace('\n', " / ")
}

fn cell(out: &QueryOut, row: usize, col: usize) -> Value {
    out.rows[row][col].clone()
}

fn show(r: &Result<QueryOut, EngineError>) -> String {
    match r {
        Ok(o) => format!(
            "OK rows={} {}",
            o.rows.len(),
            o.rows.first().map(|r| json!(r).to_string()).unwrap_or_else(|| format!("affected={:?}", o.affected))
        ),
        Err(e) => format!("ERR {}", one_line(&emsg(e))),
    }
}

async fn admin(o: &Opts) -> Conn {
    Conn::new(o.clone()).await.expect("관리 연결")
}

/// 긴 SELECT — 백만 행 표 × 천 행 교차 조인을 더한다(`COUNT(*)` 는 최적화로 곧바로 끝난다)(SLEEP·BENCHMARK 는 끊겨도 값을 돌려주므로 쓰지 않는다).
const HEAVY: &str = "SELECT SUM(a.n + b.d * c.d - d.d) FROM pt8.pt_big a, pt8.pt_d b, pt8.pt_d c, pt8.pt_d d";

async fn prepare(a: &mut Conn) {
    a.query_drop(
        "DROP DATABASE IF EXISTS pt8; CREATE DATABASE pt8;
         CREATE TABLE pt8.pt_t(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL DEFAULT 'x', v DECIMAL(10,2));
         INSERT INTO pt8.pt_t(name, v) VALUES ('a', 1.50), ('b', NULL), ('c', 3);
         CREATE VIEW pt8.pt_v AS SELECT id FROM pt8.pt_t;
         CREATE TABLE pt8.pt_d(d INT);
         INSERT INTO pt8.pt_d VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);
         CREATE TABLE pt8.pt_big(n INT);
         INSERT INTO pt8.pt_big SELECT a.d + 10*b.d + 100*c.d + 1000*d.d + 10000*e.d + 100000*f.d
           FROM pt8.pt_d a, pt8.pt_d b, pt8.pt_d c, pt8.pt_d d, pt8.pt_d e, pt8.pt_d f;
         CREATE TABLE pt8.pt_sink(n INT);
         CREATE TABLE pt8.pt_types(y YEAR, b BIT(5), e ENUM('red','blue'), s SET('a','b'), dt DATETIME(3), ts TIMESTAMP(6) NULL,
           bl BLOB, tx TEXT, bi BINARY(2), u TINYINT UNSIGNED, big BIGINT UNSIGNED, z DATE, t TIME, f FLOAT, g GEOMETRY);
         INSERT INTO pt8.pt_types VALUES (2024, b'10110', 'blue', 'a,b', '2024-02-29 13:45:01.5', '2024-01-01 00:00:00.000001',
           X'DEAD', '한글', X'0102', 255, 18446744073709551615, '2024-02-29', '-838:59:59', 0.1, ST_GeomFromText('POINT(1 1)'));
         CREATE PROCEDURE pt8.pt_proc() SELECT 1;
         CREATE PROCEDURE pt8.pt_proc2(IN a INT, OUT b VARCHAR(10)) SET b = 'x';
         CREATE FUNCTION pt8.pt_fn(a INT, b INT) RETURNS INT DETERMINISTIC RETURN a + b;
         CREATE TRIGGER pt8.pt_trg BEFORE INSERT ON pt8.pt_sink FOR EACH ROW SET NEW.n = NEW.n;
         DROP USER IF EXISTS 'pt_reader'@'%';
         CREATE USER 'pt_reader'@'%' IDENTIFIED BY 'readerpw';
         GRANT SELECT ON pt8.* TO 'pt_reader'@'%';",
    )
    .await
    .expect("준비");
}

/// 직결 한 벌 — 비밀번호 관문 · 값 매핑 · 행 상한(함정 3 회귀) · 시간 제한(SELECT · 비SELECT) · 취소 · 한 번에 하나 · 읽기 전용
/// 실측(root · 읽기 전용 계정) · 스키마 · 서버가 끊음.
async fn direct(var: &str, want_mariadb: bool) {
    let Some(o) = opts(var) else {
        eprintln!("{var} 없음 — 건너뜀");
        return;
    };
    let tag = if want_mariadb { "mariadb" } else { "mysql" };
    let su = o.user().unwrap().to_string();
    let su_pw = o.pass().unwrap().to_string();
    let mut a = admin(&o).await;
    prepare(&mut a).await;

    // ── 비밀번호 관문 ──
    let t = direct_target(&o, &su, Some("pt8"));
    let m = open_msg(Mysql::connect("my-1", t.clone(), secrets(None)).await);
    assert!(m.contains("[db-password]"), "{m}");
    let m = open_msg(Mysql::connect("my-1", t.clone(), secrets(Some("wrong"))).await);
    assert!(m.contains("[db-auth]") && !m.contains("[db-stored-rejected]") && !m.contains("wrong"), "{m}");
    println!("MEASURE[{tag}] auth-wrong: {}", one_line(&m));
    let my = Mysql::connect("my-1", t.clone(), secrets(Some(&su_pw))).await.unwrap_or_else(|e| panic!("{}", open_msg(Err(e))));
    println!("MEASURE[{tag}] version: {}", my.server_version());
    assert_eq!(my.server_version().starts_with("MariaDB"), want_mariadb, "{}", my.server_version());
    // 읽기 전용 계정 — MySQL 8 은 caching_sha2_password 새 사용자(캐시 없음) = TLS 없이 RSA 공개키 교환 경로.
    let reader = Mysql::connect("my-2", direct_target(&o, "pt_reader", Some("pt8")), secrets(Some("readerpw")))
        .await
        .unwrap_or_else(|e| panic!("reader: {}", open_msg(Err(e))));
    if !want_mariadb {
        let plugin: Option<String> = a.query_first("SELECT plugin FROM mysql.user WHERE user = 'pt_reader'").await.unwrap();
        println!("MEASURE[{tag}] reader plugin: {plugin:?} (TLS 없음)");
    }

    // ── 값 매핑 — 기대 JSON ──
    let cases: &[(&str, Value)] = &[
        ("CAST(1 AS SIGNED)", json!(1)),
        ("-7", json!(-7)),
        ("9007199254740993", json!("9007199254740993")),
        ("CAST(18446744073709551615 AS UNSIGNED)", json!("18446744073709551615")),
        ("1.5e0", json!(1.5)),
        ("CAST(12345678901234567890.12345 AS DECIMAL(30,5))", json!("12345678901234567890.12345")),
        ("0.10", json!("0.10")),
        ("'한글'", json!("한글")),
        ("X'DEAD'", json!({ "$bytes": 2, "hex": "dead" })),
        ("NULL", Value::Null),
        ("DATE '2024-02-29'", json!("2024-02-29")),
        ("CAST('838:59:59' AS TIME)", json!("838:59:59")),
        ("CAST('-01:02:03.25' AS TIME(2))", json!("-01:02:03.25")),
        ("CAST('2024-02-29 13:45:01.5' AS DATETIME(1))", json!("2024-02-29 13:45:01.5")),
        ("ST_GeomFromText('POINT(1 1)')", json!("‹geometry›")),
    ];
    for (expr, want) in cases {
        let r = my.query(&format!("SELECT {expr}"), 10, 5000).await.unwrap_or_else(|e| panic!("{expr}: {}", emsg(&e)));
        println!("MEASURE[{tag}] value {expr} → {} ({})", cell(&r, 0, 0), r.columns[0].ty);
        assert_eq!(&cell(&r, 0, 0), want, "{expr} (형 {})", r.columns[0].ty);
    }
    let r = my.query("SELECT * FROM pt_types", 10, 5000).await.unwrap();
    let got: Vec<(String, Value)> = r.columns.iter().zip(&r.rows[0]).map(|(c, v)| (format!("{}:{}", c.name, c.ty), v.clone())).collect();
    println!("MEASURE[{tag}] types {}", json!(got));
    let want = [
        json!(2024),
        json!("10110"),
        json!("blue"),
        json!("a,b"),
        json!("2024-02-29 13:45:01.500"),
        json!("2024-01-01 00:00:00.000001"),
        json!({ "$bytes": 2, "hex": "dead" }),
        json!("한글"),
        json!({ "$bytes": 2, "hex": "0102" }),
        json!(255),
        json!("18446744073709551615"),
        json!("2024-02-29"),
        json!("-838:59:59"),
        json!(0.1),
        json!("‹geometry›"),
    ];
    for (i, w) in want.iter().enumerate() {
        assert_eq!(&r.rows[0][i], w, "{}", got[i].0);
    }
    // JSON — MySQL 은 JSON 형(문자셋 binary 로 온다), MariaDB 는 글자. 서버 글자 출력과 같다.
    let r = my.query("SELECT JSON_OBJECT('a', 1)", 10, 5000).await.unwrap();
    let server: Option<String> = a.query_first("SELECT JSON_OBJECT('a', 1)").await.unwrap();
    println!("MEASURE[{tag}] json → {} ({})", cell(&r, 0, 0), r.columns[0].ty);
    assert_eq!(cell(&r, 0, 0), json!(server.unwrap()));
    // 날짜·시간 — 서버 글자 출력과 대조(글자 프로토콜).
    for expr in ["NOW(6)", "CURDATE()", "CAST('2024-02-29 13:45:01' AS DATETIME)", "TIMESTAMP '2000-01-01 00:00:00.123'", "SEC_TO_TIME(-3723.5)"] {
        let r = my.query(&format!("SELECT {expr}"), 10, 5000).await.unwrap();
        let server: Option<String> = a.query_first(format!("SELECT {expr}")).await.unwrap();
        if expr.starts_with("NOW") || expr.starts_with("CURDATE") {
            assert_eq!(cell(&r, 0, 0).as_str().map(str::len), server.as_deref().map(str::len), "{expr}");
        } else {
            assert_eq!(cell(&r, 0, 0), json!(server.unwrap()), "{expr}");
        }
    }

    // ── 행 상한 — 서버 쪽(sql_select_limit). 함정 3: 버린 나머지를 다음 질의가 비우지 않는다 ──
    let started = Instant::now();
    let r = my.query("SELECT n FROM pt_big", 100, 30_000).await.unwrap();
    let first_ms = started.elapsed().as_millis();
    assert_eq!((r.rows.len(), r.truncated, r.affected), (100, true, None));
    let started = Instant::now();
    assert_eq!(cell(&my.query("SELECT 1", 10, 5000).await.unwrap(), 0, 0), json!(1));
    let next_ms = started.elapsed().as_millis();
    println!("MEASURE[{tag}] limit 1M→100: {first_ms} ms · 다음 SELECT 1: {next_ms} ms");
    assert!(next_ms < 300, "상한 뒤 다음 질의가 늦다 — 나머지 행을 비우고 있다 ({next_ms} ms)");
    let r = my.query("SELECT n FROM pt_big WHERE n < 5000", 5000, 30_000).await.unwrap();
    assert_eq!((r.rows.len(), r.truncated), (5000, false));
    // 상한은 끝나면 DEFAULT 로 — 메타 조회(최상위 SELECT)가 잘리지 않는다.
    let c = my.table_detail(None, "pt_types", 5000).await.unwrap();
    assert_eq!(c["columns"].as_array().unwrap().len(), 15);
    let r = my.query("SELECT @@SESSION.sql_select_limit = 2", 1, 5000).await.unwrap();
    assert_eq!(cell(&r, 0, 0), json!(1), "문장 동안은 상한+1");

    // ── 시간 제한 — SELECT 는 서버(MySQL max_execution_time · MariaDB max_statement_time) ──
    let started = Instant::now();
    let e = my.query(HEAVY, 10, 500).await.unwrap_err();
    let ms = started.elapsed().as_millis();
    println!("MEASURE[{tag}] select-timeout 500ms: {} ({ms} ms)", emsg(&e));
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(ms < 3000);
    assert_eq!(cell(&my.query("SELECT 2", 10, 5000).await.unwrap(), 0, 0), json!(2), "시간 초과 뒤 재사용");

    // ── 취소(제어 연결 KILL QUERY) · 한 번에 하나 · 취소 뒤 재사용 ──
    let my = Arc::new(my);
    let m2 = Arc::clone(&my);
    let started = Instant::now();
    let h = tokio::spawn(async move { m2.query(HEAVY, 10, 60_000).await });
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(matches!(my.query("SELECT 1", 10, 1000).await, Err(EngineError::Busy)));
    my.interrupt();
    let e = h.await.unwrap().unwrap_err();
    let ms = started.elapsed().as_millis();
    println!("MEASURE[{tag}] cancel-direct: {} ({ms} ms)", emsg(&e));
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(ms < 3000);
    assert_eq!(cell(&my.query("SELECT 41 + 1", 10, 1000).await.unwrap(), 0, 0), json!(42), "취소 뒤 연결 재사용");
    // 아무것도 안 돌 때의 KILL QUERY 는 다음 문장을 해치지 않는다.
    my.interrupt();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(cell(&my.query("SELECT 43", 10, 1000).await.unwrap(), 0, 0), json!(43), "빈 KILL 뒤");

    // ── 비SELECT 시간 제한 — 쓰기 모드의 큰 INSERT … SELECT(MySQL = 앱 타이머 KILL · MariaDB = max_statement_time) ──
    my.set_write(true).await.unwrap();
    let started = Instant::now();
    let e = my.query("INSERT INTO pt_sink SELECT a.n FROM pt_big a, pt_d b, pt_d c", 10, 700).await.unwrap_err();
    let ms = started.elapsed().as_millis();
    println!("MEASURE[{tag}] insert-select-timeout 700ms: {} ({ms} ms)", emsg(&e));
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(ms < 3000, "{ms}");
    let n: Option<i64> = a.query_first("SELECT COUNT(*) FROM pt8.pt_sink").await.unwrap();
    println!("MEASURE[{tag}] pt_sink after killed insert: {n:?}");
    assert_eq!(n, Some(0), "끊긴 INSERT 는 되돌려진다");
    let r = my.query("INSERT INTO pt_t(name) VALUES ('w')", 10, 5000).await.unwrap();
    assert_eq!(r.affected, Some(1));
    my.query("DELETE FROM pt_t WHERE name = 'w'", 10, 5000).await.unwrap();
    // 쓰기 모드도 사람의 트랜잭션 · autocommit 끄기 · 세션 잠금은 가드가 거절한다(10-13 결정 0단계) — 거절 뒤 연결은 트랜잭션 밖
    // (IN_TRANS = 0 · AUTOCOMMIT = 1)이고 다음 쓰기는 바로 커밋된다.
    for sql in [
        "BEGIN",
        "START TRANSACTION",
        "SET autocommit = 0",
        "SET @@session.autocommit = 0",
        "SET @x = 1, `autocommit` = 0",
        "XA START 'pt8'",
        "LOCK TABLES pt_t WRITE",
        "FLUSH TABLES pt_t WITH READ LOCK",
    ] {
        let e = my.query(sql, 10, 5000).await.unwrap_err();
        println!("MEASURE[{tag}] write-mode refuse {sql}: {}", one_line(&emsg(&e)));
        assert!(emsg(&e).contains("MariaDB"), "{sql}: {}", emsg(&e));
        assert_eq!(my.tx_flags().await, (false, true), "{sql} 뒤 트랜잭션 밖 · 자동 커밋");
    }
    my.query("INSERT INTO pt_t(name) VALUES ('tx')", 10, 5000).await.unwrap();
    assert_eq!(my.tx_flags().await, (false, true), "INSERT 뒤에도 트랜잭션 밖");
    let n: Option<i64> = a.query_first("SELECT COUNT(*) FROM pt8.pt_t WHERE name = 'tx'").await.unwrap();
    assert_eq!(n, Some(1), "다른 연결에서 바로 보인다(커밋됨)");
    my.query("DELETE FROM pt_t WHERE name = 'tx'", 10, 5000).await.unwrap();
    // 가드가 글자를 못 보는 동적 SQL(`PREPARE … FROM` · MariaDB `EXECUTE IMMEDIATE`)은 엔진의 바이너리 프로토콜(prepare)이 막는다
    // (10-13 실측: MySQL 8.4 · MariaDB 11 모두 1295 — MySQL 의 `EXECUTE IMMEDIATE` 는 1064).
    for sql in ["PREPARE pt8s FROM 'SET autocommit = 0'", "EXECUTE pt8s", "EXECUTE IMMEDIATE 'SET autocommit = 0'"] {
        let r = my.query(sql, 10, 5000).await;
        println!("MEASURE[{tag}] dynamic {sql}: {}", show(&r));
        assert!(r.is_err(), "{sql}");
        assert_eq!(my.tx_flags().await, (false, true), "{sql}");
    }
    // 프로시저 안의 autocommit 끄기는 가드가 못 본다(가드 머리말 "못 보는 것") — 쓰기 끄기가 되감고 자동 커밋으로 되돌린다
    // (다음 READ ONLY 시작이 암묵 커밋하지 않게 · 다시 켠 쓰기가 몰래 커밋 대기에 남지 않게).
    a.query_drop("DROP PROCEDURE IF EXISTS pt8.pt_ac_off; CREATE PROCEDURE pt8.pt_ac_off() SET autocommit = 0").await.unwrap();
    my.query("CALL pt_ac_off()", 10, 5000).await.unwrap();
    my.query("INSERT INTO pt_t(name) VALUES ('tx')", 10, 5000).await.unwrap();
    println!("MEASURE[{tag}] after CALL autocommit-off + INSERT: flags {:?}", my.tx_flags().await);
    assert_eq!(my.tx_flags().await, (true, false), "CALL 안의 SET 은 가드 밖 — 트랜잭션이 선다");
    my.set_write(false).await.unwrap();
    assert_eq!(cell(&my.query("SELECT COUNT(*) FROM pt_t WHERE name = 'tx'", 10, 5000).await.unwrap(), 0, 0), json!(0), "끄면 되감김");
    let n: Option<i64> = a.query_first("SELECT COUNT(*) FROM pt8.pt_t WHERE name = 'tx'").await.unwrap();
    assert_eq!(n, Some(0), "다른 연결에서도 없음");
    assert!(my.query("INSERT INTO pt_t(name) VALUES ('x')", 10, 5000).await.is_err());
    my.set_write(true).await.unwrap();
    my.query("INSERT INTO pt_t(name) VALUES ('ac')", 10, 5000).await.unwrap();
    let n: Option<i64> = a.query_first("SELECT COUNT(*) FROM pt8.pt_t WHERE name = 'ac'").await.unwrap();
    assert_eq!(n, Some(1), "다시 켠 쓰기는 자동 커밋");
    my.query("DELETE FROM pt_t WHERE name = 'ac'", 10, 5000).await.unwrap();
    my.set_write(false).await.unwrap();

    // ── 읽기 전용 실측 — 가드(guarded) · 엔진 겹만(unguarded) · root / 읽기 전용 계정 ──
    let probes: &[&str] = &[
        "SELECT 1; INSERT INTO pt_t(name) VALUES ('evil')",
        "INSERT INTO pt_t(name) VALUES ('evil')",
        "UPDATE pt_t SET name = 'evil'",
        "DELETE FROM pt_t",
        "CREATE TABLE pt_evil(x INT)",
        "DROP VIEW pt_v",
        "SET SESSION TRANSACTION READ WRITE",
        "SELECT * FROM pt_t INTO OUTFILE '/tmp/pt8_out'",
        "SELECT * FROM pt_t INTO OUTFILE '/var/lib/mysql-files/pt8_out'",
        "SELECT 'x' INTO DUMPFILE '/tmp/pt8_dump'",
        "SELECT LOAD_FILE('/etc/passwd') IS NOT NULL",
        "SELECT GET_LOCK('pt8_lock', 1)",
        "SELECT SLEEP(0.1)",
        "SELECT @pt8_v := 5",
        "SELECT 7 INTO @pt8_w",
        "SELECT * FROM pt_t FOR UPDATE",
        "SELECT * FROM pt_t LOCK IN SHARE MODE",
        "DO 1",
        "CALL pt_proc()",
        "LOAD DATA LOCAL INFILE '/etc/hosts' INTO TABLE pt_t",
        "LOCK TABLES pt_t WRITE",
        "HANDLER pt_t OPEN",
        "SELECT /*! 1; DELETE FROM pt_t */",
        "TABLE pt_t",
        "VALUES ROW(1)",
        "SHOW TABLES",
        "DESCRIBE pt_t",
        "EXPLAIN SELECT * FROM pt_t",
        "WITH x AS (SELECT 1 AS one) SELECT * FROM x",
    ];
    for (who, p) in [("root", &*my), ("reader", &reader)] {
        for sql in probes {
            let g = p.query(sql, 5, 5000).await;
            let u = p.query_unguarded(sql, 5, 5000).await;
            println!("MEASURE[{tag}] ro[{who}] {sql}\n    guarded:   {}\n    unguarded: {}", show(&g), show(&u));
        }
        // 세션에 남는 것 — GET_LOCK 은 ROLLBACK 뒤에도 남는가 · 사용자 변수는 남는가.
        let held: Option<Option<u64>> = a.query_first("SELECT IS_USED_LOCK('pt8_lock')").await.unwrap();
        println!("MEASURE[{tag}] ro[{who}] GET_LOCK 뒤 IS_USED_LOCK: {held:?}");
        let r = p.query("SELECT @pt8_v, @pt8_w", 5, 5000).await;
        println!("MEASURE[{tag}] ro[{who}] 사용자 변수 뒤: {}", show(&r));
        let _ = p.query("SELECT RELEASE_ALL_LOCKS()", 5, 5000).await;
    }
    let n: Option<i64> = a.query_first("SELECT COUNT(*) FROM pt8.pt_t").await.unwrap();
    assert_eq!(n, Some(3), "읽기 전용 실측 뒤에도 표가 그대로");
    let views: Option<i64> = a.query_first("SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'pt8'").await.unwrap();
    assert_eq!(views, Some(1), "뷰가 그대로");
    // 반드시 막히는 것 — 다중 문장(가드 · prepare 둘 다) · INSERT(엔진 1792).
    let m = emsg(&my.query(probes[0], 5, 5000).await.unwrap_err());
    assert!(m.contains("문장 하나") || m.contains("one statement"), "{m}");
    let m = emsg(&my.query_unguarded(probes[0], 5, 5000).await.unwrap_err());
    assert!(m.contains("1064"), "prepare 가 다중 문장을 거절: {m}");
    for sql in [probes[1], probes[2], probes[3]] {
        let m = emsg(&my.query_unguarded(sql, 5, 5000).await.unwrap_err());
        assert!(m.contains("1792"), "{sql}: {m}");
    }
    assert!(my.query(probes[6], 5, 5000).await.is_err(), "SET 은 가드가 막는다");

    // ── 스키마 · 컬럼 ──
    let s = my.schema(5000).await.unwrap();
    assert_eq!(s["schemas"][0], json!({ "name": "pt8" }), "기본 데이터베이스가 맨 앞 · 이름만: {s}");
    for sys in ["\"mysql\"", "information_schema", "performance_schema", "\"sys\""] {
        assert!(!s.to_string().contains(sys), "{sys}: {s}");
    }
    // 스키마 트리 — 데이터베이스를 펼치면 종류별 객체(이름은 바인드 인자 · 없으면 기본 데이터베이스).
    if want_mariadb {
        a.query_drop("CREATE SEQUENCE pt8.pt_seq").await.unwrap();
    }
    let o = my.objects(Some("pt8"), 5000).await.unwrap();
    println!("MEASURE[{tag}] objects pt8: {o}");
    assert_eq!(my.objects(None, 5000).await.unwrap(), o, "기본 데이터베이스");
    // MariaDB 는 정수 형에 표시 폭을 붙인다(`int(11)`) — 견주기 전에 걷는다.
    let objs: Vec<Value> = serde_json::from_str(&o["objects"].to_string().replace("(11)", "")).unwrap();
    let has = |want: Value| assert!(objs.contains(&want), "{want}: {o}");
    for (n, k) in [("pt_t", "table"), ("pt_v", "view"), ("pt_big", "table")] {
        has(json!({ "name": n, "kind": k }));
    }
    has(json!({ "kind": "procedure", "name": "pt_proc", "args": "" }));
    has(json!({ "kind": "procedure", "name": "pt_proc2", "args": "IN a int, OUT b varchar(10)" }));
    has(json!({ "kind": "function", "name": "pt_fn", "args": "a int, b int", "returns": "int" }));
    assert!(!objs.iter().any(|x| x["kind"] == "trigger"), "트리거는 테이블 아래로 옮겼다: {o}");
    let sink = my.table_detail(None, "pt_sink", 5000).await.unwrap();
    assert_eq!(sink["triggers"][0]["name"], "pt_trg");
    assert_eq!(sink["triggers"][0]["detail"], "BEFORE INSERT");
    if want_mariadb {
        has(json!({ "kind": "sequence", "name": "pt_seq" }));
    }
    assert_eq!(o["truncated"], json!([]));
    for bad in ["nope", "pt8' OR '1'='1", "pt8`; DROP DATABASE pt8; --"] {
        assert_eq!(my.objects(Some(bad), 5000).await.unwrap()["objects"], json!([]), "{bad}");
    }
    let c = my.table_detail(None, "pt_t", 5000).await.unwrap();
    println!("MEASURE[{tag}] columns pt_t: {c}");
    assert_eq!(c["columns"][0]["name"], "id");
    assert_eq!(c["columns"][0]["pk"], 1);
    assert_eq!(c["columns"][0]["notNull"], true);
    assert!(c["columns"][0]["type"].as_str().unwrap().starts_with("int"));
    assert_eq!(c["columns"][1]["pk"], 0);
    assert!(c["columns"][1]["default"].as_str().unwrap().contains('x'));
    assert_eq!(c["columns"][2]["notNull"], false);
    assert!(emsg(&my.table_detail(Some("pt8"), "nope", 5000).await.unwrap_err()).contains("nope"));
    detail_folders(&mut a, &my, &reader, tag, want_mariadb).await;

    // ── 서버가 끊음(KILL CONNECTION) → [db-disconnected] ──
    let id = cell(&my.query("SELECT CONNECTION_ID()", 10, 5000).await.unwrap(), 0, 0).as_u64().unwrap();
    a.query_drop(format!("KILL {id}")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let m = emsg(&my.query("SELECT 1", 10, 1000).await.unwrap_err());
    println!("MEASURE[{tag}] killed-connection: {}", one_line(&m));
    assert!(m.contains("[db-disconnected]"), "{m}");
    assert!(my.is_dead());

    my.shutdown();
    reader.shutdown();
    // 연결을 놓아야 DROP 이 선다 — 실측의 `HANDLER … OPEN`(MariaDB 는 prepare 로도 선다)이 표의 메타데이터 잠금을 쥐고 있다.
    drop(my);
    drop(reader);
    tokio::time::sleep(Duration::from_millis(300)).await;
    a.query_drop("DROP DATABASE pt8; DROP USER 'pt_reader'@'%';").await.unwrap();
    let _ = a.disconnect().await;
}

/// 테이블 구조(10-13) — 인덱스(다중 열 · 앞 길이 · 함수 인덱스(MySQL) · 외래 키가 만든 것) · 제약(기본 키 · 유니크 · 체크) · 외래 키
/// (복합 · 자기 참조 · 다른 데이터베이스에서 오는 것) · 참조됨 · 트리거 — 따옴표 · 공백 든 이름. 읽기 전용 계정에도 같은 모양.
async fn detail_folders(a: &mut Conn, my: &Mysql, reader: &Mysql, tag: &str, want_mariadb: bool) {
    a.query_drop(
        "DROP DATABASE IF EXISTS pt8b;
         CREATE TABLE pt8.`cust omer`(id INT PRIMARY KEY, region VARCHAR(10) NOT NULL, code VARCHAR(10),
           UNIQUE KEY uq_rc (region, code), CONSTRAINT chk_code CHECK (code <> ''));
         CREATE TABLE pt8.`or``ders`(id INT, line INT, cust INT, region VARCHAR(10), code VARCHAR(10), parent_id INT, parent_line INT,
           note VARCHAR(100), qty INT,
           PRIMARY KEY (id, line), KEY idx_multi (cust, region), KEY idx_prefix (note(10)),
           CONSTRAINT `fk cust` FOREIGN KEY (cust) REFERENCES pt8.`cust omer`(id) ON DELETE CASCADE,
           CONSTRAINT fk_rc FOREIGN KEY (region, code) REFERENCES pt8.`cust omer`(region, code) ON UPDATE CASCADE,
           CONSTRAINT fk_self FOREIGN KEY (parent_id, parent_line) REFERENCES pt8.`or``ders`(id, line),
           CONSTRAINT qty_pos CHECK (qty > 0));
         CREATE TRIGGER pt8.`o trg` AFTER UPDATE ON pt8.`or``ders` FOR EACH ROW SET @x = 1;
         CREATE DATABASE pt8b;
         CREATE TABLE pt8b.ref_other(x INT, CONSTRAINT fk_other FOREIGN KEY (x) REFERENCES pt8.`cust omer`(id));",
    )
    .await
    .expect("구조 준비");
    if !want_mariadb {
        a.query_drop("CREATE INDEX idx_expr ON pt8.`or``ders`((lower(note)))").await.expect("함수 인덱스");
    }
    let d = my.table_detail(Some("pt8"), "or`ders", 5000).await.unwrap();
    println!("MEASURE[{tag}] detail or`ders: {d}");
    let idx = |n: &str| d["indexes"].as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or_else(|| panic!("{n}: {d}"));
    assert_eq!(d["indexes"][0]["name"], "PRIMARY", "기본 키가 맨 앞");
    assert_eq!(idx("PRIMARY")["columns"], json!(["id", "line"]));
    assert_eq!((idx("PRIMARY")["primary"].as_bool(), idx("PRIMARY")["unique"].as_bool()), (Some(true), Some(true)));
    assert_eq!(idx("idx_multi")["columns"], json!(["cust", "region"]));
    assert_eq!(idx("idx_multi")["method"], "BTREE");
    assert_eq!(idx("idx_prefix")["columns"], json!(["note(10)"]));
    assert_eq!(idx("fk_self")["columns"], json!(["parent_id", "parent_line"]), "외래 키가 만든 인덱스");
    if !want_mariadb {
        assert_eq!(idx("idx_expr")["columns"], json!(["(lower(`note`))"]));
    }
    let cons = d["constraints"].as_array().unwrap();
    assert_eq!(cons[0], json!({ "name": "PRIMARY", "type": "primary", "columns": ["id", "line"] }));
    let chk = cons.iter().find(|x| x["name"] == "qty_pos").unwrap_or_else(|| panic!("qty_pos: {d}"));
    let def = chk["definition"].as_str().unwrap();
    assert!(chk["type"] == "check" && def.starts_with("CHECK (") && def.contains("qty") && def.contains("> 0"), "{chk}");
    let fk = |n: &str| d["foreignKeys"].as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or_else(|| panic!("{n}: {d}"));
    let c1 = fk("fk cust");
    assert_eq!((&c1["schema"], &c1["table"], &c1["columns"]), (&json!("pt8"), &json!("or`ders"), &json!(["cust"])));
    assert_eq!((&c1["refSchema"], &c1["refTable"], &c1["refColumns"]), (&json!("pt8"), &json!("cust omer"), &json!(["id"])));
    assert_eq!(c1["onDelete"], "CASCADE");
    println!("MEASURE[{tag}] 기본 ON UPDATE: {}", c1["onUpdate"]);
    assert_eq!((fk("fk_rc")["columns"].clone(), fk("fk_rc")["refColumns"].clone()), (json!(["region", "code"]), json!(["region", "code"])));
    assert_eq!(fk("fk_rc")["onUpdate"], "CASCADE");
    assert_eq!(fk("fk_self")["refTable"], "or`ders");
    assert_eq!(d["foreignKeys"].as_array().unwrap().len(), 3);
    assert_eq!(d["referencedBy"].as_array().unwrap().iter().map(|x| x["name"].clone()).collect::<Vec<_>>(), [json!("fk_self")]);
    assert_eq!((&d["triggers"][0]["name"], &d["triggers"][0]["detail"]), (&json!("o trg"), &json!("AFTER UPDATE")));
    assert!(d["triggers"][0]["definition"].as_str().unwrap().starts_with("SET @x = 1"), "{d}");
    assert_eq!((d["partitions"].clone(), d["truncated"].clone()), (json!([]), json!([])));
    // 가리켜지는 쪽 — 다른 데이터베이스의 외래 키도 선다.
    let c = my.table_detail(Some("pt8"), "cust omer", 5000).await.unwrap();
    println!("MEASURE[{tag}] detail cust omer: {c}");
    let by: Vec<(String, String, String)> = c["referencedBy"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| (x["schema"].as_str().unwrap().into(), x["table"].as_str().unwrap().into(), x["name"].as_str().unwrap().into()))
        .collect();
    for want in [("pt8", "or`ders", "fk cust"), ("pt8", "or`ders", "fk_rc"), ("pt8b", "ref_other", "fk_other")] {
        assert!(by.contains(&(want.0.into(), want.1.into(), want.2.into())), "{want:?}: {c}");
    }
    let ctypes: Vec<(String, String)> =
        c["constraints"].as_array().unwrap().iter().map(|x| (x["type"].as_str().unwrap().into(), x["name"].as_str().unwrap().into())).collect();
    let want: Vec<(String, String)> =
        [("primary", "PRIMARY"), ("unique", "uq_rc"), ("check", "chk_code")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    assert_eq!(ctypes, want);
    assert_eq!(c["constraints"][1]["columns"], json!(["region", "code"]));
    // 뷰 — 컬럼만.
    let v = my.table_detail(Some("pt8"), "pt_v", 5000).await.unwrap();
    assert_eq!((v["columns"][0]["name"].clone(), v["indexes"].clone()), (json!("id"), json!([])));
    // 읽기 전용 계정(SELECT 권한만)에도 같은 모양.
    let r = reader.table_detail(None, "or`ders", 5000).await.unwrap();
    println!(
        "MEASURE[{tag}] reader detail or`ders: fks {} · indexes {} · triggers {}",
        r["foreignKeys"].as_array().unwrap().len(),
        r["indexes"].as_array().unwrap().len(),
        r["triggers"]
    );
    assert_eq!(r["foreignKeys"].as_array().unwrap().len(), 3, "{r}");
    // 이름은 바인드 인자 — 주입 모양도 그냥 없는 테이블이다.
    for bad in ["or`ders' OR '1'='1", "x`; DROP DATABASE pt8; --"] {
        assert!(emsg(&my.table_detail(Some("pt8"), bad, 5000).await.unwrap_err()).contains(bad), "{bad}");
    }
    a.query_drop("DROP DATABASE pt8b").await.unwrap();
}

/// 정의(DDL) 읽기(10-13) — `SHOW CREATE` 테이블 · 뷰 · 함수 · 프로시저 · 트리거 · 시퀀스(MariaDB) — 따옴표 · 공백 · 백틱 든 이름 ·
/// 주입 모양 이름(존재 확인에서 걸러진다) · 권한 부족 계정(본문 숨김 · 목록에 없음). 인덱스 · 제약은 따로 볼 정의가 없다.
async fn definitions(var: &str, want_mariadb: bool) {
    let Some(o) = opts(var) else {
        eprintln!("{var} 없음 — 건너뜀");
        return;
    };
    let tag = if want_mariadb { "mariadb" } else { "mysql" };
    let mut a = admin(&o).await;
    a.query_drop(
        "DROP DATABASE IF EXISTS `pt def`; CREATE DATABASE `pt def`;
         CREATE TABLE `pt def`.`or``ders`(id INT PRIMARY KEY, `the qty` INT NOT NULL DEFAULT 1, note VARCHAR(20), KEY k_note (note));
         CREATE VIEW `pt def`.`v w` AS SELECT id, `the qty` FROM `pt def`.`or``ders` WHERE `the qty` > 0;
         CREATE FUNCTION `pt def`.`f'n`(a INT) RETURNS INT DETERMINISTIC RETURN a + 1;
         CREATE PROCEDURE `pt def`.`p r`(IN a INT) SELECT a;
         CREATE TRIGGER `pt def`.`t\"g` BEFORE INSERT ON `pt def`.`or``ders` FOR EACH ROW SET NEW.note = 'x';
         DROP USER IF EXISTS 'pt_def_reader'@'%';
         CREATE USER 'pt_def_reader'@'%' IDENTIFIED BY 'readerpw';
         GRANT SELECT, EXECUTE ON `pt def`.* TO 'pt_def_reader'@'%';",
    )
    .await
    .expect("정의 준비");
    if want_mariadb {
        a.query_drop("CREATE SEQUENCE `pt def`.`s q` START WITH 5 INCREMENT BY 2").await.expect("시퀀스");
    }
    let user = o.user().unwrap().to_string();
    let pw = o.pass().map(str::to_string);
    let my = Mysql::connect("pt-def", direct_target(&o, &user, None), secrets(pw.as_deref())).await.expect("엔진 연결");
    let target = |kind: &str, name: &str| super::definition::DefTarget {
        schema: Some("pt def".into()),
        kind: kind.into(),
        name: name.into(),
        table: Some("or`ders".into()),
        args: None,
    };
    let sql = |v: &Value| v["sql"].as_str().unwrap().to_string();
    let t = my.definition(&target("table", "or`ders"), 5000).await.unwrap();
    println!("MEASURE[{tag}] def table:\n{}", sql(&t));
    assert_eq!((t["reconstructed"].as_bool(), t["truncated"].as_bool()), (Some(false), Some(false)));
    assert!(sql(&t).starts_with("CREATE TABLE `or``ders` (") && sql(&t).contains("KEY `k_note` (`note`)"), "{t}");
    let v = sql(&my.definition(&target("view", "v w"), 5000).await.unwrap());
    println!("MEASURE[{tag}] def view:\n{v}");
    assert!(v.contains("VIEW `pt def`.`v w` AS select") || v.contains("VIEW `v w` AS select"), "{v}");
    let f = sql(&my.definition(&target("function", "f'n"), 5000).await.unwrap());
    assert!(f.contains("FUNCTION `f'n`(a INT) RETURNS int") && f.contains("RETURN a + 1"), "{f}");
    let p = sql(&my.definition(&target("procedure", "p r"), 5000).await.unwrap());
    assert!(p.contains("PROCEDURE `p r`(IN a INT)"), "{p}");
    let tr = sql(&my.definition(&target("trigger", "t\"g"), 5000).await.unwrap());
    println!("MEASURE[{tag}] def trigger:\n{tr}");
    assert!(tr.contains("TRIGGER") && tr.contains("`t\"g` BEFORE INSERT ON") && tr.ends_with(';'), "{tr}");
    if want_mariadb {
        let s = sql(&my.definition(&target("sequence", "s q"), 5000).await.unwrap());
        println!("MEASURE[{tag}] def sequence:\n{s}");
        assert!(s.starts_with("CREATE SEQUENCE `s q`") && s.contains("start with 5") && s.contains("increment by 2"), "{s}");
    }
    // 따로 볼 정의가 없는 종류 · 종류가 다른 이름 · 주입 모양 이름.
    for (k, n) in [("index", "k_note"), ("constraint", "PRIMARY")] {
        let e = emsg(&my.definition(&target(k, n), 5000).await.unwrap_err());
        assert!(e.contains(k), "{k}: {e}");
    }
    for (k, n) in [("view", "or`ders"), ("table", "nope"), ("table", "or`ders` WHERE 1; DROP DATABASE `pt def"), ("function", "' OR '1'='1")] {
        let e = emsg(&my.definition(&target(k, n), 5000).await.unwrap_err());
        assert!(e.contains(n), "{k} {n}: {e}");
    }
    // 연결의 기본 데이터베이스(스키마 없음).
    let bare = super::definition::DefTarget { schema: None, ..target("table", "or`ders") };
    assert!(my.definition(&bare, 5000).await.is_err(), "기본 데이터베이스가 없는 연결");
    // 권한 부족 계정 — SELECT · EXECUTE 만. 본문을 숨기는지 실측.
    let reader = Mysql::connect("pt-def-r", direct_target(&o, "pt_def_reader", Some("pt def")), secrets(Some("readerpw")))
        .await
        .expect("reader");
    for (k, n) in [("table", "or`ders"), ("view", "v w"), ("function", "f'n"), ("procedure", "p r"), ("trigger", "t\"g")] {
        let r = reader.definition(&target(k, n), 5000).await;
        println!(
            "MEASURE[{tag}] def reader {k} {n}: {}",
            r.as_ref().map(|v| format!("ok {} B", sql(v).len())).unwrap_or_else(|e| one_line(&emsg(e)))
        );
    }
    for (k, n) in [("view", "v w"), ("function", "f'n")] {
        if let Err(e) = reader.definition(&target(k, n), 5000).await {
            let m = emsg(&e);
            assert!(m.contains("권한") || m.contains("privilege") || m.contains("찾지") || m.contains("find"), "{m}");
        }
    }
    // 같은 연결이 계속 쓸 만하다(정리 문장이 세션 값을 되돌렸다).
    assert_eq!(cell(&reader.query("SELECT 1", 10, 5000).await.unwrap(), 0, 0), json!(1));
    my.shutdown();
    reader.shutdown();
    drop(my);
    drop(reader);
    tokio::time::sleep(Duration::from_millis(300)).await;
    a.query_drop("DROP DATABASE `pt def`; DROP USER 'pt_def_reader'@'%';").await.unwrap();
    let _ = a.disconnect().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL 8"]
async fn mysql_definitions() {
    definitions("AYNX_TEST_MY_URL", false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB 11"]
async fn mariadb_definitions() {
    definitions("AYNX_TEST_MARIA_URL", true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_URL 이 있을 때만 — 실제 MySQL 8"]
async fn mysql_direct_end_to_end() {
    direct("AYNX_TEST_MY_URL", false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MARIA_URL 이 있을 때만 — 실제 MariaDB 11"]
async fn mariadb_direct_end_to_end() {
    direct("AYNX_TEST_MARIA_URL", true).await;
}

fn ssh_env() -> Option<(AdhocTarget, String, String, u16)> {
    let s = env("AYNX_TEST_MY_SSH")?;
    let (cred, addr) = s.rsplit_once('@')?;
    let (user, pw) = cred.split_once(':')?;
    let (host, port) = addr.rsplit_once(':')?;
    let (th, tp) = env("AYNX_TEST_MY_SSH_TARGET")?.rsplit_once(':').map(|(h, p)| (h.to_string(), p.to_string()))?;
    Some((
        AdhocTarget {
            host: host.into(),
            user: Some(user.into()),
            port: port.parse().ok(),
        },
        pw.into(),
        th,
        tp.parse().ok()?,
    ))
}

/// 프런트 `runSshGates` 와 같은 고리(PG 시험과 같다) — 호스트 키는 이번만 · 잠긴 키는 빼고 · 비밀번호는 몸으로.
async fn connect_with_gates(stream: &str, target: &NetTarget, ssh_pw: &str, db_pw: Option<&str>) -> (Result<Mysql, String>, Vec<String>) {
    let mut seen = Vec::new();
    let mut decision = None;
    let mut declined: Vec<String> = Vec::new();
    let mut give_ssh_pw = false;
    let mut give_db_pw = false;
    for _ in 0..8 {
        let s = OpenSecrets {
            password: give_db_pw.then(|| Zeroizing::new(db_pw.unwrap_or_default().to_string())),
            ssh: SharedCreds {
                host_key_decision: decision,
                password: give_ssh_pw.then(|| ssh_pw.to_string()),
                passphrase: None,
                passphrase_for: None,
                declined_keys: declined.clone(),
                unattended: None,
            },
        };
        match Mysql::connect(stream, target.clone(), s).await {
            Ok(p) => return (Ok(p), seen),
            Err(OpenError::Ssh(SshOpenError::HostKeyUnknown { .. })) | Err(OpenError::Ssh(SshOpenError::HostKeyChanged { .. })) => {
                seen.push("host_key".into());
                decision = Some(HostKeyDecision::Once);
            }
            Err(OpenError::Ssh(SshOpenError::PassphraseRequired { path, .. })) => {
                seen.push("passphrase".into());
                declined.push(path);
            }
            Err(OpenError::Ssh(SshOpenError::PasswordRequired { .. })) => {
                seen.push("ssh_password".into());
                give_ssh_pw = true;
            }
            Err(OpenError::Msg(m)) if m.contains("[db-password]") && db_pw.is_some() && !give_db_pw => {
                seen.push("db_password".into());
                give_db_pw = true;
                decision = None;
                give_ssh_pw = false;
            }
            Err(OpenError::Ssh(e)) => return (Err(format!("ssh {e:?}")), seen),
            Err(OpenError::Msg(m)) => return (Err(m), seen),
        }
    }
    (Err("관문 고리가 끝나지 않음".into()), seen)
}

/// SSH 경유 — 관문 → 터널 → MySQL 왕복 · 비밀번호를 묻는 동안 전송로 세워 두기 · 상한(함정 3) · 터널 위 KILL(제어 연결) ·
/// 시간 제한 · 읽기 전용 · 따뜻한 전송로 공유 · 전송로 사망 → [db-disconnected].
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_MY_SSH · _TARGET · _URL 이 있을 때만 — 임시 sshd + MySQL"]
async fn mysql_over_ssh_tunnel() {
    let (Some((adhoc, ssh_pw, th, tp)), Some(o)) = (ssh_env(), opts("AYNX_TEST_MY_URL")) else {
        eprintln!("AYNX_TEST_MY_SSH · _TARGET · _URL 없음 — 건너뜀");
        return;
    };
    let su = o.user().unwrap().to_string();
    let su_pw = o.pass().unwrap().to_string();
    let mut a = admin(&o).await;
    prepare(&mut a).await;
    let alias = format!("{}@{}:{}", adhoc.user.clone().unwrap_or_default(), adhoc.host, adhoc.port.unwrap_or(22));
    let target = NetTarget {
        id: "Test8_my-tunnel".into(),
        host: th,
        port: tp,
        database: Some("pt8".into()),
        user: Some(su),
        tls: DbTlsMode::Prefer,
        tls_ca: None,
        via: Some(alias),
        adhoc: Some(adhoc),
    };
    let started = Instant::now();
    let (my, seen) = connect_with_gates("my-ssh-1", &target, &ssh_pw, Some(&su_pw)).await;
    let my = my.unwrap_or_else(|m| panic!("{m} (관문 {seen:?})"));
    println!("MEASURE[ssh] gates: {seen:?} ({} ms)", started.elapsed().as_millis());
    assert!(seen.contains(&"ssh_password".to_string()), "{seen:?}");
    if let Some(i) = seen.iter().position(|s| s == "db_password") {
        assert!(seen[i + 1..].is_empty(), "비밀번호 뒤에 SSH 관문이 또 왔다: {seen:?}");
    }
    let r = my.query("SELECT CURRENT_USER(), @@port, VERSION()", 10, 5000).await.unwrap();
    println!("MEASURE[ssh] roundtrip: {} · {}", json!(r.rows), my.server_version());

    let started = Instant::now();
    let r = my.query("SELECT n FROM pt_big", 1000, 30_000).await.unwrap();
    let first_ms = started.elapsed().as_millis();
    assert_eq!((r.rows.len(), r.truncated), (1000, true));
    let started = Instant::now();
    my.query("SELECT 1", 10, 5000).await.unwrap();
    let next_ms = started.elapsed().as_millis();
    println!("MEASURE[ssh] limit 1M→1000: {first_ms} ms · 다음 SELECT 1: {next_ms} ms");
    assert!(next_ms < 500, "{next_ms}");

    // 취소 — 제어 연결(같은 터널)로 KILL QUERY.
    let my = Arc::new(my);
    let m2 = Arc::clone(&my);
    let started = Instant::now();
    let h = tokio::spawn(async move { m2.query(HEAVY, 10, 60_000).await });
    tokio::time::sleep(Duration::from_millis(400)).await;
    my.interrupt();
    let e = h.await.unwrap().unwrap_err();
    println!("MEASURE[ssh] cancel: {} ({} ms)", emsg(&e), started.elapsed().as_millis());
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(started.elapsed() < Duration::from_secs(3));
    let e = my.query(HEAVY, 10, 300).await.unwrap_err();
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    let m = emsg(&my.query_unguarded("INSERT INTO pt_t(name) VALUES ('evil')", 10, 5000).await.unwrap_err());
    assert!(m.contains("1792"), "{m}");
    // 같은 호스트에 둘째 연결 — 따뜻한 전송로에 얹힌다(관문 없음).
    let (second, seen2) = connect_with_gates("my-ssh-2", &target, &ssh_pw, Some(&su_pw)).await;
    let second = second.unwrap_or_else(|m| panic!("{m}"));
    assert!(!seen2.iter().any(|s| s == "ssh_password" || s == "host_key"), "따뜻한 길인데 관문: {seen2:?}");
    my.shutdown();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(cell(&second.query("SELECT 7", 10, 5000).await.unwrap(), 0, 0), json!(7));

    if let Some(name) = env("AYNX_TEST_MY_SSH_CONTAINER") {
        let st = std::process::Command::new("docker").args(["restart", "-t", "0", &name]).status().unwrap();
        assert!(st.success());
        let deadline = Instant::now() + Duration::from_secs(20);
        while !second.is_dead() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(second.is_dead(), "전송로가 죽었는데 연결이 산 것으로 남았다");
        let m = emsg(&second.query("SELECT 1", 10, 1000).await.unwrap_err());
        assert!(m.contains("[db-disconnected]"), "{m}");
        println!("MEASURE[ssh] death: {}", one_line(&m));
    }
    second.shutdown();
    drop(second);
    drop(my);
    a.query_drop("DROP DATABASE pt8; DROP USER 'pt_reader'@'%';").await.unwrap();
    let _ = a.disconnect().await;
}
