//! **쿼리 가드** — 엔진에 보내기 전에 SQL 한 덩어리를 본다. **순수 함수**(입출력 없음).
//!
//! 1. **문장 하나만.** 작은 렉서가 작은따옴표·큰따옴표·백틱·SQLite `[식별자]`·`--`·`/* */`(PG 는 중첩)·MySQL `#`·
//!    PG `$tag$`·PG `E'…'` 를 알아보고, 그 밖(최상위)의 `;` 로 문장을 가른다. 끝 세미콜론·뒤 주석·빈 문장(`;;`)은 받는다.
//!    스크립트 실행(2단계 — `db::script`)은 같은 렉서로 글을 문장들로 나누고([`split_script`] — 해석마다 경계가 같아야 한다) 나뉜
//!    문장마다 다시 이 검사를 지난다(그래서 엔진이 받는 것은 늘 문장 하나다).
//! 2. **읽기 전용 모드의 첫 낱말 허용 목록**(엔진별 — [`allowed`]) — 앞 공백·주석·여는 괄호를 건너뛴 첫 낱말이 조회 문장
//!    (`SELECT`·`WITH`·`VALUES`·`EXPLAIN`·`SHOW` …)일 때만 받는다. 거절 목록(옛 꼴)은 새 명령·방언 확장을 놓치므로 걷었다
//!    (`BEGIN`·`COMMIT`·`SET`·`COPY`·`CALL`·`DO` … 가 다 목록 밖이라 저절로 거절된다). `ANALYZE` 는 통계를 쓰므로 넣지 않는다.
//!    쓰기 모드에서는 첫 낱말 허용 목록을 보지 않는다(문장 하나만 규칙은 그대로) — 예외: **세 방언 모두 사람이 트랜잭션·세션
//!    잠금을 여는 문장은 거절한다**([`write_check`] · [`GuardError::Transaction`] · [`GuardError::SessionLock`]):
//!    - 공통: `BEGIN`·`START TRANSACTION`·`COMMIT`·`END`·`ROLLBACK`·`ABORT`·`SAVEPOINT`·`RELEASE`(엔진마다 실재하는 꼴은 [`TRANSACTION_WORDS`]).
//!    - PG: + `PREPARE TRANSACTION`(`COMMIT PREPARED`·`ROLLBACK PREPARED` 는 첫 낱말로 이미 걸린다). 일반 `PREPARE 이름 AS …` 는 받는다.
//!    - MySQL·MariaDB: + `XA …` 전부 · 낱말 `autocommit` · `completion_type` 이 든 `SET` · `LOCK`/`UNLOCK …` · `FLUSH … LOCK`/`… EXPORT`.
//!      (`completion_type` — 1 이면 `COMMIT` · `ROLLBACK` 뒤에 새 트랜잭션이 저절로 열리고 2 면 연결이 끊긴다. 앱의 종료문은 늘
//!      `AND NO CHAIN NO RELEASE` 를 붙여 그 값과 무관하지만(`mysql`), 사람이 바꿀 길도 `autocommit` 과 같은 규칙으로 막는다 — Codex 검토 반영 1.)
//!
//!    왜: 쓰기 모드는 "문장마다 자동 커밋" 이다. PG 엔진은 문장마다 제 트랜잭션(`BEGIN` → `SET LOCAL statement_timeout` → 문장 →
//!    `COMMIT`)으로 감싸므로 사람이 연 트랜잭션은 다음 문장에 **조용히 커밋**되고, SQLite·MySQL·MariaDB 는 감싸지 않아 사람의
//!    트랜잭션(`BEGIN` · `SET autocommit = 0`)·세션 잠금이 **표시 없이** 남아 떼어 두기(10분) 동안 잠금을 쥔다(10-13 결정 0단계 —
//!    트랜잭션은 앱이 소유한다, 1단계). **가드가 못 보는 것**: 프로시저·함수 안의 일(MySQL `CALL` 안의 `COMMIT`·`START TRANSACTION`·
//!    `SET autocommit`·DDL, PG `CALL`/`DO` — 이건 엔진이 감싼 트랜잭션 안이라 `COMMIT` 이 2D000 으로 실패한다), 함수로 잡는
//!    세션 잠금(MySQL `GET_LOCK()` · PG `pg_advisory_lock()`). 그래서 MySQL 쓰기 끄기는 여전히 `ROLLBACK; SET SESSION autocommit = 1`
//!    로 되감는다(`mysql::set_write` — 시험 `mysql_tests` 의 `CALL` 줄). 동적 SQL(`PREPARE … FROM` · `EXECUTE` · MariaDB
//!    `EXECUTE IMMEDIATE`)은 글자를 못 보지만 엔진의 prepare 가 1295 로 막는다(10-13 실측). 최종 방어선은 계정 권한이다.
//!
//!    **트랜잭션 작업 안**(1단계 — 앱이 연 트랜잭션, [`Mode::Transaction`])에서는 위에 더해 그 트랜잭션을 **몰래 끝내거나 깨뜨리는**
//!    문장을 거절한다([`tx_check`]):
//!    - MySQL·MariaDB: **암묵 커밋 문장**([`GuardError::ImplicitCommit`]) — DDL(`ALTER`·`CREATE`·`DROP`·`RENAME`·`TRUNCATE` …) ·
//!      계정·권한(`GRANT`·`REVOKE`·`SET PASSWORD`·`SET DEFAULT ROLE`) · 관리(`ANALYZE TABLE`·`OPTIMIZE`·`REPAIR`·`CHECK TABLE`·
//!      `CACHE INDEX`·`LOAD INDEX`·`FLUSH`·`RESET`) · `LOAD DATA` · 복제 제어(`START`/`STOP REPLICA` · `CHANGE …`). 목록은 MySQL 공식
//!      "Statements That Cause an Implicit Commit"(<https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html>) · MariaDB
//!      "SQL statements That Cause an Implicit Commit"(<https://mariadb.com/kb/en/sql-statements-that-cause-an-implicit-commit/>).
//!    - MySQL·MariaDB: **원자성을 증명할 수 없는 문장**(Codex 검토 반영 1 — 작업 · 스크립트 · AI 작업안은 "첫 오류 · 취소면 전부(또는 이번
//!      실행분) 되돌림" 을 약속한다):
//!      - `CALL`([`GuardError::ProcedureCall`]) — 프로시저 안의 `COMMIT` · `ROLLBACK` · `START TRANSACTION` · `RELEASE SAVEPOINT` · DDL 을
//!        가드도 엔진도 볼 수 없다. 서버의 `IN_TRANS` 플래그는 **지금** 트랜잭션이 있는지만 말하고 앞 트랜잭션의 운명(`COMMIT` 한 뒤
//!        `SIGNAL`)은 증명하지 못한다. 자동 커밋 단문으로는 그대로 받는다(약속이 없다).
//!      - `CREATE TEMPORARY …` · `DROP TEMPORARY …`([`GuardError::TemporaryTable`]) — 암묵 커밋은 없지만 **되돌려지지 않는다**(MySQL ·
//!        MariaDB 문서). 자동 커밋 단문으로는 그대로 받는다.
//!
//!      받은 문장도 엔진이 문장마다 서버 상태 플래그(`IN_TRANS`)로 다시 보고(꺼지면 교착 · 잠금 대기 초과만 "되돌림", 그 밖은 "결과
//!      불명"), 글자로 못 보는 비트랜잭션 테이블(MyISAM 등 — 트리거 · 함수가 건드린 것 포함)은 엔진이 되돌릴 때 받은 경고 1196
//!      (`ER_WARNING_NOT_COMPLETE_ROLLBACK`)을 결과에 밝힌다(`mysql`).
//!    - PostgreSQL: **트랜잭션 밖에서만 도는 문장**([`GuardError::OutsideTransaction`] — `VACUUM` · `… CONCURRENTLY` · `CREATE`/`DROP
//!      DATABASE`·`TABLESPACE` · `ALTER SYSTEM` · `REINDEX DATABASE`/`SYSTEM` · 인자 없는 `CLUSTER` · `DISCARD ALL` · `… SUBSCRIPTION`).
//!      PG 는 트랜잭션 안 오류가 트랜잭션 전체를 중단시키므로(앱이 곧바로 되돌린다) 미리 거절해 작업을 지킨다. 목록 밖에서 25001 이
//!      나면 그때는 작업이 되돌려진다(트랜잭션 밖 다시 돌기는 작업 안에서는 하지 않는다 — 10-13 결정).
//!    - SQLite: 더하는 것 없음 — `VACUUM`·`ATTACH` 는 엔진이 트랜잭션 안에서 오류로 거절하고 트랜잭션은 산다(10-13 실측).
//! 3. **읽기 전용 모드의 MySQL·MariaDB `INTO OUTFILE` / `INTO DUMPFILE` 절 거절** — `SELECT … INTO OUTFILE '/경로'` 는 첫 낱말이
//!    `SELECT` 인데 서버에 파일을 쓰고, 엔진의 `READ ONLY` 트랜잭션이 막지 못한다(8단계 실측 — MySQL 은 `secure_file_priv` 폴더 ·
//!    MariaDB 는 `/tmp`). 함수 이름 검사가 아니라 **문장 구조** 검사다: 렉서가 문자열·주석·식별자 인용 밖에서 본 낱말 `INTO`
//!    바로 다음 낱말(사이의 공백·주석은 건너뜀)이 `OUTFILE`·`DUMPFILE` 이면 거절. `INTO @변수`(세션 변수)는 받는다. PG 의
//!    `COPY … TO '/파일'` 이 첫 낱말로 막히는 것과 짝이다. 실행 주석 `/*! … */` 안의 절은 그 주석이 통째로 거절된다(아래).
//! 4. **허용 첫 낱말 뒤의 쓰기는 엔진 몫이다** — `EXPLAIN ANALYZE DELETE …`(PG 는 실제로 돈다)·PG `WITH x AS (DELETE … RETURNING *)`·
//!    SQLite `WITH x AS (…) INSERT …` 는 첫 낱말이 허용 목록 안이다. 이것은 엔진의 읽기 전용이 막는다(SQLite = 읽기 전용 열기·
//!    `query_only`·`Statement::readonly()` — 시험 `sqlite_read_only_refuses_writes_behind_allowed_first_words`, PG = 문장마다
//!    `BEGIN READ ONLY`, MySQL = `START TRANSACTION READ ONLY` — 7·8단계). 가드와 엔진이 **겹으로** 선다.
//!
//! ## 왜 문장 하나인가 — 스파이크 함정 6 (PG simple query 우회)
//!
//! PG 의 simple query 프로토콜은 다중 문장을 **한 번에** 돈다. `BEGIN READ ONLY` 안에서 `simple_query("COMMIT; INSERT …")` 가
//! 첫 문장으로 트랜잭션을 끝내고 둘째 문장을 **읽기 전용 밖에서** 실행했다(10-12 실측). `default_transaction_read_only` 도
//! 사용자가 `SET` 으로 되돌린다. MySQL 도 `CLIENT_MULTI_STATEMENTS` 가 기본 켜짐이다. 그래서:
//! - 가드가 문장 하나만 통과시키고, 읽기 전용 모드에서는 조회 첫 낱말만 받는다(트랜잭션·세션 조작은 목록 밖).
//! - 엔진은 그와 별개로 다중 문장을 다시 거절한다(SQLite = prepare 꼬리 · PG = 확장 프로토콜(prepare) · MySQL = prepare).
//!   PG 쓰기 모드의 트랜잭션 밖 문장(`VACUUM` … — 25001) 재시도만 simple query 인데, 같은 글자가 먼저 `prepare` 를 지난 뒤다(`pg` 머리말).
//! - `SELECT set_config('default_transaction_read_only', 'off', false)` 같은 **함수로 세션 값 바꾸기**는 가드가 못 본다 —
//!   그래서 PG 는 매 문장을 제 `BEGIN READ ONLY` 로 감싸야 한다(세션 기본값에 기대지 않는다 — 7단계의 계약).
//!
//! ## 엔진과 렉서가 어긋나는 자리 — 늘 "거절" 쪽으로
//!
//! - 백슬래시 이스케이프는 서버 설정(PG `standard_conforming_strings` · MySQL `NO_BACKSLASH_ESCAPES` · `ANSI_QUOTES`)에 따라
//!   다르다 — PG·MySQL 은 **두 해석으로 다 훑어** 어느 쪽에서든 문장이 둘로 보이면 거절한다. 한 해석에서 리터럴이 끝나지
//!   않으면 그 해석의 서버는 구문 오류로 아무것도 실행하지 않으므로 다른 해석이 하나로 보면 받는다.
//! - MySQL 의 `--` 는 뒤에 공백이 있어야 주석이다(`1 --1` 은 빼기 둘). MySQL 의 **실행 주석** `/*! … */`·`/*M! … */` 은 서버가
//!   안의 글자를 SQL 로 돈다 — 가드가 볼 수 없으니 받지 않는다.
//! - PG 의 블록 주석은 중첩된다. 중첩을 모르는 해석은 문장을 더 많이 보게 되어(거절 쪽) 안전하지만, 우리는 맞게 센다.
//! - 끝나지 않은 블록 주석은 끝까지 주석으로 본다(그 안은 어차피 코드가 아니다).

