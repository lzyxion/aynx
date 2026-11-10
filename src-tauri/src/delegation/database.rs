//! **DB 연결의 AI 권한**(쿼리 타일 3단계 3a — docs/log/2026-10-13-db-write-mcp-design.md B-2 · D4) — `delegation.toml` 의
//! `[[database]]` 블록.
//!
//! ```toml
//! [[database]]
//! id              = "Qp9-pg-dev01"        # db-connections.json 의 id(= 볼트 db_password 의 열쇠)
//! ai              = "read"                # "schema"(구조만) · "read"(읽기 전용) · "approve"(승인 후 실행) · "all"(모두 승인) — 끔 = 블록 없음
//! headless        = false                 # 타일 없이 AI 접속(볼트의 비밀번호 사용) — 칸 없음 = 켬(옛 블록 · 아래 불변식)
//! expect_engine   = "postgres"            # ── 신원 스냅샷(아래) ──
//! expect_via      = "web-01"              # 경유 호스트 별칭(직접이면 없음)
//! expect_via_target = "deploy@10.0.0.5:22" # 그 별칭이 적는 순간 가리키던 SSH 서버(user@host:port)
//! expect_host     = "localhost"
//! expect_port     = 5432
//! expect_database = "app"
//! expect_user     = "readonly"
//! # expect_path   = "C:\\data\\app.db"   # SQLite 만
//! ```
//!
//! ## 불변식
//!
//! - **단계는 누적 다섯**: 끔(블록 없음 · 기본) < 구조만 < 읽기 전용 < 승인 후 실행 < 모두 승인. **허용 목록으로 고르는 'Auto'
//!   은 없다**(10-14 사용자 결정 D4 — SQL 은 셸 허용 목록으로 범위를 말할 수 없다). 그 대신 **모두 승인**(`all` — 2026-10-23 사용자 결정,
//!   docs/log/2026-10-23-approve-all.md)은 범위를 "이 연결 전부" 로 명시한다 — 이 연결 하나만 대상인 쓰기 작업안은 사람 없이 승인된다
//!   (실행 직전 재판정 · 따로 연 쓰기 연결 · 한 트랜잭션 · `maxAffected` 되돌림은 그대로). 모르는 글자(`ai = "auto"` 같은 손 편집)는
//!   **끔**으로 읽는다(넓히지 않는다 — 옛 판은 `"all"` 을 끔으로 읽는다).
//! - **신원 스냅샷이 어긋나면 끔이다**([`Delegation::db_level`]) — 연결을 다른 서버로 고쳐 가리키거나(주소 · 포트 · DB · 사용자 ·
//!   엔진 · 파일), 경유 호스트를 바꾸거나, 그 별칭이 `~/.ssh/config` 에서 다른 서버를 가리키게 되면 권한이 풀린다(테스트 DB 에
//!   준 권한이 운영 DB 로 새지 않게 — 호스트 위임의 `expect_user/host/port` 와 같은 그물). 스냅샷은 **Rust 가 적는 순간**
//!   `db-connections.json`(+ `~/.ssh/config`)에서 계산한다 — 프런트는 단계 하나만 보낸다.
//! - **쓰는 길은 Tauri 명령뿐**([`db_ai_set`] · [`db_ai_remove`]) + 연결 목록 · 호스트 편집의 따라가기([`forget_databases`] ·
//!   [`follow_via_rename`]). **MCP 에는 이 블록을 고치는 도구가 없다**(호스트 위임과 같은 규칙 — AI 는 자기 권한을 넓힐 표면이 없다).
//! - **판정은 세션 서버에서**(MCP 도구 호출마다 파일을 새로 읽는다 — `mcp::db`). GUI 의 [`db_ai_list`] 는 화면용 사본이다.
//! - **헤드리스(`headless`) = 타일 없이 AI 가 볼트의 비밀번호로 새로 여는 것**(2026-11-09 사용자 결정 — SSH 호스트 위임의 헤드리스 접속과 같은
//!   원칙: 사람이 연 세션 위의 일은 붙은 접근, 사람 없이 새로 여는 것은 명시적 위임). 단계와 따로인 칸이고, 단계가 끔이거나 신원 스냅샷이
//!   어긋나면 함께 꺼진다([`Delegation::db_headless`]). 판정 자리는 AI 연결의 비밀번호 차례(`db::ai::open_with`) 하나 — 빌린 값(사람 타일이
//!   열린 동안)은 이 칸과 무관하다. **SQLite 도 이 칸을 따른다**(같은 날 — 비밀번호가 없어도 사람 없이 여는 것은 위임): 그 연결의 사람 타일이
//!   세션 서버 표에 없으면 켠 연결만 AI 가 파일을 연다(`db::ai::sqlite_gate` — 읽기 · 쓰기 작업안 공통). **이관**: 칸이 없는 블록(이 칸 전에 적힌 것)은 **켬**으로 읽는다(그때까지의 동작 — 읽기 해석이라 파일을
//!   고치지 않는다). 새로 만드는 블록 · 스냅샷이 바뀌어 다시 적는 블록은 `headless = false` 를 **명시**한다([`upsert_database_in_doc`]).
//!   편집은 [`db_ai_set`] 의 `headless` 인자뿐(같은 Tauri 명령 — 원격 재확인 등급도 같다).
//!
//! ## 따라가기
//!
//! | 사건 | 블록 |
//! |---|---|
//! | 연결 삭제(목록 저장에서 빠짐 · 경유 호스트 삭제로 함께 지워짐) | 지운다([`forget_databases`]) |
//! | 연결 이름 변경 | 그대로(열쇠는 id · 이름은 스냅샷이 아니다) |
//! | 경유 호스트 **별칭 이름** 변경(`config_edit::edit_host`) | `expect_via` 만 새 이름으로([`follow_via_rename`] — 같은 서버다. `expect_via_target` 이 그 증거) |
//! | 연결의 대상 · 경유를 바꿈 | 그대로 두되 **끔으로 읽힌다**(화면이 "다시 고르세요" 를 보인다 · 폼은 대상이 바뀌면 AI 칸을 끔으로 되돌린다) |

