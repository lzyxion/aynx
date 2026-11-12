//! 통합 설계 4단계 시험(docs/log/2026-10-15-orchestration-integration-design.md 8절 검증 · 10절 4단계 행) — 수락 전 검증.
//!
//! - 순수: 시작 칸 검사 · 허용 목록 env · symlink 밖 판정 · 고리 버퍼 · 꼬리 · 깨끗함 판정.
//! - 프로세스(진짜 `cmd.exe` — Windows): 직렬화 시험 문자열(0b A) · `cmd /c exit 3` · `ping -n 600` 시한 · 1 MB 개행 없는 출력 ·
//!   stdout/stderr 동시 폭주 · 손자 남기기 → 정리 · 취소.
//! - 흐름(임시 저장소 · 진짜 git): 자동 실행 통과 → 통합 · 실패 → reported + 재검증 한도 · 사람 확인 기본 · 확인 묶음(후보 · 해시 ·
//!   머리) · 만료 · 추적 파일 변경 실패 · symlink 밖 거절 · 사람 덮어쓰기 · 중단 중 검증 트리 종료.
//!
//! 프로세스를 띄우는 시험은 한 줄로(`SERIAL`) — 손자 정리 확인이 다른 시험의 ping 과 섞이지 않게. 끝나면 남은 것이 없음을 잡이 확인한다.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::integrate::*;
use super::model::*;
use super::spawn::{LaunchJob, WorkerLauncher};
use super::store::*;
use super::verify::*;
use crate::audit::AuditRecord;

pub(super) static SERIAL: Mutex<()> = Mutex::new(());

pub(super) fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// 순수
// ---------------------------------------------------------------------------

fn input(cmd: &str) -> VerifyInput {
    VerifyInput {
        command: cmd.into(),
        ..Default::default()
    }
}

#[test]
fn verify_input_checks_one_line_length_risk_paths_and_env_names() {
    assert!(validate_input(input("   "), false).unwrap().is_none(), "빈 명령 = 검증 없음");
    let c = validate_input(input(" npm test "), false).unwrap().unwrap();
    assert_eq!(c.command, "npm test");
    assert_eq!(c.command_sha, sha256_hex(b"npm test"));
    assert_eq!(c.timeout_minutes, TIMEOUT_DEFAULT_MINUTES);
    assert!(!c.auto_run);
    for bad in ["a\nb", "a\rb", "a\0b"] {
        assert_eq!(validate_input(input(bad), false).unwrap_err().code, reason::INVALID_ARGUMENT);
    }
    assert_eq!(validate_input(input(&"x".repeat(COMMAND_MAX + 1)), false).unwrap_err().code, reason::INVALID_ARGUMENT);
    let mut auto = input("npm test");
    auto.auto_run = true;
    assert_eq!(validate_input(auto.clone(), false).unwrap_err().code, reason::RISK_NOT_CONFIRMED);
    assert!(validate_input(auto, true).unwrap().unwrap().auto_run);
    let mut t = input("x");
    t.timeout_minutes = Some(999);
    assert_eq!(validate_input(t, false).unwrap().unwrap().timeout_minutes, TIMEOUT_MAX_MINUTES);
    for bad in ["../x", "/abs", "C:\\x", "a/../b", "*", ".git", "a/.git"] {
        let mut k = input("x");
        k.keep_dirs = vec![bad.into()];
        assert_eq!(validate_input(k, false).unwrap_err().code, reason::INVALID_ARGUMENT, "{bad}");
    }
    let mut k = input("x");
    k.keep_dirs = vec!["node_modules".into(), "a\\b".into(), "NODE_MODULES".into()];
    k.cache_key_files = vec!["package-lock.json".into()];
    let c = validate_input(k, false).unwrap().unwrap();
    assert_eq!(c.keep_dirs, vec!["node_modules".to_string(), "a/b".to_string()]);
    for bad in ["AYNX_TOKEN", "aynx_x", "GIT_DIR", "TEMP", "ComSpec", "1BAD", "A-B", "A B"] {
        let mut e = input("x");
        e.extra_env_names = vec![bad.into()];
        assert_eq!(validate_input(e, false).unwrap_err().code, reason::INVALID_ARGUMENT, "{bad}");
    }
    let mut e = input("x");
    e.extra_env_names = vec!["NPM_CONFIG_REGISTRY".into(), "path".into()];
    assert_eq!(validate_input(e, false).unwrap().unwrap().extra_env_names, vec!["NPM_CONFIG_REGISTRY".to_string()]);
}

#[test]
fn verify_env_is_allowlist() {
    let vars: Vec<(std::ffi::OsString, std::ffi::OsString)> = [
        ("Path", "C:\\bin"),
        ("SystemRoot", "C:\\Windows"),
        ("LOCALAPPDATA", "C:\\L"),
        ("ANTHROPIC_API_KEY", "secret"),
        ("AWS_SECRET_ACCESS_KEY", "secret"),
        ("NODE_OPTIONS", "--require evil"),
        ("PYTHONPATH", "x"),
        ("GIT_DIR", "x"),
        ("AYNX_MCP_TOKEN", "tok"),
        ("ComSpec", "C:\\evil\\cmd.exe"),
        ("TEMP", "C:\\elsewhere"),
        ("NPM_CONFIG_REGISTRY", "https://r"),
    ]
    .iter()
    .map(|(k, v)| (k.into(), v.into()))
    .collect();
    let env = build_env(vars, &["NPM_CONFIG_REGISTRY".into()], "C:\\Windows\\system32\\cmd.exe", Path::new("C:\\t"));
    let get = |n: &str| env.iter().find(|(k, _)| k.eq_ignore_ascii_case(n)).map(|(_, v)| v.clone());
    assert_eq!(get("PATH").as_deref(), Some("C:\\bin"), "대소문자 무시");
    assert_eq!(get("SystemRoot").as_deref(), Some("C:\\Windows"));
    assert_eq!(get("LOCALAPPDATA").as_deref(), Some("C:\\L"));
    assert_eq!(get("NPM_CONFIG_REGISTRY").as_deref(), Some("https://r"), "사람이 고른 추가 이름");
    for gone in ["ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY", "NODE_OPTIONS", "PYTHONPATH", "GIT_DIR", "AYNX_MCP_TOKEN"] {
        assert!(get(gone).is_none(), "{gone} 는 허용 목록 밖");
    }
    assert_eq!(get("ComSpec").as_deref(), Some("C:\\Windows\\system32\\cmd.exe"), "ComSpec 는 서버가 정한다");
    assert_eq!(get("TEMP").as_deref(), Some("C:\\t"));
    assert_eq!(get("TMP").as_deref(), Some("C:\\t"));
    assert_eq!(get("CI").as_deref(), Some("1"));
    assert_eq!(env.iter().filter(|(k, _)| k.eq_ignore_ascii_case("TEMP")).count(), 1);
    assert_ne!(env_policy(&[]), env_policy(&["NPM_CONFIG_REGISTRY".into()]));
    assert_eq!(env_policy(&["a".into(), "B".into()]), env_policy(&["b".into(), "A".into()]));
}

