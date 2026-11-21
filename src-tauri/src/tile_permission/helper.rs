//! 훅 도우미 — `aynx agent-permission <pre|ask|post> <claude|codex>`(`main.rs` 가 Tauri 앞에서 가른다 · 창 · 런타임 없음).
//!
//! - 환경 셋 중 하나라도 없거나 모양이 틀리면 **표준 입력도 읽지 않고 0** — Aynx 밖에서 띄운 CLI · 헤드리스(정화된 환경)는 기다리지 않는다.
//! - 대조 요약 `digest` 는 **자르기 전** 입력에서 · `pre` · `post` 는 본문을 싣지 않는다.
//! - 무엇이 실패하든(연결 · 시한 · 401 · 413) 빈 출력 0 — CLI 는 평소 창으로 물러난다(안전한 기본).
//! - 토큰은 환경에서만 읽어 요청 머리(`Authorization`)로만 — 명령줄 · 출력 · 로그에 없다.
//! - `interrupt codex` 는 권한 경로가 아니라 **신호 경로**로 그 타일의 **신호 전용 토큰**을 써 `interrupt` 하나만 보낸다(상태 점 전용 그대로) — 권한 결정 토큰은 쓰지 않는다.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{input_digest, Cli, Phase, HOLD_MS, MAX_BODY_BYTES};

/// 넘치면 본문 없는 카드(`input: null` · `truncated`).
const STDIN_MAX: usize = 32 * 1024 * 1024;
/// 서버의 시한(Claude 10분)보다 조금 길게.
const ASK_OVERALL: Duration = Duration::from_secs(11 * 60);

pub(crate) fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    if args.first().map(String::as_str) == Some(super::INTERRUPT_STEP) {
        return interrupt_main(args.get(1).map(String::as_str));
    }
    let (Some(phase), Some(cli)) = (
        args.first().and_then(|p| Phase::parse(p)).filter(|p| *p != Phase::Wait),
        args.get(1).and_then(|c| Cli::parse(c)),
    ) else {
        return 0;
    };
    let Some(env) = Env::from_process() else { return 0 };
    let mut raw = Vec::new();
    let _ = std::io::stdin().take(STDIN_MAX as u64 + 1).read_to_end(&mut raw);
    let phase = effective_phase(phase, cli, &raw);
    let Some(body) = envelope(phase, cli, &raw) else { return 0 };
    if let Some(out) = run(&env, phase, &body) {
        let mut so = std::io::stdout();
        let _ = so.write_all(out.as_bytes());
        let _ = so.flush();
    }
    0
}

/// Codex 질문은 `pre` 가 곧 `ask` — `request_user_input` 에는 `PermissionRequest` 가 오지 않는다(실패면 빈 출력 — TUI 가 평소 질문 상자를 띄운다).
fn effective_phase(phase: Phase, cli: Cli, raw: &[u8]) -> Phase {
    if phase != Phase::Pre || cli != Cli::Codex || raw.len() > STDIN_MAX {
        return phase;
    }
    let tool = serde_json::from_slice::<Value>(raw).ok().and_then(|v| v.get("tool_name").and_then(Value::as_str).map(str::to_owned));
    if tool.as_deref() == Some("request_user_input") {
        Phase::Ask
    } else {
        phase
    }
}

/// 훅 환경 셋 — 하나라도 모양이 틀리면 없는 것.
struct Env {
    port: u16,
    stream: String,
    token: String,
}

impl Env {
    fn from_process() -> Option<Self> {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Self::parse(
            get(crate::tile_env::MCP_URL_ENV).as_deref(),
            get(crate::tile_env::STREAM_ENV).as_deref(),
            get(crate::tile_env::PERMISSION_TOKEN_ENV).as_deref(),
        )
    }

    fn parse(url: Option<&str>, stream: Option<&str>, token: Option<&str>) -> Option<Self> {
        let port = url?.strip_prefix("http://127.0.0.1:")?.parse::<u16>().ok().filter(|p| *p != 0)?;
        let stream = stream.filter(|s| crate::tile_env::stream_ok(s))?.to_string();
        let token = token.filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))?.to_string();
        Some(Self { port, stream, token })
    }
}

/// 환경(주소 · 스트림 · **신호 전용 토큰**)이 없으면 표준 입력도 읽지 않는다.
fn interrupt_main(cli: Option<&str>) -> i32 {
    let Some(cli) = cli.and_then(Cli::parse) else { return 0 };
    let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let Some(env) = Env::parse(
        get(crate::tile_env::MCP_URL_ENV).as_deref(),
        get(crate::tile_env::STREAM_ENV).as_deref(),
        get(crate::tile_env::SIGNAL_TOKEN_ENV).as_deref(),
    ) else {
        return 0;
    };
    let mut raw = Vec::new();
    let _ = std::io::stdin().take(64 * 1024).read_to_end(&mut raw);
    let body = interrupt_body(&env.stream, cli, &raw);
    let _ = post_to(&env, crate::agent_signal::PATH, &body, Duration::from_secs(2));
    0
}

