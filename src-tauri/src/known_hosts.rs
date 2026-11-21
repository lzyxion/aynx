//! known_hosts 호스트 키 검증 (TOFU) — russh 의 `known_hosts` 헬퍼의 `Result<bool, Error>` 를 3-상태(Known / Unknown / Changed)로
//! 정규화한다. `Ok(false)` 는 항목이 없거나 알고리즘이 달라 비교 대상이 아님이다.
//!
//! 기본 경로도 늘 `*_path` 계열로 부른다 — russh 의 기본 경로 헬퍼는 `std::env::home_dir()` 를 쓴다.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use data_encoding::BASE64_MIME;
use hmac::{Hmac, KeyInit, Mac};
use russh::keys::known_hosts::{
    check_known_hosts_path, known_host_keys_path, learn_known_hosts_path,
};
use russh::keys::{Error as KeyError, HashAlg, PublicKey, PublicKeyOrCertificate};
use sha1::Sha1;

use crate::i18n::tr;

/// 호스트 키 검증 결과. 프런트엔드로 그대로 직렬화된다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum HostKeyStatus {
    Known,
    /// 첫 접속(TOFU). 사용자 확인을 받은 뒤 [`learn`] 을 호출해야 한다.
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    /// 기록된 키와 다르다. MITM 가능성 — 기본적으로 접속을 거부한다.
    Changed {
        fingerprint: String,
        key_type: String,
        /// **기록돼 있던** 키의 지문 — 사람이 대조하는 것은 "무엇에서 무엇으로 바뀌었나" 다. 다시 읽어 못 찾으면 `None`.
        old_fingerprint: Option<String>,
    },
}

/// OpenSSH 스타일 지문 (`"SHA256:<base64-unpadded>"`) — `ssh-keygen -lf` 와 같은 값.
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

pub fn key_type(key: &PublicKey) -> String {
    key.algorithm().as_str().to_string()
}

/// 인증서는 CA 검증을 하지 않고 담긴 공개키만 꺼내 일반 키와 같이 취급한다.
pub fn extract_public_key(key: &PublicKeyOrCertificate) -> PublicKey {
    key.public_key()
}

/// 주석을 떼어낸 키 사본 — `ssh_key::PublicKey` 의 `==` 는 `comment` 까지 비교해, 주석 붙은 키(파일에서 읽은 키)를 넘기면
/// 같은 키인데도 `KeyChanged`(MITM 경고)가 난다.
fn without_comment(key: &PublicKey) -> PublicKey {
    PublicKey::new(key.key_data().clone(), "")
}

pub fn default_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("known_hosts"))
        .ok_or_else(
            || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
        )
}

pub fn check(host: &str, port: u16, key: &PublicKey) -> Result<HostKeyStatus, String> {
    check_at(host, port, key, default_path()?)
}

pub fn check_at<P: AsRef<Path>>(
    host: &str,
    port: u16,
    key: &PublicKey,
    path: P,
) -> Result<HostKeyStatus, String> {
    let path = path.as_ref();
    match check_known_hosts_path(host, port, &without_comment(key), path) {
        Ok(true) => Ok(HostKeyStatus::Known),
        Ok(false) => Ok(HostKeyStatus::Unknown {
            fingerprint: fingerprint(key),
            key_type: key_type(key),
        }),
        Err(KeyError::KeyChanged { .. }) => Ok(HostKeyStatus::Changed {
            fingerprint: fingerprint(key),
            key_type: key_type(key),
            // 표시용 근거이지 판정의 재료가 아니다 — 실패해도 검증 결과를 바꾸지 않는다.
            old_fingerprint: recorded_fingerprint_at(host, port, key, path),
        }),
        // 파일 파싱 실패·IO 오류는 검증 실패로 올린다 (조용히 통과시키면 안 된다).
        Err(e) => Err(tr!(
            ko: "known_hosts 검증 실패: {e}",
            en: "Could not check against known_hosts: {e}"
        )),
    }
}

pub fn learn(host: &str, port: u16, key: &PublicKey) -> Result<(), String> {
    learn_at(host, port, key, default_path()?)
}

