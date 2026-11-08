//! 통합 설계 3단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 8 · 10절 3단계 행) — **임시 저장소에서 진짜 git 으로**:
//! 가짜 작업자 둘(다른 파일 · 같은 파일 다른 줄) → 통합 커밋 둘, 같은 줄 → `conflict` 구조 기록, 병합 드라이버 · `merge.default` · 필터 ·
//! renormalize · submodule 저장소 거절(드라이버가 돌지 않음), 주 작업 폴더의 커밋 안 된 `.gitattributes` 에 흔들리지 않는 속성 출처,
//! merge-base 비조상 거절, 외부 변경 보류 → [조정](되돌리기 · 받아들이기), 내보내기(체크아웃 거절 · 사람이 바꾼 브랜치 거절),
//! 통합 머리 기준 · `base` 거절, 통합 뒤 뒤집기 거절, 비동기 수락(`wait_run settled`), git 판 거절.
//!
//! 작업자는 띄우지 않는다 — "작업자가 보고함" 은 시험이 커밋(배관 명령)을 만들고 Attempt · Report 를 장부에 적는다(2단계 시험과 같은 틀).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::integrate::*;
use super::model::*;
use super::spawn::{Base, LaunchJob, WorkerLauncher};
use super::store::*;
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 진짜 git 저장소
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage3-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn git_env(dir: &Path, args: &[&str], env: &[(&str, &str)], stdin: Option<&[u8]>) -> (i32, String) {
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
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git(dir: &Path, args: &[&str]) -> String {
    let (code, out) = git_env(dir, args, &[], None);
    assert_eq!(code, 0, "git {args:?} failed: {out}");
    out
}

/// 저장소 하나 — `f.txt`(다섯 줄) · `g.txt` 를 담은 첫 커밋. 신원 · 줄 끝은 저장소 로컬 설정(전역은 건드리지 않는다).
fn repo(tag: &str) -> PathBuf {
    let d = scratch(tag).join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Three"]);
    git(&d, &["config", "user.email", "stage3@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("f.txt"), "one\ntwo\nthree\nfour\nfive\n").unwrap();
    std::fs::write(d.join("g.txt"), "g\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

/// `parent` 위에 파일 몇 개를 바꾼 커밋 하나(배관 명령 — 작업 폴더 · 실제 index 는 건드리지 않는다). `None` 내용 = 지우기.
fn commit_on(repo: &Path, parent: &str, files: &[(&str, Option<&str>)], msg: &str) -> String {
    let idx = scratch("idx").join("index");
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    let (c, o) = git_env(repo, &["read-tree", parent], &env, None);
    assert_eq!(c, 0, "{o}");
    for (path, body) in files {
        match body {
            Some(b) => {
                let (c, blob) = git_env(repo, &["hash-object", "-w", "--stdin"], &env, Some(b.as_bytes()));
                assert_eq!(c, 0);
                let info = format!("100644,{blob},{path}");
                let (c, o) = git_env(repo, &["update-index", "--add", "--cacheinfo", &info], &env, None);
                assert_eq!(c, 0, "{o}");
            }
            None => {
                let (c, o) = git_env(repo, &["update-index", "--force-remove", path], &env, None);
                assert_eq!(c, 0, "{o}");
            }
        }
    }
    let (c, tree) = git_env(repo, &["write-tree"], &env, None);
    assert_eq!(c, 0);
    git(repo, &["commit-tree", &tree, "-p", parent, "-m", msg])
}

/// gitlink(submodule) 하나를 더한 커밋.
fn commit_gitlink(repo: &Path, parent: &str, target: &str) -> String {
    let idx = scratch("idx").join("index");
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    git_env(repo, &["read-tree", parent], &env, None);
    let info = format!("160000,{target},sub");
    let (c, o) = git_env(repo, &["update-index", "--add", "--cacheinfo", &info], &env, None);
    assert_eq!(c, 0, "{o}");
    let (_, tree) = git_env(repo, &["write-tree"], &env, None);
    git(repo, &["commit-tree", &tree, "-p", parent, "-m", "sub"])
}

fn rev(repo: &Path, name: &str) -> Option<String> {
    let (c, o) = git_env(repo, &["rev-parse", "--verify", "--quiet", name], &[], None);
    (c == 0).then_some(o)
}

fn show(repo: &Path, spec: &str) -> String {
    git(repo, &["show", spec])
}

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Launcher {
    jobs: Mutex<Vec<(String, Base)>>,
}

impl WorkerLauncher for Launcher {
    fn launch(&self, job: LaunchJob) {
        self.jobs.lock().unwrap().push((job.attempt_id.clone(), job.base.clone()));
    }
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

struct H {
    o: Arc<Orchestration>,
    launcher: Arc<Launcher>,
    _audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(crate::operations::now_ms)));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    o.set_integrator(Arc::new(GitRefs));
    let launcher = Arc::new(Launcher::default());
    o.set_launcher(launcher.clone());
    super::test_album::delegate_all(&o);
    H {
        o,
        launcher,
        _audit: Mutex::new(rx),
    }
}

fn start_req(repo: &Path) -> StartRun {
    StartRun {
        verify: None,
        name: "stage3".into(),
        repo: repo.display().to_string(),
        worktree_dir: repo.parent().unwrap().join("wt").display().to_string(),
        limits: Limits::default(),
    }
}

fn start(o: &Orchestration, repo: &Path) -> (String, Caller) {
    let run = o.start_integrated_run(start_req(repo)).unwrap().0;
    let c = o.coordinator_caller(&run).unwrap();
    (run, c)
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn err_code(r: Result<Value, String>) -> String {
    let e = r.expect_err("거절이어야 한다");
    e.split(':').next().unwrap_or_default().to_string()
}

fn code<T: std::fmt::Debug>(r: Result<T, OrchError>) -> &'static str {
    r.expect_err("거절이어야 한다").code
}

fn create_task(o: &Orchestration, c: &Caller, req: &str, title: &str, deps: &[&str]) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": title, "goal": "g", "dependsOn": deps })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

fn run_of(o: &Orchestration, run: &str) -> Run {
    o.lock().runs.get(run).unwrap().run.clone()
}

fn task_of(o: &Orchestration, run: &str, task: &str) -> Task {
    run_of(o, run).task(task).unwrap().clone()
}

fn head(o: &Orchestration, run: &str) -> String {
    run_of(o, run).integration.unwrap().expected_head
}

/// "끝난 작업자가 성공 보고함" — 보고 커밋 `commit` · 기준 `base`.
fn reported(o: &Orchestration, run: &str, task: &str, base: &str, commit: &str) {
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
        summary: format!("did {task}\nmore lines"),
        notes: None,
        commit_oid: Some(commit.into()),
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
}

fn accept(o: &Orchestration, c: &Caller, run: &str, task: &str, req: &str) -> Result<Value, String> {
    let v = task_of(o, run, task).version;
    call(o, c, "update_task", json!({ "requestId": req, "taskId": task, "version": v, "state": "accepted" }))
}

fn last_job(o: &Orchestration, run: &str) -> IntegrationJob {
    run_of(o, run).jobs.last().unwrap().clone()
}

/// 표식 파일이 생기면 드라이버 · 필터가 돈 것이다.
fn driver_cmd(marker: &Path) -> String {
    format!("echo ran >> '{}'; exit 1", marker.to_string_lossy().replace('\\', "/"))
}

// ---------------------------------------------------------------------------
// 시험 — 통합
// ---------------------------------------------------------------------------

#[test]
fn start_creates_integration_ref_at_head() {
    let h = harness();
    let r = repo("start");
    let main = rev(&r, "HEAD").unwrap();
    let (run, _) = start(&h.o, &r);
    let integ = run_of(&h.o, &run).integration.unwrap();
    assert_eq!(integ.work_ref, refs::int(&run));
    assert_eq!(integ.base_commit, main);
    assert_eq!(integ.expected_head, main);
    assert_eq!(integ.base_branch.as_deref(), Some("main"));
    assert!(integ.export_branch.starts_with("orch-") && integ.export_branch.ends_with("-int"));
    assert_eq!(rev(&r, &integ.work_ref).as_deref(), Some(main.as_str()));
    assert_eq!(git(&r, &["branch", "--list", &integ.export_branch]), "", "Run 도중엔 브랜치가 없다(N1)");
}

#[test]
fn two_workers_integrate_two_squash_commits() {
    let h = harness();
    let r = repo("two");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "Task A", &[]);
    let b = create_task(&h.o, &c, "b", "Task B", &[]);
    let d = create_task(&h.o, &c, "d", "Task D", &[]);
    // A — 다른 파일(새 파일), B — 같은 파일 다른 줄(첫 줄), D — 같은 파일 다른 줄(끝 줄). 셋 다 시작 기준에서 갈라졌다.
    let ca = commit_on(&r, &base, &[("new.txt", Some("new\n"))], "a1");
    let ca = commit_on(&r, &ca, &[("new.txt", Some("new\nmore\n"))], "a2");
    let cb = commit_on(&r, &base, &[("f.txt", Some("ONE\ntwo\nthree\nfour\nfive\n"))], "b");
    let cd = commit_on(&r, &base, &[("f.txt", Some("one\ntwo\nthree\nfour\nFIVE\n"))], "d");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    reported(&h.o, &run, &d, &base, &cd);
    let v = accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    assert_eq!(v["accepting"], true);
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
    let h1 = head(&h.o, &run);
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    accept(&h.o, &c, &run, &d, "acc-d").unwrap();
    let h3 = head(&h.o, &run);
    assert_eq!(rev(&r, &refs::int(&run)).as_deref(), Some(h3.as_str()));
    // 직선 · Task 하나 = 커밋 하나(작업자의 잔 커밋 a1 · a2 는 들어가지 않는다).
    let log = git(&r, &["rev-list", "--first-parent", &format!("{base}..{h3}")]);
    assert_eq!(log.lines().count(), 3);
    assert_eq!(git(&r, &["rev-parse", &format!("{h1}^")]), base);
    assert_eq!(git(&r, &["rev-list", "--parents", "-n1", &h3]).split(' ').count(), 2, "부모 하나(squash)");
    assert_eq!(show(&r, &format!("{h3}:f.txt")), "ONE\ntwo\nthree\nfour\nFIVE");
    assert_eq!(show(&r, &format!("{h3}:new.txt")), "new\nmore");
    // 메시지 · trailer.
    let msg = git(&r, &["log", "-1", "--format=%B", &h1]);
    assert!(msg.starts_with("Task A\n\ndid "), "{msg}");
    assert!(msg.contains(&format!("Aynx-Report-Commit: {ca}")) && msg.contains(&format!("Aynx-Base: {base}")));
    // 완료 증거 · 보존 ref · 후보 ref 지움.
    let run_now = run_of(&h.o, &run);
    for t in [&a, &b, &d] {
        let art = run_now.valid_artifact(t).unwrap();
        let job = art.job_id.clone().unwrap();
        assert_eq!(rev(&r, &refs::done(&refs::new_base(&run), &job)), art.integration_commit);
        assert_eq!(rev(&r, &refs::accepted(&refs::new_base(&run), t)).as_deref(), Some(art.commit_oid.as_str()));
    }
    assert_eq!(git(&r, &["for-each-ref", &refs::candidate_prefix(&refs::new_base(&run))]), "", "후보 ref 는 모두 지웠다");
    assert!(run_now.jobs.iter().all(|j| j.phase == JobPhase::Integrated));
}

#[test]
fn same_line_conflict_records_structure() {
    let h = harness();
    let r = repo("conflict");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let ca = commit_on(&r, &base, &[("f.txt", Some("one\nTWO-A\nthree\nfour\nfive\n"))], "a");
    let cb = commit_on(&r, &base, &[("f.txt", Some("one\nTWO-B\nthree\nfour\nfive\n"))], "b");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let h1 = head(&h.o, &run);
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    // 커밋을 만들지 않는다 — 통합 머리 그대로.
    assert_eq!(head(&h.o, &run), h1);
    assert_eq!(rev(&r, &refs::int(&run)).as_deref(), Some(h1.as_str()));
    let t = task_of(&h.o, &run, &b);
    assert_eq!(t.state, TaskState::Conflict);
    let info = t.conflict.unwrap();
    assert_eq!(info.old, h1);
    assert_eq!(info.report_commit, cb);
    assert_eq!(info.merge_base, base);
    assert_eq!(info.entries.len(), 1);
    assert_eq!(info.entries[0].paths, vec!["f.txt".to_string()]);
    assert_eq!(info.entries[0].kinds, vec!["contents".to_string()]);
    let stages: Vec<u8> = info.entries[0].stages.iter().map(|s| s.stage).collect();
    assert_eq!(stages, vec![1, 2, 3]);
    assert!(!info.needs_human, "일반 텍스트 내용 충돌");
    // 충돌 트리 커밋 — 표식 박힌 blob.
    let cc = info.conflict_commit.unwrap();
    assert_eq!(rev(&r, &refs::conflict(&refs::new_base(&run), &b)).as_deref(), Some(cc.as_str()));
    assert!(show(&r, &format!("{cc}:f.txt")).contains("<<<<<<<"));
    assert_eq!(last_job(&h.o, &run).phase, JobPhase::Conflict);
    // 충돌한 Task 는 반려로도 나간다(해결 Attempt 는 `tests_stage3b`) → 그 뒤 통합 머리에서 새로.
    let v = task_of(&h.o, &run, &b).version;
    call(&h.o, &c, "update_task", json!({ "requestId": "rej", "taskId": b, "version": v, "state": "rejected" })).unwrap();
    let s = call(&h.o, &c, "spawn_worker", json!({ "requestId": "s2", "taskId": b, "role": super::test_album::WRITER })).unwrap();
    assert_eq!(s["base"], h1.as_str());
}

#[test]
fn binary_conflict_needs_human() {
    let h = harness();
    let r = repo("bin");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let base = commit_on(&r, &base, &[("b.bin", Some("\0\x01base"))], "bin");
    git(&r, &["update-ref", &refs::int(&run), &base, &head(&h.o, &run)]);
    {
        let mut g = h.o.lock();
        g.runs.get_mut(&run).unwrap().run.integration.as_mut().unwrap().expected_head = base.clone();
    }
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let ca = commit_on(&r, &base, &[("b.bin", Some("\0\x01aaa"))], "a");
    let cb = commit_on(&r, &base, &[("b.bin", Some("\0\x01bbb"))], "b");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    let info = task_of(&h.o, &run, &b).conflict.unwrap();
    assert!(info.needs_human);
    assert!(info.entries[0].kinds.contains(&"binary".to_string()));
}

#[test]
fn accept_is_async_until_integrated() {
    let h = harness();
    h.o.install_self();
    let r = repo("async");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    let v = accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    assert_eq!(v["accepting"], true);
    assert!(v["jobId"].as_str().unwrap().starts_with("job-"));
    // 같은 requestId 는 처음 결과.
    let again = call(&h.o, &c, "update_task", json!({ "requestId": "acc-a", "taskId": a, "version": 0, "state": "accepted" })).unwrap();
    assert_eq!(again["jobId"], v["jobId"]);
    let w = call(&h.o, &c, "wait_run", json!({ "until": "settled", "taskIds": [a], "timeoutSeconds": 60 })).unwrap();
    assert_eq!(w["satisfied"], true, "{w}");
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
    assert_ne!(head(&h.o, &run), base);
}

#[test]
fn flip_after_integration_refused() {
    let h = harness();
    let r = repo("flip");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let v = task_of(&h.o, &run, &a).version;
    assert_eq!(code(h.o.human_review(&run, &a, v, Decision::Rejected)), "already-integrated");
}

#[test]
fn new_attempt_bases_on_integration_head_and_base_arg_refused() {
    let h = harness();
    let r = repo("base");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let x = create_task(&h.o, &c, "x", "X", &[&a, &b]);
    // base 인자는 거절(조용히 무시하지 않는다).
    assert_eq!(
        err_code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "s0", "taskId": a, "role": super::test_album::WRITER, "base": "main" }))),
        "invalid-argument"
    );
    // 의존 없음 → 통합 머리(= 시작 기준).
    let s = call(&h.o, &c, "spawn_worker", json!({ "requestId": "s1", "taskId": a, "role": super::test_album::WRITER })).unwrap();
    assert_eq!(s["base"], base.as_str());
    assert_eq!(h.launcher.jobs.lock().unwrap().last().unwrap().1, Base::Commit(base.clone()));
    // 의존 여럿 — 수락 전에는 dependency-not-accepted, 둘 다 통합되면 needs-merge 없이 통합 머리에서.
    assert_eq!(
        err_code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "s2", "taskId": x, "role": super::test_album::WRITER }))),
        "dependency-not-accepted"
    );
    let ca = commit_on(&r, &base, &[("a.txt", Some("a\n"))], "a");
    let cb = commit_on(&r, &base, &[("b.txt", Some("b\n"))], "b");
    // a 는 위에서 띄운 Attempt 가 있으니 그 위에 보고를 덧붙인다(시험 — 현재 Attempt 를 새 것으로).
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    let h2 = head(&h.o, &run);
    let s = call(&h.o, &c, "spawn_worker", json!({ "requestId": "s3", "taskId": x, "role": super::test_album::WRITER })).unwrap();
    assert_eq!(s["base"], h2.as_str());
}

