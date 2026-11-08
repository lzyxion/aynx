//! 통합 설계 6단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 6-2 · 6-3 · 8절 정리 · 10절 6단계 행) — **정리**.
//!
//! - 끝에서 끝: 가짜 작업자 셋(깨끗 · 충돌 · 검증 실패 — 진짜 worktree · 진짜 git · 진짜 `cmd.exe` 검증) → 통합 하나 · 충돌 하나 · 검증
//!   실패 하나 → ref 회수(candidate · conflict) → [Run 완료](서버 임시 자리 폐기) → [정리](통합된 worktree 기본 체크 · 미커밋 거절 ·
//!   브랜치 남김 · 보존 ref 기본 남김 · 통합 ref 는 내보낸 브랜치가 품을 때만).
//! - 예상 밖 변경은 지우지 않고 남긴다(`cleanup-pending` 알림 · 보류 표시) → [그래도 지우기].
//! - 재시작 뒤 재정리(orphaned) — Run 장부에 없는 자리(곁 파일 `role` · 서버 데이터의 빈 cwd)까지. 남긴 자리가 있으면 [보관] 거절.
//! - 정션 있는 자리 정리 — 정션 대상의 파일은 무사(링크만 먼저 걷는다 — 10-15 노트 저장소 사고와 같은 원리).
//!
//! 작업자는 띄우지 않는다 — "작업자가 보고함" 은 시험이 worktree 에서 커밋하고 Attempt · Report 를 장부에 적는다(3 · 4단계 시험과 같은 틀).
//! 검증을 도는 시험은 4단계 시험의 한 줄(`SERIAL`)을 함께 쓴다(서버 전체 동시 검증 2 · 손자 정리 확인이 섞이지 않게).

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::integrate::*;
use super::model::*;
use super::spawn::{Base, LaunchJob, WorkerLauncher};
use super::store::*;
use super::verify::*;
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 진짜 git
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage6-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub(super) fn git_out(dir: &Path, args: &[&str]) -> (i32, String) {
    let mut cmd = Command::new("git");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("GIT_") {
            cmd.env_remove(k);
        }
    }
    let out = cmd.arg("-C").arg(dir).args(args).output().expect("git");
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub(super) fn git(dir: &Path, args: &[&str]) -> String {
    let (code, out) = git_out(dir, args);
    assert_eq!(code, 0, "git {args:?} failed: {out}");
    out
}

pub(super) fn rev(repo: &Path, name: &str) -> Option<String> {
    let (c, o) = git_out(repo, &["rev-parse", "--verify", "--quiet", name]);
    (c == 0).then_some(o)
}

