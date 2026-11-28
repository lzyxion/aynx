//! 원격 창의 명령 문 — 원격 브라우저의 앱 명령은 모두 이 표를 지나야 Tauri 에 닿는다(`bridge::admit`). 앱 명령은 ACL 을 보지 않으므로
//! (앱 ACL 매니페스트 없음 · Local 출처) 앱 명령의 문은 이 파일 하나다(→ docs/invariants.md 전문 13). 플러그인 명령(`plugin:*`)은 여기 오지 않고
//! `capabilities/remote.json` 의 ACL 이 막는다 — 열린 것은 `event|emit · emit_to` · `path|*` 뿐이다.
//!
//! 권한 B: 원격 창 ≈ 메인 PC 창이다. 표는 넷이고 명령마다 정확히 하나에 있다 — 시험 `every_command_is_classified_once` 가 `lib.rs` 의
//! `generate_handler![…]` 를 훑어 지킨다(표에 없는 명령은 원격에서 [`Class::Unknown`] 으로 거절된다).
//!
//! | 표 | 원격에서 |
//! | --- | --- |
//! | [`HOME_ONLY`] | 거절 "메인 PC 에서만 할 수 있습니다" |
//! | [`REAUTH`] | 그 순간 마스터 암호 재확인(마스터가 없으면 그대로 통과) |
//! | [`UNSUPPORTED`] | 거절 — 메인 PC 의 OS 창 · 편집기 · UAC 를 여는 것 · 창 모양 |
//! | [`ALLOW`] | 그대로 |
//!
//! - `save_settings` 는 [`ALLOW`] 이되 칸 단위 문이 있다([`settings_home_only`]). 원격 끄기는 된다 — 밖에서 급히 끊을 수 있게.
//! - 재확인은 잠금 풀린 기기를 남이 든 경우를 위한 확인이지, 같은 원격 창 안의 악성 코드(XSS)를 막는 경계가 아니다 — 원격 창은 셸을 칠 수
//!   있다(SSH 와 같은 등급). 암호는 HTTP 몸으로만 가고 ws 프레임에도 로그에도 없다.
//! - 일부러 [`ALLOW`] 에 둔 것(재확인 없음 — 좁히기만 하거나 다른 문이 이미 있다): `reject_operation` · `cancel_operation`(좁힘) ·
//!   `delegation_rename_target` · `delegation_remove_targets` · `db_ai_remove`(이름 변경 · 제거 팬아웃 — 중간에 암호를 물어 취소되면 호스트만
//!   지워지고 위임이 남는다) · `set_session_ai_read`(로컬 타일 "AI 읽기 허용" 의 영속 메아리 — 켜는 문은 화면의 토글이고 원격에서는 그 토글이
//!   재확인을 먼저 묻는다) · `agent_hooks_*`(셸로도 할 수 있는 일) · `vault_create`(볼트가 이미 있으면 거절 — 마스터를 바꾸지 못한다) ·
//!   `vault_verify_master`(확인만 · 서버 빈도 제한) · `test_auto_approval`(읽기 전용 판정) · 오케스트레이션의 좁힘 · 기록 · 읽기.
//! - 폴리필이 `null` 로 흉내 내는 명령은 [`UNSUPPORTED`] 여야 한다(시험 `polyfill_noops_are_unsupported`).
//!
//! ## 이벤트 문
//!
//! 원격 창은 ACL 로 `plugin:event|emit` · `emit_to` 가 열려 있다. 메인 PC 창의 리스너 몇은 받은 순간 메인 PC 전용 일을 하므로(`tray-quit` →
//! 앱 종료 · `workspace-request` → 세션 놓기 · `remote-pair-request` → 가짜 페어링 모달 …) 원격의 emit 은 이벤트 이름으로 거른다 — 기본 거절,
//! [`REMOTE_EMIT`] 만 허용(`bridge::admit_event`). 시험 `frontend_emits_are_classified` 가 프런트가 내는 이벤트가 모두 [`REMOTE_EMIT`] 이나
//! [`REMOTE_EMIT_DENIED`] 에 있는지 지킨다(새 이벤트가 원격에서 조용히 깨지거나 조용히 열리지 않게).

use crate::i18n::tr;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class {
    HomeOnly,
    Reauth,
    Unsupported,
    Allow,
    /// 분류 시험이 막지만, 시험 밖에서 새면 닫히는 쪽으로 거절한다.
    Unknown,
}

pub(crate) const HOME_ONLY: &[&str] = &[
    // 볼트 마스터 바꾸기·풀기(`new: None`)와 전체 삭제.
    "vault_set_master",
    "vault_delete_all",
    // [허용] 은 메인 PC 사람만 — 6자리 코드를 견주는 것이 사람이다.
    "remote_pair_respond",
    "remote_pair_pending",
    // 켜기 · 이름 바꾸기가 메인 PC 전용이라 같은 쪽.
    "remote_detect_host",
    // 메인 PC 에서 `tailscale serve` 를 실행해 tailnet 노출을 바꾼다. 판정 읽기도 같은 쪽(CLI 실행).
    "remote_serve_status",
    "remote_serve_connect",
    "remote_serve_off",
    // 원격이 다른 원격에 가짜 배치를 흘리지 못하게.
    "mirror_publish",
    // 원격이 관문 색을 바꾸지 못하게(원격 창은 이 기기 밝기 사본을 칠할 수 있다).
    "remote_gate_theme_set",
    // 원격이 남의 배치 요청을 가로채거나 가짜 답을 내지 못하게.
    "mirror_request_inbox",
    "mirror_respond",
    // 모든 세션 · 세션 서버 · 앱 끝내기 — 메인 PC 사람의 결정이다(원격의 `tray-quit` emit 이 막힌 것과 같은 판단).
    "app_end_all_sessions",
    "app_quit_gui",
    "app_hide_to_tray",
    // 원격 기기가 메인 PC 를 업데이트시키지 못한다(→ 전문 13).
    "update_state",
    "update_check",
    "update_download",
    "update_install",
    "update_skip",
    "update_mark_toasted",
    // 메인 PC 의 파일 대화상자로 고른 자리에 쓰고 읽으며, 가져오기는 AI 권한(위임)까지 바꾼다 — 메인 PC 사람이 미리 보기에서 확정한다.
    "settings_export_summary",
    "settings_export",
    "settings_import_preview",
    "settings_import_apply",
    // 봇 토큰 등록 · 해제, 짝짓기(6자리 코드를 견주는 것이 메인 PC 사람이다), 짝 지우기. 채널은 몸의 인자라 명령 이름으로 갈린다.
    "messenger_bot_set_token",
    "messenger_bot_pair",
    "messenger_bot_unpair",
    // 봇 토큰 · 짝을 지운다(토큰 해제와 같은 쪽). 웹훅만 넣는 `messenger_set_webhook` 은 ALLOW.
    "messenger_replace_bot_with_webhook",
];