use std::path::Path;

use serde::{Deserialize, Serialize};
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, Value};

use super::{
    announce_on_ok, identity_snapshot, parse_doc, path_or_err, put, read_or_empty, remove_indices, with_rescued,
    write_if_changed, Delegation,
};
use crate::db::conns::{self, DbConn, DbEngine};
use crate::i18n::tr;
use crate::sessions_meta::match_line_endings;

/// DB 연결의 AI 권한 단계 — 누적(아래가 위를 포함). 글자는 파일 · 프런트 · MCP 에 그대로(`"off"` · `"schema"` · `"read"` · `"approve"`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbAiLevel {
    /// 연결이 AI 목록에도 안 보인다(기본 · 블록 없음).
    #[default]
    Off,
    /// 스키마 · 객체 · 테이블 구조 · DDL 만(행이 밖으로 나가지 않는다).
    Schema,
    /// + 조회 문장(행 상한) — **결과 행이 모델 제공자로 간다**.
    Read,
    /// + 쓰기 작업안(사람 승인 — 3b). 3a 에서는 읽기 전용과 같이 동작한다(쓰기 도구가 아직 없다).
    Approve,
    /// + 쓰기 작업안을 **사람 없이 승인**(모두 승인 — 2026-10-23). 전체 스위치 `[automation] auto_approve` 가 꺼져 있으면 사람을 기다린다.
    All,
}

impl DbAiLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            DbAiLevel::Off => "off",
            DbAiLevel::Schema => "schema",
            DbAiLevel::Read => "read",
            DbAiLevel::Approve => "approve",
            DbAiLevel::All => "all",
        }
    }

    /// 화면 · MCP 문구의 단계 이름 — **모든 언어에서 같은 영어 낱말**(2026-10-23 — 프런트 `app.ai.stage.*` · `app.dbai.level.schema` 와 같은 글자).
    pub fn name(self) -> &'static str {
        match self {
            DbAiLevel::Off => "Off",
            DbAiLevel::Schema => "Schema",
            DbAiLevel::Read => "Read",
            DbAiLevel::Approve => "Ask",
            DbAiLevel::All => "YOLO",
        }
    }

    /// 파일의 글자 → 단계. **모르는 글자는 끔**(손 편집의 `"auto"` 같은 것 — 넓히지 않는다).
    pub fn parse(s: &str) -> DbAiLevel {
        match s.trim() {
            "schema" => DbAiLevel::Schema,
            "read" => DbAiLevel::Read,
            "approve" => DbAiLevel::Approve,
            "all" => DbAiLevel::All,
            _ => DbAiLevel::Off,
        }
    }
}

/// `[[database]]` 블록 하나(읽기). 스냅샷 칸이 없으면(손 편집) 스냅샷 비교가 어긋나 끔이 된다.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DatabaseTarget {
    pub id: String,
    #[serde(default)]
    pub ai: String,
    /// 타일 없이 AI 접속(볼트의 비밀번호) — `None` = 칸이 없는 옛 블록(켬으로 읽는다 — [`DatabaseTarget::headless`]).
    #[serde(default)]
    pub headless: Option<bool>,
    #[serde(default)]
    pub expect_engine: String,
    #[serde(default)]
    pub expect_via: Option<String>,
    #[serde(default)]
    pub expect_via_target: Option<String>,
    #[serde(default)]
    pub expect_host: Option<String>,
    #[serde(default)]
    pub expect_port: Option<u16>,
    #[serde(default)]
    pub expect_database: Option<String>,
    #[serde(default)]
    pub expect_user: Option<String>,
    #[serde(default)]
    pub expect_path: Option<String>,
}

impl DatabaseTarget {
    pub fn level(&self) -> DbAiLevel {
        DbAiLevel::parse(&self.ai)
    }

    /// 파일의 헤드리스 칸 — **칸이 없으면 켬**(이관: 이 칸 전에 적힌 블록은 타일 없이도 볼트로 열렸다 — 그 동작을 깨지 않는다).
    pub fn headless(&self) -> bool {
        self.headless.unwrap_or(true)
    }

    fn identity(&self) -> DbIdentity {
        DbIdentity {
            engine: self.expect_engine.clone(),
            via: self.expect_via.clone(),
            via_target: self.expect_via_target.clone(),
            host: self.expect_host.clone(),
            port: self.expect_port,
            database: self.expect_database.clone(),
            user: self.expect_user.clone(),
            path: self.expect_path.clone(),
        }
    }
}

/// 연결의 **신원 스냅샷** — 이 값이 같아야 같은 DB 다(B-2). 이름 · TLS 모드 · CA 는 들지 않는다(같은 서버에 붙는 방법이지 다른 서버가
/// 아니다). `via_target` = 경유 별칭이 지금 가리키는 SSH 서버(`user@host:port`) — 별칭 이름은 같은데 `~/.ssh/config` 가 다른 서버로
/// 바뀐 경우를 가른다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DbIdentity {
    engine: String,
    via: Option<String>,
    via_target: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    database: Option<String>,
    user: Option<String>,
    path: Option<String>,
}

