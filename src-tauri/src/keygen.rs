//! 키 쌍 만들기 — `ssh-keygen` 을 대신 불러 주고, `~/.ssh` 의 공개키 파일을 훑는다.
//!
//! **개인키의 바이트는 읽지 않는다** — 되받는 것은 경로·지문·공개키 한 줄뿐이다. 러시(`russh::keys`)로 직접 만들지 않는 것도
//! 그래서다(개인키가 우리 힙에 앉지 않고, 파일 권한·형식은 OpenSSH 가 단일 진실이다).
//!
//! 암호구(비밀번호와 같은 규칙): 저장하지 않는다 · 명령 인자(`-N`)로 한 번만 지난다 · 오류 문구는 [`scrub`] 을 지난다 ·
//! [`GeneratedKey`] 에 실을 자리가 없다. 인자로 넘기는 것은 알고 받은 한계다 — 프로세스 명령줄을 읽으려면 이미 같은 사용자
//! 권한이 필요하고 그 권한이면 개인키 파일을 읽는다(`ssh-keygen` 은 비대화형 다른 창구가 없다).
//!
//! 목록의 지문은 `ssh-keygen -lf` 가 아니라 [`crate::known_hosts::fingerprint`] 로 낸다 — 에이전트 키의 지문과 같은 함수여야
//! 설치 고르개가 겹치는 키를 거른다.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use russh::keys::PublicKey;

use crate::i18n::tr;
use crate::known_hosts;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const DEFAULT_KIND: &str = "ed25519";

const RSA_KIND: &str = "rsa";

/// 2048 은 이제 권장되지 않고, 8192 는 생성이 눈에 띄게 느리다.
const RSA_BITS: &str = "4096";

const SCRUBBED: &str = "***";

/// `#[derive(Debug)]` 가 붙어도 된다 — 경로와 공개키뿐이다(암호구도 개인키 바이트도 필드에 없다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    pub private_path: String,
    pub public_path: String,
    pub fingerprint: String,
    pub public_key_line: String,
}

/// `~/.ssh` 에서 찾은 키 파일 하나 — [`crate::copy_id::AgentKey`] 와 같은 알파벳이다(`fingerprint` · `kind` · `public_line`).
/// 설치 고르개가 두 목록을 섞어 지문으로 겹치는 것을 거른다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile {
    pub private_path: String,
    pub public_path: String,
    pub fingerprint: String,
    pub comment: String,
    pub kind: String,
    /// 파일의 글자 그대로가 아니라 다시 조립한 한 줄이다 — 제어 문자가 섞인 주석이 한 줄을 두 줄로 만들지 못하게.
    pub public_line: String,
}

/// `~/.ssh/<name>` 으로 이어 붙고 그대로 `ssh-keygen -f` 의 인자가 된다 — `~/.ssh` 밖으로 벗어나거나(`:` 는 드라이브 ·
/// 대체 데이터 스트림까지 막는다) `-` 로 시작해 옵션으로 읽히는 이름을 막는다.
fn validate_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(tr!(ko: "키 이름을 입력하세요", en: "Enter a key name"));
    }
    let bad = name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains("..")
        || name.starts_with('-')
        || name.starts_with('.')
        || name.chars().any(|c| c.is_whitespace() || c.is_control());
    if bad {
        return Err(tr!(
            ko: "키 이름에는 경로 구분자(/ \\)·공백·`..` 을 쓸 수 없고 `-`·`.` 으로 시작할 수 \
                 없습니다 — 예: id_ed25519_web01",
            en: "A key name cannot contain path separators (/ \\), whitespace or `..`, and cannot \
                 start with `-` or `.` — for example id_ed25519_web01"
        ));
    }
    Ok(name.to_string())
}

