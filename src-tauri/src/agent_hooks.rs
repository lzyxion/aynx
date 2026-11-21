//! 에이전트 CLI 훅 설치기 — 에이전트 상태 점이 추정 대신 정확한 신호를 받게 한다 (docs/log/2026-09-24-agent-hook-signals.md · Codex 는 docs/log/2026-09-26-codex-hooks.md).
//! 모든 에이전트가 같은 스크립트 하나를 쓴다. 주소 · 스트림 · 토큰 중 하나라도 비면 조용히 0 으로 끝난다 — 훅은 aynx 밖의 에이전트를 절대 깨뜨리면 안 된다.
//! 설정 파일에는 우리 항목(스크립트 이름 [`SCRIPT_STEM`] 으로 알아본다)만 더하고 뺀다 — 다른 키 · 다른 훅 · 키 순서는 그대로, 우리가 비운 배열 · 객체만 지운다.
//! 결과가 읽은 것과 같으면 파일을 쓰지 않는다 — Codex 는 훅 정의가 바뀌면 사용자의 신뢰(`/hooks`)를 다시 받아야 한다. 올바른 JSON 객체가 아니면 손대지 않고 실패한다.
//!
//! ## 우리 항목만 자동 갱신
//!
//! 이 PC 설정에 이 인스턴스의 우리 항목이 있고 지금 모양이 아니면 앱이 뜰 때 그 항목만 갈아 쓴다([`refresh_local_entries_once`]). 우리 항목이 없는 사람에게는 아무것도 더하지 않는다.
//!
//! 앱이 먼저 켜지 않는다 — 사용자가 누르고 확인 창으로 무엇을 쓸지 본 뒤에만 쓴다. 예외 하나: 원격 훅은 호스트 폼의 에이전트 활성화(`sessions.toml` `agent`)가
//! 동의이고, 그 호스트에 접속할 때 확인 창 없이 심는다([`remote_auto_install`]). 신뢰 상태(Codex `[hooks.state]`)는 쓰지 않는다 — 사용자가 그 CLI 안에서 내리는 결정이다.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::i18n::tr;

/// 우리 스크립트 파일 이름의 몸통 — **우리 항목을 알아보는 열쇠**이기도 하다.
const SCRIPT_STEM: &str = "aynx-agent-signal";

/// 스크립트의 `curl` 은 2초(`-m 2`)에서 스스로 끊는다 — 그보다 조금 넉넉히.
const HOOK_TIMEOUT_SECS: u64 = 5;

// ── 에이전트 표 — 에이전트마다 다른 것은 여기에만 있다 ──

pub(crate) struct HookEvent {
    hook: &'static str,
    matcher: Option<&'static str>,
    /// `crate::agent_signal::SignalEvent` 의 이벤트 이름 중 하나(테스트가 본다).
    event: &'static str,
    /// 스크립트의 둘째 인자로 박힌다. `None` 이고 `waiting` 이면 스크립트가 표준 입력에서 범주를 가린다(Claude `Notification`).
    detail: Option<&'static str>,
}

/// 에이전트를 더하는 자리는 이 표 한 줄이다.
pub(crate) struct HookTarget {
    /// 안정 id — 명령 인자 · 프런트의 키, `mcp.rs` 의 CLI 표와 같은 글자.
    pub id: &'static str,
    /// 제품 이름이라 번역하지 않는다.
    pub display: &'static str,
    local_settings: fn() -> Option<PathBuf>,
    /// 셸 글자 그대로(이미 인용된 식 — `$HOME` · 환경변수가 펴진다).
    remote_dir_sh: &'static str,
    remote_file: &'static str,
    remote_shown: &'static str,
    events: &'static [HookEvent],
    /// 명령 줄을 어떻게 적는가(셸을 거치나 · 인용 규칙)가 CLI 마다 달라 여기서 짓는다.
    handler: fn(script: &str, ev: &HookEvent, windows: bool) -> Value,
    pub needs_trust_note: bool,
    /// `false` 면 목록에 없고 모든 명령이 거절한다 — 신호가 틀린 타일로 갈 수 있는 동안 숨겨 두는 스위치. 지금은 모든 줄이 `true` 다.
    available: bool,
}

/// `Notification` 은 권한 물음 · 한참 입력 없음이 한 훅이라 범주를 박지 않는다(스크립트가 입력으로 가린다).
/// `SessionStart` 는 Codex 에는 걸지 않는다 — Codex 의 `SessionStart` 는 첫 사람 말이 들어갈 때 한 번 불려 `UserPromptSubmit` 보다 얻는 것이 없다.
const CLAUDE_EVENTS: &[HookEvent] = &[
    HookEvent {
        hook: "SessionStart",
        matcher: None,
        event: "session",
        detail: None,
    },
    HookEvent {
        hook: "UserPromptSubmit",
        matcher: None,
        event: "start",
        detail: None,
    },
    HookEvent {
        hook: "PreToolUse",
        matcher: Some("*"),
        event: "tool",
        detail: None,
    },
    HookEvent {
        hook: "PostToolUse",
        matcher: Some("*"),
        event: "tool-done",
        detail: None,
    },
    HookEvent {
        hook: "Notification",
        matcher: Some(""),
        event: "waiting",
        detail: None,
    },
    HookEvent {
        hook: "Stop",
        matcher: None,
        event: "stop",
        detail: None,
    },
    HookEvent {
        hook: "SubagentStart",
        matcher: None,
        event: "subagent-start",
        detail: None,
    },
    HookEvent {
        hook: "SubagentStop",
        matcher: None,
        event: "subagent-stop",
        detail: None,
    },
    HookEvent {
        hook: "SessionEnd",
        matcher: None,
        event: "session-end",
        detail: None,
    },
];

/// 확인한 이벤트만 싣는다 — 확인하지 않은 이름이 파일 전체를 깨뜨릴 수 있다. 승인 물음은 `PermissionRequest` 라 범주 `permission` 을 인자로 박는다.
const CODEX_EVENTS: &[HookEvent] = &[
    HookEvent {
        hook: "UserPromptSubmit",
        matcher: None,
        event: "start",
        detail: None,
    },
    HookEvent {
        hook: "PreToolUse",
        matcher: None,
        event: "tool",
        detail: None,
    },
    HookEvent {
        hook: "PostToolUse",
        matcher: None,
        event: "tool-done",
        detail: None,
    },
    HookEvent {
        hook: "PermissionRequest",
        matcher: None,
        event: "waiting",
        detail: Some("permission"),
    },
    HookEvent {
        hook: "Stop",
        matcher: None,
        event: "stop",
        detail: None,
    },
    HookEvent {
        hook: "SubagentStart",
        matcher: None,
        event: "subagent-start",
        detail: None,
    },
    HookEvent {
        hook: "SubagentStop",
        matcher: None,
        event: "subagent-stop",
        detail: None,
    },
    HookEvent {
        hook: "SessionEnd",
        matcher: None,
        event: "session-end",
        detail: None,
    },
];

