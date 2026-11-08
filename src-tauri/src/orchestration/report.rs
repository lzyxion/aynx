//! **보고 · 수락**(설계 B · C-2 — G 4단계): 작업자의 `report_done` → 서버가 만드는 `Report`, 조정자 · 사람의 수락 · 반려 ·
//! 뒤집기 → `AcceptedArtifact` · `ReviewRecord`, 보드의 "보고 뒤 변경" 확인.
//!
//! 불변식:
//! - **git 칸은 서버가 읽는다** — `commit_oid`(그 worktree 의 `HEAD`) · `dirty`(`status --porcelain` — 추적 안 된 파일 포함 · 무시 파일 제외) ·
//!   `changed_files`(base 이후 커밋된 변경, 상한 [`CHANGED_FILES_MAX`]). `git -C <worktree>` 를 셸 없이 낱개 인자로 부르고 훅 · fsmonitor 를
//!   끈다(`-c core.hooksPath=<빈 폴더> -c core.fsmonitor=false` — 보고 읽기가 worktree 안의 프로그램을 돌리지 않게). git 은 오케스트레이션
//!   잠금 **밖**에서 돌고, 잠금 안에서 관문을 **다시** 본다(그사이 보고 · 중단이 끼어들 수 있다).
//! - `report_done` 은 **자기 Attempt · 그 Task 의 현재 Attempt** 일 때만(`stale-attempt`) · Attempt 마다 **한 번**(`already-reported`) — 같은
//!   `requestId` 재시도는 처음 결과(작업자의 `requestId` 는 Attempt 이름표를 앞에 붙여 조정자 것과 섞이지 않는다).
//! - Run 이 stopping 이거나 Attempt 가 중단 중 · 중단됨이거나 세대가 바뀐 뒤면 **기록만 하고 `late`** — Task · Attempt 상태는 그대로
//!   (작업자 토큰은 종료 확인까지 살아 있으므로 이 길이 닿는다 — 사용자 결정 1).
//! - 수락 = `AcceptedArtifact` **새로 만들기**(불변). 성공 보고만(`not-success`) · 보고 때 미커밋 변경이 없을 때만(`dirty-report`) · 커밋이
//!   있을 때만(`no-commit`). 반려 · 뒤집기는 `ReviewRecord` 새 줄 — 수락을 뒤집으면 그 기록의 `revoked_at` 을 한 번 채운다(나머지 칸은 그대로).
//! - 조정자는 `reported` Task 만 수락 · 반려한다(2a `not-reported`). 사람은 보드에서 뒤집을 수 있다(수락 ↔ 반려). 병합은 사람만 — 여기 없다.
//! - 감사는 고정 칸만: `worker_reported`(결과 · 커밋 · dirty · late · 요약 **길이** · 파일 **수**) · `task_accepted` / `task_rejected`(검토자 · 뒤집기).

use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};

use super::model::*;
use super::store::{conflict, not_found_run, reason, state_error, OrchError, Orchestration, Slot};
use super::tools::{bad, coordinator_slot, opt_text, req_text, request_id};
use crate::audit::OrchestrationAudit;

/// 요약 · 메모 상한(바이트).
const SUMMARY_MAX: usize = 8 * 1024;
const NOTES_MAX: usize = 16 * 1024;

/// "보고 뒤 변경" 확인에서 한 번에 읽는 worktree 수 상한(보드가 열려 있을 때의 가벼운 확인).
const DRIFT_MAX: usize = 24;

/// worktree 의 지금 git 상태.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorktreeState {
    /// `HEAD` 커밋(빈 저장소면 `None`).
    pub head: Option<String>,
    /// 미커밋 변경(추적 안 된 파일 포함 · 무시 파일 제외).
    pub dirty: bool,
    /// base 이후 커밋된 변경 파일(base 를 줬을 때만).
    pub changed: Vec<String>,
    pub truncated: bool,
    /// 미커밋 변경 파일(추적 안 된 파일 포함 · 무시 파일 제외 — 6단계 `read_worker` 의 changedFiles). 상한 [`CHANGED_FILES_MAX`].
    pub uncommitted: Vec<String>,
    /// 지금 체크아웃한 브랜치(`refs/heads/` 없이 — 분리된 HEAD · 못 읽으면 `None`). 10-15 불일치 판정.
    pub branch: Option<String>,
    /// HEAD 가 base 의 후손(같음 포함)인가 — base 를 줬고 판정했을 때만 `Some`.
    pub descends: Option<bool>,
}

/// worktree git 읽기 손 — `(폴더, base?)` → 상태. 기본은 [`git_probe`], 시험이 갈아 끼운다.
pub(crate) type Probe = Arc<dyn Fn(&Path, Option<&str>) -> Result<WorktreeState, String> + Send + Sync>;

