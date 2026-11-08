//! **로컬 셸 타일의 에이전트 장식 파일** — 셸에서 손으로 친 `claude` · `codex` 도 앱이 띄운 AI 타일과 같게
//! (2026-10-26 에이전트 활성화 2단계 · 로컬. 원격은 PATH 심 `crate::agent_shim`).
//!
//! ## 무엇이 어디로
//!
//! 1. 감싸개가 있는 타일([`has_wrapper`] — PowerShell · Git Bash, 로컬 셸 통합 켬)을 열면 GUI 가 그 타일 환경에 장식 파일의 **경로**
//!    (`AYNX_TILE_AGENT` — [`crate::tile_env::TILE_AGENT_ENV`])를 넣고, 세션 서버 `open` 에 `mcp` 를 켜 타일 MCP 토큰을 받게 한다
//!    (`ai` 는 거짓 — AI 타일이 아니다, 서버 표의 `is_ai_tile` · 그 타일의 AI 읽기 허용은 예전 그대로). 경로는 스트림에서 정해진다([`path_for`]) — 토큰은 `open` 에서
//!    뽑히므로 파일은 열기가 선 **뒤에** 쓴다(`server::proxy::open_local_session` → [`prepare`]).
//! 2. 파일 = 에이전트마다 한 줄 `AYNX_ARGS_<ID>=<낱말을 \x1f 로 이은 값>`([`body`]). 낱말은 autorun 한 문
//!    (`crate::agent_autorun::agent_autorun_command`)과 **같은 장식**이다: 추가 인자 `[ai.args]`(`crate::agent_args::parse_args`) ·
//!    MCP(`crate::agent_mcp::configured_tokens` — Claude `--mcp-config <실행 설정 파일>` · Codex `-c` · 오케스트레이션 도구의 미리 허용은 없다 —
//!    타일은 조정자 자리가 되지 못한다) · Codex Windows 실행 환경
//!    인자(`crate::codex_launch::codex_extra_args`). `--no-daemon` 은 낱말이 아니다 — 감싸개가 타일 환경 `AYNX_CODEX_NO_DAEMON` 과
//!    `crate::codex_launch` 규칙(이미 `--no-daemon` · `--remote` 면 안 끼움)으로 끼운다.
//! 3. 셸 통합의 감싸개(`crate::shell_integration` 의 `PS_AGENT_WRAPPER` · `GITBASH_AGENT_WRAPPER`)가 그 줄을 읽어(소스 · `eval` 없이) 끼운다 —
//!    자리는 `crate::agent_args` 의 `place` 와 같다(Claude 줄 끝 · Codex 실행 파일 뒤, `resume`/`fork` 면 그 뒤). 파일이 없으면 그대로.
//! 4. 감싸개가 장식을 맡는 줄이면 autorun 은 장식하지 않는다([`wrapper_decorates`] — 두 번 붙지 않게).
//!
//! ## 비밀
//!
//! 파일에 **토큰 값은 없다** — Claude 는 토큰이 든 실행 설정 파일의 경로, Codex 는 토큰 변수 이름(값은 서버가 `open` 에서 셸 환경에 넣었다).
//! 그래도 그 실행 설정 파일과 같은 폴더(`<데이터 루트>/agent-mcp/`) · 같은 쓰기(권한 먼저 · 원자 교체 — `agent_mcp::write_config`)다.
//!
//! ## 수명
//!
//! 쓰기 **전에** 세션 서버에 "이 스트림이 이 파일을 쓴다" 를 알리고(`agent_mcp::claim` — 이름 [`is_file_name`]), 서버가 세션 자원을
//! 회수할 때 지운다(`agent_mcp::release_stream`). GUI 시작 정리는 산 세션이 쥔 것만 남긴다. 설정을 바꾸면 **새 타일부터**.

use std::path::PathBuf;

use sha2::{Digest, Sha256};

/// 장식 파일 이름의 앞 · 뒤 — `tile-<스트림 SHA-256 앞 16 hex>.env`(스트림의 `:` 는 Windows 파일 이름에 못 쓴다).
const PREFIX: &str = "tile-";
const SUFFIX: &str = ".env";

/// 감싸개가 장식을 맡는 실행 파일 이름 — 감싸개는 함수 `claude` · `codex` 라 `claude.exe` 처럼 친 줄은 거치지 않는다.
const WRAPPED: [&str; 2] = ["claude", "codex"];

/// 이 셸에 감싸개가 서는가 — PowerShell · Git Bash 이고 로컬 셸 통합 스크립트를 실었을 때(**순수**). cmd 는 감싸개가 없고 WSL 은
/// 윈도우 쪽 환경이 건너가지 않는다(autorun 도 MCP 를 싣지 않는다).
pub(crate) fn has_wrapper(shell_id: &str, integration: bool) -> bool {
    integration && matches!(shell_id, "pwsh" | "powershell" | "gitbash")
}

/// 스트림 → 파일 이름(**순수**).
fn file_name(stream: &str) -> String {
    let d = Sha256::digest(stream.as_bytes());
    let hex: String = d.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{PREFIX}{hex}{SUFFIX}")
}

