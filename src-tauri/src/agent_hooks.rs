//! **에이전트 CLI 훅 설치기** — 에이전트 상태 점이 추정 대신 정확한 신호를 받게 하는 한 번의 설정
//! (docs/log/2026-09-24-agent-hook-signals.md · Codex 는 docs/log/2026-09-26-codex-hooks.md).
//!
//! 설정 › AI 의 "<에이전트> 훅" 줄과 프로젝트 메뉴의 "원격에 <에이전트> 훅 설치…" 가 부른다. 하는 일은 둘:
//!
//! 1. `<config_dir>/aynx/hooks/` 에 **작은 스크립트 하나**를 쓴다(Windows `.cmd`, 그 밖 `.sh` —
//!    [`script_file`]). **모든 에이전트가 같은 스크립트를 쓴다.** 스크립트는 인자로 받은 이벤트 이름
//!    하나(와 CLI 이름 · 선택 범주 — 8판)를 `$AYNX_MCP_URL/agent-signal` 로 `curl` 한 번에 쏘고([`SCRIPT_VERSION`];
//!    설치된 사본은 앱이 뜰 때 [`refresh_installed_script`] 가 새 판으로 맞춘다), 주소·스트림·토큰 중
//!    하나라도 비어 있으면(앱 밖에서 띄운 에이전트) **조용히 0 으로 끝난다** — 훅은 aynx 밖의 에이전트를
//!    절대 깨뜨리면 안 된다. 토큰은 신호 전용 토큰(`AYNX_SIGNAL_TOKEN`)을 먼저 쓰고, 없을 때만 MCP
//!    토큰(`AYNX_MCP_TOKEN`)으로 물러난다. (개발 인스턴스는 MCP 토큰을 `AYNX_DEV_MCP_TOKEN` 에 싣지만
//!    스크립트는 그 이름을 보지 않는다 — 로컬 타일은 이제 모두 신호 토큰을 받으므로 물러남은 옛 타일
//!    몫이고, 그 때문에 스크립트 판을 올리지 않았다 · docs/log/2026-09-28-codex-mcp-headers.md.)
//! 2. 그 에이전트의 훅 설정 파일(Claude Code `~/.claude/settings.json` · Codex `$CODEX_HOME/hooks.json`)
//!    의 `hooks` 아래 이벤트마다 **우리 항목만** 더한다([`install_into`]). 이벤트마다 명령을 따로
//!    등록하고 이벤트 이름(과 알고 있는 범주)을 인자로 박아 둔다 — 그래서 스크립트는 훅 입력 JSON 을
//!    거의 읽을 필요가 없다(`.cmd` 로 JSON 을 파싱하는 것은 비싸다. 읽는 것은 범주를 인자로 줄 수
//!    없는 Claude 의 `Notification` 하나뿐).
//!
//! ## 에이전트 하나 = 표 한 줄 ([`TARGETS`])
//!
//! 에이전트마다 다른 것은 **훅 설정 파일이 어디 있나 · 어느 훅 이벤트를 우리 이벤트로 접나 · 처리기
//! JSON 의 모양 · 신뢰 단계가 있나** 넷뿐이고, 그것만 [`HookTarget`] 한 줄에 산다. 스크립트·병합·
//! 상태 판정·파일 읽고 쓰기·원격 exec 왕복·Tauri 명령은 전부 공용이다. 셋째 에이전트(Gemini CLI ·
//! opencode …)는 [`TARGETS`] 에 한 줄 + 사전에 이름 하나로 붙는다 — 그 CLI 의 훅 표면이 "이벤트마다
//! 셸 명령 하나" 꼴이기만 하면.
//!
//! **원격(SSH)** 에도 같은 둘을 쓴다 — 프로젝트 메뉴의 "원격에 <에이전트> 훅 설치…"
//! ([`agent_hooks_remote_install`] · docs/log/2026-09-24-remote-agent-signals.md). 병합은 **같은 순수
//! 함수**([`install_into`] · [`remove_from`])이고, 다른 것은 파일을 읽고 쓰는 길(exec 왕복 — 명령
//! 글자는 전부 여기서 [`crate::ssh::sh_quote`] 로 짓는다)과 스크립트 경로(`$HOME/.config/aynx/hooks/
//! aynx-agent-signal.sh`)뿐이다.
//!
//! ## 수술하듯
//!
//! - 우리 항목은 **처리기의 명령 글자 안의 스크립트 이름**([`SCRIPT_STEM`])으로 알아본다. 설치는 먼저
//!   우리 것을 전부 빼고 다시 넣으므로 몇 번을 눌러도 한 벌이다(멱등). 제거는 우리 것만 뺀다.
//! - 다른 키·다른 훅·키 순서는 그대로 둔다(serde_json `preserve_order`, 2칸 들여쓰기 pretty).
//!   우리가 비운 이벤트 배열·`hooks` 객체만 지운다 — 사용자가 원래 둔 빈 배열은 건드리지 않는다.
//! - 결과가 읽은 것과 **같으면 파일을 쓰지 않는다**(모든 에이전트) — Codex 는 훅 정의가 바뀌면 사용자의
//!   신뢰(`/hooks`)를 다시 받아야 하므로, 같은 설치를 다시 눌러 파일을 흔들 이유가 없다.
//! - 파일이 올바른 JSON 객체가 아니면 **손대지 않고 실패한다**.
//!
//! **우리 항목만 자동 갱신(2026-10-08)**: 이미 설치한 사람의 이 PC 설정에 **우리 항목이 있고 지금 모양이 아니면**
//! 앱이 뜰 때 그 항목만 새 등록 모양으로 갈아 쓴다([`refresh_local_entries_once`] — 사용자 항목은 그대로, 바뀐 것이
//! 없으면 쓰지 않는다, 실패는 로그 한 줄 · 설정 › AI 의 "다시 설치" 권유가 남는다). 예전(10-05)에는 판이 오를 때마다
//! 사람이 [다시 설치…] 를 눌러야 했다. 우리 항목이 없는 사람(설치 안 함 · 제거함)에게는 아무것도 더하지 않는다.
//! Codex 는 항목이 바뀌면 `/hooks` 승인을 다시 받아야 하므로 갈아 쓴 뒤 안내를 한 번 낸다.
//!
//! 앱이 먼저 켜지 않는다 — 사용자가 누른 뒤, 무엇을 쓸지 확인 창으로 보여 준 뒤에만 쓴다. **예외 하나**: 원격
//! 훅은 호스트 폼의 스위치 **에이전트 활성화**(`sessions.toml` `agent` — 옛 `remote_hooks` · 기본 켬)가 동의이고, 그 호스트에
//! 접속할 때(사람 타일 — 2026-10-26 부터 앱이 띄운 AI 타일이 아니어도) 확인 창 없이 같은 함수로 심는다([`remote_auto_install`]). 신뢰 상태
//! (Codex `config.toml` 의 `[hooks.state]`)는 **쓰지 않는다** — 그것은 사용자가 그 CLI 안에서 내리는 결정이다.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::i18n::tr;

/// 우리 스크립트 파일 이름의 몸통 — **우리 항목을 알아보는 열쇠**이기도 하다.
const SCRIPT_STEM: &str = "aynx-agent-signal";

/// 훅이 기다리는 최대 초 — 스크립트의 `curl` 은 2초(`-m 2`)에서 스스로 끊는다. 그보다 조금 넉넉히.
const HOOK_TIMEOUT_SECS: u64 = 5;

// ---------------------------------------------------------------------------
// 에이전트 표 — 에이전트마다 다른 것은 여기에만 있다
// ---------------------------------------------------------------------------

