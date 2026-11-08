//! 워크트리의 **브랜치** — 새 워크트리가 어느 브랜치를 여나 · 저장소의 브랜치 삭제
//! (docs/log/2026-10-01-worktree-branch-ops.md · docs/log/2026-10-05-worktree-one-to-one.md).
//!
//! **워크트리 = 브랜치 1:1 이 기본이다**(2026-10-05) — 일 하나에 워크트리 하나, 끝나면 병합 → 워크트리와 브랜치를 함께
//! 제거(에이전트 대화 기록이 폴더 단위라서). 10-01 에 있던 슬롯 **"새 브랜치"**(병합된 워크트리에서 같은 폴더에 주 브랜치로부터
//! `switch -c`)는 그때 병합 판정 · 의존성 파일 비교와 함께 **뺐다**(로그 참고). 사람이 셸에서 직접 브랜치를 바꾸는 것은
//! 막지 않는다.
//!
//! ## 새 워크트리의 브랜치 ([`plan_add`] — 로컬 `crate::worktree::add_blocking` · 원격 `crate::remote_worktree::prepare` 가 같은 규칙)
//!
//! | 사람이 친 이름 `N` | 하는 일 |
//! |---|---|
//! | 로컬 브랜치 `refs/heads/N` 이 있다 | `worktree add <폴더> N` — 있는 브랜치를 연다 |
//! | 없고, 원격 추적 `refs/remotes/<원격>/N` 이 **딱 하나** | `worktree add --track -b N <폴더> <원격>/N` — 받아 연다(git 의 추측에 기대지 않는다) |
//! | 원격 추적이 **둘 이상** | 만들지 않고 거절 — 어느 것인지 짐작하지 않는다 |
//! | 둘 다 없다 | `worktree add -b N <폴더> <주 브랜치>` — 주 브랜치에서 새로(주 브랜치를 모르면 시작점 없이) |
//!
//! `git fetch` 는 하지 않는다 — 이미 받아 둔 참조만 본다. 원격 이름에 `/` 가 든 것은 첫 `/` 에서 자른다(드문 꼴 — 한계).
//! 같은 브랜치가 다른 워크트리에 체크아웃돼 있으면 git 이 거절하고 그 한 줄이 그대로 알림으로 간다.
//! 상자의 미리 보기 · 자동 완성 재료([`AddPreview`])는 같은 읽기에서 나오지만 판정의 원본은 실행 때의 [`plan_add`] 다.
//!
//! ## 브랜치 삭제 (독 워크트리 메뉴 "브랜치 삭제…")
//!
//! 어느 워크트리에도 체크아웃되지 않았고 주 브랜치가 아닌 로컬 브랜치 하나를 `branch -d` 로(**`-D` 는 없다**). 저장소
//! 단위라 주 폴더 줄에서도 선다. git 이 거절하면 — 예외 하나(2026-10-05): 실행 순간 내용 기준 판정(`crate::merge_detect`)이
//! squash · rebase 병합이라고 하면 판정한 커밋을 조건으로 `update-ref -d` 한다. 아니면 그 첫 줄을 돌려주고 브랜치는 남는다. 상자가 미리 보는
//! 재료([`BranchChoices`])는 열 때 읽고, 실행 때 **다시 읽어 다시 가른다**.
//!
//! ## 공통
//!
//! - **주 브랜치** = 주 작업 폴더(git 목록의 첫 덩어리)의 브랜치 — 브랜치 그래프와 같은 규칙([`crate::branch_graph::main_of`]).
//! - 로컬은 `git` 을 셸 없이 낱개 인자로(`crate::worktree::run_git`), 원격은 그 호스트에 **이미 붙은 세션**의 전송로로 exec
//!   (원격 제거와 같은 길). 명령 글자는 전부 Rust 가 짓는다(원격 인자는 [`crate::ssh::sh_quote`] · [`crate::ssh::sh_path`]).

use std::path::Path;

use crate::branch_graph::main_of;
use crate::i18n::tr;
use crate::worktree::{
    first_line, git_failure, parse_porcelain, remote_failure_line, remote_git,
    remote_list_command, repo_of, run_git, WorktreeInfo, GIT_TIMEOUT,
};

// ---------------------------------------------------------------------------
// 답의 모양 — 프런트가 읽는다
// ---------------------------------------------------------------------------

/// 브랜치 삭제 상자가 미리 보는 재료.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct BranchChoices {
    /// 지울 수 있는 브랜치 — 어느 워크트리에도 체크아웃되지 않았고 주 브랜치가 아닌 것
    pub deletable: Vec<String>,
}

