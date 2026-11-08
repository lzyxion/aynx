//! **에이전트 훅 신호** — 에이전트 CLI(Claude Code · Codex)의 훅이 "지금 턴이 시작됐다 / 도구를 쓴다 /
//! 손을 기다린다 / 턴이 끝났다" 를 한 줄로 알려 오는 길 (docs/log/2026-09-24-agent-hook-signals.md ·
//! Codex 는 docs/log/2026-09-26-codex-hooks.md). 설치기는 `crate::agent_hooks`.
//!
//! ## 왜 있나
//!
//! 탭의 에이전트 상태 점은 출력·벨·제목으로 **추정**한다(`src/lib/agent-status.ts`). 그런데
//! Claude Code 는 턴이 **시작될 때만** 제목을 바꾸고 기본 설정에서는 벨도 울리지 않아, 점이 가장
//! 필요한 순간(프롬프트로 돌아와 손을 기다릴 때)에 "입력 대기" 에 한 번도 닿지 못했다(2026-09-24
//! 실기 발견 ①). Claude Code 훅(`UserPromptSubmit`·`PreToolUse`·`PostToolUse`·`Notification`·`Stop`)은
//! 바로 그 순간에 셸 명령을 돌려 주므로, 그 명령이 이 엔드포인트로 한 줄을 쏘게 한다.
//!
//! ## 표면 — MCP 도구가 **아니다**
//!
//! 같은 tiny_http 서버의 **다른 경로**(`POST /agent-signal`)다. 같은 문지기(루프백 `Host` ·
//! `Origin` 거부 · Bearer 토큰)를 그대로 지나지만 JSON-RPC 도 아니고 `tools/list` 에도 없다.
//! 하는 일은 **에이전트 상태 표(`crate::agent_state` — 메모리)를 갱신하고 프런트로 UI 신호 하나를 넘기는
//! 것뿐**이다 — 작업안·세션·승인 어떤 상태도 바꾸지 않으므로 "MCP 는 읽기 전용 · 자가 승인 금지" 불변과
//! 부딪히지 않는다. 받은 것은 로그·파일에 남기지 않는다(`detail` 은 이벤트에 실려 창으로 갈 뿐이고, 표에는
//! 범주 `permission` 이었다는 시각만 남는다).
//!
//! 이 파일은 소켓을 모른다 — 본문 → [`AgentSignal`] 의 **순수 판정**과 상수, 그리고 **신호 전용
//! 토큰 표**([`SignalTokens`])만 둔다. 소켓 쪽은 **세션 서버 프로세스**의 신호 전용 포트다(`crate::server::signal_http`
//! — ③-3a, docs/internal/session-server-design-2026-10-08.md 4.4). 그래서 GUI 를 강제 종료했다 다시 켜도 살아남은
//! 셸의 토큰이 그대로 통한다(③-2 한계 1). GUI 는 파이프 op(`crate::server::signals`)로만 이 표에 닿는다.
//!
//! ## 신호 전용 토큰 — 원격 타일에 MCP 토큰을 주지 않는다
//!
//! 원격(SSH) 타일의 Claude Code 도 신호를 보내려면 서버 안의 셸이 토큰을 들고 있어야 한다
//! (docs/log/2026-09-24-remote-agent-signals.md). 그 자리에 **MCP 토큰**을 두면 원격 포워드를 타고
//! 이 PC 의 MCP 전체(세션 컨텍스트 읽기·작업안 제안)가 서버 쪽에 열린다 — 그 서버의 root, 그리고
//! `ps`·`/proc` 를 읽는 같은 서버의 다른 사용자까지. 그래서 **타일(스트림)마다 따로 뽑는 좁은
//! 토큰**을 둔다: 이 경로에서만, 그것도 **자기 스트림의 신호에만** 통한다. 세션이 열릴 때 뽑고 닫힐
//! 때 버린다([`issue`] · [`revoke`]). **로컬 타일은 모두** 같은 토큰을 받는다(`AYNX_SIGNAL_TOKEN` —
//! AI 타일이 아닌 평범한 셸도: 거기서 손으로 친 `claude` 가 신호를 보내게, 2026-09-25
//! docs/log/2026-09-25-shell-claude-signals.md). MCP 토큰은 여전히 AI 타일만이다. 훅 스크립트는 신호
//! 토큰을 먼저 쓰고 없을 때만 MCP 토큰으로 물러나지만, ③-3a 의 신호 포트는 **MCP 토큰을 받지 않는다**(MCP 토큰은
//! GUI 의 것이고 서버는 모른다). 물러남이 쓰이던 옛 타일은 판 교체 = 세션 서버 재시작 = 세션 끝이라 남지 않는다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};

use crate::tile_env::stream_ok;

/// 이 경로에서만 신호를 받는다 (MCP 는 `/mcp`).
pub(crate) const PATH: &str = "/agent-signal";

/// 창으로 내보내는 Tauri 이벤트 이름 — `src/lib/app/agent-status.svelte.ts` 가 듣는다.
pub(crate) const EVENT: &str = "agent-signal";

/// 본문 상한 — `{stream, event, detail}` 한 줄이라 4 KB 면 넉넉하다. MCP 의 256 KiB 보다 훨씬 좁다.
pub(crate) const MAX_BODY_BYTES: usize = 4 * 1024;

/// `detail` 로 받는 값 — **범주 이름 몇 개뿐**이다(docs/log/2026-09-25-shell-claude-signals.md).
///
/// `waiting` 이 왜 울렸는지 싣는다 — Claude `Notification` 훅은 스크립트가 입력 JSON 에서 가리고,
/// Codex `PermissionRequest` 는 등록 자체가 `permission` 을 인자로 박는다:
/// `permission`(권한 물음) · `idle`(턴 뒤 한참 입력이 없다) · `other`(그 밖). 앱은 `permission` 에만
/// 알림을 띄운다. **자유 글자는 받지 않는다** — Claude Code 의 알림 문구(도구 이름 등)가 창으로
/// 흘러가지 않게, 그리고 신호 토큰을 쥔 누군가가 앱 화면에 제 글자를 싣지 못하게. 모르는 값은
/// 없는 것으로 친다(신호 자체는 받는다 — 옛 스크립트·새 범주가 신호를 잃을 이유가 없다).
pub(crate) const WAITING_DETAILS: &[&str] = &["permission", "idle", "other"];

