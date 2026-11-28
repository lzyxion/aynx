//! 타일 권한 카드 — 로컬 AI 타일(PTY 의 Claude Code · Codex TUI)이 권한을 물을 때 대화 면 카드에서도 답하게 하는 길의 순수 몸통. TUI 는 그대로다.
//! 훅은 타일 장식이 그 CLI 프로세스에만 건다 — **사용자 전역 훅 파일은 건드리지 않는다**.
//!
//! ## 토큰 — 신호 전용 토큰과 따로
//!
//! **권한 결정 토큰**은 스트림별이고 이 경로에서만 · 자기 스트림에만 통한다 — 신호 전용 토큰과 서로의 경로에서 401(시험 `permission_and_signal_tokens_do_not_cross`).
//! 값은 셸 환경에만 — 파이프 · GUI · 프런트 · 로그 · 이벤트에 없다(`Debug` 를 파생하지 않는다 — 시험 `permission_token_never_reaches_frontend`).
//!
//! ## 불변식
//!
//! - **PTY 에 쓰지 않는다** — 결정은 그 CLI 의 훅 응답(stdout)으로만 간다(시험 `permission_path_never_writes_pty`).
//!   카드의 결정은 작업안 승인(`approve_operation` · 승인 등급 프레임)이 아니다 — 쓰기 등급 op 다.
//! - **본문(명령 · 파일 내용 · URL · MCP 인자)은 카드로만** — 그 스트림을 보는 창의 통로로 가고, 로그 · `Debug` · MCP · 영속 파일 · 감사에는 없다. 표는 메모리뿐이다.
//!   예외 한 길 — 메신저 다리가 돌보는 스트림(그 턴이 끝날 때까지)이고 사람이 그 채널의 `[messenger] telegram_chat` · `discord_chat` · `slack_chat` 을 켰으면,
//!   권한 카드(질문 카드 빼고)의 **도구 이름과 입력 한 줄 요약**(최대 300자)이 짝지은 메신저 대화방으로 간다(메신저 회사 서버를 지난다 · 입력 전문은 가지 않는다).
//!   다리의 [허용] · [거절]도 같은 표의 결정이고 훅 응답으로만 간다(`server::tile_permission::resolve_from_bridge`).
//! - **원격 SSH 타일은 이 길이 없다** — 원격에는 토큰도 훅 낱말도 가지 않는다.
//! - 헤드리스 작업자 · 판정형 · 사이드 채팅 · 프로듀서에는 훅 낱말이 실리지 않고 공용 환경 정화(`pty::scrub_env_names`)가 토큰 이름을 걷는다 —
//!   혹시 훅이 불려도 곧바로 결정 없이 끝난다(`-p` 에서 결정 없음 = 거절).

pub(crate) mod helper;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::tile_env::stream_ok;

pub(crate) const PATH: &str = "/agent-permission";

/// 넘치면 413 — 도우미는 결정 없이 끝난다(TUI 창으로).
pub(crate) const MAX_BODY_BYTES: usize = 256 * 1024;

/// 롱폴 한 번 — 짧게 나눠야 훅 프로세스의 죽음(TUI 의 No · Esc 가 죽인다)을 곧 안다.
pub(crate) const HOLD_MS: u64 = 3_000;
/// 다음 `wait` 가 이만큼 안 오면 훅이 죽은 것으로 본다.
pub(crate) const LIVENESS_MS: u64 = 4_000;
/// F5 의 잠깐 떨어짐은 견딘다.
pub(crate) const NO_VIEWER_GRACE_MS: u64 = 5_000;
/// Claude 는 TUI 창이 함께 떠 있으니 길게.
pub(crate) const CLAUDE_WAIT_MS: u64 = 10 * 60 * 1000;
/// Codex 는 훅이 기다리는 동안 TUI 가 막힌다 — 짧게.
pub(crate) const CODEX_WAIT_MS: u64 = 2 * 60 * 1000;
/// 훅 `timeout`(초) — 앱의 시한보다 조금 길게(앱이 먼저 결정 없이 풀어야 한다).
pub(crate) const CLAUDE_ASK_TIMEOUT_SECS: u64 = 660;
pub(crate) const CODEX_ASK_TIMEOUT_SECS: u64 = 150;
pub(crate) const QUESTION_WAIT_MS: u64 = CLAUDE_WAIT_MS;
/// 질문(`request_user_input`)이면 Codex `PreToolUse` 가 그 자리에서 카드의 답을 기다린다 — 그래서 질문 대기만큼.
pub(crate) const CODEX_PRE_TIMEOUT_SECS: u64 = CLAUDE_ASK_TIMEOUT_SECS;
/// 도우미는 2초 안에 스스로 끝난다.
pub(crate) const MARK_TIMEOUT_SECS: u64 = 10;

