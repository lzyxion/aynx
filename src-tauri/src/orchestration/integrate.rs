//! **통합 작업 — 영속 의도 · 취소 계약 · 재시작 복구 · 보류 · Run 완료**(통합 설계 2단계 — docs/log/2026-10-15-orchestration-integration-design.md
//! 2-4 · 2-6 · 3-4 · 4-3 ⑥ · 4-4 · 4-5 · R3 · R4 · R15).
//!
//! 수락 요청 하나 = 통합 작업([`IntegrationJob`]) 하나. 흐름(4-3):
//! ① 관문 → Job `prepared` · Task `integrating`([`begin_in`]) → ②~④ 후보 계산(`accept.rs` 의 `drive_job` — `merge-tree` ·
//! `commit-tree` 뒤 [`Orchestration::set_candidate`] 로 적는다) → ⑤ 검증(**4단계**) → ⑥ 올리기([`Orchestration::commit_job`]):
//! (잠금 안) 재확인 → `committing` → (잠금 밖) **의도 저장 확인** → ref 트랜잭션 하나(`update-ref --stdin` — 통합 ref CAS + 완료 증거
//! `done/<jobId>` + 보고 커밋 보존 ref) → (잠금 안) 결과.
//!
//! 불변식:
//! - **`committing` 은 그 기록의 영속 저장 성공이 확인된 뒤에만 CAS 로 간다**(R3). 저장이 실패하면 CAS 하지 않고 Job `aborted:persist-failed` ·
//!   Task `reported` · Run 보류 `persist-failed`.
//! - **취소 ↔ 올리기는 같은 잠금에서 직렬화**(4-4): `committing` 으로 넘어가는 것과 사람 [취소] · Run 중단 · 세대 교체는 같은 잠금 안에서
//!   일어난다 — 넘어간 뒤의 취소는 `integration-committing`, 통합 뒤는 `already-integrated`. Run 중단은 커밋 중인 Job 이 끝날 때까지
//!   stopped 가 되지 않는다(`settle_stopping` 이 Job 도 센다).
//! - **성공 판정은 끝 코드가 아니라 stdout 의 `commit: ok` 줄**(0a U7 — `prepare` 뒤 `commit` 없이 stdin 이 닫혀도 끝 코드 0). 실패 이유는
//!   문장으로 가르지 않는다 — 다시 읽어 통합 ref 가 `old` 가 아니면 `moved`(보류), 같으면 `ref-tx`.
//! - **재시작 복구**(4-4): 서버가 죽은 뒤(orphaned) `committing` Job 은 완료 증거 ref `done/<jobId>` 로 판정한다 — 있으면 통합됨(의도 기록으로
//!   `AcceptedArtifact` 를 채우고 사건 `recovered_integrated`), 없으면 `aborted:crashed`. 그 앞 단계는 통합 안 됨. 통합 ref 가 복구된
//!   `expectedHead` 와 다르면 보류 `integration-diverged` 를 표시한다. 판정은 증거 ref 기준이라 다시 해도 같다.
//! - 외부 변경(4-5)은 **자동 채택하지 않는다** — Run 보류. 보류 중에는 새 Job · 새 Attempt · 조율 쓰기 · [재개]가 `run-on-hold`.
//! - **Run 완료**(3-4)는 사람의 [Run 완료] op 와 조정자 MCP `complete_run`(3차 5단계 · Q5) 둘이고 몸은 [`Orchestration::complete_run_by`]
//!   하나다(같은 `completable` 판정). `RunState::Done` 경로는 이것 하나다.
//! - 통합 ref 이름은 서버가 id 로만 짓는다(`refs/aynx/orch/<run16>/…` — id hex 앞 16자 · 비브랜치 · N1 — [`refs`]). git 은 공용 실행기(`git.rs` — 셸 없음 ·
//!   `GIT_*` 걷기 · 훅 끔 · 끝 코드 보존)로만 부른다.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use super::git::{child_env, hex40, Git};
use super::model::*;
use super::report::{acceptable, review_target};
use super::store::{
    conflict, human_detail, human_slot, not_found_run, reason, revoke_run, settle_stopping, state_error, writable, OrchError,
    Orchestration, Slot,
};
use crate::audit::OrchestrationAudit;
use crate::server::log;

// ---------------------------------------------------------------------------
// ref 이름 · 트랜잭션
// ---------------------------------------------------------------------------

/// 서버가 쓰는 ref 이름(통합 설계 2-1 · 4-1 · 4-3) — id(hex) 로만 짓는다.
///
/// **짧은 이름**(E2E 10-16): 긴 id(`run-<32hex>` 등) 그대로면 깊은 경로 저장소에서 `.git/refs/…` 의 느슨한 ref 파일(과 `.lock`)이 Windows
/// 경로 길이를 넘어 `update-ref` 가 `Filename too long` 으로 실패한다(`core.longpaths` 로도 안 고쳐진다 — 실측). 그래서 모든 id 를 접두어를
/// 뗀 hex **앞 [`SHORT`] 자**로 줄인다 — `.git/` 뒤 ref 경로의 최댓값은 [`MAX_REF_LEN`](시험 `ref_names_are_short`).
/// - Run: 같은 저장소에 같은 짧은 이름의 ref 가 하나라도 있으면 시작이 id 를 다시 뽑는다(`accept.rs::start_integrated_run`).
/// - Job · Task: 한 Run 안의 64비트 무작위 — 충돌을 따로 막지 않는다(수백 개에서 확률 ~1e-15).
pub(crate) mod refs {
    /// 짧은 이름의 hex 글자 수(64비트).
    pub(crate) const SHORT: usize = 16;
    /// `refs/aynx/orch/<run16>/candidate/<job16>` — 가장 긴 이름의 길이 상한(시험이 지킨다).
    #[cfg(test)]
    pub(crate) const MAX_REF_LEN: usize = 70;

    /// id 의 짧은 이름 — 접두어(`run-` 등)를 떼고 앞 [`SHORT`] 자. 접두어가 없으면 글자 그대로의 앞 [`SHORT`] 자.
    pub(crate) fn short(id: &str) -> String {
        let hex = id.split_once('-').map(|(_, h)| h).unwrap_or(id);
        hex.chars().take(SHORT).collect()
    }

    /// 지금 ref 뿌리 — 새 Run 은 모두 여기에 선다. 이미 선 Run 은 저장된 통합 ref 의 뿌리를 따른다([`base_of`] —
    /// 제품 이름이 바뀌기 전에 선 Run 도 옛 이름을 몰라도 읽고 정리된다).
    pub(crate) const ROOT: &str = "refs/aynx/orch/";

    /// **새** Run 의 ref 머리(`refs/aynx/orch/<run16>/`) — 시작 op 가 통합 ref 를 짓고 짧은 이름 충돌을 훑는다.
    /// 이미 선 Run 의 머리는 [`base_of`](저장된 통합 ref 에서 읽는다).
    pub(crate) fn run_prefix(run: &str) -> String {
        format!("{ROOT}{}/", short(run))
    }

    /// 이미 선 Run 의 ref 머리(`…/<run16>/`). 타입을 따로 둔 것은 Run id(`&str`)를 머리 자리에 잘못 넘기지 않게 —
    /// 머리는 [`base_of`] 로만 얻는다.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct Base(String);

    impl Base {
        pub(crate) fn as_str(&self) -> &str {
            &self.0
        }
    }

    /// 이미 선 Run 의 ref 머리 — 저장된 통합 ref(`integration.workRef`)의 뿌리를 따른다.
    /// [정리] 목록 · 완료 증거 · 보존 · 후보 · 충돌 · 되돌림 ref 가 모두 이 머리 아래에 있다.
    ///
    /// 영속 Run 파일에는 통합 ref 이름만 저장된다. 그 이름이 `refs/<뿌리>/orch/<그 Run 의 run16>/…` 꼴이면 그 앞부분을
    /// 머리로 쓴다 — **뿌리 이름을 모른 채** 일반적으로 끌어내므로, 제품 이름이 바뀌기 전의 Run(예: AYNX 개명 전
    /// `refs/<옛 이름>/orch/…`)도 리터럴 없이 복구 판정 · 수락 · 회수 · [정리] 가 같은 머리에서 돈다(2026-10-22 2차 —
    /// docs/log/2026-10-22-rename-aynx.md). `<뿌리>` 는 한 성분이고 브랜치 · 태그 · 원격 자리(`heads` · `tags` · `remotes`)는
    /// 아니어야 한다. 꼴이 아니거나 통합 ref 가 없으면 지금 뿌리([`run_prefix`])다.
    pub(crate) fn base_of(run: &str, work_ref: &str) -> Base {
        let tail = format!("/orch/{}/", short(run));
        let derived = work_ref.strip_prefix("refs/").and_then(|rest| {
            let i = rest.find(&tail)?;
            let root = &rest[..i];
            let ok = !root.is_empty()
                && !root.contains('/')
                && !matches!(root, "heads" | "tags" | "remotes");
            ok.then(|| format!("refs/{root}{tail}"))
        });
        Base(derived.unwrap_or_else(|| run_prefix(run)))
    }

    /// 시험용 — 새 Run 의 머리(= [`base_of`] 에 지금 뿌리의 통합 ref 를 준 것).
    #[cfg(test)]
    pub(crate) fn new_base(run: &str) -> Base {
        base_of(run, &int(run))
    }

