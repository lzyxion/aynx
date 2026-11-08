//! Run 의 **보기** — 상세(`view` — 조정자 `get_run` · `wait_run` 과 사람 보드가 함께) · 목록 한 줄(`summary`) · 남은 한도 · 지금 조정자 스트림과
//! 그 조회 메서드(`snapshot` · `run_detail` · `run_detail_fresh`). **토큰 · 멱등 기록 없음.** 잠금은 부모(`store.rs`)의 하나를 그대로 쓴다.
//! `store.rs` 에서 그대로 옮겼다.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{not_found_run, OrchError, Orchestration, Slot, MINUTE_MS};
use crate::orchestration::model::*;

impl Orchestration {
    /// 모든 Run 의 요약(orphaned 포함 — 최근 것부터). 토큰 없음.
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
                        // (2단계 단계 2 — 설계 2-4 · R13) 이어받기 판정 — `adopt_run` 과 **같은 함수**(라이브러리 · 채팅 UI 가 같은 판정을 읽는다).
                        o.insert("adoptable".into(), super::super::start::adopt_verdict(s, now).view());
                    }
                    (v, ended_worktrees(s))
                })
                .collect()
        };
        // 끝난 앨범의 남은 작업자 worktree 수(라이브러리의 [보관] 판정 재료) — 디스크는 잠금 밖에서 본다.
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

    /// Run 하나의 상세(사람 — 타임라인 포함). 토큰 없음.
    pub(crate) fn run_detail(&self, run_id: &str) -> Result<Value, OrchError> {
        let now = self.now();
        let g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
        Ok(view(slot, now, true))
    }

    /// Run 하나의 상세(사람 보드) — 맡기기를 지금 읽어(잠금 밖) 보기의 `roles` · `acceptRules` · `delegation` 을 새로 한다. **블로킹**(파일 · git).
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
            // 터미널에서 직접 병합했나 — 앨범 줄의 [main에 병합됨](잠금 밖 git).
            o.insert("mergedOutside".into(), json!(self.merged_outside(run_id)));
        }
        Ok(v)
    }

    /// 살아 있는 Run 수(running · paused · stopping) — 서버 자진 종료 조건(`serve::Busy.runs`).
    pub(crate) fn active_count(&self) -> usize {
        self.lock().runs.values().filter(|s| s.run.state.active()).count()
    }
}

/// 끝난 Run 의 작업자 worktree 경로(잠금 안 — 산 Run 은 보관 대상이 아니라 디스크를 보지 않게 비운다).
fn ended_worktrees(slot: &Slot) -> Vec<String> {
    if super::cleanup::cleanable_state(slot.run.state) {
        super::cleanup::worker_worktree_paths(&slot.run)
    } else {
        Vec::new()
    }
}

/// 남은 한도.
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
        // 이어지는 턴(3a — `send_prompt` 의 resume 턴 · 옛 붙여넣기 전달도 센다).
        "turns": l.max_deliveries.saturating_sub(r.resume_turns() + r.legacy_deliveries()),
        // 판정(통합 설계 3-4 — 작업자 한도와 따로 · 3a: 맡기기의 `max_reviews`).
        "reviews": r.limits.max_reviews.saturating_sub(r.review_count() as u32),
        "coordinationSeconds": r.coordination_deadline_at.saturating_sub(now) / 1000,
        "executionSeconds": r.execution_deadline_at.saturating_sub(now) / 1000,
    })
}

