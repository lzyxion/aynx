//! **aynx 이 띄우는 에이전트에 외부 MCP 서버를 싣는 규칙** (docs/log/2026-10-01-mcp-inject.md).
//!
//! 설정의 [[ai.mcp_servers]] 는 앱 전체·프로젝트별 목록과 볼트 참조만 담는다. 사용자 ~/.claude.json·~/.codex/config.toml 은
//! 쓰지 않고, Claude 는 앱 데이터 루트의 JSON 파일, Codex 는 -c TOML 값으로 다음 실행에만 싣는다.
//! 세션 서버는 [ai]의 켬/끔·대상 선택에 따라 같은 실행 설정에 더한다. 외부 목록에서 현재·옛 이름은 거절한다.
//! 토큰은 Claude 실행 설정 파일에만 쓰고 Codex 인자에는 토큰 환경변수 이름만 싣는다.
//!
//! 생성은 순수 함수(with_servers·claude_config)이고, 낱말의 셸 인용·자리는 agent_args::with_tokens 하나다.
//! 문자열은 agent_args 의 금지 문자·빈 낱말·끝 역슬래시 규칙에 더해 TOML 리터럴의 작은따옴표도 거절한다.
//! 손으로 고친 파일의 잘못된 항목은 그 항목만 버린다. 같은 범위·이름은 첫 유효 항목만 남긴다.
//!
//! 로컬 autorun 관문(agent_autorun::agent_autorun_command)과 로컬 셸 타일의 장식 파일(`crate::agent_tile` — 2026-10-26, 셸 통합 감싸개가
//! 읽는다 · 같은 [`configured_tokens`])에서만 부른다. SSH 는 Terminal.svelte 의
//! pane.kind === "local" 조건 밖에서 첫 입력을 그대로 보내고, 프로젝트 재실행도 SSH 분기에서 반환한다.
//! WSL 은 여기서도 검사하여 파일·인자 모두 싣지 않는다.
//! 사이드 채팅(2026-10-25)은 세션 서버가 [`side_chat_servers`] 로 저장된 설정을 직접 읽어 `side_chat` 을 고른 서버만 싣는다
//! (`server::side_chat` — 실행 모양은 [`claude_entry`] · [`codex_overrides`] 공용).

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::i18n::tr;

/// 환경변수 메타데이터. 실제 값은 볼트에만 저장한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpEnv {
    pub name: String,
    pub secret_ref: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpServer {
    pub name: String,
    pub enabled: bool,
    /// 없으면 두 에이전트 모두(1차 호환), 빈 배열이면 주입하지 않는다. 모르는 id 는 무시한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<McpEnv>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<McpEnv>,
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 사이드 채팅에도 싣는다(기본 끔 · 옛 설정은 칸 없음 = 끔 — 2026-10-25). 범위 · 켬은 AI 타일과 같은 판정([`side_chat_selected`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub side_chat: bool,
    /// 사이드 채팅에서 이 서버의 도구를 묻지 않고 부른다(기본 끔 = 부를 때마다 승인 카드). 설정 화면(Tauri)에서만 바뀐다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub side_chat_no_ask: bool,
}

// 실행 URL·도우미 인자의 티켓은 Debug에도 남기지 않는다.
impl std::fmt::Debug for McpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServer")
            .field("name", &self.name)
            .field("enabled", &self.enabled)
            .field("agents", &self.agents)
            .field("project_id", &self.project_id)
            .field("env", &self.env)
            .field("headers", &self.headers)
            .field("transport", &self.transport)
            .field("command", &self.command)
            .field("args", &"***")
            .field("url", &self.url.as_ref().map(|_| "***"))
            .field("side_chat", &self.side_chat)
            .field("side_chat_no_ask", &self.side_chat_no_ask)
            .finish()
    }
}

/// TOML·IPC 모두 항목의 자료형 실패를 국소화한다 — 한 항목 때문에 AI 설정 전체를 잃지 않는다.
pub(crate) fn deserialize_servers<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<McpServer>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect())
}

/// agent_args::quote 에 안전하게 실을 수 있는 값 + Codex TOML 작은따옴표 리터럴.
fn value_ok(value: &str) -> bool {
    !value.is_empty()
        && !value.ends_with('\\')
        && value
            .chars()
            .all(|c| !c.is_control() && !crate::agent_args::is_forbidden(c) && c != '\'')
}

/// HTTP 토큰 문자만 허용하며 전송·MCP 세션 헤더는 프록시가 관리한다.
pub(crate) fn header_name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == 96 || b"!#$%&'*+-.^_|~".contains(&b))
        && !["host", "content-length", "transfer-encoding", "connection", "upgrade",
            "mcp-session-id", "mcp-protocol-version", "accept", "content-type", "last-event-id"]
            .contains(&name.to_ascii_lowercase().as_str())
}