/// Claude Code 는 훅을 셸(Git Bash 든 cmd 든)로 돌린다 — 셸을 가리지 않는 한 줄 하나.
fn claude_handler(script: &str, ev: &HookEvent, _windows: bool) -> Value {
    json!({ "type": "command", "command": hook_command(script, "claude", ev), "timeout": HOOK_TIMEOUT_SECS })
}

/// Codex(0.157)는 `commandWindows` 를 셸로 돌리지 않고 스스로 토막 내 첫 토막을 띄운다 — 첫 토막이 따옴표로 시작하면 실패하므로
/// 첫 토막을 맨 `cmd.exe` 로 두고 경로는 뒤 토막에서 인용한다.
fn codex_handler(script: &str, ev: &HookEvent, windows: bool) -> Value {
    if windows {
        let path = script.replace('/', "\\");
        let cmd = format!("cmd.exe /d /c \"{path}\" {}", hook_args("codex", ev));
        json!({ "type": "command", "command": cmd, "commandWindows": cmd, "timeout": HOOK_TIMEOUT_SECS })
    } else {
        json!({ "type": "command", "command": hook_command(script, "codex", ev), "timeout": HOOK_TIMEOUT_SECS })
    }
}

fn claude_settings_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("settings.json"))
}

fn codex_hooks_path() -> Option<PathBuf> {
    let home = match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(h) => PathBuf::from(h),
        None => dirs::home_dir()?.join(".codex"),
    };
    Some(home.join("hooks.json"))
}

/// 순서 = 설정 › AI 의 줄 순서 · 메뉴 항목 순서.
pub(crate) const TARGETS: &[HookTarget] = &[
    HookTarget {
        id: "claude",
        display: "Claude Code",
        local_settings: claude_settings_path,
        remote_dir_sh: r#""$HOME"/'.claude'"#,
        remote_file: "settings.json",
        remote_shown: "~/.claude/settings.json",
        events: CLAUDE_EVENTS,
        handler: claude_handler,
        needs_trust_note: false,
        available: true,
    },
    HookTarget {
        id: "codex",
        display: "Codex",
        local_settings: codex_hooks_path,
        remote_dir_sh: r#""${CODEX_HOME:-$HOME/.codex}""#,
        remote_file: "hooks.json",
        remote_shown: "~/.codex/hooks.json",
        events: CODEX_EVENTS,
        handler: codex_handler,
        needs_trust_note: true,
        // 공용 데몬 안에서 도는 훅은 데몬을 띄운 터미널의 환경을 받아 신호가 틀린 타일로 간다 — aynx 의 codex 는 `--no-daemon` 으로 돌아 훅이 그 타일의 환경을 받는다.
        available: true,
    },
];

/// 숨긴 줄 포함 — 명령은 [`usable_target`] 을 쓴다.
fn target(id: &str) -> Result<&'static HookTarget, String> {
    TARGETS
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"))
}

/// 숨긴 줄([`HookTarget::available`])은 거절한다 — 손으로 부른 명령에서도 설치되면 안 된다(신호가 틀린 타일로 간다).
fn usable_target(id: &str) -> Result<&'static HookTarget, String> {
    let t = target(id)?;
    if !t.available {
        return Err(tr!(
            ko: "{name} 훅은 아직 쓸 수 없습니다 — 신호가 어느 타일의 것인지 가릴 수 없어 숨겨 두었습니다",
            en: "{name} hooks are not available yet — their signals cannot be matched to a tile, so they are hidden",
            name = t.display
        ));
    }
    Ok(t)
}

// ── 공용 스크립트 ──

/// 스크립트 판 번호 — 두 스크립트의 `aynx-hook-version: N` 줄과 같아야 한다(테스트가 본다). 글자를 바꾸면 올린다.
/// 로컬 판정은 내용 비교다([`refresh_at`]). 원격 사본은 아무도 갈아 쓰지 않으므로 신호에 실린 이 수로 화면이 "다시 설치" 를 권한다.
/// 둘째 인자가 `claude` · `codex` 면 CLI 이고 범주는 셋째다 — 그 밖이면 둘째가 범주다(옛 등록 `waiting permission` 이 새 스크립트를 불러도 돈다).
/// CLI 를 환경변수 대신 인자로 넘긴다 — `VAR=x cmd` 앞붙임은 cmd 에서 안 서고, 인자 한 낱말은 Git Bash · cmd · 맨 `cmd.exe` 에서 같다.
/// 중첩(Claude 안의 Codex = `codex` + `CLAUDECODE` · Codex 셸 도구로 뜬 Claude · Codex = `CODEX_THREAD_ID`)이면 서브 에이전트 신호로 바꿔 보낸다 —
/// 타일 셸에서는 앱이 두 표지를 걷는다(`crate::pty` 의 `PARENT_AGENT_ENV`). Claude 안의 Claude 는 범위 밖이다.
pub(crate) const SCRIPT_VERSION: u32 = 13;

