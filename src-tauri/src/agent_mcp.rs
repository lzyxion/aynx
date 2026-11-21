//! aynx 이 띄우는 에이전트에 외부 MCP 서버를 싣는 규칙 (docs/log/2026-10-01-mcp-inject.md).
//!
//! 사용자 ~/.claude.json · ~/.codex/config.toml 은 쓰지 않는다 — Claude 는 앱 데이터 루트의 JSON 파일, Codex 는 -c TOML 값으로 다음 실행에만 싣는다.
//! 세션 서버는 [ai]의 켬/끔·대상 선택에 따라 같은 실행 설정에 더한다. 외부 목록에서 현재·옛 이름은 거절한다.
//! 토큰은 Claude 실행 설정 파일에만 쓰고 Codex 인자에는 토큰 환경변수 이름만 싣는다.
//! 로컬 autorun 관문과 로컬 셸 타일의 장식 파일(`crate::agent_tile`)에서만 부른다. SSH 는 여기를 지나지 않고, WSL 은 파일 · 인자 모두 싣지 않는다.

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
    /// 없으면 두 에이전트 모두(옛 설정 호환), 빈 배열이면 주입하지 않는다. 모르는 id 는 무시한다.
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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub side_chat: bool,
    /// 옛 칸 — 옛 `settings.toml` 에 남아 있어도 이 항목을 버리지 않게(`deny_unknown_fields`) 읽기만 받고 다음 저장에서 빠진다.
    #[serde(default, rename = "side_chat_no_ask", skip_serializing)]
    pub(crate) legacy_no_ask: Option<bool>,
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

/// 값 자체는 오류 문구에 싣지 않는다.
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
            tr!(ko: "Aynx 의 MCP 서버 이름은 쓸 수 없습니다", en: "The Aynx MCP server names are reserved"),
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

/// 꺼진 항목도 검사하므로 다음에 켜도 안전하다.
pub(crate) fn clean_servers(servers: &mut Vec<McpServer>) {
    let mut names = HashSet::new();
    servers
        .retain(|s| validate(s).is_none() && names.insert((s.project_id.clone(), s.name.clone())));
}

/// existing_names 에는 편집 중인 자기 이름을 빼고 보낸다.
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

/// 세션 서버 토큰은 이 파일에만 들어간다.
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

pub(crate) fn claude_entry(s: &McpServer) -> Value {
    if s.transport == "stdio" {
        json!({ "type": "stdio", "command": s.command, "args": s.args })
    } else {
        json!({ "type": "http", "url": s.url })
    }
}

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

pub(crate) fn launch_ok(s: &McpServer) -> bool {
    match s.transport.as_str() {
        "stdio" => s.command.as_deref().is_some_and(value_ok) && s.args.iter().all(|a| value_ok(a)),
        "http" => s.url.as_deref().is_some_and(value_ok),
        _ => false,
    }
}

/// validate 를 지난 값에는 작은따옴표가 없다.
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

/// `--strict-mcp-config` 는 쓰지 않는다 — 사용자의 다른 MCP 를 유지한다.
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

/// 오케스트레이션 도구의 미리 허용은 없다 — 타일은 조정자 자리가 되지 못한다(미리 허용은 프로듀서 채팅만 — `server::producer::launch`).
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

/// 옛 조정자 역할 설정 파일 이름 — 새로 쓰지도 주장을 받지도 않는다. 옛 판이 남긴 파일(죽은 조정자 토큰이 든)을 시작 정리가 지우는 데만 쓴다.
fn is_role_config(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("orch-").and_then(|r| r.strip_suffix(".json")) else {
        return false;
    };
    let Some((run, gen)) = rest.rsplit_once("-g") else {
        return false;
    };
    crate::orchestration::is_run_id(run) && !gen.is_empty() && gen.len() <= 10 && gen.bytes().all(|b| b.is_ascii_digit())
}

