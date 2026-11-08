//! 통합 설계 1단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 8 · 10절) — **공용 git 실행기**(끝 코드 · 출력 상한),
//! 조정자 **`get_diff`**(고정 OID · 파일 목록 · 쪽 · 잘림 · 자기 Run 만 · textconv 안 돎), **보고 뒤 자동 종료**(턴 묶기 · 취소 ·
//! 재검사 · late 아님 · 끄기). git 쪽은 진짜 git 으로 임시 저장소에서, 자동 종료는 시계 · 신호를 시험이 쥔다(가짜 서버 손 · 가짜 probe).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::diff::{paginate, parse_name_status, parse_numstat};
use super::git::{child_env, Git};
use super::model::*;
use super::report::WorktreeState;
use super::spawn::*;
use super::store::*;
use super::test_album::{self as td, WRITER};

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

/// 서버 손 — 띄운 작업 · 멈춤 요청을 적는다.
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

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage1-{}-{tag}-{}-{}",
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

/// 시험 준비용 git(신원 · 서명은 인자로).
fn git(dir: &Path, args: &[&str]) -> crate::worktree::GitRun {
    let mut full = vec!["-c", "user.name=setup", "-c", "user.email=setup@example.invalid", "-c", "commit.gpgsign=false"];
    full.extend_from_slice(args);
    crate::worktree::run_git(dir, &full, crate::worktree::GIT_TIMEOUT).unwrap()
}

fn out(dir: &Path, args: &[&str]) -> String {
    let r = git(dir, args);
    assert!(r.ok, "git {args:?}: {}", r.stderr);
    r.stdout.trim().to_string()
}

fn write(p: &Path, s: &[u8]) {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(p, s).unwrap();
}