fn hex40(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 진짜 git 으로 읽는다 — **블로킹**. 셸 없음 · 훅 · fsmonitor 끔 · `--no-optional-locks`(작업자의 git 과 `index.lock` 을 다투지 않게).
pub(crate) fn git_probe(dir: &Path, base: Option<&str>) -> Result<WorktreeState, String> {
    if !dir.is_dir() {
        return Err("the worktree folder is missing".into());
    }
    let hooks = format!("core.hooksPath={}", super::worktree::empty_hooks_dir().to_string_lossy());
    let git = |rest: &[&str]| {
        let mut args: Vec<&str> = vec!["-c", &hooks, "-c", "core.fsmonitor=false", "--no-optional-locks"];
        args.extend_from_slice(rest);
        crate::worktree::run_git(dir, &args, crate::worktree::GIT_TIMEOUT)
    };
    let head = git(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])?;
    let head = Some(head.stdout.trim().to_string()).filter(|h| head.ok && hex40(h));
    let status = git(&["status", "--porcelain", "-z", "--untracked-files=normal"])?;
    if !status.ok {
        return Err(crate::worktree::first_line(&crate::worktree::git_failure(&status)));
    }
    let uncommitted = porcelain_z_paths(&status.stdout);
    let sym = git(&["symbolic-ref", "-q", "HEAD"])?;
    let branch = sym
        .stdout
        .trim()
        .strip_prefix("refs/heads/")
        .filter(|_| sym.ok)
        .map(str::to_string);
    let dirty = !status.stdout.trim_matches(|c: char| c == '\0' || c.is_whitespace()).is_empty();
    let mut changed: Vec<String> = Vec::new();
    let mut truncated = false;
    let mut descends = None;
    if let (Some(b), Some(h)) = (base.filter(|b| hex40(b)), head.as_deref()) {
        // 종료 0 = 후손 · 1(stderr 없음) = 아님 · 그 밖은 모름.
        let anc = git(&["merge-base", "--is-ancestor", b, h])?;
        descends = if anc.ok {
            Some(true)
        } else if anc.stderr.trim().is_empty() {
            Some(false)
        } else {
            None
        };
        let d = git(&["diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", b, h, "--"])?;
        if d.ok {
            for name in d.stdout.split('\0').filter(|n| !n.is_empty()) {
                if changed.len() >= CHANGED_FILES_MAX {
                    truncated = true;
                    break;
                }
                changed.push(name.chars().filter(|c| !c.is_control()).collect());
            }
        }
    }
    Ok(WorktreeState {
        head,
        dirty,
        changed,
        truncated,
        uncommitted,
        branch,
        descends,
    })
}

/// `git status --porcelain -z` → 경로들(상한 [`CHANGED_FILES_MAX`]). 줄 = `XY 경로\0`, 이름 바꾸기 · 복사(`R` · `C`)는 원래 경로가
/// 다음 칸에 한 번 더 온다(건너뛴다). 제어 문자는 뺀다.
pub(crate) fn porcelain_z_paths(out: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let mut it = out.split('\0');
    while let Some(rec) = it.next() {
        if rec.len() < 4 || paths.len() >= CHANGED_FILES_MAX {
            continue;
        }
        let xy = &rec[..2];
        paths.push(rec[3..].chars().filter(|c| !c.is_control()).collect());
        if xy.contains('R') || xy.contains('C') {
            it.next();
        }
    }
    paths
}

/// 짧은 한 줄(영속 파일 · 보드) — 제어 문자 · 긴 글을 싣지 않는다.
fn short(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(240).collect()
}

/// `report_done` 의 관문 — 잠금 안에서(두 번) 본다. `late` 인가를 돌려준다.
fn report_gate(run: &Run, attempt_id: &str) -> Result<bool, OrchError> {
    let a = run
        .attempts
        .iter()
        .find(|a| a.id == attempt_id)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt"))?;
    let task = run.task(&a.task_id).ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
    if task.current_attempt.as_deref() != Some(attempt_id) {
        return Err(OrchError::new(
            reason::STALE_ATTEMPT,
            "this attempt is no longer the task's current attempt — a newer worker owns the task, so this report is not taken",
        ));
    }
    if run.report_of(attempt_id).is_some() {
        return Err(OrchError::new(
            reason::ALREADY_REPORTED,
            "this attempt has already reported — an attempt reports once (retry with the same requestId to read the first result)",
        ));
    }
    // 늦은 보고(4-5 — 지금 규칙 그대로): Run 중단 뒤 · 그 Attempt 를 멈추는 중 · 이 턴이 도는 동안 세대가 바뀌었다(이어지는 턴은 그때의 세대로
    // 서므로 — `resume.rs` — 옛 세대의 Attempt 라도 새 턴의 보고는 늦지 않다).
    let late = matches!(run.state, RunState::Stopping | RunState::Stopped)
        || matches!(a.state, AttemptState::Stopping | AttemptState::StopUnconfirmed | AttemptState::Stopped)
        || a.stop_requested
        || a.gen != run.gen;
    // 보고는 **턴 안에서**만(3a — `running`). 옛 상태(2차 PTY)는 옛 파일 읽기용 — 산 Run 에는 없다.
    let open = matches!(
        a.state,
        AttemptState::Running
            | AttemptState::Starting
            | AttemptState::Ready
            | AttemptState::Working
            | AttemptState::AwaitingHuman
            | AttemptState::NeedsRecovery
    );
    if !late && !open {
        return Err(OrchError::new(
            reason::INVALID_STATE,
            format!("the attempt is {} and cannot report now", a.state.as_str()),
        ));
    }
    Ok(late)
}

