//! 커밋 그래프 — 브랜치 타일(`kind:"branches"`)을 "한 줄 = 커밋 하나" 로 그리는 재료(읽기 전용 · docs/log/2026-10-04-commit-graph.md).
//! 해석 규칙(참조 줄 · 주 브랜치 · `-z` 낱말 · 커밋 안 한 것)은 [`crate::branch_graph`] 의 것을 쓰고, 줄 배치는 프런트 `buildRows` 몫이다.
//!
//! git 에 쓰는 명령은 없다. `status` · `diff` · `ls-files` · `log` 는 `--no-optional-locks` — 에이전트가 같은 워크트리에서 git 을 쓰는
//! 중에 이 읽기가 `index.lock` 을 잡으면 그쪽 명령이 실패한다. `diff` 는 `--no-ext-diff`.
//!
//! ## 그래프에 넣는 것
//!
//! - 분리 HEAD 면 `main` 은 `None` 이고 주 줄 · 브랜치 · 접힘이 빈다(워크트리는 채운다).
//! - first-parent 줄 위에 없는 base 는 주 줄에 보충하지 않는다(프런트가 맨 아래에 붙인다). 보충으로 들어온 병합 커밋은 접지 않는다.
//! - merged = 앞선 커밋 0 이고 reflog 에 일한 자국이 있다(갓 만든 브랜치는 아니다), 또는 내용 기준 squash · rebase 병합(`crate::merge_detect`) —
//!   그때 커밋 덩어리는 비우고 맞은 main 커밋 아래 접힘으로 간다. 병합되고 워크트리도 없는 브랜치는 싣지 않는다.
//! - 커밋 표는 주 줄 → base → 접힘 → 브랜치 순으로 담고 [`MAX_COMMITS`] 를 넘으면 목록 꼬리를 자른다.
//!
//! 원격 그래프는 파일 경로를 서버 밖으로 꺼내지 않는다 — 줄 수는 서버 awk 가 합쳐 `aynx-n=` 한 줄로 보내고, 커밋 안 한 것도 수만 센다.
//! 경로는 사람이 커밋 · 워크트리를 골랐을 때 부르는 파일 명령 둘에서만 나온다.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::branch_graph::{
    common_dir, created_from, exec_failure, git_ok, main_of, merge_files, parse_left_right,
    parse_name_status, parse_numstat, parse_ref_line, parse_reflog_file_line, parse_status_z,
    parse_untracked_lines, repo_of, select_refs, uncommitted_parts, ChangedFile, NameStatus,
    RefLine, LOCAL_TIMEOUT, MAX_BRANCHES, REF_FORMAT,
};
use crate::i18n::tr;
use crate::merge_detect::{judge, ContentFacts, MergeKind};
use crate::worktree::{comparable, git_failure, parse_porcelain, path_key, run_git, WorktreeInfo};
use crate::worktree_changes::{valid_commit, UNTRACKED_MAX_BYTES, UNTRACKED_MAX_FILES};

pub(crate) const DEFAULT_MAIN_LIMIT: u32 = 12;
pub(crate) const MAX_MAIN_LIMIT: u32 = 500;
/// first-parent 줄을 읽는 상한 — 보충 · "더 있음" 판정은 이 안에서만.
pub(crate) const FIRST_PARENT_READ: usize = 5000;
pub(crate) const MAX_BRANCH_COMMITS: usize = 100;
pub(crate) const MAX_FOLD_COMMITS: usize = 50;
pub(crate) const MAX_COMMITS: usize = 3000;
pub(crate) const REFLOG_LINES: usize = 200;
const LOCAL_WORKERS: usize = 8;
/// Windows 명령 줄 길이 때문에 끊는다.
const NO_WALK_CHUNK: usize = 100;
const REMOTE_GRAPH_TIMEOUT: Duration = Duration::from_secs(45);
const REMOTE_FILES_TIMEOUT: Duration = Duration::from_secs(20);
const REMOTE_GRAPH_MAX_BYTES: usize = 4 * 1024 * 1024;
const REMOTE_FILES_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 커밋 머리줄의 표식 — `log --format` 이 줄 맨 앞에 붙인다(numstat 줄은 숫자나 `-` 로 시작하니 겹치지 않는다).
const COMMIT_TAG: &str = "aynx-c=";
/// 원격 awk 가 합친 커밋 줄 수 `aynx-n=<더한>\t<뺀>`.
const SUM_TAG: &str = "aynx-n=";
/// 로컬 · 원격이 같은 서식이다.
const LOG_FORMAT: &str = "--format=aynx-c=%H%x09%P%x09%ct%x09%s";

