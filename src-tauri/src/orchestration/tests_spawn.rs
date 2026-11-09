//! 오케스트레이션 시험 — **서버가 작업자를 띄운다**(설계 H 의 3단계 몫 · 3차 3a: 헤드리스 턴 · 맡긴 저장소의 역할 — 동작 계약 위주, 소스
//! 훑기는 보조). 서버 손은 가짜([`Fake`])를 꽂는다 — 진짜 CLI 는 실기(개발 앱)에서 본다. worktree 시험은 임시 git 저장소에서 진짜 git 을
//! 부른다. 맡기기는 시험용 역할 표(`test_album`)로 꽂는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::spawn::*;
use super::store::*;
use super::test_album::{self as td, WRITER};
use super::turn::{self, Grade, TurnArgs};
use super::worktree as owt;

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Fake {
    jobs: Mutex<Vec<LaunchJob>>,
    stops: Mutex<Vec<String>>,
    gone: AtomicBool,
    exited: AtomicBool,
}

impl WorkerLauncher for Fake {
    fn launch(&self, job: LaunchJob) {
        self.jobs.lock().unwrap().push(job);
    }
    fn stop(&self, _run_id: &str, attempt_id: &str) {
        self.stops.lock().unwrap().push(attempt_id.to_string());
    }
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        self.gone.load(Ordering::SeqCst)
    }
    fn exited(&self, _attempt_id: &str) -> bool {
        self.exited.load(Ordering::SeqCst)
    }
}

struct H {
    o: Arc<Orchestration>,
    fake: Arc<Fake>,
}

fn harness() -> H {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let (tx, _rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(move || c.load(Ordering::SeqCst))));
    let fake = Arc::new(Fake::default());
    o.set_launcher(fake.clone());
    td::delegate_all(&o);
    H { o, fake }
}

fn start_with(o: &Orchestration, limits: Limits) -> String {
    o.start_run(StartRun {
        verify: None,
        name: "spawn".into(),
        repo: "C:/repo".into(),
        worktree_dir: "C:/repo-wt".into(),
        limits,
    })
    .unwrap()
    .0
}