/// 엔진의 파일 글자(`db-connections.json` 과 같은 소문자).
pub(crate) fn engine_str(e: DbEngine) -> &'static str {
    match e {
        DbEngine::Postgres => "postgres",
        DbEngine::Mysql => "mysql",
        DbEngine::Mariadb => "mariadb",
        DbEngine::Sqlite => "sqlite",
    }
}

impl DbIdentity {
    /// 연결 한 줄 + 경유 별칭이 지금 가리키는 곳 → 스냅샷 — **순수**.
    pub(crate) fn of(conn: &DbConn, via_target: Option<String>) -> DbIdentity {
        DbIdentity {
            engine: engine_str(conn.engine).to_string(),
            via: conn.via.clone(),
            via_target: conn.via.as_ref().and(via_target),
            host: conn.host.clone(),
            port: conn.port,
            database: conn.database.clone(),
            user: conn.user.clone(),
            path: conn.path.clone(),
        }
    }

    /// 같은 DB 인가 — 경유 별칭만 대소문자를 무시한다(ssh config 별칭 비교와 같은 눈 — `conns::same_alias`).
    pub(crate) fn same(&self, other: &DbIdentity) -> bool {
        let via_same = match (&self.via, &other.via) {
            (None, None) => true,
            (Some(a), Some(b)) => conns::same_alias(a, b),
            _ => false,
        };
        via_same
            && self.engine == other.engine
            && self.via_target == other.via_target
            && self.host == other.host
            && self.port == other.port
            && self.database == other.database
            && self.user == other.user
            && self.path == other.path
    }
}

/// `user@host:port` — [`identity_snapshot`] 의 글자 꼴(경유 별칭의 신원).
fn via_target_text(alias: &str) -> Result<String, String> {
    let s = identity_snapshot(alias)?;
    Ok(format!("{}@{}:{}", s.user, s.host, s.port))
}

/// 경유 별칭이 **지금** 가리키는 SSH 서버 — 못 읽으면 `None`(스냅샷이 어긋나 끔이 된다 · 닫힌 쪽으로 실패). 세션 서버의 MCP 판정과 GUI
/// 의 화면 사본이 같은 함수를 지난다.
pub(crate) fn current_via_target(alias: &str) -> Option<String> {
    via_target_text(alias).ok()
}

impl Delegation {
    /// 연결 id 의 블록(정확히 같은 id).
    pub fn database(&self, id: &str) -> Option<&DatabaseTarget> {
        self.databases.iter().find(|d| d.id == id)
    }

    /// 이 연결의 **AI 권한 단계** — 블록이 없거나 신원 스냅샷이 어긋나면 [`DbAiLevel::Off`]. `via_target` = 경유 별칭이 지금 가리키는
    /// 곳([`current_via_target`] — 직접 연결이면 무시). **순수**(파일 · 설정은 부르는 쪽이 읽는다).
    pub(crate) fn db_level(&self, conn: &DbConn, via_target: Option<&str>) -> DbAiLevel {
        let Some(t) = self.database(&conn.id) else {
            return DbAiLevel::Off;
        };
        if !t.identity().same(&DbIdentity::of(conn, via_target.map(str::to_owned))) {
            return DbAiLevel::Off;
        }
        t.level()
    }

    /// 이 연결에 **타일 없이 AI 접속**(볼트의 비밀번호)이 위임됐나 — 단계가 끔이 아니고(스냅샷 포함 — [`Delegation::db_level`]) 칸이 켜졌을
    /// 때만. **순수.**
    pub(crate) fn db_headless(&self, conn: &DbConn, via_target: Option<&str>) -> bool {
        self.db_level(conn, via_target) != DbAiLevel::Off && self.database(&conn.id).is_some_and(DatabaseTarget::headless)
    }

    /// 블록 전부(파일 순서).
    pub(crate) fn databases(&self) -> &[DatabaseTarget] {
        &self.databases
    }
}

// ---------------------------------------------------------------------------
// 쓰기 — `[[database]]` 국소 편집(호스트 블록 `[[target]]` 과 같은 규칙: 아는 키만 · 주석 · 순서 보존)
// ---------------------------------------------------------------------------

const KEY: &str = "database";

fn not_array() -> String {
    tr!(
        ko: "delegation.toml 의 database 가 [[database]] 블록 배열이 아닙니다 — 파일을 직접 고쳐 주세요",
        en: "database in delegation.toml is not an array of [[database]] blocks — please fix the file by hand"
    )
}

fn databases_of(doc: &DocumentMut) -> Result<Option<&ArrayOfTables>, String> {
    match doc.get(KEY) {
        None => Ok(None),
        Some(Item::ArrayOfTables(arr)) => Ok(Some(arr)),
        Some(_) => Err(not_array()),
    }
}

fn index_of(arr: &ArrayOfTables, id: &str) -> Option<usize> {
    arr.iter().position(|t| t.get("id").and_then(Item::as_str).is_some_and(|a| a == id))
}

/// 값이 있으면 적고 없으면 키를 지운다(스냅샷의 빈칸 — 직접 연결로 바뀌면 `expect_via` 가 남지 않게).
fn put_opt(table: &mut Table, key: &str, v: Option<Value>) {
    match v {
        Some(v) => put(table, key, v),
        None => {
            table.remove(key);
        }
    }
}

