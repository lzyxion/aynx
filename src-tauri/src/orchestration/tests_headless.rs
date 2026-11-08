//! 3차 3a 시험(헤드리스 설계 7-2 · 9절 3a 행) — **헤드리스 작업자 · 맡긴 저장소의 역할 · 수락 규칙 · 이어지는 턴**.
//!
//! **가짜 작업자 JSONL 판**: 서버 손 대신 [`Turns`] 를 꽂는다. 턴 하나를 띄우면(`launch`) 운영 손(`server::workers::start_turn`)과 같은
//! 순서로 알리고(첫 턴 worktree — 진짜 git · 섰다 · `running` 턴 기록), 시험이 [`H::finish`] 로 턴을 끝낸다: 가짜 CLI 가 낼 stdout JSONL
//! (Claude `stream-json` · Codex `exec --json` 모양)을 **진짜 추출기**(`LineSplitter` · `TurnLog` · `turn_outcome` — 운영과 같은 init 확인)에
//! 먹이고, 그 턴의 작업자 토큰으로 MCP 도구(`commit_changes` · `report_done` · `report_review` — 운영과 같은 `call_tool` 디스패치)를 부른 뒤
//! 운영 손과 같은 순서로 턴 끝을 알린다(턴 기록 → 대화 고정 → 프로세스 끝). 모델 · 진짜 CLI · 개발 앱은 쓰지 않는다 — 진짜 CLI 의 인자 ·
//! 출력 모양은 실기(`scripts/dev/fake-agent-headless.mjs` · 실 CLI)에서 본다.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};

use serde_json::{json, Value};

use super::model::*;
use super::spawn::{self, LaunchJob, WorkerLauncher, WORKER_ALLOWED_TOOLS};
use super::store::*;
use super::test_album::{self as td, JUDGE, WRITER, WRITER_CODEX};
use super::turn::{self, Exit, Grade, Line, LineSplitter, TurnArgs, TurnLog, LINE_MAX};
use crate::audit::AuditRecord;

const MCP: &str = "aynx-sessions-dev";

// ---------------------------------------------------------------------------
// 진짜 git 저장소
// ---------------------------------------------------------------------------

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-h3a-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn git(dir: &Path, args: &[&str]) -> String {
    let mut cmd = Command::new("git");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("GIT_") {
            cmd.env_remove(k);
        }
    }
    let out = cmd.arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// 저장소 — `a.txt` 하나를 담은 첫 커밋(신원 · 줄 끝은 저장소 로컬 설정).
fn repo(root: &Path) -> PathBuf {
    let d = root.join("repo");
    std::fs::create_dir_all(&d).unwrap();
    git(&d, &["init", "-q", "-b", "main"]);
    git(&d, &["config", "user.name", "Headless Three"]);
    git(&d, &["config", "user.email", "h3a@example.invalid"]);
    git(&d, &["config", "core.autocrlf", "false"]);
    std::fs::write(d.join("a.txt"), "a\n").unwrap();
    git(&d, &["add", "."]);
    git(&d, &["commit", "-qm", "base"]);
    d
}

/// 시험 폴더를 지운다 — 링크를 먼저 걷고 그 폴더 하나만.
fn cleanup(dir: &Path) {
    let _ = super::worktree::unlink_links(dir, &[]);
    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// 가짜 작업자 — 턴을 띄우는 손
// ---------------------------------------------------------------------------

/// 도는 턴 하나.
struct Live {
    job: LaunchJob,
    /// 쓰기형의 worktree(판정형은 `None`).
    path: Option<PathBuf>,
}

#[derive(Default)]
struct Turns {
    o: Mutex<Weak<Orchestration>>,
    /// 띄운 모든 턴(시험이 인자 재료를 본다).
    jobs: Mutex<Vec<LaunchJob>>,
    live: Mutex<Vec<Live>>,
    stops: Mutex<Vec<String>>,
    /// 다음 생성을 실패시킨다(`attempt_spawn_failed` — 아무것도 서지 않음).
    fail_next: AtomicBool,
    /// 다음 생성을 붙잡는다(서버 손이 아직 생성 중 — 아무것도 알리지 않음).
    hold_next: AtomicBool,
    pid: AtomicU64,
}

impl WorkerLauncher for Turns {
    fn launch(&self, job: LaunchJob) {
        let o = self.o.lock().unwrap().upgrade().expect("orchestration");
        self.jobs.lock().unwrap().push(job.clone());
        if self.fail_next.swap(false, Ordering::SeqCst) {
            o.attempt_spawn_failed(&job.run_id, &job.attempt_id, "spawn: fake failure");
            return;
        }
        if self.hold_next.swap(false, Ordering::SeqCst) {
            return;
        }
        let n = job.turn.n;
        let path = if job.review.is_some() {
            let place = format!("{}/{}-rv", job.worktree_dir, job.attempt_id);
            assert!(o.attempt_review_place(&job.run_id, &job.attempt_id, &place, &format!("{place}-cwd")));
            None
        } else if let Some(r) = job.reuse.as_ref().filter(|_| n > 1) {
            // 이어지는 턴 — 자기 worktree 를 그대로(worktree 를 다시 알리지 않는다).
            Some(PathBuf::from(&r.path))
        } else if let Some(r) = &job.reuse {
            assert!(o.attempt_worktree(&job.run_id, &job.attempt_id, &r.path, &r.branch, &r.base_commit));
            Some(PathBuf::from(&r.path))
        } else {
            let name = spawn::worktree_name(&job.task.id, &job.attempt_id);
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
            if !o.attempt_worktree(&job.run_id, &job.attempt_id, &c.path, &c.branch, &c.base_commit) {
                o.attempt_spawn_failed(&job.run_id, &job.attempt_id, "stopped before the worker started");
                return;
            }
            Some(PathBuf::from(c.path))
        };
        let pid = 40_000 + self.pid.fetch_add(1, Ordering::SeqCst) as u32;
        if o.attempt_spawned(&job.run_id, &job.attempt_id, Some(pid)) == super::SpawnVerdict::Reap {
            o.attempt_process_exited(&job.run_id, &job.attempt_id, true, None);
            return;
        }
        o.attempt_turn(&job.run_id, &job.attempt_id, record(n, "running", None, &TurnLog::default(), &job), false);
        self.live.lock().unwrap().push(Live { job, path });
    }
    fn stop(&self, _run_id: &str, attempt_id: &str) {
        self.stops.lock().unwrap().push(attempt_id.to_string());
    }
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

/// 그 턴의 인자 재료(운영 손과 같은 꼴 — 인자 표 · init 확인 조건을 여기서 짓는다).
fn args_of<'a>(job: &'a LaunchJob, allowed: &'a [String], prompt: &'a str) -> TurnArgs<'a> {
    let judge = job.turn.role.grade == Grade::ReadOnly;
    TurnArgs {
        cli: job.cli,
        exe: "C:/bin/fake-cli.exe",
        grade: job.turn.role.grade,
        resume: job.turn.resume.as_deref(),
        session_id: job.session_id.as_deref(),
        mcp_name: MCP,
        mcp_tools: if judge { spawn::REVIEWER_ALLOWED_TOOLS } else { WORKER_ALLOWED_TOOLS },
        mcp_config: (job.cli == WorkerCli::Claude).then_some("C:/data/agent-mcp/orch-fake.json"),
        mcp_url: "http://127.0.0.1:5/mcp",
        token_env: "AYNX_DEV_MCP_TOKEN",
        allowed_commands: allowed,
        read_rule: None,
        add_dir: None,
        cwd: Some("C:/wt/fake"),
        codex_extra: &[],
        model_args: &[],
        append_file: None,
        developer_instructions: None,
        prompt,
    }
}

