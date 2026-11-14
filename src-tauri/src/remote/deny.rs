//! **원격 창의 명령 문**(R1a-4 — 설계 7절 · 3절 단계 3) — 원격 브라우저의 앱 명령은 모두 이 표를 지나야 Tauri 에 닿는다
//! (`bridge::invoke` 가 `on_message` 앞에서 [`class_of`] 를 본다). 앱 명령은 ACL 을 보지 않으므로(앱 ACL 매니페스트 없음 · Local
//! 출처) **앱 명령의 문은 이 파일 하나**다. 플러그인 명령(`plugin:*`)은 여기 오지 않고 `capabilities/remote.json` 의 ACL 이 막는다
//! (실측 10-15: 폴리필을 우회해 ws 로 보낸 `plugin:dialog|open`·`opener|open_path`·`clipboard-manager|read_text`·`window|close`·
//! `app|version` 모두 "not allowed on window remote-…" — 열린 것은 `event|emit·emit_to`·`path|*` 뿐).
//!
//! 권한 B(사용자 결정 10-15): 원격 창 ≈ 집 PC 창이다. 표는 넷이고 **명령마다 정확히 하나**에 있다 — 시험
//! `every_command_is_classified_once` 가 `lib.rs` 의 `generate_handler![…]` 를 소스로 훑어 지킨다(새 명령이 조용히 열리지 않게 —
//! 표에 없는 명령은 원격에서 [`Class::Unknown`] 으로 거절된다).
//!
//! | 표 | 원격에서 | 무엇 |
//! | --- | --- | --- |
//! | [`HOME_ONLY`] | 거절 "집 PC 에서만 할 수 있습니다" | 볼트 마스터 바꾸기·풀기 · 볼트 전체 삭제 · 원격 기기 페어링 답·대기 · `tailscale serve` 걸기·끄기 · 모든 세션 종료 · 앱 업데이트(`update_*`) |
//! | [`REAUTH`] | 그 순간 마스터 암호 재확인(마스터가 없으면 그대로 통과) | 작업안 승인 · 대상 고치기 · AI 권한 올리기 |
//! | [`UNSUPPORTED`] | 거절 "원격에서 지원하지 않음" | 집 PC 의 OS 창·편집기·UAC 를 여는 것 · 창 모양 |
//! | [`ALLOW`] | 그대로 | 나머지 전부(설정·호스트·스니펫·볼트 값 넣기·파일·소스 컨트롤·DB·앱 종료 · 사이드 채팅(2026-11-01) …) |
//!
//! - **`save_settings` 는 [`ALLOW`] 이되 칸 단위 문**이 있다([`settings_home_only`]): `[automation]`(자동 승인 정책 — 알림 두 칸만
//!   빼고 전부)이 바뀌거나, `[remote]` 를 **켜거나**(끔 → 켬) 이름·포트를 바꾸면 거절한다. 끄기(켬 → 끔)는 원격에서도 된다
//!   (밖에서 급히 끊을 수 있게 — 기기 폐기 `remote_device_revoke` 도 원격 허용).
//! - **재확인**(`REAUTH`)은 폴리필이 그 명령을 보내기 전에 `POST /remote/reauth {cmd, password?}` 로 1회용 표(60초 · 그 세션 · 그 명령 ·
//!   한 번)를 받아 프레임에 싣는다(`gate::reauth` · `auth::AuthState::issue_reauth`). 암호는 HTTP 몸으로만 가고 ws 프레임에도 로그에도
//!   없다. 마스터가 없으면 관문이 암호 없이 표를 준다(사용자 결정 — 마스터는 선택). 이것은 **잠금 풀린 기기를 남이 든 경우**를 위한
//!   확인이지, 같은 원격 창 안의 악성 코드(XSS)를 막는 경계가 아니다 — 원격 창은 셸을 칠 수 있다(설계 13절: SSH 와 같은 등급).
//! - **일부러 [`ALLOW`] 에 둔 것**(재확인 없음 — 좁히기만 하거나 다른 문이 이미 있다):
//!   `reject_operation`·`cancel_operation`(좁힘) · `delegation_rename_target`·`delegation_remove_targets`·`db_ai_remove`(호스트·연결
//!   이름 변경·제거 팬아웃 — 옮기거나 걷기만 한다. 중간에 암호를 물어 취소되면 호스트만 지워지고 위임이 남는 꼴이 된다) ·
//!   `set_session_ai_read`(로컬 타일 "AI 읽기 허용" 의 **영속 메아리** — 타일이 세션이 설 때마다 저절로 보낸다. 켜는 문은 화면의
//!   토글이고, 원격 창에서 켤 때는 그 토글이 재확인을 먼저 묻는다 — `PaneHost` 의 `toggle-ai`) · `agent_hooks_*`(사용자 CLI 설정에
//!   우리 훅만 — 셸로도 할 수 있는 일) · `vault_create`(볼트가 이미 있으면 거절한다 — 마스터를 바꾸지 못한다) ·
//!   `vault_verify_master`(설정 › 보안 들어가기 관문 — 확인만 · 서버 빈도 제한, 원격 관문의 재확인과 같은 서버 op) · `test_auto_approval`
//!   (읽기 전용 판정) · 오케스트레이션의 나머지(멈춤·중단·수락/반려 기록 — 권한을 새로 주지 않는다).
//! - 오케스트레이션의 넓힘은 **저장소 맡기기 · 구성 묶음 저장(넓힘) · 검증 실행 확인 · 검증 실패 덮어쓰기 · 앨범 병합**이 [`REAUTH`] 이고 거두기 · 지우기 ·
//!   읽기는 [`ALLOW`] 다. (3차 6단계) Run 시작 · [이어 가기] 명령은 걷었다 — Run 은 AI 타일의 `start_run`(MCP)으로만 열리고 그 범위를 맡기기가 정한다.
//! - 폴리필은 [`UNSUPPORTED`] 중 브라우저에서 "아무것도 안 함" 이 맞는 셋(`set_app_icon`·`focus_window`·
//!   `take_tray_intent`)을 보내지 않고 `null` 로 답한다(창 조작 흉내와 같은 결 — 시험 `polyfill_noops_are_unsupported`).
//! - 거절 문구는 **사람 말**이다(R1a-5 — [`command_label`]): "집 PC 에서만 할 수 있습니다 — 볼트 마스터 암호 바꾸기".
//!
//! ## 이벤트 문 (R1a-5 — 설계 14.11 "이벤트 감사")
//!
//! 원격 창은 ACL 로 `plugin:event|emit`·`emit_to` 가 열려 있어(`capabilities/remote.json`) **집 PC 창에 아무 이벤트나** 낼 수 있었다.
//! 집 PC 창의 리스너 몇은 받은 순간 집 PC 전용 일을 한다(`tray-quit` → 앱 종료·모든 세션 끝 · `workspace-request` → 세션 놓기·
//! 타일 넘기기·포커스 · `remote-pair-request` → 가짜 페어링 모달 · `session-server-connected` → 가림막 다시 보기 …). 그래서 원격의
//! emit 은 **이벤트 이름으로 거른다 — 기본 거절, [`REMOTE_EMIT`] 만 허용**(`bridge::admit_event`). 허용한 넷은 받는 쪽이 파일을
//! 다시 읽거나 메모리 사본 이름만 맞추는 것(원격이 같은 명령으로 이미 할 수 있는 일의 메아리)이다. 시험
//! `frontend_emits_are_classified` 가 `src/` 의 `emit(…)`·`emitTo(…)` 를 훑어 프런트가 내는 이벤트가 모두 [`REMOTE_EMIT`] 이나
//! [`REMOTE_EMIT_DENIED`] 에 있는지 지킨다(새 이벤트가 원격에서 조용히 깨지거나 조용히 열리지 않게).

