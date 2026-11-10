//! 세션 서버 ③-1 — 프레임·판 협상·등급·찾기 파일·이름·고아 시계, 그리고 (Windows) 같은 프로세스 안에서 띄운 서버와의 왕복.

use super::ipc::frame::{self, code, negotiate, Frame, Grade, ProtocolRange, WireError};
use super::ipc::transport;
use super::serve::{Busy, IdleGuard};
use serde_json::json;
use std::time::{Duration, Instant};

fn range(min: u32, max: u32) -> ProtocolRange {
    ProtocolRange { min, max }
}

#[test]
fn frames_round_trip() {
    let frames = vec![
        Frame::Request {
            id: 7,
            kind: Grade::Read,
            op: "ping".into(),
            body: json!(null),
        },
        Frame::ok(7, json!({ "pong": true })),
        Frame::err(8, WireError::new(code::UNKNOWN_OP, "x")),
        Frame::Event {
            seq: 3,
            name: "clients".into(),
            body: json!({ "count": 1 }),
        },
        // 판 5 — 채널 터널(이진, 양방향)과 그 크레딧(JSON). 0 바이트 = EOF.
        Frame::Channel { chan: 7, bytes: b"\x00sftp\xff".to_vec() },
        Frame::Channel { chan: u64::MAX, bytes: Vec::new() },
        Frame::ChanAck { chan: 7, consumed: 65536 },
    ];
    for f in frames {
        let bytes = frame::encode(&f).unwrap();
        let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert_eq!(len, bytes.len() - 4, "길이 접두");
        assert_eq!(frame::decode(&bytes[4..]).unwrap(), f);
    }
    // 바깥 모양 — 다른 언어의 클라이언트가 읽을 글자.
    let v: serde_json::Value = serde_json::to_value(Frame::Request {
        id: 1,
        kind: Grade::Write,
        op: "shutdown".into(),
        body: json!({}),
    })
    .unwrap();
    assert_eq!(v, json!({"t": "request", "id": 1, "kind": "write", "op": "shutdown", "body": {}}));
    let ok = serde_json::to_value(Frame::ok(1, json!(1))).unwrap();
    assert_eq!(ok, json!({"t": "response", "id": 1, "ok": true, "body": 1}));
    let ca = serde_json::to_value(Frame::ChanAck { chan: 3, consumed: 9 }).unwrap();
    assert_eq!(ca, json!({"t": "chanack", "chan": 3, "consumed": 9}));
    // 채널 프레임의 바깥 모양 — [길이][0x02][u64 LE 채널][바이트].
    let b = frame::encode(&Frame::Channel { chan: 0x0102, bytes: b"ab".to_vec() }).unwrap();
    assert_eq!(&b[4..], &[0x02, 0x02, 0x01, 0, 0, 0, 0, 0, 0, b'a', b'b']);
    assert!(frame::decode(&[0x02, 1, 2]).is_err(), "짧은 채널 프레임");
}

#[tokio::test]
async fn frame_codec_over_a_byte_stream() {
    let (mut a, mut b) = tokio::io::duplex(1024);
    let f = Frame::ok(42, json!({ "k": "값" }));
    frame::write_frame(&mut a, &f).await.unwrap();
    drop(a);
    assert_eq!(frame::read_frame(&mut b).await.unwrap(), Some(f));
    assert_eq!(frame::read_frame(&mut b).await.unwrap(), None, "깨끗한 EOF");
}

#[tokio::test]
async fn oversized_frame_is_refused() {
    let (mut a, mut b) = tokio::io::duplex(64);
    use tokio::io::AsyncWriteExt;
    a.write_all(&((frame::MAX_FRAME as u32) + 1).to_le_bytes()).await.unwrap();
    assert!(frame::read_frame(&mut b).await.is_err());
}

#[test]
fn protocol_negotiation() {
    // 겹치면 겹친 가장 높은 판 — GUI 가 새로워도 구버전 서버와 붙는다.
    assert_eq!(negotiate(range(1, 3), range(1, 1)), Some(1));
    assert_eq!(negotiate(range(2, 4), range(1, 3)), Some(3));
    assert_eq!(negotiate(range(1, 1), range(1, 1)), Some(1));
    // 안 겹치면 None — GUI 는 "판 불일치" 를 보인다(자동 교체 없음).
    assert_eq!(negotiate(range(2, 3), range(1, 1)), None);
    assert_eq!(negotiate(range(1, 1), range(2, 2)), None);
    // 뒤집힌 범위는 받지 않는다.
    assert_eq!(negotiate(range(3, 1), range(1, 3)), None);
}