/// Windows 스크립트. ASCII 만 쓴다 — cmd 는 배치 파일을 OEM 코드페이지로 읽어 UTF-8 한글이 뒷줄 파싱을 깨뜨릴 수 있다. 줄바꿈은 CRLF.
/// 토큰은 `curl -K -`(표준 입력)로 넘긴다 — argv 에 싣지 않는다. 훅 입력은 지연 확장(`!VAR!`)으로만 다루고, 글자 검사를 지난 값만 `%…%` 로 나간다.
/// 입력에서는 범주 · 대화 id · 서브 에이전트 id 만 떼고 프롬프트 · 알림 문구는 싣지 않는다. `.cmd` 는 입력의 첫 줄 1023자만(`set /p`) 읽는다.
/// 모든 출력을 버린다 — `UserPromptSubmit` 훅의 표준 출력은 프롬프트 문맥에 덧붙는다. 무엇이 실패해도 `exit /b 0`.
// 다른 OS 빌드에서는 테스트만 읽는다(두 벌 다 검사한다).
#[cfg_attr(not(windows), allow(dead_code))]
const CMD_SCRIPT: &str = r#"@echo off
rem aynx agent-status hook - written by aynx (Settings > AI > agent hooks). Reinstall rewrites it.
rem aynx-hook-version: 13
rem Usage: aynx-agent-signal.cmd start / tool / tool-done / waiting / stop / subagent-start / subagent-stop / session-end / session  [claude or codex]  [detail]
rem Outside an aynx terminal the AYNX_* variables are unset and this exits 0 without doing anything.
rem Token: AYNX_SIGNAL_TOKEN (per-tile, signal only) if set, else AYNX_MCP_TOKEN (older tiles).
rem cli: the 2nd argument if it is claude or codex (then detail is the 3rd); older entries pass the detail 2nd.
rem detail: that argument if given; else for waiting, reads the hook JSON on stdin and sends only a category.
rem session: for start/stop/session-end/session, reads the first stdin line and sends only the 36-char session_id (hex and dashes).
rem session-end: not sent when the reason is clear (/clear keeps the CLI running).
rem agent: for subagent-start/stop, reads the first stdin line and sends only agent_id (A-Z a-z 0-9 _ -, max 64).
rem nested: codex with CLAUDECODE set runs inside Claude Code - start/session-end go as subagent-start/stop (agent = session_id), stop/session are not sent, no cli field.
rem nested: claude/codex with CODEX_THREAD_ID set runs inside a Codex shell tool - same conversion.
if "%AYNX_MCP_URL%"=="" exit /b 0
if "%AYNX_STREAM%"=="" exit /b 0
if defined AYNX_SIGNAL_TOKEN (set "AYNX_TOK=%AYNX_SIGNAL_TOKEN%") else (set "AYNX_TOK=%AYNX_MCP_TOKEN%")
if "%AYNX_TOK%"=="" exit /b 0
set "AYNX_SID="
set "AYNX_AID="
set "AYNX_CLI="
set "AYNX_DET=%~2"
if "%~2"=="claude" (set "AYNX_CLI=claude" & set "AYNX_DET=%~3")
if "%~2"=="codex" (set "AYNX_CLI=codex" & set "AYNX_DET=%~3")
set "AYNX_NEST="
if "%~2"=="codex" if defined CLAUDECODE set "AYNX_NEST=1"
if "%~2"=="claude" if defined CODEX_THREAD_ID set "AYNX_NEST=1"
if "%~2"=="codex" if defined CODEX_THREAD_ID set "AYNX_NEST=1"
if /i "%~1"=="start" goto session
if /i "%~1"=="stop" goto session
if /i "%~1"=="session-end" goto session
if /i "%~1"=="session" goto session
if /i "%~1"=="subagent-start" goto agent
if /i "%~1"=="subagent-stop" goto agent
if defined AYNX_DET goto send
if /i not "%~1"=="waiting" goto send
setlocal EnableDelayedExpansion
set "AYNX_DET=other"
set "AYNX_IN="
for /f "delims=" %%A in ('findstr /n "^"') do set "AYNX_IN=!AYNX_IN!%%A"
if not defined AYNX_IN goto picked
if not "!AYNX_IN:notification_type=!"=="!AYNX_IN!" (
  if not "!AYNX_IN:permission_prompt=!"=="!AYNX_IN!" (set "AYNX_DET=permission") else if not "!AYNX_IN:idle_prompt=!"=="!AYNX_IN!" set "AYNX_DET=idle"
) else (
  if not "!AYNX_IN:needs your permission=!"=="!AYNX_IN!" (set "AYNX_DET=permission") else if not "!AYNX_IN:waiting for your input=!"=="!AYNX_IN!" set "AYNX_DET=idle"
)
:picked
endlocal & set "AYNX_DET=%AYNX_DET%"
goto send
:session
setlocal EnableDelayedExpansion
set "AYNX_IN="
set /p AYNX_IN=
if not defined AYNX_IN goto nosid
set AYNX_R=!AYNX_IN:"reason":"clear"=!
if /i "%~1"=="session-end" if not "!AYNX_R!"=="!AYNX_IN!" exit /b 0
set AYNX_T=!AYNX_IN:*"session_id"=!
if "!AYNX_T!"=="!AYNX_IN!" goto nosid
set AYNX_SID=!AYNX_T:~2,36!
if not defined AYNX_SID goto nosid
set "AYNX_CHK=x!AYNX_SID!"
for %%C in (0 1 2 3 4 5 6 7 8 9 a b c d e f -) do set "AYNX_CHK=!AYNX_CHK:%%C=!"
if not "!AYNX_CHK!"=="x" goto nosid
if "!AYNX_SID:~35,1!"=="" goto nosid
goto sidpicked
:nosid
set "AYNX_SID="
:sidpicked
endlocal & set "AYNX_SID=%AYNX_SID%"
goto send
:agent
setlocal EnableDelayedExpansion
set "AYNX_IN="
set "AYNX_AID="
set /p AYNX_IN=
if not defined AYNX_IN goto noaid
set AYNX_T=!AYNX_IN:*"agent_id"=!
if "!AYNX_T!"=="!AYNX_IN!" goto noaid
set AYNX_T=!AYNX_T:*"=!
for /f delims^=^" %%A in ("!AYNX_T!") do if not defined AYNX_AID set "AYNX_AID=%%A"
if not defined AYNX_AID goto noaid
if not "!AYNX_AID:~64,1!"=="" goto noaid
set "AYNX_CHK=@!AYNX_AID!"
for %%C in (0 1 2 3 4 5 6 7 8 9 a b c d e f g h i j k l m n o p q r s t u v w x y z _ -) do set "AYNX_CHK=!AYNX_CHK:%%C=!"
if not "!AYNX_CHK!"=="@" goto noaid
goto aidpicked
:noaid
set "AYNX_AID="
:aidpicked
endlocal & set "AYNX_AID=%AYNX_AID%"
:send
set "AYNX_EV=%~1"
if not defined AYNX_NEST goto post
set "AYNX_CLI="
if /i "%~1"=="stop" exit /b 0
if /i "%~1"=="session" exit /b 0
if /i "%~1"=="start" set "AYNX_EV=subagent-start"
if /i "%~1"=="session-end" set "AYNX_EV=subagent-stop"
if /i "%~1"=="start" set "AYNX_AID=%AYNX_SID%"
if /i "%~1"=="session-end" set "AYNX_AID=%AYNX_SID%"
set "AYNX_SID="
:post
set "AYNX_X="
if defined AYNX_DET set "AYNX_X=,\"detail\":\"%AYNX_DET%\""
if defined AYNX_SID set "AYNX_X=%AYNX_X%,\"session\":\"%AYNX_SID%\""
if defined AYNX_AID set "AYNX_X=%AYNX_X%,\"agent\":\"%AYNX_AID%\""
if defined AYNX_CLI set "AYNX_X=%AYNX_X%,\"cli\":\"%AYNX_CLI%\""
echo header = "Authorization: Bearer %AYNX_TOK%"| curl.exe -s -o NUL -m 2 --connect-timeout 1 -K - -H "Content-Type: application/json" --data "{\"stream\":\"%AYNX_STREAM%\",\"event\":\"%AYNX_EV%\",\"v\":13%AYNX_X%}" "%AYNX_MCP_URL%/agent-signal" >NUL 2>&1
exit /b 0
"#;

