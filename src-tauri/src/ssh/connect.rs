//! 전송로 세우기 — 한 홉 열기(직접 TCP · 점프 채널 위) → 호스트 키 검증까지([`connect_transport`]),
//! 그리고 부트스트랩 전용 비밀번호 인증([`authenticate_password_only`]).

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, AuthResult, Handle};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::i18n::tr;
use crate::ssh_config::StrictHostKeyChecking;
use crate::ssh_pool::TransportSignal;

use super::*;

// ---------------------------------------------------------------------------
// 한 홉 열기 (직접 TCP · 점프 채널 위)
// ---------------------------------------------------------------------------

/// 한 홉을 열 때 Handler 에 필요한 것. 점프든 대상이든 **검증 기계는 동일**하고,
/// known_hosts 항목은 그 홉의 `host:port` 로 잡힌다.
///
/// **다만 정책은 홉마다 다르다** — `strict`/`no_host_key_store` 는 그 홉의 별칭 블록에서
/// 온다. 대상에 `StrictHostKeyChecking no` 를 적었다고 점프까지 검증이 꺼지면, 사용자가
/// 완화한 적 없는 서버를 앱이 대신 완화하는 셈이 된다.
struct Hop<'a> {
    host: &'a str,
    port: u16,
    decision: Option<HostKeyDecision>,
    strict: StrictHostKeyChecking,
    no_host_key_store: bool,
    /// `accept-new` 자동 수락 여부를 밖으로 알리는 공유 플래그 (셸 배너용).
    auto_accepted: Arc<AtomicBool>,
    /// 바뀐 키를 사람이 수락했는지 밖으로 알리는 공유 플래그 (셸 배너용).
    changed_accepted: Arc<AtomicBool>,
    /// keepalive 타임아웃 문구용 (표시 전용).
    keepalive_max: usize,
    /// 서버가 배너로 보낸 자기 소개를 받아 두는 슬롯 ([`SshHandler::server_version`]).
    server_version: Arc<Mutex<Option<String>>>,
    /// 이 홉의 전송로 번호 ([`SshHandler::transport_id`]).
    transport_id: u64,
}

impl Hop<'_> {
    fn handler(
        &self,
        exit: &Arc<TransportSignal>,
    ) -> (SshHandler, Arc<Mutex<Option<RejectReason>>>) {
        let reject: Arc<Mutex<Option<RejectReason>>> = Arc::new(Mutex::new(None));
        let handler = SshHandler {
            host: self.host.to_string(),
            port: self.port,
            server_version: Arc::clone(&self.server_version),
            decision: self.decision,
            strict: self.strict,
            no_host_key_store: self.no_host_key_store,
            auto_accepted: Arc::clone(&self.auto_accepted),
            changed_accepted: Arc::clone(&self.changed_accepted),
            keepalive_max: self.keepalive_max,
            reject: Arc::clone(&reject),
            exit: Arc::clone(exit),
            transport_id: self.transport_id,
        };
        (handler, reject)
    }

    /// connect 실패를 프런트 계약으로 옮긴다 — 호스트 키 때문에 끊었다면 러시의 일반
    /// 오류보다 그쪽이 훨씬 유용하다.
    fn failure(&self, reject: &Mutex<Option<RejectReason>>, e: russh::Error) -> SshOpenError {
        match reject.lock().ok().and_then(|mut slot| slot.take()) {
            Some(RejectReason::Unknown {
                fingerprint,
                key_type,
            }) => SshOpenError::HostKeyUnknown {
                fingerprint,
                key_type,
                host: self.host.to_string(),
                port: self.port,
                no_store: self.no_host_key_store,
            },
            Some(RejectReason::Changed {
                fingerprint,
                key_type,
                old_fingerprint,
            }) => SshOpenError::HostKeyChanged {
                fingerprint,
                key_type,
                host: self.host.to_string(),
                port: self.port,
                no_store: self.no_host_key_store,
                old_fingerprint,
            },
            Some(RejectReason::Failed(message)) => SshOpenError::other(message),
            None => {
                let cause = classify_connect(&e);
                SshOpenError::other_with(cause, connect_message(cause, self.host, self.port, &e))
            }
        }
    }
}

