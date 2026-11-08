//! 오케스트레이션 4단계 시험 — **보고 · 수락**(설계 B · H 의 4단계 몫 · 동작 계약). 서버 손은 가짜, worktree git 은 가짜 손
//! ([`Probe`])을 꽂는다 — 진짜 git 은 [`git_probe_reads_head_dirty_and_changed`] 하나가 임시 저장소에서 본다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::report::{git_probe, Probe, WorktreeState};
use super::spawn::*;
use super::store::*;
use super::test_album::WRITER;
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Fake {
    jobs: Mutex<Vec<LaunchJob>>,
    stops: Mutex<Vec<String>>,
}

impl WorkerLauncher for Fake {
    fn launch(&self, job: LaunchJob) {
        self.jobs.lock().unwrap().push(job);
    }
    fn stop(&self, _run_id: &str, attempt_id: &str) {
        self.stops.lock().unwrap().push(attempt_id.to_string());
    }
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

/// 가짜 worktree 상태 — 경로마다(없으면 깨끗 · HEAD = `HEAD1`).
type Trees = Arc<Mutex<HashMap<String, WorktreeState>>>;

const BASE: &str = "1111111111111111111111111111111111111111";
const HEAD1: &str = "2222222222222222222222222222222222222222";
const HEAD2: &str = "3333333333333333333333333333333333333333";

struct H {
    o: Arc<Orchestration>,
    fake: Arc<Fake>,
    trees: Trees,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness_in(dir: Option<PathBuf>) -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(dir, emit, Some(tx), Arc::new(move || c.load(Ordering::SeqCst))));
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    super::test_album::delegate_all(&o);
    let trees: Trees = Arc::default();
    let t = Arc::clone(&trees);
    let probe: Probe = Arc::new(move |p: &Path, base: Option<&str>| {
        let key = p.to_string_lossy().into_owned();
        let mut s = t.lock().unwrap().get(&key).cloned().unwrap_or(WorktreeState {
            head: Some(HEAD1.into()),
            dirty: false,
            changed: Vec::new(),
            truncated: false,
            uncommitted: Vec::new(),
            ..Default::default()
        });
        if base.is_none() {
            s.changed.clear();
        }
        Ok(s)
    });
    o.set_probe(probe);
    H {
        o,
        fake,
        trees,
        audit: Mutex::new(rx),
    }
}

fn harness() -> H {
    harness_in(None)
}

fn start(o: &Orchestration) -> String {
    o.start_run(StartRun {
        verify: None,
        name: "report".into(),
        repo: "C:/repo".into(),
        worktree_dir: "C:/repo-wt".into(),
        limits: Limits::default(),
    })
    .unwrap()
    .0
}

