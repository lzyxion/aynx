//! 통합 설계 2단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 8 · 10절) — **영속 v2**(판 {1,2} · 그 밖 거절),
//! **영속 의도**(올리기 전 저장 확인 · 저장 실패면 CAS 없음 + 보류), **취소 ↔ 커밋 직렬화**, **중단은 커밋 중인 Job 을 기다림**,
//! **재시작 복구**(CAS 직전 · 직후 죽음 — 완료 증거 ref 로 판정), **보류**, **Run 완료**(사람만 → done).
//!
//! 실제 통합 git(`merge-tree`)은 3단계 — 여기서는 후보를 시험이 적고([`Orchestration::set_candidate`]) 올리기의 ref 쪽은 가짜 손
//! ([`FakeGit`] — 메모리 ref 표)이 흉내 낸다. 진짜 `update-ref --stdin` 트랜잭션(`GitRefs`)은 임시 저장소에서 따로 잰다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::integrate::*;
use super::model::*;
use super::persist;
use super::store::*;
use crate::audit::AuditRecord;

const OLD: &str = "1111111111111111111111111111111111111111";
const CAND: &str = "2222222222222222222222222222222222222222";
const REP: &str = "3333333333333333333333333333333333333333";
const BASE: &str = "4444444444444444444444444444444444444444";
const HUMAN: &str = "5555555555555555555555555555555555555555";

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