const PRE_TTL_MS: u64 = 120_000;
const PRE_CAP: usize = 64;
const PENDING_CAP: usize = 16;
/// 거절 사유는 사람이 쓴 글이고 모델에게 간다.
const MESSAGE_MAX_CHARS: usize = 2_000;
const DEFAULT_DENY: &str = "The user denied this in Aynx.";

/// [이 세션 동안 허용] — Codex 의 훅 allow 는 세션 승인이 아니어서 앱이 기억했다가 같은 요청에 곧바로 allow 를 돌려준다.
pub(crate) const SESSION_ALLOW: bool = true;

/// 방송하지 않는다(`server::client::RELAYED` 밖) — 몸의 `windows` 가 건 통로에만 간다(본문이 든 사건).
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
// 권한 결정 토큰
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

/// 서버 `open` 이 셸을 띄우기 **전에**(타일 MCP 토큰과 같은 주인 번호). `None` 이면 카드 없이 연다.
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

/// 거뒀으면 참 — 부른 쪽이 그 스트림의 카드 · 세션 허용 기억도 버린다.
pub(crate) fn revoke(stream: &str, owner: u64) -> bool {
    tokens().revoke(stream, owner)
}

pub(crate) fn authenticate(stream: &str, token: &str) -> Option<u64> {
    let epoch = tokens().accepts(stream, token)?;
    (crate::session_core::core().live_epoch(stream) == Some(epoch)).then_some(epoch)
}

// ---------------------------------------------------------------------------
// 도우미 → 서버 봉투
// ---------------------------------------------------------------------------

/// **`Debug` 를 파생하지 않는다**(도구 입력 본문).
pub(crate) struct Envelope {
    pub cli: Cli,
    pub session: Option<String>,
    pub tool: String,
    pub tool_use_id: Option<String>,
    /// 자르기 전 입력의 요약 — `pre` ↔ `ask` ↔ `post` 를 잇는다.
    pub digest: String,
    pub input: Value,
    pub truncated: bool,
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

/// 틀리면 짧은 까닭 — 인증 뒤라 알려 줘도 된다.
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

/// 맨 위 `description` 은 뺀다 — Codex 셸은 `PermissionRequest` 에만 그 칸(승격 사유)을 실어, 빼지 않으면 `pre` 와 짝이 맞지 않는다.
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

/// 화면이 도구별로 그리는 열쇠.
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
        // Claude 의 질문 상자 — `PermissionRequest` 로 온다.
        "AskUserQuestion" => "question",
        // Codex 의 질문 상자 — `PreToolUse` 만 온다.
        "request_user_input" => "question",
        _ => "other",
    }
}

const ANSWER_MAX_CHARS: usize = 2_000;
const REASON_LABEL_MAX: usize = 40;
const REASON_ANSWER_MAX: usize = 1_000;
const REASON_MAX: usize = 4_000;
/// 모델은 `Tool call blocked by PreToolUse hook: <이유>` 를 받는다 — "실패가 아니라 사람의 답" 이라는 최소한의 말만 둔다.
pub(crate) const CODEX_ANSWER_HEAD: &str = "Answered in Aynx (the user's answer, not an error):";

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

/// 질문 원문은 싣지 않는다 — 모델은 제가 낸 질문을 알고, TUI 에 길게 다시 찍힌다. 재료는 카드의 질문 머리 · id 와 사람이 고르거나 친 답뿐이다.
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
const QUESTIONS_MAX: usize = 8;

