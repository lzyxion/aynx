//! 사이드 채팅의 CLI 무관 사건 꼴 · 어댑터가 함께 쓰는 작은 재료. 순수.
//!
//! 사건은 serde 꼬리표 `t` · camelCase 로 프런트까지 그대로 간다 — [`Ev`] 갈래는 프런트 `EV_TAGS` 와 같아야 한다(`side-chat-api.test.ts` 가 대조).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

/// 사람이 보낸 글 — `Debug` 는 길이만(로그 · `Debug` 에 본문을 남기지 않는다).
#[derive(Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct Said(pub(crate) String);

impl std::fmt::Debug for Said {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Said(<{} bytes>)", self.0.len())
    }
}

/// 바이트.
pub(crate) const DETAIL_MAX: usize = 16 * 1024;
/// 글자.
pub(crate) const SUMMARY_MAX: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Cli {
    Claude,
    Codex,
}

/// 갈라 오기의 원본은 Rust 가 색인에서 찾은 대화 id 다 — 경로는 프런트에서 받지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode<'a> {
    Fresh,
    Resume { conv: &'a str },
    Fork { from: &'a str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PermKind {
    Tool,
    /// Codex 명령 실행(샌드박스 밖 — 권한 상승 요청).
    Command,
    FileChange,
    /// 외부 MCP 서버의 도구 하나 — 늘 묻는다(묻지 않기는 사이드 채팅의 모드 · 허용 목록으로 서버가 정한다).
    McpTool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResolvedBy {
    Human,
    Cli,
    Closed,
    /// 사람이 그 채팅에 정한 모드가 Auto 라 세션 서버가 허용으로 답했다.
    Auto,
    /// 사람이 그 채팅에서 허용한 종류(허용 목록)라 세션 서버가 허용으로 답했다.
    Remembered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Outcome {
    Ok,
    /// 사람이 끊었다 — 실패가 아니다.
    Interrupted,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum Ev {
    /// `efforts` 열쇠 `""` = 지금 뜬 CLI 기본 모델 · 빈 목록 = 강도를 받지 않는 모델 · 열쇠가 없는 모델 = 모른다.
    Ready {
        cli: Cli,
        version: Option<String>,
        model: Option<String>,
        models: Vec<String>,
        efforts: BTreeMap<String, Vec<String>>,
        conversation_id: Option<String>,
    },
    TurnStarted {
        turn: Option<String>,
    },
    /// `text` · `files` 는 어댑터가 채우지 않는다 — 세션 서버가 사람이 보낸 글을 얹는다. 없으면 칸째 싣지 않는다(프로듀서 채팅의 모양은 그대로).
    UserAccepted {
        client_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<Said>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        files: Vec<String>,
    },
    TextDelta {
        item: Option<String>,
        text: String,
    },
    /// 그 앞의 조각을 이것으로 갈음한다.
    Text {
        item: Option<String>,
        text: String,
    },
    ToolStarted {
        item: String,
        name: String,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },
    ToolOutput {
        item: String,
        text: String,
    },
    ToolFinished {
        item: String,
        ok: bool,
        output: Option<String>,
    },
    /// 사람의 답은 `side_chat_decide` 하나 — MCP 에는 길이 없다.
    Permission {
        request_id: String,
        kind: PermKind,
        title: String,
        detail: String,
        tool_name: String,
        /// 채팅 타일 어댑터만 채운다 — 사이드 채팅 · 프로듀서는 늘 None(몸에 칸이 없다).
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        /// 채팅 타일 어댑터만 — 늘 허용할 수 있을 때. 사이드 채팅 · 프로듀서는 늘 None(몸에 칸이 없다).
        #[serde(skip_serializing_if = "Option::is_none")]
        session_allow: Option<SessionAllow>,
    },
    PermissionResolved {
        request_id: String,
        decision: Option<Decision>,
        by: ResolvedBy,
    },
    /// 서버가 카드 없이 대신 허용한 요청 — 어댑터는 내지 않는다. 코어 장부에는 `Permission` 으로 적히고 화면으로 나가는 몸만 이 꼴이다.
    PermissionAuto {
        request_id: String,
        kind: PermKind,
        title: String,
        tool_name: String,
        by: ResolvedBy,
    },
    PermPolicy {
        mode: super::perm::PermMode,
        allow: Vec<String>,
    },
    TurnEnded {
        turn: Option<String>,
        outcome: Outcome,
        message: Option<String>,
    },
    ModelChanged {
        model: String,
    },
    /// `None` = CLI 기본.
    EffortChanged {
        effort: Option<String>,
    },
    /// 화면 문구는 프런트가 낱말로 고른다.
    Notice {
        code: &'static str,
        detail: Option<String>,
    },
    /// 이름만 — 명령 · URL · 값은 싣지 않는다.
    McpServers {
        names: Vec<String>,
    },
    /// 채팅 타일만 — CLI 자신의 권한 모드. `choices` = 칩이 고를 수 있는 값(어댑터가 정한다 · bypass · 묻지 않기 · 전체 접근은 들지 않는다).
    /// `chosen` 은 어댑터가 채우지 않는다 — 세션 서버가 다시 띄울 때 쓸 값(사람이 고른 것)을 얹는다.
    CliMode {
        mode: String,
        choices: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chosen: Option<String>,
    },
    /// 채팅 타일만 — `/` 메뉴 재료. 같은 내용이면 되풀이하지 않는다.
    Commands {
        commands: Vec<SlashCommand>,
        terminal: Vec<String>,
    },
    /// 채팅 타일만 — 맥락 사용량(받기만). `window` = 모르면 None. `source` = "turn" | "command" | "preCompact"(압축 전 값 · 다음 턴까지) | "tokenUsage".
    ContextUsage {
        used: u64,
        window: Option<u64>,
        source: &'static str,
    },
    /// 채팅 타일만 — 압축 표지(사람이 부른 것 · CLI 가 스스로 한 것 모두). Done 의 수는 모르면 None.
    Compaction {
        phase: CompactPhase,
        trigger: Option<String>,
        pre_tokens: Option<u64>,
        post_tokens: Option<u64>,
    },
    /// 채팅 타일만 — 이 프로세스가 되감을 수 있는 범위. 준비 뒤 한 번(바뀌면 다시).
    RewindCaps { files: bool, conversation: bool },
    /// 채팅 타일만 — 사람이 부른 되감기의 답. `files` 는 cwd 안이면 cwd 기준 `/` 상대 경로 · 밖이면 받은 그대로(각각 [`REWIND_PATH_BYTES`] 에서 자름).
    /// 미리 보기만 `files` · `insertions` · `deletions`(Claude) · `turns`(Codex · 모르면 None). `error` = CLI 가 준 글 한 줄(≤ 300 바이트).
    Rewind {
        phase: RewindPhase,
        anchor: String,
        scope: &'static str,
        can: bool,
        files: Vec<String>,
        more_files: u32,
        insertions: Option<u64>,
        deletions: Option<u64>,
        turns: Option<u32>,
        skipped_links: Option<u64>,
        error: Option<String>,
    },
    /// 채팅 타일만 — CLI 가 실은 MCP 서버의 상태(받기만 · 사람이 연 풍선의 읽기). `source` = "init" | "startup" | "list". 같은 내용이면 되풀이하지 않는다(`list` 는 늘 낸다).
    McpStatus { servers: Vec<McpRow>, source: &'static str },
    /// 채팅 타일만 — Codex 스레드 목표. None = 없음(지움).
    Goal { goal: Option<GoalView> },
    /// 채팅 타일만 — Codex 검토 표지. 결과 글은 뒤따르는 모델 글(`Text`)로 오고 표지에는 싣지 않는다(`text` 는 늘 None).
    /// 끝 표지(`Done` · `Stopped`)는 검토 턴이 끝날 때 `TurnEnded` 바로 앞에 낸다 — 결과 글 뒤에 서게.
    Review { phase: ReviewPhase, label: String, text: Option<String> },
    /// 채팅 타일만 — Codex 모델마다 고를 수 있는 속도 등급 · 스레드의 지금 값.
    ServiceTiers { by_model: BTreeMap<String, Vec<Tier>>, thread: Option<String> },
    /// 어댑터가 낼 때는 악수 실패(`protocol`)다 — 서버는 그 프로세스를 닫는다.
    Exited {
        code: Option<i32>,
        reason: &'static str,
    },
}

/// `/` 메뉴 한 줄 — 이름 · 설명은 CLI 가 알린 그대로([`slash_desc`] · 상한). 스킬 파일 경로 · 명령 몸은 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SlashCommand {
    pub name: String,
    /// ≤ 240 글자 · ≤ 300 바이트 · 없으면 ""
    pub description: String,
    /// Claude `argumentHint` ≤ 160 바이트 · Codex ""
    pub hint: String,
    /// "builtin" | "skill" | "command"
    pub kind: &'static str,
    /// ≤ 4 · 각각 [`slash_name_ok`]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CompactPhase {
    Started,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RewindPhase {
    Preview,
    Done,
    Failed,
}

/// 미리 보기 파일 목록 상한 · 경로 하나 상한(바이트).
pub(crate) const REWIND_FILES_MAX: usize = 50;
pub(crate) const REWIND_PATH_BYTES: usize = 512;
const REWIND_ERROR_BYTES: usize = 300;

/// 되감기 범위 낱말 — 이 셋 밖은 `None`.
pub(crate) fn rewind_scope(s: &str) -> Option<&'static str> {
    ["files", "conversation", "both"].into_iter().find(|x| *x == s)
}

/// [`Ev::Rewind`] 의 덧칸 — 비운 값이 기본.
#[derive(Default)]
pub(crate) struct RewindMore {
    pub files: Vec<String>,
    pub more_files: u32,
    pub insertions: Option<u64>,
    pub deletions: Option<u64>,
    pub turns: Option<u32>,
    pub skipped_links: Option<u64>,
    pub error: Option<String>,
}

pub(crate) fn rewind_ev(phase: RewindPhase, anchor: &str, scope: &'static str, can: bool, m: RewindMore) -> Ev {
    Ev::Rewind {
        phase,
        anchor: anchor.to_string(),
        scope,
        can,
        files: m.files,
        more_files: m.more_files,
        insertions: m.insertions,
        deletions: m.deletions,
        turns: m.turns,
        skipped_links: m.skipped_links,
        error: m.error,
    }
}

/// CLI 가 준 되감기 오류 글 — 한 줄 · 300 바이트.
pub(crate) fn rewind_error(s: &str) -> String {
    clip(&one_line(s), REWIND_ERROR_BYTES).0
}

/// MCP 상태 한 줄 — **허용 목록**: 이 다섯 칸 밖(값 · URL · 머리글 · 명령 · 인자 · 환경 · 오류 글 · 서버 정보 · 도구 이름)은 어댑터가 읽지도 싣지도 않는다.
/// 낱말은 고정 표로만 옮긴다(CLI 글을 그대로 싣지 않는다).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpRow {
    /// [`mcp_row_name`] 을 지난 것.
    pub name: String,
    /// "connected" | "connecting" | "needsAuth" | "failed" | "disabled" | "cancelled" | "unknown"
    pub state: &'static str,
    /// "oauth" | "bearer" | "notLoggedIn" | "none" · 모름 = None
    pub auth: Option<&'static str>,
    pub tools: Option<u32>,
    /// Claude "user" | "project" | "local" | "cloud" | "plugin" | "app" | "other" · Codex "plugin" | "config"
    pub scope: &'static str,
}

pub(crate) const MCP_ROWS_MAX: usize = 64;
const MCP_NAME_BYTES: usize = 96;

/// 한 줄 · 96 바이트 · 비면 `None`(그 줄은 버린다).
pub(crate) fn mcp_row_name(s: &str) -> Option<String> {
    let name = clip(&one_line(s), MCP_NAME_BYTES).0;
    (!name.is_empty()).then_some(name)
}

/// 같은 이름은 첫 줄만 · [`MCP_ROWS_MAX`] 까지.
pub(crate) fn push_mcp_row(out: &mut Vec<McpRow>, row: McpRow) {
    if out.len() < MCP_ROWS_MAX && !out.iter().any(|r| r.name == row.name) {
        out.push(row);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoalView {
    /// CLI 가 알린 그대로(줄바꿈 유지 · [`GOAL_VIEW_BYTES`] 에서 자름).
    pub objective: String,
    /// "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete" | "unknown"
    pub status: &'static str,
    pub tokens_used: u64,
    pub token_budget: Option<u64>,
    pub seconds_used: u64,
    /// 이 프로세스가 도는 동안 Aynx 의 `set` 없이 선 목표(모델이 정한 것) — CLI 는 출처를 알리지 않는다. 붙을 때 이미 있던 목표는 출처를 몰라 false.
    pub auto: bool,
}

/// 목표 글 상한(글자) — CLI 가 받는 상한과 같다.
pub(crate) const OBJECTIVE_CHARS: usize = 4000;
const GOAL_VIEW_BYTES: usize = 16 * 1024;
/// 고를 수 있는 토큰 한도 — 이 다섯 밖은 서버가 거절한다.
pub(crate) const GOAL_BUDGETS: [u64; 5] = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const GOAL_STATUSES: [&str; 6] = ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"];

/// `ThreadGoal` → 화면 꼴. 상태 낱말은 고정 표(모르면 "unknown") · 꼴이 틀리면 `None`.
pub(crate) fn goal_view(g: &Value, auto: bool) -> Option<GoalView> {
    let objective = g["objective"].as_str()?;
    let status = g["status"].as_str().and_then(|s| GOAL_STATUSES.into_iter().find(|x| *x == s)).unwrap_or("unknown");
    let n = |k: &str| g[k].as_u64().unwrap_or(0);
    Some(GoalView {
        objective: clip(objective, GOAL_VIEW_BYTES).0,
        status,
        tokens_used: n("tokensUsed"),
        token_budget: g["tokenBudget"].as_u64(),
        seconds_used: n("timeUsedSeconds"),
        auto,
    })
}

/// 사람 op 가 고른 목표 일 — 줄은 어댑터가 짓는다.
pub(crate) enum GoalAction<'a> {
    Set { objective: &'a str, budget: u64 },
    Pause,
    Resume,
    Clear,
}

impl GoalAction<'_> {
    pub(crate) fn word(&self) -> &'static str {
        match self {
            GoalAction::Set { .. } => "set",
            GoalAction::Pause => "pause",
            GoalAction::Resume => "resume",
            GoalAction::Clear => "clear",
        }
    }
}

/// 검토 대상 — 서버가 [`review_target`] 로 본 것만 선다. `Debug` 를 파생하지 않는다(사람이 쓴 지침).
#[derive(Clone, PartialEq)]
pub(crate) enum ReviewTarget {
    UncommittedChanges,
    BaseBranch { branch: String },
    Commit { sha: String },
    Custom { instructions: String },
}

const REVIEW_BRANCH_BYTES: usize = 200;
const REVIEW_INSTRUCTIONS_BYTES: usize = 4 * 1024;

impl ReviewTarget {
    /// 로그에 남겨도 되는 것은 이 낱말뿐이다.
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            ReviewTarget::UncommittedChanges => "uncommittedChanges",
            ReviewTarget::BaseBranch { .. } => "baseBranch",
            ReviewTarget::Commit { .. } => "commit",
            ReviewTarget::Custom { .. } => "custom",
        }
    }

    /// `review/start` 의 `target` (스키마 꼴 그대로).
    pub(crate) fn cli_json(&self) -> Value {
        match self {
            ReviewTarget::UncommittedChanges => serde_json::json!({"type": "uncommittedChanges"}),
            ReviewTarget::BaseBranch { branch } => serde_json::json!({"type": "baseBranch", "branch": branch}),
            ReviewTarget::Commit { sha } => serde_json::json!({"type": "commit", "sha": sha}),
            ReviewTarget::Custom { instructions } => serde_json::json!({"type": "custom", "instructions": instructions}),
        }
    }
}

/// 순수 — 열쇠는 `type` 과 그 종류의 칸 하나뿐. 브랜치 1–200 바이트 `[A-Za-z0-9._/-]` · `..` 없음 · 앞 `-` 없음 / sha 7–64 hex /
/// 지침 1–4 KiB(다듬은 뒤) · 줄바꿈 밖 제어 문자 없음. **Aynx 는 git 을 부르지 않는다** — 있는지는 CLI 가 판정한다.
pub(crate) fn review_target(v: &Value) -> Option<ReviewTarget> {
    let o = v.as_object()?;
    let field = |k: &str| -> Option<&str> { (o.len() == 2).then(|| o.get(k)?.as_str()).flatten() };
    match o.get("type")?.as_str()? {
        "uncommittedChanges" if o.len() == 1 => Some(ReviewTarget::UncommittedChanges),
        "baseBranch" => {
            let b = field("branch")?;
            let ok = !b.is_empty()
                && b.len() <= REVIEW_BRANCH_BYTES
                && !b.starts_with('-')
                && !b.contains("..")
                && b.bytes().all(|c| c.is_ascii_alphanumeric() || b"._/-".contains(&c));
            ok.then(|| ReviewTarget::BaseBranch { branch: b.to_string() })
        }
        "commit" => {
            let s = field("sha")?;
            ((7..=64).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_hexdigit())).then(|| ReviewTarget::Commit { sha: s.to_string() })
        }
        "custom" => {
            let i = field("instructions")?.trim();
            let ok = !i.is_empty() && i.len() <= REVIEW_INSTRUCTIONS_BYTES && !i.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t');
            ok.then(|| ReviewTarget::Custom { instructions: i.to_string() })
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReviewPhase {
    Started,
    Done,
    /// 검토 턴이 끊겨 끝났다 — CLI 는 끊긴 검토에도 끝 항목을 낸다.
    Stopped,
}

/// 속도 등급 하나 — id 는 [`word_ok`] · 32 바이트 · 이름 40 · 설명 120 바이트(CLI 글 그대로).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct Tier {
    pub id: String,
    pub name: String,
    pub description: String,
}

pub(crate) const TIER_ID_BYTES: usize = 32;
const TIERS_PER_MODEL: usize = 8;

/// 사람이 고를 수 있는 등급 id 의 꼴.
pub(crate) fn tier_ok(s: &str) -> bool {
    word_ok(s) && s.len() <= TIER_ID_BYTES
}

/// `model/list` 의 `serviceTiers[]` — 꼴이 맞는 것만 · 모델마다 8 개까지.
pub(crate) fn tiers_of(list: &Value) -> Vec<Tier> {
    let mut out: Vec<Tier> = Vec::new();
    for t in list.as_array().into_iter().flatten() {
        let Some(id) = t["id"].as_str().filter(|s| tier_ok(s)) else { continue };
        if out.len() >= TIERS_PER_MODEL || out.iter().any(|x| x.id == id) {
            continue;
        }
        let name = clip(&one_line(t["name"].as_str().unwrap_or(id)), 40).0;
        let description = clip(&one_line(t["description"].as_str().unwrap_or("")), 120).0;
        out.push(Tier { id: id.to_string(), name, description });
    }
    out
}

pub(crate) const COMMANDS_MAX: usize = 300;
pub(crate) const ALIASES_MAX: usize = 4;
const DESC_CHARS: usize = 240;
const DESC_BYTES: usize = 300;
pub(crate) const HINT_BYTES: usize = 160;
/// `Commands` 사건 직렬화 상한 — 넘으면 설명을 비운다.
const COMMANDS_EV_MAX: usize = 64 * 1024;

/// 1–96 바이트 · ASCII 영숫자와 `-_:.` 만(실측 이름: `anthropic-skills:docx` · `__remote-workflow` · `code-review`).
pub(crate) fn slash_name_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 96 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
}

/// 한 줄 · 240 글자에서 자른 뒤 300 바이트 경계.
pub(crate) fn slash_desc(s: &str) -> String {
    let flat: String = s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut out: String = flat.chars().take(DESC_CHARS).collect();
    if flat.chars().count() > DESC_CHARS {
        out.push('…');
    }
    clip(&out, DESC_BYTES).0
}

/// 64 KiB 를 넘으면 설명을 비운다(개수는 이미 [`COMMANDS_MAX`] 안).
pub(crate) fn commands_ev(mut commands: Vec<SlashCommand>, terminal: Vec<String>) -> Ev {
    commands.truncate(COMMANDS_MAX);
    let ev = Ev::Commands { commands, terminal };
    if serde_json::to_string(&ev).map_or(0, |s| s.len()) <= COMMANDS_EV_MAX {
        return ev;
    }
    let Ev::Commands { mut commands, terminal } = ev else { unreachable!() };
    for c in &mut commands {
        c.description.clear();
    }
    Ev::Commands { commands, terminal }
}

/// [이 대화에서 늘 허용] 이 실을 것의 **요약** — 실을 값 자체(제안 · 결정 낱말)는 어댑터의 대기 장부에만 있다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionAllow {
    /// "mode" | "rules" | "dirs" | "command"
    pub kind: &'static str,
    pub detail: String,
}