/// 장식 파일 이름 모양인가 — 경로 · 다른 파일은 받지 않는다(서버의 주장 · 시작 정리).
pub(crate) fn is_file_name(name: &str) -> bool {
    name.strip_prefix(PREFIX)
        .and_then(|r| r.strip_suffix(SUFFIX))
        .is_some_and(|h| h.len() == 16 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// 그 스트림의 장식 파일 — 데이터 루트가 없거나 스트림 모양이 틀렸으면 `None`.
pub(crate) fn path_for(stream: &str) -> Option<PathBuf> {
    if !crate::tile_env::stream_ok(stream) {
        return None;
    }
    Some(crate::instance::data_root()?.join("agent-mcp").join(file_name(stream)))
}

/// 타일 환경에 넣을 값 — `/` 구분자(PowerShell · Git Bash 가 함께 읽는다).
pub(crate) fn env_value(path: &std::path::Path) -> Option<String> {
    path.to_str().map(|p| p.replace('\\', "/"))
}

/// 파일 내용(**순수**) — 에이전트마다 한 줄. 제어 문자가 든 낱말 · 빈 낱말이 있으면 그 에이전트의 줄은 뺀다(감싸개가 `\x1f` · 줄로 가른다 —
/// 규칙을 지난 낱말에는 없다). 낱말이 없는 에이전트도 줄이 없다.
pub(crate) fn body(words: &[(&str, Vec<String>)]) -> String {
    let mut out = String::from("# aynx tile agent words - generated; removed when the tile closes\n");
    for (id, w) in words {
        if w.is_empty() || w.iter().any(|x| x.is_empty() || x.chars().any(char::is_control)) {
            continue;
        }
        out.push_str(&format!("AYNX_ARGS_{}={}\n", id.to_ascii_uppercase(), w.join("\u{1f}")));
    }
    out
}

/// 그 에이전트의 낱말 — autorun 한 문과 같은 장식(모듈 머리말 2). 순서도 autorun 이 놓는 결과와 같다: Claude 추가 인자 → MCP,
/// Codex 실행 환경 → MCP → 추가 인자. **블로킹**(설정 · 실행 설정 파일 · 파이프).
fn words_for(
    agent: &str,
    shell: &str,
    cwd: Option<&str>,
    sessions: Option<&crate::agent_mcp::SessionsServer>,
    stream: &str,
) -> Vec<String> {
    let extra = crate::settings::agent_extra_args(agent)
        .and_then(|raw| crate::agent_args::parse_args(&raw).ok())
        .unwrap_or_default();
    let mcp = crate::agent_mcp::configured_tokens(agent, Some(shell), cwd, true, sessions, Some(stream));
    if agent == "codex" {
        let mut w = crate::codex_launch::codex_extra_args(crate::codex_launch::codex_launch_env().as_ref());
        w.extend(mcp);
        w.extend(extra);
        w
    } else {
        extra.into_iter().chain(mcp).collect()
    }
}

/// 열기가 선 뒤 — 장식 파일을 쓴다(주장 먼저). 실패는 로그 한 줄이고 타일은 그대로(감싸개가 그대로 넘긴다). 토큰은 Rust 안에서만 —
/// 세션 서버 좌표(`ai_proxy::sessions_server_for` — 그 타일의 토큰)는 실행 설정 파일에만 쓰인다.
pub(crate) async fn prepare(stream: String, shell: String, cwd: Option<String>) {
    let sessions = crate::server::ai_proxy::sessions_server_for(Some(&stream)).await;
    let done = tauri::async_runtime::spawn_blocking(move || {
        let path = path_for(&stream)?;
        let name = path.file_name()?.to_str()?.to_string();
        let words: Vec<(&str, Vec<String>)> = WRAPPED
            .iter()
            .map(|a| (*a, words_for(a, &shell, cwd.as_deref(), sessions.as_ref(), &stream)))
            .collect();
        if !crate::server::ai_proxy::claim_agent_mcp_blocking(&stream, &name) {
            eprintln!("[aynx] agent-tile: 세션 서버에 장식 파일을 알리지 못했습니다(다음 시작 정리가 지울 수 있음)");
        }
        crate::agent_mcp::write_config(&path, &body(&words))
    })
    .await;
    if !matches!(done, Ok(Some(()))) {
        eprintln!("[aynx] agent-tile: 장식 파일을 쓰지 못했습니다 — 그 타일의 claude · codex 는 장식 없이 돕니다");
    }
}

/// 이 autorun 줄은 감싸개가 장식하는가 — 첫 낱말이 정확히 `claude` · `codex`(감싸개 함수 이름) · 감싸개가 서는 셸 · 그 스트림의
/// 장식 파일이 있다(파일이 있다 = 열 때 감싸개 타일이었다). 그러면 autorun 은 장식하지 않는다(두 번 붙지 않게). **블로킹**(파일 확인).
pub(crate) fn wrapper_decorates(command: &str, shell: Option<&str>, stream: Option<&str>) -> bool {
    let first = command.split_whitespace().next().unwrap_or_default();
    WRAPPED.contains(&first)
        && shell.is_some_and(|s| has_wrapper(s, true))
        && stream.and_then(path_for).is_some_and(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_is_a_fixed_shape_from_the_stream() {
        let a = file_name("0123abcd0123abcd0123abcd0123abcd");
        assert!(is_file_name(&a), "{a}");
        assert_eq!(a, file_name("0123abcd0123abcd0123abcd0123abcd"), "같은 스트림 = 같은 이름");
        assert_ne!(a, file_name("p-1:x"));
        assert!(is_file_name(&file_name("p-1:x")), "`:` 가 든 스트림도 파일 이름은 hex");
        for bad in ["tile-.env", "tile-0123.env", "tile-0123456789ABCDEF.env", "../tile-0123456789abcdef.env", "x-0123456789abcdef.env"] {
            assert!(!is_file_name(bad), "{bad}");
        }
        assert!(path_for("a b").is_none(), "모양이 틀린 스트림");
    }

    #[test]
    fn wrapper_stands_only_in_powershell_and_git_bash_with_integration() {
        for s in ["pwsh", "powershell", "gitbash"] {
            assert!(has_wrapper(s, true), "{s}");
            assert!(!has_wrapper(s, false), "{s} 통합 끔");
        }
        for s in ["cmd", "wsl:Ubuntu", "zsh"] {
            assert!(!has_wrapper(s, true), "{s}");
        }
        // 파일이 없는 스트림 · 감싸개 밖 셸 · `claude.exe` 처럼 친 줄은 autorun 이 그대로 장식한다.
        assert!(!wrapper_decorates("claude", Some("pwsh"), Some("no-such-stream-for-agent-tile-test")));
        assert!(!wrapper_decorates("claude", Some("cmd"), None));
        assert!(!wrapper_decorates("claude.exe", Some("pwsh"), None));
    }

    /// 감싸개가 놓는 결과(실기는 `shell_integration` 의 진짜 셸 시험)가 autorun 한 문의 줄과 낱말 순서까지 같다 — 장식 순서
    /// (Claude 추가 인자 → MCP · Codex 실행 환경 → MCP → 추가 인자)가 `words_for` 의 계약이다.
    #[test]
    fn wrapper_order_matches_the_autorun_line() {
        let extra = vec!["--model".to_string(), "o3".to_string()];
        let mcp = vec!["-c".to_string(), "mcp_servers.a.url='http://x'".to_string()];
        let launch = crate::codex_launch::CodexLaunchEnv { filtered_path: "C:/w".into(), original_path: "C:/o".into() };
        let env_args = crate::codex_launch::codex_extra_args(Some(&launch));
        // autorun: 추가 인자 → MCP → --no-daemon → 실행 환경(`agent_autorun_command` 의 순서).
        let line = crate::agent_args::with_tokens("codex resume X", Some("pwsh"), &extra);
        let line = crate::agent_args::with_tokens(&line, Some("pwsh"), &mcp);
        let line = crate::codex_launch::codex_line(&line, true).unwrap();
        let line = crate::codex_launch::codex_line_with_env(&line, Some("pwsh"), Some(&launch)).unwrap();
        // 감싸개: 하위명령 → --no-daemon → 파일 낱말(실행 환경 → MCP → 추가 인자) → 나머지.
        let words: Vec<String> = env_args.iter().chain(&mcp).chain(&extra).cloned().collect();
        let wrapped = ["codex", "resume", "--no-daemon"]
            .into_iter()
            .map(String::from)
            .chain(words)
            .chain(["X".to_string()])
            .map(|w| crate::agent_args::quote(&w, crate::agent_args::QuoteStyle::PowerShell))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(line, wrapped);
        // Claude: 줄 끝에 추가 인자 → MCP.
        let cmcp = vec!["--mcp-config".to_string(), "C:/a/1-ab.json".to_string()];
        let line = crate::agent_args::with_tokens("claude --resume q", Some("gitbash"), &extra);
        let line = crate::agent_args::with_tokens(&line, Some("gitbash"), &cmcp);
        assert_eq!(line, format!("claude --resume q {} {}", extra.join(" "), cmcp.join(" ")));
    }

    #[test]
    fn body_joins_words_with_unit_separator_and_drops_unsafe_lines() {
        let b = body(&[
            ("claude", vec!["--model".into(), "opus 5".into(), "--mcp-config".into(), "C:/x/agent-mcp/1-ab.json".into()]),
            ("codex", vec!["-c".into(), "features.prefer_mxc=true".into()]),
        ]);
        assert!(b.starts_with("# "), "{b}");
        assert!(b.contains("\nAYNX_ARGS_CLAUDE=--model\u{1f}opus 5\u{1f}--mcp-config\u{1f}C:/x/agent-mcp/1-ab.json\n"), "{b:?}");
        assert!(b.contains("\nAYNX_ARGS_CODEX=-c\u{1f}features.prefer_mxc=true\n"), "{b:?}");
        let b = body(&[("claude", vec!["a\nb".into()]), ("codex", vec![]), ("x", vec![String::new()])]);
        assert_eq!(b.lines().count(), 1, "제어 문자 · 빈 낱말 · 빈 목록은 줄이 없다: {b:?}");
    }
}
