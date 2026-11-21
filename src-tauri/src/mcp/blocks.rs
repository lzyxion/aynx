//! 블록 이력·비교 도구 — `list_commands` · `get_command` · `get_session_snapshot` · `compare_command_results`.
//!
//! 불변식:
//! - 전부 [`shared_entry`] / [`crate::context::ai_readable`] 게이트를 지난다 — 미공유 세션은 조용히 빠진다(존재를 흘리지 않는다).
//! - 출력은 발췌다(`truncated`) — 라이브 버퍼 전문은 아직 서빙하지 않는다(`fullAvailable:false`).

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::{CommandBlockMirror, SessionContext, HISTORY_CAP, HISTORY_DEFAULT};

use super::*;

// ---------------------------------------------------------------------------
// 블록 이력 도구 — `list_commands` · `get_command` (docs/log/2026-09-08-mcp-list-commands.md)
// ---------------------------------------------------------------------------

/// 블록 하나의 메타만 — 목록에 발췌를 실으면 200블록 × 발췌로 응답이 MB 단위가 된다.
/// `durationMs` 는 낼 때 계산한다 — 거울에 칸을 더하면 프런트 계약(`push_session_block` 페이로드)이 바뀐다.
fn block_meta(b: &CommandBlockMirror) -> Value {
    json!({
        "id": b.id,
        "commandLine": b.command_line,
        "cwd": b.cwd,
        "startedAt": b.started_at,
        "endedAt": b.ended_at,
        "durationMs": b.ended_at.map(|e| (e - b.started_at).max(0)),
        "exit": b.exit,
        "running": b.running,
        "truncated": b.truncated
    })
}

/// `total` 은 자르기 **전** 개수다 — `truncated`(발췌가 잘렸다)와는 다른 축이다.
pub(super) fn list_commands(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    let limit = args
        .and_then(|a| a.get("limit"))
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(HISTORY_DEFAULT)
        .clamp(1, HISTORY_CAP);

    // 이력에는 완료 블록만 든다 — 실행 중 명령은 `get_last_command` 의 라이브 `last` 로 답한다.
    let list: Vec<Value> = ctx
        .history
        .iter()
        .rev()
        .take(limit)
        .map(block_meta)
        .collect();
    if ctx.screen_only {
        return Ok(json!({
            "commands": list,
            "total": ctx.history.len(),
            "mode": MODE_SCREEN,
            "screenOnly": true,
            "note": SCREEN_ONLY_NOTE
        }));
    }
    Ok(json!({ "commands": list, "total": ctx.history.len() }))
}

/// `get_command` — 메타 + `excerpt` + `fullAvailable`. `id` 는 숫자이거나 `"last"`.
///
/// `fullAvailable` 은 지금 고정 `false` 다 — 나중에 `true` 가 되어도 모양이 안 바뀌게 깃발을 미리 내보낸다
/// (docs/log/2026-09-08-block-history-design.md).
pub(super) fn get_command(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    // 화면 전용 세션에는 집을 블록이 없다 — "밀려난 번호" 로 오해할 오류 대신 이유를 말한다.
    if ctx.screen_only {
        return Err(SCREEN_ONLY_NOTE.to_string());
    }
    let id_arg = args
        .and_then(|a| a.get("id"))
        .ok_or_else(|| "The id argument is required (a block number or \"last\")".to_string())?;

    let block = match id_arg.as_str() {
        Some("last") => ctx
            .history
            .last()
            .ok_or_else(|| "No command block has been recorded in this session yet".to_string())?,
        Some(other) => return Err(format!("id must be a number or \"last\": {other}")),
        None => {
            let id = id_arg
                .as_i64()
                .ok_or_else(|| "id must be a number or \"last\"".to_string())?;
            ctx.history
                .iter()
                .rev()
                .find(|b| b.id == id)
                .ok_or_else(|| {
                    format!("That block is not in the history (it fell off, or the number is wrong): {id}")
                })?
        }
    };

    let mut value = block_meta(block);
    let obj = value.as_object_mut().expect("block_meta 는 언제나 객체다");
    obj.insert(
        "excerpt".to_string(),
        json!({
            "head": block.excerpt_head,
            "tail": block.excerpt_tail,
            "truncated": block.truncated,
            // "무출력" 과 "마커 유실로 못 읽음" 을 가른다.
            "capture": block.capture,
            // UTF-8 바이트 수 — 프런트 units 는 UTF-16 코드 유닛이라 다르다.
            "bytes": block.excerpt_bytes()
        }),
    );
    obj.insert("fullAvailable".to_string(), Value::Bool(false));
    Ok(value)
}

// ---------------------------------------------------------------------------
// 구조화된 비교 도구 — `get_session_snapshot` · `compare_command_results` (docs/log/2026-09-10-mcp-read-expansion.md)
// ---------------------------------------------------------------------------