/// 주석은 떼고 기록한다 ([`without_comment`] — OpenSSH 도 주석 없이 기록한다).
pub fn learn_at<P: AsRef<Path>>(
    host: &str,
    port: u16,
    key: &PublicKey,
    path: P,
) -> Result<(), String> {
    learn_known_hosts_path(host, port, &without_comment(key), path).map_err(
        |e| tr!(ko: "known_hosts 기록 실패: {e}", en: "Could not write to known_hosts: {e}"),
    )
}

// ---------------------------------------------------------------------------
// 지우기·교체 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
//
// 1. **남의 줄은 한 바이트도 건드리지 않는다** — 재직렬화하지 않고 조각을 그대로 이어 붙인다.
// 2. **마커 줄(`@cert-authority` · `@revoked`)은 지우지 않는다** — 정책 선언이고 CA 줄 하나가 수십 대를 덮을 수 있다(`ssh-keygen -R` 은 지운다).
// 3. **패턴 줄도 맞으면 지운다**(OpenSSH `match_pattern_list` 와 같은 규칙) — 여기서만 지우기가 검증보다 넓다(russh 검증은 패턴을
//    보지 않는다). `known_hosts` 는 OpenSSH 와 나눠 쓰는 파일이라, 남기면 앱에서 잊었는데 터미널 `ssh` 는 그대로 붙는다.
//    넓은 줄 하나가 수십 대를 함께 잊게 할 수 있다 — `ssh-keygen -R` 과 같은 알고 받은 동작이다.
// ---------------------------------------------------------------------------

