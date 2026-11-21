//! 에이전트 훅 신호 — 에이전트 CLI(Claude Code · Codex)의 훅이 턴 시작 · 도구 · 입력 대기 · 턴 끝을 한 줄로 알려 오는 길 (docs/log/2026-09-24-agent-hook-signals.md).
//! 설치기는 `crate::agent_hooks`.
//!
//! MCP 도구가 아니다 — 같은 문지기를 지나는 다른 경로(`POST /agent-signal`)이고, 에이전트 상태 표 갱신과 UI 신호 하나뿐이라 작업안 · 세션 · 승인 어떤 상태도 바꾸지 않는다.
//! 받은 것은 로그 · 파일에 남기지 않는다. 소켓은 세션 서버 프로세스의 신호 전용 포트이고, GUI 는 파이프 op(`crate::server::signals`)로만 이 표에 닿는다.
//!
//! ## 신호 전용 토큰 — 원격 타일에 MCP 토큰을 주지 않는다
//!
//! 원격 셸에 MCP 토큰을 두면 원격 포워드를 타고 이 PC 의 MCP 전체가 그 서버의 root · `ps` 를 읽는 다른 사용자에게까지 열린다. 그래서 타일(스트림)마다
//! 따로 뽑는 좁은 토큰을 둔다 — 이 경로에서만, 자기 스트림의 신호에만 통한다(→ docs/invariants.md 전문 11). 로컬 타일도 모두 신호 토큰을 받는다
//! (AI 타일이 아닌 셸에서 손으로 친 `claude` 도 신호를 보내게). 신호 포트는 MCP 토큰을 받지 않는다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};

use crate::tile_env::stream_ok;

pub(crate) const PATH: &str = "/agent-signal";

/// 창으로 내보내는 Tauri 이벤트 이름 — `src/lib/app/agent-status.svelte.ts` 가 듣는다.
pub(crate) const EVENT: &str = "agent-signal";

pub(crate) const MAX_BODY_BYTES: usize = 4 * 1024;

/// 자유 글자는 받지 않는다 — CLI 의 알림 문구가 창으로 흐르지 않게, 신호 토큰을 쥔 누군가가 앱 화면에 제 글자를 싣지 못하게.
/// 모르는 값은 없는 것으로 치되 신호 자체는 받는다.
pub(crate) const WAITING_DETAILS: &[&str] = &["permission", "idle", "other"];

/// 설치기가 명령 인자로 박는 `crate::agent_hooks::TARGETS` 의 id. 신호 토큰이 그 타일의 스트림에만 통하므로 화면은 이것으로 그 타일을 그 CLI 의 타일로 친다.
pub(crate) const CLI_IDS: &[&str] = &["claude", "codex"];

pub(crate) const VERSION_MAX: u32 = 9999;

pub(crate) const AGENT_ID_MAX_CHARS: usize = 64;

/// 스크립트가 같은 글자로 거르고 여기서 다시 본다. 이 밖의 모양이면 id 가 없는 것으로 친다 — 프런트는 id 없는 서브 에이전트 신호를 세지 않는다.
pub(crate) fn agent_id_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= AGENT_ID_MAX_CHARS
        && s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 훅을 앱 쪽 뜻으로 접은 것(에이전트별 등록은 `crate::agent_hooks::TARGETS`).
/// `tool-done` 이 따로 있다 — 권한 물음을 승인한 뒤에는 다음 도구나 `Stop` 까지 훅이 없어, 승인된 도구가 끝나는 순간이 "다시 일한다" 의 첫 증거다.
/// 메인이 백그라운드 서브 에이전트를 띄워 두고 턴을 끝내면 `Stop` 이 먼저 온다 — 화면은 진행 중 서브 에이전트가 0개일 때만 완료로 친다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SignalEvent {
    Start,
    Tool,
    ToolDone,
    Waiting,
    Stop,
    SubagentStart,
    SubagentStop,
    SessionEnd,
    Session,
    /// 사람이 지금 턴을 끊었다 — 상태를 끝으로 두되 완료 · 알림은 아니다. Claude 는 Esc 에 훅이 없다.
    Interrupt,
}

