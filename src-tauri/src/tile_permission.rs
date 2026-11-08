//! **타일 권한 카드**(B안 — 2026-11-01, 설계 aynx-notes `docs/log/2026-11-01-tile-permission-hook.md` · 실측
//! `docs/log/2026-11-01-tile-permission-hook-probe.md`) — 로컬 AI 타일(PTY 의 Claude Code · Codex TUI)이 권한을 물을 때 그 질문을
//! **대화 면 카드**에서도 답하게 하는 길의 순수 몸통. TUI 는 그대로다.
//!
//! ## 흐름
//!
//! 1. 타일 장식([`hook_words`] — `crate::agent_mcp::configured_tokens` 가 AI 타일 autorun · 감싸개 셸 타일의 `claude` · `codex` 에 싣는다)이
//!    그 프로세스에만 훅 셋을 건다: `PreToolUse` · `PermissionRequest` · `PostToolUse` → 앱 실행 파일의 `agent-permission <phase> <cli>`
//!    갈래([`helper`] — `main.rs` 가 Tauri 앞에서 가른다). **사용자 전역 훅 파일은 건드리지 않는다**(전역 신호 훅은 그대로 — 단방향 · 빈 출력).
//! 2. 도우미는 표준 입력(훅 JSON)을 읽어 [`Envelope`] 로 줄이고(도구 입력은 상한으로 자름 · 대조용 요약 `digest` 는 자르기 전 입력에서)
//!    세션 서버의 `/agent-permission`(신호 평면과 같은 포트 · 다른 문지기 · 다른 토큰)으로 보낸다. 환경(`AYNX_MCP_URL` · `AYNX_STREAM` ·
//!    `AYNX_PERMISSION_TOKEN`)이 없으면 아무것도 하지 않고 0 으로 끝난다(AYNX 밖의 CLI 는 기다리지 않는다 — 결정 5).
//! 3. `pre` = 그 호출의 `tool_use_id` 를 적어 두기만(곧바로 204). `ask` = 카드를 세우고 **짧게 나눈 롱폴**([`HOLD_MS`])로 결정을
//!    기다린다 — 도우미가 `wait` 로 다시 묻는 동안만 산다. `post` = 같은 `tool_use_id` 의 카드를 치운다(사람이 TUI 에서 [Yes]).
//! 4. 사람이 TUI 에서 No · Esc 하면 CLI 가 훅 프로세스를 죽인다 → 다음 `wait` 가 [`LIVENESS_MS`] 안에 오지 않으면 표가 그 카드를
//!    치운다(`hook-gone`). 응답을 쓰다 실패해도 곧바로 치운다.
//!
//! ## 토큰 — 신호 전용 토큰과 따로
//!
//! **권한 결정 토큰**은 스트림마다 세션 서버가 `open` 에서 뽑아(로컬 AI 타일 · 감싸개 셸 타일 — 몸의 `mcp`, 타일 MCP 토큰과 같은 주인 번호 ·
//! 같은 수명) 셸 환경 `AYNX_PERMISSION_TOKEN` 에만 넣는다. 이 경로에서만, 자기 스트림에만 통한다. 신호 전용 토큰은 이 경로에서 401,
//! 이 토큰은 `/agent-signal` 에서 401(시험 `permission_and_signal_tokens_do_not_cross`). 값은 파이프 · GUI · 프런트 · 로그 · 이벤트에 없다
//! (`Debug` 를 파생하지 않는다 — 시험 `permission_token_never_reaches_frontend`).
//!
//! ## 불변식
//!
//! - **PTY 에 쓰지 않는다** — 결정은 그 CLI 의 훅 응답(stdout)으로만 간다. "AI 문자열→PTY 길은 없다" 와 무관한 별개의 길이다(시험
//!   `permission_path_never_writes_pty`). 카드의 결정은 작업안 승인(`approve_operation` · 승인 등급 프레임)이 아니다 — 쓰기 등급 op 다.
//! - **본문(명령 · 파일 내용 · URL · MCP 인자)은 카드로만** — 그 스트림을 보는 창의 통로(`server::tile_permission_proxy`)로 가고, 로그 ·
//!   `Debug` · MCP · 영속 파일 · 감사에는 없다. 표는 메모리뿐이다.
//! - **원격 SSH 타일은 이 길이 없다**(1단계 = 로컬만) — 원격에는 토큰도 훅 낱말도 가지 않는다.
//! - 헤드리스 작업자 · 판정형 · 사이드 채팅 · 프로듀서에는 훅 낱말이 실리지 않고(그들의 인자는 따로 짓는다) 공용 환경 정화
//!   (`pty::scrub_env_names`)가 토큰 이름을 걷는다 — 혹시 훅이 불려도 곧바로 결정 없이 끝난다(`-p` 에서 결정 없음 = 거절이라 그대로 거절).

pub(crate) mod helper;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::tile_env::stream_ok;

/// 이 경로에서만 받는다(신호는 `/agent-signal` · MCP 는 `/mcp`).
pub(crate) const PATH: &str = "/agent-permission";

/// 본문 상한 — 도우미가 도구 입력을 잘라 이 안에 맞춘다([`helper`]). 넘치면 413(도우미는 결정 없이 끝난다 — TUI 창으로).
pub(crate) const MAX_BODY_BYTES: usize = 256 * 1024;

/// 롱폴 한 번이 붙드는 최대 시간 — 결정이 오면 곧바로 답한다. 짧게 나눠야 훅 프로세스의 죽음(연결 끊김)을 곧 안다.
pub(crate) const HOLD_MS: u64 = 3_000;
/// 마지막 롱폴이 끝난 뒤 다음 `wait` 가 이만큼 안 오면 훅이 죽은 것으로 본다(TUI 의 No · Esc — 실측 1 · 2차).
pub(crate) const LIVENESS_MS: u64 = 4_000;
/// 그 타일을 보는 창이 이만큼 계속 없으면 결정 없이 푼다(F5 의 잠깐 떨어짐은 견딘다). `ask` 때 창이 없으면 곧바로 푼다.
pub(crate) const NO_VIEWER_GRACE_MS: u64 = 5_000;
/// Claude — TUI 창이 함께 떠 있으니 길게(사용자 결정 3).
pub(crate) const CLAUDE_WAIT_MS: u64 = 10 * 60 * 1000;
/// Codex — 훅이 기다리는 동안 TUI 가 막힌다(창이 아직 없다 — 실측 3-1) · 짧게.
pub(crate) const CODEX_WAIT_MS: u64 = 2 * 60 * 1000;
/// 훅 설정의 `timeout`(초) — 앱의 시한보다 조금 길게(앱이 먼저 결정 없이 푼다).
pub(crate) const CLAUDE_ASK_TIMEOUT_SECS: u64 = 660;
pub(crate) const CODEX_ASK_TIMEOUT_SECS: u64 = 150;
/// **질문 카드**(Claude `AskUserQuestion` · Codex `request_user_input`)의 대기 — CLI 와 상관없이 Claude 권한과 같은 10분(사람이 생각할 시간).
pub(crate) const QUESTION_WAIT_MS: u64 = CLAUDE_WAIT_MS;
/// Codex `PreToolUse` 훅의 `timeout`(초) — 질문(`request_user_input`)이면 그 자리에서 카드의 답을 기다린다(2026-11-02 A안). 그 밖 도구의 `pre` 는
/// 예전처럼 2초 안에 끝난다 — 칸 하나라 시한이 길어질 뿐이다.
pub(crate) const CODEX_PRE_TIMEOUT_SECS: u64 = CLAUDE_ASK_TIMEOUT_SECS;
/// `pre` · `post` 훅의 `timeout`(초) — 도우미는 2초 안에 스스로 끝난다.
pub(crate) const MARK_TIMEOUT_SECS: u64 = 10;