fn start(o: &Orchestration) -> String {
    start_with(o, Limits::default())
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

fn task(o: &Orchestration, c: &Caller, req: &str) -> String {
    let v = call(o, c, "create_task", json!({ "requestId": req, "title": "T", "goal": "do it" })).unwrap();
    v["task"]["id"].as_str().unwrap().to_string()
}

fn spawn_req(o: &Orchestration, c: &Caller, req: &str, task: &str) -> Result<Value, String> {
    call(o, c, "spawn_worker", json!({ "requestId": req, "taskId": task, "role": WRITER }))
}

fn attempt_state(o: &Orchestration, run: &str, att: &str) -> String {
    let d = o.run_detail(run).unwrap();
    d["attempts"].as_array().unwrap().iter().find(|a| a["id"] == att).unwrap()["state"].as_str().unwrap().to_string()
}

fn resolves(o: &Orchestration, token: &str) -> bool {
    o.resolve(Some(&format!("Bearer {token}"))).is_some()
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-orch3-{}-{tag}-{}-{}",
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

// ---------------------------------------------------------------------------
// 첫 지시 · 인자 (순수)
// ---------------------------------------------------------------------------

fn sample_task(title: &str, goal: &str) -> Task {
    Task {
        id: new_id("task").unwrap(),
        title: title.into(),
        goal: goal.into(),
        scope: String::new(),
        done_when: String::new(),
        depends_on: vec![],
        version: 1,
        state: TaskState::Active,
        current_attempt: None,
        created_at: 0,
        updated_at: 0,
        conflict: None,
        review: Default::default(),
        rework_count: 0,
    }
}

/// 작업자 첫 턴의 인자(쓰기형 `edit` — 서버 손이 짓는 꼴).
fn argv_for(cli: WorkerCli, prompt: &str) -> Vec<String> {
    let extra = crate::codex_launch::codex_extra_args(Some(&crate::codex_launch::CodexLaunchEnv {
        filtered_path: "C:/w".into(),
        original_path: "C:/w;C:/x".into(),
    }));
    let allowed = vec!["npm test".to_string()];
    turn::turn_argv(&TurnArgs {
        cli,
        exe: "C:/bin/cli.exe",
        grade: Grade::Edit,
        resume: None,
        session_id: (cli == WorkerCli::Claude).then_some("11111111-2222-4333-8444-555555555555"),
        mcp_name: "aynx-sessions-dev",
        mcp_tools: WORKER_ALLOWED_TOOLS,
        mcp_config: (cli == WorkerCli::Claude).then_some("C:/data/agent-mcp/orch-att-x-t1.json"),
        mcp_url: "http://127.0.0.1:5/mcp",
        token_env: "AYNX_DEV_MCP_TOKEN",
        allowed_commands: &allowed,
        read_rule: Some("Read(//c/data/run/**)"),
        add_dir: None,
        cwd: Some("C:/wt/x"),
        codex_extra: &extra,
        model_args: &[],
        append_file: None,
        developer_instructions: None,
        prompt,
    })
}

#[test]
fn first_instruction_starts_with_bracket() {
    for (title, goal) in [("/permissions", "/config"), ("!echo pwned", "!rm -rf ."), ("\u{1b}[2J x", "a\r\nb\u{7f}\u{9b}c")] {
        let t = sample_task(title, goal);
        let p = plan_prompt("att-1", &t, Path::new("C:/data/run-1"));
        assert!(p.arg().starts_with('['), "{:?}", p.arg());
        let body = task_body(&t);
        assert!(!body.contains('\r') && !body.contains('\u{1b}') && !body.contains('\u{7f}') && !body.contains('\u{9b}'), "{body:?}");
        // (3a) 이어지는 턴의 지시도 머리줄 `[` 로 시작하고 같은 정화를 지난다.
        let r = resume_instruction("att-1", 2, goal);
        assert!(r.starts_with("[AYNX · coordinator → worker att-1 · turn 2]"), "{r:?}");
        assert!(!r.contains('\r') && !r.contains('\u{1b}') && !r.contains('\u{9b}'));
    }
    // 긴 명세 — 파일로 빼도 인자와 파일 본문 모두 `[` 로 시작한다.
    let t = sample_task("big", &"가".repeat(16 * 1024));
    let p = plan_prompt("att-1", &t, Path::new("C:/data/run-1"));
    match &p {
        Prompt::File { prompt, body, file, .. } => {
            assert!(prompt.starts_with('[') && body.starts_with('['));
            assert!(prompt.len() < 1024);
            assert!(file.ends_with(format!("{}.md", t.id)));
        }
        Prompt::Inline(_) => panic!("24 KiB 를 넘으면 파일로"),
    }
    // 머리줄 · 줄바꿈 · TAB · 한글 보존.
    let t = sample_task("한글", "a\tb\n\nc");
    assert!(task_body(&t).contains("a\tb\n\nc"));
    assert_eq!(claude_read_rule(Path::new(r"C:\Users\me\data\run-1")).as_deref(), Some("Read(//c/Users/me/data/run-1/**)"));
    assert_eq!(claude_read_rule(Path::new(r"C:\Program Files (x86)\x")), None);
    // (3a) 작업자 첫 지시에는 헤드리스 실패 지침(D14)이 있다 — 권한 화면을 기다리라는 옛 문장은 없다.
    let body = task_body(&sample_task("t", "g"));
    assert!(body.contains("You run headless") && body.contains("outcome blocked"));
    assert!(!body.contains("answered by a person"));
}

/// 머리줄은 작업자 활동 · 턴 줄에 그대로 보인다 — 앱 언어를 따지지 않는 영어 고정(본문 · 깨움 머리글과 같다 · 2026-11-07).
#[test]
fn instruction_headers_are_english() {
    for h in [header("att-1", "task-1"), resume_header("att-1", 2), reviewer_header("att-1", "task-1")] {
        assert!(h.starts_with("[AYNX · "), "{h:?}");
        assert!(!h.chars().any(|c| ('\u{ac00}'..='\u{d7a3}').contains(&c)), "{h:?}");
    }
}

#[test]
fn argv_options_then_double_dash_then_prompt() {
    for cli in [WorkerCli::Claude, WorkerCli::Codex] {
        let a = argv_for(cli, "[AYNX · worker]\nhi");
        let n = a.len();
        assert_eq!(a[n - 2], "--", "{cli:?} {a:?}");
        assert_eq!(a[n - 1], "[AYNX · worker]\nhi");
        assert_eq!(a.iter().filter(|x| *x == "--").count(), 1, "`--` 는 하나 — 프롬프트 바로 앞");
        assert_eq!(a[0], "C:/bin/cli.exe");
    }
}

#[test]
fn spawn_does_not_append_user_agent_args() {
    // 인자는 정해진 낱말뿐이다 — 사용자 `[ai.args]` · 전역 MCP 토큰 · 사용자 MCP 가 섞이지 않는다(3a — 헤드리스 턴의 인자 표).
    let claude = argv_for(WorkerCli::Claude, "[p]");
    assert_eq!(
        claude,
        vec![
            "C:/bin/cli.exe",
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--session-id",
            "11111111-2222-4333-8444-555555555555",
            "--restricted",
            "--tools",
            "Read,Edit,Write,Glob,Grep,Bash",
            "--settings",
            "{\"permissions\":{\"allow\":[\"Bash(npm test:*)\"]}}",
            "--permission-mode",
            "acceptEdits",
            "--permission-prompts",
            "none",
            "--mcp-config",
            "C:/data/agent-mcp/orch-att-x-t1.json",
            "--strict-mcp-config",
            "--allowedTools",
            "mcp__aynx-sessions-dev__get_task",
            "mcp__aynx-sessions-dev__commit_changes",
            "mcp__aynx-sessions-dev__report_done",
            "Read(//c/data/run/**)",
            "--",
            "[p]",
        ]
    );
    let codex = argv_for(WorkerCli::Codex, "[p]");
    assert!(codex.starts_with(&["C:/bin/cli.exe".to_string(), "-a".into(), "never".into(), "exec".into(), "--json".into()]), "{codex:?}");
    assert!(!codex.iter().any(|a| a == "--no-daemon"), "헤드리스 exec 에 TUI 감싸개 표식은 없다");
    // 소스 훑기(보조) — 작업자 생성 경로는 사용자 추가 인자 · autorun 장식을 부르지 않는다.
    for f in ["src/orchestration/spawn.rs", "src/orchestration/turn.rs", "src/server/workers.rs"] {
        let s = std::fs::read_to_string(f).unwrap();
        for bad in ["agent_args::apply_configured", "agent_extra_args", "agent_autorun", "agent_mcp::apply_configured"] {
            assert!(!s.contains(bad), "{f} 가 {bad} 를 부른다");
        }
    }
}

#[test]
fn first_instruction_passed_as_argv_not_shell_line() {
    // 셸이 해석할 글자가 든 지시도 인자 하나로 **그대로** 간다(인용은 MSVC 표준 — 셸 줄을 짓지 않는다). 첫 턴 · resume 턴 모두.
    let nasty = "[AYNX]\n\"quoted\" $env:PATH; & calc | !x %PATH% `n '; exit";
    for cli in [WorkerCli::Claude, WorkerCli::Codex] {
        let a = argv_for(cli, nasty);
        assert_eq!(a.last().unwrap(), nasty);
        assert_eq!(a.iter().filter(|x| x.contains("calc")).count(), 1);
    }
    // 소스 훑기(보조) — 서버 손에 셸 실행 · PTY 쓰기가 없다(3a — 작업자도 헤드리스 턴: 지시는 실행 인자뿐, stdin = NUL).
    let s = std::fs::read_to_string("src/server/workers.rs").unwrap();
    let s = match s.find("mod tests {") {
        Some(at) => s[..at].to_string(),
        None => s,
    };
    let code: String = s.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    for bad in ["write_blocking", "-Command", "cmd.exe", "pwsh", "powershell", "\"/c\"", "\\r", "open_worker", "spawn_program", "PtyIo"] {
        assert!(!code.contains(bad), "workers.rs 에 {bad}");
    }
    assert!(code.contains("turn::turn_argv"));
    assert!(code.contains("turn::quote_argv"));
}

/// 시험 표 4절 — 첫 지시가 **실제 OS 경계**(`CreateProcessW` 명령줄 인용 — 헤드리스 턴과 같은 `os::spawn_in_job` · `turn::quote_argv`)를
/// 지나도 인자 하나로 보존되고, 서버가 준 환경이 그 프로세스에 닿는다. node 로 받은 argv · 환경을 파일로 돌려받는다(node 가 없으면 건너뛴다).
#[cfg(windows)]
#[test]
fn first_instruction_survives_real_os_boundary() {
    let Some(node) = find_exe("node", std::env::var_os("PATH").as_deref()) else {
        eprintln!("node 가 PATH 에 없다 — 건너뜀");
        return;
    };
    let dir = scratch("os-argv");
    let out = dir.join("argv.json");
    let nasty = "[AYNX]\n\"quoted\" $env:PATH; & calc | !x %PATH% `n '; exit \\\" \\\\";
    let script = "require('fs').writeFileSync(process.env.AYNX_TEST_OUT, JSON.stringify({argv: process.argv.slice(1), mark: process.env.AYNX_TEST_MARK}))";
    let exe = node.to_string_lossy().into_owned();
    let argv = vec![exe.clone(), "-e".into(), script.into(), "--".into(), nasty.into()];
    let env = turn::headless_env(
        std::env::vars(),
        &[
            ("AYNX_TEST_OUT".into(), out.to_string_lossy().into_owned()),
            ("AYNX_TEST_MARK".into(), "mark 1 % & \"".into()),
        ],
    );
    let p = crate::server::os::spawn_in_job(&exe, &turn::quote_argv(&argv), &dir, &env, crate::server::os::Stdin::Eof).expect("생성");
    let code = p.wait(20_000);
    assert_eq!(code, Some(0));
    let v: Value = serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap();
    assert_eq!(v["argv"], json!([nasty]), "`--` 뒤 인자 하나로 그대로");
    assert_eq!(v["mark"], "mark 1 % & \"", "서버가 준 환경이 닿는다");
    drop(p);
    cleanup(&dir);
}

#[cfg(windows)]
#[test]
fn spawn_fails_on_missing_cwd() {
    let dir = scratch("cwd");
    let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
    let env = turn::headless_env(std::env::vars(), &[]);
    // 없는 cwd 는 실패 — 홈 폴백 없음. 아무것도 서지 않는다.
    assert!(crate::server::os::spawn_in_job(&exe, &turn::quote_argv(&[exe.clone(), "--version".into()]), &dir.join("gone"), &env, crate::server::os::Stdin::Eof).is_err());
    // 실행 파일은 PATH 의 `.exe` 만(`.cmd` 해석을 띄우는 쪽에 맡기지 않는다).
    assert!(find_exe("definitely-not-a-cli-xyz", std::env::var_os("PATH").as_deref()).is_none());
    cleanup(&dir);
}

// ---------------------------------------------------------------------------
// 생성 · 중단 · 토큰 (가짜 서버 손)
// ---------------------------------------------------------------------------

#[test]
fn spawn_slot_reservation_is_atomic() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let tasks: Vec<String> = (0..6).map(|i| task(&h.o, &c, &format!("t{i}"))).collect();
    let mut threads = Vec::new();
    for (i, t) in tasks.iter().enumerate() {
        let (o, c, t) = (Arc::clone(&h.o), c.clone(), t.clone());
        threads.push(std::thread::spawn(move || spawn_req(&o, &c, &format!("s{i}"), &t)));
    }
    let results: Vec<Result<Value, String>> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    let ok = results.iter().filter(|r| r.is_ok()).count();
    assert_eq!(ok, 3, "동시 3 — {results:?}");
    for r in results.iter().filter(|r| r.is_err()) {
        assert!(r.as_ref().unwrap_err().starts_with("worker-limit"), "{r:?}");
    }
    assert_eq!(h.fake.jobs.lock().unwrap().len(), 3);
    // 같은 requestId 는 처음 결과 — 두 번 띄우지 않는다.
    let first = results.iter().position(|r| r.is_ok()).unwrap();
    let again = spawn_req(&h.o, &c, &format!("s{first}"), &tasks[first]).unwrap();
    assert_eq!(&again, results[first].as_ref().unwrap());
    assert_eq!(h.fake.jobs.lock().unwrap().len(), 3);
    // 띄운 일 — 턴 자원 열쇠 · Claude 대화 id · 첫 턴의 작업자 토큰(그 Attempt 로 풀린다) · 역할(표에서) · Task 는 active.
    let jobs = h.fake.jobs.lock().unwrap();
    let j = &jobs[0];
    assert_eq!(j.stream, turn_claim_key(&j.attempt_id, 1));
    assert_eq!(j.turn.n, 1);
    assert!(j.turn.resume.is_none());
    assert_eq!(j.turn.role.id, WRITER);
    assert_eq!(j.turn.role.grade, Grade::Edit);
    assert!(j.session_id.as_deref().is_some_and(|s| s.len() == 36));
    let w = h.o.resolve(Some(&format!("Bearer {}", j.token))).unwrap();
    assert!(matches!(&w, Caller::Worker { attempt_id, .. } if *attempt_id == j.attempt_id));
    let d = h.o.run_detail(&run).unwrap();
    let t = d["tasks"].as_array().unwrap().iter().find(|t| t["id"] == j.task.id.as_str()).unwrap().clone();
    assert_eq!(t["state"], "active");
    assert_eq!(t["currentAttempt"], j.attempt_id.as_str());
    let a = d["attempts"].as_array().unwrap().iter().find(|a| a["id"] == j.attempt_id.as_str()).unwrap().clone();
    assert_eq!((a["kind"].as_str(), a["roleId"].as_str()), (Some("write"), Some(WRITER)));
    assert!(a.get("stream").is_none_or(Value::is_null), "헤드리스 — 세션 스트림이 없다");
    // 같은 Task 에 열린 작업자가 있으면 `task-busy`.
    assert_eq!(code(spawn_req(&h.o, &c, "again", &j.task.id)), "task-busy");
    // 옛 `cli` 인자 · 모르는 역할.
    let t6 = task(&h.o, &c, "t6");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "cx", "taskId": t6, "cli": "codex" }))), "bad-args");
    assert_eq!(code(call(&h.o, &c, "spawn_worker", json!({ "requestId": "cy", "taskId": t6, "role": "r-deadbeef" }))), "unknown-role");
}

