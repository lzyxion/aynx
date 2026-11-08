//! **정의(DDL) 읽기 전용 보기**(`db_definition` — 스키마 트리의 잎에서 "DDL 보기")의 엔진 공통 꼴과 순수 도우미.
//!
//! 답 = `{sql, reconstructed, truncated}` — `sql` 은 화면이 읽기 전용 편집기에 그대로 보이는 글자다(**실행하지 않는다** — 화면에도
//! 실행 단추가 없다). `reconstructed` = 엔진이 원문을 주지 않아 **카탈로그로 다시 짠** 글자(pg_dump 와 다를 수 있다).
//! `truncated` = [`DEFINITION_MAX`] 에서 잘랐다.
//!
//! | 엔진 | 원문 그대로 | 재구성 | 없음 |
//! | --- | --- | --- | --- |
//! | PostgreSQL | 뷰 · 구체화 뷰(`pg_get_viewdef` + 머리) · 함수 · 프로시저(`pg_get_functiondef`) · 트리거(`pg_get_triggerdef`) · 인덱스(`pg_get_indexdef`) · 제약 조건(`ALTER TABLE … ADD CONSTRAINT` + `pg_get_constraintdef`) | 테이블 · 외부 테이블(컬럼 · 기본값 · NOT NULL · 생성 열 · 제약 · 분할 키 · 파티션 범위 + 인덱스) · 시퀀스 · 형(열거형 · 도메인 · 범위 · 복합) · 집계 함수 | — |
//! | MySQL · MariaDB | 테이블 · 뷰 · 함수 · 프로시저 · 트리거 · 시퀀스(MariaDB) — `SHOW CREATE …` | — | 인덱스 · 제약 조건(테이블 정의 안에 있다) |
//! | SQLite | 테이블 · 뷰 · 인덱스 · 트리거 — `sqlite_schema.sql` | — | 제약 조건(이름이 없다 — 테이블 정의 안에 있다) |
//!
//! - 질의는 모두 **앱 고정 문장 + 바인드 인자 + 읽기 전용**이다. 식별자 자리(MySQL `SHOW CREATE` 의 이름 · SQLite 의 DB 이름)는
//!   바인드가 안 되므로 **먼저 카탈로그에 바인드 질의로 있는지 확인하고, 카탈로그가 돌려준 이름을 인용**해 넣는다([`mysql_ident`]).
//! - 겹지정 함수(PG)는 `args`(트리가 받은 `pg_get_function_identity_arguments` 글자)로 가른다.

use serde::{Deserialize, Serialize};

use super::EngineError;
use crate::i18n::tr;

/// 정의 글자의 상한 — 넘으면 앞부분만 싣고 `truncated`.
pub(crate) const DEFINITION_MAX: usize = 1024 * 1024;

/// 정의를 볼 객체 — `db_definition` 의 몸(핸들 · 임대 밖).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct DefTarget {
    #[serde(default)]
    pub schema: Option<String>,
    pub kind: String,
    pub name: String,
    /// 인덱스 · 트리거 · 제약 조건이 걸린 테이블(PG 트리거 · 제약은 테이블마다 이름이 갈린다).
    #[serde(default)]
    pub table: Option<String>,
    /// PG 함수 · 프로시저의 인자 글자(겹지정 가르기 — 트리의 `args`).
    #[serde(default)]
    pub args: Option<String>,
}

/// 정의를 볼 수 있는 종류.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DefKind {
    Table,
    View,
    Matview,
    Foreign,
    Function,
    Procedure,
    Trigger,
    Index,
    Sequence,
    Type,
    Constraint,
}

impl DefKind {
    /// 몸의 `kind` 글자 → 종류 — **순수**. 모르는 글자는 `None`.
    pub(crate) fn parse(s: &str) -> Option<DefKind> {
        Some(match s {
            "table" => DefKind::Table,
            "view" => DefKind::View,
            "matview" => DefKind::Matview,
            "foreign" => DefKind::Foreign,
            "function" => DefKind::Function,
            "procedure" => DefKind::Procedure,
            "trigger" => DefKind::Trigger,
            "index" => DefKind::Index,
            "sequence" => DefKind::Sequence,
            "type" => DefKind::Type,
            "constraint" => DefKind::Constraint,
            _ => return None,
        })
    }