/// "새 워크트리에서 열기…" 상자의 미리 보기 · 자동 완성 재료 (`$lib/worktree-add`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct AddPreview {
    /// 주 브랜치 — 모르면 `None`
    pub main: Option<String>,
    /// 로컬 브랜치
    pub local: Vec<String>,
    /// 원격 추적 브랜치 `<원격>/<이름>` (`HEAD` 는 뺀다)
    pub remote: Vec<String>,
    /// 어느 워크트리에든 체크아웃된 브랜치
    pub checked_out: Vec<String>,
}

/// 저장소에서 읽은 것 — 워크트리 목록 · 로컬 브랜치 · 원격 추적 브랜치.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Facts {
    pub worktrees: Vec<WorktreeInfo>,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
}

/// 새 워크트리의 브랜치를 어떻게 세우나 — [`plan_add`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AddPlan {
    /// 있는 로컬 브랜치를 연다
    Existing,
    /// 원격 추적 브랜치(`<원격>/<이름>`)를 받아 같은 이름의 로컬 브랜치로 연다
    Track(String),
    /// 새 브랜치 — 시작점(주 브랜치), 모르면 `None`
    New(Option<String>),
}

impl AddPlan {
    /// 이 계획이 로컬 브랜치를 새로 만드나 (곁 파일의 "앱이 만든 브랜치")
    pub(crate) fn creates_branch(&self) -> bool {
        !matches!(self, AddPlan::Existing)
    }
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 유닛 테스트 대상
// ---------------------------------------------------------------------------

/// `for-each-ref --format=%(refname) refs/heads refs/remotes` 의 출력 → `(로컬, 원격 추적)` (**순수 함수**).
/// 원격 추적은 `<원격>/<이름>` 꼴이고 `<원격>/HEAD` 는 버린다. 다른 줄은 버린다.
pub(crate) fn parse_refs(stdout: &str) -> (Vec<String>, Vec<String>) {
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for l in stdout.lines().map(|l| l.trim_end_matches('\r').trim()) {
        if let Some(b) = l.strip_prefix("refs/heads/") {
            if !b.is_empty() {
                local.push(b.to_string());
            }
        } else if let Some(r) = l.strip_prefix("refs/remotes/") {
            if matches!(r.split_once('/'), Some((rem, b)) if !rem.is_empty() && !b.is_empty() && b != "HEAD")
            {
                remote.push(r.to_string());
            }
        }
    }
    (local, remote)
}

/// 목록 · 참조 출력 → [`Facts`] (**순수 함수**).
pub(crate) fn facts_of(list_stdout: &str, refs_stdout: &str) -> Facts {
    let (branches, remotes) = parse_refs(refs_stdout);
    Facts {
        worktrees: parse_porcelain(list_stdout),
        branches,
        remotes,
    }
}

/// 어느 워크트리에든 체크아웃된 브랜치들 (**순수 함수** — `worktree list --porcelain` 의 `branch` 줄).
pub(crate) fn checked_out(worktrees: &[WorktreeInfo]) -> Vec<String> {
    worktrees.iter().filter_map(|w| w.branch.clone()).collect()
}

/// 새 워크트리의 브랜치 판정 (**순수 함수** — 모듈 머리말의 표). `name` 은 이미 이름 검사를 지난 것.
pub(crate) fn plan_add(name: &str, facts: &Facts) -> Result<AddPlan, String> {
    if facts.branches.iter().any(|b| b == name) {
        return Ok(AddPlan::Existing);
    }
    let tracked: Vec<&String> = facts
        .remotes
        .iter()
        .filter(|r| {
            r.split_once('/')
                .is_some_and(|(rem, b)| b == name && !rem.starts_with('-'))
        })
        .collect();
    match tracked.as_slice() {
        [] => Ok(AddPlan::New(
            main_of(&facts.worktrees).filter(|m| !m.is_empty() && !m.starts_with('-')),
        )),
        [one] => Ok(AddPlan::Track((*one).clone())),
        many => Err(tr!(
            ko: "브랜치 {name} 이(가) 여러 원격에 있어({list}) 어느 것을 열지 정할 수 없습니다 — 셸에서 로컬 브랜치를 먼저 만들어 주세요",
            en: "The branch {name} exists on several remotes ({list}), so it is unclear which to open — create the local branch in a shell first",
            name = name,
            list = many.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
        )),
    }
}

/// `worktree add` 의 인자 (**순수 함수**) — 로컬은 셸 없이 이 낱말 그대로 git 에 넘긴다.
pub(crate) fn add_args(dir: &str, name: &str, plan: &AddPlan) -> Vec<String> {
    let mut a: Vec<String> = vec!["worktree".into(), "add".into()];
    match plan {
        AddPlan::Existing => a.extend([dir.to_string(), name.to_string()]),
        AddPlan::Track(r) => a.extend([
            "--track".into(),
            "-b".into(),
            name.to_string(),
            dir.to_string(),
            r.clone(),
        ]),
        AddPlan::New(start) => {
            a.extend(["-b".into(), name.to_string(), dir.to_string()]);
            a.extend(start.clone());
        }
    }
    a
}

/// 상자의 미리 보기 재료 (**순수 함수**).
pub(crate) fn preview_of(facts: &Facts) -> AddPreview {
    AddPreview {
        main: main_of(&facts.worktrees),
        local: facts.branches.clone(),
        remote: facts.remotes.clone(),
        checked_out: checked_out(&facts.worktrees),
    }
}

/// 지울 수 있는 브랜치 (**순수 함수**) — 어느 워크트리에도 체크아웃되지 않았고 주 브랜치가 아닌 것. 순서는 git 의 순서(이름순).
pub(crate) fn deletable(facts: &Facts) -> Vec<String> {
    let busy = checked_out(&facts.worktrees);
    let main = main_of(&facts.worktrees);
    facts
        .branches
        .iter()
        .filter(|b| !busy.contains(b) && main.as_deref() != Some(b.as_str()))
        .cloned()
        .collect()
}

/// 브랜치 삭제의 판정 (**순수 함수**) — 통과하면 그 브랜치 이름(`-d` 의 거절은 git 이 한다).
pub(crate) fn check_delete(facts: &Facts, branch: &str) -> Result<String, String> {
    let b = branch.trim();
    if !deletable(facts).iter().any(|x| x == b) || b.starts_with('-') {
        return Err(tr!(
            ko: "브랜치 {branch} 는 지울 수 없습니다 — 없거나, 주 브랜치이거나, 체크아웃돼 있습니다",
            en: "Cannot delete {branch} — it does not exist, is the main branch, or is checked out",
            branch = b
        ));
    }
    Ok(b.to_string())
}

/// 삭제 상자의 재료를 짓는다 (**순수 함수**).
pub(crate) fn choices_of(facts: &Facts) -> BranchChoices {
    BranchChoices {
        deletable: deletable(facts),
    }
}

// ---------------------------------------------------------------------------
// 원격 명령 글자 (**순수 함수** — 이 글자들만 서버로 나간다)
// ---------------------------------------------------------------------------

/// 제어 글자 없고 비지 않은 글자인가 — 인용 안에서도 개행은 새 명령줄이다.
fn plain(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty() && !t.chars().any(char::is_control)).then_some(t)
}

