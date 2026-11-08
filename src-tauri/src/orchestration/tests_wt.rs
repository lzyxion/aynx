//! worktree **공통 구현** 시험(`worktree.rs` — 예약 · 곁 기록 · 보수적 지우기)과 사람의 지우기 op(`orchestration_wt_remove` — 보드의
//! [worktree 지우기]). 진짜 git 으로 임시 저장소에서 돌린다 — 곁 파일 · 훅 폴더는 시험마다 임시 자리라 진짜 `worktrees.json` 을 건드리지 않는다.
//!
//! (3차 6단계 · 헤드리스 설계 Q6) 조정자 MCP worktree 도구 셋(`list_worktrees` · `create_worktree` · `remove_worktree`)과 `aynx wt` CLI 는
//! 걷었다 — 작업자 worktree 는 서버가 만들고(`spawn_worker`) 정리는 사람의 [정리] · [worktree 지우기]다. 그 도구들이 지키던 규칙(같은 실제 경로
//! 열쇠 · 링크 먼저 걷기 · 자리 밖 거절)은 공통 구현의 규칙이라 여기서 사람 op 와 공통 함수로 그대로 지킨다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};

use serde_json::{json, Value};

use super::model::*;
use super::spawn::Base;
use super::store::*;
use super::worktree as owt;

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-orchwt-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 시험 폴더를 지운다 — **링크를 먼저 걷고**(정션 대상이 지워지지 않게) 그 폴더 하나만.
fn cleanup(dir: &Path) {
    let _ = owt::unlink_links(dir, &[]);
    let _ = std::fs::remove_dir_all(dir);
}