    /// 테이블이 있어야 찾는 종류(PG 트리거 · 제약 조건).
    pub(crate) fn needs_table(self) -> bool {
        matches!(self, DefKind::Trigger | DefKind::Constraint)
    }
}

/// `db_definition` 의 답.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DefinitionOut {
    pub sql: String,
    pub reconstructed: bool,
    pub truncated: bool,
}

impl DefinitionOut {
    /// 상한을 건다 — **순수**. 글자 경계에서 자른다.
    pub(crate) fn new(sql: String, reconstructed: bool) -> DefinitionOut {
        let (sql, truncated) = cap_text(sql, DEFINITION_MAX);
        DefinitionOut { sql, reconstructed, truncated }
    }

    pub(crate) fn json(self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// 글자를 `max` 바이트 안에서(UTF-8 경계) 자른다 — **순수**.
pub(crate) fn cap_text(mut s: String, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s, false);
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
    (s, true)
}

/// 몸을 확인한다 — 종류를 알고, 이름이 비지 않고, 테이블이 필요한 종류엔 테이블이 있다. **순수**.
pub(crate) fn check(t: &DefTarget) -> Result<DefKind, EngineError> {
    let kind = DefKind::parse(&t.kind).ok_or_else(|| unsupported(&t.kind))?;
    if t.name.is_empty() || (kind.needs_table() && t.table.as_deref().unwrap_or("").is_empty()) {
        return Err(not_found(t));
    }
    Ok(kind)
}

/// "찾지 못했다" — 이름은 사람이 고른 그 글자(트리에서 왔다).
pub(crate) fn not_found(t: &DefTarget) -> EngineError {
    EngineError::Message(tr!(
        ko: "{name} 의 DDL 을 찾지 못했습니다 — 사라졌거나 볼 권한이 없습니다",
        en: "Could not find the DDL of {name} — it is gone or you lack the privilege to see it",
        name = t.name
    ))
}

/// 이 엔진에는 이 종류의 정의가 없다.
pub(crate) fn unsupported(kind: &str) -> EngineError {
    EngineError::Message(tr!(
        ko: "이 DB 에서는 '{kind}' 의 DDL 을 따로 볼 수 없습니다 — 테이블의 DDL 에 들어 있습니다",
        en: "This database has no separate DDL for '{kind}' — it is part of the table's DDL",
        kind = kind
    ))
}

/// 엔진이 정의를 숨겼다(권한 부족 — MySQL 의 `SHOW CREATE FUNCTION` 이 본문을 NULL 로 주는 경우 등).
pub(crate) fn hidden(name: &str) -> EngineError {
    EngineError::Message(tr!(
        ko: "{name} 의 DDL 을 볼 권한이 없습니다 — 서버가 본문을 숨겼습니다(만든 사람이거나 SHOW VIEW · SHOW_ROUTINE 같은 권한이 있어야 보입니다)",
        en: "You lack the privilege to see the DDL of {name} — the server hid the body (the definer or a privilege such as SHOW VIEW or SHOW_ROUTINE can see it)",
        name = name
    ))
}

// ── MySQL · MariaDB ──────────────────────────────────────────────────────

/// MySQL 식별자를 백틱으로(안의 백틱은 둘로) — **순수**. 카탈로그가 돌려준 이름에만 쓴다(머리말).
pub(crate) fn mysql_ident(s: &str) -> String {
    format!("`{}`", s.replace('`', "``"))
}

/// 종류 → (존재 확인 문장, `SHOW CREATE` 낱말) — **순수**. 확인 문장의 답은 (스키마, 이름) 한 줄이고 인자는 `(schema?, name)`
/// (스키마가 없으면 연결의 기본 데이터베이스). 따로 볼 정의가 없는 종류는 `None`.
pub(crate) fn mysql_lookup(kind: DefKind) -> Option<(&'static str, &'static str)> {
    Some(match kind {
        DefKind::Table => (
            "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND TABLE_TYPE IN ('BASE TABLE', 'SYSTEM VERSIONED')",
            "TABLE",
        ),
        DefKind::View => (
            "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND TABLE_TYPE = 'VIEW'",
            "VIEW",
        ),
        DefKind::Sequence => (
            "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND TABLE_TYPE = 'SEQUENCE'",
            "SEQUENCE",
        ),
        DefKind::Function => (
            "SELECT ROUTINE_SCHEMA, ROUTINE_NAME FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = COALESCE(?, DATABASE()) AND ROUTINE_NAME = ? AND ROUTINE_TYPE = 'FUNCTION'",
            "FUNCTION",
        ),
        DefKind::Procedure => (
            "SELECT ROUTINE_SCHEMA, ROUTINE_NAME FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = COALESCE(?, DATABASE()) AND ROUTINE_NAME = ? AND ROUTINE_TYPE = 'PROCEDURE'",
            "PROCEDURE",
        ),
        DefKind::Trigger => (
            "SELECT TRIGGER_SCHEMA, TRIGGER_NAME FROM information_schema.TRIGGERS \
             WHERE TRIGGER_SCHEMA = COALESCE(?, DATABASE()) AND TRIGGER_NAME = ?",
            "TRIGGER",
        ),
        _ => return None,
    })
}

/// `SHOW CREATE <낱말> \`스키마\`.\`이름\`` — **순수**. 이름은 카탈로그가 돌려준 글자여야 한다.
pub(crate) fn mysql_show_sql(word: &str, schema: &str, name: &str) -> String {
    format!("SHOW CREATE {word} {}.{}", mysql_ident(schema), mysql_ident(name))
}

/// `SHOW CREATE …` 답에서 정의 칸을 고른다 — **순수**. 칸 이름: `Create Table` · `Create View` · `Create Function` ·
/// `Create Procedure` · 트리거 `SQL Original Statement`(MariaDB 시퀀스도 `Create Table`). 없으면 `None`.
pub(crate) fn mysql_definition_column(names: &[String]) -> Option<usize> {
    names
        .iter()
        .position(|n| n.eq_ignore_ascii_case("SQL Original Statement"))
        .or_else(|| names.iter().position(|n| n.len() > 7 && n[..7].eq_ignore_ascii_case("Create ")))
}

// ── PostgreSQL ────────────────────────────────────────────────────────────

/// 테이블 머리 — `$1` 스키마 · `$2` 이름. 답: oid · relkind · 정규화 이름 · relpersistence · 파티션인가 · 부모 · 범위 식 ·
/// 분할 키 · 상속(파티션 아님) · reloptions · 외부 서버 · 외부 옵션. 10 아래는 파티션 칸이 없다.
pub(crate) fn pg_table_head_sql(server_version_num: i32) -> String {
    let (is_part, parent, bound, key) = if server_version_num >= 100_000 {
        (
            "c.relispartition",
            "CASE WHEN c.relispartition THEN (SELECT quote_ident(pn.nspname) || '.' || quote_ident(pc.relname) \
             FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent \
             JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace WHERE i.inhrelid = c.oid LIMIT 1) END",
            "CASE WHEN c.relispartition THEN pg_catalog.pg_get_expr(c.relpartbound, c.oid) END",
            "CASE WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid) END",
        )
    } else {
        ("false", "NULL::text", "NULL::text", "NULL::text")
    };
    format!(
        "SELECT c.oid, c.relkind::text, quote_ident(n.nspname) || '.' || quote_ident(c.relname), c.relpersistence::text, \
         {is_part}, {parent}, {bound}, {key}, \
         (SELECT string_agg(quote_ident(pn.nspname) || '.' || quote_ident(pc.relname), ', ' ORDER BY i.inhseqno) \
          FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent \
          JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace WHERE i.inhrelid = c.oid AND NOT {is_part}), \
         array_to_string(c.reloptions, ', '), \
         (SELECT quote_ident(s.srvname) FROM pg_catalog.pg_foreign_table ft \
          JOIN pg_catalog.pg_foreign_server s ON s.oid = ft.ftserver WHERE ft.ftrelid = c.oid), \
         (SELECT string_agg(quote_ident(split_part(o, '=', 1)) || ' ' || quote_literal(substr(o, strpos(o, '=') + 1)), ', ') \
          FROM pg_catalog.pg_foreign_table ft, unnest(ft.ftoptions) o WHERE ft.ftrelid = c.oid) \
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'f')"
    )
}

/// 테이블 컬럼 — `$1` oid. 답: 이름(인용) · 형 · 콜레이션(형의 기본과 다를 때) · 기본값/생성 식 · NOT NULL · identity · generated ·
/// 이 테이블에서 정의했나(상속 열은 빠진다).
pub(crate) fn pg_table_columns_sql(server_version_num: i32) -> String {
    let identity = if server_version_num >= 100_000 { "a.attidentity::text" } else { "''" };
    let generated = if server_version_num >= 120_000 { "a.attgenerated::text" } else { "''" };
    format!(
        "SELECT quote_ident(a.attname), pg_catalog.format_type(a.atttypid, a.atttypmod), \
         CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation THEN \
          (SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname) FROM pg_catalog.pg_collation co \
           JOIN pg_catalog.pg_namespace cn ON cn.oid = co.collnamespace WHERE co.oid = a.attcollation) END, \
         pg_catalog.pg_get_expr(d.adbin, d.adrelid), a.attnotnull, {identity}, {generated}, a.attislocal \
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid = a.atttypid \
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum"
    )
}

/// 테이블 제약(이 테이블의 것만 — 상속 · 파티션 복제는 빠진다) — `$1` oid. 답: 이름(인용) · 정의.
pub(crate) fn pg_table_constraints_sql(server_version_num: i32) -> String {
    let own = if server_version_num >= 110_000 { "AND conparentid = 0" } else { "" };
    format!(
        "SELECT quote_ident(conname), pg_catalog.pg_get_constraintdef(oid, true) FROM pg_catalog.pg_constraint \
         WHERE conrelid = $1 AND contype IN ('p', 'u', 'c', 'f', 'x') AND conislocal {own} \
         ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 WHEN 'x' THEN 3 ELSE 4 END, conname"
    )
}

/// 제약이 만든 것이 아닌 인덱스의 정의 — `$1` oid.
pub(crate) const PG_TABLE_INDEXES: &str = "SELECT pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i \
     JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = $1 \
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid = i.indexrelid AND c.conrelid = i.indrelid \
     AND c.contype IN ('p', 'u', 'x')) ORDER BY ic.relname";

/// 뷰 · 구체화 뷰 — `$1` 스키마 · `$2` 이름 · `$3` relkind(`v`/`m`). 답: oid · 정규화 이름 · 뷰 정의 · reloptions · 채워졌나.
pub(crate) const PG_VIEW: &str = "SELECT c.oid, quote_ident(n.nspname) || '.' || quote_ident(c.relname), \
     pg_catalog.pg_get_viewdef(c.oid, true), array_to_string(c.reloptions, ', '), c.relispopulated \
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind::text = $3";

/// 함수 · 프로시저 찾기 — `$1` 스키마 · `$2` 이름 · `$3` 인자 글자(없으면 첫 겹지정). 답: oid · 종류 글자(`f`·`p`·`a`·`w`).
pub(crate) fn pg_proc_find_sql(server_version_num: i32) -> &'static str {
    if server_version_num >= 110_000 {
        "SELECT p.oid, p.prokind::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = $1 AND p.proname = $2 \
         AND ($3::text IS NULL OR pg_catalog.pg_get_function_identity_arguments(p.oid) = $3::text) \
         ORDER BY pg_catalog.pg_get_function_identity_arguments(p.oid) LIMIT 1"
    } else {
        "SELECT p.oid, CASE WHEN p.proisagg THEN 'a' WHEN p.proiswindow THEN 'w' ELSE 'f' END \
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = $1 AND p.proname = $2 \
         AND ($3::text IS NULL OR pg_catalog.pg_get_function_identity_arguments(p.oid) = $3::text) \
         ORDER BY pg_catalog.pg_get_function_identity_arguments(p.oid) LIMIT 1"
    }
}

