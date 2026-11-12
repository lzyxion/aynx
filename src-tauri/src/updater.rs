//! **앱 안 업데이트**(2026-11-12 — 사용자 결정 "알리기만 한다. 내려받기 · 설치는 사람이 고를 때만").
//!
//! `tauri-plugin-updater` 를 **Rust 명령 뒤에** 감싼다 — 플러그인의 JS API · 권한(`updater:*`)은 웹뷰에 열지 않는다
//! (`capabilities/*.json` 에 없다). 프런트는 아래 명령 여섯과 이벤트 [`EVENT`] 만 안다. 원격 웹 창은 여섯 다 부르지 못한다
//! (`remote/deny.rs` 의 `HOME_ONLY` — 원격 기기가 집 PC 를 업데이트시키지 못한다).
//!
//! - **GUI 프로세스에서만 돈다** — 세션 서버(`server.rs`)는 이 모듈을 부르지 않는다.
//! - 찾기(`update_check`)가 닿는 곳은 릴리스 피드 하나(`tauri.conf.json` 의 `plugins.updater.endpoints` —
//!   GitHub Releases 의 `latest.json`)이고 사용자에 대해 아무것도 보내지 않는다. 개발 빌드는 **자동 찾기를 하지 않는다**
//!   (`auto: true` 면 그대로 돌려준다 · 손으로 [지금 확인]은 된다).
//! - 내려받기(`update_download`)는 사람이 [업데이트]를 눌렀을 때만이다. 받은 바이트는 서명(`plugins.updater.pubkey`)을 맞춘 뒤
//!   이 모듈의 메모리에 쥔다 — 설치(`update_install`)까지 [`Update`] 손잡이와 함께 산다.
//! - 설치는 **세션 서버를 먼저 끝내고**(`client::shutdown_and_wait` — 판이 다른 옛 서버를 새 GUI 가 스스로 갈지 않는다,
//!   `server/client.rs` 머리말) 플러그인의 설치(Windows: 설치기를 띄우고 이 프로세스를 끝낸다 · 설치기가 앱을 다시 띄운다)로 간다.
//!   재연결은 그 전에 멈춘다(멈추지 않으면 끊긴 순간 새 서버를 띄운다). 설치기를 못 띄우면 재연결을 되살리고 실패로 남긴다.
//! - 설치 종류는 플러그인이 고른다 — 실행 파일에 번들러가 새긴 종류(NSIS · MSI)로 `latest.json` 의 `windows-x86_64-nsis` ·
//!   `windows-x86_64-msi` 를 먼저 찾는다. 피드에는 종류 없는 `windows-x86_64` 를 **두지 않는다** — 종류를 모르는 실행 파일
//!   (손으로 빌드한 것)이 다른 종류를 깔아 두 벌이 서지 않게(그때는 "이 설치에 맞는 파일 없음" 으로 실패한다).
//! - 건너뛴 판 · 이미 알린 판은 `<설정 루트>/updater.json` 에 적는다(비밀 없음). 무엇을 보이고 알릴지의 판정은 프런트의 순수
//!   모듈(`src/lib/updater.ts`)이 한다 — 여기는 적고 돌려줄 뿐이다.
//! - 공개키 자리표시자(`REPLACE_WITH_AYNX_UPDATER_PUBKEY`)나 풀리지 않는 키면 찾기가 곧바로 분명한 오류를 낸다(앱은 산다).
//!
//! 개발 빌드만의 시험 문(릴리스에서는 읽지 않는다): `AYNX_UPDATER_ENDPOINT`(피드 주소 — `http://127.0.0.1:…/latest.json` 도 된다) ·
//! `AYNX_UPDATER_PUBKEY`(그 피드의 서명 공개키) · `AYNX_UPDATER_TARGET`(피드에서 읽을 열쇠 — 개발 빌드 실행 파일에는 번들 종류가
//! 없어 기본은 `windows-x86_64` 다).

use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::i18n::tr;

/// 상태가 바뀔 때 집 PC 창마다 내는 이벤트(몸 = [`View`]).
pub(crate) const EVENT: &str = "update-state";

/// `tauri.conf.json` 의 공개키 자리표시자 — 키를 넣기 전의 빌드.
const PLACEHOLDER: &str = "REPLACE_WITH_AYNX_UPDATER_PUBKEY";

/// 릴리스 페이지(카드의 링크) — 판 앞에 `v`.
const RELEASE_PAGE: &str = "https://github.com/lzyxion/aynx/releases/tag/v";

/// 찾기 요청 하나의 상한.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// 내려받는 동안 진행 이벤트의 간격 — 덩어리마다 내면 창이 이벤트에 잠긴다.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// 지금 어디인가.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    /// 새 판 없음(또는 아직 찾지 않음).
    Idle,
    /// 새 판이 있다 — 칩 · 카드.
    Available,
    Downloading,
    /// 받고 서명까지 맞췄다 — [다시 시작]을 기다린다.
    Ready,
    /// 세션 서버를 끝내고 설치기를 띄우는 중.
    Installing,
    /// 내려받기 · 설치 실패(아무것도 깔리지 않았다) — [다시 시도]는 다시 받는다.
    Failed,
}

/// 찾은 새 판.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Available {
    pub version: String,
    /// 릴리스 노트(마크다운) — 없으면 빈 글자.
    pub notes: String,
    /// 피드의 `pub_date`(RFC 3339) 그대로 — 없으면 `None`.
    pub date: Option<String>,
    /// 릴리스 페이지 주소.
    pub page: String,
}

