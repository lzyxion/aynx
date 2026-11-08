//! **검토자**(통합 설계 2026-10-15-orchestration-integration-design 3-3 · 3-4 · D6 · D7 · R6 · R7 · R15 — 5단계): 조정자의
//! `spawn_worker{role: "reviewer"}` → 보고 하나를 읽기만 하는 AI 세션, 검토자의 `report_review` → 판정 기록(`ReviewReport`),
//! Run 옵션 `requireReview` 의 수락 관문.
//!
//! 불변식:
//! - **수명이 작업자와 따로다**(R7) — 검토 생성은 Task 상태 · `current_attempt` 를 바꾸지 않고(작업자 길 `attempts.rs::spawn_worker` 를
//!   쓰지 않는다), 작업자 한도에 세지 않는다. 생성 · 잡 · 토큰 회수는 작업자와 같은 서버 손 · 같은 종료 길이다.
//! - **보고당 활성 검토 하나** · **Run 당 동시 하나**(`review-active`) · 총 `maxReviews`(`review-budget-exhausted`). 대상 `{reportId,
//!   commitOid}` 는 띄울 때 고정한다(`Attempt.review_of`) — 검토자의 `get_diff` 도 그 대상만 본다.
//! - 대상 보고가 바뀌면(새 보고 · 반려 · 취소 · 수락) 활성 검토를 **무효화**한다 — 자리를 비우고 검토자를 멈추며(`stop_queue`), 그 뒤
//!   `report_review` 는 `stale` 로 기록만 한다. 늦게 끝난 옛 검토가 새 판정을 덮지 않는다(`reviewState` 는 **현재 보고**의 `current`
//!   판정만 본다).
//! - 실행 모양(서버 손 — `server::workers`): cwd = 서버가 만든 **빈 폴더**, 보고 커밋은 Run 자리의 **분리 HEAD worktree**(훅 끔)로
//!   읽기 자리에만 넘긴다. 추적 symlink 의 대상이 그 자리 밖이면 띄우지 않는다(`symlink-outside` — 9절 위험 5 확정). 인자는 사람이 고른
//!   작업자 권한 모드와 **무관한 고정 인자**(`turn::turn_argv` 의 판정형 줄 — 사용자 추가 인자 없음 · 설정 출처 통제). (3차 2단계) 검토자는
//!   **헤드리스 턴**이다 — 세션 · PTY · 타일 스트림이 없고(`Attempt.stream` 없음) 턴(= 프로세스)이 끝나면 끝, 판정 뒤 자동 종료는 없다.
//! - **검토자는 역할 기반 보조 검토다 — 독립 진위 보증이 아니다.** 같은 계정 안의 이름표 토큰((가) 결정)이라 작업자가 토큰을 훔쳐 검토자를
//!   사칭하거나 같은 계정 파일에 손대는 것은 막지 못한다. 도구 설명 · 보드 · 수칙이 그대로 말한다.
//! - 검토 본문(요약 · 찾은 것)은 영속 · 보드 · 조정자에만 — 감사에는 판정 · 길이 · 개수만.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::git::{child_env, hex40, Git};
use super::model::*;
use super::report::{acceptable, review_target, worker_run};
use super::spawn::{self, Base, LaunchJob, ReviewJob, TurnPlan};
use super::store::{reason, writable, Binding, OrchError, Orchestration, Slot};
use super::tools::{arg, bad, coordinator_slot, opt_text, req_text, request_id};
use crate::audit::OrchestrationAudit;

/// 현재 보고(검토 대상이 될 보고)의 id.
fn current_report_id(run: &Run, task: &Task) -> Option<String> {
    review_target(run, task).map(|r| r.report_id)
}

/// 현재 보고의 id(수락 규칙 판정 — `roles.rs`).
pub(super) fn current_report(run: &Run, task: &Task) -> Option<String> {
    current_report_id(run, task)
}

