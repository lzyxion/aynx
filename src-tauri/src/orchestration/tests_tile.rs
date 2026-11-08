//! 3차 4단계 시험(헤드리스 설계 3-1 · 7-2 · 리뷰 D4 · 2단계 6절 전환) — **타일 MCP 토큰 · 조정자 묶음 · 조율 도구의 예상 `runId` · `gen` · 전이표 ·
//! 사람의 거두기**. 타일은 진짜 길로 만든다(`tile_token::FakeTile` — 세션 코어의 살아 있는 로컬 세션 + 타일 토큰 → `/mcp` 와 같은 인증). 타일은
//! **조정자 자리가 되지 못한다**(오케스트레이션 탭 2단계) — 자리 판정(`tile.rs`)은 시험 자리(`Seat::test` — 프로듀서 채팅 id 하나)의 호출자
//! `Caller::Producer{chat, ProcId::NONE}` 로 본다(진짜 프로듀서 토큰 · 시작 · 이어받기는 `tests_start` · `tests_producer`).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::store::*;
use crate::audit::AuditRecord;
use crate::server::chat_proc::ProcId;
use crate::tile_token::FakeTile;

struct H {
    o: Orchestration,
    _audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness_in(dir: Option<PathBuf>) -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let (tx, rx) = mpsc::channel();
    let o = Orchestration::with_clock(dir, emit, Some(tx), Arc::new(move || clock.fetch_add(1, Ordering::SeqCst)));
    o.set_ephemeral(true);
    H { o, _audit: Mutex::new(rx) }
}

fn harness() -> H {
    harness_in(None)
}

fn start(o: &Orchestration) -> String {
    o.start_run(StartRun {
        verify: None,
        name: "tile".into(),
        repo: "C:/repo".into(),
        worktree_dir: "C:/repo-wt".into(),
        limits: Limits::default(),
    })
    .unwrap()
    .0
}

/// 시험 자리(`bind_coordinator` 가 묶는 `Seat::test(chat)`)의 호출자 — 인증 뒤의 프로듀서 모양.
fn seat_caller(chat: &str) -> Caller {
    Caller::Producer { chat: chat.to_string(), proc: ProcId::NONE }
}

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

fn create(o: &Orchestration, c: &Caller, run: &str, gen: u32, req: &str) -> Result<Value, String> {
    o.call_tool(c, "create_task", Some(&json!({ "runId": run, "gen": gen, "requestId": req, "title": req, "goal": "g" })))
}

fn get_run(o: &Orchestration, c: &Caller) -> Result<Value, String> {
    o.call_tool(c, "get_run", Some(&json!({})))
}

fn tasks(o: &Orchestration, run: &str) -> usize {
    o.run_detail(run).unwrap()["tasks"].as_array().unwrap().len()
}

/// `/mcp` 디스패치(전역과 같은 저장소 · 오케스트레이션 저장소 꽂음).
fn mcp(caller: &Caller, o: &Orchestration, body: Value) -> Value {
    let store: crate::context::Store = Default::default();
    let ops: crate::operations::OperationStore = Default::default();
    let results: crate::operations::ResultStore = Default::default();
    let signal = crate::mcp::McpSignal::default();
    match crate::mcp::dispatch_as(
        caller,
        Some(o),
        &store,
        &ops,
        &results,
        &signal,
        &body.to_string(),
        || crate::delegation::Delegation::parse("").unwrap(),
        &crate::mcp::DbEnv::none(),
    ) {
        crate::mcp::RpcReply::Json(s) => serde_json::from_str(&s).unwrap(),
        crate::mcp::RpcReply::Accepted => panic!("결과를 기대했다"),
    }
}

