//! 상태 · 소유권 술어 넷과 판 4 실행 형태 픽스처 시험(헤드리스 설계 3a-0 · 앨범 먼저 설계 S2).
//!
//! - `attempt_predicates_table`: 상태 × 실행 방식 → 술어 넷(`turn_may_live` · `attempt_closed` · `owns_worktree` · `resumable`). 2차 상태에서는
//!   옛 `process_may_live`(= exited · stopped 가 아님)와 같은 답이 나와야 한다(옮긴 호출처의 동작이 그대로라는 근거).
//! - `leftover_judgement_by_file_generation`: orphaned Attempt 의 잔존 판정이 판(v1 · v2 PTY · 2단계 헤드리스 턴)마다 다른 갈래로 가고, 지금 두
//!   갈래의 답이 옛 판정과 같다(v3 잡 갈래는 3a).
//! - `v4_execution_fixture_roundtrip`: 판 4 픽스처를 읽기 → 복구 → 정리 → 재저장 → 재시작으로 돌린다.
//!   파일 이름의 v1 · v2는 수집 당시 실행 형태의 구별일 뿐이다. 옛 파일 판을 읽는 호환 시험은 아니다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::attempts::{leftover_alive_with, leftover_branch, LeftoverBranch};
use super::integrate::{refs, IntegrationGit, RefTx, TxOutcome};
use super::model::*;
use super::persist;
use super::store::*;

// ---------------------------------------------------------------------------
// 술어 표
// ---------------------------------------------------------------------------

/// 모든 상태(변이가 늘면 아래 `match` 가 컴파일을 막는다 — 표를 함께 고치라는 뜻).
fn all_states() -> Vec<AttemptState> {
    use AttemptState as S;
    let all = vec![
        S::Spawning,
        S::Starting,
        S::Ready,
        S::Working,
        S::AwaitingHuman,
        S::NeedsRecovery,
        S::Running,
        S::Idle,
        S::Reported,
        S::Exited,
        S::Stopping,
        S::Stopped,
        S::StopUnconfirmed,
        S::ExitUnconfirmed,
    ];
    for s in &all {
        match s {
            S::Spawning
            | S::Starting
            | S::Ready
            | S::Working
            | S::AwaitingHuman
            | S::NeedsRecovery
            | S::Running
            | S::Idle
            | S::Reported
            | S::Exited
            | S::Stopping
            | S::Stopped
            | S::StopUnconfirmed
            | S::ExitUnconfirmed => {}
        }
    }
    all
}

/// 2차의 `process_may_live`(옮기기 전 판정 — 시험의 독립 기준).
fn legacy_may_live(s: AttemptState) -> bool {
    !matches!(s, AttemptState::Exited | AttemptState::Stopped)
}

/// 표 한 줄 — 실행 방식마다 다른 칸은 둘씩.
struct Row {
    s: AttemptState,
    /// turn_may_live (PTY, 헤드리스).
    live: (bool, bool),
    /// attempt_closed(두 방식 같다).
    closed: bool,
    /// owns_worktree (PTY, 헤드리스).
    owns: (bool, bool),
    /// resumable (PTY, 헤드리스).
    resume: (bool, bool),
}

