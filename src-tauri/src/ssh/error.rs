//! 접속 실패의 프런트 계약 · 실패 분류 · 호스트 키 다이얼로그의 답.
//!
//! 불변식: `message` 에는 비밀번호가 절대 실리지 않는다(`Debug` 로 찍어도 새지 않는다).

use super::*;

/// 프런트 계약 — `kind` 는 프런트가 할 일(모달 · 재시도 · 끝)이고, 진단은 그것과 직교하는 `diag`([`OpenDiag`])다.
/// `kind` 를 늘리면 재시도 계약이 흔들린다. 호스트 키 거부의 `host`/`port` 는 별칭이 아니라 실제로 붙으려던 곳이다.
/// 바뀐 키의 기본값은 거부다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshOpenError {
    HostKeyUnknown {
        fingerprint: String,
        key_type: String,
        host: String,
        port: u16,
        no_store: bool,
    },
    HostKeyChanged {
        fingerprint: String,
        key_type: String,
        host: String,
        port: u16,
        no_store: bool,
        old_fingerprint: Option<String>,
    },
    PasswordRequired {
        message: String,
        diag: OpenDiag,
        /// 금고에 담겨 있던 비밀번호가 거부됐다 — 값은 실리지 않는다.
        stored_rejected: bool,
    },
    /// 다이얼로그 계약이라 `message` · `diag` 가 없다(문구는 프런트 사전). `path` 는 전체 경로여야 한다 — 재시도의
    /// `passphrase_for` 가 어느 후보의 암호구인지 가르는 열쇠다. 암호구 자체는 어디에도 실리지 않는다.
    PassphraseRequired {
        path: String,
        fingerprint: Option<String>,
        wrong: bool,
        /// 금고의 암호구로 열리지 않았다(`wrong` 은 사람이 방금 친 것이 틀렸다는 뜻 — 다르다).
        stored_rejected: bool,
    },
    Auth {
        message: String,
        diag: OpenDiag,
    },
    Other {
        message: String,
        diag: OpenDiag,
    },
}

/// 프런트가 분기하는 기계용 코드 — 언어를 타지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenCause {
    Dns,
    TcpRefused,
    TcpTimeout,
    TcpUnreachable,
    /// 에이전트 키든 파일 키든 낸 것이 거부된 자리.
    AuthKeyRejected,
    /// 잠긴 키는 여기가 아니다 — [`SshOpenError::PassphraseRequired`] 로 간다.
    KeyFileUnreadable,
    AuthPasswordRejected,
    AuthNoMethod,
    BannerOrProtocol,
    /// 안쪽 사유는 [`OpenDiag::inner`] 에 있다.
    Jump,
    Other,
}

/// `false` 인 플래그는 계약에서 빼 둔다 — 옛 페이로드와 모양이 같아야 프런트가 갈라지지 않는다.
fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OpenDiag {
    pub cause: OpenCause,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<OpenCause>,
    /// 사유가 아니라 플래그다 — 바꾸는 것은 힌트 꼬리뿐이고, 사유를 늘리면 프런트의 분기표가 갈라진다.
    #[serde(default, skip_serializing_if = "is_false")]
    pub identities_only: bool,
    /// 물을 자리가 없는 경로([`KeyUnlock::Skip`])에서만 참이다.
    #[serde(default, skip_serializing_if = "is_false")]
    pub locked_identity: bool,
}

impl OpenDiag {
    pub(crate) fn of(cause: OpenCause) -> Self {
        OpenDiag {
            cause,
            jump: None,
            inner: None,
            identities_only: false,
            locked_identity: false,
        }
    }

    pub(super) fn with_identities_only(mut self, on: bool) -> Self {
        self.identities_only = on;
        self
    }

    pub(super) fn with_locked_identity(mut self, on: bool) -> Self {
        self.locked_identity = on;
        self
    }

    pub(super) fn at_jump(self, label: &str) -> Self {
        OpenDiag {
            cause: OpenCause::Jump,
            jump: Some(label.to_string()),
            inner: Some(if self.cause == OpenCause::Jump {
                self.inner.unwrap_or(OpenCause::Other)
            } else {
                self.cause
            }),
            // 플래그는 안쪽 사실이라 접어도 살아남는다.
            identities_only: self.identities_only,
            locked_identity: self.locked_identity,
        }
    }
}

impl SshOpenError {
    pub(crate) fn other(message: impl Into<String>) -> Self {
        SshOpenError::other_with(OpenCause::Other, message)
    }

    pub(crate) fn other_with(cause: OpenCause, message: impl Into<String>) -> Self {
        SshOpenError::Other {
            message: message.into(),
            diag: OpenDiag::of(cause),
        }
    }

