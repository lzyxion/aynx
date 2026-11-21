//! AI CLI 설치 감지와 전역 등록 해제 배선 — 새 등록은 agent_mcp 실행 설정에만 싣는다.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

pub(crate) const MCP_NAME: &str = crate::instance::mcp_name(crate::instance::DEV);
pub(super) const LEGACY_MCP_NAMES: &[&str] = crate::instance::legacy_mcp_names(crate::instance::DEV);

/// 토큰·CLI 전역 등록 상태는 화면에 보내지 않는다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub name: String,
    pub running: bool,
    pub url: String,
}

#[derive(Clone, Copy)]
pub(super) enum Remover {
    Cli { remove_post: &'static [&'static str] },
    CodexConfig,
}

pub(super) struct CliAdapter {
    pub(super) id: &'static str,
    pub(super) display: &'static str,
    pub(super) bin: &'static str,
    pub(super) remover: Remover,
}

pub(super) const ADAPTERS: &[CliAdapter] = &[
    CliAdapter {
        id: "claude", display: "Claude Code", bin: "claude",
        remover: Remover::Cli { remove_post: &["--scope", "user"] },
    },
    CliAdapter {
        id: "codex", display: "Codex", bin: "codex", remover: Remover::CodexConfig,
    },
];

/// `list_ai_clis` 결과(camelCase).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCli {
    pub id: String,
    pub name: String,
    /// AI 타일이 자동 실행할 명령(= 바이너리 이름).
    pub command: String,
    pub installed: bool,
}

/// 설치 여부만 감지한다 — 등록 조회(`mcp get`)는 하지 않는다(빨라야 한다).
#[tauri::command]
pub async fn list_ai_clis() -> Result<Vec<AiCli>, ()> {
    tauri::async_runtime::spawn_blocking(|| {
        ADAPTERS
            .iter()
            .map(|a| AiCli {
                id: a.id.to_string(),
                name: a.display.to_string(),
                command: a.bin.to_string(),
                installed: a.installed(),
            })
            .collect()
    })
    .await
    .map_err(|_| ())
}

impl CliAdapter {
    /// PATH 는 지금 OS 의 값으로 찾는다(`fresh_path`) — 앱을 켜 둔 채 깐 CLI 도 다시 켜지 않고 보이게.
    pub(super) fn command(&self) -> Command {
        let mut cmd = Command::new(self.bin);
        if let Some(path) = crate::fresh_path::current() {
            cmd.env("PATH", path);
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        cmd
    }

    pub(super) fn installed(&self) -> bool {
        self.command()
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub(super) fn remove_args(remove_post: &[&str], name: &str) -> Vec<String> {
        let mut args = vec!["mcp".into(), "remove".into(), name.to_owned()];
        args.extend(remove_post.iter().map(|s| (*s).to_owned()));
        args
    }
}