/// 마스터가 없으면 그대로 통과.
pub(crate) const REAUTH: &[&str] = &[
    // 앨범 시작 · 구성 넓힘 — Run 은 사람의 `producer_album_start` 로만 열린다.
    "producer_album_start", "orchestration_album_widen",
    // 작업안 승인(승인 등급 프레임을 만드는 유일한 GUI 명령) · 검토 중 대상 고치기(넓힐 수 있다).
    "approve_operation",
    "modify_operation_targets",
    "delegation_set_target",
    "db_ai_set",
    // 검증 실행 확인(AI 가 바꿀 수 있는 코드를 메인 PC 에서 돌린다 — 작업안 승인과 같은 급) · 검증 실패 덮어쓰기(통합을 연다).
    "orchestration_approve_verify",
    "orchestration_override_verify",
    // 되돌릴 수 없다. 보관 · 복원 · 목록은 ALLOW.
    "orchestration_delete_archived",
    // 사람이 읽지 않은 앨범의 코드를 main 에 넣는다. 미리 보기는 ALLOW.
    "orchestration_merge",
    // 채팅 타일 Codex 목표 정하기 · 이어 하기 — CLI 가 새 사람 글 없이 턴을 이어 연다. 멈춤 · 지우기(`chat_tile_goal_stop`)는 ALLOW.
    "chat_tile_goal_start",
];

/// 원격에서 뜻이 없다 — 거절.
pub(crate) const UNSUPPORTED: &[&str] = &[
    "set_app_icon",
    // 아바타 넣기 · 지우기 · 이름 바꾸기 — 원격 미지원(사용자 결정). 목록 · 그림 읽기는 ALLOW.
    "app_icon_add",
    "app_icon_remove",
    "app_icon_rename",
    "take_tray_intent",
    "open_tear_window",
    "focus_window",
    "open_ssh_config",
    "edit_remote_file",
];

