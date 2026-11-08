//! 인증 — ssh-agent → `IdentityFile` → 비밀번호 순. 볼트에 담긴 암호구 조회(`vault_keys_for`),
//! 점프 호스트 인증, 인증 실패 문구·진단.
//!
//! 불변식: 비밀번호·암호구는 이 스코프에서 쓰고 버린다 — 오류 문구·로그·`Debug` 에 싣지 않는다.
//! 볼트 값은 Rust 밖으로 나가지 않는다.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::client::{AuthResult, Handle};
use russh::{MethodKind, MethodSet};

use crate::i18n::tr;
use crate::known_hosts;

use super::*;

/// Windows OpenSSH 에이전트의 명명 파이프 경로.
#[cfg(windows)]
pub(crate) const AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

// ---------------------------------------------------------------------------
// 인증 (ssh-agent 키 → 비밀번호)
// ---------------------------------------------------------------------------

/// 비밀번호가 틀렸을 때 프런트에 보내는 고정 문구. 입력값은 절대 싣지 않는다.
pub(super) fn wrong_password() -> String {
    tr!(
        ko: "비밀번호가 올바르지 않습니다",
        en: "That password is not correct"
    )
}
/// 낸 키(에이전트·파일)를 서버가 전부 거부했을 때의 문구.
pub(super) fn key_rejected() -> String {
    tr!(
        ko: "키 인증이 거부되어 비밀번호가 필요합니다",
        en: "Key authentication was rejected — a password is required"
    )
}

/// 개인키 파일을 못 읽었을 때 붙는 꼬리말 — **경로만 적는다**(암호구는 절대 싣지 않는다).
fn key_file_unreadable(path: &str, e: &russh::keys::Error) -> String {
    tr!(
        ko: " — 키 파일 {path} 을(를) 읽지 못했습니다: {e}",
        en: " — could not read the key file {path}: {e}"
    )
}

/// 에이전트 인증 한 판의 결과.
///
/// 실패를 곧바로 [`SshOpenError`] 로 만들지 않는 이유: 비밀번호 폴백이 생긴 뒤로
/// "에이전트가 안 됐다" 는 더 이상 fatal 이 아니다. 서버가 password 를 받는지 본 뒤에야
/// 최종 오류가 정해지므로, 여기서는 사유만 들고 나온다.
enum AgentOutcome {
    /// 인증 성공 — 더 볼 것이 없다.
    ///
    /// `identity` 는 **에이전트가 그 키에 붙여 둔 설명**(보통 키 파일 경로나 `user@host`)이다.
    /// 상태 표시에만 쓰고, 키 바이트는 예나 지금이나 앱에 들어오지 않는다
    /// (`ssh-add -l` 이 보여 주는 것과 같은 한 줄이다).
    Success { identity: Option<String> },
    /// 서버가 에이전트의 키를 전부 거부했다. `remaining` 은 서버가 알려 준 남은 방식.
    Rejected {
        message: String,
        remaining: Option<MethodSet>,
        /// 실제로 **낸** 키들의 지문 — 다음 단계(키 파일)가 같은 키를 또 내지 않게 하는 열쇠
        /// ([`drop_keys_in_agent`]). 에이전트에 닿지 못했으면 빈 벡터다.
        fingerprints: Vec<String>,
    },
    /// 에이전트에 물어보지도 못했다 (서비스 꺼짐·등록된 키 없음 등).
    /// 서버와는 아직 인증 대화를 하지 않았으므로 남은 방식 정보도 없다.
    Unavailable { message: String },
}

impl AgentOutcome {
    fn unavailable(message: impl Into<String>) -> Self {
        AgentOutcome::Unavailable {
            message: message.into(),
        }
    }
}

