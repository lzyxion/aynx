//! 앱 설정 — `<config_dir>/aynx/settings.toml` 읽기·쓰기.
//!
//! `~/.ssh/config`·`~/.ssh/sessions.toml` 과 성격이 정반대인 파일이다. 저 둘은 ssh·scp·VS Code 와
//! 공유하는 **사용자 소유** 파일이라 앱이 국소 패치만 하지만, 이 파일은 **앱 소유**다. 다른 도구가
//! 읽지 않고 사람이 손으로 고칠 이유도 거의 없으므로 저장할 때 **파일 전체를 다시 쓴다**.
//! 그래서 파서도 단순하다 — 통째로 역직렬화하고, 실패하면 기본값으로 시작한다.
//!
//! ```toml
//! # <config_dir>/aynx/settings.toml
//!
//! [app]                 # 앱 크롬 = theme.css 토큰 오버라이드
//! accent = "#7aa2f7"
//! bg = "#16181d"
//! bg_panel = "#1e2128"
//! fg = "#e6f0ff"        # 아래 넷은 주로 월페이퍼 추출(dynamic)이 채운다
//! border = "#1d2740"
//! err = "#ff3d81"
//! ok = "#34ffa0"
//! warn = "#ffcc44"
//! dynamic = "full"     # 월페이퍼 색 단계 — off | subtle | full. 없으면 월페이퍼가 있을 때 subtle (옛 `true` = full)
//! opacity = 70          # 크롬 · 타일 불투명도 %. 낮추면 앱 배경(월페이퍼)이 비친다 — 창 자체는 늘 불투명
//! auto_reconnect = true # 배치 복원 시 SSH 타일 자동 재접속 (기본 끔 = 수동). 색이 아니라 동작 플래그다
//! header_chip_order = ["ai", "folder"]  # 타일 머리줄 칩 순서 (기본과 같으면 안 적힘). 모르는 id 를 버리고 빠진 칩을 끼우는 것은 프런트
//! header_chips_hidden = ["resource"]   # 끈 머리줄 칩 (비면 안 적힘 = 전부 켬). 옛 `resource_chip = false` 는 프런트가 여기로 옮긴다
//! resource_rings = false # 상태바의 이 PC 전체 CPU · 메모리 고리 (기본 켬 — 끌 때만 적힌다). 보관만 한다
//! usage_rings = false   # 상태바의 AI CLI 사용량 고리 (기본 켬 — 끌 때만 적힌다). 보관만 한다
//! window_controls = true # 제목줄의 최소화 · 최대화 · 닫기 단추 (기본 끔 — 켤 때만 적힌다). 보관만 한다
//! tiling = "focus"      # 새 타일이 어디로 들어가는가 — spiral(기본) | focus. 문자열을 보관만 한다
//! mode = "light"        # 앱 모드 — system(기본) | dark | light. 이것도 문자열을 보관만 한다
//! language = "en"       # 화면 언어 — ko | en. 없으면 OS 를 따른다. 이것도 보관만 한다
//! tile_header = "multi" # 타일 헤더를 언제 다는가 — always(기본) | multi | never. 보관만 한다
//! status_bar = "top"    # 상태바 자리 — left(기본) | top | bottom | right. 이것도 보관만 한다
//! material = "flat"     # 앱 크롬 재질 — glass(기본) | flat. 색과 독립된 축이고 이것도 보관만 한다
//! ui_scale = 125        # UI 크기 % (80~150, 기본 100) — 웹뷰 확대 배율. 터미널 글자는 제 크기를 지킨다
//! ui_font_family = "'Pretendard', sans-serif"  # 앱 글꼴 (CSS font-family). 없으면 theme.css 의 --font-ui
//!
//! [terminal]            # 터미널 내부 = xterm 옵션
//! theme = "aynx-dark"   # 프런트의 내장 프리셋 키 (또는 "dynamic" = 아래 테이블)
//! font_family = "'Cascadia Mono', Consolas, monospace"
//! font_size = 14
//! webgl = true          # WebGL 가속 (기본 켬)
//! osc52_clipboard = false  # 원격(vim·tmux)이 보낸 OSC 52 를 이 PC 클립보드에 쓴다 (기본 켬)
//! osc_notify = false   # 프로그램이 보낸 OSC 9·777 알림을 띄운다 (기본 켬)
//! inline_images = false  # sixel·iTerm2 인라인 이미지를 그린다 (기본 켬)
//! local_shell_integration = false  # 로컬 셸(PowerShell·Git Bash·WSL)에 훅을 심는다 (기본 켬)
//! inline_snippets = false  # 프롬프트에 치는 동안 맞는 스니펫을 커서 옆에 띄운다 (기본 켬)
//! notify_after_secs = 30  # 이만큼 넘게 걸린 명령이 안 보이는 자리에서 끝나면 알린다 (기본 10, 0 = 끔)
//! mark_after_secs = 5   # 이만큼 넘게 걸린 명령에만 오른쪽 끝에 실행 시간을 적는다 (기본 3, 0 = 끔)
//! bell = "visual+sound" # 벨(\a) — visual(기본) | visual+sound | off. 문자열을 보관만 한다
//! opacity = 85          # 터미널 칸의 불투명도 % (10~100, 기본 100). [app] opacity 와 별개다
//!
//! [terminal.dynamic]    # 월페이퍼에서 만든 팔레트 — 프런트가 쓴 문자열을 보관만 한다
//! background = "#0e1415"
//! foreground = "#dee3e5"
//! red = "#f09285"       # … xterm ITheme 의 21칸
//! before-theme = "tokyo-night"  # 색이 아닌 한 칸: 동적을 켜기 직전의 프리셋
//!
//! [shell]               # 기본 셸 — `new-shell` 단축키가 여는 것
//! default = "wsl:Ubuntu"  # ShellInfo.id. 없으면 백엔드 기본(pwsh → powershell)
//!
//! [ai]                  # AI 타일(Claude Code · Codex)
//! start_dir = "C:\\src\\myproject"  # 포커스된 로컬 터미널의 폴더가 없을 때 쓰는 시작 폴더
//! notify_turn_end = false  # Claude Code 턴이 끝나면 알림 (기본 켬 — 끈 사람의 파일에만 적힌다)
//! notify_permission = false  # Claude Code 가 권한을 물으면 알림 (기본 켬 — 끈 사람의 파일에만)
//! notify_side_chat = false  # 사이드 채팅 끝남 · 권한 물음 알림 (기본 켬 — 끈 사람의 파일에만)
//! notify_focused_after_secs = 120  # 보고 있는 타일도 턴이 이만큼 넘게 걸렸으면 알림 (기본 60, 0 = 끔)
//! codex_no_daemon = false  # aynx 이 띄우는·타일에서 친 codex 에 --no-daemon (기본 켬 — 끈 사람의 파일에만)
//! claude_statusline = false  # 로컬 타일의 claude 에 요금제 한도 mod (기본 켬 — 끈 사람의 파일에만 · 이름은 옛것)
//! icon_style = "avatar"  # AI 아이콘 모양 — logo(기본) | avatar. 탭·머리줄·독·알림·로딩 덮개 공통. 보관만 한다
//!                        # (옛 `loading_art = "character"` 는 읽을 때 avatar 로 옮기고 다시 쓰지 않는다)
//! avatar_claude = "user-0123456789ab"  # claude 의 아바타(앱 아이콘 id) — 기본 claude. 보관만 한다
//! avatar_codex = "grok"  # codex 의 아바타 — 기본 gpt
//! disabled_agents = ["codex"]  # 고르는 자리(새 AI 타일·프로젝트·사용량 칩)에서 숨길 에이전트 (기본 = 모두 사용, 비면 안 적힘)
//!
//! [ai.args]             # aynx 이 띄우는 에이전트에 붙일 추가 인자 (에이전트 id → 한 줄, 빈 값 = 없음)
//! claude = "--model opus"  # 규칙·자리는 crate::agent_args (docs/log/2026-09-27-agent-extra-args.md)
//! codex = "-c model=o3"
//!
//! [[ai.mcp_servers]]    # 앱 전체·프로젝트별 외부 서버 — 값은 볼트 참조만, 로컬에서 aynx 이 띄우는 CLI 에만
//! name = "playwright"
//! enabled = true
//! transport = "stdio"  # stdio(command·args) | http(url)
//! command = "npx"
//! args = ["@playwright/mcp@latest"]
//!
//! [wallpaper]           # 창 전체 배경 이미지 (docs/log/2026-09-04-wallpaper.md)
//! file = "wallpaper.jpg"  # <config_dir>/aynx/ 안의 **파일 이름**. 없으면 월페이퍼 없음
//! dim = 60              # 0~100, 이미지 위 검정 덮개 %
//! blur = 0              # 0~20 px
//! fit = "cover"         # cover | contain | tile | center
//!
//! [hosts]               # 호스트 목록 (docs/log/2026-09-23-host-history.md)
//! sort = "recent"       # name(기본) | recent — 문자열을 보관만 한다
//!
//! [files]               # 파일 타일 (docs/log/2026-10-07-file-tile-dolphin.md)
//! default_view = "icons"     # icons | compact | details(기본) — 문자열을 보관만 한다(옛 tree·navigate 는 프런트가 details 로 읽는다)
//! auto_refresh = false       # 로컬 파일 타일 자동 새로고침(기본 켬 — 끌 때만 적는다 · docs/log/2026-10-21-file-tile-auto-refresh.md)
//!
//! [projects]            # 프로젝트 시작 화면 (docs/log/2026-09-26-project-start-screen.md)
//! start_screen = "off"  # auto(기본 — 로컬 프로젝트·워크트리를 열면 늘 선다) | off(곧장 셸) — 문자열을 보관만 한다
//!
//! [dock]                # 떠 있는 독의 자리 (docs/log/2026-10-23-side-chat-dock.md)
//! layout = "launcher-right"  # launcher-left(기본 — 런처 왼쪽 · 채팅 오른쪽) | launcher-right — 문자열을 보관만 한다
//!
//! [plans]               # 작업안 (채팅 독의 작업안 갈래 — 2026-11-01)
//! exec_sort = "oldest"  # newest(기본 — 최근 먼저) | oldest — 실행 목록 정렬. 문자열을 보관만 한다
//!
//! [updates]             # 앱 업데이트 (2026-11-12 — `updater.rs`)
//! auto_check = false    # 시작 · 6시간마다 새 판 확인(기본 켬 — 끌 때만 적는다 · 알리기만 하고 받기 · 설치는 사람이 고를 때만)
//!
//! [messenger]           # 메신저 알림 — 웹훅 채널 (docs/log/2026-09-27-discord-notify.md · 2026-09-28-messenger-channels.md). URL 은 여기 없다
//! discord = false       # Discord 채널로 보내는가 (기본 켬 — 웹훅이 등록돼 있을 때)
//! slack = false         # Slack 채널로 보내는가 (기본 켬 — 웹훅이 등록돼 있을 때)
//! when = "always"       # away(기본 — 자리를 비웠을 때만) | always. 문자열을 보관만 한다
//! agent_stop = false    # 에이전트 턴 끝 (기본 켬)
//! agent_permission = false  # 에이전트 권한 물음 (기본 켬)
//! command_min_secs = 600    # 이만큼 넘게 걸린 명령이 끝나면 (기본 300, 0 = 끔)
//! osc = false           # 프로그램이 보낸 OSC 9·777 알림 (기본 켬)
//! include_command = true    # 명령 줄을 싣는다 (기본 끔 — 비밀이 섞일 수 있다)
//! away_after_min = 10   # 입력이 이만큼 없으면 자리 비움으로 친다 (기본 5, 0 = 가림막만)
//!
//! [remote]              # 원격 웹 클라이언트 관문 (crate::remote · 설계 2026-10-15-remote-web-client-design.md)
//! enabled = true        # 관문을 연다 (기본 끔). 노출은 `tailscale serve` 가 한다(직접 걸거나 설정 화면의 [연결])
//! port = 47821          # 127.0.0.1 포트 (안 정하면 릴리스 47821 · 개발 47822 — instance::remote_port)
//! host = "mypc.tailnet-xxxx.ts.net"  # 받을 Host — 내 MagicDNS 이름 (비면 미설정)
//!
//! [vault]               # 자격증명 금고 (vault.rs) — 비밀은 여기 적히지 않는다
//! auto_lock_minutes = 10  # **더 이상 읽지 않는다** (2026-09-19 저녁 — 가림막이 잠근다).
//!                         # 옛 파일에 적혀 있으면 그대로 왕복만 한다
//!
//! [[triggers]]          # 표시 트리거 — 하이라이트 · 링크 · 툴팁 (셋은 함께 켤 수 있다)
//! pattern = "\\b([A-Z]+-\\d+)\\b"
//! bg = "#7a2637"                              # 있으면 하이라이트
//! url = "https://jira.example.com/browse/$1"  # 있으면 Ctrl+클릭 링크 ($1 = 캡처)
//! tooltip = "이슈 $1"                          # 있으면 마우스 오버 툴팁
//! enabled = true
//! ```
//!
//! 설계안 "디자인 커스텀" 의 3층 중 ①앱 크롬·②터미널 내부만 담는다. ③사용자 CSS 오버라이드
//! 파일(만능 탈출구)은 후속 작업이고, 이 스키마에 키가 하나 더 늘어나는 형태가 될 것이다.
//!
//! **전방 호환**: 모르는 키는 조용히 버린다(serde 기본 동작). 옛 버전 앱이 새 버전이 쓴 파일을
//! 읽어도 아는 부분만 살아남고, 아는 부분만 다시 쓴다.
//!
//! 조각(바깥 경로는 `settings::` 재수출 그대로): `schema.rs`(모양 · serde 기본값) · `appearance.rs` · `automation.rs`(섹션 타입) ·
//! `normalize.rs`(`sanitize` · 상한) · `persistence.rs`(경로 · 읽기 · 저장) · `migration.rs` · `access.rs`(런타임 조회). 여기는 Tauri
//! 명령 둘 — `save_settings` 는 정리 → 저장 → 볼트 프록시 → 트레이 → 원격 관문 순서.

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
// 섹션 타입은 바깥에서 아직 안 부르는 것도 예전 경로(`settings::…`)로 이름 붙일 수 있게 그대로 내보낸다.
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