    /// 통합의 진실(비브랜치 — N1). 시작 op 가 만든다(Run 의 `integration.workRef` — 그 뒤로는 저장된 값을 쓴다).
    pub(crate) fn int(run: &str) -> String {
        format!("{}int", run_prefix(run))
    }

    /// 완료 증거 — 재시작 복구가 이것으로 판정한다(4-4). `base` = 그 Run 의 머리([`base_of`]).
    pub(crate) fn done(base: &Base, job: &str) -> String {
        format!("{}done/{}", base.0, short(job))
    }

    /// 수락한 보고 커밋의 보존 ref(4-1 — squash 의 조상이 아니라 gc 를 막는다).
    pub(crate) fn accepted(base: &Base, task: &str) -> String {
        format!("{}accepted/{}", base.0, short(task))
    }

    /// 후보 커밋의 gc 방지 ref(4-3 ④) — 올리기 트랜잭션이 함께 지운다. **Job 마다 따로**(리뷰 F6 — 늦게 끝난 옛 Job 의 계산 · 회수가
    /// 새 Job 의 후보 ref 를 덮거나 지우지 않게). 쓰는 것은 그 Job 의 계산 스레드(살아 있을 때만) · 덮어쓰기 Job 뿐이다.
    pub(crate) fn candidate(base: &Base, job: &str) -> String {
        format!("{}{}", candidate_prefix(base), short(job))
    }

    /// 후보 ref 들의 머리(회수가 `for-each-ref` 로 훑는다 — 꼬리는 Job 의 [`short`]).
    pub(crate) fn candidate_prefix(base: &Base) -> String {
        format!("{}candidate/", base.0)
    }

    /// 충돌 트리(표식 박힌 blob)를 붙잡는 ref(4-3 ⑦ · 4-6).
    pub(crate) fn conflict(base: &Base, task: &str) -> String {
        format!("{}conflict/{}", base.0, short(task))
    }

    /// [조정]의 되돌리기가 사람이 올린 머리를 보존하는 ref(4-5).
    pub(crate) fn diverged(base: &Base, n: u64) -> String {
        format!("{}diverged/{n}", base.0)
    }
}

/// ref 트랜잭션 하나(4-3 ⑥) — 통합 ref CAS · 완료 증거 · 보존 ref · 후보 ref 지우기가 **함께** 서거나 함께 안 선다(0a U1~U12).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RefTx {
    pub work_ref: String,
    /// CAS 의 old(후보를 계산할 때의 통합 머리).
    pub old: String,
    /// 후보 커밋.
    pub new: String,
    pub done_ref: String,
    pub preserve_ref: String,
    pub report_commit: String,
    /// 보존 ref 가 이미 있으면 그 OID(재통합 — `create` 는 이미 있으면 실패하므로 `update` CAS, 0a U3).
    pub preserve_old: Option<String>,
    /// 함께 지울 후보 ref(있을 때만 — `delete <ref> <new>`).
    pub candidate_ref: Option<String>,
}

impl RefTx {
    /// `update-ref --stdin` 의 입력 — OID 는 40 hex · ref 이름은 공백 · 제어 문자 없음일 때만(줄이 섞이지 않게).
    pub(crate) fn script(&self) -> Result<String, String> {
        let oids = [Some(&self.old), Some(&self.new), Some(&self.report_commit), self.preserve_old.as_ref()];
        if oids.iter().flatten().any(|o| !hex40(o)) {
            return Err("a ref transaction needs full 40-hex object ids".into());
        }
        let names = [Some(&self.work_ref), Some(&self.done_ref), Some(&self.preserve_ref), self.candidate_ref.as_ref()];
        if names
            .iter()
            .flatten()
            .any(|n| !n.starts_with("refs/") || n.chars().any(|c| c.is_whitespace() || c.is_control()))
        {
            return Err("a ref transaction got a bad ref name".into());
        }
        let mut s = String::from("start\n");
        s.push_str(&format!("update {} {} {}\n", self.work_ref, self.new, self.old));
        s.push_str(&format!("create {} {}\n", self.done_ref, self.new));
        match &self.preserve_old {
            Some(o) => s.push_str(&format!("update {} {} {}\n", self.preserve_ref, self.report_commit, o)),
            None => s.push_str(&format!("create {} {}\n", self.preserve_ref, self.report_commit)),
        }
        if let Some(c) = &self.candidate_ref {
            s.push_str(&format!("delete {} {}\n", c, self.new));
        }
        s.push_str("prepare\ncommit\n");
        Ok(s)
    }
}

/// 트랜잭션이 섰나 — **stdout 의 `commit: ok` 줄**로만(0a U7: 끝 코드 0 인데 아무것도 안 바뀐 경우가 있다). 순수.
pub(crate) fn tx_committed(stdout: &str) -> bool {
    stdout.lines().any(|l| l.trim_end_matches('\r') == "commit: ok")
}

/// 트랜잭션 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TxOutcome {
    /// `commit: ok`.
    Committed,
    /// git 이 거절했다(`prepare` 실패 등 — stderr 첫 줄). 이유는 부르는 쪽이 ref 를 다시 읽어 가른다.
    Refused(String),
}

/// 3-way 결과(`merge-tree` — 통합 설계 4-3 ③).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MergeResult {
    /// 끝 코드 0 — 트리.
    Clean { tree: String },
    /// 끝 코드 1 — 충돌(표식 박힌 트리 + stage · 메시지).
    Conflict(super::merge::MergeParsed),
    /// 그 밖(128 — 잘못된 OID · 실패한 필터 프로세스 등) — stderr 첫 줄.
    Failed(String),
}

/// 신원이 없어 커밋 객체를 만들지 못했다(`commit_tree` 의 `Err` 글자 — 사람이 `user.name` · `user.email` 을 정해야 한다).
pub(crate) const NO_GIT_IDENTITY: &str = "no-git-identity";

/// 통합 git 손 — 서버는 진짜 git([`GitRefs`]), 시험은 가짜(2단계 시험은 ref 셋만 흉내 낸다 — 나머지는 기본 `Err`).
/// 3단계(통합 설계 4-2 · 4-3 ②~④ · 4-5)가 판 검사 · 지원 범위 검사 · `merge-tree` · `commit-tree` · 일반 ref 트랜잭션 · 체크아웃 목록을 더했다.
pub(crate) trait IntegrationGit: Send + Sync {
    /// ref 트랜잭션 하나. `Err` = git 을 돌리지 못했거나 결과를 모른다(시한 등).
    fn apply(&self, repo: &Path, tx: &RefTx) -> Result<TxOutcome, String>;
    /// ref 하나의 OID(없으면 `None`).
    fn read_ref(&self, repo: &Path, name: &str) -> Result<Option<String>, String>;
    /// `ancestor` 가 `of` 의 조상(또는 같음)인가(merge-base 계약 4-3 ③ · [조정]의 받아들이기 4-5).
    fn is_ancestor(&self, repo: &Path, ancestor: &str, of: &str) -> Result<bool, String>;
    /// git 판 `(major, minor)`(Run 시작 때 — 4-2 끝).
    fn git_version(&self, _repo: &Path) -> Result<(u32, u32), String> {
        Err("this git hand cannot read the git version".into())
    }
    /// 주 작업 폴더의 지금 `HEAD` 커밋과 브랜치(분리 HEAD 면 `None`). 커밋이 없으면 `Ok(None)`.
    fn head(&self, _repo: &Path) -> Result<Option<(String, Option<String>)>, String> {
        Err("this git hand cannot read HEAD".into())
    }
    /// 일반 ref 트랜잭션(통합 ref 만들기 · 후보 ref · 충돌 ref · 내보내기 · [조정]) — `commit: ok` 로 판정.
    fn update_refs(&self, _repo: &Path, _ops: &[super::merge::RefOp]) -> Result<TxOutcome, String> {
        Err("this git hand cannot update refs".into())
    }
    /// 지원 범위 검사(4-2) — 거절 사유 낱말(`merge-driver` · `filters` · `renormalize` · `submodule` — 세 트리 사이에서 gitlink 가 바뀜)
    /// 또는 `None`.
    fn unsupported(&self, _repo: &Path, _old: &str, _report: &str, _base: &str) -> Result<Option<&'static str>, String> {
        Err("this git hand cannot check the repository settings".into())
    }
    /// `git --attr-source=<old> merge-tree --write-tree -z --messages --merge-base=<base> <old> <report>`.
    fn merge(&self, _repo: &Path, _base: &str, _old: &str, _report: &str) -> Result<MergeResult, String> {
        Err("this git hand cannot merge".into())
    }
    /// 커밋 객체 하나(`commit-tree <tree> -p <parent>` — 신원은 저장소 · 사용자 설정, 없으면 `Err(`[`NO_GIT_IDENTITY`]`)`).
    fn commit_tree(&self, _repo: &Path, _tree: &str, _parent: &str, _message: &str) -> Result<String, String> {
        Err("this git hand cannot write commits".into())
    }
    /// 어느 worktree 에서든 체크아웃된 브랜치 ref(`refs/heads/…` — 내보내기 거절 4-5).
    fn checked_out(&self, _repo: &Path) -> Result<Vec<String>, String> {
        Err("this git hand cannot list worktrees".into())
    }
    /// 충돌 트리 `tree` 에서 대상 경로마다 git 이 표식을 실제로 박았나(3b — 4-6 표식 실측 · `conflict-marker-size` 는 `check.attr_source`).
    /// 못 읽으면 `Err` — 부르는 쪽은 사람에게 넘긴다(보수적).
    fn markers_inserted(&self, _repo: &Path, _tree: &str, _check: &super::resolve::MarkerCheck) -> Result<Vec<bool>, String> {
        Err("this git hand cannot read conflict markers".into())
    }
    /// `prefix` 아래의 ref 들 `(이름, OID)`(6단계 [정리] — `for-each-ref`). 못 읽으면 `Err`.
    fn list_refs(&self, _repo: &Path, _prefix: &str) -> Result<Vec<(String, String)>, String> {
        Err("this git hand cannot list refs".into())
    }
}

