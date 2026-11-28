//! `/mcp` 요청 처리 — 문지기(경로·출처·메서드·인증·본문 상한)를 지나 JSON-RPC 디스패치로 넘긴다([`handle_request`]).
//! [`serve`]·[`serve_with`] 는 시험이 쓰는 단독 서버다(제품 경로는 `crate::server::signal_http` 리스너).
//!
//! 불변식:
//! - 출처 확인은 **인증보다 앞**이다 — `Origin` 이 있으면 거부, `Host` 는 루프백만(DNS 리바인딩 방어 F4).
//! - 모든 MCP 요청에 Bearer 필수 — 비교는 **상수시간**([`authorized`], F3), 빈 토큰은 무조건 거부(F5).
//! - 받는 토큰은 전역 · 타일 · 채팅(사이드 · 프로듀서) · 오케스트레이션 턴(작업자 · 검토자). 타일 토큰은 `(stream, sessionEpoch)`, 채팅 토큰은
//!   `(채팅, 프로세스 세대)` 에 묶여 요청마다 확인한다(아니면 401 `stale-tile` · `stale-chat-token`). 사이드 채팅은 읽기 도구만(`chat_read`).
//! - 호출자 신원([`Caller`](crate::orchestration::Caller))은 **서버 표에서만** 정한다 — 요청이 보낸 역할 글자는 없다. 조정자 토큰은 없다.
//! - `/agent-signal` 은 여기서 받지 않는다 — 같은 리스너의 신호 갈래(`crate::server::signal_http`)가 신호 전용 토큰으로만 받는다. MCP 쪽에 전달 길을 두면 두 번째 문이 남는다.
//! - 활동 도장은 인증을 지난 본문에만 찍는다. 컨텍스트 잠금은 여기서 잡지 않는다(`tools_call` 안쪽).

#[cfg(test)]
use std::net::TcpListener;
#[cfg(test)]
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(test)]
use std::time::Duration;

use serde_json::Value;

use crate::context::Store;
use crate::loopback_http::{self, header_value, respond};
#[cfg(test)]
use crate::loopback_http::MAX_INFLIGHT;
use crate::operations::{self, OperationStore, ResultStore};

pub(crate) use crate::loopback_http::authorized;

use super::*;

pub(super) const MAX_BODY_BYTES: usize = 256 * 1024;

