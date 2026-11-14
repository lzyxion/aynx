//! **기록 보기** — 지난 대화 하나를 **읽기 전용**으로 펼친다 (docs/log/2026-09-27-conversation-viewer.md).
//!
//! 에이전트 CLI(Claude Code · Codex)의 대화 파일(jsonl)을 줄 단위로 읽어 화면이 그릴 **고른 모양**
//! ([`TranscriptItem`] — 사용자 말 · 에이전트 말 · 도구 호출)으로 바꾼다. 생각(Claude `thinking` · Codex
//! `reasoning`)은 **내지 않는다** — 도구 호출마다 앞에 서서 기록을 시끄럽게 했다(실기). 쪽도 보이는 것만 센다. 에이전트마다 다른 것은
//! **줄 하나 → 사건들**([`LineEvents`]) 뿐이고 `agent_sessions::SessionTarget::transcript` 한 칸에 산다.
//! 파일 찾기는 목록과 같은 색인(`agent_sessions::conversation_file`)이다 — 화면이 넘긴 경로는 받지 않는다.
//!
//! ## 읽는 법 — 끝에서 거꾸로, 한 쪽씩
//!
//! 대화 파일은 90 MB 까지 자란다. **통째로 읽지 않는다**: 끝(또는 커서)에서 [`CHUNK_BYTES`] 씩 거꾸로
//! 읽으며 줄을 최신부터 하나씩 꺼내([`RevLines`]) 보이는 항목이 `limit` 개 찰 때까지 모은다. 답에는
//! **커서**(이 쪽의 가장 오래된 줄이 시작하는 바이트 위치)가 실려, 다음 "이전 더 보기" 가 그 위치 **앞**에서
//! 이어 읽는다. 대화 파일은 끝에 덧붙기만 하므로 커서는 파일이 자라도 그대로 옳다. 커서는 줄의 시작이어야
//! 한다(앞 바이트가 `\n`) — 아니면 받지 않는다.
//!
//! **도구 호출과 결과는 한 항목**이다(Claude `tool_use` ↔ `tool_result` · Codex `function_call` ↔ `…_output`,
//! 같은 id). 결과는 호출보다 뒤에 적히므로 거꾸로 읽다 결과를 먼저 만난다 — 쪽이 다 찼어도 그 결과의 호출을
//! 아직 못 만났으면 [`EXTEND_MAX_LINES`] 줄까지 더 읽어 짝을 맞춘다(쪽 경계가 짝을 가르지 않게). 그래도 못
//! 만나면 결과만의 항목(이름 없음)으로 선다.
//!
//! 쪽이 찬 뒤에도 **보이는 것이 없는 줄**(메타 · 제목 · 사용량)은 계속 먹는다 — 그래야 파일 맨 앞의 메타 줄만
//! 남았을 때 "더 있다" 로 잘못 말하지 않는다. 한 번에 훑는 양은 [`SCAN_MAX_BYTES`] 가 끊는다.
//!
//! ## 크기
//!
//! 글 하나 [`TEXT_MAX_CHARS`] · 도구 입력 [`INPUT_MAX_CHARS`] · 도구 출력 [`OUTPUT_MAX_CHARS`] 자에서 자르고
//! 잘렸다는 표시(`truncated`)를 싣는다(표시 문구는 화면의 것). 한 쪽의 글자 합은 [`PAGE_MAX_BYTES`] 까지.
//!
//! ## 개인정보 — 화면과 오케스트레이션 조정자에만
//!
//! 본문은 사용자·에이전트의 글자다. **화면과 오케스트레이션 조정자**(자기 Run 작업자의 **고정 대화만** — MCP `read_worker`,
//! 2026-10-15 6단계 · 설계 C-6)로만 간다: 로그·감사·설정·`Debug` 어디에도 싣지 않고(조정자 밖의 MCP 도 아니다 — 다른 대화는
//! MCP 로 나가지 않는다), 이 모듈의 자료형은 `Debug` 를 파생하지 않는다(패닉·로그에 찍히지 않게). 네트워크도 없다(조정자는
//! 루프백 `/mcp` 로 받는다). 전방 증분 읽기(앞에서 뒤로 · 커서 = 파일 세대 + 바이트 위치)는 [`forward`] — 같은 줄 파서를 쓴다.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::agent_sessions::{codex_injected, ms_of, SessionTarget};
use crate::i18n::tr;

