//! 포트 포워딩 — 로컬(`ssh -L`) · 원격(`ssh -R`) · 동적(`ssh -D`, SOCKS5). 셋 다 이미 열린 SSH 세션 위에 선다.
//!
//! - **127.0.0.1 전용 — 양쪽 끝 모두**(→ docs/invariants.md 전문 7). `0.0.0.0` 이면 같은 망의 누구나 SSH 인증 없이 이 터널을 쓴다.
//!   원격(-R)도 서버 쪽 바인드는 늘 `127.0.0.1`, 이어 주는 쪽도 내 PC `127.0.0.1:local_port` 뿐이다. `GatewayPorts` 에 해당하는 칸은
//!   없다 — 필요해지면 명시적 옵트인 한 칸으로 열고 기본값이 되지 않는다.
//! - 원격(-R)의 채널은 세션이 아니라 전송로에 도착한다(연결 공유) — 길잡이 표 [`REMOTE_ROUTES`] 의 열쇠는 `(전송로 id, 서버 포트)`.
//! - **[중지] = 새 연결 거부 + 중계 중인 연결도 그 자리에서 끊는다** — 목록에서 사라진 줄은 끊긴 줄이어야 한다.
//! - 세션 수명: 포워드는 세션에 매달린다 — 세션이 닫히면(`close_ssh` · 종료 마감) 그 세션의 포워드가 전부 멈춘다(원격의 서버 바인드
//!   포함). 페이지 리로드는 세션을 떨어뜨리기만 하므로 포워드는 산다.
//! - 앱이 거는 원격 포워드(에이전트 신호 — [`ensure_agent_signal_forward`])는 전송로당 하나를 그 호스트의 에이전트 타일이 나눠 쓰고
//!   마지막 세션이 닫힐 때 거둔다. 사람이 [중지] 할 수 없다 — 이미 뜬 원격 에이전트는 옛 포트를 환경에 쥐고 있어 다시 세워도 닿지 않는다.
//! - 자동 재연결 뒤 프리셋 다시 걸기는 프런트의 일이다 — 이 모듈은 "세션 하나에 포워드 여럿" 만 안다.

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

/// 파일(`sessions.toml` 프리셋)과 IPC 에 **소문자**로 오간다. 기본값 `Local` 은 하위 호환 — 이 칸이 생기기 전의 프리셋은 전부 로컬이었다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardKind {
    #[default]
    Local,
    Remote,
    Dynamic,
}

/// 쓰지 않는 칸은 비어 있다 — 원격은 `remote_host: ""`, 동적은 거기에 `remote_port: 0` 까지.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ForwardInfo {
    pub id: u32,
    pub session_id: u32,
    pub kind: ForwardKind,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub conns: u64,
    /// 프런트는 이 값이 0 보다 크면 초록 점을 켠다.
    pub active_conns: u64,
    /// 사람이 건 포워드면 칸 자체가 없다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<ForwardPurpose>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ForwardPurpose {
    AgentSignal,
}

/// [중지] 가 중계 중인 연결까지 끊을 수 있게 하는 유일한 장치. `stopped`: abort 는 태스크가 다음 await 에 닿을 때 들어서, accept 루프가
/// 중지 뒤에도 막 받은 연결 하나를 띄워 등록할 수 있다 — 중지 뒤의 등록은 그 자리에서 abort 한다(원격의 길잡이 조회와 등록 사이도 같은 틈).
#[derive(Default)]
struct Relays {
    handles: Vec<AbortHandle>,
    stopped: bool,
}

impl Relays {
    fn register(&mut self, handle: AbortHandle) {
        if self.stopped {
            handle.abort();
            return;
        }
        self.handles.retain(|h| !h.is_finished());
        self.handles.push(handle);
    }

    fn stop(&mut self) {
        self.stopped = true;
        for h in self.handles.drain(..) {
            h.abort();
        }
    }
}

struct RemoteBind {
    transport_id: u64,
    handle: SessionHandle,
}

