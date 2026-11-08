//! **원격 PATH 심** — 손으로 친 `claude` · `codex` 도 앱이 띄운 것과 같은 인자로 돌게 하는 작은 sh 스크립트
//! (2026-10-26 에이전트 활성화 — 호스트 옵션 `crate::sessions_meta::HostMeta::agent`).
//!
//! 서버의 `~/.config/aynx/bin/claude` · `~/.config/aynx/bin/codex`(0755)에 깔리고, 에이전트 활성화가 켜진 타일은 첫 입력의
//! `export` 에 `PATH="$HOME/.config/aynx/bin:$PATH"` 를 더한다(`crate::ssh::signal_exports`). 앱이 띄우는 원격 명령도 이 심을
//! 지난다 — 추가 인자 · `--no-daemon` 규칙이 한 곳이다.
//!
//! ## 심이 하는 일 ([`SHIM_TEMPLATE`])
//!
//! 1. 진짜 실행 파일 = `PATH` 에서 **자기 폴더를 뺀** 첫 실행 파일(폴더는 `pwd -P` 로 견준다). 없으면 `command not found` 와 127.
//! 2. `AYNX_STREAM` 이 없거나(앱 밖 접속) 그 스트림의 **타일 파일**(`~/.config/aynx/signal/<스트림>.env` —
//!    `crate::remote_signal_file`)이 없으면 인자 그대로 `exec`.
//! 3. 타일 파일에서 필요한 키만 읽는다(소스하지 않는다 · `eval` 없음 — 훅 스크립트와 같은 "키만 읽기"):
//!    `AYNX_ARGS_<에이전트>`(낱말을 `\x1f` 로 이은 값 — `crate::agent_args::parse_args` 를 지난 낱말이라 제어 문자가 없다) ·
//!    `AYNX_NO_DAEMON=1`(Codex). `set -f` + `IFS=\x1f` 로 나눈다.
//! 4. 자리는 `crate::agent_args` 의 `place` 와 같다 — Claude 는 줄 끝, Codex 는 실행 파일 바로 뒤 · `resume`/`fork` 면 그 뒤
//!    (그 자리의 `--no-daemon` 은 건너뛴다). `--no-daemon` 은 `crate::codex_launch` 와 같은 규칙으로 하위명령 바로 뒤에 —
//!    `--no-daemon` · `--remote` · `--remote=…` 가 이미 있으면(추가 인자 포함) 끼우지 않는다. 셸 통합의 `codex` 감싸개가
//!    먼저 붙였어도 둘이 되지 않는다.
//!
//! ## 설치
//!
//! 접속할 때 훅 자동 설치와 나란히 **exec 한 번**([`install_command`]) — 둘째 줄의 판 표식이 같고 실행 가능하면 쓰지 않는다
//! (멱등). 쓸 때는 옆 임시 파일 → `chmod 755` → `mv -f`. 같은 명령이 **에이전트 rc**(`~/.config/aynx/agent-rc` —
//! [`agent_rc_body`])도 같은 방식으로 깐다.
//!
//! ## 사용자 rc 가 심을 가리지 않게 ([`RC_SHIM_MARK`] · [`RC_SHIM_FRONT`])
//!
//! export 가 셸이 뜨기 전에 서는 길(tmux 세션 명령)에서는 사용자 프로필 · bashrc 의 `PATH="$HOME/.local/bin:$PATH"` 가 심을
//! 가린다. 그래서 `--rcfile` 로 뜨는 우리 bash rc 둘(셸 통합 `~/.aynx/rc` · 에이전트 rc)이 프로필을 읽은 뒤 심 폴더를 다시
//! 맨 앞에 세운다 — rc 가 시작할 때 `PATH` 에 그 폴더가 있었을 때만(= 앱이 이 타일에 export 했다). 셸 통합 rc 가 없는 tmux
//! 세션의 bash 는 에이전트 rc 로 뜬다(`crate::shell_integration::tmux_session_shell`). zsh · fish 는 `-l` 그대로(알려진 한계). 지우기는 프로젝트 메뉴의 "원격 훅 제거" 가 그 에이전트의 심도 함께
//! 지운다(`crate::agent_hooks` 의 원격 제거 명령 · [`remove_command`]).

use crate::i18n::tr;

