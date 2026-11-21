//! `delegation.toml` 의 `[[database]]` 블록 — DB 연결의 AI 권한. `id` 는 `db-connections.json` 의 id(= 볼트 `db_password` 의 열쇠).
//!
//! ## 불변식
//!
//! - 단계는 누적 `off(블록 없음) < schema < read < approve < all`. **허용 목록 'Auto' 는 없다** — SQL 은 셸 허용 목록으로 범위를 말할 수 없다.
//!   `all` 은 이 연결 하나만 대상인 쓰기 작업안을 사람 없이 승인한다(실행 직전 재판정 · 따로 연 쓰기 연결 · 한 트랜잭션 · `maxAffected` 되돌림은 그대로).
//!   모르는 글자는 끔으로 읽는다 — 넓히지 않는다.
//! - **신원 스냅샷이 어긋나면 끔이다**(엔진 · 주소 · 포트 · DB · 사용자 · 파일 · 경유 별칭 · 그 별칭이 가리키는 SSH 서버) — 테스트 DB 의 권한이 운영 DB 로 새지 않게.
//!   스냅샷은 Rust 가 적는 순간 계산한다 — 프런트는 단계만 보낸다.
//! - 쓰는 길은 Tauri 명령 · 연결 목록 · 호스트 편집의 따라가기 · 설정 가져오기뿐 — **MCP 에는 이 블록을 고치는 도구가 없다**(→ docs/invariants.md 전문 8).
//! - 판정은 세션 서버가 MCP 호출마다 파일을 새로 읽어 한다 — [`db_ai_list`] 는 화면용 사본이다.
//! - `headless` = 타일 없이 AI 가 볼트 비밀번호로 새로 여는 것(SQLite 도 사람 타일이 없으면 이 칸을 따른다). 단계가 끔이거나 스냅샷이 어긋나면 함께 꺼지고,
//!   빌린 값(사람 타일이 열린 동안)과는 무관하다. 칸이 없는 옛 블록은 켬으로 읽고, 새 블록 · 대상이 바뀐 블록은 `false` 를 명시한다.
//! - 연결 이름 변경 · 경유 별칭 이름 변경은 권한을 지키고(`expect_via_target` 이 같은 서버의 증거), 대상 · 경유를 바꾸면 블록은 남되 끔으로 읽힌다.

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

/// 글자는 파일 · 프런트 · MCP 에 그대로 남는다 — 바꾸지 않는다. 변형 순서가 곧 누적 비교(`Ord`)다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbAiLevel {
    #[default]
    Off,
    /// 구조 · DDL 만 — 행이 밖으로 나가지 않는다.
    Schema,
    /// 결과 행이 모델 제공자로 간다.
    Read,
    /// 쓰기 작업안(사람 승인).
    Approve,
    /// 쓰기 작업안을 사람 없이 승인 — 전체 스위치 `[automation] auto_approve` 가 꺼져 있으면 사람을 기다린다.
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

    /// 모든 언어에서 같은 영어 낱말 — 프런트 `app.ai.stage.*` · `app.dbai.level.schema` 와 같은 글자.
    pub fn name(self) -> &'static str {
        match self {
            DbAiLevel::Off => "Off",
            DbAiLevel::Schema => "Schema",
            DbAiLevel::Read => "Read",
            DbAiLevel::Approve => "Ask",
            DbAiLevel::All => "YOLO",
        }
    }

    /// 모르는 글자(손 편집의 `"auto"` 등)는 끔 — 넓히지 않는다.
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

/// 스냅샷 칸이 없으면(손 편집) 스냅샷 비교가 어긋나 끔이 된다.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DatabaseTarget {
    pub id: String,
    #[serde(default)]
    pub ai: String,
    /// `None` = 칸이 없는 옛 블록(켬으로 읽는다).
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

    /// 칸이 없으면 켬 — 이 칸 전에 적힌 블록은 타일 없이도 볼트로 열렸다. 그 동작을 깨지 않는다.
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

/// 이름 · TLS 모드 · CA 는 들지 않는다(붙는 방법이지 다른 서버가 아니다). `via_target` = 경유 별칭이 가리키는 `user@host:port`.
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

/// `db-connections.json` 과 같은 글자 — 파일에 남는다.
pub(crate) fn engine_str(e: DbEngine) -> &'static str {
    match e {
        DbEngine::Postgres => "postgres",
        DbEngine::Mysql => "mysql",
        DbEngine::Mariadb => "mariadb",
        DbEngine::Sqlite => "sqlite",
    }
}

impl DbIdentity {
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

