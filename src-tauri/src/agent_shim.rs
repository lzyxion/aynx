//! 원격 PATH 심 — 손으로 친 `claude` · `codex` 도 앱이 띄운 것과 같은 인자로 돌게 하는 sh 스크립트.
//! 자리는 `crate::agent_args` 의 `place`, `--no-daemon` 은 `crate::codex_launch` 와 같은 규칙이다 — 셸 통합의 `codex` 감싸개가 먼저 붙였어도 둘이 되지 않는다.
//! 타일 파일은 필요한 키만 읽는다(소스하지 않는다 · `eval` 없음). zsh · fish 는 `-l` 그대로라 사용자 rc 가 심을 가릴 수 있다(알려진 한계).

use crate::i18n::tr;

/// 심을 까는 에이전트 — `crate::agent_args::TARGETS` 의 id 와 같다.
pub(crate) const AGENTS: [&str; 2] = ["claude", "codex"];

const DIR: &str = "~/.config/aynx/bin";
/// 첫 입력 `export` 에 더하는 PATH 머리 — 큰따옴표 안이라 서버 셸이 `$HOME` · `$PATH` 를 편다.
pub(crate) const PATH_EXPORT: &str = r#"PATH="$HOME/.config/aynx/bin:$PATH""#;

/// 심 판 번호 — 글자를 바꾸면 올린다.
pub(crate) const SHIM_VERSION: u32 = 1;

/// `__AYNX_AGENT__` 자리에 에이전트 id 가 들어간다. POSIX sh(dash · bash)만 쓴다.
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

/// 사용자 rc 가 `PATH` 앞에 폴더를 얹어 심을 가리지 않게, `--rcfile` 로 뜨는 우리 bash rc 가 프로필을 읽은 뒤 심 폴더를 다시 맨 앞에 세운다.
/// 머리는 rc 시작 때 `PATH` 에 심 폴더가 있었는가(= 앱이 이 타일에 export 했다)를 적는다 — 토글을 꺼도 심 파일은 남으므로 파일 유무로 가르지 않는다.
pub(crate) const RC_SHIM_MARK: &str =
    "case \":$PATH:\" in *\":$HOME/.config/aynx/bin:\"*) __aynx_shim=1 ;; *) __aynx_shim= ;; esac\n";

/// [`RC_SHIM_MARK`] 의 짝 — 사용자 프로필을 읽은 뒤에 둔다.
pub(crate) const RC_SHIM_FRONT: &str = "if [ -n \"$__aynx_shim\" ]; then\n\
     \x20 __aynx_p=:$PATH:\n\
     \x20 while case $__aynx_p in *\":$HOME/.config/aynx/bin:\"*) true ;; *) false ;; esac; do\n\
     \x20   __aynx_p=${__aynx_p%%\":$HOME/.config/aynx/bin:\"*}:${__aynx_p#*\":$HOME/.config/aynx/bin:\"}\n\
     \x20 done\n\
     \x20 __aynx_p=${__aynx_p#:}; __aynx_p=${__aynx_p%:}\n\
     \x20 PATH=$HOME/.config/aynx/bin${__aynx_p:+:$__aynx_p}\n\
     fi\n\
     unset __aynx_shim __aynx_p\n";

/// 에이전트 rc — 셸 통합 rc 가 없는 tmux 세션의 bash 가 `--rcfile` 로 읽는다. 세션 명령 안이라 작은따옴표를 쓸 수 없다.
pub(crate) const AGENT_RC_PATH: &str = "$HOME/.config/aynx/agent-rc";

/// 에이전트 rc 판 번호 — 글자를 바꾸면 올린다.
const AGENT_RC_VERSION: u32 = 1;

fn agent_rc_version_line() -> String {
    format!("# aynx-agent-rc-version: {AGENT_RC_VERSION}")
}

/// 줄바꿈은 LF 하나.
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

fn version_line() -> String {
    format!("# aynx-shim-version: {SHIM_VERSION}")
}

pub(crate) fn shim_body(agent: &str) -> String {
    SHIM_TEMPLATE.replace("__AYNX_AGENT__", agent)
}

fn shim_path_sh(agent: &str) -> String {
    crate::ssh::sh_path(&format!("{DIR}/{agent}"))
}

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
    cmd.push_str(&format!(
        " && {{ f={path}; if [ -f \"$f\" ] && [ \"$(sed -n 2p \"$f\" 2>/dev/null)\" = {marker} ]; then :; \
         else printf '%s' {body} > \"$f.aynx-tmp\" && chmod 644 \"$f.aynx-tmp\" && mv -f \"$f.aynx-tmp\" \"$f\"; fi; }}",
        path = crate::ssh::sh_path("~/.config/aynx/agent-rc"),
        marker = crate::ssh::sh_quote(&agent_rc_version_line()),
        body = crate::ssh::sh_quote(&agent_rc_body()),
    ));
    cmd
}

pub(crate) fn remove_command(agent: &str) -> String {
    format!("rm -f {}", shim_path_sh(agent))
}

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
