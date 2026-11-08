//! 원격 창 ws 의 **프레임 모양**(R1a-3) — 순수 함수뿐(시험이 바이트를 본다). 받는 쪽은 `remote/polyfill.js`.
//!
//! ## 브라우저 → 관문
//!
//! | 종류 | 모양 |
//! | --- | --- |
//! | 텍스트 `invoke` | `{t:"invoke", id, cmd, args, headers?, reauth?}` — `args` 는 JSON(`Channel` 은 `"__CHANNEL__:<콜백 id>"`) · `reauth` 는 재확인 명령의 1회용 표(R1a-4 — `deny.rs`) |
//! | 이진 invoke(원시 본문 — `ipc::Request`) | `[3][id u32][머리 길이 u32][머리 JSON {cmd, headers?}][본문]` |
//! | 텍스트 `listen` | `{t:"listen", id, event, target, handler}` → 관문이 Rust 리스너를 대신 단다 |
//! | 텍스트 `unlisten` | `{t:"unlisten", id, event, eventId}` |
//! | 텍스트 `active` | `{t:"active"}` — 사람이 입력했다(원격 세션의 무입력 시계를 되감는다) |
//!
//! ## 관문 → 브라우저
//!
//! | 종류 | 모양 |
//! | --- | --- |
//! | 텍스트 `hello` | `{t:"hello", label, gen, version}` — 이것이 온 뒤에야 invoke 를 보낸다 |
//! | 텍스트 `res` | `{t:"res", id, ok, b}` — `b` = JSON 응답(성공) 또는 오류 값 |
//! | 이진 원시 응답 | `[2][id u32][본문]` — `ipc::Response`(ArrayBuffer 로 풀린다) |
//! | 이진 Channel | `[1][세대 u32][콜백 id u32][순번 u32][본문 종류 u8: 0 JSON · 1 원시][본문]` — 세대가 다른 프레임은 버린다 |
//! | 텍스트 `event` | `{t:"event", h, e, i, p}` — 콜백 id · 이벤트 이름 · 리스너 id · 페이로드(JSON) |
//! | 텍스트 `bye` | `{t:"bye", reason}` — 곧 닫는다(페이지는 다시 읽는다) |
//!
//! 정수는 모두 little-endian. 텍스트 프레임의 JSON 응답 본문은 Tauri 가 만든 JSON 문자열을 **그대로** 끼운다(다시 풀지 않는다).

use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::ipc::{InvokeResponse, InvokeResponseBody};

/// 이진 프레임 종류.
pub(crate) const KIND_CHANNEL: u8 = 1;
pub(crate) const KIND_RAW_RESPONSE: u8 = 2;
pub(crate) const KIND_RAW_INVOKE: u8 = 3;

/// 브라우저가 보내는 텍스트 프레임.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub(crate) enum ClientFrame {
    Invoke {
        id: u32,
        cmd: String,
        #[serde(default)]
        args: Value,
        #[serde(default)]
        headers: Map<String, Value>,
        /// 재확인 표(R1a-4) — 없으면 `None`.
        #[serde(default)]
        reauth: Option<String>,
    },
    Listen {
        id: u32,
        event: String,
        #[serde(default)]
        target: Value,
        handler: u32,
    },
    Unlisten {
        id: u32,
        event: String,
        #[serde(rename = "eventId")]
        event_id: u32,
    },
    Active,
}

/// 이진 invoke 한 장을 푼 것.
#[derive(Debug, PartialEq)]
pub(crate) struct RawInvoke {
    pub id: u32,
    pub cmd: String,
    pub headers: Map<String, Value>,
    pub body: Vec<u8>,
}

