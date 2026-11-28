//! 채팅 타일 실행 재료 — 파일은 쓰지만 아무것도 띄우지 않는다(띄우기는 공용 코어 `chat_proc::start` 하나).
//!
//! - **제한 인자가 없다** — 사용자 설정 · 지침 · 도구 · 훅 · 사용자 MCP 를 그대로 쓴다(인자는 어댑터의 `tile_argv` 고정 배열 하나).
//!   권한 모드는 사람이 그 타일에서 고른 값(`State.perm_mode` — 서버가 고를 수 있는 값만 넣는다)일 때만 어댑터가 싣는다.
//!   사용자 추가 인자(`[ai.args]`)는 싣지 않고, 사용자 CLI 설정 파일은 쓰지 않는다.
//! - 토큰 값은 Claude 임시 자리의 `--mcp-config` 본문 · Codex 프로세스 환경에만. 임시 자리는 `<데이터 루트>/chat-tile/.run/<id>-<세대>/`.
//! - 외부 MCP 는 AI 타일과 같은 고르기를 이 프로세스가 저장된 설정에서 직접 읽는다 — op 몸 · 프런트 인자에 목록이 없다.
//! - Claude 는 파일 체크포인트 환경 하나([`CLAUDE_CHECKPOINT_ENV`])를 싣는다 — 사본은 CLI 자신의 `~/.claude/file-history`(앱은 쓰지 않는다).
//!   Codex · 사이드 채팅 · 프로듀서 · 헤드리스 턴에는 싣지 않는다.

use std::path::PathBuf;

use super::super::chat_proc::{Launch, ProcId, Spot};
use super::super::hub;
use super::super::ipc::WireError;
#[cfg(test)]
use super::lock;
use super::{cli_name, fail, State};
use crate::orchestration::turn;
use crate::side_chat::event::Mode;
use crate::side_chat::{claude, codex, Adapter, Cli, Ev};

pub(crate) const CLAUDE_CHECKPOINT_ENV: &str = "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING";

fn chat_tile_root() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&super::FAKE).as_ref() {
        return Some(f.root.clone());
    }
    Some(crate::instance::data_root()?.join("chat-tile"))
}

fn mcp_port() -> Option<u16> {
    #[cfg(test)]
    if let Some(f) = lock(&super::FAKE).as_ref() {
        return f.mcp_port;
    }
    hub::signal_port()
}

/// AI 타일과 같은 설정 판정(`[ai] mcp_sessions_*`).
fn sessions_on(agent: &str) -> bool {
    #[cfg(test)]
    if lock(&super::FAKE).is_some() {
        return true;
    }
    crate::agent_mcp::chat_tile_sessions_on(agent)
}

/// `Debug` 를 파생하지 않는다(토큰).
struct ChatMcp {
    name: &'static str,
    url: String,
    token: String,
}

/// `None` 이면 그 프로세스는 Aynx MCP 없이 뜬다.
fn chat_mcp(id: &str, cli: Cli, proc: ProcId) -> Option<ChatMcp> {
    if !sessions_on(cli_name(cli)) {
        return None;
    }
    let port = mcp_port()?;
    let token = crate::chat_token::issue_tile(id, proc)?;
    Some(ChatMcp {
        name: crate::instance::mcp_name(crate::instance::DEV),
        url: format!("{}/mcp", crate::tile_env::base_url(port)),
        token,
    })
}

fn picked_servers(agent: &str, cwd: &str) -> Vec<crate::agent_mcp::McpServer> {
    #[cfg(test)]
    if let Some(f) = lock(&super::FAKE).as_ref() {
        return crate::agent_mcp::chat_tile_selected(&f.servers, agent, None);
    }
    crate::agent_mcp::chat_tile_servers(agent, Some(cwd))
}

/// 비밀 값이 있는 서버는 브로커가 티켓을 박은 모양으로 바꾼다 — 값은 볼트에서 그 자식 · 프록시로만 간다. 볼트가 잠겼으면 그 서버만 뺀다.
/// AI 타일처럼 사용자 Codex 설정과 같은 이름도 덮어 싣는다.
pub(super) fn external_mcp(cli: Cli, cwd: &str, notices: &mut Vec<Ev>) -> Vec<crate::agent_mcp::McpServer> {
    let picked = picked_servers(cli_name(cli), cwd);
    if picked.is_empty() {
        return Vec::new();
    }
    let vault_open = hub::vault().is_some_and(|v| v.is_unlocked());
    let broker = hub::broker();
    let (mut out, mut locked, mut failed) = (Vec::new(), Vec::new(), Vec::new());
    for s in picked {
        let secret = !s.env.is_empty() || !s.headers.is_empty();
        if secret && !vault_open {
            locked.push(s.name);
            continue;
        }
        let prepared = if !secret { Some(s.clone()) } else { broker.as_ref().and_then(|b| b.prepare(&s, Some(cwd)).ok()) };
        match prepared.filter(crate::agent_mcp::launch_ok) {
            Some(p) => out.push(p),
            None => failed.push(s.name),
        }
    }
    for (code, names) in [("mcp-locked", locked), ("mcp-failed", failed)] {
        if !names.is_empty() {
            notices.push(Ev::Notice { code, detail: Some(names.join(", ")) });
        }
    }
    out
}

