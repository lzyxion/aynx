//! 에이전트 포워딩 (`ssh -A` · `ForwardAgent yes`) — docs/log/2026-09-23-agent-forwarding.md
//!
//! 서버 안의 프로그램(`git`·`ssh`)이 **이 PC 의 ssh-agent 에게 서명을 부탁**할 수 있게 한다.
//! 키는 이 PC 를 떠나지 않는다 — 오가는 것은 "이 데이터에 서명해 달라" 와 그 서명뿐이다.
//! 그래도 접속해 있는 동안은 그 서버의 관리자(root)도 같은 부탁을 할 수 있으므로
//! **호스트별 옵트인 · 기본 꺼짐**이고, 헤드리스 위임 접속에는 **아예 없다**.
//!
//! ```text
//!  서버의 git ─▶ $SSH_AUTH_SOCK(sshd 가 만든 소켓)
//!        ─▶ auth-agent@openssh.com 채널 (서버가 연다)
//!        ─▶ SshHandler::server_channel_open_agent_forward
//!        ─▶ accept(transport_id, …) — 장부에 이 전송로가 켜져 있을 때만
//!        ─▶ connect_local_agent() — 이 PC 의 에이전트 (OS 함수 하나)
//!        ─▶ copy_bidirectional
//! ```
//!
//! ## 전송로 단위다 (연결 공유)
//!
//! 채널을 여는 것은 서버이고 그 훅은 **전송로마다 하나**인 Handler 에 온다. 연결 공유 이후
//! 한 전송로는 여러 타일을 태우는데, 서버가 여는 에이전트 채널에는 "어느 셸 채널의 부탁인가"
//! 가 실려 오지 않는다. 그래서 허락은 **전송로 단위**다: 그 전송로 위에 포워딩을 켠 세션이
//! **하나라도** 살아 있으면 받는다. 같은 호스트의 옆 타일(포워딩을 요청하지 않은 셸)에서는
//! 서버가 `SSH_AUTH_SOCK` 을 만들어 주지 않으므로 보통 쓸 수 없지만, 같은 서버 사용자로
//! 도는 프로세스라면 켠 타일의 소켓을 찾아 쓸 수 있다 — 그것은 `ssh -A` 로 붙은 셸 하나를
//! 가진 OpenSSH 사용자와 같은 처지다. 마지막으로 켠 세션이 닫히면 **살아 있는 중계까지**
//! 그 자리에서 끊는다.
//!
//! ## 구조
//!
//! 장부([`Registry`])는 러시 타입이 없는 순수 자료구조라 소켓 없이 테스트가 붙는다.
//! 러시가 닿는 것은 [`accept`] 하나이고, OS 가 갈리는 것은 [`connect_local_agent`] 하나다.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use russh::client::{ChannelOpenHandle, Msg};
use russh::{Channel, ChannelOpenFailure};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::task::AbortHandle;

use crate::i18n::tr;

/// 셸 채널에 `want_reply` 로 보내는 요청의 순서 — `pty-req`(0) → `auth-agent-req`(1) →
/// `shell`/`exec`(2). 서버는 같은 채널의 요청에 **보낸 순서대로** 답한다(RFC 4254 §5.4)
/// 그래서 펌프가 받은 답 중 이 번째가 에이전트 요청의 답이다 ([`refused`]).
pub(crate) const REQUEST_INDEX: usize = 1;

/// 접속이 실제로 보는 값 — **순수 함수**. `sessions.toml` 의 호스트 덮어쓰기가 있으면 그것,
/// 없으면 `~/.ssh/config` 의 `ForwardAgent` (병합값).
pub(crate) fn effective(config: bool, meta: Option<bool>) -> bool {
    meta.unwrap_or(config)
}

/// 셸 채널이 받은 `n` 번째 답(`Success`/`Failure`)이 **에이전트 요청의 거절**인가 — 순수 함수.
/// 요청을 보내지 않았으면 언제나 거짓이다 (그때 1번째 답은 셸 요청의 것이다).
pub(crate) fn refused(requested: bool, reply_index: usize, failure: bool) -> bool {
    requested && failure && reply_index == REQUEST_INDEX
}

/// 서버가 에이전트 포워딩 요청을 거절했을 때 터미널에 뜨는 한 줄 (노랑 — 세션은 계속된다).
pub(crate) fn refused_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 에이전트 포워딩을 서버가 거부했습니다 (AllowAgentForwarding)\x1b[0m\r\n",
        en: "\x1b[33m⚠ The server refused agent forwarding (AllowAgentForwarding)\x1b[0m\r\n"
    )
}

// ---------------------------------------------------------------------------
// 장부 — 전송로 id → 포워딩을 켠 세션들 + 살아 있는 중계
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Entry {
    /// 이 전송로 위에서 포워딩을 켠 세션 id 들.
    sessions: HashSet<u32>,
    /// 이 전송로에서 받아들인 에이전트 채널의 중계 태스크들.
    relays: Vec<AbortHandle>,
    /// 로컬 에이전트에 닿지 못한 사실을 이미 로그에 적었다 (전송로당 한 번).
    warned: bool,
}

/// 순수 장부. 전역 하나([`REGISTRY`])로 쓰지만 테스트는 제 것을 만든다.
#[derive(Default)]
pub(crate) struct Registry {
    map: HashMap<u64, Entry>,
}

impl Registry {
    /// 세션 하나가 이 전송로에서 포워딩을 켰다.
    pub(crate) fn enable(&mut self, transport: u64, session: u32) {
        self.map
            .entry(transport)
            .or_default()
            .sessions
            .insert(session);
    }

