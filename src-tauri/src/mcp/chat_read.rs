//! **사이드 채팅의 읽기 도구**(사이드 채팅 v2 5단계 — 설계 docs/log/2026-10-23-side-chat-v2-design.md 8절 1 (a) · v1 결정 10 "세션 연결 칩").
//! 호출자 `Caller::SideChat{chat}`(토큰 = `crate::chat_token` — 그 채팅의 지금 프로세스 세대).
//!
//! 불변식:
//! - **목록은 늘 같다** — 세션 읽기 도구 일곱([`TOOLS`] · 스키마는 전역 13개의 그 칸 그대로). DB · 작업안 · 결과 읽기 · 조율 도구는 없다.
//!   Codex 는 대화 중 목록 갱신을 받지 않으므로 "연결된 동안만" 은 목록이 아니라 **호출마다 서버 판정**이다([`scope`]).
//! - 판정 순서: 연결 없음 = `not-linked` → 연결된 세션이 거울에 없음(타일이 닫힘) = `linked-tile-closed` → 기존 읽기 권한
//!   (`crate::context::ai_readable` — 로컬 타일 'AI 읽기 허용' · 원격 호스트 AI 권한 읽기 전용 이상)이 아님 = `not-readable` → 다른 세션을
//!   가리킴 = `not-the-linked-session`. 지나면 **그 세션 하나만 든 거울**로 같은 읽기 구현을 부른다(`list_sessions` · `compare_command_results`
//!   도 그 하나만 본다).
//! - 대화 기록(CLI 대화 파일)은 여기서 나가지 않는다 — 대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나 그대로다.
//! - 연결을 바꾸는 갈래는 없다 — 연결은 사람이 칩으로만(서버 op `side_chat_link`).

use std::collections::HashMap;

use serde_json::Value;

use crate::context::{SessionContext, Store};

use super::*;

// 사이드 채팅이 받는 도구 — 세션 읽기 일곱(`crate::chat_token::READ_TOOLS` — CLI 미리 허용과 같은 목록).
use crate::chat_token::READ_TOOLS as TOOLS;

/// 거절 낱말(도구 결과의 앞머리 — `code: message`).
pub(crate) const NOT_LINKED: &str = "not-linked";
pub(crate) const LINKED_TILE_CLOSED: &str = "linked-tile-closed";
pub(crate) const NOT_READABLE: &str = "not-readable";
pub(crate) const NOT_THE_LINKED_SESSION: &str = "not-the-linked-session";

/// `initialize` 안내 — 사이드 채팅만 받는다(작업안 · DB 절 없음 — 그 도구가 없다).
pub(super) const INSTRUCTIONS: &str = "\
This server (the session server of the aynx app) lets this side chat read **one terminal tile that the person linked** with the Link chip under the input box — it runs nothing. \
When a link is set or changes, the person's next message starts with an app header like `[연결된 타일: <name> · 세션 <id>]`; pass that id as the `session` argument. \
With no link every tool answers not-linked: tell the person to link a tile first instead of retrying. \
Only the linked session is visible, and the app's read permission still applies (a local tile needs 'allow AI to read'; a remote tile needs its host's AI permission at Read only or higher) — \
on not-readable or linked-tile-closed tell the person exactly that. \
Whatever you read is sent to your model provider, so read only what the question needs (get_last_command or get_command before a long get_scrollback). \
A session with `mode:\"screen\"` (tmux) has no command blocks — read it with get_scrollback.";

/// 목록 — 전역 13개의 스키마에서 [`TOOLS`] 만(설명 · 입력 꼴은 그대로).
pub(super) fn tools_list() -> Value {
    let mut v = base_tools();
    if let Some(list) = v.get_mut("tools").and_then(Value::as_array_mut) {
        list.retain(|t| t.get("name").and_then(Value::as_str).is_some_and(|n| TOOLS.contains(&n)));
    }
    v
}

/// 도구 하나 — 연결 · 권한 판정([`scope`]) 뒤 그 세션 하나만 든 거울로 같은 읽기 구현을 부른다. 권한(`delegation.toml`)은 잠금 **앞**에서 한 번.
pub(super) fn call(
    chat: &str,
    name: Option<&str>,
    args: Option<&Value>,
    store: &Store,
    load_delegation: impl FnOnce() -> crate::delegation::Delegation,
) -> Result<Value, String> {
    let Some(name) = name else {
        return Err("The tool name is missing".to_string());
    };
    if !TOOLS.contains(&name) {
        return Err(format!("Unknown tool: {name}"));
    }
    let link = crate::chat_token::link_of(chat);
    let delegation = load_delegation();
    crate::screen_mirror::flush_dirty();
    let guard = store.lock().map_err(|_| "internal error".to_string())?;
    let scoped = scope(link.as_deref(), args, &guard, &delegation)?;
    drop(guard);
    run(name, &scoped, &delegation, args)
}

/// **판정 — 순수**(시험 대상): 연결 · 거울 · 읽기 권한 · 대상 세션. 지나면 그 세션 하나만 든 거울(복제)을 돌려준다.
pub(super) fn scope(
    link: Option<&str>,
    args: Option<&Value>,
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Result<HashMap<String, SessionContext>, String> {
    let Some(stream) = link else {
        return Err(format!(
            "{NOT_LINKED}: the person has not linked a tile to this side chat — ask them to pick one with the Link chip (연결) under the input box, then try again"
        ));
    };
    let Some(ctx) = map.get(stream) else {
        return Err(format!(
            "{LINKED_TILE_CLOSED}: the linked tile (session {stream}) is closed or not reporting — ask the person to link another tile"
        ));
    };
    if !crate::context::ai_readable(ctx, delegation) {
        let why = if ctx.kind == "ssh" {
            "its host's AI permission is below Read only (or the host is not in the host list)"
        } else {
            "'allow AI to read' is off for that tile"
        };
        return Err(format!(
            "{NOT_READABLE}: the person linked session {stream}, but the app does not let AI read it — {why}. Tell the person; only they can change it in the app"
        ));
    }
    let other = |s: &str| s != stream;
    if let Some(s) = args.and_then(|a| a.get("session")).and_then(Value::as_str) {
        if other(s) {
            return Err(format!("{NOT_THE_LINKED_SESSION}: this side chat may read only the linked session {stream}"));
        }
    }
    if let Some(list) = args.and_then(|a| a.get("sessions")).and_then(Value::as_array) {
        if list.iter().any(|v| v.as_str().is_none_or(other)) {
            return Err(format!("{NOT_THE_LINKED_SESSION}: this side chat may read only the linked session {stream}"));
        }
    }
    Ok(HashMap::from([(stream.to_string(), ctx.clone())]))
}

fn run(
    name: &str,
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    match name {
        "list_sessions" => Ok(list_sessions(map, delegation)),
        "get_last_command" => get_last_command(map, delegation, args),
        "get_scrollback" => get_scrollback(map, delegation, args),
        "list_commands" => list_commands(map, delegation, args),
        "get_command" => get_command(map, delegation, args),
        "get_session_snapshot" => get_session_snapshot(map, delegation, args),
        "compare_command_results" => compare_command_results(map, delegation, args),
        other => Err(format!("Unknown tool: {other}")),
    }
}
