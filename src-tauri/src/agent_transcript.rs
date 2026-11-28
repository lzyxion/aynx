//! **기록 보기** — 지난 대화 하나를 **읽기 전용**으로 펼친다 (docs/log/2026-09-27-conversation-viewer.md).
//!
//! - 생각(Claude `thinking` · Codex `reasoning`)은 내지 않는다 — 도구 호출마다 앞에 서서 기록을 시끄럽게 했다.
//! - 파일은 목록과 같은 색인(`agent_sessions::conversation_file`)으로만 찾는다 — 화면이 넘긴 경로는 받지 않는다.
//! - 대화 파일은 90 MB 까지 자라 통째로 읽지 않는다 — 끝(또는 커서)에서 거꾸로 한 쪽씩. 커서는 줄의 시작이어야 한다(앞 바이트가
//!   `\n`). 대화 파일은 끝에 덧붙기만 하므로 커서는 파일이 자라도 옳다.
//! - 쪽이 찬 뒤에도 보이는 것이 없는 줄은 계속 먹는다 — 그래야 파일 맨 앞의 메타 줄만 남았을 때 "더 있다" 로 잘못 말하지 않는다.
//! - 되감은 대화: Claude 는 버린 갈래의 줄을 빼고([`claude_cut`] — 표지가 없는 기록은 지금 그대로) · Codex 는 되감기 조각을 앞 파일과 이어 읽는다
//!   ([`codex_segments`] — 커서 · 그림 자리는 이은 흐름의 바이트 자리). 사람 말 항목의 `anchor` 는 채팅 타일 되감기의 기준점이다.
//!
//! ## 개인정보 — 화면과 오케스트레이션 조정자에만
//!
//! 본문은 사용자 · 에이전트의 글자다. **화면과 오케스트레이션 조정자**(자기 Run 작업자의 **고정 대화만** — MCP `read_worker`)로만
//! 간다: 로그 · 감사 · 설정 · `Debug` 어디에도 싣지 않고 다른 대화는 MCP 로 나가지 않는다(→ docs/invariants.md 전문 10). 이 모듈의
//! 자료형은 `Debug` 를 파생하지 않는다(패닉 · 로그에 찍히지 않게). 네트워크도 없다(조정자는 루프백 `/mcp` 로 받는다).

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::agent_sessions::{codex_injected, ms_of, SessionTarget};
use crate::i18n::tr;

const CHUNK_BYTES: u64 = 256 * 1024;
/// 한 쪽의 기본 · 최대 항목 수.
const LIMIT_DEFAULT: usize = 40;
const LIMIT_MAX: usize = 200;
const TEXT_MAX_CHARS: usize = 20_000;
const INPUT_MAX_CHARS: usize = 2_000;
const OUTPUT_MAX_CHARS: usize = 4_000;
const SUMMARY_MAX_CHARS: usize = 120;
/// 한 쪽의 글자 합(바이트) — 적어도 한 항목은 싣는다.
const PAGE_MAX_BYTES: usize = 1024 * 1024;
/// 쪽이 찬 뒤 짝(도구 결과의 호출)을 찾으러 더 읽는 줄 수 — 쪽 경계가 짝을 가르지 않게.
const EXTEND_MAX_LINES: usize = 64;
/// 한 번의 호출이 훑는 최대 바이트 — 넘으면 "더 있다".
const SCAN_MAX_BYTES: u64 = 32 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 줄 → 사건
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Speaker {
    User,
    Assistant,
}

/// **`Debug` 없음**(모듈 머리말).
pub(crate) enum Ev {
    /// 글자는 자르지 않은 원문.
    Text {
        who: Speaker,
        text: String,
        images: u32,
    },
    /// `id` 가 비면 결과와 짝을 맞추지 않는다(웹 검색처럼 결과 줄이 없는 것).
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    /// `denied` = 권한에서 거절돼 돌지 않았다.
    ToolResult {
        id: String,
        output: String,
        error: bool,
        denied: bool,
    },
    Interrupted,
    /// 결과 없는 가장 가까운 도구 호출이 권한에서 거절됐다 — Codex 의 `declined` 는 호출 id 와 따로 놀아 차례로만 붙인다. 보이는 항목이 아니다.
    Declined,
    /// Codex 코드 모드가 도구 이름에 쓴 서버 이름(`alias`)의 원래 이름 — 보이는 항목이 아니고 화면 이름만 되돌린다.
    McpServer { alias: String, server: String },
    /// 바로 앞 에이전트 글이 Codex 계획(글 전체를 `<proposed_plan>` 이 감쌌다) — 보이는 항목이 아니다.
    PlanText,
    /// Claude 가 승인된 `ExitPlanMode` 결과 줄에 적은 계획(`toolUseResult.plan`) — 호출 줄 `input.plan` 은 낡은 글일 수 있어 이것만 믿는다.
    PlanApproved { id: String, plan: String, file: Option<String> },
    /// 바로 다음 사람 말의 되감기 기준점(Claude user 줄 `uuid` · Codex 턴 id) — 보이는 항목이 아니다.
    Anchor { id: String },
    /// Codex `item_completed{UserMessage}` 의 턴 id — 바로 앞 사람 말에 기준점이 없을 때만 붙는다. 보이는 항목이 아니다.
    LateAnchor { id: String },
}

pub(crate) type LineEvents = fn(&Value) -> Vec<Ev>;