/// 둘만 받는다 — RSA 는 ed25519 를 받지 않는 낡은 서버를 위한 유일한 후퇴로다. ECDSA 는 선택지만 늘린다.
fn canonical_kind(raw: &str) -> Result<&'static str, String> {
    let other = raw.trim().to_ascii_lowercase();
    if other.is_empty() || other == DEFAULT_KIND {
        return Ok(DEFAULT_KIND);
    }
    if other == RSA_KIND {
        return Ok(RSA_KIND);
    }
    Err(tr!(
        ko: "알 수 없는 키 종류입니다: {other} (ed25519 또는 rsa)",
        en: "Unknown key type: {other} (ed25519 or rsa)"
    ))
}

/// `-N <값>` 의 그 값을 `***` 로 바꾼다 — 사용법(usage)에 명령줄이 그대로 섞여 나오는 `ssh-keygen` 빌드가 있다.
/// 낱말 경계를 본다(`--N ` · `foo-N ` 은 우리가 준 플래그가 아니다).
fn strip_n_flag(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("-N ") {
        let boundary = at == 0 || rest.as_bytes()[at - 1].is_ascii_whitespace();
        let (head, tail) = rest.split_at(at + "-N ".len());
        out.push_str(head);
        rest = tail;
        if !boundary {
            continue;
        }
        let end = tail.find(char::is_whitespace).unwrap_or(tail.len());
        out.push_str(SCRUBBED);
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

/// 바깥으로 나갈 글자에서 암호구를 지운다 — 오류 경로는 전부 이 문을 지난다.
///
/// 알고 받은 한계: 암호구가 한두 글자면 본문의 평범한 글자까지 `***` 가 된다 — 새어 나간 암호구보다 낫다.
fn scrub(text: &str, passphrase: &str) -> String {
    let stripped = strip_n_flag(text);
    if passphrase.is_empty() {
        stripped
    } else {
        stripped.replace(passphrase, SCRUBBED)
    }
}

/// 공개키 한 줄을 뜯어 다시 조립한다 — 주석에 제어 문자가 섞이면 서버의 `authorized_keys` 에서 두 줄이 된다.
fn describe_line(line: &str) -> Result<(PublicKey, String), String> {
    let key = PublicKey::from_openssh(line.trim()).map_err(|e| {
        tr!(
            ko: "공개키 한 줄을 읽지 못했습니다: {e}",
            en: "Could not read the public key line: {e}"
        )
    })?;
    let body = PublicKey::new(key.key_data().clone(), "")
        .to_openssh()
        .map_err(|e| {
            tr!(
                ko: "공개키를 openssh 형식으로 옮기지 못했습니다: {e}",
                en: "Could not convert the public key to openssh format: {e}"
            )
        })?;
    let rebuilt = crate::copy_id::public_line(&body, key.comment().as_str().unwrap_or(""));
    Ok((key, rebuilt))
}

/// 개인키 경로 옆의 `.pub` 을 읽어 **지문 한 줄**을 낸다 (없거나 못 읽으면 `None`).
///
/// [`list_at`] · 설치 고르개 · [`crate::ssh`] 의 "에이전트에 이미 있는 키 빼기" 가 같은 값을 봐야 한다 — 어긋나면 같은 키를
/// 두 번 내서 MaxAuthTries 를 태운다.
pub(crate) fn pub_fingerprint(private_path: &Path) -> Option<String> {
    let mut public = private_path.as_os_str().to_os_string();
    public.push(".pub");
    let raw = std::fs::read_to_string(PathBuf::from(public)).ok()?;
    describe_line(&raw)
        .ok()
        .map(|(key, _)| known_hosts::fingerprint(&key))
}

// ---------------------------------------------------------------------------
// 경로
// ---------------------------------------------------------------------------

fn ssh_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh"))
        .ok_or_else(|| {
            tr!(
                ko: "홈 디렉터리를 찾을 수 없습니다",
                en: "Could not find the home directory"
            )
        })
}

/// 디렉터리를 만들고 **권한을 좁힌다** — OS 를 타는 이 모듈의 유일한 자리(CLAUDE.md).
/// `~/.ssh` 가 남에게 열려 있으면 sshd · ssh 가 키를 거부한다(`StrictModes`).
#[cfg(unix)]
fn restrict_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| {
        tr!(
            ko: "{dir} 의 권한을 좁히지 못했습니다: {e}",
            en: "Could not restrict the permissions of {dir}: {e}",
            dir = dir.display(),
        )
    })
}

