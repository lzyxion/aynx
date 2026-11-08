//! **테이블 구조**(`db_table_detail` — 스키마 트리에서 테이블 · 뷰를 펼칠 때 한 번 읽는다)의 엔진 공통 꼴과 순수 도우미.
//!
//! 답 = `{columns, indexes, constraints, foreignKeys, referencedBy, triggers, partitions, truncated}` — 트리는 각 칸을 테이블 아래의
//! 폴더 하나로 그리고 빈 폴더는 숨긴다(엔진에 없는 종류는 늘 빈 칸이다 — 파티션은 PG 분할 테이블만).
//!
//! - 질의는 모두 **앱 고정 문장 + 바인드 인자 + 읽기 전용**이다(엔진별 규칙은 `pg` · `mysql` · `sqlite` 의 `table_detail`).
//! - 칸마다 [`OBJECTS_MAX`](super::OBJECTS_MAX) 줄 상한 — 넘으면 앞 줄만 싣고 그 칸 이름을 `truncated` 에 적는다.
//! - SQLite 는 체크 제약 · 트리거의 때를 카탈로그로 주지 않는다 — 저장된 `CREATE` 글자를 작은 렉서([`sqlite_checks`] ·
//!   [`sqlite_trigger_detail`])로 읽는다(표시용 — 실행하지 않는다).

use serde::Serialize;
use serde_json::Value;

use super::OBJECTS_MAX;

/// 인덱스 하나. `columns` 의 `null` 은 식(SQLite 는 식 글자를 주지 않는다 — PG · MySQL 은 식 글자 그대로).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct IndexOut {
    pub name: String,
    pub columns: Vec<Option<String>>,
    pub unique: bool,
    pub primary: bool,
    /// 방식(`btree` · `BTREE` · `HASH` …) — 엔진이 쓴 글자.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// 부분 인덱스의 조건(PG).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<String>,
    /// 정의 글자(PG `pg_get_indexdef` · SQLite 의 `CREATE INDEX`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

/// 제약 조건 하나 — 기본 키 · 유니크 · 체크 · 제외(PG). 외래 키는 따로([`ForeignKeyOut`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ConstraintOut {
    /// SQLite 의 기본 키 · 유니크 · 이름 없는 체크는 이름이 없다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `primary` · `unique` · `check` · `exclude`.
    #[serde(rename = "type")]
    pub ty: &'static str,
    pub columns: Vec<String>,
    /// 정의 글자(PG `pg_get_constraintdef` · 체크의 `CHECK (…)`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

/// 외래 키 하나 — `schema.table(columns)` 이 `refSchema.refTable(refColumns)` 를 가리킨다. 외래 키 칸은 이 테이블이 가리키는
/// 쪽(`schema.table` = 이 테이블), 참조됨 칸은 다른 테이블이 이 테이블을 가리키는 쪽(`refSchema.refTable` = 이 테이블).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForeignKeyOut {
    /// SQLite 는 외래 키 이름을 주지 않는다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub ref_schema: String,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
    /// `NO ACTION` · `RESTRICT` · `CASCADE` · `SET NULL` · `SET DEFAULT`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_update: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_delete: Option<String>,
}

/// 트리거 하나 — `detail` = 때 · 사건(`BEFORE INSERT OR UPDATE` — SQL 낱말 그대로, 모르면 빈 글자).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct TriggerOut {
    pub name: String,
    pub detail: String,
    /// 정의 글자(PG `pg_get_triggerdef` · MySQL 몸 · SQLite `CREATE TRIGGER`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

/// 파티션 하나(PG 분할 테이블의 자식) — `bound` = 범위 식(`FOR VALUES FROM (…) TO (…)` · `DEFAULT`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PartitionOut {
    pub schema: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound: Option<String>,
    /// 자식도 분할 테이블이면 `partitioned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub: Option<&'static str>,
}