use super::Dialect;
use crate::i18n::tr;

/// 가드의 거절 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GuardError {
    /// 공백·주석뿐이다.
    Empty,
    /// 문장이 둘 이상이다.
    Multiple,
    /// 따옴표·식별자가 끝나지 않았다(모든 해석에서).
    Unterminated,
    /// MySQL 실행 주석 `/*! … */`.
    ExecutableComment,
    /// 읽기 전용 모드의 MySQL·MariaDB `INTO OUTFILE` / `INTO DUMPFILE` 절(서버에 파일을 쓴다).
    IntoFile,
    /// 읽기 전용 모드에서 받지 않는 문장 — 첫 낱말(대문자, 낱말이 아니면 빈 글자)과 방언(문구에 허용 목록을 보인다).
    ReadOnly { keyword: String, dialect: Dialect },
    /// 쓰기 모드의 트랜잭션 문장(문장마다 자동 커밋 — 머리말 2). 방언은 문구에 그 엔진의 꼴을 보인다.
    Transaction { dialect: Dialect },
    /// MySQL·MariaDB 쓰기 모드의 세션 잠금(`LOCK TABLES` · `FLUSH TABLES … WITH READ LOCK` … — 머리말 2).
    SessionLock,
    /// MySQL·MariaDB 트랜잭션 작업 안의 암묵 커밋 문장(DDL · 계정 · 관리 — 머리말 2 "트랜잭션 작업 안").
    ImplicitCommit,
    /// MySQL·MariaDB 트랜잭션 작업 · 스크립트 · AI 작업안 안의 `CALL` — 경계를 증명할 수 없다(머리말 2).
    ProcedureCall,
    /// MySQL·MariaDB 트랜잭션 작업 · 스크립트 · AI 작업안 안의 `CREATE`/`DROP TEMPORARY` — 되돌려지지 않는다(머리말 2).
    TemporaryTable,
    /// PostgreSQL 트랜잭션 작업 안의 트랜잭션 밖 전용 문장(`VACUUM` · `CONCURRENTLY` … — 머리말 2).
    OutsideTransaction,
    /// 스크립트 나누기 — 서버 설정(백슬래시 이스케이프)에 따라 문장 경계가 달라진다([`split_script`]).
    Ambiguous,
    /// 스크립트 나누기 — MySQL 클라이언트 명령 `DELIMITER`(서버 SQL 이 아니다 — [`split_script`]).
    Delimiter,
}

