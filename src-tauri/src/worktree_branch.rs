//! 워크트리의 브랜치 — 새 워크트리가 어느 브랜치를 여나 · 저장소의 브랜치 삭제.
//!
//! - 새 워크트리의 브랜치는 로컬 · 원격이 같은 [`plan_add`] 를 탄다. 원격 추적이 둘 이상이면 짐작하지 않고 거절한다.
//!   `git fetch` 는 하지 않는다 — 받아 둔 참조만 본다. 원격 이름에 `/` 가 든 것은 첫 `/` 에서 자른다(알고 받은 한계).
//! - 브랜치 삭제는 `branch -d` 뿐 — `-D` 는 없다. 예외 하나: 실행 순간 `crate::merge_detect` 가 squash · rebase 병합을 확인하면
//!   그 커밋을 조건으로 지운다. 상자의 재료는 열 때 읽고, 실행 때 다시 읽어 다시 가른다.
//! - 명령 글자는 전부 Rust 가 짓는다 — 로컬은 셸 없는 낱개 인자, 원격은 이미 붙은 세션의 exec(인자는 `sh_quote` · `sh_path`).

use std::path::Path;

use crate::branch_graph::main_of;
use crate::i18n::tr;
use crate::worktree::{
    first_line, git_failure, parse_porcelain, remote_failure_line, remote_git,
    remote_list_command, repo_of, run_git, WorktreeInfo, GIT_TIMEOUT,
};

// ── 답의 모양 — 프런트가 읽는다 ──

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct BranchChoices {
    pub deletable: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct AddPreview {
    pub main: Option<String>,
    pub local: Vec<String>,
    /// `<원격>/<이름>` (`HEAD` 는 뺀다)
    pub remote: Vec<String>,
    pub checked_out: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Facts {
    pub worktrees: Vec<WorktreeInfo>,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AddPlan {
    Existing,
    /// 원격 추적 브랜치(`<원격>/<이름>`)를 받아 같은 이름의 로컬 브랜치로 연다
    Track(String),
    /// 시작점(주 브랜치) — 모르면 `None`
    New(Option<String>),
}

impl AddPlan {
    /// 곁 파일의 "앱이 만든 브랜치"
    pub(crate) fn creates_branch(&self) -> bool {
        !matches!(self, AddPlan::Existing)
    }
}

// ── 순수 규칙 ──

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

pub(crate) fn facts_of(list_stdout: &str, refs_stdout: &str) -> Facts {
    let (branches, remotes) = parse_refs(refs_stdout);
    Facts {
        worktrees: parse_porcelain(list_stdout),
        branches,
        remotes,
    }
}

pub(crate) fn checked_out(worktrees: &[WorktreeInfo]) -> Vec<String> {
    worktrees.iter().filter_map(|w| w.branch.clone()).collect()
}

/// `name` 은 이미 이름 검사를 지난 것.
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

pub(crate) fn preview_of(facts: &Facts) -> AddPreview {
    AddPreview {
        main: main_of(&facts.worktrees),
        local: facts.branches.clone(),
        remote: facts.remotes.clone(),
        checked_out: checked_out(&facts.worktrees),
    }
}

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

pub(crate) fn choices_of(facts: &Facts) -> BranchChoices {
    BranchChoices {
        deletable: deletable(facts),
    }
}

// ── 원격 명령 글자 — 이 글자들만 서버로 나간다 ──

/// 제어 글자를 거절한다 — 인용 안에서도 개행은 새 명령줄이다.
fn plain(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty() && !t.chars().any(char::is_control)).then_some(t)
}

/// `-` 로 시작하면 git 이 옵션으로 읽으므로 짓지 않는다.
fn branch_arg(b: &str) -> Option<String> {
    let b = plain(b)?;
    (!b.starts_with('-')).then(|| crate::ssh::sh_quote(b))
}

pub(crate) fn remote_refs_command(repo: &str) -> Option<String> {
    let r = plain(repo)?;
    Some(format!(
        "git -C {} for-each-ref {} refs/heads refs/remotes",
        crate::ssh::sh_path(r),
        crate::ssh::sh_quote("--format=%(refname)")
    ))
}

/// `dir_quoted` 는 이미 [`crate::ssh::sh_path`] 로 인용한 글자다.
pub(crate) fn remote_add_tail(dir_quoted: &str, name: &str, plan: &AddPlan) -> Option<String> {
    let n = branch_arg(name)?;
    Some(match plan {
        AddPlan::Existing => format!("worktree add {dir_quoted} {n}"),
        AddPlan::Track(r) => format!("worktree add --track -b {n} {dir_quoted} {}", branch_arg(r)?),
        AddPlan::New(None) => format!("worktree add -b {n} {dir_quoted}"),
        AddPlan::New(Some(m)) => format!("worktree add -b {n} {dir_quoted} {}", branch_arg(m)?),
    })
}

/// `-D` 는 없다(거절 뒤의 확인된 예외는 `crate::merge_detect`).
pub(crate) fn remote_delete_command(repo: &str, branch: &str) -> Option<String> {
    let r = plain(repo)?;
    Some(format!(
        "git -C {} branch -d {}",
        crate::ssh::sh_path(r),
        branch_arg(branch)?
    ))
}

// ── 로컬 ──

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
        // `-d` 는 조상 관계만 본다 — squash · rebase 병합이 지금 다시 확인되면 그 커밋 조건으로 지운다.
        if crate::merge_detect::delete_verified_local(repo, &branch)?.is_some() {
            return Ok(branch);
        }
        return Err(first_line(&git_failure(&run)));
    }
    Ok(branch)
}

// ── 로컬 명령 ──

#[tauri::command]
pub async fn git_worktree_branch_choices(repo: String) -> Result<BranchChoices, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || choices_blocking(&repo)).await
}

#[tauri::command]
pub async fn git_worktree_add_preview(repo: String) -> Result<AddPreview, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || preview_blocking(&repo)).await
}

#[tauri::command]
pub async fn git_branch_delete(repo: String, branch: String) -> Result<String, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || delete_blocking(&repo, &branch)).await
}

// ── 원격 — 붙은 세션의 exec ──

fn bad_repo() -> String {
    tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid")
}

async fn remote_ok(handle: &crate::ssh::ExecHandle, command: String) -> Result<String, String> {
    let o = remote_git(handle, command).await?;
    if o.exit_code != Some(0) {
        return Err(remote_failure_line(&o.stderr));
    }
    Ok(o.stdout)
}

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

#[tauri::command]
pub async fn ssh_git_worktree_branch_choices(
    id: u32,
    repo: String,
) -> Result<BranchChoices, String> {
    let handle = handle_for(id)?;
    Ok(choices_of(&remote_facts(&handle, &repo).await?))
}

/// 이미 붙은 세션으로만 — 이것 때문에 새로 접속하지 않는다.
#[tauri::command]
pub async fn ssh_git_worktree_add_preview(
    id: u32,
    repo: String,
) -> Result<AddPreview, String> {
    let handle = handle_for(id)?;
    Ok(preview_of(&remote_facts(&handle, &repo).await?))
}

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
        // `-d` 가 거절했다 — squash · rebase 병합이 지금 다시 확인되면 그 커밋 조건으로 지운다.
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
