//! 통합 설계 5단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 3-3 · 3-4 · 8 · 10절) — **검토자**:
//! 가짜 검토자(서버 손 가짜 · worktree git 가짜 손) 흐름 · 작업자 수명과 분리(`current_attempt` · Task 상태 · 작업자 한도) · 보고당 · Run 당
//! 활성 하나 · 무효화(반려 · 취소 · 사람 수락) · 늦은 옛 검토가 새 판정을 덮지 않음 · `requireReview` 거절/통과 · 사람 면제 기록 · 별도 예산 ·
//! 역할 도구(검토자는 커밋 · 보고 못 함, 작업자는 판정 못 함) · 고정 인자(Claude · Codex 정확한 argv) · 고정 대상 diff(진짜 git) ·
//! symlink 밖 거절(진짜 git).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::report::{Probe, WorktreeState};
use super::spawn::*;
use super::store::*;
use super::test_album::{self as td};
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 하네스(가짜 서버 손 · 가짜 worktree git)
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

const BASE: &str = "1111111111111111111111111111111111111111";
const HEAD1: &str = "2222222222222222222222222222222222222222";

struct H {
    o: Arc<Orchestration>,
    fake: Arc<Fake>,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
    clock: Arc<AtomicU64>,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(move || c.fetch_add(1, Ordering::SeqCst))));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    let probe: Probe = Arc::new(|_p: &Path, _base: Option<&str>| {
        Ok(WorktreeState {
            head: Some(HEAD1.into()),
            ..Default::default()
        })
    });
    o.set_probe(probe);
    H {
        o,
        fake,
        audit: Mutex::new(rx),
        clock,
    }
}

