//! **PG 통합 시험**(쿼리 타일 7단계) — 실제 PostgreSQL · 임시 sshd 가 있을 때만 돈다(`#[ignore]` + 환경변수). 사용자의
//! `~/.ssh/config`·`sessions.toml`·볼트는 건드리지 않는다(경유는 그 자리 대상 `AdhocTarget` · 비밀번호는 몸으로만).
//!
//! ```text
//! AYNX_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:55432/postgres      # 직결(슈퍼유저 — 준비·읽기 전용 실측)
//! AYNX_TEST_PG_SSH=<user>:<pw>@127.0.0.1:2222                              # 임시 sshd(비밀번호 인증)
//! AYNX_TEST_PG_SSH_TARGET=pg:5432                                          # sshd 에서 본 PG 주소
//! AYNX_TEST_PG_SSH_CONTAINER=<sshd 컨테이너 이름>                           # 전송로 사망 시험(docker restart)
//! AYNX_TEST_PG_POOLER=127.0.0.1:56432                                      # 있으면 엔진은 이 풀러(PgBouncer transaction 모드)로 붙는다
//! cargo test --lib db::pg_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! `MEASURE` 로 시작하는 줄은 읽기 전용 실측 기록이다(docs/log 에 옮긴다).
//!
//! 풀러 모드(`AYNX_TEST_PG_POOLER`): 관리 연결(준비·대조)은 `_URL` 로 직결하고, 시험하는 엔진 연결만 풀러를 지난다. 풀러는
//! `pool_mode=transaction` · `server_round_robin=1` · `min_pool_size>=2` 로 띄우면 트랜잭션마다 백엔드가 바뀐다(10-13 사건 —
//! pg 머리말 "풀러"). `max_prepared_statements` 0 · 200 둘 다 돌린다.

use std::str::FromStr;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio_postgres::{Config, NoTls};
use zeroize::Zeroizing;

use super::net::{NetTarget, OpenError, OpenSecrets};
use super::pg::Pg;
use super::{EngineError, QueryOut};
use crate::db::conns::DbTlsMode;
use crate::ssh::open::SharedCreds;
use crate::ssh::{AdhocTarget, HostKeyDecision, SshOpenError};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn admin_config() -> Option<Config> {
    Config::from_str(&env("AYNX_TEST_PG_URL")?).ok()
}

fn direct_target(c: &Config, user: &str) -> NetTarget {
    let host = match &c.get_hosts()[0] {
        tokio_postgres::config::Host::Tcp(h) => h.clone(),
        #[allow(unreachable_patterns)]
        _ => "127.0.0.1".into(),
    };
    NetTarget {
        id: "Test7_pg-direct".into(),
        host,
        port: c.get_ports().first().copied().unwrap_or(5432),
        database: c.get_dbname().map(str::to_string),
        user: Some(user.into()),
        tls: DbTlsMode::Prefer,
        tls_ca: None,
        via: None,
        adhoc: None,
    }
}

/// 엔진이 붙을 곳 — 풀러가 있으면 그 주소, 없으면 직결.
fn engine_target(c: &Config, user: &str) -> NetTarget {
    let mut t = direct_target(c, user);
    if let Some((h, p)) = pooler() {
        t.host = h;
        t.port = p;
    }
    t
}

fn pooler() -> Option<(String, u16)> {
    let v = env("AYNX_TEST_PG_POOLER")?;
    let (h, p) = v.rsplit_once(':')?;
    Some((h.to_string(), p.parse().ok()?))
}

fn secrets(pw: Option<&str>) -> OpenSecrets {
    OpenSecrets {
        password: pw.map(|p| Zeroizing::new(p.to_string())),
        ssh: SharedCreds::default(),
    }
}

