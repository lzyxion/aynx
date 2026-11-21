//! 저장소 상태 · 초기화 · 새 프로젝트 폴더 (docs/log/2026-09-28-project-create.md).
//!
//! 커밋 없는 저장소에서 워크트리를 만들면 git 이 main 과 히스토리를 나누지 않는 고아 브랜치를 만든다 — 그래서 빈 첫 커밋을 둔다.
//!
//! - 판정은 git 의 오류 **문구**로 가르지 않는다(로케일마다 다르다). `.git` 이 있는데 git 이 거절하면(`safe.directory` 등)
//!   `notRepo` 가 아니라 `error` 다 — 초기화를 권하면 안 된다.
//! - 빈 첫 커밋은 `git commit --allow-empty` 로 만들지 않는다 — 인덱스를 커밋해 사람이 `git add` 해 둔 파일이 들어간다.
//!   `mktree` → `commit-tree` → `update-ref HEAD <커밋> ""`(그사이 누가 커밋했으면 덮지 않고 실패) · 인덱스 · 작업 폴더는 손대지 않는다.
//! - 신원이 없으면 `[git-identity]` 로 실패한다 — 앱이 대신 설정하거나 임시 신원으로 커밋하지 않는다.
//! - 원격은 이미 붙은 SSH 세션의 exec 왕복 하나 — 명령 글자는 여기서 짓고 프런트는 경로 · 이름만 넘긴다. 로그인 셸이 fish 여도
//!   돌게 `sh -c '<…>'` 에 싣는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::worktree::{
    blocking, comparable, first_line, git_failure, parse_porcelain, run_git_env, strip_verbatim,
    GitRun, GIT_TIMEOUT,
};

const REMOTE_TIMEOUT: Duration = Duration::from_secs(15);

/// 사용자 저장소에 남는 글자라 번역하지 않는다. 원격 `REMOTE_ENSURE` 의 `-m` 글자와 같다.
const INITIAL_COMMIT_MESSAGE: &str = "Initial commit";

/// 프런트 `src/lib/repo-status.ts` 의 `RepoStatus` 와 1:1.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepoStatus {
    /// `worktrees` 는 주 폴더 포함 — 못 읽으면 없음
    Ok {
        branch: Option<String>,
        worktrees: Option<u32>,
    },
    /// 그 폴더와 조상 어디에도 `.git` 이 없다
    NotRepo,
    Subfolder { root: String },
    NoCommit { branch: Option<String> },
    Missing,
    /// git 이 없다 · `.git` 은 있는데 git 이 거절한다(소유자 등)
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RepoInitialized {
    pub branch: String,
    pub initialized: bool,
    pub committed: bool,
}

/// `path` 가 프로젝트 경로로 저장될 글자다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ProjectCreated {
    pub path: String,
    pub branch: String,
}

// ---------------------------------------------------------------------------
// 순수 규칙
// ---------------------------------------------------------------------------

/// Windows 가 장치로 읽는 이름 — 확장자가 붙어도(`nul.txt`) 같다. 프런트 `repo-status.ts` 와 같은 표.
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// 원격에서도 Windows 규칙을 쓴다(나중에 Windows 로 옮겨져도 깨지지 않게). 프런트 `projectFolderNameProblem` 과 **같은 표**다.
pub(crate) fn valid_folder_name(name: &str) -> Result<&str, String> {
    let bad = || {
        Err(tr!(
            ko: "새 폴더 이름은 영문·숫자·. _ - 만 쓸 수 있고 - 로 시작하거나 . 으로 끝날 수 없습니다",
            en: "A new folder name may only use letters, digits and . _ -, and may not start with - or end with ."
        ))
    };
    let n = name.trim();
    if n.contains('/') {
        return bad();
    }
    let n = crate::worktree::valid_name(n).or_else(|_| bad())?;
    if n.ends_with('.') {
        return bad();
    }
    let stem = n.split('.').next().unwrap_or(n).to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return bad();
    }
    Ok(n)
}