impl SignalEvent {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "start" => Some(Self::Start),
            "tool" => Some(Self::Tool),
            "tool-done" => Some(Self::ToolDone),
            "waiting" => Some(Self::Waiting),
            "stop" => Some(Self::Stop),
            "subagent-start" => Some(Self::SubagentStart),
            "subagent-stop" => Some(Self::SubagentStop),
            "session-end" => Some(Self::SessionEnd),
            "session" => Some(Self::Session),
            "interrupt" => Some(Self::Interrupt),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Tool => "tool",
            Self::ToolDone => "tool-done",
            Self::Waiting => "waiting",
            Self::Stop => "stop",
            Self::SubagentStart => "subagent-start",
            Self::SubagentStop => "subagent-stop",
            Self::SessionEnd => "session-end",
            Self::Session => "session",
            Self::Interrupt => "interrupt",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentSignal {
    pub stream: String,
    pub event: SignalEvent,
    pub detail: Option<String>,
    /// 에이전트의 대화 id(훅 입력의 `session_id`).
    pub session: Option<String>,
    /// 보낸 훅 스크립트의 판 번호 — 없으면 4판 이하다. 신호 자체는 판과 상관없이 받는다.
    pub version: Option<u32>,
    /// 서브 에이전트 id(훅 입력의 `agent_id`).
    pub agent: Option<String>,
    pub cli: Option<&'static str>,
}

impl AgentSignal {
    /// `hookLatest` 는 이 앱이 설치하는 판 — 기준 수를 프런트에 따로 적지 않게 함께 싣는다(비교는 화면이 한다).
    pub(crate) fn payload(&self, at_ms: i64) -> Value {
        json!({
            "stream": self.stream,
            "event": self.event.as_str(),
            "detail": self.detail,
            "session": self.session,
            "agent": self.agent,
            "cli": self.cli,
            "hookVersion": self.version,
            "hookLatest": crate::agent_hooks::SCRIPT_VERSION,
            "at": at_ms,
        })
    }
}

/// 틀리면 짧은 까닭(응답 본문에 싣는다 — 비밀이 아니다). 선택 칸은 모양이 틀리면 없는 것으로 치고 신호 자체는 받는다.
pub(crate) fn parse(body: &str) -> Result<AgentSignal, &'static str> {
    let v: Value = serde_json::from_str(body).map_err(|_| "bad body")?;
    let obj = v.as_object().ok_or("bad body")?;
    let stream = obj
        .get("stream")
        .and_then(Value::as_str)
        .ok_or("bad stream")?;
    if !stream_ok(stream) {
        return Err("bad stream");
    }
    let event = obj
        .get("event")
        .and_then(Value::as_str)
        .and_then(SignalEvent::from_str)
        .ok_or("unknown event")?;
    let detail = obj
        .get("detail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| event == SignalEvent::Waiting && WAITING_DETAILS.contains(s))
        .map(str::to_owned);
    let session = obj
        .get("session")
        .and_then(Value::as_str)
        .filter(|s| crate::agent_sessions::uuid_shape(s))
        .map(str::to_ascii_lowercase);
    let version = obj
        .get("v")
        .and_then(Value::as_u64)
        .filter(|v| (1..=u64::from(VERSION_MAX)).contains(v))
        .and_then(|v| u32::try_from(v).ok());
    let agent = obj
        .get("agent")
        .and_then(Value::as_str)
        .filter(|s| {
            matches!(
                event,
                SignalEvent::SubagentStart | SignalEvent::SubagentStop
            ) && agent_id_ok(s)
        })
        .map(str::to_owned);
    let cli = obj
        .get("cli")
        .and_then(Value::as_str)
        .and_then(|c| CLI_IDS.iter().copied().find(|id| *id == c));
    Ok(AgentSignal {
        stream: stream.to_owned(),
        event,
        detail,
        session,
        version,
        agent,
        cli,
    })
}

// ── 신호 전용 토큰 (스트림별) ──

/// `Debug` 를 파생하지 않는다 — 토큰이 로그 · 패닉 메시지에 찍히면 안 된다.
pub(crate) struct SignalGrant {
    pub token: String,
    pub stream: String,
    pub owner: u64,
}

impl SignalGrant {
    /// 토큰 값은 세션 표에 남기지 않는다 — 닫을 때 거두는 데 필요한 둘만.
    pub(crate) fn key(&self) -> (String, u64) {
        (self.stream.clone(), self.owner)
    }
}

struct Entry {
    token: String,
    owner: u64,
    /// 원격 타일의 토큰을 뽑아 간 GUI 연결 번호. 로컬 타일은 `None` — 세션이 끝날 때 서버가 스스로 거둔다.
    conn: Option<u64>,
    orphaned_at: Option<u64>,
    last_ms: u64,
    /// 이 주인이 원격 신호 파일(`crate::remote_signal_file`)을 썼다.
    written: bool,
}

/// `crate::remote_signal_file::STALE_AFTER_SECS` 와 같은 나이. 연결만 잠깐 끊긴 타일은 그 사이 신호가 마지막 사용을 밀어 주므로 거두지 않는다.
pub(crate) const ORPHAN_TTL_MS: u64 = 7 * 24 * 3600 * 1000;

/// 한 스트림에는 한 벌만 산다 — 새 세션이 옛 것을 갈아 치우고, 옛 세션의 뒤늦은 닫기는 주인 번호가 달라 새 것을 지우지 못한다.
#[derive(Default)]
pub(crate) struct SignalTokens {
    map: HashMap<String, Entry>,
}

impl SignalTokens {
    pub(crate) fn insert(&mut self, stream: &str, token: String, owner: u64, conn: Option<u64>, now_ms: u64) {
        self.map.insert(
            stream.to_owned(),
            Entry {
                token,
                owner,
                conn,
                orphaned_at: None,
                last_ms: now_ms,
                written: false,
            },
        );
    }

