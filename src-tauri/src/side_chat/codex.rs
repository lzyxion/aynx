//! Codex 어댑터 — `codex app-server`(stdio 줄 단위 JSON-RPC · experimental). 순수 — 파일 읽기는 서버 몫이다
//! (docs/log/2026-10-23-side-chat-structured-spike.md).
//!
//! - 사용자 MCP 서버는 이름마다 `-c mcp_servers.<이름>.enabled=false` 로 끈다 — `-c mcp_servers={}` 는 합쳐져 안 꺼진다.
//! - `tools.web_search.context_size` 는 설정 스키마의 값이어야 한다 — 틀린 값이면 Codex 가 설정 읽기에서 죽는다.
//! - 전역 지침 파일은 싣지 않는다 — `developerInstructions` 는 앱 고정 지침 + 사람의 사이드 채팅 지침뿐이다.
//! - 승인 요청이 아닌 서버 요청(`item/tool/requestUserInput` · 폼 · URL elicitation · 모르는 것)은 곧바로 거절 · 취소로 답한다 — 영영 기다리지 않게.
//! - 외부 MCP 서버의 도구 승인은 늘 `prompt` 다 — 묻지 않기는 CLI 에 맡기지 않고 세션 서버가 채팅의 모드 · 허용 목록으로 답한다.
//! - 한 번 실은 강도는 다음 턴에도 남는다(`null` 은 "그대로") — CLI 기본으로 되돌리려면 스레드가 처음 알린 `reasoningEffort` 를 다시 싣는다.
//! - `imageGeneration` 의 끝 줄은 그림 바이트를 품어 1 MiB 를 넘는다 — 서버의 줄 상한(`server/chat_proc/spawn.rs` 의 `STDOUT_LINE_MAX`)이 받쳐야 한다.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Value};

use super::event::{
    cap, effort_ok, image_markdown, mcp_summary, model_ok, one_line, semver3, str_of, uuid_ok, word_ok, Cli, Decision, Dropped, Ev, Mode, Outcome, PermKind, ResolvedBy, Step,
    UserImage,
};
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
    Thread,
    TurnStart,
    Interrupt,
}

/// 답에는 받은 id 를 그대로(숫자 · 문자열) 돌려준다. `elicitation` 이면 답 꼴이 `{action}` 이다.
struct Pending {
    raw_id: Value,
    elicitation: bool,
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
    files: BTreeMap<String, (Vec<String>, String)>,
    tools: BTreeSet<String>,
    /// 승인 요청(elicitation)에는 도구 이름 칸이 없어 막 시작한 도구 이름을 붙인다.
    mcp_calls: BTreeMap<String, String>,
    dropped: Dropped,
}

enum ModeOwned {
    Fresh,
    Resume(String),
    Fork(String),
}

