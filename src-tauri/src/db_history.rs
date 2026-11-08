//! DB 연결별 접속 기록 — `<설정 루트>/db-history.json`(`db-connections.json` 곁 — 2026-10-20).
//!
//! 독 DB 칸의 "최근" 정렬이 읽는 **작은 표**다(본보기 `host_history.rs`). 연결 id 마다 두 칸뿐이다 — 마지막 성공 시각 ·
//! 성공 횟수.
//!
//! ## 담지 않는 것
//!
//! SQL · 비밀번호 · 결과 · 오류 글 · 주소 · 경로는 **한 글자도** 들어오지 않는다. 열쇠는 연결 id(볼트 `db_password` 의 대상과
//! 같은 글자 — `vault::db_conn_id_ok` 모양)이고 값은 시각과 횟수다. 실패는 적지 않는다 — 호스트 이력의 실패 칸은 말풍선의
//! 진단 한 줄 때문인데, DB 독에는 그 자리가 없고 오류 글에는 식별자가 섞인다.
//!
//! ## 무엇을 적고 무엇을 적지 않나
//!
//! - **사람이 쿼리 타일에서 연결에 성공했을 때만** 적는다 — 서버 op `db_open` 이 엔진을 **새로** 열었을 때
//!   (`server::db_ops::handle`). 같은 stream 에 다시 붙기(F5 · 웹뷰 크래시 · 이관 · `reattachOnly`)는 접속이 아니라 적지 않는다.
//! - **AI 전용 연결은 적지 않는다** — MCP DB 도구의 읽기 풀(`db::ai`) · 작업안 실행의 쓰기 연결(`db::ai_write`)은 `db_open` 을
//!   지나지 않고 엔진을 따로 연다. 앱(AI)이 스스로 한 일이지 사람이 한 일이 아니다 — 적으면 AI 가 밤새 읽은 DB 가 "최근" 맨 위로
//!   올라와 사람의 기억과 어긋난다(헤드리스 접속을 `history.json` 에서 빼는 것과 같은 이유).
//! - **연결을 지우면 그 줄도 지운다** — 목록 저장(`db::conns::db_conn_save` — 빠진 id) · 호스트 삭제(`config_edit::remove_host` —
//!   그 호스트를 경유하던 연결). 같은 id 가 나중에 다른 DB 로 다시 쓰여도 옛 시각이 붙지 않게.
//!
//! ## 파일 관례
//!
//! `history.json` 과 같은 원자적 쓰기([`crate::app_state::save_at`]) · 백엔드가 스키마를 안다(프런트는 읽기만 —
//! `app/db-history.svelte.ts`). 자리는 **`db-connections.json` 의 곁**([`crate::db::conns::path`] — `instance::config_root` 를 거쳐 개발 ·
//! 릴리스가 갈린다. 세션 서버 시험은 그 목록 자리를 임시 폴더로 바꾸므로 기록도 따라간다). 없거나 깨진 파일은 빈 표로 시작하고
//! 콘솔에 **한 번만** 남긴다 — 기록은 없어도 되는 편의값이라 접속을 막을 이유가 없다.
//!
//! **쓰는 프로세스가 둘이다** — 적기는 세션 서버(DB 연결이 서버에 산다), 지우기 · 읽기는 GUI(연결 목록 편집이 GUI 명령이다).
//! 잠금 [`FILE_LOCK`] 은 프로세스마다라 두 쪽이 같은 순간 고치면 한쪽 줄이 덮일 수 있다 — 접속 성공과 연결 삭제가 같은 순간에
//! 겹치는 드문 경우이고, 잃는 것은 시각 한 줄이다(`history.json` 의 서버 적기 · GUI 지우기와 같은 알고 받은 한계).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// 서버가 한 번 쓸 때마다 쏘는 이벤트 — GUI 가 같은 이름의 Tauri 이벤트로 중계하고(`server::client::RELAYED`) 창마다 든 사본이
/// 듣고 다시 읽는다.
pub const CHANGED_EVENT: &str = "db-history-changed";