/// known_hosts 가 이 대상을 적는 이름 — russh 의 `known_host_keys_path` · `learn_known_hosts_path` 와 같은 표기다.
pub fn host_pattern(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// glob 한 조각이 대상 글자와 **통째로** 맞는가 — OpenSSH 의 `match_pattern` 과 같은 규칙(문자 클래스 · 이스케이프 없음 ·
/// 대소문자 무시 · 대괄호는 글자 그대로).
///
/// 재귀로 짜지 않는다 — `*a*a*a*…` 같은 남의 줄에서 지수 시간이 난다.
fn glob_matches(pattern: &str, text: &str) -> bool {
    let p: Vec<u8> = pattern.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let t: Vec<u8> = text.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = pi;
            pi += 1;
            mark = ti;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

/// 쉼표로 이어진 **패턴 목록**이 이 대상을 덮는가 — OpenSSH 의 `match_pattern_list` 와 같다(부정 `!` 이 하나라도 맞으면 거짓).
fn pattern_list_matches(field: &str, host_port: &str) -> bool {
    let mut positive = false;
    for entry in field.split(',') {
        if entry.is_empty() || entry.starts_with("|1|") {
            continue;
        }
        let (negated, pattern) = match entry.strip_prefix('!') {
            Some(rest) => (true, rest),
            None => (false, entry),
        };
        if !glob_matches(pattern, host_port) {
            continue;
        }
        if negated {
            return false;
        }
        positive = true;
    }
    positive
}

/// 대상 글자는 `known_hosts` 표기 그대로라 다른 포트를 덮으려면 파일에 `[*.example.com]:2222` 로 적혀 있어야 한다 (OpenSSH 와 같다).
pub fn pattern_matches(pattern: &str, host: &str, port: u16) -> bool {
    pattern_list_matches(pattern, &host_pattern(host, port))
}

/// 해시된 항목(`|1|<salt>|<hash>`)이 이 대상을 가리키는가 — 깨진 항목은 조용히 건너뛴다(파일 하나가 통째로 못 쓰이면 안 된다).
fn hashed_matches(field: &str, host_port: &str) -> bool {
    for entry in field.split(',') {
        let Some(rest) = entry.strip_prefix("|1|") else {
            continue;
        };
        let mut parts = rest.split('|');
        let (Some(salt), Some(hash)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (Ok(salt), Ok(hash)) = (
            BASE64_MIME.decode(salt.as_bytes()),
            BASE64_MIME.decode(hash.as_bytes()),
        ) else {
            continue;
        };
        if let Ok(mac) = Hmac::<Sha1>::new_from_slice(&salt) {
            if mac
                .chain_update(host_port.as_bytes())
                .verify_slice(&hash)
                .is_ok()
            {
                return true;
            }
        }
    }
    false
}

pub fn field_matches(field: &str, host_port: &str) -> bool {
    hashed_matches(field, host_port) || pattern_list_matches(field, host_port)
}

/// 주석(`#`)·빈 줄·마커(`@…`)는 언제나 `false` 다.
pub fn line_targets(line: &str, host_port: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('@') {
        return false;
    }
    let Some(field) = trimmed.split_whitespace().next() else {
        return false;
    };
    field_matches(field, host_port)
}

pub fn forget(host: &str, port: u16) -> Result<usize, String> {
    forget_at(host, port, default_path()?)
}

/// 0 이면 파일을 건드리지 않는다 · 파일이 없으면 `Ok(0)`.
pub fn forget_at<P: AsRef<Path>>(host: &str, port: u16, path: P) -> Result<usize, String> {
    let path = path.as_ref();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => {
            return Err(tr!(
                ko: "known_hosts 를 읽지 못했습니다: {e}",
                en: "Could not read known_hosts: {e}"
            ))
        }
    };

    let target = host_pattern(host, port);
    let mut removed = 0usize;
    let mut out = String::with_capacity(content.len());
    // `split_inclusive` 라 각 조각이 자기 줄바꿈을 들고 있다 — 지운 줄 말고는 파일이 바이트 단위로 같다.
    for chunk in content.split_inclusive('\n') {
        if line_targets(chunk, &target) {
            removed += 1;
            continue;
        }
        out.push_str(chunk);
    }

    if removed == 0 {
        return Ok(0);
    }
    write_atomic(path, &out)?;
    Ok(removed)
}

/// 이 호스트/포트의 기록을 **새 키로 갈아 끼운다** — 지우고 나서 붙인다. 순서가 반대면 방금 적은 줄을 스스로 지운다.
pub fn replace_at<P: AsRef<Path>>(
    host: &str,
    port: u16,
    key: &PublicKey,
    path: P,
) -> Result<usize, String> {
    let path = path.as_ref();
    let removed = forget_at(host, port, path)?;
    learn_at(host, port, key, path)?;
    Ok(removed)
}

pub fn replace(host: &str, port: u16, key: &PublicKey) -> Result<usize, String> {
    replace_at(host, port, key, default_path()?)
}

fn recorded_fingerprint_at(host: &str, port: u16, key: &PublicKey, path: &Path) -> Option<String> {
    let recorded = known_host_keys_path(host, port, path).ok()?;
    recorded
        .into_iter()
        .find(|(_, k)| k.algorithm() == key.algorithm())
        .map(|(_, k)| fingerprint(&k))
}

/// 임시 파일에 쓰고 **제자리로 옮긴다**. 백업(`.bak`)은 두지 않는다 — `~/.ssh` 에 쌓여 다음 사람을 헷갈리게 한다.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| {
        tr!(
            ko: "known_hosts 의 상위 폴더를 알 수 없습니다",
            en: "Could not tell which folder known_hosts is in"
        )
    })?;
    // 같은 폴더에 만들어야 rename 이 같은 볼륨 안에서 끝난다.
    let tmp = dir.join(format!(".aynx-known_hosts-{}.tmp", std::process::id()));
    std::fs::write(&tmp, contents).map_err(|e| {
        tr!(
            ko: "known_hosts 임시 파일을 쓰지 못했습니다: {e}",
            en: "Could not write the temporary known_hosts file: {e}"
        )
    })?;
    // Windows 의 `rename` 도 대상이 있으면 덮어쓴다(MOVEFILE_REPLACE_EXISTING).
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        tr!(
            ko: "known_hosts 를 갈아 끼우지 못했습니다: {e}",
            en: "Could not swap in the new known_hosts: {e}"
        )
    })
}

#[cfg(test)]
mod tests;
