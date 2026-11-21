//! DB 연결별 접속 기록 — `<설정 루트>/db-history.json`(`db-connections.json` 곁). 독 DB 칸의 "최근" 정렬이 읽는 작은 표다.
//!
//! ## 담지 않는 것
//!
//! SQL · 비밀번호 · 결과 · 오류 글 · 주소 · 경로는 한 글자도 들어오지 않는다 — 열쇠는 연결 id, 값은 시각과 횟수뿐이다. 실패는 적지
//! 않는다(오류 글에는 식별자가 섞인다).
//!
//! ## 무엇을 적고 무엇을 적지 않나
//!
//! - 사람이 쿼리 타일에서 엔진을 새로 열었을 때만 적는다(서버 op `db_open`). 같은 stream 에 다시 붙기는 접속이 아니다.
//! - AI 전용 연결(`db::ai` · `db::ai_write`)은 적지 않는다 — 적으면 AI 가 밤새 읽은 DB 가 "최근" 맨 위로 올라와 사람의 기억과 어긋난다.
//! - 연결을 지우면 그 줄도 지운다 — 같은 id 가 나중에 다른 DB 로 다시 쓰여도 옛 시각이 붙지 않게.
//!
//! 없거나 깨진 파일은 빈 표로 시작하고 콘솔에 한 번만 남긴다 — 접속을 막을 이유가 없다. 쓰는 프로세스가 둘(적기 = 세션 서버 · 지우기 =
//! GUI)이고 [`FILE_LOCK`] 은 프로세스마다라 같은 순간 겹치면 시각 한 줄을 잃을 수 있다 — 알고 받은 한계.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// GUI 가 같은 이름의 Tauri 이벤트로 중계한다(`server::client::RELAYED`).
pub const CHANGED_EVENT: &str = "db-history-changed";

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DbHistoryEntry {
    /// 마지막으로 성공한 접속(Unix ms).
    #[serde(default)]
    pub last_ok_at: Option<u64>,
    #[serde(default)]
    pub count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DbHistoryFile {
    #[serde(default)]
    pub conns: BTreeMap<String, DbHistoryEntry>,
}

fn history_path() -> Option<PathBuf> {
    Some(crate::db::conns::path()?.with_file_name("db-history.json"))
}

/// 두 타일이 같은 순간 열기를 끝내도 줄이 덮이지 않게 — 프로세스 사이는 머리말의 알고 받은 한계.
static FILE_LOCK: Mutex<()> = Mutex::new(());

static WARNED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// 순수 조작
// ---------------------------------------------------------------------------

pub(crate) fn load_file(path: &Path) -> DbHistoryFile {
    let warn_once = |what: String| {
        if !WARNED.swap(true, Ordering::Relaxed) {
            eprintln!("[aynx] db-history.json 을 쓸 수 없어 빈 기록으로 시작합니다: {what}");
        }
    };
    match load_at(path) {
        Ok(None) => DbHistoryFile::default(),
        Ok(Some(raw)) => serde_json::from_str::<DbHistoryFile>(&raw).unwrap_or_else(|e| {
            warn_once(e.to_string());
            DbHistoryFile::default()
        }),
        Err(e) => {
            warn_once(e);
            DbHistoryFile::default()
        }
    }
}

fn write_file(path: &Path, file: &DbHistoryFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    save_at(path, &json).map(|_| ())
}

/// 연결 id 모양이 아니면 아무것도 하지 않는다(파일에 엉뚱한 열쇠가 서지 않게).
pub(crate) fn apply_ok(file: &mut DbHistoryFile, id: &str, now: u64) -> bool {
    if !crate::vault::db_conn_id_ok(id) {
        return false;
    }
    let entry = file.conns.entry(id.to_string()).or_default();
    entry.last_ok_at = Some(now);
    entry.count = entry.count.saturating_add(1);
    true
}

/// 연결 id 는 대소문자를 가린다 — 볼트 열쇠와 같다.
pub(crate) fn forget(file: &mut DbHistoryFile, ids: &[String]) -> bool {
    let mut any = false;
    for id in ids {
        any |= file.conns.remove(id).is_some();
    }
    any
}

fn modify(path: &Path, f: impl FnOnce(&mut DbHistoryFile) -> bool) -> Result<bool, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut file = load_file(path);
    if !f(&mut file) {
        return Ok(false);
    }
    write_file(path, &file)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// 적기 — 세션 서버의 `db_open` 이 부른다
// ---------------------------------------------------------------------------

/// 기다리지 않는다 — 기록을 못 적었다고 성공한 접속을 실패로 보일 수 없다(실패는 서버 로그 한 줄).
pub(crate) fn record_ok(id: &str) {
    let Some(path) = history_path() else {
        return;
    };
    let id = id.to_string();
    let now = now_ms();
    drop(tokio::task::spawn_blocking(move || match modify(&path, |file| apply_ok(file, &id, now)) {
        Ok(true) => crate::server::hub::emit(CHANGED_EVENT, serde_json::Value::Null),
        Ok(false) => {}
        Err(e) => crate::server::log::line(format!("db history write failed (ignored): {e}")),
    }));
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 지우기 — 부르는 쪽이 이미 블로킹 풀 안이다
// ---------------------------------------------------------------------------

/// 걷은 것이 있으면 `true`(부르는 쪽이 이벤트를 쏠지 정한다). 실패는 무해하다 — 남은 줄은 목록에 없는 id 라 독에 서지 않는다.
pub(crate) fn forget_ids(ids: &[String]) -> Result<bool, String> {
    if ids.is_empty() {
        return Ok(false);
    }
    let path = history_path().ok_or_else(missing_dir)?;
    modify(&path, |file| forget(file, ids))
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn db_history_list() -> Result<BTreeMap<String, DbHistoryEntry>, String> {
    let path = history_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_file(&path).conns)
        .await
        .map_err(|e| {
            tr!(
                ko: "DB 접속 기록을 읽는 작업이 실패했습니다: {e}",
                en: "The task that reads the database connection history failed: {e}"
            )
        })
}

#[cfg(test)]
mod tests;