/// `pre` 표지를 기억하는 시간 · 스트림당 개수.
const PRE_TTL_MS: u64 = 120_000;
const PRE_CAP: usize = 64;
/// 스트림당 동시에 선 카드 상한 — 넘치면 결정 없이 푼다(TUI 창으로).
const PENDING_CAP: usize = 16;
/// 거절 사유(사람이 쓴 글 — 모델에게 간다) 상한.
const MESSAGE_MAX_CHARS: usize = 2_000;
/// 사유가 없을 때 모델에게 갈 글.
const DEFAULT_DENY: &str = "The user denied this in AYNX.";

/// **[이 세션 동안 허용]** 의 앱 기억(사용자 결정 2026-11-01 — Codex 의 훅 allow 는 세션 승인이 아니어서 앱이 기억했다가 같은 요청에 곧바로
/// allow 를 돌려준다 · Claude 는 `updatedPermissions(session)` 도 함께). 끄면 카드의 `canAllowSession` 이 거짓이고 결정이 거절된다.
pub(crate) const SESSION_ALLOW: bool = true;

/// 화면 사건 이름 — 방송하지 않는다(`server::client::RELAYED` 밖): GUI 가 몸의 `windows` 가 건 통로에만 보낸다.
pub(crate) const EVENT: &str = "tile-permission-event";

// ---------------------------------------------------------------------------
// CLI · 단계
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Cli {
    Claude,
    Codex,
}

impl Cli {
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn wait_ms(self) -> u64 {
        match self {
            Self::Claude => CLAUDE_WAIT_MS,
            Self::Codex => CODEX_WAIT_MS,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Pre,
    Ask,
    Post,
    Wait,
}

impl Phase {
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "pre" => Some(Self::Pre),
            "ask" => Some(Self::Ask),
            "post" => Some(Self::Post),
            "wait" => Some(Self::Wait),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pre => "pre",
            Self::Ask => "ask",
            Self::Post => "post",
            Self::Wait => "wait",
        }
    }
}

// ---------------------------------------------------------------------------
// 권한 결정 토큰 (스트림별) — 모듈 머리말 "토큰"
// ---------------------------------------------------------------------------

/// 스트림 한 칸. **`Debug` 를 파생하지 않는다**(토큰).
struct TokenEntry {
    token: String,
    owner: u64,
    epoch: Option<u64>,
}

#[derive(Default)]
pub(crate) struct PermTokens {
    map: HashMap<String, TokenEntry>,
}

impl PermTokens {
    pub(crate) fn insert(&mut self, stream: &str, token: String, owner: u64) {
        self.map.insert(stream.to_string(), TokenEntry { token, owner, epoch: None });
    }

    pub(crate) fn bind_epoch(&mut self, stream: &str, owner: u64, epoch: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if e.owner == owner => {
                e.epoch = Some(epoch);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn revoke(&mut self, stream: &str, owner: u64) -> bool {
        if self.map.get(stream).is_some_and(|e| e.owner == owner) {
            self.map.remove(stream);
            return true;
        }
        false
    }

    /// 이 토큰이 **바로 이 스트림**의 것이고 회차가 섰으면 그 회차 — 상수시간 비교.
    pub(crate) fn accepts(&self, stream: &str, token: &str) -> Option<u64> {
        let e = self.map.get(stream)?;
        if e.token.is_empty() || !crate::token::ct_eq(e.token.as_bytes(), token.as_bytes()) {
            return None;
        }
        e.epoch
    }
}

static TOKENS: LazyLock<Mutex<PermTokens>> = LazyLock::new(Default::default);

fn tokens() -> std::sync::MutexGuard<'static, PermTokens> {
    TOKENS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 서버 `open` — 셸을 띄우기 **전에**(타일 MCP 토큰과 같은 주인 번호). 스트림 모양이 틀렸거나 난수가 없으면 `None`(카드 없이 연다).
pub(crate) fn issue(stream: &str, owner: u64) -> Option<String> {
    if !stream_ok(stream) {
        return None;
    }
    let token = crate::token::generate_token()?;
    tokens().insert(stream, token.clone(), owner);
    Some(token)
}

pub(crate) fn bind_epoch(stream: &str, owner: u64, epoch: u64) -> bool {
    tokens().bind_epoch(stream, owner, epoch)
}

/// 세션 회수 · 열기 실패 — 자기 것만. 거뒀으면 참(부른 쪽이 그 스트림의 카드 · 세션 허용 기억도 버린다).
pub(crate) fn revoke(stream: &str, owner: u64) -> bool {
    tokens().revoke(stream, owner)
}

/// 요청 인증 — 그 스트림의 토큰이고, 묶인 회차가 세션 코어의 **지금 살아 있는 회차**일 때만 그 회차.
pub(crate) fn authenticate(stream: &str, token: &str) -> Option<u64> {
    let epoch = tokens().accepts(stream, token)?;
    (crate::session_core::core().live_epoch(stream) == Some(epoch)).then_some(epoch)
}

// ---------------------------------------------------------------------------
// 도우미 → 서버 봉투
// ---------------------------------------------------------------------------

/// 도우미가 보내는 한 장(`pre` · `ask` · `post` 의 몸). **`Debug` 를 파생하지 않는다**(도구 입력 본문).
pub(crate) struct Envelope {
    pub cli: Cli,
    /// CLI 의 대화 id(훅 입력 `session_id`).
    pub session: Option<String>,
    pub tool: String,
    pub tool_use_id: Option<String>,
    /// 자르기 전 도구 입력의 대조 요약([`input_digest`]) — `pre` ↔ `ask` ↔ `post` 를 잇는다.
    pub digest: String,
    /// 카드 본문(잘렸을 수 있다 — `truncated`). `pre` · `post` 에는 없다.
    pub input: Value,
    pub truncated: bool,
    /// Claude 의 `permission_suggestions`(Codex 는 없음).
    pub suggestions: Vec<Value>,
    pub mcp_server: Option<Value>,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
}

fn short_str(v: Option<&Value>, max: usize, ok: impl Fn(char) -> bool) -> Option<String> {
    v.and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.chars().count() <= max && s.chars().all(&ok))
        .map(str::to_owned)
}

fn id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// 몸 → 봉투. 틀리면 짧은 까닭(인증 뒤라 알려 줘도 된다).
pub(crate) fn parse_envelope(body: &str) -> Result<Envelope, &'static str> {
    let v: Value = serde_json::from_str(body).map_err(|_| "bad body")?;
    let o = v.as_object().ok_or("bad body")?;
    let cli = o.get("cli").and_then(Value::as_str).and_then(Cli::parse).ok_or("bad cli")?;
    let tool = short_str(o.get("tool"), 256, |c| !c.is_control()).ok_or("bad tool")?;
    let digest = o
        .get("digest")
        .and_then(Value::as_str)
        .filter(|d| d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("bad digest")?
        .to_ascii_lowercase();
    let suggestions = o
        .get("suggestions")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter(|s| s.is_object()).take(32).cloned().collect())
        .unwrap_or_default();
    Ok(Envelope {
        cli,
        session: short_str(o.get("session"), 128, id_char),
        tool,
        tool_use_id: short_str(o.get("toolUseId"), 128, id_char),
        digest,
        input: o.get("input").cloned().unwrap_or(Value::Null),
        truncated: o.get("truncated").and_then(Value::as_bool).unwrap_or(false),
        suggestions,
        mcp_server: o.get("mcpServer").filter(|m| m.is_object()).cloned(),
        cwd: short_str(o.get("cwd"), 4096, |c| !c.is_control()),
        permission_mode: short_str(o.get("permissionMode"), 64, id_char),
    })
}