struct H {
    o: Orchestration,
    _audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness(dir: Option<PathBuf>) -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let (tx, rx) = mpsc::channel();
    let o = Orchestration::with_clock(dir, emit, Some(tx), Arc::new(move || clock.fetch_add(1, Ordering::SeqCst)));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    H { o, _audit: Mutex::new(rx) }
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage2-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 통합 ref 를 메모리 표로 흉내 내는 손 — 트랜잭션은 CAS(통합 ref = old) · `create` 는 없을 때만, 전부 서거나 전부 안 선다.
#[derive(Default)]
struct FakeGit {
    refs: Mutex<HashMap<String, String>>,
    applies: AtomicU64,
    /// 트랜잭션 직전에 통합 ref 를 이 OID 로 옮긴다(사람의 외부 변경 흉내).
    move_before: Mutex<Option<String>>,
    /// 트랜잭션은 서는데 결과를 모른다고 답한다(시한 흉내).
    unknown_result: AtomicBool,
    /// 완료 증거 ref(`done/`)를 읽지 못한다(리뷰 F7 — 증거 조회 실패 흉내).
    done_read_fail: AtomicBool,
}

impl FakeGit {
    fn get(&self, name: &str) -> Option<String> {
        self.refs.lock().unwrap().get(name).cloned()
    }
    fn set(&self, name: &str, oid: &str) {
        self.refs.lock().unwrap().insert(name.into(), oid.into());
    }
}

impl IntegrationGit for FakeGit {
    fn apply(&self, _repo: &Path, tx: &RefTx) -> Result<TxOutcome, String> {
        tx.script()?;
        self.applies.fetch_add(1, Ordering::SeqCst);
        let mut r = self.refs.lock().unwrap();
        if let Some(m) = self.move_before.lock().unwrap().take() {
            r.insert(tx.work_ref.clone(), m);
        }
        let cas_ok = r.get(&tx.work_ref) == Some(&tx.old);
        let done_free = !r.contains_key(&tx.done_ref);
        let preserve_ok = r.get(&tx.preserve_ref) == tx.preserve_old.as_ref();
        if !(cas_ok && done_free && preserve_ok) {
            return Ok(TxOutcome::Refused("fatal: prepare: cannot lock ref".into()));
        }
        r.insert(tx.work_ref.clone(), tx.new.clone());
        r.insert(tx.done_ref.clone(), tx.new.clone());
        r.insert(tx.preserve_ref.clone(), tx.report_commit.clone());
        if self.unknown_result.load(Ordering::SeqCst) {
            return Err("git did not finish in time".into());
        }
        Ok(TxOutcome::Committed)
    }
    fn read_ref(&self, _repo: &Path, name: &str) -> Result<Option<String>, String> {
        if name.contains("/done/") && self.done_read_fail.load(Ordering::SeqCst) {
            return Err("could not read the evidence ref".into());
        }
        Ok(self.get(name))
    }
    fn is_ancestor(&self, _repo: &Path, a: &str, b: &str) -> Result<bool, String> {
        Ok(a == b)
    }
}

fn start(o: &Orchestration) -> (String, Caller) {
    super::test_album::delegate_all(o);
    let run = o
        .start_run(StartRun {
            verify: None,
            name: "stage2".into(),
            repo: "C:/repo".into(),
            worktree_dir: "C:/repo-wt".into(),
            limits: Limits::default(),
        })
        .unwrap()
        .0;
    let c = o.coordinator_caller(&run).unwrap();
    (run, c)
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn code<T: std::fmt::Debug>(r: Result<T, OrchError>) -> &'static str {
    r.expect_err("거절이어야 한다").code
}

fn create_task(o: &Orchestration, c: &Caller, req: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": "T", "goal": "g" })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

/// Task 하나를 "끝난 작업자가 성공 보고함" 으로 둔다(보고 커밋 `REP` · 기준 `BASE`). 작업자는 이미 끝났다(`exited`).
fn reported(o: &Orchestration, run: &str, task: &str) {
    let att = new_id("att").unwrap();
    let mut g = o.lock();
    let slot = g.runs.get_mut(run).unwrap();
    let gen = slot.run.gen;
    slot.run.attempts.push(Attempt {
        id: att.clone(),
        task_id: task.into(),
        cli: WorkerCli::Claude,
        gen,
        state: AttemptState::Exited,
        stream: None,
        worktree: None,
        branch: None,
        base_commit: Some(BASE.into()),
        pid: None,
        conversation_id: None,
        launch_args: None,
        attention: None,
        started_at: 0,
        ended_at: Some(0),
        exit_reason: None,
        pending_recovery: None,
        conversation_changed: false,
        kind: None,
        role_id: None,
        role_name: None,
        blocked: None,
        conversation_broken: false,
        stop_requested: false,
        last_commit_rejection: None,
        resolves: None,
        role: AttemptRole::Worker,
        review_of: None,
        turns: Vec::new(),
    });
    slot.run.reports.push(Report {
        report_id: new_id("rep").unwrap(),
        attempt_id: att.clone(),
        task_id: task.into(),
        outcome: ReportOutcome::Success,
        summary: "done".into(),
        notes: None,
        commit_oid: Some(REP.into()),
        base_commit_oid: Some(BASE.into()),
        dirty: false,
        changed_files: vec!["a.txt".into()],
        changed_files_truncated: false,
        git_error: None,
        no_changes: false,
        mismatch: None,
        at: 0,
        late: false,
        resolved: vec![],
    });
    let t = slot.run.tasks.iter_mut().find(|t| t.id == task).unwrap();
    t.state = TaskState::Reported;
    t.version += 1;
    t.current_attempt = Some(att);
}

/// 통합 ref 가 있는 Run(3단계의 시작 op 대신 시험이 칸을 채운다) + 보고된 Task 하나. 가짜 손의 통합 ref = `OLD`.
fn v2_run(o: &Orchestration, git: &Arc<FakeGit>) -> (String, Caller, String) {
    o.set_integrator(git.clone());
    let (run, c) = start(o);
    {
        let mut g = o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.integration = Some(Integration {
            work_ref: refs::int(&run),
            export_branch: "orch-test-int".into(),
            base_commit: OLD.into(),
            base_branch: None,
            expected_head: OLD.into(),
            exported_head: None,
            work_ref_removed: false,
        });
    }
    git.set(&refs::int(&run), OLD);
    let task = create_task(o, &c, "t1");
    reported(o, &run, &task);
    (run, c, task)
}

fn task_of(o: &Orchestration, run: &str, task: &str) -> Task {
    o.lock().runs.get(run).unwrap().run.task(task).unwrap().clone()
}

fn run_of(o: &Orchestration, run: &str) -> Run {
    o.lock().runs.get(run).unwrap().run.clone()
}

/// 수락 요청 → 후보 기록(3단계 `merge-tree` 자리) — Job id.
fn job_with_candidate(o: &Orchestration, run: &str, task: &str, req: &str) -> String {
    let v = task_of(o, run, task).version;
    let r = o.begin_integration(run, task, v, Reviewer::Coordinator, req).unwrap();
    let job = r["jobId"].as_str().unwrap().to_string();
    o.set_candidate(run, &job, OLD, CAND, None).unwrap();
    job
}

fn job(o: &Orchestration, run: &str, id: &str) -> IntegrationJob {
    run_of(o, run).jobs.into_iter().find(|j| j.job_id == id).unwrap()
}

fn hook(o: &Orchestration, f: impl Fn(&Orchestration, IntegrateStep) -> bool + Send + Sync + 'static) {
    *o.integrate_hook.lock().unwrap() = Some(Arc::new(f));
}

fn disk_run(dir: &Path, run: &str) -> Run {
    persist::decode(&std::fs::read(dir.join(format!("{run}.json"))).unwrap()).unwrap()
}

// ---------------------------------------------------------------------------
// 영속 판
// ---------------------------------------------------------------------------

/// 판 4의 선택 칸 생략 — 통합 없는 맡기기 Run도 공존 기간에 그대로 읽는다.
#[test]
fn v4_run_file_loads_with_defaults() {
    let dir = scratch("v1");
    let (run, task) = {
        let h = harness(Some(dir.clone()));
        let (run, c) = start(&h.o);
        let task = create_task(&h.o, &c, "t1");
        h.o.flush_saves();
        (run, task)
    };
    let path = dir.join(format!("{run}.json"));
    let mut v: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(v["version"], 4, "새로 쓰는 판은 4");
    let body = v["run"].as_object_mut().unwrap();
    for k in ["integration", "hold", "jobs"] {
        body.remove(k);
    }
    std::fs::write(&path, serde_json::to_vec(&v).unwrap()).unwrap();
    let back = persist::decode(&std::fs::read(&path).unwrap()).unwrap();
    assert!(back.integration.is_none() && back.hold.is_none() && back.jobs.is_empty());
    assert_eq!(persist::encode(&back).map(|b| serde_json::from_slice::<Value>(&b).unwrap()["version"].clone()).unwrap(), 4);
    let h = harness(Some(dir.clone()));
    let snap = h.o.snapshot();
    assert_eq!(snap.as_array().unwrap().len(), 1, "v4 Run 이 올라온다");
    assert_eq!(snap[0]["state"], "orphaned");
    let r = run_of(&h.o, &run);
    assert_eq!(r.task(&task).map(|t| t.state), Some(TaskState::Todo));
    assert!(r.integration.is_none(), "통합 없음 = 1차 동작");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 판 4 밖은 거절하고 그 파일만 건너뛴다.
#[test]
fn unknown_file_version_refused() {
    let dir = scratch("ver");
    let run = {
        let h = harness(Some(dir.clone()));
        let (run, _) = start(&h.o);
        h.o.flush_saves();
        run
    };
    let path = dir.join(format!("{run}.json"));
    let good: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for bad in [0, 1, 2, 3, 5] {
        let mut v = good.clone();
        v["version"] = json!(bad);
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(persist::decode(&bytes).unwrap_err().contains(&format!("version {bad}")));
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(harness(Some(dir.clone())).o.snapshot(), json!([]), "판 {bad} 파일은 건너뛴다");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// 관문 · 멱등
// ---------------------------------------------------------------------------

/// 4-3 ① · 2-4 — 1차 Run 은 통합 작업을 만들지 않는다 · 같은 requestId 는 같은 Job · Run 당 Job 하나 · 통합 중 Task 쓰기는 `task-busy`.
#[test]
fn same_request_id_same_job_and_one_job_per_run() {
    let h = harness(None);
    // 통합 ref 없는 Run(1차) — 비동기 수락 길이 없다.
    let (r1, c1) = start(&h.o);
    let t1 = create_task(&h.o, &c1, "t1");
    reported(&h.o, &r1, &t1);
    let v = task_of(&h.o, &r1, &t1).version;
    assert_eq!(code(h.o.begin_integration(&r1, &t1, v, Reviewer::Coordinator, "a1")), "invalid-state");
    h.o.stop(&r1).unwrap();

    let git = Arc::new(FakeGit::default());
    let (run, c, task) = v2_run(&h.o, &git);
    let v = task_of(&h.o, &run, &task).version;
    let first = h.o.begin_integration(&run, &task, v, Reviewer::Coordinator, "acc-1").unwrap();
    assert_eq!(first["accepting"], true);
    assert_eq!(first["task"]["state"], "integrating");
    let id = first["jobId"].as_str().unwrap().to_string();
    assert_eq!(job(&h.o, &run, &id).phase, JobPhase::Prepared);
    // 같은 requestId — 같은 Job(버전이 옛것이어도 새로 만들지 않는다).
    let again = h.o.begin_integration(&run, &task, v, Reviewer::Coordinator, "acc-1").unwrap();
    assert_eq!(again["jobId"], id.as_str());
    assert_eq!(run_of(&h.o, &run).jobs.len(), 1);
    // 다른 requestId — Run 당 하나.
    let v2 = task_of(&h.o, &run, &task).version;
    assert_eq!(code(h.o.begin_integration(&run, &task, v2, Reviewer::Human, "acc-2")), "integration-busy");
    // 통합 중인 Task — 조정자 · 사람 모두 취소 · 판정 못 함.
    let busy = call(&h.o, &c, "update_task", json!({ "requestId": "u1", "taskId": task, "version": v2, "state": "cancelled" }));
    assert!(busy.unwrap_err().starts_with("task-busy"));
    assert_eq!(code(h.o.set_task_state(&run, &task, v2, TaskState::Cancelled)), "task-busy");
    assert_eq!(code(h.o.human_review(&run, &task, v2, Decision::Rejected)), "task-busy");
    // 기록은 영속 칸에 있다(토큰 · 본문 없음).
    assert_eq!(h.o.run_detail(&run).unwrap()["jobs"][0]["phase"], "prepared");
}

// ---------------------------------------------------------------------------
// 영속 의도 · 저장 실패
// ---------------------------------------------------------------------------

/// R3 · 4-3 ⑥ — CAS 직전에 디스크에는 이미 `committing` 의도가 있다. 올리기 뒤 수락 산출물 · 기대 머리 · 증거 ref.
#[test]
fn intent_persisted_before_cas() {
    let dir = scratch("intent");
    let h = harness(Some(dir.clone()));
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    let seen = Arc::new(Mutex::new(None::<JobPhase>));
    {
        let (seen, dir, run, id, git) = (seen.clone(), dir.clone(), run.clone(), id.clone(), git.clone());
        hook(&h.o, move |_, step| {
            if step == IntegrateStep::BeforeCas {
                assert_eq!(git.applies.load(Ordering::SeqCst), 0, "CAS 전");
                let disk = disk_run(&dir, &run);
                *seen.lock().unwrap() = disk.jobs.iter().find(|j| j.job_id == id).map(|j| j.phase);
            }
            false
        });
    }
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Integrated);
    assert_eq!(*seen.lock().unwrap(), Some(JobPhase::Committing), "의도가 CAS 전에 디스크에 있다");
    let r = run_of(&h.o, &run);
    assert_eq!(r.task(&task).unwrap().state, TaskState::Accepted);
    let a = r.valid_artifact(&task).unwrap();
    assert_eq!(a.commit_oid, REP, "commitOid 는 보고 커밋 그대로");
    assert_eq!(a.integration_commit.as_deref(), Some(CAND));
    assert_eq!(a.integration_parent.as_deref(), Some(OLD));
    assert_eq!(a.job_id.as_deref(), Some(id.as_str()));
    assert_eq!(r.integration.as_ref().unwrap().expected_head, CAND);
    assert_eq!(git.get(&refs::int(&run)).as_deref(), Some(CAND));
    assert_eq!(git.get(&refs::done(&refs::new_base(&run), &id)).as_deref(), Some(CAND));
    assert_eq!(git.get(&refs::accepted(&refs::new_base(&run), &task)).as_deref(), Some(REP));
    assert!(r.hold.is_none());
    // 통합된 수락은 뒤집지 않는다 · 취소는 already-integrated.
    let v = task_of(&h.o, &run, &task).version;
    assert_eq!(code(h.o.human_review(&run, &task, v, Decision::Rejected)), "already-integrated");
    assert_eq!(code(h.o.cancel_integration(&run, &task)), "already-integrated");
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// R3 — 의도 저장이 실패하면 CAS 하지 않는다 · Job `aborted:persist-failed` · Task 보고됨 · Run 보류(paused · 쓰기 · 재개 막힘).
#[test]
fn persist_failure_blocks_cas_and_holds_run() {
    let dir = scratch("persistfail");
    let h = harness(Some(dir.clone()));
    let git = Arc::new(FakeGit::default());
    let (run, c, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    h.o.flush_saves();
    h.o.set_save_fault(true);
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Aborted);
    assert_eq!(git.applies.load(Ordering::SeqCst), 0, "CAS 하지 않았다");
    assert_eq!(git.get(&refs::int(&run)).as_deref(), Some(OLD));
    let j = job(&h.o, &run, &id);
    assert_eq!(j.outcome.unwrap().reason, "persist-failed");
    let r = run_of(&h.o, &run);
    assert_eq!(r.task(&task).unwrap().state, TaskState::Reported, "수락 안 됨");
    assert_eq!(r.state, RunState::Paused);
    assert_eq!(r.hold.as_ref().unwrap().reason, HoldReason::PersistFailed);
    assert!(h.o.notices_view().to_string().contains("persist-failed"), "감독 알림");
    // 보류 — 조율 쓰기 · 재개 · 새 Job 이 막힌다.
    let w = call(&h.o, &c, "create_task", json!({ "requestId": "x", "title": "X", "goal": "g" }));
    assert!(w.unwrap_err().starts_with("run-on-hold"));
    assert_eq!(code(h.o.resume(&run)), "run-on-hold");
    let v = task_of(&h.o, &run, &task).version;
    assert_eq!(code(h.o.begin_integration(&run, &task, v, Reviewer::Human, "acc-2")), "run-on-hold");
    // 사람이 풀면 재개할 수 있다.
    h.o.set_save_fault(false);
    h.o.release_hold(&run).unwrap();
    assert!(run_of(&h.o, &run).hold.is_none());
    // 재개는 조정자가 묶여 있어야 선다(`no-coordinator` — 이 하네스는 묶음 없이 조정자 호출자를 쓴다).
    assert_eq!(code(h.o.resume(&run)), "no-coordinator");
    h.o.bind_coordinator(&run, 1, "stage2-tile").unwrap();
    h.o.resume(&run).unwrap();
    assert_eq!(run_of(&h.o, &run).state, RunState::Running);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// 재시작 복구
// ---------------------------------------------------------------------------

/// 4-4 — 의도는 저장됐지만 CAS 전에 서버가 죽었다 → 재시작 뒤 증거 ref 가 없어 `aborted:crashed` · Task 보고됨 · 보류 없음.
#[test]
fn crash_before_cas_not_integrated() {
    let dir = scratch("crash-before");
    let git = Arc::new(FakeGit::default());
    let (run, task, id) = {
        let h = harness(Some(dir.clone()));
        let (run, _, task) = v2_run(&h.o, &git);
        let id = job_with_candidate(&h.o, &run, &task, "acc-1");
        hook(&h.o, |_, step| step == IntegrateStep::BeforeCas);
        assert!(h.o.commit_job(&run, &id).is_err(), "죽음");
        (run, task, id)
    };
    assert_eq!(git.applies.load(Ordering::SeqCst), 0);
    assert_eq!(disk_run(&dir, &run).jobs[0].phase, JobPhase::Committing, "파일에는 의도가 남았다");
    let h = harness(Some(dir.clone()));
    assert_eq!(h.o.recover_jobs(), 0, "손이 없으면 판정하지 않는다");
    h.o.set_integrator(git.clone());
    assert_eq!(h.o.recover_jobs(), 1);
    let r = run_of(&h.o, &run);
    assert_eq!(r.state, RunState::Orphaned);
    let j = r.jobs.iter().find(|j| j.job_id == id).unwrap();
    assert_eq!((j.phase, j.outcome.as_ref().unwrap().reason.as_str()), (JobPhase::Aborted, "crashed"));
    assert_eq!(r.task(&task).unwrap().state, TaskState::Reported);
    assert!(r.valid_artifact(&task).is_none());
    assert!(r.hold.is_none(), "통합 ref 는 기대 머리 그대로");
    // 판정은 파일에 남는다 · 다시 해도 같다.
    h.o.flush_saves();
    assert_eq!(disk_run(&dir, &run).jobs[0].phase, JobPhase::Aborted);
    assert_eq!(h.o.recover_jobs(), 0);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 4-4 — CAS 는 섰는데 장부에 적기 전에 죽었다 → 증거 ref `done/<jobId>` 로 통합됨(`recovered_integrated`) · 산출물을 의도 기록으로 채움.
#[test]
fn crash_after_cas_recovers_from_done_ref() {
    let dir = scratch("crash-after");
    let git = Arc::new(FakeGit::default());
    let (run, task, id) = {
        let h = harness(Some(dir.clone()));
        let (run, _, task) = v2_run(&h.o, &git);
        let id = job_with_candidate(&h.o, &run, &task, "acc-1");
        hook(&h.o, |_, step| step == IntegrateStep::AfterCas);
        assert!(h.o.commit_job(&run, &id).is_err(), "죽음");
        (run, task, id)
    };
    assert_eq!(git.get(&refs::done(&refs::new_base(&run), &id)).as_deref(), Some(CAND));
    let h = harness(Some(dir.clone()));
    h.o.set_integrator(git.clone());
    assert_eq!(h.o.recover_jobs(), 1);
    let r = run_of(&h.o, &run);
    let j = r.jobs.iter().find(|j| j.job_id == id).unwrap();
    assert_eq!((j.phase, j.outcome.as_ref().unwrap().reason.as_str()), (JobPhase::Integrated, "recovered"));
    assert_eq!(r.task(&task).unwrap().state, TaskState::Accepted);
    assert_eq!(r.valid_artifact(&task).unwrap().integration_commit.as_deref(), Some(CAND));
    assert_eq!(r.integration.as_ref().unwrap().expected_head, CAND);
    assert!(r.hold.is_none());
    assert!(r.log.iter().any(|l| l.action == "recovered_integrated"));
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 4-4 — CAS 뒤 죽고, 그사이 사람이 통합 ref 를 더 움직였다 → 증거 ref 로 여전히 통합됨 + 기대 머리와 달라 보류(`integration-diverged`).
#[test]
fn crash_after_cas_then_human_moves_ref_still_integrated() {
    let dir = scratch("crash-moved");
    let git = Arc::new(FakeGit::default());
    let (run, task) = {
        let h = harness(Some(dir.clone()));
        let (run, _, task) = v2_run(&h.o, &git);
        let id = job_with_candidate(&h.o, &run, &task, "acc-1");
        hook(&h.o, |_, step| step == IntegrateStep::AfterCas);
        assert!(h.o.commit_job(&run, &id).is_err());
        (run, task)
    };
    git.set(&refs::int(&run), HUMAN);
    let h = harness(Some(dir.clone()));
    h.o.set_integrator(git.clone());
    assert_eq!(h.o.recover_jobs(), 1);
    let r = run_of(&h.o, &run);
    assert_eq!(r.task(&task).unwrap().state, TaskState::Accepted, "증거 ref 로 판정");
    let hold = r.hold.unwrap();
    assert_eq!((hold.reason, hold.detail.as_deref()), (HoldReason::IntegrationDiverged, Some("recovered")));
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 4-3 ⑥ — 트랜잭션 결과를 모를 때(시한)도 증거 ref 로 판정한다(통합됐으면 통합됨).
#[test]
fn unknown_tx_result_judged_by_done_ref() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    git.unknown_result.store(true, Ordering::SeqCst);
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Integrated);
    assert_eq!(task_of(&h.o, &run, &task).state, TaskState::Accepted);
    assert!(run_of(&h.o, &run).hold.is_none());
}

/// 리뷰 F7 — CAS 성공 → 응답 실패 → 증거 조회 실패: 결과를 모르면 `aborted` 로 확정하지 않고 `committing` 그대로(보류). 서버 시계의 재판정이
/// 또 못 읽으면 그대로 · 재시작 뒤 재시작 복구가 증거 ref 로 통합됨을 채운다.
#[test]
fn unknown_result_stays_committing_then_restart_recovers() {
    let dir = scratch("unknown-restart");
    let git = Arc::new(FakeGit::default());
    let (run, task, id) = {
        let h = harness(Some(dir.clone()));
        let (run, _, task) = v2_run(&h.o, &git);
        let id = job_with_candidate(&h.o, &run, &task, "acc-1");
        git.unknown_result.store(true, Ordering::SeqCst);
        git.done_read_fail.store(true, Ordering::SeqCst);
        assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Committing, "결과를 모르면 확정하지 않는다");
        assert_eq!(git.get(&refs::done(&refs::new_base(&run), &id)).as_deref(), Some(CAND), "ref 는 섰다");
        let r = run_of(&h.o, &run);
        assert_eq!(r.task(&task).unwrap().state, TaskState::Integrating);
        assert_eq!(r.hold.as_ref().unwrap().detail.as_deref(), Some("unknown-result"));
        h.o.recheck_unknown_commits();
        assert_eq!(job(&h.o, &run, &id).phase, JobPhase::Committing, "또 못 읽으면 그대로");
        h.o.flush_saves();
        (run, task, id)
    };
    assert_eq!(disk_run(&dir, &run).jobs[0].phase, JobPhase::Committing, "재시작 복구 대상으로 남았다");
    git.done_read_fail.store(false, Ordering::SeqCst);
    let h = harness(Some(dir.clone()));
    h.o.set_integrator(git.clone());
    assert_eq!(h.o.recover_jobs(), 1);
    let r = run_of(&h.o, &run);
    let j = r.jobs.iter().find(|j| j.job_id == id).unwrap();
    assert_eq!(j.phase, JobPhase::Integrated);
    assert_eq!(r.task(&task).unwrap().state, TaskState::Accepted);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 리뷰 F7 — 같은 서버 수명에서 증거 ref 를 다시 읽을 수 있게 되면 서버 시계의 재판정이 통합됨으로 확정한다.
#[test]
fn unknown_result_rechecked_by_server_clock() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    git.unknown_result.store(true, Ordering::SeqCst);
    git.done_read_fail.store(true, Ordering::SeqCst);
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Committing);
    git.done_read_fail.store(false, Ordering::SeqCst);
    h.o.tick();
    assert_eq!(job(&h.o, &run, &id).phase, JobPhase::Integrated);
    assert_eq!(task_of(&h.o, &run, &task).state, TaskState::Accepted);
}

/// 리뷰 F10 — 저장기가 없으면(데이터 루트 없음 · 저장 스레드 생성 실패) 의도 저장 관문이 거절 — CAS 하지 않는다. 비영속 성공은 시험의
/// 명시적 모드에서만.
#[test]
fn missing_store_refuses_integration_commit() {
    let h = harness(None);
    h.o.set_ephemeral(false);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Aborted);
    assert_eq!(git.applies.load(Ordering::SeqCst), 0, "CAS 하지 않았다");
    assert_eq!(git.get(&refs::int(&run)).as_deref(), Some(OLD), "ref 가 움직이지 않았다");
    assert_eq!(job(&h.o, &run, &id).outcome.unwrap().reason, "persist-failed");
    assert_eq!(task_of(&h.o, &run, &task).state, TaskState::Reported);
}

// ---------------------------------------------------------------------------
// 취소 · 중단 · 외부 변경
// ---------------------------------------------------------------------------

/// 4-4 — `committing` 으로 넘어간 뒤의 사람 [취소]는 `integration-committing`(같은 잠금에서 직렬화), 통합 뒤는 `already-integrated`.
/// 넘어가기 전의 [취소]는 받고 — 그 뒤의 올리기는 아무것도 하지 않는다.
#[test]
fn cancel_vs_commit_serialized() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    let refused = Arc::new(Mutex::new(None::<&'static str>));
    {
        let (refused, run, task) = (refused.clone(), run.clone(), task.clone());
        hook(&h.o, move |o, step| {
            if step == IntegrateStep::Committing {
                *refused.lock().unwrap() = o.cancel_integration(&run, &task).err().map(|e| e.code);
            }
            false
        });
    }
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Integrated);
    assert_eq!(*refused.lock().unwrap(), Some("integration-committing"));
    assert_eq!(code(h.o.cancel_integration(&run, &task)), "already-integrated");

    // 커밋 단계 전의 취소.
    let h = harness(None);
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    let before = git.applies.load(Ordering::SeqCst);
    let v = h.o.cancel_integration(&run, &task).unwrap();
    assert_eq!(v["job"]["phase"], "aborted");
    assert_eq!(task_of(&h.o, &run, &task).state, TaskState::Reported);
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Aborted, "끝난 Job 은 올리지 않는다");
    assert_eq!(git.applies.load(Ordering::SeqCst), before);
    // 거둔 뒤에는 다시 수락을 요청할 수 있다(새 Job).
    let again = job_with_candidate(&h.o, &run, &task, "acc-2");
    assert_ne!(again, id);
}

/// 4-4 · R9 — Run 중단은 커밋 중인 Job 이 끝날 때까지 stopped 가 되지 않는다(`settle_stopping` 이 Job 을 센다). 커밋 단계 전의 Job 은
/// 중단이 곧바로 거둔다.
#[test]
fn stop_waits_for_committing_job() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    let during = Arc::new(Mutex::new(None::<RunState>));
    {
        let (during, run) = (during.clone(), run.clone());
        hook(&h.o, move |o, step| {
            if step == IntegrateStep::BeforeCas {
                o.stop(&run).unwrap();
                *during.lock().unwrap() = o.lock().runs.get(&run).map(|s| s.run.state);
            }
            false
        });
    }
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Integrated, "커밋 단계는 취소되지 않는다");
    assert_eq!(*during.lock().unwrap(), Some(RunState::Stopping), "Job 이 끝날 때까지 stopping");
    assert_eq!(run_of(&h.o, &run).state, RunState::Stopped, "Job 이 끝나면 stopped");

    // 커밋 단계 전 — 중단이 거두고 곧바로 stopped.
    let h = harness(None);
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    h.o.stop(&run).unwrap();
    let r = run_of(&h.o, &run);
    assert_eq!(r.state, RunState::Stopped);
    let j = r.jobs.iter().find(|j| j.job_id == id).unwrap();
    assert_eq!((j.phase, j.outcome.as_ref().unwrap().reason.as_str()), (JobPhase::Aborted, "stopped"));
    assert_eq!(r.task(&task).unwrap().state, TaskState::Reported);
}

/// 4-5 · R4 — 올리기 직전 통합 ref 가 사람 손으로 움직였다 → CAS 실패 · 자동 채택 없음 · `aborted:moved` · Run 보류(해제는 [조정]만).
#[test]
fn external_ref_change_holds_run() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    *git.move_before.lock().unwrap() = Some(HUMAN.into());
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Aborted);
    assert_eq!(job(&h.o, &run, &id).outcome.unwrap().reason, "moved");
    assert_eq!(git.get(&refs::int(&run)).as_deref(), Some(HUMAN), "사람의 머리를 덮지 않았다");
    assert!(git.get(&refs::done(&refs::new_base(&run), &id)).is_none());
    let r = run_of(&h.o, &run);
    assert_eq!(r.integration.as_ref().unwrap().expected_head, OLD, "자동 채택 없음");
    assert_eq!(r.hold.as_ref().unwrap().reason, HoldReason::IntegrationDiverged);
    assert_eq!(r.state, RunState::Paused);
    assert_eq!(r.task(&task).unwrap().state, TaskState::Reported);
    assert_eq!(code(h.o.release_hold(&run)), "invalid-state", "어긋남은 [조정]으로만");
}