/// 사람 결정 가운데 allow/deny 가 아닌 것 — `Debug` 를 파생하지 않는다(답 본문).
pub(crate) enum TileAnswer<'a> {
    AllowSession,
    /// 질문 글 → 답 글
    Answers(&'a Value),
}

/// stdin 줄은 끝 `\n` 없이.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Step {
    pub evs: Vec<Ev>,
    pub stdin: Vec<String>,
}

impl Step {
    pub(crate) fn ev(e: Ev) -> Self {
        Step { evs: vec![e], stdin: Vec::new() }
    }
    pub(crate) fn line(s: String) -> Self {
        Step { evs: Vec::new(), stdin: vec![s] }
    }
}

/// 사람 글에 붙인 그림 하나 — 서버가 앱 첨부 자리 안의 그림 파일인지 본 뒤에만 선다. `data` 는 Claude 몫 base64(Codex 는 `None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UserImage {
    pub path: String,
    pub media_type: &'static str,
    pub data: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Dropped {
    pub bad: u32,
    pub unknown: u32,
}

/// 인자 배열 · JSON 에 싣기 전에 Rust 가 다시 본다.
pub(crate) fn word_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-:[]".contains(&b))
}

/// 빈 값 = CLI 기본. 대화 중 바꾸기(`encode_set_model`)는 빈 값을 받지 않는다(그때는 프런트가 닫고 다시 연다).
pub(crate) fn model_ok(s: &str) -> bool {
    s.is_empty() || word_ok(s)
}

