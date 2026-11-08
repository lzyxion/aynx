//! 저장소 상태 · 초기화 · 새 프로젝트 폴더 (docs/log/2026-09-28-project-create.md).
//!
//! 프로젝트는 "저장소 폴더 하나" 인데, 지금까지 앱은 그 폴더가 **정말 저장소인지** 묻지 않았다.
//! 빈 폴더를 프로젝트로 등록하면 독 트리에 `fatal: not a git repository` 한 줄만 섰고(사용자:
//! "빈 폴더에 프로젝트를 만들면 main 이 안 잡힌다"), 커밋이 없는 저장소에서 워크트리를 만들면
//! git 이 `--orphan` 으로 추론해 **main 과 히스토리를 나누지 않는 고아 브랜치**가 생겼다(구버전
//! git 은 아예 실패). 이 모듈이 그 셋을 다룬다:
//!
//! - **판정** [`RepoStatus`] — `ok` · `notRepo` · `subfolder` · `noCommit` · `missing` · `error`.
//!   git 의 오류 **문구**로 가르지 않는다(로케일마다 다르다) — `rev-parse --show-toplevel` 이
//!   서는가, 선 자리가 그 폴더인가, `rev-parse --verify HEAD` 가 서는가로 가른다. "저장소가
//!   아니다" 는 `rev-parse` 실패 **그리고** 그 폴더와 조상 어디에도 `.git` 이 없을 때만이다 —
//!   `.git` 이 있는데 실패하면(소유자가 다른 폴더의 `safe.directory` 거절 등) 초기화를 권하면
//!   안 되므로 `error` + git 의 첫 줄이다.
//! - **초기화** [`ensure_repo_blocking`] — 저장소가 아니면 `git init`(브랜치 = `init.defaultBranch`,
//!   없으면 `main`; `-b` 를 모르는 구 git 은 `symbolic-ref` 로), HEAD 가 없으면 **빈 첫 커밋**.
//!   이미 저장소 루트이고 커밋도 있으면 아무것도 하지 않는다. "초기화하고 추가" · "첫 커밋 만들고
//!   추가/계속" · 독의 [git 저장소로 초기화] 가 전부 이 하나다.
//! - **새 폴더** [`create_blocking`] — `<부모>/<이름>` 을 만들고(있으면 비어 있어야 — `.git` 하나만
//!   있는 것도 받는다: 첫 커밋이 실패한 뒤 다시 누르는 자리) 위의 초기화를 돈다.
//!
//! ## 빈 첫 커밋은 배관 명령으로
//!
//! `git commit --allow-empty` 는 **인덱스를 커밋한다** — 커밋 없는 저장소에 사람이 `git add` 해
//! 둔 파일이 있으면 "빈" 첫 커밋에 그것들이 들어간다. 그래서 `mktree`(빈 입력 → 빈 트리 —
//! SHA-1·SHA-256 저장소 모두) → `commit-tree` → `update-ref HEAD <커밋> ""`(옛 값 빈 글자 = "아직
//! 없어야 한다" — 그사이 누가 커밋했으면 덮지 않고 실패한다)로 만든다. 인덱스·작업 폴더는 손대지
//! 않는다. 신원(`user.name`·`user.email`)은 커밋 **전에** `git var GIT_AUTHOR_IDENT`·`GIT_COMMITTER_IDENT`
//! 의 종료 코드로 본다([`has_identity`] — 로케일 무관) — 서지 않으면 이유 코드 `[git-identity]`
//! ([`crate::errors::git_identity_missing`])로 실패해 폼 · 독이 `git config --global …` 두 줄을 안내한다(앱이 대신
//! 설정하거나 임시 신원으로 커밋하지 않는다). 폴더와 저장소는 남긴다(고친 뒤 같은 단추를 다시 누르면 커밋만 한다).
//!
//! ## 원격
//!
//! 같은 단계를 살아 있는 SSH 세션의 exec 왕복 **하나**로 한다(목록·제거와 같은 길 — 새 접속을
//! 열지 않는다). 명령 글자는 여기서 짓고 프런트는 경로·이름만 넘긴다. 사용자의 로그인 셸이
//! fish 여도 돌도록 스크립트를 통째로 `sh -c '<…>'` 에 싣는다. 경로 인용은 목록·제거와 같은
//! [`crate::ssh::sh_path`] 다(`~/api` → `"$HOME"/'api'`). 스크립트는 `key=value` 줄로 답하고
//! 실패는 `aynx-fail=<단계>` 줄 + stderr 의 첫 줄이다([`parse_kv`]).

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::worktree::{
    blocking, comparable, first_line, git_failure, parse_porcelain, run_git_env, strip_verbatim,
    GitRun, GIT_TIMEOUT,
};