/// 진짜 git — 공용 실행기(`git.rs`)로만.
pub(crate) struct GitRefs;

impl GitRefs {
    fn run(repo: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<super::git::Out, String> {
        let env = child_env(std::env::vars_os());
        let hooks = super::worktree::empty_hooks_dir();
        let g = Git::new(repo, &hooks, &env, reason::INTEGRATION_FAILED).map_err(|e| e.message)?;
        g.run(args, &[], stdin).map_err(|e| e.message)
    }

    /// 성공만 — 끝 코드 0 이 아니거나 출력이 잘렸으면 `Err`.
    fn ok(repo: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<String, String> {
        let env = child_env(std::env::vars_os());
        let hooks = super::worktree::empty_hooks_dir();
        let g = Git::new(repo, &hooks, &env, reason::INTEGRATION_FAILED).map_err(|e| e.message)?;
        g.ok(args, &[], stdin).map_err(|e| e.message)
    }
}

impl IntegrationGit for GitRefs {
    fn apply(&self, repo: &Path, tx: &RefTx) -> Result<TxOutcome, String> {
        let script = tx.script()?;
        let o = Self::run(repo, &["update-ref", "--stdin"], Some(script.as_bytes()))?;
        Ok(if tx_committed(&o.stdout) {
            TxOutcome::Committed
        } else {
            TxOutcome::Refused(o.line())
        })
    }

    fn read_ref(&self, repo: &Path, name: &str) -> Result<Option<String>, String> {
        let o = Self::run(repo, &["rev-parse", "--verify", "--quiet", name], None)?;
        match o.code {
            Some(0) => {
                let oid = o.stdout.trim().to_string();
                if hex40(&oid) {
                    Ok(Some(oid))
                } else {
                    Err("rev-parse printed something that is not an object id".into())
                }
            }
            Some(1) if o.stdout.trim().is_empty() => Ok(None),
            _ => Err(o.line()),
        }
    }

    fn is_ancestor(&self, repo: &Path, ancestor: &str, of: &str) -> Result<bool, String> {
        let o = Self::run(repo, &["merge-base", "--is-ancestor", ancestor, of], None)?;
        match o.code {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(o.line()),
        }
    }

    fn git_version(&self, repo: &Path) -> Result<(u32, u32), String> {
        let o = Self::ok(repo, &["version"], None)?;
        super::merge::parse_git_version(&o).ok_or_else(|| "could not read the git version".to_string())
    }

    fn head(&self, repo: &Path) -> Result<Option<(String, Option<String>)>, String> {
        let o = Self::run(repo, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], None)?;
        let oid = o.stdout.trim().to_string();
        if !o.ok() || !hex40(&oid) {
            return if o.stderr.trim().is_empty() { Ok(None) } else { Err(o.line()) };
        }
        let b = Self::run(repo, &["symbolic-ref", "-q", "--short", "HEAD"], None)?;
        let branch = Some(b.stdout.trim().to_string()).filter(|s| b.ok() && !s.is_empty());
        Ok(Some((oid, branch)))
    }

    fn update_refs(&self, repo: &Path, ops: &[super::merge::RefOp]) -> Result<TxOutcome, String> {
        let script = super::merge::ref_script(ops)?;
        let o = Self::run(repo, &["update-ref", "--stdin"], Some(script.as_bytes()))?;
        Ok(if tx_committed(&o.stdout) {
            TxOutcome::Committed
        } else {
            TxOutcome::Refused(o.line())
        })
    }

    fn unsupported(&self, repo: &Path, old: &str, report: &str, base: &str) -> Result<Option<&'static str>, String> {
        // 설정 — 실효 값(include 까지). 끝 코드 1 = 해당 키 없음.
        let c = Self::run(repo, &["config", "--get-regexp", r"^merge\."], None)?;
        match c.code {
            Some(0) => {
                if let Some(r) = super::merge::config_refusal(&c.stdout) {
                    return Ok(Some(r));
                }
            }
            Some(1) => {}
            _ => return Err(c.line()),
        }
        // 세 트리의 변경 경로 합집합 — gitlink(submodule)가 바뀐 통합은 거절(그대로인 gitlink 는 괜찮다), 속성은 세 트리 각각으로(4-2 속성 출처).
        let mut paths: Vec<String> = Vec::new();
        for side in [old, report] {
            let d = Self::ok(
                repo,
                &["diff", "--raw", "-z", "--no-renames", "--no-ext-diff", "--no-abbrev", base, side, "--"],
                None,
            )?;
            let (changed, gitlink) = super::merge::parse_raw_z(&d);
            if gitlink {
                return Ok(Some("submodule"));
            }
            for p in changed {
                if !paths.contains(&p) {
                    paths.push(p);
                }
            }
        }
        if paths.is_empty() {
            return Ok(None);
        }
        let mut input: Vec<u8> = Vec::new();
        for p in &paths {
            input.extend_from_slice(p.as_bytes());
            input.push(0);
        }
        for tree in [old, report, base] {
            let src = format!("--source={tree}");
            let a = Self::ok(repo, &["check-attr", &src, "-z", "--stdin", "merge", "filter"], Some(&input))?;
            if let Some(r) = super::merge::attr_refusal(&a) {
                return Ok(Some(r));
            }
        }
        Ok(None)
    }

    fn merge(&self, repo: &Path, base: &str, old: &str, report: &str) -> Result<MergeResult, String> {
        let attr = format!("--attr-source={old}");
        let mb = format!("--merge-base={base}");
        let o = Self::run(repo, &[&attr, "merge-tree", "--write-tree", "-z", "--messages", &mb, old, report], None)?;
        if o.truncated {
            return Err("merge-tree printed more than the app reads".into());
        }
        match o.code {
            Some(0) => {
                let p = super::merge::parse_merge_tree(&o.stdout)?;
                Ok(MergeResult::Clean { tree: p.tree })
            }
            Some(1) => Ok(MergeResult::Conflict(super::merge::parse_merge_tree(&o.stdout)?)),
            _ => Ok(MergeResult::Failed(o.line())),
        }
    }

    fn commit_tree(&self, repo: &Path, tree: &str, parent: &str, message: &str) -> Result<String, String> {
        let env = child_env(std::env::vars_os());
        let hooks = super::worktree::empty_hooks_dir();
        let g = Git::new(repo, &hooks, &env, reason::INTEGRATION_FAILED).map_err(|e| e.message)?;
        let get = |k: &str| -> Result<String, String> {
            let o = g.run(&["config", "--get", k], &[], None).map_err(|e| e.message)?;
            Ok(if o.ok() { o.stdout.trim().to_string() } else { String::new() })
        };
        let (name, email) = (get("user.name")?, get("user.email")?);
        if name.is_empty() || email.is_empty() || name.chars().any(char::is_control) || email.chars().any(char::is_control) {
            return Err(NO_GIT_IDENTITY.into());
        }
        let cenv: [(&str, &str); 4] = [
            ("GIT_AUTHOR_NAME", name.as_str()),
            ("GIT_AUTHOR_EMAIL", email.as_str()),
            ("GIT_COMMITTER_NAME", name.as_str()),
            ("GIT_COMMITTER_EMAIL", email.as_str()),
        ];
        let c = g
            .ok(&["commit-tree", tree, "-p", parent, "--no-gpg-sign", "-F", "-"], &cenv, Some(message.as_bytes()))
            .map_err(|e| e.message)?;
        let c = c.trim().to_string();
        if hex40(&c) {
            Ok(c)
        } else {
            Err("git commit-tree gave no commit".into())
        }
    }

    fn checked_out(&self, repo: &Path) -> Result<Vec<String>, String> {
        let o = Self::ok(repo, &["worktree", "list", "--porcelain"], None)?;
        Ok(super::merge::checked_out_branches(&o))
    }

    fn markers_inserted(&self, repo: &Path, tree: &str, check: &super::resolve::MarkerCheck) -> Result<Vec<bool>, String> {
        let env = child_env(std::env::vars_os());
        let hooks = super::worktree::empty_hooks_dir();
        let g = Git::new(repo, &hooks, &env, reason::INTEGRATION_FAILED).map_err(|e| e.message)?;
        super::resolve::markers_inserted_blocking(&g, tree, check).map_err(|e| e.message)
    }