/// Task 의 **현재 보고**에 대한 검토 상태(통합 설계 3-3) — `pending`(그 보고의 활성 검토) · 마지막 `current` 판정(`pass` ·
/// `changes-requested`) · `none`. 옛 보고의 판정 · `stale` · `late` 는 들지 않는다.
pub(super) fn review_state<'r>(run: &'r Run, task: &Task) -> (&'static str, Option<&'r ReviewReport>) {
    let cur = current_report_id(run, task);
    if task.review.active.is_some() && task.review.target.is_some() && task.review.target == cur {
        return ("pending", None);
    }
    let Some(cur) = cur else { return ("none", None) };
    match run
        .review_reports
        .iter()
        .rev()
        .find(|r| r.task_id == task.id && r.report_id == cur && r.state == ReviewReportState::Current)
    {
        Some(r) => (r.verdict.as_str(), Some(r)),
        None => ("none", None),
    }
}

/// 보기(조정자 `get_run` · 보드) — Task 마다 `{state, reportId?, reviewId?, verdict?, summary?, findings?, attemptId?}`.
pub(super) fn state_view(run: &Run) -> Value {
    let mut out = serde_json::Map::new();
    for t in &run.tasks {
        let (state, rep) = review_state(run, t);
        let mut v = json!({ "state": state, "reportId": current_report_id(run, t) });
        if let Some(o) = v.as_object_mut() {
            if state == "pending" {
                o.insert("attemptId".into(), json!(t.review.active));
            }
            if let Some(r) = rep {
                o.insert("reviewId".into(), json!(r.review_id));
                o.insert("attemptId".into(), json!(r.attempt_id));
                o.insert("verdict".into(), json!(r.verdict));
                o.insert("summary".into(), json!(r.summary));
                o.insert("findings".into(), json!(r.findings));
                o.insert("at".into(), json!(r.at));
            }
        }
        out.insert(t.id.clone(), v);
    }
    Value::Object(out)
}

/// 검토 보고 목록 보기(조정자 `get_run` · 보드 — E2E 10-16 #7b) — 저장된 `current` 판정이라도 그 대상 보고가 **더는 Task 의 현재 보고가
/// 아니면**(해결자 · 새 Attempt 의 보고로 바뀜) `stale` 로 보인다. [`review_state`] 와 같은 규칙(현재 보고의 `current` 만 유효)을 읽을 때
/// 계산한다 — 저장값(영속 파일)은 판정 그때의 기록으로 둔다.
pub(super) fn reports_view(run: &Run) -> Value {
    let list: Vec<Value> = run
        .review_reports
        .iter()
        .map(|r| {
            let mut v = json!(r);
            let superseded = r.state == ReviewReportState::Current
                && run.task(&r.task_id).and_then(|t| current_report_id(run, t)).as_deref() != Some(r.report_id.as_str());
            if let (true, Some(o)) = (superseded, v.as_object_mut()) {
                o.insert("state".into(), json!(ReviewReportState::Stale));
            }
            v
        })
        .collect();
    Value::Array(list)
}

/// 활성 검토를 **무효화**한다(잠금 안 — 보고 교체 · 반려 · 취소 · 수락). 자리를 비우고 검토자를 `stopping` 으로 올려 `stop_queue` 에
/// 쌓는다(부른 쪽이 잠금 밖에서 `drain_stops`). 무효화했으면 `true`.
pub(super) fn invalidate(slot: &mut Slot, task_id: &str, now: u64, actor: Actor, why: &str) -> bool {
    let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) else { return false };
    let Some(att) = t.review.active.take() else { return false };
    t.review.target = None;
    slot.run.bump(now, actor, "review_invalidated", Some(&att), why);
    if super::attempts::mark_stopping(slot, &att, now, actor) {
        slot.stop_queue.push(att);
    }
    true
}

/// 검토자가 판정 없이 끝났다(생성 실패 · 종료 — 잠금 안, `attempts.rs` 의 종료 길이 부른다). 그 Task 의 활성 자리를 비운다(다음 검토가
/// 막히지 않게). 작업자면 아무 일 없다.
pub(super) fn on_reviewer_ended(slot: &mut Slot, attempt_id: &str, now: u64) {
    let is_reviewer = slot.run.attempts.iter().any(|a| a.id == attempt_id && a.is_reviewer());
    if !is_reviewer {
        return;
    }
    let mut freed = false;
    for t in slot.run.tasks.iter_mut().filter(|t| t.review.active.as_deref() == Some(attempt_id)) {
        t.review.active = None;
        freed = true;
    }
    if freed {
        slot.run.bump(now, Actor::Server, "review_ended", Some(attempt_id), "no-verdict");
    }
}

