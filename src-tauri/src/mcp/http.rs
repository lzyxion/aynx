//! 요청 처리 — 문지기(경로·출처·메서드·인증·본문 상한)를 지나 JSON-RPC 디스패치로 넘긴다([`handle_request`]).
//! **③-3c 부터 세션 서버 프로세스**의 한 리스너(`crate::server::signal_http` — `/agent-signal` 과 같은 포트)가 요청마다 스레드
//! 하나에서 이 함수를 부른다(`crate::server::ai` 가 저장소를 묶어 꽂는다). 소켓 읽기 시한·동시 요청 상한·응답 같은 공용 부품은
//! `crate::loopback_http`. 아래 [`serve`]·[`serve_with`] 는 이 파일의 시험이 쓰는 **단독 서버**다(제품 경로가 아니다).
//!
//! 불변식:
//! - 출처 확인은 **인증보다 앞**이다 — `Origin` 이 있으면 거부, `Host` 는 루프백만(DNS 리바인딩 방어 F4).
//! - 모든 MCP 요청에 `Authorization: Bearer <token>` 필수 — 비교는 **상수시간**([`authorized`], F3),
//!   빈 토큰은 무조건 거부(F5).
//! - 받는 토큰은 **전역 토큰 · 타일 토큰 · 오케스트레이션 턴 토큰**(작업자 · 검토자 — `crate::orchestration`, 2026-10-14 설계 C-1).
//!   **타일 토큰**(3차 4단계 — `crate::tile_token`)은 로컬 AI 타일마다 따로이고 `(stream, sessionEpoch)` 에 묶여, 요청마다 그 세션이 살아 있고
//!   회차가 같은지 본다(아니면 401 `stale-tile`). 조정자는 타일 토큰에 서버 표의 묶음이 붙인 역할이다(조정자 토큰은 없다).
//!   호출자 신원([`Caller`](crate::orchestration::Caller))은 **서버 표에서만** 정하고 디스패치로 넘긴다(요청이 보낸 역할 글자는
//!   없다 — 믿을 것이 없다). 모든 토큰이 상수시간 비교다. **사이드 채팅 토큰**(사이드 채팅 v2 5단계 — `crate::chat_token`)은 채팅의
//!   `(채팅, 프로세스 세대)` 에 묶이고(아니면 401 `stale-chat-token`) 호출자는 `Caller::SideChat` — 읽기 도구만(`chat_read`).
//! - **`/agent-signal` 은 여기 없다**(③-3a) — 에이전트 훅 신호는 세션 서버 프로세스의 신호 전용 포트가 받는다
//!   (`crate::server::signal_http`). 과도기 전달 대신 경로를 뺐다: 신호 URL 을 쥔 셸은 모두 세션 서버가 연(로컬) 또는
//!   이 판의 GUI 가 연(원격) 타일이라 처음부터 서버 포트를 들고 있고, 옛 판의 셸은 판 교체(서버 재시작 = 세션 끝)와
//!   함께 사라진다 — 전달 길을 두면 MCP 포트에 두 번째 문이 남을 뿐이다.
//! - 활동 도장은 인증을 지난 본문에만 찍는다. 컨텍스트 잠금은 여기서 잡지 않는다(`tools_call` 안쪽).
//! - 요청 처리 스레드는 `MAX_INFLIGHT` 개까지 — 넘치면 스레드를 띄우기 **전에** 503. 소켓 읽기에는
//!   `READ_TIMEOUT` 이 걸린다([`http_server_with`]).

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

/// 요청 본문 크기 상한(백로그 #7) — 우리 표면은 작업안·인자뿐이라 수 KB 를 넘지 않는다. 256 KiB 는
/// 넉넉한 여유이면서, 로컬 프로세스가 무제한 본문으로 메모리를 밀어 넣는 것을 막는 천장이다.
pub(super) const MAX_BODY_BYTES: usize = 256 * 1024;

/// 리스너 → tiny_http 서버(시험의 단독 서버용) — 시한을 받는다.
#[cfg(test)]
pub(super) fn http_server_with(listener: TcpListener, read_timeout: Duration) -> Option<tiny_http::Server> {
    loopback_http::http_server_with(listener, read_timeout, "MCP 서버")
}

/// 들어오는 요청을 **요청마다 스레드 하나**로 처리한다. 서버가 drop 될 때까지 돈다.
///
/// 순차 루프였던 자리다. [`wait_for_operation`] 이 한 요청을 최대 120초 붙잡으므로 그동안
/// `list_sessions` 같은 즉답 도구까지 함께 서면 안 된다(넘기는 것은 전부 `Arc` 클론이고 토큰만 64자 문자열 복제다).
///
/// `port` 를 들고 다니는 이유는 [`local_origin_ok`] 이다 — `Host` 헤더를 우리 것과 비교하려면
/// 우리가 실제로 잡은 포트를 알아야 한다.
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

/// [`serve`] 의 몸통 — 동시 요청 상한을 받는다(시험이 작게 준다).
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