#[test]
fn symlink_outside_is_judged_lexically() {
    assert!(!link_outside("a/l", Path::new("b")));
    assert!(!link_outside("a/l", Path::new("../b")));
    assert!(!link_outside("a/b/l", Path::new("../../c/d")));
    assert!(link_outside("l", Path::new("../x")));
    assert!(link_outside("a/l", Path::new("../../x")));
    assert!(link_outside("a/l", Path::new("C:\\Windows")));
    assert!(link_outside("a/l", Path::new("\\Windows")));
    assert!(link_outside("a/l", Path::new("C:x")));
    assert!(!link_outside("a/l", Path::new("./b/../c")));
    let ls = "100644 aaaa 0\tf.txt\x00120000 bbbb 0\tdir/link\x00";
    assert_eq!(tracked_links(ls), vec!["dir/link".to_string()]);
    assert!(clean_status("", &[]));
    assert!(clean_status("! node_modules/\0", &["node_modules".into()]));
    assert!(clean_status("! node_modules/x/y\0", &["node_modules".into()]));
    assert!(!clean_status("! dist/\0", &["node_modules".into()]));
    assert!(!clean_status("1 .M N... 100644 100644 100644 a b f.txt\0", &["node_modules".into()]));
    assert!(!clean_status("? new.txt\0", &[]));
}

#[test]
fn ring_keeps_last_bytes_and_tail_strips_controls() {
    let mut r = Ring::default();
    r.push(&vec![b'a'; RING_BYTES - 10]);
    r.push(&[b'b'; 20]);
    assert_eq!(r.bytes().len(), RING_BYTES);
    assert_eq!(r.total(), RING_BYTES as u64 + 10);
    assert!(r.bytes().ends_with(&[b'b'; 20]));
    r.push(&vec![b'c'; RING_BYTES * 3]);
    assert_eq!(r.bytes(), &vec![b'c'; RING_BYTES][..]);
    let t = tail_view(b"ok\r\n\x1b[31mred\x07\tx\n");
    assert_eq!(t, "ok\n[31mred\tx\n");
    assert_eq!(tail_view(&vec![b'z'; TAIL_VIEW_BYTES * 2]).len(), TAIL_VIEW_BYTES);
    assert!(tail_view(&[0xc7, 0xd1, b'!']).ends_with('!'), "손실 허용 디코딩");
}

// ---------------------------------------------------------------------------
// 프로세스
// ---------------------------------------------------------------------------

fn env_here(temp: &Path) -> Vec<(String, String)> {
    let comspec = crate::server::os::system_cmd().unwrap();
    build_env(std::env::vars_os(), &[], &comspec, temp)
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-stage4-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn run(cmd: &str, secs: u64) -> Exec {
    let d = scratch("exec");
    let cancel = AtomicBool::new(false);
    let e = execute(cmd, &d, &env_here(&d), Instant::now() + Duration::from_secs(secs), &cancel);
    let _ = std::fs::remove_dir_all(&d);
    e
}

fn out(e: &Exec) -> String {
    String::from_utf8_lossy(&e.tail).replace("\r\n", "\n")
}

fn node() -> Option<String> {
    super::spawn::find_exe("node", std::env::var_os("PATH").as_deref()).map(|p| p.to_string_lossy().into_owned())
}

/// 0b A 의 직렬화 시험 문자열 — `raw_arg` 고정 직렬화는 사람이 친 것과 같아야 한다(인자 배열 인용은 깨진다).
#[test]
fn verify_cmdline_serialization() {
    let _g = serial();
    let c = crate::server::os::system_cmd().unwrap();
    assert_eq!(cmd_line(&c, "npm test"), format!("\"{c}\" /d /s /v:off /c \"npm test\""));
    let cases: &[(&str, i64, &str)] = &[
        ("echo a&& exit /b 3", 3, "a\n"),
        ("echo x && echo y", 0, "x \ny\n"),
        ("echo 100%", 0, "100%\n"),
        ("echo %OS%", 0, "Windows_NT\n"),
        ("echo %AYNX_NOPE_X%", 0, "%AYNX_NOPE_X%\n"),
        ("echo hi!", 0, "hi!\n"),
        ("echo !OS!", 0, "!OS!\n"),
        ("echo ^&", 0, "&\n"),
        ("echo a ^| b", 0, "a | b\n"),
        ("(echo a) & echo b", 0, "a\nb\n"),
        ("echo C:\\temp\\", 0, "C:\\temp\\\n"),
        ("echo \"abc", 0, "\"abc\n"),
        ("echo a\"b\"c \"d", 0, "a\"b\"c \"d\n"),
        ("echo \"x\" \"y\"", 0, "\"x\" \"y\"\n"),
    ];
    for (cmd, code, want) in cases {
        let e = run(cmd, 30);
        assert_eq!(e.exit_code, Some(*code), "{cmd}: {}", out(&e));
        assert_eq!(out(&e), *want, "{cmd}");
        assert!(e.confirmed);
    }
    // 한글 — cmd 내장 echo 는 ANSI 코드 페이지 바이트로 쓴다(949 PC 는 c7 d1 b1 db, 437 인 CI 러너는 `??`).
    // 바이트는 PC 마다 다르니 뭔가 나왔는지만 본다.
    let e = run("echo 한글", 30);
    assert_eq!(e.exit_code, Some(0));
    assert!(e.tail.len() > 2 && !e.tail.starts_with(b"\r") && !e.tail.starts_with(b"\n"), "{:x?}", e.tail);
    if let Some(n) = node() {
        // 끝 코드 보존 — 인자 배열 인용은 이것을 0 으로 바꿔 거짓 pass 를 낸다(0b A).
        let e = run("node -e \"process.exit(7)\"", 60);
        assert_eq!(e.exit_code, Some(7));
        assert_eq!(e.outcome, VerifyOutcome::Fail);
        // 빈칸 든 경로를 따옴표로 + 유니코드 인자.
        let e = run(&format!("\"{n}\" -e \"console.log(process.argv[1])\" 한글"), 60);
        assert_eq!(e.exit_code, Some(0));
        assert_eq!(out(&e), "한글\n");
    }
}

#[test]
fn verify_exit_code_kept_and_fail() {
    let _g = serial();
    let e = run("cmd /c exit 3", 30);
    assert_eq!(e.exit_code, Some(3));
    assert_eq!(e.outcome, VerifyOutcome::Fail);
    let e = run("exit 0", 30);
    assert_eq!(e.outcome, VerifyOutcome::Pass);
}

#[test]
fn verify_timeout_kills_tree() {
    let _g = serial();
    let t0 = Instant::now();
    let e = run("ping -n 600 127.0.0.1", 2);
    assert_eq!(e.outcome, VerifyOutcome::Timeout);
    assert!(e.confirmed, "잡이 비고 파이프가 닫혔다");
    assert!(t0.elapsed() < Duration::from_secs(15), "{:?}", t0.elapsed());
    assert!(e.out_bytes > 0);
}

#[test]
fn verify_cancel_kills_tree() {
    let _g = serial();
    let d = scratch("cancel");
    let cancel = Arc::new(AtomicBool::new(false));
    let c2 = cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        c2.store(true, Ordering::SeqCst);
    });
    let e = execute("ping -n 600 127.0.0.1", &d, &env_here(&d), Instant::now() + Duration::from_secs(60), &cancel);
    assert_eq!(e.outcome, VerifyOutcome::Cancelled);
    assert!(e.confirmed);
}

