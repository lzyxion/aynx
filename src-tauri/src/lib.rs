//! 앱 조립 — 모든 모듈 선언 · 앱 전역 상태(`manage`) · Tauri 명령 등록(`generate_handler!`) · 창 이벤트. 기능 코드를 두지 않는다.
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
mod telegram;
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
mod settings_transfer;
mod snippets;
mod socks5;
mod ssh;
mod ssh_config;
mod ssh_pool;
mod tab_templates;
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
/// `aynx claude-usage` — Claude Code mod 가 넘긴 요금제 한도를 파일에 적는 도우미. `main.rs` 가 Tauri 를 띄우기 **전에**
/// 첫 인자로 가른다(창도 런타임도 없이 표준 입력만 읽고 끝난다 · 늘 0).
pub fn claude_usage_main() -> i32 {
    claude_usage::helper_main()
}

/// `aynx statusline …` — 옛 판이 띄운 claude · 셸이 아직 부르는 갈래. 늘 0.
pub fn statusline_main() -> i32 {
    claude_usage::legacy_statusline_main()
}

/// `aynx agent-permission <pre|ask|post> <claude|codex>` — 타일 장식이 그 CLI 에만 건 권한 훅의 도우미. 늘 0.
pub fn agent_permission_main() -> i32 {
    tile_permission::helper::main()
}

/// 외부 stdio MCP 실행 도우미 — 환경변수를 앱 메모리의 실행 브로커에서 받는다.
pub fn mcp_launch_main() -> i32 {
    mcp_launch::helper_main()
}

/// `aynx session-server` — 세션 서버 프로세스.
pub fn session_server_main() -> i32 {
    server::session_server_main()
}