fn write_database(table: &mut Table, id: Option<&str>, ident: &DbIdentity, level: DbAiLevel) {
    if let Some(id) = id {
        put(table, "id", Value::from(id));
    }
    put(table, "ai", Value::from(level.as_str()));
    put(table, "expect_engine", Value::from(ident.engine.as_str()));
    put_opt(table, "expect_via", ident.via.as_deref().map(Value::from));
    put_opt(table, "expect_via_target", ident.via_target.as_deref().map(Value::from));
    put_opt(table, "expect_host", ident.host.as_deref().map(Value::from));
    put_opt(table, "expect_port", ident.port.map(|p| Value::from(i64::from(p))));
    put_opt(table, "expect_database", ident.database.as_deref().map(Value::from));
    put_opt(table, "expect_user", ident.user.as_deref().map(Value::from));
    put_opt(table, "expect_path", ident.path.as_deref().map(Value::from));
}

/// 연결들의 블록을 걷어낸 문서 전체와 지운 개수 — **순수**. 걸리는 것이 없으면 입력 그대로.
pub(crate) fn remove_databases_in_doc(content: &str, ids: &[String]) -> Result<(String, usize), String> {
    if ids.is_empty() {
        return Ok((content.to_string(), 0));
    }
    let mut doc = parse_doc(content)?;
    if databases_of(&doc)?.is_none() {
        return Ok((content.to_string(), 0));
    }
    let (carry, removed) = {
        let arr = doc.get_mut(KEY).and_then(Item::as_array_of_tables_mut).ok_or_else(not_array)?;
        let doomed: Vec<usize> = arr
            .iter()
            .enumerate()
            .filter(|(_, t)| t.get("id").and_then(Item::as_str).is_some_and(|a| ids.iter().any(|w| w == a)))
            .map(|(i, _)| i)
            .collect();
        if doomed.is_empty() {
            return Ok((content.to_string(), 0));
        }
        (remove_indices(arr, &doomed), doomed.len())
    };
    if databases_of(&doc)?.is_some_and(ArrayOfTables::is_empty) {
        doc.remove(KEY);
    }
    Ok((match_line_endings(content, with_rescued(doc.to_string(), &carry)), removed))
}

/// 연결 하나의 권한을 적거나(단계 + 스냅샷 + 헤드리스) 지운다(끔) — **순수**. `headless`: `Some` = 그 값을 적는다 · `None` = 그대로 두되
/// **새 블록이거나 스냅샷이 바뀐 블록이면 `false` 를 명시**한다(새 대상에 옛 위임을 옮기지 않는다 · 옛 블록의 "칸 없음 = 켬" 이 새 블록에
/// 번지지 않게).
pub(crate) fn upsert_database_in_doc(
    content: &str,
    id: &str,
    ident: &DbIdentity,
    level: DbAiLevel,
    headless: Option<bool>,
) -> Result<String, String> {
    let id = id.trim();
    if !crate::vault::db_conn_id_ok(id) {
        return Err(tr!(ko: "DB 연결 id 가 올바르지 않습니다", en: "The database connection id is invalid"));
    }
    if level == DbAiLevel::Off {
        return Ok(remove_databases_in_doc(content, &[id.to_string()])?.0);
    }
    // 지금 블록이 같은 대상을 가리키나(파일을 읽는 눈 그대로 — 못 읽으면 다른 대상으로 본다 · 닫힌 쪽).
    let same_target = Delegation::parse(content)
        .ok()
        .and_then(|d| d.database(id).map(|t| t.identity().same(ident)))
        .unwrap_or(false);
    let mut doc = parse_doc(content)?;
    let existing = databases_of(&doc)?.and_then(|arr| index_of(arr, id));
    let arr = doc
        .entry(KEY)
        .or_insert_with(|| Item::ArrayOfTables(ArrayOfTables::new()))
        .as_array_of_tables_mut()
        .ok_or_else(not_array)?;
    match existing {
        Some(i) => {
            let table = arr.get_mut(i).ok_or_else(not_array)?;
            write_database(table, None, ident, level);
            match headless {
                Some(on) => put(table, "headless", Value::from(on)),
                None if !same_target => put(table, "headless", Value::from(false)),
                None => {}
            }
        }
        None => {
            let mut table = Table::new();
            write_database(&mut table, Some(id), ident, level);
            put(&mut table, "headless", Value::from(headless.unwrap_or(false)));
            arr.push(table);
        }
    }
    Ok(match_line_endings(content, doc.to_string()))
}

/// 경유 별칭 이름 변경을 따라간다 — `expect_via` 가 `from`(대소문자 무시)인 블록을 `to` 로. 고친 수 — **순수**.
pub(crate) fn rename_via_in_doc(content: &str, from: &str, to: &str) -> Result<(String, usize), String> {
    let (from, to) = (from.trim(), to.trim());
    if from.is_empty() || to.is_empty() || from == to {
        return Ok((content.to_string(), 0));
    }
    let mut doc = parse_doc(content)?;
    if databases_of(&doc)?.is_none() {
        return Ok((content.to_string(), 0));
    }
    let mut n = 0;
    if let Some(arr) = doc.get_mut(KEY).and_then(Item::as_array_of_tables_mut) {
        for t in arr.iter_mut() {
            if t.get("expect_via").and_then(Item::as_str).is_some_and(|v| conns::same_alias(v, from)) {
                put(t, "expect_via", Value::from(to));
                n += 1;
            }
        }
    }
    if n == 0 {
        return Ok((content.to_string(), 0));
    }
    Ok((match_line_endings(content, doc.to_string()), n))
}

