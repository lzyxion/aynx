//! `ssh-copy-id` 상당 — 비밀번호로 딱 한 번 붙어 에이전트 공개키를 서버에 심는다.
//!
//! 이 앱은 설계 원칙상 개인키 파일을 읽지 않는다([`crate::ssh`]). 그래서 "비밀번호만 받는
//! 서버" 는 접속할 때마다 사용자가 비밀번호를 치는 수밖에 없었다. 그 한 번을 **마지막**으로
//! 만드는 것이 이 모듈이다.
//!
//! ```text
//!  ① list_agent_public_keys()            에이전트에 든 공개키 목록 (지문·주석·설치될 한 줄)
//!     └ 개인키는 여기에도 오지 않는다 — 공개키와 지문뿐이다
//!  ② install_public_key(alias, password, fingerprint, accept_new_host_key)
//!     ├ resolve_params → connect_transport   (호스트 키 검증은 open_ssh_session 과 **같은 기계**)
//!     ├ 비밀번호 인증 **한 번** (authenticate_password_only — 에이전트를 건드리지 않는다)
//!     ├ exec 채널로 멱등 설치 (mkdir/chmod/grep-or-append)
//!     ├ 연결을 끊고
//!     └ **에이전트 키로 다시 붙어** 검증 → key_auth_ok
//! ```
//!
//! # 왜 SFTP 가 아니라 exec 채널인가
//!
//! [`crate::shell_integration`] 은 스니펫을 SFTP 로 심는다. 거기서는 그것이 옳다 — 파일
//! 내용이 우리 것이고, 화면 도배를 피하는 것이 목적이었다. 여기서는 반대다.
//!
//! - `authorized_keys` 는 **권한이 곧 기능**이다. `~/.ssh` 가 700 이 아니거나 파일이 600 이
//!   아니면 sshd 가 조용히 그 파일을 무시한다(`StrictModes yes` 가 기본). SFTP 로 쓰면
//!   `mkdir` → `setstat(0700)` → `open` → `write` → `setstat(0600)` 을 우리가 손으로
//!   엮어야 하고, 서버마다 `setstat` 지원이 미묘하게 다르다. 셸의 `mkdir -p`/`chmod` 는
//!   그 자체로 계약이 명확하다.
//! - **덧붙이기(append)** 가 필요하다. 남의 키가 이미 들어 있는 파일을 통째로 다시 쓰는
//!   것은 사고의 크기가 다르다 — 우리가 읽고-합치고-쓰는 사이에 사용자가 다른 창에서
//!   키를 하나 더 넣었다면 그것이 사라진다. `>>` 는 그 창이 없다.
//! - **SFTP 서브시스템이 꺼진 서버가 있다.** 비밀번호만 받는 낡은 서버일수록 그렇다.
//!   exec 는 셸이 있는 서버라면 언제나 된다.
//!
//! 대신 exec 는 **셸 인용(quoting)이 우리 책임**이 된다 — [`shell_quote`] 가 그 한 곳이다.
//!
//! # 비밀번호 취급
//!
//! [`open_ssh_session`](crate::ssh::open::open_ssh_session) 과 같은 규칙이다.
//!
//! - 인자를 구조체로 묶지 않는다 — `#[derive(Debug)]` 한 줄로 새는 사고를 원천 차단한다.
//! - 저장·캐시하지 않는다. 디스크에 아무것도 쓰지 않는다.
//! - 로그·오류 문구·[`InstallReport::message`] 어디에도 실리지 않는다.
//! - **exec 명령 문자열에 들어가지 않는다** — 설치는 이미 인증된 채널 위에서 도므로
//!   원격 명령이 비밀번호를 알 필요가 없다. (`echo pw | sudo -S` 류의 경로가 없다는 뜻이다.)
//! - 소유권째 러시로 넘어가며 이 함수의 스코프에서 사라진다. 복사본을 만들지 않는다.
//!
//! 정직한 한계: 러시 안으로 들어간 뒤의 힙 잔상까지 지우지는 못한다(`zeroize` 의존을 새로
//! 들이지 않았다). 이 앱이 약속하는 것은 "우리 코드가 붙잡고 있지 않는다" 까지다.
//!
//! # 현장 확인 방법 (네트워크 경로는 유닛 테스트가 없다)
//!
//! `docs/log/2026-09-03-copy-id.md` 의 "현장 확인" 절에 절차가 있다 — 요약하면
//! 비밀번호만 받는 서버 하나에 설치 → `already_present` 로 한 번 더 → 서버에서
//! `ls -l ~/.ssh` 로 700/600 확인 → `sshd_config` 에 `PubkeyAuthentication no` 를 걸고
//! `key_auth_ok:false` + 힌트가 나오는지 확인.

use russh::client::Handle;
use russh::ChannelMsg;

use crate::i18n::tr;
use crate::known_hosts;
use crate::ssh::{self, SshHandler, SshOpenError};

