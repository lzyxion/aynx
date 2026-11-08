//! **신호 평면** — 세션 서버 프로세스 안의 신호 전용 HTTP(③-3a · 설계 docs/internal/session-server-design-2026-10-08.md 4.4).
//!
//! 에이전트 훅(Claude Code · Codex — `crate::agent_hooks`)이 `POST $AYNX_MCP_URL/agent-signal` 로 한 줄을 쏘면 여기서
//! 받아 **서버의** 에이전트 상태 표(`crate::agent_state`)를 갱신하고 서버 이벤트 `agent-signal` 하나를 모든 GUI 연결로
//! 내보낸다(GUI `server::client` 가 같은 이름의 Tauri 이벤트로 중계 — 프런트 변경 없음). 토큰 표(`crate::agent_signal`)와
//! 상태 표가 모두 이 프로세스에 살아서, GUI 를 강제 종료했다 다시 켜도 살아남은 셸의 신호가 그대로 받아들여진다
//! (③-2 한계 1 해소).
//!
//! ## 모양
//!
//! - 리스너: **127.0.0.1 의 임시 포트**(서버가 뜰 때마다 새로) — 서버 재시작 = 세션 끝이라 포트를 지속할 까닭이 없다.
//!   포트는 `hello`·`status` 응답의 `signal_port` 로 GUI 가 안다(원격 `-R` 포워드의 대상).
//! - 경로: `/agent-signal` 과 **③-3c 부터 `/mcp`**(같은 포트 — 설계 "같은 포트로 다시 합침") · **2026-11-01 부터 `/agent-permission`**(타일 권한
//!   카드 — 문지기 · 토큰(권한 결정 토큰) · 본문 상한(256 KiB) · 동시 상한 칸이 따로 — `server::tile_permission`). 그 밖은 404. 두 경로의 문지기·
//!   토큰 종류는 그대로 갈라 둔다: `/agent-signal` 은 아래 문지기(신호 전용 토큰 · Host 의 이름만), `/mcp` 는
//!   `crate::mcp::http::handle_request`(Host 는 `127.0.0.1:<이 포트>` 정확히 · **MCP 토큰만** · 본문 256 KiB). 동시 상한도 경로별로
//!   센다(`loopback_http::serve_classed`) — `-R` 로 원격이 닿는 신호 갈래가 상한을 다 써도 로컬 AI 의 `/mcp` 자리는 남는다.
//!   **합치지 않은 둘**: 외부 MCP 실행 브로커(HTTP 가 아닌 자체 TCP 한 줄 규약 — tiny_http 에 얹을 수 없다)와 HTTP 헤더
//!   프록시(`/mcp-proxy/<티켓>` — 볼트 비밀을 붙여 내보내는 길이라 `-R` 로 원격이 닿는 포트에 두지 않고, SSE 무한 스트림이라
//!   요청 상한이 없다 — `mcp_launch` 머리말).
//! - 문지기(순서가 요점): 경로 → 출처([`signal_origin_ok`] — `Origin` 거부 · `Host` 는 루프백 이름, 포트는 안 본다) → POST →
//!   본문 상한 4 KB(`crate::agent_signal::MAX_BODY_BYTES` — 413 이 401 보다 앞) → **신호 전용 토큰**(본문의 스트림에 뽑힌 것만,
//!   상수시간). 인증 전의 요청에 본문 판정을 알려 주지 않는다 — 본문이 신호가 아니거나 토큰이 안 맞으면 401.
//! - 읽기 시한 10초·동시 요청 상한 64(넘치면 503) — `crate::loopback_http`(MCP 와 같은 부품). `-R` 로 원격 서버의 아무
//!   프로세스나 닿는 길이라 인증 전에 스레드를 붙드는 연결을 끊는다.
//! - **MCP 토큰으로는 통하지 않는다** — 예전 `/agent-signal` 은 MCP 토큰도 받았다(옛 훅·옛 타일 물러남). ③-3c 부터 MCP 도 이
//!   프로세스·이 포트에 살지만 갈래는 섞지 않는다: 신호 경로는 신호 전용 토큰만, `/mcp` 는 MCP 토큰만 받는다.
//!
//! 받은 것은 로그·파일에 남기지 않는다(토큰·`detail` 모두) — 표에는 범주가 낳은 시각만 남는다.

use std::net::TcpListener;
use std::sync::Arc;

use serde_json::Value;

use crate::agent_signal::{parse, MAX_BODY_BYTES, PATH};
use crate::loopback_http::{self, bearer, header_value, respond, MAX_INFLIGHT, READ_TIMEOUT};

/// 신호 하나를 내보내는 손 — 서버는 이벤트 방송(`agent-signal`, 페이로드 그대로)을 꽂는다. 시험은 기록기를 꽂는다.
pub(crate) type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// `/mcp` 갈래 — 요청과 **이 리스너의 포트**(MCP 의 Host 검사가 쓴다)를 받는다. 세션 서버의 AI 평면(`server::ai`)이 꽂는다.
pub(crate) type McpRoute = Arc<dyn Fn(tiny_http::Request, u16) + Send + Sync>;