/// `db_table_detail` 의 답. `columns` 는 `db_objects` 이전의 컬럼 꼴 그대로(`{name, type, notNull, default, pk}`).
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TableDetail {
    pub columns: Vec<Value>,
    pub indexes: Vec<IndexOut>,
    pub constraints: Vec<ConstraintOut>,
    pub foreign_keys: Vec<ForeignKeyOut>,
    pub referenced_by: Vec<ForeignKeyOut>,
    pub triggers: Vec<TriggerOut>,
    pub partitions: Vec<PartitionOut>,
    /// 상한에서 잘린 칸 이름(`indexes` …).
    pub truncated: Vec<&'static str>,
}

impl TableDetail {
    /// 칸마다 상한을 건다 — **순수**. 넘은 칸 이름을 `truncated` 에 더한다.
    pub(crate) fn capped(mut self) -> TableDetail {
        let mut t = Vec::new();
        cap(&mut self.columns, "columns", &mut t);
        cap(&mut self.indexes, "indexes", &mut t);
        cap(&mut self.constraints, "constraints", &mut t);
        cap(&mut self.foreign_keys, "foreignKeys", &mut t);
        cap(&mut self.referenced_by, "referencedBy", &mut t);
        cap(&mut self.triggers, "triggers", &mut t);
        cap(&mut self.partitions, "partitions", &mut t);
        self.truncated = t;
        self
    }

    pub(crate) fn json(self) -> Value {
        serde_json::to_value(self.capped()).unwrap_or(Value::Null)
    }
}

fn cap<T>(v: &mut Vec<T>, part: &'static str, truncated: &mut Vec<&'static str>) {
    if v.len() > OBJECTS_MAX {
        v.truncate(OBJECTS_MAX);
        truncated.push(part);
    }
}

/// 정렬된 줄을 열쇠가 같은 이웃끼리 묶는다 — **순수**(MySQL `information_schema` 의 "열 하나 = 줄 하나" → 객체 하나). 열쇠가
/// 바뀔 때마다 새 묶음(같은 열쇠가 떨어져 다시 오면 다른 묶음이다 — 질의가 열쇠 순으로 정렬한다).
pub(crate) fn group_runs<R, K: PartialEq>(rows: Vec<R>, key: impl Fn(&R) -> K) -> Vec<Vec<R>> {
    let mut out: Vec<Vec<R>> = Vec::new();
    let mut last: Option<K> = None;
    for r in rows {
        let k = key(&r);
        match out.last_mut() {
            Some(g) if last.as_ref() == Some(&k) => g.push(r),
            _ => out.push(vec![r]),
        }
        last = Some(k);
    }
    out
}

// ── PostgreSQL ────────────────────────────────────────────────────────────

/// `pg_constraint.confupdtype`·`confdeltype` → 낱말 — **순수**.
pub(crate) fn pg_fk_action(code: &str) -> Option<String> {
    let w = match code {
        "a" => "NO ACTION",
        "r" => "RESTRICT",
        "c" => "CASCADE",
        "n" => "SET NULL",
        "d" => "SET DEFAULT",
        _ => return None,
    };
    Some(w.to_string())
}

/// `pg_constraint.contype` → 제약 종류 — **순수**(외래 키 `f` 는 따로 읽는다).
pub(crate) fn pg_constraint_type(code: &str) -> &'static str {
    match code {
        "p" => "primary",
        "u" => "unique",
        "x" => "exclude",
        _ => "check",
    }
}

/// `pg_trigger.tgtype` 비트 → `BEFORE INSERT OR UPDATE` — **순수**(PG 소스 `pg_trigger.h` 의 `TRIGGER_TYPE_*`).
pub(crate) fn pg_trigger_detail(tgtype: i32) -> String {
    const BEFORE: i32 = 1 << 1;
    const INSERT: i32 = 1 << 2;
    const DELETE: i32 = 1 << 3;
    const UPDATE: i32 = 1 << 4;
    const TRUNCATE: i32 = 1 << 5;
    const INSTEAD: i32 = 1 << 6;
    let timing = if tgtype & INSTEAD != 0 {
        "INSTEAD OF"
    } else if tgtype & BEFORE != 0 {
        "BEFORE"
    } else {
        "AFTER"
    };
    let events: Vec<&str> = [(INSERT, "INSERT"), (UPDATE, "UPDATE"), (DELETE, "DELETE"), (TRUNCATE, "TRUNCATE")]
        .into_iter()
        .filter(|(b, _)| tgtype & b != 0)
        .map(|(_, w)| w)
        .collect();
    format!("{timing} {}", events.join(" OR "))
}