/// 원격 명령 하나에 주는 시간. 여기서 하는 일은 `mkdir`+`grep`+`echo` 라 왕복 한 번이면
/// 끝난다 — 이보다 오래 걸린다면 서버가 응답하지 않는 것이지 느린 것이 아니다.
const EXEC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// 설치 명령이 stdout 으로 돌려주는 판정 표식.
///
/// 종료 코드로는 "넣었다" 와 "이미 있었다" 를 가를 수 없다(둘 다 0 이어야 한다 —
/// `grep` 의 1 을 실패로 올리면 정상 경로가 오류가 된다). 그래서 셸이 직접 말하게 한다.
/// 밑줄로 감싼 이름이라 `authorized_keys` 나 MOTD 에 우연히 섞일 여지가 없다.
const MARK_ADDED: &str = "__aynx_key_added__";
const MARK_PRESENT: &str = "__aynx_key_present__";

/// 설치는 됐는데 키 인증이 안 될 때의 힌트. 오류가 아니라 **보고**다 —
/// 파일은 정말로 들어갔고, 남은 것은 서버 설정이다.
/// (상수였던 자리 — 언어를 따라가야 해서 함수가 됐다.)
fn pubkey_off_hint() -> String {
    tr!(
        ko: "서버가 공개키 인증을 받지 않는 것 같습니다 \
             (sshd_config 의 `PubkeyAuthentication no`, 또는 `AuthorizedKeysFile` 이 \
             ~/.ssh/authorized_keys 가 아닌 경우) — 관리자에게 확인하세요",
        en: "The server does not seem to accept public key authentication \
             (`PubkeyAuthentication no` in sshd_config, or an `AuthorizedKeysFile` \
             other than ~/.ssh/authorized_keys) — check with the administrator"
    )
}

// ---------------------------------------------------------------------------
// 프런트 계약
// ---------------------------------------------------------------------------

/// 에이전트에 들어 있는 공개키 하나.
///
/// ```json
/// {
///   "fingerprint": "SHA256:47DEQpj8HBSa+/TImW+5JC...",
///   "keyType": "ssh-ed25519",
///   "comment": "you@box",
///   "publicLine": "ssh-ed25519 AAAAC3NzaC1lZDI1... you@box"
/// }
/// ```
///
/// `publicLine` 은 **서버에 그대로 들어갈 한 줄**이다 — 프런트가 미리보기로 보여 줄 수
/// 있게 그대로 싣는다. `fingerprint` 가 [`install_public_key`] 에 되돌려 줄 열쇠다
/// (공개키 본문을 왕복시키면 프런트가 보낸 것과 에이전트가 서명할 것이 어긋날 수 있다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentKey {
    /// `SHA256:...` — `ssh-add -l` 이 보여 주는 것과 같은 형식.
    pub fingerprint: String,
    /// `ssh-ed25519` · `ssh-rsa` 등 알고리즘 이름.
    pub key_type: String,
    /// 에이전트가 알려 준 주석. 없을 수 있다 (빈 문자열).
    pub comment: String,
    /// `authorized_keys` 에 들어갈 한 줄 (`<type> <base64>[ <comment>]`).
    pub public_line: String,
}

/// 설치 결과.
///
/// ```json
/// { "added": true,  "alreadyPresent": false, "keyAuthOk": true,  "message": "키를 설치했습니다 …" }
/// { "added": false, "alreadyPresent": true,  "keyAuthOk": true,  "message": "이미 등록된 키입니다 …" }
/// { "added": true,  "alreadyPresent": false, "keyAuthOk": false, "message": "키를 설치했지만 …" }
/// ```
///
/// `added` 와 `alreadyPresent` 는 **서로 배타적**이다 (둘 다 참이거나 둘 다 거짓인 결과는
/// 나오지 않는다 — 설치가 실패하면 `Err` 다). 둘을 따로 두는 이유는 프런트가 "설치했습니다"
/// 와 "이미 있었습니다" 를 다른 톤으로 보여 주기 때문이다.
///
/// `keyAuthOk` 가 거짓이어도 **오류가 아니다** — 파일은 들어갔다. `message` 에 원인 힌트가
/// 실린다 ([`PUBKEY_OFF_HINT`]).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    /// 이번 호출이 줄을 새로 덧붙였다.
    pub added: bool,
    /// 이미 같은 키가 있어 아무것도 하지 않았다.
    pub already_present: bool,
    /// 설치 뒤 **에이전트 키만으로** 다시 붙어 보았고 성공했다.
    pub key_auth_ok: bool,
    /// 사람이 읽을 한 줄 (한국어). 비밀번호가 실리는 경로는 없다.
    pub message: String,
}

// ---------------------------------------------------------------------------
// 순수 함수 (테스트 대상)
// ---------------------------------------------------------------------------