struct Forward {
    session_id: u32,
    kind: ForwardKind,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    conns: Arc<AtomicU64>,
    active: Arc<AtomicU64>,
    abort: Option<AbortHandle>,
    relays: Arc<Mutex<Relays>>,
    remote: Option<RemoteBind>,
    /// 있으면 주인은 `session_id` 가 아니라 [`Self::app_users`] 다.
    purpose: Option<ForwardPurpose>,
    app_users: std::collections::HashSet<u32>,
}

impl Forward {
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

    /// 순서: 새 연결이 들어오는 문(accept 루프 · 원격의 길잡이 표)을 먼저 닫고 중계를 끊는다 — 반대면 그 사이에 받은 연결이 산다.
    /// abort 가 로컬 소켓과 채널 스트림을 함께 드롭해 양방향이 닫힌다(협조적 취소를 따로 깔지 않는다). `active_conns` 는 한 틱 뒤에 0.
    /// 원격의 `cancel-tcpip-forward` 는 기다리지 않는다 — `close_ssh` 근처에서 동기로 불린다(시간 제한을 건다).
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

/// `Drop` 이라야 취소를 포함한 모든 종료 경로에서 내린다 — 경로마다 손으로 적으면 하나만 빠져도 아무도 없는데 초록불이 남는다.
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

/// 전역인 이유: `close_ssh` 는 `SshSessions` 상태만 들고 [`stop_session_forwards`] 를 부른다(두 모듈이 서로의 상태 타입을 몰라도 되게).
static FORWARDS: LazyLock<Mutex<HashMap<u32, Forward>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// accept 오류는 대부분 일시적이라 루프를 끝내지 않는다 — 곧바로 재시도하면 오류가 계속되는 동안 CPU 를 태운다.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);

/// 붙어 놓고 말이 없는 연결이 태스크를 영원히 붙들지 않게.
const SOCKS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

const REMOTE_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

const LOCAL_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// 언제나 루프백 — 머리말의 127.0.0.1 규칙.
const REMOTE_BIND_ADDR: &str = "127.0.0.1";

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

/// 다듬은 `(원격 호스트, 원격 포트)`. 쓰지 않는 칸은 검사하지 않고 비운다 — 화면이 감춘 칸의 옛 값이 파일 · 목록에 남지 않게.
/// 포트 0 은 막는다(어디로 붙을지 모르고 · 서버가 거절하고 · -R 은 서버가 고른 번호를 돌려줄 자리가 없다). 호스트별 프리셋도 이 함수를
/// 쓴다 — 저장과 실행의 규칙이 갈리면 파일에는 적혔는데 열리지 않는 줄이 생긴다(프런트 `forward.ts` 도 같은 규칙).
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

/// 로컬(-L) 포워드와 [`TunnelListener`] 가 같은 규칙을 쓴다.
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
    // 가운데 공백은 다듬어 줄 수 없다 — 조용히 넘기면 열리지 않는 포워드가 서고, 프리셋이면 접속마다 실패한다.
    if host.chars().any(char::is_whitespace) {
        return Err(tr!(
            ko: "원격 호스트에 공백을 넣을 수 없습니다",
            en: "The remote host cannot contain spaces"
        ));
    }
    Ok((host.to_string(), remote_port))
}

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

#[derive(Clone)]
struct RemoteRoute {
    forward_id: u32,
    local_port: u16,
    conns: Arc<AtomicU64>,
    active: Arc<AtomicU64>,
    relays: Arc<Mutex<Relays>>,
}

/// 서버 포트만으로는 모자라다 — 다른 서버(= 다른 전송로)는 같은 포트 번호를 각자 가질 수 있다.
static REMOTE_ROUTES: LazyLock<Mutex<HashMap<(u64, u16), RemoteRoute>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 같은 전송로에 같은 서버 포트가 이미 있으면 `false` — 덮어쓰지 않는다.
fn route_remote(transport_id: u64, port: u16, route: RemoteRoute) -> bool {
    let mut map = REMOTE_ROUTES.lock().unwrap();
    if map.contains_key(&(transport_id, port)) {
        return false;
    }
    map.insert((transport_id, port), route);
    true
}