/// 관계 하나 찾기 — 스키마 · 이름은 **바인드 인자**(`$1` · `$2`). 답 = oid · relkind.
pub(crate) const PG_REL: &str = "SELECT c.oid, c.relkind::text FROM pg_catalog.pg_class c \
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2";

/// 컬럼(`$1` = oid · `$2` = 상한) — `pk` = 기본 키 안의 순번(0 = 아님).
pub(crate) const PG_COLUMNS: &str = "SELECT a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, \
     pg_catalog.pg_get_expr(d.adbin, d.adrelid), \
     COALESCE((SELECT k.n FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(att, n) WHERE k.att = a.attnum), 0)::int4 \
     FROM pg_catalog.pg_attribute a \
     LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
     LEFT JOIN pg_catalog.pg_index i ON i.indrelid = a.attrelid AND i.indisprimary \
     WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT $2";

/// 인덱스(`$1` = oid · `$2` = 상한) — 열 글자는 `pg_get_indexdef(…, k, true)`(식 인덱스는 식 글자). 11+ 는 키 열만
/// (`indnkeyatts` — `INCLUDE` 열은 정의 글자에 보인다).
pub(crate) fn pg_index_sql(server_version_num: i32) -> String {
    let natts = if server_version_num >= 110_000 { "indnkeyatts" } else { "indnatts" };
    format!(
        "SELECT ic.relname::text, i.indisunique, i.indisprimary, am.amname::text, \
         ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(1, i.{natts}::int4) AS k ORDER BY k), \
         pg_catalog.pg_get_expr(i.indpred, i.indrelid, true), pg_catalog.pg_get_indexdef(i.indexrelid, 0, true) \
         FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid \
         JOIN pg_catalog.pg_am am ON am.oid = ic.relam \
         WHERE i.indrelid = $1 ORDER BY NOT i.indisprimary, ic.relname LIMIT $2"
    )
}

/// 제약(기본 키 · 유니크 · 체크 · 제외 — `$1` = oid · `$2` = 상한).
pub(crate) const PG_CONSTRAINTS: &str = "SELECT con.conname::text, con.contype::text, \
     ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(att, n) \
     JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.att ORDER BY k.n), \
     pg_catalog.pg_get_constraintdef(con.oid, true) \
     FROM pg_catalog.pg_constraint con WHERE con.conrelid = $1 AND con.contype IN ('p', 'u', 'c', 'x') \
     ORDER BY strpos('pucx', con.contype::text), con.conname LIMIT $2";

/// 외래 키(`$1` = oid · `$2` = 상한) — `incoming` 이면 이 테이블을 **가리키는** 쪽(참조됨). 11+ 는 분할 테이블이 파티션마다 복제한
/// 제약(`conparentid <> 0`)을 뺀다(부모의 제약 하나로 보인다).
pub(crate) fn pg_fk_sql(server_version_num: i32, incoming: bool) -> String {
    let side = if incoming { "confrelid" } else { "conrelid" };
    let parent = if server_version_num >= 110_000 { " AND con.conparentid = 0" } else { "" };
    format!(
        "SELECT con.conname::text, sn.nspname::text, sc.relname::text, \
         ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(att, n) \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.att ORDER BY k.n), \
         tn.nspname::text, tc.relname::text, \
         ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(att, n) \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.att ORDER BY k.n), \
         con.confupdtype::text, con.confdeltype::text \
         FROM pg_catalog.pg_constraint con \
         JOIN pg_catalog.pg_class sc ON sc.oid = con.conrelid JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace \
         JOIN pg_catalog.pg_class tc ON tc.oid = con.confrelid JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace \
         WHERE con.contype = 'f' AND con.{side} = $1{parent} ORDER BY sn.nspname, sc.relname, con.conname LIMIT $2"
    )
}