/// 그 CLI 의 훅 이벤트 하나 → 우리 신호 하나.
pub(crate) struct HookEvent {
    /// 그 CLI 가 부르는 훅 이벤트 이름 (`"Stop"` …).
    hook: &'static str,
    /// 매처 — 싣지 않으면 `None`. Claude 는 도구 이벤트에 `"*"`, `Notification` 에 `""` 를 싣는다.
    matcher: Option<&'static str>,
    /// 우리 이벤트 이름 — `crate::agent_signal::SignalEvent` 일곱 중 하나(테스트가 본다).
    event: &'static str,
    /// 고정 범주 — 스크립트의 둘째 인자로 박힌다(`waiting permission`). `None` 이고 `waiting` 이면
    /// 스크립트가 표준 입력에서 범주를 가린다(Claude `Notification`). 값은
    /// `crate::agent_signal::WAITING_DETAILS` 중 하나(테스트가 본다).
    detail: Option<&'static str>,
}

/// 훅을 받는 에이전트 CLI 하나 — **에이전트를 더하는 자리는 이 표 한 줄**이다(모듈 머리말).
pub(crate) struct HookTarget {
    /// 안정 id — 명령 인자·프런트의 키(`"claude"`·`"codex"`, `mcp.rs` 의 CLI 표와 같은 글자).
    pub id: &'static str,
    /// 화면·문구에 쓰는 이름 — 제품 이름이라 번역하지 않는다.
    pub display: &'static str,
    /// 이 PC 의 훅 설정 파일.
    local_settings: fn() -> Option<PathBuf>,
    /// 서버에서 설정 파일이 사는 폴더 — **셸 글자 그대로**(이미 인용된 식. `$HOME`·환경변수가 펴진다).
    remote_dir_sh: &'static str,
    /// 그 폴더 안의 파일 이름.
    remote_file: &'static str,
    /// 서버 쪽 경로를 화면에 보일 글자.
    remote_shown: &'static str,
    /// 등록할 이벤트.
    events: &'static [HookEvent],
    /// 처리기 JSON 한 개 — `script` 는 스크립트 경로(명령 글자, `/`), `ev` 는 그 이벤트, `windows` 는
    /// 그것이 `.cmd` 인가. 명령 줄을 **어떻게 적는가**(셸을 거치나 · 인용 규칙)가 CLI 마다 달라 여기서 짓는다.
    handler: fn(script: &str, ev: &HookEvent, windows: bool) -> Value,
    /// 설치한 뒤 그 CLI 안에서 **신뢰(승인)** 를 한 번 받아야 하는가 — 화면이 안내 한 줄을 더한다.
    pub needs_trust_note: bool,
    /// 화면에 내놓는가. `false` 면 표에는 남지만(모양·시험은 그대로 돈다) 목록([`agent_hooks_targets`])에
    /// 없고 모든 명령이 거절한다 — 신호가 **틀린 타일로 갈 수 있는** 동안 숨겨 둔다(Codex 가 한때 그랬다 — 로그의
    /// "데몬 — 왜 숨겼나" · "다시 켬"). 지금은 모든 줄이 `true` 다.
    available: bool,
}

/// Claude Code — `~/.claude/settings.json` 의 `hooks`.
///
/// `PostToolUse` → `tool-done` 은 넷째 판 뒤에 더했다(2026-09-24 실기): 권한 물음을 승인한 뒤에는
/// 다음 도구나 `Stop` 까지 아무 훅도 울리지 않아 점이 "입력 대기" 에 머물렀다. 네 벌로 설치한
/// 사용자는 **다시 설치**하면 다섯째가 붙고(설치는 우리 것을 전부 빼고 다시 넣는다), 상태는 그때까지
/// "일부만" 으로 읽힌다([`installed_in`]). `Notification` 은 권한 물음·한참 입력 없음이 한 훅이라
/// 범주를 박지 않는다(스크립트가 입력으로 가린다).
///
/// `SubagentStart`·`SubagentStop` 은 2026-10-04 에 더했다(docs/log/2026-10-04-subagent-signals.md):
/// 공식 hooks 레퍼런스에 둘 다 있고 입력에 `agent_id` 가 있다. 대화형 세션의 서브 에이전트는 기본이
/// 백그라운드라 메인의 `Stop` 이 서브 에이전트보다 먼저 온다 — 화면이 진행 중 수를 세어 완료를 미룬다.
/// 매처는 싣지 않는다(= 모든 에이전트 종류 — 문서의 "any subagent stops" 예와 같은 꼴). 옛 다섯 벌 설치는
/// "일부만" 으로 읽히고 [다시 설치…] 가 둘을 붙인다.
///
/// `SessionEnd` → `session-end` 는 2026-10-08(9판)에 더했다 — CLI 가 끝났다(`/exit` · Ctrl+D). tmux 타일은 셸 복귀
/// 표식(OSC 133 `A`)이 없어 CLI 를 나가도 세션 끝까지 AI 로 보였다. `/clear` 도 이 훅을 부르지만(`reason: "clear"`)
/// CLI 는 그대로 돌므로 스크립트가 그 갈래는 보내지 않는다. 매처는 싣지 않는다(= 모든 까닭).
///
/// `SessionStart` → `session` 은 2026-10-17(10판)에 더했다 — 대화 id 를 싣는 **연결 전용** 신호다(상태 점을 바꾸지 않는다 ·
/// `crate::agent_state::apply`). 대화 id 를 싣는 훅이 `UserPromptSubmit` · `Stop` 뿐이라, 셸에서 친 `claude --resume`/`-c` ·
/// CLI 안의 `/resume` · `/clear` 뒤에는 다음 프롬프트까지 타일 ↔ 대화 연결이 없었다(AI 타일의 대화 면이 비었다). Claude 는
/// 입력에 `source`(startup · resume · clear · compact)와 `session_id` 를 싣는다 — compact 는 같은 대화라 무해하고, clear · resume
/// 은 새 id 로 갈아 끼운다. 매처는 싣지 않는다(= 모든 source). **Codex 에는 걸지 않는다** — 0.166 실측(2026-11-02 · 노트
/// `docs/log/2026-11-01-tile-permission-hook-probe.md` 13절): Codex 의 `SessionStart` 는 **첫 사람 말이 들어갈 때** 한 번(`source: "startup"`)
/// 불리고 기동 · TUI 안 `/resume` · `/new` · `/clear` · `codex resume --last` 만으로는 불리지 않는다 — 대화 id 를 그 시점에 실어 오는
/// `UserPromptSubmit`(`start`)보다 얻는 것이 없다. 오케스트레이션 1b 의 "기동 때 멈춤" 은 새 훅 항목의 신뢰 화면("Hooks need review")이었다
/// (같은 실측 — 새 항목이면 그 화면이 서고 Trust all 뒤에는 멈추지 않는다).
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

/// Codex CLI — `$CODEX_HOME/hooks.json`(없으면 `~/.codex`). 0.157.1 에서 확인한 이벤트만 싣는다 —
/// 확인하지 않은 이름이 파일 전체를 깨뜨릴 수 있다. 승인 물음은 `Notification` 이 아니라
/// `PermissionRequest` 라 범주 `permission` 을 **인자로 박는다**. 매처는 싣지 않는다(= 모든 도구).
///
/// `SubagentStart`·`SubagentStop` 은 2026-10-04 에 더했다 — Codex hooks 문서의 이벤트 표에 있고(입력에
/// `agent_id`), 설치된 0.160.0 실행 파일의 이벤트 이름 표(serde 변형 목록)에도 두 이름이 있다. 2026-10-21 에
/// 0.163.0 을 실제로 돌려 확인했다(서브 에이전트가 끝나면 `SubagentStop` 만 오고 `Stop` 은 메인 턴 끝에 한 번) —
/// docs/log/2026-10-04-subagent-signals.md 의 "10-21 실측" 절.
///
/// `SessionEnd` 는 2026-10-08(9판)에 더했다 — 0.161 의 사건 표(`SessionStart/End` …, docs/log/2026-10-08-codex-remote-hooks.md).
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

