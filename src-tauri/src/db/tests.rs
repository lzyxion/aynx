//! 쿼리 타일 5·7단계 — 가드(문장 경계·따옴표·주석·$$·거절 목록) · 값 매핑(SQLite · PG 바이너리) · SQLite 엔진 · PG 설정 · DB 연결 목록.
//! 서버 op 를 지나는 통합 시험은 `server/tests.rs` 의 `db_plane_opens_queries_reattaches_and_refuses_stale_leases`.

use std::path::PathBuf;

use serde_json::json;

use super::guard::{check, GuardError};
use super::conns::{self, DbConn};
use super::sqlite::Sqlite;
use super::value::{self, Cell, CELL_MAX};
use super::{clamp_limits, Dialect, EngineError};
use crate::db::conns::{DbEngine, DbTlsMode};

const ALL: [Dialect; 3] = [Dialect::Sqlite, Dialect::Postgres, Dialect::Mysql];

fn one(sql: &str, d: Dialect) -> String {
    check(sql, d, true).unwrap_or_else(|e| panic!("{sql:?} ({d:?}) 거절: {e:?}")).sql.to_string()
}

fn err(sql: &str, d: Dialect, writable: bool) -> GuardError {
    match check(sql, d, writable) {
        Ok(c) => panic!("{sql:?} ({d:?}) 통과: {c:?}"),
        Err(e) => e,
    }
}

// ── 가드: 문장 경계 ──

#[test]
fn guard_accepts_one_statement_with_trailing_semicolons_and_comments() {
    for d in ALL {
        assert_eq!(one("SELECT 1", d), "SELECT 1");
        assert_eq!(one("  SELECT 1 ;  ", d), "SELECT 1");
        assert_eq!(one("SELECT 1;;", d), "SELECT 1");
        assert_eq!(one("SELECT 1; -- 끝\n", d), "SELECT 1");
        assert_eq!(one("/* 머리 */ SELECT 1 /* 꼬리 */;", d), "SELECT 1");
        assert_eq!(one("SELECT 1 -- 꼬리 주석만", d), "SELECT 1");
        assert_eq!(one("SELECT /* 안 */ 1", d), "SELECT /* 안 */ 1", "안의 주석은 그대로");
    }
}

#[test]
fn guard_refuses_multiple_and_empty() {
    for d in ALL {
        assert_eq!(err("SELECT 1; SELECT 2", d, true), GuardError::Multiple);
        assert_eq!(err("SELECT 1;\nDELETE FROM t;", d, true), GuardError::Multiple);
        assert_eq!(err("", d, true), GuardError::Empty);
        assert_eq!(err("  ;; -- 아무것도\n", d, true), GuardError::Empty);
        assert_eq!(err("/* 주석뿐 */", d, true), GuardError::Empty);
    }
}

#[test]
fn guard_ignores_semicolons_inside_quotes_and_comments() {
    for d in ALL {
        assert_eq!(one("SELECT 'a;b'", d), "SELECT 'a;b'");
        assert_eq!(one("SELECT 'it''s; ok'", d), "SELECT 'it''s; ok'");
        assert_eq!(one("SELECT \"a;b\" FROM t", d), "SELECT \"a;b\" FROM t");
        assert_eq!(one("SELECT 1 -- ;\n + 1", d), "SELECT 1 -- ;\n + 1");
        assert_eq!(one("SELECT 1 /* ; */ + 1", d), "SELECT 1 /* ; */ + 1");
        assert_eq!(one("SELECT '한글;값'", d), "SELECT '한글;값'");
    }
    assert_eq!(one("SELECT `a;b` FROM t", Dialect::Mysql), "SELECT `a;b` FROM t");
    assert_eq!(one("SELECT `a;b` FROM t", Dialect::Sqlite), "SELECT `a;b` FROM t");
    assert_eq!(one("SELECT [a;b] FROM t", Dialect::Sqlite), "SELECT [a;b] FROM t");
    // MySQL `#` 줄 주석.
    assert_eq!(one("SELECT 1 # ; 주석\n", Dialect::Mysql), "SELECT 1");
}

#[test]
fn guard_understands_postgres_dollar_quotes_nested_comments_and_e_strings() {
    let pg = Dialect::Postgres;
    assert_eq!(one("SELECT $$a;b$$", pg), "SELECT $$a;b$$");
    assert_eq!(one("DO $body$ BEGIN PERFORM 1; END $body$", pg), "DO $body$ BEGIN PERFORM 1; END $body$");
    assert_eq!(one("SELECT $x$ $$ ; $x$", pg), "SELECT $x$ $$ ; $x$", "다른 태그의 $$ 는 안의 글자");
    // `$1` 은 매개변수(태그가 숫자로 시작할 수 없다) — 그 뒤의 `;` 는 문장 끝.
    assert_eq!(err("SELECT $1; SELECT 2", pg, true), GuardError::Multiple);
    // 식별자 안의 `$` 는 따옴표가 아니다.
    assert_eq!(err("SELECT a$b$; DROP TABLE t; --$b$", pg, true), GuardError::Multiple);
    // 블록 주석은 중첩된다.
    assert_eq!(one("/* 바깥 /* 안 ; */ 아직 주석 ; */ SELECT 1", pg), "SELECT 1");
    // E'…' 는 늘 백슬래시 — `\'` 가 끝이 아니다.
    assert_eq!(one(r"SELECT E'a\';b'", pg), r"SELECT E'a\';b'");
    // 표준 문자열의 `\` 는 글자 — 한 해석에서 리터럴이 안 끝나도 다른 해석이 하나로 보면 받는다.
    assert_eq!(one(r"SELECT 'C:\'", pg), r"SELECT 'C:\'");
    assert!(err("SELECT $$ 끝나지 않음", pg, true) == GuardError::Unterminated);
}

/// 서버 설정에 따라 갈리는 백슬래시 — **어느 해석에서든** 문장이 둘로 보이면 거절한다.
#[test]
fn guard_refuses_when_any_backslash_reading_sees_two_statements() {
    // standard_conforming_strings=on 이면 'a\' 에서 끝나고 DROP 이 둘째 문장.
    assert_eq!(err(r"SELECT 'a\'; DROP TABLE t; -- '", Dialect::Postgres, true), GuardError::Multiple);
    // MySQL NO_BACKSLASH_ESCAPES 도 마찬가지.
    assert_eq!(err(r"SELECT 'a\'; DROP TABLE t; -- '", Dialect::Mysql, true), GuardError::Multiple);
    // SQLite 는 백슬래시 이스케이프가 없다 — 하나의 해석.
    assert_eq!(err(r"SELECT 'a\'; DROP TABLE t; -- '", Dialect::Sqlite, true), GuardError::Multiple);
    assert_eq!(one(r"SELECT 'a\\b'", Dialect::Mysql), r"SELECT 'a\\b'");
}

#[test]
fn guard_follows_mysql_comment_rules() {
    let my = Dialect::Mysql;
    // `--` 뒤에 공백이 없으면 주석이 아니다(빼기 둘) — 그 뒤 `;` 는 문장 끝.
    assert_eq!(err("SELECT 1 --1; DROP TABLE t", my, true), GuardError::Multiple);
    assert_eq!(one("SELECT 1 -- ; 주석", my), "SELECT 1");
    // 실행 주석은 받지 않는다(서버가 안을 SQL 로 돈다).
    assert_eq!(err("/*! COMMIT */ SELECT 1", my, true), GuardError::ExecutableComment);
    assert_eq!(err("SELECT 1 /*M!100000 ; */", my, true), GuardError::ExecutableComment);
    // 다른 방언에서는 그냥 주석.
    assert_eq!(one("/*! x */ SELECT 1", Dialect::Postgres), "SELECT 1");
    // 최적화 힌트(/*+ */)는 보통 주석.
    assert_eq!(one("SELECT /*+ MAX_EXECUTION_TIME(1) */ 1", my), "SELECT /*+ MAX_EXECUTION_TIME(1) */ 1");
}

#[test]
fn guard_reports_unterminated_literals() {
    for d in ALL {
        assert_eq!(err("SELECT 'abc", d, true), GuardError::Unterminated);
        assert_eq!(err("SELECT \"abc", d, true), GuardError::Unterminated);
    }
    assert_eq!(err("SELECT [abc", Dialect::Sqlite, true), GuardError::Unterminated);
    // 끝나지 않은 리터럴 앞에 `;` 가 있으면 다중 문장이다(첫 문장은 실행될 수 있다).
    assert_eq!(err("SELECT 1; SELECT 'abc", Dialect::Mysql, true), GuardError::Multiple);
}

// ── 가드: 읽기 전용 첫 낱말 허용 목록 ──

fn is_read_only(e: &GuardError) -> bool {
    matches!(e, GuardError::ReadOnly { .. })
}

#[test]
fn guard_read_only_refuses_everything_outside_the_first_word_allow_list() {
    // 엔진마다 같은 거절 표 — 트랜잭션·세션·DDL·DML·권한·서버 일·통계(ANALYZE)·ATTACH.
    let refused = [
        "SET x = 1", "COMMIT", "BEGIN", "CREATE TABLE z(a int)", "DROP TABLE t", "GRANT ALL ON t TO u",
        "INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t", "COPY t TO STDOUT", "CALL p()",
        "DO $$ BEGIN END $$", "LOCK TABLE t", "ANALYZE", "ATTACH 'x.db' AS x",
    ];
    for d in ALL {
        for sql in refused {
            // `DO $$…$$` 는 PG 만 한 문장으로 보인다(다른 렉서는 `$$` 를 모른다) — 그래도 다들 첫 낱말에서 거절.
            assert!(is_read_only(&err(sql, d, false)), "{sql} ({d:?})");
        }
    }
    // 쓰기 모드는 첫 낱말을 보지 않는다.
    for d in ALL {
        check("CREATE TABLE z(a int)", d, true).unwrap_or_else(|e| panic!("쓰기 모드는 통과해야 ({d:?}): {e:?}"));
        check("ANALYZE", d, true).unwrap();
    }
    // 쓰기 모드의 트랜잭션 문장은 세 방언 모두 거절 — 자세한 표는 `guard_write_mode_refuses_transaction_control_in_all_dialects`.
    for d in ALL {
        assert_eq!(err("BEGIN", d, true), GuardError::Transaction { dialect: d });
    }
    check("SELECT 'BEGIN'", Dialect::Postgres, true).unwrap();
    // 엔진별 허용 목록 — 통과.
    let pg = ["SELECT 1", "WITH x AS (SELECT 1) SELECT * FROM x", "VALUES (1)", "TABLE t", "EXPLAIN SELECT 1", "SHOW search_path"];
    let my = ["SELECT 1", "WITH x AS (SELECT 1) SELECT * FROM x", "VALUES ROW(1)", "TABLE t", "EXPLAIN SELECT 1", "SHOW TABLES", "DESCRIBE t", "DESC t"];
    let lite = ["SELECT 1", "WITH x AS (SELECT 1) SELECT * FROM x", "VALUES (1)", "EXPLAIN SELECT 1", "EXPLAIN QUERY PLAN SELECT 1", "PRAGMA user_version"];
    for (d, sqls) in [(Dialect::Postgres, &pg[..]), (Dialect::Mysql, &my[..]), (Dialect::Sqlite, &lite[..])] {
        for sql in sqls {
            check(sql, d, false).unwrap_or_else(|e| panic!("{sql} ({d:?}): {e:?}"));
        }
    }
    // 목록은 엔진마다 다르다 — PG 의 DESCRIBE, SQLite 의 TABLE·SHOW 는 거절.
    assert!(is_read_only(&err("DESCRIBE t", Dialect::Postgres, false)));
    assert!(is_read_only(&err("TABLE t", Dialect::Sqlite, false)));
    assert!(is_read_only(&err("SHOW x", Dialect::Sqlite, false)));
    assert!(is_read_only(&err("PRAGMA x", Dialect::Postgres, false)));
    // 앞 공백·주석·여는 괄호를 건너뛰고, 대소문자는 가리지 않는다.
    for d in ALL {
        let c = check("  /*c*/ (SELECT 1)", d, false).unwrap_or_else(|e| panic!("{d:?}: {e:?}"));
        assert_eq!((c.keyword.as_str(), c.sql), ("SELECT", "(SELECT 1)"));
        assert_eq!(check("-- c\n ( ( select 1 ) )", d, false).unwrap().keyword, "SELECT");
        assert_eq!(check("sElEcT 1", d, false).unwrap().keyword, "SELECT");
        assert_eq!(check("with x as (select 1) select * from x", d, false).unwrap().keyword, "WITH");
        assert!(is_read_only(&err("( /* x */ delete FROM t)", d, false)), "{d:?}");
        assert!(is_read_only(&err("/* x */ commit", d, false)));
        // 낱말이 아닌 것으로 시작하면 거절(빈 첫 낱말).
        assert!(is_read_only(&err("'x'", d, false)));
    }
    assert_eq!(
        err("/* x */ commit", Dialect::Sqlite, false),
        GuardError::ReadOnly { keyword: "COMMIT".into(), dialect: Dialect::Sqlite }
    );
}

#[test]
fn guard_read_only_sqlite_pragma_shapes() {
    let s = Dialect::Sqlite;
    // 읽기 꼴 — 인자 없는 조회 · 조회 대상을 인자로 받는 함수 꼴(허용 목록).
    for ok in ["PRAGMA user_version", "pragma Journal_Mode", "PRAGMA table_info(t)", "pragma main.table_info('t')", "PRAGMA index_list(t)", "PRAGMA query_only", "PRAGMA integrity_check", "PRAGMA quick_check(10)"] {
        check(ok, s, false).unwrap_or_else(|e| panic!("{ok}: {e:?}"));
    }
    // 쓰기 꼴 — 값을 주는 `=`·`(값)` · 일을 하는 pragma · 이름 없음.
    for bad in ["PRAGMA query_only = 0", "PRAGMA query_only(0)", "PRAGMA main.journal_mode=WAL", "PRAGMA user_version(5)", "PRAGMA optimize", "PRAGMA wal_checkpoint", "PRAGMA main.wal_checkpoint(TRUNCATE)", "PRAGMA writable_schema(1)", "PRAGMA", "(PRAGMA user_version)"] {
        assert!(is_read_only(&err(bad, s, false)), "{bad}");
    }
    // 쓰기 모드에서는 PRAGMA 꼴도 보지 않는다.
    check("PRAGMA user_version = 5", s, true).unwrap();
}

#[test]
fn guard_read_only_refuses_mysql_into_outfile_and_dumpfile() {
    let my = Dialect::Mysql;
    // 절 — 대소문자 · 줄바꿈 · 사이의 주석 · 문장 중간(MySQL 8 은 `FROM` 뒤 · 옛 꼴은 `FROM` 앞) · 괄호 안.
    for bad in [
        "SELECT * FROM t INTO OUTFILE '/tmp/x'",
        "select * into outfile '/tmp/x' from t",
        "SELECT 1 INTO\n  DumpFile '/tmp/x'",
        "SELECT 1 INTO /* c */ OUTFILE '/tmp/x'",
        "SELECT 1 INTO -- c\n OUTFILE '/tmp/x'",
        "SELECT 1 INTO # c\n DUMPFILE '/tmp/x'",
        "WITH x AS (SELECT 1) SELECT * FROM x INTO OUTFILE '/tmp/x'",
        "(SELECT 1 INTO OUTFILE '/tmp/x')",
        "TABLE t INTO OUTFILE '/tmp/x'",
    ] {
        assert_eq!(err(bad, my, false), GuardError::IntoFile, "{bad}");
    }
    // 따옴표 · 식별자 인용 · 주석 안의 글자는 절이 아니다 · `INTO @변수`(세션 변수)는 받는다 · 낱말 일부도 아니다.
    for ok in [
        "SELECT 'INTO OUTFILE'",
        "SELECT \"INTO OUTFILE\"",
        "SELECT 1 AS `INTO OUTFILE`",
        "SELECT 1 /* INTO OUTFILE '/tmp/x' */",
        "SELECT 1 -- INTO OUTFILE '/tmp/x'",
        "SELECT 1 # INTO DUMPFILE",
        "SELECT 1 INTO @v",
        "SELECT a, b INTO @a, @b FROM t",
        "SELECT 1 AS outfile",
        "SELECT xinto outfile FROM t",
        r"SELECT 'a\' INTO OUTFILE'",
    ] {
        check(ok, my, false).unwrap_or_else(|e| panic!("{ok}: {e:?}"));
    }
    // 실행 주석 안은 주석째 거절(서버가 안을 돈다 — 기존 원칙).
    assert_eq!(err("SELECT 1 /*! INTO OUTFILE '/tmp/x' */", my, false), GuardError::ExecutableComment);
    // 백슬래시 해석 하나에서만 보이는 절도 거절 쪽 — NO_BACKSLASH_ESCAPES 서버에서는 `'a\'` 가 끝나고 절이 선다.
    assert_eq!(err(r"SELECT 'a\' INTO OUTFILE '/tmp/x'", my, false), GuardError::IntoFile);
    // 쓰기 모드는 보지 않는다 · 다른 방언은 이 절이 없다(PG 는 첫 낱말 허용 목록이 COPY 를 막는다).
    check("SELECT 1 INTO OUTFILE '/tmp/x'", my, true).unwrap();
    check("SELECT 1 INTO OUTFILE", Dialect::Postgres, false).unwrap();
    assert!(!GuardError::IntoFile.message().contains('\n'));
}

// ── 가드: 쓰기 모드의 트랜잭션 · 세션 잠금 거절(10-13 결정 0단계) ──