/// **그 자리의 주인이 이 포워드일 때만** 지운다 — 같은 열쇠로 나중에 선 포워드의 길을 옛 포워드의 뒤늦은 정리가 지우지 않게.
fn unroute_remote(transport_id: u64, port: u16, forward_id: u32) {
    let mut map = REMOTE_ROUTES.lock().unwrap();
    if map
        .get(&(transport_id, port))
        .is_some_and(|r| r.forward_id == forward_id)
    {
        map.remove(&(transport_id, port));
    }
}

fn remote_route(transport_id: u64, connected_port: u32) -> Option<RemoteRoute> {
    let port = u16::try_from(connected_port).ok()?;
    REMOTE_ROUTES
        .lock()
        .unwrap()
        .get(&(transport_id, port))
        .cloned()
}

/// 러시 훅이 전송로의 세션 루프 안에서 부르므로 **여기서 기다리지 않는다** — 로컬 연결과 중계는 태스크로 던진다.
/// 길이 없으면 답을 떨어뜨린다(`ChannelOpenHandle` 드롭 = `AdministrativelyProhibited` 거절).
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

/// 못 붙으면 채널을 `ConnectFailed` 로 거절한다(OpenSSH 의 `-R` 과 같다). **이어 주는 곳도 루프백뿐이다.**
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
    // 로컬 쪽 연결과 채널 수락이 **둘 다** 된 뒤에 센다.
    let _active = ActiveGuard::new(active);
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
}

// ---------------------------------------------------------------------------
// 중계
// ---------------------------------------------------------------------------

#[derive(Clone)]
enum Dest {
    Fixed { host: String, port: u16 },
    Socks,
}

/// 개별 연결의 실패는 그 연결만 끊는다. 이 태스크는 밖에서 abort 될 수 있다 — 중간에 정리 코드를 끼워 넣지 말 것(abort 는 그 줄을
/// 실행하지 않는다).
async fn relay(
    mut socket: TcpStream,
    handle: SessionHandle,
    remote_host: String,
    remote_port: u16,
    peer: SocketAddr,
    active: Arc<AtomicU64>,
) {
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
        Err(_) => return,
    };

    // **채널이 열린 뒤에** 센다 — 실패한 연결이 활성 수를 부풀리지 않게.
    let _active = ActiveGuard::new(active);

    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
}

/// `ConnectFailed` 만 `05`(연결 거부) · 나머지는 `01`(일반 실패) — curl 이 둘을 다른 문구로 보여 준다.
fn socks_failure(e: &russh::Error) -> socks5::Reply {
    match e {
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed) => {
            socks5::Reply::ConnectionRefused
        }
        _ => socks5::Reply::GeneralFailure,
    }
}

/// 목적지 이름은 **풀지 않고** 서버에 넘긴다(사내 DNS 로만 풀리는 이름에 닿는 것이 요점). 성공 응답은 **채널이 열린 뒤에** 보낸다 —
/// 먼저 보내면 클라이언트가 데이터를 쏟은 뒤에야 끊긴다.
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

/// accept 루프 태스크의 abort 로만 끝난다. 연결마다 별도 태스크를 띄워 [`Relays`] 에 등록한다 — 중지가 그 연결들까지 끊는 유일한 길이다.
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
// 앱 안쪽 터널 — 쿼리 타일의 DB 드라이버가 붙는 리스너
// ---------------------------------------------------------------------------

/// 로컬(-L) 과 같은 accept 루프 · 중계를 쓰되 **포워드가 아니다** — [`FORWARDS`] 에 오르지 않아 목록 · [중지] · 세션 정리가 보지 않는다
/// (수명은 이 값 하나). 닫거나 드롭하면 진행 중인 중계까지 끊는다. PG 취소 요청은 새 TCP 를 열어, 리스너는 DB 연결이 사는 동안 열려
/// 있어야 한다. 바인드 주소를 고르는 칸이 없다 — 늘 `127.0.0.1`.
pub(crate) struct TunnelListener {
    local_addr: SocketAddr,
    accept: AbortHandle,
    relays: Arc<Mutex<Relays>>,
}

