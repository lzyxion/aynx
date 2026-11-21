//! 세션 서버의 worktree 공통 구현 — 만들기 · 지우기 · 곁 기록. `spawn_worker` · 사람의 [worktree 지우기](`ops.rs`) · [정리](`cleanup.rs`)가 쓴다.
//!
//! 불변식:
//! - **만들기**: Run 의 worktree 자리 **안**만(링크로 밖을 가리키면 거절) · **Git 훅 끔**(`-c core.hooksPath=<빈 폴더>` — post-checkout 이
//!   작업자 권한 모드 전에 서버 권한으로 돌지 않게) · 프로젝트 설정 스크립트는 돌리지 않는다 · 새 브랜치(`-b`)만(있는 브랜치 · 폴더는 거절 —
//!   한 worktree 한 작성자). 곁 파일(`worktrees.json`)에 `run` 칸을 적는다.
//! - **지우기는 보수적**: 곁 파일의 `run` 이 그 Run 인 worktree 만(사람 것 · 다른 Run 것은 `not-run-worktree` — 줄이 아예 없을 때만 사람 [정리]의
//!   [`LedgerClaim`]) · 미커밋 변경이 있으면 거절 · 브랜치 삭제는 병합됐거나 고유 커밋이 없을 때만(아니면 아무것도 안 하고 `branch-has-unmerged`) ·
//!   **지우기 전에 그 안의 정션 · 심볼릭 링크는 링크만 걷는다**([`unlink_links`] — 재귀 삭제가 정션 대상을 지우지 않게, 노트 저장소 사고와
//!   같은 원리) · `--force` 없음. 사람의 [정리]만 [`BranchRule::Lenient`](브랜치를 못 지우면 worktree 만 지운다).
//! - 곁 파일의 쓰기는 `crate::worktree::modify_sidecar` 하나(프로세스 간 파일 잠금 — 쓰기 주인이 하나).

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::spawn::Base;
use super::store::{reason, OrchError};
use crate::worktree as wt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Created {
    pub path: String,
    pub branch: String,
    pub base_commit: String,
}

fn failed(msg: impl Into<String>) -> OrchError {
    OrchError::new(reason::WORKTREE_FAILED, msg)
}

/// `core.hooksPath` 가 가리킬 빈 폴더 — 안에 파일을 두지 않는다.
pub(crate) fn empty_hooks_dir() -> PathBuf {
    let dir = super::persist::store_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("empty-hooks");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn git(repo: &Path, args: &[&str]) -> Result<wt::GitRun, OrchError> {
    wt::run_git(repo, args, wt::GIT_TIMEOUT).map_err(failed)
}

fn resolve_commit(repo: &Path, what: &str) -> Result<String, OrchError> {
    let spec = format!("{what}^{{commit}}");
    let r = git(repo, &["rev-parse", "--verify", "--quiet", &spec])?;
    let oid = r.stdout.trim().to_string();
    if !r.ok || oid.len() < 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(OrchError::new(reason::INVALID_ARGUMENT, format!("{what} is not a commit of this repo")));
    }
    Ok(oid)
}

/// 정한 커밋은 hex 7..40 자만 — 옵션처럼 읽힐 글자를 받지 않는다.
pub(crate) fn base_commit(repo: &Path, base: &Base) -> Result<String, OrchError> {
    match base {
        Base::Main => resolve_commit(repo, "HEAD"),
        Base::Commit(oid) => {
            if !(7..=40).contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(OrchError::new(reason::INVALID_ARGUMENT, "base must be main or a commit id"));
            }
            resolve_commit(repo, oid)
        }
    }
}

/// 있는 가장 긴 조상을 정규화하고(정션 · 심볼릭 링크를 따라간 실제 자리) 아직 없는 나머지 이름을 글자로 붙인다. 상대 경로 · 조상을 하나도
/// 정규화하지 못하면 `None`.
pub(crate) fn real_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = path;
    loop {
        if let Ok(c) = std::fs::canonicalize(cur) {
            let mut out = PathBuf::from(wt::strip_verbatim(&c.to_string_lossy()));
            for part in rest.iter().rev() {
                match part.to_str() {
                    Some(".") => {}
                    Some("..") => {
                        out.pop();
                    }
                    _ => out.push(part),
                }
            }
            return Some(out);
        }
        let name = cur.file_name().map(|n| n.to_os_string()).unwrap_or_else(|| {
            cur.components().next_back().map(|c| c.as_os_str().to_os_string()).unwrap_or_default()
        });
        rest.push(name);
        cur = cur.parent()?;
    }
}

