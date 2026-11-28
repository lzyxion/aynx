//! Codex 어댑터 — `codex app-server`(stdio 줄 단위 JSON-RPC · experimental). 순수 — 파일 읽기는 서버 몫이다
//! (docs/log/2026-10-23-side-chat-structured-spike.md).
//!
//! - 사용자 MCP 서버는 이름마다 `-c mcp_servers.<이름>.enabled=false` 로 끈다 — `-c mcp_servers={}` 는 합쳐져 안 꺼진다.
//! - `tools.web_search.context_size` 는 설정 스키마의 값이어야 한다 — 틀린 값이면 Codex 가 설정 읽기에서 죽는다.
//! - 전역 지침 파일은 싣지 않는다 — `developerInstructions` 는 앱 고정 지침 + 사람의 사이드 채팅 지침뿐이다.
//! - 승인 요청이 아닌 서버 요청(`item/tool/requestUserInput` · 폼 · URL elicitation · 모르는 것)은 곧바로 거절 · 취소로 답한다 — 영영 기다리지 않게.
//! - 채팅 타일([`tile_argv`] · [`Codex::tile`])은 위의 끄기 · 정책 · 지침을 싣지 않는다 — 사용자 `config.toml` 이 정한다.
//!   사람이 칩에서 모드를 고른 뒤에만 매 `turn/start` 에 정책 프리셋을 싣는다(`approvalPolicy` 는 늘 `"on-request"` · 샌드박스는 `readOnly` | `workspaceWrite` —
//!   **`"never"` · `"untrusted"` · `dangerFullAccess` 를 내는 길은 없다**). 계획 = `collaborationMode` — 그래서 채팅 타일 악수만 `experimentalApi:true` 다.
//! - 채팅 타일의 [이 대화에서 늘 허용] = `acceptForSession` — 일반 명령 승인만(같은 명령 글자만 덮는다). 파일 승인 · apply_patch 감싸개에 주면 그 세션의
//!   모든 패치를 묻지 않으므로 내지 않는다. `acceptWithExecpolicyAmendment`(실행 정책을 고친다) · `availableDecisions` 는 쓰지 않는다.
//! - 채팅 타일의 질문(`item/tool/requestUserInput`)은 카드 — 비밀 질문(`isSecret`)이 하나라도 있으면 글을 어디에도 싣지 않고 터미널 안내로 거절한다.
//! - 채팅 타일의 스킬 목록은 악수 끝 `skills/list` 한 번 — 사건에는 이름 · 설명만, 경로는 어댑터에만 남아 사람이 고른 이름의 `skill` 항목에 실린다.
//!   `thread/compact/start` 는 턴 중에도 CLI 가 받아 돌던 턴을 끊으므로 어댑터 · 서버가 먼저 거절한다. 맥락 사용량은 `tokenUsage` 알림에서 받기만 한다.
//! - 외부 MCP 서버의 도구 승인은 늘 `prompt` 다 — 묻지 않기는 CLI 에 맡기지 않고 세션 서버가 채팅의 모드 · 허용 목록으로 답한다.
//! - 한 번 실은 강도는 다음 턴에도 남는다(`null` 은 "그대로") — CLI 기본으로 되돌리려면 스레드가 처음 알린 `reasoningEffort` 를 다시 싣는다.
//! - 채팅 타일 되감기 = `thread/revert{threadId, beforeTurnId}` — 대화만 자르고 파일은 그대로다. 미리 보기는 `thread/turns/list` 읽기로 빠질 턴을 센다.
//!   CLI 는 턴 중 · 승인 대기 중에도 되감으니(돌던 턴을 끊는다) 어댑터 · 서버가 먼저 거절한다. `thread/reverted` 는 버린다.
//! - `imageGeneration` 의 끝 줄은 그림 바이트를 품어 1 MiB 를 넘는다 — 서버의 줄 상한(`server/chat_proc/spawn.rs` 의 `STDOUT_LINE_MAX`)이 받쳐야 한다.
//! - 채팅 타일 검토(`review/start` · inline)는 **턴 id 가 둘**이다 — 답 · 항목 · `turn/completed` 는 A, `turn/started` 는 B(`rootTurnId: A`)이고
//!   B 의 끝은 오지 않으며 **끊기는 B 로만** 된다. 그래서 `live_turn` 은 B, 턴 끝은 A 의 completed. CLI 가 지은 지시 `userMessage{clientId:null}` 은 사람 말이 아니다.
//! - 채팅 타일 목표(`thread/goal/*`)는 출처를 알리지 않는다 — Aynx 가 정한 것은 [`Codex::goal_set_by_us`] 로만 안다. `active` 목표는 끊기만으로 멈추지 않고,
//!   `thread/resume` 만으로도 CLI 가 스스로 턴을 연다(막을 수 없다 — 사람 글 없는 턴은 그대로 그린다).
//! - 속도 등급은 턴 몸의 `serviceTierForTurn` 에만 — CLI 는 없는 값도 받으므로 그 모델의 `serviceTiers` 밖은 어댑터가 거절한다(`review/start` 에는 칸이 없다).
//! - MCP 상태 읽기(`mcpServerStatus/list`)는 쪽이 크다 — 작은 쪽으로 나눠 읽고 이름 · 상태 · 인증 낱말 · 도구 수 · 플러그인 여부만 꺼낸다([`mcp_rows_codex`]).

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Value};

use super::event::{
    cap, clip, commands_ev, effort_ok, goal_view, image_markdown, mcp_row_name, mcp_summary, model_ok, one_line, push_mcp_row, rewind_error, rewind_ev, semver3,
    slash_desc, slash_name_ok, str_of, tier_ok, tiers_of, tile_input, uuid_ok, word_ok, Cli, CompactPhase, Decision, Dropped, Ev, GoalAction, GoalView, McpRow,
    Mode, Outcome, PermKind, ResolvedBy, ReviewPhase, ReviewTarget, RewindMore, RewindPhase, SessionAllow, SlashCommand, Step, TileAnswer, Tier, UserImage,
    COMMANDS_MAX, DETAIL_MAX, MCP_ROWS_MAX,
};
use super::claude::TILE_USE_TERMINAL;
use super::Adapter;

/// 확인한 버전의 시작 — CLI 가 며칠마다 올라 정확 일치로는 경고가 늘 뜨니 0.x 안에서 이 버전 이상을 받는다(0.x 는 minor 로 오른다).
/// 그 밖(낮은 버전 · 1.0 이상 · 못 읽은 버전)은 `notice{untested-version}` 만 낸다.
pub(crate) const TESTED_FROM: [u64; 3] = [0, 163, 0];

pub(crate) fn tested(version: Option<&str>) -> bool {
    version.and_then(semver3).is_some_and(|v| v[0] == 0 && v >= TESTED_FROM)
}

const UNSUPPORTED: i64 = -32601;

pub(crate) struct Opts<'a> {
    pub exe: &'a str,
    pub mode: Mode<'a>,
    pub cwd: &'a str,
    pub model: &'a str,
    pub effort: Option<&'a str>,
    pub mcp_names: &'a [String],
    pub client_version: &'a str,
    /// 채팅 토큰은 인자에 싣지 않는다 — 그 프로세스의 환경 변수 `token_env` 에만(서버가 넣는다).
    pub mcp: Option<Mcp<'a>>,
    /// `mcp_names` 와 같은 이름은 싣지 않는다 — 사용자 표와 합쳐지면 그쪽 env · 명령이 섞인다.
    pub external: &'a [crate::agent_mcp::McpServer],
}

/// 채팅 타일 인자 재료 — 사용자 `config.toml` 의 MCP · 훅 · 플러그인 · 정책을 그대로 쓴다.
pub(crate) struct TileOpts<'a> {
    pub exe: &'a str,
    /// Fresh | Resume 만 — Fork 는 Err("bad-conversation").
    pub mode: Mode<'a>,
    pub cwd: &'a str,
    pub model: &'a str,
    pub effort: Option<&'a str>,
    pub client_version: &'a str,
    /// 토큰 값은 싣지 않는다 — `token_env` 이름만. `tools` 는 보지 않는다(빈 배열을 넘긴다).
    pub mcp: Option<Mcp<'a>>,
    /// 서버가 브로커로 준비한 외부 서버(`agent_mcp::launch_ok` 를 지난 것).
    pub external: &'a [crate::agent_mcp::McpServer],
    /// 사람이 그 타일 칩에서 고른 모드([`TILE_MODES`]) — 매 `turn/start` 에 싣는다. `None` = 사용자 config 그대로(칸을 싣지 않는다).
    pub perm_mode: Option<&'a str>,
}

/// 채팅 타일 칩이 낼 수 있는 값 — `plan` 은 `collaborationMode/list` 가 알렸을 때만 고를 수 있다.
pub(crate) const TILE_MODES: [&str; 3] = ["readOnly", "auto", "plan"];

/// 스레드 답(`approvalPolicy` · `sandbox.type`) · `thread/settings/updated`(`approvalPolicy` · `sandboxPolicy.type`)를 칩 낱말로.
pub(crate) fn codex_mode(approval: Option<&str>, sandbox: Option<&str>) -> &'static str {
    match (approval, sandbox) {
        (Some("on-request"), Some("readOnly")) => "readOnly",
        (Some("on-request"), Some("workspaceWrite")) => "auto",
        _ => "custom",
    }
}

/// 스레드 설정 몸 하나(스레드 답 · `threadSettings`)의 모드 — 정책 칸이 없으면 모른다.
fn settings_mode(s: &Value) -> Option<&'static str> {
    let approval = s["approvalPolicy"].as_str()?;
    if s["collaborationMode"]["mode"] == "plan" {
        return Some("plan");
    }
    let sandbox = s["sandboxPolicy"]["type"].as_str().or(s["sandbox"]["type"].as_str());
    Some(codex_mode(Some(approval), sandbox))
}

/// `*** Begin Patch` ~ 마지막 `*** End Patch`(포함) — 실행되는 바로 그 글. `-Command '…'` 안이면 `''` 를 `'` 로, 큰따옴표 글이면 백틱 이스케이프
/// (`` `n `` · `` `t `` · `` `" `` · ``` `` ```)를 푼다. here-string(`@'…'@`)은 진짜 줄바꿈이라 그대로. 없으면 `None`.
pub(crate) fn apply_patch_text(command: &str) -> Option<String> {
    const BEGIN: &str = "*** Begin Patch";
    const END: &str = "*** End Patch";
    let start = command.find(BEGIN)?;
    let end = command.rfind(END)? + END.len();
    if end <= start {
        return None;
    }
    let before = &command[..start];
    let mut raw = command[start..end].to_string();
    if before.contains("-Command '") {
        raw = raw.replace("''", "'");
    }
    let opener = before.trim_end_matches([' ', '\t']).chars().last();
    if opener != Some('"') {
        return Some(raw);
    }
    let mut out = String::with_capacity(raw.len());
    let mut it = raw.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '`' => match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('0') => out.push('\0'),
                Some(x) => out.push(x),
                None => out.push('`'),
            },
            '"' if it.peek() == Some(&'"') => {
                it.next();
                out.push('"');
            }
            _ => out.push(c),
        }
    }
    Some(out)
}

