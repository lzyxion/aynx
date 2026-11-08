use super::*;
use crate::agent_mcp::McpServer;
use crate::mcp_launch::Ticket;
use std::collections::HashMap;
use std::sync::Mutex;

fn fixture(url: &str) -> McpServer {
    serde_json::from_value(serde_json::json!({
        "name": "remote", "enabled": true, "transport": "http", "url": url,
        "headers": [{"name": "Authorization", "secret_ref": "global/remote/header:Authorization:ref"}]
    })).unwrap()
}

fn proxy_once(
    url: &str,
    resolve: impl Fn(&str) -> Result<Zeroizing<String>, Unavailable> + Send + 'static,
) -> (String, std::thread::JoinHandle<()>) {
    let server = Server::http(("127.0.0.1", 0)).unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let token = "a".repeat(64);
    let tickets = Arc::new(Mutex::new(HashMap::from([(
        token.clone(), Ticket { server: fixture(url), cwd: None },
    )])));
    let worker = std::thread::spawn(move || {
        let request = server.recv().unwrap();
        serve_with(request, &tickets, &runtime().unwrap(), &client().unwrap(), resolve);
    });
    (format!("http://127.0.0.1:{port}/mcp-proxy/{token}"), worker)
}

#[test]
fn secret_headers_and_only_allowed_request_headers_reach_the_fixed_upstream() {
    for method in [reqwest::Method::POST, reqwest::Method::GET, reqwest::Method::DELETE] {
        let upstream = Server::http(("127.0.0.1", 0)).unwrap();
        let port = upstream.server_addr().to_ip().unwrap().port();
        let expected_method = method.as_str().to_owned();
        let worker = std::thread::spawn(move || {
            let mut request = upstream.recv().unwrap();
            assert_eq!(request.url(), "/fixed?source=stored");
            assert_eq!(request.method().as_str(), expected_method);
            let header = |name: &'static str| request.headers().iter().find(|h| h.field.equiv(name))
                .map(|h| h.value.as_str());
            assert_eq!(header("Authorization"), Some("Bearer fixture-secret"));
            assert_eq!(header("Accept"), Some("application/json, text/event-stream"));
            assert_eq!(header("Content-Type"), Some("application/json"));
            assert_eq!(header("Mcp-Session-Id"), Some("session"));
            assert_eq!(header("MCP-Protocol-Version"), Some("2025-06-18"));
            assert_eq!(header("Last-Event-ID"), Some("event"));
            assert!(header("X-Unapproved").is_none());
            assert!(header("Cookie").is_none());
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            assert_eq!(body, "{}");
            request.respond(Response::from_string("ok").with_status_code(201)
                .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap())
                .with_header(tiny_http::Header::from_bytes("Mcp-Session-Id", "upstream-session").unwrap())
                .with_header(tiny_http::Header::from_bytes("X-Unapproved", "hidden").unwrap())).unwrap();
        });
        let (url, proxy) = proxy_once(&format!("http://127.0.0.1:{port}/fixed?source=stored"), |reference| {
            assert_eq!(reference, "global/remote/header:Authorization:ref");
            Ok(Zeroizing::new("Bearer fixture-secret".into()))
        });
        runtime().unwrap().block_on(async {
            let response = client().unwrap().request(method, url)
                .header("Authorization", "must-not-pass")
                .header("Accept", "application/json, text/event-stream")
                .header("Content-Type", "application/json")
                .header("Mcp-Session-Id", "session")
                .header("MCP-Protocol-Version", "2025-06-18")
                .header("Last-Event-ID", "event")
                .header("X-Unapproved", "hidden").header("Cookie", "hidden")
                .body("{}").send().await.unwrap();
            assert_eq!(response.status().as_u16(), 201);
            assert_eq!(response.headers()["mcp-session-id"], "upstream-session");
            assert_eq!(response.headers()["content-type"], "application/json");
            assert!(response.headers().get("x-unapproved").is_none());
            assert_eq!(response.text().await.unwrap(), "ok");
        });
        proxy.join().unwrap();
        worker.join().unwrap();
    }
}

#[test]
fn unknown_ticket_and_path_suffixes_do_not_resolve_secrets() {
    for tail in ["unknown", "tail", "query"] {
        let (url, proxy) = proxy_once("http://127.0.0.1:1/fixed", |_| panic!("잘못된 티켓의 비밀 해석"));
        let url = match tail {
            "unknown" => url.replace(&"a".repeat(64), &"b".repeat(64)),
            "tail" => format!("{url}/other"),
            _ => format!("{url}?target=other"),
        };
        runtime().unwrap().block_on(async {
            assert_eq!(client().unwrap().get(url).send().await.unwrap().status().as_u16(), 404);
        });
        proxy.join().unwrap();
    }
}