/// 프런트가 받는 모양 — `update_state` 의 답이고 [`EVENT`] 의 몸이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    /// 이 앱의 판.
    pub current: String,
    pub phase: Phase,
    /// 지금 찾는 중인가(phase 와 따로 — 받아 둔 판을 찾기가 덮지 않게).
    pub checking: bool,
    pub available: Option<Available>,
    /// 내려받은 바이트 · 전체(서버가 길이를 안 알리면 `None`).
    pub received: u64,
    pub total: Option<u64>,
    /// 실패 이유(사람 말) — `phase == failed` 일 때.
    pub error: Option<String>,
    /// 실패한 단계 — `download` · `install`.
    pub failed_at: Option<&'static str>,
    /// 마지막 찾기의 실패(사람 말) — 성공하면 걷힌다. 칩이 아니라 설정 줄이 보인다.
    pub check_error: Option<String>,
    /// 마지막으로 찾기를 끝낸 때(epoch ms — 성공 · 실패 모두).
    pub checked_at: Option<u64>,
    /// 건너뛴 판 · 알림을 이미 띄운 판(`updater.json`).
    pub skipped: Option<String>,
    pub toasted: Option<String>,
    /// 사본의 차례(2026-11-12 실기 — 명령의 답이 그보다 뒤에 만든 이벤트보다 늦게 닿아 새 상태를 덮었다). 사본을 뜰 때 잠금 안에서
    /// 올리므로 **클수록 나중 상태**다. 프런트는 쥔 것보다 작은 차례를 버린다(`updater.ts` 의 `isNewerView`).
    pub rev: u64,
}

/// `updater.json` 의 모양.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Prefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skipped: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    toasted: Option<String>,
}

struct Store {
    view: View,
    /// 찾기가 돌려준 손잡이 — 내려받기 · 설치가 쓴다.
    update: Option<Update>,
    /// 받아서 서명을 맞춘 설치 파일.
    bytes: Option<Vec<u8>>,
    /// `updater.json` 을 읽었나.
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

/// 처음 한 번 `updater.json` 을 읽어 들인다(블로킹 풀).
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

/// 사본 차례의 계수기 — [`snap`] 이 잠금 안에서 올린다(뜬 순서 = 차례 순서).
static REV: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 잠금을 쥔 채 사본을 뜬다 — 새 차례를 붙인다.
fn snap(s: &Store) -> View {
    let mut v = s.view.clone();
    v.rev = REV.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    v
}

fn snapshot() -> View {
    snap(&store())
}

/// 집 PC 창마다 지금 상태를 낸다(원격 창은 받지 않는다 — 칩도 카드도 없다).
fn emit(app: &AppHandle) {
    let view = snapshot();
    for label in crate::remote::home_windows(app).into_keys() {
        let _ = app.emit_to(label.as_str(), EVENT, &view);
    }
}

/// 공개키가 쓸 만한가 — 자리표시자 · 빈 값 · 풀리지 않는 값이면 그 이유(사람 말). 순수 함수(시험).
///
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

/// 쓸 공개키 — 개발 빌드는 `AYNX_UPDATER_PUBKEY` 가 먼저다.
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
        // 개발 빌드의 실행 파일에는 번들 종류가 없어 플러그인이 `windows-x86_64` 만 찾는다 — 실제 모양의 피드
        // (`windows-x86_64-nsis` · `-msi`)로 시험하려면 그 열쇠를 여기로 고른다.
        if let Ok(target) = std::env::var("AYNX_UPDATER_TARGET") {
            b = b.target(target);
        }
    }
    b.build().map_err(|e| e.to_string())
}

/// 플러그인 오류 → 사람 말(원문은 뒤에 붙인다 — 설정 줄 · 카드가 보인다).
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

/// 새 판을 찾는다. `auto` 는 시작 · 6시간마다의 자동 찾기다 — 개발 빌드는 하지 않는다.
/// 받는 중 · 받아 둠 · 설치 중이면 찾지 않고 지금 상태를 돌려준다(받아 둔 판을 덮지 않게).
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

/// 지금 상태(설정 줄 · 칩이 마운트할 때).
#[tauri::command]
pub async fn update_state() -> Result<View, String> {
    ensure_loaded().await;
    Ok(snapshot())
}

/// 찾은 판을 내려받는다 — 곧바로 돌아오고 진행은 [`EVENT`] 로 간다. 받은 뒤 서명을 맞추고 `ready` 가 된다.
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

/// **다시 시작해 설치** — 세션 서버를 끝내고(그 pid 가 사라질 때까지) 설치기를 띄운 뒤 이 프로세스를 끝낸다. 돌아오면 실패다
/// (재연결은 되살아나고 `failed` 로 남는다 — 아무것도 깔리지 않았다). 프런트는 창마다 세션을 놓은 뒤 부른다(`quitForUpdate`).
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

/// 이 판을 건너뛴다(`None` = 건너뛰기 되돌리기).
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

/// 이 판의 알림을 띄웠다 — 같은 판으로 다시 띄우지 않는다.
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
        // base64 이지만 minisign 공개키 파일이 아니다.
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
        // 진짜 공개키가 들어가 있다(2026-11-12) — 자리표시자로 되돌아가면 내보낸 판이 다시는 스스로 업데이트하지 못한다
        assert_eq!(key_problem(updater["pubkey"].as_str().unwrap()), None, "plugins.updater.pubkey 가 쓸 수 있는 공개키여야 한다");
        assert_eq!(
            updater["endpoints"][0],
            "https://github.com/lzyxion/aynx/releases/latest/download/latest.json"
        );
        // 로컬 빌드는 업데이터 산출물을 만들지 않는다(서명 키 없이도 빌드된다) — CI 만 `--config` 로 켠다.
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
