//! Claude Code 어댑터 — `claude -p` stream-json 양방향(docs/log/2026-10-23-side-chat-structured-spike.md). 순수.
//!
//! - 설정 출처 통제: `--setting-sources ""` + 훅 끈 설정 파일 · MCP 는 채팅 파일만(`--strict-mcp-config`). 내장 도구는 `--tools` 로 읽기 · 웹 다섯뿐(쓰기 · 명령 · Task 없음).
//! - 미리 허용 = cwd 안 `Read(./**)` + `WebSearch` + `WebFetch` — cwd 밖 읽기만 카드로 묻는다. 예외: 갈라 온 채팅은 서버가 첨부 폴더 읽기를 인자 끝에 더한다(`server::side_chat::attach_read`).
//! - `--permission-prompt-tool stdio` 와 `--tools` 를 함께 써도 `can_use_tool` 이 그대로 온다(실측).
//! - `system/init` 은 턴마다 온다 — 턴 시작 신호로 쓴다. 준비 = `initialize` 제어 요청의 답.
//! - 대화 중 강도 = `apply_flag_settings{settings:{effortLevel}}`(메모리뿐 · 설정 파일을 쓰지 않는다) — 모르는 낱말도 성공으로 답하고 무시하니 [`effort_ok`] 로 거른다.
//! - 끊기 = 제어 요청 `interrupt` → `result{terminal_reason:"aborted_streaming"}`.
//! - 대화형 도구가 `can_use_tool` 로 오면(막았어도) 곧바로 거절 + [`ASK_PLAINLY`]. 모르는 제어 요청은 오류로 답한다(영영 기다리지 않게).
//! - 채팅 타일([`tile_argv`] · [`Claude::tile`])은 위 제한을 하나도 싣지 않는다 — 계획 · 질문은 카드로, 그 밖의 대화형 요청은 [`TILE_USE_TERMINAL`] 로 거절한다.
//! - 채팅 타일의 권한 모드는 CLI 자신의 것이다(`set_permission_mode` · 다시 띄울 때 `--permission-mode`) — 칩이 내는 값은 [`TILE_MODES`] 뿐이고
//!   `auto` 는 지금 모델의 `supportsAutoMode` 가 참일 때만 고를 수 있다. CLI 가 알린 모드(`system/init` · `system/status`)를 믿는다(미지원 모델의 `auto` 인자는 오류 없이 `default` 로 뜬다).
//! - [이 대화에서 늘 허용]은 [`session_pick`] 이 그 요청의 제안에서 하나를 골라 **목적지 `session` 으로 고쳐** 싣는다 — 설정 파일에 쓰는 제안은 서버 밖으로 나가지 않는다.
//! - 채팅 타일 압축: `system/status{compacting}` 이 `init` 보다 먼저 와서 거기서 턴을 연다 · 실패는 `status.compact_result` 로만 안다(`result.is_error` 는 늘 거짓) ·
//!   `compact_boundary` 뒤 ~ `result` 의 `<synthetic>` 줄(과 `preserved_messages.uuids`)은 앞선 출력의 재생이라 버린다(재생 줄에는 `isReplay` 가 없다).
//!   실패 뒤의 `<synthetic>` 글은 알림과 같은 말이라 버린다 · 압축 중 끊었으면 실패가 아니라 `compact-canceled`.
//! - 채팅 타일 맥락 사용량은 받기만 한다 — `result.usage.iterations` 마지막 원소의 입력 합(최상위 합은 턴 안 누적) · `/context` 줄.
//!   압축의 `post_tokens` 는 시스템 지침 · 도구가 빠진 수라 미터에 넣지 않는다 — 압축 뒤에는 앞 값을 `preCompact` 로 다시 알린다.
//! - 채팅 타일 되감기: 파일 = `rewind_files`(CLI 체크포인트 환경으로 띄운 턴만 · 미리 보기는 `dry_run`) · 대화 = `rewind_conversation`(미리 보기 요청이 없다).
//!   **`rewind_conversation` 은 공개 문서에 없는 요청이다** — `error` 답(모르는 요청)이면 `Failed{unsupported}` 와 함께 캡의 대화를 내린다.
//!   `both` 는 파일 먼저 · 성공했을 때만 대화. CLI 는 턴 중에도 되감으니 턴 판정은 어댑터 · 서버가 먼저 한다.
//! - 채팅 타일 MCP 상태: `system/init.mcp_servers` 를 받기만 하고, 사람이 연 풍선에서만 `mcp_status` 를 묻는다. **그 답의 `config` 에는 머리글 값
//!   (Aynx 채팅 토큰 포함) · 명령 · 인자 · URL 이 평문으로 있다** — [`mcp_rows_claude`] 가 이름 · 상태 · 출처 · 도구 수만 꺼내고, 답 몸은 오류 글 · 셈 · 사건 어디에도 싣지 않는다.
//! - `/goal` 이 여는 이어지는 일은 한 턴 안의 합성 user 줄(`isSynthetic` · "Stop hook feedback")로 온다 — 사람 말이 아니라 버린다. 턴은 `result` 하나로 끝난다.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Map, Value};

use super::event::{
    cap, clip, commands_ev, effort_ok, mcp_row_name, mcp_summary, model_ok, one_line, push_mcp_row, rewind_error, rewind_ev, rewind_scope, semver3, slash_desc,
    slash_name_ok, split_mcp_tool, str_of, tile_input, uuid_ok, word_ok, Cli, CompactPhase, Decision, Dropped, Ev, McpRow, Mode, Outcome, PermKind, ResolvedBy,
    RewindMore, RewindPhase, SessionAllow, SlashCommand, Step, TileAnswer, UserImage, ALIASES_MAX, COMMANDS_MAX, DETAIL_MAX, HINT_BYTES, REWIND_FILES_MAX,
    REWIND_PATH_BYTES,
};
use super::Adapter;

/// 확인한 버전의 시작 — CLI 가 며칠마다 올라 정확 일치로는 경고가 늘 뜨니 같은 major · minor 의 이 patch 이상을 받는다.
/// 그 밖(낮은 버전 · 계열이 바뀐 버전 · 못 읽은 버전)은 `notice{untested-version}` 만 낸다.
pub(crate) const TESTED_FROM: [u64; 3] = [2, 1, 309];

pub(crate) fn tested(version: Option<&str>) -> bool {
    version.and_then(semver3).is_some_and(|v| v[..2] == TESTED_FROM[..2] && v[2] >= TESTED_FROM[2])
}

/// `--settings` 파일의 본문 — 훅을 모두 끈다(판정형 턴 후보 B 와 같다).
pub(crate) const SETTINGS_JSON: &str = r#"{"disableAllHooks":true}"#;
/// `--mcp-config` 파일의 기본 본문 — MCP 없음(세션 서버의 MCP 포트가 없거나 채팅 토큰을 못 뽑았을 때).
pub(crate) const MCP_CONFIG_EMPTY: &str = r#"{"mcpServers":{}}"#;

/// Aynx 세션 서버 하나 · 그 프로세스의 채팅 토큰(`crate::chat_token`) — `--strict-mcp-config` 와 짝이라 사용자 MCP 서버는 싣지 않는다.
pub(crate) fn mcp_config(name: &str, url: &str, token: &str) -> String {
    serde_json::json!({
        "mcpServers": { name: { "type": "http", "url": url, "headers": { "Authorization": format!("Bearer {token}") } } }
    })
    .to_string()
}

/// 사람이 사이드 채팅에 고른 외부 서버를 더한다 — 그 밖(사용자 CLI 설정)은 `--strict-mcp-config` 가 막는다. 이미 있는 이름(Aynx 서버)은 덮지 않는다.
pub(crate) fn mcp_config_with(base: &str, external: &[crate::agent_mcp::McpServer]) -> String {
    let mut v: Value = serde_json::from_str(base).unwrap_or_else(|_| json!({"mcpServers": {}}));
    if let Some(map) = v["mcpServers"].as_object_mut() {
        for s in external {
            if !map.contains_key(&s.name) {
                map.insert(s.name.clone(), crate::agent_mcp::claude_entry(s));
            }
        }
    }
    v.to_string()
}

// 외부 MCP 서버의 도구는 CLI 에 미리 허용하지 않는다 — 늘 `can_use_tool` 로 오고, 묻지 않기는 세션 서버가 그 채팅의 모드 · 허용 목록으로 정한다(`side_chat::perm`).

