//! 전송로 세우기 — 홉 열기 → 호스트 키 검증까지(인증 전).

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, AuthResult, Handle};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::i18n::tr;
use crate::ssh_config::StrictHostKeyChecking;
use crate::ssh_pool::TransportSignal;

use super::*;

// ── 한 홉 열기 ──

/// 정책은 홉마다 다르다 — `strict`/`no_host_key_store` 는 그 홉의 별칭 블록에서 온다. 대상의 완화가 점프로 번지면
/// 사용자가 완화한 적 없는 서버를 앱이 대신 완화하는 셈이 된다.
struct Hop<'a> {
    host: &'a str,
    port: u16,
    decision: Option<HostKeyDecision>,
    strict: StrictHostKeyChecking,
    no_host_key_store: bool,
    auto_accepted: Arc<AtomicBool>,
    changed_accepted: Arc<AtomicBool>,
    keepalive_max: usize,
    server_version: Arc<Mutex<Option<String>>>,
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

/// 분류된 사유에는 러시의 영문 오류를 싣지 않는다 — 다음에 할 일은 힌트 줄이 말한다.
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

/// 스트림은 `'static` 이라 점프 세션의 수명과 묶이지 않는다 — 점프 `Handle` 을 [`SshSession::jump`] 에 따로 붙잡아 둬야 한다.
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

// ── 전송로 세우기 ──

/// 인증 전. `jump` 가 떨어지면 대상 연결도 함께 죽는다 — 쓰는 쪽이 두 핸들을 같은 수명으로 묶는다.
#[must_use]
pub(crate) struct Transport {
    pub handle: Handle<SshHandler>,
    pub jump: Option<Arc<Handle<SshHandler>>>,
    /// 대상 서버의 배너만 — 경유 쪽은 담지 않는다.
    pub server_version: Option<String>,
    /// 대상 홉의 번호만 — 원격 포워드는 언제나 대상 서버에 건다.
    pub transport_id: u64,
}

/// Nagle 지연을 끈다 — 대화형 터미널의 키 입력 왕복이 눈에 띈다.
fn client_config(interval: Option<Duration>, max: usize) -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: interval,
        keepalive_max: max,
        nodelay: true,
        ..client::Config::default()
    })
}

/// 접속과 [`crate::copy_id`] 가 같은 검증 기계를 쓰는 유일한 문이다 — 갈라지면 "셸은 TOFU 모달이 뜨는데 키 설치는
/// 조용히 통과" 같은 구멍이 생긴다. 점프 인증만 여기서 끝내고 대상 인증은 부르는 쪽의 몫이다.
/// `unlock` 은 경유 호스트의 잠긴 키 파일에만 쓰인다.
pub(crate) async fn connect_transport(
    params: &ConnectParams,
    decision: Option<HostKeyDecision>,
    auto_accepted: &Arc<AtomicBool>,
    changed_accepted: &Arc<AtomicBool>,
    exit: &Arc<TransportSignal>,
    unlock: KeyUnlock<'_>,
) -> Result<Transport, SshOpenError> {
    // 배너 슬롯은 홉마다 따로다 — 공유하면 경유의 배너가 대상의 것을 덮는다.
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
    fn banner_of(slot: &Mutex<Option<String>>) -> Option<String> {
        slot.lock().ok().and_then(|s| s.clone())
    }

    // ── 점프 호스트 ──
    // 둘 다 처음 보는 서버면 TOFU 모달이 두 번 뜬다(점프 → 대상) — 재시도 계약은 그대로다.
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
            // 점프는 자기 별칭의 옵션을 쓴다 — 대상의 완화가 여기까지 번지지 않는다.
            strict: jump.strict,
            no_host_key_store: jump.no_host_key_store,
            auto_accepted: Arc::clone(auto_accepted),
            changed_accepted: Arc::clone(changed_accepted),
            keepalive_max: jump.keepalive_max,
            server_version: Arc::new(Mutex::new(None)),
            // 대상과 같은 번호를 나눠 쓰면 서로 다른 두 전송로가 한 열쇠로 보이게 된다.
            transport_id: next_transport_id(),
        },
        exit,
    )
    .await
    .map_err(|e| at_jump(&jump.label, e))?;

    authenticate_jump(
        &mut jump_handle,
        &jump.user,
        &jump.label,
        jump.identity_file.as_deref(),
        jump.identities_only,
        unlock,
    )
    .await?;

    // originator 는 정보용이라 OpenSSH 처럼 루프백/0 을 적는다.
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

    let handle = connect_hop_over(target_config, channel.into_stream(), target, exit).await?;
    Ok(Transport {
        handle,
        jump: Some(Arc::new(jump_handle)),
        server_version: banner_of(&banner),
        transport_id,
    })
}

/// [`crate::copy_id`] 의 부트스트랩 전용 — 에이전트를 먼저 시도하면 `MaxAuthTries` 를 키 시도로 태워 비밀번호 차례에서 서버가 끊는다.
/// `password` 는 소유권째 러시로 넘어가며 오류 문구에도 실리지 않는다.
pub(crate) async fn authenticate_password_only(
    handle: &mut Handle<SshHandler>,
    user: &str,
    password: String,
) -> Result<(), SshOpenError> {
    match handle.authenticate_password(user, password).await {
        Ok(AuthResult::Success) => Ok(()),
        // 틀린 비밀번호와 "서버가 password 를 안 받음" 은 구분하지 않는다 — `remaining_methods` 로 넘겨짚으면 틀리게 단정할 수 있다.
        Ok(AuthResult::Failure { .. }) => Err(SshOpenError::password_required(wrong_password())),
        Err(e) => Err(SshOpenError::auth(tr!(
            ko: "비밀번호 인증에 실패했습니다: {e}",
            en: "Password authentication failed: {e}"
        ))),
    }
}