/// 질문마다 사람 답 하나 — 수가 같고 · 비지 않고 · 2000자 이하 · 제어 문자(줄바꿈 빼고) 걷기. 돌려주는 순서 = 질문 순서: (질문 글, 다듬은 답, 머리 이름표).
/// 채팅 타일(`side_chat`)도 같은 판정을 쓴다.
pub(crate) fn checked_answers(input: &Value, answers: &Value) -> Option<Vec<(String, String, String)>> {
    let list = input.get("questions")?.as_array()?;
    let questions: Vec<&str> = list.iter().map(|q| q.get("question").and_then(Value::as_str)).collect::<Option<Vec<_>>>()?;
    if questions.is_empty() || questions.len() > QUESTIONS_MAX {
        return None;
    }
    let given = answers.as_object()?;
    if given.len() != questions.len() {
        return None;
    }
    let mut out = Vec::with_capacity(questions.len());
    for (i, q) in questions.into_iter().enumerate() {
        let raw = given.get(q)?.as_str()?;
        let a: String = raw.chars().filter(|c| !c.is_control() || *c == '\n').collect();
        let a = a.trim();
        if a.is_empty() || a.chars().count() > ANSWER_MAX_CHARS {
            return None;
        }
        let s = |k: &str| list[i].get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(str::to_owned);
        let label = s("header").or_else(|| s("id")).unwrap_or_else(|| format!("Q{}", i + 1));
        out.push((q.to_string(), a.to_string(), label));
    }
    Some(out)
}