/// 내장 도구 — 읽기 셋 + 웹 둘(`--tools`). 쓰기 · 명령 · Task · 대화형 도구는 아예 없다.
pub(crate) const TOOLS: &str = "Read,Grep,Glob,WebSearch,WebFetch";
/// 묻지 않고 쓰는 것 — cwd 안 읽기 · 웹 검색 · 페이지 읽기. cwd 밖 읽기만 카드로.
pub(crate) const ALLOWED: [&str; 3] = ["Read(./**)", "WebSearch", "WebFetch"];
/// 대화형 도구 — 막고, 그래도 오면 [`ASK_PLAINLY`] 로 거절.
pub(crate) const INTERACTIVE: [&str; 3] = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"];
pub(crate) const ASK_PLAINLY: &str = "평문으로 물어 주세요";
/// 사람이 거절하며 글을 남기지 않았을 때 모델에게 가는 문장.
pub(crate) const DENIED: &str = "사용자가 거절했습니다";

/// 인자 재료 — 파일 경로는 서버가 채팅 자리에 쓴 것(본문 [`SETTINGS_JSON`] · [`MCP_CONFIG_EMPTY`] · 지침).
pub(crate) struct Opts<'a> {
    pub exe: &'a str,
    pub mode: Mode<'a>,
    /// 새 대화 · 갈라 온 대화의 id(`--session-id`) — 이어 가기에는 쓰지 않는다.
    pub session_id: &'a str,
    pub model: &'a str,
    pub effort: Option<&'a str>,
    pub settings_file: &'a str,
    pub mcp_config_file: &'a str,
    /// 지침 파일(`--append-system-prompt-file`).
    pub append_file: Option<&'a str>,
    /// 묻지 않고 부르는 Aynx MCP 도구(`--allowedTools` 에 더한다).
    pub mcp_allowed: &'a [String],
}

