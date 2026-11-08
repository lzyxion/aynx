//! 세션 서버 프로세스 안의 **공용 손잡이 넷** — 이벤트 방송 · 신호 평면 포트 · 금고(③-3b2) · AI 평면(③-3c).
//!
//! SSH 평면(`crate::ssh` · `port_forward` · `headless` · `remote_worktree` …)은 예전에 GUI 의 `AppHandle` 로 이벤트를 쏘고
//! `tauri::State` 로 표를 보고 GUI 쪽 껍데기(`proxy::signal_issue` · `vault_proxy::credentials_transitional`)로 토큰·금고 값을
//! 받았다. 이제 그 코드는 **세션 서버 프로세스**에서 돈다 — 그래서 이 셋을 서버가 시작할 때(`serve::run`) 한 번 꽂고, SSH
//! 코드는 여기를 부른다.
//!
//! - [`emit`] — 이름 · 몸을 모든 GUI 연결의 이벤트로(`ssh-exit` · `host-history-changed` · `ssh-worktree-prep` · 원격 훅 안내 ·
//!   `headless-exit`). GUI `server::client::on_event` 가 같은 이름의 Tauri 이벤트로 중계한다. **몸에 비밀을 싣지 않는다**
//!   (토큰·비밀번호·암호구는 이 길을 타지 않는다 — 원격 신호 토큰은 서버 안에서 원격 서버의 파일로만 간다).
//! - [`signal_port`] — 신호 평면(`signal_http`)의 127.0.0.1 포트. 원격 `-R` 포워드의 이어 줄 곳.
//! - [`vault`] — 서버의 금고(`vault_ops::VaultPlane`). SSH 인증·헤드리스가 **같은 프로세스에서 직접** 읽는다 — 값이 파이프를
//!   타지 않는다(③-3b1 의 과도기 op `vault_credential_transitional` 은 지웠다).
//!
//! GUI 프로세스에서는 아무것도 꽂히지 않는다 — `emit` 은 조용히 버리고, `vault` 는 `None` 이다(GUI 코드가 이 길을 부를 일이
//! 없다). 시험은 한 프로세스에 서버를 여럿 띄우므로 매번 갈아 끼운다(마지막 것이 이긴다).

use std::sync::{Arc, RwLock};

use serde_json::Value;
use tokio::sync::broadcast;

use crate::vault::Vault;

#[derive(Default)]
struct Hub {
    events: Option<broadcast::Sender<(String, Value)>>,
    signal_port: Option<u16>,
    vault: Option<Arc<Vault>>,
    /// MCP 실행 브로커(`vault_ops::VaultPlane::broker` — 사이드 채팅이 외부 MCP 서버의 실행 모양을 같은 프로세스에서 준비한다).
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

/// 서버가 뜰 때 한 번(`serve::run`).
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

/// 모든 GUI 연결에 이벤트 하나 — 받는 연결이 없으면 버린다.
pub(crate) fn emit(name: &str, body: Value) {
    if let Some(tx) = read().events.as_ref() {
        let _ = tx.send((name.to_string(), body));
    }
}

/// 신호 평면 포트(못 띄웠거나 서버 밖이면 `None`).
pub(crate) fn signal_port() -> Option<u16> {
    read().signal_port
}

/// 서버의 금고(서버 밖이면 `None`).
pub(crate) fn vault() -> Option<Arc<Vault>> {
    read().vault.clone()
}

/// 서버의 MCP 실행 브로커(못 띄웠거나 서버 밖이면 `None`).
pub(crate) fn broker() -> Option<Arc<crate::mcp_launch::Broker>> {
    read().broker.clone()
}

/// AI 평면을 꽂는다(③-3c — `serve::run`). 세션 종료 마감(로컬·SSH)·헤드리스 종료 훅이 거울·라우팅·`agent-mcp` 장부를 직접 고친다.
pub(crate) fn install_ai(ai: Arc<super::ai::AiPlane>) {
    HUB.write().unwrap_or_else(|e| e.into_inner()).ai = Some(ai);
}

/// 서버의 AI 평면(서버 밖이면 `None`).
pub(crate) fn ai() -> Option<Arc<super::ai::AiPlane>> {
    read().ai.clone()
}