/// 분류된 사유마다 **사람이 읽는 한 줄** — 러시의 영문 오류를 앞세우지 않는다.
///
/// 옛 문구(`{host}:{port} 접속 실패: {e}`)는 `other` 갈래에 그대로 남는다. 분류가 되는
/// 넷에서는 러시 문자열을 빼는 편이 낫다 — `Connection refused (os error 10061)` 는 이미
/// 우리가 아는 사실을 영어로 되풀이할 뿐이고, 사용자가 다음에 할 일은 힌트 줄이 말한다.
pub(super) fn connect_message(cause: OpenCause, host: &str, port: u16, e: &russh::Error) -> String {
    match cause {
        OpenCause::Dns => tr!(
            ko: "호스트 이름 {host} 을(를) 찾을 수 없습니다",
            en: "Could not resolve the host name {host}",
            host = host
        ),
        OpenCause::TcpRefused => tr!(
            ko: "{host}:{port} 이(가) 연결을 거부했습니다",
            en: "{host}:{port} refused the connection",
            host = host,
            port = port
        ),
        OpenCause::TcpTimeout => tr!(
            ko: "{host}:{port} 이(가) 응답하지 않습니다 (시간 초과)",
            en: "{host}:{port} did not answer (timed out)",
            host = host,
            port = port
        ),
        OpenCause::TcpUnreachable => tr!(
            ko: "{host}:{port} 에 닿을 수 없습니다",
            en: "Could not reach {host}:{port}",
            host = host,
            port = port
        ),
        OpenCause::BannerOrProtocol => tr!(
            ko: "{host}:{port} 이(가) SSH 로 응답하지 않습니다: {e}",
            en: "{host}:{port} did not answer as an SSH server: {e}",
            host = host,
            port = port,
            e = e
        ),
        _ => tr!(
            ko: "{host}:{port} 접속 실패: {e}",
            en: "Could not connect to {host}:{port}: {e}",
            host = host,
            port = port,
            e = e
        ),
    }
}

/// 직접 TCP 로 한 홉을 연다.
async fn connect_hop(
    config: Arc<client::Config>,
    hop: Hop<'_>,
    exit: &Arc<TransportSignal>,
) -> Result<Handle<SshHandler>, SshOpenError> {
    let (handler, reject) = hop.handler(exit);
    client::connect(config, (hop.host, hop.port), handler)
        .await
        .map_err(|e| hop.failure(&reject, e))
}

/// 이미 열려 있는 스트림(= 점프의 direct-tcpip 채널) 위에서 한 홉을 연다.
///
/// 스트림은 `'static` 이라 점프 세션의 수명과 묶이지 않는다 — 그래서 점프 `Handle` 을
/// [`SshSession::jump`] 에 따로 붙잡아 둬야 한다.
async fn connect_hop_over<S>(
    config: Arc<client::Config>,
    stream: S,
    hop: Hop<'_>,
    exit: &Arc<TransportSignal>,
) -> Result<Handle<SshHandler>, SshOpenError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (handler, reject) = hop.handler(exit);
    client::connect_stream(config, stream, handler)
        .await
        .map_err(|e| hop.failure(&reject, e))
}

// ---------------------------------------------------------------------------
// 전송로 세우기 (점프 + 호스트 키 검증까지, 인증 전)
// ---------------------------------------------------------------------------

/// 별칭 하나로 세운 **전송로**. 인증은 아직이다.
///
/// `jump` 를 굳이 들고 다니는 이유는 [`SshSession::jump`] 와 같다 — 대상의 전송로가 점프의
/// direct-tcpip 채널 위에 얹혀 있어서, 이것이 떨어지면 대상 연결도 함께 죽는다.
/// 그래서 `#[must_use]` 로 통째로 받게 하고, 쓰는 쪽이 두 핸들을 **같은 수명**으로 묶는다.
#[must_use]
pub(crate) struct Transport {
    pub handle: Handle<SshHandler>,
    pub jump: Option<Arc<Handle<SshHandler>>>,
    /// **대상** 서버가 배너로 보낸 자기 소개(`OpenSSH_9.6p1 …`) — 못 읽었으면 `None`.
    /// 경유 쪽 배너는 담지 않는다(슬롯을 홉마다 따로 둔다): 상태 표시가 말하는 "서버" 는
    /// 언제나 붙은 서버 하나다.
    pub server_version: Option<String>,
    /// **대상** 홉의 전송로 번호 ([`SshHandler::transport_id`]) — 경유 홉의 번호는 담지 않는다
    /// (원격 포워드는 언제나 대상 서버에 건다).
    pub transport_id: u64,
}

/// 한 홉짜리 클라이언트 설정. 대화형 터미널이므로 Nagle 지연을 끈다
/// (키 입력 왕복이 눈에 띈다 — 일회성 exec 에도 손해가 없어 같은 값을 쓴다).
fn client_config(interval: Option<Duration>, max: usize) -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: interval,
        keepalive_max: max,
        nodelay: true,
        ..client::Config::default()
    })
}