/// 셸 없음 · 사용자 추가 인자 없음. 이어 가기에 `--session-id` 를 함께 주면 시작 오류다 · 갈라 오기는 `--resume <원본> --fork-session --session-id <새 id>`(새 id 가 그대로 선다).
pub(crate) fn argv(o: &Opts<'_>) -> Result<Vec<String>, &'static str> {
    if !model_ok(o.model) || o.effort.is_some_and(|e| !word_ok(e)) {
        return Err("bad-model");
    }
    let conv_ok = match o.mode {
        Mode::Fresh => uuid_ok(o.session_id),
        Mode::Resume { conv } => uuid_ok(conv),
        Mode::Fork { from } => uuid_ok(from) && uuid_ok(o.session_id) && from != o.session_id,
    };
    if !conv_ok {
        return Err("bad-conversation");
    }
    let mut a: Vec<String> = [
        o.exe,
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        "--setting-sources",
        "",
        "--settings",
        o.settings_file,
        "--strict-mcp-config",
        "--mcp-config",
        o.mcp_config_file,
        "--tools",
        TOOLS,
        "--allowedTools",
        ALLOWED[0],
        ALLOWED[1],
        ALLOWED[2],
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.extend(o.mcp_allowed.iter().cloned());
    a.push("--disallowedTools".into());
    a.push(INTERACTIVE.join(","));
    if let Some(f) = o.append_file {
        a.extend(["--append-system-prompt-file".into(), f.into()]);
    }
    // 빈 값 = CLI 기본(`--model` 을 싣지 않는다 — `event::model_ok`)
    if !o.model.is_empty() {
        a.extend(["--model".into(), o.model.into()]);
    }
    if let Some(e) = o.effort {
        a.extend(["--effort".into(), e.into()]);
    }
    match o.mode {
        Mode::Fresh => a.extend(["--session-id".into(), o.session_id.into()]),
        Mode::Resume { conv } => a.extend(["--resume".into(), conv.into()]),
        Mode::Fork { from } => {
            a.extend(["--resume".into(), from.into(), "--fork-session".into(), "--session-id".into(), o.session_id.into()])
        }
    }
    Ok(a)
}

/// 채팅 타일 인자 재료 — 제한 인자 없음(사용자 설정 · 훅 · MCP · 도구를 그대로 쓴다).
pub(crate) struct TileOpts<'a> {
    pub exe: &'a str,
    /// Fresh | Resume 만 — Fork 는 Err("bad-conversation").
    pub mode: Mode<'a>,
    /// Fresh 의 `--session-id` (uuid) — Resume 에서는 보지 않는다.
    pub session_id: &'a str,
    pub model: &'a str,
    pub effort: Option<&'a str>,
    /// 서버가 임시 자리에 쓴 `--mcp-config` 파일 — 늘 싣는다.
    pub mcp_config_file: &'a str,
    /// 사람이 그 타일 칩에서 고른 모드 — 서버가 다시 띄울 때만 `Some`(그 밖은 사용자 CLI 설정 그대로).
    pub perm_mode: Option<&'a str>,
    /// 채팅의 cwd — 늘 허용의 폴더 제안에서 cwd 자신을 빼고 되감기 파일 경로를 줄이는 데만 쓴다.
    pub cwd: &'a str,
    /// 서버가 체크포인트 환경을 실어 띄운다 — 거짓이면 파일 되감기를 알리지 않는다.
    pub checkpoints: bool,
}

/// 채팅 타일이 대화형 도구 · 모르는 요청을 거절할 때 모델에게 가는 글(Codex 어댑터도 같은 글을 쓴다).
pub(crate) const TILE_USE_TERMINAL: &str =
    "This request needs the terminal form of the Aynx AI tile. Ask in plain text instead, or tell the person to reopen this conversation as a terminal tile.";

/// 채팅 타일 칩이 낼 수 있는 모드 — **`bypassPermissions` · `dontAsk` 는 들지 않는다**(인자 · 줄 · 고를 수 있는 값 모두).
pub(crate) const TILE_MODES: [&str; 4] = ["default", "acceptEdits", "plan", "auto"];
/// `auto` 는 지금 모델이 받을 때만 더한다.
const TILE_CHOICES: [&str; 3] = ["default", "acceptEdits", "plan"];

/// 계획 카드의 [계속 계획] 에 사람이 글을 남기지 않았을 때 모델에게 가는 문장.
pub(crate) const PLAN_KEEP: &str = "The person chose to keep planning. Stay in plan mode and revise the plan; do not start making changes.";

/// 채팅 타일 — 사람이 거절하며 남긴 글 앞에 붙는 고정 머리. 이 머리가 없으면 모델이 사람 말을 도구 오류로 여긴다. 사람 글은 그대로 뒤에 붙는다.
pub(crate) const TILE_DECLINED_SAID: &str = "The user declined this request and said the following:\n\n";

/// 제한 인자(`--setting-sources` · `--tools` · `--allowedTools` …)를 싣지 않는다 — 미리 허용이 생기면 카드 없이 실행된다.
/// `--permission-mode` 는 사람이 그 타일에서 고른 값([`TILE_MODES`])일 때만.
pub(crate) fn tile_argv(o: &TileOpts<'_>) -> Result<Vec<String>, &'static str> {
    if !model_ok(o.model) || o.effort.is_some_and(|e| !word_ok(e)) {
        return Err("bad-model");
    }
    let conv_ok = match o.mode {
        Mode::Fresh => uuid_ok(o.session_id),
        Mode::Resume { conv } => uuid_ok(conv),
        Mode::Fork { .. } => false,
    };
    if !conv_ok {
        return Err("bad-conversation");
    }
    if o.perm_mode.is_some_and(|m| !TILE_MODES.contains(&m)) {
        return Err("bad-mode");
    }
    let mut a: Vec<String> = [
        o.exe,
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        "--mcp-config",
        o.mcp_config_file,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if !o.model.is_empty() {
        a.extend(["--model".into(), o.model.into()]);
    }
    if let Some(e) = o.effort {
        a.extend(["--effort".into(), e.into()]);
    }
    if let Some(m) = o.perm_mode {
        a.extend(["--permission-mode".into(), m.into()]);
    }
    match o.mode {
        Mode::Resume { conv } => a.extend(["--resume".into(), conv.into()]),
        Mode::Fresh | Mode::Fork { .. } => a.extend(["--session-id".into(), o.session_id.into()]),
    }
    Ok(a)
}

/// 프로듀서 채팅의 내장 도구 — 읽기 셋뿐(웹 · 쓰기 · 명령 없음).
pub(crate) const PRODUCER_TOOLS: &str = "Read,Grep,Glob";

/// [`argv`] 에서 내장 도구를 [`PRODUCER_TOOLS`] 로 바꾸고 웹 미리 허용을 뺀다. 설정 출처 통제 · 훅 끔 · `--strict-mcp-config` · 대화형 도구 막기는 그대로다
/// (실측 — 사용자 · 프로젝트 설정의 허용 규칙 · 훅 · MCP 가 새지 않는다).
pub(crate) fn producer_argv(o: &Opts<'_>) -> Result<Vec<String>, &'static str> {
    let mut a = argv(o)?;
    if let Some(i) = a.iter().position(|x| x == "--tools") {
        a[i + 1] = PRODUCER_TOOLS.to_string();
    }
    a.retain(|x| x != ALLOWED[1] && x != ALLOWED[2]);
    Ok(a)
}

fn tool_summary(name: &str, input: &Value) -> String {
    let key = match name {
        "Read" | "Write" | "Edit" | "NotebookEdit" => "file_path",
        "Bash" | "PowerShell" => "command",
        "Grep" | "Glob" => "pattern",
        "WebSearch" => "query",
        "WebFetch" => "url",
        n if n.starts_with("mcp__") => return mcp_summary(input),
        _ => "",
    };
    input.get(key).and_then(Value::as_str).map(one_line).unwrap_or_default()
}

fn result_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

/// 기다리는 `can_use_tool` 하나 — 허용할 때 `updatedInput` 으로 원래 입력을 그대로 돌려준다.
struct Pending {
    input: Value,
    tool: String,
    /// [이 대화에서 늘 허용] 이 실을 제안(목적지 `session` 으로 고친 것) — 채팅 타일만.
    session: Option<Value>,
}

/// 늘 허용 제안 하나를 고른다 — 순서 ① `addRules`(`behavior:"allow"`) ② `setMode acceptEdits` ③ `addDirectories`(cwd 자신은 뺀다 · 효과가 없다).
/// 고른 것은 **목적지를 `session` 으로 고친 사본**이다(터미널 모양의 `tile_permission::session_suggestions` 와 같은 판정) — 그 밖의 모드 제안 · 모르는 종류는 버린다.
pub(crate) fn session_pick(suggestions: &Value, cwd: &str) -> Option<(SessionAllow, Value)> {
    let list = suggestions.as_array()?;
    let of = |ty: &'static str| list.iter().filter_map(Value::as_object).filter(move |o| o.get("type").and_then(Value::as_str) == Some(ty));
    let to_session = |o: &Map<String, Value>| {
        let mut o = o.clone();
        o.insert("destination".into(), json!("session"));
        o
    };
    for o in of("addRules").filter(|o| o.get("behavior").and_then(Value::as_str) == Some("allow")) {
        let Some(rules) = o.get("rules").and_then(Value::as_array).filter(|r| !r.is_empty()) else { continue };
        let names: Vec<&str> = rules
            .iter()
            .filter_map(|r| r["ruleContent"].as_str().filter(|s| !s.trim().is_empty()).or_else(|| r["toolName"].as_str()))
            .collect();
        if names.len() != rules.len() {
            continue;
        }
        return Some((SessionAllow { kind: "rules", detail: one_line(&names.join(", ")) }, Value::Object(to_session(o))));
    }
    if let Some(o) = of("setMode").find(|o| o.get("mode").and_then(Value::as_str) == Some("acceptEdits")) {
        return Some((SessionAllow { kind: "mode", detail: "acceptEdits".into() }, Value::Object(to_session(o))));
    }
    for o in of("addDirectories") {
        let dirs: Vec<&str> = o
            .get("directories")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|d| !d.trim().is_empty() && !same_dir(d, cwd))
            .collect();
        if dirs.is_empty() {
            continue;
        }
        let mut s = to_session(o);
        s.insert("directories".into(), json!(dirs));
        return Some((SessionAllow { kind: "dirs", detail: one_line(&dirs.join(", ")) }, Value::Object(s)));
    }
    None
}

/// Windows 경로 — 구분자 · 끝 구분자 · 대소문자를 가리지 않는다.
fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    !b.is_empty() && norm(a) == norm(b)
}

/// `AskUserQuestion` 입력 — 1~8 개의 `{question: string}`.
fn questions_ok(input: &Value) -> bool {
    input["questions"].as_array().is_some_and(|q| (1..=8).contains(&q.len()) && q.iter().all(|x| x["question"].is_string()))
}

pub(crate) struct Claude {
    model: String,
    conversation: String,
    seq: u64,
    controls: BTreeMap<String, Control>,
    efforts: BTreeMap<String, Vec<String>>,
    pending: BTreeMap<String, Pending>,
    /// 보냈지만 아직 턴이 시작되지 않은 글의 `clientId` — CLI 는 글 하나에 턴 하나.
    queued: VecDeque<Option<String>>,
    in_turn: bool,
    ready: bool,
    dropped: Dropped,
    /// 채팅 타일 — 대화형 도구 · 권한 카드의 `input` · 늘 허용 · 권한 모드가 다르다.
    tile: bool,
    cwd: String,
    /// 채팅 타일 — CLI 가 알린 지금 권한 모드 · 마지막으로 낸 `(모드, 고를 수 있는 값)`.
    mode: Option<String>,
    mode_sent: Option<(String, Vec<String>)>,
    /// `initialize` 의 `models[]` 가운데 `supportsAutoMode` 가 참인 `value` · `resolvedModel`.
    auto_values: BTreeSet<String>,
    auto_resolved: BTreeSet<String>,
    /// `system/init.model` — 턴이 선 뒤의 지금 모델(`resolvedModel` 꼴).
    resolved: Option<String>,
    /// 채팅 타일 — `/` 메뉴 목록(`initialize` 순서) · 터미널 전용 이름 · 마지막으로 낸 것.
    commands: Vec<SlashCommand>,
    cmd_terminal: Vec<String>,
    cmd_sent: Option<(Vec<SlashCommand>, Vec<String>)>,
    /// 채팅 타일 — 마지막으로 낸 맥락 사용량 · 알려진 최대치 · 이 턴 마지막 모델 줄의 입력 합(`iterations` 가 없을 때).
    ctx_sent: Option<(u64, Option<u64>, &'static str)>,
    window: Option<u64>,
    last_usage: Option<u64>,
    /// 압축 op 가 보낸 `/compact` 가 아직 턴을 열지 않았다.
    compact_op: bool,
    /// `compact_boundary` 뒤 ~ `result` — 이 사이의 `<synthetic>` 줄은 앞선 출력의 재생이다.
    after_boundary: bool,
    /// 마지막 `compact_boundary` 의 `preserved_messages.uuids`.
    preserved: BTreeSet<String>,
    /// 압축 시작 ~ 그 결과(상태 줄 · 경계) — 이 사이에 보낸 끊기는 압축을 멈춘다.
    compacting: bool,
    /// 압축 중 끊기를 보냈다 — 뒤따르는 실패는 사람이 멈춘 것이다.
    compact_stop: bool,
    /// 압축 실패 ~ `result` — 이 사이의 `<synthetic>` 글은 실패 알림과 같은 말이다.
    compact_failed: bool,
    /// 채팅 타일 — 파일 체크포인트 환경으로 떴다 · 대화 되감기를 CLI 가 받는다(모르는 요청 답을 받으면 거짓).
    checkpoints: bool,
    conv_rewind: bool,
    /// 답을 기다리는 되감기 — 하나뿐.
    rewind_req: Option<RewindReq>,
    /// 채팅 타일 — `system/init` 에서 마지막으로 낸 MCP 상태.
    mcp_sent: Option<Vec<McpRow>>,
}

/// 고정 표 — 모르는 값은 "unknown" · "other".
fn claude_mcp_state(s: &str) -> &'static str {
    match s {
        "connected" => "connected",
        "pending" => "connecting",
        "needs-auth" => "needsAuth",
        "failed" => "failed",
        "disabled" => "disabled",
        _ => "unknown",
    }
}

fn claude_mcp_scope(s: &str) -> &'static str {
    match s {
        "user" => "user",
        "project" => "project",
        "local" => "local",
        "claudeai" => "cloud",
        "plugin" => "plugin",
        "sdk" | "dynamic" => "app",
        _ => "other",
    }
}

/// `mcp__<이름>__` 의 이름 조각 — `[A-Za-z0-9_-]` 밖은 `_`.
fn mcp_tool_prefix(name: &str) -> String {
    let norm: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    format!("mcp__{norm}__")
}

/// **허용 목록** — 줄마다 `name` · `status` · `source`(없으면 `scope`) · `tools` 만 연다(`config` · `error` · `serverInfo` 는 열지 않는다).
/// `tools` 는 그 줄의 배열 길이, 없으면 `init_tools`(`system/init.tools[]`)에서 `mcp__<정규화 이름>__` 으로 센다 — 하나도 없고 연결 전이면 None.
fn mcp_rows_claude(servers: &Value, init_tools: Option<&Value>) -> Vec<McpRow> {
    let mut out = Vec::new();
    for s in servers.as_array().into_iter().flatten() {
        let Some(name) = s["name"].as_str().and_then(mcp_row_name) else { continue };
        let raw = s["name"].as_str().unwrap_or("");
        let state = claude_mcp_state(s["status"].as_str().unwrap_or(""));
        let scope = claude_mcp_scope(s["source"].as_str().or(s["scope"].as_str()).unwrap_or(""));
        let tools = match (s["tools"].as_array(), init_tools.and_then(Value::as_array)) {
            (Some(t), _) => Some(t.len() as u32),
            (None, Some(all)) => {
                let prefix = mcp_tool_prefix(raw);
                let n = all.iter().filter_map(Value::as_str).filter(|t| t.starts_with(&prefix)).count() as u32;
                (n > 0 || state == "connected").then_some(n)
            }
            (None, None) => None,
        };
        push_mcp_row(&mut out, McpRow { name, state, auth: None, tools, scope });
    }
    out
}

/// 사람이 부른 되감기 하나. `files_done` = `both` 실행에서 파일 쪽이 끝났다(그 `skippedLinks`).
struct RewindReq {
    anchor: String,
    scope: &'static str,
    dry: bool,
    last_seen: Option<String>,
    files_done: Option<Option<u64>>,
}

/// cwd 안이면 cwd 뒤를 `/` 로(구분자 · 대소문자 무시) · 밖이면 받은 그대로 · 바이트 상한.
fn rewind_rel(cwd: &str, path: &str) -> String {
    let p = path.replace('\\', "/");
    let c = cwd.replace('\\', "/");
    let c = c.trim_end_matches('/');
    let inside = (!c.is_empty())
        .then(|| p.get(..c.len()).filter(|h| h.eq_ignore_ascii_case(c)).and_then(|_| p.get(c.len()..)))
        .flatten()
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|rest| !rest.is_empty());
    clip(inside.unwrap_or(path), REWIND_PATH_BYTES).0
}