/// 스트림 · 이벤트 · CLI · 대화 id 말고는 싣지 않는다.
pub(crate) fn interrupt_body(stream: &str, cli: Cli, raw: &[u8]) -> String {
    let session = serde_json::from_slice::<Value>(raw)
        .ok()
        .and_then(|v| v.get("session_id").and_then(Value::as_str).map(str::to_owned));
    json!({ "stream": stream, "event": "interrupt", "cli": cli.as_str(), "session": session }).to_string()
}

fn cut_strings(v: &mut Value, max: usize) -> bool {
    match v {
        Value::String(s) if s.chars().count() > max => {
            let t: String = s.chars().take(max).collect();
            *s = format!("{t}…");
            true
        }
        Value::Array(a) => a.iter_mut().fold(false, |acc, x| cut_strings(x, max) | acc),
        Value::Object(o) => o.values_mut().fold(false, |acc, x| cut_strings(x, max) | acc),
        _ => false,
    }
}

pub(crate) fn envelope(phase: Phase, cli: Cli, raw: &[u8]) -> Option<String> {
    let mut truncated = raw.len() > STDIN_MAX;
    let parsed: Value = if truncated { Value::Null } else { serde_json::from_slice(raw).ok()? };
    let tool = parsed.get("tool_name").and_then(Value::as_str);
    if !truncated && tool.is_none() {
        return None;
    }
    let tool = tool.unwrap_or("unknown").to_string();
    let input = parsed.get("tool_input").cloned().unwrap_or(Value::Null);
    let digest = input_digest(&input);
    let s = |k: &str| parsed.get(k).and_then(Value::as_str).map(str::to_owned);
    let mut body = json!({
        "v": 1,
        "cli": cli.as_str(),
        "session": s("session_id"),
        "tool": tool,
        "toolUseId": s("tool_use_id"),
        "digest": digest,
    });
    if phase == Phase::Ask {
        let o = body.as_object_mut()?;
        o.insert("cwd".into(), json!(s("cwd")));
        o.insert("permissionMode".into(), json!(s("permission_mode")));
        o.insert("mcpServer".into(), parsed.get("mcp_server").cloned().unwrap_or(Value::Null));
        o.insert("suggestions".into(), parsed.get("permission_suggestions").cloned().unwrap_or(Value::Null));
        let budget = MAX_BODY_BYTES - 8 * 1024;
        let mut shown = input;
        for max in [usize::MAX, 16 * 1024, 2 * 1024, 0] {
            if max == 0 {
                shown = Value::Null;
                truncated = true;
            } else if max != usize::MAX {
                truncated |= cut_strings(&mut shown, max);
            }
            o.insert("input".into(), shown.clone());
            o.insert("truncated".into(), json!(truncated));
            if serde_json::to_string(&*o).map_or(0, |t| t.len()) <= budget {
                break;
            }
        }
        if serde_json::to_string(&*o).map_or(0, |t| t.len()) > budget {
            o.insert("suggestions".into(), Value::Null);
        }
    }
    serde_json::to_string(&body).ok()
}

fn run(env: &Env, phase: Phase, body: &str) -> Option<String> {
    match phase {
        Phase::Pre | Phase::Post => {
            let _ = post(env, phase, None, body, Duration::from_secs(2));
            None
        }
        Phase::Ask => {
            let start = Instant::now();
            let hold = Duration::from_millis(HOLD_MS) + Duration::from_secs(5);
            let mut reply = post(env, Phase::Ask, None, body, hold)?;
            loop {
                match reply.get("state").and_then(Value::as_str) {
                    Some("decided") => return reply.get("output").filter(|o| o.is_object()).and_then(|o| serde_json::to_string(o).ok()),
                    Some("pending") if start.elapsed() < ASK_OVERALL => {
                        let id = reply.get("id").and_then(Value::as_str)?.to_string();
                        reply = post(env, Phase::Wait, Some(&id), "", hold)?;
                    }
                    _ => return None,
                }
            }
        }
        Phase::Wait => None,
    }
}

fn post(env: &Env, phase: Phase, id: Option<&str>, body: &str, timeout: Duration) -> Option<Value> {
    let mut target = format!("{}?stream={}&phase={}", super::PATH, env.stream, phase.as_str());
    if let Some(id) = id {
        target.push_str("&id=");
        target.push_str(id);
    }
    post_to(env, &target, body, timeout)
}