/// 별칭의 접속 파라미터로 **전송로만** 세운다 — 홉 연결과 호스트 키 검증까지.
///
/// [`open_ssh_session`](super::open::open_ssh_session) 과 [`crate::copy_id`] 가 **같은 검증 기계**를 쓰도록 뽑아 둔 조각이다.
/// 두 경로가 갈라지면 "셸은 TOFU 모달이 뜨는데 키 설치는 조용히 통과" 같은 구멍이 생긴다 —
/// 여기 하나만 지나가므로 `StrictHostKeyChecking`·`accept-new`·known_hosts 판정이 언제나 같다.
///
/// 인증은 하지 않는다. 대상 인증은 부르는 쪽의 몫이고([`authenticate`] ·
/// [`authenticate_password_only`] · [`authenticate_keys_only`]), **점프 인증만** 여기서
/// 끝낸다 — 점프는 통로를 여는 데 필요하고 정책도 하나뿐이기 때문이다
/// ([`authenticate_jump`]: 키 인증 전용).
///
/// `exit` 는 **전송로 하나의** 종료 신호다 ([`TransportSignal`]) — 이 연결 위에 올라탄
/// 세션이 여럿일 수 있어서다(연결 공유). 공유하지 않는 부름(설치 검증·헤드리스)은
/// [`TransportSignal::solo`] 로 대상 하나만 실어 넘긴다.
///
/// `unlock` 은 **경유 호스트의 잠긴 키 파일**에만 쓰인다 — 대상 쪽 암호구는 부르는 쪽이
/// [`authenticate`] 에 직접 넘긴다. 사람이 없는 경로(설치 검증·헤드리스)는
/// [`KeyUnlock::Skip`] 을 준다: 잠긴 키는 묻지 않고 건너뛴다.
pub(crate) async fn connect_transport(
    params: &ConnectParams,
    decision: Option<HostKeyDecision>,
    auto_accepted: &Arc<AtomicBool>,
    changed_accepted: &Arc<AtomicBool>,
    exit: &Arc<TransportSignal>,
    unlock: KeyUnlock<'_>,
) -> Result<Transport, SshOpenError> {
    // 배너 슬롯은 **홉마다 따로**다 — 하나를 공유하면 경유의 배너가 대상의 것을 덮는다.
    let banner = Arc::new(Mutex::new(None));
    let transport_id = next_transport_id();
    let target = Hop {
        host: &params.host,
        port: params.port,
        decision,
        strict: params.strict,
        no_host_key_store: params.no_host_key_store,
        auto_accepted: Arc::clone(auto_accepted),
        changed_accepted: Arc::clone(changed_accepted),
        keepalive_max: params.keepalive_max,
        server_version: Arc::clone(&banner),
        transport_id,
    };
    let target_config = client_config(params.keepalive_interval, params.keepalive_max);
    /// 슬롯에서 배너를 꺼낸다 — 잠금이 깨졌으면 없는 셈 친다(상태 표시 한 줄이 전부다).
    fn banner_of(slot: &Mutex<Option<String>>) -> Option<String> {
        slot.lock().ok().and_then(|s| s.clone())
    }

    // ── 점프 호스트 ─────────────────────────────────────────────────────────
    // 있으면 대상보다 **먼저** 선다. 점프도 대상과 똑같이 호스트 키 검증을 거치므로
    // 둘 다 처음 보는 서버면 TOFU 모달이 두 번 뜬다 (점프 → 대상). 재시도 계약은
    // 그대로다 — `accept_new_host_key: true` 로 다시 열면 그 시점에 아직 모르는 키를
    // learn 한다 (docs/log/2026-09-01-jump-host.md).
    let Some(jump) = &params.jump else {
        let handle = connect_hop(target_config, target, exit).await?;
        return Ok(Transport {
            handle,
            jump: None,
            server_version: banner_of(&banner),
            transport_id,
        });
    };

    let mut jump_handle = connect_hop(
        client_config(jump.keepalive_interval, jump.keepalive_max),
        Hop {
            host: &jump.host,
            port: jump.port,
            decision,
            // 점프는 **자기 별칭의** 옵션을 쓴다 — 대상의 완화가 여기까지 번지지 않는다.
            strict: jump.strict,
            no_host_key_store: jump.no_host_key_store,
            auto_accepted: Arc::clone(auto_accepted),
            changed_accepted: Arc::clone(changed_accepted),
            keepalive_max: jump.keepalive_max,
            // 경유의 배너는 버린다 (위 `banner` 는 대상 전용이다).
            server_version: Arc::new(Mutex::new(None)),
            // 경유 홉도 제 번호를 갖는다 — 거기에 원격 포워드를 걸 일은 없지만, 대상과 같은
            // 번호를 나눠 쓰면 서로 다른 두 전송로가 한 열쇠로 보이게 된다.
            transport_id: next_transport_id(),
        },
        exit,
    )
    .await
    // 여기서 난 실패는 **경유 쪽**이다 — 대상의 같은 문구와 갈라 준다 ([`at_jump`]).
    .map_err(|e| at_jump(&jump.label, e))?;

    // 인증 실패 문구는 이미 별칭을 담고 있다 ([`jump_auth_error`]) — 덧붙이지 않는다.
    authenticate_jump(
        &mut jump_handle,
        &jump.user,
        &jump.label,
        jump.identity_file.as_deref(),
        jump.identities_only,
        unlock,
    )
    .await?;

    // 점프가 대신 열어 주는 TCP 연결. originator 는 순수 정보용이라
    // OpenSSH 처럼 루프백/0 을 적는다 (서버는 로깅에만 쓴다).
    let channel = jump_handle
        .channel_open_direct_tcpip(params.host.clone(), params.port as u32, "127.0.0.1", 0)
        .await
        .map_err(|e| {
            SshOpenError::other(tr!(
                ko: "경유 호스트 {label} 에서 {host}:{port} 로 가는 통로를 열지 못했습니다: {e}",
                en: "Could not open a channel from jump host {label} to {host}:{port}: {e}",
                label = jump.label,
                host = params.host,
                port = params.port
            ))
        })?;

    // 이 스트림이 대상 연결의 전송로가 된다. 여기부터 아래는 직접 접속과
    // **완전히 같은 경로**다 (호스트 키·인증·채널).
    let handle = connect_hop_over(target_config, channel.into_stream(), target, exit).await?;
    Ok(Transport {
        handle,
        jump: Some(Arc::new(jump_handle)),
        server_version: banner_of(&banner),
        transport_id,
    })
}