/// `filesChanged` — 앞 [`REWIND_FILES_MAX`] 개 + 넘은 수.
fn rewind_files(cwd: &str, v: &Value) -> (Vec<String>, u32) {
    let all: Vec<&str> = v.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let more = all.len().saturating_sub(REWIND_FILES_MAX) as u32;
    (all.iter().take(REWIND_FILES_MAX).map(|p| rewind_rel(cwd, p)).collect(), more)
}

/// `preserved_messages.uuids` 상한.
const PRESERVED_MAX: usize = 512;

fn usage_sum(u: &Value) -> u64 {
    ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].iter().map(|k| u[*k].as_u64().unwrap_or(0)).sum()
}

/// `initialize` 답의 `commands[]` — 칸이 없으면(옛 CLI) `None`.
fn initialize_commands(body: &Value) -> Option<Vec<SlashCommand>> {
    let mut out: Vec<SlashCommand> = Vec::new();
    for c in body["commands"].as_array()? {
        let Some(name) = c["name"].as_str().filter(|n| slash_name_ok(n)) else { continue };
        if out.len() >= COMMANDS_MAX || out.iter().any(|x| x.name == name) {
            continue;
        }
        out.push(SlashCommand {
            name: name.to_string(),
            description: slash_desc(c["description"].as_str().unwrap_or("")),
            hint: clip(&one_line(c["argumentHint"].as_str().unwrap_or("")), HINT_BYTES).0,
            kind: if c["builtin"] == true { "builtin" } else { "command" },
            aliases: c["aliases"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|a| slash_name_ok(a)).take(ALIASES_MAX).map(str::to_string).collect(),
        });
    }
    Some(out)
}

enum Control {
    Initialize,
    SetModel(String),
    SetEffort(Option<String>),
    SetMode(String),
    Interrupt,
    /// 몸은 `rewind_req` 가 쥔다.
    RewindFiles,
    RewindConversation,
    /// 사람이 연 MCP 상태 풍선 — 답 몸은 [`mcp_rows_claude`] 만 읽는다.
    McpStatus,
}

impl Claude {
    pub(crate) fn new(o: &Opts<'_>) -> Self {
        let conversation = match o.mode {
            Mode::Resume { conv } => conv,
            Mode::Fresh | Mode::Fork { .. } => o.session_id,
        };
        Claude {
            model: o.model.to_string(),
            conversation: conversation.to_string(),
            seq: 0,
            controls: BTreeMap::new(),
            efforts: BTreeMap::new(),
            pending: BTreeMap::new(),
            queued: VecDeque::new(),
            in_turn: false,
            ready: false,
            dropped: Dropped::default(),
            tile: false,
            cwd: String::new(),
            mode: None,
            mode_sent: None,
            auto_values: BTreeSet::new(),
            auto_resolved: BTreeSet::new(),
            resolved: None,
            commands: Vec::new(),
            cmd_terminal: Vec::new(),
            cmd_sent: None,
            ctx_sent: None,
            window: None,
            last_usage: None,
            compact_op: false,
            after_boundary: false,
            preserved: BTreeSet::new(),
            compacting: false,
            compact_stop: false,
            compact_failed: false,
            checkpoints: false,
            conv_rewind: false,
            rewind_req: None,
            mcp_sent: None,
        }
    }

    pub(crate) fn tile(o: &TileOpts<'_>) -> Self {
        let base = Opts {
            exe: o.exe,
            mode: o.mode,
            session_id: o.session_id,
            model: o.model,
            effort: o.effort,
            settings_file: "",
            mcp_config_file: o.mcp_config_file,
            append_file: None,
            mcp_allowed: &[],
        };
        Claude { tile: true, cwd: o.cwd.to_string(), checkpoints: o.checkpoints, conv_rewind: true, ..Claude::new(&base) }
    }

    fn caps_ev(&self) -> Ev {
        Ev::RewindCaps { files: self.checkpoints, conversation: self.conv_rewind }
    }

    fn rewind_conversation_line(&mut self, anchor: &str, last_seen: &str) -> String {
        let request = json!({"subtype": "rewind_conversation", "target_message_uuid": anchor, "last_seen_user_message_uuid": last_seen});
        self.control(Control::RewindConversation, request)
    }

    /// `rewind_files` 의 답. `both` 실행의 파일 쪽이 성공하면 대화 요청을 이어 보낸다(같은 사람 op 의 몸).
    fn on_rewind_files(&mut self, ok: bool, r: &Value) -> Step {
        let Some(mut req) = self.rewind_req.take() else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let body = &r["response"];
        let cli_err = || {
            let e = if ok { body["error"].as_str() } else { r["error"].as_str() };
            Some(rewind_error(e.unwrap_or("rewind failed")))
        };
        let can = ok && body["canRewind"] == true && body["error"].is_null();
        let (anchor, scope) = (req.anchor.clone(), req.scope);
        if req.dry {
            let m = if can {
                let (files, more_files) = rewind_files(&self.cwd, &body["filesChanged"]);
                RewindMore { files, more_files, insertions: body["insertions"].as_u64(), deletions: body["deletions"].as_u64(), ..Default::default() }
            } else {
                RewindMore { error: cli_err(), ..Default::default() }
            };
            return Step::ev(rewind_ev(RewindPhase::Preview, &anchor, scope, can, m));
        }
        if !can {
            return Step::ev(rewind_ev(RewindPhase::Failed, &anchor, scope, false, RewindMore { error: cli_err(), ..Default::default() }));
        }
        let skipped = body["skippedLinks"].as_u64();
        match (scope, req.last_seen.clone()) {
            ("both", Some(seen)) => {
                req.files_done = Some(skipped);
                let line = self.rewind_conversation_line(&anchor, &seen);
                self.rewind_req = Some(req);
                Step::line(line)
            }
            // `encode_rewind` 가 `both` 실행에는 늘 `last_seen` 을 받는다 — 없으면 파일만 되돌린 것이다
            (s, _) => {
                let done = if s == "both" { "files" } else { s };
                Step::ev(rewind_ev(RewindPhase::Done, &anchor, done, true, RewindMore { skipped_links: skipped, ..Default::default() }))
            }
        }
    }

    /// `rewind_conversation` 의 답 — 거절은 `success{rewound:false, reason}` · `error` 답은 이 CLI 가 그 요청을 모른다.
    fn on_rewind_conversation(&mut self, ok: bool, r: &Value) -> Step {
        let Some(req) = self.rewind_req.take() else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let body = &r["response"];
        let mut evs = Vec::new();
        // `both` 의 파일 쪽은 이미 되돌렸다 — 대화 쪽 결과와 따로 알린다
        let files_done = req.files_done;
        let fail_scope = if files_done.is_some() { "conversation" } else { req.scope };
        if ok && body["rewound"] == true {
            let m = RewindMore { skipped_links: files_done.flatten(), ..Default::default() };
            return Step::ev(rewind_ev(RewindPhase::Done, &req.anchor, req.scope, true, m));
        }
        if let Some(skipped) = files_done {
            evs.push(rewind_ev(RewindPhase::Done, &req.anchor, "files", true, RewindMore { skipped_links: skipped, ..Default::default() }));
        }
        let error = if ok {
            rewind_error(body["reason"].as_str().or(body["error"].as_str()).unwrap_or("rewind failed"))
        } else {
            self.conv_rewind = false;
            "unsupported".to_string()
        };
        evs.push(rewind_ev(RewindPhase::Failed, &req.anchor, fail_scope, false, RewindMore { error: Some(error), ..Default::default() }));
        if !ok {
            evs.push(self.caps_ev());
        }
        Step { evs, stdin: Vec::new() }
    }