/// 저장소 하나 — `f.txt`(세 줄) · `.gitignore`(`node_modules/`) 첫 커밋.
fn repo(root: &Path) -> PathBuf {
    let d = root.join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Six"]);
    git(&d, &["config", "user.email", "stage6@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("f.txt"), "one\ntwo\nthree\n").unwrap();
    std::fs::write(d.join(".gitignore"), "node_modules/\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

/// 정션 하나(`mklink /J` — 관리자 권한 없이 선다).
fn junction(link: &Path, target: &Path) {
    let out = Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .expect("mklink");
    assert!(out.status.success(), "mklink /J failed: {}", String::from_utf8_lossy(&out.stderr));
}

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

struct Launcher;

impl WorkerLauncher for Launcher {
    fn launch(&self, _job: LaunchJob) {}
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

pub(super) struct H {
    pub(super) o: Arc<Orchestration>,
    pub(super) root: PathBuf,
    pub(super) repo: PathBuf,
    pub(super) side: PathBuf,
    pub(super) data: PathBuf,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

impl H {
    pub(super) fn wt_dir(&self) -> PathBuf {
        self.root.join("wt")
    }
}

/// 영속(임시 폴더) · 곁 파일(임시 파일)을 쓰는 저장소 — 재시작 시험이 같은 폴더로 다시 세운다.
pub(super) fn orch_at(data: &Path, side: &Path) -> (Arc<Orchestration>, mpsc::Receiver<AuditRecord>) {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(Some(data.to_path_buf()), emit, Some(tx), Arc::new(crate::operations::now_ms)));
    o.set_integrator(Arc::new(GitRefs));
    o.set_launcher(Arc::new(Launcher));
    o.set_sidecar(Some(side.to_path_buf()));
    super::test_album::delegate_all(&o);
    (o, rx)
}

pub(super) fn harness(tag: &str) -> H {
    let root = scratch(tag);
    let repo = repo(&root);
    let side = root.join("worktrees.json");
    let data = root.join("data");
    std::fs::create_dir_all(&data).unwrap();
    let (o, rx) = orch_at(&data, &side);
    H { o, root, repo, side, data, audit: Mutex::new(rx) }
}

pub(super) fn start(h: &H, cmd: Option<&str>, keep: &[&str]) -> (String, Caller) {
    let verify = cmd.map(|c| {
        let i = VerifyInput {
            command: c.into(),
            auto_run: true,
            keep_dirs: keep.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        validate_input(i, true).unwrap().unwrap()
    });
    // 무인 검증(자동 실행)은 지금 맡기기의 검증 명령과 같아야 선다(3a — 2-4 · D5).
    let b = super::test_album::block("C:/repo", super::test_album::default_roles(), Vec::new(), cmd);
    super::test_album::delegate_with(&h.o, super::test_album::active(b));
    let s = StartRun {
        verify,
        name: "stage6".into(),
        repo: h.repo.display().to_string(),
        worktree_dir: h.wt_dir().display().to_string(),
        limits: Limits::default(),
    };
    let run = h.o.start_integrated_run(s).unwrap().0;
    let c = h.o.coordinator_caller(&run).unwrap();
    (run, c)
}

pub(super) fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

pub(super) fn create_task(o: &Orchestration, c: &Caller, req: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": req, "goal": "g" })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

pub(super) fn run_of(o: &Orchestration, run: &str) -> Run {
    o.lock().runs.get(run).unwrap().run.clone()
}

fn task_of(o: &Orchestration, run: &str, task: &str) -> Task {
    run_of(o, run).task(task).unwrap().clone()
}

pub(super) fn head(o: &Orchestration, run: &str) -> String {
    run_of(o, run).integration.unwrap().expected_head
}

pub(super) fn accept(o: &Orchestration, c: &Caller, run: &str, task: &str, req: &str) {
    let v = task_of(o, run, task).version;
    call(o, c, "update_task", json!({ "requestId": req, "taskId": task, "version": v, "state": "accepted" })).unwrap();
}

/// **가짜 작업자 하나** — Run 의 worktree op 층으로 진짜 worktree 를 `base` 에서 만들고(곁 파일 `run` 칸), 파일을 써 커밋한 뒤 성공 보고를
/// 장부에 적는다(프로세스는 이미 끝남). worktree 경로.
pub(super) fn fake_worker(h: &H, run: &str, task: &str, name: &str, base: &str, files: &[(&str, &str)]) -> String {
    let created = super::worktree::create_blocking(
        &h.repo,
        &h.wt_dir().display().to_string(),
        name,
        &Base::Commit(base.to_string()),
        run,
        Some(&h.side),
        &super::worktree::empty_hooks_dir(),
    )
    .unwrap();
    let wt = PathBuf::from(&created.path);
    for (p, body) in files {
        std::fs::write(wt.join(p), body).unwrap();
    }
    git(&wt, &["add", "-A"]);
    git(&wt, &["commit", "-qm", name]);
    let commit = git(&wt, &["rev-parse", "HEAD"]);
    let att = new_id("att").unwrap();
    let mut g = h.o.lock();
    let slot = g.runs.get_mut(run).unwrap();
    let gen = slot.run.gen;
    slot.run.attempts.push(Attempt {
        id: att.clone(),
        task_id: task.into(),
        cli: WorkerCli::Claude,
        gen,
        state: AttemptState::Exited,
        stream: None,
        worktree: Some(created.path.clone()),
        branch: Some(created.branch.clone()),
        base_commit: Some(base.into()),
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
        summary: format!("did {name}"),
        notes: None,
        commit_oid: Some(commit),
        base_commit_oid: Some(base.into()),
        dirty: false,
        changed_files: vec![],
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
    created.path
}

fn verify_dir(h: &H, run: &str) -> PathBuf {
    h.wt_dir().join(place_names(run).0)
}

fn temp_dir(h: &H, run: &str) -> PathBuf {
    h.wt_dir().join(place_names(run).1)
}

fn sidecar_roles(h: &H, run: &str) -> Vec<(String, String)> {
    crate::worktree::server_places_of(&crate::worktree::load_sidecar(&h.side), run)
}

pub(super) fn audit_events(h: &H) -> Vec<(String, Value)> {
    let rx = h.audit.lock().unwrap();
    let mut out = Vec::new();
    while let Ok(r) = rx.try_recv() {
        let v = serde_json::to_value(&r).unwrap();
        out.push((v["event"].as_str().unwrap_or_default().to_string(), v));
    }
    out
}

/// 한 Task 를 통과 검증으로 통합해 둔다(검증 자리가 생기고 쉬는 상태로 남는다).
pub(super) fn one_integrated(h: &H, run: &str, c: &Caller, name: &str) -> String {
    let t = create_task(&h.o, c, name);
    let base = head(&h.o, run);
    fake_worker(h, run, &t, name, &base, &[(&format!("{name}.txt"), "x\n")]);
    accept(&h.o, c, run, &t, &format!("acc-{name}"));
    assert_eq!(task_of(&h.o, run, &t).state, TaskState::Accepted);
    t
}

pub(super) fn stop_settled(h: &H, run: &str) {
    h.o.stop(run).unwrap();
    assert_eq!(run_of(&h.o, run).state, RunState::Stopped);
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

/// 10절 6단계 검증 칸 — 끝에서 끝(가짜 작업자 셋: 깨끗 · 충돌 · 검증 실패).
#[test]
fn end_to_end_three_fake_workers_then_cleanup() {
    let _g = super::tests_stage4::serial();
    let h = harness("e2e");
    let (run, c) = start(&h, Some("if exist bad.txt (exit 7) else (exit 0)"), &[]);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "clean");
    let b = create_task(&h.o, &c, "conflict");
    let d = create_task(&h.o, &c, "verifyfail");
    // 깨끗 — 첫 줄을 바꾸고 새 파일.
    let wa = fake_worker(&h, &run, &a, "orch-a", &base, &[("f.txt", "ONE\ntwo\nthree\n"), ("a.txt", "a\n")]);
    // 충돌 — 같은 첫 줄을 다르게(같은 기준에서).
    let wb = fake_worker(&h, &run, &b, "orch-b", &base, &[("f.txt", "UNO\ntwo\nthree\n")]);
    accept(&h.o, &c, &run, &a, "acc-a");
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
    let h1 = head(&h.o, &run);
    assert_eq!(rev(&h.repo, &refs::int(&run)).as_deref(), Some(h1.as_str()));
    accept(&h.o, &c, &run, &b, "acc-b");
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Conflict);
    assert!(rev(&h.repo, &refs::conflict(&refs::new_base(&run), &b)).is_some(), "충돌 트리를 붙잡는다");
    // 검증 실패 — 통합 머리에서 갈라져 깨끗이 합쳐지지만 검증이 끝 코드 7.
    let wd = fake_worker(&h, &run, &d, "orch-d", &h1, &[("bad.txt", "bad\n")]);
    accept(&h.o, &c, &run, &d, "acc-d");
    assert_eq!(task_of(&h.o, &run, &d).state, TaskState::Reported, "검증 실패 → 수락 안 됨");
    let failed = run_of(&h.o, &run).jobs.last().unwrap().clone();
    assert_eq!(failed.verify.as_ref().unwrap().exit_code, Some(7));
    assert_eq!(head(&h.o, &run), h1);
    // 거둔 Job 의 후보 ref 는 아직 있다 → 서버 시계의 ref 회수가 지운다(진행 중 Job 없음).
    assert_eq!(rev(&h.repo, &refs::candidate(&refs::new_base(&run), &failed.job_id)), failed.candidate);
    h.o.tick();
    assert_eq!(rev(&h.repo, &refs::candidate(&refs::new_base(&run), &failed.job_id)), None, "거둔 Job 의 candidate 회수");
    assert!(rev(&h.repo, &refs::conflict(&refs::new_base(&run), &b)).is_some(), "충돌 미해결 Task 의 conflict ref 는 남는다");
    // 검증 자리는 쉬는 상태(마지막 후보 · 깨끗)로 남아 있다 · 곁 파일 `role: verify`.
    let vdir = verify_dir(&h, &run);
    assert_eq!(git(&vdir, &["rev-parse", "HEAD"]), failed.candidate.clone().unwrap());
    assert_eq!(git(&vdir, &["status", "--porcelain", "--ignored"]), "");
    assert!(sidecar_roles(&h, &run).iter().any(|(_, r)| r == "verify"));
    // 사람이 충돌 · 실패 Task 를 취소 → conflict ref 회수.
    for t in [&b, &d] {
        let v = task_of(&h.o, &run, t).version;
        h.o.set_task_state(&run, t, v, TaskState::Cancelled).unwrap();
    }
    h.o.tick();
    assert_eq!(rev(&h.repo, &refs::conflict(&refs::new_base(&run), &b)), None, "종결된 Task 의 conflict ref 회수");
    // 보존 ref · 완료 증거는 서버 시계로 지우지 않는다(R13).
    let art = run_of(&h.o, &run).valid_artifact(&a).unwrap().clone();
    assert!(rev(&h.repo, &refs::accepted(&refs::new_base(&run), &a)).is_some());
    assert!(rev(&h.repo, &refs::done(&refs::new_base(&run), art.job_id.as_deref().unwrap())).is_some());
    // 살아 있는 Run 의 [정리] 는 거절.
    assert_eq!(h.o.cleanup_preview(&run).unwrap_err().code, reason::NOT_CLEANABLE);
    // [Run 완료] → 내보내기 → 서버 임시 자리 폐기(검증 자리 · 검증 임시).
    let done = h.o.complete_run(&run).unwrap();
    assert_eq!(done["state"], "done");
    // 칸 이름이 범위를 말한다(3차 6단계 — 서버 임시 자리만 · 작업자 worktree 는 남는다).
    assert_eq!(done["serverTemp"]["removed"], 2, "{done}");
    assert_eq!(done["workerWorktrees"], "kept", "{done}");
    assert!(done.get("cleanup").is_none(), "옛 칸 이름은 걷었다");
    assert!(!vdir.exists() && !temp_dir(&h, &run).exists());
    assert!(sidecar_roles(&h, &run).is_empty(), "곁 파일 줄도 걷는다");
    assert!(!git(&h.repo, &["worktree", "list", "--porcelain"]).contains("-verify"));
    assert!(run_of(&h.o, &run).temp_pending.is_empty());
    // [정리] 재료 — 통합된 worktree 만 기본 체크, 취소된 것은 해제, 미커밋이면 거절.
    std::fs::write(Path::new(&wd).join("scratch.txt"), "uncommitted").unwrap();
    let p = h.o.cleanup_preview(&run).unwrap();
    let row = |path: &str| p["worktrees"].as_array().unwrap().iter().find(|w| w["path"] == path).cloned().unwrap();
    assert_eq!(row(&wa)["defaultChecked"], true);
    assert_eq!(row(&wa)["integrated"], true);
    assert_eq!(row(&wb)["eligible"], true);
    assert_eq!(row(&wb)["defaultChecked"], false, "충돌 미해결 · 취소는 기본 해제");
    assert_eq!(row(&wd)["eligible"], false);
    assert_eq!(row(&wd)["blocker"], "dirty");
    let refs_view = p["refs"].as_array().unwrap().clone();
    let kinds: Vec<&str> = refs_view.iter().map(|r| r["kind"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"int") && kinds.contains(&"done") && kinds.contains(&"accepted"), "{kinds:?}");
    assert!(refs_view.iter().all(|r| r["defaultChecked"] == false), "보존 ref · 통합 ref 는 기본 남김");
    let int_row = refs_view.iter().find(|r| r["kind"] == "int").unwrap();
    assert_eq!(int_row["eligible"], true, "Run 완료가 내보낸 브랜치가 통합 머리를 품는다");
    // [정리] — A · B · D(미커밋) · 통합 ref.
    let export = run_of(&h.o, &run).integration.unwrap().export_branch;
    let r = h
        .o
        .cleanup_run(&run, &[wa.clone(), wb.clone(), wd.clone()], &[refs::int(&run)], false)
        .unwrap();
    assert_eq!(r["worktrees"].as_array().unwrap().len(), 2, "{r}");
    assert_eq!(r["refs"].as_array().unwrap().len(), 1);
    assert_eq!(r["failed"].as_array().unwrap().len(), 1);
    assert_eq!(r["failed"][0]["reason"], "dirty");
    assert!(!Path::new(&wa).exists() && !Path::new(&wb).exists());
    assert!(Path::new(&wd).join("scratch.txt").exists(), "미커밋 worktree 는 그대로");
    assert_eq!(rev(&h.repo, &refs::int(&run)), None);
    assert_eq!(rev(&h.repo, &format!("refs/heads/{export}")).as_deref(), Some(h1.as_str()), "내보낸 브랜치는 남는다");
    for b in ["orch-a", "orch-b", "orch-d"] {
        assert!(rev(&h.repo, &format!("refs/heads/{b}")).is_some(), "작업자 브랜치는 기본 남김 — {b}");
    }
    assert!(rev(&h.repo, &refs::accepted(&refs::new_base(&run), &a)).is_some(), "고르지 않은 보존 ref 는 남는다");
    let attempts = run_of(&h.o, &run).attempts;
    assert_eq!(attempts.iter().filter(|x| x.worktree.is_some()).count(), 1, "지운 worktree 는 장부에서도 빠진다");
    let ev = audit_events(&h);
    assert!(ev.iter().any(|(e, v)| e == "server_temp_cleaned" && v["orchestration"]["cleaned"] == 2));
    assert!(ev.iter().any(|(e, v)| e == "run_cleanup" && v["orchestration"]["cleaned"] == 3 && v["orchestration"]["kept"] == 1));
    assert!(ev.iter().any(|(e, _)| e == "refs_reclaimed"));
    assert!(!ev.iter().any(|(_, v)| v.to_string().contains(&wa)), "감사에 경로가 없다");
}

/// 예상 밖 변경은 지우지 않고 남긴다 — `tempPending` · 알림 `cleanup-pending` · 끝난 Run 의 보류 표시 → [그래도 지우기].
#[test]
fn server_temp_kept_on_unexpected_change_then_discarded() {
    let _g = super::tests_stage4::serial();
    let h = harness("kept");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run, &c, "one");
    let vdir = verify_dir(&h, &run);
    std::fs::write(vdir.join("stray.txt"), "someone wrote here").unwrap();
    stop_settled(&h, &run);
    h.o.tick();
    assert!(vdir.join("stray.txt").exists(), "예상 밖 변경 — 지우지 않는다");
    assert!(!temp_dir(&h, &run).exists(), "검증 임시는 비교 없이 지운다");
    let r = run_of(&h.o, &run);
    assert_eq!(r.temp_pending.len(), 1);
    assert_eq!(r.temp_pending[0].role, "verify");
    assert_eq!(r.temp_pending[0].why, "changed");
    assert_eq!(r.hold.as_ref().map(|x| x.reason), Some(HoldReason::CleanupPending), "끝난 Run 은 보류 표시만");
    assert_eq!(r.state, RunState::Stopped);
    assert!(h.o.notices_view().to_string().contains("cleanup-pending"));
    let view = h.o.run_detail(&run).unwrap();
    assert_eq!(view["tempPending"][0]["why"], "changed");
    assert_eq!(view["cleanable"], true);
    // 다시 돌아도 그대로(새 알림 없음 — 같은 자리).
    assert_eq!(h.o.sweep_temps(&run).kept, 1);
    // 목록 밖 경로는 [그래도 지우기] 대상이 아니다.
    assert_eq!(h.o.discard_temp(&run, &h.repo.display().to_string()).unwrap_err().code, reason::NOT_CLEANABLE);
    let v = h.o.discard_temp(&run, &vdir.display().to_string()).unwrap();
    assert_eq!(v["removed"], true);
    assert!(!vdir.exists());
    let r = run_of(&h.o, &run);
    assert!(r.temp_pending.is_empty());
    assert!(r.hold.is_none(), "남긴 것이 없으면 보류 표시도 걷는다");
    assert!(sidecar_roles(&h, &run).is_empty());
    assert!(audit_events(&h).iter().any(|(e, _)| e == "server_temp_discarded"));
}

/// 재시작 뒤 재정리 — orphaned 가 된 Run 의 검증 자리 · 장부에 없는 검토 자리(곁 파일 `role: review`) · 서버 데이터의 빈 검토 cwd 를
/// 서버 시계가 정리한다. 남긴 자리가 있는 orphaned 는 [보관] 거절 → [그래도 지우기] · [정리] 뒤 보관된다.
#[test]
fn server_temp_recleaned_after_restart() {
    let _g = super::tests_stage4::serial();
    let h = harness("restart");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run, &c, "one");
    let vdir = verify_dir(&h, &run);
    assert!(vdir.is_dir());
    // 장부에 적기 전에 멈춘 검토 자리(곁 파일만) + 서버 데이터의 빈 cwd.
    let commit = head(&h.o, &run);
    let (place, cwd) = super::review::place_blocking(
        &h.repo,
        &h.wt_dir().display().to_string(),
        &h.data.join(&run),
        &run,
        "task-aaaaaaaa1111",
        "att-bbbbbbbb2222",
        &commit,
        Some(&h.side),
    )
    .unwrap();
    assert!(sidecar_roles(&h, &run).iter().any(|(_, r)| r == "review"));
    // 두 번째 Run(같은 저장소) — 재시작 뒤 남긴 것이 있으면 [닫기] 거절을 본다.
    let (run2, c2) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run2, &c2, "two");
    let vdir2 = verify_dir(&h, &run2);
    std::fs::write(vdir2.join("stray.txt"), "x").unwrap();
    let worker_wts = |id: &str| -> Vec<String> {
        h.o.lock().runs.get(id).unwrap().run.attempts.iter().filter_map(|a| a.worktree.clone()).collect()
    };
    let (wts, wts2) = (worker_wts(&run), worker_wts(&run2));
    h.o.flush_saves();
    // "서버 재시작" — 같은 영속 폴더로 새 저장소(Run 은 orphaned).
    let (o2, _rx) = orch_at(&h.data, &h.side);
    assert_eq!(o2.lock().runs.get(&run).unwrap().run.state, RunState::Orphaned);
    o2.tick();
    assert!(!vdir.exists(), "orphaned 의 검증 자리 — 재정리");
    assert!(!Path::new(&place).exists(), "장부에 없던 검토 자리도(곁 파일 role)");
    assert!(!Path::new(&cwd).exists(), "서버 데이터의 빈 검토 cwd 도");
    assert!(sidecar_roles(&h, &run).is_empty());
    assert!(vdir2.join("stray.txt").exists());
    let r2 = o2.lock().runs.get(&run2).unwrap().run.clone();
    assert_eq!(r2.temp_pending.len(), 1);
    // 남긴 것이 있으면 보관하지 않는다.
    assert_eq!(o2.archive_run(&run2).unwrap_err().code, reason::CLEANUP_PENDING);
    o2.discard_temp(&run2, &vdir2.display().to_string()).unwrap();
    // 임시 자리를 비워도 작업자 worktree 가 남으면 보관하지 않는다 — [정리] 뒤에 된다.
    assert_eq!(o2.archive_run(&run2).unwrap_err().code, reason::WORKTREES_LEFT);
    o2.cleanup_run(&run2, &wts2, &[], false).unwrap();
    o2.cleanup_run(&run, &wts, &[], false).unwrap();
    o2.archive_run(&run2).unwrap();
    o2.archive_run(&run).unwrap();
    // 판정을 남긴 orphaned 파일은 다시 쓰였다 — 한 번 더 재시작해도 같은 결과.
    o2.flush_saves();
}

/// 정션이 든 자리를 정리해도 정션 대상은 무사하다 — 자동 폐기(보존 폴더 안의 정션) · [그래도 지우기](추적 안 된 정션) 둘 다.
#[test]
fn junction_inside_server_temp_keeps_target_intact() {
    let _g = super::tests_stage4::serial();
    let h = harness("junction");
    let outside = h.root.join("outside-store");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("keep.txt"), "precious").unwrap();
    // ① 보존 폴더(`node_modules` — 무시 파일) 안의 정션(pnpm 모양) → 쉬는 상태와 같다 → 자동 폐기.
    let (run, c) = start(&h, Some("exit 0"), &["node_modules"]);
    one_integrated(&h, &run, &c, "one");
    let vdir = verify_dir(&h, &run);
    std::fs::create_dir_all(vdir.join("node_modules")).unwrap();
    junction(&vdir.join("node_modules").join("pkg"), &outside);
    assert!(vdir.join("node_modules").join("pkg").join("keep.txt").exists());
    stop_settled(&h, &run);
    h.o.tick();
    assert!(!vdir.exists(), "보존 폴더 안의 정션은 쉬는 상태 — 지웠다");
    assert!(run_of(&h.o, &run).temp_pending.is_empty());
    assert_eq!(std::fs::read_to_string(outside.join("keep.txt")).unwrap(), "precious", "정션 대상은 무사");
    // ② 추적 안 된 정션(예상 밖 변경) → 남김 → [그래도 지우기] — 대상은 여전히 무사.
    let (run2, c2) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run2, &c2, "two");
    let vdir2 = verify_dir(&h, &run2);
    junction(&vdir2.join("link"), &outside);
    stop_settled(&h, &run2);
    h.o.tick();
    assert!(vdir2.exists());
    assert_eq!(run_of(&h.o, &run2).temp_pending.len(), 1);
    h.o.discard_temp(&run2, &vdir2.display().to_string()).unwrap();
    assert!(!vdir2.exists());
    assert_eq!(std::fs::read_to_string(outside.join("keep.txt")).unwrap(), "precious", "정션 대상은 무사");
}

/// 살아 있는 Run 은 서버 임시 자리를 건드리지 않는다(서버 시계도) · [정리] 재료 거절 · 쓰는 중(검증 트리 종료 미확인)이면 남긴다.
#[test]
fn live_run_untouched_and_busy_place_kept() {
    let _g = super::tests_stage4::serial();
    let h = harness("live");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run, &c, "one");
    let vdir = verify_dir(&h, &run);
    h.o.tick();
    assert!(vdir.is_dir(), "running — 정리하지 않는다");
    assert_eq!(h.o.sweep_temps(&run), Default::default());
    assert_eq!(h.o.cleanup_run(&run, &[], &[], false).unwrap_err().code, reason::NOT_CLEANABLE);
    // 검증 트리 종료를 확인하지 못한 적이 있다 → 쓰는 중으로 본다.
    h.o.lock().runs.get_mut(&run).unwrap().verify_unconfirmed = true;
    stop_settled(&h, &run);
    h.o.tick();
    assert!(vdir.is_dir());
    let r = run_of(&h.o, &run);
    assert!(r.temp_pending.iter().any(|p| p.why == "in-use"), "{:?}", r.temp_pending);
}

/// 리뷰 F4 — 최상위 정션(검증 임시 자리가 같은 작업 폴더 안의 사람 폴더를 가리킴)은 **링크만** 걷고 대상은 무사하다 · 곁 파일 소유 줄이
/// 없는 예상 이름 폴더(검증이 돈 적 없는 Run)는 정리 대상이 아니다.
#[test]
fn top_level_junction_unlinked_and_unowned_folder_untouched() {
    let _g = super::tests_stage4::serial();
    let h = harness("toplink");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run, &c, "one");
    let tdir = temp_dir(&h, &run);
    assert!(tdir.is_dir());
    assert!(sidecar_roles(&h, &run).iter().any(|(_, r)| r == "temp"), "임시 자리도 소유 줄을 남긴다");
    let personal = h.wt_dir().join("personal-data");
    std::fs::create_dir_all(&personal).unwrap();
    std::fs::write(personal.join("keep.txt"), "precious").unwrap();
    std::fs::remove_dir_all(&tdir).unwrap();
    junction(&tdir, &personal);
    stop_settled(&h, &run);
    h.o.tick();
    assert_eq!(std::fs::read_to_string(personal.join("keep.txt")).unwrap(), "precious", "정션 대상은 무사");
    assert!(std::fs::symlink_metadata(&tdir).is_err(), "링크만 걷었다");
    // 검증 없는 Run — 같은 예상 이름의 폴더가 있어도 소유 줄이 없으니 손대지 않는다.
    let (run2, _c2) = start(&h, None, &[]);
    let (v2, t2) = (verify_dir(&h, &run2), temp_dir(&h, &run2));
    for d in [&v2, &t2] {
        std::fs::create_dir_all(d).unwrap();
        std::fs::write(d.join("mine.txt"), "mine").unwrap();
    }
    stop_settled(&h, &run2);
    h.o.tick();
    assert!(v2.join("mine.txt").exists() && t2.join("mine.txt").exists(), "미소유 폴더는 그대로");
    assert!(run_of(&h.o, &run2).temp_pending.is_empty(), "남긴 목록에도 싣지 않는다(우리 자리가 아니다)");
}

/// E2E 10-16 #9 — [정리]의 "브랜치도 지우기". 통합은 squash 라 작업자 브랜치는 통합 ref 의 조상이 될 수 없다: 끝이 보존 ref 가 지키는
/// 통합된 보고 커밋이면 지우고, 반려 Task 의 브랜치는 남긴다(worktree 는 지움 · `failed` 아님 · `branchKept: unmerged`). 같은 정리에서
/// 그 보존 ref 를 지우면 브랜치를 남긴다(`preserve-ref-removed`).
#[test]
fn cleanup_delete_branches_keeps_unmerged_without_failing() {
    let _g = super::tests_stage4::serial();
    let h = harness("branches");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    let a = create_task(&h.o, &c, "a");
    let wa = fake_worker(&h, &run, &a, "orch-a", &head(&h.o, &run), &[("a.txt", "a\n")]);
    accept(&h.o, &c, &run, &a, "acc-a");
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
    let b = create_task(&h.o, &c, "b");
    let wb = fake_worker(&h, &run, &b, "orch-b", &head(&h.o, &run), &[("b.txt", "b\n")]);
    accept(&h.o, &c, &run, &b, "acc-b");
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted);
    let r = create_task(&h.o, &c, "r");
    let wr = fake_worker(&h, &run, &r, "orch-r", &head(&h.o, &run), &[("r.txt", "r\n")]);
    let v = task_of(&h.o, &run, &r).version;
    call(&h.o, &c, "update_task", json!({ "requestId": "rej-r", "taskId": r, "version": v, "state": "rejected" })).unwrap();
    assert_eq!(task_of(&h.o, &run, &r).state, TaskState::Rejected);
    h.o.complete_run(&run).unwrap();
    // 통합된 a · 반려된 r + 브랜치도 지우기.
    let res = h.o.cleanup_run(&run, &[wa.clone(), wr.clone()], &[], true).unwrap();
    assert_eq!(res["failed"].as_array().unwrap().len(), 0, "브랜치를 못 지우는 것은 worktree 정리의 실패가 아니다 — {res}");
    let row = |path: &str| res["worktrees"].as_array().unwrap().iter().find(|w| w["path"] == path).cloned().unwrap();
    assert_eq!(row(&wa)["branchDeleted"], true, "{res}");
    assert_eq!(row(&wa)["branchKept"], Value::Null);
    assert_eq!(row(&wr)["branchDeleted"], false);
    assert_eq!(row(&wr)["branchKept"], "unmerged");
    assert!(!Path::new(&wa).exists() && !Path::new(&wr).exists(), "worktree 는 둘 다 지운다");
    assert_eq!(rev(&h.repo, "refs/heads/orch-a"), None, "통합된 보고 커밋이 끝인 브랜치는 지운다");
    assert!(rev(&h.repo, "refs/heads/orch-r").is_some(), "반려 Task 의 브랜치는 남긴다");
    assert!(rev(&h.repo, &refs::accepted(&refs::new_base(&run), &a)).is_some(), "보고 커밋은 보존 ref 가 지킨다");
    // 같은 정리에서 b 의 보존 ref 를 지우면 브랜치를 남긴다(커밋을 지킬 것이 없다).
    let res = h.o.cleanup_run(&run, std::slice::from_ref(&wb), &[refs::accepted(&refs::new_base(&run), &b)], true).unwrap();
    assert_eq!(res["failed"].as_array().unwrap().len(), 0, "{res}");
    assert_eq!(res["worktrees"][0]["branchDeleted"], false);
    assert_eq!(res["worktrees"][0]["branchKept"], "preserve-ref-removed");
    assert_eq!(res["refs"].as_array().unwrap().len(), 1);
    assert!(!Path::new(&wb).exists());
    assert!(rev(&h.repo, "refs/heads/orch-b").is_some(), "보존 ref 를 같이 지우면 브랜치는 남긴다");
    assert_eq!(rev(&h.repo, &refs::accepted(&refs::new_base(&run), &b)), None);
}