/// 도구 입력의 대조 요약 — 키를 재귀로 정렬하고 맨 위 `description` 은 뺀 JSON 의 SHA-256 hex. Codex 셸은 `PermissionRequest` 에만
/// `description`(승격 사유)을 싣는다(실측 2차 원자료) — 그 칸 빼고는 `pre` 와 같은 입력이다.
pub(crate) fn input_digest(input: &Value) -> String {
    fn canon(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                let mut out = Map::new();
                for k in keys {
                    out.insert(k.clone(), canon(&m[k]));
                }
                Value::Object(out)
            }
            Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
            other => other.clone(),
        }
    }
    let mut v = input.clone();
    if let Some(o) = v.as_object_mut() {
        o.shift_remove("description");
    }
    let text = serde_json::to_string(&canon(&v)).unwrap_or_default();
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// 카드의 도구 갈래 — 화면이 도구별로 그리는 열쇠(명령 · 파일 · URL · 검색어 · 경로 · 패치 · MCP).
pub(crate) fn tool_kind(tool: &str) -> &'static str {
    if tool.starts_with("mcp__") {
        return "mcp";
    }
    match tool {
        "Bash" | "shell" | "exec_command" | "local_shell" => "command",
        "Edit" | "MultiEdit" => "edit",
        "Write" => "write",
        "NotebookEdit" => "notebook",
        "WebFetch" => "fetch",
        "WebSearch" => "search",
        "Read" | "Glob" | "Grep" | "LS" => "read",
        "apply_patch" => "patch",
        // Claude 의 질문 상자(2026-11-02 실측 — `PermissionRequest` 로 온다 · 답은 `updatedInput.answers` — [`answer_output`])
        "AskUserQuestion" => "question",
        // Codex 의 질문 상자(2026-11-02 실측 9 · 10절 — Plan 모드 · `default_mode_request_user_input` 기능 · `PreToolUse` 만 온다 — 그 훅이 카드의
        // 답을 기다렸다가 deny 이유 글로 전한다 — [`codex_answer_reason`])
        "request_user_input" => "question",
        _ => "other",
    }
}

/// 질문 카드의 답 하나(사람이 고른 선택지 이름 · 여러 개면 `, ` 로 이은 것 · 직접 쓴 글) 상한.
const ANSWER_MAX_CHARS: usize = 2_000;
/// Codex 이유 글 안의 이름표(질문 머리 · id) 하나 · 답 하나 · 전체 상한(글자).
const REASON_LABEL_MAX: usize = 40;
const REASON_ANSWER_MAX: usize = 1_000;
const REASON_MAX: usize = 4_000;
/// Codex 이유 글의 머리 — 고정 글. Codex TUI 가 앞에 `• Blocked by hook └` 를 붙이고(지울 수 없다) 모델은 `Tool call blocked by PreToolUse hook: <이유>` 를
/// 받으므로, "실패가 아니라 사람의 답" 이라는 최소한의 말만 남긴다(2026-11-02 실기 — 질문 원문 · "다시 묻지 마라" 를 걷었다 · 실측 11절).
pub(crate) const CODEX_ANSWER_HEAD: &str = "Answered in AYNX (the user's answer, not an error):";

/// 이유 글에 끼울 한 조각 — 제어 문자 · 줄바꿈은 빈칸 하나로, 큰따옴표는 홑따옴표로, 앞뒤 빈칸을 걷고 `max` 글자까지(넘으면 `…`).
fn reason_piece(s: &str, max: usize) -> String {
    let flat: String = s.chars().map(|c| if c.is_control() { ' ' } else if c == '"' { '\'' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        let t: String = flat.chars().take(max.saturating_sub(1)).collect();
        format!("{t}…")
    } else {
        flat
    }
}

/// **Codex 질문의 답 → deny 이유 글**(**순수** · 서버 한 곳 · 2026-11-02 A안 · 실측 10 · 11절) — 고정 머리 뒤에 질문이 하나면 ` <답>`, 여럿이면
/// ` <이름표>=<답>; …`(이름표 = 질문 머리 · 없으면 id · 없으면 `Q<n>` — 질문 원문은 싣지 않는다: 모델은 제가 낸 질문을 알고, TUI 에 길게 다시 찍혀
/// 어색했다). 재료는 카드의 질문 머리 · id 와 사람이 고르거나 친 답뿐이다(정리 · 상한 — [`reason_piece`]). 넘치면 끝을 자른다.
pub(crate) fn codex_answer_reason(pairs: &[(String, String)]) -> String {
    let mut s = String::from(CODEX_ANSWER_HEAD);
    if let [(_, a)] = pairs {
        s.push(' ');
        s.push_str(&reason_piece(a, REASON_ANSWER_MAX));
    } else {
        let parts: Vec<String> = pairs
            .iter()
            .map(|(label, a)| format!("{}={}", reason_piece(label, REASON_LABEL_MAX), reason_piece(a, REASON_ANSWER_MAX)))
            .collect();
        s.push(' ');
        s.push_str(&parts.join("; "));
    }
    if s.chars().count() > REASON_MAX {
        s = s.chars().take(REASON_MAX - 1).collect::<String>() + "…";
    }
    s
}
/// 한 카드의 질문 수 상한(Claude 는 1~4).
const QUESTIONS_MAX: usize = 8;

/// **질문 카드의 답 → 훅 응답**(**순수**) — 둘 다 **훅 응답으로만** CLI 에 간다(PTY 에 쓰지 않는다 — 시험 `permission_path_never_writes_pty`):
/// - Claude `AskUserQuestion`(실측 7절 — `PermissionRequest` 에서 `allow` + `updatedInput`(원래 입력 + `answers: {질문 글: 답}`)이면 TUI 질문 없이
///   그 답으로 끝 · 여러 개 고르기 = 이름을 `, ` 로 · 직접 쓴 글도 그대로).
/// - Codex `request_user_input`(실측 10절 · A안 — 훅으로 정식 답을 줄 길이 없어 `PreToolUse` 의 `deny` + 이유 글([`codex_answer_reason`])로 답을 전한다 ·
///   모델은 `Tool call blocked by PreToolUse hook: <이유>` 를 받는다 · 하나 고르기만 — 여러 개 없음).
///
/// 잘리지 않은 입력에서만. `answers` 는 **카드의 질문 글마다 정확히 하나**(빠짐 · 남는 열쇠 없음) · 빈 글 · 상한 넘음은 거절(`None`). 답은 사람이 카드에서
/// 고르거나 친 글뿐이다(Tauri 명령 — MCP · AI 길 없음).
pub(crate) fn answer_output(cli: Cli, tool: &str, input: &Value, truncated: bool, answers: &Value) -> Option<Value> {
    let codex = match (cli, tool) {
        (Cli::Claude, "AskUserQuestion") => false,
        (Cli::Codex, "request_user_input") => true,
        _ => return None,
    };
    if truncated {
        return None;
    }
    let list = input.get("questions")?.as_array()?;
    let questions: Vec<&str> = list.iter().map(|q| q.get("question").and_then(Value::as_str)).collect::<Option<Vec<_>>>()?;
    if questions.is_empty() || questions.len() > QUESTIONS_MAX {
        return None;
    }
    let given = answers.as_object()?;
    if given.len() != questions.len() {
        return None;
    }
    let mut out = Map::new();
    let mut pairs = Vec::new();
    for (i, q) in questions.into_iter().enumerate() {
        let raw = given.get(q)?.as_str()?;
        let a: String = raw.chars().filter(|c| !c.is_control() || *c == '\n').collect();
        let a = a.trim();
        if a.is_empty() || a.chars().count() > ANSWER_MAX_CHARS {
            return None;
        }
        out.insert(q.to_string(), Value::String(a.to_string()));
        // Codex 이유 글의 이름표 — 질문 머리 · 없으면 id · 없으면 Q<n>(질문 원문은 쓰지 않는다)
        let s = |k: &str| list[i].get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(str::to_owned);
        let label = s("header").or_else(|| s("id")).unwrap_or_else(|| format!("Q{}", i + 1));
        pairs.push((label, a.to_string()));
    }
    if codex {
        return Some(json!({ "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": codex_answer_reason(&pairs),
        } }));
    }
    let mut updated = input.as_object()?.clone();
    updated.insert("answers".into(), Value::Object(out));
    Some(hook_output(json!({ "behavior": "allow", "updatedInput": Value::Object(updated) })))
}