#[test]
fn spawn_respects_dependencies() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let a = task(&h.o, &c, "a");
    let b = task(&h.o, &c, "b");
    let v = call(&h.o, &c, "create_task", json!({ "requestId": "x", "title": "X", "goal": "g", "dependsOn": [a, b] })).unwrap();
    let x = v["task"]["id"].as_str().unwrap().to_string();
    assert_eq!(code(spawn_req(&h.o, &c, "sx", &x)), "dependency-not-accepted");
    {
        let mut g = h.o.lock();
        for t in &mut g.runs.get_mut(&run).unwrap().run.tasks {
            if t.id == a || t.id == b {
                t.state = TaskState::Accepted;
            }
        }
    }
    assert_eq!(code(spawn_req(&h.o, &c, "sx2", &x)), "needs-merge");
    let ok = call(&h.o, &c, "spawn_worker", json!({ "requestId": "sx3", "taskId": x, "role": WRITER, "base": "main" }));
    assert!(ok.is_ok(), "{ok:?}");
    assert_eq!(h.fake.jobs.lock().unwrap()[0].base, Base::Main);
}

#[test]
fn stopping_blocks_new_spawn() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t");
    let t2 = task(&h.o, &c, "t2");
    h.o.bind_coordinator(&run, 1, "tile-coord").unwrap();
    let att = spawn_req(&h.o, &c, "s1", &t).unwrap()["attemptId"].as_str().unwrap().to_string();
    h.o.stop(&run).unwrap();
    // 도는 턴이 있으니 stopping 에 머문다 — 새 생성은 즉시 막힌다(조정자 묶음은 이미 풀렸다 — 그 타일의 새 요청은 `run-ended`, 3차 4단계).
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopping");
    assert!(h.o.bound_coordinator("tile-coord").is_none());
    // 이미 풀린 호출자(진행 중이던 요청)라도 Run 이 stopping 이면 거절.
    assert_eq!(code(spawn_req(&h.o, &c, "s2", &t2)), "run-stopped");
    assert_eq!(attempt_state(&h.o, &run, &att), "stopping");
    assert_eq!(h.fake.stops.lock().unwrap().as_slice(), std::slice::from_ref(&att));
    assert_eq!(h.fake.jobs.lock().unwrap().len(), 1);
}

#[test]
fn late_spawn_after_stop_is_reaped() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t");
    let att = spawn_req(&h.o, &c, "s1", &t).unwrap()["attemptId"].as_str().unwrap().to_string();
    // 생성이 worktree 를 만드는 사이 사람이 중단한다.
    h.o.stop(&run).unwrap();
    // worktree 뒤 — 계속하지 말라(서버 손은 프로세스를 띄우지 않고 실패로 마감한다).
    assert!(!h.o.attempt_worktree(&run, &att, "C:/repo-wt/x", "x", &"a".repeat(40)));
    // 그래도 프로세스가 이미 섰다면(경합) — 회수 판정.
    assert_eq!(h.o.attempt_spawned(&run, &att, Some(4242)), super::SpawnVerdict::Reap);
    assert_eq!(attempt_state(&h.o, &run, &att), "stopping");
    // 회수 뒤 트리가 사라졌다 → stopped, Run 도 stopped.
    h.o.attempt_process_exited(&run, &att, true, None);
    assert_eq!(attempt_state(&h.o, &run, &att), "stopped");
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
    // 생성 자체가 실패한 경우(중단 중) — 프로세스가 없으니 곧바로 stopped.
    let h2 = harness();
    let run2 = start(&h2.o);
    let c2 = coordinator(&h2.o, &run2);
    let t2 = task(&h2.o, &c2, "t");
    let a2 = spawn_req(&h2.o, &c2, "s", &t2).unwrap()["attemptId"].as_str().unwrap().to_string();
    h2.o.stop(&run2).unwrap();
    h2.o.attempt_spawn_failed(&run2, &a2, "stopped before the worker started");
    assert_eq!(attempt_state(&h2.o, &run2, &a2), "stopped");
    assert_eq!(h2.o.run_detail(&run2).unwrap()["state"], "stopped");
}

