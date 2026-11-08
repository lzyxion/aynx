//! **DB 연결 목록 하나** — `instance::config_root()/db-connections.json`(앱 소유 · 원자 저장 `app_state::save_at`).
//! 쿼리 타일이 붙을 DB 전부가 여기 산다 — SSH 경유(`via` = 호스트 별칭)도 직접(`via` 없음)도(10-13 사용자 결정: 예전의
//! `sessions.toml` 호스트 블록 `dbs` 와 `db-local.json` 을 이 파일 하나로 합쳤다 — docs/log/2026-10-12-query-tile.md).
//!
//! ```json
//! [{ "id": "Xk3_local-01", "name": "앱 DB", "engine": "sqlite", "path": "C:\\data\\app.db" },
//!  { "id": "Qp9-pg-dev01", "name": "prod", "engine": "postgres", "via": "web-01", "host": "localhost", "port": 5432,
//!    "database": "app", "user": "readonly", "tls_mode": "prefer", "folder": "운영/웹" }]
//! ```
//!
//! - **비밀이 없다** — 비밀번호 칸이 아예 없고(볼트 `db_password` 의 열쇠가 `id`), 사람이 적어 둔 `password` 키는 읽지 않는다.
//! - **누가 쓰나**: GUI 의 Tauri 명령([`db_conn_list`]·[`db_conn_save`])이 이 파일을 직접 읽고 쓴다 — 비밀이 없어 서버를 거칠
//!   까닭이 없고(`sessions.toml` 과 같은 관례), 같은 exe·같은 사용자의 두 프로세스가 같은 `config_root` 를 본다. **서버는 연결을 열
//!   때 이 파일을 직접 다시 읽는다**([`find`]) — GUI 가 보낸 경로·주소·경유를 믿지 않는다(`db_open` 몸은 id 참조뿐).
//! - **id 는 볼트 열쇠** — 규칙은 `vault::db_conn_id_ok` 하나, 파일 안에서 겹치지 않는다(쓰기 거절 · 읽기는 뒤 줄을 빼고 경고).
//! - `via` 가 있으면 그 호스트(`~/.ssh/config` 별칭)의 공유 SSH 전송로 + 터널로 가고 `host` 는 **그 호스트에서 본** 주소다. 없으면
//!   이 PC 에서 바로 붙는다. **SQLite 는 직접만**(원격 SQLite 미지원 — `via` 가 있으면 거절) · `path` 필수(절대 경로).
//!   PG·MySQL·MariaDB 는 host·port 필수 — 직접 원격도 받는다(9단계). 검증하지 않는 TLS 모드로 직접 원격에 붙는 위험은 막지 않고
//!   **폼이 밝힌다**(프런트 `query/conn-form.ts` 의 `directTlsWarning` — 경유면 SSH 가 감싸 경고 없음).
//! - **호스트 이름 변경·삭제를 따라간다**: 별칭을 바꾸면 `via` 가 새 이름으로([`rename_via_at`] — `config_edit::edit_host`), 호스트를
//!   지우면 그 호스트를 경유하던 연결도 지운다([`remove_via_at`] — `config_edit::remove_host`. 볼트 비밀번호 걷기는 프런트 몫).
//! - **`folder` 는 독의 폴더 자리일 뿐이다**(10-15 — 호스트의 `group` 과 같은 `"a/b"` 경로 문자열 · 없으면 최상위). 접속 · AI 권한
//!   신원 스냅샷(`delegation::database::DbIdentity`)은 이 칸을 보지 않는다 — 폴더를 옮겨도 권한이 풀리지 않는다. 이 칸을 모르는
//!   옛 판 세션 서버도 serde 가 모르는 키를 건너뛰어 그대로 읽는다(서버는 이 파일을 쓰지 않는다). 폴더의 아이콘 · 색과 빈 폴더는
//!   이 파일이 아니라 곁 파일 `db-folders.json`([`db_folders_load`] — 호스트의 `[groups]` 처럼 따로)이다.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::i18n::tr;

/// 목록 상한(경유 · 직접 합쳐서 — 예전 호스트당 32 + 직접 64 를 한 파일로).
pub(crate) const CONNS_MAX: usize = 64;
const NAME_MAX: usize = 64;
/// 경유 호스트 별칭의 글자 수 상한.
const VIA_MAX: usize = 255;
/// 폴더 경로의 글자 수 상한.
const FOLDER_MAX: usize = 255;

/// DB 엔진. 파일·프런트에는 소문자 그대로(`"postgres"` · `"mysql"` · `"mariadb"` · `"sqlite"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
}

