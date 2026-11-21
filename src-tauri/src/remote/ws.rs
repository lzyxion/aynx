//! 원격 창의 **WebSocket** — `GET /remote/ws?t=<부팅 표>` 업그레이드 + 연결 하나의 고리.
//!
//! 받는 조건(전부): 문지기(Host·Origin)를 지났고 **`Origin` 이 반드시 있다** · 쿠키가 **열림**(기기 + 살아 있는 세션) ·
//! 부팅 표가 그 기기·그 세션의 것(1회용) · 연결 상한 안.
//!
//! - 업그레이드 뒤의 연결은 관문의 HTTP 연결 수명 밖이라 **세션이 끝나면 여기서 곧바로 닫는다**(받는 메시지마다도 세션을 다시 본다).
//! - 원격 세션의 **무입력 시계는 사람 입력(`{t:"active"}`)만** 되감는다 — IPC 폴링으로 되감지 않는다.
//! - 같은 페이지가 새 연결에 다시 붙지 않는다(라벨 = 페이지 수명) — 끊기면 페이지가 다시 읽는다.

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

/// 파일 저장(원시 본문 invoke)도 이 안이어야 한다 — 프런트 `REMOTE_RAW_MAX_BYTES` 가 이 값보다 작다(시험 `ipc.test.ts` 가 이 줄의 글자를 읽는다).
pub(crate) const MAX_MESSAGE: usize = 16 * 1024 * 1024;
const PING_EVERY: Duration = Duration::from_secs(20);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const SESSION_CHECK: Duration = Duration::from_secs(5);
pub(crate) const MAX_PER_DEVICE: usize = 4;
pub(crate) const MAX_TOTAL: usize = 12;

static SESSIONS: Notify = Notify::const_new();

pub(crate) fn sessions_changed() {
    SESSIONS.notify_waiters();
}

static PER_DEVICE: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Mutex::default);
static TOTAL: AtomicUsize = AtomicUsize::new(0);

/// 떨어지면 자리를 돌려준다.
pub(crate) struct Slot {
    device: String,
}

impl Slot {
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

/// RFC 6455 4.2.2.
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

pub(crate) struct Conn {
    pub app: AppHandle,
    pub auth: Arc<Auth>,
    pub device: String,
    pub session: [u8; 32],
    pub label: String,
    pub gen: u64,
    pub slot: Slot,
}

/// 세션이 끝나서 닫혔는가가 볼트 셈의 유예를 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum End {
    SessionEnded,
    Other,
}

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