/// 함수 정의 — `$1` oid.
pub(crate) const PG_FUNCTIONDEF: &str = "SELECT pg_catalog.pg_get_functiondef($1)";

/// 집계 함수 — `$1` oid. 답: 정규화 이름 · 인자 · SFUNC · STYPE · FINALFUNC · COMBINEFUNC · INITCOND.
pub(crate) fn pg_aggregate_sql(server_version_num: i32) -> String {
    let combine = if server_version_num >= 90_600 {
        "NULLIF(a.aggcombinefn::regproc::text, '-')"
    } else {
        "NULL::text"
    };
    format!(
        "SELECT quote_ident(n.nspname) || '.' || quote_ident(p.proname), pg_catalog.pg_get_function_arguments(p.oid), \
         a.aggtransfn::regproc::text, pg_catalog.format_type(a.aggtranstype, NULL), NULLIF(a.aggfinalfn::regproc::text, '-'), \
         {combine}, a.agginitval \
         FROM pg_catalog.pg_aggregate a JOIN pg_catalog.pg_proc p ON p.oid = a.aggfnoid \
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE a.aggfnoid = $1"
    )
}

/// 트리거 — `$1` 스키마 · `$2` 테이블 · `$3` 이름(내부 트리거 제외).
pub(crate) const PG_TRIGGER: &str = "SELECT pg_catalog.pg_get_triggerdef(t.oid, true) FROM pg_catalog.pg_trigger t \
     JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3 AND NOT t.tgisinternal";