/// 옛 `orch-att-<32 hex>.json` 도 받는다 — 시작 정리가 지울 수 있게.
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

/// 세션 서버가 작업자 · 검토자 Claude 턴의 실행 설정 파일을 쓴다 — 그 턴의 작업자 토큰만(`--strict-mcp-config` 와 짝 — 사용자 MCP 는 싣지 않는다).
/// 파일은 턴 자원이다 — 쓰기 전에 그 턴의 열쇠(`claim`)가 쥔다고 적고, 서버가 그 턴의 트리 종료를 확인한 뒤 놓는다.
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

// ── 실행 설정 파일(`agent-mcp/{GUI pid}-{해시}.json`)의 수명 ──
// 셸은 세션 서버의 자식이라 GUI 가 죽어도 살고 claude 는 `/mcp` 재연결 때 파일을 다시 읽는다 — "다른 pid 의 파일은 지운다" 는 쓰지 않는다.
// 주장: GUI 는 쓰기 전에 서버에 알리고, 서버는 세션 자원을 회수할 때 놓아 아무도 안 쥔 파일을 지운다. 시작 정리: 서버에 묻지 못하면 아무것도 지우지 않는다.

static CLAIMS: LazyLock<Mutex<HashMap<String, HashSet<String>>>> = LazyLock::new(Default::default);

fn claims() -> std::sync::MutexGuard<'static, HashMap<String, HashSet<String>>> {
    CLAIMS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 경로 · 다른 파일은 받지 않는다.
fn config_pid(name: &str) -> Option<u32> {
    let (pid, hash) = name.strip_suffix(".json")?.split_once('-')?;
    let ok = hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then(|| pid.parse::<u32>().ok()).flatten()
}

/// 이름이 실행 설정 파일 · 장식 파일 모양이 아니면 `false` — 경로 조작 불가(이름만 받는다).
pub(crate) fn claim(stream: &str, file: &str) -> bool {
    if (config_pid(file).is_none() && !is_worker_config(file) && !crate::agent_tile::is_file_name(file)) || stream.is_empty() {
        return false;
    }
    claims().entry(file.to_string()).or_default().insert(stream.to_string());
    true
}

pub(crate) fn claimed_files() -> Vec<String> {
    let mut v: Vec<String> = claims().keys().cloned().collect();
    v.sort();
    v
}

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

/// 이름에 pid 가 없으니 서버의 살아 있는 세션이 쥔 것만 남긴다.
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

/// 산 턴이 없는 파일은 옛 서버의 것이다(그 턴 잡은 옛 서버의 잡과 함께 끝났다).
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

/// 서버에 묻지 못하면 아무것도 지우지 않는다 — 살아남은 claude 의 설정을 지우는 것보다 남기는 쪽이 안전하다.
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

/// PTY에 토큰을 주는 타일만 세션 서버를 받는다.
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

/// 파일 실패는 이 장식만 빼고 띄우기는 계속한다. 실행 설정 파일을 쓰기 전에 세션 서버에 주장한다. 블로킹(파일 · 파이프 왕복).
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

/// 블로킹 — 실행 설정 파일을 쓴다(주장 먼저).
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
    // 타일 권한 훅은 로컬 AI 타일 · 감싸개 셸 타일의 그 프로세스에만 — 사용자 전역 훅 파일은 건드리지 않는다.
    if inject_mcp_token {
        tokens.extend(crate::tile_permission::hook_words(agent));
    }
    tokens
}

/// AI 타일과 같은 범위 판정에서 켠 · 사이드 채팅을 고른 것만 — 대상 칩(`agents`)은 보지 않는다.
pub(crate) fn side_chat_selected(servers: &[McpServer], project: Option<&str>) -> Vec<McpServer> {
    servers_for_project(servers, project).into_iter().filter(|s| s.enabled && s.side_chat).collect()
}

/// 세션 서버가 저장된 설정을 직접 읽는다 — 목록은 프런트 인자로 오지 않는다. 블로킹.
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
