//! 접속 실패의 계약 — [`SshOpenError`](태그 유니온) · [`OpenCause`]/[`OpenDiag`](진단 축) ·
//! 실패 분류 순수 함수(`classify_*`) · 호스트 키 다이얼로그의 답([`HostKeyDecision`]).
//!
//! 불변식: `message` 에는 비밀번호가 절대 실리지 않는다(`Debug` 로 찍어도 새지 않는다).

use super::*;

/// 세션 열기 실패 사유. 프런트엔드가 분기해야 하므로 문자열이 아니라 태그 유니온이다.
///
/// ```json
/// { "kind": "host_key_unknown", "fingerprint": "SHA256:...", "key_type": "ssh-ed25519",
///   "host": "example.com", "port": 22, "no_store": false }
/// { "kind": "host_key_changed", "fingerprint": "SHA256:...", "key_type": "ssh-ed25519",
///   "host": "example.com", "port": 22, "no_store": false, "old_fingerprint": "SHA256:..." }
/// { "kind": "password_required", "message": "..." }
/// { "kind": "auth",  "message": "..." }
/// { "kind": "other", "message": "..." }
/// ```
///
/// 재시도 계약이 있는 것은 셋이다.
/// - `host_key_unknown`: 프런트가 지문을 보여주고 사용자가 고른 것을
///   `host_key_decision`([`HostKeyDecision`])으로 실어 같은 별칭을 다시 연다.
/// - `host_key_changed`: **2026-09-16 에 재시도 경로가 생겼다.** 예전에는 막다른 길이라
///   사람이 손으로 `known_hosts` 를 열어 줄을 지워야 했다. 지금은 다이얼로그가 옛 지문과 새
///   지문을 나란히 보여 주고, 고른 것이 `once`(기록 없이 통과) 또는 `replace`(그 줄을 갈아
///   끼우고 통과)로 돌아온다. **기본값은 여전히 거부**다.
/// - `password_required`: 프런트가 비밀번호 입력을 받아 `password: "..."` 로 다시 연다.
///   비밀번호가 틀리면 같은 오류가 다시 오므로 프런트가 횟수를 제한한다.
///
/// 호스트 키 거부에 실리는 `host`/`port` 는 **실제로 붙으려던 곳**이다 (별칭이 아니다 —
/// 다이얼로그가 `~/.ssh/config` 를 다시 읽지 않고도 "어디의 키인가" 를 말할 수 있어야 한다).
/// `no_store` 는 `UserKnownHostsFile none` 이라 **기록이 불가능**하다는 뜻이고, 그때
/// 다이얼로그는 기록 계열 선택지(수락(기록)·갱신)를 감춘다.
///
/// `message` 에는 **비밀번호가 절대 들어가지 않는다** (아래 [`wrong_password`] 등 고정 문구와
/// 에이전트 오류만 실린다). `Debug` 로 찍어도 새지 않는다.
///
/// ## `kind` 옆의 `diag` — 재시도 계약과 **직교하는** 진단 축 (2026-09-17)
///
/// `kind` 는 **프런트가 무엇을 해야 하는가**다(모달을 띄워라 · 재시도하라 · 끝났다). 그런데
/// 같은 `other` 안에 "이름이 안 풀린다" 와 "포트가 닫혀 있다" 와 "SSH 서버가 아니다" 가
/// 뒤섞여 있어, 화면이 말할 수 있는 것은 러시가 준 영문 한 줄뿐이었다. 그래서 **갈래를
/// 하나 더 만들지 않고**(`kind` 를 늘리면 재시도 계약이 흔들린다) 옆에 [`OpenDiag`] 를
/// 태운다 — `kind` 는 한 글자도 바뀌지 않았고, 호스트 키 두 변종은 아예 손대지 않았다.
/// 프런트는 `diag.cause` 로 **다음에 할 일**(힌트 한 줄)을 고른다
/// (docs/log/2026-09-17-connect-diagnostics.md).
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
        /// known_hosts 에 적혀 있던 같은 알고리즘 키의 지문 (못 읽었으면 `None`).
        old_fingerprint: Option<String>,
    },
    /// 비밀번호가 필요하거나 방금 넣은 것이 틀렸다 — 프런트가 입력 모달 후 재시도한다.
    PasswordRequired {
        message: String,
        diag: OpenDiag,
        /// **금고에 담겨 있던 비밀번호를 내 봤는데 거부됐다** (2026-09-19 ② ·
        /// docs/log/2026-09-19-vault.md). 모달이 "저장된 비밀번호가 더 이상 맞지 않습니다" 를
        /// 덧붙이고 저장 체크를 미리 켠다 — 사람이 새로 치면 그것이 곧 갱신이다.
        ///
        /// **값은 실리지 않는다** — 실렸다는 사실 하나뿐이다.
        stored_rejected: bool,
    },
    /// **개인키 파일에 암호구가 걸려 있다** (2026-09-19 · docs/log/2026-09-19-identity-file-auth.md).
    ///
    /// 호스트 키 두 변종과 **같은 성질**이라 `message` 도 `diag` 도 없다: 이것은 사람이 읽는
    /// 문구가 아니라 **다이얼로그 계약**이다. 화면이 그릴 글자(제목·파일 이름·"틀렸습니다")는
    /// 전부 프런트 사전이 만든다 — 그래야 그 문구가 언어를 탄다.
    ///
    /// - `path` 는 **전체 경로**다. 화면은 파일 이름만 보여 주지만, 재시도에서 그대로
    ///   `passphrase_for` 로 돌아와 **어느 후보의 암호구인지**를 가르는 열쇠가 되므로 줄이면
    ///   안 된다 (홉을 가리지 않는다 — 경로는 하나뿐이라 경유 호스트의 키도 같은 길로 푼다).
    /// - `fingerprint` 는 짝이 되는 `.pub` 을 읽어 낸 값이다(없으면 `None`). 프런트의
    ///   "이 키를 ssh-agent 에 넣기" 가 나중에 **들어갔는지 묻는** 열쇠로 쓴다.
    /// - `wrong` 은 "방금 넣은 암호구가 틀렸다" — 모달이 그 줄을 덧붙인다.
    ///
    /// **암호구 자체는 이 구조체 어디에도 실리지 않는다** (필드 셋뿐 — 테스트가 못 박는다).
    PassphraseRequired {
        path: String,
        fingerprint: Option<String>,
        wrong: bool,
        /// 금고에 담겨 있던 암호구로 열어 봤는데 열리지 않았다 (`wrong` 과 다르다 —
        /// 저쪽은 **사람이 방금 친 것**이 틀렸다는 뜻이다). 모달이 갱신을 권한다.
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

/// **접속이 왜 실패했는가** — 화면이 "다음에 할 일" 한 줄을 고르는 열쇠.
///
/// 언어를 타지 않는 ASCII 코드다(`errors.rs` 의 이유 접두사와 같은 성질). 사람이 읽는
/// 문구는 따로 있고, 이 값은 **프런트가 분기하는 기계용**이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenCause {
    /// 이름이 풀리지 않았다 (getaddrinfo 실패).
    Dns,
    /// TCP 가 거부됐다 — 포트에 아무도 없다.
    TcpRefused,
    /// TCP 가 응답하지 않는다 — 방화벽이 조용히 버리거나 경로가 없다.
    TcpTimeout,
    /// 호스트·네트워크에 닿을 수 없다.
    TcpUnreachable,
    /// 공개키를 냈는데 서버가 전부 거부했다 — '공개키 설치…' 가 있는 자리.
    /// (에이전트 키든 `IdentityFile` 의 파일 키든 **낸 것이 거부된** 같은 자리다.)
    AuthKeyRejected,
    /// `IdentityFile` 이 가리키는 개인키 파일을 **읽지 못했다** (권한·형식 오류).
    /// 잠긴 키(암호구)는 여기가 아니다 — 그쪽은 [`SshOpenError::PassphraseRequired`] 로 간다.
    KeyFileUnreadable,
    /// 비밀번호가 틀렸다.
    AuthPasswordRejected,
    /// 우리가 가진 방식을 서버가 하나도 받지 않는다.
    AuthNoMethod,
    /// TCP 는 섰는데 SSH 로 말하지 않는다 (버전 교환·KEX 실패 = SSH 포트가 아닐 수 있다).
    BannerOrProtocol,
    /// **경유 호스트 쪽에서** 실패했다 — 안쪽 사유는 [`OpenDiag::inner`] 에 있다.
    Jump,
    /// 위 어디에도 들지 않는다 (채널 거부·PTY 거부·설정 오류 …).
    Other,
}