/// 인덱스 — `$1` 스키마 · `$2` 이름(인덱스 이름은 스키마 안에서 하나).
pub(crate) const PG_INDEX: &str = "SELECT pg_catalog.pg_get_indexdef(i.oid) FROM pg_catalog.pg_class i \
     JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace WHERE n.nspname = $1 AND i.relname = $2 AND i.relkind IN ('i', 'I')";

/// 제약 조건 — `$1` 스키마 · `$2` 테이블 · `$3` 이름. 답: 정규화 테이블 이름 · 이름(인용) · 정의.
pub(crate) const PG_CONSTRAINT: &str = "SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname), quote_ident(co.conname), \
     pg_catalog.pg_get_constraintdef(co.oid, true) FROM pg_catalog.pg_constraint co \
     JOIN pg_catalog.pg_class c ON c.oid = co.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relname = $2 AND co.conname = $3";

/// 시퀀스(10+ `pg_sequence`) — `$1` 스키마 · `$2` 이름. 답: 정규화 이름 · 형 · 시작 · 증가 · 최대 · 최소 · 캐시 · 순환 · 딸린 열 ·
/// 딸린 방식(`a` = OWNED BY · `i` = identity 열).
pub(crate) const PG_SEQUENCE: &str = "SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname), \
     pg_catalog.format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle, \
     (SELECT quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(a.attname) \
      FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class tc ON tc.oid = d.refobjid \
      JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace \
      JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid \
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass \
      AND d.deptype IN ('a', 'i') LIMIT 1), \
     (SELECT d.deptype::text FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid \
      AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a', 'i') LIMIT 1) \
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
     JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'S'";

