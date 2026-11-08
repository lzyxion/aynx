//! 오케스트레이션 6단계 시험 — **진행 기록**(설계 C-6 · C-2 `read_worker` · H 의 6단계 몫). 대화 파일은 임시 폴더의 **CLI 루트 모양**
//! (`<루트>/projects/<폴더>/<id>.jsonl` · `<루트>/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`)에 쓰고, 루트 손(`set_transcript_roots`)을
//! 거기로 돌린다 — 진짜 `~/.claude` · `~/.codex` 는 밟지 않는다. 표본 줄은 기록 보기 시험의 것(`agent_transcript::tests`)을 쓴다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::model::*;
use super::progress::{pin_file, RootsFn};
use super::report::{Probe, WorktreeState};
use super::store::*;
use super::test_album::{self as td};
use crate::agent_transcript::tests::{c_asst, c_result, c_tool, c_user, lines, x_item};
use crate::audit::AuditRecord;

#[derive(Default)]
struct NoLaunch;

impl super::spawn::WorkerLauncher for NoLaunch {
    fn launch(&self, _job: super::spawn::LaunchJob) {}
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-orchp-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

struct H {
    o: Arc<Orchestration>,
    clock: Arc<AtomicU64>,
    dir: PathBuf,
    events: Arc<Mutex<Vec<Value>>>,
    /// 이벤트 `orchestration-progress` 의 몸(F4).
    progress: Arc<Mutex<Vec<Value>>>,
    audit: Mutex<mpsc::Receiver<AuditRecord>>,
}

impl Drop for H {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn harness(tag: &str) -> H {
    let events: Arc<Mutex<Vec<Value>>> = Arc::default();
    let ev = Arc::clone(&events);
    let progress: Arc<Mutex<Vec<Value>>> = Arc::default();
    let pv = Arc::clone(&progress);
    let emit: EmitFn = Arc::new(move |name: &str, body: Value| {
        if name == EVT_CHANGED {
            ev.lock().unwrap().push(body);
        } else if name == EVT_PROGRESS {
            pv.lock().unwrap().push(body);
        }
    });
    let clock = Arc::new(AtomicU64::new(1_000_000_000));
    let c = Arc::clone(&clock);
    let (tx, rx) = mpsc::channel();
    let o = Arc::new(Orchestration::with_clock(None, emit, Some(tx), Arc::new(move || c.load(Ordering::SeqCst))));
    o.set_launcher(Arc::new(NoLaunch));
    td::delegate_all(&o);
    let dir = temp_dir(tag);
    let root = dir.join("cli");
    let r2 = root.clone();
    let roots: RootsFn = Arc::new(move |cli: WorkerCli| {
        vec![r2.join(match cli {
            WorkerCli::Claude => "projects",
            WorkerCli::Codex => "sessions",
        })]
    });
    std::fs::create_dir_all(root.join("projects")).unwrap();
    std::fs::create_dir_all(root.join("sessions")).unwrap();
    o.set_transcript_roots(roots);
    let probe: Probe = Arc::new(|_: &Path, base: Option<&str>| {
        Ok(WorktreeState {
            head: Some("b".repeat(40)),
            dirty: true,
            changed: if base.is_some() { vec!["src/a.rs".into(), "src/b.rs".into()] } else { Vec::new() },
            truncated: false,
            uncommitted: vec!["src/b.rs".into(), "notes.txt".into()],
            ..Default::default()
        })
    });
    o.set_probe(probe);
    H {
        o,
        clock,
        dir,
        events,
        progress,
        audit: Mutex::new(rx),
    }
}

fn claude_root(h: &H) -> PathBuf {
    h.dir.join("cli").join("projects")
}

fn start_run(h: &H, name: &str) -> (String, Caller) {
    let run = h
        .o
        .start_run(StartRun {
            verify: None,
            name: name.into(),
            repo: "C:/repo".into(),
            worktree_dir: "C:/repo-wt".into(),
            limits: Limits::default(),
        })
        .unwrap()
        .0;
    let c = h.o.coordinator_caller(&run).unwrap();
    (run, c)
}

/// 작업자 하나 — worktree(진짜 임시 폴더)까지 서고 첫 턴 프로세스가 선 것. (attempt, worktree)
fn worker(h: &H, run: &str, c: &Caller, cli: WorkerCli, tag: &str) -> (String, PathBuf) {
    let role = match cli {
        WorkerCli::Claude => td::WRITER,
        WorkerCli::Codex => td::WRITER_CODEX,
    };
    let task = h
        .o
        .call_tool(c, "create_task", Some(&json!({ "requestId": format!("t-{tag}"), "title": "T", "goal": "g" })))
        .unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let v = h
        .o
        .call_tool(c, "spawn_worker", Some(&json!({ "requestId": format!("s-{tag}"), "taskId": task, "role": role })))
        .unwrap();
    let att = v["attemptId"].as_str().unwrap().to_string();
    let wt = h.dir.join(format!("wt-{tag}"));
    std::fs::create_dir_all(&wt).unwrap();
    assert!(h.o.attempt_worktree(run, &att, &wt.to_string_lossy(), "orch/x", &"a".repeat(40)));
    assert_eq!(h.o.attempt_spawned(run, &att, Some(7)), super::SpawnVerdict::Keep);
    (att, wt)
}

fn attempt(h: &H, run: &str, att: &str) -> Value {
    h.o.run_detail(run).unwrap()["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == att)
        .cloned()
        .unwrap()
}

/// Claude 식 대화 파일 — `<루트>/projects/<폴더>/<id>.jsonl`, 첫 줄의 cwd 가 `cwd`.
fn write_claude(h: &H, id: &str, cwd: &Path, extra: &[Value]) -> PathBuf {
    let dir = claude_root(h).join("C--wt");
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join(format!("{id}.jsonl"));
    let mut vs = vec![c_user(json!("start the task"), json!({ "origin": { "kind": "human" }, "cwd": cwd.to_string_lossy() }))];
    vs.extend_from_slice(extra);
    std::fs::write(&p, lines(&vs)).unwrap();
    p
}

fn append(p: &Path, vs: &[Value]) {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(p).unwrap();
    f.write_all(lines(vs).as_bytes()).unwrap();
}

fn read(h: &H, c: &Caller, att: &str, cursor: Option<&str>) -> Value {
    let mut a = json!({ "attemptId": att });
    if let Some(cur) = cursor {
        a["cursor"] = json!(cur);
    }
    h.o.call_tool(c, "read_worker", Some(&a)).unwrap()
}

const OTHER: &str = "99999999-8888-4777-8666-555555555555";

// ---------------------------------------------------------------------------

/// 헤드리스 설계 7-2 `conversation_pinned_from_our_stdout` — 대화 고정은 **서버가 띄운 프로세스의 stdout** 에서만 온다(훅 신호 · 사람 타일 아님).
/// Claude 는 서버가 정한 `--session-id` 가 곧 고정값(띄울 때부터), Codex 는 첫 턴의 `thread.started` 가 알린 id(서버 손이
/// `attempt_conversation` 으로). 두 번째 다른 id 는 고정을 바꾸지 않고 대화가 끊긴 것으로 적는다(D6).
#[test]
fn conversation_pinned_from_our_stdout() {
    let h = harness("pin");
    let (run, c) = start_run(&h, "pin");
    let (ca, _) = worker(&h, &run, &c, WorkerCli::Claude, "c");
    let pinned = attempt(&h, &run, &ca)["conversationId"].as_str().unwrap().to_string();
    assert!(crate::agent_sessions::uuid_shape(&pinned));
    h.o.attempt_conversation(&run, &ca, &pinned);
    assert_eq!(attempt(&h, &run, &ca)["conversationId"], pinned.as_str());
    assert!(attempt(&h, &run, &ca).get("conversationBroken").is_none());
    // Codex — 첫 턴 stdout 의 id 가 고정값.
    let (xa, _) = worker(&h, &run, &c, WorkerCli::Codex, "x");
    assert!(attempt(&h, &run, &xa)["conversationId"].is_null());
    let first = "01a07989-25f8-7e72-99aa-0000000000aa";
    h.o.attempt_conversation(&run, &xa, first);
    assert_eq!(attempt(&h, &run, &xa)["conversationId"], first);
    h.o.attempt_conversation(&run, &xa, first);
    assert!(attempt(&h, &run, &xa).get("conversationBroken").is_none(), "같은 id 는 그대로");
    h.o.attempt_conversation(&run, &xa, OTHER);
    assert_eq!(attempt(&h, &run, &xa)["conversationId"], first, "두 번째 id 는 고정을 바꾸지 않는다");
    assert_eq!(attempt(&h, &run, &xa)["conversationBroken"], true, "대화가 끊겼다 — 더는 resume 하지 않는다");
    // 영속 칸에도 고정 id(본문 없음).
    let saved = serde_json::to_string(&h.o.run_detail(&run).unwrap()["attempts"]).unwrap();
    assert!(saved.contains(first));
    // 소스 훑기(보조) — 고정을 바꾸는 곳은 서버 손의 턴 stdout 하나(훅 신호 수신에는 작업자 길이 없다).
    let ai = include_str!("../server/ai.rs");
    let sig = include_str!("../server/signal_http.rs");
    for (f, s) in [("server/ai.rs", ai), ("server/signal_http.rs", sig)] {
        assert!(!s.contains("worker_signal") && !s.contains("attempt_conversation"), "{f}");
    }
}

/// F4 — Codex 첫 턴의 대화는 **턴 도중**(`thread.started` 가 init 확인을 지난 순간) 고정된다: 진짜 턴 실행기(가짜 CLI — `type` + 긴 ping ·
/// 모델 호출 없음)가 도는 동안 `read_worker` 가 `no-conversation` 이 아니다. 고정은 id 만이라 파일이 없으면 `pending`, 파일이 서도 기록된 cwd 가
/// worktree 가 아니면 받지 않는다(`cwd-mismatch` · 본문 없음). init 확인에 걸린 id(어긋난 resume id)는 도중에 고정하지 않는다.
#[cfg(windows)]
#[test]
fn codex_conversation_pinned_during_turn() {
    use super::turn::Pulse;
    use crate::server::workers::run_turn_blocking;
    use std::sync::atomic::AtomicBool;
    let h = harness("early");
    let (run, c) = start_run(&h, "early");
    let (xa, wt) = worker(&h, &run, &c, WorkerCli::Codex, "x");
    assert_eq!(read(&h, &c, &xa, None)["transcript"]["status"], "no-conversation");
    let xid = "01a143b6-0000-7000-8000-00000000abcd";
    let fx = h.dir.join("codex-start.jsonl");
    std::fs::write(&fx, format!("{{\"type\":\"thread.started\",\"thread_id\":\"{xid}\"}}\n")).unwrap();
    let day = h.dir.join("cli").join("sessions").join("2026").join("10").join("29");
    std::fs::create_dir_all(&day).unwrap();
    let rollout = day.join(format!("rollout-2026-10-29T00-00-00-{xid}.jsonl"));
    let other = h.dir.join("not-the-worktree");
    std::fs::create_dir_all(&other).unwrap();
    let meta = |cwd: &Path, text: &str| {
        lines(&[
            json!({"type": "session_meta", "payload": {"id": xid, "cwd": cwd.to_string_lossy(), "source": "exec"}}),
            x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]})),
        ])
    };
    let stop = AtomicBool::new(false);
    let mut during: Vec<String> = Vec::new();
    let spec = super::tests_turn::fake_turn(&fx, " & ping -n 30 127.0.0.1 >nul", super::tests_turn::codex_expect(), 60_000);
    let (r, _) = run_turn_blocking(spec, &stop, |_| {}, |p| match p {
        Pulse::Conversation(conv) => {
            h.o.attempt_conversation(&run, &xa, &conv);
            // 턴 도중 — 고정은 섰고 파일은 아직 없다.
            during.push(read(&h, &c, &xa, None)["transcript"]["status"].as_str().unwrap_or("").to_string());
            // 파일이 섰는데 cwd 가 다른 폴더 — 받지 않는다(본문도 나가지 않는다).
            std::fs::write(&rollout, meta(&other, "INJECTED")).unwrap();
            let v = read(&h, &c, &xa, None);
            assert!(!v.to_string().contains("INJECTED"));
            during.push(v["transcript"]["status"].as_str().unwrap_or("").to_string());
            // worktree 의 cwd — 읽힌다.
            std::fs::write(&rollout, meta(&wt, "early words")).unwrap();
            let v = read(&h, &c, &xa, None);
            assert!(v.to_string().contains("early words"), "{v}");
            during.push(v["transcript"]["status"].as_str().unwrap_or("").to_string());
            stop.store(true, Ordering::SeqCst);
        }
        Pulse::Progress(_) => {}
    })
    .unwrap();
    assert_eq!(r.outcome.outcome, "stopped", "턴 도중에 확인을 마쳤다(깃발로 끝냄)");
    assert_eq!(during, ["pending", "cwd-mismatch", "ok"]);
    assert_eq!(attempt(&h, &run, &xa)["conversationId"], xid);
    // 턴 끝의 같은 값 — 아무 일 없음(끊김 아님).
    h.o.attempt_conversation(&run, &xa, xid);
    assert!(attempt(&h, &run, &xa).get("conversationBroken").is_none());
    // init 확인에 걸린 id(어긋난 resume id) — 도중에 고정을 알리지 않는다.
    let mut wrong = super::tests_turn::codex_expect();
    wrong.conversation = Some(OTHER.into());
    let quiet = AtomicBool::new(false);
    let mut pulses = 0;
    let spec = super::tests_turn::fake_turn(&fx, " & ping -n 30 127.0.0.1 >nul", wrong, 60_000);
    let (r, _) = run_turn_blocking(spec, &quiet, |_| {}, |_| pulses += 1).unwrap();
    assert_eq!(r.outcome.reason.as_deref(), Some("conversation-mismatch"));
    assert_eq!(pulses, 0);
}

