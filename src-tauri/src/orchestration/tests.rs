//! 오케스트레이션 2단계 시험 — **동작 계약 위주**(설계 H). 소스 훑기는 보조(프런트 명령에 조정자 토큰이 없다는 것 하나).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::model::*;
use super::persist;
use super::store::*;
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

type Events = Arc<Mutex<Vec<(String, Value)>>>;

struct H {
    o: Orchestration,
    clock: Arc<AtomicU64>,
    events: Events,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness(dir: Option<PathBuf>) -> H {
    let events: Events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let emit: EmitFn = Arc::new(move |n: &str, b: Value| sink.lock().unwrap().push((n.to_string(), b)));
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let (tx, rx) = mpsc::channel();
    let o = Orchestration::with_clock(dir, emit, Some(tx), Arc::new(move || c.load(Ordering::SeqCst)));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    H {
        o,
        clock,
        events,
        audit: Mutex::new(rx),
    }
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-orch-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn start_with(o: &Orchestration, limits: Limits) -> String {
    o.start_run(StartRun {
        verify: None,
        name: "refactor".into(),
        repo: "C:/repo".into(),
        worktree_dir: "C:/repo-wt".into(),
        limits,
    })
    .expect("Run 시작")
    .0
}

fn start(o: &Orchestration) -> String {
    start_with(o, Limits::default())
}

fn bearer(t: &str) -> String {
    format!("Bearer {t}")
}

/// 지금 세대의 조정자 호출자 — 3차 4단계부터 조정자는 **타일 토큰 + 서버 표의 묶음**이다(조정자 토큰은 없다). 시험 타일 스트림을 지금 세대에
/// 묶고(제품의 `start_run` · `adopt_run` 이 세우는 묶음과 같은 칸 — 시험 전용 `bind_coordinator`) 조정자 호출자와 그 스트림을 돌려준다(타일 → 조정자 판정 자체는 `tests_tile.rs`).
fn coordinator(o: &Orchestration, run: &str) -> (Caller, String) {
    let gen = o.active_gen(run).expect("조율을 받는 Run");
    let stream = format!("tile-{}-g{gen}", &run[run.len() - 8..]);
    o.bind_coordinator(run, gen, &stream).expect("묶음");
    (o.coordinator_caller(run).expect("조정자"), stream)
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn create(o: &Orchestration, c: &Caller, req: &str, title: &str, deps: &[&str]) -> Result<Value, String> {
    call(o, c, "create_task", json!({ "requestId": req, "title": title, "goal": format!("goal of {title}"), "dependsOn": deps }))
}

fn task_id(v: &Value) -> String {
    v["task"]["id"].as_str().unwrap().to_string()
}

fn code(r: Result<Value, String>) -> String {
    let e = r.expect_err("거절이어야 한다");
    e.split(':').next().unwrap().to_string()
}

/// 시험이 Attempt 를 직접 넣는다(3a 의 헤드리스 작업자 모양 — `kind: write`).
fn put_attempt(o: &Orchestration, run: &str, state: AttemptState) -> String {
    let id = new_id("att").unwrap();
    {
        let mut g = o.lock();
        let slot = g.runs.get_mut(run).unwrap();
        let task_id = slot.run.tasks.first().map(|t| t.id.clone()).unwrap_or_default();
        let gen = slot.run.gen;
        slot.run.attempts.push(Attempt {
            id: id.clone(),
            task_id,
            cli: WorkerCli::Claude,
            gen,
            state,
            stream: None,
            worktree: None,
            branch: None,
            base_commit: None,
            pid: None,
            conversation_id: None,
            launch_args: None,
            attention: None,
            started_at: 0,
            ended_at: None,
            exit_reason: None,
            pending_recovery: None,
            conversation_changed: false,
            last_commit_rejection: None,
            resolves: None,
            role: AttemptRole::Worker,
            review_of: None,
            turns: Vec::new(),
            kind: Some(AttemptKind::Write),
            role_id: Some(super::test_album::WRITER.into()),
            role_name: Some("구현".into()),
            blocked: None,
            conversation_broken: false,
            stop_requested: false,
        });
        slot.run.bump(0, Actor::Server, "attempt_test", Some(&id), "x");
    }
    o.changed.notify_all();
    id
}

fn drain_audit(h: &H) -> Vec<AuditRecord> {
    let rx = h.audit.lock().unwrap();
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

// ---------------------------------------------------------------------------
// 모델 · 동시성
// ---------------------------------------------------------------------------

#[test]
fn dependency_cycle_rejected() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let a = task_id(&create(&h.o, &c, "r1", "A", &[]).unwrap());
    let b = task_id(&create(&h.o, &c, "r2", "B", &[&a]).unwrap());
    let cc = task_id(&create(&h.o, &c, "r3", "C", &[&b]).unwrap());
    // A → C → B → A
    let r = call(&h.o, &c, "update_task", json!({ "requestId": "r4", "taskId": a, "version": 1, "dependsOn": [cc] }));
    assert_eq!(code(r), "dependency-cycle");
    // 자기 자신
    let r = call(&h.o, &c, "update_task", json!({ "requestId": "r5", "taskId": a, "version": 1, "dependsOn": [a] }));
    assert_eq!(code(r), "dependency-cycle");
    // 거절은 아무것도 바꾸지 않는다.
    let run_v = call(&h.o, &c, "get_run", json!({})).unwrap();
    let ta = run_v["tasks"].as_array().unwrap().iter().find(|t| t["id"] == a.as_str()).unwrap().clone();
    assert_eq!(ta["version"], 1);
    assert_eq!(ta["dependsOn"], json!([]));
    // 순환이 아닌 바꾸기는 된다(C 가 A 에도 의존 — 다이아몬드).
    call(&h.o, &c, "update_task", json!({ "requestId": "r6", "taskId": cc, "version": 1, "dependsOn": [b, a] })).unwrap();
}

#[test]
fn unknown_dependency_rejected() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let ghost = new_id("task").unwrap();
    assert_eq!(code(create(&h.o, &c, "r1", "A", &[&ghost])), "unknown-dependency");
    let v = call(&h.o, &c, "get_run", json!({})).unwrap();
    assert_eq!(v["tasks"], json!([]), "거절된 생성은 Task 를 남기지 않는다");
}

#[test]
fn task_version_conflict() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let a = task_id(&create(&h.o, &c, "r1", "A", &[]).unwrap());
    let v2 = call(&h.o, &c, "update_task", json!({ "requestId": "r2", "taskId": a, "version": 1, "title": "A2" })).unwrap();
    assert_eq!(v2["task"]["version"], 2);
    // 옛 버전으로 — 조정자.
    let r = call(&h.o, &c, "update_task", json!({ "requestId": "r3", "taskId": a, "version": 1, "state": "cancelled" }));
    assert_eq!(code(r), "conflict");
    // 옛 버전으로 — 사람(같은 규칙 · 하나만 이긴다).
    let e = h.o.set_task_state(&run, &a, 1, TaskState::Cancelled).unwrap_err();
    assert_eq!(e.code, "conflict");
    // 맞는 버전의 사람 취소가 이기면 조정자의 다음 갱신(옛 버전 2)은 conflict.
    h.o.set_task_state(&run, &a, 2, TaskState::Cancelled).unwrap();
    let r = call(&h.o, &c, "update_task", json!({ "requestId": "r4", "taskId": a, "version": 2, "title": "A3" }));
    assert_eq!(code(r), "conflict");
}

#[test]
fn same_request_id_returns_first_result() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let first = create(&h.o, &c, "same", "A", &[]).unwrap();
    let seq = first["latestSeq"].as_u64().unwrap();
    let again = create(&h.o, &c, "same", "A", &[]).unwrap();
    assert_eq!(first, again, "처음 결과를 그대로");
    // (F6) 같은 requestId · 다른 몸 = 다른 호출 — 처음 결과를 돌려주지 않고 거절(타일 단위 기록과 같은 낱말).
    let e = create(&h.o, &c, "same", "B — 다른 몸", &[]).unwrap_err();
    assert!(e.starts_with("request-id-reused:") && e.contains("different input"), "{e}");
    let v = call(&h.o, &c, "get_run", json!({})).unwrap();
    assert_eq!(v["tasks"].as_array().unwrap().len(), 1, "두 번 만들지 않는다");
    assert_eq!(v["latestSeq"].as_u64().unwrap(), seq, "사건도 하나");
    // update_task 도 같다.
    let a = task_id(&first);
    let u1 = call(&h.o, &c, "update_task", json!({ "requestId": "u", "taskId": a, "version": 1, "title": "A2" })).unwrap();
    let u2 = call(&h.o, &c, "update_task", json!({ "requestId": "u", "taskId": a, "version": 1, "title": "A2" })).unwrap();
    assert_eq!(u1, u2, "버전 1 로 다시 보내도 conflict 가 아니라 처음 결과");
    // requestId 없는 쓰기는 거절.
    let r = call(&h.o, &c, "create_task", json!({ "title": "X", "goal": "g" }));
    assert_eq!(code(r), "invalid-argument");
}