/// Claude Code 의 처리기 — 셸을 가리지 않는 한 줄 하나(Claude Code 는 훅을 셸로 돌린다 — Git Bash 든
/// cmd 든 `"<경로>" <이벤트>` 의 `.cmd` 가 돈다, 실기 확인).
fn claude_handler(script: &str, ev: &HookEvent, _windows: bool) -> Value {
    json!({ "type": "command", "command": hook_command(script, "claude", ev), "timeout": HOOK_TIMEOUT_SECS })
}

/// Codex 의 처리기. Windows 는 `commandWindows` 를 쓰는데, Codex(0.157)는 이 글자를 **셸로 돌리지 않고**
/// 스스로 토막 내 첫 토막을 프로그램으로 띄운다 — 첫 토막이 따옴표로 시작하면(`"C:/…/x.cmd" start`)
/// "exited with code 1" 로 실패하고 스크립트는 돌지 않는다(2026-09-26 실측). 그래서 첫 토막을 맨
/// `cmd.exe` 로 두고 경로는 **뒤 토막에서** 역슬래시로 인용한다 — 경로에 공백이 있어도 돈다.
/// Windows 빌드에서는 `command` 도 같은 줄이다(그 OS 에서는 읽히지 않는다). `.sh`(원격 · 다른 OS)면
/// `command` 만, 셸 한 줄 그대로.
fn codex_handler(script: &str, ev: &HookEvent, windows: bool) -> Value {
    if windows {
        let path = script.replace('/', "\\");
        let cmd = format!("cmd.exe /d /c \"{path}\" {}", hook_args("codex", ev));
        json!({ "type": "command", "command": cmd, "commandWindows": cmd, "timeout": HOOK_TIMEOUT_SECS })
    } else {
        json!({ "type": "command", "command": hook_command(script, "codex", ev), "timeout": HOOK_TIMEOUT_SECS })
    }
}

/// Claude Code 사용자 설정 파일 — `~/.claude/settings.json`.
fn claude_settings_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("settings.json"))
}

/// Codex 훅 파일 — `$CODEX_HOME/hooks.json`, 비어 있으면 `~/.codex/hooks.json`.
fn codex_hooks_path() -> Option<PathBuf> {
    let home = match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(h) => PathBuf::from(h),
        None => dirs::home_dir()?.join(".codex"),
    };
    Some(home.join("hooks.json"))
}

/// 에이전트 표. 순서 = 설정 › AI 의 줄 순서 · 메뉴 항목 순서.
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
        // 다시 켬(2026-09-26): 공용 데몬 안에서 도는 훅은 데몬을 띄운 터미널의 환경을 받아 신호가 틀린 타일로
        // 갔다. aynx 이 띄우는·타일에서 친 codex 는 이제 `--no-daemon` 으로 돌아(`crate::codex_launch` · 셸 통합의
        // 감싸개) 훅이 그 타일의 환경을 받는다 — docs/log/2026-09-26-codex-hooks.md "다시 켬 — --no-daemon".
        available: true,
    },
];

/// id → 표의 줄(숨긴 줄 포함). 모르는 id 는 실패. 시험·공용 스크립트 판정이 쓴다 — 명령은 [`usable_target`].
fn target(id: &str) -> Result<&'static HookTarget, String> {
    TARGETS
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"))
}

/// 명령이 받는 id → 표의 줄. 숨긴 줄([`HookTarget::available`])은 **거절**한다 — 화면에 없으니 옛 호출부나
/// 손으로 부른 명령만 닿는 길이고, 거기서도 설치되면 안 된다(신호가 틀린 타일로 간다).
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

// ---------------------------------------------------------------------------
// 공용 스크립트
// ---------------------------------------------------------------------------