#[test]
fn stopped_only_after_tree_exit() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    let t = task(&h.o, &c, "t");
    let att = spawn_req(&h.o, &c, "s1", &t).unwrap()["attemptId"].as_str().unwrap().to_string();
    assert!(h.o.attempt_worktree(&run, &att, "C:/repo-wt/x", "x", &"a".repeat(40)));
    assert_eq!(h.o.attempt_spawned(&run, &att, Some(4242)), super::SpawnVerdict::Keep);
    assert_eq!(attempt_state(&h.o, &run, &att), "running", "3a — 턴이 돈다(부트스트랩 단계가 없다)");
    // 조정자의 stop_worker — stopping(트리 종료는 서버 손).
    let v = call(&h.o, &c, "stop_worker", json!({ "requestId": "x1", "attemptId": att })).unwrap();
    assert_eq!(v["state"], "stopping");
    assert_eq!(h.fake.stops.lock().unwrap().as_slice(), std::slice::from_ref(&att));
    // CLI 는 끝났는데 트리 확인이 안 됐다 → stop-unconfirmed(stopped 아님), Run 은 그대로.
    h.o.attempt_process_exited(&run, &att, false, None);
    assert_eq!(attempt_state(&h.o, &run, &att), "stop-unconfirmed");
    // 서버 시계가 다시 본다 — 아직이면 그대로, 사라졌으면 stopped(중단을 청했으므로 — `idle` 이 아니다).
    assert_eq!(h.o.recheck_unconfirmed(), 0);
    assert_eq!(attempt_state(&h.o, &run, &att), "stop-unconfirmed");
    h.fake.gone.store(true, Ordering::SeqCst);
    assert_eq!(h.o.recheck_unconfirmed(), 1);
    assert_eq!(attempt_state(&h.o, &run, &att), "stopped");
    // Run 중단 — 도는 턴이 없으니 곧바로 stopped.
    h.o.stop(&run).unwrap();
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
}

#[test]
fn worker_token_survives_stop_until_exit() {
    let h = harness();
    let run = start(&h.o);
    let c = coordinator(&h.o, &run);
    h.o.bind_coordinator(&run, 1, "tile-coord").unwrap();
    let t = task(&h.o, &c, "t");
    let att = spawn_req(&h.o, &c, "s1", &t).unwrap()["attemptId"].as_str().unwrap().to_string();
    let wtoken = h.fake.jobs.lock().unwrap()[0].token.clone();
    assert_eq!(h.o.attempt_spawned(&run, &att, Some(1)), super::SpawnVerdict::Keep);
    h.o.stop(&run).unwrap();
    // 조정자 묶음은 즉시 풀리고(3차 4단계 — 조정자 토큰은 없다), 그 턴의 작업자 토큰은 남는다(늦은 보고를 `late` 로 받으려고).
    assert!(h.o.bound_coordinator("tile-coord").is_none());
    assert!(resolves(&h.o, &wtoken));
    let w = h.o.resolve(Some(&format!("Bearer {wtoken}"))).unwrap();
    assert_eq!(call(&h.o, &w, "get_task", json!({})).unwrap()["attemptId"], att.as_str());
    // 종료 미확인이면 여전히 남는다.
    h.o.attempt_process_exited(&run, &att, false, None);
    assert!(resolves(&h.o, &wtoken));
    // 종료 확인 → 거둔다.
    h.o.attempt_process_exited(&run, &att, true, None);
    assert!(!resolves(&h.o, &wtoken));
    // 생성 실패는 곧바로 거둔다.
    let h2 = harness();
    let run2 = start(&h2.o);
    let c2 = coordinator(&h2.o, &run2);
    let t2 = task(&h2.o, &c2, "t");
    let a2 = spawn_req(&h2.o, &c2, "s", &t2).unwrap()["attemptId"].as_str().unwrap().to_string();
    let tok2 = h2.fake.jobs.lock().unwrap()[0].token.clone();
    h2.o.attempt_spawn_failed(&run2, &a2, "cli-not-found: claude");
    assert!(!resolves(&h2.o, &tok2));
    assert_eq!(attempt_state(&h2.o, &run2, &a2), "exited");
}

/// 리뷰 F2 · 헤드리스 설계 4-4 · 4-5 — **턴의 자연 끝도** 트리 종료를 확인하기 전에는 살아 있을 수 있다(`stop-unconfirmed`): 그 턴의 토큰 ·
/// 동시 슬롯 · worktree 를 유지하고, 서버 시계가 다시 보아 확인되면 `idle`(보고 없음 — 닫히지 않았다 · 토큰 회수 · **동시 슬롯은 놓는다** ·
/// worktree 는 계속 쥔다). 그 사이 Run 중단은 확인 전까지 `stopped` 가 아니다.
#[test]
fn natural_turn_end_unconfirmed_stays_live_until_tree_gone() {
    let h = harness();
    let limits = LimitsInput {
        max_concurrent_workers: Some(1),
        ..Default::default()
    }
    .resolve();
    let run = start_with(&h.o, limits);
    let c = coordinator(&h.o, &run);
    let t1 = task(&h.o, &c, "t1");
    let t2 = task(&h.o, &c, "t2");
    let att = spawn_req(&h.o, &c, "s1", &t1).unwrap()["attemptId"].as_str().unwrap().to_string();
    let token = h.fake.jobs.lock().unwrap().last().unwrap().token.clone();
    let wt = scratch("f2-wt");
    assert!(h.o.attempt_worktree(&run, &att, &wt.to_string_lossy(), "orch-f2", "abc"));
    assert_eq!(h.o.attempt_spawned(&run, &att, Some(4242)), super::SpawnVerdict::Keep);
    // 턴이 스스로 끝났는데 트리를 확인하지 못했다.
    h.o.attempt_process_exited(&run, &att, false, Some(0));
    assert_eq!(attempt_state(&h.o, &run, &att), "stop-unconfirmed");
    assert!(resolves(&h.o, &token), "토큰은 트리 확인까지 남는다");
    assert_eq!(code(spawn_req(&h.o, &c, "s2", &t2)), "worker-limit", "동시 슬롯도 그대로");
    assert!(h.o.worktree_in_use(&run, &wt.to_string_lossy()), "worktree 도 쓰는 중");
    let notices = h.o.notices_view();
    assert!(notices.as_array().unwrap().iter().any(|n| n["kind"] == "exit-unconfirmed"), "감독 사건: {notices}");
    // 시계 — 아직이면 그대로, 사라졌으면 idle(보고 없이 끝난 턴 — 닫히지 않았다).
    assert_eq!(h.o.recheck_unconfirmed(), 0);
    assert_eq!(attempt_state(&h.o, &run, &att), "stop-unconfirmed");
    h.fake.gone.store(true, Ordering::SeqCst);
    assert_eq!(h.o.recheck_unconfirmed(), 1);
    assert_eq!(attempt_state(&h.o, &run, &att), "idle");
    assert!(!resolves(&h.o, &token), "확인되면 그 턴의 토큰을 거둔다 — idle 에는 산 토큰이 없다");
    assert!(h.o.worktree_in_use(&run, &wt.to_string_lossy()), "idle 은 worktree 를 쥔다(owns_worktree)");
    // idle 은 동시 자리를 차지하지 않는다(4-5) — 다른 Task 의 작업자가 선다.
    let att2 = spawn_req(&h.o, &c, "s2", &t2).unwrap()["attemptId"].as_str().unwrap().to_string();
    // 미확인 자연 끝 뒤 Run 중단 — 확인될 때까지 stopping, 시계가 마무리한다. idle 은 곧바로 닫힌다.
    assert_eq!(h.o.attempt_spawned(&run, &att2, Some(4243)), super::SpawnVerdict::Keep);
    h.fake.gone.store(false, Ordering::SeqCst);
    h.o.attempt_process_exited(&run, &att2, false, None);
    assert_eq!(attempt_state(&h.o, &run, &att2), "stop-unconfirmed");
    h.o.stop(&run).unwrap();
    assert_eq!(attempt_state(&h.o, &run, &att), "stopped", "idle 은 Run 중단이 곧바로 닫는다");
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopping", "확인 전에는 stopped 가 아니다");
    h.fake.exited.store(true, Ordering::SeqCst);
    assert_eq!(h.o.recheck_unconfirmed(), 0, "트리가 남아 있으면 그대로");
    h.fake.gone.store(true, Ordering::SeqCst);
    assert_eq!(h.o.recheck_unconfirmed(), 1);
    assert_eq!(attempt_state(&h.o, &run, &att2), "stopped");
    assert_eq!(h.o.run_detail(&run).unwrap()["state"], "stopped");
    cleanup(&wt);
}