/// Run 하나 — 맡기기(3a): `require_review` 면 수락 규칙 "검토(Claude 판정형) pass 1", 판정 총 한도는 `limits.max_reviews`(맡기기로 옮겼다).
fn start(h: &H, require_review: bool, limits: Limits) -> (String, Caller) {
    let mut b = td::block("C:/repo", td::default_roles(), if require_review { vec![(td::JUDGE, 1)] } else { Vec::new() }, None);
    b.set.limits.max_reviews = limits.max_reviews;
    td::delegate_with(&h.o, td::active(b));
    let run = h
        .o
        .start_run(StartRun {
            verify: None,
            name: "stage5".into(),
            repo: "C:/repo".into(),
            worktree_dir: "C:/repo-wt".into(),
            limits,
        })
        .unwrap()
        .0;
    // 옛 파일 호환 칸(2차 `requireReview`) — 새 Run 은 쓰지 않지만 옛 Run 의 면제 기록 판정을 함께 본다(옛 파일을 읽은 Run 과 같게).
    h.o.lock().runs.get_mut(&run).unwrap().run.require_review = Some(require_review);
    let c = h.o.coordinator_caller(&run).unwrap();
    (run, c)
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

fn task(o: &Orchestration, c: &Caller, req: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": req, "goal": "do it" })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

fn token_of(h: &H, att: &str) -> String {
    h.fake.jobs.lock().unwrap().iter().find(|j| j.attempt_id == att).unwrap().token.clone()
}

/// 작업자 하나가 성공 보고까지 — `(attemptId, 작업자 호출자)`.
fn reported_worker(h: &H, run: &str, c: &Caller, req: &str, task_id: &str) -> (String, Caller) {
    let v = call(&h.o, c, "spawn_worker", json!({ "requestId": req, "taskId": task_id, "role": td::WRITER })).unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    assert!(h.o.attempt_worktree(run, &att, &format!("C:/repo-wt/{att}"), &format!("orch-{req}"), BASE));
    assert_eq!(h.o.attempt_spawned(run, &att, Some(4242)), crate::orchestration::SpawnVerdict::Keep);
    let w = h.o.resolve(Some(&format!("Bearer {}", token_of(h, &att)))).expect("작업자 토큰");
    call(&h.o, &w, "report_done", json!({ "requestId": format!("{req}-r"), "outcome": "success", "summary": "done" })).unwrap();
    (att, w)
}

/// 판정형 역할 id(시험 맡기기) — CLI 이름으로.
fn judge(cli: &str) -> &'static str {
    if cli == "codex" {
        td::JUDGE_CODEX
    } else {
        td::JUDGE
    }
}

/// 검토자(판정형) 하나를 띄워 턴이 돌 때까지 — `(attemptId, 검토자 호출자)`.
fn reviewer(h: &H, run: &str, c: &Caller, req: &str, task_id: &str, cli: &str) -> (String, Caller) {
    let v = call(&h.o, c, "spawn_worker", json!({ "requestId": req, "taskId": task_id, "role": judge(cli) })).unwrap();
    // (3a) 답의 `role` 은 역할 표의 사본(id · 이름 · 종류 · CLI).
    assert_eq!(v["role"]["kind"], "judge");
    assert_eq!(v["role"]["id"], judge(cli));
    let att = v["attemptId"].as_str().unwrap().to_string();
    assert!(h.o.attempt_review_place(run, &att, &format!("C:/repo-wt/{att}-rv"), &format!("C:/data/{att}")));
    assert_eq!(h.o.attempt_spawned(run, &att, Some(4343)), crate::orchestration::SpawnVerdict::Keep);
    let r = h.o.resolve(Some(&format!("Bearer {}", token_of(h, &att)))).expect("검토자 토큰");
    assert!(matches!(r, Caller::Reviewer { .. }), "검토자 토큰은 검토자 역할");
    (att, r)
}

fn verdict(o: &Orchestration, r: &Caller, req: &str, v: &str) -> Result<Value, String> {
    call(o, r, "report_review", json!({ "requestId": req, "verdict": v, "summary": "looked at it", "findings": ["a.rs:3 off by one"] }))
}

fn detail(o: &Orchestration, run: &str) -> Value {
    o.run_detail(run).unwrap()
}

fn task_view(o: &Orchestration, run: &str, id: &str) -> Value {
    detail(o, run)["tasks"].as_array().unwrap().iter().find(|t| t["id"] == id).unwrap().clone()
}

fn attempt_view(o: &Orchestration, run: &str, id: &str) -> Value {
    detail(o, run)["attempts"].as_array().unwrap().iter().find(|a| a["id"] == id).unwrap().clone()
}

fn version(o: &Orchestration, run: &str, id: &str) -> u64 {
    task_view(o, run, id)["version"].as_u64().unwrap()
}

fn update(o: &Orchestration, c: &Caller, run: &str, req: &str, id: &str, state: &str) -> Result<Value, String> {
    let v = version(o, run, id);
    call(o, c, "update_task", json!({ "requestId": req, "taskId": id, "version": v, "state": state }))
}

fn review_state(o: &Orchestration, run: &str, task: &str) -> Value {
    detail(o, run)["reviewState"][task].clone()
}

fn drain_audit(h: &H) -> Vec<AuditRecord> {
    let rx = h.audit.lock().unwrap();
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

/// 통합 ref 가 있는 Run 으로 만든다(보고 뒤에 — 작업자 생성은 통합 git 을 읽으므로). 통합 git 손이 없어 통합 작업은 관문 뒤 곧바로
/// `integration-failed:no-git` 로 거둬진다 — 관문(검토 몫)만 본다.
fn make_integrated(o: &Orchestration, run: &str) {
    let mut g = o.lock();
    let slot = g.runs.get_mut(run).unwrap();
    slot.run.integration = Some(Integration {
        work_ref: super::integrate::refs::int(run),
        export_branch: "orch-x-int".into(),
        base_commit: BASE.into(),
        base_branch: None,
        expected_head: BASE.into(),
        exported_head: None,
        work_ref_removed: false,
    });
}

fn exit(o: &Orchestration, run: &str, att: &str) {
    o.attempt_process_exited(run, att, true, Some(0));
}

// ---------------------------------------------------------------------------
// 흐름 · 분리
// ---------------------------------------------------------------------------

#[test]
fn fake_reviewer_flow_pass() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    let (w_att, _) = reported_worker(&h, &run, &c, "w1", &t);
    let before = task_view(&h.o, &run, &t);
    let (att, r) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    // Task 상태 · 버전 · current_attempt 는 그대로(작업자 수명과 분리 — R7).
    let after = task_view(&h.o, &run, &t);
    assert_eq!(after["state"], "reported");
    assert_eq!(after["version"], before["version"]);
    assert_eq!(after["currentAttempt"], w_att.as_str());
    assert_eq!(after["review"]["active"], att.as_str());
    assert_eq!(review_state(&h.o, &run, &t)["state"], "pending");
    // 서버 손에 간 일 — 고정 대상 · worktree 없음 · 작업자 권한과 무관.
    {
        let jobs = h.fake.jobs.lock().unwrap();
        let job = jobs.iter().find(|j| j.attempt_id == att).unwrap();
        let rv = job.review.as_ref().expect("검토 일");
        assert_eq!(rv.commit, HEAD1);
        assert_eq!(rv.base.as_deref(), Some(BASE));
        assert!(job.reuse.is_none() && job.seed.is_none());
    }
    let a = attempt_view(&h.o, &run, &att);
    assert_eq!(a["role"], "reviewer");
    assert_eq!(a["reviewOf"]["commitOid"], HEAD1);
    assert!(a["worktree"].is_null(), "검토자는 작업자 worktree 를 갖지 않는다");
    assert!(a["launchArgs"].as_str().unwrap().contains("--tools Read,Grep,Glob"));
    // 검토 지시서.
    let gt = call(&h.o, &r, "get_task", json!({})).unwrap();
    assert_eq!(gt["commit"], HEAD1);
    assert_eq!(gt["base"], BASE);
    assert_eq!(gt["report"]["summary"], "done");
    assert_eq!(gt["stillCurrent"], true);
    // 판정.
    let v = verdict(&h.o, &r, "v1", "pass").unwrap();
    assert_eq!(v["state"], "current");
    let rs = review_state(&h.o, &run, &t);
    assert_eq!(rs["state"], "pass");
    assert_eq!(rs["findings"][0], "a.rs:3 off by one");
    // (3a) 판정형의 `reported` 는 턴 끝에 — 판정 순간에는 턴이 아직 돈다.
    assert_eq!(attempt_view(&h.o, &run, &att)["state"], "running");
    assert!(task_view(&h.o, &run, &t)["review"]["active"].is_null(), "판정이 서면 자리가 빈다");
    // 같은 requestId 는 처음 결과 · 다른 요청은 already-reported.
    assert_eq!(verdict(&h.o, &r, "v1", "pass").unwrap(), v);
    assert_eq!(code(verdict(&h.o, &r, "v2", "changes-requested")), "already-reported");
    // (3차 2단계) 보고 뒤 자동 종료를 걸지 않는다 — 헤드리스 검토자는 턴(= 프로세스)이 끝나면 끝이다(턴 시한이 받친다).
    assert!(detail(&h.o, &run).get("autoStop").is_none());
    exit(&h.o, &run, &att);
    assert_eq!(attempt_view(&h.o, &run, &att)["state"], "reported", "판정한 턴이 끝나면 reported(닫힘)");
    // wait_run until=reviewed 는 곧바로 선다.
    let w = call(&h.o, &c, "wait_run", json!({ "until": "reviewed", "timeoutSeconds": 1 })).unwrap();
    assert_eq!(w["satisfied"], true);
    // 감사 — 판정 · 개수 · 길이만(본문 없음).
    let rec = drain_audit(&h).into_iter().find(|r| r.event == "reviewer_reported").expect("reviewer_reported");
    let d = rec.orchestration.unwrap();
    assert_eq!(d.outcome.as_deref(), Some("pass"));
    assert_eq!(d.findings, Some(1));
    assert!(!serde_json::to_string(&d).unwrap().contains("off by one"));
}

#[test]
fn reviewer_does_not_touch_current_attempt_or_worker_limits() {
    let h = harness();
    let limits = LimitsInput {
        max_concurrent_workers: Some(1),
        max_total_workers: Some(1),
        ..Default::default()
    }
    .resolve();
    let (run, c) = start(&h, false, limits);
    let t = task(&h.o, &c, "t");
    let (w_att, _) = reported_worker(&h, &run, &c, "w1", &t);
    // 작업자 자리(동시 1 · 총 1)는 꽉 찼다 — 검토는 따로 센다.
    let t2 = task(&h.o, &c, "t2");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "w2", "taskId": t2, "role": td::WRITER }))), "worker-limit");
    let (att, _) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    let d = detail(&h.o, &run);
    assert_eq!(d["remaining"]["concurrentWorkers"], 0);
    assert_eq!(d["remaining"]["totalWorkers"], 0);
    assert_eq!(d["remaining"]["reviews"], DEFAULT_MAX_REVIEWS - 1);
    assert_eq!(task_view(&h.o, &run, &t)["currentAttempt"], w_att.as_str());
    // 작업자의 보고 관문(현재 Attempt)은 검토자 때문에 흔들리지 않는다 — 검토자는 Task 의 현재 Attempt 가 아니다.
    assert_ne!(task_view(&h.o, &run, &t)["currentAttempt"], att.as_str());
    // 검토자에게는 이어지는 지시가 없다(전달은 작업자에게만).
    let sp = call(&h.o, &c, "send_prompt", json!({ "requestId": "p", "attemptId": att, "text": "hi" }));
    assert!(sp.map(|v| v["state"] == "rejected").unwrap_or(true), "검토자는 전달 대상이 아니다");
}