/// worktree 비교 열쇠 — **모든 검사가 같은 것을 쓴다**(사용 중 · 지우기 · 이어 쓰기 · 만들기 예약). 별칭(`…/x/.`)도 같은 열쇠가 된다.
pub(crate) fn wt_key(path: &str) -> String {
    let p = path.trim();
    match real_path(Path::new(p)) {
        Some(r) => wt::comparable(&r.to_string_lossy()),
        None => wt::comparable(p),
    }
}

/// 둘 다 **실제 경로**로 편 뒤 비교한다 — 허용 자리 안의 링크가 밖을 가리키면 거절되게. 실제 경로를 못 구하면 거짓.
pub(crate) fn inside(outer: &Path, inner: &Path) -> bool {
    let (Some(o), Some(i)) = (real_path(outer), real_path(inner)) else {
        return false;
    };
    let o = wt::comparable(&o.to_string_lossy());
    let i = wt::comparable(&i.to_string_lossy());
    i.starts_with(&format!("{o}/"))
}

/// 블로킹(git). 머리말의 "만들기" 규칙.
pub(crate) fn create_blocking(
    repo: &Path,
    worktree_dir: &str,
    name: &str,
    base: &Base,
    run_id: &str,
    sidecar: Option<&Path>,
    hooks_dir: &Path,
) -> Result<Created, OrchError> {
    let name = wt::valid_name(name).map_err(|e| OrchError::new(reason::INVALID_ARGUMENT, e))?.to_string();
    if !repo.join(".git").exists() {
        return Err(OrchError::new(reason::NOT_A_REPO, "the run's repo has no .git"));
    }
    let asked = wt::worktree_path(repo, Some(worktree_dir), &name).map_err(|e| OrchError::new(reason::INVALID_ARGUMENT, e))?;
    let outside = || {
        OrchError::new(
            reason::INVALID_ARGUMENT,
            "the worktree must be inside the run's worktree folder (a link that leads outside it is refused)",
        )
    };
    if !inside(Path::new(worktree_dir), &asked) {
        return Err(outside());
    }
    let path = real_path(&asked).ok_or_else(outside)?;
    let path_s = path.to_string_lossy().into_owned();
    if path.exists() || std::fs::symlink_metadata(&path).is_ok() {
        return Err(failed(format!("{path_s} already exists")));
    }
    let oid = base_commit(repo, base)?;
    let branch_ref = format!("refs/heads/{name}");
    if git(repo, &["show-ref", "--verify", "--quiet", &branch_ref])?.ok {
        return Err(failed(format!("branch {name} already exists")));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| failed(format!("could not create {}: {e}", parent.display())))?;
        // 만든 뒤 한 번 더 — 그사이 조상 자리에 링크가 섰으면 거절.
        if !inside(Path::new(worktree_dir), &path) {
            return Err(outside());
        }
    }
    let hooks = format!("core.hooksPath={}", hooks_dir.to_string_lossy());
    let r = git(repo, &["-c", &hooks, "worktree", "add", "-b", &name, &path_s, &oid])?;
    if !r.ok {
        return Err(failed(wt::first_line(&wt::git_failure(&r))));
    }
    if let Some(side) = sidecar {
        if let Err(e) = wt::record_run_added(side, &path_s, repo, &name, run_id) {
            crate::server::log::line(format!("orchestration — worktrees.json not written: {e}"));
        }
    }
    Ok(Created {
        path: path_s,
        branch: name,
        base_commit: oid,
    })
}

#[derive(Debug, Clone)]
pub(crate) struct Unlinked {
    pub path: PathBuf,
    pub target: Option<PathBuf>,
    pub dir: bool,
}

