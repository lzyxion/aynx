//! known_hosts 호스트 키 검증 (TOFU).
//!
//! russh 0.63.1 의 `russh::keys::known_hosts` 헬퍼 위에 얇게 얹은 계층이다.
//! russh 는 "일치/불일치" 를 `Result<bool, Error>` 로만 알려주기 때문에,
//! UI 가 필요로 하는 3-상태(Known / Unknown / Changed)로 정규화하고
//! 지문 문자열을 함께 실어 준다.
//!
//! russh 쪽 실제 시그니처 (docs.rs/russh/0.63.1 및 크레이트 소스 확인):
//!
//! ```text
//! pub fn check_known_hosts_path<P: AsRef<Path>>(
//!     host: &str, port: u16, pubkey: &ssh_key::PublicKey, path: P,
//! ) -> Result<bool, russh::keys::Error>
//!
//! pub fn learn_known_hosts_path<P: AsRef<Path>>(
//!     host: &str, port: u16, pubkey: &ssh_key::PublicKey, path: P,
//! ) -> Result<(), russh::keys::Error>
//! ```
//!
//! 반환값 해석:
//! - `Ok(true)`  → 같은 알고리즘의 항목이 있고 키가 일치 → `Known`
//! - `Ok(false)` → 해당 host 항목이 없거나, 있어도 알고리즘이 달라 비교 대상이 아님 → `Unknown`
//! - `Err(Error::KeyChanged { line })` → 같은 알고리즘인데 키가 다름 → `Changed` (MITM 경고)
//!
//! 참고: `russh` 의 기본 경로 헬퍼는 비공개(`known_hosts_path()`)이고
//! `std::env::home_dir()` 를 쓴다. 우리는 Windows 에서 더 정확한
//! `dirs::home_dir()` (이미 의존성에 있음) 로 경로를 직접 계산해
//! 항상 `*_path` 계열을 호출한다 — 덕분에 기본 경로와 테스트 경로가
//! 완전히 같은 코드 경로를 탄다.

#![allow(dead_code)] // 아직 invoke_handler 에 붙지 않은 상태 (SSH 세션 작업에서 연결 예정)

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
///
/// ```json
/// { "status": "known" }
/// { "status": "unknown", "fingerprint": "SHA256:...", "key_type": "ssh-ed25519" }
/// { "status": "changed", "fingerprint": "SHA256:...", "key_type": "ssh-ed25519" }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum HostKeyStatus {
    /// known_hosts 에 기록이 있고 키가 일치한다. 그냥 진행하면 된다.
    Known,
    /// 첫 접속(TOFU). UI 가 지문을 보여주고 사용자 확인을 받은 뒤 [`learn`] 을 호출해야 한다.
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    /// 기록된 키와 다르다. MITM 가능성 — 기본적으로 접속을 거부하고 경고해야 한다.
    Changed {
        fingerprint: String,
        key_type: String,
        /// **기록돼 있던** 키의 지문 (같은 알고리즘의 항목). 파일을 다시 읽어 찾지 못하면 `None`.
        ///
        /// 다이얼로그가 "옛 지문 → 새 지문" 두 줄을 나란히 보여 주려면 이것이 필요하다.
        /// 사람이 대조하는 값은 "새 지문이 무엇인가" 가 아니라 **"무엇에서 무엇으로 바뀌었나"**
        /// 다 — 옛 것을 안 보여 주면 승인/거부를 가를 근거가 화면에 없다.
        old_fingerprint: Option<String>,
    },
}

/// OpenSSH 스타일 지문 문자열 (`"SHA256:<base64-unpadded>"`).
///
/// `ssh-keygen -lf` 가 출력하는 값과 동일하다.
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// 키 알고리즘 이름 (`"ssh-ed25519"`, `"ecdsa-sha2-nistp256"`, `"ssh-rsa"` …).
pub fn key_type(key: &PublicKey) -> String {
    key.algorithm().as_str().to_string()
}

/// russh 의 `Handler::check_server_key` 는 `&PublicKeyOrCertificate` 를 넘겨준다.
/// 여기서 실제 공개키를 꺼낸다.
///
/// 인증서(certificate) 케이스는 지금 단계에서는 CA 검증을 하지 않고
/// 인증서에 담긴 공개키만 꺼내 일반 키와 동일하게 취급한다.
/// (russh 의 `PublicKeyOrCertificate::public_key()` 가 두 variant 를 모두 처리한다.)
pub fn extract_public_key(key: &PublicKeyOrCertificate) -> PublicKey {
    key.public_key()
}