// ---------------------------------------------------------------------------
// 시험 — 지원 범위(임의 실행 차단)
// ---------------------------------------------------------------------------

/// 기준 커밋에 `.gitattributes` 를 더한 저장소 + 통합 머리를 그 커밋으로.
fn with_attrs(tag: &str, attrs: &str) -> (H, PathBuf, String, Caller, String) {
    let h = harness();
    let r = repo(tag);
    std::fs::write(r.join(".gitattributes"), attrs).unwrap();
    git(&r, &["add", "."]);
    git(&r, &["commit", "-qm", "attrs"]);
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    (h, r, run, c, base)
}

#[test]
fn custom_merge_driver_refused_and_never_runs() {
    let (h, r, run, c, base) = with_attrs("driver", "*.txt merge=foo\n");
    let marker = r.parent().unwrap().join("driver-ran");
    git(&r, &["config", "merge.foo.driver", &driver_cmd(&marker)]);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("f.txt", Some("ONE\ntwo\nthree\nfour\nfive\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    assert_eq!(err_code(accept(&h.o, &c, &run, &a, "acc-a")), "git-unsupported");
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Reported, "통합 전에 거절 — Task 는 보고됨 그대로");
    assert!(run_of(&h.o, &run).jobs.is_empty());
    assert!(!marker.exists(), "드라이버가 돌면 안 된다");
}

/// F1 — 내장 이름(`text` · `binary` · `union`)을 덮는 사용자 드라이버도 거절하고 돌지 않는다(git 은 사용자 정의를 먼저 고른다).
#[test]
fn builtin_named_driver_override_refused() {
    for name in ["text", "binary", "union"] {
        let (h, r, run, c, base) = with_attrs(&format!("drv-{name}"), &format!("*.txt merge={name}\n"));
        let marker = r.parent().unwrap().join(format!("driver-{name}-ran"));
        git(&r, &["config", &format!("merge.{name}.driver"), &driver_cmd(&marker)]);
        let a = create_task(&h.o, &c, "a", "A", &[]);
        let ca = commit_on(&r, &base, &[("f.txt", Some("ONE\ntwo\nthree\nfour\nfive\n"))], "a");
        reported(&h.o, &run, &a, &base, &ca);
        assert_eq!(err_code(accept(&h.o, &c, &run, &a, "acc-a")), "git-unsupported", "{name}");
        assert!(run_of(&h.o, &run).jobs.is_empty(), "{name}");
        assert!(!marker.exists(), "{name} 드라이버가 돌면 안 된다");
    }
}

#[test]
fn merge_default_refused() {
    let h = harness();
    let r = repo("mdefault");
    let marker = r.parent().unwrap().join("default-ran");
    git(&r, &["config", "merge.foo.driver", &driver_cmd(&marker)]);
    git(&r, &["config", "merge.default", "foo"]);
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    assert_eq!(err_code(accept(&h.o, &c, &run, &a, "acc-a")), "git-unsupported");
    assert!(!marker.exists());
}

#[test]
fn filter_attr_refused_from_any_of_three_trees() {
    // 속성이 보고 커밋 트리에만 있어도(작업자가 .gitattributes 에 필터를 더함) 거절.
    let h = harness();
    let r = repo("filter");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[(".gitattributes", Some("*.bin filter=x\n")), ("a.bin", Some("data\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    assert_eq!(err_code(accept(&h.o, &c, &run, &a, "acc-a")), "git-unsupported");
}

#[test]
fn renormalize_refused() {
    let h = harness();
    let r = repo("renorm");
    git(&r, &["config", "merge.renormalize", "true"]);
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    assert_eq!(err_code(accept(&h.o, &c, &run, &a, "acc-a")), "git-unsupported");
}

#[test]
fn changed_gitlink_refused_unchanged_gitlink_integrates() {
    let h = harness();
    let r = repo("sub");
    // 저장소에 이미 submodule(gitlink)이 있다 — 그것만으로는 거절하지 않는다.
    let main = rev(&r, "HEAD").unwrap();
    let with_sub = commit_gitlink(&r, &main, &main);
    git(&r, &["reset", "-q", "--hard", &with_sub]);
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    assert_eq!(base, with_sub);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G
"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted, "gitlink 가 그대로면 통합한다");
    let h1 = head(&h.o, &run);
    assert!(git(&r, &["ls-tree", &h1, "sub"]).starts_with("160000 commit"));
    // gitlink 를 바꾼 Task 는 통합 전에 거절.
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let cb = commit_gitlink(&r, &h1, &ca);
    reported(&h.o, &run, &b, &h1, &cb);
    let e = accept(&h.o, &c, &run, &b, "acc-b").unwrap_err();
    assert!(e.starts_with("git-unsupported: submodule"), "{e}");
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Reported);
    assert_eq!(head(&h.o, &run), h1);
}

#[test]
fn main_worktree_gitattributes_ignored() {
    // 커밋 안 된 .gitattributes(주 작업 폴더)에 병합 속성이 걸려 있어도 속성 출처는 old 트리 — 그 속성이 쓰이지 않고 통합된다(0a A1 · A2).
    // (사용자 드라이버 설정은 이제 설정만으로 거절된다 — 리뷰 F1. 그래서 내장 `binary` 로 잰다: 쓰였다면 양쪽이 고친 f.txt 가 충돌한다.)
    let h = harness();
    let r = repo("wtattr");
    let (run, c) = start(&h.o, &r);
    std::fs::write(r.join(".gitattributes"), "*.txt merge=binary\n").unwrap();
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let ca = commit_on(&r, &base, &[("f.txt", Some("ONE\ntwo\nthree\nfour\nfive\n"))], "a");
    let cb = commit_on(&r, &base, &[("f.txt", Some("one\ntwo\nthree\nfour\nFIVE\n"))], "b");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted);
    assert_eq!(show(&r, &format!("{}:f.txt", head(&h.o, &run))), "ONE\ntwo\nthree\nfour\nFIVE", "작업 폴더의 속성이 쓰이면 충돌한다");
}

#[test]
fn merge_base_must_be_ancestor_of_both() {
    let h = harness();
    let r = repo("anc");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    // 기준을 조상이 아닌 커밋(따로 선 뿌리)으로 둔 보고.
    let tree = git(&r, &["write-tree"]);
    let orphan = git(&r, &["commit-tree", &tree, "-m", "orphan"]);
    let ca = commit_on(&r, &orphan, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &orphan, &ca);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let j = last_job(&h.o, &run);
    assert_eq!(j.phase, JobPhase::Aborted);
    assert_eq!(j.outcome.unwrap().reason, "integration-failed:base-not-ancestor");
    assert_eq!(head(&h.o, &run), base);
}

// ---------------------------------------------------------------------------
// 시험 — 외부 변경 · [조정] · 내보내기
// ---------------------------------------------------------------------------

#[test]
fn external_ref_change_holds_then_revert_reconciles() {
    let h = harness();
    let r = repo("revert");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    // 사람이 통합 ref 를 앱 밖에서 움직였다.
    let human = commit_on(&r, &base, &[("h.txt", Some("h\n"))], "human");
    git(&r, &["update-ref", &refs::int(&run), &human]);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let j = last_job(&h.o, &run);
    assert_eq!(j.outcome.unwrap().reason, "moved");
    let rn = run_of(&h.o, &run);
    assert_eq!(rn.hold.as_ref().map(|x| x.reason), Some(HoldReason::IntegrationDiverged));
    assert_eq!(rn.state, RunState::Paused);
    assert_eq!(rn.integration.as_ref().unwrap().expected_head, base, "자동 채택하지 않는다");
    // 보류 중엔 새 작업자 · 새 수락 거절.
    let b = task_of(&h.o, &run, &a);
    assert_eq!(err_code(accept(&h.o, &c, &run, &b.id, "acc-a2")), "run-on-hold");
    assert_eq!(code(h.o.release_hold(&run)), "invalid-state", "어긋남은 [조정]으로만");
    let p = h.o.reconcile_preview(&run).unwrap();
    assert_eq!(p["currentHead"], human.as_str());
    assert_eq!(p["expectedHead"], base.as_str());
    let v = h.o.reconcile(&run, "revert", false, None, &[]).unwrap();
    assert_eq!(v["head"], base.as_str());
    assert_eq!(rev(&r, &refs::int(&run)).as_deref(), Some(base.as_str()));
    let kept = git(&r, &["for-each-ref", "--format=%(objectname)", &format!("{}diverged/", refs::run_prefix(&run))]);
    assert_eq!(kept, human, "사람이 올린 머리는 보존");
    assert!(run_of(&h.o, &run).hold.is_none());
    h.o.bind_coordinator(&run, 1, "stage3-tile").unwrap(); // 재개는 조정자가 묶여 있어야(`no-coordinator`).
    h.o.resume(&run).unwrap();
    accept(&h.o, &c, &run, &a, "acc-a3").unwrap();
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
}

#[test]
fn reconcile_accept_needs_confirmation_and_moves_expected_head() {
    let h = harness();
    let r = repo("acceptmove");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let h1 = head(&h.o, &run);
    // 사람이 통합 머리 위에 커밋을 더했다 → 다음 Attempt 를 띄우려다 보류.
    let human = commit_on(&r, &h1, &[("h.txt", Some("h\n"))], "human");
    git(&r, &["update-ref", &refs::int(&run), &human]);
    let b = create_task(&h.o, &c, "b", "B", &[]);
    assert_eq!(err_code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "s", "taskId": b, "role": super::test_album::WRITER }))), "run-on-hold");
    let p = h.o.reconcile_preview(&run).unwrap();
    assert_eq!(p["integrated"][0]["contained"], true, "수락된 결과가 새 머리에 들어 있다");
    assert_eq!(code(h.o.reconcile(&run, "accept", false, None, &[])), "invalid-argument");
    assert_eq!(code(h.o.reconcile(&run, "accept", true, Some(&base), &[])), "invalid-state", "본 머리와 다르면 거절");
    h.o.reconcile(&run, "accept", true, Some(&human), &[]).unwrap();
    assert_eq!(head(&h.o, &run), human);
    h.o.bind_coordinator(&run, 1, "stage3-tile").unwrap(); // 재개는 조정자가 묶여 있어야(`no-coordinator`).
    h.o.resume(&run).unwrap();
    let s = call(&h.o, &c, "spawn_worker", json!({ "requestId": "s2", "taskId": b, "role": super::test_album::WRITER })).unwrap();
    assert_eq!(s["base"], human.as_str());
}