fn coordinator(o: &Orchestration, run: &str) -> Caller {
    o.coordinator_caller(run).unwrap()
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

fn task(o: &Orchestration, c: &Caller, req: &str, deps: &[&str]) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": req, "goal": "do it", "dependsOn": deps })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

/// 작업자 하나를 띄워 `starting` 까지 — (attemptId, 작업자 호출자, worktree 경로).
fn worker(h: &H, run: &str, c: &Caller, req: &str, task_id: &str) -> (String, Caller, String) {
    let v = call(&h.o, c, "spawn_worker", json!({ "requestId": req, "taskId": task_id, "role": WRITER })).unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    let token = {
        let jobs = h.fake.jobs.lock().unwrap();
        jobs.iter().find(|j| j.attempt_id == att).unwrap().token.clone()
    };
    let path = format!("C:/repo-wt/{att}");
    let (path_set, branch) = {
        let g = h.o.lock();
        let a = g.runs[run].run.attempts.iter().find(|a| a.id == att).unwrap().clone();
        (a.worktree.clone(), a.branch.clone())
    };
    let path = path_set.unwrap_or(path);
    assert!(h.o.attempt_worktree(run, &att, &path, &branch.unwrap_or_else(|| format!("orch-{req}")), BASE));
    assert_eq!(h.o.attempt_spawned(run, &att, Some(4242)), crate::orchestration::SpawnVerdict::Keep);
    let w = h.o.resolve(Some(&format!("Bearer {token}"))).expect("작업자 토큰");
    (att, w, path)
}

fn report(o: &Orchestration, w: &Caller, req: &str, outcome: &str) -> Result<Value, String> {
    call(o, w, "report_done", json!({ "requestId": req, "outcome": outcome, "summary": "done — tests pass" }))
}

fn task_view(o: &Orchestration, run: &str, id: &str) -> Value {
    let d = o.run_detail(run).unwrap();
    d["tasks"].as_array().unwrap().iter().find(|t| t["id"] == id).unwrap().clone()
}

fn attempt_state(o: &Orchestration, run: &str, att: &str) -> String {
    let d = o.run_detail(run).unwrap();
    d["attempts"].as_array().unwrap().iter().find(|a| a["id"] == att).unwrap()["state"].as_str().unwrap().to_string()
}

fn version(o: &Orchestration, run: &str, id: &str) -> u64 {
    task_view(o, run, id)["version"].as_u64().unwrap()
}

fn accept(o: &Orchestration, c: &Caller, run: &str, req: &str, id: &str) -> Result<Value, String> {
    let v = version(o, run, id);
    call(o, c, "update_task", json!({ "requestId": req, "taskId": id, "version": v, "state": "accepted" }))
}

fn reject(o: &Orchestration, c: &Caller, run: &str, req: &str, id: &str) -> Result<Value, String> {
    let v = version(o, run, id);
    call(o, c, "update_task", json!({ "requestId": req, "taskId": id, "version": v, "state": "rejected" }))
}

fn drain_audit(h: &H) -> Vec<AuditRecord> {
    let rx = h.audit.lock().unwrap();
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

// ---------------------------------------------------------------------------
// report_done
// ---------------------------------------------------------------------------

#[test]
fn report_done_only_current_attempt() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a1, w1, _) = worker(&h, &run, &c, "s1", &t);
    // 사람이 취소 → 다시 열기 → 조정자가 새 작업자(a1 은 아직 살아 있다 — 토큰도).
    h.o.set_task_state(&run, &t, version(&h.o, &run, &t), TaskState::Cancelled).unwrap();
    h.o.set_task_state(&run, &t, version(&h.o, &run, &t), TaskState::Todo).unwrap();
    let (a2, w2, _) = worker(&h, &run, &c, "s2", &t);
    assert_ne!(a1, a2);
    assert_eq!(code(report(&h.o, &w1, "r1", "success")), "stale-attempt", "옛 Attempt 의 보고는 받지 않는다");
    assert!(h.o.run_detail(&run).unwrap()["reports"].as_array().unwrap().is_empty());
    assert_eq!(task_view(&h.o, &run, &t)["state"], "active", "Task 는 그대로");
    // 현재 Attempt 는 된다.
    let v = report(&h.o, &w2, "r2", "success").unwrap();
    assert_eq!(v["taskState"], "reported");
    assert_eq!(v["commitOid"], HEAD1);
    // (3a) 상태는 턴 끝에 — 보고한 턴이 끝나면 reported(닫힘).
    assert_eq!(attempt_state(&h.o, &run, &a2), "running");
    h.o.attempt_process_exited(&run, &a2, true, Some(0));
    assert_eq!(attempt_state(&h.o, &run, &a2), "reported");
    // 조정자는 report_done 을 못 부른다(역할).
    assert!(call(&h.o, &c, "report_done", json!({ "requestId": "x", "outcome": "success", "summary": "s" })).is_err());
}

#[test]
fn report_done_once() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (_, w, _) = worker(&h, &run, &c, "s1", &t);
    report(&h.o, &w, "r1", "failure").unwrap();
    assert_eq!(code(report(&h.o, &w, "r2", "success")), "already-reported");
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!(d["reports"].as_array().unwrap().len(), 1);
    assert_eq!(d["reports"][0]["outcome"], "failure", "처음 보고가 남는다");
}

