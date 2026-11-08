//! **앨범 병합**(2026-11-07 — docs/log/2026-11-07-album-merge.md) — 내보낸 브랜치를 시작 때의 브랜치(`Integration.base_branch`)에
//! `git merge --no-ff` 로 넣는다. 스쿼시 없음 · **push 없음**. 길은 둘뿐이다: 사람의 [병합](op `orchestration_merge` — 원격은 재확인) ·
//! 사람이 앨범마다 켠 자동 병합(`AlbumConfig.auto_merge` — `complete_run_by` 의 내보내기 뒤 한 번). **MCP 에는 켜기 · 병합 길이 없다**
//! (시험 `album_merge_has_no_mcp_path`).
//!
//! 불변식:
//! - **검사는 저장소를 바꾸지 않는다**(`inspect`): `status` 는 `--no-optional-locks`(인덱스를 다시 쓰지 않는다), 충돌 예상은 `merge-tree`
//!   (쓰는 것은 참조 없는 트리 객체뿐 — gc 대상 · 작업 폴더 · 인덱스 · ref 를 건드리지 않는다). 사람 병합은 창을 열 때 + 실행 직전에 두 번 돈다.
//! - **더러움의 범위**(`inspect` 의 ③): 추적 파일의 변경(스테이지 · 작업 폴더 — `--untracked-files=no`) + **병합이 새로 놓을 경로에 이미 있는
//!   미추적 · 무시 파일**. 무시 파일까지 보는 까닭: `git merge` 는 미추적만 거절하고 무시 파일은 조용히 덮는다(`--overwrite-ignore` 기본).
//!   병합과 무관한 미추적 파일은 막지 않는다(그대로 남고 잃는 것이 없다).
//! - **임의 실행 관문**: 지원 범위 검사(`IntegrationGit::unsupported` — 병합 드라이버 · 필터 · renormalize · 바뀐 gitlink)를 **`merge-tree`
//!   앞에서** 돌린다(`merge-tree` 도 드라이버를 실제로 실행한다 — `merge.rs` 머리말). 실행은 `--attr-source=<대상 머리>`(검사와 같은 속성 출처 —
//!   주 작업 폴더의 커밋 안 된 `.gitattributes` 에 흔들리지 않게).
//! - **훅 끔**(공용 실행기 `git.rs` 의 `core.hooksPath=<빈 폴더>` — 작업자 worktree 와 같은 관례): `.githooks` 처럼 저장소 안에 있는 훅은 AI 가
//!   바꿀 수 있는 코드다. 사람의 [병합]도 같은 몸이라 사용자 훅(`pre-merge-commit` · `post-merge`)이 돌지 않는다 — 돌려야 하면 터미널에서 병합한다.
//! - **git 은 잠금 밖**: 잠금은 재료를 읽을 때와 결과를 적을 때만 쥔다. 한 앨범의 병합은 한 번에 하나(`Slot.merging`) — 겹친 실패가 다른 쪽의
//!   병합을 `--abort` 하지 않게.
//! - **실패는 되돌리고 정직하게**: 실패면 `MERGE_HEAD` 가 **우리가 넣던 머리일 때만** `git merge --abort`.
//! - **자동 병합은 재시도하지 않는다**: 멈추면 까닭을 Run 칸 · 장부 · 사람 알림에 남기고 끝이다. 다시 하는 것은 사람의 [병합].
//! - 장부 낱말(`integration_merged` · `integration_auto_merged` · `auto_merge_stopped`)은 깨움 허용 목록(`wake.rs`)에 없다 — 깨우지 않는다.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::album;
use super::git::{child_env, Git};
use super::integrate::{IntegrationGit, MergeResult};
use super::model::*;
use super::store::{human_detail, not_found_run, reason, OrchError, Orchestration};
use crate::audit::OrchestrationAudit;