#[test]
fn verify_output_tail_bytes_bounded() {
    let _g = serial();
    let Some(_) = node() else { return };
    // 개행 없는 1 MB.
    let e = run("node -e \"process.stdout.write('x'.repeat(1<<20))\"", 60);
    assert_eq!(e.outcome, VerifyOutcome::Pass);
    assert_eq!(e.out_bytes, 1 << 20);
    assert_eq!(e.tail.len(), RING_BYTES);
    assert_eq!(tail_view(&e.tail).len(), TAIL_VIEW_BYTES);
    // stdout · stderr 동시 폭주 — 파이프가 막히지 않고 둘 다 끝까지 읽힌다.
    let e = run(
        "node -e \"const b='y'.repeat(1<<20);process.stdout.write(b);process.stderr.write(b)\"",
        60,
    );
    assert_eq!(e.outcome, VerifyOutcome::Pass, "{}", out(&e).chars().take(200).collect::<String>());
    assert_eq!(e.out_bytes, 2 << 20);
    assert!(e.tail.iter().all(|b| *b == b'y'));
}

/// 맏이가 곧바로 끝나고 손자(ping)를 고아로 남겨도 — 잡을 끝내고 활성 0 · EOF 를 확인한 뒤에야 돌아온다.
#[test]
fn verify_waits_for_job_empty_and_pipe_eof() {
    let _g = serial();
    let t0 = Instant::now();
    let e = run("start \"\" /b ping -n 60 127.0.0.1", 30);
    assert_eq!(e.exit_code, Some(0));
    assert!(e.confirmed, "손자까지 잡 안 — 끝냈다");
    assert!(t0.elapsed() < Duration::from_secs(20));
}

// ---------------------------------------------------------------------------
// 흐름 — 임시 저장소
// ---------------------------------------------------------------------------

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

