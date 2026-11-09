//! 관문 리스너 — hyper(http1) 를 tauri 의 tokio 런타임에서 돌린다. 127.0.0.1 하나에만 묶고, 요청마다 문지기
//! ([`check_request`] — Host · Origin · 메서드)를 지난 요청을 단계(R1a-2 — 쿠키: 미페어링·페어링됨·열림, `gate.rs`)로 가른다:
//! 열림만 정적 파일(`static_files.rs`), 그 전 단계는 관문이 그리는 페어링·잠금 해제 쪽과 POST 다섯(`gate::POST_ROUTES`).
//!
//! 상한(루프백 공용 부품 `loopback_http` 의 값을 그대로): 동시 연결 [`MAX_INFLIGHT`](넘치면 받자마자 닫음) · 머리 읽기 시한
//! [`READ_TIMEOUT`] · 머리 크기 16KiB · 연결 하나의 수명 2분 · GET 에 본문이 있으면 413 · POST 몸은 4KiB 까지(넘으면 413).

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use tauri::utils::config::Csp;
use tokio::net::TcpListener;
use tokio::sync::{watch, Semaphore};

use super::auth::Auth;
use super::funnel::{self, Funnel};
use super::gate::{self, Level};
use super::static_files::{
    self, cache_control, gateway_csp, inline_script_hashes, safe_asset_path, ASSET_PATH, POLYFILL_PATH, WS_PATH,
};
use super::{ws, Config, Handle};
use crate::i18n::tr;
use crate::loopback_http::{MAX_INFLIGHT, READ_TIMEOUT};

/// 연결 하나가 살아 있는 최대 시간 — keep-alive 로 자산 여러 개를 받는 데는 넉넉하고, 붙들고 놓지 않는 연결은 끊는다.
/// 업그레이드된 `/remote/ws` 는 이 상한 밖이다(HTTP 연결은 업그레이드로 끝나고 ws 는 제 태스크 — 제 시한은 `ws.rs`).
const CONN_LIFETIME: Duration = Duration::from_secs(120);
/// 요청 머리 버퍼 상한(hyper 하한 8KiB 위).
const MAX_HEAD_BYTES: usize = 16 * 1024;
/// 도는 동안 Funnel 을 다시 보는 간격.
const FUNNEL_RECHECK: Duration = Duration::from_secs(60);

/// 받을 이름 — 문지기가 보는 것.
#[derive(Debug, Clone)]
pub(crate) struct Allowed {
    /// 설정한 `*.ts.net` 이름(소문자). `None` = 미설정(개발 빌드의 루프백 시험만).
    pub host: Option<String>,
    /// 우리가 듣는 포트 — 루프백 이름은 이 포트까지 같아야 한다.
    pub port: u16,
    /// `127.0.0.1:<포트>`·`localhost:<포트>` 를 받는가 — **개발 빌드만**.
    pub loopback: bool,
}

/// 문지기 거절 — 응답 코드가 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reject {
    /// `Host` 가 없거나·여럿이거나·설정한 이름이 아님 → 421.
    Host,
    /// `Origin` 이 같은 출처가 아님(POST 는 없어도) → 403.
    Origin,
    /// GET 이 아님(POST 는 [`gate::POST_ROUTES`] 만) → 405.
    Method,
}

impl Reject {
    fn status(self) -> StatusCode {
        match self {
            Reject::Host => StatusCode::MISDIRECTED_REQUEST,
            Reject::Origin => StatusCode::FORBIDDEN,
            Reject::Method => StatusCode::METHOD_NOT_ALLOWED,
        }
    }
}