/// 검토 자리 하나를 만든다(서버 손 — **블로킹** git): Run 자리 안에 보고 커밋의 **분리 HEAD worktree**(`orch-<task8>-<att8>-rv` · 훅 끔)와
/// 빈 cwd(`cwd_root/review-<att8>`). 경로들(`(자리, cwd)`). 자리는 만든 즉시 곁 파일에 `role: review` 로 적는다(통합 설계 6-2 — 그 뒤
/// 무엇이 실패해도 폐기 정책이 "이 Run 의 서버 임시 자리" 로 안다).
#[allow(clippy::too_many_arguments)]
pub(crate) fn place_blocking(
    repo: &Path,
    worktree_dir: &str,
    cwd_root: &Path,
    run_id: &str,
    task_id: &str,
    attempt_id: &str,
    commit: &str,
    sidecar: Option<&Path>,
) -> Result<(String, String), OrchError> {
    let failed = |m: String| OrchError::new(reason::WORKTREE_FAILED, m);
    if !hex40(commit) {
        return Err(bad("the reviewed commit must be 40 hex"));
    }
    let wt_root = PathBuf::from(worktree_dir);
    std::fs::create_dir_all(&wt_root).map_err(|e| failed(format!("could not create the run's worktree folder: {e}")))?;
    let name = format!("{}-rv", spawn::worktree_name(task_id, attempt_id));
    let asked = wt_root.join(&name);
    let outside = || failed("the review folder must be inside the run's worktree folder".into());
    if !super::worktree::inside(&wt_root, &asked) {
        return Err(outside());
    }
    let place = super::worktree::real_path(&asked).ok_or_else(outside)?;
    if std::fs::symlink_metadata(&place).is_ok() {
        return Err(failed(format!("{} already exists", place.display())));
    }
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let rg = Git::new(repo, &hooks, &env, reason::WORKTREE_FAILED)?;
    let place_s = place.to_string_lossy().into_owned();
    // 리뷰 F2 — checkout 이 smudge · process 필터(LFS 포함)를 서버 권한으로 돌리지 않게, 꺼낼 트리 전체에 필터가 걸리면 띄우지 않는다
    // (속성 출처 = 그 커밋 — 미지원 조합은 실행 전 거절, 사람이 본다).
    if super::git::tree_has_filters(&rg, commit, &[commit])? {
        return Err(OrchError::new(
            reason::FILTERS_CONFIGURED,
            "the reviewed commit has files with a filter attribute (clean/smudge/process · LFS) — the review was not started; a person must look at it",
        ));
    }
    rg.ok(&["worktree", "add", "--detach", &place_s, commit], &[], None)?;
    if let Some(side) = sidecar {
        if let Err(e) = crate::worktree::record_server_place(side, &place_s, repo, run_id, super::cleanup::ROLE_REVIEW) {
            crate::server::log::line(format!("orchestration — {run_id}: worktrees.json not written for a review folder: {e}"));
        }
    }
    if !super::worktree::inside(&wt_root, &place) {
        return Err(outside());
    }
    let a8: String = attempt_id.trim_start_matches("att-").chars().take(8).collect();
    let cwd = cwd_root.join(format!("review-{a8}"));
    std::fs::create_dir_all(&cwd).map_err(|e| failed(format!("could not create the reviewer's empty folder: {e}")))?;
    if std::fs::read_dir(&cwd).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(failed("the reviewer's working folder is not empty".into()));
    }
    Ok((place_s, cwd.to_string_lossy().into_owned()))
}