/// 정션 · 심볼릭 링크를 **링크만** 걷는다 — 링크를 따라 내려가지 않는다. `keep`(worktree 기준 상대 경로 · `/` 구분)은 git 이 추적하는
/// 링크 — git 이 스스로 지운다.
pub(crate) fn unlink_links(root: &Path, keep: &[String]) -> Result<Vec<Unlinked>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for entry in rd.flatten() {
            let p = entry.path();
            let meta = match std::fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let ft = meta.file_type();
            if ft.is_symlink() {
                let rel = p
                    .strip_prefix(root)
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                if keep.iter().any(|k| k == &rel) {
                    continue;
                }
                let target = std::fs::read_link(&p).ok();
                let dir = link_is_dir(&meta);
                remove_link(&p, &meta).map_err(|e| format!("{}: {e}", p.display()))?;
                out.push(Unlinked { path: p, target, dir });
            } else if ft.is_dir() {
                stack.push(p);
            }
        }
    }
    Ok(out)
}

/// 최선 — 되돌리지 못한 경로들을 돌려준다. 정션은 심볼릭 디렉터리 링크로 되살린다(권한이 없으면 실패).
pub(crate) fn relink(links: &[Unlinked]) -> Vec<PathBuf> {
    let mut failed = Vec::new();
    for l in links {
        let Some(t) = &l.target else {
            failed.push(l.path.clone());
            continue;
        };
        if make_link(t, &l.path, l.dir).is_err() {
            failed.push(l.path.clone());
        }
    }
    failed
}

/// 링크 하나 만들기 — **OS 를 타는 곳은 이 함수 하나**.
#[cfg(windows)]
fn make_link(target: &Path, link: &Path, dir: bool) -> std::io::Result<()> {
    if dir {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    }
}

#[cfg(unix)]
fn make_link(target: &Path, link: &Path, _dir: bool) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(windows, unix)))]
fn make_link(_target: &Path, _link: &Path, _dir: bool) -> std::io::Result<()> {
    Err(std::io::Error::other("links are not supported on this OS"))
}

fn tracked_links(worktree: &Path) -> Result<Vec<String>, OrchError> {
    let r = wt::run_git(worktree, &["ls-files", "-s", "-z"], wt::GIT_TIMEOUT).map_err(failed)?;
    if !r.ok {
        return Err(failed(wt::first_line(&wt::git_failure(&r))));
    }
    Ok(r
        .stdout
        .split('\0')
        .filter_map(|e| {
            let (meta, path) = e.split_once('\t')?;
            meta.starts_with("120000 ").then(|| path.to_string())
        })
        .collect())
}

/// 잠긴 worktree 는 `remove` 가 거절한다 — 링크를 걷기 전에 본다.
fn listed_locked(porcelain: &str, want: &str) -> bool {
    porcelain.split("\n\n").any(|block| {
        let mut lines = block.lines().map(|l| l.trim_end_matches('\r'));
        let is_it = lines
            .clone()
            .find_map(|l| l.strip_prefix("worktree "))
            .is_some_and(|p| wt::comparable(&wt::path_key(p)) == want);
        is_it && lines.any(|l| l == "locked" || l.starts_with("locked "))
    })
}

/// 링크가 디렉터리 링크(정션 포함)인가 — **OS 를 타는 곳은 이 함수 하나**.
#[cfg(windows)]
fn link_is_dir(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    meta.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0
}

/// 유닉스 — 링크는 파일처럼 지운다(디렉터리 링크라는 구분이 없다).
#[cfg(not(windows))]
fn link_is_dir(_meta: &std::fs::Metadata) -> bool {
    false
}