/// 파일을 쓰지만 아무것도 띄우지 않는다. 인자 검사(`tile_argv`)가 어댑터를 짓기 **전**이다 — 어댑터는 fork 를 스스로 막지 않는다.
pub(super) fn prepare(id: &str, st: &State, proc: ProcId) -> Result<Launch, WireError> {
    let root = chat_tile_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let cwd = PathBuf::from(&st.cwd);
    if !cwd.is_dir() {
        return Err(fail("bad-cwd", "the tile folder is missing"));
    }
    let dir = root.join(".run").join(format!("{id}-{proc}"));
    std::fs::create_dir_all(&dir).map_err(|e| fail("temp-dir", e.to_string()))?;
    let mut spot = Spot::new(dir);
    let name = cli_name(st.cli);
    let exe = crate::orchestration::spawn::find_exe(name, std::env::var_os("PATH").as_deref())
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| fail("cli-not-found", format!("{name} was not found on PATH (an .exe is required)")));
    #[cfg(test)]
    let exe = match lock(&super::FAKE).as_ref() {
        Some(f) => Ok(f.exe.clone()),
        None => exe,
    };
    let exe = exe?;
    let bad = |w: &'static str| fail(w, "the chat tile settings were refused");
    let mut add: Vec<(String, String)> = Vec::new();
    let mut notices = Vec::new();
    let mode = match st.conversation.as_deref() {
        Some(c) => Mode::Resume { conv: c },
        None => Mode::Fresh,
    };
    // 토큰 값은 이 프로세스의 실행 재료에만 싣는다. 실패한 띄우기는 부르는 쪽(`spawn`)이 거둔다
    let mcp = chat_mcp(id, st.cli, proc);
    let ext = external_mcp(st.cli, &st.cwd, &mut notices);
    let names: Vec<String> = ext.iter().map(|s| s.name.clone()).collect();
    if !names.is_empty() || !st.mcp.is_empty() {
        notices.insert(0, Ev::McpServers { names });
    }
    let (argv, adapter): (Vec<String>, Box<dyn Adapter>) = match st.cli {
        Cli::Claude => {
            let body = match &mcp {
                Some(m) => claude::mcp_config(m.name, &m.url, &m.token),
                None => claude::MCP_CONFIG_EMPTY.to_string(),
            };
            let mcp_file = spot.write("mcp.json", &claude::mcp_config_with(&body, &ext)).map_err(|e| fail("temp-file", e))?;
            let fresh = match mode {
                Mode::Fresh => crate::orchestration::spawn::new_uuid().ok_or_else(|| fail("uuid", "no randomness"))?,
                _ => String::new(),
            };
            let o = claude::TileOpts {
                exe: &exe,
                mode,
                session_id: &fresh,
                model: &st.model,
                effort: st.effort.as_deref(),
                mcp_config_file: &mcp_file,
                perm_mode: st.perm_mode.as_deref(),
                cwd: &st.cwd,
                checkpoints: true,
            };
            add.push((CLAUDE_CHECKPOINT_ENV.into(), "1".into()));
            let a = claude::tile_argv(&o).map_err(bad)?;
            (a, Box::new(claude::Claude::tile(&o)))
        }
        Cli::Codex => {
            let cwd_s = st.cwd.clone();
            let o = codex::TileOpts {
                exe: &exe,
                mode,
                cwd: &cwd_s,
                model: &st.model,
                effort: st.effort.as_deref(),
                client_version: env!("CARGO_PKG_VERSION"),
                mcp: mcp.as_ref().map(|m| codex::Mcp { name: m.name, url: &m.url, token_env: crate::tile_env::MCP_TOKEN_ENV, tools: &[] }),
                external: &ext,
                perm_mode: st.perm_mode.as_deref(),
            };
            if let Some(m) = &mcp {
                add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), m.token.clone()));
            }
            let mut a = codex::tile_argv(&o).map_err(bad)?;
            let launch = crate::codex_launch::codex_launch_env();
            crate::codex_launch::apply_tile_path(&mut add, launch.as_ref());
            a.extend(crate::codex_launch::codex_extra_args(launch.as_ref()));
            // 속도 등급은 턴 몸에만 — 실행 인자 · 사용자 config 에는 싣지 않는다
            (a, Box::new(codex::Codex::tile(&o).with_tier(st.tier.as_deref())))
        }
    };
    #[cfg(test)]
    let argv = match lock(&super::FAKE).as_ref() {
        Some(f) => {
            add.extend(f.env.iter().cloned());
            super::note_argv_for_test(&argv);
            std::iter::once(f.exe.clone()).chain(f.args.iter().cloned()).collect()
        }
        None => argv,
    };
    let env = turn::headless_env(std::env::vars(), &add);
    Ok(Launch { name, exe, argv, cwd, env, adapter, spot, notices })
}