#[test]
fn report_done_idempotent_request() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (_, w, path) = worker(&h, &run, &c, "s1", &t);
    let first = report(&h.o, &w, "same", "success").unwrap();
    // 그사이 worktree 가 바뀌어도 같은 requestId 는 처음 결과 그대로.
    h.trees.lock().unwrap().insert(
        path,
        WorktreeState {
            head: Some(HEAD2.into()),
            dirty: true,
            ..Default::default()
        },
    );
    let again = report(&h.o, &w, "same", "success").unwrap();
    assert_eq!(first, again);
    assert_eq!(h.o.run_detail(&run).unwrap()["reports"].as_array().unwrap().len(), 1);
    // 조정자의 같은 requestId 와 섞이지 않는다(작업자 것은 Attempt 이름표가 붙는다).
    let v = call(&h.o, &c, "create_task", json!({ "requestId": "same", "title": "x", "goal": "g" })).unwrap();
    assert!(v["task"].is_object(), "조정자의 같은 글자 requestId 는 새 호출: {v}");
}

#[test]
fn late_report_after_stop_keeps_task_state() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a, w, _) = worker(&h, &run, &c, "s1", &t);
    h.o.stop(&run).unwrap();
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopping");
    // 작업자 토큰은 종료 확인까지 산다(사용자 결정 1) — 늦은 보고는 기록만.
    let v = report(&h.o, &w, "r1", "success").unwrap();
    assert_eq!(v["late"], true);
    assert!(v["warning"].is_string());
    assert_eq!(task_view(&h.o, &run, &t)["state"], "active", "Task 상태는 그대로");
    assert_eq!(attempt_state(&h.o, &run, &a), "stopping", "Attempt 상태도 그대로");
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!(d["reports"][0]["late"], true);
    // 늦은 보고는 수락 대상이 아니다(사람도 — reported 가 아니다).
    assert_eq!(
        h.o.human_review(&run, &t, version(&h.o, &run, &t), Decision::Accepted).unwrap_err().code,
        "not-reported"
    );
    // 감사 — 결과 · late · 요약은 길이만.
    let rec = drain_audit(&h).into_iter().find(|r| r.event == "worker_reported").expect("worker_reported");
    let o = rec.orchestration.unwrap();
    assert_eq!(o.late, Some(true));
    assert_eq!(o.outcome.as_deref(), Some("success"));
    assert_eq!(o.summary_len, Some("done — tests pass".chars().count() as u32));
    assert!(!serde_json::to_string(&o).unwrap().contains("tests pass"), "요약 본문은 감사에 없다");
    // 종료가 확인되면 토큰이 거둬져 더는 닿지 않는다.
    h.o.attempt_process_exited(&run, &a, true, None);
    assert_eq!(attempt_state(&h.o, &run, &a), "stopped");
}

/// 인증은 중단 중에 통했는데 그사이 종료가 확인돼 Run 이 `stopped` 가 된 보고(실기에서 본 경합 — 트리 종료가 수십 ms)도 `late` 로 남는다.
#[test]
fn report_in_flight_when_run_becomes_stopped_is_late() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a, w, _) = worker(&h, &run, &c, "s1", &t);
    h.o.stop(&run).unwrap();
    h.o.attempt_process_exited(&run, &a, true, None);
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
    let v = report(&h.o, &w, "r1", "success").unwrap();
    assert_eq!(v["late"], true);
    assert_eq!(task_view(&h.o, &run, &t)["state"], "active");
}

// ---------------------------------------------------------------------------
// 수락 · 반려
// ---------------------------------------------------------------------------

#[test]
fn dirty_report_cannot_be_accepted() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (_, w, path) = worker(&h, &run, &c, "s1", &t);
    h.trees.lock().unwrap().insert(
        path,
        WorktreeState {
            head: Some(HEAD1.into()),
            dirty: true,
            ..Default::default()
        },
    );
    let v = report(&h.o, &w, "r1", "success").unwrap();
    assert_eq!(v["dirty"], true);
    assert!(v["warning"].as_str().unwrap().contains("uncommitted"));
    assert_eq!(code(accept(&h.o, &c, &run, "acc", &t)), "dirty-report");
    assert_eq!(
        h.o.human_review(&run, &t, version(&h.o, &run, &t), Decision::Accepted).unwrap_err().code,
        "dirty-report",
        "사람도 못 한다"
    );
    assert!(h.o.run_detail(&run).unwrap()["accepted"].as_array().unwrap().is_empty());
    // 반려는 된다.
    let r = reject(&h.o, &c, &run, "rej", &t).unwrap();
    assert_eq!(r["task"]["state"], "rejected");
}

