//! 이 실행 파일이 **어느 인스턴스**인가 — 릴리스 `aynx` / 개발 `aynx-dev` (docs/log/2026-09-26-dev-release-isolation.md).
//! 앱이 소유하는 경로 · MCP 서버 이름 · 창 제목 · WebView 데이터 폴더가 전부 이 파일을 거친다 — 섞이면 개발 앱이 릴리스의
//! 설정 · 볼트 · MCP 등록을 덮는다.
//!
//! 스위치는 `cfg!(debug_assertions)` 하나다 — 환경 변수 · 별도 설정 파일은 잊으면 릴리스 데이터를 만지는 스위치라 쓰지 않고,
//! `tauri::is_dev()` 는 "프런트를 어디서 싣나" 이지 빌드 종류가 아니다. 한도 도우미(`aynx claude-usage`)도 같은 실행 파일이라 같은 답을 낸다.
//!
//! 사용자의 것(`~/.claude`·`~/.codex`·`~/.ssh`)은 여기서 가르지 않는다 — 두 인스턴스가 같이 본다.
//! 원격 서버의 `~/.aynx/`(셸 통합)도 서버 쪽 파일이라 그대로다.
//!
//! macOS 의 WKWebView 는 `dataDirectory` 를 모른다 — macOS 빌드를 세울 때 `data_store_identifier` 로 가르는 것이 남은 일이다.

use std::path::{Path, PathBuf};

/// 이 빌드가 개발 인스턴스인가 — **유일한 스위치**.
pub const DEV: bool = cfg!(debug_assertions);

pub const fn app_dir_name(dev: bool) -> &'static str {
    if dev {
        "aynx-dev"
    } else {
        "aynx"
    }
}

pub const fn home_dir_name(dev: bool) -> &'static str {
    if dev {
        ".aynx-dev"
    } else {
        ".aynx"
    }
}

/// 이 인스턴스의 앱 폴더가 **예전에** 쓰던 이름들(최근 이름 먼저) — **이전(migration) 전용 리터럴**. 개발과 릴리스는
/// 후보를 따로 둔다 — 두 인스턴스가 서로의 옛 폴더를 가져가지 않는다.
///
/// 지금은 비어 있다 — 기계(이전 함수 · `lib.rs` 의 순서)는 다음 개명을 위해 남겼다. 그때 바로 앞 이름 하나만 넣는다.
pub const fn legacy_app_dir_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// [`legacy_app_dir_names`] 의 홈 폴더 판(`~/.<옛 이름>` — `mcp.json`·`delegation.toml`). 지금은 비어 있다.
pub const fn legacy_home_dir_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// `claude mcp add <이름>` · codex `[mcp_servers.<이름>]` 의 서버 이름 — 도구 권한 문자열(`mcp__<이름>__<도구>`)과
/// 핸드셰이크 `serverInfo.name` 도 이것이다 (docs/log/2026-10-01-mcp-rename.md).
pub const fn mcp_name(dev: bool) -> &'static str {
    if dev {
        "aynx-sessions-dev"
    } else {
        "aynx-sessions"
    }
}

/// 지침 관리 블록의 표시 이름 — 사용자 홈 파일 안에서도 두 인스턴스가 서로를 덮지 않는다.
pub const fn instruction_marker_name(dev: bool) -> &'static str {
    if dev {
        "aynx-dev"
    } else {
        "aynx"
    }
}

/// 이 인스턴스가 **예전에** 쓰던 MCP 서버 이름들 — **이전(migration) 전용 리터럴**. 인스턴스마다 따로 둔다
/// ([`mcp_name`] 과 같은 격리 원칙). 지금은 비어 있다.
pub const fn legacy_mcp_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// AI 타일 셸에 MCP 토큰을 싣는 환경변수 이름 — 두 인스턴스가 한 이름을 쓰면 어느 환경에서든 두 토큰 중 하나만 담긴다
/// (docs/log/2026-09-28-codex-mcp-headers.md).
pub const fn mcp_token_env(dev: bool) -> &'static str {
    if dev {
        "AYNX_DEV_MCP_TOKEN"
    } else {
        "AYNX_MCP_TOKEN"
    }
}

pub const fn window_title(dev: bool) -> &'static str {
    if dev {
        "Aynx (dev)"
    } else {
        "Aynx"
    }
}

/// 원격 웹 클라이언트 관문의 기본 127.0.0.1 포트 — 사용자의 `tailscale serve` 가 가리키는 포트라 두 인스턴스를 가른다.
pub const fn remote_port(dev: bool) -> u16 {
    if dev {
        47822
    } else {
        47821
    }
}

pub const WINDOW_TITLE: &str = window_title(DEV);