fn turn_rec(n: u32, outcome: &str, tools: u32, last: Option<&str>) -> TurnRecord {
    TurnRecord {
        n,
        started_at: 0,
        ended_at: None,
        outcome: outcome.into(),
        reason: None,
        exit_code: None,
        denials: 0,
        denial_kinds: Vec::new(),
        tools,
        last_tool: last.map(str::to_string),
        cli_version: None,
        model: None,
        args: TurnArgsLabel::default(),
        anomalies: Default::default(),
    }
}

/// F4 — 턴 도중 진행 칸(도구 수 · 마지막 도구 · 거절 · 모델)은 보기에 곧바로 서지만 **seq · 타임라인 · 영속(= `orchestration-changed` 를 내는
/// 길) · `wait_run` 깨우기는 없다**. 이벤트는 `orchestration-progress {runId, attemptId, turn}` 하나 · 같은 값이면 조용. 턴 끝 기록이 최종값이고,
/// 끝난 턴에 늦게 온 진행은 덮지 않는다.
#[test]
fn turn_progress_is_live_without_seq_or_wake() {
    use super::turn::TurnProgress;
    let h = harness("live");
    let (run, c) = start_run(&h, "live");
    let (att, _) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    h.o.attempt_turn(&run, &att, turn_rec(1, "running", 0, None), false);
    let seq = h.o.run_detail(&run).unwrap()["latestSeq"].as_u64().unwrap();
    let log_len = h.o.run_detail(&run).unwrap()["log"].as_array().unwrap().len();
    let changed = h.events.lock().unwrap().len();
    // 조정자가 seq 뒤를 기다린다 — 진행으로는 깨지 않는다(시한까지).
    let o = Arc::clone(&h.o);
    let c2 = c.clone();
    let waiter = std::thread::spawn(move || o.call_tool(&c2, "wait_run", Some(&json!({ "afterSeq": seq, "timeoutSeconds": 1 }))).unwrap());
    std::thread::sleep(std::time::Duration::from_millis(100));
    let p = TurnProgress {
        tools: 3,
        denials: 1,
        denial_kinds: vec!["policy"],
        last_tool: Some("Edit".into()),
        model: Some("claude-fake-1".into()),
        cli_version: Some("9.9.9".into()),
    };
    h.o.attempt_turn_progress(&run, &att, 1, &p);
    h.o.attempt_turn_progress(&run, &att, 1, &p); // 같은 값 — 조용
    let v = waiter.join().unwrap();
    assert_eq!((v["satisfied"].as_bool(), v["timedOut"].as_bool()), (Some(false), Some(true)), "{v}");
    let d = h.o.run_detail(&run).unwrap();
    assert_eq!(d["latestSeq"].as_u64(), Some(seq), "seq 그대로");
    assert_eq!(d["log"].as_array().unwrap().len(), log_len, "타임라인 줄 없음");
    assert_eq!(h.events.lock().unwrap().len(), changed, "orchestration-changed(= 쓰기 줄 · 깨우기의 길) 없음");
    let t = &attempt(&h, &run, &att)["turns"][0];
    assert_eq!(
        (t["outcome"].as_str(), t["tools"].as_u64(), t["lastTool"].as_str(), t["denials"].as_u64(), t["model"].as_str()),
        (Some("running"), Some(3), Some("Edit"), Some(1), Some("claude-fake-1"))
    );
    assert_eq!(t["denialKinds"], json!(["policy"]));
    let prog = h.progress.lock().unwrap().clone();
    assert_eq!(prog, vec![json!({ "runId": run, "attemptId": att, "turn": 1 })], "진행 이벤트 하나 · 몸은 id · 턴 번호뿐");
    // 턴 끝 — 최종값(턴 기록 끝)이 이긴다 · 늦은 진행은 끝난 턴을 덮지 않는다.
    h.o.attempt_turn(&run, &att, turn_rec(1, "ok", 5, Some("report_done")), true);
    h.o.attempt_turn_progress(&run, &att, 1, &TurnProgress { tools: 9, ..p });
    let t = &attempt(&h, &run, &att)["turns"][0];
    assert_eq!((t["outcome"].as_str(), t["tools"].as_u64(), t["lastTool"].as_str()), (Some("ok"), Some(5), Some("report_done")));
    assert_eq!(h.progress.lock().unwrap().len(), 1);
    // 없는 턴 번호 · 다른 Attempt — 아무 일 없음.
    h.o.attempt_turn_progress(&run, &att, 7, &TurnProgress::default());
    h.o.attempt_turn_progress(&run, "att-nope", 1, &TurnProgress::default());
    assert_eq!(h.progress.lock().unwrap().len(), 1);
}

