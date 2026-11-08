//! russh 클라이언트 핸들러와 세션 종료 알림 — [`SshHandler`](호스트 키 검증 콜백 ·
//! 서버가 여는 채널) · [`ExitSignal`]/[`classify_exit`](`ssh-exit` **정확히 한 번**) ·
//! 보안 완화 안내 문구.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::client::{self, DisconnectReason, Msg};
use russh::keys::PublicKeyOrCertificate;


use crate::i18n::tr;
use crate::known_hosts::{self, HostKeyStatus};
use crate::ssh_config::StrictHostKeyChecking;
use crate::ssh_pool::{ExitTarget, TransportSignal};

use super::*;

// ---------------------------------------------------------------------------
// 보안 완화 가시화
// ---------------------------------------------------------------------------

/// 호스트 키 검증이 꺼진 세션에 흘리는 경고 (노란색).
///
/// 완화가 **조용히** 일어나면 안 된다 — 사용자가 config 에 적은 것이라 해도, 그 세션이
/// 지금 중간자 공격을 탐지할 수 없다는 사실은 화면에 남아 있어야 한다.
pub(super) fn strict_off_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 이 세션은 호스트 키 검증이 꺼져 있습니다 (StrictHostKeyChecking no)\x1b[0m\r\n",
        en: "\x1b[33m⚠ Host key verification is off for this session (StrictHostKeyChecking no)\x1b[0m\r\n"
    )
}

/// `accept-new` 가 처음 보는 키를 모달 없이 받아들였을 때의 알림 (회색).
/// 경고가 아니라 사실 통지다 — 사용자가 그렇게 적어 둔 대로 동작한 것이다.
pub(super) fn accept_new_notice() -> String {
    tr!(
        ko: "\x1b[90m호스트 키를 자동으로 신뢰했습니다 (accept-new)\x1b[0m\r\n",
        en: "\x1b[90mTrusted the host key automatically (accept-new)\x1b[0m\r\n"
    )
}

/// **바뀐 호스트 키**를 사람이 수락하고 들어온 세션에 흘리는 경고 (노란색).
///
/// `accept-new` 알림이 회색인 것과 달리 이쪽은 노랑이다 — 기록된 키가 바뀌었다는 사실은
/// "그렇게 적어 둔 대로 동작했다" 가 아니라 **원래 거부되는 일**이고, 사람이 그 자리에서
/// 한 번 뚫은 것이다. 그 결정이 화면에 남아 있어야 한다.
pub(super) fn changed_accepted_notice() -> String {
    tr!(
        ko: "\x1b[33m⚠ 이 서버의 호스트 키가 바뀌었고 사용자가 수락했습니다\x1b[0m\r\n",
        en: "\x1b[33m⚠ This server's host key changed and you accepted it\x1b[0m\r\n"
    )
}

/// 셸이 서자마자 터미널에 흘릴 알림 줄들 — **순수 함수** (유닛 테스트 대상).
///
/// 프런트 수정 없이 터미널에 보이게 하려고 **출력 배칭 채널에 직접 쓴다** (원격 바이트와
/// 같은 경로). 그래서 `on_connect` 전송보다 먼저, 펌프 태스크를 띄우기 전에 넣어야
/// 큐의 맨 앞에 선다.
///
/// 홉이 여럿이면 "이 세션" 은 그중 가장 약한 고리다 — 점프에서 검증이 꺼져 있어도
/// 대상까지 가는 길 전체가 검증되지 않은 것이므로 경고를 낸다.
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

// ---------------------------------------------------------------------------
// 세션 종료 알림
// ---------------------------------------------------------------------------

/// `ssh-exit` 의 `reason` — 프런트가 **자동 재연결 여부를 가르는 유일한 값**이다
/// (docs/log/2026-09-01-reconnect.md).
///
/// - `"exit"`: 원격 셸이 스스로 끝났다 (사용자가 `exit` 를 쳤거나 신호로 죽었다).
///   재연결하면 **안 된다** — 사용자가 닫은 셸을 되살리는 꼴이다.
/// - `"error"`: 셸이 끝났다는 증거 없이 연결이 사라졌다 (keepalive 무응답·소켓 오류·
///   서버가 먼저 끊음). 프런트가 백오프로 다시 붙는다.
pub(super) const REASON_EXIT: &str = "exit";
const REASON_ERROR: &str = "error";

