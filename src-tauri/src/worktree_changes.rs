//! 워크트리 변경 상태 — 독 워크트리 줄의 배지 `+84 −19 ↑2` · `병합됨` 재료.
//!
//! - 읽기 전용 — `diff` · `reflog` 도 `--no-optional-locks` 로 부른다(이 읽기가 `index.lock` 을 잡으면 같은 워크트리의 에이전트 git 이 실패한다).
//! - 기준은 주 작업 폴더의 브랜치 하나뿐이고 커밋한 것만 센다 — 커밋 안 한 변경은 브랜치 그래프의 ✎ 줄 몫이다.
//! - 병합됨: 브랜치가 있고 · main 이 아니고 · `ahead == 0` · reflog 에 커밋 기록(`branch: Created from …` 뿐이면 갓 만든 브랜치라 아니다).
//!   아니고 앞선 커밋이 있으면 내용 기준(`crate::merge_detect` — squash · rebase)으로 한 번 더 본다.
//! - 원격은 이미 붙은 세션의 exec 한 번 — 스크립트 글자는 Rust 가 짓고 프런트는 저장소 · 경로만 넘긴다(범용 exec 을 열지 않는다).

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::merge_detect::{content_local, judge, ContentFacts, MergeKind};
use crate::worktree::{comparable, git_failure, parse_porcelain, path_key, run_git};

pub(crate) const MAX_PATHS: usize = 64;
const LOCAL_TIMEOUT: Duration = Duration::from_secs(15);
/// 워크트리 여럿을 한꺼번에 도는 exec 하나의 시한.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeChanges {
    /// 물은 경로 그대로(프런트의 열쇠)
    pub path: String,
    /// 주 폴더 브랜치를 모르면 `None`
    pub ahead: Option<u32>,
    pub added_lines: u32,
    pub deleted_lines: u32,
    pub merged: bool,
    pub merged_kind: Option<MergeKind>,
}

pub(crate) const UNTRACKED_MAX_FILES: usize = 200;
pub(crate) const UNTRACKED_MAX_BYTES: u64 = 1024 * 1024;
/// git 과 같은 8000바이트.
const BINARY_SNIFF: usize = 8000;

