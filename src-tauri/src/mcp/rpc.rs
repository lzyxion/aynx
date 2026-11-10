//! JSON-RPC 디스패치 — 순수 함수(소켓과 무관): 활동 도장([`activity_of`]) · [`dispatch`] ·
//! 도구 이름 → 구현 갈래([`tools_call`]) · 도구-결과 봉투 · JSON-RPC 봉투.
//!
//! **새 도구를 더할 때**: 스키마는 `schema.rs` `tools_list_result`, 갈래는 여기 [`tools_call`],
//! 구현은 역할별 파일(`sessions.rs`·`blocks.rs`·`plan.rs`·`plan_read.rs` · DB 는 `db.rs`).
//!
//! 불변식 (CLAUDE.md "보안 제약"):
//! - 원시 `send_command`(AI 문자열 → PTY) 갈래는 없다.
//! - **호출자(역할)에 따라** 목록 · 갈래가 다르다(2026-10-14 — `crate::orchestration`): 전역 토큰 = 지금 13개 그대로(조율 도구는
//!   `not-a-tile`) · 타일 토큰 = 전역과 같은 13개 · DB · 작업안 판정(**조율 도구 없음** — 부르면 모르는 도구) ·
//!   **프로듀서 채팅**(채팅 토큰 종류 `producer`) = 13(작업안은 스튜디오 칸) + DB + 타일 도구 + 조율 도구(자기 Run 만 · 요청마다 `runId` · `gen`
//!   확인 — `orchestration::tile`) · 작업자 = 작업자 도구만(13개도 조율 도구도 없다) · **사이드 채팅**(5단계 — `crate::chat_token`) = 세션 읽기
//!   도구 일곱만이고 호출마다 사람이 건 연결 하나만 본다(`chat_read`). 역할은 서버 표에서만 정한다.
//! - 오케스트레이션 도구는 컨텍스트 잠금 **앞**에서 갈라진다(거울을 보지 않는다 — `wait_run` 이 그 잠금 위에서 자지 않게).
//! - 승인·거절·취소 갈래는 없다 — 그것은 `crate::operations` 의 Tauri 명령뿐(AI 는 자가 승인 못 한다).
//! - 위임(`crate::delegation`)을 고치는 갈래도 없다 — 편집은 호스트 폼뿐.
//! - `wait_for_operation` 만 컨텍스트 잠금 **앞**에서 갈라진다(잠근 채로 자지 않는다).
//! - AI 권한(`delegation.toml`)은 `tools/call` 하나에 **한 번**, 컨텍스트 잠금 **앞**에서 읽어 모든 도구에
//!   넘긴다 — 호스트 권한을 바꾸면 다음 호출부터 바로 반영된다(캐시가 없다).
//! - DB 도구(`mcp/db.rs` — 쿼리 타일 3a · 3b)는 `wait_for_operation` 처럼 **잠금 앞**에서 갈라진다(쓰기 작업안 초안 `create_db_write_plan` 도 —
//!   저장만 하고 실행 · 승인 갈래는 여전히 없다). `tools/list` 는 DB 뒷면이 있으면 권한과
//!   무관하게 DB 도구 일곱을 늘 싣는다(2026-11-09) — 권한 없는 연결은 도구 호출에서 "없는 연결", 모자란 단계는 거절(호출마다 판정).

use serde_json::{json, Value};

use crate::context::Store;
use crate::operations::{OperationStore, ResultStore};
use crate::orchestration::{Caller, Orchestration};

use super::*;

// ---------------------------------------------------------------------------
// JSON-RPC 디스패치 — 순수 함수(테스트 대상). 소켓과 무관하다.
// ---------------------------------------------------------------------------

/// 요청 본문 하나를 **활동 도장**으로 바꾼다 — 순수 함수(소켓도 시계도 밖에 있다).
///
/// `None` = 도장을 찍지 않는다. 파싱이 안 되는 본문과 **우리가 답하는 셋이 아닌 메서드**가
/// 거기 든다(`notifications/*` · 모르는 메서드). 셋만 세는 이유는 이 값이 "AI 가 이 앱을
/// 실제로 쓰고 있다" 를 말하는 신호이기 때문이다 — 파싱도 안 되는 본문 하나로 불이 켜지면
/// 안 된다.
///
/// 이름은 `initialize` 의 `params.clientInfo.name` 에서만 온다(그 뒤 요청은 싣지 않는다).
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

