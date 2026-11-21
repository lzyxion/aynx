//! 에이전트 포워딩(`ssh -A`) — 서버 안의 프로그램이 이 PC 의 ssh-agent 에 서명을 부탁하게 한다. 키는 이 PC 를 떠나지 않는다 (docs/log/2026-09-23-agent-forwarding.md).
//! 접속해 있는 동안은 서버 관리자(root)도 같은 부탁을 할 수 있으므로 호스트별 옵트인 · 기본 꺼짐이고, 헤드리스 위임 접속에는 아예 없다(→ docs/invariants.md 전문 12).
//! 허락은 전송로 단위다 — 서버가 여는 에이전트 채널에는 어느 셸 채널의 부탁인지 실려 오지 않아, 그 전송로에 켠 세션이 하나라도 살아 있으면 받는다
//! (같은 서버 사용자의 다른 프로세스가 켠 타일의 소켓을 찾아 쓸 수 있는 것은 `ssh -A` 와 같은 한계다).
//! 마지막으로 켠 세션이 닫히면 살아 있는 중계까지 그 자리에서 끊는다.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use russh::client::{ChannelOpenHandle, Msg};
use russh::{Channel, ChannelOpenFailure};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::task::AbortHandle;

use crate::i18n::tr;

/// 셸 채널 요청 `pty-req`(0) → `auth-agent-req`(1) → `shell`/`exec`(2) 중 에이전트 요청의 자리 — 서버는 보낸 순서대로 답한다(RFC 4254 §5.4).
pub(crate) const REQUEST_INDEX: usize = 1;

pub(crate) fn effective(config: bool, meta: Option<bool>) -> bool {
    meta.unwrap_or(config)
}

pub(crate) fn refused(requested: bool, reply_index: usize, failure: bool) -> bool {
    requested && failure && reply_index == REQUEST_INDEX
}

pub(crate) fn refused_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 에이전트 포워딩을 서버가 거부했습니다 (AllowAgentForwarding)\x1b[0m\r\n",
        en: "\x1b[33m⚠ The server refused agent forwarding (AllowAgentForwarding)\x1b[0m\r\n"
    )
}

// ── 장부 ──

#[derive(Default)]
struct Entry {
    sessions: HashSet<u32>,
    relays: Vec<AbortHandle>,
    warned: bool,
}

#[derive(Default)]
pub(crate) struct Registry {
    map: HashMap<u64, Entry>,
}

impl Registry {
    pub(crate) fn enable(&mut self, transport: u64, session: u32) {
        self.map
            .entry(transport)
            .or_default()
            .sessions
            .insert(session);
    }

    /// 그 전송로에서 켠 마지막 세션이었으면 살아 있던 중계를 돌려준다 — 부른 쪽이 끊는다.
    pub(crate) fn disable(&mut self, transport: u64, session: u32) -> Vec<AbortHandle> {
        let Some(entry) = self.map.get_mut(&transport) else {
            return Vec::new();
        };
        entry.sessions.remove(&session);
        if !entry.sessions.is_empty() {
            return Vec::new();
        }
        self.map
            .remove(&transport)
            .map(|e| e.relays)
            .unwrap_or_default()
    }

    pub(crate) fn allows(&self, transport: u64) -> bool {
        self.map
            .get(&transport)
            .is_some_and(|e| !e.sessions.is_empty())
    }

    /// 그 사이 마지막 세션이 내려갔으면 `false` — 부른 쪽이 끊는다.
    fn register(&mut self, transport: u64, relay: AbortHandle) -> bool {
        match self.map.get_mut(&transport) {
            Some(e) if !e.sessions.is_empty() => {
                e.relays.retain(|h| !h.is_finished());
                e.relays.push(relay);
                true
            }
            _ => false,
        }
    }

    fn first_warning(&mut self, transport: u64) -> bool {
        match self.map.get_mut(&transport) {
            Some(e) if !e.warned => {
                e.warned = true;
                true
            }
            _ => false,
        }
    }
}

/// 잠금은 문장 하나 안에서 끝나고 `await` 를 넘지 않는다.
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Default::default);

/// 서버에 요청을 보내기 전에 부른다 — 서버가 곧바로 채널을 열어도 장부가 받을 준비가 되어 있게.
pub(crate) fn enable(transport: u64, session: u32) {
    REGISTRY.lock().unwrap().enable(transport, session);
}

pub(crate) fn disable(transport: u64, session: u32) {
    let relays = REGISTRY.lock().unwrap().disable(transport, session);
    for h in relays {
        h.abort();
    }
}

