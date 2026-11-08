//! 이 실행 파일이 **어느 인스턴스**인가 — 릴리스 `aynx` / 개발 `aynx-dev`
//! (docs/log/2026-09-26-dev-release-isolation.md).
//!
//! 릴리스 앱 안에서 이 앱을 개발하면(`npm run tauri dev`) 두 프로세스가 같은 identifier 와 같은
//! 앱 폴더를 썼다 — 설정·배치·프로젝트는 마지막에 쓴 쪽이 이기고, `vault.bin` 을 둘이 동시에 쥐고,
//! WebView2 사용자 폴더가 같아 개발 쪽 `--remote-debugging-port` 가 무시되고, 둘째 인스턴스가 MCP
//! 포트를 새로 잡아 `mcp.json` 을 고쳐 쓴 뒤 **자동 재등록이 Claude·Codex 의 앱 등록을 개발
//! 포트로 옮겨** 릴리스 AI 타일이 개발 서버와 이야기하게 됐다.
//!
//! 그래서 "어느 인스턴스인가" 를 **여기 한 곳**이 정하고, 앱이 소유하는 경로·MCP 서버 이름·창 제목·
//! WebView 데이터 폴더가 전부 이 파일을 거친다:
//!
//! ```text
//!                       릴리스(tauri build)                       개발(tauri dev · cargo test)
//!   설정 루트           <config_dir>/aynx                    <config_dir>/aynx-dev
//!   데이터 루트         <data_dir>/aynx   (logs·audit·edit)  <data_dir>/aynx-dev
//!   홈 루트             ~/.aynx           (mcp.json·위임)    ~/.aynx-dev
//!   (옛 폴더, 1회 이전) (없음 — 다음 개명 때 채운다)
//!   MCP 서버 이름       aynx-sessions                        aynx-sessions-dev
//!   (옛 MCP 서버 이름)  (없음 — 다음 개명 때 채운다)
//!   MCP 토큰 환경변수   AYNX_MCP_TOKEN                       AYNX_DEV_MCP_TOKEN  (AI 타일)
//!   identifier          io.github.lzyxion.aynx               io.github.lzyxion.aynx-dev  (→ WebView2 폴더)
//!   창 제목             AYNX                                AYNX (dev)
//!   원격 관문 기본 포트 47821                                     47822  (127.0.0.1 — crate::remote)
//! ```
//!
//! ## 스위치 = `cfg!(debug_assertions)`
//!
//! `tauri dev` 는 디버그 프로필, `tauri build` 는 릴리스 프로필로 컴파일한다 — 플래그 없이 평범한
//! `npm run tauri dev` 가 곧바로 격리된다(CLAUDE.md·문서·도구가 전부 그 명령을 쓴다). 환경 변수나
//! 별도 설정 파일은 **잊으면 릴리스 데이터를 만지는** 스위치라 고르지 않았다. `tauri::is_dev()`
//! (custom-protocol 기능 여부)도 후보였지만 그것은 "프런트를 어디서 싣나" 이지 "어떤 빌드인가" 가
//! 아니다 — 최적화되지 않은 빌드는 **전부**(`cargo run`·`cargo test`·`tauri build --debug`) 릴리스
//! 폴더를 만지지 않는 편이 안전하다. 한도 도우미(`aynx claude-usage`)는 같은 실행 파일이라 같은 답을
//! 낸다 — 개발 exe 가 심은 mod 는 개발 폴더에 적는다.
//!
//! 사용자의 것(`~/.claude`·`~/.codex`·`~/.ssh`)은 여기서 가르지 않는다 — 두 인스턴스가 같이 본다.
//! 원격 서버의 `~/.aynx/`(셸 통합)도 서버 쪽 파일이라 그대로다.
//!
//! OS 를 타는 것은 `dirs` 의 세 폴더뿐이라 이 파일에 `#[cfg(target_os)]` 가 없다. macOS 의 WKWebView 는
//! `dataDirectory` 를 모르고(번들 id 로 저장소를 가른다) 개발 exe 는 번들이 아니라, macOS 빌드를
//! 세울 때 `data_store_identifier` 로 가르는 것이 남은 일이다.

use std::path::{Path, PathBuf};

/// 이 빌드가 개발 인스턴스인가 — **유일한 스위치** (모듈 머리말).
pub const DEV: bool = cfg!(debug_assertions);