/// Codex 의 옛 모양은 JSON 문자열 안에 `{"output": …}` 을 싣는다.
fn result_text(v: &Value) -> String {
    match v {
        Value::String(s) => {
            let t = s.trim_start();
            if t.starts_with('{') {
                if let Ok(inner) = serde_json::from_str::<Value>(t) {
                    if let Some(o) = inner.get("output").and_then(Value::as_str) {
                        return o.to_owned();
                    }
                }
            }
            s.clone()
        }
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| match p {
                Value::String(s) => Some(s.as_str()),
                _ => p["text"].as_str(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(m) => m
            .get("output")
            .or_else(|| m.get("content"))
            .map(result_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// 출처가 없는 옛 줄은 도구 표식 · 끊김 표식 · 경고문을 모양으로 거른다(목록의 첫 프롬프트와 같은 판정). `sdk`(stream-json) 줄의
/// 사용자 글은 사람이 보낸 것이다 — 붙여 넣은 XML/HTML · `Caveat:` 도 숨기지 않고 로컬 명령 표식 · 끊김 표식만 거른다.
fn claude_human_text(text: &str, origin: Option<&str>, sdk: bool) -> bool {
    let t = text.trim_start();
    if t.is_empty() {
        return false;
    }
    match origin {
        Some("human") => !t.starts_with("[Request interrupted"),
        Some(_) => false,
        None if sdk => !(t.starts_with("[Request interrupted") || local_command_marker(t)),
        None => {
            !(t.starts_with('<')
                || t.starts_with("[Request interrupted")
                || t.starts_with("Caveat:"))
        }
    }
}

fn interrupt_marker(t: &str) -> bool {
    t.trim_start().starts_with("[Request interrupted")
}

/// `source: user_abort`(사람이 턴을 끊음)는 거절이 아니다 — 그 자리는 끊김 표식이 그린다.
fn claude_denied(v: &Value) -> bool {
    let d = &v["permissionDecision"];
    d["decision"] == "reject" && d["source"] != "user_abort"
}

fn local_command_marker(t: &str) -> bool {
    [
        "<command-name>",
        "<command-message>",
        "<command-args>",
        "<local-command-stdout>",
        "<local-command-stderr>",
        "<local-command-caveat>",
    ]
    .iter()
    .any(|m| t.starts_with(m))
}

pub(crate) fn claude_events(v: &Value) -> Vec<Ev> {
    let ty = v["type"].as_str().unwrap_or("");
    if !matches!(ty, "user" | "assistant") {
        return Vec::new();
    }
    if v["isSidechain"] == true || v["isMeta"] == true || v["isCompactSummary"] == true {
        return Vec::new();
    }
    let content = &v["message"]["content"];
    let mut out = Vec::new();
    if ty == "user" {
        let origin = v["origin"]["kind"].as_str();
        let sdk = origin.is_none() && v["entrypoint"] == "sdk-cli";
        // 기준점은 사람 말 줄만 — 도구 결과 · 끊김 표지 · 로컬 명령 줄은 내지 않는다
        let anchor = |first: &str| {
            v["uuid"].as_str().filter(|u| crate::side_chat::event::uuid_ok(u) && !local_command_marker(first.trim_start())).map(|u| Ev::Anchor { id: u.to_owned() })
        };
        match content {
            Value::String(s) if interrupt_marker(s) => out.push(Ev::Interrupted),
            Value::String(s) => {
                if claude_human_text(s, origin, sdk) {
                    out.extend(anchor(s));
                    out.push(Ev::Text {
                        who: Speaker::User,
                        text: s.clone(),
                        images: 0,
                    });
                }
            }
            Value::Array(parts) => {
                let mut texts: Vec<&str> = Vec::new();
                let mut images = 0u32;
                let mut interrupted = false;
                for p in parts {
                    match p["type"].as_str().unwrap_or("") {
                        "text" if p["text"].as_str().is_some_and(interrupt_marker) => interrupted = true,
                        "text" => {
                            if let Some(t) =
                                p["text"].as_str().filter(|t| claude_human_text(t, origin, sdk))
                            {
                                texts.push(t);
                            }
                        }
                        "image" => images += 1,
                        "tool_result" => {
                            if let Some(id) = p["tool_use_id"].as_str() {
                                let error = p["is_error"] == true;
                                out.push(Ev::ToolResult {
                                    id: id.to_owned(),
                                    output: result_text(&p["content"]),
                                    error,
                                    denied: error && claude_denied(v),
                                });
                            }
                        }
                        _ => {}
                    }
                }
                // `toolUseResult` 는 줄 하나에 하나 — 결과가 둘 이상인 줄은 어느 호출 것인지 모른다
                let results: Vec<&Value> = parts.iter().filter(|p| p["type"] == "tool_result").collect();
                if let ([r], Some(plan)) = (results.as_slice(), v["toolUseResult"]["plan"].as_str()) {
                    if let (false, Some(id)) = (r["is_error"] == true, r["tool_use_id"].as_str()) {
                        out.push(Ev::PlanApproved {
                            id: id.to_owned(),
                            plan: plan.to_owned(),
                            file: v["toolUseResult"]["filePath"].as_str().map(str::to_owned),
                        });
                    }
                }
                // 도구 결과 줄의 이미지는 결과 쪽이라 세지 않는다
                let tool_line = parts.iter().any(|p| p["type"] == "tool_result");
                if !texts.is_empty()
                    || (images > 0 && !tool_line && origin.is_none_or(|k| k == "human"))
                {
                    if !tool_line && !interrupted {
                        out.extend(anchor(texts.first().copied().unwrap_or("")));
                    }
                    out.push(Ev::Text {
                        who: Speaker::User,
                        text: texts.join("\n\n"),
                        images,
                    });
                }
                if interrupted {
                    out.push(Ev::Interrupted);
                }
            }
            _ => {}
        }
        return out;
    }
    let Value::Array(parts) = content else {
        return out;
    };
    for p in parts {
        match p["type"].as_str().unwrap_or("") {
            "text" => {
                if let Some(t) = p["text"].as_str().filter(|t| !t.trim().is_empty()) {
                    out.push(Ev::Text {
                        who: Speaker::Assistant,
                        text: t.to_owned(),
                        images: 0,
                    });
                }
            }
            // 생각(`thinking` · `redacted_thinking`)은 싣지 않는다
            "tool_use" | "server_tool_use" => out.push(Ev::ToolUse {
                id: p["id"].as_str().unwrap_or("").to_owned(),
                name: p["name"].as_str().unwrap_or("").to_owned(),
                input: p["input"].clone(),
            }),
            _ => {}
        }
    }
    out
}

/// 말 · 도구는 `response_item` 만 본다 — `event_msg` 는 같은 말의 사본이다(사본이 아닌 끊김 · 거절 · 만든 그림 · 사람 말의 턴 id 만 거기서 읽는다).
/// 주입된 사용자 몫(환경 · 지침 · AGENTS.md)은 목록의 제목 고르기와 같은 판정으로 건너뛴다.
pub(crate) fn codex_events(v: &Value) -> Vec<Ev> {
    if v["type"] == "event_msg" {
        let pl = &v["payload"];
        return match pl["type"].as_str().unwrap_or("") {
            "turn_aborted" if pl["reason"] == "interrupted" => vec![Ev::Interrupted],
            "item_completed" if pl["item"]["status"] == "declined" => vec![Ev::Declined],
            "item_completed" if pl["item"]["type"] == "UserMessage" => {
                pl["turn_id"].as_str().filter(|t| crate::side_chat::event::uuid_ok(t)).map(|t| Ev::LateAnchor { id: t.to_owned() }).into_iter().collect()
            }
            "item_completed" if pl["item"]["type"] == "McpToolCall" => codex_mcp_alias(&pl["item"]).into_iter().collect(),
            "item_completed" => codex_generated_image(&pl["item"]).into_iter().collect(),
            _ => Vec::new(),
        };
    }
    if v["type"] != "response_item" {
        return Vec::new();
    }
    let pl = &v["payload"];
    let call_id = || pl["call_id"].as_str().unwrap_or("").to_owned();
    let name = || pl["name"].as_str().unwrap_or("").to_owned();
    match pl["type"].as_str().unwrap_or("") {
        "message" => {
            let who = match pl["role"].as_str() {
                Some("user") => Speaker::User,
                Some("assistant") => Speaker::Assistant,
                _ => return Vec::new(),
            };
            let Some(parts) = pl["content"].as_array() else {
                return Vec::new();
            };
            let mut texts: Vec<&str> = Vec::new();
            let mut images = 0u32;
            let mut plans = 0usize;
            for p in parts {
                match p["type"].as_str().unwrap_or("") {
                    "input_text" | "output_text" | "text" => {
                        if let Some(t) = p["text"].as_str().filter(|t| !t.trim().is_empty()) {
                            if who == Speaker::User && codex_injected(t) {
                                continue;
                            }
                            let shown = if who == Speaker::Assistant { strip_proposed_plan(t) } else { t };
                            if shown.len() != t.len() {
                                plans += 1;
                            }
                            texts.push(shown);
                        }
                    }
                    "input_image" => images += 1,
                    _ => {}
                }
            }
            if texts.is_empty() && images == 0 {
                return Vec::new();
            }
            // 글 조각이 모두 계획일 때만 — 보통 답과 섞인 말은 계획 덩어리로 그리지 않는다
            let plan = plans > 0 && plans == texts.len();
            let mut out = Vec::new();
            if who == Speaker::User {
                let turn = pl["internal_chat_message_metadata_passthrough"]["turn_id"].as_str();
                out.extend(turn.filter(|t| crate::side_chat::event::uuid_ok(t)).map(|t| Ev::Anchor { id: t.to_owned() }));
            }
            out.push(Ev::Text {
                who,
                text: texts.join("\n\n"),
                images,
            });
            if plan {
                out.push(Ev::PlanText);
            }
            out
        }
        // `reasoning`(생각)은 싣지 않는다
        "function_call" => {
            let raw = pl["arguments"].as_str().unwrap_or("");
            let input = serde_json::from_str::<Value>(raw)
                .unwrap_or_else(|_| Value::String(raw.to_owned()));
            vec![Ev::ToolUse {
                id: call_id(),
                name: name(),
                input,
            }]
        }
        "custom_tool_call" => {
            let inner = (pl["name"] == "exec").then(|| pl["input"].as_str().and_then(code_mode_call)).flatten();
            let (name, input) = inner.unwrap_or_else(|| (name(), pl["input"].clone()));
            vec![Ev::ToolUse {
                id: call_id(),
                name,
                input,
            }]
        }
        "local_shell_call" => vec![Ev::ToolUse {
            id: call_id(),
            name: "shell".into(),
            input: pl["action"].clone(),
        }],
        "web_search_call" => vec![Ev::ToolUse {
            id: String::new(),
            name: "web_search".into(),
            input: pl["action"].clone(),
        }],
        "function_call_output" | "custom_tool_call_output" | "local_shell_call_output" => {
            if let Some((output, error, denied)) = code_mode_result(&pl["output"]) {
                return vec![Ev::ToolResult { id: call_id(), output, error, denied }];
            }
            vec![Ev::ToolResult {
                id: call_id(),
                output: result_text(&pl["output"]),
                error: false,
                denied: false,
            }]
        }
        _ => Vec::new(),
    }
}

/// Codex 계획 모드의 답은 롤아웃에 `<proposed_plan>` 으로 감싼 글로 남는다 — **글 전체가 그 한 쌍(꼬리표는 제 줄)일 때만** 꼬리표를 걷는다.
/// 일부만 감싼 글 · 꼬리표를 말하는 글은 그대로다.
fn strip_proposed_plan(t: &str) -> &str {
    const OPEN: &str = "<proposed_plan>";
    const CLOSE: &str = "</proposed_plan>";
    let s = t.trim();
    let Some(inner) = s.strip_prefix(OPEN).and_then(|r| r.strip_suffix(CLOSE)) else { return t };
    if inner.contains(OPEN) || inner.contains(CLOSE) {
        return t;
    }
    let Some(inner) = inner.strip_prefix("\r\n").or_else(|| inner.strip_prefix('\n')) else { return t };
    let Some(inner) = inner.strip_suffix("\r\n").or_else(|| inner.strip_suffix('\n')) else { return t };
    if inner.trim().is_empty() {
        return t;
    }
    inner
}

// ---------------------------------------------------------------------------
// Codex 코드 모드 — `exec` 도구가 JS 한 조각으로 안쪽 도구를 부른다
// ---------------------------------------------------------------------------

const CODE_MODE_MAX_CHARS: usize = 64 * 1024;

/// 코드 모드의 도구 이름은 서버 이름의 `[A-Za-z0-9_]` 밖 글자를 `_` 로 바꾼 꼴이다(실측 `aynx-sessions-dev` → `aynx_sessions_dev`).
fn codex_mcp_alias(item: &Value) -> Option<Ev> {
    let server = item["server"].as_str().filter(|s| !s.is_empty())?;
    let alias: String = server.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    (alias != server).then(|| Ev::McpServer { alias, server: server.to_owned() })
}

/// 실시간 줄(`side_chat::codex` 의 `command` · 줄을 이은 명령)과 같은 이름표 — 코드 모드 · 함수 호출의 `exec_command` 만.
fn shown_tool(name: String, input: &Value) -> (String, String) {
    match input["cmd"].as_str() {
        Some(cmd) if name == "exec_command" => {
            let joined = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
            let summary = match cap(&joined, SUMMARY_MAX_CHARS) {
                (t, true) => format!("{}…", t.trim_end()),
                (t, false) => t,
            };
            ("command".to_owned(), summary)
        }
        _ => {
            let summary = tool_summary(input);
            (name, summary)
        }
    }
}

/// 같은 alias 를 두 서버가 쓰면 되돌리지 않는다(`None`).
fn unalias_mcp(name: &str, aliases: &HashMap<String, Option<String>>) -> Option<String> {
    let rest = name.strip_prefix("mcp__")?;
    let (alias, tool) = rest.split_once("__")?;
    let server = aliases.get(alias)?.as_deref()?;
    Some(format!("mcp__{server}__{tool}"))
}

/// `tools.<이름>(<리터럴>)` 이 **딱 하나**인 조각만 그 도구 호출로 푼다 — 둘 이상이거나 리터럴이 아니면 `None`(조각 그대로 보인다).
fn code_mode_call(src: &str) -> Option<(String, Value)> {
    if src.chars().count() > CODE_MODE_MAX_CHARS || src.matches("tools.").count() != 1 {
        return None;
    }
    let at = src.find("tools.")? + "tools.".len();
    let rest = &src[at..];
    let name_len = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$')).unwrap_or(rest.len());
    let name = &rest[..name_len];
    if name.is_empty() {
        return None;
    }
    let cs: Vec<char> = rest[name_len..].chars().collect();
    let mut i = 0;
    js_ws(&cs, &mut i);
    if cs.get(i) != Some(&'(') {
        return None;
    }
    i += 1;
    js_ws(&cs, &mut i);
    let input = if cs.get(i) == Some(&')') { Value::Object(Default::default()) } else { js_value(&cs, &mut i, 0)? };
    js_ws(&cs, &mut i);
    (cs.get(i) == Some(&')')).then(|| (name.to_owned(), input))
}

fn js_ws(cs: &[char], i: &mut usize) {
    while cs.get(*i).is_some_and(|c| c.is_whitespace()) {
        *i += 1;
    }
}

/// JSON 보다 너그러운 리터럴만 — 따옴표 없는 열쇠 · 홑따옴표 · `${}` 없는 백틱 · 끝 쉼표. 식 · 변수는 `None`.
fn js_value(cs: &[char], i: &mut usize, depth: u32) -> Option<Value> {
    if depth > 32 {
        return None;
    }
    js_ws(cs, i);
    match *cs.get(*i)? {
        '{' => {
            *i += 1;
            let mut m = serde_json::Map::new();
            loop {
                js_ws(cs, i);
                match *cs.get(*i)? {
                    '}' => {
                        *i += 1;
                        return Some(Value::Object(m));
                    }
                    q @ ('"' | '\'' | '`') => {
                        *i += 1;
                        let k = js_string(cs, i, q)?;
                        m.insert(k, js_field(cs, i, depth)?);
                    }
                    c if c.is_ascii_alphabetic() || c == '_' || c == '$' => {
                        let s = *i;
                        while cs.get(*i).is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$') {
                            *i += 1;
                        }
                        let k: String = cs[s..*i].iter().collect();
                        m.insert(k, js_field(cs, i, depth)?);
                    }
                    _ => return None,
                }
                js_ws(cs, i);
                match *cs.get(*i)? {
                    ',' => *i += 1,
                    '}' => {}
                    _ => return None,
                }
            }
        }
        '[' => {
            *i += 1;
            let mut a = Vec::new();
            loop {
                js_ws(cs, i);
                if *cs.get(*i)? == ']' {
                    *i += 1;
                    return Some(Value::Array(a));
                }
                a.push(js_value(cs, i, depth + 1)?);
                js_ws(cs, i);
                match *cs.get(*i)? {
                    ',' => *i += 1,
                    ']' => {}
                    _ => return None,
                }
            }
        }
        q @ ('"' | '\'' | '`') => {
            *i += 1;
            js_string(cs, i, q).map(Value::String)
        }
        _ => {
            let s = *i;
            while cs.get(*i).is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')) {
                *i += 1;
            }
            let word: String = cs[s..*i].iter().collect();
            match word.as_str() {
                "true" => Some(Value::Bool(true)),
                "false" => Some(Value::Bool(false)),
                "null" | "undefined" => Some(Value::Null),
                w => serde_json::from_str::<serde_json::Number>(w).ok().map(Value::Number),
            }
        }
    }
}

fn js_field(cs: &[char], i: &mut usize, depth: u32) -> Option<Value> {
    js_ws(cs, i);
    if cs.get(*i) != Some(&':') {
        return None;
    }
    *i += 1;
    js_value(cs, i, depth + 1)
}

/// 여는 따옴표 다음부터 — 닫는 따옴표 뒤에 선다.
fn js_string(cs: &[char], i: &mut usize, q: char) -> Option<String> {
    let mut out = String::new();
    loop {
        let c = *cs.get(*i)?;
        *i += 1;
        match c {
            c if c == q => return Some(out),
            '$' if q == '`' && cs.get(*i) == Some(&'{') => return None,
            '\\' => {
                let e = *cs.get(*i)?;
                *i += 1;
                match e {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    'r' => out.push('\r'),
                    'b' => out.push('\u{8}'),
                    'f' => out.push('\u{c}'),
                    'v' => out.push('\u{b}'),
                    '0' => out.push('\0'),
                    '\n' => {}
                    'x' => {
                        let h: String = cs.get(*i..*i + 2)?.iter().collect();
                        *i += 2;
                        out.push(char::from_u32(u32::from_str_radix(&h, 16).ok()?)?);
                    }
                    'u' => {
                        let h: String = if cs.get(*i) == Some(&'{') {
                            let end = cs[*i..].iter().position(|c| *c == '}')? + *i;
                            let h = cs[*i + 1..end].iter().collect();
                            *i = end + 1;
                            h
                        } else {
                            let h = cs.get(*i..*i + 4)?.iter().collect();
                            *i += 4;
                            h
                        };
                        let n = u32::from_str_radix(&h, 16).ok()?;
                        // 대리 쌍은 뒤 반쪽과 합친다
                        if (0xD800..0xDC00).contains(&n) && cs.get(*i) == Some(&'\\') && cs.get(*i + 1) == Some(&'u') {
                            let lo: String = cs.get(*i + 2..*i + 6)?.iter().collect();
                            let lo = u32::from_str_radix(&lo, 16).ok()?;
                            *i += 6;
                            out.push(char::from_u32(0x10000 + ((n - 0xD800) << 10) + (lo.checked_sub(0xDC00)?))?);
                        } else {
                            out.push(char::from_u32(n).unwrap_or('\u{fffd}'));
                        }
                    }
                    other => out.push(other),
                }
            }
            c => out.push(c),
        }
    }
}

/// `exec` 결과(`Script completed|failed` 머리 + 조각들) → (출력, 오류, 사람이 거절). 안쪽 명령의 JSON 결과는 `output` 만.
fn code_mode_result(v: &Value) -> Option<(String, bool, bool)> {
    let parts: Vec<&str> = v.as_array()?.iter().filter_map(|p| p["text"].as_str()).collect();
    let head = *parts.first()?;
    let failed = head.starts_with("Script failed");
    if !failed && !head.starts_with("Script completed") {
        return None;
    }
    let mut out: Vec<String> = Vec::new();
    for p in &parts[1..] {
        let t = p.trim_start();
        let inner = t.starts_with('{').then(|| serde_json::from_str::<Value>(t).ok()).flatten();
        let mcp = inner.as_ref().and_then(|j| j["content"].as_array()).map(|cs| {
            cs.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")
        });
        match (inner.as_ref().and_then(|j| j["output"].as_str()), mcp) {
            (Some(o), _) => out.push(o.to_owned()),
            (None, Some(t)) => out.push(t),
            (None, None) => out.push((*p).to_owned()),
        }
    }
    let exit_bad = parts[1..].iter().any(|p| {
        serde_json::from_str::<Value>(p.trim_start()).ok().and_then(|j| j["exit_code"].as_i64()).is_some_and(|c| c != 0)
    });
    // Codex 가 사람의 거절을 적는 글 — `Rejected("rejected by user")`
    let denied = parts.iter().any(|p| p.contains("rejected by user"));
    Some((out.join("\n"), failed || exit_bad, denied))
}

/// 만든 그림 → 에이전트 말 `![지시문](savedPath)`(사이드 채팅 실시간 `side_chat::event::image_markdown` 과 같은 글자). 그림
/// 바이트(`result` base64)는 읽지 않는다.
fn codex_generated_image(item: &Value) -> Option<Ev> {
    if item["type"] != "Extension" || item["kind"] != "image_gen.generation" || item["status"] != "completed" {
        return None;
    }
    let path = item["savedPath"].as_str().filter(|p| !p.trim().is_empty())?;
    let prompt = item["revisedPrompt"].as_str().unwrap_or("");
    Some(Ev::Text {
        who: Speaker::Assistant,
        text: crate::side_chat::event::image_markdown(prompt, path),
        images: 0,
    })
}

// ---------------------------------------------------------------------------
// 말에 붙은 그림 — 쪽에는 자리만, 바이트는 한 장씩
// ---------------------------------------------------------------------------

/// 화면 그림(`doc-images.ts` 의 `DOC_IMAGE_MAX_BYTES`)과 같은 10 MB.
const IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;
const IMAGE_LINE_MAX_BYTES: u64 = 48 * 1024 * 1024;

/// 줄 파서가 세는 차례 그대로. 두 모양은 겹치지 않아 에이전트를 가리지 않는다.
fn image_parts(v: &Value) -> Vec<&Value> {
    let (parts, kind) = if v["type"] == "user" {
        (&v["message"]["content"], "image")
    } else if v["type"] == "response_item" && v["payload"]["type"] == "message" {
        (&v["payload"]["content"], "input_image")
    } else {
        return Vec::new();
    };
    parts
        .as_array()
        .map(|ps| ps.iter().filter(|p| p["type"] == kind).collect())
        .unwrap_or_default()
}

fn image_mime(m: &str) -> Option<&'static str> {
    match m.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

fn inline_image(p: &Value) -> Option<(&'static str, &str)> {
    if p["source"]["type"] == "base64" {
        let mime = image_mime(p["source"]["media_type"].as_str()?)?;
        return Some((mime, p["source"]["data"].as_str()?));
    }
    let url = p["image_url"].as_str()?.strip_prefix("data:")?;
    let (head, data) = url.split_once(',')?;
    let mime = image_mime(head.strip_suffix(";base64")?)?;
    Some((mime, data))
}

/// 바이트는 싣지 않는다 — 화면이 [`agent_conversation_image`] 로 한 장씩 받는다. **`Debug` 없음**.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptImage {
    pub at: u64,
    pub len: u64,
    pub n: u32,
    pub mime: &'static str,
}

pub(crate) fn image_line_max() -> u64 {
    IMAGE_LINE_MAX_BYTES
}

fn line_images(v: &Value, at: u64, len: u64) -> Vec<TranscriptImage> {
    if len > IMAGE_LINE_MAX_BYTES {
        return Vec::new();
    }
    image_parts(v)
        .into_iter()
        .enumerate()
        .filter_map(|(n, p)| {
            let (mime, _) = inline_image(p)?;
            Some(TranscriptImage { at, len, n: n as u32, mime })
        })
        .collect()
}

/// 자리가 줄 하나와 꼭 맞아야 한다(쪽 커서와 같은 검사) — 로컬 · 원격이 같다.
pub(crate) fn image_in_window(
    size: u64,
    start: u64,
    data: &[u8],
    at: u64,
    len: u64,
    n: u32,
) -> Result<Vec<u8>, String> {
    let bad = || tr!(ko: "그 그림을 기록에서 찾지 못했습니다", en: "Could not find that image in the transcript");
    let end = at.checked_add(len).ok_or_else(bad)?;
    if len == 0 || len > IMAGE_LINE_MAX_BYTES || end > size || start > at.saturating_sub(1) {
        return Err(bad());
    }
    let byte = |i: u64| i.checked_sub(start).and_then(|o| data.get(o as usize)).copied();
    if at > 0 && byte(at - 1) != Some(b'\n') {
        return Err(bad());
    }
    if end < size && byte(end) != Some(b'\n') {
        return Err(bad());
    }
    let line = data.get((at - start) as usize..(end - start) as usize).ok_or_else(bad)?;
    let v: Value = serde_json::from_slice(line).map_err(|_| bad())?;
    let parts = image_parts(&v);
    let (_, b64) = parts.get(n as usize).and_then(|p| inline_image(p)).ok_or_else(bad)?;
    if b64.len() / 4 * 3 > IMAGE_MAX_BYTES + 3 {
        return Err(tr!(ko: "그림이 너무 큽니다", en: "The image is too large"));
    }
    let bytes = data_encoding::BASE64.decode(b64.trim().as_bytes()).map_err(|_| bad())?;
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err(tr!(ko: "그림이 너무 큽니다", en: "The image is too large"));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// 요약 · 자르기
// ---------------------------------------------------------------------------

/// `n` 자(유니코드 스칼라)에서 자른다.
fn cap(s: &str, n: usize) -> (String, bool) {
    match s.char_indices().nth(n) {
        Some((i, _)) => (s[..i].to_owned(), true),
        None => (s.to_owned(), false),
    }
}

fn first_line(s: &str) -> String {
    let line = s
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let joined = line.split_whitespace().collect::<Vec<_>>().join(" ");
    match cap(&joined, SUMMARY_MAX_CHARS) {
        (t, true) => format!("{}…", t.trim_end()),
        (t, false) => t,
    }
}

fn argv_line(arr: &[Value]) -> String {
    let parts: Vec<&str> = arr.iter().filter_map(Value::as_str).collect();
    let shellish = parts.len() >= 3
        && matches!(
            parts[parts.len() - 2],
            "-lc" | "-c" | "/c" | "/C" | "-Command"
        );
    if shellish {
        parts[parts.len() - 1].to_owned()
    } else {
        parts.join(" ")
    }
}

/// 앞의 것이 이긴다.
const SUMMARY_KEYS: &[&str] = &[
    "command",
    "cmd",
    "file_path",
    "notebook_path",
    "path",
    "pattern",
    "url",
    "query",
    "description",
    "prompt",
    "skill",
    "cell_id",
];

pub(crate) fn tool_summary(input: &Value) -> String {
    match input {
        Value::Object(m) => {
            for k in SUMMARY_KEYS {
                match m.get(*k) {
                    Some(Value::String(s)) if !s.trim().is_empty() => return first_line(s),
                    Some(Value::Array(a)) if !a.is_empty() => return first_line(&argv_line(a)),
                    _ => {}
                }
            }
            String::new()
        }
        Value::String(s) => {
            let files: Vec<&str> = s
                .lines()
                .filter_map(|l| {
                    ["*** Update File: ", "*** Add File: ", "*** Delete File: "]
                        .iter()
                        .find_map(|p| l.strip_prefix(p))
                })
                .map(str::trim)
                .collect();
            if files.is_empty() {
                first_line(s)
            } else {
                first_line(&files.join(", "))
            }
        }
        _ => String::new(),
    }
}

fn tool_input_text(input: &Value) -> String {
    match input {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Object(m) => {
            for k in ["command", "cmd"] {
                match m.get(k) {
                    Some(Value::String(s)) if m.len() <= 3 => return s.clone(),
                    Some(Value::Array(a)) if m.len() <= 3 => return argv_line(a),
                    _ => {}
                }
            }
            serde_json::to_string_pretty(input).unwrap_or_default()
        }
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// 화면이 받는 모양
// ---------------------------------------------------------------------------

/// **`Debug` 없음**.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// 비었으면 호출을 못 만난 결과다.
    pub name: String,
    pub summary: String,
    pub input: Option<String>,
    pub input_truncated: bool,
    pub output: Option<String>,
    pub output_truncated: bool,
    pub error: bool,
    /// 화면의 "거절됨" — `error` 보다 앞선다.
    pub denied: bool,
}

/// `role` — `user` · `assistant` · `tool` · `interrupted`(끊긴 턴 — 글 없음). **`Debug` 없음**.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub role: &'static str,
    pub text: Option<String>,
    pub truncated: bool,
    pub images: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pictures: Vec<TranscriptImage>,
    pub tool: Option<ToolCall>,
    /// epoch ms
    pub at: Option<i64>,
    /// 사람 말 맨 앞의 앱 연결 머리글을 걷고 남긴 연결 — 글에서는 걷혔다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<crate::side_chat::event::LinkNote>,
    /// 표시용 — 화면이 그 앨범의 `wakes` 기록(SHA)과 맞출 때만 "앱이 깨움" 표지가 된다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake: Option<crate::orchestration::wake::WakeTag>,
    /// 앱 프로듀서 지침 머리글을 걷었다 — 글에는 사람이 친 글만 남는다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub brief: bool,
    /// 맨 끝의 파일 첨부 꼬리에서 읽은 파일 이름 — 글에서는 걷혔다.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// 계획 표지 — Codex 계획 글(`assistant` · 본문은 `text`) · Claude `ExitPlanMode` 호출(`tool`). 화면에 따라 덩어리로 그린다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<PlanTag>,
    /// 되감기 기준점 — 사람 말 줄만. Claude = 그 user 줄 `uuid` · Codex = 그 말의 턴 id. 화면이 `chat_tile_rewind` 에 그대로 돌려준다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
}

/// 계획 줄의 덧칸 — **`Debug` 없음**. Claude 본문은 믿을 수 있는 출처에서만 채운다(`settle_plans`) — 없으면 경로 · 결과만.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanTag {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub body_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// `approved` · `kept`(사람이 계속 계획을 골랐다) — 결과가 없거나 끊겼으면 없다
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<&'static str>,
    /// 계속 계획에 사람이 쓴 고칠 점 — 앱 기본 글은 싣지 않는다
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
}

/// `cursor` 가 있으면 더 오래된 것이 있다(다음 호출의 `before`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub items: Vec<TranscriptItem>,
    pub cursor: Option<u64>,
    /// 최신 쪽에서만 · **표시 전용** — 화면은 이 글자를 터미널에 보내지 않는다(보내는 글은 고정 허용 목록의 낱말뿐 — `pane/flip-model.ts`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last: Option<LastModel>,
}

/// Claude = `type:"assistant"` 줄의 `message.model` · 같은 줄 최상위 `effort`, Codex = `type:"turn_context"` 의 `payload.model` · `payload.effort`.
#[derive(Serialize, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Debug))]
pub struct LastModel {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// 그 값을 실은 줄의 파일 안 바이트 자리 — 화면이 "덮어 둔 값 뒤에 새 답이 남았나" 를 이것으로만 가린다.
    pub at: u64,
}

const MODEL_MAX_CHARS: usize = 80;

pub(crate) fn line_model(v: &Value, at: u64) -> Option<LastModel> {
    let short = |s: &str| (s.chars().count() <= MODEL_MAX_CHARS).then(|| s.to_owned());
    let (model, effort) = match v["type"].as_str()? {
        "assistant" if v["isSidechain"] != true => (&v["message"]["model"], &v["effort"]),
        "turn_context" => (&v["payload"]["model"], &v["payload"]["effort"]),
        _ => return None,
    };
    let model = crate::agent_sessions::str_of(model).filter(|m| !m.starts_with('<')).and_then(short)?;
    let effort = crate::agent_sessions::str_of(effort).and_then(short);
    Some(LastModel { model, effort, at })
}

// ---------------------------------------------------------------------------
// 거꾸로 읽기
// ---------------------------------------------------------------------------

struct RevLines<R: Read + Seek> {
    f: R,
    /// `buf` 는 `[pos, pos + buf.len())` 이다.
    pos: u64,
    buf: Vec<u8>,
    done: bool,
    read: u64,
}

impl<R: Read + Seek> RevLines<R> {
    fn new(f: R, end: u64) -> Self {
        RevLines {
            f,
            pos: end,
            buf: Vec::new(),
            done: false,
            read: 0,
        }
    }

    fn next_line(&mut self) -> std::io::Result<Option<(u64, Vec<u8>)>> {
        loop {
            if let Some(i) = self.buf.iter().rposition(|b| *b == b'\n') {
                let line = self.buf.split_off(i + 1);
                self.buf.truncate(i);
                return Ok(Some((self.pos + i as u64 + 1, line)));
            }
            if self.pos == 0 {
                if self.done {
                    return Ok(None);
                }
                self.done = true;
                return Ok(Some((0, std::mem::take(&mut self.buf))));
            }
            let n = CHUNK_BYTES.min(self.pos);
            self.pos -= n;
            self.f.seek(SeekFrom::Start(self.pos))?;
            let mut chunk = vec![0u8; n as usize];
            self.f.read_exact(&mut chunk)?;
            self.read += n;
            chunk.extend_from_slice(&self.buf);
            self.buf = chunk;
        }
    }
}

struct LineOut {
    at: Option<i64>,
    evs: Vec<Ev>,
    pics: Vec<TranscriptImage>,
}

fn counts(e: &Ev) -> bool {
    !matches!(
        e,
        Ev::ToolResult { .. } | Ev::Declined | Ev::McpServer { .. } | Ev::PlanText | Ev::PlanApproved { .. } | Ev::Anchor { .. } | Ev::LateAnchor { .. }
    )
}

fn weight(e: &Ev) -> usize {
    match e {
        Ev::Text { text, .. } => text.len().min(TEXT_MAX_CHARS * 4),
        Ev::ToolUse { input, .. } => 64 + input.to_string().len().min(INPUT_MAX_CHARS * 4),
        Ev::ToolResult { output, .. } => output.len().min(OUTPUT_MAX_CHARS * 4),
        Ev::PlanApproved { plan, .. } => plan.len().min(TEXT_MAX_CHARS * 4),
        Ev::Interrupted | Ev::Declined | Ev::McpServer { .. } | Ev::PlanText | Ev::Anchor { .. } | Ev::LateAnchor { .. } => 16,
    }
}

fn read_page_from<R: Read + Seek>(
    f: R,
    size: u64,
    before: Option<u64>,
    limit: usize,
    parse: LineEvents,
) -> Result<TranscriptPage, String> {
    read_page_in(f, size, before, limit, parse, &HashSet::new())
}

/// `cut` = 되감기로 버려진 갈래의 줄 `uuid`([`claude_cut`]) — 그 줄은 빈 줄처럼 건너뛴다.
fn read_page_in<R: Read + Seek>(
    mut f: R,
    size: u64,
    before: Option<u64>,
    limit: usize,
    parse: LineEvents,
    cut: &HashSet<String>,
) -> Result<TranscriptPage, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    let end = match before {
        None => size,
        Some(0) => {
            return Ok(TranscriptPage {
                items: Vec::new(),
                cursor: None,
                last: None,
            })
        }
        Some(b) => {
            let bad = || tr!(ko: "기록 위치가 올바르지 않습니다", en: "The transcript position is invalid");
            if b > size {
                return Err(bad());
            }
            let mut one = [0u8; 1];
            f.seek(SeekFrom::Start(b - 1)).map_err(io)?;
            f.read_exact(&mut one).map_err(io)?;
            if one[0] != b'\n' {
                return Err(bad());
            }
            b
        }
    };
    let limit = limit.clamp(1, LIMIT_MAX);
    let mut rev = RevLines::new(f, end);
    let mut lines: Vec<LineOut> = Vec::new();
    let mut shown = 0usize;
    let mut bytes = 0usize;
    let mut orphans: HashSet<String> = HashSet::new();
    let mut extra = 0usize;
    let mut cursor = end;
    let mut more = false;
    let latest = before.is_none();
    let mut last: Option<LastModel> = None;
    while let Some((off, raw)) = rev.next_line().map_err(io)? {
        if raw.iter().all(u8::is_ascii_whitespace) {
            cursor = off;
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&raw) else {
            cursor = off;
            continue;
        };
        if !cut.is_empty() && v["uuid"].as_str().is_some_and(|u| cut.contains(u)) {
            cursor = off;
            continue;
        }
        if latest && last.is_none() {
            last = line_model(&v, off);
        }
        let evs = parse(&v);
        let has_content = !evs.is_empty();
        // 늦은 기준점만 든 줄은 쪽을 끊지 않는다 — 그 줄이 없던 때와 커서가 같다
        let stops = evs.iter().any(|e| !matches!(e, Ev::LateAnchor { .. }));
        let full = shown >= limit || (bytes >= PAGE_MAX_BYTES && shown > 0);
        if full && stops && (orphans.is_empty() || extra >= EXTEND_MAX_LINES) {
            more = true;
            break;
        }
        if rev.read > SCAN_MAX_BYTES && shown > 0 {
            more = true;
            break;
        }
        cursor = off;
        if !has_content {
            continue;
        }
        if full && stops {
            extra += 1;
        }
        for e in &evs {
            match e {
                Ev::ToolResult { id, .. } if !id.is_empty() => {
                    orphans.insert(id.clone());
                }
                Ev::ToolUse { id, .. } => {
                    orphans.remove(id);
                }
                _ => {}
            }
            if counts(e) {
                shown += 1;
            }
            bytes += weight(e);
        }
        let pics = if evs.iter().any(|e| matches!(e, Ev::Text { images, .. } if *images > 0)) {
            line_images(&v, off, raw.len() as u64)
        } else {
            Vec::new()
        };
        lines.push(LineOut {
            at: ms_of(&v["timestamp"]),
            evs,
            pics,
        });
    }
    lines.reverse();
    let items = assemble(lines);
    Ok(TranscriptPage {
        items,
        cursor: (more && cursor > 0).then_some(cursor),
        last,
    })
}

