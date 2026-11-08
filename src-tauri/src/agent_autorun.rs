//! **에이전트 autorun 한 문** — aynx 이 띄우는 에이전트 명령(AI 타일 · 셸 메뉴 · 프로젝트 시작 화면 · 재개/포크)이
//! 전부 지나는 곳. 예전에는 Claude 상태줄 도우미(`statusline.rs`)에 살았는데, 한도 % 를 mod 로 받게 되며(2026-10-10 —
//! `crate::claude_usage`) claude 명령 줄을 고칠 일이 없어져 문만 따로 섰다.

/// 타일이 자동 실행할 명령 — 먼저 설정 `[ai.args]` 의 **추가 인자**를 그 에이전트의 자리에 놓고
/// ([`crate::agent_args::apply_configured`] — 그래야 뒤따르는 장식이 사용자가 정한 `--remote` 등을 본다),
/// 외부 MCP 를 싣고([`crate::agent_mcp`] — 로컬만 · WSL 제외), codex 면 설정 `[ai] codex_no_daemon`(기본 켬)일 때
/// `--no-daemon` 을 끼운다([`crate::codex_launch::codex_line`]) · Windows 면 Codex 실행 환경 인자(`prefer_mxc` · 자식 PATH 복원 —
/// [`crate::codex_launch::codex_line_with_env`]). 붙일 수 없으면 그 장식만 빠진다(실패로 띄우기를 막지 않는다).
/// claude 의 한도 % 는 명령 줄이 아니라 타일 환경(`crate::claude_usage::tile_env`)이 싣는다. 감싸개가 있는 로컬 셸 타일(PowerShell · Git Bash ·
/// 셸 통합 켬 — 2026-10-26)의 `claude` · `codex` 줄은 같은 장식을 그 타일의 장식 파일로 감싸개가 붙이므로 여기서는 그대로 둔다(`crate::agent_tile`).
/// 파일을 읽으므로 async + 블로킹 풀.
/// SSH 는 프런트 Terminal 의 로컬 조건 밖에서 첫 입력·프로젝트 에이전트 줄을 그대로 보내므로 이 문을 지나지 않는다.
/// `shell` 은 타일 세션의 셸 id(추가 인자의 인용 모양 · `wsl:` 이면 `--no-daemon` 은 건드리지 않는다 — 배포판 안의
/// CLI 판을 모른다), `cwd` 는 타일의 시작 폴더(프로젝트 MCP 범위), `stream_id` 는 그 타일의 스트림(③-3c —
/// `--mcp-config` 파일을 그 세션이 쓴다고 세션 서버에 알린다 · 옛 프런트는 없음).
#[tauri::command]
pub async fn agent_autorun_command(
    command: String,
    shell: Option<String>,
    cwd: Option<String>,
    inject_mcp_token: Option<bool>,
    stream_id: Option<String>,
) -> Result<String, String> {
    // 감싸개가 있는 로컬 셸 타일(2026-10-26 — `crate::agent_tile`)이면 같은 장식을 셸 통합의 `claude` · `codex` 감싸개가 붙인다 — 여기서 또 붙이면
    // 두 번이 된다. 그 줄은 받은 그대로 돌려준다(장식은 감싸개 하나). 파일 확인이라 블로킹 풀에서.
    let probe = (command.clone(), shell.clone(), stream_id.clone());
    let wrapped = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_tile::wrapper_decorates(&probe.0, probe.1.as_deref(), probe.2.as_deref())
    })
    .await
    .unwrap_or(false);
    if wrapped {
        return Ok(command);
    }
    // 세션 서버의 MCP 좌표 · **이 타일의 토큰**(3차 4단계 — 서버가 `open` 에서 그 타일만의 것을 뽑았다, 그때그때 묻는다). 토큰은 Rust 안에서만
    // 복제한다. 서버가 없거나 AI 타일이 아니거나 스트림이 없으면 이 장식만 조용히 생략한다. (오케스트레이션 탭 2단계) 타일은 조정자 자리가
    // 되지 못하므로 오케스트레이션 도구의 미리 허용은 없다 — 조정자는 오케스트레이션 탭의 프로듀서 채팅이다.
    let sessions = if inject_mcp_token.unwrap_or(false) {
        crate::server::ai_proxy::sessions_server_for(stream_id.as_deref()).await
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let command = crate::agent_args::apply_configured(&command, shell.as_deref());
        let command = crate::agent_mcp::apply_configured(
            &command,
            shell.as_deref(),
            cwd.as_deref(),
            inject_mcp_token.unwrap_or(false),
            sessions.as_ref(),
            stream_id.as_deref(),
        );
        if shell.as_deref().is_some_and(|s| s.starts_with("wsl:")) {
            return command;
        }
        let command = crate::codex_launch::codex_line(&command, crate::settings::codex_no_daemon()).unwrap_or(command);
        // Codex 실행 환경(2026-10-15 — 사용자 결정 2): `prefer_mxc` · 경고 끄기 · 자식 PATH 복원을 줄에 — 타일 셸의 PATH 는
        // `open_local_session(codexTile)` 이 이미 걸렀다(`codex_launch::apply_tile_path`). Windows 밖은 아무것도 없다.
        crate::codex_launch::codex_line_with_env(&command, shell.as_deref(), crate::codex_launch::codex_launch_env().as_ref())
            .unwrap_or(command)
    })
    .await
    .map_err(|e| e.to_string())
}