/// 거꾸로 읽는 한 덩어리.
const CHUNK_BYTES: u64 = 256 * 1024;
/// 한 쪽의 기본·최대 항목 수.
const LIMIT_DEFAULT: usize = 40;
const LIMIT_MAX: usize = 200;
/// 글 하나(사용자 · 에이전트)의 최대 글자 수.
const TEXT_MAX_CHARS: usize = 20_000;
/// 도구 입력 · 출력 발췌의 최대 글자 수.
const INPUT_MAX_CHARS: usize = 2_000;
const OUTPUT_MAX_CHARS: usize = 4_000;
/// 도구 한 줄 요약의 최대 글자 수.
const SUMMARY_MAX_CHARS: usize = 120;
/// 한 쪽의 글자 합(바이트) — 넘으면 그 자리에서 쪽을 닫는다(적어도 한 항목은 싣는다).
const PAGE_MAX_BYTES: usize = 1024 * 1024;
/// 쪽이 찬 뒤 짝(도구 결과의 호출)을 찾으러 더 읽는 줄 수.
const EXTEND_MAX_LINES: usize = 64;
/// 한 번의 호출이 훑는 최대 바이트 — 보이는 것 없는 줄이 끝없이 이어져도 여기서 멈춘다("더 있다").
const SCAN_MAX_BYTES: u64 = 32 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 줄 → 사건 (에이전트마다 다른 것은 여기뿐)
// ---------------------------------------------------------------------------

/// 누가 한 말인가.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Speaker {
    User,
    Assistant,
}

/// 대화 파일의 줄 하나에서 나온 것. **`Debug` 없음**(모듈 머리말).
pub(crate) enum Ev {
    /// 말 — 글자(이미 자르지 않은 원문)와 붙은 이미지 수.
    Text {
        who: Speaker,
        text: String,
        images: u32,
    },
    /// 도구 호출 — `id` 가 비면 결과와 짝을 맞추지 않는다(웹 검색처럼 결과 줄이 없는 것).
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    /// 도구 결과 — 같은 `id` 의 호출에 붙는다. `denied` = 권한에서 거절돼 돌지 않았다(Claude 줄의 `permissionDecision`).
    ToolResult {
        id: String,
        output: String,
        error: bool,
        denied: bool,
    },
    /// 턴이 끊겼다(사람이 중단 — Claude `[Request interrupted…]` · Codex `turn_aborted{reason: interrupted}`). 화면의 "중단함" 한 줄.
    Interrupted,
    /// 아직 결과가 없는 가장 가까운 도구 호출이 권한에서 거절됐다(Codex `item_completed{status: declined}` — 호출 id 와 따로 놀아
    /// 차례로만 붙인다). 보이는 항목이 아니다.
    Declined,
}

/// 에이전트의 줄 파서 — `SessionTarget::transcript`.
pub(crate) type LineEvents = fn(&Value) -> Vec<Ev>;

/// 도구 결과의 글자 — 문자열 · 부분 배열(`{type:"text"|"input_text", text}` — 이미지는 뺀다) · 객체
/// (`output` · `content`). Codex 의 옛 모양은 JSON 문자열 안에 `{"output": …}` 을 싣는다.
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

/// Claude 의 사용자 글이 **사람이 친 것**인가. `origin.kind` 가 `human` 이면 그대로 믿고, 출처가 다른
/// 것(작업 알림 등)은 아니다. 출처가 없는 옛 줄은 도구가 넣은 표식(`<command-name>` · `<local-command-stdout>`)
/// · 끊김 표식 · 경고문을 모양으로 거른다(목록의 첫 프롬프트와 같은 판정).
///
/// `sdk` = stream-json 으로 받은 줄(`entrypoint:"sdk-cli"` · `origin` 없음 — 사이드 채팅 v2, spike 3차 1a). 그 줄의 사용자 글은
/// 사람이 보낸 것이다 — 붙여 넣은 XML/HTML · `Caveat:` 로 시작해도 숨기지 않고, 로컬 명령 표식(`set_model` 이 남기는 `/model`
/// 줄 · 그 출력)과 끊김 표식만 거른다(변환기 규칙 1). 경고문 줄(`isMeta`)은 부르는 쪽이 이미 버렸다.
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

/// Claude 가 끊긴 턴 자리에 넣는 표식(`[Request interrupted by user]` · `… for tool use]`)인가 — 사람 말이 아니라 "중단함" 한 줄.
fn interrupt_marker(t: &str) -> bool {
    t.trim_start().starts_with("[Request interrupted")
}