#[test]
fn export_refuses_checked_out_and_human_moved_branch() {
    let h = harness();
    let r = repo("export");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let h1 = head(&h.o, &run);
    let branch = run_of(&h.o, &run).integration.unwrap().export_branch;
    let v = h.o.export_branch(&run).unwrap();
    assert_eq!(v["head"], h1.as_str());
    assert_eq!(rev(&r, &format!("refs/heads/{branch}")).as_deref(), Some(h1.as_str()));
    // 체크아웃돼 있으면 거절.
    let wt = r.parent().unwrap().join("exp-wt");
    git(&r, &["worktree", "add", "-q", &wt.to_string_lossy(), &branch]);
    assert_eq!(code(h.o.export_branch(&run)), "export-checked-out");
    git(&r, &["worktree", "remove", "--force", &wt.to_string_lossy()]);
    // 사람이 브랜치를 바꿨으면 덮지 않는다.
    let b = create_task(&h.o, &c, "b", "B", &[]);
    let cb = commit_on(&r, &h1, &[("b.txt", Some("b\n"))], "b");
    reported(&h.o, &run, &b, &h1, &cb);
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    let other = commit_on(&r, &h1, &[("o.txt", Some("o\n"))], "other");
    git(&r, &["update-ref", &format!("refs/heads/{branch}"), &other]);
    assert_eq!(code(h.o.export_branch(&run)), "export-branch-moved");
    assert_eq!(rev(&r, &format!("refs/heads/{branch}")).as_deref(), Some(other.as_str()));
}