/// 앞선 도장 위에 새 도장을 얹는다 — **시각은 늘 새것, 이름은 지워지지 않는다**.
///
/// 이름 없는 요청(`tools/call`)이 `initialize` 로 알아 둔 이름을 `None` 으로 덮으면, 붙어
/// 있는 내내 "AI 연결됨" 만 뜨고 누구인지는 첫 몇 초에만 보인다. 새 클라이언트가 붙어
/// `initialize` 를 다시 보내면 그때 이름이 갈린다(마지막에 쓴 쪽이 이긴다).
pub(crate) fn merge_activity(prev: Option<&McpActivity>, next: McpActivity) -> McpActivity {
    McpActivity {
        client: next.client.or_else(|| prev.and_then(|p| p.client.clone())),
        at_ms: next.at_ms,
    }
}

/// 디스패치 결과: JSON 본문을 보낼지, 알림이라 202 로 끝낼지.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RpcReply {
    Json(String),
    Accepted,
}

/// JSON-RPC 2.0 요청 하나를 처리한다. 컨텍스트 저장소는 **잠그지 않은 채** 받는다 — 잠금은
/// 그것을 보는 도구 안쪽([`tools_call`])에서만 잡힌다(`initialize`·`tools/list` 는 아예 잠그지
/// 않고, `wait_for_operation` 은 잠금 앞에서 갈라져 나간다).
///
/// - `id` 가 없으면 알림 → [`RpcReply::Accepted`](202, 본문 없음).
/// - `initialize` / `tools/list` / `tools/call` 은 결과를, 모르는 메서드는 JSON-RPC 오류를 준다.
/// - `tools/call` 안의 오류(모르는 세션 등)는 **전송 오류가 아니라** `isError:true` 결과다.
///
/// `caller` 는 `http.rs` 가 토큰으로 정한 호출자, `orch` 는 오케스트레이션 저장소(역할 도구가 쓴다 — 시험의 단독 서버는 `None`).
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

/// [`dispatch`] 의 시험용 — DB 뒷면 없이(DB 도구가 목록에 없다) AI 권한만 손으로 짠 것으로.
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

/// 전역 토큰의 디스패치 — AI 권한을 **어디서 읽을지**와 DB 뒷면을 받는다(테스트는 손으로 짠 위임 · 가짜 뒷면을 넣는다).
/// 호출자 = 전역 · 오케스트레이션 저장소 없음 — 알맹이는 [`dispatch_as`].
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