/// D9 · 4-5 — 상태 × 실행 방식 → 술어 넷(3a 에서 `running` · `idle` 과 헤드리스 갈래를 더했다).
/// - PTY(옛 파일): 2차 판정 그대로 — 턴 = 프로세스 생존(`process_may_live`), 자원 = 같은 판정, 이어받기 = `ready`.
/// - 헤드리스(3차): `idle` · **턴 밖의** `reported` 는 턴이 살아 있지 않다(헤드리스 `reported` 는 턴 끝에만 선다) — `idle` 은 열려 있어
///   worktree 를 쥐고 이어받을 수 있고, `reported` 는 닫혀 자원을 놓는다.
#[test]
fn attempt_predicates_table() {
    use AttemptState as S;
    let r = |s, live, closed, owns, resume| Row { s, live, closed, owns, resume };
    let t = true;
    let f = false;
    let table: Vec<Row> = vec![
        r(S::Spawning, (t, t), f, (t, t), (f, f)),
        r(S::Starting, (t, t), f, (t, t), (f, f)),
        r(S::Ready, (t, t), f, (t, t), (t, f)),
        r(S::Working, (t, t), f, (t, t), (f, f)),
        r(S::AwaitingHuman, (t, t), f, (t, t), (f, f)),
        r(S::NeedsRecovery, (t, t), f, (t, t), (f, f)),
        // 3a — 헤드리스 턴이 돈다 / 턴 사이(열림 · 산 프로세스 없음).
        r(S::Running, (t, t), f, (t, t), (f, f)),
        r(S::Idle, (t, f), f, (t, t), (f, t)),
        // 보고는 닫힘. PTY 는 CLI 가 아직 살 수 있어 자원을 쥐고, 헤드리스는 턴 끝에만 서므로 놓는다.
        r(S::Reported, (t, f), t, (t, f), (f, f)),
        r(S::Exited, (f, f), t, (f, f), (f, f)),
        r(S::Stopping, (t, t), f, (t, t), (f, f)),
        r(S::Stopped, (f, f), t, (f, f), (f, f)),
        r(S::StopUnconfirmed, (t, t), f, (t, t), (f, f)),
        r(S::ExitUnconfirmed, (t, t), f, (t, t), (f, f)),
    ];
    let states = all_states();
    assert_eq!(table.len(), states.len(), "표가 모든 상태를 덮는다");
    for s in &states {
        assert!(table.iter().any(|r| r.s == *s), "표에 {s:?} 가 없다");
    }
    for row in &table {
        let s = row.s;
        for (i, mode) in [ExecMode::Pty, ExecMode::Headless].into_iter().enumerate() {
            let pick = |p: (bool, bool)| if i == 0 { p.0 } else { p.1 };
            assert_eq!(turn_may_live(s, mode), pick(row.live), "turn_may_live {s:?} {mode:?}");
            assert_eq!(attempt_closed(s, mode), row.closed, "attempt_closed {s:?} {mode:?}");
            assert_eq!(owns_worktree(s, mode), pick(row.owns), "owns_worktree {s:?} {mode:?}");
            assert_eq!(resumable(s, mode), pick(row.resume), "resumable {s:?} {mode:?}");
            // 술어 사이의 관계(4-5 표의 정의).
            assert_eq!(owns_worktree(s, mode), !attempt_closed(s, mode) || turn_may_live(s, mode));
            assert!(!resumable(s, mode) || !attempt_closed(s, mode), "이어받을 수 있으면 닫히지 않았다");
            assert!(!resumable(s, mode) || !(mode == ExecMode::Headless && turn_may_live(s, mode)), "헤드리스 이어받기는 턴 밖에서만");
        }
        // 동작 변화 없음(PTY) — 옮긴 호출처가 고른 두 술어는 옛 판정과 같다.
        assert_eq!(turn_may_live(s, ExecMode::Pty), legacy_may_live(s), "turn_may_live = 옛 process_may_live ({s:?})");
        assert_eq!(owns_worktree(s, ExecMode::Pty), legacy_may_live(s), "owns_worktree = 옛 process_may_live ({s:?})");
    }
    // `wait_run until=ready` 의 옛 판정(`state == Ready`)과 PTY `resumable` 이 같다 · 헤드리스는 `idle`.
    for s in states {
        assert_eq!(resumable(s, ExecMode::Pty), s == S::Ready);
        assert_eq!(resumable(s, ExecMode::Headless), s == S::Idle);
    }
    // Attempt 위의 `resumable` — 대화가 끊기면 idle 이어도 아니다(D6).
    let mut a = attempt(S::Idle, AttemptRole::Worker, None, 1, None);
    a.kind = Some(AttemptKind::Write);
    assert!(a.resumable());
    a.conversation_broken = true;
    assert!(!a.resumable());
}

