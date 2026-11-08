//! AI CLI 설치 감지와 전역 등록 해제 배선 — 새 등록은 agent_mcp 실행 설정에만 싣는다.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

pub(crate) const MCP_NAME: &str = crate::instance::mcp_name(crate::instance::DEV);
pub(super) const LEGACY_MCP_NAMES: &[&str] = crate::instance::legacy_mcp_names(crate::instance::DEV);

/// 화면은 서버 구동 상태와 URL만 읽는다. 토큰·CLI 전역 등록 상태는 보내지 않는다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub name: String,
    pub running: bool,
    pub url: String,
}

/// 이관에서만 쓰는 해제 방식. Claude는 사용자 범위를 명시한다.
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

/// `list_ai_clis` 결과 — 알려진 AI CLI 하나의 감지 결과(camelCase).
///
/// `+` 탭 메뉴가 이 목록으로 항목을 만든다(설치된 것만). `command` 는 AI 타일이 자동 실행할
/// 바이너리(`autorun`)다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCli {
    /// 안정 id(`"claude"`·`"codex"`) — 설치 감지의 키.
    pub id: String,
    /// 사람이 읽는 이름(메뉴 항목 라벨).
    pub name: String,
    /// AI 타일이 자동 실행할 명령(= 바이너리 이름).
    pub command: String,
    /// 이 CLI 를 실행할 수 있는가(`<bin> --version`).
    pub installed: bool,
}

/// 알려진 AI CLI 들의 **설치 여부만** 가볍게 감지한다(등록 확인은 하지 않는다 — 빨라야 한다).
///
/// `+` 메뉴가 처음 열릴 때 한 번 부른다(`list_shells` 와 같은 지연 로드). 그래서 `mcp get` 같은
/// 등록 조회 없이 `<bin> --version` 프로브만 돌린다 — 어댑터마다 한 번이다. 프로세스 스폰은 블로킹 풀에서 돈다.
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
    /// 이 CLI 를 부를 `Command` — 콘솔 창을 감춘다(Windows). PATH 는 **지금 OS 의 값**으로 찾는다 — 앱을 켜 둔 채 깐 CLI 도
    /// 다시 켜지 않고 보이게(`fresh_path` · 2026-11-03 첫 설치 점검). 못 읽으면 물려받은 PATH 그대로.
    pub(super) fn command(&self) -> Command {
        let mut cmd = Command::new(self.bin);
        if let Some(path) = crate::fresh_path::current() {
            cmd.env("PATH", path);
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        cmd
    }

    /// `<bin> --version` 이 도는지로 설치 여부를 본다.
    pub(super) fn installed(&self) -> bool {
        self.command()
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// 기존 사용자 범위 해제 인자를 재사용한다. 토큰은 실리지 않는다.
    pub(super) fn remove_args(remove_post: &[&str], name: &str) -> Vec<String> {
        let mut args = vec!["mcp".into(), "remove".into(), name.to_owned()];
        args.extend(remove_post.iter().map(|s| (*s).to_owned()));
        args
    }
}