#[test]
fn one_active_review_per_report_and_per_run() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let t2 = task(&h.o, &c, "t2");
    reported_worker(&h, &run, &c, "w2", &t2);
    let (att, r) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "rv2", "taskId": t, "role": td::JUDGE }))), "review-active");
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "rv3", "taskId": t2, "role": td::JUDGE }))),
        "review-active",
        "Run 당 동시 하나"
    );
    // 판정하고 끝나면 다음 검토가 선다.
    verdict(&h.o, &r, "v", "changes-requested").unwrap();
    exit(&h.o, &run, &att);
    reviewer(&h, &run, &c, "rv4", &t2, "claude");
}

#[test]
fn reviewer_spawn_gates() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "a", "taskId": t, "role": td::JUDGE }))), "not-reported");
    // 실패 보고는 검토하지 않는다(수락할 수 없는 보고).
    let v = call(&h.o, &c, "spawn_worker", json!({ "requestId": "w", "taskId": t, "role": td::WRITER })).unwrap();
    let w_att = v["attemptId"].as_str().unwrap().to_string();
    assert!(h.o.attempt_worktree(&run, &w_att, "C:/repo-wt/x", "orch-x", BASE));
    h.o.attempt_spawned(&run, &w_att, Some(1));
    let w = h.o.resolve(Some(&format!("Bearer {}", token_of(&h, &w_att)))).unwrap();
    call(&h.o, &w, "report_done", json!({ "requestId": "r", "outcome": "failure", "summary": "no" })).unwrap();
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "b", "taskId": t, "role": td::JUDGE }))), "not-success");
    // 기준 · 이어 쓰기는 판정형에게 없다 · 모르는 역할 · 옛 인자(3a — `cli` · `role:"reviewer"` 는 bad-args).
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "c", "taskId": t, "role": td::JUDGE, "reuseWorktreeOf": w_att }))),
        "invalid-argument"
    );
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "d", "taskId": t, "role": "boss" }))), "unknown-role");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "e", "taskId": t, "role": "reviewer" }))), "bad-args");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "f", "taskId": t, "cli": "claude", "role": td::JUDGE }))), "bad-args");
    // Codex 판정형도 곧바로 턴이 돈다(부트스트랩 시한이 없다).
    let h2 = harness();
    let (run2, c2) = start(&h2, false, Limits::default());
    let t2 = task(&h2.o, &c2, "t");
    reported_worker(&h2, &run2, &c2, "w", &t2);
    let (cx, _) = reviewer(&h2, &run2, &c2, "y", &t2, "codex");
    assert_eq!(attempt_view(&h2.o, &run2, &cx)["state"], "running");
    assert_eq!(attempt_view(&h2.o, &run2, &cx)["cli"], "codex", "CLI 는 역할 표에서");
}

/// E2E 10-16 · 3차 2단계 — 헤드리스 검토자(Claude `-p` 포함)는 곧바로 `working` 이고 부트스트랩 시한 · 멈춤 시한으로 `awaiting-human` 에
/// 빠지지 않는다. **세션 · 타일 스트림이 없어**(붙일 타일 · 신호 · 떨어진 세션 줄이 서지 않는다) 훅 신호가 닿을 길도 없다. 판정 없이
/// 끝나면 `exited`(종결 — D9) · 활성 자리를 비운다.
#[test]
fn non_interactive_reviewer_never_waits_for_a_person() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w", &t);
    let (rv, _) = reviewer(&h, &run, &c, "r", &t, "claude");
    assert_eq!(attempt_view(&h.o, &run, &rv)["state"], "running", "Claude 검토자도 부트스트랩 없이");
    assert!(attempt_view(&h.o, &run, &rv)["stream"].is_null(), "헤드리스 검토자는 세션 스트림이 없다");
    // 턴 기록(서버 손이 시작 · 끝에 적는다) — 낱말 · 수 · 권한 표시 구조만.
    let label = TurnArgsLabel {
        cli: "claude".into(),
        grade: "read-only".into(),
        settings_control: "setting-sources-empty".into(),
        ..Default::default()
    };
    let rec = TurnRecord {
        n: 1,
        started_at: 0,
        ended_at: None,
        outcome: "running".into(),
        reason: None,
        exit_code: None,
        denials: 0,
        denial_kinds: Vec::new(),
        tools: 0,
        last_tool: None,
        cli_version: None,
        model: None,
        args: label,
        anomalies: TurnAnomalies::default(),
    };
    h.o.attempt_turn(&run, &rv, rec.clone(), false);
    assert_eq!(attempt_view(&h.o, &run, &rv)["turns"][0]["outcome"], "running");
    h.clock.fetch_add(10 * 60_000, Ordering::SeqCst);
    h.o.tick();
    let a = attempt_view(&h.o, &run, &rv);
    assert_eq!(a["state"], "running", "시한으로 awaiting-human 에 빠지지 않는다");
    assert!(a["attention"].is_null());
    // 턴이 판정 없이 끝났다(결과 없음) → 턴 기록 · exited · 활성 자리를 비운다 · 사유는 턴 낱말.
    h.o.attempt_turn(
        &run,
        &rv,
        TurnRecord {
            outcome: "failed".into(),
            reason: Some("no-result".into()),
            exit_code: Some(0),
            model: Some("claude-haiku-5-5".into()),
            ..rec
        },
        true,
    );
    h.o.attempt_process_exited(&run, &rv, true, Some(0));
    let a = attempt_view(&h.o, &run, &rv);
    assert_eq!(a["state"], "exited");
    assert_eq!(a["exitReason"], "turn failed:no-result");
    assert_eq!(a["turns"].as_array().unwrap().len(), 1, "같은 턴 번호는 고쳐 쓴다");
    assert_eq!(a["turns"][0]["model"], "claude-haiku-5-5");
    assert!(a["turns"][0]["endedAt"].as_u64().unwrap() >= a["turns"][0]["startedAt"].as_u64().unwrap());
    assert_eq!(task_view(&h.o, &run, &t)["review"]["active"], Value::Null);
    // E4 — 알림은 "검토자가 판정 없이 끝났습니다"(작업자의 "보고 없이 끝남" 이 아니다).
    let kinds: Vec<String> = h.o.notices_view().as_array().unwrap().iter().map(|n| n["kind"].as_str().unwrap().to_string()).collect();
    assert!(kinds.iter().any(|k| k == "reviewer-exited"), "{kinds:?}");
    assert!(!kinds.iter().any(|k| k == "worker-exited"), "{kinds:?}");
    let n = super::notice::Notice {
        id: "x".into(),
        run_id: run.clone(),
        run_name: "R".into(),
        kind: "reviewer-exited",
        attempt_id: Some(rv.clone()),
        task_title: None,
        detail: None,
        at: 0,
    };
    assert_eq!(super::notice::kind_word("reviewer-exited"), "reviewer-exited");
    assert!(!super::notice::message_text(&n).is_empty());
}