/// 원격 왕복 하나의 시한 — 판정은 폼이 기다리고, 초기화·만들기는 사람이 누른 단추가 기다린다.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(15);

/// 빈 첫 커밋의 메시지 — 사용자 저장소에 남는 글자라 번역하지 않는다(git 의 관례 그대로).
const INITIAL_COMMIT_MESSAGE: &str = "Initial commit";

/// 저장소 상태 — 프런트 `src/lib/repo-status.ts` 의 `RepoStatus` 와 1:1 (`kind` 로 갈린다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepoStatus {
    /// 저장소 루트이고 커밋이 있다. `worktrees` 는 git 이 아는 워크트리 수(주 폴더 포함 — 못 읽으면 없음)
    Ok {
        branch: Option<String>,
        worktrees: Option<u32>,
    },
    /// git 저장소가 아니다 — 그 폴더와 조상 어디에도 `.git` 이 없다
    NotRepo,
    /// 저장소 **안의 하위 폴더**다 — `root` 가 저장소 루트
    Subfolder { root: String },
    /// 저장소 루트인데 커밋이 없다(HEAD 가 태어나지 않았다) — `branch` 는 HEAD 가 가리키는 이름
    NoCommit { branch: Option<String> },
    /// 폴더가 없다
    Missing,
    /// 그 밖의 실패 — git 이 없다 · `.git` 은 있는데 git 이 거절한다(소유자 등). git 의 첫 줄
    Error { message: String },
}

/// [`ensure_repo_blocking`] 의 답.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RepoInitialized {
    /// 지금 HEAD 가 가리키는 브랜치
    pub branch: String,
    /// `git init` 을 돌렸나 (이미 저장소였으면 `false`)
    pub initialized: bool,
    /// 빈 첫 커밋을 만들었나 (이미 커밋이 있었으면 `false`)
    pub committed: bool,
}

/// [`create_blocking`] 의 답 — `path` 가 프로젝트 경로로 저장될 글자다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ProjectCreated {
    pub path: String,
    pub branch: String,
}

// ---------------------------------------------------------------------------
// 순수 규칙
// ---------------------------------------------------------------------------

/// Windows 가 장치로 읽는 이름 — 확장자가 붙어도(`nul.txt`) 같다.
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// 새 프로젝트 **폴더 이름** (**순수 함수**) — 워크트리 이름 규칙([`crate::worktree::valid_name`])에서
/// `/` 를 뺀 것 + 끝의 `.` 금지(Windows 가 떼어 버린다) + Windows 장치 이름 금지. OS 와 무관하게
/// 같은 표다(원격 리눅스에서 만든 이름이 나중에 Windows 로 옮겨져도 깨지지 않게). 프런트
/// `projectFolderNameProblem` 과 **같은 표**다.
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

/// `git config --get init.defaultBranch` 의 출력 → 브랜치 (**순수 함수**). 비었거나 여러 줄·
/// 제어 문자·`-` 로 시작하면(옵션으로 읽힌다) `main` 이다.
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

