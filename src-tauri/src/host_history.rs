//! 호스트별 접속 이력 — `<config_dir>/aynx/history.json` (docs/log/2026-09-23-host-history.md).
//!
//! 호스트 목록의 "최근" 정렬 · 호스트 줄 말풍선 · 시작 화면의 "최근" 줄이 읽는 **작은 표**다.
//! 별칭마다 다섯 칸뿐이다 — 마지막 성공 시각 · 마지막 실패 시각 · 그 실패의 사유 코드와 짧은
//! 한 줄 · 성공 횟수.
//!
//! ## 담지 않는 것
//!
//! 비밀번호·암호구·키 파일 경로·명령 글자는 **한 글자도** 들어오지 않는다. 사유는
//! [`crate::ssh::OpenCause`] 의 ASCII 코드이고, 사람이 읽는 한 줄은 백엔드가 만든 오류
//! 문구에서 **인증 계열을 빼고**(에이전트·키 파일 이야기가 섞이는 자리다) 경로처럼 보이는
//! 조각을 가린 뒤 160자로 자른 것이다 ([`short_message`]).
//!
//! ## 무엇을 적고 무엇을 적지 않나
//!
//! - **사용자 타일의 접속만** 적는다 (`ssh::open_ssh_session`). 헤드리스 위임 접속은 앱이
//!   스스로 한 일이지 사람이 한 일이 아니라서 적지 않는다 — 적으면 AI 가 밤새 붙은 호스트가
//!   "최근" 맨 위로 올라와 사람의 기억과 어긋난다.
//! - **설정의 호스트만** 적는다. 빠른 접속(`user@host:port`)에는 별칭이 없다.
//! - 비밀번호·암호구·호스트 키 **질문**은 실패가 아니다. 그것은 "끊고 물어본 뒤 다시 연다"
//!   는 평범한 계약의 한 걸음이고, 사람이 답하면 곧바로 성공이 따라온다. 그걸 실패로 적으면
//!   잠긴 키를 쓰는 호스트는 접속할 때마다 "마지막 실패" 가 한 번씩 찍힌다.
//!
//! ## 파일 관례
//!
//! `snippets.json` 과 같은 폴더·같은 원자적 쓰기([`crate::app_state::save_at`])다. 다른 점은
//! **백엔드가 스키마를 안다**는 것 — 이 파일은 프런트가 아니라 백엔드가 쓰기 때문이다(프런트는
//! 읽기만 한다). 없거나 깨진 파일은 빈 표로 시작하고 콘솔에 **한 번만** 남긴다: 이력은 없어도
//! 되는 편의값이라 접속을 막을 이유가 없다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;
use crate::ssh::{OpenCause, SshOpenError};

/// Rust 가 한 번 쓸 때마다 쏘는 이벤트 — 창마다 든 사본이 이것을 듣고 다시 읽는다.
pub const CHANGED_EVENT: &str = "host-history-changed";

/// 짧은 한 줄의 상한 (글자 수). 말풍선 한 줄에 들어가는 길이다.
const MESSAGE_CAP: usize = 160;

/// 별칭 하나의 이력.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HostHistoryEntry {
    /// 마지막으로 **성공한** 접속 (Unix ms).
    #[serde(default)]
    pub last_ok_at: Option<u64>,
    /// 마지막으로 **실패한** 접속 (Unix ms).
    #[serde(default)]
    pub last_fail_at: Option<u64>,
    /// 그 실패의 사유 — [`OpenCause`] 의 snake_case 글자.
    #[serde(default)]
    pub last_fail_cause: Option<String>,
    /// 그 실패의 짧은 한 줄 (없을 수 있다 — [`short_message`]).
    #[serde(default)]
    pub last_fail_message: Option<String>,
    /// **성공한** 접속 수 (실패는 세지 않는다 — "몇 번 붙었나" 가 궁금한 값이다).
    #[serde(default)]
    pub count: u32,
}

/// 파일 한 장의 모양 — `{ "hosts": { "<alias>": entry } }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HistoryFile {
    #[serde(default)]
    pub hosts: BTreeMap<String, HostHistoryEntry>,
}

/// 기록할 사건 하나.
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

/// 읽고-고치고-쓰는 한 벌을 **한 번에 하나만** 돌린다. 두 타일이 동시에 접속을 끝내면
/// 블로킹 풀의 두 태스크가 같은 파일을 읽고 각자 한 줄씩 고쳐 쓰는데, 잠금이 없으면 먼저 쓴
/// 쪽의 줄이 뒤에 쓴 쪽에 덮인다. (창이 여럿이어도 프로세스는 하나라 이 잠금 하나로 충분하다.)
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// 깨진 파일을 한 번 알렸는가 (접속마다 같은 경고를 찍지 않는다).
static WARNED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// 순수 조작 — 유닛 테스트 대상
// ---------------------------------------------------------------------------

/// 파일을 읽는다. 없으면 빈 표, **깨졌으면 빈 표 + 한 번만 경고**.
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

/// 사건 하나를 표에 반영한다. 별칭이 비어 있으면 아무것도 하지 않는다.
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

/// 별칭 하나를 지운다. 지운 것이 있으면 `true`.
pub(crate) fn forget(file: &mut HistoryFile, alias: &str) -> bool {
    match find_key(file, alias) {
        Some(k) => file.hosts.remove(&k).is_some(),
        None => false,
    }
}

