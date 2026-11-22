//! JSON-RPC 디스패치 — 소켓과 무관한 순수 함수: 활동 도장 · [`dispatch`] · 도구 갈래([`tools_call`]) · 봉투.
//!
//! 불변식 (AGENTS.md "보안 제약"):
//! - 원시 `send_command`(AI 문자열 → PTY) 갈래는 없다.
//! - 승인·거절·취소 갈래는 없다 — 그것은 `crate::operations` 의 Tauri 명령뿐(AI 는 자가 승인 못 한다). 위임을 고치는 갈래도 없다.
//! - 호출자(역할)에 따라 목록 · 갈래가 다르고, 역할은 서버 표에서만 정한다: 전역 = 13(조율 도구는 `not-a-tile`) · 타일 = 13 + DB
//!   (조율 도구 없음 — 부르면 모르는 도구) · 프로듀서 채팅 = 13(작업안 도구는 앨범 구성 칸) + DB + 타일 도구 + 조율 도구(자기 Run 만 · 요청마다
//!   `runId` · `gen` 확인 — `orchestration::tile`) · 작업자 · 검토자 = 자기 도구만 · 사이드 채팅 = 세션 읽기 일곱 + 사람이 건 연결만(`chat_read`).
//! - 오케스트레이션 도구 · `wait_for_operation` · DB 도구는 컨텍스트 잠금 **앞**에서 갈라진다 — 잠근 채 자지 않게.
//! - AI 권한(`delegation.toml`)은 `tools/call` 하나에 **한 번**, 잠금 앞에서 읽는다 — 캐시가 없어 권한을 바꾸면 다음 호출부터 반영된다.
//! - DB 쓰기 작업안 초안 `create_db_write_plan` 은 저장만 한다 — 실행 · 승인 갈래는 없다.

use serde_json::{json, Value};

use crate::context::Store;
use crate::operations::{OperationStore, ResultStore};
use crate::orchestration::{Caller, Orchestration};

use super::*;

// ---------------------------------------------------------------------------
// JSON-RPC 디스패치
// ---------------------------------------------------------------------------