/// Run 보기 — 조정자(`get_run` · `wait_run`)와 사람(`orchestration_run` — 타임라인 · 영속 칸 포함)이 함께 쓴다. **토큰 없음 ·
/// 멱등 기록 없음.**
pub(in crate::orchestration) fn view(slot: &Slot, now: u64, human: bool) -> Value {
    let r = &slot.run;
    // Task 마다 거친 역할 · 판정 이력 · 되돌림 · 수락 준비(3-2a — 맡기기의 지금 규칙으로).
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
                // 유효한 수락이 넘은 규칙(사람 면제 — 옛 `reviewWaivedBy` 는 `{rule: "review"}` 로 읽는다).
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
        // 지금 세대의 조정자가 묶여 있나(까닭 글자와 따로 — 사람 일시정지 중 CLI 가 끝나도 까닭은 `human`). 없으면 [재개] 는 `no-coordinator`.
        "coordinatorAttached": super::has_coordinator(slot),
        // (3차 6단계) 2차 시작 대화의 옛 칸(작업자 권한 · 허용 CLI · 붙이기 · 자동 종료 · 검토자 CLI · 전달 기록)은 보기에 싣지 않는다 — 영속
        // 파일에는 남아 다시 저장할 때 그대로다(옛 파일 호환). 작업자 · 판정형은 `roles`(맡기기)가 말한다.
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
        // 맡기기(3a — 2-4 · 3-2a): 상태 낱말(`active` · `not-delegated` · `changed-outside` · `identity-changed` · `missing` · `unreadable`) ·
        // 역할 목록(지침은 길이만) · 수락 규칙. 지금 맡기기에서 읽는다(Run 사본 아님 — E17 · E18).
        "roles": super::super::album::roles_view(r, slot.inputs_seen.as_ref()),
        "acceptRules": super::super::album::accept_rules_view(r, slot.inputs_seen.as_ref()),
        // 고정 대화 지켜보기(6단계) — 상태 낱말 · 마지막 증가 · 기록 지연만(경로 · 본문 없음).
        "transcripts": super::progress::transcripts_view(slot, now),
        // 통합 설계 2단계 — 통합 ref(3단계가 채운다) · 보류 · 통합 작업 기록 · Run 완료 조건(3-4).
        "integration": r.integration,
        "hold": r.hold,
        "jobs": r.jobs,
        "completable": super::integrate::completable_view(slot),
        // 수락 전 검증(4단계) — 사람이 정한 설정(명령 글자 포함 — 조정자에게도 보인다) · Task 마다 마지막 결과 + 꼬리
        // (메모리 · 끝 8 KiB) · 지금 도는 검증.
        "verify": r.verify,
        "lastVerify": super::verify::last_verify_view(slot),
        "verifyRunning": slot.verify_runs.keys().collect::<Vec<_>>(),
        // 검토(통합 설계 3-3 — 5단계): 검토 보고 · Task 마다 현재 보고의 검토 상태(none · pending · pass · changes-requested). **역할 기반
        // 보조 검토** — 보고 커밋을 본 것이지 통합 후보를 본 것이 아니다. `requireReview` 는 옛 Run(2차 파일)의 사람 면제 기록에만 뜻이 있다
        // (새 Run 은 늘 false — 수락 규칙은 `acceptRules`).
        "requireReview": r.legacy_require_review(),
        // 대상 보고가 더는 현재 보고가 아니면 `current` 판정도 `stale` 로 보인다(`reviewState` 와 같은 규칙 — E2E 10-16 #7b).
        "reviewReports": super::review::reports_view(r),
        "reviewState": super::review::state_view(r),
        "remaining": remaining(slot, now),
        "latestSeq": r.seq,
        // 영속 저장 상태(F7) — `{ok, lastSavedSeq, failing?{since, reason, count}}`(분류 낱말만 · 경로 · OS 문장 없음). 실패 중이면 서버가
        // 지금 끝날 때 최근 변경을 잃을 수 있다 — 조정자는 사람에게 알리고, 보드는 경고 띠를 낸다.
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
            // 남긴 서버 임시 자리(통합 설계 6-2 — 경로는 사람 보기에만) · [정리] 를 열 수 있나(끝난 Run · orphaned).
            o.insert("tempPending".into(), json!(r.temp_pending));
            o.insert("cleanable".into(), json!(super::cleanup::cleanable_state(r.state)));
            // 지금 조정자로 묶인 프로듀서 채팅 id(목록 요약과 같은 칸 — 비밀이 아니다). 없으면 null.
            o.insert("coordinatorChat".into(), json!(live_producer(slot)));
            // 누가 열었나(5단계 — 앨범 머리 "AI 가 연 앨범 · 프로듀서 채팅").
            o.insert("origin".into(), json!(r.origin));
            // (2단계 단계 4) 깨움 예약 기록(SHA · 범위 · 채팅 — 문장 없음) — 채팅 기록의 "앱이 깨움" 표지가 출처를 맞춘다(표시용).
            o.insert("wakes".into(), json!(r.wakes));
            // 앨범 병합 기록 — 앨범 줄 · 멈춘 까닭(사람 보드만 · 조정자 보기에는 없다).
            o.insert("merge".into(), json!(r.merge));
        }
    }
    v
}

/// 목록 한 줄.
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
        // 내보낸 브랜치 — 라이브러리 줄의 [내보냄] 칩 · 병합 명령 복사(줄마다 상세를 읽지 않게).
        "exportedBranch": r.integration.as_ref().filter(|i| i.exported_head.is_some()).map(|i| i.export_branch.clone()),
        "taskStates": counts,
        "attemptCount": r.attempts.len(),
        // (3a) 작업자에게는 사람이 답할 화면이 없다 — `blocked` 로 멈춘 작업자 수(조정자가 사람에게 말한다 · 보드가 보인다). 옛 `needsHuman` ·
        // `needsHumanStreams` 칸은 걷었다(3차 6단계).
        "blocked": r.attempts.iter().filter(|a| a.blocked.is_some() && a.state == AttemptState::Idle).count(),
        // (2026-10-30 오케스트레이션 탭 ⑤ · 노트 D9) 턴이 살아 있을 수 있는 Attempt 수 — 종류별(쓰기형 · 판정형). 뒤에 있는 앨범 탭 · 독의
        // 막대가 상세 없이 "재생 · 검토 · 쉼" 을 가른다(읽기 보기 칸 — 새 명령 · 원격 분류 · 영속 변경 없음). 옛 Attempt(종류 없음)는 역할로.
        "running": running_counts(r),
        // 누가 열었나 · 지금 세대로 묶인 프로듀서 채팅(세대 · 토큰 없음) · 귀속 채팅들(Run 파일 `producers`).
        "origin": r.origin,
        "coordinatorChat": live_producer(slot),
        "producers": r.producers,
        // 앨범 탭 배치가 남았나(Q3 — 그 채팅의 잎을 가진 창이 `{runId, chat}` 으로 가져간다).
        // 영속 저장 상태(F7 — 상세와 같은 칸).
        "persist": slot.persist.view(),
        // (2단계 단계 4) 앱이 깨움 — 꺼짐 까닭 · 사람 말 사이 셈 · 누적(채팅의 띠 · 상한 표시).
        "wake": super::super::wake::wake_view(slot),
    })
}

/// 목록 한 줄의 `running{write, judge}` — 턴이 살아 있을 수 있는([`Attempt::turn_may_live`]) Attempt 를 바탕 종류로 센다.
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

/// 지금 세대로 묶인 프로듀서 채팅 id(조율을 받는 Run 만).
fn live_producer(slot: &Slot) -> Option<String> {
    let r = &slot.run;
    slot.coordinator
        .as_ref()
        .filter(|(gen, _)| *gen == r.gen && matches!(r.state, RunState::Running | RunState::Paused))
        .map(|(_, s)| s.chat.clone())
}