/// `cli` 로 받는 값 — 훅 스크립트 8판이 싣는 **어느 CLI 의 훅인가**(설치기가 명령 인자로 박는다 ·
/// `crate::agent_hooks::TARGETS` 의 id). 화면은 이것으로 아직 AI 로 분류되지 않은 타일(tmux 안에서 손으로 띄운
/// `codex` …)을 그 CLI 의 타일로 친다 — 신호 토큰이 그 타일의 스트림에만 통하므로 근거가 된다. 모르는 값은 없는
/// 것으로 친다(신호 자체는 받는다 — `detail` 과 같은 규칙).
pub(crate) const CLI_IDS: &[&str] = &["claude", "codex"];

/// 받는 판 번호의 상한 — 스크립트 판은 한 자리·두 자리 수다. 터무니없는 수는 없는 것으로 친다.
pub(crate) const VERSION_MAX: u32 = 9999;

/// 서브 에이전트 id(`agent`)의 최대 글자 수 — 공식 문서의 예는 `agent_xyz789` 이다(Claude Code
/// `SubagentStart`·`SubagentStop` 입력의 `agent_id`). 넉넉히 64.
pub(crate) const AGENT_ID_MAX_CHARS: usize = 64;

/// 서브 에이전트 id 모양 — 영숫자 · `_` · `-` 만, 1..=[`AGENT_ID_MAX_CHARS`] 자. 스크립트가 같은 글자로
/// 거르고(`.cmd` 는 대소문자를 가리지 않는 치환으로 `0-9 a-z _ -` 를 지운다), 여기서 다시 본다. 이 밖의
/// 모양이면 id 가 없는 것으로 친다 — 프런트는 id 없는 서브 에이전트 신호를 **세지 않는다**(안전한 쪽).
pub(crate) fn agent_id_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= AGENT_ID_MAX_CHARS
        && s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 훅 일곱 가지를 앱 쪽 뜻으로 접은 것 (에이전트별 등록은 `crate::agent_hooks::TARGETS`).
///
/// | Claude Code 훅 | Codex 훅 | 이벤트 | 앱의 뜻 |
/// | --- | --- | --- | --- |
/// | `UserPromptSubmit` | `UserPromptSubmit` | `start` | 턴 시작 — 실행 중 |
/// | `PreToolUse` | `PreToolUse` | `tool` | 도구 사용 — 실행 중 |
/// | `PostToolUse` | `PostToolUse` | `tool-done` | 도구가 끝났다(권한을 승인한 도구 포함) — 실행 중 |
/// | `Notification` | `PermissionRequest` | `waiting` | 권한 물음 (Claude 는 한참 입력을 기다림도) — 입력 대기 |
/// | `Stop` | `Stop` | `stop` | 턴 끝, 프롬프트가 떴다 — 입력 대기 |
/// | `SubagentStart` | `SubagentStart` | `subagent-start` | 서브 에이전트 하나가 떴다(`agent` = 그 id) |
/// | `SubagentStop` | `SubagentStop` | `subagent-stop` | 서브 에이전트 하나가 끝났다(`agent` = 그 id) |
/// | `SessionEnd` | `SessionEnd` | `session-end` | CLI 가 끝났다(`/clear` 는 스크립트가 거른다) — 스크립트 9판 |
/// | `SessionStart` | (걸지 않음) | `session` | 대화가 섰다 · 바뀌었다(startup · resume · clear · compact) — **연결만**, 상태 점은 그대로 — 스크립트 10판 |
///
/// Claude 안에서 뜬 Codex 는 스크립트 12판부터, Codex 셸 도구로 뜬 Claude · Codex 는 13판부터 서브 에이전트 신호로 바꿔 보낸다
/// (`start` → `subagent-start` · `session-end` → `subagent-stop` · `agent` = 자식 대화 id · `stop` · `session` 은 없음 · `cli` 칸 없음 —
/// `crate::agent_hooks::SCRIPT_VERSION`). 판정은 `codex` + `CLAUDECODE`, 또는 `claude`·`codex` + `CODEX_THREAD_ID` 다.
/// Codex 0.166.0 은 셸 자식에 thread 표지를 넣고 훅은 부모 환경을 복사하므로 같은 CLI 중첩도 가른다. 타일은 두 표지를 걷는다.
/// Claude 의 매 `UserPromptSubmit` 은 `start` 로 오지만 같은 id 는 `agent_state::apply` 에서 한 번만 센다.
/// 여기서는 평범한 서브 에이전트 신호로 읽는다. `/clear` 는 여전히 안 보내고, 강제 종료 시 남은 수 · 다른 환경의 데몬은 해결하지 않는다.
///
/// 서브 에이전트 둘(스크립트 6판 · docs/log/2026-10-04-subagent-signals.md): 메인이 백그라운드 서브
/// 에이전트를 띄워 두고 턴을 끝내면 `Stop` 이 먼저 온다. 화면은 진행 중인 서브 에이전트를 세어 "메인이
/// 멈췄고 + 0개" 일 때만 완료로 친다.
///
/// Codex 에는 `Notification` 이 없고 승인 물음이 `PermissionRequest` 로 따로 온다 — 그래서 범주
/// `permission` 이 등록에 박혀 온다(스크립트 둘째 인자). Claude 의 `Notification` 은 스크립트가 입력에서 가린다.
///
/// `tool-done` 이 따로 있는 이유: 권한 물음(`Notification` → 입력 대기)을 **승인한 뒤**에는 다음
/// 도구나 `Stop` 이 올 때까지 아무 훅도 울리지 않아 점이 "입력 대기" 에 머물렀다(2026-09-24 실기).
/// 승인된 그 도구가 끝나는 순간(`PostToolUse`)이 "다시 일한다" 의 첫 증거다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SignalEvent {
    Start,
    Tool,
    ToolDone,
    Waiting,
    Stop,
    SubagentStart,
    SubagentStop,
    SessionEnd,
    Session,
    /// **사람이 지금 턴을 끊었다**(2026-11-02) — Codex 의 `Interrupt` 훅(타일 장식이 그 프로세스에만 건다 — `crate::tile_permission::codex_words`)과
    /// 대화 면 [중지](GUI 서버 op `agent_state_interrupt` — Claude 는 Esc 에 훅이 없다, 실측). 상태를 끝으로 두되 완료 · 알림은 아니다.
    Interrupt,
}

