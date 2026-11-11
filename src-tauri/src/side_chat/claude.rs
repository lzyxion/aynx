//! **Claude Code 어댑터** — `claude -p` stream-json 양방향(실측 docs/log/2026-10-23-side-chat-structured-spike.md 1차 · 3차). 순수.
//!
//! - 인자 [`argv`] — 3차 후보 그대로 + `--tools`(내장 도구를 읽기 · 웹 다섯으로 줄임 — 10-23 v2 1단계 실측: `--permission-prompt-tool
//!   stdio` 와 함께 써도 `can_use_tool` 이 그대로 오고 `system/init` 의 `tools` 가 다섯으로 준다 · 지연 도구였던 WebFetch 가 `ToolSearch`
//!   없이 바로 묻는다). 설정 출처 통제 = 판정형 턴과 같은 후보 B(`--setting-sources ""` + 훅 끈 설정 파일) · MCP 는 채팅 파일만
//!   (`--strict-mcp-config`). 미리 허용 = cwd 안 `Read(./**)` + `WebSearch` + `WebFetch`(10-25 사용자 결정) — cwd 밖 읽기만 카드로 묻는다(설계 4절 · 8절 2).
//! - 준비 = `initialize` 제어 요청의 답(버전 `response.response.claude_code_version` · 모델 별칭 목록). `system/init` 은 **턴마다** 온다 —
//!   턴 시작 신호로 쓴다(함정 1).
//! - 추론 강도 = 띄울 때 `--effort <낱말>`, 대화 중에는 제어 요청 `apply_flag_settings{settings:{effortLevel}}`(플래그 설정 층 — 메모리뿐 ·
//!   설정 파일을 쓰지 않는다 · `null` = 모델 기본으로 · 모르는 낱말도 성공으로 답하고 무시하니 [`effort_ok`] 로 거른다 — 10-23 실측
//!   `get_settings.applied.effort`). 모델마다 받는 강도는 `initialize` 답의 `models[].supportedEffortLevels`(없으면 강도 없음).
//! - 끊기 = 제어 요청 `interrupt` → `result{terminal_reason:"aborted_streaming"}` = `turnEnded{interrupted}`(함정 2).
//! - `AskUserQuestion` · `EnterPlanMode` · `ExitPlanMode` 가 `can_use_tool` 로 오면(막았어도) 곧바로 거절 + 고정 문장 [`ASK_PLAINLY`](함정 3).
//!   모르는 제어 요청은 오류로 답한다(영영 기다리지 않게).
//! - 하위 에이전트 줄(`parent_tool_use_id` 있음)은 대화창에 섞지 않는다(`--tools` 로 Task 가 없어 실제로는 오지 않는다).

use std::collections::{BTreeMap, VecDeque};

use serde_json::{json, Value};

use super::event::{
    cap, effort_ok, mcp_summary, model_ok, one_line, split_mcp_tool, str_of, uuid_ok, word_ok, Cli, Decision, Dropped, Ev, Mode, Outcome, PermKind, ResolvedBy, Step,
    UserImage, DETAIL_MAX,
};
use super::Adapter;

/// 확인한 버전(실측) — 다르면 `notice{untested-version}` 만(칩 경고 — 설계 7절 위험).
pub(crate) const TESTED_VERSION: &str = "2.1.312";
/// 확인한 버전들(사이드 채팅 1단계 재료 2.1.309 · 프로듀서 단계 0 실측 2.1.312 — 10-30).
pub(crate) const TESTED_VERSIONS: [&str; 2] = ["2.1.309", TESTED_VERSION];
/// `--settings` 파일의 본문 — 훅을 모두 끈다(판정형 턴 후보 B 와 같다).
pub(crate) const SETTINGS_JSON: &str = r#"{"disableAllHooks":true}"#;
/// `--mcp-config` 파일의 기본 본문 — MCP 없음(세션 서버의 MCP 포트가 없거나 채팅 토큰을 못 뽑았을 때).
pub(crate) const MCP_CONFIG_EMPTY: &str = r#"{"mcpServers":{}}"#;

/// `--mcp-config` 파일의 본문 — Aynx 세션 서버 하나 · **그 프로세스의 채팅 토큰**(5단계 — `crate::chat_token`). `--strict-mcp-config` 와 짝이라
/// 사용자 MCP 서버는 싣지 않는다. 순수(파일은 서버가 채팅 임시 자리에 쓴다 · 끝나면 지운다).
pub(crate) fn mcp_config(name: &str, url: &str, token: &str) -> String {
    serde_json::json!({
        "mcpServers": { name: { "type": "http", "url": url, "headers": { "Authorization": format!("Bearer {token}") } } }
    })
    .to_string()
}

/// `--mcp-config` 본문에 **사람이 사이드 채팅에 고른 외부 서버**(2026-10-25 — `agent_mcp::side_chat_servers` · 서버가 준비한 실행 모양)를
/// 더한다. 그 밖의 서버(사용자 CLI 설정)는 `--strict-mcp-config` 가 막는다. 이미 있는 이름(Aynx 서버 — 외부 목록에서는 거절되는 이름)은 덮지
/// 않는다. 순수.
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