    pub(crate) fn revoke(&mut self, stream: &str, owner: u64) -> Option<bool> {
        if self.map.get(stream).is_some_and(|e| e.owner == owner) {
            return self.map.remove(stream).map(|e| e.written);
        }
        None
    }

    pub(crate) fn note_written(&mut self, stream: &str, owner: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if e.owner == owner => {
                e.written = true;
                true
            }
            _ => false,
        }
    }

    /// 다른 스트림의 토큰은 통하지 않는다. 비교는 상수시간 — 서버 쪽 루프백의 누구나 몇 번이든 두드릴 수 있다.
    pub(crate) fn accepts(&mut self, stream: &str, token: &str, now_ms: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if !e.token.is_empty() && crate::token::ct_eq(e.token.as_bytes(), token.as_bytes()) => {
                e.last_ms = e.last_ms.max(now_ms);
                true
            }
            _ => false,
        }
    }

    /// 거두지 않고 고아로 표시만 한다 — GUI 의 SSH 세션은 연결이 잠깐 끊겨도 살아 있을 수 있다.
    pub(crate) fn orphan_conn(&mut self, conn: u64, now_ms: u64) -> usize {
        let mut n = 0;
        for e in self.map.values_mut() {
            if e.conn == Some(conn) && e.orphaned_at.is_none() {
                e.orphaned_at = Some(now_ms);
                n += 1;
            }
        }
        n
    }

    pub(crate) fn prune(&mut self, now_ms: u64, ttl_ms: u64) -> Vec<String> {
        let stale: Vec<String> = self
            .map
            .iter()
            .filter(|(_, e)| {
                e.orphaned_at
                    .is_some_and(|o| now_ms.saturating_sub(o.max(e.last_ms)) > ttl_ms)
            })
            .map(|(k, _)| k.clone())
            .collect();
        for k in &stale {
            self.map.remove(k);
        }
        stale
    }

    fn contains(&self, stream: &str) -> bool {
        self.map.contains_key(stream)
    }
}

