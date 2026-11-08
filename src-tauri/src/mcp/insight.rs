//! **들여다보기** — 설정 › MCP › 세션 서버 하위 화면의 재료 둘(2026-10-19): 이 서버가 낼 수 있는 **도구 목록**([`tool_catalog`])과
//! **최근 도구 호출**([`CallLog`] — 메모리 고리 하나, 서버 op `mcp_tools` · `mcp_calls` — `crate::server::ai`).
//!
//! 불변식:
//! - 도구 목록은 `tools/list` 가 싣는 **바로 그 스키마 함수들**에서 뽑는다(`schema::base_tools` · `db::tool_schemas` ·
//!   `orchestration::*_tool_schemas`) — 프런트에 손으로 옮긴 표가 없다. 묶음 이름만 여기서 붙인다(읽기 · 작업안은 [`PLAN_TOOLS`]).
//! - 호출 기록 한 줄([`McpCallRecord`])은 **도구 이름 · 시각 · 호출자 종류 · 클라이언트 이름 · 결과 종류 · 거절 낱말**뿐이다.
//!   인자 · 결과 본문 · 토큰 · 세션 내용 · 스트림 id 는 **싣지 않는다**(시험 `call_record_keeps_no_arguments`).
//!   - 도구 이름은 목록에 있는 이름일 때만 그대로 — 모르는 이름은 `(unknown)`(AI 가 보낸 아무 글자가 기록에 남지 않게).
//!   - 거절 낱말은 오케스트레이션 거절 사유 표(`orchestration::store::reason` — 소스에서 읽는다)에 있는 낱말일 때만.
//!   - 클라이언트 이름은 그 호출자가 `initialize` 에 밝힌 `clientInfo.name`(상태바 도장과 같은 출처 · 64자까지). 호출자 → 이름 표의 열쇠
//!     (스트림 · Attempt id)는 이 파일 밖으로 나가지 않는다.
//! - 고리는 200줄 · 메모리에만 — **세션 서버가 다시 뜨면 비어 있다**(화면이 그렇게 밝힌다).

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::orchestration::Caller;

/// 전역 13개 중 **작업안**(계획 · 검토 요청 · 기다리기 · 결과 · 자동 승인 범위) 묶음 — 나머지는 읽기다.
pub(crate) const PLAN_TOOLS: &[&str] = &[
    "create_execution_plan",
    "request_execution",
    "get_operation",
    "wait_for_operation",
    "get_operation_results",
    "get_auto_approval_policy",
];

/// 고리의 크기.
pub(crate) const CALL_LOG_CAP: usize = 200;
/// 호출자 → 클라이언트 이름 표의 상한(넘으면 비우고 다시 — 이름은 다음 `initialize` 에서 돌아온다).
const CLIENT_MAP_CAP: usize = 512;
/// 클라이언트 이름 상한(글자).
const CLIENT_NAME_MAX: usize = 64;
/// 설명 한 줄의 상한(글자).
const DESCRIPTION_MAX: usize = 240;

/// 도구 하나 — `{name, group, description}`. 설명은 스키마 설명의 첫 문장(영어 — MCP 표면은 표시 언어를 타지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ToolInfo {
    pub name: String,
    /// `read` · `plan` · `db` · `tile` · `coordinator` · `worker` · `reviewer`
    pub group: String,
    pub description: String,
}

/// 이 서버가 **어느 호출자에게든** 낼 수 있는 도구 전부(묶음 순서 그대로). 같은 이름이 두 묶음에 설 수 있다(`get_task` · `get_diff`).
pub(crate) fn tool_catalog() -> Vec<ToolInfo> {
    let mut out = Vec::new();
    let base = super::schema::base_tools();
    for t in base.get("tools").and_then(Value::as_array).into_iter().flatten() {
        let group = if t.get("name").and_then(Value::as_str).is_some_and(|n| PLAN_TOOLS.contains(&n)) { "plan" } else { "read" };
        push(&mut out, t, group);
    }
    for t in super::db::tool_schemas(crate::db::ai::DbAiLevel::Approve) {
        push(&mut out, &t, "db");
    }
    for t in crate::orchestration::tile_tool_schemas() {
        push(&mut out, &t, "tile");
    }
    for t in crate::orchestration::coordinator_tool_schemas() {
        push(&mut out, &t, "coordinator");
    }
    for t in crate::orchestration::worker_tool_schemas() {
        push(&mut out, &t, "worker");
    }
    for t in crate::orchestration::reviewer_tool_schemas() {
        push(&mut out, &t, "reviewer");
    }
    out
}

