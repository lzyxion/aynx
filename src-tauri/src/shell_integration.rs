//! OSC 133 셸 통합 — 훅 스니펫과 그것을 원격 서버(SFTP · exec 런처)와 로컬 셸(PowerShell · WSL · Git Bash)에 심는 부트스트랩.
//!
//! - 순서가 계약이다: 스니펫이 먼저 서고 사용자의 `on_connect` 는 언제나 마지막이다([`crate::ssh::prepare_on_connect`]).
//! - 로그인 셸이 bash 인지는 앱이 먼저 묻는다([`probe_login_shell`]) — 셸 안 판정에만 맡기면 zsh·fish 서버가 런처의 `else` 갈래로 떠 훅을 잃는다.
//!
//! 정직한 한계:
//! - tmux 안의 셸은 자동으로 훅을 얻지 못한다 — 서버의 rc 를 건드리지 않으므로, 사용자가 자기 rc 에서 `~/.aynx/integration.sh` 를 읽어야 한다(앱이 새로 만드는 tmux 세션만 [`tmux_session_shell`] 이 메운다).
//! - bash 의 기존 `DEBUG` trap 은 대체된다 — 이전 핸들러가 함수 이름 하나인 경우에만 먼저 불러 준다.
//! - 옵트아웃(`shell_integration = false`)이면 사용자의 `on_connect` 만 보낸다. 실패해도 세션은 유지된다.

use std::path::{Path, PathBuf};

use russh::client::Handle;
use russh_sftp::client::SftpSession;

use crate::i18n::tr;
use crate::ssh::SshHandler;

/// heredoc 종료 표식. 스니펫 본문에 이 줄이 있으면 파일이 잘리므로 조립 전에 검사한다.
pub(crate) const HEREDOC_TAG: &str = "AYNX_EOF";

/// 서버에 남는 스니펫 경로(홈 기준) — 재접속마다 덮어쓴다. 명령 이력은 그 옆 `~/.aynx/history` 에 `ISO시각<TAB>종료코드<TAB>명령` 으로 쌓인다([`SNIPPET`] 안에 박힌 경로).
pub(crate) const SNIPPET_PATH: &str = "~/.aynx/integration.sh";

/// SFTP 에는 `~` 를 풀 셸이 없다 — SFTP v3 상대 경로의 기준이 홈이라 `~/` 를 뗀 이 값이 [`SNIPPET_PATH`] 와 같은 자리다(테스트가 두 상수를 묶는다).
const REMOTE_PATH: &str = ".aynx/integration.sh";

const REMOTE_DIR: &str = ".aynx";

/// `bash --rcfile` 이 읽는 시작 파일(홈 기준) — 로그인 셸의 프로필을 먼저 읽고 맨 뒤에 스니펫을 얹는다([`remote_rc_body`]).
pub(crate) const RC_PATH: &str = "~/.aynx/rc";

/// SFTP 용 상대 경로([`REMOTE_PATH`] 와 같은 근거).
const REMOTE_RC_PATH: &str = ".aynx/rc";

/// `~` 는 큰따옴표 안에서 안 풀려 `$HOME` 을 쓴다 — 작은따옴표는 못 쓴다(런처 전체가 `sh -c '…'` 한 겹 안이다).
const RC_IN_LAUNCHER: &str = "$HOME/.aynx/rc";

const SNIPPET_IN_HOME: &str = "$HOME/.aynx/integration.sh";

/// 있으면 sshd 가 exec 을 `<로그인 셸> -c` 로 돌리는 유닉스다 — 없는 서버(Windows OpenSSH)에 런처를 보내면 cmd/PowerShell 오류가 되므로 타이핑 경로로 물러난다.
const POSIX_PROBE: &str = "/bin/sh";

/// `all` 은 tmux 3.4+ · `on` 은 3.3+ · 그 아래는 옵션 없이 늘 통과라 셋 다 실패해도 `true` 로 끝낸다(docs/verification/tmux.md §5).
/// tmux 서버가 없으면 하나 띄운다 — 뒤의 `tmux new -A` 가 옵션이 켜진 채 붙으므로 접속 시점에 둔다.
const TMUX_PASSTHROUGH: &str = "command -v tmux >/dev/null 2>&1 && { tmux set -g allow-passthrough all 2>/dev/null || tmux set -g allow-passthrough on 2>/dev/null || true; }; true";

