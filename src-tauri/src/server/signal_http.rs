//! 신호 평면 + MCP 리스너 — 세션 서버 안의 127.0.0.1 임시 포트 하나(`/agent-signal` · `/mcp` · `/agent-permission`).
//!
//! - 갈래마다 문지기 · 토큰 종류를 섞지 않는다: `/agent-signal` 은 신호 전용 토큰만(MCP 토큰은 안 받는다), `/mcp` 는 MCP 토큰만,
//!   `/agent-permission` 은 권한 결정 토큰(`server::tile_permission`). 동시 상한도 갈래별 — `-R` 로 원격이 닿는 신호 갈래가 다 써도 `/mcp` 자리는 남는다.
//! - 합치지 않은 둘: 외부 MCP 실행 브로커(자체 TCP 규약)와 헤더 프록시(볼트 비밀을 붙이는 길이라 `-R` 로 원격이 닿는 포트에 두지 않는다).
//! - 신호 문지기는 순서가 요점이다: 경로 → 출처 → POST → 본문 상한(413 이 401 보다 앞) → 신호 토큰. 인증 전에는 본문 판정을 알리지 않는다(401).
//! - 받은 것(토큰 · `detail`)은 로그 · 파일에 남기지 않는다.

use std::net::TcpListener;
use std::sync::Arc;

use serde_json::Value;

use crate::agent_signal::{parse, MAX_BODY_BYTES, PATH};
use crate::loopback_http::{self, bearer, header_value, respond, MAX_INFLIGHT, READ_TIMEOUT};

pub(crate) type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// 둘째 인자는 이 리스너의 포트 — MCP 의 Host 검사가 쓴다.
pub(crate) type McpRoute = Arc<dyn Fn(tiny_http::Request, u16) + Send + Sync>;

const CLASS_SIGNAL: usize = 0;
const CLASS_MCP: usize = 1;
/// 권한 카드 롱폴은 스레드를 오래 붙든다 — 신호 · `/mcp` 자리를 먹지 않게 따로 센다.
const CLASS_PERM: usize = 2;

pub(crate) struct SignalPlane {
    pub port: u16,
    server: Arc<tiny_http::Server>,
}

impl Drop for SignalPlane {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

pub(crate) fn start(emit: Emit, mcp: Option<McpRoute>) -> Option<SignalPlane> {
    start_with(emit, mcp, READ_TIMEOUT, MAX_INFLIGHT)
}

pub(crate) fn start_with(
    emit: Emit,
    mcp: Option<McpRoute>,
    read_timeout: std::time::Duration,
    max_inflight: usize,
) -> Option<SignalPlane> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let server = Arc::new(loopback_http::http_server_with(listener, read_timeout, "신호·MCP 수신")?);
    let s = Arc::clone(&server);
    std::thread::Builder::new()
        .name("aynx-signal".into())
        .spawn(move || {
            loopback_http::serve_classed(
                &s,
                &[max_inflight, max_inflight, (max_inflight / 2).max(1)],
                "loopback",
                |request| match request.url().split('?').next() {
                    Some(p) if p == crate::mcp::MCP_PATH => CLASS_MCP,
                    Some(p) if p == crate::tile_permission::PATH => CLASS_PERM,
                    _ => CLASS_SIGNAL,
                },
                move |request| {
                    let path = request.url().split('?').next().unwrap_or("").to_string();
                    if path == crate::tile_permission::PATH {
                        super::tile_permission::handle_http(request);
                        return;
                    }
                    match (&mcp, path == crate::mcp::MCP_PATH) {
                        (Some(route), true) => route(request, port),
                        _ => handle(request, &emit),
                    }
                },
            );
        })
        .ok()?;
    Some(SignalPlane { port, server })
}