// ---------------------------------------------------------------------------
// 답의 모양 — 프런트가 snake_case 필드명 그대로 읽는다
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct MainRow {
    pub hash: String,
    /// 바로 위 줄과 사이에 건너뛴 first-parent 커밋 수(0 = 이어짐)
    pub skipped_before: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub subject: String,
    /// 커미터 시각(유닉스 초)
    pub time: i64,
    /// 첫 부모 대비 더한 줄 합(바이너리 빼고) — 병합 커밋은 `None`
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphBranch {
    pub name: String,
    pub head: String,
    pub base: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub commits: Vec<String>,
    pub commits_truncated: bool,
    pub merged: bool,
    /// 무엇으로 병합됐나 — `merged` 일 때만(`ancestry` · `squash` · `rebase`)
    pub merged_kind: Option<MergeKind>,
    pub created_from: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldKind {
    #[default]
    Merge,
    /// squash 병합 — `merge` 는 squash 커밋
    Squash,
    /// rebase 병합 — `merge` 는 브랜치 끝 커밋과 patch 가 같은 main 커밋
    Rebase,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct MergedFold {
    /// 주 줄 안의 병합 커밋(squash · rebase 는 맞은 main 커밋)
    pub merge: String,
    /// 제목 `Merge branch 'x'` 의 x(squash · rebase 는 브랜치 이름)
    pub name: Option<String>,
    /// `merge^1..merge^2` 최신부터(squash · rebase 는 `main..브랜치`)
    pub commits: Vec<String>,
    pub commits_truncated: bool,
    /// merge-base(merge^1, merge^2)(squash · rebase 는 브랜치의 merge-base)
    pub base: Option<String>,
    pub kind: FoldKind,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct Dirty {
    pub files: u32,
    pub added: u32,
    pub deleted: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphWorktree {
    /// git 이 적은 그대로
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub primary: bool,
    pub dirty: Option<Dirty>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct CommitGraph {
    pub main: Option<String>,
    pub main_head: Option<String>,
    pub main_line: Vec<MainRow>,
    pub main_more: bool,
    pub commits: Vec<GraphCommit>,
    pub branches: Vec<GraphBranch>,
    pub folds: Vec<MergedFold>,
    pub worktrees: Vec<GraphWorktree>,
    /// 브랜치 수 · 커밋 수 상한에 걸렸다(또는 원격 답이 상한을 넘었다)
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct CommitFiles {
    pub hash: String,
    /// 부모 2+ — 파일 목록을 싣지 않는다
    pub merge: bool,
    pub files: Vec<ChangedFile>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct WipFiles {
    pub path: String,
    pub head: Option<String>,
    pub files: Vec<ChangedFile>,
    pub truncated: bool,
}

// ---------------------------------------------------------------------------
// 재료 — 로컬(git 여러 번)과 원격(exec 한 번의 답)이 같은 모양으로 모은다
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BranchRaw {
    pub base: Option<String>,
    pub behind: Option<u32>,
    pub ahead: Option<u32>,
    /// `main..브랜치` 최신부터(상한 + 1 까지 — 넘침 판정용)
    pub commits: Vec<String>,
    pub reflog: Vec<String>,
    pub content: Option<ContentFacts>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct FoldRaw {
    pub base: Option<String>,
    pub commits: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RawCommitGraph {
    pub worktrees: Vec<WorktreeInfo>,
    pub refs: Vec<RefLine>,
    pub refs_capped: bool,
    pub first_parent: Vec<String>,
    pub first_parent_more: bool,
    pub pool: HashMap<String, GraphCommit>,
    pub branches: HashMap<String, BranchRaw>,
    pub folds: HashMap<String, FoldRaw>,
    /// 브랜치 이름 → (reflog 첫 줄의 시각, 글)
    pub made: HashMap<String, (i64, String)>,
    /// 워크트리 경로(git 글자) → 커밋 안 한 것
    pub dirty: HashMap<String, Dirty>,
    pub overflow: bool,
}

// ---------------------------------------------------------------------------
// 순수 규칙
// ---------------------------------------------------------------------------

pub(crate) fn clean_subject(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn parse_commit_header(v: &str) -> Option<GraphCommit> {
    let mut f = v.trim_end_matches('\r').splitn(4, '\t');
    let hash = f.next()?.trim().to_string();
    let parents = f
        .next()?
        .split_whitespace()
        .filter(|p| valid_commit(p))
        .map(str::to_string)
        .collect();
    let time = f.next()?.trim().parse().ok()?;
    let subject = clean_subject(f.next().unwrap_or(""));
    valid_commit(&hash).then_some(GraphCommit {
        hash,
        parents,
        subject,
        time,
        added: None,
        deleted: None,
    })
}

/// 로컬은 numstat 줄을 그대로, 원격은 awk 가 합친 `aynx-n=` 줄을 준다.
#[derive(Debug, Default)]
pub(crate) struct LogReader {
    pub done: Vec<GraphCommit>,
    cur: Option<GraphCommit>,
    added: u32,
    deleted: u32,
}

impl LogReader {
    pub(crate) fn line(&mut self, line: &str) -> Option<String> {
        let line = line.trim_end_matches('\r');
        if let Some(v) = line.strip_prefix(COMMIT_TAG) {
            self.flush();
            let c = parse_commit_header(v)?;
            let h = c.hash.clone();
            self.cur = Some(c);
            return Some(h);
        }
        self.cur.as_ref()?;
        if let Some(v) = line.strip_prefix(SUM_TAG) {
            if let Some((a, d)) = v.split_once('\t') {
                if let (Ok(a), Ok(d)) = (a.trim().parse(), d.trim().parse()) {
                    self.added = a;
                    self.deleted = d;
                }
            }
            return None;
        }
        let mut f = line.splitn(3, '\t');
        if let (Some(a), Some(d), Some(_)) = (f.next(), f.next(), f.next()) {
            if let (Ok(a), Ok(d)) = (a.parse::<u32>(), d.parse::<u32>()) {
                self.added = self.added.saturating_add(a);
                self.deleted = self.deleted.saturating_add(d);
            }
        }
        None
    }

    pub(crate) fn flush(&mut self) {
        if let Some(mut c) = self.cur.take() {
            if c.parents.len() < 2 {
                c.added = Some(self.added);
                c.deleted = Some(self.deleted);
            }
            self.done.push(c);
        }
        self.added = 0;
        self.deleted = 0;
    }
}

pub(crate) fn parse_commit_log(text: &str) -> Vec<GraphCommit> {
    let mut r = LogReader::default();
    for line in text.lines() {
        r.line(line);
    }
    r.flush();
    r.done
}

pub(crate) fn merge_name(subject: &str) -> Option<String> {
    let rest = subject.trim().strip_prefix("Merge branch '")?;
    let (name, tail) = rest.split_once('\'')?;
    (!name.is_empty() && (tail.is_empty() || tail.starts_with(" into "))).then(|| name.to_string())
}

/// 갓 만든 브랜치(`branch: Created from …` 뿐이거나 reflog 없음)는 병합이 아니다.
pub(crate) fn is_merged(is_main: bool, ahead: u32, reflog: &[String]) -> bool {
    const WORK: [&str; 5] = ["commit", "merge ", "cherry-pick", "rebase", "pull"];
    !is_main
        && ahead == 0
        && reflog
            .iter()
            .any(|l| WORK.iter().any(|w| l.trim_start().starts_with(w)))
}

pub(crate) fn dirty_of(
    list: &[NameStatus],
    counts: &HashMap<String, Option<(u32, u32)>>,
    untracked: &HashMap<String, u32>,
) -> Option<Dirty> {
    if list.is_empty() {
        return None;
    }
    let mut d = Dirty {
        files: u32::try_from(list.len()).unwrap_or(u32::MAX),
        ..Dirty::default()
    };
    for f in list {
        let c = counts
            .get(&f.path)
            .copied()
            .flatten()
            .or_else(|| untracked.get(&f.path).map(|n| (*n, 0)));
        if let Some((a, del)) = c {
            d.added = d.added.saturating_add(a);
            d.deleted = d.deleted.saturating_add(del);
        }
    }
    Some(d)
}

/// 앞 `limit` 개 + first-parent 줄 위에 있는 `bases`(보충). 둘째 값은 "더 있음".
pub(crate) fn build_main_line(
    first_parent: &[String],
    more: bool,
    limit: usize,
    bases: &[&str],
) -> (Vec<MainRow>, bool) {
    let pos: HashMap<&str, usize> = first_parent
        .iter()
        .enumerate()
        .rev()
        .map(|(i, h)| (h.as_str(), i))
        .collect();
    let mut idx: Vec<usize> = (0..limit.min(first_parent.len())).collect();
    idx.extend(bases.iter().filter_map(|b| pos.get(b).copied()));
    idx.sort_unstable();
    idx.dedup();
    let mut prev: Option<usize> = None;
    let rows = idx
        .iter()
        .map(|&i| {
            let skipped = prev.map_or(i, |p| i - p - 1);
            prev = Some(i);
            MainRow {
                hash: first_parent[i].clone(),
                skipped_before: u32::try_from(skipped).unwrap_or(u32::MAX),
            }
        })
        .collect();
    let main_more = match idx.last() {
        Some(&l) => l + 1 < first_parent.len() || more,
        None => more,
    };
    (rows, main_more)
}

struct Picker<'a> {
    pool: &'a HashMap<String, GraphCommit>,
    seen: HashSet<String>,
    order: Vec<String>,
    capped: bool,
}

impl Picker<'_> {
    /// 하나 — 표에 있거나 담았으면 참, 모르는 해시면 거짓(목록에서 뺀다), 상한이면 `None`.
    fn one(&mut self, h: &str) -> Option<bool> {
        if self.seen.contains(h) {
            return Some(true);
        }
        if !self.pool.contains_key(h) {
            return Some(false);
        }
        if self.order.len() >= MAX_COMMITS {
            self.capped = true;
            return None;
        }
        self.seen.insert(h.to_string());
        self.order.push(h.to_string());
        Some(true)
    }

    fn list(&mut self, list: &mut Vec<String>) -> bool {
        let mut kept = Vec::with_capacity(list.len());
        for h in list.iter() {
            match self.one(h) {
                Some(true) => kept.push(h.clone()),
                Some(false) => {}
                None => {
                    *list = kept;
                    return true;
                }
            }
        }
        *list = kept;
        false
    }
}

pub(crate) fn assemble(raw: &RawCommitGraph, main_limit: usize) -> CommitGraph {
    let main = main_of(&raw.worktrees);
    let worktrees: Vec<GraphWorktree> = raw
        .worktrees
        .iter()
        .enumerate()
        .filter(|(_, w)| !w.bare)
        .map(|(i, w)| GraphWorktree {
            path: w.path.clone(),
            branch: w.branch.clone(),
            head: w.head.clone(),
            primary: i == 0,
            dirty: raw.dirty.get(&w.path).copied(),
        })
        .collect();
    let Some(m) = main.clone() else {
        return CommitGraph {
            worktrees,
            truncated: raw.overflow,
            ..Default::default()
        };
    };
    let main_head = raw
        .refs
        .iter()
        .find(|r| r.name == m)
        .map(|r| r.head.clone())
        .or_else(|| raw.first_parent.first().cloned());

    let (refs, cut) = select_refs(&raw.refs, Some(&m));
    let checked: HashSet<&str> = worktrees
        .iter()
        .filter_map(|w| w.branch.as_deref())
        .collect();
    let mut branches: Vec<GraphBranch> = Vec::new();
    let mut content_folds: Vec<MergedFold> = Vec::new();
    for r in refs {
        if r.name == m {
            continue;
        }
        let Some(b) = raw.branches.get(&r.name) else {
            continue;
        };
        let ahead = b.ahead.unwrap_or(0);
        if ahead == 0 && !checked.contains(r.name.as_str()) {
            continue;
        }
        let content = if ahead > 0 {
            b.content.as_ref().and_then(judge)
        } else {
            None
        };
        if let Some(c) = &content {
            if let Some(at) = &c.commit {
                content_folds.push(MergedFold {
                    merge: at.clone(),
                    name: Some(r.name.clone()),
                    commits: b.commits.iter().take(MAX_FOLD_COMMITS).cloned().collect(),
                    commits_truncated: b.commits.len() > MAX_FOLD_COMMITS,
                    base: b.base.clone(),
                    kind: if c.kind == MergeKind::Rebase {
                        FoldKind::Rebase
                    } else {
                        FoldKind::Squash
                    },
                });
            }
            if !checked.contains(r.name.as_str()) {
                continue;
            }
        }
        let commits: Vec<String> = if ahead > 0 && content.is_none() {
            b.commits.iter().take(MAX_BRANCH_COMMITS).cloned().collect()
        } else {
            Vec::new()
        };
        let merged_kind = if is_merged(false, ahead, &b.reflog) {
            Some(MergeKind::Ancestry)
        } else {
            content.as_ref().map(|c| c.kind)
        };
        let (created_at, created_from) = raw
            .made
            .get(&r.name)
            .map(|(at, msg)| (Some(*at), created_from(msg)))
            .unwrap_or((None, None));
        branches.push(GraphBranch {
            base: b.base.clone(),
            ahead,
            behind: b.behind.unwrap_or(0),
            commits_truncated: !commits.is_empty() && b.commits.len() > MAX_BRANCH_COMMITS,
            commits,
            merged: merged_kind.is_some(),
            merged_kind,
            created_from,
            created_at,
            name: r.name,
            head: r.head,
        });
    }

    let window = &raw.first_parent[..main_limit.min(raw.first_parent.len())];
    let mut folds: Vec<MergedFold> = window
        .iter()
        .filter_map(|h| {
            let c = raw.pool.get(h)?;
            if c.parents.len() < 2 {
                return None;
            }
            let f = raw.folds.get(h);
            let all = f.map(|f| f.commits.as_slice()).unwrap_or(&[]);
            Some(MergedFold {
                merge: h.clone(),
                name: merge_name(&c.subject),
                commits: all.iter().take(MAX_FOLD_COMMITS).cloned().collect(),
                commits_truncated: all.len() > MAX_FOLD_COMMITS,
                base: f.and_then(|f| f.base.clone()),
                kind: FoldKind::Merge,
            })
        })
        .collect();
    for f in content_folds {
        if window.contains(&f.merge) && !folds.iter().any(|x| x.merge == f.merge) {
            folds.push(f);
        }
    }

    let bases: Vec<&str> = branches
        .iter()
        .filter_map(|b| b.base.as_deref())
        .chain(folds.iter().filter_map(|f| f.base.as_deref()))
        .collect();
    let (main_line, main_more) =
        build_main_line(&raw.first_parent, raw.first_parent_more, main_limit, &bases);

    let mut pick = Picker {
        pool: &raw.pool,
        seen: HashSet::new(),
        order: Vec::new(),
        capped: false,
    };
    for row in &main_line {
        pick.one(&row.hash);
    }
    let base_list: Vec<String> = bases.iter().map(|b| b.to_string()).collect();
    for b in &base_list {
        pick.one(b);
    }
    for f in &mut folds {
        if pick.list(&mut f.commits) {
            f.commits_truncated = true;
        }
    }
    for b in &mut branches {
        if pick.list(&mut b.commits) {
            b.commits_truncated = true;
        }
    }
    let capped = pick.capped;
    let commits = pick
        .order
        .iter()
        .filter_map(|h| raw.pool.get(h).cloned())
        .collect();

    CommitGraph {
        main,
        main_head,
        main_line,
        main_more,
        commits,
        branches,
        folds,
        worktrees,
        truncated: cut || raw.refs_capped || raw.overflow || capped,
    }
}

pub(crate) fn clamp_limit(limit: Option<u32>) -> usize {
    limit.unwrap_or(DEFAULT_MAIN_LIMIT).clamp(1, MAX_MAIN_LIMIT) as usize
}

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

/// 순서는 지킨다.
fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    if items.is_empty() {
        return Vec::new();
    }
    let chunk = items.len().div_ceil(LOCAL_WORKERS).max(1);
    let f = &f;
    std::thread::scope(|s| {
        let handles: Vec<_> = items
            .chunks(chunk)
            .map(|part| s.spawn(move || part.iter().map(f).collect::<Vec<_>>()))
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_default())
            .collect()
    })
}

enum Job {
    Branch(String),
    Fold {
        merge: String,
        p1: String,
        p2: String,
    },
    Dirty(String),
}

enum Done {
    Branch(String, BranchRaw, Vec<GraphCommit>),
    Fold(String, FoldRaw, Vec<GraphCommit>),
    Dirty(String, Option<Dirty>),
}

fn log_range(repo: &Path, n: usize, range: &str) -> Vec<GraphCommit> {
    let n = n.to_string();
    git_ok(
        repo,
        &[
            "--no-optional-locks",
            "log",
            "-n",
            &n,
            LOG_FORMAT,
            "--numstat",
            range,
            "--",
        ],
    )
    .map(|s| parse_commit_log(&s))
    .unwrap_or_default()
}

fn merge_base(repo: &Path, a: &str, b: &str) -> Option<String> {
    git_ok(repo, &["merge-base", a, b])
        .map(|s| s.trim().to_string())
        .filter(|h| valid_commit(h))
}

fn run_job(repo: &Path, mref: &str, job: &Job) -> Done {
    match job {
        Job::Branch(name) => {
            let b = format!("refs/heads/{name}");
            let lr = git_ok(
                repo,
                &[
                    "rev-list",
                    "--left-right",
                    "--count",
                    &format!("{mref}...{b}"),
                ],
            )
            .and_then(|s| parse_left_right(&s));
            let mut raw = BranchRaw {
                base: merge_base(repo, mref, &b),
                behind: lr.map(|x| x.0),
                ahead: lr.map(|x| x.1),
                ..Default::default()
            };
            let mut found = Vec::new();
            if raw.ahead.unwrap_or(0) > 0 {
                found = log_range(repo, MAX_BRANCH_COMMITS + 1, &format!("{mref}..{b}"));
                raw.commits = found.iter().map(|c| c.hash.clone()).collect();
                if raw.base.is_some() {
                    raw.content = crate::merge_detect::local_facts(repo, mref, &b);
                }
            } else {
                let n = REFLOG_LINES.to_string();
                raw.reflog = git_ok(
                    repo,
                    &["reflog", "show", "-n", &n, "--format=%gs", &b, "--"],
                )
                .map(|s| {
                    s.lines()
                        .map(|l| l.trim_end_matches('\r').to_string())
                        .collect()
                })
                .unwrap_or_default();
            }
            Done::Branch(name.clone(), raw, found)
        }
        Job::Fold { merge, p1, p2 } => {
            let found = log_range(repo, MAX_FOLD_COMMITS + 1, &format!("{p1}..{p2}"));
            let raw = FoldRaw {
                base: merge_base(repo, p1, p2),
                commits: found.iter().map(|c| c.hash.clone()).collect(),
            };
            Done::Fold(merge.clone(), raw, found)
        }
        Job::Dirty(path) => {
            let dir = PathBuf::from(path);
            let d = if dir.is_dir() {
                let (list, num, untracked) = uncommitted_parts(&dir);
                dirty_of(&list, &num, &untracked)
            } else {
                None
            };
            Done::Dirty(path.clone(), d)
        }
    }
}

fn graph_blocking(repo: &Path, main_limit: usize) -> Result<CommitGraph, String> {
    let run = run_git(repo, &["worktree", "list", "--porcelain"], LOCAL_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    let worktrees = parse_porcelain(&run.stdout);
    let main = main_of(&worktrees);
    let refs_out = run_git(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            &format!("--format={REF_FORMAT}"),
            "refs/heads",
        ],
        LOCAL_TIMEOUT,
    )?;
    if !refs_out.ok {
        return Err(git_failure(&refs_out));
    }
    let refs: Vec<RefLine> = refs_out.stdout.lines().filter_map(parse_ref_line).collect();
    let mut raw = RawCommitGraph {
        worktrees,
        ..Default::default()
    };
    let mut jobs: Vec<Job> = raw
        .worktrees
        .iter()
        .filter(|w| !w.bare)
        .map(|w| Job::Dirty(w.path.clone()))
        .collect();
    let mref = main.as_deref().map(|m| format!("refs/heads/{m}"));
    let (selected, _) = select_refs(&refs, main.as_deref());
    if let (Some(m), Some(mref)) = (main.as_deref(), mref.as_deref()) {
        let n = (FIRST_PARENT_READ + 1).to_string();
        let mut fp: Vec<String> = git_ok(repo, &["rev-list", "--first-parent", "-n", &n, mref])
            .map(|s| {
                s.lines()
                    .map(|l| l.trim().to_string())
                    .filter(|h| valid_commit(h))
                    .collect()
            })
            .unwrap_or_default();
        raw.first_parent_more = fp.len() > FIRST_PARENT_READ;
        fp.truncate(FIRST_PARENT_READ);
        raw.first_parent = fp;
        let lim = main_limit.to_string();
        if let Some(top) = git_ok(
            repo,
            &[
                "--no-optional-locks",
                "log",
                "--first-parent",
                "-n",
                &lim,
                LOG_FORMAT,
                "--numstat",
                mref,
                "--",
            ],
        ) {
            for c in parse_commit_log(&top) {
                raw.pool.entry(c.hash.clone()).or_insert(c);
            }
        }
        for h in raw.first_parent.iter().take(main_limit) {
            if let Some(c) = raw.pool.get(h).filter(|c| c.parents.len() >= 2) {
                jobs.push(Job::Fold {
                    merge: h.clone(),
                    p1: c.parents[0].clone(),
                    p2: c.parents[1].clone(),
                });
            }
        }
        jobs.extend(
            selected
                .iter()
                .filter(|r| r.name != m)
                .map(|r| Job::Branch(r.name.clone())),
        );
    }
    let mref_s = mref.clone().unwrap_or_default();
    for done in par_map(&jobs, |j| run_job(repo, &mref_s, j)) {
        let found = match done {
            Done::Branch(name, b, found) => {
                raw.branches.insert(name, b);
                found
            }
            Done::Fold(merge, f, found) => {
                raw.folds.insert(merge, f);
                found
            }
            Done::Dirty(path, d) => {
                if let Some(d) = d {
                    raw.dirty.insert(path, d);
                }
                Vec::new()
            }
        };
        for c in found {
            raw.pool.entry(c.hash.clone()).or_insert(c);
        }
    }

    let mut bases: Vec<String> = raw
        .branches
        .values()
        .filter_map(|b| b.base.clone())
        .chain(raw.folds.values().filter_map(|f| f.base.clone()))
        .filter(|h| !raw.pool.contains_key(h))
        .collect();
    bases.sort_unstable();
    bases.dedup();
    for part in bases.chunks(NO_WALK_CHUNK) {
        let mut args = vec![
            "--no-optional-locks",
            "log",
            "--no-walk=unsorted",
            LOG_FORMAT,
            "--numstat",
        ];
        args.extend(part.iter().map(String::as_str));
        args.push("--");
        if let Some(s) = git_ok(repo, &args) {
            for c in parse_commit_log(&s) {
                raw.pool.entry(c.hash.clone()).or_insert(c);
            }
        }
    }

    if let Some(common) = common_dir(repo) {
        for r in &selected {
            let file = common.join("logs").join("refs").join("heads").join(&r.name);
            if let Ok(text) = std::fs::read_to_string(&file) {
                if let Some(first) = text.lines().next().and_then(parse_reflog_file_line) {
                    raw.made.insert(r.name.clone(), first);
                }
            }
        }
    }
    raw.refs = refs;
    Ok(assemble(&raw, main_limit))
}

fn checked_hash(hash: &str) -> Result<String, String> {
    let h = hash.trim();
    if valid_commit(h) {
        Ok(h.to_string())
    } else {
        Err(tr!(ko: "커밋 해시가 올바르지 않습니다", en: "The commit hash is not valid"))
    }
}

fn commit_files_blocking(repo: &Path, hash: &str) -> Result<CommitFiles, String> {
    let h = checked_hash(hash)?;
    let Some(full) = git_ok(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{h}^{{commit}}"),
        ],
    )
    .map(|s| s.trim().to_string())
    .filter(|s| valid_commit(s)) else {
        return Err(tr!(ko: "커밋을 찾지 못했습니다: {h}", en: "Could not find the commit: {h}"));
    };
    let parents = git_ok(repo, &["rev-list", "--parents", "-n", "1", &full])
        .map(|s| s.split_whitespace().count().saturating_sub(1))
        .unwrap_or(0);
    let mut out = CommitFiles {
        hash: full.clone(),
        merge: parents >= 2,
        ..Default::default()
    };
    if out.merge {
        return Ok(out);
    }
    let tree = |kind: &str| {
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
                &full,
            ],
        )
        .unwrap_or_default()
    };
    let ns = tree("--name-status");
    let num = tree("--numstat");
    let (files, cut) = merge_files(
        parse_name_status(&mut ns.split('\0')),
        &parse_numstat(&mut num.split('\0')),
        &HashMap::new(),
    );
    out.files = files;
    out.truncated = cut;
    Ok(out)
}

fn checked_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() || p.chars().any(char::is_control) {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    }
    Ok(p.to_string())
}

/// 그 경로가 저장소의 워크트리 목록에 있을 때만 읽는다.
fn wip_blocking(repo: &Path, path: &str) -> Result<WipFiles, String> {
    let p = checked_path(path)?;
    let run = run_git(repo, &["worktree", "list", "--porcelain"], LOCAL_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    let want = comparable(&p);
    let want_key = comparable(&path_key(&p));
    let Some(w) = parse_porcelain(&run.stdout).into_iter().find(|w| {
        !w.bare && (comparable(&w.path) == want || comparable(&path_key(&w.path)) == want_key)
    }) else {
        return Err(
            tr!(ko: "워크트리를 찾지 못했습니다: {p}", en: "Could not find the worktree: {p}"),
        );
    };
    let (list, num, untracked) = uncommitted_parts(&PathBuf::from(&w.path));
    let (files, truncated) = merge_files(list, &num, &untracked);
    Ok(WipFiles {
        path: p,
        head: w.head,
        files,
        truncated,
    })
}

#[tauri::command]
pub async fn git_commit_graph(
    repo: String,
    main_limit: Option<u32>,
) -> Result<CommitGraph, String> {
    let repo = repo_of(&repo)?;
    let limit = clamp_limit(main_limit);
    crate::worktree::blocking(move || graph_blocking(&repo, limit)).await
}

#[tauri::command]
pub async fn git_commit_files(repo: String, hash: String) -> Result<CommitFiles, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || commit_files_blocking(&repo, &hash)).await
}

/// `path` 는 워크트리 목록의 글자 그대로다.
#[tauri::command]
pub async fn git_worktree_wip_files(repo: String, path: String) -> Result<WipFiles, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || wip_blocking(&repo, &path)).await
}

