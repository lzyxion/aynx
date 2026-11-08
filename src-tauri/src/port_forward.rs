//! 포트 포워딩 — **로컬(`ssh -L`) · 원격(`ssh -R`) · 동적(`ssh -D`, SOCKS5)**.
//!
//! 셋 다 **이미 열려 있는 SSH 세션** 위에 선다. 갈리는 것은 "누가 듣고, 누가 어디로 잇는가" 다.
//!
//! | 종류 | 듣는 곳 | 이어 주는 곳 | 필드의 뜻 |
//! | --- | --- | --- | --- |
//! | `local` (-L) | 내 PC `127.0.0.1:local_port` | 서버에서 본 `remote_host:remote_port` | 셋 다 쓴다 |
//! | `remote` (-R) | **서버** `127.0.0.1:remote_port` | 내 PC `127.0.0.1:local_port` | `remote_host` 는 안 쓴다(빈 값) |
//! | `dynamic` (-D) | 내 PC `127.0.0.1:local_port` (SOCKS5) | 요청마다 클라이언트가 고른 목적지 | `remote_host`·`remote_port` 는 안 쓴다 |
//!
//! ```text
//!  로컬 (-L)
//!  DBeaver ──► 127.0.0.1:15432 (TcpListener, 루프백 전용)
//!                  │  accept 루프 태스크 (포워드 하나당 하나)
//!                  ▼
//!            연결마다 새 태스크
//!                  │  handle.channel_open_direct_tcpip(remote_host, remote_port, peer_ip, peer_port)
//!                  ▼
//!            tokio::io::copy_bidirectional(소켓 ↔ 채널 스트림)
//!                  ▼
//!            원격 서버의 localhost:5432
//!
//!  동적 (-D) — 위와 같은 accept 루프, 연결마다 한 걸음이 더 있다
//!  curl --socks5-hostname ──► 127.0.0.1:1080
//!                  │  socks5::handshake (10초 안에) → 목적지 host:port
//!                  │  handle.channel_open_direct_tcpip(host, port, …)   ← 이름은 서버가 푼다
//!                  │  05 00 … 응답
//!                  ▼
//!            copy_bidirectional
//!
//!  원격 (-R) — 내 PC 에는 리스너가 없다. 서버가 듣고, 우리는 채널을 받는다
//!  add 시점:  handle.tcpip_forward("127.0.0.1", remote_port)      (서버의 루프백에 바인드)
//!  서버의 curl 127.0.0.1:18080
//!                  │  sshd 가 forwarded-tcpip 채널을 연다
//!                  ▼
//!            SshHandler::server_channel_open_forwarded_tcpip  (ssh.rs — 전송로마다 하나)
//!                  │  accept_remote(transport_id, connected_port, …)
//!                  │  REMOTE_ROUTES[(transport_id, port)] → local_port
//!                  │  TcpStream::connect(127.0.0.1:local_port) → reply.accept()
//!                  ▼
//!            copy_bidirectional → 내 PC 의 127.0.0.1:18080
//! ```
//!
//! ## 왜 127.0.0.1 전용인가 — **양쪽 끝 모두**
//!
//! `0.0.0.0` 에 바인드하면 같은 네트워크의 **누구나** 이 터널을 쓸 수 있다 — SSH 인증을
//! 한 번도 거치지 않은 채 사내 DB 에 붙는 문이 열리는 셈이다. 포워드를 건 사람만 쓰라고
//! 만든 통로이므로 리스너는 루프백에만 선다 (OpenSSH 도 기본값이 `GatewayPorts no` 로
//! 같은 선택을 한다). 외부 노출이 필요하면 그때 `GatewayPorts` 에 해당하는 **명시적**
//! 옵션으로 열어야 하며, 기본값이 되어서는 안 된다.
//!
//! **원격(-R)도 같은 규칙을 서버 쪽에 적용한다** — 바인드 주소는 언제나 `"127.0.0.1"` 이다.
//! 서버의 `0.0.0.0` 에 서면 그 서버가 속한 망의 누구나 **내 PC 의 포트**에 닿는다 — 로컬
//! 규칙이 막으려던 문이 방향만 바뀐 것이다. 그래서 v1 에는 `GatewayPorts` 에 해당하는 칸이
//! 없다(주소를 고르는 입력 자체가 없다). 필요해지면 로컬과 함께 **명시적 옵트인** 한 칸으로
//! 연다 — 기본값이 되지 않는다. 이어 주는 쪽(내 PC)도 `127.0.0.1:local_port` 뿐이다: 원격
//! 포워드가 내 PC 가 속한 망의 다른 기계로 가는 발판이 되지 않게 한다.
//!
//! ## 원격(-R)의 길잡이 — **전송로 id × 포트**
//!
//! 서버가 여는 forwarded-tcpip 채널은 세션이 아니라 **전송로**(러시 `Handle` 하나 =
//! `SshHandler` 하나)에 도착한다. 연결 공유(docs/log/2026-09-23-ssh-connection-sharing.md)
//! 이후 한 전송로는 여러 세션을 태우므로, 채널을 받은 Handler 는 "이게 어느 포워드의
//! 것인가" 를 세션 id 로 알 수 없다. 그래서 전송로마다 번호(`transport_id`, 세울 때 한 번
//! 뽑는다)를 두고, 전역 표 [`REMOTE_ROUTES`] 가 `(transport_id, 서버 포트)` → 포워드를 잇는다.
//! 같은 전송로의 두 세션이 같은 서버 포트를 달라고 하면 둘째는 **거절된다** — 여기서 먼저
//! 막고(표에 이미 있다), 막지 못했더라도 서버가 두 번째 바인드를 거절한다.
//!
//! ## 중지 규칙
//!
//! **[중지] = 새 연결 거부 + 중계 중인 연결도 그 자리에서 끊는다** (사용자 결정 2026-09-17:
//! 목록에서 지우면 끊겨야 한다). 그래서 accept 루프뿐 아니라 연결마다 띄운 중계 태스크의
//! 핸들도 [`Relays`] 에 모아 둔다 — 자세한 것은 그 타입과 [`Forward::stop`] 주석.
//! 원격(-R)은 여기에 둘이 더 붙는다: 길잡이 표에서 빼고(새 채널은 거절된다), 서버에
//! `cancel-tcpip-forward` 를 보낸다(최선 노력 — 전송로가 이미 죽었으면 할 일도 없다).
//!
//! ## 세션 수명 규칙
//!
//! 포워드는 **세션에 매달려 있다**. 세션이 닫히면([`crate::ssh::close_ssh`]) 그 세션의
//! 포워드는 전부 함께 멈춘다 — 죽은 세션 위에 남은 리스너는 연결을 받아 놓고 곧바로
//! 끊기만 하는 함정이기 때문이다. `ssh-exit` 로 원격이 먼저 끝난 경우도 같은 지점을 탄다:
//! 종료 마감(`crate::ssh::session::finish_exit` → `release_ssh`)이 붙은 창이 있든 없든(페이지 리로드로 떨어진
//! 세션) Rust 에서 같은 회수를 부르므로 정리 경로가 하나로 모인다(프런트의 `close_ssh` 는 그 뒤에 와도 멱등).
//! 페이지 리로드는 세션을 떨어뜨리기만 하므로 포워드는 그대로 산다(세션 코어 ②-2). 원격(-R)도 같은 길([`stop_session_forwards`])을
//! 지난다 — 공유 전송로가 옆 타일 때문에 살아남아도 이 세션의 서버 바인드는 거둔다.
//!
//! ## 앱이 거는 원격 포워드 — **에이전트 신호** (docs/log/2026-09-24-remote-agent-signals.md)
//!
//! 원격 AI 타일의 Claude Code 훅이 이 PC 의 `/agent-signal` 에 닿게 하는 `-R` 하나를 **앱이** 건다
//! ([`ensure_agent_signal_forward`]): 서버 `127.0.0.1:0`(서버가 포트를 고른다) → 내 PC
//! `127.0.0.1:<세션 서버의 신호 포트>`(③-3a — 예전에는 MCP 포트). 사람이 건 포워드와 같은 기계(길잡이 표 · 중계 · 목록)를 타되 셋이 다르다:
//!
//! - **전송로당 하나**를 그 호스트의 에이전트 타일 전부가 나눠 쓴다 — 주인은 세션 하나가 아니라
//!   쓰는 세션들의 집합(`app_users`)이고, 마지막 세션이 닫힐 때([`stop_session_forwards`]) 거둔다.
//!   전송로가 죽으면 그 위의 세션이 전부 `close_ssh` 를 지나므로 같은 길로 거둬진다.
//! - 목록에는 `purpose: "agent-signal"` 로 나가 화면이 "에이전트 신호 (앱)" 으로 그린다.
//! - **사람이 [중지] 할 수 없다**([`remove_forward`] 가 거절한다). 지우고 다음 열기에 다시 세우는
//!   쪽도 생각했지만, 이미 떠 있는 원격 에이전트는 옛 포트를 환경에 쥐고 있어 다시 세운 포트로는
//!   닿지 않는다 — 지우는 순간 그 타일들의 신호가 조용히 끊긴다. 거절이 더 단순하고 더 정직하다.
//!
//! 자동 재연결은 **새 세션 id** 를 만든다. 옛 세션은 위 경로로 정리되므로 그 위의
//! 포워드도 함께 사라진다. 손으로 건 포워드는 그대로 끝이고, **호스트에 저장해 둔
//! 프리셋**(`sessions_meta::ForwardPreset`)만 새 세션 위에 다시 선다 — 프런트가 세션 id 가
//! 붙는 자리에서 이 모듈의 [`add_forward`] 를 다시 부른다
//! (docs/log/2026-09-17-forward-presets.md). **이 모듈은 그 사실을 모른다**: 여기는 여전히
//! "세션 하나에 포워드 여럿" 만 알고, 무엇을 언제 다시 걸지는 전적으로 프런트의 일이다.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use russh::client::{ChannelOpenHandle, Msg};
use russh::{Channel, ChannelOpenFailure};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::AbortHandle;