/// Claude 는 모르는 강도 낱말을 조용히 무시하고 성공으로 답한다 — 그래서 Rust 가 악수의 목록으로 거른다.
pub(crate) fn effort_ok(efforts: &BTreeMap<String, Vec<String>>, e: &str) -> bool {
    word_ok(e) && (efforts.values().all(Vec::is_empty) || efforts.values().any(|l| l.iter().any(|x| x == e)))
}

pub(crate) fn uuid_ok(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub(crate) fn one_line(s: &str) -> String {
    let flat: String = s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut out: String = flat.chars().take(SUMMARY_MAX).collect();
    if flat.chars().count() > SUMMARY_MAX {
        out.push('…');
    }
    out
}

pub(crate) fn cap(s: &str) -> String {
    if s.len() <= DETAIL_MAX {
        return s.to_string();
    }
    let mut end = DETAIL_MAX;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…(잘림)", &s[..end])
}

/// 채팅 타일 권한 카드의 `input` — 직렬화가 [`DETAIL_MAX`] 를 넘으면 싣지 않는다(카드는 `detail` 로 그린다).
pub(crate) fn tile_input(v: Value) -> Option<Value> {
    (v.to_string().len() <= DETAIL_MAX).then_some(v)
}

/// 바이트 상한에서 글자 경계로 자른다 — 둘째 값 = 잘렸다.
pub(crate) fn clip(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s.to_string(), false);
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

/// `mcp__<서버>__<도구>` — Codex 어댑터도 Claude 와 같은 꼴로 낸다.
pub(crate) fn split_mcp_tool<'a>(name: &'a str, server: Option<&'a str>) -> Option<(&'a str, &'a str)> {
    let rest = name.strip_prefix("mcp__")?;
    if let Some(s) = server {
        if let Some(tool) = rest.strip_prefix(s).and_then(|t| t.strip_prefix("__")) {
            return Some((s, tool));
        }
    }
    rest.split_once("__").filter(|(s, t)| !s.is_empty() && !t.is_empty())
}