/// ssh-agent 로 공개키 인증을 시도한다.
///
/// 인증 차례의 첫 칸이다 — 에이전트가 꺼져 있거나 비어 있으면 [`authenticate`] 가 키 파일 → 비밀번호로 넘어간다
/// (2026-09-19 부터 — 그래서 에이전트는 선택이고, 꺼져 있다는 문구도 처방 없이 사정만 말한다 · 2026-11-03).
///
/// `allowed` 는 [`agent_allowlist`] 가 만든 **지문 화이트리스트**다 (`IdentitiesOnly yes`
/// 전용). `None` 이면 예전 그대로 전부 낸다.
#[cfg(windows)]
async fn authenticate_with_agent(
    handle: &mut Handle<SshHandler>,
    user: &str,
    allowed: Option<&[String]>,
) -> AgentOutcome {
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::AgentIdentity;
    use russh::keys::Algorithm;

    let mut agent = match AgentClient::connect_named_pipe(AGENT_PIPE).await {
        Ok(agent) => agent,
        // 파이프 자체가 없다 = ssh-agent 서비스가 안 돌고 있다.
        Err(russh::keys::Error::IO(io)) if io.kind() == std::io::ErrorKind::NotFound => {
            return AgentOutcome::unavailable(tr!(
                ko: "ssh-agent 가 꺼져 있습니다",
                en: "ssh-agent is not running"
            ))
        }
        Err(other) => {
            return AgentOutcome::unavailable(tr!(
                ko: "ssh-agent 에 연결하지 못했습니다: {other}",
                en: "Could not connect to ssh-agent: {other}"
            ))
        }
    };

    let identities = match agent.request_identities().await {
        Ok(identities) => identities,
        Err(e) => {
            return AgentOutcome::unavailable(tr!(
                ko: "ssh-agent 키 목록을 읽지 못했습니다: {e}",
                en: "Could not read the ssh-agent key list: {e}"
            ))
        }
    };

    if identities.is_empty() {
        return AgentOutcome::unavailable(tr!(
            ko: "ssh-agent 에 등록된 키가 없습니다 — `ssh-add <키 경로>` 로 키를 추가하세요",
            en: "No keys are registered with ssh-agent — add one with `ssh-add <key path>`"
        ));
    }

    // RSA 키는 서버가 받아주는 해시(rsa-sha2-512/256/ssh-rsa)를 골라야 한다.
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();

    let mut tried = 0usize;
    let mut skipped_certs = 0usize;
    // `IdentitiesOnly yes` 가 걸러 낸 에이전트 키의 수 — 문구가 그 사실을 말한다.
    let mut skipped_not_allowed = 0usize;
    let mut last_error: Option<String> = None;
    // 서버가 마지막 거절에 실어 보낸 "남은 인증 방식" — 비밀번호 폴백 판단에 쓴다.
    let mut remaining: Option<MethodSet> = None;
    // 낸 키의 지문 — 다음 단계가 같은 키를 파일에서 또 내지 않게 한다.
    let mut fingerprints: Vec<String> = Vec::new();

    for identity in identities {
        let (key, comment) = match identity {
            AgentIdentity::PublicKey { key, comment } => (key, comment),
            // OpenSSH 인증서 인증은 이번 범위 밖.
            AgentIdentity::Certificate { .. } => {
                skipped_certs += 1;
                continue;
            }
        };

        let hash_alg = if matches!(key.algorithm(), Algorithm::Rsa { .. }) {
            rsa_hash
        } else {
            None
        };

        // 지문은 키를 러시로 넘기기 **전에** 뜬다 (아래에서 소유권이 떠난다).
        let fingerprint = known_hosts::fingerprint(&key);
        // `IdentitiesOnly yes` — 지정한 키와 같은 것만 낸다. 낸 적이 없으므로 `fingerprints`
        // 에도 적지 않는다 (그 목록의 뜻은 "이미 내 봤다" 다).
        if allowed.is_some_and(|list| !list.iter().any(|f| f == &fingerprint)) {
            skipped_not_allowed += 1;
            continue;
        }

        tried += 1;
        fingerprints.push(fingerprint);
        match handle
            .authenticate_publickey_with(user, key, hash_alg, &mut agent)
            .await
        {
            Ok(AuthResult::Success) => {
                let trimmed = comment.trim();
                return AgentOutcome::Success {
                    identity: (!trimmed.is_empty()).then(|| trimmed.to_string()),
                };
            }
            Ok(AuthResult::Failure {
                remaining_methods, ..
            }) => remaining = Some(remaining_methods),
            // 에이전트가 서명을 못 했다 (키 잠김 등) — 다음 키로 넘어간다.
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    // 하나도 내지 않았다면 서버와 인증 대화를 한 적이 없다 — `Rejected` 로 적으면 "키를
    // 냈는데 거부됐다"(= 공개키 설치를 권하는 자리)로 잘못 읽힌다.
    if tried == 0 && skipped_not_allowed > 0 {
        return AgentOutcome::unavailable(tr!(
            ko: "IdentitiesOnly 가 켜져 있어 ssh-agent 의 키 {skipped_not_allowed}개는 내지 않았습니다",
            en: "IdentitiesOnly is on, so {skipped_not_allowed} ssh-agent keys were not offered"
        ));
    }

    let mut message = tr!(
        ko: "ssh-agent 의 키 {tried}개가 모두 거부되었습니다 (사용자 '{user}')",
        en: "The server rejected all {tried} ssh-agent keys (user '{user}')"
    );
    if skipped_certs > 0 {
        message.push_str(&tr!(
            ko: " — 인증서 항목 {skipped_certs}개는 아직 지원하지 않아 건너뛰었습니다",
            en: " — skipped {skipped_certs} certificate entries, which are not supported yet"
        ));
    }
    if let Some(e) = last_error {
        message.push_str(&tr!(ko: " — 마지막 오류: {e}", en: " — last error: {e}"));
    }
    AgentOutcome::Rejected {
        message,
        remaining,
        fingerprints,
    }
}

#[cfg(not(windows))]
async fn authenticate_with_agent(
    _handle: &mut Handle<SshHandler>,
    _user: &str,
    _allowed: Option<&[String]>,
) -> AgentOutcome {
    AgentOutcome::unavailable(tr!(
        ko: "이 빌드는 Windows ssh-agent 명명 파이프 인증만 지원합니다",
        en: "This build only supports Windows ssh-agent named pipe authentication"
    ))
}

/// 에이전트가 실패한 뒤, 그 사유와 "서버가 password 를 받는가" 로 최종 오류를 고른다.
///
/// - 서버가 password 를 안 받으면 재시도 경로가 없으므로 기존 [`SshOpenError::Auth`] 그대로.
/// - 받으면 `PasswordRequired` — 에이전트가 아예 없었던 경우에는 원인을 message 에 남겨
///   UI 가 "왜 비밀번호를 묻는지" 를 보여 줄 수 있게 한다.
///
/// 갈래의 기준은 하나다 — **우리가 공개키를 실제로 냈는가.** 에이전트가 꺼져 있어도
/// `IdentityFile` 을 읽어 냈다면 그것은 `auth_key_rejected` 다(= '공개키 설치…' 가 듣는 자리).
/// 하나도 못 냈을 때만 "서버가 받는 방식을 확인하라" 로 가고, 그중에서도 **키 파일이 있는데
/// 읽히지 않은** 경우는 따로 가른다(`key_file_unreadable` — 권한·형식을 보라는 자리).
///
/// `identities_only` 는 사유를 바꾸지 않고 **진단에 플래그 한 칸**만 얹는다
/// ([`OpenDiag::identities_only`]) — 화면의 힌트가 "지정한 키만 시도했습니다" 를 덧붙인다.
/// `locked_identity` 도 같은 꼴이다 (2026-09-22): 잠긴 키를 **건너뛴** 사실만 싣고, 그것을
/// 문장으로 펴는 것은 헤드리스 쪽 한 자리다(`crate::headless` 의 `headless_locked_key_hint`).
pub(crate) fn auth_failure(
    agent_message: &str,
    agent_available: bool,
    keys_offered: bool,
    keys_unreadable: bool,
    password_accepted: bool,
    identities_only: bool,
    locked_identity: bool,
) -> SshOpenError {
    let cause = if agent_available || keys_offered {
        OpenCause::AuthKeyRejected
    } else if keys_unreadable {
        OpenCause::KeyFileUnreadable
    } else {
        OpenCause::AuthNoMethod
    };
    // "키를 냈다" 의 뜻이 넓어졌다 — 아래 문구 갈래는 그 사실 하나만 본다.
    let agent_available = agent_available || keys_offered;
    let err = if !password_accepted {
        SshOpenError::auth_with(cause, agent_message)
    } else if agent_available {
        SshOpenError::password_required_with(cause, key_rejected())
    } else {
        SshOpenError::password_required_with(
            cause,
            tr!(
                ko: "{agent_message} — 비밀번호로 접속합니다",
                en: "{agent_message} — connecting with a password"
            ),
        )
    };
    with_locked_identity(with_identities_only(err, identities_only), locked_identity)
}

/// 인증 실패 하나의 `diag` 를 갈아 끼운다 — **순수 함수**(유닛 테스트 대상).
/// 다이얼로그 계약(호스트 키·암호구)에는 `diag` 가 없으므로 그대로 지나간다.
fn map_diag(err: SshOpenError, f: impl FnOnce(OpenDiag) -> OpenDiag) -> SshOpenError {
    match err {
        SshOpenError::Auth { message, diag } => SshOpenError::Auth {
            message,
            diag: f(diag),
        },
        SshOpenError::PasswordRequired {
            message,
            diag,
            stored_rejected,
        } => SshOpenError::PasswordRequired {
            message,
            diag: f(diag),
            stored_rejected,
        },
        other => other,
    }
}

/// 인증 실패 하나에 `IdentitiesOnly` 플래그를 얹는다 — **순수 함수**(유닛 테스트 대상).
fn with_identities_only(err: SshOpenError, on: bool) -> SshOpenError {
    if !on {
        return err;
    }
    map_diag(err, |d| d.with_identities_only(true))
}

/// 인증 실패 하나에 "**잠긴 `IdentityFile` 을 건너뛰었다**" 플래그를 얹는다 — **순수 함수**.
///
/// 문구는 여기서 바꾸지 않는다: 이 사실이 뜻하는 **처방**은 부르는 자리마다 다르다
/// (헤드리스는 `crate::headless` 의 `headless_locked_key_hint`, 사람이 있는 접속은 애초에 여기까지 오지 않는다).
fn with_locked_identity(err: SshOpenError, on: bool) -> SshOpenError {
    if !on {
        return err;
    }
    map_diag(err, |d| d.with_locked_identity(true))
}

/// **무엇으로 붙었는가** — 세션 표에 적혀 상태 표시(`session_info`)로 나간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    /// ssh-agent 가 서명했다 — **언제나 첫 번째로 시도하는 길**이다.
    Agent,
    /// 앱이 `IdentityFile`(또는 `~/.ssh` 기본 이름)을 그 자리에서 읽어 서명했다
    /// (2026-09-19 · docs/log/2026-09-19-identity-file-auth.md).
    ///
    /// 개인키는 **핸드셰이크가 끝나기까지만** 메모리에 있다 — 서명이 끝나면 곧바로 떨어지고
    /// 세션 표에는 경로 한 줄([`AuthUsed::identity`])만 남는다. 에이전트가 먼저인 것도
    /// 그대로다: 이 값이 보이면 "에이전트에 없는 키로 붙었다" 는 뜻이다.
    KeyFile,
    Password,
    /// **금고에 담겨 있던 비밀번호로 붙었다** (2026-09-19 ② · docs/log/2026-09-19-vault.md).
    ///
    /// [`Password`](AuthMethod::Password) 와 나누는 이유는 화면 한 줄이다 — 사람이 방금 친
    /// 값으로 붙은 것과, 앱이 기억해 둔 값으로 붙은 것은 사용자가 구분할 수 있어야 한다
    /// ("왜 안 묻지?" 의 답이 말풍선에 있어야 한다).
    PasswordVault,
    /// 서버가 인증을 요구하지 않았다 (`none` 으로 통과).
    None,
}

/// 인증이 끝난 방식 한 벌.
#[derive(Debug, Clone)]
pub(crate) struct AuthUsed {
    pub method: AuthMethod,
    /// 키 설명 — 에이전트면 그 코멘트(`ssh-add -l` 의 그 글자), 파일 키면 **경로**(`~` 표기).
    /// 비밀번호·none 이면 `None`. **키 바이트도 암호구도 비밀번호도 절대 들어가지 않는다.**
    pub identity: Option<String>,
    /// 그 키 파일을 **금고에 담긴 암호구로** 열었는가 (2026-09-19 ②). 말풍선이 "(저장됨)"
    /// 한 마디를 덧붙이는 근거다 — 값이 아니라 **출처**만 말한다.
    pub identity_stored: bool,
}

impl AuthUsed {
    pub(super) fn of(method: AuthMethod) -> Self {
        AuthUsed {
            method,
            identity: None,
            identity_stored: false,
        }
    }
}

// ---------------------------------------------------------------------------
// 키 파일 인증 (2단계 — docs/log/2026-09-19-identity-file-auth.md)
// ---------------------------------------------------------------------------

/// 잠긴 키 파일을 만났을 때 **물을 수 있는 자리인가**.
///
/// 사람이 있는 접속(`open_ssh_session`)만 `Ask` 다. 헤드리스 위임 접속과 공개키 설치 검증은
/// 물을 상대가 없으므로 [`KeyUnlock::Skip`] — 잠긴 키는 **조용히 건너뛴다**(오류가 아니다).
#[derive(Clone, Copy)]
pub(crate) enum KeyUnlock<'a> {
    /// 잠긴 키를 만나면 [`SshOpenError::PassphraseRequired`] 로 되돌린다.
    Ask {
        /// 이번 재시도에서 **어느 경로의** 암호구가 실려 왔는가 (경로가 열쇠다).
        for_path: Option<&'a str>,
        /// 그 암호구. 이 함수 스코프를 넘어 어디에도 복사하지 않는다.
        passphrase: Option<&'a str>,
        /// 사용자가 **묻는 창을 취소한** 경로들 — 다시 묻지 않고 건너뛴다(비밀번호로 간다).
        /// 이 목록이 없으면 취소가 곧바로 같은 물음으로 되돌아와 무한 루프가 된다.
        declined: &'a [String],
        /// **금고에서 미리 꺼내 둔 암호구들** (2026-09-19 ②). 비어 있으면 예전과 같다.
        stored: &'a [StoredKey],
    },
    /// 물을 자리가 없다 — 잠긴 키는 조용히 건너뛴다. 다만 **금고에 담긴 암호구는 쓴다**:
    /// 묻지 않고 여는 것이므로 "물을 상대가 없다" 와 어긋나지 않는다
    /// (공개키 설치 뒤 검증이 이 길로 `Verified::Ok` 까지 간다).
    Skip { stored: &'a [StoredKey] },
}

/// 금고에서 꺼내 둔 한 쌍 — (개인키 **전체 경로**, 암호구).
///
/// 금고 조회는 디스크를 읽으므로([`crate::vault`] 머리말) 인증 루프 안에서 부를 수 없다.
/// 그래서 접속을 시작하는 자리에서 **블로킹 풀에 한 번** 물어 이 목록으로 들고 들어온다.
pub(crate) type StoredKey = (String, zeroize::Zeroizing<String>);

impl KeyUnlock<'_> {
    /// 아무것도 묻지 않고 금고도 보지 않는다 — 헤드리스의 자리.
    pub(crate) fn none() -> KeyUnlock<'static> {
        KeyUnlock::Skip { stored: &[] }
    }
}