/// F6 — Run 단위 멱등 기록의 입력 해시: 다른 도구 · 다른 입력은 `request-id-reused`, 열쇠 순서는 무관, `requestId` · `runId` · `gen` 은 해시
/// 밖(이어받기 뒤 세대만 다른 재시도는 처음 결과), 해시 없는 옛 기록(F6 전 파일)은 도구만 맞춘다.
#[test]
fn request_id_reuse_is_refused_by_input_hash() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let body = |title: &str, gen: u32| json!({ "requestId": "q", "runId": run, "gen": gen, "title": title, "goal": "g" });
    let first = call(&h.o, &c, "create_task", body("A", 1)).unwrap();
    // 열쇠 순서가 달라도 같은 입력.
    let reordered = json!({ "goal": "g", "title": "A", "gen": 1, "runId": run, "requestId": "q" });
    assert_eq!(call(&h.o, &c, "create_task", reordered).unwrap(), first);
    // 다른 도구가 같은 id.
    let a = task_id(&first);
    let e = call(&h.o, &c, "update_task", json!({ "requestId": "q", "taskId": a, "version": 1, "title": "A2" })).unwrap_err();
    assert!(e.starts_with("request-id-reused"), "{e}");
    // version 은 해시 밖 — 응답을 잃고 다시 읽은 새 version 으로 보낸 같은 요청은 처음 결과(두 번 바꾸지 않는다).
    let u = call(&h.o, &c, "update_task", json!({ "requestId": "v", "taskId": a, "version": 1, "title": "A3" })).unwrap();
    let u_again = call(&h.o, &c, "update_task", json!({ "requestId": "v", "taskId": a, "version": 2, "title": "A3" })).unwrap();
    assert_eq!(u, u_again);
    // 이어받기(세대 +1) 뒤 새 조정자가 응답을 잃은 같은 요청을 다시 보낸다 — gen 만 다르다 → 처음 결과(두 번 만들지 않는다).
    h.o.lock().runs.get_mut(&run).unwrap().run.gen += 1;
    let (c2, _) = coordinator(&h.o, &run);
    assert_eq!(call(&h.o, &c2, "create_task", body("A", 2)).unwrap(), first);
    assert_eq!(code(call(&h.o, &c2, "create_task", body("B", 2))), "request-id-reused");
    assert_eq!(call(&h.o, &c2, "get_run", json!({})).unwrap()["tasks"].as_array().unwrap().len(), 1);
    // 옛 기록(해시 없음 — F6 전 파일) — 도구만 맞춘다: 다른 몸이어도 처음 결과(예전 그대로).
    {
        let mut g = h.o.lock();
        let r = &mut g.runs.get_mut(&run).unwrap().run;
        r.requests.push_back(IdemEntry {
            request_id: "old".into(),
            tool: "create_task".into(),
            result: json!({ "legacy": true }),
            input_sha: None,
        });
    }
    let legacy = call(&h.o, &c2, "create_task", json!({ "requestId": "old", "title": "Z", "goal": "g" })).unwrap();
    assert_eq!(legacy, json!({ "legacy": true }));
    assert_eq!(code(call(&h.o, &c2, "update_task", json!({ "requestId": "old", "taskId": a, "version": 1, "title": "Z2" }))), "request-id-reused");
    // 영속 꼴 — 해시는 새 기록에만 실리고 옛 기록은 칸 없이(serde default) 그대로 읽힌다.
    let r = h.o.lock().runs.get(&run).unwrap().run.clone();
    let back = persist::decode(&persist::encode(&r).unwrap()).unwrap();
    assert!(back.requests.iter().find(|e| e.request_id == "q").unwrap().input_sha.is_some());
    assert!(back.requests.iter().find(|e| e.request_id == "old").unwrap().input_sha.is_none());
    let raw = serde_json::to_value(&back.requests).unwrap().to_string();
    assert_eq!(raw.matches("inputSha").count(), back.requests.iter().filter(|e| e.input_sha.is_some()).count());
}

#[test]
fn paused_rejects_writes_but_wait_continues() {
    let h = Arc::new(harness(None));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    h.o.pause(&run).unwrap();
    assert_eq!(code(create(&h.o, &c, "r1", "A", &[])), "run-paused");
    // 읽기는 된다.
    assert_eq!(call(&h.o, &c, "get_run", json!({})).unwrap()["state"], "paused");
    // paused 에서 시작한 wait_run 은 바로 돌아오지 않고 기다린다 — 재개가 깨운다.
    let (h2, c2) = (Arc::clone(&h), c.clone());
    let started = Instant::now();
    let waiter = std::thread::spawn(move || call(&h2.o, &c2, "wait_run", json!({ "until": "ready", "timeoutSeconds": 10 })));
    std::thread::sleep(Duration::from_millis(300));
    assert!(!waiter.is_finished(), "paused 에도 기다린다");
    h.o.resume(&run).unwrap();
    let v = waiter.join().unwrap().unwrap();
    assert!(started.elapsed() >= Duration::from_millis(250));
    assert_eq!(v["stateChanged"], true);
    assert_eq!(v["timedOut"], false);
    assert_eq!(v["run"]["state"], "running");
    // 거절은 멱등 기록에 남지 않는다 — 같은 requestId 로 다시 부르면 이제 된다.
    let ok = create(&h.o, &c, "r1", "A", &[]).unwrap();
    assert_eq!(ok["task"]["state"], "todo");
}

#[test]
fn stopping_blocks_writes() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, token) = coordinator(&h.o, &run);
    create(&h.o, &c, "r1", "A", &[]).unwrap();
    // 살아 있는 작업자가 있으면 stopped 가 아니라 stopping 에 머문다(종료 확인 전).
    put_attempt(&h.o, &run, AttemptState::Working);
    h.o.stop(&run).unwrap();
    let detail = h.o.run_detail(&run).unwrap();
    assert_eq!(detail["state"], "stopping");
    // 조정자 묶음은 즉시 푼다(3차 4단계 — 그 타일의 늦은 조율은 `run-ended`).
    assert!(h.o.bound_coordinator(&token).is_none());
    // 이미 풀린 호출자(경합 — 중단 직전에 인증을 지난 요청)도 쓰기는 막힌다.
    assert_eq!(code(create(&h.o, &c, "r2", "B", &[])), "run-stopped");
    // 새 작업자 슬롯도(3단계의 생성 관문).
    assert_eq!(h.o.reserve_worker(&run).unwrap_err().code, "run-stopped");
    // 사람의 재개도 안 된다(세대 교체도 — 제품에서는 `adopt_run` 이 paused 만 받는다).
    assert_eq!(h.o.resume(&run).unwrap_err().code, "run-stopped");
    assert_eq!(h.o.bump_gen_for_test(&run).unwrap_err().code, "run-stopped");
    // 작업자가 없으면 곧바로 stopped.
    let h = harness(None);
    let run = start(&h.o);
    h.o.stop(&run).unwrap();
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
}

// ---------------------------------------------------------------------------
// 역할 토큰
// ---------------------------------------------------------------------------

#[test]
fn coordinator_token_scoped_to_own_run() {
    let h = harness(None);
    let a = start(&h.o);
    let b = start(&h.o);
    let (ca, _) = coordinator(&h.o, &a);
    assert!(matches!(&ca, Caller::Coordinator { run_id, gen: 1 } if *run_id == a));
    // 남의 Run 과 없는 Run 은 **같은** 대답 — 있는지도 흘리지 않는다.
    let other = call(&h.o, &ca, "get_run", json!({ "runId": b })).unwrap_err();
    let ghost = call(&h.o, &ca, "get_run", json!({ "runId": new_id("run").unwrap() })).unwrap_err();
    assert_eq!(other, ghost);
    assert!(other.starts_with("not-found"), "{other}");
    assert_eq!(code(call(&h.o, &ca, "create_task", json!({ "runId": b, "requestId": "x", "title": "t", "goal": "g" }))), "not-found");
    // 자기 Run 은 runId 를 생략해도 · 적어도 된다.
    assert_eq!(call(&h.o, &ca, "get_run", json!({ "runId": a })).unwrap()["runId"], a.as_str());
    assert_eq!(call(&h.o, &ca, "get_run", json!({})).unwrap()["runId"], a.as_str());
    // 남의 Run 의 Task 는 안 보인다.
    let (cb, _) = coordinator(&h.o, &b);
    create(&h.o, &cb, "rb", "B task", &[]).unwrap();
    assert_eq!(call(&h.o, &ca, "get_run", json!({})).unwrap()["tasks"], json!([]));
    // 모르는 토큰 · 빈 토큰 · Bearer 없는 머리는 아무도 아니다.
    assert!(h.o.resolve(Some("Bearer nope")).is_none());
    assert!(h.o.resolve(Some("Bearer ")).is_none());
    assert!(h.o.resolve(None).is_none());
}

#[test]
fn worker_token_cannot_orchestrate() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    create(&h.o, &c, "r1", "A", &[]).unwrap();
    let att = put_attempt(&h.o, &run, AttemptState::Working);
    let t = h.o.issue_worker_token(&run, &att).unwrap();
    let w = h.o.resolve(Some(&bearer(&t))).unwrap();
    assert!(matches!(&w, Caller::Worker { attempt_id, .. } if *attempt_id == att));
    for name in super::COORDINATOR_TOOLS.iter().copied() {
        assert!(!super::is_tool_for(&w, name), "{name}");
        let e = call(&h.o, &w, name, json!({ "requestId": "x", "title": "t", "goal": "g" })).unwrap_err();
        assert!(e.starts_with("Unknown tool"), "{name}: {e}");
    }
    // 자기 Task 는 읽는다.
    let v = call(&h.o, &w, "get_task", json!({})).unwrap();
    assert_eq!(v["attemptId"], att.as_str());
    assert_eq!(v["task"]["title"], "A");
    // MCP 디스패치 — 작업자 목록은 작업자 도구뿐, 13개 도구도 못 부른다.
    let names = mcp_tool_names(&w, &h.o);
    assert_eq!(names, vec!["get_task".to_string(), "report_done".to_string(), "commit_changes".to_string()]);
    let r = mcp_call(&w, &h.o, "list_sessions", json!({}));
    assert_eq!(r["isError"], true);
    assert!(r["content"][0]["text"].as_str().unwrap().starts_with("Unknown tool"));
    // 조정자는 작업자 도구를 못 쓴다.
    assert!(!super::is_tool_for(&c, "get_task"));
}