impl GuardError {
    /// 사용자에게 보일 한 줄.
    pub(crate) fn message(&self) -> String {
        match self {
            GuardError::Empty => tr!(ko: "실행할 문장이 없습니다", en: "There is no statement to run"),
            GuardError::Multiple => tr!(
                ko: "[실행]은 문장 하나씩입니다 — 여러 문장은 Alt+X(스크립트 실행)로 실행하세요",
                en: "[Run] runs one statement at a time — run several statements with Alt+X (Run script)"
            ),
            GuardError::Unterminated => tr!(
                ko: "따옴표나 식별자가 닫히지 않았습니다",
                en: "A quote or identifier is not closed"
            ),
            GuardError::ExecutableComment => tr!(
                ko: "MySQL 실행 주석(/*! … */)은 받지 않습니다",
                en: "MySQL executable comments (/*! … */) are not accepted"
            ),
            GuardError::IntoFile => tr!(
                ko: "읽기 전용 모드에서는 서버에 파일을 쓰는 INTO OUTFILE/DUMPFILE 을 실행하지 않습니다.",
                en: "Read-only mode does not run INTO OUTFILE/DUMPFILE, which writes a file on the server."
            ),
            GuardError::Transaction { dialect: Dialect::Postgres } => tr!(
                ko: "PostgreSQL 쓰기 모드는 트랜잭션 문장(BEGIN · COMMIT · ROLLBACK · SAVEPOINT · PREPARE TRANSACTION)을 받지 않습니다 — 여러 문장을 한 트랜잭션으로 묶으려면 위 띠의 스위치를 '수동 커밋'으로 바꾸거나 [트랜잭션 작업 시작]을 쓰세요.",
                en: "PostgreSQL write mode does not accept transaction statements (BEGIN · COMMIT · ROLLBACK · SAVEPOINT · PREPARE TRANSACTION) — to group statements in one transaction, switch to 'Manual commit' or use [Start transaction] in the bar above."
            ),
            GuardError::Transaction { dialect: Dialect::Mysql } => tr!(
                ko: "MySQL · MariaDB 쓰기 모드는 트랜잭션 문장(BEGIN · START TRANSACTION · COMMIT · ROLLBACK · SAVEPOINT · XA)과 autocommit · completion_type 을 바꾸는 SET 을 받지 않습니다 — 여러 문장을 한 트랜잭션으로 묶으려면 위 띠의 스위치를 '수동 커밋'으로 바꾸거나 [트랜잭션 작업 시작]을 쓰세요.",
                en: "MySQL · MariaDB write mode does not accept transaction statements (BEGIN · START TRANSACTION · COMMIT · ROLLBACK · SAVEPOINT · XA) or SET statements that change autocommit · completion_type — to group statements in one transaction, switch to 'Manual commit' or use [Start transaction] in the bar above."
            ),
            GuardError::Transaction { dialect: Dialect::Sqlite } => tr!(
                ko: "SQLite 쓰기 모드는 트랜잭션 문장(BEGIN · COMMIT · END · ROLLBACK · SAVEPOINT · RELEASE)을 받지 않습니다 — 여러 문장을 한 트랜잭션으로 묶으려면 위 띠의 스위치를 '수동 커밋'으로 바꾸거나 [트랜잭션 작업 시작]을 쓰세요.",
                en: "SQLite write mode does not accept transaction statements (BEGIN · COMMIT · END · ROLLBACK · SAVEPOINT · RELEASE) — to group statements in one transaction, switch to 'Manual commit' or use [Start transaction] in the bar above."
            ),
            GuardError::ImplicitCommit => tr!(
                ko: "트랜잭션 작업 중에는 MySQL · MariaDB 가 암묵적으로 커밋하는 문장(DDL · 계정 · 권한 · 관리 문장 · LOAD DATA)을 실행하지 않습니다 — [커밋]이나 [되돌리기]로 작업을 끝낸 뒤 스위치가 '자동 커밋'인 상태로 실행하세요.",
                en: "During a transaction, statements that MySQL · MariaDB commit implicitly (DDL · accounts · privileges · admin statements · LOAD DATA) do not run — finish with [Commit] or [Roll back] first, then run it with the switch on 'Auto-commit'."
            ),
            GuardError::ProcedureCall => tr!(
                ko: "트랜잭션 작업 · 스크립트 안에서는 MySQL · MariaDB 프로시저 호출(CALL)을 실행하지 않습니다 — 프로시저 안의 COMMIT · ROLLBACK · 암묵 커밋을 앱이 볼 수 없어 '실패하면 되돌림'을 약속할 수 없습니다. 작업을 끝낸 뒤 스위치가 '자동 커밋'인 상태에서 [실행](문장 하나)으로 실행하세요.",
                en: "Inside a transaction or a script, MySQL · MariaDB procedure calls (CALL) do not run — the app cannot see a COMMIT · ROLLBACK · implicit commit inside the procedure, so it cannot promise 'roll back on failure'. Finish the transaction, then run it alone with [Run] while the switch is on 'Auto-commit'."
            ),
            GuardError::TemporaryTable => tr!(
                ko: "트랜잭션 작업 · 스크립트 안에서는 MySQL · MariaDB 임시 테이블 만들기 · 지우기(CREATE/DROP TEMPORARY TABLE)를 실행하지 않습니다 — 되돌려지지 않아 '실패하면 되돌림' 약속이 깨집니다. 작업을 끝낸 뒤 스위치가 '자동 커밋'인 상태에서 [실행](문장 하나)으로 실행하세요.",
                en: "Inside a transaction or a script, MySQL · MariaDB temporary table creation · removal (CREATE/DROP TEMPORARY TABLE) does not run — it is not rolled back, which would break the 'roll back on failure' promise. Finish the transaction, then run it alone with [Run] while the switch is on 'Auto-commit'."
            ),
            GuardError::OutsideTransaction => tr!(
                ko: "PostgreSQL 은 이 문장(VACUUM · … CONCURRENTLY · CREATE/DROP DATABASE · ALTER SYSTEM 등)을 트랜잭션 안에서 실행하지 않습니다 — [커밋]이나 [되돌리기]로 작업을 끝낸 뒤 스위치가 '자동 커밋'인 상태로 실행하세요.",
                en: "PostgreSQL does not run this statement (VACUUM · … CONCURRENTLY · CREATE/DROP DATABASE · ALTER SYSTEM, etc.) inside a transaction — finish with [Commit] or [Roll back] first, then run it with the switch on 'Auto-commit'."
            ),
            GuardError::Ambiguous => tr!(
                ko: "백슬래시가 든 문자열 때문에 서버 설정에 따라 문장 경계가 달라질 수 있어 스크립트로 나누지 않습니다 — 그 문장을 골라 [실행]하거나 백슬래시를 빼세요.",
                en: "A string with a backslash makes the statement boundaries depend on server settings, so the script is not split — select that statement and use [Run], or remove the backslash."
            ),
            GuardError::Delimiter => tr!(
                ko: "DELIMITER 는 mysql 클라이언트 명령이라 지원하지 않습니다 — 스크립트는 세미콜론으로만 나눕니다.",
                en: "DELIMITER is a mysql client command and is not supported — scripts are split only on semicolons."
            ),
            GuardError::SessionLock => tr!(
                ko: "MySQL · MariaDB 쓰기 모드는 세션에 남는 잠금(LOCK TABLES · UNLOCK · FLUSH TABLES … WITH READ LOCK / FOR EXPORT)을 받지 않습니다 — 타일을 떠나도 연결이 잠금을 쥔 채 남습니다.",
                en: "MySQL · MariaDB write mode does not accept locks that stay on the session (LOCK TABLES · UNLOCK · FLUSH TABLES … WITH READ LOCK / FOR EXPORT) — the connection would keep holding them after you leave the tile."
            ),
            GuardError::ReadOnly { dialect, .. } => {
                let list = allowed(*dialect).join(" · ");
                tr!(
                    ko: "읽기 전용 모드에서는 조회 문장({list})만 실행합니다. 위 띠의 '읽기 전용'을 눌러 쓰기를 켜면 실행할 수 있습니다.",
                    en: "Read-only mode runs only query statements ({list}). Click 'Read-only' in the bar above to turn on writing."
                )
            }
        }
    }
}

