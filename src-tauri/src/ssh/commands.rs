//! 작은 질의 명령 — tmux 폴더·세션 목록(`ssh_tmux_cwd`·`ssh_tmux_list`) · tmux 세션 끄기(`ssh_tmux_kill` — 사람 단추 전용) · 원격 홈(`ssh_remote_home`) ·
//! 호스트 키 잊기(`forget_host_key`). 전부 exec 왕복 하나 또는 디스크 한 번이다.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::known_hosts;
use crate::ssh_config;

use super::*;

/// tmux 질의(폴더·세션 목록)의 시한 — 짧아야 한다. 실패하면 "모름" 으로 떨어지는 것이
/// 정답이고, 사용자는 📂 나 목록을 누른 채 기다리고 있다.
pub(super) const TMUX_QUERY_TIMEOUT: Duration = Duration::from_secs(3);

/// 원격 설정 스크립트 파일을 exec 로 써 두는 시한 — 넘기면 예전의 긴 한 줄로 간다(`open_ssh_session`).
pub(crate) const SETUP_WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// tmux 세션의 **활성 패널이 있는 폴더**를 묻는다 — 화면(PTY)을 건드리지 않는 exec 왕복 하나.
///
/// tmux 타일은 셸 통합을 심지 않으므로 OSC 7 이 없다(간이 모드) — 📂 가 "지금 폴더" 를 아는
/// 유일한 길이 이것이다. **실패는 오류가 아니라 모름**이다: 못 물었으면 `None` 을 주고,
/// 프런트는 여느 폴더 미상과 똑같이 홈에서 브라우저를 연다.
///
/// 파일·네트워크를 만지므로 당연히 `async` 다 (docs/conventions.md).
#[tauri::command]
pub async fn ssh_tmux_cwd(
    id: u32,
    name: String,
) -> Result<Option<String>, String> {
    // 프런트(=배치 파일·세션 목록)를 한 바퀴 돌고 온 문자열이라 셸에 넣기 전에 잠근다.
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
    // 종료 코드가 0 이 아니면(세션이 없다·tmux 가 없다) 물어본 적 없는 것과 같다.
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

/// **서버에 있는 tmux 세션 목록** — 화면(PTY)을 건드리지 않는 exec 왕복 하나
/// (docs/log/2026-09-16-tmux-toggle.md).
///
/// 이름 장부는 원래 **이 앱이 지금 물고 있는 것**만 안다. 서버에 남아 있지만 아무도 안 붙은
/// 세션(`aynx-3`·사람이 손으로 만든 `work`)은 그 장부에 없다 — 이 명령이 그 빈자리를 메운다.
///
/// **없음은 오류가 아니다.** tmux 가 깔려 있지 않거나(`127`) 서버가 안 떠 있으면
/// (`no server running on …` · 종료 코드 1) 종료 코드가 0 이 아니므로 **빈 목록**을 돌려준다.
/// 그 둘을 오류로 올리면 프런트가 "읽지 못했습니다" 를 띄우는데, 사용자에게 참인 말은
/// "세션이 없습니다" 다.
///
/// 파일·네트워크를 만지므로 당연히 `async` 다 (docs/conventions.md).
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

/// [`ssh_tmux_kill`] 의 시한 — 질의보다 조금 길다(세션의 프로세스를 거두는 시간). 넘기면 오류 한 줄이고 사람은 목록을
/// 다시 읽어 확인한다(이미 나간 명령이라 꺼졌을 수도 있다).
const TMUX_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// **tmux 세션 하나를 끈다** — 사람이 tmux 목록 팝오버의 끄기 단추를 누르고 확인한 뒤(`pane/TmuxMenu.svelte`).
/// 화면(PTY)을 건드리지 않는 exec 왕복 하나이고, 명령은 [`tmux_kill_command`] 고정 조립이다(프런트는 이름만 준다 —
/// 이름은 [`killable_tmux_name`] 이 잠근다). MCP · AI 에는 이 길이 없다(도구 없음 — Tauri 명령뿐).
///
/// 목록과 달리 **실패는 오류다** — 사람이 끄라고 했는데 꺼지지 않았으면 그렇게 말해야 한다(없는 세션이면 tmux 의
/// `can't find session` 한 줄이 그대로 간다).
///
/// 파일·네트워크를 만지므로 당연히 `async` 다 (docs/conventions.md).
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
        // 사유 한 줄만 — "끄지 못했습니다:" 머리는 화면의 알림이 붙인다(`pane.tmux.kill.failed`).
        return Err(if why.is_empty() {
            let code = outcome.exit_code.map_or_else(|| "?".to_string(), |c| c.to_string());
            tr!(ko: "tmux 가 종료 코드 {code} 로 끝났습니다", en: "tmux exited with code {code}", code = code)
        } else {
            why
        });
    }
    Ok(())
}