#[test]
fn grades_are_checked_per_op() {
    assert!(frame::check_grade("ping", Grade::Read).is_ok());
    assert!(frame::check_grade("shutdown", Grade::Write).is_ok());
    // 승인 등급은 승인 op(`ops_approve`) 밖에는 늘 거부한다.
    for op in ["hello", "ping", "status", "shutdown", "approve_operation", "ops_cancel", "ctx_batch"] {
        assert_eq!(frame::check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED);
    }
    // 쓰기 op 를 읽기로 · 읽기 op 를 쓰기로 — 둘 다 거부.
    assert_eq!(frame::check_grade("shutdown", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    assert_eq!(frame::check_grade("status", Grade::Write).unwrap_err().code, code::GRADE_MISMATCH);
    assert_eq!(frame::check_grade("nonsense", Grade::Write).unwrap_err().code, code::UNKNOWN_OP);
    // 세션 op(③-2) — 목록·살피기·폴더·통계는 읽기, 조작은 쓰기. 쓰기 op 를 읽기로 보내면 거부.
    for op in ["probe", "local_cwd", "stats", "live_streams", "sessions_detached"] {
        assert!(frame::check_grade(op, Grade::Read).is_ok(), "{op}");
    }
    for op in [
        "open", "write", "resize", "close", "attach", "detach", "checkpoint", "restore_done", "close_detached",
        "session_ai_read", "detach_window", "close_window", "adopt", "set_home", "close_all", "claim_size",
    ] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Read).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
    }
    // 신호 평면 op(③-3a) — 살아 있는 스트림·상태 스냅숏은 읽기, 발급·회수·파일 장부·상태 지우기는 쓰기. 승인은 늘 거부.
    assert!(frame::check_grade("agent_states_snapshot", Grade::Read).is_ok());
    assert!(frame::check_grade("agent_conversation_links", Grade::Read).is_ok());
    assert_eq!(frame::check_grade("agent_conversation_links", Grade::Write).unwrap_err().code, code::GRADE_MISMATCH);
    assert_eq!(frame::check_grade("agent_states_snapshot", Grade::Write).unwrap_err().code, code::GRADE_MISMATCH);
    assert!(frame::check_grade("agent_state_forget", Grade::Write).is_ok());
    assert!(frame::check_grade("agent_state_interrupt", Grade::Write).is_ok());
    assert_eq!(frame::check_grade("agent_state_interrupt", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    assert!(frame::check_grade("agent_conversation_launched", Grade::Write).is_ok());
    assert_eq!(frame::check_grade("agent_conversation_launched", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    assert_eq!(frame::check_grade("agent_state_forget", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    assert_eq!(frame::check_grade("agent_state_forget", Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED);
    // ③-3b2 — 신호 토큰 op 넷과 과도기 볼트 op 는 없다(토큰·볼트 값이 파이프를 타지 않는다).
    for op in ["signal_issue", "signal_revoke", "signal_written", "signal_live", "vault_credential_transitional"] {
        for g in [Grade::Read, Grade::Write] {
            assert_eq!(frame::check_grade(op, g).unwrap_err().code, code::UNKNOWN_OP, "{op}");
        }
    }
    // SSH 평면(③-3b2) — 연결 상태·로그 경로·포워드 목록·별칭·찾기 = 읽기, 나머지 = 쓰기. 승인은 늘 거부.
    for op in ["ssh_info", "ssh_log_path", "forward_list", "ssh_alias", "ssh_find"] {
        assert!(frame::check_grade(op, Grade::Read).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Write).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
    }
    for op in [
        "open_ssh", "forward_add", "forward_remove", "worktree_answer", "headless_open", "headless_close", "ssh_exec",
        "ssh_exec_cancel", "chan_open", "chan_close", "ssh_copy_id",
    ] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Read).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
        assert_eq!(frame::check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED, "{op}");
    }
    // 볼트 평면 op(③-3b1) — 상태·목록·있나는 읽기, 나머지는 쓰기(과도기 자격증명 포함). 승인은 늘 거부.
    for op in ["vault_status", "vault_list", "vault_has"] {
        assert!(frame::check_grade(op, Grade::Read).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Write).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
    }
    for op in [
        "vault_create", "vault_unlock", "vault_verify_master", "vault_lock", "vault_set_master", "vault_store", "vault_delete",
        "vault_delete_all", "vault_prune", "mcp_prepare", "mcp_retain",
    ] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Read).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
        assert_eq!(frame::check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED, "{op}");
        assert!(super::vault_ops::is_vault_op(op), "{op}");
    }
    // DB 평면(판 8) — 스키마·컬럼 = 읽기, 열기·쿼리·취소·쓰기 전환·닫기 = 쓰기. 승인은 늘 거부.
    for op in ["db_schema", "db_objects", "db_table_detail", "db_definition"] {
        assert!(frame::check_grade(op, Grade::Read).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Write).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
        assert!(super::db_ops::is_db_op(op), "{op}");
    }
    for op in ["db_open", "db_test", "db_query", "db_cancel", "db_set_write", "db_close", "db_tx", "db_script"] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Read).unwrap_err().code, code::GRADE_MISMATCH, "{op}");
        assert_eq!(frame::check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED, "{op}");
        assert!(super::db_ops::is_db_op(op), "{op}");
    }
    // 판 8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 는 MIN 을 올리지 않는다 — 판 7 서버와도 붙는다(셸 세션을 잃지 않게), DB op 는 판 8 부터 · 트랜잭션 작업은
    // 판 9 부터 · 스크립트 실행은 판 10 부터 · MCP 의 DB 도구는 판 11 부터 · AI 의 DB 쓰기 작업안은 판 12 부터 · 자동 커밋 토글은 판 13 부터
    // · Codex 검토 반영 1 의 판정은 판 14 부터 · 연결별 조정 장치는 판 15 부터(11 · 12 · 13 · 14 · 15 는 op 없음 — 표지 · 칸).
    assert_eq!(
        (
            frame::PROTOCOL_MIN,
            frame::PROTOCOL_MAX,
            frame::DB_PROTOCOL,
            frame::DB_TX_PROTOCOL,
            frame::DB_SCRIPT_PROTOCOL,
            frame::DB_AI_PROTOCOL,
            frame::DB_WRITE_PLAN_PROTOCOL,
            frame::DB_AUTOCOMMIT_PROTOCOL,
            frame::DB_TX_VERDICT_PROTOCOL,
            frame::DB_TX_SERIAL_PROTOCOL,
            frame::VAULT_VERIFY_PROTOCOL,
            frame::VIEWER_PROTOCOL
        ),
        (7, 30, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
    );
    // 판 22(타일 권한 카드 — `server::tile_permission`) — 스냅숏 = 읽기 · 사람의 결정 = 쓰기(승인 등급은 거부), MIN 은 그대로.
    assert_eq!(frame::TILE_PERMISSION_PROTOCOL, 22);
    assert!(frame::check_grade("tile_permission_snapshot", Grade::Read).is_ok());
    assert!(frame::check_grade("tile_permission_decide", Grade::Write).is_ok());
    assert_eq!(frame::check_grade("tile_permission_decide", Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED);
    assert!(super::tile_permission::is_op("tile_permission_decide") && super::tile_permission::is_op("tile_permission_snapshot"));
    // 판 20(오케스트레이션 2단계 단계 2 — 프로듀서 채팅) — 새 op `producer_chat_*`, MIN 은 그대로.
    assert_eq!(frame::PRODUCER_PROTOCOL, 20);
    for op in ["producer_chat_attach", "producer_chat_status", "producer_chat_list"] {
        assert!(frame::check_grade(op, Grade::Read).is_ok(), "{op}");
        assert!(super::producer::is_producer_op(op), "{op}");
    }
    for op in [
        "producer_chat_open", "producer_chat_send", "producer_chat_interrupt", "producer_chat_set_model", "producer_chat_set_effort",
        "producer_chat_decide", "producer_chat_queue_cancel", "producer_chat_close", "producer_chat_subscribe", "producer_chat_unsubscribe",
    ] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
        assert_eq!(frame::check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED, "{op}");
        assert!(super::producer::is_producer_op(op), "{op}");
    }
    // 판 18(자원 모니터) — 새 op `resource_snapshot` 하나, MIN 은 그대로.
    assert_eq!(frame::RESOURCE_PROTOCOL, 18);
    // 판 19(사이드 채팅 v2) → 판 21(보는 창 여럿 — 뜻이 바뀌어 사이드 채팅 op 는 21 부터), MIN 은 그대로.
    assert_eq!(frame::SIDE_CHAT_VIEWERS_PROTOCOL, 21);
    // 판 23(질문 카드의 답 · agent_state_interrupt) — MIN 은 그대로.
    assert_eq!(frame::TILE_QUESTION_PROTOCOL, 23);
    // 판 24(면 규칙 — tile_permission_face) — MIN 은 그대로.
    assert_eq!(frame::TILE_FACE_PROTOCOL, 24);
    assert!(frame::check_grade("tile_permission_face", Grade::Write).is_ok());
    assert!(super::tile_permission::is_op("tile_permission_face"));
    // 판 25(완료 확인 공유 — agent_state_seen · agent-seen) — MIN 은 그대로.
    assert_eq!(frame::AGENT_SEEN_PROTOCOL, 25);
    assert!(frame::check_grade("agent_state_seen", Grade::Write).is_ok());
    assert_eq!(frame::check_grade("agent_state_seen", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    // 판 26(앨범 보관함) — MIN 은 그대로 · 삭제도 승인 등급 프레임이 아니라 사람의 쓰기.
    assert_eq!(frame::ALBUM_ARCHIVE_PROTOCOL, 26);
    assert!(frame::check_grade("orchestration_archive_list", Grade::Read).is_ok());
    for op in ["orchestration_archive", "orchestration_restore", "orchestration_delete_archived"] {
        assert!(frame::check_grade(op, Grade::Write).is_ok(), "{op}");
    }
    // 판 27(앨범 병합) — MIN 은 그대로 · 병합도 승인 등급 프레임이 아니라 사람의 쓰기.
    assert_eq!(frame::ALBUM_MERGE_PROTOCOL, 27);
    assert!(frame::check_grade("orchestration_merge_preview", Grade::Read).is_ok());
    assert!(frame::check_grade("orchestration_merge", Grade::Write).is_ok());
    assert_eq!(frame::check_grade("orchestration_merge", Grade::Read).unwrap_err().code, code::GRADE_MISMATCH);
    // 판 28(DB 연결 폼 [연결 테스트]) — 새 op `db_test`(쓰기), MIN 은 그대로.
    assert_eq!(frame::DB_TEST_PROTOCOL, 28);
    // 판 29(DB 타일도 떨어진 세션으로 — 새 op 없음 · 목록 줄 `kind: "db"`) — MIN 은 그대로 · 낮은 서버면 `keep` 의 DB 열쇠를 뺀다.
    assert_eq!(frame::DETACHED_DB_PROTOCOL, 29);
    // 판 30(데이터 탭의 읽기 전용 조회 — 새 op 없음 · `db_query` 의 `readOnly`) — MIN 은 그대로.
    assert_eq!(frame::DB_READ_QUERY_PROTOCOL, 30);
    assert_eq!(frame::PROTOCOL_MAX, 30);
    let keep = vec!["local-1".to_string(), "query:tk-1".to_string()];
    assert_eq!(crate::session_core::commands::keep_for_server(keep.clone(), Some(28)), vec!["local-1".to_string()]);
    assert_eq!(crate::session_core::commands::keep_for_server(keep.clone(), Some(29)), keep);
    assert_eq!(crate::session_core::commands::keep_for_server(keep.clone(), None), keep);
    assert_eq!(negotiate(ProtocolRange::OURS, range(7, 8)), Some(8));
    assert_eq!(negotiate(ProtocolRange::OURS, range(7, 7)), Some(7));
    // 판에 무관한 op 는 둘뿐.
    assert!(frame::version_free("hello") && frame::version_free("shutdown"));
    assert!(!frame::version_free("ping") && !frame::version_free("status"));
}

fn scratch_dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "aynx-server-test-{tag}-{}-{}",
        std::process::id(),
        super::serve::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 설치기 훅(`nsis/hooks.nsh`)은 JSON 을 풀지 못해 `server.json` 을 줄 단위로 읽는다 — `  "sessions": N` 이 **제 줄**에 있어야 한다
/// (③-4). 옛 판의 파일(`sessions` 없음)도 읽힌다(0).
#[test]
fn discovery_writes_sessions_on_its_own_line() {
    use super::discovery::{self, Discovery};
    let dir = scratch_dir("disc-sessions");
    let path = dir.join("server.json");
    let d = Discovery {
        pid: 10,
        protocol: ProtocolRange::OURS,
        app_version: "0.1.0".into(),
        pipe: r"\\.\pipe\x".into(),
        started_at_ms: 1,
        launch_mode: "breakaway".into(),
        sessions: 12,
    };
    discovery::write(&path, &d).unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    let line = text.lines().find(|l| l.trim_start().starts_with("\"sessions\":")).expect("sessions 줄");
    // 훅의 읽기와 같은 모양 — 앞 두 칸 + `"sessions": ` 뒤가 숫자로 시작한다.
    assert!(line.starts_with("  \"sessions\": 12"), "{line:?}");
    let old = r#"{"pid":1,"protocol":{"min":6,"max":6},"app_version":"0","pipe":"p","started_at_ms":1}"#;
    std::fs::write(&path, old).unwrap();
    assert_eq!(discovery::read(&path).map(|d| d.sessions), Some(0));
}

#[test]
fn discovery_is_replaced_atomically_and_removed_only_by_owner() {
    use super::discovery::{self, Discovery};
    let dir = scratch_dir("disc");
    let path = dir.join("server.json");
    let mut d = Discovery {
        pid: 10,
        protocol: ProtocolRange::OURS,
        app_version: "0.1.0".into(),
        pipe: r"\\.\pipe\x".into(),
        started_at_ms: 1,
        launch_mode: "breakaway".into(),
        sessions: 0,
    };
    discovery::write(&path, &d).unwrap();
    d.pid = 11;
    d.sessions = 3;
    discovery::write(&path, &d).unwrap();
    assert_eq!(discovery::read(&path), Some(d.clone()));
    let names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["server.json".to_string()], "임시 파일이 남지 않는다");
    // 비밀 없음 — 실린 열쇠는 이것뿐.
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(keys, ["app_version", "launch_mode", "pid", "pipe", "protocol", "sessions", "started_at_ms"]);
    discovery::remove_if_ours(&path, 10);
    assert!(path.exists(), "남의 pid 면 지우지 않는다");
    discovery::remove_if_ours(&path, 11);
    assert!(!path.exists());
    // 깨진 파일은 "서버 없음".
    std::fs::write(&path, b"{nope").unwrap();
    assert_eq!(discovery::read(&path), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pipe_name_is_deterministic_and_hides_the_sid() {
    let sid = "S-1-5-21-1111111111-2222222222-3333333333-1001";
    let a = transport::pipe_name("aynx", sid);
    assert_eq!(a, transport::pipe_name("aynx", sid));
    assert!(a.starts_with(r"\\.\pipe\aynx-") && a.len() == r"\\.\pipe\aynx-".len() + 16);
    assert!(!a.contains("1001"));
    assert_ne!(a, transport::pipe_name("aynx-dev", sid), "개발·릴리스는 다른 파이프");
    assert_ne!(a, transport::pipe_name("aynx", "S-1-5-21-1-2-3-1002"));
    // FNV-1a 64 의 알려진 값(빈 문자열 = 오프셋 기저).
    assert_eq!(transport::fnv1a64(""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(transport::sddl_for("S-1"), "O:S-1D:P(A;;GA;;;S-1)");
}

#[test]
fn idle_guard_counts_only_uninterrupted_idleness() {
    let t0 = Instant::now();
    let mut g = IdleGuard::new(Duration::from_secs(10), t0);
    let idle = Busy { clients: 0, sessions: 0, plans: 0, runs: 0 };
    assert!(!g.observe(idle, t0 + Duration::from_secs(5)));
    // 클라이언트가 붙으면 시계가 지워진다.
    assert!(!g.observe(Busy { clients: 1, sessions: 0, plans: 0, runs: 0 }, t0 + Duration::from_secs(9)));
    assert!(!g.observe(idle, t0 + Duration::from_secs(12)));
    assert!(!g.observe(idle, t0 + Duration::from_secs(21)));
    assert!(g.observe(idle, t0 + Duration::from_secs(22)));
}

/// 살아 있는 세션(붙었거나 떨어진)이 하나라도 있으면 클라이언트가 없어도 무기한 — `Busy.sessions`(③-2).
#[test]
fn live_sessions_keep_the_server_alive_without_clients() {
    let t0 = Instant::now();
    let mut g = IdleGuard::new(Duration::from_secs(10), t0);
    let detached = Busy { clients: 0, sessions: 2, plans: 0, runs: 0 };
    assert!(!detached.idle());
    assert!(!g.observe(detached, t0 + Duration::from_secs(60)));
    assert!(!g.observe(detached, t0 + Duration::from_secs(3600)));
    // 세션이 모두 끝난 뒤부터 다시 잰다.
    let idle = Busy { clients: 0, sessions: 0, plans: 0, runs: 0 };
    assert!(!g.observe(idle, t0 + Duration::from_secs(3601)));
    assert!(g.observe(idle, t0 + Duration::from_secs(3611)));
}

/// 소스 훑기 시험의 재료 — `src/` 아래 `.rs` 전부 `(src/… 상대 경로, 본문)`. **줄 끝은 LF 로 맞춘다** — `core.autocrlf=true`
/// 체크아웃은 CRLF 라 `"#[cfg(test)]\nmod tests {"` 같은 맞춰 보기가 조용히 빗나가 시험이 깨진다(재리뷰 R08).
fn rust_sources() -> Vec<(String, String)> {
    fn walk(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let rel = p
                    .strip_prefix(env!("CARGO_MANIFEST_DIR"))
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, lf(&std::fs::read_to_string(&p).unwrap())));
            }
        }
    }
    let mut files = Vec::new();
    walk(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
    assert!(files.len() > 100, "소스를 못 찾음");
    files
}

/// 줄 끝을 LF 로 — 소스 훑기는 이것을 지난 본문만 본다.
fn lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// 파일 끝의 시험 모듈을 뺀 본문(관례 — `#[cfg(test)]\nmod tests {`). [`lf`] 를 지난 본문을 받는다.
fn without_test_module(text: &str) -> &str {
    text.split("#[cfg(test)]\nmod tests {").next().unwrap_or(text)
}

/// **CRLF 체크아웃에서도 소스 훑기가 같은 답을 낸다**(재리뷰 R08) — 줄 끝만 다른 같은 소스에서 시험 모듈 자르기가 같은 자리를 찾는다.
#[test]
fn source_scans_ignore_line_endings() {
    let src = "fn real() { request_approve(x) }\n#[cfg(test)]\nmod tests {\n    fn t() { request_approve(y) }\n}\n";
    let crlf = src.replace('\n', "\r\n");
    assert_eq!(without_test_module(&crlf), crlf, "정규화 없이는 빗나간다 — 이 시험이 지키는 것");
    assert_eq!(lf(&crlf), src);
    assert_eq!(without_test_module(&lf(&crlf)), "fn real() { request_approve(x) }\n");
    // 실제 파일도 — 승인 명령 파일을 CRLF 로 바꿔도 같은 본문·같은 명령 끝(`\n}\n`)이 남는다.
    let me = lf(include_str!("../operations/approval.rs"));
    let crlf = lf(&me.replace('\n', "\r\n"));
    assert_eq!(without_test_module(&crlf), without_test_module(&me));
    assert!(crlf.contains("pub async fn approve_operation(") && crlf.contains("\n}\n"));
}

/// **승인 등급 프레임을 만드는 자리는 하나다**(③-3c) — 소스를 훑는다(시험 모듈·`tests.rs` 는 뺀다):
/// - `Grade::Approve` 는 정의·판정(`ipc/frame.rs`)과 클라이언트(`client.rs` — `request_approve` 몸과 다른 문의 거부)에만.
/// - `request_approve(` 를 **부르는** 곳은 `operations/approval.rs` 의 Tauri 명령 `approve_operation` 몸 하나뿐.
/// - 그 명령은 `lib.rs` 의 명령 등록 목록에 있다(사람이 누르는 버튼·주 창의 자동 승인 타이머가 부른다).
#[test]
fn approve_frames_come_from_one_place() {
    let files = rust_sources();
    let mut approve_grade = Vec::new();
    let mut approve_calls = Vec::new();
    for (rel, text) in &files {
        if rel.ends_with("/tests.rs") || rel.contains("/tests/") {
            continue;
        }
        // 파일 끝의 시험 모듈은 뺀다(관례 — `#[cfg(test)]\nmod tests {`).
        let body = without_test_module(text);
        if body.contains("Grade::Approve") {
            approve_grade.push(rel.clone());
        }
        for (i, _) in body.match_indices("request_approve(") {
            let line_start = body[..i].rfind('\n').map_or(0, |n| n + 1);
            let line = &body[line_start..i];
            if !line.contains("fn ") && !line.trim_start().starts_with("//") && !line.contains('`') {
                approve_calls.push((rel.clone(), i));
            }
        }
    }
    approve_grade.sort();
    assert_eq!(approve_grade, vec!["src/server/client.rs".to_string(), "src/server/ipc/frame.rs".to_string()]);
    assert_eq!(approve_calls.len(), 1, "{approve_calls:?}");
    let (rel, at) = &approve_calls[0];
    assert_eq!(rel, "src/operations/approval.rs");
    let approval = &files.iter().find(|(r, _)| r == rel).unwrap().1;
    let start = approval.find("pub async fn approve_operation(").expect("approve_operation");
    let end = start + approval[start..].find("\n}\n").expect("명령 끝");
    assert!((start..end).contains(at), "request_approve 를 부르는 곳이 approve_operation 몸 안이어야 한다");
    let lib = &files.iter().find(|(r, _)| r == "src/lib.rs").unwrap().1;
    let list_start = lib.find("generate_handler![").unwrap();
    let list = &lib[list_start..list_start + lib[list_start..].find("])").unwrap()];
    assert!(list.contains("operations::approval::approve_operation"));
    // MCP 도구 표에 승인·취소가 없다는 것은 `mcp/tests.rs`(`tools_list_has_all_tools_with_schemas` 근처)가 본다.
}

/// 진행 중 작업안(승인됨·실행 중)이 있으면 세션·클라이언트가 없어도 끝나지 않는다 — `Busy.plans`(③-3c · 설계 4.1).
#[test]
fn running_plans_keep_the_server_alive() {
    let t0 = Instant::now();
    let mut g = IdleGuard::new(Duration::from_secs(10), t0);
    let running = Busy { clients: 0, sessions: 0, plans: 1, runs: 0 };
    assert!(!running.idle());
    assert!(!g.observe(running, t0 + Duration::from_secs(600)));
    let idle = Busy { clients: 0, sessions: 0, plans: 0, runs: 0 };
    assert!(!g.observe(idle, t0 + Duration::from_secs(601)));
    assert!(g.observe(idle, t0 + Duration::from_secs(611)));
}

/// 살아 있는 오케스트레이션 Run(running · paused · stopping)이 있으면 세션·클라이언트·작업안이 없어도 끝나지 않는다 —
/// `Busy.runs`(2026-10-14 설계 C-7). orphaned 는 세지 않는다(`Orchestration::active_count`).
#[test]
fn idle_exit_waits_for_active_runs() {
    let t0 = Instant::now();
    let mut g = IdleGuard::new(Duration::from_secs(10), t0);
    let active = Busy { clients: 0, sessions: 0, plans: 0, runs: 1 };
    assert!(!active.idle());
    assert!(!g.observe(active, t0 + Duration::from_secs(3600)));
    let idle = Busy::default();
    assert!(!g.observe(idle, t0 + Duration::from_secs(3601)), "Run 이 끝난 뒤부터 시계가 다시 간다");
    assert!(g.observe(idle, t0 + Duration::from_secs(3611)));
}

/// 출력 프레임 — 이진(머리 JSON + 바이트 그대로, base64 없음) · ACK 는 JSON. JSON 프레임의 모양(판 1 그대로)은 첫 바이트 `{`.
#[test]
fn output_and_ack_frames_round_trip() {
    use super::ipc::frame::{Ack, OutputHeader};
    let header = OutputHeader {
        stream: "s-1".into(),
        session_epoch: 3,
        lease_epoch: 2,
        offset: 4096,
        route: None,
    };
    let raw: Vec<u8> = (0u8..=255).chain([0x1b, b'{', 0]).collect();
    let f = Frame::Output {
        header: header.clone(),
        bytes: raw.clone(),
    };
    let bytes = frame::encode(&f).unwrap();
    assert_eq!(bytes[4], 0x01, "출력 프레임 표지");
    let hl = u32::from_le_bytes(bytes[5..9].try_into().unwrap()) as usize;
    let head: serde_json::Value = serde_json::from_slice(&bytes[9..9 + hl]).unwrap();
    assert_eq!(head, json!({"stream": "s-1", "sessionEpoch": 3, "leaseEpoch": 2, "offset": 4096}));
    assert_eq!(&bytes[9 + hl..], &raw[..], "바이트는 그대로(인코딩 없음)");
    assert_eq!(frame::decode(&bytes[4..]).unwrap(), f);

    let ack = Frame::Ack(Ack {
        stream: "s-1".into(),
        session_epoch: 3,
        lease_epoch: 2,
        consumed: 5000,
    });
    let bytes = frame::encode(&ack).unwrap();
    assert_eq!(bytes[4], b'{');
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes[4..]).unwrap(),
        json!({"t": "ack", "stream": "s-1", "sessionEpoch": 3, "leaseEpoch": 2, "consumed": 5000})
    );
    assert_eq!(frame::decode(&bytes[4..]).unwrap(), ack);
    // 짧거나 머리 길이가 틀린 출력 프레임은 거부.
    assert!(frame::decode(&[0x01, 0, 0]).is_err());
    assert!(frame::decode(&[0x01, 200, 0, 0, 0, b'{']).is_err());
}

#[test]
fn exe_comparison_rules() {
    use super::os::{exe_under, same_exe};
    assert!(same_exe(r"\\?\C:\Program Files\AYNX\aynx.exe", r"c:\program files\aynx\AYNX.EXE"));
    assert!(!same_exe(r"C:\a\aynx.exe", r"C:\b\aynx.exe"));
    let root = std::path::Path::new(r"C:\Users\u\AppData\Roaming\aynx-dev\server-bin");
    assert!(exe_under(r"C:\Users\u\AppData\Roaming\aynx-dev\server-bin\0123\aynx.exe", root));
    assert!(!exe_under(r"C:\Users\u\AppData\Roaming\aynx-dev\server-bin-evil\aynx.exe", root));
    assert!(!exe_under(r"C:\elsewhere\aynx.exe", root));
}

/// 같은 프로세스 안에서 띄운 서버와의 왕복 — hello·ping·status·shutdown · 둘째 서버 err 5 · hello 전 거부 · 승인 거부.
#[cfg(windows)]
pub(in crate::server) mod live {
    use super::super::ipc::{frame, transport, BoxStream, Frame, Grade, Hello, ProtocolRange, Welcome};
    use super::super::serve::{self, Config, Exit};
    use super::super::{discovery, os};
    use super::{code, scratch_dir};
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// 세션 코어·로컬 표는 프로세스 전역이다 — 세션을 여는 시험과 "세션 0 이면 끝난다" 시험이 겹치지 않게.
    pub(in crate::server) static SESSION_STATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    pub(in crate::server) fn test_pipe() -> String {
        format!(
            r"\\.\pipe\aynx-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        )
    }

    pub(in crate::server) fn config(pipe: &str, disc: Option<std::path::PathBuf>, trusted: Vec<String>, idle: Duration) -> Config {
        Config {
            pipe: pipe.into(),
            discovery: disc,
            idle,
            launch_mode: "breakaway".into(),
            own_job: false,
            kill_tree: false,
            trusted_clients: trusted,
            app_version: "0.0.0-test".into(),
            vault_dir: Some(scratch_dir("vault")),
            audit_dir: Some(scratch_dir("audit")),
            mcp_json: Some(scratch_dir("mcp").join("mcp.json")),
            db_conns: None,
            orchestration_dir: Some(scratch_dir("orchestration")),
        }
    }

    async fn call(s: &mut BoxStream, id: u64, kind: Grade, op: &str, body: Value) -> Frame {
        frame::write_frame(s, &Frame::Request { id, kind, op: op.into(), body }).await.unwrap();
        loop {
            match frame::read_frame(s).await.unwrap().expect("응답") {
                Frame::Event { .. } => continue,
                f => return f,
            }
        }
    }

    pub(in crate::server) fn ok_body(f: Frame) -> Value {
        match f {
            Frame::Response { ok: true, body, .. } => body.unwrap_or(Value::Null),
            other => panic!("ok 가 아님: {other:?}"),
        }
    }

    pub(in crate::server) fn err_code(f: Frame) -> String {
        match f {
            Frame::Response { ok: false, error: Some(e), .. } => e.code,
            other => panic!("실패가 아님: {other:?}"),
        }
    }

    pub(in crate::server) async fn connect_retry(pipe: &str) -> (BoxStream, transport::Peer) {
        for _ in 0..100 {
            if let Ok(c) = transport::connect(pipe).await {
                return c;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("서버에 붙지 못함");
    }

    pub(in crate::server) fn hello(min: u32, max: u32) -> Value {
        serde_json::to_value(Hello {
            protocol: ProtocolRange { min, max },
            app_version: "0.0.0-test".into(),
            client: "gui".into(),
            window: None,
        })
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hello_ping_status_shutdown_and_second_server() {
        // 서버 안의 전역(`pty::set_events` · `server::hub`)은 마지막에 뜬 서버의 것 — 서버를 띄우는 시험은 한 줄로 선다.
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let dir = scratch_dir("live");
        let disc = dir.join("server.json");
        let own = os::own_image().expect("자기 이미지");
        let server = tokio::spawn(serve::run(config(&pipe, Some(disc.clone()), vec![own.clone()], Duration::from_secs(60))));

        let (mut s, peer) = connect_retry(&pipe).await;
        // GUI 쪽 서버 확인 — 상대(서버)는 이 프로세스다.
        assert_eq!(peer.pid, Some(std::process::id()));
        assert!(os::same_exe(peer.image.as_deref().unwrap(), &own));
        // 찾기 파일이 섰다.
        let d = discovery::read(&disc).expect("server.json");
        assert_eq!((d.pid, d.pipe.as_str(), d.launch_mode.as_str()), (std::process::id(), pipe.as_str(), "breakaway"));

        // 둘째 서버는 선점에서 진다(err 5) — 조용히 끝난다.
        let second = serve::run(config(&pipe, None, vec![own.clone()], Duration::from_secs(60))).await;
        assert_eq!(second, Exit::AlreadyRunning);

        // hello 전에는 판에 무관하지 않은 op 를 받지 않는다.
        assert_eq!(err_code(call(&mut s, 1, Grade::Read, "ping", json!(null)).await), code::NEED_HELLO);
        // 판이 안 겹치면 거부.
        assert_eq!(err_code(call(&mut s, 2, Grade::Read, "hello", hello(90, 99)).await), code::PROTOCOL_MISMATCH);
        // 겹치면(GUI 가 더 새로워도) 붙는다.
        let w: Welcome = serde_json::from_value(ok_body(call(&mut s, 3, Grade::Read, "hello", hello(1, 10)).await)).unwrap();
        assert_eq!((w.protocol, w.server_pid, w.launch_mode.as_str()), (10, std::process::id(), "breakaway"));
        assert_eq!(ok_body(call(&mut s, 4, Grade::Read, "ping", json!(null)).await)["pong"], true);
        let st = ok_body(call(&mut s, 5, Grade::Read, "status", json!(null)).await);
        assert_eq!(st["clients"], 1);
        assert_eq!(st["own_job"], false);
        // 등급 — 승인은 늘 거부, 쓰기 op 를 읽기로 보내면 거부.
        assert_eq!(err_code(call(&mut s, 6, Grade::Approve, "status", json!(null)).await), code::APPROVE_REFUSED);
        assert_eq!(err_code(call(&mut s, 7, Grade::Read, "shutdown", json!({})).await), code::GRADE_MISMATCH);
        // 응답 id 는 요청 id 와 짝이다.
        match call(&mut s, 77, Grade::Read, "ping", json!(null)).await {
            Frame::Response { id, .. } => assert_eq!(id, 77),
            other => panic!("{other:?}"),
        }

        // 정상 종료 — 쓰기 등급.
        assert_eq!(ok_body(call(&mut s, 8, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let exit = tokio::time::timeout(Duration::from_secs(5), server).await.unwrap().unwrap();
        assert!(matches!(exit, Exit::Shutdown(_)), "{exit:?}");
        assert!(!disc.exists(), "정상 종료는 제 찾기 파일을 지운다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shutdown_without_hello_is_accepted() {
        // 서버 안의 전역(`pty::set_events` · `server::hub`)은 마지막에 뜬 서버의 것 — 서버를 띄우는 시험은 한 줄로 선다.
        let _g = SESSION_STATE.lock().await;
        // 판이 어긋난 GUI 도 [다시 시작] 으로 서버를 끝낼 수 있어야 한다(판에 무관한 op).
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let (mut s, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut s, 1, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let exit = tokio::time::timeout(Duration::from_secs(5), server).await.unwrap().unwrap();
        assert!(matches!(exit, Exit::Shutdown(_)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn untrusted_client_is_dropped() {
        // 서버 안의 전역(`pty::set_events` · `server::hub`)은 마지막에 뜬 서버의 것 — 서버를 띄우는 시험은 한 줄로 선다.
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let server = tokio::spawn(serve::run(config(
            &pipe,
            None,
            vec![r"C:\definitely\not\aynx.exe".into()],
            Duration::from_secs(60),
        )));
        let (mut s, _) = connect_retry(&pipe).await;
        let _ = frame::write_frame(&mut s, &Frame::Request {
            id: 1,
            kind: Grade::Read,
            op: "hello".into(),
            body: hello(7, 7),
        })
        .await;
        let r = tokio::time::timeout(Duration::from_secs(3), frame::read_frame(&mut s)).await.unwrap();
        assert!(matches!(r, Ok(None) | Err(_)), "끊겨야 한다: {r:?}");
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn orphan_server_exits_after_idle_limit() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let exit = tokio::time::timeout(
            Duration::from_secs(5),
            serve::run(config(&pipe, None, vec![own], Duration::from_millis(400))),
        )
        .await
        .expect("한가하면 스스로 끝난다");
        assert!(matches!(exit, Exit::Shutdown(ref r) if r.contains("idle")), "{exit:?}");
    }

    /// ③-2 통합 — 서버 안에서 로컬 셸을 열고(open) → 쓰고(write) → 출력 프레임을 받고(오프셋·임대 머리) → **연결을 끊으면**
    /// 세션이 떨어진 채 살고(Detached · 링은 계속) → 새 연결이 붙어(attach) 끊긴 동안의 출력을 소비 오프셋부터 재생받고 →
    /// 옛 임대의 쓰기는 거부되고 → 닫는다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn local_session_survives_client_disconnect_and_reattaches() {
        let _g = SESSION_STATE.lock().await;
        use super::super::ipc::frame::{Ack, OutputHeader};
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let stream = format!("ss2-test-{}", std::process::id());

        // ── 연결 A: 열기 · 쓰기 · 출력 ──
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await);
        let spec = json!({ "cols": 100, "rows": 30, "shellId": "cmd", "integration": null, "env": [], "cwd": null });
        let opened = ok_body(
            call(&mut a, 2, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": false })).await,
        );
        let lease = opened["lease"].clone();
        assert_eq!(lease["sessionEpoch"], 1);
        assert_eq!(lease["leaseEpoch"], 1);
        assert_eq!(opened["shell"], "cmd");
        // 같은 스트림을 또 열면 거절 — 살아 있다(붙어라).
        let again = call(&mut a, 3, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": false })).await;
        assert!(format!("{again:?}").contains("session-alive"), "{again:?}");

        let mut w = lease.clone();
        w["data"] = json!("echo SS2_BEFORE\r\n");
        // 쓰기 응답과 출력이 섞여 오므로 응답은 따로 기다리지 않고 아래 수집 고리에서 고른다.
        frame::write_frame(&mut a, &Frame::Request { id: 4, kind: Grade::Write, op: "write".into(), body: w }).await.unwrap();
        let mut got: Vec<u8> = Vec::new();
        let mut next_offset = 0u64;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        // 명령 줄의 메아리 + echo 의 출력 — 두 번 보이면 셸이 받아 실행했다(ConPTY 는 줄바꿈 대신 커서 이동을 쓸 수 있다).
        while String::from_utf8_lossy(&got).matches("SS2_BEFORE").count() < 2 {
            let Ok(f) = tokio::time::timeout_at(deadline, frame::read_frame(&mut a)).await else {
                panic!("출력이 오지 않음 — 받은 것: {:?}", String::from_utf8_lossy(&got));
            };
            let f = f.unwrap().unwrap();
            if let Frame::Output { header, bytes } = f {
                let OutputHeader { stream: s, session_epoch, lease_epoch, offset, .. } = header;
                assert_eq!((s.as_str(), session_epoch, lease_epoch), (stream.as_str(), 1, 1));
                assert_eq!(offset, next_offset, "오프셋은 빈틈없이 이어진다");
                next_offset += bytes.len() as u64;
                // 붙은 창(xterm)처럼 커서 위치 질의에 답한다 — 붙어 있는 동안은 서버가 답하지 않는다.
                if bytes.windows(4).any(|w| w == b"\x1b[6n") {
                    let mut dsr = lease.clone();
                    dsr["data"] = json!("\u{1b}[30;1R");
                    frame::write_frame(&mut a, &Frame::Request { id: 900, kind: Grade::Write, op: "write".into(), body: dsr }).await.unwrap();
                }
                got.extend_from_slice(&bytes);
                // ACK — 화면에 반영했다(응답 없음).
                frame::write_frame(&mut a, &Frame::Ack(Ack {
                    stream: stream.clone(), session_epoch: 1, lease_epoch: 1, consumed: next_offset,
                })).await.unwrap();
            }
        }
        let consumed = next_offset;

        // ── 연결 A 를 쓰는 동안 출력이 계속 나오게 한 뒤 끊는다(GUI kill 과 같다) ──
        let mut w = lease.clone();
        w["data"] = json!("ping -n 3 127.0.0.1 & echo SS2_AFTER\r\n");
        frame::write_frame(&mut a, &Frame::Request { id: 5, kind: Grade::Write, op: "write".into(), body: w }).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        drop(a);

        // ── 연결 B: 떨어진 세션이 살아 있다 → 붙어 재생받는다 ──
        tokio::time::sleep(Duration::from_millis(3500)).await;
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 7)).await);
        let probe = ok_body(call(&mut b, 2, Grade::Read, "probe", json!({ "stream": stream })).await);
        assert_eq!(probe["state"], "detached", "연결이 끊기면 임대만 풀린다: {probe}");
        assert_eq!(probe["kind"], "local");
        let st = ok_body(call(&mut b, 3, Grade::Read, "status", json!(null)).await);
        assert!(st["sessions"].as_u64().unwrap() >= 1);
        // 옛 임대(연결 A)의 쓰기는 거부.
        let mut stale = lease.clone();
        stale["data"] = json!("x");
        let r = call(&mut b, 4, Grade::Write, "write", stale).await;
        assert!(format!("{r:?}").contains("stale-lease"), "{r:?}");

        // ③-4 — 떨어진 세션 목록에 오르고(마지막 창·셸·떨어진 시각·마지막 출력), 복원이 데려가지 않아도 **닫지 않고** 표시만 한다.
        let rows = ok_body(call(&mut b, 41, Grade::Read, "sessions_detached", json!({})).await);
        let row = rows.as_array().unwrap().iter().find(|r| r["stream"] == stream.as_str()).cloned().expect("떨어진 세션 줄");
        assert_eq!((row["kind"].as_str(), row["home"].as_str(), row["shell"].as_str()), (Some("local"), Some("main"), Some("cmd")));
        assert!(row["detachedAt"].as_u64().is_some() && row["lastOutputAt"].as_u64().is_some(), "{row}");
        assert_eq!(row["unclaimed"], false);
        let done = ok_body(call(&mut b, 42, Grade::Write, "restore_done", json!({ "window": "main", "keep": [] })).await);
        assert_eq!(done, json!({ "closed": 0, "unclaimed": 1 }));
        let probe = ok_body(call(&mut b, 43, Grade::Read, "probe", json!({ "stream": stream })).await);
        assert_eq!(probe["state"], "detached", "release_unclaimed 를 걷었다 — 살아 있다: {probe}");
        let rows = ok_body(call(&mut b, 44, Grade::Read, "sessions_detached", json!({})).await);
        assert!(rows.as_array().unwrap().iter().any(|r| r["stream"] == stream.as_str() && r["unclaimed"] == true));
        // 로컬 "AI 읽기 허용" 은 세션 메타 — probe 가 돌려준다(GUI 재시작 뒤 되살리기).
        assert_eq!(ok_body(call(&mut b, 45, Grade::Write, "session_ai_read", json!({ "stream": stream, "on": true })).await), true);
        assert_eq!(ok_body(call(&mut b, 46, Grade::Read, "probe", json!({ "stream": stream })).await)["aiRead"], true);

        frame::write_frame(&mut b, &Frame::Request {
            id: 5,
            kind: Grade::Write,
            op: "attach".into(),
            body: json!({ "stream": stream, "expectedSessionEpoch": 1, "consumed": consumed, "take": false, "window": "main", "cols": 100, "rows": 30 }),
        }).await.unwrap();
        let mut replay: Vec<u8> = Vec::new();
        let mut first_offset: Option<u64> = None;
        let mut attached: Option<serde_json::Value> = None;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while attached.is_none() || !String::from_utf8_lossy(&replay).contains("SS2_AFTER") {
            match tokio::time::timeout_at(deadline, frame::read_frame(&mut b)).await.expect("재생").unwrap().unwrap() {
                Frame::Output { header, bytes } => {
                    assert_eq!(header.lease_epoch, 2, "새 임대");
                    first_offset.get_or_insert(header.offset);
                    replay.extend_from_slice(&bytes);
                }
                Frame::Response { id: 5, ok, body, .. } => {
                    assert!(ok, "attach 실패: {body:?}");
                    attached = body;
                }
                _ => {}
            }
        }
        let attached = attached.unwrap();
        assert_eq!(first_offset, Some(consumed), "재생은 소비 오프셋부터");
        assert_eq!(attached["start"], consumed);
        assert_eq!(attached["replayed"], true);
        assert_eq!(attached["overrunBytes"], 0);
        assert!(String::from_utf8_lossy(&replay).contains("127.0.0.1"), "끊긴 동안의 출력이 재생된다");

        // 새 임대로 닫는다 — 표에서 빠진다.
        let new_lease = attached["lease"].clone();
        assert_eq!(new_lease["leaseEpoch"], 2);
        let r = call(&mut b, 6, Grade::Write, "close", new_lease).await;
        assert!(matches!(r, Frame::Response { ok: true, .. }), "{r:?}");
        let probe = ok_body(call(&mut b, 7, Grade::Read, "probe", json!({ "stream": stream })).await);
        assert_eq!(probe["state"], "none");

        assert_eq!(ok_body(call(&mut b, 8, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// [`call`] 과 같되 출력 프레임도 건너뛴다(셸이 출력을 내는 동안의 요청).
    async fn call_skip(s: &mut BoxStream, id: u64, kind: Grade, op: &str, body: Value) -> Frame {
        frame::write_frame(s, &Frame::Request { id, kind, op: op.into(), body }).await.unwrap();
        loop {
            match frame::read_frame(s).await.unwrap().expect("응답") {
                f @ Frame::Response { id: rid, .. } if rid == id => return f,
                _ => continue,
            }
        }
    }

    /// 신호 평면에 HTTP 한 줄 — 상태 줄만 돌려준다(블로킹 소켓이라 블로킹 풀에서).
    async fn post_signal(port: u16, token: &str, body: String) -> String {
        let token = token.to_owned();
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let req = format!(
                "POST /agent-signal HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(req.as_bytes()).unwrap();
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf.lines().next().unwrap_or("").to_string()
        })
        .await
        .unwrap()
    }

    /// 이벤트 하나를 기다린다(다른 프레임은 버린다).
    async fn wait_event(s: &mut BoxStream, name: &str, stream: &str) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let f = tokio::time::timeout_at(deadline, frame::read_frame(s)).await.expect("이벤트").unwrap().unwrap();
            if let Frame::Event { name: n, body, .. } = f {
                if n == name && body["stream"] == stream {
                    return body;
                }
            }
        }
    }

    /// **원격 웹 R2-A 통합 — 다중 시청자.** 주(`main`)가 연 셸에 시청자(`remote-dev-1` · 경로 77)가 빼앗지 않고 붙어 ① 주와 **같은
    /// 오프셋 축의 같은 바이트**를 받고(링 재생 → 실시간) ② 시청자의 사람 입력이 셸에 닿고 크기 주인을 그 시청자로 바꾸며(이벤트
    /// `session-size-owner`) ③ 떼고 다시 붙으면 소비 오프셋부터 재생받고 ④ 주가 세션을 닫으면 시청자가 `session-viewer-ended{ended}` 를
    /// 받는다. 판 16 으로 붙은 GUI 에는 시청자 op 를 열지 않는다(`MIN` 은 그대로 — 셸 세션을 잃지 않게).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn viewers_share_a_local_session() {
        let _g = SESSION_STATE.lock().await;
        use super::super::ipc::frame::Ack;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let stream = format!("r2a-viewers-{}", std::process::id());

        // 판 16 GUI — 시청자 op 는 판 불일치.
        let (mut old, _) = connect_retry(&pipe).await;
        ok_body(call(&mut old, 1, Grade::Read, "hello", hello(7, 16)).await);
        let refused = call(&mut old, 2, Grade::Write, "attach_viewer", json!({ "stream": stream, "window": "w", "route": 1 })).await;
        assert_eq!(err_code(refused), code::PROTOCOL_MISMATCH);
        drop(old);

        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 17)).await);
        let spec = json!({ "cols": 100, "rows": 30, "shellId": "cmd", "integration": null, "env": [], "cwd": null });
        let opened = ok_body(
            call(&mut a, 2, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": false })).await,
        );
        let lease = opened["lease"].clone();

        // ── 시청자 붙기 + 시청자의 입력 ──
        let attach_body = |consumed: u64| {
            json!({ "stream": stream, "expectedSessionEpoch": 1, "consumed": consumed, "window": "remote-dev-1", "cols": 80, "rows": 24, "route": 77 })
        };
        frame::write_frame(&mut a, &Frame::Request { id: 3, kind: Grade::Write, op: "attach_viewer".into(), body: attach_body(0) })
            .await
            .unwrap();
        let mut main_buf: Vec<u8> = Vec::new();
        let mut view_buf: Vec<u8> = Vec::new();
        let mut view_start: Option<u64> = None;
        let mut viewer: Option<Value> = None;
        let mut owner_event: Option<Value> = None;
        let mut typed = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let done = owner_event.is_some()
                && String::from_utf8_lossy(&main_buf).matches("R2A_VIEW").count() >= 2
                && String::from_utf8_lossy(&view_buf).matches("R2A_VIEW").count() >= 2;
            if done {
                break;
            }
            let Ok(f) = tokio::time::timeout_at(deadline, frame::read_frame(&mut a)).await else {
                panic!(
                    "시청자 흐름이 끝나지 않음 — 주 {:?} / 시청자 {:?} / 주인 {owner_event:?}",
                    String::from_utf8_lossy(&main_buf),
                    String::from_utf8_lossy(&view_buf)
                );
            };
            match f.unwrap().unwrap() {
                Frame::Output { header, bytes } => {
                    if header.route == Some(77) {
                        let vl = viewer.as_ref().map(|v| v["lease"]["leaseEpoch"].as_u64().unwrap());
                        assert!(vl.is_none_or(|e| e == header.lease_epoch));
                        let start = *view_start.get_or_insert(header.offset);
                        assert_eq!(header.offset, start + view_buf.len() as u64, "시청자 오프셋도 빈틈없이");
                        view_buf.extend_from_slice(&bytes);
                        frame::write_frame(&mut a, &Frame::Ack(Ack {
                            stream: stream.clone(), session_epoch: 1, lease_epoch: header.lease_epoch,
                            consumed: header.offset + bytes.len() as u64,
                        })).await.unwrap();
                    } else {
                        assert_eq!((header.route, header.lease_epoch), (None, 1));
                        assert_eq!(header.offset, main_buf.len() as u64);
                        // 주는 처음엔 크기 주인 — 커서 위치 질의에 답한다(시청자가 주인이 된 뒤에도 이 시험의 셸은 다시 묻지 않는다).
                        if bytes.windows(4).any(|w| w == b"\x1b[6n") && owner_event.is_none() {
                            let mut dsr = lease.clone();
                            dsr["data"] = json!("\u{1b}[30;1R");
                            dsr["source"] = json!("protocol");
                            frame::write_frame(&mut a, &Frame::Request { id: 900, kind: Grade::Write, op: "write".into(), body: dsr }).await.unwrap();
                        }
                        main_buf.extend_from_slice(&bytes);
                        frame::write_frame(&mut a, &Frame::Ack(Ack {
                            stream: stream.clone(), session_epoch: 1, lease_epoch: 1, consumed: main_buf.len() as u64,
                        })).await.unwrap();
                    }
                }
                Frame::Response { id: 3, ok, body, .. } => {
                    assert!(ok, "attach_viewer 실패: {body:?}");
                    let v = body.unwrap();
                    assert_eq!(v["viewer"], true);
                    assert_eq!(v["sizeOwner"], false, "주가 있으면 주가 크기 주인");
                    assert_eq!(v["lease"]["sessionEpoch"], 1);
                    assert_eq!(v["lease"]["leaseEpoch"], 2, "주(1)와 겹치지 않는 열쇠");
                    // 주인(주)의 크기(R2-B) — 주인이 아닌 시청자는 이 크기로 그린다.
                    assert_eq!((v["ownerCols"].as_u64(), v["ownerRows"].as_u64()), (Some(100), Some(30)));
                    viewer = Some(v);
                }
                Frame::Response { id: 4, ok, body, .. } => assert!(ok, "시청자의 쓰기 실패: {body:?}"),
                Frame::Event { name, body, .. } if name == "session-size-owner" && body["stream"] == stream.as_str() => {
                    owner_event = Some(body);
                }
                _ => {}
            }
            // 붙은 뒤 한 번 — 시청자가 친다(사람 입력 — 크기 주인이 그 시청자로).
            if let (Some(v), false) = (&viewer, typed) {
                if String::from_utf8_lossy(&main_buf).contains('>') {
                    typed = true;
                    let mut w = v["lease"].clone();
                    w["data"] = json!("echo R2A_VIEW\r\n");
                    w["source"] = json!("keyboard");
                    frame::write_frame(&mut a, &Frame::Request { id: 4, kind: Grade::Write, op: "write".into(), body: w }).await.unwrap();
                }
            }
        }
        let viewer = viewer.unwrap();
        let owner_event = owner_event.unwrap();
        assert_eq!((owner_event["leaseEpoch"].as_u64(), owner_event["primary"].as_bool()), (Some(2), Some(false)));
        // 새 주인(시청자)이 적어 둔 크기가 실려 온다(R2-B) — 주는 이 크기로 그린다.
        assert_eq!((owner_event["cols"].as_u64(), owner_event["rows"].as_u64()), (Some(80), Some(24)));
        // ① 같은 축의 같은 바이트 — 시청자는 링의 처음(소비 0)부터 재생받아 주와 같은 자리에서 시작한다.
        assert_eq!(view_start, Some(0));
        let n = main_buf.len().min(view_buf.len());
        assert!(n > 0);
        assert_eq!(main_buf[..n], view_buf[..n], "주와 시청자는 같은 순서의 같은 바이트를 받는다");

        // ── ③ 떼고 다시 붙기 — 소비 오프셋부터 재생 ──
        let vlease = viewer["lease"].clone();
        assert_eq!(ok_body(call_skip(&mut a, 5, Grade::Write, "detach_viewer", vlease.clone()).await), true);
        assert_eq!(ok_body(call_skip(&mut a, 6, Grade::Write, "detach_viewer", vlease.clone()).await), false, "멱등");
        let mut stale = vlease.clone();
        stale["data"] = json!("x");
        let r = call_skip(&mut a, 7, Grade::Write, "write", stale).await;
        assert!(format!("{r:?}").contains("stale-lease"), "뗀 시청자의 쓰기는 낡은 열쇠: {r:?}");
        let consumed = view_buf.len() as u64;
        let again = ok_body(call_skip(&mut a, 8, Grade::Write, "attach_viewer", attach_body(consumed)).await);
        // 재생은 소비 오프셋부터(시퀀스 한가운데면 그 시작으로 당긴다 — `TailRing::pull_back`).
        assert!(again["start"].as_u64().unwrap() <= consumed && again["replayed"] == true, "{again}");
        assert_eq!(again["lease"]["leaseEpoch"], 3, "새 열쇠");
        // 시청자의 닫기는 주의 일 — 낡은 열쇠로 거절.
        let r = call_skip(&mut a, 9, Grade::Write, "close", again["lease"].clone()).await;
        assert!(format!("{r:?}").contains("stale-lease"), "{r:?}");

        // ── ④ 주가 닫으면 시청자가 끝을 받는다 ──
        frame::write_frame(&mut a, &Frame::Request { id: 10, kind: Grade::Write, op: "close".into(), body: lease.clone() }).await.unwrap();
        let ended = loop {
            let e = wait_event(&mut a, "session-viewer-ended", &stream).await;
            if e["leaseEpoch"] == 3 {
                break e;
            }
        };
        assert_eq!(ended["reason"], "ended");
        let probe = ok_body(call_skip(&mut a, 11, Grade::Read, "probe", json!({ "stream": stream })).await);
        assert_eq!(probe["state"], "none");

        assert_eq!(ok_body(call_skip(&mut a, 12, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// ③-3a 통합 — 신호 평면이 서버에 산다:
    /// ① `open`(signal) 의 셸 환경 `AYNX_MCP_URL` 이 **이 서버의 신호 포트**이고 신호 토큰이 실렸다 ② 그 URL·토큰으로 POST →
    /// 서버 이벤트 `agent-signal` ③ GUI 연결이 끊겨도(= GUI kill) 같은 토큰이 통하고 새 연결이 이벤트·스냅숏을 받는다 ④ 원격
    /// 타일의 토큰은 **서버 안에서**(SSH 열기 — ③-3b2) 뽑혀 파이프를 타지 않는다: `signal_issue` op 는 없고, 서버의 토큰 표가
    /// 뽑은 토큰은 연결이 끊겨도 산다 ⑤ 세션을 닫으면(서버가 스스로) 로컬 토큰은 401.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn signal_plane_lives_in_the_server_and_survives_client_disconnect() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let stream = format!("ss3a-test-{}", std::process::id());

        // ── 연결 A: 신호 포트 · 열기 · 셸 환경 ──
        let (mut a, _) = connect_retry(&pipe).await;
        let w: Welcome = serde_json::from_value(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await)).unwrap();
        let port = w.signal_port.expect("신호 평면 포트");
        let st = ok_body(call(&mut a, 2, Grade::Read, "status", json!(null)).await);
        assert_eq!(st["signal_port"], port);
        // GUI 가 실수로 신호 몫을 실어 보내도 서버 값이 이긴다.
        let spec = json!({ "cols": 250, "rows": 30, "shellId": "cmd", "integration": null,
            "env": [["AYNX_MCP_URL", "http://127.0.0.1:1"], ["AYNX_SIGNAL_TOKEN", "00"]], "cwd": null });
        let opened = ok_body(
            call(&mut a, 3, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": true })).await,
        );
        let lease = opened["lease"].clone();
        let mut w = lease.clone();
        w["data"] = json!("echo U=%AYNX_MCP_URL%=T=%AYNX_SIGNAL_TOKEN%=S=%AYNX_STREAM%=E\r\n");
        frame::write_frame(&mut a, &Frame::Request { id: 4, kind: Grade::Write, op: "write".into(), body: w }).await.unwrap();
        let want_url = format!("U=http://127.0.0.1:{port}=T=");
        let mut got = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        let token = loop {
            let f = tokio::time::timeout_at(deadline, frame::read_frame(&mut a)).await.expect("셸 출력").unwrap().unwrap();
            if let Frame::Output { bytes, .. } = f {
                if bytes.windows(4).any(|w| w == b"\x1b[6n") {
                    let mut dsr = lease.clone();
                    dsr["data"] = json!("\u{1b}[30;1R");
                    frame::write_frame(&mut a, &Frame::Request { id: 900, kind: Grade::Write, op: "write".into(), body: dsr }).await.unwrap();
                }
                got.push_str(&String::from_utf8_lossy(&bytes));
                // 메아리 줄(`%…%` 그대로)이 아니라 펼쳐진 줄을 찾는다.
                if let Some(i) = got.find(&want_url) {
                    let rest = &got[i + want_url.len()..];
                    if let Some(end) = rest.find("=S=") {
                        let tok = rest[..end].to_string();
                        let tail = &rest[end + 3..];
                        if tail.contains("=E") {
                            assert!(tail.starts_with(&stream), "스트림: {tail:?}");
                            break tok;
                        }
                    }
                }
            }
        };
        assert_eq!(token.len(), 64, "신호 토큰(서버가 뽑음): {token:?}");

        // ── POST → 이벤트(연결 A) ──
        let start = format!(r#"{{"stream":"{stream}","event":"start","cli":"claude"}}"#);
        assert_eq!(post_signal(port, &token, start).await, "HTTP/1.1 204 No Content");
        let ev = wait_event(&mut a, "agent-signal", &stream).await;
        assert_eq!((ev["event"].as_str(), ev["state"].as_str()), (Some("start"), Some("running")));

        // 원격 타일용 토큰 — 이제 파이프로는 뽑을 수 없다(③-3b2). 서버 안의 SSH 열기가 같은 표에서 뽑는다(주인 연결 없음).
        let remote = format!("ss3a-remote-{}", std::process::id());
        assert_eq!(
            err_code(call_skip(&mut a, 5, Grade::Write, "signal_issue", json!({ "stream": remote })).await),
            code::UNKNOWN_OP
        );
        let g = crate::agent_signal::issue(&remote, None).expect("서버 안의 발급");
        let owner = g.owner;
        assert!(crate::agent_signal::note_written(&remote, owner));
        assert_eq!(super::super::hub::signal_port(), Some(port), "원격 -R 이 이어 줄 포트 = 이 서버의 신호 포트");
        drop(a); // GUI kill

        // ── 연결 B: 같은 토큰이 그대로 통하고, 새 연결이 이벤트·스냅숏을 받는다 ──
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call_skip(&mut b, 1, Grade::Read, "hello", hello(7, 7)).await);
        let stop = format!(r#"{{"stream":"{stream}","event":"stop"}}"#);
        assert_eq!(post_signal(port, &token, stop).await, "HTTP/1.1 204 No Content", "GUI 가 죽어도 토큰은 산다");
        let ev = wait_event(&mut b, "agent-signal", &stream).await;
        assert_eq!(ev["state"], "finished");
        let snap = ok_body(call_skip(&mut b, 2, Grade::Read, "agent_states_snapshot", json!(null)).await);
        let row = snap.as_array().unwrap().iter().find(|r| r[0] == stream.as_str()).expect("스냅숏에 그 스트림").clone();
        assert_eq!((row[1]["state"].as_str(), row[1]["cli"].as_str()), (Some("finished"), Some("claude")));
        // ── 완료 확인 공유 — 낡은 seq · 없는 스트림은 방송하지 않고, 지금 seq 면 `agent-seen{stream, seq}` 하나(몸은 그 둘뿐 · 표는 그대로) ──
        let cur = row[1]["seq"].as_u64().expect("seq");
        assert_eq!(ok_body(call_skip(&mut b, 21, Grade::Write, "agent_state_seen", json!({ "stream": stream, "seq": cur - 1 })).await)["sent"], false);
        assert_eq!(ok_body(call_skip(&mut b, 22, Grade::Write, "agent_state_seen", json!({ "stream": "ss3a-no-such", "seq": 1 })).await)["sent"], false);
        assert_eq!(err_code(call_skip(&mut b, 23, Grade::Write, "agent_state_seen", json!({ "stream": "a b", "seq": 1 })).await), code::BAD_BODY);
        assert_eq!(ok_body(call_skip(&mut b, 24, Grade::Write, "agent_state_seen", json!({ "stream": stream, "seq": cur })).await)["sent"], true);
        let seen = wait_event(&mut b, "agent-seen", &stream).await;
        assert_eq!(seen, json!({ "stream": stream, "seq": cur }));
        ok_body(call_skip(&mut b, 3, Grade::Write, "agent_state_forget", json!({ "stream": stream })).await);
        let snap = ok_body(call_skip(&mut b, 4, Grade::Read, "agent_states_snapshot", json!(null)).await);
        assert!(!snap.as_array().unwrap().iter().any(|r| r[0] == stream.as_str()));

        // ── 띄우며 적은 연결(재개 autorun) — 신호 없이 장부에 서고, 그 재개 명령의 `C`(cli-start)가 지우지 않는다 ──
        let convo = "01a16cfe-0000-7000-8000-00000000c0de";
        let launched = json!({ "stream": stream, "agent": "codex", "id": convo });
        assert_eq!(ok_body(call_skip(&mut b, 5, Grade::Write, "agent_conversation_launched", launched).await)["linked"], true);
        ok_body(call_skip(&mut b, 6, Grade::Write, "agent_state_forget", json!({ "stream": stream, "cause": "cli-start" })).await);
        let links = ok_body(call_skip(&mut b, 7, Grade::Read, "agent_conversation_links", json!(null)).await);
        let row = links.as_array().unwrap().iter().find(|r| r["id"] == convo).expect("장부에 그 대화").clone();
        assert_eq!((row["agent"].as_str(), row["streams"].clone()), (Some("codex"), json!([stream])));
        let bad = json!({ "stream": stream, "agent": "bash", "id": convo });
        assert_eq!(err_code(call_skip(&mut b, 8, Grade::Write, "agent_conversation_launched", bad).await), code::BAD_BODY);

        // 원격 토큰 — GUI 연결과 무관하게 산다 → 세션 자원 회수(서버 안)가 거둔다.
        assert!(crate::agent_signal::is_live(&remote));
        assert_eq!(crate::agent_signal::revoke(&remote, owner + 1), None, "남의 주인");
        assert_eq!(crate::agent_signal::revoke(&remote, owner), Some(true));
        assert!(!crate::agent_signal::is_live(&remote));
        // 산 신호 토큰이 없는 스트림에는 적지 않는다(그 회수가 다시 오지 않아 연결이 영영 남을 것이다)
        let dead = json!({ "stream": remote, "agent": "codex", "id": convo });
        assert_eq!(ok_body(call_skip(&mut b, 11, Grade::Write, "agent_conversation_launched", dead).await)["linked"], false);

        // ── 세션을 닫으면 서버가 로컬 토큰을 거둔다 — 띄우며 적은 연결도 놓인다 ──
        ok_body(call_skip(&mut b, 9, Grade::Write, "close_all", json!({})).await);
        let late = format!(r#"{{"stream":"{stream}","event":"tool"}}"#);
        assert_eq!(post_signal(port, &token, late).await, "HTTP/1.1 401 Unauthorized");
        let links = ok_body(call_skip(&mut b, 12, Grade::Read, "agent_conversation_links", json!(null)).await);
        let row = links.as_array().unwrap().iter().find(|r| r["id"] == convo).expect("놓인 줄").clone();
        assert_eq!(row["streams"], json!([]));
        assert!(row["releasedAt"].as_u64().is_some());

        assert_eq!(ok_body(call_skip(&mut b, 10, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// 3차 4단계 통합 — **타일 MCP 토큰은 세션 서버가 `open` 에서 뽑는다**(설계 3-1): ① AI 타일(`mcp`)의 셸 환경에 서버가 뽑은 그 타일만의 토큰이
    /// 실리고(GUI 가 실은 같은 이름은 지워진다 — 전역 토큰이 타일로 새지 않게) op `mcp_tile_token` 의 값과 같다 · 전역 토큰과 다르다 ② 그 토큰으로
    /// `/mcp` 가 통한다(조정자로 묶이지 않았으니 조율은 `not-coordinator`) ③ AI 타일이 아니면 토큰이 없다 ④ 세션을 닫으면(회수) 401 · op 는 null.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn tile_mcp_token_is_issued_by_open_and_revoked_on_close() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let stream = format!("h4-tile-{}", std::process::id());
        let plain = format!("h4-plain-{}", std::process::id());
        let shell = format!("h4-shell-{}", std::process::id());
        let (mut a, _) = connect_retry(&pipe).await;
        let w: Welcome = serde_json::from_value(ok_body(call_skip(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await)).unwrap();
        let port = w.signal_port.expect("한 리스너");
        let global = ok_body(call_skip(&mut a, 2, Grade::Read, "mcp_token", json!({})).await)["token"].as_str().unwrap().to_string();
        let env_name = crate::tile_env::MCP_TOKEN_ENV;
        // GUI 가 (옛 판처럼) 전역 토큰을 실어 보내도 서버가 지우고 타일 토큰을 넣는다.
        let spec = json!({ "cols": 250, "rows": 30, "shellId": "cmd", "integration": null, "env": [[env_name, global]], "cwd": null });
        let opened = ok_body(
            call_skip(&mut a, 3, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": true, "mcp": true })).await,
        );
        let tile = ok_body(call_skip(&mut a, 4, Grade::Read, "mcp_tile_token", json!({ "stream": stream })).await)["token"]
            .as_str()
            .expect("타일 토큰")
            .to_string();
        assert_eq!(tile.len(), 64);
        assert_ne!(tile, global, "타일마다 따로 — 전역 토큰이 아니다");
        // ① 셸 환경의 값이 그 타일 토큰이다.
        let lease = opened["lease"].clone();
        let mut wr = lease.clone();
        wr["data"] = json!(format!("echo K=%{env_name}%=E\r\n"));
        frame::write_frame(&mut a, &Frame::Request { id: 5, kind: Grade::Write, op: "write".into(), body: wr }).await.unwrap();
        let want = format!("K={tile}=E");
        let mut got = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while !got.contains(&want) {
            let f = tokio::time::timeout_at(deadline, frame::read_frame(&mut a)).await.expect("셸 출력").unwrap().unwrap();
            if let Frame::Output { bytes, .. } = f {
                if bytes.windows(4).any(|w| w == b"\x1b[6n") {
                    let mut dsr = lease.clone();
                    dsr["data"] = json!("\u{1b}[30;1R");
                    frame::write_frame(&mut a, &Frame::Request { id: 900, kind: Grade::Write, op: "write".into(), body: dsr }).await.unwrap();
                }
                got.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        assert!(!got.contains(&format!("K={global}=E")), "GUI 가 실은 전역 토큰은 셸에 없다");
        // ② `/mcp` — 타일 토큰이 통한다(전역과 같은 목록 · 조율 도구 없음 — 불러도 모르는 도구).
        let (st, body) = post_mcp(port, &tile, json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}).to_string()).await;
        // (오케스트레이션 탭 2단계 6절) 이 PC 에 맡긴 저장소가 있든 없든(진짜 `delegation.toml`) 타일 목록에는 조율 도구가 없다.
        assert!(st.starts_with("HTTP/1.1 200") && body.contains("list_sessions") && !body.contains("wait_run"), "{st} {body}");
        let get_run = json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_run","arguments":{}}}).to_string();
        let (_, body) = post_mcp(port, &tile, get_run.clone()).await;
        assert!(body.contains("Unknown tool: get_run"), "{body}");
        let (_, body) = post_mcp(port, &global, get_run).await;
        assert!(body.contains("not-a-tile"), "전역 토큰은 조율을 못 한다: {body}");
        // ③ AI 타일이 아니면 토큰이 없다.
        let spec2 = json!({ "cols": 80, "rows": 24, "shellId": "cmd", "integration": null, "env": [], "cwd": null });
        let opened2 = ok_body(
            call_skip(&mut a, 6, Grade::Write, "open", json!({ "stream": plain, "window": "main", "spec": spec2, "signal": true })).await,
        );
        assert_eq!(ok_body(call_skip(&mut a, 7, Grade::Read, "mcp_tile_token", json!({ "stream": plain })).await)["token"], Value::Null);
        // ③-2 (10-23) AI 타일에는 AI 읽기 허용이 없다 — 켬을 보내도 세션 메타는 끔이고(probe `aiRead`), 평범한 셸은 그대로 켜진다.
        assert!(crate::tile_token::is_ai_tile(&stream) && !crate::tile_token::is_ai_tile(&plain));
        for (i, s) in [&stream, &plain].into_iter().enumerate() {
            ok_body(call_skip(&mut a, 20 + i as u64, Grade::Write, "session_ai_read", json!({ "stream": s, "on": true })).await);
        }
        assert_eq!(ok_body(call_skip(&mut a, 22, Grade::Read, "probe", json!({ "stream": stream })).await)["aiRead"], false);
        assert_eq!(ok_body(call_skip(&mut a, 23, Grade::Read, "probe", json!({ "stream": plain })).await)["aiRead"], true);
        // ③-3 (2026-10-26) 감싸개가 있는 로컬 셸 타일(`mcp` · `ai:false`)은 토큰을 받지만 AI 타일이 아니다 — AI 읽기 허용은 사람이 켠 대로.
        let spec3 = json!({ "cols": 80, "rows": 24, "shellId": "cmd", "integration": null, "env": [], "cwd": null });
        let opened3 = ok_body(
            call_skip(&mut a, 30, Grade::Write, "open", json!({ "stream": shell, "window": "main", "spec": spec3, "signal": true, "mcp": true, "ai": false }))
                .await,
        );
        let shell_tok = ok_body(call_skip(&mut a, 31, Grade::Read, "mcp_tile_token", json!({ "stream": shell })).await)["token"].clone();
        assert!(shell_tok.as_str().is_some_and(|t| t.len() == 64 && t != tile), "셸 타일도 제 토큰: {shell_tok}");
        assert!(!crate::tile_token::is_ai_tile(&shell));
        ok_body(call_skip(&mut a, 32, Grade::Write, "session_ai_read", json!({ "stream": shell, "on": true })).await);
        assert_eq!(ok_body(call_skip(&mut a, 33, Grade::Read, "probe", json!({ "stream": shell })).await)["aiRead"], true);
        ok_body(call_skip(&mut a, 34, Grade::Write, "close", opened3["lease"].clone()).await);
        // ④ 닫으면(서버 회수) 그 토큰은 401 · op 는 null.
        ok_body(call_skip(&mut a, 8, Grade::Write, "close", lease).await);
        ok_body(call_skip(&mut a, 9, Grade::Write, "close", opened2["lease"].clone()).await);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let (st, _) = post_mcp(port, &tile, json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}).to_string()).await;
            if st.starts_with("HTTP/1.1 401") {
                break;
            }
            assert!(tokio::time::Instant::now() < deadline, "닫은 타일의 토큰이 아직 통한다: {st}");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(ok_body(call_skip(&mut a, 10, Grade::Read, "mcp_tile_token", json!({ "stream": stream })).await)["token"], Value::Null);
        assert_eq!(ok_body(call_skip(&mut a, 11, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// 쿼리 타일 3단계 3a — **원격 타일의 신호 전용 토큰으로는 DB 도구에 닿지 않는다**: 같은 포트의 `/mcp` 는 MCP 토큰만 받는다
    /// (`tools/list` · DB 도구 호출 모두 401 — 원격 타일에는 MCP 토큰을 주지 않으니 원격 타일의 AI 는 DB 도구를 볼 수도 부를 수도 없다).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn remote_signal_token_cannot_reach_db_tools() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call_skip(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await);
        let coords = ok_body(call_skip(&mut a, 2, Grade::Read, "mcp_coords", json!({})).await);
        let port = coords["port"].as_u64().unwrap() as u16;
        let remote = format!("ai-db-remote-{}", std::process::id());
        let g = crate::agent_signal::issue(&remote, None).expect("서버 안의 발급");
        assert_eq!(g.token.len(), 64);
        for (name, args) in [
            ("list_db_connections", json!({})),
            ("db_list_schemas", json!({ "connId": "Any_conn0001" })),
            ("db_query", json!({ "connId": "Any_conn0001", "sql": "SELECT 1" })),
        ] {
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
            let (st, text) = post_mcp(port, &g.token, body.to_string()).await;
            assert!(st.starts_with("HTTP/1.1 401"), "{name}: {st} {text}");
        }
        let (st, _) = post_mcp(port, &g.token, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string()).await;
        assert!(st.starts_with("HTTP/1.1 401"), "{st}");
        assert_eq!(crate::agent_signal::revoke(&remote, g.owner), Some(false));
        assert_eq!(ok_body(call_skip(&mut a, 3, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// 인증 헤더를 보는 상류 MCP — `Authorization: Bearer <want>` 면 200, 아니면 401. 요청 `n` 개를 받고 끝난다.
    fn upstream(want: &'static str, n: usize) -> (u16, std::thread::JoinHandle<()>) {
        let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let worker = std::thread::spawn(move || {
            for _ in 0..n {
                let Ok(Some(req)) = server.recv_timeout(Duration::from_secs(20)) else { return };
                let auth = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Authorization"))
                    .map(|h| h.value.as_str().to_owned());
                let ok = auth.as_deref() == Some(want);
                let _ = req.respond(
                    tiny_http::Response::from_string(if ok { "auth=ok" } else { "auth=bad" })
                        .with_status_code(if ok { 200 } else { 401 }),
                );
            }
        });
        (port, worker)
    }

    /// 프록시 URL 에 POST 한 번 — (상태, 몸).
    async fn post(url: &str, auth: Option<&str>) -> (u16, String) {
        let mut req = reqwest::Client::new().post(url).header("Content-Type", "application/json").body("{}");
        if let Some(a) = auth {
            req = req.header("Authorization", a);
        }
        let r = req.send().await.unwrap();
        let status = r.status().as_u16();
        (status, r.text().await.unwrap_or_default())
    }

    /// 요청 하나를 보내고 응답을 받되, 응답 JSON 을 `seen` 에 모은다(값이 실리지 않아야 하는 응답).
    async fn ask(s: &mut BoxStream, id: &mut u64, seen: &mut Vec<String>, kind: Grade, op: &str, body: Value) -> Frame {
        *id += 1;
        let f = call(s, *id, kind, op, body).await;
        seen.push(serde_json::to_string(&f).unwrap());
        f
    }

    /// ③-3b1 통합 — 볼트 평면이 서버에 산다:
    /// ① create → store(비밀번호·암호구·MCP 값) → has · list ② 헤더 프록시 티켓: 200(클라이언트 Authorization 무시) · 다른
    /// 티켓·경로 꼬리·쿼리 404 · PUT 405 → `windows_zero` 잠금 = 503(짧은 이유) → 그 위 가림막이 와도 정지 유지 → 해제 =
    /// **같은 URL 200** ③ 가림막(shade) = 폐기 → 404, 해제해도 404, 새 준비 = 새 URL 200 ④ stdio 준비(`mcp-run <브로커 포트>
    /// <티켓>`)·`mcp_retain` 회수 ⑤ 과도기 op 만 값을 준다 ⑥ 그 밖의 **모든 응답·서버 로그에 비밀이 없다** ⑦ 클라이언트 0 =
    /// 서버가 스스로 창 0개 잠금(relock) → 다음 연결이 풀면 같은 URL 200.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn vault_plane_lives_in_the_server_with_reason_based_ticket_policy() {
        // 서버 안의 전역(`pty::set_events` · `server::hub`)은 마지막에 뜬 서버의 것 — 서버를 띄우는 시험은 한 줄로 선다.
        let _g = SESSION_STATE.lock().await;
        const PW: &str = "pw-SECRET-3b1-host";
        const PP: &str = "pp-SECRET-3b1-key";
        const DB: &str = "db-SECRET-3b1-conn";
        const TOKEN: &str = "Bearer hdr-SECRET-3b1-token";
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await);
        let mut seen: Vec<String> = Vec::new();
        let mut id = 10u64;
        let (i, sn) = (&mut id, &mut seen);

        let st = ok_body(ask(&mut a, i, sn, Grade::Read, "vault_status", json!({})).await);
        assert_eq!(st["state"], "absent");
        ok_body(ask(&mut a, i, sn, Grade::Write, "vault_create", json!({ "master": null, "lang": "en" })).await);
        for (kind, target, value) in [("host_password", "web-01", PW), ("key_passphrase", "C:/keys/id", PP), ("db_password", "Xk3_pg-main01", DB)] {
            ok_body(ask(&mut a, i, sn, Grade::Write, "vault_store", json!({ "kind": kind, "target": target, "value": value })).await);
        }
        let r = ask(&mut a, i, sn, Grade::Write, "vault_store",
            json!({ "kind": "mcp_env", "target": "global/remote/header:Authorization", "value": TOKEN })).await;
        let reference = ok_body(r).as_str().unwrap().to_owned();
        assert!(reference.starts_with("global/remote/header:Authorization:"));
        assert_eq!(ok_body(ask(&mut a, i, sn, Grade::Read, "vault_has", json!({ "kind": "host_password", "target": "web-01" })).await), true);
        assert_eq!(ok_body(ask(&mut a, i, sn, Grade::Read, "vault_has", json!({ "kind": "db_password", "target": "Xk3_pg-main01" })).await), true);
        let listed = ok_body(ask(&mut a, i, sn, Grade::Read, "vault_list", json!({})).await);
        assert_eq!(listed.as_array().unwrap().len(), 4);
        assert!(listed.as_array().unwrap().contains(&json!({ "kind": "db_password", "target": "Xk3_pg-main01" })), "{listed}");
        // DB 연결 id 모양이 아닌 대상(호스트 별칭 등)은 거절한다.
        let r = ask(&mut a, i, sn, Grade::Write, "vault_store", json!({ "kind": "db_password", "target": "web-01", "value": DB })).await;
        assert_eq!(err_code(r), super::super::vault_ops::VAULT);
        // 값 자리에 다른 자료형이 와도 serde 문구가 몸을 되풀이하지 않는다.
        let r = ask(&mut a, i, sn, Grade::Write, "vault_store", json!({ "kind": "host_password", "target": "web-02", "value": [PW] })).await;
        assert_eq!(err_code(r), code::BAD_BODY);

        // ── 헤더 프록시 ──
        let (up, upstream_worker) = upstream(TOKEN, 5);
        let http = json!({ "name": "remote", "enabled": true, "transport": "http", "url": format!("http://127.0.0.1:{up}/mcp"),
            "headers": [{ "name": "Authorization", "secret_ref": reference }] });
        let prepared = ok_body(ask(&mut a, i, sn, Grade::Write, "mcp_prepare", json!({ "server": http, "cwd": null })).await);
        assert!(prepared.get("headers").is_none(), "헤더 이름·참조가 실행 모양에 없다: {prepared}");
        let url = prepared["url"].as_str().unwrap().to_owned();
        assert!(url.starts_with("http://127.0.0.1:") && url.contains("/mcp-proxy/"));
        // 클라이언트가 보낸 Authorization 은 무시하고 볼트 값이 붙는다.
        assert_eq!(post(&url, Some("Bearer wrong")).await, (200, "auth=ok".into()));
        // 다른 티켓·경로 꼬리·쿼리 → 404, PUT → 405.
        let base = url.rsplit_once('/').unwrap().0.to_owned();
        assert_eq!(post(&format!("{base}/{}", "0".repeat(64)), None).await.0, 404);
        assert_eq!(post(&format!("{url}/x"), None).await.0, 404);
        assert_eq!(post(&format!("{url}?a=1"), None).await.0, 404);
        assert_eq!(reqwest::Client::new().put(&url).send().await.unwrap().status().as_u16(), 405);

        // 창 0개 잠금 → 정지(503 + 짧은 이유).
        let r = ok_body(ask(&mut a, i, sn, Grade::Write, "vault_lock", json!({ "reason": "windows_zero" })).await);
        assert_eq!(r, json!({ "reason": "windows_zero", "revoked": 0 }));
        let (status, body) = post(&url, None).await;
        assert_eq!(status, 503);
        assert!(body.contains("vault locked"), "{body}");
        let st = ok_body(ask(&mut a, i, sn, Grade::Read, "vault_status", json!({})).await);
        assert_eq!(
            (st["state"].as_str(), st["lockReason"].as_str(), st["relock"].as_bool()),
            (Some("locked"), Some("windows_zero"), Some(true))
        );
        // 그 위에 가림막이 와도(다음 GUI 의 관문) 정지가 폐기로 바뀌지 않는다.
        let r = ok_body(ask(&mut a, i, sn, Grade::Write, "vault_lock", json!({ "reason": "shade" })).await);
        assert_eq!(r, json!({ "reason": "windows_zero", "revoked": 0 }));
        // 해제 → 같은 URL 이 되산다.
        ok_body(ask(&mut a, i, sn, Grade::Write, "vault_unlock", json!({ "master": null })).await);
        assert_eq!(post(&url, None).await, (200, "auth=ok".into()));
        let st = ok_body(ask(&mut a, i, sn, Grade::Read, "vault_status", json!({})).await);
        assert_eq!((st["state"].as_str(), st["relock"].as_bool()), (Some("unlocked"), Some(false)));
        assert!(st.get("lockReason").is_none());

        // 가림막 → 폐기(404), 해제해도 404, 새 준비 = 새 URL.
        let r = ok_body(ask(&mut a, i, sn, Grade::Write, "vault_lock", json!({ "reason": "shade" })).await);
        assert_eq!(r, json!({ "reason": "shade", "revoked": 1 }));
        assert_eq!(post(&url, None).await.0, 404);
        ok_body(ask(&mut a, i, sn, Grade::Write, "vault_unlock", json!({ "master": null })).await);
        assert_eq!(post(&url, None).await.0, 404, "가림막이 폐기한 티켓은 되살지 않는다");
        let again = ok_body(ask(&mut a, i, sn, Grade::Write, "mcp_prepare", json!({ "server": http, "cwd": null })).await);
        let url2 = again["url"].as_str().unwrap().to_owned();
        assert_ne!(url2, url);
        assert_eq!(post(&url2, None).await, (200, "auth=ok".into()));

        // ── stdio 준비 · 회수 ──
        let stdio = json!({ "name": "pg", "enabled": true, "transport": "stdio", "command": "npx",
            "env": [{ "name": "DATABASE_URL", "secret_ref": reference }] });
        let p = ok_body(ask(&mut a, i, sn, Grade::Write, "mcp_prepare", json!({ "server": stdio, "cwd": "C:/work" })).await);
        let st = ok_body(ask(&mut a, i, sn, Grade::Read, "status", json!(null)).await);
        assert_eq!(p["args"][0], "mcp-run");
        assert_eq!(p["args"][1], st["mcp"]["broker_port"].to_string(), "도우미는 인자로 서버의 브로커 포트를 안다");
        assert!(p.get("env").is_none());
        assert_eq!((st["mcp"]["stdio_tickets"].as_u64(), st["mcp"]["http_tickets"].as_u64()), (Some(1), Some(1)));
        ok_body(ask(&mut a, i, sn, Grade::Write, "mcp_retain", json!({ "servers": [http] })).await);
        let st = ok_body(ask(&mut a, i, sn, Grade::Read, "status", json!(null)).await);
        assert_eq!((st["mcp"]["stdio_tickets"].as_u64(), st["mcp"]["http_tickets"].as_u64()), (Some(0), Some(1)));
        // 정리 — 살아 있는 티켓이 쓰는 참조는 저장된 설정에 없어도 남는다.
        ok_body(ask(&mut a, i, sn, Grade::Write, "vault_prune", json!({ "saved": [] })).await);
        assert_eq!(ok_body(ask(&mut a, i, sn, Grade::Read, "vault_has", json!({ "kind": "mcp_env", "target": reference })).await), true);

        // ── 응답·로그에 비밀 없음(여기까지 모은 것) ──
        for text in sn.iter() {
            for secret in [PW, PP, DB, "hdr-SECRET"] {
                assert!(!text.contains(secret), "응답에 비밀: {text}");
            }
        }

        // ── 값이 나가는 op 는 없다(③-3b2 — 과도기 op 삭제). SSH 인증은 같은 프로세스에서 금고를 직접 읽는다(`hub::vault`). ──
        assert_eq!(
            err_code(call(&mut a, 90, Grade::Write, "vault_credential_transitional",
                json!({ "alias": "web-01", "paths": ["C:/keys/id"] })).await),
            code::UNKNOWN_OP
        );
        let hv = super::super::hub::vault().expect("서버의 금고");
        assert_eq!(hv.password_for("web-01").as_deref().map(String::as_str), Some(PW));
        assert_eq!(hv.passphrase_for("C:/keys/id").as_deref().map(String::as_str), Some(PP));
        assert!(hv.passphrase_for("C:/keys/none").is_none());
        assert_eq!(hv.db_password_for("Xk3_pg-main01").as_deref().map(String::as_str), Some(DB));
        for line in super::super::log::CAPTURED.lock().unwrap().iter() {
            for secret in [PW, PP, DB, "hdr-SECRET"] {
                assert!(!line.contains(secret), "로그에 비밀: {line}");
            }
        }

        // ── 클라이언트 0 = 서버가 스스로 창 0개 잠금 ──
        drop(a);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (status, body) = post(&url2, None).await;
        assert_eq!(status, 503, "{body}");
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 7)).await);
        let st = ok_body(call(&mut b, 2, Grade::Read, "vault_status", json!({})).await);
        assert_eq!(
            (st["state"].as_str(), st["lockReason"].as_str(), st["relock"].as_bool()),
            (Some("locked"), Some("windows_zero"), Some(true))
        );
        ok_body(call(&mut b, 3, Grade::Write, "vault_unlock", json!({ "master": null })).await);
        assert_eq!(post(&url2, None).await, (200, "auth=ok".into()));

        assert_eq!(ok_body(call(&mut b, 4, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        let _ = upstream_worker.join();
    }

    /// ③-3b2 — SSH 평면 op 를 **SSH 서버 없이** 파이프 너머에서 본다: 몸을 못 푼 `open_ssh` 는 고정 문구(비밀번호를 되풀이하지
    /// 않는다) · 없는 세션의 `ssh_exec`·`ssh_info`·`chan_open` 은 실패(세션 없음) · `chan_open` 은 `sftp` 만 · 없는 세션의
    /// `ssh_alias` 는 null · 포워드 검사는 서버에서(포트 0 거절) · 위임되지 않은 별칭의 `headless_open` 은 `ssh-open` 실패 ·
    /// 서버 로그에 비밀번호·명령 글자가 없다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ssh_plane_ops_answer_without_an_ssh_server() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let server = tokio::spawn(serve::run(config(&pipe, None, vec![own], Duration::from_secs(60))));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await);
        const PW: &str = "pw-NEVER-IN-LOGS-77";
        const CMD: &str = "echo cmd-NEVER-IN-LOGS-88";

        // 몸을 못 풀면 serde 문구 대신 고정 문구(비밀번호가 실린 몸이다).
        let bad = call(&mut a, 2, Grade::Write, "open_ssh", json!({ "alias": 3, "password": PW })).await;
        match &bad {
            Frame::Response { ok: false, error: Some(e), .. } => {
                assert_eq!(e.code, code::BAD_BODY);
                assert!(!e.message.contains(PW), "{e:?}");
            }
            other => panic!("{other:?}"),
        }
        // 없는 세션.
        let gone = 4_000_000_000u32;
        assert_eq!(
            err_code(call(&mut a, 3, Grade::Write, "ssh_exec",
                json!({ "session": gone, "command": CMD, "timeoutMs": 1000 })).await),
            code::SESSION
        );
        assert_eq!(err_code(call(&mut a, 4, Grade::Read, "ssh_info", json!({ "id": gone })).await), code::SESSION);
        assert_eq!(
            err_code(call(&mut a, 5, Grade::Write, "chan_open", json!({ "session": gone, "subsystem": "sftp" })).await),
            code::SESSION
        );
        assert_eq!(
            err_code(call(&mut a, 6, Grade::Write, "chan_open", json!({ "session": gone, "subsystem": "exec" })).await),
            code::BAD_BODY,
            "sftp 말고는 터널로 열 수 없다"
        );
        assert_eq!(ok_body(call(&mut a, 7, Grade::Read, "ssh_alias", json!({ "session": gone })).await), Value::Null);
        assert_eq!(ok_body(call(&mut a, 8, Grade::Read, "forward_list", json!({ "sessionId": gone })).await), json!([]));
        // 포워드 검사는 서버에서 — 포트 0 은 바인드 전에 거절.
        assert_eq!(
            err_code(call(&mut a, 9, Grade::Write, "forward_add",
                json!({ "sessionId": gone, "localPort": 0, "remoteHost": "localhost", "remotePort": 5432 })).await),
            code::SESSION
        );
        // 위임되지 않은 별칭 — 헤드리스 관문이 서버에서 거절(실패 모양은 `SshOpenError` JSON).
        match call(&mut a, 10, Grade::Write, "headless_open", json!({ "alias": "ss3b2-not-delegated-host" })).await {
            Frame::Response { ok: false, error: Some(e), .. } => {
                assert_eq!(e.code, super::super::sessions::SSH_OPEN);
                let err: crate::ssh::SshOpenError = serde_json::from_str(&e.message).expect("SshOpenError JSON");
                assert!(matches!(err, crate::ssh::SshOpenError::Other { .. }), "{err:?}");
            }
            other => panic!("{other:?}"),
        }
        // 워크트리 답 — 기다리는 질문이 없으면 false, 모르는 답은 거절.
        assert_eq!(
            ok_body(call(&mut a, 11, Grade::Write, "worktree_answer",
                json!({ "ticket": "t-none", "answer": "commit", "window": "main" })).await),
            json!(false)
        );
        assert_eq!(
            err_code(call(&mut a, 12, Grade::Write, "worktree_answer",
                json!({ "ticket": "t-none", "answer": "rm -rf", "window": "main" })).await),
            code::SESSION
        );
        // 승인 등급은 SSH op 에도 늘 거부.
        assert_eq!(
            err_code(call(&mut a, 13, Grade::Approve, "ssh_exec", json!({})).await),
            code::APPROVE_REFUSED
        );
        for line in super::super::log::CAPTURED.lock().unwrap().iter() {
            assert!(!line.contains(PW) && !line.contains(CMD), "로그에 비밀·명령: {line}");
        }
        assert_eq!(ok_body(call(&mut a, 14, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
    }

    /// MCP 에 HTTP 한 줄(JSON-RPC 몸) — `(상태 줄, 본문)`. 블로킹 소켓이라 블로킹 풀에서.
    pub(in crate::server) async fn post_mcp(port: u16, token: &str, body: String) -> (String, String) {
        let token = token.to_owned();
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
            let req = format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(req.as_bytes()).unwrap();
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            let status = buf.lines().next().unwrap_or("").to_string();
            let body = buf.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
            (status, body)
        })
        .await
        .unwrap()
    }

    /// MCP `tools/call` 의 결과 텍스트(JSON) — 실패면 패닉.
    async fn mcp_tool(port: u16, token: &str, name: &str, args: Value) -> Value {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
        let (status, text) = post_mcp(port, token, body.to_string()).await;
        assert!(status.starts_with("HTTP/1.1 200"), "{status} {text}");
        let v: Value = serde_json::from_str(&text).unwrap();
        let inner = v["result"]["content"][0]["text"].as_str().expect("도구 결과").to_string();
        serde_json::from_str(&inner).unwrap_or(Value::String(inner))
    }

    /// ③-3c 통합 — AI 평면이 서버에 산다:
    /// ① `mcp_coords`·`mcp_token` = 신호 평면과 **같은 포트** · `mcp.json` 은 서버가 쓴다(포트·토큰이 같다) · 신호 경로에 MCP 토큰은
    /// 401 ② 거울 묶음(`ctx_batch`)으로 보고한 로컬 세션이 MCP `list_sessions` 에 `attached: true`(서버 코어의 칸) ③ **GUI 연결이
    /// 끊겨도**(= GUI kill) 같은 포트·토큰으로 `list_sessions`·`get_session_snapshot` 성공, `attached: false`·`stale: true`·
    /// `state: detached` ④ 작업안 — `ops_approve` 를 쓰기 등급으로 보내면 `grade-mismatch`, 자동 승인(정책 밖)은 서버가 거부,
    /// 사람 승인(승인 등급)은 받아 실행기가 돌고(권한 재검사로 실패 기록) 결과를 `ops_results`·MCP `get_operation_results` 로
    /// 읽는다 ⑤ 승인 등급으로 다른 op 는 `approve-refused` ⑥ 진행 중 작업안 수가 `status.ai` 에 실린다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ai_plane_lives_in_the_server_and_survives_client_disconnect() {
        let _g = SESSION_STATE.lock().await;
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        let mcp_json = cfg.mcp_json.clone().unwrap();
        let server = tokio::spawn(serve::run(cfg));
        let stream = format!("ss3c-test-{}", std::process::id());

        // ── ① 좌표 · 토큰 · mcp.json ──
        let (mut a, _) = connect_retry(&pipe).await;
        let w: Welcome = serde_json::from_value(ok_body(call_skip(&mut a, 1, Grade::Read, "hello", hello(7, 7)).await)).unwrap();
        let coords = ok_body(call_skip(&mut a, 2, Grade::Read, "mcp_coords", json!({})).await);
        assert_eq!(coords["running"], true);
        let port = coords["port"].as_u64().unwrap() as u16;
        assert_eq!(Some(port), w.signal_port, "MCP 와 신호 평면은 한 리스너");
        assert_eq!(coords["url"], format!("http://127.0.0.1:{port}/mcp"));
        let token = ok_body(call_skip(&mut a, 3, Grade::Read, "mcp_token", json!({})).await)["token"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(token.len(), 64);
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&mcp_json).expect("서버가 쓴 mcp.json")).unwrap();
        assert_eq!((saved["port"].as_u64(), saved["token"].as_str()), (Some(port as u64), Some(token.as_str())));
        assert_eq!(err_code(call_skip(&mut a, 4, Grade::Write, "mcp_token", json!({})).await), code::GRADE_MISMATCH);
        let sig = format!(r#"{{"stream":"{stream}","event":"stop"}}"#);
        assert_eq!(post_signal(port, &token, sig).await, "HTTP/1.1 401 Unauthorized", "신호 경로는 MCP 토큰을 받지 않는다");
        let (st, _) = post_mcp(port, "nope", json!({"jsonrpc":"2.0","id":1,"method":"initialize"}).to_string()).await;
        assert!(st.starts_with("HTTP/1.1 401"), "{st}");

        // ── ② 열기 + 거울 보고 → MCP list_sessions 의 attached ──
        let spec = json!({ "cols": 100, "rows": 30, "shellId": "cmd", "integration": null, "env": [], "cwd": null });
        ok_body(
            call_skip(&mut a, 5, Grade::Write, "open", json!({ "stream": stream, "window": "main", "spec": spec, "signal": false })).await,
        );
        let now = super::super::serve::now_ms();
        let batch = json!({ "ops": [
            { "at": now, "op": "report", "key": stream, "label": "cmd", "kind": "local", "code": "p1", "optedIn": true, "owner": "main" },
            { "at": now, "op": "update", "key": stream, "status": "ok", "last": null, "scrollbackTail": ["ss3c-line-1", "ss3c-line-2"] },
        ]});
        assert_eq!(ok_body(call_skip(&mut a, 6, Grade::Write, "ctx_batch", batch).await), json!([null, null]));
        let list = mcp_tool(port, &token, "list_sessions", json!({})).await;
        let row = list.as_array().unwrap().iter().find(|r| r["id"] == stream.as_str()).expect("목록에 그 세션").clone();
        assert_eq!((row["attached"].as_bool(), row["state"].as_str(), row["stale"].as_bool()), (Some(true), Some("attached"), Some(false)));
        assert!(row["sessionEpoch"].as_u64().unwrap() >= 1);
        let console = ok_body(call_skip(&mut a, 7, Grade::Read, "console_sessions", json!({})).await);
        assert!(console.as_array().unwrap().iter().any(|r| r["id"] == stream.as_str()), "관제판도 같은 목록");
        drop(a); // GUI kill

        // ── ③ GUI 없이도 같은 포트·토큰으로 읽힌다 — 떨어진 세션의 거울은 남고 stale ──
        tokio::time::sleep(Duration::from_millis(300)).await;
        let list = mcp_tool(port, &token, "list_sessions", json!({})).await;
        let row = list.as_array().unwrap().iter().find(|r| r["id"] == stream.as_str()).expect("GUI 가 죽어도 거울은 남는다").clone();
        assert_eq!((row["attached"].as_bool(), row["state"].as_str(), row["stale"].as_bool()), (Some(false), Some("detached"), Some(true)));
        let snap = mcp_tool(port, &token, "get_session_snapshot", json!({ "session": stream })).await;
        assert_eq!((snap["status"].as_str(), snap["scrollbackLines"].as_u64()), (Some("ok"), Some(2)), "{snap}");
        let back = mcp_tool(port, &token, "get_scrollback", json!({ "session": stream })).await;
        assert_eq!(back["lines"], json!(["ss3c-line-1", "ss3c-line-2"]));

        // ── ④ 작업안 — 승인 등급 · 서버 재검사 · 실행 · 결과 ──
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call_skip(&mut b, 1, Grade::Read, "hello", hello(7, 7)).await);
        let plane = super::super::hub::ai().expect("AI 평면");
        let target = "ss3c-not-delegated-target".to_string();
        let op_id = format!("ss3c-op-{}", std::process::id());
        {
            let mut m = plane.ops.ops.lock().unwrap();
            crate::operations::create_plan(
                &mut m, op_id.clone(), "rm -rf /tmp/x".into(), vec![target.clone()], None, None,
                "adhoc".into(), "rolling".into(), 1, 5, None, None, crate::operations::now_ms(), None,
            );
            crate::operations::request(&mut m, &op_id, crate::operations::now_ms(), 0).unwrap();
        }
        let body = json!({ "operationId": op_id, "approvalMethod": "manual" });
        assert_eq!(err_code(call_skip(&mut b, 2, Grade::Write, "ops_approve", body.clone()).await), code::GRADE_MISMATCH);
        assert_eq!(err_code(call_skip(&mut b, 3, Grade::Read, "ops_approve", body.clone()).await), code::GRADE_MISMATCH);
        // 자동 승인 — 정책(위험 명령 · 꺼진 자동 승인 · 위임 없음)을 서버가 다시 본다 → 거부, 상태 그대로.
        let auto = json!({ "operationId": op_id, "approvalMethod": "auto" });
        assert_eq!(err_code(call_skip(&mut b, 4, Grade::Approve, "ops_approve", auto).await), code::SESSION);
        let list = ok_body(call_skip(&mut b, 5, Grade::Read, "ops_list", json!({})).await);
        assert!(list["pending"].as_array().unwrap().iter().any(|o| o["operationId"] == op_id.as_str()), "거부된 자동 승인은 대기 그대로");
        // 승인 등급으로 다른 op 는 거부.
        assert_eq!(err_code(call_skip(&mut b, 6, Grade::Approve, "ops_cancel", json!({ "operationId": op_id })).await), code::APPROVE_REFUSED);
        // 사람 승인 — 받아들이고 실행기가 돈다(이 대상은 위임이 없어 실행 직전 재검사에서 실패로 끝난다).
        let approved = ok_body(call_skip(&mut b, 7, Grade::Approve, "ops_approve", body).await);
        assert_eq!(approved["approvalMethod"], "manual");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let finished = loop {
            let list = ok_body(call_skip(&mut b, 8, Grade::Read, "ops_list", json!({})).await);
            if let Some(o) = list["recent"].as_array().unwrap().iter().find(|o| o["operationId"] == op_id.as_str()) {
                if o["state"] == "failed" {
                    break o.clone();
                }
            }
            assert!(tokio::time::Instant::now() < deadline, "실행이 끝나지 않음");
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        assert_eq!(finished["state"], "failed");
        let results = ok_body(call_skip(&mut b, 9, Grade::Read, "ops_results", json!({ "operationId": op_id })).await);
        assert_eq!(results[target.as_str()]["state"], "failed");
        let ai_results = mcp_tool(port, &token, "get_operation_results", json!({ "operationId": op_id })).await;
        assert_eq!(ai_results["results"][0]["state"], "failed");
        assert_eq!(ai_results["results"][0]["redacted"], true, "거울에 없는 대상의 출력은 AI 에게 가린다");
        let st = ok_body(call_skip(&mut b, 10, Grade::Read, "status", json!(null)).await);
        assert_eq!(st["ai"]["mcp_port"], port);
        assert_eq!(st["ai"]["plans_in_progress"], 0);

        // ── 닫기 — 세션 자원 회수 뒤 거울은 프런트의 drop 으로 사라진다 ──
        ok_body(call_skip(&mut b, 11, Grade::Write, "close_all", json!({})).await);
        let now = super::super::serve::now_ms();
        ok_body(call_skip(&mut b, 12, Grade::Write, "ctx_batch", json!({ "ops": [{ "at": now, "op": "drop", "key": stream }] })).await);
        let list = mcp_tool(port, &token, "list_sessions", json!({})).await;
        assert!(!list.as_array().unwrap().iter().any(|r| r["id"] == stream.as_str()));
        assert_eq!(ok_body(call_skip(&mut b, 13, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        let _ = std::fs::remove_dir_all(mcp_json.parent().unwrap());
    }

    /// 쿼리 타일 5단계 통합 — DB 평면이 서버에 산다: db_open → db_query(행·컬럼) → 같은 stream 다시 열기 = reattached(같은 핸들 ·
    /// 임대 +1) → 옛 임대의 query = `[stale-lease]` → 읽기 전용 INSERT·다중 문장·ATTACH 거절 → 스키마·컬럼 → 쓰기 켬 → INSERT
    /// (affected) → db_close → `[session-gone]`. 경유 호스트가 호스트 목록에 없으면 거절 · 판 7 연결에는 DB op 를 열지 않음. **응답·서버 로그에 SQL
    /// 본문·경로가 없다**(로그는 op·핸들·길이·행 수·ms — 응답에는 결과 칸만).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_plane_opens_queries_reattaches_and_refuses_stale_leases() {
        let _g = SESSION_STATE.lock().await;
        const SQL_MARK: &str = "SQLMARK-5f3a";
        let dir = scratch_dir("db-plane");
        let file = dir.join("app-PATHMARK.db");
        {
            let c = rusqlite::Connection::open(&file).unwrap();
            c.execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t(name) VALUES ('a'), ('b'), ('c');")
                .unwrap();
        }
        let list = dir.join("db-connections.json");
        let id = "Test5_sqlite01";
        let entries = json!([
            { "id": id, "name": "app", "engine": "sqlite", "path": file.to_string_lossy() },
            // 경유 호스트가 `~/.ssh/config` 에 없는 줄(읽기만 — 시험 별칭은 없는 값).
            { "id": "Kp3_pg-main01", "name": "prod", "engine": "postgres", "via": "nohost-zq9-aynx-test", "host": "localhost", "port": 5432 },
        ]);
        std::fs::write(&list, serde_json::to_string(&entries).unwrap()).unwrap();
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        let w = ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 8)).await);
        assert_eq!(w["protocol"], 8);
        let mut seen: Vec<String> = Vec::new();
        let mut n = 10u64;
        let (i, sn) = (&mut n, &mut seen);
        let conn = json!({ "id": id });
        let db = super::super::db_ops::DB;

        let open = json!({ "stream": "tile-db-1", "window": "main", "conn": conn, "lang": "en" });
        let o = ok_body(ask(&mut a, i, sn, Grade::Write, "db_open", open).await);
        assert_eq!(o["dialect"], "sqlite");
        assert_eq!((o["writable"].as_bool(), o["reattached"].as_bool(), o["lease"].as_u64()), (Some(false), Some(false), Some(1)));
        assert!(o["serverVersion"].as_str().unwrap().starts_with("SQLite 3."), "{o}");
        let handle = o["handle"].as_u64().unwrap();
        let q = |lease: u64, sql: &str| json!({ "handle": handle, "lease": lease, "sql": sql, "queryId": "q1", "maxRows": 2 });
        let marked = format!("SELECT id, name, '{SQL_MARK}' <> '' AS m FROM t ORDER BY id");
        let r = ok_body(ask(&mut a, i, sn, Grade::Write, "db_query", q(1, &marked)).await);
        assert_eq!(r["columns"][1], json!({ "name": "name", "type": "text" }));
        assert_eq!(r["rows"], json!([[1, "a", 1], [2, "b", 1]]));
        assert_eq!((r["truncated"].as_bool(), r["cellTruncated"].as_bool()), (Some(true), Some(false)));
        assert!(r.get("affected").is_none(), "읽기 문장에는 affected 가 없다: {r}");
        assert!(r["elapsedMs"].is_u64());

        // 같은 stream 으로 다시 열기 = 다시 붙기(같은 핸들 · 임대 +1).
        let again = json!({ "stream": "tile-db-1", "window": "aux-1", "conn": conn });
        let o2 = ok_body(ask(&mut a, i, sn, Grade::Write, "db_open", again).await);
        assert_eq!((o2["handle"].as_u64(), o2["lease"].as_u64(), o2["reattached"].as_bool()), (Some(handle), Some(2), Some(true)));
        // 접속 기록(`db_history` — 목록 곁 `db-history.json`): 새로 연 한 번만 센다(다시 붙기는 접속이 아니다) · 시각과 횟수뿐.
        let hist_path = dir.join("db-history.json");
        let mut hist = Value::Null;
        for _ in 0..100 {
            if let Ok(raw) = std::fs::read_to_string(&hist_path) {
                hist = serde_json::from_str(&raw).unwrap();
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(hist["conns"][id]["count"], 1, "{hist}");
        assert!(hist["conns"][id]["last_ok_at"].is_u64(), "{hist}");
        assert_eq!(hist["conns"].as_object().map(|m| m.len()), Some(1), "{hist}");
        assert_eq!(hist["conns"][id].as_object().map(|m| m.len()), Some(2), "{hist}");
        match ask(&mut a, i, sn, Grade::Write, "db_query", q(1, "SELECT 1")).await {
            Frame::Response { ok: false, error: Some(e), .. } => {
                assert_eq!(e.code, db);
                assert!(e.message.contains("[stale-lease]"), "{}", e.message);
            }
            other => panic!("옛 임대가 통과: {other:?}"),
        }
        // 읽기 전용 — INSERT 거절(엔진 readonly()) · 다중 문장·ATTACH 거절(가드).
        for sql in ["INSERT INTO t(name) VALUES ('x')", "SELECT 1; SELECT 2", "ATTACH 'x.db' AS x"] {
            assert_eq!(err_code(ask(&mut a, i, sn, Grade::Write, "db_query", q(2, sql)).await), db, "{sql}");
        }
        let sc = ok_body(ask(&mut a, i, sn, Grade::Read, "db_schema", json!({ "handle": handle, "lease": 2 })).await);
        assert_eq!(sc["schemas"][0]["name"], "main");
        assert!(sc["schemas"][0].get("tables").is_none(), "첫 단계는 이름만: {sc}");
        let ob = ok_body(ask(&mut a, i, sn, Grade::Read, "db_objects", json!({ "handle": handle, "lease": 2, "schema": "main" })).await);
        assert_eq!(ob, json!({ "objects": [{ "kind": "table", "name": "t" }], "truncated": [] }));
        // 옛 임대의 객체 읽기도 거절된다.
        match ask(&mut a, i, sn, Grade::Read, "db_objects", json!({ "handle": handle, "lease": 1 })).await {
            Frame::Response { ok: false, error: Some(e), .. } => assert!(e.message.contains("[stale-lease]"), "{}", e.message),
            other => panic!("옛 임대가 통과: {other:?}"),
        }
        let cols = ok_body(ask(&mut a, i, sn, Grade::Read, "db_table_detail", json!({ "handle": handle, "lease": 2, "table": "t" })).await);
        assert_eq!(cols["columns"][0]["name"], "id");
        assert_eq!(cols["columns"][0]["pk"], 1);
        for part in ["indexes", "constraints", "foreignKeys", "referencedBy", "triggers", "partitions", "truncated"] {
            assert!(cols[part].is_array(), "{part}: {cols}");
        }
        // 옛 임대의 테이블 구조 읽기도 거절된다.
        match ask(&mut a, i, sn, Grade::Read, "db_table_detail", json!({ "handle": handle, "lease": 1, "table": "t" })).await {
            Frame::Response { ok: false, error: Some(e), .. } => assert!(e.message.contains("[stale-lease]"), "{}", e.message),
            other => panic!("옛 임대가 통과: {other:?}"),
        }
        // 정의 읽기 — 원문 그대로 · 옛 임대는 거절 · 모르는 종류는 사람 문구.
        let def = |lease: u64, kind: &str| json!({ "handle": handle, "lease": lease, "schema": "main", "kind": kind, "name": "t" });
        let d = ok_body(ask(&mut a, i, sn, Grade::Read, "db_definition", def(2, "table")).await);
        assert!(d["sql"].as_str().unwrap().starts_with("CREATE TABLE t"), "{d}");
        assert_eq!((d["reconstructed"].as_bool(), d["truncated"].as_bool()), (Some(false), Some(false)));
        match ask(&mut a, i, sn, Grade::Read, "db_definition", def(1, "table")).await {
            Frame::Response { ok: false, error: Some(e), .. } => assert!(e.message.contains("[stale-lease]"), "{}", e.message),
            other => panic!("옛 임대가 통과: {other:?}"),
        }
        assert_eq!(err_code(ask(&mut a, i, sn, Grade::Read, "db_definition", def(2, "sequence")).await), db);
        // 쓰기 켬 → INSERT 성공(affected) → 끄면 다시 거절.
        let sw = ok_body(ask(&mut a, i, sn, Grade::Write, "db_set_write", json!({ "handle": handle, "lease": 2, "on": true })).await);
        assert_eq!(sw["writable"], true);
        let ins = ok_body(ask(&mut a, i, sn, Grade::Write, "db_query", q(2, "INSERT INTO t(name) VALUES ('d')")).await);
        assert_eq!(ins["affected"], 1);
        // 판 30 — 읽기 전용 조회(데이터 탭)는 쓰기 모드여도 읽기만: 조회는 되고 · 쓰기 문장 · 다중 문장은 거절.
        let ro = |sql: &str| {
            let mut b = q(2, sql);
            b["readOnly"] = json!(true);
            b
        };
        let before = ok_body(ask(&mut a, i, sn, Grade::Write, "db_query", q(2, "SELECT count(*) FROM t")).await)["rows"][0][0].clone();
        let got = ok_body(ask(&mut a, i, sn, Grade::Write, "db_query", ro("SELECT count(*) AS n FROM t WHERE 1=1")).await);
        assert_eq!(got["rows"][0][0], before, "{got}");
        for sql in ["INSERT INTO t(name) VALUES ('ro')", "DELETE FROM t", "SELECT 1; DELETE FROM t"] {
            match ask(&mut a, i, sn, Grade::Write, "db_query", ro(sql)).await {
                Frame::Response { ok: false, error: Some(e), .. } => {
                    assert_eq!(e.code, db, "{sql}");
                    // 데이터 탭 문구 — [실행] · Alt+X 안내(쿼리 탭의 공용 가드 문구)가 섞이지 않는다
                    assert!(!e.message.contains("Alt+X"), "{sql}: {}", e.message);
                }
                other => panic!("{sql}: 실패가 아님: {other:?}"),
            }
        }
        let after = ok_body(ask(&mut a, i, sn, Grade::Write, "db_query", q(2, "SELECT count(*) FROM t")).await)["rows"][0][0].clone();
        assert_eq!(after, before, "읽기 전용 조회가 아무것도 바꾸지 않았다");
        ok_body(ask(&mut a, i, sn, Grade::Write, "db_set_write", json!({ "handle": handle, "lease": 2, "on": false })).await);
        assert_eq!(err_code(ask(&mut a, i, sn, Grade::Write, "db_query", q(2, "DELETE FROM t")).await), db);
        // 지금 안 도는 쿼리의 취소는 false.
        let c = ask(&mut a, i, sn, Grade::Write, "db_cancel", json!({ "handle": handle, "queryId": "nope" })).await;
        assert_eq!(ok_body(c), false);
        // 끝없는 쿼리 — 시간 제한(300ms)이 끊는다(취소 표시 없음).
        let endless = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n";
        let started = std::time::Instant::now();
        let r = ask(&mut a, i, sn, Grade::Write, "db_query",
            json!({ "handle": handle, "lease": 2, "sql": endless, "queryId": "q-t", "timeoutMs": 300 })).await;
        match r {
            Frame::Response { ok: false, error: Some(e), .. } => assert!(!e.message.contains("[cancelled]"), "{}", e.message),
            other => panic!("시간 제한이 안 걸림: {other:?}"),
        }
        assert!(started.elapsed() < Duration::from_secs(10));
        // 사람의 취소 — 쿼리는 연결 a 에서 돌고, 취소는 다른 연결 c 에서(op 가 태스크라 서로 막지 않는다).
        let req = Frame::Request { id: 500, kind: Grade::Write, op: "db_query".into(),
            body: json!({ "handle": handle, "lease": 2, "sql": endless, "queryId": "q-c", "timeoutMs": 60_000 }) };
        frame::write_frame(&mut a, &req).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (mut c, _) = connect_retry(&pipe).await;
        ok_body(call(&mut c, 1, Grade::Read, "hello", hello(7, 8)).await);
        // 돌고 있는 동안 둘째 쿼리는 바로 거절(줄 세우지 않는다).
        let busy = call(&mut c, 2, Grade::Write, "db_query", json!({ "handle": handle, "lease": 2, "sql": "SELECT 1", "queryId": "q-2" })).await;
        assert_eq!(err_code(busy), db);
        assert_eq!(ok_body(call(&mut c, 3, Grade::Write, "db_cancel", json!({ "handle": handle, "queryId": "q-c" })).await), true);
        let cancelled = loop {
            match frame::read_frame(&mut a).await.unwrap().expect("응답") {
                Frame::Response { id: 500, ok, error, .. } => break (ok, error),
                _ => continue,
            }
        };
        assert!(!cancelled.0 && cancelled.1.unwrap().message.contains("[cancelled]"));
        drop(c);

        // SSH 경유 — 경유 호스트가 호스트 목록에 없으면 분명한 문구로 거절(SSH 를 열지 않는다) · 목록에 없는 id 도 거절.
        let host = json!({ "stream": "tile-db-2", "window": "main", "conn": { "id": "Kp3_pg-main01" } });
        match ask(&mut a, i, sn, Grade::Write, "db_open", host).await {
            Frame::Response { ok: false, error: Some(e), .. } => {
                assert_eq!(e.code, db);
                assert!(e.message.contains("'nohost-zq9-aynx-test'"), "{}", e.message);
            }
            other => panic!("없는 경유 호스트가 통과: {other:?}"),
        }
        let missing = json!({ "stream": "tile-db-2", "window": "main", "conn": { "id": "Nope_conn-01" } });
        assert_eq!(err_code(ask(&mut a, i, sn, Grade::Write, "db_open", missing).await), db);

        // 닫기 → 그 핸들은 `[session-gone]` · 두 번째 닫기는 false(멱등).
        assert_eq!(ok_body(ask(&mut a, i, sn, Grade::Write, "db_close", json!({ "handle": handle })).await), true);
        match ask(&mut a, i, sn, Grade::Write, "db_query", q(2, "SELECT 1")).await {
            Frame::Response { ok: false, error: Some(e), .. } => assert!(e.message.contains("[session-gone]"), "{}", e.message),
            other => panic!("닫힌 핸들이 통과: {other:?}"),
        }
        assert_eq!(ok_body(ask(&mut a, i, sn, Grade::Write, "db_close", json!({ "handle": handle })).await), false);

        // 판 7 로 붙은 연결에는 DB op 를 열지 않는다.
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 7)).await);
        let r = call(&mut b, 2, Grade::Write, "db_open", json!({ "stream": "tile-db-3", "window": "main", "conn": conn })).await;
        assert_eq!(err_code(r), code::PROTOCOL_MISMATCH);

        // 응답·로그에 SQL 본문·경로가 없다(응답의 결과 칸에는 SQL 이 되풀이되지 않는다 — 열 이름 `m` 만).
        for text in &seen {
            assert!(!text.contains(SQL_MARK) && !text.contains("PATHMARK"), "응답에 SQL·경로: {text}");
        }
        for line in super::super::log::CAPTURED.lock().unwrap().iter() {
            let bad = line.contains(SQL_MARK) || line.contains("PATHMARK") || line.contains("INSERT");
            assert!(!bad, "로그에 SQL·경로: {line}");
        }
        assert_eq!(ok_body(call(&mut a, 99, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// SQLite 파일 하나 + 그것을 가리키는 `db-connections.json` — 수명 시험의 재료. `(폴더, 목록 파일, 연결 참조)`.
    fn db_fixture(tag: &str, id: &str) -> (std::path::PathBuf, std::path::PathBuf, Value) {
        let dir = scratch_dir(tag);
        let file = dir.join("life.db");
        rusqlite::Connection::open(&file).unwrap().execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1);").unwrap();
        let list = dir.join("db-connections.json");
        let entries = json!([{ "id": id, "name": "life", "engine": "sqlite", "path": file.to_string_lossy() }]);
        std::fs::write(&list, serde_json::to_string(&entries).unwrap()).unwrap();
        (dir, list, json!({ "id": id }))
    }

    fn db_err(f: Frame) -> String {
        match f {
            Frame::Response { ok: false, error: Some(e), .. } => e.message,
            other => panic!("실패가 아님: {other:?}"),
        }
    }

    /// 시험 `db_borrowed_password_lifecycle`(2026-11-09 — `db::borrowed`): 사람 타일이 비밀번호로 인증해 붙어 있는 동안 AI 연결은 볼트 없이 그
    /// 값으로 연다(`ai::open_with` — 볼트 물러남 끔 · 몸에 그 값) · 거절되면 그 값을 버리고 볼트 차례로 한 번 더 · 대상이 바뀌면 쓰지 않고
    /// 버린다 · **볼트 잠금(가림막 · 창 0개 — `vault_ops::lock`)과 잠금 해제는 빌린 값에 닿지 않는다**(잠긴 동안에도 같은 값 · 같은 번호로
    /// 빌려주고 AI 연결이 열린다) · **마지막 타일 닫힘**에 지워지고 AI 문구가 까닭을 가른다. SQLite 타일은 비밀번호를 줘도 담지 않는다(비밀번호
    /// 엔진만). 잠금 답 · 문구 · `Debug` 에 값이 없다. 비밀번호 엔진(PG · MySQL)의 실제 서버는 없으므로 인증 성공은 `borrowed::remember`(타일
    /// 열기가 부르는 그 함수 — 친 값 · 미리 정한 볼트 값 모두)로 세우고, 엔진 접속은 `open_with` 의 여는 함수 자리에 시험 함수를 둔다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_borrowed_password_lifecycle() {
        use crate::db::ai::{self, DbAiLevel, PasswordSource};
        use crate::db::borrowed::{self, Missing};
        use crate::db::net::{OpenError, OpenSecrets};
        use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
        use super::super::vault_ops::{self, VaultPlane};
        use std::sync::Mutex as StdMutex;
        const SECRET: &str = "BRW-SECRET-typed-1";
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _) = db_fixture("db-borrow", "Test_brw0001");
        let line = crate::db::conns::load_at(&list).unwrap().conns.remove(0);
        let id = line.id.clone();
        let grant_for = |c: &crate::db::conns::DbConn| {
            let doc = upsert_database_in_doc("", &c.id, &DbIdentity::of(c, None), DbAiLevel::Read, Some(true)).unwrap();
            ai::authorize(&crate::delegation::Delegation::parse(&doc).unwrap(), c, None, DbAiLevel::Read).ok().unwrap()
        };
        let grant = grant_for(&line);
        let typed = || zeroize::Zeroizing::new(SECRET.to_string());
        let lend_now = || {
            assert!(borrowed::remember(&id, DbIdentity::of(&line, None), typed()), "타일이 있으면 담긴다");
        };
        let no_pw = || OpenError::Msg(crate::errors::with_reason(crate::errors::DB_PASSWORD, "needs a password".into()));
        let text = || ai::open_error_text(no_pw(), None, &id);
        let lent_secret = || ai::lend_for(&grant, &PasswordSource::Vault).map(|l| (l.password.to_string(), l.stamp));
        assert_eq!(borrowed::missing(&id), Some(Missing::TileClosed));

        // 사람 타일(SQLite) — 비밀번호를 줘도 비밀번호 엔진이 아니라 담지 않는다. 타일은 표에 선다.
        crate::db::conns::set_path_override(Some(list.clone()));
        crate::db::table::conn_opened(7_719_001);
        let secrets = OpenSecrets { password: Some(typed()), ssh: Default::default(), vault: true, from_vault: false };
        let o = crate::db::table::open("brw-1".into(), "brw-1".into(), 7_719_001, crate::db::table::ConnRef { id: id.clone() }, secrets)
            .await
            .expect("타일 열기");
        assert_eq!(borrowed::missing(&id), Some(Missing::NoPassword), "SQLite 는 담지 않는다");
        let t = text();
        assert!(t.contains("connected without a password") && !t.contains(SECRET), "(e) 비밀번호 없이 붙음: {t}");
        // 재부착(같은 stream · 같은 참조)은 새 인증이 없다 — 새로 담지 않는다(담긴 값이 있으면 그대로 — 아래 ④).
        let again = crate::db::table::open(
            "brw-1".into(),
            "brw-1".into(),
            7_719_001,
            crate::db::table::ConnRef { id: id.clone() },
            OpenSecrets { password: Some(typed()), ssh: Default::default(), vault: true, from_vault: false },
        )
        .await
        .expect("재부착");
        assert!(again.reattached, "재부착");
        assert_eq!(borrowed::missing(&id), Some(Missing::NoPassword), "재부착은 담지 않는다");

        // ① 타일 인증 성공(비밀번호 엔진이라면 표가 부르는 그 함수) → AI 는 볼트 없이 그 값으로 연다.
        lend_now();
        let seen: StdMutex<Vec<(Option<String>, bool)>> = StdMutex::default();
        let record = |s: OpenSecrets| {
            seen.lock().unwrap().push((s.password.as_ref().map(|p| p.to_string()), s.vault));
            std::future::ready(Ok::<(), OpenError>(()))
        };
        let lent = ai::lend_for(&grant, &PasswordSource::Vault);
        let (_, stamp) = ai::open_with(&grant, &PasswordSource::Vault, lent, record).await.unwrap();
        assert!(stamp.is_some(), "빌린 값으로 열었다");
        assert_eq!(seen.lock().unwrap().as_slice(), &[(Some(SECRET.to_string()), false)], "몸에 빌린 값 · 볼트 물러남 끔");
        // 시험의 몸 비밀번호(`Given`)는 빌린 값을 보지 않는다.
        assert!(ai::lend_for(&grant, &PasswordSource::Given(None)).is_none());

        // ② 빌린 값이 거절되면(`[db-auth]`) 그 값을 버리고 볼트 차례로 한 번 더(몸 없음 · 볼트 물러남 켬).
        seen.lock().unwrap().clear();
        let reject_borrowed = |s: OpenSecrets| {
            let first = s.password.is_some();
            seen.lock().unwrap().push((s.password.as_ref().map(|p| p.to_string()), s.vault));
            std::future::ready(if first {
                Err(OpenError::Msg(crate::errors::with_reason(crate::errors::DB_AUTH, "rejected".into())))
            } else {
                Ok(())
            })
        };
        let lent = ai::lend_for(&grant, &PasswordSource::Vault);
        let (_, stamp) = ai::open_with(&grant, &PasswordSource::Vault, lent, reject_borrowed).await.unwrap();
        assert_eq!(stamp, None, "볼트 차례로 열었다");
        assert_eq!(seen.lock().unwrap().as_slice(), &[(Some(SECRET.to_string()), false), (None, true)]);
        assert_eq!(borrowed::missing(&id), Some(Missing::Rejected), "거절된 값은 버렸다");
        let t = text();
        assert!(t.contains("database rejected the password borrowed"), "(d) 거절: {t}");
        // 빌린 값이 없으면 곧바로 볼트 차례 한 번.
        seen.lock().unwrap().clear();
        ai::open_with(&grant, &PasswordSource::Vault, None, record).await.unwrap();
        assert_eq!(seen.lock().unwrap().as_slice(), &[(None, true)]);

        // ③ 대상이 바뀜(사람이 DB 이름을 고쳐 저장) → 그 신원으로는 빌려주지 않고 버린다 · 같은 신원으로도 다시 못 빌린다 · 문구는 "대상 바뀜".
        lend_now();
        let mut moved = line.clone();
        moved.engine = crate::db::conns::DbEngine::Postgres;
        moved.path = None;
        moved.host = Some("evil.example".into());
        assert!(ai::lend_for(&grant_for(&moved), &PasswordSource::Vault).is_none(), "바뀐 대상");
        assert!(ai::lend_for(&grant, &PasswordSource::Vault).is_none(), "버렸다");
        assert_eq!(borrowed::missing(&id), Some(Missing::TargetChanged));
        let t = text();
        assert!(t.contains("target changed since the query tile connected") && t.contains("reconnect it in a query tile"), "(c) 대상: {t}");

        // ④ 볼트 잠금(가림막 `shade` · 창 0개 `windows_zero` — 서버의 볼트 잠금 한 문)은 빌린 값에 닿지 않는다 — 잠긴 동안에도 같은 값 · 같은
        //    번호로 빌려주고, AI 연결은 그 값으로 열린다(볼트가 잠겨 있어도 — 사람 타일이 붙어 있는 동안). 해제도 아무것도 바꾸지 않는다.
        lend_now();
        let (first, stamp) = lent_secret().expect("빌려준다");
        assert_eq!(first, SECRET);
        let vdir = dir.join("vault");
        std::fs::create_dir_all(&vdir).unwrap();
        let plane = VaultPlane::new(Some(vdir));
        vault_ops::handle("vault_create", json!({ "master": null }), &plane).unwrap();
        for reason in [crate::vault::LockReason::Shade, crate::vault::LockReason::WindowsZero] {
            let r = vault_ops::lock(&plane, reason, "test");
            assert!(!r.to_string().contains(SECRET), "{r}");
            assert!(!plane.vault.is_unlocked(), "볼트는 잠겼다");
            assert_eq!(borrowed::missing(&id), None, "잠금이 지우지도 멈추지도 않는다");
            assert_eq!(lent_secret(), Some((SECRET.to_string(), stamp)), "잠긴 동안에도 같은 값 · 같은 번호");
            assert!(borrowed::still_lent(&id, stamp), "빌린 값으로 연 풀 연결도 그대로");
            seen.lock().unwrap().clear();
            let lent = ai::lend_for(&grant, &PasswordSource::Vault);
            let (_, opened) = ai::open_with(&grant, &PasswordSource::Vault, lent, record).await.unwrap();
            assert_eq!(opened, Some(stamp), "볼트 잠김 + 타일 열림 → AI 연결이 열린다");
            assert_eq!(seen.lock().unwrap().as_slice(), &[(Some(SECRET.to_string()), false)]);
            vault_ops::handle("vault_unlock", json!({ "master": null, "lang": "en" }), &plane).expect("빈 값으로 열린다");
            assert_eq!(lent_secret(), Some((SECRET.to_string(), stamp)), "해제도 바꾸지 않는다");
        }
        // 재부착은 담긴 값을 건드리지 않는다.
        let again = crate::db::table::open(
            "brw-1".into(),
            "brw-1".into(),
            7_719_001,
            crate::db::table::ConnRef { id: id.clone() },
            OpenSecrets::default(),
        )
        .await
        .expect("재부착");
        assert!(again.reattached);
        assert_eq!(lent_secret(), Some((SECRET.to_string(), stamp)), "재부착 뒤에도 같은 값");

        // ⑤ 볼트가 잠긴 채 마지막 사람 타일이 닫힘 → 지움 · 다음 AI 호출은 "타일 없음"(볼트 잠김이면 "잠금 해제" 안내 — 순수 문구는 `db::ai` 시험).
        vault_ops::lock(&plane, crate::vault::LockReason::Shade, "test");
        assert!(crate::db::table::close(o.handle, None).unwrap());
        assert_eq!(borrowed::missing(&id), Some(Missing::TileClosed));
        assert!(ai::lend_for(&grant, &PasswordSource::Vault).is_none());
        assert!(!borrowed::remember(&id, DbIdentity::of(&line, None), typed()), "타일 없이 담지 않는다");
        let t = text();
        assert!(t.contains("no query tile") && !t.contains(SECRET), "(a) 타일 없음: {t}");

        drop(plane);
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 시험 `db_headless_gate`(2026-11-09 — `[[database]] headless`): AI 연결의 볼트 차례는 헤드리스 위임이 켜진 연결만. 끔 + 타일 없음 →
    /// **아무것도 열지 않고**(여는 함수를 부르지 않는다 = 볼트 · 경유 SSH 에 닿지 않는다) 헤드리스 문구(볼트 잠김 · 값 없음 문구가 아니다) ·
    /// 켬 → 볼트 차례(볼트 물러남 켬) · 타일이 비밀번호로 붙어 있으면(빌린 값) 칸과 무관하게 그 값으로 · 빌린 값이 거절되면 끔이면 볼트로
    /// 물러나지 않는다 · 타일이 비밀번호 없이 붙어 있으면 볼트 없이 한 번(서버가 청하면 헤드리스 문구) · 대상이 바뀌면 헤드리스도 꺼진다.
    /// 쓰기 작업안 연결(`ai_write::open`)은 같은 `open_with` 를 지난다(소스 훑기) · 실행 직전 재판정의 증표가 칸을 싣는다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_headless_gate() {
        use crate::db::ai::{self, DbAiLevel, PasswordSource};
        use crate::db::borrowed;
        use crate::db::net::{OpenError, OpenSecrets};
        use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
        use std::sync::Mutex as StdMutex;
        const SECRET: &str = "HDL-SECRET-typed-1";
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _) = db_fixture("db-headless", "Test_hdl0001");
        let line = crate::db::conns::load_at(&list).unwrap().conns.remove(0);
        let id = line.id.clone();
        let grant_with = |c: &crate::db::conns::DbConn, level: DbAiLevel, headless: Option<bool>| {
            let doc = upsert_database_in_doc("", &c.id, &DbIdentity::of(c, None), level, headless).unwrap();
            ai::authorize(&crate::delegation::Delegation::parse(&doc).unwrap(), c, None, DbAiLevel::Schema).ok().unwrap()
        };
        let off = grant_with(&line, DbAiLevel::Read, None);
        let on = grant_with(&line, DbAiLevel::Read, Some(true));
        assert!(!off.headless() && on.headless(), "새 블록은 끔 · 켜면 켬");
        // 쓰기 작업안의 재판정(`operations::db_exec` — 같은 `authorize`)도 칸을 싣는다.
        assert!(!grant_with(&line, DbAiLevel::Approve, None).headless());
        assert!(grant_with(&line, DbAiLevel::All, Some(true)).headless());
        let seen: StdMutex<Vec<(Option<String>, bool)>> = StdMutex::default();
        let record = |s: OpenSecrets| {
            seen.lock().unwrap().push((s.password.as_ref().map(|p| p.to_string()), s.vault));
            std::future::ready(Ok::<(), OpenError>(()))
        };
        let msg = |r: Result<((), Option<u64>), OpenError>| match r {
            Err(OpenError::Msg(m)) => m,
            Err(OpenError::Ssh(_)) => panic!("SSH 관문"),
            Ok(_) => panic!("열렸다"),
        };
        let headless_text = |t: &str| t.contains("headless access is off") && t.contains("'Headless connection'") && t.contains("the vault was not used");
        let not_vault_text = |t: &str| !t.contains("vault is locked") && !t.contains("stored in the vault") && !t.contains("no vault is set up");

        // ① 끔 + 타일 없음 → 여는 함수를 부르지 않는다(볼트 · SSH 에 닿지 않음) · 헤드리스 문구.
        assert_eq!(borrowed::missing(&id), Some(borrowed::Missing::TileClosed));
        let t = msg(ai::open_with(&off, &PasswordSource::Vault, ai::lend_for(&off, &PasswordSource::Vault), record).await);
        assert!(seen.lock().unwrap().is_empty(), "아무것도 열지 않았다");
        assert!(headless_text(&t) && not_vault_text(&t) && t.contains("open it in a query tile"), "{t}");
        assert_eq!(ai::open_error_text(OpenError::Msg(t.clone()), None, &id), t, "AI 문구는 그대로 지난다");
        // ② 켬 + 타일 없음 → 볼트 차례 한 번(몸 없음 · 볼트 물러남 켬).
        ai::open_with(&on, &PasswordSource::Vault, None, record).await.unwrap();
        assert_eq!(seen.lock().unwrap().as_slice(), &[(None, true)]);

        // 사람 타일(SQLite — 비밀번호 없이 붙음).
        crate::db::conns::set_path_override(Some(list.clone()));
        crate::db::table::conn_opened(7_719_101);
        let o = crate::db::table::open("hdl-1".into(), "hdl-1".into(), 7_719_101, crate::db::table::ConnRef { id: id.clone() }, OpenSecrets::default())
            .await
            .expect("타일 열기");
        assert_eq!(borrowed::missing(&id), Some(borrowed::Missing::NoPassword));
        // ③ 끔 + 타일이 비밀번호 없이 붙음 → 볼트 없이 한 번 · 서버가 비밀번호를 청하면 헤드리스 문구.
        seen.lock().unwrap().clear();
        ai::open_with(&off, &PasswordSource::Vault, None, record).await.unwrap();
        assert_eq!(seen.lock().unwrap().as_slice(), &[(None, false)], "볼트 물러남 끔");
        let needs_pw = |s: OpenSecrets| {
            assert!(!s.vault && s.password.is_none());
            std::future::ready(Err::<(), OpenError>(OpenError::Msg(crate::errors::with_reason(crate::errors::DB_PASSWORD, "needs".into()))))
        };
        let t = msg(ai::open_with(&off, &PasswordSource::Vault, None, needs_pw).await);
        assert!(headless_text(&t) && t.contains("connected without a password"), "{t}");

        // ④ 타일이 비밀번호로 붙음(빌린 값) → 칸과 무관하게 그 값으로.
        assert!(borrowed::remember(&id, DbIdentity::of(&line, None), zeroize::Zeroizing::new(SECRET.to_string())));
        for g in [&off, &on] {
            seen.lock().unwrap().clear();
            let (_, stamp) = ai::open_with(g, &PasswordSource::Vault, ai::lend_for(g, &PasswordSource::Vault), record).await.unwrap();
            assert!(stamp.is_some());
            assert_eq!(seen.lock().unwrap().as_slice(), &[(Some(SECRET.to_string()), false)]);
        }
        // ⑤ 끔 + 빌린 값 거절 → 그 값을 버리고 볼트로 물러나지 않는다.
        seen.lock().unwrap().clear();
        let reject = |s: OpenSecrets| {
            seen.lock().unwrap().push((s.password.as_ref().map(|p| p.to_string()), s.vault));
            std::future::ready(Err::<(), OpenError>(OpenError::Msg(crate::errors::with_reason(crate::errors::DB_AUTH, "rejected".into()))))
        };
        let t = msg(ai::open_with(&off, &PasswordSource::Vault, ai::lend_for(&off, &PasswordSource::Vault), reject).await);
        assert_eq!(seen.lock().unwrap().as_slice(), &[(Some(SECRET.to_string()), false)], "한 번만 — 볼트 차례 없음");
        assert!(headless_text(&t) && t.contains("rejected the password borrowed") && !t.contains(SECRET), "{t}");

        // ⑥ 대상이 바뀜 → 그 대상의 증표는 헤드리스가 꺼진다(옛 파일의 켬 블록이 새 대상에 번지지 않는다) · 빌린 값도 없다.
        assert!(borrowed::remember(&id, DbIdentity::of(&line, None), zeroize::Zeroizing::new(SECRET.to_string())));
        let mut moved = line.clone();
        moved.path = Some(format!("{}-other", line.path.clone().unwrap()));
        let doc = upsert_database_in_doc("", &id, &DbIdentity::of(&line, None), DbAiLevel::Read, Some(true)).unwrap();
        let d = crate::delegation::Delegation::parse(&doc).unwrap();
        assert!(ai::authorize(&d, &moved, None, DbAiLevel::Schema).is_err(), "스냅샷 어긋남 = 끔(권한 전체)");
        assert!(!d.db_headless(&moved, None));
        let rewritten = upsert_database_in_doc(&doc, &id, &DbIdentity::of(&moved, None), DbAiLevel::Read, None).unwrap();
        let moved_grant = ai::authorize(&crate::delegation::Delegation::parse(&rewritten).unwrap(), &moved, None, DbAiLevel::Schema).ok().unwrap();
        assert!(!moved_grant.headless(), "새 대상으로 다시 적으면 끔");
        seen.lock().unwrap().clear();
        let t = msg(ai::open_with(&moved_grant, &PasswordSource::Vault, ai::lend_for(&moved_grant, &PasswordSource::Vault), record).await);
        assert!(seen.lock().unwrap().is_empty() && headless_text(&t) && t.contains("target changed"), "{t}");

        // 쓰기 작업안 연결도 같은 차례(`open_with`)를 지난다 — 비밀번호 엔진 둘 다.
        let w = include_str!("../db/ai_write.rs");
        assert_eq!(w.matches("ai::open_with(grant, src, ai::lend_for(grant, src)").count(), 2, "PG · MySQL 쓰기 연결");

        assert!(crate::db::table::close(o.handle, None).unwrap());
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 시험 `db_headless_off_drops_vault_pool`(2026-11-09 실기 — 헤드리스를 꺼도 볼트로 연 AI 풀 연결이 계속 쓰였다): 풀에서 꺼내 쓰는 것도
    /// 이번 호출의 증표를 지난다 — **볼트 차례로 연 풀 연결 + 이번 증표 헤드리스 끔 → 그 연결을 쓰지 않고**(풀에서 빼고) 새 열기로 간다 · 켬이면
    /// 그대로 다시 쓴다 · 빌린 값으로 연 풀 연결은 칸과 무관하게 다시 쓴다(`retire_borrowed` · `still_lent` 그대로). **SQLite 도 헤드리스 칸을
    /// 따른다**(같은 날 — `ai::sqlite_gate`): 그 연결의 사람 타일이 표에 없으면(`borrowed` 의 타일 집합) 끔 = 안 엶 · 켬 = 엶 · 타일 열림 = 칸과
    /// 무관 · 비밀번호 없이 연 풀 연결도 같은 문(타일 닫힘 + 끔이면 다시 쓰지 않는다) · 쓰기 작업안 연결도 같은 문. PG · MySQL 서버가 없으므로 풀 연결은 SQLite 엔진에 표지만 달아 심는다(`plant_for_test` — 다시 쓰기 판정은 엔진 종류를 보지 않는다).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_headless_off_drops_vault_pool() {
        use crate::db::ai::{self, DbAiLevel, PwFrom};
        use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _) = db_fixture("db-headless-pool", "Test_hdp0001");
        let line = crate::db::conns::load_at(&list).unwrap().conns.remove(0);
        let id = line.id.clone();
        let grant_with = |headless: Option<bool>| {
            let doc = upsert_database_in_doc("", &line.id, &DbIdentity::of(&line, None), DbAiLevel::Read, headless).unwrap();
            ai::authorize(&crate::delegation::Delegation::parse(&doc).unwrap(), &line, None, DbAiLevel::Schema).ok().unwrap()
        };
        let (off, on) = (grant_with(None), grant_with(Some(true)));
        assert!(!off.headless() && on.headless());

        // 순수 판정(셋째 인자 = 그 연결의 사람 타일이 표에 있다).
        for t in [false, true] {
            assert!(!ai::reusable(PwFrom::Vault, false, t) && ai::reusable(PwFrom::Vault, true, t), "볼트 차례는 칸만 본다");
            for h in [false, true] {
                assert!(ai::reusable(PwFrom::Borrowed, h, t));
                assert_eq!(ai::reusable(PwFrom::NoPassword, h, t), h || t, "비밀번호 없이 연 것은 여는 문과 같다");
                assert_eq!(ai::sqlite_opens(h, t), h || t);
            }
        }
        let off_text = |e: String| assert!(e.contains("headless access is off") && !e.contains("vault") && !e.contains("password"), "{e}");
        let tile = |open: bool| if open { crate::db::borrowed::tile_opened(&id) } else { crate::db::borrowed::last_tile_closed(&id) };

        // ① 볼트로 연 풀 연결 + 헤드리스 끔 → 쓰지 않는다 — 타일이 없으면 SQLite 도 열지 않고(2026-11-09), 타일이 있으면 비밀번호 없이 새로 연다.
        ai::plant_for_test(&on, PwFrom::Vault);
        off_text(ai::acquire_for_test(&off).await.unwrap_err());
        tile(true);
        ai::plant_for_test(&on, PwFrom::Vault);
        let (from, same) = ai::acquire_for_test(&off).await.unwrap();
        assert!(!same && from == PwFrom::NoPassword, "볼트 풀 연결을 다시 쓰지 않았다");
        // ② 볼트로 연 풀 연결 + 헤드리스 켬 → 그대로 다시 쓴다.
        ai::plant_for_test(&on, PwFrom::Vault);
        assert_eq!(ai::acquire_for_test(&on).await.unwrap(), (PwFrom::Vault, true));
        // ③ 타일이 열려 있으면 빌린 값 · 비밀번호 없이 연 풀 연결 → 헤드리스 끔이어도 다시 쓴다.
        for f in [PwFrom::Borrowed, PwFrom::NoPassword] {
            ai::plant_for_test(&off, f);
            assert_eq!(ai::acquire_for_test(&off).await.unwrap(), (f, true), "{f:?}");
        }
        // ④ 타일이 닫혔다 — 비밀번호 없이 연 풀 연결은 헤드리스 끔이면 쓰지 않고(새로도 열지 않는다) · 켬이면 그대로.
        tile(false);
        ai::plant_for_test(&off, PwFrom::NoPassword);
        off_text(ai::acquire_for_test(&off).await.unwrap_err());
        ai::plant_for_test(&on, PwFrom::NoPassword);
        assert_eq!(ai::acquire_for_test(&on).await.unwrap(), (PwFrom::NoPassword, true));
        // ⑤ 새로 열기(SQLite) — 타일 없음 + 끔 = 안 엶 · 켬 = 엶 · 타일 열림 = 칸과 무관하게 엶.
        ai::close_for_test(&[&id]);
        off_text(ai::acquire_for_test(&off).await.unwrap_err());
        assert_eq!(ai::acquire_for_test(&on).await.unwrap(), (PwFrom::NoPassword, false));
        ai::close_for_test(&[&id]);
        tile(true);
        assert_eq!(ai::acquire_for_test(&off).await.unwrap(), (PwFrom::NoPassword, false));
        // ⑥ 쓰기 작업안 연결(SQLite 쓰기)도 같은 문 — Ask 증표로.
        let ask = |headless: bool| {
            let doc = upsert_database_in_doc("", &line.id, &DbIdentity::of(&line, None), DbAiLevel::Approve, Some(headless)).unwrap();
            ai::authorize(&crate::delegation::Delegation::parse(&doc).unwrap(), &line, None, DbAiLevel::Approve).ok().unwrap()
        };
        let src = ai::PasswordSource::Vault;
        assert!(crate::db::ai_write::open(&ask(false), &src).await.is_ok(), "타일 열림 = 칸과 무관");
        tile(false);
        off_text(crate::db::ai_write::open(&ask(false), &src).await.err().unwrap());
        assert!(crate::db::ai_write::open(&ask(true), &src).await.is_ok(), "켬 = 타일 없이도 엶");

        ai::close_for_test(&[&id]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 시험 `db_test_connects_once_and_leaves_nothing`(판 28 — DB 연결 폼 [연결 테스트]): 저장 안 한 초안(SQLite)으로 붙으면 판 글자 ·
    /// 걸린 시간이 오고 **표 · 접속 기록에 아무것도 남지 않는다** · 없는 파일은 만들지 않고 실패 · 저장 검사에 걸리는 초안(상대 경로)은
    /// 거절 · `dbtest-` 머리가 아닌 열쇠는 거절 · 판 27 연결에는 열지 않는다. 로그에 경로가 없다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_test_connects_once_and_leaves_nothing() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _conn) = db_fixture("db-test-PATHMARK", "Test28_saved1");
        let file = dir.join("life.db");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, frame::PROTOCOL_MAX)).await)["protocol"], 30);
        let db = super::super::db_ops::DB;
        let draft = |id: &str, path: &str| json!({ "id": id, "name": "초안", "engine": "sqlite", "path": path });
        let body = |stream: &str, conn: Value| json!({ "stream": stream, "conn": conn, "lang": "en" });
        let before = crate::db::table::live_count();

        // 저장 안 한 새 id 의 초안 — 붙고 곧바로 닫는다.
        let ok = ok_body(
            call(&mut a, 2, Grade::Write, "db_test", body("dbtest-a1", draft("Test28_draft1", &file.to_string_lossy()))).await,
        );
        assert_eq!(ok["dialect"], "sqlite");
        assert!(ok["serverVersion"].as_str().unwrap().starts_with("SQLite 3."), "{ok}");
        assert!(ok["elapsedMs"].is_u64(), "{ok}");
        assert!(ok.get("via").is_none(), "{ok}");
        assert_eq!(crate::db::table::live_count(), before, "연결 테스트가 표에 남았다");
        assert!(!dir.join("db-history.json").exists(), "연결 테스트가 접속 기록에 남았다");

        // 없는 파일 — 만들지 않고 실패.
        let gone = dir.join("missing.db");
        let e = db_err(call(&mut a, 3, Grade::Write, "db_test", body("dbtest-a2", draft("Test28_draft1", &gone.to_string_lossy()))).await);
        assert!(!e.is_empty());
        assert!(!gone.exists(), "없는 파일을 만들었다");
        // 저장과 같은 검사 — 상대 경로 · 빈 이름은 거절.
        assert_eq!(err_code(call(&mut a, 4, Grade::Write, "db_test", body("dbtest-a3", draft("Test28_draft1", "rel.db"))).await), db);
        let nameless = json!({ "id": "Test28_draft1", "name": " ", "engine": "sqlite", "path": file.to_string_lossy() });
        assert_eq!(err_code(call(&mut a, 5, Grade::Write, "db_test", body("dbtest-a4", nameless)).await), db);
        // 타일 열쇠 꼴은 받지 않는다(세워 둔 전송로를 타일과 나눠 갖지 않게).
        let tile = body("query:tile-1", draft("Test28_draft1", &file.to_string_lossy()));
        assert_eq!(err_code(call(&mut a, 6, Grade::Write, "db_test", tile).await), db);
        assert_eq!(crate::db::table::live_count(), before);
        assert!(!dir.join("db-history.json").exists());

        // 판 27 로 붙은 연결에는 열지 않는다.
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 27)).await);
        let r = call(&mut b, 2, Grade::Write, "db_test", body("dbtest-b1", draft("Test28_draft1", &file.to_string_lossy()))).await;
        assert_eq!(err_code(r), code::PROTOCOL_MISMATCH);

        for line in super::super::log::CAPTURED.lock().unwrap().iter() {
            assert!(!line.contains("PATHMARK") && !line.contains("Test28_draft1"), "로그에 경로 · id: {line}");
        }
        drop(b);
        assert_eq!(ok_body(call(&mut a, 99, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 쿼리 타일 9단계 — **DB 연결의 수명이 창·GUI 연결을 따른다**(세션 코어 밖 `db::table`):
    /// ① 페이지 리로드(`detach_window`) = 떼어 둠 + 도는 쿼리 취소 → 같은 stream 다시 열기 = 재부착(같은 핸들 · 임대 +1) → 옛 임대 stale
    /// ② 리로드로 떼어 둔 DB 연결은 떨어진 세션 목록(`sessions_detached`)에 없고 MCP `list_sessions` 에는 늘 없다 ③ 창 파괴(`close_window`) = 떼어 둔 것까지
    /// 즉시 닫음 · 이관 중인 stream(`dbStreams`)은 빼고 · `set_home` 으로 옮긴 것은 새 창의 파괴만 닫는다 ④ **창이 사라짐**(GUI 연결 끊김
    /// `conn_gone` · 앱 끝내기 중 창 파괴 `dbOnly`) = 떨어진 세션으로 남김(2026-11-09 ② — TTL 없음 · 목록에 `kind: "db"` · 서버 고아 시계가
    /// 센다) · 리로드는 TTL 그대로 · [붙이기](재부착) · 복원이 데려가지 않음(`restore_done`) · [닫기](`close_detached` — 붙은 것은 안 닫음)
    /// ⑤ 트레이 [모든 세션 종료](`close_all`) = 모두 닫음 ⑥ 서버 끝 = 남은 DB 연결을 닫는다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_connections_follow_window_and_client_lifetimes() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-life", "Test9_life01");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 8)).await)["protocol"], 8);
        let mut n = 10u64;
        // 요청 번호 — 이름표는 읽는 사람용이다.
        let mut req = |_label: &str| -> u64 {
            n += 1;
            n
        };
        let open = |stream: &str, window: &str| json!({ "stream": stream, "window": window, "conn": conn.clone() });
        let q = |h: u64, lease: u64| json!({ "handle": h, "lease": lease, "sql": "SELECT x FROM t", "queryId": "q" });

        // ── ① 리로드 = 떼어 둠 · 도는 쿼리 취소 → 다시 열기 = 재부착 ──
        let o = ok_body(call(&mut a, req("open"), Grade::Write, "db_open", open("life-1", "main")).await);
        let h1 = o["handle"].as_u64().unwrap();
        let endless = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n";
        let long = Frame::Request { id: 500, kind: Grade::Write, op: "db_query".into(),
            body: json!({ "handle": h1, "lease": 1, "sql": endless, "queryId": "q-long", "timeoutMs": 60_000 }) };
        frame::write_frame(&mut a, &long).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (mut c, _) = connect_retry(&pipe).await;
        ok_body(call(&mut c, 1, Grade::Read, "hello", hello(7, 8)).await);
        ok_body(call(&mut c, 2, Grade::Write, "detach_window", json!({ "window": "main" })).await);
        let cancelled = loop {
            match frame::read_frame(&mut a).await.unwrap().expect("응답") {
                Frame::Response { id: 500, ok, error, .. } => break (ok, error),
                _ => continue,
            }
        };
        assert!(!cancelled.0 && cancelled.1.unwrap().message.contains("[cancelled]"), "떼어 두면 도는 쿼리는 취소");
        let o2 = ok_body(call(&mut a, req("reopen"), Grade::Write, "db_open", open("life-1", "main")).await);
        assert_eq!((o2["handle"].as_u64(), o2["lease"].as_u64(), o2["reattached"].as_bool()), (Some(h1), Some(2), Some(true)));
        assert!(db_err(call(&mut a, req("stale"), Grade::Write, "db_query", q(h1, 1)).await).contains("[stale-lease]"));
        ok_body(call(&mut a, req("q"), Grade::Write, "db_query", q(h1, 2)).await);

        // ── ② 떨어진 세션 목록 · MCP 에 없다 ──
        ok_body(call(&mut c, 3, Grade::Write, "detach_window", json!({ "window": "main" })).await);
        let rows = ok_body(call(&mut a, req("detached"), Grade::Read, "sessions_detached", json!({})).await);
        assert!(!rows.to_string().contains("life-1"), "리로드로 떼어 둔 DB 연결이 떨어진 세션 목록에: {rows}");
        let port = ok_body(call(&mut a, req("coords"), Grade::Read, "mcp_coords", json!({})).await)["port"].as_u64().unwrap() as u16;
        let token = ok_body(call(&mut a, req("token"), Grade::Read, "mcp_token", json!({})).await)["token"].as_str().unwrap().to_string();
        let listed = mcp_tool(port, &token, "list_sessions", json!({})).await;
        assert!(!listed.to_string().contains("life-1"), "MCP 목록에 DB 연결: {listed}");
        // 지금 임대로 부르면 다시 붙은 것으로 친다(늦게 닿은 detach_window 가 산 타일을 떼어 놓은 경우).
        ok_body(call(&mut a, req("touch"), Grade::Write, "db_query", q(h1, 2)).await);

        // ── ③ 창 파괴 = 즉시 닫음(떼어 둔 것까지) · 이관 중인 것은 빼고 · set_home 으로 옮긴 것은 새 창이 닫는다 ──
        let h2 = ok_body(call(&mut a, req("o2"), Grade::Write, "db_open", open("life-2", "aux-1")).await)["handle"].as_u64().unwrap();
        let h3 = ok_body(call(&mut a, req("o3"), Grade::Write, "db_open", open("life-3", "aux-1")).await)["handle"].as_u64().unwrap();
        ok_body(call(&mut c, 4, Grade::Write, "detach_window", json!({ "window": "aux-1" })).await);
        ok_body(call(&mut c, 5, Grade::Write, "close_window", json!({ "window": "aux-1", "dbStreams": ["life-3"] })).await);
        assert!(db_err(call(&mut a, req("g2"), Grade::Write, "db_query", q(h2, 1)).await).contains("[session-gone]"));
        ok_body(call(&mut c, 6, Grade::Write, "set_home", json!({ "window": "aux-2", "dbStreams": ["life-3"] })).await);
        ok_body(call(&mut c, 7, Grade::Write, "close_window", json!({ "window": "aux-1" })).await);
        ok_body(call(&mut a, req("a3"), Grade::Write, "db_query", q(h3, 1)).await);
        ok_body(call(&mut c, 8, Grade::Write, "close_window", json!({ "window": "aux-2" })).await);
        assert!(db_err(call(&mut a, req("g3"), Grade::Write, "db_query", q(h3, 1)).await).contains("[session-gone]"));
        // 창 파괴는 다른 창의 연결을 건드리지 않는다.
        ok_body(call(&mut a, req("still"), Grade::Write, "db_query", q(h1, 2)).await);

        // ── ④ 창이 사라짐 = 떨어진 세션으로 남김(TTL 없음) · 리로드만 TTL ──
        crate::db::table::set_detach_ttl_for_test(Some(Duration::from_millis(600)));
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 8)).await);
        let h4 = ok_body(call(&mut b, 2, Grade::Write, "db_open", open("life-4", "main")).await)["handle"].as_u64().unwrap();
        let h5 = ok_body(call(&mut b, 3, Grade::Write, "db_open", open("life-5", "main")).await)["handle"].as_u64().unwrap();
        // 트레이로 남는 quitAll — 창은 파괴되지만 GUI 연결은 산다: 창 파괴 거둠이 DB 연결을 떨어진 세션으로 남긴다(`dbOnly`).
        let h6 = ok_body(call(&mut a, req("o6"), Grade::Write, "db_open", open("life-6", "tray-main")).await)["handle"].as_u64().unwrap();
        ok_body(call(&mut c, 10, Grade::Write, "detach_window", json!({ "window": "tray-main", "dbOnly": true })).await);
        // 리로드(창은 산다) — TTL 그대로.
        let h8 = ok_body(call(&mut a, req("o8"), Grade::Write, "db_open", open("life-8", "reload-w")).await)["handle"].as_u64().unwrap();
        ok_body(call(&mut c, 11, Grade::Write, "detach_window", json!({ "window": "reload-w" })).await);
        drop(b); // GUI kill · quitAll 뒤 GUI 종료
        tokio::time::sleep(Duration::from_millis(200)).await;
        let dbs = ok_body(call(&mut a, req("st"), Grade::Read, "status", json!({})).await)["dbs"].as_u64().unwrap();
        assert!(dbs >= 4, "떼어 둔 DB 연결이 산다: {dbs}");
        let rows_of = |v: &Value| -> Vec<(String, Value)> {
            v.as_array()
                .unwrap()
                .iter()
                .filter(|r| r["kind"] == "db")
                .map(|r| (r["stream"].as_str().unwrap().to_string(), r.clone()))
                .collect()
        };
        let rows = rows_of(&ok_body(call(&mut a, req("rows"), Grade::Read, "sessions_detached", json!({})).await));
        let names: Vec<&str> = rows.iter().map(|(s, _)| s.as_str()).collect();
        for s in ["life-4", "life-5", "life-6"] {
            assert!(names.contains(&s), "창이 사라진 DB 타일은 떨어진 세션 목록에: {names:?}");
        }
        assert!(!names.contains(&"life-8"), "리로드로 떼어 둔 것은 목록에 없다: {names:?}");
        let r6 = &rows.iter().find(|(s, _)| s == "life-6").unwrap().1;
        assert_eq!((r6["home"].as_str(), r6["conn"].as_str(), r6["writable"].as_bool(), r6["inTx"].as_bool()), (Some("tray-main"), conn["id"].as_str(), Some(false), Some(false)), "{r6}");
        assert!(r6["detachedAt"].as_u64().is_some() && r6["unclaimed"] == false, "{r6}");
        // 서버 고아 시계가 세션으로 센다(사람이 닫거나 붙일 때까지 서버가 산다).
        assert!(crate::db::table::kept_count() >= 3);
        // [새 탭에 붙이기] — 같은 stream 으로 열면 재부착(비밀번호 다시 안 물음). 프런트는 볼트 관문 전에 `reattachOnly` 로 먼저 붙는다.
        let mut ro = open("life-5", "main");
        ro["reattachOnly"] = json!(true);
        let o5 = ok_body(call(&mut a, req("o5"), Grade::Write, "db_open", ro).await);
        assert_eq!((o5["handle"].as_u64(), o5["reattached"].as_bool()), (Some(h5), Some(true)));
        tokio::time::sleep(Duration::from_millis(1200)).await;
        // TTL 이 지나도 창이 사라진 것은 산다 · 리로드로 떼어 둔 것만 닫힌다.
        let rows = rows_of(&ok_body(call(&mut a, req("rows2"), Grade::Read, "sessions_detached", json!({})).await));
        let names: Vec<&str> = rows.iter().map(|(s, _)| s.as_str()).collect();
        assert!(names.contains(&"life-4") && names.contains(&"life-6"), "TTL 없음: {names:?}");
        assert!(!names.contains(&"life-5"), "붙은 것은 목록에 없다: {names:?}");
        assert!(db_err(call(&mut a, req("g8"), Grade::Write, "db_query", q(h8, 1)).await).contains("[session-gone]"), "리로드 TTL 은 그대로");
        // TTL 이 지난 뒤의 `reattachOnly` 는 새로 열지 않고 `[session-gone]` — 프런트가 평소 관문으로 연다.
        let before = ok_body(call(&mut a, req("st0"), Grade::Read, "status", json!({})).await)["dbs"].clone();
        let mut ro8 = open("life-8", "reload-w");
        ro8["reattachOnly"] = json!(true);
        assert!(db_err(call(&mut a, req("ro8"), Grade::Write, "db_open", ro8).await).contains("[session-gone]"));
        assert_eq!(ok_body(call(&mut a, req("st1"), Grade::Read, "status", json!({})).await)["dbs"], before, "붙기만 — 새로 열지 않는다");
        // 복원이 데려가지 않음 — 그 창(`main`)의 떨어진 DB 연결 중 `keep` 에 없는 것을 표시만(닫지 않는다).
        let rd = ok_body(call(&mut a, req("rd"), Grade::Write, "restore_done", json!({ "window": "main", "keep": [] })).await);
        assert!(rd["unclaimed"].as_u64().unwrap() >= 1, "{rd}");
        let rows = rows_of(&ok_body(call(&mut a, req("rows3"), Grade::Read, "sessions_detached", json!({})).await));
        assert_eq!(rows.iter().find(|(s, _)| s == "life-4").unwrap().1["unclaimed"], true);
        // [닫기] — 떨어져 있을 때만(붙은 life-5 는 닫지 않는다).
        assert_eq!(ok_body(call(&mut a, req("cd5"), Grade::Write, "close_detached", json!({ "stream": "life-5" })).await), false);
        assert_eq!(ok_body(call(&mut a, req("cd6"), Grade::Write, "close_detached", json!({ "stream": "life-6" })).await), true);
        assert!(db_err(call(&mut a, req("g6"), Grade::Write, "db_query", q(h6, 1)).await).contains("[session-gone]"), "[닫기] = 닫음");
        let rows = rows_of(&ok_body(call(&mut a, req("rows4"), Grade::Read, "sessions_detached", json!({})).await));
        assert!(rows.iter().all(|(s, _)| s != "life-6"));
        // 떨어진 것을 지금 임대로 부르면 다시 붙은 것으로 친다(목록에서 빠진다).
        ok_body(call(&mut a, req("a4"), Grade::Write, "db_query", q(h4, 1)).await);
        let rows = rows_of(&ok_body(call(&mut a, req("rows5"), Grade::Read, "sessions_detached", json!({})).await));
        assert!(rows.iter().all(|(s, _)| !s.starts_with("life-")), "{rows:?}");
        // 붙어 있는 것(life-1 · 다시 붙은 life-5)은 TTL 과 무관하다.
        ok_body(call(&mut a, req("a5"), Grade::Write, "db_query", q(h5, o5["lease"].as_u64().unwrap())).await);
        crate::db::table::set_detach_ttl_for_test(None);

        // ── ⑤ 트레이 [모든 세션 종료] = DB 연결도 모두 닫음 ──
        let n_closed = ok_body(call(&mut c, 9, Grade::Write, "close_all", json!({})).await);
        assert_eq!(n_closed, 0, "DB 연결은 세션 수에 넣지 않는다");
        assert!(db_err(call(&mut a, req("g1"), Grade::Write, "db_query", q(h1, 2)).await).contains("[session-gone]"));
        assert_eq!(ok_body(call(&mut a, req("st2"), Grade::Read, "status", json!({})).await)["dbs"], 0);

        // ── ⑥ 서버 끝 = 남은 DB 연결을 닫는다 ──
        ok_body(call(&mut a, req("o7"), Grade::Write, "db_open", open("life-7", "main")).await);
        assert_eq!(crate::db::table::live_count(), 1);
        drop(c);
        assert_eq!(ok_body(call(&mut a, 999, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        assert_eq!(crate::db::table::live_count(), 0, "서버 끝에 DB 연결이 남았다");
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 2026-11-09 실기 — **트레이로 · GUI 끝내기 중의 창 파괴는 DB 타일을 떨어진 세션으로 남긴다**(리로드 TTL 이 아니다): GUI 의 창 파괴
    /// 거둠이 실제로 고르는 계기(`reap::destroyed_event(QUITTING)`)와 그 계기가 보내는 op 차례(`reap::window_ops`) · 몸(`proxy::*_body`)을
    /// 그대로 서버에 재생한다. 옛 시험은 `dbOnly` 몸을 손으로 보냈고, GUI 는 QUITTING 이면 리로드 계기로 거둬 `close_window`(그 안의
    /// `dbOnly` 갈래)에 닿지 않아 리로드 떨어뜨리기만 갔다 — 10분 뒤 닫혔다. 일반 리로드는 TTL 그대로 · QUITTING 아닌 창 파괴는 닫음.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_tile_survives_leave_to_tray_window_destroy() {
        use crate::reap::{destroyed_event, window_ops, Event, Held, WindowOp};
        use crate::server::proxy::{close_body, detach_body, keep_body};
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-tray", "Test9_tray01");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, frame::PROTOCOL_MAX)).await);
        let open = |stream: &str, window: &str| json!({ "stream": stream, "window": window, "conn": conn.clone() });
        let q = |h: u64| json!({ "handle": h, "lease": 1, "sql": "SELECT x FROM t", "queryId": "q" });
        // 그 계기에 GUI 가 보내는 op 를 같은 차례 · 같은 몸으로(이관 중인 것 없음).
        async fn replay(a: &mut BoxStream, event: Event, label: &str) {
            for (i, op) in window_ops(event).iter().enumerate() {
                let (name, body) = match op {
                    WindowOp::Detach => ("detach_window", detach_body(label, Held::default(), &[])),
                    WindowOp::KeepDbs => ("detach_window", keep_body(label, &[], &[])),
                    WindowOp::Close => ("close_window", close_body(label, &[], &[], &[], &[])),
                };
                ok_body(call(a, 100 + i as u64, Grade::Write, name, body).await);
            }
        }
        crate::db::table::set_detach_ttl_for_test(Some(Duration::from_millis(400)));
        let ht = ok_body(call(&mut a, 2, Grade::Write, "db_open", open("tray-1", "main")).await)["handle"].as_u64().unwrap();
        let hr = ok_body(call(&mut a, 3, Grade::Write, "db_open", open("reload-1", "aux-r")).await)["handle"].as_u64().unwrap();
        let hd = ok_body(call(&mut a, 4, Grade::Write, "db_open", open("close-1", "aux-d")).await)["handle"].as_u64().unwrap();
        // 트레이로(`tray::leave_to_tray` — QUITTING 을 세운 뒤 창 파괴) · 보통 리로드 · 보통 창 파괴.
        assert_eq!(destroyed_event(true), Event::Leaving);
        assert_eq!(destroyed_event(false), Event::Destroyed);
        replay(&mut a, destroyed_event(true), "main").await;
        replay(&mut a, Event::Reload, "aux-r").await;
        replay(&mut a, destroyed_event(false), "aux-d").await;
        assert!(crate::db::table::kept_count() >= 1, "트레이로 간 창의 DB 는 남김(Kept)");
        let rows = ok_body(call(&mut a, 20, Grade::Read, "sessions_detached", json!({})).await);
        let names: Vec<&str> = rows.as_array().unwrap().iter().filter(|r| r["kind"] == "db").filter_map(|r| r["stream"].as_str()).collect();
        assert!(names.contains(&"tray-1") && !names.contains(&"reload-1"), "{names:?}");
        assert!(db_err(call(&mut a, 21, Grade::Write, "db_query", q(hd)).await).contains("[session-gone]"), "보통 창 파괴는 닫음");
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(db_err(call(&mut a, 22, Grade::Write, "db_query", q(hr)).await).contains("[session-gone]"), "리로드 TTL 은 그대로");
        let rows = ok_body(call(&mut a, 23, Grade::Read, "sessions_detached", json!({})).await);
        assert!(rows.to_string().contains("tray-1"), "TTL 이 지나도 트레이로 간 창의 DB 는 남는다: {rows}");
        // 다시 켠 창의 복원이 같은 stream 으로 붙는다(같은 핸들).
        let mut ro = open("tray-1", "main");
        ro["reattachOnly"] = json!(true);
        let o = ok_body(call(&mut a, 24, Grade::Write, "db_open", ro).await);
        assert_eq!((o["handle"].as_u64(), o["reattached"].as_bool()), (Some(ht), Some(true)), "{o}");
        crate::db::table::set_detach_ttl_for_test(None);
        assert_eq!(ok_body(call(&mut a, 999, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 쿼리 타일 1단계 — **트랜잭션 작업이 서버에 산다**(판 9 · `db::table` · `db::tx`, SQLite 로):
    /// ① 판 8 연결에는 `db_tx` 를 열지 않는다 · 읽기 전용에서는 시작 거절 ② 시작 → 작업 id 를 실은 문장(같은 연결에서 보임 · 다른
    /// 연결엔 안 보임) · 낡은 id(0 · 다른 id) 거절 → [커밋](낡은 id 거절) → 대기 ③ [되돌리기] ④ 떼어 두기(F5) 동안 작업 유지 —
    /// 다시 붙으면 같은 작업 · 문장 수 · 흐른 시계 ⑤ 방치 시계 — 경고 이벤트 → [연장] → 되돌림 이벤트(상태 조회는 시계를 늘리지 않음)
    /// ⑥ 쓰기 끄기 = 되돌린 뒤 끔 ⑦ 열린 작업을 둔 채 닫기 = 서버가 되돌림.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_transaction_work_lives_in_the_server() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-tx", "Test1_tx01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 9)).await)["protocol"], 9);
        let mut n = 10u64;
        let mut req = || -> u64 {
            n += 1;
            n
        };
        let open = |stream: &str| json!({ "stream": stream, "window": "main", "conn": conn.clone() });
        let txop = |h: u64, lease: u64, action: &str, id: u64| json!({ "handle": h, "lease": lease, "action": action, "txId": id });
        let q = |h: u64, lease: u64, sql: &str, id: u64| json!({ "handle": h, "lease": lease, "sql": sql, "queryId": "q", "txId": id });

        // ── ① 판 8 연결에는 열지 않는다 · 읽기 전용에서는 시작 거절 ──
        let o = ok_body(call(&mut a, req(), Grade::Write, "db_open", open("tx-1")).await);
        let h = o["handle"].as_u64().unwrap();
        assert_eq!(o["tx"]["state"], "none", "{o}");
        let (mut old, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut old, 1, Grade::Read, "hello", hello(7, 8)).await)["protocol"], 8);
        assert_eq!(err_code(call(&mut old, 2, Grade::Write, "db_tx", txop(h, 1, "state", 0)).await), code::PROTOCOL_MISMATCH);
        drop(old);
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await).contains("쓰기"));
        ok_body(call(&mut a, req(), Grade::Write, "db_set_write", json!({ "handle": h, "lease": 1, "on": true })).await);

        // ── ② 시작 → 문장 → 커밋 ──
        let t = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await)["tx"].clone();
        let id = t["id"].as_u64().unwrap();
        assert!(id > 0);
        assert_eq!((t["state"].as_str(), t["statements"].as_u64()), (Some("open"), Some(0)));
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await).contains("이미"), "두 번 열지 않는다");
        // 작업이 열렸는데 "작업 없음(0)" 으로 알고 친 문장 · 다른 작업 id 의 문장 = 낡음.
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "SELECT 1", 0)).await).contains("[db-tx-stale]"));
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "SELECT 1", id + 1)).await).contains("[db-tx-stale]"));
        // 판 30 — 열린 작업 동안 읽기 전용 조회(데이터 탭)는 거절한다(작업 안에서는 읽기 전용을 걸 수 없다) · 작업은 그대로.
        let mut ro = q(h, 1, "SELECT 1", id);
        ro["readOnly"] = json!(true);
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_query", ro).await).contains("트랜잭션"));
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO t VALUES (2)", id)).await);
        assert_eq!((r["affected"].as_u64(), r["tx"]["statements"].as_u64()), (Some(1), Some(1)));
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "SELECT count(*) FROM t", id)).await);
        assert_eq!(r["rows"], json!([[2]]), "같은 연결에서는 보인다");
        assert_eq!(seen("SELECT count(*) FROM t"), 1, "다른 연결에는 아직 안 보인다");
        // 메타 조회는 작업 안에서도 돌고 시계 · 작업을 건드리지 않는다.
        ok_body(call(&mut a, req(), Grade::Read, "db_objects", json!({ "handle": h, "lease": 1, "schema": "main" })).await);
        ok_body(call(&mut a, req(), Grade::Read, "db_table_detail", json!({ "handle": h, "lease": 1, "table": "t" })).await);
        // 실패한 문장은 세지 않고 작업은 계속(SQLite — 문장만 실패).
        db_err(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO nope VALUES (1)", id)).await);
        let st = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "state", 0)).await)["tx"].clone();
        assert_eq!((st["state"].as_str(), st["statements"].as_u64(), st["id"].as_u64()), (Some("open"), Some(2), Some(id)));
        // 낡은 id 의 [커밋] 은 거절 — 작업은 그대로.
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id + 7)).await).contains("[db-tx-stale]"));
        let done = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id)).await)["tx"].clone();
        assert_eq!((done["state"].as_str(), done["id"].as_u64()), (Some("none"), Some(0)), "끝나면 대기 — 저절로 새 작업을 열지 않는다");
        assert_eq!((done["ended"]["outcome"].as_str(), done["ended"]["id"].as_u64()), (Some("committed"), Some(id)));
        assert_eq!(seen("SELECT count(*) FROM t"), 2, "커밋 뒤 다른 연결에 보인다");
        // 작업이 끝나면 읽기 전용 조회가 다시 선다.
        let mut ro = q(h, 1, "SELECT count(*) FROM t", 0);
        ro["readOnly"] = json!(true);
        assert_eq!(ok_body(call(&mut a, req(), Grade::Write, "db_query", ro).await)["rows"], json!([[2]]));
        // 끝난 작업의 [커밋] 다시 누름 = 낡음 · 작업 밖 문장은 다시 자동 커밋.
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id)).await).contains("[db-tx-stale]"));
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO t VALUES (3)", 0)).await);
        assert_eq!(seen("SELECT count(*) FROM t"), 3);

        // ── ③ 되돌리기 ──
        let id2 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        assert_ne!(id2, id);
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "DELETE FROM t", id2)).await);
        let rb = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "rollback", id2)).await)["tx"].clone();
        assert_eq!(rb["ended"]["outcome"], "rolledBack");
        assert_eq!(seen("SELECT count(*) FROM t"), 3);

        // ── ④ 떼어 두기(F5) 동안 작업 유지 — 다시 붙으면 같은 작업 ──
        let id3 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO t VALUES (4)", id3)).await);
        let (mut c, _) = connect_retry(&pipe).await;
        ok_body(call(&mut c, 1, Grade::Read, "hello", hello(7, 9)).await);
        ok_body(call(&mut c, 2, Grade::Write, "detach_window", json!({ "window": "main" })).await);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let o2 = ok_body(call(&mut a, req(), Grade::Write, "db_open", open("tx-1")).await);
        assert_eq!((o2["reattached"].as_bool(), o2["lease"].as_u64()), (Some(true), Some(2)));
        assert_eq!((o2["tx"]["state"].as_str(), o2["tx"]["id"].as_u64(), o2["tx"]["statements"].as_u64()), (Some("open"), Some(id3), Some(1)));
        assert!(o2["tx"]["startedAgoMs"].as_u64().unwrap() >= 300, "시계는 떼어 둔 동안에도 흘렀다: {o2}");
        // 옛 임대의 [커밋] 은 거절(다른 창이 다시 붙었다).
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id3)).await).contains("[stale-lease]"));
        let fin = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "commit", id3)).await)["tx"].clone();
        assert_eq!(fin["ended"]["outcome"], "committed");
        assert_eq!(seen("SELECT count(*) FROM t"), 4);

        // ── ⑤ 방치 시계 — 경고 → [연장] → 되돌림(서버가 스스로 · 이벤트) ──
        crate::db::table::set_tx_clock_for_test(Some((Duration::from_millis(1500), Duration::from_millis(900))));
        let id4 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 2, "INSERT INTO t VALUES (5)", id4)).await);
        let warn = wait_event(&mut c, "db-state", "tx-1").await;
        assert_eq!((warn["state"].as_str(), warn["tx"]["warn"].as_bool(), warn["tx"]["id"].as_u64()), (Some("tx"), Some(true), Some(id4)));
        // 상태 조회는 시계를 늘리지 않는다 · [연장] 은 늘린다.
        let left0 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "state", 0)).await)["tx"]["idleLeftMs"].as_u64().unwrap();
        assert!(left0 <= 900, "{left0}");
        let ext = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "extend", id4)).await)["tx"].clone();
        assert!(ext["idleLeftMs"].as_u64().unwrap() > 1000 && ext["warn"] == false, "{ext}");
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "extend", id4 + 1)).await).contains("[db-tx-stale]"));
        let warn2 = wait_event(&mut c, "db-state", "tx-1").await;
        assert_eq!(warn2["tx"]["warn"], true, "연장 뒤 다시 경고");
        let idle = wait_event(&mut c, "db-state", "tx-1").await;
        assert_eq!((idle["tx"]["state"].as_str(), idle["tx"]["ended"]["outcome"].as_str()), (Some("none"), Some("idleRolledBack")), "{idle}");
        assert_eq!(seen("SELECT count(*) FROM t"), 4, "방치된 작업은 되돌려졌다");
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "commit", id4)).await).contains("[db-tx-stale]"));
        crate::db::table::set_tx_clock_for_test(None);

        // ── ⑥ 쓰기 끄기 = 되돌린 뒤 끔 ──
        let id5 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 2, "INSERT INTO t VALUES (6)", id5)).await);
        ok_body(call(&mut a, req(), Grade::Write, "db_set_write", json!({ "handle": h, "lease": 2, "on": false })).await);
        let st = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "state", 0)).await)["tx"].clone();
        assert_eq!(st["ended"]["outcome"], "rolledBack");
        assert_eq!(seen("SELECT count(*) FROM t"), 4);

        // ── ⑦ 열린 작업을 둔 채 닫기 = 연결이 닫히며 되돌림 ──
        ok_body(call(&mut a, req(), Grade::Write, "db_set_write", json!({ "handle": h, "lease": 2, "on": true })).await);
        let id6 = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 2, "INSERT INTO t VALUES (7)", id6)).await);
        assert_eq!(ok_body(call(&mut a, req(), Grade::Write, "db_close", json!({ "handle": h, "lease": 2 })).await), true);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(seen("SELECT count(*) FROM t"), 4, "닫힌 연결의 작업은 되돌려졌다");

        drop(c);
        assert_eq!(ok_body(call(&mut a, 999, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 2026-11-09 ② — **떨어진 세션으로 남은 DB 타일의 열린 트랜잭션은 떨어진 지 TTL(10분)이면 되돌리고 연결은 남긴다**: GUI 연결이 끊긴
    /// 뒤 목록 줄은 `inTx` · `writable` 을 싣고, TTL 뒤에도 같은 핸들로 다시 붙으면 작업은 방치 되돌림(`idleRolledBack`)으로 끝나 있고 쓰기
    /// 모드 · 연결은 그대로다(값은 커밋되지 않았다).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_detached_tile_rolls_back_open_tx_but_keeps_connection() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-kept-tx", "Test2_kept01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 9)).await);
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 9)).await);
        let open = json!({ "stream": "kept-tx", "window": "main", "conn": conn.clone() });
        let h = ok_body(call(&mut b, 2, Grade::Write, "db_open", open.clone()).await)["handle"].as_u64().unwrap();
        ok_body(call(&mut b, 3, Grade::Write, "db_set_write", json!({ "handle": h, "lease": 1, "on": true })).await);
        let t = ok_body(call(&mut b, 4, Grade::Write, "db_tx", json!({ "handle": h, "lease": 1, "action": "begin", "txId": 0 })).await);
        let id = t["tx"]["id"].as_u64().unwrap();
        ok_body(call(&mut b, 5, Grade::Write, "db_query", json!({ "handle": h, "lease": 1, "sql": "INSERT INTO t VALUES (2)", "queryId": "q", "txId": id })).await);
        crate::db::table::set_detach_ttl_for_test(Some(Duration::from_millis(500)));
        drop(b); // GUI 가 사라졌다 — 떨어진 세션으로 남는다
        tokio::time::sleep(Duration::from_millis(150)).await;
        let rows = ok_body(call(&mut a, 2, Grade::Read, "sessions_detached", json!({})).await);
        let row = rows.as_array().unwrap().iter().find(|r| r["stream"] == "kept-tx").cloned().expect("목록 줄");
        assert_eq!((row["kind"].as_str(), row["writable"].as_bool(), row["inTx"].as_bool()), (Some("db"), Some(true), Some(true)), "{row}");
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let rows = ok_body(call(&mut a, 3, Grade::Read, "sessions_detached", json!({})).await);
        let row = rows.as_array().unwrap().iter().find(|r| r["stream"] == "kept-tx").cloned().expect("TTL 뒤에도 목록에 남는다");
        assert_eq!(row["inTx"], false, "열린 작업은 되돌렸다: {row}");
        assert_eq!(seen("SELECT count(*) FROM t"), 1, "커밋되지 않았다");
        // 다시 붙이기 — 같은 핸들 · 작업은 방치 되돌림으로 끝나 있고 쓰기 모드는 그대로.
        let mut ro = open.clone();
        ro["reattachOnly"] = json!(true);
        let o = ok_body(call(&mut a, 4, Grade::Write, "db_open", ro).await);
        assert_eq!((o["handle"].as_u64(), o["reattached"].as_bool(), o["writable"].as_bool()), (Some(h), Some(true), Some(true)), "{o}");
        assert_eq!((o["tx"]["state"].as_str(), o["tx"]["ended"]["outcome"].as_str()), (Some("none"), Some("idleRolledBack")), "{o}");
        let lease = o["lease"].as_u64().unwrap();
        let r = ok_body(call(&mut a, 5, Grade::Write, "db_query", json!({ "handle": h, "lease": lease, "sql": "SELECT count(*) FROM t", "queryId": "q", "txId": 0 })).await);
        assert_eq!(r["rows"], json!([[1]]), "연결은 살아 있다");
        crate::db::table::set_detach_ttl_for_test(None);
        assert_eq!(ok_body(call(&mut a, 6, Grade::Write, "db_close", json!({ "handle": h, "lease": lease })).await), true);
        assert_eq!(ok_body(call(&mut a, 999, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 10-14 — **자동 커밋 토글 · 실행 단위 세이브포인트**(판 13): ① 열기 답의 `autoCommit`(켬) · 읽기 전용에서 끄기 거절 ② 끔 → 조회는
    /// 작업을 열지 않는다 ③ 데이터를 바꾸는 문장은 작업을 저절로 연다(다른 연결엔 안 보임) ④ 실행 A 성공 → 실행 B(3문장 중 2번째 오류) =
    /// B 만 되돌림 · 작업 유지 ⑤ 작업 중 토글 바꾸기 거절 ⑥ 커밋 → 다른 연결에 A 만 · 토글은 끈 채 → 다음 변경 문장에서 다시 연다 ⑦ 숨은
    /// 쓰기(`WITH … INSERT`)도 작업을 연다 ⑧ 저절로 연 작업의 첫 실행이 실패하면 빈 작업은 조용히 닫힌다 ⑨ 조회만 든 스크립트는 작업을
    /// 열지 않고 바꾸는 스크립트는 연다 ⑩ F5 재부착에도 `autoCommit` 이 남는다 ⑪ 쓰기를 끄면 켬으로 돌아간다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_auto_commit_off_opens_work_and_savepoints_each_run() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-ac", "Test13_ac01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 13)).await)["protocol"], 13);
        let mut n = 10u64;
        let mut req = || -> u64 {
            n += 1;
            n
        };
        let open = |stream: &str| json!({ "stream": stream, "window": "main", "conn": conn.clone() });
        let txop = |h: u64, lease: u64, action: &str, id: u64| json!({ "handle": h, "lease": lease, "action": action, "txId": id });
        let q = |h: u64, lease: u64, sql: &str, id: u64| json!({ "handle": h, "lease": lease, "sql": sql, "queryId": "q", "txId": id });
        let sw = |h: u64, lease: u64, on: bool, ac: Option<bool>| match ac {
            Some(ac) => json!({ "handle": h, "lease": lease, "on": on, "autoCommit": ac }),
            None => json!({ "handle": h, "lease": lease, "on": on }),
        };

        // ── ① 기본 켬 · 읽기 전용에서는 끌 수 없다 ──
        let o = ok_body(call(&mut a, req(), Grade::Write, "db_open", open("ac-1")).await);
        let h = o["handle"].as_u64().unwrap();
        assert_eq!(o["autoCommit"], true, "{o}");
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_set_write", sw(h, 1, false, Some(false))).await).contains("쓰기"));
        let w = ok_body(call(&mut a, req(), Grade::Write, "db_set_write", sw(h, 1, true, Some(false))).await);
        assert_eq!((w["writable"].as_bool(), w["autoCommit"].as_bool()), (Some(true), Some(false)), "{w}");

        // ── ② 조회는 작업을 열지 않는다 ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "SELECT count(*) FROM t", 0)).await);
        assert_eq!((r["rows"].clone(), r["tx"]["state"].as_str()), (json!([[1]]), Some("none")), "{r}");

        // ── ③ 바꾸는 문장은 작업을 저절로 연다 ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO t VALUES (2)", 0)).await);
        assert_eq!((r["tx"]["state"].as_str(), r["tx"]["statements"].as_u64()), (Some("open"), Some(1)), "{r}");
        let id = r["tx"]["id"].as_u64().unwrap();
        assert_eq!(seen("SELECT count(*) FROM t"), 1, "다른 연결에는 아직 안 보인다");

        // ── ④ 실행 B(3문장 중 2번째 오류) — B 만 되돌림 · 작업은 산다 ──
        let s = ok_body(call(&mut a, req(), Grade::Write, "db_script", q(h, 1, "INSERT INTO t VALUES (3); INSERT INTO nope VALUES (1); INSERT INTO t VALUES (4)", id)).await);
        assert_eq!((s["outcome"].as_str(), s["reason"].as_str(), s["failed"]["index"].as_u64()), (Some("workUndone"), Some("error"), Some(1)), "{s}");
        assert_eq!((s["tx"]["state"].as_str(), s["tx"]["id"].as_u64(), s["tx"]["statements"].as_u64()), (Some("open"), Some(id), Some(1)), "되돌린 실행분은 세지 않는다: {s}");
        // 단문 실패도 그 실행만 — 문구가 "작업은 그대로" 를 밝힌다.
        let m = db_err(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO nope VALUES (1)", id)).await);
        assert!(m.contains("이번 실행만") || m.contains("Only this run"), "{m}");
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "SELECT count(*) FROM t", id)).await);
        assert_eq!(r["rows"], json!([[2]]), "작업 안에서는 A 만 보인다: {r}");

        // ── ⑤ 작업 중 토글 바꾸기 거절 ──
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_set_write", sw(h, 1, true, Some(true))).await).contains("이미"));

        // ── ⑥ 커밋 → 다른 연결에 A 만 · 토글은 끈 채 → 다음 변경에서 다시 연다 ──
        let done = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id)).await)["tx"].clone();
        assert_eq!((done["state"].as_str(), done["ended"]["outcome"].as_str()), (Some("none"), Some("committed")));
        assert_eq!((seen("SELECT count(*) FROM t"), seen("SELECT count(*) FROM t WHERE x IN (3, 4)")), (2, 0));
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "UPDATE t SET x = 10 WHERE x = 1", 0)).await);
        let id2 = r["tx"]["id"].as_u64().unwrap();
        assert!(r["tx"]["state"] == "open" && id2 != id, "{r}");
        ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "rollback", id2)).await);
        assert_eq!(seen("SELECT count(*) FROM t WHERE x = 10"), 0);

        // ── ⑦ 숨은 쓰기(허용 목록 첫 낱말 뒤의 INSERT) — 엔진의 읽기 전용이 거절 → 작업을 열고 다시 ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "WITH v(a) AS (SELECT 5) INSERT INTO t SELECT a FROM v", 0)).await);
        assert_eq!((r["tx"]["state"].as_str(), r["affected"].as_u64()), (Some("open"), Some(1)), "{r}");
        let id3 = r["tx"]["id"].as_u64().unwrap();
        assert_eq!(seen("SELECT count(*) FROM t WHERE x = 5"), 0, "커밋 전");
        ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "rollback", id3)).await);

        // ── ⑧ 저절로 연 작업의 첫 실행이 실패 — 빈 작업은 조용히 닫힌다 ──
        // 문구도 그대로 밝힌다(10-14 실기): "이번 실행만 · 작업 유지" 가 아니라 전부 되돌림 · 작업은 열리지 않음.
        let m = db_err(call(&mut a, req(), Grade::Write, "db_query", q(h, 1, "INSERT INTO nope VALUES (1)", 0)).await);
        assert!(m.contains("열리지 않았습니다") || m.contains("no transaction was left open"), "{m}");
        assert!(!(m.contains("이번 실행만") || m.contains("Only this run")), "{m}");
        let st = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "state", 0)).await)["tx"].clone();
        assert_eq!((st["state"].as_str(), st["id"].as_u64()), (Some("none"), Some(0)), "{st}");
        let s = ok_body(call(&mut a, req(), Grade::Write, "db_script", q(h, 1, "INSERT INTO t VALUES (6); INSERT INTO nope VALUES (1); INSERT INTO t VALUES (9)", 0)).await);
        assert_eq!(
            (s["outcome"].as_str(), s["reason"].as_str(), s["workClosed"].as_bool(), s["failed"]["index"].as_u64(), s["tx"]["state"].as_str()),
            (Some("rolledBack"), Some("error"), Some(true), Some(1), Some("none")),
            "{s}"
        );
        assert_eq!(seen("SELECT count(*) FROM t WHERE x = 6"), 0);

        // ── ⑨ 조회만 든 스크립트는 작업을 열지 않는다 · 바꾸는 스크립트는 연다 ──
        let s = ok_body(call(&mut a, req(), Grade::Write, "db_script", q(h, 1, "SELECT 1; SELECT count(*) FROM t", 0)).await);
        assert_eq!((s["outcome"].as_str(), s["tx"]["state"].as_str()), (Some("readOnly"), Some("none")), "{s}");
        let s = ok_body(call(&mut a, req(), Grade::Write, "db_script", q(h, 1, "INSERT INTO t VALUES (7); INSERT INTO t VALUES (8)", 0)).await);
        assert_eq!((s["outcome"].as_str(), s["tx"]["state"].as_str(), s["tx"]["statements"].as_u64()), (Some("work"), Some("open"), Some(2)), "{s}");
        let id4 = s["tx"]["id"].as_u64().unwrap();

        // ── ⑩ F5(떼어 두기) 뒤 다시 붙어도 자동 커밋은 꺼진 채 · 작업도 그대로 ──
        let (mut c, _) = connect_retry(&pipe).await;
        ok_body(call(&mut c, 1, Grade::Read, "hello", hello(7, 13)).await);
        ok_body(call(&mut c, 2, Grade::Write, "detach_window", json!({ "window": "main" })).await);
        let o2 = ok_body(call(&mut a, req(), Grade::Write, "db_open", open("ac-1")).await);
        assert_eq!((o2["reattached"].as_bool(), o2["autoCommit"].as_bool(), o2["tx"]["id"].as_u64()), (Some(true), Some(false), Some(id4)), "{o2}");
        ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 2, "rollback", id4)).await);
        assert_eq!(seen("SELECT count(*) FROM t WHERE x IN (7, 8)"), 0);

        // ── ⑪ 쓰기를 끄면 켬으로 돌아간다 ──
        let w = ok_body(call(&mut a, req(), Grade::Write, "db_set_write", sw(h, 2, false, None)).await);
        assert_eq!((w["writable"].as_bool(), w["autoCommit"].as_bool()), (Some(false), Some(true)), "{w}");
        let w = ok_body(call(&mut a, req(), Grade::Write, "db_set_write", sw(h, 2, true, None)).await);
        assert_eq!(w["autoCommit"], true, "다시 켜면 기본(켬)");

        drop(c);
        assert_eq!(ok_body(call(&mut a, 999, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 표를 직접 연다(SQLite — 서버 파이프 없이 `db::table` 을 그대로 · 경합 시험이 그 사이에 끼어든다).
    async fn table_open_sqlite(list: &std::path::Path, stream: &str, id: &str, conn: u64) -> crate::db::table::Opened {
        crate::db::conns::set_path_override(Some(list.to_path_buf()));
        crate::db::table::conn_opened(conn);
        let secrets = crate::db::net::OpenSecrets { password: None, ssh: Default::default(), vault: true, from_vault: false };
        match crate::db::table::open(stream.into(), stream.into(), conn, crate::db::table::ConnRef { id: id.into() }, secrets).await {
            Ok(o) => o,
            Err(e) => panic!("열기 실패: {e:?}"),
        }
    }

    /// Codex 검토 반영 2 — **작업 id 검사와 엔진 진입이 한 걸음이다**(연결별 조정 장치 · 판 15): 쿼리가 작업 id 검사를 지나 엔진에 들기
    /// 직전에 세워 두고(`pause_query_after_claim_for_test`) 그 사이에 [커밋] · [되돌리기] · 작업 시작 · 자동 커밋 바꾸기 · 쓰기 끄기 · 메타
    /// 조회를 보낸다 — 모두 바쁨으로 거절돼야 한다(전에는 커밋이 끝나고 쿼리가 작업 없이 자동 커밋 길로 들어갈 수 있었다). 풀어 주면 쿼리는
    /// **그 작업 안에서** 돌고(다른 연결엔 안 보임) 그 뒤 [커밋] 이 둘 다 반영한다. 스크립트도 같은 장치를 지난다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_tx_check_and_engine_entry_are_one_step() {
        use crate::db::table;
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _) = db_fixture("db-serial", "Test15_ser01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let o = table_open_sqlite(&list, "ser-1", "Test15_ser01", 7_715_001).await;
        let (h, l) = (o.handle, o.lease);
        let busy = crate::db::EngineError::busy_message();
        assert!(table::set_write(h, l, true).await.unwrap());
        let id = table::tx_begin(h, l).await.unwrap().id;
        table::query(h, l, "INSERT INTO t VALUES (2)".into(), "a".into(), 100, 5_000, Some(id)).await.unwrap();

        // 쿼리 b 를 작업 id 검사 직후 · 엔진 진입 전에 세운다.
        let (reached, go) = table::pause_query_after_claim_for_test(h);
        let b = tokio::spawn(table::query(h, l, "INSERT INTO t VALUES (3)".into(), "b".into(), 100, 5_000, Some(id)));
        tokio::time::timeout(Duration::from_secs(5), reached.notified()).await.expect("쿼리가 조정 장치에 들지 않음");
        // 그 사이의 다른 요청 — 모두 바쁨(작업 · 모드 · 엔진을 건드리지 않는다).
        assert_eq!(table::tx_end(h, l, id, true).await.unwrap_err(), busy, "실행 중 [커밋]");
        assert_eq!(table::tx_end(h, l, id, false).await.unwrap_err(), busy, "실행 중 [되돌리기]");
        assert_eq!(table::tx_begin(h, l).await.unwrap_err(), busy, "실행 중 작업 시작");
        assert_eq!(table::set_auto_commit(h, l, true).unwrap_err(), busy, "실행 중 자동 커밋 바꾸기");
        assert_eq!(table::set_write(h, l, false).await.unwrap_err(), busy, "실행 중 쓰기 끄기");
        assert_eq!(table::schema(h, l).await.unwrap_err(), busy, "실행 중 메타 조회");
        assert_eq!(table::tx_state(h, l).unwrap().state, "open", "작업은 그대로");
        go.notify_one();
        let r = b.await.unwrap().expect("쿼리 b");
        let tx = r.tx.expect("tx");
        assert_eq!((tx.state, tx.id, tx.statements), ("open", id, 2), "쿼리 b 는 그 작업 안에서 돌았다");
        assert_eq!(seen("SELECT count(*) FROM t"), 1, "커밋 전 — 다른 연결엔 안 보인다(자동 커밋 길로 새지 않았다)");
        let done = table::tx_end(h, l, id, true).await.unwrap();
        assert_eq!(done.ended.as_ref().map(|e| e.outcome), Some(crate::db::tx::Outcome::Committed));
        assert_eq!(seen("SELECT count(*) FROM t"), 3);

        // 스크립트도 같은 장치 — 도는 동안의 [커밋] 은 바쁨 · 취소하면 그 실행분만 되돌리고 작업은 산다.
        let id2 = table::tx_begin(h, l).await.unwrap().id;
        let endless = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n";
        let s = tokio::spawn(table::script(h, l, format!("INSERT INTO t VALUES (9); {endless}"), "s".into(), 100, 60_000, Some(id2)));
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(table::tx_end(h, l, id2, true).await.unwrap_err(), busy, "스크립트 중 [커밋]");
        assert!(table::cancel(h, "s").unwrap());
        let out = s.await.unwrap().expect("스크립트");
        assert_eq!(out.tx.as_ref().map(|t| t.state), Some("open"), "취소 = 그 실행분만 되돌림");
        table::tx_end(h, l, id2, false).await.unwrap();
        assert_eq!(seen("SELECT count(*) FROM t WHERE x = 9"), 0);

        table::close(h, None).unwrap();
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Codex 검토 반영 2 — **방치 되돌리기가 엔진에 닿지 못하면 다시 간다**: 만료 순간 엔진 잠금을 조정 장치 밖에서 쥐어(`hold_for_test`)
    /// 되돌리기를 바쁨으로 실패시킨다 → 작업은 열린 채로 돌아온다 → 잠금을 놓고 **다른 활동 없이** 기다리면 재시도가 되돌린다(전에는
    /// 시계를 깨우는 이가 없어 만료된 작업이 그대로 남을 수 있었다).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_idle_rollback_retries_after_a_busy_engine() {
        use crate::db::table;
        let _g = SESSION_STATE.lock().await;
        let (dir, list, _) = db_fixture("db-idle-retry", "Test15_idl01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let o = table_open_sqlite(&list, "idl-1", "Test15_idl01", 7_715_002).await;
        let (h, l) = (o.handle, o.lease);
        assert!(table::set_write(h, l, true).await.unwrap());
        table::set_idle_retry_for_test(Some(Duration::from_millis(200)));
        table::set_tx_clock_for_test(Some((Duration::from_millis(700), Duration::from_millis(300))));
        let id = table::tx_begin(h, l).await.unwrap().id;
        table::query(h, l, "INSERT INTO t VALUES (2)".into(), "a".into(), 100, 5_000, Some(id)).await.unwrap();
        let table::Engine::Sqlite(db) = table::engine_for_test(h) else { panic!("SQLite") };
        {
            let _held = db.hold_for_test();
            // 만료(0.7초)를 넘기고 재시도도 몇 번 지나게.
            std::thread::sleep(Duration::from_millis(1_400));
            let v = table::tx_state(h, l).unwrap();
            assert_eq!((v.state, v.id), ("open", id), "엔진이 바빠 되돌리지 못했다 — 작업은 열린 채");
        }
        // 다른 활동 없이 — 재시도가 되돌린다.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let ended = loop {
            let v = table::tx_state(h, l).unwrap();
            if let Some(e) = v.ended {
                break e;
            }
            assert!(std::time::Instant::now() < deadline, "재시도가 오지 않음: {v:?}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        assert_eq!((ended.id, ended.outcome), (id, crate::db::tx::Outcome::IdleRolledBack));
        assert_eq!(seen("SELECT count(*) FROM t"), 1, "방치된 작업은 되돌려졌다");
        table::set_tx_clock_for_test(None);
        table::set_idle_retry_for_test(None);
        table::close(h, None).unwrap();
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 쿼리 타일 2단계 — **스크립트 실행이 세션 서버에 산다**(`db_script` · 판 10): ① 판 9 연결에는 열지 않는다 ② 읽기 전용 = 여러
    /// SELECT 를 한 요청으로 ③ 쓰기 = 한 트랜잭션 · 커밋 ④ 둘째 문장 오류 = 전부 되돌림(자리 · 문구) ⑤ 사전 거절 = 실행 0 ⑥ 작업 안 =
    /// 커밋 안 함 ⑦ **실행 중 GUI 연결이 끊겨도 서버가 끝까지**(커밋) — 다시 붙으면 요약이 한 번 온다. 로그에 SQL 본문이 없다.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn db_script_runs_in_the_server_and_outlives_a_gui_drop() {
        let _g = SESSION_STATE.lock().await;
        const SQL_MARK: &str = "SQLMARK-2b7c";
        let (dir, list, conn) = db_fixture("db-script", "Test2_scr01");
        let file = dir.join("life.db");
        let seen = |sql: &str| -> i64 { rusqlite::Connection::open(&file).unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_secs(60));
        cfg.db_conns = Some(list.clone());
        let server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 10)).await)["protocol"], 10);
        let mut n = 10u64;
        let mut req = || -> u64 {
            n += 1;
            n
        };
        let open = |stream: &str| json!({ "stream": stream, "window": "main", "conn": conn.clone() });
        let sc = |h: u64, lease: u64, sql: &str, id: u64| json!({ "handle": h, "lease": lease, "sql": sql, "queryId": "s", "txId": id });
        let txop = |h: u64, lease: u64, action: &str, id: u64| json!({ "handle": h, "lease": lease, "action": action, "txId": id });

        // ── ① 판 표지 · 판 9 연결에는 열지 않는다 ──
        let o = ok_body(call(&mut a, req(), Grade::Write, "db_open", open("scr-1")).await);
        assert_eq!(o["scripts"], true, "{o}");
        let h = o["handle"].as_u64().unwrap();
        let (mut old, _) = connect_retry(&pipe).await;
        assert_eq!(ok_body(call(&mut old, 1, Grade::Read, "hello", hello(7, 9)).await)["protocol"], 9);
        assert_eq!(err_code(call(&mut old, 2, Grade::Write, "db_script", sc(h, 1, "SELECT 1", 0)).await), code::PROTOCOL_MISMATCH);
        drop(old);

        // ── ② 읽기 전용 — 여러 SELECT 를 한 요청으로(결과는 문장별) ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, &format!("SELECT count(*) FROM t /* {SQL_MARK} */; SELECT 2"), 0)).await);
        assert_eq!((r["outcome"].as_str(), r["results"].as_array().map(Vec::len)), (Some("readOnly"), Some(2)), "{r}");
        assert_eq!(r["results"][0]["rows"], json!([[1]]));
        ok_body(call(&mut a, req(), Grade::Write, "db_set_write", json!({ "handle": h, "lease": 1, "on": true })).await);

        // ── ③ 쓰기 — 한 트랜잭션 · 커밋 ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, "INSERT INTO t VALUES (2); INSERT INTO t VALUES (3)", 0)).await);
        assert_eq!((r["outcome"].as_str(), r["total"].as_u64(), r["results"][1]["affected"].as_u64()), (Some("committed"), Some(2), Some(1)), "{r}");
        assert_eq!(r["tx"]["state"], "none");
        assert_eq!(seen("SELECT count(*) FROM t"), 3);
        // ── ④ 둘째 문장 오류 → 전부 되돌림 · 실패 자리(UTF-16) ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, "INSERT INTO t VALUES (4); INSERT INTO nope VALUES (1)", 0)).await);
        assert_eq!((r["outcome"].as_str(), r["reason"].as_str(), r["failed"]["index"].as_u64()), (Some("rolledBack"), Some("error"), Some(1)), "{r}");
        assert_eq!((r["failed"]["start"].as_u64(), r["failed"]["end"].as_u64()), (Some(26), Some(53)));
        assert_eq!(seen("SELECT count(*) FROM t"), 3);
        // ── ⑤ 사전 거절 — 실행 0 ──
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, "INSERT INTO t VALUES (5);\nCOMMIT", 0)).await);
        assert_eq!((r["outcome"].as_str(), r["failed"]["index"].as_u64(), r["failed"]["start"].as_u64()), (Some("refused"), Some(1), Some(26)), "{r}");
        assert_eq!(seen("SELECT count(*) FROM t"), 3);
        // ── ⑥ 작업 안 — 커밋 안 함 · 문장 수가 작업에 더해진다 ──
        let id = ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "begin", 0)).await)["tx"]["id"].as_u64().unwrap();
        assert!(db_err(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, "SELECT 1", 0)).await).contains("[db-tx-stale]"));
        let r = ok_body(call(&mut a, req(), Grade::Write, "db_script", sc(h, 1, "INSERT INTO t VALUES (6); INSERT INTO t VALUES (7)", id)).await);
        assert_eq!((r["outcome"].as_str(), r["tx"]["state"].as_str(), r["tx"]["statements"].as_u64()), (Some("work"), Some("open"), Some(2)), "{r}");
        assert_eq!(seen("SELECT count(*) FROM t"), 3, "커밋 전");
        ok_body(call(&mut a, req(), Grade::Write, "db_tx", txop(h, 1, "commit", id)).await);
        assert_eq!(seen("SELECT count(*) FROM t"), 5);

        // ── ⑦ 실행 중 GUI 연결이 끊김 — 서버가 끝까지(커밋) · 다시 붙으면 요약 한 번 ──
        // 다른 연결이 쓰기 잠금을 쥐어 첫 INSERT 를 붙잡아 둔다(바쁨 대기 2초 안에 놓는다).
        let blocker = rusqlite::Connection::open(&file).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        let body = sc(h, 1, "INSERT INTO t VALUES (8); INSERT INTO t VALUES (9)", 0);
        frame::write_frame(&mut a, &Frame::Request { id: 500, kind: Grade::Write, op: "db_script".into(), body }).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        drop(a);
        tokio::time::sleep(Duration::from_millis(300)).await;
        blocker.execute_batch("COMMIT").unwrap();
        drop(blocker);
        let t0 = std::time::Instant::now();
        while seen("SELECT count(*) FROM t") < 7 && t0.elapsed() < Duration::from_secs(10) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(seen("SELECT count(*) FROM t"), 7, "떼어 두기는 스크립트를 끊지 않는다 — 서버가 커밋했다");
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (mut b, _) = connect_retry(&pipe).await;
        ok_body(call(&mut b, 1, Grade::Read, "hello", hello(7, 10)).await);
        let o2 = ok_body(call(&mut b, 2, Grade::Write, "db_open", open("scr-1")).await);
        assert_eq!(o2["reattached"], true);
        let note = &o2["lastScript"];
        assert_eq!((note["outcome"].as_str(), note["detached"].as_bool(), note["total"].as_u64()), (Some("committed"), Some(true), Some(2)), "{o2}");
        let o3 = ok_body(call(&mut b, 3, Grade::Write, "db_open", open("scr-1")).await);
        assert!(o3.get("lastScript").is_none(), "한 번만 건넨다: {o3}");
        // 실행 표시가 풀렸다 — 다음 일이 바쁘지 않다.
        let lease = o3["lease"].as_u64().unwrap();
        ok_body(call(&mut b, 4, Grade::Write, "db_script", sc(h, lease, "SELECT 1; SELECT 2", 0)).await);

        for line in super::super::log::CAPTURED.lock().unwrap().iter() {
            assert!(!line.contains(SQL_MARK) && !line.contains("INSERT"), "로그에 SQL: {line}");
        }
        assert_eq!(ok_body(call(&mut b, 99, Grade::Write, "shutdown", json!({})).await)["stopping"], true);
        let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 쿼리 타일 9단계 → 2026-11-09 ② — **고아 자진 종료는 떨어진 세션으로 남은 DB 연결을 세션으로 센다**(`serve::Busy` 머리말): GUI 연결이
    /// 끊긴 뒤 DB 연결만 남은 서버는 끝나지 않고(TTL 없음), 사람이 떨어진 세션 목록에서 [닫기] 하면 고아 시계대로 끝난다(서버 끝의 남은
    /// DB 연결 닫기는 `db_connections_follow_window_and_client_lifetimes` ⑥).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn orphan_server_with_only_db_connections_exits_and_closes_them() {
        let _g = SESSION_STATE.lock().await;
        let (dir, list, conn) = db_fixture("db-orphan", "Test9_orph01");
        let pipe = test_pipe();
        let own = os::own_image().unwrap();
        let mut cfg = config(&pipe, None, vec![own], Duration::from_millis(800));
        cfg.db_conns = Some(list.clone());
        let mut server = tokio::spawn(serve::run(cfg));
        let (mut a, _) = connect_retry(&pipe).await;
        ok_body(call(&mut a, 1, Grade::Read, "hello", hello(7, 8)).await);
        ok_body(call(&mut a, 2, Grade::Write, "db_open", json!({ "stream": "orphan-1", "window": "main", "conn": conn })).await);
        assert_eq!(crate::db::table::live_count(), 1);
        drop(a); // 클라이언트 0 — DB 연결은 떨어진 세션으로 남는다(TTL 없음) · 서버가 산다
        assert!(tokio::time::timeout(Duration::from_secs(3), &mut server).await.is_err(), "떨어진 DB 타일이 있는데 서버가 끝났다");
        assert_eq!(crate::db::table::kept_count(), 1);
        // 사람이 떨어진 세션 목록에서 [닫기] — 그 뒤로는 고아 시계대로 끝난다.
        let (mut c, _) = connect_retry(&pipe).await;
        ok_body(call(&mut c, 1, Grade::Read, "hello", hello(7, 8)).await);
        assert_eq!(ok_body(call(&mut c, 2, Grade::Write, "close_detached", json!({ "stream": "orphan-1" })).await), true);
        assert_eq!(crate::db::table::live_count(), 0);
        drop(c);
        let exit = tokio::time::timeout(Duration::from_secs(10), server).await.expect("서버가 끝나지 않았다").unwrap();
        assert!(matches!(exit, serve::Exit::Shutdown(ref r) if r.contains("idle")), "{exit:?}");
        assert_eq!(crate::db::table::live_count(), 0, "끝날 때 DB 연결이 남았다");
        crate::db::conns::set_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// **서버 안 자동 승인의 진입점은 하나**(③-4) — 사전 정책 자동 승인 시계(`operations::auto::sweep`)는 파이프의 승인 프레임이 아니라