// ---------------------------------------------------------------------------
// 무효화 · 늦은 판정
// ---------------------------------------------------------------------------

#[test]
fn review_invalidated_on_reject_and_late_old_review_does_not_override() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let (a, ra) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    // 반려 → 활성 검토 무효화(자리 비움 · 검토자 멈춤).
    update(&h.o, &c, &run, "rej", &t, "rejected").unwrap();
    let tv = task_view(&h.o, &run, &t);
    assert!(tv["review"]["active"].is_null() && tv["review"]["target"].is_null());
    assert_eq!(attempt_view(&h.o, &run, &a)["state"], "stopping");
    assert!(h.fake.stops.lock().unwrap().contains(&a), "서버 손에 멈춤을 맡겼다");
    // 무효화된 뒤의 판정 — stale(기록만).
    let v = verdict(&h.o, &ra, "late1", "pass").unwrap();
    assert_eq!(v["state"], "stale");
    assert_eq!(review_state(&h.o, &run, &t)["state"], "none");
    exit(&h.o, &run, &a);
    // 재작업 → 새 보고 → 새 검토 B 의 판정(changes-requested).
    h.o.lock().runs.get_mut(&run).unwrap().run.review_reports.retain(|r| r.attempt_id != a); // A 가 아직 판정하지 않은 것처럼(늦게 끝나는 경우)
    reported_worker(&h, &run, &c, "w2", &t);
    let (b, rb) = reviewer(&h, &run, &c, "rv2", &t, "claude");
    verdict(&h.o, &rb, "vb", "changes-requested").unwrap();
    exit(&h.o, &run, &b);
    // 늦게 끝난 옛 검토 A(옛 보고 대상)가 이제 pass 를 내도 새 보고의 판정을 덮지 않는다.
    let late = verdict(&h.o, &ra, "late2", "pass").unwrap();
    assert_eq!(late["state"], "stale");
    let rs = review_state(&h.o, &run, &t);
    assert_eq!(rs["state"], "changes-requested");
    assert_eq!(rs["attemptId"], b.as_str());
}

/// E2E 10-16 #7b — 끝난 `current` 판정도 그 보고가 더는 Task 의 현재 보고가 아니면(새 Attempt 의 보고) 보기에서 `stale` —
/// 보드(`run_detail`) · 조정자 `get_run` · `reviewState`(requireReview 관문) 가 같은 규칙. 현재 보고의 판정은 `current` 그대로.
#[test]
fn finished_verdict_on_replaced_report_reads_stale() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let (a, ra) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    let pass = verdict(&h.o, &ra, "v1", "pass").unwrap();
    assert_eq!(pass["state"], "current");
    exit(&h.o, &run, &a);
    let state_of = |v: &Value, id: &Value| {
        v["reviewReports"].as_array().unwrap().iter().find(|r| r["reviewId"] == *id).unwrap()["state"].clone()
    };
    assert_eq!(state_of(&detail(&h.o, &run), &pass["reviewId"]), "current", "현재 보고의 판정");
    // 반려 → 재작업 → 새 보고(현재 보고가 바뀐다).
    update(&h.o, &c, &run, "rej", &t, "rejected").unwrap();
    reported_worker(&h, &run, &c, "w2", &t);
    assert_eq!(state_of(&detail(&h.o, &run), &pass["reviewId"]), "stale", "보드 보기");
    let gr = call(&h.o, &c, "get_run", json!({})).unwrap();
    assert_eq!(state_of(&gr, &pass["reviewId"]), "stale", "조정자 get_run");
    assert_eq!(review_state(&h.o, &run, &t)["state"], "none", "관문 · 보드 표시도 옛 판정을 세지 않는다");
    // 저장값은 판정 그때의 기록 그대로(읽을 때 계산).
    let stored = h.o.lock().runs.get(&run).unwrap().run.review_reports[0].state;
    assert_eq!(stored, ReviewReportState::Current);
}

#[test]
fn review_invalidated_on_cancel_and_slot_freed_on_exit() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let (a, _) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    h.o.set_task_state(&run, &t, version(&h.o, &run, &t), TaskState::Cancelled).unwrap();
    assert!(task_view(&h.o, &run, &t)["review"]["active"].is_null());
    assert!(h.fake.stops.lock().unwrap().contains(&a));
    // 판정 없이 끝난 검토자는 자리를 놓는다(생성 실패도 같다).
    let t2 = task(&h.o, &c, "t2");
    reported_worker(&h, &run, &c, "w2", &t2);
    exit(&h.o, &run, &a);
    let v = call(&h.o, &c, "spawn_worker", json!({ "requestId": "rv2", "taskId": t2, "role": td::JUDGE })).unwrap();
    let b = v["attemptId"].as_str().unwrap().to_string();
    h.o.attempt_spawn_failed(&run, &b, "review-place: boom");
    assert!(task_view(&h.o, &run, &t2)["review"]["active"].is_null(), "생성 실패면 자리가 빈다");
    // 자리가 비었으니 다음 검토가 선다 — 조정자의 반려도 그것을 무효화한다.
    let (cc, _) = reviewer(&h, &run, &c, "rv3", &t2, "claude");
    update(&h.o, &c, &run, "rej2", &t2, "rejected").unwrap();
    assert!(h.fake.stops.lock().unwrap().contains(&cc));
}