/// 앱 폴더 이름(`<config_dir>/<이름>` · `<data_dir>/<이름>`).
pub const fn app_dir_name(dev: bool) -> &'static str {
    if dev {
        "aynx-dev"
    } else {
        "aynx"
    }
}

/// 홈 아래 폴더 이름(`~/<이름>/mcp.json` · `delegation.toml`).
pub const fn home_dir_name(dev: bool) -> &'static str {
    if dev {
        ".aynx-dev"
    } else {
        ".aynx"
    }
}

/// 이 인스턴스의 앱 폴더가 **예전에** 쓰던 이름들(최근 이름 먼저) — **이전(migration) 전용 리터럴**.
/// `<config_dir>`·`<data_dir>` 아래에서 찾는다(`settings::migrate_legacy_app_dir`). 첫 존재하는 하나만
/// 옮긴다 — 규칙은 `settings::rename_first_legacy_dir`. 개발과 릴리스는 후보를 따로 둔다 — 두 인스턴스가
/// 서로의 옛 폴더를 가져가지 않는다.
///
/// **지금은 비어 있다** — 바로 앞 이름의 후보는 두 빌드의 이전을 실기로 확인한 뒤 걷었다
/// (docs/log/2026-10-22-rename-aynx.md 의 2차). 기계(이전 함수 · `lib.rs` 의 순서)는 다음 개명을 위해 남겼다 —
/// 그때 여기에 바로 앞 이름 하나만 넣는다(시험은 가짜 이름으로 기계를 잰다).
pub const fn legacy_app_dir_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// [`legacy_app_dir_names`] 의 홈 폴더 판(`~/.<옛 이름>` — `mcp.json`·`delegation.toml`). 지금은 비어 있다.
pub const fn legacy_home_dir_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// `claude mcp add <이름>` · codex `[mcp_servers.<이름>]` 의 서버 이름 — 도구 권한 문자열
/// (`mcp__<이름>__<도구>`)과 핸드셰이크 `serverInfo.name` 도 이것이다. 개발 인스턴스가 이름을 따로
/// 쓰므로 등록 해제 이관이 릴리스의 `aynx-sessions`를 볼 일이 없다.
///
/// 앱 이름(`aynx`)과 다르게 둔 것은 AI CLI 의 서버 목록에서 `aynx` 만으로는 무엇인지 몰라서다 —
/// 앱 이름은 그대로고 이 이름만 바뀌었다(docs/log/2026-10-01-mcp-rename.md).
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

/// 이 인스턴스가 **예전에** 쓰던 MCP 서버 이름들(최근 이름 먼저) — **이전(migration) 전용 리터럴**.
///
/// 인스턴스마다 따로 둔다 — 개발 인스턴스가 릴리스의 옛 이름을 걷어 가거나, 릴리스가 개발의 옛 이름을
/// 건드리는 일이 없게([`mcp_name`] 과 같은 격리 원칙). 이 목록을 쓰는 이전 경로는
/// `mcp::register::spawn_unregister_migration`(현재·옛 이름이 사용자 범위에 있을 때만 걷는다 — 현재 이름의
/// 전역 등록 걷기는 목록이 비어도 돈다).
///
/// **지금은 비어 있다** — 바로 앞 이름은 이 PC 에서 걷혔음을 확인한 뒤 뺐다(docs/log/2026-10-22-rename-aynx.md 의 2차).
pub const fn legacy_mcp_names(dev: bool) -> &'static [&'static str] {
    let _ = dev;
    &[]
}

/// AI 타일 셸에 MCP 토큰을 싣는 환경변수 이름. 두 인스턴스가 한 이름을 쓰면 어느 환경에서든 두
/// 토큰 중 하나만 담겨, 그 이름을 읽던 옛 codex 등록(`bearer_token_env_var`)은 둘 중 하나만 붙었다
/// (docs/log/2026-09-28-codex-mcp-headers.md).
pub const fn mcp_token_env(dev: bool) -> &'static str {
    if dev {
        "AYNX_DEV_MCP_TOKEN"
    } else {
        "AYNX_MCP_TOKEN"
    }
}

/// 창 제목(작업 표시줄·Alt+Tab) — 두 창을 눈으로 가르게.
pub const fn window_title(dev: bool) -> &'static str {
    if dev {
        "AYNX (dev)"
    } else {
        "AYNX"
    }
}