/// `-` 로 시작하는 값은 옵션으로 읽히므로 버린다.
pub(crate) fn default_branch_of(config_stdout: &str, ok: bool) -> String {
    let b = config_stdout.trim();
    if !ok
        || b.is_empty()
        || b.starts_with('-')
        || b.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        "main".to_string()
    } else {
        b.to_string()
    }
}

/// `~` 꼴은 펴지 않는다 — 프로젝트는 사람이 적은 꼴(`~/src/api`)로 저장된다.
pub(crate) fn remote_join(parent: &str, name: &str) -> String {
    let p = parent.trim();
    let base = p.trim_end_matches('/');
    if base.is_empty() && p.starts_with('/') {
        format!("/{name}")
    } else {
        format!("{base}/{name}")
    }
}

pub(crate) fn tilde_form(path: &str, home: Option<&str>) -> String {
    match home
        .map(|h| h.trim_end_matches('/'))
        .filter(|h| !h.is_empty())
    {
        Some(h) if path == h => "~".to_string(),
        Some(h) => match path.strip_prefix(h).and_then(|r| r.strip_prefix('/')) {
            Some(rest) => format!("~/{rest}"),
            None => path.to_string(),
        },
        None => path.to_string(),
    }
}

/// 같은 키는 앞의 것이 이긴다. 로그인 스크립트의 잡음 줄(모르는 키)은 부르는 쪽이 무시한다.
pub(crate) fn parse_kv(stdout: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for raw in stdout.lines() {
        let line = raw.trim_end_matches('\r');
        if let Some((k, v)) = line.split_once('=') {
            if !k.is_empty() && !out.iter().any(|(ok, _)| ok == k) {
                out.push((k.to_string(), v.to_string()));
            }
        }
    }
    out
}

fn kv<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

pub(crate) fn parse_remote_status(stdout: &str, stderr: &str) -> RepoStatus {
    let pairs = parse_kv(stdout);
    let branch = kv(&pairs, "branch")
        .map(str::to_string)
        .filter(|b| !b.is_empty());
    match kv(&pairs, "kind") {
        Some("ok") => RepoStatus::Ok {
            branch,
            worktrees: kv(&pairs, "worktrees").and_then(|w| w.trim().parse().ok()),
        },
        Some("notrepo") => RepoStatus::NotRepo,
        Some("missing") => RepoStatus::Missing,
        Some("nocommit") => RepoStatus::NoCommit { branch },
        Some("subfolder") => match kv(&pairs, "root").filter(|r| r.starts_with('/')) {
            Some(root) => RepoStatus::Subfolder {
                root: tilde_form(root, kv(&pairs, "home")),
            },
            None => RepoStatus::Error {
                message: remote_line(stderr),
            },
        },
        Some("nogit") => RepoStatus::Error {
            message: tr!(ko: "원격에 git 이 없습니다", en: "git is not installed on the remote"),
        },
        Some("error") => RepoStatus::Error {
            message: kv(&pairs, "message")
                .map(str::to_string)
                .filter(|m| !m.trim().is_empty())
                .unwrap_or_else(|| remote_line(stderr)),
        },
        _ => RepoStatus::Error {
            message: remote_line(stderr),
        },
    }
}

fn remote_line(stderr: &str) -> String {
    crate::worktree::remote_failure_line(stderr)
}

fn wrap_sh(script: &str) -> String {
    format!("sh -c {}", crate::ssh::sh_quote(script))
}