/// bash·zsh 겸용 OSC 133 훅 — `A;aynx=1`(precmd) · `B;aynx=1`(`PS1` 맨 끝) · `C;aynx=1`(bash `DEBUG` trap · zsh `preexec`) · `D;<코드>;aynx=1`(precmd), 그리고 OSC 7 `file://<호스트><$PWD>`.
///
/// - `aynx=1` 은 출처 태그다 — 프런트(`src/lib/shell-integration.ts`)가 처음 본 `A` 의 태그로 소스를 고정한다. 남의 통합(VS Code · iTerm2 · kitty · Warp · starship)이 서 있으면 아무것도 심지 않는다.
/// - `B` 는 프롬프트마다 `PS1` 끝을 다시 확인해 붙인다 — starship·oh-my-posh 처럼 `PS1` 을 통째로 다시 만드는 테마가 있다.
/// - bash 의 `$__aynx_b` 는 날 바이트가 아니라 PS1 이스케이프 글자(`\033` · `\007` · `\\`)다 — 날 바이트면 tmux ST 의 `\` 가 `\]` 와 붙어 `]` 가 찍히고 줄 폭이 깨진다. zsh 는 날 바이트 그대로(docs/log/2026-09-27-shell-marker-redirect.md).
/// - OSC 7 경로는 퍼센트 인코딩하지 않는다 — 프런트 `parseOsc7Cwd` 가 날 공백을 통과시킨다(테스트가 못 박는다).
/// - `PROMPT_COMMAND` 는 보존·체이닝하고 precmd 는 `return $?` 로 원래 코드를 돌려준다 — 뒤이은 테마 함수가 `$?` 로 색을 정한다.
/// - `$TMUX` 면 `ESC P tmux; … ESC \` 로 감싸고 payload 안의 ESC 를 두 번 쓴다(docs/verification/tmux.md §1).
/// - bash `__aynx_state` 는 0 으로 시작해야 한다 — 1 이면 스니펫 자신의 남은 줄이 첫 사용자 명령으로 이력에 남는다. `DEBUG` trap 은 1(입력 대기)에서만 명령으로 친다.
/// - bash 의 `C` 는 `2>/dev/null >/dev/tty` 로 쓴다 — 복합 명령의 리다이렉트가 이미 걸린 뒤라 stdout 이면 사용자 파일 맨 앞에 박힌다. `2>` 가 먼저여야 `/dev/tty` 를 못 열 때의 오류도 삼킨다.
/// - `codex` 감싸개(bash 만)는 `AYNX_STREAM` 과 `AYNX_CODEX_NO_DAEMON=1` 이 둘 다 있을 때 프롬프트마다(`__aynx_codex_arm`) 확인해 선다 — 원격은 신호 `export` 가 스니펫 뒤의 첫 입력 줄로 온다. 사용자가 세운 `codex` 함수는 건드리지 않는다.
/// - 본문에 `!` 를 쓰지 않는다 — 대화형 bash 는 heredoc 본문에도 히스토리 전개를 돌려 "event not found" 로 줄이 날아간다.
pub(crate) const SNIPPET: &str = r#"# aynx shell integration (v6) - generated; do not edit
[ -n "$__aynx_loaded" ] && return 0
if [ -n "$VSCODE_SHELL_INTEGRATION" ] || [ -n "$ITERM_SHELL_INTEGRATION_INSTALLED" ] || [ -n "$KITTY_SHELL_INTEGRATION" ] || [ -n "$WARP_HONOR_PS1" ] || command -v __vsc_prompt_start >/dev/null 2>&1 || command -v iterm2_preexec >/dev/null 2>&1 || command -v starship_precmd >/dev/null 2>&1; then __aynx_loaded=1; return 0; fi
__aynx_loaded=1
__aynx_emit(){ if [ -n "$TMUX" ]; then printf '\033Ptmux;\033\033]133;%s\007\033\\' "$1"; else printf '\033]133;%s\007' "$1"; fi; }
__aynx_cwd(){ local h="${HOSTNAME:-$(hostname 2>/dev/null)}"; [ -n "$h" ] || h=localhost; if [ -n "$TMUX" ]; then printf '\033Ptmux;\033\033]7;file://%s%s\007\033\\' "$h" "$PWD"; else printf '\033]7;file://%s%s\007' "$h" "$PWD"; fi; }
__aynx_log(){ [ -n "$2" ] || return 0; local l="${2//$'\n'/ }"; l="${l//$'\t'/ }"; mkdir -p "$HOME/.aynx" 2>/dev/null; printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$l" >> "$HOME/.aynx/history" 2>/dev/null; return 0; }
__aynx_state=0; __aynx_cmd=
if [ -n "$BASH_VERSION" ]; then
if [ -n "$TMUX" ]; then __aynx_b='\033Ptmux;\033\033]133;B;aynx=1\007\033\\'; else __aynx_b='\033]133;B;aynx=1\007'; fi
__aynx_prev=$(trap -p DEBUG); __aynx_prev=${__aynx_prev#trap -- \'}; __aynx_prev=${__aynx_prev%\' DEBUG}
command -v "$__aynx_prev" >/dev/null 2>&1 || __aynx_prev=
__aynx_pre(){ [ -n "$__aynx_prev" ] && "$__aynx_prev"; case "$BASH_COMMAND" in __aynx_*) return 0;; esac; [ -n "$COMP_LINE" ] && return 0; [ "$__aynx_state" = 1 ] || return 0; __aynx_state=2; __aynx_cmd=$BASH_COMMAND; __aynx_emit "C;aynx=1" 2>/dev/null >/dev/tty; return 0; }
__aynx_post(){ local c=$?; [ "$__aynx_state" = 2 ] && { __aynx_emit "D;$c;aynx=1"; __aynx_log "$c" "$__aynx_cmd"; }; __aynx_state=0; __aynx_cmd=; __aynx_cwd; __aynx_emit "A;aynx=1"; return $c; }
__aynx_ready(){ __aynx_state=1; case "$PS1" in *"133;B"*) ;; *) PS1="$PS1\[$__aynx_b\]";; esac; __aynx_codex_arm; }
__aynx_codex_arm(){
  [ -z "$__aynx_codex_armed" ] && [ -n "$AYNX_STREAM" ] && [ "$AYNX_CODEX_NO_DAEMON" = 1 ] || return 0
  __aynx_codex_armed=1
  declare -F codex >/dev/null 2>&1 && return 0
  function codex {
    local __a
    for __a in "$@"; do
      case $__a in --no-daemon|--remote|--remote=*) command codex "$@"; return ;; esac
    done
    case $1 in
      resume|fork) local __s=$1; shift; command codex "$__s" --no-daemon "$@" ;;
      *) command codex --no-daemon "$@" ;;
    esac
  }
}
trap '__aynx_pre' DEBUG
case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
"declare -a"*) PROMPT_COMMAND=(__aynx_post "${PROMPT_COMMAND[@]}" __aynx_ready);;
*) PROMPT_COMMAND="__aynx_post${PROMPT_COMMAND:+;$PROMPT_COMMAND};__aynx_ready";;
esac
elif [ -n "$ZSH_VERSION" ]; then
__aynx_b=$(__aynx_emit "B;aynx=1")
__aynx_pre(){ __aynx_cmd=$1; __aynx_emit "C;aynx=1"; }
__aynx_post(){ local c=$?; [ -n "$__aynx_cmd" ] && { __aynx_emit "D;$c;aynx=1"; __aynx_log "$c" "$__aynx_cmd"; __aynx_cmd=; }; __aynx_cwd; __aynx_emit "A;aynx=1"; return $c; }
__aynx_ready(){ case "$PS1" in *"133;B"*) ;; *) PS1="$PS1%{$__aynx_b%}";; esac; }
typeset -ga precmd_functions preexec_functions
precmd_functions=(__aynx_post ${precmd_functions:#__aynx_post})
precmd_functions=(${precmd_functions:#__aynx_ready} __aynx_ready)
preexec_functions=(__aynx_pre ${preexec_functions:#__aynx_pre})
fi"#;

/// 서버에 심을 파일 내용 — SFTP 와 heredoc 이 같은 바이트를 써야 한다(다르면 "같으면 안 쓴다" 생략이 거짓말이 된다).
fn snippet_file() -> String {
    let mut out = String::with_capacity(SNIPPET.len() + 1);
    out.push_str(SNIPPET);
    if !SNIPPET.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// 조용한 경로에서 타이핑되는 한 줄 — [`EchoFilter`] 가 같은 문자열을 지우므로 하나로 묶는다(테스트가 못 박는다).
pub(crate) fn quiet_command_line() -> String {
    format!(". {SNIPPET_PATH}; {TMUX_PASSTHROUGH}")
}

// ---------------------------------------------------------------------------
// 시작 파일로 실행
// ---------------------------------------------------------------------------

/// `bash --rcfile` 이 읽을 rc 내용 — `--rcfile` bash 는 로그인 셸이 아니라 [`PROFILE_CHAIN`] 으로 프로필을 대신 읽고, 맨 뒤에 스니펫을 얹는다(사용자의 `PROMPT_COMMAND` 를 감싸야 한다).
/// `~/.bashrc` 를 따로 읽지 않는다 — 로그인 bash 는 그것을 프로필을 통해서만 읽으므로, 따로 읽으면 로그인 셸과 다른 셸이 뜬다. 줄바꿈은 LF 하나(CR 이면 `$'\r': command not found` · 테스트가 못 박는다).
pub(crate) fn remote_rc_body() -> String {
    format!(
        "# aynx shell integration rc (v2) - generated; do not edit\n\
         # login-shell 과 같은 순서로 프로필을 읽는다 (VS Code 터미널의 shellIntegration-bash.sh 와 같은 규칙)\n\
         # ~/.bashrc 는 따로 읽지 않는다 - 로그인 bash 는 그것을 프로필을 통해서만 읽는다.\n\
         # 편의보다 로그인 셸과의 충실도가 먼저다.\n\
         # 프로필 뒤에 aynx PATH 심 폴더를 다시 맨 앞에 세운다 - 앱이 이 타일에 export 했을 때만(에이전트 활성화).\n\
         {mark}\
         {PROFILE_CHAIN}\
         {front}\
         [ -f \"{SNIPPET_IN_HOME}\" ] && . \"{SNIPPET_IN_HOME}\"\n\
         {TMUX_PASSTHROUGH}\n",
        mark = crate::agent_shim::RC_SHIM_MARK,
        front = crate::agent_shim::RC_SHIM_FRONT,
    )
}

/// 로그인 셸과 같은 순서로 `/etc/profile` → `~/.bash_profile` · `~/.bash_login` · `~/.profile` 중 처음 있는 하나를 읽는다 — `--rcfile` bash 는 로그인 셸이 아니라 `PATH` 가 빈다.
/// 원격 rc · Git Bash rc · 에이전트 rc(`crate::agent_shim::agent_rc_body`)가 함께 쓴다. LF 만.
pub(crate) const PROFILE_CHAIN: &str = "[ -f /etc/profile ] && . /etc/profile\n\
                             for __aynx_f in \"$HOME/.bash_profile\" \"$HOME/.bash_login\" \"$HOME/.profile\"; do\n\
                             \x20 if [ -f \"$__aynx_f\" ]; then . \"$__aynx_f\"; break; fi\n\
                             done\n\
                             unset __aynx_f\n";

/// sshd 의 exec 요청으로 보낼 런처 한 줄 — 셸이 처음부터 훅을 물고 떠 서버 이력 · 화면에 우리 줄이 남지 않는다.
/// 안쪽에 작은따옴표가 하나도 없어야 한다 — 로그인 셸이 fish·csh 여도 깨지지 않는 모양이 작은따옴표 한 겹뿐이다(테스트가 "따옴표는 정확히 둘" 을 못 박는다).
/// `${SHELL:-/bin/sh}` 기본값은 `$SHELL` 이 빈 계정에서 `exec "" -l` 이 되는 것을 막는다.
pub(crate) fn exec_launcher() -> String {
    format!(
        "exec sh -c 'if [ \"${{SHELL##*/}}\" = bash ]; \
         then exec \"$SHELL\" --rcfile \"{RC_IN_LAUNCHER}\" -i; \
         else exec \"${{SHELL:-/bin/sh}}\" -l; fi'"
    )
}

/// 앱이 연 새 tmux 세션의 셸 — [`exec_launcher`] 와 같은 rc 로 띄워 tmux 안에도 스니펫(과 `codex` 감싸개)이 선다.
/// - `new-session -A` 가 이미 있는 세션에 붙으면 이 명령은 무시된다(알려진 한계).
/// - 간이 모드(tmux) 타일에 OSC 133 파서를 붙이지 않는 결정(`Terminal.svelte`)은 그대로다 — passthrough 된 133·7 은 핸들러가 없어 xterm 이 버린다(docs/log/2026-09-16-tmux-toggle.md).
/// - `agent` 면 셸 통합 rc 가 없을 때 에이전트 rc 로 뜬다 — `-l` 이면 사용자 프로필의 `PATH` 줄이 심을 가린다. zsh · fish 는 `-l`(알려진 한계). `agent` 가 거짓이면 글자 하나 다르지 않다.
pub(crate) fn tmux_session_shell(agent: bool) -> String {
    let agent_rc = if agent {
        format!(
            "elif [ -f \"{rc}\" ] && [ \"${{SHELL##*/}}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"{rc}\" -i; ",
            rc = crate::agent_shim::AGENT_RC_PATH
        )
    } else {
        String::new()
    };
    format!(
        "if [ -f \"{RC_IN_LAUNCHER}\" ] && [ \"${{SHELL##*/}}\" = bash ]; \
         then exec \"$SHELL\" --rcfile \"{RC_IN_LAUNCHER}\" -i; \
         {agent_rc}else exec \"${{SHELL:-/bin/sh}}\" -l; fi"
    )
}

/// sshd 가 `<로그인 셸> -c` 로 돌리므로 bash·zsh·fish·csh 어디서나 같은 뜻이어야 하고, 작은따옴표를 쓰지 않는다.
const LOGIN_SHELL_PROBE: &str = "echo \"$SHELL\"";

/// 접속 경로 한가운데라 반드시 끝나야 한다 — 못 받으면 bash 가 아닌 것으로 보고 옛 경로로 간다.
const LOGIN_SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// 서버의 로그인 셸을 묻는다(PTY 없는 짧은 exec 채널). 실패·타임아웃·빈 답은 `None` = bash 가 아님이고 접속을 막지 않는다.
pub(crate) async fn probe_login_shell(handle: &Handle<SshHandler>) -> Option<String> {
    tokio::time::timeout(LOGIN_SHELL_TIMEOUT, async {
        let mut channel = handle.channel_open_session().await.ok()?;
        channel.exec(true, LOGIN_SHELL_PROBE).await.ok()?;
        let mut out = Vec::new();
        while let Some(msg) = channel.wait().await {
            match msg {
                // stderr 는 버린다 — 프로필이 뱉는 잡음이 답에 섞이면 안 된다.
                russh::ChannelMsg::Data { data } => out.extend_from_slice(&data),
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        let _ = channel.close().await;
        let text = String::from_utf8_lossy(&out).trim().to_string();
        (!text.is_empty()).then_some(text)
    })
    .await
    .ok()
    .flatten()
}

fn is_bash(login_shell: Option<&str>) -> bool {
    login_shell.is_some_and(|s| s.rsplit('/').next() == Some("bash"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteSetup {
    ExecReady,
    /// 스니펫은 심었지만 POSIX 서버가 아니다 (Windows OpenSSH 등).
    FilesOnly,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BootstrapPlan {
    Exec,
    ShellQuiet,
    ShellHeredoc,
    ShellOptOut,
}

/// 옵트아웃이 가장 세다 — 그 호스트에선 SFTP 를 시도조차 않으므로 부르는 쪽은 [`RemoteSetup::Failed`] 를 넘긴다.
pub(crate) fn bootstrap_plan(
    shell_integration: bool,
    setup: RemoteSetup,
    login_shell: Option<&str>,
) -> BootstrapPlan {
    if !shell_integration {
        return BootstrapPlan::ShellOptOut;
    }
    match setup {
        RemoteSetup::ExecReady if is_bash(login_shell) => BootstrapPlan::Exec,
        RemoteSetup::ExecReady | RemoteSetup::FilesOnly => BootstrapPlan::ShellQuiet,
        RemoteSetup::Failed => BootstrapPlan::ShellHeredoc,
    }
}

fn append_on_connect(out: &mut String, on_connect: Option<&str>) {
    if let Some(cmd) = on_connect {
        out.push_str(cmd);
        if !cmd.ends_with('\n') {
            out.push('\n');
        }
    }
}

/// 조용한 경로(파일은 [`upload_via_handle`] 이 이미 심었다). 두 명령을 `;` 로 한 줄에 붙인다 — 에코가 한 줄이고, 앞의 실패가 tmux 줄을 막지 않는다.
/// 맨 앞 개행은 MOTD 직후의 바이트가 프롬프트 줄과 섞이지 않게 한다.
pub(crate) fn build_bootstrap_quiet(on_connect: Option<&str>) -> String {
    let mut out = String::with_capacity(256);
    out.push('\n');
    out.push_str(&quiet_command_line());
    out.push('\n');
    // 사용자의 on_connect 는 언제나 마지막이다 (셸 상태를 바꿔도 훅은 이미 걸렸다)
    append_on_connect(&mut out, on_connect);
    out
}

pub(crate) fn build_bootstrap_exec(on_connect: Option<&str>) -> String {
    build_bootstrap_opt_out(on_connect)
}

/// SFTP 를 못 쓰는 서버 — 파일까지 셸에 타이핑해 심는다. 인용 heredoc 이라 스니펫을 이스케이프하지 않고, 본문에 `AYNX_EOF` 줄이 있으면 잘리므로 그것만 검사한다.
/// 사용자의 `on_connect` 는 heredoc 바깥(종료 표식 뒤)에 붙는다(테스트가 지킨다).
pub(crate) fn build_bootstrap_heredoc(on_connect: Option<&str>) -> Result<String, String> {
    if SNIPPET.lines().any(|line| line.trim_end() == HEREDOC_TAG) {
        return Err(tr!(
            ko: "셸 통합 스니펫 본문에 heredoc 종료 표식('{HEREDOC_TAG}')이 들어 있습니다",
            en: "The shell integration snippet contains the heredoc terminator ('{HEREDOC_TAG}')"
        ));
    }

    let mut out = String::with_capacity(SNIPPET.len() + 256);
    out.push('\n');
    out.push_str("mkdir -p ~/.aynx && cat > ");
    out.push_str(SNIPPET_PATH);
    out.push_str(" <<'");
    out.push_str(HEREDOC_TAG);
    out.push_str("'\n");
    out.push_str(&snippet_file());
    out.push_str(HEREDOC_TAG);
    out.push('\n');
    out.push_str(". ");
    out.push_str(SNIPPET_PATH);
    out.push('\n');
    out.push_str(TMUX_PASSTHROUGH);
    out.push('\n');
    // 사용자의 on_connect 는 언제나 마지막이다
    append_on_connect(&mut out, on_connect);
    Ok(out)
}

/// 옵트아웃 — 사용자의 `on_connect` 만, 앞 개행도 없이 보낸다(셸 통합 전 전송과 바이트가 같다).
/// 이미 심어진 `~/.aynx` 는 지우지 않는다 — 지우면 사용자가 자기 rc 에 적어 둔 source 줄까지 깨진다.
pub(crate) fn build_bootstrap_opt_out(on_connect: Option<&str>) -> String {
    let mut out = String::new();
    append_on_connect(&mut out, on_connect);
    out
}

// ---------------------------------------------------------------------------
// 부트스트랩 에코 지우기
// ---------------------------------------------------------------------------

/// 접속 직후 이만큼만 훑는다 — 그 뒤의 같은 문자열은 사용자가 친 것이라 지우면 안 된다.
const ECHO_BUDGET: usize = 8 * 1024;

/// 우리가 타이핑한 한 줄(과 신호 `export` 줄 — `crate::ssh` 의 `echo_filters`)의 에코를 첫 등장 한 번만 지우는 스트리밍 필터.
/// - 줄바꿈은 지우지 않는다 — 뒤 프롬프트가 앞 프롬프트에 붙는다. 사용자의 `on_connect` 도 지우지 않는다.
/// - 청크 경계에 걸친 부분 일치는 붙들어 두고, 못 맞추면 순서 그대로 돌려보낸다(한 바이트도 삼키지 않는다). 못 찾으면 그대로 통과한다.
/// - needle 의 `\n` 은 스트림의 `\n`·`\r`·`\r\n` 어느 쪽과도 맞는다(서버가 줄바꿈을 바꿔 에코할 수 있다).
pub(crate) struct EchoFilter {
    needle: Vec<u8>,
    held: Vec<u8>,
    scanned: usize,
    done: bool,
}

enum Hit {
    Full {
        start: usize,
        end: usize,
    },
    Partial {
        start: usize,
    },
    None,
}

enum Step {
    /// 끝까지 맞았다 — buf 에서 소비한 마지막 **다음** 위치.
    Full(usize),
    Partial,
    No,
}

/// `\r` 로 끝나면 판단을 미룬다(`Partial`) — 아니면 CRLF 가 청크 경계에 걸릴 때 `\n` 이 화면에 샌다.
fn step_at(needle: &[u8], buf: &[u8], start: usize) -> Step {
    let mut i = start;
    let mut j = 0;
    while j < needle.len() {
        if i >= buf.len() {
            return Step::Partial;
        }
        if needle[j] == b'\n' {
            match buf[i] {
                b'\r' => {
                    i += 1;
                    if i >= buf.len() {
                        return Step::Partial;
                    }
                    if buf[i] == b'\n' {
                        i += 1;
                    }
                }
                b'\n' => i += 1,
                _ => return Step::No,
            }
        } else if buf[i] == needle[j] {
            i += 1;
        } else {
            return Step::No;
        }
        j += 1;
    }
    Step::Full(i)
}

/// 부분 일치를 만나면 멈춘다 — 그보다 뒤에서 시작하는 완전 일치는 있을 수 없다(남은 바이트가 더 적다).
fn scan(needle: &[u8], buf: &[u8]) -> Hit {
    if needle.is_empty() {
        return Hit::None;
    }
    for start in 0..buf.len() {
        match step_at(needle, buf, start) {
            Step::Full(end) => return Hit::Full { start, end },
            Step::Partial => return Hit::Partial { start },
            Step::No => {}
        }
    }
    Hit::None
}

impl EchoFilter {
    /// 시험 전용 — 펌프는 지울 줄이 없으면 필터를 아예 두지 않는다.
    #[cfg(test)]
    pub(crate) fn passthrough() -> Self {
        EchoFilter {
            needle: Vec::new(),
            held: Vec::new(),
            scanned: 0,
            done: true,
        }
    }

    pub(crate) fn for_line(line: &str) -> Self {
        EchoFilter {
            needle: line.as_bytes().to_vec(),
            held: Vec::new(),
            scanned: 0,
            done: line.is_empty(),
        }
    }

    pub(crate) fn is_done(&self) -> bool {
        self.done && self.held.is_empty()
    }

    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.done {
            return chunk.to_vec();
        }

        let room = ECHO_BUDGET.saturating_sub(self.scanned);
        let take = room.min(chunk.len());
        let (head, tail) = chunk.split_at(take);
        self.scanned += take;

        let mut buf = std::mem::take(&mut self.held);
        buf.extend_from_slice(head);

        let mut out = match scan(&self.needle, &buf) {
            Hit::Full { start, end } => {
                self.done = true;
                let mut out = Vec::with_capacity(buf.len() - (end - start) + tail.len());
                out.extend_from_slice(&buf[..start]);
                out.extend_from_slice(&buf[end..]);
                out
            }
            Hit::Partial { start } => {
                self.held = buf[start..].to_vec();
                buf.truncate(start);
                buf
            }
            Hit::None => buf,
        };

        if self.scanned >= ECHO_BUDGET {
            self.done = true;
            out.append(&mut self.held);
        }
        out.extend_from_slice(tail);
        out
    }
}

// ---------------------------------------------------------------------------
// 조용한 심기
// ---------------------------------------------------------------------------

/// 셸이 서기 전에 SFTP 로 스니펫 · (POSIX 면) rc 를 심는다 — 뒤늦으면 첫 프롬프트가 훅 없이 그려진다. `Ok(true)` = exec 런처를 쓸 수 있다.
/// 세션 맵 등록 전이라 [`crate::sftp`] 캐시를 못 쓴다 — 채널을 직접 열고 바로 닫는다. 실패해도 접속을 막지 않는다(부르는 쪽이 heredoc 으로 물러난다).
pub(crate) async fn upload_via_handle(handle: &Handle<SshHandler>) -> Result<bool, String> {
    let sftp = crate::sftp::open_sftp_on(handle).await?;
    let result = prepare_remote(&sftp).await;
    let _ = sftp.close().await;
    result
}

async fn prepare_remote(sftp: &SftpSession) -> Result<bool, String> {
    put_file(sftp, REMOTE_PATH, snippet_file().as_bytes()).await?;
    let posix = sftp.metadata(POSIX_PROBE).await.is_ok();
    if posix {
        put_file(sftp, REMOTE_RC_PATH, remote_rc_body().as_bytes()).await?;
    }
    Ok(posix)
}

/// 내용이 이미 같으면 쓰지 않는다(mtime 이 "언제 바뀌었나" 를 말한다). 읽기 실패는 없는 것으로 친다.
async fn put_file(sftp: &SftpSession, path: &str, content: &[u8]) -> Result<(), String> {
    if sftp
        .read(path)
        .await
        .is_ok_and(|existing| existing == content)
    {
        return Ok(());
    }
    // 이미 있으면 실패한다 — 판정은 다음 쓰기가 한다.
    let _ = sftp.create_dir(REMOTE_DIR).await;
    crate::sftp::save_remote(None, sftp, path, content)
        .await
        .map_err(|e| {
            tr!(
                ko: "셸 통합 파일({path})을 올리지 못했습니다: {e}",
                en: "Could not upload the shell integration file ({path}): {e}"
            )
        })
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — PowerShell 프롬프트 훅
// ---------------------------------------------------------------------------

pub(crate) const PS_SCRIPT_NAME: &str = "integration.ps1";

/// 로컬 PowerShell 훅 — `prompt` 반환 문자열을 `[D;<코드>;aynx=1] A;aynx=1 <사용자 prompt> OSC 7 B;aynx=1` 로 조립한다.
///
/// - PowerShell 은 `Set-Location` 으로 프로세스 cwd 를 안 바꿔 PEB 읽기([`crate::cwd::child_cwd`])가 틀린다 — 셸이 말해 주는 OSC 7 만 정확하다.
/// - OSC 는 `Write-Host` 가 아니라 반환 문자열 안에 둔다 — 그래야 PSReadLine 이 프롬프트를 다시 그릴 때 함께 나간다.
/// - 사용자 `prompt` 를 감싼다 — `Test-Path` 가드로 두 번 읽어도 자기 자신을 감싸지 않는다.
/// - OSC 7 은 FileSystem 공급자일 때만 · 구분자는 슬래시 — 프런트에서 백슬래시로 고치지 않는다(원격 POSIX 경로가 망가진다). `-replace '\\'` 가 아니라 `String.Replace`(잘못된 패턴으로 죽는다).
/// - 본문은 ASCII 만 — Windows PowerShell 5.1 은 BOM 없는 파일을 ANSI 코드 페이지로 읽는다.
/// - `C` 는 PSReadLine Enter 핸들러가 `AcceptLine()` 뒤에 낸다(커서가 출력 첫 줄에 있다). 파스 오류 · 빈 입력은 거른다.
/// - `$?` 는 대입 한 줄에 사라진다 — `prompt` 의 첫 문장이 `__aynx_code`, 그 첫 문장이 `$?` 읽기여야 한다. 실패 코드는 `$Error[0]` 가 지금 히스토리 항목이면 1, 아니면 `$LASTEXITCODE`.
/// - `D` 는 `$__aynx_ran` 또는 히스토리 id 가 바뀌었을 때만 — PSReadLine 이 없는 세션은 `C` 없이 `A`/`B`/`D` 만 온다.
/// - 첫 줄의 `(v6)` 가 버전이지만 다시 쓸지는 내용 비교가 정한다([`ensure_ps_script`]).
const PS_SNIPPET: &str = r#"# aynx shell integration (v6) - generated; do not edit
if ($env:VSCODE_SHELL_INTEGRATION -or $env:ITERM_SHELL_INTEGRATION_INSTALLED) { return }
if (-not (Test-Path Function:\global:__aynx_prompt_orig)) {
  $__f = Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue
  if ($__f) { Set-Item Function:\global:__aynx_prompt_orig -Value $__f.ScriptBlock }
  else { Set-Item Function:\global:__aynx_prompt_orig -Value { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " } }
  $global:__aynx_ran = $false
  $global:__aynx_hist = 0
  $__h0 = Get-History -Count 1
  if ($__h0) { $global:__aynx_hist = $__h0.Id }
  function global:__aynx_code {
    $__ok = $?
    $__gle = $global:LASTEXITCODE
    if ($__ok) { return 0 }
    $__he = Get-History -Count 1
    $__hid = 0
    if ($__he) { $__hid = $__he.Id }
    if ($Error.Count -gt 0 -and ($__hid -eq 0 -or $Error[0].InvocationInfo.HistoryId -eq $__hid)) { return 1 }
    if ($null -ne $__gle -and $__gle -ne 0) { return $__gle }
    return 1
  }
  function global:prompt {
    $__c = __aynx_code
    $__esc = [char]27
    $__bel = [char]7
    $__h = Get-History -Count 1
    $__id = 0
    if ($__h) { $__id = $__h.Id }
    $__ran = $global:__aynx_ran -or ($__id -ne $global:__aynx_hist)
    $global:__aynx_hist = $__id
    $global:__aynx_ran = $false
    $__d = ''
    if ($__ran) { $__d = "$__esc]133;D;$__c;aynx=1$__bel" }
    $__r = & $function:__aynx_prompt_orig
    $__loc = $executionContext.SessionState.Path.CurrentLocation
    $__w = ''
    if ($__loc.Provider.Name -eq 'FileSystem') {
      $__p = $__loc.ProviderPath.Replace('\', '/')
      $__w = "$__esc]7;file://localhost/$__p$__bel"
    }
    "$__d$__esc]133;A;aynx=1$__bel$__r$__w$__esc]133;B;aynx=1$__bel"
  }
  if (Get-Module PSReadLine) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
      $__a = $null; $__t = $null; $__pe = $null; $__cur = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$__a, [ref]$__t, [ref]$__pe, [ref]$__cur)
      $__txt = ''
      if ($null -ne $__a) { $__txt = $__a.Extent.Text }
      $__go = ($__txt.Trim().Length -gt 0) -and (($null -eq $__pe) -or ($__pe.Count -eq 0))
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
      if ($__go) {
        $global:__aynx_ran = $true
        [Console]::Write("$([char]27)]133;C;aynx=1$([char]7)")
      }
    }
  }
}"#;

/// 손으로 친 `claude` · `codex` 를 앱이 띄운 것과 같게 하는 PowerShell 감싸개(`crate::agent_tile`).
/// - aynx 타일 안에서만 선다(`AYNX_STREAM` + `AYNX_TILE_AGENT` 또는 `AYNX_CODEX_NO_DAEMON=1` · `claude` 는 장식 파일 경로가 있을 때만) · 사용자가 세운 같은 이름 함수는 건드리지 않는다.
/// - 장식 파일은 `AYNX_ARGS_<에이전트>=` 줄만 읽는다(소스 · `Invoke-Expression` 없음) · `\x1f` 로 나눈다. 자리 · `--no-daemon` 규칙은 `crate::agent_args` 의 `place` · [`crate::codex_launch`] 와 같다.
/// - PowerShell 은 함수 호출에서 `--` 를 먹는다 — `codex -- …` 는 감싸개를 거치면 그 토막이 빠진다.
/// - 본문은 ASCII 만([`PS_SNIPPET`] 과 같다).
const PS_AGENT_WRAPPER: &str = r#"if ($env:AYNX_STREAM -and ($env:AYNX_TILE_AGENT -or $env:AYNX_CODEX_NO_DAEMON -eq '1')) {
  function global:__aynx_agent([string]$__n, [object[]]$__a) {
    $__x = Get-Command $__n -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $__x) { Write-Error "${__n}: command not found"; return }
    $__a = @($__a)
    $__w = @()
    $__f = $env:AYNX_TILE_AGENT
    if ($__f -and [IO.File]::Exists($__f)) {
      $__k = 'AYNX_ARGS_' + $__n.ToUpperInvariant() + '='
      foreach ($__l in [IO.File]::ReadAllLines($__f)) {
        if ($__l.StartsWith($__k, [StringComparison]::Ordinal) -and $__l.Length -gt $__k.Length) { $__w = @($__l.Substring($__k.Length).Split([char]31)) }
      }
    }
    if ($__n -eq 'claude') { $__b = $__a + $__w }
    else {
      $__nd = $env:AYNX_CODEX_NO_DAEMON -eq '1' -and @(($__a + $__w) | Where-Object { "$_" -eq '--no-daemon' -or "$_" -eq '--remote' -or "$_" -like '--remote=*' }).Count -eq 0
      $__i = 0
      if ($__a.Count -gt 0 -and ("$($__a[0])" -eq 'resume' -or "$($__a[0])" -eq 'fork')) { $__i = 1 }
      while ($__i -lt $__a.Count -and "$($__a[$__i])" -eq '--no-daemon') { $__i++ }
      $__m = @()
      if ($__nd) { $__m = @('--no-daemon') }
      $__b = @($__a | Select-Object -First $__i) + $__m + $__w + @($__a | Select-Object -Skip $__i)
    }
    & $__x @__b
  }
  if ($env:AYNX_TILE_AGENT -and -not (Test-Path Function:\global:claude)) { function global:claude { __aynx_agent 'claude' $args } }
  if (-not (Test-Path Function:\global:codex)) { function global:codex { __aynx_agent 'codex' $args } }
}"#;

fn ps_snippet_file() -> String {
    let mut out = String::with_capacity(PS_SNIPPET.len() + PS_AGENT_WRAPPER.len() + 2);
    out.push_str(PS_SNIPPET);
    out.push('\n');
    out.push_str(PS_AGENT_WRAPPER);
    out.push('\n');
    out
}

fn ps_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// `-NoExit` 은 붙이는 쪽(`crate::pty::shell_command`)이 넣는다 — 없으면 스크립트만 읽고 셸이 끝난다.
pub(crate) fn ps_dot_source(path: &str) -> String {
    format!(". {}", ps_single_quote(path))
}

/// 실패는 `None` 이고 세션 생성을 막지 않는다. 디스크를 만지므로 블로킹 문맥에서만 부른다(`spawn_shell` 은 이미 `spawn_blocking` 안이다).
pub(crate) fn ensure_ps_script() -> Option<PathBuf> {
    let dir = crate::instance::config_root()?;
    write_if_changed(&dir, PS_SCRIPT_NAME, &ps_snippet_file())
}

/// 같은 바이트면 다시 쓰지 않는다 — 판정은 버전 문자열이 아니라 내용이다. 바이트 그대로 쓴다 — `.sh`·`.rc` 에 CR 이 섞이면 bash 가 죽는다.
fn write_if_changed(dir: &Path, name: &str, want: &str) -> Option<PathBuf> {
    let path = dir.join(name);
    if std::fs::read_to_string(&path).is_ok_and(|have| have == want) {
        return Some(path);
    }
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!(
            "[aynx] 로컬 셸 통합 폴더를 만들지 못했습니다 — 훅 없이 엽니다 ({}): {e}",
            dir.display()
        );
        return None;
    }
    match std::fs::write(&path, want.as_bytes()) {
        Ok(()) => Some(path),
        Err(e) => {
            eprintln!(
                "[aynx] 로컬 셸 통합 스크립트를 쓰지 못했습니다 — 훅 없이 엽니다 ({}): {e}",
                path.display()
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — WSL(bash)
// ---------------------------------------------------------------------------

pub(crate) const SH_SCRIPT_NAME: &str = "integration.sh";

/// 사용자의 `~/.bashrc` 뒤에 스니펫을 읽어 주는 rc.
pub(crate) const WSL_RC_NAME: &str = "integration-wsl.rc";

fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// UNC 등 드라이브 문자가 아니면 `None` — 대응하는 `/mnt` 경로가 없어 주입을 통째로 건너뛴다.
fn windows_to_wsl_path(win: &str) -> Option<String> {
    drive_path(win, "/mnt/")
}

fn windows_to_msys_path(win: &str) -> Option<String> {
    drive_path(win, "/")
}

/// 드라이브 문자는 소문자(`/mnt/C` · `/C` 는 없다) · 꼬리 슬래시는 뗀다.
fn drive_path(win: &str, prefix: &str) -> Option<String> {
    let bytes = win.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }
    let rest = &win[2..];
    if !rest.is_empty() && !rest.starts_with(['\\', '/']) {
        return None; // `C:relative` — 드라이브 상대 경로는 우리 것이 아니다
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    let tail = rest.replace('\\', "/");
    Some(format!("{prefix}{drive}{}", tail.trim_end_matches('/')))
}

/// `--rcfile` bash 는 그 파일만 읽으므로 `~/.bashrc` 를 먼저 읽고 스니펫을 뒤에 얹는다 — 사용자의 `PROMPT_COMMAND` 를 감싸야 한다.
/// 여기서 뜨는 것은 로그인 셸이 아니라 대화형 셸이라 프로필은 읽지 않는다.
fn wsl_rc_body(dir_in_wsl: &str) -> String {
    format!(
        "# aynx shell integration for WSL (v1) - generated; do not edit\n\
         [ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\
         . {}\n",
        sh_single_quote(&format!("{dir_in_wsl}/{SH_SCRIPT_NAME}"))
    )
}

/// bash 일 때만 훅이 붙는다(zsh 는 `--rcfile` 이 없고 fish 는 문법이 다르다 — 평소 셸로 뜰 뿐이다). `--cd` 는 붙이지 않는다.
/// `${SHELL:-/bin/sh}` 기본값이 있어야 한다 — `docker-desktop` 같은 배포판은 `$SHELL` 이 비어 셸이 아예 안 뜬다.
pub(crate) fn wsl_launch_script(rc_in_wsl: &str) -> String {
    format!(
        "if [ \"${{SHELL##*/}}\" = bash ]; then exec bash --rcfile {} -i; else exec \"${{SHELL:-/bin/sh}}\" -l; fi",
        sh_single_quote(rc_in_wsl)
    )
}

/// 하나라도 못 쓰면 `None` — 부르는 쪽이 훅 없이 띄운다. 블로킹 문맥에서만 부른다.
pub(crate) fn ensure_wsl_scripts() -> Option<String> {
    let dir = crate::instance::config_root()?;
    let dir_in_wsl = windows_to_wsl_path(&dir.to_string_lossy())?;
    write_if_changed(&dir, SH_SCRIPT_NAME, &snippet_file())?;
    write_if_changed(&dir, WSL_RC_NAME, &wsl_rc_body(&dir_in_wsl))?;
    Some(format!("{dir_in_wsl}/{WSL_RC_NAME}"))
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — Git Bash
// ---------------------------------------------------------------------------

pub(crate) const GITBASH_RC_NAME: &str = "integration-gitbash.rc";

/// `--rcfile` 은 non-login 셸에서만 보므로 `--login` 을 떼야 하고, 그러면 `/etc/profile` 의 `PATH`·`MSYSTEM` 이 빈다 — 뒤에 [`PROFILE_CHAIN`] 이 붙는다.
const GITBASH_RC_HEAD: &str = "# aynx shell integration for Git Bash (v5) - generated; do not edit\n\
                               # --rcfile 로 뜨는 bash 는 로그인 셸이 아니다 - 로그인 순서를 여기서 대신 읽는다.\n";

/// `__aynx_cwd` 를 Git Bash 용으로 갈아 끼운다 — MSYS `$PWD`(`/c/Users/x`)는 윈도우가 못 여니 `/c:/Users/x` 로 되돌린다(드라이브가 아닌 `/tmp` 는 그대로).
/// `cygpath` 는 부르지 않는다 — 프롬프트마다 프로세스가 뜬다.
const GITBASH_RC_TAIL: &str = "__aynx_cwd(){ local p=$PWD; case $p in /[A-Za-z]/*|/[A-Za-z]) p=\"/${p:1:1}:${p:2}\";; esac; if [ -n \"$TMUX\" ]; then printf '\\033Ptmux;\\033\\033]7;file://localhost%s\\007\\033\\\\' \"$p\"; else printf '\\033]7;file://localhost%s\\007' \"$p\"; fi; }\n";

/// Git Bash rc 끝의 bash 감싸개 — [`PS_AGENT_WRAPPER`] 와 같은 규칙(조건 · 사용자 함수 존중 · `AYNX_ARGS_<에이전트>=` 줄만 읽고 소스 · `eval` 없음 · 자리 · `--no-daemon`).
/// `function codex { … }` 꼴로 쓴다 — `codex(){` 꼴은 사용자의 `alias codex=…` 가 정의 줄에서 먼저 풀려 깨진다. `!` 를 쓰지 않는다([`SNIPPET`] 과 같다).
/// WSL 에는 걸지 않는다 — 윈도우 쪽 `AYNX_*` 가 배포판 안으로 건너가지 않는다(WSLENV 를 쓰지 않는다).
/// 원격 서버의 codex 가 `--no-daemon` 을 모르는 옛 판이면 그 실행이 인자 오류로 멎는다(설정 `[ai] codex_no_daemon` 을 끄면 표식이 빠진다).
const GITBASH_AGENT_WRAPPER: &str = r#"function __aynx_agent {
  local __n=$1 __k=AYNX_ARGS_CODEX= __l __v= __nd= __h=() __w=()
  shift
  [ "$__n" = claude ] && __k=AYNX_ARGS_CLAUDE=
  if [ -n "$AYNX_TILE_AGENT" ] && [ -r "$AYNX_TILE_AGENT" ]; then
    while IFS= read -r __l || [ -n "$__l" ]; do
      case $__l in "$__k"?*) __v=${__l#"$__k"} ;; esac
    done < "$AYNX_TILE_AGENT"
    [ -n "$__v" ] && IFS=$'\037' read -r -a __w <<< "$__v"
  fi
  if [ "$__n" = claude ]; then
    command claude "$@" "${__w[@]}"
    return
  fi
  [ "$AYNX_CODEX_NO_DAEMON" = 1 ] && __nd=1
  for __l in "$@" "${__w[@]}"; do
    case $__l in --no-daemon|--remote|--remote=*) __nd= ;; esac
  done
  case $1 in resume|fork) __h=("$1"); shift ;; esac
  while [ "$#" -gt 0 ] && [ "$1" = --no-daemon ]; do __h+=("$1"); shift; done
  [ -n "$__nd" ] && __h+=(--no-daemon)
  command codex "${__h[@]}" "${__w[@]}" "$@"
}
__aynx_agent_wrap(){
  [ -n "$AYNX_STREAM" ] || return 0
  if [ -n "$AYNX_TILE_AGENT" ]; then
    declare -F claude >/dev/null 2>&1 || function claude { __aynx_agent claude "$@"; }
  fi
  if [ -n "$AYNX_TILE_AGENT" ] || [ "$AYNX_CODEX_NO_DAEMON" = 1 ]; then
    declare -F codex >/dev/null 2>&1 || function codex { __aynx_agent codex "$@"; }
  fi
}
__aynx_agent_wrap; unset -f __aynx_agent_wrap
"#;

/// 순서가 계약이다: 프로필 → 스니펫 → `__aynx_cwd` 덮어쓰기(스니펫이 그 함수를 정의한 뒤여야 한다). LF 만.
fn gitbash_rc_body(dir_in_msys: &str) -> String {
    let snippet = sh_single_quote(&format!("{dir_in_msys}/{SH_SCRIPT_NAME}"));
    let mut out = String::with_capacity(768);
    out.push_str(GITBASH_RC_HEAD);
    out.push_str(PROFILE_CHAIN);
    out.push_str("[ -f ");
    out.push_str(&snippet);
    out.push_str(" ] && . ");
    out.push_str(&snippet);
    out.push('\n');
    out.push_str(GITBASH_RC_TAIL);
    out.push_str(GITBASH_AGENT_WRAPPER);
    out
}

/// 하나라도 못 쓰면 `None` — 부르는 쪽이 옛 argv(`bash.exe --login -i`)로 띄운다. 블로킹 문맥에서만 부른다.
pub(crate) fn ensure_gitbash_scripts() -> Option<String> {
    let dir = crate::instance::config_root()?;
    let dir_in_msys = windows_to_msys_path(&dir.to_string_lossy())?;
    write_if_changed(&dir, SH_SCRIPT_NAME, &snippet_file())?;
    write_if_changed(&dir, GITBASH_RC_NAME, &gitbash_rc_body(&dir_in_msys))?;
    Some(format!("{dir_in_msys}/{GITBASH_RC_NAME}"))
}

#[cfg(test)]
mod tests;