fn names(caller: &Caller, o: &Orchestration) -> Vec<String> {
    let v = mcp(caller, o, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

// ---------------------------------------------------------------------------
// 조율 도구의 예상 runId · gen (D4)
// ---------------------------------------------------------------------------

/// 시험 `coordination_requires_expected_run_and_gen`(설계 7-2 · D4) — 조율 도구는 요청의 `runId` · `gen` 이 서버 묶음과 맞을 때만 선다:
/// 다른 Run = `stale-run`, 다른 세대 = `stale-generation`, 끝난 Run = `run-ended`, 조정자 아닌 채팅 = `not-coordinator`, 빠지면 `invalid-argument`
/// (`get_run` 만 생략 가능). **A Run 의 늦은 요청이 B Run 에 적용되지 않는다.**
#[test]
fn coordination_requires_expected_run_and_gen() {
    let h = harness();
    let a = start(&h.o);
    let b = start(&h.o);
    h.o.bind_coordinator(&a, 1, "pc-rg").unwrap();
    let ct = seat_caller("pc-rg");
    // 맞는 둘 — 선다. get_run 은 둘을 돌려준다(생략 가능).
    create(&h.o, &ct, &a, 1, "r1").unwrap();
    let g = get_run(&h.o, &ct).unwrap();
    assert_eq!((g["runId"].as_str(), g["gen"].as_u64()), (Some(a.as_str()), Some(1)));
    assert_eq!(h.o.call_tool(&ct, "get_run", Some(&json!({ "runId": a, "gen": 1 }))).unwrap()["runId"], a.as_str());
    // 다른 Run · 다른 세대 · 빠짐.
    assert_eq!(code(create(&h.o, &ct, &b, 1, "r2")), "stale-run");
    assert_eq!(code(create(&h.o, &ct, &a, 2, "r3")), "stale-generation");
    assert_eq!(code(h.o.call_tool(&ct, "get_run", Some(&json!({ "runId": b })))), "stale-run");
    assert_eq!(code(h.o.call_tool(&ct, "create_task", Some(&json!({ "runId": a, "requestId": "x", "title": "x", "goal": "g" })))), "invalid-argument");
    assert_eq!(code(h.o.call_tool(&ct, "wait_run", Some(&json!({ "gen": 1 })))), "invalid-argument");
    assert_eq!(code(h.o.call_tool(&ct, "create_task", Some(&json!({ "runId": a, "gen": "1", "requestId": "x", "title": "x", "goal": "g" })))), "invalid-argument");
    // 조정자 아닌 채팅 — 어느 Run 을 말해도 not-coordinator(있는지 없는지 흘리지 않는다).
    let co = seat_caller("pc-rg-other");
    assert_eq!(code(create(&h.o, &co, &a, 1, "o1")), "not-coordinator");
    assert_eq!(code(create(&h.o, &co, "run-00000000000000000000000000000000", 1, "o2")), "not-coordinator");
    assert_eq!(code(get_run(&h.o, &co)), "not-coordinator");
    // A 가 끝나고 같은 자리가 B 의 조정자가 됐다 — A 를 말하는 늦은 요청은 run-ended, B 에는 아무것도 안 생긴다.
    h.o.stop(&a).unwrap();
    assert_eq!(code(create(&h.o, &ct, &a, 1, "late")), "run-ended");
    h.o.bind_coordinator(&b, 1, "pc-rg").unwrap();
    let before = tasks(&h.o, &b);
    assert_eq!(code(create(&h.o, &ct, &a, 1, "late2")), "run-ended");
    assert_eq!(tasks(&h.o, &b), before, "A 의 늦은 요청이 B 에 적용되지 않았다");
    create(&h.o, &ct, &b, 1, "b1").unwrap();
    assert_eq!(tasks(&h.o, &b), before + 1);
    // 한 자리는 한 Run 만 — 이미 산 Run 의 조정자인 자리를 다른 산 Run 에 묶으면 already-coordinating.
    let c = start(&h.o);
    assert_eq!(h.o.bind_coordinator(&c, 1, "pc-rg").unwrap_err().code, reason::ALREADY_COORDINATING);
    // 스키마 — 조율 도구는 runId · gen 을 필수로 싣는다(get_run 은 선택).
    for s in super::coordinator_tool_schemas() {
        let name = s["name"].as_str().unwrap();
        let props = &s["inputSchema"]["properties"];
        assert!(props.get("runId").is_some() && props.get("gen").is_some(), "{name}");
        let required: Vec<&str> = s["inputSchema"]["required"].as_array().map(|r| r.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        if name == "get_run" {
            assert!(!required.contains(&"runId") && !required.contains(&"gen"));
        } else {
            assert!(required.contains(&"runId") && required.contains(&"gen"), "{name}: {required:?}");
        }
    }
}

/// 타일 호출자의 MCP 표면 — 타일 = 전역 13개(조율 · 타일 도구 없음 — 산 Run 이 있어도), 타일의 조율 호출 = 모르는 도구,
/// 묶인 자리(프로듀서)의 목록 = 13 + 타일 도구 + 조율 도구(작업안 칸 꺼짐이면 작업안 도구 없음). 전역 토큰의 조율 = `not-a-tile`.
#[test]
fn tile_list_has_no_coordination_and_global_is_not_a_tile() {
    let h = harness();
    let run = start(&h.o);
    let t = FakeTile::open("list");
    let ct = t.caller();
    let global = names(&Caller::Global, &h.o);
    assert_eq!(names(&ct, &h.o), global, "타일 = 전역");
    let r = mcp(&ct, &h.o, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "get_run", "arguments": {} } }));
    assert!(r["result"]["content"][0]["text"].as_str().unwrap().starts_with("Unknown tool: get_run"), "{r}");
    let r = mcp(&ct, &h.o, json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "list_sessions", "arguments": {} } }));
    assert!(r["result"].get("isError").is_none(), "타일도 13개를 쓴다: {r}");
    h.o.bind_coordinator(&run, 1, "pc-list").unwrap();
    assert_eq!(names(&ct, &h.o), global, "산 Run 이 있어도 타일 목록은 그대로");
    let bound = names(&seat_caller("pc-list"), &h.o);
    assert_eq!(&bound[bound.len() - super::preallowed_tools().count()..], super::preallowed_tools().map(String::from).collect::<Vec<_>>());
    let r = mcp(
        &seat_caller("pc-list"),
        &h.o,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "create_task", "arguments": { "runId": run, "gen": 1, "requestId": "m1", "title": "T", "goal": "g" } } }),
    );
    assert!(r["result"].get("isError").is_none(), "{r}");
    // 전역 토큰 — 조율은 not-a-tile(이름이 목록에 없어도 같은 말).
    let r = mcp(&Caller::Global, &h.o, json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "create_task", "arguments": { "runId": run, "gen": 1, "requestId": "g1", "title": "T", "goal": "g" } } }));
    assert!(r["result"]["content"][0]["text"].as_str().unwrap().starts_with("not-a-tile"), "{r}");
}