/// 작업자 호출의 Run(orphaned · 없는 Run 은 `not-found`). 인증(`resolve`)은 Run 이 살아 있을 때만 통하지만, 그 뒤 git 을 읽는 사이
/// 종료 확인으로 `stopped` 가 될 수 있다(실기 — 트리 종료가 수십 ms) — 그 보고도 버리지 않고 `late` 로 적는다(stopping/stopped 규칙).
pub(super) fn worker_run<'g>(g: &'g mut super::store::Inner, run_id: &str) -> Result<&'g mut Slot, OrchError> {
    let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
    if slot.run.state == RunState::Orphaned {
        return Err(not_found_run());
    }
    if !(slot.run.state.active() || slot.run.state == RunState::Stopped) {
        return Err(state_error(slot.run.state));
    }
    Ok(slot)
}

/// 검토 판정 하나(잠금 안) — 조정자 · 사람 공용. 버전 비교는 부르는 쪽이 먼저 한다.
struct Reviewed {
    task: Task,
    artifact: Option<AcceptedArtifact>,
    flipped: bool,
    seq: u64,
}

/// 검토 대상 보고 — 그 Task 의 현재 Attempt 의 늦지 않은 보고.
pub(super) fn review_target(run: &Run, task: &Task) -> Option<Report> {
    task.current_attempt
        .as_deref()
        .and_then(|att| run.report_of(att))
        .filter(|r| !r.late)
        .cloned()
}

/// 수락 관문(1차 그대로 — 통합 설계 4-3 ① 의 앞부분): 현재 보고가 있고 성공 · 불일치 없음 · 미커밋 없음 · 커밋 있음. `(보고, 보고 커밋)`.
/// 동기 수락(1차)과 통합 작업 시작(`integrate::begin_integration`)이 함께 쓴다.
pub(super) fn acceptable(run: &Run, task: &Task) -> Result<(Report, String), OrchError> {
    let task_id = &task.id;
    let r = review_target(run, task).ok_or_else(|| {
        OrchError::new(reason::NOT_REPORTED, format!("task {task_id} has no report from its current attempt"))
    })?;
    if r.outcome != ReportOutcome::Success {
        return Err(OrchError::new(
            reason::NOT_SUCCESS,
            format!("the report is {} — only a success report can be accepted (reject it instead)", r.outcome.as_str()),
        ));
    }
    if r.mismatch.is_some() {
        return Err(OrchError::new(
            reason::REPORT_MISMATCH,
            "the report's branch or commit does not match the attempt (another branch, or not descending from the task's base) — reject it",
        ));
    }
    if r.dirty {
        return Err(OrchError::new(
            reason::DIRTY_REPORT,
            "the worker reported with uncommitted changes — it cannot be accepted; reject it and start a new attempt that commits first",
        ));
    }
    let Some(commit) = r.commit_oid.clone() else {
        return Err(OrchError::new(reason::NO_COMMIT, "the report has no commit — it cannot be accepted"));
    };
    Ok((r, commit))
}

