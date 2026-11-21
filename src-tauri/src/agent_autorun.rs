//! 에이전트 autorun 한 문 — aynx 이 띄우는 에이전트 명령(AI 타일 · 셸 메뉴 · 프로젝트 시작 화면 · 재개/포크)이 전부 지나는 곳.

/// 타일이 자동 실행할 명령. 추가 인자를 먼저 놓아야 뒤따르는 장식이 사용자가 정한 `--remote` 등을 본다.
/// 붙일 수 없는 장식은 그것만 빠진다(띄우기를 막지 않는다). SSH 의 에이전트 줄은 이 문을 지나지 않는다.
#[tauri::command]
pub async fn agent_autorun_command(
    command: String,
    shell: Option<String>,
    cwd: Option<String>,
    inject_mcp_token: Option<bool>,
    stream_id: Option<String>,
) -> Result<String, String> {
    // 감싸개가 있는 로컬 셸 타일이면 셸 통합의 감싸개가 같은 장식을 붙인다 — 여기서 또 붙이면 두 번이 된다.
    let probe = (command.clone(), shell.clone(), stream_id.clone());
    let wrapped = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_tile::wrapper_decorates(&probe.0, probe.1.as_deref(), probe.2.as_deref())
    })
    .await
    .unwrap_or(false);
    if wrapped {
        return Ok(command);
    }
    // 토큰은 Rust 안에서만 복제한다. 타일은 조정자 자리가 되지 못하므로 오케스트레이션 도구의 미리 허용은 없다.
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
        crate::codex_launch::codex_line_with_env(&command, shell.as_deref(), crate::codex_launch::codex_launch_env().as_ref())
            .unwrap_or(command)
    })
    .await
    .map_err(|e| e.to_string())
}