    /// 경유 별칭만 대소문자를 무시한다(ssh config 별칭 비교와 같은 눈).
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

/// 글자 꼴은 파일의 `expect_via_target` 에 남는다 — 바꾸면 적힌 블록이 모두 끔이 된다.
fn via_target_text(alias: &str) -> Result<String, String> {
    let s = identity_snapshot(alias)?;
    Ok(format!("{}@{}:{}", s.user, s.host, s.port))
}

/// 못 읽으면 `None` — 스냅샷이 어긋나 끔이 된다(닫힌 쪽으로 실패). MCP 판정과 화면 사본이 이 함수 하나를 지난다.
pub(crate) fn current_via_target(alias: &str) -> Option<String> {
    via_target_text(alias).ok()
}

impl Delegation {
    pub fn database(&self, id: &str) -> Option<&DatabaseTarget> {
        self.databases.iter().find(|d| d.id == id)
    }

    pub(crate) fn db_level(&self, conn: &DbConn, via_target: Option<&str>) -> DbAiLevel {
        let Some(t) = self.database(&conn.id) else {
            return DbAiLevel::Off;
        };
        if !t.identity().same(&DbIdentity::of(conn, via_target.map(str::to_owned))) {
            return DbAiLevel::Off;
        }
        t.level()
    }

    pub(crate) fn db_headless(&self, conn: &DbConn, via_target: Option<&str>) -> bool {
        self.db_level(conn, via_target) != DbAiLevel::Off && self.database(&conn.id).is_some_and(DatabaseTarget::headless)
    }

    pub(crate) fn databases(&self) -> &[DatabaseTarget] {
        &self.databases
    }
}

// ── 쓰기 — `[[database]]` 국소 편집 ──

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

/// 없으면 키를 지운다 — 직접 연결로 바뀌면 `expect_via` 가 남지 않게.
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

/// `headless` 가 `None` 이어도 새 블록 · 스냅샷이 바뀐 블록은 `false` 를 명시한다 — 옛 위임 · "칸 없음 = 켬" 이 새 대상에 번지지 않게.
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
    // 못 읽으면 다른 대상으로 본다(닫힌 쪽).
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

// ── 파일 입출력 ──

/// 경유 별칭을 못 펴면 오류 — 적지 않는다.
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

/// 블로킹(디스크) — 부르는 쪽이 블로킹 풀에서. 실패는 경고로만 — 이미 끝난 연결 저장을 되돌리지 않는다.
pub(crate) fn forget_databases(ids: &[String]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    remove_at(&path_or_err()?, ids)
}

/// `expect_via_target` 은 그대로 둔다 — 같은 서버다.
pub(crate) fn follow_via_rename(from: &str, to: &str) -> Result<usize, String> {
    let path = path_or_err()?;
    let (before, existed) = read_or_empty(&path)?;
    let (after, n) = rename_via_in_doc(&before, from, to)?;
    write_if_changed(&path, &before, existed, after)?;
    Ok(n)
}

// ── 명령(GUI) ──

/// 스냅샷 값은 내보내지 않는다 — 프런트가 쥐면 고칠 수 있는 칸으로 보인다. 맞는지(`identityOk`)만 말한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAiView {
    pub id: String,
    /// 파일에 적힌 단계 — 효력은 `identityOk` 와 함께 읽는다.
    pub level: DbAiLevel,
    pub headless: bool,
    pub identity_ok: bool,
    /// 거짓 = 고아 블록.
    pub conn_known: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAiList {
    pub targets: Vec<DbAiView>,
    /// 붙은 세션 서버가 DB MCP 도구를 아는 판인가 — 권한 저장 자체는 된다(파일은 GUI 가 쓴다).
    pub server_ready: bool,
    /// 붙은 세션 서버가 DB 쓰기 작업안을 아는 판인가 — 모르면 'Ask' 가 읽기 전용과 같다.
    pub write_plans: bool,
    /// 붙은 세션 서버가 op `db_test` 를 아는 판인가.
    pub conn_test: bool,
}

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

/// `headless` 를 바꾸는 길은 이 명령 하나다(원격 창에서는 단계와 같은 재확인 — `remote::deny` 의 REAUTH).
#[tauri::command]
pub async fn db_ai_set(app: tauri::AppHandle, id: String, level: DbAiLevel, headless: Option<bool>) -> Result<(), String> {
    let out = tauri::async_runtime::spawn_blocking(move || set_at(&path_or_err()?, &id, level, headless))
        .await
        .map_err(|e| tr!(ko: "AI 권한을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the AI permission failed: {e}"))?;
    announce_on_ok(&app, out)
}

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