/// 시험용 Attempt — 모양만(상태 · 역할 · 스트림 · 턴 · pid).
fn attempt(state: AttemptState, role: AttemptRole, stream: Option<&str>, turns: usize, pid: Option<u32>) -> Attempt {
    Attempt {
        id: "att-00000000000000000000000000000001".into(),
        task_id: "task-00000000000000000000000000000001".into(),
        cli: WorkerCli::Claude,
        gen: 1,
        state,
        stream: stream.map(str::to_string),
        worktree: None,
        branch: None,
        base_commit: None,
        pid,
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
        role,
        review_of: None,
        turns: (0..turns)
            .map(|i| TurnRecord {
                n: i as u32 + 1,
                started_at: 0,
                ended_at: Some(1),
                outcome: "ok".into(),
                reason: None,
                exit_code: Some(0),
                denials: 0,
                denial_kinds: Vec::new(),
                tools: 0,
                last_tool: None,
                cli_version: None,
                model: None,
                args: TurnArgsLabel::default(),
                anomalies: TurnAnomalies::default(),
            })
            .collect(),
    }
}

/// Attempt 위의 술어는 실행 방식을 Attempt 모양에서 고른다.
#[test]
fn attempt_exec_mode_from_shape() {
    let pty_worker = attempt(AttemptState::Working, AttemptRole::Worker, Some("orch-1"), 0, None);
    let pty_reviewer = attempt(AttemptState::Working, AttemptRole::Reviewer, Some("orch-2"), 0, None);
    let headless_spawning = attempt(AttemptState::Spawning, AttemptRole::Reviewer, None, 0, None);
    let headless_turns = attempt(AttemptState::Working, AttemptRole::Reviewer, None, 1, None);
    // 시험이 흔히 만드는 스트림 없는 작업자(옛 모양)는 PTY 로 본다.
    let bare_worker = attempt(AttemptState::Exited, AttemptRole::Worker, None, 0, None);
    assert_eq!(pty_worker.exec_mode(), ExecMode::Pty);
    assert_eq!(pty_reviewer.exec_mode(), ExecMode::Pty);
    assert_eq!(headless_spawning.exec_mode(), ExecMode::Headless);
    assert_eq!(headless_turns.exec_mode(), ExecMode::Headless);
    assert_eq!(bare_worker.exec_mode(), ExecMode::Pty);
    for a in [&pty_worker, &pty_reviewer, &headless_spawning, &headless_turns, &bare_worker] {
        let m = a.exec_mode();
        assert_eq!(a.turn_may_live(), turn_may_live(a.state, m));
        assert_eq!(a.attempt_closed(), attempt_closed(a.state, m));
        assert_eq!(a.owns_worktree(), owns_worktree(a.state, m));
        assert_eq!(a.resumable(), resumable(a.state, m));
    }
}

// ---------------------------------------------------------------------------
// 잔존 판정 갈래
// ---------------------------------------------------------------------------