/// 4-3 ⑥ — 올리기 직전 재확인: 세대가 바뀌면(세대 교체는 커밋 단계 전 Job 을 거둔다) 올리지 않는다.
#[test]
fn generation_change_aborts_uncommitted_job() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    let id = job_with_candidate(&h.o, &run, &task, "acc-1");
    h.o.bump_gen_for_test(&run).unwrap();
    assert_eq!(job(&h.o, &run, &id).outcome.unwrap().reason, "generation");
    assert_eq!(h.o.commit_job(&run, &id).unwrap(), JobPhase::Aborted);
    assert_eq!(git.applies.load(Ordering::SeqCst), 0);
    assert_eq!(task_of(&h.o, &run, &task).state, TaskState::Reported);
}

// ---------------------------------------------------------------------------
// Run 완료
// ---------------------------------------------------------------------------

/// 3-4 · R15 — 완료 조건(Task 전부 종결 · 진행 중 통합 없음 · 산 작업자 없음 · 보류 없음)을 채워야 사람의 [Run 완료] → `done`.
/// 조정자에게는 이 길이 없다.
#[test]
fn completable_conditions_and_done_only_by_human() {
    let h = harness(None);
    let (run, c) = start(&h.o);
    let task = create_task(&h.o, &c, "t1");
    let blockers = |o: &Orchestration| o.run_detail(&run).unwrap()["completable"]["blockers"].clone();
    assert_eq!(blockers(&h.o), json!(["tasks-open"]));
    let e = h.o.complete_run(&run).unwrap_err();
    assert_eq!(e.code, "not-completable");
    assert!(e.message.contains("tasks-open"));
    // 산 작업자.
    reported(&h.o, &run, &task);
    {
        let mut g = h.o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.attempts[0].state = AttemptState::Reported;
    }
    let v = task_of(&h.o, &run, &task).version;
    h.o.set_task_state(&run, &task, v, TaskState::Cancelled).unwrap();
    assert_eq!(blockers(&h.o), json!(["workers-alive"]));
    {
        let mut g = h.o.lock();
        g.runs.get_mut(&run).unwrap().run.attempts[0].state = AttemptState::Exited;
    }
    assert_eq!(h.o.run_detail(&run).unwrap()["completable"]["ok"], true);
    // (3차 5단계 — Q5 로 2차의 "완료는 사람만" 을 뒤집었다) 조정자 도구의 완료는 `complete_run` 하나 — 같은 `completable` 판정(시험
    // `tests_start::complete_run_by_coordinator`). 그 밖의 끝내기 도구는 없다.
    let names: Vec<String> = super::COORDINATOR_TOOLS.iter().map(|s| s.to_string()).collect();
    let enders: Vec<&String> = names.iter().filter(|n| n.contains("complete") || n.contains("done") || n.contains("finish")).collect();
    assert_eq!(enders, vec!["complete_run"], "{names:?}");
    let r = h.o.complete_run(&run).unwrap();
    assert_eq!(r["state"], "done");
    let after = run_of(&h.o, &run);
    assert_eq!(after.state, RunState::Done);
    assert!(after.ended_at.is_some());
    assert!(after.log.iter().any(|l| l.action == "run_done"));
    assert_eq!(h.o.active_count(), 0, "done 은 동시 Run 에 세지 않는다");
    assert!(h.o.coordinator_caller(&run).is_none(), "끝난 Run 에는 조정자가 없다");
    assert_eq!(code(h.o.complete_run(&run)), "not-completable");
    assert_eq!(code(h.o.resume(&run)), "run-stopped");
}

