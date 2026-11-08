//! 10-15 시험 — **서버가 집행하는 작업자 커밋**(`commit_changes` — `commit.rs`). 진짜 git 으로 임시 저장소 · worktree 에서 돈다. 서버 손
//! (작업자 띄우기)은 가짜이고, worktree 는 시험이 `git worktree add` 로 만든 뒤 Attempt 에 묶는다.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::commit::{check_path, child_env, commit_blocking, final_message, CommitJob, Selection};
use super::model::*;
use super::spawn::*;
use super::store::*;
use crate::audit::AuditRecord;

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Fake {
    jobs: Mutex<Vec<LaunchJob>>,
}

impl WorkerLauncher for Fake {
    fn launch(&self, job: LaunchJob) {
        self.jobs.lock().unwrap().push(job);
    }
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-commit-{}-{tag}-{}-{}",
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

/// 시험 준비용 git(신원 · 서명은 인자로 — 사람 PC 설정에 기대지 않는다).
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

fn write(p: &Path, s: &str) {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(p, s).unwrap();
}

/// 임시 저장소(신원은 저장소 설정 — 서버가 그것을 쓴다) + Run 하나.
struct Env {
    root: PathBuf,
    repo: PathBuf,
    o: Arc<Orchestration>,
    fake: Arc<Fake>,
    run: String,
    coord: Caller,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn env(tag: &str) -> Env {
    let root = scratch(tag);
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q", "-b", "main"]).ok);
    assert!(git(&repo, &["config", "user.name", "Repo Person"]).ok);
    assert!(git(&repo, &["config", "user.email", "repo@example.invalid"]).ok);
    assert!(git(&repo, &["config", "core.autocrlf", "false"]).ok);
    write(&repo.join("a.txt"), "a\n");
    write(&repo.join("keep.txt"), "keep\n");
    assert!(git(&repo, &["add", "."]).ok);
    assert!(git(&repo, &["commit", "-q", "-m", "init"]).ok);
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::new(None, emit, Some(tx)));
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    super::test_album::delegate_all(&o);
    let run = o
        .start_run(StartRun {
            verify: None,
            name: "commit".into(),
            repo: repo.to_string_lossy().into_owned(),
            worktree_dir: root.join("repo-wt").to_string_lossy().into_owned(),
            limits: Limits::default(),
        })
        .unwrap()
        .0;
    let coord = o.coordinator_caller(&run).unwrap();
    Env {
        root,
        repo,
        o,
        fake,
        run,
        coord,
        audit: Mutex::new(rx),
    }
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

/// 작업자 하나 — Task · spawn · 진짜 worktree(`git worktree add -b`) · 묶기. (attemptId, 작업자 호출자, worktree, 브랜치).
fn worker(e: &Env, name: &str) -> (String, Caller, PathBuf, String) {
    let task = call(&e.o, &e.coord, "create_task", json!({ "requestId": format!("t-{name}"), "title": name, "goal": "g" })).unwrap()["task"]
        ["id"]
        .as_str()
        .unwrap()
        .to_string();
    let v = call(&e.o, &e.coord, "spawn_worker", json!({ "requestId": format!("s-{name}"), "taskId": task, "role": super::test_album::WRITER_CODEX })).unwrap();
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
    (att, w, path, branch)
}

fn commit(e: &Env, w: &Caller, args: Value) -> Result<Value, String> {
    call(&e.o, w, "commit_changes", args)
}

fn branch_tip(e: &Env, branch: &str) -> String {
    out(&e.repo, &["rev-parse", &format!("refs/heads/{branch}")])
}

fn files_of(e: &Env, commit: &str) -> Vec<String> {
    let s = out(&e.repo, &["diff-tree", "--no-commit-id", "--name-only", "-r", commit]);
    s.lines().map(str::to_string).collect()
}

fn server_env() -> Vec<(OsString, OsString)> {
    std::env::vars_os().collect()
}

// ---------------------------------------------------------------------------
// 순수
// ---------------------------------------------------------------------------

#[test]
fn worker_preallow_includes_commit_changes() {
    assert!(WORKER_ALLOWED_TOOLS.contains(&"commit_changes"));
    assert!(super::tools::WORKER_TOOLS.contains(&"commit_changes"));
    assert!(!super::COORDINATOR_TOOLS.contains(&"commit_changes"), "조정자는 커밋하지 않는다");
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
    let dash = claude.iter().position(|a| a == "--").unwrap();
    let at = claude.iter().position(|a| a == "mcp__aynx-sessions-dev__commit_changes").expect("Claude --allowedTools");
    assert!(at < dash);
    let codex = super::turn::turn_argv(&base(WorkerCli::Codex));
    assert!(codex.contains(&"mcp_servers.aynx-sessions-dev.tools.commit_changes.approval_mode='approve'".to_string()));
    // 첫 지시 안내문 — commit_changes 로 커밋한 뒤 report_done.
    let body = task_body(&Task {
        id: "task-1".into(),
        title: "t".into(),
        goal: "g".into(),
        scope: String::new(),
        done_when: String::new(),
        depends_on: Vec::new(),
        version: 1,
        state: TaskState::Active,
        current_attempt: None,
        created_at: 0,
        updated_at: 0,
        conflict: None,
        review: Default::default(),
        rework_count: 0,
    });
    assert!(body.contains("commit_changes"), "{body}");
    assert!(body.find("commit_changes").unwrap() < body.find("report_done").unwrap());
}

#[test]
fn commit_message_gets_trailers_and_drops_forged_ones() {
    let m = final_message("Fix it\r\n\r\nbody\x07\nAynx-Task: task-evil\n", "task-1", "att-2").unwrap();
    assert_eq!(m, "Fix it\n\nbody\n\nAynx-Task: task-1\nAynx-Attempt: att-2\n");
    assert!(final_message("  \n\t", "t", "a").is_none());
}

#[test]
fn child_env_strips_git_vars() {
    let vars = vec![
        (OsString::from("GIT_DIR"), OsString::from("C:/other")),
        (OsString::from("git_index_file"), OsString::from("x")),
        (OsString::from("PATH"), OsString::from("C:/bin")),
        (OsString::from("HOME"), OsString::from("C:/h")),
    ];
    let kept: Vec<String> = child_env(vars).into_iter().map(|(k, _)| k.to_string_lossy().into_owned()).collect();
    assert_eq!(kept, vec!["PATH".to_string(), "HOME".to_string()]);
}

// ---------------------------------------------------------------------------
// 진짜 git
// ---------------------------------------------------------------------------

#[test]
fn commit_changes_only_own_worktree_and_branch() {
    let e = env("own");
    let (_a, wa, pa, ba) = worker(&e, "a");
    let (_b, _wb, pb, bb) = worker(&e, "b");
    let tip_b = branch_tip(&e, &bb);
    write(&pa.join("a.txt"), "changed by a\n");
    write(&pb.join("a.txt"), "changed by b\n");
    let v = commit(&e, &wa, json!({ "requestId": "c1", "message": "a: change", "selection": "all" })).unwrap();
    let sha = v["commitSha"].as_str().unwrap().to_string();
    assert_eq!(v["branch"], ba.as_str());
    assert_eq!(branch_tip(&e, &ba), sha, "자기 브랜치에");
    assert_eq!(branch_tip(&e, &bb), tip_b, "다른 작업자의 브랜치는 그대로");
    assert_eq!(branch_tip(&e, "main"), out(&e.repo, &["rev-parse", "HEAD"]), "주 브랜치도 그대로");
    // 신원 = 저장소 설정 · trailer.
    let author = out(&e.repo, &["log", "-1", "--format=%an <%ae>|%cn", &sha]);
    assert_eq!(author, "Repo Person <repo@example.invalid>|Repo Person");
    let body = out(&e.repo, &["log", "-1", "--format=%B", &sha]);
    assert!(body.contains("Aynx-Task: task-") && body.contains("Aynx-Attempt: att-"), "{body}");
    // 다른 브랜치로 바꾸면 거절.
    assert!(git(&pa, &["checkout", "-q", "-b", "elsewhere"]).ok);
    write(&pa.join("a.txt"), "again\n");
    assert_eq!(code(commit(&e, &wa, json!({ "requestId": "c2", "message": "m", "selection": "all" }))), "branch-mismatch");
    assert_eq!(branch_tip(&e, "elsewhere"), sha, "바뀐 브랜치에는 쓰지 않았다");
    // 감사 — worker_committed(파일 수 · 요청 id, 메시지 없음).
    let recs: Vec<AuditRecord> = {
        let rx = e.audit.lock().unwrap();
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    };
    let line = serde_json::to_string(recs.iter().find(|r| r.event == "worker_committed").expect("감사")).unwrap();
    assert!(line.contains(&sha) && line.contains("\"changedFiles\":1") && line.contains("c1"), "{line}");
    assert!(!line.contains("a: change"), "메시지는 감사에 없다: {line}");
    cleanup(&e.root);
}

#[test]
fn commit_changes_ignores_request_paths_outside() {
    let e = env("outside");
    let (_a, w, p, b) = worker(&e, "x");
    // 다른 저장소 — 요청이 cwd · gitDir · ref 로 가리켜도 무시된다.
    let other = e.root.join("other");
    std::fs::create_dir_all(&other).unwrap();
    assert!(git(&other, &["init", "-q", "-b", "main"]).ok);
    write(&p.join("a.txt"), "mine\n");
    let v = commit(
        &e,
        &w,
        json!({ "requestId": "c1", "message": "m", "selection": "all",
                "cwd": other.to_string_lossy(), "gitDir": other.join(".git").to_string_lossy(), "ref": "refs/heads/main", "gitArgs": ["-c", "x=y"] }),
    )
    .unwrap();
    assert_eq!(branch_tip(&e, &b), v["commitSha"].as_str().unwrap());
    assert!(!git(&other, &["rev-parse", "--verify", "-q", "HEAD"]).ok, "다른 저장소에는 아무것도 없다");
    // 밖 · .git · 절대 경로는 거절.
    write(&e.root.join("repo-wt").join("outside.txt"), "o\n");
    write(&p.join("a.txt"), "again\n");
    for bad in ["../outside.txt", ".git/config", ".GIT/HEAD", "sub/.git./x", "C:/Windows/win.ini", "/etc/passwd", "a:b"] {
        let r = commit(&e, &w, json!({ "requestId": format!("bad-{bad}"), "message": "m", "selection": { "paths": [bad] } }));
        assert_eq!(code(r), "path-outside", "{bad}");
    }
    // 정션 · 심볼릭 링크 폴더를 거쳐 밖을 가리키면 거절(링크를 만들 수 있을 때만 본다).
    let link = p.join("lnk");
    let target = e.root.join("repo-wt");
    let made = {
        #[cfg(windows)]
        {
            std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J", &link.to_string_lossy(), &target.to_string_lossy()])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(&target, &link).is_ok()
        }
    };
    if made {
        let wt_real = super::worktree::real_path(&p).unwrap();
        assert_eq!(check_path(&wt_real, "lnk/outside.txt").unwrap_err().code, "path-outside");
        let _ = super::worktree::unlink_links(&p, &[]);
    }
    cleanup(&e.root);
}

#[test]
fn commit_changes_rejects_configured_filters() {
    let e = env("filters");
    let (_a, w, p, b) = worker(&e, "f");
    let tip = branch_tip(&e, &b);
    // 저장소 설정에 clean 필터 · 속성이 그 이름을 쓴다 → 거절(아무것도 커밋하지 않는다).
    assert!(git(&e.repo, &["config", "filter.prismtest.clean", "cat"]).ok);
    write(&p.join(".gitattributes"), "*.dat filter=prismtest\n");
    write(&p.join("x.dat"), "data\n");
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "c1", "message": "m", "selection": "all" }))), "filters-configured");
    assert_eq!(
        code(commit(&e, &w, json!({ "requestId": "c2", "message": "m", "selection": { "paths": ["x.dat"] } }))),
        "filters-configured"
    );
    assert_eq!(branch_tip(&e, &b), tip);
    // 그 속성을 쓰지 않는 파일만 고르면 된다(시스템 설정의 filter.lfs 처럼 설정만 있는 것은 막지 않는다).
    write(&p.join("plain.txt"), "p\n");
    let v = commit(&e, &w, json!({ "requestId": "c3", "message": "m", "selection": { "paths": ["plain.txt"] } })).unwrap();
    assert_eq!(files_of(&e, v["commitSha"].as_str().unwrap()), vec!["plain.txt".to_string()]);
    cleanup(&e.root);
}