/// 형 머리 — `$1` 스키마 · `$2` 이름. 답: oid · typtype · 정규화 이름 · 바탕 형(도메인) · NOT NULL · 기본값 · 콜레이션(도메인 —
/// 바탕 형의 기본과 다를 때) · 복합 형의 관계 oid.
pub(crate) const PG_TYPE: &str = "SELECT t.oid, t.typtype::text, quote_ident(n.nspname) || '.' || quote_ident(t.typname), \
     CASE WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod) END, t.typnotnull, t.typdefault, \
     CASE WHEN t.typtype = 'd' AND t.typcollation <> 0 AND t.typcollation <> bt.typcollation THEN \
      (SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname) FROM pg_catalog.pg_collation co \
       JOIN pg_catalog.pg_namespace cn ON cn.oid = co.collnamespace WHERE co.oid = t.typcollation) END, \
     t.typrelid \
     FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace \
     LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype \
     WHERE n.nspname = $1 AND t.typname = $2 AND t.typtype IN ('e', 'd', 'r', 'c')";

/// 열거형 값(인용) — `$1` 형 oid.
pub(crate) const PG_ENUM_LABELS: &str =
    "SELECT quote_literal(enumlabel) FROM pg_catalog.pg_enum WHERE enumtypid = $1 ORDER BY enumsortorder";