/// Windows 는 소문자 — 대소문자를 가리지 않는 파일 시스템.
fn norm_path(p: &str) -> String {
    let s = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// AI 타일 대화 면이 글 앞에 붙여 넣은 첨부 경로를 걷는다 — 프런트 `tileAttachPastes`(`shellQuote(경로) + " "`)의 꼴이고 앱 첨부
/// 자리 바로 아래 `<64자 hex>/<이름>` 일 때만. 다른 폴더 · 상대 경로 · 글 가운데의 경로는 그대로 글이다.
fn strip_attach_paths(text: &str, root: &str) -> Option<(Vec<String>, String)> {
    let mut names = Vec::new();
    // 그림 자리표는 남기고 넘어간다(칩 차례가 그림 → 파일일 수 있다)
    let mut kept = String::new();
    let mut rest = text;
    loop {
        if let Some(after) = image_placeholder(rest) {
            kept.push_str(&rest[..rest.len() - after.len()]);
            rest = after;
            continue;
        }
        let (token, after) = match rest.as_bytes().first() {
            Some(q @ (b'"' | b'\'')) => {
                let q = *q as char;
                let Some(end) = rest[1..].find(q).map(|i| i + 1) else { break };
                (&rest[1..end], &rest[end + 1..])
            }
            Some(_) => {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                (&rest[..end], &rest[end..])
            }
            None => break,
        };
        let Some(name) = attach_name(token, root) else { break };
        let next = match after.strip_prefix(' ') {
            Some(n) => n,
            None if after.is_empty() => after,
            None => break,
        };
        names.push(name);
        rest = next;
    }
    (!names.is_empty()).then(|| (names, kept + rest))
}

fn image_placeholder(s: &str) -> Option<&str> {
    let body = s.strip_prefix("[Image #")?;
    let digits = body.bytes().take_while(u8::is_ascii_digit).count();
    let after = body[digits..].strip_prefix(']').filter(|_| digits > 0)?;
    after.strip_prefix(' ').or((after.is_empty()).then_some(after))
}

/// 사이드 채팅 그림 판정과 같은 표.
fn is_image_name(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
}

fn attach_name(path: &str, root: &str) -> Option<String> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return None;
    }
    let n = norm_path(path);
    let tail = n.strip_prefix(root)?.strip_prefix('/')?;
    let (dir, name) = tail.split_once('/')?;
    let hex = dir.len() == 64 && dir.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    // 이름은 원래 글자에서(소문자로 바꾸기 전)
    let raw = path.rsplit(['\\', '/']).next()?;
    (hex && !name.is_empty() && !name.contains('/')).then(|| raw.to_string())
}

