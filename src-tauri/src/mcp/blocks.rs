//! 블록 이력·비교 도구 — `list_commands` · `get_command` · `get_session_snapshot` ·
//! `compare_command_results`.
//!
//! 불변식:
//! - 전부 [`shared_entry`] / [`crate::context::ai_readable`] 게이트를 지난다 — 미공유 세션은 조용히 빠진다.
//! - 출력은 발췌다(`truncated`) — 라이브 버퍼 전문은 아직 서빙하지 않는다(`fullAvailable:false`).

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::{CommandBlockMirror, SessionContext, HISTORY_CAP, HISTORY_DEFAULT};

use super::*;

// ---------------------------------------------------------------------------
// 블록 이력 도구 — `list_commands` · `get_command` (docs/log/2026-09-08-mcp-list-commands.md).
//
// 둘 다 [`shared_entry`] 를 지나므로 프라이버시 게이트는 한 곳 그대로다. 이력 자체도
// 옵트아웃되는 순간 저장소에서 비워지므로(`context::report`) 여기서 다시 거를 것이 없다.
// ---------------------------------------------------------------------------

/// 블록 하나의 **메타만** — 발췌 텍스트는 빼고 나가는 모양.
///
/// [`list_commands`] 가 이걸로 목록을 만들고 [`get_command`] 이 여기에 발췌를 얹는다.
/// 목록에서 출력 텍스트를 빼는 이유는 단순하다: 200블록 × 발췌면 응답이 MB 단위가 된다.
/// 필드 이름은 [`CommandBlockMirror`] 의 camelCase 계약과 같다.
///
/// `durationMs` 는 **여기서 계산한다** — 거울에 필드를 더하지 않는다. `startedAt`·`endedAt`
/// 이 이미 있으므로 저장할 값이 아니라 **낼 때 빼는 값**이고, 그래야 프런트 계약
/// (`push_session_block` 의 페이로드)이 그대로다. 아직 실행 중이면 `null`.
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

/// `list_commands` — `{ commands: [메타…], total }`, **최신순**(뒤에서부터).
///
/// 최신순인 이유: 이력을 묻는 질문은 거의 다 "방금 뭐가 실패했나" 다. 앞에서부터 주면
/// `limit` 이 정확히 필요 없는 쪽(가장 오래된 것)을 남긴다.
///
/// `total` 은 자르기 **전** 개수다 — `commands.len() < total` 이면 더 있다는 뜻이고,
/// `truncated`(발췌가 잘렸다)와는 다른 축이다.
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

    // 이력에는 **완료 블록만** 든다(`onblock` 이 `D` 에서만 발화). 그래서 "실행 중만" 필터는
    // 늘 빈 결과였다 — 실행 중 명령은 `get_last_command` 의 라이브 `last` 로 답한다.
    let list: Vec<Value> = ctx
        .history
        .iter()
        .rev()
        .take(limit)
        .map(block_meta)
        .collect();
    // 빈 목록이면 **왜** 비었는지를 같은 봉투에 담는다 (화면 전용 세션은 늘 비어 있다).
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
/// `"last"` 를 받는 이유는 왕복 하나를 아끼기 위해서다 — "마지막 명령의 출력" 은 가장 잦은
/// 질문인데 그러려고 `list_commands` 를 먼저 부르게 하면 번호만 읽고 버리는 응답이 하나 는다.
/// ([`get_last_command`] 와는 다른 것이다: 그쪽은 실행 중에도 매 전이마다 갱신되는 요약이고,
/// 이쪽은 `D` 에서 확정돼 이력에 박힌 블록이다.)
///
/// **`fullAvailable` 은 지금 고정 `false`** 다. 전문은 웹뷰 안 xterm 버퍼에 있고 MCP 는 별도
/// 스레드라 Rust→프런트 왕복(설계의 `full=true`)이 필요한데, 그건 관리뷰로 미뤘다
/// (docs/log/2026-09-08-block-history-design.md 의 소비자 순서 ⑤). 깃발을 **지금부터** 내보내는
/// 이유는 계약을 미리 세워 두기 위해서다 — 나중에 `true` 가 되어도 모양이 안 바뀐다.
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
            // 뒤에서 찾는다 — 최근 블록일수록 먼저 걸린다.
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
            // complete / partial / unavailable — "무출력" 과 "마커 유실로 못 읽음" 을 가른다.
            "capture": block.capture,
            // UTF-8 바이트 수(Rust 가 재계산 — 프런트 units 는 UTF-16 코드 유닛이라 다르다).
            "bytes": block.excerpt_bytes()
        }),
    );
    // 라이브 버퍼 전문은 아직 서빙하지 않는다 — 위 문서 주석 참고.
    obj.insert("fullAvailable".to_string(), Value::Bool(false));
    Ok(value)
}

// ---------------------------------------------------------------------------
// 구조화된 비교 도구 — `get_session_snapshot` · `compare_command_results`
// (로드맵 단계 7 · docs/log/2026-09-10-mcp-read-expansion.md).
//
// 둘 다 [`shared_entry`]/[`crate::context::ai_readable`] 게이트를 지나므로 프라이버시 규칙은 한 곳 그대로다.
// 새로 나가는 `capturedAt`(epoch ms)·`contextVersion`(갱신마다 +1)은 [`crate::context`] 의
// **신선도 가드**로, AI 가 오래된 거울을 현재 상태로 오인하지 않게 하는 값이다.
// ---------------------------------------------------------------------------