/// 한 항목의 판정 — 설정 화면과 띄우기가 함께 쓴다. 값 자체는 오류 문구에 싣지 않는다.
fn validate(server: &McpServer) -> Option<String> {
    let name = &server.name;
    if name.is_empty()
        || name.len() > 48
        || !name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
    {
        return Some(
            tr!(ko: "이름은 영문 소문자·숫자·_·- 1~48자로 적으세요", en: "Use 1–48 lowercase letters, digits, _ or - for the name"),
        );
    }
    if [false, true].into_iter().any(|dev| {
        name == crate::instance::mcp_name(dev)
            || crate::instance::legacy_mcp_names(dev).contains(&name.as_str())
    }) {
        return Some(
            tr!(ko: "AYNX 의 MCP 서버 이름은 쓸 수 없습니다", en: "The AYNX MCP server names are reserved"),
        );
    }
    let mut env_names = HashSet::new();
    if server
        .project_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 128 || id.chars().any(char::is_control))
        || server.env.len() > 128
        || server.env.iter().any(|entry| {
            let mut bytes = entry.name.bytes();
            let valid = bytes
                .next()
                .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
                && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_');
            !valid
                || entry.name.len() > 128
                || entry.secret_ref.is_empty()
                || entry.secret_ref.len() > 512
                || entry.secret_ref.chars().any(char::is_control)
                || !env_names.insert(entry.name.to_ascii_uppercase())
        })
        || (server.transport != "stdio" && !server.env.is_empty())
    {
        return Some(
            tr!(ko: "환경변수 이름·저장된 값 또는 프로젝트가 올바르지 않습니다. 환경변수는 stdio 서버에만 사용할 수 있습니다", en: "Invalid environment names, stored values or project. Environment variables are only available for stdio servers"),
        );
    }
    let mut header_names = HashSet::new();
    if server.headers.len() > 32
        || (!server.headers.is_empty() && server.transport != "http")
        || server.headers.iter().any(|entry| {
            !header_name_ok(&entry.name)
                || entry.secret_ref.is_empty()
                || entry.secret_ref.len() > 512
                || entry.secret_ref.chars().any(char::is_control)
                || !header_names.insert(entry.name.to_ascii_lowercase())
        })
    {
        return Some(tr!(ko: "HTTP 헤더 이름·저장된 값이 올바르지 않습니다. 중복·예약 헤더는 사용할 수 없습니다", en: "Invalid HTTP header names or stored values. Duplicate and reserved headers are not allowed"));
    }
    let valid = match server.transport.as_str() {
        "stdio" => {
            server
                .command
                .as_deref()
                .is_some_and(|s| !s.trim().is_empty() && value_ok(s))
                && server.args.iter().all(|s| value_ok(s))
                && server.url.is_none()
        }
        "http" => {
            server.command.is_none()
                && server.args.is_empty()
                && server.url.as_deref().is_some_and(|s| {
                    value_ok(s)
                        && (s.starts_with("http://") || s.starts_with("https://"))
                        && reqwest::Url::parse(s).is_ok_and(|url| url.host_str().is_some())
                })
        }
        _ => false,
    };
    if valid {
        None
    } else {
        Some(tr!(
            ko: "stdio 는 명령·인자, HTTP 는 http:// 또는 https:// URL 만 적으세요. 빈 값·제어 문자·큰따옴표·작은따옴표·%·굽은 작은따옴표·끝 역슬래시는 쓸 수 없습니다",
            en: "Use command/arguments for stdio, or an http:// or https:// URL for HTTP. Empty values, controls, quotes, %, smart single quotes and trailing backslashes are not allowed"
        ))
    }
}

/// 틀린 항목만 버린다 — 꺼진 항목도 검사하므로 다음에 켜도 안전하다.
pub(crate) fn clean_servers(servers: &mut Vec<McpServer>) {
    let mut names = HashSet::new();
    servers
        .retain(|s| validate(s).is_none() && names.insert((s.project_id.clone(), s.name.clone())));
}

/// 저장 전 항목 검사 — existing_names 에는 편집 중인 자기 이름을 빼고 보낸다.
#[tauri::command]
pub async fn agent_mcp_validate(server: McpServer, existing_names: Vec<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate(&server).or_else(|| {
            existing_names.contains(&server.name).then(
                || tr!(ko: "이미 있는 MCP 서버 이름입니다", en: "This MCP server name already exists"),
            )
        })
    }).await.unwrap_or_else(|_| Some(tr!(ko: "MCP 서버를 검증하지 못했습니다", en: "Could not validate the MCP server")))
}