#[test]
fn human_accept_invalidates_active_review_and_records_waiver() {
    let h = harness();
    let (run, c) = start(&h, true, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let (a, _) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    make_integrated(&h.o, &run);
    drain_audit(&h);
    // 사람 [수락] — 필수 검토를 넘는다: 활성 검토는 무효화, 면제를 기록.
    let v = h.o.human_review(&run, &t, version(&h.o, &run, &t), Decision::Accepted).unwrap();
    assert_eq!(v["job"]["reviewWaived"], true);
    // (3a) 면제는 규칙 단위(`waived[]` — 역할 · 필요 · 가진 수).
    assert_eq!(v["job"]["waived"][0]["rule"], "judgment");
    assert_eq!(v["job"]["waived"][0]["role"], td::JUDGE);
    assert_eq!((v["job"]["waived"][0]["need"].as_u64(), v["job"]["waived"][0]["have"].as_u64()), (Some(1), Some(0)));
    assert!(h.fake.stops.lock().unwrap().contains(&a));
    assert!(task_view(&h.o, &run, &t)["review"]["active"].is_null());
    let evs: Vec<String> = drain_audit(&h).into_iter().map(|r| r.event).collect();
    assert!(evs.contains(&"accept_waived".to_string()), "{evs:?}");
}

// ---------------------------------------------------------------------------
// requireReview · 예산
// ---------------------------------------------------------------------------

#[test]
fn require_review_refuses_then_passes() {
    let h = harness();
    let (run, c) = start(&h, true, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    make_integrated(&h.o, &run);
    // (3a) 수락 규칙(맡기기) — 못 채우면 `accept-rule-unmet{unmet[], reviewsLeft, hint}`.
    assert_eq!(code(update(&h.o, &c, &run, "a1", &t, "accepted")), "accept-rule-unmet");
    let (a, ra) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    assert_eq!(code(update(&h.o, &c, &run, "a2", &t, "accepted")), "review-pending");
    verdict(&h.o, &ra, "v", "changes-requested").unwrap();
    let e = update(&h.o, &c, &run, "a3", &t, "accepted").unwrap_err();
    assert!(e.starts_with("accept-rule-unmet"), "{e}");
    assert!(e.contains("\"last\":\"changes-requested\""), "{e}");
    exit(&h.o, &run, &a);
    // 다른 판정형(Codex)의 pass 는 규칙(Claude 판정형)을 채우지 않는다.
    let (x, rx) = reviewer(&h, &run, &c, "rvx", &t, "codex");
    verdict(&h.o, &rx, "v", "pass").unwrap();
    exit(&h.o, &run, &x);
    assert_eq!(code(update(&h.o, &c, &run, "ax", &t, "accepted")), "accept-rule-unmet");
    // 같은 역할로 같은 보고를 다시 검토해 pass — 마지막 유효 판정이 이긴다.
    let (b, rb) = reviewer(&h, &run, &c, "rv2", &t, "claude");
    let pass = verdict(&h.o, &rb, "v", "pass").unwrap();
    exit(&h.o, &run, &b);
    let ok = update(&h.o, &c, &run, "a4", &t, "accepted").unwrap();
    assert_eq!(ok["accepting"], true);
    let d = detail(&h.o, &run);
    let job = d["jobs"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(job["reviewId"], pass["reviewId"]);
    assert!(job.get("reviewWaived").is_none());
}

#[test]
fn review_pending_blocks_coordinator_even_without_require_review() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    make_integrated(&h.o, &run);
    reviewer(&h, &run, &c, "rv1", &t, "claude");
    assert_eq!(code(update(&h.o, &c, &run, "a1", &t, "accepted")), "review-pending");
}

#[test]
fn review_budget_separate_from_workers_and_exhausts() {
    let h = harness();
    let limits = LimitsInput {
        max_reviews: Some(1),
        max_total_workers: Some(1),
        ..Default::default()
    }
    .resolve();
    assert_eq!(limits.max_reviews, 1);
    assert_eq!(LimitsInput { max_reviews: Some(99), ..Default::default() }.resolve().max_reviews, MAX_REVIEWS_CAP);
    let (run, c) = start(&h, true, limits);
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    // 작업자 총 한도(1)를 다 썼어도 검토는 선다.
    let (a, ra) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    verdict(&h.o, &ra, "v", "changes-requested").unwrap();
    exit(&h.o, &run, &a);
    assert_eq!(
        code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "rv2", "taskId": t, "role": td::JUDGE }))),
        "review-budget-exhausted"
    );
    assert_eq!(detail(&h.o, &run)["remaining"]["reviews"], 0);
    // 판정이 changes-requested 면 힌트는 되돌림이다. 판정을 무효화(옛 보고 대상)한 뒤엔 남은 판정 0 — 사람에게 알리라는 힌트.
    make_integrated(&h.o, &run);
    let e = update(&h.o, &c, &run, "a1", &t, "accepted").unwrap_err();
    assert!(e.starts_with("accept-rule-unmet") && e.contains("사람에게"), "{e}");
    h.o.lock().runs.get_mut(&run).unwrap().run.review_reports.clear();
    let e = update(&h.o, &c, &run, "a2", &t, "accepted").unwrap_err();
    assert!(e.starts_with("accept-rule-unmet") && e.contains("\"reviewsLeft\":0") && e.contains("사람에게"), "{e}");
}

// ---------------------------------------------------------------------------
// 역할 도구
// ---------------------------------------------------------------------------

#[test]
fn reviewer_and_worker_tools_are_separate() {
    let h = harness();
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    let (_, w) = reported_worker(&h, &run, &c, "w1", &t);
    let (_, r) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    for (name, args) in [
        ("commit_changes", json!({ "requestId": "c", "message": "m", "selection": "all" })),
        ("report_done", json!({ "requestId": "d", "outcome": "success", "summary": "s" })),
        ("spawn_worker", json!({ "requestId": "s", "taskId": t, "role": td::WRITER })),
        ("get_run", json!({})),
    ] {
        assert!(!crate::orchestration::is_tool_for(&r, name), "검토자 목록에 {name} 없음");
        let e = call(&h.o, &r, name, args).expect_err("검토자는 못 부른다");
        assert!(e.contains("Unknown tool"), "{name}: {e}");
    }
    assert!(!crate::orchestration::is_tool_for(&w, "report_review"));
    let e = verdict(&h.o, &w, "x", "pass").expect_err("작업자는 판정 못 한다");
    assert!(e.contains("Unknown tool"));
    assert!(!crate::orchestration::is_tool_for(&c, "report_review"), "조정자도 판정 못 한다");
    // 도구 목록 = 미리 허용 목록 = 스키마 이름.
    let names: Vec<String> = crate::orchestration::reviewer_tool_schemas()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, super::tools::REVIEWER_TOOLS);
    assert_eq!(super::tools::REVIEWER_TOOLS, REVIEWER_ALLOWED_TOOLS);
    // 찾은 것 상한.
    let too_many: Vec<String> = (0..=REVIEW_FINDINGS_MAX).map(|i| format!("f{i}")).collect();
    let e = call(&h.o, &r, "report_review", json!({ "requestId": "m", "verdict": "pass", "summary": "s", "findings": too_many }));
    assert_eq!(code(e), "invalid-argument");
    let long = "x".repeat(REVIEW_FINDING_CHARS + 1);
    let e = call(&h.o, &r, "report_review", json!({ "requestId": "l", "verdict": "pass", "summary": "s", "findings": [long] }));
    assert_eq!(code(e), "invalid-argument");
    assert_eq!(code(call(&h.o, &r, "report_review", json!({ "requestId": "b", "verdict": "maybe", "summary": "s" }))), "invalid-argument");
}