// ---------------------------------------------------------------------------
// 원격 — exec 한 번
// ---------------------------------------------------------------------------

/// `sh -c '<…>'` 한 낱말. 출력은 `aynx-…` 기계용 줄이고(앞의 로그인 잡음은 버린다), 커밋 줄 수는 서버 awk 가 합쳐 경로가 나오지 않는다.
pub(crate) fn remote_graph_command(repo: &str, main_limit: usize) -> Option<String> {
    let r = repo.trim();
    if r.is_empty() || r.chars().any(char::is_control) {
        return None;
    }
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
R={repo}
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || {{ echo aynx-fail=notrepo; exit 0; }}
C='{log_format}'
{cm}A='/^aynx-c=/ {{ if (h) printf "aynx-n=%d\t%d\n", a, d; print; h = 1; a = 0; d = 0; next }} $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {{ a += $1; d += $2 }} END {{ if (h) printf "aynx-n=%d\t%d\n", a, d }}'
echo aynx-wt
git -C "$R" worktree list --porcelain 2>/dev/null
echo aynx-wt-end
main=$(git -C "$R" worktree list --porcelain 2>/dev/null | sed -n '/^$/q;s/^branch refs\/heads\///p')
c=$(git -C "$R" rev-parse --git-common-dir 2>/dev/null)
case $c in /*) ;; *) c="$R/$c";; esac
F='{fmt}'
git -C "$R" for-each-ref --sort=-committerdate --count={count_plus} --format="aynx-ref=$F" refs/heads 2>/dev/null
if [ -n "$main" ]; then
  M="refs/heads/$main"
  git -C "$R" for-each-ref --format="aynx-ref=$F" "$M" 2>/dev/null
  git -C "$R" rev-list --first-parent -n {fp_read} "$M" 2>/dev/null | sed 's/^/aynx-fp=/'
  echo aynx-grp=main
  git -C "$R" --no-optional-locks log --first-parent -n {limit} "$C" --numstat "$M" -- 2>/dev/null | awk -F '\t' "$A"
  S=$(
  git -C "$R" log --first-parent -n {limit} --format='%H %P' "$M" -- 2>/dev/null | while read -r h p1 p2 rest; do
    [ -n "$p2" ] || continue
    printf 'aynx-fold=%s\t%s\n' "$h" "$(git -C "$R" merge-base "$p1" "$p2" 2>/dev/null)"
    git -C "$R" --no-optional-locks log -n {fold_n} "$C" --numstat "$p1..$p2" -- 2>/dev/null | awk -F '\t' "$A"
  done
  git -C "$R" for-each-ref --sort=-committerdate --count={count} --format='%(refname)' refs/heads 2>/dev/null | while IFS= read -r r; do
    b=${{r#refs/heads/}}
    if [ -f "$c/logs/$r" ]; then printf 'aynx-made=%s\t%s\n' "$b" "$(head -n 1 "$c/logs/$r" | awk -F '\t' '{{ n = split($1, x, " "); printf "%s\t%s", x[n-1], $2 }}')"; fi
    [ "$b" != "$main" ] || continue
    mb=$(git -C "$R" merge-base "$M" "$r" 2>/dev/null)
    set -- $(git -C "$R" rev-list --left-right --count "$M...$r" 2>/dev/null)
    printf 'aynx-br=%s\t%s\t%s\t%s\n' "$b" "$mb" "$1" "$2"
    if [ "${{2:-0}}" -gt 0 ] 2>/dev/null; then
      git -C "$R" --no-optional-locks log -n {br_n} "$C" --numstat "$M..$r" -- 2>/dev/null | awk -F '\t' "$A"
      cm "$R" "$M" "$r"
    else
      git -C "$R" reflog show -n {reflog_n} --format='aynx-rl=%gs' "$r" -- 2>/dev/null
    fi
  done
  )
  printf '%s\n' "$S"
  B=$(printf '%s\n' "$S" | awk -F '\t' '/^aynx-(br|fold)=/ && $2 != "" {{ print $2 }}' | sort -u)
  echo aynx-grp=bases
  if [ -n "$B" ]; then printf '%s\n' "$B" | git -C "$R" --no-optional-locks log --no-walk=unsorted --stdin "$C" --numstat 2>/dev/null | awk -F '\t' "$A"; fi
fi
git -C "$R" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | while IFS= read -r w; do
  [ "$(git -C "$w" rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || continue
  nf=$(( $(git -C "$w" --no-optional-locks status --porcelain=v1 --untracked-files=all 2>/dev/null | wc -l) + 0 ))
  [ "$nf" -gt 0 ] || continue
  ad=$(git -C "$w" --no-optional-locks diff --no-ext-diff --numstat -M HEAD -- 2>/dev/null | awk -F '\t' '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {{ a += $1; d += $2 }} END {{ printf "%d\t%d", a, d }}')
  u=$(git -C "$w" --no-optional-locks -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null | {{ n=0; while IFS= read -r f; do case $f in '"'*) continue;; esac; n=$((n+1)); [ "$n" -gt {max_files} ] && break; p="$w/$f"; [ -f "$p" ] && [ ! -h "$p" ] || continue; z=$(wc -c < "$p" 2>/dev/null) || continue; [ $z -le {max_bytes} ] || continue; git -C "$w" diff --no-ext-diff --no-index --numstat -- /dev/null "$f" 2>/dev/null | cut -f1; done; }} | awk '$1 ~ /^[0-9]+$/ {{ s += $1 }} END {{ printf "%d", s }}')
  printf 'aynx-dirty=%s\t%s\t%s\t%s\n' "$w" "$nf" "$ad" "$u"
done
"#,
        repo = crate::ssh::sh_path(r),
        log_format = LOG_FORMAT,
        fmt = REF_FORMAT,
        count = MAX_BRANCHES,
        count_plus = MAX_BRANCHES + 1,
        fp_read = FIRST_PARENT_READ + 1,
        limit = main_limit,
        fold_n = MAX_FOLD_COMMITS + 1,
        br_n = MAX_BRANCH_COMMITS + 1,
        reflog_n = REFLOG_LINES,
        max_files = UNTRACKED_MAX_FILES,
        max_bytes = UNTRACKED_MAX_BYTES,
        cm = crate::merge_detect::remote_cm_function(),
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

enum Group {
    None,
    Fold(String),
    Branch(String),
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

pub(crate) fn parse_remote_graph(stdout: &str) -> Result<RawCommitGraph, String> {
    let mut raw = RawCommitGraph::default();
    let mut porcelain = String::new();
    let mut in_wt = false;
    let mut group = Group::None;
    let mut log = LogReader::default();
    for rawline in stdout.lines() {
        let line = rawline.trim_end_matches('\r');
        match line {
            "aynx-fail=nogit" => return Err(remote_nogit()),
            "aynx-fail=notrepo" => return Err(remote_notrepo()),
            "aynx-wt" => {
                in_wt = true;
                continue;
            }
            "aynx-wt-end" => {
                in_wt = false;
                continue;
            }
            _ => {}
        }
        if in_wt {
            porcelain.push_str(line);
            porcelain.push('\n');
            continue;
        }
        if line.starts_with(COMMIT_TAG) {
            if let Some(h) = log.line(line) {
                match &group {
                    Group::Fold(m) => raw.folds.entry(m.clone()).or_default().commits.push(h),
                    Group::Branch(b) => raw.branches.entry(b.clone()).or_default().commits.push(h),
                    Group::None => {}
                }
            }
            continue;
        }
        if line.starts_with(SUM_TAG) {
            log.line(line);
            continue;
        }
        log.flush();
        if line.starts_with("aynx-cm-") {
            if let Group::Branch(b) = &group {
                let slot = &mut raw.branches.entry(b.clone()).or_default().content;
                crate::merge_detect::absorb_line(slot, line);
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("aynx-ref=") {
            if let Some(r) = parse_ref_line(v) {
                raw.refs.push(r);
            }
        } else if let Some(v) = line.strip_prefix("aynx-fp=") {
            let h = v.trim();
            if valid_commit(h) {
                raw.first_parent.push(h.to_string());
            }
        } else if line.starts_with("aynx-grp=") {
            group = Group::None;
        } else if let Some(v) = line.strip_prefix("aynx-fold=") {
            let (m, base) = v.split_once('\t').unwrap_or((v, ""));
            let m = m.trim();
            if valid_commit(m) {
                raw.folds.insert(
                    m.to_string(),
                    FoldRaw {
                        base: Some(base.trim().to_string()).filter(|h| valid_commit(h)),
                        commits: Vec::new(),
                    },
                );
                group = Group::Fold(m.to_string());
            } else {
                group = Group::None;
            }
        } else if let Some(v) = line.strip_prefix("aynx-br=") {
            let mut f = v.splitn(4, '\t');
            let (Some(name), Some(base), Some(behind), Some(ahead)) =
                (f.next(), f.next(), f.next(), f.next())
            else {
                group = Group::None;
                continue;
            };
            raw.branches.insert(
                name.to_string(),
                BranchRaw {
                    base: Some(base.trim().to_string()).filter(|h| valid_commit(h)),
                    behind: behind.trim().parse().ok(),
                    ahead: ahead.trim().parse().ok(),
                    ..Default::default()
                },
            );
            group = Group::Branch(name.to_string());
        } else if let Some(v) = line.strip_prefix("aynx-rl=") {
            if let Group::Branch(b) = &group {
                raw.branches
                    .entry(b.clone())
                    .or_default()
                    .reflog
                    .push(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("aynx-made=") {
            let mut f = v.splitn(3, '\t');
            let (Some(name), Some(at), Some(msg)) = (f.next(), f.next(), f.next()) else {
                continue;
            };
            if let Ok(at) = at.trim().parse() {
                raw.made.insert(name.to_string(), (at, msg.to_string()));
            }
        } else if let Some(v) = line.strip_prefix("aynx-dirty=") {
            // 경로에 탭이 있을 수 있다 — 뒤에서부터 가른다.
            let mut f = v.rsplitn(5, '\t');
            let (Some(u), Some(d), Some(a), Some(n), Some(path)) =
                (f.next(), f.next(), f.next(), f.next(), f.next())
            else {
                continue;
            };
            let num = |s: &str| s.trim().parse::<u32>().unwrap_or(0);
            let files = num(n);
            if files > 0 {
                raw.dirty.insert(
                    path.to_string(),
                    Dirty {
                        files,
                        added: num(a).saturating_add(num(u)),
                        deleted: num(d),
                    },
                );
            }
        }
    }
    log.flush();
    for c in log.done {
        raw.pool.entry(c.hash.clone()).or_insert(c);
    }
    raw.worktrees = parse_porcelain(&porcelain);
    raw.first_parent_more = raw.first_parent.len() > FIRST_PARENT_READ;
    raw.first_parent.truncate(FIRST_PARENT_READ);
    // 주 브랜치 줄이 한 번 더 붙으므로 세기 전에 이름으로 겹친 것을 뺀다.
    let mut names: Vec<&str> = raw.refs.iter().map(|r| r.name.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    raw.refs_capped = names.len() > MAX_BRANCHES;
    Ok(raw)
}

pub(crate) fn remote_commit_files_command(repo: &str, hash: &str) -> Option<String> {
    let r = repo.trim();
    let h = hash.trim();
    if r.is_empty() || r.chars().any(char::is_control) || !valid_commit(h) {
        return None;
    }
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
R={repo}
H={hash}
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || {{ echo aynx-fail=notrepo; exit 0; }}
f=$(git -C "$R" rev-parse -q --verify "$H^{{commit}}" 2>/dev/null) || {{ echo aynx-fail=nocommit; exit 0; }}
set -- $(git -C "$R" rev-list --parents -n 1 "$f" 2>/dev/null)
printf 'aynx-cfiles\0hash\0%s\0parents\0%s\0' "$f" "$(($# - 1))"
if [ $# -lt 3 ]; then
  printf 'cns\0'; git -C "$R" --no-optional-locks diff-tree -r -M --root --no-commit-id --name-status -z "$f" 2>/dev/null; printf 'aynx-end\0'
  printf 'cnum\0'; git -C "$R" --no-optional-locks diff-tree -r -M --root --no-commit-id --numstat -z "$f" 2>/dev/null; printf 'aynx-end\0'
fi
"#,
        repo = crate::ssh::sh_path(r),
        hash = crate::ssh::sh_quote(h),
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

pub(crate) fn parse_remote_commit_files(stdout: &str, hash: &str) -> Result<CommitFiles, String> {
    let has = |m: &str| stdout.lines().any(|l| l.trim_end_matches('\r') == m);
    if has("aynx-fail=nogit") {
        return Err(remote_nogit());
    }
    if has("aynx-fail=notrepo") {
        return Err(remote_notrepo());
    }
    if has("aynx-fail=nocommit") {
        let h = hash.trim();
        return Err(tr!(ko: "커밋을 찾지 못했습니다: {h}", en: "Could not find the commit: {h}"));
    }
    let Some(at) = stdout.find("aynx-cfiles\0") else {
        return Err(remote_unreadable());
    };
    let mut it = stdout[at + "aynx-cfiles\0".len()..].split('\0');
    let mut out = CommitFiles {
        hash: hash.trim().to_string(),
        ..Default::default()
    };
    let mut ns = Vec::new();
    let mut num = HashMap::new();
    while let Some(tok) = it.next() {
        match tok {
            "hash" => {
                if let Some(h) = it.next().map(str::trim).filter(|h| valid_commit(h)) {
                    out.hash = h.to_string();
                }
            }
            "parents" => {
                out.merge = it
                    .next()
                    .and_then(|n| n.trim().parse::<u32>().ok())
                    .is_some_and(|n| n >= 2);
            }
            "cns" => ns = parse_name_status(&mut it),
            "cnum" => num = parse_numstat(&mut it),
            _ => {}
        }
    }
    if !out.merge {
        let (files, cut) = merge_files(ns, &num, &HashMap::new());
        out.files = files;
        out.truncated = cut;
    }
    Ok(out)
}

/// 그 경로가 워크트리 목록에 그 글자 그대로 있을 때만 — 없으면 `aynx-fail=nowt`.
pub(crate) fn remote_wip_command(repo: &str, path: &str) -> Option<String> {
    let r = repo.trim();
    let p = path.trim();
    if r.is_empty()
        || r.chars().any(char::is_control)
        || p.is_empty()
        || p.chars().any(char::is_control)
    {
        return None;
    }
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
R={repo}
w={path}
git -C "$R" rev-parse --git-dir >/dev/null 2>&1 || {{ echo aynx-fail=notrepo; exit 0; }}
git -C "$R" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | grep -Fxq -- "$w" || {{ echo aynx-fail=nowt; exit 0; }}
printf 'aynx-wip\0head\0%s\0' "$(git -C "$w" rev-parse -q --verify HEAD 2>/dev/null)"
printf 'ust\0'; git -C "$w" --no-optional-locks status --porcelain=v1 -z --untracked-files=all 2>/dev/null; printf 'aynx-end\0'
if git -C "$w" rev-parse -q --verify HEAD >/dev/null 2>&1; then printf 'unum\0'; git -C "$w" --no-optional-locks diff --no-ext-diff --numstat -z -M HEAD -- 2>/dev/null; printf 'aynx-end\0'; fi
printf 'ulines\0'
git -C "$w" --no-optional-locks -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null | {{ n=0; while IFS= read -r f; do case $f in '"'*) continue;; esac; n=$((n+1)); [ "$n" -gt {max_files} ] && break; p="$w/$f"; [ -f "$p" ] && [ ! -h "$p" ] || continue; z=$(wc -c < "$p" 2>/dev/null) || continue; [ $z -le {max_bytes} ] || continue; printf '%s\t%s\0' "$(git -C "$w" diff --no-ext-diff --no-index --numstat -- /dev/null "$f" 2>/dev/null | cut -f1)" "$f"; done; }}
printf 'aynx-end\0'
"#,
        repo = crate::ssh::sh_path(r),
        path = crate::ssh::sh_quote(p),
        max_files = UNTRACKED_MAX_FILES,
        max_bytes = UNTRACKED_MAX_BYTES,
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

pub(crate) fn parse_remote_wip(stdout: &str, path: &str) -> Result<WipFiles, String> {
    let has = |m: &str| stdout.lines().any(|l| l.trim_end_matches('\r') == m);
    if has("aynx-fail=nogit") {
        return Err(remote_nogit());
    }
    if has("aynx-fail=notrepo") {
        return Err(remote_notrepo());
    }
    let p = path.trim().to_string();
    if has("aynx-fail=nowt") {
        return Err(
            tr!(ko: "워크트리를 찾지 못했습니다: {p}", en: "Could not find the worktree: {p}"),
        );
    }
    let Some(at) = stdout.find("aynx-wip\0") else {
        return Err(remote_unreadable());
    };
    let mut it = stdout[at + "aynx-wip\0".len()..].split('\0');
    let mut out = WipFiles {
        path: p,
        ..Default::default()
    };
    let mut ust = Vec::new();
    let mut unum = HashMap::new();
    let mut ulines = HashMap::new();
    while let Some(tok) = it.next() {
        match tok {
            "head" => {
                out.head = it
                    .next()
                    .map(str::trim)
                    .filter(|h| valid_commit(h))
                    .map(str::to_string)
            }
            "ust" => ust = parse_status_z(&mut it),
            "unum" => unum = parse_numstat(&mut it),
            "ulines" => ulines = parse_untracked_lines(&mut it),
            _ => {}
        }
    }
    let (files, cut) = merge_files(ust, &unum, &ulines);
    out.files = files;
    out.truncated = cut;
    Ok(out)
}

async fn exec_once(
    id: u32,
    command: String,
    timeout: Duration,
    max_bytes: usize,
) -> Result<(String, bool), String> {
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let out = crate::ssh::run_exec_bytes(handle, command, timeout, max_bytes).await;
    if let Some(e) = exec_failure(&out, timeout) {
        return Err(e);
    }
    Ok((
        String::from_utf8_lossy(&out.stdout).into_owned(),
        out.overflow,
    ))
}

/// 원격은 exec 한 번 · 읽기만 하고, 파일 경로는 꺼내지 않는다.
#[tauri::command]
pub async fn ssh_git_commit_graph(
    id: u32,
    repo: String,
    main_limit: Option<u32>,
) -> Result<CommitGraph, String> {
    let limit = clamp_limit(main_limit);
    let Some(command) = remote_graph_command(&repo, limit) else {
        return Err(
            tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        );
    };
    let (stdout, overflow) = exec_once(
        id,
        command,
        REMOTE_GRAPH_TIMEOUT,
        REMOTE_GRAPH_MAX_BYTES,
    )
    .await?;
    let mut raw = parse_remote_graph(&stdout)?;
    raw.overflow = overflow;
    Ok(assemble(&raw, limit))
}

#[tauri::command]
pub async fn ssh_git_commit_files(
    id: u32,
    repo: String,
    hash: String,
) -> Result<CommitFiles, String> {
    let Some(command) = remote_commit_files_command(&repo, &hash) else {
        return Err(checked_hash(&hash).err().unwrap_or_else(
            || tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        ));
    };
    let (stdout, overflow) = exec_once(
        id,
        command,
        REMOTE_FILES_TIMEOUT,
        REMOTE_FILES_MAX_BYTES,
    )
    .await?;
    let mut files = parse_remote_commit_files(&stdout, &hash)?;
    files.truncated |= overflow;
    Ok(files)
}

#[tauri::command]
pub async fn ssh_git_worktree_wip_files(
    id: u32,
    repo: String,
    path: String,
) -> Result<WipFiles, String> {
    let Some(command) = remote_wip_command(&repo, &path) else {
        return Err(checked_path(&path).err().unwrap_or_else(
            || tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        ));
    };
    let (stdout, overflow) = exec_once(
        id,
        command,
        REMOTE_FILES_TIMEOUT,
        REMOTE_FILES_MAX_BYTES,
    )
    .await?;
    let mut files = parse_remote_wip(&stdout, &path)?;
    files.truncated |= overflow;
    Ok(files)
}

#[cfg(test)]
mod tests;
