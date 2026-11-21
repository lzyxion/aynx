//! **기록 보기** — 지난 대화 하나를 **읽기 전용**으로 펼친다 (docs/log/2026-09-27-conversation-viewer.md).
//!
//! - 생각(Claude `thinking` · Codex `reasoning`)은 내지 않는다 — 도구 호출마다 앞에 서서 기록을 시끄럽게 했다.
//! - 파일은 목록과 같은 색인(`agent_sessions::conversation_file`)으로만 찾는다 — 화면이 넘긴 경로는 받지 않는다.
//! - 대화 파일은 90 MB 까지 자라 통째로 읽지 않는다 — 끝(또는 커서)에서 거꾸로 한 쪽씩. 커서는 줄의 시작이어야 한다(앞 바이트가
//!   `\n`). 대화 파일은 끝에 덧붙기만 하므로 커서는 파일이 자라도 옳다.
//! - 쪽이 찬 뒤에도 보이는 것이 없는 줄은 계속 먹는다 — 그래야 파일 맨 앞의 메타 줄만 남았을 때 "더 있다" 로 잘못 말하지 않는다.
//!
//! ## 개인정보 — 화면과 오케스트레이션 조정자에만
//!
//! 본문은 사용자 · 에이전트의 글자다. **화면과 오케스트레이션 조정자**(자기 Run 작업자의 **고정 대화만** — MCP `read_worker`)로만
//! 간다: 로그 · 감사 · 설정 · `Debug` 어디에도 싣지 않고 다른 대화는 MCP 로 나가지 않는다(→ docs/invariants.md 전문 10). 이 모듈의
//! 자료형은 `Debug` 를 파생하지 않는다(패닉 · 로그에 찍히지 않게). 네트워크도 없다(조정자는 루프백 `/mcp` 로 받는다).

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

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
        match content {
            Value::String(s) if interrupt_marker(s) => out.push(Ev::Interrupted),
            Value::String(s) => {
                if claude_human_text(s, origin, sdk) {
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
                // 도구 결과 줄의 이미지는 결과 쪽이라 세지 않는다
                let tool_line = parts.iter().any(|p| p["type"] == "tool_result");
                if !texts.is_empty()
                    || (images > 0 && !tool_line && origin.is_none_or(|k| k == "human"))
                {
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

/// 말 · 도구는 `response_item` 만 본다 — `event_msg` 는 같은 말의 사본이다(사본이 아닌 끊김 · 거절 · 만든 그림만 거기서 읽는다).
/// 주입된 사용자 몫(환경 · 지침 · AGENTS.md)은 목록의 제목 고르기와 같은 판정으로 건너뛴다.
pub(crate) fn codex_events(v: &Value) -> Vec<Ev> {
    if v["type"] == "event_msg" {
        let pl = &v["payload"];
        return match pl["type"].as_str().unwrap_or("") {
            "turn_aborted" if pl["reason"] == "interrupted" => vec![Ev::Interrupted],
            "item_completed" if pl["item"]["status"] == "declined" => vec![Ev::Declined],
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
            for p in parts {
                match p["type"].as_str().unwrap_or("") {
                    "input_text" | "output_text" | "text" => {
                        if let Some(t) = p["text"].as_str().filter(|t| !t.trim().is_empty()) {
                            if who == Speaker::User && codex_injected(t) {
                                continue;
                            }
                            texts.push(t);
                        }
                    }
                    "input_image" => images += 1,
                    _ => {}
                }
            }
            if texts.is_empty() && images == 0 {
                return Vec::new();
            }
            vec![Ev::Text {
                who,
                text: texts.join("\n\n"),
                images,
            }]
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
        "custom_tool_call" => vec![Ev::ToolUse {
            id: call_id(),
            name: name(),
            input: pl["input"].clone(),
        }],
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
    !matches!(e, Ev::ToolResult { .. } | Ev::Declined)
}

fn weight(e: &Ev) -> usize {
    match e {
        Ev::Text { text, .. } => text.len().min(TEXT_MAX_CHARS * 4),
        Ev::ToolUse { input, .. } => 64 + input.to_string().len().min(INPUT_MAX_CHARS * 4),
        Ev::ToolResult { output, .. } => output.len().min(OUTPUT_MAX_CHARS * 4),
        Ev::Interrupted | Ev::Declined => 16,
    }
}

fn read_page_from<R: Read + Seek>(
    mut f: R,
    size: u64,
    before: Option<u64>,
    limit: usize,
    parse: LineEvents,
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
        if latest && last.is_none() {
            last = line_model(&v, off);
        }
        let evs = parse(&v);
        let has_content = !evs.is_empty();
        let full = shown >= limit || (bytes >= PAGE_MAX_BYTES && shown > 0);
        if full && has_content && (orphans.is_empty() || extra >= EXTEND_MAX_LINES) {
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
        if full {
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
    for LineOut { at, evs, mut pics } in lines {
        for e in evs {
            match e {
                Ev::Text { who, text, images } => {
                    // 그림이 붙은 말은 줄에 하나뿐이다 — 그 말이 줄의 그림 자리를 가져간다
                    let pictures = if images > 0 { std::mem::take(&mut pics) } else { Vec::new() };
                    let wake = (who == Speaker::User).then(|| crate::orchestration::wake::parse_wake_note(&text)).flatten();
                    let briefed = (who == Speaker::User).then(|| crate::side_chat::event::parse_producer_brief(&text).map(str::to_owned)).flatten();
                    let brief = briefed.is_some();
                    let text = briefed.unwrap_or(text);
                    // 파일 첨부 꼬리는 연결 머리글보다 먼저 걷는다 — 머리글만 있는 글의 `] ` 가 꼬리 앞에 남는다
                    let refs = (who == Speaker::User).then(|| crate::side_chat::event::parse_file_refs(&text).map(|(n, b)| (n, b.to_owned()))).flatten();
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
                    });
                }
                Ev::ToolUse { id, name, input } => {
                    let text = tool_input_text(&input);
                    let (input_text, input_truncated) = cap(&text, INPUT_MAX_CHARS);
                    if !id.is_empty() {
                        calls.insert(id, items.len());
                    }
                    items.push(TranscriptItem {
                        role: "tool",
                        text: None,
                        truncated: false,
                        images: 0,
                        pictures: Vec::new(),
                        tool: Some(ToolCall {
                            name,
                            summary: tool_summary(&input),
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
                    });
                }
                Ev::ToolResult { id, output, error, denied } => {
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
                }),
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
            }
        }
    }
    items
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
                Ev::Interrupted | Ev::Declined => {}
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

fn read_page(
    path: &Path,
    before: Option<u64>,
    limit: usize,
    parse: LineEvents,
) -> Result<TranscriptPage, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    let f = std::fs::File::open(path).map_err(io)?;
    let size = f.metadata().map_err(io)?.len();
    read_page_from(f, size, before, limit, parse)
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
    // 모델 · 강도는 표시 전용 — 오케스트레이션(MCP `read_worker`)으로는 싣지 않는다
    page.last = None;
    Ok(page)
}

fn transcript_in(
    t: &'static SessionTarget,
    roots: &[PathBuf],
    id: &str,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<TranscriptPage, String> {
    let path = crate::agent_sessions::conversation_file(t, roots, id)?;
    read_page(&path, before, limit.unwrap_or(LIMIT_DEFAULT), t.transcript)
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

fn image_in_file(path: &Path, at: u64, len: u64, n: u32) -> Result<Vec<u8>, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    let mut f = std::fs::File::open(path).map_err(io)?;
    let size = f.metadata().map_err(io)?.len();
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
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::agent_sessions::conversation_file(t, &(t.roots)(), &id)?;
        image_in_file(&path, at, len, n)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

pub(crate) mod forward;

#[cfg(test)]
pub(crate) mod tests;
