//! **AI 쓰기 작업안의 사전 검증**(쿼리 타일 3단계 3b — docs/log/2026-10-13-db-write-mcp-design.md B-6 · D7) — **순수**(연결 · 파일 · 시계
//! 없음). MCP `create_db_write_plan`(`mcp::db`)이 작업안을 **만들기 전에** 부른다: 하나라도 거절이면 작업안이 생기지 않는다.
//!
//! ## 불변식
//!
//! - **실행이 없다** — 이 모듈은 문장을 나누고 가드를 지나게 할 뿐 엔진 · 연결 · 표에 닿지 않는다. 실행은 사람이 승인한 뒤 세션 서버의
//!   작업안 실행기(`operations::db_exec`)가 `db::ai_write` 로 한다 — MCP 에는 그 길이 없다(시험 `mcp_reaches_db_only_through_ai_facade`).
//! - 검증은 2단계 스크립트 실행기의 사전 검증(`script::plan(…, ScriptMode::Write)` — 문장마다 [`guard::Mode::Transaction`]: 사람의 트랜잭션
//!   문장 · MySQL 암묵 커밋(DDL · `LOCK TABLES` …) · PG 트랜잭션 밖 전용 문장 거절)을 **그대로** 쓴다. 실행기는 승인 뒤 같은 함수로 다시
//!   계획한다(저장된 글이 그 사이 바뀌지 않았어도 두 번 — 형으로 "가드를 지난 문장만" 을 지키는 자리가 그쪽이다).
//! - 문장 목록의 **항목 하나 = 문장 하나**다 — 한 항목이 여러 문장으로 나뉘면 거절한다(검토 카드가 사람에게 보이는 단위와 실행 단위가
//!   같아야 영향 행 · 실패 자리를 말할 수 있다).
//!
//! ## 상한(B-4)
//!
//! 문장 [`STATEMENTS_MAX`](20) · 글 합 [`BYTES_MAX`](64 KiB) · 문장마다 시간 기본 [`STMT_TIMEOUT_DEFAULT_S`](30초) · 최대
//! [`STMT_TIMEOUT_MAX_S`](300초) · `maxAffected` 0 ..= [`MAX_AFFECTED_LIMIT`] · 결과에 싣는 `RETURNING` 행 [`RETURNING_ROWS`](20).

use super::guard::{self, Mode};
use super::script::{self, ScriptMode};
use super::Dialect;
use crate::db::conns::DbEngine;

/// 작업안 하나의 문장 수 상한.
pub(crate) const STATEMENTS_MAX: usize = 20;
/// 문장 글 합의 상한(바이트).
pub(crate) const BYTES_MAX: usize = 64 * 1024;
/// `maxAffected` 의 상한 — 넘는 값은 사람이 검토할 수 있는 "범위" 가 아니다.
pub(crate) const MAX_AFFECTED_LIMIT: u64 = 10_000_000;
/// 문장마다의 시간 제한 기본(초).
pub(crate) const STMT_TIMEOUT_DEFAULT_S: u32 = 30;
/// 문장마다의 시간 제한 최대(초).
pub(crate) const STMT_TIMEOUT_MAX_S: u32 = 300;
/// 결과에 싣는 행(`RETURNING` · 확인용 `SELECT`)의 상한 — 문장마다.
pub(crate) const RETURNING_ROWS: usize = 20;

/// 검증을 지난 문장 하나 — 저장 · 표시용(실행기는 글에서 다시 계획한다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CheckedStmt {
    /// 가드가 돌려준 문장(끝의 `;` · 앞뒤 공백을 뗀 것).
    pub text: String,
    /// 첫 낱말(대문자).
    pub keyword: String,
    /// 엔진이 영향 행을 세는 문장인가(`INSERT` · `UPDATE` · `DELETE` · `MERGE` · `REPLACE`) — `maxAffected` 가 막을 수 있는 문장.
    pub counted: bool,
    /// 바꾸는 문장인데 영향 행을 세지 않는다(DDL · `TRUNCATE` · `WITH … DELETE` · `CALL` …) — `maxAffected` 가 막지 **못하는** 문장이라
    /// 검토 카드가 따로 밝힌다. 읽기 문장(읽기 전용 가드를 지나는 `SELECT` · `VALUES` · `SHOW` …)은 아니다.
    pub uncounted: bool,
}

/// 연결의 엔진 → 가드의 방언(MariaDB 는 MySQL 규칙).
pub(crate) fn dialect_of(engine: DbEngine) -> Dialect {
    match engine {
        DbEngine::Postgres => Dialect::Postgres,
        DbEngine::Mysql | DbEngine::Mariadb => Dialect::Mysql,
        DbEngine::Sqlite => Dialect::Sqlite,
    }
}