fn review_in(
    slot: &mut Slot,
    task_id: &str,
    decision: Decision,
    reviewer: Reviewer,
    now: u64,
    gate: Option<super::roles::AcceptGate>,
) -> Result<Reviewed, OrchError> {
    let run = &slot.run;
    let task = run
        .task(task_id)
        .cloned()
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")))?;
    let from = task.state;
    // 통합 중인 Task 는 판정을 받지 않는다(통합 설계 2-3 — 사람은 [취소] 로 Job 을 거둔다).
    if from == TaskState::Integrating {
        return Err(OrchError::new(
            reason::TASK_BUSY,
            format!("task {task_id} is being integrated — wait for it (wait_run) or a person cancels it"),
        ));
    }
    // 통합 ref 에 올라간 수락은 뒤집지 않는다(통합 설계 4-7 · D11 — 되돌리기는 사람이 git 으로 직접).
    if decision == Decision::Rejected && run.valid_artifact(task_id).is_some_and(|a| a.integration_commit.is_some()) {
        return Err(OrchError::new(
            reason::ALREADY_INTEGRATED,
            format!("task {task_id} is already in the integration ref — a person reverts it with git, not by rejecting"),
        ));
    }
    // 통합 ref 가 있는 Run 의 수락은 통합 작업만 만든다(통합 설계 2-3 — 수락 = 통합이 선 순간, `accept.rs`).
    if decision == Decision::Accepted && run.integration.is_some() {
        return Err(OrchError::new(
            reason::INTERNAL,
            "accepting in a run with an integration ref goes through the integration job",
        ));
    }
    // 충돌한 Task(통합 설계 2-3 · 4-6)는 반려로 나가거나 해결 Attempt(3b — `spawn_worker`)로 active 가 된다.
    let allowed = match (reviewer, decision) {
        (Reviewer::Coordinator, Decision::Accepted) => from == TaskState::Reported,
        (Reviewer::Coordinator, Decision::Rejected) => matches!(from, TaskState::Reported | TaskState::Conflict),
        (Reviewer::Human, Decision::Accepted) => matches!(from, TaskState::Reported | TaskState::Rejected),
        (Reviewer::Human, Decision::Rejected) => {
            matches!(from, TaskState::Reported | TaskState::Accepted | TaskState::Conflict)
        }
    };
    if !allowed {
        return Err(match (reviewer, from) {
            (Reviewer::Coordinator, _) | (_, TaskState::Todo | TaskState::Active | TaskState::Cancelled) => OrchError::new(
                reason::NOT_REPORTED,
                format!("task {task_id} is {} — only a reported task can be accepted or rejected", from.as_str()),
            ),
            _ => OrchError::new(
                reason::INVALID_STATE,
                format!("task {task_id} is already {}", from.as_str()),
            ),
        });
    }
    let flipped = reviewer == Reviewer::Human && !matches!(from, TaskState::Reported | TaskState::Conflict);
    // 검토 대상 = 그 Task 의 현재 Attempt 의 (늦지 않은) 보고.
    let report = review_target(run, &task);
    let mut artifact = None;
    match decision {
        Decision::Accepted => {
            let (r, commit) = acceptable(run, &task)?;
            let gate = gate.unwrap_or_default();
            artifact = Some(AcceptedArtifact {
                task_id: task_id.to_string(),
                attempt_id: r.attempt_id.clone(),
                report_id: r.report_id.clone(),
                commit_oid: commit,
                base_commit_oid: r.base_commit_oid.clone(),
                reviewer,
                verification: None,
                accepted_at: now,
                revoked_at: None,
                revoked_by: None,
                integration_commit: None,
                integration_parent: None,
                job_id: None,
                preserve_ref: None,
                review_id: gate.judgments.last().cloned(),
                review_waived_by: (!gate.waived.is_empty()).then_some(reviewer),
                waived_by: (!gate.waived.is_empty()).then_some(reviewer),
                waived: gate.waived,
                judgments: gate.judgments,
            });
        }
        Decision::Rejected => {}
    }
    // 대상 보고가 판정됐다 — 그 보고의 활성 검토는 무효화(5단계 — 반려 · 수락). 멈춤은 부른 쪽이 잠금 밖에서(`drain_stops`).
    let actor = match reviewer {
        Reviewer::Coordinator => Actor::Coordinator,
        Reviewer::Human => Actor::Human,
    };
    super::review::invalidate(slot, task_id, now, actor, decision_word(decision));
    if decision == Decision::Rejected {
        // 반려 — 그 Task 의 열린 작업자는 닫는다(4-5 닫는 사건 · `idle` 은 곧바로 · 도는 턴은 멈춤 — 부른 쪽이 `drain_stops`).
        super::attempts::close_task_workers(slot, task_id, now, actor);
    }
    let run = &mut slot.run;
    if decision == Decision::Rejected {
        // 뒤집기 — 유효한 수락을 거둔다(그 칸 둘만 한 번 채운다 · 기록은 남는다).
        for a in run.accepted.iter_mut().filter(|a| a.task_id == task_id && a.revoked_at.is_none()) {
            a.revoked_at = Some(now);
            a.revoked_by = Some(reviewer);
        }
    }
    if let Some(a) = &artifact {
        run.accepted.push(a.clone());
    }
    run.reviews.push(ReviewRecord {
        task_id: task_id.to_string(),
        attempt_id: report.as_ref().map(|r| r.attempt_id.clone()).or_else(|| task.current_attempt.clone()),
        report_id: report.as_ref().map(|r| r.report_id.clone()),
        decision,
        reviewer,
        flipped,
        at: now,
    });
    let new_state = match decision {
        Decision::Accepted => TaskState::Accepted,
        Decision::Rejected => TaskState::Rejected,
    };
    let Some(t) = run.tasks.iter_mut().find(|t| t.id == task_id) else {
        return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
    };
    t.state = new_state;
    t.conflict = None; // 수락 · 반려 — 충돌 기록은 뜻을 잃었다(#7a).
    if decision == Decision::Rejected && from == TaskState::Reported {
        // 되돌림 셈(3-2a — `reported → rejected` 만 · 사람 뒤집기 · 충돌 반려는 세지 않는다).
        t.rework_count += 1;
    }
    t.version += 1;
    t.updated_at = now;
    let task = t.clone();
    let action = match decision {
        Decision::Accepted => "task_accepted",
        Decision::Rejected => "task_rejected",
    };
    let seq = run.bump(now, actor, action, Some(task_id), reviewer.as_str());
    Ok(Reviewed {
        task,
        artifact,
        flipped,
        seq,
    })
}