/// 세션 서버 프로세스의 표 — GUI 는 이 표를 만지지 않고 파이프 op(`crate::server::signals`)로만 닿는다. 잠금은 문장 하나 안에서 끝난다.
static TOKENS: LazyLock<Mutex<SignalTokens>> = LazyLock::new(Default::default);

fn tokens() -> std::sync::MutexGuard<'static, SignalTokens> {
    TOKENS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 주인 번호 — 로컬·SSH 세션 id 는 서로 다른 계수기라 겹칠 수 있어 따로 뽑는다.
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

pub(crate) fn issue(stream: &str, conn: Option<u64>) -> Option<SignalGrant> {
    if !stream_ok(stream) {
        return None;
    }
    let token = crate::token::generate_token()?;
    let owner = NEXT_OWNER.fetch_add(1, Ordering::Relaxed);
    tokens().insert(stream, token.clone(), owner, conn, now_ms());
    // 이 스트림의 새 세션이다 — 옛 세션의 에이전트 상태를 물려주지 않는다.
    crate::agent_state::forget(stream);
    Some(SignalGrant {
        token,
        stream: stream.to_owned(),
        owner,
    })
}

/// 부른 쪽은 `Some(true)` 일 때만 원격 신호 파일을 지운다. 주인이 다르면(새 세션이 이미 갈아 치움) 상태도 두고 `None`.
pub(crate) fn revoke(stream: &str, owner: u64) -> Option<bool> {
    let revoked = tokens().revoke(stream, owner);
    if revoked.is_some() {
        crate::agent_state::forget(stream);
    }
    revoked
}

pub(crate) fn note_written(stream: &str, owner: u64) -> bool {
    tokens().note_written(stream, owner)
}

/// 원격 신호 파일 쓸어 내기가 쓰는 세션의 파일을 건드리지 않게.
pub(crate) fn is_live(stream: &str) -> bool {
    tokens().contains(stream)
}

pub(crate) fn orphan_conn(conn: u64) -> usize {
    tokens().orphan_conn(conn, now_ms())
}

pub(crate) fn prune_orphans() -> usize {
    let gone = tokens().prune(now_ms(), ORPHAN_TTL_MS);
    for s in &gone {
        crate::agent_state::forget(s);
    }
    gone.len()
}

