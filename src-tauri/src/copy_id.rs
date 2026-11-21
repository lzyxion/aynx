//! `ssh-copy-id` 상당 — 비밀번호로 딱 한 번 붙어 공개키를 서버의 `authorized_keys` 에 심는다(개인키 파일은 읽지 않는다 — [`crate::ssh`]).
//!
//! SFTP 가 아니라 exec 채널이다 — 권한(700/600)이 곧 기능이고, 덧붙이기(`>>`)라야 남의 키를 잃지 않고, SFTP 서브시스템이 꺼진 서버가
//! 있다. 대신 셸 인용은 [`shell_quote`] 한 곳이 책임진다.
//!
//! 비밀번호는 구조체로 묶지 않고(`Debug` 로 새지 않게) · 저장 · 캐시하지 않고 · 로그 · 오류 · [`InstallReport::message`] · exec 명령
//! 문자열에 싣지 않는다(`echo pw | sudo -S` 류의 길이 없다). 러시로 넘어간 뒤의 힙 잔상까지 지우지는 못한다 — 약속은 "우리 코드가
//! 붙잡고 있지 않는다" 까지다. 네트워크 경로는 유닛 테스트가 없다 — 현장 확인 절차는 docs/log/2026-09-03-copy-id.md "현장 확인".

use russh::client::Handle;
use russh::ChannelMsg;

use crate::i18n::tr;
use crate::known_hosts;
use crate::ssh::{self, SshHandler, SshOpenError};

const EXEC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// 종료 코드로는 "넣었다" 와 "이미 있었다" 를 가를 수 없어(둘 다 0) 셸이 stdout 표식으로 말하게 한다.
const MARK_ADDED: &str = "__aynx_key_added__";
const MARK_PRESENT: &str = "__aynx_key_present__";

/// 오류가 아니라 보고다 — 파일은 들어갔고 남은 것은 서버 설정이다.
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
/// `fingerprint` 가 [`install_public_key`] 에 되돌려 줄 열쇠다 — 공개키 본문을 왕복시키면 프런트가 보낸 것과 에이전트가 서명할 것이
/// 어긋날 수 있다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentKey {
    pub fingerprint: String,
    pub key_type: String,
    pub comment: String,
    pub public_line: String,
}

/// `added` 와 `alreadyPresent` 는 서로 배타적이다(실패는 `Err`). `keyAuthOk` 가 거짓이어도 오류가 아니다 — `message` 에 원인 힌트가 실린다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    pub added: bool,
    pub already_present: bool,
    /// 설치 뒤 키로 다시 붙어 보았고 성공했다.
    pub key_auth_ok: bool,
    /// 비밀번호가 실리는 경로는 없다.
    pub message: String,
}

// ---------------------------------------------------------------------------
// 순수 함수
// ---------------------------------------------------------------------------

