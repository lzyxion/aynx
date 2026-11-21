//! 앱 안 업데이트 — 알리기만 한다. 내려받기 · 설치는 사람이 고를 때만이다(사용자 결정).
//!
//! - 플러그인의 JS API · 권한(`updater:*`)은 웹뷰에 열지 않는다(`capabilities/*.json` 에 없다) — Rust 명령 뒤에만 감싼다.
//!   원격 웹 창은 이 명령들을 부르지 못한다(`remote/deny.rs` 의 `HOME_ONLY`).
//! - GUI 프로세스에서만 돈다 — 세션 서버는 이 모듈을 부르지 않는다.
//! - 설치는 재연결을 멈추고 세션 서버를 먼저 끝낸 뒤다 — 멈추지 않으면 끊긴 순간 새 서버를 띄운다(`server/client.rs` 머리말).
//! - 피드에는 종류 없는 `windows-x86_64` 를 두지 않는다 — 종류를 모르는 실행 파일(손 빌드)이 다른 종류를 깔아 두 벌이 서지 않게.
//! - 개발 빌드만의 시험 문(릴리스에서는 읽지 않는다): `AYNX_UPDATER_ENDPOINT` · `AYNX_UPDATER_PUBKEY` · `AYNX_UPDATER_TARGET`.

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::i18n::tr;

pub(crate) const EVENT: &str = "update-state";

/// `tauri.conf.json` 의 공개키 자리표시자.
const PLACEHOLDER: &str = "REPLACE_WITH_AYNX_UPDATER_PUBKEY";

const RELEASE_PAGE: &str = "https://github.com/lzyxion/aynx/releases/tag/v";

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// 덩어리마다 내면 창이 이벤트에 잠긴다.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Idle,
    Available,
    Downloading,
    Ready,
    Installing,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Available {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
    pub page: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    pub current: String,
    pub phase: Phase,
    /// phase 와 따로 — 받아 둔 판을 찾기가 덮지 않게.
    pub checking: bool,
    pub available: Option<Available>,
    pub received: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    /// `download` · `install` — 프런트와 맞춘 값.
    pub failed_at: Option<&'static str>,
    pub check_error: Option<String>,
    pub checked_at: Option<u64>,
    pub skipped: Option<String>,
    pub toasted: Option<String>,
    /// 클수록 나중 상태 — 명령의 답이 뒤에 만든 이벤트보다 늦게 닿을 수 있어 프런트가 작은 차례를 버린다(`updater.ts` 의 `isNewerView`).
    pub rev: u64,
}

/// `updater.json` 의 모양(비밀 없음).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Prefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skipped: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    toasted: Option<String>,
}

struct Store {
    view: View,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    loaded: bool,
}

static STORE: LazyLock<Mutex<Store>> = LazyLock::new(|| {
    Mutex::new(Store {
        view: View {
            current: env!("CARGO_PKG_VERSION").to_string(),
            phase: Phase::Idle,
            checking: false,
            available: None,
            received: 0,
            total: None,
            error: None,
            failed_at: None,
            check_error: None,
            checked_at: None,
            skipped: None,
            toasted: None,
            rev: 0,
        },
        update: None,
        bytes: None,
        loaded: false,
    })
});

fn store() -> std::sync::MutexGuard<'static, Store> {
    STORE.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn prefs_path() -> Option<std::path::PathBuf> {
    Some(crate::instance::config_root()?.join("updater.json"))
}