/// 셸 종료 증거가 없을 때의 기본 문구.
pub(super) fn disconnected_message() -> String {
    tr!(
        ko: "서버와의 연결이 끊어졌습니다",
        en: "The connection to the server was lost"
    )
}

/// `ssh-exit` 이벤트 페이로드.
///
/// ```json
/// { "id": 3, "reason": "exit",  "message": null }
/// { "id": 3, "reason": "exit",  "message": "종료 코드 130" }
/// { "id": 3, "reason": "error", "message": "서버 무응답 (keepalive 3회 초과)" }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct ExitEvent {
    pub(super) id: u32,
    pub(super) reason: &'static str,
    /// 사람이 읽을 한 줄. 코드 0 정상 종료면 없다.
    pub(super) message: Option<String>,
}

/// 원격 셸이 **스스로** 끝났다는 증거. 채널이 알려 준 것만 여기 들어온다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ShellExit {
    Status(u32),
    Signal(String),
    /// 서버가 채널을 **정돈되게** 닫았다 (Eof/Close 메시지 수신). 일부 sshd 는
    /// `exit-status` 를 아예 안 보내므로 (실기: 사내망 1220 서버) 이것도 정상 종료
    /// 증거다. 전송로가 죽으면 채널 메시지 자체가 오지 않아 (`wait()` → `None`)
    /// 이 증거가 생기지 않는다 — 그래서 끊김과 혼동될 일이 없다.
    Closed,
}

/// 종료 사유 판정 — **순수 함수** (유닛 테스트 대상).
///
/// 규칙은 하나다: **셸이 끝났다는 증거가 있으면 정상 종료**, 없으면 오류다.
/// 증거는 채널의 `exit-status` / `exit-signal`, 그리고 정돈된 채널 닫힘([`ShellExit::Closed`]) 이다.
/// 전송 계층 오류(`failure`)가 함께 와도 증거가 이긴다 — `exit` 직후 서버가 연결을 끊으면
/// 둘 다 도착하는데, 그때 오류로 판정하면 사용자가 닫은 셸을 앱이 다시 열어 버린다.
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

/// 셸 종료 증거 병합 — **순수 함수** (유닛 테스트 대상).
///
/// 증거에는 강약이 있다: `exit-status`/`exit-signal`(코드·신호 정보 있음) > `Closed`(닫혔다는
/// 사실뿐). sshd 마다 순서가 달라 — status→Eof 도, Eof→status 도 있다 — **약한 증거는
/// 빈 자리만 채우고, 강한 증거는 약한 것을 교체**한다. 강한 증거끼리는 먼저 온 것 유지.
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

/// 전송 계층이 끝난 사유를 사용자용 한 줄로 — **순수 함수** (유닛 테스트 대상).
///
/// `err` 가 `None` 이면 서버가 `SSH_MSG_DISCONNECT` 를 보내고 정상적으로 끊은 것이다
/// (sshd 재시작·관리자 종료). 어느 쪽이든 **셸이 끝난 것은 아니므로** 재연결 대상이다.
pub(super) fn describe_disconnect(err: Option<&russh::Error>, keepalive_max: usize) -> String {
    match err {
        None => tr!(
            ko: "서버가 연결을 끊었습니다",
            en: "The server closed the connection"
        ),
        // 우리가 가장 자주 만나는 경로 — 와이파이 전환·절전 복귀·케이블 뽑힘.
        Some(russh::Error::KeepaliveTimeout) => tr!(
            ko: "서버 무응답 (keepalive {keepalive_max}회 초과)",
            en: "No answer from the server (keepalive exceeded {keepalive_max} times)"
        ),
        Some(russh::Error::HUP) => disconnected_message(),
        Some(e) => format!("{}: {e}", disconnected_message()),
    }
}