/// 이 경로의 **금고에 담긴 암호구** — 순수 함수(유닛 테스트 대상).
///
/// 경로 비교는 [`Path`] 로 한다: 금고에 적힌 글자와 후보가 구분자·대소문자 표기에서
/// 다를 수 있고, 문자열로 맞추면 "담아 뒀는데 안 쓰는" 조용한 실패가 된다.
pub(super) fn stored_passphrase_for<'a>(stored: &'a [StoredKey], path: &Path) -> Option<&'a str> {
    stored
        .iter()
        .find(|(p, _)| Path::new(p) == path)
        .map(|(_, v)| v.as_str())
}

/// 이 접속에 쓸 **금고의 후보 경로들** — 대상 홉과 경유 홉의 `IdentityFile` 후보를 합친다.
///
/// 경유를 함께 담는 이유는 [`SshOpenError::PassphraseRequired`] 가 홉을 가리지 않기 때문이다
/// (경로가 전역 이름이다 — `authenticate_jump` 의 설명). 담아 둔 암호구도 같은 규칙을 따라야
/// 경유 호스트의 잠긴 키가 계속 물어 오지 않는다.
fn vault_key_targets(params: &ConnectParams, home: Option<&Path>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |file: Option<&str>, only: bool| {
        for p in identity_candidates(file, only, home, &|p| p.is_file()) {
            let s = p.display().to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    };
    // 홉마다 **자기 홉의** 규칙으로 후보를 편다 — 금고에서 꺼내는 값도 실제로 열 키와 같아야 한다.
    push(params.identity_file.as_deref(), params.identities_only);
    if let Some(j) = &params.jump {
        push(j.identity_file.as_deref(), j.identities_only);
    }
    out
}

/// 금고를 **블로킹 풀에서 한 번** 보고 이 접속이 쓸 값들을 꺼내 온다.
///
/// 금고가 없거나 잠겨 있으면 전부 비어서 돌아온다 — **오류가 아니다**. 잠긴 금고가 접속을
/// 실패시키면 안 되고(그건 프런트가 잠금 해제 모달로 먼저 푼다), 금고를 안 만든 사람에게는
/// 이 함수가 통째로 없는 것과 같아야 한다(옵트인).
/// 이 접속의 **키 암호구만** 금고에서 꺼낸다 — [`crate::copy_id`] 의 설치 검증이 쓴다
/// (그쪽에는 별칭으로 찾을 비밀번호가 없다: 이미 사람이 한 번 쳤다).
pub(crate) async fn vault_keys_for(params: &ConnectParams) -> Vec<StoredKey> {
    vault_secrets("", params, false, true).await.1
}

pub(super) async fn vault_secrets(
    alias: &str,
    params: &ConnectParams,
    want_password: bool,
    want_passphrases: bool,
) -> (Option<zeroize::Zeroizing<String>>, Vec<StoredKey>) {
    let alias = alias.to_string();
    let targets = if want_passphrases {
        vault_key_targets(params, dirs::home_dir().as_deref())
    } else {
        Vec::new()
    };
    // 금고는 이 프로세스(세션 서버)에 산다(③-3b2 — `server::hub`). 값은 같은 프로세스 안에서 직접 꺼내 `Zeroizing` 으로만
    // 들고 간다 — 파이프를 타지 않는다. 금고가 없거나(서버 밖) 잠겼으면 비어서 온다 — 접속을 막을 이유가 아니다.
    if !want_password && targets.is_empty() {
        return (None, Vec::new());
    }
    let Some(vault) = crate::server::hub::vault() else {
        return (None, Vec::new());
    };
    tokio::task::spawn_blocking(move || {
        let password = want_password.then(|| vault.password_for(&alias)).flatten();
        let keys: Vec<StoredKey> = targets
            .into_iter()
            .filter_map(|p| vault.passphrase_for(&p).map(|v| (p, v)))
            .collect();
        (password, keys)
    })
    .await
    .unwrap_or_default()
}

/// 개인키 파일 하나를 읽지 못한 이유를 셋으로 가른다 — **순수 함수**(유닛 테스트 대상).
///
/// 갈래가 셋인 이유는 **처방이 셋**이기 때문이다: 잠겨 있으면 물어야 하고, 방금 넣은 것이
/// 틀렸으면 그렇게 말해 줘야 하고, 그 밖의 실패(권한·형식)는 다음 후보로 넘어가야 한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum KeyLoad {
    /// 암호구가 걸려 있는데 우리가 주지 않았다.
    Locked,
    /// 암호구를 줬는데 풀리지 않았다 (checkint 불일치 = 틀린 암호구).
    Wrong,
    /// 읽을 수 없는 파일이다 (권한·형식·잘린 파일).
    Unreadable,
}