use crate::i18n::tr;
use crate::settings::AppSettings;

/// 원격 창에서 이 명령을 어떻게 다루나.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class {
    HomeOnly,
    Reauth,
    Unsupported,
    Allow,
    /// 어느 표에도 없다 — 거절(분류 시험이 이 경우를 막지만, 시험 밖에서 새면 닫히는 쪽으로).
    Unknown,
}

/// 집 PC 전용 — 원격에서 거절.
pub(crate) const HOME_ONLY: &[&str] = &[
    // 볼트 마스터 바꾸기·풀기(`new: None`)와 전체 삭제.
    "vault_set_master",
    "vault_delete_all",
    // 원격 기기 페어링 관리 — [허용] 은 집 PC 사람만(6자리 코드를 견주는 것이 사람이다).
    "remote_pair_respond",
    "remote_pair_pending",
    // 집 PC 에서 `tailscale status` 를 돌려 켜기·이름 칸을 채운다(R1a-5) — 켜기·이름 바꾸기가 집 PC 전용이라 같은 쪽.
    "remote_detect_host",
    // [연결] · [serve 끄기] — 집 PC 에서 `tailscale serve` 를 실행해 tailnet 노출을 바꾸고 켜기·이름·포트를 저장한다. 판정 읽기도 같은 쪽(CLI 실행).
    "remote_serve_status",
    "remote_serve_connect",
    "remote_serve_off",
    // 집 PC 화면 배치 거울(R2-B)을 올리는 쪽은 집 PC 주 창 하나 — 원격이 다른 원격에 가짜 배치를 흘리지 못하게.
    "mirror_publish",
    // 관문 쪽 색(`/remote/theme.css`)을 올리는 쪽도 집 PC 주 창 하나 — 원격 창은 이 기기 밝기 사본을 칠할 수 있고, 원격이 관문 색을 바꾸지 못하게.
    "remote_gate_theme_set",
    // 원격의 배치 요청(R3)을 받고 답하는 쪽도 집 PC 주 창 하나 — 원격이 남의 요청을 가로채거나 가짜 답을 내지 못하게.
    "mirror_request_inbox",
    "mirror_respond",
    // 독의 종료 단추 = 모든 세션 · 세션 서버 · 앱 끝내기(트레이 [모든 세션 종료…] 와 같은 길) — 집 PC 사람의 결정이다. 원격의
    // `tray-quit` emit 이 막힌 것과 같은 판단(`REMOTE_EMIT`). 원격 창에는 단추도 없다(`Dock.svelte`).
    "app_end_all_sessions",
    // 끝내기 모달의 [GUI 종료](2026-10-28) — 집 PC 화면을 끝내는 것도 집 PC 사람의 결정이다.
    "app_quit_gui",
    "app_hide_to_tray",
    // 앱 안 업데이트(2026-11-12 · 전문 13) — 원격 기기가 집 PC 를 업데이트시키지 못한다(찾기 · 받기 · 설치 · 건너뛰기 · 알림 표시까지
    // 전부 — 원격 창에는 칩도 카드도 없다).
    "update_state",
    "update_check",
    "update_download",
    "update_install",
    "update_skip",
    "update_mark_toasted",
];