/// `ssh-exit` 이벤트를 정확히 한 번만 쏘기 위한 공유 상태.
///
/// 종료는 두 경로로 감지된다 — 채널이 닫히는 것(원격 셸 exit)과
/// [`client::Handler::disconnected`](끊김/keepalive 타임아웃). 둘 다 발생할 수 있으므로
/// `fired` 로 중복을 막는다. `id` 는 connect 가 성공한 뒤에야 정해지므로
/// 0(미할당)이면 아직 프런트가 모르는 세션이라 이벤트를 보내지 않는다.
///
/// `shell` 은 **먼저 도착한 증거를 기억해 두는 자리**다. 어느 경로가 먼저 `fire` 하든
/// 판정이 같아지도록 펌프가 `exit-status` 를 보는 즉시 여기에 적어 둔다.
pub(crate) struct ExitSignal {
    id: AtomicU32,
    fired: AtomicBool,
    shell: Mutex<Option<ShellExit>>,
    /// **백엔드 종료 훅** — id 를 bind 하지 않는(프런트가 없는) 헤드리스 위임 세션의 정리 통로다.
    /// [`fire`](Self::fire) 가 `fired` 중복 방지 **뒤에** 한 번만 부른다. 창 세션은 이것이 `None`
    /// 이고 이벤트만 쏜다. 훅은 동기 작업만 한다(락 잡고 필드 대입 — `.await` 없음).
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

    /// 종료 시 부를 백엔드 훅을 실은 생성자. `connect_transport` 에 넘기기 **전에** 한 번 정한다.
    /// 훅이 `Some` 이면 `id==0`(unbound)이어도 [`fire`](Self::fire) 가 그것을 부른다 — 헤드리스
    /// 드롭을 백엔드에서 거두는 유일한 경로다(이벤트는 여전히 id 가 있을 때만 나간다).
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

    /// 채널이 셸 종료를 알려 왔다 — 판정 재료로 기억해 둔다 (이벤트는 아직 쏘지 않는다).
    /// 병합 규칙은 [`merge_shell_evidence`] 참조.
    pub(super) fn note_shell_exit(&self, exit: ShellExit) {
        if let Ok(mut slot) = self.shell.lock() {
            *slot = merge_shell_evidence(slot.take(), exit);
        }
    }

    /// `failure` 는 전송 계층이 오류로 끝났을 때의 설명. 펌프 쪽에서는 `None`.
    fn fire(&self, failure: Option<String>) {
        // **중복 방지를 id 와 무관하게 먼저** 건다 — 훅도 이벤트도 정확히 한 번이어야 한다.
        // (예전엔 `id==0` 이 `||` 로 swap 을 건너뛰어, 헤드리스는 fired 를 세우지 않았다.)
        if self.fired.swap(true, Ordering::SeqCst) {
            return;
        }
        // 백엔드 정리 훅 — 헤드리스(id==0, 훅 있음)는 여기서 라우팅·거울을 거둔다. 동기 작업뿐이다.
        if let Some(hook) = &self.on_exit {
            hook();
        }
        // 창 세션(id 세팅됨, 훅 없음)은 오늘과 **똑같이** `ssh-exit` 이벤트를 쏜다. id==0(헤드리스)이면
        // 프런트가 없으니 이벤트는 없다 — 훅만 돌고 끝난다.
        let id = self.id.load(Ordering::SeqCst);
        if id == 0 {
            return;
        }
        let shell = self.shell.lock().ok().and_then(|mut slot| slot.take());
        // 종료 마감(마지막 배치 → 코어 `Exited`/`Disconnected` → `ssh-exit` → 자원 회수)은 비동기로 —
        // 이 함수는 펌프 태스크·전송로 핸들러에서 동기로 불린다(`super::session::finish_exit`). 세션 서버의 런타임 위다
        // (펌프·러시 핸들러 모두 그 런타임의 태스크 — ③-3b2).
        let event = classify_exit(id, shell, failure);
        tokio::spawn(super::session::finish_exit(event));
    }
}

/// 전송로의 죽음이 **이 세션 하나**에 닿는 통로
/// ([`crate::ssh_pool::TransportSignal`] 이 부른다 — 연결 공유가 생기면서 한 전송로에
/// 세션이 여럿 걸리기 때문이다. 셸 종료 증거와 "정확히 한 번" 은 여전히 세션마다다).
impl ExitTarget for ExitSignal {
    fn fire(&self, failure: Option<String>) {
        ExitSignal::fire(self, failure);
    }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// `check_server_key` 가 false 를 돌려준 이유. connect 실패 후 꺼내 읽는다.
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
    /// known_hosts 를 읽거나 쓰지 못했다.
    Failed(String),
}