/// 검토 자리의 추적 symlink 대상 검사(9절 위험 5 확정 — 검증 자리와 같은 판정): 하나라도 자리 밖이면(못 읽은 링크도 밖으로 본다)
/// `symlink-outside`. **블로킹**(git).
pub(crate) fn check_links_blocking(place: &Path) -> Result<(), OrchError> {
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let g = Git::new(place, &hooks, &env, reason::WORKTREE_FAILED)?;
    let ls = g.ok(&["ls-files", "-s", "-z"], &[], None)?;
    for rel in super::verify::tracked_links(&ls) {
        let full = place.join(&rel);
        let Ok(md) = std::fs::symlink_metadata(&full) else { continue };
        if !md.file_type().is_symlink() {
            continue; // core.symlinks=false — 대상 글자를 담은 보통 파일이다(따라갈 링크가 아니다).
        }
        let out = match std::fs::read_link(&full) {
            Ok(t) => super::verify::link_outside(&rel, &t),
            Err(_) => true,
        };
        if out {
            return Err(OrchError::new(
                reason::SYMLINK_OUTSIDE,
                "a tracked symlink of the reviewed commit points outside the review folder — the review was not started; a person must look at it",
            ));
        }
    }
    Ok(())
}

fn findings_arg(args: Option<&Value>) -> Result<Vec<String>, OrchError> {
    let Some(v) = arg(args, "findings") else { return Ok(Vec::new()) };
    let items = v.as_array().ok_or_else(|| bad("findings must be an array of strings"))?;
    if items.len() > REVIEW_FINDINGS_MAX {
        return Err(bad(format!("at most {REVIEW_FINDINGS_MAX} findings")));
    }
    let mut out = Vec::new();
    for it in items {
        let s = it.as_str().ok_or_else(|| bad("findings must be an array of strings"))?;
        let s = spawn::sanitize_text(s).trim().to_string();
        if s.chars().count() > REVIEW_FINDING_CHARS {
            return Err(bad(format!("each finding is at most {REVIEW_FINDING_CHARS} characters")));
        }
        if !s.is_empty() {
            out.push(s);
        }
    }
    Ok(out)
}