fn repo(tag: &str) -> PathBuf {
    let d = scratch(tag).join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Stage Four"]);
    git(&d, &["config", "user.email", "stage4@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("f.txt"), "one\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

/// `parent` 위에 항목 몇 개(모드 · 경로 · 내용)를 바꾼 커밋.
fn commit_on(repo: &Path, parent: &str, files: &[(&str, &str, &str)], msg: &str) -> String {
    let idx = scratch("idx").join("index");
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    let (c, o) = git_env(repo, &["read-tree", parent], &env, None);
    assert_eq!(c, 0, "{o}");
    for (mode, path, body) in files {
        let (c, blob) = git_env(repo, &["hash-object", "-w", "--stdin"], &env, Some(body.as_bytes()));
        assert_eq!(c, 0);
        let info = format!("{mode},{blob},{path}");
        let (c, o) = git_env(repo, &["update-index", "--add", "--cacheinfo", &info], &env, None);
        assert_eq!(c, 0, "{o}");
    }
    let (c, tree) = git_env(repo, &["write-tree"], &env, None);
    assert_eq!(c, 0);
    git(repo, &["commit-tree", &tree, "-p", parent, "-m", msg])
}

fn rev(repo: &Path, name: &str) -> Option<String> {
    let (c, o) = git_env(repo, &["rev-parse", "--verify", "--quiet", name], &[], None);
    (c == 0).then_some(o)
}

#[derive(Default)]
struct Launcher;

impl WorkerLauncher for Launcher {
    fn launch(&self, _job: LaunchJob) {}
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

struct H {
    o: Arc<Orchestration>,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(crate::operations::now_ms)));
    o.set_ephemeral(true); // 리뷰 F10 — 시험의 명시적 비영속 모드(저장 폴더가 없을 때만 뜻이 있다)
    o.set_integrator(Arc::new(GitRefs));
    o.set_launcher(Arc::new(Launcher));
    H { o, audit: Mutex::new(rx) }
}

fn start(o: &Orchestration, repo: &Path, cmd: &str, auto: bool) -> (String, Caller) {
    let mut i = input(cmd);
    i.auto_run = auto;
    let verify = validate_input(i, true).unwrap();
    // 무인 검증(자동 실행)은 지금 맡기기의 검증 명령과 같아야 선다(3a — 2-4 · D5) — 시험 맡기기의 명령을 Run 의 명령과 맞춘다.
    let td = super::test_album::block("C:/repo", super::test_album::default_roles(), Vec::new(), Some(cmd));
    super::test_album::delegate_with(o, super::test_album::active(td));
    let s = StartRun {
        verify,
        name: "stage4".into(),
        repo: repo.display().to_string(),
        worktree_dir: repo.parent().unwrap().join("wt").display().to_string(),
        limits: Limits::default(),
    };
    let run = o.start_integrated_run(s).unwrap().0;
    let c = o.coordinator_caller(&run).unwrap();
    (run, c)
}

fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    o.call_tool(c, name, Some(&args))
}

fn create_task(o: &Orchestration, c: &Caller, req: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": req, "goal": "g" })).unwrap();
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

fn last_job(o: &Orchestration, run: &str) -> IntegrationJob {
    run_of(o, run).jobs.last().unwrap().clone()
}

/// "끝난 작업자가 성공 보고함" — 3단계 시험과 같은 틀.
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

fn err_code(r: Result<Value, String>) -> String {
    let e = r.expect_err("거절이어야 한다");
    e.split(':').next().unwrap_or_default().to_string()
}

fn audit_events(h: &H) -> Vec<(String, Value)> {
    let rx = h.audit.lock().unwrap();
    let mut out = Vec::new();
    while let Ok(r) = rx.try_recv() {
        let v = serde_json::to_value(&r).unwrap();
        out.push((v["event"].as_str().unwrap_or_default().to_string(), v));
    }
    out
}

/// 보고 하나를 만들어 둔다 — 새 파일 하나를 더한 커밋.
fn one_task(h: &H, r: &Path, run: &str, c: &Caller, files: &[(&str, &str, &str)]) -> (String, String) {
    let base = head(&h.o, run);
    let t = create_task(&h.o, c, "t");
    let commit = commit_on(r, &base, files, "work");
    reported(&h.o, run, &t, &base, &commit);
    (t, commit)
}

#[test]
fn auto_run_requires_confirmed_risk_and_is_marked() {
    let _g = serial();
    let h = harness();
    let r = repo("auto");
    let (run, c) = start(&h.o, &r, "if exist new.txt (exit 0) else (exit 9)", true);
    assert!(run_of(&h.o, &run).verify.as_ref().unwrap().auto_run);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    let v = accept(&h.o, &c, &run, &t, "acc").unwrap();
    assert_eq!(v["accepting"], true);
    // 깨끗한 후보 위에서 돌았고(새 파일이 있다) 통과 → 통합.
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Accepted);
    let job = last_job(&h.o, &run);
    let ver = job.verify.clone().unwrap();
    assert_eq!(ver.outcome, VerifyOutcome::Pass);
    assert_eq!(ver.approved_by, VerifyApprover::Auto);
    assert_eq!(Some(ver.candidate.clone()), job.candidate);
    assert!(ver.hermetic);
    assert_eq!(rev(&r, &refs::int(&run)), job.candidate);
    let art = run_of(&h.o, &run).accepted.last().unwrap().clone();
    let vf = art.verification.unwrap();
    assert_eq!(vf.outcome, VerifyOutcome::Pass);
    assert!(!vf.overridden);
    // 감사: 시작은 명령 길이 · 해시 · 자동만(글자 없음), 검증 시작 · 끝.
    let ev = audit_events(&h);
    let started = &ev.iter().find(|(e, _)| e == "run_started").unwrap().1;
    assert!(!started.to_string().contains("exist new.txt"), "명령 글자는 감사에 없다");
    assert_eq!(started["orchestration"]["autoRun"], true);
    assert!(ev.iter().any(|(e, v)| e == "verify_started" && v["orchestration"]["approvedBy"] == "auto"));
    assert!(ev.iter().any(|(e, v)| e == "verify_finished" && v["orchestration"]["reason"] == "pass"));
    // 조정자 get_run 에 검증 설정 · 마지막 결과가 있다.
    let g = call(&h.o, &c, "get_run", json!({})).unwrap();
    assert_eq!(g["verify"]["autoRun"], true);
    assert_eq!(g["lastVerify"][&t]["outcome"], "pass");
}

#[test]
fn verify_failure_returns_task_and_reverify_is_limited() {
    let _g = serial();
    let h = harness();
    let r = repo("fail");
    let (run, c) = start(&h.o, &r, "echo failing& exit 3", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    let before = head(&h.o, &run);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported, "실패 → 수락 안 됨");
    assert_eq!(head(&h.o, &run), before);
    let job = last_job(&h.o, &run);
    assert_eq!(job.phase, JobPhase::Aborted);
    assert_eq!(job.outcome.unwrap().reason, "verify-failed:fail");
    assert_eq!(job.verify.as_ref().unwrap().exit_code, Some(3));
    let g = call(&h.o, &c, "get_run", json!({})).unwrap();
    assert!(g["lastVerify"][&t]["tail"].as_str().unwrap().contains("failing"));
    // 재검증 — 새 Job · 새 검증 id, 같은 보고 3회까지.
    accept(&h.o, &c, &run, &t, "a2").unwrap();
    let j2 = last_job(&h.o, &run);
    assert_ne!(j2.job_id, job.job_id);
    assert_ne!(j2.verify.as_ref().unwrap().verify_id, job.verify.as_ref().unwrap().verify_id);
    accept(&h.o, &c, &run, &t, "a3").unwrap();
    assert_eq!(err_code(accept(&h.o, &c, &run, &t, "a4")), reason::VERIFY_FAILED);
    assert_eq!(run_of(&h.o, &run).jobs.len(), 3);
    // 같은 requestId 는 같은 결과(새로 돌지 않는다).
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    assert_eq!(run_of(&h.o, &run).jobs.len(), 3);
}

#[test]
fn verify_waits_for_human_approval_by_default_and_is_bound() {
    let _g = serial();
    let h = harness();
    let r = repo("human");
    let (run, c) = start(&h.o, &r, "exit 0", false);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let job = last_job(&h.o, &run);
    assert_eq!(job.phase, JobPhase::AwaitingApproval, "기본 = 사람 확인");
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Integrating);
    assert!(h.o.notices_view().to_string().contains("verify-approval"));
    // MCP 로는 못 바꾼다 — 조정자의 재수락은 진행 중 Job 때문에 막힌다.
    assert_eq!(err_code(accept(&h.o, &c, &run, &t, "a2")), reason::INTEGRATION_BUSY);
    let cand = job.candidate.clone().unwrap();
    let old = job.old.clone().unwrap();
    let sha = run_of(&h.o, &run).verify.unwrap().command_sha;
    // 묶음: 다른 후보 · 다른 해시 · 다른 머리면 승인 무효(다시 확인).
    let other = "0".repeat(40);
    assert_eq!(h.o.approve_verify(&run, &job.job_id, &other, &sha, &old).unwrap_err().code, reason::APPROVAL_STALE);
    assert_eq!(h.o.approve_verify(&run, &job.job_id, &cand, &"a".repeat(64), &old).unwrap_err().code, reason::APPROVAL_STALE);
    assert_eq!(h.o.approve_verify(&run, &job.job_id, &cand, &sha, &other).unwrap_err().code, reason::APPROVAL_STALE);
    assert_eq!(last_job(&h.o, &run).phase, JobPhase::AwaitingApproval, "거절은 아무것도 바꾸지 않는다");
    h.o.approve_verify(&run, &job.job_id, &cand, &sha, &old).unwrap();
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Accepted);
    let j = last_job(&h.o, &run);
    assert_eq!(j.approval.as_ref().unwrap().by, VerifyApprover::Human);
    assert_eq!(j.verify.unwrap().approved_by, VerifyApprover::Human);
    // 끝난 Job 에 다시 승인은 안 된다.
    assert_eq!(h.o.approve_verify(&run, &job.job_id, &cand, &sha, &old).unwrap_err().code, reason::INVALID_STATE);
}