/// apply_patch 감싸개 — 이 명령의 `acceptForSession` 은 패치 전부를 덮을 수 있어 내지 않는다.
fn patch_command(full: &str) -> bool {
    full.contains("--codex-run-as-apply-patch") || (full.contains("apply_patch") && full.contains("*** Begin Patch"))
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Mcp<'a> {
    pub name: &'a str,
    pub url: &'a str,
    pub token_env: &'a str,
    pub tools: &'a [&'a str],
}

/// `-c` 키 경로 조각 하나로 쓸 수 있는 이름.
fn mcp_name_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub(crate) fn mcp_server_names(config_toml: &str) -> McpNames {
    let Ok(t) = config_toml.parse::<toml::Table>() else {
        return McpNames::default();
    };
    let Some(servers) = t.get("mcp_servers").and_then(toml::Value::as_table) else {
        return McpNames::default();
    };
    let mut out = McpNames::default();
    for k in servers.keys() {
        if mcp_name_ok(k) {
            out.names.push(k.clone());
        } else {
            out.skipped += 1;
        }
    }
    out
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct McpNames {
    pub names: Vec<String>,
    pub skipped: usize,
}

pub(crate) fn argv(o: &Opts<'_>) -> Result<Vec<String>, &'static str> {
    if !model_ok(o.model) || o.effort.is_some_and(|e| !word_ok(e)) {
        return Err("bad-model");
    }
    match o.mode {
        Mode::Resume { conv: id } | Mode::Fork { from: id } if !uuid_ok(id) => return Err("bad-conversation"),
        _ => {}
    }
    let mut a: Vec<String> = [o.exe, "app-server", "--disable", "hooks", "--disable", "plugins", "--disable", "apps"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let ours = o.mcp.map(|m| m.name);
    for n in o.mcp_names.iter().filter(|n| mcp_name_ok(n) && Some(n.as_str()) != ours) {
        a.push("-c".into());
        a.push(format!("mcp_servers.{n}.enabled=false"));
    }
    a.extend(["-c".into(), "web_search=\"live\"".into(), "-c".into(), "tools.web_search.context_size=\"high\"".into()]);
    // 값은 작은따옴표로 감싸 싣는다 — 작은따옴표가 든 값은 거른다.
    if let Some(m) = o.mcp {
        let plain = |s: &str| !s.is_empty() && !s.contains('\'') && !s.chars().any(char::is_control);
        if !mcp_name_ok(m.name) || !plain(m.url) || !mcp_name_ok(m.token_env) || !m.tools.iter().all(|t| mcp_name_ok(t)) {
            return Err("bad-mcp");
        }
        let s = m.name;
        for v in [
            format!("mcp_servers.{s}.url='{}'", m.url),
            format!("mcp_servers.{s}.bearer_token_env_var='{}'", m.token_env),
            format!("mcp_servers.{s}.enabled=true"),
        ] {
            a.extend(["-c".into(), v]);
        }
        for t in m.tools {
            a.extend(["-c".into(), format!("mcp_servers.{s}.tools.{t}.approval_mode='approve'")]);
        }
    }
    // `prompt` 를 빼면 기본 `auto` 가 읽기 표시 도구를 묻지 않는다.
    for x in o.external {
        let n = x.name.as_str();
        if !mcp_name_ok(n) || o.mcp_names.iter().any(|u| u == n) || Some(n) == ours || !crate::agent_mcp::launch_ok(x) {
            continue;
        }
        for v in crate::agent_mcp::codex_overrides(x)
            .into_iter()
            .chain([format!("mcp_servers.{n}.enabled=true"), format!("mcp_servers.{n}.default_tools_approval_mode='prompt'")])
        {
            a.extend(["-c".into(), v]);
        }
    }
    Ok(a)
}

/// 끄기(`--disable` · `enabled=false`) · 정책(`approval_mode` · `windows.sandbox`) · 도구 미리 허용을 싣지 않는다 — 사용자 설정을 그대로 따른다.
pub(crate) fn tile_argv(o: &TileOpts<'_>) -> Result<Vec<String>, &'static str> {
    if !model_ok(o.model) || o.effort.is_some_and(|e| !word_ok(e)) {
        return Err("bad-model");
    }
    match o.mode {
        Mode::Fork { .. } => return Err("bad-conversation"),
        Mode::Resume { conv } if !uuid_ok(conv) => return Err("bad-conversation"),
        _ => {}
    }
    let mut a: Vec<String> = vec![o.exe.to_string(), "app-server".to_string()];
    let ours = o.mcp.map(|m| m.name);
    if let Some(m) = o.mcp {
        let plain = |s: &str| !s.is_empty() && !s.contains('\'') && !s.chars().any(char::is_control);
        if !mcp_name_ok(m.name) || !plain(m.url) || !mcp_name_ok(m.token_env) {
            return Err("bad-mcp");
        }
        let s = m.name;
        for v in [
            format!("mcp_servers.{s}.url='{}'", m.url),
            format!("mcp_servers.{s}.bearer_token_env_var='{}'", m.token_env),
            format!("mcp_servers.{s}.enabled=true"),
        ] {
            a.extend(["-c".into(), v]);
        }
    }
    for x in o.external {
        let n = x.name.as_str();
        if !mcp_name_ok(n) || Some(n) == ours || !crate::agent_mcp::launch_ok(x) {
            continue;
        }
        for v in crate::agent_mcp::codex_overrides(x) {
            a.extend(["-c".into(), v]);
        }
    }
    Ok(a)
}

/// 프로듀서 인자 — `windows.sandbox` 는 사용자 `config.toml` 에 기대지 않게 고정하고, `notify=[]` 는 턴마다 외부 프로그램을 띄우는
/// 사용자 `notify` 를 끈다. 외부 MCP 는 부르는 쪽이 비워 준다.
pub(crate) fn producer_argv(o: &Opts<'_>) -> Result<Vec<String>, &'static str> {
    let mut a = argv(o)?;
    if let Some(i) = a.iter().position(|x| x == "web_search=\"live\"") {
        a[i] = "web_search=\"disabled\"".into();
    }
    if let Some(i) = a.iter().position(|x| x == "tools.web_search.context_size=\"high\"") {
        a.drain(i - 1..=i);
    }
    a.extend(["-c".into(), "windows.sandbox=\"unelevated\"".into(), "-c".into(), "notify=[]".into()]);
    Ok(a)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Purpose {
    Initialize,
    ModelList,
    /// 채팅 타일만 — 계획 모드가 있는지.
    CollabList,
    Thread,
    TurnStart,
    Interrupt,
    /// 채팅 타일만 — 악수 끝의 스킬 목록 읽기.
    SkillsList,
    /// 채팅 타일만 — 사람이 부른 압축.
    Compact,
    /// 채팅 타일만 — 사람이 부른 되감기의 미리 보기(턴 목록 읽기) · 실행. 몸은 `rewind_req`.
    RewindPreview,
    Revert,
    /// 채팅 타일만 — 사람 op 의 목표 줄 · 검토 · MCP 상태 읽기(몇째 읽기인지 — 늦은 옛 쪽은 버린다).
    Goal,
    Review,
    McpList(u32),
}

/// 한 쪽 크기 · 쪽 수 상한 — 쪽마다 도구 스키마가 실려 몸이 크다(실측 7 줄에 약 720KB).
const MCP_PAGE: u32 = 8;
const MCP_PAGES_MAX: u32 = (MCP_ROWS_MAX as u32) / MCP_PAGE;

/// 사람이 연 MCP 상태 읽기 하나 — 쪽을 모은다.
struct McpRead {
    gen: u32,
    rows: Vec<McpRow>,
    pages: u32,
}

fn codex_mcp_state(s: &str) -> &'static str {
    match s {
        "connected" => "connected",
        "starting" => "connecting",
        "authenticationRequired" => "needsAuth",
        "failed" => "failed",
        "cancelled" => "cancelled",
        "disabled" => "disabled",
        _ => "unknown",
    }
}

fn codex_mcp_auth(s: &str) -> Option<&'static str> {
    match s {
        "oAuth" => Some("oauth"),
        "bearerToken" => Some("bearer"),
        "notLoggedIn" => Some("notLoggedIn"),
        "unsupported" => Some("none"),
        _ => None,
    }
}

/// **허용 목록** — `name` · `runtimeStatus` · `authStatus` · `tools`(열쇠 수만) · `pluginId`(있음/없음만). `httpOrigin` · `serverInfo` · `serverCapabilities` ·
/// `toolsError` · `resources` · `toolListMeta` 는 열지 않는다. `runtimeStatus` 가 없으면 `prev` 의 같은 이름 상태를 둔다.
fn mcp_rows_codex(data: &Value, prev: &[McpRow]) -> Vec<McpRow> {
    let mut out = Vec::new();
    for s in data.as_array().into_iter().flatten() {
        let Some(name) = s["name"].as_str().and_then(mcp_row_name) else { continue };
        let state = match s["runtimeStatus"].as_str() {
            Some(r) => codex_mcp_state(r),
            None => prev.iter().find(|p| p.name == name).map_or("unknown", |p| p.state),
        };
        let tools = s["tools"].as_object().map(|o| o.len() as u32).or_else(|| s["tools"].as_array().map(|a| a.len() as u32));
        let scope = if s["pluginId"].as_str().is_some_and(|p| !p.is_empty()) { "plugin" } else { "config" };
        push_mcp_row(&mut out, McpRow { name, state, auth: s["authStatus"].as_str().and_then(codex_mcp_auth), tools, scope });
    }
    out
}

/// 답에는 받은 id 를 그대로(숫자 · 문자열) 돌려준다. `elicitation` 이면 답 꼴이 `{action}` 이다.
struct Pending {
    raw_id: Value,
    elicitation: bool,
    /// 채팅 타일의 일반 명령 승인만 — `acceptForSession` 을 낼 수 있다.
    session: bool,
    /// 채팅 타일의 질문 — `questions` 배열(답은 질문 `id` 열쇠).
    question: Option<Value>,
}

pub(crate) struct Codex {
    cwd: String,
    model: String,
    effort: Option<String>,
    mode: ModeOwned,
    client_version: String,
    approval: &'static str,
    instructions: String,
    seq: u64,
    requests: BTreeMap<u64, Purpose>,
    thread: Option<String>,
    version: Option<String>,
    thread_model: Option<String>,
    thread_effort: Option<String>,
    effort_sent: bool,
    models: Option<Vec<String>>,
    efforts: BTreeMap<String, Vec<String>>,
    ready: bool,
    live_turn: Option<String>,
    queued: VecDeque<Option<String>>,
    pending: BTreeMap<String, Pending>,
    /// 파일 승인 요청에는 diff 가 없어 같은 itemId 의 `item/started` 것을 쥐었다가 붙인다.
    /// (경로들, 설명 글 `path\n<diff>`, 채팅 타일 카드의 diff — `tile_change_diff`)
    files: BTreeMap<String, (Vec<String>, String, String)>,
    tools: BTreeSet<String>,
    /// 승인 요청(elicitation)에는 도구 이름 칸이 없어 막 시작한 도구 이름을 붙인다.
    mcp_calls: BTreeMap<String, String>,
    dropped: Dropped,
    /// 채팅 타일 — 스레드 몸에 정책 · 지침을 싣지 않고, 권한 모드 · 계획 · 질문 · 늘 허용을 다룬다.
    tile: bool,
    /// 사람이 고른 모드 — 매 `turn/start` 에 싣는다.
    perm_mode: Option<String>,
    /// 사용자 config 가 정한 모드(스레드 답 · `thread/settings/updated`).
    config_mode: Option<&'static str>,
    plan_ok: bool,
    /// `collaborationMode` 를 한 번 실었다 — 계획에서 나올 때 `default` 를 실어야 한다(남는 칸이다).
    collab_sent: bool,
    mode_sent: Option<(String, Vec<String>)>,
    /// 채팅 타일 — `skills/list` 의 켜진 스킬(줄 · 경로). 경로는 사건 · 스냅숏에 싣지 않는다.
    skills: Vec<(SlashCommand, String)>,
    cmd_sent: Option<Vec<SlashCommand>>,
    /// 다음 `encode_user` 가 실을 스킬(이름 · 경로).
    skills_pending: Vec<(String, String)>,
    ctx_sent: Option<(u64, Option<u64>)>,
    /// 마지막 `tokenUsage` 의 맥락 크기 · 최대치.
    last_used: Option<u64>,
    window: Option<u64>,
    /// 압축 op 가 보낸 `thread/compact/start` 의 턴이 아직 끝나지 않았다.
    compact_req: bool,
    /// 지금 압축 항목의 `trigger` · 시작 때의 맥락 크기 · 항목 사이에 온 `tokenUsage`(압축 뒤 크기 — 항목 끝보다 먼저 온다).
    compact_trigger: Option<&'static str>,
    compact_pre: Option<u64>,
    compact_post: Option<u64>,
    /// 채팅 타일 — 스레드 답의 `historyMode`(`legacy` 는 되감지 못한다).
    history_mode: Option<String>,
    /// 답을 기다리는 되감기의 기준 턴(미리 보기 · 실행은 요청의 `Purpose` 가 가른다) · 마지막 미리 보기가 센 턴 수 `(기준 턴, 수)`.
    rewind_req: Option<String>,
    rewind_turns: Option<(String, u32)>,
    /// 채팅 타일 — MCP 상태(들어온 순서) · 마지막으로 낸 것 · 사람이 연 읽기.
    mcp: Vec<McpRow>,
    mcp_sent: Option<Vec<McpRow>>,
    mcp_read: Option<McpRead>,
    mcp_gen: u32,
    /// 채팅 타일 — 마지막으로 낸 목표.
    goal: Option<GoalView>,
    /// 이 프로세스에서 Aynx 가 `set` 으로 보낸 목표 글(다듬은 것) — CLI 는 출처를 알리지 않아 이것과 같은 글만 Aynx 의 목표로 본다.
    goal_set_by_us: Option<String>,
    /// 답을 기다리는 목표 줄이 실패하면 되돌릴 값.
    goal_prev: Option<Option<String>>,
    /// 채팅 타일 — 모델마다 속도 등급(등급이 있는 모델만) · 스레드의 지금 값 · 사람이 고른 값.
    tiers: BTreeMap<String, Vec<Tier>>,
    thread_tier: Option<String>,
    tier: Option<String>,
    /// 사람이 부른 검토가 끝나지 않았다 · CLI 가 지은 표지 이름 · 턴이 서면 낼 시작 표지 · 답의 턴 id(A).
    review_req: bool,
    review_label: Option<String>,
    review_note: bool,
    review_root: Option<String>,
}

/// 답의 `cwd` 는 `/` 구분자로 온다.
fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// `skills/list` 답 — 이 cwd 의 항목(없으면 첫 항목)의 켜진 스킬. 꼴이 틀리면 `None`.
fn skills_of(result: &Value, cwd: &str) -> Option<Vec<(SlashCommand, String)>> {
    let data = result["data"].as_array()?;
    let entry = data.iter().find(|d| d["cwd"].as_str().is_some_and(|c| same_dir(c, cwd))).or(data.first())?;
    let mut out: Vec<(SlashCommand, String)> = Vec::new();
    for s in entry["skills"].as_array()? {
        let (Some(name), Some(path)) = (s["name"].as_str(), s["path"].as_str()) else { continue };
        if s["enabled"] != true || !slash_name_ok(name) || path.trim().is_empty() || out.iter().any(|(c, _)| c.name == name) {
            continue;
        }
        let desc = [&s["interface"]["shortDescription"], &s["shortDescription"], &s["description"]]
            .into_iter()
            .filter_map(Value::as_str)
            .find(|d| !d.trim().is_empty())
            .unwrap_or("");
        let line = SlashCommand { name: name.to_string(), description: slash_desc(desc), hint: String::new(), kind: "skill", aliases: Vec::new() };
        out.push((line, path.to_string()));
        if out.len() >= COMMANDS_MAX {
            break;
        }
    }
    Some(out)
}

enum ModeOwned {
    Fresh,
    Resume(String),
    Fork(String),
}

/// 세지 않고 버린다. 뒤 둘은 채팅 타일 악수(`experimentalApi:true`)에서만 온다.
const QUIET: [&str; 14] = [
    "thread/started",
    "thread/status/changed",
    "thread/tokenUsage/updated",
    "thread/goal/cleared",
    "account/updated",
    "account/rateLimits/updated",
    "remoteControl/status/changed",
    "mcpServer/startupStatus/updated",
    "hook/started",
    "hook/completed",
    "warning",
    "deprecationNotice",
    "turn/moderationMetadata",
    "thread/readState/changed",
];

impl Codex {
    pub(crate) fn new(o: &Opts<'_>) -> Self {
        Codex {
            cwd: o.cwd.to_string(),
            model: o.model.to_string(),
            effort: o.effort.map(str::to_string),
            mode: match o.mode {
                Mode::Fresh => ModeOwned::Fresh,
                Mode::Resume { conv } => ModeOwned::Resume(conv.to_string()),
                Mode::Fork { from } => ModeOwned::Fork(from.to_string()),
            },
            client_version: o.client_version.to_string(),
            approval: "on-request",
            instructions: super::fixed_guide(),
            seq: 0,
            requests: BTreeMap::new(),
            thread: None,
            version: None,
            thread_model: None,
            thread_effort: None,
            effort_sent: false,
            models: None,
            efforts: BTreeMap::new(),
            ready: false,
            live_turn: None,
            queued: VecDeque::new(),
            pending: BTreeMap::new(),
            files: BTreeMap::new(),
            tools: BTreeSet::new(),
            mcp_calls: BTreeMap::new(),
            dropped: Dropped::default(),
            tile: false,
            perm_mode: None,
            config_mode: None,
            plan_ok: false,
            collab_sent: false,
            mode_sent: None,
            skills: Vec::new(),
            cmd_sent: None,
            skills_pending: Vec::new(),
            ctx_sent: None,
            last_used: None,
            window: None,
            compact_req: false,
            compact_trigger: None,
            compact_pre: None,
            compact_post: None,
            history_mode: None,
            rewind_req: None,
            rewind_turns: None,
            mcp: Vec::new(),
            mcp_sent: None,
            mcp_read: None,
            mcp_gen: 0,
            goal: None,
            goal_set_by_us: None,
            goal_prev: None,
            tiers: BTreeMap::new(),
            thread_tier: None,
            tier: None,
            review_req: false,
            review_label: None,
            review_note: false,
            review_root: None,
        }
    }

    /// 검토 장부 — 요청을 보낼 때(`req`)와 끝 · 실패 · 닫힘 때.
    fn review_reset(&mut self, req: bool) {
        (self.review_req, self.review_note, self.review_label, self.review_root) = (req, false, None, None);
    }

    /// 턴이 돌거나 · 보낸 글 · 압축 · 검토가 아직 턴을 열지 않았다.
    fn turn_busy(&self) -> bool {
        self.live_turn.is_some() || !self.queued.is_empty() || self.compact_req || self.review_req
    }

    /// 지금 모델(사람이 고른 것 · 없으면 스레드의 것).
    fn current_model(&self) -> Option<&str> {
        if self.model.is_empty() {
            self.thread_model.as_deref()
        } else {
            Some(&self.model)
        }
    }

    /// 사람이 고른 등급이 지금 모델의 목록에 있을 때만 — 없으면 칸째 뺀다(스레드 값 · 사용자 config).
    fn tier_for_turn(&self) -> Option<String> {
        let t = self.tier.as_deref()?;
        let list = self.tiers.get(self.current_model()?)?;
        list.iter().any(|x| x.id == t).then(|| t.to_string())
    }

    /// 바뀌었을 때만.
    fn goal_ev(&mut self, g: Option<GoalView>) -> Option<Ev> {
        if self.goal == g {
            return None;
        }
        self.goal = g.clone();
        Some(Ev::Goal { goal: g })
    }

    /// CLI 가 알린 `ThreadGoal` — 출처는 알리지 않는다. Aynx 가 보낸 글이면 Aynx 의 것 · 처음 보는 목표가 턴 안(`turn`)에서 섰으면 모델이 정한 것(표) ·
    /// 그 밖(붙을 때 이미 있던 목표)은 출처를 모른다 — 사람이 앞서 정한 것일 수 있어 표를 달지 않는다. 같은 목표는 처음 판정을 잇는다.
    fn goal_from(&mut self, g: &Value, turn: Option<&str>) -> Option<Ev> {
        let ours = self.goal_set_by_us.as_deref().is_some_and(|o| g["objective"].as_str().map(str::trim) == Some(o));
        let mut view = goal_view(g, false)?;
        view.auto = match self.goal.as_ref() {
            _ if ours => false,
            Some(prev) if prev.objective == view.objective => prev.auto,
            _ => turn.is_some(),
        };
        self.goal_ev(Some(view))
    }

    /// 채팅 타일만 · 바뀌었을 때만(`list` 는 사람이 물었으니 늘 낸다).
    fn mcp_ev(&mut self, source: &'static str) -> Option<Ev> {
        if source != "list" && self.mcp_sent.as_ref() == Some(&self.mcp) {
            return None;
        }
        self.mcp_sent = Some(self.mcp.clone());
        Some(Ev::McpStatus { servers: self.mcp.clone(), source })
    }

    /// `mcpServer/startupStatus/updated` — 이름 · 상태 낱말 · 실패 까닭 낱말만(`error` 글은 읽지 않는다).
    fn on_mcp_startup(&mut self, p: &Value) -> Option<Ev> {
        let name = p["name"].as_str().and_then(mcp_row_name)?;
        let state = match p["status"].as_str().unwrap_or("") {
            "starting" => "connecting",
            "ready" => "connected",
            "failed" if p["failureReason"] == "reauthenticationRequired" => "needsAuth",
            "failed" => "failed",
            "cancelled" => "cancelled",
            _ => "unknown",
        };
        match self.mcp.iter_mut().find(|r| r.name == name) {
            Some(r) => r.state = state,
            None => push_mcp_row(&mut self.mcp, McpRow { name, state, auth: None, tools: None, scope: "config" }),
        }
        self.mcp_ev("startup")
    }

    /// 사람이 연 읽기의 한 쪽 — 다음 쪽이 있으면 그 읽기의 몸으로 이어 묻는다(상한 안에서).
    fn on_mcp_page(&mut self, gen: u32, error: Option<String>, r: &Value) -> Step {
        if self.mcp_read.as_ref().is_none_or(|m| m.gen != gen) {
            return Step::default();
        }
        let Some(mut read) = self.mcp_read.take() else { return Step::default() };
        if error.is_some() || !r["data"].is_array() {
            return Step::ev(Ev::Notice { code: "mcp-status-failed", detail: None });
        }
        for row in mcp_rows_codex(&r["data"], &self.mcp) {
            push_mcp_row(&mut read.rows, row);
        }
        let next = r["nextCursor"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
        if let (Some(cursor), Some(thread)) = (next, self.thread.clone()) {
            if read.pages < MCP_PAGES_MAX && read.rows.len() < MCP_ROWS_MAX {
                read.pages += 1;
                let params = json!({"threadId": thread, "detail": "toolsAndAuthOnly", "limit": MCP_PAGE, "cursor": cursor});
                let line = self.request(Purpose::McpList(gen), "mcpServerStatus/list", params);
                self.mcp_read = Some(read);
                return Step::line(line);
            }
        }
        self.mcp = read.rows;
        Step { evs: self.mcp_ev("list").into_iter().collect(), stdin: Vec::new() }
    }

    fn rewind_ok(&self) -> bool {
        self.history_mode.as_deref() != Some("legacy")
    }

    fn on_rewind_answer(&mut self, purpose: Purpose, error: Option<String>, r: &Value) -> Step {
        let Some(anchor) = self.rewind_req.take() else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let failed = |e: String| RewindMore { error: Some(rewind_error(&e)), ..Default::default() };
        let ev = match (purpose, error) {
            (Purpose::RewindPreview, None) => {
                let ids: Vec<&str> = r["data"].as_array().into_iter().flatten().filter_map(|t| t["id"].as_str()).collect();
                match ids.iter().position(|id| *id == anchor) {
                    Some(i) => {
                        let n = (i + 1) as u32;
                        self.rewind_turns = Some((anchor.clone(), n));
                        rewind_ev(RewindPhase::Preview, &anchor, "conversation", true, RewindMore { turns: Some(n), ..Default::default() })
                    }
                    None if r["nextCursor"].as_str().is_some_and(|c| !c.is_empty()) => {
                        rewind_ev(RewindPhase::Preview, &anchor, "conversation", true, RewindMore::default())
                    }
                    None => rewind_ev(RewindPhase::Preview, &anchor, "conversation", false, failed("turn not found".into())),
                }
            }
            (Purpose::RewindPreview, Some(e)) => rewind_ev(RewindPhase::Preview, &anchor, "conversation", false, failed(e)),
            (_, None) => {
                if let Some(m) = str_of(&r["thread"]["historyMode"]) {
                    self.history_mode = Some(m);
                }
                let turns = self.rewind_turns.take().filter(|(a, _)| *a == anchor).map(|(_, n)| n);
                rewind_ev(RewindPhase::Done, &anchor, "conversation", true, RewindMore { turns, ..Default::default() })
            }
            (_, Some(e)) => rewind_ev(RewindPhase::Failed, &anchor, "conversation", false, failed(e)),
        };
        Step::ev(ev)
    }

    pub(crate) fn tile(o: &TileOpts<'_>) -> Self {
        let base = Opts {
            exe: o.exe,
            mode: o.mode,
            cwd: o.cwd,
            model: o.model,
            effort: o.effort,
            mcp_names: &[],
            client_version: o.client_version,
            mcp: o.mcp,
            external: o.external,
        };
        let perm_mode = o.perm_mode.filter(|m| TILE_MODES.contains(m)).map(str::to_string);
        Codex { tile: true, instructions: String::new(), perm_mode, ..Codex::new(&base) }
    }

    /// 채팅 타일 — 사람이 고른 속도 등급. 턴 몸에만 싣는다(실행 인자 · 스레드 몸 · 사용자 config 에는 없다).
    pub(crate) fn with_tier(mut self, tier: Option<&str>) -> Self {
        self.tier = tier.filter(|t| self.tile && tier_ok(t)).map(str::to_string);
        self
    }

    fn choices(&self) -> Vec<String> {
        let mut c: Vec<String> = TILE_MODES[..2].iter().map(|s| s.to_string()).collect();
        if self.plan_ok {
            c.push("plan".into());
        }
        c
    }

    /// 채팅 타일 · 준비된 뒤 · 바뀌었을 때만.
    fn mode_ev(&mut self) -> Option<Ev> {
        if !self.tile || !self.ready {
            return None;
        }
        let mode = self.perm_mode.clone().or_else(|| self.config_mode.map(str::to_string))?;
        let now = (mode, self.choices());
        if self.mode_sent.as_ref() == Some(&now) {
            return None;
        }
        self.mode_sent = Some(now.clone());
        Some(Ev::CliMode { mode: now.0, choices: now.1, chosen: None })
    }

    /// `turn/start` 의 정책 칸 — 사람이 고른 모드가 있을 때만. 남는 칸이라 매 턴 싣는다.
    fn add_policy(&mut self, params: &mut Value) {
        let Some(m) = self.perm_mode.clone().filter(|_| self.tile) else { return };
        let (sandbox, collab) = match m.as_str() {
            "auto" => ("workspaceWrite", None),
            // 계획 모드를 알리지 않은 CLI 에는 싣지 않는다(실으면 턴이 거절된다)
            "plan" if self.plan_ok => ("readOnly", Some("plan")),
            _ => ("readOnly", None),
        };
        params["approvalPolicy"] = json!("on-request");
        params["sandboxPolicy"] = json!({"type": sandbox});
        let Some(collab) = collab.or(self.collab_sent.then_some("default")) else { return };
        let model = if self.model.is_empty() { self.thread_model.clone().map(Value::String).unwrap_or(Value::Null) } else { json!(self.model) };
        params["collaborationMode"] =
            json!({"mode": collab, "settings": {"model": model, "reasoning_effort": self.effort, "developer_instructions": null}});
        self.collab_sent = true;
    }

    pub(crate) fn person_instructions(mut self, person: Option<&str>) -> Self {
        self.instructions = super::codex_instructions(person);
        self
    }

    /// `approvalPolicy: never` — 읽기 전용 샌드박스 밖이 필요한 명령은 승인 요청 없이 실패한다.
    pub(crate) fn producer(mut self, instructions: String) -> Self {
        self.approval = "never";
        self.instructions = instructions;
        self
    }

    fn request(&mut self, purpose: Purpose, method: &str, params: Value) -> String {
        self.seq += 1;
        self.requests.insert(self.seq, purpose);
        json!({"jsonrpc": "2.0", "id": self.seq, "method": method, "params": params}).to_string()
    }

    /// 빈 값 = CLI 기본(`null`).
    fn model_json(&self) -> Value {
        if self.model.is_empty() {
            Value::Null
        } else {
            json!(self.model)
        }
    }

    fn thread_request(&mut self) -> String {
        // `baseInstructions` 는 기본 지침을 갈아 끼우니 쓰지 않는다.
        let base = if self.tile {
            json!({"cwd": self.cwd, "model": self.model_json()})
        } else {
            json!({"cwd": self.cwd, "model": self.model_json(), "approvalPolicy": self.approval, "sandbox": "read-only",
                "developerInstructions": self.instructions})
        };
        let (method, params) = match &self.mode {
            ModeOwned::Fresh => ("thread/start", base),
            ModeOwned::Resume(id) => ("thread/resume", with(base, &[("threadId", json!(id)), ("excludeTurns", json!(true))])),
            ModeOwned::Fork(id) => ("thread/fork", with(base, &[("threadId", json!(id)), ("excludeTurns", json!(true))])),
        };
        self.request(Purpose::Thread, method, params)
    }

    fn maybe_ready(&mut self) -> Vec<Ev> {
        if self.ready || self.thread.is_none() || self.models.is_none() {
            return Vec::new();
        }
        self.ready = true;
        let mut efforts = self.efforts.clone();
        if let Some(l) = self.thread_model.as_ref().and_then(|m| self.efforts.get(m)) {
            efforts.insert(String::new(), l.clone());
        }
        let mut evs = vec![Ev::Ready {
            cli: Cli::Codex,
            version: self.version.clone(),
            model: self.thread_model.clone().or_else(|| (!self.model.is_empty()).then(|| self.model.clone())),
            models: self.models.clone().unwrap_or_default(),
            efforts,
            conversation_id: self.thread.clone(),
        }];
        evs.extend(self.mode_ev());
        if self.tile && (!self.tiers.is_empty() || self.thread_tier.is_some()) {
            evs.push(Ev::ServiceTiers { by_model: self.tiers.clone(), thread: self.thread_tier.clone() });
        }
        if !tested(self.version.as_deref()) {
            evs.push(Ev::Notice { code: "untested-version", detail: self.version.clone() });
        }
        evs
    }

    fn on_response(&mut self, v: &Value) -> Step {
        let Some(purpose) = v["id"].as_u64().and_then(|id| self.requests.remove(&id)) else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let error = v.get("error").map(|e| one_line(e["message"].as_str().unwrap_or("error")));
        let r = &v["result"];
        match (purpose, error) {
            (Purpose::Initialize, None) => {
                let mut stdin = vec![json!({"jsonrpc": "2.0", "method": "initialized"}).to_string()];
                stdin.push(self.request(Purpose::ModelList, "model/list", json!({})));
                if self.tile {
                    stdin.push(self.request(Purpose::CollabList, "collaborationMode/list", json!({})));
                }
                stdin.push(self.thread_request());
                // 채팅 타일만 — `/` 메뉴의 스킬 목록은 여기서 한 번 읽는다(`skills/changed` 뒤 다시 읽지 않는다)
                if self.tile {
                    let cwds = json!({"cwds": [self.cwd]});
                    stdin.push(self.request(Purpose::SkillsList, "skills/list", cwds));
                }
                Step { evs: Vec::new(), stdin }
            }
            (Purpose::Initialize | Purpose::Thread, Some(e)) => Step {
                evs: vec![Ev::Notice { code: "handshake-failed", detail: Some(e) }, Ev::Exited { code: None, reason: "protocol" }],
                stdin: Vec::new(),
            },
            (Purpose::ModelList, e) => {
                let models = if e.is_some() {
                    Vec::new()
                } else {
                    r["data"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|m| m["hidden"] != true)
                        .filter_map(|m| m["id"].as_str().map(str::to_string))
                        .collect()
                };
                if e.is_none() {
                    self.efforts = model_list_efforts(r);
                    if self.tile {
                        self.tiers = model_list_tiers(r);
                    }
                }
                self.models = Some(models);
                Step { evs: self.maybe_ready(), stdin: Vec::new() }
            }
            // 오류는 악수 실패가 아니다 — 칩에 계획이 없을 뿐
            (Purpose::CollabList, e) => {
                self.plan_ok = e.is_none()
                    && r["data"].as_array().into_iter().flatten().any(|m| {
                        [&m["mode"], &m["name"]].into_iter().filter_map(Value::as_str).any(|s| s.eq_ignore_ascii_case("plan"))
                    });
                Step { evs: self.mode_ev().into_iter().collect(), stdin: Vec::new() }
            }
            (Purpose::Thread, None) => {
                let Some(id) = r["thread"]["id"].as_str() else {
                    return Step {
                        evs: vec![Ev::Notice { code: "handshake-failed", detail: None }, Ev::Exited { code: None, reason: "protocol" }],
                        stdin: Vec::new(),
                    };
                };
                self.thread = Some(id.to_string());
                self.version = str_of(&r["thread"]["cliVersion"]);
                self.thread_model = str_of(&r["model"]);
                self.thread_effort = str_of(&r["reasoningEffort"]).filter(|e| word_ok(e));
                if self.tile {
                    self.config_mode = settings_mode(r).or(self.config_mode);
                    self.history_mode = str_of(&r["thread"]["historyMode"]);
                    self.thread_tier = r["serviceTier"].as_str().filter(|t| tier_ok(t)).map(str::to_string);
                }
                let mut evs = self.maybe_ready();
                if self.tile {
                    // 칸이 없거나 모르는 값이면 되감을 수 있다고 본다 — CLI 가 거절하면 `Failed` 로 말한다
                    evs.push(Ev::RewindCaps { files: false, conversation: self.rewind_ok() });
                }
                Step { evs, stdin: Vec::new() }
            }
            (Purpose::TurnStart, None) => {
                if self.live_turn.is_none() {
                    self.live_turn = str_of(&r["turn"]["id"]);
                }
                Step::default()
            }
            (Purpose::TurnStart, Some(e)) => {
                self.queued.pop_front();
                Step::ev(Ev::TurnEnded { turn: None, outcome: Outcome::Error, message: Some(e) })
            }
            (Purpose::Interrupt, None) => Step::default(),
            (Purpose::Interrupt, Some(e)) => Step::ev(Ev::Notice { code: "interrupt-failed", detail: Some(e) }),
            // 오류 · 꼴이 틀림은 악수 실패가 아니다 — 메뉴에 스킬이 없을 뿐
            (Purpose::SkillsList, e) => {
                let Some(list) = e.is_none().then(|| skills_of(r, &self.cwd)).flatten() else {
                    self.dropped.unknown += 1;
                    return Step::default();
                };
                self.skills = list;
                let now: Vec<SlashCommand> = self.skills.iter().map(|(c, _)| c.clone()).collect();
                if self.cmd_sent.as_ref() == Some(&now) {
                    return Step::default();
                }
                self.cmd_sent = Some(now.clone());
                Step::ev(commands_ev(now, Vec::new()))
            }
            (p @ (Purpose::RewindPreview | Purpose::Revert), e) => self.on_rewind_answer(p, e, r),
            (Purpose::Compact, None) => Step::default(),
            (Purpose::Compact, Some(e)) => {
                self.compact_req = false;
                Step::ev(Ev::Notice { code: "compact-failed", detail: Some(e) })
            }
            (Purpose::Goal, None) => {
                self.goal_prev = None;
                let ev = r["goal"].is_object().then(|| self.goal_from(&r["goal"], None)).flatten();
                Step { evs: ev.into_iter().collect(), stdin: Vec::new() }
            }
            (Purpose::Goal, Some(e)) => {
                if let Some(prev) = self.goal_prev.take() {
                    self.goal_set_by_us = prev;
                }
                Step::ev(Ev::Notice { code: "goal-failed", detail: Some(e) })
            }
            // 턴은 `turn/started`(B) 가 연다 — 답의 턴 id(A)는 끝을 알아보는 데만 쓴다
            (Purpose::Review, None) => {
                self.review_root = str_of(&r["turn"]["id"]);
                Step::default()
            }
            (Purpose::Review, Some(e)) => {
                self.review_reset(false);
                Step::ev(Ev::Notice { code: "review-failed", detail: Some(e) })
            }
            (Purpose::McpList(gen), e) => self.on_mcp_page(gen, e, r),
        }
    }

    /// 채팅 타일만 · 같은 값이면 내지 않는다.
    fn context_ev(&mut self, used: u64, window: Option<u64>) -> Option<Ev> {
        if !self.tile || self.ctx_sent == Some((used, window)) {
            return None;
        }
        self.ctx_sent = Some((used, window));
        Some(Ev::ContextUsage { used, window, source: "tokenUsage" })
    }

    fn on_server_request(&mut self, v: &Value, method: &str) -> Step {
        let raw_id = v["id"].clone();
        let key = raw_id.to_string();
        let p = &v["params"];
        let mut session = false;
        let ev = match method {
            "item/commandExecution/requestApproval" => {
                let reason = p["reason"].as_str().unwrap_or("");
                let cwd = p["cwd"].as_str().unwrap_or("");
                let full = full_command(p);
                session = self.tile && !patch_command(&full);
                let input = self.tile.then(|| {
                    let item = p["itemId"].as_str().and_then(|i| self.files.get(i));
                    patch_command(&full).then(|| tile_patch_input(p, &full, item)).flatten().unwrap_or_else(|| tile_command_input(p))
                });
                let title = one_line(&display_command(p));
                Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::Command,
                    detail: cap(&[reason, cwd].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")),
                    tool_name: "commandExecution".into(),
                    input: input.and_then(tile_input),
                    session_allow: session.then(|| SessionAllow { kind: "command", detail: title.clone() }),
                    title,
                }
            }
            "item/fileChange/requestApproval" => {
                let (paths, diff, shown) = p["itemId"].as_str().and_then(|i| self.files.get(i)).cloned().unwrap_or_default();
                let reason = p["reason"].as_str().unwrap_or("");
                let input = (self.tile && !shown.is_empty()).then(|| tile_file_input(&paths, &shown, reason)).flatten();
                Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::FileChange,
                    title: one_line(&paths.join(", ")),
                    detail: cap(&[reason, diff.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")),
                    tool_name: "fileChange".into(),
                    input,
                    session_allow: None,
                }
            }
            "item/tool/requestUserInput" if self.tile => {
                let Some((ev, questions)) = tile_question(&key, p) else {
                    // 비밀 질문 · 못 그리는 꼴 — 질문 글을 어디에도 싣지 않는다
                    let line = json!({"jsonrpc": "2.0", "id": raw_id, "error": {"code": UNSUPPORTED, "message": TILE_USE_TERMINAL}}).to_string();
                    return Step { evs: vec![Ev::Notice { code: "needs-terminal", detail: Some(method.into()) }], stdin: vec![line] };
                };
                self.pending.insert(key, Pending { raw_id, elicitation: false, session: false, question: Some(questions) });
                return Step::ev(ev);
            }
            "mcpServer/elicitation/request" if p["_meta"]["codex_approval_kind"] == "mcp_tool_call" => {
                let server = p["serverName"].as_str().unwrap_or("").to_string();
                let tool = self.mcp_calls.get(&server).cloned().unwrap_or_default();
                let params = &p["_meta"]["tool_params"];
                let shown = if params.as_object().is_some_and(|o| !o.is_empty()) {
                    serde_json::to_string_pretty(params).unwrap_or_default()
                } else {
                    p["message"].as_str().unwrap_or("").to_string()
                };
                let title = if tool.is_empty() { server.clone() } else { format!("{server} · {tool}") };
                // 인자가 상한을 넘으면 이름만 — 카드는 인자를 `detail` 로 그린다
                let input = self.tile.then(|| {
                    let args = if params.is_object() { params.clone() } else { json!({}) };
                    tile_input(json!({"server": server, "tool": tool, "arguments": args})).unwrap_or_else(|| json!({"server": server, "tool": tool}))
                });
                let ev = Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::McpTool,
                    title: one_line(&title),
                    detail: cap(&shown),
                    tool_name: format!("mcp__{server}__{tool}"),
                    input: input.and_then(tile_input),
                    session_allow: None,
                };
                self.pending.insert(key, Pending { raw_id, elicitation: true, session: false, question: None });
                return Step::ev(ev);
            }
            "mcpServer/elicitation/request" => {
                let line = json!({"jsonrpc": "2.0", "id": raw_id, "result": {"action": "cancel"}}).to_string();
                return Step { evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(method.into()) }], stdin: vec![line] };
            }
            _ => {
                let message =
                    if self.tile { TILE_USE_TERMINAL.to_string() } else { format!("Aynx side chat does not handle {method} — ask in plain text") };
                let line = json!({"jsonrpc": "2.0", "id": raw_id, "error": {"code": UNSUPPORTED, "message": message}}).to_string();
                return Step { evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(one_line(method)) }], stdin: vec![line] };
            }
        };
        self.pending.insert(key, Pending { raw_id, elicitation: false, session, question: None });
        Step::ev(ev)
    }

    fn on_notification(&mut self, v: &Value, method: &str) -> Step {
        let p = &v["params"];
        let item = &p["item"];
        let item_id = || item["id"].as_str().unwrap_or("").to_string();
        let ev = match method {
            // 사람 글 없이 서는 턴(목표 · resume 뒤 CLI 스스로)도 같은 길이다. 검토 턴은 여기 id(B)로만 끊긴다
            "turn/started" => {
                self.live_turn = str_of(&p["turn"]["id"]);
                let mut evs = vec![Ev::TurnStarted { turn: self.live_turn.clone() }];
                if std::mem::take(&mut self.review_note) {
                    evs.push(Ev::Review { phase: ReviewPhase::Started, label: self.review_label.clone().unwrap_or_default(), text: None });
                }
                return Step { evs, stdin: Vec::new() };
            }
            "turn/completed" => {
                let t = &p["turn"];
                let (outcome, message) = match t["status"].as_str().unwrap_or("") {
                    "completed" => (Outcome::Ok, None),
                    "interrupted" => (Outcome::Interrupted, None),
                    _ => (Outcome::Error, Some(one_line(t["error"]["message"].as_str().unwrap_or("turn failed")))),
                };
                // 검토 턴의 끝은 A 로 온다 — 화면에는 연 턴(B)의 끝으로 알린다
                let review_end = self.review_req && self.review_root.is_some() && str_of(&t["id"]) == self.review_root;
                let turn = if review_end { self.live_turn.clone() } else { str_of(&t["id"]) };
                // 끊긴 검토도 CLI 는 끝 항목을 낸다 — 끝 표지는 턴의 결말로 가른다
                let review_mark = review_end.then(|| Ev::Review {
                    phase: if outcome == Outcome::Interrupted { ReviewPhase::Stopped } else { ReviewPhase::Done },
                    label: self.review_label.clone().unwrap_or_default(),
                    text: None,
                });
                if review_end {
                    self.review_reset(false);
                }
                self.live_turn = None;
                self.files.clear();
                self.compact_req = false;
                // 시작한 압축 항목이 끝나지 않은 턴 — 끊었으면 멈춤, 아니면 실패로 "압축하는 중" 줄을 닫는다
                let unfinished = self.tile && self.compact_trigger.is_some();
                (self.compact_trigger, self.compact_pre, self.compact_post) = (None, None, None);
                let mut evs = self.resolve_all(ResolvedBy::Cli);
                if unfinished {
                    evs.push(match outcome {
                        Outcome::Interrupted => Ev::Notice { code: "compact-canceled", detail: None },
                        _ => Ev::Notice { code: "compact-failed", detail: Some(message.clone().unwrap_or_else(|| "turn ended".into())) },
                    });
                }
                evs.extend(review_mark);
                evs.push(Ev::TurnEnded { turn, outcome, message });
                return Step { evs, stdin: Vec::new() };
            }
            // 채팅 타일만 — 아래 다섯은 사이드 채팅에서 지금 그대로(`QUIET` · 모르는 알림 · 도구 줄)
            "mcpServer/startupStatus/updated" if self.tile => return Step { evs: self.on_mcp_startup(p).into_iter().collect(), stdin: Vec::new() },
            "thread/goal/updated" if self.tile => {
                let ev = p["goal"].is_object().then(|| self.goal_from(&p["goal"], p["turnId"].as_str())).flatten();
                return Step { evs: ev.into_iter().collect(), stdin: Vec::new() };
            }
            "thread/goal/cleared" if self.tile => {
                self.goal_set_by_us = None;
                return Step { evs: self.goal_ev(None).into_iter().collect(), stdin: Vec::new() };
            }
            "item/started" if self.tile && item["type"] == "enteredReviewMode" => {
                let label = clip(&one_line(item["review"].as_str().unwrap_or("")), 120).0;
                self.review_label = Some(label.clone());
                if self.live_turn.is_none() {
                    self.review_note = true;
                    return Step::default();
                }
                Ev::Review { phase: ReviewPhase::Started, label, text: None }
            }
            "item/completed" if self.tile && item["type"] == "enteredReviewMode" => return Step::default(),
            "item/started" if self.tile && item["type"] == "exitedReviewMode" => return Step::default(),
            // 결과 글은 뒤따르는 `agentMessage` 와 같다 — 표지에는 싣지 않고, 끝 표지는 턴 끝에 낸다
            "item/completed" if self.tile && item["type"] == "exitedReviewMode" => return Step::default(),
            // 검토 턴에서 CLI 가 지은 지시 글 — 사람 말이 아니다(보낸 글의 자리도 쓰지 않는다)
            "item/started" if self.tile && self.review_req && item["type"] == "userMessage" && item["clientId"].is_null() => return Step::default(),
            "item/agentMessage/delta" => Ev::TextDelta { item: str_of(&p["itemId"]), text: p["delta"].as_str().unwrap_or("").into() },
            // 채팅 타일만 — 계획 항목은 글 덩어리(`#plan` 꼬리 · 승인 요청 없음). 사이드 채팅은 모르는 알림 · 도구 줄 그대로
            "item/plan/delta" if self.tile => {
                Ev::TextDelta { item: Some(format!("{}#plan", p["itemId"].as_str().unwrap_or(""))), text: p["delta"].as_str().unwrap_or("").into() }
            }
            "item/started" if self.tile && item["type"] == "plan" => return Step::default(),
            "item/completed" if self.tile && item["type"] == "plan" => {
                Ev::Text { item: Some(format!("{}#plan", item_id())), text: item["text"].as_str().unwrap_or("").into() }
            }
            // 채팅 타일만 — 압축 항목은 도구 줄이 아니라 압축 표지. 사이드 채팅은 모르는 종류 갈래(도구 줄) 그대로
            "item/started" if self.tile && item["type"] == "contextCompaction" => {
                let trigger = if self.compact_req { "manual" } else { "auto" };
                self.compact_trigger = Some(trigger);
                self.compact_pre = self.last_used;
                self.compact_post = None;
                Ev::Compaction { phase: CompactPhase::Started, trigger: Some(trigger.into()), pre_tokens: None, post_tokens: None }
            }
            "item/completed" if self.tile && item["type"] == "contextCompaction" => {
                let trigger = self.compact_trigger.take().unwrap_or(if self.compact_req { "manual" } else { "auto" });
                let pre = self.compact_pre.take().or(self.last_used);
                Ev::Compaction { phase: CompactPhase::Done, trigger: Some(trigger.into()), pre_tokens: pre, post_tokens: self.compact_post.take() }
            }
            // 맥락 사용량은 받기만 — 압축 직후의 `last` 는 `totalTokens` 만 차 있다
            "thread/tokenUsage/updated" if self.tile => {
                let tu = &p["tokenUsage"];
                let Some(total) = tu["last"]["totalTokens"].as_u64() else { return Step::default() };
                let used = total.saturating_sub(tu["last"]["reasoningOutputTokens"].as_u64().unwrap_or(0));
                if let Some(w) = tu["modelContextWindow"].as_u64() {
                    self.window = Some(w);
                }
                self.last_used = Some(used);
                if self.compact_trigger.is_some() {
                    self.compact_post = Some(used);
                }
                return Step { evs: self.context_ev(used, self.window).into_iter().collect(), stdin: Vec::new() };
            }
            // 옛 압축 알림 · 스킬 바뀜(목록은 악수 끝에 한 번만 읽는다) · 되감기 끝(답이 이미 말했다)
            "thread/compacted" | "skills/changed" | "thread/reverted" if self.tile => return Step::default(),
            "thread/settings/updated" if self.tile => {
                let mode = settings_mode(&p["threadSettings"]);
                if mode.is_some() {
                    self.config_mode = mode;
                }
                return Step { evs: self.mode_ev().into_iter().collect(), stdin: Vec::new() };
            }
            "item/commandExecution/outputDelta" => {
                Ev::ToolOutput { item: p["itemId"].as_str().unwrap_or("").into(), text: p["delta"].as_str().unwrap_or("").into() }
            }
            "item/started" => match item["type"].as_str().unwrap_or("") {
                "userMessage" => {
                    let queued = self.queued.pop_front().flatten();
                    Ev::UserAccepted { client_id: str_of(&item["clientId"]).or(queued), text: None, files: Vec::new() }
                }
                "agentMessage" | "reasoning" => return Step::default(),
                kind => {
                    let id = item_id();
                    let (name, summary) = match kind {
                        "commandExecution" => ("command".to_string(), display_command(item)),
                        "fileChange" => {
                            let paths: Vec<String> =
                                item["changes"].as_array().into_iter().flatten().filter_map(|c| str_of(&c["path"])).collect();
                            let diff: String = item["changes"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .map(|c| format!("{}\n{}", c["path"].as_str().unwrap_or(""), c["diff"].as_str().unwrap_or("")))
                                .collect::<Vec<_>>()
                                .join("\n");
                            let shown = if self.tile { tile_change_diff(item["changes"].as_array().map(Vec::as_slice).unwrap_or(&[])) } else { String::new() };
                            self.files.insert(id.clone(), (paths.clone(), diff, shown));
                            ("fileChange".to_string(), paths.join(", "))
                        }
                        "webSearch" => ("webSearch".to_string(), item["query"].as_str().unwrap_or("").to_string()),
                        "imageGeneration" => ("imageGeneration".to_string(), String::new()),
                        // 이름은 Claude 와 같은 꼴 `mcp__<서버>__<도구>` 로 낸다
                        "mcpToolCall" => {
                            let server = item["server"].as_str().unwrap_or("").to_string();
                            let tool = item["tool"].as_str().unwrap_or("").to_string();
                            let name = format!("mcp__{server}__{tool}");
                            self.mcp_calls.insert(server, tool);
                            (name, mcp_summary(&item["arguments"]))
                        }
                        other => (other.to_string(), item["tool"].as_str().or(item["name"].as_str()).unwrap_or("").to_string()),
                    };
                    self.tools.insert(id.clone());
                    Ev::ToolStarted { item: id, name, summary: one_line(&summary), input: None }
                }
            },
            "item/completed" => match item["type"].as_str().unwrap_or("") {
                "agentMessage" => Ev::Text { item: str_of(&item["id"]), text: item["text"].as_str().unwrap_or("").into() },
                "userMessage" | "reasoning" => return Step::default(),
                kind => {
                    let id = item_id();
                    if !self.tools.remove(&id) {
                        self.dropped.unknown += 1;
                        return Step::default();
                    }
                    let status = item["status"].as_str().unwrap_or("completed");
                    let (ok, output) = match kind {
                        "commandExecution" => (
                            status == "completed" && item["exitCode"].as_i64().unwrap_or(0) == 0,
                            item["aggregatedOutput"].as_str().map(cap),
                        ),
                        "webSearch" => (true, item["results"][0]["title"].as_str().or(item["query"].as_str()).map(one_line)),
                        "fileChange" => {
                            self.files.remove(&id);
                            (status == "completed", None)
                        }
                        "imageGeneration" => return image_finished(item, id),
                        "mcpToolCall" => {
                            let text: Vec<&str> =
                                item["result"]["content"].as_array().into_iter().flatten().filter_map(|c| c["text"].as_str()).collect();
                            let output = item["error"]["message"]
                                .as_str()
                                .map(one_line)
                                .or_else(|| (!text.is_empty()).then(|| cap(&text.join("\n"))));
                            (status == "completed", output)
                        }
                        _ => (!matches!(status, "failed" | "declined"), None),
                    };
                    Ev::ToolFinished { item: id, ok, output }
                }
            },
            "serverRequest/resolved" => {
                let key = p["requestId"].to_string();
                if self.pending.remove(&key).is_none() {
                    return Step::default(); // 사람이 이미 답했다(그때 resolved 를 냈다).
                }
                Ev::PermissionResolved { request_id: key, decision: None, by: ResolvedBy::Cli }
            }
            "error" => {
                let code = if p["willRetry"] == true { "cli-retrying" } else { "cli-error" };
                Ev::Notice { code, detail: p["error"]["message"].as_str().map(one_line) }
            }
            m if QUIET.contains(&m) || m.starts_with("item/reasoning/") => return Step::default(),
            _ => {
                self.dropped.unknown += 1;
                return Step::default();
            }
        };
        Step::ev(ev)
    }

    fn resolve_all(&mut self, by: ResolvedBy) -> Vec<Ev> {
        std::mem::take(&mut self.pending)
            .into_keys()
            .map(|request_id| Ev::PermissionResolved { request_id, decision: None, by })
            .collect()
    }
}

/// `result`(그림 바이트)는 어디에도 싣지 않는다 — 통로 · 화면은 경로만 안다.
fn image_finished(item: &Value, id: String) -> Step {
    let prompt = item["revisedPrompt"].as_str().unwrap_or("");
    let failure = item["failure"].as_object().map(|f| f.get("type").and_then(Value::as_str).unwrap_or("failed").to_string());
    let path = item["savedPath"].as_str().filter(|p| !p.trim().is_empty());
    let ok = item["status"].as_str() == Some("completed") && failure.is_none() && path.is_some();
    let output = match &failure {
        Some(f) => Some(one_line(f)),
        None => (!prompt.trim().is_empty()).then(|| cap(prompt)),
    };
    let mut evs = vec![Ev::ToolFinished { item: id.clone(), ok, output }];
    if let (true, Some(path)) = (ok, path) {
        evs.push(Ev::Text { item: Some(format!("{id}#image")), text: image_markdown(prompt, path) });
    }
    Step { evs, stdin: Vec::new() }
}

/// 숨긴 모델도 넣는다 — 지금 채팅이 그 모델일 수 있다.
pub(crate) fn model_list_efforts(result: &Value) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    for m in result["data"].as_array().into_iter().flatten() {
        let Some(id) = m["id"].as_str().filter(|v| word_ok(v)) else { continue };
        let levels: Vec<String> = m["supportedReasoningEfforts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|o| o["reasoningEffort"].as_str())
            .filter(|e| word_ok(e))
            .map(str::to_string)
            .collect();
        out.insert(id.to_string(), levels);
    }
    out
}

/// 모델마다 `serviceTiers[]` — 등급이 하나라도 있는 모델만 든다.
pub(crate) fn model_list_tiers(result: &Value) -> BTreeMap<String, Vec<Tier>> {
    let mut out = BTreeMap::new();
    for m in result["data"].as_array().into_iter().flatten() {
        let Some(id) = m["id"].as_str().filter(|v| word_ok(v)) else { continue };
        let tiers = tiers_of(&m["serviceTiers"]);
        if !tiers.is_empty() {
            out.insert(id.to_string(), tiers);
        }
    }
    out
}

fn with(mut base: Value, kv: &[(&str, Value)]) -> Value {
    for (k, v) in kv {
        base[*k] = v.clone();
    }
    base
}

/// 채팅 타일 명령 카드 — 사람이 허용하는 **실제 명령 전체**. 너무 길면 자르고 `commandTruncated` 를 단다.
fn tile_command_input(p: &Value) -> Value {
    let full = full_command(p);
    let (reason, _) = clip(p["reason"].as_str().unwrap_or(""), TILE_REASON_MAX);
    let cwd: String = clip(p["cwd"].as_str().unwrap_or(""), TILE_REASON_MAX).0;
    let mut max = TILE_COMMAND_MAX;
    loop {
        let (command, cut) = clip(&full, max);
        let mut o = json!({"command": command, "cwd": (!cwd.is_empty()).then_some(&cwd), "reason": (!reason.is_empty()).then_some(&reason)});
        if cut {
            o["commandTruncated"] = json!(true);
        }
        // 이스케이프로 부푼 명령은 더 자른다 — 카드가 명령 없이 서지 않게
        if o.to_string().len() <= super::event::DETAIL_MAX || max == 0 {
            return o;
        }
        max /= 2;
    }
}

const TILE_COMMAND_MAX: usize = 10 * 1024;
const TILE_REASON_MAX: usize = 2 * 1024;
/// 패치 카드의 명령 — 명령 전체는 카드 아래에 늘 보이므로 앞만.
const TILE_PATCH_COMMAND_MAX: usize = 4 * 1024;

fn full_command(p: &Value) -> String {
    match &p["command"] {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        _ => display_command(p),
    }
}

/// 상한을 넘으면 패치를 반씩 줄인다 — 그래도 넘으면 `None`.
fn fit_patch(mut base: Value, patch: &str) -> Option<Value> {
    let mut max = patch.len();
    loop {
        let (text, cut) = clip(patch, max);
        base["patch"] = json!(text);
        if cut {
            base["patchTruncated"] = json!(true);
        }
        if base.to_string().len() <= DETAIL_MAX {
            return Some(base);
        }
        if max == 0 {
            return None;
        }
        max /= 2;
    }
}

/// apply_patch 감싸개 명령 카드 — 재료는 ① 명령 글의 패치(실행되는 바로 그것) ② 같은 `itemId` 의 `fileChange` 항목 diff. 둘 다 없거나 넘치면 `None`.
fn tile_patch_input(p: &Value, full: &str, item: Option<&(Vec<String>, String, String)>) -> Option<Value> {
    let (patch, kind, files) = match (apply_patch_text(full), item) {
        (Some(t), _) => {
            let f = crate::tile_permission::patch_files(&t);
            (t, "applyPatch", f)
        }
        (None, Some((paths, _, shown))) if !shown.is_empty() => (shown.clone(), "unified", paths.clone()),
        _ => return None,
    };
    let (command, cmd_cut) = clip(full, TILE_PATCH_COMMAND_MAX);
    let (reason, _) = clip(p["reason"].as_str().unwrap_or(""), TILE_REASON_MAX);
    let (cwd, _) = clip(p["cwd"].as_str().unwrap_or(""), TILE_REASON_MAX);
    let mut base = json!({"command": command, "cwd": (!cwd.is_empty()).then_some(&cwd), "reason": (!reason.is_empty()).then_some(&reason),
        "patchKind": kind, "files": files});
    if cmd_cut {
        base["commandTruncated"] = json!(true);
    }
    fit_patch(base, &patch)
}

/// 채팅 타일 카드의 diff(`unified`) — 파일 이름은 카드 머리(`files`)가 한 번만 보인다. 새 파일 · 지운 파일의 `diff` 는 몸 글 그대로라
/// 모든 줄을 `+` / `-` 로 짓고, 고친 파일은 CLI 의 unified diff 그대로. 파일이 둘 이상이면 파일마다 `diff --git` 머리로 가른다.
fn tile_change_diff(changes: &[Value]) -> String {
    let many = changes.len() > 1;
    let mut out = String::new();
    for c in changes {
        let path = c["path"].as_str().unwrap_or("");
        let body = c["diff"].as_str().unwrap_or("");
        if many {
            out.push_str(&format!("diff --git a/{path} b/{path}\n"));
        }
        let kind = c["kind"]["type"].as_str().or(c["kind"].as_str()).unwrap_or("update");
        if kind == "add" || kind == "delete" {
            let lines: Vec<&str> = body.split_terminator('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
            let n = lines.len();
            let (sign, head) = if kind == "add" { ('+', format!("@@ -0,0 +1,{n} @@")) } else { ('-', format!("@@ -1,{n} +0,0 @@")) };
            out.push_str(&head);
            out.push('\n');
            for l in lines {
                out.push(sign);
                out.push_str(l);
                out.push('\n');
            }
        } else {
            out.push_str(body);
            if !body.is_empty() && !body.ends_with('\n') {
                out.push('\n');
            }
        }
    }
    out
}

/// 파일 승인 카드 — 앞선 `item/started{fileChange}` 의 diff(`tile_change_diff`).
fn tile_file_input(paths: &[String], diff: &str, reason: &str) -> Option<Value> {
    let (reason, _) = clip(reason, TILE_REASON_MAX);
    let base = json!({"files": paths, "patchKind": "unified", "reason": (!reason.is_empty()).then_some(&reason)});
    fit_patch(base, diff)
}

/// 질문 카드 — 1~8 개 · 질문마다 `id` · `question` 글. **비밀 질문(`isSecret`)이 하나라도 있으면 `None`**(글을 싣지 않는다).
fn tile_question(key: &str, p: &Value) -> Option<(Ev, Value)> {
    let qs = p["questions"].as_array()?;
    let ok = (1..=8).contains(&qs.len())
        && qs.iter().all(|q| q["isSecret"] != true && q["id"].as_str().is_some_and(|s| !s.is_empty()) && q["question"].is_string());
    if !ok {
        return None;
    }
    let questions = Value::Array(qs.clone());
    let input = tile_input(json!({"questions": questions}))?;
    let title = qs[0]["header"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("request_user_input");
    let text: Vec<&str> = qs.iter().filter_map(|q| q["question"].as_str()).collect();
    let ev = Ev::Permission {
        request_id: key.to_string(),
        kind: PermKind::Tool,
        title: one_line(title),
        detail: cap(&text.join("\n")),
        tool_name: "request_user_input".into(),
        input: Some(input),
        session_allow: None,
    };
    Some((ev, questions))
}

fn display_command(v: &Value) -> String {
    v["commandActions"][0]["command"]
        .as_str()
        .or(v["command"].as_str())
        .unwrap_or("")
        .to_string()
}

impl Adapter for Codex {
    fn cli(&self) -> Cli {
        Cli::Codex
    }

    /// `experimentalApi` 는 채팅 타일만 참(`collaborationMode` 가 그것을 요구한다) — 사이드 채팅 · 프로듀서는 거짓 그대로.
    fn handshake(&mut self) -> Vec<String> {
        let params = json!({"clientInfo": {"name": "aynx", "title": "Aynx", "version": self.client_version},
            "capabilities": {"experimentalApi": self.tile}});
        vec![self.request(Purpose::Initialize, "initialize", params)]
    }

    fn on_line(&mut self, line: &str) -> Step {
        let v: Value = match serde_json::from_str(line) {
            Ok(v @ Value::Object(_)) => v,
            _ => {
                self.dropped.bad += 1;
                return Step::default();
            }
        };
        match (v["method"].as_str().map(str::to_string), v.get("id").is_some()) {
            (Some(m), true) => self.on_server_request(&v, &m),
            (Some(m), false) => self.on_notification(&v, &m),
            (None, true) => self.on_response(&v),
            (None, false) => {
                self.dropped.unknown += 1;
                Step::default()
            }
        }
    }

    /// 채팅 타일의 스킬 항목은 글 뒤에 — 글의 `$이름` 도 그대로 간다(둘 다 실어도 주입은 한 번).
    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str> {
        let picked = std::mem::take(&mut self.skills_pending);
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        let mut input: Vec<Value> = images.iter().map(|im| json!({"type": "localImage", "path": im.path})).collect();
        if images.is_empty() || !text.trim().is_empty() {
            input.push(json!({"type": "text", "text": text, "text_elements": []}));
        }
        if self.tile {
            input.extend(picked.into_iter().map(|(name, path)| json!({"type": "skill", "name": name, "path": path})));
        }
        let mut params = json!({"threadId": thread, "input": input, "model": self.model_json()});
        if let Some(e) = &self.effort {
            params["effort"] = json!(e);
            self.effort_sent = true;
        } else if let Some(d) = self.thread_effort.as_ref().filter(|_| self.effort_sent) {
            params["effort"] = json!(d);
        }
        if let Some(c) = client_id {
            params["clientUserMessageId"] = json!(c);
        }
        if let Some(t) = self.tier_for_turn().filter(|_| self.tile) {
            params["serviceTierForTurn"] = json!(t);
        }
        self.add_policy(&mut params);
        self.queued.push_back(client_id.map(str::to_string));
        Ok(Step::line(self.request(Purpose::TurnStart, "turn/start", params)))
    }

    fn encode_interrupt(&mut self) -> Result<Step, &'static str> {
        let (Some(thread), Some(turn)) = (self.thread.clone(), self.live_turn.clone()) else {
            return Err("no-turn");
        };
        Ok(Step::line(self.request(Purpose::Interrupt, "turn/interrupt", json!({"threadId": thread, "turnId": turn}))))
    }

    fn encode_set_model(&mut self, model: &str) -> Result<Step, &'static str> {
        if !word_ok(model) {
            return Err("bad-model");
        }
        self.model = model.to_string();
        Ok(Step::ev(Ev::ModelChanged { model: model.to_string() }))
    }

    fn encode_set_effort(&mut self, effort: Option<&str>) -> Result<Step, &'static str> {
        if effort.is_some_and(|e| !effort_ok(&self.efforts, e)) {
            return Err("bad-effort");
        }
        self.effort = effort.map(str::to_string);
        Ok(Step::ev(Ev::EffortChanged { effort: self.effort.clone() }))
    }

    fn encode_decision(&mut self, request_id: &str, decision: Decision, _message: Option<&str>) -> Result<Step, &'static str> {
        let p = self.pending.get(request_id).ok_or("unknown-request")?;
        // 질문의 허용은 답(`encode_tile_answer`)으로만
        if decision == Decision::Allow && p.question.is_some() {
            return Err("bad-answer");
        }
        let p = self.pending.remove(request_id).ok_or("unknown-request")?;
        let word = match decision {
            Decision::Allow => "accept",
            Decision::Deny => "decline",
        };
        // MCP 도구 승인은 elicitation 답 꼴(스키마 `McpServerElicitationRequestResponse`) · 답하지 않은 질문은 빈 답
        let result = if p.question.is_some() {
            json!({"answers": {}})
        } else if p.elicitation {
            json!({"action": word, "content": null})
        } else {
            json!({"decision": word})
        };
        Ok(Step {
            evs: vec![Ev::PermissionResolved {
                request_id: request_id.to_string(),
                decision: Some(decision),
                by: ResolvedBy::Human,
            }],
            stdin: vec![json!({"jsonrpc": "2.0", "id": p.raw_id, "result": result}).to_string()],
        })
    }

    /// stdin 없음 — 다음 `turn/start` 부터 싣는다.
    fn encode_set_perm_mode(&mut self, mode: &str) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        if !self.choices().iter().any(|c| c == mode) {
            return Err("bad-mode");
        }
        if mode == "plan" && self.model.is_empty() && self.thread_model.is_none() {
            return Err("not-ready");
        }
        self.perm_mode = Some(mode.to_string());
        Ok(Step { evs: self.mode_ev().into_iter().collect(), stdin: Vec::new() })
    }

    fn encode_tile_answer(&mut self, request_id: &str, answer: TileAnswer<'_>) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let p = self.pending.get(request_id).ok_or("unknown-request")?;
        let result = match answer {
            TileAnswer::AllowSession if p.session => json!({"decision": "acceptForSession"}),
            TileAnswer::AllowSession => return Err("no-session-allow"),
            TileAnswer::Answers(given) => {
                let qs = p.question.as_ref().ok_or("bad-answer")?;
                let checked = crate::tile_permission::checked_answers(&json!({"questions": qs}), given).ok_or("bad-answer")?;
                let ids = qs.as_array().into_iter().flatten().map(|q| q["id"].as_str().unwrap_or(""));
                let answers: serde_json::Map<String, Value> =
                    ids.zip(checked).map(|(id, (_, a, _))| (id.to_string(), json!({"answers": [a]}))).collect();
                json!({"answers": answers})
            }
        };
        let p = self.pending.remove(request_id).ok_or("unknown-request")?;
        Ok(Step {
            evs: vec![Ev::PermissionResolved { request_id: request_id.to_string(), decision: Some(Decision::Allow), by: ResolvedBy::Human }],
            stdin: vec![json!({"jsonrpc": "2.0", "id": p.raw_id, "result": result}).to_string()],
        })
    }

    /// CLI 는 턴 중의 압축을 막지 않고 돌던 턴을 끊는다 — 그래서 여기서 먼저 거절한다. 지침은 받지 않는다.
    fn encode_compact(&mut self, instructions: Option<&str>) -> Result<Step, &'static str> {
        if !self.tile || instructions.is_some() {
            return Err("unsupported");
        }
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        if self.turn_busy() {
            return Err("turn-running");
        }
        self.compact_req = true;
        Ok(Step::line(self.request(Purpose::Compact, "thread/compact/start", json!({"threadId": thread}))))
    }

    /// 미리 보기의 `thread/turns/list` 는 이 사람 op 의 몸이다(대화를 바꾸지 않는 읽기). `last_seen` 은 쓰지 않는다.
    fn encode_rewind(&mut self, anchor: &str, scope: &str, dry_run: bool, _last_seen: Option<&str>) -> Result<Step, &'static str> {
        if !self.tile || scope != "conversation" || !self.rewind_ok() {
            return Err("unsupported");
        }
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        if self.turn_busy() {
            return Err("turn-running");
        }
        if self.rewind_req.is_some() {
            return Err("rewind-running");
        }
        if !uuid_ok(anchor) {
            return Err("bad-anchor");
        }
        self.rewind_req = Some(anchor.to_string());
        let line = if dry_run {
            let params = json!({"threadId": thread, "limit": 100, "sortDirection": "desc", "itemsView": "notLoaded"});
            self.request(Purpose::RewindPreview, "thread/turns/list", params)
        } else {
            self.request(Purpose::Revert, "thread/revert", json!({"threadId": thread, "beforeTurnId": anchor}))
        };
        Ok(Step::line(line))
    }

    /// 경로는 어댑터 자신의 목록(`skills/list` 답)에서만 — 프런트는 이름만 준다.
    fn encode_tile_skills(&mut self, names: &[String]) -> Result<(), &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let picked = names
            .iter()
            .map(|n| self.skills.iter().find(|(c, _)| c.name == *n).map(|(c, p)| (c.name.clone(), p.clone())).ok_or("bad-skill"))
            .collect::<Result<Vec<_>, _>>()?;
        self.skills_pending = picked;
        Ok(())
    }

    /// 같은 대화 안(inline)의 턴 — 따로 스레드를 만들지 않는다. 대상은 서버가 본 것만 온다.
    fn encode_review(&mut self, target: &ReviewTarget) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        if self.turn_busy() {
            return Err("turn-running");
        }
        self.review_reset(true);
        let params = json!({"threadId": thread, "target": target.cli_json(), "delivery": "inline"});
        Ok(Step::line(self.request(Purpose::Review, "review/start", params)))
    }

    /// `origin:"user"` 은 이 몸에서만 — 사람 op(목표 · 끊기의 멈춤)가 부를 때뿐이다. 사건은 답 · 알림이 낸다.
    fn encode_goal(&mut self, action: &GoalAction<'_>) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        self.goal_prev = Some(self.goal_set_by_us.clone());
        let (method, params) = match action {
            GoalAction::Set { objective, budget } => {
                self.goal_set_by_us = Some(objective.trim().to_string());
                let p = json!({"threadId": thread, "objective": objective.trim(), "status": "active", "origin": "user", "tokenBudget": budget});
                ("thread/goal/set", p)
            }
            GoalAction::Pause => ("thread/goal/set", json!({"threadId": thread, "status": "paused", "origin": "user"})),
            GoalAction::Resume => ("thread/goal/set", json!({"threadId": thread, "status": "active", "origin": "user"})),
            GoalAction::Clear => {
                self.goal_set_by_us = None;
                ("thread/goal/clear", json!({"threadId": thread, "origin": "user"}))
            }
        };
        Ok(Step::line(self.request(Purpose::Goal, method, params)))
    }

    /// stdin 없음 — 다음 턴 몸부터. 모델 목록을 안 뒤에는 그 모델의 등급 밖을 거절한다(CLI 는 없는 값도 받는다).
    fn encode_set_tier(&mut self, tier: Option<&str>) -> Result<(), &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        if let Some(t) = tier {
            let listed = self.models.is_some() && self.current_model().is_some();
            if !tier_ok(t) || (listed && !self.current_model().and_then(|m| self.tiers.get(m)).is_some_and(|l| l.iter().any(|x| x.id == t))) {
                return Err("bad-tier");
            }
        }
        self.tier = tier.map(str::to_string);
        Ok(())
    }

    /// 사람이 연 풍선의 읽기 — 작은 쪽부터(다음 쪽은 답이 이어 묻는다).
    fn encode_mcp_status(&mut self) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        self.mcp_gen += 1;
        let gen = self.mcp_gen;
        self.mcp_read = Some(McpRead { gen, rows: Vec::new(), pages: 1 });
        let params = json!({"threadId": thread, "detail": "toolsAndAuthOnly", "limit": MCP_PAGE});
        Ok(Step::line(self.request(Purpose::McpList(gen), "mcpServerStatus/list", params)))
    }

    fn close_pending(&mut self) -> Vec<Ev> {
        self.live_turn = None;
        self.queued.clear();
        self.skills_pending.clear();
        self.mcp_read = None;
        self.review_reset(false);
        self.rewind_req = None;
        self.compact_req = false;
        (self.compact_trigger, self.compact_pre, self.compact_post) = (None, None, None);
        self.files.clear();
        self.mcp_calls.clear();
        self.resolve_all(ResolvedBy::Closed)
    }

    fn dropped(&self) -> Dropped {
        self.dropped
    }
}