// ---------------------------------------------------------------------------
// 전이표(설계 3-1) — 행마다 하나
// ---------------------------------------------------------------------------

/// 행 "세션 open(AI 타일)" — 타일마다 새 토큰, 각자 자기 스트림으로 풀린다.
#[test]
fn transition_open_issues_token_per_tile() {
    let a = FakeTile::open("open-a");
    let b = FakeTile::open("open-b");
    assert_ne!(a.token, b.token);
    assert!(matches!(a.caller(), Caller::Tile { stream } if stream == a.stream));
    assert!(matches!(b.caller(), Caller::Tile { stream } if stream == b.stream));
}

/// 행 "GUI 재부착(F5 · 웹뷰 크래시 — 임대만 풀림)" — 토큰 그대로.
#[test]
fn transition_reattach_keeps_token() {
    let t = FakeTile::open("f5");
    let before = t.caller();
    t.reattach();
    assert_eq!(t.caller(), before);
}

/// 행 "조정자 프로세스 끝" — 묶음은 풀려 Run 은 paused(`coordinator-exited`), 그 자리의 옛 Run 조율은 `stale-run` · 묶인 Run 이 없으니 `get_run` 은
/// `not-coordinator`.
#[test]
fn transition_coordinator_exit_unbinds() {
    let h = harness();
    let run = start(&h.o);
    h.o.bind_coordinator(&run, 1, "pc-exit").unwrap();
    assert_eq!(h.o.coordinator_exited("pc-exit"), 1);
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!((d["state"].as_str(), d["pauseReason"].as_str()), (Some("paused"), Some("coordinator-exited")));
    let c = seat_caller("pc-exit");
    assert_eq!(code(create(&h.o, &c, &run, 1, "x")), "stale-run");
    assert_eq!(code(get_run(&h.o, &c)), "not-coordinator");
    assert_eq!(h.o.resume(&run).unwrap_err().code, "no-coordinator");
}

/// 행 "세션 재생성(회차 +1) · 세션 회수 · 타일 닫기" — 타일 토큰 폐기(옛 토큰 `stale-tile` · 회수 뒤엔 모르는 토큰). 새 회차는 새 토큰.
#[test]
fn transition_session_end_revokes_tile_token() {
    let mut t = FakeTile::open("sessend");
    // 셸이 끝났다(붙은 채 · 회수 전) — 토큰은 표에 있지만 stale.
    t.exit();
    assert_eq!(crate::tile_token::authenticate(Some(&t.header())), Some(crate::tile_token::Auth::Stale));
    t.close();
    assert_eq!(crate::tile_token::authenticate(Some(&t.header())), None, "회수 뒤엔 모르는 토큰(401)");
    // 같은 타일(스트림)의 새 세션 — 새 토큰 · 옛 토큰은 아무도 아니다.
    let old = t.recreate();
    assert_ne!(old, t.token);
    assert_eq!(crate::tile_token::authenticate(Some(&format!("Bearer {old}"))), None);
    assert!(matches!(t.caller(), Caller::Tile { .. }));
}

