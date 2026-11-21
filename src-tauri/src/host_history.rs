//! 호스트별 접속 이력 — `<config_dir>/aynx/history.json` (docs/log/2026-09-23-host-history.md). 백엔드만 쓰고 프런트는 읽기만 한다.
//!
//! 비밀번호·암호구·키 파일 경로·명령 글자는 **한 글자도** 담지 않는다 — 인증 계열 사유에는 한 줄을 남기지 않고, 경로처럼
//! 보이는 조각은 가린다([`short_message`]).
//!
//! 사용자 타일의 접속만 적는다 — 헤드리스 위임 접속을 적으면 AI 가 밤새 붙은 호스트가 "최근" 맨 위로 올라온다.
//! 깨진 파일은 빈 표로 시작한다 — 이력은 편의값이라 접속을 막지 않는다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;
use crate::ssh::{OpenCause, SshOpenError};

pub const CHANGED_EVENT: &str = "host-history-changed";

const MESSAGE_CAP: usize = 160;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HostHistoryEntry {
    #[serde(default)]
    pub last_ok_at: Option<u64>,
    #[serde(default)]
    pub last_fail_at: Option<u64>,
    /// [`OpenCause`] 의 snake_case 글자.
    #[serde(default)]
    pub last_fail_cause: Option<String>,
    #[serde(default)]
    pub last_fail_message: Option<String>,
    /// **성공한** 접속 수 (실패는 세지 않는다).
    #[serde(default)]
    pub count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HistoryFile {
    #[serde(default)]
    pub hosts: BTreeMap<String, HostHistoryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Fail {
        cause: OpenCause,
        message: Option<String>,
    },
}

fn history_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("history.json"))
}

/// 읽고-고치고-쓰는 한 벌을 **한 번에 하나만** 돌린다 — 없으면 동시에 끝난 두 접속 중 먼저 쓴 줄이 덮인다.
static FILE_LOCK: Mutex<()> = Mutex::new(());

static WARNED: AtomicBool = AtomicBool::new(false);

pub(crate) fn load_file(path: &Path) -> HistoryFile {
    let warn_once = |what: String| {
        if !WARNED.swap(true, Ordering::Relaxed) {
            eprintln!("[aynx] history.json 을 쓸 수 없어 빈 이력으로 시작합니다: {what}");
        }
    };
    match load_at(path) {
        Ok(None) => HistoryFile::default(),
        Ok(Some(raw)) => serde_json::from_str::<HistoryFile>(&raw).unwrap_or_else(|e| {
            warn_once(e.to_string());
            HistoryFile::default()
        }),
        Err(e) => {
            warn_once(e);
            HistoryFile::default()
        }
    }
}

fn write_file(path: &Path, file: &HistoryFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    save_at(path, &json).map(|_| ())
}

pub(crate) fn apply(file: &mut HistoryFile, alias: &str, now: u64, outcome: &Outcome) {
    let alias = alias.trim();
    if alias.is_empty() {
        return;
    }
    let entry = file.hosts.entry(alias.to_string()).or_default();
    match outcome {
        Outcome::Ok => {
            entry.last_ok_at = Some(now);
            entry.count = entry.count.saturating_add(1);
        }
        Outcome::Fail { cause, message } => {
            entry.last_fail_at = Some(now);
            entry.last_fail_cause = Some(cause_code(*cause));
            entry.last_fail_message = message.as_deref().and_then(short_message);
        }
    }
}

/// 별칭 비교는 저장소 전체에서 **대소문자를 무시한다** (`favorites.ts` 의 `withRenamedHost` 와 같은 규칙).
fn find_key(file: &HistoryFile, alias: &str) -> Option<String> {
    let want = alias.trim().to_lowercase();
    if want.is_empty() {
        return None;
    }
    file.hosts
        .keys()
        .find(|k| k.to_lowercase() == want)
        .cloned()
}

pub(crate) fn forget(file: &mut HistoryFile, alias: &str) -> bool {
    match find_key(file, alias) {
        Some(k) => file.hosts.remove(&k).is_some(),
        None => false,
    }
}

/// 이름이 바뀐 별칭을 따라간다. 새 이름에 이미 이력이 있으면 합친다(시각은 늦은 쪽, 횟수는 더한다).
pub(crate) fn rename(file: &mut HistoryFile, from: &str, to: &str) -> bool {
    let to = to.trim();
    if to.is_empty() {
        return false;
    }
    let Some(old_key) = find_key(file, from) else {
        return false;
    };
    if old_key == to {
        return false;
    }
    let Some(old) = file.hosts.remove(&old_key) else {
        return false;
    };
    let merged = match find_key(file, to).and_then(|k| file.hosts.remove(&k)) {
        None => old,
        Some(cur) => merge(old, cur),
    };
    file.hosts.insert(to.to_string(), merged);
    true
}

fn merge(a: HostHistoryEntry, b: HostHistoryEntry) -> HostHistoryEntry {
    let (fail_at, cause, message) = if a.last_fail_at >= b.last_fail_at {
        (a.last_fail_at, a.last_fail_cause, a.last_fail_message)
    } else {
        (b.last_fail_at, b.last_fail_cause, b.last_fail_message)
    };
    HostHistoryEntry {
        last_ok_at: a.last_ok_at.max(b.last_ok_at),
        last_fail_at: fail_at,
        last_fail_cause: cause,
        last_fail_message: message,
        count: a.count.saturating_add(b.count),
    }
}

