//! Run 의 보기 — 조정자 `get_run` · `wait_run` 과 사람 보드가 함께 쓴다. 토큰 · 멱등 기록을 싣지 않는다.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{not_found_run, OrchError, Orchestration, Slot, MINUTE_MS};
use crate::orchestration::model::*;

impl Orchestration {
    pub(crate) fn snapshot(&self) -> Value {
        let now = self.now();
        let rows: Vec<(Value, Vec<String>)> = {
            let g = self.lock();
            let mut runs: Vec<&Slot> = g.runs.values().collect();
            runs.sort_by_key(|s| std::cmp::Reverse(s.run.created_at));
            runs.into_iter()
                .map(|s| {
                    let mut v = summary(s);
                    if let Some(o) = v.as_object_mut() {
                        // `adopt_run` 과 같은 함수여야 한다 — 화면과 도구의 판정이 갈리지 않게.
                        o.insert("adoptable".into(), super::super::start::adopt_verdict(s, now).view());
                    }
                    (v, ended_worktrees(s))
                })
                .collect()
        };
        // 디스크는 잠금 밖에서 본다.
        Value::Array(
            rows.into_iter()
                .map(|(mut v, paths)| {
                    if let Some(o) = v.as_object_mut() {
                        o.insert("worktreesLeft".into(), json!(super::cleanup::worktrees_left(&paths)));
                    }
                    v
                })
                .collect(),
        )
    }

    pub(crate) fn run_detail(&self, run_id: &str) -> Result<Value, OrchError> {
        let now = self.now();
        let g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
        Ok(view(slot, now, true))
    }

    /// 블로킹(파일 · git).
    pub(crate) fn run_detail_fresh(&self, run_id: &str) -> Result<Value, OrchError> {
        let lookup = self.run_inputs(run_id);
        let paths = match self.lock().runs.get_mut(run_id) {
            Some(slot) => {
                lookup.remember(slot);
                ended_worktrees(slot)
            }
            None => Vec::new(),
        };
        let mut v = self.run_detail(run_id)?;
        if let Some(o) = v.as_object_mut() {
            o.insert("worktreesLeft".into(), json!(super::cleanup::worktrees_left(&paths)));
            o.insert("mergedOutside".into(), json!(self.merged_outside(run_id)));
        }
        Ok(v)
    }

    pub(crate) fn active_count(&self) -> usize {
        self.lock().runs.values().filter(|s| s.run.state.active()).count()
    }
}

fn ended_worktrees(slot: &Slot) -> Vec<String> {
    if super::cleanup::cleanable_state(slot.run.state) {
        super::cleanup::worker_worktree_paths(&slot.run)
    } else {
        Vec::new()
    }
}

fn remaining(slot: &Slot, now: u64) -> Value {
    let r = &slot.run;
    let l = r.limits;
    let recent = slot.calls.iter().filter(|&&t| t + MINUTE_MS > now).count() as u32;
    let live = r.live_workers() as u32 + slot.reserved_workers;
    let total = r.worker_count() as u32 + slot.reserved_workers;
    json!({
        "tasks": l.max_tasks.saturating_sub(r.tasks.len() as u32),
        "callsThisMinute": l.max_calls_per_minute.saturating_sub(recent),
        "concurrentWorkers": l.max_concurrent_workers.saturating_sub(live),
        "totalWorkers": l.max_total_workers.saturating_sub(total),
        // 옛 파일의 붙여넣기 전달도 센다.
        "turns": l.max_deliveries.saturating_sub(r.resume_turns() + r.legacy_deliveries()),
        "reviews": r.limits.max_reviews.saturating_sub(r.review_count() as u32),
        "coordinationSeconds": r.coordination_deadline_at.saturating_sub(now) / 1000,
        "executionSeconds": r.execution_deadline_at.saturating_sub(now) / 1000,
    })
}