#[test]
fn failure_report_cannot_be_accepted() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t0", &[]);
    let (_, w, _) = worker(&h, &run, &c, "s0", &t);
    report(&h.o, &w, "r", "failure").unwrap();
    assert_eq!(task_view(&h.o, &run, &t)["state"], "reported");
    assert_eq!(code(accept(&h.o, &c, &run, "a0", &t)), "not-success");
    reject(&h.o, &c, &run, "j0", &t).unwrap();
    // (3a · 4-6 · D7) `blocked` 는 보고가 아니다 — Task 는 그대로(active) · 보고 없음 · 수락할 것도 없다.
    let t = task(&h.o, &c, "t1", &[]);
    let (a, w, _) = worker(&h, &run, &c, "s1", &t);
    let v = call(&h.o, &w, "report_done", json!({ "requestId": "b", "outcome": "blocked", "summary": "need network", "notes": "npm install" }))
        .unwrap();
    assert_eq!(v["blocked"], true, "{v}");
    assert_eq!(task_view(&h.o, &run, &t)["state"], "active");
    assert!(h.o.run_detail(&run).unwrap()["reports"].as_array().unwrap().iter().all(|r| r["attemptId"] != a.as_str()));
    assert_eq!(code(accept(&h.o, &c, &run, "a1", &t)), "not-reported");
}

#[test]
fn accepted_artifact_is_immutable() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a, w, _) = worker(&h, &run, &c, "s1", &t);
    report(&h.o, &w, "r1", "success").unwrap();
    let v = accept(&h.o, &c, &run, "acc", &t).unwrap();
    let art = v["accepted"].clone();
    assert_eq!(art["commitOid"], HEAD1);
    assert_eq!(art["baseCommitOid"], BASE);
    assert_eq!(art["attemptId"], a.as_str());
    assert_eq!(art["reviewer"], "coordinator");
    assert!(art["verification"].is_null(), "검증 칸은 자리만");
    // 다시 수락 — 조정자는 reported 만(이미 accepted).
    assert_eq!(code(accept(&h.o, &c, &run, "acc2", &t)), "not-reported");
    // 사람의 뒤집기(반려) — 옛 기록은 남고 revokedAt 만 한 번 채운다.
    h.trees.lock().unwrap().clear();
    h.o.human_review(&run, &t, version(&h.o, &run, &t), Decision::Rejected).unwrap();
    let d = h.o.run_detail(&run).unwrap();
    let list = d["accepted"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    let kept = &list[0];
    for k in ["taskId", "attemptId", "reportId", "commitOid", "baseCommitOid", "reviewer", "acceptedAt"] {
        assert_eq!(kept[k], art[k], "{k} 는 바뀌지 않는다");
    }
    assert!(kept["revokedAt"].is_u64());
    assert_eq!(kept["revokedBy"], "human");
    // 다시 뒤집기(수락) — 새 기록이 더해진다.
    let again = h.o.human_review(&run, &t, version(&h.o, &run, &t), Decision::Accepted).unwrap();
    assert_eq!(again["flipped"], true);
    let d = h.o.run_detail(&run).unwrap();
    let list = d["accepted"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["revokedBy"], "human", "옛 것은 그대로 거둔 채");
    assert!(list[1]["revokedAt"].is_null());
    assert_eq!(list[1]["reviewer"], "human");
    // 검토 기록은 판정마다 한 줄.
    let reviews = d["reviews"].as_array().unwrap();
    assert_eq!(reviews.len(), 3);
    assert_eq!(
        reviews.iter().map(|r| (r["decision"].as_str().unwrap(), r["flipped"].as_bool().unwrap())).collect::<Vec<_>>(),
        vec![("accepted", false), ("rejected", true), ("accepted", true)]
    );
    // 감사 — task_accepted · task_rejected(검토자).
    let evs: Vec<(String, Option<String>)> = drain_audit(&h)
        .into_iter()
        .filter(|r| r.event.starts_with("task_accepted") || r.event.starts_with("task_rejected"))
        .map(|r| (r.event.clone(), r.orchestration.and_then(|o| o.reviewer)))
        .collect();
    assert_eq!(
        evs,
        vec![
            ("task_accepted".to_string(), Some("coordinator".to_string())),
            ("task_rejected".to_string(), Some("human".to_string())),
            ("task_accepted".to_string(), Some("human".to_string())),
        ]
    );
}

