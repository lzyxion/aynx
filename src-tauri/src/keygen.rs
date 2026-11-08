//! 키 쌍 만들기 — `ssh-keygen` 을 대신 불러 주고, `~/.ssh` 의 공개키 파일을 훑는다.
//!
//! ## 왜 이것이 없었나
//!
//! 이 앱은 [`crate::ssh`] 의 설계 원칙대로 **개인키 파일을 읽지 않는다**. 서명은 전부
//! ssh-agent 에 맡기고, 서버에 심을 공개키도 에이전트가 주는 것만 썼다
//! ([`crate::copy_id`]). 그 원칙 때문에 "키가 아직 하나도 없는 사람" 이 갈 곳이 없었다 —
//! 공개키 설치 모달은 `ssh-add` 를 안내했지만, **더할 키 자체가 없으면** 그 안내가 막다른
//! 골목이다. 터미널을 따로 열어 `ssh-keygen` 을 치고 돌아와야 했다.
//!
//! 이 모듈은 그 한 걸음을 앱 안으로 들인다. 여전히 **개인키의 바이트는 읽지 않는다** —
//! 만드는 것은 `ssh-keygen` 이고, 우리가 되받는 것은 **경로·지문·공개키 한 줄**뿐이다.
//!
//! ## 왜 러시(러스트 안)에서 직접 만들지 않는가
//!
//! `russh::keys` 로 키를 만들어 파일로 쓸 수는 있다. 그러지 않는 이유가 셋이다.
//!
//! - **개인키 바이트가 우리 힙에 앉는다.** `ssh-keygen` 에 맡기면 개인키가 이 프로세스의
//!   메모리에 **한 번도** 들어오지 않는다. 이 앱이 지켜 온 선이 그것이다.
//!   (암호구는 인자로 지난다 — 아래 "암호구 취급" 참고.)
//! - **파일 권한·형식은 OpenSSH 가 단일 진실이다.** 개인키 파일 모드(0600)·새 형식
//!   (`-----BEGIN OPENSSH PRIVATE KEY-----`)·KDF 라운드 수를 우리가 흉내 내면 언젠가
//!   어긋나고, 어긋난 자리는 "만들었는데 ssh 가 안 읽는 키" 로 나타난다.
//! - **사용자가 검산할 수 있다.** 우리가 만든 키는 명령줄 `ssh-keygen` 이 만든 것과
//!   바이트로 같다.
//!
//! ## 암호구 취급 (비밀번호와 같은 규칙 — CLAUDE.md)
//!
//! - **저장하지 않는다.** 디스크에도, 모듈 상태에도, 로그에도 남기지 않는다.
//! - 명령 인자(`-N <암호구>`)로 **한 번** 지나고 그 프로세스와 함께 사라진다. Windows 에는
//!   `/proc/<pid>/cmdline` 같은 공개 창구가 없고, 프로세스 목록의 명령줄을 읽으려면 이미
//!   같은 사용자 권한이 필요하다 — 그 권한이면 어차피 개인키 파일 자체를 읽을 수 있다.
//!   (`ssh-keygen` 은 인자 말고 암호구를 받는 비대화형 창구를 주지 않는다. 대화형
//!   프롬프트에 PTY 로 붙여 쓰는 길은 표면이 훨씬 넓다.)
//! - **오류 문구에 실리지 않는다.** `ssh-keygen` 의 stderr 를 그대로 올리지 않고
//!   [`scrub`] 을 지난다: `-N <값>` 을 `***` 로 바꾸고, 혹시 본문에 그대로 박힌 암호구도
//!   지운다. 우리가 만든 문구에는 명령줄을 **애초에 싣지 않는다**.
//! - 구조체에 담지 않는다 — [`GeneratedKey`] 에는 암호구가 실릴 자리가 없다(필드 넷뿐).
//!
//! ## 목록은 왜 `ssh-keygen -lf` 를 부르지 않는가
//!
//! 지문은 `.pub` 한 줄만 있으면 나온다 — [`crate::known_hosts::fingerprint`] 가 이미 그
//! 계산(`SHA256:<base64>`)을 들고 있고, 에이전트 키의 지문도 **같은 함수**가 만든다.
//! 설치 고르개가 "에이전트에 이미 있는 키" 를 지문으로 걸러 내므로, 두 목록의 지문이 같은
//! 기계에서 나오는 것이 중요하다. 파일 하나당 프로세스 하나를 띄우지 않는 것은 덤이다.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use russh::keys::PublicKey;