/// 스크립트 판 번호 — 두 스크립트의 `aynx-hook-version: N` 줄과 같아야 한다(테스트가 본다). 글자를
/// 바꾸면 올린다. 판정 자체는 **내용 비교**다([`refresh_at`] — 앱이 뜰 때 다르면 갈아 쓴다) — 이
/// 줄은 사람(과 원격 파일을 들여다볼 누군가)이 "어느 판이 깔렸나" 를 읽는 표식이다.
///
/// - 1 — 이벤트 이름 하나만 쏜다(2026-09-24).
/// - 2 — `waiting` 에 **범주**를 싣는다(`detail`: `permission` · `idle` · `other` — 2026-09-25,
///   docs/log/2026-09-25-shell-claude-signals.md).
/// - 3 — **둘째 인자가 있으면 그것이 범주**다(`aynx-agent-signal waiting permission` — 2026-09-26,
///   docs/log/2026-09-26-codex-hooks.md). 등록할 때 범주를 아는 에이전트(Codex `PermissionRequest`)는
///   인자로 박고, 표준 입력 판정은 인자가 없을 때만(Claude `Notification`) 돈다. 값은 거르지 않고
///   넘긴다 — 엔드포인트가 [`crate::agent_signal::WAITING_DETAILS`] 로 거른다.
/// - 4 — `start`·`stop` 에 **대화 id**(`session`)를 싣는다(2026-09-26, docs/log/2026-09-26-agent-sessions.md).
///   훅 입력 JSON 에서 `"session_id"` 뒤의 36자만 떼어 16진수·`-` 인지 보고 싣는다 — `UserPromptSubmit`
///   의 입력에는 **프롬프트 원문**이 들어 있지만 그 글자는 한 자도 보내지 않는다. `.cmd` 는 입력의 첫 줄
///   1023자만(`set /p`) 읽는다 — 훅 입력은 한 줄 JSON 이고 `session_id` 가 첫 키다.
/// - 5 — 모든 신호에 **판 번호**(`"v":5`)를 싣는다(2026-09-27, docs/log/2026-09-27-remote-hook-version.md).
///   로컬 사본은 앱이 뜰 때 갈아 쓰지만 **원격 사본은 아무도 갈아 쓰지 않는다** — 엔드포인트가 이 수를
///   이벤트에 실어 보내고([`crate::agent_signal::AgentSignal::payload`]), 화면이 옛 판(없음 = 4판 이하)에서
///   "다시 설치" 알림을 한 번 띄운다. 스크립트 글자의 수와 이 상수가 맞는지는 테스트가 본다.
/// - 6 — `subagent-start`·`subagent-stop` 에 **서브 에이전트 id**(`agent`)를 싣는다(2026-10-04,
///   docs/log/2026-10-04-subagent-signals.md). 입력의 첫 줄에서 `"agent_id"` 뒤 따옴표 안의 값만 떼어
///   영숫자·`_`·`-` 64자 이하일 때만 싣는다 — 작업 설명(`task`)·마지막 메시지는 한 글자도 보내지 않는다.
///   `.cmd` 는 첫 줄 1023자만 읽는다: 문서의 입력 예에서 `agent_id` 는 공통 칸(`session_id` · `prompt_id` ·
///   `transcript_path` · `cwd` · `hook_event_name`)과 `agent_type` 바로 뒤, 긴 글자(`task` ·
///   `last_assistant_message`) **앞**에 온다. 못 읽으면 id 없이 보내고 화면은 세지 않는다(안전한 쪽).
/// - 7 — 제품 이름이 바뀌며(2026-10-05) 읽는 환경변수 이름과 파일 이름이
///   바뀌었다. 본문은 6판과 같다.
/// - 8 — 모든 신호에 **어느 CLI 인지**(`"cli":"claude"|"codex"`)를 싣는다(2026-10-08). 값은 설치기가 명령에 박는
///   **둘째 인자**다(`"<스크립트>" start codex` · `… waiting codex permission`) — 둘째 인자가 `claude`·`codex` 면 그것이
///   CLI 이고 범주는 셋째로 밀린다. 그 밖이면 예전처럼 둘째가 범주다(옛 등록 `waiting permission` 이 새 스크립트를
///   불러도 그대로 돈다). 화면은 이 값으로 **아직 AI 로 분류되지 않은 타일**(tmux 안에서 손으로 띄운 `codex` —
///   제목이 폴더 이름이라 못 알아본다)을 그 CLI 의 타일로 친다(신호 토큰은 그 타일의 스트림에만 통하므로 근거가 된다 ·
///   `src/lib/app/agent-status.svelte.ts` 의 `agentSignal`). 환경변수 대신 인자인 까닭: Claude 의 처리기는 셸(Git Bash
///   또는 cmd)로, Codex 의 Windows 처리기는 맨 `cmd.exe` 로 돈다 — `VAR=x cmd` 앞붙임은 cmd 에서 안 서고, 인자 한
///   낱말은 셋 다에서 같다.
/// - 9 — 두 가지(2026-10-08, 세션 서버 설계 ①b). (1) **원격 타일의 주소·토큰을 서버 파일에서 읽는다**: `AYNX_MCP_URL`
///   이 환경에 없으면 `$HOME/.config/aynx/signal/<스트림>.env`(앱이 접속마다 SFTP 로 갈아 쓰는 0600 파일 —
///   `crate::remote_signal_file`)에서 두 키만 읽는다(소스하지 않는다 — 줄마다 키를 견주고, 주소는 `http://127.0.0.1:<포트>`
///   모양 · 둘 다 영숫자와 `:/.` 만일 때만 쓴다). 환경변수가 있으면 그것이 먼저다(로컬 타일 · 옛 export 방식). 그래서 tmux
///   재접속 뒤에도 이미 떠 있던 CLI 가 다음 훅에서 새 포트·새 토큰을 탄다. (2) `session-end`(`SessionEnd` 훅)를 보낸다 — 대화
///   id 를 싣고, 입력의 까닭이 `clear` 면(`/clear` — CLI 는 그대로 돈다) 보내지 않는다. `.cmd` 는 (2)만(로컬 타일은 늘 환경변수다).
/// - 10 — `session`(Claude `SessionStart` 훅)을 보낸다(2026-10-17) — `start`·`stop` 과 같은 길로 대화 id 만 뗀다. 상태 점은 바꾸지
///   않고 타일 ↔ 대화 연결만 갱신한다(AI 타일의 대화 면 — `/resume` · `/clear` · `claude --resume` 뒤에도 곧바로).
/// - 11 — 제품 이름이 AYNX 로 바뀌며(2026-10-22, docs/log/2026-10-22-rename-aynx.md) 읽는 환경변수가
///   `AYNX_*`, 파일 이름이 `aynx-agent-signal.*`, 원격 신호 파일이 `~/.config/aynx/signal/` 로 바뀌었다. 본문은 10판과 같다.
/// - 12 — **Claude 안에서 뜬 Codex 는 그 타일의 서브 에이전트로 보낸다**(2026-11-06). AI 타일의 Claude Code 가 Bash 로
///   `codex exec` 를 띄우면 Codex 가 타일의 `AYNX_*` 를 물려받아 자기 전역 훅으로 같은 스트림에 `start(session=Codex id, cli=codex)
///   → tool → tool-done → stop → session-end` 를 보냈다 — Claude 가 일하는 중에 완료 · 알림이 서고, `session-end` 가 상태 표 항목과
///   Claude 의 서브 에이전트 집합을 지웠다. 판정은 **둘째 인자 `codex` + 환경의 `CLAUDECODE` 가 비어 있지 않음**이다(Claude 의 자식
///   프로세스에 있고 타일 셸에서는 앱이 걷는다 — `crate::pty` 의 `PARENT_AGENT_ENV`. Claude 훅은 늘 `CLAUDECODE` 가 있으니 `codex` 조건이
///   필수이고, 옛 등록(둘째 인자가 범주)은 CLI 가 없어 중첩이 아니다). 중첩이면 `start` → `subagent-start` · `session-end` →
///   `subagent-stop`(`agent` = 입력의 `session_id` · `session` 칸 없음 · 까닭이 `clear` 면 전처럼 안 보냄) · `stop` · `session` 은 보내지
///   않음 · 나머지는 이벤트 그대로 — 어느 쪽이든 `cli` 칸은 뺀다. 앱 쪽 Rust · 프런트는 그대로다.
/// - 13 — **Codex 의 셸 도구로 띄운 Claude · Codex** 도 같은 변환을 한다. 둘째 인자가 `claude`·`codex` 이고
///   `CODEX_THREAD_ID` 가 비어 있지 않으면 중첩이다(2026-11-06 Codex 셸에서 이름 확인). Codex 0.166.0 소스에서
///   `protocol/src/shell_environment.rs` 는 셸 자식 환경에 이 이름을 넣지만, `hooks/src/registry.rs` 의 `Hooks::new` 는
///   부모 프로세스 환경만 복사하고 `hooks/src/engine/command_runner.rs` 는 그 스냅샷을 재생한다 — 최상위 훅 자체에는
///   자기 thread id 를 환경으로 넣지 않는다. 따라서 Codex 안의 Codex 도 부모 셸의 표지를 물려받은 경우로 가른다.
///   근거: https://github.com/openai/codex/tree/rust-v0.166.0/codex-rs (위 세 파일). 타일은 이미 `PARENT_AGENT_ENV` 로
///   이 이름을 걷는다. Claude 는 매 `UserPromptSubmit` 이 `start` 다 — 같은 session_id 의 재시작은 `agent_state::apply` 가
///   중복을 막는다. 표지를 지우거나 기존 데몬이 다른 환경을 쓰면 판정할 수 없다. Claude 안의 Claude 는 여전히 범위 밖이다.
pub(crate) const SCRIPT_VERSION: u32 = 13;