/// 다른 대화가 같은 폴더 · 같은 cwd 에 있어도 판독은 고정 대화만이다.
#[test]
fn read_worker_reads_only_pinned_conversation() {
    let h = harness("change");
    let (run, c) = start_run(&h, "change");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let pinned = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    write_claude(&h, &pinned, &wt, &[c_asst(json!([{ "type": "text", "text": "pinned says hi" }]))]);
    // 바꿔치기 대상 — 같은 폴더 · 같은 cwd 의 다른 대화.
    write_claude(&h, OTHER, &wt, &[c_asst(json!([{ "type": "text", "text": "other conversation" }]))]);
    let v = read(&h, &c, &att, None);
    let texts: Vec<&str> = v["items"].as_array().unwrap().iter().filter_map(|i| i["text"].as_str()).collect();
    assert!(texts.contains(&"pinned says hi"), "{v}");
    assert!(!texts.contains(&"other conversation"));
    // 끊긴 대화(턴 init 의 다른 id) — 고정은 그대로, 판독도 고정 대화.
    h.o.attempt_conversation(&run, &att, OTHER);
    let v = read(&h, &c, &att, None);
    let texts: Vec<&str> = v["items"].as_array().unwrap().iter().filter_map(|i| i["text"].as_str()).collect();
    assert!(texts.contains(&"pinned says hi") && !texts.contains(&"other conversation"), "{v}");
}