#[test]
fn commit_changes_uses_temp_index_and_cas() {
    let e = env("cas");
    let (att, w, p, b) = worker(&e, "c");
    // 작업자가 실제 index 에 stage 해 둔 것은 섞이지 않는다(전용 임시 index).
    write(&p.join("staged.txt"), "staged by worker\n");
    assert!(git(&p, &["add", "staged.txt"]).ok);
    write(&p.join("a.txt"), "edited\n");
    let v = commit(&e, &w, json!({ "requestId": "c1", "message": "only a", "selection": { "paths": ["a.txt"] } })).unwrap();
    assert_eq!(files_of(&e, v["commitSha"].as_str().unwrap()), vec!["a.txt".to_string()]);
    // 커밋 뒤 실제 index 는 새 HEAD 에 맞춰졌다 — a.txt 는 깨끗, staged.txt 는 남은 변경(추적 안 된 파일)으로.
    let st = out(&p, &["status", "--porcelain"]);
    assert!(!st.contains("a.txt"), "{st}");
    assert!(st.contains("staged.txt"), "{st}");
    // CAS — 서버가 커밋을 만든 뒤 · ref 갱신 직전에 브랜치가 움직이면 head-moved(그 커밋은 브랜치에 오르지 않는다).
    write(&p.join("a.txt"), "edited twice\n");
    let mover = p.clone();
    let moved = Arc::new(Mutex::new(String::new()));
    let m2 = Arc::clone(&moved);
    let hook = move || {
        write(&mover.join("race.txt"), "r\n");
        assert!(git(&mover, &["add", "race.txt"]).ok);
        assert!(git(&mover, &["commit", "-q", "-m", "race"]).ok);
        *m2.lock().unwrap() = out(&mover, &["rev-parse", "HEAD"]);
    };
    let r = e.o.commit_changes_with(
        &e.run,
        &att,
        Some(&json!({ "requestId": "c2", "message": "m", "selection": { "paths": ["a.txt"] } })),
        server_env(),
        &hook,
    );
    assert_eq!(r.unwrap_err().code, "head-moved");
    assert_eq!(branch_tip(&e, &b), *moved.lock().unwrap(), "움직인 브랜치를 덮지 않았다");
    // expectedHead 가 틀리면 아무것도 하기 전에 head-moved.
    let r = commit(&e, &w, json!({ "requestId": "c3", "message": "m", "selection": "all", "expectedHead": v["commitSha"] }));
    assert_eq!(code(r), "head-moved");
    // 직접 부르기 — 임시 index 는 남지 않는다.
    let idx = e.root.join("idx");
    let hooks = e.root.join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    let sel = Selection::All;
    let job = CommitJob {
        repo: &e.repo,
        worktree: &p,
        branch: &b,
        expected_head: None,
        selection: &sel,
        message: "direct\n",
        hooks_dir: &hooks,
        index_dir: &idx,
        env: server_env(),
        markers: None,
    };
    let c = commit_blocking(&job, &|| {}).unwrap();
    assert_eq!(branch_tip(&e, &b), c.commit);
    assert_eq!(std::fs::read_dir(&idx).unwrap().count(), 0, "임시 index 를 지웠다");
    cleanup(&e.root);
}