/// `None` = 도장을 찍지 않는다 — 파싱 안 되는 본문 · 답하는 셋이 아닌 메서드로 "AI 연결됨" 불이 켜지면 안 된다.
pub(crate) fn activity_of(body: &str, at_ms: i64) -> Option<McpActivity> {
    let v: Value = serde_json::from_str(body).ok()?;
    let method = v.get("method").and_then(Value::as_str)?;
    if !matches!(method, "initialize" | "tools/list" | "tools/call") {
        return None;
    }
    let client = v
        .get("params")
        .and_then(|p| p.get("clientInfo"))
        .and_then(|c| c.get("name"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned);
    Some(McpActivity { client, at_ms })
}

/// 시각은 늘 새것, 이름은 지워지지 않는다 — 이름 없는 `tools/call` 이 `initialize` 로 알아 둔 이름을 `None` 으로 덮지 않게.
pub(crate) fn merge_activity(prev: Option<&McpActivity>, next: McpActivity) -> McpActivity {
    McpActivity {
        client: next.client.or_else(|| prev.and_then(|p| p.client.clone())),
        at_ms: next.at_ms,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RpcReply {
    Json(String),
    Accepted,
}

/// 컨텍스트 저장소는 **잠그지 않은 채** 받는다 — 잠금은 그것을 보는 도구 안쪽([`tools_call`])에서만 잡힌다.
/// `tools/call` 안의 오류(모르는 세션 등)는 전송 오류가 아니라 `isError:true` 결과다.
#[allow(clippy::too_many_arguments)]
pub(crate) fn dispatch(
    caller: &Caller,
    orch: Option<&Orchestration>,
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    body: &str,
    db: &DbEnv,
) -> RpcReply {
    dispatch_as(
        caller,
        orch,
        store,
        ops,
        results,
        signal,
        body,
        crate::delegation::Delegation::load_default,
        db,
    )
}

#[cfg(test)]
pub(crate) fn dispatch_with(
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    body: &str,
    load_delegation: impl FnOnce() -> crate::delegation::Delegation,
) -> RpcReply {
    dispatch_full(store, ops, results, signal, body, load_delegation, &DbEnv::none())
}

#[cfg(test)]
pub(crate) fn dispatch_full(
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    body: &str,
    load_delegation: impl FnOnce() -> crate::delegation::Delegation,
    db: &DbEnv,
) -> RpcReply {
    dispatch_as(&Caller::Global, None, store, ops, results, signal, body, load_delegation, db)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn dispatch_as(
    caller: &Caller,
    orch: Option<&Orchestration>,
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    body: &str,
    load_delegation: impl FnOnce() -> crate::delegation::Delegation,
    db: &DbEnv,
) -> RpcReply {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return RpcReply::Json(error_response(&Value::Null, -32700, "Parse error")),
    };

    let method = v.get("method").and_then(Value::as_str).unwrap_or("");
    let Some(id) = v.get("id") else {
        return RpcReply::Accepted;
    };
    let id = id.clone();

    match method {
        // 오케스트레이션 절은 조율 도구가 목록에 실리는 프로듀서 채팅(과 시험의 조정자)에만 — 타일은 안내 한 줄뿐(조율 도구는 없다).
        "initialize" => {
            let kind = match caller {
                Caller::Worker { .. } | Caller::Reviewer { .. } => Instructions::Worker,
                Caller::SideChat { .. } => Instructions::SideChat,
                Caller::Producer { .. } | Caller::Coordinator { .. } => Instructions::Album,
                Caller::Global => Instructions::Base,
                Caller::Tile { .. } => Instructions::TileHint,
            };
            RpcReply::Json(ok_response(&id, initialize_result_for(kind)))
        }
        // DB 도구는 DB 뒷면이 있으면 권한과 무관하게 일곱 다 싣는다 — CLI 는 목록을 캐시하고 이 서버는 `list_changed` 를 보내지 않아,
        // 단계로 거르면 사람이 권한을 올려도 재연결 전에는 도구가 없다. 판정은 호출마다(`mcp/db.rs`).
        "tools/list" => {
            let (with_db, listed) = match caller {
                Caller::Worker { .. } | Caller::Reviewer { .. } | Caller::SideChat { .. } => (false, false),
                // 프로듀서 — `listed` = "작업안 도구를 싣나"(띄울 때 토큰 칸에 고정한 값).
                Caller::Producer { chat, proc } => (db.has_backend(), crate::chat_token::plan_tools_listed(chat, *proc)),
                _ => (db.has_backend(), false),
            };
            RpcReply::Json(ok_response(&id, tools_list_for(caller, with_db, listed)))
        }
        "tools/call" => {
            let result = tools_call(caller, orch, store, ops, results, signal, v.get("params"), load_delegation, db);
            RpcReply::Json(ok_response(&id, result))
        }
        _ => RpcReply::Json(error_response(&id, -32601, "Method not found")),
    }
}


/// 프로듀서 작업안 도구 — 앨범 구성 칸 "프로듀서 작업안 도구"가 켜졌을 때만 프로듀서 목록에 실리고(띄울 때 값),
/// 호출마다 **지금** 값으로 다시 판정한다(꺼졌으면 [`PRODUCER_PLAN_TOOLS_OFF`]).
pub(crate) use crate::chat_token::PRODUCER_PLAN_TOOLS;

pub(crate) const PRODUCER_PLAN_TOOLS_OFF: &str = "producer-plan-tools-off";

/// 그 앨범의 지금 "프로듀서 작업안 도구" 값(블로킹: 파일 · git).
fn producer_plan_tools_now(chat: &str, proc: crate::server::chat_proc::ProcId, orch: Option<&crate::orchestration::Orchestration>) -> bool {
    // 귀속은 서버 장부에서 읽는다. 앨범 판정 실패도 여기서 끝내며 스튜디오 값으로 돌아가지 않는다.
    if let Some(policy) = orch.and_then(|o| o.album_producer_policy(chat)) {
        return crate::chat_token::repo_of(chat, proc).is_some() && policy.is_ok_and(|(_, enabled, _)| enabled);
    }
    #[cfg(test)]
    if let Some(v) = PLAN_TOOLS_NOW_FOR_TEST.with(|c| c.get()) {
        let _ = (chat, proc);
        return v;
    }
    false
}

#[cfg(test)]
thread_local! {
    /// 시험 — 지금 값 대신(`None` = 진짜 값).
    pub(crate) static PLAN_TOOLS_NOW_FOR_TEST: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// 작업안 도구는 **저장·검토 요청뿐, 실행은 없다**. 작업안·결과 잠금은 컨텍스트 잠금 **뒤에** 잡힌다(락 순서).
#[allow(clippy::too_many_arguments)]
fn tools_call(
    caller: &Caller,
    orch: Option<&Orchestration>,
    store: &Store,
    ops: &OperationStore,
    results: &ResultStore,
    signal: &McpSignal,
    params: Option<&Value>,
    load_delegation: impl FnOnce() -> crate::delegation::Delegation,
    db: &DbEnv,
) -> Value {
    let name = params.and_then(|p| p.get("name")).and_then(Value::as_str);
    let args = params.and_then(|p| p.get("arguments"));

    // 사이드 채팅 — 맨 앞에서 따로 간다: 작업안 · DB · 조율 · `wait_for_operation` 갈래에 닿지 않는다.
    if let Caller::SideChat { chat } = caller {
        return tool_result(super::chat_read::call(chat, name, args, store, load_delegation));
    }

    // 역할 도구 — 컨텍스트를 보지 않으므로 잠금 **앞**에서 갈라진다(`wait_run` 이 거울 잠금 위에서 자지 않게).
    if let Some(n) = name {
        // 전역 토큰(`mcp.json`)에는 조율이 없다 — 조정자는 프로듀서 채팅의 채팅 토큰에 서버 표가 붙인 역할뿐이다.
        if matches!(caller, Caller::Global)
            && (crate::orchestration::COORDINATOR_TOOLS.contains(&n) || crate::orchestration::TILE_TOOLS.contains(&n))
        {
            return tool_result(Err(format!(
                "{}: coordination tools need an Aynx AI tile's own token — the shared token cannot coordinate a run",
                crate::orchestration::NOT_A_TILE
            )));
        }
        if crate::orchestration::is_tool_for(caller, n) {
            return tool_result(match orch {
                Some(o) => o.call_tool(caller, n, args),
                None => Err("internal: orchestration is not available".to_string()),
            });
        }
    }
    // 프로듀서의 작업안 도구 — 목록에 있어도 호출마다 지금 앨범 구성 값으로 다시 판정한다.
    if let (Caller::Producer { chat, proc }, Some(n)) = (caller, name) {
        if PRODUCER_PLAN_TOOLS.contains(&n) && !producer_plan_tools_now(chat, *proc, orch) {
            return tool_result(Err(format!(
                "{PRODUCER_PLAN_TOOLS_OFF}: task plan tools are off for this studio's producer — the person turns them on in Aynx (orchestration settings); ask a person to plan it from an AI tile meanwhile"
            )));
        }
    }
    // 작업자 · 검토자는 13개 도구를 받지 않는다 — 목록에 없는 이름은 모르는 도구.
    if matches!(caller, Caller::Worker { .. } | Caller::Reviewer { .. }) {
        return tool_result(Err(match name {
            Some(n) => format!("Unknown tool: {n}"),
            None => "The tool name is missing".to_string(),
        }));
    }

    // 잠금 **앞**의 갈래 — 여기 오는 도구는 컨텍스트를 보지 않는 것뿐이다.
    if name == Some("wait_for_operation") {
        return tool_result(wait_for_operation(ops, signal, args));
    }
    // DB 쓰기 작업안 초안 — 작업안 저장소에 넣을 뿐(실행 · 연결 없음).
    if name == Some(super::db::WRITE_PLAN_TOOL) {
        // 요청한 타일의 이름표만 거울에서 읽고 곧바로 놓는다(작업안 잠금은 그 뒤 — 락 순서).
        let requested_by = store.lock().ok().and_then(|m| super::plan::requester_label(caller, &m));
        return tool_result(super::db::create_write_plan(args, &load_delegation(), db, ops, requested_by));
    }
    // DB 도구 — 최대 60초 + 여유를 잔다. 권한은 호출마다 새로 읽는다.
    if let Some(n) = name.filter(|n| super::db::is_db_tool(n)) {
        return tool_result(super::db::call(n, args, &load_delegation(), db));
    }

    // AI 권한 — 파일 읽기라 **잠금 앞**에서 한 번.
    let delegation = load_delegation();
    // 창이 없는 동안 세션 서버가 잇는 거울을 읽기 직전에 지금 화면으로(잠금 앞).
    crate::screen_mirror::flush_dirty();

    let guard = match store.lock() {
        Ok(guard) => guard,
        Err(_) => return tool_error("internal error"),
    };
    let map = &*guard;

    let outcome: Result<Value, String> = match name {
        Some("list_sessions") => Ok(list_sessions(map, &delegation)),
        Some("get_last_command") => get_last_command(map, &delegation, args),
        Some("get_scrollback") => get_scrollback(map, &delegation, args),
        Some("list_commands") => list_commands(map, &delegation, args),
        Some("get_command") => get_command(map, &delegation, args),
        Some("get_session_snapshot") => get_session_snapshot(map, &delegation, args),
        Some("compare_command_results") => compare_command_results(map, &delegation, args),
        Some("create_execution_plan") => create_execution_plan(caller, map, &delegation, ops, args),
        Some("request_execution") => request_execution(ops, signal, args),
        Some("get_operation") => get_operation(ops, signal, args),
        Some("get_operation_results") => get_operation_results(map, &delegation, results, args, db),
        // 자동 승인 범위 읽기뿐 — 정책을 바꾸는 길은 여기 없다.
        Some("get_auto_approval_policy") => Ok(get_auto_approval_policy()),
        // AI 가 읽는 글자라 영어다(MCP 표면은 표시 언어를 타지 않는다).
        Some(other) => Err(format!("Unknown tool: {other}")),
        None => Err("The tool name is missing".to_string()),
    };

    tool_result(outcome)
}

/// 잠금 앞 · 뒤의 도구가 **같은 모양**으로 나가게 하는 한 자리다(감싸는 코드가 두 벌이 되면 한쪽만 바뀐다).
fn tool_result(outcome: Result<Value, String>) -> Value {
    match outcome {
        Ok(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }]
        }),
        Err(msg) => tool_error(&msg),
    }
}

fn tool_error(msg: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}

// ---------------------------------------------------------------------------
// JSON-RPC 봉투
// ---------------------------------------------------------------------------

fn ok_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

pub(super) fn error_response(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}