/// POSIX 스크립트 — `.cmd` 와 같은 규칙. 원격 설치도 이 글자를 그대로 쓰므로 Windows 빌드에서도 쓰인다. `curl` 이 없는 서버에서는 조용히 0 이다.
const SH_SCRIPT: &str = r#"#!/bin/sh
# aynx agent-status hook - written by aynx (agent hooks installer). Reinstall rewrites it.
# aynx-hook-version: 13
# Usage: aynx-agent-signal.sh start / tool / tool-done / waiting / stop / subagent-start / subagent-stop / session-end / session  [claude|codex]  [detail]
# Outside an aynx terminal the AYNX_* variables are unset and this exits 0 without doing anything.
# Token: AYNX_SIGNAL_TOKEN (per-tile, signal only) if set, else AYNX_MCP_TOKEN (older local tiles).
# Remote tiles carry only AYNX_STREAM: the URL and token are then read (never sourced) from
# $HOME/.config/aynx/signal/<stream>.env, which aynx rewrites (0600) on every connect.
# cli: the 2nd argument if it is claude or codex (then detail is the 3rd); older entries pass the detail 2nd.
# detail: that argument if given; else for waiting, reads the hook JSON on stdin and sends only a category.
# session: for start/stop/session-end/session, reads the hook JSON on stdin and sends only the 36-char session_id (hex and dashes).
# session-end: not sent when the reason is clear (/clear keeps the CLI running).
# agent: for subagent-start/stop, reads the hook JSON on stdin and sends only agent_id (A-Z a-z 0-9 _ -, max 64).
# nested: codex with CLAUDECODE set runs inside Claude Code - start/session-end go as subagent-start/stop (agent = session_id), stop/session are not sent, no cli field.
# nested: claude/codex with CODEX_THREAD_ID set runs inside a Codex shell tool - same conversion.
[ -n "$AYNX_STREAM" ] || exit 0
url=$AYNX_MCP_URL
tok=${AYNX_SIGNAL_TOKEN:-$AYNX_MCP_TOKEN}
if [ -z "$url" ]; then
  tok=
  case $AYNX_STREAM in
    *[!0-9A-Za-z._:-]*) exit 0 ;;
  esac
  f=$HOME/.config/aynx/signal/$AYNX_STREAM.env
  [ -r "$f" ] || exit 0
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      AYNX_MCP_URL=*) url=${line#*=} ;;
      AYNX_SIGNAL_TOKEN=*) tok=${line#*=} ;;
    esac
  done < "$f"
  case $url in
    http://127.0.0.1:[0-9]*) ;;
    *) exit 0 ;;
  esac
  case $url$tok in
    *[!0-9A-Za-z:/.]*) exit 0 ;;
  esac
fi
[ -n "$url" ] && [ -n "$tok" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
det=$2
cli=
case $2 in
  claude|codex) cli=$2; det=$3 ;;
esac
nest=
if [ "$cli" = codex ] && [ -n "$CLAUDECODE" ]; then
  nest=1
fi
if [ -n "$cli" ] && [ -n "$CODEX_THREAD_ID" ]; then
  nest=1
fi
sid=
aid=
case $1 in
  start|stop|session-end|session)
    in=$(cat 2>/dev/null)
    rest=${in#*\"session_id\"}
    if [ "$rest" != "$in" ]; then
      rest=${rest#*\"}
      sid=${rest%%\"*}
      case $sid in
        *[!0-9a-fA-F-]*|'') sid= ;;
      esac
      [ ${#sid} -eq 36 ] || sid=
    fi ;;
  subagent-start|subagent-stop)
    in=$(cat 2>/dev/null)
    rest=${in#*\"agent_id\"}
    if [ "$rest" != "$in" ]; then
      rest=${rest#*\"}
      aid=${rest%%\"*}
      case $aid in
        *[!0-9A-Za-z_-]*|'') aid= ;;
      esac
      [ ${#aid} -le 64 ] || aid=
    fi ;;
esac
if [ "$1" = session-end ]; then
  case $in in
    *'"reason":"clear"'*|*'"reason": "clear"'*) exit 0 ;;
  esac
fi
if [ -z "$det" ] && [ "$1" = waiting ]; then
  in=$(cat 2>/dev/null)
  case $in in
    *'"notification_type"'*)
      case $in in
        *permission_prompt*) det=permission ;;
        *idle_prompt*) det=idle ;;
        *) det=other ;;
      esac ;;
    *'needs your permission'*) det=permission ;;
    *'waiting for your input'*) det=idle ;;
    *) det=other ;;
  esac
fi
ev=$1
if [ -n "$nest" ]; then
  cli=
  case $1 in
    stop|session) exit 0 ;;
    start) ev=subagent-start; aid=$sid ;;
    session-end) ev=subagent-stop; aid=$sid ;;
  esac
  sid=
fi
extra=
[ -n "$det" ] && extra=",\"detail\":\"$det\""
[ -n "$sid" ] && extra="$extra,\"session\":\"$sid\""
[ -n "$aid" ] && extra="$extra,\"agent\":\"$aid\""
[ -n "$cli" ] && extra="$extra,\"cli\":\"$cli\""
body="{\"stream\":\"$AYNX_STREAM\",\"event\":\"$ev\",\"v\":13$extra}"
printf 'header = "Authorization: Bearer %s"\n' "$tok" | curl -s -o /dev/null -m 2 --connect-timeout 1 -K - -H "Content-Type: application/json" --data "$body" "$url/agent-signal" >/dev/null 2>&1
exit 0
"#;

/// 이 OS 의 스크립트 — `(파일 이름, 내용)`. OS 를 타는 곳은 이 함수 하나다. `.cmd` 는 Git Bash · cmd 둘 다에서 실행된다.
fn script_file() -> (String, String) {
    #[cfg(windows)]
    {
        (
            format!("{SCRIPT_STEM}.cmd"),
            CMD_SCRIPT.replace('\n', "\r\n"),
        )
    }
    #[cfg(not(windows))]
    {
        (format!("{SCRIPT_STEM}.sh"), SH_SCRIPT.to_owned())
    }
}

/// Codex 가 `commandWindows` 를 싣는 기준.
fn is_cmd(script: &str) -> bool {
    script.to_ascii_lowercase().ends_with(".cmd")
}

fn script_dir() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("hooks"))
}

/// 역슬래시는 `/` 로 — bash 는 따옴표 안에서도 `\` 를 이스케이프로 읽을 수 있고, `/` 는 bash · cmd 모두 경로로 받는다.
fn command_path(script: &Path) -> String {
    script.to_string_lossy().replace('\\', "/")
}

/// `script` 는 이미 명령용 글자다(원격은 `$HOME` 이 큰따옴표 안에서 펴진다).
fn hook_command(script: &str, cli: &str, ev: &HookEvent) -> String {
    format!("\"{script}\" {}", hook_args(cli, ev))
}

fn hook_args(cli: &str, ev: &HookEvent) -> String {
    match ev.detail {
        Some(d) => format!("{} {cli} {d}", ev.event),
        None => format!("{} {cli}", ev.event),
    }
}

/// 경로가 바뀌었어도 알아보게 문자열 칸 전부에서 스크립트 이름을 찾는다.
fn is_ours(handler: &Value) -> bool {
    handler.as_object().is_some_and(|o| {
        o.values().any(|v| {
            v.as_str().is_some_and(|s| s.contains(SCRIPT_STEM))
        })
    })
}