// 시험 빌드에서는 러시 핸들 없이 못 만드는 `open` 이 안 쓰인다.
#[cfg_attr(test, allow(dead_code))]
impl TunnelListener {
    /// 목적지 검사는 로컬(-L) 포워드와 같다. 개별 연결의 실패는 그 연결만 끊는다.
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

    /// 태스크를 만드는 몫만 부른 쪽이다(시험은 러시 핸들 없이 가짜 루프를 꽂는다).
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

    pub(crate) fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// 멱등 — 드롭도 같은 일을 한다. 순서는 [`Forward::stop`] 과 같다(문 먼저, 중계 다음).
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

/// 세션 서버 op `forward_add` 의 몸(GUI 의 같은 이름 Tauri 명령은 프록시). 검사와 루프백 바인드는 여기(서버)에서 한다.
/// `kind` 가 없으면 로컬이다(하위 호환).
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

/// **길잡이 표에 먼저 적고 나서** 서버에 청한다 — 반대면 바인드 직후 도착한 첫 연결이 "모르는 포트" 로 거절된다. 서버가 거절하면 도로 지운다.
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
    // 서버에 물어봐도 거절되지만 그 문구는 "이미 사용 중" 과 구분되지 않는다 — 여기서 먼저 막는다.
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

/// 돌려주는 값은 서버 쪽 포트 — 원격의 신호 주소(`AYNX_MCP_URL`)가 된다. 양쪽 끝 모두 루프백이다.
/// 포트 0(서버가 고름)은 여기서만 쓴다 — 번호를 셸 환경으로 돌려주는 것이 목적이다. 길잡이 표는 서버가 답한 뒤 적는다 — 이 포트를
/// 아는 것은 아직 보내지 않은 첫 입력뿐이라 그 사이에 올 연결이 없다.
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
    // 기다리는 사이 같은 전송로에 누가 먼저 세웠다 — 방금 얻은 바인드는 도로 내놓고 그쪽을 나눠 쓴다.
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

/// 이어 주는 곳까지 같아야 한다 — 세션 서버가 새로 떠 신호 포트가 바뀌었으면 다른 것.
fn is_agent_signal_of(f: &Forward, transport_id: u64, local_port: u16) -> bool {
    f.purpose == Some(ForwardPurpose::AgentSignal)
        && f.local_port == local_port
        && f.remote
            .as_ref()
            .is_some_and(|b| b.transport_id == transport_id)
}

fn join_agent_signal(transport_id: u64, session_id: u32, local_port: u16) -> Option<u16> {
    let mut map = FORWARDS.lock().unwrap();
    let f = map
        .values_mut()
        .find(|f| is_agent_signal_of(f, transport_id, local_port))?;
    f.app_users.insert(session_id);
    Some(f.remote_port)
}

pub(crate) fn agent_signal_refused_notice(reason: &str) -> String {
    tr!(
        ko: "\x1b[33m⚠ 에이전트 상태 신호를 쓸 수 없습니다 — {reason}\x1b[0m\r\n",
        en: "\x1b[33m⚠ Agent status signals are unavailable — {reason}\x1b[0m\r\n"
    )
}

/// 세션 서버 op `forward_list` 의 몸 — id 오름차순 = 건 순서.
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

/// 세션 서버 op `forward_remove` 의 몸. 이미 없는 id 도 성공이다(`close_ssh` 와 같은 멱등 계약).
/// 앱이 건 포워드(에이전트 신호)는 거절한다 — 그 호스트의 에이전트 타일을 닫으면 앱이 거둔다.
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

/// [`crate::ssh::close_ssh`] 가 부른다. [`remove_forward`] 와 같은 중지다 — 죽은 채널을 붙든 로컬 소켓은 "붙어 있는데 응답 없는" 상태로
/// 보인다. 원격의 서버 바인드도 거둔다(연결 공유로 전송로가 살면 서버 포트가 물려 있다). 앱이 건 포워드는 이 세션을 쓰는 쪽에서 빼고
/// 마지막일 때만 멈춘다.
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