/// 원격 웹 클라이언트 관문(`crate::remote`)의 기본 127.0.0.1 포트 — `[remote] port` 를 안 정했을 때.
/// 두 인스턴스가 함께 떠도 서로의 포트를 잡지 않게 가른다(사용자의 `tailscale serve` 가 가리키는 포트).
pub const fn remote_port(dev: bool) -> u16 {
    if dev {
        47822
    } else {
        47821
    }
}

/// 이 빌드의 창 제목.
pub const WINDOW_TITLE: &str = window_title(DEV);

/// `<config_dir>/aynx[-dev]` — **앱이 소유하는 설정 폴더** (설정·배치·프로젝트·스니펫·이력·볼트·
/// 훅 스크립트·셸 통합 파일·월페이퍼·상태줄 사용량).
///
/// Windows 는 `%APPDATA%`, Linux 는 `~/.config`, macOS 는 `~/Library/Application Support`.
/// 홈을 못 찾는 환경에서는 `None` — 그때는 기본값으로만 동작한다(저장은 오류).
///
/// 폴더 이름이 `identifier` 가 아니라 `aynx` 다. 그래서 asset 프로토콜 스코프도 `$APPCONFIG` 이 아니라
/// `$CONFIG/aynx/<월페이퍼 이름>` 으로 적는다 (`tauri.conf.json` · [`asset_scope`] · docs/log/2026-09-04-wallpaper.md).
pub fn config_root() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join(app_dir_name(DEV)))
}

/// `<data_dir>/aynx[-dev]` — 사용자가 손으로 고칠 일이 없는 쌓이는 것들(세션 로그·감사 로그·원격
/// 편집 사본). Windows 에서는 [`config_root`] 와 같은 폴더다(`%APPDATA%`).
pub fn data_root() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(app_dir_name(DEV)))
}

/// `~/.aynx[-dev]` — MCP 포트·토큰(`mcp.json`)과 위임 목록(`delegation.toml`).
pub fn home_root() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(home_dir_name(DEV)))
}

/// asset 프로토콜 스코프 — `tauri.conf.json` 의 `assetProtocol.scope` 와 같은 모양(테스트가 맞춰 본다).
///
/// **월페이퍼 사본 이름만** 연다(`wallpaper.rs` 의 `is_managed_name` — 해시 `wp-<hex>.<ext>` · 옛
/// `wallpaper.<ext>`, 설정 루트 바로 아래·하위 폴더 없음). 웹뷰가 `convertFileSrc` 로 읽는 파일은 이것뿐이다.
/// 예전에는 설정 루트 전체(`*`·`**`)였고, 그러면 평문 웹훅 파일·`agent-mcp/*.json`(MCP 토큰)·
/// `settings.toml` 이 웹뷰 `fetch` 로 읽히는 범위에 들었다 — XSS 하나로 "프런트로 안 나간다" 불변식이 깨진다.
/// Tauri 의 스코프 glob 은 `*` 가 경로 구분자를 넘지 않는다(`require_literal_separator`).
fn asset_scope(dev: bool) -> Vec<PathBuf> {
    let name = app_dir_name(dev);
    vec![
        PathBuf::from(format!("$CONFIG/{name}/wp-*")),
        PathBuf::from(format!("$CONFIG/{name}/wallpaper.*")),
    ]
}

/// 개발 빌드면 Tauri 설정을 **실행 전에** 고친다 — 릴리스 빌드에서는 아무것도 하지 않는다.
///
/// - `identifier` 에 `-dev` — Tauri 가 WebView2 사용자 폴더를 `<LocalData>/<identifier>` 로 잡으므로
///   개발 창은 따로 브라우저 프로세스를 띄운다(localStorage 가 섞이지 않고
///   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 가 먹는다). 분리 창
///   (`handoff.rs`)도 같은 기본값을 타서 한 폴더를 같이 쓴다.
/// - 창 제목 `AYNX (dev)`.
/// - asset 스코프를 `$CONFIG/aynx-dev/` 의 월페이퍼 이름으로 — 월페이퍼가 개발 폴더에 있고, 개발 창이
///   릴리스 폴더를 asset 으로 읽을 이유가 없다.
///
/// `tauri.conf.json` 에 dev 판을 두지 않은 이유: `tauri dev` 는 별도 설정 파일을 알아서 합치지 않는다
/// (`--config` 플래그가 필요하다) — 평범한 `npm run tauri dev` 가 격리돼야 한다.
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
/// 넣지 않는 것 — 그리고 넣으면 안 되는 이유:
/// - `vault.bin` — 비밀. 개발 빌드가 릴리스 볼트를 들고 있을 이유가 없다(보안 제약: 볼트 밖에 두지 않는다).
/// - `discord-webhook` · `slack-webhook` — 채널별 웹훅 파일 — 비밀(메신저 알림의 웹훅 URL — [`crate::messenger::Channel`]).
///   개발 쪽에서 쓰려면 다시 등록한다.
/// - `mcp.json`·`delegation.toml` — `~/.aynx` 에 살고 애초에 설정 루트가 아니다. 토큰은 개발 쪽이 새로
///   뽑고, 위임(사람 없이 붙어도 되는 범위)은 **명시적으로** 다시 준다.
/// - `hooks/`·`integration*`·`usage/` — 앱이 스스로 다시 만든다(스크립트·셸 통합·사용량 캐시).
/// - 로그·감사·편집 사본 — 데이터 루트의 쌓이는 것들.
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