/// 심을 까는 에이전트 — `crate::agent_args::TARGETS` 의 id 와 같다.
pub(crate) const AGENTS: [&str; 2] = ["claude", "codex"];

/// 서버의 심 폴더 — 화면·`sh_path` 용(`~` 는 [`crate::ssh::sh_path`] 가 `"$HOME"` 으로 편다).
const DIR: &str = "~/.config/aynx/bin";
/// 첫 입력 `export` 에 더하는 PATH 머리 — 큰따옴표 안이라 서버 셸이 `$HOME` · `$PATH` 를 편다.
pub(crate) const PATH_EXPORT: &str = r#"PATH="$HOME/.config/aynx/bin:$PATH""#;

/// 심 판 번호 — 글자를 바꾸면 올린다. 판정은 둘째 줄([`version_line`])의 비교다.
pub(crate) const SHIM_VERSION: u32 = 1;

/// 심 본문. `__AYNX_AGENT__` 자리에 에이전트 id 가 들어간다([`shim_body`]). POSIX sh(dash · bash)만 쓴다.
const SHIM_TEMPLATE: &str = r#"#!/bin/sh
# aynx-shim-version: 1
# aynx PATH shim for __AYNX_AGENT__ - written by aynx (host > agent). Removing the agent hooks removes it.
# Runs the real __AYNX_AGENT__ found later in PATH. Inside an aynx tile it adds the extra arguments the
# host set (read, never sourced, from $HOME/.config/aynx/signal/$AYNX_STREAM.env); elsewhere it passes through.
name=__AYNX_AGENT__
own=$(CDPATH= cd -- "${0%/*}" 2>/dev/null && pwd -P)
[ -n "$own" ] || own=$(CDPATH= cd -- "$HOME/.config/aynx/bin" 2>/dev/null && pwd -P)
set -f
oifs=$IFS
IFS=:
real=
for d in $PATH; do
  [ -n "$d" ] || d=.
  if [ -f "$d/$name" ] && [ -x "$d/$name" ]; then
    [ "$(CDPATH= cd -- "$d" 2>/dev/null && pwd -P)" = "$own" ] && continue
    real=$d/$name
    break
  fi
done
IFS=$oifs
if [ -z "$real" ]; then
  echo "$name: command not found" >&2
  exit 127
fi
f=
case $AYNX_STREAM in
  ''|*[!0-9A-Za-z._:-]*) ;;
  *) f=$HOME/.config/aynx/signal/$AYNX_STREAM.env ;;
esac
[ -n "$f" ] && [ -r "$f" ] || exec "$real" "$@"
key=AYNX_ARGS_CLAUDE
[ "$name" = codex ] && key=AYNX_ARGS_CODEX
extra=
nd=
while IFS= read -r line || [ -n "$line" ]; do
  case $line in
    "$key"=*) extra=${line#*=} ;;
    AYNX_NO_DAEMON=*) nd=${line#*=} ;;
  esac
done < "$f"
us=$(printf '\037')
if [ "$name" != codex ]; then
  IFS=$us
  set -- "$@" $extra
  IFS=$oifs
  exec "$real" "$@"
fi
if [ "$nd" = 1 ]; then
  IFS=$us
  for a in "$@" $extra; do
    case $a in --no-daemon|--remote|--remote=*) nd= ;; esac
  done
  IFS=$oifs
fi
n=$#
k=0
put=
while [ "$k" -lt "$n" ]; do
  a=$1
  shift
  if [ -z "$put" ]; then
    if [ "$k" -eq 0 ] && { [ "$a" = resume ] || [ "$a" = fork ]; }; then
      set -- "$@" "$a"
      k=$((k + 1))
      continue
    fi
    if [ "$a" = --no-daemon ]; then
      set -- "$@" "$a"
      k=$((k + 1))
      continue
    fi
    [ "$nd" = 1 ] && set -- "$@" --no-daemon
    IFS=$us
    set -- "$@" $extra
    IFS=$oifs
    put=1
  fi
  set -- "$@" "$a"
  k=$((k + 1))
done
if [ -z "$put" ]; then
  [ "$nd" = 1 ] && set -- "$@" --no-daemon
  IFS=$us
  set -- "$@" $extra
  IFS=$oifs
fi
exec "$real" "$@"
"#;