/// 브랜치 인자 — `-` 로 시작하면 git 이 옵션으로 읽으므로 짓지 않는다.
fn branch_arg(b: &str) -> Option<String> {
    let b = plain(b)?;
    (!b.starts_with('-')).then(|| crate::ssh::sh_quote(b))
}

/// `git -C <저장소> for-each-ref '--format=%(refname)' refs/heads refs/remotes`
pub(crate) fn remote_refs_command(repo: &str) -> Option<String> {
    let r = plain(repo)?;
    Some(format!(
        "git -C {} for-each-ref {} refs/heads refs/remotes",
        crate::ssh::sh_path(r),
        crate::ssh::sh_quote("--format=%(refname)")
    ))
}

/// 원격 `worktree add` 의 꼬리(`worktree add …`) — `dir` 은 이미 [`crate::ssh::sh_path`] 로 인용한 글자, 나머지는 여기서 인용.
pub(crate) fn remote_add_tail(dir_quoted: &str, name: &str, plan: &AddPlan) -> Option<String> {
    let n = branch_arg(name)?;
    Some(match plan {
        AddPlan::Existing => format!("worktree add {dir_quoted} {n}"),
        AddPlan::Track(r) => format!("worktree add --track -b {n} {dir_quoted} {}", branch_arg(r)?),
        AddPlan::New(None) => format!("worktree add -b {n} {dir_quoted}"),
        AddPlan::New(Some(m)) => format!("worktree add -b {n} {dir_quoted} {}", branch_arg(m)?),
    })
}

/// `git -C <저장소> branch -d <브랜치>` — **`-D` 는 없다**(거절 뒤의 확인된 예외는 `crate::merge_detect`).
pub(crate) fn remote_delete_command(repo: &str, branch: &str) -> Option<String> {
    let r = plain(repo)?;
    Some(format!(
        "git -C {} branch -d {}",
        crate::ssh::sh_path(r),
        branch_arg(branch)?
    ))
}

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

/// 목록 · 참조를 읽는다.
pub(crate) fn local_facts(repo: &Path) -> Result<Facts, String> {
    let list = run_git(repo, &["worktree", "list", "--porcelain"], GIT_TIMEOUT)?;
    if !list.ok {
        return Err(first_line(&git_failure(&list)));
    }
    let refs = run_git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
        ],
        GIT_TIMEOUT,
    )?;
    if !refs.ok {
        return Err(first_line(&git_failure(&refs)));
    }
    Ok(facts_of(&list.stdout, &refs.stdout))
}

