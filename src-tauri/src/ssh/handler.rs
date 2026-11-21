//! russh 클라이언트 핸들러(호스트 키 검증 · 서버가 여는 채널)와 세션 종료 알림(`ssh-exit` 정확히 한 번).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::client::{self, DisconnectReason, Msg};
use russh::keys::PublicKeyOrCertificate;


use crate::i18n::tr;
use crate::known_hosts::{self, HostKeyStatus};
use crate::ssh_config::StrictHostKeyChecking;
use crate::ssh_pool::{ExitTarget, TransportSignal};

use super::*;

// ── 보안 완화 가시화 ──

/// 완화가 조용히 일어나면 안 된다 — config 에 적은 것이라도 중간자 공격을 탐지할 수 없다는 사실은 화면에 남아야 한다.
pub(super) fn strict_off_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 이 세션은 호스트 키 검증이 꺼져 있습니다 (StrictHostKeyChecking no)\x1b[0m\r\n",
        en: "\x1b[33m⚠ Host key verification is off for this session (StrictHostKeyChecking no)\x1b[0m\r\n"
    )
}

pub(super) fn accept_new_notice() -> String {
    tr!(
        ko: "\x1b[90m호스트 키를 자동으로 신뢰했습니다 (accept-new)\x1b[0m\r\n",
        en: "\x1b[90mTrusted the host key automatically (accept-new)\x1b[0m\r\n"
    )
}

/// 원래 거부되는 일을 사람이 그 자리에서 뚫었다 — 그 결정이 화면에 남아야 한다.
pub(super) fn changed_accepted_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 이 서버의 호스트 키가 바뀌었고 사용자가 수락했습니다\x1b[0m\r\n",
        en: "\x1b[33m⚠ This server's host key changed and you accepted it\x1b[0m\r\n"
    )
}

/// 출력 배칭 채널에 직접 쓴다 — `on_connect` 전송보다 먼저, 펌프 태스크를 띄우기 전에 넣어야 큐의 맨 앞에 선다.
/// 홉이 여럿이면 가장 약한 고리를 따른다 — 점프에서 검증이 꺼져도 경고를 낸다.
pub(super) fn security_notices(
    verification_off: bool,
    auto_accepted: bool,
    changed_accepted: bool,
) -> Vec<String> {
    let mut out = Vec::new();
    if verification_off {
        out.push(strict_off_notice());
    }
    if auto_accepted {
        out.push(accept_new_notice());
    }
    if changed_accepted {
        out.push(changed_accepted_notice());
    }
    out
}

// ── 세션 종료 알림 ──

/// `ssh-exit` 의 `reason` — 프런트가 자동 재연결 여부를 가르는 유일한 값이다(프런트와 맞춘 글자).
/// `"exit"` 는 셸이 스스로 끝났다(재연결하면 안 된다) · `"error"` 는 증거 없이 연결이 사라졌다(백오프로 다시 붙는다).
pub(super) const REASON_EXIT: &str = "exit";
const REASON_ERROR: &str = "error";

