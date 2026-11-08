//! **Attempt 의 수명**(설계 B · C-3 · C-7 — G 3단계 · 헤드리스 설계 4-1 ~ 4-8 — 3차 3a): 조정자의 `spawn_worker{role}` · `stop_worker`,
//! 사람의 [중단], 서버 손([`super::spawn::WorkerLauncher`])이 알려 오는 턴의 단계(worktree → 프로세스 → 턴 기록 → 끝), 종료 미확인 다시
//! 보기, 서버 재시작 뒤 잔존 자원 찾기. 이어지는 턴(`send_prompt`)은 `resume.rs`.
//!
//! 불변식:
//! - **작업자 · 해결자 · 검토자는 헤드리스 턴이다**(3a) — 한 턴 = 셸 없는 CLI 프로세스 하나(파이프 · 생성 시 Job · `SPAWN_LOCK` 아래 —
//!   `server::workers`). 세션 · PTY · 타일 · 신호 스트림이 없다. 턴의 끝 = 프로세스 끝(+ 트리 종료 확인).
//! - **맡긴 저장소에서만**(E5) — 첫 턴(`spawn_worker`)과 이어지는 턴마다 지금 맡기기를 다시 읽고(`roles.rs`), 서버 손은 효과 **직전**에
//!   [`Orchestration::turn_preflight`] 로 한 번 더 본다(2-6 — 신원 · 받아들인 판 · 역할).
//! - 한도 슬롯 예약 · Attempt 생성 · Task 를 active 로 · 첫 턴 토큰 발급 · 멱등 기록이 **잠금 하나 안에서 한 번에** 일어난다
//!   (`spawn_slot_reservation_is_atomic`). 띄우는 일(git · 프로세스)은 잠금 **밖** 서버 손의 스레드에서.
//! - **상태 기계**(4-5 · 4-8): `spawning` → `running`(턴) → 턴 끝(트리 종료 확인) → 그 턴 안에 `report_done{success|failure}` 가 왔으면
//!   `reported`(닫힘) · 아니면 `idle`(+ `blocked` 표지가 있을 수 있다 — 비종결). 판정형(검토자)은 한 턴 — 판정이 있으면 `reported` · 없으면
//!   `exited`(종결 · 활성 검토 비움). 트리 종료를 확인하지 못하면 `stop-unconfirmed`(산 것으로 센다 — 서버 시계가 다시 본다).
//!   `stopped` 는 **트리 종료가 확인된 뒤에만**(`stopped_only_after_tree_exit`). `idle` 은 닫는 사건(중단 · 반려 · 취소 · Run 중단 · 완료)에서
//!   곧바로 닫힌다(산 프로세스가 없다).
//! - **작업자 토큰은 턴 단위**(D9 · D11) — 턴을 띄울 때 뽑고 그 턴의 트리 종료가 확인될 때 거둔다(`idle` 에는 산 토큰이 없다). 생성
//!   실패면 곧바로.
//! - 서버는 작업자에게 키도 표준 입력도 보내지 않는다(stdin = NUL) — 지시는 실행 인자(첫 지시 · resume 턴의 지시)뿐이다.

use std::path::Path;

use serde_json::{json, Value};

use super::model::*;
use super::spawn::{self, Base, LaunchJob, TurnPlan};
use super::store::reason;
use super::store::{revoke_run, revoke_worker, settle_stopping, state_error, writable, Binding, OrchError, Orchestration, Slot};
use super::tools::{arg, bad, coordinator_slot, opt_text, request_id};
use crate::audit::OrchestrationAudit;

/// 서버 손에 돌려주는 판정 — 프로세스가 섰는데 그사이 중단됐으면 곧바로 회수한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnVerdict {
    Keep,
    Reap,
}

/// 동시 · 총 작업자 한도 — 도는 턴 + 예약 < 한도. 잠금 안에서 부른다.
pub(super) fn check_worker_slot(slot: &Slot) -> Result<(), OrchError> {
    let l = slot.run.limits;
    // 검토자는 세지 않는다(통합 설계 3-4 — 검토는 작업자 한도와 따로). `idle` 은 자리를 차지하지 않는다(4-5 — 술어 `turn_may_live`).
    let live = slot.run.live_workers() as u32 + slot.reserved_workers;
    let total = slot.run.worker_count() as u32 + slot.reserved_workers;
    if live >= l.max_concurrent_workers {
        return Err(OrchError::new(
            reason::WORKER_LIMIT,
            format!("at most {} workers can run a turn at once in this run", l.max_concurrent_workers),
        ));
    }
    if total >= l.max_total_workers {
        return Err(OrchError::new(
            reason::WORKER_LIMIT,
            format!("this run may start at most {} workers in total", l.max_total_workers),
        ));
    }
    Ok(())
}

/// 동시 한도만(이어지는 턴 — 총 한도는 Attempt 수라 새 턴은 세지 않는다).
pub(super) fn check_concurrent_slot(slot: &Slot) -> Result<(), OrchError> {
    let l = slot.run.limits;
    let live = slot.run.live_workers() as u32 + slot.reserved_workers;
    if live >= l.max_concurrent_workers {
        return Err(OrchError::new(
            reason::WORKER_LIMIT,
            format!("at most {} workers can run a turn at once in this run — wait for one (wait_run)", l.max_concurrent_workers),
        ));
    }
    Ok(())
}

/// Attempt 하나를 `stopping` 으로(턴이 살아 있을 수 있고 아직 중단 중이 아닐 때만) — 올렸으면 `true`(서버 손이 트리를 끝낸다).
pub(super) fn mark_stopping(slot: &mut Slot, attempt_id: &str, now: u64, actor: Actor) -> bool {
    let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
        return false;
    };
    // 술어 `turn_may_live` — 멈출 것은 도는 턴(프로세스)이다(`idle` 을 닫는 길은 [`close_idle`]).
    if !a.turn_may_live() || matches!(a.state, AttemptState::Stopping | AttemptState::StopUnconfirmed) {
        if a.turn_may_live() {
            a.stop_requested = true;
        }
        return false;
    }
    a.state = AttemptState::Stopping;
    a.stop_requested = true;
    a.attention = None;
    slot.run.bump(now, actor, "worker_stopping", Some(attempt_id), AttemptState::Stopping.as_str());
    true
}

/// `idle` Attempt 를 곧바로 닫는다(4-5 닫는 사건 — 산 프로세스 · 산 토큰이 없다). 닫았으면 `true`.
pub(super) fn close_idle(slot: &mut Slot, attempt_id: &str, now: u64, actor: Actor) -> bool {
    let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
        return false;
    };
    if a.state != AttemptState::Idle {
        return false;
    }
    a.state = AttemptState::Stopped;
    a.stop_requested = true;
    a.ended_at = Some(now);
    slot.run.bump(now, actor, "worker_closed", Some(attempt_id), AttemptState::Stopped.as_str());
    true
}

/// 닫는 사건 하나(Attempt 하나) — `idle` 은 곧바로 닫고, 도는 턴은 `stopping`. 서버 손이 멈출 것이면 `true`.
pub(super) fn close_or_stop(slot: &mut Slot, attempt_id: &str, now: u64, actor: Actor) -> bool {
    if close_idle(slot, attempt_id, now, actor) {
        return false;
    }
    mark_stopping(slot, attempt_id, now, actor)
}

/// 이 Run 의 열린 Attempt 를 모두 닫는다(Run [중단] · 실행 한도 — 4-5) — `idle` 은 곧바로, 도는 턴은 `stopping`. 서버 손이 멈출 Attempt id 들.
pub(super) fn mark_all_stopping(slot: &mut Slot, now: u64, actor: Actor) -> Vec<String> {
    let ids: Vec<String> = slot
        .run
        .attempts
        .iter()
        .filter(|a| a.state == AttemptState::Idle || a.turn_may_live())
        .map(|a| a.id.clone())
        .collect();
    ids.into_iter().filter(|id| close_or_stop(slot, id, now, actor)).collect()
}