/// Windows 스크립트. **ASCII 만** 쓴다 — cmd 는 배치 파일을 OEM 코드페이지로 읽어 UTF-8 한글
/// 주석이 뒷줄 파싱을 깨뜨릴 수 있다. 줄바꿈은 CRLF(아래 [`script_file`]).
///
/// - 토큰은 `curl -K -`(설정을 표준 입력으로)로 넘긴다 — 명령줄(argv)에 싣지 않는다.
/// - 토큰은 신호 전용(`AYNX_SIGNAL_TOKEN`)이 먼저, 없으면 MCP 토큰 — 이 판 전에 연 타일에는 신호
///   토큰이 없다.
/// - 둘째 인자(`%~2`)가 있으면 그것이 범주다(3판). 없고 `waiting`(Claude `Notification` 훅)이면 훅
///   입력 JSON(표준 입력)을 `findstr` 로 한 번 읽어 **범주 하나**만 고른다 — `notification_type` 이
///   있으면 그것(`permission_prompt` → `permission` · `idle_prompt` → `idle` · 그 밖 `other`), 없으면
///   (옛 Claude Code) 알림 문구로(`needs your permission` · `waiting for your input`). 문구 자체는
///   **싣지 않는다**. 입력은 지연 확장(`!VAR!`)으로만 다룬다 — 따옴표·`&`·`|`·`%` 가 든 JSON 이
///   `if` 의 구문을 깨지 않는다.
/// - `start`·`stop` 이면(4판) 입력의 첫 줄을 `set /p` 로 읽어 `"session_id"` 뒤 36자를 떼고, 그 글자가
///   16진수·`-` 뿐일 때만 `session` 으로 싣는다(글자 검사를 지난 값만 `%…%` 확장으로 나간다 — 명령 줄을
///   깰 글자가 남지 않는다). 모양(`8-4-4-4-12`)은 엔드포인트가 다시 본다.
/// - `subagent-start`·`subagent-stop` 이면(6판) 같은 첫 줄에서 `"agent_id"` 뒤 첫 따옴표부터 다음 따옴표
///   앞까지(`for /f` 의 `"` 구분)를 떼고, `0-9 a-z _ -`(치환은 대소문자를 가리지 않는다)를 지워 남는 것이
///   없고 64자 이하일 때만 `agent` 로 싣는다.
/// - 모든 출력을 버린다: `UserPromptSubmit` 훅의 표준 출력은 Claude Code·Codex 가 **프롬프트 문맥에
///   덧붙인다**. 한 글자라도 새면 모델이 읽는다.
/// - 무엇이 실패해도 `exit /b 0` — 훅의 실패가 에이전트의 턴을 막지 않게.
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

/// POSIX 스크립트 — `.cmd` 와 같은 규칙(토큰은 `-K -` · 둘째 인자가 범주 · 없으면 `waiting` 만 입력에서
/// 범주 · 출력 버림 · 늘 0). **원격 설치도 이 글자를 그대로 쓴다**([`remote_install_command`]) — 그래서
/// Windows 빌드에서도 쓰인다. `curl` 이 없는 서버에서는 조용히 0 이다(신호가 없을 뿐 에이전트는 멀쩡하다).
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

/// 이 OS 의 스크립트 — `(파일 이름, 내용)`. **OS 를 타는 곳은 이 함수 하나다.** 처리기가 `.cmd` 인지
/// 아닌지는 여기서 고른 파일 이름으로 읽는다([`is_cmd`]).
///
/// Windows 는 `.cmd`(CRLF). 그 밖(Linux·macOS)은 `.sh`(LF, 실행 비트는 [`write_script`] 가 켠다).
/// Claude Code 가 훅 명령을 Git Bash 로 돌리든 cmd 로 돌리든 `.cmd` 는 둘 다에서 실행된다.
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

/// 스크립트 경로(명령 글자)가 Windows `.cmd` 인가 — Codex 가 `commandWindows` 를 싣는 기준.
fn is_cmd(script: &str) -> bool {
    script.to_ascii_lowercase().ends_with(".cmd")
}

/// 스크립트를 둘 폴더 — `<config_dir>/aynx/hooks`.
fn script_dir() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("hooks"))
}

/// 이 PC 의 스크립트 경로 → 훅 명령에 넣을 글자. 역슬래시는 `/` 로 바꾼다(bash 는 따옴표 안에서도
/// `\` 를 이스케이프로 읽을 수 있지만, `/` 는 bash·cmd 모두 경로로 받는다).
fn command_path(script: &Path) -> String {
    script.to_string_lossy().replace('\\', "/")
}

/// 훅 명령 한 줄 — `"<스크립트 경로>" <이벤트> <CLI> [범주]`. **셸을 가리지 않는 한 줄**이다: 경로는
/// 따옴표로 감싼다. `script` 는 이미 명령용 글자다([`command_path`] · 원격은 [`REMOTE_SCRIPT_CMD`] —
/// `$HOME` 이 큰따옴표 안에서 펴진다). `cli` 는 표의 id(`claude`·`codex` — 8판, [`SCRIPT_VERSION`]).
fn hook_command(script: &str, cli: &str, ev: &HookEvent) -> String {
    format!("\"{script}\" {}", hook_args(cli, ev))
}

/// 스크립트 인자 — `<이벤트> <CLI> [범주]`. 처리기 둘(셸 한 줄 · Codex 의 맨 `cmd.exe`)이 같은 글자를 쓴다.
fn hook_args(cli: &str, ev: &HookEvent) -> String {
    match ev.detail {
        Some(d) => format!("{} {cli} {d}", ev.event),
        None => format!("{} {cli}", ev.event),
    }
}

/// 처리기가 우리 것인가 — 명령 칸(`command`·`commandWindows` … 문자열 칸 전부) 어디든 스크립트 이름이
/// 있으면(경로가 바뀌었어도 알아본다). 칸 이름을 에이전트마다 알 필요가 없게 문자열 칸을 다 본다.
fn is_ours(handler: &Value) -> bool {
    handler.as_object().is_some_and(|o| {
        o.values().any(|v| {
            v.as_str().is_some_and(|s| s.contains(SCRIPT_STEM))
        })
    })
}

/// 이벤트마다 더할 **매처 묶음 하나** — 확인 창의 미리보기·설치·상태 판정이 같은 것을 쓴다.
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

/// 확인 창에 보일 JSON — `{"hooks": {이벤트: [묶음]}}` 꼴, 2칸 들여쓰기.
fn preview(t: &HookTarget, script: &str) -> String {
    let mut hooks = Map::new();
    for (hook, group) in our_groups(t, script) {
        hooks.insert(hook.into(), json!([group]));
    }
    serde_json::to_string_pretty(&json!({ "hooks": hooks })).unwrap_or_default()
}

/// `root.hooks` 에서 **우리 항목만** 뺀다. 무엇이든 뺐으면 true. 에이전트를 가리지 않는다(모양이 같다).
///
/// 묶음 안의 `hooks` 배열에서 우리 명령을 빼고, 그래서 **비게 된** 묶음·이벤트 배열·`hooks` 객체만
/// 지운다 — 원래부터 비어 있던 것은 사용자의 것이라 그대로 둔다.
fn remove_from(root: &mut Value) -> bool {
    remove_where(root, is_ours)
}

/// [`remove_from`] 의 몸통 — `pred` 가 참인 처리기만 뺀다(로컬 자동 갱신은 **이 인스턴스의** 항목만 뺀다).
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
            !inner.is_empty() // 우리가 비운 묶음만 지운다
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

/// 우리 처리기가 하나라도 있는가 — 에이전트를 가리지 않는다(공용 스크립트를 지워도 되나 볼 때).
fn has_ours(root: &Value) -> bool {
    remove_from(&mut root.clone())
}

/// `root.hooks` 에 우리 묶음을 넣는다 — 먼저 우리 것을 전부 빼므로 멱등이다. `root` 는 객체여야
/// 한다(부르는 쪽 [`parse_settings`] 가 보장한다). **로컬·원격이 같은 이 함수를 쓴다** — `script` 만
/// 다르다.
fn install_into(t: &HookTarget, root: &mut Value, script: &str) {
    remove_from(root);
    add_groups(t, root, script);
}

/// 우리 묶음을 더하기만 한다 — 빼는 일은 부르는 쪽이 먼저 한다([`install_into`] · [`refresh_entries`]).
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

/// 설치 상태 — 모든 이벤트에 **지금 모양 그대로의** 우리 처리기가 있으면 `Full`, 하나라도 우리 처리기가
/// 있으면 `Partial`(옛 경로·손으로 지운 일부·다섯째 전의 네 벌·옛 모양), 없으면 `None`.
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