/// 앱 시작 시 한 번 부른다. 파일이 없거나 깨졌으면 기본값 — **오류를 내지 않는다**.
///
/// **블로킹 풀에서 돈다.** 부르는 시점이 하필 최악이다 — 프런트 마운트 직후, 저장된 배치의
/// 터미널들이 한꺼번에 열리며 이미 출력을 뱉는 그 순간이다. 동기 명령은 웹뷰 UI 스레드에서
/// 그대로 도는데, 그 몇십 ms 사이에 출력 채널 전송이 한 번이라도 실패하면 그 터미널은
/// 영구히 침묵한다 (docs/log/2026-09-05-async-commands.md).
///
/// 백엔드 안에서 쓰는 좁은 조회들([`app_language`]·[`wallpaper_file_checked`])은 그대로 동기다 —
/// 그쪽은 명령이 아니라 setup·창 생성 경로에서 부르는 함수다.
#[tauri::command]
pub async fn load_settings() -> AppSettings {
    // 조인 실패도 기본값이다 — 이 명령에는 오류 자리가 없다(위 계약).
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

/// 설정 화면의 [저장]. 실패는 그대로 프런트에 올라가 화면에 표시된다.
///
/// [`load_settings`] 와 같은 이유로 블로킹 풀에서 돈다 — 이쪽은 `create_dir_all` 과 쓰기가
/// 붙어 있어 디스크가 바쁠 때 더 튄다.
#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = settings;
        settings.sanitize();
        save_at(&path, &settings)?;
        // 티켓·볼트는 세션 서버에 산다(③-3b1) — 구성이 바뀐 서버의 티켓 회수 → 안 쓰는 MCP 값 정리.
        let saved = settings
            .ai
            .mcp_servers
            .iter()
            .flat_map(|server| server.env.iter().chain(&server.headers).map(|entry| entry.secret_ref.clone()))
            .collect();
        crate::server::vault_proxy::settings_saved_blocking(&settings.ai.mcp_servers, saved);
        // 트레이(③-4) — `[app] tray_on_close` 를 켜면 세우고 끄면 걷는다.
        crate::tray::sync(&app);
        // 원격 관문 — `[remote]` 가 바뀌었으면 닫고 다시 연다(같으면 그대로).
        crate::remote::sync(&app);
        Ok(())
    })
        .await
        .map_err(|e| tr!(ko: "설정을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the settings failed: {e}"))?
}

#[cfg(test)]
mod tests;