fn enabled(servers: &[McpServer], agent: &str) -> Vec<McpServer> {
    let mut clean = servers.to_vec();
    clean_servers(&mut clean);
    clean
        .into_iter()
        .filter(|s| {
            s.enabled
                && crate::agent_args::is_agent(agent)
                && s.agents
                    .as_ref()
                    .is_none_or(|agents| agents.iter().any(|id| id == agent))
        })
        .collect()
}

/// Claude --mcp-config 파일 내용 — 세션 서버 토큰은 이 파일에만 들어간다.
fn claude_config(servers: &[McpServer], sessions: Option<&SessionsServer>) -> Option<String> {
    let mut map = serde_json::Map::new();
    for s in enabled(servers, "claude") {
        map.insert(s.name.clone(), claude_entry(&s));
    }
    if let Some(server) = sessions {
        map.insert(
            crate::instance::mcp_name(server.dev).to_owned(),
            json!({ "type": "http", "url": server.url(),
                "headers": { "Authorization": format!("Bearer {}", server.token) } }),
        );
    }
    if map.is_empty() {
        None
    } else {
        Some(json!({ "mcpServers": map }).to_string())
    }
}

/// Claude `--mcp-config` 의 서버 한 칸(실행 모양 — 준비된 서버면 도우미 · 프록시 URL). 사이드 채팅도 쓴다(`side_chat::claude`).
pub(crate) fn claude_entry(s: &McpServer) -> Value {
    if s.transport == "stdio" {
        json!({ "type": "stdio", "command": s.command, "args": s.args })
    } else {
        json!({ "type": "http", "url": s.url })
    }
}

/// Codex `-c` 의 값들(앞의 `-c` 없이) — 서버 한 칸의 실행 모양(stdio = command · args, HTTP = url). 사이드 채팅도 쓴다(`side_chat::codex` —
/// 싣기 전에 [`launch_ok`] 로 다시 본다).
pub(crate) fn codex_overrides(s: &McpServer) -> Vec<String> {
    let prefix = format!("mcp_servers.{}", s.name);
    if s.transport == "stdio" {
        vec![
            format!("{prefix}.command='{}'", s.command.as_deref().unwrap_or_default()),
            format!("{prefix}.args=[{}]", s.args.iter().map(|a| format!("'{a}'")).collect::<Vec<_>>().join(",")),
        ]
    } else {
        vec![format!("{prefix}.url='{}'", s.url.as_deref().unwrap_or_default())]
    }
}

/// 실행 모양(준비된 뒤 — 도우미 경로 · 프록시 URL 포함)이 인자 · TOML 작은따옴표 리터럴에 안전하게 실리나.
pub(crate) fn launch_ok(s: &McpServer) -> bool {
    match s.transport.as_str() {
        "stdio" => s.command.as_deref().is_some_and(value_ok) && s.args.iter().all(|a| value_ok(a)),
        "http" => s.url.as_deref().is_some_and(value_ok),
        _ => false,
    }
}

/// Codex -c 의 TOML 값 — validate 를 지난 값에는 작은따옴표가 없다.
fn codex_tokens(servers: &[McpServer], sessions: Option<&SessionsServer>) -> Vec<String> {
    let mut tokens = Vec::new();
    for s in enabled(servers, "codex") {
        for value in codex_overrides(&s) {
            tokens.push("-c".to_owned());
            tokens.push(value);
        }
    }
    if let Some(server) = sessions {
        let prefix = format!("mcp_servers.{}", crate::instance::mcp_name(server.dev));
        for value in [
            format!("{prefix}.url='{}'", server.url()),
            format!("{prefix}.bearer_token_env_var='{}'", crate::instance::mcp_token_env(server.dev)),
        ] {
            tokens.push("-c".to_owned());
            tokens.push(value);
        }
    }
    tokens
}

/// 그 셸에서 다음 실행할 한 줄 — 순수. Claude 파일 쓰기에 실패했으면 path 를 주지 않는다. 제품 길은 [`apply_configured`] 가
/// [`server_tokens`] 를 줄에 놓는다 — 이것은 그 순수 판(시험). `--strict-mcp-config` 는 **쓰지 않는다**(사용자의 다른 MCP 를 유지 — 설계 C-5).
#[cfg(test)]
fn with_servers(
    line: &str,
    shell: Option<&str>,
    servers: &[McpServer],
    path: Option<&str>,
    sessions: Option<&SessionsServer>,
) -> String {
    if shell.is_some_and(|s| s.starts_with("wsl:")) {
        return line.to_owned();
    }
    let agent = crate::agent_args::agent_of_line(line).map(|(id, _)| id);
    let tokens = agent.map(|a| server_tokens(a, servers, path, sessions)).unwrap_or_default();
    crate::agent_args::with_tokens(line, shell, &tokens)
}