#[cfg(test)]
pub(super) fn http_server_with(listener: TcpListener, read_timeout: Duration) -> Option<tiny_http::Server> {
    loopback_http::http_server_with(listener, read_timeout, "MCP 서버")
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn serve(
    server: tiny_http::Server,
    store: Store,
    ops: OperationStore,
    results: ResultStore,
    signal: Arc<McpSignal>,
    last_seen: Arc<Mutex<Option<McpActivity>>>,
    token: String,
    port: u16,
) {
    serve_with(
        server, store, ops, results, signal, last_seen, token, port, MAX_INFLIGHT,
    );
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn serve_with(
    server: tiny_http::Server,
    store: Store,
    ops: OperationStore,
    results: ResultStore,
    signal: Arc<McpSignal>,
    last_seen: Arc<Mutex<Option<McpActivity>>>,
    token: String,
    port: u16,
    max_inflight: usize,
) {
    loopback_http::serve_threads(&server, max_inflight, "MCP", move |request| {
        handle_request(
            request,
            &store,
            &ops,
            &results,
            &signal,
            &last_seen,
            &token,
            None,
            port,
            &DbEnv::none(),
        );
    });
}

/// DNS 리바인딩 방어(F4) — `Origin` 이 있으면 무조건 거부한다(정상 MCP 클라이언트는 붙이지 않고, 붙이는 것은 브라우저뿐이다).
pub(crate) fn local_origin_ok(host: Option<&str>, origin: Option<&str>, port: u16) -> bool {
    if origin.is_some() {
        return false;
    }
    let Some(host) = host.map(str::trim) else {
        return false;
    };
    host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
        || host.eq_ignore_ascii_case(&format!("localhost:{port}"))
}

/// 락 순서는 컨텍스트 먼저, 작업안 나중이다 — 컨텍스트 잠금은 [`tools_call`](super::rpc::tools_call) 안에서 잡는다([`wait_for_operation`] 이 잠금 위에서 자지 않게).
#[allow(clippy::too_many_arguments)]
pub(crate) fn handle_request(
    mut request: tiny_http::Request,
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    last_seen: &Mutex<Option<McpActivity>>,
    token: &str,
    orch: Option<&crate::orchestration::Orchestration>,
    port: u16,
    db: &DbEnv,
) {
    let path = request.url().split('?').next().unwrap_or("");
    if path != MCP_PATH {
        respond(request, 404, "{\"error\":\"not found\"}");
        return;
    }

    // 출처 확인은 **인증보다 앞**이다(F4) — 브라우저가 실어 보낸 요청은 토큰을 대 볼 기회조차 주지 않는다.
    let host = header_value(&request, "Host");
    let origin = header_value(&request, "Origin");
    if !local_origin_ok(host, origin, port) {
        respond(request, 403, "{\"error\":\"forbidden\"}");
        return;
    }

    // SSE 는 하지 않는다 — GET 은 405.
    if *request.method() != tiny_http::Method::Post {
        respond(request, 405, "{\"error\":\"method not allowed\"}");
        return;
    }

    // 역할은 서버 표에서만 — 조정자인지는 디스패치 안에서 판정한다(`orchestration::tile`).
    let auth = header_value(&request, "Authorization");
    let caller = if authorized(auth, token) {
        Some(crate::orchestration::Caller::Global)
    } else {
        match crate::tile_token::authenticate(auth) {
            Some(crate::tile_token::Auth::Tile(stream)) => Some(crate::orchestration::Caller::Tile { stream }),
            Some(crate::tile_token::Auth::Stale) => {
                respond(request, 401, &format!("{{\"error\":\"{}\"}}", crate::tile_token::STALE_TILE));
                return;
            }
            None => match crate::chat_token::authenticate(auth) {
                // 프로듀서는 인증한 세대를 호출자에 그대로 싣는다(처리 중 다시 읽지 않는다).
                Some(crate::chat_token::Auth::Chat { chat, kind: crate::chat_token::ChatKind::Side, .. }) => {
                    Some(crate::orchestration::Caller::SideChat { chat })
                }
                Some(crate::chat_token::Auth::Chat { chat, kind: crate::chat_token::ChatKind::Producer, proc }) => {
                    Some(crate::orchestration::Caller::Producer { chat, proc })
                }
                Some(crate::chat_token::Auth::Chat { chat, kind: crate::chat_token::ChatKind::Tile, proc }) => {
                    Some(crate::orchestration::Caller::ChatTile { chat, proc })
                }
                Some(crate::chat_token::Auth::Stale) => {
                    respond(request, 401, &format!("{{\"error\":\"{}\"}}", crate::chat_token::STALE_CHAT_TOKEN));
                    return;
                }
                None => orch.and_then(|o| o.resolve(auth)),
            },
        }
    };
    let Some(caller) = caller else {
        respond(request, 401, "{\"error\":\"unauthorized\"}");
        return;
    };

    let body = match loopback_http::read_body_capped(&mut request, MAX_BODY_BYTES) {
        Ok(b) => b,
        Err(true) => {
            respond(
                request,
                413,
                &error_response(&Value::Null, -32600, "request body too large"),
            );
            return;
        }
        Err(false) => {
            respond(
                request,
                400,
                &error_response(&Value::Null, -32700, "Parse error"),
            );
            return;
        }
    };

    // 활동 도장은 인증을 지난 본문에만 — 401·403 으로 끊긴 두드림이 상태바의 "AI 연결됨" 을 켜면 거짓 불이 된다.
    if let Some(stamp) = activity_of(&body, operations::now_ms() as i64) {
        if let Ok(mut slot) = last_seen.lock() {
            *slot = Some(merge_activity(slot.as_ref(), stamp));
        }
    }

    let reply = dispatch(&caller, orch, store, ops, results, signal, &body, db);

    // "최근 호출"(`insight.rs`)에는 도구 이름 · 시각 · 호출자 종류 · 결과 종류만 남긴다(인자 · 결과 본문 없음).
    let reply_text = match &reply {
        RpcReply::Json(s) => Some(s.as_str()),
        RpcReply::Accepted => None,
    };
    super::insight::CALLS.observe(&caller, &body, reply_text, operations::now_ms() as i64);

    match reply {
        RpcReply::Json(s) => respond(request, 200, &s),
        RpcReply::Accepted => respond(request, 202, ""),
    }
}
