//! 티켓의 HTTP URL 하나로만 전달한다. 비밀 값과 URL은 오류·Debug에 싣지 않는다.
//! ③-3b1 부터 세션 서버 프로세스에 산다(브로커와 같은 [`Vault`] 를 읽는다). 볼트가 잠기면 503 + 짧은 이유 — 창 0개
//! 잠금은 티켓을 지우지 않으므로 해제하면 같은 URL 이 다시 200 이다(가림막 잠금은 티켓을 지운다 → 404).
use super::Tickets;
use std::io::{Read, Write};
use std::sync::Arc;

use crate::vault::Vault;
use std::time::Duration;
use tiny_http::{Request, Response, Server};
use zeroize::Zeroizing;

const MAX_BODY: usize = 16 * 1024 * 1024;
const FORWARD: [&str; 5] = [
    "Accept", "Content-Type", "Mcp-Session-Id", "MCP-Protocol-Version", "Last-Event-ID",
];

fn runtime() -> Result<tokio::runtime::Runtime, ()> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| ())
}

fn client() -> Result<reqwest::Client, ()> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| ())
}

/// 프록시를 띄운다 — 127.0.0.1 의 자기 포트(신호 평면과 합치지 않는다 — 합치기는 ③-3c). 브로커가 처음 HTTP 티켓을
/// 만들 때 한 번 부른다(`Broker::proxy_port`).
pub(super) fn start(tickets: &Tickets, vault: Arc<Vault>) -> Result<u16, ()> {
    let server = Server::http(("127.0.0.1", 0)).map_err(|_| ())?;
    let port = server.server_addr().to_ip().ok_or(())?.port();
    let runtime = Arc::new(runtime()?);
    let client = client()?;
    let tickets = tickets.clone();
    std::thread::Builder::new().name("mcp-proxy".into()).spawn(move || {
        for request in server.incoming_requests() {
            let tickets = tickets.clone();
            let runtime = runtime.clone();
            let client = client.clone();
            let vault = vault.clone();
            // 무한 SSE가 다른 요청을 막지 않는다. 실패하면 Request의 기본 500만 남는다.
            let _ = std::thread::Builder::new().name("mcp-proxy-request".into()).spawn(move || {
                serve_with(request, &tickets, &runtime, &client, |reference| {
                    vault.mcp_env_for(reference).map_err(|_| {
                        if vault.is_unlocked() { Unavailable::Missing } else { Unavailable::Locked }
                    })
                });
            });
        }
    }).map_err(|_| ())?;
    Ok(port)
}

/// 비밀을 못 쓰는 까닭 — 503 의 짧은 이유(값·참조는 싣지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Unavailable {
    /// 볼트가 잠겼다 — 창 0개 잠금이면 **정지**(해제하면 같은 URL 이 다시 통한다).
    Locked,
    /// 참조가 없거나 값이 맞지 않는다.
    Missing,
}

impl Unavailable {
    fn body(self) -> &'static str {
        match self {
            Unavailable::Locked => "vault locked — open Aynx and unlock it (볼트가 잠겼습니다 — Aynx 에서 잠금을 해제하세요)",
            Unavailable::Missing => "MCP secret unavailable (MCP 비밀 값을 쓸 수 없습니다)",
        }
    }
}

fn fail_with(request: Request, status: u16, body: &str) {
    let _ = request.respond(Response::from_string(body).with_status_code(status));
}

fn fail(request: Request, status: u16) {
    let _ = request.respond(Response::from_string("MCP 요청을 처리할 수 없습니다")
        .with_status_code(status));
}

/// 요청 때마다 비밀을 읽는다. 테스트는 같은 관문에 해석 함수만 바꿔 넣는다.
fn serve_with(
    mut request: Request,
    tickets: &Tickets,
    runtime: &tokio::runtime::Runtime,
    client: &reqwest::Client,
    resolve: impl Fn(&str) -> Result<Zeroizing<String>, Unavailable>,
) {
    let server = (|| {
        let token = request.url().strip_prefix("/mcp-proxy/")?;
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let pending = tickets.lock().ok()?;
        let ticket = pending.get(token)?;
        (ticket.server.transport == "http").then(|| ticket.server.clone())
    })();
    let Some(server) = server else { return fail(request, 404); };
    let method = match request.method() {
        tiny_http::Method::Post => reqwest::Method::POST,
        tiny_http::Method::Get => reqwest::Method::GET,
        tiny_http::Method::Delete => reqwest::Method::DELETE,
        _ => return fail(request, 405),
    };
    if request.body_length().is_some_and(|size| size > MAX_BODY) {
        return fail(request, 413);
    }
    let Some(url) = server.url else { return fail(request, 404); };
    let mut upstream = client.request(method, url);
    for header in request.headers() {
        if FORWARD.iter().any(|name| header.field.equiv(name)) {
            upstream = upstream.header(header.field.as_str().as_str(), header.value.as_str());
        }
    }
    for header in server.headers {
        // 이전 볼트에 있던 값도 요청 시 다시 검사한다.
        let value = match resolve(&header.secret_ref) {
            Ok(value) if crate::vault::mcp_value_ok(&value) => value,
            Ok(_) => return fail_with(request, 503, Unavailable::Missing.body()),
            Err(why) => return fail_with(request, 503, why.body()),
        };
        if !crate::agent_mcp::header_name_ok(&header.name) {
            return fail(request, 503);
        }
        let Ok(mut value) = reqwest::header::HeaderValue::from_str(&value) else {
            return fail(request, 503);
        };
        value.set_sensitive(true);
        upstream = upstream.header(header.name, value);
    }
    let mut body = Vec::new();
    if request.as_reader().take((MAX_BODY + 1) as u64).read_to_end(&mut body).is_err() {
        return fail(request, 400);
    }
    if body.len() > MAX_BODY { return fail(request, 413); }
    let mut response = match runtime.block_on(upstream.body(body).send()) {
        Ok(response) => response,
        Err(_) => return fail(request, 502),
    };
    let status = response.status();
    let mut writer = request.into_writer();
    // tiny_http의 기본 chunk encoder는 작은 청크를 모은다. 원시 writer에 직접 프레이밍하고
    // 매 청크 flush하여 끝나지 않는 SSE도 첫 이벤트부터 전달한다. 오류 때 response를 버린다.
    let result = (|| -> std::io::Result<()> {
        write!(writer, "HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""))?;
        for name in ["Content-Type", "Mcp-Session-Id"] {
            if let Some(value) = response.headers().get(name).and_then(|value| value.to_str().ok()) {
                write!(writer, "{name}: {value}\r\n")?;
            }
        }
        if status == reqwest::StatusCode::NO_CONTENT || status == reqwest::StatusCode::NOT_MODIFIED {
            writer.write_all(b"Connection: close\r\n\r\n")?;
            return writer.flush();
        }
        writer.write_all(b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")?;
        writer.flush()?;
        loop {
            let chunk = runtime.block_on(response.chunk())
                .map_err(|_| std::io::Error::other("MCP 응답을 읽지 못했습니다"))?;
            let Some(chunk) = chunk else { break; };
            if chunk.is_empty() { continue; }
            write!(writer, "{:x}\r\n", chunk.len())?;
            writer.write_all(&chunk)?;
            writer.write_all(b"\r\n")?;
            writer.flush()?;
        }
        writer.write_all(b"0\r\n\r\n")?;
        writer.flush()
    })();
    // 클라이언트 쓰기 실패는 값을 담지 않고, 다음 청크를 기다리지 않은 채 업스트림을 끊는다.
    let _ = result;
}

#[cfg(test)]
mod tests;