/// 그 순간 마스터 암호를 다시 확인(설계 3절 단계 3) — 마스터가 없으면 그대로 통과.
pub(crate) const REAUTH: &[&str] = &[
    "producer_album_start", "orchestration_album_widen",
    // 작업안 승인(승인 등급 프레임을 만드는 유일한 GUI 명령) · 검토 중 대상 고치기(넓힐 수 있다).
    "approve_operation",
    "modify_operation_targets",
    // AI 권한 — 호스트 단계(원격 타일·헤드리스) · DB 연결 단계.
    "delegation_set_target",
    "db_ai_set",
    // (3차 6단계) 오케스트레이션 Run 시작 · 이어 가기 명령은 걷었다 — Run 은 AI 타일의 `start_run`(MCP)으로만 열리고, 그 범위는 아래
    // 저장소 맡기기(넓힘 = REAUTH)가 정한다.
    // 오케스트레이션 검증 — 후보 검증 실행 확인(AI 가 바꿀 수 있는 코드를 집 PC 에서 돌린다 — 작업안 승인과 같은 급) ·
    // 검증 실패 덮어쓰기(검증을 건너뛰고 통합을 연다).
    "orchestration_approve_verify",
    "orchestration_override_verify",
    // 앨범 영구 삭제 — 되돌릴 수 없다(앨범 기록 · 이 앨범의 ref). 보관 · 복원 · 목록은 ALLOW.
    "orchestration_delete_archived",
    // 앨범 병합 — 사람이 읽지 않은 앨범의 코드를 main 에 넣는다(되돌리려면 git). 미리 보기는 읽기라 ALLOW.
    "orchestration_merge",
    // 오케스트레이션 3차 — 저장소 맡기기(AI 에게 무인 실행 범위를 준다 — `delegation_set_target` · `db_ai_set` 과 같은 급) · 구성 묶음
    // (묶음을 고르는 저장소의 권한을 정한다). 거두기 · 묶음 지우기 · 읽기는 ALLOW.
];

/// 원격에서 뜻이 없다 — 집 PC 의 OS 창·편집기·UAC 를 연다. 거절.
pub(crate) const UNSUPPORTED: &[&str] = &[
    "set_app_icon",
    // 사용자 아바타(옛 사용자 앱 아이콘) 넣기 · 지우기 · 이름 바꾸기 — 원격 미지원(사용자 결정 10-22 · 10-31 · 화면은 단추를 숨긴다). 목록 · 큰 그림 읽기는
    // 허용 표(원격 화면에도 아바타가 보이게).
    "app_icon_add",
    "app_icon_remove",
    "app_icon_rename",
    "take_tray_intent",
    "open_tear_window",
    "focus_window",
    // 집 PC 에 편집기를 띄운다.
    "open_ssh_config",
    "edit_remote_file",
];

