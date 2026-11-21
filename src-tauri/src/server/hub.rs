//! 세션 서버 프로세스 안의 **공용 손잡이** — 이벤트 방송 · 신호 평면 포트 · 금고 · MCP 실행 브로커 · AI 평면.
//!
//! - [`emit`] 의 **몸에 비밀을 싣지 않는다** — 모든 GUI 연결로 방송된다(원격 신호 토큰은 서버 안에서 원격 서버의 파일로만 간다).
//! - [`vault`] 는 SSH 인증·헤드리스가 **같은 프로세스에서 직접** 읽는다 — 값이 파이프를 타지 않는다.
//! - GUI 프로세스에서는 아무것도 꽂히지 않는다(`emit` 은 조용히 버리고 나머지는 `None`). 시험은 한 프로세스에 서버를 여럿 띄우므로
//!   매번 갈아 끼운다(마지막 것이 이긴다).

use std::sync::{Arc, RwLock};

use serde_json::Value;
use tokio::sync::broadcast;

use crate::vault::Vault;

#[derive(Default)]
struct Hub {
    events: Option<broadcast::Sender<(String, Value)>>,
    signal_port: Option<u16>,
    vault: Option<Arc<Vault>>,
    broker: Option<Arc<crate::mcp_launch::Broker>>,
    ai: Option<Arc<super::ai::AiPlane>>,
}

static HUB: RwLock<Hub> = RwLock::new(Hub {
    events: None,
    signal_port: None,
    vault: None,
    broker: None,
    ai: None,
});

fn read() -> std::sync::RwLockReadGuard<'static, Hub> {
    HUB.read().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn install(
    events: broadcast::Sender<(String, Value)>,
    signal_port: Option<u16>,
    vault: Arc<Vault>,
    broker: Option<Arc<crate::mcp_launch::Broker>>,
) {
    let mut h = HUB.write().unwrap_or_else(|e| e.into_inner());
    h.events = Some(events);
    h.signal_port = signal_port;
    h.vault = Some(vault);
    h.broker = broker;
}

/// 받는 연결이 없으면 버린다.
pub(crate) fn emit(name: &str, body: Value) {
    if let Some(tx) = read().events.as_ref() {
        let _ = tx.send((name.to_string(), body));
    }
}

/// 이벤트 방송이 꽂혔으면 세션 서버다.
pub(crate) fn in_server() -> bool {
    read().events.is_some()
}

pub(crate) fn signal_port() -> Option<u16> {
    read().signal_port
}

pub(crate) fn vault() -> Option<Arc<Vault>> {
    read().vault.clone()
}

pub(crate) fn broker() -> Option<Arc<crate::mcp_launch::Broker>> {
    read().broker.clone()
}

pub(crate) fn install_ai(ai: Arc<super::ai::AiPlane>) {
    HUB.write().unwrap_or_else(|e| e.into_inner()).ai = Some(ai);
}

pub(crate) fn ai() -> Option<Arc<super::ai::AiPlane>> {
    read().ai.clone()
}