/// `maxAffected` 를 다듬는다 — 없거나 정수가 아니거나 상한 밖이면 오류(조용히 기본값으로 바꾸지 않는다 — 검토 카드에 사람이 볼 숫자다).
pub(crate) fn max_affected(v: Option<&serde_json::Value>) -> Result<u64, String> {
    let n = v.and_then(serde_json::Value::as_u64).ok_or_else(|| {
        format!(
            "maxAffected is required: the most rows all the statements together may change (an integer 0..={MAX_AFFECTED_LIMIT}). \
             Count first with db_query (SELECT count(*) … WHERE …) and pass that number (or a little more) — if the run changes more, \
             the whole transaction is rolled back before commit"
        )
    })?;
    if n > MAX_AFFECTED_LIMIT {
        return Err(format!("maxAffected is too large (at most {MAX_AFFECTED_LIMIT}) — split the change into smaller plans"));
    }
    Ok(n)
}

/// 문장마다의 시간 제한(초) — 없으면 기본, 정수면 1..=최대로 조인다, 그 밖이면 오류.
pub(crate) fn stmt_timeout(v: Option<&serde_json::Value>) -> Result<u32, String> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(STMT_TIMEOUT_DEFAULT_S),
        Some(x) => x
            .as_u64()
            .map(|n| n.clamp(1, STMT_TIMEOUT_MAX_S as u64) as u32)
            .ok_or_else(|| format!("timeoutSeconds must be an integer in 1..{STMT_TIMEOUT_MAX_S}")),
    }
}

/// **사전 검증** — 문장 목록을 그 방언의 쓰기 스크립트 규칙(`script::plan(…, ScriptMode::Write)`)으로 하나씩 본다. 하나라도 거절이면 오류
/// (AI 가 읽는 영어 — 몇 번째 문장인지와 까닭). **순수.**
pub(crate) fn check(statements: &[String], dialect: Dialect) -> Result<Vec<CheckedStmt>, String> {
    if statements.is_empty() {
        return Err("statements is empty — pass one SQL statement per item".into());
    }
    if statements.len() > STATEMENTS_MAX {
        return Err(format!(
            "{} statements — a write plan holds at most {STATEMENTS_MAX}. Split the change into several plans",
            statements.len()
        ));
    }
    let bytes: usize = statements.iter().map(String::len).sum();
    if bytes > BYTES_MAX {
        return Err(format!("The statements are too long together (at most {} KiB)", BYTES_MAX / 1024));
    }
    let mut out = Vec::with_capacity(statements.len());
    for (i, text) in statements.iter().enumerate() {
        let n = i + 1;
        if text.contains('\0') {
            return Err(format!("Statement {n} contains a NUL byte"));
        }
        let planned = script::plan(text, dialect, ScriptMode::Write).map_err(|e| match e {
            script::PlanError::Statement { err, .. } => format!("Statement {n} is refused: {}", refusal_text(&err)),
            other => format!("Statement {n} is refused: {}", other.message()),
        })?;
        let [one] = planned.as_slice() else {
            return Err(format!(
                "Item {n} holds {} statements — put exactly one statement in each item of statements",
                planned.len()
            ));
        };
        let keyword = one.keyword().to_string();
        let counted = super::counts_returned_rows(&keyword);
        // 읽기 문장 = 읽기 전용 가드를 지나는 것(`WITH` 은 안에 쓰기를 숨길 수 있어 빼고 본다).
        let reads = keyword != "WITH" && guard::check_mode(one.text(), dialect, Mode::ReadOnly).is_ok();
        out.push(CheckedStmt {
            text: one.text().to_string(),
            keyword,
            counted,
            uncounted: !counted && !reads,
        });
    }
    Ok(out)
}