/// 명시 목록이다 — 새 명령은 넷 중 하나에 넣어야 시험이 지난다.
pub(crate) const ALLOW: &[&str] = &[
    "producer_fork_probe", "orchestration_album_defaults", "orchestration_album_set", "orchestration_rename_album",
    // 아바타 읽기 — 그림 바이트만(경로 없음).
    "app_icon_list", "app_icon_image",
    // 로컬 세션 · 세션 코어
    "list_shells", "open_local_session", "local_cwd", "write_session", "resize_session", "close_session",
    // PTY 크기만 바꾼다(셸에 쓰지 않음).
    "claim_session_size",
    "ack_local_output", "detach_session", "attach_session", "probe_session", "stash_checkpoint",
    // 다중 시청자 — 원격 창이 메인 PC 의 타일을 빼앗지 않고 함께 본다.
    "attach_session_viewer", "detach_session_viewer",
    // 읽기만.
    "mirror_get",
    // 메인 PC 주 창이 제 함수로 적용한다(종류는 `remote/mirror.rs` 의 허용 목록 · 빈도 · 크기 상한).
    "mirror_request",
    "restore_done_sessions", "detached_sessions", "close_detached_session", "set_session_ai_read",
    // 시스템 잠자기만 · 앱이 끝나면 풀린다.
    "keep_awake_status", "keep_awake_set",
    // 트레이 상태 · 세션 서버 · 진단 · 로그
    "tray_status", "session_server_status", "session_server_restart", "session_server_close_all", "session_stats",
    "session_log_path", "session_logs_dir",
    // SSH · 헤드리스 · 위임(읽기 · 팬아웃)
    "open_ssh_session", "session_info", "ssh_tmux_cwd", "ssh_tmux_list", "ssh_remote_home", "open_headless_session",
    // 원격 창은 그 셸에 `tmux kill-session` 을 칠 수 있다(같은 등급). 되돌릴 수 없는 원격 정리(sftp_remove 등)도 ALLOW 다.
    "ssh_tmux_kill",
    "close_headless_session", "delegation_list_targets", "db_ai_list", "db_ai_remove", "delegation_rename_target",
    "delegation_remove_targets", "forget_host_key",
    // 창 · 이관 · 워크스페이스
    "reap_window_sessions", "stash_handoff", "take_handoff", "peek_handoff", "workspace_bind_window",
    "workspace_window_binding", "workspace_windows", "workspace_exit_app", "reattach_output",
    // 포워딩 · SFTP
    "add_forward", "list_forwards", "remove_forward", "list_edits", "stop_edit", "upload_file", "sftp_home", "sftp_list",
    "sftp_stat", "sftp_free_space", "sftp_read_text", "sftp_read_preview", "sftp_write_text", "sftp_mkdir", "sftp_create_file", "sftp_rename",
    // `sftp_read_preview` 와 같은 등급(파일 하나를 바이트로 읽기만).
    "sftp_read_image",
    "sftp_remove", "sftp_download", "sftp_copy", "sftp_move", "sftp_remove_many", "sftp_conflicts", "sftp_upload_paths",
    "sftp_download_paths", "sftp_copy_between", "sftp_move_between", "local_to_sftp_move", "sftp_to_local_move",
    "transfer_cancel",
    // 로컬 파일
    "local_home", "local_roots", "local_places", "local_free_space", "local_list", "local_stat", "local_read_text",
    "local_read_preview", "local_read_image", "local_write_text", "list_text_files", "local_mkdir", "local_create_file", "local_rename", "local_remove", "local_copy",
    "local_move", "local_remove_many", "local_conflicts", "local_write_file", "stage_agent_attachment",
    "create_agent_attachment_dir", "write_text_file",
    // 로컬 목록 읽기와 같은 등급(바뀜 알림만).
    "local_watch_start", "local_watch_set", "local_watch_stop",
    // 호스트 · SSH 키
    "list_hosts", "add_host", "edit_host", "remove_host", "get_host_meta", "set_host_meta", "list_group_meta",
    "set_group_meta", "rename_group", "list_agent_public_keys", "agent_has_key", "install_public_key",
    "install_public_key_line", "generate_ssh_key", "list_ssh_key_files",
    // `save_settings` 는 칸 단위 문 — [`settings_home_only`]. `wallpaper_set_bytes` 는 `wallpaper_set` 과 같은 검사 · 같은 사본 이름 · 같은 GC 를 탄다.
    "load_settings", "save_settings", "set_language", "wallpaper_set", "wallpaper_set_bytes", "wallpaper_clear", "wallpaper_resolve",
    "wallpaper_gc", "wallpaper_random", "workspaces_load", "workspaces_claim_writer", "workspaces_apply",
    "workspaces_migrate", "workspaces_start_fresh", "workspaces_migration_status", "load_theme_profiles",
    "theme_profiles_edit",
    // 사용자 터미널 테마 — 설정 폴더의 모양 파일만 쓴다(21색 검증 · 경로 조작 없는 id). 원격 창의 터미널도 같은 테마로 그린다.
    "term_theme_list", "term_theme_add", "term_theme_rename", "term_theme_remove",
    // MCP 거울 · AI 에이전트
    "report_session", "update_session_context", "push_session_block", "push_session_blocks", "drop_session",
    "mcp_status", "mcp_activity", "mcp_tools", "mcp_calls", "list_console_sessions", "list_ai_clis", "codex_models", "take_mcp_notice", "agent_hooks_targets",
    "agent_hooks_status", "agent_hooks_install", "agent_hooks_remove", "agent_hooks_remote_status",
    "agent_hooks_remote_install", "agent_hooks_remote_remove", "agent_hooks_take_local_refresh",
    "agent_states_snapshot", "agent_state_forget", "agent_state_interrupt", "agent_state_seen", "agent_conversation_links", "agent_conversation_launched", "resource_snapshot", "agent_sessions_list", "agent_session_launch_spec", "agent_session_rename", "agent_session_delete",
    "agent_sessions_remote_list", "agent_session_remote_launch_spec", "agent_usage_remote_read",
    "agent_usage_remote_limits", "agent_conversation_transcript_remote", "agent_conversation_transcript",
    "agent_conversation_image", "agent_conversation_image_remote",
    "agent_usage_scan", "agent_usage_limits", "agent_usage_summary", "agent_autorun_command", "agent_args_targets",
    "agent_launch_preview", "agent_mcp_validate", "instructions_list", "instruction_save", "instruction_delete",
    "instructions_preview", "instructions_apply", "instructions_import_candidates", "instructions_apply_worktree",
    // 작업안 · 감사(승인 · 대상 고치기는 REAUTH)
    "list_operations", "operation_results", "reject_operation", "test_auto_approval", "cancel_operation",
    "set_reviewing_operations", "take_unseen_operation_results", "list_audit", "audit_runs", "audit_status",
    // 오케스트레이션(앨범 시작 · 넓힘 · 검증 확인 · 실패 덮어쓰기 · 병합 · 영구 삭제는 REAUTH)
    "orchestration_pause", "orchestration_resume", "orchestration_stop", "orchestration_snapshot", "orchestration_run",
    "orchestration_set_task_state", "orchestration_stop_worker",
    // 앨범 보관함 — 기록 · ref 는 그대로 · 권한을 주지 않는다.
    "orchestration_archive", "orchestration_archive_list", "orchestration_restore",
    "orchestration_wt_remove", "orchestration_review_task",
    "orchestration_report_drift", "orchestration_worker_activity", "orchestration_notices", "orchestration_notices_ack",
    "orchestration_same_dir_index", "orchestration_worker_transcript",
    // 프로듀서 채팅 — 사람의 말 · 결정 · 끊기 · 닫기 · 읽기(원격이 이미 하는 "타일에 치기" 등급). `decide` 는 허용 목록 두 카드에만 뜻이 있다.
    "producer_chat_open", "producer_chat_send", "producer_chat_interrupt", "producer_chat_set_model", "producer_chat_set_effort",
    "producer_chat_decide", "producer_chat_queue_cancel", "producer_chat_close", "producer_chat_attach", "producer_chat_status",
    "producer_chat_list",
    // 사건 본문은 그 연결의 창 통로에만.
    "producer_chat_subscribe", "producer_chat_unsubscribe",
    // 채팅 모양 AI 타일 — 사람의 말 · 권한 카드 결정 · CLI 권한 모드(재확인 없음) · 압축 · 되감기(미리 보기 뒤 확인) · 검토 · 목표 멈춤 · 지우기 · 속도 · MCP 상태 읽기 ·
    // 끊기 · 닫기 · 읽기. 원격이 이미 할 수 있는 "타일에 치기" 등급이다(칩은 TUI 의 Shift+Tab 과 같은 모드뿐 — bypass · 묻지 않기 · 전체 접근처럼 범위를 넓히는 값이 없다).
    "chat_tile_open", "chat_tile_send", "chat_tile_interrupt", "chat_tile_set_model", "chat_tile_set_effort", "chat_tile_set_perm_mode", "chat_tile_decide",
    "chat_tile_compact", "chat_tile_rewind", "chat_tile_close", "chat_tile_attach", "chat_tile_list", "chat_tile_subscribe", "chat_tile_unsubscribe",
    "chat_tile_review", "chat_tile_goal_stop", "chat_tile_set_tier", "chat_tile_mcp_status",
    // 사이드 채팅 — 사람의 말 · 권한 결정(`side_chat_decide` · 권한 모드 · 허용 목록 포함, 재확인 없음) · 끊기 · 닫기 · 읽기는 원격이 이미 할 수 있는
    // "셸에 치기" 등급이다(docs/log/2026-11-01-remote-side-chat.md). 사건 본문은 그 채팅을 보는 창의 통로에만 간다.
    "side_chats_load", "side_chats_save", "side_chat_dir", "side_chat_remove",
    "side_chat_instructions_load", "side_chat_instructions_save",
    "side_chat_open", "side_chat_send", "side_chat_interrupt", "side_chat_set_model", "side_chat_set_effort", "side_chat_decide",
    "side_chat_close", "side_chat_attach", "side_chat_list", "side_chat_subscribe", "side_chat_link",
    // 표시 전용 · 몸은 id · 번호뿐.
    "side_chat_seen",
    "side_chat_set_perm_mode", "side_chat_forget_allow",
    // 타일 권한 카드 — 사이드 채팅 권한 카드와 같은 등급(재확인 없음). 서버가 그 창이 그 세션을 보는지 다시 본다.
    "tile_permission_decide", "tile_permission_snapshot", "tile_permission_subscribe", "tile_permission_analyze", "tile_permission_face",
    // 오케스트레이션 통합 · 검토 · 정리 — 권한을 새로 주지 않는다.
    "orchestration_report_files",
    "orchestration_cancel_integration", "orchestration_release_hold", "orchestration_reconcile_preview",
    "orchestration_reconcile", "orchestration_export", "orchestration_merge_preview", "orchestration_complete_run", "orchestration_cleanup_preview",
    "orchestration_cleanup", "orchestration_discard_temp",
    // 아티스트 프로필에는 권한이 없다 — 편집도 ALLOW.
    "orchestration_artist_list", "orchestration_artist_set", "orchestration_artist_remove",
    // 접속 이력 · 프로젝트 · 소스 컨트롤
    "host_history_list", "host_history_clear", "host_history_forget", "host_history_rename", "projects_list",
    "project_upsert", "project_remove", "project_rename_host", "projects_forget_host", "git_worktree_list",
    "git_worktree_changes", "ssh_git_worktree_changes", "git_commit_graph", "ssh_git_commit_graph", "git_commit_files",
    "ssh_git_commit_files", "git_worktree_wip_files", "ssh_git_worktree_wip_files", "git_diff_files",
    "ssh_git_diff_files", "git_diff_file", "ssh_git_diff_file", "git_change_snapshot", "git_worktree_add",
    "git_worktree_remove", "ssh_git_worktree_list", "ssh_worktree_answer", "ssh_git_worktree_remove",
    "git_worktree_branch_choices", "git_worktree_add_preview", "git_branch_delete", "ssh_git_worktree_branch_choices",
    "ssh_git_worktree_add_preview", "ssh_git_branch_delete", "project_setup_line", "worktree_setup_record",
    "worktree_setup_count", "git_repo_status", "git_repo_init", "git_project_create", "ssh_git_repo_status",
    "ssh_git_repo_init", "ssh_git_project_create", "git_head", "ssh_git_head",
    // 탭 템플릿 — 사람이 적어 둔 앱 소유 목록(비밀 없음 · 읽어서 실행하지 않음).
    "load_tab_templates", "save_tab_templates",
    // 볼트 — 값을 돌려주는 명령은 없다. `vault_verify_master` 는 확인만(상태를 바꾸지 않는다 · 서버 빈도 제한).
    "load_snippets", "save_snippets", "vault_status", "vault_create", "vault_unlock", "vault_lock", "vault_verify_master", "vault_list",
    "vault_delete", "vault_store_password", "vault_store_mcp_env", "vault_store_passphrase", "vault_has_password",
    "vault_has_passphrase", "vault_store_db_password", "vault_has_db_password",
    // `db_test` 는 `db_open` 과 같은 결 — 폼 값으로 한 번 붙어 보고 닫는다.
    "db_open", "db_test", "db_query", "db_cancel", "db_schema", "db_objects", "db_table_detail", "db_definition", "db_set_write",
    "db_close", "db_tx", "db_script", "db_conn_list", "db_conn_save", "db_folders_load", "db_folders_save", "db_history_list",
    // 메신저
    "messenger_status", "messenger_set_webhook", "messenger_test", "messenger_send",
    // 상태(토큰 없음) · 짝지은 대화방에 시험 한 통.
    "messenger_bot_status", "messenger_bot_test",
    // 표시 글자를 서버 메모리에 적기만 한다(보내기 · 넣기 · 권한 없음).
    "messenger_bot_label",
    // 원격 관문 — 기기 폐기(자기 기기 포함 — 밖에서 급히 끊는다) · 모두 끊기는 좁히기다.
    "remote_status", "remote_devices_list", "remote_device_revoke", "remote_log", "remote_device_rename",
    "remote_disconnect_all",
];

