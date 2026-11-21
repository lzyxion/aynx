//! 앱 설정 — `<config_dir>/aynx/settings.toml`. 앱 소유 파일이라 저장할 때 파일 전체를 다시 쓴다.
//! 읽기는 통째로 역직렬화하고, 실패하면 기본값으로 시작한다. 모르는 키는 버린다 — 옛 판 앱이 저장하면 새 판의 키가 사라진다.

use crate::i18n::tr;

mod access;
mod appearance;
mod automation;
mod migration;
mod normalize;
mod persistence;
mod schema;

pub use access::{
    agent_extra_args, agent_mcp_prefs, app_icon, app_language, automation_prefs, claude_statusline, codex_no_daemon,
    idle_lock_min, local_shell_integration, remote_prefs, set_wallpaper_file, wallpaper_file_checked,
};
pub(crate) use access::{current_and_sanitized, messenger_include_conversation, messenger_prefs, set_remote_connected, tray_on_close};
#[allow(unused_imports)]
pub use appearance::{AppTheme, TermPrefs, Trigger, WallpaperPrefs};
pub use automation::{AllowRule, AutomationPrefs};
pub(crate) use automation::{MAX_MAX_CONCURRENCY, MIN_MAX_CONCURRENCY};
pub use migration::migrate_legacy_app_dir;
pub(crate) use migration::rename_first_legacy_dir;
use persistence::{load_at, save_at, settings_path};
#[allow(unused_imports)]
pub use schema::{
    AiPrefs, AppSettings, DockPrefs, FilesPrefs, HostsPrefs, MessengerPrefs, PlansPrefs, ProjectsPrefs, RemotePrefs, ShellPrefs,
    UpdatesPrefs, VaultPrefs,
};
#[cfg(test)]
use appearance::default_triggers;
#[cfg(test)]
use std::collections::BTreeMap;
#[cfg(test)]
use migration::{migrate_app_dir_at, APP_DIR, LEGACY_APP_DIRS};
#[cfg(test)]
use normalize::{MAX_AFTER_SECS, MAX_BLUR, MAX_DIM, MAX_IDLE_LOCK_MIN, MAX_TRIGGERS, WALLPAPER_FITS};
#[cfg(test)]
use std::path::PathBuf;

/// 파일이 없거나 깨졌으면 기본값 — 오류를 내지 않는다.
#[tauri::command]
pub async fn load_settings() -> AppSettings {
    tauri::async_runtime::spawn_blocking(|| match settings_path() {
        Some(path) => load_at(&path),
        None => {
            eprintln!("[aynx] 설정 디렉터리를 찾을 수 없습니다 — 기본 설정으로 시작합니다");
            AppSettings::default()
        }
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = settings;
        settings.sanitize();
        save_at(&path, &settings)?;
        let saved = settings
            .ai
            .mcp_servers
            .iter()
            .flat_map(|server| server.env.iter().chain(&server.headers).map(|entry| entry.secret_ref.clone()))
            .collect();
        crate::server::vault_proxy::settings_saved_blocking(&settings.ai.mcp_servers, saved);
        crate::tray::sync(&app);
        crate::remote::sync(&app);
        Ok(())
    })
        .await
        .map_err(|e| tr!(ko: "설정을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the settings failed: {e}"))?
}

#[cfg(test)]
mod tests;