/// 병합 한 번의 시한 — 큰 저장소의 작업 폴더 갱신까지 기다린다(읽기 검사는 공용 60초).
const MERGE_TIMEOUT: Duration = Duration::from_secs(300);
/// 창 · 답에 싣는 경로 수 상한(수는 따로 센다).
const PATHS_MAX: usize = 20;

/// 커밋 짧은 표기(장부 · 화면 공통).
fn short(oid: &str) -> &str {
    &oid[..7.min(oid.len())]
}

/// `status --porcelain=v1 -z` → 경로들. 이름이 바뀐 줄은 옛 경로가 다음 칸에 온다(건너뛴다). 순수.
pub(super) fn parse_status_z(out: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut it = out.split('\0');
    while let Some(entry) = it.next() {
        if entry.len() < 4 {
            continue;
        }
        let (xy, path) = entry.split_at(3);
        paths.push(path.to_string());
        if xy.starts_with('R') || xy.starts_with('C') {
            it.next();
        }
    }
    paths
}

/// `diff --numstat -z --no-renames` → `(파일 수, 더한 줄, 지운 줄)` — 이진 파일의 `-` 는 0 줄. 순수.
pub(super) fn parse_numstat_z(out: &str) -> (u64, u64, u64) {
    let (mut files, mut adds, mut dels) = (0, 0, 0);
    for rec in out.split('\0').filter(|r| !r.is_empty()) {
        let mut f = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(_)) = (f.next(), f.next(), f.next()) else { continue };
        files += 1;
        adds += a.parse::<u64>().unwrap_or(0);
        dels += d.parse::<u64>().unwrap_or(0);
    }
    (files, adds, dels)
}

/// 병합이 놓을 경로가 이미 차 있나 — 그 경로 자체 또는 **그 위 어느 자리**에 파일이 있으면(폴더 자리를 파일이 막고 있다) 참.
fn path_taken(repo: &Path, rel: &str) -> bool {
    let mut at = repo.to_path_buf();
    let parts: Vec<&str> = rel.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        at.push(part);
        match std::fs::symlink_metadata(&at) {
            Ok(m) if i + 1 == parts.len() || !m.is_dir() => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    false
}

/// 병합 전 검사 결과.
#[derive(Debug, Clone, Default)]
pub(super) struct MergeCheck {
    target: Option<String>,
    head: Option<String>,
    /// 세 줄로 보일 수 없는 까닭(대상 없음 · 낡음 · 신원 · 지원 밖 …)과 그 세부 낱말.
    blocked: Option<&'static str>,
    detail: Option<String>,
    /// 이미 대상 브랜치에 들어 있다.
    merged: bool,
    /// 세 줄을 실제로 판정했다(앞에서 막혔으면 거짓 — 창은 그 줄들을 그리지 않는다).
    checked: bool,
    merge_base: Option<String>,
    commits: u64,
    files: u64,
    additions: u64,
    deletions: u64,
    dirty: Vec<String>,
    in_progress: bool,
    current: Option<String>,
    on_target: bool,
    conflicts: Vec<String>,
}

impl MergeCheck {
    fn stop(word: &'static str, detail: Option<String>) -> Self {
        MergeCheck { blocked: Some(word), detail, ..Default::default() }
    }

    /// 병합을 막는 첫 까닭 `(낱말, 세부)` — 없으면 병합할 수 있다. 낱말은 화면 · 장부 · 사람 알림이 함께 쓴다.
    pub(super) fn refusal(&self) -> Option<(&'static str, Option<String>)> {
        if let Some(word) = self.blocked {
            return Some((word, self.detail.clone()));
        }
        if self.in_progress {
            return Some(("in-progress", None));
        }
        if !self.dirty.is_empty() {
            return Some(("dirty", Some(self.dirty.len().to_string())));
        }
        if !self.on_target {
            return Some(("wrong-branch", self.current.clone()));
        }
        if !self.conflicts.is_empty() {
            return Some(("conflict", Some(self.conflicts.len().to_string())));
        }
        None
    }

    fn to_json(&self, run_id: &str, integ: &Integration) -> Value {
        let state = if self.merged {
            "merged"
        } else if self.refusal().is_some() {
            "blocked"
        } else {
            "ready"
        };
        let list = |v: &[String]| json!({ "count": v.len(), "paths": v.iter().take(PATHS_MAX).collect::<Vec<_>>() });
        json!({
            "runId": run_id,
            "branch": integ.export_branch,
            "target": self.target,
            "head": self.head,
            "state": state,
            "reason": self.blocked,
            "detail": self.detail,
            "checked": self.checked,
            "mergeBase": self.merge_base,
            "commits": self.commits,
            "files": self.files,
            "additions": self.additions,
            "deletions": self.deletions,
            "dirty": list(&self.dirty),
            "inProgress": self.in_progress,
            "current": self.current,
            "onTarget": self.on_target,
            "conflicts": list(&self.conflicts),
        })
    }
}

fn git_err(line: impl Into<String>) -> OrchError {
    OrchError::new(reason::GIT_FAILED, line)
}

/// 진행 중인 병합 · cherry-pick · revert · rebase 가 있나(`rev-parse --git-path` — 읽기만).
fn in_progress(g: &Git<'_>, repo: &Path) -> Result<bool, OrchError> {
    let names = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];
    let mut args = vec!["rev-parse"];
    for n in &names {
        args.extend(["--git-path", n]);
    }
    let out = g.ok(&args, &[], None)?;
    Ok(out.lines().map(|l| l.trim_end_matches('\r')).filter(|l| !l.is_empty()).any(|p| {
        let p = Path::new(p);
        if p.is_absolute() { p.exists() } else { repo.join(p).exists() }
    }))
}