#[test]
fn transcript_must_live_in_cli_dir_with_worktree_cwd() {
    let h = harness("dir");
    let roots = vec![claude_root(&h)];
    let wt = h.dir.join("wt");
    std::fs::create_dir_all(&wt).unwrap();
    let id = "12345678-1234-4123-8123-123456789abc";
    // 아직 파일이 없다 — pending.
    assert_eq!(pin_file(WorkerCli::Claude, id, &wt, &roots), Err("pending"));
    // CLI 폴더 밖(같은 id 의 파일) — 찾지 않는다.
    let outside = h.dir.join("elsewhere").join("C--wt");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(
        outside.join(format!("{id}.jsonl")),
        lines(&[c_user(json!("x"), json!({ "cwd": wt.to_string_lossy() }))]),
    )
    .unwrap();
    assert_eq!(pin_file(WorkerCli::Claude, id, &wt, &roots), Err("pending"));
    // CLI 폴더 안이지만 cwd 가 다른 폴더 — 받지 않는다.
    let other = h.dir.join("not-the-worktree");
    std::fs::create_dir_all(&other).unwrap();
    let p = write_claude(&h, id, &other, &[]);
    assert_eq!(pin_file(WorkerCli::Claude, id, &wt, &roots), Err("cwd-mismatch"));
    // cwd 가 worktree 면 받는다(구분자 · 대소문자 차이는 같은 폴더).
    std::fs::remove_file(&p).unwrap();
    let shown = wt.to_string_lossy().replace('\\', "/");
    let dir = claude_root(&h).join("C--wt");
    std::fs::write(dir.join(format!("{id}.jsonl")), lines(&[c_user(json!("x"), json!({ "cwd": shown }))])).unwrap();
    let got = pin_file(WorkerCli::Claude, id, &wt, &roots).unwrap();
    assert!(got.starts_with(claude_root(&h).canonicalize().unwrap()));
    // id 모양이 아니면 아무것도 찾지 않는다.
    assert_eq!(pin_file(WorkerCli::Claude, "../x", &wt, &roots), Err("no-conversation"));

    // Codex — 날짜 트리 · 첫 줄 session_meta 의 id · cwd.
    let xroots = vec![h.dir.join("cli").join("sessions")];
    let xid = "01a07989-25f8-7e72-99aa-0000000000bb";
    let day = xroots[0].join("2026").join("10").join("15");
    std::fs::create_dir_all(&day).unwrap();
    let meta = |cwd: &Path| json!({"type": "session_meta", "payload": {"id": xid, "cwd": cwd.to_string_lossy(), "source": "cli"}});
    let f = day.join(format!("rollout-2026-10-15T00-00-00-{xid}.jsonl"));
    std::fs::write(&f, lines(&[meta(&other)])).unwrap();
    assert_eq!(pin_file(WorkerCli::Codex, xid, &wt, &xroots), Err("cwd-mismatch"));
    std::fs::write(&f, lines(&[meta(&wt), x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "go"}]}))])).unwrap();
    assert!(pin_file(WorkerCli::Codex, xid, &wt, &xroots).is_ok());
}