/// [이 세션 동안 허용] 의 대상 열쇠 — **넓히는 접두어 규칙은 없다**(사용자 결정): 셸 = 정확히 같은 명령 글자 · `apply_patch` = 같은 파일 경로
/// 집합 · MCP = 같은 서버 · 도구(`tool_name`) · 파일 도구 = 같은 경로 · URL · 검색어 = 같은 글자 · 그 밖 = 같은 입력 요약. 잘린 입력이면
/// 대상을 확정할 수 없어 `None`(세션 허용 없음).
pub(crate) fn allow_target(tool: &str, input: &Value, digest: &str, truncated: bool) -> Option<String> {
    if truncated {
        return None;
    }
    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_owned);
    let target = match tool_kind(tool) {
        "mcp" => Some(String::new()),
        "command" => s("command"),
        "patch" => s("command").map(|p| patch_files(&p).join("\n")).filter(|f| !f.is_empty()),
        "edit" | "write" | "read" => s("file_path").or_else(|| s("path")).or_else(|| s("pattern")),
        "notebook" => s("notebook_path"),
        "fetch" => s("url"),
        "search" => s("query"),
        _ => Some(format!("digest:{digest}")),
    }?;
    Some(format!("{tool}\u{1f}{target}"))
}

/// `apply_patch` 원문의 파일 경로들(정렬 · 중복 없음) — `*** Add File:` · `*** Update File:` · `*** Delete File:` · `*** Move to:`.
pub(crate) fn patch_files(patch: &str) -> Vec<String> {
    let mut out: Vec<String> = patch
        .lines()
        .filter_map(|l| {
            ["*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:"]
                .iter()
                .find_map(|p| l.strip_prefix(p))
                .map(|r| r.trim().to_string())
        })
        .filter(|p| !p.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// 결정 → CLI 훅 응답
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Allow,
    Deny,
    AllowSession,
    /// 결정 없이 푼다 — CLI 가 평소 창을 띄운다([터미널에서 답하기]).
    Release,
}

impl Decision {
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "allow" => Some(Self::Allow),
            "deny" => Some(Self::Deny),
            "allowSession" => Some(Self::AllowSession),
            "release" => Some(Self::Release),
            _ => None,
        }
    }
}

/// 사람이 쓴 거절 사유 — 제어 문자(줄바꿈 · 탭 빼고)를 걷고 상한까지. 비면 `None`.
pub(crate) fn clean_message(m: Option<&str>) -> Option<String> {
    let t: String = m?
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .take(MESSAGE_MAX_CHARS)
        .collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// Claude 의 제안 → 이 세션에만 남는 규칙(사용자 결정 7): `destination` 이 `session` 이 아니면(`localSettings` · `projectSettings` ·
/// `userSettings`) `session` 으로 바꾼다 — 사용자 저장소에 `.claude/settings.local.json` 이 생기지 않게. 종류는 `addRules` · `addDirectories` ·
/// `setMode`(`acceptEdits` 만)만 남긴다(그 밖 — 규칙 지우기 · 모드 넓히기 — 는 버린다).
pub(crate) fn session_suggestions(suggestions: &[Value]) -> Vec<Value> {
    suggestions
        .iter()
        .filter_map(|s| {
            let mut o = s.as_object()?.clone();
            let ok = match o.get("type").and_then(Value::as_str)? {
                "addRules" | "addDirectories" => true,
                "setMode" => o.get("mode").and_then(Value::as_str) == Some("acceptEdits"),
                _ => false,
            };
            if !ok {
                return None;
            }
            o.insert("destination".into(), Value::String("session".into()));
            Some(Value::Object(o))
        })
        .collect()
}

fn hook_output(decision: Value) -> Value {
    json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } })
}

/// 결정 → 훅 stdout(한 줄 JSON). `Release` 는 `None`(빈 출력 · 0 — 평소 창). **Codex 는 `behavior` + `message` 만**(그 밖의 칸은 결정을
/// 무효로 만든다 — 0.166 소스 · 실측 1차 G).
pub(crate) fn build_output(cli: Cli, decision: Decision, message: Option<&str>, suggestions: &[Value]) -> Option<Value> {
    match decision {
        Decision::Release => None,
        Decision::Allow => Some(hook_output(json!({ "behavior": "allow" }))),
        Decision::AllowSession => {
            let rules = if cli == Cli::Claude { session_suggestions(suggestions) } else { Vec::new() };
            if rules.is_empty() {
                Some(hook_output(json!({ "behavior": "allow" })))
            } else {
                Some(hook_output(json!({ "behavior": "allow", "updatedPermissions": rules })))
            }
        }
        Decision::Deny => {
            let msg = clean_message(message).unwrap_or_else(|| DEFAULT_DENY.to_string());
            Some(hook_output(json!({ "behavior": "deny", "message": msg })))
        }
    }
}

// ---------------------------------------------------------------------------
// 대기 표 — 시각 · 보는 창은 인자로(시험이 시계를 안 쓴다)
// ---------------------------------------------------------------------------

/// 롱폴이 돌려받는 것.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Outcome {
    /// 훅 stdout 으로 낼 JSON.
    Decided(Value),
    /// 결정 없이 끝 — 빈 출력.
    Release,
}

/// 화면 사건 하나 — 서버가 그 스트림을 보는 창을 붙여 내보낸다(`server::tile_permission`).
#[derive(Clone, PartialEq)]
pub(crate) struct Ev {
    pub stream: String,
    pub session_epoch: u64,
    pub body: Value,
}

/// `pre` 표지 — 본문 없이 짝짓기 열쇠만.
struct PreMark {
    session: Option<String>,
    tool: String,
    digest: String,
    tool_use_id: String,
    at: u64,
    used: bool,
}

/// 선 카드 하나. **`Debug` 를 파생하지 않는다**(본문).
struct Pending {
    stream: String,
    session_epoch: u64,
    cli: Cli,
    session: Option<String>,
    tool: String,
    tool_use_id: Option<String>,
    digest: String,
    suggestions: Vec<Value>,
    target: Option<String>,
    card: Value,
    deadline: u64,
    polling: u32,
    last_poll_end: u64,
    no_viewer_since: Option<u64>,
    outcome: Option<Outcome>,
}

/// [`Table::ask`] 의 답.
#[derive(Debug, PartialEq)]
pub(crate) enum Asked {
    /// 카드가 섰다 — 요청 id(도우미가 `wait` 로 묻는다).
    Pending(String),
    /// 곧바로 끝(보는 창 없음 · 상한 · 세션 허용으로 자동 allow).
    Now(Outcome),
}

