//! 런타임 설정 조회 — 백엔드 안의 좁은 조회(언어 · 아이콘 · AI · 셸 통합 · 자동 승인 · 원격 · 메신저 · 트레이)와
//! 월페이퍼 칸 검사/한 칸 쓰기. 모두 디스크를 읽는 **블로킹** 함수다. `settings.rs` 에서 그대로 옮겼다(Tauri 명령은 부모).

use crate::i18n::tr;

use super::persistence::{load_at, save_at, settings_path};
use super::{AiPrefs, AppSettings, AutomationPrefs, MessengerPrefs, RemotePrefs};

/// `[app] tray_on_close` — 창을 모두 닫으면 트레이에 남는가(없으면 켬 · ③-4). **블로킹**(파일을 읽는다).
pub(crate) fn tray_on_close() -> bool {
    settings_path().is_none_or(|path| load_at(&path).app.tray_on_close != Some(false))
}

/// 저장된 `[messenger]` 전체(복제) — 창이 없을 때 작업안 결과를 보내는 GUI·세션 서버가 규칙을 본다(③-4). **블로킹**.
pub(crate) fn messenger_prefs() -> MessengerPrefs {
    settings_path().map(|path| load_at(&path).messenger).unwrap_or_default()
}

/// `[messenger] include_conversation` 이 켜져 있는가 — **블로킹**(파일을 읽는다). 메신저가 보내는 순간
/// 프런트의 표시와 따로 **한 번 더** 본다: 대화에서 나온 글자는 켠 사람에게만 나간다([`crate::messenger`]).
pub(crate) fn messenger_include_conversation() -> bool {
    settings_path().is_some_and(|path| load_at(&path).messenger.include_conversation == Some(true))
}

/// 저장된 `[app] language` 만 뽑아 읽는다 (안 정했으면 `None`).
///
/// 백엔드 안의 좁은 조회다 — 프런트가 마운트하기 **전에** 백엔드
/// 문구의 언어를 걸어야 하는 setup 이 부른다([`crate::i18n`]). 값의 해석(`ko`/`en` 이 아닌
/// 것은 버린다)은 부르는 쪽의 몫이고, 여기는 `mode` 와 같은 **"보관만"** 분담 그대로
/// 파일에 적힌 글자를 넘긴다. 파일이 없거나 깨졌으면 `None` 이고 절대 오류를 내지 않는다.
pub fn app_language() -> Option<String> {
    load_at(&settings_path()?).app.language
}

/// 저장된 `[app] app_icon` 만 뽑아 읽는다 (안 정했으면 `None`) — [`app_language`] 와 같은 부류로
/// setup 이 첫 창에 아이콘을 걸기 전에 부른다. 해석(모르는 값·옛 `luna` → `gpt`)은 [`crate::app_icon::normalize`] 의 몫.
pub fn app_icon() -> Option<String> {
    load_at(&settings_path()?).app.app_icon
}

/// `[ai] codex_no_daemon` — 안 정했거나 파일이 없으면 **켬**([`local_shell_integration`] 과 같은 좁은 조회).
/// 디스크를 읽으므로 블로킹 문맥에서만 부른다.
pub fn codex_no_daemon() -> bool {
    match settings_path() {
        Some(path) => load_at(&path).ai.codex_no_daemon.unwrap_or(true),
        None => true,
    }
}

/// `[ai.args] <에이전트 id>` — 그 에이전트에 붙일 추가 인자 한 줄(없거나 비었으면 `None`). 디스크를 읽으므로 블로킹 문맥에서만.
pub fn agent_extra_args(agent: &str) -> Option<String> {
    load_at(&settings_path()?)
        .ai
        .args
        .get(agent)
        .cloned()
        .filter(|v| !v.trim().is_empty())
}

/// 외부 목록·세션 서버 선택을 같은 저장 설정에서 읽는다. 블로킹 문맥에서만 부른다.
pub fn agent_mcp_prefs() -> AiPrefs {
    settings_path()
        .map(|p| load_at(&p).ai)
        .unwrap_or_default()
}

/// `[ai] claude_statusline` — 안 정했거나 파일이 없으면 **켬**([`codex_no_daemon`] 과 같은 좁은 조회).
/// 디스크를 읽으므로 블로킹 문맥에서만 부른다(`crate::claude_usage::tile_env`).
pub fn claude_statusline() -> bool {
    match settings_path() {
        Some(path) => load_at(&path).ai.claude_statusline.unwrap_or(true),
        None => true,
    }
}

/// 저장된 `[terminal] local_shell_integration` 만 뽑아 읽는다 (기본 **켬**).
///
/// [`app_language`] 과 같은 부류의 좁은 조회다 — 로컬 셸을 띄우는 자리
/// (`crate::pty::spawn_shell`)가 훅 파일을 쓸지 말지 정하려고 부른다. 파일이 없거나
/// 깨졌으면 기본값(켬)이고 **절대 오류를 내지 않는다**.
///
/// **디스크를 읽으므로 블로킹 문맥에서만 부른다** — 부르는 쪽인 `spawn_shell` 은 이미
/// `spawn_blocking` 안이다 (docs/conventions.md "Tauri 명령은 기본 async fn").
pub fn local_shell_integration() -> bool {
    match settings_path() {
        Some(path) => load_at(&path)
            .terminal
            .local_shell_integration
            .unwrap_or(true),
        None => true,
    }
}