fn post_to(env: &Env, target: &str, body: &str, timeout: Duration) -> Option<Value> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], env.port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(1)).ok()?;
    s.set_read_timeout(Some(timeout)).ok()?;
    s.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
    let head = format!(
        "POST {target} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        env.port,
        env.token,
        body.len()
    );
    s.write_all(head.as_bytes()).ok()?;
    s.write_all(body.as_bytes()).ok()?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let (head, rest) = text.split_once("\r\n\r\n")?;
    if head.split_whitespace().nth(1) != Some("200") {
        return None;
    }
    serde_json::from_str(rest.trim()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_must_be_complete_and_local() {
        let tok = "a".repeat(64);
        assert!(Env::parse(Some("http://127.0.0.1:4100"), Some("abc"), Some(&tok)).is_some());
        assert!(Env::parse(None, Some("abc"), Some(&tok)).is_none());
        assert!(Env::parse(Some("http://127.0.0.1:4100"), Some("abc"), None).is_none());
        assert!(Env::parse(Some("http://evil.com:4100"), Some("abc"), Some(&tok)).is_none());
        assert!(Env::parse(Some("http://127.0.0.1:0"), Some("abc"), Some(&tok)).is_none());
        assert!(Env::parse(Some("http://127.0.0.1:4100"), Some("a b"), Some(&tok)).is_none());
        assert!(Env::parse(Some("http://127.0.0.1:4100"), Some("abc"), Some("short")).is_none());
    }

    /// `Env` 위 주석 줄의 글자로 `main` 몸을 자른다 — 그 주석을 고치면 이 시험이 깨진다.
    #[test]
    fn outside_aynx_exits_at_once() {
        assert!(Env::parse(None, None, None).is_none());
        let src = include_str!("helper.rs");
        let main_body = &src[src.find("pub(crate) fn main()").unwrap()..src.find("/// 훅 환경 셋").unwrap()];
        let env_at = main_body.find("Env::from_process()").unwrap();
        let stdin_at = main_body.find("std::io::stdin()").unwrap();
        assert!(env_at < stdin_at, "환경 확인이 표준 입력 읽기보다 먼저");
    }

    #[test]
    fn envelope_keeps_keys_and_trims_bodies() {
        let raw = br#"{"session_id":"7a2a3d70-0000-0000-0000-000000000001","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls","description":"x"},"tool_use_id":"toolu_1"}"#;
        let pre: Value = serde_json::from_str(&envelope(Phase::Pre, Cli::Claude, raw).unwrap()).unwrap();
        assert_eq!(pre["tool"], "Bash");
        assert_eq!(pre["toolUseId"], "toolu_1");
        assert!(pre.get("input").is_none(), "pre 는 본문을 싣지 않는다");
        assert_eq!(pre["digest"].as_str().unwrap().len(), 64);
        // 요약은 description 을 빼고 본다.
        let raw_ask = br#"{"session_id":"s1","tool_name":"Bash","tool_input":{"command":"ls"},"permission_suggestions":[{"type":"addRules"}]}"#;
        let ask: Value = serde_json::from_str(&envelope(Phase::Ask, Cli::Claude, raw_ask).unwrap()).unwrap();
        assert_eq!(ask["input"]["command"], "ls");
        assert_eq!(ask["truncated"], false);
        assert_eq!(ask["digest"], pre["digest"]);
        let big = "x".repeat(600 * 1024);
        let raw_big = serde_json::to_vec(&json!({ "tool_name": "Write", "tool_input": { "file_path": "a", "content": big } })).unwrap();
        let text = envelope(Phase::Ask, Cli::Claude, &raw_big).unwrap();
        assert!(text.len() <= MAX_BODY_BYTES);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["truncated"], true);
        assert_eq!(v["input"]["file_path"], "a");
        assert_eq!(v["digest"], input_digest(&json!({ "file_path": "a", "content": "x".repeat(600 * 1024) })));
        assert!(envelope(Phase::Ask, Cli::Codex, b"not json").is_none());
        assert!(envelope(Phase::Ask, Cli::Codex, b"{}").is_none());
    }

    #[test]
    fn codex_question_pre_becomes_ask() {
        let q = br#"{"tool_name":"request_user_input","tool_use_id":"call-1","tool_input":{"questions":[{"id":"c","question":"Which?","options":[{"label":"A"}]}]}}"#;
        assert_eq!(effective_phase(Phase::Pre, Cli::Codex, q), Phase::Ask);
        assert_eq!(effective_phase(Phase::Pre, Cli::Claude, q), Phase::Pre);
        assert_eq!(effective_phase(Phase::Post, Cli::Codex, q), Phase::Post);
        assert_eq!(effective_phase(Phase::Pre, Cli::Codex, br#"{"tool_name":"Bash"}"#), Phase::Pre);
        assert_eq!(effective_phase(Phase::Pre, Cli::Codex, b"not json"), Phase::Pre);
        let v: Value = serde_json::from_str(&envelope(Phase::Ask, Cli::Codex, q).unwrap()).unwrap();
        assert_eq!(v["input"]["questions"][0]["question"], "Which?");
    }

    #[test]
    fn interrupt_body_is_a_signal() {
        let raw = br#"{"session_id":"01a199f0-bf7c-7c90-bf0b-8f51dbf91d57","turn_id":"t","hook_event_name":"Interrupt"}"#;
        let sig = crate::agent_signal::parse(&interrupt_body("abc123", Cli::Codex, raw)).unwrap();
        assert_eq!(sig.event, crate::agent_signal::SignalEvent::Interrupt);
        assert_eq!(sig.stream, "abc123");
        assert_eq!(sig.cli, Some("codex"));
        assert_eq!(sig.session.as_deref(), Some("01a199f0-bf7c-7c90-bf0b-8f51dbf91d57"));
        assert_eq!(crate::agent_signal::parse(&interrupt_body("abc123", Cli::Codex, b"x")).unwrap().session, None);
    }
}