/// **병합 전 검사** — 읽기만 한다(머리말). 블로킹(git) · 잠금 밖에서 부른다.
pub(super) fn inspect(hand: &dyn IntegrationGit, repo: &Path, integ: &Integration) -> Result<MergeCheck, OrchError> {
    let Some(head) = integ.exported_head.clone() else {
        return Ok(MergeCheck::stop("not-exported", None));
    };
    let Some(target) = integ.base_branch.clone() else {
        return Ok(MergeCheck { head: Some(head), ..MergeCheck::stop("no-base-branch", None) });
    };
    let at = |mut c: MergeCheck| {
        c.target = Some(target.clone());
        c.head = Some(head.clone());
        c
    };
    // 내보낸 뒤 통합이 더 쌓였으면 그 브랜치는 앨범의 결과가 아니다.
    if head != integ.expected_head {
        return Ok(at(MergeCheck::stop("stale", None)));
    }
    let target_ref = format!("refs/heads/{target}");
    let Some(target_head) = hand.read_ref(repo, &target_ref).map_err(git_err)? else {
        return Ok(at(MergeCheck::stop("target-missing", None)));
    };
    if hand.is_ancestor(repo, &head, &target_head).map_err(git_err)? {
        return Ok(at(MergeCheck { merged: true, ..Default::default() }));
    }
    let branch_ref = format!("refs/heads/{}", integ.export_branch);
    if hand.read_ref(repo, &branch_ref).map_err(git_err)?.as_deref() != Some(head.as_str()) {
        return Ok(at(MergeCheck::stop("branch-moved", None)));
    }
    if !integ.head_matches(hand.read_ref(repo, &integ.work_ref).map_err(git_err)?.as_deref()) {
        return Ok(at(MergeCheck::stop("stale", None)));
    }

    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let g = Git::new(repo, &hooks, &env, reason::GIT_FAILED)?;

    let mut c = at(MergeCheck { checked: true, ..Default::default() });
    // ① 지금 브랜치.
    c.current = hand.head(repo).map_err(git_err)?.and_then(|(_, b)| b);
    c.on_target = c.current.as_deref() == Some(target.as_str());
    // ② 진행 중인 병합 · rebase.
    c.in_progress = in_progress(&g, repo)?;
    // ③ 추적 파일의 변경(머리말의 범위 — 병합이 덮을 미추적 · 무시 파일은 아래 ⑥ 에서 더한다).
    let status = g.ok(
        &["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=none"],
        &[],
        None,
    )?;
    c.dirty = parse_status_z(&status);
    // ④ 숫자 칸.
    let base = g.run(&["merge-base", &target_head, &head], &[], None)?;
    let base = base.stdout.trim().to_string();
    if !super::git::hex40(&base) {
        c.blocked = Some("unrelated");
        return Ok(c);
    }
    let range = format!("{target_head}..{head}");
    c.commits = g.ok(&["rev-list", "--count", &range], &[], None)?.trim().parse().unwrap_or(0);
    let numstat = g.ok(&["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", &base, &head, "--"], &[], None)?;
    (c.files, c.additions, c.deletions) = parse_numstat_z(&numstat);
    c.merge_base = Some(base.clone());
    // ⑤ 지원 범위 — `merge-tree` 앞이어야 한다(머리말).
    if let Some(word) = hand.unsupported(repo, &target_head, &head, &base).map_err(git_err)? {
        c.blocked = Some("git-unsupported");
        c.detail = Some(word.to_string());
        return Ok(c);
    }
    // ⑥ 충돌 예상 · 병합이 덮을 파일.
    let tree = match hand.merge(repo, &base, &target_head, &head).map_err(git_err)? {
        MergeResult::Clean { tree } => tree,
        MergeResult::Conflict(p) => {
            for s in &p.stages {
                if !c.conflicts.contains(&s.path) {
                    c.conflicts.push(s.path.clone());
                }
            }
            p.tree
        }
        MergeResult::Failed(line) => {
            c.blocked = Some("merge-failed");
            c.detail = Some(line);
            return Ok(c);
        }
    };
    // 대상 브랜치 위에 있을 때만 작업 폴더를 그 트리와 견줄 뜻이 있다(아니면 어차피 `wrong-branch`).
    if c.on_target {
        let added = g.ok(&["diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", &target_head, &tree, "--"], &[], None)?;
        for path in added.split('\0').filter(|p| !p.is_empty()) {
            if path_taken(repo, path) && !c.dirty.iter().any(|d| d == path) {
                c.dirty.push(path.to_string());
            }
        }
    }
    Ok(c)
}