/// 원격에서 그대로 — **명시 목록**이다(새 명령은 넷 중 하나에 넣어야 시험이 지난다).
pub(crate) const ALLOW: &[&str] = &[
    "producer_fork_probe", "orchestration_album_defaults", "orchestration_album_set", "orchestration_rename_album",
    // 아바타 라이브러리 읽기(10-31 사용자 결정) — 원격 화면도 탭 · 머리줄 · 아티스트에 같은 아바타를 그린다. 그림 바이트만(경로 없음).
    "app_icon_list", "app_icon_image",
    // 로컬 세션 · 세션 코어
    "list_shells", "open_local_session", "local_cwd", "write_session", "resize_session", "close_session",
    // 크기 되찾기(10-20) — PTY 크기만 바꾼다(원격이 이미 할 수 있는 키 하나 친 것과 같은 효과 · 셸에 쓰지 않음).
    "claim_session_size",
    "ack_local_output", "detach_session", "attach_session", "probe_session", "stash_checkpoint",
    // 다중 시청자(R2-A) — 원격 창이 집 PC 의 타일을 빼앗지 않고 함께 본다(B — 집 PC 창과 동등).
    "attach_session_viewer", "detach_session_viewer",
    // 집 PC 화면 배치 거울(R2-B) — 원격 창이 붙을 때 지금 배치를 받는다(읽기만).
    "mirror_get",
    // 원격의 배치 바꾸기 요청(R3) — 집 PC 주 창이 제 함수로 적용한다(종류는 `remote/mirror.rs` 의 허용 목록 · 빈도·크기 상한).
    "mirror_request",
    "restore_done_sessions", "detached_sessions", "close_detached_session", "set_session_ai_read",
    // 잠자기 방지(10-23) — 원격에서 집 PC 를 깨워 두거나 놓는 것은 해가 없다(시스템 잠자기만 · 앱이 끝나면 풀린다)
    "keep_awake_status", "keep_awake_set",
    // 트레이 상태 · 세션 서버 · 진단 · 로그
    "tray_status", "session_server_status", "session_server_restart", "session_server_close_all", "session_stats",
    "session_log_path", "session_logs_dir",
    // SSH · 헤드리스 · 위임(읽기 · 팬아웃)
    "open_ssh_session", "session_info", "ssh_tmux_cwd", "ssh_tmux_list", "ssh_remote_home", "open_headless_session",
    // tmux 세션 끄기(사람 단추 · 확인 대화 뒤) — 원격 창은 그 셸에 `tmux kill-session` 을 칠 수 있다(같은 등급). sftp_remove ·
    // ssh_git_worktree_remove · ssh_git_branch_delete 처럼 되돌릴 수 없는 원격 정리도 ALLOW 다.
    "ssh_tmux_kill",
    "close_headless_session", "delegation_list_targets", "db_ai_list", "db_ai_remove", "delegation_rename_target",
    "delegation_remove_targets", "forget_host_key",
    // 창 · 이관 · 워크스페이스
    "reap_window_sessions", "stash_handoff", "take_handoff", "peek_handoff", "workspace_bind_window",
    "workspace_window_binding", "workspace_windows", "workspace_exit_app", "reattach_output",
    // 포워딩 · SFTP
    "add_forward", "list_forwards", "remove_forward", "list_edits", "stop_edit", "upload_file", "sftp_home", "sftp_list",
    "sftp_stat", "sftp_free_space", "sftp_read_text", "sftp_read_preview", "sftp_write_text", "sftp_mkdir", "sftp_create_file", "sftp_rename",
    // 이미지 타일의 큰 그림(조각 · 진행 · 취소) — `sftp_read_preview` 와 같은 등급(그 세션 파일 하나를 바이트로 읽기만)
    "sftp_read_image",
    "sftp_remove", "sftp_download", "sftp_copy", "sftp_move", "sftp_remove_many", "sftp_conflicts", "sftp_upload_paths",
    "sftp_download_paths", "sftp_copy_between", "sftp_move_between", "local_to_sftp_move", "sftp_to_local_move",
    "transfer_cancel",
    // 로컬 파일
    "local_home", "local_roots", "local_places", "local_free_space", "local_list", "local_stat", "local_read_text",
    "local_read_preview", "local_read_image", "local_write_text", "list_text_files", "local_mkdir", "local_create_file", "local_rename", "local_remove", "local_copy",
    "local_move", "local_remove_many", "local_conflicts", "local_write_file", "stage_agent_attachment",
    "create_agent_attachment_dir", "write_text_file",
    // 로컬 파일 타일의 자동 새로고침 — 로컬 목록 읽기와 같은 등급(보이는 폴더의 바뀜 알림만 · 읽기 전용)
    "local_watch_start", "local_watch_set", "local_watch_stop",
    // 호스트 · SSH 키
    "list_hosts", "add_host", "edit_host", "remove_host", "get_host_meta", "set_host_meta", "list_group_meta",
    "set_group_meta", "rename_group", "list_agent_public_keys", "agent_has_key", "install_public_key",
    "install_public_key_line", "generate_ssh_key", "list_ssh_key_files",
    // 설정(`save_settings` 는 칸 단위 문 — [`settings_home_only`]) · 언어 · 월페이퍼 · 워크스페이스 · 테마
    "load_settings", "save_settings", "set_language", "wallpaper_set", "wallpaper_clear", "wallpaper_resolve",
    "wallpaper_gc", "wallpaper_random", "workspaces_load", "workspaces_claim_writer", "workspaces_apply",
    "workspaces_migrate", "workspaces_start_fresh", "workspaces_migration_status", "load_theme_profiles",
    "theme_profiles_edit",
    // 사용자 터미널 테마 — 목록 읽기 · 넣기 · 이름 바꾸기 · 지우기. 테마 프로필 저장 · 월페이퍼처럼 설정 폴더의 **모양** 파일만 쓴다
    // (권한을 주지 않고 집 PC 의 OS 창도 열지 않는다 · 21색 검증 · 경로 조작 없는 id). 원격 창의 터미널도 같은 테마로 그린다 —
    // 집 PC 창 아이콘의 후보인 앱 아이콘(`UNSUPPORTED`)과 달리 원격 화면에도 뜻이 있다.
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
    // 작업안(승인·대상 고치기는 REAUTH) · 감사
    "list_operations", "operation_results", "reject_operation", "test_auto_approval", "cancel_operation",
    "set_reviewing_operations", "take_unseen_operation_results", "list_audit", "audit_runs", "audit_status",
    // 오케스트레이션(넓히는 것 — 맡기기 · 검증 확인 · 실패 덮어쓰기 — 는 REAUTH)
    "orchestration_pause", "orchestration_resume", "orchestration_stop", "orchestration_snapshot", "orchestration_run",
    "orchestration_set_task_state", "orchestration_stop_worker",
    // 앨범 보관함 — 라이브러리에서 빼고 되돌린다(기록 · ref 는 그대로 · 권한을 주지 않는다). 영구 삭제만 REAUTH.
    "orchestration_archive", "orchestration_archive_list", "orchestration_restore",
    "orchestration_wt_remove", "orchestration_review_task",
    "orchestration_report_drift", "orchestration_worker_activity", "orchestration_notices", "orchestration_notices_ack",
    "orchestration_same_dir_index", "orchestration_worker_transcript",
    // 2단계 단계 2 — 프로듀서 채팅(설계 7절 R11): 사람의 말 · 결정 · 끊기 · 닫기 · 읽기(원격이 이미 하는 "타일에 치기" 등급). 스튜디오 · 종류 ·
    // 세대 · 미귀속 상한은 서버가 본다 · `decide` 는 허용 목록 두 카드에만 뜻(정책으로 거절한 요청은 표에 없다) · 앨범은 여전히 AI 의
    // `start_run` 이 맡긴 범위 안에서만(맡기기 넓힘은 REAUTH 그대로).
    "producer_chat_open", "producer_chat_send", "producer_chat_interrupt", "producer_chat_set_model", "producer_chat_set_effort",
    "producer_chat_decide", "producer_chat_queue_cancel", "producer_chat_close", "producer_chat_attach", "producer_chat_status",
    "producer_chat_list",
    // 단계 3 — 사건 구독 · 떼기(그 연결의 창 통로에만 본문 — 창 라벨은 GUI 가 채운다 · 읽기 등급의 뜻)
    "producer_chat_subscribe", "producer_chat_unsubscribe",
    // 채팅 사이드 독(2026-11-01 사용자 결정 — 원격 웹 창에도 독을 연다 · docs/log/2026-11-01-remote-side-chat.md): 목록 · 채팅 폴더 ·
    // 채팅 프로세스 명령 · 사건 통로 · 연결 칩 전부. 사람의 말 · 권한 결정(`side_chat_decide` 포함 — 재확인 없음) · 끊기 · 닫기 · 읽기는
    // 원격이 이미 할 수 있는 "셸에 치기" 등급이다. 사건 본문은 그 채팅을 보는 창의 통로에만 간다(`server::side_chat_proxy` — 보조 창은 여전히
    // 거절). 외부 MCP 고르기 · 묻지 않기(`side_chat` · `side_chat_no_ask`)는 설정 저장의 칸이라 예전 그대로다.
    // 사이드 채팅 지침 읽기 · 쓰기(설정 › 지침 — 사람이 쓴 글 · 권한을 넓히지 않는다 · 지침 명령 `instruction_save` 와 같은 등급).
    "side_chats_load", "side_chats_save", "side_chat_dir", "side_chat_remove",
    "side_chat_instructions_load", "side_chat_instructions_save",
    "side_chat_open", "side_chat_send", "side_chat_interrupt", "side_chat_set_model", "side_chat_set_effort", "side_chat_decide",
    "side_chat_close", "side_chat_attach", "side_chat_list", "side_chat_subscribe", "side_chat_link",
    // 사이드 채팅 완료 확인 공유(2026-11-13 — 표시 전용 · 몸은 id · 번호뿐) — AI 타일의 `agent_state_seen` 과 같은 등급.
    "side_chat_seen",
    // 타일 권한 카드(2026-11-01 — `server::tile_permission_proxy`): 사람의 결정 · 스냅숏 · 통로. 사이드 채팅 · 프로듀서 권한 카드와 같은 등급(원격은
    // 이미 그 타일의 TUI 에 칠 수 있다 · 재확인 없음). 서버가 그 창이 그 세션을 보는지 다시 본다 · 본문은 그 창의 통로에만.
    // 명령 카드의 앱 분석(순수 계산 — 작업안 카드와 같은 분석 · 아무것도 바꾸지 않는다)
    "tile_permission_decide", "tile_permission_snapshot", "tile_permission_subscribe", "tile_permission_analyze", "tile_permission_face",
    // 3차 5단계 — 앨범 탭 배치 장부(탭에 앨범을 적는 자리만 · 권한을 주지 않는다)
    // 오케스트레이션 2차(통합 · 검토 · 정리) — 좁히기 · 기록 · 읽기 · 사람용 브랜치 내보내기 · 서버 임시 자리 · worktree 정리
    // (권한을 새로 주지 않는다 — 검증 실행 확인 · 실패 덮어쓰기만 REAUTH)
    "orchestration_report_files",
    "orchestration_cancel_integration", "orchestration_release_hold", "orchestration_reconcile_preview",
    "orchestration_reconcile", "orchestration_export", "orchestration_merge_preview", "orchestration_complete_run", "orchestration_cleanup_preview",
    "orchestration_cleanup", "orchestration_discard_temp",
    // 오케스트레이션 3차 맡기기 — 읽기 · 좁히기(맡기기 거두기 · 사용자 묶음 지우기 — 맡긴 저장소는 사본이라 그대로)
    // 아티스트 프로필에는 권한이 없다(앨범 먼저 S1 · Q12) — 편집도 ALLOW.
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
    // 스니펫 · 볼트(값을 돌려주는 명령은 없다 — 넣기·지우기·상태·잠그기·열기)
    // `vault_verify_master` 는 확인만(상태를 바꾸지 않는다 · 서버 빈도 제한) — 설정 › 보안 들어가기 관문이 원격에서도 같은 길을 쓴다.
    "load_snippets", "save_snippets", "vault_status", "vault_create", "vault_unlock", "vault_lock", "vault_verify_master", "vault_list",
    "vault_delete", "vault_store_password", "vault_store_mcp_env", "vault_store_passphrase", "vault_has_password",
    "vault_has_passphrase", "vault_store_db_password", "vault_has_db_password",
    // 쿼리 타일 · DB 연결
    // `db_test`(DB 연결 폼의 [연결 테스트])는 `db_open` 과 같은 결 — 사람이 고른 폼 값으로 한 번 붙어 보고 닫는다(볼트 물러남은 서버가 정한다).
    "db_open", "db_test", "db_query", "db_cancel", "db_schema", "db_objects", "db_table_detail", "db_definition", "db_set_write",
    "db_close", "db_tx", "db_script", "db_conn_list", "db_conn_save", "db_folders_load", "db_folders_save", "db_history_list",
    // 메신저
    "messenger_status", "messenger_set_webhook", "messenger_test", "messenger_send",
    // 원격 관문 — 상태 · 기기 목록 · 기기 폐기(자기 기기 포함 — 밖에서 급히 끊는다) · 기록 · 이름 바꾸기(표시만) ·
    // 모두 끊기(좁히기 — 원격 끄기와 같은 결)
    "remote_status", "remote_devices_list", "remote_device_revoke", "remote_log", "remote_device_rename",
    "remote_disconnect_all",
];