#[test]
fn secret_resolution_failure_or_invalid_value_returns_sanitized_503() {
    for value in [None, Some("fixture-secret\r\nx: injected"), Some("fixture-secret\0")] {
        let (url, proxy) = proxy_once("http://127.0.0.1:1/fixed", move |_| {
            value.map(|value| Zeroizing::new(value.into())).ok_or(Unavailable::Missing)
        });
        runtime().unwrap().block_on(async {
            let response = client().unwrap().post(url).send().await.unwrap();
            assert_eq!(response.status().as_u16(), 503);
            let body = response.text().await.unwrap();
            assert!(!body.contains("fixture-secret"));
            assert!(!body.contains("Authorization"));
        });
        proxy.join().unwrap();
    }
}

#[test]
fn first_sse_chunk_arrives_before_the_upstream_finishes() {
    let upstream = Server::http(("127.0.0.1", 0)).unwrap();
    let port = upstream.server_addr().to_ip().unwrap().port();
    let (release, wait) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let request = upstream.recv().unwrap();
        let mut writer = request.into_writer();
        writer.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
        let first = b"data: first\n\n";
        write!(writer, "{:x}\r\n", first.len()).unwrap();
        writer.write_all(first).unwrap();
        writer.write_all(b"\r\n").unwrap();
        writer.flush().unwrap();
        // 클라이언트가 첫 청크를 읽기 전에는 스트림을 끝내지 않는다.
        let _ = wait.recv_timeout(Duration::from_secs(5));
        let _ = writer.write_all(b"0\r\n\r\n");
        let _ = writer.flush();
    });
    let (url, proxy) = proxy_once(&format!("http://127.0.0.1:{port}/events"), |_| {
        Ok(Zeroizing::new("Bearer fixture-secret".into()))
    });
    runtime().unwrap().block_on(async {
        let mut response = client().unwrap().get(url).send().await.unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let chunk = tokio::time::timeout(Duration::from_secs(2), response.chunk())
            .await.expect("SSE 첫 청크를 버퍼에 가두면 안 된다").unwrap().unwrap();
        assert_eq!(chunk.as_ref(), b"data: first\n\n");
        release.send(()).unwrap();
        assert!(response.chunk().await.unwrap().is_none());
    });
    proxy.join().unwrap();
    worker.join().unwrap();
}

#[test]
fn redirects_are_returned_without_following_them() {
    let upstream = Server::http(("127.0.0.1", 0)).unwrap();
    let port = upstream.server_addr().to_ip().unwrap().port();
    let worker = std::thread::spawn(move || {
        upstream.recv().unwrap().respond(Response::empty(302)
            .with_header(tiny_http::Header::from_bytes("Location", "http://127.0.0.1:1/never").unwrap())).unwrap();
    });
    let (url, proxy) = proxy_once(&format!("http://127.0.0.1:{port}/fixed"), |_| Ok(Zeroizing::new("secret".into())));
    runtime().unwrap().block_on(async {
        let response = client().unwrap().get(url).send().await.unwrap();
        assert_eq!(response.status().as_u16(), 302);
        assert!(response.headers().get("location").is_none());
    });
    proxy.join().unwrap();
    worker.join().unwrap();
}

#[test]
fn stdio_ticket_is_not_an_http_proxy_capability() {
    let proxy = Server::http(("127.0.0.1", 0)).unwrap();
    let port = proxy.server_addr().to_ip().unwrap().port();
    let token = "a".repeat(64);
    let mut server = fixture("http://127.0.0.1:1/fixed");
    server.transport = "stdio".into();
    let tickets = Arc::new(Mutex::new(HashMap::from([(
        token.clone(), Ticket { server, cwd: None },
    )])));
    let worker = std::thread::spawn(move || {
        serve_with(proxy.recv().unwrap(), &tickets, &runtime().unwrap(), &client().unwrap(),
            |_| panic!("stdio 티켓은 HTTP 헤더 값을 읽으면 안 된다"));
    });
    runtime().unwrap().block_on(async {
        let response = client().unwrap().get(format!("http://127.0.0.1:{port}/mcp-proxy/{token}"))
            .send().await.unwrap();
        assert_eq!(response.status().as_u16(), 404);
    });
    worker.join().unwrap();
}

/// 창 0개 잠금 동안(볼트 잠김) — 503 + 짧은 이유, 값·참조·헤더 이름은 싣지 않는다.
#[test]
fn a_locked_vault_answers_503_with_a_short_reason() {
    let (url, proxy) = proxy_once("http://127.0.0.1:1/fixed", |_| Err(Unavailable::Locked));
    runtime().unwrap().block_on(async {
        let response = client().unwrap().post(url).send().await.unwrap();
        assert_eq!(response.status().as_u16(), 503);
        let body = response.text().await.unwrap();
        assert!(body.contains("vault locked"), "{body}");
        assert!(!body.contains("global/remote"));
        assert!(!body.contains("Authorization"));
    });
    proxy.join().unwrap();
}
