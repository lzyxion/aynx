//! diff 타일의 재료 — 브랜치 전체 · 커밋 하나 · 커밋 안 한 변경을 **읽기만** 한다 (docs/log/2026-10-05-diff-tile.md).
//!
//! 범위: `branch` = `merge-base(main, 브랜치)` … 끝(+ 그 워크트리의 커밋 안 한 것) · `commit` = `커밋^` … 커밋(병합 커밋은
//! 목록 없이 `merge`) · `wip` = 그 워크트리의 `HEAD` … 작업 폴더 · `range` = 정한 두 커밋.
//!
//! - git 에 쓰는 명령은 없다 — 검토 전용(스테이징 · 커밋 · 편집 없음). 프런트가 명령 글자를 짓는 범용 exec 은 없다.
//! - 읽기는 `--no-optional-locks` — 빼면 에이전트가 같은 워크트리에서 쓰는 git 이 `index.lock` 에 걸려 실패한다.
//! - 경로는 `--literal-pathspecs` 뒤 `--` 다음에만 싣는다(pathspec 마법으로 읽지 않게).
//! - 헝크의 글은 남의 것이다 — 제어 글자는 대리 글자로 바꿔 내보낸다([`clean_text`]).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::branch_graph::{
    exec_failure, git_ok, main_of, parse_name_status, parse_numstat, parse_status_z,
    parse_untracked_lines, repo_of, uncommitted_parts, NameStatus, LOCAL_TIMEOUT, MAX_FILES,
};
use crate::i18n::tr;
use crate::worktree::{comparable, git_failure, parse_porcelain, path_key, run_git, WorktreeInfo};
use crate::worktree_changes::{valid_commit, UNTRACKED_MAX_BYTES, UNTRACKED_MAX_FILES};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_DIFF_LINES: usize = 20_000;
/// 압축된 한 줄짜리 파일이 화면을 멈추지 않게 자른다.
pub(crate) const MAX_LINE_CHARS: usize = 4000;
pub(crate) const MAX_COMMITS: usize = 100;
const DIFF_TIMEOUT: Duration = Duration::from_secs(20);
const REMOTE_TIMEOUT: Duration = Duration::from_secs(25);
const REMOTE_LIST_MAX_BYTES: usize = 2 * 1024 * 1024;
const REMOTE_DIFF_MAX_BYTES: usize = MAX_DIFF_BYTES + 64 * 1024;
/// 나머지도 끝까지 읽어서 버린다 — 안 읽으면 파이프가 차서 자식이 멈춘다.
const STDERR_KEEP: usize = 64 * 1024;
/// 원격 답의 표식 — 앞의 로그인 잡음은 버린다.
const DIFF_MARK: &[u8] = b"aynx-diff\n";
const FILES_MARK: &str = "aynx-dfiles\0";
const END: &str = "aynx-end";