/// 리뷰 F6 — 후보 ref 는 Job 마다 따로: ① 취소된 계산(A)이 새 Job(B)이 후보를 세운 **뒤에** 끝나도 B 의 ref 를 덮지 않는다(자기 ref 만
/// 쓰고 거둔다) ② 회수는 끝난 Job 의 ref 만 — 진행 중인 B 의 ref 는 그대로 → B 가 통합된다.
#[test]
fn candidate_ref_per_job_survives_late_cancelled_compute_and_reclaim() {
    let _g = serial();
    let h = harness();
    let r = repo("candref");
    let (run, c) = start(&h.o, &r, "exit 0", false);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    let fired = Arc::new(AtomicBool::new(false));
    let (f, run2, t2, c2) = (fired.clone(), run.clone(), t.clone(), c.clone());
    let hook = move |o: &Orchestration, s: IntegrateStep| {
        if s == IntegrateStep::BeforeCandidateRef && !f.swap(true, Ordering::SeqCst) {
            // A 의 계산이 ref 를 쓰기 직전 — 사람이 A 를 취소하고 조정자가 다시 수락(B 는 끝까지 돌아 사람 확인 대기).
            o.cancel_integration(&run2, &t2).unwrap();
            accept(o, &c2, &run2, &t2, "a2").unwrap();
        }
        false
    };
    *h.o.integrate_hook.lock().unwrap() = Some(Arc::new(hook));
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    assert!(fired.load(Ordering::SeqCst));
    let jobs = run_of(&h.o, &run).jobs;
    assert_eq!(jobs.len(), 2);
    let (a, b) = (&jobs[0], &jobs[1]);
    assert_eq!(a.phase, JobPhase::Aborted);
    assert_eq!(b.phase, JobPhase::AwaitingApproval);
    assert_eq!(rev(&r, &refs::candidate(&refs::new_base(&run), &a.job_id)), None, "취소된 A 는 자기 ref 만 썼다가 거뒀다");
    assert_eq!(rev(&r, &refs::candidate(&refs::new_base(&run), &b.job_id)), b.candidate, "B 의 ref 는 무사");
    // ② 회수 — 끝난 A 만 대상, 진행 중 B 의 ref 는 그대로.
    h.o.reclaim_refs(&run);
    assert_eq!(rev(&r, &refs::candidate(&refs::new_base(&run), &b.job_id)), b.candidate);
    let sha = run_of(&h.o, &run).verify.unwrap().command_sha;
    h.o.approve_verify(&run, &b.job_id, b.candidate.as_deref().unwrap(), &sha, b.old.as_deref().unwrap()).unwrap();
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Accepted);
    assert_eq!(rev(&r, &refs::candidate(&refs::new_base(&run), &b.job_id)), None, "올리기 트랜잭션이 함께 지웠다");
}

#[test]
fn approval_void_when_head_moves_and_expires() {
    let _g = serial();
    let h = harness();
    let r = repo("void");
    let (run, c) = start(&h.o, &r, "exit 0", false);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let job = last_job(&h.o, &run);
    let (cand, old) = (job.candidate.clone().unwrap(), job.old.clone().unwrap());
    let sha = run_of(&h.o, &run).verify.unwrap().command_sha;
    // 만료 — 대기 시각을 30분 전으로 돌리고 서버 시계.
    {
        let mut g = h.o.lock();
        let s = g.runs.get_mut(&run).unwrap();
        s.run.jobs.last_mut().unwrap().awaiting_at = Some(crate::operations::now_ms() - APPROVAL_TTL_MS - 1);
    }
    h.o.tick();
    let j = last_job(&h.o, &run);
    assert_eq!(j.phase, JobPhase::Aborted);
    assert_eq!(j.outcome.unwrap().reason, reason::APPROVAL_EXPIRED);
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
    assert_eq!(h.o.approve_verify(&run, &job.job_id, &cand, &sha, &old).unwrap_err().code, reason::INVALID_STATE);
    // 새 Job — 그사이 통합 ref 가 앱 밖에서 움직이면 승인은 서지 않고 Run 은 보류.
    accept(&h.o, &c, &run, &t, "a2").unwrap();
    let job = last_job(&h.o, &run);
    let moved = commit_on(&r, &old, &[("100644", "x.txt", "x\n")], "human");
    git(&r, &["update-ref", &refs::int(&run), &moved]);
    let e = h.o.approve_verify(&run, &job.job_id, job.candidate.as_deref().unwrap(), &sha, &old).unwrap_err();
    assert_eq!(e.code, reason::RUN_ON_HOLD);
    assert!(run_of(&h.o, &run).hold.is_some());
    assert_eq!(last_job(&h.o, &run).phase, JobPhase::Aborted);
    assert!(last_job(&h.o, &run).verify.is_none(), "검증은 돌지 않았다");
}