fn our_groups(t: &HookTarget, script: &str) -> Vec<(&'static str, Value)> {
    let windows = is_cmd(script);
    t.events
        .iter()
        .map(|ev| {
            let mut group = Map::new();
            if let Some(m) = ev.matcher {
                group.insert("matcher".into(), Value::String(m.into()));
            }
            group.insert("hooks".into(), json!([(t.handler)(script, ev, windows)]));
            (ev.hook, Value::Object(group))
        })
        .collect()
}

fn preview(t: &HookTarget, script: &str) -> String {
    let mut hooks = Map::new();
    for (hook, group) in our_groups(t, script) {
        hooks.insert(hook.into(), json!([group]));
    }
    serde_json::to_string_pretty(&json!({ "hooks": hooks })).unwrap_or_default()
}

/// 우리가 비게 만든 묶음 · 이벤트 배열 · `hooks` 객체만 지운다 — 원래부터 비어 있던 것은 사용자의 것이다.
fn remove_from(root: &mut Value) -> bool {
    remove_where(root, is_ours)
}

/// 로컬 자동 갱신은 이 인스턴스의 항목만 뺀다.
fn remove_where(root: &mut Value, pred: impl Fn(&Value) -> bool) -> bool {
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    let mut changed = false;
    let mut emptied_events: Vec<String> = Vec::new();
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else {
            continue;
        };
        let mut touched = false;
        groups.retain_mut(|group| {
            let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            let before = inner.len();
            inner.retain(|h| !pred(h));
            if inner.len() == before {
                return true;
            }
            touched = true;
            !inner.is_empty()
        });
        if touched {
            changed = true;
            if groups.is_empty() {
                emptied_events.push(event.clone());
            }
        }
    }
    for e in &emptied_events {
        hooks.shift_remove(e);
    }
    if changed && hooks.is_empty() {
        if let Some(obj) = root.as_object_mut() {
            obj.shift_remove("hooks");
        }
    }
    changed
}

fn has_ours(root: &Value) -> bool {
    remove_from(&mut root.clone())
}

/// 먼저 우리 것을 전부 빼므로 멱등이다.
fn install_into(t: &HookTarget, root: &mut Value, script: &str) {
    remove_from(root);
    add_groups(t, root, script);
}

/// 빼는 일은 부르는 쪽이 먼저 한다.
fn add_groups(t: &HookTarget, root: &mut Value, script: &str) {
    let Some(obj) = root.as_object_mut() else {
        return;
    };
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().expect("객체로 보장됨");
    for (hook, group) in our_groups(t, script) {
        let arr = hooks.entry(hook).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        arr.as_array_mut().expect("배열로 보장됨").push(group);
    }
}

/// 모든 이벤트에 지금 모양 그대로의 우리 처리기가 있으면 `Full`, 하나라도 있으면 `Partial`.
#[derive(Debug, PartialEq, Eq)]
enum Installed {
    None,
    Partial,
    Full,
}

fn installed_in(t: &HookTarget, root: &Value, script: &str) -> Installed {
    let handlers_of = |hook: &str| -> Vec<&Value> {
        root.get("hooks")
            .and_then(|h| h.get(hook))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|g| g.get("hooks").and_then(Value::as_array))
            .flatten()
            .collect()
    };
    let windows = is_cmd(script);
    let mut full = true;
    let mut any = false;
    for ev in t.events {
        let have = handlers_of(ev.hook);
        let want = (t.handler)(script, ev, windows);
        any |= have.iter().any(|h| is_ours(h));
        full &= have.iter().any(|h| **h == want);
    }
    match (full, any) {
        (true, _) => Installed::Full,
        (false, true) => Installed::Partial,
        _ => Installed::None,
    }
}

/// 깨졌거나 객체가 아니면 실패한다(덮어쓰지 않는다).
fn parse_settings(t: &HookTarget, text: Option<&str>, shown: &str) -> Result<Value, String> {
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        return Ok(json!({}));
    };
    match serde_json::from_str::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        _ => Err(tr!(
            ko: "{name} 설정({p})이 올바른 JSON 객체가 아니라 손대지 않았습니다",
            en: "The {name} settings ({p}) are not a valid JSON object — left untouched",
            name = t.display,
            p = shown
        )),
    }
}

fn read_settings(t: &HookTarget, path: &Path) -> Result<(Value, bool), String> {
    let text = match std::fs::read_to_string(path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            return Err(tr!(
                ko: "{name} 설정을 읽지 못했습니다: {e}",
                en: "Could not read the {name} settings: {e}",
                name = t.display
            ))
        }
    };
    let existed = text.is_some();
    Ok((
        parse_settings(t, text.as_deref(), &path.display().to_string())?,
        existed,
    ))
}