/// 저장된 `[automation]` **정책 전체**를 읽어 돌려준다(복제).
///
/// [`app_language`]·[`local_shell_integration`] 과 같은 부류의 좁은 조회다. 단계 10b 의
/// **권위 게이트**([`crate::operations::approval::approve_operation`])가 executor spawn 직전에 부른다:
/// 수동·자동 공통 상한(caps)뿐 아니라, 자동이면 `auto_approve`·`allow_patterns` 로 위험·
/// allowlist·메타문자까지 Rust 가 **독립적으로 다시** 판정하기 때문에 — 프런트 정책 평가기
/// (`policy.ts`)와 같은 판정을 백엔드가 경계로 강제한다 — 상한 둘이 아니라 **정책 전체**가 필요하다.
/// 파일이 없거나 깨졌으면 기본값([`AutomationPrefs::default`] = 전부 끔)이고 **절대 오류를 내지
/// 않는다**. [`load_at`] 이 `sanitize` 를 지나므로 돌아오는 값은 이미 제정신 범위 안이다.
pub fn automation_prefs() -> AutomationPrefs {
    match settings_path() {
        Some(path) => load_at(&path).automation,
        None => AutomationPrefs::default(),
    }
}

/// 저장된 `[remote]` 섹션 — 관문([`crate::remote`])이 켤 때·설정 저장 뒤에 읽는다([`automation_prefs`] 와 같은 부류).
/// 파일이 없거나 깨졌으면 기본값(끔). 디스크를 읽으므로 블로킹 문맥에서만 부른다.
pub fn remote_prefs() -> RemotePrefs {
    settings_path().map(|p| load_at(&p).remote).unwrap_or_default()
}

/// [연결](`remote/serve.rs`) — 디스크의 설정에서 `[remote]` 만 켬 · 이 이름 · 이 포트(0 · `None` = 안 정함)로 바꿔 쓴다
/// ([`set_wallpaper_file`] 과 같은 부류 — 화면의 저장 전 편집은 파일에 실리지 않는다). **블로킹**.
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

/// 원격 창의 `save_settings` 칸 단위 문(R1a-4 — `remote/deny.rs`) — `(지금 저장된 값, 들어온 값을 정리한 것)`. 저장과 같은 정리를
/// 거친 뒤 견줘야 "안 바꾼 칸" 이 바뀐 것으로 보이지 않는다. **블로킹**(파일을 읽는다).
pub(crate) fn current_and_sanitized(mut incoming: AppSettings) -> (AppSettings, AppSettings) {
    incoming.sanitize();
    let current = settings_path().map(|p| load_at(&p)).unwrap_or_default();
    (current, incoming)
}

/// 저장된 무입력 자동 잠금(분 — `[app] idle_lock_min`, 끔이면 `None`). 원격 관문이 원격 세션의 무입력 시한으로 쓴다(R1a-2 —
/// 원격 창도 자기 가림막 시계를 갖는다, 설계 3절). 디스크를 읽으므로 블로킹 문맥에서만 부른다.
pub fn idle_lock_min() -> Option<u32> {
    settings_path().and_then(|p| load_at(&p).app.idle_lock_min)
}

/// 저장된 월페이퍼 **파일 이름** — 월페이퍼 GC 가 "설정이 가리키는 사본" 을 묻는다.
/// 이름이 [`AppSettings::sanitize`] 를 지나므로 구분자나 `..` 가 섞인 값은 여기 도달하지 않는다.
///
/// 다른 좁은 조회([`app_language`] 등)와 달리 **파일이 깨졌으면 `Err`** 다.
///
/// [`load_at`] 은 못 읽은 파일을 기본값으로 떨어뜨린다(앱이 떠야 하므로). GC 가 그 기본값을
/// 믿으면 "설정은 배경이 없다" 로 읽혀 지금 걸린 사진을 지운다 — 그래서 여기서는 해석 실패를
/// 실패로 올리고, 부르는 쪽은 청소를 건너뛴다 (`wallpaper.rs` 의 `gc`). 파일 없음은 `Ok(None)`.
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

/// 월페이퍼 파일 이름 **한 칸만** 갈아 끼우고 파일에 쓴다 (`None` = 배경 없음).
///
/// 설정 저장은 원래 프런트가 통째로 보내는 일인데, 월페이퍼만은 백엔드가 직접 쓴다 —
/// 이미지 복사·삭제가 **되돌릴 수 없는 파일시스템 작업**이라 [저장] 을 누르기 전까지
/// "아직 안 쓴 상태" 로 들고 있을 수가 없기 때문이다. 지금 디스크에 있는 값을 읽어
/// 이 한 칸만 바꿔 다시 쓰므로, 프런트가 편집 중인 다른 값은 건드리지 않는다
/// (그 값들은 프런트의 다음 [저장] 이 이긴다).
pub fn set_wallpaper_file(file: Option<String>) -> Result<(), String> {
    let path = settings_path().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )?;
    let mut settings = load_at(&path);
    settings.wallpaper.file = file;
    save_at(&path, &settings)
}