use crate::i18n::tr;
use crate::known_hosts;

/// `CREATE_NO_WINDOW` — 콘솔 창이 번쩍이지 않게 한다.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 종류를 비워 보내면 이것 — 짧고 빠르고 요즘 서버라면 다 받는다.
const DEFAULT_KIND: &str = "ed25519";

/// ed25519 를 받지 않는 낡은 서버를 위한 유일한 후퇴로.
const RSA_KIND: &str = "rsa";

/// RSA 를 고른 경우의 길이. 2048 은 이제 권장되지 않고, 8192 는 생성이 눈에 띄게 느리다.
const RSA_BITS: &str = "4096";

/// 오류 문구에서 암호구가 있던 자리에 남는 글자.
const SCRUBBED: &str = "***";

// ---------------------------------------------------------------------------
// 프런트 계약
// ---------------------------------------------------------------------------

/// 방금 만든 키 쌍.
///
/// ```json
/// {
///   "privatePath": "C:\\Users\\wl\\.ssh\\id_ed25519_web01",
///   "publicPath":  "C:\\Users\\wl\\.ssh\\id_ed25519_web01.pub",
///   "fingerprint": "SHA256:47DEQpj8HBSa+/TImW+5JC…",
///   "publicKeyLine": "ssh-ed25519 AAAAC3NzaC1lZDI1… wl@box"
/// }
/// ```
///
/// `publicKeyLine` 은 **서버에 그대로 들어갈 한 줄**이라 곧바로
/// [`crate::copy_id::install_public_key_line`] 에 실을 수 있다 — 방금 만든 키를 설치하려고
/// 목록을 다시 훑을 필요가 없다.
///
/// `#[derive(Debug)]` 가 붙어 있는 것은 여기 담기는 것이 **경로와 공개키뿐**이기 때문이다
/// (암호구도 개인키 바이트도 필드에 없다 — [`crate::copy_id`] 가 `Debug` 를 거절하는 이유가
/// 여기서는 성립하지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKey {
    pub private_path: String,
    pub public_path: String,
    pub fingerprint: String,
    pub public_key_line: String,
}

/// `~/.ssh` 에서 찾은 키 파일 하나 (공개키 + 짝이 되는 개인키).
///
/// [`crate::copy_id::AgentKey`] 와 **일부러 같은 알파벳**이다 — `fingerprint` 는 같은 함수가
/// 만들고, `kind` 는 `AgentKey::key_type` 과 같은 `"ssh-ed25519"` 꼴이며, `public_line` 도
/// 같은 뜻(서버에 들어갈 한 줄)이다. 설치 고르개가 두 목록을 한 화면에 섞어 놓고 지문으로
/// 겹치는 것을 걸러 내려면 그래야 한다.
///
/// `private_path` 는 호스트 폼의 `IdentityFile` 칸이 받아 가는 값이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile {
    pub private_path: String,
    pub public_path: String,
    pub fingerprint: String,
    pub comment: String,
    /// `ssh-ed25519` · `ssh-rsa` … (`AgentKey::key_type` 과 같은 글자)
    pub kind: String,
    /// `authorized_keys` 에 들어갈 한 줄. **파일의 글자 그대로가 아니라** 다시 조립한 것이다
    /// ([`describe_line`] — 제어 문자가 섞인 주석이 한 줄을 두 줄로 만들지 못하게).
    pub public_line: String,
}

// ---------------------------------------------------------------------------
// 순수 함수 (테스트 대상)
// ---------------------------------------------------------------------------

/// 파일 이름 하나로 쓸 수 있는 글자인가 — **순수 함수**.
///
/// 이 값은 `~/.ssh/<name>` 으로 이어 붙고 그대로 `ssh-keygen -f` 의 인자가 된다. 그래서
/// 막아야 하는 것이 둘이다.
///
/// - **디렉터리를 벗어나는 것.** `/`·`\`·`..` 은 `~/.ssh` 밖의 파일을 덮어쓰게 한다.
///   Windows 의 드라이브 표기(`C:`)와 대체 데이터 스트림(`a:b`)도 `:` 하나로 함께 막힌다.
/// - **인자가 아닌 것으로 읽히는 것.** `-` 로 시작하면 `ssh-keygen` 이 옵션으로 읽는다.
///   공백이 들어가면 사용자가 보는 이름과 실제 파일 이름이 어긋나기 시작한다(따옴표는
///   `Command` 가 알아서 붙이므로 주입이 되지는 않지만, 이름으로서 쓸모가 없다).
///
/// 바깥 공백은 **다듬어 준다** — 입력칸에서 끌려 들어온 공백 하나로 사람을 막지 않는다.
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