#[test]
fn tracked_change_after_verify_is_failure_and_override_is_bound() {
    let _g = serial();
    let h = harness();
    let r = repo("tracked");
    let (run, c) = start(&h.o, &r, "echo changed>> f.txt", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let job = last_job(&h.o, &run);
    let v = job.verify.clone().unwrap();
    assert_eq!(v.exit_code, Some(0));
    assert_eq!(v.outcome, VerifyOutcome::ModifiedTracked);
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
    // 덮어쓰기 — 실패한 그 Job · 검증 · 후보에만.
    let cand = job.candidate.clone().unwrap();
    assert_eq!(h.o.override_verify(&run, &job.job_id, "ver-x", &cand).unwrap_err().code, reason::VERIFY_FAILED);
    assert_eq!(h.o.override_verify(&run, &job.job_id, &v.verify_id, &"1".repeat(40)).unwrap_err().code, reason::VERIFY_FAILED);
    let res = h.o.override_verify(&run, &job.job_id, &v.verify_id, &cand).unwrap();
    assert_eq!(res["phase"], "integrated");
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Accepted);
    assert_eq!(rev(&r, &refs::int(&run)).as_deref(), Some(cand.as_str()));
    let art = run_of(&h.o, &run).accepted.last().unwrap().clone();
    let vf = art.verification.unwrap();
    assert!(vf.overridden);
    assert_eq!(vf.outcome, VerifyOutcome::ModifiedTracked, "실패는 실패로 남는다");
    let nj = last_job(&h.o, &run);
    assert!(nj.verify.is_none(), "새 후보의 통과로 적지 않는다");
    assert_eq!(nj.override_.unwrap().failed_job_id, job.job_id);
    assert!(audit_events(&h).iter().any(|(e, _)| e == "human_override_verify"));
    // 같은 실패를 두 번 덮을 수 없다(이미 통합 — 머리가 바뀌었다).
    assert!(h.o.override_verify(&run, &job.job_id, &v.verify_id, &cand).is_err());
}

/// 리뷰 F5 — 명령이 다른 커밋을 검사하게 만들면(HEAD 이동 · 새 커밋) · index 를 바꾸면 작업 폴더가 깨끗해도 통과가 아니다.
#[test]
fn verify_head_move_new_commit_or_index_change_is_not_pass() {
    let _g = serial();
    for (tag, cmd) in [
        ("vhead", "git reset -q --hard HEAD~1"),
        ("vcommit", "git -c user.name=v -c user.email=v@example.invalid commit -q --allow-empty --no-verify -m x"),
        ("vindex", "echo z> z.txt& git add z.txt"),
    ] {
        let h = harness();
        let r = repo(tag);
        let (run, c) = start(&h.o, &r, cmd, true);
        let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
        accept(&h.o, &c, &run, &t, "a1").unwrap();
        let v = last_job(&h.o, &run).verify.unwrap();
        assert_eq!(v.exit_code, Some(0), "{tag}");
        assert_eq!(v.outcome, VerifyOutcome::ModifiedTracked, "{tag}");
        assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported, "{tag}");
    }
}

#[test]
fn override_refused_when_head_moved() {
    let _g = serial();
    let h = harness();
    let r = repo("ovhead");
    let (run, c) = start(&h.o, &r, "exit 5", true);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a");
    let ca = commit_on(&r, &base, &[("100644", "a.txt", "a\n")], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "a1").unwrap();
    let job = last_job(&h.o, &run);
    let v = job.verify.clone().unwrap();
    assert_eq!(v.outcome, VerifyOutcome::Fail);
    // 서버가 아는 머리가 바뀌었다(다른 Task 가 덮어쓰기로 통합) — 옛 실패의 덮어쓰기는 무효.
    {
        let mut g = h.o.lock();
        let s = g.runs.get_mut(&run).unwrap();
        s.run.integration.as_mut().unwrap().expected_head = "2".repeat(40);
    }
    assert_eq!(
        h.o.override_verify(&run, &job.job_id, &v.verify_id, job.candidate.as_deref().unwrap()).unwrap_err().code,
        reason::APPROVAL_STALE
    );
}