/// E2E 10-16 #10 — 사람이 [정리]로 지운 통합 ref 의 부재는 재시작 복구 · 내보내기가 보류하지 않는다(장부 `workRefRemoved`). 정리 없이 사라진
/// 통합 ref 는 지금처럼 `integration-diverged`. 완료 증거 · 보존 ref(`done` · `accepted`)를 정리로 지운 뒤에도 재시작에 보류가 없다.
#[test]
fn restart_after_cleanup_removed_int_is_not_diverged() {
    let _g = super::tests_stage4::serial();
    let h = harness("intgone");
    // Run 1 — 정리로 통합 ref · 완료 증거 · 보존 ref 를 지운다.
    let (run, c) = start(&h, Some("exit 0"), &[]);
    let t = one_integrated(&h, &run, &c, "one");
    h.o.complete_run(&run).unwrap();
    let job = run_of(&h.o, &run).valid_artifact(&t).unwrap().job_id.clone().unwrap();
    let res = h
        .o
        .cleanup_run(&run, &[], &[refs::int(&run), refs::done(&refs::new_base(&run), &job), refs::accepted(&refs::new_base(&run), &t)], false)
        .unwrap();
    assert_eq!(res["refs"].as_array().unwrap().len(), 3, "{res}");
    assert!(run_of(&h.o, &run).integration.unwrap().work_ref_removed, "장부에 남긴다");
    // 지운 뒤의 [브랜치로 내보내기]도 보류하지 않는다(내보낸 브랜치가 이미 그 머리).
    h.o.export_branch(&run).unwrap();
    assert!(run_of(&h.o, &run).hold.is_none());
    // Run 2 — 정리 없이 통합 ref 가 사라졌다.
    let (run2, c2) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run2, &c2, "two");
    h.o.complete_run(&run2).unwrap();
    git(&h.repo, &["update-ref", "-d", &refs::int(&run2)]);
    h.o.flush_saves();
    // "서버 재시작" — 같은 영속 폴더로 다시 읽고 복구 판정.
    let (o2, _rx) = orch_at(&h.data, &h.side);
    o2.recover_jobs();
    let r1 = o2.lock().runs.get(&run).unwrap().run.clone();
    assert_eq!(r1.state, RunState::Orphaned);
    assert!(r1.integration.as_ref().unwrap().work_ref_removed, "영속 파일에서 다시 읽힌다");
    assert!(r1.hold.is_none(), "정리로 지운 통합 ref — 기대한 상태: {:?}", r1.hold);
    let r2 = o2.lock().runs.get(&run2).unwrap().run.clone();
    assert!(!r2.integration.as_ref().unwrap().work_ref_removed);
    assert_eq!(r2.hold.as_ref().map(|x| x.reason), Some(HoldReason::IntegrationDiverged), "정리 없이 사라진 통합 ref 는 보류");
}