pub(crate) fn mcp_summary(input: &Value) -> String {
    input.as_object().and_then(|o| o.values().find_map(Value::as_str)).map(one_line).unwrap_or_default()
}

pub(crate) fn str_of(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// `"2.1.331"` → `[2, 1, 331]`. 시험판 꼬리 · 빈 조각 · 조각 수가 다르면 `None` — 부르는 쪽이 확인하지 않은 버전으로 본다.
pub(crate) fn semver3(s: &str) -> Option<[u64; 3]> {
    let mut out = [0u64; 3];
    let mut parts = s.split('.');
    for slot in &mut out {
        let p = parts.next().filter(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))?;
        *slot = p.parse().ok()?;
    }
    parts.next().is_none().then_some(out)
}

/// 프로듀서 지침 머리글의 틀 — 갈라 온 Codex 프로듀서의 첫 사람 글 앞에 붙는다(`thread/fork` 에 실은 `developerInstructions` 는 서지 않는다).
/// 사이에는 프로듀서 고정 지침만 든다 — 사람 · AI 글은 넣지 않는다. 깨움 틀(`orchestration::wake::PREFIX`)과 다른 글자로 시작해야 기록 판독이 섞지 않는다.
pub(crate) const BRIEF_OPEN: &str = "[Aynx producer brief — fixed app text for this chat, not from the person]\n";
pub(crate) const BRIEF_CLOSE: &str = "\n[end of Aynx producer brief — the person's message follows]\n\n";