/// **훅 응답으로만** CLI 에 간다(PTY 에 쓰지 않는다). Codex 는 훅으로 정식 답을 줄 길이 없어 `PreToolUse` 의 `deny` + 이유 글로 답을 전한다.
/// 답은 사람이 카드에서 고르거나 친 글뿐이다(Tauri 명령 — MCP · AI 길 없음).
pub(crate) fn answer_output(cli: Cli, tool: &str, input: &Value, truncated: bool, answers: &Value) -> Option<Value> {
    let codex = match (cli, tool) {
        (Cli::Claude, "AskUserQuestion") => false,
        (Cli::Codex, "request_user_input") => true,
        _ => return None,
    };
    if truncated {
        return None;
    }
    let checked = checked_answers(input, answers)?;
    let mut out = Map::new();
    let mut pairs = Vec::new();
    for (q, a, label) in checked {
        out.insert(q, Value::String(a.clone()));
        pairs.push((label, a));
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

/// [이 세션 동안 허용] 의 대상 열쇠 — **넓히는 접두어 규칙은 없다**(사용자 결정 · 셸은 정확히 같은 명령 글자). 잘린 입력이면 대상을 확정할 수 없어 `None`.
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
    /// 결정 없이 푼다 — CLI 가 평소 창을 띄운다.
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

pub(crate) fn clean_message(m: Option<&str>) -> Option<String> {
    let t: String = m?
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .take(MESSAGE_MAX_CHARS)
        .collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// `destination` 을 늘 `session` 으로 — 사용자 저장소에 `.claude/settings.local.json` 이 생기지 않게. 규칙 지우기 · 모드 넓히기는 버린다(사용자 결정).
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

/// **Codex 는 `behavior` + `message` 만** — 그 밖의 칸은 결정을 무효로 만든다(Codex 0.166 소스).
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
// 대기 표 — 시각 · 보는 창은 인자로
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Outcome {
    Decided(Value),
    /// 결정 없이 끝 — 빈 출력.
    Release,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Ev {
    pub stream: String,
    pub session_epoch: u64,
    pub body: Value,
}

/// 본문 없이 짝짓기 열쇠만.
struct PreMark {
    session: Option<String>,
    tool: String,
    digest: String,
    tool_use_id: String,
    at: u64,
    used: bool,
}

/// **`Debug` 를 파생하지 않는다**(본문).
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

#[derive(Debug, PartialEq)]
pub(crate) enum Asked {
    Pending(String),
    Now(Outcome),
}

type AllowScope = (String, u64, Option<String>);

#[derive(Default)]
pub(crate) struct Table {
    pending: HashMap<String, Pending>,
    pre: HashMap<String, VecDeque<PreMark>>,
    allowed: HashMap<AllowScope, HashSet<String>>,
    /// TUI 가 묻고 있는 스트림(Codex 만) — 카드 없이 물러났거나 카드가 풀린 때 서고, 그 스트림의 다음 훅 · 끊음 · 세션 끝이 걷는다.
    tui_asks: HashSet<String>,
    /// 늦게 온 일반 `PreToolUse` 신호가 Codex 질문 대기를 덮지 않게 종류만 기억한다.
    tui_questions: HashSet<String>,
}

/// 면 규칙("대화 면이면 카드, 터미널 면이면 TUI")은 **Codex 만**이고 서버 판정은 이 한 곳이다 — Codex 는 훅이 도는 동안 TUI 에 권한 창 · 질문 상자가 없다.
/// Claude 는 훅이 도는 동안에도 TUI 창이 함께 떠 있어(먼저 답한 쪽이 이긴다) 늘 카드를 세운다.
pub(crate) fn face_rule_applies(cli: Cli) -> bool {
    cli == Cli::Codex
}

impl Table {
    pub(crate) fn stream_cli(&self, stream: &str) -> Option<Cli> {
        self.pending.values().find(|p| p.stream == stream).map(|p| p.cli)
    }
}

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

    /// 사람이 턴을 끊었다 — Codex 는 Esc 에 훅 프로세스를 바로 죽이지 않을 수 있어 생존 시계보다 먼저 질문 카드를 걷는다.
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
        if let Some(e) = evs.first().map(|ev| ev.session_epoch) {
            evs.extend(self.clear_tui(stream, e));
        } else if self.tui_asks.remove(stream) {
            self.tui_questions.remove(stream);
            // 회차는 모른다 — 0: 창은 회차로 거르지 않고 스트림으로 지운다
            evs.push(tui_ev(stream, 0, false));
        }
        evs
    }

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

    /// `watchers` — Codex 면 그 타일을 **대화 면으로 보는** 창들만(서버가 고른다 — [`face_rule_applies`]).
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
        let mut evs: Vec<Ev> = self.clear_tui(stream, epoch).into_iter().collect();
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

    pub(crate) fn mark_tui(&mut self, stream: &str, epoch: u64) -> Option<Ev> {
        self.tui_asks.insert(stream.to_string()).then(|| tui_ev(stream, epoch, true))
    }

    pub(crate) fn clear_tui(&mut self, stream: &str, epoch: u64) -> Option<Ev> {
        self.tui_questions.remove(stream);
        self.tui_asks.remove(stream).then(|| tui_ev(stream, epoch, false))
    }

    pub(crate) fn codex_question_waiting(&self, stream: &str) -> bool {
        self.tui_questions.contains(stream)
            || self.pending.values().any(|p| p.stream == stream && p.cli == Cli::Codex && p.tool == "request_user_input" && p.outcome.is_none())
    }

    pub(crate) fn codex_question(&self, stream: &str, epoch: u64, id: &str) -> bool {
        self.pending.get(id).is_some_and(|p| p.stream == stream && p.session_epoch == epoch && p.cli == Cli::Codex && p.tool == "request_user_input")
    }

    /// 메신저 다리의 문지기.
    pub(crate) fn asking(&self, stream: &str) -> bool {
        self.tui_asks.contains(stream)
            || self.codex_question_waiting(stream)
            || self.pending.values().any(|p| p.stream == stream && p.outcome.is_none())
    }

    pub(crate) fn tui_asking(&self, stream: &str) -> bool {
        self.tui_asks.contains(stream)
    }

    /// 대화 면으로 보는 창이 없어졌다 — 선 카드를 결정 없이 풀어 TUI 가 묻게 한다.
    pub(crate) fn release_stream(&mut self, stream: &str) -> Vec<Ev> {
        let mut evs = Vec::new();
        let mut epoch = None;
        let mut question = false;
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

    /// 이 스트림의 카드가 아니면(없거나 남의 것) `Some(Release)`.
    pub(crate) fn begin_poll(&mut self, stream: &str, id: &str) -> Option<Outcome> {
        match self.pending.get_mut(id) {
            Some(p) if p.stream == stream => {
                p.polling += 1;
                None
            }
            _ => Some(Outcome::Release),
        }
    }

    pub(crate) fn take(&mut self, id: &str) -> Option<Outcome> {
        match self.pending.get(id) {
            None => Some(Outcome::Release),
            Some(p) if p.outcome.is_some() => self.pending.remove(id).and_then(|p| p.outcome),
            Some(_) => None,
        }
    }

    /// 다음 `wait` 를 기다리는 시계가 이때부터다.
    pub(crate) fn end_poll(&mut self, id: &str, now: u64) {
        if let Some(p) = self.pending.get_mut(id) {
            p.polling = p.polling.saturating_sub(1);
            p.last_poll_end = now;
        }
    }

    pub(crate) fn hook_lost(&mut self, id: &str) -> Vec<Ev> {
        match self.pending.remove(id) {
            Some(p) if p.outcome.is_none() => vec![gone(&p, id, "hook-gone")],
            _ => Vec::new(),
        }
    }

    /// **처음 하나만 먹는다** · `window` 가 그 스트림을 보는 창이어야 한다.
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
        // 답 없는 허용은 CLI 가 무엇을 할지 모른다
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
        if decision == Decision::Release && codex_k {
            evs.extend(self.mark_tui(&stream_k, epoch_k));
            if question_k {
                self.tui_questions.insert(stream_k);
            }
        }
        Ok((true, evs))
    }

    /// [`Self::decide`] 와 같은 규칙 — 모양이 틀리면 카드는 그대로 둔다(사람이 다시 고른다).
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

    /// 사람이 TUI 에서 먼저 [Yes] 했다 — 도구가 돌았다.
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

    /// `watchers` 가 `None` 이면 세션이 끝났다.
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

/// Claude 는 셸(Git Bash · cmd)로 돌리므로 경로를 따옴표로. Codex 0.166 은 첫 토막 실행 · `cmd.exe /C` 둘 다 관찰돼 **따옴표 없는 한 줄**이어야
/// 두 경우 모두 돈다 — 그래서 경로에 공백이 있으면(짧은 이름으로도 못 피하면) Codex 는 싣지 않는다([`codex_exe_path`]).
fn hook_command(exe: &str, phase: Phase, cli: Cli, quoted: bool) -> String {
    hook_command_named(exe, phase.as_str(), cli, quoted)
}

fn hook_command_named(exe: &str, step: &str, cli: Cli, quoted: bool) -> String {
    if quoted {
        format!("\"{exe}\" agent-permission {step} {}", cli.as_str())
    } else {
        format!("{exe} agent-permission {step} {}", cli.as_str())
    }
}

/// Codex 0.166 은 Esc 로 턴을 끊으면 `Stop` 대신 `Interrupt` 훅을 부른다. 이 갈래는 권한 경로가 아니라 **신호 경로**로 그 타일의 신호 전용 토큰을 써
/// 상태 점만 바꾼다.
pub(crate) const INTERRUPT_STEP: &str = "interrupt";

/// 사용자 설정(전역 · 프로젝트)과 합쳐 돈다.
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

/// 값에 `"` · `%` 가 없어야 셸 인용 규칙(`agent_args::quote` — PowerShell 5.1 이 큰따옴표를 깨뜨린다)을 지난다 — TOML 은 홑따옴표 글자로 쓴다.
/// 명령 글자가 늘 같아야 Codex 의 훅 신뢰(`/hooks` — 한 번 하면 다음 실행에도 남는다)가 유지된다.
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

/// **로컬 AI 타일 · 감싸개 셸 타일만**. 실패는 빈 목록(카드 없이 평소대로). **블로킹**(파일).
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
