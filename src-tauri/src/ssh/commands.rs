//! 작은 질의 명령 — tmux 폴더·목록·끄기 · 원격 홈 · 호스트 키 잊기. 화면(PTY)을 건드리지 않는 exec 왕복 하나 또는 디스크 한 번이다.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::known_hosts;
use crate::ssh_config;

use super::*;

/// 짧아야 한다 — 실패하면 "모름" 으로 떨어지는 것이 정답이고, 사용자는 누른 채 기다리고 있다.
pub(super) const TMUX_QUERY_TIMEOUT: Duration = Duration::from_secs(3);

/// 원격 설정 스크립트 파일을 exec 로 써 두는 시한 — 넘기면 긴 한 줄로 간다(`open_ssh_session`).
pub(crate) const SETUP_WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// tmux 타일은 셸 통합이 없어 OSC 7 이 없다 — "지금 폴더" 를 아는 길이 이것뿐이다. 실패는 오류가 아니라 모름(`None`)이다.
#[tauri::command]
pub async fn ssh_tmux_cwd(
    id: u32,
    name: String,
) -> Result<Option<String>, String> {
    // 프런트(배치 파일·세션 목록)를 한 바퀴 돌고 온 문자열이라 셸에 넣기 전에 잠근다.
    let Some(name) = safe_tmux_target(&name) else {
        return Ok(None);
    };
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Ok(None);
    };
    let outcome = run_exec(
        handle,
        tmux_cwd_command(name),
        TMUX_QUERY_TIMEOUT,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    if outcome.exit_code != Some(0) {
        return Ok(None);
    }
    let path = outcome
        .stdout
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    Ok((!path.is_empty()).then_some(path))
}

/// 종료 코드가 0 이 아니면(tmux 없음 · 서버 안 뜸) 오류가 아니라 빈 목록이다 — 사용자에게 참인 말은 "세션이 없습니다" 다.
#[tauri::command]
pub async fn ssh_tmux_list(
    id: u32,
) -> Result<Vec<TmuxSessionInfo>, String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let outcome = run_exec(
        handle,
        tmux_list_command(),
        TMUX_QUERY_TIMEOUT,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    if outcome.exit_code != Some(0) {
        return Ok(Vec::new());
    }
    Ok(parse_tmux_list(&outcome.stdout))
}

const TMUX_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// 사람의 끄기 단추 전용 — MCP · AI 에는 이 길이 없다(Tauri 명령뿐). 명령은 [`tmux_kill_command`] 고정 조립이고 프런트는 이름만 준다.
/// 목록과 달리 실패는 오류다.
#[tauri::command]
pub async fn ssh_tmux_kill(
    id: u32,
    name: String,
) -> Result<(), String> {
    let Some(name) = killable_tmux_name(&name) else {
        return Err(tr!(
            ko: "앱에서 끌 수 없는 세션 이름입니다 — 셸에서 tmux kill-session 으로 끄세요",
            en: "This session name cannot be killed from the app — use tmux kill-session in a shell"
        ));
    };
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let outcome = run_exec(
        handle,
        tmux_kill_command(name),
        TMUX_KILL_TIMEOUT,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    if let Some(e) = outcome.error {
        return Err(e);
    }
    if outcome.timed_out {
        return Err(tr!(
            ko: "응답이 없습니다 — 목록을 다시 읽어 꺼졌는지 확인하세요",
            en: "No answer — refresh the list to see whether it was killed"
        ));
    }
    if outcome.exit_code != Some(0) {
        let why = outcome
            .stderr
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .to_string();
        // 사유 한 줄만 — 머리는 화면의 알림이 붙인다(`pane.tmux.kill.failed`).
        return Err(if why.is_empty() {
            let code = outcome.exit_code.map_or_else(|| "?".to_string(), |c| c.to_string());
            tr!(ko: "tmux 가 종료 코드 {code} 로 끝났습니다", en: "tmux exited with code {code}", code = code)
        } else {
            why
        });
    }
    Ok(())
}

const REMOTE_HOME_TIMEOUT: Duration = Duration::from_secs(5);

/// `echo` 를 쓰지 않는다 — `-n`·역슬래시 해석이 셸마다 다르다. `printf %s` 는 fish 에서도 같은 뜻이다.
pub(crate) const REMOTE_HOME_COMMAND: &str = "printf %s \"$HOME\"";

/// 절대 경로만 받는다 — 로그인 스크립트가 무언가를 찍었으면 틀린 홈으로 펴느니 `None`(프런트가 글자 비교로 돈다).
pub(crate) fn parse_remote_home(stdout: &str) -> Option<String> {
    let s = stdout.trim_end_matches(['\r', '\n']);
    if !s.starts_with('/') || s.chars().any(char::is_control) {
        return None;
    }
    let t = s.trim_end_matches('/');
    Some(if t.is_empty() {
        "/".to_string()
    } else {
        t.to_string()
    })
}

#[tauri::command]
pub async fn ssh_remote_home(
    id: u32,
) -> Result<String, String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let outcome = run_exec(
        handle,
        REMOTE_HOME_COMMAND.to_string(),
        REMOTE_HOME_TIMEOUT,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    if let Some(e) = outcome.error {
        return Err(e);
    }
    if outcome.timed_out || outcome.exit_code != Some(0) {
        return Err(
            tr!(ko: "원격 홈 폴더를 알아내지 못했습니다", en: "Could not learn the remote home folder"),
        );
    }
    parse_remote_home(&outcome.stdout).ok_or_else(
        || tr!(ko: "원격 홈 폴더가 절대 경로가 아닙니다", en: "The remote home folder is not an absolute path"),
    )
}

// ── 호스트 키 잊기 ──

/// `host`·`port` 를 함께 돌려준다 — 별칭과 실제 대상이 달라 안내가 별칭만 말하면 `known_hosts` 에서 찾지 못한다.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ForgetHostKeyReport {
    pub host: String,
    pub port: u16,
    /// 0 이면 파일을 건드리지 않았다.
    pub removed: usize,
}

/// 별칭 해석은 접속과 같은 [`resolve_params`] 를 지난다 — "접속할 때 보는 호스트" 와 "잊는 호스트" 가 어긋나지 않게.
/// 점프 호스트는 건드리지 않는다(자기 별칭으로 잊는다).
#[tauri::command]
pub async fn forget_host_key(alias: String) -> Result<ForgetHostKeyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = ssh_config::load_default()?;
        let username = std::env::var("USERNAME").ok();
        // 사용자 이름 오류는 접속에만 뜻이 있다 — 여기서는 호스트/포트만 있으면 된다.
        let (host, port) = match resolve_params(&alias, &config.hosts, username.as_deref()) {
            Ok(p) => (p.host, p.port),
            Err(_) => {
                let entry = config
                    .hosts
                    .iter()
                    .find(|h| h.name.eq_ignore_ascii_case(&alias));
                (
                    entry
                        .and_then(|e| e.host_name.clone())
                        .filter(|h| !h.is_empty())
                        .unwrap_or_else(|| alias.clone()),
                    entry.and_then(|e| e.port).unwrap_or(22),
                )
            }
        };
        let removed = known_hosts::forget(&host, port)?;
        Ok(ForgetHostKeyReport {
            host,
            port,
            removed,
        })
    })
    .await
    .map_err(|e| tr!(ko: "호스트 키 잊기 작업을 마치지 못했습니다: {e}", en: "The task that forgets the host key did not finish: {e}"))?
}