/// 루프백 호스트에서 온 요청인가 — DNS 리바인딩 방어(F4).
///
/// 공격자 페이지가 자기 도메인을 `127.0.0.1` 로 되돌려 놓으면, 브라우저는 **우리 포트로**
/// 요청을 보내면서 `Host: evil.com` 을 싣는다. 토큰이 없으니 데이터는 못 읽지만 그 앞에서
/// 끊는 게 맞다. 두 갈래로 본다:
///
/// - `Origin` 이 **있으면 무조건 거부**한다. 정상 MCP 클라이언트(CLI)는 이 헤더를 붙이지
///   않는다 — 붙이는 것은 브라우저뿐이고, 브라우저는 우리 클라이언트가 아니다.
/// - `Host` 는 정확히 `127.0.0.1:<port>` 나 `localhost:<port>` 여야 한다. 없으면 거부.
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

/// 한 요청: 경로·출처·메서드·인증을 확인하고 JSON-RPC 를 디스패치한다.
///
/// `ops`·`signal` 은 단계 8 작업안 도구가 쓰는 핸들이다 — 컨텍스트 저장소와 **별개의 잠금**이라
/// 함께 잡을 때 순서는 **컨텍스트 먼저, 작업안 나중**(교착 방지). 컨텍스트 잠금은
/// [`tools_call`](super::rpc::tools_call) 안에서 잡히고 작업안 잠금은 그 안쪽에서 잡히므로 순서는 그대로다
/// (2026-09-22 전에는 여기서 잠가 내려보냈다 — [`wait_for_operation`] 이 그 잠금 위에서
/// 잘 수 없어 한 겹 안으로 옮겼다).
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
    // 경로가 다르면 404 (쿼리 스트링은 떼고 본다). 받는 경로는 MCP(`/mcp`) 하나 — 훅 신호(`/agent-signal`)는
    // ③-3a 부터 세션 서버의 신호 포트가 받는다(머리말).
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

    // 인증: Bearer 토큰이 없거나 틀리면 401. 판정 순서(3차 4단계): ① 전역 토큰(`mcp.json`) → ② **타일 토큰**(`crate::tile_token` — 그 스트림의
    // 지금 회차 · 세션 생존을 요청마다 본다: 아니면 401 `stale-tile`) → ②' **사이드 채팅 토큰**(사이드 채팅 v2 5단계 — `crate::chat_token`: 그 채팅의
    // 지금 프로세스 세대가 아니면 401 `stale-chat-token`) → ③ 작업자 · 검토자 턴 토큰(오케스트레이션 표). 역할은 서버 표에서만 —
    // 타일이 조정자인지는 디스패치 안에서 묶음으로 판정한다(`orchestration::tile`).
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
                // 종류 · 세대는 표에서(2단계 단계 2 — 설계 2-2): 프로듀서는 인증한 세대를 호출자에 그대로 싣는다(처리 중 다시 읽지 않는다).
                Some(crate::chat_token::Auth::Chat { chat, kind: crate::chat_token::ChatKind::Side, .. }) => {
                    Some(crate::orchestration::Caller::SideChat { chat })
                }
                Some(crate::chat_token::Auth::Chat { chat, kind: crate::chat_token::ChatKind::Producer, proc }) => {
                    Some(crate::orchestration::Caller::Producer { chat, proc })
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

    // 본문 크기 상한(백로그 #7) — 작업안·인자는 작다(≤수 KB). `Content-Length` 가 상한을 넘으면
    // 곧장 거부하고, 헤더가 없더라도(청크 등) **상한+1 바이트까지만** 읽어 무제한 읽기를 막는다.
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

    // **활동 도장은 인증을 지난 본문에만 찍는다** — 401·403 으로 끊긴 두드림이 상태바의
    // "AI 연결됨" 을 켜면 그 불은 거짓말이 된다. 찍는 판단은 순수 함수 둘에 있다
    // ([`activity_of`]·[`merge_activity`]) — 여기서는 잠금 한 번을 잡고 갈아 끼울 뿐이다.
    if let Some(stamp) = activity_of(&body, operations::now_ms() as i64) {
        if let Ok(mut slot) = last_seen.lock() {
            *slot = Some(merge_activity(slot.as_ref(), stamp));
        }
    }

    // 컨텍스트 잠금은 **[`tools_call`] 안쪽**에서 잡는다(컨텍스트를 실제로 보는 도구일 때만).
    // 여기서 잠가 내려보내면 `wait_for_operation` 이 최대 120초를 그 잠금 위에서 자게 되고,
    // 그동안 거울 갱신(`context::report`)까지 멈춘다. 락 순서(컨텍스트→작업안)는 그대로다.
    let reply = dispatch(&caller, orch, store, ops, results, signal, &body, db);

    // 설정 화면의 "최근 호출"(`insight.rs`) — 도구 이름 · 시각 · 호출자 종류 · 결과 종류만 남긴다(인자 · 결과 본문 없음).
    let reply_text = match &reply {
        RpcReply::Json(s) => Some(s.as_str()),
        RpcReply::Accepted => None,
    };
    super::insight::CALLS.observe(&caller, &body, reply_text, operations::now_ms() as i64);

    match reply {
        RpcReply::Json(s) => respond(request, 200, &s),
        // 알림(notification)엔 JSON-RPC 결과가 없다 — 202 빈 응답.
        RpcReply::Accepted => respond(request, 202, ""),
    }
}