/// 그 Task 의 열린 작업자(쓰기형)를 닫는다(Task 반려 · 취소 — 4-5 닫는 사건). 도는 턴은 `stopping` 으로 올려 `stop_queue` 에 쌓는다(부른 쪽이
/// 잠금 밖에서 `drain_stops`). 판정형은 `review::invalidate` 가 맡는다.
pub(super) fn close_task_workers(slot: &mut Slot, task_id: &str, now: u64, actor: Actor) {
    let ids: Vec<String> = slot
        .run
        .attempts
        .iter()
        .filter(|a| a.task_id == task_id && !a.is_reviewer() && (a.state == AttemptState::Idle || a.turn_may_live()))
        .map(|a| a.id.clone())
        .collect();
    for id in ids {
        if close_or_stop(slot, &id, now, actor) {
            slot.stop_queue.push(id);
        }
    }
}

/// orphaned Attempt 의 잔존 판정 갈래(헤드리스 설계 5절 · D13) — Attempt 의 판(파일 세대 · 실행 방식)마다 다른 함수로 판정하고 **섞지 않는다**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeftoverBranch {
    /// v1 · v2 PTY Attempt(`stream` 이 있다) — 떨어진 PTY 세션 + 기록된 PID · CLI 이미지.
    PtySession,
    /// 헤드리스 턴(3a 의 작업자 · 해결자 · 검토자 · 2단계 검토자) — 턴 잡.
    HeadlessTurn,
}

/// 이 Attempt 의 잔존 판정 갈래([`Attempt::exec_mode`] 와 같은 가름).
pub(crate) fn leftover_branch(a: &Attempt) -> LeftoverBranch {
    match a.exec_mode() {
        // 옛 파일 호환(v1 · v2 PTY 작업자 — 잔존 세션 · PID 판정).
        ExecMode::Pty => LeftoverBranch::PtySession,
        ExecMode::Headless => LeftoverBranch::HeadlessTurn,
    }
}

/// OS 에 묻는 손 — 그 pid 가 살아 있고 이미지가 그 CLI 인가(pid 재사용을 피한다).
fn os_pid_is_cli(pid: u32, cli: WorkerCli) -> bool {
    crate::server::os::pid_alive(pid)
        && crate::server::os::image_path(pid)
            .map(|p| p.to_ascii_lowercase())
            .is_some_and(|p| p.contains(cli.as_str()))
}

/// orphaned Run 의 Attempt 프로세스가 아직 살아 있나. 서버가 다시 떴으니 이 서버의 표에는 그 프로세스가 없다 — OS 에 직접 묻는다.
pub(super) fn leftover_process_alive(a: &Attempt) -> bool {
    leftover_alive_with(a, &os_pid_is_cli)
}

/// [`leftover_process_alive`] 의 몸 — 판마다 갈래를 고르고 OS 손(`pid_is_cli`)은 바꿔 끼울 수 있다(시험).
pub(crate) fn leftover_alive_with(a: &Attempt, pid_is_cli: &dyn Fn(u32, WorkerCli) -> bool) -> bool {
    match leftover_branch(a) {
        LeftoverBranch::PtySession => pty_leftover_alive(a, pid_is_cli),
        LeftoverBranch::HeadlessTurn => headless_leftover_alive(a, pid_is_cli),
    }
}

/// v1 · v2 PTY 갈래(옛 길) — 상태가 "턴(세션)이 살아 있을 수 있음"(술어 `turn_may_live` — 서버 재시작 잔존 판정)이고 기록된 pid 가
/// 그 CLI 로 살아 있을 때.
fn pty_leftover_alive(a: &Attempt, pid_is_cli: &dyn Fn(u32, WorkerCli) -> bool) -> bool {
    a.turn_may_live() && a.pid.is_some_and(|pid| pid_is_cli(pid, a.cli))
}

/// 헤드리스 턴 갈래(5절 v3 잡) — 옛 서버의 자기 잡(`KILL_ON_JOB_CLOSE`)이 턴 트리를 끝냈으므로 **기본은 "없음"**. 마지막 턴이 산 상태(`running`
/// · `stop-unconfirmed`)로 남았을 때만 기록된 PID · 이미지로 한 번 확인한다(잡 밖 자손 — 스토어판 pwsh 등 ③-0). 턴 기록이 없는 2단계 이전
/// 모양(스트림 없는 검토자의 첫 턴 전)은 상태로 본다.
fn headless_leftover_alive(a: &Attempt, pid_is_cli: &dyn Fn(u32, WorkerCli) -> bool) -> bool {
    let maybe = if a.turns.is_empty() { a.turn_may_live() } else { a.last_turn_may_live() };
    maybe && a.pid.is_some_and(|pid| pid_is_cli(pid, a.cli))
}

/// 서버 재시작 뒤 orphaned Run 의 **잔존 자원**(설계 C-7) — 살아 있을 수 있던 Attempt 의 프로세스(pid 가 살아 있고 이미지가 그
/// CLI 인지 — pid 재사용을 피한다) · 남아 있는 worktree. 사람에게 안내만 한다(자동으로 끝내지 않는다).
pub(super) fn leftovers_of(run: &Run) -> Vec<Value> {
    let mut out = Vec::new();
    for a in &run.attempts {
        let alive = leftover_process_alive(a);
        let wt_exists = a.worktree.as_deref().is_some_and(|w| Path::new(w).is_dir());
        if alive || wt_exists {
            out.push(json!({
                "attemptId": a.id,
                "state": a.state,
                "cli": a.cli,
                "pid": a.pid,
                "processAlive": alive,
                "worktree": a.worktree,
                "worktreeExists": wt_exists,
                "halfMade": wt_exists && a.state == AttemptState::Spawning,
            }));
        }
    }
    out
}

fn attempt_audit(gen: u32, actor: Actor, a: &Attempt) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: actor.as_str().into(),
        task_id: Some(a.task_id.clone()),
        attempt_id: Some(a.id.clone()),
        cli: Some(a.cli.as_str().into()),
        attempt_state: Some(a.state.as_str().into()),
        role_id: a.role_id.clone(),
        ..Default::default()
    }
}

/// `exit_reason` 의 짧은 글자 — 제어 문자 · 긴 글을 싣지 않는다(영속 파일 · 보드).
fn short_reason(s: &str) -> String {
    let one: String = s.chars().filter(|c| !c.is_control()).collect();
    one.chars().take(240).collect()
}