#[test]
fn reject_then_new_attempt() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a1, w1, _) = worker(&h, &run, &c, "s1", &t);
    report(&h.o, &w1, "r1", "success").unwrap();
    reject(&h.o, &c, &run, "rej", &t).unwrap();
    // 재작업은 새 Attempt — 반려된 Task 는 새 작업자를 받는다(앞 작업자가 아직 살아 있어도).
    let (a2, w2, _) = worker(&h, &run, &c, "s2", &t);
    assert_ne!(a1, a2);
    let tv = task_view(&h.o, &run, &t);
    assert_eq!(tv["state"], "active");
    assert_eq!(tv["currentAttempt"], a2.as_str());
    // 옛 Attempt 의 보고는 다시 오지 않고(이미 보고 · 이제 오래됨), 새 Attempt 가 보고한다.
    assert_eq!(code(report(&h.o, &w1, "r9", "success")), "stale-attempt");
    report(&h.o, &w2, "r2", "success").unwrap();
    let v = accept(&h.o, &c, &run, "acc", &t).unwrap();
    assert_eq!(v["accepted"]["attemptId"], a2.as_str());
}

#[test]
fn reuse_worktree_only_when_clean_and_finished() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let other = task(&h.o, &c, "o", &[]);
    let (a1, w1, path) = worker(&h, &run, &c, "s1", &t);
    report(&h.o, &w1, "r1", "success").unwrap();
    reject(&h.o, &c, &run, "rej", &t).unwrap();
    let spawn = |req: &str, task_id: &str, of: &str| {
        call(&h.o, &c, "spawn_worker", json!({ "requestId": req, "taskId": task_id, "role": WRITER, "reuseWorktreeOf": of }))
    };
    // 앞 작업자가 아직 살아 있다 → worktree-in-use.
    assert_eq!(code(spawn("x1", &t, &a1)), "worktree-in-use");
    // 끝났지만 미커밋 변경 → worktree-dirty.
    h.o.human_stop_worker(&run, &a1).unwrap();
    h.o.attempt_process_exited(&run, &a1, true, None);
    assert_eq!(attempt_state(&h.o, &run, &a1), "stopped");
    h.trees.lock().unwrap().insert(
        path.clone(),
        WorktreeState {
            head: Some(HEAD1.into()),
            dirty: true,
            ..Default::default()
        },
    );
    assert_eq!(code(spawn("x2", &t, &a1)), "worktree-dirty");
    // 다른 Task 의 Attempt 는 이어 쓸 수 없다.
    h.trees.lock().unwrap().clear();
    assert_eq!(code(spawn("x3", &other, &a1)), "invalid-argument");
    // 깨끗하고 끝났으면 — 같은 자리 · 같은 브랜치 · 처음 기준, worktree 를 새로 만들지 않는다.
    let v = spawn("x4", &t, &a1).unwrap();
    assert_eq!(v["reusedWorktree"], path.as_str());
    let a2 = v["attemptId"].as_str().unwrap().to_string();
    let jobs = h.fake.jobs.lock().unwrap();
    let job = jobs.iter().find(|j| j.attempt_id == a2).unwrap();
    let r = job.reuse.as_ref().expect("이어 쓰기");
    assert_eq!((r.path.as_str(), r.base_commit.as_str()), (path.as_str(), BASE));
    drop(jobs);
    let shown = h.o.run_detail(&run).unwrap();
    let a2v = shown["attempts"].as_array().unwrap().iter().find(|x| x["id"] == a2.as_str()).unwrap().clone();
    assert_eq!(a2v["worktree"], path.as_str(), "새 Attempt 는 처음부터 그 자리를 적는다");
    assert_eq!(a2v["baseCommit"], BASE);
    // 새 Attempt 가 쓰는 중 — 같은 Task 에 또 띄우지 못한다.
    assert_eq!(code(spawn("x5", &t, &a1)), "task-busy");
}

// ---------------------------------------------------------------------------
// 의존 Task 의 기준
// ---------------------------------------------------------------------------