/// 턴 기록(운영 손의 `running_record` · `ended_record` 와 같은 칸).
fn record(n: u32, outcome: &str, reason: Option<String>, log: &TurnLog, job: &LaunchJob) -> TurnRecord {
    let allowed = job.turn.role.allowed_commands.clone();
    let label = turn::args_label(&args_of(job, &allowed, "[x]"), None);
    TurnRecord {
        n,
        started_at: 0,
        ended_at: None,
        outcome: outcome.into(),
        reason,
        exit_code: (outcome != "running").then_some(0),
        denials: log.denials,
        denial_kinds: log.denial_kinds.iter().map(|s| s.to_string()).collect(),
        tools: log.tools,
        last_tool: log.last_tool.clone(),
        cli_version: log.cli_version.clone(),
        model: log.model.clone(),
        args: label,
        anomalies: log.anomalies,
    }
}

/// 가짜 CLI 가 이 턴에 할 일.
#[derive(Clone)]
enum Act {
    /// 파일 하나를 쓰고 `commit_changes` → `report_done{success}`.
    Report(&'static str),
    /// `report_done{blocked}` — 필요한 것.
    Blocked(&'static str),
    /// 아무 보고 없이 끝난다(→ `idle`).
    Nothing,
    /// init 의 대화 id 가 고정값과 다르다(바꿔치기 — D6).
    Mismatch,
    /// 판정형 — `report_review{verdict}`.
    Verdict(&'static str),
    /// stdout 에 본문 글을 내고 끝난다(영속 시험).
    Say(&'static str),
}

/// 끝난 턴의 사실.
struct Ended {
    outcome: turn::Outcome,
    log: TurnLog,
}

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

struct H {
    o: Arc<Orchestration>,
    turns: Arc<Turns>,
    root: PathBuf,
    repo: PathBuf,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
    /// 조정자 = 프로듀서 채팅(시험 칸 — 채팅 토큰 표의 그 세대 · `/mcp` 와 같은 호출자 → 서버 표의 묶음).
    prod: crate::chat_token::FakeProducer,
}

impl Drop for H {
    fn drop(&mut self) {
        cleanup(&self.root);
    }
}

/// 맡긴 저장소 하나 + Run 하나(통합 ref) — 수락 규칙 `require`(판정형 역할 · pass 수).
fn harness(tag: &str, require: Vec<(&str, u32)>) -> (H, String, Caller) {
    harness_in(tag, require, None)
}

fn harness_in(tag: &str, require: Vec<(&str, u32)>, data: Option<PathBuf>) -> (H, String, Caller) {
    let root = scratch(tag);
    let repo = repo(&root);
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(AtomicU64::new(1_900_000_000_000));
    let c = Arc::clone(&clock);
    let ephemeral = data.is_none();
    let o = Arc::new(Orchestration::with_clock(data, emit, Some(tx), Arc::new(move || c.fetch_add(1, Ordering::SeqCst))));
    if ephemeral {
        o.set_ephemeral(true);
    }
    o.set_integrator(Arc::new(super::integrate::GitRefs));
    let turns = Arc::new(Turns::default());
    *turns.o.lock().unwrap() = Arc::downgrade(&o);
    o.set_launcher(turns.clone());
    let _fixture = td::delegate_with(&o, td::active(td::block("C:/repo", td::default_roles(), require, None)));
    let run = o
        .start_integrated_run(StartRun {
            verify: None,
            name: "h3a".into(),
            repo: repo.display().to_string(),
            worktree_dir: root.join("wt").display().to_string(),
            limits: Limits::default(),
        })
        .unwrap()
        .0;
    // 조정자 = 프로듀서 채팅 토큰 + 서버 표의 묶음(제품은 사람이 연 앨범의 시작/이어받기에서 묶는다).
    let prod = crate::chat_token::FakeProducer::open(tag, "C:/repo");
    o.bind_seat_for_test(&run, 1, &prod.seat()).unwrap();
    let coord = prod.caller();
    assert!(matches!(&coord, Caller::Producer { .. }), "조정자는 프로듀서 호출자로 온다");
    (
        H {
            o,
            turns,
            root,
            repo,
            audit: Mutex::new(rx),
            prod,
        },
        run,
        coord,
    )
}

/// 도구 하나 — 프로듀서(조정자)면 **조정자가 `get_run` 에서 읽은 `runId` · `gen` 을 싣는다**(3차 4단계 — 조율 도구의 필수 인자. 운영 CLI 와 같은
/// 순서: 시험은 서버 표의 묶음에서 그 둘을 읽는다). 이미 실었으면(어긋남 시험) 그대로.
fn call(o: &Orchestration, c: &Caller, name: &str, args: Value) -> Result<Value, String> {
    let mut args = args;
    if let Caller::Producer { chat, proc } = c {
        if let (Some((run, gen)), Some(obj)) = (o.bound_seat(&Seat { chat: chat.clone(), proc: *proc }), args.as_object_mut()) {
            obj.entry("runId").or_insert(json!(run));
            obj.entry("gen").or_insert(json!(gen));
        }
    }
    o.call_tool(c, name, Some(&args))
}

fn code(r: Result<Value, String>) -> String {
    r.expect_err("거절이어야 한다").split(':').next().unwrap().to_string()
}

/// 거절 메시지의 JSON 몸(`busy` · `accept-rule-unmet` · `rework-limit`).
fn body(r: Result<Value, String>) -> (String, Value) {
    let e = r.expect_err("거절이어야 한다");
    let (c, rest) = e.split_once(':').unwrap();
    (c.to_string(), serde_json::from_str(rest.trim()).unwrap_or_else(|_| panic!("JSON 몸: {rest}")))
}

impl H {
    fn task(&self, c: &Caller, req: &str) -> String {
        call(&self.o, c, "create_task", json!({ "requestId": req, "title": req, "goal": "do it" })).unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn spawn(&self, c: &Caller, req: &str, task: &str, role: &str) -> Result<Value, String> {
        call(&self.o, c, "spawn_worker", json!({ "requestId": req, "taskId": task, "role": role }))
    }

    fn spawn_ok(&self, c: &Caller, req: &str, task: &str, role: &str) -> String {
        self.spawn(c, req, task, role).unwrap()["attemptId"].as_str().unwrap().to_string()
    }

    fn send(&self, c: &Caller, req: &str, att: &str, text: &str) -> Result<Value, String> {
        call(&self.o, c, "send_prompt", json!({ "requestId": req, "attemptId": att, "text": text }))
    }

    fn attempt(&self, run: &str, att: &str) -> Value {
        let d = self.o.run_detail(run).unwrap();
        d["attempts"].as_array().unwrap().iter().find(|a| a["id"] == att).unwrap().clone()
    }

    fn state(&self, run: &str, att: &str) -> String {
        self.attempt(run, att)["state"].as_str().unwrap().to_string()
    }

    fn task_view(&self, run: &str, task: &str) -> Value {
        let d = self.o.run_detail(run).unwrap();
        d["tasks"].as_array().unwrap().iter().find(|t| t["id"] == task).unwrap().clone()
    }

    fn update(&self, c: &Caller, run: &str, req: &str, task: &str, state: &str) -> Result<Value, String> {
        let v = self.task_view(run, task)["version"].as_u64().unwrap();
        call(&self.o, c, "update_task", json!({ "requestId": req, "taskId": task, "version": v, "state": state }))
    }

    fn last_job(&self, att: &str) -> LaunchJob {
        self.turns.jobs.lock().unwrap().iter().rev().find(|j| j.attempt_id == att).unwrap().clone()
    }

    fn live(&self, att: &str) -> bool {
        self.turns.live.lock().unwrap().iter().any(|l| l.job.attempt_id == att)
    }

    fn resolves(&self, token: &str) -> bool {
        self.o.resolve(Some(&format!("Bearer {token}"))).is_some()
    }

    fn audits(&self) -> Vec<AuditRecord> {
        let rx = self.audit.lock().unwrap();
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    }

    /// 도는 턴 하나를 끝낸다 — 가짜 CLI 의 stdout JSONL 을 진짜 추출기에 먹이고, 그 턴의 토큰으로 도구를 부르고, 운영 손의 순서로 알린다.
    fn finish(&self, att: &str, act: Act) -> Ended {
        let Live { job, path } = {
            let mut live = self.turns.live.lock().unwrap();
            let i = live.iter().position(|l| l.job.attempt_id == att).expect("도는 턴");
            live.remove(i)
        };
        let n = job.turn.n;
        let allowed = job.turn.role.allowed_commands.clone();
        let expect = turn::expect_for(&args_of(&job, &allowed, "[x]"));
        // 가짜 CLI 의 대화 id — Claude 는 받은 `--session-id` · `--resume`, Codex 첫 턴은 새 thread(이것이 고정된다), resume 은 받은 id.
        let conv = match (&act, job.cli) {
            (Act::Mismatch, _) => "99999999-8888-4777-8666-555555555555".to_string(),
            (_, WorkerCli::Claude) => job.turn.resume.clone().or(job.session_id.clone()).expect("Claude 는 대화 id 를 받는다"),
            (_, WorkerCli::Codex) => job.turn.resume.clone().unwrap_or_else(|| format!("019a0000-0000-7000-8000-{}", &att[att.len() - 12..])),
        };
        let mut lines: Vec<Value> = Vec::new();
        match job.cli {
            WorkerCli::Claude => lines.push(json!({
                "type": "system", "subtype": "init", "session_id": conv, "model": "claude-fake-1",
                "permissionMode": expect.permission_mode.unwrap_or("default"), "claude_code_version": "9.9.9",
                "mcp_servers": [{ "name": MCP, "status": "connected" }],
                "tools": expect.builtin_tools.clone().unwrap_or_default(),
            })),
            WorkerCli::Codex => lines.push(json!({ "type": "thread.started", "thread_id": conv })),
        }
        // 이 턴의 작업자 토큰 — MCP 도구는 운영과 같은 디스패치(`call_tool`)로.
        let me = self.o.resolve(Some(&format!("Bearer {}", job.token)));
        let tool = |name: &str, lines: &mut Vec<Value>| match job.cli {
            WorkerCli::Claude => lines.push(json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": format!("mcp__{MCP}__{name}") }] } })),
            WorkerCli::Codex => lines.push(json!({ "type": "item.completed", "item": { "type": "mcp_tool_call", "tool": name } })),
        };
        let aborted = matches!(act, Act::Mismatch);
        if !aborted {
            let w = me.clone().expect("그 턴의 토큰은 산다");
            match &act {
                Act::Report(file) => {
                    std::fs::write(path.as_ref().unwrap().join(file), format!("{file} by {att} turn {n}\n")).unwrap();
                    tool("commit_changes", &mut lines);
                    call(&self.o, &w, "commit_changes", json!({ "requestId": format!("c-{n}"), "message": format!("add {file}"), "selection": "all" }))
                        .unwrap();
                    tool("report_done", &mut lines);
                    call(&self.o, &w, "report_done", json!({ "requestId": format!("r-{n}"), "outcome": "success", "summary": "done" })).unwrap();
                }
                Act::Blocked(need) => {
                    tool("report_done", &mut lines);
                    let v = call(&self.o, &w, "report_done", json!({ "requestId": format!("b-{n}"), "outcome": "blocked", "summary": "blocked", "notes": need }))
                        .unwrap();
                    assert_eq!(v["blocked"], true);
                }
                Act::Verdict(v) => {
                    tool("report_review", &mut lines);
                    call(&self.o, &w, "report_review", json!({ "requestId": format!("v-{n}"), "verdict": v, "summary": "looked" })).unwrap();
                }
                Act::Say(text) => lines.push(match job.cli {
                    WorkerCli::Claude => json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": text }] } }),
                    WorkerCli::Codex => json!({ "type": "item.completed", "item": { "type": "agent_message", "text": text } }),
                }),
                Act::Nothing | Act::Mismatch => {}
            }
            lines.push(match job.cli {
                WorkerCli::Claude => json!({ "type": "result", "subtype": "success", "is_error": false, "session_id": conv, "permission_denials": [] }),
                WorkerCli::Codex => json!({ "type": "turn.completed" }),
            });
        }
        // 진짜 추출기.
        let mut text = String::new();
        for l in &lines {
            text.push_str(&l.to_string());
            text.push('\n');
        }
        let mut split = LineSplitter::new(LINE_MAX);
        let mut parsed: Vec<Line> = Vec::new();
        split.push(text.as_bytes(), &mut parsed);
        let mut log = TurnLog::default();
        for l in &parsed {
            if log.feed(&expect, l).is_some() {
                break; // 운영 손은 곧바로 잡을 끝낸다.
            }
        }
        let outcome = turn::turn_outcome(
            &log,
            &Exit {
                code: Some(if aborted { 1 } else { 0 }),
                killed: None,
                confirmed: true,
            },
        );
        // 운영 손의 순서 — 턴 기록 → 대화 고정 → 프로세스 끝.
        let mut rec = record(n, outcome.outcome, outcome.reason.clone(), &log, &job);
        rec.exit_code = Some(if aborted { 1 } else { 0 });
        self.o.attempt_turn(&job.run_id, att, rec, true);
        if let Some(conv) = log.conversation.as_deref() {
            self.o.attempt_conversation(&job.run_id, att, conv);
        }
        self.o.attempt_process_exited(&job.run_id, att, true, Some(if aborted { 1 } else { 0 }));
        Ended { outcome, log }
    }
}

// ---------------------------------------------------------------------------
// 끝에서 끝까지(가짜 작업자 JSONL 판)
// ---------------------------------------------------------------------------

/// spawn(역할) → 턴(JSONL) → `commit_changes` → `report_done` → 턴 끝(`reported`) → 판정형 → 수락 규칙 → 통합.
#[test]
fn e2e_fake_jsonl_spawn_commit_report_judge_rule_integrate() {
    let (h, run, c) = harness("e2e", vec![(JUDGE, 1)]);
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    let job = h.last_job(&att);
    assert_eq!((job.turn.n, job.turn.role.id.as_str(), job.turn.role.grade), (1, WRITER, Grade::Edit));
    assert_eq!(h.state(&run, &att), "running");
    let token1 = job.token.clone();
    let end = h.finish(&att, Act::Report("feature.txt"));
    assert_eq!(end.outcome.outcome, "ok", "{:?}", end.outcome);
    assert_eq!(end.log.tools, 2);
    assert_eq!(h.state(&run, &att), "reported", "보고한 턴이 끝나면 닫힌다");
    assert!(!h.resolves(&token1), "턴 끝(트리 확인) 뒤 그 턴의 토큰을 거둔다");
    let a = h.attempt(&run, &att);
    assert_eq!(a["turns"][0]["outcome"], "ok");
    assert_eq!(a["turns"][0]["model"], "claude-fake-1");
    assert_eq!((a["kind"].as_str(), a["roleId"].as_str(), a["roleName"].as_str()), (Some("write"), Some(WRITER), Some("구현")));
    // 규칙이 아직 — 조정자 수락은 accept-rule-unmet.
    assert_eq!(code(h.update(&c, &run, "a0", &t, "accepted")), "accept-rule-unmet");
    // 판정형(역할 표에서) — 한 턴 · 판정 · 턴 끝 reported.
    let rv = h.spawn_ok(&c, "j1", &t, JUDGE);
    assert_eq!(h.last_job(&rv).turn.role.grade, Grade::ReadOnly);
    let end = h.finish(&rv, Act::Verdict("pass"));
    assert_eq!(end.outcome.outcome, "ok", "{:?}", end.outcome);
    assert_eq!(h.state(&run, &rv), "reported");
    // get_run — 역할 · 규칙 · 역할 이력 · 수락 준비.
    let g = call(&h.o, &c, "get_run", json!({})).unwrap();
    // 조정자는 **프로듀서 채팅 토큰**의 호출자이고, get_run 이 runId · gen 을 돌려준다(조정자가 둘을 읽는 길).
    // 다른 Run · 다른 세대를 말하는 조율은 묶음과 달라 거절된다(늦은 요청이 다른 Run 에 적용되지 않게).
    assert_eq!((g["runId"].as_str(), g["gen"].as_u64()), (Some(run.as_str()), Some(1)));
    let stray = |rid: &str, gen: u64| {
        h.o.call_tool(&c, "create_task", Some(&json!({ "runId": rid, "gen": gen, "requestId": "stray", "title": "x", "goal": "g" })))
    };
    assert_eq!(code(stray(&run, 2)), "stale-generation");
    assert_eq!(code(stray("run-00000000000000000000000000000000", 1)), "stale-run");
    assert!(h.o.call_tool(&c, "create_task", Some(&json!({ "requestId": "nogen", "title": "x", "goal": "g" }))).unwrap_err().starts_with("invalid-argument"));
    let album = h.o.lock().runs[&run].run.album.clone().expect("사람이 연 앨범 Run");
    assert_eq!(g["album"], json!({ "rev": album.rev }));
    assert!(g.get("delegation").is_none(), "옛 저장소 맡기기 상태는 내보내지 않는다");
    assert!(g["roles"].as_array().unwrap().iter().any(|r| r["id"] == JUDGE && r["permission"] == "read-only"));
    assert_eq!(g["acceptRules"]["require"][0]["role"], JUDGE);
    let tv = g["tasks"].as_array().unwrap().iter().find(|x| x["id"] == t.as_str()).unwrap().clone();
    let hist = tv["roleHistory"].as_array().unwrap();
    assert_eq!(hist.len(), 2);
    assert_eq!((hist[0]["role"].as_str(), hist[0]["outcome"].as_str()), (Some(WRITER), Some("success")));
    assert_eq!((hist[1]["kind"].as_str(), hist[1]["outcome"].as_str()), (Some("judge"), Some("pass")));
    assert_eq!(tv["acceptReadiness"]["ok"], true, "{tv}");
    // 수락 → 통합(진짜 git).
    let before = h.o.lock().runs.get(&run).unwrap().run.integration.clone().unwrap().expected_head;
    let v = h.update(&c, &run, "a1", &t, "accepted").unwrap();
    assert_eq!(v["accepting"], true);
    assert_eq!(h.task_view(&run, &t)["state"], "accepted", "{}", h.task_view(&run, &t));
    let after = h.o.lock().runs.get(&run).unwrap().run.integration.clone().unwrap().expected_head;
    assert_ne!(before, after);
    assert!(git(&h.repo, &["show", &format!("{after}:feature.txt")]).contains("by"));
    let d = h.o.run_detail(&run).unwrap();
    let acc = d["accepted"].as_array().unwrap().last().unwrap().clone();
    assert!(acc["judgments"].as_array().is_some_and(|j| !j.is_empty()), "규칙을 채운 판정 id: {acc}");
    // 감사 — 턴 시작 · 끝(본문 없음).
    let evs: Vec<String> = h.audits().into_iter().map(|r| r.event).collect();
    for e in ["worker_spawned", "turn_started", "turn_ended"] {
        assert!(evs.iter().any(|x| x == e), "{e}: {evs:?}");
    }
    // 조정자 프로세스가 끝나면(토큰 칸 회수) 그 채팅 토큰은 더는 아무도 아니다(`/mcp` 401).
    assert!(matches!(crate::chat_token::authenticate(Some(&h.prod.header())), Some(crate::chat_token::Auth::Chat { .. })));
    h.prod.close();
    assert!(crate::chat_token::authenticate(Some(&h.prod.header())).is_none());
}

/// (3차 5단계 — 계약의 끝에서 끝까지) **`start_run`(프로듀서 채팅 토큰)으로 연 Run** 으로 가짜 작업자 JSONL 판 한 바퀴: start_run → create_task →
/// spawn(쓰기형) → 턴(JSONL) · commit · report → (도는 턴 동안 complete_run = not-completable) → 판정형 pass → 수락 규칙 충족 → 수락 → 통합(진짜
/// git) → complete_run(조정자 — Done · 내보낸 브랜치 = 통합 머리). 조정자는 처음부터 끝까지 **같은 채팅 세대의 토큰**이다(재시작 없음).
#[test]
fn busy_returns_attempt_ids() {
    let (h, _run, c) = harness("busyshape", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    let (cd, b) = body(h.send(&c, "p1", &att, "more"));
    assert_eq!(cd, "busy");
    assert_eq!(b["attemptIds"], json!([att]));
    assert!(b["hint"].as_str().unwrap().contains("until=ready"));
    // 거절은 기억하지 않는다 — 같은 requestId 로 나중에 다시.
    h.finish(&att, Act::Nothing);
    assert_eq!(h.send(&c, "p1", &att, "more").unwrap()["state"], "started");
}

/// 4-5 — 턴은 한 번에 하나(큐 없음): 첫 턴 · 이어지는 턴 모두 도는 동안은 `busy`.
#[test]
fn one_turn_at_a_time() {
    let (h, run, c) = harness("busy", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    assert_eq!(code(h.send(&c, "p0", &att, "more")), "busy", "첫 턴이 도는 동안");
    h.finish(&att, Act::Nothing);
    assert_eq!(h.state(&run, &att), "idle");
    assert_eq!(h.send(&c, "p2", &att, "more").unwrap()["state"], "started");
    assert!(h.live(&att));
    let (cd, _) = body(h.send(&c, "p3", &att, "again"));
    assert_eq!(cd, "busy", "이어지는 턴이 도는 동안도");
}

/// D6 · 4-4 — resume 턴의 init 대화 id 가 고정값과 다르면 그 턴은 실패(`conversation-mismatch`)이고 대화가 끊긴 것으로 적는다 — 더는 resume
/// 하지 않는다(`conversation-broken`).
#[test]
fn resume_conversation_must_match() {
    let (h, run, c) = harness("mismatch", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    let pinned = h.attempt(&run, &att)["conversationId"].as_str().unwrap().to_string();
    h.finish(&att, Act::Nothing);
    h.send(&c, "p1", &att, "continue").unwrap();
    let end = h.finish(&att, Act::Mismatch);
    assert_eq!((end.outcome.outcome, end.outcome.reason.as_deref()), ("failed", Some("conversation-mismatch")));
    let a = h.attempt(&run, &att);
    assert_eq!(a["conversationId"], pinned.as_str(), "고정은 그대로");
    assert_eq!(a["conversationBroken"], true);
    assert_eq!(a["state"], "idle", "열린 채 — 사람 · 조정자가 멈추고 새 Attempt 로");
    assert_eq!(code(h.send(&c, "p2", &att, "continue")), "conversation-broken");
    // Codex 도 같다 — 첫 턴의 thread 가 고정, 다음 턴의 다른 thread 는 끊김.
    let t2 = h.task(&c, "t2");
    let x = h.spawn_ok(&c, "s2", &t2, WRITER_CODEX);
    assert!(h.attempt(&run, &x)["conversationId"].is_null(), "Codex 는 첫 턴 stdout 이 고정한다");
    h.finish(&x, Act::Nothing);
    let thread = h.attempt(&run, &x)["conversationId"].as_str().unwrap().to_string();
    h.send(&c, "p3", &x, "continue").unwrap();
    assert_eq!(h.last_job(&x).turn.resume.as_deref(), Some(thread.as_str()));
    let end = h.finish(&x, Act::Mismatch);
    assert_eq!(end.outcome.reason.as_deref(), Some("conversation-mismatch"));
    assert_eq!(h.attempt(&run, &x)["conversationBroken"], true);
}

/// 4-5 — 턴이 서지 못하면 `rejected{spawn-failed}`(아무것도 전달되지 않았다 — 결과를 모르는 상태가 없다) · Attempt 는 `idle` 그대로 · 그 턴의
/// 토큰은 곧바로 거둔다 · 같은 requestId 로 다시 시도할 수 있다.
#[test]
fn turn_spawn_failure_is_rejected_not_unknown() {
    let (h, run, c) = harness("spawnfail", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Nothing);
    h.turns.fail_next.store(true, Ordering::SeqCst);
    let v = h.send(&c, "p1", &att, "continue").unwrap();
    assert_eq!((v["state"].as_str(), v["reason"].as_str()), (Some("rejected"), Some("spawn-failed")), "{v}");
    assert_eq!(h.state(&run, &att), "idle");
    assert!(!h.resolves(&h.last_job(&att).token), "서지 못한 턴의 토큰은 곧바로 거둔다");
    let a = h.attempt(&run, &att);
    assert_eq!(a["turns"].as_array().unwrap().last().unwrap()["reason"], "spawn-failed");
    let again = h.send(&c, "p1", &att, "continue").unwrap();
    assert_eq!(again["state"], "started", "같은 requestId 로 다시 — 거절은 기억하지 않는다");
}

/// 서버 손이 시한 안에 결과를 못 알리면 `started{launching}`(예약은 섰다) — 뒤늦게 서지 못하면 Attempt 는 `idle` 로 돌아온다.
#[test]
fn turn_start_wait_is_bounded() {
    let (h, run, c) = harness("launching", Vec::new());
    h.o.set_turn_start_wait_ms(30);
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Nothing);
    h.turns.hold_next.store(true, Ordering::SeqCst);
    let v = h.send(&c, "p1", &att, "continue").unwrap();
    assert_eq!((v["state"].as_str(), v["launching"].as_bool()), (Some("started"), Some(true)), "{v}");
    assert_eq!(h.state(&run, &att), "running", "예약은 섰다 — 다음 지시는 busy");
    assert_eq!(code(h.send(&c, "p2", &att, "more")), "busy");
    h.o.attempt_spawn_failed(&run, &att, "spawn: late failure");
    assert_eq!(h.state(&run, &att), "idle");
}

/// D9 — 작업자 토큰은 턴 단위: 턴이 끝나 확인되면 거두고 `idle` 에는 산 토큰이 없다. 다음 턴은 새 토큰(옛 토큰은 다시 풀리지 않는다).
#[test]
fn idle_has_no_live_token() {
    let (h, run, c) = harness("idletok", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    let t1 = h.last_job(&att).token;
    assert!(h.resolves(&t1));
    h.finish(&att, Act::Nothing);
    assert_eq!(h.state(&run, &att), "idle");
    assert!(!h.resolves(&t1));
    let live: Vec<String> = h.o.lock().tokens.iter().filter(|(_, b)| b.attempt_id.as_deref() == Some(att.as_str())).map(|(t, _)| t.clone()).collect();
    assert!(live.is_empty(), "idle Attempt 에 묶인 토큰이 없다");
    h.send(&c, "p1", &att, "go").unwrap();
    let t2 = h.last_job(&att).token;
    assert_ne!(t1, t2);
    assert!(h.resolves(&t2) && !h.resolves(&t1));
}

/// 4-5 — `idle` 은 동시 자리를 차지하지 않는다(턴이 도는 것만 센다) · 이어 가려면 자리가 있어야 한다.
#[test]
fn idle_attempt_holds_no_slot() {
    let (h, run, c) = harness("idle", Vec::new());
    {
        // 동시 한도는 Run 의 값 — 시험은 Run 장부를 좁힌다.
        h.o.lock().runs.get_mut(&run).unwrap().run.limits.max_concurrent_workers = 1;
    }
    let t1 = h.task(&c, "t1");
    let t2 = h.task(&c, "t2");
    let a1 = h.spawn_ok(&c, "s1", &t1, WRITER);
    assert_eq!(code(h.spawn(&c, "s2", &t2, WRITER)), "worker-limit", "도는 턴이 자리를 쥔다");
    h.finish(&a1, Act::Nothing);
    assert_eq!(h.state(&run, &a1), "idle");
    let a2 = h.spawn_ok(&c, "s2", &t2, WRITER);
    // a1 을 이으려면 자리가 있어야 한다(a2 가 쥐었다).
    assert_eq!(code(h.send(&c, "p1", &a1, "go")), "worker-limit");
    h.finish(&a2, Act::Nothing);
    assert_eq!(h.send(&c, "p1", &a1, "go").unwrap()["state"], "started");
}

/// 4-7 · E5 — 역할은 맡기기 표에서만: 옛 `cli` 인자는 bad-args, 표에 없는 id 는 unknown-role, 쓸 수 없는 역할은 role-invalid, 맡기기가
/// 없거나 앱 밖에서 바뀌었으면 새 Attempt 를 띄우지 않는다.
#[test]
fn blocked_is_non_terminal_and_keeps_worktree() {
    let (h, run, c) = harness("blockedwt", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Blocked("network access"));
    let a = h.attempt(&run, &att);
    assert_eq!((a["state"].as_str(), a["blocked"]["need"].as_str()), (Some("idle"), Some("network access")));
    let wt = a["worktree"].as_str().unwrap().to_string();
    assert!(Path::new(&wt).is_dir() && h.o.worktree_in_use(&run, &wt));
    assert_eq!(h.task_view(&run, &t)["state"], "active");
    assert_eq!(code(h.update(&c, &run, "a", &t, "accepted")), "not-reported");
    assert_eq!(code(h.spawn(&c, "s2", &t, WRITER)), "task-busy", "열린 Attempt 가 있는 Task");
    // 사람 쪽 요약(보드 · 가림막 목록)에 blocked 작업자 수.
    let snap = h.o.snapshot();
    let row = snap.as_array().unwrap().iter().find(|r| r["runId"] == run.as_str()).unwrap().clone();
    assert_eq!(row["blocked"], 1, "{row}");
    // 멈추면 닫히고(산 프로세스가 없어 곧바로) worktree 는 이어 쓸 수 있다.
    call(&h.o, &c, "stop_worker", json!({ "requestId": "x", "attemptId": att })).unwrap();
    assert_eq!(h.state(&run, &att), "stopped");
    assert!(!h.o.worktree_in_use(&run, &wt));
    assert!(Path::new(&wt).is_dir(), "worktree 는 지우지 않는다");
}

/// 2-6 · E17 — 모델 · 강도 · 권한 · 허용 명령 · 지침은 **턴마다 지금 맡기기**(좁힘도 다음 턴부터).
#[test]
fn reviewer_no_verdict_is_closed() {
    let (h, run, c) = harness("noverdict", vec![(JUDGE, 1)]);
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Report("x.txt"));
    let rv = h.spawn_ok(&c, "j1", &t, JUDGE);
    assert_eq!(h.task_view(&run, &t)["review"]["active"], rv.as_str());
    h.finish(&rv, Act::Nothing);
    assert_eq!(h.state(&run, &rv), "exited");
    assert!(h.task_view(&run, &t)["review"]["active"].is_null());
    assert_eq!(code(h.send(&c, "p", &rv, "again")), "not-a-worker");
    let kinds: Vec<String> = h.o.notices_view().as_array().unwrap().iter().map(|n| n["kind"].as_str().unwrap().to_string()).collect();
    assert!(kinds.iter().any(|k| k == "reviewer-exited"), "{kinds:?}");
    // 자리가 비었으니 새 판정형이 선다.
    h.spawn_ok(&c, "j2", &t, JUDGE);
}

/// 4-7 — 판정형은 권한 칸과 무관하게 읽기 전용(`Grade::ReadOnly` → 판정형 고정 인자).
#[test]
fn accept_rule_unmet_shape() {
    let (h, run, c) = harness("unmet", vec![(JUDGE, 2)]);
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Report("x.txt"));
    let rv = h.spawn_ok(&c, "j1", &t, JUDGE);
    h.finish(&rv, Act::Verdict("pass"));
    let (cd, b) = body(h.update(&c, &run, "a1", &t, "accepted"));
    assert_eq!(cd, "accept-rule-unmet");
    let u = &b["unmet"][0];
    assert_eq!(
        (u["rule"].as_str(), u["role"].as_str(), u["roleName"].as_str(), u["need"].as_u64(), u["have"].as_u64(), u["last"].as_str()),
        (Some("judgment"), Some(JUDGE), Some("검토"), Some(2), Some(1), Some("pass"))
    );
    assert_eq!(b["reviewsLeft"], 5);
    assert_eq!(b["hint"], format!("spawn_worker role={JUDGE}"));
    // get_run 의 수락 준비도 같은 판정.
    let g = call(&h.o, &c, "get_run", json!({})).unwrap();
    let tv = g["tasks"].as_array().unwrap().iter().find(|x| x["id"] == t.as_str()).unwrap().clone();
    assert_eq!(tv["acceptReadiness"]["ok"], false);
}

/// E18 — 수락 규칙은 **수락 순간의 지금 맡기기**로 판정한다(Run 시작 때의 규칙이 아니다).
#[test]
fn human_accept_waives_rules_recorded() {
    let (h, run, c) = harness("waive", vec![(JUDGE, 1)]);
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Report("x.txt"));
    let v = h.task_view(&run, &t)["version"].as_u64().unwrap();
    h.o.human_review(&run, &t, v, Decision::Accepted).unwrap();
    assert_eq!(h.task_view(&run, &t)["state"], "accepted");
    let d = h.o.run_detail(&run).unwrap();
    let acc = d["accepted"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(acc["waived"][0]["rule"], "judgment", "{acc}");
    assert_eq!(acc["waived"][0]["role"], JUDGE);
    assert_eq!((acc["waived"][0]["need"].as_u64(), acc["waived"][0]["have"].as_u64()), (Some(1), Some(0)));
    assert!(h.audits().iter().any(|r| r.event == "accept_waived"));
}

/// 옛 `review_waived*`(2차 `requireReview`) 산출물은 `{rule: "review"}` 면제 한 줄로 읽힌다.
#[test]
fn old_review_waiver_reads_as_rule() {
    let a: AcceptedArtifact = serde_json::from_value(json!({
        "taskId": "task-1", "attemptId": "att-1", "reportId": "rep-1", "commitOid": "a", "reviewer": "human", "acceptedAt": 1,
        "reviewWaivedBy": "human"
    }))
    .unwrap();
    let w = a.waivers();
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].rule, "review");
}

/// 4-5 표 — send_prompt 관문의 나머지: 보고한 Attempt(`reported`) · 멈춘 Attempt(`closed`) · 글 상한.
#[test]
fn send_prompt_gates_closed_and_text() {
    let (h, run, c) = harness("gates", Vec::new());
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    h.finish(&att, Act::Report("x.txt"));
    assert_eq!(code(h.send(&c, "p1", &att, "go")), "reported");
    h.update(&c, &run, "rj", &t, "rejected").unwrap();
    let a2 = h.spawn_ok(&c, "s2", &t, WRITER);
    h.finish(&a2, Act::Nothing);
    assert_eq!(code(h.send(&c, "p2", &a2, &"x".repeat(super::resume::RESUME_TEXT_MAX + 1))), "text-too-long");
    call(&h.o, &c, "stop_worker", json!({ "requestId": "st", "attemptId": a2 })).unwrap();
    assert_eq!(h.state(&run, &a2), "stopped", "idle 은 곧바로 닫힌다(산 프로세스가 없다)");
    assert_eq!(code(h.send(&c, "p3", &a2, "go")), "closed");
    assert!(h.turns.stops.lock().unwrap().is_empty(), "idle 닫기는 서버 손에 멈춤을 보내지 않는다");
}

/// 소스 훑기(보조) — 이어지는 지시는 resume 턴이다: `resume.rs` 에 PTY 쓰기 · 붙여넣기 · Enter 가 없고 서버 손(`launch`)만 부른다.
#[test]
fn send_prompt_is_resume_turn_not_pty() {
    let src = include_str!("resume.rs");
    let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    for bad in ["write_blocking", "PtyIo", "\\x1b[200~", "\\r", "pty::", "sessions::"] {
        assert!(!code.contains(bad), "resume.rs 에 {bad}");
    }
    assert!(code.contains("l.launch(job)"));
    assert!(!std::path::Path::new("src/orchestration/deliver.rs").exists(), "붙여넣기 길(deliver.rs)은 걷혔다");
    assert!(!std::path::Path::new("src/orchestration/autostop.rs").exists());
}

/// 2-4 · D5 — 무인 검증은 후보마다 지금 맡기기 · 명령 해시 · 확인 칸으로 다시 판정한다(거두면 **새** 무인 실행이 서지 않는다 — 사람 확인으로).
/// 이미 도는 검증은 끊지 않는다(판정은 후보 단계 `after_candidate` 에서만 부른다 — 실행 중 경로에는 없다).
#[test]
fn turn_mcp_file_owned_by_turn() {
    assert_eq!(spawn::turn_claim_key("att-0123456789abcdef0123456789abcdef", 3), "orch-0123456789abcdef0123456789abcdef-t3");
    let w = include_str!("../server/workers.rs");
    let w = w.split("mod tests {").next().unwrap();
    assert!(w.contains("write_worker_config(&job.attempt_id, job.turn.n, port, &job.token, &job.stream)"));
    let m = include_str!("../agent_mcp.rs");
    assert!(m.contains("format!(\"orch-{attempt_id}-t{turn}.json\")"));
    // 세션 서버가 뜰 때 주인 없는 턴 파일을 쓸어 낸다.
    assert!(include_str!("../server/serve.rs").contains("sweep_turn_leftovers"));
}

/// 가짜 작업자(`AYNX_DEV_FAKE_AGENT`)는 개발 빌드에만 — 릴리스 스텁은 환경을 읽지 않는다(소스 훑기).
#[test]
fn fake_agent_is_debug_only() {
    let w = include_str!("../server/workers.rs");
    let at = w.find("AYNX_DEV_FAKE_AGENT\")").expect("가짜 작업자 길");
    let before = &w[..at];
    let attr = before.rfind("#[cfg(debug_assertions)]").expect("개발 빌드 전용 표식");
    assert!(!before[attr..].contains("#[cfg(not(debug_assertions))]"));
    let stub = &w[w.find("#[cfg(not(debug_assertions))]\nfn dev_fake_agent()").or_else(|| w.find("#[cfg(not(debug_assertions))]\r\nfn dev_fake_agent()")).expect("릴리스 스텁")..];
    let stub = &stub[..stub.find('}').unwrap()];
    assert!(stub.contains("None") && !stub.contains("env::var"), "{stub}");
    assert_eq!(w.matches("AYNX_DEV_FAKE_AGENT\")").count(), 1);
    assert!(Path::new("../scripts/dev/fake-agent-headless.mjs").is_file(), "가짜 작업자 스크립트");
}

/// 3-2a · D11 — 역할 지침 본문은 영속 · 보기 · 조정자 응답 · 감사에 싣지 않는다(길이만).
#[test]
fn stdout_bodies_never_persisted() {
    let dir = scratch("stdout-data");
    let (h, run, c) = harness_in("stdout", Vec::new(), Some(dir.clone()));
    let t = h.task(&c, "t");
    let att = h.spawn_ok(&c, "s1", &t, WRITER);
    let end = h.finish(&att, Act::Say("SECRET-STDOUT-BODY-7"));
    assert_eq!(end.outcome.outcome, "ok");
    h.o.flush_saves();
    let file = std::fs::read_to_string(dir.join(format!("{run}.json"))).unwrap();
    let detail = h.o.run_detail(&run).unwrap().to_string();
    let audits: String = h.audits().iter().map(|r| serde_json::to_string(r).unwrap()).collect();
    for s in [&file, &detail, &audits] {
        assert!(!s.contains("SECRET-STDOUT"));
    }
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// E20 — Codex 쓰기형(`edit`)은 첫 턴 · resume 모두 네트워크를 켠다(샌드박스 안 — `full` 은 샌드박스 자체가 없다 · 판정형은 읽기 전용).
#[test]
fn codex_network_always_on() {
    for resume in [None, Some("019a0000-0000-7000-8000-000000000001")] {
        let x = turn::turn_argv(&TurnArgs {
            cli: WorkerCli::Codex,
            exe: "C:/bin/codex.exe",
            grade: Grade::Edit,
            resume,
            session_id: None,
            mcp_name: MCP,
            mcp_tools: WORKER_ALLOWED_TOOLS,
            mcp_config: None,
            mcp_url: "http://127.0.0.1:5/mcp",
            token_env: "T",
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
        assert!(x.iter().any(|w| w == "sandbox_workspace_write.network_access=true"), "{x:?}");
    }
}

/// 2-3a — Claude 쓰기형의 설정 출처 통제: `edit` = A(`--restricted --tools <쓰기 셋>` — 사용자 설정은 싣되 도구를 좁힌다) · `full` = B
/// (`--setting-sources ""`), resume 턴도 같은 꼴(이 턴의 등급 — 아래 `resume_args_carry_this_turn_grade`).
#[test]
fn worker_args_control_setting_sources() {
    let edit = turn::turn_argv(&args_of_grade(WorkerCli::Claude, Grade::Edit, None));
    assert!(edit.windows(3).any(|w| w == ["--restricted", "--tools", turn::CLAUDE_EDIT_TOOLS]), "{edit:?}");
    assert!(!edit.iter().any(|w| w == "--setting-sources"));
    let full = turn::turn_argv(&args_of_grade(WorkerCli::Claude, Grade::Full, None));
    assert!(full.windows(2).any(|w| w == ["--setting-sources", ""]), "{full:?}");
    assert!(!full.iter().any(|w| w == "--restricted"));
}

/// 2-6 · S6 — resume 턴의 인자는 **이 턴의 등급**을 싣는다(Codex `exec resume` 에는 `-s` 가 없어 `-c sandbox_mode` · Claude 는 권한 모드).
#[test]
fn resume_args_carry_this_turn_grade() {
    let r = Some("019a0000-0000-7000-8000-000000000001");
    let x = turn::turn_argv(&args_of_grade(WorkerCli::Codex, Grade::Edit, r));
    assert!(x.iter().any(|w| w == "sandbox_mode='workspace-write'") && !x.iter().any(|w| w == "-s"), "{x:?}");
    let x = turn::turn_argv(&args_of_grade(WorkerCli::Codex, Grade::Full, r));
    assert!(x.iter().any(|w| w == "--dangerously-bypass-approvals-and-sandbox"), "{x:?}");
    let c = turn::turn_argv(&args_of_grade(WorkerCli::Claude, Grade::Full, Some("11111111-2222-4333-8444-555555555555")));
    let pm = c.iter().position(|w| w == "--permission-mode").unwrap();
    assert_eq!(c[pm + 1], "bypassPermissions");
    assert!(c.windows(2).any(|w| w == ["--resume", "11111111-2222-4333-8444-555555555555"]));
}

/// 3-6 · D14 — 판정형 지시에는 `report_done` 이 없다(판정형의 도구는 `report_review`).
#[test]
fn reviewer_prompt_has_no_report_done() {
    let p = spawn::reviewer_prompt("att-1", "task-1", &"a".repeat(40), None, "C:/wt/x-rv");
    assert!(p.starts_with('[') && p.contains("report_review") && !p.contains("report_done"), "{p}");
}

fn args_of_grade(cli: WorkerCli, grade: Grade, resume: Option<&'static str>) -> TurnArgs<'static> {
    TurnArgs {
        cli,
        exe: "C:/bin/cli.exe",
        grade,
        resume,
        session_id: (resume.is_none() && cli == WorkerCli::Claude).then_some("11111111-2222-4333-8444-555555555555"),
        mcp_name: MCP,
        mcp_tools: WORKER_ALLOWED_TOOLS,
        mcp_config: (cli == WorkerCli::Claude).then_some("C:/x.json"),
        mcp_url: "http://127.0.0.1:5/mcp",
        token_env: "T",
        allowed_commands: &[],
        read_rule: None,
        add_dir: None,
        cwd: Some("C:/wt"),
        codex_extra: &[],
        model_args: &[],
        append_file: None,
        developer_instructions: None,
        prompt: "[x]",
    }
}

/// 4-3 · 7-2 — 작업자 인자는 늘 비대화형이다(Claude `-p` · `--permission-prompts none` / Codex `-a never exec --json` — 대화형 승인 ·
/// TUI 감싸개 없음). 첫 턴 · resume 턴 · 등급 모두.
#[test]
fn worker_args_never_interactive() {
    for g in [Grade::Edit, Grade::Full] {
        for resume in [None, Some("11111111-2222-4333-8444-555555555555")] {
            let a = turn::turn_argv(&TurnArgs {
                cli: WorkerCli::Claude,
                exe: "C:/bin/claude.exe",
                grade: g,
                resume,
                session_id: resume.is_none().then_some("11111111-2222-4333-8444-555555555555"),
                mcp_name: MCP,
                mcp_tools: WORKER_ALLOWED_TOOLS,
                mcp_config: Some("C:/x.json"),
                mcp_url: "http://127.0.0.1:5/mcp",
                token_env: "T",
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
            assert_eq!(a[1], "-p");
            let pp = a.iter().position(|x| x == "--permission-prompts").expect("--permission-prompts");
            assert_eq!(a[pp + 1], "none");
            let x = turn::turn_argv(&TurnArgs {
                cli: WorkerCli::Codex,
                exe: "C:/bin/codex.exe",
                grade: g,
                resume,
                session_id: None,
                mcp_name: MCP,
                mcp_tools: WORKER_ALLOWED_TOOLS,
                mcp_config: None,
                mcp_url: "http://127.0.0.1:5/mcp",
                token_env: "T",
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
            assert_eq!(&x[1..4], ["-a", "never", "exec"].map(String::from), "{x:?}");
            assert!(x.iter().any(|w| w == "--json"), "{x:?}");
            assert!(!x.iter().any(|w| w == "on-request" || w == "--no-daemon"));
            if g == Grade::Edit {
                assert!(x.iter().any(|w| w == "sandbox_workspace_write.network_access=true"), "{x:?}");
            }
        }
    }
}

/// 판 4 영속 — 헤드리스 Attempt(종류 · 역할 · blocked · 턴 · 끊김)와 Task 되돌림 수 · 산출물 면제가 파일을 왕복한다.
#[test]
fn v3_headless_run_roundtrip() {
    let dir = scratch("v3-data");
    let (run, before) = {
        let (h, run, c) = harness_in("v3", vec![(JUDGE, 1)], Some(dir.clone()));
        let t = h.task(&c, "t");
        let att = h.spawn_ok(&c, "s1", &t, WRITER);
        h.finish(&att, Act::Blocked("network"));
        h.send(&c, "p1", &att, "go").unwrap();
        h.finish(&att, Act::Report("x.txt"));
        h.update(&c, &run, "rj", &t, "rejected").unwrap();
        let t2 = h.task(&c, "t2");
        let a2 = h.spawn_ok(&c, "s2", &t2, WRITER);
        h.finish(&a2, Act::Report("y.txt"));
        let v = h.task_view(&run, &t2)["version"].as_u64().unwrap();
        h.o.human_review(&run, &t2, v, Decision::Accepted).unwrap();
        h.o.flush_saves();
        let r = h.o.lock().runs.get(&run).unwrap().run.clone();
        (run, r)
    };
    let bytes = std::fs::read(dir.join(format!("{run}.json"))).unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["version"], 4);
    let back = super::persist::decode(&bytes).unwrap();
    assert_eq!(back, before, "판 4 바이트 왕복");
    let a = &back.attempts[0];
    assert_eq!((a.kind, a.role_id.as_deref(), a.turns.len()), (Some(AttemptKind::Write), Some(WRITER), 2));
    assert_eq!(back.tasks[0].rework_count, 1);
    assert!(back.accepted.last().unwrap().waivers().iter().any(|w| w.rule == "judgment"));
    assert!(!String::from_utf8_lossy(&bytes).to_ascii_lowercase().contains("token"), "파일에 토큰 칸이 없다");
    let _ = std::fs::remove_dir_all(&dir);
}