/// 주석을 `authorized_keys` 에 넣어도 되는 모양으로 다듬는다 — **순수 함수**.
///
/// 에이전트의 주석은 **사용자가 아니라 키 파일이 정한 임의의 문자열**이다. 그것이 그대로
/// 한 줄에 들어가는데, 안에 개행이 있으면 우리가 한 줄인 줄 알았던 것이 서버에서는 두 줄이
/// 된다 — 뒷줄은 `authorized_keys` 문법으로 다시 읽히므로 최악의 경우 **다른 키가 하나 더
/// 등록**될 수 있다. 그래서 제어 문자를 통째로 버린다 (탭도 포함 — OpenSSH 는 주석 구분자로
/// 공백만 본다).
///
/// `pub(crate)` 인 이유: [`crate::keygen`] 이 파일에서 읽은 `.pub` 한 줄의 주석에 **같은
/// 규칙**을 적용한다. 규칙이 두 곳으로 갈라지면 언젠가 어긋나고, 어긋난 자리가 곧 위의 사고다.
pub(crate) fn sanitize_comment(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

/// `authorized_keys` 한 줄을 조립한다 — **순수 함수**.
///
/// `key_body` 는 주석 없는 `"<type> <base64>"` 다 (ssh-key 의 `to_openssh()` 가 주석이
/// 비면 정확히 이 모양을 준다 — 뒤에 공백을 남기지 않는다). 주석이 비면 두 토막으로
/// 끝나고, 있으면 공백 하나로 잇는다 — `ssh-keygen -y` 의 출력과 같은 모양이다.
///
/// [`sanitize_comment`] 와 같은 이유로 `pub(crate)` 다 ([`crate::keygen`] 이 파일에서 읽은
/// 줄을 **다시 조립**할 때 이 함수를 지난다).
pub(crate) fn public_line(key_body: &str, comment: &str) -> String {
    let comment = sanitize_comment(comment);
    if comment.is_empty() {
        key_body.to_string()
    } else {
        format!("{key_body} {comment}")
    }
}

/// 한 줄에서 **키 그 자체**(`"<type> <base64>"`)만 떼어낸다 — **순수 함수**.
///
/// 멱등 검사가 이것을 본다. 주석까지 포함해 비교하면 같은 키가 다른 주석으로 이미 들어 있을
/// 때 중복 줄이 하나 더 쌓인다 (에이전트 주석은 키 파일마다, 기계마다 다르다). 키 본문은
/// base64 라 그 자체로 유일하므로 이것만 봐도 충분하고, 더 정확하다.
/// 바이트로 훑는 이유: 여기서 경계가 되는 것은 **ASCII 공백뿐**이고, UTF-8 은 ASCII 바이트가
/// 멀티바이트 문자 안에 나타나지 않도록 설계돼 있다 — 즉 이 인덱스는 언제나 문자 경계라
/// 주석에 한글이 들어와도 슬라이스가 패닉하지 않는다 (`char::is_whitespace` 로 훑으면
/// 공백 문자의 바이트 길이를 1로 가정하게 되어 그 보장이 깨진다).
fn key_part(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut i = 0;
    // ① 타입 → ② 사이 공백 → ③ base64. 거기서 멈추면 주석이 잘려 나간다.
    while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    &line[..i]
}

/// POSIX 셸의 작은따옴표로 문자열 하나를 감싼다 — **순수 함수**.
///
/// 작은따옴표 안에서는 `$`·`` ` ``·`\`·`!` 가 전부 문자 그대로다. 유일한 탈출구가 작은따옴표
/// 자신이므로, 그것만 `'\''` (닫고 → 이스케이프된 따옴표 → 다시 열기)로 갈아 끼우면 임의의
/// 바이트를 안전하게 실을 수 있다. base64 에 흔한 `+`·`/`·`=` 는 애초에 특수문자가 아니지만,
/// 주석에는 무엇이든 들어올 수 있어서 이 함수를 거치지 않는 경로를 두지 않는다.
fn shell_quote(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 2);
    out.push('\'');
    for c in raw.chars() {
        if c == '\'' {
            out.push_str(r"'\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// 설치 명령을 조립한다 — **순수 함수**. `ssh-copy-id` 가 하는 일과 같은 순서다.
///
/// ```sh
/// mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys \
///   && chmod 600 ~/.ssh/authorized_keys \
///   && if grep -qF '<키 본문>' ~/.ssh/authorized_keys; then echo __aynx_key_present__; \
///      else echo '<한 줄>' >> ~/.ssh/authorized_keys && echo __aynx_key_added__; fi
/// ```
///
/// - `chmod` 값은 **sshd 의 `StrictModes` 계약**이다. 700/600 이 아니면 서버가 이 파일을
///   조용히 무시한다 — 설치는 됐는데 인증이 안 되는 가장 흔한 원인이다.
/// - `touch` 는 파일이 없을 때를 위한 것이고, 그 뒤의 `chmod` 가 **이미 있던 파일의 권한도**
///   바로잡는다 (`ssh-copy-id` 와 같다).
/// - `&&` 로 엮어서 앞 단계가 실패하면 뒤가 돌지 않는다 — 디스크가 꽉 찼거나 홈이 읽기
///   전용이면 표식이 안 나오고, 그것이 곧 실패 판정이다.
/// - `grep -qF` 는 정규식이 아니라 고정 문자열 검색이다 (base64 의 `+`·`/` 가 메타문자로
///   읽히면 안 된다).
/// - **줄바꿈이 없는 한 줄**이다. 여러 줄로 보내면 셸이 중간에서 끊길 때 반쯤 실행된다.
fn install_command(line: &str) -> String {
    let quoted_line = shell_quote(line);
    let quoted_needle = shell_quote(key_part(line));
    format!(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys \
         && chmod 600 ~/.ssh/authorized_keys \
         && if grep -qF {quoted_needle} ~/.ssh/authorized_keys; then echo {MARK_PRESENT}; \
         else echo {quoted_line} >> ~/.ssh/authorized_keys && echo {MARK_ADDED}; fi"
    )
}

/// 설치 명령의 출력에서 판정을 읽는다 — **순수 함수**. `Ok(true)` = 새로 넣었다.
///
/// 표식을 **줄 단위로** 찾는 이유: 서버의 `.bashrc` 나 MOTD 가 exec 채널에도 무언가를
/// 흘리는 경우가 있어서(비대화형이면 보통 조용하지만 보장은 아니다) 전체 문자열
/// `contains` 로 보면 남의 출력에 걸릴 수 있다.
///
/// 표식이 하나도 없으면 명령이 도중에 실패한 것이다 — 그때는 stderr 를 그대로 올린다
/// (권한·디스크 문제의 진짜 사유가 거기 있다).
fn parse_install_output(stdout: &str, stderr: &str, code: Option<u32>) -> Result<bool, String> {
    let found = |mark: &str| stdout.lines().any(|l| l.trim() == mark);
    if found(MARK_ADDED) {
        return Ok(true);
    }
    if found(MARK_PRESENT) {
        return Ok(false);
    }
    let detail = stderr.trim();
    let tail = if detail.is_empty() {
        match code {
            Some(c) => tr!(ko: " (종료 코드 {c})", en: " (exit code {c})"),
            None => String::new(),
        }
    } else {
        format!(" — {detail}")
    };
    Err(tr!(
        ko: "authorized_keys 를 수정하지 못했습니다{tail}",
        en: "Could not modify authorized_keys{tail}"
    ))
}

/// 설치 뒤의 **검증 결과 세 갈래**.
///
/// [`InstallReport`] 는 `keyAuthOk` 라는 boolean 하나로 프런트에 나가지만(계약이 그렇다),
/// 사람에게 할 말은 셋이다. 파일 키를 심는 길이 생기면서 갈래가 하나 늘었다 —
/// **에이전트에 없는 키**는 심고 나서 "그 키로 붙어 보기" 를 할 수가 없다(서명해 줄 상대가
/// 없다). 그때 `keyAuthOk: false` 만 돌려주면 화면에는 "서버가 공개키 인증을 받지 않는 것
/// 같습니다" 가 뜬다 — **사실이 아닌 진단**이고, 사용자는 멀쩡한 sshd 설정을 뒤지게 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verified {
    /// 키로 다시 붙어 보았고 성공했다.
    Ok,
    /// 키로 다시 붙어 보았고 실패했다 — 서버 설정을 의심한다.
    Failed,
    /// 붙어 보지 않았다. **서명해 줄 상대가 없다** — 에이전트에도 없고, 읽을 수 있는
    /// 키 파일도 없다(대개 암호구가 걸린 키다. 설치 흐름에서는 묻지 않는다 — 비밀번호를
    /// 이미 한 번 받은 자리에 모달을 하나 더 쌓지 않는다).
    ///
    /// 2026-09-19 부터 **파일 키도 서명할 수 있다**([`ssh::authenticate_keys_only`]) —
    /// 그래서 이 갈래는 예전보다 훨씬 좁다.
    Skipped,
}

/// 보고 문구를 만든다 — **순수 함수**. 비밀번호가 실릴 자리가 없다는 것도 이 함수가 보장한다
/// (인자에 아예 없다).
fn report_message(alias: &str, added: bool, verified: Verified) -> String {
    let head = if added {
        tr!(
            ko: "{alias} 의 ~/.ssh/authorized_keys 에 키를 등록했습니다",
            en: "Added the key to ~/.ssh/authorized_keys on {alias}"
        )
    } else {
        tr!(
            ko: "{alias} 에는 이미 같은 키가 등록되어 있습니다",
            en: "{alias} already has the same key"
        )
    };
    match verified {
        Verified::Ok => tr!(
            ko: "{head} — 키 인증으로 접속되는 것을 확인했습니다. 이제 비밀번호 없이 접속됩니다.",
            en: "{head} — key authentication was confirmed. You can connect without a password now."
        ),
        Verified::Failed => tr!(
            ko: "{head} — 다만 키 인증으로 다시 붙어 보니 실패했습니다. {hint}",
            en: "{head} — but reconnecting with key authentication failed. {hint}",
            hint = pubkey_off_hint()
        ),
        // **ssh-add 를 권하지 않는다** (2026-09-19 ② · docs/log/2026-09-19-vault.md).
        // "다시 묻지 않게 하는 길" 이 에이전트에서 금고로 옮겨 갔으므로, 여기서 옛 길을
        // 가리키면 사용자는 앱이 이미 마련한 체크박스를 못 찾고 터미널로 나간다.
        Verified::Skipped => tr!(
            ko: "{head} — 암호구가 걸린 키라 접속 확인은 건너뛰었습니다. \
                 접속하면 암호구를 묻고, 저장을 켜면 다음부터 묻지 않습니다.",
            en: "{head} — the key is passphrase-protected, so the connection check was skipped. \
                 Connecting asks for the passphrase once; tick save and it stops asking."
        ),
    }
}

// ---------------------------------------------------------------------------
// 에이전트 키 목록
// ---------------------------------------------------------------------------

/// 에이전트에 든 공개키를 [`AgentKey`] 로 편다.
///
/// 개인키는 여기에도 오지 않는다 — 에이전트가 주는 것은 공개키와 주석뿐이다
/// ([`crate::ssh`] 의 설계 원칙 그대로).
#[cfg(windows)]
async fn read_agent_keys() -> Result<Vec<AgentKey>, String> {
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::AgentIdentity;

    let mut agent = match AgentClient::connect_named_pipe(ssh::AGENT_PIPE).await {
        Ok(agent) => agent,
        // 파이프 자체가 없다 = ssh-agent 서비스가 안 돌고 있다.
        // (문구는 `crate::ssh` 의 인증 경로와 같은 것을 쓴다 — 사용자가 두 곳에서
        //  다른 안내를 받으면 같은 문제인 줄 모른다.)
        Err(russh::keys::Error::IO(io)) if io.kind() == std::io::ErrorKind::NotFound => {
            return Err(tr!(
                ko: "ssh-agent 가 꺼져 있습니다",
                en: "ssh-agent is not running"
            ))
        }
        Err(other) => {
            return Err(tr!(
                ko: "ssh-agent 에 연결하지 못했습니다: {other}",
                en: "Could not connect to ssh-agent: {other}"
            ))
        }
    };

    let identities = agent.request_identities().await.map_err(|e| {
        tr!(
            ko: "ssh-agent 키 목록을 읽지 못했습니다: {e}",
            en: "Could not read the ssh-agent key list: {e}"
        )
    })?;

    let mut out = Vec::with_capacity(identities.len());
    for identity in identities {
        // OpenSSH 인증서는 이번 범위 밖이다 (`crate::ssh` 의 인증 경로도 건너뛴다).
        // 목록에 보여 주고 설치하게 하면, 정작 접속할 때는 쓰이지 않아 사용자가
        // "설치했는데 왜 안 되지" 를 겪는다.
        let AgentIdentity::PublicKey { key, comment } = identity else {
            continue;
        };
        // 주석을 뗀 사본으로 `"<type> <base64>"` 를 얻는다 — 에이전트가 준 키에는 주석이
        // 실려 있을 수도, 없을 수도 있어서 한 곳에서 다시 붙이는 편이 예측 가능하다.
        let body = russh::keys::PublicKey::new(key.key_data().clone(), "")
            .to_openssh()
            .map_err(|e| {
                tr!(
                    ko: "공개키를 openssh 형식으로 옮기지 못했습니다: {e}",
                    en: "Could not convert the public key to openssh format: {e}"
                )
            })?;
        out.push(AgentKey {
            fingerprint: known_hosts::fingerprint(&key),
            key_type: key.algorithm().as_str().to_string(),
            comment: sanitize_comment(&comment),
            public_line: public_line(&body, &comment),
        });
    }
    Ok(out)
}

#[cfg(not(windows))]
async fn read_agent_keys() -> Result<Vec<AgentKey>, String> {
    Err(tr!(
        ko: "이 빌드는 Windows ssh-agent 명명 파이프만 지원합니다",
        en: "This build only supports the Windows ssh-agent named pipe"
    ))
}

// ---------------------------------------------------------------------------
// 원격 실행
// ---------------------------------------------------------------------------

/// exec 채널 한 번의 결과.
///
/// `#[derive(Debug)]` 를 일부러 붙이지 않는다 — 여기 실리는 것은 원격 출력뿐이라
/// 비밀번호가 샐 경로는 없지만, 이 모듈의 어떤 구조체도 통째로 찍히지 않는다는 규칙을
/// 예외 없이 둔다.
struct ExecOutput {
    stdout: String,
    stderr: String,
    code: Option<u32>,
}

/// 이미 인증된 핸들 위에서 명령 한 줄을 돌리고 출력을 모은다.
///
/// PTY 를 요청하지 않는다 — 비대화형 exec 이라 프롬프트도, 에코도, `\r\n` 변환도 없다.
/// [`crate::shell_integration`] 의 부트스트랩과 달리 우리가 화면에서 감출 것이 아무것도
/// 없는 이유다 (이 채널의 출력은 사용자 터미널로 가지 않는다).
async fn run_remote(handle: &Handle<SshHandler>, command: &str) -> Result<ExecOutput, String> {
    let run = async {
        let mut channel = handle.channel_open_session().await.map_err(|e| {
            tr!(
                ko: "원격 명령 채널을 열지 못했습니다: {e}",
                en: "Could not open a channel for the remote command: {e}"
            )
        })?;
        channel.exec(true, command).await.map_err(|e| {
            tr!(
                ko: "원격 명령을 실행하지 못했습니다: {e}",
                en: "Could not run the remote command: {e}"
            )
        })?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut code = None;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                // `Eof` 에서 끊지 않는 이유는 셸 펌프와 같다 — 일부 sshd 는 `exit-status`
                // 를 Eof **뒤에** 보낸다. Close 까지 마저 읽어야 종료 코드를 줍는다.
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok(ExecOutput {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            code,
        })
    };

    tokio::time::timeout(EXEC_TIMEOUT, run).await.map_err(|_| {
        tr!(
            ko: "원격 명령이 시간 안에 끝나지 않았습니다",
            en: "The remote command did not finish in time"
        )
    })?
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 지금 ssh-agent 에 등록된 공개키 목록.
///
/// 에이전트는 살아 있는데 키가 하나도 없으면 **빈 배열**이다 (오류가 아니다) — 프런트가
/// "`ssh-add <키 경로>` 로 키를 먼저 추가하세요" 를 안내하는 자리다. 에이전트 자체에
/// 닿지 못한 경우에만 `Err` 다.
#[tauri::command]
pub async fn list_agent_public_keys() -> Result<Vec<AgentKey>, String> {
    read_agent_keys().await
}

/// **이 지문의 키가 지금 ssh-agent 에 들어 있는가** (docs/log/2026-09-17-keygen.md 의
/// "에이전트에 넣기").
///
/// [`list_agent_public_keys`] 와 달리 **오류가 없다**. 부르는 쪽의 물음이 "키를 넣는 일이
/// 끝났는가" 하나뿐이라, 에이전트에 닿지 못한 것과 키가 없는 것의 처방이 같다 —
/// 둘 다 "아직 아니다" 이고, 화면은 계속 기다리면 된다. `install_public_key_line` 이
/// 같은 물음에 `unwrap_or(false)` 로 답하는 것과 **같은 근거**다.
#[tauri::command]
pub async fn agent_has_key(fingerprint: String) -> bool {
    agent_holds(&fingerprint).await
}

/// 위 명령과 [`install_public_key_line`] 의 공통 몸통 — 두 곳이 같은 판정을 쓴다.
async fn agent_holds(fingerprint: &str) -> bool {
    read_agent_keys()
        .await
        .map(|keys| keys.iter().any(|k| k.fingerprint == fingerprint))
        .unwrap_or(false)
}

/// 에이전트 공개키 하나를 원격의 `~/.ssh/authorized_keys` 에 심는다 (`ssh-copy-id` 상당).
///
/// 오류 종류는 [`open_ssh_session`](crate::ssh::open::open_ssh_session) 과 **완전히 같다** —
/// 프런트가 이미 가진 TOFU 모달과 비밀번호 재입력 흐름을 그대로 재사용하라고 그렇게 뒀다.
///
/// - `host_key_unknown` → 지문을 보여 주고 승인받아 `acceptNewHostKey: true` 로 재호출
///   (비밀번호도 다시 실어 보내야 한다 — 저장해 두지 않는다).
/// - `host_key_changed` → 재시도 경로 없음.
/// - `password_required` → 비밀번호를 다시 받아 재호출.
/// - `auth` / `other` → 문구를 그대로 보여 준다.
///
/// `password` 는 **필수**다 (`Option` 이 아니다). 이 명령의 존재 이유가 "비밀번호로 딱
/// 한 번 붙는 것" 이라, 값 없이 부르는 것은 의미가 없다. 취급 규칙은 모듈 문서 참조.
#[tauri::command]
pub async fn install_public_key(
    alias: String,
    password: String,
    fingerprint: String,
    accept_new_host_key: bool,
) -> Result<InstallReport, SshOpenError> {
    // ── ① 심을 키를 먼저 고른다 ─────────────────────────────────────────────
    // 접속보다 앞이다. 키가 없으면 사용자가 방금 친 비밀번호를 네트워크로 보낼 이유가 없다.
    let keys = read_agent_keys().await.map_err(SshOpenError::other)?;
    let key = keys
        .into_iter()
        .find(|k| k.fingerprint == fingerprint)
        .ok_or_else(|| {
            SshOpenError::other(tr!(
                ko: "ssh-agent 에서 지문 {fingerprint} 인 키를 찾지 못했습니다 \
                     — 목록을 새로 고친 뒤 다시 시도하세요",
                en: "Could not find a key with fingerprint {fingerprint} in ssh-agent \
                     — refresh the list and try again"
            ))
        })?;
    // 에이전트에서 온 키다 = 심고 나면 그 키로 붙어 볼 수 있다.
    install_via_server(&alias, password, &key.public_line, accept_new_host_key, true).await
}

/// 설치 몸통은 **세션 서버**에서 돈다(③-3b2 — 설치 뒤 확인이 금고의 키 암호구를 같은 프로세스에서 읽는다). 비밀번호는 몸으로
/// GUI → 서버 한 방향이고 GUI 는 로그에 남기지 않는다. 실패는 `SshOpenError` 그대로(TOFU·비밀번호 모달 재사용).
async fn install_via_server(
    alias: &str,
    password: String,
    line: &str,
    accept_new_host_key: bool,
    verify: bool,
) -> Result<InstallReport, SshOpenError> {
    crate::server::ssh_ops::copy_id(alias, password, line, accept_new_host_key, verify).await
}

/// 공개키 **한 줄**을 그대로 받아 심는다 — `~/.ssh` 의 키 파일용
/// (docs/log/2026-09-17-keygen.md).
///
/// [`install_public_key`] 와 **같은 몸통**([`install_line`])을 지난다. 오류 계약도 같으므로
/// 프런트는 TOFU·비밀번호 모달을 그대로 재사용한다.
///
/// ## 받은 줄을 그대로 쓰지 않는다
///
/// `public_key_line` 은 로컬 파일에서 온 글자다 — 우리가 쓴 것이 아니다. 그래서 먼저
/// **파싱해서 다시 조립한다**: 형식이 아니면 여기서 멈추고(비밀번호를 보내기 전이다),
/// 주석의 제어 문자는 [`sanitize_comment`] 가 턴다. 파일 한 줄이 서버에서 두 줄이 되는
/// 사고를 그 한 걸음이 막는다.
///
/// ## 검증은 **에이전트에 있을 때만**
///
/// 설치 뒤 확인은 "그 키로 다시 붙어 보기" 인데, 서명은 ssh-agent 가 한다. 파일에만 있는
/// 키는 서명해 줄 상대가 없으므로 확인을 건너뛰고 [`Verified::Skipped`] 문구를 쓴다 —
/// 붙어 보지도 않고 "서버가 공개키 인증을 안 받는 것 같다" 고 말하지 않기 위해서다.
#[tauri::command]
pub async fn install_public_key_line(
    alias: String,
    password: String,
    public_key_line: String,
    accept_new_host_key: bool,
) -> Result<InstallReport, SshOpenError> {
    let key = russh::keys::PublicKey::from_openssh(public_key_line.trim()).map_err(|e| {
        SshOpenError::other(tr!(
            ko: "공개키 한 줄을 읽지 못했습니다: {e}",
            en: "Could not read the public key line: {e}"
        ))
    })?;
    let body = russh::keys::PublicKey::new(key.key_data().clone(), "")
        .to_openssh()
        .map_err(|e| {
            SshOpenError::other(tr!(
                ko: "공개키를 openssh 형식으로 옮기지 못했습니다: {e}",
                en: "Could not convert the public key to openssh format: {e}"
            ))
        })?;
    let line = public_line(&body, key.comment().as_str().unwrap_or(""));

    // 에이전트가 이 키를 들고 있으면 설치 뒤 확인까지 간다. 에이전트에 닿지 못하는 것
    // (서비스가 꺼져 있는 등)도 "없다" 와 같은 처방이라 `unwrap_or(false)` 다 — 여기서
    // 오류로 올리면 **설치 자체가 막힌다**. 설치는 에이전트 없이도 되는 일이다.
    let in_agent = agent_holds(&known_hosts::fingerprint(&key)).await;

    install_via_server(&alias, password, &line, accept_new_host_key, in_agent).await
}

/// 두 설치 명령의 **공통 몸통** — 비밀번호로 한 번 붙어 한 줄을 심고, (원하면) 키로 다시 붙어
/// 확인한다. 나뉘어 있던 시절이 없다: 파일 키 경로를 만들면서 곧바로 여기로 모았다.
///
/// `verify` 를 인자로 받는 이유는 [`install_public_key_line`] 의 문서에 있다.
pub(crate) async fn install_line(
    alias: &str,
    password: String,
    line: &str,
    accept_new_host_key: bool,
    verify: bool,
) -> Result<InstallReport, SshOpenError> {
    let command = install_command(line);

    let config = ssh_config_hosts()?;
    let username = std::env::var("USERNAME").ok();
    let params = ssh::resolve_params(alias, &config, username.as_deref())?;

    // ── ② 비밀번호로 한 번 붙어 설치 ────────────────────────────────────────
    // 호스트 키 검증은 `open_ssh_session` 과 같은 기계를 지난다 (ssh::connect_transport).
    // `auto_accepted` 플래그는 셸 배너용이라 여기서는 받아만 두고 버린다 — 이 연결에는
    // 사용자에게 보여 줄 터미널이 없다. `exit` 도 마찬가지로 id 를 bind 하지 않으므로
    // `ssh-exit` 이벤트가 나가지 않는다 (프런트가 이 연결을 세션으로 오해하면 안 된다).
    // 설치 흐름의 연결은 **공유하지 않는다** — 한 번 붙었다 사라지는 연결이고, 비밀번호로
    // 연 ②의 연결을 풀에 올리면 그 뒤의 타일이 "키로 붙었다" 를 잘못 보고하게 된다.
    // 그래서 전송로 신호는 대상 하나만 실은 것(`solo`)이다.
    let exit: std::sync::Arc<ssh::ExitSignal> = std::sync::Arc::new(ssh::ExitSignal::new());
    let signal = crate::ssh_pool::TransportSignal::solo(
        exit as std::sync::Arc<dyn crate::ssh_pool::ExitTarget>,
    );
    let auto_accepted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let changed_accepted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // 이 흐름의 다이얼로그는 **미상 키 하나**다 — `accept_new_host_key: true` 는 곧
    // `HostKeyDecision::Trust`(수락하고 기록)이다. 바뀐 키의 세 갈래(이번만·갱신·거부)는
    // 여기로 오지 않는다: 셸 접속과 달리 이 연결은 한 번 붙었다 사라지는 것이라, 기록을
    // 남기지 않는 통과에 뜻이 없고 갱신은 접속 화면에서 하는 결정이다.
    let decision = accept_new_host_key.then_some(ssh::HostKeyDecision::Trust);

    let added = {
        let mut transport = ssh::connect_transport(
            &params,
            decision,
            &auto_accepted,
            &changed_accepted,
            &signal,
            // 설치는 **비밀번호로 한 번 붙는 일**이다 — 경유의 잠긴 키를 여기서 묻지 않는다.
            ssh::KeyUnlock::none(),
        )
        .await?;
        // password 는 여기서 러시로 넘어가며 소유권째 사라진다. 아래로는 내려가지 않는다.
        ssh::authenticate_password_only(&mut transport.handle, &params.user, password).await?;

        let out = run_remote(&transport.handle, &command)
            .await
            .map_err(SshOpenError::other)?;
        parse_install_output(&out.stdout, &out.stderr, out.code).map_err(SshOpenError::other)?
        // transport 가 여기서 떨어진다 — 비밀번호로 연 연결을 검증까지 끌고 가면
        // "키로 붙었다" 는 판정이 그 연결에 얹혀 무의미해진다.
    };

    // ── ③ 에이전트 키로 다시 붙어 검증 ──────────────────────────────────────
    // 여기서의 실패는 **오류가 아니다**. 파일은 이미 들어갔고, 남은 것은 서버 설정이다.
    // `verify: false` (파일에만 있는 키)면 아예 붙어 보지 않는다 — 없는 확신으로 진단하지
    // 않는다는 뜻이고, 덤으로 접속 왕복 한 번을 아낀다.
    // `verify` 는 "에이전트가 이 키를 들고 있다" 였다. 2026-09-19 부터 **파일 키도 서명할
    // 수 있으므로**, 이 호스트에 `IdentityFile` 이 적혀 있거나 `~/.ssh` 기본 이름이 있으면
    // 붙어 볼 값이 있다 — 그 판정은 `authenticate_keys_only` 가 직접 한다(여기서 두 번
    // 적지 않는다). 낼 키가 하나도 없으면 그쪽이 `NoSigner` 로 답하고 그것이 `Skipped` 다.
    let _ = verify;
    let verified = match verify_key_auth(
        &params,
        decision,
        &auto_accepted,
        &changed_accepted,
        &signal,
    )
    .await
    {
        ssh::KeyAuthOutcome::Ok => Verified::Ok,
        ssh::KeyAuthOutcome::Rejected => Verified::Failed,
        ssh::KeyAuthOutcome::NoSigner => Verified::Skipped,
    };

    Ok(InstallReport {
        added,
        already_present: !added,
        key_auth_ok: verified == Verified::Ok,
        message: report_message(alias, added, verified),
    })
}

/// 설치 뒤 **에이전트 키만으로** 다시 붙어 본다. 붙었으면 `true`.
///
/// 사유를 밖으로 올리지 않는 이유: 여기서 나올 수 있는 오류(키 거부·에이전트 문제·
/// 호스트 키)는 전부 [`PUBKEY_OFF_HINT`] 로 수렴하거나 이미 ②에서 걸러졌다. 부분 실패를
/// 여러 갈래로 보여 주면 "설치는 성공했다" 는 사실이 묻힌다.
///
/// **금고에 담긴 암호구는 쓴다** (2026-09-19 ② · docs/log/2026-09-19-vault.md). 묻지 않는
/// 규칙은 그대로다 — 담긴 값으로 조용히 열릴 뿐이고, 그 덕에 암호구가 걸린 키로 설치한
/// 사람도 `Verified::Ok` 를 본다(예전에는 늘 "확인 건너뜀" 이었다).
async fn verify_key_auth(
    params: &ssh::ConnectParams,
    decision: Option<ssh::HostKeyDecision>,
    auto_accepted: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    changed_accepted: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    signal: &std::sync::Arc<crate::ssh_pool::TransportSignal>,
) -> ssh::KeyAuthOutcome {
    let stored = ssh::vault_keys_for(params).await;
    // 잠긴 키는 **묻지 않고 건너뛴다** (`KeyUnlock::Skip`) — 설치 흐름에는 비밀번호 모달이
    // 이미 한 번 떴고, 확인 한 줄 때문에 모달을 하나 더 쌓지 않는다.
    let unlock = ssh::KeyUnlock::Skip { stored: &stored };
    let Ok(mut transport) = ssh::connect_transport(
        params,
        decision,
        auto_accepted,
        changed_accepted,
        signal,
        unlock,
    )
    .await
    else {
        // 붙지 못했다 — 키를 내 볼 기회조차 없었으므로 서버를 탓하지 않는다.
        return ssh::KeyAuthOutcome::NoSigner;
    };
    ssh::authenticate_keys_only(
        &mut transport.handle,
        &params.user,
        params.identity_file.as_deref(),
        params.identities_only,
        unlock,
    )
    .await
}

/// `~/.ssh/config` 의 호스트 블록들. 읽기 실패는 접속 실패와 같은 계약으로 올린다.
fn ssh_config_hosts() -> Result<Vec<crate::ssh_config::HostEntry>, SshOpenError> {
    crate::ssh_config::load_default()
        .map(|c| c.hosts)
        .map_err(SshOpenError::other)
}

#[cfg(test)]
mod tests;