/// 그 에이전트에 붙일 MCP 낱말(셸 글자가 되기 전 — **순수**). Claude 파일 경로가 없거나 실을 수 없으면 아무것도 없다.
/// 줄에 놓는 [`apply_configured`] 와 로컬 셸 타일의 장식 파일(`crate::agent_tile`)이 함께 쓴다. **오케스트레이션 도구의 미리 허용은 없다** —
/// 타일은 조정자 자리가 되지 못한다(목록에도 없다 · 미리 허용은 프로듀서 채팅만 — `server::producer::launch`).
fn server_tokens(agent: &str, servers: &[McpServer], path: Option<&str>, sessions: Option<&SessionsServer>) -> Vec<String> {
    match agent {
        "claude" if claude_config(servers, sessions).is_some() => {
            let Some(path) = path.filter(|p| value_ok(p)) else {
                return Vec::new();
            };
            vec!["--mcp-config".to_owned(), path.to_owned()]
        }
        "codex" => codex_tokens(servers, sessions),
        _ => Vec::new(),
    }
}

/// 옛 조정자 역할 설정 파일 이름 `orch-run-<32 hex>-g<세대>.json` 인가 — 경로 · 다른 파일은 받지 않는다. **옛 파일 호환**: 3차 4단계부터 새로
/// 쓰지 않고(조정자 토큰이 없다) 3차 6단계부터는 주장도 받지 않는다 — 옛 판이 남긴 파일(죽은 조정자 토큰이 든)을 시작 정리가 지우는 데만 쓴다.
fn is_role_config(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("orch-").and_then(|r| r.strip_suffix(".json")) else {
        return false;
    };
    let Some((run, gen)) = rest.rsplit_once("-g") else {
        return false;
    };
    crate::orchestration::is_run_id(run) && !gen.is_empty() && gen.len() <= 10 && gen.bytes().all(|b| b.is_ascii_digit())
}

/// 작업자 · 검토자 턴 설정 파일 이름 `orch-att-<32 hex>-t<턴>.json`(3a — 턴마다 하나 · 서버가 쓴다, [`write_worker_config`]) 또는 옛
/// `orch-att-<32 hex>.json`(2차 — 시작 정리가 지울 수 있게) 인가.
fn is_worker_config(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("orch-").and_then(|r| r.strip_suffix(".json")) else {
        return false;
    };
    let id = match rest.rsplit_once("-t") {
        Some((id, n)) if !n.is_empty() && n.len() <= 6 && n.bytes().all(|b| b.is_ascii_digit()) => id,
        _ => rest,
    };
    crate::orchestration::is_attempt_id(id)
}

/// **세션 서버가** 작업자 · 검토자 Claude 턴의 실행 설정 파일을 쓴다(설계 C-3 ⑤ · 헤드리스 설계 4-5 · D11) — 세션 서버 하나 · **그 턴의**
/// 작업자 토큰(`--strict-mcp-config` 와 짝 — 사용자 MCP 는 싣지 않는다). 파일은 **턴 자원**이다: 쓰기 **전에** 그 턴의 열쇠(`claim`)가 쥔다고
/// 적고, 서버 손이 그 턴의 트리 종료를 확인한 뒤 놓는다([`release_stream`] — 다음 턴은 새 파일). 경로(`/` 구분자)를 돌려준다. 못 쓰면
/// `None`(생성 실패).
pub(crate) fn write_worker_config(attempt_id: &str, turn: u32, port: u16, token: &str, claim_key: &str) -> Option<String> {
    if !crate::orchestration::is_attempt_id(attempt_id) || port == 0 || token.is_empty() || turn == 0 {
        return None;
    }
    let stream = claim_key;
    let server = SessionsServer::running(true, port, token, crate::instance::DEV)?;
    let config = claude_config(&[], Some(&server))?;
    let dir = crate::instance::data_root()?.join("agent-mcp");
    std::fs::create_dir_all(&dir).ok()?;
    let name = format!("orch-{attempt_id}-t{turn}.json");
    let path = dir.join(&name);
    let value = path.to_str()?.replace('\\', "/");
    if !claim(stream, &name) {
        return None;
    }
    write_config(&path, &config)?;
    Some(value)
}

/// 같은 실행 설정 파일 쓰기를 직렬화한다. 임시 파일도 비밀을 쓰기 전에 권한을 좁힌다.
static CONFIG_WRITE: Mutex<()> = Mutex::new(());