use crate::i18n::tr;
use crate::socks5;
use crate::ssh::SessionHandle;

/// 포워드의 종류. 파일(`sessions.toml` 프리셋)과 IPC 에 **소문자**로 오간다.
///
/// 기본값이 `Local` 인 이유는 하위 호환이다 — 이 칸이 생기기 전에 저장된 프리셋과, 이 칸을
/// 모르는 호출은 전부 로컬 포워드였다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardKind {
    #[default]
    Local,
    Remote,
    Dynamic,
}

/// 프런트가 목록에 그리는 포워드 하나.
///
/// ```json
/// { "id": 1, "session_id": 3, "kind": "local", "local_port": 15432,
///   "remote_host": "localhost", "remote_port": 5432, "conns": 2, "active_conns": 1 }
/// ```
///
/// 쓰지 않는 칸은 비어 있다 — 원격은 `remote_host: ""`, 동적은 거기에 `remote_port: 0` 까지.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ForwardInfo {
    pub id: u32,
    pub session_id: u32,
    pub kind: ForwardKind,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    /// 지금까지 중계한 연결 수 (누적, 진단용)
    pub conns: u64,
    /// **지금 열려 있는** 중계 연결 수.
    ///
    /// 누적값만으로는 "아까 한 번 붙었다" 와 "지금 붙어 있다" 를 구분할 수 없다는
    /// 실기 피드백에서 나온 값이다 — 프런트는 이 값이 0 보다 크면 초록 점을 켠다.
    pub active_conns: u64,
    /// **앱이 건 포워드**면 그 까닭 — 지금은 `"agent-signal"` 하나(모듈 머리말). 사람이 건 것이면
    /// 칸 자체가 없다(예전 모양 그대로).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<ForwardPurpose>,
}

/// 앱이 스스로 거는 포워드의 까닭 — IPC 에 kebab-case 로 나간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ForwardPurpose {
    /// 원격 AI 타일의 훅 신호 → 이 PC 의 `/agent-signal` (모듈 머리말의 "앱이 거는 원격 포워드").
    AgentSignal,
}

/// 중계 태스크 등록부 — **[중지] 가 중계 중인 연결까지 끊을 수 있게** 하는 유일한 장치.
///
/// accept 루프가 연결마다 태스크를 띄우고 그 `AbortHandle` 을 여기 넣는다. 중지는
/// [`Relays::stop`] 하나로 전부 끊는다 (사용자 결정 2026-09-17 —
/// docs/log/2026-09-01-port-forward.md §9). 원격(-R)은 accept 루프 대신
/// [`accept_remote`] 가 같은 자리에 넣는다.
///
/// **왜 `Vec<AbortHandle>` 인가** — `JoinSet` 도 같은 일을 하지만(`abort_all`),
/// 이 모듈은 accept 루프를 이미 `AbortHandle` 하나로 끊고 있다. 같은 도구를 한 번 더
/// 쓰는 쪽이 읽을 거리가 적고, 스폰 시점에 런타임 문맥을 따질 일도 없다. 끝난 핸들은
/// accept 때마다 `retain` 으로 털어 내므로(`is_finished` 는 잠금이 없다) 목록은 **지금
/// 살아 있는 연결 수 + 방금 끝난 몇 개** 이상으로 자라지 않는다.
///
/// **왜 `stopped` 플래그가 필요한가** — abort 는 태스크가 **다음 await 에 닿을 때** 듣는다.
/// 그래서 accept 루프가 `accept().await` 에서 막 깨어난 참이면, 중지가 목록을 비운 **뒤에도**
/// 그 한 연결을 마저 띄워 등록할 수 있다 (등록과 스폰 사이에 await 가 없으므로 루프는
/// 거기까지 달린다). 그 한 개가 영영 살아남는 것을 막으려고, 중지 뒤에 들어오는 등록은
/// 그 자리에서 abort 한다. (원격의 길잡이 표 조회와 등록 사이도 같은 틈이다 — 같은 플래그가 막는다.)
#[derive(Default)]
struct Relays {
    handles: Vec<AbortHandle>,
    stopped: bool,
}

impl Relays {
    /// 중계 태스크를 띄운 직후 부른다. 끝난 핸들은 이때 함께 털어 낸다.
    fn register(&mut self, handle: AbortHandle) {
        if self.stopped {
            handle.abort();
            return;
        }
        self.handles.retain(|h| !h.is_finished());
        self.handles.push(handle);
    }

