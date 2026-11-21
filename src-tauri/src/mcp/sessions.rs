//! 세션 읽기 도구 — 옵트인 게이트 [`shared_entry`] · 읽기 모드(`blocks`/`screen`) · `list_sessions`(와 관제판 목록) ·
//! `get_last_command` · `get_scrollback`.
//!
//! 불변식:
//! - **AI 읽기가 허용된 세션만** 본다([`crate::context::ai_readable`]). 미공유 세션은 존재도 숨긴다(없는 것과 같은 오류).
//! - `enrich_sessions` 의 칸은 **더하기만 한다** — 빼면 등록된 계약이 깨진다.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::{SessionContext, SCROLLBACK_CAP, SCROLLBACK_DEFAULT};

pub(super) fn shared_entry<'a>(
    map: &'a HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<&'a SessionContext, String> {
    let session = args
        .and_then(|a| a.get("session"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The session argument is required".to_string())?;
    match map.get(session) {
        Some(ctx) if crate::context::ai_readable(ctx, delegation) => Ok(ctx),
        _ => Err(format!("Unknown or unshared session: {session}")),
    }
}

// ---------------------------------------------------------------------------
// 세션의 읽기 모드 — `blocks` / `screen` (docs/log/2026-09-16-tmux-toggle.md)
// ---------------------------------------------------------------------------

const MODE_BLOCKS: &str = "blocks";
/// tmux 간이 모드 — 셸 통합 마커가 tmux 를 넘지 못해 블록이 영영 생기지 않는다.
pub(super) const MODE_SCREEN: &str = "screen";

pub(super) fn mode_of(ctx: &SessionContext) -> &'static str {
    if ctx.screen_only {
        MODE_SCREEN
    } else {
        MODE_BLOCKS
    }
}

pub(super) const SCREEN_ONLY_NOTE: &str = "This session is attached through tmux, a 'screen-only session' (mode: screen) — \
shell integration markers do not survive tmux, so no command blocks are created. Read the screen with get_scrollback.";

pub(super) fn list_sessions(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Value {
    enrich_sessions(map, delegation, config_index().as_ref())
}

use crate::ssh_config::{config_index, ConfigIndex};

/// 로컬 셸은 `None` — 관제판은 그 칸에 프런트가 이미 든 셸 이름을 쓴다. 빠른 접속 타일은 이름(`user@host[:port]`)이 곧 신원이다.
pub(super) fn session_user(kind: &str, label: &str, index: Option<&ConfigIndex>) -> Option<String> {
    if kind != "ssh" {
        return None;
    }
    if let Some(user) = adhoc_user(label) {
        return Some(user);
    }
    index?.get(&label.to_lowercase()).cloned().flatten()
}

pub(super) fn adhoc_user(label: &str) -> Option<String> {
    let (user, rest) = label.split_once('@')?;
    let ok = !user.is_empty()
        && !rest.is_empty()
        && !user.contains(':')
        && !user.chars().any(char::is_whitespace);
    ok.then(|| user.to_string())
}

/// 라이브 거울([`ai_readable`] 통과분)과 아직 접속하지 않은 헤드리스 위임 대상을 합친 세션 목록 — 순수 함수(테스트 대상).
///
/// 중복은 라이브가 이긴다(거울 키 `delegated:<alias>` 존재 여부 하나). 미접속 위임 항목은 읽기 전용 발견 항목일 뿐 실행 대상이 아니다.
/// `config` 가 `None` 이면 설정을 못 읽은 것 — 전부 `aliasKnown: true`·`user: null` 로 낸다.
pub(crate) fn enrich_sessions(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    config: Option<&ConfigIndex>,
) -> Value {
    // 코어 잠금은 이 한 문장 — 코어 잠금은 다른 잠금을 쥔 채 잡히지 않는다(컨텍스트 → 코어 순서만 있다).
    let core_states: HashMap<&str, (&'static str, u64)> = {
        let core = crate::session_core::core();
        map.keys()
            .filter_map(|k| core.status_of_stream(k).map(|s| (k.as_str(), s)))
            .collect()
    };
    let mut list: Vec<Value> = map
        .iter()
        .filter(|(_, c)| crate::context::ai_readable(c, delegation))
        .map(|(id, c)| {
            let running = matches!(c.status.as_deref(), Some("running"))
                || c.last.as_ref().is_some_and(|l| l.running);
            let last_exit = c.last.as_ref().and_then(|l| l.exit);
            let dropped =
                c.owner_kind == crate::session_owner::SessionOwnerKind::Delegated && c.disconnected;
            let core_status = core_states.get(id.as_str()).copied();
            let core_state = core_status.map(|(s, _)| s);
            let link_lost = core_state == Some("disconnected");
            // 떨어진 세션이라도 세션 서버의 해석기(`crate::screen_mirror`)가 잇고 있으면 낡지 않았다.
            let server_pen = core_state == Some("detached") && crate::screen_mirror::server_pen(id);
            let mirror = match core_state {
                Some("attached") => Some("window"),
                Some("detached") if server_pen => Some("server"),
                _ => None,
            };
            json!({
                "id": id,
                // 타일 헤더의 코드(`p2` / `t7·p2`) — 프런트가 준 값을 그대로 낸다. `id`(불투명 streamId)는 안정 신원이라 파싱하지 않는다.
                "code": c.code,
                "workspaceId": c.workspace_id,
                "workspace": c.workspace_name,
                "tabKey": c.tab_key,
                "label": c.label,
                "kind": c.kind,
                "status": c.status,
                "running": running,
                "lastExit": last_exit,
                "lastCommand": c.last.as_ref().map(|l| l.command_line.clone()),
                "commands": c.history.len(),
                // 빈 이력과 "원래 블록이 생기지 않는다" 를 가르는 유일한 칸 — 없으면 AI 는 `commands: 0` 을 보고 기다린다.
                "mode": mode_of(c),
                "connected": !dropped && !link_lost,
                // 코어에 없는 세션(헤드리스 위임 · 옛 항목)은 null.
                "attached": core_state.map(|s| s == "attached"),
                // 떨어진 세션의 거울은 지우지 않는다 — `stale` 은 지금 아무도 거울을 잇지 않을 때만 참이다.
                "state": core_state,
                "sessionEpoch": core_status.map(|(_, e)| e),
                "stale": core_state.is_some_and(|s| s != "attached") && !server_pen,
                "mirror": mirror,
                "dropped": dropped,
                // 라이브 항목은 언제나 참 — 고아 판정은 붙은 적 없는 합성 항목에만 쓴다.
                "aliasKnown": true,
                // 호스트가 'YOLO' — AI 가 그 무게를 알고 계획하게 밝힌다(별칭은 이미 `label` 에 있다 — 새로 나가는 것 없음).
                "approveAll": crate::context::ai_approve_all(c, delegation),
                // ── 관제판 호스트별 목록의 네 칸 ──
                "user": session_user(&c.kind, &c.label, config),
                // 0 은 "모른다" 라 null.
                "connectedAt": (c.connected_at != 0).then_some(c.connected_at),
                "lastActivityAt": c.history.last().map(|b| b.ended_at.unwrap_or(b.started_at)),
                "windowLabel": match c.owner_kind {
                    crate::session_owner::SessionOwnerKind::Delegated => Value::Null,
                    crate::session_owner::SessionOwnerKind::Window if !c.owner.is_empty() => {
                        json!(c.owner)
                    }
                    _ => Value::Null,
                }
            })
        })
        .collect();

    // 미접속 위임 발견 항목 — 읽기만 준 호스트는 합성하지 않는다(그 호스트의 세션은 타일로만 보인다).
    for target in delegation.headless_targets() {
        let id = crate::routing::delegated_stream_id(&target.alias);
        if map.contains_key(&id) {
            continue;
        }
        list.push(json!({
            "id": id,
            "code": target.alias,
            "label": target.alias,
            "kind": "ssh",
            "status": Value::Null,
            "running": false,
            "lastExit": Value::Null,
            "lastCommand": Value::Null,
            "commands": 0,
            "mode": MODE_BLOCKS,
            "connected": false,
            "dropped": false,
            // 고아 위임의 유일한 단서 — 이 별칭이 아직 `~/.ssh/config` 에 있는가.
            "aliasKnown": match config {
                Some(index) => index.contains_key(&target.alias.to_lowercase()),
                // 설정을 못 읽었다 = 모른다 — 고아로 칠하지 않는다.
                None => true,
            },
            "user": session_user("ssh", &target.alias, config),
            "connectedAt": Value::Null,
            "lastActivityAt": Value::Null,
            "windowLabel": Value::Null
        }));
    }

    list.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Value::Array(list)
}

/// 관제판 목록(세션 서버 op `console_sessions`) — MCP `list_sessions` 와 같은 객체. **블로킹**(`delegation.toml` · `~/.ssh/config`) — 부르는 쪽이 블로킹 풀에서.
pub(crate) fn console_list(store: &crate::context::Store) -> Value {
    crate::screen_mirror::flush_dirty();
    let delegation = crate::delegation::Delegation::load_default();
    let index = config_index();
    let map = store.lock().unwrap_or_else(|e| e.into_inner());
    enrich_sessions(&map, &delegation, index.as_ref())
}

pub(crate) fn get_last_command(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    // 화면 전용 세션은 왜 비었는지를 같은 응답에 담는다 — 오류로 내면 "일시적 실패" 로 읽혀 AI 가 재시도 루프에 들어간다.
    if ctx.screen_only {
        return Ok(json!({ "mode": MODE_SCREEN, "screenOnly": true, "note": SCREEN_ONLY_NOTE }));
    }
    match &ctx.last {
        Some(cmd) => Ok(serde_json::to_value(cmd).unwrap_or(Value::Null)),
        None => Err("No command has run in this session yet".to_string()),
    }
}

pub(crate) fn get_scrollback(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    let requested = args
        .and_then(|a| a.get("lines"))
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(SCROLLBACK_DEFAULT)
        .clamp(1, SCROLLBACK_CAP);

    let total = ctx.scrollback.len();
    let start = total.saturating_sub(requested);
    let lines: Vec<&String> = ctx.scrollback[start..].iter().collect();
    Ok(json!({ "lines": lines }))
}