/// 요청 하나의 문지기 — **순수 함수**. `hosts` 는 `Host` 헤더 값 전부(둘 이상이면 거절), `origin` 은 `Origin` 헤더.
///
/// - `Host`: 설정한 이름(포트는 붙어 있어도 됨 — `tailscale serve --https=<포트>` 면 `이름:<포트>`) → 출처 `https://<Host>`.
///   개발 빌드면 `127.0.0.1:<우리 포트>`·`localhost:<우리 포트>` 도 → 출처 `http://<Host>`.
/// - `Origin`: 있으면 위 출처와 글자 그대로(대소문자 무시) 같아야 한다. `null` 도 거절.
/// - 메서드는 이름 검사 **뒤에** 본다 — 엉뚱한 이름으로 온 요청에는 메서드 정보도 주지 않는다. GET 은 어디든, **POST 는
///   [`gate::POST_ROUTES`](페어링·잠금 해제·잠그기·재확인) 에만, 그리고 `Origin` 이 반드시 있어야** 한다(R1a-2 — 브라우저의 fetch POST 는
///   언제나 Origin 을 싣는다. 없으면 브라우저가 아닌 무엇이다 — CSRF 판정을 "없으니 통과" 로 접지 않는다).
pub(crate) fn check_request(
    method: &Method,
    path: &str,
    hosts: &[&str],
    origin: Option<&str>,
    allowed: &Allowed,
) -> Result<(), Reject> {
    let [host] = hosts else {
        return Err(Reject::Host);
    };
    let scheme = host_scheme(host, allowed).ok_or(Reject::Host)?;
    if let Some(origin) = origin {
        if !origin.eq_ignore_ascii_case(&format!("{scheme}://{host}")) {
            return Err(Reject::Origin);
        }
    }
    if method == Method::GET {
        return Ok(());
    }
    if method == Method::POST && gate::is_post_route(path) {
        return if origin.is_some() { Ok(()) } else { Err(Reject::Origin) };
    }
    Err(Reject::Method)
}

/// `Host` 값이 받을 이름이면 그 출처의 스킴.
fn host_scheme(host: &str, allowed: &Allowed) -> Option<&'static str> {
    let (name, port) = match host.rsplit_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    let port_ok = |p: Option<&str>| match p {
        None => true,
        Some(p) => !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u16>().is_ok(),
    };
    if let Some(want) = allowed.host.as_deref() {
        if name.eq_ignore_ascii_case(want) && port_ok(port) {
            return Some("https");
        }
    }
    if allowed.loopback
        && (name == "127.0.0.1" || name.eq_ignore_ascii_case("localhost"))
        && port.and_then(|p| p.parse::<u16>().ok()) == Some(allowed.port)
        && port_ok(port)
    {
        return Some("http");
    }
    None
}

/// 연결마다 공유하는 것.
struct Ctx {
    app: tauri::AppHandle,
    allowed: Allowed,
    csp: Csp,
    auth: Arc<Auth>,
    /// 관문 회차의 닫힘 신호 — 업그레이드된 ws 도 이것을 본다.
    stop: watch::Receiver<bool>,
}