    /// 등록된 중계를 **전부** 끊는다. 이후 등록은 즉시 끊긴다 (타입 주석 참고).
    fn stop(&mut self) {
        self.stopped = true;
        for h in self.handles.drain(..) {
            h.abort();
        }
    }
}

/// 원격(-R) 포워드가 서버에 건 바인드 — 거둘 때 필요한 둘.
struct RemoteBind {
    /// 길잡이 표([`REMOTE_ROUTES`])의 열쇠 절반.
    transport_id: u64,
    /// `cancel-tcpip-forward` 를 보낼 전송로.
    handle: SessionHandle,
}

/// 살아 있는 포워드 하나. [`Forward::stop`] 이 accept 루프와 **중계 중인 연결 전부**를
/// 끊는다 — 리스너만 닫고 연결을 남기던 옛 규칙은 2026-09-17 에 뒤집혔다.
struct Forward {
    session_id: u32,
    kind: ForwardKind,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    /// accept 루프가 올리는 누적 카운터. 목록 표시 전용이라 `Relaxed` 로 충분하다.
    conns: Arc<AtomicU64>,
    /// 지금 중계 중인 연결 수. [`ActiveGuard`] 가 오르내린다 (같은 이유로 `Relaxed`).
    active: Arc<AtomicU64>,
    /// accept 루프 태스크. **원격(-R)에는 없다** — 내 PC 에 리스너가 서지 않는다.
    abort: Option<AbortHandle>,
    /// 중계 태스크들. accept 루프(원격은 [`accept_remote`])와 공유한다 (넣는 쪽 · 비우는 쪽).
    relays: Arc<Mutex<Relays>>,
    /// 원격(-R)만: 서버에 건 바인드.
    remote: Option<RemoteBind>,
    /// 앱이 건 포워드면 그 까닭 — 있으면 주인은 `session_id` 가 아니라 [`Self::app_users`] 다.
    purpose: Option<ForwardPurpose>,
    /// 앱이 건 포워드를 **쓰는** 세션들 — 마지막이 닫힐 때 거둔다([`stop_session_forwards`]).
    app_users: std::collections::HashSet<u32>,
}

impl Forward {
    /// 이 세션의 포워드인가 — 사람이 건 것은 건 세션, 앱이 건 것은 쓰는 세션 전부.
    fn used_by(&self, session_id: u32) -> bool {
        match self.purpose {
            Some(_) => self.app_users.contains(&session_id),
            None => self.session_id == session_id,
        }
    }

    fn info(&self, id: u32) -> ForwardInfo {
        ForwardInfo {
            id,
            session_id: self.session_id,
            kind: self.kind,
            local_port: self.local_port,
            remote_host: self.remote_host.clone(),
            remote_port: self.remote_port,
            conns: self.conns.load(Ordering::Relaxed),
            active_conns: self.active.load(Ordering::Relaxed),
            purpose: self.purpose,
        }
    }

    /// 이 포워드를 통째로 끊는다 — **새 연결도, 중계 중인 연결도**.
    ///
    /// 순서가 중요하다: 새 연결이 들어오는 문(accept 루프 · 원격의 길잡이 표)을 먼저 닫은
    /// 뒤에 중계를 끊는다. 반대로 하면 그 사이에 받은 연결이 살아남는다.
    ///
    /// 중계 태스크를 abort 하면 그 태스크의 future 가 통째로 드롭되고, 태스크가 쥐고 있던
    /// **로컬 `TcpStream` 과 SSH 채널 스트림이 함께 드롭된다** — 로컬 소켓은 닫히고
    /// (클라이언트는 EOF 를 본다), russh 의 `ChannelStream` 은 내부
    /// `ChannelCloseOnDrop` 이 드롭되며 원격에 `ChannelMsg::Close` 를 보낸다. 그래서
    /// 협조적 취소(`Notify`/토큰)를 따로 깔지 않아도 양방향이 닫힌다.
    ///
    /// `active_conns` 도 같은 드롭에서 [`ActiveGuard`] 가 내린다 — 런타임이 태스크를
    /// 실제로 버리는 순간이라 **abort 직후가 아니라 한 틱 뒤**에 0 이 된다.
    ///
    /// 원격(-R)의 `cancel-tcpip-forward` 는 **기다리지 않는다**(태스크로 던진다) — 이 함수는
    /// 세션 표 잠금 근처(`close_ssh`)에서 동기로 불리고, 서버의 답은 정리의 성패를 바꾸지
    /// 않는다(전송로가 죽었으면 바인드도 이미 없다). 매달리지 않도록 시간 제한을 건다.
    fn stop(&self, id: u32) {
        if let Some(abort) = &self.abort {
            abort.abort();
        }
        if let Some(bind) = &self.remote {
            unroute_remote(bind.transport_id, self.remote_port, id);
            let handle = Arc::clone(&bind.handle);
            let port = u32::from(self.remote_port);
            tokio::spawn(async move {
                let _ = tokio::time::timeout(
                    REMOTE_REQUEST_TIMEOUT,
                    handle.cancel_tcpip_forward(REMOTE_BIND_ADDR, port),
                )
                .await;
            });
        }
        self.relays.lock().unwrap().stop();
    }
}

/// 살아 있는 중계 연결 하나를 세는 가드. 만들 때 +1, 떨어질 때 -1.
///
/// 왜 가드인가 — 중계 태스크는 `copy_bidirectional` 이 성공으로 끝날 수도, 오류로 끝날
/// 수도, 도중의 `?`/조기 return 으로 빠질 수도 있고, 포워드가 중지되면 태스크가 통째로
/// **취소**되기도 한다. 감소를 코드 경로마다 손으로 적으면 그중 하나만 빠져도 카운터가
/// 영원히 0 으로 돌아오지 않는다 (= 아무도 안 붙었는데 초록불). `Drop` 은 취소를 포함한
/// 모든 종료 경로에서 반드시 돈다.
struct ActiveGuard(Arc<AtomicU64>);