#[test]
fn guard_write_mode_refuses_transaction_control_in_all_dialects() {
    let tx = |d| GuardError::Transaction { dialect: d };
    // 세 방언 공통 — 대소문자 · 앞 주석 · 꼬리 세미콜론 · 줄바꿈 · 둘째 낱말 사이 주석.
    let common = [
        "BEGIN", "begin;", "/* c */ Begin", "-- c\nBEGIN", "BEGIN TRANSACTION", "START TRANSACTION", "start /* x */ transaction",
        "START\n  TRANSACTION READ WRITE", "COMMIT", "commit work", "END", "END TRANSACTION", "ROLLBACK", "ROLLBACK TO SAVEPOINT a",
        "ROLLBACK TO a", "ABORT", "SAVEPOINT a", "RELEASE a", "RELEASE SAVEPOINT a",
    ];
    for d in ALL {
        for sql in common {
            assert_eq!(err(sql, d, true), tx(d), "{sql} ({d:?})");
        }
    }
    // SQLite 의 꼴.
    for sql in ["BEGIN DEFERRED", "BEGIN IMMEDIATE TRANSACTION", "begin exclusive", "COMMIT TRANSACTION", "END TRANSACTION", "ROLLBACK TRANSACTION TO SAVEPOINT a"] {
        assert_eq!(err(sql, Dialect::Sqlite, true), tx(Dialect::Sqlite), "{sql}");
    }
    // PG — 2단계 커밋 · 별칭 · 체인.
    let pg = Dialect::Postgres;
    for sql in ["PREPARE TRANSACTION 'g1'", "prepare /* x */ transaction 'g1'", "COMMIT PREPARED 'g1'", "ROLLBACK PREPARED 'g1'", "COMMIT AND CHAIN", "ABORT WORK", "BEGIN ISOLATION LEVEL SERIALIZABLE"] {
        assert_eq!(err(sql, pg, true), tx(pg), "{sql}");
    }
    // 일반 준비 문장 · 실행 · 잠금 · 세션 값은 지금 규칙대로 받는다(엔진이 문장마다 감싼 트랜잭션 끝에 잠금이 풀린다).
    for sql in ["PREPARE p AS SELECT 1", "EXECUTE p", "DEALLOCATE p", "LOCK TABLE t IN ACCESS EXCLUSIVE MODE", "SET search_path = public", "SET autocommit = off"] {
        check(sql, pg, true).unwrap_or_else(|e| panic!("{sql}: {e:?}"));
    }
    // MySQL·MariaDB — XA 전부.
    let my = Dialect::Mysql;
    for sql in ["XA START 'x'", "xa begin 'x'", "XA END 'x'", "XA PREPARE 'x'", "XA COMMIT 'x'", "XA ROLLBACK 'x'", "XA RECOVER", "BEGIN WORK", "BEGIN NOT ATOMIC SELECT 1; END"] {
        assert_eq!(err(sql, my, true), if sql.contains(';') { GuardError::Multiple } else { tx(my) }, "{sql}");
    }
    // `SET … autocommit` — 모든 꼴(대소문자 · 공백 · 주석 · 백틱 · 범위 · 여러 대입 · `:=`).
    for sql in [
        "SET autocommit=0",
        "SET autocommit = 0",
        "set AUTOCOMMIT=OFF",
        "SET SESSION autocommit = 0",
        "SET LOCAL autocommit = 0",
        "SET GLOBAL autocommit = 0",
        "SET PERSIST autocommit = 0",
        "SET @@autocommit = 0",
        "SET @@session.autocommit = 0",
        "SET @@SESSION . autocommit = 0",
        "SET @@local.autocommit=0",
        "SET a = 1, autocommit = 0",
        "SET @x = 1, @@autocommit := 0",
        "SET sql_mode = '', autocommit = 0, @y = 2",
        "SET /* c */ autocommit /* c */ = 0",
        "SET\n  autocommit\n  =\n  0",
        "SET `autocommit` = 0",
        "SET @@`autocommit` = 0",
        "SET @@session.`AutoCommit` = 0",
        "SET autocommit = 0 # 끝",
        "SET STATEMENT autocommit = 0 FOR INSERT INTO t VALUES (1)",
    ] {
        assert_eq!(err(sql, my, true), tx(my), "{sql}");
    }
    // 다른 SET 은 받는다 — 값 자리의 작은따옴표 문자열 · 주석 · 낱말 일부는 `autocommit` 이 아니다.
    for sql in [
        "SET @x = 1",
        "SET SESSION sql_mode = 'ANSI'",
        "SET @note = 'autocommit'",
        "SET @x = 1 /* autocommit */",
        "SET @x = 1 -- autocommit",
        "SET @autocommit_old = 1",
        "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
        "SET NAMES utf8mb4",
        "SELECT @@autocommit",
        "UPDATE t SET autocommit_flag = 0",
    ] {
        check(sql, my, true).unwrap_or_else(|e| panic!("{sql}: {e:?}"));
    }
    // 세션 잠금.
    for sql in [
        "LOCK TABLES t WRITE",
        "lock table t read",
        "LOCK INSTANCE FOR BACKUP",
        "UNLOCK TABLES",
        "UNLOCK INSTANCE",
        "FLUSH TABLES WITH READ LOCK",
        "flush tables t1, t2 with read lock",
        "FLUSH TABLES /* x */ WITH /* y */ READ /* z */ LOCK",
        "FLUSH TABLES t FOR EXPORT",
    ] {
        assert_eq!(err(sql, my, true), GuardError::SessionLock, "{sql}");
    }
    // 잠금을 남기지 않는 FLUSH · START 의 다른 쓰임 · SELECT … FOR UPDATE(자동 커밋이라 문장 끝에 풀린다)는 받는다.
    for sql in ["FLUSH PRIVILEGES", "FLUSH TABLES", "FLUSH STATUS", "START REPLICA", "SELECT * FROM t FOR UPDATE", "CALL p()", "SELECT GET_LOCK('x', 0)"] {
        check(sql, my, true).unwrap_or_else(|e| panic!("{sql}: {e:?}"));
    }
    // 다른 방언에는 MySQL 전용 규칙이 없다(SQLite·PG 는 그 문법이 아니거나 엔진이 감싼다).
    check("SET autocommit = 0", Dialect::Sqlite, true).unwrap();
    check("FLUSH TABLES WITH READ LOCK", Dialect::Postgres, true).unwrap();
    check("PREPARE TRANSACTION 'g'", my, true).unwrap();
    // 문자열 · 인용 식별자 · 주석 안의 트랜잭션 낱말은 첫 낱말이 아니다.
    for d in ALL {
        for sql in ["SELECT 'BEGIN'", "INSERT INTO t VALUES ('COMMIT')", "UPDATE t SET note = 'ROLLBACK' WHERE id = 1", "/* BEGIN */ SELECT 1", "SELECT 1 -- COMMIT"] {
            check(sql, d, true).unwrap_or_else(|e| panic!("{sql} ({d:?}): {e:?}"));
        }
    }
    // 백슬래시 해석 하나에서만 보이는 `autocommit` 도 거절 쪽 — NO_BACKSLASH_ESCAPES 서버에서는 `'a\'` 가 끝나고 낱말이 선다.
    assert_eq!(err(r"SET @x = 'a\', autocommit = 0, @y = 'b'", my, true), tx(my));
    check(r"SET @x = 'a\\', @y = 'autocommit'", my, true).unwrap();
    // 읽기 전용 모드에서는 이 문장들이 애초에 허용 목록 밖이다(문구는 읽기 전용 쪽).
    for sql in ["XA START 'x'", "SET autocommit = 0", "LOCK TABLES t WRITE", "FLUSH TABLES WITH READ LOCK", "PREPARE TRANSACTION 'g'"] {
        assert!(is_read_only(&err(sql, my, false)), "{sql}");
        assert!(is_read_only(&err(sql, pg, false)), "{sql}");
    }
}

#[test]
fn guard_messages_are_one_line_without_the_sql() {
    let ro = |d| GuardError::ReadOnly { keyword: "SET".into(), dialect: d };
    let tx = |d| GuardError::Transaction { dialect: d };
    for e in [
        GuardError::Empty,
        GuardError::Multiple,
        GuardError::Unterminated,
        GuardError::ExecutableComment,
        GuardError::SessionLock,
        tx(Dialect::Sqlite),
        tx(Dialect::Postgres),
        tx(Dialect::Mysql),
        ro(Dialect::Sqlite),
        ro(Dialect::Postgres),
        ro(Dialect::Mysql),
    ] {
        let m = e.message();
        assert!(!m.is_empty() && !m.contains('\n'), "{m}");
    }
    // 트랜잭션 문구는 그 엔진 이름과 꼴을 보인다.
    assert!(tx(Dialect::Postgres).message().contains("PostgreSQL") && tx(Dialect::Postgres).message().contains("PREPARE TRANSACTION"));
    assert!(tx(Dialect::Mysql).message().contains("MariaDB") && tx(Dialect::Mysql).message().contains("autocommit"));
    assert!(tx(Dialect::Sqlite).message().contains("SQLite") && !tx(Dialect::Sqlite).message().contains("XA"));
    // 읽기 전용 문구는 그 엔진의 허용 목록을 보인다.
    assert!(ro(Dialect::Mysql).message().contains("DESCRIBE"));
    assert!(!ro(Dialect::Sqlite).message().contains("SHOW"));
}

// ── 값 매핑 ──

#[test]
fn values_map_to_json_safely() {
    assert_eq!(value::to_json(Cell::Null), (json!(null), false));
    assert_eq!(value::to_json(Cell::Bool(true)), (json!(true), false));
    let safe = (1i64 << 53) - 1;
    assert_eq!(value::to_json(Cell::Int(safe)), (json!(safe), false));
    assert_eq!(value::to_json(Cell::Int(-safe)), (json!(-safe), false));
    assert_eq!(value::to_json(Cell::Int(1 << 53)), (json!("9007199254740992"), false));
    assert_eq!(value::to_json(Cell::Int(i64::MIN)), (json!(i64::MIN.to_string()), false));
    assert_eq!(value::to_json(Cell::Float(1.5)), (json!(1.5), false));
    assert_eq!(value::to_json(Cell::Float(f64::NAN)), (json!("NaN"), false));
    assert_eq!(value::to_json(Cell::Float(f64::INFINITY)), (json!("Infinity"), false));
    assert_eq!(value::to_json(Cell::Float(f64::NEG_INFINITY)), (json!("-Infinity"), false));
    assert_eq!(value::to_json(Cell::Text("가나".into())), (json!("가나"), false));
    // 칸 상한 — 글자 경계(3바이트 한글)에서 자른다.
    let long = "가".repeat(CELL_MAX);
    let (v, cut) = value::to_json(Cell::Text(long.as_str().into()));
    assert!(cut);
    let s = v.as_str().unwrap();
    assert!(s.len() <= CELL_MAX && s.len() > CELL_MAX - 3 && s.chars().all(|c| c == '가'));
    let exact = "a".repeat(CELL_MAX);
    assert!(!value::to_json(Cell::Text(exact.as_str().into())).1);
    // 바이트 — 길이 + 앞 64바이트 16진.
    let bytes: Vec<u8> = (0u8..=200).collect();
    let (v, cut) = value::to_json(Cell::Bytes(&bytes));
    assert!(!cut);
    assert_eq!(v["$bytes"], 201);
    assert_eq!(v["hex"].as_str().unwrap().len(), 128);
    assert!(v["hex"].as_str().unwrap().starts_with("000102"));
    assert_eq!(value::to_json(Cell::Bytes(&[0xab])).0, json!({ "$bytes": 1, "hex": "ab" }));
}

#[test]
fn limits_are_clamped() {
    assert_eq!(clamp_limits(None, None), (1000, 30_000));
    assert_eq!(clamp_limits(Some(0), Some(0)), (1, 1));
    assert_eq!(clamp_limits(Some(50_000), Some(10_000_000)), (10_000, 600_000));
}

// ── SQLite 엔진 ──

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "aynx-db-test-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// `t(id, name, data)` 1500행 · 큰 글자 한 칸 · 바이트 한 칸이 든 파일.
fn sample_db(tag: &str) -> (PathBuf, PathBuf) {
    let dir = scratch(tag);
    let file = dir.join("sample.db");
    let c = rusqlite::Connection::open(&file).unwrap();
    c.execute_batch(
        "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, data BLOB);
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500)
         INSERT INTO t(id, name) SELECT i, 'row' || i FROM n;
         CREATE VIEW v AS SELECT id FROM t;",
    )
    .unwrap();
    c.execute("UPDATE t SET name = ?1, data = x'00ff10' WHERE id = 1", [ "가".repeat(5000) ]).unwrap();
    (dir, file)
}

fn msg(e: EngineError) -> String {
    match e {
        EngineError::Message(m) => m,
        other => panic!("문구가 아님: {other:?}"),
    }
}