/// TLS 모드 — libpq 이름 그대로(`disable` · `prefer` · `require` · `verify-ca` · `verify-full`). 없으면 `prefer`.
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
    /// **`verify-ca` 는 CA 파일만 믿는다**(10-12 사용자 결정 — libpq · pgJDBC · mysql CLI 의 verify-ca 와 같은 뜻: 공개 CA +
    /// 이름 무시는 사실상 검증이 없다). 그래서 그 모드에 CA 파일이 비어 있으면 — 쓰기는 저장을 거절하고([`validate_list`]),
    /// 이미 파일에 있는 줄(읽기는 관대)은 접속 때 같은 문구로 실패한다(`db::tls`). **순수.**
    pub(crate) fn check_ca(self, ca: Option<&str>) -> Result<(), String> {
        if self == Self::VerifyCa && ca.map(str::trim).is_none_or(str::is_empty) {
            return Err(verify_ca_needs_ca());
        }
        Ok(())
    }
}

/// [`DbTlsMode::check_ca`] 의 문구.
pub(crate) fn verify_ca_needs_ca() -> String {
    tr!(
        ko: "CA 검증은 CA 파일이 필요합니다. 공개 인증서를 쓰는 서버라면 CA+이름 검증을 고르세요.",
        en: "Verify CA needs a CA file. If the server uses a public certificate, choose Verify CA and name."
    )
}

/// 연결 하나(비밀 없음).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DbConn {
    pub id: String,
    pub name: String,
    pub engine: DbEngine,
    /// 경유 호스트 별칭(`~/.ssh/config`) — `None` = 직접. SQLite 는 늘 없음.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    /// SQLite 파일(절대 경로) — SQLite 만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// DB 주소 — 경유면 **그 호스트에서 본** 주소.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// SQLite 는 쓰지 않는다(늘 없음). 네트워크 엔진은 파일에 **늘 적는다**(보안 선택이 파일에서 보이게).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_mode: Option<DbTlsMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_ca: Option<String>,
    /// 독의 폴더(`"운영/웹"` — `/` 로 나눈 경로) — `None` = 최상위. 접속 · 신원 스냅샷과 무관하다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

/// [`db_conn_list`] 의 답 — 목록과 읽기 경고(뺀 줄마다 한 줄).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnList {
    pub conns: Vec<DbConn>,
    pub warnings: Vec<String>,
}

/// 파일 자리 바꾸기(세션 서버 시험 — `serve::Config::db_conns`). `None` 이면 `config_root()/db-connections.json`.
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

/// 앞뒤 공백을 떼고 비면 `None`, 제어 글자는 거절.
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

/// 별칭 비교 — ssh config 별칭 맞추기와 같은 눈(대소문자 무시 · `ssh::params::resolve_params`).
pub(crate) fn same_alias(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// 폴더 경로를 다듬는다 — 조각마다 앞뒤 공백을 떼고 빈 조각(`"a//b"` · `"/a"`)을 버린다. 다 비면 `None`(최상위). 제어 문자 ·
/// 상한 초과는 거절. 프런트 `host-folders.ts` 의 `normalizeGroupPath` 와 같은 꼴.
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

/// 한 줄을 검사하고 다듬은 줄을 돌려준다 — 읽기·쓰기가 같은 규칙. 겹침·개수는 목록 쪽이 본다.
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

/// 저장 전 검사 — **한 줄이라도 틀리면 통째로 거절**(파일에 한 글자도 닿지 않는다).
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

/// 파일 내용을 읽는다 — **줄마다 관대하게**(깨진 줄·겹친 id 는 그 줄만 빼고 경고). 파일 전체가 JSON 배열이 아니면 빈 목록 +
/// 경고 한 줄.
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

/// 경로에서 읽는다 — 파일이 없으면 빈 목록.
pub(crate) fn load_at(path: &Path) -> Result<ConnList, String> {
    match crate::app_state::load_at(path)? {
        Some(content) => Ok(parse(&content)),
        None => Ok(ConnList {
            conns: Vec::new(),
            warnings: Vec::new(),
        }),
    }
}

/// 검사한 뒤 경로에 원자 저장 — 다듬은 목록을 돌려준다.
pub(crate) fn save_at(path: &Path, list: &[DbConn]) -> Result<Vec<DbConn>, String> {
    let clean = validate_list(list)?;
    let json = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    crate::app_state::save_at(path, &json)?;
    Ok(clean)
}

/// **호스트 별칭 변경을 따라간다** — `via` 가 `from` 인 줄(대소문자 무시)을 `to` 로 고쳐 저장하고 고친 줄 수를 돌려준다.
/// 고칠 줄이 없으면(파일이 없는 경우 포함) 파일에 닿지 않는다. 읽기가 뺀 줄(깨진 줄)은 저장하면 사라진다 — 목록 편집과 같은
/// 알고 받은 한계. 부르는 곳은 `config_edit::edit_host`(블로킹 풀).
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

/// **호스트 삭제를 따라간다** — `via` 가 `host` 인 줄(대소문자 무시)을 지우고 지운 id 들을 돌려준다(그 볼트 비밀번호를 걷는 것은
/// 프런트 — 볼트가 열려 있을 때만). 지울 줄이 없으면 파일에 닿지 않는다. 부르는 곳은 `config_edit::remove_host`(블로킹 풀).
pub(crate) fn remove_via_at(path: &Path, host: &str) -> Result<Vec<String>, String> {
    let list = load_at(path)?.conns;
    let (gone, keep): (Vec<DbConn>, Vec<DbConn>) =
        list.into_iter().partition(|d| d.via.as_deref().is_some_and(|v| same_alias(v, host)));
    if !gone.is_empty() {
        save_at(path, &keep)?;
    }
    Ok(gone.into_iter().map(|d| d.id).collect())
}

/// **서버가 연결을 열 때** — 파일에서 그 id 의 줄을 찾는다(GUI 가 보낸 값을 믿지 않는다). 블로킹(디스크).
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

/// **독 DB 칸의 폴더 곁 파일** — `config_root()/db-folders.json`. 폴더 경로 → 아이콘 · 색(호스트 독의 `sessions.toml` `[groups]` 와
/// 같은 몫 — 빈 폴더의 존재 증거이기도 하다). 비밀이 없고 서버는 읽지 않는다. 내용은 불투명 문자열(`theme-profiles.json` 과 같은
/// 관례 — 스키마는 프런트 `db-folders.ts` 의 `parseDbFolderMeta` 가 본다).
pub(crate) fn folders_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("db-folders.json"))
}

