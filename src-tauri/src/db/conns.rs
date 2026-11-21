//! **DB 연결 목록 하나** — `instance::config_root()/db-connections.json`. GUI 의 Tauri 명령이 직접 읽고 쓴다(비밀이 없어서).
//!
//! - **비밀이 없다** — 비밀번호 칸이 없고(볼트 `db_password` 의 열쇠가 `id`), 사람이 적어 둔 `password` 키는 읽지 않는다.
//! - **서버는 연결을 열 때 이 파일을 다시 읽는다**([`find`]) — GUI 가 보낸 경로 · 주소 · 경유를 믿지 않는다. 예외는 폼의 [연결 테스트]
//!   (`table::test`) 하나 — 서버가 [`validate_list`] 로 다시 검사하고, 볼트 비밀번호로 물러날지는 이 파일의 같은 id 줄과 대상이 같은지로 정한다.
//! - **id 는 볼트 열쇠** — 규칙은 `vault::db_conn_id_ok` 하나, 파일 안에서 겹치지 않는다.
//! - `via` 가 있으면 `host` 는 **그 호스트에서 본** 주소다. SQLite 는 직접만.
//! - `folder` 는 독의 자리일 뿐 — AI 권한 신원 스냅샷(`DbIdentity`)은 이 칸을 보지 않는다(폴더를 옮겨도 권한이 풀리지 않는다).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::i18n::tr;

/// 경유 · 직접 합쳐서.
pub(crate) const CONNS_MAX: usize = 64;
const NAME_MAX: usize = 64;
const VIA_MAX: usize = 255;
const FOLDER_MAX: usize = 255;

/// 파일 · 프런트에는 소문자 그대로.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
}

/// libpq 이름 그대로. 없으면 `prefer`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DbTlsMode {
    Disable,
    #[default]
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

impl DbTlsMode {
    /// **`verify-ca` 는 CA 파일만 믿는다**(공개 CA + 이름 무시는 사실상 검증이 없다). 쓰기는 저장을 거절하고, 이미 파일에 있는 줄은
    /// 접속 때 같은 문구로 실패한다.
    pub(crate) fn check_ca(self, ca: Option<&str>) -> Result<(), String> {
        if self == Self::VerifyCa && ca.map(str::trim).is_none_or(str::is_empty) {
            return Err(verify_ca_needs_ca());
        }
        Ok(())
    }
}

pub(crate) fn verify_ca_needs_ca() -> String {
    tr!(
        ko: "CA 검증은 CA 파일이 필요합니다. 공개 인증서를 쓰는 서버라면 CA+이름 검증을 고르세요.",
        en: "Verify CA needs a CA file. If the server uses a public certificate, choose Verify CA and name."
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DbConn {
    pub id: String,
    pub name: String,
    pub engine: DbEngine,
    /// `None` = 직접. SQLite 는 늘 없음.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// 경유면 **그 호스트에서 본** 주소.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// 네트워크 엔진은 파일에 늘 적는다(보안 선택이 파일에서 보이게).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_mode: Option<DbTlsMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_ca: Option<String>,
    /// `"운영/웹"` — `None` = 최상위. 접속 · 신원 스냅샷과 무관하다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnList {
    pub conns: Vec<DbConn>,
    pub warnings: Vec<String>,
}

/// 세션 서버 시험용(`serve::Config::db_conns`).
static PATH_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

pub(crate) fn set_path_override(p: Option<PathBuf>) {
    *PATH_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner()) = p;
}

pub(crate) fn path() -> Option<PathBuf> {
    if let Some(p) = PATH_OVERRIDE.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return Some(p);
    }
    Some(crate::instance::config_root()?.join("db-connections.json"))
}

fn clean(v: Option<&String>, field: &str) -> Result<Option<String>, String> {
    let Some(s) = v.map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if s.chars().any(char::is_control) {
        return Err(tr!(
            ko: "DB 연결의 {field} 에 제어 문자가 있습니다",
            en: "The {field} of a database connection contains a control character"
        ));
    }
    Ok(Some(s.to_string()))
}

