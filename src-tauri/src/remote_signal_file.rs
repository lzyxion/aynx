//! **원격 신호 파일** — 원격 타일의 훅이 신호를 쏠 주소·토큰을 셸 환경 대신 **서버의 작은 파일**로 건넨다
//! (세션 서버 설계 9절 ①b · 4.4 · 8절 — docs/internal/session-server-design-2026-10-08.md).
//!
//! ## 왜
//!
//! 예전에는 `AYNX_MCP_URL`·`AYNX_SIGNAL_TOKEN` 을 첫 입력의 `export` 로 셸에 넣었다
//! (docs/log/2026-09-24-remote-agent-signals.md 4절). 그러면 (1) tmux 명령 문자열(`ps`)·화면·셸 이력에 토큰과 포트가
//! 보이고, (2) 재접속하면 `-R` 포워드 포트와 토큰이 바뀌는데 tmux 안에서 이미 돌던 셸·CLI 는 옛 값을 쥔 채라
//! 신호가 끊겼다(같은 기록 7절의 한계). 이제 셸에는 **비밀이 아닌 것만**(`AYNX_STREAM` · `AYNX_CODEX_NO_DAEMON`)
//! 가고, 주소·토큰은 앱이 신호를 세울 때마다(첫 접속 · 재접속) 같은 전송로의 SFTP 로
//! `~/.config/aynx/signal/<스트림>.env` 에 갈아 쓴다. 훅 스크립트(9판 — `crate::agent_hooks::SCRIPT_VERSION`)는
//! 환경변수가 없으면 이 파일에서 두 키만 읽는다(소스하지 않는다). 그래서 옛 CLI 도 **다음 훅부터** 새 포트·새 토큰을 탄다.
//!
//! ## 파일
//!
//! ```text
//! # aynx-signal-env 1 generated=1759900000000
//! AYNX_MCP_URL=http://127.0.0.1:41234
//! AYNX_SIGNAL_TOKEN=<64 hex>
//! ```
//!
//! - **타일 파일로 넓힘**(2026-10-26 에이전트 활성화): 호스트 옵션 `agent` 가 켜졌으면 `AYNX_ARGS_CLAUDE` ·
//!   `AYNX_ARGS_CODEX`(낱말을 `\x1f` 로 이은 값) · `AYNX_NO_DAEMON=1` 도 싣는다 — PATH 심(`crate::agent_shim`)이 읽는다. 신호를
//!   세우지 않은 타일이면 신호 두 키 없이 이 키들만 간다(훅 스크립트는 주소가 없으면 조용히 0). 파일은 **에이전트 활성화가
//!   켜졌거나 셸 통합이 켜졌을 때** 쓴다([`AgentKeys`] · `crate::ssh::open` 의 `arm_agent_signal`).
//! - 폴더 `~/.config/aynx/signal` **0700**, 파일 **0600** — 같은 사용자와 root 만 읽는다(`~/.claude/settings.json`
//!   ·훅 스크립트와 같은 등급). 이 토큰은 그 타일의 상태 점 신호에만 통한다(MCP 는 못 연다 — `crate::agent_signal`).
//! - **원자 교체**: 같은 폴더 임시 파일(`<이름>.tmp`, 0600 으로 만든다)에 다 쓴 뒤 rename. russh-sftp 2.4 는
//!   `posix-rename` 확장을 열지 않아 SFTP v3 rename 이 이미 있는 대상을 거절하면 대상을 지우고 한 번 더 rename 한다
//!   — 그 두 왕복 사이에 훅이 돌면 파일이 없어 그 신호 하나만 조용히 빠진다(반쪽 파일은 보이지 않는다).
//! - **세대**: 첫 줄의 표식(`# aynx-signal-env`)과 생성 시각. 접속할 때 이 폴더에서 **이 앱이 만든 것**(표식) 중
//!   [`STALE_AFTER_SECS`] 넘게 묵었고 지금 살아 있는 토큰이 없는 스트림의 것만 지운다(닫기를 못 거친 고아 — 앱이 죽었거나
//!   전송로가 먼저 끊겼다).
//! - **지우기**: 세션을 닫으며 그 스트림의 토큰을 **주인으로서** 거뒀고 그 주인이 실제로 파일을 썼을 때만(서버 op
//!   `signal_revoke` 의 `{revoked, written}` — 쓴 사실은 `signal_written` 으로 서버의 토큰 칸에 적는다, ③-3a) — 재연결이 이미
//!   새 파일을 썼다면 옛 세션의 닫기는 주인이 달라 지우지 않는다.
//! - 토큰 표는 **세션 서버 프로세스**에 있다(③-3a — `crate::server::signals`). 주소는 서버의 신호 평면 포트로 이어지는 원격
//!   `-R` 포워드다. "살아 있는 토큰인가" 는 서버 op `signal_live` 로 묻고, 서버에 닿지 못하면 **아무것도 지우지 않는다**.
//!
//! ## 토큰 — 유지와 회전 (설계 8절)
//!
//! 창 사이 이관·재부착(단순 attach)은 세션을 다시 열지 않으므로 토큰도 파일도 그대로다. 재접속은 새 SSH 세션 =
//! 새 sessionEpoch 라 `issue` 가 새 토큰을 뽑는다(회전) — 포트도 바뀌므로 어차피 파일을 갈아 써야 하고, 그것으로 충분하다.
//!
//! ## 폴백
//!
//! 셸 통합을 끈 호스트(`shell_integration = false` — "이 서버엔 아무것도 심지 마라" · 에이전트 활성화도 끈 때)나 SFTP 를 못 여는 서버, 쓰기가
//! 실패한 경우에는 파일 없이 **예전 그대로 export** 한다(`crate::ssh::RemoteSignalEnv::in_file` 이 거짓) — 로그 한 줄.
//! 이미 깔린 훅 스크립트가 옛 판(8 이하 — 파일을 읽지 못한다)이면 같은 SFTP 로 이 판으로 맞추고(있을 때만, 로컬의
//! `refresh_installed_script` 와 같은 규칙), 그마저 못 하면 폴백한다.