impl SignalEvent {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "start" => Some(Self::Start),
            "tool" => Some(Self::Tool),
            "tool-done" => Some(Self::ToolDone),
            "waiting" => Some(Self::Waiting),
            "stop" => Some(Self::Stop),
            "subagent-start" => Some(Self::SubagentStart),
            "subagent-stop" => Some(Self::SubagentStop),
            "session-end" => Some(Self::SessionEnd),
            "session" => Some(Self::Session),
            "interrupt" => Some(Self::Interrupt),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Tool => "tool",
            Self::ToolDone => "tool-done",
            Self::Waiting => "waiting",
            Self::Stop => "stop",
            Self::SubagentStart => "subagent-start",
            Self::SubagentStop => "subagent-stop",
            Self::SessionEnd => "session-end",
            Self::Session => "session",
            Self::Interrupt => "interrupt",
        }
    }
}

/// 받아 들인 신호 하나.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentSignal {
    pub stream: String,
    pub event: SignalEvent,
    pub detail: Option<String>,
    /// 에이전트의 **대화 id**(훅 입력의 `session_id`) — UUID 모양일 때만([`crate::agent_sessions::uuid_shape`]).
    /// 스크립트 4판이 `start`·`stop` 에 싣는다(프롬프트 글자는 싣지 않는다 — id 만 뽑는다). 화면은 이것으로
    /// "이 타일 = 이 대화" 를 알아 지난 대화 목록에 "열림" 을 찍고 같은 대화를 두 번 열지 않는다
    /// (docs/log/2026-09-26-agent-sessions.md). 소문자로 편다.
    pub session: Option<String>,
    /// 보낸 훅 스크립트의 **판 번호**(`v`) — 5판부터 모든 신호에 싣는다([`crate::agent_hooks::SCRIPT_VERSION`]).
    /// 없으면 4판 이하다. 화면이 이것으로 "원격(또는 다른 인스턴스)의 스크립트가 옛 판" 을 알아
    /// 다시 설치를 한 번 권한다(docs/log/2026-09-27-remote-hook-version.md). 신호 자체는 판과 상관없이 받는다.
    pub version: Option<u32>,
    /// **서브 에이전트 id**(훅 입력의 `agent_id`) — `subagent-start`·`subagent-stop` 에만, 모양이
    /// [`agent_id_ok`] 일 때만. 스크립트 6판이 싣는다(작업 설명 `task` · 마지막 메시지는 싣지 않는다 — id 만
    /// 뗀다). 화면은 이 id 로 진행 중 집합을 세고(같은 id 의 끝 두 번은 한 번), id 가 없으면 세지 않는다.
    pub agent: Option<String>,
    /// **어느 CLI 의 훅인가**(`claude`·`codex` — [`CLI_IDS`]) — 8판 스크립트가 모든 신호에 싣는다. 옛 스크립트는 없다.
    pub cli: Option<&'static str>,
}

impl AgentSignal {
    /// 창으로 보낼 페이로드 — `{ stream, event, detail, session, agent, cli, hookVersion, hookLatest, at }`
    /// (`at` = epoch ms). `hookVersion` 은 보낸 스크립트의 판(없으면 `null` = 4판 이하), `hookLatest` 는
    /// 이 앱이 설치하는 판 — 비교는 화면이 한다(기준 수를 프런트에 따로 적지 않게 여기서 함께 싣는다).
    pub(crate) fn payload(&self, at_ms: i64) -> Value {
        json!({
            "stream": self.stream,
            "event": self.event.as_str(),
            "detail": self.detail,
            "session": self.session,
            "agent": self.agent,
            "cli": self.cli,
            "hookVersion": self.version,
            "hookLatest": crate::agent_hooks::SCRIPT_VERSION,
            "at": at_ms,
        })
    }
}