/// **원격 창이 낼 수 있는 이벤트**(R1a-5 — 머리말 "이벤트 문"). 기본 거절이고 이 넷만 연다 — 받는 쪽(집 PC 창)이 하는 일은:
/// - `settings-saved` — 파일을 **다시 읽는다**(`settings-sync.svelte.ts` — 짐의 값을 믿지 않는다 · 미저장 편집이 있으면 배너만).
///   원격의 설정 저장은 `save_settings` 칸 단위 문을 이미 지났다.
/// - `host-renamed` — 그 창 메모리의 즐겨찾기·타일 별칭을 새 이름으로(`host-rename.ts` — 파일은 원격이 부른 `edit_host` 가 이미 고쳤다).
/// - `workspace-renamed`·`workspace-style-changed` — 그 창 메모리의 워크스페이스 이름·모양(`workspaces_apply` 가 이미 파일을 고쳤다).
pub(crate) const REMOTE_EMIT: &[&str] = &["settings-saved", "host-renamed", "workspace-renamed", "workspace-style-changed"];

/// 프런트가 내지만 **원격 창에서는 거절**하는 이벤트 — 분류 시험의 짝(이름 끝이 `-` 면 접두). 원격 창은 보조 창이 아니라
/// 워크스페이스 보고·창 사이 요청(세션 놓기 · 타일 넘기기 · 포커스 · 종료 점검)에 끼지 않는다.
/// 가림막 맞추기(`veil-raised` · `veil-lifted` — 2026-10-28 `app/veil`)와 입력 시계 나누기(`user-active` — `app/idle-lock`)도
/// 집 PC 창끼리의 일이다 — 원격 창이 `veil-lifted` 를 내면 집 PC 가림막을 걷으려 들고(받는 쪽이 볼트를 다시 묻지만 문에서 막는다),
/// `user-active` 를 내면 집 PC 의 무입력 잠금을 미룬다. 원격 창은 제 관문(원격 가림막)이 따로 있다.
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