#[test]
fn commit_changes_partial_selection_reports_remaining() {
    let e = env("partial");
    let (_a, w, p, _b) = worker(&e, "p");
    write(&p.join("a.txt"), "edited\n");
    write(&p.join("new/one.txt"), "1\n");
    write(&p.join("two.txt"), "2\n");
    std::fs::remove_file(p.join("keep.txt")).unwrap();
    let v = commit(&e, &w, json!({ "requestId": "c1", "message": "part", "selection": { "paths": ["new\\one.txt", "keep.txt"] } })).unwrap();
    let mut got = files_of(&e, v["commitSha"].as_str().unwrap());
    got.sort();
    assert_eq!(got, vec!["keep.txt".to_string(), "new/one.txt".to_string()], "삭제도 고른 파일이면 커밋된다");
    assert_eq!(v["files"], 2);
    let mut remaining: Vec<String> = v["remaining"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
    remaining.sort();
    assert_eq!(remaining, vec!["a.txt".to_string(), "two.txt".to_string()]);
    // 남은 것을 전부.
    let v2 = commit(&e, &w, json!({ "requestId": "c2", "message": "rest", "selection": "all" })).unwrap();
    assert_eq!(v2["parent"], v["commitSha"]);
    assert_eq!(v2["remaining"].as_array().unwrap().len(), 0);
    // 더 없으면 nothing-to-commit · 폴더는 받지 않는다.
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "c3", "message": "m", "selection": "all" }))), "nothing-to-commit");
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "c4", "message": "m", "selection": { "paths": ["new"] } }))), "invalid-argument");
    // 보드 기록 — 첫 줄 · 파일 수만.
    let d = e.o.run_detail(&e.run).unwrap();
    let commits = d["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0]["subject"], "part");
    assert_eq!(commits[0]["files"], 2);
    cleanup(&e.root);
}