#[test]
fn tokens_revoked_on_stop_and_new_gen() {
    let h = harness(None);
    let run = start(&h.o);
    let (c1, t1) = coordinator(&h.o, &run);
    assert_eq!(h.o.bump_gen_for_test(&run).unwrap(), 2);
    assert!(h.o.bound_coordinator(&t1).is_none(), "세대가 바뀌면 옛 타일의 묶음은 풀린다");
    let (c2, t2) = coordinator(&h.o, &run);
    assert_ne!(t1, t2);
    assert!(matches!(c2, Caller::Coordinator { gen: 2, .. }));
    // 옛 세대의 이미 풀린 호출자는 stale-generation.
    assert_eq!(code(call(&h.o, &c1, "get_run", json!({}))), "stale-generation");
    call(&h.o, &c2, "get_run", json!({})).unwrap();
    h.o.stop(&run).unwrap();
    assert!(h.o.bound_coordinator(&t2).is_none(), "중단하면 풀린다");
    assert!(h.o.coordinator_caller(&run).is_none());
}

// ---------------------------------------------------------------------------
// wait_run
// ---------------------------------------------------------------------------

#[test]
fn wait_run_until_is_current_state() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let made = create(&h.o, &c, "r1", "A", &[]).unwrap();
    let latest = made["latestSeq"].as_u64().unwrap();
    // afterSeq 뒤에 사건이 있었다 → 바로.
    let v = call(&h.o, &c, "wait_run", json!({ "afterSeq": 0, "timeoutSeconds": 5 })).unwrap();
    assert_eq!((v["satisfied"].clone(), v["timedOut"].clone()), (json!(true), json!(false)));
    assert_eq!(v["latestSeq"].as_u64().unwrap(), latest);
    assert!(v["run"]["tasks"].is_array(), "늘 최신 스냅숏");
    // ready — 지금 이어 받을 수 있는(`idle`) Attempt 가 없으니 거짓(과거 사건이 아니라 지금 상태) → 시한까지.
    let started = Instant::now();
    let v = call(&h.o, &c, "wait_run", json!({ "afterSeq": 0, "until": "ready", "timeoutSeconds": 1 })).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(900));
    assert_eq!((v["satisfied"].clone(), v["timedOut"].clone()), (json!(false), json!(true)));
    // 지금 `idle` 인 것이 있으면 afterSeq 가 최신이어도 바로 참.
    let att = put_attempt(&h.o, &run, AttemptState::Idle);
    let now_seq = call(&h.o, &c, "get_run", json!({})).unwrap()["latestSeq"].as_u64().unwrap();
    let v = call(&h.o, &c, "wait_run", json!({ "afterSeq": now_seq, "until": "ready", "attemptIds": [att], "timeoutSeconds": 5 })).unwrap();
    assert_eq!(v["satisfied"], true);
    // 다른 Attempt 로 좁히면 거짓.
    let v = call(
        &h.o,
        &c,
        "wait_run",
        json!({ "afterSeq": now_seq, "until": "ready", "attemptIds": [new_id("att").unwrap()], "timeoutSeconds": 1 }),
    )
    .unwrap();
    assert_eq!(v["timedOut"], true);
    // reported — Attempt 가 보고 상태가 아니면 거짓(2단계는 늘 거짓).
    let v = call(&h.o, &c, "wait_run", json!({ "until": "reported", "timeoutSeconds": 1 })).unwrap();
    assert_eq!(v["satisfied"], false);
    // 잘못된 until.
    assert_eq!(code(call(&h.o, &c, "wait_run", json!({ "until": "done" }))), "invalid-argument");
}

/// E2E 10-16 — 이름을 댄 Attempt 가 이미 `ready` 단계를 지났으면(보고함 · 끝남 · 중단됨) `until=ready` 가 곧바로 선다(다시 ready 가 될
/// 일이 없는데 시한까지 헛되이 기다리지 않게). 이름 없이 기다릴 때는 옛 끝난 작업자가 세우지 않는다.
#[test]
fn wait_run_ready_counts_attempts_past_ready() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let done: Vec<String> = [AttemptState::Reported, AttemptState::Stopped, AttemptState::Exited]
        .into_iter()
        .map(|s| put_attempt(&h.o, &run, s))
        .collect();
    let t0 = Instant::now();
    let v = call(&h.o, &c, "wait_run", json!({ "until": "ready", "attemptIds": done, "timeoutSeconds": 5 })).unwrap();
    assert_eq!((v["satisfied"].clone(), v["timedOut"].clone()), (json!(true), json!(false)));
    assert!(t0.elapsed() < Duration::from_secs(2), "곧바로");
    // 하나씩도 — 중단됨 하나만 대도 선다.
    let v = call(&h.o, &c, "wait_run", json!({ "until": "ready", "attemptIds": [done[1].clone()], "timeoutSeconds": 5 })).unwrap();
    assert_eq!(v["satisfied"], true);
    // 아직 턴이 도는 Attempt 는 기다린다.
    let working = put_attempt(&h.o, &run, AttemptState::Running);
    let v = call(&h.o, &c, "wait_run", json!({ "until": "ready", "attemptIds": [working], "timeoutSeconds": 1 })).unwrap();
    assert_eq!((v["satisfied"].clone(), v["timedOut"].clone()), (json!(false), json!(true)));
    // 이름 없이 — 끝난 작업자만 있으면 서지 않는다(다음 ready 를 기다리는 뜻 그대로).
    let v = call(&h.o, &c, "wait_run", json!({ "until": "ready", "timeoutSeconds": 1 })).unwrap();
    assert_eq!(v["satisfied"], false);
}

#[test]
fn wait_run_wakes_on_pause() {
    let h = Arc::new(harness(None));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    // any — 다음 사건(일시정지)이 깨운다.
    let (h2, c2) = (Arc::clone(&h), c.clone());
    let any = std::thread::spawn(move || call(&h2.o, &c2, "wait_run", json!({ "timeoutSeconds": 30 })));
    // ready — 조건은 거짓이지만 Run 상태가 바뀌면 돌아온다.
    let (h3, c3) = (Arc::clone(&h), c.clone());
    let ready = std::thread::spawn(move || call(&h3.o, &c3, "wait_run", json!({ "until": "ready", "timeoutSeconds": 30 })));
    std::thread::sleep(Duration::from_millis(200));
    // 동시 대기 한도 2 — 셋째는 거절.
    assert_eq!(code(call(&h.o, &c, "wait_run", json!({ "timeoutSeconds": 1 }))), "too-many-waiters");
    let t0 = Instant::now();
    h.o.pause(&run).unwrap();
    let a = any.join().unwrap().unwrap();
    let r = ready.join().unwrap().unwrap();
    assert!(t0.elapsed() < Duration::from_secs(5), "시한 전에 깨어난다");
    assert_eq!(a["satisfied"], true);
    assert_eq!(a["run"]["state"], "paused");
    assert_eq!((r["satisfied"].clone(), r["stateChanged"].clone()), (json!(false), json!(true)));
    // 대기 수는 반납됐다 — 다시 기다릴 수 있다. 중단도 깨운다.
    h.o.resume(&run).unwrap();
    let (h4, c4) = (Arc::clone(&h), c.clone());
    let w = std::thread::spawn(move || call(&h4.o, &c4, "wait_run", json!({ "until": "ready", "timeoutSeconds": 30 })));
    std::thread::sleep(Duration::from_millis(200));
    h.o.stop(&run).unwrap();
    let v = w.join().unwrap().unwrap();
    assert_eq!(v["stateChanged"], true);
    assert_eq!(v["run"]["state"], "stopped");
}

// ---------------------------------------------------------------------------
// 영속
// ---------------------------------------------------------------------------

#[test]
fn run_json_roundtrip() {
    let dir = scratch("roundtrip");
    let h = harness(Some(dir.clone()));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    let a = task_id(&create(&h.o, &c, "r1", "A", &[]).unwrap());
    create(&h.o, &c, "r2", "B", &[&a]).unwrap();
    let mem = h.o.lock().runs.get(&run).unwrap().run.clone();
    // 바이트 왕복.
    let back = persist::decode(&persist::encode(&mem).unwrap()).unwrap();
    assert_eq!(back, mem);
    // 사건마다 원자 교체로 쓴 파일 — 판 번호 · 마지막 사건까지.
    h.o.flush_saves();
    let bytes = std::fs::read(dir.join(format!("{run}.json"))).unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["version"], 4);
    assert_eq!(persist::decode(&bytes).unwrap(), mem);
    // 임시 파일이 남지 않는다.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty());
    // 판 4 하나만 지원한다 — 옛 파일은 해석하지 않는다.
    let mut wrong = v.clone();
    wrong["version"] = json!(5);
    assert!(persist::decode(&serde_json::to_vec(&wrong).unwrap()).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

/// 파일의 모든 열쇠를 모은다.
fn keys(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                out.push(k.clone());
                keys(x, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| keys(x, out)),
        _ => {}
    }
}