/// 병합 실패 — git 의 첫 줄 · 저장소가 시작 때 그대로인가.
#[derive(Debug, Clone)]
struct MergeFailure {
    line: String,
    unchanged: bool,
}

/// 진짜 병합 — 잠금 밖 · 검사를 지난 뒤에만. 성공이면 병합 커밋.
fn run_merge(repo: &Path, branch: &str, target: &str, head: &str, target_head: &str) -> Result<String, MergeFailure> {
    let failed = |line: String| MergeFailure { line, unchanged: false };
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let mut g = Git::new(repo, &hooks, &env, reason::GIT_FAILED).map_err(|e| failed(e.message))?;
    g.timeout = MERGE_TIMEOUT;
    let attr = format!("--attr-source={target_head}");
    let branch_ref = format!("refs/heads/{branch}");
    // 온전한 ref 로 넘긴다(같은 이름의 태그가 끼지 않게) — 그러면 git 이 메시지에 `refs/heads/` 를 적어서 메시지는 직접 짓는다.
    let message = format!("Merge branch '{branch}' into {target}");
    // 뒤 플래그들은 사용자 설정(`merge.ff` · `merge.autoStash` · `merge.verifySignatures` · `pull.twohead` · `branch.<이름>.mergeoptions`)이
    // 이 병합의 뜻을 바꾸거나 다른 전략 프로그램을 실행하지 못하게 고정한다.
    let args = [
        attr.as_str(), "merge", "--no-ff", "--no-edit", "--commit", "--no-squash", "--no-autostash", "--no-verify-signatures",
        "--strategy=ort", "--no-stat", "-m", message.as_str(), branch_ref.as_str(),
    ];
    let run = g.run(&args, &[], None);
    if let Ok(o) = &run {
        if o.ok() {
            let now = g.ok(&["rev-parse", "--verify", "HEAD^{commit}"], &[], None).map_err(|e| failed(e.message))?;
            return Ok(now.trim().to_string());
        }
    }
    let line = match run {
        Ok(o) => o.line(),
        Err(e) => e.message,
    };
    // 되돌리기 — 우리가 넣던 머리일 때만(머리말).
    let merge_head = g.run(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], &[], None).map(|o| o.stdout.trim().to_string());
    if merge_head.as_deref().ok() == Some(head) {
        let _ = g.run(&["merge", "--abort"], &[], None);
    }
    let now = g.run(&["rev-parse", "--verify", "HEAD^{commit}"], &[], None).map(|o| o.stdout.trim().to_string());
    let left = g.run(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], &[], None).map(|o| o.stdout.trim().is_empty());
    Err(MergeFailure {
        line,
        unchanged: now.as_deref().ok() == Some(target_head) && left.unwrap_or(false),
    })
}