/// 관문 한 회차: Funnel 확인 → 127.0.0.1 묶기 → 받기 + 60초마다 Funnel 재확인. `stopped` 가 `true` 가 되면 끝난다.
pub(crate) async fn run(handle: Handle, cfg: Config, mut stopped: watch::Receiver<bool>) {
    let fail = |handle: &Handle, error: String, funnel: Option<&Funnel>| {
        eprintln!("[aynx] 원격 관문: {error}");
        handle.update(true, |s| {
            s.listening = false;
            s.error = Some(error);
            if let Some(f) = funnel {
                s.funnel = f.label();
            }
        });
    };
    let Some(csp) = handle.app.config().app.security.csp.clone() else {
        fail(
            &handle,
            tr!(ko: "CSP 가 없는 빌드라 열지 않습니다(tauri.conf.json app.security.csp)", en: "Not opened: this build has no CSP (tauri.conf.json app.security.csp)"),
            None,
        );
        return;
    };
    let port = cfg.port;
    let first = check_funnel(port).await;
    if first == Funnel::On {
        fail(&handle, funnel_on_error(port), Some(&first));
        return;
    }
    let listener = match TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await {
        Ok(l) => l,
        Err(e) => {
            fail(
                &handle,
                tr!(ko: "127.0.0.1:{port} 에 묶지 못했습니다: {e}", en: "Could not bind 127.0.0.1:{port}: {e}", port = port, e = e),
                Some(&first),
            );
            return;
        }
    };
    report_funnel(&handle, &first, true);
    let ctx = Arc::new(Ctx {
        app: handle.app.clone(),
        allowed: Allowed {
            host: cfg.host.clone(),
            port,
            loopback: crate::instance::DEV,
        },
        csp,
        auth: Arc::clone(&handle.auth),
        stop: stopped.clone(),
    });
    let slots = Arc::new(Semaphore::new(MAX_INFLIGHT));
    let mut recheck = tokio::time::interval(FUNNEL_RECHECK);
    recheck.tick().await; // 첫 틱은 곧바로 — 방금 봤다
    loop {
        tokio::select! {
            changed = stopped.changed() => {
                if changed.is_err() || *stopped.borrow() {
                    break;
                }
            }
            _ = recheck.tick() => {
                let now = check_funnel(port).await;
                if now == Funnel::On {
                    fail(&handle, funnel_on_error(port), Some(&now));
                    break;
                }
                report_funnel(&handle, &now, true);
            }
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let Ok(slot) = Arc::clone(&slots).try_acquire_owned() else {
                    drop(stream); // 동시 상한 — 받자마자 닫는다
                    continue;
                };
                let ctx = Arc::clone(&ctx);
                let mut stop = stopped.clone();
                tokio::spawn(async move {
                    let _slot = slot;
                    let service = hyper::service::service_fn(move |req| {
                        let ctx = Arc::clone(&ctx);
                        async move { Ok::<_, Infallible>(handle_request(&ctx, req).await) }
                    });
                    let mut builder = hyper::server::conn::http1::Builder::new();
                    builder
                        .timer(TokioTimer::new())
                        .header_read_timeout(READ_TIMEOUT)
                        .max_buf_size(MAX_HEAD_BYTES);
                    let conn = builder.serve_connection(TokioIo::new(stream), service).with_upgrades();
                    tokio::pin!(conn);
                    tokio::select! {
                        _ = conn.as_mut() => {}
                        _ = stop.changed() => {}
                        _ = tokio::time::sleep(CONN_LIFETIME) => {}
                    }
                });
            }
        }
    }
    // 리스너는 여기서 drop 된다 — 포트를 놓는다.
    handle.update(false, |s| s.listening = false);
}

async fn check_funnel(port: u16) -> Funnel {
    tauri::async_runtime::spawn_blocking(move || funnel::check(port))
        .await
        .unwrap_or_else(|e| Funnel::Unknown(e.to_string()))
}

fn funnel_on_error(port: u16) -> String {
    tr!(
        ko: "Tailscale Funnel 이 이 포트({port})를 공개 인터넷에 내보내고 있어 관문을 닫았습니다 — `tailscale funnel` 을 끄고 serve 만 쓰세요",
        en: "Closed: Tailscale Funnel exposes this port ({port}) to the public internet — turn funnel off and use serve only",
        port = port
    )
}

fn report_funnel(handle: &Handle, funnel: &Funnel, listening: bool) {
    let (label, error) = match funnel {
        Funnel::Unknown(why) => ("unknown", Some(why.clone())),
        other => (other.label(), None),
    };
    handle.update(false, |s| {
        s.listening = listening;
        s.funnel = label;
        s.error = error;
    });
}