// ---------------------------------------------------------------------------
// GUI Tauri 명령 — 모두 async + spawn_blocking(디스크)
// ---------------------------------------------------------------------------

/// 폴더 곁 파일([`folders_path`])을 읽는다 — 없으면 `None`.
#[tauri::command]
pub async fn db_folders_load() -> Result<Option<String>, String> {
    let path = folders_path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_state::load_at(&path))
        .await
        .map_err(|e| tr!(ko: "DB 폴더 정보를 읽는 작업이 실패했습니다: {e}", en: "The task that reads the database folders failed: {e}"))?
}

/// 폴더 곁 파일을 통째로 쓴다(원자 저장 · 같은 내용이면 생략).
#[tauri::command]
pub async fn db_folders_save(json: String) -> Result<(), String> {
    let path = folders_path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_state::save_at(&path, &json).map(|_| ()))
        .await
        .map_err(|e| tr!(ko: "DB 폴더 정보를 쓰는 작업이 실패했습니다: {e}", en: "The task that writes the database folders failed: {e}"))?
}

/// DB 연결 목록과 읽기 경고.
#[tauri::command]
pub async fn db_conn_list() -> Result<ConnList, String> {
    let path = path().ok_or_else(crate::app_state::missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| tr!(ko: "DB 연결 목록을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the database connections failed: {e}"))?
}

/// 목록 전체를 저장한다(전체 교체) — 다듬은 목록을 돌려준다. 목록에서 빠진 연결의 AI 권한(`delegation.toml` `[[database]]`)도 지운다
/// (쿼리 타일 3a — 같은 id 가 나중에 다른 DB 로 다시 쓰여도 옛 권한이 붙지 않게. 실패는 저장을 되돌리지 않는다 — 그 블록은 스냅샷이
/// 어긋나 끔으로 읽히고 설정 › 보안 표에 고아로 보인다). 접속 기록(`crate::db_history` — 독 DB 칸 "최근")의 그 줄도 같이 걷는다.
#[tauri::command]
pub async fn db_conn_save(app: tauri::AppHandle, conns: Vec<DbConn>) -> Result<Vec<DbConn>, String> {
    let path = path().ok_or_else(crate::app_state::missing_dir)?;
    let (saved, forgot, history) = tauri::async_runtime::spawn_blocking(move || {
        let before: Vec<String> = load_at(&path).map(|l| l.conns.into_iter().map(|d| d.id).collect()).unwrap_or_default();
        let saved = save_at(&path, &conns)?;
        let gone: Vec<String> = before.into_iter().filter(|id| !saved.iter().any(|d| &d.id == id)).collect();
        let forgot = crate::delegation::database::forget_databases(&gone).unwrap_or(0);
        // 빠진 연결의 접속 기록(`db-history.json`)도 — 같은 이유(같은 id 가 다른 DB 로 다시 쓰여도 옛 시각이 붙지 않게). 실패는 무해하다.
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