/// 서버 안의 함수 호출 `approve_in(…, Some("auto"))` 하나로 간다. 소스를 훑어 고정한다: `approve_in(` 을 부르는 곳은 파이프 op
/// `ops_approve`(server/ai.rs)와 그 시계(operations/auto.rs) 둘뿐이고 시계 쪽은 `"auto"` 만 싣는다 · 몸 `approve_in_with(` 는 `approve_in`
/// 만 부른다 · MCP 소스에는 승인·자동 승인·검토 중 op 로 가는 길이 없다. 승인 등급 프레임은 여전히 `approve_operation` 하나다
/// (`approve_frames_come_from_one_place`).
#[test]
fn auto_approve_has_one_entry() {
    /// 시험 모듈·주석·문서 줄을 뺀 실제 호출 자리 `(파일, 그 줄)`.
    fn calls<'a>(files: &'a [(String, String)], needle: &str) -> Vec<(&'a str, String)> {
        let mut out = Vec::new();
        for (rel, text) in files {
            if rel.ends_with("/tests.rs") || rel.contains("/tests/") {
                continue;
            }
            let body = without_test_module(text);
            for line in body.lines() {
                let t = line.trim_start();
                if t.starts_with("//") || line.contains('`') || line.contains("fn ") {
                    continue;
                }
                if line.contains(needle) {
                    out.push((rel.as_str(), line.to_string()));
                }
            }
        }
        out
    }
    let files = rust_sources();

    let approve_in: Vec<_> = calls(&files, "approve_in(");
    let mut where_: Vec<&str> = approve_in.iter().map(|(f, _)| *f).collect();
    where_.sort();
    assert_eq!(where_, vec!["src/operations/auto.rs", "src/server/ai.rs"], "{approve_in:?}");
    let (_, timer_line) = approve_in.iter().find(|(f, _)| *f == "src/operations/auto.rs").unwrap();
    assert!(timer_line.contains("Some(\"auto\""), "시계는 auto 만 싣는다: {timer_line}");

    let with: Vec<_> = calls(&files, "approve_in_with(");
    assert_eq!(with.iter().map(|(f, _)| *f).collect::<Vec<_>>(), vec!["src/operations/approval.rs"], "{with:?}");

    for (rel, text) in &files {
        let mcp = rel.starts_with("src/mcp/") || rel == "src/mcp.rs";
        if !mcp {
            continue;
        }
        for needle in ["approve_in", "operations::auto", "ops_reviewing", "set_reviewing", "ops_approve", "request_approve"] {
            assert!(!text.contains(needle), "MCP 소스 {rel} 에 {needle}");
        }
    }
}