#[derive(Deserialize)]
struct RawHead {
    cmd: String,
    #[serde(default)]
    headers: Map<String, Value>,
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// `[3][id][머리 길이][머리][본문]` → [`RawInvoke`]. 모양이 틀리면 `None`.
pub(crate) fn parse_raw_invoke(b: &[u8]) -> Option<RawInvoke> {
    if b.first() != Some(&KIND_RAW_INVOKE) {
        return None;
    }
    let id = u32_at(b, 1)?;
    let head_len = u32_at(b, 5)? as usize;
    let head_end = 9usize.checked_add(head_len)?;
    let head: RawHead = serde_json::from_slice(b.get(9..head_end)?).ok()?;
    Some(RawInvoke {
        id,
        cmd: head.cmd,
        headers: head.headers,
        body: b[head_end..].to_vec(),
    })
}

/// 관문 → 브라우저 `hello`.
pub(crate) fn hello(label: &str, gen: u64, version: &str) -> String {
    serde_json::json!({ "t": "hello", "label": label, "gen": gen, "version": version }).to_string()
}

/// 관문 → 브라우저 `bye`.
pub(crate) fn bye(reason: &str) -> String {
    serde_json::json!({ "t": "bye", "reason": reason }).to_string()
}

/// 성공 JSON 응답 — Tauri 가 만든 JSON 문자열을 그대로 끼운다(빈 문자열은 `null`).
pub(crate) fn res_ok_json(id: u32, json: &str) -> String {
    let body = if json.trim().is_empty() { "null" } else { json };
    format!("{{\"t\":\"res\",\"id\":{id},\"ok\":true,\"b\":{body}}}")
}

/// 오류 응답.
pub(crate) fn res_err(id: u32, error: &Value) -> String {
    serde_json::json!({ "t": "res", "id": id, "ok": false, "b": error }).to_string()
}

/// 원시 응답 — 이진.
pub(crate) fn res_raw(id: u32, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + bytes.len());
    out.push(KIND_RAW_RESPONSE);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(bytes);
    out
}

/// 응답 하나 → 보낼 프레임.
pub(crate) enum Encoded {
    Text(String),
    Binary(Vec<u8>),
}

pub(crate) fn response(id: u32, response: &InvokeResponse) -> Encoded {
    match response {
        InvokeResponse::Ok(InvokeResponseBody::Json(json)) => Encoded::Text(res_ok_json(id, json)),
        InvokeResponse::Ok(InvokeResponseBody::Raw(bytes)) => Encoded::Binary(res_raw(id, bytes)),
        InvokeResponse::Err(e) => Encoded::Text(res_err(id, &e.0)),
    }
}

/// Channel 메시지 하나 — 이진. 세대(`gen`)는 연결마다 하나라 u32 로 접는다(그 연결 안에서만 견준다).
pub(crate) fn channel(gen: u64, callback: u32, index: usize, body: &InvokeResponseBody) -> Vec<u8> {
    let (kind, bytes): (u8, &[u8]) = match body {
        InvokeResponseBody::Json(s) => (0, s.as_bytes()),
        InvokeResponseBody::Raw(b) => (1, b.as_slice()),
    };
    let mut out = Vec::with_capacity(14 + bytes.len());
    out.push(KIND_CHANNEL);
    out.extend_from_slice(&(gen as u32).to_le_bytes());
    out.extend_from_slice(&callback.to_le_bytes());
    out.extend_from_slice(&(index as u32).to_le_bytes());
    out.push(kind);
    out.extend_from_slice(bytes);
    out
}

/// 이벤트 하나 — 페이로드는 Tauri 가 만든 JSON 문자열을 그대로.
pub(crate) fn event(handler: u32, name: &str, listener: u32, payload: &str) -> String {
    let name = Value::String(name.to_string());
    let payload = if payload.trim().is_empty() { "null" } else { payload };
    format!("{{\"t\":\"event\",\"h\":{handler},\"e\":{name},\"i\":{listener},\"p\":{payload}}}")
}

/// Tauri 이벤트 이름 규칙(영숫자 · `-` `/` `:` `_`) + 길이 상한 — 어기면 `listen_any` 가 패닉하므로 먼저 거른다.
pub(crate) fn valid_event_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 256
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'/' | b':' | b'_'))
}

/// 리스너 대상 — JS `listen` 의 `target`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ListenTarget {
    /// 대상 `Any`(프런트 `listen()` 의 기본) → `listen_any`.
    Any,
    /// 이 원격 창 자기 라벨(창·웹뷰 이벤트) → 숨은 창의 `listen`.
    Own,
    /// 다른 라벨 — 원격은 받지 않는다.
    Other,
}

pub(crate) fn listen_target(target: &Value, own_label: &str) -> ListenTarget {
    match target.get("kind").and_then(Value::as_str) {
        None | Some("Any") => ListenTarget::Any,
        Some(_) => match target.get("label").and_then(Value::as_str) {
            Some(l) if l == own_label => ListenTarget::Own,
            _ => ListenTarget::Other,
        },
    }
}