#[test]
fn run_json_has_no_tokens_or_bodies() {
    let dir = scratch("secrets");
    let h = harness(Some(dir.clone()));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    create(&h.o, &c, "r1", "A", &[]).unwrap();
    // 역할 토큰 둘(3차 4단계부터 조정자 토큰은 없다 — 작업자 턴 토큰으로 본다).
    let a1 = put_attempt(&h.o, &run, AttemptState::Running);
    let t1 = h.o.issue_worker_token(&run, &a1).unwrap();
    h.o.bump_gen_for_test(&run).unwrap();
    let (c2, _) = coordinator(&h.o, &run);
    create(&h.o, &c2, "r2", "B", &[]).unwrap();
    let a2 = put_attempt(&h.o, &run, AttemptState::Running);
    let t2 = h.o.issue_worker_token(&run, &a2).unwrap();
    h.o.flush_saves();
    let text = std::fs::read_to_string(dir.join(format!("{run}.json"))).unwrap();
    assert!(!text.contains(&t1) && !text.contains(&t2), "토큰이 파일에 없다");
    let v: Value = serde_json::from_str(&text).unwrap();
    let mut ks = Vec::new();
    keys(&v, &mut ks);
    for banned in ["token", "prompt", "transcript", "scrollback", "output", "stdout", "stderr", "env"] {
        assert!(
            !ks.iter().any(|k| k.to_ascii_lowercase().contains(banned)),
            "{banned} 칸이 없어야 한다: {ks:?}"
        );
    }
    // 사람 쪽 보기 · 요약 · 이벤트에도 토큰이 없다.
    let shown = format!(
        "{} {} {:?}",
        h.o.snapshot(),
        h.o.run_detail(&run).unwrap(),
        h.events.lock().unwrap()
    );
    assert!(!shown.contains(&t1) && !shown.contains(&t2));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn orphaned_after_restart_is_read_only_and_tokenless() {
    let dir = scratch("orphan");
    let (run, token, task) = {
        let h = harness(Some(dir.clone()));
        let run = start(&h.o);
        let (c, t) = coordinator(&h.o, &run);
        let task = task_id(&create(&h.o, &c, "r1", "A", &[]).unwrap());
        h.o.pause(&run).unwrap();
        (run, t, task)
    };
    // 서버 재시작.
    let h = harness(Some(dir.clone()));
    let snap = h.o.snapshot();
    assert_eq!(snap.as_array().unwrap().len(), 1);
    assert_eq!(snap[0]["state"], "orphaned");
    assert_eq!(snap[0]["previousState"], "paused");
    assert_eq!(h.o.active_count(), 0, "orphaned 는 서버를 붙잡지 않는다");
    // 조정자 묶음은 되살리지 않는다(메모리뿐 — 그 타일 토큰도 서버 재시작으로 사라졌다).
    assert!(h.o.bound_coordinator(&token).is_none());
    assert!(h.o.coordinator_caller(&run).is_none());
    // 조율 도구로 바꿀 수 없다(옛 호출자를 손으로 만들어도 — 있는지조차 not-found).
    let ghost = Caller::Coordinator { run_id: run.clone(), gen: 1 };
    assert_eq!(code(call(&h.o, &ghost, "get_run", json!({}))), "not-found");
    assert_eq!(code(create(&h.o, &ghost, "r9", "X", &[])), "not-found");
    // 사람 명령도 읽기 전용.
    assert_eq!(h.o.pause(&run).unwrap_err().code, "run-orphaned");
    assert_eq!(h.o.resume(&run).unwrap_err().code, "run-orphaned");
    assert_eq!(h.o.stop(&run).unwrap_err().code, "run-orphaned");
    assert_eq!(h.o.set_task_state(&run, &task, 1, TaskState::Cancelled).unwrap_err().code, "run-orphaned");
    assert!(h.o.run_detail(&run).unwrap()["orphaned"].as_bool().unwrap());
    // 사람이 보관하면 archived/ 로.
    h.o.archive_run(&run).unwrap();
    assert_eq!(h.o.snapshot(), json!([]));
    assert!(dir.join("archived").join(format!("{run}.json")).exists());
    assert!(!dir.join(format!("{run}.json")).exists());
    // 다음 시작에는 없다.
    assert_eq!(harness(Some(dir.clone())).o.snapshot(), json!([]));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn corrupt_run_file_skipped() {
    let dir = scratch("corrupt");
    let good = {
        let h = harness(Some(dir.clone()));
        start(&h.o)
    };
    // 깨진 JSON · 판이 다른 파일 · 이름과 id 가 다른 파일 · 이름 틀이 아닌 파일.
    let broken = new_id("run").unwrap();
    std::fs::write(dir.join(format!("{broken}.json")), "{ not json SECRET-BODY").unwrap();
    let mut other = serde_json::from_slice::<Value>(&std::fs::read(dir.join(format!("{good}.json"))).unwrap()).unwrap();
    other["version"] = json!(99);
    let future = new_id("run").unwrap();
    other["run"]["id"] = json!(future);
    std::fs::write(dir.join(format!("{future}.json")), serde_json::to_vec(&other).unwrap()).unwrap();
    let mut renamed = other.clone();
    renamed["version"] = json!(4);
    let misnamed = new_id("run").unwrap();
    std::fs::write(dir.join(format!("{misnamed}.json")), serde_json::to_vec(&renamed).unwrap()).unwrap();
    std::fs::write(dir.join("run-xyz.json"), "{}").unwrap();
    let h = harness(Some(dir.clone()));
    let snap = h.o.snapshot();
    let ids: Vec<&str> = snap.as_array().unwrap().iter().map(|r| r["runId"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![good.as_str()], "좋은 파일만 올라온다");
    // 로그 모음은 시험 전체가 함께 쓴다 — 지우지 않고 이 시험의 파일 이름만 고른다.
    let logs = crate::server::log::CAPTURED.lock().unwrap_or_else(|e| e.into_inner()).clone();
    for name in [broken.as_str(), future.as_str(), misnamed.as_str(), "run-xyz"] {
        assert!(
            logs.iter().any(|l| l.contains("orchestration — skipped") && l.contains(name)),
            "{name} 을 건너뛴 줄이 있어야 한다"
        );
    }
    assert!(!logs.iter().any(|l| l.contains("SECRET-BODY")), "로그에 내용이 없다");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// 한도
// ---------------------------------------------------------------------------

#[test]
fn limits_tasks_and_rate() {
    let h = harness(None);
    let run = start_with(
        &h.o,
        LimitsInput {
            max_tasks: Some(3),
            max_calls_per_minute: Some(6),
            ..Default::default()
        }
        .resolve(),
    );
    let (c, _) = coordinator(&h.o, &run);
    for i in 0..3 {
        create(&h.o, &c, &format!("r{i}"), "T", &[]).unwrap();
    }
    assert_eq!(code(create(&h.o, &c, "r3", "T", &[])), "too-many-tasks");
    // 위 넷 + 둘 = 분당 6 — 일곱째는 거절.
    call(&h.o, &c, "get_run", json!({})).unwrap();
    call(&h.o, &c, "get_run", json!({})).unwrap();
    assert_eq!(code(call(&h.o, &c, "get_run", json!({}))), "rate-limited");
    // 1분이 지나면 창이 비워진다.
    h.clock.fetch_add(60_001, Ordering::SeqCst);
    assert_eq!(call(&h.o, &c, "get_run", json!({})).unwrap()["remaining"]["callsThisMinute"], 5);
    // 한도는 기본값(설계 수치)을 넘지 못한다.
    let l = LimitsInput {
        max_tasks: Some(500),
        max_calls_per_minute: Some(0),
        max_concurrent_workers: Some(99),
        coordination_minutes: Some(10_000_000),
        ..Default::default()
    }
    .resolve();
    assert_eq!((l.max_tasks, l.max_calls_per_minute, l.max_concurrent_workers), (50, 1, 3));
    assert_eq!(l.coordination_minutes, 24 * 60);
    assert_eq!(Limits::default().max_total_workers, 8);
}

#[test]
fn worker_slot_reservation_limits() {
    let h = harness(None);
    let run = start(&h.o);
    for _ in 0..3 {
        h.o.reserve_worker(&run).unwrap();
    }
    assert_eq!(h.o.reserve_worker(&run).unwrap_err().code, "worker-limit", "동시 3");
    h.o.release_worker(&run);
    h.o.reserve_worker(&run).unwrap();
    // 총 8 — 끝난 Attempt 여섯 + 예약 둘(동시는 2 < 3 이라 총 한도가 막는다).
    {
        let mut g = h.o.lock();
        g.runs.get_mut(&run).unwrap().reserved_workers = 0;
    }
    for _ in 0..6 {
        put_attempt(&h.o, &run, AttemptState::Exited);
    }
    for _ in 0..2 {
        h.o.reserve_worker(&run).unwrap();
    }
    let e = h.o.reserve_worker(&run).unwrap_err();
    assert_eq!(e.code, "worker-limit", "총 8");
    assert!(e.message.contains("in total"), "{}", e.message);
    // paused 면 예약 자체가 막힌다.
    h.o.pause(&run).unwrap();
    assert_eq!(h.o.reserve_worker(&run).unwrap_err().code, "run-paused");
}

#[test]
fn time_limits_pause_then_stop() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, t) = coordinator(&h.o, &run);
    assert_eq!(h.o.tick(), 0);
    // 조율 한도(기본 2시간) → paused + 사건.
    h.clock.fetch_add(120 * 60_000, Ordering::SeqCst);
    assert_eq!(h.o.tick(), 1);
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!((d["state"].clone(), d["pauseReason"].clone()), (json!("paused"), json!("coordination-limit")));
    assert_eq!(code(create(&h.o, &c, "r1", "A", &[])), "run-paused");
    assert_eq!(h.o.resume(&run).unwrap_err().code, "limit-reached");
    assert!(h.o.bound_coordinator(&t).is_some(), "일시정지는 조정자 묶음을 풀지 않는다");
    // 실행 한도(+30분) → stopping → (작업자 없음) stopped, 묶음 풀림.
    h.clock.fetch_add(30 * 60_000, Ordering::SeqCst);
    assert_eq!(h.o.tick(), 1);
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
    assert!(h.o.bound_coordinator(&t).is_none());
    let events: Vec<String> = drain_audit(&h).into_iter().map(|r| r.event).collect();
    assert_eq!(events.iter().filter(|e| *e == "limit_reached").count(), 2, "{events:?}");
    assert!(events.contains(&"run_ended".to_string()));
}

#[test]
fn concurrent_run_limit() {
    let h = harness(None);
    let a = start(&h.o);
    let _b = start(&h.o);
    let third = h.o.start_run(StartRun {
        verify: None,
        name: "c".into(),
        repo: "C:/r".into(),
        worktree_dir: "C:/r-wt".into(),
        limits: Limits::default(),
    });
    assert_eq!(third.unwrap_err().code, "too-many-runs");
    assert_eq!(h.o.active_count(), 2);
    // paused 도 센다 · 끝난 것은 세지 않는다.
    h.o.pause(&a).unwrap();
    assert_eq!(h.o.active_count(), 2);
    h.o.stop(&a).unwrap();
    assert_eq!(h.o.active_count(), 1);
    start(&h.o);
}

// ---------------------------------------------------------------------------
// 감사 · 이벤트
// ---------------------------------------------------------------------------

#[test]
fn orchestration_audit_has_fixed_fields() {
    let h = harness(None);
    let run = start(&h.o);
    let (c, t1) = coordinator(&h.o, &run);
    call(
        &h.o,
        &c,
        "create_task",
        json!({ "requestId": "r1", "title": "TITLE-TEXT", "goal": "GOAL-SECRET", "scope": "SCOPE-SECRET", "doneWhen": "DONE-SECRET" }),
    )
    .unwrap();
    let task = h.o.run_detail(&run).unwrap()["tasks"][0]["id"].as_str().unwrap().to_string();
    call(&h.o, &c, "update_task", json!({ "requestId": "r2", "taskId": task, "version": 1, "goal": "GOAL2-SECRET" })).unwrap();
    h.o.pause(&run).unwrap();
    h.o.resume(&run).unwrap();
    // 세대 교체(제품에서는 `adopt_run` — 그 감사 `run_adopted` 는 `tests_start.rs`). 사람의 [이어 가기](`human_continued`)는 걷었다(3차 6단계).
    h.o.bump_gen_for_test(&run).unwrap();
    let (_, t2) = coordinator(&h.o, &run);
    h.o.stop(&run).unwrap();
    let recs = drain_audit(&h);
    let events: Vec<&str> = recs.iter().map(|r| r.event.as_str()).collect();
    assert_eq!(
        events,
        vec![
            "run_started",
            "task_created",
            "task_updated",
            "human_paused",
            "human_resumed",
            "human_stopped",
            "run_ended"
        ]
    );
    const FIXED: &[&str] = &[
        "gen",
        "actor",
        "runState",
        "workerPermission",
        "limits",
        "taskId",
        "taskVersion",
        "taskState",
        "titleLen",
        "limit",
        // (3차 5단계) 누가 열었나(`run_started` — human · ai).
        "origin",
    ];
    for r in &recs {
        assert_eq!(r.kind.as_deref(), Some("orchestration"));
        assert_eq!(r.operation_id, run);
        assert!(r.command.is_empty() && r.targets.is_empty());
        let line = serde_json::to_string(r).unwrap();
        for secret in ["GOAL", "SCOPE-SECRET", "DONE-SECRET", "TITLE-TEXT", t1.as_str(), t2.as_str()] {
            assert!(!line.contains(secret), "{secret} in {line}");
        }
        let o = serde_json::to_value(r.orchestration.as_ref().unwrap()).unwrap();
        for k in o.as_object().unwrap().keys() {
            assert!(FIXED.contains(&k.as_str()), "고정 칸 밖: {k}");
        }
    }
    let started = recs[0].orchestration.as_ref().unwrap();
    // (3차 6단계) 새 Run 에는 2차 작업자 권한 칸이 없다(옛 파일에 있던 값만 — 권한은 맡기기의 역할 표).
    assert!(started.worker_permission.is_none());
    assert_eq!(started.limits.as_ref().unwrap().max_tasks, 50);
    assert_eq!(recs[1].orchestration.as_ref().unwrap().title_len, Some(10));
    // 이벤트는 {runId, seq} 뿐(토큰 · 본문 없음). 감독 사건(리뷰 F11)도 정해진 칸뿐.
    for (name, body) in h.events.lock().unwrap().iter() {
        let mut ks: Vec<&String> = body.as_object().unwrap().keys().collect();
        ks.sort();
        if name == super::notice::EVT_NOTICE {
            for k in ks {
                assert!(["id", "runId", "runName", "kind", "attemptId", "taskTitle", "detail", "at"].contains(&k.as_str()), "{k}");
            }
            continue;
        }
        assert_eq!(name, EVT_CHANGED);
        assert_eq!(ks, vec!["runId", "seq"]);
    }
    // 실행 장부(작업안)는 오케스트레이션 줄을 묶지 않는다.
    assert!(crate::audit::join_runs(recs, 0, 10).is_empty());
}

// ---------------------------------------------------------------------------
// MCP 표면
// ---------------------------------------------------------------------------

fn mcp_reply(caller: &Caller, o: &Orchestration, body: Value) -> Value {
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

fn mcp_tool_names(caller: &Caller, o: &Orchestration) -> Vec<String> {
    let v = mcp_reply(caller, o, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
    v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
}

fn mcp_call(caller: &Caller, o: &Orchestration, name: &str, args: Value) -> Value {
    let v = mcp_reply(
        caller,
        o,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": name, "arguments": args } }),
    );
    v["result"].clone()
}

const GLOBAL_13: [&str; 13] = [
    "list_sessions",
    "get_last_command",
    "get_scrollback",
    "list_commands",
    "get_command",
    "get_session_snapshot",
    "compare_command_results",
    "create_execution_plan",
    "request_execution",
    "get_operation",
    "wait_for_operation",
    "get_operation_results",
    "get_auto_approval_policy",
];

#[test]
fn global_token_tools_unchanged() {
    let h = harness(None);
    let run = start(&h.o);
    let names = mcp_tool_names(&Caller::Global, &h.o);
    assert_eq!(names, GLOBAL_13.iter().map(|s| s.to_string()).collect::<Vec<_>>(), "13개 그대로 · 순서도");
    // 전역 토큰으로는 조율 도구를 못 부른다 — 3차 4단계부터 이유 낱말 `not-a-tile`(조정자는 로컬 AI 타일의 토큰으로만).
    let r = mcp_call(&Caller::Global, &h.o, "get_run", json!({ "runId": run }));
    assert_eq!(r["isError"], true);
    assert!(r["content"][0]["text"].as_str().unwrap().starts_with("not-a-tile"), "{r}");
    // 조정자 = 13개 + 조율 여섯(13개는 같은 가시성 — 같은 디스패치 갈래).
    let (c, _) = coordinator(&h.o, &run);
    let cn = mcp_tool_names(&c, &h.o);
    assert_eq!(&cn[..13], &names[..]);
    // (3차 5단계) 타일 도구 둘(start_run · adopt_run) + 조율 도구(complete_run 포함) — 미리 허용과 한 표.
    assert_eq!(
        &cn[13..],
        &[
            "adopt_run",
            "get_run",
            "create_task",
            "update_task",
            "wait_run",
            "spawn_worker",
            "stop_worker",
            "send_prompt",
            "read_worker",
            "get_diff",
            "complete_run"
        ]
    );
    let r = mcp_call(&c, &h.o, "get_run", json!({}));
    assert!(r.get("isError").is_none(), "{r}");
    let r = mcp_call(&c, &h.o, "list_sessions", json!({}));
    assert!(r.get("isError").is_none(), "조정자도 13개를 쓴다: {r}");
}

/// `/mcp` 문지기 — 역할 토큰(작업자 턴 토큰 — 3차 4단계부터 조정자 토큰은 없다)이 HTTP 로 인증되고(전역 토큰이 아니어도), 모르는 토큰은 401.
/// 타일 토큰의 HTTP 인증은 `tests_tile.rs`.
#[test]
fn role_token_authenticates_over_http() {
    use std::io::{Read, Write};
    let _net = crate::test_support::NET_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let h = Arc::new(harness(None));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    create(&h.o, &c, "r1", "A", &[]).unwrap();
    let att = put_attempt(&h.o, &run, AttemptState::Running);
    let token = h.o.issue_worker_token(&run, &att).unwrap();
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
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        buf
    };
    let list = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
    let ok = send(&token, list);
    assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
    assert!(ok.contains("report_done") && !ok.contains("wait_run"), "작업자 목록");
    let global = send("globaltoken", list);
    assert!(global.starts_with("HTTP/1.1 200") && !global.contains("wait_run"), "{global}");
    assert!(send("not-a-token", list).starts_with("HTTP/1.1 401"));
    // 그 턴의 트리 종료 확인 → 거둔 토큰은 401.
    h.o.attempt_process_exited(&run, &att, true, None);
    assert!(send(&token, list).starts_with("HTTP/1.1 401"), "거둔 토큰");
}

// ---------------------------------------------------------------------------
// 사람 쪽 op
// ---------------------------------------------------------------------------

fn op(o: &Orchestration, name: &str, body: Value) -> Result<Value, String> {
    super::ops::handle(name, body, o).map_err(|e| e.message)
}

/// (3차 6단계) **사람이 Run 을 여는 op 는 없다** — 시작 · 시작 미리 보기 · [이어 가기] · 사람이 띄운 조정자 타일 묶기 · worktree 만들기 · 목록
/// op 는 모르는 op 다(`is_op` 에도 없다). Run 은 AI 타일의 `start_run` 으로만 열린다(`tests_start.rs`). 사람의 명령 한 바퀴는 그대로 선다.
#[test]
fn human_start_ops_are_gone() {
    crate::i18n::set_lang(crate::i18n::Lang::En);
    let h = harness(None);
    let run = start(&h.o);
    for gone in [
        "orchestration_start_run",
        "orchestration_start_preview",
        "orchestration_continue",
        "orchestration_active_gen",
        "orchestration_bind_coordinator",
        "orchestration_coordinator_token",
        "orchestration_wt_create",
        "orchestration_wt_list",
        "orchestration_close_orphaned",
    ] {
        assert!(!super::ops::is_op(gone), "{gone}");
        let e = op(&h.o, gone, json!({ "runId": run, "gen": 1, "stream": "s", "repo": "C:/repo", "name": "n" })).unwrap_err();
        assert!(e.contains("unknown op"), "{gone}: {e}");
    }
    // 사람 명령 한 바퀴(재개는 조정자가 묶여 있어야 — 없으면 `no-coordinator`).
    op(&h.o, "orchestration_pause", json!({ "runId": run })).unwrap();
    let e = op(&h.o, "orchestration_resume", json!({ "runId": run })).unwrap_err();
    assert!(e.starts_with("[no-coordinator]"), "{e}");
    h.o.bind_coordinator(&run, 1, "ops-tile").unwrap();
    op(&h.o, "orchestration_resume", json!({ "runId": run })).unwrap();
    // 도는 앨범은 보관하지 못한다(끝난 앨범만).
    let e = op(&h.o, "orchestration_archive", json!({ "runId": run })).unwrap_err();
    assert!(e.starts_with("[invalid-state]"), "{e}");
    op(&h.o, "orchestration_stop", json!({ "runId": run })).unwrap();
    // 보기 · 요약에 2차 시작 대화의 옛 칸이 없다(영속 파일 읽기 호환은 `tests_state.rs`).
    let d = op(&h.o, "orchestration_run", json!({ "runId": run })).unwrap();
    let row = h.o.snapshot()[0].clone();
    for k in ["workerPermission", "attachMode", "autoStopReported", "allowedClis", "reviewerClis", "deliveries"] {
        assert!(d.get(k).is_none(), "보기에 {k}");
    }
    for k in ["workerPermission", "attachMode", "needsHuman", "needsHumanStreams"] {
        assert!(row.get(k).is_none(), "요약에 {k}");
    }
}

/// 타일 MCP 토큰을 프런트에 내주는 Tauri 명령이 없다(GUI Rust 만 — 서버가 셸 환경에 넣고 GUI Rust 가 `--mcp-config` 에만 쓴다). 조정자 토큰은
/// 3차 4단계에 걷었다.
#[test]
fn tile_token_has_no_frontend_command() {
    let lib = include_str!("../lib.rs");
    let start = lib.find("generate_handler![").unwrap();
    let list = &lib[start..start + lib[start..].find("])").unwrap()];
    for needle in ["coordinator_token", "tile_token", "mcp_token", "sessions_server"] {
        assert!(!list.contains(needle), "프런트 명령에 {needle} 이 있으면 안 된다");
    }
    assert!(list.contains("orchestration_pause"));
    // (3차 6단계) 사람이 Run 을 여는 명령 · [이어 가기] · 시작 미리 보기 · worktree 목록 명령은 걷었다 · (2단계 단계 6 뒤) [이 타일의 MCP 거두기]도.
    for gone in [
        "orchestration_start_run",
        "orchestration_continue",
        "orchestration_start_preview",
        "orchestration_wt_list",
        "orchestration_revoke_tile",
    ] {
        assert!(!list.contains(&format!("::{gone},")), "{gone}");
    }
    let proxy = include_str!("../server/orchestration_proxy.rs");
    let cmd_count = proxy.matches("#[tauri::command]").count();
    assert_eq!(
        cmd_count, 33,
        "앨범 병합 [병합] 재료 · [병합] 둘 · 6단계 — 최근 활동 · [기록 보기] 둘 · 리뷰 F11 감독 사건 둘 · F14 같은 폴더 판정 하나 · 통합 1단계 [파일 목록] 하나 · 2단계 [Run 완료] · 보류 풀기 · 통합 [취소] 셋 · 3단계 [조정] 재료 · [조정] · [브랜치로 내보내기] 셋 · 4단계 [검증 실행] · [검증 실패인데 수락] 둘 · 통합 6단계 [정리] 재료 · [정리] · [그래도 지우기] 셋 — (3a) [돌려주기] · [복구 완료] · [유지] 셋은 걷었다 · (3차 4단계의 [이 타일의 MCP 거두기] 하나는 2단계 단계 6 뒤 걷었다) · (3차 5단계) 보드 배치 장부 하나 · (10-29 오케스트레이션 탭 1단계의 프로듀서 표지 하나는 2단계 전환에 걷었다) · (3차 6단계) 시작 · [이어 가기] · 기준 줄 · worktree 목록 넷은 걷었다"
    );
    assert!(!proxy.contains("coordinator_token") && !proxy.contains("CoordinatorGrant"), "조정자 토큰 길은 걷었다");
    // 타일 토큰을 읽는 GUI 함수(`ai_proxy::mcp_tile_token`)는 Tauri 명령이 아니다.
    let ai = include_str!("../server/ai_proxy.rs");
    let token_fn = ai.find("async fn mcp_tile_token").unwrap();
    let before = &ai[..token_fn];
    let prev_end = before.rfind("\n}").unwrap();
    assert!(!before[prev_end..].contains("#[tauri::command]"), "타일 토큰 함수는 Tauri 명령이 아니다");
}

// ---------------------------------------------------------------------------
// 2b — 조정자 타일 묶기 · 토큰이 프런트로 가지 않음
// ---------------------------------------------------------------------------

/// 조정자 타일(스트림)을 묶은 뒤 그 CLI 가 끝나면(`session-end` · 세션 회수) Run 이 paused(`coordinator-exited`) + 사건 + 감사.
/// 옛 세대에 묶인 타일 · 다른 스트림 · 이미 멈춘 Run 은 건드리지 않는다.
#[test]
fn bind_coordinator_session_end_pauses_run() {
    let h = harness(None);
    let run = start(&h.o);
    // 다른 스트림 · 묶기 전 — 아무 일 없음.
    assert_eq!(h.o.coordinator_exited("stream-a"), 0);
    h.o.bind_coordinator(&run, 1, "stream-a").unwrap();
    // 옛 세대 묶기는 거절.
    assert_eq!(h.o.bind_coordinator(&run, 0, "stream-x").unwrap_err().code, reason::STALE_GENERATION);
    assert_eq!(h.o.bind_coordinator(&run, 1, "").unwrap_err().code, reason::INVALID_ARGUMENT);
    assert_eq!(h.o.coordinator_exited("stream-b"), 0);
    drain_audit(&h);
    h.events.lock().unwrap().clear();
    assert_eq!(h.o.coordinator_exited("stream-a"), 1);
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!(d["state"], "paused");
    assert_eq!(d["pauseReason"], "coordinator-exited");
    assert!(d["log"].as_array().unwrap().iter().any(|e| e["action"] == "coordinator_exited"));
    let recs = drain_audit(&h);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].event, "coordinator_exited");
    assert_eq!(recs[0].orchestration.as_ref().unwrap().actor, "server");
    assert_eq!(recs[0].orchestration.as_ref().unwrap().run_state.as_deref(), Some("paused"));
    let ev: Vec<(String, Value)> = h.events.lock().unwrap().iter().filter(|(n, _)| n == EVT_CHANGED).cloned().collect();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].1["runId"], run.as_str());
    // 감독 사건(리뷰 F11) — 조정자 종료는 사람이 볼 일이다(사건 id 하나).
    let notices = h.o.notices_view();
    assert!(notices.as_array().unwrap().iter().any(|n| n["kind"] == "coordinator-exited" && n["runId"] == run.as_str()), "{notices}");
    // 묶음은 풀렸다 — 같은 스트림의 두 번째 끝은 아무 일 없음.
    assert_eq!(h.o.coordinator_exited("stream-a"), 0);
    // 조정자가 없으면 재개 못 한다(`no-coordinator`). 묶고 재개 → 세대 교체(세대 2 — 제품에서는 `adopt_run`) — 옛 세대(1)에 묶인 타일이 끝나도
    // 멈추지 않는다.
    assert_eq!(h.o.resume(&run).unwrap_err().code, reason::NO_COORDINATOR);
    h.o.bind_coordinator(&run, 1, "stream-old").unwrap();
    h.o.resume(&run).unwrap();
    h.o.bump_gen_for_test(&run).unwrap();
    assert_eq!(h.o.coordinator_exited("stream-old"), 0);
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "running");
    // 새 세대 타일이 끝나면 멈춘다.
    h.o.bind_coordinator(&run, 2, "stream-new").unwrap();
    assert_eq!(h.o.coordinator_exited("stream-new"), 1);
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "paused");
    // 사람이 이미 멈춘 Run — 상태 · 까닭은 그대로(human), 묶음을 풀고 같은 사건 · 감사(보드가 "조정자 없음" 을 안다).
    h.o.bind_coordinator(&run, 2, "stream-new").unwrap();
    h.o.resume(&run).unwrap();
    h.o.pause(&run).unwrap();
    drain_audit(&h);
    assert_eq!(h.o.coordinator_exited("stream-new"), 1);
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!((d["state"].as_str(), d["pauseReason"].as_str()), (Some("paused"), Some("human")));
    assert_eq!(d["coordinatorAttached"], false);
    let recs = drain_audit(&h);
    assert_eq!(recs.iter().map(|r| r.event.as_str()).collect::<Vec<_>>(), ["coordinator_exited"]);
    // 알림 상세 — 이미 멈춘 앨범이면 `already-paused`(화면 문구가 "이미 멈춰 있었다"), 서버가 멈춘 것은 상세 없음(실기 10-29).
    let notices = h.o.notices_view();
    let exited: Vec<&Value> = notices.as_array().unwrap().iter().filter(|n| n["kind"] == "coordinator-exited").collect();
    assert_eq!(exited.last().unwrap()["detail"], "already-paused", "{notices}");
    assert!(exited.iter().any(|n| n["detail"].is_null()), "{notices}");
    // 중단된 Run 에는 묶지 못한다.
    h.o.stop(&run).unwrap();
    assert_eq!(h.o.bind_coordinator(&run, 2, "s").unwrap_err().code, reason::RUN_STOPPED);
}