/// ssh config 별칭 맞추기와 같은 눈(대소문자 무시 · `ssh::params::resolve_params`).
pub(crate) fn same_alias(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// 프런트 `host-folders.ts` 의 `normalizeGroupPath` 와 같은 꼴.
fn clean_folder(v: Option<&String>) -> Result<Option<String>, String> {
    let Some(raw) = v else {
        return Ok(None);
    };
    let path = raw.split('/').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/");
    if path.is_empty() {
        return Ok(None);
    }
    if path.chars().count() > FOLDER_MAX || path.chars().any(char::is_control) {
        return Err(tr!(
            ko: "DB 연결의 폴더는 {max}자 이하이고 제어 문자가 없어야 합니다",
            en: "The folder of a database connection must be at most {max} characters without control characters",
            max = FOLDER_MAX,
        ));
    }
    Ok(Some(path))
}

/// 읽기 · 쓰기가 같은 규칙. 겹침 · 개수는 목록 쪽이 본다.
pub(crate) fn validate_one(d: &DbConn) -> Result<DbConn, String> {
    let id = d.id.trim();
    if !crate::vault::db_conn_id_ok(id) {
        return Err(tr!(
            ko: "DB 연결 id '{id}' 가 올바르지 않습니다 — 8~32자의 영문·숫자·_·- 여야 합니다",
            en: "The database connection id '{id}' is invalid — it must be 8 to 32 letters, digits, _ or -"
        ));
    }
    let name = d.name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "DB 연결 이름이 비어 있습니다", en: "The database connection name is empty"));
    }
    if name.chars().count() > NAME_MAX || name.chars().any(char::is_control) {
        return Err(tr!(
            ko: "DB 연결 이름은 {max}자 이하이고 제어 문자가 없어야 합니다",
            en: "A database connection name must be at most {max} characters without control characters",
            max = NAME_MAX,
        ));
    }
    let via = clean(d.via.as_ref(), "via")?;
    if let Some(v) = &via {
        if v.chars().count() > VIA_MAX || v.chars().any(char::is_whitespace) {
            return Err(tr!(
                ko: "경유 호스트 '{v}' 가 올바르지 않습니다 — 공백 없는 별칭이어야 합니다",
                en: "The jump host '{v}' is invalid — it must be an alias without spaces"
            ));
        }
    }
    let base = DbConn {
        id: id.to_string(),
        name: name.to_string(),
        engine: d.engine,
        via: None,
        path: None,
        host: None,
        port: None,
        database: None,
        user: None,
        tls_mode: None,
        tls_ca: None,
        folder: clean_folder(d.folder.as_ref())?,
    };
    if d.engine == DbEngine::Sqlite {
        if via.is_some() {
            return Err(tr!(
                ko: "SSH 경유 SQLite 연결은 지원하지 않습니다 — SQLite 는 이 PC 의 파일만 엽니다",
                en: "SQLite connections over SSH are not supported — SQLite opens files on this PC only"
            ));
        }
        let Some(path) = clean(d.path.as_ref(), "path")? else {
            return Err(tr!(ko: "SQLite 연결에는 파일 경로가 필요합니다", en: "A SQLite connection needs a file path"));
        };
        if !Path::new(&path).is_absolute() {
            return Err(tr!(
                ko: "SQLite 파일 경로는 절대 경로여야 합니다: {path}",
                en: "The SQLite file path must be absolute: {path}"
            ));
        }
        return Ok(DbConn { path: Some(path), ..base });
    }
    let Some(host) = clean(d.host.as_ref(), "host")? else {
        return Err(tr!(ko: "DB 호스트가 비어 있습니다", en: "The database host is empty"));
    };
    if host.chars().any(char::is_whitespace) {
        return Err(tr!(
            ko: "DB 호스트 '{host}' 에 공백이 있습니다",
            en: "The database host '{host}' contains a space"
        ));
    }
    let port = match d.port {
        Some(p) if p > 0 => p,
        _ => {
            return Err(tr!(
                ko: "DB 포트는 1~65535 사이여야 합니다",
                en: "The database port must be between 1 and 65535"
            ))
        }
    };
    Ok(DbConn {
        via,
        host: Some(host),
        port: Some(port),
        database: clean(d.database.as_ref(), "database")?,
        user: clean(d.user.as_ref(), "user")?,
        tls_mode: Some(d.tls_mode.unwrap_or_default()),
        tls_ca: clean(d.tls_ca.as_ref(), "tls_ca")?,
        ..base
    })
}

