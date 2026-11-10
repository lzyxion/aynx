//! 사이드 채팅 v2 5단계 시험 — 호출자 `Caller::SideChat`(`crate::chat_token`)의 목록 · 안내 · 판정(`chat_read`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::chat_read::{scope, LINKED_TILE_CLOSED, NOT_LINKED, NOT_READABLE, NOT_THE_LINKED_SESSION};
use super::*;
use crate::context::{report, SessionContext, Store};
use crate::operations::{OperationStore, ResultStore};
use crate::orchestration::Caller;

fn mirror() -> HashMap<String, SessionContext> {
    let mut m = HashMap::new();
    report(&mut m, "sc-a".into(), "pwsh".into(), "local".into(), "p1".into(), true);
    report(&mut m, "sc-b".into(), "secret".into(), "local".into(), "p2".into(), false);
    // 호스트 목록 밖 원격 타일 — AI 권한 끔 고정.
    report(&mut m, "sc-r".into(), "web".into(), "ssh".into(), "p3".into(), true);
    m.get_mut("sc-a").unwrap().scrollback = vec!["a-line".into()];
    m
}

fn rpc(caller: &Caller, map: HashMap<String, SessionContext>, body: Value) -> Value {
    let store: Store = Arc::new(Mutex::new(map));
    let ops: OperationStore = Default::default();
    let results: ResultStore = Default::default();
    let signal = McpSignal::default();
    let reply = dispatch_as(
        caller,
        None,
        &store,
        &ops,
        &results,
        &signal,
        &body.to_string(),
        crate::delegation::Delegation::default,
        &DbEnv::none(),
    );
    match reply {
        RpcReply::Json(s) => serde_json::from_str(&s).unwrap(),
        RpcReply::Accepted => Value::Null,
    }
}

fn call(caller: &Caller, name: &str, args: Value) -> (bool, String) {
    let v = rpc(caller, mirror(), json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": name, "arguments": args } }));
    let r = &v["result"];
    (r["isError"].as_bool().unwrap_or(false), r["content"][0]["text"].as_str().unwrap().to_string())
}

/// 시험 `producer_tools_list`(2단계 단계 2 — 설계 2-7 · 사용자 결정 O5): 프로듀서 목록 = 13(작업안 여섯은 칸을 켰을 때만) + DB(뒷면이 있으면 늘 일곱 ·
/// 쓰기 초안도 같은 칸) + 타일 도구 + 조율 도구 전부 — 띄울 때의 칸 값으로 고정 · 안내는 오케스트레이션 절 · 작업안 도구 호출은 **지금** 칸
/// 값으로 다시 판정(꺼졌으면 `producer-plan-tools-off` — 목록에 있어도).
#[test]
fn producer_tools_list() {
    let names = |c: &Caller| -> Vec<String> {
        let v = rpc(c, mirror(), json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
        v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    };
    let p_off = crate::server::chat_proc::ProcId::next();
    let p_on = crate::server::chat_proc::ProcId::next();
    crate::chat_token::insert_producer_for_test("pc-tl-off", p_off, "C:/repo", false);
    crate::chat_token::insert_producer_for_test("pc-tl-on", p_on, "C:/repo", true);
    let off = Caller::Producer { chat: "pc-tl-off".into(), proc: p_off };
    let on = Caller::Producer { chat: "pc-tl-on".into(), proc: p_on };
    let l_off = names(&off);
    let l_on = names(&on);
    for t in crate::chat_token::READ_TOOLS.iter().chain(["adopt_run", "get_run", "wait_run", "spawn_worker", "complete_run"].iter()) {
        assert!(l_off.iter().any(|n| n == t) && l_on.iter().any(|n| n == t), "{t}");
    }
    for t in ["create_execution_plan", "request_execution", "get_operation", "wait_for_operation", "get_operation_results", "get_auto_approval_policy"] {
        assert!(!l_off.iter().any(|n| n == t), "꺼짐이면 목록에 없다: {t}");
        assert!(l_on.iter().any(|n| n == t), "켜짐이면 목록에: {t}");
    }
    let init = rpc(&off, mirror(), json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }));
    assert!(init["result"]["instructions"].as_str().unwrap().contains("album is already open"), "사람이 연 앨범 안내");
    // 호출마다 지금 값 — 목록에 있어도 꺼졌으면 거절, 켜졌으면 기존 관문으로.
    super::rpc::PLAN_TOOLS_NOW_FOR_TEST.with(|c| c.set(Some(false)));
    let (err, text) = call(&on, "get_auto_approval_policy", json!({}));
    assert!(err && text.starts_with("producer-plan-tools-off"), "{text}");
    super::rpc::PLAN_TOOLS_NOW_FOR_TEST.with(|c| c.set(Some(true)));
    let (err, text) = call(&on, "get_auto_approval_policy", json!({}));
    assert!(!err, "{text}");
    super::rpc::PLAN_TOOLS_NOW_FOR_TEST.with(|c| c.set(None));
    // 읽기 도구는 칸과 무관.
    let (err, _) = call(&off, "list_sessions", json!({}));
    assert!(!err);
    crate::chat_token::revoke("pc-tl-off", p_off);
    crate::chat_token::revoke("pc-tl-on", p_on);
}