/// 로컬과 원격 스크립트의 awk 가 같은 표를 쓴다 — 어긋나지 않게.
pub(crate) const HISTORY_PREFIXES: [&str; 5] = ["commit", "merge ", "cherry-pick", "rebase", "pull"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Change {
    Modified,
    Added,
    Deleted,
}

// ── 순수 규칙 ──

/// 스크립트에 실리는 글자라 16진 4~64자만 받는다.
pub(crate) fn valid_commit(s: &str) -> bool {
    (4..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// porcelain v1 의 XY. 충돌(`U` · `AA` · `DD`)은 수정으로 묶는다.
pub(crate) fn classify(xy: &str) -> Option<Change> {
    let b = xy.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let (x, y) = (b[0], b[1]);
    match (x, y) {
        (b'?', b'?') => Some(Change::Added),
        (b'!', b'!') => None,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => Some(Change::Modified),
        (b'A', _) | (_, b'A') => Some(Change::Added),
        (b'D', _) | (_, b'D') => Some(Change::Deleted),
        (b' ', b' ') => None,
        _ => Some(Change::Modified),
    }
}

pub(crate) fn parse_count(s: &str) -> Option<u32> {
    s.trim().parse().ok()
}

/// 바이너리(`-` `-`)는 세지 않는다. 경로 칸은 보지 않는다(이름 바뀜 `a => b` 도 한 줄이다).
pub(crate) fn sum_numstat(text: &str) -> (u32, u32) {
    let (mut a, mut d) = (0u32, 0u32);
    for raw in text.lines() {
        let mut f = raw.trim_end_matches('\r').split('\t');
        let (Some(x), Some(y)) = (f.next(), f.next()) else {
            continue;
        };
        if let (Ok(x), Ok(y)) = (x.parse::<u32>(), y.parse::<u32>()) {
            a = a.saturating_add(x);
            d = d.saturating_add(y);
        }
    }
    (a, d)
}

/// git numstat 과 같게 센다. 바이너리면 `None`.
pub(crate) fn text_lines(bytes: &[u8]) -> Option<u32> {
    if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
        return None;
    }
    let nl = bytes.iter().filter(|&&b| b == b'\n').count();
    let tail = usize::from(bytes.last().is_some_and(|&b| b != b'\n'));
    Some(u32::try_from(nl + tail).unwrap_or(u32::MAX))
}

pub(crate) fn reflog_has_commits(text: &str) -> bool {
    text.lines().any(|raw| {
        let line = raw.trim_end_matches('\r');
        HISTORY_PREFIXES.iter().any(|p| line.starts_with(p))
    })
}

pub(crate) fn is_merged(
    branch: Option<&str>,
    main: Option<&str>,
    ahead: Option<u32>,
    has_history: bool,
) -> bool {
    let Some(b) = branch.map(str::trim).filter(|b| !b.is_empty()) else {
        return false;
    };
    main.is_some_and(|m| m.trim() != b) && ahead == Some(0) && has_history
}

pub(crate) fn merged_kind_of(ancestry: bool, content: Option<MergeKind>) -> Option<MergeKind> {
    if ancestry {
        Some(MergeKind::Ancestry)
    } else {
        content
    }
}

/// 조상 병합이 아닐 때만 부른다.
pub(crate) fn wants_content(branch: Option<&str>, main: Option<&str>, ahead: Option<u32>) -> bool {
    let Some(b) = branch.map(str::trim).filter(|b| !b.is_empty()) else {
        return false;
    };
    main.is_some_and(|m| m.trim() != b) && ahead.is_some_and(|a| a > 0)
}

/// `-` 로 시작하면 옵션으로 읽히므로 짓지 않는다.
fn branch_ref(name: &str) -> Option<String> {
    let m = name.trim();
    (!m.is_empty() && !m.starts_with('-')).then(|| format!("refs/heads/{m}"))
}

fn main_range(main: &str) -> Option<String> {
    branch_ref(main).map(|r| format!("{r}..HEAD"))
}

fn clean_paths(paths: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        let t = p.trim();
        if t.is_empty() || t.chars().any(char::is_control) || out.iter().any(|o| o == t) {
            continue;
        }
        out.push(t.to_string());
        if out.len() >= MAX_PATHS {
            break;
        }
    }
    out
}

// ── 로컬 ──

/// 못 읽으면 `false`.
fn branch_has_history(dir: &Path, branch: &str) -> bool {
    branch_ref(branch).is_some_and(|r| {
        run_git(
            dir,
            &["--no-optional-locks", "reflog", "show", "--format=%gs", &r, "--"],
            LOCAL_TIMEOUT,
        )
        .ok()
        .filter(|o| o.ok)
        .is_some_and(|o| reflog_has_commits(&o.stdout))
    })
}

/// 독 칩과 같은 판정을 워크트리 폴더 없이 저장소에서 다시 내린다. 모르면 `false`.
pub(crate) fn branch_merged_blocking(repo: &Path, branch: &str, main: Option<&str>) -> bool {
    let (Some(m), Some(b)) = (main.and_then(branch_ref), branch_ref(branch)) else {
        return false;
    };
    let range = format!("{m}..{b}");
    let ahead = run_git(repo, &["rev-list", "--count", &range], LOCAL_TIMEOUT)
        .ok()
        .filter(|o| o.ok)
        .and_then(|o| parse_count(&o.stdout));
    if is_merged(Some(branch), main, ahead, true) && branch_has_history(repo, branch) {
        return true;
    }
    wants_content(Some(branch), main, ahead)
        && main.is_some_and(|mm| crate::merge_detect::judge_branch_local(repo, mm, branch).is_some())
}

/// 저장소의 워크트리 목록에 있는 경로만 센다 — 다른 폴더를 가리키는 경로는 버린다.
fn changes_blocking(repo: &Path, paths: &[String]) -> Result<Vec<WorktreeChanges>, String> {
    let run = run_git(repo, &["worktree", "list", "--porcelain"], LOCAL_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    let list = parse_porcelain(&run.stdout);
    let listed: Vec<String> = list
        .iter()
        .map(|w| comparable(&path_key(&w.path)))
        .collect();
    let main = list.first().and_then(|w| w.branch.clone());
    let mut out = Vec::new();
    for path in clean_paths(paths) {
        let key = path_key(&path);
        let Some(entry) = listed
            .iter()
            .position(|k| *k == comparable(&key))
            .map(|i| &list[i])
        else {
            continue;
        };
        if entry.bare {
            continue;
        }
        let dir = PathBuf::from(&path);
        let git_ok = |args: &[&str]| run_git(&dir, args, LOCAL_TIMEOUT).ok().filter(|r| r.ok);
        if git_ok(&["rev-parse", "--is-inside-work-tree"]).is_none() {
            continue;
        }
        let ahead = main
            .as_deref()
            .and_then(main_range)
            .and_then(|r| git_ok(&["rev-list", "--count", &r]))
            .and_then(|r| parse_count(&r.stdout));
        let (added_lines, deleted_lines) = main
            .as_deref()
            .and_then(branch_ref)
            .and_then(|m| git_ok(&["merge-base", "HEAD", &m]))
            .map(|r| r.stdout.trim().to_string())
            .filter(|h| valid_commit(h))
            .and_then(|mb| git_ok(&["--no-optional-locks", "diff", "--numstat", &mb, "HEAD", "--"]))
            .map(|r| sum_numstat(&r.stdout))
            .unwrap_or_default();
        let branch = entry.branch.as_deref();
        let ancestry = is_merged(branch, main.as_deref(), ahead, true)
            && branch.is_some_and(|b| branch_has_history(&dir, b));
        let content = if !ancestry && wants_content(branch, main.as_deref(), ahead) {
            main.as_deref()
                .and_then(branch_ref)
                .and_then(|m| content_local(&dir, &m, "HEAD"))
                .map(|c| c.kind)
        } else {
            None
        };
        let merged_kind = merged_kind_of(ancestry, content);
        out.push(WorktreeChanges {
            path,
            ahead,
            added_lines,
            deleted_lines,
            merged: merged_kind.is_some(),
            merged_kind,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn git_worktree_changes(
    repo: String,
    paths: Vec<String>,
) -> Result<Vec<WorktreeChanges>, String> {
    let r = repo.trim();
    if r.is_empty() {
        return Err(tr!(ko: "프로젝트 경로가 비어 있습니다", en: "The project path is empty"));
    }
    let repo = PathBuf::from(r);
    crate::worktree::blocking(move || changes_blocking(&repo, &paths)).await
}

// ── 원격 — exec 한 번에 여러 워크트리 ──

/// 워크트리마다 `aynx-wt=<번호>` 로 덩어리를 연다 — 경로를 되돌려 적지 않아 인용할 일이 없다.
/// 줄 수 · reflog 판정은 합계 · 0/1 만 나온다 — 파일 이름 · 커밋 제목은 서버 안의 awk 에서 끝난다. 판정은 Rust 가 로컬과 같은 함수로 한다.
pub(crate) fn remote_changes_command(repo: &str, paths: &[String]) -> Option<String> {
    let r = repo.trim();
    if r.is_empty() || r.chars().any(char::is_control) {
        return None;
    }
    let mut calls = String::new();
    for (i, p) in paths.iter().enumerate().take(MAX_PATHS) {
        let p = p.trim();
        if p.chars().any(char::is_control) || !crate::worktree::is_absolute_dir(p, true) {
            continue;
        }
        calls.push_str(&format!("w {i} {}\n", crate::ssh::sh_path(p)));
    }
    if calls.is_empty() {
        return None;
    }
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
main=$(git -C {repo} worktree list --porcelain 2>/dev/null | sed -n '/^$/q;s/^branch refs\/heads\///p')
ns() {{ awk -F '\t' '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {{ a += $1; d += $2 }} END {{ printf "%d %d", a, d }}'; }}
hist() {{ awk '/^({hist})/ {{ h = 1 }} END {{ printf "%d", h }}'; }}
w() {{
  git -C "$2" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  echo "aynx-wt=$1"
  b=$(git -C "$2" symbolic-ref --short -q HEAD 2>/dev/null)
  printf 'branch=%s\nmain=%s\n' "$b" "$main"
  [ -n "$main" ] || return 0
  a=$(git -C "$2" rev-list --count "refs/heads/$main..HEAD" 2>/dev/null)
  printf 'ahead=%s\n' "$a"
  mb=$(git -C "$2" merge-base HEAD "refs/heads/$main" 2>/dev/null)
  if [ -n "$mb" ]; then printf 'lines=%s\n' "$(git -C "$2" --no-optional-locks diff --numstat "$mb" HEAD -- 2>/dev/null | ns)"; fi
  if [ -n "$b" ]; then printf 'hist=%s\n' "$(git -C "$2" --no-optional-locks reflog show --format=%gs "refs/heads/$b" -- 2>/dev/null | hist)"; fi
  if [ -n "$b" ] && [ "$b" != "$main" ] && [ "${{a:-0}}" -gt 0 ] 2>/dev/null; then cm "$2" "refs/heads/$main" HEAD; fi
}}
{cm}{calls}"#,
        repo = crate::ssh::sh_path(r),
        hist = HISTORY_PREFIXES.join("|"),
        cm = crate::merge_detect::remote_cm_function(),
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RemoteBlock {
    /// [`remote_changes_command`] 에 넘긴 경로의 번호
    pub index: usize,
    /// 분리된 HEAD 면 `None`
    pub branch: Option<String>,
    pub main: Option<String>,
    pub ahead: Option<u32>,
    pub lines: Option<(u32, u32)>,
    pub history: bool,
    pub content: Option<ContentFacts>,
}

fn parse_pair(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let a = it.next()?.parse().ok()?;
    let d = it.next()?.parse().ok()?;
    it.next().is_none().then_some((a, d))
}

/// `aynx-wt=` 앞의 줄(로그인 스크립트의 잡음)은 버린다.
pub(crate) fn parse_remote_changes(stdout: &str) -> Result<Vec<RemoteBlock>, String> {
    let mut out: Vec<RemoteBlock> = Vec::new();
    let nonempty = |v: &str| Some(v.trim().to_string()).filter(|v| !v.is_empty());
    for raw in stdout.lines() {
        let line = raw.trim_end_matches('\r');
        if line == "aynx-fail=nogit" {
            return Err(
                tr!(ko: "원격에 git 이 없습니다", en: "git is not installed on the remote"),
            );
        }
        if let Some(n) = line.strip_prefix("aynx-wt=") {
            if let Ok(index) = n.trim().parse() {
                out.push(RemoteBlock {
                    index,
                    ..RemoteBlock::default()
                });
            }
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if crate::merge_detect::absorb_line(&mut cur.content, line) {
            continue;
        }
        if let Some(b) = line.strip_prefix("branch=") {
            cur.branch = nonempty(b);
        } else if let Some(v) = line.strip_prefix("main=") {
            cur.main = nonempty(v);
        } else if let Some(v) = line.strip_prefix("ahead=") {
            cur.ahead = parse_count(v);
        } else if let Some(v) = line.strip_prefix("lines=") {
            cur.lines = parse_pair(v);
        } else if let Some(v) = line.strip_prefix("hist=") {
            cur.history = v.trim() == "1";
        }
    }
    Ok(out)
}

/// `paths[i]` 는 스크립트의 `w i` 에 실은 경로다.
pub(crate) fn resolve_remote(paths: &[String], blocks: &[RemoteBlock]) -> Vec<WorktreeChanges> {
    let mut out = Vec::new();
    for b in blocks {
        let Some(path) = paths.get(b.index) else {
            continue;
        };
        if out.iter().any(|o: &WorktreeChanges| &o.path == path) {
            continue;
        }
        let (added_lines, deleted_lines) = b.lines.unwrap_or_default();
        let ancestry = is_merged(b.branch.as_deref(), b.main.as_deref(), b.ahead, b.history);
        let content = if !ancestry && wants_content(b.branch.as_deref(), b.main.as_deref(), b.ahead) {
            b.content.as_ref().and_then(judge).map(|c| c.kind)
        } else {
            None
        };
        let merged_kind = merged_kind_of(ancestry, content);
        out.push(WorktreeChanges {
            path: path.clone(),
            ahead: b.ahead,
            added_lines,
            deleted_lines,
            merged: merged_kind.is_some(),
            merged_kind,
        });
    }
    out
}

#[tauri::command]
pub async fn ssh_git_worktree_changes(
    id: u32,
    repo: String,
    paths: Vec<String>,
) -> Result<Vec<WorktreeChanges>, String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let paths = clean_paths(&paths);
    let Some(command) = remote_changes_command(&repo, &paths) else {
        return Ok(Vec::new());
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
    let blocks = parse_remote_changes(&outcome.stdout)?;
    Ok(resolve_remote(&paths, &blocks))
}

#[cfg(test)]
mod tests;