/// [`ssh_remote_home`] 의 시한 — 셸이 `$HOME` 한 줄을 찍는 데 이보다 오래 걸리면 서버가 앓는
/// 것이다. 넘기면 오류이고 프런트는 "모른다" 로 남아 예전의 글자 비교로 돌아간다.
const REMOTE_HOME_TIMEOUT: Duration = Duration::from_secs(5);

/// 원격 `$HOME` 을 묻는 exec 명령. `echo` 가 아니라 `printf %s` 인 이유: 줄바꿈을 붙이지 않고,
/// `-n`·역슬래시 해석이 셸마다 다른 `echo` 의 갈래를 타지 않는다. fish 에서도 같은 뜻이다.
pub(crate) const REMOTE_HOME_COMMAND: &str = "printf %s \"$HOME\"";

/// `printf %s "$HOME"` 의 출력 → 홈 폴더 (**순수 함수**). 절대 경로(`/…`)만 받는다 — 비었거나
/// (`$HOME` 이 없다) 상대 경로·제어 문자가 섞였으면(로그인 스크립트가 무언가를 찍었다) `None`
/// 이다. 틀린 홈으로 경로를 펴는 것보다 모르는 채로 두는 편이 낫다(프런트가 글자 비교로 돈다).
/// 끝 구분자는 뗀다(뿌리 `/` 는 그대로).
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

/// **원격 `$HOME`** — 살아 있는 세션 `id` 의 전송로로 exec 왕복 하나
/// (docs/log/2026-09-24-worktrees.md "`~` 와 git 의 절대 경로").
///
/// 프로젝트 경로는 사람이 `~/api` 로 적고 git 은 `/root/api` 로 적는다 — 둘을 맞대려면 그
/// 서버의 홈을 알아야 한다. 프런트가 별칭마다 한 번 묻고 그 전송로가 살아 있는 동안 쥔다
/// (`app/remote-home.svelte.ts`). 화면(PTY)을 건드리지 않는다(`ssh_tmux_list` 와 같은 길).
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

// ---------------------------------------------------------------------------
// 호스트 키 잊기 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
// ---------------------------------------------------------------------------

/// [`forget_host_key`] 의 결과 — 어디의 몇 줄을 지웠는가.
///
/// `host`·`port` 를 함께 돌려주는 이유는 **별칭과 실제 대상이 다르기 때문**이다
/// (`Host web-01` → `HostName 10.0.0.7`). 안내 문구가 "web-01" 이라고만 말하면 사용자는
/// 자기 `known_hosts` 에서 그 이름을 찾다가 없다고 생각한다.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ForgetHostKeyReport {
    pub host: String,
    pub port: u16,
    /// 지운 줄 수. 0 이면 파일을 **건드리지 않았다**.
    pub removed: usize,
}

/// 이 별칭이 가리키는 서버의 known_hosts 항목을 전부 지운다 (`ssh-keygen -R` 상당).
///
/// 별칭 해석은 접속과 **같은 기계**([`resolve_params`])를 지난다 — 그래야 "접속할 때 보는
/// 호스트" 와 "잊는 호스트" 가 어긋나지 않는다. 설정에 없는 이름이면 OpenSSH 처럼 그 이름
/// 자체를 호스트로 본다(빠른 접속 타일의 `user@host:port` 를 넘겨도 되지만, 그쪽 UI 는
/// 지금 이 항목을 두지 않는다).
///
/// **점프 호스트는 건드리지 않는다** — 그쪽은 별개의 서버이고 자기 별칭으로 잊어야 한다.
///
/// 디스크를 만지므로 `async fn` + `spawn_blocking` 이다 (docs/conventions.md 의 "Tauri 명령은
/// 기본 async fn").
#[tauri::command]
pub async fn forget_host_key(alias: String) -> Result<ForgetHostKeyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = ssh_config::load_default()?;
        let username = std::env::var("USERNAME").ok();
        // 사용자 이름을 못 찾는 경우에도 **호스트/포트는 알 수 있다** — 그 오류는 접속에만
        // 뜻이 있으므로 여기서는 별칭을 그대로 호스트로 보고 이어 간다.
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