fn assemble(lines: Vec<LineOut>) -> Vec<TranscriptItem> {
    // 서버가 아는 실제 경로 — 화면이 준 것이 아니다
    let attach_root = crate::agent_attachments::attachments_root().ok().map(|p| norm_path(&p.to_string_lossy()));
    let mut items: Vec<TranscriptItem> = Vec::new();
    let mut calls: HashMap<String, usize> = HashMap::new();
    let mut aliases: HashMap<String, Option<String>> = HashMap::new();
    let mut plans = PlanTrack::default();
    // Codex 코드 모드 — 오래 도는 `exec` 는 "cell ID N" 만 돌려주고, 결과(사람의 거절 포함)는 뒤의 `wait{cell_id}` 가 받는다
    let mut cells: HashMap<String, usize> = HashMap::new();
    let mut waits: HashMap<String, String> = HashMap::new();
    let mut next_anchor: Option<String> = None;
    for LineOut { at, evs, mut pics } in lines {
        for e in evs {
            match e {
                Ev::PlanText => {
                    if let Some(last) = items.last_mut().filter(|i| i.role == "assistant") {
                        last.plan = Some(PlanTag::default());
                    }
                }
                Ev::PlanApproved { id, plan, file } => {
                    plans.approved.insert(id, (plan, file));
                }
                Ev::Text { who, text, images } => {
                    // 그림이 붙은 말은 줄에 하나뿐이다 — 그 말이 줄의 그림 자리를 가져간다
                    let pictures = if images > 0 { std::mem::take(&mut pics) } else { Vec::new() };
                    let wake = (who == Speaker::User).then(|| crate::orchestration::wake::parse_wake_note(&text)).flatten();
                    let briefed = (who == Speaker::User).then(|| crate::side_chat::event::parse_producer_brief(&text).map(str::to_owned)).flatten();
                    let brief = briefed.is_some();
                    let text = briefed.unwrap_or(text);
                    // 파일 첨부 꼬리는 연결 머리글보다 먼저 걷는다 — 머리글만 있는 글의 `] ` 가 꼬리 앞에 남는다
                    // 사이드 채팅 사본(`…/attachments/<이름>`) 또는 채팅 타일의 앱 첨부 자리(`<root>/<64hex>/<이름>`) — 같은 꼬리 꼴만
                    let refs = (who == Speaker::User)
                        .then(|| {
                            use crate::side_chat::event::{parse_file_refs, parse_file_refs_by};
                            parse_file_refs(&text)
                                .or_else(|| attach_root.as_deref().and_then(|r| parse_file_refs_by(&text, |p| attach_name(p, r))))
                                .map(|(n, b)| (n, b.to_owned()))
                        })
                        .flatten();
                    let (mut files, text) = match refs {
                        Some((names, body)) => (names, body),
                        None => (Vec::new(), text),
                    };
                    // 그림 말이면 그림 경로는 칩 없이 걷기만 — 기록의 그림 블록이 `pictures` 로 그린다
                    let text = match (who == Speaker::User).then(|| attach_root.as_deref().and_then(|r| strip_attach_paths(&text, r))).flatten() {
                        Some((names, body)) => {
                            files.extend(names.into_iter().filter(|n| images == 0 || !is_image_name(n)));
                            body
                        }
                        None => text,
                    };
                    let note = (who == Speaker::User).then(|| crate::side_chat::event::parse_link_note(&text)).flatten();
                    let (link, text) = match note {
                        Some((link, rest)) => (Some(link), rest.to_owned()),
                        None => (None, text),
                    };
                    let (text, truncated) = cap(&text, TEXT_MAX_CHARS);
                    let anchor = next_anchor.take().filter(|_| who == Speaker::User);
                    items.push(TranscriptItem {
                        role: if who == Speaker::User {
                            "user"
                        } else {
                            "assistant"
                        },
                        text: Some(text),
                        truncated,
                        images,
                        pictures,
                        tool: None,
                        at,
                        link,
                        wake,
                        brief,
                        files,
                        plan: None,
                        anchor,
                    });
                }
                Ev::ToolUse { id, name, input } => {
                    let text = tool_input_text(&input);
                    let (input_text, input_truncated) = cap(&text, INPUT_MAX_CHARS);
                    let plan = plans.on_call(&id, &name, &input, items.len());
                    if name == "wait" {
                        let cell = input["cell_id"].as_str().map(str::to_owned).or_else(|| input["cell_id"].as_u64().map(|n| n.to_string()));
                        if let (Some(cell), false) = (cell, id.is_empty()) {
                            waits.insert(id.clone(), cell);
                        }
                    }
                    if !id.is_empty() {
                        calls.insert(id, items.len());
                    }
                    let name = unalias_mcp(&name, &aliases).unwrap_or(name);
                    let (name, summary) = shown_tool(name, &input);
                    items.push(TranscriptItem {
                        role: "tool",
                        text: None,
                        truncated: false,
                        images: 0,
                        pictures: Vec::new(),
                        tool: Some(ToolCall {
                            name,
                            summary,
                            input: (!input_text.trim().is_empty()).then_some(input_text),
                            input_truncated,
                            output: None,
                            output_truncated: false,
                            error: false,
                            denied: false,
                        }),
                        at,
                        link: None,
                        wake: None,
                        brief: false,
                        files: Vec::new(),
                        plan,
                        anchor: None,
                    });
                }
                Ev::ToolResult { id, output, error, denied } => {
                    plans.results.insert(id.clone(), error);
                    if let (Some(cell), Some(&at_call)) = (output.strip_prefix(CELL_RUNNING).and_then(|r| r.split_whitespace().next()), calls.get(&id)) {
                        cells.insert(cell.to_owned(), at_call);
                    }
                    // 기다린 명령의 거절 — 그 명령 줄에 단다(기다리는 줄이 가로채지 않게)
                    let waited = waits.get(&id).and_then(|c| cells.get(c)).copied().filter(|_| denied);
                    let denied = denied && waited.is_none();
                    if let Some(t) = waited.and_then(|i| items.get_mut(i)).and_then(|i| i.tool.as_mut()) {
                        t.denied = true;
                    }
                    let (out, output_truncated) = cap(&output, OUTPUT_MAX_CHARS);
                    let slot = calls
                        .get(&id)
                        .and_then(|i| items.get_mut(*i))
                        .and_then(|i| i.tool.as_mut());
                    match slot {
                        Some(t) if t.output.is_none() => {
                            t.output = Some(out);
                            t.output_truncated = output_truncated;
                            t.error = error;
                            t.denied |= denied;
                        }
                        _ => items.push(TranscriptItem {
                            role: "tool",
                            text: None,
                            truncated: false,
                            images: 0,
                            pictures: Vec::new(),
                            tool: Some(ToolCall {
                                name: String::new(),
                                summary: String::new(),
                                input: None,
                                input_truncated: false,
                                output: Some(out),
                                output_truncated,
                                error,
                                denied,
                            }),
                            at,
                            link: None,
                            wake: None,
                            brief: false,
                            files: Vec::new(),
                            plan: None,
                            anchor: None,
                        }),
                    }
                }
                Ev::Interrupted => items.push(TranscriptItem {
                    role: "interrupted",
                    text: None,
                    truncated: false,
                    images: 0,
                    pictures: Vec::new(),
                    tool: None,
                    at,
                    link: None,
                    wake: None,
                    brief: false,
                    files: Vec::new(),
                    plan: None,
                    anchor: None,
                }),
                Ev::Anchor { id } => next_anchor = Some(id),
                // 바로 앞 항목이 기준점 없는 사람 말일 때만 — 다른 말의 턴 id 를 붙이지 않는다
                Ev::LateAnchor { id } => {
                    if let Some(last) = items.last_mut().filter(|i| i.role == "user" && i.anchor.is_none()) {
                        last.anchor = Some(id);
                    }
                }
                Ev::Declined => {
                    // 결과 줄은 이 표식보다 뒤에 온다
                    let open = items
                        .iter_mut()
                        .rev()
                        .take_while(|i| i.role == "tool")
                        .filter_map(|i| i.tool.as_mut())
                        .find(|t| t.output.is_none() && !t.name.is_empty());
                    if let Some(t) = open {
                        t.denied = true;
                    }
                }
                Ev::McpServer { alias, server } => {
                    let slot = aliases.entry(alias).or_insert_with(|| Some(server.clone()));
                    if slot.as_deref() != Some(server.as_str()) {
                        *slot = None;
                    }
                    // 완료 표지는 호출 뒤에 온다 — 이미 놓인 줄도 되돌린다
                    for t in items.iter_mut().filter_map(|i| i.tool.as_mut()) {
                        if let Some(n) = unalias_mcp(&t.name, &aliases) {
                            t.name = n;
                        }
                    }
                }
            }
        }
    }
    plans.settle(&mut items);
    items
}