/// 연결 하나의 기록.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DbHistoryEntry {
    /// 마지막으로 **성공한** 접속 (Unix ms).
    #[serde(default)]
    pub last_ok_at: Option<u64>,
    /// 성공한 접속 수.
    #[serde(default)]
    pub count: u32,
}

/// 파일 한 장의 모양 — `{ "conns": { "<연결 id>": entry } }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DbHistoryFile {
    #[serde(default)]
    pub conns: BTreeMap<String, DbHistoryEntry>,
}

/// `db-connections.json` 곁의 `db-history.json`.
fn history_path() -> Option<PathBuf> {
    Some(crate::db::conns::path()?.with_file_name("db-history.json"))
}

/// 읽고-고치고-쓰는 한 벌을 **프로세스 안에서 한 번에 하나만** 돌린다(두 타일이 같은 순간 열기를 끝내도 줄이 덮이지 않게 —
/// `host_history::FILE_LOCK` 과 같은 이유. 프로세스 사이는 머리말의 알고 받은 한계).
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// 깨진 파일을 한 번 알렸는가.
static WARNED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// 순수 조작 — 유닛 테스트 대상
// ---------------------------------------------------------------------------

/// 파일을 읽는다. 없으면 빈 표, **깨졌으면 빈 표 + 한 번만 경고**.
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

/// 성공 하나를 표에 반영한다. id 가 연결 id 모양이 아니면 아무것도 하지 않는다(파일에 엉뚱한 열쇠가 서지 않게).
pub(crate) fn apply_ok(file: &mut DbHistoryFile, id: &str, now: u64) -> bool {
    if !crate::vault::db_conn_id_ok(id) {
        return false;
    }
    let entry = file.conns.entry(id.to_string()).or_default();
    entry.last_ok_at = Some(now);
    entry.count = entry.count.saturating_add(1);
    true
}

/// id 들을 지운다(연결 id 는 대소문자를 가린다 — 볼트 열쇠와 같다). 지운 것이 있으면 `true`.
pub(crate) fn forget(file: &mut DbHistoryFile, ids: &[String]) -> bool {
    let mut any = false;
    for id in ids {
        any |= file.conns.remove(id).is_some();
    }
    any
}

/// 잠금을 쥐고 파일을 고친다 — 바뀐 게 없으면 쓰지 않는다.
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
// 적기 — 세션 서버의 `db_open` 이 부른다 (fire-and-forget)
// ---------------------------------------------------------------------------

/// 사람 타일의 접속 성공 하나를 **블로킹 풀에서** 적고 서버 이벤트를 쏜다. 기다리지 않는다 — 열기의 답이 이미 정해진 뒤라 누구의
/// 앞길도 막지 않고, 실패는 서버 로그 한 줄로 끝난다(기록을 못 적었다고 성공한 접속을 실패로 보일 수 없다).
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
// 지우기 — GUI 의 연결 목록 편집이 부른다 (블로킹 — 부르는 쪽이 이미 블로킹 풀 안이다)
// ---------------------------------------------------------------------------

/// 지운 연결들의 줄을 걷는다. 걷은 것이 있으면 `true`(부르는 쪽이 이벤트를 쏠지 정한다). 실패는 무해하다 — 남은 줄은 목록에 없는
/// id 라 독에 서지 않고, 같은 id 가 다시 쓰일 일은 드물다.
pub(crate) fn forget_ids(ids: &[String]) -> Result<bool, String> {
    if ids.is_empty() {
        return Ok(false);
    }
    let path = history_path().ok_or_else(missing_dir)?;
    modify(&path, |file| forget(file, ids))
}

// ---------------------------------------------------------------------------
// 명령 — async + spawn_blocking (docs/conventions.md)
// ---------------------------------------------------------------------------

/// 기록 전체 — 연결 id → 한 줄. 파일이 없거나 깨졌으면 빈 표다(오류가 아니다).
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