/// 새 프로젝트의 원격 경로 글자 (**순수 함수**) — `<부모>/<이름>`, 부모의 끝 `/` 는 뗀다(뿌리 `/`
/// 는 그대로). `~` 꼴은 펴지 않는다 — 프로젝트는 사람이 적은 꼴(`~/src/api`)로 저장된다.
pub(crate) fn remote_join(parent: &str, name: &str) -> String {
    let p = parent.trim();
    let base = p.trim_end_matches('/');
    if base.is_empty() && p.starts_with('/') {
        format!("/{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// 원격 절대 경로를 사람이 적는 꼴로 (**순수 함수**) — 홈 아래면 `~/…`, 아니면 그대로.
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

/// 원격 스크립트의 답 — `key=value` 줄들 (**순수 함수**). 같은 키는 앞의 것이 이긴다. 로그인
/// 스크립트가 찍은 잡음 줄(`=` 없는 줄 · 모르는 키)은 부르는 쪽이 무시한다.
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

/// 원격 판정 스크립트의 답 → [`RepoStatus`] (**순수 함수**). `home` 이 오면 루트를 `~/…` 로 적는다.
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

/// 원격 stderr 의 첫 줄 — 비었으면 "원격 git 이 실패했습니다".
fn remote_line(stderr: &str) -> String {
    crate::worktree::remote_failure_line(stderr)
}

/// 스크립트를 fish 같은 셸에서도 돌도록 `sh -c '<…>'` 에 싣는다 (**순수 함수**).
fn wrap_sh(script: &str) -> String {
    format!("sh -c {}", crate::ssh::sh_quote(script))
}

/// 원격 판정 명령 (**순수 함수**) — 경로 하나를 [`crate::ssh::sh_path`] 로 인용한다.
///
/// `cd` 가 안 되면 `missing`, git 이 없으면 `nogit`. `rev-parse --show-toplevel` 이 실패하면 그
/// 폴더에서 뿌리까지 `.git` 을 찾아 없으면 `notrepo`, 있으면 `error` + git 의 첫 줄. 루트가 `pwd -P`
/// 와 다르면 `subfolder`(+ `root`·`home`). HEAD 가 없으면 `nocommit`, 있으면 `ok` + 워크트리 수.
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

/// 초기화 단계의 셸 조각 — `cd` 한 폴더에서 [`ensure_repo_blocking`] 과 같은 일을 한다.
/// 실패는 `aynx-fail=<단계>` 줄 + 0 이 아닌 종료.
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

/// 원격 초기화 명령 (**순수 함수**) — 있는 폴더 하나에서.
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

/// 원격 새 프로젝트 명령 (**순수 함수**) — 부모는 원격의 절대 자리(`/`·`~`), 이름은
/// [`valid_folder_name`] 을 지난 글자. 폴더가 있으면 비었거나 `.git` 하나뿐이어야 한다.
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

/// 원격 초기화·만들기의 답 → [`RepoInitialized`] 또는 사람이 읽을 한 줄 (**순수 함수**).
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

/// 실패한 단계 → 사람이 읽을 한 줄. `line` 은 git 이 남긴 첫 줄(없으면 일반 문구).
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
// 로컬 — 블로킹 몸통 (부르는 쪽이 `spawn_blocking` 안이다)
// ---------------------------------------------------------------------------

type Env<'a> = &'a [(&'a str, &'a str)];

fn git(dir: &Path, args: &[&str], env: Env) -> Result<GitRun, String> {
    run_git_env(dir, args, GIT_TIMEOUT, env)
}

/// 비교용 실제 자리 — `canonicalize`(짧은 이름·심볼릭 링크를 편다) 후 [`comparable`].
fn real_key(path: &Path) -> String {
    let s = std::fs::canonicalize(path)
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned());
    comparable(&s)
}

/// 사람이 읽을 실제 자리 — `canonicalize` 후 `\\?\` 를 뗀 글자(없으면 받은 글자).
fn real_shown(path: &Path) -> String {
    std::fs::canonicalize(path)
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}

/// 그 폴더나 조상 어딘가에 `.git`(폴더든 파일이든)이 있는가.
fn has_git_ancestor(dir: &Path) -> bool {
    let start = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    start.ancestors().any(|d| d.join(".git").exists())
}

/// 이 폴더가 저장소 **루트**인가 (`rev-parse --show-toplevel` 이 이 폴더를 가리킨다).
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

/// 판정 — 블로킹 몸통 (모듈 머리말의 "판정").
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
            // `.git` 은 있는데 git 이 거절한다 — 초기화를 권하면 안 된다. git 의 첫 줄을 싣는다.
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

/// 초기화 — 블로킹 몸통 (모듈 머리말의 "초기화"). 폴더는 있어야 한다.
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
            // `-b` 를 모르는 구 git(2.28 이전) — 맨 init 후 HEAD 를 그 브랜치로 돌린다.
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

/// 이 저장소에서 커밋할 신원이 서는가 — `git var GIT_AUTHOR_IDENT` · `GIT_COMMITTER_IDENT` 가 둘 다 서는가(종료 코드만
/// 본다 — 문구는 로케일을 탄다). `commit-tree` 가 신원을 찾는 규칙(저장소 · 전역 설정 · `GIT_AUTHOR_*` 환경 ·
/// `user.useConfigOnly` · 호스트 이름 추측)을 git 이 그대로 따르므로 `user.name` 칸만 보는 것보다 곧다.
fn has_identity(dir: &Path, env: Env) -> Result<bool, String> {
    Ok(git(dir, &["var", "GIT_AUTHOR_IDENT"], env)?.ok
        && git(dir, &["var", "GIT_COMMITTER_IDENT"], env)?.ok)
}

/// 빈 첫 커밋 — 배관 명령 셋(모듈 머리말). 실패는 git 의 첫 줄.
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

/// 로컬 부모 경로에 이름 하나를 잇는다 (**순수 함수**) — 구분자는 **부모가 쓰는 것**(마지막으로 나온 것)을 따르고,
/// 부모에 구분자가 없으면 OS 의 것이다. 부모가 구분자로 끝나면 하나 더 붙이지 않는다(`C:\` → `C:\name`).
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

/// 새 프로젝트 폴더 — 블로킹 몸통 (모듈 머리말의 "새 폴더").
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
    // 부모 경로가 쓰는 구분자를 따른다 — `par.join` 은 Windows 에서 `\` 를 붙여 `C:/src/x\name` 처럼 섞였다.
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
        // 비었거나 `.git` 하나뿐 — 첫 커밋이 실패한 뒤 다시 누른 자리는 커밋만 한다.
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

/// 로컬 폴더 하나의 저장소 상태 — 실패는 `Err` 가 아니라 `error` 갈래다(폼이 한 줄로 그린다).
#[tauri::command]
pub async fn git_repo_status(path: String) -> Result<RepoStatus, String> {
    blocking(move || Ok(status_blocking(&path, &[]))).await
}

/// 로컬 폴더를 저장소로 — 저장소가 아니면 `git init`, HEAD 가 없으면 빈 첫 커밋(둘 다 이미 됐으면
/// 아무것도 안 한다). "초기화하고 추가" · "첫 커밋 만들고 …" · 독의 [git 저장소로 초기화] 가 이것 하나다.
#[tauri::command]
pub async fn git_repo_init(path: String) -> Result<RepoInitialized, String> {
    blocking(move || ensure_repo_blocking(&path, &[])).await
}

/// 새 로컬 프로젝트 폴더 — `<parent>/<name>` 을 만들고 저장소로(빈 첫 커밋까지). 프로젝트 목록에
/// 넣는 일은 하지 않는다 — 프런트가 돌려받은 `path` 로 `project_upsert` 한다(실패하면 넣지 않는다).
#[tauri::command]
pub async fn git_project_create(parent: String, name: String) -> Result<ProjectCreated, String> {
    blocking(move || create_blocking(&parent, &name, &[])).await
}

/// 원격 exec 한 번 — 시한 초과·전송 오류는 `Err`.
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

/// **원격** 폴더 하나의 저장소 상태 — 살아 있는 SSH 세션 `id` 의 exec 왕복 하나.
#[tauri::command]
pub async fn ssh_git_repo_status(
    id: u32,
    path: String,
) -> Result<RepoStatus, String> {
    let command = remote_status_command(&path).ok_or_else(bad_remote_path)?;
    let o = remote_exec(id, command).await?;
    Ok(parse_remote_status(&o.stdout, &o.stderr))
}

/// **원격** 폴더를 저장소로 — [`git_repo_init`] 과 같은 일을 exec 왕복 하나로.
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
// 머리줄 브랜치 칩 — 폴더 하나가 선 HEAD (2026-10-11, 목업 E2)
// ---------------------------------------------------------------------------

/// 폴더 하나가 선 git HEAD — 타일 머리줄의 브랜치 칩(`src/lib/app/pane-git.svelte.ts`)이 읽는다.
///
/// [`RepoStatus`] 를 쓰지 않는 이유: 그것은 **프로젝트 폼의 판정**이라 하위 폴더에서는 브랜치를 싣지 않고
/// (루트만 — "루트로 바꾸기" 를 권하려고), detached HEAD 의 커밋도 모르며, 워크트리 목록까지 읽어 무겁다.
/// 셸이 `cd` 할 때마다 부르는 칩에는 git 두 번이면 된다: `symbolic-ref --short -q HEAD`(브랜치 — 커밋이 없는
/// 저장소도 선다) → 실패하면 `rev-parse --short -q --verify HEAD`(detached 의 짧은 해시). 둘 다 실패하면
/// `none`(저장소가 아니다 · git 이 없다 · 폴더가 없다) — 칩은 그리지 않는다. 틀린 값보다 없는 편이 낫다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitHead {
    Branch { name: String },
    Detached { sha: String },
    None,
}

/// 브랜치·해시로 받을 만한 글자인가 (**순수 함수**) — 비었거나 제어 문자·공백이 끼면 버린다.
fn head_word(s: &str) -> Option<String> {
    let w = s.trim();
    (!w.is_empty() && !w.chars().any(|c| c.is_control() || c.is_whitespace())).then(|| w.to_string())
}

/// 로컬 — 블로킹 몸통. 폴더가 없으면 git 을 부르지 않는다.
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

/// 원격 HEAD 명령 (**순수 함수**) — [`head_blocking`] 과 같은 두 단계를 `sh -c` 하나로. 답은 `branch=` 또는
/// `detached=` 한 줄(없으면 아무것도 — `none`).
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

/// 원격 HEAD 명령의 답 → [`GitHead`] (**순수 함수**). 로그인 배너가 앞에 끼어도 `key=` 줄만 본다.
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

/// 로컬 폴더 하나의 HEAD — 머리줄 브랜치 칩. 실패는 `none` 이다(`Err` 없음 — 칩이 안 설 뿐).
#[tauri::command]
pub async fn git_head(path: String) -> Result<GitHead, String> {
    blocking(move || Ok(head_blocking(&path, &[]))).await
}

/// **원격** 폴더 하나의 HEAD — 살아 있는 SSH 세션 `id` 의 exec 왕복 하나(새 접속을 열지 않는다).
#[tauri::command]
pub async fn ssh_git_head(id: u32, path: String) -> Result<GitHead, String> {
    let command = remote_head_command(&path).ok_or_else(bad_remote_path)?;
    let o = remote_exec(id, command).await?;
    Ok(parse_remote_head(&o.stdout))
}

/// **원격** 새 프로젝트 폴더 — [`git_project_create`] 와 같은 일을 exec 왕복 하나로. 돌려주는
/// `path` 는 사람이 적은 꼴 그대로(`~/src/api`) 잇는다.
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