/// Codex 코드 모드 `exec` 가 끝나기 전에 돌려주는 글의 머리.
const CELL_RUNNING: &str = "Script running with cell ID ";

/// Claude 계획(`ExitPlanMode`)의 본문 출처. 믿는 것은 둘뿐이다 — ① 승인 결과 줄의 `toolUseResult.plan`(CLI 가 승인된 글을 적는다)
/// ② 그 호출 앞의 마지막 **통째 쓰기**(`Write`)가 성공한 계획 파일 글(CLI 는 카드에 그 파일을 보인다). 호출 줄의 `input.plan` 은 낡을 수 있어 쓰지 않고,
/// 그 사이 부분 고치기(`Edit` 등)가 있었거나 쓰기가 이 쪽에 없으면 본문 없이 경로 · 결과만 낸다. 파일은 읽지 않는다(그 뒤 바뀌었을 수 있다).
#[derive(Default)]
struct PlanTrack {
    /// 정규화 경로 → 마지막 통째 쓰기(호출 id · 글) — `None` = 그 뒤 부분 고치기
    writes: HashMap<String, Option<(String, String)>>,
    last_plan_file: Option<String>,
    calls: Vec<PlanCall>,
    approved: HashMap<String, (String, Option<String>)>,
    /// 호출 id → 오류였나
    results: HashMap<String, bool>,
}