/// 종류를 `ssh-keygen -t` 에 넘길 글자로 좁힌다 — **순수 함수**. 빈 값은 [`DEFAULT_KIND`].
///
/// 둘만 받는 이유: ed25519 는 기본값이고, RSA 는 **ed25519 를 받지 않는 낡은 서버**를 위한
/// 유일한 후퇴로다. ECDSA 는 그 사이를 메우지 못하면서 선택지만 늘린다.
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

/// `-N <값>` 의 그 값을 `***` 로 바꾼다 — **순수 함수**.
///
/// `ssh-keygen` 이 사용법(usage)을 뱉을 때 우리가 준 명령줄이 그대로 섞여 나오는 빌드가
/// 있다. 그 한 줄이 오류 문구로 올라가면 암호구가 화면에 뜬다. 여기서 끊는다.
///
/// 낱말 경계를 보는 이유: `--N ` 이나 `foo-N ` 은 우리가 준 플래그가 아니다 (그것까지
/// 지우면 남의 문장을 훼손한다).
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

/// 바깥으로 나갈 글자에서 암호구를 지운다 — **순수 함수**. 오류 경로는 전부 이 문을 지난다.
///
/// 두 겹인 이유: `-N` 플래그 모양으로 나오는 것은 [`strip_n_flag`] 가 잡고, 그 밖의 자리에
/// (예: `Passphrase "hunter2" is too short`) 박혀 나오는 것은 통째 치환이 잡는다.
///
/// 정직한 한계: 암호구가 한두 글자면 본문의 평범한 글자까지 `***` 가 된다. 그래도 이 방향이
/// 옳다 — 읽기 어려운 오류는 불편이고, 새어 나간 암호구는 사고다.
fn scrub(text: &str, passphrase: &str) -> String {
    let stripped = strip_n_flag(text);
    if passphrase.is_empty() {
        stripped
    } else {
        stripped.replace(passphrase, SCRUBBED)
    }
}

/// 공개키 한 줄을 뜯어 본다 — 지문·알고리즘·주석·**다시 조립한 한 줄**.
///
/// 파일의 글자를 그대로 쓰지 않고 다시 조립하는 이유는 [`crate::copy_id`] 의
/// `sanitize_comment` 가 막는 것과 같은 사고다: 주석에 제어 문자가 섞여 있으면 우리가 한
/// 줄인 줄 알았던 것이 서버의 `authorized_keys` 에서 **두 줄**이 된다.
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
/// 이 계산이 여기 있는 이유는 [`list_at`]·설치 고르개·[`crate::ssh`] 의 "에이전트에 이미 있는
/// 키 빼기" 가 **같은 값**을 봐야 하기 때문이다 (모듈 머리말의 "목록은 왜 `ssh-keygen -lf` 를
/// 부르지 않는가"). 두 곳이 각자 계산하면 언젠가 어긋나고, 어긋난 자리는 "같은 키를 두 번
/// 내서 MaxAuthTries 를 태우는" 조용한 실패로 나타난다.
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

/// `~/.ssh`. 있는지는 보지 않는다 ([`crate::config_edit::config_path`] 와 같은 결).
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
///
/// `~/.ssh` 가 남에게 열려 있으면 sshd 가 `authorized_keys` 를 무시하고, `ssh` 는 개인키
/// 읽기를 거부한다(`StrictModes`). 새로 만드는 자리에서 한 번 못 박아 둔다.
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

/// `ssh-keygen` 이 아예 없을 때의 안내. 오류가 아니라 **처방**이다.
fn missing_binary() -> String {
    tr!(
        ko: "ssh-keygen 을 찾지 못했습니다 — Windows 설정 → 앱 → 선택적 기능에서 \
             \"OpenSSH 클라이언트\" 를 설치한 뒤 앱을 다시 시작하세요",
        en: "Could not find ssh-keygen — install the \"OpenSSH Client\" optional feature \
             (Windows Settings → Apps → Optional features) and restart the app"
    )
}