/// 토큰 · 멱등 기록을 싣지 않는다. `human` 이 아니면 조정자 보기다.
pub(in crate::orchestration) fn view(slot: &Slot, now: u64, human: bool) -> Value {
    let r = &slot.run;
    let tasks: Vec<Value> = r
        .tasks
        .iter()
        .map(|t| {
            let mut v = json!(t);
            if let Some(o) = v.as_object_mut() {
                o.insert("roleHistory".into(), super::roles::role_history(r, t));
                o.insert("rework".into(), match &r.album {
                    Some(a) => json!({"used": t.rework_count, "max": a.accept.max_rework}),
                    None => json!({"used": t.rework_count, "max": null}),
                });
                if t.state == TaskState::Reported {
                    o.insert("acceptReadiness".into(), super::super::album::readiness(r, t, slot.inputs_seen.as_ref()));
                }
                if let Some(a) = r.valid_artifact(&t.id) {
                    let w = a.waivers();
                    if !w.is_empty() {
                        o.insert("waived".into(), json!(w));
                    }
                }
            }
            v
        })
        .collect();
    let mut v = json!({
        "runId": r.id,
        "name": r.name,
        "state": r.state,
        "gen": r.gen,
        "createdAt": r.created_at,
        "updatedAt": r.updated_at,
        "endedAt": r.ended_at,
        "pauseReason": r.pause_reason,
        "coordinatorAttached": super::has_coordinator(slot),
        // 옛 파일 호환 칸(작업자 권한 · 허용 CLI · 붙이기 · 자동 종료 · 검토자 CLI · 전달 기록)은 보기에 싣지 않는다.
        "repo": r.repo,
        "worktreeDir": r.worktree_dir,
        "limits": r.limits,
        "coordinationDeadlineAt": r.coordination_deadline_at,
        "executionDeadlineAt": r.execution_deadline_at,
        "tasks": tasks,
        "attempts": r.attempts,
        "reports": r.reports,
        "accepted": r.accepted,
        "reviews": r.reviews,
        "commits": r.commits,
        "roles": super::super::album::roles_view(r, slot.inputs_seen.as_ref()),
        "acceptRules": super::super::album::accept_rules_view(r, slot.inputs_seen.as_ref()),
        // 경로 · 본문을 싣지 않는다.
        "transcripts": super::progress::transcripts_view(slot, now),
        "integration": r.integration,
        "hold": r.hold,
        "jobs": r.jobs,
        "completable": super::integrate::completable_view(slot),
        // 검증 명령 글자는 조정자에게도 보인다.
        "verify": r.verify,
        "lastVerify": super::verify::last_verify_view(slot),
        "verifyRunning": slot.verify_runs.keys().collect::<Vec<_>>(),
        // 옛 파일의 사람 면제 기록에만 뜻이 있다(새 Run 은 늘 false).
        "requireReview": r.legacy_require_review(),
        "reviewReports": super::review::reports_view(r),
        "reviewState": super::review::state_view(r),
        "remaining": remaining(slot, now),
        "latestSeq": r.seq,
        "persist": slot.persist.view(),
    });
    if let Some(album) = &r.album {
        if let Some(o) = v.as_object_mut() {
            o.remove("delegation");
            // 사람 패널은 구성 전체로 다음 몸을 만든다. 조정자의 보기는 rev만 싣는다.
            o.insert("album".into(), if human { json!(album) } else { json!({"rev": album.rev}) });
            if let Some(verify) = o.get_mut("verify").and_then(Value::as_object_mut) {
                verify.insert("autoRun".into(), json!(album.verify_auto));
            }
        }
    }
    if human {
        if let Some(o) = v.as_object_mut() {
            o.insert("previousState".into(), json!(r.previous_state));
            o.insert("orphaned".into(), json!(r.state == RunState::Orphaned));
            o.insert("log".into(), json!(r.log));
            o.insert("leftovers".into(), json!(slot.leftovers));
            // 경로는 사람 보기에만.
            o.insert("tempPending".into(), json!(r.temp_pending));
            o.insert("cleanable".into(), json!(super::cleanup::cleanable_state(r.state)));
            o.insert("coordinatorChat".into(), json!(live_producer(slot)));
            o.insert("origin".into(), json!(r.origin));
            o.insert("wakes".into(), json!(r.wakes));
            o.insert("merge".into(), json!(r.merge));
        }
    }
    v
}

fn summary(slot: &Slot) -> Value {
    let r = &slot.run;
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for t in &r.tasks {
        *counts.entry(t.state.as_str()).or_default() += 1;
    }
    json!({
        "runId": r.id,
        "name": r.name,
        "state": r.state,
        "previousState": r.previous_state,
        "orphaned": r.state == RunState::Orphaned,
        "gen": r.gen,
        "createdAt": r.created_at,
        "updatedAt": r.updated_at,
        "pauseReason": r.pause_reason,
        "coordinatorAttached": super::has_coordinator(slot),
        "hold": r.hold,
        "repo": r.repo,
        "latestSeq": r.seq,
        "taskCount": r.tasks.len(),
        "exportedBranch": r.integration.as_ref().filter(|i| i.exported_head.is_some()).map(|i| i.export_branch.clone()),
        "taskStates": counts,
        "attemptCount": r.attempts.len(),
        "blocked": r.attempts.iter().filter(|a| a.blocked.is_some() && a.state == AttemptState::Idle).count(),
        "running": running_counts(r),
        // 세대 · 토큰을 싣지 않는다.
        "origin": r.origin,
        "coordinatorChat": live_producer(slot),
        "producers": r.producers,
        "persist": slot.persist.view(),
        "wake": super::super::wake::wake_view(slot),
    })
}

/// 종류 칸이 없는 옛 Attempt 는 역할로 가른다.
fn running_counts(r: &Run) -> Value {
    let (mut write, mut judge) = (0u32, 0u32);
    for a in r.attempts.iter().filter(|a| a.turn_may_live()) {
        let is_judge = match a.kind {
            Some(k) => k == AttemptKind::Judge,
            None => a.is_reviewer(),
        };
        if is_judge {
            judge += 1;
        } else {
            write += 1;
        }
    }
    json!({ "write": write, "judge": judge })
}

fn live_producer(slot: &Slot) -> Option<String> {
    let r = &slot.run;
    slot.coordinator
        .as_ref()
        .filter(|(gen, _)| *gen == r.gen && matches!(r.state, RunState::Running | RunState::Paused))
        .map(|(_, s)| s.chat.clone())
}