    fn auto_ok(&self) -> bool {
        if self.mode.as_deref() == Some("auto") {
            return true;
        }
        match &self.resolved {
            Some(r) => self.auto_resolved.contains(r),
            None => {
                let v = if self.model.is_empty() { "default" } else { self.model.as_str() };
                self.auto_values.contains(v) || self.auto_resolved.contains(v)
            }
        }
    }

    fn choices(&self) -> Vec<String> {
        let mut c: Vec<String> = TILE_CHOICES.iter().map(|s| s.to_string()).collect();
        if self.auto_ok() {
            c.push("auto".into());
        }
        c
    }

    fn note_mode(&mut self, m: Option<&str>) {
        if let Some(m) = m.filter(|m| word_ok(m)) {
            self.mode = Some(m.to_string());
        }
    }

    /// 채팅 타일만 · 바뀌었을 때만.
    fn mode_ev(&mut self) -> Option<Ev> {
        if !self.tile {
            return None;
        }
        let now = (self.mode.clone()?, self.choices());
        if self.mode_sent.as_ref() == Some(&now) {
            return None;
        }
        self.mode_sent = Some(now.clone());
        Some(Ev::CliMode { mode: now.0, choices: now.1, chosen: None })
    }

    /// 채팅 타일만 · 바뀌었을 때만.
    fn commands_ev(&mut self) -> Option<Ev> {
        if !self.tile {
            return None;
        }
        let now = (self.commands.clone(), self.cmd_terminal.clone());
        if self.cmd_sent.as_ref() == Some(&now) {
            return None;
        }
        self.cmd_sent = Some(now.clone());
        Some(commands_ev(now.0, now.1))
    }