/// 도메인 체크 — `$1` 형 oid. 답: 이름(인용) · 정의.
pub(crate) const PG_DOMAIN_CHECKS: &str = "SELECT quote_ident(conname), pg_catalog.pg_get_constraintdef(oid, true) \
     FROM pg_catalog.pg_constraint WHERE contypid = $1 AND contype = 'c' ORDER BY conname";

/// 범위 형 — `$1` 형 oid. 답: 바탕 형 · SUBTYPE_DIFF · CANONICAL.
pub(crate) const PG_RANGE: &str = "SELECT pg_catalog.format_type(r.rngsubtype, NULL), NULLIF(r.rngsubdiff::regproc::text, '-'), \
     NULLIF(r.rngcanonical::regproc::text, '-') FROM pg_catalog.pg_range r WHERE r.rngtypid = $1";

/// 복합 형의 칸 — `$1` 관계 oid. 답: 이름(인용) · 형.
pub(crate) const PG_COMPOSITE_ATTRS: &str = "SELECT quote_ident(attname), pg_catalog.format_type(atttypid, atttypmod) \
     FROM pg_catalog.pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped ORDER BY attnum";

/// 서버 판.
pub(crate) const PG_VERSION_NUM: &str = "SELECT current_setting('server_version_num')::int4";

/// 테이블 머리(재구성 재료).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PgTableHead {
    /// `r` · `p` · `f`.
    pub relkind: String,
    /// 인용된 정규화 이름.
    pub name: String,
    /// `u` = UNLOGGED.
    pub persistence: String,
    /// 파티션이면 부모(인용된 정규화 이름)와 범위 식.
    pub partition_of: Option<(String, String)>,
    pub partition_key: Option<String>,
    pub inherits: Option<String>,
    pub options: Option<String>,
    pub server: Option<String>,
    pub server_options: Option<String>,
}

/// 컬럼 하나(재구성 재료).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PgColumn {
    pub name: String,
    pub ty: String,
    pub collation: Option<String>,
    pub default: Option<String>,
    pub not_null: bool,
    /// `a` = ALWAYS · `d` = BY DEFAULT · 빈 글자 = 아님.
    pub identity: String,
    /// `s` = STORED · `v` = VIRTUAL(18+) · 빈 글자 = 아님.
    pub generated: String,
}

/// 컬럼 한 줄 — **순수**.
pub(crate) fn pg_column_line(c: &PgColumn) -> String {
    let mut s = format!("{} {}", c.name, c.ty);
    if let Some(co) = &c.collation {
        s.push_str(&format!(" COLLATE {co}"));
    }
    match (c.generated.as_str(), &c.default) {
        ("s", Some(e)) => s.push_str(&format!(" GENERATED ALWAYS AS ({e}) STORED")),
        ("v", Some(e)) => s.push_str(&format!(" GENERATED ALWAYS AS ({e}) VIRTUAL")),
        (_, Some(d)) => s.push_str(&format!(" DEFAULT {d}")),
        _ => {}
    }
    match c.identity.as_str() {
        "a" => s.push_str(" GENERATED ALWAYS AS IDENTITY"),
        "d" => s.push_str(" GENERATED BY DEFAULT AS IDENTITY"),
        _ => {}
    }
    if c.not_null {
        s.push_str(" NOT NULL");
    }
    s
}