#[test]
fn old_files_read_attempts_as_workers_and_empty_review_slot() {
    let a: Attempt = serde_json::from_value(json!({
        "id": "att-1", "taskId": "task-1", "cli": "claude", "gen": 1, "state": "exited", "startedAt": 0
    }))
    .unwrap();
    assert_eq!(a.role, AttemptRole::Worker);
    assert!(a.review_of.is_none());
    let t: Task = serde_json::from_value(json!({
        "id": "task-1", "title": "T", "goal": "g", "version": 1, "state": "todo", "createdAt": 0, "updatedAt": 0
    }))
    .unwrap();
    assert_eq!(t.review, ReviewSlot::default());
    let l: Limits = serde_json::from_value(json!({
        "maxTasks": 50, "maxCallsPerMinute": 60, "maxWaiters": 2, "coordinationMinutes": 120, "executionGraceMinutes": 30,
        "maxConcurrentWorkers": 3, "maxTotalWorkers": 8, "maxDeliveries": 200
    }))
    .unwrap();
    assert_eq!(l.max_reviews, DEFAULT_MAX_REVIEWS);
}

// ---------------------------------------------------------------------------
// 고정 인자
// ---------------------------------------------------------------------------

/// 작업자와 같은 Codex 실행 환경 덧붙임(시험 값 — 실제도 `codex_launch::codex_extra_args`).
fn codex_extra() -> Vec<String> {
    crate::codex_launch::codex_extra_args(Some(&crate::codex_launch::CodexLaunchEnv {
        filtered_path: "C:/bin".into(),
        original_path: "C:/bin;C:/store".into(),
    }))
}

/// 헤드리스 검토자(3차 2단계)의 인자 — 서버 손(`server::workers::launch_reviewer`)과 같은 재료로 `turn::turn_argv` 의 판정형 줄.
fn argv_of(cli: WorkerCli) -> Vec<String> {
    argv_with(cli, &[], Some("C:/data/orchestration/run-1/turns/att-1-t1.md"))
}

fn argv_with(cli: WorkerCli, model_args: &[String], append: Option<&str>) -> Vec<String> {
    let extra = codex_extra();
    super::turn::turn_argv(&super::turn::TurnArgs {
        cli,
        exe: "C:/bin/x.exe",
        grade: super::turn::Grade::ReadOnly,
        resume: None,
        session_id: Some("11111111-2222-4333-8444-555555555555"),
        mcp_name: "aynx-sessions-dev",
        mcp_tools: REVIEWER_ALLOWED_TOOLS,
        mcp_config: (cli == WorkerCli::Claude).then_some("C:/data/agent-mcp/orch-att-1.json"),
        mcp_url: "http://127.0.0.1:5555/mcp",
        token_env: "AYNX_MCP_TOKEN",
        allowed_commands: &[],
        read_rule: None,
        add_dir: Some("C:/wt/orch-aaaaaaaa-bbbbbbbb-rv"),
        cwd: Some("C:/data/orchestration/run-1/review-bbbbbbbb"),
        codex_extra: &extra,
        model_args,
        append_file: if cli == WorkerCli::Claude { append } else { None },
        developer_instructions: None,
        prompt: "[AYNX · reviewer att-1 · Task task-1]\nreview",
    })
}

#[test]
fn reviewer_argv_fixed_claude() {
    let expected: Vec<&str> = vec![
        "C:/bin/x.exe",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--session-id",
        "11111111-2222-4333-8444-555555555555",
        // 설정 출처 통제 B(2-3a — 사용자 · 프로젝트 설정 · 훅 · 플러그인이 안 실린다) + 읽기 도구만.
        "--setting-sources",
        "",
        "--tools",
        "Read,Grep,Glob",
        "--settings",
        "{\"permissions\":{\"allow\":[]},\"disableAllHooks\":true}",
        "--permission-prompts",
        "none",
        "--append-system-prompt-file",
        "C:/data/orchestration/run-1/turns/att-1-t1.md",
        "--mcp-config",
        "C:/data/agent-mcp/orch-att-1.json",
        "--strict-mcp-config",
        "--add-dir",
        "C:/wt/orch-aaaaaaaa-bbbbbbbb-rv",
        "--allowedTools",
        "mcp__aynx-sessions-dev__get_task",
        "mcp__aynx-sessions-dev__get_diff",
        "mcp__aynx-sessions-dev__report_review",
        "--",
        "[AYNX · reviewer att-1 · Task task-1]\nreview",
    ];
    assert_eq!(argv_of(WorkerCli::Claude), expected);
}

#[test]
fn reviewer_argv_fixed_codex() {
    let extra = codex_extra();
    let mut expected: Vec<&str> = vec![
        "C:/bin/x.exe",
        "-a",
        "never",
        "exec",
        "--json",
        "-s",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "--skip-git-repo-check",
        "-c",
        "features.prefer_mxc=true",
        "-c",
        "suppress_unstable_features_warning=true",
        "-c",
        "shell_environment_policy.set.Path='C:/bin;C:/store'",
    ];
    // 작업자 길(`spawn::worker_argv` 의 codex_extra)과 같은 덧붙임이다.
    let shared: Vec<&str> = extra.iter().map(String::as_str).collect();
    assert_eq!(&expected[14..], shared.as_slice());
    expected.extend([
        "-c",
        "mcp_servers.aynx-sessions-dev.url='http://127.0.0.1:5555/mcp'",
        "-c",
        "mcp_servers.aynx-sessions-dev.bearer_token_env_var='AYNX_MCP_TOKEN'",
        "-c",
        "mcp_servers.aynx-sessions-dev.tools.get_task.approval_mode='approve'",
        "-c",
        "mcp_servers.aynx-sessions-dev.tools.get_diff.approval_mode='approve'",
        "-c",
        "mcp_servers.aynx-sessions-dev.tools.report_review.approval_mode='approve'",
        "-C",
        "C:/data/orchestration/run-1/review-bbbbbbbb",
        "--",
        "[AYNX · reviewer att-1 · Task task-1]\nreview",
    ]);
    assert_eq!(argv_of(WorkerCli::Codex), expected);
}