/// D13 — 잔존 판정을 판마다 가른다: v1 · v2 PTY Attempt(`stream`) → PTY 갈래, 2단계 헤드리스 검토자(`turns` · 스트림 없음) → 헤드리스 턴
/// 갈래. 지금 두 갈래의 답은 옛 판정(`process_may_live && pid 가 그 CLI 로 삶`)과 같고, 끝난 상태는 OS 에 묻지도 않는다.
#[test]
fn leftover_judgement_by_file_generation() {
    use AttemptState as S;
    let shapes: [(&str, AttemptRole, Option<&str>, usize, LeftoverBranch); 4] = [
        ("v2 PTY worker", AttemptRole::Worker, Some("orch-1"), 0, LeftoverBranch::PtySession),
        ("v2 PTY reviewer (2단계 전)", AttemptRole::Reviewer, Some("orch-2"), 0, LeftoverBranch::PtySession),
        ("2단계 헤드리스 검토자(턴 있음)", AttemptRole::Reviewer, None, 1, LeftoverBranch::HeadlessTurn),
        ("2단계 헤드리스 검토자(첫 턴 전)", AttemptRole::Reviewer, None, 0, LeftoverBranch::HeadlessTurn),
    ];
    for (what, role, stream, turns, branch) in shapes {
        for s in all_states() {
            for pid in [None, Some(4_242u32)] {
                let a = attempt(s, role, stream, turns, pid);
                assert_eq!(leftover_branch(&a), branch, "{what} {s:?}");
                for os_says in [true, false] {
                    let asked = AtomicUsize::new(0);
                    let probe = |p: u32, cli: WorkerCli| {
                        asked.fetch_add(1, Ordering::SeqCst);
                        assert_eq!((p, cli), (4_242, WorkerCli::Claude), "기록된 pid · 그 CLI 로 묻는다");
                        os_says
                    };
                    let got = leftover_alive_with(&a, &probe);
                    // PTY 갈래 = 옛 판정. 헤드리스 갈래(3a — v3 잡) = 기본 "없음" · 마지막 턴이 산 상태로 남았을 때만(여기 턴은 끝난 `ok`)
                    // · 턴 기록이 없으면 상태로.
                    let maybe = match branch {
                        LeftoverBranch::PtySession => legacy_may_live(s),
                        LeftoverBranch::HeadlessTurn => turns == 0 && turn_may_live(s, ExecMode::Headless),
                    };
                    let want = maybe && pid.is_some() && os_says;
                    assert_eq!(got, want, "{what} {s:?} pid={pid:?} os={os_says}");
                    if !maybe || pid.is_none() {
                        assert_eq!(asked.load(Ordering::SeqCst), 0, "{what} {s:?} — 끝났거나 pid 가 없으면 OS 에 묻지 않는다");
                    }
                }
            }
        }
    }
    // 쓰는 중 자원: 산 상태(보고 뒤 PTY 포함)는 OS 가 살아 있다고 하면 잔존 — 정리 대상이 아니다.
    for s in [S::Reported, S::Working, S::StopUnconfirmed, S::ExitUnconfirmed] {
        let a = attempt(s, AttemptRole::Worker, Some("orch-1"), 0, Some(4_242));
        assert!(leftover_alive_with(&a, &|_, _| true), "{s:?}");
    }
    // 3a 쓰기형 헤드리스(v3) — 마지막 턴이 `running` · `stop-unconfirmed` 로 남았을 때만 PID · 이미지로 확인한다.
    for (outcome, want) in [("running", true), ("stop-unconfirmed", true), ("ok", false), ("failed", false), ("timeout", false)] {
        let mut a = attempt(S::Running, AttemptRole::Worker, None, 1, Some(4_242));
        a.kind = Some(AttemptKind::Write);
        a.turns[0].outcome = outcome.into();
        assert_eq!(leftover_branch(&a), LeftoverBranch::HeadlessTurn);
        assert_eq!(leftover_alive_with(&a, &|_, _| true), want, "{outcome}");
        assert!(!leftover_alive_with(&a, &|_, _| false));
    }
}

// ---------------------------------------------------------------------------
// 판 4의 실행 형태별 픽스처 왕복
// ---------------------------------------------------------------------------

const FIXTURES: &[(&str, &str)] = &[
    ("v1-running-reported", include_str!("run_fixtures/v1-running-reported.json")),
    ("v1-pending-recovery", include_str!("run_fixtures/v1-pending-recovery.json")),
    ("v2-integrated-conflict", include_str!("run_fixtures/v2-integrated-conflict.json")),
    ("v2-headless-reviewer", include_str!("run_fixtures/v2-headless-reviewer.json")),
    ("v2-committing-handmade", include_str!("run_fixtures/v2-committing-handmade.json")),
];

/// 메모리 ref 표 — 재시작 복구가 읽는 증거 ref · 통합 머리만.
#[derive(Default)]
struct RefTable {
    refs: Mutex<HashMap<String, String>>,
}

impl IntegrationGit for RefTable {
    fn apply(&self, _repo: &Path, _tx: &RefTx) -> Result<TxOutcome, String> {
        Err("this fixture hand does not integrate".into())
    }
    fn read_ref(&self, _repo: &Path, name: &str) -> Result<Option<String>, String> {
        Ok(self.refs.lock().unwrap().get(name).cloned())
    }
    fn is_ancestor(&self, _repo: &Path, a: &str, b: &str) -> Result<bool, String> {
        Ok(a == b)
    }
}

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-state-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn orch(dir: &Path) -> Orchestration {
    let emit: EmitFn = Arc::new(|_: &str, _: Value| {});
    let clock = Arc::new(AtomicU64::new(1_900_000_000_000));
    Orchestration::with_clock(Some(dir.to_path_buf()), emit, None, Arc::new(move || clock.fetch_add(1, Ordering::SeqCst)))
}