async fn handle_request(ctx: &Ctx, req: Request<Incoming>) -> Response<Full<Bytes>> {
    let has_origin = {
        let hosts: Vec<&str> = req
            .headers()
            .get_all(header::HOST)
            .iter()
            .map(|v| v.to_str().unwrap_or("\u{0}"))
            .collect();
        let origins: Vec<&HeaderValue> = req.headers().get_all(header::ORIGIN).iter().collect();
        let origin = match origins.as_slice() {
            [] => None,
            [one] => Some(one.to_str().unwrap_or("\u{0}")),
            _ => Some("\u{0}"), // 둘 이상 — 어느 것도 같은 출처일 수 없다
        };
        if let Err(reject) = check_request(req.method(), req.uri().path(), &hosts, origin, &ctx.allowed) {
            return plain(reject.status(), "");
        }
        origin.is_some()
    };
    if req.uri().path() == WS_PATH {
        return ws_upgrade(ctx, req, has_origin);
    }
    if req.method() == Method::POST {
        let path = req.uri().path().to_string();
        let headers = req.headers().clone();
        let Ok(collected) = Limited::new(req.into_body(), gate::MAX_POST_BODY).collect().await else {
            return plain(StatusCode::PAYLOAD_TOO_LARGE, "");
        };
        return gate::post(&ctx.app, &ctx.auth, &path, &headers, collected.to_bytes()).await;
    }
    // GET 에 본문은 없다 — 있으면(길이·청크) 읽지 않고 거절한다.
    let has_body = req.headers().contains_key(header::TRANSFER_ENCODING)
        || req
            .headers()
            .get(header::CONTENT_LENGTH)
            .is_some_and(|v| v.as_bytes() != b"0");
    if has_body {
        return plain(StatusCode::PAYLOAD_TOO_LARGE, "");
    }
    let raw_path = req.uri().path();
    if let Some((body, mime)) = gate::gate_asset(raw_path) {
        return gate::asset_response(body, mime);
    }
    // 단계(R1a-2): 열림만 앱 파일을 받는다 — 그 전 단계는 셸 자리(`/`)에 관문 쪽, 나머지는 401(앱 HTML·번들을 내지 않는다).
    let now = Instant::now();
    match gate::level(&ctx.auth, req.headers(), now) {
        Level::Open(_) => {}
        Level::Paired(_) if gate::is_shell(raw_path) => return gate::page_response(gate::unlock_page_now().await),
        Level::Unpaired if gate::is_shell(raw_path) => return gate::page_response(gate::pair_page()),
        _ => return plain(StatusCode::UNAUTHORIZED, ""),
    }
    // 원격 창(R1a-3) — 폴리필 · `convertFileSrc` 의 파일.
    if raw_path == POLYFILL_PATH {
        return script_response(POLYFILL, &ctx.csp);
    }
    if raw_path == ASSET_PATH {
        return remote_asset(ctx, req.uri().query()).await;
    }
    let Some(path) = safe_asset_path(raw_path) else {
        return plain(StatusCode::NOT_FOUND, "");
    };
    let app = ctx.app.clone();
    let key = path.clone();
    let asset = tauri::async_runtime::spawn_blocking(move || {
        app.asset_resolver()
            .get(key)
            .map(|a| (a.bytes, a.mime_type))
    })
    .await
    .ok()
    .flatten();
    let Some((bytes, mime)) = asset else {
        return plain(StatusCode::NOT_FOUND, "");
    };
    // 앱 셸 — 원격 부팅(부팅 표 · 폴리필)을 끼운다. 표는 이 응답에만 실린다(`no-store`).
    if path == "index.html" {
        let Some(html) = remote_shell(ctx, req.headers(), now, &bytes) else {
            return plain(StatusCode::UNAUTHORIZED, "");
        };
        return asset_response(&path, html.into_bytes(), mime, &ctx.csp);
    }
    asset_response(&path, bytes, mime, &ctx.csp)
}

/// 원격 창의 폴리필 — `window.__TAURI_INTERNALS__` 를 세운다(`polyfill.js` 머리말).
const POLYFILL: &str = include_str!("polyfill.js");