fn push(out: &mut Vec<ToolInfo>, t: &Value, group: &str) {
    let Some(name) = t.get("name").and_then(Value::as_str) else { return };
    let description = t.get("description").and_then(Value::as_str).map(first_sentence).unwrap_or_default();
    out.push(ToolInfo { name: name.to_string(), group: group.to_string(), description });
}

/// 설명의 첫 문장 — `**` 강조를 걷고, `. ` 앞까지(없으면 통째), 상한에서 자른다.
pub(crate) fn first_sentence(s: &str) -> String {
    let plain = s.replace("**", "");
    let plain = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut = plain.find(". ").map(|i| &plain[..=i]).unwrap_or(&plain);
    if cut.chars().count() <= DESCRIPTION_MAX {
        cut.to_string()
    } else {
        let mut s: String = cut.chars().take(DESCRIPTION_MAX - 1).collect();
        s.push('…');
        s
    }
}

/// 목록에 있는 도구 이름 전부(기록이 받는 이름).
static TOOL_NAMES: LazyLock<HashSet<String>> = LazyLock::new(|| tool_catalog().into_iter().map(|t| t.name).collect());

/// 기록에 남겨도 되는 거절 낱말 — 오케스트레이션 거절 사유 표(`store.rs` 의 `mod reason`)를 소스에서 읽는다(표가 늘면 같이 는다).
/// `send_prompt` 의 구조화된 거절(`{state: "rejected", reason: "spawn-failed"}` — `resume.rs`)은 표 밖이라 여기 더한다.
static REASON_CODES: LazyLock<HashSet<String>> = LazyLock::new(|| {
    let mut set = reason_codes(include_str!("../orchestration/store.rs"));
    set.insert("spawn-failed".to_string());
    set
});

fn reason_codes(src: &str) -> HashSet<String> {
    let Some(start) = src.find("pub(crate) mod reason {") else { return HashSet::new() };
    let body = &src[start..];
    let body = &body[..body.find("\n}").unwrap_or(body.len())];
    body.lines()
        .filter(|l| l.trim_start().starts_with("pub const ") && l.contains(": &str = \""))
        .filter_map(|l| l.split('"').nth(1))
        .map(str::to_string)
        .collect()
}

/// 호출 기록 한 줄 — **이 칸들뿐이다**(모듈 머리말). camelCase 로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallRecord {
    /// 도구 이름(목록에 없는 이름이면 `(unknown)`).
    pub tool: String,
    /// 처리한 시각(epoch ms).
    pub at_ms: i64,
    /// `global` · `tile` · `worker` · `reviewer`.
    pub caller: String,
    /// 그 호출자가 `initialize` 에 밝힌 클라이언트 이름(모르면 `None`).
    pub client: Option<String>,
    /// `ok` · `error` · `rejected`.
    pub outcome: String,
    /// `rejected` 일 때의 거절 낱말(`not-coordinator` 등 — 사유 표에 있는 것만).
    pub code: Option<String>,
}

#[derive(Default)]
struct Inner {
    ring: VecDeque<McpCallRecord>,
    clients: HashMap<String, String>,
}

/// 최근 도구 호출의 고리 + 호출자별 클라이언트 이름.
#[derive(Default)]
pub(crate) struct CallLog {
    inner: Mutex<Inner>,
}

/// 세션 서버 프로세스의 고리 하나(`/mcp` 요청 처리가 적고 op `mcp_calls` 가 읽는다). GUI 프로세스에서는 비어 있다.
pub(crate) static CALLS: LazyLock<CallLog> = LazyLock::new(CallLog::default);

fn caller_kind(c: &Caller) -> &'static str {
    match c {
        Caller::Global => "global",
        Caller::Tile { .. } | Caller::Coordinator { .. } => "tile",
        Caller::Worker { .. } => "worker",
        Caller::Reviewer { .. } => "reviewer",
        Caller::SideChat { .. } => "sideChat",
        Caller::Producer { .. } => "producer",
    }
}