/// 테이블 `CREATE` 를 짠다 — **순수**. 컬럼(상속 열은 부르는 쪽이 뺀다) · 제약(`CONSTRAINT 이름 정의`) · 상속 · 분할 키 · 외부 서버 ·
/// 옵션 · 그 뒤에 인덱스. 파티션은 `PARTITION OF 부모 범위`.
pub(crate) fn pg_table_ddl(h: &PgTableHead, cols: &[PgColumn], cons: &[(String, String)], indexes: &[String]) -> String {
    let unlogged = if h.persistence == "u" { "UNLOGGED " } else { "" };
    let foreign = if h.relkind == "f" { "FOREIGN " } else { "" };
    let mut s = format!("CREATE {unlogged}{foreign}TABLE {}", h.name);
    let con_lines: Vec<String> = cons.iter().map(|(n, d)| format!("    CONSTRAINT {n} {d}")).collect();
    if let Some((parent, bound)) = &h.partition_of {
        s.push_str(&format!(" PARTITION OF {parent}"));
        if !con_lines.is_empty() {
            s.push_str(&format!(" (\n{}\n)", con_lines.join(",\n")));
        }
        s.push_str(&format!("\n{bound}"));
    } else {
        let mut lines: Vec<String> = cols.iter().map(|c| format!("    {}", pg_column_line(c))).collect();
        lines.extend(con_lines);
        if lines.is_empty() {
            s.push_str(" (\n)");
        } else {
            s.push_str(&format!(" (\n{}\n)", lines.join(",\n")));
        }
        if let Some(i) = &h.inherits {
            s.push_str(&format!("\nINHERITS ({i})"));
        }
    }
    if let Some(k) = &h.partition_key {
        s.push_str(&format!("\nPARTITION BY {k}"));
    }
    if let Some(srv) = &h.server {
        s.push_str(&format!("\nSERVER {srv}"));
        if let Some(o) = &h.server_options {
            s.push_str(&format!("\nOPTIONS ({o})"));
        }
    }
    if let Some(o) = &h.options {
        s.push_str(&format!("\nWITH ({o})"));
    }
    s.push(';');
    for i in indexes {
        s.push_str(&format!("\n\n{i};"));
    }
    s
}

/// 뷰 정의(`pg_get_viewdef`)의 꼬리 `;` 를 떼고 다시 하나 — **순수**.
fn view_body(def: &str) -> String {
    format!("{};", def.trim_end().trim_end_matches(';').trim_end())
}

/// `CREATE OR REPLACE VIEW … AS …;` — **순수**.
pub(crate) fn pg_view_ddl(name: &str, options: Option<&str>, def: &str) -> String {
    let with = options.map(|o| format!(" WITH ({o})")).unwrap_or_default();
    format!("CREATE OR REPLACE VIEW {name}{with} AS\n{}", view_body(def))
}

/// `CREATE MATERIALIZED VIEW … AS … WITH [NO] DATA;` + 인덱스 — **순수**.
pub(crate) fn pg_matview_ddl(name: &str, options: Option<&str>, def: &str, populated: bool, indexes: &[String]) -> String {
    let with = options.map(|o| format!(" WITH ({o})")).unwrap_or_default();
    let body = def.trim_end().trim_end_matches(';').trim_end();
    let data = if populated { "WITH DATA" } else { "WITH NO DATA" };
    let mut s = format!("CREATE MATERIALIZED VIEW {name}{with} AS\n{body}\n{data};");
    for i in indexes {
        s.push_str(&format!("\n\n{i};"));
    }
    s
}

/// 시퀀스(재구성 재료).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PgSequence {
    pub name: String,
    pub ty: String,
    pub start: i64,
    pub increment: i64,
    pub max: i64,
    pub min: i64,
    pub cache: i64,
    pub cycle: bool,
    /// 딸린 열(인용된 `스키마.테이블.열`)과 방식(`a` = OWNED BY · `i` = identity).
    pub owned: Option<(String, String)>,
}

/// `CREATE SEQUENCE …;` — **순수**.
pub(crate) fn pg_sequence_ddl(q: &PgSequence) -> String {
    let cycle = if q.cycle { "CYCLE" } else { "NO CYCLE" };
    let mut s = format!(
        "CREATE SEQUENCE {}\n    AS {}\n    START WITH {}\n    INCREMENT BY {}\n    MINVALUE {}\n    MAXVALUE {}\n    CACHE {}\n    {cycle};",
        q.name, q.ty, q.start, q.increment, q.min, q.max, q.cache
    );
    match &q.owned {
        Some((col, kind)) if kind == "i" => s.push_str(&format!("\n\n-- identity: {col}")),
        Some((col, _)) => s.push_str(&format!("\n\nALTER SEQUENCE {} OWNED BY {col};", q.name)),
        None => {}
    }
    s
}

