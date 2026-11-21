//! 파이프 위의 **프레임 셋**과 판 협상 — 순수(입출력은 [`read_frame`]·[`write_frame`] 두 함수뿐).
//!
//! ```text
//! [u32 LE 길이][JSON 한 덩어리]          길이 상한 MAX_FRAME (넘으면 끊는다) — 몸의 첫 바이트가 `{`
//!   {"t":"request","id":7,"kind":"read","op":"ping","body":null}
//!   {"t":"response","id":7,"ok":true,"body":{...}}              실패면 "error":{"code","message"}
//!   {"t":"event","seq":3,"name":"…","body":{...}}                서버 → 클라이언트, seq 는 연결마다 1부터
//!   {"t":"ack","stream":"…","sessionEpoch":1,"leaseEpoch":2,"consumed":4096}   클라이언트 → 서버(판 2, 응답 없음)
//! [u32 LE 길이][0x01][u32 LE 머리 길이][머리 JSON][바이트…]      출력 스트림(판 2) — 서버 → 클라이언트, base64 없음
//!   머리 = {"stream":"…","sessionEpoch":1,"leaseEpoch":2,"offset":8192}
//! [u32 LE 길이][0x02][u64 LE 채널 번호][바이트…]                 채널 터널(판 5) — **양방향**, 0 바이트 = 그 방향의 끝(EOF)
//!   {"t":"chanack","chan":3,"consumed":65536}                     채널 크레딧(판 5) — 받은 쪽이 소비한 누적 바이트(양방향)
//! ```
//!
//! - JSON 프레임은 늘 `{` 로 시작하므로 첫 바이트 하나로 가른다. 채널 터널의 흐름 제어는 출력/ACK 와 같은 규칙을 양방향으로 쓴다.
//! - **등급**: 같은 exe 라는 확인은 "사람이 승인했다" 의 증명이 아니라서 요청마다 등급을 싣고, 서버는 op 가 요구하는 등급과
//!   **정확히 같을 때만** 받는다([`required_grade`]). `Approve` 를 요구하는 op 는 **`ops_approve` 하나뿐**이다 — 승인 프레임을
//!   만드는 코드는 GUI 의 Tauri 명령 `approve_operation` 하나다(시험 `approve_frames_come_from_one_place`). 서버는 승인 프레임을
//!   믿고 끝내지 않는다 — 만료·상한·자동 승인 정책·대상별 자동 실행 권한·빈도 한도를 **서버가 다시** 본다.
//! - **판에 무관한 op 둘** — `hello`·`shutdown` 의 요청 모양은 판이 바뀌어도 **바꾸지 않는다**. 판이 어긋난 GUI 도
//!   그 서버를 정상 종료시킬 수 있어야 사람이 "새 서버로" 를 고를 수 있다(조용한 교체 없음).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// 이 빌드가 말하는 프로토콜 판 범위. 프레임·op 의 모양을 바꾸면 `MAX` 를 올리고, 옛 판을 더 말하지 않게 되면 `MIN` 을 올린다.
///
/// 판 8 부터 **`MIN` 을 올리지 않는다** — 옛 op 의 모양은 그대로 두고 새 op · 칸만 늘린다. 새 GUI 는 옛 서버에 그대로 붙어 셸·SSH
/// 세션을 잃지 않고, 아래 `*_PROTOCOL` 표지보다 낮은 서버에는 그 op · 칸을 보내지 않는다(`[server-outdated]`). 판 7 이하 서버는 세션을
/// 쥐고 있을 수 있어 조용히 갈지 않는다 — 판 불일치로 사람의 [다시 시작] 을 기다린다(`client::SESSIONLESS_MAX`).
pub(crate) const PROTOCOL_MIN: u32 = 7;
/// 옛 서버는 모르는 칸을 **버린다** — 칸을 더할 때 버려지면 위험한 것(예: `autoCommit` · `readOnly` · `files` · `remember`)은 표지를 두고
/// 옛 서버에 보내지 않는다.
pub(crate) const PROTOCOL_MAX: u32 = 37;