// ---------------------------------------------------------------------------
// 모양 — 프런트가 보내고 읽는다
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeKind {
    #[default]
    Branch,
    Commit,
    Wip,
    /// 정한 두 커밋 `base … commit`(오케스트레이션 보고 — 작업자 worktree 의 기준 … 보고 커밋)
    Range,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffScope {
    pub kind: ScopeKind,
    /// `commit`/`wip` 에서는 커밋 고르개와 커밋 안 한 수를 위한 것(없어도 된다)
    #[serde(default)]
    pub branch: Option<String>,
    /// git 목록의 글자 그대로
    #[serde(default)]
    pub worktree: Option<String>,
    /// `commit` 의 커밋 해시 · `range` 의 끝 커밋
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Scope {
    Branch {
        branch: String,
    },
    Commit {
        commit: String,
        branch: Option<String>,
    },
    Wip {
        worktree: String,
    },
    /// `worktree` 는 [문서로 열기]의 자리(있으면).
    Range {
        base: String,
        tip: String,
        worktree: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffGroup {
    #[default]
    Committed,
    Uncommitted,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffEntry {
    /// 이름 바뀜이면 새 이름
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: Option<u32>,
    pub deleted: Option<u32>,
    pub binary: bool,
    pub group: DiffGroup,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffCommit {
    pub hash: String,
    pub subject: String,
    pub time: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffFiles {
    pub main: Option<String>,
    pub branch: Option<String>,
    pub base: Option<String>,
    pub tip: Option<String>,
    pub worktree: Option<String>,
    pub head: Option<String>,
    /// 병합 커밋 — 파일 목록을 싣지 않는다
    pub merge: bool,
    pub root: bool,
    pub files: Vec<DiffEntry>,
    pub commits: Vec<DiffCommit>,
    pub commits_truncated: bool,
    pub wip_count: Option<u32>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    #[default]
    Ctx,
    Add,
    Del,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
    pub no_newline: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub section: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub truncated: bool,
    pub added: u32,
    pub deleted: u32,
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 범위 검사
// ---------------------------------------------------------------------------

fn bad_branch(b: &str) -> String {
    tr!(ko: "브랜치 이름이 올바르지 않습니다: {b}", en: "The branch name is not valid: {b}")
}

/// 스크립트와 인자에 실리는 글자라 이것만 받는다.
pub(crate) fn valid_branch(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 255
        && !name.starts_with('-')
        && !name.contains("..")
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
}

pub(crate) fn valid_path(path: &str) -> bool {
    !path.trim().is_empty() && !path.chars().any(char::is_control)
}

pub(crate) fn check_scope(s: &DiffScope) -> Result<Scope, String> {
    let branch = match s.branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) if valid_branch(b) => Some(b.to_string()),
        Some(b) => return Err(bad_branch(b)),
        None => None,
    };
    match s.kind {
        ScopeKind::Branch => branch.map(|branch| Scope::Branch { branch }).ok_or_else(
            || tr!(ko: "비교할 브랜치가 없습니다", en: "There is no branch to compare"),
        ),
        ScopeKind::Commit => {
            let c = s.commit.as_deref().unwrap_or("").trim();
            if !valid_commit(c) {
                return Err(
                    tr!(ko: "커밋 해시가 올바르지 않습니다", en: "The commit hash is not valid"),
                );
            }
            Ok(Scope::Commit {
                commit: c.to_string(),
                branch,
            })
        }
        ScopeKind::Wip => {
            let w = s.worktree.as_deref().unwrap_or("").trim();
            if !valid_path(w) {
                return Err(bad_worktree());
            }
            Ok(Scope::Wip {
                worktree: w.to_string(),
            })
        }
        ScopeKind::Range => {
            let b = s.base.as_deref().unwrap_or("").trim();
            let c = s.commit.as_deref().unwrap_or("").trim();
            if !valid_commit(b) || !valid_commit(c) {
                return Err(
                    tr!(ko: "커밋 해시가 올바르지 않습니다", en: "The commit hash is not valid"),
                );
            }
            let worktree = match s.worktree.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
                Some(w) if valid_path(w) => Some(w.to_string()),
                Some(_) => return Err(bad_worktree()),
                None => None,
            };
            Ok(Scope::Range {
                base: b.to_string(),
                tip: c.to_string(),
                worktree,
            })
        }
    }
}

fn bad_worktree() -> String {
    tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid")
}

fn bad_file() -> String {
    tr!(ko: "파일 경로가 올바르지 않습니다", en: "The file path is not valid")
}

fn no_main() -> String {
    tr!(
        ko: "주 브랜치를 알 수 없습니다 — 주 폴더가 분리된 HEAD 입니다",
        en: "The main branch is unknown — the primary folder has a detached HEAD"
    )
}

fn no_branch(b: &str) -> String {
    tr!(ko: "브랜치를 찾지 못했습니다: {b}", en: "Could not find the branch: {b}")
}

fn no_base() -> String {
    tr!(
        ko: "주 브랜치와 공통 조상이 없습니다",
        en: "There is no common ancestor with the main branch"
    )
}

fn no_commit(h: &str) -> String {
    tr!(ko: "커밋을 찾지 못했습니다: {h}", en: "Could not find the commit: {h}")
}

fn no_worktree(p: &str) -> String {
    tr!(ko: "워크트리를 찾지 못했습니다: {p}", en: "Could not find the worktree: {p}")
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 파일 목록
// ---------------------------------------------------------------------------

pub(crate) fn entries_of(
    list: Vec<NameStatus>,
    counts: &HashMap<String, Option<(u32, u32)>>,
    untracked: &HashMap<String, u32>,
    group: DiffGroup,
) -> Vec<DiffEntry> {
    list.into_iter()
        .map(|f| {
            let num = counts.get(&f.path).copied();
            let binary = matches!(num, Some(None));
            let c = num
                .flatten()
                .or_else(|| untracked.get(&f.path).map(|n| (*n, 0)));
            DiffEntry {
                added: c.map(|x| x.0),
                deleted: c.map(|x| x.1),
                binary,
                status: f.status.to_string(),
                path: f.path,
                old_path: f.old_path,
                group,
            }
        })
        .collect()
}

pub(crate) fn join_groups(
    committed: Vec<DiffEntry>,
    uncommitted: Vec<DiffEntry>,
) -> (Vec<DiffEntry>, bool) {
    let mut all = committed;
    all.extend(uncommitted);
    let cut = all.len() > MAX_FILES;
    all.truncate(MAX_FILES);
    (all, cut)
}

/// `<H>\t<시각>\t<제목>`
pub(crate) fn parse_commit_line(line: &str) -> Option<DiffCommit> {
    let line = line.trim_matches(|c| c == '\n' || c == '\r');
    let mut f = line.splitn(3, '\t');
    let hash = f.next()?.trim().to_string();
    let time = f.next()?.trim().parse().ok()?;
    let subject = crate::commit_graph::clean_subject(f.next().unwrap_or(""));
    valid_commit(&hash).then_some(DiffCommit {
        hash,
        subject,
        time,
    })
}

/// 상한 + 1 까지 읽은 것을 자른다.
fn cap_commits(mut list: Vec<DiffCommit>) -> (Vec<DiffCommit>, bool) {
    let cut = list.len() > MAX_COMMITS;
    list.truncate(MAX_COMMITS);
    (list, cut)
}

// ---------------------------------------------------------------------------
// 순수 규칙 — unified diff 해석
// ---------------------------------------------------------------------------

pub(crate) fn clean_text(s: &str) -> String {
    let s = s.strip_suffix('\r').unwrap_or(s);
    let mut out = String::with_capacity(s.len().min(MAX_LINE_CHARS * 4));
    for (i, c) in s.chars().enumerate() {
        if i >= MAX_LINE_CHARS {
            out.push('…');
            break;
        }
        let n = c as u32;
        out.push(match n {
            0x09 => c,
            0x00..=0x1f => char::from_u32(0x2400 + n).unwrap_or('\u{FFFD}'),
            0x7f => '\u{2421}',
            0x80..=0x9f => '\u{FFFD}',
            _ => c,
        });
    }
    out
}

/// `@@ -a[,b] +c[,d] @@ 맥락`
pub(crate) fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (ranges, section) = rest.split_once(" @@")?;
    let (old, new) = ranges.split_once(" +")?;
    let range = |s: &str| -> Option<(u32, u32)> {
        match s.split_once(',') {
            Some((a, b)) => Some((a.parse().ok()?, b.parse().ok()?)),
            None => Some((s.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old)?;
    let (new_start, new_lines) = range(new)?;
    Some(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        section: clean_text(section.trim()),
        lines: Vec::new(),
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Parsed {
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub truncated: bool,
}

/// **첫 파일 하나만** 읽는다. `cut` = 날 글자가 상한에서 잘렸다(마지막 반쪽 줄은 버린다).
pub(crate) fn parse_unified(raw: &[u8], cut: bool) -> Parsed {
    let text = String::from_utf8_lossy(raw);
    let mut segs: Vec<&str> = text.split('\n').collect();
    if segs.last().is_some_and(|l| l.is_empty() || cut) {
        segs.pop();
    }
    let mut out = Parsed {
        truncated: cut,
        ..Default::default()
    };
    let mut seen_file = false;
    let mut cur: Option<DiffHunk> = None;
    let (mut o, mut n) = (0u32, 0u32);
    let mut count = 0usize;
    for line in segs {
        if line.starts_with("diff --git ") || line.starts_with("diff --cc ") {
            if seen_file {
                break;
            }
            seen_file = true;
            continue;
        }
        if line.starts_with("@@ -") {
            if let Some(h) = parse_hunk_header(line) {
                if let Some(done) = cur.take() {
                    out.hunks.push(done);
                }
                o = h.old_start;
                n = h.new_start;
                cur = Some(h);
                continue;
            }
        }
        let Some(h) = cur.as_mut() else {
            if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                out.binary = true;
            }
            continue;
        };
        let (kind, body) = match line.as_bytes().first() {
            Some(b' ') => (LineKind::Ctx, &line[1..]),
            Some(b'+') => (LineKind::Add, &line[1..]),
            Some(b'-') => (LineKind::Del, &line[1..]),
            Some(b'\\') => {
                if let Some(last) = h.lines.last_mut() {
                    last.no_newline = true;
                }
                continue;
            }
            // 맥락 빈 줄을 공백 없이 내는 도구가 있다
            None => (LineKind::Ctx, ""),
            _ => continue,
        };
        if count >= MAX_DIFF_LINES {
            out.truncated = true;
            break;
        }
        count += 1;
        let (old_no, new_no) = match kind {
            LineKind::Ctx => {
                let r = (Some(o), Some(n));
                o = o.saturating_add(1);
                n = n.saturating_add(1);
                r
            }
            LineKind::Add => {
                let r = (None, Some(n));
                n = n.saturating_add(1);
                r
            }
            LineKind::Del => {
                let r = (Some(o), None);
                o = o.saturating_add(1);
                r
            }
        };
        h.lines.push(DiffLine {
            kind,
            old_no,
            new_no,
            text: clean_text(body),
            no_newline: false,
        });
    }
    if let Some(done) = cur.take() {
        out.hunks.push(done);
    }
    out
}

pub(crate) fn file_of(path: &str, old_path: Option<&str>, parsed: Parsed) -> DiffFile {
    let mut added = 0u32;
    let mut deleted = 0u32;
    for l in parsed.hunks.iter().flat_map(|h| h.lines.iter()) {
        match l.kind {
            LineKind::Add => added = added.saturating_add(1),
            LineKind::Del => deleted = deleted.saturating_add(1),
            LineKind::Ctx => {}
        }
    }
    DiffFile {
        path: path.to_string(),
        old_path: old_path.map(str::to_string),
        binary: parsed.binary,
        hunks: parsed.hunks,
        truncated: parsed.truncated,
        added,
        deleted,
    }
}

// ---------------------------------------------------------------------------
// 로컬 — git 한 번(상한 있는 읽기)
// ---------------------------------------------------------------------------

pub(crate) struct Capped {
    /// 죽였으면 `None`
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub cut: bool,
    pub stderr: String,
}

/// `stop` 이 없으면 끝까지 읽어 버린다(자식이 파이프에 막히지 않게). 있으면 상한을 넘은 즉시 그만 읽는다 — 부르는 쪽이 자식을 죽인다.
fn pump(mut pipe: impl Read, keep: usize, stop: Option<Arc<AtomicBool>>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match pipe.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(k) => {
                let room = keep.saturating_sub(out.len());
                out.extend_from_slice(&buf[..k.min(room)]);
                if k > room {
                    if let Some(flag) = &stop {
                        flag.store(true, Ordering::SeqCst);
                        break;
                    }
                }
            }
        }
    }
    out
}

/// 블로킹이다.
pub(crate) fn run_git_capped(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    max: usize,
) -> Result<Capped, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|e| tr!(ko: "git 을 실행하지 못했습니다: {e}", en: "Could not run git: {e}"))?;
    let over = Arc::new(AtomicBool::new(false));
    let out_t = child.stdout.take().map(|p| {
        let flag = over.clone();
        std::thread::spawn(move || pump(p, max, Some(flag)))
    });
    let err_t = child
        .stderr
        .take()
        .map(|p| std::thread::spawn(move || pump(p, STDERR_KEEP, None)));
    let deadline = Instant::now() + timeout;
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code(),
            Ok(None) if over.load(Ordering::SeqCst) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(tr!(
                    ko: "git 이 {secs}초 안에 끝나지 않아 멈췄습니다",
                    en: "git did not finish within {secs} seconds and was stopped",
                    secs = timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(e) => {
                let _ = child.kill();
                return Err(
                    tr!(ko: "git 을 기다리지 못했습니다: {e}", en: "Could not wait for git: {e}"),
                );
            }
        }
    };
    let stdout = out_t.and_then(|t| t.join().ok()).unwrap_or_default();
    let stderr = err_t.and_then(|t| t.join().ok()).unwrap_or_default();
    Ok(Capped {
        code,
        cut: over.load(Ordering::SeqCst),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// 잘렸으면 종료 코드는 보지 않는다 — 자식을 죽였다.
fn diff_once(dir: &Path, args: &[&str], ok_codes: &[i32]) -> Result<Parsed, String> {
    let run = run_git_capped(dir, args, DIFF_TIMEOUT, MAX_DIFF_BYTES)?;
    if !run.cut && !run.code.is_some_and(|c| ok_codes.contains(&c)) {
        let msg = run.stderr.trim();
        return Err(if msg.is_empty() {
            tr!(ko: "git 이 실패했습니다", en: "git failed")
        } else {
            msg.lines().next().unwrap_or(msg).to_string()
        });
    }
    Ok(parse_unified(&run.stdout, run.cut))
}

fn worktrees(repo: &Path) -> Result<Vec<WorktreeInfo>, String> {
    let run = run_git(repo, &["worktree", "list", "--porcelain"], LOCAL_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    Ok(parse_porcelain(&run.stdout))
}

pub(crate) fn worktree_of_branch<'a>(
    list: &'a [WorktreeInfo],
    branch: &str,
) -> Option<&'a WorktreeInfo> {
    list.iter()
        .find(|w| !w.bare && w.branch.as_deref() == Some(branch))
}

/// `commit_graph` 의 커밋 안 한 파일과 같은 판정이어야 한다.
pub(crate) fn worktree_at<'a>(list: &'a [WorktreeInfo], path: &str) -> Option<&'a WorktreeInfo> {
    let want = comparable(path);
    let want_key = comparable(&path_key(path));
    list.iter().find(|w| {
        !w.bare && (comparable(&w.path) == want || comparable(&path_key(&w.path)) == want_key)
    })
}

fn rev(repo: &Path, r: &str) -> Option<String> {
    git_ok(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{r}^{{commit}}"),
        ],
    )
    .map(|s| s.trim().to_string())
    .filter(|h| valid_commit(h))
}

fn branch_commits(
    repo: &Path,
    main: Option<&str>,
    branch: Option<&str>,
) -> (Vec<DiffCommit>, bool) {
    let (Some(m), Some(b)) = (main, branch) else {
        return (Vec::new(), false);
    };
    let n = (MAX_COMMITS + 1).to_string();
    let list = git_ok(
        repo,
        &[
            "--no-optional-locks",
            "log",
            "-n",
            &n,
            "--format=%H%x09%ct%x09%s",
            &format!("refs/heads/{m}..refs/heads/{b}"),
            "--",
        ],
    )
    .map(|s| s.lines().filter_map(parse_commit_line).collect())
    .unwrap_or_default();
    cap_commits(list)
}

fn uncommitted_entries(dir: &Path) -> Vec<DiffEntry> {
    if !dir.is_dir() {
        return Vec::new();
    }
    let (list, num, untracked) = uncommitted_parts(dir);
    entries_of(list, &num, &untracked, DiffGroup::Uncommitted)
}

fn committed_entries(repo: &Path, base: &str, tip: &str) -> Vec<DiffEntry> {
    let d = |kind: &str| {
        git_ok(
            repo,
            &[
                "--no-optional-locks",
                "diff",
                "--no-ext-diff",
                "--no-color",
                "-M",
                kind,
                "-z",
                base,
                tip,
                "--",
            ],
        )
        .unwrap_or_default()
    };
    let ns = d("--name-status");
    let num = d("--numstat");
    entries_of(
        parse_name_status(&mut ns.split('\0')),
        &parse_numstat(&mut num.split('\0')),
        &HashMap::new(),
        DiffGroup::Committed,
    )
}

fn commit_entries(repo: &Path, full: &str) -> Vec<DiffEntry> {
    let d = |kind: &str| {
        git_ok(
            repo,
            &[
                "--no-optional-locks",
                "diff-tree",
                "-r",
                "-M",
                "--root",
                "--no-commit-id",
                kind,
                "-z",
                full,
            ],
        )
        .unwrap_or_default()
    };
    let ns = d("--name-status");
    let num = d("--numstat");
    entries_of(
        parse_name_status(&mut ns.split('\0')),
        &parse_numstat(&mut num.split('\0')),
        &HashMap::new(),
        DiffGroup::Committed,
    )
}

fn wip_count(dir: Option<&Path>) -> Option<u32> {
    let dir = dir.filter(|d| d.is_dir())?;
    let st = git_ok(
        dir,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    Some(u32::try_from(parse_status_z(&mut st.split('\0')).len()).unwrap_or(u32::MAX))
}

fn parents_of(repo: &Path, full: &str) -> Vec<String> {
    git_ok(repo, &["rev-list", "--parents", "-n", "1", full])
        .map(|s| {
            s.split_whitespace()
                .skip(1)
                .filter(|h| valid_commit(h))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// (main, merge-base, 끝)
fn branch_ends(
    repo: &Path,
    list: &[WorktreeInfo],
    branch: &str,
) -> Result<(String, String, String), String> {
    let main = main_of(list).ok_or_else(no_main)?;
    let tip = rev(repo, &format!("refs/heads/{branch}")).ok_or_else(|| no_branch(branch))?;
    let base = git_ok(repo, &["merge-base", &format!("refs/heads/{main}"), &tip])
        .map(|s| s.trim().to_string())
        .filter(|h| valid_commit(h))
        .ok_or_else(no_base)?;
    Ok((main, base, tip))
}

fn files_blocking(repo: &Path, scope: &Scope) -> Result<DiffFiles, String> {
    let list = worktrees(repo)?;
    let main = main_of(&list);
    match scope {
        Scope::Branch { branch } => {
            let (main, base, tip) = branch_ends(repo, &list, branch)?;
            let wt = worktree_of_branch(&list, branch);
            let unc = wt
                .map(|w| uncommitted_entries(&PathBuf::from(&w.path)))
                .unwrap_or_default();
            let wip = wt.map(|_| u32::try_from(unc.len()).unwrap_or(u32::MAX));
            let (files, truncated) = join_groups(committed_entries(repo, &base, &tip), unc);
            let (commits, commits_truncated) = branch_commits(repo, Some(&main), Some(branch));
            Ok(DiffFiles {
                main: Some(main),
                branch: Some(branch.clone()),
                base: Some(base),
                tip: Some(tip),
                worktree: wt.map(|w| w.path.clone()),
                head: wt.and_then(|w| w.head.clone()),
                files,
                commits,
                commits_truncated,
                wip_count: wip,
                truncated,
                ..Default::default()
            })
        }
        Scope::Commit { commit, branch } => {
            let full = rev(repo, commit).ok_or_else(|| no_commit(commit))?;
            let parents = parents_of(repo, &full);
            let wt = branch.as_deref().and_then(|b| worktree_of_branch(&list, b));
            let (commits, commits_truncated) =
                branch_commits(repo, main.as_deref(), branch.as_deref());
            let mut out = DiffFiles {
                main: main.clone(),
                branch: branch.clone(),
                base: parents.first().cloned(),
                tip: Some(full.clone()),
                worktree: wt.map(|w| w.path.clone()),
                merge: parents.len() >= 2,
                root: parents.is_empty(),
                commits,
                commits_truncated,
                wip_count: wip_count(wt.map(|w| Path::new(&w.path))),
                ..Default::default()
            };
            if !out.merge {
                let (files, truncated) = join_groups(commit_entries(repo, &full), Vec::new());
                out.files = files;
                out.truncated = truncated;
            }
            Ok(out)
        }
        Scope::Wip { worktree } => {
            let w = worktree_at(&list, worktree).ok_or_else(|| no_worktree(worktree))?;
            let unc = uncommitted_entries(&PathBuf::from(&w.path));
            let count = u32::try_from(unc.len()).unwrap_or(u32::MAX);
            let (files, truncated) = join_groups(Vec::new(), unc);
            let (commits, commits_truncated) =
                branch_commits(repo, main.as_deref(), w.branch.as_deref());
            Ok(DiffFiles {
                main,
                branch: w.branch.clone(),
                worktree: Some(w.path.clone()),
                head: w.head.clone(),
                tip: w.head.clone(),
                files,
                commits,
                commits_truncated,
                wip_count: Some(count),
                truncated,
                ..Default::default()
            })
        }
        Scope::Range { base, tip, worktree } => {
            let b = rev(repo, base).ok_or_else(|| no_commit(base))?;
            let t = rev(repo, tip).ok_or_else(|| no_commit(tip))?;
            let wt = worktree.as_deref().and_then(|w| worktree_at(&list, w));
            let (files, truncated) = join_groups(committed_entries(repo, &b, &t), Vec::new());
            Ok(DiffFiles {
                main,
                branch: wt.and_then(|w| w.branch.clone()),
                base: Some(b),
                tip: Some(t),
                worktree: wt.map(|w| w.path.clone()),
                head: wt.and_then(|w| w.head.clone()),
                files,
                truncated,
                ..Default::default()
            })
        }
    }
}

/// 옛 이름도 싣는다 — 이름 바뀜 판정에 둘 다 있어야 한다.
fn path_args<'a>(path: &'a str, old: Option<&'a str>) -> Vec<&'a str> {
    let mut v = Vec::with_capacity(2);
    if let Some(o) = old.filter(|o| *o != path) {
        v.push(o);
    }
    v.push(path);
    v
}

/// 앞 둘은 `--no-index` 도 쓴다 — 순서를 바꾸지 않는다.
const DIFF_FLAGS: [&str; 4] = ["--no-color", "--no-ext-diff", "-M", "-U3"];

fn diff_flags() -> &'static [&'static str] {
    &DIFF_FLAGS
}

fn uncommitted_file(dir: &Path, path: &str, old: Option<&str>) -> Result<Parsed, String> {
    let tracked = git_ok(dir, &["--literal-pathspecs", "ls-files", "-z", "--", path])
        .is_some_and(|s| !s.trim_matches('\0').is_empty());
    let has_head = git_ok(dir, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_some();
    if tracked && has_head {
        let mut args = vec!["--literal-pathspecs", "--no-optional-locks", "diff"];
        args.extend_from_slice(diff_flags());
        args.extend(["HEAD", "--"]);
        args.extend(path_args(path, old));
        return diff_once(dir, &args, &[0, 1]);
    }
    // 추적 안 하는 새 파일 — 배지와 같은 규칙(보통 파일 · 상한 이하만)
    let file = dir.join(path);
    let ok = std::fs::symlink_metadata(&file)
        .map(|m| m.is_file() && m.len() <= UNTRACKED_MAX_BYTES)
        .unwrap_or(false);
    if !ok {
        return Ok(Parsed {
            truncated: true,
            ..Default::default()
        });
    }
    let mut args = vec!["diff", "--no-index"];
    args.extend_from_slice(&diff_flags()[..2]);
    args.extend(["-U3", "--", "/dev/null", path]);
    diff_once(dir, &args, &[0, 1])
}

fn file_blocking(
    repo: &Path,
    scope: &Scope,
    path: &str,
    old: Option<&str>,
    group: DiffGroup,
) -> Result<DiffFile, String> {
    let list = worktrees(repo)?;
    let parsed = match (scope, group) {
        (Scope::Branch { branch }, DiffGroup::Committed) => {
            let (_, base, tip) = branch_ends(repo, &list, branch)?;
            let mut args = vec!["--literal-pathspecs", "--no-optional-locks", "diff"];
            args.extend_from_slice(diff_flags());
            args.extend([base.as_str(), tip.as_str(), "--"]);
            args.extend(path_args(path, old));
            diff_once(repo, &args, &[0, 1])?
        }
        (Scope::Branch { branch }, DiffGroup::Uncommitted) => {
            let w = worktree_of_branch(&list, branch).ok_or_else(|| no_worktree(branch))?;
            uncommitted_file(&PathBuf::from(&w.path), path, old)?
        }
        (Scope::Commit { commit, .. }, _) => {
            let full = rev(repo, commit).ok_or_else(|| no_commit(commit))?;
            let mut args = vec![
                "--literal-pathspecs",
                "--no-optional-locks",
                "diff-tree",
                "-p",
                "-r",
                "--root",
                "--no-commit-id",
            ];
            args.extend_from_slice(diff_flags());
            args.extend([full.as_str(), "--"]);
            args.extend(path_args(path, old));
            diff_once(repo, &args, &[0])?
        }
        (Scope::Wip { worktree }, _) => {
            let w = worktree_at(&list, worktree).ok_or_else(|| no_worktree(worktree))?;
            uncommitted_file(&PathBuf::from(&w.path), path, old)?
        }
        (Scope::Range { base, tip, .. }, _) => {
            let b = rev(repo, base).ok_or_else(|| no_commit(base))?;
            let t = rev(repo, tip).ok_or_else(|| no_commit(tip))?;
            let mut args = vec!["--literal-pathspecs", "--no-optional-locks", "diff"];
            args.extend_from_slice(diff_flags());
            args.extend([b.as_str(), t.as_str(), "--"]);
            args.extend(path_args(path, old));
            diff_once(repo, &args, &[0, 1])?
        }
    };
    Ok(file_of(path, old, parsed))
}

fn checked_file(path: &str, old: Option<&str>) -> Result<(String, Option<String>), String> {
    let p = path.trim();
    if !valid_path(p) {
        return Err(bad_file());
    }
    let o = old.map(str::trim).filter(|o| !o.is_empty());
    if o.is_some_and(|o| !valid_path(o)) {
        return Err(bad_file());
    }
    Ok((p.to_string(), o.map(str::to_string)))
}

#[tauri::command]
pub async fn git_diff_files(repo: String, scope: DiffScope) -> Result<DiffFiles, String> {
    let repo = repo_of(&repo)?;
    let scope = check_scope(&scope)?;
    crate::worktree::blocking(move || files_blocking(&repo, &scope)).await
}

#[tauri::command]
pub async fn git_diff_file(
    repo: String,
    scope: DiffScope,
    path: String,
    old_path: Option<String>,
    group: DiffGroup,
) -> Result<DiffFile, String> {
    let repo = repo_of(&repo)?;
    let scope = check_scope(&scope)?;
    let (path, old) = checked_file(&path, old_path.as_deref())?;
    crate::worktree::blocking(move || file_blocking(&repo, &scope, &path, old.as_deref(), group))
        .await
}

// ---------------------------------------------------------------------------
// 원격 — exec 한 번
// ---------------------------------------------------------------------------

/// `unc` 는 `commit_graph::remote_wip_command` 와 같은 모양이다.
fn remote_prelude(repo: &str) -> String {
    format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
R={repo}
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || {{ echo aynx-fail=notrepo; exit 0; }}
main=$(git -C "$R" worktree list --porcelain 2>/dev/null | sed -n '/^$/q;s/^branch refs\/heads\///p')
wtof() {{ git -C "$R" worktree list --porcelain 2>/dev/null | awk -v b="branch refs/heads/$1" '/^worktree /{{ p = substr($0, 10) }} $0 == b {{ print p; exit }}'; }}
commits() {{ [ -n "$main" ] && [ -n "$1" ] || return 0; printf 'commits\0'; git -C "$R" --no-optional-locks log -n {commits_n} --format='%H%x09%ct%x09%s%x00' "refs/heads/$main..refs/heads/$1" -- 2>/dev/null; printf 'aynx-end\0'; }}
unc() {{
  w=$1
  printf 'ust\0'; git -C "$w" --no-optional-locks status --porcelain=v1 -z --untracked-files=all 2>/dev/null; printf 'aynx-end\0'
  if git -C "$w" rev-parse -q --verify HEAD >/dev/null 2>&1; then printf 'unum\0'; git -C "$w" --no-optional-locks diff --no-ext-diff --numstat -z -M HEAD -- 2>/dev/null; printf 'aynx-end\0'; fi
  printf 'ulines\0'
  git -C "$w" --no-optional-locks -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null | {{ n=0; while IFS= read -r f; do case $f in '"'*) continue;; esac; n=$((n+1)); [ "$n" -gt {max_files} ] && break; p="$w/$f"; [ -f "$p" ] && [ ! -h "$p" ] || continue; z=$(wc -c < "$p" 2>/dev/null) || continue; [ $z -le {max_bytes} ] || continue; printf '%s\t%s\0' "$(git -C "$w" diff --no-ext-diff --no-index --numstat -- /dev/null "$f" 2>/dev/null | cut -f1)" "$f"; done; }}
  printf 'aynx-end\0'
}}
"#,
        repo = crate::ssh::sh_path(repo),
        commits_n = MAX_COMMITS + 1,
        max_files = UNTRACKED_MAX_FILES,
        max_bytes = UNTRACKED_MAX_BYTES,
    )
}

fn remote_branch_ends(branch: &str) -> String {
    format!(
        r#"B={b}
[ -n "$main" ] || {{ echo aynx-fail=nomain; exit 0; }}
tip=$(git -C "$R" rev-parse -q --verify "refs/heads/$B^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nobranch; exit 0; }}
base=$(git -C "$R" merge-base "refs/heads/$main" "$tip" 2>/dev/null) || {{ echo aynx-fail=nobase; exit 0; }}
"#,
        b = crate::ssh::sh_quote(branch)
    )
}

/// 출력의 낱말 이름은 [`parse_remote_files`] 와 짝이다 — 한쪽만 바꾸면 칸이 조용히 빈다.
pub(crate) fn remote_files_command(repo: &str, scope: &Scope) -> Option<String> {
    let r = repo.trim();
    if !valid_path(r) {
        return None;
    }
    let body = match scope {
        Scope::Branch { branch } => {
            if !valid_branch(branch) {
                return None;
            }
            format!(
                r#"{ends}w=$(wtof "$B")
printf 'aynx-dfiles\0main\0%s\0branch\0%s\0base\0%s\0tip\0%s\0wt\0%s\0' "$main" "$B" "$base" "$tip" "$w"
if [ -n "$w" ]; then printf 'head\0%s\0' "$(git -C "$w" rev-parse -q --verify HEAD 2>/dev/null)"; fi
printf 'cns\0'; git -C "$R" --no-optional-locks diff --no-ext-diff --no-color -M --name-status -z "$base" "$tip" -- 2>/dev/null; printf 'aynx-end\0'
printf 'cnum\0'; git -C "$R" --no-optional-locks diff --no-ext-diff --no-color -M --numstat -z "$base" "$tip" -- 2>/dev/null; printf 'aynx-end\0'
[ -z "$w" ] || unc "$w"
commits "$B"
"#,
                ends = remote_branch_ends(branch)
            )
        }
        Scope::Commit { commit, branch } => {
            if !valid_commit(commit) || branch.as_deref().is_some_and(|b| !valid_branch(b)) {
                return None;
            }
            format!(
                r#"H={h}
B={b}
f=$(git -C "$R" rev-parse -q --verify "$H^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
set -- $(git -C "$R" rev-list --parents -n 1 "$f" 2>/dev/null)
printf 'aynx-dfiles\0main\0%s\0branch\0%s\0tip\0%s\0parents\0%s\0base\0%s\0' "$main" "$B" "$f" "$(($# - 1))" "${{2:-}}"
if [ $# -lt 3 ]; then
  printf 'cns\0'; git -C "$R" --no-optional-locks diff-tree -r -M --root --no-commit-id --name-status -z "$f" 2>/dev/null; printf 'aynx-end\0'
  printf 'cnum\0'; git -C "$R" --no-optional-locks diff-tree -r -M --root --no-commit-id --numstat -z "$f" 2>/dev/null; printf 'aynx-end\0'
fi
if [ -n "$B" ]; then
  w=$(wtof "$B")
  printf 'wt\0%s\0' "$w"
  if [ -n "$w" ]; then printf 'wst\0'; git -C "$w" --no-optional-locks status --porcelain=v1 -z --untracked-files=all 2>/dev/null; printf 'aynx-end\0'; fi
  commits "$B"
fi
"#,
                h = crate::ssh::sh_quote(commit),
                b = crate::ssh::sh_quote(branch.as_deref().unwrap_or("")),
            )
        }
        Scope::Wip { worktree } => {
            if !valid_path(worktree) {
                return None;
            }
            format!(
                r#"w={w}
git -C "$R" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | grep -Fxq -- "$w" || {{ echo aynx-fail=nowt; exit 0; }}
b=$(git -C "$w" symbolic-ref -q --short HEAD 2>/dev/null)
printf 'aynx-dfiles\0main\0%s\0branch\0%s\0wt\0%s\0head\0%s\0' "$main" "$b" "$w" "$(git -C "$w" rev-parse -q --verify HEAD 2>/dev/null)"
unc "$w"
commits "$b"
"#,
                w = crate::ssh::sh_quote(worktree.trim())
            )
        }
        Scope::Range { base, tip, .. } => {
            if !valid_commit(base) || !valid_commit(tip) {
                return None;
            }
            format!(
                r#"b0={b}
t0={t}
base=$(git -C "$R" rev-parse -q --verify "$b0^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
tip=$(git -C "$R" rev-parse -q --verify "$t0^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
printf 'aynx-dfiles\0main\0%s\0base\0%s\0tip\0%s\0' "$main" "$base" "$tip"
printf 'cns\0'; git -C "$R" --no-optional-locks diff --no-ext-diff --no-color -M --name-status -z "$base" "$tip" -- 2>/dev/null; printf 'aynx-end\0'
printf 'cnum\0'; git -C "$R" --no-optional-locks diff --no-ext-diff --no-color -M --numstat -z "$base" "$tip" -- 2>/dev/null; printf 'aynx-end\0'
"#,
                b = crate::ssh::sh_quote(base),
                t = crate::ssh::sh_quote(tip),
            )
        }
    };
    let script = format!("{}{}", remote_prelude(r), body);
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

fn remote_nogit() -> String {
    tr!(ko: "원격에 git 이 없습니다", en: "git is not installed on the remote")
}

fn remote_notrepo() -> String {
    tr!(ko: "git 저장소가 아닙니다", en: "Not a git repository")
}

fn remote_unreadable() -> String {
    tr!(ko: "원격 git 의 답을 읽지 못했습니다", en: "Could not read the remote git's answer")
}

fn remote_fail(stdout: &str, scope: &Scope) -> Option<String> {
    let line = stdout
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .find_map(|l| l.strip_prefix("aynx-fail="))?;
    Some(match line {
        "nogit" => remote_nogit(),
        "notrepo" => remote_notrepo(),
        "nomain" => no_main(),
        "nobase" => no_base(),
        "nobranch" => match scope {
            Scope::Branch { branch } => no_branch(branch),
            _ => remote_unreadable(),
        },
        "nocommit" => match scope {
            Scope::Commit { commit, .. } => no_commit(commit),
            Scope::Range { tip, .. } => no_commit(tip),
            _ => remote_unreadable(),
        },
        "nowt" => match scope {
            Scope::Wip { worktree } => no_worktree(worktree),
            Scope::Branch { branch } => no_worktree(branch),
            _ => remote_unreadable(),
        },
        "skip" | "big" => return None,
        _ => remote_unreadable(),
    })
}

fn some_text(v: Option<&str>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub(crate) fn parse_remote_files(stdout: &str, scope: &Scope) -> Result<DiffFiles, String> {
    if let Some(e) = remote_fail(stdout, scope) {
        return Err(e);
    }
    let Some(at) = stdout.find(FILES_MARK) else {
        return Err(remote_unreadable());
    };
    let mut it = stdout[at + FILES_MARK.len()..].split('\0');
    let mut out = DiffFiles::default();
    let (mut cns, mut cnum) = (Vec::new(), HashMap::new());
    let (mut ust, mut unum, mut ulines) = (None, HashMap::new(), HashMap::new());
    let mut parents: Option<u32> = None;
    let mut commits = Vec::new();
    let hash = |v: Option<&str>| some_text(v).filter(|h| valid_commit(h));
    while let Some(tok) = it.next() {
        match tok {
            "main" => out.main = some_text(it.next()),
            "branch" => out.branch = some_text(it.next()),
            "base" => out.base = hash(it.next()),
            "tip" => out.tip = hash(it.next()),
            "head" => out.head = hash(it.next()),
            "wt" => out.worktree = it.next().filter(|s| !s.is_empty()).map(str::to_string),
            "parents" => parents = it.next().and_then(|n| n.trim().parse().ok()),
            "cns" => cns = parse_name_status(&mut it),
            "cnum" => cnum = parse_numstat(&mut it),
            "ust" => ust = Some(parse_status_z(&mut it)),
            "unum" => unum = parse_numstat(&mut it),
            "ulines" => ulines = parse_untracked_lines(&mut it),
            "wst" => {
                out.wip_count =
                    Some(u32::try_from(parse_status_z(&mut it).len()).unwrap_or(u32::MAX))
            }
            "commits" => {
                for c in it.by_ref() {
                    if c == END {
                        break;
                    }
                    if let Some(c) = parse_commit_line(c) {
                        commits.push(c);
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(p) = parents {
        out.merge = p >= 2;
        out.root = p == 0;
    }
    if matches!(scope, Scope::Wip { .. }) {
        out.tip = out.head.clone();
    }
    let committed = if out.merge {
        Vec::new()
    } else {
        entries_of(cns, &cnum, &HashMap::new(), DiffGroup::Committed)
    };
    let uncommitted = match ust {
        Some(list) => {
            let e = entries_of(list, &unum, &ulines, DiffGroup::Uncommitted);
            out.wip_count = Some(u32::try_from(e.len()).unwrap_or(u32::MAX));
            e
        }
        None => Vec::new(),
    };
    let (files, truncated) = join_groups(committed, uncommitted);
    out.files = files;
    out.truncated = truncated;
    let (commits, cut) = cap_commits(commits);
    out.commits = commits;
    out.commits_truncated = cut;
    Ok(out)
}

/// `$w` · `$P` · `$O` 가 먼저 서 있어야 한다.
fn remote_uncommitted_diff() -> String {
    format!(
        r#"if [ -n "$(git -C "$w" --literal-pathspecs ls-files -- "$P" 2>/dev/null)" ] && git -C "$w" rev-parse -q --verify HEAD >/dev/null 2>&1; then
  echo aynx-diff
  eval "git -C \"\$w\" --literal-pathspecs --no-optional-locks diff --no-color --no-ext-diff -M -U3 HEAD -- $O \"\$P\"" 2>/dev/null
else
  f="$w/$P"
  [ -f "$f" ] && [ ! -h "$f" ] || {{ echo aynx-fail=skip; echo aynx-diff; exit 0; }}
  z=$(wc -c < "$f" 2>/dev/null) || z=0
  [ "$z" -le {max_bytes} ] || {{ echo aynx-fail=big; echo aynx-diff; exit 0; }}
  echo aynx-diff
  git -C "$w" diff --no-index --no-color --no-ext-diff -U3 -- /dev/null "$P" 2>/dev/null
fi
"#,
        max_bytes = UNTRACKED_MAX_BYTES
    )
}

/// 옛 이름은 `O` 에 **이미 인용된 낱말**로 싣고 `eval` 한 번으로 펼친다(빈 칸이면 낱말이 없다).
pub(crate) fn remote_file_command(
    repo: &str,
    scope: &Scope,
    path: &str,
    old: Option<&str>,
    group: DiffGroup,
) -> Option<String> {
    let r = repo.trim();
    if !valid_path(r) || !valid_path(path) || old.is_some_and(|o| !valid_path(o)) {
        return None;
    }
    let o = old
        .filter(|o| *o != path)
        .map(crate::ssh::sh_quote)
        .unwrap_or_default();
    let head = format!(
        "{prelude}P={p}\nO={o}\n",
        prelude = remote_prelude(r),
        p = crate::ssh::sh_quote(path),
        o = crate::ssh::sh_quote(&o),
    );
    let body = match (scope, group) {
        (Scope::Branch { branch }, DiffGroup::Committed) => {
            if !valid_branch(branch) {
                return None;
            }
            format!(
                r#"{ends}echo aynx-diff
eval "git -C \"\$R\" --literal-pathspecs --no-optional-locks diff --no-color --no-ext-diff -M -U3 \"\$base\" \"\$tip\" -- $O \"\$P\"" 2>/dev/null
"#,
                ends = remote_branch_ends(branch)
            )
        }
        (Scope::Branch { branch }, DiffGroup::Uncommitted) => {
            if !valid_branch(branch) {
                return None;
            }
            format!(
                "B={b}\nw=$(wtof \"$B\")\n[ -n \"$w\" ] || {{ echo aynx-fail=nowt; exit 0; }}\n{unc}",
                b = crate::ssh::sh_quote(branch),
                unc = remote_uncommitted_diff()
            )
        }
        (Scope::Commit { commit, .. }, _) => {
            if !valid_commit(commit) {
                return None;
            }
            format!(
                r#"H={h}
f=$(git -C "$R" rev-parse -q --verify "$H^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
echo aynx-diff
eval "git -C \"\$R\" --literal-pathspecs --no-optional-locks diff-tree -p -r --root --no-commit-id --no-color --no-ext-diff -M -U3 \"\$f\" -- $O \"\$P\"" 2>/dev/null
"#,
                h = crate::ssh::sh_quote(commit)
            )
        }
        (Scope::Wip { worktree }, _) => {
            if !valid_path(worktree) {
                return None;
            }
            format!(
                "w={w}\ngit -C \"$R\" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | grep -Fxq -- \"$w\" || {{ echo aynx-fail=nowt; exit 0; }}\n{unc}",
                w = crate::ssh::sh_quote(worktree.trim()),
                unc = remote_uncommitted_diff()
            )
        }
        (Scope::Range { base, tip, .. }, _) => {
            if !valid_commit(base) || !valid_commit(tip) {
                return None;
            }
            format!(
                r#"b0={b}
t0={t}
base=$(git -C "$R" rev-parse -q --verify "$b0^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
tip=$(git -C "$R" rev-parse -q --verify "$t0^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
echo aynx-diff
eval "git -C \"\$R\" --literal-pathspecs --no-optional-locks diff --no-color --no-ext-diff -M -U3 \"\$base\" \"\$tip\" -- $O \"\$P\"" 2>/dev/null
"#,
                b = crate::ssh::sh_quote(base),
                t = crate::ssh::sh_quote(tip),
            )
        }
    };
    Some(format!(
        "sh -c {}",
        crate::ssh::sh_quote(&format!("{head}{body}"))
    ))
}

pub(crate) fn parse_remote_file(
    stdout: &[u8],
    overflow: bool,
    scope: &Scope,
    path: &str,
    old: Option<&str>,
) -> Result<DiffFile, String> {
    let at = stdout.windows(DIFF_MARK.len()).position(|w| w == DIFF_MARK);
    let head = String::from_utf8_lossy(&stdout[..at.unwrap_or(stdout.len())]);
    if let Some(e) = remote_fail(&head, scope) {
        return Err(e);
    }
    let Some(at) = at else {
        return Err(remote_unreadable());
    };
    let skipped = head.lines().any(|l| {
        matches!(
            l.trim_end_matches('\r'),
            "aynx-fail=skip" | "aynx-fail=big"
        )
    });
    let mut parsed = parse_unified(&stdout[at + DIFF_MARK.len()..], overflow);
    if skipped {
        parsed.truncated = true;
    }
    Ok(file_of(path, old, parsed))
}

async fn exec_once(
    id: u32,
    command: String,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let out = crate::ssh::run_exec_bytes(handle, command, REMOTE_TIMEOUT, max_bytes).await;
    if let Some(e) = exec_failure(&out, REMOTE_TIMEOUT) {
        return Err(e);
    }
    Ok((out.stdout, out.overflow))
}

fn bad_project() -> String {
    tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid")
}

/// 이미 붙은 SSH 세션 `id` 를 빌린다 — 새 연결을 열지 않는다.
#[tauri::command]
pub async fn ssh_git_diff_files(
    id: u32,
    repo: String,
    scope: DiffScope,
) -> Result<DiffFiles, String> {
    let scope = check_scope(&scope)?;
    let command = remote_files_command(&repo, &scope).ok_or_else(bad_project)?;
    let (stdout, overflow) = exec_once(id, command, REMOTE_LIST_MAX_BYTES).await?;
    let mut files = parse_remote_files(&String::from_utf8_lossy(&stdout), &scope)?;
    files.truncated |= overflow;
    Ok(files)
}

#[tauri::command]
pub async fn ssh_git_diff_file(
    id: u32,
    repo: String,
    scope: DiffScope,
    path: String,
    old_path: Option<String>,
    group: DiffGroup,
) -> Result<DiffFile, String> {
    let scope = check_scope(&scope)?;
    let (path, old) = checked_file(&path, old_path.as_deref())?;
    let command =
        remote_file_command(&repo, &scope, &path, old.as_deref(), group).ok_or_else(bad_project)?;
    let (stdout, overflow) = exec_once(id, command, REMOTE_DIFF_MAX_BYTES).await?;
    parse_remote_file(&stdout, overflow, &scope, &path, old.as_deref())
}

#[cfg(test)]
mod tests;