/// E2E 10-16 #6 — 중단된 Run 의 보고된(열린) Task worktree 는 [정리]에서 고를 수 있다(`task-open` 아님) · 기본 해제 · 고르면 지운다.
#[test]
fn stopped_run_open_task_worktree_is_pickable() {
    let _g = super::tests_stage4::serial();
    let h = harness("opentask");
    let (run, c) = start(&h, None, &[]);
    let t = create_task(&h.o, &c, "open");
    let base = head(&h.o, &run);
    let w = fake_worker(&h, &run, &t, "orch-open", &base, &[("o.txt", "o\n")]);
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
    stop_settled(&h, &run);
    let p = h.o.cleanup_preview(&run).unwrap();
    let row = p["worktrees"].as_array().unwrap().iter().find(|x| x["path"] == w.as_str()).cloned().unwrap();
    assert_eq!(row["eligible"], true, "{row}");
    assert!(row["blocker"].is_null(), "{row}");
    assert_eq!(row["defaultChecked"], false, "열린 Task 는 사람이 고른다");
    let r = h.o.cleanup_run(&run, std::slice::from_ref(&w), &[], false).unwrap();
    assert_eq!(r["worktrees"].as_array().unwrap().len(), 1, "{r}");
    assert!(r["failed"].as_array().unwrap().is_empty(), "{r}");
    assert!(!Path::new(&w).exists());
}