    fn list_refs(&self, repo: &Path, prefix: &str) -> Result<Vec<(String, String)>, String> {
        if !prefix.starts_with("refs/") || prefix.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("bad ref prefix".into());
        }
        let o = Self::ok(repo, &["for-each-ref", "--format=%(objectname) %(refname)", prefix], None)?;
        Ok(o
            .lines()
            .filter_map(|l| {
                let (oid, name) = l.trim_end_matches('\r').split_once(' ')?;
                (hex40(oid) && name.starts_with(prefix)).then(|| (name.to_string(), oid.to_string()))
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// 시험 갈고리
// ---------------------------------------------------------------------------

/// 올리기의 단계(시험 갈고리 — 그 자리에서 "서버가 죽었다" 를 흉내 내거나 취소 · 중단을 끼운다).
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IntegrateStep {
    /// `committing` 으로 넘어간 직후(의도 저장 확인 전).
    Committing,
    /// 의도 저장이 확인된 뒤 · ref 트랜잭션 직전(CAS 직전).
    BeforeCas,
    /// ref 트랜잭션 직후 · 결과를 장부에 적기 전(CAS 직후).
    AfterCas,
    /// 후보 계산이 끝나 이 Job 의 후보 ref 를 쓰기 직전(`accept.rs` — 반환값은 보지 않는다, 취소 · 새 Job 을 끼우는 자리).
    BeforeCandidateRef,
}

/// 갈고리 — `true` 를 돌려주면 그 자리에서 멈춘다(장부를 더 건드리지 않는다 — 프로세스 죽음 흉내).
#[cfg(test)]
pub(crate) type IntegrateHook = Arc<dyn Fn(&Orchestration, IntegrateStep) -> bool + Send + Sync>;

// ---------------------------------------------------------------------------
// 잠금 안의 조각
// ---------------------------------------------------------------------------

/// 올리기 결과 판정.
enum Verdict {
    /// 통합됨 — `diverged` = 통합 ref 가 새 머리(후보)가 아니다(사람이 그 뒤 움직였거나 부분 실패).
    Integrated { diverged: bool },
    /// 의도 저장 실패 — CAS 하지 않았다.
    PersistFailed,
    /// 통합 ref 가 `old` 가 아니었다(외부 변경 — 4-5).
    Moved,
    /// git 이 트랜잭션을 거절했다(통합 ref 는 그대로).
    Refused,
    /// 결과를 모른다(git 을 읽지 못함) — **확정하지 않는다**(리뷰 F7): Job 은 `committing` 그대로 · 보류 · 서버 시계가 증거 ref 로 다시
    /// 판정한다(재시작 뒤에는 재시작 복구가 같은 판정을 한다).
    Unknown,
}

/// Job 을 거둔다(끝 상태 `aborted`) — Task 가 아직 `integrating` 이면 `reported` 로(수락 안 됨).
pub(super) fn abort_job_in(slot: &mut Slot, ji: usize, now: u64, actor: Actor, why: &str) {
    let job = &mut slot.run.jobs[ji];
    job.phase = JobPhase::Aborted;
    job.outcome = Some(JobOutcome {
        reason: why.to_string(),
        at: now,
    });
    let task_id = job.task_id.clone();
    if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id && t.state == TaskState::Integrating) {
        t.state = TaskState::Reported;
        t.version += 1;
        t.updated_at = now;
    }
    slot.run.bump(now, actor, "integration_aborted", Some(&task_id), why);
}

/// 커밋 단계 전의 Job 을 모두 거둔다(Run 중단 · 세대 교체 — 4-4). `committing` 은 건드리지 않는다(끝을 기다린다). 거둔 Job id.
pub(super) fn abort_cancellable(slot: &mut Slot, now: u64, actor: Actor, why: &str) -> Vec<String> {
    let idx: Vec<usize> = slot
        .run
        .jobs
        .iter()
        .enumerate()
        .filter(|(_, j)| j.phase.cancellable())
        .map(|(i, _)| i)
        .collect();
    // 검증 중인 Job 은 깃발만 세운다 — 트리 종료 확인 뒤 검증 쪽이 거둔다(통합 설계 4-4 · R9). `settle_stopping` 이 그때까지 기다린다.
    idx.into_iter()
        .filter_map(|i| {
            let id = slot.run.jobs[i].job_id.clone();
            if slot.run.jobs[i].phase == JobPhase::Verifying && super::verify::signal_cancel(slot, &id, why) {
                return None;
            }
            abort_job_in(slot, i, now, actor, why);
            Some(id)
        })
        .collect()
}

/// 통합됨을 장부에 적는다(올리기 성공 · 재시작 복구) — 수락 산출물(통합 커밋 · 보존 ref) · 검토 기록 · Task accepted · `expectedHead`.
fn integrated_in(slot: &mut Slot, ji: usize, now: u64, recovered: bool) {
    let job = slot.run.jobs[ji].clone();
    let candidate = job.candidate.clone().unwrap_or_default();
    // 검증 요약(4단계) — 통과면 이 Job 의 결과, 덮어쓰기면 **실패한 그 Job 의 실패 결과**(새 후보의 통과로 적지 않는다).
    let verification = match &job.override_ {
        Some(o) => slot
            .run
            .jobs
            .iter()
            .find(|j| j.job_id == o.failed_job_id)
            .and_then(|j| j.verify.as_ref())
            .map(|v| (v.clone(), true)),
        None => job.verify.clone().map(|v| (v, false)),
    }
    .map(|(v, overridden)| Verification {
        verify_id: v.verify_id,
        job_id: v.job_id,
        outcome: v.outcome,
        exit_code: v.exit_code,
        command_sha: v.command_sha,
        hermetic: v.hermetic,
        overridden,
    });
    slot.run.accepted.push(AcceptedArtifact {
        task_id: job.task_id.clone(),
        attempt_id: job.attempt_id.clone(),
        report_id: job.report_id.clone(),
        commit_oid: job.report_commit.clone(),
        base_commit_oid: job.merge_base.clone(),
        reviewer: job.by,
        verification,
        accepted_at: now,
        revoked_at: None,
        revoked_by: None,
        integration_commit: Some(candidate.clone()),
        integration_parent: job.old.clone(),
        job_id: Some(job.job_id.clone()),
        preserve_ref: Some(refs::accepted(&run_base(&slot.run), &job.task_id)),
        review_id: job.review_id.clone(),
        review_waived_by: job.review_waived.then_some(job.by),
        waived: job.waived.clone(),
        waived_by: (!job.waived.is_empty()).then_some(job.by),
        judgments: job.judgments.clone(),
    });
    // 수락이 섰다 — 남은 활성 검토는 무효화(5단계 — 관문이 이미 막지만 방어로). 멈춤은 서버 시계가 맡긴다(`stop_queue`).
    super::review::invalidate(slot, &job.task_id, now, Actor::Server, "accepted");
    slot.run.reviews.push(ReviewRecord {
        task_id: job.task_id.clone(),
        attempt_id: Some(job.attempt_id.clone()),
        report_id: Some(job.report_id.clone()),
        decision: Decision::Accepted,
        reviewer: job.by,
        flipped: false,
        at: now,
    });
    if let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == job.task_id) {
        t.state = TaskState::Accepted;
        t.conflict = None; // 통합이 섰다 — 옛 충돌 기록은 뜻을 잃었다(#7a).
        t.version += 1;
        t.updated_at = now;
    }
    if let Some(i) = slot.run.integration.as_mut() {
        i.expected_head = candidate;
    }
    let j = &mut slot.run.jobs[ji];
    j.phase = JobPhase::Integrated;
    j.outcome = Some(JobOutcome {
        reason: if recovered { "recovered" } else { "integrated" }.into(),
        at: now,
    });
    let action = if recovered { "recovered_integrated" } else { "task_integrated" };
    slot.run.bump(now, Actor::Server, action, Some(&job.task_id), &job.job_id);
}

/// 보류를 건다(4-5 · 4-3 ⑥) — running 이면 paused(`pause_reason: hold`). 중단 중 · 끝난 Run 은 표시만.
pub(super) fn set_hold(slot: &mut Slot, why: HoldReason, detail: Option<&str>, now: u64) {
    slot.run.hold = Some(RunHold {
        reason: why,
        at: now,
        detail: detail.map(str::to_string),
    });
    if slot.run.state == RunState::Running {
        slot.run.state = RunState::Paused;
        slot.run.pause_reason = Some("hold".into());
    }
    slot.run.bump(now, Actor::Server, "run_held", None, why.as_str());
}

/// Run 완료를 막는 것들(통합 설계 3-4) — 비면 완료할 수 있다.
pub(super) fn completable(slot: &Slot) -> Vec<&'static str> {
    let r = &slot.run;
    let mut out = Vec::new();
    if !matches!(r.state, RunState::Running | RunState::Paused) {
        out.push("run-state");
    }
    if r.tasks.iter().any(|t| !t.state.terminal()) {
        out.push("tasks-open");
    }
    if r.live_jobs() > 0 {
        out.push("integration-running");
    }
    // 술어 `turn_may_live`(헤드리스 설계 4-5 — 닫는 사건 `complete_run`): 도는 턴이 있으면 완료 못 한다. 남은 `idle` 은 완료가 닫는다
    // (산 프로세스 · 산 토큰이 없다). 옛 PTY Attempt(보고 뒤 아직 도는 CLI)는 `owns_worktree` 로 센다 — 옛 파일 호환.
    let pty_holding = r.attempts.iter().any(|a| a.exec_mode() == ExecMode::Pty && a.owns_worktree());
    if r.live_attempts() > 0 || pty_holding || slot.reserved_workers > 0 {
        out.push("workers-alive");
    }
    // 살아 있는(또는 종료를 확인하지 못한 — 리뷰 F8) 검증 트리.
    if slot.verify_trees > 0 {
        out.push("verify-running");
    }
    // 활성 검토(5단계 — 통합 설계 3-4).
    if r.tasks.iter().any(|t| t.review.active.is_some()) {
        out.push("review-active");
    }
    if r.hold.is_some() {
        out.push("on-hold");
    }
    out
}

/// 보기용 — `{ok, blockers}`.
pub(super) fn completable_view(slot: &Slot) -> Value {
    let b = completable(slot);
    json!({ "ok": b.is_empty(), "blockers": b })
}

/// 올리기 직전 재확인(잠금 안 — 4-3 ⑥ 첫 줄). 어긋났으면 그 까닭 낱말.
fn stale_reason(run: &Run, job: &IntegrationJob) -> Option<&'static str> {
    let Some(integ) = &run.integration else {
        return Some("no-integration");
    };
    if !matches!(run.state, RunState::Running | RunState::Paused) {
        return Some("stopped");
    }
    if run.hold.is_some() {
        return Some("on-hold");
    }
    if job.gen != run.gen {
        return Some("generation");
    }
    let Some(task) = run.task(&job.task_id) else {
        return Some("stale-task");
    };
    if task.state != TaskState::Integrating || task.version != job.task_version {
        return Some("stale-task");
    }
    if review_target(run, task).map(|r| r.report_id) != Some(job.report_id.clone()) {
        return Some("stale-report");
    }
    match (&job.old, &job.candidate) {
        (Some(old), Some(_)) if *old == integ.expected_head => None,
        (Some(_), Some(_)) => Some("stale-head"),
        _ => Some("no-candidate"),
    }
}