struct PlanCall {
    /// `items` 의 자리
    at: usize,
    id: String,
    file: Option<String>,
    /// 그 호출 앞의 마지막 통째 쓰기(호출 id · 글)
    write: Option<(String, String)>,
}

fn plan_file_like(p: &str) -> bool {
    let n = p.replace('\\', "/");
    let mut parts = n.rsplit('/');
    let name = parts.next().unwrap_or("");
    name.to_ascii_lowercase().ends_with(".md") && parts.next().is_some_and(|d| d.eq_ignore_ascii_case("plans"))
}

impl PlanTrack {
    fn on_call(&mut self, id: &str, name: &str, input: &Value, at: usize) -> Option<PlanTag> {
        let path = input["file_path"].as_str().filter(|s| !s.is_empty());
        match (name, path) {
            ("Write", Some(p)) => {
                let content = input["content"].as_str().map(|c| (id.to_owned(), c.to_owned()));
                self.writes.insert(norm_path(p), content);
                if plan_file_like(p) {
                    self.last_plan_file = Some(p.to_owned());
                }
                None
            }
            ("Edit" | "MultiEdit", Some(p)) => {
                self.writes.insert(norm_path(p), None);
                if plan_file_like(p) {
                    self.last_plan_file = Some(p.to_owned());
                }
                None
            }
            ("ExitPlanMode", _) => {
                let file = input["planFilePath"].as_str().filter(|s| !s.is_empty()).map(str::to_owned).or_else(|| self.last_plan_file.clone());
                let write = file.as_deref().and_then(|f| self.writes.get(&norm_path(f)).cloned().flatten());
                self.calls.push(PlanCall { at, id: id.to_owned(), file, write });
                Some(PlanTag::default())
            }
            _ => None,
        }
    }

    fn settle(self, items: &mut [TranscriptItem]) {
        for PlanCall { at, id, file, write } in self.calls {
            let Some(item) = items.get_mut(at) else { continue };
            let Some(tool) = item.tool.as_ref() else { continue };
            let outcome = match (&tool.output, tool.error, tool.denied) {
                (Some(_), false, _) => Some("approved"),
                (Some(_), true, true) => Some("kept"),
                _ => None,
            };
            let feedback = (outcome == Some("kept"))
                .then(|| tool.output.as_deref().map(str::trim).filter(|o| !o.is_empty() && *o != crate::side_chat::claude::PLAN_KEEP && *o != crate::side_chat::claude::DENIED))
                .flatten()
                .map(|o| cap(o, 2_000).0);
            let approved = self.approved.get(&id);
            let written = write.filter(|(w, _)| self.results.get(w) == Some(&false)).map(|(_, body)| body);
            let body = approved.map(|(p, _)| p.clone()).or(written);
            let (body, body_truncated) = match body {
                Some(b) => {
                    let (b, cut) = cap(&b, TEXT_MAX_CHARS);
                    (Some(b), cut)
                }
                None => (None, false),
            };
            let file = approved.and_then(|(_, f)| f.clone()).or(file);
            item.plan = Some(PlanTag { body, body_truncated, file, outcome, feedback });
        }
    }
}

// ---------------------------------------------------------------------------
// 턴의 끝 — 메신저 알림의 발췌 (docs/log/2026-09-27-discord-notify.md)
// ---------------------------------------------------------------------------

const TURN_SCAN_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// 메신저가 **곧장** 몸통에 붙인다(`crate::messenger`). 화면으로 돌려주지 않고, **`Debug` 없음**.
#[derive(Default)]
pub(crate) struct TurnTail {
    /// 원문 — 자르고 다듬는 것은 부르는 쪽.
    pub text: Option<String>,
    /// 마지막 에이전트 글 뒤에 선, 결과 없는 도구 호출의 이름 — 권한 물음이 묻는 도구.
    pub pending_tool: Option<String>,
    pub pending_input: Option<String>,
}