    /// `system/init` 의 이름 목록에 맞춘다 — 별칭으로 알린 이름도 같은 줄이다(`initialize` 의 `docs` ↔ init 의 `anthropic-skills:docs`).
    fn align_commands(&mut self, v: &Value) -> Option<Ev> {
        let strs = |k: &str| -> Vec<String> {
            v[k].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|n| slash_name_ok(n)).map(str::to_string).collect()
        };
        if !v["slash_commands"].is_array() {
            return None;
        }
        let names = strs("slash_commands");
        let skills: BTreeSet<String> = strs("skills").into_iter().collect();
        let has = |c: &SlashCommand, set: &dyn Fn(&str) -> bool| set(&c.name) || c.aliases.iter().any(|a| set(a));
        self.commands.retain(|c| has(c, &|n| names.iter().any(|x| x == n)));
        for n in &names {
            if self.commands.len() < COMMANDS_MAX && !self.commands.iter().any(|c| c.name == *n || c.aliases.contains(n)) {
                self.commands.push(SlashCommand { name: n.clone(), description: String::new(), hint: String::new(), kind: "command", aliases: Vec::new() });
            }
        }
        for c in self.commands.iter_mut().filter(|c| c.kind != "builtin") {
            c.kind = if has(c, &|n| skills.contains(n)) { "skill" } else { "command" };
        }
        if v["terminal_slash_commands"].is_array() {
            self.cmd_terminal = strs("terminal_slash_commands");
            self.cmd_terminal.truncate(COMMANDS_MAX);
        }
        self.commands_ev()
    }

    /// 채팅 타일만 · 칸이 없으면 아무것도 · 바뀌었을 때만.
    fn init_mcp_ev(&mut self, v: &Value) -> Option<Ev> {
        if !self.tile || !v["mcp_servers"].is_array() {
            return None;
        }
        let rows = mcp_rows_claude(&v["mcp_servers"], Some(&v["tools"]));
        if self.mcp_sent.as_ref() == Some(&rows) {
            return None;
        }
        self.mcp_sent = Some(rows.clone());
        Some(Ev::McpStatus { servers: rows, source: "init" })
    }

    /// 채팅 타일만 · 같은 값 · 같은 출처면 내지 않는다(`/context` 는 턴 값과 같은 수라 출처가 달라야 알린다).
    fn context_ev(&mut self, used: u64, window: Option<u64>, source: &'static str) -> Option<Ev> {
        if !self.tile || self.ctx_sent == Some((used, window, source)) {
            return None;
        }
        self.ctx_sent = Some((used, window, source));
        Some(Ev::ContextUsage { used, window, source })
    }

    /// 압축 뒤 — 마지막으로 낸 값(없으면 압축 전 크기)을 `preCompact` 로 다시 알린다. 다음 턴의 값은 같은 수여도 낸다.
    fn pre_compact_ev(&mut self, pre: Option<u64>) -> Option<Ev> {
        if !self.tile {
            return None;
        }
        let (used, window) = match self.ctx_sent.take() {
            Some((u, w, _)) => (u, w.or(self.window)),
            None => (pre.filter(|p| *p > 0)?, self.window),
        };
        Some(Ev::ContextUsage { used, window, source: "preCompact" })
    }

    /// 턴 끝의 맥락 크기 — `usage.iterations` 의 마지막 원소(그 턴 마지막 API 호출)의 입력 합. 최상위 `usage` 는 턴 안 누적이라 쓰지 않는다.
    /// 최대치는 `modelUsage[지금 모델].contextWindow`(토큰 칸은 세션 누적이라 쓰지 않는다).
    fn turn_usage(&mut self, v: &Value, emit: bool) -> Option<Ev> {
        let used = match v["usage"]["iterations"].as_array().and_then(|a| a.last()) {
            Some(it) => usage_sum(it),
            None => self.last_usage.unwrap_or(0),
        };
        let mu = v["modelUsage"].as_object();
        let picked = mu.and_then(|m| match self.resolved.as_deref().and_then(|r| m.get(r)) {
            Some(x) => Some(x),
            None if m.len() == 1 => m.values().next(),
            None => None,
        });
        if let Some(w) = picked.and_then(|x| x["contextWindow"].as_u64()) {
            self.window = Some(w);
        }
        if used == 0 || !emit {
            return None;
        }
        self.context_ev(used, self.window, "turn")
    }

    /// 압축이 턴을 연다 — 사람이 친 `/compact` 는 그 말풍선(`queued`)과, 압축 op 의 줄은 말풍선 없이.
    fn open_compact_turn(&mut self, evs: &mut Vec<Ev>) {
        let op = std::mem::take(&mut self.compact_op);
        if !self.in_turn {
            self.in_turn = true;
            self.last_usage = None;
            evs.push(Ev::TurnStarted { turn: None });
            if !op {
                evs.push(Ev::UserAccepted { client_id: self.queued.pop_front().flatten(), text: None, files: Vec::new() });
            }
        }
        self.compacting = true;
        evs.push(Ev::Compaction { phase: CompactPhase::Started, trigger: op.then(|| "manual".to_string()), pre_tokens: None, post_tokens: None });
    }

    /// 채팅 타일의 `system` 줄 가운데 `init` 밖 — 상태(모드 · 압축) · 압축 경계. 그 밖은 버린다.
    fn tile_system(&mut self, v: &Value) -> Step {
        let mut evs = Vec::new();
        match v["subtype"].as_str().unwrap_or("") {
            "status" => {
                if v["status"] == "compacting" {
                    self.open_compact_turn(&mut evs);
                }
                // 실패는 이 칸으로만 안다 — 그 턴의 `result.is_error` 는 늘 거짓이다
                if let Some(r) = v["compact_result"].as_str() {
                    self.compacting = false;
                    if r != "success" {
                        self.compact_failed = true;
                        // 사람이 [중지] 한 압축도 CLI 는 "Request was aborted" 실패로 알린다
                        if std::mem::take(&mut self.compact_stop) {
                            evs.push(Ev::Notice { code: "compact-canceled", detail: None });
                        } else {
                            let detail = v["compact_error"].as_str().unwrap_or(r);
                            evs.push(Ev::Notice { code: "compact-failed", detail: Some(one_line(detail)) });
                        }
                    }
                }
                self.note_mode(v["permissionMode"].as_str());
                evs.extend(self.mode_ev());
            }
            "compact_boundary" => {
                let m = &v["compact_metadata"];
                self.after_boundary = true;
                self.preserved = m["preserved_messages"]["uuids"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .take(PRESERVED_MAX)
                    .map(str::to_string)
                    .collect();
                self.compacting = false;
                self.compact_stop = false;
                let pre = m["pre_tokens"].as_u64();
                evs.push(Ev::Compaction { phase: CompactPhase::Done, trigger: str_of(&m["trigger"]), pre_tokens: pre, post_tokens: m["post_tokens"].as_u64() });
                evs.extend(self.pre_compact_ev(pre));
            }
            _ => {}
        }
        Step { evs, stdin: Vec::new() }
    }

    fn control(&mut self, what: Control, request: Value) -> String {
        self.seq += 1;
        let id = format!("r{}", self.seq);
        self.controls.insert(id.clone(), what);
        json!({"type": "control_request", "request_id": id, "request": request}).to_string()
    }

    fn on_control_response(&mut self, v: &Value) -> Step {
        let r = &v["response"];
        let Some(id) = r["request_id"].as_str() else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let ok = r["subtype"] == "success";
        let err = || r["error"].as_str().map(one_line);
        match self.controls.remove(id) {
            Some(Control::Initialize) if ok => {
                self.ready = true;
                let body = &r["response"];
                let version = str_of(&body["claude_code_version"]);
                let models: Vec<String> = body["models"]
                    .as_array()
                    .map(|ms| ms.iter().filter_map(|m| m["value"].as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                self.efforts = initialize_efforts(body);
                let mut evs = vec![Ev::Ready {
                    cli: Cli::Claude,
                    version: version.clone(),
                    model: (!self.model.is_empty()).then(|| self.model.clone()),
                    models,
                    efforts: self.efforts.clone(),
                    conversation_id: Some(self.conversation.clone()),
                }];
                if self.tile {
                    for m in body["models"].as_array().into_iter().flatten().filter(|m| m["supportsAutoMode"] == true) {
                        self.auto_values.extend(str_of(&m["value"]));
                        self.auto_resolved.extend(str_of(&m["resolvedModel"]));
                    }
                    self.note_mode(body["current_permission_mode"].as_str());
                    evs.extend(self.mode_ev());
                    if let Some(list) = initialize_commands(body) {
                        self.commands = list;
                        evs.extend(self.commands_ev());
                    }
                    evs.push(self.caps_ev());
                }
                if !tested(version.as_deref()) {
                    evs.push(Ev::Notice { code: "untested-version", detail: version });
                }
                Step { evs, stdin: Vec::new() }
            }
            Some(Control::Initialize) => Step {
                evs: vec![
                    Ev::Notice { code: "handshake-failed", detail: err() },
                    Ev::Exited { code: None, reason: "protocol" },
                ],
                stdin: Vec::new(),
            },
            Some(Control::SetModel(alias)) if ok => {
                self.model = alias.clone();
                // 다음 `system/init` 이 알릴 때까지 지금 모델은 이 별칭이다 — `auto` 를 받는지가 바뀔 수 있다
                self.resolved = None;
                let model = str_of(&r["response"]["model"]).unwrap_or(alias);
                let mut evs = vec![Ev::ModelChanged { model }];
                evs.extend(self.mode_ev());
                Step { evs, stdin: Vec::new() }
            }
            Some(Control::SetModel(_)) => Step::ev(Ev::Notice { code: "set-model-failed", detail: err() }),
            Some(Control::SetEffort(effort)) if ok => Step::ev(Ev::EffortChanged { effort }),
            Some(Control::SetEffort(_)) => Step::ev(Ev::Notice { code: "set-effort-failed", detail: err() }),
            Some(Control::SetMode(sent)) if ok => {
                let mode = str_of(&r["response"]["mode"]).unwrap_or(sent);
                self.note_mode(Some(&mode));
                Step { evs: self.mode_ev().into_iter().collect(), stdin: Vec::new() }
            }
            Some(Control::SetMode(_)) => Step::ev(Ev::Notice { code: "set-mode-failed", detail: err() }),
            Some(Control::Interrupt) if ok => Step::default(),
            Some(Control::Interrupt) => Step::ev(Ev::Notice { code: "interrupt-failed", detail: err() }),
            Some(Control::RewindFiles) => self.on_rewind_files(ok, r),
            Some(Control::RewindConversation) => self.on_rewind_conversation(ok, r),
            // 사람이 물었다 — 같아도 낸다. 실패 글은 싣지 않는다(답 몸에 설정 값이 있다)
            Some(Control::McpStatus) if ok && r["response"]["mcpServers"].is_array() => {
                Step::ev(Ev::McpStatus { servers: mcp_rows_claude(&r["response"]["mcpServers"], None), source: "list" })
            }
            Some(Control::McpStatus) => Step::ev(Ev::Notice { code: "mcp-status-failed", detail: None }),
            None => {
                self.dropped.unknown += 1;
                Step::default()
            }
        }
    }

    fn on_control_request(&mut self, v: &Value) -> Step {
        let Some(id) = v["request_id"].as_str() else {
            self.dropped.unknown += 1;
            return Step::default();
        };
        let req = &v["request"];
        let subtype = req["subtype"].as_str().unwrap_or("");
        if subtype != "can_use_tool" {
            // 모르는 제어 요청 — 오류로 곧바로 답한다(CLI 가 영영 기다리지 않게).
            let who = if self.tile { "Aynx chat tile" } else { "Aynx side chat" };
            let line = json!({"type": "control_response", "response": {
                "subtype": "error", "request_id": id, "error": format!("{who} does not handle {subtype}")}});
            return Step {
                evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(one_line(subtype)) }],
                stdin: vec![line.to_string()],
            };
        }
        let tool = req["tool_name"].as_str().unwrap_or("").to_string();
        if INTERACTIVE.contains(&tool.as_str()) {
            if self.tile {
                if let Some(step) = self.tile_interactive(id, &tool, req) {
                    return step;
                }
                return Step {
                    evs: vec![Ev::Notice { code: "needs-terminal", detail: Some(one_line(&tool)) }],
                    stdin: vec![deny_line(id, TILE_USE_TERMINAL)],
                };
            }
            return Step {
                evs: vec![Ev::Notice { code: "asked-plainly", detail: Some(tool) }],
                stdin: vec![deny_line(id, ASK_PLAINLY)],
            };
        }
        let input = req["input"].clone();
        // 외부 MCP 도구 — `mcp_server{name}` 이 오고 `display_name` 은 도구의 사람 이름뿐이다(실측)
        let mcp = req["mcp_server"]["name"].as_str().and_then(|s| split_mcp_tool(&tool, Some(s)));
        let (kind, title, detail) = match mcp {
            Some((server, name)) => {
                let shown = serde_json::to_string_pretty(&input).unwrap_or_default();
                let detail = if input.as_object().is_some_and(|o| o.is_empty()) { String::new() } else { shown };
                (PermKind::McpTool, format!("{server} · {name}"), detail)
            }
            None => {
                let title = req["display_name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&tool).to_string();
                let detail = req["description"]
                    .as_str()
                    .map(str::to_string)
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| tool_summary(&tool, &input));
                (PermKind::Tool, title, detail)
            }
        };
        let picked = if self.tile { session_pick(&req["permission_suggestions"], &self.cwd) } else { None };
        let (session_allow, session) = picked.map_or((None, None), |(a, s)| (Some(a), Some(s)));
        let ev = Ev::Permission {
            request_id: id.to_string(),
            kind,
            title: one_line(&title),
            detail: cap(&detail),
            tool_name: tool.clone(),
            input: self.tile.then(|| tile_input(input.clone()).or_else(|| (tool == "Bash").then(|| clipped_bash(&input)))).flatten(),
            session_allow,
        };
        self.pending.insert(id.to_string(), Pending { input, tool, session });
        Step::ev(ev)
    }

    /// 채팅 타일의 계획 · 질문 카드 — 못 그리는 질문(꼴이 틀림 · 16 KiB 넘음)은 `None`(부르는 쪽이 터미널 안내로 거절한다).
    fn tile_interactive(&mut self, id: &str, tool: &str, req: &Value) -> Option<Step> {
        let input = req["input"].clone();
        let title = one_line(req["display_name"].as_str().filter(|s| !s.is_empty()).unwrap_or(tool));
        let (detail, shown) = match tool {
            "ExitPlanMode" => {
                let plan = input["plan"].as_str().unwrap_or("");
                // 계획이 상한을 넘으면 파일 경로만 — 카드는 잘린 `detail` 과 경로를 보인다
                let shown = tile_input(json!({"plan": input["plan"], "planFilePath": input["planFilePath"]}))
                    .or_else(|| tile_input(json!({"planFilePath": input["planFilePath"]})));
                (cap(plan), shown)
            }
            "AskUserQuestion" => {
                if !questions_ok(&input) {
                    return None;
                }
                let shown = Some(tile_input(input.clone())?);
                let qs: Vec<&str> = input["questions"].as_array().into_iter().flatten().filter_map(|q| q["question"].as_str()).collect();
                (cap(&qs.join("\n")), shown)
            }
            _ => {
                let d = req["description"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty()).unwrap_or_default();
                (cap(&d), tile_input(input.clone()))
            }
        };
        let ev = Ev::Permission {
            request_id: id.to_string(),
            kind: PermKind::Tool,
            title,
            detail,
            tool_name: tool.to_string(),
            input: shown,
            session_allow: None,
        };
        self.pending.insert(id.to_string(), Pending { input, tool: tool.to_string(), session: None });
        Some(Step::ev(ev))
    }

    fn resolve_all(&mut self, by: ResolvedBy) -> Vec<Ev> {
        std::mem::take(&mut self.pending)
            .into_keys()
            .map(|request_id| Ev::PermissionResolved { request_id, decision: None, by })
            .collect()
    }
}