/// 설정 파일의 글자 → 값 (**순수 함수**) — 없거나(`None`) 비어 있으면 빈 객체. **깨졌거나 객체가
/// 아니면 실패**(덮어쓰지 않는다). `shown` 은 문구에 넣을 경로다. 로컬·원격이 같이 쓴다.
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

/// 설정 파일을 읽는다 — `(값, 파일이 있었나)`. 없으면 빈 객체, 판정은 [`parse_settings`].
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

/// 스크립트를 쓴다(내용이 같으면 건드리지 않는다) — 경로를 돌려준다.
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

/// **앱이 뜰 때** — 이미 설치된 스크립트가 이 판과 다르면 갈아 쓴다(돌려주는 값: 갈아 썼는가).
///
/// 설치된 스크립트는 **사본**이라 앱을 새 판으로 올려도 옛 글자가 남는다(예: 1판 스크립트는
/// `waiting` 에 범주를 싣지 않아 권한 물음 알림이 영영 오지 않는다). 파일이 **있을 때만** 쓴다 —
/// 없으면 설치하지 않은 사람이거나 제거한 사람이다. 에이전트의 설정 파일은 **건드리지 않는다**
/// (훅 항목은 스크립트 경로와 인자뿐이라 판이 바뀌어도 그대로 맞다). 이미 떠 있는 에이전트도 훅마다
/// 이 파일을 새로 실행하므로 다음 훅부터 새 글자를 탄다. 스크립트는 에이전트 공용이라 한 벌이다.
fn refresh_at(dir: &Path) -> Result<bool, String> {
    let (name, want) = script_file();
    let path = dir.join(name);
    match std::fs::read_to_string(&path) {
        Ok(have) if have == want => Ok(false),
        Ok(_) => write_script(dir).map(|_| true),
        // 없다(설치 안 함 · 제거함) — 만들지 않는다. 못 읽는 그 밖의 경우도 건드리지 않는다.
        Err(_) => Ok(false),
    }
}

/// [`refresh_at`] 을 앱 폴더에서 — `lib.rs` 의 `setup` 이 블로킹 풀에서 한 번 부른다. 실패는 조용히
/// 넘긴다(훅 신호가 옛 모양으로 올 뿐이고, 사용자가 [다시 설치…] 로 바로잡을 수 있다).
pub(crate) fn refresh_installed_script() {
    if let Some(dir) = script_dir() {
        let _ = refresh_at(&dir);
    }
}

/// 처리기가 **이 인스턴스의** 스크립트(`script` — [`command_path`] 글자)를 가리키는가. 칸마다 역슬래시를 `/` 로,
/// 대소문자를 접어 본다(Codex 의 Windows 처리기는 경로를 역슬래시로 싣는다). 경로 전체(파일 이름까지)를 보므로
/// 릴리스 `…/aynx/hooks/…` 와 개발 `…/aynx-dev/hooks/…` 는 서로를 품지 않는다.
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

/// 이 인스턴스의 항목이 하나라도 있는가.
fn has_mine(root: &Value, script: &str) -> bool {
    remove_where(&mut root.clone(), |h| is_mine(h, script))
}

/// 로컬 자동 갱신의 판정 결과.
#[derive(Debug, PartialEq, Eq)]
enum Refresh {
    /// 손대지 않음 — 우리 항목이 없거나(설치 안 함 · 제거함) 이미 지금 모양.
    Untouched,
    /// 우리 항목은 있지만 **다른 인스턴스**(릴리스↔개발)의 것뿐 — 손대지 않음.
    Foreign,
    /// 이 인스턴스의 항목을 지금 모양으로 갈아 씀.
    Changed,
}

/// 설정 값 하나의 **이 인스턴스가 심은 항목만** 지금 모양으로 맞춘다 (**순수 함수**). "내가 심은 것만 내가 갱신" —
/// 릴리스와 개발(`instance.rs`, docs/log/2026-09-26-dev-release-isolation.md)은 `script_dir()` 가 달라, 남의 경로를
/// 내 경로로 바꾸면 두 앱이 켜질 때마다 사용자 설정을 서로 되돌린다(그리고 개발 폴더가 사라지면 릴리스 훅이 죽는다).
/// 그래서 다른 인스턴스 항목만 있으면 아무것도 쓰지 않고(`Foreign`), 섞여 있으면 내 것만 빼고 새 묶음을 넣는다 —
/// 남의 항목·사용자 항목·다른 키는 그대로. 이미 지금 모양 한 벌이면(`Full`) 건드리지 않는다.
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

/// [`refresh_entries`] 를 파일에. 깨진 설정은 손대지 않고 실패한다(로그 한 줄로 끝 — 설정 › AI 의 "다시 설치"
/// 권유가 남는다). 갈아 쓸 때만(`Changed`) 스크립트도 이 판으로 쓰고 설정을 쓴다(항목이 가리킬 파일).
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

/// 로컬 자동 갱신의 안내 한 건 (camelCase) — 신뢰 단계가 있는 에이전트(Codex)를 갈아 썼을 때만.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRefreshNotice {
    pub agent: &'static str,
    pub version: u32,
}

/// 앱 수명에 한 번 — 이 PC 의 에이전트 설정에서 우리 항목만 새 등록 모양으로(모듈 머리말 "우리 항목만 자동 갱신").
static LOCAL_ONCE: std::sync::Once = std::sync::Once::new();
/// 아직 화면이 가져가지 않은 안내.
static LOCAL_NOTICES: std::sync::Mutex<Vec<LocalRefreshNotice>> = std::sync::Mutex::new(Vec::new());

/// 로컬 우리 항목 자동 갱신 — `lib.rs` 의 `setup` 이 블로킹 풀에서, 그리고 [`agent_hooks_take_local_refresh`] 가
/// 부른다(먼저 닿은 쪽이 한 번 돌리고, 늦게 닿은 쪽은 끝날 때까지 기다린다).
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

/// 부팅한 창(주 창)이 한 번 부른다 — 자동 갱신을 (아직이면) 마치고 신뢰 안내를 **한 번만** 건넨다(그 뒤는 빈 목록).
/// 이벤트가 아닌 까닭: 갱신은 창이 듣기 전(`setup`)에 끝날 수 있다.
#[tauri::command]
pub async fn agent_hooks_take_local_refresh() -> Vec<LocalRefreshNotice> {
    tauri::async_runtime::spawn_blocking(|| {
        refresh_local_entries_once();
        std::mem::take(&mut *LOCAL_NOTICES.lock().unwrap_or_else(|p| p.into_inner()))
    })
    .await
    .unwrap_or_default()
}

/// 설치 — 스크립트를 쓰고 설정에 우리 묶음을 넣는다. 설정이 깨져 있으면 **스크립트도 쓰지 않고**
/// 실패한다(반쯤 된 설치를 남기지 않는다). 병합 결과가 읽은 것과 같으면 설정 파일을 **쓰지 않는다**.
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

/// 제거 — 설정에서 우리 항목만 빼고(바뀐 게 있을 때만 쓴다) 스크립트 파일도 지운다. 스크립트는
/// 에이전트 공용이지만, **다른 에이전트의 설정에 우리 항목이 남아 있으면** 지우지 않는다(그쪽 신호가 끊긴다).
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

