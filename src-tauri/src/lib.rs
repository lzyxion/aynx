//! 앱 조립 — 모든 모듈 선언 · 앱 전역 상태(`manage`) · Tauri 명령 등록(`generate_handler!`) · 창 이벤트.
//!
//! 모듈 지도와 "어디를 고치나" 는 docs/modules.md. 여기에는 기능 코드를 두지 않는다 — [`run`] 은
//! 저장소를 만들어 넘기고 명령을 이어 붙이기만 한다.
//!
//! 불변식:
//! - 새 `#[tauri::command]` 는 제 모듈에 쓰고 [`run`] 의 `generate_handler!` 에 한 줄 더한다 — 그리고 원격 창 분류(`remote/deny.rs` 의
//!   표 넷 중 하나 — 시험이 빠뜨림을 잡는다).
//! - Tauri 명령은 기본 `async fn` — 동기 명령이 UI 스레드를 잡으면 다른 세션의 출력이 침묵한다
//!   (docs/conventions.md "Tauri 명령은 기본 async fn" · docs/log/2026-09-05-async-commands.md).
//! - 옛 폴더 이전·개발 폴더 씨앗은 **설정·mcp.json 을 읽기 전에** 돈다(순서를 바꾸지 말 것 — [`run`] 주석).

mod agent_args;
mod agent_autorun;
mod agent_attachments;
mod agent_forward;
mod agent_hooks;
mod agent_instructions;
mod agent_mcp;
mod agent_sessions;
mod agent_sessions_remote;
mod agent_shim;
mod agent_signal;
mod agent_state;
mod agent_tile;
mod agent_transcript;
mod agent_usage;
mod app_icon;
#[cfg(target_os = "windows")]
mod taskbar_shortcut;
mod app_state;
mod audit;
mod automation_presets;
mod branch_graph;
mod chat_token;
mod claude_usage;
mod codex_launch;
mod commit_graph;
mod codex_mcp;
mod codex_models;
mod config_edit;
mod context;
mod copy_id;
mod cwd;
mod db;
mod db_history;
mod delegation;
mod diff_view;
mod errors;
mod fail_limit;
mod file_index;
mod fs_atomic;
mod fs_entry;
mod fs_space;
mod fs_transfer;
mod git_repo;
mod handoff;
mod headless;
mod host_history;
mod i18n;
mod instance;
mod keep_awake;
mod keygen;
mod known_hosts;
mod loopback_http;
mod local_browser;
mod local_watch;
mod mcp;
mod mcp_launch;
mod merge_detect;
mod messenger;
mod operations;
mod orchestration;
mod output;
mod policy;
mod port_forward;
mod projects;
mod fresh_path;
mod ps_policy;
mod pty;
mod reap;
mod remote;
mod remote_signal_file;
mod remote_worktree;
mod routing;
mod screen_mirror;
mod server;
mod session_commands;
mod session_core;
mod session_log;
mod session_owner;
mod sessions_meta;
mod settings;
mod setup_script;
mod sftp;
mod sftp_browser;
mod shell_integration;
mod side_chat;
mod single_instance_gate;
mod snippets;
mod socks5;
mod ssh;
mod ssh_config;
mod ssh_pool;
mod term_themes;
mod text_file;
mod tile_env;
mod tile_permission;
mod tile_token;
mod token;
mod tray;
mod updater;
mod webview_crash;
mod vault;
mod wallpaper;
mod workspace_windows;
mod workspaces;
mod worktree;
mod worktree_branch;
mod worktree_changes;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// `aynx claude-usage` — Claude Code mod 가 넘긴 요금제 한도를 파일에 적는 도우미(`claude_usage.rs`). `main.rs` 가
/// Tauri 를 띄우기 **전에** 첫 인자로 가른다: 창도 런타임도 만들지 않고 표준 입력만 읽고 끝난다(늘 0).
pub fn claude_usage_main() -> i32 {
    claude_usage::helper_main()
}

/// `aynx statusline …` — 옛 판이 띄운 claude · 셸이 아직 부르는 갈래(`claude_usage.rs` 머리말 "옛 판의 흔적"). 늘 0.
pub fn statusline_main() -> i32 {
    claude_usage::legacy_statusline_main()
}

/// `aynx agent-permission <pre|ask|post> <claude|codex>` — 타일 장식이 그 CLI 에만 건 권한 훅의 도우미(`tile_permission::helper`). 창 · 런타임 없이
/// 표준 입력만 읽고 끝난다(늘 0 · Aynx 타일 환경이 없으면 곧바로).
pub fn agent_permission_main() -> i32 {
    tile_permission::helper::main()
}

/// 외부 stdio MCP 실행 도우미 — 환경변수를 앱 메모리의 실행 브로커에서 받는다.
pub fn mcp_launch_main() -> i32 {
    mcp_launch::helper_main()
}

/// `aynx session-server` — 세션 서버 프로세스(`server.rs`). Tauri 없이 tokio 런타임 하나로 돈다.
pub fn session_server_main() -> i32 {
    server::session_server_main()
}