#[test]
fn read_worker_limits_and_truncation() {
    let h = harness("limits");
    let (run, c) = start_run(&h, "limits");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let id = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    // 아직 파일이 없으면 빈 항목 + 까닭.
    let v = read(&h, &c, &att, None);
    assert_eq!(v["transcript"]["status"], "pending");
    assert_eq!(v["items"], json!([]));
    // changedFiles = base 이후 + 미커밋(겹치는 것은 한 번).
    assert_eq!(v["changedFiles"]["files"], json!(["src/a.rs", "src/b.rs", "notes.txt"]));
    assert_eq!(v["changedFiles"]["dirty"], true);
    let big = "y".repeat(10_000);
    let mut extra = vec![c_tool("t1", "Bash", json!({ "command": big.clone() })), c_result("t1", json!(big.clone()))];
    for i in 0..120 {
        extra.push(c_asst(json!([{ "type": "text", "text": format!("{i}: {}", "z".repeat(900)) }])));
    }
    let p = write_claude(&h, &id, &wt, &extra);
    let v = read(&h, &c, &att, None);
    assert_eq!(v["transcript"]["status"], "ok");
    let items = v["items"].as_array().unwrap();
    assert!(!items.is_empty() && items.len() <= 50, "항목 50 까지: {}", items.len());
    let tool = items.iter().find(|i| i["role"] == "tool").unwrap();
    assert!(tool["tool"]["input"].as_str().unwrap().len() <= 1024);
    assert_eq!(tool["tool"]["inputTruncated"], true);
    assert!(tool["tool"]["output"].as_str().unwrap().len() <= 1024);
    assert_eq!(tool["tool"]["outputTruncated"], true);
    assert!(serde_json::to_vec(&v).unwrap().len() <= 64 * 1024, "응답 64 KiB 안");
    assert_eq!(v["more"], true);
    // 커서로 끝까지 — 빠짐 · 겹침 없이 121 + 사람 말 하나.
    let mut total = items.len();
    let mut cur = v["cursor"].as_str().unwrap().to_string();
    for _ in 0..20 {
        let v = read(&h, &c, &att, Some(&cur));
        total += v["items"].as_array().unwrap().len();
        assert!(serde_json::to_vec(&v).unwrap().len() <= 64 * 1024);
        cur = v["cursor"].as_str().unwrap().to_string();
        if v["more"] == false {
            break;
        }
    }
    assert_eq!(total, 1 + 1 + 120);
    // 새 것이 없으면 빈 쪽 · 덧붙으면 그것만.
    assert_eq!(read(&h, &c, &att, Some(&cur))["items"], json!([]));
    append(&p, &[c_asst(json!([{ "type": "text", "text": "fresh line" }]))]);
    let v = read(&h, &c, &att, Some(&cur));
    assert_eq!(v["items"].as_array().unwrap().len(), 1);
    assert_eq!(v["items"][0]["text"], "fresh line");
    assert!(v.get("reset").is_none());
    // 틀린 커서는 거절.
    let e = h.o.call_tool(&c, "read_worker", Some(&json!({ "attemptId": att, "cursor": "nope" }))).unwrap_err();
    assert!(e.starts_with("invalid-argument"), "{e}");
}

