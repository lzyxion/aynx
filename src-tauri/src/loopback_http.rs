//! **루프백 HTTP 공용 부품** — 세션 서버의 127.0.0.1 리스너(`server::signal_http` — `/agent-signal` · `/mcp`)가 쓰는 문지기 조각.
//! 경로·토큰의 **뜻**은 모른다 — 부르는 쪽의 일이다.
//!
//! 불변식:
//! - 리스너는 부르는 쪽이 **127.0.0.1** 에만 만든다(이 파일은 받은 리스너를 감쌀 뿐).
//! - 처리 스레드는 상한까지만 — 넘치면 스레드를 띄우기 **전에** 503 + `Retry-After`.
//! - 읽기에는 [`READ_TIMEOUT`] 이 걸린다(Windows — 리스너 상속). `/agent-signal` 은 SSH `-R` 로 원격 서버의 아무
//!   프로세스나 닿는 길이라, 본문을 안 보내고 붙드는 연결이 인증 전에 스레드를 무기한 잡으면 안 된다. 쓰기에는 시한이
//!   없다 — MCP `wait_for_operation` 의 긴 대기(최대 120초)는 응답을 **쓰기 전**이다.

use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::token::ct_eq;

/// 소켓 읽기 시한 — 요청 줄·헤더·본문을 읽는 동안 이만큼 아무 바이트도 오지 않으면 끊는다.
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// 로컬 AI 타일 여럿이 `wait_for_operation` 을 함께 걸어 두어도 남는 값.
pub(crate) const MAX_INFLIGHT: usize = 64;

/// `who` 는 경고 줄의 이름. tiny_http 0.12 에는 시한 설정이 없어 리스너에 건 시한을 받은 소켓이 물려받게 한다.
pub(crate) fn http_server_with(
    listener: TcpListener,
    read_timeout: Duration,
    who: &str,
) -> Option<tiny_http::Server> {
    if set_inherited_read_timeout(&listener, read_timeout).is_none() {
        eprintln!("[aynx] {who}: 이 OS 에서는 요청 읽기 시한을 걸지 못했습니다");
    }
    tiny_http::Server::from_listener(listener, None).ok()
}

/// 리스너에 `SO_RCVTIMEO` 를 걸어 `accept` 로 받은 소켓이 물려받게 한다. 못 거는 OS 는 `None`.
///
/// - Windows: 받은 소켓이 물려받고 블로킹 `accept` 는 이 시한을 보지 않는다(`mcp/tests.rs` 가 둘 다 확인한다).
/// - Linux: `accept` 자신도 이 시한을 지켜 놀고 있는 리스너의 `EAGAIN` 에 tiny_http 의 accept 스레드가 끝난다 — 그래서 걸지 않는다(스텁).
/// - macOS: 확인 전(스텁).
fn set_inherited_read_timeout(listener: &TcpListener, timeout: Duration) -> Option<()> {
    #[cfg(windows)]
    {
        socket2::SockRef::from(listener).set_read_timeout(Some(timeout)).ok()
    }
    #[cfg(not(windows))]
    {
        let _ = (listener, timeout);
        None
    }
}