/// 사람이 고른 작업자 권한 모드와 무관하다 — 권한 · 우회 · **쓰기 도구** 낱말이 없다(헤드리스 설계 4-7 `judge_kind_is_read_only_whatever_permission`
/// 의 인자 몫 — 입력에 권한 칸이 아예 없고 등급은 늘 `read-only`). 역할 모델 · 강도 낱말이 붙어도 그대로다.
#[test]
fn reviewer_argv_has_no_permission_or_write_flags() {
    let model = crate::orchestration::spawn::role_model_args(WorkerCli::Claude, Some("sonnet"), Some("high"), (None, None));
    for cli in [WorkerCli::Claude, WorkerCli::Codex] {
        for a in [argv_of(cli), argv_with(cli, &model, None)] {
            let joined = a.join(" ");
            // 샌드박스 백엔드를 unelevated 로 고정하지 않는다(스토어판 pwsh 0xC0000142 — 작업자와 같은 실행 환경을 쓴다).
            for bad in [
                "--permission-mode",
                "bypass",
                "dangerously",
                "workspace-write",
                "acceptEdits",
                "on-request",
                "windows.sandbox",
                "network_access",
                "--restricted",
            ] {
                assert!(!joined.contains(bad), "{cli:?}: {bad}");
            }
            // 내장 도구는 읽기 셋뿐 — Edit · Write · Bash · PowerShell · NotebookEdit 이 인자 어디에도 없다.
            if cli == WorkerCli::Claude {
                let tools = &a[a.iter().position(|x| x == "--tools").unwrap() + 1];
                assert_eq!(tools, "Read,Grep,Glob");
                for w in ["Edit", "Write", "Bash", "PowerShell", "NotebookEdit"] {
                    assert!(!a.iter().any(|x| x.split(',').any(|t| t == w)), "{w}");
                }
            }
        }
    }
    let p = reviewer_prompt("att-1", "task-1", HEAD1, Some(BASE), "C:\\wt\\x-rv");
    assert!(p.starts_with('['), "머리줄");
    assert!(p.contains(HEAD1) && p.contains(BASE) && p.contains("C:/wt/x-rv"));
    // 헤드리스 실패 지침(3-6 · D14) — 검토자에게는 report_done 이 없다.
    assert!(p.contains("never end without report_review") && !p.contains("report_done"));
}

/// 검토자는 **비대화형 헤드리스 턴**이다: Claude `-p --output-format stream-json --verbose`(대화 기록은 남긴다 — `--no-session-persistence`
/// 없음), Codex `-a never` → `exec` → `--json` → exec 옵션(`--ignore-user-config` 는 `exec` **뒤**) · `--no-daemon` 없음.
#[test]
fn reviewer_argv_is_non_interactive() {
    let c = argv_of(WorkerCli::Claude);
    assert_eq!(c[1], "-p", "Claude 는 -p 로");
    assert_eq!(&c[2..5], ["--output-format", "stream-json", "--verbose"]);
    assert!(!c.iter().any(|x| x == "--no-session-persistence"), "대화 기록 남김");
    let pos = |a: &[String], w: &str| a.iter().position(|x| x == w).unwrap_or_else(|| panic!("{w} 없음"));
    let x = argv_of(WorkerCli::Codex);
    assert!(!x.iter().any(|w| w == "--no-daemon"), "--no-daemon 은 대화형 옵션");
    let (a, exec) = (pos(&x, "-a"), pos(&x, "exec"));
    assert!(a < exec, "-a 는 exec 앞");
    for w in ["--json", "-s", "--ignore-user-config", "--ignore-rules", "--disable", "--skip-git-repo-check", "-C"] {
        assert!(pos(&x, w) > exec, "{w} 는 exec 뒤");
    }
    assert!(pos(&x, "--") > pos(&x, "-C"));
    assert!(reviewer_args_label(WorkerCli::Claude).starts_with("claude -p --output-format stream-json "));
    assert!(reviewer_args_label(WorkerCli::Codex).starts_with("codex -a never exec --json -s read-only --ignore-user-config"));
}