fn read_prefs() -> Prefs {
    prefs_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(p: &Prefs) -> Result<(), String> {
    let path = prefs_path().ok_or_else(|| tr!(ko: "설정 폴더를 찾지 못했습니다", en: "Could not find the settings folder"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    crate::fs_atomic::write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())
}

async fn ensure_loaded() {
    if store().loaded {
        return;
    }
    let prefs = tauri::async_runtime::spawn_blocking(read_prefs).await.unwrap_or_default();
    let mut s = store();
    if !s.loaded {
        s.loaded = true;
        s.view.skipped = prefs.skipped;
        s.view.toasted = prefs.toasted;
    }
}

static REV: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 잠금을 쥔 채 불러야 뜬 순서 = 차례 순서다.
fn snap(s: &Store) -> View {
    let mut v = s.view.clone();
    v.rev = REV.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    v
}

fn snapshot() -> View {
    snap(&store())
}

/// 원격 창은 받지 않는다.
fn emit(app: &AppHandle) {
    let view = snapshot();
    for label in crate::remote::home_windows(app).into_keys() {
        let _ = app.emit_to(label.as_str(), EVENT, &view);
    }
}

/// Tauri 의 공개키는 minisign 공개키 파일(`untrusted comment: …` + 키 줄)을 통째로 base64 로 감싼 것이다.
pub(crate) fn key_problem(pubkey: &str) -> Option<String> {
    let key = pubkey.trim();
    if key.is_empty() || key == PLACEHOLDER {
        return Some(tr!(
            ko: "이 빌드에는 업데이트 서명 키가 없습니다 — 업데이트를 확인할 수 없습니다",
            en: "This build has no update signing key, so it can't check for updates"
        ));
    }
    let decoded = data_encoding::BASE64.decode(key.as_bytes()).ok();
    let text = decoded.as_deref().and_then(|b| std::str::from_utf8(b).ok()).unwrap_or("");
    let mut lines = text.lines();
    let comment = lines.next().unwrap_or("");
    let body = lines.next().unwrap_or("").trim();
    if !comment.starts_with("untrusted comment:") || body.is_empty() {
        return Some(tr!(
            ko: "업데이트 서명 키를 읽을 수 없습니다 — 업데이트를 확인할 수 없습니다",
            en: "The update signing key can't be read, so it can't check for updates"
        ));
    }
    None
}

fn pubkey(app: &AppHandle) -> String {
    if crate::instance::DEV {
        if let Ok(k) = std::env::var("AYNX_UPDATER_PUBKEY") {
            return k;
        }
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let key = pubkey(app);
    if let Some(problem) = key_problem(&key) {
        return Err(problem);
    }
    let mut b = app.updater_builder().pubkey(key).timeout(CHECK_TIMEOUT);
    if crate::instance::DEV {
        if let Ok(url) = std::env::var("AYNX_UPDATER_ENDPOINT") {
            let url = url.parse().map_err(|e| format!("AYNX_UPDATER_ENDPOINT: {e}"))?;
            b = b.endpoints(vec![url]).map_err(|e| e.to_string())?;
        }
        // 개발 빌드의 실행 파일에는 번들 종류가 없어 플러그인이 `windows-x86_64` 만 찾는다.
        if let Ok(target) = std::env::var("AYNX_UPDATER_TARGET") {
            b = b.target(target);
        }
    }
    b.build().map_err(|e| e.to_string())
}

fn explain(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    let detail = e.to_string();
    match e {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => tr!(
            ko: "서명이 맞지 않습니다 — 설치하지 않았습니다 ({detail})",
            en: "The signature didn't match, so nothing was installed ({detail})",
            detail = detail
        ),
        E::Reqwest(_) | E::Network(_) | E::ReleaseNotFound => tr!(
            ko: "업데이트 서버에 닿지 못했습니다 ({detail})",
            en: "Couldn't reach the update server ({detail})",
            detail = detail
        ),
        E::TargetNotFound(_) | E::TargetsNotFound(_) => tr!(
            ko: "이 설치 방식에 맞는 업데이트 파일이 없습니다 ({detail})",
            en: "There is no update file for this kind of install ({detail})",
            detail = detail
        ),
        _ => detail,
    }
}

/// 받는 중 · 받아 둠 · 설치 중이면 찾지 않는다 — 받아 둔 판을 덮지 않게.
#[tauri::command]
pub async fn update_check(app: AppHandle, auto: bool) -> Result<View, String> {
    ensure_loaded().await;
    if auto && crate::instance::DEV {
        return Ok(snapshot());
    }
    {
        let mut s = store();
        if s.view.checking || matches!(s.view.phase, Phase::Downloading | Phase::Ready | Phase::Installing) {
            return Ok(snap(&s));
        }
        s.view.checking = true;
    }
    emit(&app);
    let found = match updater(&app) {
        Ok(u) => u.check().await.map_err(|e| explain(&e)),
        Err(e) => Err(e),
    };
    {
        let mut s = store();
        s.view.checking = false;
        s.view.checked_at = Some(now_ms());
        match found {
            Ok(Some(update)) => {
                s.view.check_error = None;
                s.view.available = Some(Available {
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                    date: update.raw_json.get("pub_date").and_then(|v| v.as_str()).map(str::to_string),
                    page: format!("{RELEASE_PAGE}{}", update.version),
                });
                s.view.phase = Phase::Available;
                s.view.error = None;
                s.view.failed_at = None;
                s.view.received = 0;
                s.view.total = None;
                s.update = Some(update);
            }
            Ok(None) => {
                s.view.check_error = None;
                s.view.available = None;
                s.view.phase = Phase::Idle;
                s.view.error = None;
                s.view.failed_at = None;
                s.update = None;
            }
            Err(e) => {
                eprintln!("[updater] 찾기 실패: {e}");
                s.view.check_error = Some(e);
            }
        }
    }
    emit(&app);
    Ok(snapshot())
}

#[tauri::command]
pub async fn update_state() -> Result<View, String> {
    ensure_loaded().await;
    Ok(snapshot())
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<View, String> {
    let update = {
        let mut s = store();
        if !matches!(s.view.phase, Phase::Available | Phase::Failed) {
            return Ok(snap(&s));
        }
        let Some(update) = s.update.clone() else {
            return Err(tr!(ko: "내려받을 업데이트가 없습니다", en: "There is no update to download"));
        };
        s.view.phase = Phase::Downloading;
        s.view.received = 0;
        s.view.total = None;
        s.view.error = None;
        s.view.failed_at = None;
        s.bytes = None;
        update
    };
    emit(&app);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = Instant::now();
        let app3 = app2.clone();
        let result = update
            .download(
                move |chunk, total| {
                    {
                        let mut s = store();
                        s.view.received += chunk as u64;
                        s.view.total = total;
                    }
                    if last.elapsed() >= PROGRESS_EVERY {
                        last = Instant::now();
                        emit(&app3);
                    }
                },
                || {},
            )
            .await;
        {
            let mut s = store();
            match result {
                Ok(bytes) => {
                    s.view.phase = Phase::Ready;
                    s.bytes = Some(bytes);
                }
                Err(e) => {
                    let why = explain(&e);
                    eprintln!("[updater] 내려받기 실패: {why}");
                    s.view.phase = Phase::Failed;
                    s.view.error = Some(why);
                    s.view.failed_at = Some("download");
                }
            }
        }
        emit(&app2);
    });
    Ok(snapshot())
}

/// 성공하면 돌아오지 않는다(설치기가 이 프로세스를 끝낸다). 프런트는 창마다 세션을 놓은 뒤 부른다(`quitForUpdate`).
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let (update, bytes) = {
        let mut s = store();
        if s.view.phase != Phase::Ready {
            return Err(tr!(ko: "설치할 업데이트가 준비되지 않았습니다", en: "No downloaded update is ready to install"));
        }
        let (Some(update), Some(bytes)) = (s.update.clone(), s.bytes.take()) else {
            return Err(tr!(ko: "설치할 업데이트가 준비되지 않았습니다", en: "No downloaded update is ready to install"));
        };
        s.view.phase = Phase::Installing;
        (update, bytes)
    };
    emit(&app);
    crate::server::client::stop_reconnecting();
    let result = match crate::server::client::shutdown_and_wait().await {
        Ok(_) => tauri::async_runtime::spawn_blocking(move || update.install(&bytes).map_err(|e| explain(&e)))
            .await
            .unwrap_or_else(|e| Err(e.to_string())),
        Err(e) => Err(tr!(
            ko: "세션 서버를 끝내지 못했습니다 — 설치하지 않았습니다 ({e})",
            en: "Couldn't stop the session server, so nothing was installed ({e})",
            e = e
        )),
    };
    // 여기 왔으면 설치기를 띄우지 못했다(띄웠으면 프로세스가 이미 끝났다).
    crate::server::client::resume_reconnecting();
    let why = match result {
        Ok(()) => tr!(ko: "설치기를 띄우지 못했습니다", en: "Couldn't start the installer"),
        Err(e) => e,
    };
    eprintln!("[updater] 설치 실패: {why}");
    {
        let mut s = store();
        s.view.phase = Phase::Failed;
        s.view.error = Some(why.clone());
        s.view.failed_at = Some("install");
    }
    emit(&app);
    Err(why)
}

/// `None` = 건너뛰기 되돌리기.
#[tauri::command]
pub async fn update_skip(app: AppHandle, version: Option<String>) -> Result<View, String> {
    ensure_loaded().await;
    let prefs = {
        let mut s = store();
        s.view.skipped = version.filter(|v| !v.trim().is_empty());
        Prefs { skipped: s.view.skipped.clone(), toasted: s.view.toasted.clone() }
    };
    tauri::async_runtime::spawn_blocking(move || write_prefs(&prefs))
        .await
        .map_err(|e| e.to_string())??;
    emit(&app);
    Ok(snapshot())
}

#[tauri::command]
pub async fn update_mark_toasted(app: AppHandle, version: String) -> Result<View, String> {
    ensure_loaded().await;
    let prefs = {
        let mut s = store();
        s.view.toasted = Some(version);
        Prefs { skipped: s.view.skipped.clone(), toasted: s.view.toasted.clone() }
    };
    tauri::async_runtime::spawn_blocking(move || write_prefs(&prefs))
        .await
        .map_err(|e| e.to_string())??;
    emit(&app);
    Ok(snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_and_garbage_keys_are_refused() {
        assert!(key_problem(PLACEHOLDER).is_some());
        assert!(key_problem("").is_some());
        assert!(key_problem("not base64 !!").is_some());
        assert!(key_problem(&data_encoding::BASE64.encode(b"hello")).is_some());
    }

    #[test]
    fn minisign_shaped_key_is_accepted() {
        let file = "untrusted comment: minisign public key: 0123456789ABCDEF\nRWQBI0VniavN7xgK9bIjiGzQy0y0p5S1d4dE0bQc5nUOl7Y5dWkXc2Wm\n";
        assert!(key_problem(&data_encoding::BASE64.encode(file.as_bytes())).is_none());
    }

    #[test]
    fn the_shipped_config_has_a_key_slot() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        assert!(updater["pubkey"].is_string(), "plugins.updater.pubkey 가 있어야 플러그인이 선다");
        // 자리표시자로 되돌아가면 내보낸 판이 다시는 스스로 업데이트하지 못한다
        assert_eq!(key_problem(updater["pubkey"].as_str().unwrap()), None, "plugins.updater.pubkey 가 쓸 수 있는 공개키여야 한다");
        assert_eq!(
            updater["endpoints"][0],
            "https://github.com/lzyxion/aynx/releases/latest/download/latest.json"
        );
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], false);
        let overlay: serde_json::Value = serde_json::from_str(include_str!("../tauri.updater.conf.json")).unwrap();
        assert_eq!(overlay["bundle"]["createUpdaterArtifacts"], true);
        let release = include_str!("../../.github/workflows/release.yml");
        assert!(release.contains("--config src-tauri/tauri.updater.conf.json"), "릴리스 빌드만 덮어쓰기를 건다");
        assert!(release.contains("\"windows-x86_64-nsis\"") && release.contains("\"windows-x86_64-msi\""));
    }

    #[test]
    fn snapshots_carry_increasing_revisions() {
        let a = snapshot();
        let b = snapshot();
        let c = snap(&store());
        assert!(a.rev > 0 && b.rev > a.rev && c.rev > b.rev, "{} {} {}", a.rev, b.rev, c.rev);
    }

    #[test]
    fn prefs_round_trip_and_skip_empty() {
        let p = Prefs { skipped: Some("0.1.2".into()), toasted: None };
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(s, r#"{"skipped":"0.1.2"}"#);
        assert_eq!(serde_json::from_str::<Prefs>(&s).unwrap(), p);
        assert_eq!(serde_json::from_str::<Prefs>("{}").unwrap(), Prefs::default());
    }
}