/// **비밀번호만으로** 인증한다 — 에이전트를 아예 건드리지 않는다.
///
/// [`crate::copy_id`] 의 일회성 부트스트랩 전용이다. 거기서 에이전트를 먼저 시도하면
/// 앞뒤가 바뀐다: 키 인증이 되는 서버라면 애초에 키를 설치할 이유가 없고, 되지 않는
/// 서버에서는 [`authenticate`] 가 `MaxAuthTries` 를 키 시도로 태워 버려 정작 비밀번호
/// 차례에서 서버가 연결을 끊는다.
///
/// `password` 는 **소유권째** 들어와 러시로 넘어가며 이 스코프에서 사라진다. 오류 문구에도
/// 실리지 않는다 ([`wrong_password`] 는 고정 문구다).
pub(crate) async fn authenticate_password_only(
    handle: &mut Handle<SshHandler>,
    user: &str,
    password: String,
) -> Result<(), SshOpenError> {
    match handle.authenticate_password(user, password).await {
        Ok(AuthResult::Success) => Ok(()),
        // 틀린 비밀번호와 "서버가 password 를 안 받음" 은 여기서 구분되지 않는다.
        //
        // (분류 축에서도 같다 — `auth_password_rejected` 하나로 올린다.)
        // 둘 다 프런트의 같은 재입력 계약으로 보내는 편이 낫다 — 사용자가 한 번 더
        // 쳐 보면 즉시 알 수 있고, 우리가 `remaining_methods` 로 넘겨짚으면 오히려
        // "비밀번호 인증이 꺼져 있습니다" 를 틀리게 단정할 수 있다.
        Ok(AuthResult::Failure { .. }) => Err(SshOpenError::password_required(wrong_password())),
        // 프로토콜 오류(MaxAuthTries 초과로 끊김 등)는 재시도해도 소용없다.
        Err(e) => Err(SshOpenError::auth(tr!(
            ko: "비밀번호 인증에 실패했습니다: {e}",
            en: "Password authentication failed: {e}"
        ))),
    }
}

// (`authenticate_agent_only` 는 2026-09-19 에 [`authenticate_keys_only`] 로 넓어졌다 —
//  설치 검증이 파일 키도 내 본다. 갈래가 `Result` 에서 세 값으로 바뀐 이유는 그쪽 문서 참고.)