/// `<config_dir>/aynx[-dev]` — **앱이 소유하는 설정 폴더**. 홈을 못 찾으면 `None`(기본값으로만 동작 · 저장은 오류).
///
/// 폴더 이름이 `identifier` 가 아니라 `aynx` 라 asset 스코프도 `$APPCONFIG` 이 아니라 `$CONFIG/aynx/…` 로 적는다
/// (`tauri.conf.json` · [`asset_scope`] · docs/log/2026-09-04-wallpaper.md).
pub fn config_root() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join(app_dir_name(DEV)))
}

/// `<data_dir>/aynx[-dev]` — 사용자가 손으로 고칠 일이 없는 쌓이는 것들(세션 로그·감사 로그·원격 편집 사본).
pub fn data_root() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(app_dir_name(DEV)))
}

pub fn home_root() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(home_dir_name(DEV)))
}

/// asset 프로토콜 스코프 — `tauri.conf.json` 의 `assetProtocol.scope` 와 같은 모양(테스트가 맞춰 본다).
///
/// **월페이퍼 사본 이름만** 연다 — 설정 루트 전체를 열면 평문 웹훅 파일 · `agent-mcp/*.json`(MCP 토큰) · `settings.toml` 이
/// 웹뷰 `fetch` 로 읽혀 XSS 하나로 "프런트로 안 나간다" 불변식이 깨진다. Tauri 스코프 glob 의 `*` 는 경로 구분자를 넘지 않는다.
fn asset_scope(dev: bool) -> Vec<PathBuf> {
    let name = app_dir_name(dev);
    vec![
        PathBuf::from(format!("$CONFIG/{name}/wp-*")),
        PathBuf::from(format!("$CONFIG/{name}/wallpaper.*")),
    ]
}

/// 개발 빌드면 Tauri 설정을 **실행 전에** 고친다 — `identifier` 에 `-dev`(WebView2 사용자 폴더가 갈린다) · 창 제목 · asset 스코프.
///
/// `tauri.conf.json` 에 dev 판을 두지 않는다 — `tauri dev` 는 별도 설정 파일을 알아서 합치지 않아 평범한 `npm run tauri dev` 가 격리되지 않는다.
pub fn apply_to_context<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
    if !DEV {
        return;
    }
    let config = context.config_mut();
    config.identifier.push_str("-dev");
    for window in &mut config.app.windows {
        window.title = WINDOW_TITLE.to_owned();
    }
    config.app.security.asset_protocol.scope =
        tauri::utils::config::FsScope::AllowedPaths(asset_scope(true));
}

// ---------------------------------------------------------------------------
// 개발 폴더 첫 씨앗
// ---------------------------------------------------------------------------

/// 개발 폴더에 처음 한 번 복사하는 **비밀이 아닌 설정** 파일들(설정 루트 바로 아래).
///
/// 볼트 · 메신저 웹훅 · 봇 토큰 · 짝 파일은 넣으면 안 된다(시험 `seed_list_never_carries_secrets_or_tokens`) — 같은 Telegram 봇을
/// 둘이 받으면 409 · 같은 Discord 봇이면 둘 다 받는다. 위임(`delegation.toml`)은 개발 쪽에 **명시적으로** 다시 준다.
const SEED_FILES: &[&str] = &[
    "settings.toml",
    "workspaces.json", // 열어 둔 탭 — 옛 이름 그대로 (바꾸면 탭 복원이 끊긴다, `app_state.rs`)
    "layouts.json", // v1 릴리스 설정을 dev에 seed하면 이관에 필요하다. v2에서는 읽지 않는다. journal/백업은 seed하지 않는다.
    "theme-profiles.json",
    "snippets.json",
    "projects.json",
    "worktrees.json",
    "history.json",
];

/// 월페이퍼 사본(`wallpaper.<확장자>`)은 `settings.toml` 이 이름으로 가리킨다.
fn is_seed_file(name: &str) -> bool {
    SEED_FILES.contains(&name) || name.starts_with("wallpaper.")
}

/// 폴더가 **있느냐**로 가르지 않는다 — `cargo test` 가 셸을 띄우며 개발 폴더에 먼저 써 두면 씨앗이 영영 안 온다.
const SEED_MARKER: &str = ".seeded";

/// 개발 인스턴스면 릴리스 폴더의 비밀이 아닌 설정을 개발 설정 폴더에 **한 번** 복사한다 — 설정을 읽기 전에 부른다.
pub fn seed_dev_root() {
    if !DEV {
        return;
    }
    let Some(base) = dirs::config_dir() else {
        return;
    };
    let release = base.join(app_dir_name(false));
    let dev = base.join(app_dir_name(true));
    match seed_at(&release, &dev) {
        Ok(None) => {}
        Ok(Some(copied)) => eprintln!(
            "[aynx] 개발 폴더에 씨앗을 뿌렸습니다 — {} 에서 {}개 복사 ({}). 다시 받으려면 {} 를 지우고 다시 띄우세요.",
            release.display(),
            copied.len(),
            copied.join(", "),
            dev.display()
        ),
        Err(e) => eprintln!("[aynx] 개발 폴더 씨앗을 뿌리지 못했습니다 ({}): {e}", dev.display()),
    }
}