/// 원격 창이 이 이벤트를 낼 수 있나.
pub(crate) fn emit_allowed(event: &str) -> bool {
    REMOTE_EMIT.contains(&event)
}

/// 이벤트 거절 문구.
pub(crate) fn emit_message(event: &str) -> String {
    tr!(
        ko: "원격 창이 낼 수 없는 이벤트입니다 — {event}",
        en: "The remote client cannot emit this event — {event}",
        event = event
    )
}

/// 거절 문구에 쓰는 **사람 말** 이름(R1a-5) — 집 PC 전용·미지원 명령. 표에 없으면 명령 이름 그대로.
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
        "set_app_icon" => tr!(ko: "앱 아이콘 바꾸기", en: "changing the app icon"),
        "app_icon_add" => tr!(ko: "아바타 넣기", en: "adding an avatar"),
        "app_icon_remove" => tr!(ko: "아바타 지우기", en: "removing an avatar"),
        "app_icon_rename" => tr!(ko: "아바타 이름 바꾸기", en: "renaming an avatar"),
        "take_tray_intent" => tr!(ko: "트레이 메뉴", en: "the tray menu"),
        "open_tear_window" => tr!(ko: "타일을 새 창으로 떼어 내기", en: "tearing a tile out into a new window"),
        "focus_window" => tr!(ko: "메인 PC 창으로 옮기기", en: "focusing a main PC window"),
        "open_ssh_config" => tr!(ko: "SSH 설정 파일을 메인 PC 편집기로 열기", en: "opening the SSH config in a main PC editor"),
        "edit_remote_file" => tr!(ko: "원격 파일을 메인 PC 편집기로 열기", en: "opening a remote file in a main PC editor"),
        // 재확인(R4 — 원격 접속 기록의 "재확인 뒤 보냄" 줄 · 앱 모달 `remote-dialog.ts` 의 이름과 같은 말).
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
        other => other.to_string(),
    }
}