pub(super) fn disconnected_message() -> String {
    tr!(
        ko: "서버와의 연결이 끊어졌습니다",
        en: "The connection to the server was lost"
    )
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ExitEvent {
    pub(super) id: u32,
    pub(super) reason: &'static str,
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ShellExit {
    Status(u32),
    Signal(String),
    /// 정돈된 채널 닫힘(Eof/Close) — 일부 sshd 는 `exit-status` 를 아예 안 보내므로 이것도 정상 종료 증거다.
    /// 전송로가 죽으면 채널 메시지 자체가 오지 않아 끊김과 혼동되지 않는다.
    Closed,
}

/// 셸 종료 증거가 있으면 정상 종료다 — 전송 오류가 함께 와도 증거가 이긴다(아니면 사용자가 닫은 셸을 앱이 다시 연다).
pub(super) fn classify_exit(
    id: u32,
    shell: Option<ShellExit>,
    failure: Option<String>,
) -> ExitEvent {
    let (reason, message) = match shell {
        Some(ShellExit::Status(0)) | Some(ShellExit::Closed) => (REASON_EXIT, None),
        Some(ShellExit::Status(code)) => (
            REASON_EXIT,
            Some(tr!(ko: "종료 코드 {code}", en: "Exit code {code}")),
        ),
        Some(ShellExit::Signal(sig)) => (
            REASON_EXIT,
            Some(tr!(ko: "신호 {sig} 로 종료", en: "Terminated by signal {sig}")),
        ),
        None => (
            REASON_ERROR,
            Some(failure.unwrap_or_else(disconnected_message)),
        ),
    };
    ExitEvent {
        id,
        reason,
        message,
    }
}

/// sshd 마다 순서가 다르다 — 약한 증거(`Closed`)는 빈 자리만 채우고 강한 증거(status/signal)는 약한 것을 교체한다.
pub(super) fn merge_shell_evidence(
    current: Option<ShellExit>,
    incoming: ShellExit,
) -> Option<ShellExit> {
    match (&current, &incoming) {
        (None, _) => Some(incoming),
        (Some(ShellExit::Closed), ShellExit::Status(_) | ShellExit::Signal(_)) => Some(incoming),
        _ => current,
    }
}

pub(super) fn describe_disconnect(err: Option<&russh::Error>, keepalive_max: usize) -> String {
    match err {
        None => tr!(
            ko: "서버가 연결을 끊었습니다",
            en: "The server closed the connection"
        ),
        Some(russh::Error::KeepaliveTimeout) => tr!(
            ko: "서버 무응답 (keepalive {keepalive_max}회 초과)",
            en: "No answer from the server (keepalive exceeded {keepalive_max} times)"
        ),
        Some(russh::Error::HUP) => disconnected_message(),
        Some(e) => format!("{}: {e}", disconnected_message()),
    }
}

/// 종료는 채널 닫힘과 `disconnected` 두 경로로 온다 — `fired` 로 정확히 한 번. `id == 0` 이면 프런트가 모르는 세션이라 이벤트가 없다.
/// `shell` 은 어느 경로가 먼저 `fire` 하든 판정이 같아지도록 펌프가 증거를 보는 즉시 적어 두는 자리다.
pub(crate) struct ExitSignal {
    id: AtomicU32,
    fired: AtomicBool,
    shell: Mutex<Option<ShellExit>>,
    /// 헤드리스 위임 세션의 정리 통로 — 동기 작업만 한다(`.await` 없음).
    on_exit: Option<Box<dyn Fn() + Send + Sync>>,
}

impl Default for ExitSignal {
    fn default() -> Self {
        Self::new()
    }
}

impl ExitSignal {
    pub(crate) fn new() -> Self {
        Self::new_with_hook(None)
    }

    pub(crate) fn new_with_hook(on_exit: Option<Box<dyn Fn() + Send + Sync>>) -> Self {
        ExitSignal {
            id: AtomicU32::new(0),
            fired: AtomicBool::new(false),
            shell: Mutex::new(None),
            on_exit,
        }
    }

    pub(super) fn bind(&self, id: u32) {
        self.id.store(id, Ordering::SeqCst);
    }

    pub(super) fn note_shell_exit(&self, exit: ShellExit) {
        if let Ok(mut slot) = self.shell.lock() {
            *slot = merge_shell_evidence(slot.take(), exit);
        }
    }

    fn fire(&self, failure: Option<String>) {
        // 중복 방지를 id 와 무관하게 먼저 건다 — 훅도 이벤트도 정확히 한 번이어야 한다.
        if self.fired.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(hook) = &self.on_exit {
            hook();
        }
        let id = self.id.load(Ordering::SeqCst);
        if id == 0 {
            return;
        }
        let shell = self.shell.lock().ok().and_then(|mut slot| slot.take());
        // 마감은 비동기로 — 이 함수는 펌프 태스크·전송로 핸들러에서 동기로 불린다.
        let event = classify_exit(id, shell, failure);
        tokio::spawn(super::session::finish_exit(event));
    }
}

impl ExitTarget for ExitSignal {
    fn fire(&self, failure: Option<String>) {
        ExitSignal::fire(self, failure);
    }
}

// ── Handler ──

/// `check_server_key` 는 async 콜백이고 Handler 는 `connect` 가 소유한다 — 거부 사유는 공유 슬롯으로 꺼내 읽는다.
pub(super) enum RejectReason {
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    Changed {
        fingerprint: String,
        key_type: String,
        old_fingerprint: Option<String>,
    },
    Failed(String),
}

pub(crate) struct SshHandler {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) decision: Option<HostKeyDecision>,
    pub(super) strict: StrictHostKeyChecking,
    pub(super) no_host_key_store: bool,
    pub(super) auto_accepted: Arc<AtomicBool>,
    pub(super) changed_accepted: Arc<AtomicBool>,
    pub(super) keepalive_max: usize,
    pub(super) server_version: Arc<Mutex<Option<String>>>,
    pub(super) reject: Arc<Mutex<Option<RejectReason>>>,
    /// 전송로의 종료 신호 — 올라탄 세션 전부에 퍼진다.
    pub(super) exit: Arc<TransportSignal>,
    /// 원격 포워드(-R) 채널이 어느 포워드의 것인지 가르는 열쇠의 절반 — 세션 id 로는 못 가른다(한 전송로가 여러 세션을 태운다).
    pub(super) transport_id: u64,
}

static NEXT_TRANSPORT_ID: AtomicU64 = AtomicU64::new(1);

pub(super) fn next_transport_id() -> u64 {
    NEXT_TRANSPORT_ID.fetch_add(1, Ordering::Relaxed)
}

impl SshHandler {
    fn record(&self, reason: RejectReason) {
        if let Ok(mut slot) = self.reject.lock() {
            *slot = Some(reason);
        }
    }

    /// 기록에 실패하면 통과시키지 않는다.
    fn learn_or_reject(&self, key: &russh::keys::PublicKey) -> Result<bool, russh::Error> {
        if self.no_host_key_store {
            return Ok(true);
        }
        match known_hosts::learn(&self.host, self.port, key) {
            Ok(()) => Ok(true),
            Err(e) => {
                self.record(RejectReason::Failed(e));
                Ok(false)
            }
        }
    }
}

/// 제어 문자는 떨어뜨린다 — 서버가 보내는 문자열이 말풍선에 그대로 들어간다.
pub(super) fn short_server_version(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return None;
    }
    Some(
        cleaned
            .strip_prefix("SSH-2.0-")
            .map(str::to_string)
            .unwrap_or(cleaned),
    )
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// 러시가 배너를 밖으로 내는 자리는 여기뿐이다. 암호 재료(`shared_secret`)는 보지 않는다.
    async fn kex_done(
        &mut self,
        _shared_secret: Option<&[u8]>,
        _names: &russh::Names,
        session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let raw = String::from_utf8_lossy(session.remote_sshid()).to_string();
        if let (Ok(mut slot), Some(short)) =
            (self.server_version.lock(), short_server_version(&raw))
        {
            *slot = Some(short);
        }
        Ok(())
    }

    /// 두 완화(`no` · `accept-new`)는 사용자가 자기 `~/.ssh/config` 에 적었을 때만 켜진다 — 앱이 스스로 완화하는 경로는 없고,
    /// 켜진 세션은 터미널에 한 줄이 뜬다([`security_notices`]).
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if self.strict.skips_verification() {
            return Ok(true);
        }

        let key = known_hosts::extract_public_key(server_public_key);

        match known_hosts::check(&self.host, self.port, &key) {
            Ok(HostKeyStatus::Known) => Ok(true),
            Ok(HostKeyStatus::Unknown {
                fingerprint,
                key_type,
            }) => {
                let auto = self.strict.auto_accepts_new();
                let Some(decision) = self.decision else {
                    if !auto {
                        self.record(RejectReason::Unknown {
                            fingerprint,
                            key_type,
                        });
                        return Ok(false);
                    }
                    self.auto_accepted.store(true, Ordering::SeqCst);
                    return self.learn_or_reject(&key);
                };
                if auto {
                    self.auto_accepted.store(true, Ordering::SeqCst);
                }
                if !decision.records_unknown() {
                    return Ok(true);
                }
                self.learn_or_reject(&key)
            }
            Ok(HostKeyStatus::Changed {
                fingerprint,
                key_type,
                old_fingerprint,
            }) => {
                // `accept-new` 로도 `trust` 로도 뚫리지 않는다 — 사람이 바뀐 키를 보고 고른 `once`·`replace` 만 지나간다.
                if !self.decision.is_some_and(HostKeyDecision::accepts_changed) {
                    self.record(RejectReason::Changed {
                        fingerprint,
                        key_type,
                        old_fingerprint,
                    });
                    return Ok(false);
                }
                self.changed_accepted.store(true, Ordering::SeqCst);
                if self.decision != Some(HostKeyDecision::Replace) || self.no_host_key_store {
                    return Ok(true);
                }
                match known_hosts::replace(&self.host, self.port, &key) {
                    Ok(_) => Ok(true),
                    Err(e) => {
                        self.record(RejectReason::Failed(e));
                        Ok(false)
                    }
                }
            }
            Err(e) => {
                self.record(RejectReason::Failed(e));
                Ok(false)
            }
        }
    }

    /// 기다리지 않는다 — 세션 루프 안에서 돌아 오래 붙들면 같은 전송로의 모든 채널(옆 타일의 셸 포함)이 멈춘다.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        crate::port_forward::accept_remote(self.transport_id, connected_port, channel, reply);
        Ok(())
    }

    /// 러시의 기본 구현은 무조건 accept 다 — 빼면 에이전트 포워딩 옵트인이 뚫린다. 이 전송로에 포워딩을 켠 세션이 하나라도
    /// 있을 때만 받는다(전송로 단위 — 알고 받은 한계). 기다리지 않는다(위 훅과 같은 이유).
    async fn server_channel_open_agent_forward(
        &mut self,
        channel: russh::Channel<Msg>,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        crate::agent_forward::accept(self.transport_id, channel, reply);
        Ok(())
    }

    /// `exit` 직후 서버가 끊는 경우도 여기로 온다 — 판정은 [`classify_exit`] 에 맡기고 사유 문구만 넘긴다.
    async fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        match reason {
            DisconnectReason::ReceivedDisconnect(_) => {
                self.exit
                    .fire(Some(describe_disconnect(None, self.keepalive_max)));
                Ok(())
            }
            DisconnectReason::Error(e) => {
                self.exit
                    .fire(Some(describe_disconnect(Some(&e), self.keepalive_max)));
                Err(e)
            }
        }
    }
}