pub(crate) fn parse_producer_brief(text: &str) -> Option<&str> {
    let rest = text.strip_prefix(BRIEF_OPEN)?;
    let at = rest.find(BRIEF_CLOSE)?;
    Some(&rest[at + BRIEF_CLOSE.len()..])
}

pub(crate) const LINK_NAME_MAX: usize = 60;
pub(crate) const LINK_HEADER_NONE: &str = "[연결된 타일 없음 — 사람이 연결을 끊었습니다] ";

/// 연결 머리글 — 연결이 서거나 바뀐 뒤 사람의 다음 글 앞에 붙는 고정 앱 글. 값 · 출력은 붙이지 않는다(AI 가 도구로 읽는다).
/// `[` 로 시작한다(`<` 아님 — 기록 보기 규칙). 타일 코드(`p6`)는 넣지 않는다 — F5 · 옮기기에 번호가 바뀐다. 옛 기록의 `p6 로컬` 꼴도 그대로 읽힌다.
pub(crate) fn link_header(link: Option<(&str, &str)>) -> String {
    let Some((stream, name)) = link else {
        return LINK_HEADER_NONE.to_string();
    };
    let flat: String = name.chars().map(|c| if c.is_control() || c == '[' || c == ']' { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = flat.chars().take(LINK_NAME_MAX).collect();
    let stream: String = stream.chars().filter(|c| link_stream_char(*c)).take(LINK_STREAM_MAX).collect();
    if name.is_empty() {
        format!("{LINK_HEADER_OPEN}{LINK_SESSION}{stream}{LINK_HEADER_CLOSE}")
    } else {
        format!("{LINK_HEADER_OPEN}{name}{LINK_NAME_SEP}{LINK_SESSION}{stream}{LINK_HEADER_CLOSE}")
    }
}

pub(crate) fn link_headers(links: &[(&str, &str)]) -> String {
    if links.is_empty() {
        return LINK_HEADER_NONE.to_string();
    }
    links.iter().map(|l| link_header(Some(*l))).collect()
}

/// 입력 칸 칩의 이름(`hint`)이 먼저 — 같은 타일이면 기록 칩과 입력 칸 칩이 같은 글자가 된다.
pub(crate) fn link_display_name(hint: Option<&str>, fallback: Option<&str>) -> String {
    let pick = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    pick(hint).or_else(|| pick(fallback)).unwrap_or_default()
}

// 머리글 조각 — 짓기와 읽기가 같은 글자를 쓴다. 기록에 글자 그대로 남는다 — 바꾸면 옛 기록을 못 읽는다.
const LINK_HEADER_OPEN: &str = "[연결된 타일: ";
const LINK_NAME_SEP: &str = " · ";
const LINK_SESSION: &str = "세션 ";
const LINK_HEADER_CLOSE: &str = "] ";
const LINK_STREAM_MAX: usize = 128;

/// `tile_env::stream_ok` 의 글자와 같다.
fn link_stream_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct LinkNote {
    pub labels: Vec<String>,
    pub unlinked: bool,
}

pub(crate) fn parse_link_note(text: &str) -> Option<(LinkNote, &str)> {
    if let Some(rest) = text.strip_prefix(LINK_HEADER_NONE) {
        return Some((LinkNote { labels: Vec::new(), unlinked: true }, rest));
    }
    let mut labels = Vec::new();
    let mut rest = text;
    while let Some((label, after)) = parse_one_header(rest) {
        labels.push(label.to_string());
        rest = after;
    }
    (!labels.is_empty()).then_some((LinkNote { labels, unlinked: false }, rest))
}

fn parse_one_header(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix(LINK_HEADER_OPEN)?;
    let end = rest.find(']')?;
    let body = rest[end..].strip_prefix(LINK_HEADER_CLOSE)?;
    let inner = &rest[..end];
    let (name, stream) = match inner.rsplit_once(&format!("{LINK_NAME_SEP}{LINK_SESSION}")) {
        Some((name, stream)) if !name.is_empty() => (name, stream),
        Some(_) => return None,
        None => ("", inner.strip_prefix(LINK_SESSION)?),
    };
    let stream_ok = !stream.is_empty() && stream.chars().count() <= LINK_STREAM_MAX && stream.chars().all(link_stream_char);
    let name_ok = name.chars().count() <= LINK_NAME_MAX
        && !name.chars().any(|c| c.is_control() || c == '[')
        && name.split_whitespace().collect::<Vec<_>>().join(" ") == name;
    (stream_ok && name_ok).then_some((name, body))
}

/// `server::side_chat::with_file_refs` 가 짓고 [`parse_file_refs`] 가 읽는다 — 같은 글자.
pub(crate) const FILE_REF_PREFIX: &str = "Attached file: ";
/// 보내기의 첨부 상한과 같다.
const FILE_REFS_MAX: usize = 8;

/// `with_file_refs` 가 짓는 꼴 그대로 맨 끝이 꼬리일 때만 읽는다 — 닮은 글 · 가운데의 꼬리는 손대지 않는다.
pub(crate) fn parse_file_refs(text: &str) -> Option<(Vec<String>, &str)> {
    parse_file_refs_by(text, file_ref_name)
}

/// 같은 꼬리 꼴 — 경로 판정만 부르는 쪽이 준다(채팅 타일 꼬리는 앱 첨부 자리 `<root>/<64hex>/<이름>`).
pub(crate) fn parse_file_refs_by(text: &str, name_of: impl Fn(&str) -> Option<String>) -> Option<(Vec<String>, &str)> {
    let mut names = Vec::new();
    let mut end = text.len();
    loop {
        let start = text[..end].rfind('\n').map_or(0, |i| i + 1);
        let Some(name) = text[start..end].strip_prefix(FILE_REF_PREFIX).and_then(&name_of) else { break };
        names.push(name);
        if names.len() > FILE_REFS_MAX {
            return None;
        }
        if start == 0 {
            names.reverse();
            return Some((names, ""));
        }
        end = start - 1;
    }
    if names.is_empty() {
        return None;
    }
    let body = text[..end].strip_suffix('\n')?;
    if body.is_empty() || body.ends_with('\n') || body.ends_with('\r') {
        return None;
    }
    names.reverse();
    Some((names, body))
}

fn file_ref_name(path: &str) -> Option<String> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return None;
    }
    let b = path.as_bytes();
    let absolute = path.starts_with('/') || path.starts_with(r"\\") || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/'));
    let mut parts = path.rsplit(['\\', '/']);
    let name = parts.next().filter(|n| !n.is_empty())?;
    (absolute && parts.next() == Some("attachments")).then(|| name.to_string())
}