/// `false` 인 플래그는 계약에서 빼 둔다 — 옛 페이로드와 모양이 같아야 프런트가 갈라지지 않는다.
fn is_false(b: &bool) -> bool {
    !*b
}

/// 진단 한 벌 — `{ cause, jump?, inner?, identities_only? }`.
/// `jump`·`inner` 는 경유 실패에서만 채워진다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OpenDiag {
    pub cause: OpenCause,
    /// 경유 호스트 별칭 (`cause == Jump` 일 때만).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
    /// 경유 쪽에서 실제로 난 사유 (`cause == Jump` 일 때만).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<OpenCause>,
    /// 이 홉이 `IdentitiesOnly yes` 였다 — **지정한 키만** 내고 거절당했다는 뜻이다.
    ///
    /// 사유([`OpenCause`])를 늘리지 않고 플래그로 둔 이유: 무엇이 잘못됐는지는 예나 지금이나
    /// `auth_key_rejected`·`auth_no_method` 그대로이고, 이 값이 바꾸는 것은 **힌트 한 줄의
    /// 꼬리**뿐이다 ("지정한 키만 시도했습니다"). 사유를 늘리면 프런트의 분기표가 갈라진다.
    #[serde(default, skip_serializing_if = "is_false")]
    pub identities_only: bool,
    /// `IdentityFile` 이 **암호구로 잠겨 건너뛰어졌다** (2026-09-22).
    ///
    /// 물을 자리가 없는 경로([`KeyUnlock::Skip`] — 헤드리스 위임 접속·공개키 설치 검증)
    /// 에서만 참이 된다: 사람이 있는 접속은 잠긴 키를 만나면 그 자리에서
    /// [`SshOpenError::PassphraseRequired`] 로 되돌아가므로 여기까지 오지 않는다.
    /// `crate::headless` 의 `headless_locked_key_hint` 가 이 한 칸을 보고 처방 한 줄을 덧붙인다.
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

    /// `IdentitiesOnly` 플래그를 얹는다 — 인증 실패 자리에서만 부른다.
    pub(super) fn with_identities_only(mut self, on: bool) -> Self {
        self.identities_only = on;
        self
    }

    /// "잠긴 `IdentityFile` 을 건너뛰었다" 플래그를 얹는다 — 인증 실패 자리에서만 부른다.
    pub(super) fn with_locked_identity(mut self, on: bool) -> Self {
        self.locked_identity = on;
        self
    }

    /// 경유 쪽 실패로 접는다 — 안쪽 사유를 잃지 않는다 ([`at_jump`] 전용).
    pub(super) fn at_jump(self, label: &str) -> Self {
        OpenDiag {
            cause: OpenCause::Jump,
            jump: Some(label.to_string()),
            // 경유 안에서 또 경유가 날 수는 없다(1홉 제한) — 그래도 접히면 안쪽을 그대로 둔다.
            inner: Some(if self.cause == OpenCause::Jump {
                self.inner.unwrap_or(OpenCause::Other)
            } else {
                self.cause
            }),
            // 플래그는 **안쪽 사실**이라 접어도 살아남는다 (힌트는 안쪽 사유로 고른다).
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

    /// **금고의 비밀번호가 거부된 자리** — 순수 생성자(유닛 테스트 대상).
    ///
    /// 문구는 "틀렸다" 와 같은 것을 쓰고 갈래는 `stored_rejected` 한 칸으로만 말한다:
    /// 사람이 할 일은 어느 쪽이든 같고(다시 친다), 다른 점은 **모달이 갱신을 권하는가**
    /// 하나뿐이다.
    pub(crate) fn stored_password_rejected() -> Self {
        SshOpenError::PasswordRequired {
            message: wrong_password(),
            diag: OpenDiag::of(OpenCause::AuthPasswordRejected),
            stored_rejected: true,
        }
    }
}

// ---------------------------------------------------------------------------
// 실패 분류 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// getaddrinfo 실패를 가리키는 Windows 소켓 오류 — `WSAHOST_NOT_FOUND` · `WSANO_DATA`.
///
/// 이름이 안 풀리는 것은 `std::io::ErrorKind` 로 올라오지 않는다(`Uncategorized`). 그래서
/// **OS 가 준 숫자**를 본다. 유닉스는 숫자가 제각각이라 std 가 붙이는 문구로 가른다 —
/// 그쪽은 `io::Error::new(Uncategorized, "failed to lookup address information: …")` 이다.
pub(super) const WSA_HOST_NOT_FOUND: i32 = 11001;
pub(super) const WSA_NO_DATA: i32 = 11004;

/// io 오류 하나를 사유로 옮긴다 — **순수 함수**. 셋을 따로 받는 이유는 테스트다:
/// `io::Error` 를 OS 별로 만들지 않고 `(kind, raw, message)` 세 값만 주면 어느 OS 에서도
/// 같은 표를 확인할 수 있다.
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
        // 여기까지 왔다는 것은 TCP 는 이미 섰다는 뜻이다 (connect 는 RST 를 거부로 준다) —
        // 배너를 읽는 중에 끊겼으므로 "SSH 로 말하지 않는다" 쪽이다.
        K::ConnectionReset | K::ConnectionAborted | K::UnexpectedEof => OpenCause::BannerOrProtocol,
        _ => OpenCause::Other,
    }
}