/// 이하 `*_PROTOCOL` = 그 op · 칸이 서는 판. 낮으면 그 op 만 보내지도 받지도 않는다(표지만인 것은 따로 적는다).
pub(crate) const DB_PROTOCOL: u32 = 8;

pub(crate) const DB_TX_PROTOCOL: u32 = 9;

pub(crate) const DB_SCRIPT_PROTOCOL: u32 = 10;

/// 표지만 — MCP 가 DB 도구를 내는 판.
pub(crate) const DB_AI_PROTOCOL: u32 = 11;

/// 표지만 — AI 의 DB 쓰기 작업안을 아는 판.
pub(crate) const DB_WRITE_PLAN_PROTOCOL: u32 = 12;

/// `db_set_write` 의 `autoCommit` — 옛 서버가 버리면 끈 줄 알고 친 문장이 곧바로 커밋된다.
pub(crate) const DB_AUTOCOMMIT_PROTOCOL: u32 = 13;

/// 표지만 — 낮으면 GUI 프록시가 `db_open` 답의 `txVerdicts` 를 거짓으로 둔다(그 서버는 `[db-needs-work]` 를 내지 않는다).
pub(crate) const DB_TX_VERDICT_PROTOCOL: u32 = 14;

/// 표지만 — 낮으면 `db_open` 답의 `txSerial` 이 거짓이다(그 서버는 실행 중 [커밋]을 받아 실행과 겹칠 수 있다).
pub(crate) const DB_TX_SERIAL_PROTOCOL: u32 = 15;

pub(crate) const VAULT_VERIFY_PROTOCOL: u32 = 16;

pub(crate) const VIEWER_PROTOCOL: u32 = 17;

pub(crate) const RESOURCE_PROTOCOL: u32 = 18;

/// 판 21 에 보는 창 여럿으로 뜻이 바뀌었다 — 판 19 · 20 서버도 거절한다(옛 임대 하나의 뜻과 섞지 않는다).
pub(crate) const SIDE_CHAT_VIEWERS_PROTOCOL: u32 = 21;

pub(crate) const TILE_PERMISSION_PROTOCOL: u32 = 22;

pub(crate) const TILE_QUESTION_PROTOCOL: u32 = 23;

pub(crate) const TILE_FACE_PROTOCOL: u32 = 24;

pub(crate) const AGENT_SEEN_PROTOCOL: u32 = 25;

pub(crate) const ALBUM_ARCHIVE_PROTOCOL: u32 = 26;

pub(crate) const ALBUM_MERGE_PROTOCOL: u32 = 27;

pub(crate) const DB_TEST_PROTOCOL: u32 = 28;

/// 쿼리 타일이 떨어진 세션 목록에 오르는 판 — 낮으면 GUI 가 복원 알림의 `keep` 에서 DB 열쇠를 뺀다.
pub(crate) const DETACHED_DB_PROTOCOL: u32 = 29;

/// `db_query` 의 `readOnly` — 옛 서버는 깃발을 버리고 타일 모드대로 돈다.
pub(crate) const DB_READ_QUERY_PROTOCOL: u32 = 30;

pub(crate) const SIDE_CHAT_SEEN_PROTOCOL: u32 = 31;

/// `side_chat_send` 의 `files` — 옛 서버는 칸을 버린다(사람이 붙인 파일이 소리 없이 빠진다).
pub(crate) const SIDE_CHAT_FILES_PROTOCOL: u32 = 32;

/// 낮으면 GUI 프록시가 옛 모양(`stream` · `link` · `linkName`)으로 옮기고 둘 이상 연결은 보내지 않는다.
pub(crate) const SIDE_CHAT_LINKS_PROTOCOL: u32 = 33;