/// **사용자 rc 뒤에 심 폴더를 다시 맨 앞으로** — bash rc 의 머리 한 줄 + 꼬리 몇 줄(2026-10-26 실기 버그).
///
/// 앱의 `export PATH="$HOME/.config/aynx/bin:$PATH"` 는 셸이 뜨기 **전**에 서는 길이 있다(tmux 세션 명령 · 그 안의 셸).
/// 그 뒤 셸이 읽는 사용자 rc 가 `export PATH="$HOME/.local/bin:$PATH"`(Claude Code 설치기가 넣는 줄 — 진짜 `claude` 가 거기 산다)
/// 처럼 앞에 폴더를 얹으면 심이 가려진다. 그래서 `--rcfile` 로 뜨는 우리 rc(셸 통합 `~/.aynx/rc` · [`AGENT_RC_PATH`])가:
///
/// - **머리**([`RC_SHIM_MARK`]) — rc 가 시작할 때 `PATH` 에 심 폴더가 있었는가를 적는다. 있었다 = 앱이 **이 타일에** export 했다
///   (토글을 꺼도 심 파일은 남으므로 파일 유무로 가르지 않는다).
/// - **꼬리**([`RC_SHIM_FRONT`]) — 사용자 프로필을 다 읽은 뒤, 적어 둔 경우에만 `PATH` 에서 그 폴더를 모두 걷고 맨 앞에 한 번 세운다.
///
/// bash 전용 문법이 아니지만 bash rc 에만 들어간다. `eval` 없음 · `!` 없음.
pub(crate) const RC_SHIM_MARK: &str =
    "case \":$PATH:\" in *\":$HOME/.config/aynx/bin:\"*) __aynx_shim=1 ;; *) __aynx_shim= ;; esac\n";

/// [`RC_SHIM_MARK`] 의 짝 — 사용자 프로필을 읽은 **뒤**에 둔다.
pub(crate) const RC_SHIM_FRONT: &str = "if [ -n \"$__aynx_shim\" ]; then\n\
     \x20 __aynx_p=:$PATH:\n\
     \x20 while case $__aynx_p in *\":$HOME/.config/aynx/bin:\"*) true ;; *) false ;; esac; do\n\
     \x20   __aynx_p=${__aynx_p%%\":$HOME/.config/aynx/bin:\"*}:${__aynx_p#*\":$HOME/.config/aynx/bin:\"}\n\
     \x20 done\n\
     \x20 __aynx_p=${__aynx_p#:}; __aynx_p=${__aynx_p%:}\n\
     \x20 PATH=$HOME/.config/aynx/bin${__aynx_p:+:$__aynx_p}\n\
     fi\n\
     unset __aynx_shim __aynx_p\n";

/// **에이전트 rc** — 셸 통합 rc(`~/.aynx/rc`)가 없는 tmux 세션의 bash 가 `--rcfile` 로 읽는다
/// (`crate::shell_integration::tmux_session_shell` 의 에이전트 갈래). 로그인 셸(`-l`)과 같은 프로필을 같은 순서로 읽고
/// ([`crate::shell_integration::PROFILE_CHAIN`]) 그 뒤에 심 폴더를 다시 앞에 세울 뿐이다 — 훅 · 감싸개 없음.
/// 셸 화면 경로(`"$HOME/…"` — 세션 명령 안이라 작은따옴표를 쓸 수 없다).
pub(crate) const AGENT_RC_PATH: &str = "$HOME/.config/aynx/agent-rc";

/// 에이전트 rc 판 번호 — 글자를 바꾸면 올린다. 판정은 둘째 줄의 비교다(심과 같은 방식).
const AGENT_RC_VERSION: u32 = 1;

/// 에이전트 rc 의 둘째 줄 표식(**순수**).
fn agent_rc_version_line() -> String {
    format!("# aynx-agent-rc-version: {AGENT_RC_VERSION}")
}

/// 에이전트 rc 본문(**순수**) — 표식 · 머리 · 로그인 프로필 · 꼬리. 줄바꿈은 LF 하나.
pub(crate) fn agent_rc_body() -> String {
    format!(
        "# aynx agent rc - written by aynx (host > agent); read by tmux sessions without shell integration\n\
         {}\n\
         # 로그인 셸(-l)과 같은 프로필을 읽고, 그 뒤 aynx PATH 심 폴더를 다시 맨 앞에 세운다(앱이 이 타일에 export 했을 때만).\n\
         {RC_SHIM_MARK}{}{RC_SHIM_FRONT}",
        agent_rc_version_line(),
        crate::shell_integration::PROFILE_CHAIN,
    )
}

