//! 인증 — ssh-agent → `IdentityFile` → 비밀번호 순(OpenSSH 와 같은 차례).
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

// ── 인증 ──

/// 입력값은 싣지 않는다.
pub(super) fn wrong_password() -> String {
    tr!(
        ko: "비밀번호가 올바르지 않습니다",
        en: "That password is not correct"
    )
}
pub(super) fn key_rejected() -> String {
    tr!(
        ko: "키 인증이 거부되어 비밀번호가 필요합니다",
        en: "Key authentication was rejected — a password is required"
    )
}

/// 경로만 적는다 — 암호구는 싣지 않는다.
fn key_file_unreadable(path: &str, e: &russh::keys::Error) -> String {
    tr!(
        ko: " — 키 파일 {path} 을(를) 읽지 못했습니다: {e}",
        en: " — could not read the key file {path}: {e}"
    )
}

/// 사유만 들고 나온다 — 최종 오류는 서버가 password 를 받는지 본 뒤에야 정해진다.
enum AgentOutcome {
    /// `identity` 는 에이전트가 그 키에 붙여 둔 설명이다 — 키 바이트는 앱에 들어오지 않는다.
    Success { identity: Option<String> },
    Rejected {
        message: String,
        remaining: Option<MethodSet>,
        /// 실제로 낸 키들의 지문 — 다음 단계(키 파일)가 같은 키를 또 내지 않게 한다.
        fingerprints: Vec<String>,
    },
    Unavailable { message: String },
}

impl AgentOutcome {
    fn unavailable(message: impl Into<String>) -> Self {
        AgentOutcome::Unavailable {
            message: message.into(),
        }
    }
}

/// 에이전트는 선택이다 — 꺼져 있다는 문구도 처방 없이 사정만 말한다. `allowed` 는 `IdentitiesOnly yes` 의 지문 화이트리스트(`None` = 전부).
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

    // RSA 키는 서버가 받아주는 해시를 골라야 한다.
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();

    let mut tried = 0usize;
    let mut skipped_certs = 0usize;
    let mut skipped_not_allowed = 0usize;
    let mut last_error: Option<String> = None;
    let mut remaining: Option<MethodSet> = None;
    let mut fingerprints: Vec<String> = Vec::new();

    for identity in identities {
        let (key, comment) = match identity {
            AgentIdentity::PublicKey { key, comment } => (key, comment),
            // OpenSSH 인증서 인증은 지원하지 않는다.
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

        // 지문은 키를 러시로 넘기기 전에 뜬다(아래에서 소유권이 떠난다).
        let fingerprint = known_hosts::fingerprint(&key);
        // 내지 않은 키는 `fingerprints` 에 적지 않는다 — 그 목록의 뜻은 "이미 내 봤다" 다.
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
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    // 하나도 내지 않았으면 `Rejected` 가 아니다 — "키를 냈는데 거부됐다"(공개키 설치를 권하는 자리)로 잘못 읽힌다.
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

/// 갈래의 기준은 하나다 — **공개키를 실제로 냈는가**(에이전트가 꺼져 있어도 파일 키를 냈으면 `AuthKeyRejected`).
/// `identities_only` · `locked_identity` 는 사유를 바꾸지 않고 진단에 플래그만 얹는다.
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

fn with_identities_only(err: SshOpenError, on: bool) -> SshOpenError {
    if !on {
        return err;
    }
    map_diag(err, |d| d.with_identities_only(true))
}

/// 문구는 여기서 바꾸지 않는다 — 처방은 부르는 자리마다 다르다(헤드리스는 `crate::headless` 의 `headless_locked_key_hint`).
fn with_locked_identity(err: SshOpenError, on: bool) -> SshOpenError {
    if !on {
        return err;
    }
    map_diag(err, |d| d.with_locked_identity(true))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Agent,
    /// 개인키는 핸드셰이크가 끝나기까지만 메모리에 있다 — 세션 표에는 경로 한 줄만 남는다.
    KeyFile,
    Password,
    /// 금고에 담겨 있던 비밀번호 — 사람이 방금 친 값과 사용자가 구분할 수 있어야 한다.
    PasswordVault,
    None,
}

#[derive(Debug, Clone)]
pub(crate) struct AuthUsed {
    pub method: AuthMethod,
    /// 에이전트 코멘트 또는 파일 키 경로 — 키 바이트도 암호구도 비밀번호도 들어가지 않는다.
    pub identity: Option<String>,
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

// ── 키 파일 인증 ──

/// 사람이 있는 접속만 `Ask` 다 — 헤드리스 위임 접속과 공개키 설치 검증은 `Skip`(잠긴 키는 조용히 건너뛴다).
#[derive(Clone, Copy)]
pub(crate) enum KeyUnlock<'a> {
    Ask {
        for_path: Option<&'a str>,
        /// 이 함수 스코프를 넘어 어디에도 복사하지 않는다.
        passphrase: Option<&'a str>,
        /// 사용자가 묻는 창을 취소한 경로들 — 없으면 취소가 곧바로 같은 물음으로 되돌아와 무한 루프가 된다.
        declined: &'a [String],
        stored: &'a [StoredKey],
    },
    /// 금고에 담긴 암호구는 쓴다 — 묻지 않고 여는 것이라 "물을 상대가 없다" 와 어긋나지 않는다.
    Skip { stored: &'a [StoredKey] },
}

/// (개인키 전체 경로, 암호구). 금고 조회는 블로킹이라 인증 루프 안에서 부르지 않는다 — 접속을 시작하는 자리에서 한 번 꺼내 들고 들어온다.
pub(crate) type StoredKey = (String, zeroize::Zeroizing<String>);

impl KeyUnlock<'_> {
    pub(crate) fn none() -> KeyUnlock<'static> {
        KeyUnlock::Skip { stored: &[] }
    }
}

/// 경로 비교는 [`Path`] 로 한다 — 문자열로 맞추면 표기 차이로 "담아 뒀는데 안 쓰는" 조용한 실패가 된다.
pub(super) fn stored_passphrase_for<'a>(stored: &'a [StoredKey], path: &Path) -> Option<&'a str> {
    stored
        .iter()
        .find(|(p, _)| Path::new(p) == path)
        .map(|(_, v)| v.as_str())
}