#[test]
fn commit_changes_idempotent() {
    let e = env("idem");
    let (_a, w, p, b) = worker(&e, "i");
    write(&p.join("a.txt"), "edited\n");
    let first = commit(&e, &w, json!({ "requestId": "same", "message": "m", "selection": "all" })).unwrap();
    write(&p.join("a.txt"), "edited again\n");
    let again = commit(&e, &w, json!({ "requestId": "same", "message": "m", "selection": "all" })).unwrap();
    assert_eq!(first, again, "같은 requestId 는 처음 결과");
    assert_eq!(branch_tip(&e, &b), first["commitSha"].as_str().unwrap(), "두 번 커밋하지 않았다");
    // 다른 도구가 쓴 id 와 섞이지 않는다 — 같은 id 로 report_done 은 다른 도구라 거절되지 않는다(작업자 요청 공간은 Attempt 이름표가 붙는다)
    // — 여기서는 커밋 기록 수만 본다.
    assert_eq!(e.o.run_detail(&e.run).unwrap()["commits"].as_array().unwrap().len(), 1);
    cleanup(&e.root);
}

#[test]
fn commit_changes_strips_git_env() {
    let e = env("env");
    let (att, _w, p, b) = worker(&e, "e");
    let other = e.root.join("other");
    std::fs::create_dir_all(&other).unwrap();
    assert!(git(&other, &["init", "-q", "-b", "main"]).ok);
    write(&p.join("a.txt"), "edited\n");
    let mut polluted = server_env();
    for (k, v) in [
        ("GIT_DIR", other.join(".git").to_string_lossy().into_owned()),
        ("GIT_WORK_TREE", other.to_string_lossy().into_owned()),
        ("GIT_INDEX_FILE", e.root.join("junk.index").to_string_lossy().into_owned()),
        ("GIT_AUTHOR_NAME", "Evil".to_string()),
        ("GIT_COMMITTER_EMAIL", "evil@example.invalid".to_string()),
        ("GIT_CONFIG_PARAMETERS", "'core.hooksPath'='C:/evil'".to_string()),
    ] {
        polluted.push((OsString::from(k), OsString::from(v)));
    }
    let v = e
        .o
        .commit_changes_with(&e.run, &att, Some(&json!({ "requestId": "c1", "message": "m", "selection": "all" })), polluted, &|| {})
        .unwrap();
    let sha = v["commitSha"].as_str().unwrap();
    assert_eq!(branch_tip(&e, &b), sha);
    assert_eq!(out(&e.repo, &["log", "-1", "--format=%an|%ce", sha]), "Repo Person|repo@example.invalid");
    assert!(!git(&other, &["rev-parse", "--verify", "-q", "HEAD"]).ok);
    assert!(!e.root.join("junk.index").exists());
    cleanup(&e.root);
}