pub fn run() {
    // 옛 제품 이름 시절의 폴더를 한 번만 옮긴다 — **설정·mcp.json 을 쓰기·읽기 전에**.
    // 세션 서버가 `~/.aynx/mcp.json` 을 쓰고(③-3c), setup 의 `settings::app_language()` 가
    // `<config_dir>/aynx/settings.toml` 을 읽는다 — 그 전에 옮겨 두지 않으면 설정이 "첫 실행" 으로 보인다.
    // 개발 빌드는 제 옛 폴더(`<옛 이름>-dev` · `~/.<옛 이름>-dev`)만 옮긴다 — 후보는 `instance::legacy_*_dir_names`
    // (지금은 비어 있다 — 다음 개명 때 채운다, docs/log/2026-10-22-rename-aynx.md).
    settings::migrate_legacy_app_dir();
    mcp::migrate_legacy_home_dir();

    // 개발 빌드(`tauri dev`)는 릴리스와 다른 폴더(`<config_dir>/aynx-dev` · `~/.aynx-dev`)를 쓴다 — 그
    // 폴더가 처음이면 릴리스의 비밀이 아닌 설정을 한 번 복사해 온다. **설정을 읽기 전에**, 그리고 옛 개발 폴더
    // (`<옛 이름>-dev`)를 옮긴 **뒤에** — 먼저 뿌리면 새 폴더가 생겨 옛 개발 폴더 이전이 막힌다
    // (docs/log/2026-09-26-dev-release-isolation.md). 릴리스 빌드에서는 아무것도 하지 않는다.
    instance::seed_dev_root();

    // AI(MCP) 통합 — MCP 서버(`/mcp`·`mcp.json`)·컨텍스트 거울·실행 라우팅·작업안 저장소·결과·실행기·감사는 ③-3c 부터 **세션
    // 서버 프로세스**에 산다(`server::ai`). GUI 는 같은 이름의 Tauri 명령 프록시(`server::ai_proxy` · `operations::commands`·
    // `approval`)만 쥔다 — `mcp.json` 도 서버가 쓴다(둘째 실행·둘째 GUI 가 덮을 일이 없다).

    // 개발 빌드면 identifier(→ WebView2 사용자 폴더)·창 제목·asset 스코프를 개발 판으로 바꾼다.
    let mut context = tauri::generate_context!();
    instance::apply_to_context(&mut context);
    // 작업 표시줄이 창을 시작 메뉴 바로 가기와 묶지 않게 — 묶이면 고른 앱 아이콘 대신 바로 가기 아이콘이 선다.
    // 창이 하나라도 생기기 전이어야 한다 (app_icon.rs 머리말 · docs/log/2026-10-06-taskbar-app-id.md).
    app_icon::set_process_app_id(&context.config().identifier);
    // 둘째 실행이 첫 인스턴스의 이벤트 창이 서기 전에 닿으면 플러그인이 그냥 계속 띄운다 — 그 틈을 메운다(`single_instance_gate`).
    single_instance_gate::wait_for_first_instance(&context.config().identifier);

    tauri::Builder::default()
        // **GUI 한 개** — 둘째 실행은 첫 GUI 의 주 창을 앞으로(최소화 풀기·보이기·포커스) 가져오고 그 프로세스는 플러그인
        // 안에서 끝난다(우리 setup·`mcp::start`·세션 서버 연결에 닿기 전). 첫 플러그인이어야 다른 플러그인도 돌지 않는다.
        // 식별자는 Tauri identifier(개발 빌드는 `-dev` — `instance::apply_to_context`)라 개발 앱과 릴리스는 서로 막지 않는다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 주 창을 앞으로 — 트레이에 남아 창이 하나도 없으면(③-4) 새 주 창을 연다(트레이 [열기] 와 같다).
            // **이벤트 고리로 미룬다** — 이 콜백은 둘째 실행이 보낸 WM_COPYDATA 처리 안(메인 스레드)에서 돈다. 첫 인스턴스가 아직
            // 부팅 중(웹뷰를 만드는 동안 메시지를 펌프한다)일 때 여기서 창을 만지면 웹뷰 생성과 엉켜 둘 다 멈췄다(실측 10-10 survival
            // `race` — 첫째는 웹뷰를 만들다, 둘째는 SendMessage 에서). 메인 스레드에서 부른 `run_on_main_thread` 는 그 자리에서
            // 바로 돌므로 **다른 스레드에서** 부른다 — 그러면 이벤트 고리에 들어가 부팅이 끝난 뒤 주 창을 앞으로 가져올 뿐이다.
            let handle = app.clone();
            std::thread::spawn(move || {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || tray::open_main(&app, None));
            });
        }))
        // 투명도(`app.opacity`)는 CSS 토큰이라 여기서 다루지 않는다 — 프런트가 마운트하며 건다.
        .setup(move |app| {
            use tauri::Manager;
            // MCP 의 GUI 몫은 전역 등록 해제 이관의 우편함 한 칸뿐이다(서버·좌표·토큰은 세션 서버 — `server::ai`).
            app.manage(mcp::McpState::default());
            // 백엔드가 만드는 사용자 문구의 언어 — **명령이 돌기 전에** 건다. 저장된 값이
            // 없거나 모르는 값이면 한국어이고, 프런트가 부팅 첫 줄에서 `set_language` 로
            // 곧바로 바로잡는다 ("OS 를 따른다" 를 아는 쪽은 프런트다 — i18n.rs 머리말).
            if let Some(l) = settings::app_language().as_deref().and_then(i18n::parse) {
                i18n::set_lang(l);
            }
            // 앱 아이콘(창·작업 표시줄) — 저장된 값을 기억해 두고 메인 창에 곧바로 건다. 새 창·리로드는
            // 아래 `on_page_load` 가 같은 값을 건다 (docs/log/2026-10-04-app-icon-switch.md).
            app_icon::init(settings::app_icon().as_deref());
            // 작업 표시줄 아이콘(우리 앱 ID 의 바로 가기 + 고정 경로 .ico)을 저장된 캐릭터로 맞춘다(블로킹 풀).
            app_icon::sync_taskbar(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                app_icon::apply_to_window(&window.as_ref().window());
            }
            // 이 인스턴스의 전역 등록만 걷고 이전 실행 설정 파일을 정리한다(블로킹 풀).
            mcp::spawn_unregister_migration(app.handle().clone());
            // 끝난 AI 타일의 `--mcp-config` 파일 정리 — pid 가 살아 있거나 세션 서버의 살아 있는 세션이 쥔 파일은 남긴다(③-3c).
            tauri::async_runtime::spawn(agent_mcp::cleanup_stale_configs());
            // AI 타일 첨부 사본 중 30일 지난 것을 걷는다(블로킹 풀).
            tauri::async_runtime::spawn_blocking(agent_attachments::cleanup_stale);
            // 설치된 에이전트 훅 스크립트(사본 — Claude Code·Codex 공용)가 옛 판이면 이 판으로 갈아
            // 쓴다 — 에이전트의 설정 파일(`~/.claude/settings.json` · `~/.codex/hooks.json`)은 건드리지 않는다. 파일을 만지므로 블로킹 풀에서
            // (docs/log/2026-09-25-shell-claude-signals.md).
            tauri::async_runtime::spawn_blocking(agent_hooks::refresh_installed_script);
            // 이미 설치한 사람의 이 PC 설정에서 **우리 항목만** 새 등록 모양으로 맞춘다(2026-10-08 — 사용자 항목은 그대로,
            // 바뀐 것이 없으면 쓰지 않는다 · `agent_hooks` 머리말 "우리 항목만 자동 갱신"). Codex 안내는 주 창이 부팅에서 가져간다.
            tauri::async_runtime::spawn_blocking(agent_hooks::refresh_local_entries_once);
            // 세션 서버를 찾거나 띄워 붙는다 — ③-2 부터 로컬 세션은 서버에 산다(`server.rs` 머리말).
            server::client::start(app.handle().clone());
            // 트레이(③-4) — 설정 `[app] tray_on_close`(기본 켬)면 알림 영역에 아이콘을 세우고 툴팁 시계를 돈다. Windows 밖은 스텁.
            tray::install(app.handle());
            // 원격 웹 클라이언트 관문 — `[remote] enabled` 면 127.0.0.1 에 연다(기본 끔 · `remote.rs` 머리말). 설정 저장이 다시 맞춘다.
            remote::install(app.handle());
            Ok(())
        })
        // ── 세션 누수 그물 (docs/log/2026-09-05-session-leak-on-reload.md) ──────────
        //
        // 웹뷰 **페이지가 다시 로드되면** 프런트의 정리 경로가 하나도 돌지 않는다 — 문서가
        // 통째로 사라지므로 `Terminal` 의 언마운트도, 창 닫힘 훅도 없다. 그런데 새 페이지는
        // 터미널을 전부 다시 마운트해 세션을 **새로** 연다. 그래서 리로드 한 번마다 셸
        // 프로세스와 SSH 연결이 한 벌씩 쌓였다 (실측 24개).
        //
        // `Started` 만 본다. `Finished` 는 새 페이지의 스크립트가 이미 돌기 시작한 뒤라
        // 그때 거두면 방금 열린 세션을 물 위험이 있다 (기준선이 그 위험도 막지만, 굳이 두
        // 번 돌 이유가 없다).
        .on_page_load(|webview, payload| {
            use tauri::Manager;
            if payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            let window = webview.window();
            // 원격 창(숨은 웹뷰 — `about:blank`)은 앱 프런트가 아니다: 거둠·아이콘·크래시 감시가 없다(`remote::windows`).
            if remote::is_remote_label(window.label()) {
                return;
            }
            // 리로드·웹뷰 크래시 — 로컬 세션은 닫지 않고 떼어 둔다(새 페이지의 타일이 다시 붙는다 · `reap` 머리말 4).
            reap::spawn_reap(webview.app_handle(), window.label(), reap::Event::Reload);
            // 옛 페이지의 파일 감시 구독 — 새 페이지의 타일이 다시 세운다(`local_watch` 머리말 "수명")
            local_watch::forget_window(window.label());
            // 고른 앱 아이콘 — 메인·보조·떼어 낸 창이 모두 여기를 지나므로 창 생성 경로마다 따로 걸지 않는다.
            app_icon::apply_to_window(&window);
            // 렌더러가 죽으면 다시 읽는다(창마다 한 번 — 설계 10절 "창 크래시" · `webview_crash`).
            webview_crash::watch(webview);
        })
        // 창이 **파괴될 때**도 같은 정리를 건다. `CloseRequested` 가 아니라 `Destroyed` 인
        // 이유는 취소 가능성 때문이다 — 닫기를 막은 창의 세션을 죽이면 살아 있는 화면이
        // 빈 껍데기가 된다. 분리 창을 X 로 닫는 경로는 프런트(`closeWindowSessions`)도
        // 잡지만, 그쪽은 웹뷰가 살아 있어야만 돈다 (멱등이라 겹쳐도 무해하다).
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if matches!(event, tauri::WindowEvent::Destroyed) {
                webview_crash::forget(window.label());
                // 그 창 타일들의 파일 감시 구독(원격 창 몫도 — 아래 원격 갈래가 먼저 돌아 나가므로 여기서)
                local_watch::forget_window(window.label());
                window
                    .app_handle()
                    .state::<workspace_windows::Bindings>()
                    .remove(window.label());
                let _ = window
                    .app_handle()
                    .emit("workspace-window-gone", window.label());
                // 앱 종료·트레이로 가는 중(`QUITTING` — `workspace_exit_app`)이면 세션을 닫지 않고 떼어 둔다(리로드와 같은 거둠 — 거울도
                // 살아 있는 세션 몫은 남는다 · 쿼리 타일의 DB 연결은 떨어진 세션으로 남긴다 — `reap::Event::Leaving`). **사건 순간에**
                // 가른다 — 트레이 [열기] 가 표식을 걷은 뒤에 늦게 도는 거둠이 닫지 않게.
                let leaving = server::proxy::QUITTING.load(std::sync::atomic::Ordering::SeqCst);
                let event = reap::destroyed_event(leaving);
                reap::spawn_reap(window.app_handle(), window.label(), event);
                // 그 창의 "검토 중" 작업안 몫을 걷는다(서버 자동 승인이 다시 본다 — ③-4). 떨어진 세션 목록의 "책임 창 있음" 도 바뀐다.
                server::ai_proxy::forget_reviewing_window(window.label());
                let _ = window.app_handle().emit(server::sessions::DETACHED_CHANGED, ());
                // 원격 창(숨은 웹뷰)이 밖에서 부서졌다(GUI 종료 등) — 그 ws 연결을 닫게 한다. 볼트 셈은 그 연결이 끝나며 한다.
                if remote::is_remote_label(window.label()) {
                    remote::remote_window_gone(window.label());
                    return;
                }
                // 집 PC 주 창이 사라졌다(트레이로 · 앱 끝) — 원격 창의 배치 거울은 `workspaces.json` 으로 돌아간다(R2-B).
                remote::mirror_main_window_gone(window.app_handle(), window.label());
                // 보는 창이 하나도 남지 않았다 — 볼트를 창 0개 잠금으로(HTTP 티켓 정지 · ③-3b1). F5·최소화·숨김은 창 0개가
                // 아니다(파괴가 아니므로 여기 오지 않는다). 서버도 이 GUI 의 연결이 끊기면 스스로 건다(kill 대비).
                // **원격 창은 창으로 세지 않되**, 열린 원격(살아 있는 원격 창 · 유예)이 있으면 그것이 "보는 창" 이다(설계 3.1 —
                // 밖에서 쓰는 중이면 잠그지 않는다 · 원격이 빠질 때 `remote::windows` 가 다시 판정한다).
                let app = window.app_handle();
                let others = remote::has_home_window_except(app, window.label());
                if !others {
                    if remote::vault_lock_due(0, remote::remote_present()) {
                        server::vault_proxy::lock_on_last_window();
                    }
                    // 트레이가 없으면 집 PC 창이 모두 사라진 GUI 는 끝나야 한다 — 숨은 원격 창만 남아 Tauri 가 끝나지 않는 일을 막는다.
                    if !tray::active(app) {
                        remote::close_remote_windows();
                    }
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // OS 알림 — 창이 포커스를 잃은 동안 끝난 긴 명령을 알리는 한 갈래
        // (docs/log/2026-09-16-finish-notify-block-marks-bell.md). 프런트가 권한을 **처음
        // 쓸 때** 묻고, 거절되면 앱 안 토스트로 되돌아간다.
        .plugin(tauri_plugin_notification::init())
        // 탐색기로 파일 끌어내기 (Alt+드래그) — 명령 하나(`plugin:drag|start_drag`)뿐이고
        // 상태가 없다. 프런트는 `src/lib/native-drag.ts` 가 직접 invoke 한다
        // (docs/log/2026-09-04-native-drag-out.md).
        .plugin(tauri_plugin_drag::init())
        // OS 클립보드 읽기 — 터미널 붙여넣기 하나(`src/lib/clipboard.ts` 의 `readClipboard`).
        // `navigator.clipboard.readText()` 는 WebView2 의 "클립보드 보기 허용/차단" 창을 띄운다
        // (docs/log/2026-09-28-clipboard-plugin.md). 권한은 read-text 하나만 연다(capabilities).
        .plugin(tauri_plugin_clipboard_manager::init())
        // 앱 안 업데이트(2026-11-12) — 플러그인의 JS 명령 · 권한은 웹뷰에 열지 않는다(capabilities 에 `updater:*` 없음). 찾기 ·
        // 받기 · 설치는 `updater.rs` 의 Tauri 명령만 거친다(원격 창은 `remote/deny.rs` 의 HOME_ONLY).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 원격 창(`remote-*` 숨은 웹뷰)의 Channel 전송을 모두 그 원격 브라우저의 ws 로 돌린다(`remote::bridge` — 다른 창은 손대지
        // 않는다). Builder 에 가로채기는 **하나**뿐이다 — 다른 용도가 생기면 이 함수 안에서 합친다.
        .channel_interceptor(remote::channel_interceptor)
        // 창 사이로 탭을 넘길 때 쓰는 1회용 우편함 (docs/log/2026-09-02-tear-out.md)
        .manage(handoff::Mailbox::default())
        .manage(workspace_windows::Bindings::default())
        .invoke_handler(tauri::generate_handler![
            pty::list_shells,
            // 로컬 세션 — 세션 서버로 옮기는 프록시(③-2 · `server::proxy`). 이름·인자·반환은 예전 그대로다.
            server::proxy::open_local_session,
            server::proxy::local_cwd,
            server::proxy::write_session,
            server::proxy::resize_session,
            server::proxy::claim_session_size,
            server::proxy::close_session,
            // pause/resume 대신 소비 오프셋(ACK 크레딧 — `server::credit`).
            server::proxy::ack_local_output,
            session_core::commands::detach_session,
            session_core::commands::attach_session,
            session_core::commands::attach_session_viewer,
            session_core::commands::detach_session_viewer,
            session_core::commands::probe_session,
            session_core::commands::stash_checkpoint,
            // 떨어진 세션(③-4) — 복원 끝 표시(닫지 않는다) · 목록 · 닫기 · 로컬 "AI 읽기 허용" 메타.
            session_core::commands::restore_done_sessions,
            session_core::commands::detached_sessions,
            session_core::commands::close_detached_session,
            session_core::commands::set_session_ai_read,
            // 트레이(③-4) — 새 주 창이 꺼낼 일 · 이 환경에 트레이가 있나.
            tray::take_tray_intent,
            tray::tray_status,
            // 독의 종료 단추 = 트레이 [모든 세션 종료…] 와 같은 확인 · 흐름(어느 OS 든 — 트레이에 매이지 않는다).
            tray::app_end_all_sessions,
            // 독 끝내기 모달의 [GUI 종료] = 트레이 [GUI 종료] 와 같은 흐름(2026-10-28).
            tray::app_quit_gui,
            // 독 끝내기 모달의 [트레이로 숨기기](2026-10-28).
            tray::app_hide_to_tray,
            // 잠자기 방지(10-23 — 독 ☕ 칸 · 상태바 ☕) — GUI 프로세스가 쥐는 전원 요청 · 시작 때 늘 꺼짐 · OS 분기는 `keep_awake.rs` 함수 하나.
            keep_awake::keep_awake_status,
            keep_awake::keep_awake_set,
            // 세션 서버(③-1) — 설정의 "세션 서버" 줄. 상태 읽기·다시 시작 둘뿐이다.
            server::client::session_server_status,
            server::client::session_server_restart,
            server::client::session_server_close_all,
            // 앱 안 업데이트(2026-11-12) — 알리기만 하고, 받기 · 설치는 사람이 고를 때만(`updater.rs` 머리말).
            updater::update_state,
            updater::update_check,
            updater::update_download,
            updater::update_install,
            updater::update_skip,
            updater::update_mark_toasted,
            // 침묵한 타일 진단 — 로컬·SSH 공용 (docs/log/2026-09-05-silent-session-selfheal.md).
            session_commands::session_stats,
            // 세션 로그를 **읽는** 두 문 — 지금까지 쓰기만 하고 열 길이 없었다
            // (docs/log/2026-09-17-scrollback-export-and-logs.md). 여는 일은 프런트의
            // plugin-opener 가 하고, 여기서는 경로만 답한다.
            session_log::session_log_path,
            session_log::session_logs_dir,
            // SSH 타일 — 세션 서버로 옮기는 프록시(③-3b2 · `server::ssh_proxy`). 쓰기·크기·닫기·ACK 는 로컬과 같은 명령
            // (kind 무관 op — `write_session`·`resize_session`·`close_session`·`ack_local_output`).
            server::ssh_proxy::open_ssh_session,
            // 머리줄 이름의 말풍선이 읽는 한 벌 — 인증 방식·서버 배너·경유·접속 시각 + 그 자리에서
            // 잰 왕복 시간 (docs/log/2026-09-17-connect-diagnostics.md).
            server::ssh_proxy::session_info,
            // tmux 타일의 "지금 폴더" — OSC 7 이 없는 간이 모드에서 📂 가 쓰는 exec 왕복 하나.
            ssh::commands::ssh_tmux_cwd,
            ssh::commands::ssh_tmux_list,
            ssh::commands::ssh_tmux_kill,
            // 원격 `$HOME` — 프로젝트의 `~/api` 를 git 의 `/root/api` 와 맞대는 데 쓴다(별칭마다 한 번).
            ssh::commands::ssh_remote_home,
            // 슬라이스 A1 — 위임 대상에 타일 없이 붙는 헤드리스 접속(인가 게이트는 delegation.toml).
            server::ssh_ops::open_headless_session,
            server::ssh_ops::close_headless_session,
            // `~/.aynx/delegation.toml`(호스트별 AI 권한) 읽기·쓰기 — 호스트 폼의 "AI" 칸·타일 AI 권한 팝오버와
            // 이름 변경·제거 팬아웃. 쓰기가 성공하면 `delegation-changed` 를 낸다
            // (docs/log/2026-09-21-fleet-delegation-ui.md). **쓰기는 Tauri 명령에만 있다** —
            // MCP 에는 대응하는 도구가 없다(승인 명령과 같은 규칙 · 보안 불변).
            delegation::delegation_list_targets,
            delegation::delegation_set_target,
            delegation::database::db_ai_list,
            delegation::database::db_ai_set,
            delegation::database::db_ai_remove,
            delegation::delegation_rename_target,
            delegation::delegation_remove_targets,
            orchestration::artists::orchestration_artist_list,
            orchestration::artists::orchestration_artist_set,
            orchestration::artists::orchestration_artist_remove,
            // 호스트 키 잊기 (`ssh-keygen -R` 상당) — 호스트 줄 우클릭
            // (docs/log/2026-09-16-quick-connect-and-host-keys.md).
            ssh::commands::forget_host_key,
            // 새로 뜬 페이지가 **부팅 첫 줄에서** 부르는 정리 (docs/log/2026-09-05-session-leak-on-reload.md).
            // 이벤트 훅과 하는 일이 같지만 프런트가 `await` 할 수 있어 순서가 보장된다.
            reap::reap_window_sessions,
            handoff::stash_handoff,
            handoff::take_handoff,
            handoff::peek_handoff,
            workspace_windows::workspace_bind_window,
            workspace_windows::workspace_window_binding,
            workspace_windows::workspace_windows,
            workspace_windows::focus_window,
            workspace_windows::workspace_exit_app,
            handoff::open_tear_window,
            handoff::reattach_output,
            server::ssh_proxy::add_forward,
            server::ssh_proxy::list_forwards,
            server::ssh_proxy::remove_forward,
            sftp::edit_remote_file,
            sftp::list_edits,
            sftp::stop_edit,
            sftp::upload_file,
            sftp_browser::browse::sftp_home,
            sftp_browser::browse::sftp_list,
            sftp_browser::browse::sftp_stat,
            sftp_browser::browse::sftp_free_space,
            sftp_browser::text::sftp_read_text,
            sftp_browser::text::sftp_read_preview,
            sftp_browser::text::sftp_write_text,
            sftp_browser::edit::sftp_mkdir,
            sftp_browser::edit::sftp_create_file,
            sftp_browser::edit::sftp_rename,
            sftp_browser::edit::sftp_remove,
            sftp_browser::download::sftp_download,
            // 묶음 작업(다중 선택 잘라내기·복사·붙여넣기, 타일 간 드래그)
            // — docs/log/2026-09-04-fs-batch-ops-backend.md
            sftp_browser::batch::sftp_copy,
            sftp_browser::batch::sftp_move,
            sftp_browser::batch::sftp_remove_many,
            sftp_browser::batch::sftp_conflicts,
            sftp_browser::batch::sftp_upload_paths,
            sftp_browser::batch::sftp_download_paths,
            // 서버 간 복사와 **다른 곳 사이의 잘라내기** (같은 문서의 후속 절)
            sftp_browser::cross::sftp_copy_between,
            sftp_browser::cross::sftp_move_between,
            sftp_browser::cross::local_to_sftp_move,
            sftp_browser::cross::sftp_to_local_move,
            fs_transfer::transfer_cancel,
            // 로컬 디스크 브라우저 — 원격과 같은 UI, 같은 목록 모양(fs_entry::SftpEntry)
            local_browser::local_home,
            local_browser::local_roots,
            local_browser::local_places,
            fs_space::local_free_space,
            local_browser::local_list,
            // 로컬 파일 타일의 자동 새로고침 — 보이는 폴더의 OS 변경 알림(docs/log/2026-10-21-file-tile-auto-refresh.md)
            local_watch::local_watch_start,
            local_watch::local_watch_set,
            local_watch::local_watch_stop,
            local_browser::local_stat,
            local_browser::local_read_text,
            local_browser::local_read_preview,
            local_browser::local_write_text,
            // 팔레트 "파일 열기…" 의 로컬 목록 (docs/log/2026-09-27-doc-tile.md "A — 여는 길")
            file_index::list_text_files,
            local_browser::local_mkdir,
            local_browser::local_create_file,
            local_browser::local_rename,
            local_browser::local_remove,
            local_browser::local_copy,
            local_browser::local_move,
            local_browser::local_remove_many,
            local_browser::local_conflicts,
            local_browser::local_write_file,
            agent_attachments::stage_agent_attachment,
            agent_attachments::create_agent_attachment_dir,
            // 사람이 저장 대화상자에서 고른 자리에 텍스트 한 덩어리 — 타일 메뉴의
            // "스크롤백 저장…" (docs/log/2026-09-17-scrollback-export-and-logs.md).
            local_browser::write_text_file,
            ssh_config::list_hosts,
            config_edit::add_host,
            config_edit::edit_host,
            config_edit::remove_host,
            config_edit::open_ssh_config,
            sessions_meta::get_host_meta,
            sessions_meta::set_host_meta,
            sessions_meta::list_group_meta,
            sessions_meta::set_group_meta,
            sessions_meta::rename_group,
            copy_id::list_agent_public_keys,
            copy_id::agent_has_key,
            copy_id::install_public_key,
            copy_id::install_public_key_line,
            keygen::generate_ssh_key,
            keygen::list_ssh_key_files,
            settings::load_settings,
            settings::save_settings,
            // 설정 › 앱 테마 의 앱 아이콘 — 열린 모든 창에 곧바로 건다(저장은 save_settings).
            app_icon::set_app_icon,
            // 사용자 앱 아이콘 — 목록(썸네일 data URL) · 넣기(자르기 화면의 PNG 바이트) · 지우기 (docs/log/2026-10-22-custom-app-icon.md).
            app_icon::app_icon_list,
            app_icon::app_icon_image,
            app_icon::app_icon_add,
            app_icon::app_icon_remove,
            app_icon::app_icon_rename,
            // 백엔드 문구의 언어 — 프런트의 `setLocale` 이 부를 때마다 전역 한 칸을 바꾼다
            // (docs/log/2026-09-17-i18n.md 의 "Rust 쪽").
            i18n::set_language,
            // 월페이퍼 — 고른 이미지를 앱 폴더로 복사해 소유한다 (docs/log/2026-09-04-wallpaper.md)
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_clear,
            wallpaper::wallpaper_resolve,
            wallpaper::wallpaper_gc,
            wallpaper::wallpaper_random,
            workspaces::workspaces_load,
            workspaces::workspaces_claim_writer,
            workspaces::workspaces_apply,
            workspaces::workspaces_migrate,
            workspaces::workspaces_start_fresh,
            workspaces::workspaces_migration_status,
            // 이름 붙여 저장한 배치 프리셋 — 같은 폴더의 다른 파일
            // (docs/log/2026-09-04-layout-presets.md)
            // 이름 붙여 저장한 **모양 프로필**(월페이퍼+테마) — 또 하나의 같은 관례 파일
            // (docs/log/2026-09-15-theme-profiles.md)
            app_state::load_theme_profiles,
            // 프로필 쓰기는 조작 단위(디스크의 최신 위에 얹는다 — 창 여럿의 덮어쓰기 경합 없음 · 2026-11-03)
            app_state::theme_profiles_edit,
            // 사용자 터미널 테마 — `<설정 루트>/terminal-themes/<id>.json` 목록 · 넣기(프런트가 해석한 21색 — 다시 검증) · 이름 바꾸기 · 지우기.
            term_themes::term_theme_list,
            term_themes::term_theme_add,
            term_themes::term_theme_rename,
            term_themes::term_theme_remove,
            // MCP 거울 — 세션 서버로 가는 프록시(③-3c · `server::ai_proxy`, 순서를 지키는 큐 → `ctx_batch`). 이름·인자는 예전 그대로다.
            server::ai_proxy::report_session,
            server::ai_proxy::update_session_context,
            server::ai_proxy::push_session_block,
            server::ai_proxy::push_session_blocks,
            server::ai_proxy::drop_session,
            mcp::register::mcp_status,
            // 상태바 `✦ AI 연결` — 마지막 MCP 요청의 도장 하나(docs/log/2026-09-21-statusbar-signals.md). 서버 op `mcp_activity`.
            server::ai_proxy::mcp_activity,
            // 설정 › MCP › 세션 서버 하위 화면 — 도구 목록 · 최근 도구 호출(읽기 · 비밀 없음). 서버 op `mcp_tools` · `mcp_calls`.
            server::ai_proxy::mcp_tools,
            server::ai_proxy::mcp_calls,
            // A3a — 사람 콘솔용 전역 세션 목록(라이브 거울 + 미접속 read-granted 위임 대상). 서버 op `console_sessions`.
            server::ai_proxy::list_console_sessions,
            mcp::cli::list_ai_clis,
            // 사이드 채팅 칩의 Codex 모델 목록 — Codex 의 모델 캐시 · config.toml 을 읽기만(프로세스 없음)
            codex_models::codex_models,
            mcp::register::take_mcp_notice,
            // Claude Code 훅 설치·제거 — 에이전트 상태 점의 정확한 신호
            // (docs/log/2026-09-24-agent-hook-signals.md). `~/.claude/settings.json` 을 우리 항목만 고친다.
            agent_hooks::agent_hooks_targets,
            agent_hooks::agent_hooks_status,
            agent_hooks::agent_hooks_install,
            agent_hooks::agent_hooks_remove,
            agent_hooks::agent_hooks_remote_status,
            agent_hooks::agent_hooks_remote_install,
            agent_hooks::agent_hooks_remote_remove,
            agent_hooks::agent_hooks_take_local_refresh,
            // 에이전트의 지난 대화 — 목록(프로젝트·워크트리별 + 기타)과 재개·포크 명령 한 줄
            // (docs/log/2026-09-26-agent-sessions.md). 읽기 전용 · 로컬만.
            // 에이전트 상태 표(스트림 → 상태)의 스냅숏과 창이 본 새 CLI·셸 복귀 알림 — `agent_state` 머리말.
            // 표는 세션 서버에 산다(③-3a) — 같은 이름의 프록시.
            server::proxy::agent_states_snapshot,
            server::proxy::agent_conversation_links,
            server::proxy::agent_state_forget,
            server::proxy::agent_state_interrupt,
            server::proxy::agent_state_seen,
            server::proxy::agent_conversation_launched,
            // 로컬 자원 모니터 — 타일 칩 · 자원 칸이 보일 때만 2초마다(서버 op 같은 이름 · 관찰 임대).
            server::resources::resource_snapshot,
            agent_sessions::agent_sessions_list,
            agent_sessions::agent_session_launch_spec,
            agent_sessions::rename::agent_session_rename,
            agent_sessions::delete::agent_session_delete,
            agent_sessions_remote::agent_sessions_remote_list,
            agent_sessions_remote::agent_session_remote_launch_spec,
            agent_sessions_remote::agent_usage_remote_read,
            agent_sessions_remote::agent_usage_remote_limits,
            agent_sessions_remote::agent_conversation_transcript_remote,
            agent_transcript::agent_conversation_transcript,
            agent_transcript::agent_conversation_image,
            agent_sessions_remote::agent_conversation_image_remote,
            agent_usage::agent_usage_scan,
            agent_usage::agent_usage_limits,
            agent_usage::agent_usage_summary,
            agent_autorun::agent_autorun_command,
            agent_args::agent_args_targets,
            agent_args::agent_launch_preview,
            agent_mcp::agent_mcp_validate,
            agent_instructions::instructions_list,
            agent_instructions::instruction_save,
            agent_instructions::instruction_delete,
            agent_instructions::instructions_preview,
            agent_instructions::instructions_apply,
            agent_instructions::instructions_import_candidates,
            agent_instructions::instructions_apply_worktree,
            // 단계 8 — 작업안 검토 UI(실행 0). 저장·요청은 MCP 도구가, 거절·대상수정은 여기가.
            operations::commands::list_operations,
            operations::commands::operation_results,
            operations::commands::reject_operation,
            operations::commands::modify_operation_targets,
            // 단계 9 — 실행 브로커. 승인·취소는 **Tauri 명령 전용**이다(MCP 도구가 아니다 —
            // AI 는 승인·실행·취소에 닿을 표면이 없다 · 보안 불변). ③-3c 부터 실행기는 세션 서버에 살고, 승인 등급 프레임을
            // 만드는 코드는 `approve_operation` 하나다(`server::client::request_approve`).
            operations::approval::approve_operation,
            policy::explain::test_auto_approval,
            operations::approval::cancel_operation,
            // 서버 자동 승인과의 짝(③-4) — 사람이 검토 중인 작업안 알리기(승인 아님) · GUI 가 없던 동안 끝난 실행 꺼내기.
            server::ai_proxy::set_reviewing_operations,
            server::ai_proxy::take_unseen_operation_results,
            server::orchestration_proxy::orchestration_pause,
            server::orchestration_proxy::orchestration_resume,
            server::orchestration_proxy::orchestration_stop,
            server::orchestration_proxy::orchestration_snapshot,
            server::orchestration_proxy::orchestration_run,
            server::orchestration_proxy::orchestration_set_task_state,
            server::orchestration_proxy::orchestration_archive,
            server::orchestration_proxy::orchestration_archive_list,
            server::orchestration_proxy::orchestration_restore,
            server::orchestration_proxy::orchestration_delete_archived,
            server::orchestration_proxy::orchestration_stop_worker,
            server::orchestration_proxy::orchestration_wt_remove,
            server::orchestration_proxy::orchestration_review_task,
            server::orchestration_proxy::orchestration_complete_run,
            server::orchestration_proxy::orchestration_release_hold,
            server::orchestration_proxy::orchestration_cancel_integration,
            server::orchestration_proxy::orchestration_reconcile_preview,
            server::orchestration_proxy::orchestration_reconcile,
            server::orchestration_proxy::orchestration_export,
            server::orchestration_proxy::orchestration_merge_preview,
            server::orchestration_proxy::orchestration_merge,
            server::orchestration_proxy::orchestration_approve_verify,
            server::orchestration_proxy::orchestration_override_verify,
            server::orchestration_proxy::orchestration_cleanup_preview,
            server::orchestration_proxy::orchestration_cleanup,
            server::orchestration_proxy::orchestration_discard_temp,
            server::orchestration_proxy::orchestration_report_files,
            server::orchestration_proxy::orchestration_report_drift,
            server::orchestration_proxy::orchestration_worker_activity,
            server::orchestration_proxy::orchestration_notices,
            server::orchestration_proxy::orchestration_notices_ack,
            server::orchestration_proxy::orchestration_same_dir_index,
            server::orchestration_proxy::orchestration_worker_transcript,
            // 단계 10a — 감사 로그 읽기(읽기 전용). 감사 뷰는 후속이고, 지금은 파일이 산출물이다.
            audit::list_audit,
            audit::audit_runs,
            // 백로그 #8 — 감사 관측성. 관제판이 "감사가 도는지"(기록 N·실패 M·폴더)를 볼 수 있게.
            audit::audit_status,
            // 저장해 둔 명령(스니펫) — `layouts.json` 과 같은 관례의 네 번째 파일
            // (docs/log/2026-09-16-snippets.md). 백엔드는 스키마를 모른다.
            host_history::host_history_list,
            host_history::host_history_clear,
            host_history::host_history_forget,
            host_history::host_history_rename,
            // 프로젝트 목록 (docs/log/2026-09-24-projects.md) — `projects.json`, 한 줄씩 고치고
            // `projects-changed` 를 쏜다. 호스트 이름 변경·제거 팬아웃이 뒤의 둘을 부른다.
            projects::projects_list,
            projects::project_upsert,
            projects::project_remove,
            projects::project_rename_host,
            projects::projects_forget_host,
            worktree::git_worktree_list,
            worktree_changes::git_worktree_changes,
            worktree_changes::ssh_git_worktree_changes,
            // 브랜치 그래프 (docs/log/2026-09-29-branch-graph.md) — 읽기 전용, 원격은 붙은 세션의 exec 한 번
            // 커밋 그래프 — 브랜치 타일의 "한 줄 = 커밋 하나" 재료. 읽기 전용, 원격은 붙은 세션의 exec 한 번
            commit_graph::git_commit_graph,
            commit_graph::ssh_git_commit_graph,
            commit_graph::git_commit_files,
            commit_graph::ssh_git_commit_files,
            commit_graph::git_worktree_wip_files,
            commit_graph::ssh_git_worktree_wip_files,
            diff_view::git_diff_files,
            diff_view::ssh_git_diff_files,
            diff_view::git_diff_file,
            diff_view::ssh_git_diff_file,
            worktree::git_change_snapshot,
            worktree::git_worktree_add,
            worktree::git_worktree_remove,
            worktree::ssh_git_worktree_list,
            remote_worktree::ssh_worktree_answer,
            worktree::ssh_git_worktree_remove,
            worktree_branch::git_worktree_branch_choices,
            worktree_branch::git_worktree_add_preview,
            worktree_branch::git_branch_delete,
            worktree_branch::ssh_git_worktree_branch_choices,
            worktree_branch::ssh_git_worktree_add_preview,
            worktree_branch::ssh_git_branch_delete,
            // 설정 스크립트 — 타일이 칠 한 줄 · 워크트리별 실행 기록 (docs/log/2026-09-28-project-agent-setup-script.md)
            setup_script::project_setup_line,
            worktree::worktree_setup_record,
            worktree::worktree_setup_count,
            // 저장소 상태·초기화·새 프로젝트 폴더 (docs/log/2026-09-28-project-create.md)
            git_repo::git_repo_status,
            git_repo::git_repo_init,
            git_repo::git_project_create,
            git_repo::ssh_git_repo_status,
            git_repo::ssh_git_repo_init,
            git_repo::ssh_git_project_create,
            // 타일 머리줄 브랜치 칩 — 폴더 하나가 선 HEAD (src/lib/app/pane-git.svelte.ts)
            git_repo::git_head,
            git_repo::ssh_git_head,
            snippets::load_snippets,
            snippets::save_snippets,
            // 채팅 사이드 독(2026-10-23) — 채팅 목록 파일 · 채팅마다 폴더(`side_chat/store.rs`)
            side_chat::store::side_chats_load,
            side_chat::store::side_chats_save,
            side_chat::store::side_chat_dir,
            side_chat::store::side_chat_remove,
            side_chat::store::side_chat_instructions_load,
            side_chat::store::side_chat_instructions_save,
            // 사이드 채팅 v2(3단계) — 세션 서버의 채팅 프로세스 op 프록시 · 사람 창(주 창 · 원격 창) 사건 통로(`server::side_chat_proxy`)
            server::side_chat_proxy::side_chat_open,
            server::side_chat_proxy::side_chat_send,
            server::side_chat_proxy::side_chat_interrupt,
            server::side_chat_proxy::side_chat_set_model,
            server::side_chat_proxy::side_chat_set_effort,
            server::side_chat_proxy::side_chat_decide,
            server::side_chat_proxy::side_chat_close,
            server::side_chat_proxy::side_chat_attach,
            server::side_chat_proxy::side_chat_list,
            server::side_chat_proxy::side_chat_subscribe,
            server::side_chat_proxy::side_chat_link,
            // 타일 권한 카드(2026-11-01) — 사람의 결정 · 스냅숏 · 그 창의 사건 통로(`server::tile_permission_proxy`)
            server::tile_permission_proxy::tile_permission_decide,
            server::tile_permission_proxy::tile_permission_face,
            server::tile_permission_proxy::tile_permission_snapshot,
            server::tile_permission_proxy::tile_permission_subscribe,
            server::tile_permission_proxy::tile_permission_analyze,
            server::producer_proxy::producer_chat_open,
            server::producer_proxy::producer_album_start,
            server::producer_proxy::orchestration_album_widen,
            server::producer_proxy::orchestration_album_set,
            server::producer_proxy::orchestration_rename_album,
            server::producer_proxy::producer_fork_probe,
            server::producer_proxy::orchestration_album_defaults,
            server::producer_proxy::producer_chat_send,
            server::producer_proxy::producer_chat_interrupt,
            server::producer_proxy::producer_chat_set_model,
            server::producer_proxy::producer_chat_set_effort,
            server::producer_proxy::producer_chat_decide,
            server::producer_proxy::producer_chat_queue_cancel,
            server::producer_proxy::producer_chat_close,
            server::producer_proxy::producer_chat_attach,
            server::producer_proxy::producer_chat_status,
            server::producer_proxy::producer_chat_list,
            server::producer_proxy::producer_chat_subscribe,
            server::producer_proxy::producer_chat_unsubscribe,
            // 자격증명 금고 (docs/log/2026-09-19-vault.md). **값을 돌려주는 명령은 하나도
            // 없다** — 프런트가 보는 것은 상태·목록(대상뿐)·있는가까지다. 실제로 비밀을 쓰는
            // `vault::password_for`·`passphrase_for` 는 `pub(crate)` 라 IPC 표면에 없고,
            // MCP 에도 대응하는 도구가 없다(승인 명령과 같은 규칙 — AI 는 금고에 못 닿는다).
            // ③-3b1 — 금고는 세션 서버에 산다. 이 명령들은 같은 이름의 서버 op 프록시다(`server::vault_proxy`).
            server::vault_proxy::vault_status,
            server::vault_proxy::vault_create,
            server::vault_proxy::vault_unlock,
            server::vault_proxy::vault_lock,
            server::vault_proxy::vault_set_master,
            server::vault_proxy::vault_verify_master,
            server::vault_proxy::vault_list,
            server::vault_proxy::vault_delete,
            server::vault_proxy::vault_delete_all,
            server::vault_proxy::vault_store_password,
            server::vault_proxy::vault_store_mcp_env,
            server::vault_proxy::vault_store_passphrase,
            server::vault_proxy::vault_has_password,
            server::vault_proxy::vault_has_passphrase,
            server::vault_proxy::vault_store_db_password,
            server::vault_proxy::vault_has_db_password,
            // 쿼리 타일(5단계) — DB 평면은 세션 서버(`server::db_ops`), 이 명령들은 같은 이름의 프록시 · '경유 없음' 목록은 GUI 가 파일을 직접.
            server::db_proxy::db_open,
            server::db_proxy::db_test,
            server::db_proxy::db_query,
            server::db_proxy::db_cancel,
            server::db_proxy::db_schema,
            server::db_proxy::db_objects,
            server::db_proxy::db_table_detail,
            server::db_proxy::db_definition,
            server::db_proxy::db_set_write,
            server::db_proxy::db_close,
            server::db_proxy::db_tx,
            server::db_proxy::db_script,
            db::conns::db_conn_list,
            db::conns::db_conn_save,
            db::conns::db_folders_load,
            db::conns::db_folders_save,
            // DB 연결별 접속 기록(`db-history.json` — 독 DB 칸 "최근") — 읽기만(적기는 세션 서버의 `db_open`, 지우기는 위 `db_conn_save`).
            db_history::db_history_list,
            // 메신저 알림 — 웹훅 채널 (docs/log/2026-09-27-discord-notify.md · 2026-09-28-messenger-channels.md).
            // 볼트와 같은 선: URL 을 돌려주는 명령은 없다(`configured` 하나). MCP 에도 대응하는 도구가 없다.
            messenger::messenger_status,
            messenger::messenger_set_webhook,
            messenger::messenger_test,
            messenger::messenger_send,
            // 원격 웹 클라이언트 관문(R1a) — 상태(메모리만 · 원격 허용) · 페어링 답·대기(집 PC 전용) · 기기 목록·폐기(원격 허용) ·
            // 이름 찾기(집 PC 전용) · 기록 · 이름 바꾸기 · 모두 끊기(원격 허용 — R1a-5) — 분류는 `remote/deny.rs`.
            remote::remote_status,
            remote::remote_gate_theme_set,
            remote::remote_pair_respond,
            remote::remote_pair_pending,
            remote::remote_devices_list,
            remote::remote_device_revoke,
            remote::remote_detect_host,
            remote::serve::remote_serve_status,
            remote::serve::remote_serve_connect,
            remote::serve::remote_serve_off,
            remote::remote_log,
            remote::remote_device_rename,
            remote::remote_disconnect_all,
            // 집 PC 화면 배치 거울(R2-B) — 주 창이 올리고(집 PC 전용) 원격 창이 받는다(원격 허용) · `remote/mirror.rs`.
            remote::mirror::mirror_publish,
            remote::mirror::mirror_get,
            // 원격의 배치 바꾸기 요청(R3) — 원격이 보내고(원격 허용) 주 창이 받아 답한다(집 PC 전용).
            remote::mirror::mirror_request,
            remote::mirror::mirror_request_inbox,
            remote::mirror::mirror_respond
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // 창이 모두 사라져 Tauri 가 끝내려 한다 — **트레이가 서 있으면 남는다**(③-4 — `tray::leave_to_tray` 뒤). 명시 종료
            // (`app.exit` — 코드가 있다)는 막지 않는다. 트레이가 없으면(설정 끔 · 미지원 OS) 예전처럼 끝난다(세션은 서버에 산다).
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                if tray::active(app) {
                    api.prevent_exit();
                }
            }
        });
}

/// 테스트 전용 지원물 — 프로덕션 빌드에는 들어가지 않는다.
#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Mutex;

    /// **루프백 TCP 포트를 바인드하는 테스트를 직렬화**하는 잠금.
    ///
    /// cargo test 는 한 바이너리 안의 테스트를 스레드로 병렬 실행한다. 포트 0 으로 빈 포트를
    /// 받아 두고 놓았다가 같은 번호를 다시 잡는 테스트가 있는데, 그 빈틈에 다른 테스트가
    /// 포트 0 바인드로 같은 번호를 받아 가면 재바인드가 실패한다. 포트를 잡는 테스트는
    /// 전부 본문 첫 줄에서 이 잠금을 쥔다.
    ///
    /// 오염(panic 한 테스트가 남긴 poison)은 무시한다 — 지키는 것이 데이터가 아니라
    /// **OS 포트 공간**이라 이전 테스트의 실패가 이 잠금의 값을 망가뜨릴 수 없다:
    /// `lock().unwrap_or_else(|e| e.into_inner())`.
    pub(crate) static NET_TEST_LOCK: Mutex<()> = Mutex::new(());
}