/// 이 이름을 씨앗으로 복사하는가 — [`SEED_FILES`] 이거나 월페이퍼 사본(`wallpaper.<확장자>` —
/// `settings.toml` 이 이름으로 가리킨다).
fn is_seed_file(name: &str) -> bool {
    SEED_FILES.contains(&name) || name.starts_with("wallpaper.")
}

/// 씨앗을 뿌렸다는 표식(개발 설정 폴더 안). 폴더가 **있느냐**로 가르지 않는 이유: `cargo test` 도 디버그
/// 빌드라 셸을 띄우는 테스트가 `integration.ps1` 을 개발 폴더에 먼저 써 둔다 — 폴더만 보면 씨앗이 영영 안 온다.
const SEED_MARKER: &str = ".seeded";

/// 개발 인스턴스면, 개발 설정 폴더에 씨앗을 **한 번** 뿌린다 — 릴리스 폴더에서 비밀이 아닌 설정을 복사한다.
/// 설정을 읽기 전에(`lib.rs` 의 `run()` 첫머리) 부른다. 릴리스 폴더가 없으면 빈 폴더로 시작한다.
/// 다시 받고 싶으면 개발 폴더(`%APPDATA%\aynx-dev`)를 지우고 다시 띄운다.
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

/// 순수 I/O — **테스트 대상**. 표식([`SEED_MARKER`])이 있으면 `Ok(None)`(아무것도 안 한다). 없으면 폴더를
/// 만들고 `release` 바로 아래의 씨앗 파일 가운데 **개발 쪽에 아직 없는 것만** 복사한 뒤 표식을 남기고, 복사한
/// 이름들을 돌려준다(정렬). 폴더는 따라 들어가지 않는다.
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
    } // 릴리스 폴더가 없다 — 빈 채로 시작한다.
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
        assert_eq!(window_title(false), "AYNX");
        assert_eq!(window_title(true), "AYNX (dev)");
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
        // 지금은 비어 있다(2026-10-22 2차). 다음 개명 때 채우면 아래 격리 · 비겹침 규칙이 그대로 잰다.
        assert!(legacy_mcp_names(false).is_empty());
        assert!(legacy_mcp_names(true).is_empty());
        // 격리: 개발은 릴리스의 옛 이름을, 릴리스는 개발의 옛 이름을 보지 않는다.
        assert!(!legacy_mcp_names(true)
            .iter()
            .any(|n| legacy_mcp_names(false).contains(n)));
        // 어느 쪽 옛 이름도 지금 이름(두 인스턴스 모두)과 겹치지 않는다 — 제 등록을 지우지 않게.
        for dev in [false, true] {
            for n in legacy_mcp_names(dev) {
                assert_ne!(*n, mcp_name(false));
                assert_ne!(*n, mcp_name(true));
            }
        }
    }

    #[test]
    fn legacy_dir_names_are_split_per_instance_and_never_current() {
        // 지금은 비어 있다(2026-10-22 2차 — 바로 앞 이름도 걷었다). 다음 개명 때 채우면 아래 규칙이 잰다.
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
        // 창 제목도 설정 파일과 맞는다(분리 창이 WINDOW_TITLE 을 쓴다).
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
        // 메신저 채널마다의 웹훅 파일 — 채널이 늘어도 여기서 함께 잰다.
        for channel in crate::messenger::Channel::ALL {
            let file = channel.webhook_file();
            assert!(!is_seed_file(file), "{file}");
        }
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
