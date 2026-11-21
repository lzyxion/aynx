//! 통합 — Run 의 통합 ref · 비동기 수락 · 외부 변경 보류 · [조정] · 브랜치 내보내기(docs/log/2026-10-15-orchestration-integration-design.md).
//!
//! 수락 흐름: 관문(`begin_in` — Job `prepared` · Task `integrating`)을 지나면 곧바로 답하고, 따로 스레드([`Orchestration::drive_job`])가
//! 통합 머리 확인 → 지원 범위 → `merge-tree` → squash 커밋 + 후보 ref → 검증 → `commit_job`(의도 저장 확인 뒤 ref 트랜잭션). 충돌이면 커밋을 만들지 않는다.
//!
//! 불변식:
//! - **수락 = 통합이 선 순간** — 통합 ref 가 있는 Run 에서 동기 수락(`report::review_in` 의 산출물)은 만들지 않는다.
//! - **조정자 길은 `coordinator_slot`**(세대 · 분당 한도 · 다른 Run 은 not-found)을 지난다 — 사람 길(`human_slot`)과 섞지 않는다.
//! - 통합 ref 는 **서버만 앞으로 쌓는다** — 서버는 자기가 아는 머리(`expectedHead`)만 이어 쓰고, 다르면 자동 채택하지 않고 Run 보류.
//!   보류는 사람의 [조정](되돌리기 · 받아들이기)으로만 풀린다. 되돌리기는 사람이 올린 머리를 `diverged/<n>` 에 보존한다.
//! - 새 Attempt 의 기준 = 통합 머리 — 조정자의 `base` 인자는 거절(조용히 무시하지 않는다). 의존 Task 결과는 통합 ref 가 품는다.
//! - 내보내기는 사람(또는 Run 완료)만 · 체크아웃된 브랜치는 거절 · 사람이 바꾼 브랜치는 덮지 않는다(CAS).
//! - git 은 모두 잠금 **밖**(공용 실행기 — 셸 없음 · `GIT_*` 걷기 · 훅 끔). 잠금 안에서는 다시 판정만 한다.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};

use super::integrate::{abort_job_in, begin_in, refs, set_hold, IntegrationGit, MergeResult, TxOutcome, NO_GIT_IDENTITY};
use super::merge::{self, RefOp, SquashMeta, MIN_GIT};
use super::model::*;
use super::report::acceptable;
#[cfg(test)]
use super::store::StartRun;
use super::store::{
    human_detail, human_slot, not_found_run, reason, request_seen, revoke_run, settle_stopping, OrchError,
    Orchestration, Slot,
};
use super::tools::{coordinator_gate, coordinator_slot};
use crate::audit::OrchestrationAudit;
use crate::server::log;

fn short(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(240).collect()
}

fn git_failed(e: String) -> OrchError {
    OrchError::new(reason::INTEGRATION_FAILED, short(&e))
}