/// `_auto_stop` — 옛 시작 대화의 "보고 뒤 자동 종료" 칸(3a 에 동작이 걷혔고 3차 6단계에 시작 칸도 걷었다 — 부르는 쪽 모양만 남김).
fn start(o: &Orchestration, repo: &str, wt: &str, _auto_stop: bool) -> (String, Caller) {
    td::delegate_all(o);
    let run = o
        .start_run(StartRun {
            verify: None,
            name: "stage1".into(),
            repo: repo.into(),
            worktree_dir: wt.into(),
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

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

// ---------------------------------------------------------------------------
// 공용 git 실행기
// ---------------------------------------------------------------------------

fn small_repo(tag: &str) -> (PathBuf, PathBuf) {
    let root = scratch(tag);
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q", "-b", "main"]).ok);
    assert!(git(&repo, &["config", "user.name", "Repo Person"]).ok);
    assert!(git(&repo, &["config", "user.email", "repo@example.invalid"]).ok);
    assert!(git(&repo, &["config", "core.autocrlf", "false"]).ok);
    write(&repo.join("a.txt"), b"a\n");
    write(&repo.join("keep.txt"), b"keep\nkeep two\nkeep three\nkeep four\n");
    assert!(git(&repo, &["add", "."]).ok);
    assert!(git(&repo, &["commit", "-q", "-m", "init"]).ok);
    (root, repo)
}

#[test]
fn git_runner_keeps_exit_code() {
    let (root, repo) = small_repo("exit");
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let g = Git::new(&repo, &hooks, &env, reason::GIT_FAILED).unwrap();
    // 0 · 1 · 128 이 모두 그대로 온다(1 은 "아님" 이라는 뜻 — 실패로 뭉개지 않는다).
    let head = out(&repo, &["rev-parse", "HEAD"]);
    let ok = g.run(&["merge-base", "--is-ancestor", &head, &head], &[], None).unwrap();
    assert_eq!(ok.code, Some(0));
    assert!(ok.ok());
    let missing = g.run(&["rev-parse", "--verify", "-q", "refs/heads/nope"], &[], None).unwrap();
    assert_eq!(missing.code, Some(1), "{missing:?}");
    assert!(!missing.ok());
    let bad = g.run(&["cat-file", "-p", "0000000000000000000000000000000000000001"], &[], None).unwrap();
    assert_eq!(bad.code, Some(128), "{bad:?}");
    // `ok` 는 0 이 아니면 부르는 쪽의 사유 낱말로.
    let e = g.ok(&["rev-parse", "--verify", "-q", "refs/heads/nope"], &[], None).unwrap_err();
    assert_eq!(e.code, reason::GIT_FAILED);
    // 환경의 GIT_* 는 걷힌다(다른 저장소를 가리키게 해도 이 저장소를 읽는다).
    let evil: Vec<(OsString, OsString)> = std::env::vars_os()
        .chain([(OsString::from("GIT_DIR"), OsString::from(root.join("nowhere").as_os_str()))])
        .collect();
    let env2 = child_env(evil);
    let g2 = Git::new(&repo, &hooks, &env2, reason::GIT_FAILED).unwrap();
    assert_eq!(g2.ok(&["rev-parse", "HEAD"], &[], None).unwrap().trim(), head);
    cleanup(&root);
}

#[test]
fn git_runner_output_capped() {
    let (root, repo) = small_repo("cap");
    let big: String = (0..20_000).map(|i| format!("line {i:06} ................................\n")).collect();
    write(&repo.join("big.txt"), big.as_bytes());
    assert!(git(&repo, &["add", "big.txt"]).ok);
    assert!(git(&repo, &["commit", "-q", "-m", "big"]).ok);
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let mut g = Git::new(&repo, &hooks, &env, reason::GIT_FAILED).unwrap();
    g.limit = 1000;
    // 상한까지만 담고, 끝까지 읽어 끝 코드는 그대로 선다(파이프가 막혀 멈추지 않는다).
    let o = g.run(&["cat-file", "-p", "HEAD:big.txt"], &[], None).unwrap();
    assert_eq!(o.code, Some(0));
    assert!(o.truncated);
    assert_eq!(o.stdout.len(), 1000);
    // 성공을 요구하는 길은 잘린 글을 쓰지 않는다.
    let e = g.ok(&["cat-file", "-p", "HEAD:big.txt"], &[], None).unwrap_err();
    assert_eq!(e.code, reason::OUTPUT_TOO_LARGE);
    // 상한 안이면 잘리지 않는다.
    g.limit = 10 * 1024 * 1024;
    let full = g.run(&["cat-file", "-p", "HEAD:big.txt"], &[], None).unwrap();
    assert!(!full.truncated);
    assert_eq!(full.stdout.len(), big.len());
    cleanup(&root);
}

// ---------------------------------------------------------------------------
// get_diff — 순수
// ---------------------------------------------------------------------------

#[test]
fn diff_parsers_handle_renames_and_binary() {
    let ns = parse_name_status("M\0a.txt\0R087\0keep.txt\0kept.txt\0A\0new/b.txt\0D\0gone.txt\0");
    assert_eq!(
        ns,
        vec![
            ('M', None, "a.txt".to_string()),
            ('R', Some("keep.txt".to_string()), "kept.txt".to_string()),
            ('A', None, "new/b.txt".to_string()),
            ('D', None, "gone.txt".to_string()),
        ]
    );
    let num = parse_numstat(concat!("1\t1\ta.txt\0", "0\t1\t\0keep.txt\0kept.txt\0", "-\t-\tbin.dat\0"));
    assert_eq!(
        num,
        vec![
            ("a.txt".to_string(), Some(1), Some(1)),
            ("kept.txt".to_string(), Some(0), Some(1)),
            ("bin.dat".to_string(), None, None),
        ]
    );
}

#[test]
fn diff_pages_split_on_lines_and_cover_everything() {
    let patch: String = (0..100).map(|i| format!("+line {i}\n")).collect();
    let pages = paginate(&patch, 64);
    assert!(pages.len() > 1);
    assert!(pages.iter().all(|p| p.len() <= 64));
    assert!(pages.iter().all(|p| p.ends_with('\n')), "줄 경계에서");
    assert_eq!(pages.concat(), patch);
    // 한 쪽보다 긴 줄은 글자 경계에서(한글 — UTF-8 이 깨지지 않는다).
    let long = format!("{}\n", "가".repeat(100));
    let pages = paginate(&long, 64);
    assert!(pages.iter().all(|p| p.len() <= 64));
    assert_eq!(pages.concat(), long);
    // 빈 패치는 빈 쪽 하나.
    assert_eq!(paginate("", 64), vec![String::new()]);
}

#[test]
fn get_diff_is_a_coordinator_preallowed_read_tool() {
    assert!(super::COORDINATOR_TOOLS.contains(&"get_diff"), "조정자 미리 허용 목록도 이 표에서 나온다");
    assert!(!super::tools::WORKER_TOOLS.contains(&"get_diff"));
    let schemas = super::coordinator_tool_schemas();
    let s = schemas.iter().find(|s| s["name"] == "get_diff").expect("tools/list 에 get_diff");
    let props = s["inputSchema"]["properties"].as_object().unwrap();
    for k in ["taskId", "reportId", "path", "page", "runId"] {
        assert!(props.contains_key(k), "{k}");
    }
    assert!(s["description"].as_str().unwrap().contains("truncated"));
    // 표의 이름과 스키마 이름이 같다(미리 허용 · 디스패치가 한 표).
    let names: Vec<&str> = schemas.iter().filter_map(|s| s["name"].as_str()).collect();
    for t in super::COORDINATOR_TOOLS {
        assert!(names.contains(t), "{t}");
    }
    // (3a) 반려는 Task 의 열린 작업자를 닫고, 수락 규칙 · 되돌림 한도를 말한다.
    let upd = schemas.iter().find(|s| s["name"] == "update_task").unwrap()["description"].as_str().unwrap().to_string();
    assert!(upd.contains("A rejection closes the task's open worker"), "{upd}");
    assert!(upd.contains("accept-rule-unmet") && upd.contains("rework-limit"), "{upd}");
    assert!(upd.contains("get_diff"));
}

// ---------------------------------------------------------------------------
// get_diff — 진짜 git
// ---------------------------------------------------------------------------

struct Env {
    root: PathBuf,
    repo: PathBuf,
    o: Arc<Orchestration>,
    fake: Arc<Fake>,
    run: String,
    coord: Caller,
}

fn env(tag: &str) -> Env {
    let (root, repo) = small_repo(tag);
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let o = Arc::new(Orchestration::new(None, emit, None));
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    let (run, coord) = start(&o, &repo.to_string_lossy(), &root.join("repo-wt").to_string_lossy(), true);
    Env {
        root,
        repo,
        o,
        fake,
        run,
        coord,
    }
}

/// 작업자 하나 — Task · spawn · 진짜 worktree · 묶기. (taskId, attemptId, 작업자 호출자, worktree).
fn worker(e: &Env, name: &str) -> (String, String, Caller, PathBuf) {
    let task = call(&e.o, &e.coord, "create_task", json!({ "requestId": format!("t-{name}"), "title": name, "goal": "g" })).unwrap()["task"]
        ["id"]
        .as_str()
        .unwrap()
        .to_string();
    let v = call(&e.o, &e.coord, "spawn_worker", json!({ "requestId": format!("s-{name}"), "taskId": task, "role": td::WRITER_CODEX })).unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    let token = e.fake.jobs.lock().unwrap().iter().find(|j| j.attempt_id == att).unwrap().token.clone();
    let branch = format!("orch-{name}");
    let path = e.root.join("repo-wt").join(&branch);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let r = git(&e.repo, &["worktree", "add", "-q", "-b", &branch, &path.to_string_lossy(), "HEAD"]);
    assert!(r.ok, "{}", r.stderr);
    let base = out(&e.repo, &["rev-parse", "HEAD"]);
    assert!(e.o.attempt_worktree(&e.run, &att, &path.to_string_lossy(), &branch, &base));
    assert_eq!(e.o.attempt_spawned(&e.run, &att, Some(4242)), crate::orchestration::SpawnVerdict::Keep);
    let w = e.o.resolve(Some(&format!("Bearer {token}"))).expect("작업자 토큰");
    (task, att, w, path)
}

fn commit_and_report(e: &Env, w: &Caller) -> Value {
    call(&e.o, w, "commit_changes", json!({ "requestId": "c1", "message": "work", "selection": "all" })).unwrap();
    call(&e.o, w, "report_done", json!({ "requestId": "r1", "outcome": "success", "summary": "done" })).unwrap()
}

fn diff(e: &Env, args: Value) -> Result<Value, String> {
    call(&e.o, &e.coord, "get_diff", args)
}

#[test]
fn get_diff_lists_files_at_the_reports_fixed_commits() {
    let e = env("list");
    let (task, _att, w, wt) = worker(&e, "a");
    // 수정 · 새 파일 · 이름 바꿈 · 바이너리.
    write(&wt.join("a.txt"), b"a changed\n");
    write(&wt.join("new/b.txt"), b"b\n");
    std::fs::rename(wt.join("keep.txt"), wt.join("kept.txt")).unwrap();
    write(&wt.join("bin.dat"), &[0u8, 1, 2, 0, 255, 0, 7]);
    let rep = commit_and_report(&e, &w);
    let commit = rep["commitOid"].as_str().unwrap().to_string();
    let rid = rep["reportId"].as_str().unwrap().to_string();
    let v = diff(&e, json!({ "taskId": task })).unwrap();
    assert_eq!(v["reportId"], rid.as_str());
    assert_eq!(v["commit"], commit.as_str());
    assert_eq!(v["base"].as_str().unwrap().len(), 40);
    assert_eq!(v["truncated"], false);
    assert_eq!(v["fileCount"], 4);
    let files = v["files"].as_array().unwrap();
    let f = |p: &str| files.iter().find(|x| x["path"] == p).unwrap_or_else(|| panic!("{p}: {v}")).clone();
    assert_eq!(f("a.txt")["status"], "modified");
    assert_eq!(f("a.txt")["adds"], 1);
    assert_eq!(f("a.txt")["dels"], 1);
    assert_eq!(f("new/b.txt")["status"], "added");
    assert_eq!(f("kept.txt")["status"], "renamed");
    assert_eq!(f("kept.txt")["oldPath"], "keep.txt");
    assert_eq!(f("bin.dat")["binary"], true);
    assert!(f("bin.dat")["adds"].is_null());
    // 보고 뒤 worktree 가 바뀌어도(작업자가 손으로 더 커밋) 답은 그 보고의 OID 그대로.
    write(&wt.join("late.txt"), b"late\n");
    assert!(git(&wt, &["add", "late.txt"]).ok);
    assert!(git(&wt, &["commit", "-q", "-m", "after report"]).ok);
    let again = diff(&e, json!({ "taskId": task, "reportId": rid })).unwrap();
    assert_eq!(again["commit"], commit.as_str());
    assert_eq!(again["fileCount"], 4);
    // 파일 하나의 패치 — 그 커밋 · 그 파일만, 이름 바꿈은 짝을 잃지 않는다.
    let p = diff(&e, json!({ "taskId": task, "path": "a.txt" })).unwrap();
    assert_eq!(p["page"], 1);
    assert_eq!(p["pages"], 1);
    assert_eq!(p["truncated"], false);
    let patch = p["patch"].as_str().unwrap();
    assert!(patch.contains("+a changed"), "{patch}");
    assert!(!patch.contains("b.txt"));
    let r = diff(&e, json!({ "taskId": task, "path": "kept.txt" })).unwrap();
    assert!(r["patch"].as_str().unwrap().contains("rename from keep.txt"), "{r}");
    // 목록에 없는 경로 · 쪽 넘음 · 없는 보고.
    assert_eq!(code(diff(&e, json!({ "taskId": task, "path": "late.txt" }))), "not-found");
    assert_eq!(code(diff(&e, json!({ "taskId": task, "path": "a.txt", "page": 2 }))), "invalid-argument");
    assert_eq!(code(diff(&e, json!({ "taskId": task, "reportId": "rep-nope" }))), "not-found");
    cleanup(&e.root);
}

#[test]
fn get_diff_pages_a_long_patch_and_marks_truncation() {
    let e = env("pages");
    let (task, _att, w, wt) = worker(&e, "a");
    let mid: String = (0..3000).map(|i| format!("middle line {i:05} with some padding text\n")).collect();
    write(&wt.join("mid.txt"), mid.as_bytes());
    let huge: String = (0..40_000).map(|i| format!("huge line {i:06} with some more padding text here\n")).collect();
    write(&wt.join("huge.txt"), huge.as_bytes());
    commit_and_report(&e, &w);
    // 32 KiB 쪽 여럿 — 이어 붙이면 그 파일의 패치 전부.
    let first = diff(&e, json!({ "taskId": task, "path": "mid.txt" })).unwrap();
    let pages = first["pages"].as_u64().unwrap();
    assert!(pages > 1, "{}", first["pages"]);
    assert_eq!(first["truncated"], false);
    let mut all = String::new();
    for p in 1..=pages {
        let v = diff(&e, json!({ "taskId": task, "path": "mid.txt", "page": p })).unwrap();
        let s = v["patch"].as_str().unwrap();
        assert!(s.len() <= super::diff::PAGE_BYTES);
        all.push_str(s);
    }
    assert_eq!(all.matches("\n+middle line").count(), 3000);
    // 1 MiB 넘는 패치 — 잘렸다고 밝힌다.
    let h = diff(&e, json!({ "taskId": task, "path": "huge.txt" })).unwrap();
    assert_eq!(h["truncated"], true);
    assert!(h["note"].as_str().unwrap().contains("do not claim"));
    cleanup(&e.root);
}

#[test]
fn get_diff_file_list_is_capped_with_truncated() {
    let e = env("many");
    let (task, _att, w, wt) = worker(&e, "a");
    for i in 0..(super::diff::FILES_MAX + 5) {
        write(&wt.join(format!("f/{i:04}.txt")), format!("{i}\n").as_bytes());
    }
    commit_and_report(&e, &w);
    let v = diff(&e, json!({ "taskId": task })).unwrap();
    assert_eq!(v["truncated"], true);
    assert_eq!(v["fileCount"], super::diff::FILES_MAX + 5);
    assert_eq!(v["files"].as_array().unwrap().len(), super::diff::FILES_MAX);
    assert!(v["note"].as_str().unwrap().contains("do not claim"));
    cleanup(&e.root);
}

#[test]
fn get_diff_runs_no_textconv_and_only_own_run() {
    let e = env("own");
    let marker = e.root.join("textconv-ran");
    let cmd = format!("touch '{}' && cat", marker.to_string_lossy().replace('\\', "/"));
    assert!(git(&e.repo, &["config", "diff.mk.textconv", &cmd]).ok);
    let (task, _att, w, wt) = worker(&e, "a");
    write(&wt.join(".gitattributes"), b"*.txt diff=mk\n");
    write(&wt.join("a.txt"), b"a changed\n");
    commit_and_report(&e, &w);
    let p = diff(&e, json!({ "taskId": task, "path": "a.txt" })).unwrap();
    assert!(p["patch"].as_str().unwrap().contains("+a changed"));
    assert!(!marker.exists(), "get_diff 는 textconv 를 돌리지 않는다");
    // 다른 Run 의 조정자에게는 이 Task 가 없다 · 다른 runId 는 not-found.
    let (run2, c2) = start(&e.o, &e.repo.to_string_lossy(), &e.root.join("wt2").to_string_lossy(), true);
    assert_eq!(code(call(&e.o, &c2, "get_diff", json!({ "taskId": task }))), "not-found");
    assert_eq!(code(diff(&e, json!({ "runId": run2, "taskId": task }))), "not-found");
    // 작업자에게는 도구가 없다.
    let r = call(&e.o, &w, "get_diff", json!({ "taskId": task }));
    assert!(r.unwrap_err().starts_with("Unknown tool"));
    // 보드의 [파일 목록]은 같은 목록.
    let human = e.o.report_files(&e.run, &task, None).unwrap();
    let coord = diff(&e, json!({ "taskId": task })).unwrap();
    assert_eq!(human["files"], coord["files"]);
    assert_eq!(human["reportId"], coord["reportId"]);
    cleanup(&e.root);
}

// ---------------------------------------------------------------------------
// 보고 뒤 — 턴의 끝이 상태를 정한다(3a: 자동 종료를 걷었다 · 시계를 시험이 쥔다)
// ---------------------------------------------------------------------------

struct H {
    o: Arc<Orchestration>,
    clock: Arc<AtomicU64>,
    fake: Arc<Fake>,
    run: String,
    coord: Caller,
    att: String,
    task: String,
    worker: Caller,
    token: String,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let o = Arc::new(Orchestration::with_clock(None, emit, None, Arc::new(move || c.load(Ordering::SeqCst))));
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    // 보고의 git 읽기 — 커밋 하나 · 깨끗함(브랜치 · 기준은 모름 = 불일치 없음).
    o.set_probe(Arc::new(|_: &Path, _: Option<&str>| {
        Ok(WorktreeState {
            head: Some("a".repeat(40)),
            ..Default::default()
        })
    }));
    let (run, coord) = start(&o, "C:/repo", "C:/repo-wt", true);
    let task = call(&o, &coord, "create_task", json!({ "requestId": "t1", "title": "T", "goal": "g" })).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let v = call(&o, &coord, "spawn_worker", json!({ "requestId": "s1", "taskId": task, "role": WRITER })).unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    assert!(o.attempt_worktree(&run, &att, "C:/repo-wt/orch-x", "orch-x", &"b".repeat(40)));
    assert_eq!(o.attempt_spawned(&run, &att, Some(7)), crate::orchestration::SpawnVerdict::Keep);
    let token = fake.jobs.lock().unwrap().iter().find(|j| j.attempt_id == att).unwrap().token.clone();
    let worker = o.resolve(Some(&format!("Bearer {token}"))).unwrap();
    let d = o.run_detail(&run).unwrap();
    assert!(d["attempts"][0]["conversationId"].as_str().is_some(), "Claude 는 띄울 때 대화 id 를 정한다");
    H {
        o,
        clock,
        fake,
        run,
        coord,
        att,
        task,
        worker,
        token,
    }
}

impl H {
    /// 턴의 자연 끝(트리 확인 · 종료 코드 0).
    fn end_turn(&self) {
        self.o.attempt_process_exited(&self.run, &self.att, true, Some(0));
    }
    fn later(&self, ms: u64) {
        self.clock.fetch_add(ms, Ordering::SeqCst);
    }
    fn report(&self) -> Value {
        call(&self.o, &self.worker, "report_done", json!({ "requestId": "r1", "outcome": "success", "summary": "done" })).unwrap()
    }
    fn attempt(&self) -> Value {
        let d = self.o.run_detail(&self.run).unwrap();
        d["attempts"].as_array().unwrap().iter().find(|a| a["id"] == self.att.as_str()).unwrap().clone()
    }
    fn stops(&self) -> usize {
        self.fake.stops.lock().unwrap().iter().filter(|a| **a == self.att).count()
    }
}

/// (3a) 자동 종료를 걷었다 — 보고한 턴은 **턴의 자연 끝**에 `reported`(닫힘)가 되고, 서버 손에 멈춤을 보내지 않는다. 그 턴의 토큰은 트리
/// 확인 뒤 거둔다.
#[test]
fn reported_at_turn_end_without_stop() {
    let h = harness();
    let rep = h.report();
    assert_eq!(rep["late"], false);
    assert_eq!(h.attempt()["state"], "running", "보고는 턴 안 — 상태는 턴 끝에 정한다");
    h.later(600_000);
    h.o.tick();
    assert_eq!(h.stops(), 0, "보고 뒤 멈춤 예약이 없다");
    h.end_turn();
    assert_eq!(h.attempt()["state"], "reported");
    assert_eq!(h.stops(), 0);
    assert!(h.o.resolve(Some(&format!("Bearer {}", h.token))).is_none(), "턴 끝(트리 확인) 뒤 그 턴의 토큰을 거둔다");
    let d = h.o.run_detail(&h.run).unwrap();
    assert!(!d["log"].as_array().unwrap().iter().any(|e| e["action"] == "worker_auto_stopped"));
    assert!(d.get("autoStop").is_none(), "자동 종료 보기 칸은 없다");
    assert_eq!(d["reports"][0]["late"], false, "보고는 턴 안에 섰다 — late 로 바뀌지 않는다");
    assert_eq!(d["tasks"][0]["state"], "reported");
    // 그대로 수락할 수 있다.
    let v = d["tasks"][0]["version"].as_u64().unwrap();
    let acc = call(&h.o, &h.coord, "update_task", json!({ "requestId": "u1", "taskId": h.task, "version": v, "state": "accepted" })).unwrap();
    assert_eq!(acc["task"]["state"], "accepted");
}

/// 보고 없이 끝난 턴은 `idle`(열림 — 조정자가 `send_prompt` 로 잇는다) · 알림 `worker-idle` · 멈춤 없음.
#[test]
fn turn_end_without_report_is_idle() {
    let h = harness();
    h.end_turn();
    assert_eq!(h.attempt()["state"], "idle");
    assert_eq!(h.stops(), 0);
    assert!(h.o.resolve(Some(&format!("Bearer {}", h.token))).is_none(), "idle 에는 산 토큰이 없다");
    let n = h.o.notices_view();
    assert!(n.as_array().unwrap().iter().any(|x| x["kind"] == "worker-idle"), "{n}");
    let d = h.o.run_detail(&h.run).unwrap();
    assert_eq!(d["tasks"][0]["state"], "active", "Task 는 그대로");
}

/// 보고한 턴이 중단으로 끝나면 `stopped`(닫힘) — 보고는 그대로 · late 아님.
#[test]
fn stop_after_report_keeps_report() {
    let h = harness();
    h.report();
    call(&h.o, &h.coord, "stop_worker", json!({ "requestId": "x", "attemptId": h.att })).unwrap();
    assert_eq!(h.stops(), 1);
    h.end_turn();
    assert_eq!(h.attempt()["state"], "stopped");
    let d = h.o.run_detail(&h.run).unwrap();
    assert_eq!(d["reports"][0]["late"], false);
    assert_eq!(d["tasks"][0]["state"], "reported");
}

/// (3차 6단계) 2차 시작 대화의 옛 칸(`workerPermission` · `attachMode` · `autoStopReported` · `allowedClis` · `requireReview` · `reviewerClis`) —
/// 새 Run 은 쓰지 않고, 옛 파일의 값은 읽어 다시 저장할 때 그대로 둔다(옛 파일 호환).
#[test]
fn old_start_fields_read_and_kept_new_runs_do_not_write() {
    let h = harness();
    let mut v = serde_json::to_value(&h.o.lock().runs.get(&h.run).unwrap().run).unwrap();
    for k in ["workerPermission", "attachMode", "autoStopReported", "allowedClis", "requireReview", "reviewerClis", "deliveries"] {
        assert!(v.get(k).is_none(), "새 Run 파일에 {k}");
    }
    let o = v.as_object_mut().unwrap();
    o.insert("workerPermission".into(), json!("fullAuto"));
    o.insert("attachMode".into(), json!("always"));
    o.insert("autoStopReported".into(), json!(false));
    o.insert("allowedClis".into(), json!(["claude", "codex"]));
    o.insert("requireReview".into(), json!(true));
    o.insert("reviewerClis".into(), json!(["codex"]));
    let r: Run = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(r.worker_permission, Some(WorkerPermission::FullAuto));
    assert_eq!(r.attach_mode, Some(AttachMode::Always));
    assert_eq!(r.auto_stop_reported, Some(false));
    assert!(r.legacy_require_review());
    let back = serde_json::to_value(&r).unwrap();
    for k in ["workerPermission", "attachMode", "autoStopReported", "allowedClis", "requireReview", "reviewerClis"] {
        assert_eq!(back[k], v[k], "다시 저장해도 옛 값 그대로: {k}");
    }
}