impl ActiveGuard {
    fn new(active: Arc<AtomicU64>) -> Self {
        active.fetch_add(1, Ordering::Relaxed);
        Self(active)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// id → 포워드. Tauri 관리 상태가 아니라 전역인 이유는 [`stop_session_forwards`] 때문이다 —
/// `close_ssh` 는 `SshSessions` 상태만 들고 있고, 거기에 포워드 상태까지 끌어들이면
/// 두 모듈이 서로의 상태 타입을 알아야 한다.
static FORWARDS: LazyLock<Mutex<HashMap<u32, Forward>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// accept 가 실패한 뒤 다시 시도하기까지의 간격.
///
/// accept 오류는 대부분 일시적이다 (핸들 고갈·연결이 완료 전에 끊김). 그래서 루프를
/// 끝내지 않고 계속 도는데, 곧바로 재시도하면 오류가 계속되는 동안 CPU 를 태운다.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);

/// SOCKS5 핸드셰이크(인사 + 요청)에 주는 시간. 붙어 놓고 아무 말도 안 하는 연결이 태스크를
/// 영원히 붙들지 않게 한다 — 정상 클라이언트는 밀리초 안에 끝낸다.
const SOCKS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// 원격(-R)의 서버 요청(`tcpip-forward` · `cancel-tcpip-forward`)을 기다리는 한도.
/// 답이 없는 서버에 [추가] 버튼이 영원히 "거는 중…" 으로 매달리지 않게 한다.
const REMOTE_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// 원격(-R)의 채널을 받아 내 PC 의 `127.0.0.1:local_port` 로 잇는 TCP 연결의 한도.
/// 루프백이라 대개 즉시 성공하거나 즉시 거절된다 — 이 값은 방화벽이 패킷을 삼키는 경우용이다.
const LOCAL_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// 원격(-R)의 서버 쪽 바인드 주소 — **언제나 루프백**이다 (모듈 머리말의 "양쪽 끝 모두").
const REMOTE_BIND_ADDR: &str = "127.0.0.1";

// ---------------------------------------------------------------------------
// 검증 (순수 함수)
// ---------------------------------------------------------------------------

/// 입력을 검사하고 **다듬은 `(원격 호스트, 원격 포트)`** 를 돌려준다 — **순수 함수** (유닛 테스트 대상).
///
/// 종류마다 쓰는 칸이 다르다 (모듈 머리말의 표). 쓰지 않는 칸은 **검사하지 않고 비운다** —
/// 원격은 호스트를 `""` 로, 동적은 거기에 포트까지 `0` 으로. 화면이 감춘 칸에 남은 옛 값이
/// 파일에 적히거나 목록에 비치지 않게 하려는 것이다.
///
/// 포트 0 은 타입상 `u16` 에 들어오지만 "아무 포트나" 라는 뜻이라 여기서 막는다 —
/// 로컬 포트가 0 이면 OS 가 임의 포트를 잡아 사용자가 어디로 접속해야 할지 알 수 없고,
/// 원격 포트가 0 이면 서버가 채널 열기를 거절한다. 원격(-R)의 서버 포트 0 은 "서버가 골라
/// 달라" 는 뜻이 되는데, 그 번호를 사용자에게 돌려줄 자리가 없으므로 역시 막는다.
///
/// **호스트별 포워딩 프리셋**(`sessions_meta::ForwardPreset`)도 이 함수를 그대로 쓴다 —
/// 저장 시점(폼)과 실행 시점(접속 후 자동 열기)의 규칙이 갈리면, 파일에는 적혔는데 열리지
/// 않는 줄이 생긴다 (docs/log/2026-09-17-forward-presets.md).
pub(crate) fn validate(
    kind: ForwardKind,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
) -> Result<(String, u16), String> {
    if local_port == 0 {
        return Err(tr!(
            ko: "로컬 포트는 1–65535 사이여야 합니다",
            en: "The local port must be between 1 and 65535"
        ));
    }
    if kind == ForwardKind::Dynamic {
        return Ok((String::new(), 0));
    }
    if kind == ForwardKind::Remote {
        if remote_port == 0 {
            return Err(remote_port_error());
        }
        return Ok((String::new(), remote_port));
    }
    validate_target(remote_host, remote_port)
}

fn remote_port_error() -> String {
    tr!(
        ko: "원격 포트는 1–65535 사이여야 합니다",
        en: "The remote port must be between 1 and 65535"
    )
}

/// 서버에서 본 목적지 `host:port` 를 검사하고 다듬는다 — 로컬(-L) 포워드와 [`TunnelListener`] 가 같은 규칙을 쓴다.
fn validate_target(remote_host: &str, remote_port: u16) -> Result<(String, u16), String> {
    if remote_port == 0 {
        return Err(remote_port_error());
    }
    let host = remote_host.trim();
    if host.is_empty() {
        return Err(tr!(
            ko: "원격 호스트를 입력하세요 (예: localhost)",
            en: "Enter a remote host (for example localhost)"
        ));
    }
    // 가운데 공백은 앞뒤 공백과 달리 **다듬어 줄 수 없다** — `db 01` 은 어느 쪽으로 고쳐도
    // 사용자가 뜻한 이름이 아니다. 조용히 넘기면 `channel_open_direct_tcpip` 이 열리지 않는
    // 포워드가 서고, 프리셋이면 그 줄이 파일에 남아 접속마다 실패한다.
    if host.chars().any(char::is_whitespace) {
        return Err(tr!(
            ko: "원격 호스트에 공백을 넣을 수 없습니다",
            en: "The remote host cannot contain spaces"
        ));
    }
    Ok((host.to_string(), remote_port))
}

/// 루프백에만 리스너를 세운다. 실패 문구는 프런트가 폼 안에 그대로 보여 준다.
async fn bind_local(port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| match e.kind() {
            ErrorKind::AddrInUse => {
                tr!(ko: "포트 {port} 이 이미 사용 중입니다", en: "Port {port} is already in use")
            }
            // 1024 미만 포트는 환경에 따라 권한이 필요하고, 방화벽 정책도 여기로 온다.
            _ => tr!(ko: "포트 {port} 을(를) 열지 못했습니다: {e}", en: "Could not open port {port}: {e}"),
        })
}

// ---------------------------------------------------------------------------
// 원격(-R) 길잡이 표
// ---------------------------------------------------------------------------

/// 원격 포워드 하나로 가는 길 — 채널이 도착했을 때 Handler 쪽이 알아야 하는 전부.
#[derive(Clone)]
struct RemoteRoute {
    forward_id: u32,
    local_port: u16,
    conns: Arc<AtomicU64>,
    active: Arc<AtomicU64>,
    relays: Arc<Mutex<Relays>>,
}

/// `(전송로 id, 서버 포트)` → 원격 포워드. 모듈 머리말의 "원격(-R)의 길잡이".
///
/// 세션 id 가 아니라 전송로 id 인 이유: 채널은 전송로에 도착하고, 한 전송로가 여러 세션을
/// 태운다(연결 공유). 서버 포트만으로도 모자란 이유: 서로 다른 서버(= 다른 전송로)는 같은
/// 포트 번호를 각자 가질 수 있다.
static REMOTE_ROUTES: LazyLock<Mutex<HashMap<(u64, u16), RemoteRoute>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 길을 하나 적는다. 같은 전송로에 같은 서버 포트가 이미 있으면 `false` (덮어쓰지 않는다).
fn route_remote(transport_id: u64, port: u16, route: RemoteRoute) -> bool {
    let mut map = REMOTE_ROUTES.lock().unwrap();
    if map.contains_key(&(transport_id, port)) {
        return false;
    }
    map.insert((transport_id, port), route);
    true
}

/// 길을 지운다 — **그 자리의 주인이 이 포워드일 때만**. 남의 길(같은 열쇠로 나중에 선
/// 포워드)을 옛 포워드의 뒤늦은 정리가 지우지 않게 한다.
fn unroute_remote(transport_id: u64, port: u16, forward_id: u32) {
    let mut map = REMOTE_ROUTES.lock().unwrap();
    if map
        .get(&(transport_id, port))
        .is_some_and(|r| r.forward_id == forward_id)
    {
        map.remove(&(transport_id, port));
    }
}

/// 도착한 채널의 길을 찾는다. 서버가 주는 포트는 `u32` 라 범위 밖이면 길이 없는 것이다.
fn remote_route(transport_id: u64, connected_port: u32) -> Option<RemoteRoute> {
    let port = u16::try_from(connected_port).ok()?;
    REMOTE_ROUTES
        .lock()
        .unwrap()
        .get(&(transport_id, port))
        .cloned()
}

/// **서버가 연 forwarded-tcpip 채널 하나를 받는다** — `SshHandler` 의 러시 훅이 부른다(ssh.rs).
///
/// 훅은 전송로의 세션 루프 안에서 돌므로 **여기서 기다리지 않는다**: 길만 찾고, 로컬 연결과
/// 중계는 태스크로 던진다(그 태스크는 포워드의 [`Relays`] 에 등록되어 [중지]가 끊을 수 있다).
///
/// 길이 없으면(우리가 걸지 않은 포트 · 방금 중지된 포워드) 답을 떨어뜨린다 — 러시의
/// `ChannelOpenHandle` 은 드롭될 때 `AdministrativelyProhibited` 로 거절한다.
pub(crate) fn accept_remote(
    transport_id: u64,
    connected_port: u32,
    channel: Channel<Msg>,
    reply: ChannelOpenHandle,
) {
    let Some(route) = remote_route(transport_id, connected_port) else {
        drop(reply);
        return;
    };
    route.conns.fetch_add(1, Ordering::Relaxed);
    let task = tokio::spawn(relay_remote(channel, reply, route.local_port, route.active));
    route.relays.lock().unwrap().register(task.abort_handle());
}

/// 원격(-R) 연결 하나 — 내 PC 의 `127.0.0.1:local_port` 에 먼저 붙어 보고, 붙으면 채널을
/// 받아들여 잇는다. 못 붙으면 채널을 `ConnectFailed` 로 거절한다 — 서버 쪽 클라이언트는
/// "연결 거부" 로 본다(OpenSSH 의 `-R` 과 같다). **이어 주는 곳도 루프백뿐이다.**
async fn relay_remote(
    channel: Channel<Msg>,
    reply: ChannelOpenHandle,
    local_port: u16,
    active: Arc<AtomicU64>,
) {
    let connect = TcpStream::connect((Ipv4Addr::LOCALHOST, local_port));
    let mut socket = match tokio::time::timeout(LOCAL_CONNECT_TIMEOUT, connect).await {
        Ok(Ok(socket)) => socket,
        _ => {
            reply.reject(ChannelOpenFailure::ConnectFailed).await;
            return;
        }
    };
    reply.accept().await;
    // 로컬 쪽 연결과 채널 수락이 **둘 다** 된 뒤에 센다 — 로컬 연결의 `relay` 와 같은 기준.
    let _active = ActiveGuard::new(active);
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
}

// ---------------------------------------------------------------------------
// 중계 (로컬 · 동적)
// ---------------------------------------------------------------------------

/// accept 루프가 연결마다 할 일 — 목적지가 **정해져 있는가(로컬)**, **연결이 말해 주는가(동적)**.
#[derive(Clone)]
enum Dest {
    /// 로컬(-L): 언제나 이 `host:port`.
    Fixed { host: String, port: u16 },
    /// 동적(-D): SOCKS5 요청이 고른 곳.
    Socks,
}

/// 연결 하나를 원격까지 이어 준다. **개별 연결의 실패는 그 연결만 끊는다** —
/// 세션이 죽었거나 서버가 채널을 거절해도 리스너는 계속 살아 있다 (사용자가 [중지] 를
/// 누르거나 세션이 정리될 때까지).
///
/// 반대 방향도 성립한다: 이 태스크는 **밖에서 abort 될 수 있다**([`Forward::stop`]).
/// 그때 소켓과 채널 스트림은 이 future 와 함께 드롭되어 양쪽이 닫히므로, 중간에 끼워 둔
/// 정리 코드가 따로 없다 — 넣지도 말 것 (abort 는 그 줄을 실행하지 않는다).
async fn relay(
    mut socket: TcpStream,
    handle: SessionHandle,
    remote_host: String,
    remote_port: u16,
    peer: SocketAddr,
    active: Arc<AtomicU64>,
) {
    // originator 는 서버 로깅용 정보다. 루프백 전용이라 언제나 127.0.0.1 이지만,
    // 포트까지 실어 주면 원격 sshd 로그에서 어느 연결인지 대조할 수 있다.
    let channel = match handle
        .channel_open_direct_tcpip(
            remote_host,
            u32::from(remote_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
    {
        Ok(channel) => channel,
        // 소켓은 여기서 drop 되며 닫힌다 — 클라이언트(psql 등)는 "연결 거부" 로 본다.
        Err(_) => return,
    };

    // **채널이 열린 뒤에** 센다. 채널 열기 실패는 "연결된 적 없음" 이므로 여기까지
    // 오지 못하고, 따라서 실패한 연결이 활성 수를 부풀리는 일이 없다.
    let _active = ActiveGuard::new(active);

    let mut stream = channel.into_stream();
    // 양쪽 중 하나가 EOF 를 보내면 반대쪽에도 전달하고 끝난다. 오류는 그 연결의 끝일 뿐이다.
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
}

/// 채널 열기 실패를 SOCKS5 응답 코드로 — **순수 함수** (유닛 테스트 대상).
///
/// 서버가 "목적지에 못 붙었다"(`ConnectFailed`)고 한 것만 `05`(연결 거부)이고, 나머지
/// (서버 정책 거절 · 전송로 사망 …)는 `01`(일반 실패)이다. curl 은 이 둘을 다른 문구로 보여
/// 주므로, "서버까지는 갔는데 그 포트가 닫혀 있다" 가 한눈에 갈린다.
fn socks_failure(e: &russh::Error) -> socks5::Reply {
    match e {
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed) => {
            socks5::Reply::ConnectionRefused
        }
        _ => socks5::Reply::GeneralFailure,
    }
}

/// 동적(-D) 연결 하나 — SOCKS5 핸드셰이크 → direct-tcpip → 응답 → 중계.
///
/// 목적지 이름은 **풀지 않고** 서버에 넘긴다(`socks5` 모듈 머리말) — 사내 DNS 로만 풀리는
/// 이름에 닿는 것이 SSH 위 SOCKS 의 요점이다. 성공 응답은 **채널이 열린 뒤에** 보낸다 —
/// 먼저 보내면 클라이언트가 이미 붙었다고 믿고 데이터를 쏟은 뒤에야 끊긴다.
async fn relay_socks(
    mut socket: TcpStream,
    handle: SessionHandle,
    peer: SocketAddr,
    active: Arc<AtomicU64>,
) {
    let handshake = socks5::handshake(&mut socket);
    let Ok(Some((target, early))) = tokio::time::timeout(SOCKS_HANDSHAKE_TIMEOUT, handshake).await
    else {
        return;
    };

    let channel = match handle
        .channel_open_direct_tcpip(
            target.host,
            u32::from(target.port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
    {
        Ok(channel) => channel,
        Err(e) => {
            let _ = socket.write_all(&socks5::reply(socks_failure(&e))).await;
            return;
        }
    };
    if socket
        .write_all(&socks5::reply(socks5::Reply::Succeeded))
        .await
        .is_err()
    {
        return;
    }

    let _active = ActiveGuard::new(active);
    let mut stream = channel.into_stream();
    // 응답을 기다리지 않고 요청 뒤에 붙어 온 바이트 — 채널에 먼저 흘려 보낸다.
    if !early.is_empty() && stream.write_all(&early).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
}

/// 리스너의 accept 루프 (로컬 · 동적). [`Forward::abort`] 로만 끝난다.
///
/// 연결마다 **별도 태스크**를 띄우는 이유는 명확하다 — 여기서 직접 중계하면 첫 연결이
/// 끝날 때까지 다음 연결을 받지 못한다 (DB 도구는 커넥션 풀로 여러 개를 동시에 연다,
/// 브라우저는 SOCKS 로 수십 개를 연다). 띄운 태스크는 [`Relays`] 에 등록해 둔다 — 중지가
/// 그 연결들까지 끊을 수 있는 유일한 길이다.
async fn accept_loop(
    listener: TcpListener,
    handle: SessionHandle,
    dest: Dest,
    conns: Arc<AtomicU64>,
    active: Arc<AtomicU64>,
    relays: Arc<Mutex<Relays>>,
) {
    loop {
        let (socket, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => {
                tokio::time::sleep(ACCEPT_BACKOFF).await;
                continue;
            }
        };
        conns.fetch_add(1, Ordering::Relaxed);
        let handle = Arc::clone(&handle);
        let active = Arc::clone(&active);
        let task = match &dest {
            Dest::Fixed { host, port } => {
                tokio::spawn(relay(socket, handle, host.clone(), *port, peer, active))
            }
            Dest::Socks => tokio::spawn(relay_socks(socket, handle, peer, active)),
        };
        relays.lock().unwrap().register(task.abort_handle());
    }
}

// ---------------------------------------------------------------------------
// 앱 안쪽 터널 — 쿼리 타일의 DB 드라이버가 붙는 리스너 (docs/log/2026-10-12-query-tile.md)
// ---------------------------------------------------------------------------

/// 세션 서버 안의 DB 드라이버가 `127.0.0.1:<임시 포트>` 로 붙으면 그 TCP 를 SSH `direct-tcpip(target)` 으로 잇는다.
///
/// 로컬(-L) 포워드와 같은 accept 루프·중계([`accept_loop`] · [`relay`])를 쓰되 **포워드가 아니다**: [`FORWARDS`] 에 오르지
/// 않으니 포워딩 목록·[중지]·세션 정리(`stop_session_forwards`)가 보지 않는다 — 수명은 이 값 하나다. 닫으면([`close`](Self::close)
/// 또는 드롭) 리스너와 **진행 중인 중계까지** 끊는다(포워드의 [중지] 규칙과 같다).
///
/// PG 취소 요청은 새 TCP 를 연다 — 그래서 리스너는 DB 연결이 사는 동안 내내 열려 있어야 한다(부른 쪽이 연결과 같이 들고 있다).
///
/// **바인드 주소를 고르는 칸이 없다** — 언제나 `127.0.0.1`([`bind_local`])이고 포트는 OS 가 고른다(0).
pub(crate) struct TunnelListener {
    local_addr: SocketAddr,
    accept: AbortHandle,
    relays: Arc<Mutex<Relays>>,
}

// 호출자는 쿼리 타일의 PG 엔진(`db::pg`) — 시험 빌드에서는 러시 핸들 없이 못 만드는 `open` 이 안 쓰인다.
#[cfg_attr(test, allow(dead_code))]
impl TunnelListener {
    /// 루프백 임시 포트에 리스너를 세우고 연결마다 `handle` 위에 `direct-tcpip(target_host, target_port)` 를 연다.
    /// 목적지 검사는 로컬(-L) 포워드와 같다(`validate_target`). 개별 연결의 실패(서버가 채널 거절)는 그 연결만 끊는다.
    pub(crate) async fn open(
        handle: SessionHandle,
        target_host: &str,
        target_port: u16,
    ) -> Result<TunnelListener, String> {
        let (host, port) = validate_target(target_host, target_port)?;
        let listener = bind_local(0).await?;
        Self::start(listener, move |listener, relays| {
            tokio::spawn(accept_loop(
                listener,
                handle,
                Dest::Fixed { host, port },
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
                relays,
            ))
        })
    }

    /// 리스너를 accept 태스크에 넘긴다 — 태스크를 만드는 몫만 부른 쪽이다(시험은 러시 핸들 없이 가짜 루프를 꽂는다).
    fn start(
        listener: TcpListener,
        spawn: impl FnOnce(TcpListener, Arc<Mutex<Relays>>) -> tokio::task::JoinHandle<()>,
    ) -> Result<TunnelListener, String> {
        let local_addr = listener.local_addr().map_err(|e| e.to_string())?;
        let relays: Arc<Mutex<Relays>> = Arc::default();
        let accept = spawn(listener, Arc::clone(&relays)).abort_handle();
        Ok(TunnelListener {
            local_addr,
            accept,
            relays,
        })
    }

    /// 드라이버가 붙을 주소 — 언제나 `127.0.0.1:<임시 포트>`.
    pub(crate) fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// 새 연결을 막고(accept 루프를 끊어 리스너를 놓는다) 중계 중인 연결도 끊는다. 멱등 — 드롭도 같은 일을 한다.
    /// 순서는 [`Forward::stop`] 과 같다(문 먼저, 중계 다음). 포트는 런타임이 태스크를 버리는 한 틱 뒤에 풀린다.
    pub(crate) fn close(&self) {
        self.accept.abort();
        self.relays.lock().unwrap_or_else(|e| e.into_inner()).stop();
    }
}

impl Drop for TunnelListener {
    fn drop(&mut self) {
        self.close();
    }
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 세션 하나에 포워드를 건다 — 로컬(-L) · 원격(-R) · 동적(-D). 세션 서버 op `forward_add`(쓰기)의 몸(③-3b2 — GUI 의 같은
/// 이름 Tauri 명령은 프록시다). **검사([`validate`])와 루프백 바인드는 여기(서버)에서** 한다 — 리스너는 늘 `127.0.0.1`.
///
/// `kind` 가 없으면 로컬이다 (이 칸이 생기기 전의 호출과 같다). 성공하면 곧바로 쓸 수 있다 —
/// 로컬·동적은 내 PC 에 리스너가 서 있고, 원격은 서버가 바인드를 받아들였다.
pub(crate) async fn add_forward(
    session_id: u32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    kind: Option<ForwardKind>,
) -> Result<ForwardInfo, String> {
    let kind = kind.unwrap_or_default();
    let (host, remote_port) = validate(kind, local_port, &remote_host, remote_port)?;

    if kind == ForwardKind::Remote {
        return add_remote(session_id, local_port, remote_port).await;
    }

    // 세션 핸들을 **먼저** 확인한다 — 죽은 세션에 리스너부터 세우면 곧바로 지워야 한다.
    let handle = crate::ssh::handle_of(crate::ssh::table(), session_id)
        .ok_or_else(crate::errors::session_gone_closed)?;

    let listener = bind_local(local_port).await?;

    let dest = match kind {
        ForwardKind::Dynamic => Dest::Socks,
        _ => Dest::Fixed {
            host: host.clone(),
            port: remote_port,
        },
    };
    let conns = Arc::new(AtomicU64::new(0));
    let active = Arc::new(AtomicU64::new(0));
    let relays: Arc<Mutex<Relays>> = Arc::default();
    let task = tokio::spawn(accept_loop(
        listener,
        handle,
        dest,
        Arc::clone(&conns),
        Arc::clone(&active),
        Arc::clone(&relays),
    ));

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let forward = Forward {
        session_id,
        kind,
        local_port,
        remote_host: host,
        remote_port,
        conns,
        active,
        abort: Some(task.abort_handle()),
        relays,
        remote: None,
        purpose: None,
        app_users: Default::default(),
    };
    let info = forward.info(id);
    FORWARDS.lock().unwrap().insert(id, forward);
    Ok(info)
}

/// 원격(-R) 포워드를 건다 — 서버에 `tcpip-forward("127.0.0.1", remote_port)` 를 청한다.
///
/// **길잡이 표에 먼저 적고 나서** 서버에 청한다. 반대로 하면 서버가 바인드를 받아들인 순간과
/// 표에 적히는 순간 사이에 도착한 첫 연결이 "모르는 포트" 로 거절된다. 서버가 거절하면 적은
/// 줄을 도로 지운다.
async fn add_remote(
    session_id: u32,
    local_port: u16,
    remote_port: u16,
) -> Result<ForwardInfo, String> {
    let (handle, transport_id) = crate::ssh::transport_of(crate::ssh::table(), session_id)
        .ok_or_else(crate::errors::session_gone_closed)?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let conns = Arc::new(AtomicU64::new(0));
    let active = Arc::new(AtomicU64::new(0));
    let relays: Arc<Mutex<Relays>> = Arc::default();
    let route = RemoteRoute {
        forward_id: id,
        local_port,
        conns: Arc::clone(&conns),
        active: Arc::clone(&active),
        relays: Arc::clone(&relays),
    };
    // 같은 전송로(= 연결 공유로 같은 서버 연결을 타는 옆 타일 포함)에 이미 그 서버 포트가
    // 걸려 있다. 서버에 물어봐도 거절되지만, 그 문구는 "이미 사용 중" 과 구분되지 않는다.
    if !route_remote(transport_id, remote_port, route) {
        return Err(tr!(
            ko: "원격 포트 {remote_port} 은(는) 이 서버 연결에 이미 걸려 있습니다 — 같은 서버에 붙은 다른 타일이 먼저 걸었을 수 있습니다",
            en: "Remote port {remote_port} is already forwarded on this server connection — another tile on the same server may have claimed it"
        ));
    }

    let request = handle.tcpip_forward(REMOTE_BIND_ADDR, u32::from(remote_port));
    match tokio::time::timeout(REMOTE_REQUEST_TIMEOUT, request).await {
        Ok(Ok(_)) => {}
        Ok(Err(russh::Error::RequestDenied)) => {
            unroute_remote(transport_id, remote_port, id);
            return Err(tr!(
                ko: "서버가 원격 포트 {remote_port} 을(를) 열어 주지 않았습니다 — 서버에서 이미 쓰는 포트이거나 sshd 가 포워딩을 막았습니다 (AllowTcpForwarding)",
                en: "The server refused to open remote port {remote_port} — it is already in use on the server, or sshd does not allow forwarding (AllowTcpForwarding)"
            ));
        }
        Ok(Err(e)) => {
            unroute_remote(transport_id, remote_port, id);
            return Err(tr!(
                ko: "원격 포트 {remote_port} 요청이 실패했습니다: {e}",
                en: "The request for remote port {remote_port} failed: {e}"
            ));
        }
        Err(_) => {
            unroute_remote(transport_id, remote_port, id);
            return Err(tr!(
                ko: "서버가 원격 포트 {remote_port} 요청에 답하지 않습니다 (시간 초과)",
                en: "The server did not answer the request for remote port {remote_port} (timed out)"
            ));
        }
    }

    let forward = Forward {
        session_id,
        kind: ForwardKind::Remote,
        local_port,
        remote_host: String::new(),
        remote_port,
        conns,
        active,
        abort: None,
        relays,
        remote: Some(RemoteBind {
            transport_id,
            handle,
        }),
        purpose: None,
        app_users: Default::default(),
    };
    let info = forward.info(id);
    FORWARDS.lock().unwrap().insert(id, forward);
    Ok(info)
}

/// **에이전트 신호 포워드를 보장한다** — 이 전송로에 이미 있으면 그 서버 포트를 나눠 쓰고(이 세션을
/// 쓰는 쪽에 더한다), 없으면 서버에 `tcpip-forward("127.0.0.1", 0)` 을 청해 **서버가 고른 포트**로
/// 세운다. 돌려주는 값은 서버 쪽 포트 — 원격 셸의 `AYNX_MCP_URL` 이 된다(모듈 머리말).
///
/// 이어 주는 곳은 내 PC 의 `127.0.0.1:local_port`(세션 서버의 신호 평면 — ③-3a `crate::server::signal_http`). 양쪽 끝 모두 루프백이다.
///
/// 포트 0 을 여기서만 쓴다: 사람이 거는 포워드에는 "서버가 준 번호를 돌려줄 자리가 없어" 막았지만
/// ([`validate`]), 여기는 그 번호를 **셸 환경으로 돌려주는 것이 목적**이다. 길잡이 표는 서버가 답한
/// 뒤에 적는다(번호를 그때 안다) — 그 사이의 틈에 들어올 연결은 없다: 이 포트를 아는 것은 아직
/// 보내지 않은 첫 입력뿐이다.
pub(crate) async fn ensure_agent_signal_forward(
    handle: SessionHandle,
    transport_id: u64,
    session_id: u32,
    local_port: u16,
) -> Result<u16, String> {
    if let Some(port) = join_agent_signal(transport_id, session_id, local_port) {
        return Ok(port);
    }
    let request = handle.tcpip_forward(REMOTE_BIND_ADDR, 0);
    let port = match tokio::time::timeout(REMOTE_REQUEST_TIMEOUT, request).await {
        Ok(Ok(p)) => u16::try_from(p).ok().filter(|p| *p != 0),
        Ok(Err(russh::Error::RequestDenied)) => {
            return Err(tr!(
                ko: "서버가 원격 포워딩을 막았습니다 (AllowTcpForwarding)",
                en: "The server does not allow remote forwarding (AllowTcpForwarding)"
            ))
        }
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            return Err(tr!(
                ko: "서버가 원격 포워딩 요청에 답하지 않습니다 (시간 초과)",
                en: "The server did not answer the remote forwarding request (timed out)"
            ))
        }
    };
    let Some(port) = port else {
        return Err(tr!(
            ko: "서버가 원격 포트 번호를 알려 주지 않았습니다",
            en: "The server did not report the remote port it chose"
        ));
    };

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let conns = Arc::new(AtomicU64::new(0));
    let active = Arc::new(AtomicU64::new(0));
    let relays: Arc<Mutex<Relays>> = Arc::default();
    let cancel = |handle: SessionHandle| {
        tokio::spawn(async move {
            let _ = tokio::time::timeout(
                REMOTE_REQUEST_TIMEOUT,
                handle.cancel_tcpip_forward(REMOTE_BIND_ADDR, u32::from(port)),
            )
            .await;
        });
    };

    let mut map = FORWARDS.lock().unwrap();
    // 기다리는 사이 같은 전송로에 누가 먼저 세웠다(같은 호스트의 여는 길은 게이트로 줄 서지만, 그
    // 전제에 기대지 않는다) — 방금 얻은 바인드는 도로 내놓고 그쪽을 나눠 쓴다.
    if let Some(existing) = map
        .values_mut()
        .find(|f| is_agent_signal_of(f, transport_id, local_port))
    {
        existing.app_users.insert(session_id);
        let shared = existing.remote_port;
        drop(map);
        cancel(handle);
        return Ok(shared);
    }
    let route = RemoteRoute {
        forward_id: id,
        local_port,
        conns: Arc::clone(&conns),
        active: Arc::clone(&active),
        relays: Arc::clone(&relays),
    };
    if !route_remote(transport_id, port, route) {
        // 서버가 방금 준 포트에 우리 길이 이미 있을 수는 없다 — 그래도 겹치면 남의 길을 덮지 않는다.
        drop(map);
        cancel(handle);
        return Err(tr!(
            ko: "원격 포트 {port} 의 길이 이미 있습니다",
            en: "Remote port {port} already has a route"
        ));
    }
    map.insert(
        id,
        Forward {
            session_id,
            kind: ForwardKind::Remote,
            local_port,
            remote_host: String::new(),
            remote_port: port,
            conns,
            active,
            abort: None,
            relays,
            remote: Some(RemoteBind {
                transport_id,
                handle,
            }),
            purpose: Some(ForwardPurpose::AgentSignal),
            app_users: std::iter::once(session_id).collect(),
        },
    );
    Ok(port)
}

/// 그 전송로의 에이전트 신호 포워드인가 (이어 주는 곳까지 같아야 한다 — 신호 포트가 바뀌었으면 — 세션 서버가 새로 떴으면 — 다른 것).
fn is_agent_signal_of(f: &Forward, transport_id: u64, local_port: u16) -> bool {
    f.purpose == Some(ForwardPurpose::AgentSignal)
        && f.local_port == local_port
        && f.remote
            .as_ref()
            .is_some_and(|b| b.transport_id == transport_id)
}

/// 이미 선 에이전트 신호 포워드에 이 세션을 더한다 — 있으면 그 서버 포트.
fn join_agent_signal(transport_id: u64, session_id: u32, local_port: u16) -> Option<u16> {
    let mut map = FORWARDS.lock().unwrap();
    let f = map
        .values_mut()
        .find(|f| is_agent_signal_of(f, transport_id, local_port))?;
    f.app_users.insert(session_id);
    Some(f.remote_port)
}

/// 원격이 포워딩을 막아 신호를 쓸 수 없을 때 타일에 뜨는 한 줄 (노랑 — 세션은 계속된다).
pub(crate) fn agent_signal_refused_notice(reason: &str) -> String {
    tr!(
        ko: "\x1b[33m⚠ 에이전트 상태 신호를 쓸 수 없습니다 — {reason}\x1b[0m\r\n",
        en: "\x1b[33m⚠ Agent status signals are unavailable — {reason}\x1b[0m\r\n"
    )
}

/// 한 세션의 포워드 목록 (id 오름차순 = 건 순서) — 세션 서버 op `forward_list`(읽기)의 몸. 메모리 맵 잠금 한 번과 몇 개
/// 안 되는 항목의 복사·정렬뿐이다.
pub(crate) fn list_forwards(session_id: u32) -> Vec<ForwardInfo> {
    let map = FORWARDS.lock().unwrap();
    let mut list: Vec<ForwardInfo> = map
        .iter()
        .filter(|(_, f)| f.used_by(session_id))
        .map(|(id, f)| f.info(*id))
        .collect();
    list.sort_by_key(|info| info.id);
    list
}

/// 포워드 하나를 중지한다.
///
/// **이미 없는 id 도 성공이다** (`close_ssh` 와 같은 멱등 계약) — 세션이 먼저 닫혀
/// 자동 정리된 뒤에 사용자가 [중지] 를 눌러도 오류로 놀라게 할 이유가 없다.
///
/// **[중지] = 새 연결 거부 + 중계 중인 연결도 그 자리에서 끊는다**
/// (사용자 결정 2026-09-17: 목록에서 지우면 끊겨야 한다).
///
/// 원래는 리스너만 닫고 열려 있던 연결은 각자 끝나게 두었다 — "진행 중인 쿼리를 자르는 것이
/// 놀랍다" 는 이유였다. 실기에서 뒤집혔다: 포워드를 지웠는데 클라이언트가 그대로 붙어
/// 있는 쪽이 더 놀랍다. 목록에서 사라진 줄은 **끊긴 줄**이어야 한다. 그래서 중지 뒤
/// `active_conns` 는 (런타임이 태스크를 버리는 한 틱 뒤에) 0 이 된다 —
/// docs/log/2026-09-01-port-forward.md §9.
///
/// **앱이 건 포워드(에이전트 신호)는 거절한다** — 모듈 머리말의 "앱이 거는 원격 포워드". 그 호스트의
/// 에이전트 타일을 닫으면 앱이 거둔다.
///
/// 세션 서버 op `forward_remove`(쓰기)의 몸.
pub(crate) async fn remove_forward(id: u32) -> Result<(), String> {
    let mut map = FORWARDS.lock().unwrap();
    if map.get(&id).is_some_and(|f| f.purpose.is_some()) {
        return Err(tr!(
            ko: "앱이 관리하는 포워드입니다 — 이 호스트의 에이전트 타일을 모두 닫으면 함께 거둡니다",
            en: "This forward is managed by the app — it is removed when every agent tile on this host is closed"
        ));
    }
    let removed = map.remove(&id);
    drop(map);
    if let Some(forward) = removed {
        forward.stop(id);
    }
    Ok(())
}

/// 세션이 닫힐 때 그 세션의 포워드를 전부 중지한다 ([`crate::ssh::close_ssh`] 가 부른다).
/// 돌려주는 값은 정리한 개수 (테스트·진단용).
///
/// [`remove_forward`] 와 **같은 중지**다 — 중계 중인 연결도 끊는다. 세션이 닫히면 SSH
/// 핸들이 드롭되어 채널은 어차피 죽지만, 로컬 소켓을 쥔 중계 태스크까지 확실히 걷어내는
/// 것은 여기서 명시적으로 한다 (죽은 채널을 붙들고 남은 소켓은 클라이언트에게 "붙어
/// 있는데 응답이 없는" 상태로 보인다). 원격(-R)의 서버 바인드도 여기서 거둔다 — 연결
/// 공유로 전송로가 살아남는 경우, 거두지 않으면 서버 포트가 다음 접속까지 물려 있다.
///
/// **앱이 건 포워드**(에이전트 신호)는 이 세션을 쓰는 쪽에서 빼기만 하고, 그것이 마지막이었을 때만
/// 멈춘다 — 같은 호스트의 다른 에이전트 타일이 아직 쓰고 있다.
pub(crate) fn stop_session_forwards(session_id: u32) -> usize {
    let mut map = FORWARDS.lock().unwrap();
    let dead: Vec<u32> = map
        .iter_mut()
        .filter_map(|(id, f)| match f.purpose {
            Some(_) => {
                f.app_users.remove(&session_id);
                f.app_users.is_empty().then_some(*id)
            }
            None => (f.session_id == session_id).then_some(*id),
        })
        .collect();
    for id in &dead {
        if let Some(forward) = map.remove(id) {
            forward.stop(*id);
        }
    }
    dead.len()
}

#[cfg(test)]
mod tests;