/// 경유 홉의 후보도 담는다 — 암호구는 경로가 열쇠라 홉을 가리지 않는다. 빼면 경유 호스트의 잠긴 키가 계속 물어 온다.
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
    // 홉마다 자기 홉의 규칙으로 편다 — 금고에서 꺼내는 값도 실제로 열 키와 같아야 한다.
    push(params.identity_file.as_deref(), params.identities_only);
    if let Some(j) = &params.jump {
        push(j.identity_file.as_deref(), j.identities_only);
    }
    out
}

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
    // 값은 같은 프로세스(세션 서버) 안에서 직접 꺼내 `Zeroizing` 으로만 들고 간다 — 파이프를 타지 않는다.
    // 금고가 없거나 잠겼으면 비어서 온다 — 오류가 아니다(금고는 옵트인이다).
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum KeyLoad {
    Locked,
    Wrong,
    Unreadable,
}

pub(super) fn classify_key_load(e: &russh::keys::Error, had_passphrase: bool) -> KeyLoad {
    match e {
        russh::keys::Error::KeyIsEncrypted => KeyLoad::Locked,
        // 러시의 복호 실패 값(`SshKey(Crypto)`)에 기대지 않는다 — 크레이트가 바뀔 때 조용히 어긋난다.
        _ if had_passphrase => KeyLoad::Wrong,
        _ => KeyLoad::Unreadable,
    }
}

/// 계산은 [`crate::keygen::pub_fingerprint`] 하나뿐이다 — 목록 화면과 같은 값이어야 에이전트의 키를 지문으로 거를 수 있다.
pub(super) fn file_key_fingerprint(path: &Path) -> Option<String> {
    crate::keygen::pub_fingerprint(path)
}

/// 암호구는 `load_secret_key` 호출 동안만 빌려 쓴다 — 복사 · 구조체 · 오류 문구에 싣지 않는다(지우는 것은 소유한 부르는 쪽 —
/// `Zeroizing`). 개인키는 이 `for` 한 바퀴 안에서만 산다(러시의 `PrivateKey` 는 드롭될 때 바이트를 문지른다).
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
                // 사실만 적어 둔다 — 무인 접속의 실패 문구가 "왜 키를 안 냈는지" 를 말할 수 있어야 한다.
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

/// 성공 갈래를 박스에 담는다 — clippy `large_enum_variant`.
enum Opened {
    Key {
        key: Box<russh::keys::PrivateKey>,
        from_vault: bool,
    },
    Locked {
        /// 사람이 방금 친 암호구가 틀렸다.
        wrong: bool,
        /// 금고에 담겨 있던 암호구로 열리지 않았다 — 담아 둔 값이 낡았다.
        stored_rejected: bool,
    },
    Unreadable(russh::keys::Error),
}

/// 방금 받은 암호구 → 금고 순서다 — 뒤집으면 금고를 갱신하러 온 새 값을 낡은 값이 이긴다.
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
                            // `wrong` 은 거짓이다 — "방금 친 것이 틀렸다" 는 뜻이고 사람은 아직 안 쳤다.
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