#[test]
fn commit_changes_needs_identity() {
    let e = env("ident");
    let (att, _w, p, b) = worker(&e, "n");
    let tip = branch_tip(&e, &b);
    assert!(git(&e.repo, &["config", "--unset", "user.name"]).ok);
    assert!(git(&e.repo, &["config", "--unset", "user.email"]).ok);
    write(&p.join("a.txt"), "edited\n");
    // 전역 설정(사람 PC 의 신원)을 떼어 낸다 — HOME · USERPROFILE · XDG_CONFIG_HOME 를 빈 폴더로.
    let home = e.root.join("home");
    std::fs::create_dir_all(&home).unwrap();
    let mut vars: Vec<(OsString, OsString)> = server_env()
        .into_iter()
        .filter(|(k, _)| {
            let k = k.to_string_lossy().to_ascii_uppercase();
            k != "HOME" && k != "USERPROFILE" && k != "XDG_CONFIG_HOME"
        })
        .collect();
    for k in ["HOME", "USERPROFILE", "XDG_CONFIG_HOME"] {
        vars.push((OsString::from(k), home.clone().into_os_string()));
    }
    let r = e.o.commit_changes_with(&e.run, &att, Some(&json!({ "requestId": "c1", "message": "m", "selection": "all" })), vars, &|| {});
    assert_eq!(r.unwrap_err().code, "no-git-identity");
    assert_eq!(branch_tip(&e, &b), tip);
    cleanup(&e.root);
}