/// 가드를 지난 문장.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Checked<'a> {
    /// 문장 본문 — 첫 코드 글자부터 마지막 코드 글자까지(앞뒤 공백·주석·끝 세미콜론을 뗀 것, 안의 주석은 그대로).
    pub sql: &'a str,
    /// 첫 낱말(대문자) — 앞의 여는 괄호는 건너뛴다(`(SELECT 1)` → `SELECT`). 낱말로 시작하지 않으면 빈 글자.
    pub keyword: String,
}

/// 렉서 한 벌의 규칙.
#[derive(Debug, Clone, Copy)]
struct Lex {
    /// `'…'` 안의 `\` 가 다음 글자를 가린다.
    backslash: bool,
    /// `"…"` 안의 `\` 도 (MySQL 의 큰따옴표 문자열).
    dq_backslash: bool,
    /// PG `$tag$ … $tag$`.
    dollar: bool,
    /// PG `E'…'`(늘 백슬래시).
    e_strings: bool,
    /// PG 블록 주석 중첩.
    nested: bool,
    /// MySQL `#` 줄 주석.
    hash_comment: bool,
    /// MySQL — `--` 뒤에 공백·제어 글자(또는 끝)가 와야 주석.
    dash_space: bool,
    /// SQLite `[식별자]`.
    brackets: bool,
    /// `` `식별자` ``.
    backtick: bool,
    /// MySQL 실행 주석 거절.
    exec_comment: bool,
}

const BASE: Lex = Lex {
    backslash: false,
    dq_backslash: false,
    dollar: false,
    e_strings: false,
    nested: false,
    hash_comment: false,
    dash_space: false,
    brackets: false,
    backtick: false,
    exec_comment: false,
};

/// 방언의 해석들 — PG·MySQL 은 백슬래시 두 해석.
fn variants(d: Dialect) -> Vec<Lex> {
    match d {
        Dialect::Sqlite => vec![Lex {
            brackets: true,
            backtick: true,
            ..BASE
        }],
        Dialect::Postgres => [false, true]
            .into_iter()
            .map(|bs| Lex {
                backslash: bs,
                dollar: true,
                e_strings: true,
                nested: true,
                ..BASE
            })
            .collect(),
        Dialect::Mysql => [true, false]
            .into_iter()
            .map(|bs| Lex {
                backslash: bs,
                dq_backslash: bs,
                hash_comment: true,
                dash_space: true,
                backtick: true,
                exec_comment: true,
                ..BASE
            })
            .collect(),
    }
}