/// Windows·그 밖: **일부러 아무것도 하지 않는다.**
///
/// 사용자 프로필 아래에 새로 만든 폴더는 상속 ACL 만으로 이미 그 사용자(+관리자)에게만
/// 열려 있고, Windows OpenSSH 는 POSIX 모드를 보지 않는다. ACL 을 직접 손대려면
/// `icacls` 를 부르거나 windows-sys 를 새로 들여야 하는데, 얻는 것이 없다.
/// (Linux·macOS 를 빌드하기 시작하면 위쪽 `#[cfg(unix)]` 가 그때 몸통이 된다.)
#[cfg(not(unix))]
fn restrict_dir(_dir: &Path) -> Result<(), String> {
    Ok(())
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    let fresh = !dir.exists();
    std::fs::create_dir_all(dir).map_err(|e| {
        tr!(
            ko: "{dir} 디렉터리를 만들지 못했습니다: {e}",
            en: "Could not create the directory {dir}: {e}",
            dir = dir.display(),
        )
    })?;
    if fresh {
        restrict_dir(dir)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 생성
// ---------------------------------------------------------------------------

fn missing_binary() -> String {
    tr!(
        ko: "ssh-keygen 을 찾지 못했습니다 — Windows 설정 → 앱 → 선택적 기능에서 \
             \"OpenSSH 클라이언트\" 를 설치한 뒤 앱을 다시 시작하세요",
        en: "Could not find ssh-keygen — install the \"OpenSSH Client\" optional feature \
             (Windows Settings → Apps → Optional features) and restart the app"
    )
}

/// 실패 경로가 모두 [`scrub`] 을 지난다는 것이 이 함수의 계약이다.
fn generate_at(
    dir: &Path,
    name: &str,
    kind: &str,
    passphrase: &str,
    comment: &str,
) -> Result<GeneratedKey, String> {
    let name = validate_name(name)?;
    let kind = canonical_kind(kind)?;

    let private = dir.join(&name);
    let public = dir.join(format!("{name}.pub"));
    // **덮어쓰기는 없다.** 개인키를 덮어쓰면 그 키로 붙던 서버 전부가 한 번에 잠긴다.
    for path in [&private, &public] {
        if path.exists() {
            return Err(tr!(
                ko: "{path} 이(가) 이미 있습니다 — 다른 이름을 쓰세요",
                en: "{path} already exists — choose a different name",
                path = path.display(),
            ));
        }
    }
    ensure_dir(dir)?;

    // 주석은 `authorized_keys` 한 줄에 그대로 들어간다 — `copy_id` 와 같은 함수로 제어 문자를 턴다.
    let comment = crate::copy_id::sanitize_comment(comment);

    let mut cmd = Command::new("ssh-keygen");
    cmd.arg("-q").arg("-t").arg(kind);
    if kind == RSA_KIND {
        cmd.arg("-b").arg(RSA_BITS);
    }
    cmd.arg("-f").arg(&private);
    // 암호구는 **여기 한 번**만 지난다. 빈 문자열이면 암호구 없는 키다 (`-N ""`).
    cmd.arg("-N").arg(passphrase);
    // 주석이 비면 `-C` 를 붙이지 않는다 — `ssh-keygen` 이 `user@hostname` 을 스스로 채운다.
    if !comment.is_empty() {
        cmd.arg("-C").arg(&comment);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            missing_binary()
        } else {
            // 이 오류는 우리가 만든 것이 아니라 OS 가 준 것이라 명령줄이 실릴 수 있다.
            scrub(
                &tr!(
                    ko: "ssh-keygen 을 실행하지 못했습니다: {e}",
                    en: "Could not run ssh-keygen: {e}"
                ),
                passphrase,
            )
        }
    })?;

    if !out.status.success() {
        let detail = scrub(&String::from_utf8_lossy(&out.stderr), passphrase)
            .trim()
            .to_string();
        let tail = if detail.is_empty() {
            match out.status.code() {
                Some(c) => tr!(ko: " (종료 코드 {c})", en: " (exit code {c})"),
                None => String::new(),
            }
        } else {
            format!(" — {detail}")
        };
        return Err(tr!(
            ko: "키를 만들지 못했습니다{tail}",
            en: "Could not create the key{tail}"
        ));
    }

    let raw = std::fs::read_to_string(&public).map_err(|e| {
        tr!(
            ko: "만든 공개키 파일을 읽지 못했습니다: {e}",
            en: "Could not read the public key file that was created: {e}"
        )
    })?;
    let (key, line) = describe_line(&raw)?;

    Ok(GeneratedKey {
        private_path: private.display().to_string(),
        public_path: public.display().to_string(),
        fingerprint: known_hosts::fingerprint(&key),
        public_key_line: line,
    })
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

/// 읽히지 않는 `.pub` 은 조용히 건너뛴다(`~/.ssh` 에는 인증서 · 백업이 섞인다) · 짝이 되는 개인키가 있는 것만 싣는다
/// (호스트 폼의 `IdentityFile` · 설치 고르개가 개인키를 전제한다).
fn list_at(dir: &Path) -> Result<Vec<KeyFile>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(tr!(
                ko: "{dir} 를 읽지 못했습니다: {e}",
                en: "Could not read {dir}: {e}",
                dir = dir.display(),
            ))
        }
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let public = entry.path();
        if public.extension().and_then(|e| e.to_str()) != Some("pub") {
            continue;
        }
        let private = public.with_extension("");
        if !private.is_file() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&public) else {
            continue;
        };
        let Ok((key, line)) = describe_line(&raw) else {
            continue;
        };
        out.push(KeyFile {
            private_path: private.display().to_string(),
            public_path: public.display().to_string(),
            fingerprint: known_hosts::fingerprint(&key),
            comment: crate::copy_id::sanitize_comment(key.comment().as_str().unwrap_or("")),
            kind: known_hosts::key_type(&key),
            public_line: line,
        });
    }
    // `read_dir` 의 순서는 OS 가 정한다 — 새로 고칠 때마다 뒤바뀌지 않게 경로로 고정한다.
    out.sort_by(|a, b| a.private_path.cmp(&b.private_path));
    Ok(out)
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// `passphrase` 가 `None`·`Some("")` 이면 암호구 없는 키다 — 그 값은 블로킹 클로저 안에서만 살고 아무 데도 남지 않는다.
#[tauri::command]
pub async fn generate_ssh_key(
    name: String,
    kind: String,
    passphrase: Option<String>,
    comment: String,
) -> Result<GeneratedKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ssh_dir()?;
        generate_at(
            &dir,
            &name,
            &kind,
            passphrase.as_deref().unwrap_or(""),
            &comment,
        )
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "키 생성 작업을 실행하지 못했습니다: {e}",
            en: "Could not run the key generation task: {e}"
        )
    })?
}

#[tauri::command]
pub async fn list_ssh_key_files() -> Result<Vec<KeyFile>, String> {
    tauri::async_runtime::spawn_blocking(|| list_at(&ssh_dir()?))
        .await
        .map_err(|e| {
            tr!(
                ko: "키 목록 작업을 실행하지 못했습니다: {e}",
                en: "Could not run the key listing task: {e}"
            )
        })?
}

#[cfg(test)]
mod tests;