pub(crate) struct SshHandler {
    pub(super) host: String,
    pub(super) port: u16,
    /// 사람이 다이얼로그에서 고른 것 — `None` 이면 아무도 묻지 않았다(= 거부).
    pub(super) decision: Option<HostKeyDecision>,
    /// 이 홉의 `StrictHostKeyChecking` (config 에 없으면 `Yes`).
    pub(super) strict: StrictHostKeyChecking,
    /// 이 홉의 `UserKnownHostsFile /dev/null` — 수락해도 기록하지 않는다.
    pub(super) no_host_key_store: bool,
    /// `accept-new` 가 처음 보는 키를 **모달 없이** 받아들였다. 셸이 서면 회색 한 줄로 알린다.
    /// (`check_server_key` 는 connect 가 소유한 Handler 안에서 돌기 때문에
    /// `reject` 슬롯과 같은 이유로 공유 플래그가 필요하다.)
    pub(super) auto_accepted: Arc<AtomicBool>,
    /// **바뀐 키를 사람이 수락했다** (`once` 또는 `replace`). 셸이 서면 노란 한 줄로 알린다 —
    /// 이 완화는 화면에 흔적이 남아야 한다 (`auto_accepted` 와 같은 자리·같은 이유).
    pub(super) changed_accepted: Arc<AtomicBool>,
    /// keepalive 타임아웃 문구에 실을 `ServerAliveCountMax` (표시 전용).
    pub(super) keepalive_max: usize,
    /// **서버가 배너로 보낸 자기 소개** (`SSH-2.0-OpenSSH_9.6p1 …`) — 키 교환이 끝나는
    /// 순간 [`client::Handler::kex_done`] 이 적는다. `reject` 슬롯과 같은 이유로 공유
    /// 슬롯이다: Handler 는 `connect` 가 소유해 버려 밖에서 들여다볼 길이 없다.
    pub(super) server_version: Arc<Mutex<Option<String>>>,
    pub(super) reject: Arc<Mutex<Option<RejectReason>>>,
    /// **전송로의** 종료 신호 — 이 연결 위에 올라탄 세션 **전부**에 퍼진다
    /// (연결 공유: [`crate::ssh_pool::TransportSignal`]). 예전에는 세션 하나짜리
    /// `ExitSignal` 이 그대로 여기 있었다.
    pub(super) exit: Arc<TransportSignal>,
    /// **이 전송로의 번호** ([`next_transport_id`]) — 원격 포워드(-R)의 채널이 도착했을 때
    /// 어느 포워드의 것인지 가르는 열쇠의 절반이다 ([`crate::port_forward::accept_remote`]).
    /// 세션 id 로는 못 가른다: 연결 공유 이후 한 전송로가 여러 세션을 태운다.
    pub(super) transport_id: u64,
}

/// 전송로 번호 발급기 — 홉 하나를 세울 때마다 하나씩 뽑는다 (0 은 쓰지 않는다).
static NEXT_TRANSPORT_ID: AtomicU64 = AtomicU64::new(1);

/// 새 전송로 번호. 앱이 도는 동안 겹치지 않으면 된다 — 파일에도 IPC 에도 나가지 않는다.
pub(super) fn next_transport_id() -> u64 {
    NEXT_TRANSPORT_ID.fetch_add(1, Ordering::Relaxed)
}

impl SshHandler {
    fn record(&self, reason: RejectReason) {
        if let Ok(mut slot) = self.reject.lock() {
            *slot = Some(reason);
        }
    }

    /// 처음 보는 키를 기록하고 통과 — 기록에 실패하면 통과시키지 않는다.
    /// `UserKnownHostsFile /dev/null` 이면 수락은 하되 기록만 생략한다.
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

/// `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5` → `OpenSSH_9.6p1 Ubuntu-3ubuntu13.5`
/// — **순수 함수** (유닛 테스트 대상).
///
/// 접두사(`SSH-2.0-`)는 프로토콜 버전이라 모든 서버에서 같다. 한 줄짜리 말풍선에서
/// 그 여덟 글자는 자리만 차지한다. 모양이 다르면(SSH-1.99 등) **손대지 않는다**.
/// 제어 문자는 떨어뜨린다 — 서버가 보내는 문자열이고 말풍선에 그대로 들어간다.
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

    /// 키 교환이 끝났다 — **서버 배너를 여기서 줍는다**.
    ///
    /// 러시가 배너를 밖으로 내는 자리는 여기뿐이다(`Session::remote_sshid`). 재키교환에서도
    /// 불리지만 같은 값이라 덮어써도 무해하다. 암호 재료(`shared_secret`)는 **보지 않는다**.
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

