//! **메신저 다리의 WebSocket 전송 공용**(2026-11-19 · 4단계 — `dc` 에서 옮김). TCP + TLS(rustls · aws-lc-rs · 내장 공개 CA) + WebSocket 붙기와
//! 받은 것을 차례대로 코어에 넣는 일꾼 — Discord 게이트웨이(`dc`) · Slack Socket Mode(`sl`)가 함께 쓴다.
//!
//! - **주소를 고르지 않는다** — 어디에 붙을지(그 채널의 도메인인가)는 부르는 전송이 먼저 본다(`dc::resume_url` · `sl::socket_url_ok`). 여기는
//!   `wss` 와 루프백 `ws://127.0.0.1`(시험)만 받는다.
//! - **PTY · 카드 결정 · 승인으로 가는 길이 없다** — 일꾼은 코어의 입구(`on_message` · `on_press` · `send`)만 부른다(시험
//!   `pty_writes_have_two_sites` · `bridge_has_no_approval_path` 가 이 파일도 훑는다). 주소 · 받은 글은 로그에 싣지 않는다.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};

use super::{ButtonPress, Incoming, Text};
use crate::i18n::tr;
use crate::messenger::Channel;

/// 연결 시한(TCP · TLS · WebSocket 맞잡기 각각).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub(super) trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

pub(super) type Ws = tokio_tungstenite::WebSocketStream<Box<dyn Io>>;

/// TLS — rustls + aws-lc-rs(이 잠금의 공급자 · ring 없음) · 내장 공개 CA(webpki-roots — DB TLS 와 같은 기준).
fn tls() -> Option<Arc<rustls::ClientConfig>> {
    static TLS: OnceLock<Option<Arc<rustls::ClientConfig>>> = OnceLock::new();
    TLS.get_or_init(|| {
        let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
            .with_safe_default_protocol_versions()
            .ok()
            .map(|b| Arc::new(b.with_root_certificates(roots).with_no_client_auth()))
    })
    .clone()
}

/// 붙는다 — `wss`(TLS), 시험만 `ws://127.0.0.1`.
pub(super) async fn connect(url: &str) -> Option<Ws> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?.to_string();
    let secure = match u.scheme() {
        "wss" => true,
        "ws" if host == "127.0.0.1" => false,
        _ => return None,
    };
    let port = u.port_or_known_default()?;
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect((host.as_str(), port))).await.ok()?.ok()?;
    let io: Box<dyn Io> = if secure {
        let name = rustls::pki_types::ServerName::try_from(host).ok()?;
        let s = tokio::time::timeout(CONNECT_TIMEOUT, tokio_rustls::TlsConnector::from(tls()?).connect(name, tcp)).await.ok()?.ok()?;
        Box::new(s)
    } else {
        Box::new(tcp)
    };
    let (ws, _) = tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::client_async(url, io)).await.ok()?.ok()?;
    Some(ws)
}

/// 받기 고리가 일꾼에게 넘기는 것 — 차례대로 코어에 넣는다(받기 고리는 박동 · 받음 알림을 놓치지 않게 기다리지 않는다).
pub(super) enum Event {
    Message(Incoming),
    Press(ButtonPress),
}

/// 일꾼 — 받은 것을 차례대로 코어에. 지난 글은 줄이 빌 때 한 통으로 알린다(다시 붙은 뒤 놓친 사건이 한꺼번에 오는 때 — Telegram 의 묶음과 같은 자리).
pub(super) async fn worker(chan: Channel, gen: u64, mut rx: tokio::sync::mpsc::UnboundedReceiver<Event>) {
    let mut stale = 0usize;
    let mut last_chat = None;
    while let Some(ev) = rx.recv().await {
        let Some((_, cfg, _)) = super::hands(chan, Some(gen)) else { return };
        match ev {
            Event::Message(m) => {
                if let Some(chat) = super::on_message(chan, &cfg, m).await {
                    stale += 1;
                    last_chat = Some(chat);
                }
            }
            Event::Press(p) => super::on_press(chan, &cfg, p).await,
        }
        if let (n @ 1.., Some(chat), true) = (stale, last_chat, rx.is_empty()) {
            let text = tr!(
                ko: "서버가 꺼져 있던 동안 온 글 {n}개는 타일에 보내지 않았습니다 — 필요하면 다시 보내 주세요",
                en: "{n} message(s) that arrived while the server was off were not sent to any tile — send again if needed",
            );
            super::send(chan, chat, &Text::plain(text), None, &[], None).await;
            stale = 0;
        }
    }
}