impl Orchestration {
/// 조정자 `spawn_worker{role}` — 역할 id 로 지금 맡기기에서 역할을 고르고(쓰기형 = 작업자 · 해결자 · 판정형 = 검토자 — 4-7), 머리말의
    /// 원자 구간 뒤 서버 손에 맡긴다(비동기). 옛 `cli` 인자는 `bad-args`(조용히 무시하지 않는다 — 3-2a).
    pub(super) fn spawn_worker(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        if arg(args, "cli").is_some() {
            return Err(OrchError::new(
                reason::BAD_ARGS,
                "cli is not an argument any more — pick a role id from get_run roles and pass role: <id> (the CLI, model and permission come from the role)",
            ));
        }
        let role_id = opt_text(args, "role", 64)?.map(|s| s.trim().to_string()).unwrap_or_default();
        if role_id.is_empty() || matches!(role_id.as_str(), "worker" | "reviewer") {
            return Err(OrchError::new(
                reason::BAD_ARGS,
                "role is required — a role id from get_run roles (like r-1a2b3c4d), not worker or reviewer",
            ));
        }
        // 맡기기를 지금 읽는다(잠금 밖 — 파일 · git).
        let lookup = self.run_inputs(run_id);
        let role = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(super::store::not_found_run)?;
            lookup.pick_role(&slot.run, &role_id)
        };
        match role {
            Ok(r) if r.kind == AttemptKind::Judge => self.spawn_reviewer(run_id, gen, args, r, &lookup),
            other => self.spawn_writer(run_id, gen, args, other, &lookup),
        }
    }

    /// 쓰기형(작업자 · 해결자)의 첫 턴.
    fn spawn_writer(
        &self,
        run_id: &str,
        gen: u32,
        args: Option<&Value>,
        role: Result<super::roles::TurnRole, OrchError>,
        lookup: &super::album::RunInputs,
    ) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let task_id = super::tools::req_text(args, "taskId", 64)?;
        let base_arg = opt_text(args, "base", 64)?;
        let reuse_of = opt_text(args, "reuseWorktreeOf", 64)?.map(|s| s.trim().to_string());
        if reuse_of.as_deref().is_some_and(|s| !is_id("att", s)) {
            return Err(bad("reuseWorktreeOf must be an attempt id"));
        }
        // 이어 쓸 worktree 가 깨끗한지 — git 은 잠금 밖에서 먼저 읽고, 잠금 안에서 나머지 조건(끝났나 · 같은 Task · 아무도 안 쓰나)을 본다.
        let reuse_clean: Option<Result<bool, String>> = match reuse_of.as_deref() {
            None => None,
            Some(of) => {
                let path = self
                    .lock()
                    .runs
                    .get(run_id)
                    .and_then(|s| s.run.attempts.iter().find(|a| a.id == of))
                    .and_then(|a| a.worktree.clone());
                path.map(|p| (self.probe())(Path::new(&p), None).map(|s| !s.dirty && s.head.is_some()))
            }
        };
        // 통합 ref 가 있는 Run — 새 Attempt 의 기준은 통합 머리(통합 설계 2-2). git 은 잠금 밖에서 먼저 읽고 잠금 안에서 기대 머리와 견준다.
        let int_head = if reuse_of.is_none() { self.read_integration_head(run_id) } else { None };
        let attempt_id = new_id("att").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let token = crate::token::generate_token().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let uuid = spawn::new_uuid().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        let (result, job, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request_id, "spawn_worker", &super::store::request_sha(args))? {
                return Ok(first);
            }
            writable(&slot.run)?;
            if self.launcher().is_none() {
                return Err(OrchError::new(reason::SPAWN_UNAVAILABLE, "this server cannot start workers"));
            }
            // 맡기기 관문(E5 — 맡긴 저장소에서만) → 역할(표에서만 — 3-2a).
            lookup.gate(&slot.run)?;
            role?;
            let role = lookup.pick_role(&slot.run, &super::tools::req_text(args, "role", 64)?)?;
            if slot.run.integration.is_some() && base_arg.as_deref().is_some_and(|b| !b.trim().is_empty()) {
                return Err(bad("base is chosen by the server (integration head) — omit it"));
            }
            let Some(task) = slot.run.task(&task_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            // 술어 `owns_worktree` — Task 의 현재 Attempt 가 자원(worktree · 대화)을 아직 쥐고 있으면 새 작업자를 띄우지 않는다(`idle` 도
            // 쥔다 — 이어 시키려면 `send_prompt`, 버리려면 `stop_worker`).
            let current_live = task
                .current_attempt
                .as_deref()
                .and_then(|id| slot.run.attempts.iter().find(|a| a.id == id))
                .is_some_and(|a| a.owns_worktree());
            // 충돌한 Task 의 작업자 = 충돌 해결 Attempt(통합 설계 3b · 4-6) — 일반 텍스트 내용 충돌만. 나머지는 사람에게(반려 · 취소).
            let resolving = match (task.state, &task.conflict) {
                (TaskState::Conflict, Some(info)) if super::resolve::resolvable(info) && slot.run.integration.is_some() => {
                    if reuse_of.is_some() {
                        return Err(bad("a conflict resolution starts in a fresh worktree from the integration head — omit reuseWorktreeOf"));
                    }
                    Some(info.clone())
                }
                (TaskState::Conflict, _) => {
                    return Err(OrchError::new(
                        reason::CONFLICT_NEEDS_HUMAN,
                        format!(
                            "task {task_id} has a conflict that is not a plain text conflict (rename/delete, modify/delete, binary, mode, symlink or submodule) — a person must handle it; reject the task to start over from the integration head"
                        ),
                    ));
                }
                _ => None,
            };
            let free = match task.state {
                TaskState::Todo | TaskState::Rejected => true,
                TaskState::Active => !current_live,
                TaskState::Conflict => resolving.is_some(),
                _ => false,
            };
            if !free {
                return Err(OrchError::new(
                    reason::TASK_BUSY,
                    format!(
                        "task {task_id} is {} — it cannot get a new worker now (an idle worker of it can be continued with send_prompt, or stopped with stop_worker)",
                        task.state.as_str()
                    ),
                ));
            }
            // 되돌림 한도(E18 — 반려된 Task 에 쓰기형을 다시 띄우는 순간 · 해결자 · resume 은 세지 않는다).
            if task.state == TaskState::Rejected {
                lookup.rework_check(&slot.run, &task)?;
            }
            let reuse = match reuse_of.as_deref() {
                None => None,
                Some(of) => {
                    let r = reuse_worktree(&slot.run, &task_id, of, reuse_clean.clone())?;
                    // 지우기 · 만들기 예약 중인 자리는 이어 쓰지 않는다(리뷰 F4 — 같은 실제 경로 열쇠).
                    if slot.wt_busy.contains_key(&super::worktree::wt_key(&r.path)) {
                        return Err(OrchError::new(reason::WORKTREE_IN_USE, "that worktree is being removed right now"));
                    }
                    Some(r)
                }
            };
            // 이어 쓰면 기준은 그 worktree 의 것(새로 분기하지 않는다) — 의존 · base 규칙은 새 worktree 에만.
            let base = match (&reuse, slot.run.integration.is_some()) {
                (Some(r), _) => Base::Commit(r.base_commit.clone()),
                (None, true) => {
                    let expected = super::accept::integration_base(&slot.run, &task)?;
                    match int_head {
                        // 해결 Attempt 의 자리는 충돌을 계산한 그때의 통합 머리(`old`) — 그사이 머리가 또 움직였어도 수락 때 `mergeBase = old`
                        // 로 다시 3-way 한다(4-6). 외부 변경 검사는 똑같이 한다.
                        Some(Ok(Some(h))) if h == expected => match &resolving {
                            Some(info) => Base::Commit(info.old.clone()),
                            None => Base::Commit(h),
                        },
                        Some(Ok(_)) => {
                            // 외부 변경(통합 설계 4-5) — 자동 채택하지 않고 보류.
                            self.hold_diverged(slot, "spawn", now);
                            let h = slot.run.hold.clone();
                            self.after_change(&g, run_id);
                            return Err(match h {
                                Some(h) => super::store::on_hold(&h),
                                None => OrchError::new(reason::RUN_ON_HOLD, "the integration ref moved"),
                            });
                        }
                        Some(Err(e)) => {
                            return Err(OrchError::new(
                                reason::INTEGRATION_FAILED,
                                format!("could not read the integration ref: {e}"),
                            ))
                        }
                        None => {
                            return Err(OrchError::new(reason::INTEGRATION_FAILED, "could not read the integration ref"))
                        }
                    }
                }
                (None, false) => resolve_base(&slot.run, &task, base_arg.as_deref())?,
            };
            check_worker_slot(slot)?;
            let cli = role.cli;
            // Claude 는 서버가 대화 id 를 정한다(`--session-id`), Codex 는 첫 턴의 `thread.started` 가 고정한다(4-4).
            let session_id = (cli == WorkerCli::Claude).then(|| uuid.clone());
            slot.run.attempts.push(Attempt {
                id: attempt_id.clone(),
                task_id: task_id.clone(),
                cli,
                gen,
                state: AttemptState::Spawning,
                stream: None,
                // 이어 쓰면 처음부터 그 자리를 적는다 — 같은 worktree 를 두 번째 생성이 다시 집지 못하게(한 worktree 한 작성자).
                worktree: reuse.as_ref().map(|r| r.path.clone()),
                branch: reuse.as_ref().map(|r| r.branch.clone()),
                base_commit: reuse.as_ref().map(|r| r.base_commit.clone()),
                pid: None,
                conversation_id: session_id.clone(),
                launch_args: None,
                attention: None,
                started_at: now,
                ended_at: None,
                exit_reason: None,
                pending_recovery: None,
                conversation_changed: false,
                last_commit_rejection: None,
                resolves: resolving.as_ref().map(|i| i.job_id.clone()),
                role: AttemptRole::Worker,
                review_of: None,
                turns: Vec::new(),
                kind: Some(AttemptKind::Write),
                role_id: Some(role.id.clone()),
                role_name: Some(role.name.clone()),
                blocked: None,
                conversation_broken: false,
                stop_requested: false,
            });
            let task_now = {
                let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) else {
                    return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
                };
                t.state = TaskState::Active;
                t.current_attempt = Some(attempt_id.clone());
                t.version += 1;
                t.updated_at = now;
                t.clone()
            };
            let seq = slot.run.bump(
                now,
                Actor::Coordinator,
                if resolving.is_some() { "resolver_spawning" } else { "worker_spawning" },
                Some(&attempt_id),
                cli.as_str(),
            );
            let result = json!({
                "attemptId": attempt_id,
                "taskId": task_id,
                "role": { "id": role.id, "name": role.name, "kind": role.kind.as_str(), "cli": cli.as_str() },
                "state": AttemptState::Spawning,
                "turn": 1,
                "base": match &base {
                    Base::Main => "main".to_string(),
                    Base::Commit(c) => c.clone(),
                },
                "reusedWorktree": reuse.as_ref().map(|r| r.path.clone()),
                "resolves": resolving.as_ref().map(|i| json!({
                    "jobId": i.job_id,
                    "paths": super::resolve::conflict_paths(i),
                })),
                "latestSeq": seq,
            });
            slot.run.remember(&request_id, "spawn_worker", &super::store::request_sha(args), result.clone());
            let job = LaunchJob {
                run_id: run_id.to_string(),
                attempt_id: attempt_id.clone(),
                task: task_now,
                cli,
                repo: slot.run.repo.clone(),
                worktree_dir: slot.run.worktree_dir.clone(),
                base,
                reuse,
                token: token.clone(),
                stream: spawn::turn_claim_key(&attempt_id, 1),
                session_id,
                review: None,
                seed: resolving.as_ref().and_then(|i| {
                    Some(spawn::ResolveSeed {
                        old: i.old.clone(),
                        conflict_commit: i.conflict_commit.clone()?,
                        prompt: super::resolve::prompt_section(i),
                    })
                }),
                turn: TurnPlan {
                    n: 1,
                    resume: None,
                    text: None,
                    turn_minutes: lookup.turn_minutes(&slot.run)?,
                    role,
                },
            };
            let detail = slot
                .run
                .attempts
                .last()
                .map(|a| attempt_audit(gen, Actor::Coordinator, a))
                .unwrap_or_default();
            // 첫 턴의 작업자 토큰(턴 단위 — 그 턴의 트리 종료 확인 뒤 거둔다).
            g.tokens.push((
                token,
                Binding {
                    role: Role::Worker,
                    run_id: run_id.to_string(),
                    gen,
                    attempt_id: Some(attempt_id.clone()),
                },
            ));
            self.after_change(&g, run_id);
            (result, job, detail)
        };
        self.audit("worker_spawned", run_id, detail);
        if let Some(l) = self.launcher() {
            l.launch(job);
        }
        Ok(result)
    }

    /// 조정자 `stop_worker` — running · paused 에서 받는다(멈춤은 줄이는 쪽이라 일시정지 중에도 — 설계 C-7 의 "조율 쓰기 거절" 예외).
    /// 도는 턴이면 잡을 끝내고 확인 뒤 `stopped`, `idle` 이면 곧바로 닫는다(4-5).
    pub(super) fn stop_worker(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let attempt_id = super::tools::req_text(args, "attemptId", 64)?;
        let now = self.now();
        let (result, stop) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request_id, "stop_worker", &super::store::request_sha(args))? {
                return Ok(first);
            }
            if !matches!(slot.run.state, RunState::Running | RunState::Paused) {
                return Err(state_error(slot.run.state));
            }
            if !slot.run.attempts.iter().any(|a| a.id == attempt_id) {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no attempt {attempt_id} in this run")));
            }
            let stop = close_or_stop(slot, &attempt_id, now, Actor::Coordinator);
            let state = slot.run.attempts.iter().find(|a| a.id == attempt_id).map(|a| a.state);
            let result = json!({ "attemptId": attempt_id, "state": state, "latestSeq": slot.run.seq });
            slot.run.remember(&request_id, "stop_worker", &super::store::request_sha(args), result.clone());
            self.after_change(&g, run_id);
            (result, stop)
        };
        if stop {
            self.stop_processes(run_id, std::slice::from_ref(&attempt_id));
        }
        Ok(result)
    }

    /// 사람의 [중단](작업자 하나 — 보드). orphaned 는 읽기 전용(`run-orphaned`). `idle` 은 곧바로 닫는다.
    pub(crate) fn human_stop_worker(&self, run_id: &str, attempt_id: &str) -> Result<Value, OrchError> {
        let now = self.now();
        let stop = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).ok_or_else(super::store::not_found_run)?;
            if slot.run.state == RunState::Orphaned {
                return Err(state_error(RunState::Orphaned));
            }
            if !slot.run.attempts.iter().any(|a| a.id == attempt_id) {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no attempt {attempt_id} in this run")));
            }
            let closed = slot.run.attempts.iter().any(|a| a.id == attempt_id && a.state == AttemptState::Idle);
            let stop = close_or_stop(slot, attempt_id, now, Actor::Human);
            if stop || closed {
                self.after_change(&g, run_id);
            }
            stop
        };
        if stop {
            self.stop_processes(run_id, &[attempt_id.to_string()]);
        }
        let g = self.lock();
        let state = g
            .runs
            .get(run_id)
            .and_then(|s| s.run.attempts.iter().find(|a| a.id == attempt_id))
            .map(|a| a.state);
        Ok(json!({ "attemptId": attempt_id, "state": state }))
    }

    /// 서버 손에 멈춤을 맡긴다(잠금 밖).
    pub(super) fn stop_processes(&self, run_id: &str, attempts: &[String]) {
        if attempts.is_empty() {
            return;
        }
        if let Some(l) = self.launcher() {
            for a in attempts {
                l.stop(run_id, a);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 서버 손이 알려 오는 단계
    // -----------------------------------------------------------------------

    /// **효과 직전 확인**(헤드리스 설계 2-4 · 2-6 — 서버 손이 턴 프로세스를 띄우기 바로 전에 부른다): 지금 맡기기를 다시 읽어(잠금 밖 —
    /// 파일 · git) 블록 · 받아들인 판 · 신원(Run 사본과도 같아야 한다) · 그 Attempt 의 역할(CLI · 종류 사본)을 본다. 어긋나면 거절 낱말 — 서버
    /// 손은 그 턴을 띄우지 않는다(생성 실패). **블로킹**.
    pub(crate) fn turn_preflight(&self, run_id: &str, attempt_id: &str) -> Result<Option<(super::roles::TurnRole, u32)>, OrchError> {
        let lookup = self.run_inputs(run_id);
        let mut g = self.lock();
        let slot = g.runs.get_mut(run_id).ok_or_else(super::store::not_found_run)?;
        lookup.gate(&slot.run)?;
        let a = slot
            .run
            .attempts
            .iter()
            .find(|a| a.id == attempt_id)
            .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt"))?;
        let fresh = if a.kind.is_some() || slot.run.album.is_some() {
            let role = lookup.role_for_turn(&slot.run, a)?;
            slot.run.album.as_ref().map(|_| (role, slot.run.limits.turn_minutes))
        } else { None };
        lookup.remember(slot);
        Ok(fresh)
    }

    /// worktree 가 섰다 — 적고, 계속해도 되는가(그사이 중단됐으면 `false` — 서버 손은 프로세스를 띄우지 않는다).
    pub(crate) fn attempt_worktree(&self, run_id: &str, attempt_id: &str, path: &str, branch: &str, base: &str) -> bool {
        let now = self.now();
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return false };
        let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
            return false;
        };
        a.worktree = Some(path.to_string());
        a.branch = Some(branch.to_string());
        a.base_commit = Some(base.to_string());
        let go = a.state == AttemptState::Spawning && slot.run.state.active() && slot.run.state != RunState::Stopping;
        slot.run.bump(now, Actor::Server, "worktree_created", Some(attempt_id), branch);
        self.after_change(&g, run_id);
        go
    }

    /// 턴이 서지 못했다(worktree · MCP 파일 · 실행 파일 · 효과 직전 확인 · 생성) 또는 중단으로 띄우지 않았다 — 프로세스가 없으므로 곧바로 정한다:
    /// **첫 턴**이면 끝 상태(중단 중이었으면 `stopped`, 아니면 `exited` + 사유 — 반쯤 만든 worktree 는 Attempt 에 남는다), **이어지는 턴**이면
    /// `idle` 로 돌아간다(아무것도 전달되지 않았다 — `rejected{spawn-failed}` · 턴 기록 `failed:spawn-failed`). 그 턴의 토큰은 곧바로 거둔다.
    pub(crate) fn attempt_spawn_failed(&self, run_id: &str, attempt_id: &str, why: &str) {
        let now = self.now();
        let (detail, ended, gen) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return };
            let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
                return;
            };
            // 술어 `turn_may_live` — 생성 실패는 턴(프로세스)의 사건이다(이미 끝났으면 상태는 그대로).
            if !a.turn_may_live() {
                // 이미 끝 상태여도 작업자 토큰은 거둔다(리뷰 F13 — 생성 실패의 회수를 한 길로).
                revoke_worker(&mut g, attempt_id);
                return;
            }
            let was_stopping = a.state == AttemptState::Stopping || a.stop_requested;
            // 이어지는 턴 — 첫 턴이 대화를 고정했다(턴 기록이 있다). 아무것도 전달되지 않았으니 `idle` 로(닫히지 않는다).
            let resume = !a.turns.is_empty() && a.kind == Some(AttemptKind::Write) && !was_stopping;
            let word = short_reason(&format!("spawn-failed: {why}"));
            if resume {
                let n = a.turn_no() + 1;
                a.turns.push(TurnRecord {
                    n,
                    started_at: now,
                    ended_at: Some(now),
                    outcome: "failed".into(),
                    reason: Some("spawn-failed".into()),
                    exit_code: None,
                    denials: 0,
                    denial_kinds: Vec::new(),
                    tools: 0,
                    last_tool: None,
                    cli_version: None,
                    model: None,
                    args: TurnArgsLabel::default(),
                    anomalies: TurnAnomalies::default(),
                });
                if a.turns.len() > TURNS_KEPT {
                    let over = a.turns.len() - TURNS_KEPT;
                    a.turns.drain(..over);
                }
                a.state = AttemptState::Idle;
                a.exit_reason = Some(word);
            } else {
                a.state = if was_stopping { AttemptState::Stopped } else { AttemptState::Exited };
                a.ended_at = Some(now);
                a.attention = None;
                a.exit_reason = Some(word);
            }
            let gen = slot.run.gen;
            let detail = attempt_audit(gen, Actor::Server, a);
            let outcome = a.state.as_str();
            slot.run.bump(now, Actor::Server, "spawn_failed", Some(attempt_id), outcome);
            super::review::on_reviewer_ended(slot, attempt_id, now);
            if !was_stopping {
                self.raise(slot, "spawn-failed", Some(attempt_id), Some(&short_reason(why)));
            }
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            revoke_worker(&mut g, attempt_id);
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (detail, ended, gen)
        };
        self.audit("spawn_failed", run_id, detail);
        if ended {
            self.audit("run_ended", run_id, run_ended_detail(gen));
        }
    }

    /// 턴 프로세스가 섰다 — `running`(첫 턴은 `spawning` 에서, 이어지는 턴은 예약된 `running` 그대로). `blocked` 표지는 새 턴이 서면 지운다.
    /// 그사이 중단됐으면 [`SpawnVerdict::Reap`] — 서버 손이 곧바로 끝낸다.
    pub(crate) fn attempt_spawned(&self, run_id: &str, attempt_id: &str, pid: Option<u32>) -> SpawnVerdict {
        let now = self.now();
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return SpawnVerdict::Reap };
        let run_live = slot.run.state.active() && slot.run.state != RunState::Stopping;
        let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
            return SpawnVerdict::Reap;
        };
        a.pid = pid;
        let up = matches!(a.state, AttemptState::Spawning | AttemptState::Running) && !a.stop_requested && run_live;
        let verdict = if up {
            if a.state == AttemptState::Spawning {
                a.started_at = now;
            }
            a.state = AttemptState::Running;
            a.blocked = None;
            a.exit_reason = None;
            SpawnVerdict::Keep
        } else {
            // 술어 `turn_may_live` — 방금 선 프로세스를 거둘 것이므로 끝 상태가 아니면 중단 중으로.
            if a.turn_may_live() && a.state != AttemptState::Stopping {
                a.state = AttemptState::Stopping;
            }
            a.stop_requested = true;
            SpawnVerdict::Reap
        };
        let outcome = a.state.as_str();
        slot.run.bump(now, Actor::Server, "worker_started", Some(attempt_id), outcome);
        self.after_change(&g, run_id);
        verdict
    }

    /// 헤드리스 턴 기록(서버 손이 턴 시작(`ended` 거짓) · 끝(참)에 부른다). 시각은 이 시계가 찍는다(시작 = 처음 본 때 · 끝 = 지금). 같은 `n`
    /// 이면 고쳐 쓰고, 아니면 더한다(최근 [`TURNS_KEPT`] 개). 끝난 턴이 `conversation-mismatch` 면 대화가 끊긴 것이다(D6 — 더는 resume 하지
    /// 않는다). 판정형의 실패 턴은 `exit_reason` 을 턴 사유로 채운다(보드 · 알림 — 낱말뿐). 프롬프트 · 본문 · 토큰은 이 기록에 없다(4-8 · D11).
    pub(crate) fn attempt_turn(&self, run_id: &str, attempt_id: &str, mut rec: TurnRecord, ended: bool) {
        let now = self.now();
        let (event, detail) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return };
            let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
                return;
            };
            rec.started_at = a.turns.iter().find(|t| t.n == rec.n).map(|t| t.started_at).unwrap_or(now);
            rec.ended_at = ended.then_some(now);
            if ended && rec.outcome == "failed" && rec.reason.as_deref() == Some("conversation-mismatch") {
                a.conversation_broken = true;
            }
            if !ended || rec.outcome == "ok" {
                // 시작 · 성공 — 사유 없음.
            } else if a.exit_reason.is_none() {
                let label = match &rec.reason {
                    Some(r) if rec.outcome == "failed" => format!("turn failed:{r}"),
                    Some(r) => format!("turn {} ({r})", rec.outcome),
                    None => format!("turn {}", rec.outcome),
                };
                a.exit_reason = Some(short_reason(&label));
            }
            let outcome = rec.outcome.clone();
            let mut detail = attempt_audit(slot.run.gen, Actor::Server, a);
            detail.outcome = Some(outcome.clone());
            detail.reason = rec.reason.clone();
            detail.turn = Some(rec.n);
            detail.resume = Some(rec.args.resume);
            detail.model = rec.args.model.clone();
            detail.effort = rec.args.effort.clone();
            detail.instructions_sha = rec.args.instructions_sha.clone();
            if ended {
                detail.denials = Some(rec.denials);
            }
            let timeout = ended && rec.outcome == "timeout";
            match a.turns.iter_mut().find(|t| t.n == rec.n) {
                Some(t) => *t = rec,
                None => a.turns.push(rec),
            }
            if a.turns.len() > TURNS_KEPT {
                let over = a.turns.len() - TURNS_KEPT;
                a.turns.drain(..over);
            }
            slot.run.bump(now, Actor::Server, if ended { "turn_ended" } else { "turn_started" }, Some(attempt_id), &outcome);
            if timeout {
                self.raise(slot, "turn-timeout", Some(attempt_id), None);
            }
            self.after_change(&g, run_id);
            (if ended { "turn_ended" } else { "turn_started" }, detail)
        };
        self.audit(event, run_id, detail);
    }

    /// **도는 턴의 진행 칸**(F4 — 서버 손이 턴 도중 Attempt 마다 2초에 한 번까지 부른다 · `turn::ProgressGate`). 아직 끝나지 않은 그 턴(`n` ·
    /// `ended_at` 없음)의 도구 수 · 거절 · 마지막 도구 · 모델 · CLI 판만 고치고, 바뀌었으면 이벤트 [`super::store::EVT_PROGRESS`] 하나를 낸다.
    ///
    /// **seq 를 올리지 않고 · 쓰기 줄에 넣지 않고 · `wait_run` 을 깨우지 않는다** — 조정자가 진행마다 깨지 않게, 2초마다 Run 파일을 다시 쓰지
    /// 않게. 메모리의 칸은 다음 진짜 사건의 스냅숏에 함께 실려도 되고(낱말 · 수만), 최종값은 턴 기록 끝([`Self::attempt_turn`])이 쓴다. 감사 줄 없음.
    pub(crate) fn attempt_turn_progress(&self, run_id: &str, attempt_id: &str, n: u32, p: &super::turn::TurnProgress) {
        let g = &mut *self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return };
        let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
            return;
        };
        let Some(t) = a.turns.iter_mut().find(|t| t.n == n && t.ended_at.is_none()) else {
            return; // 이미 끝난 턴(늦은 진행) — 최종값을 덮지 않는다.
        };
        let kinds: Vec<String> = p.denial_kinds.iter().map(|k| k.to_string()).collect();
        let next = (p.tools, p.denials, &kinds, p.last_tool.as_ref(), p.model.as_ref(), p.cli_version.as_ref());
        if next == (t.tools, t.denials, &t.denial_kinds, t.last_tool.as_ref(), t.model.as_ref(), t.cli_version.as_ref()) {
            return;
        }
        t.tools = p.tools;
        t.denials = p.denials;
        t.denial_kinds = kinds;
        t.last_tool = p.last_tool.clone();
        t.model = p.model.clone();
        t.cli_version = p.cli_version.clone();
        (self.emit)(super::store::EVT_PROGRESS, json!({ "runId": run_id, "attemptId": attempt_id, "turn": n }));
    }

    /// 대화를 고정한다(Codex 첫 턴 — 서버가 띄운 프로세스의 stdout `thread.started` 가 알린 id · 4-4 E8). 이미 고정돼 있으면 같아야 한다 —
    /// 다르면 대화가 끊긴 것이다(D6). Claude 는 서버가 정한 `--session-id` 로 이미 고정돼 있다. 서버 손은 이것을 **턴 도중**(init 확인을 지난
    /// 순간 — F4) 한 번, 턴 끝에 한 번 부른다(두 번째는 같은 값 확인). seq 를 올리지 않는다(`wait_run` 조건에 닿지 않는다 — 영속 · 이벤트만).
    pub(crate) fn attempt_conversation(&self, run_id: &str, attempt_id: &str, conversation: &str) {
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return };
        let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
            return;
        };
        match a.conversation_id.as_deref() {
            None => a.conversation_id = Some(conversation.to_string()),
            Some(c) if c == conversation => return,
            Some(_) => a.conversation_broken = true,
        }
        self.after_change(&g, run_id);
    }

    /// 턴 프로세스가 끝났다. `confirmed` = 트리(잡 · 파이프 EOF)까지 사라졌다. 헤드리스(3a):
    /// - 확인 안 됨 → `stop-unconfirmed`(산 것으로 센다 · 토큰 유지 — 서버 시계가 다시 본다).
    /// - 확인됨 + 중단을 청했음 → `stopped`(닫힘).
    /// - 확인됨 + 자연 끝 → 쓰기형: 그 Attempt 의 보고가 있으면 `reported`(닫힘) · 없으면 `idle`(열림 — `blocked` 표지가 있을 수 있다).
    ///   판정형: 판정이 있으면 `reported` · 없으면 `exited`(종결 · 활성 검토 비움 — `reviewer-exited`).
    ///
    /// 확인되면 그 턴의 작업자 토큰을 거둔다(턴 단위). PTY(옛 파일)는 옛 길 그대로.
    pub(crate) fn attempt_process_exited(&self, run_id: &str, attempt_id: &str, confirmed: bool, exit_code: Option<u32>) {
        let now = self.now();
        let (detail, event, ended, gen) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return };
            let Some(a) = slot.run.attempts.iter().find(|a| a.id == attempt_id) else {
                return;
            };
            let headless = a.exec_mode() == ExecMode::Headless;
            let is_reviewer = a.is_reviewer();
            let has_report = slot.run.reports.iter().any(|r| r.attempt_id == attempt_id);
            let has_verdict = slot.run.review_reports.iter().any(|r| r.attempt_id == attempt_id);
            let reported = a.state == AttemptState::Reported || has_report || has_verdict;
            // 술어 `turn_may_live` — 종료 감시는 턴(프로세스) 수명의 사건이다(이미 끝 상태면 무시).
            let live = a.turn_may_live();
            if !live {
                return;
            }
            let stopping = matches!(a.state, AttemptState::Stopping) || a.stop_requested
                || (!headless && a.state == AttemptState::StopUnconfirmed);
            let (state, event) = if headless {
                match (confirmed, stopping) {
                    (false, _) => (AttemptState::StopUnconfirmed, "stop_unconfirmed"),
                    (true, true) => (AttemptState::Stopped, "worker_stopped"),
                    (true, false) if is_reviewer => {
                        if has_verdict {
                            (AttemptState::Reported, "reviewer_turn_ended")
                        } else {
                            (AttemptState::Exited, "worker_exited")
                        }
                    }
                    (true, false) if has_report => (AttemptState::Reported, "worker_turn_ended"),
                    (true, false) => (AttemptState::Idle, "worker_idle"),
                }
            } else {
                match (stopping, confirmed) {
                    (true, true) => (AttemptState::Stopped, "worker_stopped"),
                    (true, false) => (AttemptState::StopUnconfirmed, "stop_unconfirmed"),
                    (false, true) => (AttemptState::Exited, "worker_exited"),
                    (false, false) => (AttemptState::ExitUnconfirmed, "exit_unconfirmed"),
                }
            };
            let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) else {
                return;
            };
            if a.state == state {
                return;
            }
            a.state = state;
            let unconfirmed = matches!(state, AttemptState::StopUnconfirmed | AttemptState::ExitUnconfirmed);
            if unconfirmed {
                a.attention = Some(state.as_str().into());
            } else {
                a.attention = None;
                if state != AttemptState::Idle {
                    a.ended_at = Some(now);
                }
            }
            if matches!(state, AttemptState::Exited | AttemptState::ExitUnconfirmed) && a.exit_reason.is_none() {
                a.exit_reason = Some(match exit_code {
                    Some(c) => format!("exit {c}"),
                    None => "exit".into(),
                });
            }
            let blocked = state == AttemptState::Idle && a.blocked.is_some();
            let gen = slot.run.gen;
            let detail = attempt_audit(gen, Actor::Server, a);
            slot.run.bump(now, Actor::Server, event, Some(attempt_id), state.as_str());
            // 판정 없이 끝난 검토자는 Task 의 활성 검토 자리를 비운다(5단계 — 다음 검토가 막히지 않게).
            super::review::on_reviewer_ended(slot, attempt_id, now);
            // 감독 사건(리뷰 F11) — 미확인 · 보고 없이 끝남은 사람이 볼 일이다(보고한 작업자의 정상 종료 · `blocked` 는 보고 때 이미 알렸다).
            match state {
                AttemptState::StopUnconfirmed | AttemptState::ExitUnconfirmed => {
                    self.raise(slot, "exit-unconfirmed", Some(attempt_id), Some(state.as_str()))
                }
                AttemptState::Exited if !reported => {
                    let kind = if is_reviewer { "reviewer-exited" } else { "worker-exited" };
                    self.raise(slot, kind, Some(attempt_id), None)
                }
                AttemptState::Idle if !blocked => self.raise(slot, "worker-idle", Some(attempt_id), None),
                _ => {}
            }
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            if !unconfirmed {
                // 턴 단위 토큰(D9) — 그 턴의 트리 종료가 확인됐다.
                revoke_worker(&mut g, attempt_id);
            }
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (detail, event, ended, gen)
        };
        self.audit(event, run_id, detail);
        if ended {
            self.audit("run_ended", run_id, run_ended_detail(gen));
        }
    }

    /// 종료 미확인 Attempt 를 다시 본다(서버 시계) — `stop-unconfirmed` · (옛) `exit-unconfirmed`, 그리고 프로세스가 이미 끝났는데 `stopping`
    /// 으로 남은 것(미확인 자연 종료 뒤 사람이 중단을 눌렀다). 트리가 사라졌으면 그 판정을 마저 한다. 바뀐 수.
    pub(crate) fn recheck_unconfirmed(&self) -> usize {
        let Some(l) = self.launcher() else { return 0 };
        let list: Vec<(String, String)> = {
            let g = self.lock();
            g.runs
                .iter()
                .flat_map(|(rid, s)| {
                    s.run
                        .attempts
                        .iter()
                        .filter(|a| {
                            matches!(a.state, AttemptState::StopUnconfirmed | AttemptState::ExitUnconfirmed)
                                || (a.state == AttemptState::Stopping && l.exited(&a.id))
                        })
                        .map(move |a| (rid.clone(), a.id.clone()))
                })
                .collect()
        };
        let mut n = 0;
        for (run, att) in list {
            if l.tree_gone(&att) {
                self.attempt_process_exited(&run, &att, true, None);
                n += 1;
            }
        }
        n
    }

    /// worktree op 층이 쓰는 Run 의 저장소 · worktree 자리(살아 있든 orphaned 든 — 사람의 정리는 orphaned 에도 된다).
    pub(crate) fn run_paths(&self, run_id: &str) -> Result<(String, String), OrchError> {
        let g = self.lock();
        let s = g.runs.get(run_id).ok_or_else(super::store::not_found_run)?;
        Ok((s.run.repo.clone(), s.run.worktree_dir.clone()))
    }

    /// 이 worktree 를 지금 쓰는(자원을 쥔) Attempt 가 있나(시험 — 지우기는 [`claim_worktree`] 가 같은 판정을 쓴다).
    #[cfg(test)]
    pub(crate) fn worktree_in_use(&self, run_id: &str, path: &str) -> bool {
        let want = super::worktree::wt_key(path);
        let g = self.lock();
        g.runs.get(run_id).is_some_and(|s| worktree_used(s, &want))
    }

    /// 사람의 worktree 지우기(GUI op — `ops::wt_remove`) 앞 — 같은 실제 경로 열쇠로 "쓰는 중" 과 다른 예약을 보고 `removing` 을 세운다
    /// (리뷰 F4). 돌려준 열쇠로 [`Orchestration::end_worktree_claim`].
    pub(crate) fn begin_worktree_removal(&self, run_id: &str, path: &str) -> Result<String, OrchError> {
        let key = super::worktree::wt_key(path);
        let mut g = self.lock();
        let slot = g.runs.get_mut(run_id).ok_or_else(super::store::not_found_run)?;
        claim_worktree(slot, &key, "removing")?;
        Ok(key)
    }

    /// worktree 자리 예약을 푼다.
    pub(crate) fn end_worktree_claim(&self, run_id: &str, key: &str) {
        if let Some(slot) = self.lock().runs.get_mut(run_id) {
            slot.wt_busy.remove(key);
        }
    }

    // (3차 6단계) Attempt worktree 목록(옛 op `orchestration_wt_list` · 조정자 `list_worktrees`)은 걷었다 — 보드는 Run 상세의 Attempt 칸을,
    // [정리]는 `cleanup_preview` 를 본다.

    /// 사람의 worktree 지우기 뒤 — Attempt 의 worktree 칸을 비운다(사건 하나).
    pub(crate) fn note_worktree_removed(&self, run_id: &str, path: &str) {
        let now = self.now();
        let want = super::worktree::wt_key(path);
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return };
        let ids: Vec<String> = slot
            .run
            .attempts
            .iter()
            .filter(|a| a.worktree.as_deref().is_some_and(|w| super::worktree::wt_key(w) == want))
            .map(|a| a.id.clone())
            .collect();
        for id in &ids {
            if let Some(a) = slot.run.attempts.iter_mut().find(|a| &a.id == id) {
                a.worktree = None;
            }
            slot.run.bump(now, Actor::Human, "worktree_removed", Some(id), "removed");
        }
        slot.leftovers.retain(|l| l.get("worktree").and_then(Value::as_str).map(super::worktree::wt_key).as_deref() != Some(want.as_str()));
        if slot.run.state == RunState::Orphaned {
            // orphaned 는 파일을 다시 쓰지 않는다(읽기 전용) — 화면만 깨운다.
            (self.emit)(super::store::EVT_CHANGED, json!({ "runId": run_id, "seq": slot.run.seq }));
            self.changed.notify_all();
        } else if !ids.is_empty() {
            self.after_change(&g, run_id);
        }
    }
}

