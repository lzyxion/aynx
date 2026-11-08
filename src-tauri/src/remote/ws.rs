//! 원격 창의 **WebSocket**(R1a-3) — `GET /remote/ws?t=<부팅 표>` 업그레이드 + 연결 하나의 고리.
//!
//! 받는 조건(전부): 문지기(Host·Origin — `gateway::check_request`)를 지났고 **`Origin` 이 반드시 있다**(브라우저 ws 는 늘 싣는다) ·
//! 쿠키가 **열림**(기기 + 살아 있는 세션) · 부팅 표가 그 기기·그 세션의 것(1회용 — `auth::take_ticket`) · 연결 상한(기기당
//! [`MAX_PER_DEVICE`] · 전체 [`MAX_TOTAL`]). 업그레이드 뒤의 연결은 관문의 HTTP 연결 수명(2분) 밖이다 — 대신:
//!
//! - **세션이 끝나면 곧바로 닫는다**: 잠그기·폐기·관문 끄기는 [`sessions_changed`] 가 깨우고, 무입력·절대 시한은 [`SESSION_CHECK`]
//!   마다 본다. invoke 마다도 세션을 다시 본다. 이렇게 닫힌 연결은 볼트 셈의 유예가 없다(`windows::conn_closed`).
//! - 핑 [`PING_EVERY`] · 아무것도 받지 못한 지 [`IDLE_TIMEOUT`] 이면 닫는다. 메시지·프레임 상한 [`MAX_MESSAGE`].
//! - 원격 세션의 **무입력 시계는 사람 입력만** 되감는다 — 페이지가 키·포인터 입력 때 `{t:"active"}` 를 보낸다(IPC 폴링은 아니다).
//!
//! 끊기면 페이지는 다시 읽는다(`polyfill.js`) — 같은 페이지가 새 연결에 다시 붙지 않는다(라벨 = 페이지 수명 · `bridge.rs`).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use hyper::upgrade::Upgraded;
use hyper_util::rt::TokioIo;
use tauri::ipc::InvokeBody;
use tauri::{AppHandle, WebviewWindow};
use tokio::sync::{watch, Notify};
use tokio_tungstenite::tungstenite::protocol::{Role, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::auth::Auth;
use super::bridge::{self, Out, Outbox};
use super::frames::{self, ClientFrame};
use super::windows;

/// 받는 메시지·프레임 상한 — 파일 저장(원시 본문 invoke)도 이 안이어야 한다.
pub(crate) const MAX_MESSAGE: usize = 16 * 1024 * 1024;
const PING_EVERY: Duration = Duration::from_secs(20);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const SESSION_CHECK: Duration = Duration::from_secs(5);
/// 기기 하나가 동시에 여는 원격 창 상한.
pub(crate) const MAX_PER_DEVICE: usize = 4;
/// 전체 원격 창 상한.
pub(crate) const MAX_TOTAL: usize = 12;

/// 세션 표가 바뀌었다(잠그기·폐기·관문 끄기 — `gate::sessions_changed`) — 모든 연결이 자기 세션을 곧바로 다시 본다.
static SESSIONS: Notify = Notify::const_new();

pub(crate) fn sessions_changed() {
    SESSIONS.notify_waiters();
}

/// 기기 → 지금 연결 수.
static PER_DEVICE: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Mutex::default);
static TOTAL: AtomicUsize = AtomicUsize::new(0);

/// 연결 자리 하나 — 떨어지면 돌려준다.
pub(crate) struct Slot {
    device: String,
}

impl Slot {
    /// 상한 안이면 자리를 잡는다.
    pub(crate) fn take(device: &str) -> Option<Slot> {
        let mut per = PER_DEVICE.lock().unwrap_or_else(|e| e.into_inner());
        let n = per.get(device).copied().unwrap_or(0);
        if n >= MAX_PER_DEVICE || TOTAL.load(Ordering::SeqCst) >= MAX_TOTAL {
            return None;
        }
        per.insert(device.to_string(), n + 1);
        TOTAL.fetch_add(1, Ordering::SeqCst);
        Some(Slot { device: device.to_string() })
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        let mut per = PER_DEVICE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(n) = per.get_mut(&self.device) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                per.remove(&self.device);
            }
        }
        TOTAL.fetch_sub(1, Ordering::SeqCst);
    }
}

/// `Sec-WebSocket-Accept` — `base64(sha1(key + GUID))`(RFC 6455 4.2.2). 키는 base64 16바이트(24자)만.
pub(crate) fn accept_key(key: &str) -> Option<String> {
    use sha1::{Digest, Sha1};
    let key = key.trim();
    let raw = data_encoding::BASE64.decode(key.as_bytes()).ok()?;
    if raw.len() != 16 {
        return None;
    }
    let mut h = Sha1::new();
    h.update(key.as_bytes());
    h.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    Some(data_encoding::BASE64.encode(&h.finalize()))
}

/// 연결 하나에 필요한 것.
pub(crate) struct Conn {
    pub app: AppHandle,
    pub auth: Arc<Auth>,
    pub device: String,
    pub session: [u8; 32],
    pub label: String,
    pub gen: u64,
    pub slot: Slot,
}

/// 닫힌 까닭 — 세션이 끝나서 닫혔는가가 볼트 셈의 유예를 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum End {
    SessionEnded,
    Other,
}