/// 한 해석의 훑기 결과.
#[derive(Debug)]
struct Scan {
    /// 코드가 있는 문장들.
    segments: Vec<Seg>,
    /// 마지막 문장의 리터럴이 끝나지 않았다.
    unterminated: bool,
    /// 따옴표·주석·식별자 인용 밖에서 낱말 `INTO` 바로 뒤에 `OUTFILE`·`DUMPFILE` 이 왔다(MySQL 절 — 읽기 전용 거절).
    into_file: bool,
}

/// 문장 하나의 훑기 결과 — 쓰기 모드 검사([`write_check`])가 보는 낱말 표지는 모두 문자열·주석 **밖**에서 본 것이다.
#[derive(Debug, Default)]
struct Seg {
    /// 첫 코드 글자.
    start: usize,
    /// 마지막 코드 글자 뒤.
    end: usize,
    /// 첫 낱말(대문자 — 앞 여는 괄호는 건너뜀).
    keyword: String,
    /// 둘째 코드 낱말(대문자 — 사이의 공백·주석은 건너뜀). `START TRANSACTION` · `PREPARE TRANSACTION` 가르기.
    second: String,
    /// 낱말 `AUTOCOMMIT` · `COMPLETION_TYPE` 이 맨 낱말 또는 백틱·큰따옴표 인용 식별자로 나왔다(MySQL `SET … autocommit` ·
    /// `SET … completion_type` — Codex 검토 반영 1).
    autocommit: bool,
    /// 맨 낱말 `LOCK` · `EXPORT` 가 나왔다(MySQL `FLUSH TABLES … WITH READ LOCK` · `FOR EXPORT`).
    lock_word: bool,
    /// 맨 낱말 `CONCURRENTLY` 가 나왔다(PG `CREATE INDEX CONCURRENTLY` · `REINDEX … CONCURRENTLY` — 트랜잭션 작업 안 거절).
    concurrently: bool,
    /// 이 문장의 코드 낱말 수(둘째 낱말 자리 세기).
    words: usize,
}

/// 트랜잭션 경계를 바꾸는 MySQL 세션 변수 이름인가 — `autocommit` · `completion_type`(체인 · 끊기 — Codex 검토 반영 1).
fn session_tx_word(w: &str) -> bool {
    w.eq_ignore_ascii_case("AUTOCOMMIT") || w.eq_ignore_ascii_case("COMPLETION_TYPE")
}

fn ident_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

fn ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c >= 0x80
}

/// `q` 로 감싼 리터럴의 끝(닫는 따옴표 뒤) — 두 번 겹친 `qq` 는 그 글자 하나. 끝나지 않으면 `None`.
fn skip_quoted(b: &[u8], open: usize, q: u8, backslash: bool) -> Option<usize> {
    let mut j = open + 1;
    while j < b.len() {
        let c = b[j];
        if backslash && c == b'\\' {
            j += 2;
            continue;
        }
        if c == q {
            if b.get(j + 1) == Some(&q) {
                j += 2;
                continue;
            }
            return Some(j + 1);
        }
        j += 1;
    }
    None
}

/// PG `$tag$` 여는 표지의 끝(두 번째 `$` 뒤) — 표지가 아니면 `None`. 태그는 비거나 숫자로 시작하지 않는 식별자.
fn dollar_tag(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    if b.get(j).is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] >= 0x80) {
        j += 1;
    }
    (b.get(j) == Some(&b'$')).then_some(j + 1)
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from > hay.len() {
        return None;
    }
    hay[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

fn scan(sql: &str, o: Lex) -> Result<Scan, GuardError> {
    let b = sql.as_bytes();
    let n = b.len();
    let mut i = 0usize;
    let mut segments = Vec::new();
    let mut code: Option<(usize, usize)> = None; // (첫 코드, 마지막 코드 뒤)
    let mut seg = Seg::default();
    // 이 문장에서 아직 여는 괄호만 봤다 — 첫 낱말 자리.
    let mut lead = true;
    let mut unterminated = false;
    // 바로 앞 코드 낱말이 맨 낱말 `INTO` 였다(공백·주석은 낱말이 아니라 이 표시를 지우지 않는다).
    let mut after_into = false;
    let mut into_file = false;
    while i < n {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let next = b.get(i + 1).copied();
        // 줄 주석
        let dash = c == b'-'
            && next == Some(b'-')
            && (!o.dash_space || b.get(i + 2).is_none_or(|x| x.is_ascii_whitespace() || x.is_ascii_control()));
        if dash || (o.hash_comment && c == b'#') {
            while i < n && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // 블록 주석
        if c == b'/' && next == Some(b'*') {
            if o.exec_comment && (b.get(i + 2) == Some(&b'!') || (b.get(i + 2) == Some(&b'M') && b.get(i + 3) == Some(&b'!'))) {
                return Err(GuardError::ExecutableComment);
            }
            let mut depth = 1usize;
            let mut j = i + 2;
            while j < n {
                if o.nested && b[j] == b'/' && b.get(j + 1) == Some(&b'*') {
                    depth += 1;
                    j += 2;
                    continue;
                }
                if b[j] == b'*' && b.get(j + 1) == Some(&b'/') {
                    depth -= 1;
                    j += 2;
                    if depth == 0 {
                        break;
                    }
                    continue;
                }
                j += 1;
            }
            i = j.min(n);
            continue;
        }
        if c == b';' {
            let done = std::mem::take(&mut seg);
            if let Some((start, end)) = code.take() {
                segments.push(Seg { start, end, ..done });
            }
            lead = true;
            after_into = false;
            i += 1;
            continue;
        }
        // 코드 낱말 하나
        let start = i;
        let first = lead;
        lead = lead && c == b'(';
        let prev_ident = i > 0 && ident_byte(b[i - 1]);
        let was_into = std::mem::take(&mut after_into);
        let end: Option<usize> = if c == b'\'' {
            skip_quoted(b, i, b'\'', o.backslash)
        } else if o.e_strings && (c == b'E' || c == b'e') && next == Some(b'\'') && !prev_ident {
            skip_quoted(b, i + 1, b'\'', true)
        } else if c == b'"' || (o.backtick && c == b'`') {
            let e = skip_quoted(b, i, c, c == b'"' && o.dq_backslash);
            // 인용 식별자(`autocommit` · ANSI_QUOTES 의 "autocommit") — 큰따옴표가 문자열인 서버에서는 지나친 거절 쪽이다.
            if let Some(e) = e {
                if session_tx_word(&sql[i + 1..e - 1]) {
                    seg.autocommit = true;
                }
            }
            e
        } else if o.brackets && c == b'[' {
            b[i + 1..].iter().position(|&x| x == b']').map(|p| i + 1 + p + 1)
        } else if o.dollar && c == b'$' && !prev_ident {
            match dollar_tag(b, i) {
                Some(open_end) => find(b, &b[i..open_end], open_end).map(|p| p + (open_end - i)),
                None => Some(i + 1),
            }
        } else if ident_start(c) {
            let mut j = i + 1;
            while j < n && ident_byte(b[j]) {
                j += 1;
            }
            let word = &sql[i..j];
            if first {
                seg.keyword = word.to_ascii_uppercase();
            } else if seg.words == 1 {
                seg.second = word.to_ascii_uppercase();
            }
            seg.words += 1;
            seg.autocommit |= session_tx_word(word);
            seg.lock_word |= word.eq_ignore_ascii_case("LOCK") || word.eq_ignore_ascii_case("EXPORT");
            seg.concurrently |= word.eq_ignore_ascii_case("CONCURRENTLY");
            if was_into && (word.eq_ignore_ascii_case("OUTFILE") || word.eq_ignore_ascii_case("DUMPFILE")) {
                into_file = true;
            }
            after_into = word.eq_ignore_ascii_case("INTO");
            Some(j)
        } else {
            Some(i + 1)
        };
        let end = match end {
            Some(e) => e,
            None => {
                unterminated = true;
                n
            }
        };
        code = Some((code.map_or(start, |(s, _)| s), end));
        i = end;
        if unterminated {
            break;
        }
    }
    if let Some((start, end)) = code {
        segments.push(Seg { start, end, ..seg });
    }
    Ok(Scan {
        segments,
        unterminated,
        into_file,
    })
}

/// 실행 모드 — 가드가 보는 규칙이 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    /// 읽기 전용 — 첫 낱말 허용 목록(머리말 2).
    ReadOnly,
    /// 쓰기 · 문장마다 자동 커밋 — 사람의 트랜잭션·세션 잠금 문장 거절(머리말 2).
    AutoCommit,
    /// 쓰기 · 앱이 연 트랜잭션 작업 안(1단계) — 자동 커밋의 거절 + 트랜잭션을 몰래 끝내거나 깨뜨리는 문장 거절([`tx_check`]).
    Transaction,
}

impl Mode {
    /// 쓰기 켬/끔과 트랜잭션 작업 여부로.
    pub(crate) fn of(writable: bool, in_tx: bool) -> Mode {
        match (writable, in_tx) {
            (false, _) => Mode::ReadOnly,
            (true, false) => Mode::AutoCommit,
            (true, true) => Mode::Transaction,
        }
    }
}

/// SQL 한 덩어리를 본다 — 문장 하나이고(모든 해석에서), 읽기 전용 모드면 첫 낱말이 허용 목록 안일 때만 통과.
/// 트랜잭션 작업을 모르는 꼴(읽기 전용 · 자동 커밋 — 시험의 짧은 꼴) — 엔진은 [`check_mode`] 를 쓴다.
#[cfg(test)]
pub(crate) fn check(sql: &str, dialect: Dialect, writable: bool) -> Result<Checked<'_>, GuardError> {
    check_mode(sql, dialect, Mode::of(writable, false))
}