/// 처리 중인 요청 하나의 자리 — drop(정상 끝·panic·스레드 생성 실패)에 반납한다.
struct InFlight(Arc<AtomicUsize>);

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// 요청마다 스레드 하나. 스레드를 못 띄우면 `request` 를 drop 한다 — 동기로 처리하면 자원 압박 위에 긴 대기를 얹는다.
#[cfg(test)]
pub(crate) fn serve_threads<F>(server: &tiny_http::Server, max_inflight: usize, who: &'static str, handler: F)
where
    F: Fn(tiny_http::Request) + Send + Sync + 'static,
{
    serve_classed(server, &[max_inflight], who, |_| 0, handler);
}

/// 갈래(`classify` → `caps` 의 번호)마다 따로 동시 상한을 센다 — 신호 갈래가 상한을 다 써도 로컬 AI 의 `/mcp` 자리가 남게.
/// 범위 밖 번호는 마지막 갈래로 친다.
pub(crate) fn serve_classed<C, F>(
    server: &tiny_http::Server,
    caps: &[usize],
    who: &'static str,
    classify: C,
    handler: F,
) where
    C: Fn(&tiny_http::Request) -> usize,
    F: Fn(tiny_http::Request) + Send + Sync + 'static,
{
    let handler = Arc::new(handler);
    let counters: Vec<Arc<AtomicUsize>> = caps.iter().map(|_| Arc::new(AtomicUsize::new(0))).collect();
    let mut last_busy_log: Option<Instant> = None;
    for request in server.incoming_requests() {
        let class = classify(&request).min(caps.len().saturating_sub(1));
        let (Some(cap), Some(inflight)) = (caps.get(class).copied(), counters.get(class)) else {
            respond_busy(request);
            continue;
        };
        if inflight.fetch_add(1, Ordering::AcqRel) >= cap {
            inflight.fetch_sub(1, Ordering::AcqRel);
            if last_busy_log.is_none_or(|t| t.elapsed() >= Duration::from_secs(60)) {
                eprintln!("[aynx] {who} 요청이 동시 상한({cap})을 넘어 503 으로 거절합니다");
                last_busy_log = Some(Instant::now());
            }
            respond_busy(request);
            continue;
        }
        let slot = InFlight(Arc::clone(inflight));
        let handler = Arc::clone(&handler);
        if let Err(e) = std::thread::Builder::new()
            .name(format!("aynx-{who}-req"))
            .spawn(move || {
                let _slot = slot;
                handler(request);
            })
        {
            eprintln!("[aynx] {who} 요청 스레드를 띄우지 못했습니다: {e}");
        }
    }
}

pub(crate) fn header_value<'a>(request: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

pub(crate) fn bearer(header: Option<&str>) -> Option<&str> {
    header
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// 비교는 [`ct_eq`] 로 한다 — 로컬 프로세스는 몇 번이든 두드릴 수 있고 `==` 는 맞은 접두사 길이를 시간으로 흘린다.
/// `token` 이 비어 있으면 무조건 거부한다 — 토큰 없이 도는 상태에서 `Bearer ` 하나로 열리지 않게.
pub(crate) fn authorized(header: Option<&str>, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    match header {
        Some(h) => h
            .strip_prefix("Bearer ")
            .map(str::trim)
            .is_some_and(|t| ct_eq(t.as_bytes(), token.as_bytes())),
        None => false,
    }
}

pub(crate) fn respond_busy(request: tiny_http::Request) {
    let mut response =
        tiny_http::Response::from_string("{\"error\":\"busy\"}").with_status_code(503);
    for (k, v) in [("Content-Type", "application/json"), ("Retry-After", "1")] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            response = response.with_header(h);
        }
    }
    let _ = request.respond(response);
}

pub(crate) fn respond(request: tiny_http::Request, status: u16, body: &str) {
    let response = tiny_http::Response::from_string(body).with_status_code(status);
    let response =
        match tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
            Ok(h) => response.with_header(h),
            Err(_) => response,
        };
    let _ = request.respond(response);
}

/// 본문을 `max` 바이트까지만 읽는다(헤더가 없어도 상한+1 까지만). `Err(true)` = 상한 초과(413), `Err(false)` = 읽기 실패(400).
pub(crate) fn read_body_capped(request: &mut tiny_http::Request, max: usize) -> Result<String, bool> {
    if request.body_length().is_some_and(|n| n > max) {
        return Err(true);
    }
    use std::io::Read as _;
    let mut body = String::new();
    if request
        .as_reader()
        .take((max + 1) as u64)
        .read_to_string(&mut body)
        .is_err()
    {
        return Err(false);
    }
    if body.len() > max {
        return Err(true);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_takes_only_a_nonempty_bearer_value() {
        assert_eq!(bearer(Some("Bearer abc")), Some("abc"));
        assert_eq!(bearer(Some("Bearer  abc ")), Some("abc"));
        assert_eq!(bearer(Some("Bearer ")), None);
        assert_eq!(bearer(Some("Basic abc")), None);
        assert_eq!(bearer(None), None);
    }

    #[test]
    fn authorized_needs_the_exact_nonempty_token() {
        assert!(authorized(Some("Bearer t0k"), "t0k"));
        assert!(!authorized(Some("Bearer t0"), "t0k"));
        assert!(!authorized(Some("Bearer "), ""));
        assert!(!authorized(None, "t0k"));
    }
}