/// 세지 않고 버린다.
const QUIET: [&str; 12] = [
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
        }
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
        let base = json!({"cwd": self.cwd, "model": self.model_json(), "approvalPolicy": self.approval, "sandbox": "read-only",
            "developerInstructions": self.instructions});
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
                stdin.push(self.thread_request());
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
                }
                self.models = Some(models);
                Step { evs: self.maybe_ready(), stdin: Vec::new() }
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
                Step { evs: self.maybe_ready(), stdin: Vec::new() }
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
        }
    }

    fn on_server_request(&mut self, v: &Value, method: &str) -> Step {
        let raw_id = v["id"].clone();
        let key = raw_id.to_string();
        let p = &v["params"];
        let ev = match method {
            "item/commandExecution/requestApproval" => {
                let reason = p["reason"].as_str().unwrap_or("");
                let cwd = p["cwd"].as_str().unwrap_or("");
                Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::Command,
                    title: one_line(&display_command(p)),
                    detail: cap(&[reason, cwd].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")),
                    tool_name: "commandExecution".into(),
                }
            }
            "item/fileChange/requestApproval" => {
                let (paths, diff) = p["itemId"].as_str().and_then(|i| self.files.get(i)).cloned().unwrap_or_default();
                let reason = p["reason"].as_str().unwrap_or("");
                Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::FileChange,
                    title: one_line(&paths.join(", ")),
                    detail: cap(&[reason, diff.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")),
                    tool_name: "fileChange".into(),
                }
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
                let ev = Ev::Permission {
                    request_id: key.clone(),
                    kind: PermKind::McpTool,
                    title: one_line(&title),
                    detail: cap(&shown),
                    tool_name: format!("mcp__{server}__{tool}"),
                };
                self.pending.insert(key, Pending { raw_id, elicitation: true });
                return Step::ev(ev);
            }
            "mcpServer/elicitation/request" => {
                let line = json!({"jsonrpc": "2.0", "id": raw_id, "result": {"action": "cancel"}}).to_string();
                return Step { evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(method.into()) }], stdin: vec![line] };
            }
            _ => {
                let line = json!({"jsonrpc": "2.0", "id": raw_id, "error": {"code": UNSUPPORTED,
                    "message": format!("Aynx side chat does not handle {method} — ask in plain text")}})
                .to_string();
                return Step {
                    evs: vec![Ev::Notice { code: "unsupported-request", detail: Some(one_line(method)) }],
                    stdin: vec![line],
                };
            }
        };
        self.pending.insert(key, Pending { raw_id, elicitation: false });
        Step::ev(ev)
    }

    fn on_notification(&mut self, v: &Value, method: &str) -> Step {
        let p = &v["params"];
        let item = &p["item"];
        let item_id = || item["id"].as_str().unwrap_or("").to_string();
        let ev = match method {
            "turn/started" => {
                self.live_turn = str_of(&p["turn"]["id"]);
                Ev::TurnStarted { turn: self.live_turn.clone() }
            }
            "turn/completed" => {
                let t = &p["turn"];
                let (outcome, message) = match t["status"].as_str().unwrap_or("") {
                    "completed" => (Outcome::Ok, None),
                    "interrupted" => (Outcome::Interrupted, None),
                    _ => (Outcome::Error, Some(one_line(t["error"]["message"].as_str().unwrap_or("turn failed")))),
                };
                self.live_turn = None;
                self.files.clear();
                let mut evs = self.resolve_all(ResolvedBy::Cli);
                evs.push(Ev::TurnEnded { turn: str_of(&t["id"]), outcome, message });
                return Step { evs, stdin: Vec::new() };
            }
            "item/agentMessage/delta" => Ev::TextDelta { item: str_of(&p["itemId"]), text: p["delta"].as_str().unwrap_or("").into() },
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
                            self.files.insert(id.clone(), (paths.clone(), diff));
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

fn with(mut base: Value, kv: &[(&str, Value)]) -> Value {
    for (k, v) in kv {
        base[*k] = v.clone();
    }
    base
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

    fn handshake(&mut self) -> Vec<String> {
        let params = json!({"clientInfo": {"name": "aynx", "title": "Aynx", "version": self.client_version},
            "capabilities": {"experimentalApi": false}});
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

    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str> {
        let thread = self.thread.clone().filter(|_| self.ready).ok_or("not-ready")?;
        let mut input: Vec<Value> = images.iter().map(|im| json!({"type": "localImage", "path": im.path})).collect();
        if images.is_empty() || !text.trim().is_empty() {
            input.push(json!({"type": "text", "text": text, "text_elements": []}));
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
        let p = self.pending.remove(request_id).ok_or("unknown-request")?;
        let word = match decision {
            Decision::Allow => "accept",
            Decision::Deny => "decline",
        };
        // MCP 도구 승인은 elicitation 답 꼴(스키마 `McpServerElicitationRequestResponse`)
        let result = if p.elicitation { json!({"action": word, "content": null}) } else { json!({"decision": word}) };
        Ok(Step {
            evs: vec![Ev::PermissionResolved {
                request_id: request_id.to_string(),
                decision: Some(decision),
                by: ResolvedBy::Human,
            }],
            stdin: vec![json!({"jsonrpc": "2.0", "id": p.raw_id, "result": result}).to_string()],
        })
    }

    fn close_pending(&mut self) -> Vec<Ev> {
        self.live_turn = None;
        self.queued.clear();
        self.files.clear();
        self.mcp_calls.clear();
        self.resolve_all(ResolvedBy::Closed)
    }

    fn dropped(&self) -> Dropped {
        self.dropped
    }
}
