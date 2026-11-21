//! 사이드 채팅의 읽기 도구 — 호출자 `Caller::SideChat{chat}`(토큰 = `crate::chat_token`, 그 채팅의 지금 프로세스 세대).
//!
//! 불변식:
//! - **목록은 늘 같다** — 세션 읽기 도구 일곱([`TOOLS`]). DB · 작업안 · 결과 읽기 · 조율 도구는 없다. Codex 는 대화 중 목록 갱신을
//!   받지 않으므로 "연결된 동안만" 은 목록이 아니라 **호출마다 서버 판정**이다([`scope`]).
//! - 연결은 채팅마다 사람이 고른 세션들(최대 `LINKS_MAX`)이고, 읽기 권한(`crate::context::ai_readable`)은 연결된 세션마다 따로다.
//! - 대화 기록(CLI 대화 파일)은 여기서 나가지 않는다 — 대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나다(→ docs/invariants.md 전문 10).
//! - 연결을 바꾸는 갈래는 없다 — 연결은 사람이 칩으로만(서버 op `side_chat_link`).

use std::collections::HashMap;

use serde_json::Value;

use crate::context::{SessionContext, Store};

use super::*;

// `crate::chat_token::READ_TOOLS` — CLI 미리 허용과 같은 목록.
use crate::chat_token::READ_TOOLS as TOOLS;

/// 거절 낱말(도구 결과의 앞머리 — `code: message`).
pub(crate) const NOT_LINKED: &str = "not-linked";
pub(crate) const LINKED_TILE_CLOSED: &str = "linked-tile-closed";
pub(crate) const NOT_READABLE: &str = "not-readable";
pub(crate) const NOT_THE_LINKED_SESSION: &str = "not-the-linked-session";

pub(super) const INSTRUCTIONS: &str = "\
This server (the session server of the aynx app) lets this side chat read **the terminal tiles that the person linked** with the Link chip under the input box — it runs nothing. \
When the links are set or change, the person's next message starts with app headers, one per linked tile, like `[연결된 타일: <name> · 세션 <id>] [연결된 타일: <name> · 세션 <id>]`; \
pass one of those ids as the `session` argument (list_sessions shows the linked tiles you may read now). \
With no link every tool answers not-linked: tell the person to link a tile first instead of retrying. \
Only the linked sessions are visible, and the app's read permission still applies to each tile on its own (a local tile needs 'allow AI to read'; a remote tile needs its host's AI permission at Read only or higher) — \
on not-readable or linked-tile-closed tell the person exactly that. \
Whatever you read is sent to your model provider, so read only what the question needs (get_last_command or get_command before a long get_scrollback). \
A session with `mode:\"screen\"` (tmux) has no command blocks — read it with get_scrollback.";

pub(super) fn tools_list() -> Value {
    let mut v = base_tools();
    if let Some(list) = v.get_mut("tools").and_then(Value::as_array_mut) {
        list.retain(|t| t.get("name").and_then(Value::as_str).is_some_and(|n| TOOLS.contains(&n)));
    }
    v
}

/// 권한(`delegation.toml`)은 잠금 **앞**에서 한 번.
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
    let links = crate::chat_token::links_of(chat);
    let delegation = load_delegation();
    crate::screen_mirror::flush_dirty();
    let guard = store.lock().map_err(|_| "internal error".to_string())?;
    let scoped = scope(&links, args, &guard, &delegation)?;
    drop(guard);
    run(name, &scoped, &delegation, args)
}

/// 순수(시험 대상) — 지나면 연결 묶음 가운데 지금 읽을 수 있는 세션들만 든 거울(복제)을 돌려준다.
pub(super) fn scope(
    links: &[String],
    args: Option<&Value>,
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Result<HashMap<String, SessionContext>, String> {
    if links.is_empty() {
        return Err(format!(
            "{NOT_LINKED}: the person has not linked a tile to this side chat — ask them to pick one with the Link chip (연결) under the input box, then try again"
        ));
    }
    let not_linked = || format!("{NOT_THE_LINKED_SESSION}: this side chat may read only the linked sessions {}", links.join(", "));
    let mut named: Vec<&str> = Vec::new();
    if let Some(s) = args.and_then(|a| a.get("session")).and_then(Value::as_str) {
        named.push(s);
    }
    if let Some(list) = args.and_then(|a| a.get("sessions")).and_then(Value::as_array) {
        for v in list {
            named.push(v.as_str().ok_or_else(not_linked)?);
        }
    }
    for s in named {
        if !links.iter().any(|l| l == s) {
            return Err(not_linked());
        }
        readable_link(s, map, delegation)?;
    }
    let scoped: HashMap<String, SessionContext> = links
        .iter()
        .filter_map(|s| readable_link(s, map, delegation).ok().map(|c| (s.clone(), c.clone())))
        .collect();
    if scoped.is_empty() {
        // 읽을 수 있는 연결이 없다 — 연결 순서로 첫 연결의 까닭(하나일 때의 판정 그대로).
        if let Some(e) = links.iter().find_map(|s| readable_link(s, map, delegation).err()) {
            return Err(e);
        }
    }
    Ok(scoped)
}

fn readable_link<'a>(
    stream: &str,
    map: &'a HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Result<&'a SessionContext, String> {
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
    Ok(ctx)
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