/// Claude 의 도구 결과 줄이 **권한 거절**인가 — 줄의 `permissionDecision.decision == "reject"`(사람 · 규칙 · 훅). 사람이 턴을 끊어 돌지
/// 않은 것(`source: user_abort`)은 거절이 아니다(그 자리는 끊김 표식이 그린다). 기록 2.1.309 실측: 사이드 채팅의 [거절] =
/// `{decision: reject, source: user_reject}` · 미리 허용한 도구 = `{decision: accept, …}`.
fn claude_denied(v: &Value) -> bool {
    let d = &v["permissionDecision"];
    d["decision"] == "reject" && d["source"] != "user_abort"
}

/// CLI 가 로컬 명령(`/model` 등) 자리에 넣는 표식으로 시작하나.
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

/// Claude Code 줄 하나 → 사건들. 사용자·에이전트 줄만 본다 — 메타(`isMeta`) · 압축 요약 · 사이드체인 ·
/// 시스템 · 첨부 · 제목 줄은 건너뛴다.
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
                // 이미지만 붙은 사람의 말도 말이다(도구 결과 줄의 이미지는 결과 쪽이라 세지 않는다)
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
            // 생각(`thinking` · `redacted_thinking`)은 싣지 않는다 — 모듈 머리말
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

/// Codex 롤아웃 줄 하나 → 사건들. 말 · 도구는 `response_item` 만 본다(`event_msg` 는 같은 말의 사본이다). `event_msg` 에서는 사본이
/// 아닌 셋만 — 끊긴 턴(`turn_aborted{reason: interrupted}`), 권한에서 거절된 항목(`item_completed` 의 `status: declined` — 0.163 실측:
/// 그 도구 호출(`custom_tool_call`)과 결과 줄 사이에 선다), 만든 그림([`codex_generated_image`]). 사용자 몫 중 **주입된 것**(환경 · 지침 · AGENTS.md — 목록의 제목 고르기와
/// 같은 판정)과 개발자·시스템 말은 건너뛴다.
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
        // `reasoning`(생각)은 싣지 않는다 — 모듈 머리말
        "function_call" => {
            // 인자는 JSON 을 담은 문자열이다 — 읽히면 객체로, 아니면 글자 그대로
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

/// **만든 그림**(`event_msg item_completed` 의 `item{type: Extension, kind: image_gen.generation, status: completed, savedPath}` —
/// 2026-10-24 0.163 실측) → 에이전트 말 `![지시문](savedPath)`(사이드 채팅 실시간과 같은 글자 — `side_chat::event::image_markdown`).
/// F5 뒤 기록에도 그림이 서게 한다. `response_item` 쪽의 사본(그 `exec` 호출 결과 `custom_tool_call_output` 의 `input_image` 데이터 URL)은
/// 도구 결과 글로만 남고 그림 말이 되지 않으므로 겹치지 않는다. 그림 바이트(`result` base64)는 읽지 않는다.
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
// 말에 붙은 그림 — 쪽에는 자리만, 바이트는 한 장씩 (2026-10-24)
// ---------------------------------------------------------------------------

/// 그림 한 장의 상한 — 화면 그림(`doc-images.ts` 의 `DOC_IMAGE_MAX_BYTES`)과 같은 10 MB.
const IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;
/// 그림을 싣는 줄의 상한 — 넘는 줄의 그림은 자리를 내지 않는다(칩만). 그림 몇 장의 base64 가 들어갈 만큼.
const IMAGE_LINE_MAX_BYTES: u64 = 48 * 1024 * 1024;

/// 줄 안의 그림 블록들 — 줄 파서가 세는 차례 그대로(Claude 사용자 줄 `message.content[]` 의 `image` · Codex `response_item message` 의
/// `input_image`). 두 모양은 겹치지 않아 에이전트를 가리지 않는다.
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

/// 그리는 형식만 — png · jpeg · gif · webp.
fn image_mime(m: &str) -> Option<&'static str> {
    match m.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

/// 줄 안에 **바로 실린** 그림 하나 → (MIME, base64). Claude 붙여넣기 · 끌어 놓은 파일 = `source{type: base64, media_type, data}`(파일 경로는
/// 따로 선 `isMeta` 줄에만 있다) · Codex = `image_url: "data:<mime>;base64,…"`(2026-10-24 실측). 그 밖(주소 · 다른 형식)은 `None`.
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

/// 말에 붙은 그림 한 장의 **자리** (camelCase) — 그 줄의 시작 바이트 · 길이와 줄 안의 차례. 바이트는 싣지 않는다(쪽을 작게 —
/// 화면이 [`agent_conversation_image`] 로 한 장씩 받는다). **`Debug` 없음**.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptImage {
    pub at: u64,
    pub len: u64,
    pub n: u32,
    pub mime: &'static str,
}