/// 3-4 — 보류 · 진행 중 통합도 완료를 막는다.
#[test]
fn hold_and_live_job_block_completion() {
    let h = harness(None);
    let git = Arc::new(FakeGit::default());
    let (run, _, task) = v2_run(&h.o, &git);
    job_with_candidate(&h.o, &run, &task, "acc-1");
    let b = h.o.run_detail(&run).unwrap()["completable"]["blockers"].clone();
    assert_eq!(b, json!(["tasks-open", "integration-running"]));
    h.o.cancel_integration(&run, &task).unwrap();
    {
        let mut g = h.o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.hold = Some(RunHold { reason: HoldReason::CleanupPending, at: 0, detail: None });
    }
    let v = task_of(&h.o, &run, &task).version;
    h.o.set_task_state(&run, &task, v, TaskState::Cancelled).unwrap();
    assert_eq!(h.o.run_detail(&run).unwrap()["completable"]["blockers"], json!(["on-hold"]));
    h.o.release_hold(&run).unwrap();
    h.o.complete_run(&run).unwrap();
}

// ---------------------------------------------------------------------------
// 진짜 git — ref 트랜잭션
// ---------------------------------------------------------------------------

fn git_cmd(dir: &Path, args: &[&str]) -> String {
    let mut full = vec!["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    full.extend_from_slice(args);
    let r = crate::worktree::run_git(dir, &full, crate::worktree::GIT_TIMEOUT).unwrap();
    assert!(r.ok, "git {args:?}: {}", r.stderr);
    r.stdout.trim().to_string()
}

/// 0a U1 · U2 · U7 — `update-ref --stdin` 트랜잭션: 성공은 `commit: ok` 줄로 판정 · 통합 ref · 완료 증거 · 보존 ref 가 함께 선다 ·
/// CAS 가 틀리면 아무것도 안 바뀐다. `read_ref` · `is_ancestor`.
#[test]
fn ref_transaction_updates_int_done_and_preserve_together() {
    assert!(tx_committed("start: ok\nprepare: ok\ncommit: ok\n"));
    assert!(tx_committed("start: ok\r\nprepare: ok\r\ncommit: ok\r\n"));
    assert!(!tx_committed("start: ok\nprepare: ok\n"), "commit 줄이 없으면 안 섰다(0a U7)");
    let root = scratch("reftx");
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git_cmd(&repo, &["init", "-q", "-b", "main"]);
    std::fs::write(repo.join("a.txt"), "a\n").unwrap();
    git_cmd(&repo, &["add", "-A"]);
    git_cmd(&repo, &["commit", "-q", "-m", "a"]);
    let a = git_cmd(&repo, &["rev-parse", "HEAD"]);
    std::fs::write(repo.join("a.txt"), "b\n").unwrap();
    git_cmd(&repo, &["commit", "-q", "-am", "b"]);
    let b = git_cmd(&repo, &["rev-parse", "HEAD"]);
    let run = new_id("run").unwrap();
    let int = refs::int(&run);
    git_cmd(&repo, &["update-ref", &int, &a, ""]);
    let g = GitRefs;
    assert_eq!(g.read_ref(&repo, &int).unwrap().as_deref(), Some(a.as_str()));
    assert_eq!(g.read_ref(&repo, &refs::done(&refs::new_base(&run), "job-x")).unwrap(), None);
    assert!(g.is_ancestor(&repo, &a, &b).unwrap());
    assert!(!g.is_ancestor(&repo, &b, &a).unwrap());
    // CAS 틀림 — 아무것도 안 바뀐다.
    let wrong = RefTx {
        work_ref: int.clone(),
        old: b.clone(),
        new: b.clone(),
        done_ref: refs::done(&refs::new_base(&run), "job-1"),
        preserve_ref: refs::accepted(&refs::new_base(&run), "task-1"),
        report_commit: b.clone(),
        preserve_old: None,
        candidate_ref: None,
    };
    assert!(matches!(g.apply(&repo, &wrong).unwrap(), TxOutcome::Refused(_)));
    assert_eq!(g.read_ref(&repo, &int).unwrap().as_deref(), Some(a.as_str()));
    assert_eq!(g.read_ref(&repo, &wrong.done_ref).unwrap(), None);
    assert_eq!(g.read_ref(&repo, &wrong.preserve_ref).unwrap(), None);
    // 맞는 CAS — 셋이 함께.
    let ok = RefTx { old: a.clone(), ..wrong.clone() };
    assert_eq!(g.apply(&repo, &ok).unwrap(), TxOutcome::Committed);
    assert_eq!(g.read_ref(&repo, &int).unwrap().as_deref(), Some(b.as_str()));
    assert_eq!(g.read_ref(&repo, &ok.done_ref).unwrap().as_deref(), Some(b.as_str()));
    assert_eq!(g.read_ref(&repo, &ok.preserve_ref).unwrap().as_deref(), Some(b.as_str()));
    // 같은 증거 ref 를 다시 만들 수 없다(0a U3) — 통합 ref 도 그대로.
    let again = RefTx { old: b.clone(), ..wrong.clone() };
    assert!(matches!(g.apply(&repo, &again).unwrap(), TxOutcome::Refused(_)));
    // 줄을 섞는 값은 git 에 닿기 전에 거절.
    assert!(RefTx { new: "x\ndelete refs/heads/main".into(), ..ok.clone() }.script().is_err());
    assert!(RefTx { done_ref: "refs/a b".into(), ..ok }.script().is_err());
    let _ = super::worktree::unlink_links(&root, &[]);
    let _ = std::fs::remove_dir_all(&root);
}