/// 너무 큰 Bash 입력 — 카드가 설명만 보이지 않게 명령을 잘라 싣는다(`commandTruncated` · 이스케이프로 두 배가 돼도 상한 안).
fn clipped_bash(input: &Value) -> Value {
    let (command, _) = clip(input["command"].as_str().unwrap_or(""), 6 * 1024);
    let (description, _) = clip(input["description"].as_str().unwrap_or(""), 1024);
    json!({"command": command, "description": description, "commandTruncated": true})
}

/// `supportedEffortLevels` 가 없는 모델은 빈 목록(강도를 받지 않는다). 열쇠 `""` = `--model` 을 싣지 않았을 때의 CLI 기본 = 별칭 `default` 의 목록.
pub(crate) fn initialize_efforts(body: &Value) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    for m in body["models"].as_array().into_iter().flatten() {
        let Some(value) = m["value"].as_str().filter(|v| word_ok(v)) else { continue };
        let levels: Vec<String> = m["supportedEffortLevels"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|e| word_ok(e))
            .map(str::to_string)
            .collect();
        out.insert(value.to_string(), levels);
    }
    if let Some(d) = out.get("default").cloned() {
        out.insert(String::new(), d);
    }
    out
}

fn deny_line(id: &str, message: &str) -> String {
    json!({"type": "control_response", "response": {"subtype": "success", "request_id": id,
        "response": {"behavior": "deny", "message": message}}})
    .to_string()
}

impl Adapter for Claude {
    fn cli(&self) -> Cli {
        Cli::Claude
    }

    fn handshake(&mut self) -> Vec<String> {
        vec![self.control(Control::Initialize, json!({"subtype": "initialize"}))]
    }

    fn on_line(&mut self, line: &str) -> Step {
        let v: Value = match serde_json::from_str(line) {
            Ok(v @ Value::Object(_)) => v,
            _ => {
                self.dropped.bad += 1;
                return Step::default();
            }
        };
        // 하위 에이전트 줄은 대화창에 섞지 않는다.
        if v["parent_tool_use_id"].is_string() {
            return Step::default();
        }
        match v["type"].as_str().unwrap_or("") {
            "control_response" => self.on_control_response(&v),
            "control_request" => self.on_control_request(&v),
            "control_cancel_request" => {
                let id = v["request_id"].as_str().unwrap_or("");
                if self.pending.remove(id).is_some() {
                    Step::ev(Ev::PermissionResolved { request_id: id.to_string(), decision: None, by: ResolvedBy::Cli })
                } else {
                    self.dropped.unknown += 1;
                    Step::default()
                }
            }
            "system" => {
                // 채팅 타일만 — `status`(모드 · 압축) · `compact_boundary`. 사이드 채팅은 `init` 밖 줄을 버린다
                if self.tile && v["subtype"] != "init" {
                    return self.tile_system(&v);
                }
                if v["subtype"] != "init" {
                    return Step::default();
                }
                let mut evs = Vec::new();
                if self.compact_op {
                    // 상태 줄 없이 온 압축 — 말풍선 없이 연다
                    self.open_compact_turn(&mut evs);
                } else if !self.in_turn {
                    self.in_turn = true;
                    self.last_usage = None;
                    evs.push(Ev::TurnStarted { turn: None });
                    evs.push(Ev::UserAccepted { client_id: self.queued.pop_front().flatten(), text: None, files: Vec::new() });
                }
                if let Some(sid) = v["session_id"].as_str().filter(|s| *s != self.conversation) {
                    self.conversation = sid.to_string();
                    evs.push(Ev::Notice { code: "conversation-changed", detail: Some(sid.to_string()) });
                }
                if self.tile {
                    if let Some(m) = v["model"].as_str().filter(|m| word_ok(m)) {
                        self.resolved = Some(m.to_string());
                    }
                    self.note_mode(v["permissionMode"].as_str());
                    evs.extend(self.mode_ev());
                    evs.extend(self.align_commands(&v));
                    evs.extend(self.init_mcp_ev(&v));
                }
                Step { evs, stdin: Vec::new() }
            }
            "stream_event" => {
                let e = &v["event"];
                match (e["type"].as_str(), e["delta"]["type"].as_str(), e["delta"]["text"].as_str()) {
                    (Some("content_block_delta"), Some("text_delta"), Some(t)) if !t.is_empty() => {
                        Step::ev(Ev::TextDelta { item: None, text: t.to_string() })
                    }
                    _ => Step::default(),
                }
            }
            "assistant" => {
                let mut evs = Vec::new();
                if self.tile {
                    let m = &v["message"];
                    if m["model"] == "<synthetic>" {
                        // 압축 뒤 앞선 로컬 명령 출력의 재생 · 압축 실패 알림과 같은 글 — 줄째 버린다(세지 않는다)
                        if self.after_boundary || self.compact_failed || v["uuid"].as_str().is_some_and(|u| self.preserved.contains(u)) {
                            return Step::default();
                        }
                        let cu = &v["context_usage"];
                        if v["local_command_run"]["command"] == "context" {
                            if let Some(used) = cu["total_tokens"].as_u64() {
                                let window = cu["raw_max_tokens"].as_u64().or(self.window);
                                self.window = window;
                                evs.extend(self.context_ev(used, window, "command"));
                            }
                        }
                    } else if let Some(n) = Some(usage_sum(&m["usage"])).filter(|n| *n > 0) {
                        self.last_usage = Some(n);
                    }
                }
                for p in v["message"]["content"].as_array().into_iter().flatten() {
                    match p["type"].as_str().unwrap_or("") {
                        "text" => {
                            if let Some(t) = p["text"].as_str().filter(|t| !t.trim().is_empty()) {
                                evs.push(Ev::Text { item: None, text: t.to_string() });
                            }
                        }
                        "tool_use" => {
                            let name = p["name"].as_str().unwrap_or("").to_string();
                            let input = p["input"].clone();
                            let small = input.to_string().len() <= DETAIL_MAX;
                            evs.push(Ev::ToolStarted {
                                item: p["id"].as_str().unwrap_or("").to_string(),
                                summary: tool_summary(&name, &input),
                                name,
                                input: small.then_some(input),
                            });
                        }
                        _ => {}
                    }
                }
                Step { evs, stdin: Vec::new() }
            }
            "user" => {
                // 채팅 타일 — `/goal` 의 "Stop hook feedback" 같은 합성 줄은 사람 말이 아니다
                if self.tile && v["isSynthetic"] == true {
                    return Step::default();
                }
                // 도구 결과만 — 사용자 글 줄(끊김 표시 등)은 우리가 보낸 것의 메아리다.
                let evs = v["message"]["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|p| p["type"] == "tool_result")
                    .filter_map(|p| {
                        Some(Ev::ToolFinished {
                            item: p["tool_use_id"].as_str()?.to_string(),
                            ok: p["is_error"] != true,
                            output: Some(cap(&result_text(&p["content"]))),
                        })
                    })
                    .collect();
                Step { evs, stdin: Vec::new() }
            }
            "result" => {
                self.in_turn = false;
                // 도구 호출 중 끊기면 `aborted_tools`(`is_error:true`) — 이것도 끊김이다(실측).
                let outcome = if v["terminal_reason"] == "aborted_streaming" || v["terminal_reason"] == "aborted_tools" {
                    Outcome::Interrupted
                } else if v["is_error"] == true {
                    Outcome::Error
                } else {
                    Outcome::Ok
                };
                let message = (outcome == Outcome::Error).then(|| {
                    v["result"]
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .map(one_line)
                        .or_else(|| v["errors"][0].as_str().map(one_line))
                        .unwrap_or_else(|| one_line(v["subtype"].as_str().unwrap_or("error")))
                });
                let mut evs = self.resolve_all(ResolvedBy::Cli);
                if self.tile {
                    // 압축 턴의 수는 요약 호출의 것이다 — 미터는 다음 턴까지 `preCompact` 를 둔다
                    // 상태 줄 없이 끝난 압축 — 사람이 멈춘 것만 안다
                    if self.compacting && self.compact_stop {
                        evs.push(Ev::Notice { code: "compact-canceled", detail: None });
                    }
                    let compacted = self.after_boundary;
                    evs.extend(self.turn_usage(&v, !compacted));
                    self.after_boundary = false;
                    self.compact_op = false;
                    self.last_usage = None;
                    self.compacting = false;
                    self.compact_stop = false;
                    self.compact_failed = false;
                }
                evs.push(Ev::TurnEnded { turn: None, outcome, message });
                Step { evs, stdin: Vec::new() }
            }
            "rate_limit_event" | "keep_alive" => Step::default(),
            _ => {
                self.dropped.unknown += 1;
                Step::default()
            }
        }
    }

    /// 그림이 있으면 `content` 는 블록 배열 — 그림(`image` · base64) 먼저, 글(`text` — 비었으면 없음) 뒤(API 메시지 꼴 · 같은 줄 하나).
    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str> {
        if !self.ready {
            return Err("not-ready");
        }
        let content = if images.is_empty() {
            json!(text)
        } else {
            let mut blocks = Vec::with_capacity(images.len() + 1);
            for im in images {
                let data = im.data.as_deref().ok_or("bad-image")?;
                blocks.push(json!({"type": "image", "source": {"type": "base64", "media_type": im.media_type, "data": data}}));
            }
            if !text.trim().is_empty() {
                blocks.push(json!({"type": "text", "text": text}));
            }
            Value::Array(blocks)
        };
        self.queued.push_back(client_id.map(str::to_string));
        let line = json!({"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": null});
        Ok(Step::line(line.to_string()))
    }

    fn encode_interrupt(&mut self) -> Result<Step, &'static str> {
        // 보낸 글이 아직 턴을 열지 않았어도(그 사이 수십 ms) 끊을 수 있다.
        if !self.in_turn && self.queued.is_empty() && !self.compact_op {
            return Err("no-turn");
        }
        if self.compacting || self.compact_op {
            self.compact_stop = true;
        }
        Ok(Step::line(self.control(Control::Interrupt, json!({"subtype": "interrupt"}))))
    }