/// 병합 한 번의 결과.
enum Outcome {
    Merged { commit: String, target: String, head: String, seq: u64 },
    Already,
    Blocked(MergeCheck),
    Failed(MergeFailure),
}

/// 자동 병합 조건 중 **장부만으로** 판정하는 것(병합 전 검사 · 저장소 신원은 따로) — 까닭 낱말 또는 `None`. 순수.
///
/// "모든 검증 통과" 는 Job 의 검증 기록으로 본다: 수락의 근거 Job 이 통과 결과를 가졌고 덮어쓰기가 아닐 것. 면제(`waived`)가 있으면 사람이 규칙을
/// 넘은 것이라 무인으로 잇지 않는다. 수락 규칙은 **지금 구성**으로 다시 센다. 마지막 조건: 내보낸 머리가 검증된 후보여야 한다 — [조정]의
/// 받아들이기로 사람이 올린 머리에는 검증 기록이 없다.
pub(super) fn auto_merge_blocker(run: &Run, album: &AlbumConfig) -> Option<&'static str> {
    if run.state != RunState::Done {
        return Some("run-state");
    }
    if run.hold.is_some() {
        return Some("on-hold");
    }
    if run.verify.as_ref().is_none_or(|v| v.command.is_empty()) {
        return Some("no-verify-command");
    }
    let valid: Vec<&AcceptedArtifact> = run.accepted.iter().filter(|a| a.revoked_at.is_none() && a.integration_commit.is_some()).collect();
    if valid.is_empty() {
        return Some("no-accepted");
    }
    for a in &valid {
        if !a.waivers().is_empty() {
            return Some("waived");
        }
        let job = a.job_id.as_ref().and_then(|id| run.jobs.iter().find(|j| &j.job_id == id));
        let Some(job) = job else { return Some("verify-not-passed") };
        if job.override_.is_some() {
            return Some("verify-overridden");
        }
        if job.verify.as_ref().is_none_or(|v| v.outcome != VerifyOutcome::Pass) {
            return Some("verify-not-passed");
        }
        let Some(task) = run.task(&a.task_id) else { return Some("accept-rule-unmet") };
        let (unmet, _) = super::roles::accept_rules_for(run, task, &album.accept, |_| None);
        if !unmet.is_empty() {
            return Some("accept-rule-unmet");
        }
    }
    let head = run.integration.as_ref().map(|i| i.expected_head.as_str());
    if !valid.iter().any(|a| a.integration_commit.as_deref() == head) {
        return Some("head-not-verified");
    }
    None
}

impl Orchestration {
    /// 재료 — 저장소 경로 · 통합 칸(잠금 안에서 복제만).
    fn merge_material(&self, run_id: &str) -> Result<(PathBuf, Integration), OrchError> {
        let g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
        let integ = slot
            .run
            .integration
            .clone()
            .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
        Ok((PathBuf::from(&slot.run.repo), integ))
    }