use std::time::Duration;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use tokio::io::AsyncWriteExt;

use crate::i18n::tr;
use crate::tile_env::stream_ok;

/// 신호 파일 폴더 — SFTP 경로(로그인 폴더 = 홈 기준 상대, `crate::shell_integration` 의 `.aynx/…` 와 같은 근거).
/// 훅 스크립트는 `$HOME/.config/aynx/signal/` 을 본다(`$XDG_CONFIG_HOME` 은 보지 않는다 — 앱이 SFTP 로 그 값을 알 수
/// 없고, 훅 스크립트 자리 `~/.config/aynx/hooks` 와 같은 뿌리를 쓴다).
pub(crate) const DIR: &str = ".config/aynx/signal";
/// [`DIR`] 의 부모들 — 없으면 차례로 만든다.
const PARENTS: [&str; 2] = [".config", ".config/aynx"];
/// 첫 줄의 표식 — 이 앱이 만든 파일을 알아보는 열쇠(쓸어 내기는 이것이 있는 파일만 지운다).
pub(crate) const MARKER: &str = "# aynx-signal-env 1";
pub(crate) const FILE_MODE: u32 = 0o600;
pub(crate) const DIR_MODE: u32 = 0o700;
/// 고아 파일로 치는 나이 — 일주일. 살아 있는 토큰이 있는 스트림의 파일은 나이와 상관없이 둔다.
pub(crate) const STALE_AFTER_SECS: u64 = 7 * 24 * 3600;
/// 쓰기 한 판(채널 열기 · 스크립트 맞추기 · 쓰기 · 쓸어 내기)의 상한 — 넘으면 export 로 폴백한다.
const WRITE_BUDGET: Duration = Duration::from_secs(5);
/// 지우기(세션 닫기)의 상한 — 정리 경로라 짧게.
const REMOVE_BUDGET: Duration = Duration::from_secs(2);

/// 스트림 → SFTP 경로 (**순수 함수**). 스트림 모양이 틀리면 `None`(`/` 가 없으므로 폴더 밖으로 못 나간다).
pub(crate) fn path_of(stream: &str) -> Option<String> {
    stream_ok(stream).then(|| format!("{DIR}/{stream}.env"))
}