    pub(crate) fn auth(message: impl Into<String>) -> Self {
        SshOpenError::auth_with(OpenCause::AuthNoMethod, message)
    }

    pub(crate) fn auth_with(cause: OpenCause, message: impl Into<String>) -> Self {
        SshOpenError::Auth {
            message: message.into(),
            diag: OpenDiag::of(cause),
        }
    }

    pub(crate) fn password_required(message: impl Into<String>) -> Self {
        SshOpenError::password_required_with(OpenCause::AuthPasswordRejected, message)
    }

    pub(crate) fn password_required_with(cause: OpenCause, message: impl Into<String>) -> Self {
        SshOpenError::PasswordRequired {
            message: message.into(),
            diag: OpenDiag::of(cause),
            stored_rejected: false,
        }
    }

    pub(crate) fn stored_password_rejected() -> Self {
        SshOpenError::PasswordRequired {
            message: wrong_password(),
            diag: OpenDiag::of(OpenCause::AuthPasswordRejected),
            stored_rejected: true,
        }
    }
}

// ── 실패 분류 ──

/// 이름이 안 풀리는 것은 `ErrorKind` 로 올라오지 않는다(`Uncategorized`) — Windows 는 OS 숫자를, 유닉스는 std 문구로 가른다.
pub(super) const WSA_HOST_NOT_FOUND: i32 = 11001;
pub(super) const WSA_NO_DATA: i32 = 11004;

/// 셋을 따로 받는 이유는 테스트다 — `io::Error` 를 OS 별로 만들지 않아도 된다.
pub(super) fn classify_io(kind: std::io::ErrorKind, raw: Option<i32>, message: &str) -> OpenCause {
    use std::io::ErrorKind as K;
    if raw == Some(WSA_HOST_NOT_FOUND)
        || raw == Some(WSA_NO_DATA)
        || message.contains("failed to lookup address information")
    {
        return OpenCause::Dns;
    }
    match kind {
        K::ConnectionRefused => OpenCause::TcpRefused,
        K::TimedOut => OpenCause::TcpTimeout,
        K::HostUnreachable | K::NetworkUnreachable | K::NetworkDown => OpenCause::TcpUnreachable,
        // connect 는 RST 를 거부로 준다 — 여기서는 TCP 가 이미 섰고 배너를 읽는 중에 끊겼다.
        K::ConnectionReset | K::ConnectionAborted | K::UnexpectedEof => OpenCause::BannerOrProtocol,
        _ => OpenCause::Other,
    }
}

/// 전송로를 세우는 동안의 실패만 본다 — 인증 뒤의 끊김은 [`describe_disconnect`] 의 몫이다.
pub(super) fn classify_connect(e: &russh::Error) -> OpenCause {
    use russh::Error as E;
    match e {
        E::IO(io) => classify_io(io.kind(), io.raw_os_error(), &io.to_string()),
        E::ConnectionTimeout | E::Elapsed(_) => OpenCause::TcpTimeout,
        E::Version
        | E::KexInit
        | E::Kex
        | E::NoCommonAlgo { .. }
        | E::PacketAuth
        | E::PacketSize(_)
        | E::Inconsistent
        | E::StrictKeyExchangeViolation { .. }
        | E::HUP => OpenCause::BannerOrProtocol,
        E::NoAuthMethod => OpenCause::AuthNoMethod,
        _ => OpenCause::Other,
    }
}

/// 전송 단계와 표를 나눈다 — 인증 중의 `HUP` 는 `MaxAuthTries` 로 끊은 것이라 `banner_or_protocol` 로 부르면 힌트가 엉뚱해진다.
pub(super) fn classify_auth(e: &russh::Error) -> OpenCause {
    match e {
        russh::Error::NoAuthMethod => OpenCause::AuthNoMethod,
        _ => OpenCause::Other,
    }
}

// ── 호스트 키 다이얼로그의 답 ──

/// 사람이 그 자리에서 답했을 때만 온다 — `None`(기본)은 거부다. 헤드리스 접속은 언제나 `None` 이라
/// 미상 키도 바뀐 키도 자동으로 통과하지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyDecision {
    /// 미상 키 전용.
    Trust,
    Once,
    /// 변경 키 전용. `no_store` 호스트에서는 기록하지 않고 [`Once`] 처럼 지나간다.
    Replace,
}

impl HostKeyDecision {
    pub(super) fn records_unknown(self) -> bool {
        matches!(self, HostKeyDecision::Trust | HostKeyDecision::Replace)
    }

    /// `trust` 로는 뚫리지 않는다 — 미상 키 수락을 바뀐 키 통과로 읽으면 재시도 한 번으로 MITM 경고가 사라진다.
    pub(super) fn accepts_changed(self) -> bool {
        matches!(self, HostKeyDecision::Once | HostKeyDecision::Replace)
    }
}