impl Orchestration {
    /// 조정자 `spawn_worker{role: <판정형 역할 id>}`(3a — 4-7: 판정형 = 검토자 길) — 머리말의 관문(잠금 하나) 뒤 서버 손에 맡긴다(비동기).
    /// Task 상태 · `current_attempt` 는 그대로. CLI · 모델 · 강도 · 지침은 역할에서, 권한은 **늘 읽기 전용**(판정형 고정 인자).
    pub(super) fn spawn_reviewer(
        &self,
        run_id: &str,
        gen: u32,
        args: Option<&Value>,
        role: super::roles::TurnRole,
        lookup: &super::album::RunInputs,
    ) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let task_id = req_text(args, "taskId", 64)?;
        let cli = role.cli;
        if opt_text(args, "base", 64)?.is_some() || opt_text(args, "reuseWorktreeOf", 64)?.is_some() {
            return Err(bad("a judge reads the task's current report — omit base and reuseWorktreeOf"));
        }
        let attempt_id = new_id("att").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let token = crate::token::generate_token().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let session_id = match cli {
            WorkerCli::Claude => Some(spawn::new_uuid().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?),
            WorkerCli::Codex => None,
        };
        let now = self.now();
        let (result, job, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request_id, "spawn_worker", &super::store::request_sha(args))? {
                return Ok(first);
            }
            writable(&slot.run)?;
            if self.launcher().is_none() {
                return Err(OrchError::new(reason::SPAWN_UNAVAILABLE, "this server cannot start reviewers"));
            }
            // 맡기기 관문(E5 — 맡긴 저장소에서만).
            lookup.gate(&slot.run)?;
            let role = lookup.pick_role(&slot.run, &role.id)?;
            let Some(task) = slot.run.task(&task_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if task.state != TaskState::Reported {
                return Err(OrchError::new(
                    reason::NOT_REPORTED,
                    format!("task {task_id} is {} — only a reported task can be reviewed", task.state.as_str()),
                ));
            }
            // 대상 = 수락할 수 있는 현재 보고(성공 · 불일치 없음 · 미커밋 없음 · 커밋 있음 — 수락 못 할 보고는 검토할 뜻이 없다).
            let (report, commit) = acceptable(&slot.run, &task)?;
            if task.review.active.is_some() {
                return Err(OrchError::new(
                    reason::REVIEW_ACTIVE,
                    format!("task {task_id} already has a review running — wait for its verdict (wait_run until=reviewed)"),
                ));
            }
            // 술어 `turn_may_live` — "Run 당 동시 하나" 는 도는 판정 턴을 센다(동시 한도 — 4-5 · 4-7).
            if slot.run.attempts.iter().any(|a| a.is_reviewer() && a.turn_may_live()) {
                return Err(OrchError::new(
                    reason::REVIEW_ACTIVE,
                    "another reviewer of this run is still running — reviews run one at a time; wait for it (wait_run until=reviewed)",
                ));
            }
            // 판정 총 수(E16 — 맡기기의 `max_reviews` · 판정형 역할 전부의 합).
            let max = lookup.max_reviews(&slot.run);
            if slot.run.review_count() as u32 >= max {
                return Err(OrchError::new(
                    reason::REVIEW_BUDGET_EXHAUSTED,
                    format!("this repository's delegation allows at most {max} judgments per run — they are used up"),
                ));
            }
            // 판정형에게는 세션 · 타일 스트림이 없다(Attempt.stream = 없음). 턴 자원(턴 MCP 파일)의 주인 표시는 `turn_claim_key`.
            slot.run.attempts.push(Attempt {
                id: attempt_id.clone(),
                task_id: task_id.clone(),
                cli,
                gen,
                state: AttemptState::Spawning,
                stream: None,
                worktree: None,
                branch: None,
                base_commit: report.base_commit_oid.clone(),
                pid: None,
                conversation_id: session_id.clone(),
                launch_args: Some(spawn::reviewer_args_label(cli)),
                attention: None,
                started_at: now,
                ended_at: None,
                exit_reason: None,
                pending_recovery: None,
                conversation_changed: false,
                last_commit_rejection: None,
                resolves: None,
                role: AttemptRole::Reviewer,
                review_of: Some(ReviewOf {
                    report_id: report.report_id.clone(),
                    commit_oid: commit.clone(),
                    base_commit: report.base_commit_oid.clone(),
                    place: None,
                    cwd: None,
                }),
                turns: Vec::new(),
                kind: Some(AttemptKind::Judge),
                role_id: Some(role.id.clone()),
                role_name: Some(role.name.clone()),
                blocked: None,
                conversation_broken: false,
                stop_requested: false,
            });
            if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) {
                t.review = ReviewSlot {
                    active: Some(attempt_id.clone()),
                    target: Some(report.report_id.clone()),
                };
            }
            let seq = slot.run.bump(now, Actor::Coordinator, "reviewer_spawning", Some(&attempt_id), cli.as_str());
            let result = json!({
                "attemptId": attempt_id,
                "taskId": task_id,
                "role": { "id": role.id, "name": role.name, "kind": role.kind.as_str(), "cli": cli.as_str() },
                "state": AttemptState::Spawning,
                "reviewOf": { "reportId": report.report_id, "commit": commit, "base": report.base_commit_oid },
                "latestSeq": seq,
            });
            slot.run.remember(&request_id, "spawn_worker", &super::store::request_sha(args), result.clone());
            let job = LaunchJob {
                run_id: run_id.to_string(),
                attempt_id: attempt_id.clone(),
                task: task.clone(),
                cli,
                repo: slot.run.repo.clone(),
                worktree_dir: slot.run.worktree_dir.clone(),
                base: Base::Commit(commit.clone()),
                reuse: None,
                token: token.clone(),
                stream: spawn::turn_claim_key(&attempt_id, 1),
                session_id,
                seed: None,
                review: Some(ReviewJob {
                    report_id: report.report_id.clone(),
                    commit: commit.clone(),
                    base: report.base_commit_oid.clone(),
                }),
                turn: TurnPlan {
                    n: 1,
                    resume: None,
                    text: None,
                    turn_minutes: lookup.turn_minutes(&slot.run)?,
                    role,
                },
            };
            let detail = OrchestrationAudit {
                gen,
                actor: Actor::Coordinator.as_str().into(),
                task_id: Some(task_id.clone()),
                attempt_id: Some(attempt_id.clone()),
                cli: Some(cli.as_str().into()),
                attempt_state: Some(AttemptState::Spawning.as_str().into()),
                commit_oid: Some(commit),
                ..Default::default()
            };
            g.tokens.push((
                token,
                Binding {
                    role: Role::Reviewer,
                    run_id: run_id.to_string(),
                    gen,
                    attempt_id: Some(attempt_id.clone()),
                },
            ));
            self.after_change(&g, run_id);
            (result, job, detail)
        };
        self.audit("reviewer_spawned", run_id, detail);
        if let Some(l) = self.launcher() {
            l.launch(job);
        }
        Ok(result)
    }

    /// 검토 자리가 섰다(서버 손) — 적고, 계속해도 되는가(그사이 중단 · 무효화됐으면 `false` — 서버 손은 프로세스를 띄우지 않는다).
    pub(crate) fn attempt_review_place(&self, run_id: &str, attempt_id: &str, place: &str, cwd: &str) -> bool {
        let now = self.now();
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return false };
        let run_live = slot.run.state.active() && slot.run.state != RunState::Stopping;
        let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id && a.is_reviewer()) else {
            return false;
        };
        if let Some(of) = a.review_of.as_mut() {
            of.place = Some(place.to_string());
            of.cwd = Some(cwd.to_string());
        }
        let go = a.state == AttemptState::Spawning && run_live;
        slot.run.bump(now, Actor::Server, "review_place_created", Some(attempt_id), "detached");
        self.after_change(&g, run_id);
        go
    }

    /// 검토자 `get_task` — 검토 지시서: Task 명세 + 대상 보고(요약 · 메모 · 바뀐 파일 — 서버가 보고 때 읽은 것) + 고정 OID + 읽기 자리.
    pub(super) fn reviewer_task(&self, run_id: &str, attempt_id: &str) -> Result<Value, OrchError> {
        let g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(super::store::not_found_run)?;
        if !slot.run.state.active() {
            return Err(super::store::state_error(slot.run.state));
        }
        let a = slot
            .run
            .attempts
            .iter()
            .find(|a| a.id == attempt_id && a.is_reviewer())
            .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such review attempt"))?;
        let of = a.review_of.as_ref().ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no review target"))?;
        let task = slot.run.task(&a.task_id).ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
        let rep = slot.run.reports.iter().find(|r| r.report_id == of.report_id);
        let still = task.review.active.as_deref() == Some(attempt_id);
        Ok(json!({
            "runId": slot.run.id,
            "attemptId": a.id,
            "role": AttemptRole::Reviewer,
            "task": {
                "id": task.id,
                "title": task.title,
                "goal": task.goal,
                "scope": task.scope,
                "doneWhen": task.done_when,
            },
            "report": rep.map(|r| json!({
                "reportId": r.report_id,
                "outcome": r.outcome,
                "summary": r.summary,
                "notes": r.notes,
                "changedFiles": r.changed_files,
                "changedFilesTruncated": r.changed_files_truncated,
            })),
            "base": of.base_commit,
            "commit": of.commit_oid,
            "readOnlyFolder": of.place.as_deref().map(|p| p.replace('\\', "/")),
            // 대상이 무효화됐으면(보고 교체 · 반려 · 취소 · 수락) 판정은 stale 로만 남는다.
            "stillCurrent": still,
            "rules": "Review the reported commit against its base (the task's own change — not the integration result). Read the code in readOnlyFolder and the change with get_diff; do not edit, commit or change anything. Then call report_review once: verdict pass or changes-requested, a short summary and at most 20 short findings. This is a role-based supplementary review — the coordinator and a person decide.",
        }))
    }

    /// 검토자 `report_review` — 자기 Attempt · 한 번(`already-reported`). 대상이 무효화됐으면 `stale`, 중단 · 세대 교체 뒤면 `late`(기록만).
    pub(super) fn report_review(&self, run_id: &str, attempt_id: &str, args: Option<&Value>) -> Result<Value, OrchError> {
        let request = request_id(args)?;
        let key = format!("{attempt_id}:{request}");
        let verdict = ReviewVerdict::parse(&req_text(args, "verdict", 32)?)
            .ok_or_else(|| bad("verdict must be pass or changes-requested"))?;
        let summary = spawn::sanitize_text(&req_text(args, "summary", REVIEW_SUMMARY_MAX)?).trim().to_string();
        let findings = findings_arg(args)?;
        let review_id = new_id("rvw").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = worker_run(&mut g, run_id)?;
            if let Some(first) = super::store::request_seen(slot, &key, "report_review", &super::store::request_sha(args))? {
                return Ok(first);
            }
            let a = slot
                .run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id && a.is_reviewer())
                .cloned()
                .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such review attempt"))?;
            if slot.run.review_reports.iter().any(|r| r.attempt_id == attempt_id) {
                return Err(OrchError::new(
                    reason::ALREADY_REPORTED,
                    "you already reported your review — a reviewer reports once (retry with the same requestId to read the first result)",
                ));
            }
            let of = a.review_of.clone().ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no review target"))?;
            let task = slot.run.task(&a.task_id).cloned().ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
            // 자리가 이 검토자의 것이 아니거나 대상이 지금 보고가 아니면 무효화된 것이다(stale) — 중단 · 세대 교체 뒤면 late.
            let mine = task.review.active.as_deref() == Some(attempt_id)
                && current_report_id(&slot.run, &task).as_deref() == Some(of.report_id.as_str());
            let late = matches!(slot.run.state, RunState::Stopping | RunState::Stopped)
                || matches!(a.state, AttemptState::Stopping | AttemptState::StopUnconfirmed | AttemptState::Stopped)
                || a.gen != slot.run.gen;
            let state = if !mine {
                ReviewReportState::Stale
            } else if late {
                ReviewReportState::Late
            } else {
                ReviewReportState::Current
            };
            slot.run.review_reports.push(ReviewReport {
                review_id: review_id.clone(),
                attempt_id: attempt_id.to_string(),
                task_id: a.task_id.clone(),
                report_id: of.report_id.clone(),
                commit_oid: of.commit_oid.clone(),
                verdict,
                findings: findings.clone(),
                summary: summary.clone(),
                at: now,
                state,
            });
            if mine {
                // 자리를 비운다(판정이 섰다 · 늦은 판정은 세지 않지만 자리는 놓는다). 대상은 마지막 대상으로 남는다.
                if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == a.task_id) {
                    t.review.active = None;
                }
            }
            if state == ReviewReportState::Current {
                // (3a) Attempt 는 `running` 그대로 — 턴이 끝나면(트리 종료 확인) 판정이 있으니 `reported`(닫힘)가 된다(4-5 — 턴 밖에서만
                // `reported`). 보고 뒤 자동 종료는 없다 — 헤드리스는 턴이 끝나면 스스로 끝난다(E4). 끝나지 않는 턴은 턴 시한이 끝낸다.
                if verdict == ReviewVerdict::ChangesRequested {
                    self.raise(slot, "review-changes-requested", Some(attempt_id), None);
                }
            }
            let seq = slot.run.bump(
                now,
                Actor::Reviewer,
                "reviewer_reported",
                Some(attempt_id),
                if state == ReviewReportState::Current { verdict.as_str() } else { state.as_str() },
            );
            let mut result = json!({
                "reviewId": review_id,
                "taskId": a.task_id,
                "reportId": of.report_id,
                "verdict": verdict,
                "state": state,
                "latestSeq": seq,
            });
            let warning = match state {
                ReviewReportState::Current => None,
                ReviewReportState::Stale => Some("the report you reviewed was replaced, rejected, cancelled or accepted meanwhile — your verdict is recorded as stale and does not count"),
                ReviewReportState::Late => Some("the run or your session was stopped, or a person started a new coordinator generation — your verdict is recorded as late and does not count"),
            };
            if let (Some(w), Some(o)) = (warning, result.as_object_mut()) {
                o.insert("warning".into(), json!(w));
            }
            slot.run.remember(&key, "report_review", &super::store::request_sha(args), result.clone());
            let detail = OrchestrationAudit {
                gen: slot.run.gen,
                actor: Actor::Reviewer.as_str().into(),
                task_id: Some(a.task_id.clone()),
                attempt_id: Some(attempt_id.to_string()),
                commit_oid: Some(of.commit_oid.clone()),
                outcome: Some(verdict.as_str().into()),
                reason: Some(state.as_str().into()),
                summary_len: Some(summary.chars().count() as u32),
                review_id: Some(review_id.clone()),
                findings: Some(findings.len() as u32),
                ..Default::default()
            };
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit("reviewer_reported", run_id, detail);
        Ok(result)
    }
}