/// 트리거(`$1` = oid · `$2` = 상한) — 내부 트리거(외래 키가 만든 것)는 뺀다.
pub(crate) const PG_TRIGGERS: &str = "SELECT t.tgname::text, t.tgtype::int4, pg_catalog.pg_get_triggerdef(t.oid, true) \
     FROM pg_catalog.pg_trigger t WHERE t.tgrelid = $1 AND NOT t.tgisinternal ORDER BY t.tgname LIMIT $2";

/// 파티션(`$1` = 분할 테이블 oid · `$2` = 상한) — 바로 아래 자식만(하위 분할은 `sub`).
pub(crate) const PG_PARTITIONS: &str = "SELECT n.nspname::text, c.relname::text, pg_catalog.pg_get_expr(c.relpartbound, c.oid, true), \
     c.relkind::text FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid \
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE i.inhparent = $1 ORDER BY c.relname LIMIT $2";

// ── SQLite — 저장된 CREATE 글자 읽기(표시용) ─────────────────────────────

/// 렉서의 낱개 — 낱말 · 인용 식별자(풀어 둔 글자) · 글자 리터럴 · 기호 한 바이트.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Tok {
    Word(String),
    Ident(String),
    Str,
    Punct(u8),
}

/// `(낱개, 시작, 끝)` — 공백 · 주석은 건너뛴다. 끝나지 않은 인용은 끝까지 하나로 본다.
fn sqlite_tokens(sql: &str) -> Vec<(Tok, usize, usize)> {
    let b = sql.as_bytes();
    let n = b.len();
    let mut out = Vec::new();
    let mut i = 0;
    let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80;
    while i < n {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
        } else if c == b'-' && b.get(i + 1) == Some(&b'-') {
            while i < n && b[i] != b'\n' {
                i += 1;
            }
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            i = sql[i + 2..].find("*/").map_or(n, |p| i + 2 + p + 2);
        } else if matches!(c, b'\'' | b'"' | b'`' | b'[') {
            let close = if c == b'[' { b']' } else { c };
            let mut j = i + 1;
            let mut text = Vec::new();
            while j < n {
                if b[j] == close {
                    if close != b']' && b.get(j + 1) == Some(&close) {
                        text.push(close);
                        j += 2;
                        continue;
                    }
                    break;
                }
                text.push(b[j]);
                j += 1;
            }
            let end = (j + 1).min(n);
            let tok = if c == b'\'' { Tok::Str } else { Tok::Ident(String::from_utf8_lossy(&text).into_owned()) };
            out.push((tok, i, end));
            i = end;
        } else if word(c) {
            let s = i;
            while i < n && word(b[i]) {
                i += 1;
            }
            out.push((Tok::Word(sql[s..i].to_string()), s, i));
        } else {
            out.push((Tok::Punct(c), i, i + 1));
            i += 1;
        }
    }
    out
}

fn is_word(t: &Tok, w: &str) -> bool {
    matches!(t, Tok::Word(x) if x.eq_ignore_ascii_case(w))
}

fn name_of(t: &Tok) -> Option<String> {
    match t {
        Tok::Word(w) | Tok::Ident(w) => Some(w.clone()),
        _ => None,
    }
}