/// 설정 › AI 가 그리는 상태 (camelCase). 원격 상태([`agent_hooks_remote_status`])도 같은 모양이다 —
/// 경로 둘이 서버의 것(`~/…`)일 뿐.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// 모든 이벤트에 지금 경로의 우리 처리기가 있다.
    pub installed: bool,
    /// 우리 처리기가 일부만 있다(옛 경로 · 손으로 지운 일부) — 다시 설치하면 한 벌로 맞춰진다.
    pub partial: bool,
    /// 그 에이전트의 훅 설정 파일 전체 경로(확인 창에 그대로 보인다).
    pub settings_path: String,
    /// 우리 스크립트 전체 경로.
    pub script_path: String,
    /// 설치가 더할 JSON(확인 창에 그대로 보인다).
    pub preview: String,
    /// 설정 파일을 못 읽었다 — 깨진 JSON 등. 있으면 설치는 손대지 않고 실패한다.
    pub error: Option<String>,
}

/// 읽은 결과 하나 → 화면이 그리는 상태 (**순수 함수**) — 로컬·원격이 같이 쓴다.
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

/// 설정 › AI 가 줄을 그릴 표 한 줄 (camelCase).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookTargetInfo {
    pub id: &'static str,
    pub display: &'static str,
    pub needs_trust_note: bool,
}

/// 에이전트 표 — 화면이 줄·메뉴 항목을 이 목록으로 그린다(에이전트를 손으로 적지 않는다). 메모리만
/// 읽지만 "애매하면 async" 규칙대로 async 다.
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

/// 지금 설치 상태 — 파일을 읽으므로 async + 블로킹 풀 (docs/conventions.md "Tauri 명령은 기본 async").
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

/// 설치 — 사용자가 확인 창에서 [설치] 를 누른 뒤에만 불린다. 끝나면 새 상태를 돌려준다.
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

/// 제거 — 우리 항목만 뺀다. 끝나면 새 상태를 돌려준다.
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

// ---------------------------------------------------------------------------
// 원격 설치 (docs/log/2026-09-24-remote-agent-signals.md "원격 훅 설치")
//
// 프로젝트 메뉴의 "원격에 <에이전트> 훅 설치…" / "원격 <에이전트> 훅 제거" — **그 호스트에 붙은
// 세션**의 전송로로 exec 왕복(`crate::ssh::run_exec` — 화면을 건드리지 않는다)을 한다. 병합은 로컬과
// **같은 순수 함수**이고, 서버로 나가는 명령 글자는 전부 여기서 짓는다(프런트는 세션 id 와 에이전트
// id 만 넘긴다). 값은 하나도 셸에 날것으로 가지 않는다 — 경로는 표의 고정 셸 글자 + `sh_quote`,
// 내용은 `sh_quote`.
// ---------------------------------------------------------------------------

/// 서버의 스크립트 폴더 · 파일 (화면·`sh_path` 용).
const REMOTE_SCRIPT_DIR: &str = "~/.config/aynx/hooks";
const REMOTE_SCRIPT: &str = "~/.config/aynx/hooks/aynx-agent-signal.sh";
/// 훅 **명령 안의** 스크립트 경로 — 에이전트가 훅을 `sh -c` 로 돌릴 때 큰따옴표 안의 `$HOME` 은
/// 펴지고 `~` 는 펴지지 않는다. 그래서 명령에는 `~` 가 아니라 `$HOME` 을 쓴다.
const REMOTE_SCRIPT_CMD: &str = "$HOME/.config/aynx/hooks/aynx-agent-signal.sh";
/// 같은 스크립트의 **SFTP 경로**(로그인 폴더 = 홈 기준 상대) — 신호 파일을 쓰는 접속이 이미 깔린 옛 판을 맞출 때
/// (`crate::remote_signal_file::write` — 로컬의 [`refresh_installed_script`] 와 같은 규칙: 있을 때만 갈아 쓴다).
pub(crate) const REMOTE_SCRIPT_SFTP: &str = ".config/aynx/hooks/aynx-agent-signal.sh";

/// 원격에 까는 스크립트 글자(9판부터 신호 파일을 읽는다) — `crate::remote_signal_file` 이 옛 사본을 맞출 때.
pub(crate) fn remote_script_body() -> &'static str {
    SH_SCRIPT
}

/// "설정 파일이 없다" 를 알리는 종료 코드 — [`remote_read_command`] 가 `exit` 로 낸다.
const REMOTE_MISSING_EXIT: i64 = 3;

/// 원격 한 걸음의 시한 — 사람이 메뉴를 누르고 기다리는 자리다.
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// 한 exec 명령의 상한(바이트) — sshd 는 명령을 `sh -c <명령>` 의 **인자 하나**로 넘기고, 리눅스는
/// 인자 하나를 128 KiB(`MAX_ARG_STRLEN`)에서 자른다. 넉넉히 아래에서 막는다(보통의 설정 파일은 몇 KB).
const REMOTE_COMMAND_MAX: usize = 100 * 1024;

/// 서버의 설정 파일 — 셸 글자(`<폴더>/'<파일>'`).
fn remote_file_sh(t: &HookTarget, suffix: &str) -> String {
    format!(
        "{}/{}",
        t.remote_dir_sh,
        crate::ssh::sh_quote(&format!("{}{suffix}", t.remote_file))
    )
}

/// 서버의 설정 파일을 읽는 명령 — 없으면 [`REMOTE_MISSING_EXIT`] 로 끝난다(**순수 함수**).
fn remote_read_command(t: &HookTarget) -> String {
    let f = remote_file_sh(t, "");
    format!("if [ -e {f} ]; then cat -- {f}; else exit {REMOTE_MISSING_EXIT}; fi")
}

/// 설정 JSON 을 **통째로 갈아 끼우는** 명령 조각 — 옆 임시 파일에 쓰고 `mv -f` 한다(쓰다 끊겨도 반쪽
/// 파일이 남지 않는다). 폴더가 없으면 만든다.
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

/// 설치 명령 (**순수 함수**) — `existing` 은 읽은 설정(없으면 `None`). 깨진 파일이면 **아무것도 쓰지
/// 않고** 실패한다(로컬과 같은 규칙 · 스크립트도 쓰지 않는다). 병합 결과가 읽은 것과 같으면 설정은
/// 쓰지 않고 스크립트만 쓴다.
///
/// ```sh
/// mkdir -p "$HOME"/'.config/aynx/hooks' \
///   && printf '%s' '<스크립트>' > "$HOME"/'.config/aynx/hooks/aynx-agent-signal.sh' \
///   && chmod 755 "$HOME"/'.config/aynx/hooks/aynx-agent-signal.sh' \
///   && mkdir -p "$HOME"/'.claude' && printf '%s' '<JSON>' > "$HOME"/'.claude'/'settings.json.aynx-tmp' \
///   && mv -f "$HOME"/'.claude'/'settings.json.aynx-tmp' "$HOME"/'.claude'/'settings.json'
/// ```
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

/// 제거 명령 (**순수 함수**) — 우리 항목을 뺐으면 설정을 다시 쓴다. 스크립트 파일은 `keep_script`
/// (다른 에이전트가 아직 쓴다)가 아니면 지운다. 그 에이전트의 PATH 심(`crate::agent_shim`)은 늘 지운다.
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
        return Ok(rm); // 설정이 없다 — 지울 항목도 없다(파일을 만들지 않는다)
    }
    let mut root = parse_settings(t, existing, t.remote_shown)?;
    if !remove_from(&mut root) {
        return Ok(rm);
    }
    fit(t, format!("{} && {rm}", remote_settings_write(t, &root)?))
}

/// 명령이 한 인자에 들어가는가 — 넘치면 쓰지 않고 실패한다([`REMOTE_COMMAND_MAX`]).
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

/// 원격 상태 (**순수 함수**) — 읽은 결과를 로컬과 같은 모양으로.
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