/// 본문 → 신호. 틀리면 짧은 까닭(응답 본문에 싣는다 — 비밀이 아니다).
///
/// - JSON 객체가 아니다 → `"bad body"`
/// - `stream` 이 없거나 모양이 틀렸다([`stream_ok`]) → `"bad stream"`
/// - `event` 가 다섯 중 하나가 아니다 → `"unknown event"`
/// - `detail` 은 선택이다. `waiting` 이고 값이 [`WAITING_DETAILS`] 중 하나일 때만 싣고, 그 밖(다른
///   이벤트 · 문자열이 아님 · 모르는 값)은 없는 것으로 친다.
/// - `session` 도 선택이다. UUID 모양일 때만 싣고(소문자로), 그 밖은 없는 것으로 친다 — 신호 자체는 받는다.
/// - `v`(스크립트 판)도 선택이다. 1..=[`VERSION_MAX`] 의 정수일 때만 싣고, 그 밖은 없는 것(= 옛 판)으로 친다.
/// - `agent`(서브 에이전트 id)도 선택이다. `subagent-start`·`subagent-stop` 이고 [`agent_id_ok`] 일 때만 싣는다.
/// - `cli` 도 선택이다. [`CLI_IDS`] 중 하나와 글자까지 같을 때만 싣고, 그 밖은 없는 것으로 친다.
pub(crate) fn parse(body: &str) -> Result<AgentSignal, &'static str> {
    let v: Value = serde_json::from_str(body).map_err(|_| "bad body")?;
    let obj = v.as_object().ok_or("bad body")?;
    let stream = obj
        .get("stream")
        .and_then(Value::as_str)
        .ok_or("bad stream")?;
    if !stream_ok(stream) {
        return Err("bad stream");
    }
    let event = obj
        .get("event")
        .and_then(Value::as_str)
        .and_then(SignalEvent::from_str)
        .ok_or("unknown event")?;
    let detail = obj
        .get("detail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| event == SignalEvent::Waiting && WAITING_DETAILS.contains(s))
        .map(str::to_owned);
    let session = obj
        .get("session")
        .and_then(Value::as_str)
        .filter(|s| crate::agent_sessions::uuid_shape(s))
        .map(str::to_ascii_lowercase);
    let version = obj
        .get("v")
        .and_then(Value::as_u64)
        .filter(|v| (1..=u64::from(VERSION_MAX)).contains(v))
        .and_then(|v| u32::try_from(v).ok());
    let agent = obj
        .get("agent")
        .and_then(Value::as_str)
        .filter(|s| {
            matches!(
                event,
                SignalEvent::SubagentStart | SignalEvent::SubagentStop
            ) && agent_id_ok(s)
        })
        .map(str::to_owned);
    let cli = obj
        .get("cli")
        .and_then(Value::as_str)
        .and_then(|c| CLI_IDS.iter().copied().find(|id| *id == c));
    Ok(AgentSignal {
        stream: stream.to_owned(),
        event,
        detail,
        session,
        version,
        agent,
        cli,
    })
}

// ---------------------------------------------------------------------------
// 신호 전용 토큰 (스트림별) — 모듈 머리말의 "신호 전용 토큰"
// ---------------------------------------------------------------------------

/// 세션 하나가 받은 신호 토큰 — 셸 환경(`AYNX_SIGNAL_TOKEN`)으로 나갈 값과, 닫을 때 **자기 것만**
/// 거두는 데 쓰는 스트림·주인 번호.
///
/// **`Debug` 를 파생하지 않는다** — 토큰이 로그·패닉 메시지에 찍히면 안 된다(`McpState` 와 같은 규칙).
pub(crate) struct SignalGrant {
    pub token: String,
    pub stream: String,
    pub owner: u64,
}

impl SignalGrant {
    /// 닫을 때 거두는 데 필요한 둘만 — 토큰 값은 세션 표에 남기지 않는다.
    pub(crate) fn key(&self) -> (String, u64) {
        (self.stream.clone(), self.owner)
    }
}

/// 스트림 한 칸 — 토큰 · 주인 번호 · (원격이면) 발급한 GUI 연결 · 고아가 된 시각 · 마지막 사용 · 신호 파일을 썼나.
struct Entry {
    token: String,
    owner: u64,
    /// 원격 타일의 토큰을 뽑아 간 **GUI 연결 번호**(`server::serve` 의 conn). 로컬 타일은 `None` — 그 토큰은 서버 안의
    /// 세션 수명에 묶여 세션이 끝날 때 서버가 스스로 거둔다.
    conn: Option<u64>,
    /// 그 연결이 끊긴 시각(epoch ms) — 원격 토큰은 연결이 끊겨도 바로 거두지 않는다([`SignalTokens::orphan_conn`]).
    orphaned_at: Option<u64>,
    /// 발급 또는 마지막으로 신호가 통한 시각(epoch ms).
    last_ms: u64,
    /// 이 주인이 원격 신호 파일(`crate::remote_signal_file`)을 썼다 — 닫을 때 그 파일을 지울지의 근거.
    written: bool,
}

/// 원격 토큰을 뽑아 간 GUI 연결이 끊긴 뒤 이만큼(그 뒤 신호도 없이) 지나면 서버가 거둔다 — 일주일
/// (`crate::remote_signal_file::STALE_AFTER_SECS` 와 같은 나이). 회수 호출이 올 길(GUI 의 SSH 세션)이 GUI 와 함께
/// 죽었는데 표에만 남은 것을 치운다. 연결만 잠깐 끊겼고 GUI 의 SSH 세션은 살아 있으면 그 사이 신호가 마지막 사용을
/// 밀어 주므로 일하는 타일은 거두지 않는다.
pub(crate) const ORPHAN_TTL_MS: u64 = 7 * 24 * 3600 * 1000;

/// 스트림 → 한 칸. 순수 자료구조라 테스트가 제 것을 만든다 — 서버는 전역 하나([`TOKENS`]).
///
/// 한 스트림에는 **한 벌**만 산다. 같은 스트림으로 새 세션이 열리면(재연결 · 같은 타일을 다시 연
/// 경우) 새 토큰이 옛 것을 갈아 치우고, 옛 세션의 뒤늦은 닫기는 주인 번호가 달라 새 것을 지우지
/// 못한다([`SignalTokens::revoke`]).
#[derive(Default)]
pub(crate) struct SignalTokens {
    map: HashMap<String, Entry>,
}

impl SignalTokens {
    /// 토큰 하나를 적는다(같은 스트림의 옛 것은 갈아 치운다). `conn` 은 원격 토큰을 뽑아 간 GUI 연결.
    pub(crate) fn insert(&mut self, stream: &str, token: String, owner: u64, conn: Option<u64>, now_ms: u64) {
        self.map.insert(
            stream.to_owned(),
            Entry {
                token,
                owner,
                conn,
                orphaned_at: None,
                last_ms: now_ms,
                written: false,
            },
        );
    }

