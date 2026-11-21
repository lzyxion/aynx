//! **쿼리 가드** — 엔진에 보내기 전에 SQL 한 덩어리를 본다. **순수 함수**(입출력 없음).
//!
//! 1. **문장 하나만.** 렉서 밖(최상위)의 `;` 로 가른다. 스크립트 실행은 같은 렉서로 나누고([`split_script`] — 해석마다 경계가
//!    같아야 한다) 나뉜 문장마다 다시 이 검사를 지난다 — 엔진이 받는 것은 늘 문장 하나다.
//! 2. **읽기 전용 모드는 첫 낱말 허용 목록**([`allowed`]). 거절 목록은 새 명령 · 방언 확장을 놓치므로 쓰지 않는다. `ANALYZE` 는 통계를
//!    쓰므로 넣지 않는다. 쓰기 모드는 "문장마다 자동 커밋" 이라 **사람이 트랜잭션 · 세션 잠금을 여는 문장을 거절한다**([`write_check`]) —
//!    PG 는 엔진이 감싼 트랜잭션에 조용히 커밋되고, 나머지는 표시 없이 남아 떼어 두기 동안 잠금을 쥔다.
//!    가드가 못 보는 것(프로시저 · 함수 안의 일 · `GET_LOCK()` · `pg_advisory_lock()`)이 있어 MySQL 쓰기 끄기는 여전히
//!    `ROLLBACK; SET SESSION autocommit = 1` 로 되감는다(`mysql::set_write`). 최종 방어선은 계정 권한이다.
//!    **트랜잭션 작업 안**([`Mode::Transaction`])에서는 그 트랜잭션을 몰래 끝내거나 깨뜨리는 문장도 거절한다([`tx_check`]) — MySQL ·
//!    MariaDB 암묵 커밋 문장(공식 "Statements That Cause an Implicit Commit" 목록) · 원자성을 증명할 수 없는 `CALL` · `CREATE`/`DROP
//!    TEMPORARY`(작업 · 스크립트 · AI 작업안은 "실패하면 되돌림" 을 약속한다), PG 트랜잭션 밖 전용 문장(25001).
//! 3. **읽기 전용 MySQL · MariaDB 의 `INTO OUTFILE` / `INTO DUMPFILE` 절 거절** — 첫 낱말이 `SELECT` 인데 서버에 파일을 쓰고 `READ ONLY`
//!    트랜잭션이 막지 못한다. 문자열 · 주석 · 인용 밖의 낱말 `INTO` 바로 다음 낱말로 본다.
//! 4. **허용 첫 낱말 뒤의 쓰기는 엔진 몫이다**(`EXPLAIN ANALYZE DELETE …` · PG `WITH x AS (DELETE …)` …) — 엔진의 읽기 전용이 겹으로 막는다
//!    (시험 `sqlite_read_only_refuses_writes_behind_allowed_first_words`).
//!
//! ## 왜 문장 하나인가
//!
//! PG simple query 는 다중 문장을 한 번에 돌아 `COMMIT; INSERT …` 가 `BEGIN READ ONLY` 밖에서 실행된다. 엔진도 다중 문장을 따로 거절하고
//! (prepare), 함수로 세션 값을 바꾸는 길(`set_config`)은 가드가 못 보므로 PG 는 매 문장을 제 `BEGIN READ ONLY` 로 감싸야 한다.
//!
//! ## 엔진과 렉서가 어긋나는 자리 — 늘 "거절" 쪽으로
//!
//! - 백슬래시 이스케이프는 서버 설정에 따라 다르다 — PG · MySQL 은 **두 해석으로 다 훑어** 어느 쪽에서든 둘로 보이면 거절한다.
//!   한 해석에서 리터럴이 끝나지 않으면 그 서버는 구문 오류로 아무것도 실행하지 않으므로 다른 해석이 하나로 보면 받는다.
//! - MySQL 의 `--` 는 뒤에 공백이 있어야 주석이다. MySQL **실행 주석** `/*! … */` · `/*M! … */` 은 서버가 안을 SQL 로 돌아 받지 않는다.
//! - PG 의 블록 주석은 중첩된다. 끝나지 않은 블록 주석은 끝까지 주석으로 본다.