pub(super) fn classify_key_load(e: &russh::keys::Error, had_passphrase: bool) -> KeyLoad {
    match e {
        russh::keys::Error::KeyIsEncrypted => KeyLoad::Locked,
        // 암호구를 넣고도 실패했으면 그 암호구가 틀린 것이다 — 러시는 복호 실패를
        // `SshKey(Crypto)` 로 올리는데, 그 한 값에 기대면 크레이트가 바뀔 때 조용히 어긋난다.
        _ if had_passphrase => KeyLoad::Wrong,
        _ => KeyLoad::Unreadable,
    }
}

/// 짝이 되는 `.pub` 에서 지문을 읽는다 (없거나 못 읽으면 `None`).
/// 계산은 [`crate::keygen::pub_fingerprint`] 하나뿐이다 — 목록 화면과 같은 값이어야
/// "에이전트에 이미 있는 키" 를 지문으로 거를 수 있다.
pub(super) fn file_key_fingerprint(path: &Path) -> Option<String> {
    crate::keygen::pub_fingerprint(path)
}

/// 키 파일 후보들을 차례로 내 본다 — 2단계의 몸통.
///
/// ## 암호구가 사는 시간
///
/// `unlock` 에 실려 온 `&str` 을 [`russh::keys::load_secret_key`] 에 **빌려주는 그 호출
/// 동안만** 산다. 우리는 복사하지 않고, 구조체에 담지 않고, 오류 문구에도 싣지 않는다
/// (오류는 **경로만** 적는다). 지우는 것은 부르는 쪽의 몫이다 — 소유권이 거기 있다
/// ([`open_ssh_session`](super::open::open_ssh_session) 이 `Zeroizing` 으로 감싼다).
///
/// ## 개인키가 사는 시간
///
/// `load_secret_key` 가 만든 [`russh::keys::PrivateKey`] 는 이 `for` 한 바퀴 안에서만
/// 산다: `Arc` 에 담아 서명 요청으로 넘기고, 성공이든 실패든 그 바퀴 끝에서 떨어진다
/// (러시의 `PrivateKey` 는 드롭될 때 자기 바이트를 문지른다 — `ssh_key` 의 `Zeroize`).
async fn authenticate_with_key_files(
    handle: &mut Handle<SshHandler>,
    user: &str,
    candidates: &[PathBuf],
    unlock: KeyUnlock<'_>,
    home: Option<&Path>,
) -> KeyFileOutcome {
    use russh::keys::{Algorithm, PrivateKeyWithHashAlg};

    if candidates.is_empty() {
        return KeyFileOutcome::NotTried {
            notes: String::new(),
            unreadable: false,
            locked_skipped: false,
        };
    }

    // RSA 키는 서버가 받아주는 해시를 골라야 한다 (에이전트 단계와 같은 판정).
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();

    let mut tried = 0usize;
    let mut notes = String::new();
    let mut unreadable = false;
    let mut locked_skipped = false;
    let mut remaining: Option<MethodSet> = None;

    for path in candidates {
        let shown = shorten_home(path, home);
        let (supplied, declined, stored) = match unlock {
            KeyUnlock::Ask {
                for_path,
                passphrase,
                declined,
                stored,
            } => {
                let mine = for_path.is_some_and(|p| Path::new(p) == path.as_path());
                (
                    if mine { passphrase } else { None },
                    declined.iter().any(|d| Path::new(d) == path.as_path()),
                    stored_passphrase_for(stored, path),
                )
            }
            KeyUnlock::Skip { stored } => (None, false, stored_passphrase_for(stored, path)),
        };

        let (key, from_vault) = match open_candidate(path, supplied, stored) {
            Opened::Key { key, from_vault } => (*key, from_vault),
            Opened::Unreadable(e) => {
                unreadable = true;
                notes.push_str(&key_file_unreadable(&shown, &e));
                continue;
            }
            // 잠긴 키 — 물을 자리가 있으면 여기서 되돌아간다. 사용자가 이미 취소한
            // 경로면 묻지 않고 지나간다(다음 후보 → 결국 비밀번호).
            Opened::Locked {
                wrong,
                stored_rejected,
            } => {
                if matches!(unlock, KeyUnlock::Ask { .. }) && !declined {
                    return KeyFileOutcome::Locked {
                        // 전체 경로다 — 재시도에서 `passphrase_for` 로 그대로 돌아온다.
                        path: path.display().to_string(),
                        fingerprint: file_key_fingerprint(path),
                        wrong,
                        stored_rejected,
                    };
                }
                // 물을 자리가 없거나(헤드리스·검증) 이미 취소한 키 — 조용히 다음으로.
                // **사실만 적어 둔다**: 무인 접속의 실패 문구가 "왜 키를 안 냈는지" 를
                // 말할 수 있어야 한다 (2026-09-22).
                locked_skipped = true;
                continue;
            }
        };

        let hash_alg = if matches!(key.algorithm(), Algorithm::Rsa { .. }) {
            rsa_hash
        } else {
            None
        };

        tried += 1;
        match handle
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
            .await
        {
            Ok(AuthResult::Success) => {
                return KeyFileOutcome::Success {
                    identity: shown,
                    from_vault,
                }
            }
            Ok(AuthResult::Failure {
                remaining_methods, ..
            }) => remaining = Some(remaining_methods),
            // 프로토콜 오류(끊김 등) — 다음 후보를 내 봐야 같은 자리에서 막힌다.
            Err(e) => {
                notes.push_str(&tr!(
                    ko: " — 키 파일 {shown} 으로 인증하다 실패했습니다: {e}",
                    en: " — authentication with the key file {shown} failed: {e}"
                ));
                break;
            }
        }
    }

    if tried == 0 {
        KeyFileOutcome::NotTried {
            notes,
            unreadable,
            locked_skipped,
        }
    } else {
        KeyFileOutcome::Rejected {
            tried,
            notes,
            remaining,
            locked_skipped,
        }
    }
}