fn turn_tail_from<R: Read + Seek>(f: R, size: u64, parse: LineEvents) -> std::io::Result<TurnTail> {
    let mut rev = RevLines::new(f, size);
    let mut out = TurnTail::default();
    let mut results: HashSet<String> = HashSet::new();
    let mut tool_seen = false;
    while let Some((_, raw)) = rev.next_line()? {
        if rev.read > TURN_SCAN_MAX_BYTES {
            break;
        }
        if raw.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&raw) else {
            continue;
        };
        for e in parse(&v).into_iter().rev() {
            match e {
                Ev::ToolResult { id, .. } => {
                    results.insert(id);
                }
                Ev::ToolUse { id, name, input } => {
                    if !tool_seen {
                        tool_seen = true;
                        if !id.is_empty() && !results.contains(&id) && !name.trim().is_empty() {
                            out.pending_tool = Some(name);
                            out.pending_input = Some(tool_summary(&input)).filter(|s| !s.trim().is_empty());
                        }
                    }
                }
                Ev::Text {
                    who: Speaker::Assistant,
                    text,
                    ..
                } => {
                    if !text.trim().is_empty() {
                        out.text = Some(text);
                        return Ok(out);
                    }
                }
                Ev::Text {
                    who: Speaker::User, ..
                } => return Ok(out),
                Ev::Interrupted | Ev::Declined | Ev::McpServer { .. } | Ev::PlanText | Ev::PlanApproved { .. } | Ev::Anchor { .. } | Ev::LateAnchor { .. } => {}
            }
        }
    }
    Ok(out)
}

pub(crate) fn turn_tail(path: &Path, parse: LineEvents) -> TurnTail {
    let Ok(f) = std::fs::File::open(path) else {
        return TurnTail::default();
    };
    let Ok(size) = f.metadata().map(|m| m.len()) else {
        return TurnTail::default();
    };
    turn_tail_from(f, size, parse).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 원격 — 서버의 파일을 창 하나씩 받아 같은 리더로 (docs/log/2026-09-27-remote-conversations.md)
// ---------------------------------------------------------------------------

/// 창 밖(앞)을 읽으려 하면 `need_more` 를 세우고 실패한다 — 부르는 쪽이 더 넓은 창을 받아 다시 부른다. 서버에는 아무것도 쓰지
/// 않는다 — 창은 읽기(`tail -c` · `head -c`)로만 온다.
pub(crate) struct Window<'a> {
    start: u64,
    data: &'a [u8],
    pos: u64,
    need_more: bool,
}

impl<'a> Window<'a> {
    pub(crate) fn new(start: u64, data: &'a [u8]) -> Self {
        Window {
            start,
            data,
            pos: start,
            need_more: false,
        }
    }
}

impl Read for Window<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pos < self.start {
            self.need_more = true;
            return Err(std::io::Error::other("window"));
        }
        let at = (self.pos - self.start) as usize;
        let rest = self.data.get(at..).unwrap_or_default();
        let n = rest.len().min(buf.len());
        buf[..n].copy_from_slice(&rest[..n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for Window<'_> {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        let end = self.start + self.data.len() as u64;
        let next = match to {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(d) => end.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        self.pos = next.ok_or_else(|| std::io::Error::other("seek"))?;
        Ok(self.pos)
    }
}

pub(crate) enum WindowPage {
    Page(TranscriptPage),
    NeedMore,
}

pub(crate) fn page_in_window(
    size: u64,
    start: u64,
    data: &[u8],
    before: Option<u64>,
    limit: usize,
    parse: LineEvents,
) -> Result<WindowPage, String> {
    let mut w = Window::new(start, data);
    match read_page_from(&mut w, size, before, limit, parse) {
        Ok(p) => Ok(WindowPage::Page(p)),
        Err(_) if w.need_more && start > 0 => Ok(WindowPage::NeedMore),
        Err(e) => Err(e),
    }
}

pub(crate) fn default_limit() -> usize {
    LIMIT_DEFAULT
}

/// **오케스트레이션의 고정 파일 전용** — 그쪽이 CLI 폴더 · worktree cwd 를 **이 손잡이로** 검증했다. 화면의 명령은 경로를 받지 않는다.
pub(crate) fn page_of_file(
    f: std::fs::File,
    before: Option<u64>,
    limit: Option<usize>,
    parse: LineEvents,
) -> Result<TranscriptPage, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    let size = f.metadata().map_err(io)?.len();
    let mut page = read_page_from(f, size, before, limit.unwrap_or(LIMIT_DEFAULT), parse)?;
    // 모델 · 강도 · 되감기 기준점은 화면 전용 — 오케스트레이션(MCP `read_worker`)으로는 싣지 않는다
    page.last = None;
    for it in &mut page.items {
        it.anchor = None;
    }
    Ok(page)
}

/// 화면이 읽는 기록 — Claude 는 되감기로 버려진 갈래를 뺀 그 파일 · Codex 는 되감기 조각을 이은 가상 흐름(조각이 하나면 그 파일 그대로).
enum Source {
    File(PathBuf, Arc<HashSet<String>>),
    Segments(Segments),
}

fn source_of(t: &'static SessionTarget, roots: &[PathBuf], id: &str) -> Result<Source, String> {
    let path = crate::agent_sessions::conversation_file(t, roots, id)?;
    if t.id == "claude" {
        let cut = claude_cut(&path);
        return Ok(Source::File(path, cut));
    }
    let id = id.to_ascii_lowercase();
    let files = crate::agent_sessions::codex_files_of(roots, &id);
    // 되감은 직후의 새 조각에는 턴이 없어 색인이 옛 파일을 고를 수 있다 — 이름(만든 순)이 가장 늦은 것이 지금 조각이다
    let newest = files.last().cloned().unwrap_or(path);
    let segs = codex_segments(&files, &newest, &id);
    match segs.as_slice() {
        [(only, _)] => Ok(Source::File(only.clone(), Arc::default())),
        _ => Segments::open(&segs).map(Source::Segments).map_err(|e| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}")),
    }
}

fn transcript_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<TranscriptPage, String> {
    let limit = limit.unwrap_or(LIMIT_DEFAULT);
    match source_of(t, roots, id)? {
        Source::File(path, cut) => {
            let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
            let f = std::fs::File::open(&path).map_err(io)?;
            let size = f.metadata().map_err(io)?.len();
            read_page_in(f, size, before, limit, t.transcript, &cut)
        }
        Source::Segments(s) => {
            let size = s.total;
            read_page_from(s, size, before, limit, t.transcript)
        }
    }
}

// ---------------------------------------------------------------------------
// Claude 되감기 갈래 — 되감은 기록은 버려진 갈래를 뺀다
// ---------------------------------------------------------------------------

/// CLI 가 대화를 되감을 때 남기는 표지 줄(`last-prompt`)의 글자 — 이것이 없는 기록은 줄 순서 그대로 읽는다(지금과 한 글자도 같다).
const REWOUND_MARK: &[u8] = br#""rewound":true"#;
const CUT_MEMO_MAX: usize = 32;

/// 갈래를 따지는 데 필요한 칸만 — 본문은 읽지 않는다.
#[derive(serde::Deserialize)]
struct ChainLine {
    #[serde(rename = "type")]
    ty: Option<String>,
    uuid: Option<String>,
    #[serde(rename = "parentUuid")]
    parent: Option<String>,
    #[serde(rename = "logicalParentUuid")]
    logical: Option<String>,
    rewound: Option<bool>,
    #[serde(rename = "cutUuid")]
    cut_uuid: Option<String>,
}

/// 버려진 갈래 — `last-prompt{rewound:true, cutUuid}` 마다 그 표지 **앞**에 적힌 줄 가운데 `parentUuid`(압축 경계는 `logicalParentUuid`)를
/// 거슬러 `cutUuid` 에 닿는 줄. 없는 uuid · 끊긴 사슬 · 사슬 칸 없는 줄은 남긴다(줄 순서 그대로).
/// 잎에서 거슬러 오르는 대신 잘린 쪽을 고르는 까닭: 되감은 적 없는 기록에도 잎 사슬 밖 줄(병렬 도구 결과 등)이 흔하다.
fn cut_of(lines: impl Iterator<Item = ChainLine>) -> HashSet<String> {
    let mut parent: HashMap<String, Option<String>> = HashMap::new();
    let mut order: Vec<(String, usize)> = Vec::new();
    let mut marks: Vec<(String, usize)> = Vec::new();
    for (i, l) in lines.enumerate() {
        if l.ty.as_deref() == Some("last-prompt") && l.rewound == Some(true) {
            marks.extend(l.cut_uuid.map(|c| (c, i)));
        }
        if let Some(u) = l.uuid {
            parent.insert(u.clone(), l.parent.or(l.logical));
            order.push((u, i));
        }
    }
    let mut out = HashSet::new();
    for (cut, at) in marks {
        if !parent.contains_key(&cut) {
            continue;
        }
        let mut memo: HashMap<&str, bool> = HashMap::new();
        for (u, i) in &order {
            if *i < at && descends(u, &cut, &parent, &mut memo) {
                out.insert(u.clone());
            }
        }
    }
    out
}

fn descends<'a>(u: &'a str, cut: &str, parent: &'a HashMap<String, Option<String>>, memo: &mut HashMap<&'a str, bool>) -> bool {
    let mut path: Vec<&'a str> = Vec::new();
    let mut cur = Some(u);
    let mut hit = false;
    while let Some(c) = cur {
        if c == cut {
            hit = true;
            break;
        }
        if let Some(&m) = memo.get(c) {
            hit = m;
            break;
        }
        // 고리면 남긴다
        if path.len() > parent.len() {
            break;
        }
        path.push(c);
        cur = parent.get(c).and_then(|p| p.as_deref());
    }
    for p in path {
        memo.insert(p, hit);
    }
    hit
}

struct CutMemo {
    path: PathBuf,
    len: u64,
    mtime: Option<std::time::SystemTime>,
    marked: bool,
    cut: Arc<HashSet<String>>,
}

static CUT_MEMO: LazyLock<Mutex<Vec<CutMemo>>> = LazyLock::new(Default::default);

/// `[from, 끝)` 에 표지 글자가 있나 — 앞 조각과 걸친 자리는 부르는 쪽이 `from` 을 당겨 덮는다.
fn has_mark(path: &Path, from: u64) -> std::io::Result<bool> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(from))?;
    let mut buf = vec![0u8; CHUNK_BYTES as usize];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            return Ok(false);
        }
        carry.extend_from_slice(&buf[..n]);
        let found = carry.iter().enumerate().any(|(i, b)| *b == b'"' && carry[i..].starts_with(REWOUND_MARK));
        if found {
            return Ok(true);
        }
        let keep = carry.len().saturating_sub(REWOUND_MARK.len() - 1);
        carry.drain(..keep);
    }
}