/// 개명 전 뿌리(`refs/<옛 이름>/orch/…` — 여기서는 이름 모를 `refs/oldroot/orch/`, docs/log/2026-10-22-rename-aynx.md)로 선 Run 의 [정리]: 저장된 통합 ref 의 뿌리를
/// 따라 옛 머리를 훑어 목록에 싣고, 고른 옛 ref(통합 · 완료 증거 · 보존)를 지운다. 새 뿌리에는 아무것도 없다.
#[test]
fn cleanup_reads_and_removes_legacy_root_refs() {
    let _g = super::tests_stage4::serial();
    let h = harness("legacyroot");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    let t = one_integrated(&h, &run, &c, "one");
    h.o.complete_run(&run).unwrap();
    let job = run_of(&h.o, &run).valid_artifact(&t).unwrap().job_id.clone().unwrap();
    // 옛 Run 을 흉내 낸다 — 이 Run 의 ref 를 모두 옛 뿌리로 옮기고 장부의 통합 ref 이름도 옛 것으로.
    let new_prefix = refs::run_prefix(&run);
    let legacy_prefix = format!("refs/oldroot/orch/{}/", refs::short(&run));
    let listed = git(&h.repo, &["for-each-ref", "--format=%(refname) %(objectname)", &new_prefix]);
    let mut moved = 0;
    for line in listed.lines().filter(|l| !l.trim().is_empty()) {
        let (name, oid) = line.trim().split_once(' ').unwrap();
        let tail = name.strip_prefix(&new_prefix).unwrap();
        git(&h.repo, &["update-ref", &format!("{legacy_prefix}{tail}"), oid]);
        git(&h.repo, &["update-ref", "-d", name]);
        moved += 1;
    }
    assert!(moved >= 3, "통합 · 완료 증거 · 보존 ref 를 옮겼다 ({moved})");
    let legacy_int = format!("{legacy_prefix}int");
    h.o.lock().runs.get_mut(&run).unwrap().run.integration.as_mut().unwrap().work_ref = legacy_int.clone();
    let old = refs::base_of(&run, &legacy_int);
    assert_eq!(old.as_str(), legacy_prefix);

    // 미리 보기 — 옛 머리의 ref 가 실린다(새 머리를 훑으면 비어 있다).
    let preview = h.o.cleanup_preview(&run).unwrap();
    let names: Vec<String> =
        preview["refs"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect();
    assert!(names.contains(&legacy_int), "{preview}");
    assert!(names.iter().all(|n| n.starts_with(&legacy_prefix)), "{names:?}");
    // 정리 — 고른 옛 ref 를 지운다.
    let pick = [legacy_int.clone(), refs::done(&old, &job), refs::accepted(&old, &t)];
    let res = h.o.cleanup_run(&run, &[], &pick, false).unwrap();
    assert_eq!(res["refs"].as_array().unwrap().len(), 3, "{res}");
    for n in &pick {
        assert_eq!(rev(&h.repo, n), None, "{n}");
    }
    assert!(run_of(&h.o, &run).integration.unwrap().work_ref_removed, "옛 통합 ref 를 지운 것도 장부에 남는다");
}