/// 후보 하나를 연 결과 — [`open_candidate`] 가 돌려주는 셋.
///
/// 성공 갈래를 박스에 담는다: [`russh::keys::PrivateKey`] 는 RSA 키를 담을 만큼 크고
/// (clippy `large_enum_variant`), 이 값은 한 바퀴에 한 번만 만들어지므로 할당 하나가
/// 나머지 두 갈래를 가볍게 유지하는 값보다 싸다.
enum Opened {
    Key {
        key: Box<russh::keys::PrivateKey>,
        /// **금고에 담긴 암호구로** 열었는가.
        from_vault: bool,
    },
    Locked {
        /// 사람이 **방금 친** 암호구가 틀렸다.
        wrong: bool,
        /// **금고에 담겨 있던** 암호구로 열리지 않았다 — 담아 둔 값이 낡았다는 뜻이다.
        stored_rejected: bool,
    },
    Unreadable(russh::keys::Error),
}

/// 개인키 파일 하나를 연다 — **① 방금 받은 암호구 → ② 금고에 담긴 것** 순서다.
///
/// 순서가 뒤집히면 안 되는 이유: 사람이 방금 친 값은 **금고를 갱신하러 온 값**일 수 있다.
/// 금고를 먼저 보면 낡은 값이 이기고, 사용자는 "새로 쳤는데 왜 안 되지" 를 만난다.
/// 그래서 금고는 `supplied` 가 없을 때만 본다.
///
/// 암호구는 여기서도 **빌려 쓸 뿐**이다 — `load_secret_key` 호출 동안만 살고, 복사하지도
/// 구조체에 담지도 않는다 (오류에는 경로조차 싣지 않는다).
fn open_candidate(path: &Path, supplied: Option<&str>, stored: Option<&str>) -> Opened {
    match russh::keys::load_secret_key(path, supplied) {
        Ok(key) => Opened::Key {
            key: Box::new(key),
            from_vault: false,
        },
        Err(e) => match classify_key_load(&e, supplied.is_some()) {
            KeyLoad::Unreadable => Opened::Unreadable(e),
            KeyLoad::Locked | KeyLoad::Wrong => {
                if supplied.is_none() {
                    if let Some(s) = stored {
                        return match russh::keys::load_secret_key(path, Some(s)) {
                            Ok(key) => Opened::Key {
                                key: Box::new(key),
                                from_vault: true,
                            },
                            // 담아 둔 값이 더 이상 맞지 않는다. `wrong` 은 **거짓**이다 —
                            // 그 줄은 "방금 친 것이 틀렸다" 는 뜻이고, 사람은 아직 안 쳤다.
                            Err(_) => Opened::Locked {
                                wrong: false,
                                stored_rejected: true,
                            },
                        };
                    }
                }
                Opened::Locked {
                    wrong: supplied.is_some(),
                    stored_rejected: false,
                }
            }
        },
    }
}