pub(crate) fn remote_status_command(path: &str) -> Option<String> {
    let p = path.trim();
    if p.is_empty() || p.chars().any(char::is_control) {
        return None;
    }
    let dir = crate::ssh::sh_path(p);
    let script = format!(
        r#"cd -- {dir} 2>/dev/null || {{ echo kind=missing; exit 0; }}
command -v git >/dev/null 2>&1 || {{ echo kind=nogit; exit 0; }}
here=$(pwd -P)
b=$(git symbolic-ref --short -q HEAD 2>/dev/null) && printf 'branch=%s\n' "$b"
if ! top=$(git rev-parse --show-toplevel 2>/dev/null); then
  d=$here
  while :; do
    if [ -e "$d/.git" ]; then echo kind=error; printf 'message=%s\n' "$(git rev-parse --show-toplevel 2>&1 | head -n 1)"; exit 0; fi
    [ "$d" = / ] && break
    d=$(dirname -- "$d")
  done
  echo kind=notrepo; exit 0
fi
if [ "$top" != "$here" ]; then echo kind=subfolder; printf 'root=%s\nhome=%s\n' "$top" "$HOME"; exit 0; fi
git rev-parse --verify --quiet HEAD >/dev/null || {{ echo kind=nocommit; exit 0; }}
echo kind=ok
printf 'worktrees=%s\n' "$(git worktree list --porcelain 2>/dev/null | grep -c '^worktree ')"
"#
    );
    Some(wrap_sh(&script))
}

/// [`ensure_repo_blocking`] 과 같은 일을 해야 한다.
const REMOTE_ENSURE: &str = r#"command -v git >/dev/null 2>&1 || { echo aynx-fail=nogit; exit 1; }
here=$(pwd -P)
inited=0
if [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$here" ]; then
  b=$(git config --get init.defaultBranch 2>/dev/null)
  case "$b" in ''|-*|*' '*) b=main ;; esac
  if ! git init -q -b "$b" 2>/dev/null; then
    git init -q || { echo aynx-fail=init; exit 1; }
    git symbolic-ref HEAD "refs/heads/$b" || { echo aynx-fail=init; exit 1; }
  fi
  inited=1
fi
committed=0
if ! git rev-parse --verify --quiet HEAD >/dev/null; then
  { git var GIT_AUTHOR_IDENT && git var GIT_COMMITTER_IDENT; } >/dev/null 2>&1 || { echo aynx-fail=identity; exit 1; }
  t=$(git mktree </dev/null) || { echo aynx-fail=commit; exit 1; }
  c=$(git commit-tree "$t" -m 'Initial commit') || { echo aynx-fail=commit; exit 1; }
  git update-ref HEAD "$c" "" || { echo aynx-fail=commit; exit 1; }
  committed=1
fi
printf 'branch=%s\ninitialized=%s\ncommitted=%s\n' "$(git symbolic-ref --short -q HEAD)" "$inited" "$committed"
"#;

pub(crate) fn remote_ensure_command(path: &str) -> Option<String> {
    let p = path.trim();
    if p.is_empty() || p.chars().any(char::is_control) {
        return None;
    }
    let dir = crate::ssh::sh_path(p);
    Some(wrap_sh(&format!(
        "cd -- {dir} 2>/dev/null || {{ echo aynx-fail=missing; exit 1; }}\n{REMOTE_ENSURE}"
    )))
}

/// 폴더가 있으면 비었거나 `.git` 하나뿐이어야 한다 — 첫 커밋이 실패한 뒤 다시 누르는 자리.
pub(crate) fn remote_create_command(parent: &str, name: &str) -> Option<String> {
    let parent = parent.trim();
    if parent.chars().any(char::is_control) || !crate::worktree::is_absolute_dir(parent, true) {
        return None;
    }
    let name = valid_folder_name(name).ok()?;
    let par = crate::ssh::sh_path(parent);
    let n = crate::ssh::sh_quote(name);
    Some(wrap_sh(&format!(
        r#"cd -- {par} 2>/dev/null || {{ echo aynx-fail=noparent; exit 1; }}
if [ -e {n} ]; then
  [ -d {n} ] || {{ echo aynx-fail=notdir; exit 1; }}
  case "$(ls -A -- {n})" in ''|.git) ;; *) echo aynx-fail=notempty; exit 1 ;; esac
else
  mkdir -- {n} || {{ echo aynx-fail=mkdir; exit 1; }}
fi
cd -- {n} || {{ echo aynx-fail=mkdir; exit 1; }}
{REMOTE_ENSURE}"#
    )))
}