/// 묻지 않는 외부 서버의 `--allowedTools` 규칙 — 서버 통째(`mcp__<서버>` — 2.1.310 실측: 그 서버의 도구가 `can_use_tool` 없이 돈다).
pub(crate) fn no_ask_rules(external: &[crate::agent_mcp::McpServer]) -> Vec<String> {
    external.iter().filter(|s| s.side_chat_no_ask).map(|s| format!("mcp__{}", s.name)).collect()
}
/// 내장 도구 — 읽기 셋 + 웹 둘(`--tools`). 쓰기 · 명령 · Task · 대화형 도구는 아예 없다.
pub(crate) const TOOLS: &str = "Read,Grep,Glob,WebSearch,WebFetch";
/// 묻지 않고 쓰는 것 — cwd 안 읽기 · 웹 검색 · 페이지 읽기(설계 8절 2 · 10-25). cwd 밖 읽기만 카드로.
pub(crate) const ALLOWED: [&str; 3] = ["Read(./**)", "WebSearch", "WebFetch"];
/// 대화형 도구 — 막고, 그래도 오면 [`ASK_PLAINLY`] 로 거절.
pub(crate) const INTERACTIVE: [&str; 3] = ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"];
pub(crate) const ASK_PLAINLY: &str = "평문으로 물어 주세요";
/// 사람이 거절하며 글을 남기지 않았을 때 모델에게 가는 문장.
pub(crate) const DENIED: &str = "사용자가 거절했습니다";

/// 인자 재료 — 파일 경로는 서버가 채팅 자리에 쓴 것(본문 [`SETTINGS_JSON`] · [`MCP_CONFIG_EMPTY`] · 지침).
pub(crate) struct Opts<'a> {
    /// 실행 파일 절대 경로(PATH 의 `.exe`).
    pub exe: &'a str,
    pub mode: Mode<'a>,
    /// 새 대화 · 갈라 온 대화의 id(서버가 정한다 — `--session-id`). 이어 가기에는 쓰지 않는다.
    pub session_id: &'a str,
    pub model: &'a str,
    pub effort: Option<&'a str>,
    pub settings_file: &'a str,
    pub mcp_config_file: &'a str,
    /// 지침 파일(검색 지침 + 전역 CLAUDE.md + `sidechat/CLAUDE.md` — `--append-system-prompt-file` · 서버는 늘 싣는다).
    pub append_file: Option<&'a str>,
    /// 묻지 않고 부르는 Aynx MCP 도구(`mcp__<서버>__<도구>` — 5단계 읽기 도구 · `--allowedTools` 에 더한다). 비면 없음.
    pub mcp_allowed: &'a [String],
}

/// 실행 인자 배열 `[exe, …]`(셸 없음 · 사용자 추가 인자 없음). 대화 id · 모델 · 강도 낱말이 틀리면 거절.
///
/// | 모양 | 대화 인자 |
/// |---|---|
/// | 새 대화 | `--session-id <새 id>` |
/// | 이어 가기 | `--resume <id>`(`--session-id` 를 함께 주면 시작 오류) |
/// | 갈라 오기 | `--resume <원본> --fork-session --session-id <새 id>`(실측 — 새 id 가 그대로 선다 · 기억함) |
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

/// **프로듀서 채팅의 내장 도구**(오케스트레이션 2단계 단계 2 — 설계 1-2 · R9): 읽기 셋뿐(웹 · 쓰기 · 명령 없음).
pub(crate) const PRODUCER_TOOLS: &str = "Read,Grep,Glob";

/// **프로듀서 인자**(설계 1-2) — [`argv`] 와 같은 줄에서 내장 도구를 [`PRODUCER_TOOLS`] 로, 묻지 않음을 `Read(./**)` 하나(+ Aynx MCP 미리
/// 허용)로 바꾼다. `--setting-sources ""` · `--settings`(훅 끔) · `--strict-mcp-config` · 대화형 도구 막기는 그대로다(실측 P9 — 사용자 · 프로젝트
/// 설정의 허용 규칙 · 훅 · MCP 가 새지 않는다). 순수.
pub(crate) fn producer_argv(o: &Opts<'_>) -> Result<Vec<String>, &'static str> {
    let mut a = argv(o)?;
    if let Some(i) = a.iter().position(|x| x == "--tools") {
        a[i + 1] = PRODUCER_TOOLS.to_string();
    }
    a.retain(|x| x != ALLOWED[1] && x != ALLOWED[2]);
    Ok(a)
}

/// 도구 입력에서 한 줄 요약(파일 · 명령 · 검색어 · 주소).
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

/// 도구 결과 본문 → 글(문자열 · 텍스트 조각 배열).
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
}