/// 업그레이드된 연결 하나를 끝까지 돈다.
pub(crate) async fn serve(conn: Conn, upgraded: Upgraded, mut stop: watch::Receiver<bool>) {
    let Conn {
        app,
        auth,
        device,
        session,
        label,
        gen,
        slot: _slot,
    } = conn;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    let ws = WebSocketStream::from_raw_socket(TokioIo::new(upgraded), Role::Server, Some(config)).await;
    let (mut sink, mut stream) = ws.split();

    let window = match bridge::open_window(&app, &label).await {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[aynx] 원격 관문: 원격 창을 만들지 못했습니다 — {e}");
            let _ = sink.send(Message::text(frames::bye("window"))).await;
            let _ = sink.close().await;
            return;
        }
    };
    let (out, mut rx) = Outbox::new();
    bridge::register(&label, gen, out.clone());
    windows::conn_opened();
    eprintln!("[aynx] 원격 관문: 원격 창 열림 — {label}");
    // 기록 · 상태바(R1a-5 — `activity.rs`).
    super::activity::conn_opened(&device);
    let name = auth.lock().device_name(&device);
    super::activity::record(super::activity::Kind::Connected, &device, &name);
    super::gate::activity_changed(&app, &auth);
    out.text(frames::hello(&label, gen, &app.package_info().version.to_string()));

    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let mut check = tokio::time::interval(SESSION_CHECK);
    check.tick().await;
    let mut last_rx = Instant::now();
    let alive = |auth: &Auth| auth.lock().session_alive(&session, Instant::now());

    let end = loop {
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    let _ = sink.send(Message::text(frames::bye("gateway"))).await;
                    break End::Other;
                }
            }
            _ = SESSIONS.notified() => {
                if !alive(&auth) {
                    let _ = sink.send(Message::text(frames::bye("session"))).await;
                    break End::SessionEnded;
                }
            }
            _ = check.tick() => {
                if !alive(&auth) {
                    let _ = sink.send(Message::text(frames::bye("session"))).await;
                    break End::SessionEnded;
                }
            }
            _ = ping.tick() => {
                if last_rx.elapsed() > IDLE_TIMEOUT {
                    break End::Other;
                }
                if sink.send(Message::Ping(Default::default())).await.is_err() {
                    break End::Other;
                }
            }
            next = rx.recv() => {
                let Some(next) = next else { break End::Other };
                let sent = match next {
                    Out::Text(t) => {
                        let n = t.len();
                        let r = sink.send(Message::text(t)).await;
                        out.sent(n);
                        r
                    }
                    Out::Binary(b) => {
                        let n = b.len();
                        let r = sink.send(Message::binary(b)).await;
                        out.sent(n);
                        r
                    }
                    Out::Close(reason) => {
                        let _ = sink.send(Message::text(frames::bye(reason))).await;
                        break End::Other;
                    }
                };
                if sent.is_err() {
                    break End::Other;
                }
            }
            msg = stream.next() => {
                let Some(Ok(msg)) = msg else { break End::Other };
                last_rx = Instant::now();
                match msg {
                    Message::Text(text) => {
                        if !alive(&auth) {
                            let _ = sink.send(Message::text(frames::bye("session"))).await;
                            break End::SessionEnded;
                        }
                        on_text(&app, &auth, &session, &window, &out, text.as_str());
                    }
                    Message::Binary(bytes) => {
                        if !alive(&auth) {
                            let _ = sink.send(Message::text(frames::bye("session"))).await;
                            break End::SessionEnded;
                        }
                        on_binary(&app, &auth, &session, &window, &out, &bytes);
                    }
                    Message::Close(_) => break End::Other,
                    _ => {}
                }
            }
        }
    };
    let _ = sink.close().await;
    bridge::unregister(&app, &window, &label);
    eprintln!("[aynx] 원격 관문: 원격 창 닫힘 — {label} ({device})");
    super::activity::conn_closed(&device);
    let name = auth.lock().device_name(&device);
    super::activity::record(super::activity::Kind::Disconnected, &device, &name);
    super::gate::activity_changed(&app, &auth);
    windows::conn_closed(&app, end == End::SessionEnded);
}

fn on_text(app: &AppHandle, auth: &Auth, session: &[u8; 32], window: &WebviewWindow, out: &Outbox, text: &str) {
    let frame = match serde_json::from_str::<ClientFrame>(text) {
        Ok(f) => f,
        Err(_) => return, // 모르는 프레임은 버린다(답할 id 도 모른다)
    };
    match frame {
        ClientFrame::Invoke { id, cmd, args, headers, reauth } => {
            let caller = bridge::Caller {
                auth,
                session,
                reauth: reauth.as_deref(),
            };
            bridge::invoke(app, window, id, cmd, InvokeBody::Json(args), bridge::headers_from(&headers), out, &caller);
        }
        ClientFrame::Listen { id, event, target, handler } => match bridge::listen(app, window, &event, &target, handler) {
            Ok(eid) => out.text(frames::res_ok_json(id, &eid.to_string())),
            Err(e) => out.text(frames::res_err(id, &serde_json::Value::String(e))),
        },
        ClientFrame::Unlisten { id, event: _, event_id } => {
            bridge::unlisten(app, window.label(), event_id);
            out.text(frames::res_ok_json(id, "null"));
        }
        ClientFrame::Active => {
            auth.lock().touch_session(session, Instant::now());
        }
    }
}

fn on_binary(app: &AppHandle, auth: &Auth, session: &[u8; 32], window: &WebviewWindow, out: &Outbox, bytes: &[u8]) {
    if let Some(raw) = frames::parse_raw_invoke(bytes) {
        // 원시 본문 invoke 에는 재확인 표가 없다 — 재확인 명령은 이 길로 통하지 않는다.
        let caller = bridge::Caller {
            auth,
            session,
            reauth: None,
        };
        let headers = bridge::headers_from(&raw.headers);
        bridge::invoke(app, window, raw.id, raw.cmd, InvokeBody::Raw(raw.body), headers, out, &caller);
    }
}