/// 주소 모양 — 서버 루프백의 포워드(`http://127.0.0.1:<포트>`)만. 스크립트도 같은 모양만 쓴다.
fn url_ok(url: &str) -> bool {
    url.strip_prefix("http://127.0.0.1:")
        .is_some_and(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// 타일 파일의 Codex `--no-daemon` 키 — PATH 심이 읽는다(`crate::agent_shim`).
pub(crate) const NO_DAEMON_KEY: &str = "AYNX_NO_DAEMON";
/// 낱말 사이 구분 글자 — `parse_args` 를 지난 낱말에는 제어 문자가 없으므로 섞이지 않는다. 심이 `IFS` 로 나눈다.
pub(crate) const ARGS_SEP: char = '\u{1f}';

/// 에이전트의 추가 인자 키 — `AYNX_ARGS_CLAUDE` · `AYNX_ARGS_CODEX`.
pub(crate) fn args_key(agent: &str) -> String {
    format!("AYNX_ARGS_{}", agent.to_ascii_uppercase())
}

/// **에이전트 활성화**(2026-10-26 — `crate::sessions_meta::HostMeta::agent`)가 켜진 타일의 파일에 더하는 키 — PATH 심
/// (`crate::agent_shim`)이 손으로 친 `claude` · `codex` 에 붙인다. 비밀이 아니다(같은 파일에 사는 것은 토큰 때문이다).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AgentKeys {
    /// (에이전트 id, `crate::agent_args::parse_args` 를 지난 낱말들) — 낱말이 없으면 키를 적지 않는다.
    pub args: Vec<(&'static str, Vec<String>)>,
    /// 설정 `[ai] codex_no_daemon` — 심이 Codex 에 `--no-daemon` 을 끼운다.
    pub no_daemon: bool,
}

/// 파일 내용 (**순수 함수**) — 표식·생성 시각 한 줄 + 신호 두 키(신호를 세웠을 때) + 에이전트 키(에이전트 활성화).
/// 값 모양이 틀리면 `None`(줄바꿈·따옴표가 끼어 스크립트의 읽기나 curl 설정 줄을 흔들 수 없게 — 토큰은 16진수, 주소는
/// [`url_ok`], 낱말은 비지 않고 제어 문자가 없다).
pub(crate) fn body(
    signal: Option<(&str, &str)>,
    agent: Option<&AgentKeys>,
    generated_ms: u64,
) -> Option<String> {
    let mut out = format!("{MARKER} generated={generated_ms}\n");
    if let Some((url, token)) = signal {
        if !url_ok(url) || token.is_empty() || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        out.push_str(&format!(
            "{}={url}\n{}={token}\n",
            crate::tile_env::MCP_URL_ENV,
            crate::tile_env::SIGNAL_TOKEN_ENV,
        ));
    }
    if let Some(keys) = agent {
        for (id, words) in &keys.args {
            if words.is_empty() {
                continue;
            }
            let ok_id = !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase());
            let ok_words = words
                .iter()
                .all(|w| !w.is_empty() && !w.chars().any(char::is_control));
            if !ok_id || !ok_words {
                return None;
            }
            let joined = words.join(&ARGS_SEP.to_string());
            out.push_str(&format!("{}={joined}\n", args_key(id)));
        }
        if keys.no_daemon {
            out.push_str(&format!("{NO_DAEMON_KEY}=1\n"));
        }
    }
    Some(out)
}

/// 첫 줄이 우리 표식이면 생성 시각(epoch ms) (**순수 함수**) — 아니면 `None`(남의 파일 — 지우지 않는다).
pub(crate) fn generated_at(body: &str) -> Option<u64> {
    body.lines()
        .next()?
        .strip_prefix(MARKER)?
        .trim()
        .strip_prefix("generated=")?
        .parse()
        .ok()
}

/// 쓸어 낼 후보인가 (**순수 함수**) — `<스트림>.env`(또는 남은 `.env.tmp`)이고, 그 스트림에 살아 있는 토큰이 없고,
/// 파일 시각이 [`STALE_AFTER_SECS`] 보다 오래됐다. 내용(표식)은 부른 쪽이 읽어 다시 본다.
pub(crate) fn sweep_candidate(
    name: &str,
    mtime_secs: Option<u32>,
    now_secs: u64,
    live: impl Fn(&str) -> bool,
) -> bool {
    let Some(stream) = stream_of(name) else {
        return false;
    };
    let old = mtime_secs.is_some_and(|m| now_secs.saturating_sub(u64::from(m)) > STALE_AFTER_SECS);
    old && !live(stream)
}

/// 파일 이름 → 스트림 (`<스트림>.env` · 남은 `.env.tmp`, 모양이 맞을 때만).
fn stream_of(name: &str) -> Option<&str> {
    name.strip_suffix(".env")
        .or_else(|| name.strip_suffix(".env.tmp"))
        .filter(|s| stream_ok(s))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

type Handle = russh::client::Handle<crate::ssh::SshHandler>;

fn perms(mode: u32) -> FileAttributes {
    FileAttributes {
        permissions: Some(mode),
        ..Default::default()
    }
}

/// `target` 을 원자 교체로 쓴다 — 임시 파일을 `mode` 로 만들어 다 쓰고(만든 뒤 한 번 더 setstat — 그 권한을 못 입히면
/// 실패) rename. 모듈 머리말 "원자 교체".
async fn replace_file(sftp: &SftpSession, target: &str, bytes: &[u8], mode: u32) -> Result<(), String> {
    let tmp = format!("{target}.tmp");
    let _ = sftp.remove_file(tmp.clone()).await; // 지난번에 끊겨 남은 것 — EXCLUDE 로 새로 만든다
    let mut file = sftp
        .open_with_flags_and_attributes(
            tmp.clone(),
            OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            perms(mode),
        )
        .await
        .map_err(|e| e.to_string())?;
    let written = async {
        file.write_all(bytes).await?;
        file.flush().await?;
        file.shutdown().await
    }
    .await;
    drop(file);
    let set = match written {
        Ok(()) => sftp.set_metadata(tmp.clone(), perms(mode)).await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    if let Err(e) = set {
        let _ = sftp.remove_file(tmp).await;
        return Err(e);
    }
    if sftp.rename(tmp.clone(), target.to_owned()).await.is_ok() {
        return Ok(());
    }
    // SFTP v3 rename 은 이미 있는 대상을 거절한다(OpenSSH) — 비키고 다시.
    let _ = sftp.remove_file(target.to_owned()).await;
    if let Err(e) = sftp.rename(tmp.clone(), target.to_owned()).await {
        let _ = sftp.remove_file(tmp).await;
        return Err(e.to_string());
    }
    Ok(())
}

/// 이미 깔린 훅 스크립트가 이 판과 다르면 맞춘다 — **있을 때만**(없으면 훅을 안 깐 서버다 — 만들지 않는다).
async fn refresh_hook_script(sftp: &SftpSession) -> Result<(), String> {
    let path = crate::agent_hooks::REMOTE_SCRIPT_SFTP;
    let want = crate::agent_hooks::remote_script_body().as_bytes();
    match sftp.read(path).await {
        Ok(have) if have != want => replace_file(sftp, path, want, 0o755).await,
        _ => Ok(()),
    }
}

/// 묵은 고아 파일을 지운다 — 모듈 머리말 "세대". 실패는 조용히 넘긴다(다음 접속이 다시 본다).
async fn sweep(sftp: &SftpSession) {
    let Ok(read) = sftp.read_dir(DIR).await else {
        return;
    };
    let now = now_ms();
    // 나이로 먼저 고르고(살아 있음은 모른다고 친다), 남은 것의 스트림이 살아 있는지는 서버에 한 번에 묻는다.
    let old: Vec<String> = read
        .filter_map(|e| {
            let name = e.file_name();
            sweep_candidate(&name, e.metadata().mtime, now / 1000, |_| false).then_some(name)
        })
        .collect();
    if old.is_empty() {
        return;
    }
    // 토큰 표는 같은 프로세스(세션 서버)에 있다(③-3b2) — 살아 있는 스트림의 파일은 건드리지 않는다.
    let names: Vec<String> = old
        .into_iter()
        .filter(|n| stream_of(n).is_some_and(|s| !crate::agent_signal::is_live(s)))
        .collect();
    for name in names {
        let full = format!("{DIR}/{name}");
        let ours = sftp
            .read(full.clone())
            .await
            .ok()
            .and_then(|b| generated_at(&String::from_utf8_lossy(&b)))
            .is_some_and(|g| now.saturating_sub(g) / 1000 > STALE_AFTER_SECS);
        if ours {
            let _ = sftp.remove_file(full).await;
        }
    }
}

async fn write_on(sftp: &SftpSession, target: &str, content: &str) -> Result<(), String> {
    refresh_hook_script(sftp).await.map_err(|e| {
        tr!(
            ko: "서버의 훅 스크립트를 이 판으로 맞추지 못했습니다: {e}",
            en: "Could not bring the server's hook script up to date: {e}"
        )
    })?;
    for d in PARENTS {
        let _ = sftp.create_dir(d).await; // 이미 있으면 실패 — 판정은 아래 쓰기가 한다
    }
    let _ = sftp.create_dir(DIR).await;
    // 폴더를 0700 으로 — 못 입혀도 파일 자체가 0600 이다(권한은 파일이 지킨다).
    let _ = sftp.set_metadata(DIR, perms(DIR_MODE)).await;
    replace_file(sftp, target, content.as_bytes(), FILE_MODE).await
}

/// 그 스트림의 신호(타일) 파일을 쓴다(첫 접속 · 재접속마다 덮어씀) — 신호가 있고 성공이면 셸에는 스트림 id 만 export
/// 해도 된다. 실패하면 까닭 한 줄 — 부른 쪽이 예전 export 로 폴백한다(에이전트 키만이면 심이 그대로 돈다). 쓴 뒤 묵은
/// 고아를 쓸어 낸다.
pub(crate) async fn write(
    handle: &Handle,
    stream: &str,
    signal: Option<(&str, &str)>,
    agent: Option<&AgentKeys>,
) -> Result<(), String> {
    let target = path_of(stream).ok_or_else(|| "bad stream".to_string())?;
    let content = body(signal, agent, now_ms()).ok_or_else(|| "bad value".to_string())?;
    let work = async {
        let sftp = crate::sftp::open_sftp_on(handle).await?;
        let result = write_on(&sftp, &target, &content).await;
        if result.is_ok() {
            sweep(&sftp).await;
        }
        let _ = sftp.close().await;
        result
    };
    tokio::time::timeout(WRITE_BUDGET, work).await.unwrap_or_else(|_| {
        Err(tr!(
            ko: "{secs}초 안에 끝나지 않았습니다",
            en: "did not finish within {secs} seconds",
            secs = WRITE_BUDGET.as_secs()
        ))
    })
}

/// 세션을 닫으며 그 스트림의 파일을 지운다 — `agent_signal::revoke` 가 `Some(true)`(거뒀고 이 주인이 파일을 썼다)일 때만
/// 부른다. 그 사이 같은 스트림에 새 세션이 섰으면(토큰이 살아 있으면) 그 세션의 새 파일이라 둔다. 실패는 조용히 넘긴다
/// (묵으면 다음 접속이 쓸어 낸다).
pub(crate) async fn remove(handle: &Handle, stream: &str) {
    let Some(target) = path_of(stream) else { return };
    let work = async {
        if crate::agent_signal::is_live(stream) {
            return;
        }
        let Ok(sftp) = crate::sftp::open_sftp_on(handle).await else {
            return;
        };
        let _ = sftp.remove_file(target).await;
        let _ = sftp.close().await;
    };
    let _ = tokio::time::timeout(REMOVE_BUDGET, work).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOK: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn body_carries_the_marker_and_two_keys_only() {
        let b = body(Some(("http://127.0.0.1:41234", TOK)), None, 1_759_900_000_000).unwrap();
        assert_eq!(
            b,
            format!(
                "# aynx-signal-env 1 generated=1759900000000\nAYNX_MCP_URL=http://127.0.0.1:41234\nAYNX_SIGNAL_TOKEN={TOK}\n"
            )
        );
        assert_eq!(generated_at(&b), Some(1_759_900_000_000));
        assert!(!b.contains("MCP_TOKEN="), "MCP 토큰은 없다");
    }

    #[test]
    fn body_refuses_values_that_could_break_the_reader() {
        for url in ["http://evil:1", "http://127.0.0.1:", "http://127.0.0.1:1\nX=1", "http://127.0.0.1:123456"] {
            assert!(body(Some((url, TOK)), None, 1).is_none(), "{url:?}");
        }
        for tok in ["", "zz", "ab\"cd", "ab\ncd", "ab cd"] {
            assert!(body(Some(("http://127.0.0.1:1", tok)), None, 1).is_none(), "{tok:?}");
        }
        for words in [vec![String::new()], vec!["a\nb".to_string()], vec!["a\u{1f}b".to_string()]] {
            let keys = AgentKeys {
                args: vec![("claude", words.clone())],
                no_daemon: false,
            };
            assert!(body(None, Some(&keys), 1).is_none(), "{words:?}");
        }
    }

    #[test]
    fn agent_keys_ride_with_or_without_the_signal() {
        let keys = AgentKeys {
            args: vec![
                ("claude", vec!["--model".into(), "a b".into()]),
                ("codex", Vec::new()),
            ],
            no_daemon: true,
        };
        // 신호 없이 — 에이전트 키만(빈 낱말 목록은 키를 적지 않는다).
        assert_eq!(
            body(None, Some(&keys), 5).unwrap(),
            "# aynx-signal-env 1 generated=5\nAYNX_ARGS_CLAUDE=--model\u{1f}a b\nAYNX_NO_DAEMON=1\n"
        );
        // 신호와 함께 — 신호 두 키 뒤에.
        let b = body(Some(("http://127.0.0.1:1", TOK)), Some(&keys), 5).unwrap();
        assert!(b.starts_with(&format!(
            "# aynx-signal-env 1 generated=5\nAYNX_MCP_URL=http://127.0.0.1:1\nAYNX_SIGNAL_TOKEN={TOK}\nAYNX_ARGS_CLAUDE="
        )));
        assert_eq!(generated_at(&b), Some(5));
        // 아무것도 없으면 표식 한 줄 — 심은 그대로 돈다(옛 인자가 남지 않게 덮어쓰는 데 쓴다).
        assert_eq!(body(None, Some(&AgentKeys::default()), 7).unwrap(), "# aynx-signal-env 1 generated=7\n");
    }

    #[test]
    fn path_stays_inside_the_folder() {
        assert_eq!(path_of("s-1").as_deref(), Some(".config/aynx/signal/s-1.env"));
        assert_eq!(path_of("..").as_deref(), Some(".config/aynx/signal/...env"), "점만이면 파일 이름이다");
        for bad in ["a/b", "", "a b", "../x"] {
            assert!(path_of(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn only_our_marker_has_a_generation() {
        assert_eq!(generated_at("# aynx-signal-env 1 generated=5\nX=1\n"), Some(5));
        for other in ["", "AYNX_MCP_URL=x\n", "# something else generated=5\n", "# aynx-signal-env 1\n"] {
            assert_eq!(generated_at(other), None, "{other:?}");
        }
    }

    #[test]
    fn sweep_takes_only_old_unlived_env_files() {
        let now = 10 * STALE_AFTER_SECS;
        let old = Some(u32::try_from(now - STALE_AFTER_SECS - 1).unwrap());
        let fresh = Some(u32::try_from(now - 60).unwrap());
        let none = |_: &str| false;
        assert!(sweep_candidate("s-1.env", old, now, none));
        assert!(sweep_candidate("s-1.env.tmp", old, now, none));
        assert!(!sweep_candidate("s-1.env", fresh, now, none), "새것");
        assert!(!sweep_candidate("s-1.env", None, now, none), "시각 모름");
        assert!(!sweep_candidate("s-1.env", old, now, |s| s == "s-1"), "살아 있는 세션의 파일");
        assert!(!sweep_candidate("notes.txt", old, now, none));
        assert!(!sweep_candidate("a b.env", old, now, none));
    }
}