/// [`check`] 의 모드 꼴 — 트랜잭션 작업 안이면 [`tx_check`] 까지.
pub(crate) fn check_mode(sql: &str, dialect: Dialect, mode: Mode) -> Result<Checked<'_>, GuardError> {
    let writable = mode != Mode::ReadOnly;
    // 끝까지 읽힌 해석들의 문장 — 첫 것이 본문, 쓰기 모드 검사는 **어느 하나라도** 걸리면 거절 쪽.
    let mut read: Vec<Seg> = Vec::new();
    let mut into_file = false;
    for lex in variants(dialect) {
        let s = scan(sql, lex)?;
        match s.segments.len() {
            0 => return Err(GuardError::Empty),
            1 => {}
            _ => return Err(GuardError::Multiple),
        }
        if s.unterminated {
            continue;
        }
        // 끝까지 읽힌 해석 어느 하나라도 절을 보면 거절 쪽(끝나지 않은 해석의 서버는 구문 오류로 아무것도 안 돈다).
        into_file |= s.into_file;
        read.extend(s.segments);
    }
    let Some(first) = read.first() else {
        return Err(GuardError::Unterminated);
    };
    let text = &sql[first.start..first.end];
    if !writable {
        read_only_check(dialect, &first.keyword, text)?;
        if dialect == Dialect::Mysql && into_file {
            return Err(GuardError::IntoFile);
        }
    } else {
        for seg in &read {
            write_check(dialect, seg)?;
            if mode == Mode::Transaction {
                tx_check(dialect, seg)?;
            }
        }
    }
    Ok(Checked {
        sql: text,
        keyword: first.keyword.clone(),
    })
}

/// **스크립트 실행의 문장 나누기**(2단계 — `db::script`) — 글 한 덩어리를 최상위 `;` 로 갈라 각 문장의 `[처음 코드 글자, 마지막 코드
/// 글자 뒤)` 바이트 범위를 돌려준다(끝 `;` · 앞뒤 공백 · 바깥 주석은 범위 밖). 렉서는 [`check_mode`] 와 같은 것이고, 나뉜 문장마다
/// 부르는 쪽이 다시 [`check_mode`] 를 지난다(문장 하나 · 모드의 거절).
///
/// 어긋나면 늘 **거절** 쪽이다(머리말 "엔진과 렉서가 어긋나는 자리"):
/// - 해석(백슬래시 이스케이프 둘)마다 경계가 다르거나, 한 해석에서라도 리터럴이 끝나지 않으면 [`GuardError::Ambiguous`] — 하나로 보는
///   [`check_mode`] 와 달리 스크립트는 어느 해석에서든 같은 문장들로 나뉘어야 한다(아니면 서버가 우리가 보낸 조각과 다른 문장을 볼 수
///   있다). 모든 해석에서 끝나지 않으면 [`GuardError::Unterminated`].
/// - MySQL 클라이언트 명령 `DELIMITER` 는 [`GuardError::Delimiter`](서버 SQL 이 아니고, 그 뒤 본문을 `;` 로 자르면 엉뚱한 조각이 된다).
/// - 문장이 없으면 [`GuardError::Empty`]. MySQL 실행 주석은 [`GuardError::ExecutableComment`].
pub(crate) fn split_script(sql: &str, dialect: Dialect) -> Result<Vec<(usize, usize)>, GuardError> {
    let mut seen: Option<Vec<(usize, usize)>> = None;
    let mut unterminated = 0usize;
    let all = variants(dialect);
    for lex in &all {
        let s = scan(sql, *lex)?;
        if s.unterminated {
            unterminated += 1;
            continue;
        }
        if dialect == Dialect::Mysql && s.segments.iter().any(|g| g.keyword == "DELIMITER") {
            return Err(GuardError::Delimiter);
        }
        let spans: Vec<(usize, usize)> = s.segments.iter().map(|g| (g.start, g.end)).collect();
        match &seen {
            None => seen = Some(spans),
            Some(prev) if *prev != spans => return Err(GuardError::Ambiguous),
            Some(_) => {}
        }
    }
    if unterminated == all.len() {
        return Err(GuardError::Unterminated);
    }
    if unterminated > 0 {
        return Err(GuardError::Ambiguous);
    }
    match seen {
        Some(v) if !v.is_empty() => Ok(v),
        _ => Err(GuardError::Empty),
    }
}