    /// 거둔다 — **그 스트림의 주인이 이 번호일 때만**. 거뒀으면 `Some(그 주인이 신호 파일을 썼나)`.
    pub(crate) fn revoke(&mut self, stream: &str, owner: u64) -> Option<bool> {
        if self.map.get(stream).is_some_and(|e| e.owner == owner) {
            return self.map.remove(stream).map(|e| e.written);
        }
        None
    }

    /// 이 주인이 그 스트림의 신호 파일을 썼다 — 주인이 맞을 때만 적는다(맞으면 `true`).
    pub(crate) fn note_written(&mut self, stream: &str, owner: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if e.owner == owner => {
                e.written = true;
                true
            }
            _ => false,
        }
    }

    /// 이 토큰이 **바로 이 스트림**의 것인가 — 다른 스트림의 토큰은 통하지 않는다. 비교는 상수시간
    /// (서버 쪽 루프백의 누구나 몇 번이든 두드릴 수 있다). 통하면 마지막 사용 시각을 민다.
    pub(crate) fn accepts(&mut self, stream: &str, token: &str, now_ms: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if !e.token.is_empty() && crate::token::ct_eq(e.token.as_bytes(), token.as_bytes()) => {
                e.last_ms = e.last_ms.max(now_ms);
                true
            }
            _ => false,
        }
    }

    /// GUI 연결 하나가 끊겼다 — 그 연결이 뽑아 간 원격 토큰을 **거두지 않고** 고아로 표시만 한다(GUI 의 SSH 세션은
    /// 연결이 잠깐 끊겨도 살아 있을 수 있다). 표시한 수.
    pub(crate) fn orphan_conn(&mut self, conn: u64, now_ms: u64) -> usize {
        let mut n = 0;
        for e in self.map.values_mut() {
            if e.conn == Some(conn) && e.orphaned_at.is_none() {
                e.orphaned_at = Some(now_ms);
                n += 1;
            }
        }
        n
    }

    /// 고아가 된 뒤(그리고 마지막 신호 뒤) `ttl_ms` 넘게 지난 원격 토큰을 거둔다 — 거둔 스트림들.
    pub(crate) fn prune(&mut self, now_ms: u64, ttl_ms: u64) -> Vec<String> {
        let stale: Vec<String> = self
            .map
            .iter()
            .filter(|(_, e)| {
                e.orphaned_at
                    .is_some_and(|o| now_ms.saturating_sub(o.max(e.last_ms)) > ttl_ms)
            })
            .map(|(k, _)| k.clone())
            .collect();
        for k in &stale {
            self.map.remove(k);
        }
        stale
    }

    fn contains(&self, stream: &str) -> bool {
        self.map.contains_key(stream)
    }
}

/// **세션 서버 프로세스의** 표 — 신호 수신 스레드(`crate::server::signal_http`)와 세션 op(뽑고 거두는 쪽)가 함께 본다.
/// ③-3a 부터 GUI 는 이 표를 만지지 않는다 — 파이프 op(`signal_issue`·`signal_revoke` …, `crate::server::signals`)로만 닿는다.
/// 잠금은 문장 하나 안에서 끝난다.
static TOKENS: LazyLock<Mutex<SignalTokens>> = LazyLock::new(Default::default);

fn tokens() -> std::sync::MutexGuard<'static, SignalTokens> {
    TOKENS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 주인 번호 — 로컬·SSH 세션 id 는 서로 다른 계수기라 겹칠 수 있어 따로 뽑는다.
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// 스트림 하나에 토큰을 뽑는다 — 스트림 모양이 틀렸거나([`stream_ok`]) OS 난수를 못 얻으면 `None`
/// (그 타일은 신호 전용 토큰 없이 연다). `conn` 은 원격 타일의 토큰을 뽑아 간 GUI 연결(로컬 타일은 `None`).
pub(crate) fn issue(stream: &str, conn: Option<u64>) -> Option<SignalGrant> {
    if !stream_ok(stream) {
        return None;
    }
    let token = crate::token::generate_token()?;
    let owner = NEXT_OWNER.fetch_add(1, Ordering::Relaxed);
    tokens().insert(stream, token.clone(), owner, conn, now_ms());
    // 이 스트림의 **새 세션**이다 — 옛 세션의 에이전트 상태(남은 서브 에이전트 집합 …)를 물려주지 않는다
    // (`crate::agent_state` 머리말 "지우는 때").
    crate::agent_state::forget(stream);
    Some(SignalGrant {
        token,
        stream: stream.to_owned(),
        owner,
    })
}

/// 세션이 닫힐 때 — 자기가 뽑은 토큰만 거둔다. 거뒀으면(그 스트림의 지금 주인이었으면) 그 스트림의 에이전트
/// 상태도 함께 버리고 `Some(이 주인이 원격 신호 파일을 썼나)` — 부른 쪽은 `Some(true)` 일 때만 원격 신호 파일을 지운다
/// (`crate::remote_signal_file`). 주인이 다르면(새 세션이 이미 갈아 치움) 둘 다 두고 `None`.
pub(crate) fn revoke(stream: &str, owner: u64) -> Option<bool> {
    let revoked = tokens().revoke(stream, owner);
    if revoked.is_some() {
        crate::agent_state::forget(stream);
    }
    revoked
}

/// 이 주인이 그 스트림의 원격 신호 파일을 썼다(주인이 맞을 때만 적힌다).
pub(crate) fn note_written(stream: &str, owner: u64) -> bool {
    tokens().note_written(stream, owner)
}

/// 이 스트림에 지금 살아 있는 토큰이 있는가 — 원격 신호 파일 쓸어 내기가 쓰는 세션의 파일을 건드리지 않게.
pub(crate) fn is_live(stream: &str) -> bool {
    tokens().contains(stream)
}