/// exec 한 판 — 실패(채널·시한·종료 코드)는 서버가 준 한 줄 또는 짧은 문구다.
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

/// 서버의 설정 파일 글자 — 없으면 `None`.
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

/// 쓰기 명령을 돌린다 — 0 이 아니면 서버의 한 줄로 실패.
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

/// **원격** 설치 상태 — 살아 있는 SSH 세션 `id` 의 전송로로 설정 파일을 한 번 읽는다. 확인 창이 이
/// 값의 경로·미리보기를 그대로 보인다(로컬과 같은 모양).
#[tauri::command]
pub async fn agent_hooks_remote_status(
    id: u32,
    agent: String,
) -> Result<HooksStatus, String> {
    let t = usable_target(&agent)?;
    let handle = handle_for(id)?;
    Ok(remote_status(t, remote_read(t, handle).await))
}

/// **원격** 설치 — 사용자가 확인 창에서 [설치] 를 누른 뒤에만 불린다. 읽기 → 병합(로컬과 같은
/// 함수) → 스크립트·설정 쓰기. 끝나면 다시 읽은 상태를 돌려준다.
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

/// **원격** 제거 — 우리 항목만 뺀다. 스크립트는 다른 에이전트의 서버 설정에 우리 항목이 없을 때만 지운다
/// (못 읽으면 남긴다 — 남은 스크립트는 해가 없고, 지운 스크립트는 그쪽 신호를 끊는다).
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

// ---------------------------------------------------------------------------
// 원격 자동 설치 (2026-10-08 — docs/log/2026-09-24-remote-agent-signals.md "자동 설치")
//
// 원격 타일을 열 때(`crate::ssh::open` — 신호 포워드를 건 뒤 · 첫 입력 전 · 2026-10-26 부터 AI 타일이 아니어도) 호스트 옵션
// 에이전트 활성화(기본 켬 · `crate::sessions_meta::HostMeta::agent` — 옛 `remote_hooks`)가 켜져 있으면 메뉴 설치와 **같은
// 함수**(`remote_read` → `remote_install_command` → `remote_write`)로 심는다. 확인 창은 없다 — 호스트 폼의
// 스위치가 그 동의다(셸 통합이 "켜면 접속 때 자동" 인 것과 같은 모양). Claude Code · Codex(같은 날 넓힘 — 사용자
// 결정). Codex 는 새·바뀐 훅을 그 CLI 안의 `/hooks` 승인 뒤에야 돌린다 — 앱은 신뢰를 쓰지 않고(09-26 결정),
// 심었다는 알림에 그 안내를 붙인다(`needs_trust_note` → [`AutoInstallNotice::needs_trust`]). 헤드리스 위임 접속은
// 이 길을 지나지 않는다(사람 타일만). 실패는 접속을 막지 않는다 — 알림 한 줄(`REMOTE_AUTO_EVENT`).
// ---------------------------------------------------------------------------

/// 자동 설치 결과를 창에 알리는 이벤트 — 방송이고, 스트림이 그 창의 타일일 때만 띄운다(프런트
/// `app/remote-hooks-auto.ts`).
pub(crate) const REMOTE_AUTO_EVENT: &str = "remote-hooks-auto";

/// 자동 설치 전체(읽기 · 스크립트 확인 · 쓰기)의 상한 — 넘으면 포기하고 첫 입력을 보낸다(훅 없이 · 알림).
/// 보통은 exec 두세 번이라 1초 안이고, 셸 통합 준비와 **나란히** 돈다(`crate::ssh::open`).
pub(crate) const REMOTE_AUTO_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

/// 자동 설치를 할 에이전트들 (**순수 함수**) — `enabled` 는 호스트 옵션 **에이전트 활성화**, `agent` 는 시작 명령의
/// 에이전트 id(`crate::agent_args::agent_of_line` — 없으면 `None`). 켜져 있으면 표의 모든 줄(`available` 인 것만)이고,
/// 시작 명령의 에이전트가 맨 앞이다(그 알림이 먼저 선다). 2026-10-26 부터 **앱이 띄운 AI 타일이 아니어도** 심는다 — 손으로
/// 친 `claude` · `codex` 도 신호를 내게(신호를 세우지 않은 타일에서는 훅이 조용히 0 이다). 이미 최신이면 exec 두 번으로 끝난다.
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

/// 이미 최신인가 (**순수 함수**) — 설정에 지금 경로의 우리 항목이 다 있고 서버의 스크립트가 이 앱의 글자와
/// 같다. 하나라도 아니면 심는다(메뉴 설치와 같은 명령 — 멱등).
fn auto_up_to_date(status: &HooksStatus, script_current: bool) -> bool {
    status.installed && status.error.is_none() && script_current
}

/// 서버의 스크립트가 이 앱의 글자와 같은가 — 못 읽으면 아니다(심으면 맞춰진다).
async fn remote_script_current(handle: crate::ssh::ExecHandle) -> bool {
    let cmd = format!("cat -- {}", crate::ssh::sh_path(REMOTE_SCRIPT));
    match remote_exec(handle, cmd).await {
        Ok(out) => out.exit_code == Some(0) && !out.stdout_truncated && out.stdout == SH_SCRIPT,
        Err(_) => false,
    }
}

/// 자동 설치 한 판의 결과.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AutoInstall {
    /// 이미 최신 — 조용히.
    Current,
    /// 새로 심었거나 갱신했다.
    Installed,
    /// 못 심었다 — 까닭 한 줄.
    Failed(String),
}

/// 원격 자동 설치 — 읽기 → (최신이 아니면) 메뉴 설치와 같은 명령으로 쓰기. [`REMOTE_AUTO_BUDGET`] 안에 끝나지
/// 않으면 포기한다(쓰기는 임시 파일 → `mv -f` 라 끊겨도 반쪽 파일이 남지 않는다).
pub(crate) async fn remote_auto_install(
    t: &HookTarget,
    handle: crate::ssh::ExecHandle,
) -> AutoInstall {
    let work = async {
        let existing = remote_read(t, handle.clone()).await?;
        let status = remote_status(t, Ok(existing.clone()));
        if let Some(e) = status.error {
            return Err(e); // 깨진 설정 — 손대지 않는다(메뉴 설치와 같은 규칙)
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

/// 창에 띄울 알림 한 줄의 재료 (camelCase) — 문구는 프런트의 i18n 이 짓는다.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoInstallNotice {
    /// 그 타일의 스트림 id — 그 타일을 쥔 창에서만 띄운다.
    pub stream: String,
    pub alias: String,
    pub agent: &'static str,
    /// 심었으면 스크립트 판, 실패면 `None`.
    pub version: Option<u32>,
    /// 실패의 까닭 — 성공이면 `None`.
    pub reason: Option<String>,
    /// 심은 훅이 그 CLI 안의 승인(`/hooks`)을 받아야 도는가 — 표의 `needs_trust_note`(Codex).
    pub needs_trust: bool,
}

/// 알림을 낼까 (**순수 판정 + 한 앱 세션의 장부**) — 이미 최신이면 조용하고, 같은 호스트 · 같은 에이전트는 앱이 떠 있는
/// 동안 한 번만 알린다(성공이든 실패든). `seen` 은 `별칭(소문자) 에이전트 id` 의 장부 — 한 접속이 두 에이전트를 함께
/// 심으면(2026-10-26) Codex 의 `/hooks` 승인 안내가 Claude 알림에 가려지지 않는다.
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

/// [`auto_notice`] 의 장부 — 앱 수명 하나.
static AUTO_NOTIFIED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

/// [`auto_notice`] 를 앱 장부로 — `crate::ssh::open` 이 부른다.
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