// ---------------------------------------------------------------------------
// 파일 입출력
// ---------------------------------------------------------------------------

/// 지금 연결 줄의 스냅샷(경유 별칭의 신원까지) — 적는 순간의 값. 경유 별칭을 못 펴면 오류(적지 않는다).
fn identity_now(conn: &DbConn) -> Result<DbIdentity, String> {
    let via_target = match &conn.via {
        Some(alias) => Some(via_target_text(alias)?),
        None => None,
    };
    Ok(DbIdentity::of(conn, via_target))
}

fn set_at(path: &Path, id: &str, level: DbAiLevel, headless: Option<bool>) -> Result<(), String> {
    let (before, existed) = read_or_empty(path)?;
    let after = if level == DbAiLevel::Off {
        remove_databases_in_doc(&before, &[id.to_string()])?.0
    } else {
        let conn = conns::find(id)?;
        upsert_database_in_doc(&before, id, &identity_now(&conn)?, level, headless)?
    };
    write_if_changed(path, &before, existed, after)
}

fn remove_at(path: &Path, ids: &[String]) -> Result<usize, String> {
    let (before, existed) = read_or_empty(path)?;
    let (after, n) = remove_databases_in_doc(&before, ids)?;
    write_if_changed(path, &before, existed, after)?;
    Ok(n)
}

/// **연결이 사라졌다**(목록 저장에서 빠짐 · 경유 호스트 삭제) — 그 블록을 지운다. 실패는 경고 문구(이미 끝난 저장을 되돌리지 않는다).
/// 블로킹(디스크) — 부르는 쪽이 블로킹 풀에서.
pub(crate) fn forget_databases(ids: &[String]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    remove_at(&path_or_err()?, ids)
}

/// **경유 호스트 별칭 이름이 바뀌었다**(`config_edit::edit_host`) — `expect_via` 를 따라 적는다(같은 서버 — `expect_via_target` 은 그대로).
pub(crate) fn follow_via_rename(from: &str, to: &str) -> Result<usize, String> {
    let path = path_or_err()?;
    let (before, existed) = read_or_empty(&path)?;
    let (after, n) = rename_via_in_doc(&before, from, to)?;
    write_if_changed(&path, &before, existed, after)?;
    Ok(n)
}

// ---------------------------------------------------------------------------
// 명령(GUI) — 화면의 사본 · 쓰기. 판정은 세션 서버(MCP)가 같은 파일을 다시 읽어 한다.
// ---------------------------------------------------------------------------

/// 화면이 보는 한 줄 — **스냅샷 값은 내보내지 않는다**(호스트 위임의 `DelegationTargetView` 와 같은 까닭 — 프런트가 쥐면 고칠 수 있는
/// 칸으로 보인다). 대신 지금 연결과 맞는지(`identityOk`)만 말한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAiView {
    pub id: String,
    /// 파일에 적힌 단계(스냅샷이 어긋나도 그대로 — 실제 효력은 `identityOk` 와 함께 읽는다).
    pub level: DbAiLevel,
    /// 타일 없이 AI 접속(볼트의 비밀번호) — 파일의 칸(칸이 없는 옛 블록은 켬 — [`DatabaseTarget::headless`]). 효력은 `level` 과 같이 `identityOk` 와 함께.
    pub headless: bool,
    /// 지금 연결 줄과 스냅샷이 같다(거짓 = 권한이 풀려 끔으로 동작한다 — "다시 고르세요").
    pub identity_ok: bool,
    /// 그 id 의 연결이 목록에 있다(거짓 = 고아 블록 — [제거]).
    pub conn_known: bool,
    /// 연결 이름(있을 때 — 설정 › 보안의 표가 쓴다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// [`db_ai_list`] 의 답.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAiList {
    pub targets: Vec<DbAiView>,
    /// 붙은 세션 서버가 DB MCP 도구를 아는 판인가(판 11 — `server::ipc::frame::DB_AI_PROTOCOL`). 거짓이면 화면이 "세션 서버를 다시
    /// 시작해야 AI 가 DB 를 봅니다" 를 밝힌다(권한 저장 자체는 된다 — 파일은 GUI 가 쓴다).
    pub server_ready: bool,
    /// 붙은 세션 서버가 AI 의 DB 쓰기 작업안을 아는 판인가(판 12 — `server::ipc::frame::DB_WRITE_PLAN_PROTOCOL`, 3b). 거짓이면 'Ask'
    /// 단계가 "세션 서버를 다시 시작해야 쓰기 작업안이 섭니다" 를 밝힌다(그때까지는 읽기 전용과 같다).
    pub write_plans: bool,
    /// 붙은 세션 서버가 DB 연결 폼의 [연결 테스트](op `db_test`)를 아는 판인가(판 28 — `server::ipc::frame::DB_TEST_PROTOCOL`). 거짓이면
    /// 폼이 그 단추를 숨긴다(이 목록은 폼이 열릴 때 이미 다시 읽힌다 — 판 표지를 한곳에서 받으려고 여기 싣는다).
    pub conn_test: bool,
}