use super::Dialect;
use crate::i18n::tr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GuardError {
    Empty,
    Multiple,
    /// 모든 해석에서.
    Unterminated,
    ExecutableComment,
    IntoFile,
    /// 첫 낱말은 대문자, 낱말이 아니면 빈 글자.
    ReadOnly { keyword: String, dialect: Dialect },
    Transaction { dialect: Dialect },
    SessionLock,
    ImplicitCommit,
    ProcedureCall,
    /// 되돌려지지 않는다.
    TemporaryTable,
    OutsideTransaction,
    /// 서버 설정(백슬래시 이스케이프)에 따라 문장 경계가 달라진다.
    Ambiguous,
    /// MySQL 클라이언트 명령이라 서버 SQL 이 아니다.
    Delimiter,
}

impl GuardError {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Checked<'a> {
    /// 앞뒤 공백 · 주석 · 끝 세미콜론을 뗀 것, 안의 주석은 그대로.
    pub sql: &'a str,
    /// 대문자 — 앞의 여는 괄호는 건너뛴다. 낱말로 시작하지 않으면 빈 글자.
    pub keyword: String,
}

#[derive(Debug, Clone, Copy)]
struct Lex {
    backslash: bool,
    /// MySQL 의 큰따옴표 문자열.
    dq_backslash: bool,
    dollar: bool,
    /// PG `E'…'`(늘 백슬래시).
    e_strings: bool,
    nested: bool,
    hash_comment: bool,
    /// MySQL — `--` 뒤에 공백 · 제어 글자(또는 끝)가 와야 주석.
    dash_space: bool,
    brackets: bool,
    backtick: bool,
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

#[derive(Debug)]
struct Scan {
    segments: Vec<Seg>,
    unterminated: bool,
    into_file: bool,
}

/// 낱말 표지는 모두 문자열 · 주석 **밖**에서 본 것이다.
#[derive(Debug, Default)]
struct Seg {
    start: usize,
    /// 마지막 코드 글자 뒤.
    end: usize,
    keyword: String,
    second: String,
    /// 맨 낱말 또는 백틱 · 큰따옴표 인용 식별자로 나왔다.
    autocommit: bool,
    lock_word: bool,
    concurrently: bool,
    words: usize,
}

/// 트랜잭션 경계를 바꾸는 MySQL 세션 변수(`completion_type` — 체인 · 끊기).
fn session_tx_word(w: &str) -> bool {
    w.eq_ignore_ascii_case("AUTOCOMMIT") || w.eq_ignore_ascii_case("COMPLETION_TYPE")
}

fn ident_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

fn ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c >= 0x80
}

/// 두 번 겹친 `qq` 는 그 글자 하나. 끝나지 않으면 `None`.
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

/// 태그는 비거나 숫자로 시작하지 않는 식별자.
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
    let mut code: Option<(usize, usize)> = None;
    let mut seg = Seg::default();
    let mut lead = true;
    let mut unterminated = false;
    // 공백 · 주석은 낱말이 아니라 이 표시를 지우지 않는다.
    let mut after_into = false;
    let mut into_file = false;
    while i < n {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let next = b.get(i + 1).copied();
        let dash = c == b'-'
            && next == Some(b'-')
            && (!o.dash_space || b.get(i + 2).is_none_or(|x| x.is_ascii_whitespace() || x.is_ascii_control()));
        if dash || (o.hash_comment && c == b'#') {
            while i < n && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
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
            // 큰따옴표가 문자열인 서버에서는 지나친 거절 쪽이다.
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    ReadOnly,
    AutoCommit,
    Transaction,
}

impl Mode {
    pub(crate) fn of(writable: bool, in_tx: bool) -> Mode {
        match (writable, in_tx) {
            (false, _) => Mode::ReadOnly,
            (true, false) => Mode::AutoCommit,
            (true, true) => Mode::Transaction,
        }
    }
}

/// 트랜잭션 작업을 모르는 시험용 짧은 꼴 — 엔진은 [`check_mode`] 를 쓴다.
#[cfg(test)]
pub(crate) fn check(sql: &str, dialect: Dialect, writable: bool) -> Result<Checked<'_>, GuardError> {
    check_mode(sql, dialect, Mode::of(writable, false))
}

pub(crate) fn check_mode(sql: &str, dialect: Dialect, mode: Mode) -> Result<Checked<'_>, GuardError> {
    let writable = mode != Mode::ReadOnly;
    // 쓰기 모드 검사는 해석 **어느 하나라도** 걸리면 거절 쪽.
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