pub(crate) const IMAGE_ALT_MAX: usize = 80;

/// 생성한 그림 → 마크다운 — 실시간(`codex.rs`)과 기록 다시 읽기(`agent_transcript::codex_events`)가 같은 글자를 낸다. 그림 바이트는 싣지 않는다.
/// 경로의 퍼센트 인코딩은 프런트 `markdown.ts` 의 `readTarget` · `classifyDocHref` 를 지나도록 고른 글자다 — `\` 는 그대로(드라이브 경로).
pub(crate) fn image_markdown(alt: &str, path: &str) -> String {
    let flat: String = alt.chars().map(|c| if c.is_control() || matches!(c, '[' | ']' | '\\' | '`') { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut alt: String = flat.chars().take(IMAGE_ALT_MAX).collect();
    if flat.chars().count() > IMAGE_ALT_MAX {
        alt.push('…');
    }
    if alt.is_empty() {
        alt.push_str("image");
    }
    let mut dest = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_control() || matches!(c, '%' | ' ' | '(' | ')' | '<' | '>' | '[' | ']' | '#' | '?' | '`') {
            let mut b = [0u8; 4];
            for byte in c.encode_utf8(&mut b).bytes() {
                dest.push_str(&format!("%{byte:02X}"));
            }
        } else {
            dest.push(c);
        }
    }
    format!("![{alt}]({dest})")
}