fn choices_blocking(repo: &Path) -> Result<BranchChoices, String> {
    Ok(choices_of(&local_facts(repo)?))
}

fn preview_blocking(repo: &Path) -> Result<AddPreview, String> {
    Ok(preview_of(&local_facts(repo)?))
}

fn delete_blocking(repo: &Path, branch: &str) -> Result<String, String> {
    let facts = local_facts(repo)?;
    let branch = check_delete(&facts, branch)?;
    let run = run_git(repo, &["branch", "-d", &branch], GIT_TIMEOUT)?;
    if !run.ok {
        // `-d` 는 조상 관계만 본다 — squash · rebase 병합이 지금 다시 확인되면 그 커밋 조건으로 지운다(모듈 머리말).
        if crate::merge_detect::delete_verified_local(repo, &branch)?.is_some() {
            return Ok(branch);
        }
        return Err(first_line(&git_failure(&run)));
    }
    Ok(branch)
}

// ---------------------------------------------------------------------------
// 로컬 명령
// ---------------------------------------------------------------------------

/// 로컬 — 삭제 상자의 재료(지울 수 있는 브랜치).
#[tauri::command]
pub async fn git_worktree_branch_choices(repo: String) -> Result<BranchChoices, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || choices_blocking(&repo)).await
}

/// 로컬 — "새 워크트리에서 열기…" 상자의 미리 보기 · 자동 완성 재료(읽기만).
#[tauri::command]
pub async fn git_worktree_add_preview(repo: String) -> Result<AddPreview, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || preview_blocking(&repo)).await
}

/// 로컬 — 저장소의 브랜치 하나를 `branch -d` 로 지운다(거절이면 확인된 예외를 보고, 아니면 git 의 첫 줄이 `Err`).
#[tauri::command]
pub async fn git_branch_delete(repo: String, branch: String) -> Result<String, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || delete_blocking(&repo, &branch)).await
}

// ---------------------------------------------------------------------------
// 원격 — 붙은 세션의 exec (원격 제거와 같은 길)
// ---------------------------------------------------------------------------

fn bad_repo() -> String {
    tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid")
}

/// exec 하나 — 0 으로 끝나지 않으면 서버가 준 첫 줄.
async fn remote_ok(handle: &crate::ssh::ExecHandle, command: String) -> Result<String, String> {
    let o = remote_git(handle, command).await?;
    if o.exit_code != Some(0) {
        return Err(remote_failure_line(&o.stderr));
    }
    Ok(o.stdout)
}

/// 원격 재료 — 목록 · 참조.
async fn remote_facts(handle: &crate::ssh::ExecHandle, repo: &str) -> Result<Facts, String> {
    let list_cmd = remote_list_command(repo).ok_or_else(bad_repo)?;
    let refs_cmd = remote_refs_command(repo).ok_or_else(bad_repo)?;
    let list = remote_ok(handle, list_cmd).await?;
    let refs = remote_ok(handle, refs_cmd).await?;
    Ok(facts_of(&list, &refs))
}

fn handle_for(id: u32) -> Result<crate::ssh::ExecHandle, String> {
    crate::server::ssh_ops::handle_of(id).ok_or_else(crate::errors::session_gone)
}

/// 원격 — 삭제 상자의 재료.
#[tauri::command]
pub async fn ssh_git_worktree_branch_choices(
    id: u32,
    repo: String,
) -> Result<BranchChoices, String> {
    let handle = handle_for(id)?;
    Ok(choices_of(&remote_facts(&handle, &repo).await?))
}

/// 원격 — 미리 보기 · 자동 완성 재료(이미 붙은 세션으로만 — 이것 때문에 새로 접속하지 않는다).
#[tauri::command]
pub async fn ssh_git_worktree_add_preview(
    id: u32,
    repo: String,
) -> Result<AddPreview, String> {
    let handle = handle_for(id)?;
    Ok(preview_of(&remote_facts(&handle, &repo).await?))
}

/// 원격 — 브랜치 하나를 `branch -d` 로 지운다.
#[tauri::command]
pub async fn ssh_git_branch_delete(
    id: u32,
    repo: String,
    branch: String,
) -> Result<String, String> {
    let handle = handle_for(id)?;
    let facts = remote_facts(&handle, &repo).await?;
    let branch = check_delete(&facts, &branch)?;
    let cmd = remote_delete_command(&repo, &branch).ok_or_else(bad_repo)?;
    if let Err(refused) = remote_ok(&handle, cmd).await {
        // `-d` 가 거절했다 — squash · rebase 병합이 지금 다시 확인되면 그 커밋 조건으로 지운다(모듈 머리말).
        if crate::merge_detect::delete_verified_remote(&handle, &repo, &branch)
            .await?
            .is_some()
        {
            return Ok(branch);
        }
        return Err(refused);
    }
    Ok(branch)
}

#[cfg(test)]
mod tests;
