//! 통합 설계 3b 시험(docs/log/2026-10-15-orchestration-integration-design.md 4-6 · 3-2 · 10절 3b 행) — **임시 저장소에서 진짜 git 으로**:
//! 같은 줄 충돌 → `conflict` → 조정자의 `spawn_worker` = 해결 Attempt(통합 머리 + 표식 박힌 파일 · 충돌 아닌 병합 결과가 깔린 worktree) →
//! 가짜 해결자가 표식을 풀고 `commit_changes` → `report_done{resolved}` → 수락 → 통합 커밋. 표식 남긴 커밋 · 보고 거절, CRLF 표식,
//! `conflict-marker-size` 속성, 바이너리 충돌은 사람에게(`conflict-needs-human`), 해결 중 통합 머리가 또 움직이면 깨끗한 통합 또는 다시 충돌.
//!
//! 서버 손은 시험용이지만 **운영과 같은 함수**로 자리를 만든다 — `worktree::create_blocking` → `attempt_worktree` → `seed_conflict` →
//! `attempt_spawned`(CLI 는 띄우지 않는다). 해결자의 손(파일 고치기)은 시험이 한다. 먼저 보고한 Task 들은 3단계 시험처럼 배관 명령으로
//! 만든 커밋을 장부에 적는다.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};

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
        "aynx-stage3b-{}-{tag}-{}-{}",
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
    let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        s.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    (out.status.code().unwrap_or(-1), s)
}

fn git(dir: &Path, args: &[&str]) -> String {
    let (code, out) = git_env(dir, args, &[], None);
    assert_eq!(code, 0, "git {args:?} failed: {out}");
    out
}