enum KeyFileOutcome {
    Success {
        identity: String,
        from_vault: bool,
    },
    Rejected {
        tried: usize,
        notes: String,
        remaining: Option<MethodSet>,
        locked_skipped: bool,
    },
    Locked {
        path: String,
        fingerprint: Option<String>,
        wrong: bool,
        stored_rejected: bool,
    },
    NotTried {
        notes: String,
        unreadable: bool,
        locked_skipped: bool,
    },
}

/// `password` 는 저장·캐시·로그 없이 러시로 넘기는 즉시 스코프를 떠난다. 사람이 방금 친 `password` 가 금고의
/// `stored_password` 를 이긴다 — 금고는 "묻는 자리" 를 대신할 뿐이다. `identities_only` 는 키 고르기만 좁힌다(비밀번호는 그대로).
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

    // ── 키 파일 ──
    // 에이전트가 이미 낸 키는 뺀다 — 같은 키를 두 번 내면 `MaxAuthTries` 만 태운다.
    let candidates = drop_keys_in_agent(candidates, &agent_fingerprints, &file_key_fingerprint);
    let mut keys_offered = false;
    let mut keys_unreadable = false;
    // 초깃값을 두지 않는다 — 떨어지는 두 갈래가 모두 적는다(두면 "쓰이지 않는 대입" 경고).
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
        let result = handle.authenticate_password(user, password).await;
        return match result {
            Ok(AuthResult::Success) => Ok(AuthUsed::of(AuthMethod::Password)),
            Ok(AuthResult::Failure { .. }) => Err(SshOpenError::password_required_with(
                OpenCause::AuthPasswordRejected,
                wrong_password(),
            )),
            Err(e) => Err(SshOpenError::auth_with(
                classify_auth(&e),
                tr!(
                    ko: "비밀번호 인증에 실패했습니다: {e}",
                    en: "Password authentication failed: {e}"
                ),
            )),
        };
    }

    let password_accepted = match remaining {
        Some(methods) => methods.contains(&MethodKind::Password),
        None => match handle.authenticate_none(user).await {
            Ok(AuthResult::Success) => return Ok(AuthUsed::of(AuthMethod::None)),
            Ok(AuthResult::Failure {
                remaining_methods, ..
            }) => remaining_methods.contains(&MethodKind::Password),
            Err(_) => false,
        },
    };

    // ── 금고 ──
    // 서버가 비밀번호를 받지 않으면 내 보지 않는다(`MaxAuthTries`). 한 번뿐이다 — 틀리면 곧바로 사람에게 넘긴다.
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

/// 점프 호스트는 키만 쓴다 — `password_required` 재시도 계약에는 "어느 호스트의 비밀번호인가" 를 담을 자리가 없다.
/// 암호구는 경로가 열쇠라 홉을 가리지 않으므로 `PassphraseRequired` 만 위로 올린다. `IdentitiesOnly` 는 이 별칭 자신의 값이다.
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

/// [`crate::copy_id`] 의 설치 후 검증 전용 — `unlock` 은 [`KeyUnlock::Skip`] 이어야 한다. 후보는 접속과 같은 규칙으로 좁힌다 —
/// 다르면 "이 키로 붙는다" 는 보고가 거짓말이 된다.
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
        KeyFileOutcome::Locked { .. } | KeyFileOutcome::NotTried { .. } => {
            if offered_agent {
                KeyAuthOutcome::Rejected
            } else {
                KeyAuthOutcome::NoSigner
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeyAuthOutcome {
    Ok,
    /// 키를 냈는데 거부됐다 — 서버 설정을 의심할 수 있는 유일한 자리.
    Rejected,
    /// 붙어 보지도 않았으므로 서버를 탓하지 않는다.
    NoSigner,
}

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
        SshOpenError::PasswordRequired {
            message,
            diag,
            stored_rejected,
        } => SshOpenError::PasswordRequired {
            message: wrap(message),
            diag: diag.at_jump(label),
            stored_rejected,
        },
        // 대화상자 계약 셋은 손대지 않는다 — 호스트 키 둘은 문자열로 접으면 TOFU 모달이 사라진다.
        keyed @ (SshOpenError::HostKeyUnknown { .. }
        | SshOpenError::HostKeyChanged { .. }
        | SshOpenError::PassphraseRequired { .. }) => keyed,
    }
}

/// 이미 별칭을 담고 있어 [`at_jump`] 를 거치지 않는다(두 번 적히지 않게).
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
        // 진단은 `at_jump` 와 같은 모양이어야 한다 — 화면은 `cause` 로만 갈래를 가른다.
        diag: OpenDiag::of(OpenCause::AuthKeyRejected)
            .with_identities_only(identities_only)
            .at_jump(label),
    }
}