/// serde 표현을 그대로 쓴다 — 프런트 `OpenCause` 와 같은 표.
fn cause_code(cause: OpenCause) -> String {
    serde_json::to_value(cause)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "other".to_string())
}

/// 파일에 남길 짧은 한 줄 — 오류 문구에 설정 파일 경로가 섞여 올 수 있어 경로처럼 보이는 조각을 가린다.
pub(crate) fn short_message(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let joined = line
        .split(' ')
        .map(|tok| if looks_like_path(tok) { "…" } else { tok })
        .collect::<Vec<_>>()
        .join(" ");
    if joined.chars().count() <= MESSAGE_CAP {
        return Some(joined);
    }
    let mut out: String = joined.chars().take(MESSAGE_CAP - 1).collect();
    out.push('…');
    Some(out)
}

fn looks_like_path(tok: &str) -> bool {
    let t = tok.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | ',' | ':' | '`'));
    let b = t.as_bytes();
    if b.len() < 2 {
        return false;
    }
    t.contains('\\')
        || t.starts_with('/')
        || t.starts_with('~')
        || (b[1] == b':' && b[0].is_ascii_alphabetic())
}

/// 접속 결과 → 적을 사건. 적지 않는 것은 `None`.
///
/// 비밀번호·암호구·호스트 키 질문은 재시도 계약의 한 걸음이라 실패가 아니다 — 적으면 잠긴 키 호스트는 접속마다 실패가 찍힌다.
pub(crate) fn outcome_of<T>(result: &Result<T, SshOpenError>) -> Option<Outcome> {
    match result {
        Ok(_) => Some(Outcome::Ok),
        // 사람이 타일을 닫아 멈춘 것(`crate::remote_worktree` 의 질문을 기다리던 중)은 접속의 성패가 아니다.
        Err(SshOpenError::Other { message, .. }) if crate::errors::is_cancelled(message) => None,
        Err(SshOpenError::Auth { diag, .. }) => Some(Outcome::Fail {
            cause: diag.cause,
            message: None,
        }),
        Err(SshOpenError::Other { message, diag }) => Some(Outcome::Fail {
            cause: diag.cause,
            message: if is_auth_cause(diag.cause) || diag.inner.is_some_and(is_auth_cause) {
                None
            } else {
                Some(message.clone())
            },
        }),
        Err(_) => None,
    }
}

fn is_auth_cause(c: OpenCause) -> bool {
    matches!(
        c,
        OpenCause::AuthKeyRejected
            | OpenCause::KeyFileUnreadable
            | OpenCause::AuthPasswordRejected
            | OpenCause::AuthNoMethod
    )
}

// ---------------------------------------------------------------------------
// 기록
// ---------------------------------------------------------------------------

/// 사건 하나를 블로킹 풀에서 적고 이벤트를 쏜다 — 기다리지 않는다. 실패는 로그 한 줄로 끝난다(이력을 못 적었다고 접속을 실패로 보이지 않는다).
/// 세션 서버에서 불린다 — 이벤트는 서버 이벤트로 나가고 GUI 가 같은 이름의 Tauri 이벤트로 중계한다.
pub(crate) fn record(alias: &str, outcome: Outcome) {
    let Some(path) = history_path() else {
        return;
    };
    let alias = alias.to_string();
    let now = now_ms();
    drop(tokio::task::spawn_blocking(move || {
        let wrote = modify(&path, |file| {
            apply(file, &alias, now, &outcome);
            true
        });
        match wrote {
            Ok(_) => crate::server::hub::emit(CHANGED_EVENT, serde_json::Value::Null),
            Err(e) => crate::server::log::line(format!("host history write failed (ignored): {e}")),
        }
    }));
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn modify(path: &Path, f: impl FnOnce(&mut HistoryFile) -> bool) -> Result<bool, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut file = load_file(path);
    if !f(&mut file) {
        return Ok(false);
    }
    write_file(path, &file)?;
    Ok(true)
}

async fn run_modify(
    app: AppHandle,
    f: impl FnOnce(&mut HistoryFile) -> bool + Send + 'static,
) -> Result<(), String> {
    let path = history_path().ok_or_else(missing_dir)?;
    let changed = tauri::async_runtime::spawn_blocking(move || modify(&path, f))
        .await
        .map_err(|e| {
            tr!(
                ko: "접속 이력을 고치는 작업이 실패했습니다: {e}",
                en: "The task that updates the connection history failed: {e}"
            )
        })??;
    if changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 파일이 없거나 깨졌으면 빈 표다(오류가 아니다).
#[tauri::command]
pub async fn host_history_list() -> Result<BTreeMap<String, HostHistoryEntry>, String> {
    let path = history_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_file(&path).hosts)
        .await
        .map_err(|e| {
            tr!(
                ko: "접속 이력을 읽는 작업이 실패했습니다: {e}",
                en: "The task that reads the connection history failed: {e}"
            )
        })
}

#[tauri::command]
pub async fn host_history_clear(app: AppHandle) -> Result<(), String> {
    run_modify(app, |file| {
        let had = !file.hosts.is_empty();
        file.hosts.clear();
        had
    })
    .await
}

#[tauri::command]
pub async fn host_history_forget(app: AppHandle, alias: String) -> Result<(), String> {
    run_modify(app, move |file| forget(file, &alias)).await
}

#[tauri::command]
pub async fn host_history_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    run_modify(app, move |file| rename(file, &from, &to)).await
}

#[cfg(test)]
mod tests;