/// 로컬 셸 타일의 장식 파일(`crate::agent_tile`)도 같은 쓰기(권한 먼저 · 원자 교체)를 쓴다.
pub(crate) fn write_config(path: &Path, config: &str) -> Option<()> {
    use std::io::Write;

    let _guard = CONFIG_WRITE.lock().ok()?;
    if std::fs::read_to_string(path).ok().as_deref() == Some(config) {
        return crate::vault::restrict_file(path).ok();
    }
    std::fs::create_dir_all(path.parent()?).ok()?;
    let tmp = path.with_extension("tmp");
    // 비밀을 쓰기 전에 권한을 좁힌다. 저장 뒤 rename도 그 권한을 보존한다.
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .ok()?;
    let saved = (|| {
        crate::vault::restrict_file(&tmp).ok()?;
        file.write_all(config.as_bytes()).ok()?;
        drop(file);
        std::fs::rename(&tmp, path).ok()?;
        Some(())
    })();
    if saved.is_none() {
        let _ = std::fs::remove_file(&tmp);
    }
    saved
}

// ---------------------------------------------------------------------------
// 실행 설정 파일(`agent-mcp/{GUI pid}-{해시}.json`)의 수명 — ③-3c · 설계 4.4 "생존 인스턴스·파일 사용 여부"
//
// 파일은 GUI 가 AI 타일을 띄울 때 쓰고(`claude --mcp-config <파일>` — claude 는 시작 때 읽고, `/mcp` 재연결 때 **다시** 읽는다),
// 셸은 세션 서버의 자식이라 GUI 가 죽어도 산다. 그래서 예전의 "다른 pid 의 파일은 지운다" 는 GUI 재시작 때 살아남은 claude 의
// 설정을 지웠다(③-3b1 실기). 이제 규칙은 둘이다:
// - **주장**: GUI 는 파일을 쓰기 **전에** 세션 서버에 "이 스트림(타일)이 이 파일을 쓴다" 를 알린다(op `agent_mcp_claim`). 서버는
//   세션 자원을 회수할 때(셸이 끝났거나 닫혔다) 그 스트림의 주장을 놓고, **아무도 안 쥔 파일은 지운다**([`release_stream`]).
// - **시작 정리**: GUI 가 뜰 때 파일마다 — 이름의 pid 가 살아 있거나(이 GUI 포함), 서버의 살아 있는 세션이 쥐었으면 남긴다.
//   서버에 묻지 못하면 **아무것도 지우지 않는다**(안전한 쪽).
// ---------------------------------------------------------------------------

/// 서버 프로세스의 주장 표 — 파일 이름 → 그 파일을 쓰는 스트림들.
static CLAIMS: LazyLock<Mutex<HashMap<String, HashSet<String>>>> = LazyLock::new(Default::default);

fn claims() -> std::sync::MutexGuard<'static, HashMap<String, HashSet<String>>> {
    CLAIMS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 실행 설정 파일 이름의 모양 `{pid}-{16 hex}.json` 이면 pid — 아니면 `None`(경로·다른 파일은 받지 않는다).
fn config_pid(name: &str) -> Option<u32> {
    let (pid, hash) = name.strip_suffix(".json")?.split_once('-')?;
    let ok = hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then(|| pid.parse::<u32>().ok()).flatten()
}

/// (서버) 이 스트림이 이 파일을 쓴다 — 이름이 실행 설정 파일 · 로컬 셸 타일 장식 파일(`crate::agent_tile`) 모양이 아니면 `false`
/// (경로 조작 불가 — 이름만 받는다).
pub(crate) fn claim(stream: &str, file: &str) -> bool {
    if (config_pid(file).is_none() && !is_worker_config(file) && !crate::agent_tile::is_file_name(file)) || stream.is_empty() {
        return false;
    }
    claims().entry(file.to_string()).or_default().insert(stream.to_string());
    true
}

/// (서버) 살아 있는 세션이 쥔 파일 이름들(정렬).
pub(crate) fn claimed_files() -> Vec<String> {
    let mut v: Vec<String> = claims().keys().cloned().collect();
    v.sort();
    v
}

/// (서버) 세션 자원 회수 — 그 스트림의 주장을 놓고 아무도 안 쥔 파일을 지운다. 지운 수.
pub(crate) fn release_stream(stream: &str) -> usize {
    let orphaned: Vec<String> = {
        let mut c = claims();
        let mut out = Vec::new();
        c.retain(|file, streams| {
            streams.remove(stream);
            let keep = !streams.is_empty();
            if !keep {
                out.push(file.clone());
            }
            keep
        });
        out
    };
    let Some(dir) = crate::instance::data_root().map(|r| r.join("agent-mcp")) else {
        return 0;
    };
    orphaned
        .iter()
        .filter(|name| std::fs::remove_file(dir.join(name)).is_ok())
        .count()
}

