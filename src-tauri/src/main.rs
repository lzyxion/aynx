//! 실행 파일 진입점 — 하위 명령(`claude-usage` · `statusline`(옛 판 호환) · `agent-permission` · `mcp-run` · `session-server`)은 Tauri 없이 끝내고,
//! 아니면 `aynx_lib::run`.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code mod 의 한도 도우미 — Tauri 앞에서 가른다(claude_usage.rs). 창·런타임을 만들지 않는다.
    if std::env::args_os().nth(1).is_some_and(|a| a == "claude-usage") {
        std::process::exit(aynx_lib::claude_usage_main());
    }
    // 옛 판의 상태줄 도우미 — 업데이트 전에 뜬 claude · 셸이 아직 부른다. 없으면 GUI 가 떠 버린다(claude_usage.rs).
    if std::env::args_os()
        .nth(1)
        .is_some_and(|a| a == "statusline")
    {
        std::process::exit(aynx_lib::statusline_main());
    }
    // 타일 권한 훅 도우미(2026-11-01 — `tile_permission::helper`). 창 · 런타임 없이 표준 입력만 읽고 끝난다.
    if std::env::args_os().nth(1).is_some_and(|a| a == "agent-permission") {
        std::process::exit(aynx_lib::agent_permission_main());
    }
    if std::env::args_os().nth(1).is_some_and(|a| a == "mcp-run") {
        std::process::exit(aynx_lib::mcp_launch_main());
    }
    // 세션 서버(분리 프로세스) — GUI 가 찾거나 띄운다(`server.rs`). 창·웹뷰를 만들지 않는다.
    if std::env::args_os().nth(1).is_some_and(|a| a == "session-server") {
        std::process::exit(aynx_lib::session_server_main());
    }
    aynx_lib::run()
}