    /// **보안 원칙**: 아래 두 완화(`StrictHostKeyChecking no` · `accept-new`)는
    /// **사용자가 자기 `~/.ssh/config` 의 그 호스트 블록에 직접 적었을 때만** 켜진다.
    /// 앱의 기본값은 언제나 검증이고, 앱이 스스로 완화를 켜는 경로는 없다.
    /// 완화가 켜진 세션은 조용히 넘어가지 않는다 — 셸이 서면 터미널에 한 줄이 뜬다
    /// ([`security_notices`]).
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // `no`: known_hosts 를 **보지도 쓰지도 않는다**. rustdesk 터널처럼 같은
        // localhost:port 뒤의 머신이 바뀌는 호스트를 위한 탈출구 (docs/log/2026-09-02-strict-host-key.md).
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
                // 통과 사유는 둘 중 하나다: config 의 `accept-new`(자동), 또는 사용자가
                // 지문 다이얼로그에서 고른 것([`HostKeyDecision`]).
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
                // `once` 는 통과만 하고 파일을 건드리지 않는다 — 다음 접속에 다시 묻는다.
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
                // MITM 경고. `accept-new` 로도, `trust`(미상 키 수락)로도 뚫리지 않는다
                // (OpenSSH 의 accept-new 와 정확히 같다 — config 로 뚫리는 값은 `no` 뿐이다).
                // 사람이 바뀐 키를 **보고** 고른 `once`·`replace` 만 지나간다.
                if !self.decision.is_some_and(HostKeyDecision::accepts_changed) {
                    self.record(RejectReason::Changed {
                        fingerprint,
                        key_type,
                        old_fingerprint,
                    });
                    return Ok(false);
                }
                self.changed_accepted.store(true, Ordering::SeqCst);
                // `UserKnownHostsFile none` 이면 갈아 끼울 파일이 없다 — 통과만 한다
                // (프런트도 그 호스트에서는 '갱신' 버튼을 감춘다).
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
            // 검증을 못 했으면 통과시키지 않는다.
            Err(e) => {
                self.record(RejectReason::Failed(e));
                Ok(false)
            }
        }
    }

    /// **서버가 원격 포워드(-R)의 연결 하나를 열었다** — 서버의 `127.0.0.1:<포트>` 에 누가 붙었다.
    ///
    /// 여기서는 기다리지 않는다: 이 훅은 전송로의 세션 루프 안에서 돌기 때문에 오래 붙들면
    /// 같은 전송로의 **모든 채널**(옆 타일의 셸 포함)이 멈춘다. 길 찾기만 하고 로컬 연결·중계는
    /// 포워드 모듈이 태스크로 던진다. 우리가 걸지 않은 포트면 거기서 거절된다.
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

    /// **서버가 에이전트 채널(`auth-agent@openssh.com`)을 열었다** — 서버 안의 프로그램이 이 PC 의
    /// ssh-agent 에게 서명을 부탁한다 (docs/log/2026-09-23-agent-forwarding.md).
    ///
    /// 러시의 기본 구현은 **무조건 accept** 다. 여기서 막는다: 이 전송로 위에 포워딩을 켠
    /// 세션이 **하나라도** 있을 때만 받고(연결 공유 — 전송로 단위), 아니면 `reply` 를 떨어뜨려
    /// 거절한다. 경유 홉은 켜지는 일이 없으므로 언제나 거절이다. 기다리지 않는다(위 훅과 같은 이유).
    async fn server_channel_open_agent_forward(
        &mut self,
        channel: russh::Channel<Msg>,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        crate::agent_forward::accept(self.transport_id, channel, reply);
        Ok(())
    }

    /// 전송 계층이 끝났다 — keepalive 무응답·소켓 오류·서버가 먼저 끊음.
    ///
    /// 여기까지 왔다는 것 자체가 "셸이 끝났다는 증거는 없다" 는 뜻이지만, `exit` 직후
    /// 서버가 연결을 끊는 경우도 이 경로로 들어온다. 그래서 판정은 [`classify_exit`] 에
    /// 맡기고(= 먼저 기록된 `exit-status` 가 이긴다) 여기서는 사유 문구만 만들어 넘긴다.
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