    /// 저장소 신원(`repo-changed` — 앨범 관문과 같은 판정) · 검사. 신원이 다르면 그 저장소의 git 을 읽지 않는다.
    fn merge_inspect(&self, run_id: &str, repo: &Path, integ: &Integration) -> Result<MergeCheck, OrchError> {
        let inputs = self.album_inputs(run_id);
        if let Err(e) = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            album::identity_gate(&slot.run, &inputs).map(|_| ())
        } {
            return Ok(MergeCheck { target: integ.base_branch.clone(), head: integ.exported_head.clone(), ..MergeCheck::stop(e.code, None) });
        }
        let hand = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        inspect(hand.as_ref(), repo, integ)
    }

    /// [병합] 확인 창의 재료(op `orchestration_merge_preview` — 사람 · 읽기). **저장소를 바꾸지 않는다.** 블로킹(git).
    pub(crate) fn merge_preview(&self, run_id: &str) -> Result<Value, OrchError> {
        let (repo, integ) = self.merge_material(run_id)?;
        Ok(self.merge_inspect(run_id, &repo, &integ)?.to_json(run_id, &integ))
    }

    /// 이 앨범의 병합 자리를 쥔다 — 이미 누가 쥐었으면 거짓.
    fn claim_merge(&self, run_id: &str) -> bool {
        let mut g = self.lock();
        match g.runs.get_mut(run_id) {
            Some(slot) if !slot.merging => {
                slot.merging = true;
                true
            }
            _ => false,
        }
    }

    fn release_merge(&self, run_id: &str) {
        if let Some(slot) = self.lock().runs.get_mut(run_id) {
            slot.merging = false;
        }
    }

    /// 병합의 몸(자리를 쥔 뒤) — 실행 직전 검사 · 진짜 병합 · 장부. 사람과 서버가 같은 길이다.
    fn merge_claimed(&self, run_id: &str, repo: &Path, integ: &Integration, actor: Actor) -> Result<Outcome, OrchError> {
        let check = self.merge_inspect(run_id, repo, integ)?;
        if check.merged {
            return Ok(Outcome::Already);
        }
        if check.refusal().is_some() {
            return Ok(Outcome::Blocked(check));
        }
        let (Some(target), Some(head)) = (check.target.clone(), check.head.clone()) else {
            return Ok(Outcome::Blocked(MergeCheck::stop("not-exported", None)));
        };
        let hand = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        let target_head = hand
            .read_ref(repo, &format!("refs/heads/{target}"))
            .map_err(git_err)?
            .ok_or_else(|| git_err("the target branch is gone"))?;
        match run_merge(repo, &integ.export_branch, &target, &head, &target_head) {
            Ok(commit) => {
                let seq = self.record_merged(run_id, &commit, &head, &target, actor);
                Ok(Outcome::Merged { commit, target, head, seq })
            }
            Err(f) => Ok(Outcome::Failed(f)),
        }
    }

    /// 병합을 장부 · Run 칸 · 감사에 적는다. 멈춤 기록은 지운다(병합이 섰다).
    fn record_merged(&self, run_id: &str, commit: &str, head: &str, target: &str, actor: Actor) -> u64 {
        let now = self.now();
        let (seq, gen, state) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return 0 };
            slot.run.merge = Some(RunMerge {
                merged: Some(MergedRecord {
                    commit: commit.to_string(),
                    head: head.to_string(),
                    target: target.to_string(),
                    by: actor,
                    at: now,
                }),
                stopped: None,
            });
            let action = if actor == Actor::Server { "integration_auto_merged" } else { "integration_merged" };
            let seq = slot.run.bump(now, actor, action, Some(target), short(commit));
            let r = (seq, slot.run.gen, slot.run.state);
            self.persist_merge(&g, run_id, r.2);
            r
        };
        self.audit(
            if actor == Actor::Server { "integration_auto_merged" } else { "integration_merged" },
            run_id,
            OrchestrationAudit {
                commit_oid: Some(commit.to_string()),
                actor: actor.as_str().into(),
                ..human_detail(gen, state)
            },
        );
        seq
    }

    /// 저장 · 알림 — 서버 재시작 뒤의 끝난 앨범(orphaned)도 병합할 수 있어 그 기록을 잃지 않게 쓴다.
    fn persist_merge(&self, g: &super::store::Inner, run_id: &str, state: RunState) {
        if state == RunState::Orphaned {
            self.save_orphaned(g, run_id);
        } else {
            self.after_change(g, run_id);
        }
    }

    /// [병합](op `orchestration_merge` — 사람 · 원격은 재확인). `expect_*` = 창에서 본 값 — 그사이 바뀌었으면 하지 않는다. 답의 `merged` 가 결과이고
    /// 하지 않은 까닭은 `reason`(그때의 검사 `preview` 를 함께 — 창이 그대로 다시 그린다). 블로킹(git).
    pub(crate) fn merge_album(&self, run_id: &str, expect_head: &str, expect_target: &str) -> Result<Value, OrchError> {
        let (repo, integ) = self.merge_material(run_id)?;
        if integ.exported_head.as_deref() != Some(expect_head) || integ.base_branch.as_deref() != Some(expect_target) {
            let preview = self.merge_inspect(run_id, &repo, &integ)?.to_json(run_id, &integ);
            return Ok(json!({ "merged": false, "reason": "merge-stale", "preview": preview }));
        }
        if !self.claim_merge(run_id) {
            return Ok(json!({ "merged": false, "reason": "merge-busy" }));
        }
        let out = self.merge_claimed(run_id, &repo, &integ, Actor::Human);
        self.release_merge(run_id);
        Ok(match out? {
            Outcome::Merged { commit, target, head, seq } => {
                json!({ "merged": true, "commit": commit, "target": target, "head": head, "latestSeq": seq })
            }
            Outcome::Already => json!({ "merged": true, "already": true }),
            Outcome::Blocked(c) => {
                let word = c.refusal().map(|(w, _)| w);
                json!({ "merged": false, "reason": word, "preview": c.to_json(run_id, &integ) })
            }
            Outcome::Failed(f) => json!({ "merged": false, "reason": "merge-failed", "detail": f.line, "unchanged": f.unchanged }),
        })
    }

    /// 자동 병합 멈춤 — Run 칸 · 장부 · 사람 알림. 재시도는 없다(머리말).
    fn stop_auto_merge(&self, run_id: &str, word: &'static str, detail: Option<String>) -> Value {
        let now = self.now();
        let (gen, state) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return json!({ "merged": false, "reason": word }) };
            slot.run.merge = Some(RunMerge {
                merged: None,
                stopped: Some(MergeStop { reason: word.to_string(), detail, at: now }),
            });
            slot.run.bump(now, Actor::Server, "auto_merge_stopped", None, word);
            self.raise(slot, "auto-merge-stopped", None, Some(word));
            let r = (slot.run.gen, slot.run.state);
            self.persist_merge(&g, run_id, r.1);
            r
        };
        self.audit(
            "auto_merge_stopped",
            run_id,
            OrchestrationAudit {
                actor: Actor::Server.as_str().into(),
                reason: Some(word.to_string()),
                ..human_detail(gen, state)
            },
        );
        json!({ "merged": false, "reason": word })
    }

    /// **자동 병합** — 앨범 완료의 내보내기 뒤 한 번(`complete_run_by`). 켬은 **이 순간의 앨범 구성**으로 본다. 꺼져 있으면 `None`(아무 일 없음).
    /// 답은 `{merged, commit?, reason?}` — 완료를 부른 쪽의 답에 실린다. 블로킹(git) · 잠금 밖.
    pub(super) fn auto_merge_after_complete(&self, run_id: &str, exported: bool) -> Option<Value> {
        let inputs = self.album_inputs(run_id);
        let refused: Option<&'static str> = {
            let g = self.lock();
            let run = &g.runs.get(run_id)?.run;
            if !run.album.as_ref()?.auto_merge {
                return None;
            }
            if !exported {
                Some("export-failed")
            } else {
                match album::gate(run, &inputs) {
                    Ok(config) => auto_merge_blocker(run, config),
                    Err(e) => Some(e.code),
                }
            }
        };
        if let Some(word) = refused {
            return Some(self.stop_auto_merge(run_id, word, None));
        }
        let (repo, integ) = match self.merge_material(run_id) {
            Ok(x) => x,
            Err(e) => return Some(self.stop_auto_merge(run_id, e.code, None)),
        };
        if !self.claim_merge(run_id) {
            return Some(self.stop_auto_merge(run_id, "merge-busy", None));
        }
        let out = self.merge_claimed(run_id, &repo, &integ, Actor::Server);
        self.release_merge(run_id);
        Some(match out {
            Ok(Outcome::Merged { commit, target, .. }) => json!({ "merged": true, "commit": commit, "target": target }),
            Ok(Outcome::Already) => json!({ "merged": true, "already": true }),
            Ok(Outcome::Blocked(c)) => {
                let (word, detail) = c.refusal().unwrap_or(("merge-failed", None));
                self.stop_auto_merge(run_id, word, detail)
            }
            Ok(Outcome::Failed(f)) => self.stop_auto_merge(run_id, "merge-failed", Some(f.line)),
            Err(e) => self.stop_auto_merge(run_id, e.code, None),
        })
    }

    /// 터미널에서 직접 병합했나(상세 칸 `mergedOutside` — 사람 보드만). 앱이 적은 병합이 없을 때 내보낸 머리가 대상 브랜치에 들어 있으면 참.
    /// 아직 아무것도 통합하지 않은 앨범(머리 = 시작 커밋)은 "들어 있다" 가 뜻이 없어 거짓. 블로킹(git 두 번).
    pub(super) fn merged_outside(&self, run_id: &str) -> bool {
        let material = {
            let g = self.lock();
            g.runs.get(run_id).and_then(|s| {
                let i = s.run.integration.as_ref()?;
                let head = i.exported_head.as_ref()?;
                let target = i.base_branch.as_ref()?;
                let recorded = s.run.merge.as_ref().and_then(|m| m.merged.as_ref()).is_some_and(|m| &m.head == head);
                if recorded || head != &i.expected_head || head == &i.base_commit {
                    return None;
                }
                Some((PathBuf::from(&s.run.repo), head.clone(), format!("refs/heads/{target}")))
            })
        };
        let (Some((repo, head, target)), Some(hand)) = (material, self.integrator()) else { return false };
        match hand.read_ref(&repo, &target) {
            Ok(Some(tip)) => hand.is_ancestor(&repo, &head, &tip).unwrap_or(false),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_paths_skip_the_old_rename_path() {
        assert_eq!(
            parse_status_z(" M README.md\0R  new.txt\0old.txt\0A  a b.txt\0"),
            vec!["README.md".to_string(), "new.txt".to_string(), "a b.txt".to_string()]
        );
        assert!(parse_status_z("").is_empty());
    }

    #[test]
    fn numstat_counts_binary_as_zero_lines() {
        assert_eq!(parse_numstat_z("3\t1\ta.txt\0-\t-\tb.bin\0"), (2, 3, 1));
        assert_eq!(parse_numstat_z(""), (0, 0, 0));
    }

    #[test]
    fn taken_paths_include_a_file_in_the_folder_seat() {
        let dir = std::env::temp_dir().join(format!("aynx-merge-taken-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("d")).unwrap();
        std::fs::write(dir.join("f"), "x").unwrap();
        assert!(path_taken(&dir, "f"), "그 자리의 파일");
        assert!(path_taken(&dir, "d"), "그 자리의 폴더");
        assert!(path_taken(&dir, "f/under.txt"), "폴더 자리를 막은 파일");
        assert!(!path_taken(&dir, "d/under.txt"));
        assert!(!path_taken(&dir, "none/under.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