fn review_audit(gen: u32, r: &Reviewed, reviewer: Reviewer) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: match reviewer {
            Reviewer::Coordinator => Actor::Coordinator,
            Reviewer::Human => Actor::Human,
        }
        .as_str()
        .into(),
        task_id: Some(r.task.id.clone()),
        task_version: Some(r.task.version),
        task_state: Some(r.task.state.as_str().into()),
        title_len: Some(r.task.title.chars().count() as u32),
        attempt_id: r.artifact.as_ref().map(|a| a.attempt_id.clone()),
        commit_oid: r.artifact.as_ref().map(|a| a.commit_oid.clone()),
        reviewer: Some(reviewer.as_str().into()),
        flipped: Some(r.flipped),
        ..Default::default()
    }
}

fn decision_word(d: Decision) -> &'static str {
    match d {
        Decision::Accepted => "accepted",
        Decision::Rejected => "rejected",
    }
}

fn review_event(d: Decision) -> &'static str {
    match d {
        Decision::Accepted => "task_accepted",
        Decision::Rejected => "task_rejected",
    }
}

/// `blocked` 의 "필요한 것" 글(작업자가 쓴 글 — 정화 · 1 KiB 까지). 영속 · 보드 · 조정자에만(감사에는 길이 · 해시).
fn need_text(s: &str) -> String {
    let t = super::spawn::sanitize_text(s);
    let t = t.trim();
    let mut end = t.len().min(1024);
    while !t.is_char_boundary(end) {
        end -= 1;
    }
    t[..end].to_string()
}