/// 시험 `tile_token_never_reaches_frontend`(설계 7-2 — 옛 `coordinator_token_never_reaches_frontend` 의 뜻 바꿈) — **타일 MCP 토큰**은 프런트로
/// 가지 않는다(소스 훑기): Tauri 명령 몸 · 반환 · 이벤트 몸 · 프런트 소스 · `Debug` 어디에도.
#[test]
fn tile_token_never_reaches_frontend() {
    // (1) Tauri 명령의 몸은 타일 토큰 op · 함수를 부르지 않는다 — 토큰을 읽는 함수(`ai_proxy::mcp_tile_token`)는 Tauri 명령이 아니다. 예외는 둘이고
    //     반환에 토큰이 없다: autorun(명령 줄 — 토큰은 `--mcp-config` 파일에만 · 줄에 없는 것은 `agent_mcp` 시험) · 세션 열기(서버가 셸 환경에 넣는다).
    for (name, src) in [
        ("orchestration_proxy.rs", include_str!("../server/orchestration_proxy.rs")),
        ("ai_proxy.rs", include_str!("../server/ai_proxy.rs")),
        ("proxy.rs", include_str!("../server/proxy.rs")),
    ] {
        for chunk in src.split("#[tauri::command]").skip(1) {
            let body = &chunk[..chunk.find("\n}").unwrap_or(chunk.len())];
            for needle in ["mcp_tile_token", "tile_token::", "token_for", "coordinator_token", "CoordinatorGrant"] {
                assert!(!body.contains(needle), "{name} 의 Tauri 명령 몸에 {needle}: {body}");
            }
        }
    }
    let autorun = include_str!("../agent_autorun.rs");
    assert!(autorun.contains("-> Result<String, String>"), "autorun 은 명령 줄만 돌려준다");
    // (2) 세션 열기의 반환에 토큰이 없다(세션 = id · 셸 · 임대). GUI 는 MCP 토큰을 싣지 않는다 — `open` 몸에는 `mcp` 깃발만.
    let open = include_str!("../server/proxy.rs");
    let ls = &open[open.find("pub struct LocalSession").unwrap()..];
    let ls = &ls[..ls.find('}').unwrap()];
    assert!(!ls.to_ascii_lowercase().contains("token"), "{ls}");
    let open_fn = &open[open.find("pub async fn open_local_session").unwrap()..];
    let open_fn = &open_fn[..open_fn.find("\n}\n").unwrap_or(open_fn.len())];
    assert!(
        !open_fn.contains("MCP_TOKEN_ENV") && !open_fn.contains("tile_token") && open_fn.contains("\"mcp\": mcp"),
        "GUI 는 MCP 토큰 값을 싣지 않는다 — 서버에 깃발만"
    );
    // (2-1) (2026-10-26) 감싸개가 있는 로컬 셸 타일의 장식 파일(`agent_tile`)은 Tauri 명령이 아니고 토큰을 직접 읽지 않는다 — 좌표는
    //       `sessions_server_for` 가 주고 값은 실행 설정 파일(`agent_mcp::configured_tokens`)에만 간다. 셸 환경에는 파일 **경로**만.
    let agent_tile = include_str!("../agent_tile.rs");
    for needle in ["#[tauri::command]", "mcp_tile_token", "tile_token::", "token_for", "MCP_TOKEN_ENV"] {
        assert!(!agent_tile.contains(needle), "agent_tile.rs 에 {needle}");
    }
    assert!(agent_tile.contains("crate::agent_mcp::configured_tokens("), "장식은 autorun 과 같은 MCP 낱말");
    assert!(open_fn.contains("TILE_AGENT_ENV") && open_fn.contains("\"ai\": ai"), "셸에는 장식 파일 경로 · 서버에는 AI 타일 깃발");
    // (2') 타일 토큰 표는 `Debug` 를 파생하지 않는다(토큰이 든 칸) — 파생하는 것은 토큰 없는 확인 결과 하나.
    // 개행을 먼저 맞춘다 — main 워크트리는 CRLF 로 체크아웃되어 빈 줄 `"\n\n"` 찾기가 빗나가면 파일 맨 앞부터 훑는다(병합 때 거짓 실패).
    let tile = include_str!("../tile_token.rs").replace("\r\n", "\n");
    for ty in ["struct Entry", "struct TileTokens"] {
        let at = tile.find(ty).unwrap();
        let head = &tile[tile[..at].rfind("\n\n").unwrap_or(0)..at];
        assert!(
            !head.lines().any(|l| l.trim_start().starts_with("#[derive") && l.contains("Debug")),
            "{ty} 가 Debug 를 파생한다"
        );
    }
    // (3) 이벤트 몸은 {runId, seq, closed?, archive?} 뿐 — 저장소의 emit 자리는 그 모양만 만든다.
    // 저장소는 `store.rs` + `store/` 조각(2026-10-27 분할) — 전부 훑고, emit 자리를 실제로 찾았는지도 본다(빈 반복으로 통과하지 않게).
    let mut emits = 0;
    for (name, store) in store_sources() {
        for line in store.lines().filter(|l| l.contains("(self.emit)(")) {
            emits += 1;
            assert!(line.contains("\"runId\"") && !line.to_ascii_lowercase().contains("token"), "{name}: {line}");
        }
    }
    assert!(emits > 0, "저장소의 emit 자리를 못 찾았다");
    // (4) 프런트 소스에 조정자 토큰을 부르는 글자가 없다.
    fn walk(dir: &Path, hits: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, hits);
            } else if p.extension().is_some_and(|x| x == "ts" || x == "svelte") {
                let s = std::fs::read_to_string(&p).unwrap_or_default();
                if ["coordinator_token", "coordinatorToken", "mcp_tile_token", "mcpTileToken", "mcp_token\"", "tileToken"]
                    .iter()
                    .any(|n| s.contains(n))
                {
                    hits.push(p.display().to_string());
                }
            }
        }
    }
    let mut hits = Vec::new();
    walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../src"), &mut hits);
    assert!(hits.is_empty(), "프런트가 MCP 토큰을 부른다: {hits:?}");
}