/// 원격 창이 낼 수 있는 이벤트(머리말 "이벤트 문") — 받는 쪽이 파일을 다시 읽거나 그 창 메모리의 이름 · 모양만 맞춘다(원격이 같은 명령으로
/// 이미 할 수 있는 일의 메아리). `settings-saved` 는 짐의 값을 믿지 않고 파일을 다시 읽는다.
pub(crate) const REMOTE_EMIT: &[&str] = &["settings-saved", "host-renamed", "workspace-renamed", "workspace-style-changed"];

/// 프런트가 내지만 원격 창에서는 거절하는 이벤트 — 분류 시험의 짝(이름 끝이 `-` 면 접두). 원격 창은 창 사이 요청에 끼지 않는다.
/// `veil-lifted` 를 내면 메인 PC 가림막을 걷으려 들고, `user-active` 를 내면 메인 PC 의 무입력 잠금을 미룬다.
#[cfg_attr(not(test), allow(dead_code))] // 시험(`frontend_emits_are_classified`)과 사람이 읽는 표 — 문은 기본 거절이라 런타임에 안 본다
pub(crate) const REMOTE_EMIT_DENIED: &[&str] = &[
    "workspace-status",
    "workspace-status-request",
    "workspace-request",
    "workspace-reply-",
    "veil-raised",
    "veil-lifted",
    "user-active",
];

pub(crate) fn emit_allowed(event: &str) -> bool {
    REMOTE_EMIT.contains(&event)
}

pub(crate) fn emit_message(event: &str) -> String {
    tr!(
        ko: "원격 창이 낼 수 없는 이벤트입니다 — {event}",
        en: "The remote client cannot emit this event — {event}",
        event = event
    )
}

/// 거절 문구에 쓰는 사람 말 이름. 표에 없으면 명령 이름 그대로.
pub(crate) fn command_label(cmd: &str) -> String {
    match cmd {
        "vault_set_master" => tr!(ko: "볼트 마스터 암호 바꾸기·풀기", en: "changing or removing the vault master password"),
        "vault_delete_all" => tr!(ko: "볼트 항목 모두 삭제", en: "deleting every vault item"),
        "remote_pair_respond" => tr!(ko: "원격 기기 페어링 허용·거절", en: "allowing or denying a remote device pairing"),
        "remote_pair_pending" => tr!(ko: "원격 페어링 요청 보기", en: "viewing remote pairing requests"),
        "remote_detect_host" => tr!(ko: "이 PC 의 MagicDNS 이름 찾기", en: "detecting this PC's MagicDNS name"),
        "remote_serve_status" => tr!(ko: "tailscale serve 상태 보기", en: "viewing the tailscale serve status"),
        "remote_serve_connect" => tr!(ko: "Tailscale 연결", en: "connecting Tailscale"),
        "remote_serve_off" => tr!(ko: "tailscale serve 끄기", en: "turning off tailscale serve"),
        "mirror_publish" => tr!(ko: "메인 PC 화면 배치 알리기", en: "publishing the main PC layout"),
        "remote_gate_theme_set" => tr!(ko: "원격 관문 색 맞추기", en: "setting the remote gate colors"),
        "mirror_request_inbox" => tr!(ko: "원격 배치 요청 받기", en: "receiving remote layout requests"),
        "mirror_respond" => tr!(ko: "원격 배치 요청에 답하기", en: "answering remote layout requests"),
        "app_end_all_sessions" => tr!(ko: "모든 세션 종료", en: "ending all sessions"),
        "app_quit_gui" => tr!(ko: "GUI 종료", en: "quitting the GUI"),
        "app_hide_to_tray" => tr!(ko: "트레이로 숨기기", en: "hiding to the tray"),
        "update_state" | "update_check" | "update_download" | "update_install" | "update_skip" | "update_mark_toasted" => {
            tr!(ko: "Aynx 업데이트", en: "updating Aynx")
        }
        "settings_export_summary" | "settings_export" => tr!(ko: "설정 내보내기", en: "exporting settings"),
        "settings_import_preview" | "settings_import_apply" => tr!(ko: "설정 가져오기", en: "importing settings"),
        "messenger_bot_set_token" => tr!(ko: "메신저 봇 토큰 등록 · 해제", en: "registering or removing a messenger bot token"),
        "messenger_bot_pair" => tr!(ko: "메신저 연결 요청 허용 · 거절", en: "allowing or denying a messenger pairing"),
        "messenger_bot_unpair" => tr!(ko: "메신저 연결 끊기", en: "unpairing a messenger"),
        "messenger_replace_bot_with_webhook" => tr!(ko: "메신저 봇을 웹훅으로 바꾸기", en: "switching a messenger bot to a webhook"),
        "side_chats_load" => tr!(ko: "사이드 채팅 목록 읽기", en: "reading the side chats"),
        "side_chats_save" => tr!(ko: "사이드 채팅 목록 저장", en: "saving the side chats"),
        "side_chat_dir" => tr!(ko: "사이드 채팅 폴더 만들기", en: "creating a side chat folder"),
        "side_chat_remove" => tr!(ko: "사이드 채팅 지우기", en: "deleting a side chat"),
        "side_chat_open" => tr!(ko: "사이드 채팅 열기", en: "opening a side chat"),
        "side_chat_send" => tr!(ko: "사이드 채팅 보내기", en: "sending a side chat message"),
        "side_chat_interrupt" => tr!(ko: "사이드 채팅 답 끊기", en: "interrupting a side chat reply"),
        "side_chat_set_model" => tr!(ko: "사이드 채팅 모델 바꾸기", en: "changing a side chat's model"),
        "side_chat_set_effort" => tr!(ko: "사이드 채팅 추론 강도 바꾸기", en: "changing a side chat's reasoning effort"),
        "side_chat_decide" => tr!(ko: "사이드 채팅 권한 요청에 답하기", en: "answering a side chat permission request"),
        "side_chat_close" => tr!(ko: "사이드 채팅 닫기", en: "closing a side chat"),
        "side_chat_attach" => tr!(ko: "사이드 채팅 다시 붙기", en: "reattaching a side chat"),
        "side_chat_list" => tr!(ko: "사이드 채팅 프로세스 보기", en: "viewing side chat processes"),
        "side_chat_subscribe" => tr!(ko: "사이드 채팅 사건 받기", en: "receiving side chat events"),
        "side_chat_link" => tr!(ko: "사이드 채팅에 타일 연결", en: "linking a tile to a side chat"),
        "side_chat_seen" => tr!(ko: "사이드 채팅 완료 확인 알리기", en: "sharing that a side chat reply was seen"),
        "side_chat_set_perm_mode" => tr!(ko: "사이드 채팅 권한 모드 바꾸기", en: "changing a side chat's permission mode"),
        "side_chat_forget_allow" => tr!(ko: "사이드 채팅 허용 목록에서 빼기", en: "removing an item from a side chat's allow list"),
        "set_app_icon" => tr!(ko: "앱 아이콘 바꾸기", en: "changing the app icon"),
        "app_icon_add" => tr!(ko: "아바타 넣기", en: "adding an avatar"),
        "app_icon_remove" => tr!(ko: "아바타 지우기", en: "removing an avatar"),
        "app_icon_rename" => tr!(ko: "아바타 이름 바꾸기", en: "renaming an avatar"),
        "take_tray_intent" => tr!(ko: "트레이 메뉴", en: "the tray menu"),
        "open_tear_window" => tr!(ko: "타일을 새 창으로 떼어 내기", en: "tearing a tile out into a new window"),
        "focus_window" => tr!(ko: "메인 PC 창으로 옮기기", en: "focusing a main PC window"),
        "open_ssh_config" => tr!(ko: "SSH 설정 파일을 메인 PC 편집기로 열기", en: "opening the SSH config in a main PC editor"),
        "edit_remote_file" => tr!(ko: "원격 파일을 메인 PC 편집기로 열기", en: "opening a remote file in a main PC editor"),
        // 재확인 — 앱 모달 `remote-dialog.ts` 의 이름과 같은 말.
        "approve_operation" => tr!(ko: "작업안 승인", en: "approving a task plan"),
        "producer_album_start" => tr!(ko: "앨범 시작하기", en: "starting an album"),
        "orchestration_album_widen" => tr!(ko: "앨범 권한 넓히기", en: "widening album permissions"),
        "modify_operation_targets" => tr!(ko: "작업안 대상 고치기", en: "changing a task plan's targets"),
        "delegation_set_target" => tr!(ko: "호스트의 AI 권한 바꾸기", en: "changing a host's AI permission"),
        "db_ai_set" => tr!(ko: "DB 연결의 AI 권한 바꾸기", en: "changing a DB connection's AI permission"),
        "orchestration_approve_verify" => tr!(ko: "오케스트레이션 검증 실행", en: "running an orchestration verification"),
        "orchestration_override_verify" => tr!(ko: "오케스트레이션 검증 실패 덮어쓰기", en: "overriding a failed orchestration verification"),
        "orchestration_delete_archived" => tr!(ko: "보관한 앨범 영구 삭제", en: "deleting an archived album forever"),
        "orchestration_merge" => tr!(ko: "앨범을 브랜치에 병합", en: "merging an album into a branch"),
        "chat_tile_goal_start" => tr!(ko: "채팅 타일 목표 정하기 · 이어 하기", en: "setting or resuming a chat tile goal"),
        other => other.to_string(),
    }
}