/// 가드 거절 → AI 가 읽는 말(영어 — MCP 표면). 사람 타일의 "[커밋]을 눌러라" 류 안내는 AI 작업안에 뜻이 없어 바꿔 말한다.
fn refusal_text(e: &guard::GuardError) -> String {
    use guard::GuardError as G;
    match e {
        G::Transaction { .. } => "transaction control (BEGIN, START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT, XA, PREPARE TRANSACTION, SET autocommit/completion_type)              is not allowed — the app itself runs the whole plan in one transaction"
            .into(),
        G::SessionLock => "session locks (LOCK TABLES, UNLOCK TABLES, FLUSH TABLES … WITH READ LOCK) are not allowed in a plan".into(),
        G::ImplicitCommit => "MySQL/MariaDB commit implicitly on this statement (DDL, accounts, privileges, admin statements, LOAD DATA), so it              cannot be part of a transactional plan — ask the user to run it themselves in a query tile"
            .into(),
        G::ProcedureCall => "MySQL/MariaDB procedure calls (CALL) are not allowed in a plan — the app cannot see a COMMIT or ROLLBACK \
             inside the procedure, so it could not promise to roll back on failure or over maxAffected. Ask the user to run it themselves in a query tile"
            .into(),
        G::TemporaryTable => "MySQL/MariaDB CREATE/DROP TEMPORARY TABLE is not rolled back, so it cannot be part of a transactional plan — \
             ask the user to run it themselves in a query tile"
            .into(),
        G::OutsideTransaction => "PostgreSQL cannot run this statement inside a transaction (VACUUM, … CONCURRENTLY, CREATE/DROP DATABASE,              ALTER SYSTEM …) — ask the user to run it themselves in a query tile"
            .into(),
        other => other.message(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// 쓰기 · 읽기 · 바꾸되 세지 않는 문장을 가른다 — `WITH` 은 늘 "세지 않음" 쪽.
    #[test]
    fn classifies_statements() {
        let got = check(
            &s(&["UPDATE t SET a = 1 WHERE id = 3;", "select count(*) from t", "CREATE INDEX i ON t(a)", "WITH x AS (DELETE FROM t RETURNING *) SELECT 1"]),
            Dialect::Postgres,
        )
        .unwrap();
        let k: Vec<(&str, bool, bool)> = got.iter().map(|c| (c.keyword.as_str(), c.counted, c.uncounted)).collect();
        assert_eq!(k, [("UPDATE", true, false), ("SELECT", false, false), ("CREATE", false, true), ("WITH", false, true)]);
        assert_eq!(got[0].text, "UPDATE t SET a = 1 WHERE id = 3");
    }

    /// 사전 거절 — 트랜잭션 제어 · MySQL 암묵 커밋 · PG 트랜잭션 밖 전용 · 한 항목에 두 문장 · 상한.
    #[test]
    fn refuses_before_any_plan_exists() {
        for (stmts, dialect, want) in [
            (s(&["COMMIT"]), Dialect::Postgres, "Statement 1"),
            (s(&["UPDATE t SET a=1", "BEGIN"]), Dialect::Postgres, "Statement 2"),
            (s(&["VACUUM t"]), Dialect::Postgres, "Statement 1"),
            (s(&["ALTER TABLE t ADD c INT"]), Dialect::Mysql, "Statement 1"),
            (s(&["SET autocommit = 0"]), Dialect::Mysql, "Statement 1"),
            (s(&["LOCK TABLES t WRITE"]), Dialect::Mysql, "Statement 1"),
            (s(&["UPDATE t SET a = 1", "CALL p()"]), Dialect::Mysql, "Statement 2 is refused: MySQL/MariaDB procedure calls"),
            (s(&["CREATE TEMPORARY TABLE tt(a int)"]), Dialect::Mysql, "Statement 1 is refused: MySQL/MariaDB CREATE/DROP TEMPORARY"),
            (s(&["SET SESSION completion_type = 1"]), Dialect::Mysql, "Statement 1"),
            (s(&["DELETE FROM t; DELETE FROM u"]), Dialect::Sqlite, "Item 1 holds 2"),
            (s(&["BEGIN"]), Dialect::Sqlite, "Statement 1"),
            (s(&[]), Dialect::Sqlite, "empty"),
        ] {
            let e = check(&stmts, dialect).unwrap_err();
            assert!(e.contains(want), "{stmts:?}: {e}");
        }
        let many: Vec<String> = (0..21).map(|i| format!("DELETE FROM t WHERE id = {i}")).collect();
        assert!(check(&many, Dialect::Sqlite).unwrap_err().contains("at most 20"));
        let big = vec![format!("SELECT '{}'", "x".repeat(BYTES_MAX))];
        assert!(check(&big, Dialect::Sqlite).unwrap_err().contains("too long"));
        // MySQL 의 DDL 은 막히지만 PG · SQLite 의 DDL 은 한 트랜잭션 안에서 된다(세지 않는 문장으로 밝힌다).
        assert!(check(&s(&["ALTER TABLE t ADD c INT"]), Dialect::Postgres).unwrap()[0].uncounted);
    }

    #[test]
    fn max_affected_is_required_and_bounded() {
        assert!(max_affected(None).unwrap_err().contains("required"));
        assert!(max_affected(Some(&json!("10"))).is_err());
        assert!(max_affected(Some(&json!(-1))).is_err());
        assert!(max_affected(Some(&json!(MAX_AFFECTED_LIMIT + 1))).unwrap_err().contains("too large"));
        assert_eq!(max_affected(Some(&json!(0))).unwrap(), 0);
        assert_eq!(max_affected(Some(&json!(42))).unwrap(), 42);
        assert_eq!(stmt_timeout(None).unwrap(), 30);
        assert_eq!(stmt_timeout(Some(&json!(9999))).unwrap(), 300);
        assert_eq!(stmt_timeout(Some(&json!(0))).unwrap(), 1);
        assert!(stmt_timeout(Some(&json!("5"))).is_err());
    }
}