/// 개발 쪽에 아직 없는 씨앗 파일만 복사한다(개발 쪽 수정이 덮이지 않게).
fn seed_at(release: &Path, dev: &Path) -> std::io::Result<Option<Vec<String>>> {
    let marker = dev.join(SEED_MARKER);
    if marker.exists() {
        return Ok(None);
    }
    std::fs::create_dir_all(dev)?;
    let mut copied = Vec::new();
    if let Ok(entries) = std::fs::read_dir(release) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let target = dev.join(&name);
            if !is_seed_file(&name)
                || !entry.file_type().is_ok_and(|t| t.is_file())
                || target.exists()
            {
                continue;
            }
            std::fs::copy(entry.path(), &target)?;
            copied.push(name);
        }
    }
    copied.sort();
    std::fs::write(
        &marker,
        "aynx 개발 폴더 씨앗 표식 — 폴더를 지우면 다음 실행에서 릴리스 설정을 다시 복사한다\n",
    )?;
    Ok(Some(copied))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_and_dev_names_differ_and_release_keeps_the_old_names() {
        assert_eq!(app_dir_name(false), "aynx");
        assert_eq!(app_dir_name(true), "aynx-dev");
        assert_eq!(home_dir_name(false), ".aynx");
        assert_eq!(home_dir_name(true), ".aynx-dev");
        assert_eq!(window_title(false), "Aynx");
        assert_eq!(window_title(true), "Aynx (dev)");
    }

    #[test]
    fn roots_follow_the_build_switch() {
        let name = |p: Option<PathBuf>| {
            p.and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        };
        assert_eq!(name(config_root()).as_deref(), Some(app_dir_name(DEV)));
        assert_eq!(name(data_root()).as_deref(), Some(app_dir_name(DEV)));
        assert_eq!(name(home_root()).as_deref(), Some(home_dir_name(DEV)));
        // cargo test 는 디버그 빌드다 — 테스트가 릴리스 폴더를 가리키면 안 된다.
        #[cfg(debug_assertions)]
        assert_eq!(name(config_root()).as_deref(), Some("aynx-dev"));
    }

    #[test]
    fn mcp_token_env_is_split() {
        assert_eq!(mcp_token_env(false), "AYNX_MCP_TOKEN");
        assert_eq!(mcp_token_env(true), "AYNX_DEV_MCP_TOKEN");
    }

    #[test]
    fn mcp_name_is_split() {
        assert_eq!(mcp_name(false), "aynx-sessions");
        assert_eq!(mcp_name(true), "aynx-sessions-dev");
        assert_ne!(mcp_name(false), mcp_name(true));
    }

    #[test]
    fn instruction_marker_names_are_split() {
        assert_eq!(instruction_marker_name(false), "aynx");
        assert_eq!(instruction_marker_name(true), "aynx-dev");
        assert_ne!(instruction_marker_name(false), instruction_marker_name(true));
    }

    #[test]
    fn legacy_mcp_names_are_split_per_instance() {
        assert!(legacy_mcp_names(false).is_empty());
        assert!(legacy_mcp_names(true).is_empty());
        assert!(!legacy_mcp_names(true)
            .iter()
            .any(|n| legacy_mcp_names(false).contains(n)));
        // 어느 쪽 옛 이름도 지금 이름과 겹치지 않는다 — 제 등록을 지우지 않게.
        for dev in [false, true] {
            for n in legacy_mcp_names(dev) {
                assert_ne!(*n, mcp_name(false));
                assert_ne!(*n, mcp_name(true));
            }
        }
    }

    #[test]
    fn legacy_dir_names_are_split_per_instance_and_never_current() {
        for dev in [false, true] {
            assert!(legacy_app_dir_names(dev).is_empty());
            assert!(legacy_home_dir_names(dev).is_empty());
        }
        for dev in [false, true] {
            for n in legacy_app_dir_names(dev) {
                assert!(!legacy_app_dir_names(!dev).contains(n), "{n}");
                assert_ne!(*n, app_dir_name(false));
                assert_ne!(*n, app_dir_name(true));
            }
            for n in legacy_home_dir_names(dev) {
                assert!(!legacy_home_dir_names(!dev).contains(n), "{n}");
                assert_ne!(*n, home_dir_name(false));
                assert_ne!(*n, home_dir_name(true));
            }
        }
    }

    #[test]
    fn release_asset_scope_matches_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let scope: Vec<PathBuf> = conf["app"]["security"]["assetProtocol"]["scope"]
            .as_array()
            .expect("scope 배열")
            .iter()
            .map(|v| PathBuf::from(v.as_str().unwrap()))
            .collect();
        assert_eq!(
            scope,
            asset_scope(false),
            "릴리스 스코프는 tauri.conf.json 그대로"
        );
        assert!(asset_scope(true)
            .iter()
            .all(|p| p.to_string_lossy().contains("/aynx-dev/")));
        // 월페이퍼 이름만 연다 — 루트 전체(`*`)·하위 폴더(`**`)를 다시 열면 웹훅·MCP 토큰이 웹뷰에 닿는다.
        for dev in [false, true] {
            for p in asset_scope(dev) {
                let last = p.file_name().unwrap().to_string_lossy().into_owned();
                assert!(
                    last == "wp-*" || last == "wallpaper.*",
                    "월페이퍼 이름만: {}",
                    p.display()
                );
                assert!(!p.to_string_lossy().contains("**"), "{}", p.display());
            }
        }
        assert_eq!(conf["app"]["windows"][0]["title"], window_title(false));
    }

    #[test]
    fn seed_list_never_carries_secrets_or_tokens() {
        for secret in [
            "vault.bin",
            "mcp.json",
            "delegation.toml",
            "hooks",
            "usage",
            "audit",
            "logs",
            "edit",
            "integration.ps1",
            "integration.sh",
        ] {
            assert!(!is_seed_file(secret), "{secret}");
        }
        // 메신저 채널마다의 비밀 파일(웹훅 · 봇 토큰 — Discord · Slack 은 둘) · 짝 파일 — 채널이 늘어도 여기서 함께 잰다.
        let mut secrets = 0;
        for channel in crate::messenger::Channel::ALL {
            for file in channel.secret_files() {
                assert!(!is_seed_file(file), "{file}");
                secrets += 1;
            }
        }
        assert_eq!(secrets, 5, "discord-webhook · discord-bot · slack-webhook · slack-bot · telegram-bot");
        for file in crate::server::messenger_bridge::CHAT_FILES {
            assert!(!is_seed_file(file), "{file}");
        }
        assert_eq!(crate::server::messenger_bridge::CHAT_FILES.len(), 3);
        assert!(SEED_FILES
            .iter()
            .all(|f| !f.contains("vault") && !f.contains("mcp") && !f.contains("token")));
        assert!(is_seed_file("settings.toml"));
        assert!(is_seed_file("wallpaper.jpg"));
    }

    fn temp(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("aynx-instance-{tag}-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn seed_copies_only_seed_files_once() {
        let root = temp("seed");
        let release = root.join("aynx");
        let dev = root.join("aynx-dev");
        std::fs::create_dir_all(release.join("hooks")).unwrap();
        for f in [
            "settings.toml",
            "projects.json",
            "wallpaper.png",
            "vault.bin",
            "integration.ps1",
        ] {
            std::fs::write(release.join(f), f).unwrap();
        }
        std::fs::write(release.join("hooks").join("aynx-agent-signal.cmd"), "x").unwrap();
        // cargo test 가 셸을 띄우며 먼저 써 둔 파일 — 폴더가 있어도 씨앗은 온다.
        std::fs::create_dir_all(&dev).unwrap();
        std::fs::write(dev.join("integration.ps1"), "dev").unwrap();

        let copied = seed_at(&release, &dev).unwrap().expect("처음엔 뿌린다");
        assert_eq!(
            copied,
            vec!["projects.json", "settings.toml", "wallpaper.png"]
        );
        assert!(!dev.join("vault.bin").exists(), "볼트는 절대 오지 않는다");
        assert!(!dev.join("hooks").exists());
        assert_eq!(
            std::fs::read_to_string(dev.join("settings.toml")).unwrap(),
            "settings.toml"
        );

        // 두 번째는 아무것도 하지 않는다(개발 쪽 수정이 덮이지 않는다).
        std::fs::write(dev.join("settings.toml"), "dev").unwrap();
        assert!(seed_at(&release, &dev).unwrap().is_none());
        assert_eq!(
            std::fs::read_to_string(dev.join("integration.ps1")).unwrap(),
            "dev",
            "개발 쪽 파일은 그대로"
        );
        assert_eq!(
            std::fs::read_to_string(dev.join("settings.toml")).unwrap(),
            "dev"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn seed_without_release_starts_empty() {
        let root = temp("empty");
        let dev = root.join("aynx-dev");
        assert_eq!(seed_at(&root.join("aynx"), &dev).unwrap(), Some(vec![]));
        assert!(dev.is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }
}
