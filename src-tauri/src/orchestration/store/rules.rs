//! 잠금 안에서 쓰는 판정 조각 — 모두 부른 쪽이 쥔 잠금 하나 안에서 돈다(자기 잠금 없음).

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::{reason, Inner, OrchError, Slot, MINUTE_MS};
use crate::orchestration::model::*;

pub(super) fn no_randomness() -> OrchError {
    OrchError::new(reason::INTERNAL, "no randomness source")
}

pub(in crate::orchestration) fn not_found_run() -> OrchError {
    OrchError::new(reason::NOT_FOUND, "no such run")
}

/// orphaned 는 읽기 전용이라 바꾸는 사람 명령은 모두 `run-orphaned`.
pub(in crate::orchestration) fn human_slot<'g>(g: &'g mut Inner, run_id: &str) -> Result<&'g mut Slot, OrchError> {
    let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
    if slot.run.state == RunState::Orphaned {
        return Err(state_error(RunState::Orphaned));
    }
    Ok(slot)
}

pub(in crate::orchestration) fn state_error(s: RunState) -> OrchError {
    match s {
        RunState::Paused => OrchError::new(
            reason::RUN_PAUSED,
            "a person paused this run — call wait_run until it is running again, then retry with the same requestId",
        ),
        RunState::Stopping | RunState::Stopped | RunState::Done => {
            OrchError::new(reason::RUN_STOPPED, format!("the run is {} — nothing more can be changed", s.as_str()))
        }
        RunState::Orphaned => OrchError::new(
            reason::RUN_ORPHANED,
            "this run was loaded after a session server restart and is read-only",
        ),
        RunState::Running => OrchError::new(reason::INVALID_STATE, "the run is running"),
    }
}

/// 보류로 멈춘 Run 은 `run-on-hold` — 재개를 기다려도 풀리지 않는다(사람이 푼다).
pub(in crate::orchestration) fn writable(run: &Run) -> Result<(), OrchError> {
    if run.state == RunState::Running {
        Ok(())
    } else if let (RunState::Paused, Some(h)) = (run.state, &run.hold) {
        Err(on_hold(h))
    } else {
        Err(state_error(run.state))
    }
}

pub(in crate::orchestration) fn on_hold(h: &RunHold) -> OrchError {
    OrchError::new(
        reason::RUN_ON_HOLD,
        format!(
            "the run is on hold ({}) — a person must resolve it on the album page before anything continues",
            h.reason.as_str()
        ),
    )
}

pub(in crate::orchestration) fn conflict(task: &Task) -> OrchError {
    OrchError::new(
        reason::CONFLICT,
        format!(
            "task {} is at version {} — read it again with get_run and retry with that version",
            task.id, task.version
        ),
    )
}

/// 끝나지 않은 통합 작업 · 살아 있는 검증 트리도 stopped 를 막는다.
pub(in crate::orchestration) fn settle_stopping(slot: &mut Slot, now: u64) -> bool {
    if slot.run.state != RunState::Stopping
        || slot.run.live_attempts() > 0
        || slot.reserved_workers > 0
        || slot.run.live_jobs() > 0
        || slot.verify_trees > 0
    {
        return false;
    }
    slot.run.state = RunState::Stopped;
    slot.run.ended_at = Some(now);
    slot.run.bump(now, Actor::Server, "run_ended", None, RunState::Stopped.as_str());
    true
}

pub(in crate::orchestration) fn admit_call(slot: &mut Slot, now: u64) -> Result<(), OrchError> {
    while slot.calls.front().is_some_and(|&t| t + MINUTE_MS <= now) {
        slot.calls.pop_front();
    }
    let max = slot.run.limits.max_calls_per_minute as usize;
    if slot.calls.len() >= max {
        return Err(OrchError::new(
            reason::RATE_LIMITED,
            format!("at most {max} coordination calls per minute — slow down (wait_run blocks instead of polling)"),
        ));
    }
    slot.calls.push_back(now);
    Ok(())
}