/// 갈래 번호 — `serve_classed` 의 상한 칸.
const CLASS_SIGNAL: usize = 0;
const CLASS_MCP: usize = 1;
/// 권한 카드 롱폴(2026-11-01 — `server::tile_permission`) — 요청이 [`crate::tile_permission::HOLD_MS`] 까지 스레드를 붙든다. 신호 · `/mcp` 자리를
/// 먹지 않게 따로 센다(상한은 다른 갈래의 절반).
const CLASS_PERM: usize = 2;

/// 떠 있는 신호 평면 — drop 하면 수신 고리가 멈춘다(`unblock`).
pub(crate) struct SignalPlane {
    pub port: u16,
    server: Arc<tiny_http::Server>,
}

impl Drop for SignalPlane {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

/// 127.0.0.1 임시 포트에 신호 평면을 띄운다(`mcp` 가 있으면 같은 포트에 `/mcp` 도). 못 띄우면 `None`(그 서버의 타일은
/// 신호 없이 열고, MCP 도 없다 — 점은 추정으로 돈다).
pub(crate) fn start(emit: Emit, mcp: Option<McpRoute>) -> Option<SignalPlane> {
    start_with(emit, mcp, READ_TIMEOUT, MAX_INFLIGHT)
}

/// [`start`] 의 몸통 — 시험이 시한·상한을 작게 준다(상한은 갈래마다 같은 값).
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

/// 요청 하나 — 머리말의 문지기 순서.
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
    // 인증 — 본문의 스트림에 뽑아 둔 신호 전용 토큰만. 본문이 신호가 아니면 스트림이 없어 맞춰 볼 토큰도 없다 → 401
    // (예전 MCP 토큰 갈래의 400 은 없다 — 인증 전의 요청에 본문 판정을 알려 주지 않는다).
    let sig = match (bearer(auth.as_deref()), parse(&body)) {
        (Some(t), Ok(sig)) if crate::agent_signal::token_accepts(&sig.stream, t) => sig,
        _ => {
            respond(request, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
    };
    // 표를 **먼저** 갱신하고(상태의 권위), 이벤트는 표가 매긴 `seq` 와 전이 결과를 함께 싣는다. 요청마다 스레드라
    // 방송 순서는 섞일 수 있다 — 창이 seq 로 가른다.
    let at = crate::agent_signal::now_ms();
    super::tile_permission::forward_signal(&sig, at, emit);
    // 끊긴 턴 · 끝난 CLI 의 Codex 질문도 함께 걷는다 — 같은 셸에서 다음 CLI 가 질문 대기를 물려받지 않게
    if matches!(sig.event, crate::agent_signal::SignalEvent::Interrupt | crate::agent_signal::SignalEvent::SessionEnd) {
        super::tile_permission::interrupted(&sig.stream);
    }
    respond(request, 204, "");
    // (오케스트레이션 탭 2단계) 타일은 조정자 자리가 되지 못하므로 CLI 의 `session-end` 가 멈출 Run 은 없다 — 조정자 프로세스의 끝은
    // 프로듀서 레지스트리가 안다(`server::producer` → `coordinator_exited_seat`).
    // (3a) 오케스트레이션 작업자는 헤드리스 턴이라 훅 신호를 받지 않는다 — 상태는 서버 손이 그 턴의 stdout 에서 읽는다.
}

/// 신호 경로의 출처 확인 — `Origin` 이 있으면 거부, `Host` 의 **이름**은 루프백 글자(`127.0.0.1` · `localhost`)여야 하고
/// **포트는 보지 않는다**(숫자이기만 하면).
///
/// 원격 타일의 훅은 서버 쪽 원격 포워드(`127.0.0.1:<서버가 고른 포트>`)로 쏘므로 `Host` 에 우리 포트가 실리지 않는다.
/// 막으려는 것(DNS 리바인딩)은 **남의 이름**이 `Host` 에 실리는 경우라, 이름이 루프백이고 `Origin` 이 없으면 된다.
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

    /// 문지기 순서와 판정 — 신호 전용 토큰만(자기 스트림만), 틀린 본문도 401(인증 전), 상한은 413, 남의 Host 는 403,
    /// 다른 경로 404, GET 405. 통과한 것만 표를 갱신하고 이벤트 하나가 된다(표의 몫 `seq`·`state` 를 싣는다).
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

        // 모르는 이벤트 — 본문이 신호가 아니면 스트림도 없는 것이라 토큰을 맞춰 볼 수 없다 → 401(본문 판정은 알리지 않는다).
        let unknown = post(port, &host, &auth, r#"{"stream":"sig-http-mine","event":"approve"}"#);
        assert!(unknown.starts_with("HTTP/1.1 401"), "{unknown}");

        // 남의 Host · Origin → 403, 다른 경로 → 404, GET → 405, 상한 초과 선언 → 413(읽기 전에).
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

        // 거둔 뒤에는 401.
        let (s, o) = grant.key();
        crate::agent_signal::revoke(&s, o);
        assert!(post(port, &host, &auth, mine).starts_with("HTTP/1.1 401"));
        let (s, o) = other.key();
        crate::agent_signal::revoke(&s, o);
        assert_eq!(sent.lock().unwrap().len(), 1, "통과한 하나만 나갔다");
    }

    /// 읽기 시한 — 본문을 안 보내고 붙드는 연결은 시한 안에 끊긴다(인증 전 `-R` 두드림이 스레드를 잡지 못한다).
    /// 동시 상한 — 넘치면 503 + `Retry-After`.
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