/// 둘째 줄 — 깔린 심이 이 판인가를 보는 표식(**순수**).
fn version_line() -> String {
    format!("# aynx-shim-version: {SHIM_VERSION}")
}

/// 에이전트 하나의 심 본문(**순수**).
pub(crate) fn shim_body(agent: &str) -> String {
    SHIM_TEMPLATE.replace("__AYNX_AGENT__", agent)
}

/// 서버의 그 에이전트 심 — 셸 글자(**순수**).
fn shim_path_sh(agent: &str) -> String {
    crate::ssh::sh_path(&format!("{DIR}/{agent}"))
}

/// 설치 명령(**순수**) — 에이전트마다 둘째 줄이 이 판이고 실행 가능하면 건너뛰고, 아니면 임시 파일 → 0755 → `mv -f`.
///
/// ```sh
/// mkdir -p "$HOME"/'.config/aynx/bin' \
///   && { f="$HOME"/'.config/aynx/bin/claude'; if [ -x "$f" ] && [ "$(sed -n 2p "$f" 2>/dev/null)" = '# aynx-shim-version: 1' ]; then :; \
///        else printf '%s' '<본문>' > "$f.aynx-tmp" && chmod 755 "$f.aynx-tmp" && mv -f "$f.aynx-tmp" "$f"; fi; } \
///   && { … codex … }
/// ```
pub(crate) fn install_command() -> String {
    let marker = crate::ssh::sh_quote(&version_line());
    let mut cmd = format!("mkdir -p {}", crate::ssh::sh_path(DIR));
    for agent in AGENTS {
        cmd.push_str(&format!(
            " && {{ f={path}; if [ -x \"$f\" ] && [ \"$(sed -n 2p \"$f\" 2>/dev/null)\" = {marker} ]; then :; \
             else printf '%s' {body} > \"$f.aynx-tmp\" && chmod 755 \"$f.aynx-tmp\" && mv -f \"$f.aynx-tmp\" \"$f\"; fi; }}",
            path = shim_path_sh(agent),
            body = crate::ssh::sh_quote(&shim_body(agent)),
        ));
    }
    // 에이전트 rc — 같은 판 확인 · 같은 원자 쓰기(실행 권한은 필요 없다).
    cmd.push_str(&format!(
        " && {{ f={path}; if [ -f \"$f\" ] && [ \"$(sed -n 2p \"$f\" 2>/dev/null)\" = {marker} ]; then :; \
         else printf '%s' {body} > \"$f.aynx-tmp\" && chmod 644 \"$f.aynx-tmp\" && mv -f \"$f.aynx-tmp\" \"$f\"; fi; }}",
        path = crate::ssh::sh_path("~/.config/aynx/agent-rc"),
        marker = crate::ssh::sh_quote(&agent_rc_version_line()),
        body = crate::ssh::sh_quote(&agent_rc_body()),
    ));
    cmd
}

/// 그 에이전트의 심을 지우는 명령 조각(**순수**) — 없어도 성공한다.
pub(crate) fn remove_command(agent: &str) -> String {
    format!("rm -f {}", shim_path_sh(agent))
}

/// 접속할 때의 설치 — 실패는 까닭 한 줄(부른 쪽이 로그만 남긴다 · 심이 없으면 진짜 실행 파일이 그대로 돈다).
pub(crate) async fn remote_install(handle: crate::ssh::ExecHandle) -> Result<(), String> {
    let work = crate::agent_hooks::remote_write(handle, install_command());
    tokio::time::timeout(crate::agent_hooks::REMOTE_AUTO_BUDGET, work)
        .await
        .unwrap_or_else(|_| {
            Err(tr!(
                ko: "서버가 {secs}초 안에 끝내지 못했습니다",
                en: "The server did not finish within {secs} seconds",
                secs = crate::agent_hooks::REMOTE_AUTO_BUDGET.as_secs()
            ))
        })
}

#[cfg(test)]
mod tests;