#[test]
fn transcript_mcp_only_own_run_workers() {
    let h = harness("own");
    let (run1, c1) = start_run(&h, "one");
    let (run2, c2) = start_run(&h, "two");
    let (a1, wt1) = worker(&h, &run1, &c1, WorkerCli::Claude, "a");
    let id1 = attempt(&h, &run1, &a1)["conversationId"].as_str().unwrap().to_string();
    write_claude(&h, &id1, &wt1, &[c_asst(json!([{ "type": "text", "text": "secret of run one" }]))]);
    // 자기 Run 의 작업자 — 읽힌다.
    assert_eq!(read(&h, &c1, &a1, None)["transcript"]["status"], "ok");
    // 다른 Run 의 조정자 — not-found(있는지도 흘리지 않는다). runId 를 바꿔 넣어도.
    let e = h.o.call_tool(&c2, "read_worker", Some(&json!({ "attemptId": a1 }))).unwrap_err();
    assert!(e.starts_with("not-found"), "{e}");
    let e = h.o.call_tool(&c2, "read_worker", Some(&json!({ "attemptId": a1, "runId": run1 }))).unwrap_err();
    assert!(e.starts_with("not-found"), "{e}");
    // 사람이 연 타일 · 대화 id · 스트림으로는 부를 수 없다 — 인자는 자기 Run 의 attemptId 뿐.
    for bogus in [id1.as_str(), "orch-00", "att-00000000000000000000000000000000"] {
        let e = h.o.call_tool(&c1, "read_worker", Some(&json!({ "attemptId": bogus }))).unwrap_err();
        assert!(e.starts_with("not-found"), "{bogus}: {e}");
    }
    // 작업자 토큰 · 전역 토큰에는 이 도구가 없다.
    let wt = h.o.issue_worker_token(&run1, &a1).unwrap();
    let w = h.o.resolve(Some(&format!("Bearer {wt}"))).unwrap();
    assert!(!super::is_tool_for(&w, "read_worker"));
    assert!(!super::is_tool_for(&Caller::Global, "read_worker"));
    assert!(super::is_tool_for(&c1, "read_worker"));
    assert!(h.o.call_tool(&w, "read_worker", Some(&json!({ "attemptId": a1 }))).unwrap_err().starts_with("Unknown tool"));
    assert!(super::COORDINATOR_TOOLS.contains(&"read_worker"), "조정자 미리 허용 목록도 이 표에서 나온다");
    let _ = run2;
}

#[test]
fn wait_run_wakes_on_transcript_growth() {
    let h = harness("wake");
    let (run, c) = start_run(&h, "wake");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let id = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    let p = write_claude(&h, &id, &wt, &[]);
    // 처음 찾은 때도 새 기록이다.
    assert_eq!(h.o.transcript_tick(), 1);
    assert_eq!(h.o.transcript_tick(), 0, "자라지 않으면 조용하다");
    let seq = h.o.run_detail(&run).unwrap()["latestSeq"].as_u64().unwrap();
    let log_len = h.o.run_detail(&run).unwrap()["log"].as_array().unwrap().len();
    let o = Arc::clone(&h.o);
    let c2 = c.clone();
    let waiter = std::thread::spawn(move || {
        o.call_tool(&c2, "wait_run", Some(&json!({ "afterSeq": seq, "timeoutSeconds": 20 }))).unwrap()
    });
    std::thread::sleep(std::time::Duration::from_millis(150));
    append(&p, &[c_asst(json!([{ "type": "text", "text": "progress" }]))]);
    h.clock.fetch_add(2_000, Ordering::SeqCst);
    assert_eq!(h.o.transcript_tick(), 1);
    let v = waiter.join().unwrap();
    assert_eq!(v["satisfied"], true, "{v}");
    assert!(v["latestSeq"].as_u64().unwrap() > seq);
    assert!(v["waitedSeconds"].as_u64().unwrap() < 10);
    assert_eq!(h.o.run_detail(&run).unwrap()["log"].as_array().unwrap().len(), log_len, "타임라인 줄은 늘지 않는다");
    let last = h.events.lock().unwrap().last().cloned().unwrap();
    assert_eq!(last["runId"], run.as_str());
    assert_eq!(last.as_object().unwrap().len(), 2, "이벤트 몸은 {{runId, seq}} 뿐: {last}");
    // 보기 칸 — 상태 · 마지막 증가 · 기록 지연(일하는 중 60초 무증가).
    let t = &h.o.run_detail(&run).unwrap()["transcripts"][&att];
    assert_eq!((t["status"].as_str(), t["lagging"].as_bool()), (Some("ok"), Some(false)));
    h.clock.fetch_add(super::progress::LAG_MS + 1, Ordering::SeqCst);
    assert_eq!(h.o.run_detail(&run).unwrap()["transcripts"][&att]["lagging"], true);
    // 보드 최근 활동 — 같은 원천.
    append(&p, &[c_tool("t9", "Edit", json!({ "file_path": "src/z.rs" }))]);
    let act = h.o.worker_activity(&run, None).unwrap();
    let a = &act[&att];
    assert!(a.get("wip").is_none(), "작업 중 파일 목록은 상세가 연 칸에만");
    assert_eq!(a["recent"]["lastText"], "progress");
    assert_eq!(a["recent"]["tools"][0]["name"], "Edit");
    assert_eq!(a["recent"]["tools"][0]["pending"], true);
    assert_eq!(a["changedCount"], 3);
    // 작업자 상세(오케스트레이션 탭 ③) — 그 칸에만 `wip`(여기 worktree 는 git 저장소가 아니라 목록 대신 오류 한 줄).
    let act = h.o.worker_activity(&run, Some(&att)).unwrap();
    let w = &act[&att]["wip"];
    assert!(w["files"].as_array().is_some_and(|f| f.is_empty()) && w["error"].is_string(), "{w}");
    // 모르는 id 는 칸을 더하지 않는다.
    assert!(h.o.worker_activity(&run, Some("nope")).unwrap().get("nope").is_none());
    // [기록 보기] — 고정 파일 한 쪽.
    let page = h.o.worker_transcript_page(&run, &att, None, Some(10)).unwrap();
    assert!(page["items"].as_array().unwrap().len() >= 2);
}