/// `get_session_snapshot` — 세션 하나의 **한눈 스냅샷**(다른 도구를 여러 번 부르지 않게).
///
/// `last` 는 라이브 요약([`SessionContext::last`])의 명령문·종료·실행 여부에, 시각만 **마지막
/// 이력 블록**의 것을 얹는다([`LastCommand`] 자체는 시각을 들지 않는다). `cwd` 도 가장 최근
/// 이력 블록에서 온다(라이브 요약엔 폴더가 없다). `scrollbackLines` 는 **줄 수**일 뿐 내용이
/// 아니다 — 내용은 `get_scrollback` 이 낸다. 아직 없는 정보(user·host·group·tags)는 넣지
/// 않는다 — `label` 이 곧 사람이 읽는 호스트명이다.
pub(super) fn get_session_snapshot(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    // `shared_entry` 가 이미 검증한 `session` 인자 = 거울 키(streamId) = 이 스냅샷의 `id`.
    let id = args
        .and_then(|a| a.get("session"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    // 가장 최근 이력 블록 — cwd 와 last 의 시각을 여기서 빌린다(이력은 오래된 것부터라 last()).
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
        // `list_sessions` 와 **같은 칸** — 이 세션에서 블록을 기대해도 되는가.
        "mode": mode_of(ctx),
        "cwd": recent.and_then(|b| b.cwd.clone()),
        "last": last,
        "commands": ctx.history.len(),
        "scrollbackLines": ctx.scrollback.len(),
        "capturedAt": ctx.captured_at,
        "contextVersion": ctx.context_version,
    }))
}

/// [`compare_command_results`] 가 동일 결과를 접어 담는 그룹 누적기.
///
/// 그룹 키는 `(exit, 발췌 머리+꼬리 조인)` 이다 — 같은 결과가 한 그룹으로 접히고, 그룹이
/// 여럿이면 그게 곧 세션 간 차이다.
struct ResultGroup {
    /// 그룹 판별 키 — 다른 세션이 이 키와 같으면 같은 그룹이다.
    key: (Option<i64>, String),
    exit: Option<i64>,
    head: Vec<String>,
    tail: Vec<String>,
    truncated: bool,
    /// 이 결과를 낸 세션들 — `{id, code, label}`.
    sessions: Vec<Value>,
}

/// 발췌 머리+꼬리를 그룹 키의 문자열 부분으로 접는다. 머리와 꼬리 사이에 레코드 구분자(U+001E)를
/// 넣어 "머리 끝줄 + 꼬리 첫줄" 이 우연히 다른 경계와 같아 보이지 않게 한다.
fn excerpt_key(head: &[String], tail: &[String]) -> String {
    format!("{}\u{1e}{}", head.join("\n"), tail.join("\n"))
}

/// `compare_command_results` — 여러 세션에서 **같은 명령의 결과**를 동일 출력끼리 접고 차이를 낸다.
///
/// - `command`(선택): 각 세션에서 commandLine 이 이를 **포함**하는(=일치도 포함) **가장 최근**
///   블록이 대상. 생략하면 각 세션의 **마지막 블록**.
/// - `sessions`(선택, id 배열): 생략하면 **AI 가 읽을 수 있는 모든 세션**. 목록에 넣어도 읽을 수
///   없는([`crate::context::ai_readable`] 아닌) 세션은 **조용히 빠진다** — 존재를 흘리지 않는다(프라이버시).
///
/// 대상 블록을 못 찾은 세션은 `unmatched` 에 id 만 남는다. 그룹은 **세션 수 내림차순**(안정
/// 정렬)으로 낸다 — 다수 결과가 앞, 소수(=이상치) 그룹이 뒤다.
pub(super) fn compare_command_results(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let command = args.and_then(|a| a.get("command")).and_then(Value::as_str);

    // 대상 세션 id 목록 — 명시하면 그 순서(단, 공유 아닌 건 뒤에서 걸러진다), 생략하면 공유 전체(정렬).
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
    // 화면 전용 세션 — `unmatched` 에도 들어가지만(대상 블록이 없으니 사실이다) 여기에 따로
    // 적어 **"이번에 안 돌렸다" 와 "원래 블록이 없다" 를 가른다**. 앞엣것은 다시 돌리면 되고
    // 뒤엣것은 몇 번을 비교해도 같다.
    let mut screen_only: Vec<String> = Vec::new();
    let mut groups: Vec<ResultGroup> = Vec::new();

    for id in &session_ids {
        // 읽을 수 있는 세션만 본다(원격=호스트 `read`·로컬=타일 읽기 허용). 미등록·미공유는 존재를
        // 흘리지 않게 **조용히 뛰어넘는다**.
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

        // 대상 블록: command 가 있으면 그것을 포함하는 가장 최근 블록, 없으면 마지막 블록.
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

    // 다수 결과가 앞으로 — 안정 정렬이라 동수 그룹은 처음 나온 순서를 지킨다.
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
        // `unmatched` 중 **원래 블록이 생기지 않는** 세션들(mode: screen). 비면 빈 배열이다.
        "screenOnly": screen_only,
        "summary": {
            "sessionsCompared": compared,
            "distinctGroups": groups.len(),
            "matched": matched
        }
    }))
}