/// 에이전트 주석은 키 파일이 정한 임의의 문자열이다 — 개행이 있으면 서버에서 두 줄이 되어 다른 키가 하나 더 등록될 수 있어 제어
/// 문자를 통째로 버린다. [`crate::keygen`] 도 같은 규칙을 지난다 — 규칙이 두 곳으로 갈라지면 안 된다.
pub(crate) fn sanitize_comment(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

/// `key_body` 는 주석 없는 `"<type> <base64>"` 다 — `ssh-keygen -y` 출력과 같은 모양. [`crate::keygen`] 이 다시 조립할 때도 지난다.
pub(crate) fn public_line(key_body: &str, comment: &str) -> String {
    let comment = sanitize_comment(comment);
    if comment.is_empty() {
        key_body.to_string()
    } else {
        format!("{key_body} {comment}")
    }
}

/// 키 본문만 — 멱등 검사가 본다(주석까지 비교하면 같은 키가 다른 주석으로 쌓인다). ASCII 공백으로만 바이트를 훑어 인덱스가 늘
/// 문자 경계다 — 주석에 한글이 와도 슬라이스가 패닉하지 않는다.
fn key_part(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut i = 0;
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

/// 작은따옴표로 감싼다 — 유일한 탈출구인 `'` 만 `'\''` 로 바꾼다. 주석에는 무엇이든 들어오므로 이 함수를 거치지 않는 경로를 두지 않는다.
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

/// `ssh-copy-id` 와 같은 순서. `chmod` 700/600 은 sshd `StrictModes` 계약이다(아니면 서버가 파일을 조용히 무시한다).
/// `&&` 로 엮어 앞 단계가 실패하면 표식이 안 나오고 그것이 곧 실패 판정이다. `grep -qF` 는 고정 문자열 검색이다(base64 의 `+` · `/`).
/// 줄바꿈 없는 한 줄이다 — 여러 줄은 셸이 중간에서 끊기면 반쯤 실행된다.
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

/// `Ok(true)` = 새로 넣었다. 표식은 줄 단위로 찾는다 — `.bashrc` · MOTD 가 exec 채널에 흘린 출력에 걸리지 않게.
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

/// 프런트에는 `keyAuthOk` 하나로 나가지만 사람에게 할 말은 셋이다 — 서명할 키가 없는데 "서버가 공개키 인증을 안 받는다" 고 하면
/// 사실이 아닌 진단이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verified {
    Ok,
    Failed,
    /// 서명해 줄 상대가 없다(대개 암호구가 걸린 키 — 설치 흐름에서는 묻지 않는다).
    Skipped,
}

/// 비밀번호가 실릴 자리가 없다(인자에 없다).
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
        // ssh-add 를 권하지 않는다 — 다시 묻지 않게 하는 길은 볼트다 (docs/log/2026-09-19-vault.md).
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

#[cfg(windows)]
async fn read_agent_keys() -> Result<Vec<AgentKey>, String> {
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::AgentIdentity;

    let mut agent = match AgentClient::connect_named_pipe(ssh::AGENT_PIPE).await {
        Ok(agent) => agent,
        // 파이프가 없다 = ssh-agent 서비스가 꺼져 있다. 문구는 `crate::ssh` 의 인증 경로와 같게 둔다.
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
        // OpenSSH 인증서는 건너뛴다 — 접속 인증 경로도 건너뛰어 설치해도 쓰이지 않는다.
        let AgentIdentity::PublicKey { key, comment } = identity else {
            continue;
        };
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

/// `Debug` 를 일부러 붙이지 않는다 — 이 모듈의 어떤 구조체도 통째로 찍히지 않는다는 규칙을 예외 없이 둔다.
struct ExecOutput {
    stdout: String,
    stderr: String,
    code: Option<u32>,
}

/// PTY 를 요청하지 않는다 — 비대화형 exec 이라 프롬프트 · 에코 · `\r\n` 변환이 없다.
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
                // `Eof` 에서 끊지 않는다 — 일부 sshd 는 `exit-status` 를 Eof 뒤에 보낸다.
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

/// 키가 없으면 빈 배열이고(오류 아님), 에이전트에 닿지 못했을 때만 `Err` 다.
#[tauri::command]
pub async fn list_agent_public_keys() -> Result<Vec<AgentKey>, String> {
    read_agent_keys().await
}

/// 이 지문의 키가 지금 ssh-agent 에 있는가 — 오류가 없다. 닿지 못한 것과 없는 것의 처방이 같다("아직 아니다").
#[tauri::command]
pub async fn agent_has_key(fingerprint: String) -> bool {
    agent_holds(&fingerprint).await
}

async fn agent_holds(fingerprint: &str) -> bool {
    read_agent_keys()
        .await
        .map(|keys| keys.iter().any(|k| k.fingerprint == fingerprint))
        .unwrap_or(false)
}

/// 오류 종류는 [`open_ssh_session`](crate::ssh::open::open_ssh_session) 과 같다 — 프런트의 TOFU · 비밀번호 모달을 그대로 쓴다.
/// `host_key_unknown` 이면 승인 뒤 비밀번호도 다시 실어 재호출한다(저장해 두지 않는다).
#[tauri::command]
pub async fn install_public_key(
    alias: String,
    password: String,
    fingerprint: String,
    accept_new_host_key: bool,
) -> Result<InstallReport, SshOpenError> {
    // ── ① 심을 키를 먼저 고른다 ──
    // 접속보다 먼저다 — 키가 없으면 방금 친 비밀번호를 네트워크로 보낼 이유가 없다.
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
    install_via_server(&alias, password, &key.public_line, accept_new_host_key, true).await
}

/// 설치 몸통은 세션 서버에서 돈다(설치 뒤 확인이 볼트의 키 암호구를 같은 프로세스에서 읽는다). 비밀번호는 GUI → 서버 한 방향이고
/// GUI 는 로그에 남기지 않는다.
async fn install_via_server(
    alias: &str,
    password: String,
    line: &str,
    accept_new_host_key: bool,
    verify: bool,
) -> Result<InstallReport, SshOpenError> {
    crate::server::ssh_ops::copy_id(alias, password, line, accept_new_host_key, verify).await
}

/// `~/.ssh` 의 키 파일용 (docs/log/2026-09-17-keygen.md). 받은 줄은 로컬 파일의 글자라 그대로 쓰지 않고 파싱해 다시 조립한다 —
/// 형식이 아니면 비밀번호를 보내기 전에 멈추고, 주석의 제어 문자는 [`sanitize_comment`] 가 턴다.
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

    // 에이전트에 닿지 못해도 오류로 올리지 않는다 — 올리면 설치 자체가 막힌다(설치는 에이전트 없이도 된다).
    let in_agent = agent_holds(&known_hosts::fingerprint(&key)).await;

    install_via_server(&alias, password, &line, accept_new_host_key, in_agent).await
}

/// 두 설치 명령의 공통 몸통 — 비밀번호로 한 번 붙어 한 줄을 심고, 키로 다시 붙어 확인한다.
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

    // ── ② 비밀번호로 한 번 붙어 설치 ──
    // 호스트 키 검증은 `open_ssh_session` 과 같은 기계다. `exit` 는 id 를 bind 하지 않아 `ssh-exit` 이벤트가 나가지 않는다.
    // 연결은 공유하지 않는다(`solo`) — 비밀번호로 연 연결을 풀에 올리면 뒤의 타일이 "키로 붙었다" 를 잘못 보고한다.
    let exit: std::sync::Arc<ssh::ExitSignal> = std::sync::Arc::new(ssh::ExitSignal::new());
    let signal = crate::ssh_pool::TransportSignal::solo(
        exit as std::sync::Arc<dyn crate::ssh_pool::ExitTarget>,
    );
    let auto_accepted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let changed_accepted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // 미상 키 하나만 묻는다 — 바뀐 키의 세 갈래(이번만 · 갱신 · 거부)는 접속 화면의 결정이라 여기로 오지 않는다.
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
        // transport 가 여기서 떨어진다 — 비밀번호로 연 연결로 검증하면 "키로 붙었다" 는 판정이 무의미해진다.
    };

    // ── ③ 키로 다시 붙어 검증 ──
    // 여기서의 실패는 오류가 아니다. `verify` 는 쓰지 않는다 — 파일 키도 서명할 수 있어 낼 키가 있는지는 `authenticate_keys_only` 가
    // 판정한다(없으면 `NoSigner` = `Skipped`).
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

/// 설치 뒤 키로 다시 붙어 본다. 사유를 밖으로 올리지 않는다 — 부분 실패를 여러 갈래로 보이면 "설치는 성공했다" 가 묻힌다.
/// 볼트에 담긴 암호구는 묻지 않고 쓴다 (docs/log/2026-09-19-vault.md).
async fn verify_key_auth(
    params: &ssh::ConnectParams,
    decision: Option<ssh::HostKeyDecision>,
    auto_accepted: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    changed_accepted: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    signal: &std::sync::Arc<crate::ssh_pool::TransportSignal>,
) -> ssh::KeyAuthOutcome {
    let stored = ssh::vault_keys_for(params).await;
    // 잠긴 키는 묻지 않고 건너뛴다 — 설치 흐름에는 비밀번호 모달이 이미 한 번 떴다.
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

/// 읽기 실패는 접속 실패와 같은 계약으로 올린다.
fn ssh_config_hosts() -> Result<Vec<crate::ssh_config::HostEntry>, SshOpenError> {
    crate::ssh_config::load_default()
        .map(|c| c.hosts)
        .map_err(SshOpenError::other)
}

#[cfg(test)]
mod tests;