/// 주석(comment)을 떼어낸 키 사본을 만든다.
///
/// **중요**: `ssh_key::PublicKey` 의 `PartialEq` 는 `key_data` 뿐 아니라 `comment` 까지
/// 비교하도록 derive 되어 있다. russh 의 `check_known_hosts_path` 는 그 `==` 를 그대로 쓰므로,
/// 주석이 붙은 키(예: `PublicKey::from_openssh("ssh-ed25519 AAAA... user@host")`)를 넘기면
/// known_hosts 에서 읽어온 주석 없는 키와 "알고리즘 같음 + 키 다름" 으로 판정되어
/// **동일한 키인데도 `KeyChanged` (MITM 경고)** 가 나온다.
/// 실제 SSH 핸드셰이크로 받은 키에는 주석이 없어 평소엔 드러나지 않지만,
/// 파일에서 읽은 키를 검증하는 경로에서는 반드시 정규화해야 한다.
fn without_comment(key: &PublicKey) -> PublicKey {
    PublicKey::new(key.key_data().clone(), "")
}

/// 기본 known_hosts 경로 (`~/.ssh/known_hosts`).
pub fn default_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("known_hosts"))
        .ok_or_else(
            || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
        )
}

/// 기본 known_hosts 에 대해 호스트 키를 검증한다.
pub fn check(host: &str, port: u16, key: &PublicKey) -> Result<HostKeyStatus, String> {
    check_at(host, port, key, default_path()?)
}

/// 임의 경로의 known_hosts 에 대해 호스트 키를 검증한다. (테스트/커스텀 프로파일용)
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
            // 같은 파일을 한 번 더 읽어 **그 자리에 적혀 있던** 키의 지문을 꺼낸다. 실패해도
            // 검증 결과를 바꾸지 않는다(`None` 이면 다이얼로그가 옛 지문 줄을 생략한다) —
            // 이 값은 사람이 읽을 근거이지 판정의 재료가 아니다.
            old_fingerprint: recorded_fingerprint_at(host, port, key, path),
        }),
        // 파일 파싱 실패·IO 오류 등은 검증 실패로 올린다 (조용히 통과시키면 안 된다).
        Err(e) => Err(tr!(
            ko: "known_hosts 검증 실패: {e}",
            en: "Could not check against known_hosts: {e}"
        )),
    }
}

/// 기본 known_hosts 에 호스트 키를 추가한다 (TOFU 승인).
pub fn learn(host: &str, port: u16, key: &PublicKey) -> Result<(), String> {
    learn_at(host, port, key, default_path()?)
}