pub(crate) const MESSENGER_BOT_PROTOCOL: u32 = 34;

/// 판 34 서버는 몸의 `channel` 을 Telegram 으로 다룰 수 있다.
pub(crate) const DISCORD_BOT_PROTOCOL: u32 = 35;

pub(crate) const SLACK_BOT_PROTOCOL: u32 = 36;

/// 옛 서버는 `side_chat_decide` 의 `remember` 를 버린다(허용 한 번으로 끝난다).
pub(crate) const SIDE_CHAT_PERM_PROTOCOL: u32 = 37;

pub(crate) const PRODUCER_PROTOCOL: u32 = 20;

/// 몸의 첫 바이트 — JSON 프레임은 `{`(0x7B)로 시작한다.
const OUTPUT_TAG: u8 = 0x01;
const CHANNEL_TAG: u8 = 0x02;

/// 출력 스트림도 이 안에서 쪼갠다.
pub(crate) const MAX_FRAME: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

impl ProtocolRange {
    pub(crate) const OURS: ProtocolRange = ProtocolRange {
        min: PROTOCOL_MIN,
        max: PROTOCOL_MAX,
    };
}

/// 겹친 가장 높은 판 — GUI 가 서버보다 새로워도 겹치면 붙는다(구버전 서버 유지).
pub(crate) fn negotiate(a: ProtocolRange, b: ProtocolRange) -> Option<u32> {
    let lo = a.min.max(b.min);
    let hi = a.max.min(b.max);
    (lo <= hi && a.min <= a.max && b.min <= b.max).then_some(hi)
}

/// 승인 등급은 `ops_approve` 하나뿐이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Grade {
    Read,
    Write,
    Approve,
}

/// `code` 는 기계가 가르는 ASCII, `message` 는 로그·상태용 한 줄(사람 문구는 GUI 가 만든다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WireError {
    pub code: String,
    pub message: String,
}

impl WireError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        WireError {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// 클라이언트가 이 글자로 가른다.
pub(crate) mod code {
    pub const PROTOCOL_MISMATCH: &str = "protocol-mismatch";
    pub const NEED_HELLO: &str = "need-hello";
    pub const UNKNOWN_OP: &str = "unknown-op";
    pub const GRADE_MISMATCH: &str = "grade-mismatch";
    pub const APPROVE_REFUSED: &str = "approve-refused";
    pub const BAD_BODY: &str = "bad-body";
    /// `message` 는 사람 문구 — 세션 코어의 이유 코드(`[stale-lease]` 등)를 그대로 싣는다.
    pub const SESSION: &str = "session";
}

/// `offset` = 첫 바이트의 오프셋(꼬리 링 축).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputHeader {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
    pub offset: u64,
    /// 시청자 싱크의 GUI 경로 번호 — 없으면 주 임대의 프레임.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<u64>,
}

/// 옛 임대의 ACK 는 서버가 버린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ack {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
    pub consumed: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub(crate) enum Frame {
    Request {
        id: u64,
        kind: Grade,
        op: String,
        #[serde(default)]
        body: Value,
    },
    Response {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<WireError>,
    },
    Event {
        seq: u64,
        name: String,
        #[serde(default)]
        body: Value,
    },
    /// 응답이 없다.
    Ack(Ack),
    /// JSON 이 아니라 이진 프레임으로 오간다.
    #[serde(skip)]
    Output { header: OutputHeader, bytes: Vec<u8> },
    /// 0 바이트 = 그 방향의 끝. 이진 프레임.
    #[serde(skip)]
    Channel { chan: u64, bytes: Vec<u8> },
    /// 응답이 없다.
    #[serde(rename = "chanack")]
    ChanAck { chan: u64, consumed: u64 },
}

impl Frame {
    pub(crate) fn ok(id: u64, body: Value) -> Frame {
        Frame::Response {
            id,
            ok: true,
            body: Some(body),
            error: None,
        }
    }