/// 한 줄이라도 틀리면 통째로 거절한다(파일에 닿지 않는다).
pub(crate) fn validate_list(list: &[DbConn]) -> Result<Vec<DbConn>, String> {
    if list.len() > CONNS_MAX {
        return Err(tr!(
            ko: "DB 연결은 {max}개까지입니다",
            en: "There can be at most {max} database connections",
            max = CONNS_MAX,
        ));
    }
    let mut out: Vec<DbConn> = Vec::with_capacity(list.len());
    for d in list {
        let next = validate_one(d)?;
        // 쓰기만 — 읽기(`parse`)는 그 줄을 남기고 접속이 같은 문구로 실패한다.
        if let Some(mode) = next.tls_mode {
            mode.check_ca(next.tls_ca.as_deref())?;
        }
        if out.iter().any(|p| p.id == next.id) {
            return Err(tr!(
                ko: "DB 연결 id '{id}' 가 두 번 적혀 있습니다",
                en: "The database connection id '{id}' appears twice",
                id = next.id,
            ));
        }
        out.push(next);
    }
    Ok(out)
}

/// 줄마다 관대하게 — 깨진 줄 · 겹친 id 는 그 줄만 빼고 경고.
pub(crate) fn parse(content: &str) -> ConnList {
    let mut warnings = Vec::new();
    let items: Vec<serde_json::Value> = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(e) => {
            return ConnList {
                conns: Vec::new(),
                warnings: vec![tr!(
                    ko: "db-connections.json 을 읽지 못했습니다 — DB 연결 없이 진행합니다: {e}",
                    en: "Could not read db-connections.json — going on without database connections: {e}"
                )],
            }
        }
    };
    let mut conns: Vec<DbConn> = Vec::new();
    for (i, item) in items.into_iter().enumerate() {
        let n = i + 1;
        if conns.len() == CONNS_MAX {
            warnings.push(tr!(
                ko: "db-connections.json: 연결이 {max}개를 넘습니다 — 뒤쪽은 무시합니다",
                en: "db-connections.json: more than {max} connections — ignoring the rest",
                max = CONNS_MAX,
            ));
            break;
        }
        let checked = serde_json::from_value::<DbConn>(item)
            .map_err(|e| e.to_string())
            .and_then(|d| validate_one(&d));
        match checked {
            Ok(d) if conns.iter().any(|p| p.id == d.id) => warnings.push(tr!(
                ko: "db-connections.json: {n}번째 연결의 id '{id}' 가 이미 쓰입니다 — 무시합니다",
                en: "db-connections.json: the id '{id}' of entry {n} is already in use — ignoring it",
                id = d.id,
            )),
            Ok(d) => conns.push(d),
            Err(why) => warnings.push(tr!(
                ko: "db-connections.json: {n}번째 연결을 무시합니다: {why}",
                en: "db-connections.json: ignoring entry {n}: {why}"
            )),
        }
    }
    ConnList { conns, warnings }
}

pub(crate) fn load_at(path: &Path) -> Result<ConnList, String> {
    match crate::app_state::load_at(path)? {
        Some(content) => Ok(parse(&content)),
        None => Ok(ConnList {
            conns: Vec::new(),
            warnings: Vec::new(),
        }),
    }
}

pub(crate) fn save_at(path: &Path, list: &[DbConn]) -> Result<Vec<DbConn>, String> {
    let clean = validate_list(list)?;
    let json = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    crate::app_state::save_at(path, &json)?;
    Ok(clean)
}

/// 읽기가 뺀 줄(깨진 줄)은 저장하면 사라진다 — 알고 받은 한계.
pub(crate) fn rename_via_at(path: &Path, from: &str, to: &str) -> Result<usize, String> {
    let (from, to) = (from.trim(), to.trim());
    if from == to || to.is_empty() {
        return Ok(0);
    }
    let mut list = load_at(path)?.conns;
    let mut n = 0;
    for d in list.iter_mut().filter(|d| d.via.as_deref().is_some_and(|v| same_alias(v, from))) {
        d.via = Some(to.to_string());
        n += 1;
    }
    if n > 0 {
        save_at(path, &list)?;
    }
    Ok(n)
}