fn unsupported(why: &str) -> OrchError {
    OrchError::new(
        reason::GIT_UNSUPPORTED,
        format!(
            "{why} — this repository's git settings are outside what the app integrates automatically (custom merge drivers or merge.default, \
             filters such as Git LFS, merge.renormalize, submodules); a person must merge this task's commit by hand"
        ),
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Notify {
    /// Run 보류.
    Diverged,
    /// 저장소 신원이 Run 이 처음 읽은 것과 다르다 — Run 보류.
    Identity,
    Human(&'static str),
}

impl Orchestration {
    /// 통합 작업이 따로 스레드에서 돌게 약한 참조를 둔다 — 없으면 부른 스레드에서 끝까지 돈다.
    pub(crate) fn install_self(self: &Arc<Self>) {
        *self.me.write().unwrap_or_else(|e| e.into_inner()) = Arc::downgrade(self);
        self.install_save_hook();
    }

    fn hand(&self) -> Result<Arc<dyn IntegrationGit>, OrchError> {
        self.integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))
    }

    // -----------------------------------------------------------------------
    // Run 시작
    // -----------------------------------------------------------------------

    /// 시험 전용 입구(조정자 묶음 없이) — 제품에서 Run 을 여는 길은 사람의 앨범 시작(`album_start.rs`) 하나다.
    #[cfg(test)]
    pub(crate) fn start_integrated_run(&self, s: StartRun) -> Result<(String, u32), OrchError> {
        let (id, integration) = self.prepare_integration(&s.repo)?;
        self.start_run_core(s.clone(), id, Some(integration.clone())).inspect_err(|_| {
            self.discard_integration(&s.repo, &integration);
        })
    }

    /// Run을 세우기 전의 통합 ref 준비. 앨범 시작은 이 뒤 프로듀서 세대가 준비돼야 확정한다.
    pub(super) fn prepare_integration(&self, path: &str) -> Result<(String, Integration), OrchError> {
        let git = self.hand()?;
        let repo = PathBuf::from(path);
        let v = git.git_version(&repo).map_err(git_failed)?;
        if v < MIN_GIT {
            return Err(OrchError::new(
                reason::GIT_TOO_OLD,
                format!(
                    "git {}.{} is older than {}.{} — the app needs it to integrate results (merge-tree --merge-base · --attr-source)",
                    v.0, v.1, MIN_GIT.0, MIN_GIT.1
                ),
            ));
        }
        let (oid, branch) = git
            .head(&repo)
            .map_err(git_failed)?
            .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "the repo has no commit yet — commit once before starting a run"))?;
        // ref 이름은 Run id 의 짧은 이름이라 겹칠 수 있다 — 옛 Run 의 ref 가 남아 있으면 다시 뽑는다(두 Run 이 한 ref 를 나눠 쓰지 않게).
        let mut id = None;
        for _ in 0..8 {
            let cand = new_id("run").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
            let taken = match git.list_refs(&repo, &refs::run_prefix(&cand)) {
                Ok(listed) => !listed.is_empty(),
                Err(_) => git.read_ref(&repo, &refs::int(&cand)).map_err(git_failed)?.is_some(),
            };
            if !taken {
                id = Some(cand);
                break;
            }
        }
        let id = id.ok_or_else(|| {
            OrchError::new(reason::INTEGRATION_FAILED, "could not find a free integration ref name in this repo — try again")
        })?;
        let work_ref = refs::int(&id);
        match git.update_refs(&repo, &[RefOp::Create { name: work_ref.clone(), new: oid.clone() }]) {
            Ok(TxOutcome::Committed) => {}
            Ok(TxOutcome::Refused(l)) | Err(l) => {
                return Err(OrchError::new(
                    reason::INTEGRATION_FAILED,
                    format!("could not create the integration ref: {}", short(&l)),
                ))
            }
        }
        let integration = Integration {
            work_ref: work_ref.clone(),
            export_branch: merge::export_branch_name(&id),
            base_commit: oid.clone(),
            base_branch: branch,
            expected_head: oid.clone(),
            exported_head: None,
            work_ref_removed: false,
        };
        Ok((id, integration))
    }

    /// 확정 전 실패의 ref 회수(CAS — 사람이 바꾼 ref는 덮지 않는다).
    pub(super) fn discard_integration(&self, repo: &str, integration: &Integration) {
        if let Some(git) = self.integrator() {
            let _ = git.update_refs(&PathBuf::from(repo), &[RefOp::Delete {
                name: integration.work_ref.clone(), old: integration.expected_head.clone(),
            }]);
        }
    }

    // -----------------------------------------------------------------------
    // 비동기 수락
    // -----------------------------------------------------------------------

    /// 곧바로 `git-unsupported` 를 돌려주려는 미리 검사일 뿐 — 통합 작업이 같은 검사를 다시 한다(그사이 설정이 바뀔 수 있다).
    fn accept_preflight(&self, run_id: &str, task_id: &str) -> Result<(), OrchError> {
        let Some(git) = self.integrator() else { return Ok(()) };
        let (repo, old, commit, base) = {
            let g = self.lock();
            let Some(slot) = g.runs.get(run_id) else { return Ok(()) };
            let (Some(integ), Some(task)) = (&slot.run.integration, slot.run.task(task_id)) else {
                return Ok(());
            };
            let Ok((r, commit)) = acceptable(&slot.run, task) else { return Ok(()) };
            let Some(base) = r.base_commit_oid else { return Ok(()) };
            (PathBuf::from(&slot.run.repo), integ.expected_head.clone(), commit, base)
        };
        match git.unsupported(&repo, &old, &commit, &base) {
            Ok(Some(why)) => Err(unsupported(why)),
            _ => Ok(()),
        }
    }

    /// 같은 `requestId` 는 처음 결과.
    pub(super) fn coordinator_accept(
        &self,
        run_id: &str,
        gen: u32,
        args: Option<&Value>,
        task_id: &str,
        version: u64,
        request: &str,
    ) -> Result<Value, OrchError> {
        let now = self.now();
        // 세대 · 한도 · 자기 Run 을 git 보다 먼저 — 낡은 조정자가 git 을 읽게 하지 못한다.
        {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = request_seen(slot, request, "update_task", &super::store::request_sha(args))? {
                return Ok(first);
            }
        }
        self.accept_preflight(run_id, task_id)?;
        let lookup = self.run_inputs(run_id);
        let (result, detail, created) = {
            let mut g = self.lock();
            // 그사이 세대가 바뀌었을 수 있다 — 다시 본다(한도는 이미 셌다).
            let slot = coordinator_gate(&mut g, run_id, gen, args)?;
            if let Some(first) = request_seen(slot, request, "update_task", &super::store::request_sha(args))? {
                return Ok(first);
            }
            lookup.remember(slot);
            let (v, detail, created) = match begin_in(slot, task_id, version, Reviewer::Coordinator, request, now, &lookup) {
                Ok(x) => x,
                Err(e) => {
                    if e.code == reason::ACCEPT_RULE_UNMET {
                        // 감사에는 역할 id 낱말만.
                        let unmet: Vec<String> = serde_json::from_str::<Value>(&e.message)
                            .ok()
                            .and_then(|v| v["unmet"].as_array().map(|a| a.iter().filter_map(|u| u["role"].as_str().map(str::to_string)).collect()))
                            .unwrap_or_default();
                        let gen = slot.run.gen;
                        drop(g);
                        self.audit(
                            "accept_refused",
                            run_id,
                            crate::audit::OrchestrationAudit {
                                gen,
                                actor: super::model::Actor::Coordinator.as_str().into(),
                                task_id: Some(task_id.to_string()),
                                unmet: Some(unmet),
                                ..Default::default()
                            },
                        );
                    }
                    return Err(e);
                }
            };
            let result = json!({
                "task": v["task"],
                "jobId": v["jobId"],
                "accepting": true,
                "latestSeq": slot.run.seq,
            });
            slot.run.remember(request, "update_task", &super::store::request_sha(args), result.clone());
            self.after_change(&g, run_id);
            (result, detail, created)
        };
        if let Some(d) = detail {
            self.audit("task_integrating", run_id, d);
        }
        if let Some(job) = created {
            self.launch_job(run_id, &job);
        }
        Ok(result)
    }

    pub(super) fn human_accept(&self, run_id: &str, task_id: &str, version: u64) -> Result<Value, OrchError> {
        self.accept_preflight(run_id, task_id)?;
        let request = new_id("hacc").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let (v, created) = self.begin_human(run_id, task_id, version, Reviewer::Human, &request)?;
        if let Some(job) = created {
            self.launch_job(run_id, &job);
        }
        Ok(v)
    }

    pub(super) fn launch_job(&self, run_id: &str, job_id: &str) {
        let me = self.me.read().unwrap_or_else(|e| e.into_inner()).upgrade();
        if let Some(me) = me {
            let (r, j) = (run_id.to_string(), job_id.to_string());
            if std::thread::Builder::new()
                .name("orchestration-integrate".into())
                .spawn(move || me.drive_job(&r, &j))
                .is_ok()
            {
                return;
            }
        }
        self.drive_job(run_id, job_id);
    }

    /// 블로킹(git · 디스크). 그사이 취소 · 중단 · 세대 교체로 Job 이 끝났으면 거기서 멈춘다.
    pub(crate) fn drive_job(&self, run_id: &str, job_id: &str) {
        let Some(git) = self.integrator() else {
            self.fail_job(run_id, job_id, "integration-failed:no-git", Notify::Human("integration-failed"));
            return;
        };
        let snap = {
            let g = self.lock();
            g.runs.get(run_id).filter(|s| s.run.state != RunState::Orphaned).and_then(|s| {
                let job = s.run.jobs.iter().find(|j| j.job_id == job_id && j.phase == JobPhase::Prepared)?.clone();
                let integ = s.run.integration.clone()?;
                let title = s.run.task(&job.task_id).map(|t| t.title.clone()).unwrap_or_default();
                let summary = s
                    .run
                    .reports
                    .iter()
                    .find(|r| r.report_id == job.report_id)
                    .map(|r| r.summary.clone())
                    .unwrap_or_default();
                Some((PathBuf::from(&s.run.repo), integ, job, title, summary))
            })
        };
        let Some((repo, integ, job, title, summary)) = snap else { return };
        let fail = |why: &str, n: Notify| self.fail_job(run_id, job_id, why, n);
        // 같은 경로에 다시 clone 한 저장소 등 — 신원이 다르면 시작하지 않고 Run 보류.
        if self.identity_drifted(run_id) {
            return fail("repo-identity-changed", Notify::Identity);
        }
        // 서버가 아는 머리일 때만 이어 쓴다.
        let old = match git.read_ref(&repo, &integ.work_ref) {
            Ok(Some(o)) if o == integ.expected_head => o,
            Ok(_) => return fail("moved", Notify::Diverged),
            Err(e) => {
                log::line(format!("orchestration — {run_id}: could not read the integration ref: {}", short(&e)));
                return fail("integration-failed:read-ref", Notify::Human("integration-failed"));
            }
        };
        let Some(base) = job.merge_base.clone() else {
            return fail("integration-failed:no-base", Notify::Human("integration-failed"));
        };
        // merge-tree 는 조상이 아닌 기준도 그대로 받는다 — 여기서 막는다.
        match (
            git.is_ancestor(&repo, &base, &old),
            git.is_ancestor(&repo, &base, &job.report_commit),
        ) {
            (Ok(true), Ok(true)) => {}
            (Ok(_), Ok(_)) => return fail("integration-failed:base-not-ancestor", Notify::Human("integration-failed")),
            _ => return fail("integration-failed:git", Notify::Human("integration-failed")),
        }
        // 지원 범위 — 드라이버 · 필터의 임의 실행을 막는 관문.
        match git.unsupported(&repo, &old, &job.report_commit, &base) {
            Ok(None) => {}
            Ok(Some(why)) => return fail(&format!("git-unsupported:{why}"), Notify::Human("integration-unsupported")),
            Err(e) => {
                log::line(format!("orchestration — {run_id}: support check failed: {}", short(&e)));
                return fail("integration-failed:git", Notify::Human("integration-failed"));
            }
        }
        let merged = match git.merge(&repo, &base, &old, &job.report_commit) {
            Ok(m) => m,
            Err(e) => {
                log::line(format!("orchestration — {run_id}: merge-tree failed: {}", short(&e)));
                return fail("integration-failed:merge", Notify::Human("integration-failed"));
            }
        };
        let tree = match &merged {
            MergeResult::Clean { tree } => tree.clone(),
            MergeResult::Conflict(p) => p.tree.clone(),
            MergeResult::Failed(line) => {
                log::line(format!("orchestration — {run_id}: merge-tree refused: {}", short(line)));
                return fail("integration-failed:merge", Notify::Human("integration-failed"));
            }
        };
        if let MergeResult::Conflict(p) = merged {
            // 충돌 — 후보를 만들지 않는다. 충돌 트리는 해결 Attempt 의 재료로 따로 붙잡는다.
            let msg = format!("Aynx conflict tree (not an integration)\n\nAynx-Run: {run_id}\nAynx-Task: {}\n", job.task_id);
            let cc = git.commit_tree(&repo, &p.tree, &old, &msg).ok();
            if let Some(c) = &cc {
                let op = RefOp::Update { name: refs::conflict(&refs::base_of(run_id, &integ.work_ref), &job.task_id), new: c.clone(), old: None };
                if !matches!(git.update_refs(&repo, &[op]), Ok(TxOutcome::Committed)) {
                    log::line(format!("orchestration — {run_id}: could not keep the conflict tree ref"));
                }
            }
            let (entries, more, structural) = merge::conflict_entries(&p);
            // 텍스트 충돌이어도 git 이 표식을 실제로 박았을 때만 해결 Attempt 대상이다 — 못 읽으면 사람에게.
            let needs_human = structural || cc.is_none() || {
                let probe = ConflictInfo {
                    job_id: String::new(),
                    old: old.clone(),
                    report_commit: String::new(),
                    merge_base: String::new(),
                    conflict_commit: None,
                    entries: entries.clone(),
                    more,
                    needs_human: false,
                    at: 0,
                };
                let check = super::resolve::marker_check(&probe);
                match git.markers_inserted(&repo, &p.tree, &check) {
                    Ok(v) => v.len() != check.items.len() || v.iter().any(|ok| !ok),
                    Err(e) => {
                        log::line(format!("orchestration — {run_id}: could not read conflict markers: {}", short(&e)));
                        true
                    }
                }
            };
            let info = ConflictInfo {
                job_id: job_id.to_string(),
                old: old.clone(),
                report_commit: job.report_commit.clone(),
                merge_base: base,
                conflict_commit: cc,
                entries,
                more,
                needs_human,
                at: self.now(),
            };
            self.record_conflict(run_id, job_id, &old, info);
            return;
        }
        // 부모 = 통합 머리 · 메시지는 서버가 짓는다.
        let msg = merge::squash_message(
            &title,
            &summary,
            &SquashMeta {
                run_id,
                task_id: &job.task_id,
                attempt_id: &job.attempt_id,
                report_id: &job.report_id,
                report_commit: &job.report_commit,
                base: &base,
            },
        );
        let candidate = match git.commit_tree(&repo, &tree, &old, &msg) {
            Ok(c) => c,
            Err(e) if e == NO_GIT_IDENTITY => return fail("no-git-identity", Notify::Human("integration-failed")),
            Err(e) => {
                log::line(format!("orchestration — {run_id}: commit-tree failed: {}", short(&e)));
                return fail("integration-failed:commit", Notify::Human("integration-failed"));
            }
        };
        // 후보 ref 는 이 Job 의 것이고 Job 이 살아 있을 때만 쓴다 — 취소된 계산이 늦게 끝나도 남의 ref 를 건드리지 않는다.
        if !self.job_still_prepared(run_id, job_id) {
            return;
        }
        let cref = refs::candidate(&refs::base_of(run_id, &integ.work_ref), job_id);
        let keep = RefOp::Update { name: cref.clone(), new: candidate.clone(), old: None };
        #[cfg(test)]
        let _ = self.crash_at(super::integrate::IntegrateStep::BeforeCandidateRef);
        if !matches!(git.update_refs(&repo, &[keep]), Ok(TxOutcome::Committed)) {
            return fail("integration-failed:candidate-ref", Notify::Human("integration-failed"));
        }
        if self.set_candidate(run_id, job_id, &old, &candidate, Some(&tree)).is_err() {
            // 그사이 취소 · 중단 — 자기 ref 만 그 OID 일 때 거둔다.
            let _ = git.update_refs(&repo, &[RefOp::Delete { name: cref, old: candidate }]);
            return;
        }
        self.after_candidate(run_id, job_id);
    }

    /// 블로킹(git) — 잠금 밖에서 잰다.
    pub(super) fn identity_drifted(&self, run_id: &str) -> bool {
        let inputs = self.album_inputs(run_id);
        let g = self.lock();
        g.runs.get(run_id).is_none_or(|s| super::album::gate(&s.run, &inputs).is_err())
    }

    fn job_still_prepared(&self, run_id: &str, job_id: &str) -> bool {
        let g = self.lock();
        g.runs
            .get(run_id)
            .filter(|s| s.run.state != RunState::Orphaned)
            .is_some_and(|s| s.run.jobs.iter().any(|j| j.job_id == job_id && j.phase == JobPhase::Prepared))
    }

    /// 커밋 단계 전의 Job 만 거둔다 — 그사이 끝났으면 아무것도 안 한다.
    fn fail_job(&self, run_id: &str, job_id: &str, why: &str, notify: Notify) {
        let now = self.now();
        let (detail, ended, gen, held) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id).filter(|s| s.run.state != RunState::Orphaned) else { return };
            let Some(ji) = slot.run.jobs.iter().position(|j| j.job_id == job_id) else { return };
            if !slot.run.jobs[ji].phase.cancellable() {
                return;
            }
            abort_job_in(slot, ji, now, Actor::Server, why);
            let attempt = slot.run.jobs[ji].attempt_id.clone();
            let mut held = None;
            match notify {
                Notify::Diverged => {
                    if slot.run.hold.is_none() {
                        set_hold(slot, HoldReason::IntegrationDiverged, Some("moved"), now);
                        held = Some(HoldReason::IntegrationDiverged);
                    }
                    self.raise(slot, "integration-diverged", None, Some("moved"));
                }
                Notify::Identity => {
                    if slot.run.hold.is_none() {
                        set_hold(slot, HoldReason::RepoIdentityChanged, None, now);
                        held = Some(HoldReason::RepoIdentityChanged);
                    }
                    self.raise(slot, "repo-identity-changed", None, None);
                }
                Notify::Human(kind) => self.raise(slot, kind, Some(&attempt), Some(why)),
            }
            let job = slot.run.jobs[ji].clone();
            let detail = job_detail(slot, &job, why);
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            let gen = slot.run.gen;
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (detail, ended, gen, held)
        };
        self.audit("integration_aborted", run_id, detail);
        if let Some(why) = held {
            self.audit(
                "run_held",
                run_id,
                OrchestrationAudit {
                    actor: Actor::Server.as_str().into(),
                    reason: Some(why.as_str().into()),
                    job_id: Some(job_id.to_string()),
                    ..human_detail(gen, RunState::Paused)
                },
            );
        }
        if ended {
            self.audit(
                "run_ended",
                run_id,
                OrchestrationAudit {
                    actor: Actor::Server.as_str().into(),
                    ..human_detail(gen, RunState::Stopped)
                },
            );
        }
    }

    fn record_conflict(&self, run_id: &str, job_id: &str, old: &str, info: ConflictInfo) {
        let now = self.now();
        let (detail, ended, gen) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id).filter(|s| s.run.state != RunState::Orphaned) else { return };
            let Some(ji) = slot.run.jobs.iter().position(|j| j.job_id == job_id) else { return };
            if slot.run.jobs[ji].phase != JobPhase::Prepared {
                return;
            }
            let entries = info.entries.len() as u32 + info.more;
            let needs_human = info.needs_human;
            let job = &mut slot.run.jobs[ji];
            job.phase = JobPhase::Conflict;
            job.old = Some(old.to_string());
            job.outcome = Some(JobOutcome {
                reason: "conflict".into(),
                at: now,
            });
            let (task_id, attempt) = (job.task_id.clone(), job.attempt_id.clone());
            if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id && t.state == TaskState::Integrating) {
                t.state = TaskState::Conflict;
                t.conflict = Some(info);
                t.version += 1;
                t.updated_at = now;
            }
            slot.run.bump(now, Actor::Server, "integration_conflict", Some(&task_id), &entries.to_string());
            self.raise(
                slot,
                "integration-conflict",
                Some(&attempt),
                Some(if needs_human { "needs-human" } else { "text" }),
            );
            let job = slot.run.jobs[ji].clone();
            let detail = job_detail(slot, &job, if needs_human { "conflict:needs-human" } else { "conflict:text" });
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            let gen = slot.run.gen;
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (detail, ended, gen)
        };
        self.audit("integration_conflict", run_id, detail);
        if ended {
            self.audit(
                "run_ended",
                run_id,
                OrchestrationAudit {
                    actor: Actor::Server.as_str().into(),
                    ..human_detail(gen, RunState::Stopped)
                },
            );
        }
    }

    // -----------------------------------------------------------------------
    // 기준 = 통합 머리
    // -----------------------------------------------------------------------

    /// 잠금 밖에서 부른다(git). 통합 ref 가 없는 Run 이면 `None`.
    pub(super) fn read_integration_head(&self, run_id: &str) -> Option<Result<Option<String>, String>> {
        let (repo, work_ref) = {
            let g = self.lock();
            let s = g.runs.get(run_id)?;
            let i = s.run.integration.as_ref()?;
            (PathBuf::from(&s.run.repo), i.work_ref.clone())
        };
        Some(match self.integrator() {
            Some(git) => git.read_ref(&repo, &work_ref),
            None => Err("this server has no integration git".into()),
        })
    }

    /// 부른 쪽이 `after_change` 를 한다.
    pub(super) fn hold_diverged(&self, slot: &mut Slot, detail: &str, now: u64) {
        if slot.run.hold.is_none() {
            set_hold(slot, HoldReason::IntegrationDiverged, Some(detail), now);
            self.raise(slot, "integration-diverged", None, Some(detail));
        }
    }

    // -----------------------------------------------------------------------
    // [조정] · 내보내기
    // -----------------------------------------------------------------------

    /// `contained` 는 조상 검사라 revert 는 잡지 못한다. 블로킹(git).
    pub(crate) fn reconcile_preview(&self, run_id: &str) -> Result<Value, OrchError> {
        let git = self.hand()?;
        let (repo, integ, hold, arts) = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            let integ = slot
                .run
                .integration
                .clone()
                .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
            let arts: Vec<(String, String, Option<String>, String)> = slot
                .run
                .tasks
                .iter()
                .filter_map(|t| {
                    let a = slot.run.valid_artifact(&t.id)?;
                    Some((t.id.clone(), t.title.clone(), a.job_id.clone(), a.integration_commit.clone()?))
                })
                .collect();
            (PathBuf::from(&slot.run.repo), integ, slot.run.hold.clone(), arts)
        };
        let current = git.read_ref(&repo, &integ.work_ref).map_err(git_failed)?;
        let items: Vec<Value> = arts
            .into_iter()
            .map(|(task_id, title, job_id, commit)| {
                let contained = current.as_deref().and_then(|h| git.is_ancestor(&repo, &commit, h).ok());
                json!({ "taskId": task_id, "title": title, "jobId": job_id, "integrationCommit": commit, "contained": contained })
            })
            .collect();
        Ok(json!({
            "runId": run_id,
            "workRef": integ.work_ref,
            "expectedHead": integ.expected_head,
            "currentHead": current,
            "hold": hold,
            "integrated": items,
        }))
    }

    /// 사람만 · 어긋남 보류만. `accept` 는 사람의 확인(`confirmed`)이 있어야 하고, 보류를 풀어도 Run 은 멈춘 채다(재개는 [재개]). 블로킹(git).
    pub(crate) fn reconcile(
        &self,
        run_id: &str,
        mode: &str,
        confirmed: bool,
        seen_head: Option<&str>,
        reject_tasks: &[String],
    ) -> Result<Value, OrchError> {
        if !matches!(mode, "revert" | "accept") {
            return Err(OrchError::new(reason::INVALID_ARGUMENT, "mode must be revert or accept"));
        }
        let git = self.hand()?;
        let (repo, integ, n) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            if slot.run.hold.as_ref().map(|h| h.reason) != Some(HoldReason::IntegrationDiverged) {
                return Err(OrchError::new(reason::INVALID_STATE, "the integration ref is not on hold — nothing to reconcile"));
            }
            let integ = slot
                .run
                .integration
                .clone()
                .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
            (PathBuf::from(&slot.run.repo), integ, slot.run.seq)
        };
        let current = git.read_ref(&repo, &integ.work_ref).map_err(git_failed)?;
        let mut accepted_head: Option<String> = None;
        if mode == "revert" {
            if current.as_deref() != Some(integ.expected_head.as_str()) {
                let mut ops = vec![match &current {
                    Some(c) => RefOp::Update { name: integ.work_ref.clone(), new: integ.expected_head.clone(), old: Some(c.clone()) },
                    None => RefOp::Create { name: integ.work_ref.clone(), new: integ.expected_head.clone() },
                }];
                if let Some(c) = &current {
                    ops.push(RefOp::Create { name: refs::diverged(&refs::base_of(run_id, &integ.work_ref), n), new: c.clone() });
                }
                match git.update_refs(&repo, &ops) {
                    Ok(TxOutcome::Committed) => {}
                    Ok(TxOutcome::Refused(l)) | Err(l) => {
                        return Err(OrchError::new(
                            reason::INTEGRATION_FAILED,
                            format!("could not move the integration ref back (it may have moved again — look again): {}", short(&l)),
                        ))
                    }
                }
            }
        } else {
            if !confirmed {
                return Err(OrchError::new(
                    reason::INVALID_ARGUMENT,
                    "accepting the moved integration ref needs the person's confirmation that the accepted results are in it",
                ));
            }
            let Some(c) = current.clone() else {
                return Err(OrchError::new(reason::INVALID_STATE, "the integration ref is missing — revert it instead"));
            };
            if seen_head.is_some_and(|s| s != c) {
                return Err(OrchError::new(reason::INVALID_STATE, "the integration ref moved again — look at it again"));
            }
            accepted_head = Some(c);
        }
        let now = self.now();
        let (result, gen) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            let still = slot.run.hold.as_ref().map(|h| h.reason) == Some(HoldReason::IntegrationDiverged)
                && slot.run.integration.as_ref().map(|i| i.expected_head.as_str()) == Some(integ.expected_head.as_str());
            if !still {
                return Err(OrchError::new(reason::INVALID_STATE, "the run changed meanwhile — look at it again"));
            }
            if let Some(h) = &accepted_head {
                for t in reject_tasks {
                    if !slot.run.valid_artifact(t).is_some_and(|a| a.integration_commit.is_some()) {
                        return Err(OrchError::new(reason::INVALID_ARGUMENT, format!("task {t} is not an integrated task")));
                    }
                }
                for t in reject_tasks {
                    for a in slot.run.accepted.iter_mut().filter(|a| a.task_id == *t && a.revoked_at.is_none()) {
                        a.revoked_at = Some(now);
                        a.revoked_by = Some(Reviewer::Human);
                    }
                    let attempt = slot.run.task(t).and_then(|x| x.current_attempt.clone());
                    slot.run.reviews.push(ReviewRecord {
                        task_id: t.clone(),
                        attempt_id: attempt,
                        report_id: None,
                        decision: Decision::Rejected,
                        reviewer: Reviewer::Human,
                        flipped: true,
                        at: now,
                    });
                    if let Some(task) = slot.run.tasks.iter_mut().find(|x| x.id == *t) {
                        task.state = TaskState::Rejected;
                        task.conflict = None;
                        task.version += 1;
                        task.updated_at = now;
                    }
                    slot.run.bump(now, Actor::Human, "task_rejected", Some(t), "reconciled");
                }
                if let Some(i) = slot.run.integration.as_mut() {
                    i.expected_head = h.clone();
                }
            }
            slot.run.hold = None;
            if slot.run.state == RunState::Paused && slot.run.pause_reason.as_deref() == Some("hold") {
                slot.run.pause_reason = Some("human".into());
            }
            let seq = slot.run.bump(now, Actor::Human, "human_reconciled", None, mode);
            let gen = slot.run.gen;
            let head = slot.run.integration.as_ref().map(|i| i.expected_head.clone());
            self.after_change(&g, run_id);
            (json!({ "runId": run_id, "mode": mode, "head": head, "latestSeq": seq }), gen)
        };
        self.audit(
            "human_reconciled",
            run_id,
            OrchestrationAudit {
                reason: Some(mode.into()),
                ..human_detail(gen, RunState::Paused)
            },
        );
        Ok(result)
    }

    /// orphaned 도 이것 하나는 받는다(사용자 결정) — ref → 브랜치 하나라 읽기 전용의 뜻을 넓히지 않는다.
    /// orphaned 에는 보류를 세우지 않는다([조정]이 orphaned 를 받지 않아 풀 길이 없다) — 거절만 한다. 블로킹(git).
    pub(crate) fn export_branch(&self, run_id: &str) -> Result<Value, OrchError> {
        self.export_branch_by(run_id, Actor::Human)
    }

    /// 장부 · 감사의 주체는 부른 쪽(Run 완료를 부른 조정자일 수 있다). 깨움 허용 목록에 없는 낱말이라 주체와 무관하게 깨우지 않는다.
    pub(super) fn export_branch_by(&self, run_id: &str, actor: Actor) -> Result<Value, OrchError> {
        let git = self.hand()?;
        let (repo, integ, orphaned) = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            let orphaned = slot.run.state == RunState::Orphaned;
            let integ = slot
                .run
                .integration
                .clone()
                .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
            (PathBuf::from(&slot.run.repo), integ, orphaned)
        };
        let head = integ.expected_head.clone();
        let current = git.read_ref(&repo, &integ.work_ref).map_err(git_failed)?;
        // [정리]로 지운 통합 ref 의 부재는 기대한 상태다 — 내보낸 브랜치가 그 머리를 품을 때만 지울 수 있었다.
        if !integ.head_matches(current.as_deref()) {
            if orphaned {
                return Err(OrchError::new(reason::RUN_ON_HOLD, "the integration ref moved"));
            }
            let now = self.now();
            let mut g = self.lock();
            if let Some(slot) = g.runs.get_mut(run_id) {
                self.hold_diverged(slot, "export", now);
                let h = slot.run.hold.clone();
                self.after_change(&g, run_id);
                if let Some(h) = h {
                    return Err(super::store::on_hold(&h));
                }
            }
            return Err(OrchError::new(reason::RUN_ON_HOLD, "the integration ref moved"));
        }
        let branch_ref = format!("refs/heads/{}", integ.export_branch);
        let out = git.checked_out(&repo).map_err(git_failed)?;
        if out.contains(&branch_ref) {
            return Err(OrchError::new(
                reason::EXPORT_CHECKED_OUT,
                format!("branch {} is checked out in a worktree — switch away from it first", integ.export_branch),
            ));
        }
        let now_branch = git.read_ref(&repo, &branch_ref).map_err(git_failed)?;
        if now_branch.as_deref() != Some(head.as_str()) {
            // 사람이 지운 브랜치는 다시 만든다(덮을 것이 없다) — 만들기도 CAS 라 그사이 누가 같은 이름을 세웠으면 거절.
            let op = match (&integ.exported_head, &now_branch) {
                (Some(o), Some(_)) => RefOp::Update { name: branch_ref.clone(), new: head.clone(), old: Some(o.clone()) },
                _ => RefOp::Create { name: branch_ref.clone(), new: head.clone() },
            };
            if !matches!(git.update_refs(&repo, &[op]), Ok(TxOutcome::Committed)) {
                return Err(OrchError::new(
                    reason::EXPORT_BRANCH_MOVED,
                    format!(
                        "branch {} was changed outside the app (it is at {}) — the app does not overwrite it",
                        integ.export_branch,
                        now_branch.as_deref().unwrap_or("nothing")
                    ),
                ));
            }
        }
        let now = self.now();
        let (seq, gen, state) = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
            if let Some(i) = slot.run.integration.as_mut() {
                i.exported_head = Some(head.clone());
            }
            let seq = slot.run.bump(now, actor, "integration_exported", None, &head[..12.min(head.len())]);
            let r = (seq, slot.run.gen, slot.run.state);
            self.after_change(&g, run_id);
            r
        };
        self.audit(
            "integration_exported",
            run_id,
            OrchestrationAudit {
                commit_oid: Some(head.clone()),
                actor: actor.as_str().into(),
                ..human_detail(gen, state)
            },
        );
        Ok(json!({ "runId": run_id, "branch": integ.export_branch, "head": head, "latestSeq": seq }))
    }
}

fn job_detail(slot: &Slot, job: &IntegrationJob, why: &str) -> OrchestrationAudit {
    let task = slot.run.task(&job.task_id);
    OrchestrationAudit {
        gen: slot.run.gen,
        actor: Actor::Server.as_str().into(),
        run_state: Some(slot.run.state.as_str().into()),
        task_id: Some(job.task_id.clone()),
        task_version: task.map(|t| t.version),
        task_state: task.map(|t| t.state.as_str().into()),
        attempt_id: Some(job.attempt_id.clone()),
        commit_oid: Some(job.report_commit.clone()),
        reason: Some(why.to_string()),
        job_id: Some(job.job_id.clone()),
        ..Default::default()
    }
}

/// 조정자의 `base` 인자는 부른 쪽이 먼저 거절한다.
pub(super) fn integration_base(run: &Run, task: &Task) -> Result<String, OrchError> {
    for d in &task.depends_on {
        if run.task(d).map(|t| t.state) != Some(TaskState::Accepted) {
            return Err(OrchError::new(
                reason::DEPENDENCY_NOT_ACCEPTED,
                format!("dependency {d} is not accepted yet"),
            ));
        }
    }
    run.integration
        .as_ref()
        .map(|i| i.expected_head.clone())
        .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))
}