/// 블록들 + 지금 연결 목록 → 화면 줄 — **순수**(경유 신원은 `via_target` 이 답한다).
pub(crate) fn views(d: &Delegation, list: &[DbConn], via_target: impl Fn(&str) -> Option<String>) -> Vec<DbAiView> {
    d.databases()
        .iter()
        .map(|t| {
            let conn = list.iter().find(|c| c.id == t.id);
            let identity_ok = conn.is_some_and(|c| {
                let vt = c.via.as_deref().and_then(&via_target);
                t.identity().same(&DbIdentity::of(c, vt))
            });
            DbAiView {
                id: t.id.clone(),
                level: t.level(),
                headless: t.headless(),
                identity_ok,
                conn_known: conn.is_some(),
                name: conn.map(|c| c.name.clone()),
            }
        })
        .collect()
}

/// DB 연결의 AI 권한 전부(화면 사본). **오류가 없다** — 파일이 없거나 깨졌으면 권한이 없는 것이다.
#[tauri::command]
pub async fn db_ai_list() -> DbAiList {
    let targets = tauri::async_runtime::spawn_blocking(|| {
        let d = Delegation::load_default();
        let list = conns::path().and_then(|p| conns::load_at(&p).ok()).map(|l| l.conns).unwrap_or_default();
        views(&d, &list, current_via_target)
    })
    .await
    .unwrap_or_default();
    let negotiated = crate::server::client::negotiated_protocol();
    DbAiList {
        targets,
        server_ready: negotiated.is_none_or(|p| p >= crate::server::ipc::frame::DB_AI_PROTOCOL),
        write_plans: negotiated.is_none_or(|p| p >= crate::server::ipc::frame::DB_WRITE_PLAN_PROTOCOL),
        conn_test: negotiated.is_none_or(|p| p >= crate::server::ipc::frame::DB_TEST_PROTOCOL),
    }
}

/// 연결 하나의 AI 권한을 저장한다(끔 = 블록을 지운다). 스냅샷은 여기서 `db-connections.json`(+ `~/.ssh/config`)으로 계산한다.
/// `headless` = 타일 없이 AI 접속(볼트의 비밀번호) — 없으면 그대로(새 블록 · 대상이 바뀐 블록은 끔 — [`upsert_database_in_doc`]). 이 칸을
/// 바꾸는 길은 이 명령 하나다(원격 창에서는 단계와 같은 재확인 — `remote::deny` 의 REAUTH).
#[tauri::command]
pub async fn db_ai_set(app: tauri::AppHandle, id: String, level: DbAiLevel, headless: Option<bool>) -> Result<(), String> {
    let out = tauri::async_runtime::spawn_blocking(move || set_at(&path_or_err()?, &id, level, headless))
        .await
        .map_err(|e| tr!(ko: "AI 권한을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the AI permission failed: {e}"))?;
    announce_on_ok(&app, out)
}