#[test]
fn symlink_outside_refuses_candidate() {
    let _g = serial();
    let h = harness();
    let r = repo("link");
    let (run, c) = start(&h.o, &r, "exit 0", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("120000", "dir/out", "../../outside"), ("100644", "dir/x.txt", "x\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let job = last_job(&h.o, &run);
    let v = job.verify.clone().unwrap();
    // 이 PC 가 진짜 링크를 만들면(core.symlinks · 개발자 모드) 밖 대상 → 거절, 아니면 보통 파일이라 따라갈 링크가 없다.
    let vdir = PathBuf::from(&run_of(&h.o, &run).worktree_dir)
        .join(format!("orch-{}-verify", &run[4..12]))
        .join("dir")
        .join("out");
    let real_link = std::fs::symlink_metadata(&vdir).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    if real_link {
        assert_eq!(v.outcome, VerifyOutcome::SymlinkOutside);
        assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
        assert!(h.o.notices_view().to_string().contains("symlink-outside"));
    } else {
        assert_eq!(v.outcome, VerifyOutcome::Pass);
    }
    // 자리 안을 가리키는 링크는 그대로 통과한다.
    let h2 = harness();
    let r2 = repo("linkin");
    let (run2, c2) = start(&h2.o, &r2, "exit 0", true);
    let (t2, _) = one_task(&h2, &r2, &run2, &c2, &[("120000", "dir/in", "../f.txt")]);
    accept(&h2.o, &c2, &run2, &t2, "a1").unwrap();
    assert_eq!(last_job(&h2.o, &run2).verify.unwrap().outcome, VerifyOutcome::Pass);
}

/// 리뷰 F8 — 종료를 확인하지 못한 검증 트리는 살아 있는 자원: 새 검증이 서지 않고 · [Run 완료] · 중단 settle 이 막히며, 서버 시계가 다시
/// 끝내고 확인하면 풀린다.
#[test]
fn unconfirmed_verify_tree_blocks_reverify_and_run_end_until_reconfirmed() {
    let _g = serial();
    let h = harness();
    let r = repo("leftover");
    let (run, c) = start(&h.o, &r, "exit 0", true);
    // 진짜 잡 하나(오래 도는 ping) — 앞 검증이 종료 미확인으로 남긴 손잡이 흉내.
    let cmd = crate::server::os::system_cmd().unwrap();
    let temp = scratch("leftover-tmp");
    let proc = crate::server::os::verify_spawn(&cmd, &cmd_line(&cmd, "ping -n 600 127.0.0.1 >nul"), &r, &env_here(&temp)).unwrap();
    {
        let mut g = h.o.lock();
        let s = g.runs.get_mut(&run).unwrap();
        s.verify_leftovers.push(("job-old".into(), Leftover::from_proc(proc)));
        s.verify_trees += 1;
        s.verify_unconfirmed = true;
    }
    // 새 검증은 서지 않는다(같은 자리를 checkout · clean 하지 않는다).
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let j = last_job(&h.o, &run);
    assert_eq!(j.phase, JobPhase::Aborted);
    assert!(j.verify.is_none(), "검증이 돌지 않았다");
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
    {
        let g = h.o.lock();
        let s = g.runs.get(&run).unwrap();
        assert!(super::integrate::completable(s).contains(&"verify-running"), "[Run 완료] 가 막힌다");
    }
    // 중단 — 남은 트리가 확인될 때까지 stopped 가 아니다 → 서버 시계가 다시 끝내고 확인하면 stopped.
    h.o.stop(&run).unwrap();
    assert_eq!(run_of(&h.o, &run).state, RunState::Stopping);
    let until = Instant::now() + Duration::from_secs(10);
    while run_of(&h.o, &run).state != RunState::Stopped && Instant::now() < until {
        h.o.tick();
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(run_of(&h.o, &run).state, RunState::Stopped);
    let g = h.o.lock();
    let s = g.runs.get(&run).unwrap();
    assert!(s.verify_leftovers.is_empty() && s.verify_trees == 0 && !s.verify_unconfirmed);
}

/// 리뷰 F2 — 보고가 건드리지 않은 필터 파일이 후보 트리에 있으면(통합 검사는 바뀐 경로만 본다) 검증 checkout 전에 거절하고 smudge 가
/// 돌지 않는다.
#[test]
fn unchanged_filter_file_refuses_verify_checkout() {
    let _g = serial();
    let h = harness();
    let r = repo("vfilter");
    std::fs::write(r.join(".gitattributes"), "*.bin filter=x\n").unwrap();
    std::fs::write(r.join("a.bin"), "data\n").unwrap();
    git(&r, &["add", "."]);
    git(&r, &["commit", "-qm", "filtered file"]);
    let marker = r.parent().unwrap().join("smudge-ran");
    let m = marker.to_string_lossy().replace('\\', "/");
    git(&r, &["config", "filter.x.smudge", &format!("echo ran >> '{m}'; cat")]);
    git(&r, &["config", "filter.x.clean", "cat"]);
    let _ = std::fs::remove_file(&marker);
    let (run, c) = start(&h.o, &r, "exit 0", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let v = last_job(&h.o, &run).verify.unwrap();
    assert_eq!(v.outcome, VerifyOutcome::SpawnFailed);
    assert_eq!(v.reason.as_deref(), Some(reason::FILTERS_CONFIGURED));
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
    assert!(!marker.exists(), "smudge 필터가 돌면 안 된다");
}

#[test]
fn verify_runs_on_clean_candidate() {
    let _g = serial();
    let h = harness();
    let r = repo("clean");
    // 검증이 무시 파일 · 추적 안 된 파일을 남겨도 다음 후보는 깨끗한 자리에서 돈다.
    let (run, c) = start(&h.o, &r, "if exist junk.txt (exit 4) else (echo j> junk.txt& exit 0)", true);
    let base = head(&h.o, &run);
    let a = create_task(&h.o, &c, "a");
    let ca = commit_on(&r, &base, &[("100644", "a.txt", "a\n")], "a");
    reported(&h.o, &run, &a, &base, &ca);
    accept(&h.o, &c, &run, &a, "a1").unwrap();
    assert_eq!(task_of(&h.o, &run, &a).state, TaskState::Accepted);
    let base2 = head(&h.o, &run);
    let b = create_task(&h.o, &c, "b");
    let cb = commit_on(&r, &base2, &[("100644", "b.txt", "b\n")], "b");
    reported(&h.o, &run, &b, &base2, &cb);
    accept(&h.o, &c, &run, &b, "b1").unwrap();
    assert_eq!(task_of(&h.o, &run, &b).state, TaskState::Accepted, "clean -ffdx 가 junk.txt 를 걷었다");
}

/// Run 중단이 검증 트리를 끝내고, 그 종료가 확인된 뒤에야 stopped.
#[test]
fn stop_kills_verify_tree_then_settles() {
    let _g = serial();
    let h = harness();
    let r = repo("stop");
    let (run, c) = start(&h.o, &r, "ping -n 600 127.0.0.1", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    let o = h.o.clone();
    let (run2, c2, t2) = (run.clone(), c.clone(), t.clone());
    let th = std::thread::spawn(move || accept(&o, &c2, &run2, &t2, "a1"));
    let until = Instant::now() + Duration::from_secs(30);
    while h.o.lock().runs.get(&run).unwrap().verify_trees == 0 {
        assert!(Instant::now() < until, "검증이 서지 않았다");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(500));
    // 취소는 깃발만 — 아직 거두지 않았다(트리 종료 확인 뒤).
    h.o.stop(&run).unwrap();
    th.join().unwrap().unwrap();
    let rr = run_of(&h.o, &run);
    assert_eq!(rr.state, RunState::Stopped);
    let job = rr.jobs.last().unwrap();
    assert_eq!(job.phase, JobPhase::Aborted);
    assert_eq!(job.outcome.as_ref().unwrap().reason, "stopped");
    assert_eq!(job.verify.as_ref().unwrap().outcome, VerifyOutcome::Cancelled);
    assert_eq!(h.o.lock().runs.get(&run).unwrap().verify_trees, 0);
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
}

/// 사람 [취소] 도 검증 중이면 트리를 먼저 끝낸다.
#[test]
fn cancel_during_verify_kills_tree() {
    let _g = serial();
    let h = harness();
    let r = repo("cancel");
    let (run, c) = start(&h.o, &r, "ping -n 600 127.0.0.1", true);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    let o = h.o.clone();
    let (run2, c2, t2) = (run.clone(), c.clone(), t.clone());
    let th = std::thread::spawn(move || accept(&o, &c2, &run2, &t2, "a1"));
    let until = Instant::now() + Duration::from_secs(30);
    while h.o.lock().runs.get(&run).unwrap().verify_trees == 0 {
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(20));
    }
    let v = h.o.cancel_integration(&run, &t).unwrap();
    assert_eq!(v["cancelling"], true);
    th.join().unwrap().unwrap();
    let job = last_job(&h.o, &run);
    assert_eq!(job.outcome.unwrap().reason, "cancelled");
    assert_eq!(job.verify.unwrap().outcome, VerifyOutcome::Cancelled);
    assert_eq!(run_of(&h.o, &run).state, RunState::Running);
}

/// 검증이 있는 Run 에서 통과 결과 없이 올리기를 부르면 거둔다(관문이 commit_job 자신에 있다).
#[test]
fn commit_without_verification_is_refused() {
    let _g = serial();
    let h = harness();
    let r = repo("gate");
    let (run, c) = start(&h.o, &r, "exit 0", false);
    let (t, _) = one_task(&h, &r, &run, &c, &[("100644", "new.txt", "new\n")]);
    accept(&h.o, &c, &run, &t, "a1").unwrap();
    let job = last_job(&h.o, &run);
    assert_eq!(job.phase, JobPhase::AwaitingApproval);
    // 사람 확인 없이 후보 단계로 되돌려 올리기를 시도해도 관문이 막는다.
    {
        let mut g = h.o.lock();
        g.runs.get_mut(&run).unwrap().run.jobs.last_mut().unwrap().phase = JobPhase::Candidate;
    }
    assert_eq!(h.o.commit_job(&run, &job.job_id).unwrap(), JobPhase::Aborted);
    assert_eq!(last_job(&h.o, &run).outcome.unwrap().reason, "verify-required");
    assert_eq!(task_of(&h.o, &run, &t).state, TaskState::Reported);
}

/// 검증 명령 · 승인 · 덮어쓰기는 MCP 도구가 아니다 — 어느 역할의 도구 목록 · 입력 스키마에도 없다.
#[test]
fn approve_verify_is_not_an_mcp_tool() {
    let names: Vec<String> = super::tools::coordinator_tool_schemas()
        .into_iter()
        .chain(super::tools::worker_tool_schemas())
        .map(|s| s.to_string())
        .collect();
    for s in &names {
        let v: Value = serde_json::from_str(s).unwrap();
        let name = v["name"].as_str().unwrap();
        assert!(!["verify", "approve", "override", "run_command", "set_verify"].iter().any(|w| name.contains(w)), "{name}");
        let props = v["inputSchema"]["properties"].as_object().cloned().unwrap_or_default();
        for k in props.keys() {
            assert!(!k.to_ascii_lowercase().contains("verify") && k != "command", "{name}.{k}");
        }
    }
    for t in super::tools::COORDINATOR_TOOLS.iter().chain(super::tools::WORKER_TOOLS) {
        assert!(!t.contains("verify") && !t.contains("approve"));
    }
    let tools = include_str!("tools.rs");
    assert!(!tools.contains("approve_verify") && !tools.contains("override_verify") && !tools.contains("validate_input"));
}

/// 검증 프로세스 생성은 ConPTY 생성과 같은 `SPAWN_LOCK` 아래다(conpty-spawn-race) — 자식 끝을 상속 가능으로 바꾸기 · `CreateProcessW` ·
/// 자식 끝 닫기가 모두 그 잠금 안이고, 상속은 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 로 표준 입출력 셋에 한정된다(소스 훑기).
/// (3차 2단계) 몸은 `spawn_in_job` 하나다 — 검증(`verify_spawn` 감싸개)과 헤드리스 턴이 같은 잠금 · 같은 상속 목록을 탄다
/// (헤드리스 설계 D8 `headless_spawn_holds_spawn_lock` 은 `tests_turn.rs`).
#[test]
fn verify_spawn_holds_spawn_lock_and_handle_list() {
    let os = include_str!("../server/os.rs");
    let at = os.find("pub(super) fn spawn_in_job(").expect("Windows 몸통");
    let body = &os[at..];
    let body = &body[..body.find("\n    pub(super) fn job_active").unwrap()];
    let lock = body.find("crate::pty::with_spawn_lock(|| {").expect("SPAWN_LOCK 도우미");
    let locked = &body[lock..body[lock..].find("});").map(|e| lock + e).unwrap()];
    for must in ["SetHandleInformation(", "CreateProcessW(", "close_all(&[in_r, out_w, err_w])"] {
        assert!(locked.contains(must), "{must} 는 잠금 안");
    }
    assert_eq!(body.matches("SetHandleInformation(").count(), 1, "상속 가능으로 바꾸는 곳은 잠금 안 하나");
    assert!(body.contains("bInheritHandle: 0"), "파이프는 상속 안 됨으로 만든다");
    assert!(body.contains("PROC_THREAD_ATTRIBUTE_HANDLE_LIST") && body.contains("let mut inherit: [HANDLE; 3] = [in_r, out_w, err_w];"));
    let pty = include_str!("../pty.rs");
    assert!(pty.contains("pub(crate) fn with_spawn_lock") && pty.contains("SPAWN_LOCK.lock()"));
}

#[test]
fn verify_unsupported_os_stub() {
    // 이 빌드(Windows)는 돌린다. 비Windows 몸통은 명시적 스텁 — 소스로 확인.
    assert!(crate::server::os::verify_supported());
    let os = include_str!("../server/os.rs");
    let at = os.find("pub(crate) fn verify_spawn(").unwrap();
    let body = &os[at..at + 2000];
    assert!(body.contains("#[cfg(not(windows))]") && body.contains("Err((\"unsupported\""));
}