/// 감사 한 줄(통합 사건).
fn job_audit(gen: u32, actor: Actor, run: &Run, job: &IntegrationJob, why: Option<&str>) -> OrchestrationAudit {
    let task = run.task(&job.task_id);
    OrchestrationAudit {
        gen,
        actor: actor.as_str().into(),
        run_state: Some(run.state.as_str().into()),
        task_id: Some(job.task_id.clone()),
        task_version: task.map(|t| t.version),
        task_state: task.map(|t| t.state.as_str().into()),
        attempt_id: Some(job.attempt_id.clone()),
        commit_oid: if job.phase == JobPhase::Integrated {
            job.candidate.clone()
        } else {
            Some(job.report_commit.clone())
        },
        reviewer: Some(job.by.as_str().into()),
        reason: why.map(str::to_string),
        job_id: Some(job.job_id.clone()),
        ..Default::default()
    }
}

/// 완료 증거로 통합 여부를 판정한다(4-4 — 올리기 결과를 모를 때 · 재시작 복구). `done/<jobId>` 가 후보를 가리키면 통합됨.
fn judge_committed(git: &dyn IntegrationGit, repo: &Path, base: &refs::Base, job: &IntegrationJob) -> Result<bool, String> {
    let Some(candidate) = &job.candidate else { return Ok(false) };
    Ok(git.read_ref(repo, &refs::done(base, &job.job_id))?.as_deref() == Some(candidate.as_str()))
}

/// 이 Run 의 ref 머리 — 저장된 통합 ref 의 뿌리를 따른다([`refs::base_of`]). 통합 ref 가 없는 Run 은 지금 뿌리.
pub(super) fn run_base(run: &Run) -> refs::Base {
    match &run.integration {
        Some(i) => refs::base_of(&run.id, &i.work_ref),
        None => refs::base_of(&run.id, ""),
    }
}

fn job_index(run: &Run, job_id: &str) -> Result<usize, OrchError> {
    run.jobs
        .iter()
        .position(|j| j.job_id == job_id)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no integration job {job_id} in this run")))
}

fn job_view(run: &Run, job: &IntegrationJob) -> Value {
    json!({
        "task": run.task(&job.task_id),
        "jobId": job.job_id,
        "job": job,
        "accepting": job.phase.live(),
        "latestSeq": run.seq,
    })
}

/// ① 관문(잠금 안 — 4-3 ①) → Job `prepared` · Task `integrating`. `(보기, 감사, 새 Job id)` — 같은 `requestId` 의 Job 이 이미 있으면
/// 그 보기만(감사 · 새 Job 없음). 영속 · 깨우기는 부른 쪽(`after_change`).
#[allow(clippy::too_many_arguments)]
pub(super) fn begin_in(
    slot: &mut Slot,
    task_id: &str,
    version: u64,
    by: Reviewer,
    request_id: &str,
    now: u64,
    lookup: &super::album::RunInputs,
) -> Result<(Value, Option<OrchestrationAudit>, Option<String>), OrchError> {
    if request_id.is_empty() || request_id.len() > 128 || request_id.chars().any(char::is_control) {
        return Err(OrchError::new(reason::INVALID_ARGUMENT, "requestId must be 1..128 printable characters"));
    }
    if let Some(j) = slot.run.jobs.iter().find(|j| j.request_id == request_id) {
        if j.task_id != task_id {
            return Err(OrchError::new(
                reason::INVALID_ARGUMENT,
                format!("requestId {request_id} was already used for another task — use a new requestId"),
            ));
        }
        return Ok((job_view(&slot.run, j), None, None));
    }
    match by {
        Reviewer::Coordinator => writable(&slot.run)?,
        Reviewer::Human => match (slot.run.state, &slot.run.hold) {
            (_, Some(h)) => return Err(super::store::on_hold(h)),
            (RunState::Running | RunState::Paused, None) => {}
            (s, None) => return Err(state_error(s)),
        },
    }
    if slot.run.integration.is_none() {
        return Err(OrchError::new(
            reason::INVALID_STATE,
            "this run has no integration ref — accepting is immediate (first-generation run)",
        ));
    }
    if let Some(j) = slot.run.live_job() {
        return Err(OrchError::new(
            reason::INTEGRATION_BUSY,
            format!("integration job {} of this run is still running — wait for it (wait_run until settled)", j.job_id),
        ));
    }
    let task = slot
        .run
        .task(task_id)
        .cloned()
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")))?;
    if task.version != version {
        return Err(conflict(&task));
    }
    let from_ok = match by {
        Reviewer::Coordinator => task.state == TaskState::Reported,
        Reviewer::Human => matches!(task.state, TaskState::Reported | TaskState::Rejected),
    };
    if !from_ok {
        return Err(OrchError::new(
            reason::NOT_REPORTED,
            format!("task {task_id} is {} — only a reported task can be accepted", task.state.as_str()),
        ));
    }
    let (report, commit) = acceptable(&slot.run, &task)?;
    // 수락 전 검증(4단계) — 같은 보고의 검증 횟수 · Run 한도(R14).
    super::verify::begin_gate(&slot.run, &report.report_id)?;
    // 수락 규칙(3a · E18 — `requireReview` 의 일반화): 조정자는 맡기기 관문 · 활성 판정 · 필수 판정에 막히고(`accept-rule-unmet`), 사람은
    // 넘는다(활성 판정은 무효화 · 못 채운 규칙은 면제로 기록).
    let gate = lookup.accept_gate(&slot.run, &task, by)?;
    let job_id = new_id("job").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
    if gate.drop_active {
        super::review::invalidate(slot, task_id, now, Actor::Human, "accepting");
    }
    let review_id = gate.judgments.last().cloned();
    let review_waived = !gate.waived.is_empty();
    let gen = slot.run.gen;
    let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) else {
        return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
    };
    t.state = TaskState::Integrating;
    t.version += 1;
    t.updated_at = now;
    let task_version = t.version;
    let job = IntegrationJob {
        job_id: job_id.clone(),
        task_id: task_id.to_string(),
        gen,
        task_version,
        attempt_id: report.attempt_id.clone(),
        report_id: report.report_id.clone(),
        report_commit: commit,
        merge_base: report.base_commit_oid.clone(),
        old: None,
        candidate: None,
        candidate_tree: None,
        phase: JobPhase::Prepared,
        outcome: None,
        request_id: request_id.to_string(),
        by,
        started_at: now,
        committing_at: None,
        awaiting_at: None,
        approval: None,
        verify: None,
        override_: None,
        review_id,
        review_waived,
        waived: gate.waived,
        judgments: gate.judgments,
    };
    slot.run.jobs.push(job.clone());
    let actor = match by {
        Reviewer::Coordinator => Actor::Coordinator,
        Reviewer::Human => Actor::Human,
    };
    slot.run.bump(now, actor, "task_integrating", Some(task_id), &job_id);
    let detail = job_audit(gen, actor, &slot.run, &job, None);
    Ok((job_view(&slot.run, &job), Some(detail), Some(job_id)))
}

// ---------------------------------------------------------------------------
// 저장소 손
// ---------------------------------------------------------------------------

impl Orchestration {
    /// 통합 git 손을 꽂는다(서버 시작 — `serve::run`, 시험).
    pub(crate) fn set_integrator(&self, g: Arc<dyn IntegrationGit>) {
        *self.integrator.write().unwrap_or_else(|e| e.into_inner()) = Some(g);
    }