/// 대화 본문은 로그 · 감사 · 영속에 싣지 않는다(동작 + 소스 훑기 보조).
#[test]
fn transcript_never_in_audit_or_logs() {
    let h = harness("noaudit");
    let (run, c) = start_run(&h, "noaudit");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let id = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    write_claude(&h, &id, &wt, &[c_asst(json!([{ "type": "text", "text": "SECRET-BODY-42" }]))]);
    let v = read(&h, &c, &att, None);
    assert!(v.to_string().contains("SECRET-BODY-42"));
    let _ = h.o.worker_activity(&run, None).unwrap();
    h.o.transcript_tick();
    let rx = h.audit.lock().unwrap();
    let audits: Vec<String> = rx.try_iter().map(|r| serde_json::to_string(&r).unwrap()).collect();
    assert!(audits.iter().all(|a| !a.contains("SECRET-BODY-42")));
    // 영속 · 보기 칸(사람 상세 포함)에도 본문 · 경로가 없다.
    let detail = h.o.run_detail(&run).unwrap().to_string();
    assert!(!detail.contains("SECRET-BODY-42"));
    assert!(!detail.contains("C--wt"), "고정 파일 경로는 메모리에만");
    // 소스 훑기 — 판독 모듈은 로그 · 감사 줄을 쓰지 않고 `Debug` 를 파생하지 않는다.
    for (name, src) in [
        ("orchestration/progress.rs", include_str!("progress.rs")),
        ("agent_transcript/forward.rs", include_str!("../agent_transcript/forward.rs")),
    ] {
        for bad in ["log::line", "eprintln!", "println!", "self.audit(", "derive(Debug", "derive(Clone, Debug", "dbg!"] {
            assert!(!src.contains(bad), "{name}: {bad}");
        }
    }
}

#[test]
fn dev_transcript_root_is_debug_only() {
    let src = include_str!("progress.rs");
    let at = src.find("AYNX_DEV_TRANSCRIPT_ROOT\")").expect("개발 빌드 전용 길");
    let before = &src[..at];
    let attr = before.rfind("#[cfg(debug_assertions)]").expect("개발 빌드 전용 표식");
    assert!(!before[attr..].contains("#[cfg(not(debug_assertions))]"));
    let stub = &src[src.find("#[cfg(not(debug_assertions))]").unwrap()..];
    let stub = &stub[..stub.find("\n}").unwrap()];
    assert!(stub.contains("fn dev_transcript_root() -> Option<PathBuf>") && stub.contains("None"), "{stub}");
    assert!(!stub.contains("env::var"), "릴리스 스텁은 환경을 읽지 않는다");
    assert_eq!(src.matches("AYNX_DEV_TRANSCRIPT_ROOT\")").count(), 1);
}

// ---------------------------------------------------------------------------
// 리뷰 수정(10-15) — F7 교체된 고정 파일 다시 검증 · F8 한 줄 안의 항목 · 큰 줄
// ---------------------------------------------------------------------------