/// `capturedAt`·`contextVersion` 은 신선도 가드다 — AI 가 오래된 거울을 현재 상태로 오인하지 않게 한다.
pub(super) fn get_session_snapshot(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    let id = args
        .and_then(|a| a.get("session"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    let recent = ctx.history.last();
    let last = match &ctx.last {
        Some(l) => json!({
            "commandLine": l.command_line,
            "exit": l.exit,
            "running": l.running,
            "startedAt": recent.map(|b| b.started_at),
            "endedAt": recent.and_then(|b| b.ended_at),
        }),
        None => Value::Null,
    };

    Ok(json!({
        "id": id,
        "code": ctx.code,
        "label": ctx.label,
        "kind": ctx.kind,
        "status": ctx.status,
        "mode": mode_of(ctx),
        "cwd": recent.and_then(|b| b.cwd.clone()),
        "last": last,
        "commands": ctx.history.len(),
        "scrollbackLines": ctx.scrollback.len(),
        "capturedAt": ctx.captured_at,
        "contextVersion": ctx.context_version,
    }))
}

struct ResultGroup {
    key: (Option<i64>, String),
    exit: Option<i64>,
    head: Vec<String>,
    tail: Vec<String>,
    truncated: bool,
    sessions: Vec<Value>,
}

/// 머리와 꼬리 사이의 레코드 구분자(U+001E) — "머리 끝줄 + 꼬리 첫줄" 이 다른 경계와 우연히 같아 보이지 않게.
fn excerpt_key(head: &[String], tail: &[String]) -> String {
    format!("{}\u{1e}{}", head.join("\n"), tail.join("\n"))
}

/// 읽을 수 없는 세션은 `sessions` 에 넣어도 조용히 빠진다 — 존재를 흘리지 않는다.
pub(super) fn compare_command_results(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let command = args.and_then(|a| a.get("command")).and_then(Value::as_str);

    let session_ids: Vec<String> = match args
        .and_then(|a| a.get("sessions"))
        .and_then(Value::as_array)
    {
        Some(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        None => {
            let mut ids: Vec<String> = map
                .iter()
                .filter(|(_, c)| crate::context::ai_readable(c, delegation))
                .map(|(k, _)| k.clone())
                .collect();
            ids.sort();
            ids
        }
    };

    let mut compared = 0usize;
    let mut matched = 0usize;
    let mut unmatched: Vec<String> = Vec::new();
    // 화면 전용 세션 — `unmatched` 에도 들어가지만 따로 적어 "이번에 안 돌렸다" 와 "원래 블록이 없다" 를 가른다.
    let mut screen_only: Vec<String> = Vec::new();
    let mut groups: Vec<ResultGroup> = Vec::new();

    for id in &session_ids {
        let Some(ctx) = map.get(id) else { continue };
        if !crate::context::ai_readable(ctx, delegation) {
            continue;
        }
        compared += 1;
        if ctx.screen_only {
            screen_only.push(id.clone());
            unmatched.push(id.clone());
            continue;
        }

        let block = match command {
            Some(cmd) => ctx
                .history
                .iter()
                .rev()
                .find(|b| b.command_line.contains(cmd)),
            None => ctx.history.last(),
        };
        let Some(block) = block else {
            unmatched.push(id.clone());
            continue;
        };
        matched += 1;

        let member = json!({ "id": id, "code": ctx.code, "label": ctx.label });
        let key = (
            block.exit,
            excerpt_key(&block.excerpt_head, &block.excerpt_tail),
        );
        match groups.iter_mut().find(|g| g.key == key) {
            Some(g) => g.sessions.push(member),
            None => groups.push(ResultGroup {
                key,
                exit: block.exit,
                head: block.excerpt_head.clone(),
                tail: block.excerpt_tail.clone(),
                truncated: block.truncated,
                sessions: vec![member],
            }),
        }
    }

    // 안정 정렬 — 동수 그룹은 처음 나온 순서를 지킨다.
    groups.sort_by_key(|g| std::cmp::Reverse(g.sessions.len()));

    let groups_json: Vec<Value> = groups
        .iter()
        .map(|g| {
            json!({
                "sessions": g.sessions,
                "exit": g.exit,
                "excerpt": { "head": g.head, "tail": g.tail, "truncated": g.truncated }
            })
        })
        .collect();

    Ok(json!({
        "command": command.unwrap_or("(the last one in each session)"),
        "groups": groups_json,
        "unmatched": unmatched,
        "screenOnly": screen_only,
        "summary": {
            "sessionsCompared": compared,
            "distinctGroups": groups.len(),
            "matched": matched
        }
    }))
}