#[test]
fn report_after_commit_changes_is_clean() {
    let e = env("report");
    let (_a, w, p, _b) = worker(&e, "r");
    write(&p.join("a.txt"), "done\n");
    let v = commit(&e, &w, json!({ "requestId": "c1", "message": "finish", "selection": "all" })).unwrap();
    let rep = call(&e.o, &w, "report_done", json!({ "requestId": "r1", "outcome": "success", "summary": "done" })).unwrap();
    assert_eq!(rep["commitOid"], v["commitSha"]);
    assert_eq!(rep["dirty"], false);
    assert_eq!(rep["noChanges"], false);
    assert!(rep["mismatch"].is_null());
    assert!(rep.get("warning").is_none(), "{rep}");
    // 보고 뒤에는 커밋하지 않는다.
    write(&p.join("a.txt"), "late\n");
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "c2", "message": "m", "selection": "all" }))), "already-reported");
    // 수락된다.
    let d = e.o.run_detail(&e.run).unwrap();
    let task = d["tasks"][0].clone();
    call(
        &e.o,
        &e.coord,
        "update_task",
        json!({ "requestId": "acc", "taskId": task["id"], "version": task["version"], "state": "accepted" }),
    )
    .unwrap();
    cleanup(&e.root);
}

#[test]
fn report_without_changes_is_marked_and_branch_switch_is_mismatch() {
    let e = env("nochg");
    let (_a, w, _p, _b) = worker(&e, "z");
    let rep = call(&e.o, &w, "report_done", json!({ "requestId": "r1", "outcome": "success", "summary": "nothing" })).unwrap();
    assert_eq!(rep["noChanges"], true);
    assert_eq!(rep["dirty"], false);
    let (_a2, w2, p2, _b2) = worker(&e, "y");
    assert!(git(&p2, &["checkout", "-q", "-b", "other-branch"]).ok);
    let rep2 = call(&e.o, &w2, "report_done", json!({ "requestId": "r2", "outcome": "success", "summary": "moved" })).unwrap();
    assert_eq!(rep2["mismatch"], "branch-changed");
    cleanup(&e.root);
}