fn handle(mut request: tiny_http::Request, emit: &Emit) {
    let path = request.url().split('?').next().unwrap_or("");
    if path != PATH {
        respond(request, 404, "{\"error\":\"not found\"}");
        return;
    }
    if !signal_origin_ok(header_value(&request, "Host"), header_value(&request, "Origin")) {
        respond(request, 403, "{\"error\":\"forbidden\"}");
        return;
    }
    if *request.method() != tiny_http::Method::Post {
        respond(request, 405, "{\"error\":\"method not allowed\"}");
        return;
    }
    let auth = header_value(&request, "Authorization").map(str::to_owned);
    let body = match loopback_http::read_body_capped(&mut request, MAX_BODY_BYTES) {
        Ok(b) => b,
        Err(true) => {
            respond(request, 413, "{\"error\":\"body too large\"}");
            return;
        }
        Err(false) => {
            respond(request, 400, "{\"error\":\"bad body\"}");
            return;
        }
    };
    // 본문이 신호가 아니어도 401 — 인증 전의 요청에 본문 판정을 알려 주지 않는다
    let sig = match (bearer(auth.as_deref()), parse(&body)) {
        (Some(t), Ok(sig)) if crate::agent_signal::token_accepts(&sig.stream, t) => sig,
        _ => {
            respond(request, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
    };
    // 요청마다 스레드라 방송 순서는 섞일 수 있다 — 창이 표가 매긴 seq 로 가른다
    let at = crate::agent_signal::now_ms();
    super::tile_permission::forward_signal(&sig, at, emit);
    // 같은 셸에서 다음 CLI 가 Codex 질문 대기를 물려받지 않게 함께 걷는다
    if matches!(sig.event, crate::agent_signal::SignalEvent::Interrupt | crate::agent_signal::SignalEvent::SessionEnd) {
        super::tile_permission::interrupted(&sig.stream);
    }
    respond(request, 204, "");
    // 오케스트레이션 작업자는 헤드리스 턴이라 훅 신호를 받지 않는다 — 여기에 작업자 길을 두지 않는다.
}

/// `Origin` 이 있으면 거부 · `Host` 는 이름만 루프백이면 되고 포트는 보지 않는다 — 원격 훅은 서버 쪽 `-R` 포트로 쏘아
/// 우리 포트가 실리지 않는다. 막는 것은 DNS 리바인딩(남의 이름).
pub(crate) fn signal_origin_ok(host: Option<&str>, origin: Option<&str>) -> bool {
    if origin.is_some() {
        return false;
    }
    let Some(host) = host.map(str::trim) else {
        return false;
    };
    let (name, port) = match host.rsplit_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    let name_ok = name == "127.0.0.1" || name.eq_ignore_ascii_case("localhost");
    let port_ok =
        port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()));
    name_ok && port_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Mutex;
    use std::time::Duration;

    #[test]
    fn signal_origin_ignores_the_port_but_not_the_name() {
        assert!(signal_origin_ok(Some("127.0.0.1:41234"), None));
        assert!(signal_origin_ok(Some("localhost:9"), None));
        assert!(signal_origin_ok(Some("127.0.0.1"), None));
        assert!(!signal_origin_ok(Some("evil.com:41234"), None));
        assert!(!signal_origin_ok(Some("127.0.0.1.evil.com:80"), None));
        assert!(!signal_origin_ok(Some("127.0.0.1:"), None));
        assert!(!signal_origin_ok(Some("127.0.0.1:80x"), None));
        assert!(!signal_origin_ok(Some("127.0.0.1:41234"), Some("http://127.0.0.1")));
        assert!(!signal_origin_ok(None, None));
    }

    fn recorder() -> (Emit, Arc<Mutex<Vec<Value>>>) {
        let sent: Arc<Mutex<Vec<Value>>> = Arc::default();
        let sink = Arc::clone(&sent);
        (Arc::new(move |v| sink.lock().unwrap().push(v)), sent)
    }

    fn send(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut buf = Vec::new();
        let _ = s.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    }

    fn post(port: u16, host: &str, auth: &str, body: &str) -> String {
        send(
            port,
            &format!(
                "POST /agent-signal HTTP/1.1\r\nHost: {host}\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            ),
        )
    }

    #[test]
    fn live_plane_needs_the_stream_token_and_only_forwards() {
        let (emit, sent) = recorder();
        let plane = start(emit, None).expect("신호 평면");
        let port = plane.port;
        let grant = crate::agent_signal::issue("sig-http-mine", None).unwrap();
        let other = crate::agent_signal::issue("sig-http-other", None).unwrap();
        let auth = format!("Authorization: Bearer {}\r\n", grant.token);
        let mine = r#"{"stream":"sig-http-mine","event":"waiting","detail":"permission"}"#;
        let theirs = r#"{"stream":"sig-http-other","event":"stop"}"#;
        let host = format!("127.0.0.1:{port}");

        assert!(post(port, &host, "", mine).starts_with("HTTP/1.1 401"), "토큰 없음");
        assert!(post(port, &host, "Authorization: Bearer nope\r\n", mine).starts_with("HTTP/1.1 401"));
        assert!(post(port, &host, &auth, theirs).starts_with("HTTP/1.1 401"), "남의 스트림");
        assert!(post(port, &host, &auth, "nope").starts_with("HTTP/1.1 401"), "인증 전의 본문 판정은 알리지 않는다");
        assert!(sent.lock().unwrap().is_empty(), "인증 전에는 신호가 없다");

        // 원격 포워드로 온 요청 — Host 는 서버 쪽 포트(우리 포트가 아니다).
        let ok = post(port, "127.0.0.1:41234", &auth, mine);
        assert!(ok.starts_with("HTTP/1.1 204"), "{ok}");
        let got = sent.lock().unwrap().clone();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["stream"], "sig-http-mine");
        assert_eq!(got[0]["event"], "waiting");
        assert_eq!(got[0]["detail"], "permission");
        assert_eq!(got[0]["state"], "permission", "표의 몫");
        assert!(got[0]["seq"].as_u64().unwrap() > 0);

        let unknown = post(port, &host, &auth, r#"{"stream":"sig-http-mine","event":"approve"}"#);
        assert!(unknown.starts_with("HTTP/1.1 401"), "{unknown}");

        assert!(post(port, &format!("evil.com:{port}"), &auth, mine).starts_with("HTTP/1.1 403"));
        let with_origin = format!(
            "POST /agent-signal HTTP/1.1\r\nHost: {host}\r\nOrigin: http://127.0.0.1\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n"
        );
        assert!(send(port, &with_origin).starts_with("HTTP/1.1 403"));
        let mcp = format!("POST /mcp HTTP/1.1\r\nHost: {host}\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(send(port, &mcp).starts_with("HTTP/1.1 404"), "MCP 는 이 포트에 없다");
        let get = format!("GET /agent-signal HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        assert!(send(port, &get).starts_with("HTTP/1.1 405"));
        let big = format!(
            "POST /agent-signal HTTP/1.1\r\nHost: {host}\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_BODY_BYTES + 1
        );
        assert!(send(port, &big).starts_with("HTTP/1.1 413"));

        let (s, o) = grant.key();
        crate::agent_signal::revoke(&s, o);
        assert!(post(port, &host, &auth, mine).starts_with("HTTP/1.1 401"));
        let (s, o) = other.key();
        crate::agent_signal::revoke(&s, o);
        assert_eq!(sent.lock().unwrap().len(), 1, "통과한 하나만 나갔다");
    }

    #[cfg(windows)]
    #[test]
    fn stalled_requests_are_cut_and_the_inflight_cap_holds() {
        let (emit, _) = recorder();
        let plane = start_with(emit, None, Duration::from_millis(300), 1).unwrap();
        let port = plane.port;
        let start = std::time::Instant::now();
        let got = send(port, "POST /agent-signal HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 3000\r\n\r\n{");
        assert!(got.is_empty() || got.starts_with("HTTP/1.1 400"), "{got}");
        assert!(start.elapsed() < Duration::from_secs(3));

        let mut holder = TcpStream::connect(("127.0.0.1", port)).unwrap();
        holder
            .write_all(b"POST /agent-signal HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 3000\r\n\r\n{")
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let busy = send(port, "POST /agent-signal HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(busy.starts_with("HTTP/1.1 503") && busy.contains("Retry-After: 1"), "{busy}");
        drop(holder);
    }
}