/// 저장소 하나 — `f.txt`(다섯 줄 — CRLF 면 줄 끝이 `\r\n`) · `g.txt` · `keep.txt` 와 (있으면) `.gitattributes` 를 담은 첫 커밋.
fn repo(tag: &str, crlf: bool, attrs: Option<&str>) -> PathBuf {
    let d = scratch(tag).join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Threeb"]);
    git(&d, &["config", "user.email", "stage3b@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    let nl = if crlf { "\r\n" } else { "\n" };
    std::fs::write(d.join("f.txt"), ["one", "two", "three", "four", "five", ""].join(nl)).unwrap();
    std::fs::write(d.join("g.txt"), "g\n").unwrap();
    std::fs::write(d.join("keep.txt"), "keep\n").unwrap();
    if let Some(a) = attrs {
        std::fs::write(d.join(".gitattributes"), a).unwrap();
    }
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

/// `parent` 위에 파일 몇 개를 바꾼 커밋 하나(배관 명령). `None` 내용 = 지우기.
fn commit_on(repo: &Path, parent: &str, files: &[(&str, Option<&[u8]>)], msg: &str) -> String {
    let idx = scratch("idx").join("index");
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    let (c, o) = git_env(repo, &["read-tree", parent], &env, None);
    assert_eq!(c, 0, "{o}");
    for (path, body) in files {
        match body {
            Some(b) => {
                let (c, blob) = git_env(repo, &["hash-object", "-w", "--stdin"], &env, Some(b));
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

fn rev(repo: &Path, name: &str) -> Option<String> {
    let (c, o) = git_env(repo, &["rev-parse", "--verify", "--quiet", name], &[], None);
    (c == 0).then_some(o)
}

fn show(repo: &Path, spec: &str) -> String {
    git(repo, &["show", spec])
}

/// f.txt 의 둘째 줄만 바꾼 내용.
fn f_with(line2: &str, crlf: bool) -> Vec<u8> {
    let nl = if crlf { "\r\n" } else { "\n" };
    ["one", line2, "three", "four", "five", ""].join(nl).into_bytes()
}

// ---------------------------------------------------------------------------
// 하네스 — 운영과 같은 함수로 자리를 만드는 서버 손
// ---------------------------------------------------------------------------

struct Launched {
    attempt: String,
    token: String,
    path: String,
    base: Base,
    prompt: Option<String>,
}

#[derive(Default)]
struct RealHand {
    o: Mutex<Weak<Orchestration>>,
    jobs: Mutex<Vec<Launched>>,
}

impl WorkerLauncher for RealHand {
    fn launch(&self, job: LaunchJob) {
        let o = self.o.lock().unwrap().upgrade().expect("orchestration");
        let name = super::spawn::worktree_name(&job.task.id, &job.attempt_id);
        let c = super::worktree::create_blocking(
            Path::new(&job.repo),
            &job.worktree_dir,
            &name,
            &job.base,
            &job.run_id,
            None,
            &super::worktree::empty_hooks_dir(),
        )
        .expect("worktree");
        assert!(o.attempt_worktree(&job.run_id, &job.attempt_id, &c.path, &c.branch, &c.base_commit));
        if let Some(seed) = &job.seed {
            super::seed_conflict(Path::new(&c.path), seed).expect("seed");
        }
        o.attempt_spawned(&job.run_id, &job.attempt_id, None);
        self.jobs.lock().unwrap().push(Launched {
            attempt: job.attempt_id.clone(),
            token: job.token.clone(),
            path: c.path,
            base: job.base.clone(),
            prompt: job.seed.as_ref().map(|s| s.prompt.clone()),
        });
    }
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

struct H {
    o: Arc<Orchestration>,
    hand: Arc<RealHand>,
    _audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(crate::operations::now_ms)));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    o.set_integrator(Arc::new(GitRefs));
    let hand = Arc::new(RealHand::default());
    *hand.o.lock().unwrap() = Arc::downgrade(&o);
    o.set_launcher(hand.clone());
    super::test_album::delegate_all(&o);
    H { o, hand, _audit: Mutex::new(rx) }
}

fn start(o: &Orchestration, repo: &Path) -> (String, Caller) {
    let run = o
        .start_integrated_run(StartRun {
            verify: None,
            name: "stage3b".into(),
            repo: repo.display().to_string(),
            worktree_dir: repo.parent().unwrap().join("wt").display().to_string(),
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

fn err_code(r: Result<Value, String>) -> String {
    let e = r.expect_err("거절이어야 한다");
    e.split(':').next().unwrap_or_default().to_string()
}

fn create_task(o: &Orchestration, c: &Caller, req: &str, title: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": title, "goal": "g" })).unwrap();
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

/// "끝난 작업자가 성공 보고함"(3단계 시험과 같은 틀) — 보고 커밋 `commit` · 기준 `base`.
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
        summary: format!("did {task}"),
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

/// 해결자 하나를 띄운다 — `(attemptId, 작업자 호출자, worktree, spawn 답)`.
fn spawn_resolver(h: &H, c: &Caller, task: &str, req: &str) -> (String, Caller, PathBuf, Value) {
    let v = call(&h.o, c, "spawn_worker", json!({ "requestId": req, "taskId": task, "role": super::test_album::WRITER })).unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    let jobs = h.hand.jobs.lock().unwrap();
    let j = jobs.iter().find(|j| j.attempt == att).expect("서버 손이 자리를 만들었다");
    let w = h.o.resolve(Some(&format!("Bearer {}", j.token))).expect("작업자 토큰");
    (att, w, PathBuf::from(&j.path), v)
}

fn commit_all(o: &Orchestration, w: &Caller, req: &str) -> Result<Value, String> {
    call(o, w, "commit_changes", json!({ "requestId": req, "message": "resolve the conflict", "selection": "all" }))
}

fn report(o: &Orchestration, w: &Caller, req: &str, resolved: Value) -> Result<Value, String> {
    call(o, w, "report_done", json!({ "requestId": req, "outcome": "success", "summary": "resolved", "resolved": resolved }))
}

/// 같은 줄 충돌 하나를 만든다 — A(둘째 줄 `two-A`) 통합 · B(둘째 줄 `two-B` + 다른 파일 변경)는 충돌. `(run, 조정자, 시작 기준, A 뒤 머리, B)`.
fn conflicted(h: &H, r: &Path, crlf: bool, b_extra: &[(&str, Option<&[u8]>)]) -> (String, Caller, String, String, String) {
    let (run, c) = start(&h.o, r);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a", "A");
    let b = create_task(&h.o, &c, "b", "B");
    let fa = f_with("two-A", crlf);
    let fb = f_with("two-B", crlf);
    let ca = commit_on(r, &base, &[("f.txt", Some(fa.as_slice()))], "a");
    let mut bf: Vec<(&str, Option<&[u8]>)> = vec![("f.txt", Some(fb.as_slice()))];
    bf.extend_from_slice(b_extra);
    let cb = commit_on(r, &base, &bf, "b");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    let h1 = head(&h.o, &run);
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Conflict);
    (run, c, base, h1, b)
}

fn read(p: &Path) -> Vec<u8> {
    std::fs::read(p).unwrap()
}

fn has(hay: &[u8], needle: &str) -> bool {
    hay.windows(needle.len()).any(|w| w == needle.as_bytes())
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

#[test]
fn text_conflict_resolver_end_to_end() {
    let h = harness();
    let r = repo("e2e", false, None);
    // B 는 충돌 줄 말고도 g.txt 를 지우고 n.txt 를 더했다 — 충돌 아닌 병합 결과도 해결 자리에 깔려야 한다.
    let (run, c, _base, h1, b) = conflicted(&h, &r, false, &[("g.txt", None), ("n.txt", Some(b"new\n".as_slice()))]);
    let info = task_of(&h.o, &run, &b).conflict.unwrap();
    assert!(!info.needs_human, "표식이 실제로 박힌 일반 텍스트 충돌");
    let (att, w, wt, v) = spawn_resolver(&h, &c, &b, "s1");
    // 답 · 장부 — 해결 Attempt · 기준 = 그때의 통합 머리.
    assert_eq!(v["base"], h1.as_str());
    assert_eq!(v["resolves"]["jobId"], info.job_id.as_str());
    assert_eq!(v["resolves"]["paths"], json!(["f.txt"]));
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Active);
    let a = run_of(&h.o, &run).attempts.into_iter().find(|x| x.id == att).unwrap();
    assert_eq!(a.resolves.as_deref(), Some(info.job_id.as_str()));
    assert_eq!(a.base_commit.as_deref(), Some(h1.as_str()));
    assert!(h.hand.jobs.lock().unwrap().iter().any(|j| j.attempt == att && j.base == Base::Commit(h1.clone())));
    assert!(h.hand.jobs.lock().unwrap().iter().find(|j| j.attempt == att).unwrap().prompt.as_deref().unwrap().contains("- f.txt"));
    // 자리 — HEAD = 통합 머리 · 표식 박힌 f.txt · g.txt 지움 · n.txt 새 파일(index 는 그대로).
    assert_eq!(git(&wt, &["rev-parse", "HEAD"]), h1);
    let f = read(&wt.join("f.txt"));
    assert!(has(&f, "<<<<<<< ") && has(&f, "\n=======\n") && has(&f, ">>>>>>> "), "{}", String::from_utf8_lossy(&f));
    assert!(!wt.join("g.txt").exists());
    assert_eq!(read(&wt.join("n.txt")), b"new\n");
    assert_eq!(git(&wt, &["diff", "--cached", "--name-only", "HEAD"]), "", "index · HEAD 는 안 바뀐다");
    // get_task — 충돌 안내.
    let t = call(&h.o, &w, "get_task", json!({})).unwrap();
    let cr = &t["conflictResolution"];
    assert_eq!(cr["integrationHead"], h1.as_str());
    assert_eq!(cr["conflicts"][0]["path"], "f.txt");
    assert_eq!(cr["conflicts"][0]["kind"], "contents");
    assert!(cr["conflicts"][0]["ours"].as_str().unwrap().len() == 40);
    assert!(cr["rules"].as_str().unwrap().contains("resolved"));
    // 표식을 남긴 채 커밋 → 거절(아무것도 커밋 안 됨).
    assert_eq!(err_code(commit_all(&h.o, &w, "c1")), "conflict-markers-left");
    assert_eq!(git(&wt, &["rev-parse", "HEAD"]), h1);
    // 표식을 풀고 커밋.
    std::fs::write(wt.join("f.txt"), f_with("two-A and two-B", false)).unwrap();
    let cm = commit_all(&h.o, &w, "c2").unwrap();
    let rc = cm["commitSha"].as_str().unwrap().to_string();
    assert_eq!(cm["parent"], h1.as_str());
    // resolved 가 빠지면 · 모르는 경로면 보고 거절(기록 없음).
    assert_eq!(err_code(report(&h.o, &w, "r1", json!([]))), "unresolved-conflicts");
    assert_eq!(err_code(report(&h.o, &w, "r2", json!([{ "path": "nope.txt", "how": "x" }]))), "invalid-argument");
    assert!(run_of(&h.o, &run).report_of(&att).is_none());
    let rep = report(&h.o, &w, "r3", json!([{ "path": "f.txt", "how": "kept both lines" }])).unwrap();
    assert_eq!(rep["taskState"], "reported");
    let saved = run_of(&h.o, &run).report_of(&att).unwrap().clone();
    assert_eq!(saved.resolved, vec![ResolvedPath { path: "f.txt".into(), how: "kept both lines".into() }]);
    assert_eq!(saved.commit_oid.as_deref(), Some(rc.as_str()));
    assert!(task_of(&h.o, &run, &b).conflict.is_some(), "보고 뒤 수락 전까지 충돌 기록은 남는다");
    // 수락 = 다시 통합(3단계 길) — 머리가 그대로면 깨끗하다.
    accept(&h.o, &c, &run, &b, "acc-b2").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted);
    // E2E 10-16 #7a — 통합이 서면 옛 충돌 기록은 걷는다(get_run 에도 없음) · 해결자의 `resolves` 는 역사로 남는다.
    assert!(task_of(&h.o, &run, &b).conflict.is_none());
    let gr = call(&h.o, &c, "get_run", json!({})).unwrap();
    let tv = gr["tasks"].as_array().unwrap().iter().find(|t| t["id"] == b.as_str()).cloned().unwrap();
    assert!(tv.get("conflict").is_none(), "{tv}");
    let a_after = run_of(&h.o, &run).attempts.into_iter().find(|x| x.id == att).unwrap();
    assert_eq!(a_after.resolves.as_deref(), Some(info.job_id.as_str()));
    let h2 = head(&h.o, &run);
    assert_eq!(git(&r, &["rev-parse", &format!("{h2}^")]), h1);
    assert_eq!(show(&r, &format!("{h2}:f.txt")), "one\ntwo-A and two-B\nthree\nfour\nfive");
    assert_eq!(show(&r, &format!("{h2}:n.txt")), "new");
    assert!(rev(&r, &format!("{h2}:g.txt")).is_none(), "B 의 지우기도 들어갔다");
    let art = run_of(&h.o, &run).valid_artifact(&b).unwrap().clone();
    assert_eq!(art.attempt_id, att);
    assert_eq!(art.base_commit_oid.as_deref(), Some(h1.as_str()), "mergeBase = 해결 자리의 기준(old)");
}

#[test]
fn report_refused_when_markers_committed_outside_commit_changes() {
    // 해결자가 commit_changes 밖에서(자기 git 으로) 표식째 커밋해도 보고가 거절한다.
    let h = harness();
    let r = repo("bypass", false, None);
    let (run, c, _base, _h1, b) = conflicted(&h, &r, false, &[]);
    let (att, w, wt, _) = spawn_resolver(&h, &c, &b, "s1");
    let branch = git(&wt, &["symbolic-ref", "--short", "HEAD"]);
    git(&wt, &["-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "-qam", "markers"]);
    assert!(branch.starts_with("orch-"));
    assert_eq!(err_code(report(&h.o, &w, "r1", json!([{ "path": "f.txt", "how": "x" }]))), "conflict-markers-left");
    assert!(run_of(&h.o, &run).report_of(&att).is_none(), "거절은 기록하지 않는다");
    // 실패 보고는 resolved · 표식 검사 없이 받는다(사람 · 조정자가 반려). (3a — `blocked` 는 보고가 아니라 비종결 표지라 `failure` 로.)
    let v = call(&h.o, &w, "report_done", json!({ "requestId": "r2", "outcome": "failure", "summary": "cannot" })).unwrap();
    assert_eq!(v["taskState"], "reported");
}

#[test]
fn crlf_markers_detected() {
    let h = harness();
    let r = repo("crlf", true, None);
    let (run, c, _base, h1, b) = conflicted(&h, &r, true, &[]);
    assert!(!task_of(&h.o, &run, &b).conflict.unwrap().needs_human);
    let (_att, w, wt, _) = spawn_resolver(&h, &c, &b, "s1");
    let f = read(&wt.join("f.txt"));
    assert!(has(&f, "\r\n=======\r\n"), "CRLF blob 의 표식 줄은 \\r\\n(0a C2): {:?}", String::from_utf8_lossy(&f));
    assert_eq!(err_code(commit_all(&h.o, &w, "c1")), "conflict-markers-left");
    // 여는 · 닫는 표식만 지우고 `=======` 를 남겨도 거절(원본 양쪽에 없던 줄).
    let half: Vec<u8> = String::from_utf8_lossy(&f)
        .split("\r\n")
        .filter(|l| !l.starts_with("<<<<<<<") && !l.starts_with(">>>>>>>"))
        .collect::<Vec<_>>()
        .join("\r\n")
        .into_bytes();
    std::fs::write(wt.join("f.txt"), &half).unwrap();
    assert_eq!(err_code(commit_all(&h.o, &w, "c2")), "conflict-markers-left");
    std::fs::write(wt.join("f.txt"), f_with("two-AB", true)).unwrap();
    commit_all(&h.o, &w, "c3").unwrap();
    report(&h.o, &w, "r1", json!([{ "path": "f.txt", "how": "merged" }])).unwrap();
    accept(&h.o, &c, &run, &b, "acc-b2").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted);
    assert_ne!(head(&h.o, &run), h1);
}

#[test]
fn marker_size_attribute_followed() {
    let h = harness();
    let r = repo("msize", false, Some("*.txt conflict-marker-size=12\n"));
    let (run, c, _base, _h1, b) = conflicted(&h, &r, false, &[]);
    let info = task_of(&h.o, &run, &b).conflict.unwrap();
    assert!(!info.needs_human, "표식 크기 12 를 따라 실측한다(0a K1)");
    let (_att, w, wt, _) = spawn_resolver(&h, &c, &b, "s1");
    let f = read(&wt.join("f.txt"));
    assert!(has(&f, "<<<<<<<<<<<< ") && !has(&f, "<<<<<<<<<<<<<"), "{}", String::from_utf8_lossy(&f));
    assert_eq!(err_code(commit_all(&h.o, &w, "c1")), "conflict-markers-left");
    std::fs::write(wt.join("f.txt"), f_with("two-merged", false)).unwrap();
    commit_all(&h.o, &w, "c2").unwrap();
}

#[test]
fn binary_conflict_needs_human_and_refuses_resolver() {
    let h = harness();
    let r = repo("bin", false, None);
    let (run, c) = start(&h.o, &r);
    let base0 = head(&h.o, &run);
    let base = commit_on(&r, &base0, &[("b.bin", Some(b"\0\x01base".as_slice()))], "bin");
    git(&r, &["update-ref", &refs::int(&run), &base, &base0]);
    {
        let mut g = h.o.lock();
        g.runs.get_mut(&run).unwrap().run.integration.as_mut().unwrap().expected_head = base.clone();
    }
    let a = create_task(&h.o, &c, "a", "A");
    let b = create_task(&h.o, &c, "b", "B");
    let ca = commit_on(&r, &base, &[("b.bin", Some(b"\0\x01aaa".as_slice()))], "a");
    let cb = commit_on(&r, &base, &[("b.bin", Some(b"\0\x01bbb".as_slice()))], "b");
    reported(&h.o, &run, &a, &base, &ca);
    reported(&h.o, &run, &b, &base, &cb);
    accept(&h.o, &c, &run, &a, "acc-a").unwrap();
    accept(&h.o, &c, &run, &b, "acc-b").unwrap();
    assert!(task_of(&h.o, &run, &b).conflict.unwrap().needs_human);
    assert_eq!(
        err_code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "s", "taskId": b, "role": super::test_album::WRITER }))),
        "conflict-needs-human"
    );
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Conflict, "거절 — 상태 그대로");
    assert!(h.hand.jobs.lock().unwrap().is_empty());
}

/// E2E 10-16 #7a — 충돌이 뜻을 잃는 전이(반려 · 취소)에서 충돌 기록을 걷는다.
#[test]
fn conflict_info_cleared_on_reject_and_cancel() {
    let h = harness();
    // 반려(사람 — 충돌 상태에서).
    let r = repo("clrrej", false, None);
    let (run, _c, _base, _h1, b) = conflicted(&h, &r, false, &[]);
    assert!(task_of(&h.o, &run, &b).conflict.is_some());
    let v = task_of(&h.o, &run, &b).version;
    h.o.human_review(&run, &b, v, Decision::Rejected).unwrap();
    let t = task_of(&h.o, &run, &b);
    assert_eq!(t.state, TaskState::Rejected);
    assert!(t.conflict.is_none(), "반려 — 충돌 기록 걷음");
    // 취소(사람 — 충돌 상태에서).
    let r2 = repo("clrcan", false, None);
    let (run2, _c2, _base2, _h12, b2) = conflicted(&h, &r2, false, &[]);
    let v2 = task_of(&h.o, &run2, &b2).version;
    h.o.set_task_state(&run2, &b2, v2, TaskState::Cancelled).unwrap();
    let t2 = task_of(&h.o, &run2, &b2);
    assert_eq!(t2.state, TaskState::Cancelled);
    assert!(t2.conflict.is_none(), "취소 — 충돌 기록 걷음");
}

#[test]
fn integration_head_moves_during_resolution_clean() {
    let h = harness();
    let r = repo("moveclean", false, None);
    let (run, c, base, h1, b) = conflicted(&h, &r, false, &[]);
    let (_att, w, wt, _) = spawn_resolver(&h, &c, &b, "s1");
    // 해결 중에 다른 Task(다른 파일)가 통합된다.
    let x = create_task(&h.o, &c, "x", "X");
    let cx = commit_on(&r, &base, &[("keep.txt", Some(b"KEEP\n".as_slice()))], "x");
    reported(&h.o, &run, &x, &base, &cx);
    accept(&h.o, &c, &run, &x, "acc-x").unwrap();
    let h2 = head(&h.o, &run);
    assert_ne!(h2, h1);
    std::fs::write(wt.join("f.txt"), f_with("two-AB", false)).unwrap();
    commit_all(&h.o, &w, "c1").unwrap();
    report(&h.o, &w, "r1", json!([{ "path": "f.txt", "how": "both" }])).unwrap();
    accept(&h.o, &c, &run, &b, "acc-b2").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted, "mergeBase = old 로 다시 3-way — 깨끗");
    let h3 = head(&h.o, &run);
    assert_eq!(git(&r, &["rev-parse", &format!("{h3}^")]), h2);
    assert_eq!(show(&r, &format!("{h3}:f.txt")), "one\ntwo-AB\nthree\nfour\nfive");
    assert_eq!(show(&r, &format!("{h3}:keep.txt")), "KEEP");
}

#[test]
fn integration_head_moves_during_resolution_conflicts_again() {
    let h = harness();
    let r = repo("moveagain", false, None);
    let (run, c, _base, h1, b) = conflicted(&h, &r, false, &[]);
    let (att1, w, wt, _) = spawn_resolver(&h, &c, &b, "s1");
    // 해결 중에 다른 Task 가 **같은 줄**을 또 바꿔 통합된다(통합 머리 h1 위에서).
    let y = create_task(&h.o, &c, "y", "Y");
    let fy = f_with("two-Y", false);
    let cy = commit_on(&r, &h1, &[("f.txt", Some(fy.as_slice()))], "y");
    reported(&h.o, &run, &y, &h1, &cy);
    accept(&h.o, &c, &run, &y, "acc-y").unwrap();
    let h2 = head(&h.o, &run);
    std::fs::write(wt.join("f.txt"), f_with("two-AB", false)).unwrap();
    let rc = commit_all(&h.o, &w, "c1").unwrap()["commitSha"].as_str().unwrap().to_string();
    report(&h.o, &w, "r1", json!([{ "path": "f.txt", "how": "both" }])).unwrap();
    accept(&h.o, &c, &run, &b, "acc-b2").unwrap();
    let t = task_of(&h.o, &run, &b);
    assert_eq!(t.state, TaskState::Conflict, "해결 결과가 새 머리와 다시 충돌");
    let info = t.conflict.unwrap();
    assert_eq!(info.old, h2);
    assert_eq!(info.report_commit, rc);
    assert_eq!(info.merge_base, h1);
    assert!(!info.needs_human);
    assert_eq!(head(&h.o, &run), h2, "충돌은 커밋을 만들지 않는다");
    // 다시 해결 Attempt — 이번 자리는 새 머리.
    let (att2, _w2, wt2, v2) = spawn_resolver(&h, &c, &b, "s2");
    assert_ne!(att1, att2);
    assert_eq!(v2["base"], h2.as_str());
    assert_eq!(git(&wt2, &["rev-parse", "HEAD"]), h2);
    let f = read(&wt2.join("f.txt"));
    assert!(has(&f, "<<<<<<< ") && has(&f, "two-Y") && has(&f, "two-AB"));
    // 앞 해결자의 토큰 · 커밋은 더 이상 현재 Attempt 가 아니다.
    assert_eq!(err_code(commit_all(&h.o, &w, "c2")), "stale-attempt");
}