fn cut_full(path: &Path) -> std::io::Result<HashSet<String>> {
    use std::io::BufRead;
    let f = std::io::BufReader::new(std::fs::File::open(path)?);
    let lines = f.split(b'\n').map_while(Result::ok).filter_map(|l| serde_json::from_slice::<ChainLine>(&l).ok());
    Ok(cut_of(lines))
}

/// 그 Claude 기록의 버려진 갈래 줄 `uuid`. 되감기 표지가 없으면 비었다 — 파일이 자라면 늘어난 꼬리만 표지를 찾는다.
pub(crate) fn claude_cut(path: &Path) -> Arc<HashSet<String>> {
    let Ok(md) = std::fs::metadata(path) else { return Arc::default() };
    let (len, mtime) = (md.len(), md.modified().ok());
    let lock = || CUT_MEMO.lock().unwrap_or_else(|e| e.into_inner());
    let prev = lock().iter().find(|m| m.path == path).map(|m| (m.len, m.mtime, m.marked, Arc::clone(&m.cut)));
    let from = match prev {
        Some((l, t, _, cut)) if l == len && t == mtime => return cut,
        Some((l, _, false, _)) if l < len => l.saturating_sub(REWOUND_MARK.len() as u64 - 1),
        _ => 0,
    };
    let marked = prev.is_some_and(|p| p.2 && p.0 <= len) || has_mark(path, from).unwrap_or(false);
    let cut = if marked { Arc::new(cut_full(path).unwrap_or_default()) } else { Arc::default() };
    let mut memo = lock();
    memo.retain(|m| m.path != path);
    if memo.len() >= CUT_MEMO_MAX {
        memo.remove(0);
    }
    memo.push(CutMemo { path: path.to_path_buf(), len, mtime, marked, cut: Arc::clone(&cut) });
    cut
}

/// 되감기 기준점 판정의 결과.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RewindPoint {
    /// 현재 갈래의 마지막 사람 줄 `uuid`(CLI 의 `last_seen_user_message_uuid`).
    pub last_seen: String,
    /// 기준점 뒤에 현재 갈래의 압축 경계가 있다 — resume 한 CLI 는 이 기준점을 거절한다.
    pub before_compact: bool,
}

const COMPACT_MARK: &[u8] = br#""compact_boundary""#;

/// 되감기 op 의 서버 판정 — `anchor` 가 현재 갈래의 진짜 사람 줄일 때만 `Some`. 블로킹(파일).
pub(crate) fn claude_rewind_point(path: &Path, anchor: &str) -> Option<RewindPoint> {
    use std::io::BufRead;
    let cut = claude_cut(path);
    let f = std::io::BufReader::new(std::fs::File::open(path).ok()?);
    let (mut found, mut last, mut before_compact) = (false, None, false);
    for raw in f.split(b'\n').map_while(Result::ok) {
        let boundary = raw.windows(COMPACT_MARK.len()).any(|w| w == COMPACT_MARK);
        // 사람 줄은 늘 `"type":"user"` 를 품는다 — 나머지 줄은 파싱하지 않는다
        if !boundary && !raw.windows(6).any(|w| w == b"\"user\"") {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&raw) else { continue };
        if v["uuid"].as_str().is_some_and(|u| cut.contains(u)) {
            continue;
        }
        if v["type"] == "system" && v["subtype"] == "compact_boundary" {
            before_compact |= found;
            continue;
        }
        if let Some(id) = claude_events(&v).into_iter().find_map(|e| match e {
            Ev::Anchor { id } => Some(id),
            _ => None,
        }) {
            found |= id == anchor;
            last = Some(id);
        }
    }
    let last_seen = found.then_some(last).flatten()?;
    Some(RewindPoint { last_seen, before_compact })
}

/// `from` 바이트 뒤에 대화 되감기 표지가 적혔나 — CLI 는 제어 답을 먼저 내고 표지를 조금 뒤에 쓴다. 블로킹(파일).
pub(crate) fn claude_marked_since(path: &Path, from: u64) -> bool {
    has_mark(path, from.saturating_sub(REWOUND_MARK.len() as u64 - 1)).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Codex 되감기 조각 — 앞 조각의 앞부분 + 지금 조각을 한 흐름으로
// ---------------------------------------------------------------------------

const SEGMENTS_MAX: usize = 16;

/// 파일 이름이 담은 id — 조각이면 꼬리 `_<조각 id>` · 원본이면 대화 id.
fn file_thread_id(path: &Path, id: &str) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy().to_ascii_lowercase();
    let at = stem.find(id)?;
    let rest = &stem[at + id.len()..];
    match rest.strip_prefix('_') {
        Some(seg) if crate::agent_sessions::uuid_shape(seg) => Some(seg.to_string()),
        Some(_) => None,
        None => rest.is_empty().then(|| id.to_string()),
    }
}

/// 그 대화의 읽을 조각들 — 앞 조각부터 `(파일, 읽을 바이트)`. 지금 조각의 첫 줄 `session_meta.payload.history_base{thread_id, end_byte_offset}` 의
/// `thread_id` 를 **파일 이름의 id** 와 맞춰 그 파일의 앞 `end_byte_offset` 바이트를 붙인다(되풀이 · 16개). 대상 크기가 모자라거나 그 자리가 줄 끝이
/// 아니면 거기서 멈춘다 — 그 조각부터만 읽는다.
fn codex_segments(files: &[PathBuf], newest: &Path, id: &str) -> Vec<(PathBuf, u64)> {
    let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).ok();
    let Some(n) = size(newest) else { return vec![(newest.to_path_buf(), 0)] };
    let mut chain = vec![(newest.to_path_buf(), n)];
    let mut cur = newest.to_path_buf();
    while chain.len() < SEGMENTS_MAX {
        let Some(meta) = crate::agent_sessions::first_line_json(&cur) else { break };
        let hb = &meta["payload"]["history_base"];
        let (Some(tid), Some(off)) = (hb["thread_id"].as_str(), hb["end_byte_offset"].as_u64()) else { break };
        let tid = tid.to_ascii_lowercase();
        let Some(target) = files.iter().find(|f| **f != cur && !chain.iter().any(|(c, _)| c == *f) && file_thread_id(f, id).as_deref() == Some(tid.as_str())) else {
            break;
        };
        if off == 0 || size(target).is_none_or(|s| s < off) || byte_at(target, off - 1) != Some(b'\n') {
            break;
        }
        chain.push((target.clone(), off));
        cur = target.clone();
    }
    chain.reverse();
    chain
}

fn byte_at(path: &Path, at: u64) -> Option<u8> {
    let mut f = std::fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(at)).ok()?;
    let mut one = [0u8; 1];
    f.read_exact(&mut one).ok()?;
    Some(one[0])
}

/// 여러 파일의 앞부분을 하나로 보이는 `Read + Seek` — 커서(`before`) · 그림 자리는 이 가상 흐름의 바이트 자리다(앞 조각은 굳었고 마지막 조각만 자란다).
struct Segments {
    /// (파일, 가상 시작, 길이)
    parts: Vec<(std::fs::File, u64, u64)>,
    pos: u64,
    total: u64,
}

impl Segments {
    fn open(segs: &[(PathBuf, u64)]) -> std::io::Result<Segments> {
        let mut parts = Vec::new();
        let mut at = 0u64;
        for (p, len) in segs {
            parts.push((std::fs::File::open(p)?, at, *len));
            at += len;
        }
        Ok(Segments { parts, pos: 0, total: at })
    }
}

impl Read for Segments {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let pos = self.pos;
        let Some((f, start, len)) = self.parts.iter_mut().find(|(_, s, l)| pos >= *s && pos < *s + *l) else { return Ok(0) };
        let inner = pos - *start;
        let n = ((*len - inner) as usize).min(buf.len());
        f.seek(SeekFrom::Start(inner))?;
        let got = f.read(&mut buf[..n])?;
        self.pos += got as u64;
        Ok(got)
    }
}

impl Seek for Segments {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        let next = match to {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(d) => self.total.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        self.pos = next.ok_or_else(|| std::io::Error::other("seek"))?;
        Ok(self.pos)
    }
}

/// 파일은 id 로 목록의 색인에서만 찾는다(경로를 받지 않는다).
#[tauri::command]
pub async fn agent_conversation_transcript(
    agent: String,
    id: String,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<TranscriptPage, String> {
    let t = crate::agent_sessions::target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || transcript_in(t, &(t.roots)(), &id, before, limit))
        .await
        .map_err(|e| e.to_string())?
}

/// 자리는 쪽을 낸 것과 같은 흐름의 바이트 자리다(Codex 조각이면 가상 흐름).
fn image_in(src: Source, at: u64, len: u64, n: u32) -> Result<Vec<u8>, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    match src {
        Source::File(path, _) => {
            let f = std::fs::File::open(&path).map_err(io)?;
            let size = f.metadata().map_err(io)?.len();
            image_in_reader(f, size, at, len, n)
        }
        Source::Segments(s) => {
            let size = s.total;
            image_in_reader(s, size, at, len, n)
        }
    }
}

fn image_in_reader<R: Read + Seek>(mut f: R, size: u64, at: u64, len: u64, n: u32) -> Result<Vec<u8>, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    if len == 0 || len > IMAGE_LINE_MAX_BYTES || at.saturating_add(len) > size {
        return image_in_window(size, 0, &[], at, len, n);
    }
    let start = at.saturating_sub(1);
    let end = (at + len + 1).min(size);
    let mut data = vec![0u8; (end - start) as usize];
    f.seek(SeekFrom::Start(start)).map_err(io)?;
    f.read_exact(&mut data).map_err(io)?;
    image_in_window(size, start, &data, at, len, n)
}

/// 파일은 id 로 색인에서만 찾고(경로를 받지 않는다) 자리는 줄 하나와 꼭 맞아야 한다([`image_in_window`]). 바이트는 화면으로만.
#[tauri::command]
pub async fn agent_conversation_image(
    agent: String,
    id: String,
    at: u64,
    len: u64,
    n: u32,
) -> Result<tauri::ipc::Response, String> {
    let t = crate::agent_sessions::target(&agent)?;
    tauri::async_runtime::spawn_blocking(move || image_in(source_of(t, &(t.roots)(), &id)?, at, len, n))
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

pub(crate) mod forward;

#[cfg(test)]
pub(crate) mod tests;