/// **디렉터리를 받아** 키 쌍을 만든다 — 통합 테스트가 임시 폴더로 부르는 자리.
///
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
    // **덮어쓰기는 없다.** 개인키를 덮어쓰면 그 키로 붙던 서버 전부가 한 번에 잠긴다 —
    // 되돌릴 수 없는 사고라 `-f` 의 대화형 확인(우리에겐 없다)에 기대지 않고 먼저 막는다.
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

    // 주석은 `authorized_keys` 한 줄에 그대로 들어간다 — 제어 문자를 먼저 턴다
    // (`copy_id` 와 **같은 함수**를 쓴다: 규칙이 두 곳으로 갈라지면 언젠가 어긋난다).
    let comment = crate::copy_id::sanitize_comment(comment);

    let mut cmd = Command::new("ssh-keygen");
    cmd.arg("-q").arg("-t").arg(kind);
    if kind == RSA_KIND {
        cmd.arg("-b").arg(RSA_BITS);
    }
    cmd.arg("-f").arg(&private);
    // 암호구는 **여기 한 번**만 지난다. 빈 문자열이면 암호구 없는 키다 (`-N ""`).
    cmd.arg("-N").arg(passphrase);
    // 주석이 비면 `-C` 를 아예 붙이지 않는다 — 그러면 `ssh-keygen` 이 `user@hostname` 을
    // 스스로 채운다. 그 값을 우리가 흉내 내려면 OS 조회가 필요한데, 그럴 이유가 없다
    // (프런트가 OS 를 몰라도 되는 자리 — CLAUDE.md).
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

/// **디렉터리를 받아** `*.pub` 을 훑는다 — 통합 테스트가 임시 폴더로 부르는 자리.
///
/// 규칙 셋.
///
/// - 폴더가 없으면 **빈 목록**이다 (오류가 아니다 — 키를 아직 안 만든 사람이다).
/// - 읽히지 않는 `.pub` 은 **조용히 건너뛴다**. `~/.ssh` 에는 남의 형식(인증서·백업)이
///   섞여 있고, 그 하나 때문에 목록 전체를 실패로 만들면 쓸 수 있는 키까지 사라진다.
/// - **짝이 되는 개인키가 있는 것만** 싣는다. 이 목록을 읽는 두 화면이 모두 개인키를
///   전제하기 때문이다 — 호스트 폼의 `IdentityFile` 은 없는 파일을 가리키면 안 되고,
///   설치 고르개는 "심고 나면 그 키로 붙는다" 를 약속한다.
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
    // `read_dir` 의 순서는 OS·파일시스템이 정한다 — 목록이 새로 고칠 때마다 뒤바뀌면
    // 사용자가 방금 보던 줄을 다시 찾아야 한다. 경로로 고정한다.
    out.sort_by(|a, b| a.private_path.cmp(&b.private_path));
    Ok(out)
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 키 쌍 하나를 `~/.ssh/<name>` 에 만든다.
///
/// `passphrase` 가 `None`·`Some("")` 이면 암호구 없는 키다. 그 값은 이 함수의 인자와
/// 블로킹 클로저 안에서만 살고 **아무 데도 남지 않는다** (모듈 머리말 "암호구 취급").
///
/// 프로세스를 띄워 종료를 기다리는 일이라 [`spawn_blocking`](tauri::async_runtime) 에서 돈다
/// — RSA 4096 은 몇 초가 걸리고, 그동안 UI 스레드가 멈추면 **관계없는 다른 세션의 출력이
/// 함께 막힌다** (docs/log/2026-09-05-async-commands.md).
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
        // 암호구는 여기서 클로저와 함께 떨어진다.
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "키 생성 작업을 실행하지 못했습니다: {e}",
            en: "Could not run the key generation task: {e}"
        )
    })?
}

/// `~/.ssh` 에 있는 키 파일 목록 (공개키 + 짝이 되는 개인키).
///
/// 빈 배열은 오류가 아니다 — "아직 만든 키가 없다" 는 사실이고, 그때 화면은 "새 키
/// 만들기…" 를 권한다.
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