/// 키 파일 한 판의 결과 — [`AgentOutcome`] 과 같은 모양의 "사유만 들고 나오기".
enum KeyFileOutcome {
    Success {
        /// `~` 로 줄인 경로 — 상태 말풍선이 그대로 띄운다.
        identity: String,
        /// 금고에 담긴 암호구로 열었는가 ([`AuthUsed::identity_stored`] 가 된다).
        from_vault: bool,
    },
    /// 서버가 우리가 낸 파일 키를 전부 거부했다.
    Rejected {
        tried: usize,
        notes: String,
        remaining: Option<MethodSet>,
        /// 그 와중에 **잠겨서 건너뛴** 후보가 있었는가 ([`OpenDiag::locked_identity`]).
        locked_skipped: bool,
    },
    /// 잠긴 키를 만났고, 물을 자리가 있다 — 프런트가 암호구를 받아 재시도한다.
    Locked {
        path: String,
        fingerprint: Option<String>,
        wrong: bool,
        stored_rejected: bool,
    },
    /// 낸 키가 하나도 없다 (후보가 없거나 전부 못 읽었다). `notes` 는 그 사유들이고,
    /// `unreadable` 은 "**있는데** 못 읽은 파일이 있었다" — 진단이 그 한 줄로 갈린다.
    /// `locked_skipped` 는 "**암호구가 걸려** 건너뛴 파일이 있었다" (2026-09-22) — 물을
    /// 자리가 없는 경로에서만 참이고, 헤드리스의 처방 한 줄이 이 값에서 나온다.
    NotTried {
        notes: String,
        unreadable: bool,
        locked_skipped: bool,
    },
}

/// **에이전트 키 → 키 파일 → 비밀번호** 순으로 인증한다 (OpenSSH 와 같은 차례).
///
/// 2026-09-19 에 가운데 한 칸이 생겼다 — `IdentityFile`(또는 `~/.ssh` 기본 이름)을 **접속하는
/// 그 순간 읽어** 서명하고 곧바로 버린다. 앱은 개인키도 암호구도 저장하지 않고, 잠긴 키는
/// 사람에게 묻되(`PassphraseRequired`) 그 답을 기억하지 않는다
/// (docs/log/2026-09-19-identity-file-auth.md).
///
/// `password` 는 이 함수 안에서만 살아 있고 러시로 넘기는 즉시 스코프를 떠난다.
/// 앱은 저장·캐시하지 않고, 로그에도 남기지 않는다.
/// `stored_password` 는 **금고에서 미리 꺼내 둔** 이 호스트의 비밀번호다 (2026-09-19 ②).
/// 사람이 방금 친 `password` 가 있으면 그쪽이 이긴다 — 금고는 "묻는 자리" 를 대신할 뿐,
/// 새로 친 값보다 앞에 서지 않는다.
///
/// `identities_only` (`IdentitiesOnly yes`)가 켜지면 ①과 ②가 **함께** 좁아진다 — 에이전트는
/// 후보 파일과 같은 지문의 키만 내고([`agent_allowlist`]), 후보에는 기본 이름이 붙지 않는다
/// ([`identity_candidates`]). ③ 비밀번호는 그대로다: 이 옵션은 **키 고르기**에 대한 말이다.
pub(crate) async fn authenticate(
    handle: &mut Handle<SshHandler>,
    user: &str,
    password: Option<String>,
    identity_file: Option<&str>,
    identities_only: bool,
    unlock: KeyUnlock<'_>,
    stored_password: Option<zeroize::Zeroizing<String>>,
) -> Result<AuthUsed, SshOpenError> {
    let home = dirs::home_dir();
    // 후보는 **에이전트보다 먼저** 편다 — `IdentitiesOnly` 의 화이트리스트가 거기서 나온다.
    let candidates = identity_candidates(identity_file, identities_only, home.as_deref(), &|p| {
        p.is_file()
    });
    let allowed = agent_allowlist(identities_only, &candidates, &file_key_fingerprint);
    let (mut agent_message, agent_available, mut remaining, agent_fingerprints) =
        match authenticate_with_agent(handle, user, allowed.as_deref()).await {
            AgentOutcome::Success { identity } => {
                return Ok(AuthUsed {
                    method: AuthMethod::Agent,
                    identity,
                    identity_stored: false,
                })
            }
            AgentOutcome::Rejected {
                message,
                remaining,
                fingerprints,
            } => (message, true, remaining, fingerprints),
            AgentOutcome::Unavailable { message } => (message, false, None, Vec::new()),
        };

    // ── ② 키 파일 ───────────────────────────────────────────────────────────
    // 에이전트가 이미 낸 키는 지문으로 뺀다 — 같은 키를 두 번 내면 `MaxAuthTries` 만 태운다.
    let candidates = drop_keys_in_agent(candidates, &agent_fingerprints, &file_key_fingerprint);
    let mut keys_offered = false;
    let mut keys_unreadable = false;
    // 잠긴 키를 **건너뛴** 사실 (헤드리스·검증 경로에서만 참이 된다 — 2026-09-22).
    // 초깃값을 두지 않는 것은 의도다: 아래 match 의 **떨어지는 두 갈래가 모두** 값을 적고,
    // 나머지 둘은 그 자리에서 돌아간다(초깃값을 두면 "쓰이지 않는 대입" 경고가 뜬다).
    let keys_locked_skipped: bool;
    match authenticate_with_key_files(handle, user, &candidates, unlock, home.as_deref()).await {
        KeyFileOutcome::Success {
            identity,
            from_vault,
        } => {
            return Ok(AuthUsed {
                method: AuthMethod::KeyFile,
                identity: Some(identity),
                identity_stored: from_vault,
            })
        }
        KeyFileOutcome::Locked {
            path,
            fingerprint,
            wrong,
            stored_rejected,
        } => {
            return Err(SshOpenError::PassphraseRequired {
                path,
                fingerprint,
                wrong,
                stored_rejected,
            })
        }
        KeyFileOutcome::Rejected {
            tried,
            notes,
            remaining: after,
            locked_skipped,
        } => {
            keys_offered = true;
            keys_locked_skipped = locked_skipped;
            agent_message.push_str(&tr!(
                ko: " — 키 파일 {tried}개도 거부되었습니다",
                en: " — {tried} key files were rejected too"
            ));
            agent_message.push_str(&notes);
            // 서버가 마지막에 알려 준 남은 방식이 더 새롭다.
            if after.is_some() {
                remaining = after;
            }
        }
        KeyFileOutcome::NotTried {
            notes,
            unreadable,
            locked_skipped,
        } => {
            keys_unreadable = unreadable;
            keys_locked_skipped = locked_skipped;
            agent_message.push_str(&notes);
        }
    }

    if let Some(password) = password {
        // password 는 여기서 러시로 넘어가며 소유권째 사라진다.
        let result = handle.authenticate_password(user, password).await;
        return match result {
            Ok(AuthResult::Success) => Ok(AuthUsed::of(AuthMethod::Password)),
            Ok(AuthResult::Failure { .. }) => Err(SshOpenError::password_required_with(
                OpenCause::AuthPasswordRejected,
                wrong_password(),
            )),
            // 프로토콜 오류(MaxAuthTries 초과로 끊김 등)는 재시도해도 소용없다.
            Err(e) => Err(SshOpenError::auth_with(
                classify_auth(&e),
                tr!(
                    ko: "비밀번호 인증에 실패했습니다: {e}",
                    en: "Password authentication failed: {e}"
                ),
            )),
        };
    }

    // 비밀번호를 아직 안 받았다 — 서버가 password 를 받는지 확인하고 모달을 띄울지 정한다.
    let password_accepted = match remaining {
        Some(methods) => methods.contains(&MethodKind::Password),
        // 에이전트를 아예 못 써서 서버에 물어본 적이 없다 → `none` 인증으로 한 번 묻는다.
        None => match handle.authenticate_none(user).await {
            // 인증이 필요 없는 서버였다 (드물지만 계약상 가능).
            Ok(AuthResult::Success) => return Ok(AuthUsed::of(AuthMethod::None)),
            Ok(AuthResult::Failure {
                remaining_methods, ..
            }) => remaining_methods.contains(&MethodKind::Password),
            // 물어보지 못했으면 비밀번호 모달을 띄우지 않고 원래 사유를 올린다.
            Err(_) => false,
        },
    };

    // ── ④ 금고 (2026-09-19 ②) ───────────────────────────────────────────────
    // **묻기 직전**의 자리다 — 인증 순서(에이전트 → 키 파일 → 비밀번호)는 한 칸도 바뀌지
    // 않았고, 금고는 그 마지막 칸에서 "모달을 띄운다" 를 "담아 둔 값을 한 번 내 본다" 로
    // 바꿀 뿐이다. 서버가 비밀번호를 받지 않으면 내 보지도 않는다(`MaxAuthTries` 를 태우지
    // 않는다). **한 번뿐이다** — 틀리면 곧바로 사람에게 넘긴다.
    if password_accepted {
        if let Some(stored) = stored_password {
            return match handle
                .authenticate_password(user, stored.as_str().to_string())
                .await
            {
                Ok(AuthResult::Success) => Ok(AuthUsed::of(AuthMethod::PasswordVault)),
                Ok(AuthResult::Failure { .. }) => Err(SshOpenError::stored_password_rejected()),
                Err(e) => Err(SshOpenError::auth_with(
                    classify_auth(&e),
                    tr!(
                        ko: "비밀번호 인증에 실패했습니다: {e}",
                        en: "Password authentication failed: {e}"
                    ),
                )),
            };
        }
    }

    Err(auth_failure(
        &agent_message,
        agent_available,
        keys_offered,
        keys_unreadable,
        password_accepted,
        identities_only,
        keys_locked_skipped,
    ))
}