/// 클라이언트 이름 표의 열쇠 — 이 파일 밖으로 나가지 않는다.
fn caller_key(c: &Caller) -> String {
    match c {
        Caller::Global => "g".to_string(),
        Caller::Tile { stream } => format!("t:{stream}"),
        Caller::Coordinator { run_id, .. } => format!("c:{run_id}"),
        Caller::Worker { attempt_id, .. } | Caller::Reviewer { attempt_id, .. } => format!("a:{attempt_id}"),
        Caller::SideChat { chat } => format!("s:{chat}"),
        Caller::Producer { chat, .. } => format!("p:{chat}"),
    }
}

impl CallLog {
    /// 인증을 지난 요청 하나와 그 답을 본다 — `initialize` 면 이름을 적고, `tools/call` 이면 한 줄을 쌓는다. 나머지는 지나간다.
    pub(crate) fn observe(&self, caller: &Caller, body: &str, reply: Option<&str>, at_ms: i64) {
        let Ok(v) = serde_json::from_str::<Value>(body) else { return };
        match v.get("method").and_then(Value::as_str) {
            Some("initialize") => {
                let name = v
                    .pointer("/params/clientInfo/name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.chars().take(CLIENT_NAME_MAX).collect::<String>());
                if let Some(name) = name {
                    let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    if g.clients.len() >= CLIENT_MAP_CAP {
                        g.clients.clear();
                    }
                    g.clients.insert(caller_key(caller), name);
                }
            }
            Some("tools/call") => {
                let tool = v
                    .pointer("/params/name")
                    .and_then(Value::as_str)
                    .filter(|n| TOOL_NAMES.contains(*n))
                    .unwrap_or("(unknown)")
                    .to_string();
                let (outcome, code) = outcome_of(reply);
                let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                let client = g.clients.get(&caller_key(caller)).cloned();
                g.ring.push_front(McpCallRecord {
                    tool,
                    at_ms,
                    caller: caller_kind(caller).to_string(),
                    client,
                    outcome: outcome.to_string(),
                    code,
                });
                g.ring.truncate(CALL_LOG_CAP);
            }
            _ => {}
        }
    }

    /// 최근 것부터.
    pub(crate) fn recent(&self) -> Vec<McpCallRecord> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).ring.iter().cloned().collect()
    }
}