/// 칸 단위 문이 붙는 명령.
pub(crate) const SAVE_SETTINGS: &str = "save_settings";

/// 원격 창에서 이 명령의 분류. `plugin:*` 는 여기서 가르지 않는다(ACL — 머리말).
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

/// 집 PC 전용 거절 문구.
pub(crate) fn home_only_message(what: &str) -> String {
    tr!(ko: "메인 PC 에서만 할 수 있습니다 — {what}", en: "Only on the main PC — {what}", what = what)
}

/// 원격 미지원 거절 문구.
pub(crate) fn unsupported_message(cmd: &str) -> String {
    tr!(
        ko: "원격에서는 할 수 없습니다 — {what}",
        en: "Not available in the remote client — {what}",
        what = command_label(cmd)
    )
}

/// 분류 밖 명령 거절 문구.
pub(crate) fn unknown_message(cmd: &str) -> String {
    tr!(
        ko: "원격 창에 열리지 않은 기능입니다 ({cmd})",
        en: "This feature is not open to the remote client ({cmd})",
        cmd = cmd
    )
}

/// 재확인 표가 없거나 맞지 않을 때.
pub(crate) fn reauth_message() -> String {
    tr!(
        ko: "마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요",
        en: "The master password must be confirmed again — try again"
    )
}

/// `save_settings` 의 칸 단위 문 — 지금 저장된 값(`current`)과 원격이 보낸 값(`next` — 둘 다 정리 뒤)을 견줘 **집 PC 전용 칸이
/// 바뀌었으면 그 문구**. 순수 함수(시험이 본다).
///
/// - `[automation]` — 자동 승인 정책·상한·검토 만료·감사 보관까지 전부. 알림 두 칸(`notify_review_requests`·
///   `notify_operation_results` — 사람에게 알리기만 한다)만 원격에서 바꿀 수 있다.
/// - `[remote]` — 켜기(끔 → 켬)와 이름·포트 바꾸기. 끄기는 된다.
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
    None
}