#[test]
fn dependent_spawn_branches_from_accepted_commit() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let a = task(&h.o, &c, "a", &[]);
    let b = task(&h.o, &c, "b", &[&a]);
    // 선행이 아직 → 거절.
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "b0", "taskId": b, "role": WRITER }))),
        "dependency-not-accepted"
    );
    let (_, w, _) = worker(&h, &run, &c, "sa", &a);
    report(&h.o, &w, "r", "success").unwrap();
    accept(&h.o, &c, &run, "acc", &a).unwrap();
    // base 를 main 으로 줘도 의존이 이긴다 — 수락 커밋에서.
    let v = call(&h.o, &c, "spawn_worker", json!({ "requestId": "b1", "taskId": b, "role": WRITER, "base": "main" })).unwrap();
    assert_eq!(v["base"], HEAD1);
    let att = v["attemptId"].as_str().unwrap().to_string();
    assert_eq!(h.fake.jobs.lock().unwrap().iter().find(|j| j.attempt_id == att).unwrap().base, Base::Commit(HEAD1.into()));
    // 수락을 사람이 뒤집으면(거둠) 그 선행은 더 이상 수락이 아니다 → 새 의존 작업자는 거절.
    h.o.human_review(&run, &a, version(&h.o, &run, &a), Decision::Rejected).unwrap();
    let c2 = task(&h.o, &c, "c2", &[&a]);
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "c1", "taskId": c2, "role": WRITER }))),
        "dependency-not-accepted"
    );
}

#[test]
fn multiple_dependencies_need_merge() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let a = task(&h.o, &c, "a", &[]);
    let b = task(&h.o, &c, "b", &[]);
    for (t, r) in [(&a, "ra"), (&b, "rb")] {
        let (_, w, _) = worker(&h, &run, &c, &format!("s{r}"), t);
        report(&h.o, &w, r, "success").unwrap();
        accept(&h.o, &c, &run, &format!("acc{r}"), t).unwrap();
    }
    let x = task(&h.o, &c, "x", &[&a, &b]);
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "x1", "taskId": x, "role": WRITER }))),
        "needs-merge"
    );
    // 선행 하나를 고르는 것도 의존이 이긴다(나머지 결과가 빠진다) → needs-merge.
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "x2", "taskId": x, "role": WRITER, "base": a }))),
        "needs-merge"
    );
    // 사람이 병합한 뒤 — 조정자가 main 을 명시하면 main 에서.
    let v = call(&h.o, &c, "spawn_worker", json!({ "requestId": "x3", "taskId": x, "role": WRITER, "base": "main" })).unwrap();
    assert_eq!(v["base"], "main");
}

// ---------------------------------------------------------------------------
// 영속 · 미리 허용 · 보고 뒤 변경
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-orch4-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn cleanup(dir: &Path) {
    let _ = super::worktree::unlink_links(dir, &[]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn report_and_artifact_persist_roundtrip() {
    let dir = scratch("persist");
    let (run, before) = {
        let h = harness_in(Some(dir.clone()));
        let run = start(&h.o);
        let c = coordinator(&h.o, &run);
        let t = task(&h.o, &c, "t", &[]);
        let (_, w, _) = worker(&h, &run, &c, "s1", &t);
        call(&h.o, &w, "report_done", json!({ "requestId": "r", "outcome": "success", "summary": "요약", "notes": "메모" })).unwrap();
        accept(&h.o, &c, &run, "acc", &t).unwrap();
        let d = h.o.run_detail(&run).unwrap();
        (run, (d["reports"].clone(), d["accepted"].clone(), d["reviews"].clone()))
    };
    let text = std::fs::read_to_string(dir.join(format!("{run}.json"))).unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["run"]["reports"][0]["summary"], "요약");
    assert_eq!(v["run"]["reports"][0]["notes"], "메모");
    assert_eq!(v["run"]["accepted"][0]["reviewer"], "coordinator");
    // 다시 뜬 서버 — orphaned 로 읽혀도 보고 · 수락 · 검토 기록은 그대로.
    let h2 = harness_in(Some(dir.clone()));
    let d = h2.o.run_detail(&run).unwrap();
    assert_eq!(d["state"], "orphaned");
    assert_eq!((d["reports"].clone(), d["accepted"].clone(), d["reviews"].clone()), before);
    // 파일에 토큰 칸은 없다.
    assert!(!text.to_ascii_lowercase().contains("token"));
    drop(h2);
    cleanup(&dir);
}

#[test]
fn worker_preallow_includes_report_done() {
    assert!(WORKER_ALLOWED_TOOLS.contains(&"report_done"));
    assert!(super::tools::WORKER_TOOLS.contains(&"report_done"));
    let names: Vec<String> = super::worker_tool_schemas()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, vec!["get_task".to_string(), "report_done".to_string(), "commit_changes".to_string()]);
    let base = |cli| super::turn::TurnArgs {
        cli,
        exe: "C:/bin/cli.exe",
        grade: super::turn::Grade::Edit,
        resume: None,
        session_id: (cli == WorkerCli::Claude).then_some("11111111-2222-4333-8444-555555555555"),
        mcp_name: "aynx-sessions-dev",
        mcp_tools: WORKER_ALLOWED_TOOLS,
        mcp_config: (cli == WorkerCli::Claude).then_some("C:/data/agent-mcp/orch-att-x-t1.json"),
        mcp_url: "http://127.0.0.1:5/mcp",
        token_env: "AYNX_DEV_MCP_TOKEN",
        allowed_commands: &[],
        read_rule: None,
        add_dir: None,
        cwd: Some("C:/wt"),
        codex_extra: &[],
        model_args: &[],
        append_file: None,
        developer_instructions: None,
        prompt: "[x]",
    };
    let claude = super::turn::turn_argv(&base(WorkerCli::Claude));
    let i = claude.iter().position(|a| a == "--allowedTools").unwrap();
    assert!(claude[i + 1..].contains(&"mcp__aynx-sessions-dev__report_done".to_string()));
    assert!(claude.iter().position(|a| a == "mcp__aynx-sessions-dev__report_done").unwrap() < claude.iter().position(|a| a == "--").unwrap());
    let codex = super::turn::turn_argv(&base(WorkerCli::Codex));
    assert!(codex.contains(&"mcp_servers.aynx-sessions-dev.tools.report_done.approval_mode='approve'".to_string()));
}