/// 홉을 여는 동안 난 러시 오류를 사유로 옮긴다 — **순수 함수** (유닛 테스트 대상).
///
/// 이 함수가 보는 것은 **전송로를 세우는 동안**의 실패뿐이다(TCP → 배너 → KEX). 인증 뒤의
/// 끊김은 [`describe_disconnect`] 의 몫이라 여기 오지 않는다.
pub(super) fn classify_connect(e: &russh::Error) -> OpenCause {
    use russh::Error as E;
    match e {
        E::IO(io) => classify_io(io.kind(), io.raw_os_error(), &io.to_string()),
        E::ConnectionTimeout | E::Elapsed(_) => OpenCause::TcpTimeout,
        // 버전 문자열·KEX·패킷 단계의 실패 = 저쪽이 SSH 로 말하지 않거나 말이 안 맞는다.
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

/// 인증 단계에서 난 러시 오류 — **순수 함수**.
///
/// 전송 단계와 표를 나누는 이유: 인증 중의 `HUP` 는 "SSH 서버가 아니다" 가 아니라 서버가
/// `MaxAuthTries` 로 끊은 것이다. 그것을 `banner_or_protocol` 로 부르면 힌트가 엉뚱한
/// 곳(포트)을 가리킨다.
pub(super) fn classify_auth(e: &russh::Error) -> OpenCause {
    match e {
        russh::Error::NoAuthMethod => OpenCause::AuthNoMethod,
        _ => OpenCause::Other,
    }
}

// ---------------------------------------------------------------------------
// 호스트 키 다이얼로그의 답 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
// ---------------------------------------------------------------------------

/// **사람이 호스트 키 다이얼로그에서 고른 것.** `None`(인자 없음)이 기본이고 그 뜻은 "거부" 다.
///
/// 이 값은 **사람이 그 자리에서 답했을 때만** 온다 — 헤드리스 접속은 언제나 `None` 을
/// 넘기므로 미상 키도 바뀐 키도 자동으로 통과하지 않는다 (무상호작용 원칙, `connect_delegated`).
/// `~/.ssh/config` 의 `StrictHostKeyChecking` 완화(`no`·`accept-new`)와는 **자리가 다르다**:
/// 그쪽은 사용자가 자기 파일에 미리 적어 둔 정책이고, 이쪽은 방금 화면에서 누른 버튼이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyDecision {
    /// **수락하고 기록한다** — 미상 키 전용(예전의 `accept_new_host_key: true`).
    /// `UserKnownHostsFile none` 인 호스트에서는 기록만 생략되고 통과는 그대로다(예전과 같다).
    Trust,
    /// **이번 접속만 통과** — known_hosts 를 건드리지 않는다. 미상·변경 양쪽에서 쓸 수 있다.
    Once,
    /// **기록된 줄을 새 키로 갈아 끼우고 통과** — 변경 키 전용. `no_store` 호스트에서는
    /// 쓸 수 없으므로 프런트가 그 버튼을 감춘다(백엔드도 기록하지 않고 [`Once`] 처럼 지나간다).
    Replace,
}

impl HostKeyDecision {
    /// 처음 보는 키를 **기록**하는가 (`once` 는 통과시키되 적지 않는다).
    pub(super) fn records_unknown(self) -> bool {
        matches!(self, HostKeyDecision::Trust | HostKeyDecision::Replace)
    }

    /// **바뀐 키**를 통과시키는가 — `trust` 로는 뚫리지 않는다.
    ///
    /// 미상 키를 수락하는 것과 바뀐 키를 수락하는 것은 **다른 결정**이다. 사용자가 "처음 보는
    /// 키를 신뢰한다" 고 누른 것을 "기록된 키가 바뀌었어도 통과" 로 해석하면, 재시도 한 번으로
    /// MITM 경고가 사라진다 (OpenSSH 의 `accept-new` 가 바뀐 키를 뚫지 못하는 것과 같은 이유).
    pub(super) fn accepts_changed(self) -> bool {
        matches!(self, HostKeyDecision::Once | HostKeyDecision::Replace)
    }
}