/// 시작 정리의 판정 — `keep(pid, 파일 이름)` 이 거짓인 실행 설정 파일과 옛 단일 파일(`agent-mcp.json`)을 지운다. 지운 수.
fn cleanup_configs(root: &Path, keep: impl Fn(u32, &str) -> bool) -> usize {
    let _ = std::fs::remove_file(root.join("agent-mcp.json"));
    let Ok(files) = std::fs::read_dir(root.join("agent-mcp")) else {
        return 0;
    };
    let mut removed = 0;
    for file in files.flatten() {
        let name = file.file_name();
        let Some(name) = name.to_str() else { continue };
        // 쓰다 만 임시 파일(`.tmp`)은 같은 규칙의 `.json` 이름으로 본다.
        let as_json = name.strip_suffix(".tmp").map(|n| format!("{n}.json"));
        let Some(pid) = config_pid(as_json.as_deref().unwrap_or(name)) else {
            continue;
        };
        if !keep(pid, as_json.as_deref().unwrap_or(name)) && std::fs::remove_file(file.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// 조정자 역할 설정 파일(`orch-…`) · 로컬 셸 타일 장식 파일(`tile-…`)의 시작 정리 — 이름에 pid 가 없으니 **서버의 살아 있는 세션이 쥔 것만**
/// 남긴다(`keep`). 지운 수.
fn cleanup_role_configs(root: &Path, keep: impl Fn(&str) -> bool) -> usize {
    let Ok(files) = std::fs::read_dir(root.join("agent-mcp")) else {
        return 0;
    };
    files
        .flatten()
        .filter(|f| {
            f.file_name().to_str().is_some_and(|n| {
                (is_role_config(n) || is_worker_config(n) || crate::agent_tile::is_file_name(n)) && !keep(n)
            })
        })
        .filter(|f| std::fs::remove_file(f.path()).is_ok())
        .count()
}

/// (서버) 시작 때 한 번 — 아무도 쥐지 않은 작업자 · 검토자 턴 설정 파일(`orch-att-…`)을 지운다(헤드리스 설계 4-5 · D11 — 산 턴이 없는
/// 파일은 옛 서버의 것이다: 그 턴 잡은 옛 서버의 자기 잡과 함께 끝났다). 쓰다 만 `.tmp` 도. 지운 수.
pub(crate) fn sweep_worker_configs() -> usize {
    let Some(dir) = crate::instance::data_root().map(|r| r.join("agent-mcp")) else {
        return 0;
    };
    let claimed: HashSet<String> = claimed_files().into_iter().collect();
    let Ok(files) = std::fs::read_dir(&dir) else { return 0 };
    files
        .flatten()
        .filter(|f| {
            f.file_name().to_str().is_some_and(|n| {
                let as_json = n.strip_suffix(".tmp").map(|x| format!("{x}.json")).unwrap_or_else(|| n.to_string());
                is_worker_config(&as_json) && !claimed.contains(&as_json)
            })
        })
        .filter(|f| std::fs::remove_file(f.path()).is_ok())
        .count()
}

/// GUI 시작 때 한 번 — 이름의 pid 가 살아 있지 않고 서버의 살아 있는 세션도 쥐지 않은 실행 설정 파일을 지운다. 서버에 묻지
/// 못하면 아무것도 지우지 않는다(살아남은 claude 의 설정을 지우는 것보다 남기는 쪽이 안전하다).
pub(crate) async fn cleanup_stale_configs() {
    let Some(claimed) = crate::server::ai_proxy::claimed_agent_mcp().await else {
        eprintln!("[aynx] agent-mcp 정리: 세션 서버에 묻지 못해 건너뜁니다");
        return;
    };
    let claimed: HashSet<String> = claimed.into_iter().collect();
    let me = std::process::id();
    let removed = tauri::async_runtime::spawn_blocking(move || {
        let Some(root) = crate::instance::data_root() else { return 0 };
        cleanup_configs(&root, |pid, name| {
            pid == me || crate::server::os::pid_alive(pid) || claimed.contains(name)
        }) + cleanup_role_configs(&root, |name| claimed.contains(name))
    })
    .await
    .unwrap_or(0);
    if removed > 0 {
        eprintln!("[aynx] agent-mcp 정리: 끝난 실행 설정 파일 {removed}개를 지웠습니다");
    }
}

/// 실행 중인 세션 서버의 비밀 좌표 — Debug·직렬화를 파생하지 않는다.
pub(crate) struct SessionsServer {
    port: u16,
    token: String,
    dev: bool,
}

impl SessionsServer {
    pub(crate) fn running(running: bool, port: u16, token: &str, dev: bool) -> Option<Self> {
        (running && port != 0 && !token.is_empty()).then(|| Self {
            port,
            token: token.to_owned(),
            dev,
        })
    }

    fn url(&self) -> String {
        format!("{}/mcp", crate::tile_env::base_url(self.port))
    }
}

/// PTY에 토큰을 주는 타일만 세션 서버를 받는다. 설정·WSL·대상 판정도 순수 함수다.
fn sessions_for<'a>(
    agent: &str,
    shell: Option<&str>,
    inject_mcp_token: bool,
    prefs: &crate::settings::AiPrefs,
    server: Option<&'a SessionsServer>,
) -> Option<&'a SessionsServer> {
    server.filter(|_| {
        inject_mcp_token
            && !shell.is_some_and(|s| s.starts_with("wsl:"))
            && crate::agent_args::is_agent(agent)
            && prefs.mcp_sessions_enabled.unwrap_or(true)
            && prefs.mcp_sessions_agents.as_ref().is_none_or(|agents| {
                agents.iter().any(|id| id == agent)
            })
    })
}

/// autorun 의 한 문만 부른다 — 파일 실패는 이 장식만 빼고 띄우기는 계속한다. `stream` 은 그 타일의 스트림 — 실행 설정 파일을
/// 쓰기 **전에** 세션 서버에 주장한다(`claim` — 그 세션이 살아 있는 동안 파일이 남는다). **블로킹**(파일·파이프 왕복).
/// `sessions` 는 **그 타일의 토큰**을 실은 좌표다(3차 4단계 — 토큰이 타일마다 달라 Claude 파일도 타일마다 하나가 된다). 오케스트레이션 도구의
/// 미리 허용은 없다(오케스트레이션 탭 2단계 — 타일은 조정자 자리가 되지 못한다 · 목록에도 없다).
pub(crate) fn apply_configured(
    line: &str,
    shell: Option<&str>,
    cwd: Option<&str>,
    inject_mcp_token: bool,
    sessions: Option<&SessionsServer>,
    stream: Option<&str>,
) -> String {
    let Some((agent, _)) = crate::agent_args::agent_of_line(line) else {
        return line.to_owned();
    };
    let tokens = configured_tokens(agent, shell, cwd, inject_mcp_token, sessions, stream);
    crate::agent_args::with_tokens(line, shell, &tokens)
}

/// [`apply_configured`] 의 몸 — 그 에이전트에 붙일 MCP 낱말(셸 글자가 되기 전). Claude 실행 설정 파일을 쓰고(주장 먼저) 그 경로를 싣는다.
/// 로컬 셸 타일의 장식 파일(`crate::agent_tile` — 2026-10-26)도 이것을 부른다 — autorun 과 같은 장식이 한 곳에서 나온다. WSL 이면 없음. **블로킹**.
pub(crate) fn configured_tokens(
    agent: &str,
    shell: Option<&str>,
    cwd: Option<&str>,
    inject_mcp_token: bool,
    sessions: Option<&SessionsServer>,
    stream: Option<&str>,
) -> Vec<String> {
    if shell.is_some_and(|s| s.starts_with("wsl:")) || !crate::agent_args::is_agent(agent) {
        return Vec::new();
    }
    let prefs = crate::settings::agent_mcp_prefs();
    let sessions = sessions_for(agent, shell, inject_mcp_token, &prefs, sessions);
    let all = prefs.mcp_servers;
    let project = if all.iter().any(|s| s.project_id.is_some()) {
        project_for_cwd(cwd)
    } else {
        None
    };
    let selected = servers_for_project(&all, project.as_deref());
    let mut servers = Vec::new();
    for server in enabled(&selected, agent) {
        match crate::server::vault_proxy::mcp_prepare_blocking(&server, cwd) {
            Ok(server) => servers.push(server),
            Err(_) => eprintln!("[aynx] 외부 MCP 서버를 준비하지 못했습니다"),
        }
    }
    let path = (|| {
        if agent != "claude" {
            return None;
        }
        let config = claude_config(&servers, sessions)?;
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        config.hash(&mut hash);
        let dir = crate::instance::data_root()?.join("agent-mcp");
        std::fs::create_dir_all(&dir).ok()?;
        // 이름 = GUI pid + 내용 해시 — 3차 4단계부터 토큰이 타일마다 달라 사실상 타일마다 한 파일(조정자 타일도 같다 — 역할 파일은 없다).
        let path = dir.join(format!("{}-{:016x}.json", std::process::id(), hash.finish()));
        let value = path.to_str()?.replace('\\', "/");
        if !value_ok(&value) {
            return None;
        }
        // 쓰기 **전에** 주장한다 — 같은 해시의 파일을 쓰던 다른 타일이 막 닫혀 서버가 지우는 경합에서도 이 타일의 파일이 남게.
        if let (Some(stream), Some(name)) = (stream, path.file_name().and_then(|n| n.to_str())) {
            if !crate::server::ai_proxy::claim_agent_mcp_blocking(stream, name) {
                eprintln!("[aynx] agent-mcp: 세션 서버에 실행 설정 파일을 알리지 못했습니다(다음 시작 정리가 지울 수 있음)");
            }
        }
        write_config(&path, &config)?;
        Some(value)
    })();
    let mut tokens = server_tokens(agent, &servers, path.as_deref(), sessions);
    // **타일 권한 훅**(2026-11-01 — `crate::tile_permission::hook_words`): 로컬 AI 타일 · 감싸개 셸 타일(`inject_mcp_token` — 세션 서버가 같은 타일에
    // 권한 결정 토큰을 뽑는다)의 그 프로세스에만. 사용자 전역 훅 파일은 건드리지 않는다. WSL 은 위에서 이미 빈 것.
    if inject_mcp_token {
        tokens.extend(crate::tile_permission::hook_words(agent));
    }
    tokens
}

/// **사이드 채팅에 실을 외부 서버**(순수 — 2026-10-25) — AI 타일과 같은 범위 판정([`servers_for_project`] — 같은 이름은 프로젝트 항목이
/// 가린다)에서 켠(`enabled`) · 사이드 채팅을 고른(`side_chat`) 것만. 대상 칩(`agents`)은 보지 않는다. `project` = 채팅 cwd 의 프로젝트.
pub(crate) fn side_chat_selected(servers: &[McpServer], project: Option<&str>) -> Vec<McpServer> {
    servers_for_project(servers, project).into_iter().filter(|s| s.enabled && s.side_chat).collect()
}

/// [`side_chat_selected`] 를 **저장된 설정**에서(세션 서버가 직접 읽는다 — 목록은 프런트 인자로 오지 않는다). cwd 의 프로젝트는 AI 타일과
/// 같은 판정([`project_for_cwd`] — 가장 가까운 등록 프로젝트 · 워크트리는 공통 Git 디렉터리). 블로킹(설정 · 프로젝트 파일 · git 한 번).
// 시험 빌드의 서버 표는 가짜 목록을 읽는다(서버 표의 picked_servers).
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn side_chat_servers(cwd: Option<&str>) -> Vec<McpServer> {
    let all = crate::settings::agent_mcp_prefs().mcp_servers;
    if !all.iter().any(|s| s.enabled && s.side_chat) {
        return Vec::new();
    }
    let project = if all.iter().any(|s| s.project_id.is_some()) { project_for_cwd(cwd) } else { None };
    side_chat_selected(&all, project.as_deref())
}

/// 동일 이름은 프로젝트 항목 전체가 우선한다. 꺼진 프로젝트 항목도 전역 항목을 가린다.
fn servers_for_project(servers: &[McpServer], project: Option<&str>) -> Vec<McpServer> {
    let mut clean = servers.to_vec();
    clean_servers(&mut clean);
    let overrides: HashSet<&str> = clean
        .iter()
        .filter(|s| project.is_some() && s.project_id.as_deref() == project)
        .map(|s| s.name.as_str())
        .collect();
    clean
        .iter()
        .filter(|s| match s.project_id.as_deref() {
            None => !overrides.contains(s.name.as_str()),
            Some(id) => Some(id) == project,
        })
        .cloned()
        .collect()
}

fn normalized_path(path: &str) -> String {
    let value = path.replace('\\', "/").trim_end_matches('/').to_owned();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn project_from_roots(cwd: &str, roots: &[(String, String)]) -> Option<String> {
    let cwd = normalized_path(cwd);
    roots
        .iter()
        .filter(|(_, root)| {
            let root = normalized_path(root);
            cwd == root
                || cwd
                    .strip_prefix(&root)
                    .is_some_and(|tail| tail.starts_with('/'))
        })
        .max_by_key(|(_, root)| root.len())
        .map(|(id, _)| id.clone())
}

/// 보통 폴더는 가장 가까운 등록 프로젝트, 워크트리는 공통 Git 디렉터리의 프로젝트를 찾는다.
fn project_for_cwd(cwd: Option<&str>) -> Option<String> {
    let cwd = cwd?;
    let roots = crate::projects::mcp_project_roots();
    project_for_roots(cwd, &roots)
}

fn project_for_roots(cwd: &str, roots: &[(String, String)]) -> Option<String> {
    if let Some(id) = project_from_roots(cwd, roots) {
        return Some(id);
    }
    let mut git = std::process::Command::new("git");
    git.args([
        "-C",
        cwd,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ])
    .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        git.creation_flags(0x0800_0000);
    }
    let output = git.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let common = String::from_utf8(output.stdout).ok()?;
    let repo = Path::new(common.trim()).parent()?.to_str()?;
    project_from_roots(repo, roots)
}

#[cfg(test)]
mod tests;