pub(crate) fn parse_remote_ensure(
    stdout: &str,
    stderr: &str,
    exit_ok: bool,
    shown: &str,
) -> Result<RepoInitialized, String> {
    let pairs = parse_kv(stdout);
    if let Some(step) = kv(&pairs, "aynx-fail") {
        return Err(step_failure(step, &remote_line(stderr), shown));
    }
    if !exit_ok {
        return Err(remote_line(stderr));
    }
    Ok(RepoInitialized {
        branch: kv(&pairs, "branch").unwrap_or("").to_string(),
        initialized: kv(&pairs, "initialized") == Some("1"),
        committed: kv(&pairs, "committed") == Some("1"),
    })
}

fn step_failure(step: &str, line: &str, shown: &str) -> String {
    match step {
        "missing" => tr!(ko: "폴더가 없습니다: {shown}", en: "The folder does not exist: {shown}"),
        "noparent" => tr!(
            ko: "만들 자리가 없습니다: {shown}",
            en: "The parent folder does not exist: {shown}"
        ),
        "notdir" => tr!(
            ko: "같은 이름의 파일이 이미 있습니다: {shown}",
            en: "A file with that name already exists: {shown}"
        ),
        "notempty" => tr!(
            ko: "폴더가 이미 있고 비어 있지 않습니다: {shown} — 기존 폴더로 추가하세요",
            en: "The folder already exists and is not empty: {shown} — add it as an existing folder"
        ),
        "mkdir" => tr!(
            ko: "폴더를 만들지 못했습니다: {shown} ({line})",
            en: "Could not create the folder: {shown} ({line})"
        ),
        "nogit" => git_missing_line(),
        "identity" => crate::errors::git_identity_missing(),
        "init" => tr!(
            ko: "git 저장소로 초기화하지 못했습니다: {line}",
            en: "Could not initialize a git repository: {line}"
        ),
        _ => tr!(
            ko: "저장소는 만들었지만 첫 커밋을 만들지 못했습니다: {line}",
            en: "The repository was created but the first commit failed: {line}"
        ),
    }
}

fn git_missing_line() -> String {
    tr!(
        ko: "git 을 찾을 수 없습니다 — git 을 설치하고 PATH 에 두어야 합니다",
        en: "Could not find git — install git and put it on PATH"
    )
}

// ---------------------------------------------------------------------------
// 로컬 — 블로킹 몸통
// ---------------------------------------------------------------------------

type Env<'a> = &'a [(&'a str, &'a str)];

fn git(dir: &Path, args: &[&str], env: Env) -> Result<GitRun, String> {
    run_git_env(dir, args, GIT_TIMEOUT, env)
}

/// `canonicalize` 는 짧은 이름 · 심볼릭 링크를 편다.
fn real_key(path: &Path) -> String {
    let s = std::fs::canonicalize(path)
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned());
    comparable(&s)
}