/// 목록은 **늘** 세션 읽기 일곱(연결 여부 · 맡긴 저장소 · DB 권한과 무관 — Codex 는 대화 중 갱신을 받지 않는다) · 스키마는 전역의 그 칸 그대로 ·
/// 안내는 사이드 채팅 갈래(작업안 · DB 절 없음).
#[test]
fn side_chat_tools_are_the_seven_session_reads() {
    let c = Caller::SideChat { chat: "tlist01".into() };
    let v = rpc(&c, mirror(), json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    let tools = v["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, crate::chat_token::READ_TOOLS.to_vec());
    let global = base_tools();
    for t in tools {
        let same = global["tools"].as_array().unwrap().iter().find(|g| g["name"] == t["name"]).unwrap();
        assert_eq!(t, same, "스키마는 전역과 같다");
    }
    for bad in ["create_execution_plan", "request_execution", "get_operation", "wait_for_operation", "get_operation_results", "get_auto_approval_policy"] {
        assert!(!names.contains(&bad), "{bad}");
    }
    let init = rpc(&c, mirror(), json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }));
    let text = init["result"]["instructions"].as_str().unwrap();
    assert!(text.contains("linked") && text.contains("not-linked"), "{text}");
    assert!(!text.contains("create_execution_plan") && !text.contains("db_query") && !text.contains("start_run"));
}

/// 판정(순수) — 연결 없음 → 닫힌 타일 → 읽기 권한 → 다른 세션 순. 지나면 그 세션 하나만 든 거울.
#[test]
fn scope_judges_link_then_permission_then_target() {
    let m = mirror();
    let d = crate::delegation::Delegation::default();
    let err = |link: Option<&str>, args: Value| scope(link, Some(&args), &m, &d).unwrap_err();
    assert!(err(None, json!({})).starts_with(&format!("{NOT_LINKED}:")));
    assert!(err(Some("sc-gone"), json!({})).starts_with(&format!("{LINKED_TILE_CLOSED}:")));
    let off = err(Some("sc-b"), json!({ "session": "sc-b" }));
    assert!(off.starts_with(&format!("{NOT_READABLE}:")) && off.contains("allow AI to read"), "{off}");
    let remote = err(Some("sc-r"), json!({}));
    assert!(remote.starts_with(&format!("{NOT_READABLE}:")) && remote.contains("host"), "{remote}");
    assert!(err(Some("sc-a"), json!({ "session": "sc-b" })).starts_with(&format!("{NOT_THE_LINKED_SESSION}:")));
    assert!(err(Some("sc-a"), json!({ "sessions": ["sc-a", "sc-b"] })).starts_with(&format!("{NOT_THE_LINKED_SESSION}:")));
    assert!(err(Some("sc-a"), json!({ "sessions": [1] })).starts_with(&format!("{NOT_THE_LINKED_SESSION}:")));
    let ok = scope(Some("sc-a"), Some(&json!({ "session": "sc-a", "sessions": ["sc-a"] })), &m, &d).unwrap();
    assert_eq!(ok.keys().collect::<Vec<_>>(), vec!["sc-a"]);
    assert!(scope(Some("sc-a"), None, &m, &d).is_ok());
}

/// 디스패치 — 연결은 서버 표(`crate::chat_token`)에서만 읽고, 연결된 세션 하나만 · 기존 읽기 구현 그대로 · 작업안 · DB · 조율 · 대기 도구는
/// 모르는 도구(갈래 맨 앞에서 갈라진다).
#[test]
fn side_chat_reads_only_the_linked_session() {
    let chat = "tread01";
    let c = Caller::SideChat { chat: chat.into() };
    let (e, t) = call(&c, "list_sessions", json!({}));
    assert!(e && t.starts_with("not-linked:"), "{t}");
    crate::chat_token::set_link(chat, Some("sc-a".into()));
    let (e, t) = call(&c, "get_scrollback", json!({ "session": "sc-a" }));
    assert!(!e && t.contains("a-line"), "{t}");
    let (e, t) = call(&c, "list_sessions", json!({}));
    let rows: Value = serde_json::from_str(&t).unwrap();
    assert!(!e && rows.as_array().unwrap().len() == 1 && rows[0]["id"] == "sc-a", "{t}");
    let (e, t) = call(&c, "get_session_snapshot", json!({ "session": "sc-b" }));
    assert!(e && t.starts_with("not-the-linked-session:"), "{t}");
    for other in ["create_execution_plan", "request_execution", "wait_for_operation", "get_operation_results", "db_query", "get_run", "read_worker"] {
        let (e, t) = call(&c, other, json!({}));
        assert!(e && t.starts_with("Unknown tool"), "{other}: {t}");
    }
    // 다른 채팅의 연결은 보지 않는다.
    let (e, t) = call(&Caller::SideChat { chat: "tread02".into() }, "list_sessions", json!({}));
    assert!(e && t.starts_with("not-linked:"), "{t}");
    crate::chat_token::set_link(chat, Some("sc-b".into()));
    let (e, t) = call(&c, "get_scrollback", json!({ "session": "sc-b" }));
    assert!(e && t.starts_with("not-readable:"), "{t}");
    crate::chat_token::forget(chat);
}