/// 앱 셸 + 원격 부팅. 세션의 부팅 표를 하나 뽑는다(라벨·세대가 정해진다).
fn remote_shell(ctx: &Ctx, headers: &hyper::HeaderMap, now: Instant, bytes: &[u8]) -> Option<String> {
    let (device, session) = gate::open_session(&ctx.auth, headers, now)?;
    let (ticket, label, gen, name) = {
        let mut st = ctx.auth.lock();
        let (ticket, label, gen) = st.issue_ticket(&device, &session, now)?;
        (ticket, label, gen, st.device_name(&device))
    };
    let (sep, delimiter) = static_files::path_separators();
    let boot = serde_json::json!({
        "label": label,
        "gen": gen,
        "ticket": ticket.as_str(),
        "sep": sep,
        "delimiter": delimiter,
        // 재확인 명령(R1a-4) — 폴리필이 이것들 앞에서 `/remote/reauth` 로 표를 받는다(표는 `deny.rs` 하나).
        "reauth": super::deny::REAUTH,
        // 원격 상태바의 "원격 — <기기 이름>"(R1a-5). 속성 값은 `inject_remote_boot` 가 이스케이프한다.
        "device": name,
        // 이 기기의 id(10-20 — 폰 설정의 [이 기기 페어링 해제]가 원격 허용 `remote_device_revoke` 에 넘긴다). 비밀이 아니다 — 기기
        // 목록(`remote_devices_list`)이 이미 원격에 내보내는 값이다. 페어링 토큰 · 세션 쿠키와 무관.
        "deviceId": device,
        // 집 PC 의 지금 앱 언어 — 앱 모듈이 뜨기 전 폴리필 자신의 문구(작은 암호 칸 · 거절 문구)가 쓴다. 뜬 뒤에는 `<html lang>`.
        "lang": match crate::i18n::lang() {
            crate::i18n::Lang::En => "en",
            crate::i18n::Lang::Ko => "ko",
        },
    });
    static_files::inject_remote_boot(&String::from_utf8_lossy(bytes), &boot.to_string())
}

fn script_response(body: &'static str, csp: &Csp) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(body.as_bytes())));
    let headers = response.headers_mut();
    set(headers, header::CONTENT_TYPE, "text/javascript; charset=utf-8");
    set(headers, header::CACHE_CONTROL, "no-cache");
    set(headers, header::CONTENT_SECURITY_POLICY, &gateway_csp(csp, &[]));
    security_headers(headers);
    response
}

/// 그림 한 장의 상한(월페이퍼 받기와 같은 50MB).
const MAX_ASSET_BYTES: u64 = 50 * 1024 * 1024;