/// 그 볼트 비밀번호를 걷는 것은 프런트다.
pub(crate) fn remove_via_at(path: &Path, host: &str) -> Result<Vec<String>, String> {
    let list = load_at(path)?.conns;
    let (gone, keep): (Vec<DbConn>, Vec<DbConn>) =
        list.into_iter().partition(|d| d.via.as_deref().is_some_and(|v| same_alias(v, host)));
    if !gone.is_empty() {
        save_at(path, &keep)?;
    }
    Ok(gone.into_iter().map(|d| d.id).collect())
}

/// GUI 가 보낸 값을 믿지 않고 파일에서 그 id 의 줄을 찾는다. 블로킹(디스크).
pub(crate) fn find(id: &str) -> Result<DbConn, String> {
    let path = path().ok_or_else(crate::app_state::missing_dir)?;
    let list = load_at(&path)?;
    list.conns.into_iter().find(|d| d.id == id).ok_or_else(|| {
        tr!(
            ko: "DB 연결 '{id}' 을(를) 찾지 못했습니다 — 목록에서 지워졌거나 바뀌었습니다",
            en: "Could not find the database connection '{id}' — it was removed or changed"
        )
    })
}

/// `config_root()/db-folders.json` — 비밀이 없고 서버는 읽지 않는다. 내용은 불투명 문자열(스키마는 프런트 `db-folders.ts` 의 `parseDbFolderMeta`).
pub(crate) fn folders_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("db-folders.json"))
}

// ── GUI Tauri 명령 ──

#[tauri::command]
pub async fn db_folders_load() -> Result<Option<String>, String> {
    let path = folders_path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_state::load_at(&path))
        .await
        .map_err(|e| tr!(ko: "DB 폴더 정보를 읽는 작업이 실패했습니다: {e}", en: "The task that reads the database folders failed: {e}"))?
}

#[tauri::command]
pub async fn db_folders_save(json: String) -> Result<(), String> {
    let path = folders_path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_state::save_at(&path, &json).map(|_| ()))
        .await
        .map_err(|e| tr!(ko: "DB 폴더 정보를 쓰는 작업이 실패했습니다: {e}", en: "The task that writes the database folders failed: {e}"))?
}

#[tauri::command]
pub async fn db_conn_list() -> Result<ConnList, String> {
    let path = path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| tr!(ko: "DB 연결 목록을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the database connections failed: {e}"))?
}

/// 목록에서 빠진 연결의 AI 권한 · 접속 기록도 지운다 — 같은 id 가 나중에 다른 DB 로 다시 쓰여도 옛 권한이 붙지 않게. 실패는 저장을
/// 되돌리지 않는다(그 블록은 스냅샷이 어긋나 끔으로 읽힌다).
#[tauri::command]
pub async fn db_conn_save(app: tauri::AppHandle, conns: Vec<DbConn>) -> Result<Vec<DbConn>, String> {
    let path = path().ok_or_else(crate::app_state::missing_dir)?;
    let (saved, forgot, history) = tauri::async_runtime::spawn_blocking(move || {
        let before: Vec<String> = load_at(&path).map(|l| l.conns.into_iter().map(|d| d.id).collect()).unwrap_or_default();
        let saved = save_at(&path, &conns)?;
        let gone: Vec<String> = before.into_iter().filter(|id| !saved.iter().any(|d| &d.id == id)).collect();
        let forgot = crate::delegation::database::forget_databases(&gone).unwrap_or(0);
        let history = crate::db_history::forget_ids(&gone).unwrap_or(false);
        Ok::<_, String>((saved, forgot, history))
    })
    .await
    .map_err(|e| tr!(ko: "DB 연결 목록을 쓰는 작업이 실패했습니다: {e}", en: "The task that writes the database connections failed: {e}"))??;
    use tauri::Emitter;
    if forgot > 0 {
        let _ = app.emit(crate::delegation::CHANGED_EVENT, ());
    }
    if history {
        let _ = app.emit(crate::db_history::CHANGED_EVENT, ());
    }
    Ok(saved)
}
