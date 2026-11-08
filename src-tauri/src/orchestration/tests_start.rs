//! 앨범 전용 MCP 계약과 공통 시험 저장소.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::store::*;
use super::test_album as td;
use crate::chat_token::FakeProducer;
use crate::tile_token::FakeTile;

pub(super) fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-h5-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn git(dir: &Path, args: &[&str]) -> String {
    let mut cmd = Command::new("git");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("GIT_") {
            cmd.env_remove(k);
        }
    }
    let out = cmd.arg("-C").arg(dir).args(args).output().expect("git");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn repo(root: &Path) -> PathBuf {
    let d = root.join("repo");
    std::fs::create_dir_all(d.join("sub")).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Five"]);
    git(&d, &["config", "user.email", "h5@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("a.txt"), "a\n").unwrap();
    std::fs::write(d.join("sub").join("b.txt"), "b\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

pub(super) struct H {
    pub(super) o: Arc<Orchestration>,
    pub(super) root: PathBuf,
    pub(super) repo: PathBuf,
    pub(super) clock: Arc<AtomicU64>,
    pub(super) events: Arc<Mutex<Vec<(String, Value)>>>,
}
impl Drop for H {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
pub(super) fn harness(tag: &str) -> H {
    let root = scratch(tag);
    let repo = repo(&root);
    let clock = Arc::new(AtomicU64::new(1_900_000_000_000));
    let c = clock.clone();
    let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    let e = events.clone();
    let o = Arc::new(Orchestration::with_clock(
        None,
        Arc::new(move |n, v| e.lock().unwrap().push((n.into(), v))),
        None,
        Arc::new(move || c.fetch_add(1, Ordering::SeqCst)),
    ));
    o.set_ephemeral(true);
    o.set_integrator(Arc::new(super::integrate::GitRefs));
    td::delegate_all(&o);
    H {
        o,
        root,
        repo,
        clock,
        events,
    }
}
pub(super) fn open(h: &H, seat: &Seat) -> Value {
    let (id, gen) =
        h.o.start_run(StartRun {
            name: "사람 앨범".into(),
            repo: h.repo.display().to_string(),
            worktree_dir: h.root.join("wt").display().to_string(),
            limits: Limits::default(),
            verify: None,
        })
        .unwrap();
    crate::chat_token::set_album_for_test(&seat.chat, seat.proc, &id);
    h.o.bind_seat_for_test(&id, gen, seat).unwrap();
    {
        let mut g = h.o.lock();
        let s = g.runs.get_mut(&id).unwrap();
        s.run.producers.push(seat.chat.clone());
        g.producer_ever.insert(seat.chat.clone(), id.clone());
    }
    json!({"runId":id,"gen":gen})
}

pub(super) fn code(r: &Result<Value, String>) -> String {
    r.clone()
        .expect_err("거절이어야 한다")
        .split(": ")
        .next()
        .unwrap()
        .to_string()
}

pub(super) fn body(r: &Result<Value, String>) -> Value {
    let e = r.clone().expect_err("거절이어야 한다");
    let (_, rest) = e.split_once(": ").unwrap();
    serde_json::from_str(rest).unwrap_or_else(|_| panic!("JSON 몸: {rest}"))
}

fn call_body(tool: &str, args: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": tool, "arguments": args } })
}

fn mcp(caller: &Caller, o: &Orchestration, delegated: bool, body: Value) -> Value {
    let store: crate::context::Store = Default::default();
    let ops: crate::operations::OperationStore = Default::default();
    let results: crate::operations::ResultStore = Default::default();
    let signal = crate::mcp::McpSignal::default();
    let toml = if delegated {
        "[[repo]]\npath = \"C:\\\\x\"\n"
    } else {
        ""
    };
    match crate::mcp::dispatch_as(
        caller,
        Some(o),
        &store,
        &ops,
        &results,
        &signal,
        &body.to_string(),
        || crate::delegation::Delegation::parse(toml).unwrap(),
        &crate::mcp::DbEnv::none(),
    ) {
        crate::mcp::RpcReply::Json(s) => serde_json::from_str(&s).unwrap(),
        crate::mcp::RpcReply::Accepted => panic!("결과를 기대했다"),
    }
}

fn names(caller: &Caller, o: &Orchestration, delegated: bool) -> Vec<String> {
    let v = mcp(
        caller,
        o,
        delegated,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
    );
    v["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

fn instructions(caller: &Caller, o: &Orchestration, delegated: bool) -> String {
    let v = mcp(
        caller,
        o,
        delegated,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
    );
    v["result"]["instructions"].as_str().unwrap().to_string()
}

fn names_of(all: &[Value]) -> Vec<&str> {
    all.iter().filter_map(|s| s["name"].as_str()).collect()
}

#[test]
fn coordination_schemas_fit_budget() {
    let all: Vec<Value> = super::tile_tool_schemas()
        .into_iter()
        .chain(super::coordinator_tool_schemas())
        .collect();
    let size: usize = all.iter().map(|s| s.to_string().len()).sum();
    for s in &all {
        eprintln!(
            "  {:<16} {}",
            s["name"].as_str().unwrap(),
            s.to_string().len()
        );
    }
    eprintln!("coordination schemas: {} tools, {size} bytes", all.len());
    assert!(
        size <= 7 * 1024 + 512,
        "조율 도구 스키마 합 {size} 바이트 > 7.5 KB"
    );
    let desc = |n: &str| {
        all.iter().find(|s| s["name"] == n).unwrap()["description"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let send = desc("send_prompt");
    assert!(
        send.contains("busy {attemptIds}") && send.contains("wait_run until=ready"),
        "{send}"
    );
    assert!(send.contains("reported or closed"), "{send}");
    let upd = desc("update_task");
    assert!(
        upd.contains("verif")
            && upd.contains("review-pending")
            && upd.contains("wait_run until=settled"),
        "{upd}"
    );
    assert!(desc("create_task").contains("same requestId"));
    assert!(desc("get_run").contains("requires runId and gen"));
    assert!(!desc("adopt_run").contains("tile"));
    // (10-31 실기) 프로듀서가 옛 낱말("보드" · [Export branch] · [Clean up])을 사람에게 전했다 — 지금 화면의 단추 이름만 쓴다.
    assert!(desc("complete_run").contains("[Export as branch]"));
    // (3차 6단계 — 5단계 실기) 완료가 지우는 것은 서버 임시 자리뿐 — 작업자 worktree · 브랜치는 사람의 [정리](조정자가 "정리했다" 고 잘못 전했다).
    assert!(
        desc("complete_run").contains("worker worktrees and branches stay")
            && desc("complete_run").contains("[Clean up worktrees]")
            && desc("complete_run").contains("[Merge]")
    );
    for tool in names_of(&all) {
        assert!(!desc(tool).contains("board"), "{tool}");
    }
    // (3차 6단계 · Q6) worktree 도구 셋은 걷었다.
    for gone in ["list_worktrees", "create_worktree", "remove_worktree"] {
        assert!(!names_of(&all).contains(&gone), "{gone}");
    }
    // 이름 표와 스키마가 한 표.
    assert_eq!(
        names_of(&all),
        super::preallowed_tools().collect::<Vec<_>>()
    );
}

#[test]
fn start_run_is_gone() {
    let h = harness("gone");
    let p = FakeProducer::open("gone", &h.repo.display().to_string());
    let tile = FakeTile::open("gone");
    for c in [
        Caller::Global,
        p.caller(),
        tile.caller(),
        Caller::Coordinator {
            run_id: "missing".into(),
            gen: 1,
        },
        Caller::Worker {
            run_id: "missing".into(),
            gen: 1,
            attempt_id: "missing".into(),
        },
        Caller::Reviewer {
            run_id: "missing".into(),
            gen: 1,
            attempt_id: "missing".into(),
        },
    ] {
        assert!(!names(&c, &h.o, false).iter().any(|n| n == "start_run"));
        let v = mcp(
            &c,
            &h.o,
            false,
            call_body("start_run", json!({"requestId":"old","name":"금지"})),
        );
        assert_eq!(v["result"]["isError"], true, "{v}");
        assert!(v.to_string().contains("Unknown tool"), "{v}");
    }
    assert_eq!(super::TILE_TOOLS, &["adopt_run"]);
    let text = instructions(&p.caller(), &h.o, false);
    assert!(!text.contains("start_run"));
    let fixed = include_str!("../server/producer/launch.rs");
    assert!(!fixed.contains("start_run"));
    assert_eq!(h.o.snapshot(), json!([]));
}

#[test]
fn tile_token_cannot_open_or_coordinate() {
    let h = harness("tile-only");
    let tile = FakeTile::open("only");
    let listed = names(&tile.caller(), &h.o, false);
    for tool in super::preallowed_tools() {
        assert!(!listed.iter().any(|n| n == tool));
        let v = mcp(&tile.caller(), &h.o, false, call_body(tool, json!({})));
        assert_eq!(v["result"]["isError"], true, "{tool}: {v}");
    }
}

// 이어받기·완료 계약은 사람이 연 앨범으로 계속 검사한다.
impl H {
    fn producer(&self, tag: &str) -> FakeProducer {
        FakeProducer::open(tag, &self.repo.display().to_string())
    }
    fn start(&self, p: &FakeProducer, _req: &str, _args: Value) -> Result<Value, String> {
        let (id, gen) = self
            .o
            .start_integrated_run(StartRun {
                name: "사람 앨범".into(),
                repo: self.repo.display().to_string(),
                worktree_dir: self.root.join("wt").display().to_string(),
                limits: Limits::default(),
                verify: None,
            })
            .map_err(|e| e.to_string())?;
        crate::chat_token::set_album_for_test(&p.chat, p.proc, &id);
        self.o.bind_seat_for_test(&id, gen, &p.seat()).unwrap();
        {
            let mut g = self.o.lock();
            g.runs
                .get_mut(&id)
                .unwrap()
                .run
                .producers
                .push(p.chat.clone());
            g.producer_ever.insert(p.chat.clone(), id.clone());
        }
        self.o.call_tool(&p.caller(), "get_run", Some(&json!({})))
    }
    fn adopt(&self, p: &FakeProducer, req: &str, run: &str) -> Result<Value, String> {
        crate::chat_token::set_album_for_test(&p.chat, p.proc, run);
        self.o.call_tool(
            &p.caller(),
            "adopt_run",
            Some(&json!({"requestId":req,"runId":run})),
        )
    }
    fn create(&self, p: &FakeProducer, run: &str, gen: u64, req: &str) -> Result<Value, String> {
        self.o.call_tool(
            &p.caller(),
            "create_task",
            Some(&json!({"runId":run,"gen":gen,"requestId":req,"title":req,"goal":"g"})),
        )
    }
    fn summary(&self, run: &str) -> Value {
        self.o
            .snapshot()
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["runId"] == run)
            .unwrap()
            .clone()
    }
    fn notices(&self, kind: &str) -> Vec<Value> {
        self.o
            .notices_view()
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["kind"] == kind)
            .cloned()
            .collect()
    }
}
pub(super) fn exit(h: &H, p: &FakeProducer) -> usize {
    p.close();
    h.o.coordinator_exited_seat(&p.seat())
}
pub(super) fn first(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("now");
    }
    v
}
fn put_attempt(o: &Orchestration, run: &str, task: &str, state: AttemptState) -> String {
    let id = new_id("att").unwrap();
    let mut g = o.lock();
    let slot = g.runs.get_mut(run).unwrap();
    let gen = slot.run.gen;
    slot.run.attempts.push(Attempt {
        id: id.clone(),
        task_id: task.into(),
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
        role_id: Some(td::WRITER.into()),
        role_name: Some("구현".into()),
        blocked: None,
        conversation_broken: false,
        stop_requested: false,
    });
    id
}

#[test]
fn adopt_run_takes_over_exited_coordinator() {
    let h = harness("adopt");
    let a = h.producer("adopt-a");
    let b = h.producer("adopt-b");
    let run = h.start(&a, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    // 조정자가 끝나기 전 — running 은 이어받지 않는다.
    let why = |r: &Result<Value, String>| body(r)["why"].as_str().unwrap().to_string();
    let r = h.adopt(&b, "x0", &run);
    assert_eq!(
        (code(&r), why(&r)),
        ("not-adoptable".into(), "running".into())
    );
    // 사람 일시정지 — 이어받지 않는다.
    h.o.pause(&run).unwrap();
    let r = h.adopt(&b, "x1", &run);
    assert_eq!(why(&r), "paused-by-person");
    h.o.resume(&run).unwrap();
    // 조정자 프로세스가 끝났다 → paused(coordinator-exited). 사람 [재개] 는 조정자가 없어 거절(조정자 없는 running 을 만들지 않는다).
    assert_eq!(exit(&h, &a), 1);
    assert_eq!(h.o.resume(&run).unwrap_err().code, "no-coordinator");
    assert_eq!(h.summary(&run)["coordinatorAttached"], false);
    // 이어받기.
    let v = h.adopt(&b, "y1", &run).unwrap();
    assert_eq!(
        (v["runId"].as_str(), v["gen"].as_u64()),
        (Some(run.as_str()), Some(2))
    );
    assert_eq!(v["now"]["state"], "running");
    assert_eq!(h.o.bound_seat(&b.seat()), Some((run.clone(), 2)));
    assert_eq!(h.o.bound_seat(&a.seat()), None);
    assert_eq!(h.summary(&run)["producers"], json!([a.chat, b.chat]));
    assert_eq!(h.notices("run-adopted").len(), 1);
    // 멱등 — 같은 requestId 는 처음 결과(이미 조정자여도).
    assert_eq!(first(&h.adopt(&b, "y1", &run).unwrap()), first(&v));
    // 옛 자리의 늦은 조율 = stale-generation · 새 자리는 gen 2 로.
    assert_eq!(code(&h.create(&a, &run, 1, "late")), "stale-generation");
    h.create(&b, &run, 2, "t-new").unwrap();
    // 조율 한도로 멈춘 Run 은 이어받지 않는다(사람 일시정지 중 종료는 `adopt_run_keeps_person_pause`).
    let c = h.producer("adopt-c");
    let d = h.producer("adopt-d");
    let run2 = h.start(&d, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    h.clock.fetch_add(121 * 60 * 1000, Ordering::SeqCst);
    h.o.tick();
    assert_eq!(why(&h.adopt(&c, "z2", &run2)), "coordination-limit");
    // 다른 산 Run 의 조정자는 이어받지 못한다.
    assert_eq!(code(&h.adopt(&d, "z3", &run)), "already-coordinating");
    // 끝난 Run.
    h.o.stop(&run2).unwrap();
    assert_eq!(why(&h.adopt(&c, "z4", &run2)), "ended");
    assert_eq!(
        code(&h.adopt(&c, "z5", "run-00000000000000000000000000000000")),
        "not-found"
    );
}

#[test]
fn adopt_run_keeps_person_pause() {
    let h = harness("adopt-human");
    let why = |r: &Result<Value, String>| body(r)["why"].as_str().unwrap().to_string();
    // (b) 사람 일시정지 → 조정자 종료 → 사건 · seq ↑ → 이어받기(paused 유지) → 사람 재개.
    let a = h.producer("adopt-h-a");
    let b = h.producer("adopt-h-b");
    let run = h.start(&a, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    h.o.pause(&run).unwrap();
    assert_eq!(h.summary(&run)["coordinatorAttached"], true);
    let seq = h.summary(&run)["latestSeq"].as_u64().unwrap();
    assert_eq!(
        exit(&h, &a),
        1,
        "paused 여도 지금 세대의 묶음을 풀었으면 사건"
    );
    let s = h.summary(&run);
    assert_eq!(
        (s["state"].as_str(), s["pauseReason"].as_str()),
        (Some("paused"), Some("human"))
    );
    assert_eq!(s["coordinatorAttached"], false);
    assert!(s["latestSeq"].as_u64().unwrap() > seq);
    let log = h.o.run_detail(&run).unwrap()["log"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(log.last().unwrap()["action"], "coordinator_exited");
    assert_eq!(h.notices("coordinator-exited").len(), 1);
    assert_eq!(
        h.o.coordinator_exited_seat(&a.seat()),
        0,
        "묶음이 없으면 다시 내지 않는다"
    );
    assert_eq!(h.o.resume(&run).unwrap_err().code, "no-coordinator");
    let v = h.adopt(&b, "y1", &run).unwrap();
    assert_eq!(
        (v["gen"].as_u64(), v["paused"].as_bool()),
        (Some(2), Some(true))
    );
    assert!(v["hint"].as_str().unwrap().contains("wait_run"));
    let s = h.summary(&run);
    assert_eq!(
        (s["state"].as_str(), s["pauseReason"].as_str()),
        (Some("paused"), Some("human"))
    );
    assert_eq!(s["coordinatorAttached"], true);
    assert_eq!(h.o.bound_seat(&b.seat()), Some((run.clone(), 2)));
    assert_eq!(h.notices("run-adopted").len(), 1);
    // (d) 조정자가 묶인 사람 일시정지 — 이어받지 않는다.
    let c = h.producer("adopt-h-c");
    assert_eq!(why(&h.adopt(&c, "z1", &run)), "paused-by-person");
    // (e) 조정자가 있는 paused 의 [재개] 는 선다.
    h.o.resume(&run).unwrap();
    assert_eq!(h.summary(&run)["state"], "running");
}

#[test]
fn adopt_run_refused_when_producer_goes_mid_adopt() {
    let h = harness("mid-adopt");
    let a = h.producer("mid-adopt-a");
    let run = h.start(&a, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(exit(&h, &a), 1);
    let untouched = |h: &H, r: &Result<Value, String>, p: &FakeProducer| {
        assert_eq!(code(r), "not-a-tile", "{r:?}");
        assert!(
            r.as_ref()
                .unwrap_err()
                .contains("while the album was being taken over"),
            "{r:?}"
        );
        let s = h.summary(&run);
        assert_eq!(
            (s["state"].as_str(), s["pauseReason"].as_str()),
            (Some("paused"), Some("coordinator-exited"))
        );
        assert_eq!(s["coordinatorAttached"], false);
        assert_eq!(s["producers"], json!([a.chat]));
        assert_eq!(h.o.run_detail(&run).unwrap()["gen"], 1);
        assert_eq!(h.o.bound_seat(&p.seat()), None);
        assert!(h.notices("run-adopted").is_empty());
    };
    // 프로세스 끝.
    let b = h.producer("mid-adopt-b");
    let (o, seat) = (Arc::clone(&h.o), b.seat());
    super::start::set_before_bind(move || {
        assert!(crate::chat_token::revoke(&seat.chat, seat.proc));
        assert_eq!(o.coordinator_exited_seat(&seat), 0);
    });
    untouched(&h, &h.adopt(&b, "y1", &run), &b);
    // 토큰 칸만 먼저 거둔 순간(프로세스 끝의 첫 걸음).
    let mut e = h.producer("mid-adopt-e");
    let seat = e.seat();
    super::start::set_before_bind(move || {
        assert!(crate::chat_token::revoke(&seat.chat, seat.proc));
    });
    untouched(&h, &h.adopt(&e, "y2", &run), &e);
    // 끼어든 사건이 없으면 이어받는다(같은 채팅을 다시 띄운 새 세대 · 같은 requestId — 거절은 기록되지 않았다).
    e.proc = crate::server::chat_proc::ProcId::next();
    e.token = crate::chat_token::insert_producer_for_test(
        &e.chat,
        e.proc,
        &h.repo.display().to_string(),
        false,
    );
    let v = h.adopt(&e, "y2", &run).unwrap();
    assert_eq!(
        (v["gen"].as_u64(), v["now"]["state"].as_str()),
        (Some(2), Some("running"))
    );
    assert_eq!(h.o.bound_seat(&e.seat()), Some((run.clone(), 2)));
}

#[test]
fn complete_run_by_coordinator() {
    let h = harness("complete");
    let p = h.producer("complete");
    let run = h.start(&p, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let call = |req: &str| {
        h.o.call_tool(
            &p.caller(),
            "complete_run",
            Some(&json!({ "runId": run, "gen": 1, "requestId": req })),
        )
    };
    // runId · gen · requestId 는 필수.
    assert_eq!(
        code(&h.o.call_tool(
            &p.caller(),
            "complete_run",
            Some(&json!({ "runId": run, "requestId": "q" }))
        )),
        "invalid-argument"
    );
    assert_eq!(
        code(&h.o.call_tool(
            &p.caller(),
            "complete_run",
            Some(&json!({ "runId": run, "gen": 1 }))
        )),
        "invalid-argument"
    );
    // 도는 턴 → not-completable(workers-alive) — 아무 일도 없다(같은 requestId 재시도는 새로 시도).
    let task = h.create(&p, &run, 1, "t").unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    h.o.set_task_state(&run, &task, 1, TaskState::Cancelled)
        .unwrap();
    let busy = put_attempt(&h.o, &run, &task, AttemptState::Running);
    let r = call("c1");
    assert_eq!(code(&r), "not-completable");
    assert!(r.unwrap_err().contains("workers-alive"));
    // 일시정지 중이면 조정자는 완료하지 못한다.
    h.o.pause(&run).unwrap();
    assert_eq!(code(&call("c1")), "run-paused");
    h.o.resume(&run).unwrap();
    // 턴이 끝나 idle — 완료가 닫는다.
    h.o.lock()
        .runs
        .get_mut(&run)
        .unwrap()
        .run
        .attempts
        .iter_mut()
        .find(|a| a.id == busy)
        .unwrap()
        .state = AttemptState::Idle;
    // 내보내기 실패를 만든다 — 앱 밖에서 그 이름의 브랜치를 다른 커밋에.
    let other = git(&h.repo, &["commit-tree", "HEAD^{tree}", "-m", "elsewhere"]);
    let branch = super::merge::export_branch_name(&run);
    git(&h.repo, &["branch", &branch, &other]);
    let v = call("c1").unwrap();
    assert_eq!(v["state"], "done");
    assert_eq!(v["export"]["ok"], false, "{v}");
    assert_eq!(v["export"]["reason"], "export-branch-moved");
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!(d["state"], "done");
    let a = d["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == busy.as_str())
        .unwrap()
        .clone();
    assert_eq!(a["state"], "stopped", "남은 idle 은 닫힌다");
    assert!(d["log"]
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["action"] == "run_done" && l["actor"] == "coordinator"));
    // 멱등 — 끝난 뒤의 재시도도 처음 결과(역할 판정이 run-ended 를 말하기 전에).
    assert_eq!(first(&call("c1").unwrap()), first(&v));
    // 새 요청은 run-ended(묶음이 풀렸다).
    assert_eq!(code(&call("c2")), "run-ended");
    // 성공한 내보내기 — 새 Run 에서(새 채팅 — 채팅 하나 = 앨범 하나).
    let p2 = h.producer("complete-2");
    let run2 = h.start(&p2, "s", json!({})).unwrap()["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let v2 =
        h.o.call_tool(
            &p2.caller(),
            "complete_run",
            Some(&json!({ "runId": run2, "gen": 1, "requestId": "k" })),
        )
        .unwrap();
    assert_eq!(v2["export"]["ok"], true, "{v2}");
    assert_eq!(
        v2["export"]["branch"].as_str(),
        Some(super::merge::export_branch_name(&run2).as_str())
    );
}