/// 리뷰 F7 — 한 번 검증해 캐시된 고정 파일이 **교체되면**(파일 세대가 바뀌면) 경로 · cwd · id 를 다시 검증한다. cwd 가 다른 파일로
/// 바뀌면 내용을 내보내지 않고, 상위 폴더가 CLI 폴더 밖을 가리키는 정션으로 바뀌어도 받지 않는다. 다시 맞는 파일이면 `reset` 으로 처음부터.
#[test]
fn pinned_file_reverified_after_replacement() {
    let h = harness("reverify");
    let (run, c) = start_run(&h, "reverify");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let id = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    let p = write_claude(&h, &id, &wt, &[c_asst(json!([{ "type": "text", "text": "genuine work" }]))]);
    let v = read(&h, &c, &att, None);
    assert_eq!(v["transcript"]["status"], "ok");
    let cur = v["cursor"].as_str().unwrap().to_string();
    // 같은 경로에 다른 파일(cwd 가 다른 폴더) — 캐시를 믿지 않고 다시 검증한다.
    let other = h.dir.join("someone-else");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::remove_file(&p).unwrap();
    std::fs::write(
        &p,
        lines(&[
            c_user(json!("x"), json!({ "cwd": other.to_string_lossy() })),
            c_asst(json!([{ "type": "text", "text": "INJECTED" }])),
        ]),
    )
    .unwrap();
    for cursor in [None, Some(cur.as_str())] {
        let v = read(&h, &c, &att, cursor);
        assert_eq!(v["transcript"]["status"], "cwd-mismatch", "{v}");
        assert!(!v.to_string().contains("INJECTED"), "검증 못 한 파일의 내용은 나가지 않는다");
    }
    let page = h.o.worker_transcript_page(&run, &att, None, None);
    assert!(page.is_err(), "[기록 보기] 도 같은 검증");
    // 상위 폴더가 CLI 폴더 밖을 가리키는 정션으로 바뀐다 — 밖의 파일은 cwd 가 맞아도 받지 않는다.
    let parent = p.parent().unwrap().to_path_buf();
    std::fs::remove_file(&p).unwrap();
    std::fs::remove_dir(&parent).unwrap();
    let outside = h.dir.join("outside-root");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(
        outside.join(format!("{id}.jsonl")),
        lines(&[
            c_user(json!("x"), json!({ "cwd": wt.to_string_lossy() })),
            c_asst(json!([{ "type": "text", "text": "OUTSIDE" }])),
        ]),
    )
    .unwrap();
    junction(&parent, &outside);
    let v = read(&h, &c, &att, Some(&cur));
    assert_eq!(v["transcript"]["status"], "outside-cli-dir", "{v}");
    assert!(!v.to_string().contains("OUTSIDE"));
    // 다시 맞는 파일 — 처음부터(reset).
    unjunction(&parent);
    write_claude(&h, &id, &wt, &[c_asst(json!([{ "type": "text", "text": "fresh again" }]))]);
    let v = read(&h, &c, &att, Some(&cur));
    assert_eq!(v["transcript"]["status"], "ok");
    assert_eq!(v["reset"], true);
    assert!(v.to_string().contains("fresh again"));
}

fn junction(link: &Path, target: &Path) {
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

/// 정션을 링크만 걷는다(대상은 그대로).
fn unjunction(link: &Path) {
    #[cfg(windows)]
    std::fs::remove_dir(link).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(link).unwrap();
}

/// 리뷰 F8 — **한 JSONL 줄**에 항목이 51개여도 · 한 줄이 64 KiB 보다 커도 항목 50 · 응답 64 KiB 를 지키고 커서는 **반드시 앞으로** 간다
/// (줄 안 자리 — `t2` 커서). 끝까지 읽으면 빠짐 · 겹침이 없다.
#[test]
fn read_worker_splits_one_big_line() {
    let h = harness("bigline");
    let (run, c) = start_run(&h, "bigline");
    let (att, wt) = worker(&h, &run, &c, WorkerCli::Claude, "a");
    let id = attempt(&h, &run, &att)["conversationId"].as_str().unwrap().to_string();
    // 한 줄에 51 항목(말 51개).
    let parts: Vec<Value> = (0..51).map(|i| json!({ "type": "text", "text": format!("part {i}") })).collect();
    // 한 줄이 64 KiB 보다 크다(말 30개 × 4 KiB 가까이 — 칸마다 4 KiB 로 잘린다).
    let huge: Vec<Value> = (0..30).map(|i| json!({ "type": "text", "text": format!("{i}:{}", "w".repeat(4_000)) })).collect();
    write_claude(&h, &id, &wt, &[c_asst(Value::Array(parts)), c_asst(Value::Array(huge))]);
    let mut texts: Vec<String> = Vec::new();
    let mut cur: Option<String> = None;
    let mut pages = 0;
    loop {
        let v = read(&h, &c, &att, cur.as_deref());
        pages += 1;
        let items = v["items"].as_array().unwrap();
        assert!(items.len() <= 50, "항목 50 까지: {}", items.len());
        assert!(serde_json::to_vec(&v).unwrap().len() <= 64 * 1024, "응답 64 KiB 안");
        let next = v["cursor"].as_str().unwrap().to_string();
        if v["more"] == true {
            assert!(!items.is_empty(), "더 있으면 이번 쪽이 비지 않는다");
            assert_ne!(Some(&next), cur.as_ref(), "커서는 앞으로 간다");
        }
        texts.extend(items.iter().filter_map(|i| i["text"].as_str().map(str::to_string)));
        cur = Some(next);
        if v["more"] == false || pages > 30 {
            break;
        }
    }
    assert!(pages >= 3, "나뉘어 왔다: {pages}");
    assert_eq!(texts.len(), 1 + 51 + 30, "빠짐 · 겹침 없음");
    assert_eq!(texts[1], "part 0");
    assert_eq!(texts[51], "part 50");
    assert!(texts[52].starts_with("0:") && texts[81].starts_with("29:"));
    assert!(cur.as_deref().is_some_and(|c| c.starts_with("t1.")), "끝은 줄의 시작");
    // 줄 안 커서는 왕복한다.
    let c2 = crate::agent_transcript::forward::Cursor::decode("t2.ab-01.10.5.3.7").unwrap();
    assert_eq!((c2.pos, c2.skip), (3, 7));
    assert_eq!(c2.encode(), "t2.ab-01.10.5.3.7");
    assert!(crate::agent_transcript::forward::Cursor::decode("t2.ab-01.10.5.3.0").is_none(), "t2 의 0 은 t1");
}
