//! DB 문장 분석 — 문자열 · 주석을 건너는 넓은 렉서 · 대상 테이블 · `UPDATE` · `DELETE` 의 바깥 `WHERE` 유무 · 문장마다 한 줄.

use super::super::DbPlanStmt;
use super::types::{stronger, CmdLine, Computed, LineMark, PlanAnalysis, StmtAnalysis, Verdict};

// ---------------------------------------------------------------------------
// DB 문장
// ---------------------------------------------------------------------------

/// SQL 낱말 하나 — 식별자(점 · 인용 포함 그대로) 또는 괄호.
#[derive(Debug, PartialEq, Eq)]
enum Tok {
    Word(String),
    Open,
    Close,
}

/// 문자열 · 주석은 건너뛰고 낱말 · 괄호만 뽑는다(방언을 가리지 않는 넓은 렉서 — 분석용이지 가드가 아니다). 낱말마다 원문 자리
/// (**코드 포인트** [start, end) — 줄 안 표시가 그 자리를 칠한다. 문자열 · 주석 안은 낱말이 아니므로 칠해지지 않는다).
fn sql_tokens(sql: &str) -> Vec<(Tok, usize, usize)> {
    let b: Vec<char> = sql.chars().collect();
    let n = b.len();
    let mut out = Vec::new();
    let mut i = 0usize;
    let ident = |c: char| c.is_alphanumeric() || c == '_' || c == '.' || c == '$';
    while i < n {
        let c = b[i];
        if c.is_whitespace() {
            i += 1;
        } else if (c == '-' && b.get(i + 1) == Some(&'-')) || c == '#' {
            while i < n && b[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && b.get(i + 1) == Some(&'*') {
            i += 2;
            while i < n && !(b[i] == '*' && b.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 2;
        } else if c == '\'' {
            i += 1;
            while i < n {
                if b[i] == '\\' {
                    i += 2;
                    continue;
                }
                if b[i] == '\'' {
                    if b.get(i + 1) == Some(&'\'') {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            i += 1;
        } else if c == '$' && b.get(i + 1) == Some(&'$') {
            // PG `$$ … $$`.
            i += 2;
            while i + 1 < n && !(b[i] == '$' && b[i + 1] == '$') {
                i += 1;
            }
            i += 2;
        } else if c == '"' || c == '`' || c == '[' {
            // 인용 식별자 — 그대로(테이블 이름이 될 수 있다). 뒤에 이어지는 `.x` 도 붙인다.
            let close = if c == '[' { ']' } else { c };
            let start = i;
            i += 1;
            while i < n && b[i] != close {
                i += 1;
            }
            i = (i + 1).min(n);
            while i < n && (ident(b[i]) || b[i] == '"' || b[i] == '`') {
                i += 1;
            }
            out.push((Tok::Word(b[start..i].iter().collect()), start, i));
        } else if c == '(' {
            out.push((Tok::Open, i, i + 1));
            i += 1;
        } else if c == ')' {
            out.push((Tok::Close, i, i + 1));
            i += 1;
        } else if ident(c) {
            let start = i;
            while i < n {
                if ident(b[i]) {
                    i += 1;
                } else if (b[i] == '"' || b[i] == '`') && b[i - 1] == '.' {
                    // `schema."t"` — 점 뒤의 인용 식별자까지 한 낱말.
                    let q = b[i];
                    i += 1;
                    while i < n && b[i] != q {
                        i += 1;
                    }
                    i = (i + 1).min(n);
                } else {
                    break;
                }
            }
            out.push((Tok::Word(b[start..i].iter().collect()), start, i));
        } else {
            i += 1;
        }
    }
    out
}

/// 테이블 이름 앞에 올 수 있는 수식어 — 건너뛴다.
const SQL_SKIP: &[&str] = &[
    "ONLY", "IGNORE", "LOW_PRIORITY", "QUICK", "DELAYED", "HIGH_PRIORITY", "FROM", "INTO", "TABLE", "IF", "EXISTS", "NOT", "OR",
    "REPLACE", "ROLLBACK", "ABORT", "FAIL", "TEMP", "TEMPORARY", "UNIQUE", "UNLOGGED", "MATERIALIZED", "VIEW", "INDEX", "SEQUENCE",
    "SCHEMA", "DATABASE", "TRIGGER", "FUNCTION", "PROCEDURE", "TYPE", "CONCURRENTLY", "GLOBAL", "LOCAL", "CASCADE", "RESTRICT",
];

/// 문장 하나의 분석 — 효과(첫 낱말 표 · `WITH` 면 안의 동사) · 대상 테이블 · `UPDATE`/`DELETE` 의 바깥 `WHERE` 유무 — 와 줄 안 표시의
/// 자리들: 동사 낱말(`WITH … DELETE` 면 안의 `DELETE`)과 대상 테이블 낱말. 자리는 **앞뒤 공백을 걷은**
/// 문장(`s.sql.trim()` — [`CmdLine::text`])의 코드 포인트 [start, end). 문자열 · 주석 안은 낱말이 아니라 칠하지 않는다.
fn stmt_scan(s: &DbPlanStmt) -> (StmtAnalysis, Vec<(usize, usize)>) {
    let toks = sql_tokens(s.sql.trim());
    let upper = |t: &Tok| match t {
        Tok::Word(w) => w.to_ascii_uppercase(),
        _ => String::new(),
    };
    let kw = s.keyword.to_ascii_uppercase();
    // `WITH` — 안(괄호 안의 CTE 포함)에 데이터를 바꾸는 동사가 있으면 그것을 동사로 본다(가장 센 것).
    let verb = if kw == "WITH" {
        let words: Vec<String> = toks.iter().map(|(t, _, _)| upper(t)).collect();
        ["DELETE", "TRUNCATE", "DROP", "UPDATE", "INSERT", "MERGE"]
            .iter()
            .find(|v| words.iter().any(|w| w == *v))
            .map(|v| v.to_string())
            .unwrap_or_else(|| "SELECT".into())
    } else {
        kw.clone()
    };
    let effect = match verb.as_str() {
        "DELETE" | "DROP" | "TRUNCATE" => Computed::Delete,
        "INSERT" | "UPDATE" | "ALTER" | "CREATE" | "MERGE" | "REPLACE" | "UPSERT" | "GRANT" | "REVOKE" | "RENAME" | "COMMENT" => Computed::Write,
        "SELECT" | "VALUES" | "TABLE" | "SHOW" | "EXPLAIN" | "DESCRIBE" | "DESC" => Computed::Read,
        _ => Computed::Unknown,
    };
    // 동사 자리부터 수식어를 건너 첫 낱말이 테이블(괄호가 먼저 오면 테이블이 없다).
    let at = toks.iter().position(|(t, _, _)| upper(t) == verb);
    let table_at = at.and_then(|p| {
        toks[p + 1..]
            .iter()
            .enumerate()
            .find_map(|(k, (t, _, _))| match t {
                Tok::Word(w) if !SQL_SKIP.contains(&w.to_ascii_uppercase().as_str()) => Some(Some(p + 1 + k)),
                Tok::Word(_) => None,
                _ => Some(None),
            })
            .flatten()
    });
    let table = table_at.and_then(|k| match &toks[k].0 {
        Tok::Word(w) => Some(w.chars().take(64).collect::<String>()),
        _ => None,
    });
    let where_clause = if verb == "UPDATE" || verb == "DELETE" {
        // 동사 자리와 같은 괄호 깊이의 `WHERE` 만 센다(하위 질의 안의 것은 아니다).
        let start = at.unwrap_or(0);
        let mut depth: i32 = 0;
        let mut base_depth: Option<i32> = None;
        let mut found = false;
        for (k, (t, _, _)) in toks.iter().enumerate() {
            match t {
                Tok::Open => depth += 1,
                Tok::Close => depth -= 1,
                Tok::Word(w) => {
                    if k == start {
                        base_depth = Some(depth);
                    }
                    if k > start && Some(depth) == base_depth && w.eq_ignore_ascii_case("WHERE") {
                        found = true;
                        break;
                    }
                }
            }
        }
        Some(found)
    } else {
        None
    };
    // 동사 · 테이블 — 읽기 문장(`SELECT`)은 칠하지 않는다(셸의 읽기 구획과 같은 규칙).
    let marks: Vec<(usize, usize)> = if effect == Computed::Read {
        Vec::new()
    } else {
        [at, table_at].into_iter().flatten().map(|k| (toks[k].1, toks[k].2)).collect()
    };
    (StmtAnalysis { keyword: verb, table, where_clause, effect }, marks)
}

/// **DB 작업안의 분석** — 문장마다 매기고 가장 센 것을 남긴다. 근거는 `DELETE users` 꼴. 문장마다 한 줄([`PlanAnalysis::lines`] —
/// 카드가 셸 명령과 같은 나눠 보기로 그린다: 원문 = 문장(앞뒤 공백만 걷음) · 구분자 `;` — 작업안 원문 [`super::store::db_plan_text`] 와
/// 공백을 빼면 같다). 바깥 `WHERE` 없는 `UPDATE` · `DELETE` 와 `DROP` · `TRUNCATE` 줄은 `danger`(근거에 "· WHERE 없음"). 순수.
pub(crate) fn analyze_db(statements: &[DbPlanStmt]) -> PlanAnalysis {
    let mut stmts: Vec<StmtAnalysis> = Vec::with_capacity(statements.len());
    let mut lines: Vec<CmdLine> = Vec::with_capacity(statements.len());
    let mut verdict = Verdict::read();
    for st in statements {
        let (s, pos) = stmt_scan(st);
        let cause = match &s.table {
            Some(t) => format!("{} {t}", s.keyword),
            None => s.keyword.clone(),
        };
        let nowhere = s.where_clause == Some(false);
        let danger = nowhere || matches!(s.keyword.as_str(), "DROP" | "TRUNCATE");
        let line_cause = if s.effect == Computed::Read {
            None
        } else if nowhere {
            Some(format!("{cause} · WHERE 없음"))
        } else {
            Some(cause.clone())
        };
        lines.push(CmdLine {
            text: st.sql.trim().to_string(),
            sep: Some(";".into()),
            effect: s.effect,
            cause: line_cause,
            quiet: false,
            over: false,
            marks: pos.into_iter().map(|(start, end)| LineMark { start, end, effect: s.effect, kind: None }).collect(),
            danger,
        });
        let v = if s.effect == Computed::Read { Verdict::read() } else { Verdict::of(s.effect, cause) };
        verdict = stronger(verdict, v);
        stmts.push(s);
    }
    if stmts.is_empty() {
        verdict = Verdict::of(Computed::Unknown, "?");
    }
    PlanAnalysis {
        effect: verdict.effect,
        cause: verdict.cause,
        programs: Vec::new(),
        tokens: Vec::new(),
        sudo: false,
        statements: stmts,
        lines,
    }
}