/// GUI 연결이 끊겼다 — 그 연결의 원격 토큰을 고아로 표시한다(거두지 않는다 — [`SignalTokens::orphan_conn`]).
pub(crate) fn orphan_conn(conn: u64) -> usize {
    tokens().orphan_conn(conn, now_ms())
}

/// 고아가 된 채 [`ORPHAN_TTL_MS`] 넘게 쉰 원격 토큰을 거두고 그 스트림의 에이전트 상태도 버린다 — 거둔 수.
pub(crate) fn prune_orphans() -> usize {
    let gone = tokens().prune(now_ms(), ORPHAN_TTL_MS);
    for s in &gone {
        crate::agent_state::forget(s);
    }
    gone.len()
}

/// 서버 쪽 판정 — `Authorization: Bearer <token>` 의 토큰이 본문의 스트림에 적힌 것인가.
pub(crate) fn token_accepts(stream: &str, token: &str) -> bool {
    tokens().accepts(stream, token, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_env::STREAM_MAX_CHARS;

    #[test]
    fn parses_the_seven_events() {
        for (name, ev) in [
            ("start", SignalEvent::Start),
            ("tool", SignalEvent::Tool),
            ("tool-done", SignalEvent::ToolDone),
            ("waiting", SignalEvent::Waiting),
            ("stop", SignalEvent::Stop),
            ("subagent-start", SignalEvent::SubagentStart),
            ("subagent-stop", SignalEvent::SubagentStop),
            ("session-end", SignalEvent::SessionEnd),
            ("session", SignalEvent::Session),
            ("interrupt", SignalEvent::Interrupt),
        ] {
            let s = parse(&format!(r#"{{"stream":"abc123","event":"{name}"}}"#)).unwrap();
            assert_eq!(s.event, ev);
            assert_eq!(s.stream, "abc123");
            assert_eq!(s.detail, None);
            assert_eq!(ev.as_str(), name);
        }
    }

    #[test]
    fn rejects_bad_bodies_streams_and_events() {
        assert_eq!(parse("not json"), Err("bad body"));
        assert_eq!(parse("[1,2]"), Err("bad body"));
        assert_eq!(parse(r#"{"event":"stop"}"#), Err("bad stream"));
        assert_eq!(parse(r#"{"stream":"","event":"stop"}"#), Err("bad stream"));
        assert_eq!(
            parse(r#"{"stream":"a\"b","event":"stop"}"#),
            Err("bad stream")
        );
        assert_eq!(
            parse(r#"{"stream":"a b","event":"stop"}"#),
            Err("bad stream")
        );
        let long = "a".repeat(STREAM_MAX_CHARS + 1);
        assert_eq!(
            parse(&format!(r#"{{"stream":"{long}","event":"stop"}}"#)),
            Err("bad stream")
        );
        assert_eq!(
            parse(r#"{"stream":"abc","event":"approve"}"#),
            Err("unknown event")
        );
        assert_eq!(parse(r#"{"stream":"abc"}"#), Err("unknown event"));
        assert_eq!(
            parse(r#"{"stream":"abc","event":"STOP"}"#),
            Err("unknown event")
        );
    }

    #[test]
    fn detail_is_only_a_known_waiting_category() {
        for cat in WAITING_DETAILS {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"waiting","detail":" {cat} "}}"#
            ))
            .unwrap();
            assert_eq!(s.detail.as_deref(), Some(*cat));
        }
        // 자유 글자는 싣지 않는다 — 신호는 받되 detail 은 없는 것.
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"Claude needs your permission to use Bash"}"#).unwrap();
        assert_eq!(s.event, SignalEvent::Waiting);
        assert_eq!(s.detail, None, "범주가 아닌 글자는 버린다");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":42}"#).unwrap();
        assert_eq!(s.detail, None, "문자열이 아니면 없는 것");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"   "}"#).unwrap();
        assert_eq!(s.detail, None, "빈 문자열도 없는 것");
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"PERMISSION"}"#).unwrap();
        assert_eq!(s.detail, None, "대소문자까지 같아야 한다");
        let s = parse(r#"{"stream":"abc","event":"stop","detail":"permission"}"#).unwrap();
        assert_eq!(s.detail, None, "waiting 밖의 이벤트에는 범주가 없다");
    }

    #[test]
    fn payload_carries_stream_event_detail_and_time() {
        let s = parse(r#"{"stream":"abc","event":"waiting","detail":"permission"}"#).unwrap();
        let p = s.payload(1234);
        let latest = crate::agent_hooks::SCRIPT_VERSION;
        assert_eq!(
            p,
            json!({"stream":"abc","event":"waiting","detail":"permission","session":null,"agent":null,"cli":null,"hookVersion":null,"hookLatest":latest,"at":1234})
        );
        let s = parse(r#"{"stream":"abc","event":"tool"}"#).unwrap();
        assert_eq!(s.payload(1)["detail"], Value::Null);
    }

    /// 5판 스크립트는 `v` 를 싣는다 — 없으면(4판 이하) `null`, 정수가 아니거나 범위 밖이면 없는 것.
    /// 어느 쪽이든 신호 자체는 받는다(옛 스크립트도 점을 움직인다).
    #[test]
    fn script_version_is_optional_and_only_a_small_positive_integer() {
        let s = parse(r#"{"stream":"abc","event":"stop"}"#).unwrap();
        assert_eq!(s.version, None, "옛 스크립트(4판 이하)는 싣지 않는다");
        assert_eq!(s.payload(1)["hookVersion"], Value::Null);
        assert_eq!(
            s.payload(1)["hookLatest"],
            crate::agent_hooks::SCRIPT_VERSION
        );
        let s = parse(r#"{"stream":"abc","event":"tool","v":5}"#).unwrap();
        assert_eq!(s.version, Some(5));
        assert_eq!(s.payload(1)["hookVersion"], 5);
        for bad in [r#""5""#, "0", "-1", "5.5", "10000", "null", "true"] {
            let s = parse(&format!(r#"{{"stream":"abc","event":"start","v":{bad}}}"#)).unwrap();
            assert_eq!(s.version, None, "{bad}");
        }
        // 설치기의 두 스크립트가 보내는 모양 그대로 — 이 앱의 판으로 읽힌다.
        let v = crate::agent_hooks::SCRIPT_VERSION;
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"waiting","v":{v},"detail":"permission"}}"#
        ))
        .unwrap();
        assert_eq!(
            (s.version, s.detail.as_deref()),
            (Some(v), Some("permission"))
        );
    }

    #[test]
    fn session_is_only_a_uuid_shaped_id() {
        let id = "11111111-2222-4333-8444-555555555555";
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"start","session":"{}"}}"#,
            id.to_uppercase()
        ))
        .unwrap();
        assert_eq!(s.session.as_deref(), Some(id), "소문자로 편다");
        assert_eq!(s.payload(1)["session"], id);
        let s = parse(&format!(
            r#"{{"stream":"abc","event":"stop","session":"{id}"}}"#
        ))
        .unwrap();
        assert_eq!(s.session.as_deref(), Some(id));
        for bad in [
            r#""""#,
            r#""not-a-uuid""#,
            "42",
            r#""11111111-2222-4333-8444-555555555555 x""#,
            r#""Fix the build""#,
        ] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"start","session":{bad}}}"#
            ))
            .unwrap();
            assert_eq!(s.event, SignalEvent::Start, "신호는 받는다");
            assert_eq!(s.session, None, "{bad}");
        }
    }

    /// 6판 — 서브 에이전트 신호는 id 하나만 싣는다. 모양이 틀리거나 다른 이벤트에 붙었으면 없는 것(신호는 받는다).
    #[test]
    fn agent_id_rides_only_on_subagent_events_and_only_in_its_shape() {
        for ev in ["subagent-start", "subagent-stop"] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"{ev}","v":6,"agent":"agent_xyz-789"}}"#
            ))
            .unwrap();
            assert_eq!(s.agent.as_deref(), Some("agent_xyz-789"), "{ev}");
            assert_eq!(s.payload(1)["agent"], "agent_xyz-789");
            // id 없는 서브 에이전트 신호(옛 스크립트 · `.cmd` 가 못 읽음)도 받는다 — 세지 않을 뿐.
            let s = parse(&format!(r#"{{"stream":"abc","event":"{ev}"}}"#)).unwrap();
            assert_eq!(s.agent, None);
            assert_eq!(s.payload(1)["agent"], Value::Null);
        }
        let long = "a".repeat(AGENT_ID_MAX_CHARS + 1);
        assert!(agent_id_ok(&"a".repeat(AGENT_ID_MAX_CHARS)));
        assert!(!agent_id_ok(&long));
        for bad in [
            r#""""#.to_owned(),
            r#""a b""#.to_owned(),
            r#""a\"b""#.to_owned(),
            r#""Explore the project structure""#.to_owned(),
            r#""a.b""#.to_owned(),
            r#""한글""#.to_owned(),
            format!(r#""{long}""#),
            "42".to_owned(),
        ] {
            let s = parse(&format!(
                r#"{{"stream":"abc","event":"subagent-start","agent":{bad}}}"#
            ))
            .unwrap();
            assert_eq!(s.event, SignalEvent::SubagentStart, "신호는 받는다");
            assert_eq!(s.agent, None, "{bad}");
        }
        let s = parse(r#"{"stream":"abc","event":"stop","agent":"agent_1"}"#).unwrap();
        assert_eq!(s.agent, None, "서브 에이전트 밖의 이벤트에는 id 가 없다");
    }

    /// 8판 — 어느 CLI 의 훅인지. 허용값 둘만(글자까지 같게), 그 밖·문자열 아님은 없는 것(신호는 받는다).
    #[test]
    fn cli_is_only_one_of_the_known_ids() {
        for id in CLI_IDS {
            let s = parse(&format!(r#"{{"stream":"abc","event":"start","v":8,"cli":"{id}"}}"#)).unwrap();
            assert_eq!(s.cli, Some(*id));
            assert_eq!(s.payload(1)["cli"], *id);
        }
        let s = parse(r#"{"stream":"abc","event":"stop"}"#).unwrap();
        assert_eq!(s.cli, None, "옛 스크립트는 싣지 않는다");
        assert_eq!(s.payload(1)["cli"], Value::Null);
        for bad in [r#""gemini""#, r#""Codex""#, r#"" codex""#, r#""""#, "1", "null", r#"["codex"]"#] {
            let s = parse(&format!(r#"{{"stream":"abc","event":"tool","cli":{bad}}}"#)).unwrap();
            assert_eq!(s.event, SignalEvent::Tool, "신호는 받는다");
            assert_eq!(s.cli, None, "{bad}");
        }
        // 표의 id 와 같은 글자다 — 설치기가 박는 값이 그대로 통한다.
        for t in crate::agent_hooks::TARGETS {
            assert!(CLI_IDS.contains(&t.id), "{}", t.id);
        }
    }

    #[test]
    fn signal_token_is_valid_only_for_its_own_stream() {
        let mut t = SignalTokens::default();
        t.insert("s1", "tok-one".into(), 1, None, 0);
        t.insert("s2", "tok-two".into(), 2, None, 0);
        assert!(t.accepts("s1", "tok-one", 1));
        assert!(t.accepts("s2", "tok-two", 1));
        assert!(
            !t.accepts("s1", "tok-two", 1),
            "남의 스트림 토큰은 통하지 않는다"
        );
        assert!(!t.accepts("s3", "tok-one", 1), "모르는 스트림");
        assert!(!t.accepts("s1", "", 1), "빈 토큰");
        assert!(!t.accepts("s1", "tok-on", 1), "접두사만 맞아도 안 된다");
    }

    #[test]
    fn revoke_only_removes_its_own_grant() {
        let mut t = SignalTokens::default();
        t.insert("s", "old".into(), 1, None, 0);
        // 같은 스트림으로 새 세션(재연결) — 새 토큰이 갈아 치운다.
        t.insert("s", "new".into(), 2, None, 0);
        assert!(!t.accepts("s", "old", 1));
        // 옛 세션의 뒤늦은 닫기는 새 것을 지우지 못한다.
        assert_eq!(t.revoke("s", 1), None);
        assert!(t.accepts("s", "new", 1));
        assert_eq!(t.revoke("s", 2), Some(false));
        assert!(!t.accepts("s", "new", 1));
    }

    /// 신호 파일 장부(옛 `remote_signal_file::WRITTEN`)는 토큰 칸에 산다 — 주인만 적고, 거둘 때 함께 알려 준다.
    /// 같은 스트림 재발급은 장부도 새로 시작한다(옛 주인이 쓴 파일은 새 세션의 것이 아니다).
    #[test]
    fn written_flag_rides_on_the_owner_and_resets_on_reissue() {
        let mut t = SignalTokens::default();
        t.insert("s", "a".into(), 1, Some(7), 0);
        assert!(!t.note_written("s", 2), "남의 주인은 못 적는다");
        assert!(t.note_written("s", 1));
        t.insert("s", "b".into(), 3, Some(7), 0);
        assert_eq!(t.revoke("s", 1), None, "옛 주인은 못 거둔다");
        assert_eq!(t.revoke("s", 3), Some(false), "새 주인은 아직 안 썼다");
        t.insert("s", "c".into(), 4, Some(7), 0);
        assert!(t.note_written("s", 4));
        assert_eq!(t.revoke("s", 4), Some(true));
    }

    /// GUI 연결이 끊겨도 원격 토큰은 산다(고아 표시만) — 고아가 된 뒤 TTL 을 넘겨 쉬면 거둔다. 그 사이 신호가 오면
    /// 시계가 밀린다. 로컬 토큰(`conn: None`)과 다른 연결의 토큰은 건드리지 않는다.
    #[test]
    fn orphaned_remote_tokens_survive_disconnect_and_are_pruned_after_ttl() {
        const TTL: u64 = 1000;
        let mut t = SignalTokens::default();
        t.insert("remote", "r".into(), 1, Some(5), 0);
        t.insert("busy", "b".into(), 2, Some(5), 0);
        t.insert("other-conn", "o".into(), 3, Some(6), 0);
        t.insert("local", "l".into(), 4, None, 0);
        assert_eq!(t.orphan_conn(5, 100), 2);
        assert_eq!(t.orphan_conn(5, 200), 0, "이미 고아 — 시각을 다시 찍지 않는다");
        // 연결이 끊긴 뒤에도 토큰은 통한다(③-3a — GUI 를 다시 켜도 신호가 이어진다).
        assert!(t.accepts("remote", "r", 500));
        assert!(t.accepts("busy", "b", 900));
        assert!(t.prune(600, TTL).is_empty(), "TTL 전");
        // remote 의 마지막 사용 500 + TTL 1000 → 1501 에서 거둔다. busy 는 900 에 썼다.
        let gone = t.prune(1501, TTL);
        assert_eq!(gone, vec!["remote".to_string()]);
        assert!(t.accepts("busy", "b", 1502));
        assert!(t.prune(1_000_000, TTL).contains(&"busy".to_string()));
        assert!(t.contains("other-conn"), "다른 연결의 토큰");
        assert!(t.contains("local"), "로컬 토큰은 세션 수명이 거둔다");
    }

    #[test]
    fn issue_needs_a_valid_stream_and_revoke_drops_it() {
        assert!(
            issue("bad stream", None).is_none(),
            "모양이 틀린 스트림에는 뽑지 않는다"
        );
        let g = issue("agent-signal-test-issue", None).unwrap();
        assert_eq!(g.token.len(), 64, "32바이트 hex");
        assert!(token_accepts("agent-signal-test-issue", &g.token));
        let (stream, owner) = g.key();
        assert!(is_live(&stream));
        assert_eq!(revoke(&stream, owner + 1), None, "남의 주인 번호로는 못 거둔다");
        assert_eq!(revoke(&stream, owner), Some(false));
        assert!(!is_live(&stream));
        assert!(!token_accepts("agent-signal-test-issue", &g.token));
    }

    /// 에이전트 상태 표의 항목은 토큰과 같은 열쇠(스트림)로 산다 — 새 세션(발급)이 비우고, 주인의 닫기(회수)가
    /// 지우고, 옛 세션의 뒤늦은 닫기는 새 세션의 항목을 건드리지 못한다(`crate::agent_state` 머리말).
    #[test]
    fn agent_state_follows_the_token_lifecycle() {
        const S: &str = "agent-signal-test-state";
        let has = || crate::agent_state::snapshot().iter().any(|(k, _)| k == S);
        let start = parse(&format!(r#"{{"stream":"{S}","event":"start"}}"#)).unwrap();
        let old = issue(S, Some(1)).unwrap();
        crate::agent_state::record(&start, 1);
        assert!(has());
        // 같은 스트림의 새 세션 — 옛 세션의 상태를 물려주지 않는다
        let new = issue(S, Some(1)).unwrap();
        assert!(!has(), "발급이 비운다");
        crate::agent_state::record(&start, 2);
        // 옛 세션의 뒤늦은 닫기 — 주인이 달라 새 세션의 항목은 남는다
        let (stream, owner) = old.key();
        revoke(&stream, owner);
        assert!(has(), "옛 주인의 닫기는 지우지 못한다");
        let (stream, owner) = new.key();
        revoke(&stream, owner);
        assert!(!has(), "주인의 닫기가 지운다");
    }
}