/// 10-15 — Codex 작업자에게 `.git` 쓰기 허용(`writable_roots`)을 주지 않는다(효과가 없었고, 커밋은 서버가 `commit_changes` 로 집행한다).
/// 인자 표(모든 등급 · 첫 턴 · resume)에도 · 서버 손(소스 훑기)에도 없다.
#[test]
fn codex_worker_has_no_git_writable_roots() {
    for g in [Grade::Edit, Grade::Full, Grade::ReadOnly] {
        for resume in [None, Some("01a143b6-0000-7000-8000-00000000abcd")] {
            let codex = turn::turn_argv(&TurnArgs {
                cli: WorkerCli::Codex,
                exe: "C:/bin/codex.exe",
                grade: g,
                resume,
                session_id: None,
                mcp_name: "aynx-sessions-dev",
                mcp_tools: WORKER_ALLOWED_TOOLS,
                mcp_config: None,
                mcp_url: "http://127.0.0.1:1/mcp",
                token_env: "AYNX_MCP_TOKEN",
                allowed_commands: &[],
                read_rule: None,
                add_dir: None,
                cwd: Some("C:/wt"),
                codex_extra: &[],
                model_args: &[],
                append_file: None,
                developer_instructions: None,
                prompt: "[x]",
            });
            assert!(!codex.iter().any(|a| a.contains("writable_roots") || a.contains(".git")), "{codex:?}");
        }
    }
    let marker = ["writable", "_roots"].concat();
    let workers = include_str!("../server/workers.rs");
    assert!(!workers.contains(&format!("{marker}=")), "서버 손이 writable_roots 를 싣지 않는다");
    let spawn = include_str!("spawn.rs");
    assert!(!spawn.contains(&format!("sandbox_workspace_write.{marker}")));
}

// ---------------------------------------------------------------------------
// worktree op 층 (진짜 git)
// ---------------------------------------------------------------------------