/// 재확인 표의 명령 이름 모양 — 소문자·숫자·`_` 64자까지.
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
        // 앨범 보관함 — 되돌릴 수 없는 영구 삭제만 재확인(옛 닫기 명령은 걷었다).
        assert_eq!(class_of("orchestration_delete_archived"), Class::Reauth);
        // 앨범 병합 — 실행만 재확인 · 미리 보기는 읽기.
        assert_eq!(class_of("orchestration_merge"), Class::Reauth);
        assert_ne!(command_label("orchestration_merge"), "orchestration_merge");
        assert_eq!(class_of("orchestration_merge_preview"), Class::Allow);
        for command in ["orchestration_archive", "orchestration_archive_list", "orchestration_restore"] {
            assert_eq!(class_of(command), Class::Allow, "{command}");
        }
        assert_eq!(class_of("orchestration_close_orphaned"), Class::Unknown);
        assert_eq!(class_of("producer_album_start_basic"), Class::Unknown);
        assert_ne!(command_label("orchestration_album_widen"), "orchestration_album_widen");
        // 앱 안 업데이트(2026-11-12) — 원격 창은 찾기 · 받기 · 설치 · 건너뛰기 어느 것도 못 한다.
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
        // 사이드 채팅(2026-11-01 사용자 결정) — 원격 웹 창에도 독을 연다: 목록 · 폴더 · 프로세스 명령 · 통로 · 연결 칩 전부 ALLOW
        // (`side_chat_decide` 도 재확인 없음).
        for c in [
            "side_chats_load", "side_chats_save", "side_chat_dir", "side_chat_remove",
            "side_chat_instructions_load", "side_chat_instructions_save",
            "side_chat_open", "side_chat_send", "side_chat_interrupt", "side_chat_set_model", "side_chat_set_effort",
            "side_chat_decide", "side_chat_close", "side_chat_attach", "side_chat_list", "side_chat_subscribe", "side_chat_link",
            "side_chat_seen",
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 타일 권한 카드(2026-11-01) — 사이드 채팅 권한 카드와 같은 등급(ALLOW · 재확인 없음).
        for c in ["tile_permission_decide", "tile_permission_snapshot", "tile_permission_subscribe", "tile_permission_analyze", "tile_permission_face"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 배치 거울(R2-B) — 원격은 받기만 · 배치 바꾸기는 요청으로(R3 — 재확인 없음).
        assert_eq!(class_of("mirror_get"), Class::Allow);
        assert_eq!(class_of("mirror_request"), Class::Allow);
        for c in [
            "approve_operation", "delegation_set_target", "db_ai_set",
        ] {
            assert_eq!(class_of(c), Class::Reauth, "{c}");
        }
        // 저장소 맡기기의 좁히기 · 읽기(3차 1단계 — 설계 2-5 · 2-7) · 앨범 탭 배치 장부(3차 5단계).
        for c in [
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 2단계 단계 2 — 프로듀서 채팅 명령은 전부 ALLOW(설계 7절 표) · 저장소 맡기기(프로듀서 작업안 칸 포함)는 REAUTH 그대로.
        for c in [
            "producer_chat_open", "producer_chat_send", "producer_chat_interrupt", "producer_chat_set_model", "producer_chat_set_effort",
            "producer_chat_decide", "producer_chat_queue_cancel", "producer_chat_close", "producer_chat_attach", "producer_chat_status",
            "producer_chat_list", "producer_chat_subscribe", "producer_chat_unsubscribe",
        ] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 원격에서도 허용하는 예외(설계 7절) · 거절·취소는 좁히기.
        for c in ["remote_device_revoke", "remote_status", "save_settings", "reject_operation", "cancel_operation", "vault_store_password"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        // 아바타(10-31) — 읽기만 원격 허용, 넣기 · 지우기 · 앱 아이콘 고르기는 미지원.
        for c in ["app_icon_list", "app_icon_image"] {
            assert_eq!(class_of(c), Class::Allow, "{c}");
        }
        for c in ["app_icon_add", "app_icon_remove", "app_icon_rename", "set_app_icon"] {
            assert_eq!(class_of(c), Class::Unsupported, "{c}");
        }
        // tmux 세션 끄기 — 원격 창이 그 셸에서 칠 수 있는 일과 같은 등급(sftp_remove · ssh_git_branch_delete 와 같은 결).
        assert_eq!(class_of("ssh_tmux_kill"), Class::Allow);
        // 이미지 타일의 큰 그림 읽기 — 미리 보기 읽기와 같은 취급(파일 하나를 바이트로 읽기만).
        for (image, preview) in [("local_read_image", "local_read_preview"), ("sftp_read_image", "sftp_read_preview")] {
            assert_eq!(class_of(image), class_of(preview), "{image}");
        }
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

    #[test]
    fn save_settings_guard() {
        let cur = settings();
        // 다른 칸은 된다.
        let mut next = cur.clone();
        next.terminal.font_size = Some(15);
        assert_eq!(settings_home_only(&cur, &next, false), None);
        // 알림 두 칸은 된다.
        let mut next = cur.clone();
        next.automation.notify_review_requests = !cur.automation.notify_review_requests;
        next.automation.notify_operation_results = !cur.automation.notify_operation_results;
        assert_eq!(settings_home_only(&cur, &next, false), None);
        // 자동 승인 정책은 안 된다.
        let changes: [fn(&mut AppSettings); 6] = [
            |n: &mut AppSettings| n.automation.auto_approve = true,
            // 파이프 허용(10-22) — 정책 칸이라 원격에서 못 켠다.
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
        // 끄기는 된다 · 켜기·이름·포트는 안 된다.
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
        // 꺼진 채로 이름을 바꾸는 것도 집 PC 에서만.
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

    /// `src/` 의 `emit(…)`·`emitTo(…)`(IPC 어댑터에서 들여온 것) 가 내는 이벤트 이름을 모은다 — 글자 그대로 · 상수 이름(같은 소스의
    /// `const 이름 = "…"`) · `"접두-" + id` 셋을 읽는다. 읽지 못한 인자는 `?<인자>` 로 돌려준다(시험이 실패하게).
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
    /// 있으면 그 순간 다시 묻는다). 그 단계를 켜는 전체 스위치(`[automation] auto_approve`)는 `save_settings` 의 집 PC 전용 칸이다.
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