fn open_msg(r: Result<Pg, OpenError>) -> String {
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

async fn admin() -> tokio_postgres::Client {
    let (c, conn) = admin_config().unwrap().connect(NoTls).await.expect("관리 연결");
    tokio::spawn(conn);
    c
}

fn cell(out: &QueryOut, row: usize, col: usize) -> Value {
    out.rows[row][col].clone()
}

/// 직결 — 비밀번호 관문 · 값 매핑(서버 텍스트 출력 — 출력 함수 — 과 대조) · 행 상한 · 시간 제한 · 취소 · 한 번에 하나 · 읽기 전용 실측 ·
/// 스키마 · 쓰기 모드 · 연결 사망.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL"]
async fn pg_direct_end_to_end() {
    let Some(cfg) = admin_config() else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let su = cfg.get_user().unwrap().to_string();
    let su_pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let a = admin().await;
    a.batch_execute(
        "DROP MATERIALIZED VIEW IF EXISTS pt_m; DROP VIEW IF EXISTS pt_v; DROP TABLE IF EXISTS pt_t; DROP SEQUENCE IF EXISTS pt_seq;
         CREATE TABLE pt_t(id serial PRIMARY KEY, name text NOT NULL DEFAULT 'x', v numeric);
         INSERT INTO pt_t(name, v) VALUES ('a', 1.5), ('b', NULL), ('c', 3);
         CREATE SEQUENCE pt_seq; CREATE VIEW pt_v AS SELECT id FROM pt_t; CREATE MATERIALIZED VIEW pt_m AS SELECT 1 AS one;
         DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pt_reader') THEN CREATE ROLE pt_reader LOGIN PASSWORD 'readerpw'; END IF; END $$;
         GRANT SELECT ON pt_t TO pt_reader;
         DROP TYPE IF EXISTS pt_e1, pt_e2, pt_e3, pt_e4;
         CREATE TYPE pt_e1 AS ENUM ('a'); CREATE TYPE pt_e2 AS ENUM ('a'); CREATE TYPE pt_e3 AS ENUM ('a'); CREATE TYPE pt_e4 AS ENUM ('a');",
    )
    .await
    .unwrap();

    // ── 비밀번호 관문 ──
    let pooled = pooler().is_some();
    println!("MEASURE mode: {}", if pooled { "pooler" } else { "direct" });
    if let Some((h, p)) = pooler() {
        // 10-13 사건 재현 — 시작 옵션을 실은 연결은 풀러가 거절한다(엔진은 이제 싣지 않는다). `default_transaction_read_only`
        // 는 PgBouncer 1.23 이 거절하고 1.26 은 받는다(실측) — 그 줄은 기록만, 모르는 옵션의 거절은 어느 판이든 단언한다.
        for (opt, must_reject) in [("-c default_transaction_read_only=on", false), ("-c statement_timeout=5", true)] {
            let mut c = Config::new();
            c.host(&h).port(p).user(&su).password(su_pw.as_bytes()).dbname(cfg.get_dbname().unwrap_or("postgres"));
            c.options(opt);
            let r = match c.connect(NoTls).await {
                Err(e) => Err(e),
                Ok((client, conn)) => {
                    tokio::spawn(conn);
                    client.simple_query("SELECT 1").await.map(|_| ())
                }
            };
            let m = r.as_ref().map(|_| "OK".to_string()).unwrap_or_else(|e| one_line(&super::pg::describe(e)));
            println!("MEASURE pooler-options {opt}: {m}");
            if must_reject {
                assert!(m.contains("unsupported startup parameter"), "{m}");
            }
        }
    }
    let t = engine_target(&cfg, &su);
    let m = open_msg(Pg::connect("pt-1", t.clone(), secrets(None)).await);
    assert!(m.contains("[db-password]"), "{m}");
    let m = open_msg(Pg::connect("pt-1", t.clone(), secrets(Some("wrong"))).await);
    assert!(m.contains("[db-auth]") && !m.contains("[db-stored-rejected]") && !m.contains("wrong"), "{m}");
    println!("MEASURE auth-wrong: {}", one_line(&m));
    let pg = match Pg::connect("pt-1", t.clone(), secrets(Some(&su_pw))).await {
        Ok(p) => p,
        Err(e) => panic!("{}", open_msg(Err(e))),
    };
    assert!(pg.server_version().starts_with("PostgreSQL 16"), "{}", pg.server_version());
    let reader = Pg::connect("pt-2", engine_target(&cfg, "pt_reader"), secrets(Some("readerpw"))).await.expect("reader");

    // ── 값 매핑 — 기대 JSON ──
    let cases: &[(&str, Value)] = &[
        ("true", json!(true)),
        ("1::int2", json!(1)),
        ("2::int4", json!(2)),
        ("9007199254740993::int8", json!("9007199254740993")),
        ("1.5::float4", json!(1.5)),
        ("0.1::float4", json!(0.1)),
        ("'NaN'::float8", json!("NaN")),
        ("'-Infinity'::float8", json!("-Infinity")),
        ("12345678901234567890.12345::numeric", json!("12345678901234567890.12345")),
        ("'-0.000100'::numeric", json!("-0.000100")),
        ("'NaN'::numeric", json!("NaN")),
        ("'txt'::text", json!("txt")),
        ("'c'::char(3)", json!("c  ")),
        ("'nm'::name", json!("nm")),
        ("'00000000-0000-0000-0000-000000000001'::uuid", json!("00000000-0000-0000-0000-000000000001")),
        ("'{\"a\": 1}'::json", json!("{\"a\": 1}")),
        ("'{\"b\": 2}'::jsonb", json!("{\"b\": 2}")),
        ("'\\xdead'::bytea", json!({ "$bytes": 2, "hex": "dead" })),
        ("NULL::int4", Value::Null),
        ("'[1,5)'::int4range", json!("‹int4range›")),
        ("ROW(1, 'a')", json!("‹record›")),
        ("12.34::money", json!("12.34")),
        ("'x'::\"char\"", json!("x")),
    ];
    for (expr, want) in cases {
        let r = pg.query(&format!("SELECT {expr}"), 10, 5000).await.unwrap_or_else(|e| panic!("{expr}: {}", emsg(&e)));
        assert_eq!(&cell(&r, 0, 0), want, "{expr} (형 {})", r.columns[0].ty);
    }
    // ── 서버 텍스트 출력과 같은 글자인가(TimeZone UTC 로 맞춘 관리 연결과 대조) ──
    a.batch_execute("SET TIME ZONE 'UTC'; SET IntervalStyle = 'postgres'; SET DateStyle = 'ISO, MDY'").await.unwrap();
    let text_cases = [
        "'2024-02-29'::date",
        "'0044-03-15 BC'::date",
        "'infinity'::date",
        "'13:45:01.25'::time",
        "'13:45:01+09'::timetz",
        "'13:45:01-03:30'::timetz",
        "'2024-02-29 13:45:01.5'::timestamp",
        "'2024-02-29 13:45:01.5+09'::timestamptz",
        "'-infinity'::timestamptz",
        "'1 year 2 mons 3 days 04:05:06.789'::interval",
        "'-1 days -00:00:01'::interval",
        "'192.168.1.5/24'::inet",
        "'192.168.1.5'::inet",
        "'10.0.0.0/8'::cidr",
        "'2001:db8::1/64'::inet",
        "'08:00:2b:01:02:03'::macaddr",
        "'08:00:2b:01:02:03:04:05'::macaddr8",
        "B'10110'::varbit",
        "'16/B374D848'::pg_lsn",
        "point(1.5, 2)",
        "'(1,2)'::tid",
        "ARRAY[1, 2, NULL]::int4[]",
        "ARRAY['a b', 'c', '', 'NULL', 'q\"\\']::text[]",
        "ARRAY[[1, 2], [3, 4]]::int8[]",
        "'[0:1]={5,6}'::int4[]",
        "ARRAY[true, false]",
        "ARRAY[1.5, 2]::numeric[]",
        "ARRAY['2024-01-01']::date[]",
        "'{}'::text[]",
        "ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]",
    ];
    for expr in text_cases {
        let r = pg.query(&format!("SELECT {expr}"), 10, 5000).await.unwrap_or_else(|e| panic!("{expr}: {}", emsg(&e)));
        // 서버의 텍스트 출력(형의 출력 함수 — psql 이 보이는 글자). `::text` 형 변환은 inet 처럼 다른 꼴을 낼 수 있어 쓰지 않는다.
        let server = a
            .simple_query(&format!("SELECT {expr}"))
            .await
            .unwrap()
            .into_iter()
            .find_map(|m| match m {
                tokio_postgres::SimpleQueryMessage::Row(r) => r.get(0).map(str::to_string),
                _ => None,
            })
            .unwrap();
        println!("MEASURE value {expr} → {} ({})", cell(&r, 0, 0), r.columns[0].ty);
        assert_eq!(cell(&r, 0, 0), json!(server), "{expr} (형 {})", r.columns[0].ty);
    }

    // ── 행 상한 ──
    let r = pg.query("SELECT g FROM generate_series(1, 5000) g", 100, 10_000).await.unwrap();
    assert_eq!((r.rows.len(), r.truncated, r.affected), (100, true, None));
    let r = pg.query("SELECT g FROM generate_series(1, 5000) g", 5000, 10_000).await.unwrap();
    assert_eq!((r.rows.len(), r.truncated), (5000, false));
    assert_eq!(r.columns[0].ty, "int4");

    // ── 시간 제한(서버 statement_timeout) · 취소(새 TCP 의 CancelRequest) · 한 번에 하나 ──
    let started = Instant::now();
    let e = pg.query("SELECT pg_sleep(5)", 10, 300).await.unwrap_err();
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(started.elapsed() < Duration::from_secs(3));
    let pg = std::sync::Arc::new(pg);
    let p2 = std::sync::Arc::clone(&pg);
    let started = Instant::now();
    let h = tokio::spawn(async move { p2.query("SELECT pg_sleep(10)", 10, 60_000).await });
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(matches!(pg.query("SELECT 1", 10, 1000).await, Err(EngineError::Busy)));
    pg.interrupt();
    let e = h.await.unwrap().unwrap_err();
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    println!("MEASURE cancel-direct: {} ms", started.elapsed().as_millis());
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(cell(&pg.query("SELECT 41 + 1", 10, 1000).await.unwrap(), 0, 0), json!(42), "취소 뒤 연결 재사용");

    // ── 읽기 전용 실측 — 가드(guarded) · 엔진 겹만(unguarded) ──
    let probes: &[&str] = &[
        "COMMIT; INSERT INTO pt_t(name) VALUES ('evil')",
        "WITH x AS (DELETE FROM pt_t RETURNING *) SELECT * FROM x",
        "SET default_transaction_read_only = off",
        "SELECT set_config('default_transaction_read_only', 'off', false)",
        "INSERT INTO pt_t(name) VALUES ('evil')",
        "EXPLAIN ANALYZE DELETE FROM pt_t",
        "SELECT * FROM pt_t FOR UPDATE",
        "SELECT nextval('pt_seq')",
        "SELECT txid_current()",
        "SELECT length(pg_read_file('/etc/hostname')) > 0",
        "SELECT lo_import('/etc/hostname')",
        "SELECT lo_export(1, '/tmp/pt_lo_out')",
        "COPY pt_t TO PROGRAM 'id'",
        "COPY (SELECT 1) TO '/tmp/pt_copy_out'",
        "SELECT pg_advisory_lock(42)",
        "SELECT pg_reload_conf()",
        "SELECT pg_terminate_backend(0)",
        "SELECT pg_notify('pt_chan', 'hi')",
        "DO $$ BEGIN INSERT INTO pt_t(name) VALUES ('evil'); END $$",
        "CALL nothing()",
        "VACUUM pt_t",
        "REFRESH MATERIALIZED VIEW pt_m",
        "TABLE pt_t",
        "VALUES (1), (2)",
        "SHOW server_version",
        "EXPLAIN SELECT 1",
    ];
    for who in ["superuser", "pt_reader"] {
        let p: &Pg = if who == "superuser" { &pg } else { &reader };
        for sql in probes {
            let g = p.query(sql, 5, 5000).await;
            let u = p.query_unguarded(sql, 5, 5000).await;
            let show = |r: &Result<QueryOut, EngineError>| match r {
                Ok(o) => format!("OK rows={} {}", o.rows.len(), o.rows.first().map(|r| json!(r).to_string()).unwrap_or_default()),
                Err(e) => format!("ERR {}", one_line(&emsg(e))),
            };
            println!("MEASURE ro[{who}] {sql}\n    guarded:   {}\n    unguarded: {}", show(&g), show(&u));
        }
    }
    let n: i64 = a.query_one("SELECT count(*) FROM pt_t", &[]).await.unwrap().get(0);
    assert_eq!(n, 3, "읽기 전용 실측 뒤에도 표가 그대로");
    // 다중 문장 · WITH DELETE · SET 은 반드시 막힌다(겹 둘 다).
    let m = emsg(&pg.query(probes[0], 5, 5000).await.unwrap_err());
    assert!(m.contains("문장 하나") || m.contains("one statement"), "{m}");
    assert!(pg.query_unguarded(probes[0], 5, 5000).await.is_err(), "확장 프로토콜이 다중 문장을 거절");
    for sql in [probes[1], probes[4], probes[5]] {
        let m = emsg(&pg.query_unguarded(sql, 5, 5000).await.unwrap_err());
        assert!(m.contains("25006"), "{sql}: {m}");
    }
    assert!(pg.query(probes[2], 5, 5000).await.is_err());
    // 함수로 세션 값을 바꿔도 다음 문장은 제 READ ONLY 트랜잭션 안이다.
    let _ = pg.query(probes[3], 5, 5000).await;
    let m = emsg(&pg.query(probes[1], 5, 5000).await.unwrap_err());
    assert!(m.contains("25006"), "{m}");
    let _ = a.batch_execute("SELECT pg_advisory_unlock_all()").await;

    // ── 스키마 · 컬럼 ──
    let s = pg.schema(5000).await.unwrap();
    assert_eq!(s["schemas"][0], json!({ "name": "public" }), "{s}");
    let o = pg.objects(Some("public"), 5000).await.unwrap();
    let objs = o["objects"].as_array().unwrap();
    for (n, k) in [("pt_t", "table"), ("pt_v", "view"), ("pt_m", "matview"), ("pt_seq", "sequence"), ("pt_t_id_seq", "sequence")] {
        assert!(objs.contains(&json!({ "name": n, "kind": k })), "{n}: {o}");
    }
    assert!(objs.contains(&json!({ "name": "pt_e1", "kind": "type", "sub": "enum" })), "{o}");
    assert!(!s.to_string().contains("pg_catalog") && !s.to_string().contains("information_schema"));
    let c = pg.table_detail(None, "pt_t", 5000).await.unwrap();
    assert_eq!(c["columns"][0], json!({ "name": "id", "type": "integer", "notNull": true, "default": "nextval('pt_t_id_seq'::regclass)", "pk": 1 }));
    assert_eq!(c["columns"][1]["default"], "'x'::text");
    assert_eq!(c["columns"][2]["pk"], 0);
    assert!(emsg(&pg.table_detail(Some("public"), "nope", 5000).await.unwrap_err()).contains("nope"));

    // ── 쓰기 모드(타일 위 띠의 토글 — 문장마다 자동 커밋) ──
    pg.set_write(true).await.unwrap();
    let r = pg.query("INSERT INTO pt_t(name) VALUES ('w')", 10, 5000).await.unwrap();
    assert_eq!(r.affected, Some(1));
    let r = pg.query("INSERT INTO pt_t(name) VALUES ('w2') RETURNING name", 10, 5000).await.unwrap();
    assert_eq!(cell(&r, 0, 0), json!("w2"));
    // 사람의 트랜잭션 문장은 가드가 거절한다(다음 SELECT 의 감싸기가 그것을 조용히 커밋하므로 — guard 머리말 2).
    for sql in ["BEGIN", "START TRANSACTION", "COMMIT", "ROLLBACK", "SAVEPOINT s"] {
        let m = emsg(&pg.query(sql, 10, 5000).await.unwrap_err());
        assert!(m.contains("BEGIN"), "{sql}: {m}");
    }
    // 쓰기 모드의 시간 제한도 서버(`SET LOCAL statement_timeout`)가 끊는다.
    let started = Instant::now();
    let e = pg.query("SELECT pg_sleep(5)", 10, 300).await.unwrap_err();
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(started.elapsed() < Duration::from_secs(3));
    // 트랜잭션 밖에서만 도는 문장 — 25001 뒤 simple query 재시도(pg 머리말 "실행").
    for sql in [
        "VACUUM pt_t",
        "VACUUM (ANALYZE) pt_t",
        "CREATE INDEX CONCURRENTLY pt_idx ON pt_t(name)",
        "DROP INDEX CONCURRENTLY pt_idx",
    ] {
        let r = pg.query(sql, 10, 5000).await.unwrap_or_else(|e| panic!("{sql}: {}", emsg(&e)));
        println!("MEASURE outside-tx {sql} → affected {:?} rows {}", r.affected, r.rows.len());
        assert_eq!((r.affected, r.rows.len(), r.columns.len()), (Some(0), 0, 0), "{sql}");
    }
    // 재시도 길의 취소 — 다른 트랜잭션이 표를 쥐고 있으면 CIC 가 기다린다 → 취소 토큰으로 끊긴다.
    let blocker = admin().await;
    blocker.batch_execute("BEGIN; LOCK TABLE pt_t IN ROW EXCLUSIVE MODE").await.unwrap();
    let p2 = std::sync::Arc::clone(&pg);
    let started = Instant::now();
    let h = tokio::spawn(async move { p2.query("CREATE INDEX CONCURRENTLY pt_idx2 ON pt_t(name)", 10, 60_000).await });
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(!h.is_finished(), "CIC 가 막힌 트랜잭션을 기다려야 한다");
    pg.interrupt();
    let e = h.await.unwrap().unwrap_err();
    println!("MEASURE cancel-outside-tx: {} ms", started.elapsed().as_millis());
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    blocker.batch_execute("ROLLBACK").await.unwrap();
    a.batch_execute("DROP INDEX IF EXISTS pt_idx2").await.unwrap();
    // 일반 쓰기 오류는 재시도하지 않는다(오류 그대로).
    let m = emsg(&pg.query("INSERT INTO pt_nope VALUES (1)", 10, 5000).await.unwrap_err());
    assert!(m.contains("42P01"), "{m}");
    pg.set_write(false).await.unwrap();
    assert!(pg.query("INSERT INTO pt_t(name) VALUES ('x')", 10, 5000).await.is_err());
    let m = emsg(&pg.query("VACUUM pt_t", 10, 5000).await.unwrap_err());
    assert!(!m.contains("25001"), "읽기 전용 모드는 가드가 먼저 거절: {m}");
    let r = pg.query("SELECT count(*) FROM pt_t", 10, 5000).await.unwrap();
    assert_eq!(cell(&r, 0, 0), json!(5));

    // ── 백엔드가 바뀌어도(풀러) 문장마다 같은 결과 — 읽기 · 쓰기 모드 번갈아 ──
    let mut pids = std::collections::BTreeSet::new();
    for i in 0..16 {
        let write = i % 2 == 1;
        pg.set_write(write).await.unwrap();
        let r = pg.query("SELECT pg_backend_pid(), current_setting('transaction_read_only')", 10, 5000).await.unwrap();
        pids.insert(cell(&r, 0, 0).as_i64().unwrap());
        assert_eq!(cell(&r, 0, 1), json!(if write { "off" } else { "on" }), "{i}");
        let c = pg.table_detail(None, "pt_t", 5000).await.unwrap();
        assert_eq!(c["columns"][0]["name"], "id");
    }
    pg.set_write(false).await.unwrap();
    // 풀러가 실제로 백엔드를 바꿨는지는 풀러 상태에 달렸다(앞 실행이 남긴 `used` 서버 연결은 돌려 쓰지 않을 수 있다) — 기록만.
    // 전환을 보려면 풀러를 새로 띄운 직후에 돌린다(10-13 실측: 새 풀러에서 3).
    println!("MEASURE backends seen: {}{}", pids.len(), if pooled && pids.len() < 2 { " (전환 없음 — 이번 실행은 전환을 재지 못했다)" } else { "" });
    // 모르는 형(enum) — tokio-postgres 의 typeinfo 캐시(pg 머리말 "풀러" 의 남은 한계). 풀러에서는 실측만.
    for ty in ["pt_e1", "pt_e2", "pt_e3", "pt_e4"] {
        let r = pg.query(&format!("SELECT 'a'::{ty}"), 10, 5000).await;
        let show = match &r {
            Ok(o) => format!("OK {}", cell(o, 0, 0)),
            Err(e) => format!("ERR {}", one_line(&emsg(e))),
        };
        println!("MEASURE custom-type {ty}: {show}");
        if !pooled {
            assert!(r.is_ok(), "{ty}: {show}");
        } else if let Err(e) = &r {
            assert!(emsg(e).contains("max_prepared_statements"), "풀러 안내가 붙는다: {show}");
        }
    }

    // ── 연결 사망(서버가 끊음) → [db-disconnected] ──
    let pid = cell(&pg.query("SELECT pg_backend_pid()", 10, 5000).await.unwrap(), 0, 0).as_i64().unwrap() as i32;
    a.execute("SELECT pg_terminate_backend($1)", &[&pid]).await.unwrap();
    if pooled {
        // 풀러 뒤 — 백엔드가 죽어도 클라이언트 연결(풀러까지)은 산다. 다음 문장은 다른 백엔드에서 돈다.
        tokio::time::sleep(Duration::from_millis(300)).await;
        let r = pg.query("SELECT 1", 10, 5000).await;
        println!("MEASURE pooler-backend-killed: {}", r.as_ref().map(|_| "OK".to_string()).unwrap_or_else(|e| one_line(&emsg(e))));
        let r = pg.query("SELECT 1", 10, 5000).await;
        assert!(r.is_ok(), "{}", r.err().map(|e| emsg(&e)).unwrap_or_default());
        assert!(!pg.is_dead());
    } else {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !pg.is_dead() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(pg.is_dead());
        let m = emsg(&pg.query("SELECT 1", 10, 1000).await.unwrap_err());
        assert!(m.contains("[db-disconnected]"), "{m}");
    }

    pg.shutdown();
    reader.shutdown();
    a.batch_execute("DROP MATERIALIZED VIEW pt_m; DROP VIEW pt_v; DROP TABLE pt_t; DROP SEQUENCE pt_seq; DROP OWNED BY pt_reader; DROP ROLE pt_reader; DROP TYPE pt_e1, pt_e2, pt_e3, pt_e4;")
        .await
        .unwrap();
}

/// 스키마 트리(10-13) — 스키마 이름만 → 스키마를 펼치면 종류별 객체. 이상한 스키마 이름(따옴표 · 공백)은 바인드 인자로만 닿는다.
/// 분할 표의 파티션 · 확장이 만든 함수·형 · 배열 형 · 표의 행 형은 빠진다. 풀러(`_POOLER`)면 엔진 연결이 풀러를 지난다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL"]
async fn pg_schema_tree_objects() {
    let Some(cfg) = admin_config() else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let su = cfg.get_user().unwrap().to_string();
    let su_pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let a = admin().await;
    a.batch_execute(
        r#"DROP SCHEMA IF EXISTS "pt tree""x" CASCADE; CREATE SCHEMA "pt tree""x"; SET search_path = "pt tree""x";
         CREATE TABLE t1(id int PRIMARY KEY, label text);
         CREATE TABLE logs(at date NOT NULL, msg text) PARTITION BY RANGE (at);
         CREATE TABLE logs_2026 PARTITION OF logs FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
         CREATE VIEW v1 AS SELECT id FROM t1;
         CREATE MATERIALIZED VIEW mv1 AS SELECT 1 AS one;
         CREATE SEQUENCE s1;
         CREATE FUNCTION f1(a integer) RETURNS integer LANGUAGE sql AS 'SELECT a';
         CREATE FUNCTION f1(a text, b text) RETURNS text LANGUAGE sql AS 'SELECT a || b';
         CREATE PROCEDURE p1(n integer) LANGUAGE sql AS 'SELECT n';
         CREATE AGGREGATE agg1(integer) (SFUNC = int4pl, STYPE = integer);
         CREATE TYPE e1 AS ENUM ('a', 'b');
         CREATE DOMAIN d1 AS integer CHECK (VALUE > 0);
         CREATE TYPE r1 AS RANGE (subtype = float8);
         CREATE TYPE c1 AS (x int, y int);
         CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA "pt tree""x";
         CREATE EXTENSION IF NOT EXISTS postgres_fdw;
         DROP SERVER IF EXISTS pt_fdw CASCADE;
         CREATE SERVER pt_fdw FOREIGN DATA WRAPPER postgres_fdw;
         CREATE FOREIGN TABLE ft1(id int) SERVER pt_fdw;
         RESET search_path;"#,
    )
    .await
    .unwrap();
    let pg = Pg::connect("pt-tree", engine_target(&cfg, &su), secrets(Some(&su_pw))).await.expect("엔진 연결");
    let schema = "pt tree\"x";
    let s = pg.schema(5000).await.unwrap();
    let names: Vec<&str> = s["schemas"].as_array().unwrap().iter().map(|x| x["name"].as_str().unwrap()).collect();
    assert_eq!(names[0], "public", "{s}");
    assert!(names.contains(&schema), "{s}");
    assert!(s["schemas"][0].get("tables").is_none(), "첫 단계는 이름만");
    // 풀러면 트랜잭션마다 백엔드가 바뀔 수 있다 — 같은 답이 거듭 서야 한다.
    let mut first: Option<Value> = None;
    for _ in 0..6 {
        let o = pg.objects(Some(schema), 5000).await.unwrap();
        if let Some(f) = &first {
            assert_eq!(f, &o);
        }
        first = Some(o);
    }
    let o = first.unwrap();
    println!("MEASURE tree objects: {o}");
    let objs = o["objects"].as_array().unwrap();
    let has = |want: Value| assert!(objs.contains(&want), "{want}: {o}");
    has(json!({ "kind": "table", "name": "t1" }));
    has(json!({ "kind": "table", "name": "logs", "sub": "partitioned" }));
    has(json!({ "kind": "view", "name": "v1" }));
    has(json!({ "kind": "matview", "name": "mv1" }));
    has(json!({ "kind": "foreign", "name": "ft1" }));
    has(json!({ "kind": "sequence", "name": "s1" }));
    has(json!({ "kind": "function", "name": "f1", "args": "a integer", "returns": "integer" }));
    has(json!({ "kind": "function", "name": "f1", "args": "a text, b text", "returns": "text" }));
    // 프로시저의 인자 글자는 판마다 다르다(14+ 는 `IN n integer`).
    assert!(objs.iter().any(|x| x["kind"] == "procedure" && x["name"] == "p1" && x["args"].as_str().unwrap().ends_with("n integer") && x.get("returns").is_none()), "{o}");
    has(json!({ "kind": "function", "name": "agg1", "sub": "aggregate", "args": "integer", "returns": "integer" }));
    has(json!({ "kind": "type", "name": "e1", "sub": "enum" }));
    has(json!({ "kind": "type", "name": "d1", "sub": "domain" }));
    has(json!({ "kind": "type", "name": "r1", "sub": "range" }));
    has(json!({ "kind": "type", "name": "c1", "sub": "composite" }));
    let named = |n: &str| objs.iter().any(|x| x["name"] == n);
    assert!(!named("logs_2026"), "분할 표의 파티션은 빠진다");
    assert!(!named("gen_random_bytes") && !named("digest"), "확장(pgcrypto)이 만든 함수는 빠진다");
    assert!(!named("r1_multirange") && objs.iter().filter(|x| x["name"] == "r1").count() == 1, "범위 형의 생성자 함수는 빠진다");
    let types: Vec<&str> = objs.iter().filter(|x| x["kind"] == "type").map(|x| x["name"].as_str().unwrap()).collect();
    assert_eq!(types, ["c1", "d1", "e1", "r1"], "배열 형(_e1) · 표의 행 형(t1 · v1) · 다중 범위는 빠진다");
    assert_eq!(o["truncated"], json!([]));
    // 없는 스키마 → 빈 목록 · 주입 모양의 이름도 바인드 인자라 그냥 없는 이름이다.
    for bad in ["nope", "public' OR '1'='1", "x\"; DROP TABLE t1; --"] {
        let e = pg.objects(Some(bad), 5000).await.unwrap();
        assert_eq!(e["objects"], json!([]), "{bad}");
    }
    // 이상한 스키마 이름의 표 컬럼도 바인드로.
    let c = pg.table_detail(Some(schema), "t1", 5000).await.unwrap();
    assert_eq!(c["columns"][0]["name"], "id");
    pg.shutdown();
    a.batch_execute(r#"DROP SCHEMA "pt tree""x" CASCADE; DROP SERVER IF EXISTS pt_fdw CASCADE;"#).await.unwrap();
}

/// 테이블 구조(10-13) — 인덱스(다중 열 · 식 · 부분 · 제외 제약의 gist) · 제약(기본 키 · 유니크 · 체크 · 제외) · 외래 키(복합 · 자기 참조 ·
/// 다른 스키마에서 오는 것 · 분할 테이블이 파티션마다 복제한 것은 하나로) · 트리거(내부 것 제외 · 뷰의 INSTEAD OF) · 파티션(범위 ·
/// DEFAULT · 하위 분할) — 따옴표 · 공백 든 이름. 한 READ ONLY 트랜잭션이라 풀러(`_POOLER`) 뒤에서도 같은 답이어야 한다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL"]
async fn pg_table_detail_folders() {
    let Some(cfg) = admin_config() else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let su = cfg.get_user().unwrap().to_string();
    let su_pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let a = admin().await;
    a.batch_execute(
        r#"DROP SCHEMA IF EXISTS "pt det""x" CASCADE; DROP SCHEMA IF EXISTS pt_other CASCADE;
         CREATE SCHEMA "pt det""x"; CREATE SCHEMA pt_other; SET search_path = "pt det""x";
         CREATE TABLE "cust omer"(id int PRIMARY KEY, region text NOT NULL, code text, UNIQUE (region, code),
           CONSTRAINT chk_code CHECK (code <> ''));
         CREATE TABLE "or""ders"(id int, line int, cust int REFERENCES "cust omer" ON DELETE CASCADE, region text, code text,
           parent_id int, parent_line int, note text, qty int, during tsrange,
           PRIMARY KEY (id, line),
           CONSTRAINT qty_pos CHECK (qty > 0),
           CONSTRAINT no_overlap EXCLUDE USING gist (during WITH &&),
           CONSTRAINT fk_rc FOREIGN KEY (region, code) REFERENCES "cust omer"(region, code) ON UPDATE CASCADE,
           CONSTRAINT fk_self FOREIGN KEY (parent_id, parent_line) REFERENCES "or""ders"(id, line));
         CREATE INDEX "o idx" ON "or""ders"(cust, region DESC);
         CREATE INDEX o_expr ON "or""ders"(lower(note), qty);
         CREATE INDEX o_part ON "or""ders"(qty) WHERE qty > 10;
         CREATE FUNCTION trg_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
         CREATE TRIGGER "o trg" BEFORE INSERT OR UPDATE ON "or""ders" FOR EACH ROW EXECUTE FUNCTION trg_fn();
         CREATE TABLE pt_other.ref_other(x int REFERENCES "pt det""x"."cust omer"(id));
         CREATE TABLE plog(at date, cust int REFERENCES "cust omer"(id)) PARTITION BY RANGE (at);
         CREATE TABLE plog_1 PARTITION OF plog FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
         CREATE TABLE logs(at date NOT NULL, msg text) PARTITION BY RANGE (at);
         CREATE TABLE logs_2025 PARTITION OF logs FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
         CREATE TABLE logs_2026 PARTITION OF logs FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') PARTITION BY LIST (msg);
         CREATE TABLE logs_def PARTITION OF logs DEFAULT;
         CREATE INDEX logs_at ON logs(at);
         CREATE VIEW ov AS SELECT id, line FROM "or""ders";
         CREATE TRIGGER ov_trg INSTEAD OF INSERT ON ov FOR EACH ROW EXECUTE FUNCTION trg_fn();
         CREATE MATERIALIZED VIEW mv AS SELECT id FROM "cust omer";
         CREATE UNIQUE INDEX mv_id ON mv(id);
         RESET search_path;"#,
    )
    .await
    .unwrap();
    let pg = Pg::connect("pt-detail", engine_target(&cfg, &su), secrets(Some(&su_pw))).await.expect("엔진 연결");
    let schema = "pt det\"x";
    // 풀러면 트랜잭션마다 백엔드가 바뀔 수 있다 — 같은 답이 거듭 서야 한다.
    let mut first: Option<Value> = None;
    for _ in 0..6 {
        let d = pg.table_detail(Some(schema), "or\"ders", 5000).await.unwrap();
        if let Some(f) = &first {
            assert_eq!(f, &d);
        }
        first = Some(d);
    }
    let d = first.unwrap();
    println!("MEASURE pg detail or\"ders: {d}");
    assert_eq!(d["columns"].as_array().unwrap().len(), 10);
    let idx = |n: &str| d["indexes"].as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or_else(|| panic!("{n}: {d}"));
    assert_eq!(d["indexes"][0]["name"], "or\"ders_pkey", "기본 키가 맨 앞");
    let pk = idx("or\"ders_pkey");
    assert_eq!((&pk["columns"], &pk["primary"], &pk["unique"], &pk["method"]), (&json!(["id", "line"]), &json!(true), &json!(true), &json!("btree")));
    assert_eq!(idx("o idx")["columns"][0], "cust");
    assert!(idx("o idx")["definition"].as_str().unwrap().contains("region DESC"), "{d}");
    assert_eq!(idx("o_expr")["columns"], json!(["lower(note)", "qty"]));
    assert_eq!(idx("o_part")["predicate"], "qty > 10");
    assert_eq!(idx("no_overlap")["method"], "gist");
    let cons: Vec<(String, String)> =
        d["constraints"].as_array().unwrap().iter().map(|x| (x["type"].as_str().unwrap().into(), x["name"].as_str().unwrap().into())).collect();
    let want: Vec<(String, String)> = [("primary", "or\"ders_pkey"), ("check", "qty_pos"), ("exclude", "no_overlap")]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
    assert_eq!(cons, want, "기본 키 · 유니크 · 체크 · 제외 순");
    assert_eq!(d["constraints"][1]["columns"], json!(["qty"]));
    assert_eq!(d["constraints"][1]["definition"], "CHECK (qty > 0)");
    assert!(d["constraints"][2]["definition"].as_str().unwrap().starts_with("EXCLUDE USING gist"), "{d}");
    let fk = |n: &str| d["foreignKeys"].as_array().unwrap().iter().find(|x| x["name"] == n).cloned().unwrap_or_else(|| panic!("{n}: {d}"));
    assert_eq!(
        fk("or\"ders_cust_fkey"),
        json!({ "name": "or\"ders_cust_fkey", "schema": schema, "table": "or\"ders", "columns": ["cust"], "refSchema": schema,
                "refTable": "cust omer", "refColumns": ["id"], "onUpdate": "NO ACTION", "onDelete": "CASCADE" })
    );
    assert_eq!((fk("fk_rc")["refColumns"].clone(), fk("fk_rc")["onUpdate"].clone()), (json!(["region", "code"]), json!("CASCADE")));
    assert_eq!(fk("fk_self")["refTable"], "or\"ders");
    assert_eq!(d["foreignKeys"].as_array().unwrap().len(), 3);
    assert_eq!(d["referencedBy"].as_array().unwrap().iter().map(|x| x["name"].clone()).collect::<Vec<_>>(), [json!("fk_self")]);
    // 트리거 — 외래 키가 만든 내부 트리거는 빠진다.
    let trg = d["triggers"].as_array().unwrap();
    assert_eq!(trg.len(), 1, "{d}");
    assert_eq!((&trg[0]["name"], &trg[0]["detail"]), (&json!("o trg"), &json!("BEFORE INSERT OR UPDATE")));
    assert!(trg[0]["definition"].as_str().unwrap().starts_with("CREATE TRIGGER"));
    assert_eq!((d["partitions"].clone(), d["truncated"].clone()), (json!([]), json!([])));
    // 가리켜지는 쪽 — 다른 스키마의 외래 키 · 분할 테이블의 외래 키는 부모 하나로.
    let c = pg.table_detail(Some(schema), "cust omer", 5000).await.unwrap();
    println!("MEASURE pg detail cust omer: {c}");
    let mut by: Vec<String> = c["referencedBy"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| format!("{}.{}.{}", x["schema"].as_str().unwrap(), x["table"].as_str().unwrap(), x["name"].as_str().unwrap()))
        .collect();
    by.sort();
    assert_eq!(
        by,
        ["pt det\"x.or\"ders.fk_rc", "pt det\"x.or\"ders.or\"ders_cust_fkey", "pt det\"x.plog.plog_cust_fkey", "pt_other.ref_other.ref_other_x_fkey"],
        "{c}"
    );
    let ctypes: Vec<&str> = c["constraints"].as_array().unwrap().iter().map(|x| x["type"].as_str().unwrap()).collect();
    assert_eq!(ctypes, ["primary", "unique", "check"]);
    assert_eq!(c["constraints"][1]["columns"], json!(["region", "code"]));
    // 분할 테이블 — 파티션(범위 식 · DEFAULT · 하위 분할) · 부모의 인덱스.
    let l = pg.table_detail(Some(schema), "logs", 5000).await.unwrap();
    println!("MEASURE pg detail logs: {l}");
    assert_eq!(
        l["partitions"],
        json!([
            { "schema": schema, "name": "logs_2025", "bound": "FOR VALUES FROM ('2025-01-01') TO ('2026-01-01')" },
            { "schema": schema, "name": "logs_2026", "bound": "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')", "sub": "partitioned" },
            { "schema": schema, "name": "logs_def", "bound": "DEFAULT" },
        ])
    );
    assert_eq!(l["indexes"][0]["name"], "logs_at");
    // 뷰 — 컬럼 · INSTEAD OF 트리거 · 구체화 뷰의 인덱스.
    let v = pg.table_detail(Some(schema), "ov", 5000).await.unwrap();
    assert_eq!(v["columns"].as_array().unwrap().len(), 2);
    assert_eq!(v["triggers"][0]["detail"], "INSTEAD OF INSERT");
    let m = pg.table_detail(Some(schema), "mv", 5000).await.unwrap();
    assert_eq!((m["indexes"][0]["name"].clone(), m["indexes"][0]["unique"].clone()), (json!("mv_id"), json!(true)));
    // 이름은 바인드 인자 — 주입 모양도 그냥 없는 테이블이다.
    for (s, t) in [(schema, "nope"), (schema, "x\"; DROP TABLE t; --"), ("public' OR '1'='1", "or\"ders")] {
        assert!(emsg(&pg.table_detail(Some(s), t, 5000).await.unwrap_err()).contains(t), "{s} {t}");
    }
    pg.shutdown();
    a.batch_execute(r#"DROP SCHEMA "pt det""x" CASCADE; DROP SCHEMA pt_other CASCADE;"#).await.unwrap();
}

/// 정의(DDL) 읽기(10-13) — 종류마다 실제로 뽑아 본다: 테이블(재구성 — identity · 생성 열 · 콜레이션 · 제약 · 인덱스 · 분할 키 ·
/// 파티션 · UNLOGGED · 외부 테이블) · 뷰 · 구체화 뷰 · 함수(겹지정) · 프로시저 · 집계 · 트리거 · 인덱스 · 제약 · 시퀀스(OWNED BY) ·
/// 형(열거 · 도메인 · 범위 · 복합) — 따옴표 · 공백 든 이름 · 주입 모양 이름 · 권한 없는 계정. 재구성한 테이블은 **다른 스키마에서 다시
/// 돌려** 같은 구조가 서는지 본다. 한 READ ONLY 트랜잭션이라 풀러(`_POOLER`) 뒤에서도 같은 답이어야 한다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_URL 이 있을 때만 — 실제 PostgreSQL"]
async fn pg_definitions() {
    let Some(cfg) = admin_config() else {
        eprintln!("AYNX_TEST_PG_URL 없음 — 건너뜀");
        return;
    };
    let su = cfg.get_user().unwrap().to_string();
    let su_pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let a = admin().await;
    a.batch_execute(
        r#"DROP SCHEMA IF EXISTS "pt def""x" CASCADE; DROP SCHEMA IF EXISTS pt_def_copy CASCADE;
         CREATE SCHEMA "pt def""x"; SET search_path = "pt def""x";
         CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA public;
         DROP SERVER IF EXISTS pt_srv CASCADE;
         CREATE SERVER pt_srv FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'localhost', dbname 'x');
         CREATE TYPE "my enum" AS ENUM ('a', 'b''c');
         CREATE DOMAIN pos_int AS integer DEFAULT 1 NOT NULL CONSTRAINT pos CHECK (VALUE > 0);
         CREATE TYPE fr AS RANGE (subtype = float8, subtype_diff = float8mi);
         CREATE TYPE comp AS (a integer, "b c" text);
         CREATE TABLE "cust omer"(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, region text COLLATE "C" NOT NULL DEFAULT 'kr',
           code text, twice int GENERATED ALWAYS AS (id * 2) STORED, UNIQUE (region, code), CONSTRAINT chk_code CHECK (code <> ''));
         CREATE UNLOGGED TABLE "or""ders"(id int PRIMARY KEY, cust int REFERENCES "cust omer" ON DELETE CASCADE, qty int,
           kind "my enum", CONSTRAINT qty_pos CHECK (qty > 0)) WITH (fillfactor = 80);
         CREATE INDEX "o idx" ON "or""ders"(cust, qty DESC) WHERE qty > 10;
         CREATE SEQUENCE "s q" START 5 INCREMENT 2 OWNED BY "or""ders".qty;
         CREATE TABLE logs(at date NOT NULL, msg text) PARTITION BY RANGE (at);
         CREATE TABLE logs_2026 PARTITION OF logs FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') PARTITION BY LIST (msg);
         CREATE FOREIGN TABLE ft(a int, b text) SERVER pt_srv OPTIONS (table_name 'remote t');
         CREATE FUNCTION f(a int) RETURNS int LANGUAGE sql AS $$ SELECT a + 1 $$;
         CREATE FUNCTION f(a text, b text) RETURNS text LANGUAGE sql AS $$ SELECT a || b $$;
         CREATE PROCEDURE "do it"(x int) LANGUAGE sql AS $$ SELECT x $$;
         CREATE AGGREGATE my_sum(int) (SFUNC = int4pl, STYPE = int, INITCOND = '0');
         CREATE FUNCTION trg_fn() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
         CREATE TRIGGER "o trg" BEFORE INSERT ON "or""ders" FOR EACH ROW EXECUTE FUNCTION trg_fn();
         CREATE VIEW ov WITH (security_barrier) AS SELECT id, qty FROM "or""ders" WHERE qty > 0;
         CREATE MATERIALIZED VIEW mv AS SELECT id FROM "cust omer" WITH NO DATA;
         CREATE UNIQUE INDEX mv_id ON mv(id);
         DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pt_nobody') THEN CREATE ROLE pt_nobody LOGIN PASSWORD 'nobodypw'; END IF; END $$;
         RESET search_path;"#,
    )
    .await
    .unwrap();
    let pg = Pg::connect("pt-def", engine_target(&cfg, &su), secrets(Some(&su_pw))).await.expect("엔진 연결");
    let schema = "pt def\"x";
    let target = |kind: &str, name: &str, table: Option<&str>, args: Option<&str>| super::definition::DefTarget {
        schema: Some(schema.into()),
        kind: kind.into(),
        name: name.into(),
        table: table.map(str::to_string),
        args: args.map(str::to_string),
    };
    let def = |kind: &'static str, name: &'static str, table: Option<&'static str>, args: Option<&'static str>| {
        let (pg, t) = (&pg, target(kind, name, table, args));
        async move { pg.definition(&t, 5000).await }
    };
    // 풀러면 트랜잭션마다 백엔드가 바뀔 수 있다 — 같은 답이 거듭 서야 한다.
    let mut first: Option<Value> = None;
    for _ in 0..6 {
        let d = def("table", "cust omer", None, None).await.unwrap();
        if let Some(f) = &first {
            assert_eq!(f, &d);
        }
        first = Some(d);
    }
    let cust = first.unwrap();
    let sql = |v: &Value| v["sql"].as_str().unwrap().to_string();
    println!("MEASURE pg def table cust omer:\n{}", sql(&cust));
    assert_eq!((cust["reconstructed"].as_bool(), cust["truncated"].as_bool()), (Some(true), Some(false)));
    let c = sql(&cust);
    for want in [
        "CREATE TABLE \"pt def\"\"x\".\"cust omer\" (",
        "id integer GENERATED ALWAYS AS IDENTITY NOT NULL",
        "region text COLLATE pg_catalog.\"C\" DEFAULT 'kr'::text NOT NULL",
        "twice integer GENERATED ALWAYS AS ((id * 2)) STORED",
        "CONSTRAINT \"cust omer_pkey\" PRIMARY KEY (id)",
        "CONSTRAINT \"cust omer_region_code_key\" UNIQUE (region, code)",
        "CONSTRAINT chk_code CHECK (code <> ''::text)",
    ] {
        assert!(c.contains(want), "{want}\n{c}");
    }
    let o = sql(&def("table", "or\"ders", None, None).await.unwrap());
    println!("MEASURE pg def table or\"ders:\n{o}");
    for want in [
        "CREATE UNLOGGED TABLE \"pt def\"\"x\".\"or\"\"ders\" (",
        "kind \"pt def\"\"x\".\"my enum\"",
        "FOREIGN KEY (cust) REFERENCES \"pt def\"\"x\".\"cust omer\"(id) ON DELETE CASCADE",
        "WITH (fillfactor=80);",
        "CREATE INDEX \"o idx\" ON \"pt def\"\"x\".\"or\"\"ders\" USING btree (cust, qty DESC) WHERE (qty > 10);",
    ] {
        assert!(o.contains(want), "{want}\n{o}");
    }
    let logs = sql(&def("table", "logs", None, None).await.unwrap());
    assert!(logs.ends_with("PARTITION BY RANGE (at);"), "{logs}");
    let part = sql(&def("table", "logs_2026", None, None).await.unwrap());
    println!("MEASURE pg def partition:\n{part}");
    assert_eq!(
        part,
        "CREATE TABLE \"pt def\"\"x\".logs_2026 PARTITION OF \"pt def\"\"x\".logs\nFOR VALUES FROM ('2026-01-01') TO ('2027-01-01')\nPARTITION BY LIST (msg);"
    );
    let ft = sql(&def("foreign", "ft", None, None).await.unwrap());
    println!("MEASURE pg def foreign:\n{ft}");
    assert!(ft.starts_with("CREATE FOREIGN TABLE") && ft.contains("SERVER pt_srv") && ft.contains("OPTIONS (table_name 'remote t')"), "{ft}");
    // 재구성한 테이블을 다른 스키마에서 다시 돌려 본다 — 같은 제약 수.
    a.batch_execute("CREATE SCHEMA pt_def_copy").await.unwrap();
    let copy = c.replace("\"pt def\"\"x\".\"cust omer\"", "pt_def_copy.\"cust omer\"");
    a.batch_execute(&copy).await.unwrap_or_else(|e| panic!("재구성 글자가 돌지 않는다: {e:?}\n{copy}"));
    let n: i64 = a
        .query_one(
            "SELECT count(*) FROM pg_constraint WHERE conrelid = 'pt_def_copy.\"cust omer\"'::regclass AND contype IN ('p','u','c')",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(n, 3);
    // 뷰 · 구체화 뷰 — 원문(머리만 앱).
    let v = def("view", "ov", None, None).await.unwrap();
    println!("MEASURE pg def view:\n{}", sql(&v));
    assert_eq!(v["reconstructed"], false);
    assert!(sql(&v).starts_with("CREATE OR REPLACE VIEW \"pt def\"\"x\".ov WITH (security_barrier=true) AS\n SELECT id,"), "{v}");
    let m = sql(&def("matview", "mv", None, None).await.unwrap());
    assert!(m.contains("WITH NO DATA;") && m.contains("CREATE UNIQUE INDEX mv_id"), "{m}");
    // 함수 — 겹지정은 인자로, 인자가 없으면 첫 겹지정.
    let f1 = sql(&def("function", "f", None, Some("a integer")).await.unwrap());
    let f2 = sql(&def("function", "f", None, Some("a text, b text")).await.unwrap());
    assert!(f1.contains("f(a integer)") && f1.contains("a + 1"), "{f1}");
    assert!(f2.contains("f(a text, b text)") && f2.contains("a || b"), "{f2}");
    assert!(def("function", "f", None, None).await.is_ok());
    assert!(def("function", "f", None, Some("a bigint")).await.is_err(), "없는 겹지정");
    let p = sql(&def("procedure", "do it", None, Some("IN x integer")).await.unwrap());
    assert!(p.starts_with("CREATE OR REPLACE PROCEDURE \"pt def\"\"x\".\"do it\"(IN x integer)"), "{p}");
    let ag = def("function", "my_sum", None, Some("integer")).await.unwrap();
    println!("MEASURE pg def aggregate:\n{}", sql(&ag));
    assert_eq!(ag["reconstructed"], true);
    assert!(sql(&ag).contains("SFUNC = int4pl") && sql(&ag).contains("INITCOND = '0'"), "{ag}");
    // 트리거 · 인덱스 · 제약.
    let tr = sql(&def("trigger", "o trg", Some("or\"ders"), None).await.unwrap());
    assert!(tr.starts_with("CREATE TRIGGER \"o trg\" BEFORE INSERT ON \"pt def\"\"x\".\"or\"\"ders\"") && tr.ends_with(';'), "{tr}");
    assert!(def("trigger", "o trg", Some("cust omer"), None).await.is_err(), "다른 테이블의 트리거 이름");
    let ix = sql(&def("index", "o idx", None, None).await.unwrap());
    assert!(ix.starts_with("CREATE INDEX \"o idx\"") && ix.ends_with("WHERE (qty > 10);"), "{ix}");
    let co = sql(&def("constraint", "qty_pos", Some("or\"ders"), None).await.unwrap());
    assert_eq!(co, "ALTER TABLE \"pt def\"\"x\".\"or\"\"ders\"\n    ADD CONSTRAINT qty_pos CHECK (qty > 0);");
    let fk = sql(&def("constraint", "or\"ders_cust_fkey", Some("or\"ders"), None).await.unwrap());
    assert!(fk.contains("FOREIGN KEY (cust) REFERENCES"), "{fk}");
    // 시퀀스 · 형.
    let sq = sql(&def("sequence", "s q", None, None).await.unwrap());
    println!("MEASURE pg def sequence:\n{sq}");
    assert!(sq.contains("START WITH 5") && sq.contains("INCREMENT BY 2") && sq.contains("OWNED BY \"pt def\"\"x\".\"or\"\"ders\".qty;"), "{sq}");
    let id_seq = sql(&def("sequence", "cust omer_id_seq", None, None).await.unwrap());
    assert!(id_seq.contains("-- identity: \"pt def\"\"x\".\"cust omer\".id"), "{id_seq}");
    assert_eq!(sql(&def("type", "my enum", None, None).await.unwrap()), "CREATE TYPE \"pt def\"\"x\".\"my enum\" AS ENUM (\n    'a',\n    'b''c'\n);");
    let dm = sql(&def("type", "pos_int", None, None).await.unwrap());
    assert_eq!(dm, "CREATE DOMAIN \"pt def\"\"x\".pos_int AS integer\n    DEFAULT 1\n    NOT NULL\n    CONSTRAINT pos CHECK (VALUE > 0);");
    let rg = sql(&def("type", "fr", None, None).await.unwrap());
    assert!(rg.contains("SUBTYPE = double precision") && rg.contains("SUBTYPE_DIFF = float8mi"), "{rg}");
    assert_eq!(sql(&def("type", "comp", None, None).await.unwrap()), "CREATE TYPE \"pt def\"\"x\".comp AS (\n    a integer,\n    \"b c\" text\n);");
    // 이름은 바인드 인자 — 주입 모양도 그냥 없는 객체다.
    for (k, n) in [("table", "nope"), ("table", "x\"; DROP TABLE t; --"), ("view", "cust omer"), ("index", "' OR '1'='1")] {
        let e = emsg(&pg.definition(&target(k, n, None, None), 5000).await.unwrap_err());
        assert!(e.contains(n), "{k} {n}: {e}");
    }
    let wrong_schema = super::definition::DefTarget { schema: Some("public' OR '1'='1".into()), ..target("table", "cust omer", None, None) };
    assert!(pg.definition(&wrong_schema, 5000).await.is_err());
    // 권한 없는 계정(직결 — 풀러의 사용자 목록에 없다) — PG 카탈로그 · pg_get_*def 는 누구에게나 열려 있다(실측 기록).
    let nobody = Pg::connect("pt-def-nobody", direct_target(&cfg, "pt_nobody"), secrets(Some("nobodypw"))).await.expect("nobody");
    for (k, n, t) in [("table", "cust omer", None), ("view", "ov", None), ("function", "trg_fn", None), ("trigger", "o trg", Some("or\"ders"))] {
        let r = nobody.definition(&target(k, n, t, None), 5000).await;
        println!("MEASURE pg def pt_nobody {k} {n}: {}", r.as_ref().map(|v| format!("ok {} B", sql(v).len())).unwrap_or_else(emsg));
    }
    nobody.shutdown();
    pg.shutdown();
    a.batch_execute(r#"DROP SCHEMA "pt def""x" CASCADE; DROP SCHEMA pt_def_copy CASCADE; DROP SERVER pt_srv CASCADE; DROP ROLE pt_nobody;"#)
        .await
        .unwrap();
}

fn ssh_env() -> Option<(AdhocTarget, String, String, u16)> {
    let s = env("AYNX_TEST_PG_SSH")?;
    let (cred, addr) = s.rsplit_once('@')?;
    let (user, pw) = cred.split_once(':')?;
    let (host, port) = addr.rsplit_once(':')?;
    let (th, tp) = env("AYNX_TEST_PG_SSH_TARGET")?.rsplit_once(':').map(|(h, p)| (h.to_string(), p.to_string()))?;
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

/// 프런트 `runSshGates` 와 같은 고리 — 호스트 키는 이번만(known_hosts 를 안 건드림) · 잠긴 키는 빼고 · 비밀번호는 몸으로.
/// `db_pw` 는 `[db-password]` 를 만나면 실을 DB 비밀번호. 돌려주는 것은 연결 + 지나간 관문 이름들.
async fn connect_with_gates(stream: &str, target: &NetTarget, ssh_pw: &str, db_pw: Option<&str>) -> (Result<Pg, String>, Vec<String>) {
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
        match Pg::connect(stream, target.clone(), s).await {
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
                // 비밀번호를 묻는 동안 전송로는 세워 둔다 — 다음 시도는 SSH 관문을 다시 지나지 않아야 한다.
                decision = None;
                give_ssh_pw = false;
            }
            Err(OpenError::Ssh(e)) => return (Err(format!("ssh {e:?}")), seen),
            Err(OpenError::Msg(m)) => return (Err(m), seen),
        }
    }
    (Err("관문 고리가 끝나지 않음".into()), seen)
}

/// SSH 경유 — 관문(호스트 키·SSH 비밀번호) → 터널 → PG 왕복 · 비밀번호를 묻는 동안 전송로 세워 두기 · 터널 위 취소 · 행 상한 ·
/// 읽기 전용 · 닫기 · 전송로 사망 → [db-disconnected].
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_PG_SSH · _TARGET 이 있을 때만 — 임시 sshd + PostgreSQL"]
async fn pg_over_ssh_tunnel() {
    let (Some((adhoc, ssh_pw, th, tp)), Some(cfg)) = (ssh_env(), admin_config()) else {
        eprintln!("AYNX_TEST_PG_SSH · _TARGET · _URL 없음 — 건너뜀");
        return;
    };
    let su = cfg.get_user().unwrap().to_string();
    let su_pw = String::from_utf8(cfg.get_password().unwrap().to_vec()).unwrap();
    let alias = format!("{}@{}:{}", adhoc.user.clone().unwrap_or_default(), adhoc.host, adhoc.port.unwrap_or(22));
    let target = NetTarget {
        id: "Test7_pg-tunnel".into(),
        host: th,
        port: tp,
        database: cfg.get_dbname().map(str::to_string),
        user: Some(su),
        tls: DbTlsMode::Prefer,
        tls_ca: None,
        via: Some(alias),
        adhoc: Some(adhoc),
    };
    let started = Instant::now();
    let (pg, seen) = connect_with_gates("pt-ssh-1", &target, &ssh_pw, Some(&su_pw)).await;
    let pg = pg.unwrap_or_else(|m| panic!("{m} (관문 {seen:?})"));
    println!("MEASURE ssh-gates: {seen:?} ({} ms)", started.elapsed().as_millis());
    assert!(seen.contains(&"ssh_password".to_string()), "{seen:?}");
    // db_password 다음에 SSH 관문이 다시 오지 않았다 = 세워 둔 전송로를 썼다.
    if let Some(i) = seen.iter().position(|s| s == "db_password") {
        assert!(seen[i + 1..].is_empty(), "비밀번호 뒤에 SSH 관문이 또 왔다: {seen:?}");
    }
    let r = pg.query("SELECT current_user, inet_server_port(), version() LIKE 'PostgreSQL 16%'", 10, 5000).await.unwrap();
    println!("MEASURE ssh-roundtrip: {}", json!(r.rows));
    assert_eq!(cell(&r, 0, 2), json!(true));

    let r = pg.query("SELECT g FROM generate_series(1, 20000) g", 1000, 10_000).await.unwrap();
    assert_eq!((r.rows.len(), r.truncated), (1000, true));

    // 취소 — 취소 요청이 새 TCP 로 터널(127.0.0.1:<임시>)을 다시 지난다.
    let pg = std::sync::Arc::new(pg);
    let p2 = std::sync::Arc::clone(&pg);
    let started = Instant::now();
    let h = tokio::spawn(async move { p2.query("SELECT pg_sleep(10)", 10, 60_000).await });
    tokio::time::sleep(Duration::from_millis(400)).await;
    pg.interrupt();
    let e = h.await.unwrap().unwrap_err();
    println!("MEASURE cancel-ssh: {} ({} ms)", emsg(&e), started.elapsed().as_millis());
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    assert!(started.elapsed() < Duration::from_secs(3));
    // 시간 제한.
    let e = pg.query("SELECT pg_sleep(5)", 10, 300).await.unwrap_err();
    assert!(matches!(e, EngineError::Interrupted), "{}", emsg(&e));
    // 읽기 전용.
    let m = emsg(&pg.query("WITH x AS (DELETE FROM pg_class WHERE false RETURNING *) SELECT * FROM x", 10, 5000).await.unwrap_err());
    assert!(m.contains("25006"), "{m}");
    // 같은 호스트에 둘째 연결 — 따뜻한 전송로에 얹힌다(관문 없음).
    let (second, seen2) = connect_with_gates("pt-ssh-2", &target, &ssh_pw, Some(&su_pw)).await;
    let second = second.unwrap_or_else(|m| panic!("{m}"));
    assert!(!seen2.iter().any(|s| s == "ssh_password" || s == "host_key"), "따뜻한 길인데 관문: {seen2:?}");
    // 첫 연결을 닫아도 둘째는 산다(전송로 자리는 하나씩).
    pg.shutdown();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(cell(&second.query("SELECT 7", 10, 5000).await.unwrap(), 0, 0), json!(7));

    // 전송로 사망 — sshd 를 다시 띄우면 전송로·터널 위 PG 연결이 끊긴다 → [db-disconnected].
    if let Some(name) = env("AYNX_TEST_PG_SSH_CONTAINER") {
        let st = std::process::Command::new("docker").args(["restart", "-t", "0", &name]).status().unwrap();
        assert!(st.success());
        let deadline = Instant::now() + Duration::from_secs(20);
        while !second.is_dead() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(second.is_dead(), "전송로가 죽었는데 연결이 산 것으로 남았다");
        let m = emsg(&second.query("SELECT 1", 10, 1000).await.unwrap_err());
        assert!(m.contains("[db-disconnected]"), "{m}");
        println!("MEASURE ssh-death: {}", one_line(&m));
    }
    second.shutdown();
}