/// `CREATE TRIGGER` 글자 → 때 · 사건(`BEFORE INSERT` · `INSTEAD OF UPDATE` — 때를 안 적었으면 SQLite 기본 `BEFORE`) — **순수**.
/// 읽지 못하면 빈 글자.
pub(crate) fn sqlite_trigger_detail(sql: &str) -> String {
    let t = sqlite_tokens(sql);
    let Some(mut i) = t.iter().position(|(x, _, _)| is_word(x, "TRIGGER")).map(|p| p + 1) else {
        return String::new();
    };
    if t.get(i).is_some_and(|x| is_word(&x.0, "IF")) {
        i += 3; // IF NOT EXISTS
    }
    i += 1; // 이름
    if t.get(i).is_some_and(|x| x.0 == Tok::Punct(b'.')) {
        i += 2; // 스키마.이름
    }
    let mut timing = "BEFORE";
    match t.get(i).map(|x| &x.0) {
        Some(x) if is_word(x, "BEFORE") => i += 1,
        Some(x) if is_word(x, "AFTER") => {
            timing = "AFTER";
            i += 1;
        }
        Some(x) if is_word(x, "INSTEAD") => {
            timing = "INSTEAD OF";
            i += 2;
        }
        _ => {}
    }
    match t.get(i).map(|x| &x.0) {
        Some(Tok::Word(w)) if ["INSERT", "UPDATE", "DELETE"].iter().any(|e| w.eq_ignore_ascii_case(e)) => {
            format!("{timing} {}", w.to_ascii_uppercase())
        }
        _ => String::new(),
    }
}

/// SQLite 체크 제약 하나 — 이름(`CONSTRAINT x CHECK …` 일 때) · 컬럼(컬럼 정의 안의 체크일 때) · 식 글자.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SqliteCheck {
    pub name: Option<String>,
    pub column: Option<String>,
    pub expr: String,
}

/// `CREATE TABLE` 글자 → 체크 제약 — **순수**. 정의 목록(맨 바깥 괄호) 안의 `CHECK (…)` 를 찾는다(테이블 제약 · 컬럼 제약 모두).
/// `CREATE TABLE … AS SELECT` 는 없음.
pub(crate) fn sqlite_checks(sql: &str) -> Vec<SqliteCheck> {
    let t = sqlite_tokens(sql);
    let Some(open) = t.iter().position(|(x, _, _)| *x == Tok::Punct(b'(')) else {
        return Vec::new();
    };
    if t[..open].iter().any(|(x, _, _)| is_word(x, "AS")) {
        return Vec::new();
    }
    // 정의 하나(쉼표로 갈린 낱개 범위)씩.
    let mut items: Vec<(usize, usize)> = Vec::new();
    let mut depth = 0usize;
    let mut start = open + 1;
    let mut end_all = t.len();
    for (k, (x, _, _)) in t.iter().enumerate().skip(open) {
        match x {
            Tok::Punct(b'(') => depth += 1,
            Tok::Punct(b')') => {
                depth -= 1;
                if depth == 0 {
                    end_all = k;
                    break;
                }
            }
            Tok::Punct(b',') if depth == 1 => {
                items.push((start, k));
                start = k + 1;
            }
            _ => {}
        }
    }
    items.push((start, end_all));
    const LEADS: [&str; 5] = ["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"];
    let mut out = Vec::new();
    for (s, e) in items {
        let item = &t[s..e.min(t.len())];
        let Some(first) = item.first() else { continue };
        let column = (!LEADS.iter().any(|w| is_word(&first.0, w))).then(|| name_of(&first.0)).flatten();
        let mut d = 0usize;
        for (k, (x, _, _)) in item.iter().enumerate() {
            match x {
                Tok::Punct(b'(') => d += 1,
                Tok::Punct(b')') => d = d.saturating_sub(1),
                _ if d == 0 && is_word(x, "CHECK") && item.get(k + 1).is_some_and(|y| y.0 == Tok::Punct(b'(')) => {
                    let body_start = item[k + 1].2;
                    let mut dd = 0usize;
                    let mut body_end = None;
                    for (y, ys, _) in &item[k + 1..] {
                        match y {
                            Tok::Punct(b'(') => dd += 1,
                            Tok::Punct(b')') => {
                                dd -= 1;
                                if dd == 0 {
                                    body_end = Some(*ys);
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    let Some(body_end) = body_end else { continue };
                    let name = (k >= 2 && is_word(&item[k - 2].0, "CONSTRAINT")).then(|| name_of(&item[k - 1].0)).flatten();
                    out.push(SqliteCheck {
                        name,
                        column: column.clone(),
                        expr: sql[body_start..body_end].trim().to_string(),
                    });
                }
                _ => {}
            }
        }
    }
    out
}