/// 그림 줄의 상한 — 원격 명령이 창을 정하기 전에 본다.
pub(crate) fn image_line_max() -> u64 {
    IMAGE_LINE_MAX_BYTES
}

/// 한 줄의 그릴 수 있는 그림 자리들(**순수 함수**) — 줄이 너무 길면 없다.
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

/// 창 `[start, start + data.len())`(파일 크기 `size`)에서 그림 한 장의 바이트(**순수 함수**) — 로컬 · 원격이 같다. 자리가 **줄 하나와
/// 꼭 맞아야** 한다(앞 바이트가 줄바꿈 또는 파일 머리 · 뒤 바이트가 줄바꿈 또는 파일 끝 — 쪽 커서와 같은 검사). 상한 · 형식은 다시 본다.
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
    // base64 4 글자 = 3 바이트 — 풀기 전에 상한을 본다
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

/// `n` 자(유니코드 스칼라)에서 자른다 — (자른 글, 잘렸나).
fn cap(s: &str, n: usize) -> (String, bool) {
    match s.char_indices().nth(n) {
        Some((i, _)) => (s[..i].to_owned(), true),
        None => (s.to_owned(), false),
    }
}

/// 한 줄로 — 첫 줄(빈 줄이 아닌 것)만, 공백을 접고 [`SUMMARY_MAX_CHARS`] 에서 `…`.
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

/// 명령 배열 → 한 줄. `["bash","-lc","git status"]` 처럼 셸에 넘긴 것이면 마지막 인자, 아니면 공백으로 잇는다.
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

/// 요약에 쓰는 인자 이름 — 앞의 것이 이긴다.
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

/// 도구 입력 → 한 줄 요약("git status" · "src/x.ts"). 패치 글(`*** Update File: …`)이면 고친 파일들.
fn tool_summary(input: &Value) -> String {
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

/// 도구 입력 → 펼쳤을 때의 발췌. 명령이면 명령 글자 그대로, 글자면 그대로, 그 밖의 객체는 보기 좋은 JSON.
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

/// 도구 호출 한 번 (camelCase). **`Debug` 없음**.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// 도구 이름(`Bash` · `Edit` · `exec` …). 비었으면 호출을 못 만난 결과다.
    pub name: String,
    /// 한 줄 요약 — 없으면 빈 글자.
    pub summary: String,
    pub input: Option<String>,
    pub input_truncated: bool,
    /// 결과 — 아직 없으면(호출만 적혔다) `None`.
    pub output: Option<String>,
    pub output_truncated: bool,
    pub error: bool,
    /// 권한에서 거절돼 돌지 않았다(화면의 "거절됨" — `error` 보다 앞선다).
    pub denied: bool,
}

/// 항목 하나 (camelCase). `role` — `user` · `assistant` · `tool` · `interrupted`(끊긴 턴 — 글 없음). **`Debug` 없음**.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub role: &'static str,
    /// 말(사용자 · 에이전트)의 글자 — 이미 [`TEXT_MAX_CHARS`] 에서 자른 것.
    pub text: Option<String>,
    pub truncated: bool,
    /// 말에 붙은 이미지 수(글자로 옮기지 않는다).
    pub images: u32,
    /// 그중 줄에 바로 실려 그릴 수 있는 것의 자리([`TranscriptImage`]) — 없으면 칸이 없다. 나머지는 화면의 "그림 N" 칩.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pictures: Vec<TranscriptImage>,
    pub tool: Option<ToolCall>,
    /// 줄의 시각(epoch ms) — 없으면 `None`.
    pub at: Option<i64>,
    /// 사람 말 맨 앞의 **앱 연결 머리글**(사이드 채팅 — `side_chat::event::parse_link_note`)을 걷고 남긴 연결. 글에서는 걷혔다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<crate::side_chat::event::LinkNote>,
    /// 사람 말이 **앱이 깨움의 꼴**(프로듀서 채팅 — `orchestration::wake::parse_wake_note`: 틀 · id 형식 · 글 전체의 SHA-256). 표시용 —
    /// 화면이 그 앨범의 `wakes` 기록(SHA)과 한 번씩 맞출 때만 "앱이 깨움" 표지가 된다(사람이 같은 글을 쳐도 기록 한 줄에 한 번).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake: Option<crate::orchestration::wake::WakeTag>,
    /// 사람 말 맨 앞의 **앱 프로듀서 지침 머리글**(갈라 온 Codex 프로듀서의 첫 말 — `side_chat::event::parse_producer_brief` · 단계 5)을 걷었다.
    /// 글에서는 걷혔다(사람이 친 글만 남는다).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub brief: bool,
    /// 사람 말 맨 끝의 **파일 첨부 꼬리**(사이드 채팅 — `side_chat::event::parse_file_refs` · 판 32)에서 읽은 파일 이름. 글에서는 걷혔다
    /// (화면은 보낼 때와 같은 이름 칩으로 그린다).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