/// `gen` · `version` 을 해시에서 빼는 것은 의도다 — `adopt_run` 뒤 새 세대의 재시도 · 다시 읽은 새 version 의 재시도도 같은 호출이라
/// 처음 결과를 받아야 한다(넣으면 그 재시도가 `request-id-reused` 가 되거나 쓰기를 두 번 한다).
pub(in crate::orchestration) fn request_sha(args: Option<&Value>) -> String {
    let mut input = args.cloned().unwrap_or(Value::Null);
    if let Some(o) = input.as_object_mut() {
        for k in ["requestId", "runId", "gen", "version"] {
            o.remove(k);
        }
    }
    crate::chat_token::input_sha(&input)
}

/// 해시 없는 옛 영속 기록은 도구만 맞춘다. 처음 보는 id 면 `None` — 잠금 밖에서 효과를 내는 도구는 효과 전에 [`reserve_request`] 해야 한다.
pub(in crate::orchestration) fn request_seen(
    slot: &Slot,
    request_id: &str,
    tool: &str,
    input_sha: &str,
) -> Result<Option<Value>, OrchError> {
    let reused = || {
        OrchError::new(
            reason::REQUEST_ID_REUSED,
            format!("requestId {request_id} was already used with a different input — use a new requestId for a different call"),
        )
    };
    if let Some(e) = slot.run.requests.iter().find(|e| e.request_id == request_id) {
        if e.tool != tool || e.input_sha.as_deref().is_some_and(|s| s != input_sha) {
            return Err(reused());
        }
        return Ok(Some(e.result.clone()));
    }
    if let Some((t, s)) = slot.pending_requests.get(request_id) {
        if *t != tool || s != input_sha {
            return Err(reused());
        }
        return Err(OrchError::new(
            reason::REQUEST_IN_PROGRESS,
            "the first call with this requestId is still running — call again later with the same requestId to read its result",
        ));
    }
    Ok(None)
}

pub(in crate::orchestration) fn reserve_request(slot: &mut Slot, request_id: &str, tool: &'static str, input_sha: &str) {
    slot.pending_requests.insert(request_id.to_string(), (tool, input_sha.to_string()));
}

pub(in crate::orchestration) fn release_request(slot: &mut Slot, request_id: &str) {
    slot.pending_requests.remove(request_id);
}

/// `this` 는 바꾸는 Task(새 Task 면 그 id).
pub(in crate::orchestration) fn check_dependencies(run: &Run, this: &str, deps: &[String]) -> Result<(), OrchError> {
    for d in deps {
        if d == this {
            return Err(OrchError::new(reason::DEPENDENCY_CYCLE, format!("task {this} cannot depend on itself")));
        }
        if run.task(d).is_none() {
            return Err(OrchError::new(reason::UNKNOWN_DEPENDENCY, format!("no task {d} in this run")));
        }
    }
    let mut edges: HashMap<&str, Vec<&str>> = HashMap::new();
    for t in &run.tasks {
        if t.id != this {
            edges.insert(t.id.as_str(), t.depends_on.iter().map(String::as_str).collect());
        }
    }
    edges.insert(this, deps.iter().map(String::as_str).collect());
    fn visit<'a>(
        n: &'a str,
        edges: &HashMap<&'a str, Vec<&'a str>>,
        grey: &mut HashSet<&'a str>,
        black: &mut HashSet<&'a str>,
    ) -> bool {
        if black.contains(n) {
            return false;
        }
        if !grey.insert(n) {
            return true;
        }
        for &m in edges.get(n).map(Vec::as_slice).unwrap_or(&[]) {
            if visit(m, edges, grey, black) {
                return true;
            }
        }
        grey.remove(n);
        black.insert(n);
        false
    }
    let mut grey = HashSet::new();
    let mut black = HashSet::new();
    let nodes: Vec<&str> = edges.keys().copied().collect();
    for n in nodes {
        if visit(n, &edges, &mut grey, &mut black) {
            return Err(OrchError::new(
                reason::DEPENDENCY_CYCLE,
                format!("dependsOn of task {this} would make a dependency cycle"),
            ));
        }
    }
    Ok(())
}