/// 답 하나 → (결과 종류, 거절 낱말). 낱말은 사유 표에 있을 때만 — 오류 글의 나머지(인자를 인용할 수 있다)는 버린다.
fn outcome_of(reply: Option<&str>) -> (&'static str, Option<String>) {
    let Some(v) = reply.and_then(|r| serde_json::from_str::<Value>(r).ok()) else { return ("error", None) };
    let Some(result) = v.get("result") else { return ("error", None) };
    let text = result.pointer("/content/0/text").and_then(Value::as_str).unwrap_or("");
    let known = |s: &str| REASON_CODES.contains(s).then(|| s.to_string());
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let head = text.split(": ").next().unwrap_or("");
        return match known(head) {
            Some(code) => ("rejected", Some(code)),
            None => ("error", None),
        };
    }
    // 성공 봉투 안의 구조화된 거절(`send_prompt` 의 `{state: "rejected", reason}` 등).
    if let Ok(body) = serde_json::from_str::<Value>(text) {
        if body.get("state").and_then(Value::as_str) == Some("rejected") {
            let code = body.get("reason").and_then(Value::as_str).and_then(known);
            return ("rejected", code);
        }
    }
    ("ok", None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_covers_every_listed_tool() {
        let cat = tool_catalog();
        let names: HashSet<&str> = cat.iter().map(|t| t.name.as_str()).collect();
        for p in PLAN_TOOLS {
            assert!(cat.iter().any(|t| t.name == *p && t.group == "plan"), "{p}");
        }
        assert_eq!(cat.iter().filter(|t| t.group == "read" || t.group == "plan").count(), 13);
        for n in ["list_sessions", "db_query", "create_db_write_plan", "get_run", "complete_run", "report_done", "report_review"] {
            assert!(names.contains(n), "{n}");
        }
        for g in ["read", "plan", "db", "tile", "coordinator", "worker", "reviewer"] {
            assert!(cat.iter().any(|t| t.group == g), "{g}");
        }
        assert!(cat.iter().all(|t| !t.description.is_empty() && !t.description.contains("**")));
    }

    #[test]
    fn reason_codes_come_from_the_store_table() {
        assert!(REASON_CODES.contains("not-coordinator"));
        assert!(REASON_CODES.contains("not-a-tile"));
        assert!(!REASON_CODES.contains("out-of-scope:maxTotalWorkers"));
        assert!(REASON_CODES.len() > 20);
    }

    fn tile() -> Caller {
        Caller::Tile { stream: "stream-SECRET-ID".into() }
    }

    /// **기록 한 줄에는 인자 · 결과 · 토큰 · 스트림 id 가 없다** — 칸은 여섯뿐이고, 인자에 실은 글자가 어디에도 남지 않는다.
    #[test]
    fn call_record_keeps_no_arguments() {
        let log = CallLog::default();
        log.observe(&tile(), &json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "clientInfo": { "name": "claude-code" } } }).to_string(), None, 1);
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "get_scrollback", "arguments": { "session": "ARG-SECRET", "lines": 5 } } }).to_string();
        let reply = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "RESULT-SECRET" }] } }).to_string();
        log.observe(&tile(), &body, Some(&reply), 42);
        let rows = log.recent();
        assert_eq!(rows.len(), 1);
        let v = serde_json::to_value(&rows[0]).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(sorted, ["atMs", "caller", "client", "code", "outcome", "tool"]);
        let text = v.to_string();
        for secret in ["ARG-SECRET", "RESULT-SECRET", "SECRET-ID", "stream-"] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
        assert_eq!(rows[0], McpCallRecord {
            tool: "get_scrollback".into(), at_ms: 42, caller: "tile".into(), client: Some("claude-code".into()), outcome: "ok".into(), code: None,
        });
    }

    #[test]
    fn outcomes_and_unknown_names() {
        let log = CallLog::default();
        let call = |name: &str| json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": {} } }).to_string();
        let err = |text: &str| json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": text }], "isError": true } }).to_string();
        log.observe(&Caller::Global, &call("get_run"), Some(&err("not-a-tile: coordination tools need …")), 1);
        log.observe(&Caller::Global, &call("get_command"), Some(&err("no-such-session-ARGVALUE: unknown")), 2);
        log.observe(&Caller::Global, &call("rm -rf ARGVALUE"), Some(&err("Unknown tool: rm -rf ARGVALUE")), 3);
        let ok = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "{\"state\":\"rejected\",\"reason\":\"spawn-failed\"}" }] } }).to_string();
        log.observe(&Caller::Worker { run_id: "r".into(), gen: 1, attempt_id: "a".into() }, &call("report_done"), Some(&ok), 4);
        let rows = log.recent();
        assert_eq!(rows[0].caller, "worker");
        assert_eq!((rows[0].outcome.as_str(), rows[0].code.as_deref()), ("rejected", Some("spawn-failed")));
        assert_eq!((rows[1].tool.as_str(), rows[1].outcome.as_str(), rows[1].code.as_deref()), ("(unknown)", "error", None));
        assert_eq!((rows[2].outcome.as_str(), rows[2].code.as_deref()), ("error", None));
        assert_eq!((rows[3].outcome.as_str(), rows[3].code.as_deref(), rows[3].client.as_deref()), ("rejected", Some("not-a-tile"), None));
        assert!(!serde_json::to_string(&rows).unwrap().contains("ARGVALUE"));
    }

    #[test]
    fn ring_keeps_the_newest_two_hundred() {
        let log = CallLog::default();
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "list_sessions" } }).to_string();
        for i in 0..250 {
            log.observe(&Caller::Global, &body, None, i);
        }
        let rows = log.recent();
        assert_eq!(rows.len(), CALL_LOG_CAP);
        assert_eq!((rows[0].at_ms, rows[CALL_LOG_CAP - 1].at_ms), (249, 50));
        // 다른 메서드는 쌓지 않는다.
        log.observe(&Caller::Global, &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }).to_string(), None, 999);
        assert_eq!(log.recent()[0].at_ms, 249);
    }

    #[test]
    fn first_sentence_cuts() {
        assert_eq!(first_sentence("Reads **your** run: tasks. Every other tool."), "Reads your run: tasks.");
        assert_eq!(first_sentence("No period here"), "No period here");
        assert!(first_sentence(&"x".repeat(500)).chars().count() <= DESCRIPTION_MAX);
    }
}