fn git(dir: &Path, args: &[&str]) -> crate::worktree::GitRun {
    let mut full = vec!["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    full.extend_from_slice(args);
    crate::worktree::run_git(dir, &full, crate::worktree::GIT_TIMEOUT).unwrap()
}

/// 임시 저장소(`main`, 커밋 하나 — `.gitignore` 에 `link/`).
fn repo(root: &Path) -> PathBuf {
    let r = root.join("repo");
    std::fs::create_dir_all(&r).unwrap();
    assert!(git(&r, &["init", "-q", "-b", "main"]).ok);
    std::fs::write(r.join("a.txt"), "a\n").unwrap();
    std::fs::write(r.join(".gitignore"), "link/\n").unwrap();
    assert!(git(&r, &["add", "."]).ok);
    assert!(git(&r, &["commit", "-q", "-m", "init"]).ok);
    r
}

fn run_id() -> String {
    new_id("run").unwrap()
}

#[test]
fn worktree_hooks_disabled_on_server_add() {
    let root = scratch("hooks");
    let r = repo(&root);
    let marker = root.join("hook-ran.txt");
    let hook = format!("#!/bin/sh\necho ran > '{}'\n", marker.to_string_lossy().replace('\\', "/"));
    let hooks = r.join(".git").join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    std::fs::write(hooks.join("post-checkout"), hook).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(hooks.join("post-checkout"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // 대조군 — 평범한 `git worktree add` 는 훅을 돌린다(이 PC 에서 훅이 실제로 도는지 확인).
    let control = root.join("repo-wt").join("control");
    assert!(git(&r, &["worktree", "add", "-q", "-b", "control", &control.to_string_lossy()]).ok);
    let control_ran = marker.exists();
    let _ = std::fs::remove_file(&marker);
    // 서버의 worktree op — 훅 끔.
    let empty = root.join("empty-hooks");
    std::fs::create_dir_all(&empty).unwrap();
    let side = root.join("worktrees.json");
    let wt_dir = root.join("repo-wt").to_string_lossy().into_owned();
    let run = run_id();
    let c = owt::create_blocking(&r, &wt_dir, "orch-a-b", &Base::Main, &run, Some(&side), &empty).unwrap();
    assert!(Path::new(&c.path).join("a.txt").is_file());
    assert_eq!(c.branch, "orch-a-b");
    assert_eq!(c.base_commit.len(), 40);
    assert!(!marker.exists(), "서버의 worktree add 는 post-checkout 훅을 돌리지 않는다");
    assert!(control_ran, "대조군에서 훅이 돌아야 시험이 뜻이 있다");
    // 곁 파일에 그 Run 의 줄.
    let file = crate::worktree::load_sidecar(&side);
    assert_eq!(crate::worktree::run_of(&file, &crate::worktree::path_key(&c.path)), Some(run.clone()));
    // Run 의 자리 밖 · 있는 브랜치 · 같은 이름은 거절.
    assert!(owt::create_blocking(&r, &wt_dir, "orch-a-b", &Base::Main, &run, Some(&side), &empty).is_err());
    assert!(owt::create_blocking(&r, &wt_dir, "../escape", &Base::Main, &run, Some(&side), &empty).is_err());
    assert!(owt::create_blocking(&r, &wt_dir, "x", &Base::Commit("--help".into()), &run, Some(&side), &empty).is_err());
    cleanup(&root);
}

#[test]
fn worktree_sidecar_single_writer() {
    // 여러 "프로세스"(서로 다른 파일 손잡이 — 프로세스 안 잠금을 거치지 않는 길)가 같은 곁 파일을 읽고-고치고-쓴다 — 잃는 쓰기가 없다.
    let root = scratch("sidecar");
    let side = root.join("worktrees.json");
    std::fs::write(&side, "0").unwrap();
    let mut threads = Vec::new();
    for _ in 0..8 {
        let side = side.clone();
        threads.push(std::thread::spawn(move || {
            for _ in 0..25 {
                crate::worktree::with_file_lock(&side, || {
                    let n: u64 = std::fs::read_to_string(&side).unwrap().trim().parse().unwrap();
                    std::thread::yield_now();
                    std::fs::write(&side, (n + 1).to_string()).map_err(|e| e.to_string())
                })
                .unwrap();
            }
        }));
    }
    for t in threads {
        t.join().unwrap();
    }
    assert_eq!(std::fs::read_to_string(&side).unwrap().trim(), "200");
    assert!(side.with_file_name("worktrees.json.lock").exists());
    // 모든 쓰기는 `modify_sidecar` 하나를 지난다(소스 훑기 — 곁 파일을 직접 쓰는 다른 길이 없다).
    let src = std::fs::read_to_string("src/worktree.rs").unwrap();
    assert_eq!(src.matches("write_sidecar(").count(), 2, "정의 하나 + modify_sidecar 안의 호출 하나");
    cleanup(&root);
}

#[test]
fn worktree_remove_refuses_human_and_unmerged() {
    let root = scratch("remove");
    let r = repo(&root);
    let empty = root.join("empty-hooks");
    std::fs::create_dir_all(&empty).unwrap();
    let side = root.join("worktrees.json");
    let wt_dir = root.join("repo-wt").to_string_lossy().into_owned();
    let run = run_id();
    // 사람이 만든 worktree — 거절.
    let human = root.join("repo-wt").join("human");
    assert!(git(&r, &["worktree", "add", "-q", "-b", "human", &human.to_string_lossy()]).ok);
    let e = owt::remove_blocking(&r, &human.to_string_lossy(), false, &run, Some(&side)).unwrap_err();
    assert_eq!(e.code, "not-run-worktree");
    assert!(human.is_dir());
    // 다른 Run 의 것도 거절.
    let c = owt::create_blocking(&r, &wt_dir, "orch-1", &Base::Main, &run, Some(&side), &empty).unwrap();
    assert_eq!(owt::remove_blocking(&r, &c.path, false, &run_id(), Some(&side)).unwrap_err().code, "not-run-worktree");
    // 병합 안 된 고유 커밋 + 브랜치 삭제 요청 — 아무것도 하지 않고 거절.
    std::fs::write(Path::new(&c.path).join("b.txt"), "b\n").unwrap();
    // 미커밋 변경은 먼저 거절(worktree-dirty).
    assert_eq!(owt::remove_blocking(&r, &c.path, false, &run, Some(&side)).unwrap_err().code, "worktree-dirty");
    assert!(git(Path::new(&c.path), &["add", "."]).ok);
    assert!(git(Path::new(&c.path), &["commit", "-q", "-m", "work"]).ok);
    assert_eq!(owt::remove_blocking(&r, &c.path, true, &run, Some(&side)).unwrap_err().code, "branch-has-unmerged");
    assert!(Path::new(&c.path).is_dir(), "거절이면 worktree 도 그대로");
    // 브랜치를 남기면 지운다.
    let done = owt::remove_blocking(&r, &c.path, false, &run, Some(&side)).unwrap();
    assert!(!Path::new(&c.path).exists());
    assert!(!done.branch_deleted);
    assert!(git(&r, &["show-ref", "--verify", "--quiet", "refs/heads/orch-1"]).ok, "브랜치는 남는다");
    // 고유 커밋이 없는 Run worktree 는 브랜치까지 지운다.
    let c2 = owt::create_blocking(&r, &wt_dir, "orch-2", &Base::Main, &run, Some(&side), &empty).unwrap();
    let done = owt::remove_blocking(&r, &c2.path, true, &run, Some(&side)).unwrap();
    assert!(done.branch_deleted);
    assert!(!git(&r, &["show-ref", "--verify", "--quiet", "refs/heads/orch-2"]).ok);
    // 사람 worktree 정리(시험 뒤) — git 으로.
    assert!(git(&r, &["worktree", "remove", &human.to_string_lossy()]).ok);
    cleanup(&root);
}

/// 곁 기록 줄이 빠진 Run worktree — 사람 [정리]가 넘기는 장부 근거(`LedgerClaim` · 11-09)로만 지운다. 줄이 있으면 그 줄이 정한다.
#[test]
fn worktree_remove_by_ledger_only_when_sidecar_row_is_missing() {
    let root = scratch("ledger");
    let r = repo(&root);
    let empty = root.join("empty-hooks");
    std::fs::create_dir_all(&empty).unwrap();
    let side = root.join("worktrees.json");
    let wt_dir = root.join("repo-wt").to_string_lossy().into_owned();
    let run = run_id();
    fn claim<'a>(dir: &'a str, b: &'a str) -> owt::LedgerClaim<'a> {
        owt::LedgerClaim { worktree_dir: dir, branch: Some(b) }
    }
    let c = owt::create_blocking(&r, &wt_dir, "orch-l", &Base::Main, &run, Some(&side), &empty).unwrap();
    // 곁 기록 줄이 빠졌다.
    crate::worktree::forget_path(&side, &crate::worktree::path_key(&c.path)).unwrap();
    // 장부 근거가 없는 길(조정자 · `remove_blocking`)은 예전처럼 거절.
    assert_eq!(owt::remove_blocking(&r, &c.path, false, &run, Some(&side)).unwrap_err().code, "not-run-worktree");
    // 브랜치가 장부와 다르면 거절.
    let e = owt::remove_with(&r, &c.path, owt::BranchRule::Keep, &run, Some(&side), Some(claim(&wt_dir, "orch-x"))).unwrap_err();
    assert_eq!(e.code, "not-run-worktree");
    // Run 의 worktree 자리 밖이면 거절.
    let elsewhere = root.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let e = owt::remove_with(&r, &c.path, owt::BranchRule::Keep, &run, Some(&side), Some(claim(&elsewhere.to_string_lossy(), "orch-l")))
        .unwrap_err();
    assert_eq!(e.code, "not-run-worktree");
    assert!(Path::new(&c.path).is_dir(), "거절이면 그대로");
    // 자리 안 · 브랜치 같음 — 지운다.
    owt::remove_with(&r, &c.path, owt::BranchRule::Keep, &run, Some(&side), Some(claim(&wt_dir, "orch-l"))).unwrap();
    assert!(!Path::new(&c.path).exists());
    // 곁 기록에 다른 Run 의 줄이 있으면 장부 근거로도 거절.
    let other = run_id();
    let c2 = owt::create_blocking(&r, &wt_dir, "orch-m", &Base::Main, &other, Some(&side), &empty).unwrap();
    let e = owt::remove_with(&r, &c2.path, owt::BranchRule::Keep, &run, Some(&side), Some(claim(&wt_dir, "orch-m"))).unwrap_err();
    assert_eq!(e.code, "not-run-worktree");
    owt::remove_blocking(&r, &c2.path, true, &other, Some(&side)).unwrap();
    cleanup(&root);
}

/// 정션(Windows) · 심볼릭 링크(그 밖)를 만든다.
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

#[test]
fn worktree_remove_unlinks_junctions_first() {
    let root = scratch("junction");
    let r = repo(&root);
    let empty = root.join("empty-hooks");
    std::fs::create_dir_all(&empty).unwrap();
    let side = root.join("worktrees.json");
    let wt_dir = root.join("repo-wt").to_string_lossy().into_owned();
    let run = run_id();
    let c = owt::create_blocking(&r, &wt_dir, "orch-j", &Base::Main, &run, Some(&side), &empty).unwrap();
    // worktree 밖의 소중한 폴더 — 정션이 가리킨다(무시 파일이라 git status 는 깨끗하다).
    let outside = root.join("outside");
    std::fs::create_dir_all(outside.join("deep")).unwrap();
    std::fs::write(outside.join("deep").join("keep.txt"), "keep").unwrap();
    let link = Path::new(&c.path).join("link");
    make_dir_link(&link, &outside);
    assert!(link.join("deep").join("keep.txt").is_file());
    let done = owt::remove_blocking(&r, &c.path, true, &run, Some(&side)).unwrap();
    assert_eq!(done.unlinked, 1);
    assert!(!Path::new(&c.path).exists(), "worktree 는 지워졌다");
    assert!(outside.join("deep").join("keep.txt").is_file(), "정션 대상은 그대로");
    // unlink_links 자체도 — 링크만 걷고 대상은 남긴다.
    let probe = root.join("probe");
    std::fs::create_dir_all(probe.join("sub")).unwrap();
    make_dir_link(&probe.join("sub").join("l"), &outside);
    assert_eq!(owt::unlink_links(&probe, &[]).unwrap().len(), 1);
    assert!(!probe.join("sub").join("l").exists());
    assert!(outside.join("deep").join("keep.txt").is_file());
    cleanup(&root);
}

// ---------------------------------------------------------------------------
// 소스 훑기(보조) — 서버가 GUI 요청 없이 띄우는 것은 헤드리스 턴과 검증뿐
// ---------------------------------------------------------------------------

/// `src/` 아래(시험 파일 제외)에서 `name(` 을 **부르는**(정의 `fn name(` 이 아닌) 파일들.
fn callers(name: &str) -> Vec<String> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(Path::new("src"), &mut files);
    let mut hits = Vec::new();
    for f in files {
        let name_s = f.to_string_lossy().replace('\\', "/");
        if name_s.contains("tests") || name_s.ends_with("test_album.rs") {
            continue;
        }
        let full = std::fs::read_to_string(&f).unwrap();
        // 파일 안의 시험 모듈(`mod tests {` 뒤)은 보지 않는다.
        let src = full.split("mod tests {").next().unwrap_or("");
        let calls = src
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .filter(|l| l.contains(&format!("{name}(")) && !l.contains(&format!("fn {name}(")))
            .count();
        if calls > 0 {
            hits.push(name_s);
        }
    }
    hits.sort();
    hits
}

/// 헤드리스 설계 7-2 `server_spawns_only_turns_and_verify`(옛 `server_spawns_only_workers_and_verify` — 3a 에서 작업자도 헤드리스 턴이 됐다:
/// 이 시험과 CLAUDE.md "서버가 GUI 요청 없이 띄우는 것" 문장을 함께 고쳤다). 서버가 GUI 요청 없이 띄우는 것은 **헤드리스 턴**(작업자 · 해결자 ·
/// 검토자 — 셸 없는 CLI 하나 · 파이프 · 생성과 동시에 Job · 세션 · PTY 아님)과 **수락 전 검증**뿐이고, 둘의 OS 몸은 `os::spawn_in_job` 하나다.
#[test]
fn server_spawns_only_turns_and_verify() {
    // - `os::spawn_in_job` 을 부르는 곳 = 검증 감싸개(`os::verify_spawn` — os.rs 안 한 번) + 서버 손의 턴 실행기(`workers::run_turn_blocking`
    //   한 번). 턴 실행기를 부르는 곳은 서버 손의 `start_turn` 하나, 그것은 쓰기형(`launch_writer`) · 판정형(`launch_reviewer`) 두 길에서.
    // - `os::verify_spawn` 은 `verify::execute` 하나에서만, 그 실행은 `run_verify` 하나에서만, 실행 글자는 `cfg.command`(= `Run.verify.command`)
    //   하나에서만 온다(통합 설계 8절).
    assert_eq!(callers("verify_spawn"), vec!["src/orchestration/verify.rs".to_string()]);
    // (사이드 채팅 v2 2단계) 셋째 — 사이드 채팅 프로세스(GUI 요청 op `side_chat_send` 의 게으른 띄우기 하나 ·
    // 시험 `server::tests_side_chat::side_chat_spawns_only_from_the_send_op`). CLAUDE.md "③ 사이드 채팅 프로세스" 문장과 함께 고쳤다.
    // (오케스트레이션 2단계 단계 1) 그 몸은 공용 채팅 프로세스 코어 `server/chat_proc/spawn.rs` 의 `start` 로 옮겨 갔다 — 생성은 여전히 하나이고,
    // 코어의 `start` 를 부르는 곳은 사이드 채팅 표(`server/side_chat.rs` 의 `spawn` — `op_send` 하나)뿐이다.
    assert_eq!(
        callers("spawn_in_job"),
        vec!["src/server/chat_proc/spawn.rs".to_string(), "src/server/os.rs".to_string(), "src/server/workers.rs".to_string()]
    );
    let core = std::fs::read_to_string("src/server/chat_proc/spawn.rs").unwrap();
    assert_eq!(core.matches("os::spawn_in_job(").count(), 1, "채팅 프로세스 생성 하나");
    assert!(core.contains("os::Stdin::Pipe") && !core.contains("Stdin::Eof"));
    // (2단계 단계 2) 넷째 — 프로듀서 채팅 프로세스(같은 코어 · GUI 요청 op `producer_chat_send` 의 전송 길 하나 — 시험
    // `server::producer::tests::producer_spawns_only_from_dispatch`).
    assert_eq!(callers("chat_proc::start"), vec!["src/server/producer/mod.rs".to_string(), "src/server/side_chat.rs".to_string()]);
    let producer = std::fs::read_to_string("src/server/producer/mod.rs").unwrap();
    assert!(!producer.contains("spawn_in_job"), "프로듀서 레지스트리는 직접 띄우지 않는다");
    assert_eq!(producer.matches("chat_proc::start(").count(), 1, "spawn 하나");
    let side_chat = std::fs::read_to_string("src/server/side_chat.rs").unwrap();
    assert!(!side_chat.contains("spawn_in_job"), "사이드 채팅 표는 직접 띄우지 않는다");
    assert_eq!(side_chat.matches("chat_proc::start(").count(), 1, "spawn 하나");
    assert_eq!(side_chat.matches("spawn(&chat, &mut st)").count(), 1, "op_send 하나");
    for f in ["src/server/orchestration_proxy.rs", "src/orchestration/spawn.rs", "src/orchestration/turn.rs", "src/mcp.rs"] {
        let s = std::fs::read_to_string(f).unwrap();
        assert!(!s.contains("\"side_chat_") && !s.contains("side_chat::"), "{f} 는 사이드 채팅으로 가는 길이 없다");
        assert!(!s.contains("\"producer_chat_") && !s.contains("producer::"), "{f} 는 프로듀서 채팅으로 가는 길이 없다");
    }
    let os_src = std::fs::read_to_string("src/server/os.rs").unwrap();
    // os.rs 안: 검증 감싸개의 `spawn_in_job(` 한 번 + 공개 함수 → Windows 몸통(`win::spawn_in_job(`) 한 번.
    assert_eq!(os_src.matches("spawn_in_job(").count() - os_src.matches("fn spawn_in_job(").count(), 2);
    let workers = std::fs::read_to_string("src/server/workers.rs").unwrap();
    let workers = workers.split("mod tests {").next().unwrap();
    assert_eq!(workers.matches("os::spawn_in_job(").count(), 1, "턴 실행기 하나");
    assert!(workers.contains("os::Stdin::Eof)") && !workers.contains("Stdin::Pipe"), "헤드리스 턴의 stdin 은 곧바로 EOF");
    assert_eq!(workers.matches("run_turn_blocking(").count() - workers.matches("fn run_turn_blocking(").count(), 1, "start_turn 하나");
    assert_eq!(workers.matches(" start_turn(").count() - workers.matches("fn start_turn(").count(), 2, "쓰기형 · 판정형 두 길");
    assert!(callers("run_turn_blocking") == vec!["src/server/workers.rs".to_string()]);
    // 헤드리스 턴의 인자는 `turn::turn_argv` 하나가 짓고(셸 줄 조립 없음 — `quote_argv` 는 MSVC 인용), 서버 손에서만 부른다.
    assert_eq!(callers("turn_argv"), vec!["src/server/workers.rs".to_string()]);
    let verify = std::fs::read_to_string("src/orchestration/verify.rs").unwrap();
    let verify = verify.split("mod tests {").next().unwrap();
    assert_eq!(verify.matches("os::verify_spawn(").count(), 1, "execute 하나");
    assert_eq!(verify.matches(" execute(").count() - verify.matches("fn execute(").count(), 1, "run_verify 하나");
    assert!(verify.contains("execute(&cfg.command,"), "실행 글자는 Run.verify.command 에서만");
    assert!(callers("verify::execute").is_empty(), "검증 실행은 verify.rs 밖에서 부르지 않는다");
    // 검증 설정을 만드는 검사는 하나. 새 앨범의 사람 시작(`album_start.rs`)과 R1까지 남는 맡기기 편집 · 옛 Run 시작이 부른다.
    // MCP는 검증 글자를 받지 않고 옛 start_run도 사람이 맡기기에 적은 글자만 사본으로 옮긴다.
    assert_eq!(verify.matches("Some(VerifyConfig {").count(), 1);
    assert_eq!(
        callers("validate_input"),
        vec!["src/orchestration/album_start.rs".to_string()]
    );
    // Run 의 검증 칸에 쓰는 곳은 Run 을 세우는 자리(StartRun 에서) 하나 — 도중에 바꾸는 길이 없다.
    // 저장소 전체(`store.rs` + `store/` 조각 — 2026-10-27 분할)에서 한 번.
    let verify_sets: usize = super::tests::store_sources().iter().map(|(_, s)| s.matches("verify: s.verify").count()).sum();
    assert_eq!(verify_sets, 1);
    for f in ["tools.rs", "report.rs", "attempts.rs", "resume.rs", "roles.rs", "commit.rs", "diff.rs", "progress.rs"] {
        let src = std::fs::read_to_string(format!("src/orchestration/{f}")).unwrap();
        assert!(!src.contains(".verify = ") && !src.contains("VerifyConfig"), "{f} 는 검증 설정을 만들거나 바꾸지 않는다");
    }
    // 셸(`spawn_shell`)은 GUI 요청 `open` 하나에서만. 셸 없는 PTY 프로그램(옛 작업자 세션)은 제품에 없다.
    // (2026-10-27 분할 — 열기는 `server/sessions/open.rs`. 부르는 파일 정확히 하나 · 그 안에서 한 번은 그대로.)
    assert_eq!(callers("spawn_shell"), vec!["src/server/sessions/open.rs".to_string()]);
    assert!(callers("spawn_program").is_empty() && callers("open_worker_blocking").is_empty(), "작업자 PTY 세션은 걷혔다");
    let sessions = std::fs::read_to_string("src/server/sessions/open.rs").unwrap();
    assert_eq!(sessions.matches("pty::spawn_shell(").count(), 1, "open 하나");
    // 서버 손(턴)을 부르는 곳은 조정자의 spawn_worker(첫 턴 — 쓰기형 `attempts.rs` · 판정형 `review.rs`) · send_prompt(이어지는 턴 —
    // `resume.rs`)뿐이다 — GUI · 프런트 명령에는 띄우는 길이 없다.
    let proxy = std::fs::read_to_string("src/server/orchestration_proxy.rs").unwrap();
    assert!(!proxy.contains("spawn_worker") && !proxy.contains("open_worker") && !proxy.contains("spawn_reviewer") && !proxy.contains("send_prompt"));
    assert_eq!(
        callers(".launch"),
        vec![
            "src/orchestration/attempts.rs".to_string(),
            "src/orchestration/resume.rs".to_string(),
            "src/orchestration/review.rs".to_string()
        ]
    );
    assert_eq!(callers("spawn_reviewer"), vec!["src/orchestration/attempts.rs".to_string()], "판정형은 spawn_worker{{role}} 에서만");
}

/// 개발 빌드 전용 모델 덮기 — 값 검사 · CLI 별 낱말(7단계). 3차 2단계부터 `role_model_args` 의 역할 칸 없는 꼴이다(= 지금 동작).
#[test]
fn dev_model_args_shapes_and_validates() {
    let dev = |cli, m, e| role_model_args(cli, None, None, (m, e));
    assert_eq!(dev(WorkerCli::Claude, Some("haiku"), Some("low")), vec!["--model", "haiku"]);
    assert_eq!(dev(WorkerCli::Codex, Some("haiku"), Some("low")), vec!["-c", "model_reasoning_effort=low"]);
    assert!(dev(WorkerCli::Claude, None, Some("low")).is_empty());
    assert!(dev(WorkerCli::Claude, Some("a b"), None).is_empty());
    assert!(dev(WorkerCli::Codex, None, Some("low;rm")).is_empty());
}

/// 헤드리스 설계 7-2 `role_model_effort_args_table` — CLI × 칸 비움/채움 · 개발 덮기가 역할 값을 이김 · 값 검사(좁은 쪽).
#[test]
fn role_model_effort_args_table() {
    let none = (None, None);
    // 칸이 비면 아무것도 싣지 않는다(CLI 기본).
    assert!(role_model_args(WorkerCli::Claude, None, None, none).is_empty());
    assert!(role_model_args(WorkerCli::Codex, None, None, none).is_empty());
    // 채움 — Claude `--model` · `--effort` / Codex `-m` · `-c model_reasoning_effort`.
    assert_eq!(
        role_model_args(WorkerCli::Claude, Some("sonnet"), Some("high"), none),
        vec!["--model", "sonnet", "--effort", "high"]
    );
    assert_eq!(
        role_model_args(WorkerCli::Codex, Some("gpt-6.1-sol"), Some("medium"), none),
        vec!["-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=medium"]
    );
    assert_eq!(role_model_args(WorkerCli::Claude, Some("claude-opus-5-5[1m]"), None, none), vec!["--model", "claude-opus-5-5[1m]"]);
    // 개발 덮기가 이긴다(Claude 는 모델 · Codex 는 강도 — 덮기가 없는 칸은 역할 값 그대로).
    assert_eq!(
        role_model_args(WorkerCli::Claude, Some("sonnet"), Some("high"), (Some("haiku"), Some("low"))),
        vec!["--model", "haiku", "--effort", "high"]
    );
    assert_eq!(
        role_model_args(WorkerCli::Codex, Some("gpt-6.1-sol"), Some("high"), (Some("haiku"), Some("low"))),
        vec!["-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=low"]
    );
    // 이상한 글자 · 모르는 강도는 그 칸을 버린다(좁은 쪽 — 자유 인자로 새지 않는다).
    assert!(role_model_args(WorkerCli::Claude, Some("a b"), Some("ultra"), none).is_empty());
    assert!(role_model_args(WorkerCli::Codex, Some("x;rm"), Some("max"), none).is_empty(), "Codex 에는 max 가 없다");
    assert_eq!(role_model_args(WorkerCli::Claude, None, Some("max"), none), vec!["--effort", "max"]);
    // 릴리스 빌드에는 덮기가 없다 — 이 시험 프로세스의 덮기(개발 빌드)는 환경을 따르므로 모양만 본다.
    let (m, e) = dev_model_override();
    let toks = role_model_args(WorkerCli::Claude, None, None, (m.as_deref(), e.as_deref()));
    assert!(toks.is_empty() || (toks.len() == 2 && toks[0] == "--model"));
}

/// 모델 덮기는 개발 빌드에만 있다 — 릴리스 스텁은 환경을 읽지 않고 늘 빈 것(소스 훑기).
#[test]
fn dev_model_override_is_debug_only() {
    let src = include_str!("spawn.rs");
    let at = src.find("AYNX_DEV_AGENT_MODEL\")").expect("모델 덮기 길");
    let before = &src[..at];
    let attr = before.rfind("#[cfg(debug_assertions)]").expect("개발 빌드 전용 표식");
    assert!(!before[attr..].contains("#[cfg(not(debug_assertions))]"));
    let stub = &src[src.find("#[cfg(not(debug_assertions))]").unwrap()..];
    let stub = &stub[..stub.find("\n}").unwrap()];
    assert!(stub.contains("fn dev_model_override()") && stub.contains("(None, None)"), "{stub}");
    assert!(!stub.contains("env::var"));
    assert_eq!(src.matches("AYNX_DEV_AGENT_MODEL\")").count(), 1);
    assert_eq!(src.matches("AYNX_DEV_CODEX_EFFORT\")").count(), 1);
}