// ---------------------------------------------------------------------------
// 시험 — git 판 · 조정자 길
// ---------------------------------------------------------------------------

struct OldGit;

impl IntegrationGit for OldGit {
    fn apply(&self, _: &Path, _: &RefTx) -> Result<TxOutcome, String> {
        Err("no".into())
    }
    fn read_ref(&self, _: &Path, _: &str) -> Result<Option<String>, String> {
        Err("no".into())
    }
    fn is_ancestor(&self, _: &Path, _: &str, _: &str) -> Result<bool, String> {
        Err("no".into())
    }
    fn git_version(&self, _: &Path) -> Result<(u32, u32), String> {
        Ok((2, 41))
    }
}

#[test]
fn start_refuses_old_git() {
    let h = harness();
    h.o.set_integrator(Arc::new(OldGit));
    let r = repo("old");
    assert_eq!(code(h.o.start_integrated_run(start_req(&r))), "git-too-old");
    assert!(h.o.snapshot().as_array().unwrap().is_empty());
}

#[test]
fn coordinator_accept_goes_through_coordinator_slot() {
    let h = harness();
    let r = repo("slot");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G\n"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    let v = task_of(&h.o, &run, &a).version;
    // 다른 runId 는 not-found(있는지도 흘리지 않는다).
    let other = new_id("run").unwrap();
    assert_eq!(
        err_code(call(&h.o, &c, "update_task", json!({ "requestId": "x", "runId": other, "taskId": a, "version": v, "state": "accepted" }))),
        "not-found"
    );
    // 세대가 바뀐 옛 조정자(제품에서는 `adopt_run`) — 묶음이 풀려 이 Caller 의 세대는 낡았다.
    h.o.bump_gen_for_test(&run).unwrap();
    assert_eq!(
        err_code(call(&h.o, &c, "update_task", json!({ "requestId": "y", "taskId": a, "version": v, "state": "accepted" }))),
        "stale-generation"
    );
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Reported);
}