fn remove_link(p: &Path, meta: &std::fs::Metadata) -> std::io::Result<()> {
    if link_is_dir(meta) {
        return std::fs::remove_dir(p);
    }
    std::fs::remove_file(p)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Removed {
    pub branch: Option<String>,
    pub branch_deleted: bool,
    /// 사람 [정리]([`BranchRule::Lenient`])가 브랜치를 남긴 까닭.
    pub branch_kept: Option<&'static str>,
    pub unlinked: usize,
}

impl Removed {
    pub(crate) fn to_json(&self, path: &str) -> Value {
        json!({
            "path": path,
            "removed": true,
            "branch": self.branch,
            "branchDeleted": self.branch_deleted,
            "branchKept": self.branch_kept,
            "unlinkedLinks": self.unlinked,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BranchRule<'a> {
    Keep,
    /// 병합이 확인되지 않으면 **아무것도 지우지 않고** 거절(`branch-has-unmerged`).
    Strict,
    /// 사람 [정리] — 못 지우면 worktree 만 지우고 브랜치는 남긴다(정리의 실패가 아니다). `preserved` = 보존 ref `accepted/<task>` 가 지키는 통합된
    /// 보고 커밋 OID — 통합은 squash 라 작업자 브랜치가 통합 ref 의 조상이 될 수 없어, 끝이 이 OID 면 그 OID 조건으로 지운다.
    Lenient { preserved: Option<&'a str> },
}

/// 곁 기록에 그 폴더의 줄이 **아예 없을 때만** 받는 두 번째 소유 근거 — 사람의 [정리](`cleanup_run`)만 넘긴다(부른 쪽이 Run 장부의 Attempt
/// 경로라고 보증한다). 곁 기록에 다른 Run · 사람의 줄이 있으면 거절. 조건: Run 의 worktree 자리 안 · git 목록의 브랜치가 장부의 브랜치와 같음.
pub(crate) struct LedgerClaim<'a> {
    pub worktree_dir: &'a str,
    /// 없으면 장부 근거를 쓰지 않는다.
    pub branch: Option<&'a str>,
}

enum BranchDel {
    Merged,
    Preserved(String),
}

/// 블로킹. 머리말의 "지우기" 규칙. `run_id` 는 곁 파일의 `run` 칸과 같아야 한다.
pub(crate) fn remove_blocking(
    repo: &Path,
    path: &str,
    delete_branch: bool,
    run_id: &str,
    sidecar: Option<&Path>,
) -> Result<Removed, OrchError> {
    let rule = if delete_branch { BranchRule::Strict } else { BranchRule::Keep };
    remove_with(repo, path, rule, run_id, sidecar, None)
}

pub(crate) fn remove_with(
    repo: &Path,
    path: &str,
    rule: BranchRule<'_>,
    run_id: &str,
    sidecar: Option<&Path>,
    ledger: Option<LedgerClaim<'_>>,
) -> Result<Removed, OrchError> {
    let path = path.trim();
    if path.is_empty() || path.starts_with('-') || path.chars().any(char::is_control) || !Path::new(path).is_absolute() {
        return Err(OrchError::new(reason::INVALID_ARGUMENT, "path must be an absolute worktree folder"));
    }
    let key = wt::path_key(path);
    let file = sidecar.map(wt::load_sidecar).unwrap_or_default();
    let not_ours = || {
        OrchError::new(
            reason::NOT_RUN_WORKTREE,
            "only a worktree this run created can be removed here (a person's worktree is removed from the project dock)",
        )
    };
    let by_ledger = match wt::record_for(&file, &key) {
        Some(rec) if rec.run.as_deref() == Some(run_id) => None,
        Some(_) => return Err(not_ours()),
        None => match ledger {
            Some(l) if l.branch.is_some() && inside(Path::new(l.worktree_dir), Path::new(path)) => l.branch,
            _ => return Err(not_ours()),
        },
    };
    let listing = git(repo, &["worktree", "list", "--porcelain"])?;
    if !listing.ok {
        return Err(failed(wt::first_line(&wt::git_failure(&listing))));
    }
    let list = wt::parse_porcelain(&listing.stdout);
    let want = wt::comparable(&key);
    let Some((idx, entry)) = list.iter().enumerate().find(|(_, w)| wt::comparable(&wt::path_key(&w.path)) == want) else {
        return Err(OrchError::new(reason::NOT_FOUND, "that folder is not a worktree of the run's repo"));
    };
    if idx == 0 {
        return Err(OrchError::new(reason::NOT_RUN_WORKTREE, "the main working folder is never removed"));
    }
    if by_ledger.is_some() && entry.branch.as_deref() != by_ledger {
        return Err(not_ours());
    }
    let branch = entry.branch.clone();
    let current = list.first().and_then(|w| w.branch.clone());
    let status = wt::run_git(Path::new(path), &["status", "--porcelain"], wt::GIT_TIMEOUT).map_err(failed)?;
    if !status.ok {
        return Err(failed(wt::first_line(&wt::git_failure(&status))));
    }
    if !status.stdout.trim().is_empty() {
        return Err(OrchError::new(
            reason::WORKTREE_DIRTY,
            "the worktree has uncommitted changes — commit or discard them first",
        ));
    }
    let mut branch_kept: Option<&'static str> = None;
    let mut plan: Option<BranchDel> = None;
    if let (true, Some(b)) = (rule != BranchRule::Keep, branch.as_deref()) {
        let checked_out = current.as_deref() == Some(b);
        if !checked_out {
            let unique = match current.as_deref() {
                Some(main) => {
                    let range = format!("refs/heads/{main}..refs/heads/{b}");
                    let r = git(repo, &["rev-list", "--count", &range])?;
                    r.stdout.trim().parse::<u64>().ok().filter(|_| r.ok)
                }
                None => None,
            };
            if unique == Some(0) || crate::worktree_changes::branch_merged_blocking(repo, b, current.as_deref()) {
                plan = Some(BranchDel::Merged);
            } else if let BranchRule::Lenient { preserved: Some(p) } = rule {
                let tip = git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{b}^{{commit}}")])?;
                if tip.ok && tip.stdout.trim() == p {
                    plan = Some(BranchDel::Preserved(p.to_string()));
                }
            }
        }
        if plan.is_none() {
            if rule == BranchRule::Strict {
                return Err(OrchError::new(
                    reason::BRANCH_HAS_UNMERGED,
                    format!("branch {b} has commits that are not merged — keep the branch (deleteBranch: false) or merge it first"),
                ));
            }
            branch_kept = Some(if checked_out { "checked-out" } else { "unmerged" });
        }
    }
    // 바뀌기 전에 실패할 수 있는 것을 모두 본다 — 실패해도 바뀐 것이 남지 않는 순서.
    if listed_locked(&listing.stdout, &want) {
        return Err(failed("the worktree is locked (git worktree unlock first)"));
    }
    let keep = tracked_links(Path::new(path))?;
    // 추적되는 링크는 걷지 않는다 — 먼저 걷으면 git 이 "삭제됨" 변경으로 보고 거절한다.
    let unlinked = unlink_links(Path::new(path), &keep).map_err(failed)?;
    let r = match git(repo, &["worktree", "remove", path]) {
        Ok(r) => r,
        Err(e) => {
            let _ = relink(&unlinked);
            return Err(e);
        }
    };
    if !r.ok {
        // `--force` 로 덮지 않는다.
        let left = relink(&unlinked);
        let mut msg = wt::first_line(&wt::git_failure(&r));
        if !left.is_empty() {
            let names: Vec<String> = left.iter().map(|p| p.display().to_string()).collect();
            msg = format!("{msg} — these links were removed and could not be restored: {}", names.join(", "));
        }
        return Err(failed(msg));
    }
    let unlinked = unlinked.len();
    let mut branch_deleted = false;
    if let (Some(how), Some(b)) = (plan, branch.as_deref()) {
        if !b.starts_with('-') {
            branch_deleted = match how {
                BranchDel::Merged => {
                    let d = git(repo, &["branch", "-d", b])?;
                    d.ok || crate::merge_detect::delete_verified_local(repo, b).map_err(failed)?.is_some()
                }
                // `branch -D` 가 아니다 — 그사이 끝이 움직였으면 지우지 않는다.
                BranchDel::Preserved(oid) => {
                    let d = git(repo, &["update-ref", "-d", &format!("refs/heads/{b}"), &oid])?;
                    if d.ok {
                        let _ = git(repo, &["config", "--remove-section", &format!("branch.{b}")]);
                    }
                    d.ok
                }
            };
            if !branch_deleted {
                branch_kept = Some("delete-failed");
            }
        }
    }
    if let Some(side) = sidecar {
        if let Err(e) = wt::forget_path(side, &key) {
            crate::server::log::line(format!("orchestration — worktrees.json not written: {e}"));
        }
    }
    Ok(Removed {
        branch,
        branch_deleted,
        branch_kept,
        unlinked,
    })
}