/// 세션 허용 기억의 범위 — 스트림 · 회차 · CLI 대화.
type AllowScope = (String, u64, Option<String>);

#[derive(Default)]
pub(crate) struct Table {
    pending: HashMap<String, Pending>,
    pre: HashMap<String, VecDeque<PreMark>>,
    allowed: HashMap<AllowScope, HashSet<String>>,
    /// **TUI 가 묻고 있는 스트림**(2026-11-02 면 규칙 — **Codex 만**: Claude 는 훅이 도는 동안에도 TUI 창이 함께 떠 있어 따로 알릴 것이 없다) —
    /// 카드 없이 물러났거나(대화 면으로 보는 창 없음) 카드가 풀려 CLI 가 평소 창 · 질문 상자를 띄운 때 선다. 그 스트림의 다음 훅(`pre` · `ask` · `post`) · 끊음 · 세션 끝이 걷는다. 대화 면은 이것으로 입력 칸 대신 "터미널에서 답하기" 를 보인다.
    tui_asks: HashSet<String>,
    /// TUI 물음 가운데 Codex 질문 — 늦게 온 일반 `PreToolUse` 신호가 질문 대기를 덮지 않게 종류만 기억
    tui_questions: HashSet<String>,
}

/// **면 규칙이 서는 CLI**(2026-11-02 사용자 승인 — 서버 판정은 이 한 곳): **Codex 만**. Codex 는 훅이 도는 동안 TUI 에 권한 창 · 질문 상자가 없어
/// (probe 1 · 9절) "대화 면이면 카드, 터미널 면이면 TUI" 로 가른다. Claude 는 `PermissionRequest` 훅이 도는 동안에도 TUI 창이 함께 떠 있어(probe 1절 —
/// 먼저 답한 쪽이 이긴다) 예전처럼 늘 카드를 세운다(창 없음 유예 · HOLD · 시한 · 훅 생존 그대로 · TUI 에서 먼저 답하면 `PostToolUse` 가 카드를 걷는다).
pub(crate) fn face_rule_applies(cli: Cli) -> bool {
    cli == Cli::Codex
}

/// 그 스트림에 선 카드의 CLI(처음 것) — 서버 시계가 그 스트림의 "보는 창" 을 고를 때(면 규칙은 Codex 만).
impl Table {
    pub(crate) fn stream_cli(&self, stream: &str) -> Option<Cli> {
        self.pending.values().find(|p| p.stream == stream).map(|p| p.cli)
    }
}

/// 사건 `tui` — 그 스트림의 TUI 가 묻는 중인가(대화 면의 안내 한 줄).
fn tui_ev(stream: &str, epoch: u64, asking: bool) -> Ev {
    Ev { stream: stream.to_string(), session_epoch: epoch, body: json!({ "t": "tui", "asking": asking }) }
}

fn card_of(id: &str, stream: &str, epoch: u64, e: &Envelope, now: u64, deadline: u64, auto: bool) -> Value {
    json!({
        "requestId": id,
        "stream": stream,
        "sessionEpoch": epoch,
        "cli": e.cli.as_str(),
        "tool": e.tool,
        "kind": tool_kind(&e.tool),
        "toolUseId": e.tool_use_id,
        "conversation": e.session,
        "input": e.input,
        "truncated": e.truncated,
        "suggestions": if e.cli == Cli::Claude { Value::Array(e.suggestions.clone()) } else { Value::Array(Vec::new()) },
        "mcpServer": e.mcp_server,
        "cwd": e.cwd,
        "permissionMode": e.permission_mode,
        // 질문 카드에는 [이 세션 동안 허용]이 없다(답은 매번 사람이)
        "canAllowSession": SESSION_ALLOW && tool_kind(&e.tool) != "question",
        "createdAt": now,
        "deadlineAt": deadline,
        "auto": auto,
    })
}

fn gone(p: &Pending, id: &str, reason: &str) -> Ev {
    Ev {
        stream: p.stream.clone(),
        session_epoch: p.session_epoch,
        body: json!({ "t": "gone", "requestId": id, "reason": reason }),
    }
}

fn new_id() -> String {
    crate::token::generate_token()
        .map(|t| t[..32].to_string())
        .unwrap_or_else(|| format!("{:032x}", crate::agent_signal::now_ms()))
}

impl Table {
    /// `pre` — 표지를 적어 둔다(오래된 것 · 넘친 것은 버린다).
    pub(crate) fn pre(&mut self, stream: &str, e: &Envelope, now: u64) {
        let Some(id) = e.tool_use_id.clone() else { return };
        let q = self.pre.entry(stream.to_string()).or_default();
        q.retain(|m| now.saturating_sub(m.at) <= PRE_TTL_MS);
        if q.len() >= PRE_CAP {
            q.pop_front();
        }
        q.push_back(PreMark {
            session: e.session.clone(),
            tool: e.tool.clone(),
            digest: e.digest.clone(),
            tool_use_id: id,
            at: now,
            used: false,
        });
    }