pub(crate) fn token_accepts(stream: &str, token: &str) -> bool {
    tokens().accepts(stream, token, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_env::STREAM_MAX_CHARS;

    #[test]
    fn parses_the_seven_events() {
        for (name, ev) in [
            ("start", SignalEvent::Start),
            ("tool", SignalEvent::Tool),
            ("tool-done", SignalEvent::ToolDone),
            ("waiting", SignalEvent::Waiting),
            ("stop", SignalEvent::Stop),
            ("subagent-start", SignalEvent::SubagentStart),
            ("subagent-stop", SignalEvent::SubagentStop),
            ("session-end", SignalEvent::SessionEnd),
            ("session", SignalEvent::Session),
            ("interrupt", SignalEvent::Interrupt),
        ] {
            let s = parse(&format!(r#"{{"stream":"abc123","event":"{name}"}}"#)).unwrap();
            assert_eq!(s.event, ev);
            assert_eq!(s.stream, "abc123");
            assert_eq!(s.detail, None);
            assert_eq!(ev.as_str(), name);
        }
    }

    #[test]
    fn rejects_bad_bodies_streams_and_events() {
        assert_eq!(parse("not json"), Err("bad body"));
        assert_eq!(parse("[1,2]"), Err("bad body"));
        assert_eq!(parse(r#"{"event":"stop"}"#), Err("bad stream"));
        assert_eq!(parse(r#"{"stream":"","event":"stop"}"#), Err("bad stream"));
        assert_eq!(
            parse(r#"{"stream":"a\"b","event":"stop"}"#),
            Err("bad stream")
        );
        assert_eq!(
            parse(r#"{"stream":"a b","event":"stop"}"#),
            Err("bad stream")
        );
        let long = "a".repeat(STREAM_MAX_CHARS + 1);
        assert_eq!(
            parse(&format!(r#"{{"stream":"{long}","event":"stop"}}"#)),
            Err("bad stream")
        );
        assert_eq!(
            parse(r#"{"stream":"abc","event":"approve"}"#),
            Err("unknown event")
        );
        assert_eq!(parse(r#"{"stream":"abc"}"#), Err("unknown event"));
        assert_eq!(
            parse(r#"{"stream":"abc","event":"STOP"}"#),
            Err("unknown event")
        );
    }

    #[test]
    fn detail_is_only_a_known_waiting_category() {
        for cat in WAITING_DETAILS {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"waiting","detail":" {cat} "}}"#
            ))
            .unwrap();
            assert_eq!(s.detail.as_deref(), Some(*cat));
        }
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"Claude needs your permission to use Bash"}"#).unwrap();
        assert_eq!(s.event, SignalEvent::Waiting);
        assert_eq!(s.detail, None, "범주가 아닌 글자는 버린다");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":42}"#).unwrap();
        assert_eq!(s.detail, None, "문자열이 아니면 없는 것");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"   "}"#).unwrap();
        assert_eq!(s.detail, None, "빈 문자열도 없는 것");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"PERMISSION"}"#).unwrap();
        assert_eq!(s.detail, None, "대소문자까지 같아야 한다");
        let s = parse(r#"{"stream":"abc","event":"stop","detail":"permission"}"#).unwrap();
        assert_eq!(s.detail, None, "waiting 밖의 이벤트에는 범주가 없다");
    }

    #[test]
    fn payload_carries_stream_event_detail_and_time() {
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"permission"}"#).unwrap();
        let p = s.payload(1234);
        let latest = crate::agent_hooks::SCRIPT_VERSION;
        assert_eq!(
            p,
            json!({"stream":"abc","event":"waiting","detail":"permission","session":null,"agent":null,"cli":null,"hookVersion":null,"hookLatest":latest,"at":1234})
        );
        let s = parse(r#"{"stream":"abc","event":"tool"}"#).unwrap();
        assert_eq!(s.payload(1)["detail"], Value::Null);
    }

    #[test]
    fn script_version_is_optional_and_only_a_small_positive_integer() {
        let s = parse(r#"{"stream":"abc","event":"stop"}"#).unwrap();
        assert_eq!(s.version, None, "옛 스크립트(4판 이하)는 싣지 않는다");
        assert_eq!(s.payload(1)["hookVersion"], Value::Null);
        assert_eq!(
            s.payload(1)["hookLatest"],
            crate::agent_hooks::SCRIPT_VERSION
        );
        let s = parse(r#"{"stream":"abc","event":"tool","v":5}"#).unwrap();
        assert_eq!(s.version, Some(5));
        assert_eq!(s.payload(1)["hookVersion"], 5);
        for bad in [r#""5""#, "0", "-1", "5.5", "10000", "null", "true"] {
            let s = parse(&format!(r#"{{"stream":"abc","event":"start","v":{bad}}}"#)).unwrap();
            assert_eq!(s.version, None, "{bad}");
        }
        let v = crate::agent_hooks::SCRIPT_VERSION;
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"waiting","v":{v},"detail":"permission"}}"#
        ))
        .unwrap();
        assert_eq!(
            (s.version, s.detail.as_deref()),
            (Some(v), Some("permission"))
        );
    }

    #[test]
    fn session_is_only_a_uuid_shaped_id() {
        let id = "11111111-2222-4333-8444-555555555555";
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"start","session":"{}"}}"#,
            id.to_uppercase()
        ))
        .unwrap();
        assert_eq!(s.session.as_deref(), Some(id), "소문자로 편다");
        assert_eq!(s.payload(1)["session"], id);
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"stop","session":"{id}"}}"#
        ))
        .unwrap();
        assert_eq!(s.session.as_deref(), Some(id));
        for bad in [
            r#""""#,
            r#""not-a-uuid""#,
            "42",
            r#""11111111-2222-4333-8444-555555555555 x""#,
            r#""Fix the build""#,
        ] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"start","session":{bad}}}"#
            ))
            .unwrap();
            assert_eq!(s.event, SignalEvent::Start, "신호는 받는다");
            assert_eq!(s.session, None, "{bad}");
        }
    }

    #[test]
    fn agent_id_rides_only_on_subagent_events_and_only_in_its_shape() {
        for ev in ["subagent-start", "subagent-stop"] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"{ev}","v":6,"agent":"agent_xyz-789"}}"#
            ))
            .unwrap();
            assert_eq!(s.agent.as_deref(), Some("agent_xyz-789"), "{ev}");
            assert_eq!(s.payload(1)["agent"], "agent_xyz-789");
            let s = parse(&format!(r#"{{"stream":"abc","event":"{ev}"}}"#)).unwrap();
            assert_eq!(s.agent, None);
            assert_eq!(s.payload(1)["agent"], Value::Null);
        }
        let long = "a".repeat(AGENT_ID_MAX_CHARS + 1);
        assert!(agent_id_ok(&"a".repeat(AGENT_ID_MAX_CHARS)));
        assert!(!agent_id_ok(&long));
        for bad in [
            r#""""#.to_owned(),
            r#""a b""#.to_owned(),
            r#""a\"b""#.to_owned(),
            r#""Explore the project structure""#.to_owned(),
            r#""a.b""#.to_owned(),
            r#""한글""#.to_owned(),
            format!(r#""{long}""#),
            "42".to_owned(),
        ] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"subagent-start","agent":{bad}}}"#
            ))
            .unwrap();
            assert_eq!(s.event, SignalEvent::SubagentStart, "신호는 받는다");
            assert_eq!(s.agent, None, "{bad}");
        }
        let s = parse(r#"{"stream":"abc","event":"stop","agent":"agent_1"}"#).unwrap();
        assert_eq!(s.agent, None, "서브 에이전트 밖의 이벤트에는 id 가 없다");
    }

    #[test]
    fn cli_is_only_one_of_the_known_ids() {
        for id in CLI_IDS {
            let s = parse(&format!(r#"{{"stream":"abc","event":"start","v":8,"cli":"{id}"}}"#)).unwrap();
            assert_eq!(s.cli, Some(*id));
            assert_eq!(s.payload(1)["cli"], *id);
        }
        let s = parse(r#"{"stream":"abc","event":"stop"}"#).unwrap();
        assert_eq!(s.cli, None, "옛 스크립트는 싣지 않는다");
        assert_eq!(s.payload(1)["cli"], Value::Null);
        for bad in [r#""gemini""#, r#""Codex""#, r#"" codex""#, r#""""#, "1", "null", r#"["codex"]"#] {
            let s = parse(&format!(r#"{{"stream":"abc","event":"tool","cli":{bad}}}"#)).unwrap();
            assert_eq!(s.event, SignalEvent::Tool, "신호는 받는다");
            assert_eq!(s.cli, None, "{bad}");
        }
        for t in crate::agent_hooks::TARGETS {
            assert!(CLI_IDS.contains(&t.id), "{}", t.id);
        }
    }

    #[test]
    fn signal_token_is_valid_only_for_its_own_stream() {
        let mut t = SignalTokens::default();
        t.insert("s1", "tok-one".into(), 1, None, 0);
        t.insert("s2", "tok-two".into(), 2, None, 0);
        assert!(t.accepts("s1", "tok-one", 1));
        assert!(t.accepts("s2", "tok-two", 1));
        assert!(
            !t.accepts("s1", "tok-two", 1),
            "남의 스트림 토큰은 통하지 않는다"
        );
        assert!(!t.accepts("s3", "tok-one", 1), "모르는 스트림");
        assert!(!t.accepts("s1", "", 1), "빈 토큰");
        assert!(!t.accepts("s1", "tok-on", 1), "접두사만 맞아도 안 된다");
    }

    #[test]
    fn revoke_only_removes_its_own_grant() {
        let mut t = SignalTokens::default();
        t.insert("s", "old".into(), 1, None, 0);
        t.insert("s", "new".into(), 2, None, 0);
        assert!(!t.accepts("s", "old", 1));
        assert_eq!(t.revoke("s", 1), None);
        assert!(t.accepts("s", "new", 1));
        assert_eq!(t.revoke("s", 2), Some(false));
        assert!(!t.accepts("s", "new", 1));
    }

    #[test]
    fn written_flag_rides_on_the_owner_and_resets_on_reissue() {
        let mut t = SignalTokens::default();
        t.insert("s", "a".into(), 1, Some(7), 0);
        assert!(!t.note_written("s", 2), "남의 주인은 못 적는다");
        assert!(t.note_written("s", 1));
        t.insert("s", "b".into(), 3, Some(7), 0);
        assert_eq!(t.revoke("s", 1), None, "옛 주인은 못 거둔다");
        assert_eq!(t.revoke("s", 3), Some(false), "새 주인은 아직 안 썼다");
        t.insert("s", "c".into(), 4, Some(7), 0);
        assert!(t.note_written("s", 4));
        assert_eq!(t.revoke("s", 4), Some(true));
    }

    #[test]
    fn orphaned_remote_tokens_survive_disconnect_and_are_pruned_after_ttl() {
        const TTL: u64 = 1000;
        let mut t = SignalTokens::default();
        t.insert("remote", "r".into(), 1, Some(5), 0);
        t.insert("busy", "b".into(), 2, Some(5), 0);
        t.insert("other-conn", "o".into(), 3, Some(6), 0);
        t.insert("local", "l".into(), 4, None, 0);
        assert_eq!(t.orphan_conn(5, 100), 2);
        assert_eq!(t.orphan_conn(5, 200), 0, "이미 고아 — 시각을 다시 찍지 않는다");
        assert!(t.accepts("remote", "r", 500));
        assert!(t.accepts("busy", "b", 900));
        assert!(t.prune(600, TTL).is_empty(), "TTL 전");
        let gone = t.prune(1501, TTL);
        assert_eq!(gone, vec!["remote".to_string()]);
        assert!(t.accepts("busy", "b", 1502));
        assert!(t.prune(1_000_000, TTL).contains(&"busy".to_string()));
        assert!(t.contains("other-conn"), "다른 연결의 토큰");
        assert!(t.contains("local"), "로컬 토큰은 세션 수명이 거둔다");
    }

    #[test]
    fn issue_needs_a_valid_stream_and_revoke_drops_it() {
        assert!(
            issue("bad stream", None).is_none(),
            "모양이 틀린 스트림에는 뽑지 않는다"
        );
        let g = issue("agent-signal-test-issue", None).unwrap();
        assert_eq!(g.token.len(), 64, "32바이트 hex");
        assert!(token_accepts("agent-signal-test-issue", &g.token));
        let (stream, owner) = g.key();
        assert!(is_live(&stream));
        assert_eq!(revoke(&stream, owner + 1), None, "남의 주인 번호로는 못 거둔다");
        assert_eq!(revoke(&stream, owner), Some(false));
        assert!(!is_live(&stream));
        assert!(!token_accepts("agent-signal-test-issue", &g.token));
    }

    #[test]
    fn agent_state_follows_the_token_lifecycle() {
        const S: &str = "agent-signal-test-state";
        let has = || crate::agent_state::snapshot().iter().any(|(k, _)| k == S);
        let start = parse(&format!(r#"{{"stream":"{S}","event":"start"}}"#)).unwrap();
        let old = issue(S, Some(1)).unwrap();
        crate::agent_state::record(&start, 1);
        assert!(has());
        let new = issue(S, Some(1)).unwrap();
        assert!(!has(), "발급이 비운다");
        crate::agent_state::record(&start, 2);
        let (stream, owner) = old.key();
        revoke(&stream, owner);
        assert!(has(), "옛 주인의 닫기는 지우지 못한다");
        let (stream, owner) = new.key();
        revoke(&stream, owner);
        assert!(!has(), "주인의 닫기가 지운다");
    }
}