/// 이 worktree 열쇠(`worktree::wt_key`)를 지금 쓰는 Attempt 가 있나. orphaned Run(서버 재시작 뒤)의 Attempt 상태는 옛 서버의 마지막
/// 기록이라 그 프로세스가 **실제로** 살아 있을 때만 쓰는 중으로 본다(리뷰 F12 — 영속 상태와 지금의 잔존 프로세스를 나눈다).
pub(super) fn worktree_used(slot: &Slot, key: &str) -> bool {
    let orphaned = slot.run.state == RunState::Orphaned;
    slot.run.attempts.iter().any(|a| {
        // 술어 `owns_worktree`(4-5 표 — 사람 [정리] 거절: `idle` 도 자기 worktree 를 쥔다). orphaned 는 판마다 갈린 잔존 판정.
        let may_live = if orphaned { leftover_process_alive(a) } else { a.owns_worktree() };
        may_live && a.worktree.as_deref().is_some_and(|w| super::worktree::wt_key(w) == key)
    })
}

/// worktree 자리 예약(리뷰 F4) — 쓰는 중이거나 다른 지우기 · 만들기가 예약했으면 `worktree-in-use`. 잠금 안에서 부른다.
pub(super) fn claim_worktree(slot: &mut Slot, key: &str, what: &'static str) -> Result<(), OrchError> {
    if worktree_used(slot, key) {
        return Err(OrchError::new(
            reason::WORKTREE_IN_USE,
            "a worker of this run still holds that worktree (running or idle) — stop it first",
        ));
    }
    if let Some(other) = slot.wt_busy.get(key) {
        return Err(OrchError::new(
            reason::WORKTREE_IN_USE,
            format!("that worktree is being {} right now — try again in a moment", if *other == "removing" { "removed" } else { "created" }),
        ));
    }
    slot.wt_busy.insert(key.to_string(), what);
    Ok(())
}