fn real_shown(path: &Path) -> String {
    std::fs::canonicalize(path)
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

fn has_git_ancestor(dir: &Path) -> bool {
    let start = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    start.ancestors().any(|d| d.join(".git").exists())
}

fn is_repo_root(dir: &Path, env: Env) -> Result<Option<String>, String> {
    let top = git(dir, &["rev-parse", "--show-toplevel"], env)?;
    if !top.ok {
        return Ok(None);
    }
    Ok(Some(top.stdout.trim().to_string()))
}

fn head_branch(dir: &Path, env: Env) -> Option<String> {
    git(dir, &["symbolic-ref", "--short", "-q", "HEAD"], env)
        .ok()
        .filter(|r| r.ok)
        .map(|r| r.stdout.trim().to_string())
        .filter(|b| !b.is_empty())
}

fn has_head(dir: &Path, env: Env) -> Result<bool, String> {
    Ok(git(dir, &["rev-parse", "--verify", "--quiet", "HEAD"], env)?.ok)
}

pub(crate) fn status_blocking(path: &str, env: Env) -> RepoStatus {
    let dir = PathBuf::from(path.trim());
    if path.trim().is_empty() || !dir.is_dir() {
        return RepoStatus::Missing;
    }
    let top = match is_repo_root(&dir, env) {
        Err(e) => return RepoStatus::Error { message: e },
        Ok(t) => t,
    };
    let Some(top) = top else {
        if has_git_ancestor(&dir) {
            // `.git` 은 있는데 git 이 거절한다 — 초기화를 권하면 안 된다
            let msg = git(&dir, &["rev-parse", "--show-toplevel"], env)
                .map(|r| first_line(&git_failure(&r)))
                .unwrap_or_else(|e| e);
            return RepoStatus::Error { message: msg };
        }
        return RepoStatus::NotRepo;
    };
    if real_key(Path::new(&top)) != real_key(&dir) {
        return RepoStatus::Subfolder {
            root: real_shown(Path::new(&top)),
        };
    }
    let branch = head_branch(&dir, env);
    match has_head(&dir, env) {
        Err(e) => return RepoStatus::Error { message: e },
        Ok(false) => return RepoStatus::NoCommit { branch },
        Ok(true) => {}
    }
    let worktrees = git(&dir, &["worktree", "list", "--porcelain"], env)
        .ok()
        .filter(|r| r.ok)
        .map(|r| {
            parse_porcelain(&r.stdout)
                .iter()
                .filter(|w| !w.bare)
                .count() as u32
        });
    RepoStatus::Ok { branch, worktrees }
}

pub(crate) fn ensure_repo_blocking(path: &str, env: Env) -> Result<RepoInitialized, String> {
    let dir = PathBuf::from(path.trim());
    if path.trim().is_empty() || !dir.is_dir() {
        return Err(step_failure("missing", "", path.trim()));
    }
    let mut initialized = false;
    let is_root = matches!(is_repo_root(&dir, env)?, Some(top) if real_key(Path::new(&top)) == real_key(&dir));
    if !is_root {
        let cfg = git(&dir, &["config", "--get", "init.defaultBranch"], env)?;
        let branch = default_branch_of(&cfg.stdout, cfg.ok);
        let with_b = git(&dir, &["init", "-q", "-b", &branch], env)?;
        if !with_b.ok {
            // `-b` 를 모르는 구 git(2.28 이전)
            let plain = git(&dir, &["init", "-q"], env)?;
            if !plain.ok {
                return Err(step_failure(
                    "init",
                    &first_line(&git_failure(&plain)),
                    path,
                ));
            }
            let head_ref = format!("refs/heads/{branch}");
            let sr = git(&dir, &["symbolic-ref", "HEAD", &head_ref], env)?;
            if !sr.ok {
                return Err(step_failure("init", &first_line(&git_failure(&sr)), path));
            }
        }
        initialized = true;
    }
    let mut committed = false;
    if !has_head(&dir, env)? {
        if !has_identity(&dir, env)? {
            return Err(step_failure("identity", "", path));
        }
        empty_first_commit(&dir, env).map_err(|line| step_failure("commit", &line, path))?;
        committed = true;
    }
    Ok(RepoInitialized {
        branch: head_branch(&dir, env).unwrap_or_default(),
        initialized,
        committed,
    })
}

/// 종료 코드만 본다(문구는 로케일을 탄다). `user.name` 칸만 보지 않는다 — `git var` 가 `commit-tree` 와 같은 규칙으로 신원을 찾는다.
fn has_identity(dir: &Path, env: Env) -> Result<bool, String> {
    Ok(git(dir, &["var", "GIT_AUTHOR_IDENT"], env)?.ok
        && git(dir, &["var", "GIT_COMMITTER_IDENT"], env)?.ok)
}

fn empty_first_commit(dir: &Path, env: Env) -> Result<(), String> {
    let step = |args: &[&str]| -> Result<String, String> {
        let r = git(dir, args, env)?;
        if r.ok {
            Ok(r.stdout.trim().to_string())
        } else {
            Err(first_line(&git_failure(&r)))
        }
    };
    let tree = step(&["mktree"])?;
    let commit = step(&["commit-tree", &tree, "-m", INITIAL_COMMIT_MESSAGE])?;
    step(&["update-ref", "HEAD", &commit, ""])?;
    Ok(())
}

/// 구분자는 부모가 쓰는 것을 따른다 — `Path::join` 은 Windows 에서 `C:/src/x\name` 처럼 섞는다.
pub(crate) fn local_join(parent: &str, name: &str) -> String {
    if parent.ends_with(['\\', '/']) {
        return format!("{parent}{name}");
    }
    let sep = parent
        .chars()
        .rev()
        .find(|c| *c == '\\' || *c == '/')
        .unwrap_or(std::path::MAIN_SEPARATOR);
    format!("{parent}{sep}{name}")
}

pub(crate) fn create_blocking(
    parent: &str,
    name: &str,
    env: Env,
) -> Result<ProjectCreated, String> {
    let name = valid_folder_name(name)?;
    let parent = parent.trim();
    if parent.chars().any(char::is_control) || !crate::worktree::is_absolute_dir(parent, false) {
        return Err(tr!(
            ko: "만들 자리는 절대 경로여야 합니다: {parent}",
            en: "The parent folder must be an absolute path: {parent}"
        ));
    }
    let par = Path::new(parent);
    if !par.is_dir() {
        return Err(step_failure("noparent", "", parent));
    }
    let shown = local_join(parent, name);
    let target = PathBuf::from(&shown);
    if target.exists() {
        if !target.is_dir() {
            return Err(step_failure("notdir", "", &shown));
        }
        let entries: Vec<String> = std::fs::read_dir(&target)
            .map_err(|e| step_failure("mkdir", &e.to_string(), &shown))?
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        // `.git` 하나뿐 = 첫 커밋이 실패한 뒤 다시 누른 자리
        if !(entries.is_empty() || entries == [".git"]) {
            return Err(step_failure("notempty", "", &shown));
        }
    } else {
        std::fs::create_dir(&target).map_err(|e| step_failure("mkdir", &e.to_string(), &shown))?;
    }
    let done = ensure_repo_blocking(&shown, env)?;
    Ok(ProjectCreated {
        path: shown,
        branch: done.branch,
    })
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 실패는 `Err` 가 아니라 `error` 갈래다(폼이 한 줄로 그린다).
#[tauri::command]
pub async fn git_repo_status(path: String) -> Result<RepoStatus, String> {
    blocking(move || Ok(status_blocking(&path, &[]))).await
}

#[tauri::command]
pub async fn git_repo_init(path: String) -> Result<RepoInitialized, String> {
    blocking(move || ensure_repo_blocking(&path, &[])).await
}

/// 프로젝트 목록에 넣지 않는다 — 프런트가 돌려받은 `path` 로 `project_upsert` 한다.
#[tauri::command]
pub async fn git_project_create(parent: String, name: String) -> Result<ProjectCreated, String> {
    blocking(move || create_blocking(&parent, &name, &[])).await
}

async fn remote_exec(
    id: u32,
    command: String,
) -> Result<crate::ssh::ExecOutcome, String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let outcome = crate::ssh::run_exec(
        handle,
        command,
        REMOTE_TIMEOUT,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    if let Some(e) = outcome.error {
        return Err(e);
    }
    if outcome.timed_out {
        return Err(tr!(
            ko: "원격 git 이 {secs}초 안에 답하지 않았습니다",
            en: "The remote git did not answer within {secs} seconds",
            secs = REMOTE_TIMEOUT.as_secs()
        ));
    }
    Ok(outcome)
}

fn bad_remote_path() -> String {
    tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid")
}

#[tauri::command]
pub async fn ssh_git_repo_status(
    id: u32,
    path: String,
) -> Result<RepoStatus, String> {
    let command = remote_status_command(&path).ok_or_else(bad_remote_path)?;
    let o = remote_exec(id, command).await?;
    Ok(parse_remote_status(&o.stdout, &o.stderr))
}

#[tauri::command]
pub async fn ssh_git_repo_init(
    id: u32,
    path: String,
) -> Result<RepoInitialized, String> {
    let command = remote_ensure_command(&path).ok_or_else(bad_remote_path)?;
    let o = remote_exec(id, command).await?;
    parse_remote_ensure(&o.stdout, &o.stderr, o.exit_code == Some(0), path.trim())
}

// ---------------------------------------------------------------------------
// 머리줄 브랜치 칩
// ---------------------------------------------------------------------------

/// 프런트 `pane-chips.ts` 의 `GitHead` 와 1:1. [`RepoStatus`] 를 쓰지 않는다 — 하위 폴더에서 브랜치를 싣지 않고
/// detached 도 모르며 셸이 `cd` 할 때마다 부르기엔 무겁다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitHead {
    Branch { name: String },
    Detached { sha: String },
    None,
}

fn head_word(s: &str) -> Option<String> {
    let w = s.trim();
    (!w.is_empty() && !w.chars().any(|c| c.is_control() || c.is_whitespace())).then(|| w.to_string())
}

pub(crate) fn head_blocking(path: &str, env: Env) -> GitHead {
    let dir = PathBuf::from(path.trim());
    if path.trim().is_empty() || !dir.is_dir() {
        return GitHead::None;
    }
    if let Some(name) = git(&dir, &["symbolic-ref", "--short", "-q", "HEAD"], env)
        .ok()
        .filter(|r| r.ok)
        .and_then(|r| head_word(&r.stdout))
    {
        return GitHead::Branch { name };
    }
    match git(&dir, &["rev-parse", "--short", "-q", "--verify", "HEAD"], env)
        .ok()
        .filter(|r| r.ok)
        .and_then(|r| head_word(&r.stdout))
    {
        Some(sha) => GitHead::Detached { sha },
        None => GitHead::None,
    }
}

/// [`head_blocking`] 과 같은 두 단계여야 한다.
pub(crate) fn remote_head_command(path: &str) -> Option<String> {
    let p = path.trim();
    if p.is_empty() || p.chars().any(char::is_control) {
        return None;
    }
    let dir = crate::ssh::sh_path(p);
    Some(wrap_sh(&format!(
        r#"cd -- {dir} 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
b=$(git symbolic-ref --short -q HEAD 2>/dev/null) && {{ printf 'branch=%s\n' "$b"; exit 0; }}
s=$(git rev-parse --short -q --verify HEAD 2>/dev/null) && printf 'detached=%s\n' "$s"
exit 0
"#
    )))
}

pub(crate) fn parse_remote_head(stdout: &str) -> GitHead {
    let pairs = parse_kv(stdout);
    if let Some(name) = kv(&pairs, "branch").and_then(head_word) {
        return GitHead::Branch { name };
    }
    match kv(&pairs, "detached").and_then(head_word) {
        Some(sha) => GitHead::Detached { sha },
        None => GitHead::None,
    }
}

/// 실패는 `none` 이다(`Err` 없음 — 칩이 안 설 뿐).
#[tauri::command]
pub async fn git_head(path: String) -> Result<GitHead, String> {
    blocking(move || Ok(head_blocking(&path, &[]))).await
}

#[tauri::command]
pub async fn ssh_git_head(id: u32, path: String) -> Result<GitHead, String> {
    let command = remote_head_command(&path).ok_or_else(bad_remote_path)?;
    let o = remote_exec(id, command).await?;
    Ok(parse_remote_head(&o.stdout))
}

/// 돌려주는 `path` 는 사람이 적은 꼴 그대로(`~/src/api`)다.
#[tauri::command]
pub async fn ssh_git_project_create(
    id: u32,
    parent: String,
    name: String,
) -> Result<ProjectCreated, String> {
    let name = valid_folder_name(&name)?.to_string();
    let command = remote_create_command(&parent, &name).ok_or_else(|| {
        tr!(
            ko: "만들 자리는 원격의 절대 경로(/ 또는 ~ 로 시작)여야 합니다: {parent}",
            en: "The parent folder must be an absolute remote path (starting with / or ~): {parent}",
            parent = parent.trim()
        )
    })?;
    let path = remote_join(&parent, &name);
    let o = remote_exec(id, command).await?;
    let done = parse_remote_ensure(&o.stdout, &o.stderr, o.exit_code == Some(0), &path)?;
    Ok(ProjectCreated {
        path,
        branch: done.branch,
    })
}

#[cfg(test)]
mod tests;