/// MySQL·MariaDB 의 암묵 커밋 문장 — 첫 낱말(머리말 2 "트랜잭션 작업 안" 의 공식 목록). 둘째 낱말로 가르는 것은
/// [`tx_check`] 에 따로 있다: `CREATE`·`DROP` 은 둘째 낱말이 `TEMPORARY` 면 받는다 · `ANALYZE` 는 테이블 꼴만(MariaDB
/// `ANALYZE SELECT …` 는 문장 분석이다) · `START` 는 `TRANSACTION` 밖(복제 · 그룹 복제 — `START TRANSACTION` 은 이미 트랜잭션
/// 문장으로 걸린다) · `SET` 은 `PASSWORD`·`DEFAULT ROLE`. `LOCK`·`UNLOCK`·`BEGIN`·`SET autocommit` 은 [`write_check`] 가 이미 건다.
/// `CHANGE` = `CHANGE MASTER`/`REPLICATION SOURCE`/`REPLICATION FILTER` · `STOP` = 복제 · `LOAD` = `LOAD DATA`·`LOAD XML`·`LOAD INDEX`.
const MYSQL_IMPLICIT_COMMIT: &[&str] = &[
    "ALTER", "RENAME", "TRUNCATE", "GRANT", "REVOKE", "INSTALL", "UNINSTALL", "OPTIMIZE", "REPAIR", "CHECK", "CACHE", "LOAD",
    "FLUSH", "RESET", "CHANGE", "STOP",
];

/// PG 의 트랜잭션 밖 전용 문장(25001 — `PreventInTransactionBlock`) 중 첫 낱말·둘째 낱말로 알 수 있는 것. 함수 안에서 나는 것 ·
/// 판마다 늘어나는 것은 못 본다(그때는 서버의 25001 이 트랜잭션을 중단시키고 앱이 되돌린다).
fn pg_outside_only(seg: &Seg) -> bool {
    let (k, s2) = (seg.keyword.as_str(), seg.second.as_str());
    match k {
        "VACUUM" => true,
        "CREATE" | "DROP" => matches!(s2, "DATABASE" | "TABLESPACE" | "SUBSCRIPTION") || seg.concurrently,
        "ALTER" => matches!(s2, "SYSTEM" | "SUBSCRIPTION"),
        "REINDEX" => seg.concurrently || matches!(s2, "DATABASE" | "SYSTEM"),
        // 인자 없는 `CLUSTER`(· `CLUSTER VERBOSE`) 만 — `CLUSTER t USING i` 는 트랜잭션 안에서 돈다.
        "CLUSTER" => seg.words == 1 || (seg.words == 2 && s2 == "VERBOSE"),
        "DISCARD" => s2 == "ALL",
        _ => false,
    }
}

/// 트랜잭션 작업 안의 거절(머리말 2 "트랜잭션 작업 안") — [`write_check`] 를 지난 문장에만.
fn tx_check(d: Dialect, seg: &Seg) -> Result<(), GuardError> {
    let (k, s2) = (seg.keyword.as_str(), seg.second.as_str());
    match d {
        Dialect::Mysql => {
            let implicit = match k {
                "CREATE" | "DROP" => s2 != "TEMPORARY",
                "ANALYZE" => matches!(s2, "TABLE" | "TABLES" | "NO_WRITE_TO_BINLOG" | "LOCAL"),
                "START" => s2 != "TRANSACTION",
                "SET" => s2 == "PASSWORD" || (s2 == "DEFAULT" && seg.words >= 3),
                _ => MYSQL_IMPLICIT_COMMIT.contains(&k),
            };
            if implicit {
                return Err(GuardError::ImplicitCommit);
            }
            if k == "CALL" {
                return Err(GuardError::ProcedureCall);
            }
            if matches!(k, "CREATE" | "DROP") && s2 == "TEMPORARY" {
                return Err(GuardError::TemporaryTable);
            }
        }
        Dialect::Postgres => {
            if pg_outside_only(seg) {
                return Err(GuardError::OutsideTransaction);
            }
        }
        Dialect::Sqlite => {}
    }
    Ok(())
}