/// 훅 안에서 기다리지 않는다 — 전송로의 세션 루프를 붙들면 옆 타일의 셸까지 멈춘다. 허락되지 않은 전송로면 `reply` 를 떨어뜨려 거절한다.
pub(crate) fn accept(transport: u64, channel: Channel<Msg>, reply: ChannelOpenHandle) {
    if !REGISTRY.lock().unwrap().allows(transport) {
        drop(reply);
        return;
    }
    let task = tokio::spawn(relay(transport, channel, reply));
    if !REGISTRY
        .lock()
        .unwrap()
        .register(transport, task.abort_handle())
    {
        task.abort();
    }
}

async fn relay(transport: u64, channel: Channel<Msg>, reply: ChannelOpenHandle) {
    let Some(mut agent) = connect_local_agent().await else {
        if REGISTRY.lock().unwrap().first_warning(transport) {
            eprintln!("에이전트 포워딩: 이 PC 의 ssh-agent 에 닿지 못해 서버의 요청을 거절합니다");
        }
        reply.reject(ChannelOpenFailure::ConnectFailed).await;
        return;
    };
    reply.accept().await;
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut agent).await;
}

// ── 로컬 에이전트 — OS 가 갈리는 유일한 자리 ──

pub(crate) trait AgentIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AgentIo for T {}

pub(crate) type AgentStream = Box<dyn AgentIo>;

/// Windows: 파이프 인스턴스가 모두 바쁘면(`ERROR_PIPE_BUSY`) 잠깐 기다렸다 다시 연다 — tokio 문서의 권장 모양.
#[cfg(windows)]
async fn connect_local_agent() -> Option<AgentStream> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const PIPE_BUSY: i32 = 231;
    for _ in 0..10 {
        match ClientOptions::new().open(crate::ssh::AGENT_PIPE) {
            Ok(pipe) => return Some(Box::new(pipe)),
            Err(e) if e.raw_os_error() == Some(PIPE_BUSY) => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(_) => return None,
        }
    }
    None
}

#[cfg(unix)]
async fn connect_local_agent() -> Option<AgentStream> {
    let path = std::env::var_os("SSH_AUTH_SOCK")?;
    let sock = tokio::net::UnixStream::connect(path).await.ok()?;
    Some(Box::new(sock))
}

/// 아직 구현하지 않은 OS — 명시적 `None` (서버의 요청은 거절된다).
#[cfg(not(any(windows, unix)))]
async fn connect_local_agent() -> Option<AgentStream> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_override_wins_over_the_config_line() {
        assert!(effective(true, None));
        assert!(!effective(true, Some(false)));
        assert!(!effective(false, None));
        assert!(effective(false, Some(true)));
    }

    #[test]
    fn only_the_second_reply_speaks_for_the_agent_request() {
        assert!(refused(true, REQUEST_INDEX, true));
        assert!(!refused(true, REQUEST_INDEX, false));
        assert!(!refused(true, 0, true));
        assert!(!refused(true, 2, true));
        assert!(!refused(false, REQUEST_INDEX, true));
    }

    #[test]
    fn a_transport_accepts_only_while_some_session_enabled_it() {
        let mut r = Registry::default();
        assert!(!r.allows(7), "아무도 켜지 않은 전송로는 거절한다");
        r.enable(7, 1);
        r.enable(7, 2);
        assert!(r.allows(7));
        assert!(!r.allows(8));
        assert!(r.disable(7, 1).is_empty());
        assert!(r.allows(7));
        r.disable(7, 2);
        assert!(!r.allows(7));
        assert!(r.disable(7, 99).is_empty());
        assert!(r.disable(42, 1).is_empty());
    }

    #[test]
    fn the_missing_agent_is_logged_once_per_transport() {
        let mut r = Registry::default();
        assert!(!r.first_warning(3), "켜지 않은 전송로는 로그도 없다");
        r.enable(3, 1);
        assert!(r.first_warning(3));
        assert!(!r.first_warning(3));
    }

    #[tokio::test]
    async fn the_last_session_leaving_aborts_live_relays() {
        let mut r = Registry::default();
        r.enable(5, 1);
        r.enable(5, 2);
        let live = tokio::spawn(std::future::pending::<()>());
        assert!(r.register(5, live.abort_handle()));
        assert!(
            r.disable(5, 1).is_empty(),
            "켠 세션이 남아 있으면 중계도 산다"
        );
        let relays = r.disable(5, 2);
        assert_eq!(relays.len(), 1);
        for h in relays {
            h.abort();
        }
        assert!(live.await.unwrap_err().is_cancelled());

        let late = tokio::spawn(std::future::pending::<()>());
        assert!(!r.register(5, late.abort_handle()));
        late.abort();
    }
}