pub(crate) const SAVE_SETTINGS: &str = "save_settings";

/// `plugin:*` 는 여기서 가르지 않는다(ACL).
pub(crate) fn class_of(cmd: &str) -> Class {
    let has = |t: &[&str]| t.contains(&cmd);
    if has(HOME_ONLY) {
        Class::HomeOnly
    } else if has(REAUTH) {
        Class::Reauth
    } else if has(UNSUPPORTED) {
        Class::Unsupported
    } else if has(ALLOW) {
        Class::Allow
    } else {
        Class::Unknown
    }
}

pub(crate) fn home_only_message(what: &str) -> String {
    tr!(ko: "메인 PC 에서만 할 수 있습니다 — {what}", en: "Only on the main PC — {what}", what = what)
}

pub(crate) fn unsupported_message(cmd: &str) -> String {
    tr!(
        ko: "원격에서는 할 수 없습니다 — {what}",
        en: "Not available in the remote client — {what}",
        what = command_label(cmd)
    )
}

pub(crate) fn unknown_message(cmd: &str) -> String {
    tr!(
        ko: "원격 창에 열리지 않은 기능입니다 ({cmd})",
        en: "This feature is not open to the remote client ({cmd})",
        cmd = cmd
    )
}

pub(crate) fn reauth_message() -> String {
    tr!(
        ko: "마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요",
        en: "The master password must be confirmed again — try again"
    )
}

/// 메인 PC 전용 칸이 바뀌었으면 그 문구(`current` · `next` 둘 다 정리 뒤).
/// - `[automation]` — 알림 두 칸(`notify_review_requests` · `notify_operation_results`)만 원격에서 바꿀 수 있다.
/// - `[remote]` — 켜기와 이름 · 포트 바꾸기. 끄기는 된다.
/// - `[messenger] telegram_chat` · `discord_chat` · `slack_chat` — 켜기만. 끄기는 된다.
pub(crate) fn settings_home_only(current: &AppSettings, next: &AppSettings, dev: bool) -> Option<String> {
    let mut policy = next.automation.clone();
    policy.notify_review_requests = current.automation.notify_review_requests;
    policy.notify_operation_results = current.automation.notify_operation_results;
    if policy != current.automation {
        return Some(home_only_message(&tr!(
            ko: "자동 승인 정책([automation])은 원격에서 바꿀 수 없습니다",
            en: "the auto-approval policy ([automation]) cannot be changed remotely"
        )));
    }
    let (cur, new) = (
        super::Config::from_prefs(&current.remote, dev),
        super::Config::from_prefs(&next.remote, dev),
    );
    if new.enabled && !cur.enabled {
        return Some(home_only_message(&tr!(
            ko: "원격 접속 켜기",
            en: "turning remote access on"
        )));
    }
    if new.host != cur.host || new.port != cur.port {
        return Some(home_only_message(&tr!(
            ko: "원격 접속의 이름·포트 바꾸기",
            en: "changing the remote access host or port"
        )));
    }
    // 안 정함 = 끔.
    let turned_on = |next: Option<bool>, cur: Option<bool>| next == Some(true) && cur != Some(true);
    if turned_on(next.messenger.telegram_chat, current.messenger.telegram_chat)
        || turned_on(next.messenger.discord_chat, current.messenger.discord_chat)
        || turned_on(next.messenger.slack_chat, current.messenger.slack_chat)
    {
        return Some(home_only_message(&tr!(
            ko: "메신저에서 AI 타일에 말하기 켜기",
            en: "turning on messaging AI tiles from the messenger"
        )));
    }
    None
}