/// 점프 호스트 인증 — **키만** 쓴다 (에이전트 → 그 별칭의 `IdentityFile`).
///
/// `open_ssh_session` 의 `password` 인자는 **대상 호스트 전용으로 예약**돼 있다.
/// 프런트의 `password_required` 재시도 계약에는 "어느 호스트의 비밀번호인가" 를 담을
/// 자리가 없어서, 점프까지 비밀번호를 물으면 사용자가 넣은 값이 어디로 가는지
/// 알 수 없게 된다. 그래서 점프는 키 인증만 받고, 실패는 재시도 경로가 없는
/// [`SshOpenError::Auth`] 로 끝낸다.
///
/// **암호구는 다르다 (2026-09-19).** 비밀번호와 달리 [`SshOpenError::PassphraseRequired`] 는
/// **경로**를 싣는데, 경로는 홉을 가리지 않는 전역 이름이다 — 재시도의 `passphrase_for` 가
/// 어느 홉의 키인지 스스로 말하므로, 경유 호스트의 잠긴 키도 같은 계약으로 풀 수 있다.
/// 그래서 이 한 갈래만 위로 새어 나가고([`at_jump`] 가 손대지 않는다), 나머지는 예전 그대로다.
///
/// **`IdentitiesOnly` 는 이 별칭 자신의 값**이다 (`identity_file` 과 같은 규칙 — 경유도
/// 별개의 서버다). 대상이 켰다고 경유가 좁아지지 않고, 그 반대도 마찬가지다.
pub(super) async fn authenticate_jump(
    handle: &mut Handle<SshHandler>,
    user: &str,
    label: &str,
    identity_file: Option<&str>,
    identities_only: bool,
    unlock: KeyUnlock<'_>,
) -> Result<(), SshOpenError> {
    let home = dirs::home_dir();
    let all = identity_candidates(identity_file, identities_only, home.as_deref(), &|p| {
        p.is_file()
    });
    let allowed = agent_allowlist(identities_only, &all, &file_key_fingerprint);
    let agent_message = match authenticate_with_agent(handle, user, allowed.as_deref()).await {
        AgentOutcome::Success { .. } => return Ok(()),
        AgentOutcome::Rejected {
            message,
            fingerprints,
            ..
        } => {
            let candidates = drop_keys_in_agent(all, &fingerprints, &file_key_fingerprint);
            match authenticate_with_key_files(handle, user, &candidates, unlock, home.as_deref())
                .await
            {
                KeyFileOutcome::Success { .. } => return Ok(()),
                KeyFileOutcome::Locked {
                    path,
                    fingerprint,
                    wrong,
                    stored_rejected,
                } => {
                    return Err(SshOpenError::PassphraseRequired {
                        path,
                        fingerprint,
                        wrong,
                        stored_rejected,
                    })
                }
                KeyFileOutcome::Rejected { notes, .. } | KeyFileOutcome::NotTried { notes, .. } => {
                    format!("{message}{notes}")
                }
            }
        }
        AgentOutcome::Unavailable { message } => {
            match authenticate_with_key_files(handle, user, &all, unlock, home.as_deref()).await {
                KeyFileOutcome::Success { .. } => return Ok(()),
                KeyFileOutcome::Locked {
                    path,
                    fingerprint,
                    wrong,
                    stored_rejected,
                } => {
                    return Err(SshOpenError::PassphraseRequired {
                        path,
                        fingerprint,
                        wrong,
                        stored_rejected,
                    })
                }
                KeyFileOutcome::Rejected { notes, .. } | KeyFileOutcome::NotTried { notes, .. } => {
                    format!("{message}{notes}")
                }
            }
        }
    };
    Err(jump_auth_error(label, &agent_message, identities_only))
}

