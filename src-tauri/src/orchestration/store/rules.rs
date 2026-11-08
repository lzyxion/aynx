//! 잠금 안에서 쓰는 **판정 조각** — Run 찾기 · 상태 거절 낱말 · 쓰기 가능 · 보류 · 버전 충돌 · stopping → stopped · 분당 호출 한도 ·
//! Run 단위 요청 기록(멱등 · 진행 중) · 의존성(없는 id · 순환). 모두 부른 쪽이 쥔 잠금 하나 안에서 돈다(자기 잠금 없음).
//! `store.rs` 에서 그대로 옮겼다.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::{reason, Inner, OrchError, Slot, MINUTE_MS};
use crate::orchestration::model::*;

// ---------------------------------------------------------------------------
// 잠금 안에서 쓰는 작은 조각들
// ---------------------------------------------------------------------------

pub(super) fn no_randomness() -> OrchError {
    OrchError::new(reason::INTERNAL, "no randomness source")
}

pub(in crate::orchestration) fn not_found_run() -> OrchError {
    OrchError::new(reason::NOT_FOUND, "no such run")
}

/// 사람 명령의 Run 찾기 — orphaned 는 읽기 전용이라 바꾸는 명령은 모두 `run-orphaned`.
pub(in crate::orchestration) fn human_slot<'g>(g: &'g mut Inner, run_id: &str) -> Result<&'g mut Slot, OrchError> {
    let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
    if slot.run.state == RunState::Orphaned {
        return Err(state_error(RunState::Orphaned));
    }
    Ok(slot)
}

/// 상태 때문에 할 수 없다 — 상태에 맞는 낱말로.
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

/// 조율 쓰기를 받을 수 있는가 — running 만. 보류로 멈춘 Run 은 `run-on-hold`(재개를 기다려도 풀리지 않는다 — 사람이 푼다).
pub(in crate::orchestration) fn writable(run: &Run) -> Result<(), OrchError> {
    if run.state == RunState::Running {
        Ok(())
    } else if let (RunState::Paused, Some(h)) = (run.state, &run.hold) {
        Err(on_hold(h))
    } else {
        Err(state_error(run.state))
    }
}

/// 보류 거절(통합 설계 4-5).
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

/// stopping 이고 살아 있을 수 있는 작업자 · 예약 · **끝나지 않은 통합 작업 · 살아 있는 검증 트리**(통합 설계 5-3 · R9)가 없으면
/// stopped 로 — 넘어갔으면 `true`.
pub(in crate::orchestration) fn settle_stopping(slot: &mut Slot, now: u64) -> bool {
    // 술어 `turn_may_live`(`live_attempts` — 4-5 표 "Run stopping → stopped 판정"): stopped 는 도는 턴(프로세스)이 0 일 때만.
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

/// 분당 호출 한도 — 60초 창에서 예약한다(넘으면 거절 · 세지 않는다).
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

/// **Run 단위 요청 기록의 입력 해시**(F6) — 인자를 정규화한 글자의 SHA-256(`chat_token::input_sha` 그대로 — 열쇠 순서와 무관). 해시에서 빼는 칸:
/// - `requestId` — 기록의 열쇠 자신.
/// - `runId` — 기록이 이미 Run 마다다(다른 Run 의 같은 id 는 애초에 다른 기록) — 넣어도 뜻이 같아 뺀다.
/// - `gen` — 조정자 세대. `adopt_run` 으로 세대가 바뀐 뒤 새 조정자가 응답을 잃은 요청을 **같은 requestId 로 다시 보내면** gen 만 다르다 —
///   같은 호출의 재시도이므로 처음 결과가 맞다(옛 세대의 쓰기를 두 번 하지 않는다). 세대를 넣으면 그 재시도가 `request-id-reused` 가 된다.
/// - `version` — Task 의 낙관적 동시성 표(`update_task`). 응답을 잃은 조정자가 `get_run` 으로 다시 읽고 **새 version 으로 같은 요청을** 보내도
///   같은 호출이다(처음 효과가 version 을 올렸으니 다시 읽으면 늘 달라진다). 뜻(제목 · 상태 · 의존 …)은 다른 칸이 말한다.
///
/// 나머지 칸(제목 · 지시 글 · taskId · state · 역할 …)은 모두 넣는다 — 뜻이 다른 호출은 해시가 달라 `request-id-reused` 로 거절된다.
pub(in crate::orchestration) fn request_sha(args: Option<&Value>) -> String {
    let mut input = args.cloned().unwrap_or(Value::Null);
    if let Some(o) = input.as_object_mut() {
        for k in ["requestId", "runId", "gen", "version"] {
            o.remove(k);
        }
    }
    crate::chat_token::input_sha(&input)
}

/// **Run 단위 요청 기록**(리뷰 F9) — `requestId` 하나는 Run 안에서 요청 하나다. 끝난 요청(`run.requests`)이면 처음 결과, 아직 효과를 내는
/// 중(`pending_requests`)이면 `request-in-progress`, 다른 도구 · 다른 입력(F6 — [`request_sha`])이 쓴 id 면 `request-id-reused`(타일 단위 기록과
/// 같은 낱말 · 같은 문장 꼴). 해시 없는 옛 기록(F6 전의 영속 파일)은 도구만 맞춘다. 처음 보는 id 면 `None`(부른 쪽이 효과 전에
/// [`reserve_request`] 하거나 — 잠금 하나 안에서 끝나는 도구는 — 그대로 진행해 `remember` 한다).
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

/// 효과 전 예약(잠금 안) — 끝나면 [`release_request`](결과는 `remember`).
pub(in crate::orchestration) fn reserve_request(slot: &mut Slot, request_id: &str, tool: &'static str, input_sha: &str) {
    slot.pending_requests.insert(request_id.to_string(), (tool, input_sha.to_string()));
}

pub(in crate::orchestration) fn release_request(slot: &mut Slot, request_id: &str) {
    slot.pending_requests.remove(request_id);
}

/// 의존성 검사 — 없는 id 는 `unknown-dependency`, 순환은 `dependency-cycle`. `this` 는 바꾸는 Task(새 Task 면 그 id).
/// 같은 잠금 안에서 부른다(설계 B — DFS, Task 50 개라 충분).
pub(in crate::orchestration) fn check_dependencies(run: &Run, this: &str, deps: &[String]) -> Result<(), OrchError> {
    for d in deps {
        if d == this {
            return Err(OrchError::new(reason::DEPENDENCY_CYCLE, format!("task {this} cannot depend on itself")));
        }
        if run.task(d).is_none() {
            return Err(OrchError::new(reason::UNKNOWN_DEPENDENCY, format!("no task {d} in this run")));
        }
    }
    // 그래프 — 바꾸는 Task 의 간선만 새 것으로 갈아 끼우고 전체를 DFS(세 색).
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
            return true; // 돌아왔다 — 순환
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