/// 블록들을 지운다(설정 › 보안 표의 [제거] — 고아 블록 포함). 지운 수.
#[tauri::command]
pub async fn db_ai_remove(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize, String> {
    let out = tauri::async_runtime::spawn_blocking(move || remove_at(&path_or_err()?, &ids))
        .await
        .map_err(|e| tr!(ko: "AI 권한을 지우는 작업이 실패했습니다: {e}", en: "The task that removes the AI permission failed: {e}"))?;
    announce_on_ok(&app, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pg(id: &str) -> DbConn {
        DbConn {
            id: id.into(),
            name: "앱 DB".into(),
            engine: DbEngine::Postgres,
            via: Some("web-01".into()),
            path: None,
            host: Some("localhost".into()),
            port: Some(5432),
            database: Some("app".into()),
            user: Some("readonly".into()),
            tls_mode: Some(Default::default()),
            tls_ca: None,
            folder: None,
        }
    }

    const VIA: &str = "deploy@10.0.0.5:22";

    fn granted(conn: &DbConn, level: DbAiLevel) -> Delegation {
        let ident = DbIdentity::of(conn, Some(VIA.into()));
        let doc = upsert_database_in_doc("", &conn.id, &ident, level, None).unwrap();
        Delegation::parse(&doc).unwrap()
    }

    #[test]
    fn level_round_trips_and_unknown_is_off() {
        for l in [DbAiLevel::Schema, DbAiLevel::Read, DbAiLevel::Approve, DbAiLevel::All] {
            assert_eq!(DbAiLevel::parse(l.as_str()), l);
        }
        assert_eq!(DbAiLevel::parse("auto"), DbAiLevel::Off);
        assert_eq!(DbAiLevel::parse(""), DbAiLevel::Off);
        assert!(DbAiLevel::Schema < DbAiLevel::Read && DbAiLevel::Read < DbAiLevel::Approve && DbAiLevel::Approve < DbAiLevel::All);
    }

    /// 시험 `db_permission_follows_identity_snapshot`(B-9) — 연결의 host · database · user · port · via · engine 을 바꾸거나 경유 별칭이 다른
    /// 서버를 가리키면 권한이 끔으로 읽힌다. 이름 · TLS 는 바뀌어도 그대로.
    #[test]
    fn db_permission_follows_identity_snapshot() {
        let c = pg("Qp9-pg-dev01");
        let d = granted(&c, DbAiLevel::Read);
        assert_eq!(d.db_level(&c, Some(VIA)), DbAiLevel::Read);
        // 경유 별칭의 대소문자는 같은 별칭이다.
        let mut upper = c.clone();
        upper.via = Some("WEB-01".into());
        assert_eq!(d.db_level(&upper, Some(VIA)), DbAiLevel::Read);
        // 이름 · TLS 는 신원이 아니다.
        let mut renamed = c.clone();
        renamed.name = "운영".into();
        renamed.tls_mode = Some(conns::DbTlsMode::VerifyFull);
        assert_eq!(d.db_level(&renamed, Some(VIA)), DbAiLevel::Read);
        let edits: Vec<fn(&mut DbConn)> = vec![
            |c| c.host = Some("prod-db".into()),
            |c| c.port = Some(6432),
            |c| c.database = Some("prod".into()),
            |c| c.user = Some("admin".into()),
            |c| c.via = Some("web-02".into()),
            |c| c.via = None,
            |c| c.engine = DbEngine::Mysql,
        ];
        for edit in edits {
            let mut x = c.clone();
            edit(&mut x);
            assert_eq!(d.db_level(&x, Some(VIA)), DbAiLevel::Off, "{x:?}");
        }
        // 별칭은 그대로인데 ~/.ssh/config 가 다른 서버를 가리킨다 · 별칭을 못 편다.
        assert_eq!(d.db_level(&c, Some("deploy@10.9.9.9:22")), DbAiLevel::Off);
        assert_eq!(d.db_level(&c, None), DbAiLevel::Off);
        // 다른 id 는 블록이 없다.
        assert_eq!(d.db_level(&pg("Other_conn01"), Some(VIA)), DbAiLevel::Off);
    }

    /// 시험 `db_headless_migration`(2026-11-09) — 칸이 없는 옛 블록은 **켬**으로 읽고(그때까지의 동작) 파일은 고치지 않는다 · 새로 만드는
    /// 블록은 `headless = false` 를 명시 · 단계만 바꾸면(`None`) 칸을 그대로 둔다(옛 블록의 칸 없음도) · 값을 주면 그 값 · 스냅샷이 바뀐 다시
    /// 적기는 `false` 로 되돌린다 · 단계가 끔이거나 스냅샷이 어긋나면 헤드리스도 꺼진다 · 끔 = 블록째 지움.
    #[test]
    fn db_headless_migration() {
        let c = pg("Qp9-pg-dev01");
        let ident = DbIdentity::of(&c, Some(VIA.into()));
        // 옛 블록(칸 없음) — 손으로 적은 이 칸 전의 파일.
        let legacy = upsert_database_in_doc("", &c.id, &ident, DbAiLevel::Read, None).unwrap().replace("headless = false\n", "");
        assert!(!legacy.contains("headless"), "{legacy}");
        let d = Delegation::parse(&legacy).unwrap();
        assert_eq!(d.database(&c.id).unwrap().headless, None);
        assert!(d.db_headless(&c, Some(VIA)), "칸 없음 = 켬(이관)");
        assert!(views(&d, std::slice::from_ref(&c), |_| Some(VIA.into()))[0].headless);
        // 단계만 바꾸면 옛 블록의 칸 없음이 그대로 — 여전히 켬.
        let raised = upsert_database_in_doc(&legacy, &c.id, &ident, DbAiLevel::Approve, None).unwrap();
        assert!(!raised.contains("headless") && raised.contains("ai = \"approve\""), "{raised}");
        assert!(Delegation::parse(&raised).unwrap().db_headless(&c, Some(VIA)));
        // 새 블록은 끔을 명시한다.
        let fresh = upsert_database_in_doc("", &c.id, &ident, DbAiLevel::Schema, None).unwrap();
        assert!(fresh.contains("headless = false"), "{fresh}");
        let d = Delegation::parse(&fresh).unwrap();
        assert!(!d.db_headless(&c, Some(VIA)) && d.db_level(&c, Some(VIA)) == DbAiLevel::Schema);
        // 켬 · 끔을 적는다(블록 하나 그대로).
        let on = upsert_database_in_doc(&fresh, &c.id, &ident, DbAiLevel::Schema, Some(true)).unwrap();
        assert!(on.contains("headless = true") && on.matches("[[database]]").count() == 1, "{on}");
        let d = Delegation::parse(&on).unwrap();
        assert!(d.db_headless(&c, Some(VIA)));
        // 대상이 바뀌면(스냅샷 어긋남) 단계와 함께 꺼진다 · 경유가 다른 서버를 가리켜도.
        let mut moved = c.clone();
        moved.host = Some("prod-db".into());
        assert!(!d.db_headless(&moved, Some(VIA)) && !d.db_headless(&c, Some("deploy@10.9.9.9:22")));
        // 새 대상으로 다시 적으면(칸을 주지 않으면) 끔으로 되돌린다 — 옛 위임이 새 대상에 옮겨 가지 않는다.
        let rewritten = upsert_database_in_doc(&on, &c.id, &DbIdentity::of(&moved, Some(VIA.into())), DbAiLevel::Schema, None).unwrap();
        let d = Delegation::parse(&rewritten).unwrap();
        assert!(!d.db_headless(&moved, Some(VIA)) && d.db_level(&moved, Some(VIA)) == DbAiLevel::Schema, "{rewritten}");
        // 같은 대상의 단계만 바꾸기는 켬을 지킨다.
        let kept = upsert_database_in_doc(&on, &c.id, &ident, DbAiLevel::Read, None).unwrap();
        assert!(Delegation::parse(&kept).unwrap().db_headless(&c, Some(VIA)), "{kept}");
        // 끔 = 블록째(헤드리스 칸까지) 지움 — 다시 켜면 새 블록(끔 명시).
        let off = upsert_database_in_doc(&kept, &c.id, &ident, DbAiLevel::Off, Some(true)).unwrap();
        assert!(!off.contains("database") && !off.contains("headless"), "{off}");
        let again = upsert_database_in_doc(&off, &c.id, &ident, DbAiLevel::Read, None).unwrap();
        assert!(!Delegation::parse(&again).unwrap().db_headless(&c, Some(VIA)));
        // 다른 id · 블록 없음은 끔.
        assert!(!Delegation::parse(&on).unwrap().db_headless(&pg("Other_conn01"), Some(VIA)));
    }

    #[test]
    fn sqlite_identity_is_the_path() {
        let c = DbConn {
            id: "Xk3_local-01".into(),
            name: "앱".into(),
            engine: DbEngine::Sqlite,
            via: None,
            path: Some("C:\\data\\app.db".into()),
            host: None,
            port: None,
            database: None,
            user: None,
            tls_mode: None,
            tls_ca: None,
            folder: None,
        };
        let doc = upsert_database_in_doc("", &c.id, &DbIdentity::of(&c, None), DbAiLevel::Schema, None).unwrap();
        assert!(doc.contains("expect_path") && !doc.contains("expect_via") && !doc.contains("expect_host"), "{doc}");
        let d = Delegation::parse(&doc).unwrap();
        assert_eq!(d.db_level(&c, None), DbAiLevel::Schema);
        let mut moved = c.clone();
        moved.path = Some("C:\\data\\prod.db".into());
        assert_eq!(d.db_level(&moved, None), DbAiLevel::Off);
    }

    #[test]
    fn writes_keep_host_blocks_comments_and_drop_off() {
        let base = "# 머리글\n[[target]]\nalias = \"web-01\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\n";
        let c = pg("Qp9-pg-dev01");
        let ident = DbIdentity::of(&c, Some(VIA.into()));
        let a = upsert_database_in_doc(base, &c.id, &ident, DbAiLevel::Read, None).unwrap();
        assert!(a.starts_with(base), "{a}");
        assert!(a.contains("[[database]]") && a.contains("ai = \"read\"") && a.contains(VIA), "{a}");
        // 단계만 바꾸면 그 블록만.
        let b = upsert_database_in_doc(&a, &c.id, &ident, DbAiLevel::Schema, None).unwrap();
        assert_eq!(b.matches("[[database]]").count(), 1);
        assert!(b.contains("ai = \"schema\""));
        // 직접 연결로 바뀐 스냅샷은 경유 칸을 지운다.
        let mut direct = c.clone();
        direct.via = None;
        let e = upsert_database_in_doc(&b, &c.id, &DbIdentity::of(&direct, None), DbAiLevel::Schema, None).unwrap();
        assert!(!e.contains("expect_via"), "{e}");
        // 끔 = 블록이 없다(키까지) · 호스트 블록 · 머리글은 그대로.
        let off = upsert_database_in_doc(&b, &c.id, &ident, DbAiLevel::Off, None).unwrap();
        assert!(!off.contains("database"), "{off}");
        assert!(off.contains("# 머리글") && off.contains("[[target]]"));
        let d = Delegation::parse(&b).unwrap();
        assert!(d.read_granted("web-01"), "호스트 위임은 그대로 읽힌다");
        assert!(upsert_database_in_doc("", "bad id!", &ident, DbAiLevel::Read, None).is_err());
    }

    #[test]
    fn remove_and_rename_via_follow_the_connections() {
        let c1 = pg("Qp9-pg-dev01");
        let c2 = pg("Other_conn01");
        let ident = DbIdentity::of(&c1, Some(VIA.into()));
        let doc = upsert_database_in_doc("", &c1.id, &ident, DbAiLevel::Read, None).unwrap();
        let doc = upsert_database_in_doc(&doc, &c2.id, &DbIdentity::of(&c2, Some(VIA.into())), DbAiLevel::Schema, None).unwrap();
        let (renamed, n) = rename_via_in_doc(&doc, "WEB-01", "web-new").unwrap();
        assert_eq!(n, 2);
        let d = Delegation::parse(&renamed).unwrap();
        let mut moved = c1.clone();
        moved.via = Some("web-new".into());
        assert_eq!(d.db_level(&moved, Some(VIA)), DbAiLevel::Read, "별칭 이름만 바뀐 같은 서버");
        let (gone, n) = remove_databases_in_doc(&renamed, std::slice::from_ref(&c1.id)).unwrap();
        assert_eq!(n, 1);
        let d = Delegation::parse(&gone).unwrap();
        assert!(d.database(&c1.id).is_none() && d.database(&c2.id).is_some());
        assert_eq!(remove_databases_in_doc(&gone, &["nothing_here".into()]).unwrap().1, 0);
    }

    #[test]
    fn views_mark_orphans_and_broken_snapshots() {
        let c = pg("Qp9-pg-dev01");
        let d = granted(&c, DbAiLevel::Read);
        let ok = views(&d, std::slice::from_ref(&c), |_| Some(VIA.into()));
        assert_eq!(ok[0], DbAiView { id: c.id.clone(), level: DbAiLevel::Read, headless: false, identity_ok: true, conn_known: true, name: Some("앱 DB".into()) });
        let mut moved = c.clone();
        moved.host = Some("prod".into());
        assert!(!views(&d, &[moved], |_| Some(VIA.into()))[0].identity_ok);
        let orphan = &views(&d, &[], |_| Some(VIA.into()))[0];
        assert!(!orphan.conn_known && !orphan.identity_ok);
    }
}