/// `CREATE TYPE … AS ENUM (…);` — **순수**. 값은 이미 인용됐다.
pub(crate) fn pg_enum_ddl(name: &str, labels: &[String]) -> String {
    if labels.is_empty() {
        return format!("CREATE TYPE {name} AS ENUM ();");
    }
    format!("CREATE TYPE {name} AS ENUM (\n{}\n);", labels.iter().map(|l| format!("    {l}")).collect::<Vec<_>>().join(",\n"))
}

/// 도메인(재구성 재료).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PgDomain {
    pub name: String,
    pub base: String,
    pub collation: Option<String>,
    pub default: Option<String>,
    pub not_null: bool,
    /// (이름(인용), 정의).
    pub checks: Vec<(String, String)>,
}

/// `CREATE DOMAIN …;` — **순수**.
pub(crate) fn pg_domain_ddl(d: &PgDomain) -> String {
    let mut s = format!("CREATE DOMAIN {} AS {}", d.name, d.base);
    if let Some(c) = &d.collation {
        s.push_str(&format!(" COLLATE {c}"));
    }
    if let Some(v) = &d.default {
        s.push_str(&format!("\n    DEFAULT {v}"));
    }
    if d.not_null {
        s.push_str("\n    NOT NULL");
    }
    for (n, def) in &d.checks {
        s.push_str(&format!("\n    CONSTRAINT {n} {def}"));
    }
    s.push(';');
    s
}

/// `CREATE TYPE … AS RANGE (…);` — **순수**.
pub(crate) fn pg_range_ddl(name: &str, subtype: &str, diff: Option<&str>, canonical: Option<&str>) -> String {
    let mut parts = vec![format!("SUBTYPE = {subtype}")];
    if let Some(d) = diff {
        parts.push(format!("SUBTYPE_DIFF = {d}"));
    }
    if let Some(c) = canonical {
        parts.push(format!("CANONICAL = {c}"));
    }
    format!("CREATE TYPE {name} AS RANGE (\n{}\n);", parts.iter().map(|p| format!("    {p}")).collect::<Vec<_>>().join(",\n"))
}

/// `CREATE TYPE … AS (…);` — **순수**.
pub(crate) fn pg_composite_ddl(name: &str, attrs: &[(String, String)]) -> String {
    if attrs.is_empty() {
        return format!("CREATE TYPE {name} AS ();");
    }
    let lines: Vec<String> = attrs.iter().map(|(n, t)| format!("    {n} {t}")).collect();
    format!("CREATE TYPE {name} AS (\n{}\n);", lines.join(",\n"))
}

/// 집계 함수(재구성 재료).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PgAggregate {
    pub name: String,
    pub args: String,
    pub sfunc: String,
    pub stype: String,
    pub finalfunc: Option<String>,
    pub combinefunc: Option<String>,
    pub initcond: Option<String>,
}

/// `CREATE AGGREGATE …(…) (…);` — **순수**. 초기값은 글자 리터럴로 인용한다.
pub(crate) fn pg_aggregate_ddl(a: &PgAggregate) -> String {
    let mut parts = vec![format!("SFUNC = {}", a.sfunc), format!("STYPE = {}", a.stype)];
    if let Some(f) = &a.finalfunc {
        parts.push(format!("FINALFUNC = {f}"));
    }
    if let Some(f) = &a.combinefunc {
        parts.push(format!("COMBINEFUNC = {f}"));
    }
    if let Some(i) = &a.initcond {
        parts.push(format!("INITCOND = '{}'", i.replace('\'', "''")));
    }
    format!(
        "CREATE AGGREGATE {}({}) (\n{}\n);",
        a.name,
        a.args,
        parts.iter().map(|p| format!("    {p}")).collect::<Vec<_>>().join(",\n")
    )
}

/// `ALTER TABLE … ADD CONSTRAINT …;` — **순수**.
pub(crate) fn pg_constraint_ddl(table: &str, name: &str, def: &str) -> String {
    format!("ALTER TABLE {table}\n    ADD CONSTRAINT {name} {def};")
}

/// 글자 끝에 `;` 가 없으면 붙인다 — **순수**(`pg_get_indexdef` · `pg_get_triggerdef` 는 꼬리 `;` 가 없다).
pub(crate) fn with_semicolon(s: &str) -> String {
    let t = s.trim_end();
    if t.ends_with(';') {
        t.to_string()
    } else {
        format!("{t};")
    }
}