#[test]
fn commit_rejections_are_recorded_and_human_ones_notify_once() {
    let e = env("reject");
    let (att, w, p, b) = worker(&e, "r");
    let tip = branch_tip(&e, &b);
    let drain = || -> Vec<AuditRecord> {
        let rx = e.audit.lock().unwrap();
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    };
    drain();
    // 1) 작업자가 고칠 수 있는 거절(nothing-to-commit) — 타임라인 · 감사 · 마지막 거절 칸, 알림은 없다.
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "n1", "message": "secret message body", "selection": "all" }))), "nothing-to-commit");
    let d = e.o.run_detail(&e.run).unwrap();
    let ev = d["log"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(ev["action"], "commit_rejected");
    assert_eq!(ev["outcome"], "nothing-to-commit");
    assert_eq!(ev["target"], att.as_str());
    assert_eq!(ev["requestId"], "n1");
    assert!(ev.get("files").is_none(), "all 은 파일 수가 없다");
    let a = d["attempts"].as_array().unwrap().iter().find(|x| x["id"] == att.as_str()).unwrap().clone();
    assert_eq!(a["lastCommitRejection"]["reason"], "nothing-to-commit");
    assert_eq!(a["lastCommitRejection"]["needsHuman"], false);
    assert!(e.o.notices_view().as_array().unwrap().is_empty(), "작업자가 고칠 거절은 알리지 않는다");
    let recs = drain();
    let line = serde_json::to_string(recs.iter().find(|r| r.event == "commit_rejected").expect("감사")).unwrap();
    assert!(line.contains("\"reason\":\"nothing-to-commit\"") && line.contains("n1"), "{line}");
    assert!(!line.contains("secret message body"), "메시지 본문은 감사에 없다: {line}");

    // 2) 사람이 해야 하는 거절(filters-configured) — 알림 하나, 같은 사유가 되풀이돼도(창이 이미 확인했어도) 다시 알리지 않는다.
    assert!(git(&e.repo, &["config", "filter.prismtest.clean", "cat"]).ok);
    write(&p.join(".gitattributes"), "*.dat filter=prismtest\n");
    write(&p.join("secret-name.dat"), "data\n");
    for (i, rid) in ["f1", "f2"].iter().enumerate() {
        let r = commit(&e, &w, json!({ "requestId": rid, "message": "m", "selection": { "paths": ["secret-name.dat", ".gitattributes"] } }));
        assert_eq!(code(r), "filters-configured", "{i}");
    }
    assert_eq!(branch_tip(&e, &b), tip);
    let notices = e.o.notices_view();
    let ns: Vec<&Value> = notices.as_array().unwrap().iter().filter(|n| n["kind"] == "commit-rejected").collect();
    assert_eq!(ns.len(), 1, "{notices}");
    assert_eq!(ns[0]["detail"], "filters-configured");
    assert_eq!(ns[0]["attemptId"], att.as_str());
    let d = e.o.run_detail(&e.run).unwrap();
    let log = d["log"].as_array().unwrap();
    let rej: Vec<&Value> = log.iter().filter(|x| x["action"] == "commit_rejected").collect();
    assert_eq!(rej.len(), 3);
    assert_eq!(rej[2]["files"], 2);
    assert_eq!(rej[2]["requestId"], "f2");
    let text = serde_json::to_string(&d).unwrap();
    assert!(!text.contains("secret-name.dat"), "경로는 Run 기록에 없다");
    // 조정자 get_run · read_worker 요약에도.
    let g = call(&e.o, &e.coord, "get_run", json!({})).unwrap();
    let ga = g["attempts"].as_array().unwrap().iter().find(|x| x["id"] == att.as_str()).unwrap().clone();
    assert_eq!(ga["lastCommitRejection"]["reason"], "filters-configured");
    assert_eq!(ga["lastCommitRejection"]["needsHuman"], true);
    assert_eq!(ga["lastCommitRejection"]["requestId"], "f2");
    let rw = call(&e.o, &e.coord, "read_worker", json!({ "attemptId": att })).unwrap();
    assert_eq!(rw["attempt"]["lastCommitRejection"]["reason"], "filters-configured", "{rw}");
    // 감사 — 같은 고정 칸(파일 수 · 사유 · 요청 id).
    let recs = drain();
    let line = serde_json::to_string(recs.iter().rev().find(|r| r.event == "commit_rejected").unwrap()).unwrap();
    assert!(line.contains("\"changedFiles\":2") && line.contains("filters-configured") && !line.contains("secret-name"), "{line}");
    // 창이 확인한 뒤에도 같은 사유의 되풀이는 다시 알리지 않는다(타임라인 · 보드 칸에는 남는다).
    let ids: Vec<String> = ns.iter().map(|n| n["id"].as_str().unwrap().to_string()).collect();
    assert_eq!(e.o.notices_ack(&ids), 1);
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "f3", "message": "m", "selection": { "paths": ["secret-name.dat"] } }))), "filters-configured");
    assert!(e.o.notices_view().as_array().unwrap().is_empty());
    // 사유가 바뀌었다가(작업자가 고칠 것 — 알림 없음) 사람이 해야 하는 사유로 돌아오면 다시 알린다.
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "x1", "message": "m", "selection": { "paths": ["../out.txt"] } }))), "path-outside");
    assert!(e.o.notices_view().as_array().unwrap().is_empty());
    assert_eq!(code(commit(&e, &w, json!({ "requestId": "f4", "message": "m", "selection": { "paths": ["secret-name.dat"] } }))), "filters-configured");
    assert_eq!(e.o.notices_view().as_array().unwrap().len(), 1);

    // 3) 커밋이 서면 마지막 거절 칸이 걷힌다.
    write(&p.join("plain.txt"), "p\n");
    commit(&e, &w, json!({ "requestId": "ok1", "message": "m", "selection": { "paths": ["plain.txt"] } })).unwrap();
    let d = e.o.run_detail(&e.run).unwrap();
    let a = d["attempts"].as_array().unwrap().iter().find(|x| x["id"] == att.as_str()).unwrap().clone();
    assert!(a.get("lastCommitRejection").is_none(), "{a}");
    cleanup(&e.root);
}