fn write_settings(t: &HookTarget, path: &Path, root: &Value) -> Result<(), String> {
    let fail = |e: String| {
        tr!(
            ko: "{name} 설정을 쓰지 못했습니다: {e}",
            en: "Could not write the {name} settings: {e}",
            name = t.display
        )
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| fail(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(root).map_err(|e| fail(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| fail(e.to_string()))
}

fn write_script(dir: &Path) -> Result<PathBuf, String> {
    let (name, want) = script_file();
    let path = dir.join(name);
    if std::fs::read_to_string(&path).is_ok_and(|have| have == want) {
        return Ok(path);
    }
    let fail = |e: std::io::Error| tr!(ko: "훅 스크립트를 쓰지 못했습니다: {e}", en: "Could not write the hook script: {e}");
    std::fs::create_dir_all(dir).map_err(fail)?;
    std::fs::write(&path, want.as_bytes()).map_err(fail)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).map_err(fail)?;
    }
    Ok(path)
}

/// 앱이 뜰 때 — 설치된 스크립트 사본이 이 판과 다르면 갈아 쓴다. 파일이 있을 때만(없으면 설치 안 함 · 제거함). 에이전트 설정 파일은 건드리지 않는다.
fn refresh_at(dir: &Path) -> Result<bool, String> {
    let (name, want) = script_file();
    let path = dir.join(name);
    match std::fs::read_to_string(&path) {
        Ok(have) if have == want => Ok(false),
        Ok(_) => write_script(dir).map(|_| true),
        Err(_) => Ok(false),
    }
}

pub(crate) fn refresh_installed_script() {
    if let Some(dir) = script_dir() {
        let _ = refresh_at(&dir);
    }
}

/// 경로 전체를 보므로 릴리스 `…/aynx/hooks/…` 와 개발 `…/aynx-dev/hooks/…` 는 서로를 품지 않는다. Codex 의 Windows 처리기는 경로를 역슬래시로 싣는다.
fn is_mine(handler: &Value, script: &str) -> bool {
    let want = script.replace('\\', "/").to_ascii_lowercase();
    is_ours(handler)
        && handler.as_object().is_some_and(|o| {
            o.values().any(|v| {
                v.as_str()
                    .is_some_and(|s| s.replace('\\', "/").to_ascii_lowercase().contains(&want))
            })
        })
}

fn has_mine(root: &Value, script: &str) -> bool {
    remove_where(&mut root.clone(), |h| is_mine(h, script))
}

#[derive(Debug, PartialEq, Eq)]
enum Refresh {
    Untouched,
    Foreign,
    Changed,
}

/// 이 인스턴스가 심은 항목만 갱신한다 — 남의 경로를 내 경로로 바꾸면 릴리스 · 개발 두 앱이 켜질 때마다 사용자 설정을 서로 되돌린다.
fn refresh_entries(t: &HookTarget, root: &mut Value, script: &str) -> Refresh {
    if !has_ours(root) {
        return Refresh::Untouched;
    }
    if !has_mine(root, script) {
        return Refresh::Foreign;
    }
    if installed_in(t, root, script) == Installed::Full {
        return Refresh::Untouched;
    }
    let before = root.clone();
    remove_where(root, |h| is_mine(h, script));
    add_groups(t, root, script);
    if *root == before {
        Refresh::Untouched
    } else {
        Refresh::Changed
    }
}

fn refresh_local_at(t: &HookTarget, settings: &Path, dir: &Path) -> Result<Refresh, String> {
    if !settings.exists() {
        return Ok(Refresh::Untouched);
    }
    let (mut root, _) = read_settings(t, settings)?;
    let script = dir.join(script_file().0);
    let r = refresh_entries(t, &mut root, &command_path(&script));
    if r == Refresh::Changed {
        write_script(dir)?;
        write_settings(t, settings, &root)?;
    }
    Ok(r)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRefreshNotice {
    pub agent: &'static str,
    pub version: u32,
}

/// 앱 수명에 한 번(모듈 머리말 "우리 항목만 자동 갱신").
static LOCAL_ONCE: std::sync::Once = std::sync::Once::new();
static LOCAL_NOTICES: std::sync::Mutex<Vec<LocalRefreshNotice>> = std::sync::Mutex::new(Vec::new());

/// 먼저 닿은 쪽이 한 번 돌리고, 늦게 닿은 쪽은 끝날 때까지 기다린다.
pub(crate) fn refresh_local_entries_once() {
    LOCAL_ONCE.call_once(|| {
        let Some(dir) = script_dir() else { return };
        for t in TARGETS.iter().filter(|t| t.available) {
            let Some(settings) = (t.local_settings)() else {
                continue;
            };
            match refresh_local_at(t, &settings, &dir) {
                Ok(Refresh::Untouched) => {}
                Ok(Refresh::Foreign) => eprintln!(
                    "에이전트 훅: {} 의 우리 항목은 다른 인스턴스가 심은 훅 — 건드리지 않음",
                    t.display
                ),
                Ok(Refresh::Changed) => {
                    eprintln!("에이전트 훅: {} 의 우리 항목을 {SCRIPT_VERSION}판 모양으로 갈아 썼습니다", t.display);
                    if t.needs_trust_note {
                        LOCAL_NOTICES
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .push(LocalRefreshNotice {
                                agent: t.display,
                                version: SCRIPT_VERSION,
                            });
                    }
                }
                Err(e) => eprintln!("에이전트 훅: {} 우리 항목 자동 갱신 실패 — {e}", t.display),
            }
        }
    });
}

/// 신뢰 안내는 한 번만 건넨다. 이벤트가 아닌 까닭: 갱신은 창이 듣기 전(`setup`)에 끝날 수 있다.
#[tauri::command]
pub async fn agent_hooks_take_local_refresh() -> Vec<LocalRefreshNotice> {
    tauri::async_runtime::spawn_blocking(|| {
        refresh_local_entries_once();
        std::mem::take(&mut *LOCAL_NOTICES.lock().unwrap_or_else(|p| p.into_inner()))
    })
    .await
    .unwrap_or_default()
}

/// 설정이 깨져 있으면 스크립트도 쓰지 않고 실패한다 — 반쯤 된 설치를 남기지 않는다.
fn install_at(t: &HookTarget, settings: &Path, dir: &Path) -> Result<(), String> {
    let (mut root, existed) = read_settings(t, settings)?;
    let before = root.clone();
    let script = write_script(dir)?;
    install_into(t, &mut root, &command_path(&script));
    if existed && root == before {
        return Ok(());
    }
    write_settings(t, settings, &root)
}

/// 다른 에이전트의 설정에 우리 항목이 남아 있으면 스크립트를 지우지 않는다(그쪽 신호가 끊긴다).
fn remove_at(
    t: &HookTarget,
    settings: &Path,
    dir: &Path,
    others: &[PathBuf],
) -> Result<(), String> {
    if settings.exists() {
        let (mut root, _) = read_settings(t, settings)?;
        if remove_from(&mut root) {
            write_settings(t, settings, &root)?;
        }
    }
    // 못 읽는 파일은 "쓰는 중" 으로 친다 — 남은 스크립트는 해가 없고, 지운 스크립트는 그쪽 신호를 끊는다.
    let still_used = others
        .iter()
        .any(|p| read_settings(t, p).map_or(true, |(root, _)| has_ours(&root)));
    if !still_used {
        let _ = std::fs::remove_file(dir.join(script_file().0));
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    pub installed: bool,
    pub partial: bool,
    pub settings_path: String,
    pub script_path: String,
    pub preview: String,
    pub error: Option<String>,
}

fn status_of(
    t: &HookTarget,
    read: Result<Value, String>,
    script_cmd: &str,
    settings_shown: String,
    script_shown: String,
) -> HooksStatus {
    let (installed, error) = match read {
        Ok(root) => (installed_in(t, &root, script_cmd), None),
        Err(e) => (Installed::None, Some(e)),
    };
    HooksStatus {
        installed: installed == Installed::Full,
        partial: installed == Installed::Partial,
        settings_path: settings_shown,
        script_path: script_shown,
        preview: preview(t, script_cmd),
        error,
    }
}

fn status_at(t: &HookTarget, settings: &Path, dir: &Path) -> HooksStatus {
    let script = dir.join(script_file().0);
    status_of(
        t,
        read_settings(t, settings).map(|(v, _)| v),
        &command_path(&script),
        settings.display().to_string(),
        script.display().to_string(),
    )
}

fn paths(t: &HookTarget) -> Result<(PathBuf, PathBuf), String> {
    match ((t.local_settings)(), script_dir()) {
        (Some(s), Some(d)) => Ok((s, d)),
        _ => Err(
            tr!(ko: "홈·설정 폴더를 찾지 못했습니다", en: "Could not find the home or config folder"),
        ),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookTargetInfo {
    pub id: &'static str,
    pub display: &'static str,
    pub needs_trust_note: bool,
}

#[tauri::command]
pub async fn agent_hooks_targets() -> Vec<HookTargetInfo> {
    TARGETS
        .iter()
        .filter(|t| t.available)
        .map(|t| HookTargetInfo {
            id: t.id,
            display: t.display,
            needs_trust_note: t.needs_trust_note,
        })
        .collect()
}

#[tauri::command]
pub async fn agent_hooks_status(agent: String) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (s, d) = paths(t)?;
        Ok(status_at(t, &s, &d))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 사용자가 확인 창에서 [설치] 를 누른 뒤에만 불린다.
#[tauri::command]
pub async fn agent_hooks_install(agent: String) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (s, d) = paths(t)?;
        install_at(t, &s, &d)?;
        Ok(status_at(t, &s, &d))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_hooks_remove(agent: String) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (s, d) = paths(t)?;
        let others: Vec<PathBuf> = TARGETS
            .iter()
            .filter(|o| o.id != t.id)
            .filter_map(|o| (o.local_settings)())
            .collect();
        remove_at(t, &s, &d, &others)?;
        Ok(status_at(t, &s, &d))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── 원격 설치 ──
// 서버로 나가는 명령 글자는 전부 여기서 짓는다(프런트는 세션 id 와 에이전트 id 만 넘긴다) — 값은 하나도 셸에 날것으로 가지 않는다(고정 셸 글자 + `sh_quote`).

const REMOTE_SCRIPT_DIR: &str = "~/.config/aynx/hooks";
const REMOTE_SCRIPT: &str = "~/.config/aynx/hooks/aynx-agent-signal.sh";
/// 명령에는 `~` 가 아니라 `$HOME` 을 쓴다 — 큰따옴표 안의 `~` 는 펴지지 않는다.
const REMOTE_SCRIPT_CMD: &str = "$HOME/.config/aynx/hooks/aynx-agent-signal.sh";
/// SFTP 경로(로그인 폴더 = 홈 기준 상대).
pub(crate) const REMOTE_SCRIPT_SFTP: &str = ".config/aynx/hooks/aynx-agent-signal.sh";

pub(crate) fn remote_script_body() -> &'static str {
    SH_SCRIPT
}

const REMOTE_MISSING_EXIT: i64 = 3;

const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// sshd 는 명령을 `sh -c` 의 인자 하나로 넘기고, 리눅스는 인자 하나를 128 KiB(`MAX_ARG_STRLEN`)에서 자른다.
const REMOTE_COMMAND_MAX: usize = 100 * 1024;

fn remote_file_sh(t: &HookTarget, suffix: &str) -> String {
    format!(
        "{}/{}",
        t.remote_dir_sh,
        crate::ssh::sh_quote(&format!("{}{suffix}", t.remote_file))
    )
}

fn remote_read_command(t: &HookTarget) -> String {
    let f = remote_file_sh(t, "");
    format!("if [ -e {f} ]; then cat -- {f}; else exit {REMOTE_MISSING_EXIT}; fi")
}

/// 옆 임시 파일에 쓰고 `mv -f` 한다 — 쓰다 끊겨도 반쪽 파일이 남지 않는다.
fn remote_settings_write(t: &HookTarget, root: &Value) -> Result<String, String> {
    let json = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    let f = remote_file_sh(t, "");
    let tmp = remote_file_sh(t, ".aynx-tmp");
    Ok(format!(
        "mkdir -p {dir} && printf '%s' {json} > {tmp} && mv -f {tmp} {f}",
        dir = t.remote_dir_sh,
        json = crate::ssh::sh_quote(&json)
    ))
}

/// 깨진 파일이면 아무것도 쓰지 않고 실패한다(스크립트도).
fn remote_install_command(t: &HookTarget, existing: Option<&str>) -> Result<String, String> {
    let mut root = parse_settings(t, existing, t.remote_shown)?;
    let before = root.clone();
    install_into(t, &mut root, REMOTE_SCRIPT_CMD);
    let dir = crate::ssh::sh_path(REMOTE_SCRIPT_DIR);
    let script = crate::ssh::sh_path(REMOTE_SCRIPT);
    let mut cmd = format!(
        "mkdir -p {dir} && printf '%s' {body} > {script} && chmod 755 {script}",
        body = crate::ssh::sh_quote(SH_SCRIPT),
    );
    if !(existing.is_some() && root == before) {
        cmd = format!("{cmd} && {}", remote_settings_write(t, &root)?);
    }
    fit(t, cmd)
}

/// 그 에이전트의 PATH 심(`crate::agent_shim`)은 늘 지운다.
fn remote_remove_command(
    t: &HookTarget,
    existing: Option<&str>,
    keep_script: bool,
) -> Result<String, String> {
    let script = crate::ssh::sh_path(REMOTE_SCRIPT);
    let shim = crate::agent_shim::remove_command(t.id);
    let rm = if keep_script {
        shim
    } else {
        format!("rm -f {script} && {shim}")
    };
    if existing.is_none() {
        return Ok(rm);
    }
    let mut root = parse_settings(t, existing, t.remote_shown)?;
    if !remove_from(&mut root) {
        return Ok(rm);
    }
    fit(t, format!("{} && {rm}", remote_settings_write(t, &root)?))
}

fn fit(t: &HookTarget, cmd: String) -> Result<String, String> {
    if cmd.len() > REMOTE_COMMAND_MAX {
        return Err(tr!(
            ko: "서버의 {name} 설정이 너무 커서 한 번에 쓸 수 없습니다 — 손대지 않았습니다",
            en: "The server's {name} settings are too large to write in one go — left untouched",
            name = t.display
        ));
    }
    Ok(cmd)
}

fn remote_status(t: &HookTarget, read: Result<Option<String>, String>) -> HooksStatus {
    let parsed = read.and_then(|s| parse_settings(t, s.as_deref(), t.remote_shown));
    status_of(
        t,
        parsed,
        REMOTE_SCRIPT_CMD,
        t.remote_shown.into(),
        REMOTE_SCRIPT.into(),
    )
}

async fn remote_exec(
    handle: crate::ssh::ExecHandle,
    command: String,
) -> Result<crate::ssh::ExecOutcome, String> {
    let outcome = crate::ssh::run_exec(
        handle,
        command,
        REMOTE_TIMEOUT,
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    )
    .await;
    if let Some(e) = outcome.error {
        return Err(e);
    }
    if outcome.timed_out {
        return Err(tr!(
            ko: "서버가 {secs}초 안에 답하지 않았습니다",
            en: "The server did not answer within {secs} seconds",
            secs = REMOTE_TIMEOUT.as_secs()
        ));
    }
    Ok(outcome)
}

async fn remote_read(
    t: &HookTarget,
    handle: crate::ssh::ExecHandle,
) -> Result<Option<String>, String> {
    let out = remote_exec(handle, remote_read_command(t)).await?;
    match out.exit_code {
        Some(0) => Ok(Some(out.stdout)),
        Some(REMOTE_MISSING_EXIT) => Ok(None),
        _ => Err(fail_line(&out.stderr)),
    }
}

pub(crate) async fn remote_write(handle: crate::ssh::ExecHandle, command: String) -> Result<(), String> {
    let out = remote_exec(handle, command).await?;
    if out.exit_code == Some(0) {
        Ok(())
    } else {
        Err(fail_line(&out.stderr))
    }
}

fn fail_line(stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.is_empty() {
        tr!(ko: "서버에서 명령이 실패했습니다", en: "The command failed on the server")
    } else {
        msg.to_string()
    }
}

fn handle_for(id: u32) -> Result<crate::ssh::ExecHandle, String> {
    crate::server::ssh_ops::handle_of(id).ok_or_else(crate::errors::session_gone)
}

#[tauri::command]
pub async fn agent_hooks_remote_status(
    id: u32,
    agent: String,
) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    let handle = handle_for(id)?;
    Ok(remote_status(t, remote_read(t, handle).await))
}

/// 사용자가 확인 창에서 [설치] 를 누른 뒤에만 불린다.
#[tauri::command]
pub async fn agent_hooks_remote_install(
    id: u32,
    agent: String,
) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    let handle = handle_for(id)?;
    let existing = remote_read(t, handle.clone()).await?;
    let cmd = remote_install_command(t, existing.as_deref())?;
    remote_write(handle.clone(), cmd).await?;
    Ok(remote_status(t, remote_read(t, handle).await))
}

/// 못 읽으면 스크립트를 남긴다 — 남은 스크립트는 해가 없고, 지운 스크립트는 그쪽 신호를 끊는다.
#[tauri::command]
pub async fn agent_hooks_remote_remove(
    id: u32,
    agent: String,
) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    let handle = handle_for(id)?;
    let existing = remote_read(t, handle.clone()).await?;
    let mut keep_script = false;
    for o in TARGETS.iter().filter(|o| o.id != t.id) {
        keep_script |= match remote_read(o, handle.clone()).await {
            Ok(text) => parse_settings(o, text.as_deref(), o.remote_shown)
                .map_or(true, |root| has_ours(&root)),
            Err(_) => true,
        };
    }
    let cmd = remote_remove_command(t, existing.as_deref(), keep_script)?;
    remote_write(handle.clone(), cmd).await?;
    Ok(remote_status(t, remote_read(t, handle).await))
}

// ── 원격 자동 설치 ──
// 호스트 옵션 에이전트 활성화가 켜져 있으면 원격 타일을 열 때 메뉴 설치와 같은 함수로 심는다 — 확인 창은 없고 호스트 폼의 스위치가 그 동의다.
// 헤드리스 위임 접속은 이 길을 지나지 않는다(사람 타일만). 실패는 접속을 막지 않는다 — 알림 한 줄.

/// 방송이고, 스트림이 그 창의 타일일 때만 띄운다(프런트 `app/remote-hooks-auto.ts`).
pub(crate) const REMOTE_AUTO_EVENT: &str = "remote-hooks-auto";

/// 넘으면 포기하고 첫 입력을 보낸다(훅 없이 · 알림).
pub(crate) const REMOTE_AUTO_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

/// 시작 명령의 에이전트가 맨 앞이다(그 알림이 먼저 선다).
pub(crate) fn auto_install_targets(enabled: bool, agent: Option<&str>) -> Vec<&'static HookTarget> {
    if !enabled {
        return Vec::new();
    }
    let mut out: Vec<&'static HookTarget> = TARGETS.iter().filter(|t| t.available).collect();
    if let Some(i) = agent.and_then(|a| out.iter().position(|t| t.id == a)) {
        let first = out.remove(i);
        out.insert(0, first);
    }
    out
}