/// 7단계 실기 — 서버 재시작 뒤 orphaned Run 의 Attempt 는 옛 서버의 마지막 상태("보고됨 · 입력 대기")로 남는다. 그 프로세스가 이미 죽었으면
/// worktree 는 "쓰는 중" 이 아니다(예전에는 `worktree-in-use` 로 영영 못 지웠다).
#[test]
fn orphaned_dead_worker_does_not_hold_worktree() {
    let dir = scratch("orphan-wt");
    let (run, task) = {
        let h = harness(Some(dir.clone()));
        let run = start(&h.o);
        let (c, _) = coordinator(&h.o, &run);
        let task = task_id(&create(&h.o, &c, "r1", "A", &[]).unwrap());
        (run, task)
    };
    // 옛 서버가 남긴 Attempt — 상태는 "입력 대기", pid 는 이미 없다.
    let file = dir.join(format!("{run}.json"));
    let mut v: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    let wt = "C:/nowhere/repo-wt/orch-x";
    v["run"]["attempts"] = json!([{
        "id": "att-0123456789abcdef0123456789abcdef", "taskId": task, "cli": "claude", "gen": 1, "state": "ready",
        "stream": "orch-0123456789abcdef0123456789abcdef", "worktree": wt, "branch": "orch-x", "baseCommit": "0000000",
        "pid": 4_294_967_000u32, "conversationId": null, "launchArgs": "claude --permission-mode manual", "attention": null,
        "startedAt": 1, "endedAt": null, "exitReason": null
    }]);
    std::fs::write(&file, serde_json::to_string(&v).unwrap()).unwrap();
    let h = harness(Some(dir.clone()));
    assert_eq!(h.o.snapshot()[0]["state"], "orphaned");
    assert_eq!(h.o.run_detail(&run).unwrap()["attempts"][0]["state"], "ready", "Attempt 가 올라왔다");
    assert!(!h.o.worktree_in_use(&run, wt), "죽은 작업자는 worktree 를 붙잡지 않는다");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 리뷰 F10 — 잠금 안에서는 순서 있는 스냅숏만 넣고 직렬화 · 디스크 동기화는 잠금 밖 쓰기 스레드가 한다. 빠른 사건 여럿 뒤에도 파일은
/// 마지막 사건까지(순서 보존 — 옛 스냅숏이 새 것을 덮지 않는다). 저장이 늦어도 중단은 디스크를 기다리지 않는다(소스 훑기 — 보조).
#[test]
fn persistence_is_off_lock_and_ordered() {
    let dir = scratch("saver");
    let h = harness(Some(dir.clone()));
    let run = start(&h.o);
    let (c, _) = coordinator(&h.o, &run);
    for i in 0..40 {
        create(&h.o, &c, &format!("r{i}"), &format!("T{i}"), &[]).unwrap();
    }
    h.o.pause(&run).unwrap();
    h.o.flush_saves();
    let mem = h.o.lock().runs.get(&run).unwrap().run.clone();
    let disk = persist::decode(&std::fs::read(dir.join(format!("{run}.json"))).unwrap()).unwrap();
    assert_eq!(disk, mem, "파일은 마지막 사건까지");
    assert_eq!(disk.tasks.len(), 40);
    // 잠금 안의 `after_change` 는 디스크에 쓰지 않는다 — 쓰기 스레드 하나만 `persist::save` 를 부른다.
    let src = include_str!("store.rs");
    let at = src.find("pub(super) fn after_change").unwrap();
    let body = &src[at..at + src[at..].find("\n    }\n").or_else(|| src[at..].find("\n    }\r\n")).unwrap()];
    assert!(!body.contains("persist::save"), "after_change 는 스냅숏만 넣는다");
    // 쓰기 스레드 하나 — 저장소 전체(`store.rs` + `store/` 조각)에서 `persist::save(` 는 한 번, 그 자리는 쓰기 줄(`store/saver.rs`).
    let saves: Vec<(String, usize)> = store_sources()
        .into_iter()
        .map(|(name, s)| (name, s.matches("persist::save(").count()))
        .filter(|(_, n)| *n > 0)
        .collect();
    assert_eq!(saves, vec![("src/orchestration/store/saver.rs".to_string(), 1)], "쓰기 스레드 하나");
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// F7 — 확인 없는 저장의 실패도 Run 보기(`get_run` · 상세 · 목록)의 `persist` 에 보인다: 실패가 처음 생길 때 사건 `persist_failed`(seq +1 ·
/// 이벤트), 실패 중 다른 실패는 연속 수만(사건 없음), 다음 저장이 성공하면 지워진다(`persist_recovered`). 표지 사건은 쓰기 줄에 넣지 않아
/// 실패 → 다시 저장 → 실패 고리가 없다. 원문(경로 · OS 문장)은 보기에 없다(분류 낱말만).
#[test]
fn save_failure_shows_on_run_view_and_clears() {
    let dir = scratch("persist-mark");
    let events: Events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let emit: EmitFn = Arc::new(move |n: &str, b: Value| sink.lock().unwrap().push((n.to_string(), b)));
    let o = Arc::new(Orchestration::with_clock(Some(dir.clone()), emit, None, Arc::new(|| 1_000_000_000)));
    o.install_self();
    let run = start(&o);
    let (c, _) = coordinator(&o, &run);
    let get = || call(&o, &c, "get_run", json!({})).unwrap();
    let seq_of = |v: &Value| v["latestSeq"].as_u64().unwrap();
    o.flush_saves();
    let v = get();
    assert_eq!(v["persist"], json!({ "ok": true, "lastSavedSeq": seq_of(&v), "failing": null }));
    // 실패가 처음 생긴다 — 사건 하나 · 그 seq 의 이벤트.
    o.set_save_fault(true);
    create(&o, &c, "p1", "A", &[]).unwrap();
    o.flush_saves();
    let v = get();
    let failed_at = seq_of(&v);
    assert_eq!(v["persist"]["ok"], false, "{v}");
    assert_eq!(v["persist"]["failing"]["reason"], "io-error");
    assert_eq!(v["persist"]["failing"]["count"], 1);
    assert!(v["persist"]["lastSavedSeq"].as_u64().unwrap() < failed_at);
    assert!(!v["persist"].to_string().contains("injected"), "원문은 로그에만");
    let log = o.run_detail(&run).unwrap()["log"].clone();
    assert_eq!(log.as_array().unwrap().last().unwrap()["action"], "persist_failed");
    assert!(events.lock().unwrap().iter().any(|(n, b)| n == EVT_CHANGED && b["seq"] == failed_at), "보드가 다시 읽을 이벤트");
    assert_eq!(o.snapshot()[0]["persist"]["ok"], false, "목록에도");
    // 고리 없음 — 더 바꾸지 않으면 seq 가 그대로다.
    o.flush_saves();
    std::thread::sleep(Duration::from_millis(50));
    o.flush_saves();
    assert_eq!(seq_of(&get()), failed_at, "표지 사건은 다시 저장을 부르지 않는다");
    // 실패 중 또 실패 — 연속 수만(사건 없음 · seq 는 그 변경 하나만).
    create(&o, &c, "p2", "B", &[]).unwrap();
    o.flush_saves();
    let v = get();
    assert_eq!(seq_of(&v), failed_at + 1);
    assert_eq!(v["persist"]["failing"]["count"], 2);
    // 다음 저장이 성공하면 지워진다(사건 `persist_recovered` — 그 사건 줄은 다음 변경과 함께 저장된다).
    o.set_save_fault(false);
    let saved = seq_of(&create(&o, &c, "p3", "C", &[]).unwrap());
    o.flush_saves();
    let v = get();
    assert_eq!(v["persist"], json!({ "ok": true, "lastSavedSeq": saved, "failing": null }), "{v}");
    assert_eq!(seq_of(&v), saved + 1);
    let log = o.run_detail(&run).unwrap()["log"].clone();
    assert_eq!(log.as_array().unwrap().last().unwrap()["action"], "persist_recovered");
    let disk = persist::decode(&std::fs::read(dir.join(format!("{run}.json"))).unwrap()).unwrap();
    assert_eq!(disk.seq, saved, "표지 사건은 쓰기 줄에 넣지 않았다");
    drop(o);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 저장소 소스 전부(`src/orchestration/store.rs` + `store/` 아래 `.rs` — 2026-10-27 분할) — `(경로, 본문)`. 소스 훑기 시험이 파일을 옮겨도
/// 같은 불변식을 보게 한다. 조각 폴더가 비면 실패한다(훑을 대상이 사라진 채 통과하지 않게).
pub(super) fn store_sources() -> Vec<(String, String)> {
    let mut out = vec![("src/orchestration/store.rs".to_string(), std::fs::read_to_string("src/orchestration/store.rs").unwrap())];
    let mut parts: Vec<PathBuf> = std::fs::read_dir("src/orchestration/store")
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .collect();
    parts.sort();
    assert!(!parts.is_empty(), "store/ 조각을 못 찾았다");
    for p in parts {
        let name = p.to_string_lossy().replace('\\', "/");
        out.push((name, std::fs::read_to_string(&p).unwrap()));
    }
    out
}

/// (3a) Run 목록 한 줄 — 작업자에게는 사람이 답할 화면이 없다(`needsHuman` 은 늘 0 — 옛 칸). 대신 `blocked`(맡긴 범위 밖이 필요해
/// 멈춘 `idle` 작업자 수 — 조정자가 사람에게 말한다)를 센다.
#[test]
fn snapshot_counts_blocked_workers_not_tiles() {
    let h = harness(None);
    let run = start(&h.o);
    put_attempt(&h.o, &run, AttemptState::Running);
    put_attempt(&h.o, &run, AttemptState::Exited);
    let idle = put_attempt(&h.o, &run, AttemptState::Idle);
    let row = |o: &Orchestration| o.snapshot().as_array().unwrap().iter().find(|r| r["runId"] == run.as_str()).unwrap().clone();
    // (3차 6단계) 옛 칸 `needsHuman` · `needsHumanStreams` 는 걷었다.
    assert!(row(&h.o).get("needsHuman").is_none() && row(&h.o).get("needsHumanStreams").is_none());
    assert_eq!(row(&h.o)["blocked"], 0);
    {
        let mut g = h.o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.attempts.iter_mut().find(|a| a.id == idle).unwrap().blocked = Some(Blocked { need: "cargo test".into(), at: 1 });
    }
    assert_eq!(row(&h.o)["blocked"], 1, "blocked 로 쉬는 작업자");
    // (오케스트레이션 탭 ⑤ · D9) 턴이 살아 있을 수 있는 Attempt 수 — 종류별. 끝난 · 쉬는 것은 세지 않는다.
    assert_eq!(row(&h.o)["running"], serde_json::json!({ "write": 1, "judge": 0 }));
    let judge = put_attempt(&h.o, &run, AttemptState::Running);
    {
        let mut g = h.o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.attempts.iter_mut().find(|a| a.id == judge).unwrap().kind = Some(AttemptKind::Judge);
    }
    assert_eq!(row(&h.o)["running"], serde_json::json!({ "write": 1, "judge": 1 }));
}