/// `[처음 코드 글자, 마지막 코드 글자 뒤)` 범위들. 해석마다 경계가 다르거나 한 해석에서라도 리터럴이 끝나지 않으면
/// [`GuardError::Ambiguous`] — 서버가 우리가 보낸 조각과 다른 문장을 볼 수 있어서다.
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

/// 첫 낱말 목록 — 둘째 낱말로 가르는 것(`CREATE`/`DROP` 의 `TEMPORARY` · `ANALYZE TABLE` · `START` · `SET PASSWORD`)은 [`tx_check`] 에 있다.
const MYSQL_IMPLICIT_COMMIT: &[&str] = &[
    "ALTER", "RENAME", "TRUNCATE", "GRANT", "REVOKE", "INSTALL", "UNINSTALL", "OPTIMIZE", "REPAIR", "CHECK", "CACHE", "LOAD",
    "FLUSH", "RESET", "CHANGE", "STOP",
];

/// 첫 · 둘째 낱말로 알 수 있는 것만 — 못 보는 것은 서버의 25001 이 트랜잭션을 중단시키고 앱이 되돌린다.
fn pg_outside_only(seg: &Seg) -> bool {
    let (k, s2) = (seg.keyword.as_str(), seg.second.as_str());
    match k {
        "VACUUM" => true,
        "CREATE" | "DROP" => matches!(s2, "DATABASE" | "TABLESPACE" | "SUBSCRIPTION") || seg.concurrently,
        "ALTER" => matches!(s2, "SYSTEM" | "SUBSCRIPTION"),
        "REINDEX" => seg.concurrently || matches!(s2, "DATABASE" | "SYSTEM"),
        // `CLUSTER t USING i` 는 트랜잭션 안에서 돈다.
        "CLUSTER" => seg.words == 1 || (seg.words == 2 && s2 == "VERBOSE"),
        "DISCARD" => s2 == "ALL",
        _ => false,
    }
}

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

/// MariaDB `BEGIN NOT ATOMIC … END` 도 첫 낱말로 걸린다 — 알고 받는 거절. `START` 는 둘째 낱말이 `TRANSACTION` 일 때만
/// (`START REPLICA` 는 트랜잭션이 아니다).
const TRANSACTION_WORDS: &[&str] = &["BEGIN", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"];

fn write_check(d: Dialect, seg: &Seg) -> Result<(), GuardError> {
    let k = seg.keyword.as_str();
    let tx = TRANSACTION_WORDS.contains(&k)
        || (k == "START" && seg.second == "TRANSACTION")
        || match d {
            // 일반 `PREPARE 이름 AS …` 는 받는다(트랜잭션 · 잠금이 없다).
            Dialect::Postgres => k == "PREPARE" && seg.second == "TRANSACTION",
            // `SET … autocommit` 은 낱말이 문장 어디에 있든 건다 — 대입 문법을 따라가는 것보다 빠짐없다. 지나친 거절: 큰따옴표 문자열 ·
            // 사용자 변수 `@autocommit`.
            Dialect::Mysql => k == "XA" || (k == "SET" && seg.autocommit),
            Dialect::Sqlite => false,
        };
    if tx {
        return Err(GuardError::Transaction { dialect: d });
    }
    // 자동 커밋과 무관하게 세션에 남는 잠금이다(PG `LOCK TABLE` 은 감싼 트랜잭션 끝에 풀리므로 받는다).
    if d == Dialect::Mysql && (k == "LOCK" || k == "UNLOCK" || (k == "FLUSH" && seg.lock_word)) {
        return Err(GuardError::SessionLock);
    }
    Ok(())
}

/// SQLite `PRAGMA` 는 읽기 꼴만 받는다([`sqlite_pragma_reads`]).
fn allowed(d: Dialect) -> &'static [&'static str] {
    match d {
        Dialect::Postgres => &["SELECT", "WITH", "VALUES", "TABLE", "EXPLAIN", "SHOW"],
        Dialect::Mysql => &["SELECT", "WITH", "VALUES", "TABLE", "EXPLAIN", "SHOW", "DESCRIBE", "DESC"],
        Dialect::Sqlite => &["SELECT", "WITH", "VALUES", "EXPLAIN", "PRAGMA"],
    }
}

/// 인자가 값이 아니라 조회할 대상인 PRAGMA 만 — 그 밖의 `name(값)` 은 `name = 값` 과 같은 쓰기 꼴이다.
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

/// 인자 없이도 일을 하는 PRAGMA.
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

/// 모양을 못 알아보면(`(PRAGMA …)` 포함) 거절한다.
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