/// 한 쪽 — 오래된 것부터. `cursor` 가 있으면 더 오래된 것이 있다(다음 호출의 `before`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub items: Vec<TranscriptItem>,
    pub cursor: Option<u64>,
    /// **최신 쪽**(`before` 없음)에서 거꾸로 읽다 처음 만난 모델 · 강도 — AI 타일 대화 면 입력 칸의 모델 키워드(2026-11-13).
    /// 이 쪽이 훑은 줄 안에서만 찾는다(없으면 `None` — 화면은 앞서 받은 값을 쥔다). **표시 전용**: 화면은 이 글자를 터미널에 보내지
    /// 않는다(보내는 글은 고정 허용 목록의 낱말뿐 — `pane/flip-model.ts`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last: Option<LastModel>,
}

/// 마지막 답의 모델 · 강도. Claude = `type:"assistant"` 줄의 `message.model` · 같은 줄 최상위 `effort`, Codex = `type:"turn_context"` 의
/// `payload.model` · `payload.effort` (2026-11-13 사용자 PC 실측).
#[derive(Serialize, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Debug))]
pub struct LastModel {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// 그 값을 실은 줄의 **파일 안 바이트 자리**(줄 첫머리 — 원격 창도 파일 기준). 화면이 "메뉴로 덮어 둔 값 뒤에 새 답(값을 실은 줄)이
    /// 남았나" 를 이것으로만 가린다(2026-11-14 실기 — 새 턴의 사람 말 · 도구 항목으로 걷으면 옛 값이 돌아왔다). 덧붙이기만 하는 파일이라 줄마다 다르다.
    pub at: u64,
}

/// 모델 · 강도 이름의 최대 글자 수(표시용 — 넘으면 버린다).
const MODEL_MAX_CHARS: usize = 80;

/// 줄 하나의 모델 · 강도 — 두 CLI 의 모양이 겹치지 않아 줄 파서와 따로 한 함수다. Claude 의 `<synthetic>` 같은 꺾쇠 이름 · 부속
/// 에이전트(`isSidechain`) 줄은 뺀다(기록 보기와 같은 결).
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