fn auto_up_to_date(status: &HooksStatus, script_current: bool) -> bool {
    status.installed && status.error.is_none() && script_current
}

async fn remote_script_current(handle: crate::ssh::ExecHandle) -> bool {
    let cmd = format!("cat -- {}", crate::ssh::sh_path(REMOTE_SCRIPT));
    match remote_exec(handle, cmd).await {
        Ok(out) => out.exit_code == Some(0) && !out.stdout_truncated && out.stdout == SH_SCRIPT,
        Err(_) => false,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AutoInstall {
    Current,
    Installed,
    Failed(String),
}

/// 쓰기는 임시 파일 → `mv -f` 라 시한에 끊겨도 반쪽 파일이 남지 않는다.
pub(crate) async fn remote_auto_install(
    t: &HookTarget,
    handle: crate::ssh::ExecHandle,
) -> AutoInstall {
    let work = async {
        let existing = remote_read(t, handle.clone()).await?;
        let status = remote_status(t, Ok(existing.clone()));
        if let Some(e) = status.error {
            return Err(e);
        }
        let script_current = remote_script_current(handle.clone()).await;
        if auto_up_to_date(&status, script_current) {
            return Ok(false);
        }
        let cmd = remote_install_command(t, existing.as_deref())?;
        remote_write(handle, cmd).await?;
        Ok(true)
    };
    match tokio::time::timeout(REMOTE_AUTO_BUDGET, work).await {
        Ok(Ok(true)) => AutoInstall::Installed,
        Ok(Ok(false)) => AutoInstall::Current,
        Ok(Err(e)) => AutoInstall::Failed(e),
        Err(_) => AutoInstall::Failed(tr!(
            ko: "서버가 {secs}초 안에 끝내지 못했습니다",
            en: "The server did not finish within {secs} seconds",
            secs = REMOTE_AUTO_BUDGET.as_secs()
        )),
    }
}

/// 문구는 프런트의 i18n 이 짓는다.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoInstallNotice {
    pub stream: String,
    pub alias: String,
    pub agent: &'static str,
    pub version: Option<u32>,
    pub reason: Option<String>,
    pub needs_trust: bool,
}

/// 같은 호스트 · 같은 에이전트는 앱이 떠 있는 동안 한 번만 알린다. 장부 열쇠가 에이전트마다라 Codex 의 `/hooks` 승인 안내가 Claude 알림에 가려지지 않는다.
fn auto_notice(
    seen: &mut std::collections::HashSet<String>,
    outcome: &AutoInstall,
    t: &HookTarget,
    alias: &str,
    stream: &str,
) -> Option<AutoInstallNotice> {
    let (version, reason) = match outcome {
        AutoInstall::Current => return None,
        AutoInstall::Installed => (Some(SCRIPT_VERSION), None),
        AutoInstall::Failed(e) => (None, Some(e.clone())),
    };
    if !seen.insert(format!("{} {}", alias.to_lowercase(), t.id)) {
        return None;
    }
    Some(AutoInstallNotice {
        stream: stream.to_owned(),
        alias: alias.to_owned(),
        agent: t.display,
        version,
        reason,
        needs_trust: t.needs_trust_note,
    })
}

static AUTO_NOTIFIED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

pub(crate) fn auto_notice_once(
    outcome: &AutoInstall,
    t: &HookTarget,
    alias: &str,
    stream: &str,
) -> Option<AutoInstallNotice> {
    let mut seen = AUTO_NOTIFIED.lock().unwrap_or_else(|p| p.into_inner());
    auto_notice(&mut seen, outcome, t, alias, stream)
}

#[cfg(test)]
mod tests;