/// 임의 경로의 known_hosts 에 호스트 키를 추가한다.
///
/// russh 가 상위 디렉터리(`~/.ssh`)를 알아서 만들고, 파일 끝 개행도 맞춰 준다.
/// 포트가 22 가 아니면 `[host]:port` 형식으로 기록된다.
/// 주석은 떼고 기록한다 ([`without_comment`] 의 설명 참고 — OpenSSH 의 known_hosts 도
/// 주석 없이 기록한다).
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
// 읽기(검증)는 russh 가 한다. **쓰기는 append 하나뿐**이었다 — 그래서 "서버를 재설치했다"
// 는 평범한 사건에 사람이 손으로 `known_hosts` 를 열어 줄을 찾아 지워야 했다. 여기서 그
// 한 가지를 더한다: **이 호스트의 줄만 지운다.**
//
// 규칙 셋이 이 절 전체를 지배한다.
//
// 1. **남의 줄은 한 바이트도 건드리지 않는다.** 파일을 재직렬화하지 않고 `split_inclusive`
//    로 조각을 그대로 이어 붙인다 — 주석·빈 줄·CRLF·줄 끝 공백이 전부 원본 그대로 남는다.
// 2. **마커 줄(`@cert-authority` · `@revoked`)은 건드리지 않는다.** 그 둘은 "이 호스트의 키"
//    가 아니라 정책 선언이고, CA 줄 하나가 수십 대를 덮고 있을 수 있다. (OpenSSH 의
//    `ssh-keygen -R` 은 지우지만, 우리는 지우지 않는 쪽이 되돌릴 수 없는 손해가 없다.)
// 3. **패턴 줄(`*.example.com` · `10.0.0.*` · `!neg`)도 맞으면 지운다** (2026-09-17 —
//    앞서는 "일치로 보지 않는다" 였다). 판정은 OpenSSH 의 `match_pattern_list` 와 같은
//    규칙이고([`pattern_matches`]), 그래서 `ssh-keygen -R` 과 같은 줄을 고른다.
//
//    **이 한 가지에서만 지우기가 검증보다 넓다.** russh 의 `match_hostname` 은 패턴을 보지
//    않으므로(정확한 이름 + 해시뿐) 이 앱의 검증은 `*.example.com` 줄로 서버를 믿지 않는다.
//    그래도 지우는 쪽을 넓히는 이유는 `known_hosts` 가 **OpenSSH 와 나눠 쓰는 파일**이기
//    때문이다: 사람이 "이 서버의 키를 잊어라" 라고 말하는 뜻은 "`ssh` 도 더는 믿지 않는다"
//    이고, 그 줄을 남겨 두면 앱에서 잊었는데 터미널의 `ssh` 는 그대로 붙는다.
//    대가는 **넓은 줄 하나가 수십 대를 덮고 있을 수 있다**는 것이다(그때는 그 수십 대가
//    함께 잊힌다) — `ssh-keygen -R` 의 동작과 같고, 되돌리는 길은 다시 TOFU 를 받는 것이다.
// ---------------------------------------------------------------------------