    /// 사람이 턴을 끊었다(`interrupt` — Codex `Interrupt` 훅 · 대화 면 [중지]) — 그 스트림의 **Codex 질문 카드**를 걷는다(기다리는 훅은 다음 `wait`
    /// 에서 결정 없이 끝난다 — 빈 출력). Codex 는 Esc 에 훅 프로세스를 바로 죽이지 않을 수 있어 생존 시계보다 먼저 걷는다.
    pub(crate) fn drop_questions(&mut self, stream: &str) -> Vec<Ev> {
        let ids: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, p)| p.stream == stream && p.cli == Cli::Codex && tool_kind(&p.tool) == "question" && p.outcome.is_none())
            .map(|(id, _)| id.clone())
            .collect();
        let mut evs = Vec::new();
        for id in ids {
            if let Some(p) = self.pending.remove(&id) {
                evs.push(gone(&p, &id, "hook-gone"));
            }
        }
        // 끊겼다 — TUI 의 물음도 사라졌다
        if let Some(e) = evs.first().map(|ev| ev.session_epoch) {
            evs.extend(self.clear_tui(stream, e));
        } else if self.tui_asks.remove(stream) {
            self.tui_questions.remove(stream);
            // 카드 없이 TUI 만 묻던 중(회차는 모른다 — 0: 창은 회차로 거르지 않고 스트림으로 지운다)
            evs.push(tui_ev(stream, 0, false));
        }
        evs
    }

    /// 이 `ask` 의 `tool_use_id` — 같은 대화 · 도구 · 요약의 가장 최근 안 쓴 표지, 없으면 같은 대화 · 도구의 30초 안 표지.
    fn match_pre(&mut self, stream: &str, e: &Envelope, now: u64) -> Option<String> {
        let q = self.pre.get_mut(stream)?;
        let exact = q
            .iter_mut()
            .rev()
            .find(|m| !m.used && m.session == e.session && m.tool == e.tool && m.digest == e.digest);
        let hit = match exact {
            Some(m) => Some(m),
            None => q
                .iter_mut()
                .rev()
                .find(|m| !m.used && m.session == e.session && m.tool == e.tool && now.saturating_sub(m.at) <= 30_000),
        }?;
        hit.used = true;
        Some(hit.tool_use_id.clone())
    }

    /// `ask` — 카드를 세운다. `watchers` = 그 스트림을 지금 보는 창들. 세션 허용에 든 대상이면 카드 없이 곧바로 allow(사건 `auto`).
    pub(crate) fn ask(&mut self, stream: &str, epoch: u64, mut e: Envelope, now: u64, watchers: &[String]) -> (Asked, Vec<Ev>) {
        if e.tool_use_id.is_none() {
            e.tool_use_id = self.match_pre(stream, &e, now);
        }
        let target = allow_target(&e.tool, &e.input, &e.digest, e.truncated);
        let scope = (stream.to_string(), epoch, e.session.clone());
        if SESSION_ALLOW && tool_kind(&e.tool) != "question" && target.as_ref().is_some_and(|t| self.allowed.get(&scope).is_some_and(|s| s.contains(t))) {
            let id = new_id();
            let card = card_of(&id, stream, epoch, &e, now, now, true);
            let ev = Ev { stream: stream.to_string(), session_epoch: epoch, body: json!({ "t": "auto", "card": card }) };
            let out = build_output(e.cli, Decision::Allow, None, &[]).map_or(Outcome::Release, Outcome::Decided);
            return (Asked::Now(out), vec![ev]);
        }
        // 새 훅 — 지난 TUI 물음은 끝났다
        let mut evs: Vec<Ev> = self.clear_tui(stream, epoch).into_iter().collect();
        // 면 규칙(2026-11-02 — Codex 만): Codex 면 `watchers` 는 그 타일을 **대화 면으로 보는** 사람 창들 — 없으면 카드 없이 곧바로 물러나 TUI 가
        // 묻는다. Claude 면 예전대로 그 세션을 보는 모든 창(서버가 고른다 — [`face_rule_applies`])
        if watchers.is_empty() || self.pending.values().filter(|p| p.stream == stream).count() >= PENDING_CAP {
            if face_rule_applies(e.cli) {
                evs.extend(self.mark_tui(stream, epoch));
                if e.tool == "request_user_input" {
                    self.tui_questions.insert(stream.to_string());
                }
            }
            return (Asked::Now(Outcome::Release), evs);
        }
        let id = new_id();
        let deadline = now + if tool_kind(&e.tool) == "question" { QUESTION_WAIT_MS } else { e.cli.wait_ms() };
        let card = card_of(&id, stream, epoch, &e, now, deadline, false);
        evs.push(Ev { stream: stream.to_string(), session_epoch: epoch, body: json!({ "t": "request", "card": card.clone() }) });
        self.pending.insert(
            id.clone(),
            Pending {
                stream: stream.to_string(),
                session_epoch: epoch,
                cli: e.cli,
                session: e.session,
                tool: e.tool,
                tool_use_id: e.tool_use_id,
                digest: e.digest,
                suggestions: e.suggestions,
                target,
                card,
                deadline,
                polling: 0,
                last_poll_end: now,
                no_viewer_since: None,
                outcome: None,
            },
        );
        (Asked::Pending(id), evs)
    }

    /// TUI 가 묻는다 — 새로 섰으면 사건 하나.
    pub(crate) fn mark_tui(&mut self, stream: &str, epoch: u64) -> Option<Ev> {
        self.tui_asks.insert(stream.to_string()).then(|| tui_ev(stream, epoch, true))
    }

    /// TUI 물음이 끝났다(다음 훅 · 끊음) — 서 있었으면 사건 하나.
    pub(crate) fn clear_tui(&mut self, stream: &str, epoch: u64) -> Option<Ev> {
        self.tui_questions.remove(stream);
        self.tui_asks.remove(stream).then(|| tui_ev(stream, epoch, false))
    }

    /// Codex 질문이 카드 · TUI 에서 답을 기다리는가 — 일반 권한 카드는 기존 신호 그대로
    pub(crate) fn codex_question_waiting(&self, stream: &str) -> bool {
        self.tui_questions.contains(stream)
            || self.pending.values().any(|p| p.stream == stream && p.cli == Cli::Codex && p.tool == "request_user_input" && p.outcome.is_none())
    }

    pub(crate) fn codex_question(&self, stream: &str, epoch: u64, id: &str) -> bool {
        self.pending.get(id).is_some_and(|p| p.stream == stream && p.session_epoch == epoch && p.cli == Cli::Codex && p.tool == "request_user_input")
    }

    /// 그 스트림의 TUI 가 묻는 중인가(스냅숏).
    pub(crate) fn tui_asking(&self, stream: &str) -> bool {
        self.tui_asks.contains(stream)
    }

    /// **그 타일을 대화 면으로 보는 창이 없어졌다**(면 규칙 2 — 모두 터미널 면으로 넘김) — 그 스트림의 선 카드를 풀어(결정 없이 — [터미널에서 답하기]와
    /// 같다) 기다리던 훅이 빈 출력으로 끝나 TUI 가 묻게 한다.
    pub(crate) fn release_stream(&mut self, stream: &str) -> Vec<Ev> {
        let mut evs = Vec::new();
        let mut epoch = None;
        let mut question = false;
        // Codex 카드만 — Claude 는 TUI 창이 함께 떠 있어 카드를 그대로 둔다(먼저 답한 쪽이 이긴다)
        for (id, p) in self.pending.iter_mut().filter(|(_, p)| p.stream == stream && p.outcome.is_none() && face_rule_applies(p.cli)) {
            p.outcome = Some(Outcome::Release);
            question |= p.tool == "request_user_input";
            epoch = Some(p.session_epoch);
            evs.push(gone(p, id, "released"));
        }
        if let Some(e) = epoch {
            evs.extend(self.mark_tui(stream, e));
            if question {
                self.tui_questions.insert(stream.to_string());
            }
        }
        evs
    }

    /// 롱폴 하나가 시작한다 — 이 스트림의 카드가 아니면(없거나 남의 것) `Some(Release)`.
    pub(crate) fn begin_poll(&mut self, stream: &str, id: &str) -> Option<Outcome> {
        match self.pending.get_mut(id) {
            Some(p) if p.stream == stream => {
                p.polling += 1;
                None
            }
            _ => Some(Outcome::Release),
        }
    }

    /// 결정이 났으면 꺼낸다(카드를 지운다) — 붙든 롱폴이 깨어날 때마다. 카드가 사라졌으면 `Release`.
    pub(crate) fn take(&mut self, id: &str) -> Option<Outcome> {
        match self.pending.get(id) {
            None => Some(Outcome::Release),
            Some(p) if p.outcome.is_some() => self.pending.remove(id).and_then(|p| p.outcome),
            Some(_) => None,
        }
    }

    /// 롱폴 하나가 결정 없이 끝났다(시한) — 다음 `wait` 를 기다리는 시계가 이때부터.
    pub(crate) fn end_poll(&mut self, id: &str, now: u64) {
        if let Some(p) = self.pending.get_mut(id) {
            p.polling = p.polling.saturating_sub(1);
            p.last_poll_end = now;
        }
    }

    /// 응답을 쓰지 못했다(훅 프로세스가 이미 죽음) — 곧바로 치운다.
    pub(crate) fn hook_lost(&mut self, id: &str) -> Vec<Ev> {
        match self.pending.remove(id) {
            Some(p) if p.outcome.is_none() => vec![gone(&p, id, "hook-gone")],
            _ => Vec::new(),
        }
    }

    /// 사람의 결정 — **처음 하나만 먹는다**(둘째는 `Ok(false)` · 조용히). `window` 가 그 스트림을 보는 창(`watchers`)이어야 한다.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn decide(
        &mut self,
        stream: &str,
        epoch: u64,
        id: &str,
        window: &str,
        decision: Decision,
        message: Option<&str>,
        watchers: &[String],
    ) -> Result<(bool, Vec<Ev>), &'static str> {
        if !watchers.iter().any(|w| w == window) {
            return Err("not-viewing");
        }
        let Some(p) = self.pending.get_mut(id) else { return Ok((false, Vec::new())) };
        if p.stream != stream || p.session_epoch != epoch {
            return Ok((false, Vec::new()));
        }
        if p.outcome.is_some() {
            return Ok((false, Vec::new()));
        }
        if decision == Decision::AllowSession && !SESSION_ALLOW {
            return Err("bad-decision");
        }
        // 질문 카드는 답([`Self::answer`]) · 거절 · 풀기만 — 답 없는 허용은 CLI 가 무엇을 할지 모른다
        if tool_kind(&p.tool) == "question" && matches!(decision, Decision::Allow | Decision::AllowSession) {
            return Err("bad-decision");
        }
        let out = build_output(p.cli, decision, message, &p.suggestions).map_or(Outcome::Release, Outcome::Decided);
        p.outcome = Some(out);
        let reason = match decision {
            Decision::Allow => "allowed",
            Decision::AllowSession => "allowed-session",
            Decision::Deny => "denied",
            Decision::Release => "released",
        };
        let ev = gone(p, id, reason);
        let (stream_k, epoch_k, codex_k, question_k) = (p.stream.clone(), p.session_epoch, face_rule_applies(p.cli), p.tool == "request_user_input");
        if decision == Decision::AllowSession {
            if let Some(t) = p.target.clone() {
                self.allowed.entry((p.stream.clone(), p.session_epoch, p.session.clone())).or_default().insert(t);
            }
        }
        let mut evs = vec![ev];
        // [터미널에서 답하기] — CLI 가 평소 창 · 질문 상자를 띄운다
        if decision == Decision::Release && codex_k {
            evs.extend(self.mark_tui(&stream_k, epoch_k));
            if question_k {
                self.tui_questions.insert(stream_k);
            }
        }
        Ok((true, evs))
    }

    /// **질문 카드의 답**(2026-11-02) — [`Self::decide`] 와 같은 규칙(보는 창 · 처음 하나만 · 회차)에 답의 모양([`answer_output`])을 더 본다.
    /// 모양이 틀리면 `Err("bad-answer")`(카드는 그대로 — 사람이 다시 고른다).
    pub(crate) fn answer(
        &mut self,
        stream: &str,
        epoch: u64,
        id: &str,
        window: &str,
        answers: &Value,
        watchers: &[String],
    ) -> Result<(bool, Vec<Ev>), &'static str> {
        if !watchers.iter().any(|w| w == window) {
            return Err("not-viewing");
        }
        let Some(p) = self.pending.get_mut(id) else { return Ok((false, Vec::new())) };
        if p.stream != stream || p.session_epoch != epoch || p.outcome.is_some() {
            return Ok((false, Vec::new()));
        }
        let input = p.card.get("input").cloned().unwrap_or(Value::Null);
        let truncated = p.card.get("truncated").and_then(Value::as_bool).unwrap_or(true);
        let out = answer_output(p.cli, &p.tool, &input, truncated, answers).ok_or("bad-answer")?;
        p.outcome = Some(Outcome::Decided(out));
        Ok((true, vec![gone(p, id, "answered")]))
    }

    /// `post` — 같은 `tool_use_id`(없으면 같은 대화 · 도구 · 요약)의 카드를 치운다(사람이 TUI 에서 [Yes] — 도구가 돌았다).
    pub(crate) fn post(&mut self, stream: &str, e: &Envelope) -> Vec<Ev> {
        if let (Some(q), Some(id)) = (self.pre.get_mut(stream), e.tool_use_id.as_deref()) {
            q.retain(|m| m.tool_use_id != id);
        }
        let hit = self
            .pending
            .iter()
            .filter(|(_, p)| p.stream == stream && p.outcome.is_none())
            .find(|(_, p)| match (&p.tool_use_id, &e.tool_use_id) {
                (Some(a), Some(b)) => a == b,
                _ => p.session == e.session && p.tool == e.tool && p.digest == e.digest,
            })
            .map(|(id, _)| id.clone());
        match hit.and_then(|id| self.pending.remove(&id).map(|p| (id, p))) {
            Some((id, p)) => vec![gone(&p, &id, "terminal")],
            None => Vec::new(),
        }
    }

    /// 시계 — 시한 · 보는 창 없음(유예 뒤) · 훅 사라짐(롱폴이 [`LIVENESS_MS`] 안에 다시 안 옴). `watchers` = 스트림 → 보는 창(세션이 끝났으면
    /// `None` — 카드를 치운다).
    pub(crate) fn sweep(&mut self, now: u64, watchers: impl Fn(&str) -> Option<Vec<String>>) -> Vec<Ev> {
        let mut evs = Vec::new();
        let mut drop_ids = Vec::new();
        let mut tui_marks: Vec<(String, u64, bool)> = Vec::new();
        for (id, p) in self.pending.iter_mut() {
            let idle = p.polling == 0 && now.saturating_sub(p.last_poll_end) > LIVENESS_MS;
            if p.outcome.is_some() {
                if idle {
                    drop_ids.push((id.clone(), None));
                }
                continue;
            }
            if idle {
                drop_ids.push((id.clone(), Some("hook-gone")));
                continue;
            }
            let reason = match watchers(&p.stream) {
                None => Some("session-ended"),
                Some(w) if w.is_empty() => {
                    let since = *p.no_viewer_since.get_or_insert(now);
                    (now.saturating_sub(since) >= NO_VIEWER_GRACE_MS).then_some("no-viewer")
                }
                Some(_) => {
                    p.no_viewer_since = None;
                    (now >= p.deadline).then_some("timeout")
                }
            };
            if let Some(r) = reason {
                p.outcome = Some(Outcome::Release);
                evs.push(gone(p, id, r));
                // 시한 · 대화 면으로 보는 창 없음 — 훅이 빈 출력으로 끝나 TUI 가 묻는다(세션 끝은 아님)
                if r != "session-ended" && face_rule_applies(p.cli) {
                    tui_marks.push((p.stream.clone(), p.session_epoch, p.tool == "request_user_input"));
                }
            }
        }
        for (s, e, question) in tui_marks {
            evs.extend(self.mark_tui(&s, e));
            if question {
                self.tui_questions.insert(s);
            }
        }
        for (id, reason) in drop_ids {
            if let Some(p) = self.pending.remove(&id) {
                if let Some(r) = reason {
                    evs.push(gone(&p, &id, r));
                }
            }
        }
        let live: HashSet<String> = self.pending.values().map(|p| p.stream.clone()).collect();
        self.pre.retain(|s, q| {
            q.retain(|m| now.saturating_sub(m.at) <= PRE_TTL_MS);
            !q.is_empty() || live.contains(s)
        });
        evs
    }

    /// 세션 회수(타일 닫기 · 회차 바뀜) — 그 스트림의 카드 · 표지 · 세션 허용 기억을 버린다.
    pub(crate) fn forget_stream(&mut self, stream: &str) -> Vec<Ev> {
        self.pre.remove(stream);
        self.tui_asks.remove(stream);
        self.tui_questions.remove(stream);
        self.allowed.retain(|(s, _, _), _| s != stream);
        let ids: Vec<String> = self.pending.iter().filter(|(_, p)| p.stream == stream).map(|(id, _)| id.clone()).collect();
        let mut evs = Vec::new();
        for id in ids {
            if let Some(p) = self.pending.remove(&id) {
                if p.outcome.is_none() {
                    evs.push(gone(&p, &id, "session-ended"));
                }
            }
        }
        evs
    }

    /// 그 스트림 · 회차의 선 카드들(결정이 아직인 것 — 생긴 순서).
    pub(crate) fn snapshot(&self, stream: &str, epoch: u64) -> Vec<Value> {
        let mut cards: Vec<&Pending> = self
            .pending
            .values()
            .filter(|p| p.stream == stream && p.session_epoch == epoch && p.outcome.is_none())
            .collect();
        cards.sort_by_key(|p| p.card.get("createdAt").and_then(Value::as_u64).unwrap_or(0));
        cards.into_iter().map(|p| p.card.clone()).collect()
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// 카드가 선 스트림들(시계가 보는 창을 먼저 읽는다).
    pub(crate) fn pending_streams(&self) -> Vec<String> {
        let mut s: Vec<String> = self.pending.values().map(|p| p.stream.clone()).collect();
        s.sort();
        s.dedup();
        s
    }
}