/// 행 "Run 끝(stopped · done · orphaned 닫기)" — 묶음은 풀려 그 Run 의 조율은 `run-ended`.
#[test]
fn transition_run_end_unbinds_and_answers_run_ended() {
    let h = harness();
    let run = start(&h.o);
    h.o.bind_coordinator(&run, 1, "pc-runend").unwrap();
    h.o.stop(&run).unwrap();
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
    let c = seat_caller("pc-runend");
    assert_eq!(code(create(&h.o, &c, &run, 1, "x")), "run-ended");
    assert_eq!(code(h.o.call_tool(&c, "get_run", Some(&json!({ "runId": run })))), "run-ended");
    assert!(h.o.bound_coordinator("pc-runend").is_none());
    // 끝난 Run 에는 다시 묶지 못한다.
    assert_eq!(h.o.bind_coordinator(&run, 1, "pc-runend").unwrap_err().code, reason::RUN_STOPPED);
}

/// 행 "세대 교체(`adopt_run` — 다른 채팅)" — 옛 자리의 요청은 `stale-generation`, 새 자리가 새 세대로.
#[test]
fn transition_generation_change_old_seat_is_stale_generation() {
    let h = harness();
    let run = start(&h.o);
    h.o.bind_coordinator(&run, 1, "pc-gen-old").unwrap();
    assert_eq!(h.o.bump_gen_for_test(&run).unwrap(), 2);
    assert!(h.o.bound_coordinator("pc-gen-old").is_none());
    let co = seat_caller("pc-gen-old");
    assert_eq!(code(create(&h.o, &co, &run, 1, "x")), "stale-generation");
    // 옛 세대로 묶기는 거절 · 새 세대로 새 자리.
    assert_eq!(h.o.bind_coordinator(&run, 1, "pc-gen-new").unwrap_err().code, reason::STALE_GENERATION);
    h.o.bind_coordinator(&run, 2, "pc-gen-new").unwrap();
    let cn = seat_caller("pc-gen-new");
    create(&h.o, &cn, &run, 2, "gen2").unwrap();
    assert_eq!(code(create(&h.o, &cn, &run, 1, "gen1")), "stale-generation");
}

/// 행 "서버 재시작" — Run 은 orphaned, 묶음은 메모리뿐이라 없다(옛 자리의 요청은 조정자가 아니다 · 토큰 표도 새로 — 서버 프로세스와 함께 사라진다).
#[test]
fn transition_server_restart_orphans_and_forgets_binding() {
    let dir = std::env::temp_dir().join(format!("aynx-tile-restart-{}-{}", std::process::id(), crate::operations::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let run = {
        let h = harness_in(Some(dir.clone()));
        let run = start(&h.o);
        h.o.bind_coordinator(&run, 1, "pc-restart").unwrap();
        h.o.flush_saves();
        run
    };
    let h = harness_in(Some(dir.clone()));
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "orphaned");
    assert!(h.o.bound_coordinator("pc-restart").is_none());
    assert_eq!(code(create(&h.o, &seat_caller("pc-restart"), &run, 1, "x")), "not-coordinator");
    assert!(h.o.bind_coordinator(&run, 1, "pc-restart").is_err(), "orphaned 에는 묶지 못한다");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// `/mcp` 문지기 — 타일 토큰의 HTTP 인증
// ---------------------------------------------------------------------------

/// 타일 토큰이 HTTP 로 인증된다(전역 토큰이 아니어도) — 살아 있는 회차면 200(목록에 조율 도구 없음 — 이 PC 의 맡기기와 무관), 셸이 끝나면
/// 401 `stale-tile`, 회수 뒤엔 401.
#[test]
fn tile_token_authenticates_over_http() {
    use std::io::{Read, Write};
    let _net = crate::test_support::NET_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let h = Arc::new(harness());
    let t = FakeTile::open("http");
    let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let h2 = Arc::clone(&h);
    std::thread::spawn(move || {
        let store: crate::context::Store = Default::default();
        let ops: crate::operations::OperationStore = Default::default();
        let results: crate::operations::ResultStore = Default::default();
        let signal = crate::mcp::McpSignal::default();
        let seen = Mutex::new(None);
        for req in server.incoming_requests() {
            crate::mcp::handle_request(req, &store, &ops, &results, &signal, &seen, "globaltoken", Some(&h2.o), port, &crate::mcp::DbEnv::none());
        }
    });
    let send = |auth: &str, body: &str| -> String {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        buf
    };
    let list = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
    let plain = send(&t.header(), list);
    // 이 HTTP 길은 진짜 `delegation.toml` 을 읽는다 — 맡긴 저장소가 있든 없든 타일 목록에는 조율 도구가 없다.
    assert!(plain.starts_with("HTTP/1.1 200") && !plain.contains("wait_run") && !plain.contains("start_run"), "{plain}");
    t.exit();
    let stale = send(&t.header(), list);
    assert!(stale.starts_with("HTTP/1.1 401") && stale.contains("stale-tile"), "{stale}");
    t.close();
    let gone = send(&t.header(), list);
    assert!(gone.starts_with("HTTP/1.1 401") && !gone.contains("stale-tile"), "{gone}");
}