    fn encode_set_model(&mut self, model: &str) -> Result<Step, &'static str> {
        if !word_ok(model) {
            return Err("bad-model");
        }
        Ok(Step::line(self.control(Control::SetModel(model.to_string()), json!({"subtype": "set_model", "model": model}))))
    }

    /// 플래그 설정 층에 `effortLevel` 하나(메모리뿐 — 설정 파일을 쓰지 않는다). 답이 오면 `effortChanged`.
    fn encode_set_effort(&mut self, effort: Option<&str>) -> Result<Step, &'static str> {
        if effort.is_some_and(|e| !effort_ok(&self.efforts, e)) {
            return Err("bad-effort");
        }
        let request = json!({"subtype": "apply_flag_settings", "settings": {"effortLevel": effort}});
        Ok(Step::line(self.control(Control::SetEffort(effort.map(str::to_string)), request)))
    }

    fn encode_decision(&mut self, request_id: &str, decision: Decision, message: Option<&str>) -> Result<Step, &'static str> {
        let p = self.pending.get(request_id).ok_or("unknown-request")?;
        // 질문의 허용은 답(`encode_tile_answer`)으로만 — 답 없는 허용은 CLI 가 "답하지 않음" 으로 받는다
        if decision == Decision::Allow && p.tool == "AskUserQuestion" {
            return Err("bad-answer");
        }
        let p = self.pending.remove(request_id).ok_or("unknown-request")?;
        let said = message.map(str::trim).filter(|m| !m.is_empty());
        let framed = said.filter(|_| self.tile).map(|m| format!("{TILE_DECLINED_SAID}{m}"));
        let said = framed.as_deref().or(said);
        let line = match decision {
            Decision::Allow => json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id,
                "response": {"behavior": "allow", "updatedInput": p.input}}})
            .to_string(),
            Decision::Deny if p.tool == "ExitPlanMode" => deny_line(request_id, said.unwrap_or(PLAN_KEEP)),
            Decision::Deny => deny_line(request_id, said.unwrap_or(DENIED)),
        };
        Ok(Step {
            evs: vec![Ev::PermissionResolved {
                request_id: request_id.to_string(),
                decision: Some(decision),
                by: ResolvedBy::Human,
            }],
            stdin: vec![line],
        })
    }

    /// 사건은 내지 않는다 — 답(`response.mode`)과 `system/status` 가 `CliMode` 를 낸다.
    fn encode_set_perm_mode(&mut self, mode: &str) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        if !self.ready {
            return Err("not-ready");
        }
        if !self.choices().iter().any(|c| c == mode) {
            return Err("bad-mode");
        }
        let request = json!({"subtype": "set_permission_mode", "mode": mode});
        Ok(Step::line(self.control(Control::SetMode(mode.to_string()), request)))
    }

    fn encode_tile_answer(&mut self, request_id: &str, answer: TileAnswer<'_>) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let p = self.pending.get(request_id).ok_or("unknown-request")?;
        let response = match answer {
            TileAnswer::AllowSession => {
                let s = p.session.clone().ok_or("no-session-allow")?;
                json!({"behavior": "allow", "updatedInput": p.input, "updatedPermissions": [s]})
            }
            TileAnswer::Answers(given) => {
                if p.tool != "AskUserQuestion" {
                    return Err("bad-answer");
                }
                let checked = crate::tile_permission::checked_answers(&p.input, given).ok_or("bad-answer")?;
                let mut updated = p.input.as_object().cloned().ok_or("bad-answer")?;
                let answers: Map<String, Value> = checked.into_iter().map(|(q, a, _)| (q, Value::String(a))).collect();
                updated.insert("answers".into(), Value::Object(answers));
                json!({"behavior": "allow", "updatedInput": updated})
            }
        };
        self.pending.remove(request_id);
        let line = json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id, "response": response}});
        Ok(Step {
            evs: vec![Ev::PermissionResolved { request_id: request_id.to_string(), decision: Some(Decision::Allow), by: ResolvedBy::Human }],
            stdin: vec![line.to_string()],
        })
    }

    /// 사용자 줄 `/compact[ 지침]` — 사람이 친 `/compact` 와 같은 줄(CLI 가 가로채는 제어 낱말 · 모델 턴이 아니다). 사건 없음.
    fn encode_compact(&mut self, instructions: Option<&str>) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        if !self.ready {
            return Err("not-ready");
        }
        if self.in_turn || !self.queued.is_empty() || self.compact_op {
            return Err("turn-running");
        }
        self.compact_op = true;
        let content = match instructions {
            Some(i) => format!("/compact {i}"),
            None => "/compact".to_string(),
        };
        let line = json!({"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": null});
        Ok(Step::line(line.to_string()))
    }

    /// 대화 미리 보기는 CLI 에 보내는 것이 없다(dry-run 요청이 없다) — 곧바로 `Preview{can:true}`. `both` 실행 = `rewind_files` 먼저.
    fn encode_rewind(&mut self, anchor: &str, scope: &str, dry_run: bool, last_seen: Option<&str>) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        let scope = rewind_scope(scope).ok_or("unsupported")?;
        let files = matches!(scope, "files" | "both");
        let convo = matches!(scope, "conversation" | "both");
        if (files && !self.checkpoints) || (convo && !self.conv_rewind) {
            return Err("unsupported");
        }
        if !self.ready {
            return Err("not-ready");
        }
        if self.in_turn || !self.queued.is_empty() || self.compact_op {
            return Err("turn-running");
        }
        if self.rewind_req.is_some() {
            return Err("rewind-running");
        }
        let seen = last_seen.filter(|s| uuid_ok(s));
        if !uuid_ok(anchor) || (convo && !dry_run && seen.is_none()) {
            return Err("bad-anchor");
        }
        if scope == "conversation" && dry_run {
            return Ok(Step::ev(rewind_ev(RewindPhase::Preview, anchor, scope, true, RewindMore::default())));
        }
        self.rewind_req = Some(RewindReq { anchor: anchor.to_string(), scope, dry: dry_run, last_seen: seen.map(str::to_string), files_done: None });
        let line = if files {
            let mut request = json!({"subtype": "rewind_files", "user_message_id": anchor});
            if dry_run {
                request["dry_run"] = json!(true);
            }
            self.control(Control::RewindFiles, request)
        } else {
            self.rewind_conversation_line(anchor, seen.unwrap_or_default())
        };
        Ok(Step::line(line))
    }

    /// 제어 요청 `mcp_status` 한 줄 — 턴 중에도 CLI 가 받는다(실측). 사건은 답이 낸다.
    fn encode_mcp_status(&mut self) -> Result<Step, &'static str> {
        if !self.tile {
            return Err("unsupported");
        }
        if !self.ready {
            return Err("not-ready");
        }
        Ok(Step::line(self.control(Control::McpStatus, json!({"subtype": "mcp_status"}))))
    }

    fn close_pending(&mut self) -> Vec<Ev> {
        self.in_turn = false;
        self.queued.clear();
        self.rewind_req = None;
        self.compact_op = false;
        self.after_boundary = false;
        self.last_usage = None;
        self.compacting = false;
        self.compact_stop = false;
        self.compact_failed = false;
        self.resolve_all(ResolvedBy::Closed)
    }

    fn dropped(&self) -> Dropped {
        self.dropped
    }
}