/// 파일의 `[0, end)` 를 **끝에서부터** 줄 단위로 — `(줄이 시작하는 바이트, 줄 내용)`. 줄바꿈은 떼고, 빈 줄도
/// 그대로 낸다(부르는 쪽이 건너뛴다). 덩어리 경계에 걸친 줄은 다음 덩어리를 앞에 붙여 잇는다.
struct RevLines<R: Read + Seek> {
    f: R,
    /// 아직 읽지 않은 앞부분의 끝 — `buf` 는 `[pos, pos + buf.len())` 이다.
    pos: u64,
    buf: Vec<u8>,
    done: bool,
    /// 지금까지 읽은 바이트 — [`SCAN_MAX_BYTES`] 를 센다.
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

/// 한 줄에서 나온 사건들과 그 줄의 시각.
struct LineOut {
    at: Option<i64>,
    evs: Vec<Ev>,
    /// 이 줄의 그림 자리 — 그림이 붙은 말이 있을 때만 잰다.
    pics: Vec<TranscriptImage>,
}

/// 보이는 항목을 만드는 사건인가(결과는 호출에 붙으므로 세지 않는다).
fn counts(e: &Ev) -> bool {
    !matches!(e, Ev::ToolResult { .. } | Ev::Declined)
}

/// 사건 하나가 쪽에 싣는 글자 양(대강) — [`PAGE_MAX_BYTES`] 를 센다. 자르고 난 뒤의 크기로 센다.
fn weight(e: &Ev) -> usize {
    match e {
        Ev::Text { text, .. } => text.len().min(TEXT_MAX_CHARS * 4),
        Ev::ToolUse { input, .. } => 64 + input.to_string().len().min(INPUT_MAX_CHARS * 4),
        Ev::ToolResult { output, .. } => output.len().min(OUTPUT_MAX_CHARS * 4),
        Ev::Interrupted | Ev::Declined => 16,
    }
}

/// `before`(없으면 파일 끝) 앞에서 한 쪽을 읽는다. 몸통 — 시험은 임의의 `Read + Seek` 를 넘긴다.
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
            // 커서는 줄의 시작이어야 한다 — 파일 안이고 바로 앞 바이트가 줄바꿈
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
    // 최신부터 모은다 — 끝에서 뒤집는다
    let mut lines: Vec<LineOut> = Vec::new();
    let mut shown = 0usize;
    let mut bytes = 0usize;
    // 결과는 만났는데 호출은 아직 못 만난 id
    let mut orphans: HashSet<String> = HashSet::new();
    let mut extra = 0usize;
    // 먹은 가장 오래된 줄의 시작 — 다음 쪽의 커서
    let mut cursor = end;
    let mut more = false;
    // 최신 쪽이면 마지막 답의 모델 · 강도(`TranscriptPage::last`) — 최신부터 읽으니 처음 만난 것이 마지막이다
    let latest = before.is_none();
    let mut last: Option<LastModel> = None;
    while let Some((off, raw)) = rev.next_line().map_err(io)? {
        if raw.iter().all(u8::is_ascii_whitespace) {
            cursor = off;
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&raw) else {
            // 읽히지 않는 줄(쓰는 중인 마지막 줄 등) — 건너뛴다
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

/// 경로 맞대기용 꼴 — 구분자 `/` · 끝 `/` 없음 · Windows 는 소문자(대소문자를 가리지 않는 파일 시스템). **순수**.
fn norm_path(p: &str) -> String {
    let s = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// **AI 타일 대화 면의 첨부 경로 걷기**(2026-11-14) — 대화 면은 첨부를 글 **앞에** 경로 하나에 괄호 붙여넣기 하나씩 넣는다(프런트
/// `tileAttachPastes` = `shellQuote(경로) + " "` — Windows 경로는 `"…"`, POSIX 는 `'…'` 또는 그대로). 그 꼴의 낱말이 맨 앞부터 이어지고 그 경로가
/// 앱 첨부 자리(`root` — [`norm_path`] 꼴) 바로 아래 `<64자 hex>/<이름>` 일 때만 (이름들, 남은 글). 사이의 그림 자리표 `[Image #N]` 는
/// 글에 남긴다(그림 경로는 CLI 가 이미 자리표 + 그림 블록으로 바꿨다 — 기록이 `pictures` 로 그린다). 하나도 없으면 `None` — 다른 폴더 ·
/// 상대 경로 · 글 가운데의 경로는 그대로 글이다. **순수**.
fn strip_attach_paths(text: &str, root: &str) -> Option<(Vec<String>, String)> {
    let mut names = Vec::new();
    // 그림 자리표(`[Image #N] ` — 두 CLI 가 그림 경로 붙여넣기를 바꾼 것)는 남기고 넘어간다(칩 차례가 그림 → 파일일 수 있다)
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
        // 낱말 뒤는 빈칸 하나(붙여넣기의 꼴) 또는 글 끝
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

/// 맨 앞의 `[Image #<수>]` + 빈칸 하나(또는 글 끝) — 그 뒤 글.
fn image_placeholder(s: &str) -> Option<&str> {
    let body = s.strip_prefix("[Image #")?;
    let digits = body.bytes().take_while(u8::is_ascii_digit).count();
    let after = body[digits..].strip_prefix(']').filter(|_| digits > 0)?;
    after.strip_prefix(' ').or((after.is_empty()).then_some(after))
}

/// 그림 이름인가(png · jpg · jpeg · gif · webp — 사이드 채팅 그림 판정과 같은 표).
fn is_image_name(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
}

/// 경로가 앱 첨부 자리 바로 아래 `<64자 소문자 hex>/<이름>` 이면 그 이름.
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

/// 오래된 것부터 놓인 줄들 → 항목들. 결과는 같은 id 의 호출에 붙인다.
fn assemble(lines: Vec<LineOut>) -> Vec<TranscriptItem> {
    // 앱 첨부 자리(서버가 아는 실제 경로 — 화면이 준 것이 아니다) · 맞대기용으로 고른 꼴
    let attach_root = crate::agent_attachments::attachments_root().ok().map(|p| norm_path(&p.to_string_lossy()));
    let mut items: Vec<TranscriptItem> = Vec::new();
    // 호출 id → 항목 번호
    let mut calls: HashMap<String, usize> = HashMap::new();
    for LineOut { at, evs, mut pics } in lines {
        for e in evs {
            match e {
                Ev::Text { who, text, images } => {
                    // 그림이 붙은 말은 줄에 하나뿐이다 — 그 말이 줄의 그림 자리를 가져간다
                    let pictures = if images > 0 { std::mem::take(&mut pics) } else { Vec::new() };
                    // 사람 말 맨 앞의 앱 연결 머리글은 걷어 칸으로(사이드 채팅 — 닮은 글 · 가운데 글은 그대로)
                    let wake = (who == Speaker::User).then(|| crate::orchestration::wake::parse_wake_note(&text)).flatten();
                    // 갈라 온 Codex 프로듀서의 첫 말 — 앞의 앱 지침 머리글은 걷는다(단계 5)
                    let briefed = (who == Speaker::User).then(|| crate::side_chat::event::parse_producer_brief(&text).map(str::to_owned)).flatten();
                    let brief = briefed.is_some();
                    let text = briefed.unwrap_or(text);
                    // 맨 끝의 파일 첨부 꼬리도 걷어 칸으로(사이드 채팅 — 꼴 그대로일 때만). 머리글보다 먼저 — 머리글만 있는 글의 `] ` 가 꼬리 앞에 남는다
                    let refs = (who == Speaker::User).then(|| crate::side_chat::event::parse_file_refs(&text).map(|(n, b)| (n, b.to_owned()))).flatten();
                    let (mut files, text) = match refs {
                        Some((names, body)) => (names, body),
                        None => (Vec::new(), text),
                    };
                    // AI 타일 대화 면이 맨 앞에 붙여 넣은 **앱 첨부 자리의 경로**(2026-11-14 — `tileAttachPastes`)도 걷어 칸으로. 그림 말이면 그림
                    // 경로는 칩 없이 걷기만(기록의 그림 블록이 `pictures` 로 그린다)
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
                    // 끝의 도구 줄 묶음에서 아직 결과가 없는 가장 가까운 호출(결과 줄은 이 표식보다 뒤에 온다)
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
// 턴의 끝 — 메신저 알림의 발췌 (docs/log/2026-09-27-discord-notify.md "대화에서 나온 글자")
// ---------------------------------------------------------------------------

/// 턴 끝을 찾으러 거꾸로 훑는 최대 바이트 — 긴 도구 출력이 이어져도 여기서 멈춘다(그때는 "없음").
const TURN_SCAN_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// 지금 턴의 끝에서 읽은 것 — 메신저가 **곧장** Discord 몸통에 붙인다(`crate::messenger`). 화면으로 돌려주지
/// 않고, **`Debug` 없음**(모듈 머리말 — 패닉·로그에 찍히지 않게).
#[derive(Default)]
pub(crate) struct TurnTail {
    /// 이번 턴의 **마지막 에이전트 글**(원문 — 자르고 다듬는 것은 부르는 쪽). 생각·도구 블록은 이미 빠져 있다.
    pub text: Option<String>,
    /// 마지막 에이전트 글 **뒤에** 선, 아직 결과가 없는 도구 호출의 이름 — 권한 물음이 묻는 도구.
    pub pending_tool: Option<String>,
}

/// 파일 끝에서 거꾸로 — 사람이 친 말(이번 턴의 시작)을 만나기 전의 마지막 에이전트 글과, 그 뒤의 결과 없는
/// 도구 호출. 몸통 — 시험은 임의의 `Read + Seek` 를 넘긴다.
fn turn_tail_from<R: Read + Seek>(f: R, size: u64, parse: LineEvents) -> std::io::Result<TurnTail> {
    let mut rev = RevLines::new(f, size);
    let mut out = TurnTail::default();
    let mut results: HashSet<String> = HashSet::new();
    // 가장 최근 도구 호출 하나만 본다 — 그것이 결과가 없으면 지금 묻고 있는 도구다.
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
                Ev::ToolUse { id, name, .. } => {
                    if !tool_seen {
                        tool_seen = true;
                        if !id.is_empty() && !results.contains(&id) && !name.trim().is_empty() {
                            out.pending_tool = Some(name);
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
                // 사람이 친 말 — 이번 턴의 시작이다. 그 앞은 지난 턴이다.
                Ev::Text {
                    who: Speaker::User, ..
                } => return Ok(out),
                Ev::Interrupted | Ev::Declined => {}
            }
        }
    }
    Ok(out)
}

/// 대화 파일 하나의 [`TurnTail`] — 못 읽으면 빈 것(부르는 쪽은 그 칸을 빼고 보낸다).
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
// 원격 — 서버의 파일을 **창** 하나씩 받아 같은 리더로 (docs/log/2026-09-27-remote-conversations.md "2단계")
// ---------------------------------------------------------------------------

/// 원격 파일의 한 조각 `[start, start + data.len())` 을 [`read_page_from`] 이 읽는 파일처럼 보이게 한다. 창 밖(앞)을
/// 읽으려 하면 `need_more` 를 세우고 실패한다 — 부르는 쪽이 더 넓은 창을 받아 다시 부른다(같은 쪽이 나온다: 리더는
/// 끝에서부터 같은 덩어리로 읽는다). 서버에는 아무것도 쓰지 않는다 — 창은 읽기(`tail -c` · `head -c`)로만 온다.
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

/// 창 하나로 쪽을 읽은 답.
pub(crate) enum WindowPage {
    Page(TranscriptPage),
    /// 창이 좁았다 — 더 앞까지 받아 다시.
    NeedMore,
}

/// 창 하나로 한 쪽 (**순수 함수**) — 로컬과 **같은 리더 · 같은 줄 파서**([`read_page_from`]). `size` 는 서버가 알려 준 파일
/// 크기, 창은 `before`(없으면 끝)에서 끝난다. 창이 파일 맨 앞(0)에서 시작하면 늘 끝까지 읽는다.
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

/// 원격 쪽의 기본 항목 수 — 로컬과 같다.
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

/// 열린 파일 손잡이의 한 쪽 — **오케스트레이션의 고정 파일 전용**(`orchestration::progress` — 그쪽이 그 CLI 폴더 · worktree cwd 를
/// **이 손잡이로** 검증했다, 리뷰 F7). 화면의 명령은 경로를 받지 않는다(id 로 색인에서만 — [`agent_conversation_transcript`]).
pub(crate) fn page_of_file(
    f: std::fs::File,
    before: Option<u64>,
    limit: Option<usize>,
    parse: LineEvents,
) -> Result<TranscriptPage, String> {
    let io = |e: std::io::Error| tr!(ko: "대화 파일을 읽지 못했습니다: {e}", en: "Could not read the conversation file: {e}");
    let size = f.metadata().map_err(io)?.len();
    let mut page = read_page_from(f, size, before, limit.unwrap_or(LIMIT_DEFAULT), parse)?;
    // 모델 · 강도는 AI 타일 대화 면의 표시 전용 — 오케스트레이션(MCP `read_worker`)으로는 싣지 않는다
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

/// 지난 대화 하나의 한 쪽 — 최신 쪽(`before` 없음) 또는 커서 앞의 더 오래된 쪽. 파일은 id 로 목록의 색인에서만
/// 찾는다(경로를 받지 않는다). 파일을 읽으므로 async + 블로킹 풀(docs/conventions.md "Tauri 명령은 기본 async").
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

/// 로컬 파일에서 그 자리의 창(`[at-1, at+len+1)` — 앞뒤 줄바꿈까지)을 읽어 그림 한 장.
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

/// 기록 속 사람 말에 **바로 실린** 그림 한 장(Claude 붙여넣기 · 끌어 놓은 파일의 base64 · Codex 데이터 URL) — 쪽이 알려 준 자리
/// ([`TranscriptImage`])의 줄을 다시 읽어 그 차례의 그림을 풀어 원시 바이트로(`ipc::Response`). 파일은 쪽과 같이 id 로 색인에서만 찾고
/// (경로를 받지 않는다) 자리는 줄 하나와 꼭 맞아야 한다([`image_in_window`]). png · jpeg · gif · webp · 10 MB 까지. 바이트는 화면으로만.
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