/// 소문자 · 숫자 · `_` 64자까지.
pub(crate) fn command_shape(cmd: &str) -> bool {
    !cmd.is_empty() && cmd.len() <= 64 && cmd.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// `lib.rs` 의 `generate_handler![…]` 안의 명령 이름(경로 끝 조각) — 주석 줄은 건너뛴다.
    fn registered() -> Vec<String> {
        let lib = include_str!("../lib.rs");
        let start = lib.find("generate_handler![").expect("generate_handler! 가 없다") + "generate_handler![".len();
        let end = start + lib[start..].find("])").expect("generate_handler! 끝이 없다");
        lib[start..end]
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with("//"))
            .flat_map(|l| l.split(','))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.rsplit("::").next().unwrap_or(s).to_string())
            .collect()
    }

    #[test]
    fn artist_commands_are_allowed() {
        for command in ["orchestration_artist_list", "orchestration_artist_set", "orchestration_artist_remove"] {
            assert_eq!(class_of(command), Class::Allow, "{command}");
            assert!(registered().iter().any(|name| name == command), "{command}");
        }
    }

    #[test]
    fn every_command_is_classified_once() {
        let names = registered();
        assert!(names.len() > 250, "명령을 못 읽었다: {}", names.len());
        let tables: [(&str, &[&str]); 4] =
            [("HOME_ONLY", HOME_ONLY), ("REAUTH", REAUTH), ("UNSUPPORTED", UNSUPPORTED), ("ALLOW", ALLOW)];
        let mut seen: HashSet<&str> = HashSet::new();
        for (table, list) in tables {
            for name in list {
                assert!(seen.insert(name), "{name} 이 두 번 분류됐다({table})");
            }
        }
        let registered: HashSet<&str> = names.iter().map(String::as_str).collect();
        let unclassified: Vec<&&str> = registered.iter().filter(|n| !seen.contains(**n)).collect();
        assert!(unclassified.is_empty(), "원격 분류가 없는 새 명령 — remote/deny.rs 의 표 넷 중 하나에: {unclassified:?}");
        let unknown: Vec<&&str> = seen.iter().filter(|n| !registered.contains(**n)).collect();
        assert!(unknown.is_empty(), "등록되지 않은 이름이 표에 있다: {unknown:?}");
        assert_eq!(seen.len(), names.len(), "generate_handler! 에 같은 이름이 둘");
    }

    #[test]
    fn decisions_stay_where_the_user_put_them() {
        assert_eq!(class_of("producer_album_start"), Class::Reauth);
        assert_eq!(class_of("orchestration_album_widen"), Class::Reauth);
        // 되돌릴 수 없는 영구 삭제만 재확인.
        assert_eq!(class_of("orchestration_delete_archived"), Class::Reauth);
        // 실행만 재확인 · 미리 보기는 읽기.
        assert_eq!(class_of("orchestration_merge"), Class::Reauth);
        assert_ne!(command_label("orchestration_merge"), "orchestration_merge");
        assert_eq!(class_of("orchestration_merge_preview"), Class::Allow);
        for command in ["orchestration_archive", "orchestration_archive_list", "orchestration_restore"] {
            assert_eq!(class_of(command), Class::Allow, "{command}");
        }
        assert_eq!(class_of("orchestration_close_orphaned"), Class::Unknown);
        assert_eq!(class_of("producer_album_start_basic"), Class::Unknown);
        assert_ne!(command_label("orchestration_album_widen"), "orchestration_album_widen");
        // 원격 창은 찾기 · 받기 · 설치 · 건너뛰기 어느 것도 못 한다.
        for command in ["update_state", "update_check", "update_download", "update_install", "update_skip", "update_mark_toasted"] {
            assert_eq!(class_of(command), Class::HomeOnly, "{command}");
            assert_ne!(command_label(command), command);
        }
        // Tailscale 연결 — tailnet 노출을 바꾸는 CLI 실행이라 원격 창에서는 셋 다 거절.
        for command in ["remote_serve_status", "remote_serve_connect", "remote_serve_off"] {
            assert_eq!(class_of(command), Class::HomeOnly, "{command}");
            assert_ne!(command_label(command), command);
        }
        for command in ["producer_fork_probe", "orchestration_album_defaults", "orchestration_album_set", "orchestration_rename_album"] {
            assert_eq!(class_of(command), Class::Allow);
        }
        assert_ne!(command_label("producer_album_start"), "producer_album_start");
        for c in [
            "vault_set_master", "vault_delete_all", "remote_pair_respond", "remote_pair_pending", "mirror_publish",
            "mirror_request_inbox", "mirror_respond",
        ] {
            assert_eq!(class_of(c), Class::HomeOnly, "{c}");
        }
        // 사이드 채팅은 전부 ALLOW(`side_chat_decide` 도 재확인 없음).
        for c in [
            "side_chats_load", "side_chats_save", "side_chat_dir", "side_chat_remove",
            "side_chat_instructions_load", "side_chat_instructions_save",
            "side_chat_open", "side_chat_send", "side_chat_interrupt", "side_chat_set_model", "side_chat_set_effort",
            "side_chat_decide", "side_chat_close", "side_chat_attach", "side_chat_list", "side_chat_subscribe", "side_chat_link",
            "side_chat_seen", "side_chat_set_perm_mode", "side_chat_forget_allow",
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 타일 권한 카드 — 사이드 채팅 권한 카드와 같은 등급.
        for c in ["tile_permission_decide", "tile_permission_snapshot", "tile_permission_subscribe", "tile_permission_analyze", "tile_permission_face"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 배치 거울 — 원격은 받기만 · 배치 바꾸기는 요청으로(재확인 없음).
        assert_eq!(class_of("mirror_get"), Class::Allow);
        assert_eq!(class_of("mirror_request"), Class::Allow);
        for c in [
            "approve_operation", "delegation_set_target", "db_ai_set",
        ] {
            assert_eq!(class_of(c), Class::Reauth, "{c}");
        }
        for c in [
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 프로듀서 채팅 명령은 전부 ALLOW.
        for c in [
            "producer_chat_open", "producer_chat_send", "producer_chat_interrupt", "producer_chat_set_model", "producer_chat_set_effort",
            "producer_chat_decide", "producer_chat_queue_cancel", "producer_chat_close", "producer_chat_attach", "producer_chat_status",
            "producer_chat_list", "producer_chat_subscribe", "producer_chat_unsubscribe",
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 채팅 타일 명령은 목표 정하기 · 이어 하기 밖은 ALLOW(권한 카드 `chat_tile_decide` · 권한 모드 칩 · 압축 · 되감기 · 검토 · 목표 멈춤 · 지우기 ·
        // 속도 · MCP 상태도 재확인 없음). 스스로 도는 일을 거는 목표 시작만 재확인.
        for c in [
            "chat_tile_open", "chat_tile_send", "chat_tile_interrupt", "chat_tile_set_model", "chat_tile_set_effort", "chat_tile_set_perm_mode",
            "chat_tile_decide", "chat_tile_compact", "chat_tile_rewind",
            "chat_tile_close", "chat_tile_attach", "chat_tile_list", "chat_tile_subscribe", "chat_tile_unsubscribe",
            "chat_tile_review", "chat_tile_goal_stop", "chat_tile_set_tier", "chat_tile_mcp_status",
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        assert_eq!(class_of("chat_tile_goal_start"), Class::Reauth);
        assert_ne!(command_label("chat_tile_goal_start"), "chat_tile_goal_start");
        assert_eq!(class_of("chat_tile_goal"), Class::Unknown, "목표 명령은 시작 · 멈춤 둘로만");
        // 원격에서도 허용하는 예외 · 거절 · 취소는 좁히기.
        for c in ["remote_device_revoke", "remote_status", "save_settings", "reject_operation", "cancel_operation", "vault_store_password"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 아바타 — 읽기만 원격 허용.
        for c in ["app_icon_list", "app_icon_image"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        for c in ["app_icon_add", "app_icon_remove", "app_icon_rename", "set_app_icon"] {
            assert_eq!(class_of(c), Class::Unsupported, "{c}");
        }
        // tmux 세션 끄기 — 원격 창이 그 셸에서 칠 수 있는 일과 같은 등급.
        assert_eq!(class_of("ssh_tmux_kill"), Class::Allow);
        for (image, preview) in [("local_read_image", "local_read_preview"), ("sftp_read_image", "sftp_read_preview")] {
            assert_eq!(class_of(image), class_of(preview), "{image}");
        }
        // 배경 그림 올리기 — `wallpaper_set` 과 같은 등급.
        assert_eq!(class_of("wallpaper_set_bytes"), class_of("wallpaper_set"));
        assert_eq!(class_of("open_ssh_config"), Class::Unsupported);
        assert_eq!(class_of("no_such_command"), Class::Unknown);
        assert_eq!(class_of("plugin:dialog|open"), Class::Unknown);
    }

    #[test]
    fn polyfill_noops_are_unsupported() {
        let js = include_str!("polyfill.js");
        let start = js.find("const NOOP = new Set([").expect("NOOP 표") + "const NOOP = new Set([".len();
        let end = start + js[start..].find("])").expect("NOOP 끝");
        let names: Vec<&str> = js[start..end]
            .split(',')
            .map(|s| s.trim().trim_matches('"'))
            .filter(|s| !s.is_empty())
            .collect();
        assert!(!names.is_empty());
        for n in names {
            assert_eq!(class_of(n), Class::Unsupported, "폴리필이 흉내 내는 {n} 은 UNSUPPORTED 여야 한다");
        }
    }

    fn settings() -> AppSettings {
        let mut s = AppSettings::default();
        s.remote.enabled = Some(true);
        s.remote.host = Some("mypc.tailnet-abcd.ts.net".into());
        s
    }

    /// 원격은 켜지 못하고 끄기 · 그대로 두기는 된다.
    #[test]
    fn save_settings_guard_telegram_chat() {
        let cur = settings();
        let mut on = cur.clone();
        on.messenger.telegram_chat = Some(true);
        assert!(settings_home_only(&cur, &on, false).is_some(), "안 정함 → 켬");
        let mut off = cur.clone();
        off.messenger.telegram_chat = Some(false);
        assert!(settings_home_only(&off, &on, false).is_some(), "끔 → 켬");
        assert_eq!(settings_home_only(&on, &off, false), None, "켬 → 끔");
        assert_eq!(settings_home_only(&on, &cur, false), None, "켬 → 안 정함");
        assert_eq!(settings_home_only(&on, &on, false), None, "켬 그대로");
        // 보내기 칸(`telegram`)은 다른 채널 칸처럼 원격에서도 된다.
        let mut send = cur.clone();
        send.messenger.telegram = Some(false);
        assert_eq!(settings_home_only(&cur, &send, false), None);
    }

    /// `discord_chat` 도 같은 문 · Telegram 칸과 따로 잰다.
    #[test]
    fn save_settings_guard_discord_chat() {
        let cur = settings();
        let mut on = cur.clone();
        on.messenger.discord_chat = Some(true);
        assert!(settings_home_only(&cur, &on, false).is_some(), "안 정함 → 켬");
        let mut off = cur.clone();
        off.messenger.discord_chat = Some(false);
        assert!(settings_home_only(&off, &on, false).is_some(), "끔 → 켬");
        assert_eq!(settings_home_only(&on, &off, false), None, "켬 → 끔");
        assert_eq!(settings_home_only(&on, &cur, false), None, "켬 → 안 정함");
        assert_eq!(settings_home_only(&on, &on, false), None, "켬 그대로");
        // Telegram 이 켜져 있어도 Discord 를 원격에서 켜지는 못한다
        let mut tg = cur.clone();
        tg.messenger.telegram_chat = Some(true);
        let mut both = tg.clone();
        both.messenger.discord_chat = Some(true);
        assert!(settings_home_only(&tg, &both, false).is_some());
        let mut send = cur.clone();
        send.messenger.discord = Some(false);
        assert_eq!(settings_home_only(&cur, &send, false), None, "보내기 칸은 된다");
    }

    /// `slack_chat` 도 같은 문 · 다른 채널 칸과 따로 잰다.
    #[test]
    fn save_settings_guard_slack_chat() {
        let cur = settings();
        let mut on = cur.clone();
        on.messenger.slack_chat = Some(true);
        assert!(settings_home_only(&cur, &on, false).is_some(), "안 정함 → 켬");
        let mut off = cur.clone();
        off.messenger.slack_chat = Some(false);
        assert!(settings_home_only(&off, &on, false).is_some(), "끔 → 켬");
        assert_eq!(settings_home_only(&on, &off, false), None, "켬 → 끔");
        assert_eq!(settings_home_only(&on, &cur, false), None, "켬 → 안 정함");
        // Telegram · Discord 가 켜져 있어도 Slack 을 원격에서 켜지는 못한다
        let mut others = cur.clone();
        others.messenger.telegram_chat = Some(true);
        others.messenger.discord_chat = Some(true);
        let mut all = others.clone();
        all.messenger.slack_chat = Some(true);
        assert!(settings_home_only(&others, &all, false).is_some());
        let mut send = cur.clone();
        send.messenger.slack = Some(false);
        assert_eq!(settings_home_only(&cur, &send, false), None, "보내기 칸은 된다");
    }

    /// 봇 명령의 문은 명령 이름으로만 갈린다(채널은 몸의 인자).
    #[test]
    fn bot_commands_are_gated_by_name_for_every_channel() {
        for c in ["messenger_bot_set_token", "messenger_bot_pair", "messenger_bot_unpair", "messenger_replace_bot_with_webhook"] {
            assert_eq!(class_of(c), Class::HomeOnly, "{c}");
            let label = command_label(c);
            assert!(!label.contains("Telegram") && !label.contains("Discord") && !label.contains("Slack"), "채널 중립 문구: {label}");
        }
        for c in ["messenger_bot_status", "messenger_bot_test", "messenger_bot_label", "messenger_status", "messenger_set_webhook", "messenger_test"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
    }

    #[test]
    fn save_settings_guard() {
        let cur = settings();
        let mut next = cur.clone();
        next.terminal.font_size = Some(15);
        assert_eq!(settings_home_only(&cur, &next, false), None);
        let mut next = cur.clone();
        next.automation.notify_review_requests = !cur.automation.notify_review_requests;
        next.automation.notify_operation_results = !cur.automation.notify_operation_results;
        assert_eq!(settings_home_only(&cur, &next, false), None);
        let changes: [fn(&mut AppSettings); 6] = [
            |n: &mut AppSettings| n.automation.auto_approve = true,
            |n: &mut AppSettings| n.automation.allow_pipes = true,
            |n: &mut AppSettings| n.automation.allow_patterns.push("df".into()),
            |n: &mut AppSettings| n.automation.bundles.push("system".into()),
            |n: &mut AppSettings| n.automation.max_targets += 1,
            |n: &mut AppSettings| n.automation.approval_ttl_minutes = 0,
        ];
        for change in changes {
            let mut next = cur.clone();
            change(&mut next);
            assert!(settings_home_only(&cur, &next, false).is_some());
        }
        let mut off = cur.clone();
        off.remote.enabled = Some(false);
        assert_eq!(settings_home_only(&cur, &off, false), None);
        assert!(settings_home_only(&off, &cur, false).is_some(), "끔 → 켬");
        let mut host = cur.clone();
        host.remote.host = Some("other.tailnet-abcd.ts.net".into());
        assert!(settings_home_only(&cur, &host, false).is_some());
        let mut port = cur.clone();
        port.remote.port = Some(40000);
        assert!(settings_home_only(&cur, &port, false).is_some());
        // 기본 포트를 적어 넣은 것은 바꾼 것이 아니다.
        let mut same = cur.clone();
        same.remote.port = Some(crate::instance::remote_port(false));
        assert_eq!(settings_home_only(&cur, &same, false), None);
        // 꺼진 채로 이름을 바꾸는 것도 메인 PC 에서만.
        let mut off_host = off.clone();
        off_host.remote.host = None;
        assert!(settings_home_only(&off, &off_host, false).is_some());
    }

    #[test]
    fn rejections_speak_plainly() {
        for c in HOME_ONLY.iter().chain(UNSUPPORTED).chain(REAUTH) {
            assert_ne!(command_label(c), *c, "{c} 의 사람 말 이름이 없다");
        }
    }

    #[test]
    fn remote_emit_is_default_deny() {
        for e in REMOTE_EMIT {
            assert!(emit_allowed(e));
        }
        for e in ["tray-quit", "tray-intent", "workspace-request", "remote-pair-request", "remote-pair-closed",
            "remote-sessions", "session-server-connected", "agent-signal", "operation-state", "workspace-quitting", ""]
        {
            assert!(!emit_allowed(e), "{e}");
        }
        for e in REMOTE_EMIT_DENIED {
            assert!(!REMOTE_EMIT.contains(e), "{e} 가 두 표에 있다");
        }
    }

    /// `src/` 의 `emit(…)` · `emitTo(…)` 가 내는 이벤트 이름 — 글자 그대로 · 같은 소스의 상수 · `"접두-" + id` 셋을 읽는다. 읽지 못한 인자는
    /// `?<인자>` 로 돌려준다(시험이 실패하게).
    fn frontend_emits() -> Vec<(String, String)> {
        use regex::Regex;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
        let mut files = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).expect("src 를 못 읽었다").flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().is_some_and(|n| n != "test") {
                        stack.push(p);
                    }
                } else if p.extension().is_some_and(|x| x == "ts" || x == "svelte" || x == "js")
                    && !p.to_string_lossy().ends_with(".test.ts")
                {
                    files.push((p.clone(), std::fs::read_to_string(&p).unwrap_or_default()));
                }
            }
        }
        let consts = Regex::new(r#"const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)""#).unwrap();
        let mut names = std::collections::HashMap::new();
        for (_, text) in &files {
            for c in consts.captures_iter(text) {
                names.insert(c[1].to_string(), c[2].to_string());
            }
        }
        let imports = Regex::new(r#"import\s*\{([^}]*)\}\s*from\s*"(?:\$lib/ipc|\.\./ipc|\./ipc|\.\./\.\./ipc)""#).unwrap();
        let emit = Regex::new(r#"\bemit\(\s*([^,)]+)"#).unwrap();
        let emit_to = Regex::new(r#"\bemitTo\(\s*[^,]+,\s*([^,)]+)"#).unwrap();
        let resolve = |arg: &str| -> String {
            let arg = arg.trim();
            if let Some(rest) = arg.strip_prefix('"') {
                // `"접두-" + id` 는 접두 글자 그대로(분류 표의 `-` 끝 이름과 견준다).
                return rest.split('"').next().unwrap_or("").to_string();
            }
            names.get(arg).cloned().unwrap_or_else(|| format!("?{arg}"))
        };
        let mut out = Vec::new();
        for (path, text) in &files {
            let imported: String = imports.captures_iter(text).map(|c| c[1].to_string()).collect::<Vec<_>>().join(",");
            let has = |name: &str| imported.split(',').any(|n| n.trim() == name);
            let where_ = path.display().to_string();
            if has("emit") {
                for c in emit.captures_iter(text) {
                    out.push((resolve(&c[1]), where_.clone()));
                }
            }
            if has("emitTo") {
                for c in emit_to.captures_iter(text) {
                    out.push((resolve(&c[1]), where_.clone()));
                }
            }
        }
        out
    }

    #[test]
    fn frontend_emits_are_classified() {
        let emits = frontend_emits();
        assert!(emits.len() >= 8, "emit 을 못 읽었다: {emits:?}");
        let classified = |name: &str| {
            REMOTE_EMIT.contains(&name)
                || REMOTE_EMIT_DENIED
                    .iter()
                    .any(|d| if d.ends_with('-') { name.starts_with(d) } else { *d == name })
        };
        let missing: Vec<&(String, String)> = emits.iter().filter(|(n, _)| !classified(n)).collect();
        assert!(
            missing.is_empty(),
            "원격 이벤트 문에 분류가 없는 프런트 이벤트 — remote/deny.rs 의 REMOTE_EMIT(원격 허용 — 받는 쪽 리스너를 감사한 뒤) 또는 \
             REMOTE_EMIT_DENIED 에: {missing:?}"
        );
    }

    #[test]
    fn command_shape_is_narrow() {
        assert!(command_shape("approve_operation"));
        for bad in ["", "plugin:dialog|open", "Approve", "a b", &"a".repeat(65)] {
            assert!(!command_shape(bad), "{bad}");
        }
    }

    /// 모두 승인(2026-10-23) — 호스트 · DB 연결을 'YOLO' 로 올리는 길은 AI 권한 명령 둘뿐이고 둘 다 재확인이다(원격 창에서는 마스터가
    /// 있으면 그 순간 다시 묻는다). 그 단계를 켜는 전체 스위치(`[automation] auto_approve`)는 `save_settings` 의 메인 PC 전용 칸이다.
    /// `delegation.toml` 에 `approve_all` · `"all"` 을 적는 제품 코드는 위임 모듈 둘뿐이다(다른 명령이 몰래 올리지 못하게).
    #[test]
    fn raising_to_approve_all_is_reauth() {
        for c in ["delegation_set_target", "db_ai_set"] {
            assert_eq!(class_of(c), Class::Reauth, "{c}");
        }
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out);
                } else if p.extension().is_some_and(|x| x == "rs") {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk(&root, &mut files);
        for f in files {
            let rel = f.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
            if rel.ends_with("tests.rs") || rel.contains("/tests/") || rel == "remote/deny.rs" {
                continue;
            }
            let text = std::fs::read_to_string(&f).unwrap();
            let body = text.split("#[cfg(test)]").next().unwrap_or("");
            if body.contains("put(table, \"approve_all\"") {
                assert_eq!(rel, "delegation.rs", "{rel} 가 approve_all 을 적는다");
            }
        }
    }
}