    /// 세션 하나가 내려간다. **그 전송로에서 켠 마지막 세션이었으면** 항목을 지우고 살아 있던
    /// 중계를 돌려준다 — 부른 쪽이 끊는다. 모르는 세션이면 아무 일도 없다(빈 목록).
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

    /// **서버가 연 에이전트 채널을 받아도 되는가** — 이 전송로에 켠 세션이 하나라도 있을 때만.
    pub(crate) fn allows(&self, transport: u64) -> bool {
        self.map
            .get(&transport)
            .is_some_and(|e| !e.sessions.is_empty())
    }

    /// 중계 하나를 등록한다. 그 사이 마지막 세션이 내려갔으면 `false` — 부른 쪽이 끊는다.
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

    /// 로컬 에이전트 부재를 **처음** 보았는가 (로그를 전송로당 한 번만 남긴다).
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

/// 앱 전역 장부 — 전송로가 앱의 것이듯(`ssh::TRANSPORTS`) 이것도 앱의 것이다.
/// 잠금은 문장 하나 안에서 끝나고 `await` 를 넘지 않는다.
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Default::default);

/// 세션이 포워딩을 켠 채 이 전송로에 섰다 — 서버에 요청을 보내기 **전에** 부른다
/// (서버가 곧바로 채널을 열어도 장부가 이미 받을 준비가 되어 있게).
pub(crate) fn enable(transport: u64, session: u32) {
    REGISTRY.lock().unwrap().enable(transport, session);
}

/// 세션이 내려간다 — 켜지 않은 세션이어도 부르면 된다(아무 일도 없다). 마지막으로 켠 세션이면
/// 그 전송로의 살아 있는 에이전트 중계를 **전부** 끊는다.
pub(crate) fn disable(transport: u64, session: u32) {
    let relays = REGISTRY.lock().unwrap().disable(transport, session);
    for h in relays {
        h.abort();
    }
}

/// 서버가 에이전트 채널을 열었다 — [`crate::ssh::SshHandler`] 의 훅이 부른다.
///
/// **훅 안에서 기다리지 않는다** (원격 포워드의 `accept_remote` 와 같은 이유 — 전송로의 세션
/// 루프를 붙들면 옆 타일의 셸까지 멈춘다). 허락되지 않은 전송로면 `reply` 를 떨어뜨린다 —
/// 러시가 드롭에서 `AdministrativelyProhibited` 로 거절한다.
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

/// 채널 하나를 로컬 에이전트에 잇는다. 에이전트에 닿지 못하면 채널을 `ConnectFailed` 로
/// 거절한다 — 서버의 `ssh-add -l` 은 "에이전트와 통신 실패" 로 본다.
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

// ---------------------------------------------------------------------------
// 로컬 에이전트 — OS 가 갈리는 유일한 자리
// ---------------------------------------------------------------------------

/// 에이전트와 말하는 양방향 바이트 흐름 (OS 마다 타입이 다르다).
pub(crate) trait AgentIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AgentIo for T {}

pub(crate) type AgentStream = Box<dyn AgentIo>;

/// 이 PC 의 ssh-agent 에 새 연결 하나를 연다 — 에이전트 채널마다 하나씩.
/// 없으면 `None` (서비스가 꺼졌다 · 소켓이 없다).
///
/// Windows: OpenSSH 에이전트의 명명 파이프([`crate::ssh::AGENT_PIPE`]). 파이프의 모든 인스턴스가
/// 바쁘면(`ERROR_PIPE_BUSY`) 잠깐 기다렸다 다시 연다 — tokio 문서의 권장 모양이다.
#[cfg(windows)]
async fn connect_local_agent() -> Option<AgentStream> {
    use tokio::net::windows::named_pipe::ClientOptions;
    /// `ERROR_PIPE_BUSY`
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

/// Unix: `$SSH_AUTH_SOCK` 의 유닉스 소켓. 변수가 없으면 에이전트도 없는 것이다.
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
        // config yes · 덮어쓰기 없음 → 켬
        assert!(effective(true, None));
        // config yes · 호스트에서 끔 → 끔
        assert!(!effective(true, Some(false)));
        // 줄 없음(= false) · 덮어쓰기 없음 → 끔 (기본값)
        assert!(!effective(false, None));
        // 줄 없음 · 호스트에서 켬 → 켬
        assert!(effective(false, Some(true)));
    }

    #[test]
    fn only_the_second_reply_speaks_for_the_agent_request() {
        assert!(refused(true, REQUEST_INDEX, true));
        assert!(!refused(true, REQUEST_INDEX, false));
        // pty 의 거절·셸의 거절은 에이전트의 것이 아니다.
        assert!(!refused(true, 0, true));
        assert!(!refused(true, 2, true));
        // 요청하지 않았으면 두 번째 답은 셸의 것이다.
        assert!(!refused(false, REQUEST_INDEX, true));
    }

    #[test]
    fn a_transport_accepts_only_while_some_session_enabled_it() {
        let mut r = Registry::default();
        assert!(!r.allows(7), "아무도 켜지 않은 전송로는 거절한다");
        r.enable(7, 1);
        r.enable(7, 2);
        assert!(r.allows(7));
        // 다른 전송로(경유 홉 포함)는 제 장부를 따른다.
        assert!(!r.allows(8));
        // 하나가 내려가도 남은 세션이 있으면 그대로다.
        assert!(r.disable(7, 1).is_empty());
        assert!(r.allows(7));
        // 마지막이 내려가면 닫힌다.
        r.disable(7, 2);
        assert!(!r.allows(7));
        // 켜지 않은 세션·모르는 전송로의 내려가기는 무해하다.
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

    /// 마지막으로 켠 세션이 내려가면 **살아 있는 중계**가 끊긴다. 그 뒤에 도착한 등록은 거절된다.
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
