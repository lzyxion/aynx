//! Claude Code 어댑터 — `claude -p` stream-json 양방향(docs/log/2026-10-23-side-chat-structured-spike.md). 순수.
//!
//! - 설정 출처 통제: `--setting-sources ""` + 훅 끈 설정 파일 · MCP 는 채팅 파일만(`--strict-mcp-config`). 내장 도구는 `--tools` 로 읽기 · 웹 다섯뿐(쓰기 · 명령 · Task 없음).
//! - 미리 허용 = cwd 안 `Read(./**)` + `WebSearch` + `WebFetch` — cwd 밖 읽기만 카드로 묻는다. 예외: 갈라 온 채팅은 서버가 첨부 폴더 읽기를 인자 끝에 더한다(`server::side_chat::attach_read`).
//! - `--permission-prompt-tool stdio` 와 `--tools` 를 함께 써도 `can_use_tool` 이 그대로 온다(실측).
//! - `system/init` 은 턴마다 온다 — 턴 시작 신호로 쓴다. 준비 = `initialize` 제어 요청의 답.
//! - 대화 중 강도 = `apply_flag_settings{settings:{effortLevel}}`(메모리뿐 · 설정 파일을 쓰지 않는다) — 모르는 낱말도 성공으로 답하고 무시하니 [`effort_ok`] 로 거른다.
//! - 끊기 = 제어 요청 `interrupt` → `result{terminal_reason:"aborted_streaming"}`.
//! - 대화형 도구가 `can_use_tool` 로 오면(막았어도) 곧바로 거절 + [`ASK_PLAINLY`]. 모르는 제어 요청은 오류로 답한다(영영 기다리지 않게).

use std::collections::{BTreeMap, VecDeque};

use serde_json::{json, Value};

use super::event::{
    cap, effort_ok, mcp_summary, model_ok, one_line, semver3, split_mcp_tool, str_of, uuid_ok, word_ok, Cli, Decision, Dropped, Ev, Mode, Outcome, PermKind, ResolvedBy, Step,
    UserImage, DETAIL_MAX,
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
}

enum Control {
    Initialize,
    SetModel(String),
    SetEffort(Option<String>),
    Interrupt,
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