// ---------------------------------------------------------------------------
// 진짜 git — 고정 대상 diff · 검토 자리 · symlink 밖
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage5-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn git_env(dir: &Path, args: &[&str], env: &[(&str, &str)], stdin: Option<&[u8]>) -> String {
    use std::io::Write;
    let mut cmd = Command::new("git");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("GIT_") {
            cmd.env_remove(k);
        }
    }
    cmd.arg("-C").arg(dir).args(args).envs(env.iter().copied());
    cmd.stdin(if stdin.is_some() { std::process::Stdio::piped() } else { std::process::Stdio::null() })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().expect("git");
    if let Some(b) = stdin {
        child.stdin.take().unwrap().write_all(b).unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn git(dir: &Path, args: &[&str]) -> String {
    git_env(dir, args, &[], None)
}

/// 저장소 — 첫 커밋(a.txt) · 둘째 커밋(a.txt 고침 + `extra` 의 (모드, 경로, 내용) 항목들 — 배관 명령). `(저장소, base, commit)`.
fn repo_with(extra: &[(&str, &str, &[u8])]) -> (PathBuf, String, String) {
    let d = scratch("repo").join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Five"]);
    git(&d, &["config", "user.email", "stage5@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("a.txt"), "one\ntwo\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    let base = git(&d, &["rev-parse", "HEAD"]);
    let idx = scratch("idx").join("index");
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    git_env(&d, &["read-tree", &base], &env, None);
    let mut files: Vec<(&str, &str, &[u8])> = vec![("100644", "a.txt", &b"one\nTWO\n"[..])];
    files.extend_from_slice(extra);
    for (mode, path, body) in files {
        let blob = git_env(&d, &["hash-object", "-w", "--stdin"], &env, Some(body));
        let info = format!("{mode},{blob},{path}");
        git_env(&d, &["update-index", "--add", "--cacheinfo", &info], &env, None);
    }
    let tree = git_env(&d, &["write-tree"], &env, None);
    let commit = git(&d, &["commit-tree", &tree, "-p", &base, "-m", "change"]);
    (d, base, commit)
}

/// 검토자의 `get_diff` 는 **고정 대상**(보고의 base … commit)만 — 인자로 다른 Task · 보고를 줘도 바꾸지 못한다.
#[test]
fn reviewer_diff_reads_only_the_fixed_target() {
    let h = harness();
    let (repo, base, commit) = repo_with(&[]);
    let (run, c) = start(&h, false, Limits::default());
    let t = task(&h.o, &c, "t");
    reported_worker(&h, &run, &c, "w1", &t);
    let (_, r) = reviewer(&h, &run, &c, "rv1", &t, "claude");
    {
        // 저장소 · 보고 OID 를 진짜 것으로(가짜 손이 적은 칸을 바꾼다).
        let mut g = h.o.lock();
        let slot = g.runs.get_mut(&run).unwrap();
        slot.run.repo = repo.display().to_string();
        for rep in slot.run.reports.iter_mut() {
            rep.base_commit_oid = Some(base.clone());
            rep.commit_oid = Some(commit.clone());
        }
    }
    let list = call(&h.o, &r, "get_diff", json!({ "taskId": "task-other", "reportId": "rep-other" })).unwrap();
    assert_eq!(list["base"], base.as_str());
    assert_eq!(list["commit"], commit.as_str());
    assert_eq!(list["files"][0]["path"], "a.txt");
    let p = call(&h.o, &r, "get_diff", json!({ "path": "a.txt" })).unwrap();
    assert!(p["patch"].as_str().unwrap().contains("+TWO"));
}

#[test]
fn review_place_is_detached_read_place_with_empty_cwd() {
    let (repo, _, commit) = repo_with(&[]);
    let wt = repo.parent().unwrap().join("wt");
    let data = repo.parent().unwrap().join("data");
    let (place, cwd) = super::review::place_blocking(
        &repo,
        &wt.display().to_string(),
        &data,
        "run-x",
        "task-aaaaaaaa1111",
        "att-bbbbbbbb2222",
        &commit,
        None,
    )
    .unwrap();
    assert!(place.ends_with("orch-aaaaaaaa-bbbbbbbb-rv"), "{place}");
    let head = git(Path::new(&place), &["rev-parse", "HEAD"]);
    assert_eq!(head, commit);
    let sym = Command::new("git").arg("-C").arg(&place).args(["symbolic-ref", "-q", "HEAD"]).output().unwrap();
    assert!(!sym.status.success(), "분리 HEAD — 브랜치가 없다");
    assert_eq!(std::fs::read_dir(&cwd).unwrap().count(), 0, "빈 cwd");
    assert!(!Path::new(&cwd).starts_with(&wt), "cwd 는 저장소 자리가 아닌 서버 폴더");
    assert!(super::review::check_links_blocking(Path::new(&place)).is_ok());
    // 같은 자리를 두 번 만들지 않는다.
    assert!(super::review::place_blocking(&repo, &wt.display().to_string(), &data, "run-x", "task-aaaaaaaa1111", "att-bbbbbbbb2222", &commit, None).is_err());
}

/// 9절 위험 5 확정 — 검토 자리의 추적 symlink 대상이 자리 밖이면 거절(`symlink-outside`), 안이면 그대로.
#[test]
fn review_place_refuses_symlink_outside() {
    let (repo, _, commit) = repo_with(&[("120000", "inside", &b"a.txt"[..]), ("120000", "out", &b"../../outside/x"[..])]);
    let wt = repo.parent().unwrap().join("wt");
    let data = repo.parent().unwrap().join("data");
    let (place, _) = super::review::place_blocking(&repo, &wt.display().to_string(), &data, "run-x", "task-cccccccc", "att-dddddddd", &commit, None).unwrap();
    let real_link = std::fs::symlink_metadata(Path::new(&place).join("out")).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    let r = super::review::check_links_blocking(Path::new(&place));
    if real_link {
        assert_eq!(r.unwrap_err().code, "symlink-outside");
    } else {
        // core.symlinks=false 인 PC — 대상 글자를 담은 보통 파일이라 따라갈 링크가 없다.
        assert!(r.is_ok());
    }
    // 안쪽만 가리키는 링크는 통과.
    let (repo2, _, commit2) = repo_with(&[("120000", "inside", &b"a.txt"[..])]);
    let wt2 = repo2.parent().unwrap().join("wt");
    let (place2, _) =
        super::review::place_blocking(&repo2, &wt2.display().to_string(), &repo2.parent().unwrap().join("data"), "run-x", "task-e", "att-f", &commit2, None)
            .unwrap();
    assert!(super::review::check_links_blocking(Path::new(&place2)).is_ok());
}

/// 리뷰 F2 — 꺼낼 트리 전체에 필터 속성이 걸리면(이번 커밋이 건드리지 않은 필터 파일 포함) 검토 자리 checkout · 해결 seed restore 전에
/// 거절하고 smudge 가 돌지 않는다.
#[test]
fn review_place_and_resolve_seed_refuse_filtered_tree() {
    let (repo, base, c1) = repo_with(&[("100644", ".gitattributes", &b"*.bin filter=x\n"[..]), ("100644", "a.bin", &b"data\n"[..])]);
    let marker = repo.parent().unwrap().join("smudge-ran");
    let m = marker.to_string_lossy().replace('\\', "/");
    git(&repo, &["config", "filter.x.smudge", &format!("echo ran >> '{m}'; cat")]);
    git(&repo, &["config", "filter.x.clean", "cat"]);
    // 필터 파일을 건드리지 않은 다음 커밋(같은 트리).
    let tree = git(&repo, &["rev-parse", &format!("{c1}^{{tree}}")]);
    let c2 = git(&repo, &["commit-tree", &tree, "-p", &c1, "-m", "unchanged"]);
    let wt = repo.parent().unwrap().join("wt");
    let data = repo.parent().unwrap().join("data");
    let e = super::review::place_blocking(&repo, &wt.display().to_string(), &data, "run-x", "task-99999999", "att-88888888", &c2, None)
        .unwrap_err();
    assert_eq!(e.code, reason::FILTERS_CONFIGURED);
    assert!(!wt.join("orch-99999999-88888888-rv").exists(), "자리를 만들지 않았다");
    // 해결 seed — 작업 폴더(= 저장소, HEAD = base)에 c2 를 되살리기 전에 거절.
    let e = super::resolve::seed_blocking(&repo, &base, &c2).unwrap_err();
    assert_eq!(e.code, reason::FILTERS_CONFIGURED);
    assert!(!repo.join("a.bin").exists());
    assert!(!marker.exists(), "smudge 필터가 돌면 안 된다");
}
