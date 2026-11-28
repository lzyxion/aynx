//! 백엔드 안의 좁은 설정 조회와 한 칸 쓰기 — 모두 디스크를 읽는 블로킹 함수다(블로킹 문맥에서만 부른다).

use crate::i18n::tr;

use super::persistence::{load_at, save_at, settings_path};
use super::{AiPrefs, AppSettings, AutomationPrefs, MessengerPrefs, RemotePrefs};

/// `[app] tray_on_close` — 없으면 켬.
pub(crate) fn tray_on_close() -> bool {
    settings_path().is_none_or(|path| load_at(&path).app.tray_on_close != Some(false))
}

pub(crate) fn messenger_prefs() -> MessengerPrefs {
    settings_path().map(|path| load_at(&path).messenger).unwrap_or_default()
}

/// 안 정하면 켬. 메신저가 보내는 순간 프런트의 표시와 따로 한 번 더 본다 — 대화에서 나온 글자는 켠 사람에게만 나간다.
pub(crate) fn messenger_include_conversation() -> bool {
    settings_path().is_some_and(|path| load_at(&path).messenger.include_conversation != Some(false))
}

/// 파일에 적힌 글자를 그대로 넘긴다 — 해석은 부르는 쪽(`crate::i18n`) 몫. 오류를 내지 않는다.
pub fn app_language() -> Option<String> {
    load_at(&settings_path()?).app.language
}

/// 해석(모르는 값 · 옛 `luna` → `gpt`)은 [`crate::app_icon::normalize`] 의 몫.
pub fn app_icon() -> Option<String> {
    load_at(&settings_path()?).app.app_icon
}

/// 안 정했거나 파일이 없으면 켬.
pub fn codex_no_daemon() -> bool {
    match settings_path() {
        Some(path) => load_at(&path).ai.codex_no_daemon.unwrap_or(true),
        None => true,
    }
}

/// 없거나 비었으면 `None`.
pub fn agent_extra_args(agent: &str) -> Option<String> {
    load_at(&settings_path()?)
        .ai
        .args
        .get(agent)
        .cloned()
        .filter(|v| !v.trim().is_empty())
}

pub fn agent_mcp_prefs() -> AiPrefs {
    settings_path()
        .map(|p| load_at(&p).ai)
        .unwrap_or_default()
}

/// `[ai] chat_tile = true` 일 때만 — 없거나 파일이 깨졌으면 끔.
pub fn chat_tile_enabled() -> bool {
    settings_path().is_some_and(|path| load_at(&path).ai.chat_tile == Some(true))
}

/// 안 정했거나 파일이 없으면 켬.
pub fn claude_statusline() -> bool {
    match settings_path() {
        Some(path) => load_at(&path).ai.claude_statusline.unwrap_or(true),
        None => true,
    }
}

/// 기본 켬 — 파일이 없거나 깨져도 켬.
pub fn local_shell_integration() -> bool {
    match settings_path() {
        Some(path) => load_at(&path)
            .terminal
            .local_shell_integration
            .unwrap_or(true),
        None => true,
    }
}

/// 권위 게이트([`crate::operations::approval::approve_operation`])가 실행 직전에 정책 전체를 독립적으로 다시 판정하려고 읽는다.
/// 파일이 없거나 깨졌으면 기본값(전부 끔). [`load_at`] 이 `sanitize` 를 지나므로 범위 안의 값이다.
pub fn automation_prefs() -> AutomationPrefs {
    match settings_path() {
        Some(path) => load_at(&path).automation,
        None => AutomationPrefs::default(),
    }
}

/// 파일이 없거나 깨졌으면 기본값(끔).
pub fn remote_prefs() -> RemotePrefs {
    settings_path().map(|p| load_at(&p).remote).unwrap_or_default()
}

/// 디스크의 설정에서 `[remote]` 만 바꿔 쓴다 — 화면의 저장 전 편집은 파일에 실리지 않는다. port 0 · `None` = 안 정함.
pub(crate) fn set_remote_connected(host: &str, port: Option<u16>) -> Result<(), String> {
    let path = settings_path().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )?;
    set_remote_connected_at(&path, host, port)
}

pub(super) fn set_remote_connected_at(path: &std::path::Path, host: &str, port: Option<u16>) -> Result<(), String> {
    let mut settings = load_at(path);
    settings.remote = RemotePrefs {
        enabled: Some(true),
        host: Some(host.to_string()),
        port: port.filter(|p| *p != 0),
    };
    save_at(path, &settings)
}

/// 원격 창의 `save_settings` 칸 단위 문(`remote/deny.rs`) — `(지금 저장된 값, 들어온 값을 정리한 것)`.
/// 저장과 같은 정리를 거친 뒤 견줘야 안 바꾼 칸이 바뀐 것으로 보이지 않는다.
pub(crate) fn current_and_sanitized(mut incoming: AppSettings) -> (AppSettings, AppSettings) {
    incoming.sanitize();
    let current = settings_path().map(|p| load_at(&p)).unwrap_or_default();
    (current, incoming)
}

/// 분 · 끔이면 `None`. 원격 관문이 원격 세션의 무입력 시한으로도 쓴다.
pub fn idle_lock_min() -> Option<u32> {
    settings_path().and_then(|p| load_at(&p).app.idle_lock_min)
}

/// 다른 조회와 달리 파일이 깨졌으면 `Err` 다 — 기본값으로 떨어뜨리면 월페이퍼 GC 가 지금 걸린 사진을 지운다. 파일 없음은 `Ok(None)`.
pub fn wallpaper_file_checked() -> Result<Option<String>, String> {
    let path = settings_path().ok_or_else(|| "no settings folder".to_string())?;
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            let mut parsed = toml::from_str::<AppSettings>(&content).map_err(|e| e.to_string())?;
            parsed.sanitize();
            Ok(parsed.wallpaper.file)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 월페이퍼만은 백엔드가 직접 한 칸 쓴다 — 이미지 복사 · 삭제가 되돌릴 수 없어 [저장] 전까지 들고 있을 수 없다.
/// 디스크의 값을 읽어 이 칸만 바꾸므로 프런트가 편집 중인 다른 값은 다음 [저장] 이 이긴다.
pub fn set_wallpaper_file(file: Option<String>) -> Result<(), String> {
    let path = settings_path().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )?;
    let mut settings = load_at(&path);
    settings.wallpaper.file = file;
    save_at(&path, &settings)
}