#[test]
fn report_drift_flags_changes_after_report() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t", &[]);
    let (a, w, path) = worker(&h, &run, &c, "s1", &t);
    report(&h.o, &w, "r", "success").unwrap();
    let d = h.o.report_drift(&run).unwrap();
    assert_eq!(d[0]["attemptId"], a.as_str());
    assert_eq!(d[0]["changedSinceReport"], false);
    h.trees.lock().unwrap().insert(
        path,
        WorktreeState {
            head: Some(HEAD2.into()),
            dirty: false,
            ..Default::default()
        },
    );
    let d = h.o.report_drift(&run).unwrap();
    assert_eq!(d[0]["changedSinceReport"], true);
    // 수락 대상은 여전히 보고 커밋.
    let v = accept(&h.o, &c, &run, "acc", &t).unwrap();
    assert_eq!(v["accepted"]["commitOid"], HEAD1);
}

// ---------------------------------------------------------------------------
// 진짜 git
// ---------------------------------------------------------------------------

fn git(dir: &Path, args: &[&str]) -> crate::worktree::GitRun {
    let mut full = vec!["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
    full.extend_from_slice(args);
    crate::worktree::run_git(dir, &full, crate::worktree::GIT_TIMEOUT).unwrap()
}

#[test]
fn git_probe_reads_head_dirty_and_changed() {
    let root = scratch("probe");
    let r = root.join("repo");
    std::fs::create_dir_all(&r).unwrap();
    assert!(git(&r, &["init", "-q", "-b", "main"]).ok);
    std::fs::write(r.join("a.txt"), "a").unwrap();
    assert!(git(&r, &["add", "."]).ok);
    assert!(git(&r, &["commit", "-q", "-m", "init"]).ok);
    let base = git(&r, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    let s = git_probe(&r, Some(&base)).unwrap();
    assert_eq!(s.head.as_deref(), Some(base.as_str()));
    assert!(!s.dirty && s.changed.is_empty());
    std::fs::write(r.join("b.txt"), "b").unwrap();
    assert!(git_probe(&r, None).unwrap().dirty, "추적 안 된 새 파일도 미커밋");
    assert!(git(&r, &["add", "."]).ok);
    assert!(git(&r, &["commit", "-q", "-m", "b"]).ok);
    let s = git_probe(&r, Some(&base)).unwrap();
    assert!(!s.dirty);
    assert_ne!(s.head.as_deref(), Some(base.as_str()));
    assert_eq!(s.changed, vec!["b.txt".to_string()]);
    assert!(git_probe(&root.join("missing"), None).is_err());
    cleanup(&root);
}

/// 작업자 상세의 작업 중 파일(오케스트레이션 탭 ③) — 기준 이후 커밋 + 미커밋 + 새 파일의 상태 · +/− · 미커밋 표지 · 바이너리.
#[test]
fn wip_lists_committed_uncommitted_and_new_files_with_counts() {
    use super::diff::{parse_porcelain_z, text_lines, wip_value};
    let root = scratch("wip");
    let r = root.join("repo");
    std::fs::create_dir_all(&r).unwrap();
    assert!(git(&r, &["init", "-q", "-b", "main"]).ok);
    std::fs::write(r.join("a.txt"), "1\n2\n3\n").unwrap();
    std::fs::write(r.join("gone.txt"), "x\n").unwrap();
    assert!(git(&r, &["add", "."]).ok);
    assert!(git(&r, &["commit", "-q", "-m", "init"]).ok);
    let base = git(&r, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    // 커밋된 변경 하나 · 미커밋 변경 · 지운 파일 · 새 파일(글 · 바이너리).
    std::fs::write(r.join("c.txt"), "c\n").unwrap();
    assert!(git(&r, &["add", "."]).ok);
    assert!(git(&r, &["commit", "-q", "-m", "c"]).ok);
    std::fs::write(r.join("a.txt"), "1\nTWO\n3\n4\n").unwrap();
    std::fs::remove_file(r.join("gone.txt")).unwrap();
    std::fs::create_dir_all(r.join("new")).unwrap();
    std::fs::write(r.join("new/n.rs"), "fn a() {}\nfn b() {}").unwrap();
    std::fs::write(r.join("new/bin.dat"), [0u8, 1, 2]).unwrap();
    let v = wip_value(Some(&r.to_string_lossy()), Some(&base));
    assert!(v.get("error").is_none(), "{v}");
    let files = v["files"].as_array().unwrap();
    let get = |p: &str| files.iter().find(|f| f["path"] == p).cloned().unwrap_or_else(|| panic!("{p} 없음: {v}"));
    let a = get("a.txt");
    assert_eq!((a["status"].as_str(), a["adds"].as_u64(), a["dels"].as_u64(), a["uncommitted"].as_bool()), (Some("modified"), Some(2), Some(1), Some(true)));
    let c = get("c.txt");
    assert_eq!((c["status"].as_str(), c["adds"].as_u64(), c["uncommitted"].as_bool()), (Some("added"), Some(1), Some(false)), "커밋된 것은 미커밋 아님");
    assert_eq!(get("gone.txt")["status"], "deleted");
    let n = get("new/n.rs");
    assert_eq!((n["untracked"].as_bool(), n["adds"].as_u64(), n["binary"].as_bool()), (Some(true), Some(2), Some(false)), "끝 줄바꿈 없어도 두 줄");
    let b = get("new/bin.dat");
    assert_eq!((b["binary"].as_bool(), b["adds"].is_null()), (Some(true), true));
    assert_eq!((v["fileCount"].as_u64(), v["truncated"].as_bool(), v["base"].as_str()), (Some(5), Some(false), Some(base.as_str())));
    // 기준이 없으면 HEAD 와 — 커밋된 c.txt 는 빠진다.
    let v = wip_value(Some(&r.to_string_lossy()), None);
    assert!(v["files"].as_array().unwrap().iter().all(|f| f["path"] != "c.txt"), "{v}");
    // 없는 폴더 · worktree 없음은 오류 한 줄.
    assert!(wip_value(Some(&root.join("missing").to_string_lossy()), None)["error"].is_string());
    assert!(wip_value(None, None)["error"].is_string());
    // 순수 조각.
    assert_eq!(parse_porcelain_z(" M a\0R  new\0old\0?? x\0"), vec![(" M".to_string(), "a".to_string()), ("R ".to_string(), "new".to_string()), ("??".to_string(), "x".to_string())]);
    assert_eq!((text_lines(b""), text_lines(b"a\nb\n"), text_lines(b"a\nb"), text_lines(b"a\0")), (Some(0), Some(2), Some(2), None));
    cleanup(&root);
}