/// **키만으로** 인증한다 — 비밀번호도, 암호구 묻기도 없다.
///
/// [`crate::copy_id`] 의 설치 후 검증 전용이다. 에이전트 키를 먼저 내고, 없으면 그 호스트의
/// `IdentityFile`(잠기지 않은 것만) 을 낸다 — 2026-09-19 이전에는 에이전트뿐이라 **파일에만
/// 있는 키로 설치한 사람은 늘 "확인 건너뜀"** 을 봤다.
///
/// `unlock` 은 [`KeyUnlock::Skip`] 이어야 한다(묻지 않는다). 다만 그 안에 **금고에서 꺼내 둔
/// 암호구**를 실어 주면 잠긴 키도 열어 낸다 — 2026-09-19 ② 이후 설치 검증이 `Verified::Ok`
/// 까지 가는 길이다.
///
/// `identities_only` 는 접속과 **같은 규칙**으로 후보를 좁힌다 — 설치 확인이 접속과 다른 키를
/// 내면 "이 키로 붙는다" 는 보고가 거짓말이 된다.
pub(crate) async fn authenticate_keys_only(
    handle: &mut Handle<SshHandler>,
    user: &str,
    identity_file: Option<&str>,
    identities_only: bool,
    unlock: KeyUnlock<'_>,
) -> KeyAuthOutcome {
    let home = dirs::home_dir();
    let all = identity_candidates(identity_file, identities_only, home.as_deref(), &|p| {
        p.is_file()
    });
    let allowed = agent_allowlist(identities_only, &all, &file_key_fingerprint);
    let (offered_agent, fingerprints) =
        match authenticate_with_agent(handle, user, allowed.as_deref()).await {
            AgentOutcome::Success { .. } => return KeyAuthOutcome::Ok,
            AgentOutcome::Rejected { fingerprints, .. } => (true, fingerprints),
            AgentOutcome::Unavailable { .. } => (false, Vec::new()),
        };
    let candidates = drop_keys_in_agent(all, &fingerprints, &file_key_fingerprint);
    match authenticate_with_key_files(handle, user, &candidates, unlock, home.as_deref()).await {
        KeyFileOutcome::Success { .. } => KeyAuthOutcome::Ok,
        KeyFileOutcome::Rejected { .. } => KeyAuthOutcome::Rejected,
        // 잠긴 키는 `Skip` 에서 나오지 않는다 (건너뛴다) — 그래도 갈래는 남겨 둔다.
        KeyFileOutcome::Locked { .. } | KeyFileOutcome::NotTried { .. } => {
            if offered_agent {
                KeyAuthOutcome::Rejected
            } else {
                KeyAuthOutcome::NoSigner
            }
        }
    }
}

/// [`authenticate_keys_only`] 의 세 갈래 — 설치 보고문이 이것으로 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeyAuthOutcome {
    /// 그 키로 붙었다.
    Ok,
    /// 키를 **냈는데** 서버가 거부했다 — 서버 설정을 의심할 수 있는 유일한 자리.
    Rejected,
    /// 낼 키가 없었다 (에이전트에도 없고, 읽을 수 있는 키 파일도 없다) —
    /// **붙어 보지도 않았으므로 서버를 탓하지 않는다.**
    NoSigner,
}

/// 경유 호스트 **쪽에서** 난 실패임을 문구 앞에 밝힌다 — **순수 함수** (유닛 테스트 대상).
///
/// 경유가 끼면 실패가 두 곳에서 날 수 있는데, 문구만 보면 둘이 똑같이 생겼다
/// (`10.0.0.9:22 접속 실패: …` 가 대상인지 경유인지 알 수 없다). 그래서 **경유 쪽 실패에만**
/// 별칭을 앞세운다 — 대상 쪽은 그대로 두는 것이 이 구분의 절반이다.
///
/// 호스트 키 두 변종은 **손대지 않는다**: 그것은 사람이 읽는 문구가 아니라 프런트의 대화상자
/// 계약이고(`host`·`port` 가 이미 경유의 것이다), 문자열로 접으면 TOFU 모달이 사라진다.
pub(super) fn at_jump(label: &str, err: SshOpenError) -> SshOpenError {
    let wrap = |message: String| {
        tr!(
            ko: "경유 호스트 {jump} 에서 실패: {message}",
            en: "Failed at jump host {jump}: {message}",
            jump = label,
            message = message,
        )
    };
    match err {
        SshOpenError::Other { message, diag } => SshOpenError::Other {
            message: wrap(message),
            diag: diag.at_jump(label),
        },
        SshOpenError::Auth { message, diag } => SshOpenError::Auth {
            message: wrap(message),
            diag: diag.at_jump(label),
        },
        // 경유는 비밀번호 재시도 계약이 없다(`authenticate_jump`) — 올 일이 없지만, 오면
        // 문구만 밝히고 변종은 유지한다.
        SshOpenError::PasswordRequired {
            message,
            diag,
            stored_rejected,
        } => SshOpenError::PasswordRequired {
            message: wrap(message),
            diag: diag.at_jump(label),
            stored_rejected,
        },
        // **다이얼로그 계약 셋은 손대지 않는다.** 호스트 키 둘은 문자열로 접으면 TOFU 모달이
        // 사라지고, 암호구는 `path` 가 이미 "어느 키인가" 를 스스로 말한다 — 경유라는 사실을
        // 문구로 덧칠할 자리가 애초에 없다(모달은 파일 이름만 띄운다).
        keyed @ (SshOpenError::HostKeyUnknown { .. }
        | SshOpenError::HostKeyChanged { .. }
        | SshOpenError::PassphraseRequired { .. }) => keyed,
    }
}

/// 경유 호스트 인증 실패 문구 — **순수 함수** (유닛 테스트 대상).
/// 이 한 줄은 이미 별칭을 담고 있어 [`at_jump`] 를 거치지 않는다 (두 번 적히지 않게).
pub(super) fn jump_auth_error(
    label: &str,
    agent_message: &str,
    identities_only: bool,
) -> SshOpenError {
    SshOpenError::Auth {
        message: tr!(
            ko: "경유 호스트 {label} 는 키 인증이 필요합니다 (경유 호스트의 비밀번호 인증은 미지원) — {agent_message}",
            en: "Jump host {label} needs key authentication (password authentication for a jump host is not supported) — {agent_message}"
        ),
        // 문구는 [`at_jump`] 를 거치지 않지만 **진단은 같은 모양**이어야 한다 — 화면은
        // `cause` 로만 갈래를 가르므로, 여기만 `auth` 로 남으면 경유 실패 하나가 힌트를 잃는다.
        diag: OpenDiag::of(OpenCause::AuthKeyRejected)
            .with_identities_only(identities_only)
            .at_jump(label),
    }
}