fn run_ended_detail(gen: u32) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: Actor::Server.as_str().into(),
        run_state: Some(RunState::Stopped.as_str().into()),
        ..Default::default()
    }
}

/// 기준 고르기(설계 B 의존성 규칙 · 4단계) — `dependsOn` 이 전부 accepted 여야 한다(`dependency-not-accepted`).
/// - 의존 없음: main(`base` 는 `"main"` 만 — 선행 Task id 는 거절).
/// - 의존 **하나**: 그 선행의 **유효한** `AcceptedArtifact.commitOid`(거둔 수락은 아니다). `base` 인자와 어긋나도 **의존이 이긴다**.
/// - 의존 **여럿**: 자동 분기하지 않고 `needs-merge` — 사람이 병합한 뒤 조정자가 `base: "main"` 을 줄 때만 main 에서(보드가 안내).
fn resolve_base(run: &Run, task: &Task, base: Option<&str>) -> Result<Base, OrchError> {
    for d in &task.depends_on {
        if run.task(d).map(|t| t.state) != Some(TaskState::Accepted) {
            return Err(OrchError::new(
                reason::DEPENDENCY_NOT_ACCEPTED,
                format!("dependency {d} is not accepted yet"),
            ));
        }
    }
    let base = base.map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = base {
        if b != "main" && !is_id("task", b) {
            return Err(bad("base must be main or one of this task's dependencies"));
        }
        if b != "main" && !task.depends_on.iter().any(|d| d == b) {
            return Err(bad("base must be main or one of this task's dependencies"));
        }
    }
    match task.depends_on.as_slice() {
        [] => Ok(Base::Main),
        [one] => run
            .valid_artifact(one)
            .map(|a| Base::Commit(a.commit_oid.clone()))
            .ok_or_else(|| {
                OrchError::new(
                    reason::DEPENDENCY_NOT_ACCEPTED,
                    format!("task {one} has no valid accepted commit to start from"),
                )
            }),
        _ if base == Some("main") => Ok(Base::Main),
        _ => Err(OrchError::new(
            reason::NEEDS_MERGE,
            "this task depends on several tasks — a person must merge their accepted commits first, then call spawn_worker with base: \"main\"",
        )),
    }
}