    pub(crate) fn err(id: u64, e: WireError) -> Frame {
        Frame::Response {
            id,
            ok: false,
            body: None,
            error: Some(e),
        }
    }
}

/// 모르면 `None`.
pub(crate) fn required_grade(op: &str) -> Option<Grade> {
    match op {
        "hello" | "ping" | "status" => Some(Grade::Read),
        "shutdown" => Some(Grade::Write),
        "probe" | "local_cwd" | "stats" | "live_streams" | "sessions_detached" => Some(Grade::Read),
        "open" | "write" | "resize" | "close" | "attach" | "detach" | "checkpoint"
        | "restore_done" | "close_detached" | "session_ai_read" | "detach_window" | "close_window" | "adopt" | "set_home"
        | "close_all" => Some(Grade::Write),
        "attach_viewer" | "detach_viewer" => Some(Grade::Write),
        "claim_size" => Some(Grade::Write),
        // `ssh_exec` 는 원시 send_command 가 아니다 — 부르는 쪽은 GUI Rust 의 고정 조립 함수뿐, 프런트·MCP 에는 이 op 로 가는 길이 없다.
        "ssh_info" | "ssh_log_path" | "forward_list" | "ssh_alias" | "ssh_find" => Some(Grade::Read),
        "open_ssh" | "forward_add" | "forward_remove" | "worktree_answer" | "headless_open" | "headless_close"
        | "ssh_exec" | "ssh_exec_cancel" | "chan_open" | "chan_close" | "ssh_copy_id" => Some(Grade::Write),
        // 신호 토큰은 파이프를 타지 않는다 — 토큰 op 는 없다.
        "agent_states_snapshot" | "agent_conversation_links" => Some(Grade::Read),
        "agent_state_forget" | "agent_state_interrupt" | "agent_state_seen" | "agent_conversation_launched" => Some(Grade::Write),
        // 볼트: **값을 돌려주는 op 는 없다**.
        "vault_status" | "vault_list" | "vault_has" => Some(Grade::Read),
        "vault_create" | "vault_unlock" | "vault_verify_master" | "vault_lock" | "vault_set_master" | "vault_store" | "vault_delete"
        | "vault_delete_all" | "vault_prune" | "mcp_prepare" | "mcp_retain" => {
            Some(Grade::Write)
        }
        // **승인은 `ops_approve` 하나**. `mcp_token` 은 `mcp.json` 에 이미 평문인 앱 소유 값이다. `mcp_tile_token` 은 GUI Rust 가
        // 그 타일의 `--mcp-config` 에만 쓴다(프런트 명령 없음).
        "mcp_coords" | "mcp_token" | "mcp_tile_token" | "mcp_activity" | "mcp_tools" | "mcp_calls" | "console_sessions" | "ops_list"
        | "ops_results" | "audit_status" | "agent_mcp_claims" => Some(Grade::Read),
        "ctx_batch" | "ops_reject" | "ops_modify_targets" | "ops_cancel" | "agent_mcp_claim" | "ops_reviewing"
        | "ops_unseen_take" => Some(Grade::Write),
        "ops_approve" => Some(Grade::Approve),
        // 오케스트레이션: 승인 등급 op 는 없다 — 사람의 [병합] · [검증 실행] 등도 쓰기 등급이지 작업안 승인과 다른 길이다.
        // 걷은 op 는 등급 표에도 없다(시험 `orchestration_ops_all_have_grades` 가 `ops::is_op` 와 맞춘다).
        "orchestration_snapshot" | "orchestration_run" => Some(Grade::Read),
        "orchestration_report_drift" => Some(Grade::Read),
        "orchestration_pause" | "orchestration_resume" | "orchestration_stop" | "orchestration_set_task_state"
        | "orchestration_stop_worker"
        | "orchestration_wt_remove" => Some(Grade::Write),
        "orchestration_archive_list" => Some(Grade::Read),
        "orchestration_archive" | "orchestration_restore" | "orchestration_delete_archived" => Some(Grade::Write),
        "orchestration_review_task" => Some(Grade::Write),
        "orchestration_worker_activity" | "orchestration_worker_transcript" => Some(Grade::Read),
        "orchestration_notices" => Some(Grade::Read),
        "orchestration_notices_ack" => Some(Grade::Write),
        "orchestration_complete_run" | "orchestration_release_hold" | "orchestration_cancel_integration" => Some(Grade::Write),
        "orchestration_report_files" => Some(Grade::Read),
        "orchestration_reconcile_preview" => Some(Grade::Read),
        "orchestration_reconcile" | "orchestration_export" => Some(Grade::Write),
        "orchestration_merge_preview" => Some(Grade::Read),
        "orchestration_merge" => Some(Grade::Write),
        "orchestration_approve_verify" | "orchestration_override_verify" => Some(Grade::Write),
        "orchestration_cleanup_preview" => Some(Grade::Read),
        "orchestration_cleanup" | "orchestration_discard_temp" => Some(Grade::Write),
        // `db_query` 는 읽기 전용 모드여도 사람이 친 글자를 엔진에 넣으므로 쓰기.
        "db_schema" | "db_objects" | "db_table_detail" | "db_definition" => Some(Grade::Read),
        "db_open" | "db_test" | "db_query" | "db_cancel" | "db_set_write" | "db_close" | "db_tx" | "db_script" => Some(Grade::Write),
        // 관찰 임대를 갱신하지만 세션 · 파일 · 권한은 바꾸지 않는다.
        "resource_snapshot" => Some(Grade::Read),
        // 사이드 채팅 · 프로듀서 채팅의 권한 결정 · 권한 모드도 승인 등급 프레임이 아니다 — 작업안 승인과 다른 길.
        "side_chat_attach" | "side_chat_list" => Some(Grade::Read),
        "side_chat_open" | "side_chat_send" | "side_chat_interrupt" | "side_chat_set_model" | "side_chat_set_effort"
        | "side_chat_decide" | "side_chat_close" | "side_chat_link" => Some(Grade::Write),
        "side_chat_seen" => Some(Grade::Write),
        "side_chat_set_perm_mode" | "side_chat_forget_allow" => Some(Grade::Write),
        "producer_chat_attach" | "producer_chat_status" | "producer_chat_list" | "producer_fork_probe" | "orchestration_album_defaults" => Some(Grade::Read),
        "orchestration_album_widen" | "orchestration_album_set" | "orchestration_rename_album" => Some(Grade::Write),
        "producer_album_start" | "orchestration_artist_remove" => Some(Grade::Write),
        "producer_chat_open" | "producer_chat_send" | "producer_chat_interrupt" | "producer_chat_set_model" | "producer_chat_set_effort"
        | "producer_chat_decide" | "producer_chat_queue_cancel" | "producer_chat_close" | "producer_chat_subscribe"
        | "producer_chat_unsubscribe" => Some(Grade::Write),
        // 타일 권한 카드의 결정은 **승인 등급 프레임이 아니다** — CLI 훅의 응답으로만 가고 PTY 에 쓰지 않는다.
        "tile_permission_snapshot" => Some(Grade::Read),
        "tile_permission_decide" | "tile_permission_face" => Some(Grade::Write),
        // 메신저 다리는 **승인 등급 프레임이 아니다** — 다리에는 작업안 승인으로 가는 길이 없다.
        "messenger_bot_status" => Some(Grade::Read),
        "messenger_bot_set_token" | "messenger_bot_pair" | "messenger_bot_unpair" | "messenger_bot_test" | "messenger_bot_notify"
        | "messenger_bot_label" => {
            Some(Grade::Write)
        }
        _ => None,
    }
}