/// 이름이 바뀐 별칭을 따라간다. 바꾼 것이 있으면 `true`.
///
/// 새 이름에 이미 이력이 있으면 **둘을 합친다** — 시각은 늦은 쪽, 횟수는 더한다. 어느 한쪽을
/// 버리면 사람이 실제로 붙었던 기록이 사라진다.
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

/// [`OpenCause`] → snake_case 글자 (serde 표현을 그대로 쓴다 — 프런트 `OpenCause` 와 같은 표).
fn cause_code(cause: OpenCause) -> String {
    serde_json::to_value(cause)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "other".to_string())
}

/// 파일에 남길 **짧은 한 줄**. 남길 것이 없으면 `None`.
///
/// 첫 줄만 쓰고, 경로처럼 보이는 조각(`\` 이 든 것 · `/`·`~` 로 시작하는 것 · `C:` 꼴)은
/// `…` 로 가린 뒤 [`MESSAGE_CAP`] 자로 자른다. 오류 문구에 설정 파일 경로가 섞여 올 수
/// 있어서다 — 이 파일은 "어디가 안 됐나" 만 알면 된다.
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

/// 접속 결과 → 적을 사건. **적지 않는 것은 `None`** (모듈 머리말의 "무엇을 적지 않나").
///
/// - 비밀번호·암호구·호스트 키 질문(`PasswordRequired`·`PassphraseRequired`·`HostKey*`)은
///   재시도 계약의 한 걸음이라 실패가 아니다.
/// - 인증 계열 사유에는 한 줄을 남기지 않는다 — 에이전트·키 파일 이야기가 섞이는 자리다.
///   사유 코드만으로 화면의 힌트 한 줄이 선다.
pub(crate) fn outcome_of<T>(result: &Result<T, SshOpenError>) -> Option<Outcome> {
    match result {
        Ok(_) => Some(Outcome::Ok),
        // 사람이 타일을 닫아 멈춘 것(원격 새 워크트리의 첫 커밋 질문을 기다리던 중 — `crate::remote_worktree`)은 접속의
        // 성패가 아니다 — 적지 않는다.
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
// 기록 — 접속 경로가 부른다 (fire-and-forget)
// ---------------------------------------------------------------------------

/// 사건 하나를 **블로킹 풀에서** 적고 이벤트를 쏜다. 기다리지 않는다.
///
/// 접속의 결정(성공·실패)이 이미 끝난 **뒤에** 부르는 자리라 이 쓰기는 누구의 앞길도 막지
/// 않는다. 실패는 로그 한 줄로 끝난다 — 이력을 못 적었다고 성공한 접속을 실패로 보일 수 없다.
/// 디바운스는 없다: 접속 한 번에 쓰기 한 번이다.
///
/// ③-3b2 부터 **세션 서버**에서 불린다(SSH 열기가 서버에 산다) — 이벤트는 서버 이벤트 [`CHANGED_EVENT`] 로 나가고 GUI 가
/// 같은 이름의 Tauri 이벤트로 중계한다(`server::client::on_event`). 지우기·이름 바꾸기·목록은 GUI 의 명령 그대로다.
pub(crate) fn record(alias: &str, outcome: Outcome) {
    let Some(path) = history_path() else {
        return;
    };
    let alias = alias.to_string();
    let now = now_ms();
    // 핸들을 버린다 — 기다리지 않는 것이 이 함수의 계약이다.
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

/// 잠금을 쥐고 파일을 고친다 — 기록과 명령 셋의 공용 몸통. 바뀐 게 없으면 쓰지 않는다.
fn modify(path: &Path, f: impl FnOnce(&mut HistoryFile) -> bool) -> Result<bool, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut file = load_file(path);
    if !f(&mut file) {
        return Ok(false);
    }
    write_file(path, &file)?;
    Ok(true)
}

/// 명령의 공용 꼬리 — 블로킹 풀에서 돌리고, 바뀌었으면 이벤트를 쏜다.
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
// 명령 — 전부 async + spawn_blocking (docs/conventions.md)
// ---------------------------------------------------------------------------

/// 이력 전체 — 별칭 → 한 줄. 파일이 없거나 깨졌으면 빈 표다(오류가 아니다).
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

/// 이력을 통째로 지운다 — 설정 › 일반의 [지우기]. 이미 비었으면 조용히 성공이다.
#[tauri::command]
pub async fn host_history_clear(app: AppHandle) -> Result<(), String> {
    run_modify(app, |file| {
        let had = !file.hosts.is_empty();
        file.hosts.clear();
        had
    })
    .await
}

/// 별칭 하나를 지운다 — 호스트 제거 팬아웃(`app/host-remove.ts`)이 부른다.
#[tauri::command]
pub async fn host_history_forget(app: AppHandle, alias: String) -> Result<(), String> {
    run_modify(app, move |file| forget(file, &alias)).await
}

/// 별칭 이름 변경을 따라간다 — 이름 변경 팬아웃(`app/host-rename.ts`)이 부른다.
/// (이름 변경은 프런트가 몰고 가는 일이라 Rust 쪽 config 편집 경로에 걸 자리가 없다.)
#[tauri::command]
pub async fn host_history_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    run_modify(app, move |file| rename(file, &from, &to)).await
}

#[cfg(test)]
mod tests;