/// 어댑터 상태 — 줄 사이의 작은 장부.
pub(crate) struct Claude {
    model: String,
    conversation: String,
    seq: u64,
    /// 우리가 보낸 제어 요청 → 무엇(`set_model` 이면 고른 별칭).
    controls: BTreeMap<String, Control>,
    /// 모델 → 받는 강도(`initialize` 답 — `Ev::Ready.efforts` 와 같은 것).
    efforts: BTreeMap<String, Vec<String>>,
    pending: BTreeMap<String, Pending>,
    /// 보냈지만 아직 턴이 시작되지 않은 글의 `clientId`(차례대로 — CLI 는 글 하나에 턴 하나).
    queued: VecDeque<Option<String>>,
    in_turn: bool,
    ready: bool,
    dropped: Dropped,
}

enum Control {
    Initialize,
    SetModel(String),
    SetEffort(Option<String>),
    Interrupt,
}

impl Claude {
    /// `argv` 와 같은 재료로 — 대화 id 는 새 대화 · 갈라 오기면 `session_id`, 이어 가기면 그 id.
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
        }
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
                if !version.as_deref().is_some_and(|v| TESTED_VERSIONS.contains(&v)) {
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
                let model = str_of(&r["response"]["model"]).unwrap_or(alias);
                Step::ev(Ev::ModelChanged { model })
            }
            Some(Control::SetModel(_)) => Step::ev(Ev::Notice { code: "set-model-failed", detail: err() }),
            Some(Control::SetEffort(effort)) if ok => Step::ev(Ev::EffortChanged { effort }),
            Some(Control::SetEffort(_)) => Step::ev(Ev::Notice { code: "set-effort-failed", detail: err() }),
            Some(Control::Interrupt) if ok => Step::default(),
            Some(Control::Interrupt) => Step::ev(Ev::Notice { code: "interrupt-failed", detail: err() }),
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
            let line = json!({"type": "control_response", "response": {
                "subtype": "error", "request_id": id, "error": format!("Aynx side chat does not handle {subtype}")}});
            return Step {
                evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(one_line(subtype)) }],
                stdin: vec![line.to_string()],
            };
        }
        let tool = req["tool_name"].as_str().unwrap_or("").to_string();
        if INTERACTIVE.contains(&tool.as_str()) {
            return Step {
                evs: vec![Ev::Notice { code: "asked-plainly", detail: Some(tool) }],
                stdin: vec![deny_line(id, ASK_PLAINLY)],
            };
        }
        let input = req["input"].clone();
        // 외부 MCP 도구(2.1.310 실측 — `mcp_server{name}` · `display_name` 은 도구의 사람 이름뿐) — 제목 `<서버> · <도구>` · 상세 = 입력 JSON
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
        let ev = Ev::Permission {
            request_id: id.to_string(),
            kind,
            title: one_line(&title),
            detail: cap(&detail),
            tool_name: tool.clone(),
        };
        self.pending.insert(id.to_string(), Pending { input });
        Step::ev(ev)
    }

    fn resolve_all(&mut self, by: ResolvedBy) -> Vec<Ev> {
        std::mem::take(&mut self.pending)
            .into_keys()
            .map(|request_id| Ev::PermissionResolved { request_id, decision: None, by })
            .collect()
    }
}

/// `initialize` 답 → 모델 → 받는 강도. `supportedEffortLevels` 가 없는 모델은 빈 목록(강도를 받지 않는다 — 실측 `claude-haiku-4-5-…`).
/// 열쇠 `""` = 지금 뜬 CLI 기본 = 별칭 `default` 의 목록(`--model` 을 싣지 않았을 때 칩이 쓰는 것).
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
                if v["subtype"] != "init" {
                    return Step::default();
                }
                let mut evs = Vec::new();
                if !self.in_turn {
                    self.in_turn = true;
                    evs.push(Ev::TurnStarted { turn: None });
                    evs.push(Ev::UserAccepted { client_id: self.queued.pop_front().flatten(), text: None, files: Vec::new() });
                }
                if let Some(sid) = v["session_id"].as_str().filter(|s| *s != self.conversation) {
                    self.conversation = sid.to_string();
                    evs.push(Ev::Notice { code: "conversation-changed", detail: Some(sid.to_string()) });
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
                // 도구 호출 중 끊기면 `aborted_tools`(`is_error:true` — 2.1.312 실측 P4) — 이것도 끊김이다(오류 끝이 아니다).
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
        if !self.in_turn && self.queued.is_empty() {
            return Err("no-turn");
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
        let p = self.pending.remove(request_id).ok_or("unknown-request")?;
        let line = match decision {
            Decision::Allow => json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id,
                "response": {"behavior": "allow", "updatedInput": p.input}}})
            .to_string(),
            Decision::Deny => deny_line(request_id, message.map(str::trim).filter(|m| !m.is_empty()).unwrap_or(DENIED)),
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

    fn close_pending(&mut self) -> Vec<Ev> {
        self.in_turn = false;
        self.queued.clear();
        self.resolve_all(ResolvedBy::Closed)
    }

    fn dropped(&self) -> Dropped {
        self.dropped
    }
}