/// known_hosts 가 이 대상을 적는 이름 — 22 번이면 `host`, 아니면 `[host]:port`.
/// (russh 의 `known_host_keys_path` · `learn_known_hosts_path` 와 같은 표기다.)
pub fn host_pattern(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// glob 한 조각이 대상 글자와 **통째로** 맞는가 — `*` 는 0글자 이상, `?` 는 정확히 한 글자.
///
/// OpenSSH 의 `match_pattern` 과 같은 규칙이다: 문자 클래스(`[a-z]`)도 이스케이프도 없고,
/// 대소문자는 무시한다(호스트 이름의 규칙). 대괄호는 **글자 그대로**라 `[*.example.com]:2222`
/// 같은 패턴이 `[web.example.com]:2222` 를 자연스럽게 덮는다.
///
/// 되돌아가기는 별표 자리 하나만 기억하는 고전적인 2-포인터 방식이다 — 재귀로 짜면
/// `*a*a*a*…` 같은 줄에서 지수 시간이 나는데, 그 줄이 남의 `known_hosts` 에서 올 수 있다.
fn glob_matches(pattern: &str, text: &str) -> bool {
    let p: Vec<u8> = pattern.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let t: Vec<u8> = text.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    // `star` 는 마지막으로 지나온 `*` 의 자리, `mark` 는 그때 대상에서 서 있던 자리.
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
            // 막혔다 — 마지막 `*` 가 한 글자를 더 먹는다.
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

/// 쉼표로 이어진 **패턴 목록**이 이 대상을 덮는가 — OpenSSH 의 `match_pattern_list` 와 같다.
///
/// 규칙 둘: **부정(`!`)이 하나라도 맞으면 그 자리에서 거짓**이고(순서와 무관하다),
/// 그렇지 않으면 긍정이 하나라도 맞아야 참이다. 해시된 항목(`|1|…`)은 여기서 건너뛴다 —
/// 그쪽은 글자가 아니라 HMAC 으로 맞대어 보는 것이라 [`hashed_matches`] 의 몫이다.
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

/// 이 호스트 필드가 **패턴으로** 이 대상을 덮는가 — **순수 함수**(유닛 테스트 대상).
///
/// 대상 글자는 `known_hosts` 가 적는 표기 그대로다 ([`host_pattern`] — 22번이면 `host`,
/// 아니면 `[host]:port`). 그래서 `*.example.com` 은 22번의 `web.example.com` 을 덮고,
/// 다른 포트를 덮으려면 파일에 `[*.example.com]:2222` 로 적혀 있어야 한다 (OpenSSH 와 같다).
pub fn pattern_matches(pattern: &str, host: &str, port: u16) -> bool {
    pattern_list_matches(pattern, &host_pattern(host, port))
}

/// 해시된 항목(`|1|<salt>|<hash>`)이 이 대상을 가리키는가.
///
/// `HMAC-SHA1(salt, host_port)` 이 `hash` 와 같은가를 본다 — OpenSSH 의 `HashKnownHosts yes`
/// 가 만드는 모양이고, 계산 방식은 russh 의 검증과 **같다**. 소금·해시가 깨진 항목은 조용히
/// 건너뛴다 (파일 하나가 통째로 못 쓰이면 안 된다).
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

/// 줄 앞머리의 **호스트 필드**가 이 대상을 가리키는가 — **순수 함수**(유닛 테스트 대상).
///
/// 필드는 쉼표로 이어진 항목들이고, 둘 중 한 갈래로 판정한다.
/// - **해시된 이름** (`|1|<salt>|<hash>`) → [`hashed_matches`].
/// - 그 밖 전부 → [`pattern_list_matches`]. 와일드카드가 없는 이름은 자기 자신하고만 맞으므로
///   예전의 "글자 그대로 비교" 가 이 안에 그대로 들어 있다 (대소문자만 무시하게 됐다).
pub fn field_matches(field: &str, host_port: &str) -> bool {
    hashed_matches(field, host_port) || pattern_list_matches(field, host_port)
}

/// 이 줄이 **지울 대상**인가 — **순수 함수**(유닛 테스트 대상).
///
/// `line` 은 개행을 포함한 조각이어도 된다. 주석(`#`)·빈 줄·마커(`@…`)는 언제나 `false` 다.
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

/// 기본 known_hosts 에서 이 호스트/포트의 항목을 전부 지운다 — 지운 줄 수를 돌려준다.
pub fn forget(host: &str, port: u16) -> Result<usize, String> {
    forget_at(host, port, default_path()?)
}

/// 임의 경로에서 이 호스트/포트의 항목을 전부 지운다 (0 이면 파일을 건드리지 않는다).
///
/// 파일이 없으면 오류가 아니라 `Ok(0)` 이다 — "지울 것이 없다" 는 실패가 아니다.
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
    // `split_inclusive` 라 각 조각이 자기 줄바꿈(`\n` · `\r\n` 의 `\r` 포함)을 그대로 들고 있다.
    // 남길 조각은 손대지 않고 이어 붙이므로 **지운 줄 말고는 파일이 바이트 단위로 같다.**
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

/// 이 호스트/포트의 기록을 **새 키로 갈아 끼운다** — 지운 줄 수를 돌려준다.
///
/// 지우고 나서 [`learn_at`] 으로 한 줄을 붙인다. 순서가 반대면 방금 적은 줄을 스스로 지운다.
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

/// 기본 known_hosts 에서 이 호스트/포트의 기록을 새 키로 갈아 끼운다.
pub fn replace(host: &str, port: u16, key: &PublicKey) -> Result<usize, String> {
    replace_at(host, port, key, default_path()?)
}

/// 이 호스트/포트에 **같은 알고리즘으로** 기록돼 있던 키의 지문 (없으면 `None`).
///
/// [`HostKeyStatus::Changed`] 의 `old_fingerprint` 를 채우는 데만 쓴다 — 판정이 아니라 표시용이라
/// 파일을 못 읽어도 조용히 `None` 이다.
fn recorded_fingerprint_at(host: &str, port: u16, key: &PublicKey, path: &Path) -> Option<String> {
    let recorded = known_host_keys_path(host, port, path).ok()?;
    recorded
        .into_iter()
        .find(|(_, k)| k.algorithm() == key.algorithm())
        .map(|(_, k)| fingerprint(&k))
}

/// 임시 파일에 쓰고 **제자리로 옮긴다** — 중간에 죽어도 반쯤 쓰인 known_hosts 가 남지 않는다.
///
/// 백업(`.bak`)은 두지 않는다. 지우는 줄이 이 호스트의 것뿐이고(위 규칙 1), 백업 파일이
/// `~/.ssh` 에 쌓이면 그 자체가 다음 사람을 헷갈리게 한다.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| {
        tr!(
            ko: "known_hosts 의 상위 폴더를 알 수 없습니다",
            en: "Could not tell which folder known_hosts is in"
        )
    })?;
    // 같은 폴더에 만들어야 rename 이 같은 볼륨 안에서 끝난다(다른 볼륨이면 복사가 된다).
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