/// 세 방언 공통 — 쓰기 모드에서 받지 않는 트랜잭션 문장의 첫 낱말(머리말 2). 실재하는 꼴:
/// - PG: `BEGIN` · `START TRANSACTION` · `COMMIT`/`END`(별칭) · `ROLLBACK`/`ABORT`(별칭) · `SAVEPOINT` · `RELEASE [SAVEPOINT]` ·
///   `ROLLBACK TO` · `COMMIT PREPARED` · `ROLLBACK PREPARED`(2단계 커밋 — 첫 낱말로 같이 걸린다).
/// - MySQL·MariaDB: `BEGIN [WORK]` · `START TRANSACTION` · `COMMIT`/`ROLLBACK [WORK] [AND [NO] CHAIN]` · `SAVEPOINT` ·
///   `ROLLBACK [WORK] TO` · `RELEASE SAVEPOINT`. MariaDB 익명 블록 `BEGIN NOT ATOMIC … END` 도 첫 낱말 `BEGIN` 으로 걸린다 —
///   안에서 트랜잭션을 다룰 수 있으니 알고 받는 거절. `END`·`ABORT` 문장은 없다(걸어도 잃는 것이 없다).
/// - SQLite: `BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE]` · `END`/`COMMIT [TRANSACTION]` · `ROLLBACK [TO]` · `SAVEPOINT` · `RELEASE`.
///   `ABORT` 문장은 없다(충돌 절 `OR ABORT` 는 첫 낱말이 아니다).
///
/// `START` 는 둘째 낱말이 `TRANSACTION` 일 때만 — MySQL `START REPLICA`·`START GROUP_REPLICATION` 은 트랜잭션이 아니다.
const TRANSACTION_WORDS: &[&str] = &["BEGIN", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"];

/// 쓰기 모드의 거절 — 사람이 트랜잭션·세션 잠금을 여는 문장(머리말 2).
///
/// 왜: 앱은 쓰기 모드를 "문장마다 자동 커밋" 으로 약속한다. PG 는 엔진이 문장마다 제 트랜잭션으로 감싸 사람이 연 것이 다음
/// 문장에 조용히 커밋되고, SQLite·MySQL·MariaDB 는 감싸지 않아 사람이 연 트랜잭션이 **화면 표시 없이** 남는다 — 그 연결은
/// 떼어 두기(F5 · 크래시 · GUI 종료 — 10분) 동안 잠금을 쥔 채 산다(10-13 결정 0단계). 트랜잭션은 앱이 열고 닫는다(1단계).
fn write_check(d: Dialect, seg: &Seg) -> Result<(), GuardError> {
    let k = seg.keyword.as_str();
    let tx = TRANSACTION_WORDS.contains(&k)
        || (k == "START" && seg.second == "TRANSACTION")
        || match d {
            // `PREPARE TRANSACTION 'gid'`(2단계 커밋의 준비 — 트랜잭션이 세션을 떠나 잠금을 쥔 채 서버에 남는다)만 걸고,
            // 일반 `PREPARE 이름 AS …`(이름 있는 준비 문장 — 세션에 남지만 트랜잭션·잠금이 없다)은 지금 규칙대로 받는다.
            // 이름이 `transaction` 인 준비 문장은 지나친 거절 쪽이다.
            Dialect::Postgres => k == "PREPARE" && seg.second == "TRANSACTION",
            // `XA …` 는 전부(START·BEGIN·END·PREPARE·COMMIT·ROLLBACK·RECOVER) — XA 트랜잭션은 세션·서버에 남는다.
            // `SET … autocommit` 은 낱말이 문장 어디에 있든 건다(대입 여러 개 · `@@autocommit` · `@@session.` · `SESSION`/`LOCAL`/
            // `GLOBAL`/`PERSIST` · 백틱 인용 · MariaDB `SET STATEMENT … FOR`). `SET` 의 다른 쓰임은 그대로 받는다. 세션 값 대입의
            // 모든 문법을 따라가는 대신 낱말 하나로 거는 쪽이 단순하고 빠짐없다 — 이 낱말은 시스템 변수 이름으로만 쓰인다
            // (작은따옴표 문자열 `'autocommit'` 은 보지 않는다). 지나친 거절: 큰따옴표 문자열 "autocommit" · 사용자 변수 `@autocommit`.
            Dialect::Mysql => k == "XA" || (k == "SET" && seg.autocommit),
            Dialect::Sqlite => false,
        };
    if tx {
        return Err(GuardError::Transaction { dialect: d });
    }
    // MySQL·MariaDB 세션 잠금 — `LOCK TABLES`·`LOCK INSTANCE FOR BACKUP` 과 `UNLOCK …`, `FLUSH TABLES … WITH READ LOCK` ·
    // `FLUSH TABLES … FOR EXPORT`. 자동 커밋과 무관하게 **세션에 남는** 잠금이라 떼어 두기 동안 연결이 쥔다.
    // (PG `LOCK TABLE` 은 엔진이 문장마다 감싼 트랜잭션 끝에 풀리므로 받는다 · SQLite 에는 없다.)
    if d == Dialect::Mysql && (k == "LOCK" || k == "UNLOCK" || (k == "FLUSH" && seg.lock_word)) {
        return Err(GuardError::SessionLock);
    }
    Ok(())
}

/// 읽기 전용 모드에서 받는 첫 낱말(엔진별 허용 목록) — 조회 문장뿐이다. MySQL·MariaDB 의 `DESC` 는 `DESCRIBE` 의 줄임.
/// SQLite `PRAGMA` 는 목록에 있지만 읽기 꼴만 받는다([`sqlite_pragma_reads`]).
fn allowed(d: Dialect) -> &'static [&'static str] {
    match d {
        Dialect::Postgres => &["SELECT", "WITH", "VALUES", "TABLE", "EXPLAIN", "SHOW"],
        Dialect::Mysql => &["SELECT", "WITH", "VALUES", "TABLE", "EXPLAIN", "SHOW", "DESCRIBE", "DESC"],
        Dialect::Sqlite => &["SELECT", "WITH", "VALUES", "EXPLAIN", "PRAGMA"],
    }
}

/// 읽기 전용 모드에서 **함수 꼴 `name(인자)` 로 받아도 되는**(읽기만 하는) SQLite PRAGMA — 인자가 *값*이 아니라 조회할 대상
/// (표·인덱스 이름 · 검사할 오류 수 상한)인 것만. 그 밖의 `name(값)` 은 `name = 값` 과 같은 쓰기 꼴이라 거절한다.
const SQLITE_PRAGMA_READ_WITH_ARG: &[&str] = &[
    "table_info",
    "table_xinfo",
    "table_list",
    "index_list",
    "index_info",
    "index_xinfo",
    "foreign_key_list",
    "foreign_key_check",
    "integrity_check",
    "quick_check",
];

/// 읽기 전용 모드에서 인자 없이도 받지 않는 SQLite PRAGMA(값을 읽는 게 아니라 일을 한다).
const SQLITE_PRAGMA_ACTIONS: &[&str] = &["optimize", "wal_checkpoint", "incremental_vacuum", "shrink_memory"];

fn read_only_check(d: Dialect, keyword: &str, text: &str) -> Result<(), GuardError> {
    let pass = allowed(d).contains(&keyword) && (keyword != "PRAGMA" || sqlite_pragma_reads(text));
    if pass {
        return Ok(());
    }
    Err(GuardError::ReadOnly {
        keyword: keyword.to_string(),
        dialect: d,
    })
}

/// `PRAGMA [schema.]name[(arg)]` 가 읽기만 하는가 — `=` 꼴은 늘 쓰기, `(인자)` 꼴은 허용 목록만, 맨 꼴은 동작 목록이 아니면.
/// 모양을 못 알아보면(괄호로 시작하는 `(PRAGMA …)` 포함) 거절한다.
fn sqlite_pragma_reads(text: &str) -> bool {
    if !text.get(.."PRAGMA".len()).is_some_and(|h| h.eq_ignore_ascii_case("PRAGMA")) {
        return false;
    }
    let rest = text["PRAGMA".len()..].trim_start();
    if rest.contains('=') {
        return false;
    }
    let name_end = rest
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '.'))
        .unwrap_or(rest.len());
    let full = &rest[..name_end];
    let name = full.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if name.is_empty() {
        return false;
    }
    let tail = rest[name_end..].trim();
    if tail.is_empty() {
        return !SQLITE_PRAGMA_ACTIONS.contains(&name.as_str());
    }
    tail.starts_with('(') && SQLITE_PRAGMA_READ_WITH_ARG.contains(&name.as_str())
}