/// `GET /remote/asset?path=<절대 경로>` — 원격의 `convertFileSrc`(설계 14.6). 열림만(위에서 걸렀다) · **Tauri asset 스코프와 같은
/// 판정**(`asset_protocol_scope().is_allowed` — 지금은 월페이퍼 사본 이름만) · 래스터 그림만. 밖이면 404(있는지도 밝히지 않는다).
async fn remote_asset(ctx: &Ctx, query: Option<&str>) -> Response<Full<Bytes>> {
    use tauri::Manager;
    let Some((path, mime)) = static_files::query_param(query, "path").and_then(|p| static_files::asset_request(&p)) else {
        return plain(StatusCode::NOT_FOUND, "");
    };
    let app = ctx.app.clone();
    let read = tauri::async_runtime::spawn_blocking(move || -> Option<Vec<u8>> {
        if !app.asset_protocol_scope().is_allowed(&path) {
            return None;
        }
        use std::io::Read;
        let file = std::fs::File::open(&path).ok()?;
        if file.metadata().ok()?.len() > MAX_ASSET_BYTES {
            return None;
        }
        let mut buf = Vec::new();
        file.take(MAX_ASSET_BYTES).read_to_end(&mut buf).ok()?;
        Some(buf)
    })
    .await
    .ok()
    .flatten();
    let Some(bytes) = read else {
        return plain(StatusCode::NOT_FOUND, "");
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    let headers = response.headers_mut();
    set(headers, header::CONTENT_TYPE, mime);
    set(headers, header::CACHE_CONTROL, "private, no-cache");
    set(headers, header::CONTENT_SECURITY_POLICY, &gateway_csp(&ctx.csp, &[]));
    security_headers(headers);
    response
}

/// `GET /remote/ws?t=<부팅 표>` — 원격 창 업그레이드(`ws.rs` 머리말의 조건 전부). 거절은 짧은 코드뿐.
fn ws_upgrade(ctx: &Ctx, mut req: Request<Incoming>, has_origin: bool) -> Response<Full<Bytes>> {
    if !has_origin {
        return plain(StatusCode::FORBIDDEN, "");
    }
    let h = req.headers();
    let token_has = |name: header::HeaderName, want: &str| {
        h.get_all(name)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(','))
            .any(|t| t.trim().eq_ignore_ascii_case(want))
    };
    let version_ok = h.get(header::SEC_WEBSOCKET_VERSION).and_then(|v| v.to_str().ok()) == Some("13");
    if !token_has(header::UPGRADE, "websocket") || !token_has(header::CONNECTION, "upgrade") || !version_ok {
        return plain(StatusCode::BAD_REQUEST, "");
    }
    let Some(accept) = h
        .get(header::SEC_WEBSOCKET_KEY)
        .and_then(|v| v.to_str().ok())
        .and_then(ws::accept_key)
    else {
        return plain(StatusCode::BAD_REQUEST, "");
    };
    let now = Instant::now();
    let Some((device, session)) = gate::open_session(&ctx.auth, h, now) else {
        return plain(StatusCode::UNAUTHORIZED, "");
    };
    let Some(ticket) = static_files::query_param(req.uri().query(), "t") else {
        return plain(StatusCode::UNAUTHORIZED, "");
    };
    let Some((label, gen)) = ctx.auth.lock().take_ticket(&ticket, &device, &session, now) else {
        return plain(StatusCode::UNAUTHORIZED, "");
    };
    let Some(slot) = ws::Slot::take(&device) else {
        return plain(StatusCode::TOO_MANY_REQUESTS, "");
    };
    let conn = ws::Conn {
        app: ctx.app.clone(),
        auth: Arc::clone(&ctx.auth),
        device,
        session,
        label,
        gen,
        slot,
    };
    let stop = ctx.stop.clone();
    let on_upgrade = hyper::upgrade::on(&mut req);
    tokio::spawn(async move {
        match on_upgrade.await {
            Ok(upgraded) => ws::serve(conn, upgraded, stop).await,
            Err(e) => eprintln!("[aynx] 원격 관문: ws 업그레이드 실패 — {e}"),
        }
    });
    let mut response = Response::new(Full::new(Bytes::new()));
    *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    let headers = response.headers_mut();
    set(headers, header::UPGRADE, "websocket");
    set(headers, header::CONNECTION, "Upgrade");
    set(headers, header::SEC_WEBSOCKET_ACCEPT, &accept);
    response
}

/// 자산 한 장의 응답 — 내용 종류 · 캐시 · **CSP**(HTML 이면 인라인 스크립트 해시까지) · 보안 머리. 순수 조립(시험이 머리를 본다).
pub(crate) fn asset_response(path: &str, bytes: Vec<u8>, mime: String, csp: &Csp) -> Response<Full<Bytes>> {
    let is_html = mime.starts_with("text/html");
    let csp = if is_html {
        gateway_csp(csp, &inline_script_hashes(&String::from_utf8_lossy(&bytes)))
    } else {
        gateway_csp(csp, &[])
    };
    let content_type = if is_html && !mime.contains("charset") {
        format!("{mime}; charset=utf-8")
    } else {
        mime
    };
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    let headers = response.headers_mut();
    set(headers, header::CONTENT_TYPE, &content_type);
    set(headers, header::CACHE_CONTROL, cache_control(path, is_html));
    set(headers, header::CONTENT_SECURITY_POLICY, &csp);
    security_headers(headers);
    response
}

/// 짧은 글자 응답(거절·없음) — 캐시 안 함.
fn plain(status: StatusCode, body: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(body.as_bytes())));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    set(headers, header::CONTENT_TYPE, "text/plain; charset=utf-8");
    set(headers, header::CACHE_CONTROL, "no-store");
    if status == StatusCode::METHOD_NOT_ALLOWED {
        set(headers, header::ALLOW, "GET, POST");
    }
    security_headers(headers);
    response
}

fn security_headers(headers: &mut hyper::HeaderMap) {
    set(headers, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    set(headers, header::REFERRER_POLICY, "no-referrer");
}

fn set(headers: &mut hyper::HeaderMap, name: header::HeaderName, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        headers.insert(name, v);
    }
}