    pub(super) fn integrator(&self) -> Option<Arc<dyn IntegrationGit>> {
        self.integrator.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    #[cfg(test)]
    pub(super) fn crash_at(&self, step: IntegrateStep) -> bool {
        let hook = self.integrate_hook.lock().unwrap_or_else(|e| e.into_inner()).clone();
        hook.is_some_and(|h| h(self, step))
    }

    /// ① 관문(잠금 안) → Job `prepared` · Task `integrating`(4-3 ①) — 사람 [수락](`accept.rs` 의 `human_accept`)과 시험이 부른다(조정자는
    /// `coordinator_slot` 을 지나는 `accept.rs` 의 길). 같은 `requestId` 는 같은 Job 을 돌려준다(새로 만들지 않는다). 통합 작업을 돌리는
    /// 것은 부른 쪽이다(`launch_job`).
    #[cfg_attr(not(test), allow(dead_code))] // 제품은 `begin_human` · `begin_in` 을 바로 부른다(시험 손잡이).
    pub(crate) fn begin_integration(
        &self,
        run_id: &str,
        task_id: &str,
        version: u64,
        by: Reviewer,
        request_id: &str,
    ) -> Result<Value, OrchError> {
        Ok(self.begin_human(run_id, task_id, version, by, request_id)?.0)
    }

    /// [`Self::begin_integration`] + 새로 만든 Job id(있으면 — 부른 쪽이 통합 작업을 돌린다).
    pub(super) fn begin_human(
        &self,
        run_id: &str,
        task_id: &str,
        version: u64,
        by: Reviewer,
        request_id: &str,
    ) -> Result<(Value, Option<String>), OrchError> {
        let lookup = self.run_inputs(run_id);
        let now = self.now();
        let (result, detail, created) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            let (v, detail, created) = begin_in(slot, task_id, version, by, request_id, now, &lookup)?;
            if created.is_some() {
                self.after_change(&g, run_id);
            }
            (v, detail, created)
        };
        if let Some(d) = detail {
            // 수락 규칙 면제(3a · E18 — 옛 `review_waived` 포함) — 사람이 규칙을 넘어 수락을 시작했다(낱말 · 수만).
            if let Some(w) = result["job"]["waived"].as_array().filter(|w| !w.is_empty()) {
                let mut a = d.clone();
                a.waived = Some(w.iter().filter_map(|x| x["rule"].as_str().map(str::to_string)).collect());
                a.unmet = Some(w.iter().filter_map(|x| x["role"].as_str().map(str::to_string)).collect());
                self.audit("accept_waived", run_id, a);
            }
            self.audit("task_integrating", run_id, d);
        }
        // 사람의 수락이 무효화한 검토자(잠금 밖에서 서버 손에).
        self.drain_stops(run_id);
        Ok((result, created))
    }

    /// ②~④ 의 결과를 적는다 — `prepared` → `candidate`(**3단계**의 후보 계산이 `merge-tree` · `commit-tree` 뒤 부른다). 그사이 취소 ·
    /// 중단으로 끝났으면 `invalid-state`(후보는 버린다).
    pub(crate) fn set_candidate(
        &self,
        run_id: &str,
        job_id: &str,
        old: &str,
        candidate: &str,
        candidate_tree: Option<&str>,
    ) -> Result<(), OrchError> {
        if !hex40(old) || !hex40(candidate) || candidate_tree.is_some_and(|t| !hex40(t)) {
            return Err(OrchError::new(reason::INVALID_ARGUMENT, "object ids must be 40 hex"));
        }
        let now = self.now();
        let mut g = self.lock();
        let slot = g.runs.get_mut(run_id).filter(|s| s.run.state != RunState::Orphaned).ok_or_else(not_found_run)?;
        let ji = job_index(&slot.run, job_id)?;
        let job = &mut slot.run.jobs[ji];
        if job.phase != JobPhase::Prepared {
            return Err(OrchError::new(
                reason::INVALID_STATE,
                format!("integration job {job_id} is {} — a candidate is set only once, while prepared", job.phase.as_str()),
            ));
        }
        job.old = Some(old.to_string());
        job.candidate = Some(candidate.to_string());
        job.candidate_tree = candidate_tree.map(str::to_string);
        job.phase = JobPhase::Candidate;
        let task_id = job.task_id.clone();
        slot.run.bump(now, Actor::Server, "integration_candidate", Some(&task_id), job_id);
        self.after_change(&g, run_id);
        Ok(())
    }