/// 모양이 판에 무관하다(머리말).
pub(crate) fn version_free(op: &str) -> bool {
    matches!(op, "hello" | "shutdown")
}

pub(crate) fn check_grade(op: &str, kind: Grade) -> Result<(), WireError> {
    if kind == Grade::Approve && required_grade(op) != Some(Grade::Approve) {
        return Err(WireError::new(
            code::APPROVE_REFUSED,
            "approve frames are accepted only for ops_approve",
        ));
    }
    match required_grade(op) {
        None => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
        Some(g) if g != kind => Err(WireError::new(
            code::GRADE_MISMATCH,
            format!("op {op} requires {g:?}, got {kind:?}"),
        )),
        Some(_) => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Hello {
    pub protocol: ProtocolRange,
    pub app_version: String,
    pub client: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Welcome {
    pub protocol: u32,
    pub server_pid: u32,
    pub app_version: String,
    pub started_at_ms: u64,
    pub launch_mode: String,
    /// 못 띄웠으면 `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal_port: Option<u16>,
}

/// 길이 접두 포함.
pub(crate) fn encode(frame: &Frame) -> std::io::Result<Vec<u8>> {
    if let Frame::Channel { chan, bytes } = frame {
        let n = 1 + 8 + bytes.len();
        if n > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut buf = Vec::with_capacity(4 + n);
        buf.extend_from_slice(&(n as u32).to_le_bytes());
        buf.push(CHANNEL_TAG);
        buf.extend_from_slice(&chan.to_le_bytes());
        buf.extend_from_slice(bytes);
        return Ok(buf);
    }
    if let Frame::Output { header, bytes } = frame {
        let head = serde_json::to_vec(header).map_err(std::io::Error::other)?;
        let n = 1 + 4 + head.len() + bytes.len();
        if n > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut buf = Vec::with_capacity(4 + n);
        buf.extend_from_slice(&(n as u32).to_le_bytes());
        buf.push(OUTPUT_TAG);
        buf.extend_from_slice(&(head.len() as u32).to_le_bytes());
        buf.extend_from_slice(&head);
        buf.extend_from_slice(bytes);
        return Ok(buf);
    }
    let body = serde_json::to_vec(frame).map_err(std::io::Error::other)?;
    if body.len() > MAX_FRAME {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut buf = Vec::with_capacity(4 + body.len());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    Ok(buf)
}

/// 바이트(길이 접두 뒤의 몸)를 프레임으로.
pub(crate) fn decode(body: &[u8]) -> std::io::Result<Frame> {
    if body.first() == Some(&CHANNEL_TAG) {
        if body.len() < 9 {
            return Err(std::io::Error::other("short channel frame"));
        }
        let mut id = [0u8; 8];
        id.copy_from_slice(&body[1..9]);
        return Ok(Frame::Channel {
            chan: u64::from_le_bytes(id),
            bytes: body[9..].to_vec(),
        });
    }
    if body.first() == Some(&OUTPUT_TAG) {
        let rest = &body[1..];
        if rest.len() < 4 {
            return Err(std::io::Error::other("short output frame"));
        }
        let hl = u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        let rest = &rest[4..];
        if hl > rest.len() {
            return Err(std::io::Error::other("bad output header length"));
        }
        let header: OutputHeader = serde_json::from_slice(&rest[..hl]).map_err(std::io::Error::other)?;
        return Ok(Frame::Output { header, bytes: rest[hl..].to_vec() });
    }
    serde_json::from_slice(body).map_err(std::io::Error::other)
}

pub(crate) async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, frame: &Frame) -> std::io::Result<()> {
    let buf = encode(frame)?;
    w.write_all(&buf).await?;
    w.flush().await
}

/// 프레임 한 장을 읽는다. 깨끗한 EOF(길이 앞에서 끊김)는 `Ok(None)`.
pub(crate) async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<Frame>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_FRAME {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; n];
    r.read_exact(&mut body).await?;
    decode(&body).map(Some)
}