/// 글의 SHA-1(hex) — 감사에 본문 대신.
fn sha1_hex(s: &str) -> String {
    use sha1::{Digest, Sha1};
    Sha1::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

impl Orchestration {
    /// `blocked` 보고(잠금 안 — 헤드리스 설계 4-6 · D7): 보고를 만들지 않고 Attempt 에 표지 · 사건 `worker_blocked` · 감독 알림. 턴이 끝나면
    /// `idle` + 표지(닫히지 않는다 — 같은 Attempt 를 `send_prompt` 로 resume). `(답, 감사)`.
    fn blocked_in(&self, slot: &mut Slot, attempt_id: &str, key: &str, sha: &str, need: String) -> (Value, OrchestrationAudit) {
        let now = self.now();
        let task_id = slot.run.attempts.iter().find(|a| a.id == attempt_id).map(|a| a.task_id.clone()).unwrap_or_default();
        if let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) {
            a.blocked = Some(Blocked { need: need.clone(), at: now });
        }
        let seq = slot.run.bump(now, Actor::Worker, "worker_blocked", Some(attempt_id), "blocked");
        self.raise(slot, "worker-blocked", Some(attempt_id), None);
        let task_state = slot.run.task(&task_id).map(|t| t.state);
        let result = json!({
            "attemptId": attempt_id,
            "taskId": task_id,
            "outcome": "blocked",
            "blocked": true,
            "taskState": task_state,
            "latestSeq": seq,
            "note": "Recorded as blocked — your attempt stays open and your changes stay in the worktree. End your turn now (do not revert anything); the coordinator tells a person what you need and resumes you in this same conversation once it is allowed.",
        });
        slot.run.remember(key, "report_done", sha, result.clone());
        let detail = OrchestrationAudit {
            gen: slot.run.gen,
            actor: Actor::Worker.as_str().into(),
            task_id: Some(task_id),
            attempt_id: Some(attempt_id.to_string()),
            outcome: Some("blocked".into()),
            text_len: Some(need.len() as u32),
            text_sha1: Some(sha1_hex(&need)),
            ..Default::default()
        };
        (result, detail)
    }

    /// 작업자 `report_done` — 머리말의 관문 → (잠금 밖) git → (잠금 안) 관문 다시 · `Report` · 상태.
    pub(super) fn report_done(&self, run_id: &str, attempt_id: &str, args: Option<&Value>) -> Result<Value, OrchError> {
        let request = request_id(args)?;
        let key = format!("{attempt_id}:{request}");
        let outcome = ReportOutcome::parse(&req_text(args, "outcome", 16)?)
            .ok_or_else(|| bad("outcome must be success, failure or blocked"))?;
        let summary = req_text(args, "summary", SUMMARY_MAX)?;
        let notes = opt_text(args, "notes", NOTES_MAX)?.filter(|n| !n.trim().is_empty());
        // 1. 관문 + worktree 자리(잠금 안 — 짧게). 해결 Attempt 의 성공 보고는 `resolved` 가 충돌 경로 전부를 덮어야 한다(통합 설계 3-2).
        let (path, base, want_branch, resolve) = {
            let mut g = self.lock();
            let slot = worker_run(&mut g, run_id)?;
            if let Some(first) = super::store::request_seen(slot, &key, "report_done", &super::store::request_sha(args))? {
                return Ok(first);
            }
            let late = report_gate(&slot.run, attempt_id)?;
            // `blocked` 는 **비종결**(헤드리스 설계 4-6 · D7) — 보고를 만들지 않는다(뒤의 `commit_changes` · resume 이 막히지 않게). 턴이 끝나면
            // `idle` + 표지. 늦은 blocked 는 옛 규칙대로 늦은 보고로 적는다(Task 상태는 그대로).
            if outcome == ReportOutcome::Blocked && !late {
                let need = need_text(notes.as_deref().unwrap_or(&summary));
                let (result, detail) = self.blocked_in(slot, attempt_id, &key, &super::store::request_sha(args), need);
                self.after_change(&g, run_id);
                drop(g);
                self.audit("worker_blocked", run_id, detail);
                return Ok(result);
            }
            let a = slot.run.attempts.iter().find(|a| a.id == attempt_id).ok_or_else(not_found_run)?;
            let resolve = match super::resolve::resolve_info(&slot.run, a) {
                Some(info) if outcome == ReportOutcome::Success && !late => {
                    let paths = super::resolve::conflict_paths(info);
                    let resolved = super::resolve::check_resolved(super::tools::arg(args, "resolved"), &paths)?;
                    Some((super::resolve::marker_check(info), resolved))
                }
                _ => None,
            };
            (a.worktree.clone(), a.base_commit.clone(), a.branch.clone(), resolve)
        };
        // 2. git — 잠금 밖(블로킹).
        let probed = match path.as_deref() {
            Some(p) => (self.probe())(Path::new(p), base.as_deref()),
            None => Err("the attempt has no worktree".into()),
        };
        // 2b. 해결 Attempt — 보고할 커밋의 충돌 경로에 표식이 남았으면 받지 않는다(작업자가 `commit_changes` 밖에서 커밋했어도).
        if let (Some((check, _)), Ok(state), Some(p)) = (&resolve, &probed, path.as_deref()) {
            if let Some(head) = state.head.as_deref() {
                let env = super::git::child_env(std::env::vars_os());
                let hooks = super::worktree::empty_hooks_dir();
                let g = super::git::Git::new(Path::new(p), &hooks, &env, reason::GIT_FAILED)?;
                let left = super::resolve::markers_left_blocking(&g, head, check)?;
                if !left.is_empty() {
                    return Err(super::resolve::markers_left_error(&left));
                }
            }
        }
        let resolved = resolve.map(|(_, r)| r).unwrap_or_default();
        let report_id = new_id("rep").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        // 3. 잠금 안 — 관문 다시 · 기록 · 상태.
        let (result, detail) = {
            let mut g = self.lock();
            let slot = worker_run(&mut g, run_id)?;
            if let Some(first) = super::store::request_seen(slot, &key, "report_done", &super::store::request_sha(args))? {
                return Ok(first);
            }
            let late = report_gate(&slot.run, attempt_id)?;
            let task_id = slot
                .run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id)
                .map(|a| a.task_id.clone())
                .unwrap_or_default();
            let (state, git_error) = match probed {
                Ok(s) => (s, None),
                Err(e) => (WorktreeState::default(), Some(short(&e))),
            };
            // 자문 6절 표 — 브랜치가 바뀌었거나 HEAD 가 기준의 후손이 아니면 불일치(수락 불가), HEAD 그대로 + 깨끗하면 `no_changes`.
            let mismatch = match (&state.branch, &want_branch) {
                (Some(now), Some(want)) if now != want => Some("branch-changed".to_string()),
                _ if state.descends == Some(false) => Some("unexpected-head".to_string()),
                _ => None,
            };
            let no_changes = git_error.is_none()
                && !state.dirty
                && state.head.is_some()
                && state.head.as_deref() == base.as_deref();
            let report = Report {
                report_id: report_id.clone(),
                attempt_id: attempt_id.to_string(),
                task_id: task_id.clone(),
                outcome,
                summary: summary.clone(),
                notes,
                commit_oid: state.head.clone(),
                base_commit_oid: base.clone(),
                dirty: state.dirty,
                changed_files: state.changed.clone(),
                changed_files_truncated: state.truncated,
                git_error,
                no_changes,
                mismatch: mismatch.clone(),
                at: now,
                late,
                resolved,
            };
            slot.run.reports.push(report.clone());
            let mut task_state = slot.run.task(&task_id).map(|t| t.state);
            if !late {
                // 보고가 바뀌었다 — 옛 보고의 활성 검토는 무효화(5단계 · 3-3).
                super::review::invalidate(slot, &task_id, now, Actor::Worker, "new-report");
                // (3a) Attempt 는 `running` 그대로 — 턴이 끝나면(트리 종료 확인) 보고가 있으니 `reported`(닫힘)가 된다. 보고 뒤 자동 종료는 없다
                // (헤드리스는 턴이 끝나면 스스로 끝난다 — E4). `blocked` 표지는 성공 · 실패 보고가 덮는다.
                if let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) {
                    a.attention = None;
                    a.blocked = None;
                }
                if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id && t.state == TaskState::Active) {
                    t.state = TaskState::Reported;
                    t.version += 1;
                    t.updated_at = now;
                    task_state = Some(t.state);
                }
            }
            let seq = slot.run.bump(
                now,
                Actor::Worker,
                "worker_reported",
                Some(attempt_id),
                if late { "late" } else { outcome.as_str() },
            );
            let mut result = json!({
                "reportId": report_id,
                "attemptId": attempt_id,
                "taskId": task_id,
                "outcome": outcome,
                "commitOid": report.commit_oid,
                "dirty": report.dirty,
                "changedFiles": report.changed_files.len(),
                "noChanges": report.no_changes,
                "mismatch": report.mismatch,
                "late": late,
                "taskState": task_state,
                "latestSeq": seq,
            });
            let warning = if late {
                Some("the run or this attempt was stopped, or a person started a new coordinator generation — the report is recorded as late and changes no task state")
            } else if report.git_error.is_some() {
                Some("the app could not read git in your worktree — this report has no commit and cannot be accepted")
            } else if report.mismatch.as_deref() == Some("branch-changed") {
                Some("your worktree is not on your attempt's branch — this report cannot be accepted")
            } else if report.mismatch.is_some() {
                Some("your branch no longer descends from the task's base commit — this report cannot be accepted")
            } else if report.dirty && outcome == ReportOutcome::Success {
                Some("you reported with uncommitted changes — a success report with uncommitted changes cannot be accepted (commit them with commit_changes before report_done next time)")
            } else if report.no_changes && outcome == ReportOutcome::Success {
                Some("your branch has no new commit and no changes — the report says nothing was changed")
            } else {
                None
            };
            if let (Some(w), Some(o)) = (warning, result.as_object_mut()) {
                o.insert("warning".into(), json!(w));
            }
            slot.run.remember(&key, "report_done", &super::store::request_sha(args), result.clone());
            let detail = OrchestrationAudit {
                gen: slot.run.gen,
                actor: Actor::Worker.as_str().into(),
                task_id: Some(task_id.clone()),
                task_state: task_state.map(|s| s.as_str().into()),
                attempt_id: Some(attempt_id.to_string()),
                attempt_state: slot
                    .run
                    .attempts
                    .iter()
                    .find(|a| a.id == attempt_id)
                    .map(|a| a.state.as_str().into()),
                outcome: Some(outcome.as_str().into()),
                commit_oid: report.commit_oid.clone(),
                dirty: Some(report.dirty),
                late: Some(late),
                summary_len: Some(summary.chars().count() as u32),
                changed_files: Some(report.changed_files.len() as u32),
                ..Default::default()
            };
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit("worker_reported", run_id, detail);
        self.drain_stops(run_id);
        Ok(result)
    }

    /// 조정자의 수락 · 반려(`update_task{state: accepted|rejected}` — `tools.rs` 가 넘긴다). 버전 비교 · 멱등은 2a 그대로.
    pub(super) fn coordinator_review(
        &self,
        run_id: &str,
        gen: u32,
        args: Option<&Value>,
        task_id: &str,
        version: u64,
        decision: Decision,
    ) -> Result<Value, OrchError> {
        let request = request_id(args)?;
        // 통합 ref 가 있는 Run 의 수락은 비동기 통합 작업(통합 설계 3-1 — `accept.rs`).
        if decision == Decision::Accepted && self.has_integration(run_id) {
            return self.coordinator_accept(run_id, gen, args, task_id, version, &request);
        }
        // 수락 규칙(E18 — 조정자 수락 순간에 지금 맡기기로). 맡기기는 잠금 밖에서 읽는다.
        let lookup = (decision == Decision::Accepted).then(|| self.run_inputs(run_id));
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request, "update_task", &super::store::request_sha(args))? {
                return Ok(first);
            }
            super::store::writable(&slot.run)?;
            let Some(current) = slot.run.task(task_id) else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if current.version != version {
                return Err(conflict(current));
            }
            let gate = match &lookup {
                Some(l) => {
                    if current.state == TaskState::Reported {
                        Some(l.accept_gate(&slot.run, current, Reviewer::Coordinator)?)
                    } else {
                        None
                    }
                }
                None => None,
            };
            let r = review_in(slot, task_id, decision, Reviewer::Coordinator, now, gate)?;
            let result = json!({ "task": r.task, "accepted": r.artifact, "latestSeq": r.seq });
            slot.run.remember(&request, "update_task", &super::store::request_sha(args), result.clone());
            let detail = review_audit(slot.run.gen, &r, Reviewer::Coordinator);
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit(review_event(decision), run_id, detail);
        self.drain_stops(run_id);
        Ok(result)
    }

    /// 사람의 [수락] · [반려] · [뒤집기](보드 — op `orchestration_review_task`). running · paused · stopping 에서(중단 중에도 결과를 정리할 수 있게).
    pub(crate) fn human_review(&self, run_id: &str, task_id: &str, version: u64, decision: Decision) -> Result<Value, OrchError> {
        // 통합 ref 가 있는 Run 의 [수락]은 비동기 통합 작업(통합 설계 3-1) — 답은 Job 보기.
        if decision == Decision::Accepted && self.has_integration(run_id) {
            return self.human_accept(run_id, task_id, version);
        }
        // 사람 수락은 규칙을 넘고 면제를 기록한다(E18) — 무엇을 넘었는지 알려고 맡기기를 읽는다(잠금 밖).
        let lookup = (decision == Decision::Accepted).then(|| self.run_inputs(run_id));
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
            match slot.run.state {
                RunState::Running | RunState::Paused | RunState::Stopping => {}
                s => return Err(state_error(s)),
            }
            let Some(current) = slot.run.task(task_id) else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if current.version != version {
                return Err(conflict(current));
            }
            let gate = match &lookup {
                Some(l) => Some(l.accept_gate(&slot.run, current, Reviewer::Human)?),
                None => None,
            };
            let r = review_in(slot, task_id, decision, Reviewer::Human, now, gate)?;
            let result = json!({ "task": r.task, "accepted": r.artifact, "flipped": r.flipped, "latestSeq": r.seq });
            let detail = review_audit(slot.run.gen, &r, Reviewer::Human);
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit(review_event(decision), run_id, detail);
        self.drain_stops(run_id);
        Ok(result)
    }

    /// 통합 ref 가 있는 Run 인가(수락 길 가르기).
    fn has_integration(&self, run_id: &str) -> bool {
        self.lock().runs.get(run_id).is_some_and(|s| s.run.integration.is_some())
    }

    /// "보고 뒤 변경"(보드 — op `orchestration_report_drift`) — 보고가 있는 Attempt 의 worktree 를 지금 읽어 보고 때와 견준다
    /// (`HEAD` 가 보고 커밋과 다르거나 미커밋 여부가 다르면 `changedSinceReport`). **블로킹**(git) · 잠금 밖. 보드가 열려 있을 때만 부른다.
    pub(crate) fn report_drift(&self, run_id: &str) -> Result<Value, OrchError> {
        let items: Vec<(String, String, String, Option<String>, bool)> = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            slot.run
                .reports
                .iter()
                .rev()
                .filter_map(|r| {
                    let a = slot.run.attempts.iter().find(|a| a.id == r.attempt_id)?;
                    let wt = a.worktree.clone()?;
                    Some((r.attempt_id.clone(), r.report_id.clone(), wt, r.commit_oid.clone(), r.dirty))
                })
                .take(DRIFT_MAX)
                .collect()
        };
        let probe = self.probe();
        let out: Vec<Value> = items
            .into_iter()
            .map(|(att, rep, wt, commit, dirty)| match probe(Path::new(&wt), None) {
                Ok(s) => json!({
                    "attemptId": att,
                    "reportId": rep,
                    "head": s.head,
                    "dirty": s.dirty,
                    "changedSinceReport": s.head != commit || s.dirty != dirty,
                }),
                Err(e) => json!({
                    "attemptId": att,
                    "reportId": rep,
                    "error": short(&e),
                    "changedSinceReport": false,
                }),
            })
            .collect();
        Ok(Value::Array(out))
    }
}