/// 통합 git 손을 감싸 부른 횟수를 센다(진짜 git 에 맡긴다).
struct Counting {
    calls: AtomicU64,
}

impl Counting {
    fn hit(&self) {
        self.calls.fetch_add(1, Ordering::SeqCst);
    }
}

impl IntegrationGit for Counting {
    fn apply(&self, r: &Path, tx: &RefTx) -> Result<TxOutcome, String> {
        self.hit();
        GitRefs.apply(r, tx)
    }
    fn read_ref(&self, r: &Path, n: &str) -> Result<Option<String>, String> {
        self.hit();
        GitRefs.read_ref(r, n)
    }
    fn is_ancestor(&self, r: &Path, a: &str, b: &str) -> Result<bool, String> {
        self.hit();
        GitRefs.is_ancestor(r, a, b)
    }
    fn unsupported(&self, r: &Path, o: &str, p: &str, b: &str) -> Result<Option<&'static str>, String> {
        self.hit();
        GitRefs.unsupported(r, o, p, b)
    }
}

#[test]
fn stale_coordinator_cannot_trigger_git() {
    let h = harness();
    let r = repo("stalegit");
    let (run, c) = start(&h.o, &r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A", &[]);
    let ca = commit_on(&r, &base, &[("g.txt", Some("G
"))], "a");
    reported(&h.o, &run, &a, &base, &ca);
    let counting = Arc::new(Counting { calls: AtomicU64::new(0) });
    h.o.set_integrator(counting.clone());
    h.o.bump_gen_for_test(&run).unwrap();
    let v = task_of(&h.o, &run, &a).version;
    assert_eq!(
        err_code(call(&h.o, &c, "update_task", json!({ "requestId": "z", "taskId": a, "version": v, "state": "accepted" }))),
        "stale-generation"
    );
    assert_eq!(counting.calls.load(Ordering::SeqCst), 0, "낡은 조정자는 git 을 읽게 하지 못한다");
}

// ---------------------------------------------------------------------------
// 시험 — ref 이름 길이 · 짧은 이름 충돌(E2E 10-16)
// ---------------------------------------------------------------------------

/// 서버가 짓는 ref 이름은 모두 짧다 — 진짜 id 모양(`run-<32hex>` · `job-` · `task-`)으로 가장 긴 것이 [`refs::MAX_REF_LEN`] 이하.
/// 154자 저장소 경로에서 `candidate/<job>` 이 `Filename too long` 으로 통합을 막았다(긴 id 그대로는 100자를 넘었다).
#[test]
fn ref_names_are_short() {
    let run = new_id("run").unwrap();
    let job = new_id("job").unwrap();
    let task = new_id("task").unwrap();
    let names = [
        refs::int(&run),
        refs::done(&refs::new_base(&run), &job),
        refs::accepted(&refs::new_base(&run), &task),
        refs::candidate(&refs::new_base(&run), &job),
        refs::conflict(&refs::new_base(&run), &task),
        refs::diverged(&refs::new_base(&run), u64::MAX),
    ];
    for n in &names {
        assert!(n.len() <= refs::MAX_REF_LEN, "{n} ({} 자)", n.len());
        assert!(n.starts_with(&refs::run_prefix(&run)), "{n}");
    }
    assert_eq!(refs::short(&run).len(), refs::SHORT);
    assert_eq!(refs::short(&run), run["run-".len().."run-".len() + refs::SHORT]);
    assert_eq!(refs::candidate(&refs::new_base(&run), &job), format!("{}{}", refs::candidate_prefix(&refs::new_base(&run)), refs::short(&job)));
    // 이름의 꼬리로 다시 그 Job 을 찾는다(회수 — `cleanup.rs::reclaim_refs`).
    assert_eq!(refs::candidate(&refs::new_base(&run), &job).strip_prefix(&refs::candidate_prefix(&refs::new_base(&run))), Some(refs::short(&job).as_str()));
}

/// 새 Run 은 지금 뿌리(`refs/aynx/orch/`), 다른 뿌리로 저장된 Run(개명 전 등)은 **뿌리 이름을 모른 채** 저장된 통합 ref 에서
/// 머리를 끌어내 나머지 ref 를 짓는다(2026-10-22 2차 — 옛 이름 리터럴을 걷었다). 꼴이 아니면 지금 뿌리로 떨어진다.
#[test]
fn stored_runs_keep_their_ref_root_without_knowing_its_name() {
    let run = new_id("run").unwrap();
    let job = new_id("job").unwrap();
    let s = refs::short(&run);
    assert!(refs::int(&run).starts_with(refs::ROOT));
    assert_eq!(refs::base_of(&run, &refs::int(&run)), refs::new_base(&run));
    assert_eq!(refs::base_of(&run, ""), refs::new_base(&run), "통합 ref 가 없으면 지금 뿌리");
    let old_prefix = format!("refs/oldroot/orch/{s}/");
    let old = refs::base_of(&run, &format!("{old_prefix}int"));
    assert_eq!(old.as_str(), old_prefix);
    assert_ne!(old, refs::new_base(&run));
    // 꼴이 아닌 것 — 브랜치 · 태그 · 원격 자리, 여러 성분 뿌리, 빈 뿌리, 다른 Run 의 머리, refs/ 밖 — 은 지금 뿌리.
    for odd in [
        format!("refs/heads/orch/{s}/int"),
        format!("refs/tags/orch/{s}/int"),
        format!("refs/remotes/orch/{s}/int"),
        format!("refs/a/b/orch/{s}/int"),
        format!("refs//orch/{s}/int"),
        "refs/oldroot/orch/0000000000000000/int".to_string(),
        format!("oldroot/orch/{s}/int"),
    ] {
        assert_eq!(refs::base_of(&run, &odd), refs::new_base(&run), "{odd}");
    }
    for n in [
        refs::done(&old, &job),
        refs::accepted(&old, &job),
        refs::candidate(&old, &job),
        refs::conflict(&old, &job),
        refs::diverged(&old, 1),
    ] {
        assert!(n.starts_with(old.as_str()), "{n}");
    }
}

/// 첫 목록 조회만 "이미 있다" 고 답하는 손(나머지는 진짜 git) — Run 시작이 짧은 이름 충돌에서 id 를 다시 뽑는지 본다.
struct TakenOnce {
    seen: Mutex<Vec<String>>,
}

impl IntegrationGit for TakenOnce {
    fn apply(&self, r: &Path, tx: &RefTx) -> Result<TxOutcome, String> {
        GitRefs.apply(r, tx)
    }
    fn read_ref(&self, r: &Path, n: &str) -> Result<Option<String>, String> {
        GitRefs.read_ref(r, n)
    }
    fn is_ancestor(&self, r: &Path, a: &str, b: &str) -> Result<bool, String> {
        GitRefs.is_ancestor(r, a, b)
    }
    fn git_version(&self, r: &Path) -> Result<(u32, u32), String> {
        GitRefs.git_version(r)
    }
    fn head(&self, r: &Path) -> Result<Option<(String, Option<String>)>, String> {
        GitRefs.head(r)
    }
    fn update_refs(&self, r: &Path, ops: &[super::merge::RefOp]) -> Result<TxOutcome, String> {
        GitRefs.update_refs(r, ops)
    }
    fn list_refs(&self, r: &Path, prefix: &str) -> Result<Vec<(String, String)>, String> {
        let mut seen = self.seen.lock().unwrap();
        seen.push(prefix.to_string());
        if seen.len() == 1 {
            return Ok(vec![(format!("{prefix}done/x"), "1".repeat(40))]);
        }
        GitRefs.list_refs(r, prefix)
    }
}

#[test]
fn start_redraws_run_id_when_short_name_is_taken() {
    let h = harness();
    let hand = Arc::new(TakenOnce { seen: Mutex::new(Vec::new()) });
    h.o.set_integrator(hand.clone());
    let r = repo("taken");
    let run = h.o.start_integrated_run(start_req(&r)).unwrap().0;
    let seen = hand.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 2, "한 번 다시 뽑았다");
    assert_ne!(seen[0], seen[1]);
    assert_eq!(seen[1], refs::run_prefix(&run), "쓴 이름은 비어 있던 둘째");
    let integ = run_of(&h.o, &run).integration.unwrap();
    assert_eq!(integ.work_ref, refs::int(&run));
    assert!(!integ.work_ref.starts_with(&seen[0]));
    assert!(rev(&r, &integ.work_ref).is_some());
    // 같은 저장소의 다음 Run 은 진짜 목록으로 본다 — 앞 Run 의 짧은 이름과 겹치지 않는다.
    h.o.set_integrator(Arc::new(GitRefs));
    let run2 = h.o.start_integrated_run(start_req(&r)).unwrap().0;
    assert_ne!(refs::run_prefix(&run2), refs::run_prefix(&run));
}