#[test]
fn sqlite_read_only_refuses_writes_attach_and_multiple_statements() {
    let (dir, file) = sample_db("ro");
    let db = Sqlite::open(&file, false).unwrap();
    assert!(!db.writable());
    for sql in ["INSERT INTO t(name) VALUES ('x')", "UPDATE t SET name = 'x'", "CREATE TABLE z(a)", "DELETE FROM t"] {
        let m = msg(db.query(sql, 10).unwrap_err());
        assert!(!m.is_empty(), "{sql}");
    }
    for sql in ["ATTACH 'x.db' AS x", "SELECT 1; SELECT 2", "PRAGMA query_only = 0", "BEGIN"] {
        assert!(matches!(db.query(sql, 10).unwrap_err(), EngineError::Message(_)), "{sql}");
    }
    // 파일은 그대로다.
    let n = db.query("SELECT count(*) FROM t", 10).unwrap();
    assert_eq!(n.rows, vec![vec![json!(1500)]]);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

/// 허용 첫 낱말(`WITH`·`EXPLAIN`) 뒤에 숨은 쓰기는 가드가 아니라 **엔진 겹**이 막는다(가드 머리말 3).
#[test]
fn sqlite_read_only_refuses_writes_behind_allowed_first_words() {
    let (dir, file) = sample_db("ro-behind");
    let db = Sqlite::open(&file, false).unwrap();
    let sql = "WITH x AS (SELECT 1) INSERT INTO t(name) SELECT 'x' FROM x";
    check(sql, Dialect::Sqlite, false).expect("가드는 WITH 첫 낱말을 받는다");
    assert!(matches!(db.query(sql, 10).unwrap_err(), EngineError::Message(_)));
    let sql = "WITH x AS (SELECT 1) DELETE FROM t";
    check(sql, Dialect::Sqlite, false).unwrap();
    assert!(db.query(sql, 10).is_err());
    // EXPLAIN 도 가드는 받지만 엔진은 뒤 문장의 쓰기로 본다(`sqlite3_stmt_readonly` 는 EXPLAIN 앞머리를 떼고 판정).
    check("EXPLAIN DELETE FROM t", Dialect::Sqlite, false).unwrap();
    assert!(db.query("EXPLAIN DELETE FROM t", 10).is_err());
    let n = db.query("SELECT count(*) FROM t", 10).unwrap();
    assert_eq!(n.rows, vec![vec![json!(1500)]]);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sqlite_rows_cells_columns_and_limits() {
    let (dir, file) = sample_db("rows");
    let db = Sqlite::open(&file, false).unwrap();
    let r = db.query("SELECT id, name, data FROM t ORDER BY id", 1000).unwrap();
    assert_eq!(r.rows.len(), 1000);
    assert!(r.truncated && r.cell_truncated, "1500행 → 1000 · 5000자 한글(15000 B) 칸 → 잘림");
    let types: Vec<&str> = r.columns.iter().map(|c| c.ty.as_str()).collect();
    assert_eq!(types, ["integer", "text", "blob"]);
    assert_eq!(r.rows[0][2], json!({ "$bytes": 3, "hex": "00ff10" }));
    assert_eq!(r.rows[1][2], json!(null));
    assert!(r.affected.is_none());
    let few = db.query("SELECT id FROM t WHERE id <= 3", 3).unwrap();
    assert_eq!(few.rows.len(), 3);
    assert!(!few.truncated, "꼭 맞으면 더 없다");
    let few = db.query("SELECT id FROM t WHERE id <= 4", 3).unwrap();
    assert!(few.truncated);
    // 행이 없는 SELECT 도 컬럼 이름은 있다(형은 모름).
    let none = db.query("SELECT id AS k FROM t WHERE 0", 10).unwrap();
    assert_eq!((none.columns[0].name.as_str(), none.columns[0].ty.as_str(), none.rows.len()), ("k", "", 0));
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sqlite_interrupt_stops_a_long_query() {
    let (dir, file) = sample_db("int");
    let db = std::sync::Arc::new(Sqlite::open(&file, false).unwrap());
    let d2 = db.clone();
    let t = std::thread::spawn(move || {
        d2.query("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n", 10)
    });
    std::thread::sleep(std::time::Duration::from_millis(300));
    // 도는 동안 다른 일은 바로 Busy(줄 세우지 않는다).
    assert_eq!(db.schema().unwrap_err(), EngineError::Busy);
    let started = std::time::Instant::now();
    db.interrupt();
    assert_eq!(t.join().unwrap().unwrap_err(), EngineError::Interrupted);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    // 끊긴 뒤에도 연결은 쓸 수 있다.
    assert_eq!(db.query("SELECT 1", 1).unwrap().rows, vec![vec![json!(1)]]);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sqlite_write_mode_reopens_read_write_and_back() {
    let (dir, file) = sample_db("rw");
    let db = Sqlite::open(&file, false).unwrap();
    db.set_write(true).unwrap();
    assert!(db.writable());
    let r = db.query("INSERT INTO t(name) VALUES ('new')", 10).unwrap();
    assert_eq!(r.affected, Some(1));
    let r = db.query("UPDATE t SET name = 'z' WHERE id <= 3 RETURNING id", 10).unwrap();
    assert_eq!((r.rows.len(), r.affected), (3, Some(3)));
    // 쓰기 모드도 트랜잭션 문장은 받지 않는다(10-13 결정 0단계) — 거절 뒤 연결은 트랜잭션 밖이고 다음 쓰기는 바로 커밋된다.
    for sql in ["BEGIN", "BEGIN IMMEDIATE", "SAVEPOINT a", "COMMIT", "END", "ROLLBACK"] {
        let m = msg(db.query(sql, 1).unwrap_err());
        assert!(m.contains("SQLite"), "{sql}: {m}");
        assert!(db.is_autocommit(), "{sql}");
    }
    db.query("INSERT INTO t(name) VALUES ('ac')", 1).unwrap();
    assert!(db.is_autocommit(), "다음 문장 뒤에도 트랜잭션 밖");
    let other = rusqlite::Connection::open(&file).unwrap();
    let n: i64 = other.query_row("SELECT count(*) FROM t WHERE name = 'ac'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1, "다른 연결에서 바로 보인다(커밋됨)");
    other.execute("DELETE FROM t WHERE name = 'ac'", []).unwrap();
    drop(other);
    db.set_write(false).unwrap();
    assert!(!db.writable());
    assert!(db.query("INSERT INTO t(name) VALUES ('again')", 10).is_err());
    assert_eq!(db.query("SELECT count(*) FROM t", 1).unwrap().rows, vec![vec![json!(1501)]]);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sqlite_objects_folders_indexes_triggers_attached() {
    let (dir, file) = sample_db("objects");
    {
        let c = rusqlite::Connection::open(&file).unwrap();
        c.execute_batch(
            "CREATE INDEX t_name ON t(name);
             CREATE TABLE u(a TEXT UNIQUE);
             CREATE TRIGGER t_ins AFTER INSERT ON t BEGIN SELECT 1; END;",
        )
        .unwrap();
    }
    let other = dir.join("other.db");
    rusqlite::Connection::open(&other).unwrap().execute_batch("CREATE TABLE o(x)").unwrap();
    let db = Sqlite::open(&file, false).unwrap();
    let o = db.objects(None).unwrap();
    // 스키마 단에는 테이블 · 뷰만 — 인덱스 · 트리거는 테이블 아래(`table_detail`).
    assert_eq!(
        o["objects"],
        json!([
            { "kind": "table", "name": "t" },
            { "kind": "table", "name": "u" },
            { "kind": "view", "name": "v" },
        ])
    );
    // 붙인 DB 는 스키마 목록에 서고, 그 이름으로 객체를 읽는다(쓰기 모드에서 `ATTACH`).
    db.set_write(true).unwrap();
    db.query(&format!("ATTACH '{}' AS \"other db\"", other.display()), 1).unwrap();
    let names: Vec<String> = db.schema().unwrap()["schemas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.starts_with(&["main".to_string()]) && names.contains(&"other db".to_string()), "{names:?}");
    assert_eq!(db.objects(Some("other db")).unwrap()["objects"], json!([{ "kind": "table", "name": "o" }]));
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn objects_cap_marks_the_kinds_of_that_query() {
    use super::{cap_objects, objects_json, ObjectOut, OBJECTS_MAX};
    let mut truncated = Vec::new();
    let few = cap_objects(vec![ObjectOut::new("table", "a".into())], &["table", "view"], &mut truncated);
    assert_eq!((few.len(), truncated.len()), (1, 0));
    let many: Vec<ObjectOut> = (0..=OBJECTS_MAX).map(|i| ObjectOut::new("view", format!("v{i}"))).collect();
    let cut = cap_objects(many, &["table", "view"], &mut truncated);
    assert_eq!(cut.len(), OBJECTS_MAX);
    assert_eq!(truncated, ["table", "view"]);
    // 같은 종류를 두 번 적지 않는다.
    let many: Vec<ObjectOut> = (0..=OBJECTS_MAX).map(|i| ObjectOut::new("table", format!("t{i}"))).collect();
    cap_objects(many, &["table"], &mut truncated);
    assert_eq!(truncated, ["table", "view"]);
    // 빈 칸은 싣지 않는다.
    let f = ObjectOut {
        args: Some("a integer".into()),
        returns: Some("integer".into()),
        sub: Some("aggregate"),
        ..ObjectOut::new("function", "f".into())
    };
    assert_eq!(
        objects_json(vec![f], vec![]),
        json!({ "objects": [{ "kind": "function", "name": "f", "sub": "aggregate", "args": "a integer", "returns": "integer" }], "truncated": [] })
    );
}

#[test]
fn engine_object_kind_maps() {
    use super::mysql::table_kind;
    use super::pg::{proc_object, proc_sql, rel_object, type_sub};
    assert_eq!(rel_object("r"), ("table", None));
    assert_eq!(rel_object("p"), ("table", Some("partitioned")));
    assert_eq!(rel_object("v"), ("view", None));
    assert_eq!(rel_object("m"), ("matview", None));
    assert_eq!(rel_object("f"), ("foreign", None));
    assert_eq!(rel_object("S"), ("sequence", None));
    assert_eq!(proc_object("f"), ("function", None));
    assert_eq!(proc_object("p"), ("procedure", None));
    assert_eq!(proc_object("a"), ("function", Some("aggregate")));
    assert_eq!(proc_object("w"), ("function", Some("window")));
    assert_eq!(
        [type_sub("e"), type_sub("d"), type_sub("r"), type_sub("c"), type_sub("b")],
        [Some("enum"), Some("domain"), Some("range"), Some("composite"), None]
    );
    // 11 아래는 `prokind` 가 없다.
    assert!(proc_sql(110_000).contains("prokind") && !proc_sql(100_000).contains("prokind"));
    assert!(proc_sql(100_000).contains("proisagg"));
    for v in [96_000, 160_000] {
        assert!(proc_sql(v).contains("n.nspname = $1") && proc_sql(v).contains("LIMIT $2"), "스키마·상한은 바인드 인자");
    }
    assert_eq!(table_kind("BASE TABLE"), "table");
    assert_eq!(table_kind("SYSTEM VERSIONED"), "table");
    assert_eq!(table_kind("VIEW"), "view");
    assert_eq!(table_kind("SYSTEM VIEW"), "view");
    assert_eq!(table_kind("SEQUENCE"), "sequence");
}

#[test]
fn sqlite_schema_and_columns() {
    let (dir, file) = sample_db("schema");
    let db = Sqlite::open(&file, false).unwrap();
    // 첫 단계는 이름만 — 새 연결에는 `main` 하나(`temp` 는 쓰였을 때만).
    let s = db.schema().unwrap();
    assert_eq!(s, json!({ "schemas": [{ "name": "main" }] }));
    let o = db.objects(None).unwrap();
    assert_eq!(
        o,
        json!({ "objects": [{ "kind": "table", "name": "t" }, { "kind": "view", "name": "v" }], "truncated": [] })
    );
    assert_eq!(db.objects(Some("main")).unwrap(), o);
    // 없는 DB 이름(식별자 자리) — 목록에 없으면 문장에 넣지 않고 빈 목록.
    assert_eq!(db.objects(Some("x\".sqlite_schema; --")).unwrap()["objects"], json!([]));
    let c = db.table_detail(None, "t").unwrap();
    let names: Vec<&str> = c["columns"].as_array().unwrap().iter().map(|x| x["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["id", "name", "data"]);
    assert_eq!(c["columns"][0]["pk"], 1);
    assert_eq!(c["columns"][0]["type"], "INTEGER");
    assert!(db.table_detail(None, "nope").is_err());
    assert!(db.table_detail(Some("main"), "t").is_ok());
    assert!(db.table_detail(Some("x\".sqlite_schema; --"), "t").is_err(), "없는 DB 이름은 문장에 넣지 않는다");
    // 뷰도 컬럼을 읽는다(나머지 칸은 빈 목록).
    let v = db.table_detail(None, "v").unwrap();
    assert_eq!(v["columns"][0]["name"], "id", "{v}");
    assert_eq!(v["indexes"], json!([]));
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

/// 테이블 구조(10-13) — 인덱스(다중 열 · 식 · 부분 · 자동) · 제약(기본 키 · 유니크 · 체크 — 이름 · 컬럼 체크) · 외래 키(복합 · 자기
/// 참조 · 대상 열 생략) · 참조됨 · 트리거(때 · 사건) — 따옴표 · 공백 든 이름, 붙인 DB.
#[test]
fn sqlite_table_detail_folders() {
    let (dir, file) = sample_db("detail");
    {
        let c = rusqlite::Connection::open(&file).unwrap();
        c.execute_batch(
            r#"PRAGMA foreign_keys = ON;
             CREATE TABLE "cust omer"(id INTEGER PRIMARY KEY, region TEXT NOT NULL, code TEXT, UNIQUE(region, code));
             CREATE TABLE "or""ders"(
               id INTEGER, line INTEGER, cust INTEGER REFERENCES "cust omer" ON DELETE CASCADE,
               region TEXT, code TEXT, parent_id INTEGER, parent_line INTEGER,
               qty INTEGER CONSTRAINT qty_pos CHECK (qty > 0), note TEXT CHECK(length(note) < 100),
               PRIMARY KEY (id, line),
               CONSTRAINT "big ""total""" CHECK (qty * 2 < 1000 AND note <> 'a,b)'),
               FOREIGN KEY (region, code) REFERENCES "cust omer"(region, code),
               FOREIGN KEY (parent_id, parent_line) REFERENCES "or""ders"(id, line)
             );
             CREATE INDEX "o idx" ON "or""ders"(cust, region DESC);
             CREATE INDEX o_expr ON "or""ders"(lower(note), qty);
             CREATE INDEX o_part ON "or""ders"(qty) WHERE qty > 10;
             CREATE TRIGGER "o trg" AFTER UPDATE OF qty ON "or""ders" BEGIN SELECT 1; END;
             CREATE TRIGGER IF NOT EXISTS main.o_trg2 INSERT ON "or""ders" BEGIN SELECT 1; END;
             CREATE VIEW ov AS SELECT id FROM "or""ders";
             CREATE TRIGGER ov_ins INSTEAD OF INSERT ON ov BEGIN SELECT 1; END;"#,
        )
        .unwrap();
    }
    let db = Sqlite::open(&file, false).unwrap();
    let d = db.table_detail(None, "or\"ders").unwrap();
    println!("MEASURE sqlite detail: {d}");
    assert_eq!(d["indexes"], json!([
        { "name": "sqlite_autoindex_or\"ders_1", "columns": ["id", "line"], "unique": true, "primary": true },
        { "name": "o idx", "columns": ["cust", "region"], "unique": false, "primary": false,
          "definition": "CREATE INDEX \"o idx\" ON \"or\"\"ders\"(cust, region DESC)" },
        { "name": "o_expr", "columns": [null, "qty"], "unique": false, "primary": false,
          "definition": "CREATE INDEX o_expr ON \"or\"\"ders\"(lower(note), qty)" },
        { "name": "o_part", "columns": ["qty"], "unique": false, "primary": false,
          "definition": "CREATE INDEX o_part ON \"or\"\"ders\"(qty) WHERE qty > 10" },
    ]));
    assert_eq!(d["constraints"], json!([
        { "type": "primary", "columns": ["id", "line"] },
        { "name": "qty_pos", "type": "check", "columns": ["qty"], "definition": "CHECK (qty > 0)" },
        { "type": "check", "columns": ["note"], "definition": "CHECK (length(note) < 100)" },
        { "name": "big \"total\"", "type": "check", "columns": [], "definition": "CHECK (qty * 2 < 1000 AND note <> 'a,b)')" },
    ]));
    let fk = |cols: [&str; 2], rt: &str, rc: [&str; 2], upd: &str, del: &str| {
        json!({ "schema": "main", "table": "or\"ders", "columns": cols, "refSchema": "main", "refTable": rt, "refColumns": rc,
                "onUpdate": upd, "onDelete": del })
    };
    let fks = d["foreignKeys"].as_array().unwrap();
    assert_eq!(fks.len(), 3, "{d}");
    assert!(fks.contains(&fk(["parent_id", "parent_line"], "or\"ders", ["id", "line"], "NO ACTION", "NO ACTION")), "자기 참조: {d}");
    assert!(fks.contains(&fk(["region", "code"], "cust omer", ["region", "code"], "NO ACTION", "NO ACTION")), "복합: {d}");
    assert!(
        fks.contains(&json!({ "schema": "main", "table": "or\"ders", "columns": ["cust"], "refSchema": "main", "refTable": "cust omer",
            "refColumns": ["id"], "onUpdate": "NO ACTION", "onDelete": "CASCADE" })),
        "대상 열 생략 → 대상의 기본 키: {d}"
    );
    // 참조됨 — 자기 참조는 양쪽에 선다.
    assert_eq!(d["referencedBy"].as_array().unwrap().len(), 1, "{d}");
    assert_eq!(d["referencedBy"][0]["columns"], json!(["parent_id", "parent_line"]));
    let c = db.table_detail(None, "cust omer").unwrap();
    let by: Vec<(&str, &serde_json::Value)> = c["referencedBy"].as_array().unwrap().iter().map(|x| (x["table"].as_str().unwrap(), &x["refColumns"])).collect();
    assert!(by.len() == 2 && by.contains(&("or\"ders", &json!(["id"]))) && by.contains(&("or\"ders", &json!(["region", "code"]))), "{c}");
    assert_eq!(c["constraints"], json!([
        { "type": "primary", "columns": ["id"] },
        { "type": "unique", "columns": ["region", "code"] },
    ]));
    assert_eq!(
        d["triggers"].as_array().unwrap().iter().map(|t| (t["name"].as_str().unwrap(), t["detail"].as_str().unwrap())).collect::<Vec<_>>(),
        [("o trg", "AFTER UPDATE"), ("o_trg2", "BEFORE INSERT")]
    );
    let v = db.table_detail(None, "ov").unwrap();
    assert_eq!(v["triggers"][0]["detail"], "INSTEAD OF INSERT");
    assert_eq!(d["partitions"], json!([]));
    assert_eq!(d["truncated"], json!([]));
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn detail_pure_helpers() {
    use super::detail::{
        group_runs, pg_constraint_type, pg_fk_action, pg_fk_sql, pg_index_sql, pg_trigger_detail, sqlite_checks, sqlite_trigger_detail,
        TableDetail, TriggerOut, PG_COLUMNS, PG_CONSTRAINTS, PG_PARTITIONS, PG_REL, PG_TRIGGERS,
    };
    use super::mysql::{mysql_constraint_sql, mysql_fk_sql, mysql_index_column, mysql_index_sql};
    use super::OBJECTS_MAX;
    // PG tgtype 비트.
    assert_eq!(pg_trigger_detail(2 | 4 | 16 | 1), "BEFORE INSERT OR UPDATE");
    assert_eq!(pg_trigger_detail(8), "AFTER DELETE");
    assert_eq!(pg_trigger_detail(64 | 4 | 1), "INSTEAD OF INSERT");
    assert_eq!(pg_trigger_detail(32), "AFTER TRUNCATE");
    assert_eq!(pg_fk_action("c").as_deref(), Some("CASCADE"));
    assert_eq!(pg_fk_action("a").as_deref(), Some("NO ACTION"));
    assert_eq!(pg_fk_action("?"), None);
    assert_eq!([pg_constraint_type("p"), pg_constraint_type("u"), pg_constraint_type("c"), pg_constraint_type("x")], ["primary", "unique", "check", "exclude"]);
    // 앱 고정 문장 — 이름 · oid · 상한은 바인드 인자.
    assert!(PG_REL.contains("n.nspname = $1 AND c.relname = $2"));
    for s in [PG_COLUMNS, PG_CONSTRAINTS, PG_TRIGGERS, PG_PARTITIONS] {
        assert!(s.contains("= $1") && s.contains("LIMIT $2"), "{s}");
    }
    assert!(pg_index_sql(110_000).contains("indnkeyatts") && pg_index_sql(100_000).contains("indnatts"));
    assert!(pg_fk_sql(160_000, false).contains("con.conrelid = $1 AND con.conparentid = 0"));
    assert!(pg_fk_sql(160_000, true).contains("con.confrelid = $1"));
    assert!(!pg_fk_sql(100_000, true).contains("conparentid"), "10 에는 conparentid 가 없다");
    for s in [mysql_index_sql(true), mysql_index_sql(false), mysql_fk_sql(true), mysql_fk_sql(false)] {
        assert_eq!(s.matches('?').count(), 3, "데이터베이스 · 테이블 · 상한: {s}");
    }
    for (a, b) in [(false, false), (true, false), (true, true)] {
        let s = mysql_constraint_sql(a, b);
        assert_eq!(s.matches('?').count(), 3, "{s}");
        assert_eq!(s.contains("CHECK_CONSTRAINTS"), a);
        assert_eq!(s.contains("cc.TABLE_NAME"), b);
    }
    assert_eq!(mysql_index_column(Some("a"), Some(10), None), "a(10)");
    assert_eq!(mysql_index_column(None, None, Some("lower(`n`)")), "(lower(`n`))");
    // 이웃끼리 묶기.
    let g = group_runs(vec![("a", 1), ("a", 2), ("b", 3), ("a", 4)], |r| r.0);
    assert_eq!(g, vec![vec![("a", 1), ("a", 2)], vec![("b", 3)], vec![("a", 4)]]);
    // SQLite 트리거 글자.
    assert_eq!(sqlite_trigger_detail("CREATE TEMP TRIGGER \"a b\" BEFORE DELETE ON t BEGIN SELECT 1; END"), "BEFORE DELETE");
    assert_eq!(sqlite_trigger_detail("create trigger [x] instead of update of a on v begin select 1; end"), "INSTEAD OF UPDATE");
    assert_eq!(sqlite_trigger_detail("CREATE TRIGGER /* AFTER */ s.x -- BEFORE\n AFTER INSERT ON t BEGIN END"), "AFTER INSERT");
    assert_eq!(sqlite_trigger_detail("CREATE TRIGGER x ON t"), "");
    // SQLite 체크 — 괄호 · 글자 안 쉼표 · 주석 · AS SELECT.
    let c = sqlite_checks("CREATE TABLE t(a INT CHECK (a IN (1, 2)), b TEXT /* CHECK (no) */, CHECK ((b || ',') <> ')'))");
    assert_eq!(c.len(), 2, "{c:?}");
    assert_eq!((c[0].column.as_deref(), c[0].expr.as_str()), (Some("a"), "a IN (1, 2)"));
    assert_eq!((c[1].column.as_deref(), c[1].expr.as_str()), (None, "(b || ',') <> ')'"));
    assert!(sqlite_checks("CREATE TABLE t AS SELECT 1 AS x").is_empty());
    assert!(sqlite_checks("CREATE TABLE t(a)").is_empty());
    // 칸마다 상한 — 넘은 칸 이름만.
    let d = TableDetail {
        triggers: (0..=OBJECTS_MAX).map(|i| TriggerOut { name: format!("t{i}"), detail: String::new(), definition: None }).collect(),
        ..TableDetail::default()
    };
    let j = d.json();
    assert_eq!(j["triggers"].as_array().unwrap().len(), OBJECTS_MAX);
    assert_eq!(j["truncated"], json!(["triggers"]));
    assert_eq!(j["foreignKeys"], json!([]));
}

fn def_target(schema: Option<&str>, kind: &str, name: &str, table: Option<&str>) -> super::definition::DefTarget {
    super::definition::DefTarget {
        schema: schema.map(str::to_string),
        kind: kind.into(),
        name: name.into(),
        table: table.map(str::to_string),
        args: None,
    }
}

#[test]
fn definition_pure_helpers() {
    use super::definition::*;
    // 상한 — UTF-8 경계에서 자른다.
    let (s, cut) = cap_text("가나다".into(), 4);
    assert_eq!((s.as_str(), cut), ("가", true));
    assert_eq!(cap_text("abc".into(), 3), ("abc".to_string(), false));
    let big = DefinitionOut::new("x".repeat(DEFINITION_MAX + 10), true);
    assert_eq!((big.sql.len(), big.truncated, big.reconstructed), (DEFINITION_MAX, true, true));
    // 몸 확인 — 모르는 종류 · 빈 이름 · 테이블이 필요한 종류.
    assert_eq!(DefKind::parse("matview"), Some(DefKind::Matview));
    assert_eq!(DefKind::parse("column"), None);
    assert!(check(&def_target(None, "column", "a", None)).is_err());
    assert!(check(&def_target(None, "table", "", None)).is_err());
    assert!(check(&def_target(None, "trigger", "t", None)).is_err(), "트리거는 테이블이 있어야");
    assert_eq!(check(&def_target(None, "trigger", "t", Some("x"))), Ok(DefKind::Trigger));
    // MySQL — 존재 확인은 바인드 둘, SHOW 는 카탈로그 이름을 백틱 인용(백틱은 둘로).
    for k in [DefKind::Table, DefKind::View, DefKind::Sequence, DefKind::Function, DefKind::Procedure, DefKind::Trigger] {
        let (q, _) = mysql_lookup(k).unwrap();
        assert_eq!(q.matches('?').count(), 2, "{q}");
    }
    for k in [DefKind::Index, DefKind::Constraint, DefKind::Matview, DefKind::Type, DefKind::Foreign] {
        assert!(mysql_lookup(k).is_none(), "{k:?}");
    }
    assert_eq!(mysql_ident("or`ders"), "`or``ders`");
    assert_eq!(mysql_show_sql("TABLE", "pt", "x`; DROP DATABASE pt; --"), "SHOW CREATE TABLE `pt`.`x``; DROP DATABASE pt; --`");
    let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(mysql_definition_column(&names(&["Table", "Create Table"])), Some(1));
    assert_eq!(mysql_definition_column(&names(&["Procedure", "sql_mode", "Create Procedure", "character_set_client"])), Some(2));
    assert_eq!(
        mysql_definition_column(&names(&["Trigger", "sql_mode", "SQL Original Statement", "character_set_client", "Created"])),
        Some(2),
        "트리거의 `Created` 칸이 아니라 원문"
    );
    // PG 고정 문장 — 이름은 바인드 인자.
    assert!(pg_table_head_sql(160_000).contains("n.nspname = $1 AND c.relname = $2"));
    assert!(!pg_table_head_sql(90_600).contains("relispartition"), "9.6 에는 파티션 칸이 없다");
    assert!(pg_table_columns_sql(170_000).contains("attgenerated") && !pg_table_columns_sql(110_000).contains("attgenerated"));
    assert!(!pg_table_columns_sql(96_000).contains("attidentity"));
    assert!(pg_table_constraints_sql(160_000).contains("conparentid = 0") && !pg_table_constraints_sql(100_000).contains("conparentid"));
    for s in [PG_TRIGGER, PG_CONSTRAINT] {
        assert!(s.contains("$1") && s.contains("$2") && s.contains("$3"), "{s}");
    }
    assert!(pg_proc_find_sql(160_000).contains("$3::text IS NULL") && pg_proc_find_sql(100_000).contains("proisagg"));
    // PG 재구성 — 테이블.
    let head = PgTableHead {
        relkind: "p".into(),
        name: "s.\"or\"\"ders\"".into(),
        persistence: "u".into(),
        partition_key: Some("RANGE (at)".into()),
        ..PgTableHead::default()
    };
    let cols = vec![
        PgColumn { name: "id".into(), ty: "integer".into(), identity: "a".into(), not_null: true, ..PgColumn::default() },
        PgColumn { name: "at".into(), ty: "date".into(), default: Some("CURRENT_DATE".into()), ..PgColumn::default() },
        PgColumn { name: "n2".into(), ty: "integer".into(), default: Some("(id * 2)".into()), generated: "s".into(), ..PgColumn::default() },
        PgColumn { name: "t".into(), ty: "text".into(), collation: Some("pg_catalog.\"C\"".into()), ..PgColumn::default() },
    ];
    let cons = vec![("pk".to_string(), "PRIMARY KEY (id, at)".to_string())];
    let ddl = pg_table_ddl(&head, &cols, &cons, &["CREATE INDEX i ON s.t USING btree (at)".to_string()]);
    assert_eq!(
        ddl,
        "CREATE UNLOGGED TABLE s.\"or\"\"ders\" (\n    id integer GENERATED ALWAYS AS IDENTITY NOT NULL,\n    at date DEFAULT CURRENT_DATE,\n    \
         n2 integer GENERATED ALWAYS AS ((id * 2)) STORED,\n    t text COLLATE pg_catalog.\"C\",\n    CONSTRAINT pk PRIMARY KEY (id, at)\n)\n\
         PARTITION BY RANGE (at);\n\nCREATE INDEX i ON s.t USING btree (at);"
    );
    let part = PgTableHead {
        relkind: "r".into(),
        name: "s.c".into(),
        persistence: "p".into(),
        partition_of: Some(("s.p".into(), "FOR VALUES FROM (1) TO (2)".into())),
        ..PgTableHead::default()
    };
    assert_eq!(pg_table_ddl(&part, &cols, &[], &[]), "CREATE TABLE s.c PARTITION OF s.p\nFOR VALUES FROM (1) TO (2);");
    let ft = PgTableHead {
        relkind: "f".into(),
        name: "s.f".into(),
        persistence: "p".into(),
        server: Some("srv".into()),
        server_options: Some("table_name 'x'".into()),
        ..PgTableHead::default()
    };
    assert_eq!(pg_table_ddl(&ft, &[], &[], &[]), "CREATE FOREIGN TABLE s.f (\n)\nSERVER srv\nOPTIONS (table_name 'x');");
    // 뷰 · 구체화 뷰 · 시퀀스 · 형 · 집계 · 제약.
    assert_eq!(pg_view_ddl("s.v", None, " SELECT 1;"), "CREATE OR REPLACE VIEW s.v AS\n SELECT 1;");
    assert_eq!(pg_view_ddl("s.v", Some("check_option=local"), " SELECT 1"), "CREATE OR REPLACE VIEW s.v WITH (check_option=local) AS\n SELECT 1;");
    assert_eq!(pg_matview_ddl("s.m", None, " SELECT 1;", false, &[]), "CREATE MATERIALIZED VIEW s.m AS\n SELECT 1\nWITH NO DATA;");
    let q = PgSequence {
        name: "s.q".into(),
        ty: "bigint".into(),
        start: 1,
        increment: 1,
        max: i64::MAX,
        min: 1,
        cache: 1,
        cycle: false,
        owned: Some(("s.t.id".into(), "a".into())),
    };
    let sq = pg_sequence_ddl(&q);
    assert!(sq.starts_with("CREATE SEQUENCE s.q\n    AS bigint\n    START WITH 1") && sq.ends_with("ALTER SEQUENCE s.q OWNED BY s.t.id;"), "{sq}");
    assert_eq!(pg_enum_ddl("s.e", &["'a'".into(), "'b''c'".into()]), "CREATE TYPE s.e AS ENUM (\n    'a',\n    'b''c'\n);");
    let dm = PgDomain {
        name: "s.d".into(),
        base: "integer".into(),
        not_null: true,
        default: Some("0".into()),
        checks: vec![("pos".into(), "CHECK (VALUE > 0)".into())],
        ..PgDomain::default()
    };
    assert_eq!(pg_domain_ddl(&dm), "CREATE DOMAIN s.d AS integer\n    DEFAULT 0\n    NOT NULL\n    CONSTRAINT pos CHECK (VALUE > 0);");
    assert_eq!(pg_range_ddl("s.r", "integer", Some("int4mi"), None), "CREATE TYPE s.r AS RANGE (\n    SUBTYPE = integer,\n    SUBTYPE_DIFF = int4mi\n);");
    assert_eq!(pg_composite_ddl("s.c", &[("a".into(), "integer".into())]), "CREATE TYPE s.c AS (\n    a integer\n);");
    let ag = PgAggregate {
        name: "s.agg".into(),
        args: "integer".into(),
        sfunc: "int4pl".into(),
        stype: "integer".into(),
        initcond: Some("0'".into()),
        ..PgAggregate::default()
    };
    assert_eq!(pg_aggregate_ddl(&ag), "CREATE AGGREGATE s.agg(integer) (\n    SFUNC = int4pl,\n    STYPE = integer,\n    INITCOND = '0'''\n);");
    assert_eq!(pg_constraint_ddl("s.t", "c", "CHECK (a > 0)"), "ALTER TABLE s.t\n    ADD CONSTRAINT c CHECK (a > 0);");
    assert_eq!((with_semicolon("CREATE INDEX x ON t (a)"), with_semicolon("x;  ")), ("CREATE INDEX x ON t (a);".to_string(), "x;".to_string()));
}

#[test]
fn sqlite_definitions_are_the_stored_text() {
    let (dir, file) = sample_db("definition");
    {
        let c = rusqlite::Connection::open(&file).unwrap();
        c.execute_batch(
            r#"CREATE TABLE "or""ders"(id INTEGER PRIMARY KEY, code TEXT UNIQUE, qty INTEGER CHECK (qty > 0));
             CREATE INDEX "o idx" ON "or""ders"(qty) WHERE qty > 10;
             CREATE TRIGGER "o trg" AFTER UPDATE ON "or""ders" BEGIN SELECT 1; END;"#,
        )
        .unwrap();
    }
    let db = Sqlite::open(&file, false).unwrap();
    let def = |kind: &str, name: &str| db.definition(&def_target(None, kind, name, Some("or\"ders")));
    let t = def("table", "or\"ders").unwrap();
    assert_eq!(t["sql"], "CREATE TABLE \"or\"\"ders\"(id INTEGER PRIMARY KEY, code TEXT UNIQUE, qty INTEGER CHECK (qty > 0));");
    assert_eq!((t["reconstructed"].as_bool(), t["truncated"].as_bool()), (Some(false), Some(false)));
    assert!(def("index", "o idx").unwrap()["sql"].as_str().unwrap().ends_with("WHERE qty > 10;"));
    assert!(def("trigger", "o trg").unwrap()["sql"].as_str().unwrap().starts_with("CREATE TRIGGER \"o trg\""));
    assert_eq!(def("view", "v").unwrap()["sql"], "CREATE VIEW v AS SELECT id FROM t;");
    // 대소문자만 다른 이름도 찾는다(SQLite 이름은 대소문자를 가리지 않는다).
    assert!(def("table", "OR\"DERS").is_ok());
    // 자동 인덱스 · 없는 이름 · 주입 모양 · 없는 DB · 종류 밖.
    let auto = msg(def("index", "sqlite_autoindex_or\"ders_1").unwrap_err());
    assert!(auto.contains("sqlite_autoindex"), "{auto}");
    for (kind, name) in [("table", "nope"), ("table", "t' OR '1'='1"), ("view", "t")] {
        assert!(msg(def(kind, name).unwrap_err()).contains(name), "{kind} {name}");
    }
    assert!(db.definition(&def_target(Some("x\"; DROP TABLE t; --"), "table", "t", None)).is_err());
    assert!(db.definition(&def_target(None, "sequence", "t", None)).is_err());
    assert!(db.definition(&def_target(None, "constraint", "c", Some("t"))).is_err());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sqlite_open_refuses_relative_and_missing_files_without_creating() {
    assert!(Sqlite::open(std::path::Path::new("relative.db"), false).is_err());
    let dir = scratch("missing");
    let missing = dir.join("none.db");
    assert!(Sqlite::open(&missing, false).is_err());
    assert!(Sqlite::open(&missing, true).is_err(), "쓰기로도 새 파일을 만들지 않는다");
    assert!(!missing.exists());
    let _ = std::fs::remove_dir_all(dir);
}

// ── DB 연결 목록(`db-connections.json` — 경유 · 직접 한 파일) ──

fn sqlite_entry(id: &str, path: &str) -> DbConn {
    DbConn {
        id: id.into(),
        name: "앱".into(),
        engine: DbEngine::Sqlite,
        via: None,
        path: Some(path.into()),
        host: Some("ignored".into()),
        port: None,
        database: None,
        user: None,
        tls_mode: Some(DbTlsMode::Require),
        tls_ca: None,
        folder: None,
    }
}

fn pg_entry(id: &str, host: &str) -> DbConn {
    DbConn {
        id: id.into(),
        name: "dev".into(),
        engine: DbEngine::Postgres,
        via: None,
        path: None,
        host: Some(host.into()),
        port: Some(5432),
        database: Some(" app ".into()),
        user: Some("me".into()),
        tls_mode: None,
        tls_ca: None,
        folder: None,
    }
}

fn via_entry(id: &str, via: &str) -> DbConn {
    DbConn { via: Some(via.into()), ..pg_entry(id, "localhost") }
}

fn abs(name: &str) -> String {
    std::env::temp_dir().join(name).to_string_lossy().into_owned()
}

#[test]
fn conn_list_validation_rules() {
    let ok = conns::validate_list(&[
        sqlite_entry("Abc_local01", &abs("a.db")),
        pg_entry("Abc_local02", "localhost"),
        via_entry("Abc_local0v", " web-01 "),
    ])
    .unwrap();
    // SQLite 줄은 경로만 남고(호스트·TLS 칸은 버린다), PG 줄은 다듬어지고 TLS 기본(prefer)이 적힌다 · 경유 별칭도 다듬는다.
    assert_eq!((ok[0].host.as_deref(), ok[0].tls_mode, ok[0].via.as_deref()), (None, None, None));
    assert_eq!((ok[1].database.as_deref(), ok[1].tls_mode), (Some("app"), Some(DbTlsMode::Prefer)));
    assert_eq!(ok[2].via.as_deref(), Some("web-01"));
    for host in ["127.0.0.1", "LOCALHOST", "::1", "[::1]", "db.example.com", "10.0.0.5"] {
        let d = conns::validate_one(&pg_entry("Abc_local03", host)).unwrap_or_else(|e| panic!("{host}: {e}"));
        assert_eq!(d.host.as_deref(), Some(host));
    }
    // 호스트는 비거나 공백이 끼면 안 된다 · 경유 별칭에도 공백이 끼면 안 된다(빈칸만이면 직접).
    assert!(conns::validate_one(&pg_entry("Abc_local03", "  ")).is_err());
    assert!(conns::validate_one(&pg_entry("Abc_local03", "db host")).is_err());
    assert!(conns::validate_one(&via_entry("Abc_local03", "web 01")).is_err());
    assert_eq!(conns::validate_one(&via_entry("Abc_local03", "  ")).unwrap().via, None);
    // SQLite — 경로 필수 · 절대 경로 · **SSH 경유 거절**(원격 SQLite 미지원).
    assert!(conns::validate_one(&sqlite_entry("Abc_local04", "relative.db")).is_err());
    let mut no_path = sqlite_entry("Abc_local04", "");
    no_path.path = None;
    assert!(conns::validate_one(&no_path).is_err());
    let mut sq_via = sqlite_entry("Abc_local04", &abs("a.db"));
    sq_via.via = Some("web-01".into());
    let e = conns::validate_one(&sq_via).unwrap_err();
    assert!(e.contains("SQLite"), "{e}");
    // id 규칙(볼트 열쇠) · 같은 id 두 번(경유와 직접 사이도) · 포트 0.
    assert!(conns::validate_one(&sqlite_entry("short", &abs("a.db"))).is_err());
    assert!(conns::validate_list(&[sqlite_entry("Abc_local05", &abs("a.db")), via_entry("Abc_local05", "web-01")]).is_err());
    let mut p0 = pg_entry("Abc_local06", "localhost");
    p0.port = Some(0);
    assert!(conns::validate_one(&p0).is_err());
    // 이름 상한 64자.
    let mut long = pg_entry("Abc_local06", "localhost");
    long.name = "가".repeat(65);
    assert!(conns::validate_one(&long).is_err());
    long.name = "가".repeat(64);
    assert!(conns::validate_one(&long).is_ok());
    // verify-ca 는 CA 파일 필수(쓰기만 — 읽기는 줄을 남기고 접속이 같은 문구로 실패) · verify-full 은 비어도 된다 · 경유도 같다.
    for mut vca in [pg_entry("Abc_local08", "db.example.com"), via_entry("Abc_local08", "web-01")] {
        vca.tls_mode = Some(DbTlsMode::VerifyCa);
        let e = conns::validate_list(std::slice::from_ref(&vca)).unwrap_err();
        assert_eq!(e, crate::db::conns::verify_ca_needs_ca());
        vca.tls_ca = Some("  ".into());
        assert!(conns::validate_list(std::slice::from_ref(&vca)).is_err(), "빈칸만 있는 CA");
        let read = conns::parse(&serde_json::to_string(&[&vca]).unwrap());
        assert_eq!(read.conns.len(), 1, "읽기는 관대: {:?}", read.warnings);
        vca.tls_ca = Some(abs("ca.pem"));
        assert!(conns::validate_list(std::slice::from_ref(&vca)).is_ok());
        vca.tls_mode = Some(DbTlsMode::VerifyFull);
        vca.tls_ca = None;
        assert!(conns::validate_list(std::slice::from_ref(&vca)).is_ok());
    }
    // 개수 상한 — 경유 · 직접 합쳐서.
    let many: Vec<DbConn> = (0..=conns::CONNS_MAX)
        .map(|n| {
            let id = format!("Abc_many{n:03}");
            if n % 2 == 0 { pg_entry(&id, "localhost") } else { via_entry(&id, "web-01") }
        })
        .collect();
    assert!(conns::validate_list(&many).is_err());
    assert!(conns::validate_list(&many[..conns::CONNS_MAX]).is_ok());
}

#[test]
fn conn_list_round_trips_and_reads_leniently() {
    let dir = scratch("conns");
    let path = dir.join("db-connections.json");
    assert_eq!(conns::load_at(&path).unwrap().conns, vec![], "파일이 없으면 빈 목록");
    let saved = conns::save_at(
        &path,
        &[sqlite_entry("Abc_local01", &abs("a.db")), pg_entry("Abc_local02", "127.0.0.1"), via_entry("Abc_local03", "web-01")],
    )
    .unwrap();
    let back = conns::load_at(&path).unwrap();
    assert_eq!(back.conns, saved);
    assert!(back.warnings.is_empty());
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("password"));
    assert!(text.contains("\"via\": \"web-01\""), "{text}");
    // 손으로 적은 password 키는 읽지 않는다 · 깨진 줄·겹친 id·SQLite 경유는 그 줄만 빼고 경고.
    let hand = json!([
        { "id": "Abc_local01", "name": "a", "engine": "sqlite", "path": abs("a.db"), "password": "hunter2" },
        { "id": "Abc_local01", "name": "dup", "engine": "sqlite", "path": abs("b.db") },
        { "id": "Abc_local03", "name": "bad", "engine": "oracle" },
        { "id": "Abc_local04", "name": "remote", "engine": "mysql", "host": "db.example.com", "port": 0 },
        { "id": "Abc_local05", "name": "sq-via", "engine": "sqlite", "via": "web-01", "path": abs("c.db") },
        { "id": "Abc_local06", "name": "prod", "engine": "postgres", "via": "web-01", "host": "localhost", "port": 5432, "password": "hunter3" },
    ]);
    std::fs::write(&path, hand.to_string()).unwrap();
    let back = conns::load_at(&path).unwrap();
    assert_eq!(back.conns.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["Abc_local01", "Abc_local06"]);
    assert_eq!(back.warnings.len(), 4, "{:?}", back.warnings);
    let out = serde_json::to_string(&back.conns).unwrap();
    assert!(!out.contains("hunter2") && !out.contains("hunter3"));
    // 파일 전체가 깨졌으면 빈 목록 + 경고 한 줄.
    std::fs::write(&path, "{nope").unwrap();
    let broken = conns::load_at(&path).unwrap();
    assert!(broken.conns.is_empty() && broken.warnings.len() == 1);
    // 저장은 한 줄이라도 틀리면 파일에 닿지 않는다.
    std::fs::write(&path, "[]").unwrap();
    let mut bad_port = pg_entry("Abc_local09", "db.example.com");
    bad_port.port = None;
    assert!(conns::save_at(&path, &[bad_port]).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "[]");
    let _ = std::fs::remove_dir_all(dir);
}

/// 독의 폴더 칸(10-15) — 다듬기 · 왕복 · 옛 파일(칸 없음) · 경유 따라가기에서도 남는다 · 신원 스냅샷에는 들지 않는다.
#[test]
fn conn_folder_is_kept_and_does_not_touch_identity() {
    let mut d = pg_entry("Abc_fold01", "localhost");
    d.folder = Some(" 운영 // 웹 /".into());
    assert_eq!(conns::validate_one(&d).unwrap().folder.as_deref(), Some("운영/웹"));
    d.folder = Some(" / ".into());
    assert_eq!(conns::validate_one(&d).unwrap().folder, None, "다 비면 최상위");
    d.folder = Some("a\u{7}b".into());
    assert!(conns::validate_one(&d).is_err(), "제어 문자");
    d.folder = Some("x".repeat(256));
    assert!(conns::validate_one(&d).is_err(), "길이 상한");

    let dir = scratch("conns-folder");
    let path = dir.join("db-connections.json");
    // 옛 파일(폴더 칸 없음)은 그대로 읽힌다 — 최상위.
    std::fs::write(&path, json!([{ "id": "Abc_fold02", "name": "a", "engine": "sqlite", "path": abs("a.db") }]).to_string()).unwrap();
    let old = conns::load_at(&path).unwrap();
    assert!(old.warnings.is_empty() && old.conns[0].folder.is_none());
    // 저장 · 다시 읽기 · 호스트 이름 변경을 따라간 저장에서도 폴더가 남는다.
    let mut via = via_entry("Abc_fold03", "web-01");
    via.folder = Some("운영".into());
    conns::save_at(&path, std::slice::from_ref(&via)).unwrap();
    assert!(std::fs::read_to_string(&path).unwrap().contains("\"folder\": \"운영\""));
    assert_eq!(conns::rename_via_at(&path, "web-01", "web-02").unwrap(), 1);
    let back = conns::load_at(&path).unwrap().conns;
    assert_eq!(back[0].folder.as_deref(), Some("운영"));
    // 신원 스냅샷 — 폴더만 다르면 같은 DB 다(폴더를 옮겨도 AI 권한이 풀리지 않는다).
    let mut moved = via.clone();
    moved.folder = Some("다른/곳".into());
    let a = crate::delegation::database::DbIdentity::of(&via, Some("10.0.0.1".into()));
    let b = crate::delegation::database::DbIdentity::of(&moved, Some("10.0.0.1".into()));
    assert!(a.same(&b));
    let _ = std::fs::remove_dir_all(dir);
}

/// 호스트 이름 변경 · 삭제를 따라간다 — `config_edit::edit_host` · `remove_host` 가 부르는 몸.
#[test]
fn conn_list_follows_host_rename_and_removal() {
    let dir = scratch("conns-host");
    let path = dir.join("db-connections.json");
    // 파일이 없으면 둘 다 조용한 no-op(파일을 만들지 않는다).
    assert_eq!(conns::rename_via_at(&path, "web-01", "web-02").unwrap(), 0);
    assert!(conns::remove_via_at(&path, "web-01").unwrap().is_empty());
    assert!(!path.exists());
    conns::save_at(
        &path,
        &[
            via_entry("Abc_via0001", "web-01"),
            via_entry("Abc_via0002", "WEB-01"),
            via_entry("Abc_via0003", "api"),
            pg_entry("Abc_dir0001", "web-01"),
        ],
    )
    .unwrap();
    // 별칭 변경 — 대소문자를 무시하고 그 경유만(직접 연결의 host 글자는 그대로).
    assert_eq!(conns::rename_via_at(&path, "web-01", "web-02").unwrap(), 2);
    let back = conns::load_at(&path).unwrap().conns;
    let via: Vec<Option<&str>> = back.iter().map(|d| d.via.as_deref()).collect();
    assert_eq!(via, [Some("web-02"), Some("web-02"), Some("api"), None]);
    assert_eq!(back[3].host.as_deref(), Some("web-01"));
    // 고칠 것이 없으면 파일에 닿지 않는다(같은 이름 · 없는 별칭).
    let before = std::fs::read_to_string(&path).unwrap();
    assert_eq!(conns::rename_via_at(&path, "web-02", "web-02").unwrap(), 0);
    assert_eq!(conns::rename_via_at(&path, "nope", "x").unwrap(), 0);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    // 삭제 — 그 호스트를 경유하던 줄만 지우고 그 id 들을 돌려준다(볼트 걷기는 프런트).
    let gone = conns::remove_via_at(&path, "Web-02").unwrap();
    assert_eq!(gone, ["Abc_via0001", "Abc_via0002"]);
    let left: Vec<String> = conns::load_at(&path).unwrap().conns.into_iter().map(|d| d.id).collect();
    assert_eq!(left, ["Abc_via0003", "Abc_dir0001"]);
    let _ = std::fs::remove_dir_all(dir);
}

/// 서버가 id 로 해석한 줄 → 붙을 곳 — 직접 · SSH 경유(있는 호스트) · 없는 경유 호스트 · SQLite.
#[test]
fn server_resolves_a_connection_by_id_with_or_without_a_jump_host() {
    use super::table::{resolve_conn, Resolved};
    let known = |a: &str| a.eq_ignore_ascii_case("web-01");
    match resolve_conn(conns::validate_one(&pg_entry("Abc_local02", "db.example.com")).unwrap(), known).unwrap() {
        Resolved::Pg(t) => assert_eq!((t.host.as_str(), t.port, t.via, t.id.as_str()), ("db.example.com", 5432, None, "Abc_local02")),
        other => panic!("{other:?}"),
    }
    let mut my = via_entry("Abc_local03", "WEB-01");
    my.engine = DbEngine::Mariadb;
    match resolve_conn(conns::validate_one(&my).unwrap(), known).unwrap() {
        Resolved::Mysql(t) => assert_eq!((t.host.as_str(), t.via.as_deref(), t.adhoc.is_none()), ("localhost", Some("WEB-01"), true)),
        other => panic!("{other:?}"),
    }
    let e = resolve_conn(conns::validate_one(&via_entry("Abc_local04", "gone-host")).unwrap(), known).unwrap_err();
    assert!(e.contains("'gone-host'"), "{e}");
    match resolve_conn(conns::validate_one(&sqlite_entry("Abc_local01", &abs("a.db"))).unwrap(), known).unwrap() {
        Resolved::Sqlite(p) => assert_eq!(p, abs("a.db")),
        other => panic!("{other:?}"),
    }
    // 파일을 거치지 않은 SQLite + 경유(검증을 건너뛴 줄)도 해석에서 거절.
    let mut sq_via = sqlite_entry("Abc_local01", &abs("a.db"));
    sq_via.via = Some("web-01".into());
    assert!(resolve_conn(sq_via, known).is_err());
}

// ── PostgreSQL(7단계): 바이너리 칸 해석 · 드라이버 설정 · TLS 모드 ──

mod pg_unit {
    use serde_json::{json, Value};
    use tokio_postgres::types::{Kind, Type};

    use crate::db::net::NetTarget;
    use crate::db::pg::config_for;
    use crate::db::pg_value::{array_text, date, decode, interval, numeric, timestamp, type_label};
    use crate::db::value;
    use crate::db::conns::DbTlsMode;

    fn j(ty: &Type, raw: Option<&[u8]>) -> Value {
        value::to_json(decode(ty, raw)).0
    }

    /// numeric 바이너리를 짠다 — `digits` 는 base-10000 자리.
    fn num(weight: i16, sign: u16, dscale: u16, digits: &[i16]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend((digits.len() as i16).to_be_bytes());
        b.extend(weight.to_be_bytes());
        b.extend(sign.to_be_bytes());
        b.extend(dscale.to_be_bytes());
        for d in digits {
            b.extend(d.to_be_bytes());
        }
        b
    }

    /// 1차원 배열 바이너리 — 요소 `None` = NULL.
    fn arr(elem_oid: u32, lbound: i32, items: &[Option<&[u8]>]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend(1i32.to_be_bytes());
        b.extend((items.iter().any(Option::is_none) as i32).to_be_bytes());
        b.extend(elem_oid.to_be_bytes());
        b.extend((items.len() as i32).to_be_bytes());
        b.extend(lbound.to_be_bytes());
        for it in items {
            match it {
                Some(x) => {
                    b.extend((x.len() as i32).to_be_bytes());
                    b.extend(*x);
                }
                None => b.extend((-1i32).to_be_bytes()),
            }
        }
        b
    }

    #[test]
    fn pg_numeric_keeps_every_digit_as_text() {
        assert_eq!(numeric(&num(0, 0, 2, &[123, 4500])).as_deref(), Some("123.45"));
        assert_eq!(numeric(&num(-1, 0, 3, &[10])).as_deref(), Some("0.001"));
        assert_eq!(numeric(&num(1, 0x4000, 0, &[1])).as_deref(), Some("-10000"));
        assert_eq!(numeric(&num(0, 0, 0, &[])).as_deref(), Some("0"));
        assert_eq!(numeric(&num(0, 0, 5, &[])).as_deref(), Some("0.00000"));
        // 2^53 을 넘는 값도 자리를 잃지 않는다(JS 숫자로 보내지 않는다).
        assert_eq!(numeric(&num(4, 0, 2, &[9, 7199, 2547, 4099, 1, 2300])).as_deref(), Some("97199254740990001.23"));
        assert_eq!(numeric(&num(0, 0xC000, 0, &[])).as_deref(), Some("NaN"));
        assert_eq!(numeric(&num(0, 0xD000, 0, &[])).as_deref(), Some("Infinity"));
        assert_eq!(numeric(&num(0, 0xF000, 0, &[])).as_deref(), Some("-Infinity"));
        // 모양이 어긋나면 None(패닉 없음) — 칸은 ‹numeric›.
        assert_eq!(numeric(&[0, 2, 0, 0]), None);
        assert_eq!(numeric(&num(0, 0, 0, &[10_000])), None);
        assert_eq!(j(&Type::NUMERIC, Some(&[1, 2, 3])), json!("‹numeric›"));
        assert_eq!(j(&Type::NUMERIC, Some(&num(0, 0, 1, &[7, 5000]))), json!("7.5"));
    }

    #[test]
    fn pg_dates_and_times_print_like_postgres() {
        assert_eq!(date(0), "2000-01-01");
        assert_eq!(date(-1), "1999-12-31");
        assert_eq!(date(8766), "2024-01-01");
        assert_eq!(date(-730_119), "0001-01-01");
        assert_eq!(date(-730_120), "0001-12-31 BC");
        assert_eq!((date(i32::MAX), date(i32::MIN)), ("infinity".into(), "-infinity".into()));
        assert_eq!(timestamp(0, false), "2000-01-01 00:00:00");
        assert_eq!(timestamp(1_500_000, false), "2000-01-01 00:00:01.5");
        assert_eq!(timestamp(-1, true), "1999-12-31 23:59:59.999999+00");
        assert_eq!(timestamp(i64::MAX, true), "infinity");
        assert_eq!(interval(14, 3, ((4 * 60 + 5) * 60 + 6) * 1_000_000 + 500_000), "1 year 2 mons 3 days 04:05:06.5");
        assert_eq!(interval(0, 0, 0), "00:00:00");
        assert_eq!(interval(0, -1, 0), "-1 days");
        assert_eq!(interval(1, 1, -1_000_000), "1 mon 1 day -00:00:01");
        let time = (13 * 3600 + 7) as i64 * 1_000_000;
        assert_eq!(j(&Type::TIME, Some(&time.to_be_bytes())), json!("13:00:07"));
        let mut tz = time.to_be_bytes().to_vec();
        tz.extend((-9 * 3600i32).to_be_bytes()); // PG 는 UTC 서쪽을 + 로 적는다 — 동쪽 9시간 = -32400
        assert_eq!(j(&Type::TIMETZ, Some(&tz)), json!("13:00:07+09"));
        assert_eq!(j(&Type::DATE, Some(&0i32.to_be_bytes())), json!("2000-01-01"));
        assert_eq!(j(&Type::TIMESTAMPTZ, Some(&0i64.to_be_bytes())), json!("2000-01-01 00:00:00+00"));
        assert_eq!(j(&Type::DATE, Some(&[0, 0])), json!("‹date›"));
    }

    #[test]
    fn pg_scalars_map_to_the_common_cell_shape() {
        assert_eq!(j(&Type::BOOL, Some(&[1])), json!(true));
        assert_eq!(j(&Type::INT2, Some(&(-5i16).to_be_bytes())), json!(-5));
        assert_eq!(j(&Type::INT4, Some(&7i32.to_be_bytes())), json!(7));
        assert_eq!(j(&Type::INT8, Some(&(1i64 << 60).to_be_bytes())), json!((1i64 << 60).to_string()));
        assert_eq!(j(&Type::OID, Some(&4_000_000_000u32.to_be_bytes())), json!(4_000_000_000u64));
        assert_eq!(j(&Type::FLOAT4, Some(&0.1f32.to_be_bytes())), json!(0.1));
        assert_eq!(j(&Type::FLOAT8, Some(&f64::NAN.to_be_bytes())), json!("NaN"));
        assert_eq!(j(&Type::FLOAT8, Some(&f64::NEG_INFINITY.to_be_bytes())), json!("-Infinity"));
        assert_eq!(j(&Type::TEXT, Some("한글".as_bytes())), json!("한글"));
        assert_eq!(j(&Type::BPCHAR, Some(b"ab  ")), json!("ab  "));
        assert_eq!(j(&Type::JSON, Some(br#"{"a":1}"#)), json!(r#"{"a":1}"#));
        assert_eq!(j(&Type::JSONB, Some(b"\x01{\"a\": 1}")), json!(r#"{"a": 1}"#));
        assert_eq!(j(&Type::JSONB, Some(b"\x02{}")), json!("‹jsonb›"));
        assert_eq!(j(&Type::BYTEA, Some(&[0xde, 0xad])), json!({ "$bytes": 2, "hex": "dead" }));
        assert_eq!(j(&Type::INT4, None), Value::Null);
        assert_eq!(j(&Type::INT4, Some(&[0, 0, 1])), json!("‹int4›"));
        let uuid: Vec<u8> = (0u8..16).collect();
        assert_eq!(j(&Type::UUID, Some(&uuid)), json!("00010203-0405-0607-0809-0a0b0c0d0e0f"));
        assert_eq!(j(&Type::INET, Some(&[2, 32, 0, 4, 192, 168, 0, 1])), json!("192.168.0.1"));
        assert_eq!(j(&Type::INET, Some(&[2, 24, 0, 4, 192, 168, 0, 5])), json!("192.168.0.5/24"));
        assert_eq!(j(&Type::CIDR, Some(&[2, 8, 1, 4, 10, 0, 0, 0])), json!("10.0.0.0/8"));
        let mut v6 = vec![3, 128, 0, 16];
        v6.extend(std::net::Ipv6Addr::LOCALHOST.octets());
        assert_eq!(j(&Type::INET, Some(&v6)), json!("::1"));
        assert_eq!(j(&Type::MACADDR, Some(&[8, 0, 0x2b, 1, 2, 3])), json!("08:00:2b:01:02:03"));
        assert_eq!(j(&Type::MONEY, Some(&(-1234i64).to_be_bytes())), json!("-12.34"));
        assert_eq!(j(&Type::PG_LSN, Some(&0x1_0000_00A0u64.to_be_bytes())), json!("1/A0"));
        let mut bits = 5i32.to_be_bytes().to_vec();
        bits.push(0b1010_1000);
        assert_eq!(j(&Type::VARBIT, Some(&bits)), json!("10101"));
        assert_eq!(j(&Type::CHAR, Some(b"x")), json!("x"));
    }

    #[test]
    fn pg_kinds_enum_domain_extension_and_unknown_fall_back_without_panicking() {
        let mood = Type::new("mood".into(), 90_001, Kind::Enum(vec!["ok".into()]), "public".into());
        assert_eq!(j(&mood, Some(b"ok")), json!("ok"));
        let pos = Type::new("posint".into(), 90_002, Kind::Domain(Type::INT4), "public".into());
        assert_eq!(j(&pos, Some(&3i32.to_be_bytes())), json!(3));
        let citext = Type::new("citext".into(), 90_003, Kind::Simple, "public".into());
        assert_eq!(j(&citext, Some(b"MiXeD")), json!("MiXeD"));
        let comp = Type::new("pair".into(), 90_004, Kind::Composite(vec![]), "public".into());
        assert_eq!(j(&comp, Some(&[0, 0, 0, 0])), json!("‹pair›"));
        assert_eq!(j(&Type::INT4_RANGE, Some(&[1])), json!("‹int4range›"));
        assert_eq!(j(&Type::BOX, Some(&[0; 32])), json!("‹box›"));
        let ext = Type::new("hstore".into(), 90_005, Kind::Simple, "public".into());
        assert_eq!(j(&ext, Some(b"x")), json!("‹hstore›"));
        assert_eq!(type_label(&Type::INT4_ARRAY), "int4[]");
        assert_eq!(type_label(&Type::TEXT), "text");
    }

    #[test]
    fn pg_arrays_print_as_postgres_text() {
        let one = 1i32.to_be_bytes();
        let two = 2i32.to_be_bytes();
        let ints = arr(23, 1, &[Some(&one), Some(&two), None]);
        assert_eq!(j(&Type::INT4_ARRAY, Some(&ints)), json!("{1,2,NULL}"));
        let texts = arr(25, 1, &[Some(b"a b"), Some(b"c"), Some(b""), Some(b"NULL"), Some(b"q\"\\")]);
        assert_eq!(array_text(&Type::TEXT, &texts).as_deref(), Some(r#"{"a b",c,"","NULL","q\"\\"}"#));
        let shifted = arr(23, 0, &[Some(&one), Some(&two)]);
        assert_eq!(array_text(&Type::INT4, &shifted).as_deref(), Some("[0:1]={1,2}"));
        // 2차원 — {{1,2},{1,2}}
        let mut two_d = Vec::new();
        two_d.extend(2i32.to_be_bytes());
        two_d.extend(0i32.to_be_bytes());
        two_d.extend(23u32.to_be_bytes());
        for _ in 0..2 {
            two_d.extend(2i32.to_be_bytes());
            two_d.extend(1i32.to_be_bytes());
        }
        for _ in 0..2 {
            for v in [&one, &two] {
                two_d.extend(4i32.to_be_bytes());
                two_d.extend(v.as_slice());
            }
        }
        assert_eq!(array_text(&Type::INT4, &two_d).as_deref(), Some("{{1,2},{1,2}}"));
        let mut empty = Vec::new();
        empty.extend(0i32.to_be_bytes());
        empty.extend(0i32.to_be_bytes());
        empty.extend(23u32.to_be_bytes());
        assert_eq!(array_text(&Type::INT4, &empty).as_deref(), Some("{}"));
        let bools = arr(16, 1, &[Some(&[1]), Some(&[0])]);
        assert_eq!(j(&Type::BOOL_ARRAY, Some(&bools)), json!("{t,f}"));
        let nums = arr(1700, 1, &[Some(&num(0, 0, 1, &[1, 5000]))]);
        assert_eq!(j(&Type::NUMERIC_ARRAY, Some(&nums)), json!("{1.5}"));
        // 잘린 배열 · 남는 바이트 · 풀 수 없는 요소 → ‹…[]›.
        assert_eq!(j(&Type::INT4_ARRAY, Some(&ints[..ints.len() - 2])), json!("‹int4[]›"));
        let mut extra = ints.clone();
        extra.push(0);
        assert_eq!(j(&Type::INT4_ARRAY, Some(&extra)), json!("‹int4[]›"));
        let boxes = arr(603, 1, &[Some(&[0; 32])]);
        assert_eq!(j(&Type::BOX_ARRAY, Some(&boxes)), json!("‹box[]›"));
        // 차원 수가 터무니없으면 거절(할당 폭주 없음).
        let mut huge = Vec::new();
        huge.extend(1i32.to_be_bytes());
        huge.extend(0i32.to_be_bytes());
        huge.extend(23u32.to_be_bytes());
        huge.extend(i32::MAX.to_be_bytes());
        huge.extend(1i32.to_be_bytes());
        assert_eq!(j(&Type::INT4_ARRAY, Some(&huge)), json!("‹int4[]›"));
    }

    fn target(via: Option<&str>) -> NetTarget {
        NetTarget {
            id: "Kp3_pg-main01".into(),
            host: "db.internal".into(),
            port: 5433,
            database: Some("shop".into()),
            user: Some("reader".into()),
            tls: DbTlsMode::Prefer,
            tls_ca: None,
            via: via.map(str::to_string),
            adhoc: None,
        }
    }

    #[test]
    fn pg_config_dials_the_tunnel_but_keeps_the_preset_name() {
        let addr: std::net::SocketAddr = "127.0.0.1:49152".parse().unwrap();
        let c = config_for(&target(Some("web-01")), Some(addr));
        assert_eq!(c.get_hostaddrs(), [addr.ip()]);
        assert!(matches!(&c.get_hosts()[0], tokio_postgres::config::Host::Tcp(h) if h == "db.internal"));
        assert_eq!(c.get_ports(), [49152]);
        assert_eq!(c.get_options(), None, "시작 옵션 없음 — 트랜잭션 모드 풀러(PgBouncer)가 거절한다");
        assert_eq!((c.get_user(), c.get_dbname()), (Some("reader"), Some("shop")));
        assert_eq!(c.get_ssl_mode(), tokio_postgres::config::SslMode::Prefer, "모드 그대로(prefer)");
        assert_eq!(c.get_password(), None, "설정 짜기는 비밀번호를 모른다");
        // 경유 없음 — 프리셋 주소 그대로.
        let d = config_for(&target(None), None);
        assert!(d.get_hostaddrs().is_empty());
        assert_eq!(d.get_ports(), [5433]);
        assert_eq!(d.get_options(), None);
    }

    #[test]
    fn pg_tls_modes_map_to_driver_ssl_modes() {
        use crate::db::pg::ssl_mode_for;
        use tokio_postgres::config::SslMode;
        assert_eq!(ssl_mode_for(DbTlsMode::Disable), SslMode::Disable);
        assert_eq!(ssl_mode_for(DbTlsMode::Prefer), SslMode::Prefer);
        for m in [DbTlsMode::Require, DbTlsMode::VerifyCa, DbTlsMode::VerifyFull] {
            assert_eq!(ssl_mode_for(m), SslMode::Require, "{m:?}");
        }
        // 터널 뒤에서도 TLS 이름은 프리셋 host(위 시험) — 모드는 설정에 그대로 실린다.
        let mut t = target(Some("web-01"));
        t.tls = DbTlsMode::VerifyFull;
        assert_eq!(config_for(&t, None).get_ssl_mode(), SslMode::Require);
    }

    /// 트랜잭션 밖 문장(`VACUUM` …) 재시도 갈래 — 25001 이고 행을 돌려주지 않을 때만.
    #[test]
    fn pg_retries_outside_transaction_only_on_25001_without_rows() {
        use crate::db::pg::retry_outside_transaction;
        use tokio_postgres::error::SqlState;
        assert!(retry_outside_transaction(Some(&SqlState::ACTIVE_SQL_TRANSACTION), false));
        assert!(!retry_outside_transaction(Some(&SqlState::ACTIVE_SQL_TRANSACTION), true), "행을 돌려주는 문장은 아님");
        for other in [
            SqlState::READ_ONLY_SQL_TRANSACTION,
            SqlState::QUERY_CANCELED,
            SqlState::NO_ACTIVE_SQL_TRANSACTION,
            SqlState::IN_FAILED_SQL_TRANSACTION,
            SqlState::SYNTAX_ERROR,
        ] {
            assert!(!retry_outside_transaction(Some(&other), false), "{}", other.code());
        }
        assert!(!retry_outside_transaction(None, false), "드라이버 오류(연결 끊김 등)는 아님");
    }

    /// 세션 상태를 두지 않는다(트랜잭션 모드 풀러 — pg 머리말 "풀러") — 소스 훑기: 주석 밖 코드에 시작 옵션 · 세션 SET ·
    /// `SET LOCAL` 아닌 `statement_timeout` 이 없고, `set_write` 의 몸에 서버로 가는 호출이 없다.
    #[test]
    fn pg_engine_keeps_no_session_state() {
        let src = include_str!("pg.rs").replace("\r\n", "\n");
        let code: Vec<&str> = src
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect();
        for l in &code {
            assert!(!l.contains(".options("), "시작 옵션: {l}");
            assert!(!l.contains("SET SESSION"), "세션 SET: {l}");
            assert!(!l.contains("default_transaction_read_only"), "세션 기본값: {l}");
            if l.contains("statement_timeout") {
                assert!(l.contains("SET LOCAL statement_timeout"), "세션 statement_timeout: {l}");
            }
        }
        let body = src.split("pub(crate) async fn set_write").nth(1).expect("set_write");
        let body = &body[..body.find("\n    }\n").expect("set_write 끝")];
        for call in ["execute", "query", "prepare", "simple_query", "batch_execute", ".await"] {
            assert!(!body.contains(call), "set_write 가 서버에 닿는다: {call}");
        }
    }
}

// ── MySQL · MariaDB(8단계): 칸 해석 · 드라이버 옵션 · 갈래(시간 제한) · 오류 꼴 ──

mod mysql_unit {
    use mysql_async::consts::{ColumnFlags, ColumnType};
    use mysql_async::{Column, Opts, Value};
    use serde_json::{json, Value as J};

    use crate::db::mysql::{connect_error, engine_error, opts_for, Flavor};
    use crate::db::mysql_value::{bit_text, decode, type_label};
    use crate::db::net::NetTarget;
    use crate::db::{value, EngineError};
    use crate::db::conns::DbTlsMode;

    fn col(ty: ColumnType) -> Column {
        // 연결 문자셋 utf8mb4(45) — 글자 칸의 기본.
        Column::new(ty).with_character_set(45)
    }

    fn j(c: &Column, v: Value) -> J {
        value::to_json(decode(c, Some(&v))).0
    }

    #[test]
    fn mysql_integers_keep_sign_and_js_safe_range() {
        use ColumnType::*;
        assert_eq!(j(&col(MYSQL_TYPE_LONG), Value::Int(-7)), json!(-7));
        assert_eq!(j(&col(MYSQL_TYPE_LONGLONG), Value::Int(9_007_199_254_740_993)), json!("9007199254740993"));
        let unsigned = col(MYSQL_TYPE_LONGLONG).with_flags(ColumnFlags::UNSIGNED_FLAG);
        assert_eq!(j(&unsigned, Value::UInt(42)), json!(42));
        assert_eq!(j(&unsigned, Value::UInt(u64::MAX)), json!("18446744073709551615"));
        assert_eq!(type_label(&unsigned), "bigint unsigned");
        assert_eq!(j(&col(MYSQL_TYPE_YEAR), Value::Int(2024)), json!(2024));
        // 글자 프로토콜로 와도 같은 꼴.
        assert_eq!(j(&unsigned, Value::Bytes(b"18446744073709551615".to_vec())), json!("18446744073709551615"));
        assert_eq!(j(&col(MYSQL_TYPE_TINY), Value::Bytes(b"-3".to_vec())), json!(-3));
        assert_eq!(j(&col(MYSQL_TYPE_LONG), Value::NULL), J::Null);
        assert_eq!(value::to_json(decode(&col(MYSQL_TYPE_LONG), None)).0, J::Null);
    }

    #[test]
    fn mysql_floats_and_decimals() {
        use ColumnType::*;
        assert_eq!(j(&col(MYSQL_TYPE_FLOAT), Value::Float(0.1)), json!(0.1), "f32 가 0.10000000149 로 넓어지지 않는다");
        assert_eq!(j(&col(MYSQL_TYPE_DOUBLE), Value::Double(1.5)), json!(1.5));
        assert_eq!(j(&col(MYSQL_TYPE_DOUBLE), Value::Bytes(b"2.25".to_vec())), json!(2.25));
        let dec = col(MYSQL_TYPE_NEWDECIMAL).with_character_set(63);
        assert_eq!(j(&dec, Value::Bytes(b"12345678901234567890.12345".to_vec())), json!("12345678901234567890.12345"));
        assert_eq!(type_label(&dec), "decimal");
    }

    #[test]
    fn mysql_dates_follow_the_column_fsp() {
        use ColumnType::*;
        let date = col(MYSQL_TYPE_DATE);
        assert_eq!(j(&date, Value::Date(2024, 2, 29, 0, 0, 0, 0)), json!("2024-02-29"));
        assert_eq!(j(&date, Value::Date(0, 0, 0, 0, 0, 0, 0)), json!("0000-00-00"));
        let dt = col(MYSQL_TYPE_DATETIME);
        assert_eq!(j(&dt, Value::Date(2024, 2, 29, 13, 45, 1, 0)), json!("2024-02-29 13:45:01"));
        let dt3 = col(MYSQL_TYPE_DATETIME).with_decimals(3);
        assert_eq!(j(&dt3, Value::Date(2024, 2, 29, 13, 45, 1, 500_000)), json!("2024-02-29 13:45:01.500"));
        let ts6 = col(MYSQL_TYPE_TIMESTAMP).with_decimals(6);
        assert_eq!(j(&ts6, Value::Date(2024, 1, 1, 0, 0, 0, 1)), json!("2024-01-01 00:00:00.000001"));
        // 식의 값(소수 자리 고정 안 됨 = 31) — 마이크로초가 있을 때만 6자리.
        let expr = col(MYSQL_TYPE_DATETIME).with_decimals(31);
        assert_eq!(j(&expr, Value::Date(2024, 1, 1, 0, 0, 0, 0)), json!("2024-01-01 00:00:00"));
        assert_eq!(j(&expr, Value::Date(2024, 1, 1, 0, 0, 0, 250)), json!("2024-01-01 00:00:00.000250"));
        let time = col(MYSQL_TYPE_TIME);
        assert_eq!(j(&time, Value::Time(false, 0, 13, 45, 1, 0)), json!("13:45:01"));
        assert_eq!(j(&time, Value::Time(true, 34, 22, 59, 59, 0)), json!("-838:59:59"));
        assert_eq!(j(&col(MYSQL_TYPE_TIME).with_decimals(2), Value::Time(false, 0, 0, 0, 1, 250_000)), json!("00:00:01.25"));
    }

    #[test]
    fn mysql_text_bytes_and_unknown_types() {
        use ColumnType::*;
        assert_eq!(j(&col(MYSQL_TYPE_VAR_STRING), Value::Bytes("한글".as_bytes().to_vec())), json!("한글"));
        assert_eq!(type_label(&col(MYSQL_TYPE_VAR_STRING)), "varchar");
        let text = col(MYSQL_TYPE_BLOB);
        assert_eq!((type_label(&text), j(&text, Value::Bytes(b"t".to_vec()))), ("text".into(), json!("t")));
        let blob = Column::new(MYSQL_TYPE_BLOB).with_character_set(63);
        assert_eq!(type_label(&blob), "blob");
        assert_eq!(j(&blob, Value::Bytes(vec![0xde, 0xad])), json!({ "$bytes": 2, "hex": "dead" }));
        let varbin = Column::new(MYSQL_TYPE_VAR_STRING).with_character_set(63);
        assert_eq!(type_label(&varbin), "varbinary");
        assert_eq!(j(&varbin, Value::Bytes(vec![1])), json!({ "$bytes": 1, "hex": "01" }));
        // JSON 은 문자셋이 binary 로 와도 글자다.
        let js = Column::new(MYSQL_TYPE_JSON).with_character_set(63);
        assert_eq!(j(&js, Value::Bytes(br#"{"a": 1}"#.to_vec())), json!(r#"{"a": 1}"#));
        let en = col(MYSQL_TYPE_STRING).with_flags(ColumnFlags::ENUM_FLAG);
        assert_eq!((type_label(&en), j(&en, Value::Bytes(b"red".to_vec()))), ("enum".into(), json!("red")));
        let set = col(MYSQL_TYPE_STRING).with_flags(ColumnFlags::SET_FLAG);
        assert_eq!(type_label(&set), "set");
        let geo = Column::new(MYSQL_TYPE_GEOMETRY).with_character_set(63);
        assert_eq!(j(&geo, Value::Bytes(vec![0; 25])), json!("‹geometry›"));
        let vector = Column::new(MYSQL_TYPE_VECTOR).with_character_set(63);
        assert_eq!(j(&vector, Value::Bytes(vec![0; 8])), json!("‹vector›"));
        // UTF-8 이 아닌 글자 칸은 대체 글자로(패닉 없음).
        assert_eq!(j(&col(MYSQL_TYPE_VAR_STRING), Value::Bytes(vec![0xff, b'a'])), json!("\u{fffd}a"));
    }

    #[test]
    fn mysql_bits_read_as_bit_strings() {
        assert_eq!(bit_text(&[0b0001_0110], 5), "10110");
        assert_eq!(bit_text(&[0x01, 0x00], 9), "100000000");
        assert_eq!(bit_text(&[0xff], 8), "11111111");
        assert_eq!(bit_text(&[0x05], 0), "00000101");
        assert_eq!(bit_text(&[0x05], 12), "000000000101");
        let c = Column::new(ColumnType::MYSQL_TYPE_BIT).with_character_set(63).with_column_length(3);
        assert_eq!(j(&c, Value::Bytes(vec![0b101])), json!("101"));
    }

    fn target(via: Option<&str>) -> NetTarget {
        NetTarget {
            id: "Kp3_my-main01".into(),
            host: "db.internal".into(),
            port: 3307,
            database: Some("shop".into()),
            user: Some("reader".into()),
            tls: DbTlsMode::Prefer,
            tls_ca: None,
            via: via.map(str::to_string),
            adhoc: None,
        }
    }

    #[test]
    fn mysql_opts_dial_the_tunnel_without_secrets_or_sockets() {
        let addr: std::net::SocketAddr = "127.0.0.1:49152".parse().unwrap();
        let o: Opts = opts_for(&target(Some("web-01")), Some(addr)).into();
        assert_eq!((o.ip_or_hostname(), o.tcp_port()), ("127.0.0.1", 49152));
        assert_eq!((o.user(), o.db_name()), (Some("reader"), Some("shop")));
        assert_eq!(o.pass(), None, "옵션 짜기는 비밀번호를 모른다");
        assert!(!o.prefer_socket(), "루프백 터널에 붙은 뒤 이 PC 의 소켓으로 갈아타지 않는다");
        assert_eq!(o.stmt_cache_size(), 0);
        assert!(!o.enable_cleartext_plugin());
        assert!(o.ssl_opts().is_none(), "opts_for 는 TLS 를 모른다 — SslOpts 는 mysql_tls::ssl_opts_for 가 따로 얹는다");
        assert!(o.local_infile_handler().is_none(), "LOAD DATA LOCAL 처리기 없음");
        let d: Opts = opts_for(&target(None), None).into();
        assert_eq!((d.ip_or_hostname(), d.tcp_port()), ("db.internal", 3307));
    }

    #[test]
    fn mariadb_column_defaults_read_like_mysql() {
        let s = |v: &str| Some(v.to_string());
        let m = Flavor::Mariadb;
        assert_eq!(m.column_default(s("'x'")), s("x"));
        assert_eq!(m.column_default(s("'it''s'")), s("it's"));
        assert_eq!(m.column_default(s("''")), s(""));
        assert_eq!(m.column_default(s("'NULL'")), s("NULL"), "글자 'NULL' 은 글자");
        assert_eq!(m.column_default(s("NULL")), None, "식 NULL 은 null");
        assert_eq!(m.column_default(None), None);
        assert_eq!(m.column_default(s("current_timestamp()")), s("current_timestamp()"));
        assert_eq!(m.column_default(s("0")), s("0"));
        assert_eq!(m.column_default(s("'")), s("'"), "따옴표 하나는 리터럴이 아니다");
        // MySQL 은 이미 그 꼴 — 손대지 않는다(글자 값 `NULL` 도 그대로).
        assert_eq!(Flavor::Mysql.column_default(s("'x'")), s("'x'"));
        assert_eq!(Flavor::Mysql.column_default(s("NULL")), s("NULL"));
    }

    #[test]
    fn mysql_flavor_picks_the_time_limit() {
        assert_eq!(Flavor::from_version("8.4.11"), Flavor::Mysql);
        assert_eq!(Flavor::from_version("11.8.9-MariaDB-ubu2404"), Flavor::Mariadb);
        assert_eq!(Flavor::from_version("5.5.5-10.11.6-MariaDB"), Flavor::Mariadb);
        assert_eq!(Flavor::Mysql.version_label("8.4.11"), "MySQL 8.4.11");
        assert_eq!(Flavor::Mariadb.version_label("11.8.9-MariaDB-ubu2404"), "MariaDB 11.8.9");
        assert_eq!(
            Flavor::Mysql.limits_sql(Some(1001), 30_000),
            "SET SESSION sql_select_limit = 1001, SESSION max_execution_time = 30000"
        );
        assert_eq!(
            Flavor::Mariadb.limits_sql(Some(101), 1_500),
            "SET SESSION sql_select_limit = 101, SESSION max_statement_time = 1.500"
        );
        assert_eq!(
            Flavor::Mariadb.limits_sql(None, 30_000),
            "SET SESSION sql_select_limit = DEFAULT, SESSION max_statement_time = 30.000"
        );
        assert!(Flavor::Mysql.reset_sql().contains("max_execution_time = DEFAULT"));
        assert!(Flavor::Mariadb.reset_sql().contains("max_statement_time = DEFAULT"));
        // MySQL 의 max_execution_time 은 SELECT 에만 — 나머지는 앱 타이머(KILL QUERY). MariaDB 는 모든 문장.
        assert!(Flavor::Mysql.server_times("SELECT"));
        for k in ["INSERT", "UPDATE", "WITH", "SHOW", "CALL"] {
            assert!(!Flavor::Mysql.server_times(k), "{k}");
            assert!(Flavor::Mariadb.server_times(k), "{k}");
        }
    }

    fn server(code: u16, msg: &str) -> mysql_async::Error {
        mysql_async::Error::Server(mysql_async::ServerError {
            code,
            message: msg.into(),
            state: "28000".into(),
        })
    }

    #[test]
    fn mysql_auth_errors_carry_the_reasons() {
        let denied = server(1045, "Access denied for user 'u'@'172.17.0.1' (using password: NO)");
        let m = connect_error(&denied, false, false, "MySQL");
        assert!(m.contains("[db-password]") && !m.contains("[db-auth]"), "{m}");
        let m = connect_error(&server(1045, "Access denied (using password: YES)"), true, false, "MySQL");
        assert!(m.contains("[db-auth]") && !m.contains("[db-stored-rejected]") && m.contains("1045"), "{m}");
        let m = connect_error(&server(1045, "Access denied (using password: YES)"), true, true, "MySQL");
        assert!(m.contains("[db-auth]") && m.contains("[db-stored-rejected]"), "{m}");
        let m = connect_error(&server(1049, "Unknown database 'x'"), true, false, "MySQL / MariaDB");
        assert!(!m.contains("[db-"), "{m}");
        assert!(m.contains("Unknown database") && m.contains("1049"), "{m}");
    }

    #[test]
    fn mysql_engine_errors_sort_interrupts_and_read_only() {
        for code in [1317, 3024, 1969] {
            assert_eq!(engine_error(&server(code, "interrupted"), Flavor::Mysql), EngineError::Interrupted, "{code}");
        }
        let EngineError::Message(m) = engine_error(&server(1792, "Cannot execute statement in a READ ONLY transaction."), Flavor::Mysql) else {
            panic!("1792 는 문구")
        };
        assert!(m.contains("1792") && (m.contains("읽기 전용") || m.contains("read-only")), "{m}");
        let EngineError::Message(m) = engine_error(&server(1064, "syntax"), Flavor::Mariadb) else {
            panic!("1064 는 문구")
        };
        assert!(m.contains("MariaDB") && m.contains("1064"), "{m}");
        let closed = mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed);
        let EngineError::Message(m) = engine_error(&closed, Flavor::Mysql) else {
            panic!("끊김은 문구")
        };
        assert!(m.contains("[db-disconnected]"), "{m}");
    }
}

// ── TLS(9단계): CA 파일 · 검증기(모드별) · 인증서 이름 · 오류 문구 · MySQL 손잡이 · 탐침 인사 패킷 ──

mod tls_unit {
    use std::sync::Arc;

    use rustls::client::danger::ServerCertVerifier;
    use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use rustls::CertificateError;

    use crate::db::mysql::no_server_ssl;
    use crate::db::mysql_tls::{cert_names, greeting_offers_ssl, name_for, ssl_opts_for};
    use crate::db::tls::{self, CaFile};
    use crate::db::conns::DbTlsMode;

    const CA: &[u8] = include_bytes!("testdata/ca.pem");
    const OTHER_CA: &[u8] = include_bytes!("testdata/other-ca.pem");
    const SRV_DNS: &[u8] = include_bytes!("testdata/server-dns.pem");
    const SRV_IP: &[u8] = include_bytes!("testdata/server-ip.pem");
    const SRV_WILD: &[u8] = include_bytes!("testdata/server-wild.pem");
    const SRV_NOSAN: &[u8] = include_bytes!("testdata/server-nosan.pem");

    fn ca_file(pem: &[u8]) -> CaFile {
        CaFile {
            pem: pem.to_vec(),
            certs: tls::parse_ca_pem(pem, "x.pem").unwrap(),
        }
    }

    fn der(pem: &[u8]) -> CertificateDer<'static> {
        tls::parse_ca_pem(pem, "x.pem").unwrap().remove(0)
    }

    fn name(s: &str) -> ServerName<'static> {
        ServerName::try_from(s.to_string()).unwrap()
    }

    fn check(v: &Arc<dyn ServerCertVerifier>, cert: &[u8], host: &str, now: UnixTime) -> Result<(), rustls::Error> {
        v.verify_server_cert(&der(cert), &[], &name(host), &[], now).map(|_| ())
    }

    fn cert_err(r: Result<(), rustls::Error>) -> CertificateError {
        match r {
            Err(rustls::Error::InvalidCertificate(c)) => c,
            other => panic!("인증서 오류여야: {other:?}"),
        }
    }

    /// 픽스처 인증서의 만료(2126-09) 뒤.
    fn after_expiry() -> UnixTime {
        UnixTime::since_unix_epoch(std::time::Duration::from_secs(5_000_000_000))
    }

    #[test]
    fn ca_files_are_pem_bundles_and_read_only_in_verify_modes() {
        let mut bundle = CA.to_vec();
        bundle.extend_from_slice(OTHER_CA);
        assert_eq!(tls::parse_ca_pem(&bundle, "b.pem").unwrap().len(), 2, "여러 인증서");
        // CRLF 로 바뀐 체크아웃에서도.
        let crlf = String::from_utf8(CA.to_vec()).unwrap().replace('\n', "\r\n");
        assert_eq!(tls::parse_ca_pem(crlf.as_bytes(), "c.pem").unwrap().len(), 1);
        for bad in [&b"not a pem"[..], b"", b"-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----\n"] {
            let e = tls::parse_ca_pem(bad, "C:\\x\\bad.pem").unwrap_err();
            assert!(e.contains("C:\\x\\bad.pem") && e.contains("PEM"), "{e}");
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let missing = std::env::temp_dir().join("aynx-no-such-ca.pem").to_string_lossy().into_owned();
            let e = tls::read_ca(DbTlsMode::VerifyFull, Some(&missing)).await.unwrap_err();
            assert!(e.contains(&missing), "{e}");
            // 검증하지 않는 모드는 CA 파일을 읽지 않는다(숨은 동작 없음) · 빈 경로도 없음.
            for m in [DbTlsMode::Disable, DbTlsMode::Prefer, DbTlsMode::Require] {
                assert!(tls::read_ca(m, Some(&missing)).await.unwrap().is_none(), "{m:?}");
            }
            // verify-ca 는 CA 파일 필수 — 빈 경로·없음은 저장 거절과 같은 문구로 실패(파일에 남은 줄). verify-full 은 비어도 된다.
            let need = crate::db::conns::verify_ca_needs_ca();
            assert_eq!(tls::read_ca(DbTlsMode::VerifyCa, Some("  ")).await.unwrap_err(), need);
            assert_eq!(tls::read_ca(DbTlsMode::VerifyCa, None).await.unwrap_err(), need);
            assert!(tls::read_ca(DbTlsMode::VerifyFull, None).await.unwrap().is_none());
            let dir = std::env::temp_dir().to_string_lossy().into_owned();
            assert!(tls::read_ca(DbTlsMode::VerifyCa, Some(&dir)).await.is_err(), "폴더는 거절");
            let path = std::env::temp_dir().join("aynx-tls-unit-ca.pem");
            std::fs::write(&path, CA).unwrap();
            let got = tls::read_ca(DbTlsMode::VerifyCa, Some(&path.to_string_lossy())).await.unwrap().unwrap();
            assert_eq!((got.pem.as_slice(), got.certs.len()), (CA, 1));
            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn verifiers_follow_the_mode() {
        let ca = ca_file(CA);
        let now = UnixTime::now();
        assert!(tls::verifier(DbTlsMode::Disable, Some(&ca)).unwrap().is_none());
        // prefer · require — 아무 인증서나(이름 · 발급자 · 기간 모두 안 봄).
        for m in [DbTlsMode::Prefer, DbTlsMode::Require] {
            let v = tls::verifier(m, None).unwrap().unwrap();
            check(&v, SRV_DNS, "anything.example", now).unwrap();
            check(&v, SRV_NOSAN, "x", after_expiry()).unwrap();
        }
        // verify-ca — CA 파일이 있으면 이름이 틀려도 통과 · CA 가 없으면 검증기를 만들지 않고 · 다른 CA 면 알 수 없는 발급자 · 만료는 실패.
        let v = tls::verifier(DbTlsMode::VerifyCa, Some(&ca)).unwrap().unwrap();
        check(&v, SRV_DNS, "db.test", now).unwrap();
        check(&v, SRV_DNS, "wrong.example", now).unwrap();
        check(&v, SRV_NOSAN, "db.test", now).unwrap();
        assert!(matches!(cert_err(check(&v, SRV_DNS, "db.test", after_expiry())), CertificateError::ExpiredContext { .. }));
        assert_eq!(tls::verifier(DbTlsMode::VerifyCa, None).err(), Some(crate::db::conns::verify_ca_needs_ca()));
        assert!(tls::verifier(DbTlsMode::VerifyCa, Some(&tls::CaFile::default())).is_err(), "인증서 없는 CA 묶음도 거절");
        let other = tls::verifier(DbTlsMode::VerifyCa, Some(&ca_file(OTHER_CA))).unwrap().unwrap();
        assert_eq!(cert_err(check(&other, SRV_DNS, "db.test", now)), CertificateError::UnknownIssuer);
        // verify-full — 체인 + 이름(DNS 는 DNS SAN, IP 는 IP SAN).
        let v = tls::verifier(DbTlsMode::VerifyFull, Some(&ca)).unwrap().unwrap();
        check(&v, SRV_DNS, "db.test", now).unwrap();
        assert!(matches!(cert_err(check(&v, SRV_DNS, "wrong.example", now)), CertificateError::NotValidForNameContext { .. }));
        check(&v, SRV_IP, "10.0.0.5", now).unwrap();
        assert!(matches!(cert_err(check(&v, SRV_IP, "10.0.0.6", now)), CertificateError::NotValidForNameContext { .. }));
        assert!(check(&v, SRV_IP, "db.test", now).is_err(), "IP SAN 만 있는 인증서는 DNS 이름에 안 맞는다");
        assert!(check(&v, SRV_DNS, "127.0.0.1", now).is_err(), "터널 주소로는 안 맞는다 — 프리셋 이름을 써야");
        check(&v, SRV_WILD, "a.corp.test", now).unwrap();
        assert!(check(&v, SRV_NOSAN, "db.test", now).is_err(), "CN 은 보지 않는다");
        let none = tls::verifier(DbTlsMode::VerifyFull, None).unwrap().unwrap();
        assert_eq!(cert_err(check(&none, SRV_DNS, "db.test", now)), CertificateError::UnknownIssuer);
        // 클라이언트 설정이 공급자와 함께 선다.
        assert!(tls::client_config(v).is_ok());
    }

    #[test]
    fn certificate_errors_explain_the_cause() {
        let base = "서버 인증서를 확인하지 못했습니다. 사내·클라우드 인증서라면 연결 설정에 CA 파일을 지정하세요.";
        let m = |c: CertificateError| tls::cert_error(&rustls::Error::InvalidCertificate(c), "db.test").unwrap();
        let unknown = m(CertificateError::UnknownIssuer);
        assert!(unknown.starts_with(base) && unknown.contains("알 수 없는 인증 기관"), "{unknown}");
        assert!(m(CertificateError::Expired).contains("만료"));
        let name = m(CertificateError::NotValidForName);
        assert!(name.contains("'db.test'"), "{name}");
        assert!(tls::cert_error(&rustls::Error::DecryptError, "x").is_none(), "인증서 오류가 아니면 없음");
        // 드라이버가 io::Error 로 감싸 올려도 찾는다(tokio-rustls · tokio-postgres-rustls 꼴).
        let io = || std::io::Error::new(std::io::ErrorKind::InvalidData, rustls::Error::InvalidCertificate(CertificateError::UnknownIssuer));
        assert!(tls::cert_error_in(&io(), "db.test").unwrap().contains("알 수 없는"));
        let my = mysql_async::Error::Io(mysql_async::IoError::Io(io()));
        assert!(tls::cert_error_in(&my, "db.test").is_some(), "mysql_async 사슬");
        assert!(tls::cert_error_in(&std::io::Error::other("x"), "db.test").is_none());
        assert!(tls::server_without_tls().contains("TLS"));
    }

    #[test]
    fn certificate_names_for_the_mysql_probe() {
        let names = |pem| cert_names(&der(pem));
        assert_eq!(names(SRV_DNS), ["db.test"]);
        assert_eq!(names(SRV_IP), ["10.0.0.5"]);
        assert!(names(SRV_NOSAN).is_empty());
        assert_eq!(name_for(&names(SRV_DNS)).as_deref(), Some("db.test"));
        assert_eq!(name_for(&names(SRV_WILD)).as_deref(), Some("aynx-verify-ca.corp.test"));
        assert_eq!(name_for(&[]), None);
        assert!(cert_names(b"junk").is_empty());
        // 와일드카드에서 고른 이름은 그 인증서의 전체 검증을 지난다(탐침 뒤 본 접속).
        let v = tls::verifier(DbTlsMode::VerifyFull, Some(&ca_file(CA))).unwrap().unwrap();
        check(&v, SRV_WILD, &name_for(&names(SRV_WILD)).unwrap(), UnixTime::now()).unwrap();
    }

    #[test]
    fn mysql_tls_modes_map_to_driver_knobs() {
        let ca = ca_file(CA);
        assert!(ssl_opts_for(DbTlsMode::Disable, Some(&ca), "db.test").is_none());
        for m in [DbTlsMode::Prefer, DbTlsMode::Require] {
            let o = ssl_opts_for(m, Some(&ca), "db.test").unwrap();
            assert!(o.accept_invalid_certs(), "{m:?} — 검증 안 함");
            assert!(o.root_certs().is_empty(), "{m:?} — CA 파일을 싣지 않는다");
            assert_eq!(o.tls_hostname_override(), Some("db.test"));
        }
        for m in [DbTlsMode::VerifyCa, DbTlsMode::VerifyFull] {
            let o = ssl_opts_for(m, Some(&ca), "db.test").unwrap();
            assert!(!o.accept_invalid_certs() && !o.skip_domain_validation(), "{m:?} — 드라이버 기본(전체) 검증");
            assert!(!o.disable_built_in_roots(), "webpki-roots 도 믿는다");
            assert_eq!((o.root_certs().len(), o.tls_hostname_override()), (1, Some("db.test")));
            assert!(ssl_opts_for(m, None, "db.test").unwrap().root_certs().is_empty());
        }
        assert!(no_server_ssl(&mysql_async::Error::Driver(mysql_async::DriverError::NoClientSslFlagFromServer)));
        assert!(!no_server_ssl(&mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed)));
    }

    #[test]
    fn mysql_probe_reads_the_ssl_flag_from_the_greeting() {
        let greeting = |caps: u16| {
            let mut p = vec![10u8];
            p.extend_from_slice(b"8.4.11\0");
            p.extend_from_slice(&[1, 0, 0, 0]); // 연결 id
            p.extend_from_slice(&[7u8; 8]); // 인증 자료
            p.push(0);
            p.extend_from_slice(&caps.to_le_bytes());
            p.extend_from_slice(&[45, 2, 0, 0xff, 0xdf]);
            p
        };
        assert_eq!(greeting_offers_ssl(&greeting(0xffff)), Ok(true));
        assert_eq!(greeting_offers_ssl(&greeting(0xf7ff)), Ok(false));
        let mut err = vec![0xff, 0x6a, 0x04];
        err.extend_from_slice(b"#HY000Host 'x' is not allowed");
        assert_eq!(greeting_offers_ssl(&err), Err("Host 'x' is not allowed".into()));
        assert!(greeting_offers_ssl(&[10, b'8']).is_err());
        assert!(greeting_offers_ssl(&[]).is_err());
    }
}

// ── 트랜잭션 작업(1단계 — 10-13 결정): 상태 기계 · 방치 시계 · 가드 · SQLite 엔진 ──

mod tx_unit {
    use std::time::{Duration, Instant};

    use serde_json::json;

    use super::{msg, sample_db};
    use crate::db::guard::{check_mode, GuardError, Mode};
    use crate::db::sqlite::Sqlite;
    use crate::db::tx::{Due, Outcome, Refusal, Slot};
    use crate::db::{Dialect, TxEndError};

    const LIMIT: Duration = Duration::from_secs(600);
    const WARN: Duration = Duration::from_secs(60);

    #[test]
    fn tx_slot_state_machine() {
        let t0 = Instant::now();
        let mut s = Slot::default();
        assert_eq!(s.view(t0).state, "none");
        assert_eq!(s.view(t0).id, 0);
        // 작업 없음을 기대하는 문장(0)은 통과 · 아무 id 는 낡음.
        s.expect(0).unwrap();
        assert_eq!(s.expect(7), Err(Refusal::Stale));
        // 열기 → 열림 · 두 번째 열기 거절.
        s.begin(41, t0).unwrap();
        assert_eq!(s.begin(42, t0), Err(Refusal::AlreadyOpen));
        assert!(s.is_open());
        let v = s.view(t0);
        assert_eq!((v.id, v.state, v.statements), (41, "open", 0));
        // 작업 안: 0(작업 없음으로 안 화면)은 낡음 · 다른 id 도 낡음 · 그 id 만 통과.
        assert_eq!(s.expect(0), Err(Refusal::Stale));
        assert_eq!(s.expect(40), Err(Refusal::Stale));
        s.expect(41).unwrap();
        // 성공한 문장만 센다.
        s.statement_done(true, t0);
        s.statement_done(false, t0);
        s.statement_done(true, t0);
        assert_eq!(s.view(t0).statements, 2);
        // 끝내기 — 낡은 id 는 거절 · 두 번 누름은 "끝내는 중".
        assert_eq!(s.start_ending(40), Err(Refusal::Stale));
        s.start_ending(41).unwrap();
        assert_eq!(s.view(t0).state, "ending");
        assert_eq!(s.start_ending(41), Err(Refusal::Ending));
        assert_eq!(s.expect(41), Err(Refusal::Ending));
        assert!(!s.is_open(), "끝내는 중에는 문장을 받지 않는다");
        // 엔진이 받지 못함(바쁨) → 다시 열림.
        s.cancel_ending();
        assert!(s.is_open());
        s.start_ending(41).unwrap();
        let e = s.finish(Outcome::Committed, None).unwrap();
        assert_eq!((e.id, e.outcome, e.statements), (41, Outcome::Committed, 2));
        let v = s.view(t0);
        assert_eq!((v.state, v.id), ("none", 0), "커밋 뒤에는 대기 — 새 작업을 저절로 열지 않는다");
        assert_eq!(v.ended.as_ref().map(|e| e.outcome), Some(Outcome::Committed));
        // 남는 상태 셋 — 다음 작업을 열 때까지 그 상태로 보인다.
        for (o, state) in [
            (Outcome::ErrorRolledBack, "errorRolledBack"),
            (Outcome::Unknown, "unknown"),
            (Outcome::Disconnected, "disconnected"),
            (Outcome::RolledBack, "none"),
            (Outcome::IdleRolledBack, "none"),
        ] {
            s.begin(50, t0).unwrap();
            s.finish(o, Some("사연".into()));
            let v = s.view(t0);
            assert_eq!(v.state, state, "{o:?}");
            assert_eq!(v.ended.as_ref().and_then(|e| e.message.as_deref()), Some("사연"));
        }
        // 새 작업을 열면 지난 결과는 지운다.
        s.begin(51, t0).unwrap();
        assert!(s.view(t0).ended.is_none());
        // 화면 꼴(JSON) — 시각은 지금으로부터의 길이.
        let j = serde_json::to_value(s.view(t0 + Duration::from_secs(3))).unwrap();
        assert_eq!(j["state"], "open");
        assert_eq!(j["startedAgoMs"], 3000);
        assert!(j["idleLeftMs"].is_u64() && j["idleLimitMs"].is_u64() && j["warnMs"].is_u64());
        let none = serde_json::to_value(Slot::default().view(t0)).unwrap();
        assert!(none.get("startedAgoMs").is_none() && none.get("ended").is_none(), "{none}");
    }

    #[test]
    fn tx_idle_clock_warns_then_expires_and_activity_resets_it() {
        let t0 = Instant::now();
        let mut s = Slot::default();
        assert_eq!(s.next_due(LIMIT, WARN), None, "작업이 없으면 시계도 없다");
        s.begin(1, t0).unwrap();
        // 무활동 9분에 경고, 10분에 되돌림.
        assert_eq!(s.next_due(LIMIT, WARN), Some((t0 + LIMIT - WARN, Due::Warn)));
        s.mark_warned();
        assert_eq!(s.next_due(LIMIT, WARN), Some((t0 + LIMIT, Due::Expire)));
        // 사람의 문장(활동) — 시계를 새로 재고 경고를 다시 낼 수 있게.
        let t1 = t0 + Duration::from_secs(300);
        s.statement_done(true, t1);
        assert_eq!(s.next_due(LIMIT, WARN), Some((t1 + LIMIT - WARN, Due::Warn)));
        // 명시적 연장도 같다.
        let t2 = t1 + Duration::from_secs(550);
        s.mark_warned();
        s.touch(t2);
        assert_eq!(s.next_due(LIMIT, WARN), Some((t2 + LIMIT - WARN, Due::Warn)));
        // 남은 시간 · 경고 표시(화면).
        let v = s.view(t2 + Duration::from_secs(545));
        assert_eq!(v.idle_left_ms, Some(55_000));
        assert!(v.warn, "1분 안이면 경고");
        assert!(!s.view(t2 + Duration::from_secs(500)).warn);
        // 끝내는 중에는 시계가 서지 않는다(두 번 되돌리지 않게).
        s.start_ending(1).unwrap();
        assert_eq!(s.next_due(LIMIT, WARN), None);
        // 상한이 경고보다 짧아도 무너지지 않는다.
        let mut t = Slot::default();
        t.begin(2, t0).unwrap();
        assert_eq!(t.next_due(Duration::from_millis(30), Duration::from_millis(30)), Some((t0, Due::Warn)));
    }

    #[test]
    fn tx_refusal_messages() {
        for r in [Refusal::ReadOnly, Refusal::AlreadyOpen, Refusal::Stale, Refusal::Ending] {
            let m = r.message();
            assert!(!m.is_empty() && !m.contains('\n'), "{m}");
        }
        assert!(Refusal::Stale.message().contains("[db-tx-stale]"));
        assert!(!Refusal::AlreadyOpen.message().contains("[db-tx-stale]"));
    }

    fn tx_err(sql: &str, d: Dialect) -> GuardError {
        match check_mode(sql, d, Mode::Transaction) {
            Ok(c) => panic!("{sql:?} ({d:?}) 통과: {c:?}"),
            Err(e) => e,
        }
    }

    fn tx_ok(sql: &str, d: Dialect) {
        check_mode(sql, d, Mode::Transaction).unwrap_or_else(|e| panic!("{sql:?} ({d:?}) 거절: {e:?}"));
    }

    #[test]
    fn guard_transaction_mode_refuses_mysql_implicit_commits() {
        let my = Dialect::Mysql;
        for sql in [
            "CREATE TABLE x(id int)",
            "create index i on t(a)",
            "CREATE OR REPLACE VIEW v AS SELECT 1",
            "CREATE DATABASE d",
            "CREATE USER u",
            "CREATE ROLE r",
            "ALTER TABLE t ADD c int",
            "ALTER USER u IDENTIFIED BY 'x'",
            "DROP TABLE t",
            "DROP VIEW v",
            "DROP USER u",
            "RENAME TABLE a TO b",
            "RENAME USER a TO b",
            "TRUNCATE TABLE t",
            "TRUNCATE t",
            "GRANT SELECT ON t TO u",
            "REVOKE SELECT ON t FROM u",
            "SET PASSWORD = 'x'",
            "SET PASSWORD FOR u = 'x'",
            "SET DEFAULT ROLE ALL TO u",
            "INSTALL PLUGIN p SONAME 'p.so'",
            "UNINSTALL PLUGIN p",
            "ANALYZE TABLE t",
            "ANALYZE NO_WRITE_TO_BINLOG TABLE t",
            "ANALYZE LOCAL TABLE t",
            "OPTIMIZE TABLE t",
            "REPAIR TABLE t",
            "CHECK TABLE t",
            "CACHE INDEX t IN c",
            "LOAD INDEX INTO CACHE t",
            "LOAD DATA INFILE '/x' INTO TABLE t",
            "LOAD XML INFILE '/x' INTO TABLE t",
            "FLUSH PRIVILEGES",
            "FLUSH STATUS",
            "RESET MASTER",
            "START REPLICA",
            "START SLAVE",
            "START GROUP_REPLICATION",
            "STOP REPLICA",
            "CHANGE REPLICATION SOURCE TO SOURCE_HOST = 'h'",
            "CHANGE MASTER TO MASTER_HOST = 'h'",
            "/* c */ create table x(id int)",
        ] {
            assert_eq!(tx_err(sql, my), GuardError::ImplicitCommit, "{sql}");
        }
        // 트랜잭션 · 세션 잠금 문장은 자동 커밋과 같은 거절(문구도 같다).
        assert_eq!(tx_err("BEGIN", my), GuardError::Transaction { dialect: my });
        assert_eq!(tx_err("SET autocommit = 1", my), GuardError::Transaction { dialect: my });
        assert_eq!(tx_err("LOCK TABLES t WRITE", my), GuardError::SessionLock);
        // 체인 · 끊기를 바꾸는 `completion_type` 도 autocommit 과 같은 거절(Codex 검토 반영 1) — 자동 커밋 모드에서도.
        for sql in [
            "SET completion_type = 1",
            "SET SESSION completion_type = 'CHAIN'",
            "SET @@completion_type = 2",
            "SET @@session.completion_type=1",
            "SET `completion_type` = 1",
            "SET a = 1, completion_type = 1",
            "SET STATEMENT completion_type = 1 FOR INSERT INTO t VALUES (1)",
        ] {
            assert_eq!(tx_err(sql, my), GuardError::Transaction { dialect: my }, "{sql}");
            assert_eq!(check_mode(sql, my, Mode::AutoCommit).unwrap_err(), GuardError::Transaction { dialect: my }, "{sql}");
        }
        check_mode("SELECT @@completion_type", my, Mode::AutoCommit).unwrap();
        // 원자성을 증명할 수 없는 문장(Codex 검토 반영 1) — CALL(프로시저 안의 COMMIT 을 못 본다) · TEMPORARY(되돌려지지 않는다).
        for sql in ["CALL p()", "call db.p(1, 'x')", "/* c */ CALL p"] {
            assert_eq!(tx_err(sql, my), GuardError::ProcedureCall, "{sql}");
        }
        for sql in ["CREATE TEMPORARY TABLE tmp(id int)", "create temporary table tmp AS SELECT 1", "DROP TEMPORARY TABLE tmp", "DROP TEMPORARY TABLE IF EXISTS tmp"] {
            assert_eq!(tx_err(sql, my), GuardError::TemporaryTable, "{sql}");
        }
        // 받는 것 — DML · 조회 · 분석 문장 · 다른 SET.
        for sql in [
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET a = 1 WHERE id = 2",
            "DELETE FROM t WHERE id = 3",
            "REPLACE INTO t VALUES (1)",
            "SELECT * FROM t FOR UPDATE",
            "SELECT 1",
            "SHOW TABLES",
            "ANALYZE SELECT 1",
            "SET @x = 1",
            "SET SESSION sql_mode = ''",
            "DO 0",
            "EXPLAIN SELECT 1",
        ] {
            tx_ok(sql, my);
        }
        // 자동 커밋 모드에서는 DDL · CALL · 임시 테이블을 지금처럼 받는다(약속이 없다).
        check_mode("CREATE TABLE x(id int)", my, Mode::AutoCommit).unwrap();
        check_mode("TRUNCATE t", my, Mode::AutoCommit).unwrap();
        check_mode("CALL p()", my, Mode::AutoCommit).unwrap();
        check_mode("CREATE TEMPORARY TABLE tmp(id int)", my, Mode::AutoCommit).unwrap();
        // 다른 방언의 CALL 은 그대로(PG 프로시저는 트랜잭션 블록 안에서 커밋하지 못한다 — 2D000).
        tx_ok("CALL p()", Dialect::Postgres);
        // 다른 방언에는 이 규칙이 없다(DDL 도 트랜잭션 안).
        tx_ok("CREATE TABLE x(id int)", Dialect::Postgres);
        tx_ok("CREATE TABLE x(id int)", Dialect::Sqlite);
        tx_ok("TRUNCATE t", Dialect::Postgres);
    }

    #[test]
    fn guard_transaction_mode_refuses_postgres_outside_only_statements() {
        let pg = Dialect::Postgres;
        for sql in [
            "VACUUM",
            "vacuum full t",
            "VACUUM (ANALYZE) t",
            "CREATE INDEX CONCURRENTLY i ON t(a)",
            "CREATE UNIQUE INDEX CONCURRENTLY i ON t(a)",
            "DROP INDEX CONCURRENTLY i",
            "REINDEX INDEX CONCURRENTLY i",
            "REINDEX DATABASE d",
            "REINDEX SYSTEM d",
            "CREATE DATABASE d",
            "DROP DATABASE d",
            "CREATE TABLESPACE s LOCATION '/x'",
            "DROP TABLESPACE s",
            "ALTER SYSTEM SET work_mem = '1MB'",
            "CLUSTER",
            "CLUSTER VERBOSE",
            "DISCARD ALL",
            "CREATE SUBSCRIPTION s CONNECTION '' PUBLICATION p",
            "DROP SUBSCRIPTION s",
        ] {
            assert_eq!(tx_err(sql, pg), GuardError::OutsideTransaction, "{sql}");
        }
        for sql in [
            "CREATE INDEX i ON t(a)",
            "CREATE TABLE t(id int)",
            "ALTER TABLE t ADD c int",
            "DROP TABLE t",
            "TRUNCATE t",
            "CLUSTER t USING i",
            "REINDEX TABLE t",
            "DISCARD TEMP",
            "LOCK TABLE t IN SHARE MODE",
            "SELECT 'VACUUM'",
            "UPDATE t SET note = 'CONCURRENTLY'",
            "SET LOCAL statement_timeout = 0",
        ] {
            tx_ok(sql, pg);
        }
        // 자동 커밋 모드에서는 지금처럼 받는다(25001 이면 트랜잭션 밖에서 다시 돈다 — `pg::retry_outside_transaction`).
        check_mode("VACUUM", pg, Mode::AutoCommit).unwrap();
        check_mode("CREATE INDEX CONCURRENTLY i ON t(a)", pg, Mode::AutoCommit).unwrap();
        // 트랜잭션 문장은 작업 안에서도 거절(작업은 [커밋] · [되돌리기] 로만 끝난다).
        for sql in ["COMMIT", "ROLLBACK", "SAVEPOINT a", "BEGIN", "END"] {
            assert_eq!(tx_err(sql, pg), GuardError::Transaction { dialect: pg }, "{sql}");
            assert_eq!(tx_err(sql, Dialect::Sqlite), GuardError::Transaction { dialect: Dialect::Sqlite }, "{sql}");
        }
        for e in [GuardError::ImplicitCommit, GuardError::OutsideTransaction] {
            let m = e.message();
            assert!(!m.contains('\n') && (m.contains("[커밋]") || m.contains("[Commit]")), "{m}");
        }
        // 읽기 전용 모드는 이 규칙과 무관하다.
        assert!(matches!(check_mode("VACUUM", pg, Mode::ReadOnly), Err(GuardError::ReadOnly { .. })));
    }

    /// 자동 커밋을 끈 타일의 갈래(10-14 결정 — `table::auto_off_reads`): 허용 목록 문장 = 작업을 열지 않는 조회 · 그 밖 = 작업을 연다 ·
    /// 작업 안에서도 못 도는 문장 = 아무것도 열지 않고 "자동 커밋을 켜고" 안내.
    #[test]
    fn auto_commit_off_sorts_reads_changes_and_refusals() {
        use crate::db::table::auto_off_reads;
        let (pg, my, sl) = (Dialect::Postgres, Dialect::Mysql, Dialect::Sqlite);
        for (sql, d) in [("SELECT 1", pg), ("  (select * from t)", pg), ("SHOW TABLES", my), ("EXPLAIN SELECT 1", sl), ("WITH a AS (SELECT 1) SELECT * FROM a", pg)] {
            assert_eq!(auto_off_reads(sql, d), Ok(true), "{sql}");
        }
        // 허용 목록 첫 낱말 뒤의 쓰기(CTE 안 DELETE)는 조회로 분류된다 — 엔진의 READ ONLY 가 거절하면 표가 작업을 열어 다시 돈다.
        assert_eq!(auto_off_reads("WITH d AS (DELETE FROM t RETURNING *) SELECT count(*) FROM d", pg), Ok(true));
        for (sql, d) in [
            ("INSERT INTO t VALUES (1)", pg),
            ("UPDATE t SET a = 1", my),
            ("DELETE FROM t", sl),
            ("CREATE TABLE x(a int)", pg),
            ("CREATE TABLE x(a)", sl),
            ("SELECT 1 INTO OUTFILE '/tmp/x'", my),
            ("SET @x = 1", my),
        ] {
            assert_eq!(auto_off_reads(sql, d), Ok(false), "{sql}");
        }
        // 작업 안에서 못 도는 문장 — 작업을 열지 않고 "스위치를 '자동 커밋'으로" 안내.
        for (sql, d) in [
            ("CREATE TABLE x(a int)", my),
            ("TRUNCATE t", my),
            ("VACUUM", pg),
            ("CREATE INDEX CONCURRENTLY i ON t(a)", pg),
            ("CALL p()", my),
            ("CREATE TEMPORARY TABLE tmp(a int)", my),
        ] {
            let m = auto_off_reads(sql, d).unwrap_err();
            assert!(m.contains("'자동 커밋'") || m.contains("'Auto-commit'"), "{sql}: {m}");
            assert!(!m.contains("[커밋]이나") && !m.contains("[Commit] or"), "작업이 아직 없다 — 끝내라고 하지 않는다: {m}");
        }
        // 사람의 트랜잭션 문장 · 여러 문장은 가드 문구 그대로.
        assert_eq!(auto_off_reads("BEGIN", sl).unwrap_err(), GuardError::Transaction { dialect: sl }.message());
        assert_eq!(auto_off_reads("SAVEPOINT a", pg).unwrap_err(), GuardError::Transaction { dialect: pg }.message());
        assert_eq!(auto_off_reads("ROLLBACK TO SAVEPOINT aynx_run", pg).unwrap_err(), GuardError::Transaction { dialect: pg }.message());
        assert_eq!(auto_off_reads("RELEASE aynx_run", sl).unwrap_err(), GuardError::Transaction { dialect: sl }.message());
        let multi = auto_off_reads("SELECT 1; SELECT 2", pg).unwrap_err();
        assert!(multi.contains("Alt+X"), "여러 문장은 스크립트 실행으로: {multi}");
    }

    fn count(file: &std::path::Path, sql: &str) -> i64 {
        rusqlite::Connection::open(file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn sqlite_transaction_work_commits_rolls_back_and_follows_the_engine() {
        let (dir, file) = sample_db("txwork");
        let db = Sqlite::open(&file, false).unwrap();
        db.set_write(true).unwrap();
        // ── 열기 → 같은 연결에서 보이고 다른 연결에는 안 보인다 → 커밋 ──
        db.tx_begin().unwrap();
        assert!(db.in_tx() && !db.is_autocommit());
        assert!(db.tx_begin().is_err() && db.in_tx(), "두 번 열지 않는다");
        let r = db.query("UPDATE t SET name = 'tx' WHERE id <= 3", 1).unwrap();
        assert_eq!(r.affected, Some(3));
        assert_eq!(db.query("SELECT count(*) FROM t WHERE name = 'tx'", 1).unwrap().rows, vec![vec![json!(3)]]);
        assert_eq!(count(&file, "SELECT count(*) FROM t WHERE name = 'tx'"), 0, "다른 연결에는 아직 안 보인다");
        // 메타 조회도 같은 트랜잭션 안에서 돌고 작업을 깨지 않는다(트랜잭션 안에서 만든 테이블이 보인다).
        db.query("CREATE TABLE made_in_tx(a)", 1).unwrap();
        let objs = db.objects(Some("main")).unwrap();
        assert!(objs.to_string().contains("made_in_tx"), "{objs}");
        db.table_detail(None, "made_in_tx").unwrap();
        assert!(db.in_tx());
        // 사람의 트랜잭션 문장은 작업 안에서도 거절 · 작업은 그대로.
        assert!(msg(db.query("COMMIT", 1).unwrap_err()).contains("SQLite"));
        assert!(db.in_tx());
        // 문장만 실패(없는 표 · UNIQUE) → 작업은 계속.
        assert!(db.query("INSERT INTO nope VALUES (1)", 1).is_err());
        assert!(db.query("INSERT INTO t(id) VALUES (1)", 1).is_err());
        assert!(db.in_tx(), "문장만 실패하면 SQLite 는 트랜잭션을 살린다");
        // 트랜잭션 안 VACUUM — 엔진이 오류로 거절, 작업은 산다(10-13 실측).
        assert!(db.query("VACUUM", 1).is_err());
        assert!(db.in_tx());
        db.tx_end(true).unwrap();
        assert!(!db.in_tx() && db.is_autocommit());
        assert_eq!(count(&file, "SELECT count(*) FROM t WHERE name = 'tx'"), 3, "커밋 뒤 다른 연결에 보인다");
        // ── 되돌리기 ──
        db.tx_begin().unwrap();
        db.query("DELETE FROM t", 1).unwrap();
        assert_eq!(count(&file, "SELECT count(*) FROM t"), 1500);
        db.tx_end(false).unwrap();
        assert!(!db.in_tx());
        assert_eq!(db.query("SELECT count(*) FROM t", 1).unwrap().rows, vec![vec![json!(1500)]]);
        // ── 커밋이 다른 연결의 읽기 잠금에 막힘(SQLITE_BUSY) → 작업은 남는다 ──
        db.tx_begin().unwrap();
        db.query("UPDATE t SET name = 'busy' WHERE id = 5", 1).unwrap();
        let reader = rusqlite::Connection::open(&file).unwrap();
        reader.execute_batch("BEGIN; SELECT count(*) FROM t;").unwrap();
        match db.tx_end(true) {
            Err(TxEndError::Failed(m)) => assert!(db.in_tx(), "실패한 커밋 뒤에도 작업은 열려 있다: {m}"),
            Ok(_) => {} // WAL 이면 읽기가 커밋을 막지 않는다 — 그때는 커밋됐다
            Err(other) => panic!("{other:?}"),
        }
        reader.execute_batch("COMMIT").unwrap();
        drop(reader);
        if db.in_tx() {
            db.tx_end(true).unwrap();
        }
        assert!(!db.in_tx());
        // ── 쓰기 끄기 = 다시 열기 → 열린 작업은 되감긴다 ──
        db.tx_begin().unwrap();
        db.query("UPDATE t SET name = 'gone' WHERE id = 6", 1).unwrap();
        db.set_write(false).unwrap();
        assert!(!db.in_tx());
        assert_eq!(count(&file, "SELECT count(*) FROM t WHERE name = 'gone'"), 0);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sqlite_interrupted_write_rolls_back_the_whole_transaction() {
        let (dir, file) = sample_db("txintr");
        let db = std::sync::Arc::new(Sqlite::open(&file, false).unwrap());
        db.set_write(true).unwrap();
        db.tx_begin().unwrap();
        db.query("INSERT INTO t(name) VALUES ('before')", 1).unwrap();
        let d2 = std::sync::Arc::clone(&db);
        let h = std::thread::spawn(move || {
            d2.query(
                "INSERT INTO t(name) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT 'x' || i FROM n",
                1,
            )
        });
        std::thread::sleep(Duration::from_millis(300));
        db.interrupt();
        assert!(h.join().unwrap().is_err());
        assert!(!db.in_tx(), "끊긴 쓰기는 SQLite 가 트랜잭션 전체를 되감는다(10-13 실측)");
        assert_eq!(db.query("SELECT count(*) FROM t WHERE name = 'before'", 1).unwrap().rows, vec![vec![json!(0)]]);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Codex 검토 반영 1 — 작업 안 실행이 **성공했어도** 멈춤 깃발(취소 · 시한 그물)이 섰으면 세이브포인트를 풀기 직전에 보고 그 실행을
    /// 되돌린다("복구 성공" 판정 · 작업은 열림). 깃발이 없으면 유지.
    #[test]
    fn sqlite_stop_flag_undoes_a_finished_run_before_release() {
        use crate::db::RunEnd;
        use std::sync::atomic::AtomicBool;
        let (dir, file) = sample_db("txstop");
        let db = Sqlite::open(&file, false).unwrap();
        db.set_write(true).unwrap();
        db.tx_begin().unwrap();
        db.query_ctl("INSERT INTO t(name) VALUES ('keep')", 1, false, &AtomicBool::new(false)).unwrap();
        assert_eq!(db.take_run_end(), Some(RunEnd::Kept));
        let r = db.query_ctl("INSERT INTO t(name) VALUES ('late')", 1, false, &AtomicBool::new(true));
        assert!(matches!(r, Err(crate::db::EngineError::Interrupted)), "{r:?}");
        assert_eq!(db.take_run_end(), Some(RunEnd::Undone { note: None }));
        assert!(db.in_tx(), "작업은 산다");
        assert_eq!(db.query("SELECT count(*) FROM t WHERE name IN ('keep', 'late')", 1).unwrap().rows, vec![vec![json!(1)]]);
        // 실패한 실행(UNIQUE)도 복구 성공 판정.
        assert!(db.query("INSERT INTO t(id) VALUES (1)", 1).is_err());
        assert_eq!(db.take_run_end(), Some(RunEnd::Undone { note: None }));
        db.tx_end(false).unwrap();
        // 작업 밖에는 판정이 없다.
        db.query("SELECT 1", 1).unwrap();
        assert_eq!(db.take_run_end(), None);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Codex 검토 반영 1 — 작업 안 스크립트의 **마지막** 문장이 도는 중 취소가 와도(엔진이 끊지 못해 성공으로 끝남) 세이브포인트를 풀기
    /// 직전에 다시 보고 그 실행을 통째로 되돌린다(앞 INSERT 가 남지 않는다).
    #[test]
    fn sqlite_script_cancel_during_last_statement_leaves_nothing() {
        use crate::db::script::{self, Ctl, End, ScriptMode};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let (dir, file) = sample_db("txlast");
        let db = Sqlite::open(&file, false).unwrap();
        db.set_write(true).unwrap();
        db.tx_begin().unwrap();
        let plan = script::plan(
            "INSERT INTO t(name) VALUES ('first'); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000000) SELECT count(*) FROM n",
            Dialect::Sqlite,
            ScriptMode::InWork,
        )
        .unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let ctl = Ctl::new(Arc::clone(&cancel), 60_000, Duration::from_secs(60));
        let c2 = Arc::clone(&cancel);
        // 끊기(interrupt) 없이 깃발만 — 마지막 문장은 성공으로 끝난다.
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            c2.store(true, Ordering::SeqCst);
        });
        let run = db.script(&plan, ScriptMode::InWork, 10, &ctl).unwrap();
        t.join().unwrap();
        assert_eq!(run.done.len(), 2, "두 문장 모두 성공으로 끝났다: {run:?}");
        assert_eq!((run.end.clone(), run.stopped), (End::WorkRunUndone, Some(script::Stop::Cancelled)), "{run:?}");
        assert!(db.in_tx());
        assert_eq!(db.query("SELECT count(*) FROM t WHERE name = 'first'", 1).unwrap().rows, vec![vec![json!(0)]]);
        db.tx_end(false).unwrap();
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Codex 검토 반영 1 — WAL 에서 이 작업의 스냅숏이 낡아 쓰기를 못 하면(`SQLITE_BUSY_SNAPSHOT`) "처음부터 다시" 를 붙인다. 작업 상태는
    /// 엔진 판정 그대로(열림).
    #[test]
    fn sqlite_busy_snapshot_says_start_over() {
        let (dir, file) = sample_db("txsnap");
        rusqlite::Connection::open(&file).unwrap().execute_batch("PRAGMA journal_mode = WAL").unwrap();
        let db = Sqlite::open(&file, false).unwrap();
        db.set_write(true).unwrap();
        db.tx_begin().unwrap();
        db.query("SELECT count(*) FROM t", 1).unwrap(); // 읽기 스냅숏을 연다
        let other = rusqlite::Connection::open(&file).unwrap();
        other.execute("UPDATE t SET name = 'other' WHERE id = 2", []).unwrap();
        let m = msg(db.query("UPDATE t SET name = 'mine' WHERE id = 3", 1).unwrap_err());
        assert!(m.contains("처음부터") || m.contains("start over"), "{m}");
        assert!(db.in_tx(), "작업 상태는 엔진 판정 그대로");
        db.tx_end(false).unwrap();
        drop(other);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