fn git(dir: &Path, args: &[&str]) -> crate::worktree::GitRun {
    let mut full = vec!["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    full.extend_from_slice(args);
    crate::worktree::run_git(dir, &full, crate::worktree::GIT_TIMEOUT).unwrap()
}

/// 임시 저장소 + Run 하나(저장소 · `<root>/repo-wt`) + 임시 곁 파일 · 훅 폴더(서버에 곁 파일을 꽂는다 — 사람 op 가 읽는 자리).
struct Env {
    root: PathBuf,
    repo: PathBuf,
    side: PathBuf,
    hooks: PathBuf,
    o: Arc<Orchestration>,
    run: String,
}

fn env(tag: &str) -> Env {
    let root = scratch(tag);
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    assert!(git(&repo, &["init", "-q", "-b", "main"]).ok);
    std::fs::write(repo.join("a.txt"), "a\n").unwrap();
    assert!(git(&repo, &["add", "."]).ok);
    assert!(git(&repo, &["commit", "-q", "-m", "init"]).ok);
    let side = root.join("worktrees.json");
    let hooks = root.join("empty-hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, _rx) = mpsc::channel();
    let o = Arc::new(Orchestration::new(None, emit, Some(tx)));
    o.set_sidecar(Some(side.clone()));
    super::test_album::delegate_all(&o);
    let run = o
        .start_run(StartRun {
            verify: None,
            name: "wt".into(),
            repo: repo.to_string_lossy().into_owned(),
            worktree_dir: root.join("repo-wt").to_string_lossy().into_owned(),
            limits: Limits::default(),
        })
        .unwrap()
        .0;
    Env { root, repo, side, hooks, o, run }
}

/// 이 Run 의 worktree 하나(서버 `spawn_worker` 가 쓰는 공통 함수 그대로 — 곁 파일에 `run` 칸).
fn make(e: &Env, name: &str, base: &Base) -> Result<owt::Created, OrchError> {
    owt::create_blocking(&e.repo, &e.root.join("repo-wt").to_string_lossy(), name, base, &e.run, Some(&e.side), &e.hooks)
}

/// 사람의 [worktree 지우기](op `orchestration_wt_remove`) — 실패면 이유 낱말.
fn remove(e: &Env, path: &str, delete_branch: bool) -> Result<Value, String> {
    super::ops::handle("orchestration_wt_remove", json!({ "runId": e.run, "path": path, "deleteBranch": delete_branch }), &e.o)
        .map_err(|w| w.message.trim_start_matches('[').split(']').next().unwrap_or_default().to_string())
}

fn put_attempt(e: &Env, task: &str, state: AttemptState, path: &str, branch: &str) -> String {
    let att = new_id("att").unwrap();
    let mut g = e.o.lock();
    let slot = g.runs.get_mut(&e.run).unwrap();
    slot.run.attempts.push(Attempt {
        id: att.clone(),
        task_id: task.into(),
        cli: WorkerCli::Claude,
        gen: slot.run.gen,
        state,
        stream: None,
        worktree: Some(path.into()),
        branch: Some(branch.into()),
        base_commit: Some("0".repeat(40)),
        pid: None,
        conversation_id: None,
        launch_args: None,
        attention: None,
        started_at: 0,
        ended_at: None,
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
    att
}

/// (3차 6단계 · Q6) 조정자 worktree 도구 셋은 없다 — 조정자 목록 · 미리 허용 표 · 스키마 어디에도 없고 부르면 모르는 도구다.
#[test]
fn worktree_tools_are_gone() {
    let e = env("gone");
    let c = e.o.coordinator_caller(&e.run).unwrap();
    let names: Vec<String> = super::coordinator_tool_schemas().iter().map(|s| s["name"].as_str().unwrap().to_string()).collect();
    for n in ["list_worktrees", "create_worktree", "remove_worktree"] {
        assert!(!super::is_tool_for(&c, n), "{n}");
        assert!(!super::COORDINATOR_TOOLS.contains(&n), "{n} — 미리 허용 표");
        assert!(!names.iter().any(|x| x == n), "{n} — 스키마");
        let err = e.o.call_tool(&c, n, Some(&json!({ "requestId": "x", "name": "n", "path": "C:/x" }))).unwrap_err();
        assert!(err.starts_with("Unknown tool"), "{n}: {err}");
    }
    cleanup(&e.root);
}

/// 사람의 [worktree 지우기] 규칙(보수적 — `worktree.rs` 머리말): 사람이 만든 것 · 미커밋 · 병합 안 된 브랜치 삭제 · 쓰는 중은 거절, 끝난 작업자의
/// 것은 브랜치를 남기고 지운다(Attempt 의 worktree 칸이 빈다).
#[test]
fn human_remove_rules() {
    let e = env("rules");
    // 사람이 만든 worktree — 거절, 그대로.
    let human = e.root.join("repo-wt").join("human");
    assert!(git(&e.repo, &["worktree", "add", "-q", "-b", "human", &human.to_string_lossy()]).ok);
    assert_eq!(remove(&e, &human.to_string_lossy(), false).unwrap_err(), "not-run-worktree");
    assert!(human.is_dir());
    // 이 Run 의 것(곁 파일에 그 Run 으로 적혔다) — 미커밋 변경이면 거절.
    let made = make(&e, "orch-rules", &Base::Main).unwrap();
    assert_eq!(made.branch, "orch-rules");
    assert_eq!(made.base_commit.len(), 40);
    let path = made.path.clone();
    let file = crate::worktree::load_sidecar(&e.side);
    assert_eq!(crate::worktree::run_of(&file, &crate::worktree::path_key(&path)), Some(e.run.clone()));
    std::fs::write(Path::new(&path).join("b.txt"), "b\n").unwrap();
    assert_eq!(remove(&e, &path, false).unwrap_err(), "worktree-dirty");
    // 커밋 — 병합 안 된 브랜치 삭제 요청은 아무것도 하지 않고 거절.
    assert!(git(Path::new(&path), &["add", "."]).ok);
    assert!(git(Path::new(&path), &["commit", "-q", "-m", "work"]).ok);
    assert_eq!(remove(&e, &path, true).unwrap_err(), "branch-has-unmerged");
    assert!(Path::new(&path).is_dir(), "거절이면 worktree 도 그대로");
    // 작업자가 쓰는 중이면 거절(worktree-in-use).
    let att = put_attempt(&e, "", AttemptState::Working, &path, "orch-rules");
    assert_eq!(remove(&e, &path, false).unwrap_err(), "worktree-in-use");
    // 끝난 작업자 — 브랜치는 남기고 지운다. Attempt 의 worktree 칸이 빈다.
    e.o.lock().runs.get_mut(&e.run).unwrap().run.attempts.iter_mut().find(|a| a.id == att).unwrap().state = AttemptState::Stopped;
    let r = remove(&e, &path, false).unwrap();
    assert_eq!(r["removed"], true);
    assert_eq!(r["branchDeleted"], false);
    assert!(!Path::new(&path).exists());
    assert!(git(&e.repo, &["show-ref", "--verify", "--quiet", "refs/heads/orch-rules"]).ok, "브랜치는 남는다");
    assert!(e.o.lock().runs.get(&e.run).unwrap().run.attempts.iter().find(|a| a.id == att).unwrap().worktree.is_none());
    assert!(crate::worktree::run_of(&crate::worktree::load_sidecar(&e.side), &crate::worktree::path_key(&path)).is_none());
    // 정한 커밋에서 만들기 — 기준은 커밋 id · 옵션 같은 기준 · 자리 밖 이름은 거절.
    let head = git(&e.repo, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    let b = make(&e, "orch-base", &Base::Commit(head[..12].to_string())).unwrap();
    assert_eq!(b.base_commit, head);
    assert_eq!(make(&e, "x", &Base::Commit("--help".into())).unwrap_err().code, reason::INVALID_ARGUMENT);
    assert_eq!(make(&e, "../escape", &Base::Main).unwrap_err().code, reason::INVALID_ARGUMENT);
    assert_eq!(make(&e, "orch-base", &Base::Main).unwrap_err().code, reason::WORKTREE_FAILED, "있는 브랜치는 거절");
    cleanup(&e.root);
}

/// 아무것도 띄우지 않는 서버 손(이어 쓰기 시험 — `spawn_worker` 가 서려면 손이 있어야 한다).
#[derive(Default)]
struct NoLaunch;

impl super::spawn::WorkerLauncher for NoLaunch {
    fn launch(&self, _job: super::spawn::LaunchJob) {}
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

/// 리뷰 F4 — "쓰는 중" 검사와 지우기가 **같은 실제 경로 열쇠**를 쓴다(`…/x/.` · 구분자 · 끝 `/` 별칭이 검사를 피하지 못한다). 지우는 동안의
/// 예약은 이어 쓰기 · 다른 지우기와 서로 막는다.
#[test]
fn worktree_in_use_and_removal_share_real_path_key() {
    let e = env("f4");
    e.o.set_launcher(Arc::new(NoLaunch));
    let c = e.o.coordinator_caller(&e.run).unwrap();
    let path = make(&e, "orch-f4", &Base::Main).unwrap().path;
    let task = e.o.call_tool(&c, "create_task", Some(&json!({ "requestId": "t", "title": "T", "goal": "g" }))).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let live = put_attempt(&e, &task, AttemptState::Working, &path, "orch-f4");
    for alias in [format!("{path}/."), format!("{path}\\"), path.replace('\\', "/"), format!("{path}/sub/..")] {
        assert_eq!(owt::wt_key(&alias), owt::wt_key(&path), "{alias}");
        assert_eq!(remove(&e, &alias, false).unwrap_err(), "worktree-in-use", "{alias}");
    }
    assert!(Path::new(&path).is_dir());
    // 끝난 작업자 — 이어 쓸 수 있는 자리. 지우기가 자리를 쥔 동안에는 이어 쓰기 · 다른 지우기가 막힌다.
    {
        let mut g = e.o.lock();
        let slot = g.runs.get_mut(&e.run).unwrap();
        slot.run.attempts.iter_mut().find(|a| a.id == live).unwrap().state = AttemptState::Stopped;
        slot.run.tasks.iter_mut().find(|t| t.id == task).unwrap().state = TaskState::Rejected;
    }
    let key = e.o.begin_worktree_removal(&e.run, &format!("{path}/.")).unwrap();
    assert_eq!(key, owt::wt_key(&path));
    let reuse = e.o.call_tool(
        &c,
        "spawn_worker",
        Some(&json!({ "requestId": "s1", "taskId": task, "role": super::test_album::WRITER, "reuseWorktreeOf": live })),
    );
    assert!(reuse.unwrap_err().starts_with("worktree-in-use"), "지우는 중인 자리는 이어 쓰지 않는다");
    assert_eq!(remove(&e, &path, false).unwrap_err(), "worktree-in-use");
    assert!(e.o.begin_worktree_removal(&e.run, &path).is_err(), "두 번째 지우기 예약");
    e.o.end_worktree_claim(&e.run, &key);
    // 예약이 풀리면 이어 쓰기가 선다 — 이어 쓰는 동안(산 Attempt)은 지우기가 막힌다.
    let v = e
        .o
        .call_tool(
            &c,
            "spawn_worker",
            Some(&json!({ "requestId": "s2", "taskId": task, "role": super::test_album::WRITER, "reuseWorktreeOf": live })),
        )
        .unwrap();
    assert_eq!(v["reusedWorktree"], path.as_str());
    assert!(e.o.begin_worktree_removal(&e.run, &path).is_err());
    cleanup(&e.root);
}

/// 리뷰 F5 — 허용 자리 검사는 **실제 경로**로: 허용 자리 안의 정션 · 링크가 밖을 가리키면 `alias/new` 는 거절되고 밖에 아무것도 생기지
/// 않는다. 이름의 `..` · 앞 `/` 도 거절.
#[test]
fn worktree_outside_via_link_is_refused() {
    let e = env("f5");
    let wt_dir = e.root.join("repo-wt");
    std::fs::create_dir_all(&wt_dir).unwrap();
    let outside = e.root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    make_dir_link(&wt_dir.join("alias"), &outside);
    assert_eq!(make(&e, "alias/new", &Base::Main).unwrap_err().code, reason::INVALID_ARGUMENT);
    assert!(!outside.join("new").exists(), "밖에 아무것도 생기지 않았다");
    assert!(!git(&e.repo, &["show-ref", "--verify", "--quiet", "refs/heads/alias/new"]).ok, "브랜치도 없다");
    for bad in ["../x", "/x", "a/../../x", "a/./b"] {
        assert_eq!(make(&e, bad, &Base::Main).unwrap_err().code, reason::INVALID_ARGUMENT, "{bad}");
    }
    // 안쪽 진짜 폴더 아래는 된다 — 경로는 실제 경로(구분자 한 가지).
    let ok = make(&e, "nest/inner", &Base::Main).unwrap();
    assert!(Path::new(&ok.path).is_dir());
    assert!(!(ok.path.contains('/') && ok.path.contains('\\')), "구분자가 섞이지 않는다: {}", ok.path);
    cleanup(&e.root);
}

/// 정션(Windows) · 심볼릭 링크(그 밖).
fn make_dir_link(link: &Path, target: &Path) {
    #[cfg(windows)]
    {
        let ok = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(ok, "mklink /J");
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
}

/// 리뷰 F6 — **커밋된 심볼릭 링크**는 걷지 않는다(git 이 스스로 지운다 — 먼저 걷으면 "삭제됨" 변경으로 보고 거절했다), 무시된 정션만 걷는다.
/// 바뀌기 전에 실패할 수 있는 것(잠긴 worktree)은 먼저 보고 아무것도 바꾸지 않는다.
#[test]
fn worktree_remove_keeps_tracked_links_and_fails_without_changes() {
    let e = env("f6");
    // 저장소에 커밋된 링크(파일 링크) — 심볼릭 링크를 만들 수 없는 환경이면 건너뛴다.
    assert!(git(&e.repo, &["config", "core.symlinks", "true"]).ok);
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file("a.txt", e.repo.join("link.txt"));
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink("a.txt", e.repo.join("link.txt"));
    if linked.is_err() {
        eprintln!("심볼릭 링크를 만들 수 없다 — 건너뜀");
        cleanup(&e.root);
        return;
    }
    std::fs::write(e.repo.join(".gitignore"), "ignored-link\n").unwrap();
    assert!(git(&e.repo, &["add", "link.txt", ".gitignore"]).ok);
    assert!(git(&e.repo, &["commit", "-q", "-m", "link"]).ok);
    let path = make(&e, "orch-f6", &Base::Main).unwrap().path;
    let tracked = Path::new(&path).join("link.txt");
    assert!(std::fs::symlink_metadata(&tracked).unwrap().file_type().is_symlink(), "worktree 에 링크로 체크아웃");
    // 무시된 정션 하나(밖을 가리킨다).
    let outside = e.root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("keep.txt"), "keep").unwrap();
    make_dir_link(&Path::new(&path).join("ignored-link"), &outside);
    // 잠긴 worktree — 링크를 걷기 전에 거절(아무것도 바뀌지 않는다).
    assert!(git(&e.repo, &["worktree", "lock", &path]).ok);
    assert_eq!(remove(&e, &path, false).unwrap_err(), "worktree-failed");
    assert!(Path::new(&path).join("ignored-link").join("keep.txt").is_file(), "정션은 그대로");
    assert!(std::fs::symlink_metadata(&tracked).is_ok(), "추적 링크도 그대로");
    assert!(git(&e.repo, &["worktree", "unlock", &path]).ok);
    // 풀고 나면 지워진다 — 추적 링크는 git 이, 무시된 정션은 링크만.
    let r = remove(&e, &path, false).unwrap();
    assert_eq!(r["removed"], true, "{r}");
    assert_eq!(r["unlinkedLinks"], 1, "걷은 것은 무시된 정션 하나");
    assert!(!Path::new(&path).exists());
    assert!(outside.join("keep.txt").is_file(), "정션 대상은 그대로");
    assert!(e.repo.join("a.txt").is_file(), "링크 대상(저장소 파일)도 그대로");
    cleanup(&e.root);
}