/// 이어 쓸 worktree(`spawn_worker{reuseWorktreeOf}`) — **같은 Task 의 앞 Attempt** 이고, 그 Attempt 가 **닫혔고**(자원을 놓았다 — 아니면
/// `worktree-in-use` · `idle` 은 쥐고 있다), worktree 가 남아 있고, 그 worktree 를 쥔 Attempt 가 없고, **깨끗할 때만**(미커밋 없음 —
/// `worktree-dirty`). `clean` 은 잠금 밖에서 읽은 git 결과(없으면 worktree 가 없는 것).
fn reuse_worktree(run: &Run, task_id: &str, of: &str, clean: Option<Result<bool, String>>) -> Result<spawn::Reuse, OrchError> {
    let prev = run
        .attempts
        .iter()
        .find(|a| a.id == of)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no attempt {of} in this run")))?;
    if prev.task_id != task_id || prev.is_reviewer() {
        return Err(bad("reuseWorktreeOf must be an earlier worker attempt of the same task"));
    }
    // 술어 `owns_worktree`(4-5 표 — `reuseWorktreeOf` 는 소유자 없는 깨끗한 worktree 만): 앞 Attempt 가 아직 쥐고 있으면 안 된다.
    if prev.owns_worktree() {
        return Err(OrchError::new(
            reason::WORKTREE_IN_USE,
            format!("attempt {of} still holds its worktree (running or idle) — stop it first (stop_worker) and wait until it is stopped"),
        ));
    }
    let (Some(path), Some(branch)) = (prev.worktree.clone(), prev.branch.clone()) else {
        return Err(OrchError::new(reason::NOT_FOUND, format!("attempt {of} has no worktree to reuse")));
    };
    let want = super::worktree::wt_key(&path);
    // 같은 술어 `owns_worktree` — 그 worktree 를 쥔 다른 Attempt 도 없어야 한다.
    if run.attempts.iter().any(|a| {
        a.owns_worktree() && a.worktree.as_deref().is_some_and(|w| super::worktree::wt_key(w) == want)
    }) {
        return Err(OrchError::new(reason::WORKTREE_IN_USE, "another worker already uses that worktree"));
    }
    match clean {
        Some(Ok(true)) => {}
        Some(Ok(false)) => {
            return Err(OrchError::new(
                reason::WORKTREE_DIRTY,
                "that worktree has uncommitted changes (or no commit) — it can be reused only when clean",
            ))
        }
        Some(Err(e)) => return Err(OrchError::new(reason::WORKTREE_FAILED, format!("could not read that worktree: {e}"))),
        None => return Err(OrchError::new(reason::NOT_FOUND, format!("attempt {of} has no worktree to reuse"))),
    }
    let base_commit = prev
        .base_commit
        .clone()
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("attempt {of} has no base commit")))?;
    Ok(spawn::Reuse {
        path,
        branch,
        base_commit,
    })
}

#[cfg(test)]
impl Orchestration {
    /// 시험(서버 손 — `server::workers`) — Run 하나 · Task 하나 · Claude 작업자 하나를 세운다(꽂힌 서버 손에 맡긴다). 맡기기는 시험용 역할
    /// 표(`super::test_album`)로 꽂는다. Run id.
    pub(crate) fn test_spawn_one(&self) -> String {
        super::test_album::delegate_all(self);
        let run = self
            .start_run(super::store::StartRun {
                verify: None,
                name: "test".into(),
                repo: "C:/repo".into(),
                worktree_dir: "C:/repo-wt".into(),
                limits: Limits::default(),
            })
            .unwrap()
            .0;
        let c = self.coordinator_caller(&run).unwrap();
        let task = self
            .call_tool(&c, "create_task", Some(&json!({ "requestId": "t", "title": "T", "goal": "g" })))
            .unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        self.call_tool(&c, "spawn_worker", Some(&json!({ "requestId": "s", "taskId": task, "role": super::test_album::WRITER })))
            .unwrap();
        run
    }
}