/// Run 의 해석(상태 · 술어 · 잔존 갈래와 판정 — 잔존은 OS 대신 "살아 있다" · "없다" 두 손으로).
fn attempt_view(run: &Run) -> Vec<String> {
    run.attempts
        .iter()
        .map(|a| {
            format!(
                "{} {:?} {:?} live={} closed={} owns={} resume={} {:?} alive_if_os={} alive_if_dead={}",
                a.id,
                a.state,
                a.exec_mode(),
                a.turn_may_live(),
                a.attempt_closed(),
                a.owns_worktree(),
                a.resumable(),
                leftover_branch(a),
                leftover_alive_with(a, &|_, _| true),
                leftover_alive_with(a, &|_, _| false),
            )
        })
        .collect()
}

fn run_view(run: &Run) -> Vec<String> {
    let mut v = attempt_view(run);
    v.extend(run.tasks.iter().map(|t| format!("{} {:?} cur={:?}", t.id, t.state, t.current_attempt)));
    v.extend(run.jobs.iter().map(|j| format!("{} {:?} {:?}", j.job_id, j.phase, j.outcome.as_ref().map(|o| o.reason.clone()))));
    v.push(format!("state={:?} prev={:?} hold={:?}", run.state, run.previous_state, run.hold.as_ref().map(|h| h.reason)));
    v.push(format!("expected={:?}", run.integration.as_ref().map(|i| i.expected_head.clone())));
    v.push(format!(
        "holding={} live={} workers={}",
        run.attempts.iter().filter(|a| a.owns_worktree()).count(),
        run.live_attempts(),
        run.live_workers()
    ));
    v
}

/// 옛 파일에 있던 칸이 다시 쓴 파일에서 사라졌나 — `null` · `false` · 빈 배열 · 빈 객체는 직렬화가 생략할 수 있어 뺀다. 배열은 앞에서부터
/// 같은 자리끼리(복구 · 사건은 뒤에 더한다).
fn missing_keys(orig: &Value, saved: &Value, at: &str, out: &mut Vec<String>) {
    match (orig, saved) {
        (Value::Object(o), Value::Object(s)) => {
            for (k, v) in o {
                let here = format!("{at}.{k}");
                match s.get(k) {
                    Some(sv) => missing_keys(v, sv, &here, out),
                    None => {
                        let omittable = match v {
                            Value::Null => true,
                            Value::Bool(b) => !b,
                            Value::Array(a) => a.is_empty(),
                            Value::Object(m) => m.is_empty(),
                            _ => false,
                        };
                        if !omittable {
                            out.push(here);
                        }
                    }
                }
            }
        }
        (Value::Array(o), Value::Array(s)) => {
            if s.len() < o.len() {
                out.push(format!("{at}[] {} → {}", o.len(), s.len()));
            }
            for (i, (a, b)) in o.iter().zip(s.iter()).enumerate() {
                missing_keys(a, b, &format!("{at}[{i}]"), out);
            }
        }
        _ => {}
    }
}