/// [`dispatch`] 의 알맹이 — 호출자 · 오케스트레이션 저장소 · AI 권한 읽기 · DB 뒷면을 받는다.
/// `load_delegation` 은 `tools/call`(`wait_for_operation` · 오케스트레이션 도구 제외)일 때 한 번 불린다(`tools/list` 는 권한을 읽지 않는다 —
/// DB 도구는 늘 싣는다).
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
    // `id` 부재 = 알림. (`notifications/initialized` 등은 여기로 떨어진다.)
    let Some(id) = v.get("id") else {
        return RpcReply::Accepted;
    };
    let id = id.clone();

    match method {
        // 안내(설계 3-6 · 2단계 2-7): 오케스트레이션 절은 조율 도구가 목록에 실리는 프로듀서 채팅(과 시험의 조정자)에만. 타일은 맡긴 저장소가
        // 하나라도 있으면 안내 한 줄(사람에게 오케스트레이션 탭 · [오케스트레이션으로 이어 가기]를 안내 — 조율 도구는 없다).
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
        // DB 도구는 DB 뒷면이 있으면 **권한과 무관하게 일곱 다** 싣는다(2026-11-09 — CLI 는 목록을 캐시하고 이 서버는 `list_changed` 를
        // 보내지 않는다: 단계로 거르면 사람이 권한을 올려도 재연결 전에는 도구가 없었다). 판정은 호출마다 서버(`mcp/db.rs`). 전역 · 타일 ·
        // 프로듀서는 같은 목록을 받는다(조정자에게 더 주지도 덜 주지도 않는다) — 작업자 · 검토자 · 사이드 채팅은 DB 도구가 없다.
        "tools/list" => {
            let (with_db, listed) = match caller {
                Caller::Worker { .. } | Caller::Reviewer { .. } | Caller::SideChat { .. } => (false, false),
                // 프로듀서 — `listed` 자리는 "작업안 도구를 싣나"(띄울 때 토큰 칸에 고정한 값 — O5 · 새 프로듀서부터).
                Caller::Producer { chat, proc } => (db.has_backend(), crate::chat_token::plan_tools_listed(chat, *proc)),
                // 전역 · 타일 · (시험의) 조정자 — 13 + DB. 조율 도구는 조정자에게만(`tools_list_for`).
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


/// **프로듀서 작업안 도구**(2단계 단계 2 — 사용자 결정 O5): 이 이름들은 스튜디오 칸 "프로듀서 작업안 도구"가 켜졌을 때만 프로듀서 목록에
/// 실리고(띄울 때 값), 호출마다 **지금** 맡기기 값으로 다시 판정한다(꺼졌으면 [`PRODUCER_PLAN_TOOLS_OFF`]).
pub(crate) use crate::chat_token::PRODUCER_PLAN_TOOLS;

/// 프로듀서가 작업안 도구를 불렀는데 그 스튜디오의 칸이 지금 꺼져 있다.
pub(crate) const PRODUCER_PLAN_TOOLS_OFF: &str = "producer-plan-tools-off";

/// 그 스튜디오의 지금 맡기기에서 "프로듀서 작업안 도구" 값(적용 중인 블록만 — 아니면 거짓 · 블로킹: 파일 · git).
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
    /// 시험 — 지금 맡기기 값 대신(`None` = 진짜 맡기기).
    pub(crate) static PLAN_TOOLS_NOW_FOR_TEST: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// `tools/call` 을 도구별로 나눈다. 성공/실패 모두 MCP 도구-결과 모양으로 감싼다.
///
/// 읽기 전용 도구는 컨텍스트 `map`(·결과 `results`)만 본다. 단계 8 작업안 도구는 `ops`(·`signal`)를
/// 쓴다 — **저장·검토 요청뿐, 실행은 없다**. `get_operation_results`(단계 9 결과 읽기)는 `results`
/// 를 읽고 `map` 으로 대상별 공유 권한을 재검사한다 — **읽기 전용**이다. 작업안·결과 잠금은 이
/// 함수 안에서 컨텍스트 잠금을 잡은 **뒤에** 잡히므로 락 순서(컨텍스트→작업안)는 그대로다.
///
/// **[`wait_for_operation`] 만 컨텍스트 잠금 앞에서 갈라져 나간다** — 컨텍스트를 한 글자도 보지
/// 않는 도구인데 최대 120초를 잔다. 잠근 채로 들어가면 그동안 거울 갱신도 다른 읽기 도구도
/// 멈춘다(모듈 문서 "요청 하나에 스레드 하나").
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

    // 사이드 채팅(5단계) — 갈래 맨 앞에서 따로 간다: 세션 읽기 도구 일곱만 · 사람이 건 연결 하나만(`chat_read` — 요청마다 판정).
    // 작업안 · DB · 조율 · `wait_for_operation` 갈래에 닿지 않는다.
    if let Caller::SideChat { chat } = caller {
        return tool_result(super::chat_read::call(chat, name, args, store, load_delegation));
    }

    // 역할 도구 — 컨텍스트를 보지 않으므로 잠금 **앞**에서 갈라진다(`wait_run` 이 거울 잠금 위에서 자지 않게).
    if let Some(n) = name {
        // 전역 토큰(`mcp.json`)에는 조율이 없다 — 조정자는 로컬 AI 타일의 토큰으로만(3차 4단계 · 설계 3-1).
        if matches!(caller, Caller::Global)
            && (crate::orchestration::COORDINATOR_TOOLS.contains(&n) || crate::orchestration::TILE_TOOLS.contains(&n))
        {
            return tool_result(Err(format!(
                "{}: coordination tools need an AYNX AI tile's own token — the shared token cannot coordinate a run",
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
    // (O5) 프로듀서의 작업안 도구 — 목록에 있어도 호출마다 지금 맡기기 값으로 다시 판정한다(켜면 기존 관문 그대로 — 아래 갈래).
    if let (Caller::Producer { chat, proc }, Some(n)) = (caller, name) {
        if PRODUCER_PLAN_TOOLS.contains(&n) && !producer_plan_tools_now(chat, *proc, orch) {
            return tool_result(Err(format!(
                "{PRODUCER_PLAN_TOOLS_OFF}: task plan tools are off for this studio's producer — the person turns them on in AYNX (orchestration settings); ask a person to plan it from an AI tile meanwhile"
            )));
        }
    }
    // 작업자는 13개 도구를 받지 않는다(설계 C-1 — 1차) — 목록에 없는 이름은 모르는 도구.
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
    // DB 쓰기 작업안 초안(쿼리 타일 3b) — 작업안 저장소에 넣을 뿐(실행 · 연결 없음). 컨텍스트를 보지 않는다.
    if name == Some(super::db::WRITE_PLAN_TOOL) {
        // 요청한 타일의 이름표(승인 요약 — 메신저의 "요청" 줄)만 거울에서 읽고 곧바로 놓는다(작업안 잠금은 그 뒤 — 락 순서).
        let requested_by = store.lock().ok().and_then(|m| super::plan::requester_label(caller, &m));
        return tool_result(super::db::create_write_plan(args, &load_delegation(), db, ops, requested_by));
    }
    // DB 도구(쿼리 타일 3a) — 컨텍스트를 보지 않고 최대 60초 + 여유를 잔다. 권한(`delegation.toml`)은 호출마다 새로 읽는다.
    if let Some(n) = name.filter(|n| super::db::is_db_tool(n)) {
        return tool_result(super::db::call(n, args, &load_delegation(), db));
    }

    // AI 권한 — 파일 읽기라 **잠금 앞**에서 한 번(대상·세션마다 읽지 않는다).
    let delegation = load_delegation();
    // 창이 없는 동안 세션 서버가 잇는 거울(2026-11-09 — `crate::screen_mirror`)을 읽기 직전에 지금 화면으로(잠금 앞).
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
        // 단계 8 — 실행 없는 작업안 도구. 저장 + 검토 요청뿐이다.
        Some("create_execution_plan") => create_execution_plan(caller, map, &delegation, ops, args),
        Some("request_execution") => request_execution(ops, signal, args),
        Some("get_operation") => get_operation(ops, signal, args),
        // `wait_for_operation` 은 위에서(잠금 앞) 이미 갈라져 나갔다 — 여기 오지 않는다.
        // 단계 9 결과 읽기 — 대상별 출력을 **읽기 전용**으로. 실행·승인은 여전히 MCP 밖이다.
        Some("get_operation_results") => get_operation_results(map, &delegation, results, args, db),
        // 자동 승인 **범위 읽기** — 설정 파일을 읽어 요약할 뿐, 정책을 바꾸는 길은 여기 없다.
        Some("get_auto_approval_policy") => Ok(get_auto_approval_policy()),
        // AI 가 읽는 글자라 영어다 (i18n.rs 머리말 — MCP 표면은 표시 언어를 타지 않는다).
        Some(other) => Err(format!("Unknown tool: {other}")),
        None => Err("The tool name is missing".to_string()),
    };

    tool_result(outcome)
}

/// 도구 결과 하나를 MCP 도구-결과 모양으로 감싼다 — 성공은 텍스트 본문, 실패는 `isError:true`.
///
/// 잠금 앞에서 갈라지는 도구([`wait_for_operation`])와 잠금 뒤의 도구들이 **같은 모양**으로
/// 나가게 하는 자리다(감싸는 코드가 두 벌이 되면 한쪽만 바뀐다).
fn tool_result(outcome: Result<Value, String>) -> Value {
    match outcome {
        // 결과 JSON 을 문자열로 넣는 것이 MCP 도구-결과 관례다.
        Ok(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }]
        }),
        Err(msg) => tool_error(&msg),
    }
}

/// 도구 실행 오류를 `isError:true` 텍스트 결과로. (전송 계층은 여전히 200/정상이다.)
fn tool_error(msg: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}

// ---------------------------------------------------------------------------
// JSON-RPC 봉투
// ---------------------------------------------------------------------------

/// JSON-RPC 성공 응답 문자열.
fn ok_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// JSON-RPC 오류 응답 문자열.
pub(super) fn error_response(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}