pub fn run() {
    // 옛 제품 이름 시절의 폴더를 한 번만 옮긴다 — **설정·mcp.json 을 쓰기·읽기 전에**(늦으면 설정이 "첫 실행" 으로 보인다).
    settings::migrate_legacy_app_dir();
    mcp::migrate_legacy_home_dir();

    // 개발 폴더 씨앗 — **설정을 읽기 전에**, 옛 개발 폴더를 옮긴 **뒤에**(먼저 뿌리면 새 폴더가 생겨 옛 개발 폴더 이전이 막힌다)
    // (docs/log/2026-09-26-dev-release-isolation.md).
    instance::seed_dev_root();

    let mut context = tauri::generate_context!();
    instance::apply_to_context(&mut context);
    // 창이 하나라도 생기기 전이어야 한다 — 늦으면 작업 표시줄이 창을 시작 메뉴 바로 가기와 묶어 바로 가기 아이콘이 선다
    // (docs/log/2026-10-06-taskbar-app-id.md).
    app_icon::set_process_app_id(&context.config().identifier);
    // 둘째 실행이 첫 인스턴스의 이벤트 창이 서기 전에 닿으면 플러그인이 그냥 계속 띄운다 — 그 틈을 메운다.
    single_instance_gate::wait_for_first_instance(&context.config().identifier);

    tauri::Builder::default()
        // **GUI 한 개** — 첫 플러그인이어야 둘째 실행이 다른 플러그인 · setup · 세션 서버 연결에 닿기 전에 끝난다.
        // 식별자는 Tauri identifier(개발 빌드는 `-dev`)라 개발 앱과 릴리스는 서로 막지 않는다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 다른 스레드에서 `run_on_main_thread` 로 이벤트 고리에 미룬다 — 이 콜백은 WM_COPYDATA 처리 안(메인 스레드)에서 돌고,
            // 첫 인스턴스가 부팅 중일 때 창을 만지면 웹뷰 생성과 엉켜 둘 다 멈춘다. 메인 스레드에서 부르면 그 자리에서 바로 돈다.
            let handle = app.clone();
            std::thread::spawn(move || {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || tray::open_main(&app, None));
            });
        }))
        .setup(move |app| {
            use tauri::Manager;
            app.manage(mcp::McpState::default());
            // **명령이 돌기 전에** 건다 — "OS 를 따른다" 를 아는 쪽은 프런트라 부팅 첫 줄의 `set_language` 가 곧바로 바로잡는다.
            if let Some(l) = settings::app_language().as_deref().and_then(i18n::parse) {
                i18n::set_lang(l);
            }
            app_icon::init(settings::app_icon().as_deref());
            app_icon::sync_taskbar(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                app_icon::apply_to_window(&window.as_ref().window());
            }
            mcp::spawn_unregister_migration(app.handle().clone());
            tauri::async_runtime::spawn(agent_mcp::cleanup_stale_configs());
            tauri::async_runtime::spawn_blocking(agent_attachments::cleanup_stale);
            // 설치된 훅 스크립트 사본만 갈아 쓴다 — 에이전트 설정 파일(`~/.claude/settings.json` · `~/.codex/hooks.json`)은 건드리지 않는다.
            tauri::async_runtime::spawn_blocking(agent_hooks::refresh_installed_script);
            // 이 PC 설정에서 **우리 항목만** 새 등록 모양으로 맞춘다(사용자 항목은 그대로).
            tauri::async_runtime::spawn_blocking(agent_hooks::refresh_local_entries_once);
            server::client::start(app.handle().clone());
            tray::install(app.handle());
            remote::install(app.handle());
            Ok(())
        })
        // ── 세션 누수 그물 ──────────
        // `Started` 만 본다 — `Finished` 는 새 페이지의 스크립트가 이미 돈 뒤라 방금 열린 세션을 물 수 있다
        // (docs/log/2026-09-05-session-leak-on-reload.md).
        .on_page_load(|webview, payload| {
            use tauri::Manager;
            if payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            let window = webview.window();
            // 원격 창(숨은 웹뷰)은 앱 프런트가 아니다 — 거둠·아이콘·크래시 감시가 없다.
            if remote::is_remote_label(window.label()) {
                return;
            }
            // 리로드·웹뷰 크래시 — 로컬 세션은 닫지 않고 떼어 둔다(새 페이지의 타일이 다시 붙는다).
            reap::spawn_reap(webview.app_handle(), window.label(), reap::Event::Reload);
            local_watch::forget_window(window.label());
            // 메인·보조·떼어 낸 창이 모두 여기를 지나므로 창 생성 경로마다 따로 걸지 않는다.
            app_icon::apply_to_window(&window);
            webview_crash::watch(webview);
        })
        // `CloseRequested` 가 아니라 `Destroyed` 다 — 닫기를 막은 창의 세션을 죽이면 살아 있는 화면이 빈 껍데기가 된다.
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if matches!(event, tauri::WindowEvent::Destroyed) {
                webview_crash::forget(window.label());
                // 파일 감시 구독은 원격 창 몫도 여기서 걷는다 — 아래 원격 갈래가 먼저 돌아 나간다.
                local_watch::forget_window(window.label());
                window
                    .app_handle()
                    .state::<workspace_windows::Bindings>()
                    .remove(window.label());
                let _ = window
                    .app_handle()
                    .emit("workspace-window-gone", window.label());
                // 앱 종료·트레이로 가는 중(`QUITTING`)이면 세션을 닫지 않고 떼어 둔다 — **사건 순간에** 갈라야 트레이 [열기] 가
                // 표식을 걷은 뒤에 늦게 도는 거둠이 닫지 않는다.
                let leaving = server::proxy::QUITTING.load(std::sync::atomic::Ordering::SeqCst);
                let event = reap::destroyed_event(leaving);
                reap::spawn_reap(window.app_handle(), window.label(), event);
                server::ai_proxy::forget_reviewing_window(window.label());
                let _ = window.app_handle().emit(server::sessions::DETACHED_CHANGED, ());
                // 원격 창이 밖에서 부서졌다 — 그 ws 연결을 닫게 한다. 볼트 셈은 그 연결이 끝나며 한다.
                if remote::is_remote_label(window.label()) {
                    remote::remote_window_gone(window.label());
                    return;
                }
                remote::mirror_main_window_gone(window.app_handle(), window.label());
                // 보는 창이 하나도 남지 않으면 볼트를 창 0개 잠금으로 — 원격 창은 창으로 세지 않되, 열린 원격(살아 있는 원격 창 ·
                // 유예)이 있으면 그것이 "보는 창" 이다. F5·최소화·숨김은 파괴가 아니라 여기 오지 않는다.
                let app = window.app_handle();
                let others = remote::has_home_window_except(app, window.label());
                if !others {
                    if remote::vault_lock_due(0, remote::remote_present()) {
                        server::vault_proxy::lock_on_last_window();
                    }
                    // 트레이가 없으면 숨은 원격 창만 남아 Tauri 가 끝나지 않는 일을 막는다.
                    if !tray::active(app) {
                        remote::close_remote_windows();
                    }
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_drag::init())
        // `navigator.clipboard.readText()` 는 WebView2 의 "클립보드 보기 허용/차단" 창을 띄운다 — 권한은 read-text 하나만 연다.
        .plugin(tauri_plugin_clipboard_manager::init())
        // 업데이터 플러그인의 JS 명령 · 권한은 웹뷰에 열지 않는다(capabilities 에 `updater:*` 없음) — `updater.rs` 의 Tauri 명령만 거친다.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Builder 에 가로채기는 **하나**뿐이다 — 다른 용도가 생기면 이 함수 안에서 합친다.
        .channel_interceptor(remote::channel_interceptor)
        .manage(handoff::Mailbox::default())
        .manage(workspace_windows::Bindings::default())
        .invoke_handler(tauri::generate_handler![
            pty::list_shells,
            server::proxy::open_local_session,
            server::proxy::local_cwd,
            server::proxy::write_session,
            server::proxy::resize_session,
            server::proxy::claim_session_size,
            server::proxy::close_session,
            server::proxy::ack_local_output,
            session_core::commands::detach_session,
            session_core::commands::attach_session,
            session_core::commands::attach_session_viewer,
            session_core::commands::detach_session_viewer,
            session_core::commands::probe_session,
            session_core::commands::stash_checkpoint,
            session_core::commands::restore_done_sessions,
            session_core::commands::detached_sessions,
            session_core::commands::close_detached_session,
            session_core::commands::set_session_ai_read,
            tray::take_tray_intent,
            tray::tray_status,
            tray::app_end_all_sessions,
            tray::app_quit_gui,
            tray::app_hide_to_tray,
            keep_awake::keep_awake_status,
            keep_awake::keep_awake_set,
            server::client::session_server_status,
            server::client::session_server_restart,
            server::client::session_server_close_all,
            updater::update_state,
            updater::update_check,
            updater::update_download,
            updater::update_install,
            updater::update_skip,
            updater::update_mark_toasted,
            session_commands::session_stats,
            session_log::session_log_path,
            session_log::session_logs_dir,
            server::ssh_proxy::open_ssh_session,
            server::ssh_proxy::session_info,
            ssh::commands::ssh_tmux_cwd,
            ssh::commands::ssh_tmux_list,
            ssh::commands::ssh_tmux_kill,
            ssh::commands::ssh_remote_home,
            server::ssh_ops::open_headless_session,
            server::ssh_ops::close_headless_session,
            // 위임 **쓰기는 Tauri 명령에만 있다** — MCP 에는 대응하는 도구가 없다(보안 불변).
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
            ssh::commands::forget_host_key,
            // 새 페이지가 **부팅 첫 줄에서** 부른다 — 이벤트 훅과 같은 일이지만 프런트가 `await` 할 수 있어 순서가 보장된다.
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
            sftp_browser::text::sftp_read_image,
            sftp_browser::text::sftp_write_text,
            sftp_browser::edit::sftp_mkdir,
            sftp_browser::edit::sftp_create_file,
            sftp_browser::edit::sftp_rename,
            sftp_browser::edit::sftp_remove,
            sftp_browser::download::sftp_download,
            sftp_browser::batch::sftp_copy,
            sftp_browser::batch::sftp_move,
            sftp_browser::batch::sftp_remove_many,
            sftp_browser::batch::sftp_conflicts,
            sftp_browser::batch::sftp_upload_paths,
            sftp_browser::batch::sftp_download_paths,
            sftp_browser::cross::sftp_copy_between,
            sftp_browser::cross::sftp_move_between,
            sftp_browser::cross::local_to_sftp_move,
            sftp_browser::cross::sftp_to_local_move,
            fs_transfer::transfer_cancel,
            local_browser::local_home,
            local_browser::local_roots,
            local_browser::local_places,
            fs_space::local_free_space,
            local_browser::local_list,
            local_watch::local_watch_start,
            local_watch::local_watch_set,
            local_watch::local_watch_stop,
            local_browser::local_stat,
            local_browser::local_read_text,
            local_browser::local_read_preview,
            local_browser::local_read_image,
            local_browser::local_write_text,
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
            app_icon::set_app_icon,
            app_icon::app_icon_list,
            app_icon::app_icon_image,
            app_icon::app_icon_add,
            app_icon::app_icon_remove,
            app_icon::app_icon_rename,
            i18n::set_language,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_set_bytes,
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
            app_state::load_theme_profiles,
            app_state::theme_profiles_edit,
            term_themes::term_theme_list,
            term_themes::term_theme_add,
            term_themes::term_theme_rename,
            term_themes::term_theme_remove,
            server::ai_proxy::report_session,
            server::ai_proxy::update_session_context,
            server::ai_proxy::push_session_block,
            server::ai_proxy::push_session_blocks,
            server::ai_proxy::drop_session,
            mcp::register::mcp_status,
            server::ai_proxy::mcp_activity,
            server::ai_proxy::mcp_tools,
            server::ai_proxy::mcp_calls,
            server::ai_proxy::list_console_sessions,
            mcp::cli::list_ai_clis,
            codex_models::codex_models,
            mcp::register::take_mcp_notice,
            agent_hooks::agent_hooks_targets,
            agent_hooks::agent_hooks_status,
            agent_hooks::agent_hooks_install,
            agent_hooks::agent_hooks_remove,
            agent_hooks::agent_hooks_remote_status,
            agent_hooks::agent_hooks_remote_install,
            agent_hooks::agent_hooks_remote_remove,
            agent_hooks::agent_hooks_take_local_refresh,
            server::proxy::agent_states_snapshot,
            server::proxy::agent_conversation_links,
            server::proxy::agent_state_forget,
            server::proxy::agent_state_interrupt,
            server::proxy::agent_state_seen,
            server::proxy::agent_conversation_launched,
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
            operations::commands::list_operations,
            operations::commands::operation_results,
            operations::commands::reject_operation,
            operations::commands::modify_operation_targets,
            // 승인·취소는 **Tauri 명령 전용**이다 — AI 는 승인·실행·취소에 닿을 표면이 없다(보안 불변). 승인 등급 프레임을
            // 만드는 코드는 `approve_operation` 하나다.
            operations::approval::approve_operation,
            policy::explain::test_auto_approval,
            operations::approval::cancel_operation,
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
            audit::list_audit,
            audit::audit_runs,
            audit::audit_status,
            host_history::host_history_list,
            host_history::host_history_clear,
            host_history::host_history_forget,
            host_history::host_history_rename,
            projects::projects_list,
            projects::project_upsert,
            projects::project_remove,
            projects::project_rename_host,
            projects::projects_forget_host,
            worktree::git_worktree_list,
            worktree_changes::git_worktree_changes,
            worktree_changes::ssh_git_worktree_changes,
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
            setup_script::project_setup_line,
            worktree::worktree_setup_record,
            worktree::worktree_setup_count,
            git_repo::git_repo_status,
            git_repo::git_repo_init,
            git_repo::git_project_create,
            git_repo::ssh_git_repo_status,
            git_repo::ssh_git_repo_init,
            git_repo::ssh_git_project_create,
            git_repo::git_head,
            git_repo::ssh_git_head,
            snippets::load_snippets,
            snippets::save_snippets,
            tab_templates::load_tab_templates,
            tab_templates::save_tab_templates,
            settings_transfer::settings_export_summary,
            settings_transfer::settings_export,
            settings_transfer::settings_import_preview,
            settings_transfer::settings_import_apply,
            side_chat::store::side_chats_load,
            side_chat::store::side_chats_save,
            side_chat::store::side_chat_dir,
            side_chat::store::side_chat_remove,
            side_chat::store::side_chat_instructions_load,
            side_chat::store::side_chat_instructions_save,
            server::side_chat_proxy::side_chat_open,
            server::side_chat_proxy::side_chat_send,
            server::side_chat_proxy::side_chat_interrupt,
            server::side_chat_proxy::side_chat_seen,
            server::side_chat_proxy::side_chat_set_model,
            server::side_chat_proxy::side_chat_set_effort,
            server::side_chat_proxy::side_chat_decide,
            server::side_chat_proxy::side_chat_set_perm_mode,
            server::side_chat_proxy::side_chat_forget_allow,
            server::side_chat_proxy::side_chat_close,
            server::side_chat_proxy::side_chat_attach,
            server::side_chat_proxy::side_chat_list,
            server::side_chat_proxy::side_chat_subscribe,
            server::side_chat_proxy::side_chat_link,
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
            // 볼트 — **값을 돌려주는 명령은 하나도 없다**(상태 · 목록 · 있는가까지) · MCP 에도 대응하는 도구가 없다.
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
            db_history::db_history_list,
            // 메신저 웹훅 — URL 을 돌려주는 명령은 없다(`configured` 하나) · MCP 에도 대응하는 도구가 없다.
            messenger::messenger_status,
            messenger::messenger_set_webhook,
            messenger::messenger_replace_bot_with_webhook,
            messenger::messenger_test,
            messenger::messenger_send,
            // 메신저 다리 — 토큰을 돌려주는 명령은 없다 · 토큰 파일을 읽는 것은 세션 서버뿐.
            server::messenger_bridge_proxy::messenger_bot_status,
            server::messenger_bridge_proxy::messenger_bot_set_token,
            server::messenger_bridge_proxy::messenger_bot_pair,
            server::messenger_bridge_proxy::messenger_bot_unpair,
            server::messenger_bridge_proxy::messenger_bot_test,
            server::messenger_bridge_proxy::messenger_bot_label,
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
            remote::mirror::mirror_publish,
            remote::mirror::mirror_get,
            remote::mirror::mirror_request,
            remote::mirror::mirror_request_inbox,
            remote::mirror::mirror_respond
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // 트레이가 서 있으면 남는다 — 명시 종료(`app.exit` — 코드가 있다)는 막지 않는다.
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

    /// **루프백 TCP 포트를 바인드하는 테스트를 직렬화**하는 잠금 — 포트 0 으로 받은 번호를 놓았다 다시 잡는 사이 다른 테스트가
    /// 가져가면 재바인드가 실패한다. 포트를 잡는 테스트는 전부 본문 첫 줄에서 쥔다. poison 은 무시한다(지키는 것은 OS 포트 공간이다).
    pub(crate) static NET_TEST_LOCK: Mutex<()> = Mutex::new(());
}