    /// ⑥ 올리기(4-3 ⑥) — (잠금 안) 재확인 → `committing` → (잠금 밖) **의도 저장 확인** → ref 트랜잭션 → (잠금 안) 결과. 블로킹(git ·
    /// 디스크). 끝난 Job 의 단계를 돌려준다. 이미 커밋 중이면 `integration-committing`.
    pub(crate) fn commit_job(&self, run_id: &str, job_id: &str) -> Result<JobPhase, OrchError> {
        let git = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        let now = self.now();
        // ⑥-1 잠금 안 — 재확인 → committing(이 순간부터 취소 불가).
        let (repo, tx, wait) = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).filter(|s| s.run.state != RunState::Orphaned).ok_or_else(not_found_run)?;
            let ji = job_index(&slot.run, job_id)?;
            match slot.run.jobs[ji].phase {
                JobPhase::Committing => {
                    return Err(OrchError::new(
                        reason::INTEGRATION_COMMITTING,
                        format!("integration job {job_id} is already being committed"),
                    ))
                }
                p if !p.live() => return Ok(p),
                JobPhase::Candidate | JobPhase::Verifying => {}
                p => {
                    return Err(OrchError::new(
                        reason::INVALID_STATE,
                        format!("integration job {job_id} is {} — it cannot be committed yet", p.as_str()),
                    ))
                }
            }
            let gate = stale_reason(&slot.run, &slot.run.jobs[ji]).or_else(|| super::verify::commit_gate(&slot.run, &slot.run.jobs[ji]));
            if let Some(why) = gate {
                abort_job_in(slot, ji, now, Actor::Server, why);
                let detail = job_audit(slot.run.gen, Actor::Server, &slot.run, &slot.run.jobs[ji], Some(why));
                self.after_change(&g, run_id);
                drop(g);
                self.audit("integration_aborted", run_id, detail);
                return Ok(JobPhase::Aborted);
            }
            let (work_ref, repo) = match &slot.run.integration {
                Some(i) => (i.work_ref.clone(), PathBuf::from(&slot.run.repo)),
                None => return Err(OrchError::new(reason::INVALID_STATE, "this run has no integration ref")),
            };
            let base = refs::base_of(run_id, &work_ref);
            let job = &mut slot.run.jobs[ji];
            job.phase = JobPhase::Committing;
            job.committing_at = Some(now);
            let tx = RefTx {
                work_ref,
                old: job.old.clone().unwrap_or_default(),
                new: job.candidate.clone().unwrap_or_default(),
                done_ref: refs::done(&base, job_id),
                preserve_ref: refs::accepted(&base, &job.task_id),
                report_commit: job.report_commit.clone(),
                preserve_old: None,
                candidate_ref: Some(refs::candidate(&base, job_id)),
            };
            let task_id = job.task_id.clone();
            slot.run.bump(now, Actor::Server, "integration_committing", Some(&task_id), job_id);
            let wait = self.after_change_confirmed(&g, run_id);
            (repo, tx, wait)
        };
        #[cfg(test)]
        if self.crash_at(IntegrateStep::Committing) {
            return Err(OrchError::new(reason::INTERNAL, "simulated crash (test)"));
        }
        // ⑥-2 잠금 밖 — 의도 저장을 기다린다(R3). 실패면 CAS 하지 않는다.
        if let Err(e) = wait.wait() {
            log::line(format!("orchestration — {run_id} integration intent not saved: {e}"));
            return Ok(self.finish_job(run_id, job_id, Verdict::PersistFailed));
        }
        #[cfg(test)]
        if self.crash_at(IntegrateStep::BeforeCas) {
            return Err(OrchError::new(reason::INTERNAL, "simulated crash (test)"));
        }
        // ⑥-3 잠금 밖 — ref 트랜잭션 하나. 보존 ref 가 이미 있으면(재통합) CAS update 로.
        let applied = git
            .read_ref(&repo, &tx.preserve_ref)
            .and_then(|preserve_old| git.apply(&repo, &RefTx { preserve_old, ..tx.clone() }));
        #[cfg(test)]
        if self.crash_at(IntegrateStep::AfterCas) {
            return Err(OrchError::new(reason::INTERNAL, "simulated crash (test)"));
        }
        // ⑥-4 판정 — 성공 줄이 없으면 이유를 문장으로 가르지 않고 ref 를 다시 읽는다.
        let head = |git: &Arc<dyn IntegrationGit>| git.read_ref(&repo, &tx.work_ref);
        let verdict = match applied {
            Ok(TxOutcome::Committed) => match head(&git) {
                Ok(h) => Verdict::Integrated { diverged: h.as_deref() != Some(tx.new.as_str()) },
                Err(_) => Verdict::Integrated { diverged: false },
            },
            other => {
                if let Ok(TxOutcome::Refused(line)) | Err(line) = &other {
                    log::line(format!("orchestration — {run_id} ref transaction not committed: {line}"));
                }
                let job = self
                    .lock()
                    .runs
                    .get(run_id)
                    .and_then(|s| s.run.jobs.iter().find(|j| j.job_id == job_id).cloned());
                match job.map(|j| judge_committed(git.as_ref(), &repo, &refs::base_of(run_id, &tx.work_ref), &j)) {
                    Some(Ok(true)) => Verdict::Integrated {
                        diverged: head(&git).ok().flatten().as_deref() != Some(tx.new.as_str()),
                    },
                    Some(Ok(false)) => match head(&git) {
                        Ok(h) if h.as_deref() != Some(tx.old.as_str()) => Verdict::Moved,
                        Ok(_) if matches!(other, Ok(TxOutcome::Refused(_))) => Verdict::Refused,
                        _ => Verdict::Unknown,
                    },
                    _ => Verdict::Unknown,
                }
            }
        };
        Ok(self.finish_job(run_id, job_id, verdict))
    }

    /// 올리기 결과를 장부에 적는다(잠금 안) — 끝난 Job 의 단계.
    fn finish_job(&self, run_id: &str, job_id: &str, verdict: Verdict) -> JobPhase {
        let now = self.now();
        let (phase, audits, ended, gen) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return JobPhase::Aborted };
            let Ok(ji) = job_index(&slot.run, job_id) else { return JobPhase::Aborted };
            if slot.run.jobs[ji].phase != JobPhase::Committing {
                return slot.run.jobs[ji].phase;
            }
            let mut audits: Vec<(&'static str, OrchestrationAudit)> = Vec::new();
            let held = matches!(
                verdict,
                Verdict::PersistFailed | Verdict::Moved | Verdict::Unknown | Verdict::Integrated { diverged: true }
            );
            match verdict {
                Verdict::Integrated { diverged } => {
                    integrated_in(slot, ji, now, false);
                    let d = job_audit(slot.run.gen, Actor::Server, &slot.run, &slot.run.jobs[ji], None);
                    audits.push(("task_integrated", d));
                    if diverged {
                        set_hold(slot, HoldReason::IntegrationDiverged, Some("after-integration"), now);
                        self.raise(slot, "integration-diverged", None, Some("after-integration"));
                    }
                }
                Verdict::PersistFailed => {
                    abort_job_in(slot, ji, now, Actor::Server, "persist-failed");
                    set_hold(slot, HoldReason::PersistFailed, None, now);
                    self.raise(slot, "persist-failed", None, None);
                }
                Verdict::Moved => {
                    abort_job_in(slot, ji, now, Actor::Server, "moved");
                    set_hold(slot, HoldReason::IntegrationDiverged, Some("moved"), now);
                    self.raise(slot, "integration-diverged", None, Some("moved"));
                }
                Verdict::Refused => abort_job_in(slot, ji, now, Actor::Server, "ref-tx"),
                Verdict::Unknown => {
                    // 결과를 모른다 — 통합됐다고도 안 됐다고도 쓰지 않는다(리뷰 F7). `aborted` 로 확정하면 재시작 복구 대상에서 빠져, ref 는
                    // 섰는데 장부는 미수락인 채로 남는다. `committing` 그대로 두고(재시작 복구가 `done/<job>` 으로 판정) 보류 · 알림 ·
                    // 서버 시계의 재판정([`Orchestration::recheck_unknown_commits`]).
                    if !slot.commit_unknown.iter().any(|j| j == job_id) {
                        slot.commit_unknown.push(job_id.to_string());
                    }
                    if slot.run.hold.is_none() {
                        set_hold(slot, HoldReason::IntegrationDiverged, Some("unknown-result"), now);
                    }
                    self.raise(slot, "integration-diverged", None, Some("unknown-result"));
                }
            }
            let job = slot.run.jobs[ji].clone();
            if job.phase == JobPhase::Aborted {
                let why = job.outcome.as_ref().map(|o| o.reason.clone());
                audits.push(("integration_aborted", job_audit(slot.run.gen, Actor::Server, &slot.run, &job, why.as_deref())));
            }
            if let (true, Some(h)) = (held, &slot.run.hold) {
                audits.push((
                    "run_held",
                    OrchestrationAudit {
                        actor: Actor::Server.as_str().into(),
                        reason: Some(h.reason.as_str().into()),
                        job_id: Some(job.job_id.clone()),
                        ..human_detail(slot.run.gen, slot.run.state)
                    },
                ));
            }
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            let gen = slot.run.gen;
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (job.phase, audits, ended, gen)
        };
        for (event, d) in audits {
            self.audit(event, run_id, d);
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
        phase
    }

    /// **결과를 모르는 올리기의 재판정**(리뷰 F7 — 서버 시계). `committing` 으로 남긴 Job 을 증거 ref `done/<job>` 로 다시 본다: 후보를
    /// 가리키면 통합됨, 없으면(트랜잭션은 전부 서거나 전부 안 선다) `aborted:not-committed`, 또 못 읽으면 그대로 다음 시계에. 블로킹(git) —
    /// 남긴 것이 없으면 아무것도 안 한다.
    pub(crate) fn recheck_unknown_commits(&self) {
        let Some(git) = self.integrator() else { return };
        let todo: Vec<(String, refs::Base, PathBuf, Vec<IntegrationJob>)> = {
            let g = self.lock();
            g.runs
                .values()
                .filter(|s| !s.commit_unknown.is_empty() && s.run.state != RunState::Orphaned)
                .map(|s| {
                    let jobs = s
                        .run
                        .jobs
                        .iter()
                        .filter(|j| j.phase == JobPhase::Committing && s.commit_unknown.contains(&j.job_id))
                        .cloned()
                        .collect();
                    (s.run.id.clone(), run_base(&s.run), PathBuf::from(&s.run.repo), jobs)
                })
                .collect()
        };
        for (run_id, base, repo, jobs) in todo {
            let verdicts: Vec<(String, bool)> = jobs
                .iter()
                .filter_map(|j| match judge_committed(git.as_ref(), &repo, &base, j) {
                    Ok(v) => Some((j.job_id.clone(), v)),
                    Err(e) => {
                        log::line(format!("orchestration — {run_id}: still cannot judge job {}: {e}", j.job_id));
                        None
                    }
                })
                .collect();
            if verdicts.is_empty() {
                continue;
            }
            let now = self.now();
            let (ended, gen) = {
                let mut g = self.lock();
                let Some(slot) = g.runs.get_mut(&run_id) else { continue };
                for (job_id, integrated) in verdicts {
                    slot.commit_unknown.retain(|j| *j != job_id);
                    let Ok(ji) = job_index(&slot.run, &job_id) else { continue };
                    if slot.run.jobs[ji].phase != JobPhase::Committing {
                        continue;
                    }
                    if integrated {
                        integrated_in(slot, ji, now, true);
                    } else {
                        abort_job_in(slot, ji, now, Actor::Server, "not-committed");
                    }
                }
                let ended = settle_stopping(slot, now);
                if ended {
                    self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
                }
                let gen = slot.run.gen;
                if ended {
                    revoke_run(&mut g, &run_id);
                }
                self.after_change(&g, &run_id);
                (ended, gen)
            };
            if ended {
                self.audit(
                    "run_ended",
                    &run_id,
                    OrchestrationAudit {
                        actor: Actor::Server.as_str().into(),
                        ..human_detail(gen, RunState::Stopped)
                    },
                );
            }
        }
    }

    /// 사람 [취소](4-4) — 커밋 단계 전의 Job 을 거둔다(Task 는 `reported` — 수락 안 됨). 커밋 중이면 `integration-committing`(같은 잠금에서
    /// 직렬화), 이미 통합됐으면 `already-integrated`.
    pub(crate) fn cancel_integration(&self, run_id: &str, task_id: &str) -> Result<Value, OrchError> {
        let now = self.now();
        let (result, detail, ended, gen) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            if !slot.run.state.active() {
                return Err(state_error(slot.run.state));
            }
            if slot.run.task(task_id).is_none() {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            }
            let Some(ji) = slot.run.jobs.iter().rposition(|j| j.task_id == task_id && j.phase.live()) else {
                if slot.run.valid_artifact(task_id).is_some_and(|a| a.integration_commit.is_some()) {
                    return Err(OrchError::new(
                        reason::ALREADY_INTEGRATED,
                        format!("task {task_id} is already in the integration ref"),
                    ));
                }
                return Err(OrchError::new(reason::INVALID_STATE, format!("task {task_id} has no integration in progress")));
            };
            let phase = slot.run.jobs[ji].phase;
            if phase == JobPhase::Committing {
                return Err(OrchError::new(
                    reason::INTEGRATION_COMMITTING,
                    "the integration is being committed and can no longer be cancelled — try again in a few seconds",
                ));
            }
            // 검증 중이면 트리를 먼저 끝낸다 — 깃발만 세우고, 종료 확인 뒤 검증 쪽이 `cancelled` 로 거둔다(4-4).
            if phase == JobPhase::Verifying && super::verify::signal_cancel(slot, &slot.run.jobs[ji].job_id.clone(), "cancelled") {
                let mut v = job_view(&slot.run, &slot.run.jobs[ji]);
                if let Some(o) = v.as_object_mut() {
                    o.insert("cancelling".into(), json!(true));
                }
                return Ok(v);
            }
            abort_job_in(slot, ji, now, Actor::Human, "cancelled");
            let job = slot.run.jobs[ji].clone();
            let detail = job_audit(slot.run.gen, Actor::Human, &slot.run, &job, Some("cancelled"));
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            let v = job_view(&slot.run, &job);
            let gen = slot.run.gen;
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (v, detail, ended, gen)
        };
        self.audit("integration_aborted", run_id, detail);
        if ended {
            self.audit("run_ended", run_id, human_detail(gen, RunState::Stopped));
        }
        Ok(result)
    }

    /// 보류 해제(사람) — `persist-failed` · `cleanup-pending` 만. `integration-diverged` 는 [조정](3단계 — 되돌리기 · 받아들이기)으로만
    /// 풀린다. Run 은 여전히 paused — 재개는 사람의 [재개].
    pub(crate) fn release_hold(&self, run_id: &str) -> Result<Value, OrchError> {
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            let Some(h) = slot.run.hold.clone() else {
                return Err(OrchError::new(reason::INVALID_STATE, "the run is not on hold"));
            };
            if h.reason == HoldReason::IntegrationDiverged {
                return Err(OrchError::new(
                    reason::INVALID_STATE,
                    "the integration ref moved — it must be reconciled (revert or accept), not just released",
                ));
            }
            slot.run.hold = None;
            if slot.run.state == RunState::Paused && slot.run.pause_reason.as_deref() == Some("hold") {
                slot.run.pause_reason = Some("human".into());
            }
            let seq = slot.run.bump(now, Actor::Human, "hold_released", None, h.reason.as_str());
            let detail = OrchestrationAudit {
                reason: Some(h.reason.as_str().into()),
                ..human_detail(slot.run.gen, slot.run.state)
            };
            self.after_change(&g, run_id);
            (json!({ "runId": run_id, "state": slot_state(&g, run_id), "latestSeq": seq }), detail)
        };
        self.audit("hold_released", run_id, detail);
        Ok(result)
    }

    /// [Run 완료](사람 — 통합 설계 3-4). 완료 조건을 채웠을 때만 → 조정자 묶음을 풀고(중단 길과 같다) `RunState::Done`. 조정자의 길은
    /// MCP `complete_run`(Q5 — `start.rs` 의 `coordinator_complete`, 같은 몸 [`Self::complete_run_by`]). 통합 ref 가 있으면 끝에 브랜치를 내보낸다(N1 — 실패해도 완료는 선다, 답의 `export`). 그 뒤 서버 임시 자리
    /// 폐기(6-2 — `cleanup.rs`, 답의 `serverTemp{removed, kept, busy}` · `workerWorktrees: "kept"` · 남긴 것은 `cleanup-pending` 알림). 작업자
    /// worktree · 브랜치는 사람 [정리](6-3).
    pub(crate) fn complete_run(&self, run_id: &str) -> Result<Value, OrchError> {
        self.complete_run_by(run_id, Actor::Human, None)
    }

    /// Run 완료의 몸 — 사람([Run 완료]) · 조정자(5단계 MCP `complete_run` — Q5: `coordinator` 는 `(gen, args)` · 같은 잠금 안에서 세대 ·
    /// 분당 한도 · `writable` 을 본다). 답의 `export` 는 늘 `{ok, branch?, head?, reason?, message?}` — **내보내기가 실패해도 Done 은 선다**
    /// (실패면 사람이 보드의 [브랜치로 내보내기]).
    pub(super) fn complete_run_by(&self, run_id: &str, actor: Actor, coordinator: Option<(u32, Option<&Value>)>) -> Result<Value, OrchError> {
        let now = self.now();
        let (result, gen) = {
            let mut g = self.lock();
            let slot = match coordinator {
                Some((gen, args)) => {
                    let slot = super::tools::coordinator_slot(&mut g, run_id, gen, args, now)?;
                    super::store::writable(&slot.run)?;
                    slot
                }
                None => human_slot(&mut g, run_id)?,
            };
            let blockers = completable(slot);
            if !blockers.is_empty() {
                return Err(OrchError::new(
                    reason::NOT_COMPLETABLE,
                    format!("the run cannot be completed yet: {}", blockers.join(", ")),
                ));
            }
            // 남은 `idle` 을 닫는다(4-5 닫는 사건 — 도는 턴은 위 관문이 막았다).
            let idle: Vec<String> = slot.run.attempts.iter().filter(|a| a.state == AttemptState::Idle).map(|a| a.id.clone()).collect();
            for id in idle {
                super::attempts::close_idle(slot, &id, now, actor);
            }
            slot.run.state = RunState::Done;
            slot.run.ended_at = Some(now);
            slot.run.pause_reason = None;
            // 묶음을 푼다(`revoke_run` 이 다시 풀어도 같다) — 그 타일의 늦은 조율은 `run-ended`(`past_coordinators`).
            super::store::unbind_coordinator(slot);
            let seq = slot.run.bump(now, actor, "run_done", None, RunState::Done.as_str());
            self.raise(slot, "run-ended", None, Some(RunState::Done.as_str()));
            let gen = slot.run.gen;
            revoke_run(&mut g, run_id);
            self.after_change(&g, run_id);
            (json!({ "runId": run_id, "state": RunState::Done, "latestSeq": seq }), gen)
        };
        let detail = OrchestrationAudit {
            actor: actor.as_str().into(),
            ..human_detail(gen, RunState::Done)
        };
        self.audit("run_done", run_id, detail);
        // 브랜치 내보내기(N1 — Run 완료 때 자동). 실패해도 완료는 섰다 — 사람이 보드의 [브랜치로 내보내기] 로 다시 한다(Q5 — 결과에 분명히).
        let has_integration = self.lock().runs.get(run_id).is_some_and(|s| s.run.integration.is_some());
        let mut result = result;
        if has_integration {
            let export = match self.export_branch_by(run_id, actor) {
                Ok(v) => json!({ "ok": true, "branch": v.get("branch"), "head": v.get("head") }),
                Err(e) => json!({ "ok": false, "reason": e.code, "message": e.message }),
            };
            // 사람이 켠 자동 병합 — 내보내기 뒤 한 번(`album_merge.rs` · 실패 · 미충족은 Run 칸 · 장부 · 사람 알림 · 재시도 없음). 잠금 밖.
            let auto = self.auto_merge_after_complete(run_id, export["ok"] == true);
            if let Some(o) = result.as_object_mut() {
                o.insert("export".into(), export);
                if let Some(a) = auto {
                    o.insert("autoMerge".into(), a);
                }
            }
        }
        // 서버 임시 자리 폐기(6-2) — 서버 시계가 다시 하지 않게 표시하고 이 자리에서.
        if let Some(s) = self.lock().runs.get_mut(run_id) {
            s.temp_swept = true;
        }
        let swept = self.sweep_temps(run_id);
        if let Some(o) = result.as_object_mut() {
            // (3차 6단계 — 5단계 실기) 칸 이름이 범위를 말한다: **서버 임시 자리**(검증 · 검토 worktree · 검토자 빈 cwd)만 센다. 작업자
            // worktree · 브랜치 · 보존 ref 는 그대로 남고 사람의 [정리]가 지운다(조정자가 "작업 worktree 를 정리했다" 고 잘못 전한 적이 있다).
            o.insert("serverTemp".into(), swept.to_json());
            o.insert("workerWorktrees".into(), json!("kept"));
        }
        Ok(result)
    }

    /// **재시작 복구 판정**(4-4) — orphaned Run 의 끝나지 않은 Job 을 의도 기록과 증거 ref 로 정리한다. `committing` 은 `done/<jobId>` 가
    /// 후보를 가리키면 통합됨(`recovered_integrated`), 아니면 `aborted:crashed`. 그 앞 단계는 `aborted:crashed`. 통합 ref 가 복구된
    /// `expectedHead` 와 다르면 보류 `integration-diverged` 를 표시한다. git 을 읽지 못한 Run 은 건드리지 않는다(다음 시작 때 다시).
    /// 판정을 남긴 Run 파일은 한 번 다시 쓴다. 정리한 Run 수.
    pub(crate) fn recover_jobs(&self) -> usize {
        let Some(git) = self.integrator() else { return 0 };
        let targets: Vec<(String, PathBuf, Integration, Vec<IntegrationJob>)> = {
            let g = self.lock();
            g.runs
                .values()
                .filter(|s| s.run.state == RunState::Orphaned)
                .filter_map(|s| {
                    let integ = s.run.integration.clone()?;
                    let live: Vec<IntegrationJob> = s.run.jobs.iter().filter(|j| j.phase.live()).cloned().collect();
                    Some((s.run.id.clone(), PathBuf::from(&s.run.repo), integ, live))
                })
                .collect()
        };
        let mut n = 0;
        for (run_id, repo, integ, live) in targets {
            // 잠금 밖 — 증거 ref · 통합 머리를 읽는다.
            let mut verdicts: Vec<(String, bool)> = Vec::new();
            let mut unreadable = false;
            for j in &live {
                if j.phase == JobPhase::Committing {
                    match judge_committed(git.as_ref(), &repo, &refs::base_of(&run_id, &integ.work_ref), j) {
                        Ok(v) => verdicts.push((j.job_id.clone(), v)),
                        Err(e) => {
                            log::line(format!("orchestration — {run_id}: could not judge job {} after restart: {e}", j.job_id));
                            unreadable = true;
                        }
                    }
                } else {
                    verdicts.push((j.job_id.clone(), false));
                }
            }
            let head = match git.read_ref(&repo, &integ.work_ref) {
                Ok(h) => h,
                Err(e) => {
                    log::line(format!("orchestration — {run_id}: could not read the integration ref after restart: {e}"));
                    unreadable = true;
                    None
                }
            };
            if unreadable {
                continue;
            }
            // 잠금 안 — 판정을 적는다.
            let now = self.now();
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(&run_id) else { continue };
            for (job_id, integrated) in verdicts {
                let Ok(ji) = job_index(&slot.run, &job_id) else { continue };
                if !slot.run.jobs[ji].phase.live() {
                    continue;
                }
                if integrated {
                    integrated_in(slot, ji, now, true);
                } else {
                    abort_job_in(slot, ji, now, Actor::Server, "crashed");
                }
            }
            // 사람이 [정리]로 지운 통합 ref 의 부재는 기대한 상태다(`head_matches` — E2E 10-16 #10).
            let diverged = !slot.run.integration.as_ref().is_some_and(|i| i.head_matches(head.as_deref()));
            if diverged && slot.run.hold.is_none() {
                set_hold(slot, HoldReason::IntegrationDiverged, Some("recovered"), now);
            }
            if live.is_empty() && !diverged {
                continue;
            }
            n += 1;
            self.save_orphaned(&g, &run_id);
        }
        n
    }
}

fn slot_state(g: &super::store::Inner, run_id: &str) -> Option<RunState> {
    g.runs.get(run_id).map(|s| s.run.state)
}