// ---------------------------------------------------------------------------
// 타일 장식 — 그 프로세스에만 거는 훅
// ---------------------------------------------------------------------------

/// 훅 명령 글자 — 도우미(앱 실행 파일)의 갈래 `agent-permission <phase> <cli>`. Claude 는 셸(Git Bash · cmd)로 돌리므로 경로를 따옴표로,
/// Codex 는 0.166 이 첫 토막 실행 · `cmd.exe /C` 셸 둘 다 관찰돼(실측 · 소스) **따옴표 없는 한 줄**이어야 두 경우 모두 돈다 — 그래서 경로에 공백이
/// 있으면(짧은 이름으로도 못 피하면) Codex 는 싣지 않는다([`codex_exe_path`]).
fn hook_command(exe: &str, phase: Phase, cli: Cli, quoted: bool) -> String {
    hook_command_named(exe, phase.as_str(), cli, quoted)
}

/// [`hook_command`] 의 몸 — 갈래 이름을 글자로(권한 단계가 아닌 [`INTERRUPT_STEP`] 도 같은 도우미를 지난다).
fn hook_command_named(exe: &str, step: &str, cli: Cli, quoted: bool) -> String {
    if quoted {
        format!("\"{exe}\" agent-permission {step} {}", cli.as_str())
    } else {
        format!("{exe} agent-permission {step} {}", cli.as_str())
    }
}