/// 판 4 픽스처의 왕복: 읽기 → 복구 → 정리 판정 → 재저장 → 재시작.
#[test]
fn v4_execution_fixture_roundtrip() {
    let dir = scratch("roundtrip");
    let git = Arc::new(RefTable::default());
    let mut originals: Vec<(String, &str, Value, Run)> = Vec::new();
    for (name, text) in FIXTURES {
        let raw: Value = serde_json::from_str(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let decoded = persist::decode(text.as_bytes()).unwrap_or_else(|e| panic!("{name}: {e}"));
        let id = decoded.id.clone();
        assert!(is_id("run", &id), "{name}");
        std::fs::write(dir.join(persist::file_name(&id)), text).unwrap();
        // 통합 ref 는 기대 머리 그대로(복구가 보류를 새로 걸 까닭이 없다) — committing fixture 만 아래에서 따로.
        if let Some(i) = &decoded.integration {
            git.refs.lock().unwrap().insert(i.work_ref.clone(), i.expected_head.clone());
        }
        originals.push((id, name, raw["run"].clone(), decoded));
    }
    // 손으로 만든 fixture — CAS 는 섰고(통합 ref = 후보 · 완료 증거 = 후보) 장부에 적기 전에 서버가 죽었다(2차 `crash_after_cas_recovers_from_done_ref`).
    let commit_run = "run-c0ff00000000000000000000000000e1";
    let commit_job = "job-c0ff0000000000000000000000000001";
    let cand = "2222222222222222222222222222222222222222";
    // 이 fixture 는 지금과 다른 뿌리(`refs/oldroot/orch/…` — 개명 전 Run 을 흉내, 서버는 그 이름을 모른다)의 Run 파일이다:
    // 통합 ref 는 저장된 그 이름 그대로, 완료 증거도 같은 머리에서 읽어야 복구가 통합됨으로 판정한다(`refs::base_of`).
    let legacy_int = format!("refs/oldroot/orch/{}/int", refs::short(commit_run));
    let saved = originals.iter().find(|x| x.0 == commit_run).unwrap().3.integration.clone().unwrap();
    assert_eq!(saved.work_ref, legacy_int, "옛 뿌리의 Run 파일");
    let legacy_done = refs::done(&refs::base_of(commit_run, &saved.work_ref), commit_job);
    assert!(legacy_done.starts_with("refs/oldroot/orch/"), "{legacy_done}");
    git.refs.lock().unwrap().insert(legacy_int, cand.into());
    git.refs.lock().unwrap().insert(legacy_done, cand.into());

    // ① 읽기 — 모두 orphaned 로 오르고, 이전 상태가 남는다.
    let o = orch(&dir);
    for (id, name, _, decoded) in &originals {
        let r = o.lock().runs.get(id).unwrap_or_else(|| panic!("{name} 이 읽히지 않았다")).run.clone();
        assert_eq!(r.state, RunState::Orphaned, "{name}");
        let want_prev = if decoded.state == RunState::Orphaned { decoded.previous_state } else { Some(decoded.state) };
        assert_eq!(r.previous_state, want_prev, "{name}");
        // 읽기만으로는 Attempt 해석이 바뀌지 않는다(파일 그대로의 상태 · 판).
        assert_eq!(attempt_view(&r), attempt_view(decoded), "{name}");
    }
    // 판별: v1 · v2 PTY 는 PTY 갈래, 2단계 검토자(턴)는 헤드리스 갈래.
    {
        let g = o.lock();
        let rv = &g.runs.get("run-56d00b26ce65be425753b0865fd0d6e3").unwrap().run;
        let branches: Vec<LeftoverBranch> = rv.attempts.iter().map(leftover_branch).collect();
        assert_eq!(
            branches,
            vec![LeftoverBranch::PtySession, LeftoverBranch::HeadlessTurn, LeftoverBranch::HeadlessTurn],
            "v2 작업자(PTY) + 2단계 헤드리스 검토자 둘"
        );
        let old_rv = &g.runs.get("run-615585472dbe9733253e1b826405963a").unwrap().run;
        assert!(old_rv.attempts.iter().all(|a| leftover_branch(a) == LeftoverBranch::PtySession), "2단계 전 PTY 검토자는 PTY 갈래");
    }

    // ② 복구 — committing Job 하나만 판정한다(v2 와 같은 결과: 증거 ref 로 통합됨).
    o.set_integrator(git.clone());
    assert_eq!(o.recover_jobs(), 1, "committing Job 이 있는 Run 하나만");
    {
        let r = o.lock().runs.get(commit_run).unwrap().run.clone();
        let j = r.jobs.iter().find(|j| j.job_id == commit_job).unwrap();
        assert_eq!((j.phase, j.outcome.as_ref().map(|x| x.reason.as_str())), (JobPhase::Integrated, Some("recovered")));
        let t = r.task("task-c0ff0000000000000000000000000001").unwrap();
        assert_eq!(t.state, TaskState::Accepted);
        let art = r.valid_artifact(&t.id).unwrap();
        assert_eq!(art.integration_commit.as_deref(), Some(cand));
        assert_eq!(art.job_id.as_deref(), Some(commit_job));
        assert_eq!(r.integration.as_ref().unwrap().expected_head, cand);
        assert!(r.hold.is_none());
        assert!(r.log.iter().any(|l| l.action == "recovered_integrated"));
        // 복구는 Attempt 를 건드리지 않는다 — 산 상태(보고 뒤 PTY · 일하던 작업자)는 그대로 "쓰는 중일 수 있음".
        let orig = &originals.iter().find(|x| x.0 == commit_run).unwrap().3;
        assert_eq!(attempt_view(&r), attempt_view(orig));
        assert!(r.attempts.iter().all(|a| a.turn_may_live() && a.owns_worktree()));
    }

    // ③ 정리 판정 — orphaned 의 서버 임시 자리 폐기(가짜 경로는 모두 없다 → 남길 것 없음) · 쓰는 중 자원 판정.
    for (id, name, _, _) in &originals {
        let swept = o.sweep_temps(id);
        assert_eq!(swept.kept + swept.busy, 0, "{name}");
        let r = o.lock().runs.get(id).unwrap().run.clone();
        assert!(r.temp_pending.is_empty(), "{name}");
        for a in &r.attempts {
            // 산 상태는 OS 가 살아 있다고 하면 잔존(정리 대상 아님), 끝난 상태는 OS 와 무관하게 잔존 아님.
            assert_eq!(leftover_alive_with(a, &|_, _| true), a.turn_may_live() && a.pid.is_some(), "{name} {}", a.id);
        }
    }

    // ④ 재저장 — 모든 Run 을 한 번 쓴다(복구가 쓴 committing Run 도 다시).
    let after: Vec<(String, Run)> = {
        let g = o.lock();
        originals
            .iter()
            .map(|(id, ..)| {
                o.save_orphaned(&g, id);
                (id.clone(), g.runs.get(id).unwrap().run.clone())
            })
            .collect()
    };
    o.flush_saves();
    drop(o);
    for (id, name, raw, _) in &originals {
        let text = std::fs::read_to_string(dir.join(persist::file_name(id))).unwrap();
        let saved: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(saved["version"], FILE_VERSION, "{name} — 다시 쓸 때는 지금 판");
        let mut lost = Vec::new();
        missing_keys(raw, &saved["run"], "run", &mut lost);
        assert!(lost.is_empty(), "{name} — 다시 쓴 파일에서 사라진 칸: {lost:?}");
        // 옛 칸(attachMode · autoStopReported · deliveries · pendingRecovery · 통합 Job 기록 · 3차 6단계에 새 쓰기에서 뺀 2차 시작 대화 칸)이 값
        // 그대로 남는다(빈 목록 · false 도 — 옛 파일의 글자 그대로).
        for key in [
            "attachMode",
            "autoStopReported",
            "deliveries",
            "jobs",
            "integration",
            "reviewReports",
            "verify",
            "commits",
            "workerPermission",
            "allowedClis",
            "requireReview",
            "reviewerClis",
        ] {
            if let Some(v) = raw.get(key) {
                if key == "jobs" || key == "integration" {
                    assert!(saved["run"].get(key).is_some(), "{name} {key}");
                } else {
                    assert_eq!(saved["run"].get(key), Some(v), "{name} {key}");
                }
            }
        }
    }

    // ⑤ 재시작 — 같은 폴더로 다시 읽는다: Run 이 다시 쓴 그대로이고 해석이 같다 · 복구는 더 할 일이 없다.
    let o2 = orch(&dir);
    o2.set_integrator(git.clone());
    for (id, run) in &after {
        let r = o2.lock().runs.get(id).unwrap().run.clone();
        assert_eq!(&r, run, "{id} — 재시작 뒤 같은 Run");
        assert_eq!(run_view(&r), run_view(run), "{id}");
    }
    assert_eq!(o2.recover_jobs(), 0, "판정은 한 번 — 재시작 뒤 다시 하지 않는다");
    drop(o2);
    let _ = std::fs::remove_dir_all(&dir);
}