/// **Codex `Interrupt` 훅**(2026-11-02 — 실측: Esc 로 턴을 끊으면 0.166 은 `Stop` 대신 `Interrupt` 를 부른다)의 도우미 갈래 이름. 권한 경로
/// (`/agent-permission`)가 아니라 **신호 경로**로 `interrupt` 하나를 보낸다 — 그 타일의 신호 전용 토큰으로, 상태 점만 바꾼다([`helper`]).
pub(crate) const INTERRUPT_STEP: &str = "interrupt";

/// Claude `--settings` 파일의 내용(**순수**) — 그 프로세스의 훅 셋. 사용자 설정(전역 · 프로젝트)과 합쳐 돈다(실측 1차).
pub(crate) fn claude_settings(exe: &str) -> Value {
    let entry = |phase: Phase, timeout: u64| {
        json!([{ "matcher": "*", "hooks": [{ "type": "command", "command": hook_command(exe, phase, Cli::Claude, true), "timeout": timeout }] }])
    };
    json!({
        "hooks": {
            "PreToolUse": entry(Phase::Pre, MARK_TIMEOUT_SECS),
            "PermissionRequest": entry(Phase::Ask, CLAUDE_ASK_TIMEOUT_SECS),
            "PostToolUse": entry(Phase::Post, MARK_TIMEOUT_SECS),
        }
    })
}

/// Codex `-c` 낱말들(**순수**) — `hooks.<사건>=[{hooks=[{type='command',command='…',timeout=N}]}]`. 값에 `"` · `%` 가 없어야 셸 인용 규칙
/// (`agent_args::quote` — PowerShell 5.1 이 큰따옴표를 깨뜨린다)을 지난다 — TOML 은 홑따옴표 글자로 쓴다. 명령 글자가 늘 같아야 Codex 의 신뢰
/// (`/hooks` — 세션 플래그 층도 신뢰가 필요하다 · 한 번 하면 다음 실행에도 남는다, 실측 2026-11-01)가 유지된다.
pub(crate) fn codex_words(exe: &str) -> Option<Vec<String>> {
    if exe.chars().any(|c| c.is_whitespace() || c == '\'' || crate::agent_args::is_forbidden(c) || c.is_control()) {
        return None;
    }
    let one = |event: &str, phase: Phase, timeout: u64| {
        format!(
            "hooks.{event}=[{{hooks=[{{type='command',command='{}',timeout={timeout}}}]}}]",
            hook_command(exe, phase, Cli::Codex, false)
        )
    };
    Some(vec![
        "-c".into(),
        // `PreToolUse` 는 질문(`request_user_input`)이면 카드의 답을 기다린다(A안) — 시한이 질문 대기만큼
        one("PreToolUse", Phase::Pre, CODEX_PRE_TIMEOUT_SECS),
        "-c".into(),
        one("PermissionRequest", Phase::Ask, CODEX_ASK_TIMEOUT_SECS),
        "-c".into(),
        one("PostToolUse", Phase::Post, MARK_TIMEOUT_SECS),
        "-c".into(),
        format!(
            "hooks.Interrupt=[{{hooks=[{{type='command',command='{}',timeout={MARK_TIMEOUT_SECS}}}]}}]",
            hook_command_named(exe, INTERRUPT_STEP, Cli::Codex, false)
        ),
    ])
}

/// 앱 실행 파일의 경로(`/` 구분) — Codex 용은 공백이 있으면 짧은 이름으로 바꿔 본다(OS 를 타는 곳은 이 함수 하나).
fn codex_exe_path(exe: &std::path::Path) -> Option<String> {
    let long = exe.to_str()?.replace('\\', "/");
    if !long.contains(' ') {
        return Some(long);
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut buf = vec![0u16; 1024];
        // SAFETY: 입력은 NUL 로 끝나는 넓은 문자열이고 출력 버퍼의 길이를 그대로 넘긴다.
        let n = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
        } as usize;
        if n == 0 || n >= buf.len() {
            return None;
        }
        let short = std::ffi::OsString::from_wide(&buf[..n]).into_string().ok()?.replace('\\', "/");
        (!short.contains(' ')).then_some(short)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// 그 에이전트에 붙일 훅 낱말 — **로컬 AI 타일 · 감싸개 셸 타일만**(`agent_mcp::configured_tokens` 의 `inject_mcp_token`). Claude 는
/// `<설정 루트>/hooks/aynx-permission-hooks.json`(비밀 없음 · 내용이 같으면 다시 쓰지 않는다)을 `--settings` 로, Codex 는 `-c` 셋.
/// 실패는 빈 목록(카드 없이 평소대로). **블로킹**(파일).
pub(crate) fn hook_words(agent: &str) -> Vec<String> {
    let Ok(exe) = std::env::current_exe() else { return Vec::new() };
    match agent {
        "claude" => (|| {
            let exe_s = exe.to_str()?.replace('\\', "/");
            if exe_s.chars().any(|c| c == '"' || c.is_control()) {
                return None;
            }
            let dir = crate::instance::config_root()?.join("hooks");
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join("aynx-permission-hooks.json");
            let want = serde_json::to_string_pretty(&claude_settings(&exe_s)).ok()?;
            if std::fs::read_to_string(&path).ok().as_deref() != Some(want.as_str()) {
                std::fs::write(&path, want.as_bytes()).ok()?;
            }
            let p = path.to_str()?.replace('\\', "/");
            p.chars().all(|c| !crate::agent_args::is_forbidden(c) && !c.is_control()).then(|| vec!["--settings".to_string(), p])
        })()
        .unwrap_or_default(),
        "codex" => codex_exe_path(&exe).and_then(|p| codex_words(&p)).unwrap_or_default(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests;
