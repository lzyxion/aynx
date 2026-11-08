//! 커밋 그래프 — 브랜치 타일을 "한 줄 = 커밋 하나" 로 그리는 재료 (읽기 전용).
//!
//! 브랜치 타일(`kind:"branches"`)의 재료다(docs/log/2026-10-04-commit-graph.md). 옛 "한 줄 = 브랜치 하나" 목록의 명령은
//! 지웠고, 해석 규칙(참조 줄 · 주 브랜치 · `-z` 낱말 · 커밋 안 한 것)은 그것만 남은 [`crate::branch_graph`] 의 것을 그대로
//! 쓴다. 줄을 어디에 놓을지는 프런트 몫이다(`src/lib/branch-graph.ts` 의 `buildRows`) — 여기는 해시로 찾는 커밋 표와,
//! 그 커밋들을 가리키는 목록 넷(주 줄 · 브랜치 · 접힘 · 워크트리)만 준다.
//!
//! **읽기 전용** — git 에 쓰는 명령은 하나도 없다. `status` · `diff` · `ls-files` · `log` 는 `--no-optional-locks`
//! (에이전트가 같은 워크트리에서 git 을 쓰는 중에 이 읽기가 `index.lock` 을 잡으면 그쪽 명령이 실패한다), `diff` 는
//! `--no-ext-diff` 로 부른다.
//!
//! ## 명령 여섯 (전부 async — 로컬은 블로킹 풀, 원격은 붙은 세션의 exec **한 번**)
//!
//! - [`git_commit_graph`] · [`ssh_git_commit_graph`] (`repo`, `mainLimit?` 기본 [`DEFAULT_MAIN_LIMIT`], 1..=[`MAX_MAIN_LIMIT`])
//! - [`git_commit_files`] · [`ssh_git_commit_files`] (`repo`, `hash`) — 커밋 하나에서 바뀐 파일
//! - [`git_worktree_wip_files`] · [`ssh_git_worktree_wip_files`] (`repo`, `path`) — 워크트리 하나의 커밋 안 한 파일
//!
//! ## 그래프에 넣는 것
//!
//! - **main** = 주 작업 폴더의 브랜치(`worktree list --porcelain` 첫 덩어리 — [`main_of`]). 분리 HEAD 면 `None` 이고
//!   주 줄 · 브랜치 · 접힘이 모두 빈다(무엇과의 관계인가). 워크트리는 그래도 채운다.
//! - **main_line** = `rev-list --first-parent` (최대 [`FIRST_PARENT_READ`] 개 읽기)의 앞 `mainLimit` 개 + **보충**:
//!   싣는 브랜치 · 접힘의 `base` 가 first-parent 줄 위에 있으면 그 커밋도 넣는다(줄 순서 그대로, 사이에 건너뛴 수는
//!   `skipped_before`). 줄 위에 없는 base 는 보충하지 않는다(프런트가 맨 아래에 붙인다). 보충은 한 번뿐이다 — 보충으로
//!   들어온 병합 커밋은 접지 않는다. `main_more` = 마지막 줄 뒤에도 커밋이 있다.
//! - **branches** = 주 브랜치 아닌 로컬 브랜치 중 앞선 커밋이 있거나 워크트리에 체크아웃된 것(최근 순 [`MAX_BRANCHES`] —
//!   [`select_refs`]). 병합되고 워크트리도 없는 브랜치는 싣지 않는다. 커밋은 `main..브랜치` 최신부터 [`MAX_BRANCH_COMMITS`] 개.
//!   **merged**([`is_merged`]) = 앞선 커밋 0 이고 그 브랜치 reflog 에 일한 자국(`commit` · `merge ` · `cherry-pick` ·
//!   `rebase` · `pull`)이 하나라도 있다 — 갓 만든 브랜치(`branch: Created from …` 뿐)는 병합이 아니다.
//!   앞선 커밋이 있으면 **내용 기준**(squash · rebase 병합 — `crate::merge_detect`, 2026-10-05)으로 한 번 더 본다 — 맞으면
//!   `merged` · `merged_kind`(`squash`/`rebase`)이고 커밋 덩어리는 비운다(아래 접힘으로 간다). 워크트리가 없으면 싣지 않는다.
//! - **folds** = 앞 `mainLimit` 줄 안의 병합 커밋(부모 2+)마다 `merge^1..merge^2` 최신부터 [`MAX_FOLD_COMMITS`] 개, 이름은
//!   제목 `Merge branch 'x'`(+ ` into …`)의 x([`merge_name`]). `kind` = `merge`. 그리고 **squash · rebase 병합된 브랜치**마다
//!   하나(`kind` = `squash` · `rebase`) — `merge` = 맞은 main 커밋(squash 커밋), 이름 = 브랜치, 커밋 = `main..브랜치`, base =
//!   브랜치의 merge-base. 맞은 커밋이 앞 `mainLimit` 줄 밖이거나 같은 커밋에 접힘이 이미 있으면 접힘 없이 브랜치만 숨긴다.
//! - **commits** = 위 목록들이 가리키는 커밋(+ 아는 base) — 해시 하나에 한 번, 전체 [`MAX_COMMITS`] 개(주 줄 → base → 접힘
//!   → 브랜치 순으로 담고, 넘치면 목록 꼬리를 자르고 `commits_truncated` · `truncated`). `added`/`deleted` 는 첫 부모 대비
//!   numstat 합(바이너리 빼고), 병합 커밋(부모 2+)은 `None`. 제목은 제어 글자를 빈칸으로 바꾼 한 줄.
//! - **worktrees** = 목록 전부 + `dirty`(커밋 안 한 것: 파일 수 · 더한 줄 · 뺀 줄, 추적 안 한 새 파일 포함 — 규칙은
//!   [`crate::branch_graph::uncommitted_parts`]. 없으면 `None`).
//!
//! ## 로컬 · 원격
//!
//! 로컬은 `git` 을 셸 없이 낱개 인자로(`run_git`). 브랜치 · 접힘 · 워크트리마다의 일은 [`LOCAL_WORKERS`] 갈래로 나눠 동시에
//! 돌린다(브랜치마다 git 두세 번). 원격은 Rust 가 짓는 `sh -c` 스크립트 한 번이고 출력은 기계용 줄([`remote_graph_command`])
//! · NUL 낱말(파일 둘)뿐이다. **원격 그래프는 파일 경로를 서버 밖으로 꺼내지 않는다** — 커밋마다의 줄 수는 서버의 awk 가
//! 합쳐 `aynx-n=` 한 줄로 보내고, 커밋 안 한 것도 수만 센다. 경로는 사람이 커밋 · 워크트리를 골랐을 때 부르는 파일 명령
//! 둘에서만 나온다.

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

/// 주 줄 앞부분의 기본 길이.
pub(crate) const DEFAULT_MAIN_LIMIT: u32 = 12;
/// 주 줄 앞부분의 상한.
pub(crate) const MAX_MAIN_LIMIT: u32 = 500;
/// first-parent 줄을 읽는 상한 — 보충 · "더 있음" 판정은 이 안에서만.
pub(crate) const FIRST_PARENT_READ: usize = 5000;
/// 브랜치마다 싣는 커밋의 상한.
pub(crate) const MAX_BRANCH_COMMITS: usize = 100;
/// 접힘마다 싣는 커밋의 상한.
pub(crate) const MAX_FOLD_COMMITS: usize = 50;
/// 답 전체의 커밋 상한.
pub(crate) const MAX_COMMITS: usize = 3000;
/// merged 판정에 읽는 브랜치 reflog 줄 수(최근 것부터).
pub(crate) const REFLOG_LINES: usize = 200;
/// 로컬 일을 동시에 돌리는 갈래 수.
const LOCAL_WORKERS: usize = 8;
/// 로컬 `--no-walk` 한 번에 싣는 해시 수(Windows 명령 줄 길이).
const NO_WALK_CHUNK: usize = 100;
/// 원격 exec 한 번의 시한 — 그래프.
const REMOTE_GRAPH_TIMEOUT: Duration = Duration::from_secs(45);
/// 원격 exec 한 번의 시한 — 파일.
const REMOTE_FILES_TIMEOUT: Duration = Duration::from_secs(20);
/// 원격 그래프 답의 상한(바이트) — 커밋이 많다.
const REMOTE_GRAPH_MAX_BYTES: usize = 4 * 1024 * 1024;
/// 원격 파일 답의 상한(바이트).
const REMOTE_FILES_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 커밋 머리줄의 표식 — `log --format` 이 줄 맨 앞에 붙인다(numstat 줄은 숫자나 `-` 로 시작하니 겹치지 않는다).
const COMMIT_TAG: &str = "aynx-c=";
/// 원격 awk 가 합친 커밋 줄 수 `aynx-n=<더한>\t<뺀>`.
const SUM_TAG: &str = "aynx-n=";
/// 커밋 머리줄의 서식 — 로컬 · 원격이 같다.
const LOG_FORMAT: &str = "--format=aynx-c=%H%x09%P%x09%ct%x09%s";

// ---------------------------------------------------------------------------
// 답의 모양 — 프런트가 읽는다 (serde 필드명 snake_case)
// ---------------------------------------------------------------------------

/// 주 줄의 한 칸.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct MainRow {
    pub hash: String,
    /// 바로 위 줄과 사이에 건너뛴 first-parent 커밋 수(0 = 이어짐)
    pub skipped_before: u32,
}

/// 커밋 하나.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    /// 제어 글자를 빈칸으로 바꾼 한 줄
    pub subject: String,
    /// 커미터 시각(유닉스 초)
    pub time: i64,
    /// 첫 부모 대비 더한 줄 합(바이너리 빼고) — 병합 커밋은 `None`
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

/// 브랜치 하나.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphBranch {
    pub name: String,
    pub head: String,
    /// 주 브랜치와의 merge-base
    pub base: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// `main..브랜치` 최신부터
    pub commits: Vec<String>,
    pub commits_truncated: bool,
    pub merged: bool,
    /// 무엇으로 병합됐나 — `merged` 일 때만(`ancestry` · `squash` · `rebase`)
    pub merged_kind: Option<MergeKind>,
    pub created_from: Option<String>,
    pub created_at: Option<i64>,
}

/// 접힘이 무엇으로 생겼나.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldKind {
    /// 병합 커밋(부모 2+)
    #[default]
    Merge,
    /// squash 병합 — `merge` 는 squash 커밋
    Squash,
    /// rebase 병합 — `merge` 는 브랜치 끝 커밋과 patch 가 같은 main 커밋
    Rebase,
}

/// 주 줄의 커밋 아래로 접는 한 덩어리.
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

/// 커밋 안 한 것의 수.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct Dirty {
    pub files: u32,
    pub added: u32,
    pub deleted: u32,
}

/// 워크트리 하나.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct GraphWorktree {
    /// git 이 적은 그대로
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub primary: bool,
    pub dirty: Option<Dirty>,
}

/// 그래프 명령의 답.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct CommitGraph {
    pub main: Option<String>,
    pub main_head: Option<String>,
    /// 최신부터
    pub main_line: Vec<MainRow>,
    pub main_more: bool,
    pub commits: Vec<GraphCommit>,
    pub branches: Vec<GraphBranch>,
    pub folds: Vec<MergedFold>,
    pub worktrees: Vec<GraphWorktree>,
    /// 브랜치 수 · 커밋 수 상한에 걸렸다(또는 원격 답이 상한을 넘었다)
    pub truncated: bool,
}

/// 커밋 하나에서 바뀐 파일.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct CommitFiles {
    pub hash: String,
    /// 부모 2+ — 파일 목록을 싣지 않는다
    pub merge: bool,
    pub files: Vec<ChangedFile>,
    pub truncated: bool,
}

/// 워크트리 하나의 커밋 안 한 파일.
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

/// 브랜치 하나의 재료.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BranchRaw {
    pub base: Option<String>,
    pub behind: Option<u32>,
    pub ahead: Option<u32>,
    /// `main..브랜치` 최신부터(상한 + 1 까지 — 넘침 판정용)
    pub commits: Vec<String>,
    /// 앞섬 0 일 때만 읽은 reflog 글(`%gs`)
    pub reflog: Vec<String>,
    /// 앞섬이 있을 때 읽은 내용 판정의 재료(`crate::merge_detect` — main 이 움직였을 때만)
    pub content: Option<ContentFacts>,
}

/// 접힘 하나의 재료.
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
    /// 주 브랜치의 first-parent 줄(최대 [`FIRST_PARENT_READ`])
    pub first_parent: Vec<String>,
    /// 읽은 것보다 더 있다
    pub first_parent_more: bool,
    /// 해시 → 커밋
    pub pool: HashMap<String, GraphCommit>,
    pub branches: HashMap<String, BranchRaw>,
    /// 병합 커밋 해시 → 접힘
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

/// 제목 한 줄 (**순수 함수**) — 탭 · 제어 글자는 빈칸으로, 앞뒤 빈칸은 뗀다.
pub(crate) fn clean_subject(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 커밋 머리줄 `<H>\t<부모들>\t<시각>\t<제목>`(표식 뗀 것) (**순수 함수**).
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

/// `log --format=aynx-c=… --numstat` 를 줄 단위로 읽는 것 — 로컬은 numstat 줄을 그대로, 원격은 awk 가 합친 `aynx-n=` 줄을 준다.
#[derive(Debug, Default)]
pub(crate) struct LogReader {
    pub done: Vec<GraphCommit>,
    cur: Option<GraphCommit>,
    added: u32,
    deleted: u32,
}

impl LogReader {
    /// 한 줄 — 새 커밋 머리줄이면 그 해시를 돌려준다.
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

    /// 지금 커밋을 닫는다 — 병합 커밋(부모 2+)은 줄 수를 싣지 않는다.
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

/// 로컬 `log` 출력 → 커밋들(순서 그대로) (**순수 함수**).
pub(crate) fn parse_commit_log(text: &str) -> Vec<GraphCommit> {
    let mut r = LogReader::default();
    for line in text.lines() {
        r.line(line);
    }
    r.flush();
    r.done
}

/// 병합 커밋 제목의 브랜치 이름 (**순수 함수**) — `Merge branch 'x'` · `Merge branch 'x' into y` 의 x, 아니면 `None`.
pub(crate) fn merge_name(subject: &str) -> Option<String> {
    let rest = subject.trim().strip_prefix("Merge branch '")?;
    let (name, tail) = rest.split_once('\'')?;
    (!name.is_empty() && (tail.is_empty() || tail.starts_with(" into "))).then(|| name.to_string())
}

/// 병합됨 (**순수 함수**) — 주 브랜치가 아니고 · 앞선 커밋 0 · reflog 글 중 하나라도 일한 자국으로 시작.
/// `branch: Created from …` 뿐이거나 reflog 가 없으면 거짓(갓 만든 브랜치).
pub(crate) fn is_merged(is_main: bool, ahead: u32, reflog: &[String]) -> bool {
    const WORK: [&str; 5] = ["commit", "merge ", "cherry-pick", "rebase", "pull"];
    !is_main
        && ahead == 0
        && reflog
            .iter()
            .any(|l| WORK.iter().any(|w| l.trim_start().starts_with(w)))
}

/// 커밋 안 한 것의 수 (**순수 함수**) — 목록이 비면 `None`. 줄 수는 HEAD 기준 numstat, 없으면 추적 안 한 새 파일의 줄 수.
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

/// 주 줄 (**순수 함수**) — 앞 `limit` 개 + first-parent 줄 위에 있는 `bases`(보충). 둘째 값은 "더 있음".
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

/// 커밋 표에 담기 — 상한 [`MAX_COMMITS`] 까지, 해시 하나에 한 번.
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

    /// 목록 하나 — 모르는 해시는 빼고, 상한에 걸리면 꼬리를 자르고 참.
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

/// 재료 → 답 (**순수 함수**).
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

    // 브랜치 — 앞섰거나 워크트리에 서 있는 것.
    let (refs, cut) = select_refs(&raw.refs, Some(&m));
    let checked: HashSet<&str> = worktrees
        .iter()
        .filter_map(|w| w.branch.as_deref())
        .collect();
    let mut branches: Vec<GraphBranch> = Vec::new();
    // squash · rebase 병합된 브랜치 — 접힘 후보(맞은 main 커밋 아래). 창 · 겹침은 아래 접힘에서 거른다.
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
            // 내용으로 병합됐고 워크트리도 없다 — 조상 병합과 같이 싣지 않는다(접힘만 남는다).
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

    // 접힘 — 앞 `main_limit` 줄 안의 병합 커밋.
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
    // squash · rebase 병합 — 맞은 main 커밋이 앞 `main_limit` 줄 안이고 그 자리에 접힘이 없을 때만(한 커밋에 하나).
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

    // 커밋 표 — 주 줄 → base → 접힘 → 브랜치.
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

/// `mainLimit` → 1..=[`MAX_MAIN_LIMIT`] (**순수 함수**).
pub(crate) fn clamp_limit(limit: Option<u32>) -> usize {
    limit.unwrap_or(DEFAULT_MAIN_LIMIT).clamp(1, MAX_MAIN_LIMIT) as usize
}

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

/// 몇 갈래로 나눠 동시에 — 순서는 지킨다.
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

/// 동시에 돌리는 일 하나.
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

/// 범위 하나의 커밋 — 최신부터 `n` 개(numstat 합 포함).
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
                // squash · rebase 병합인가 — main 이 merge-base 에서 움직였을 때만 git 을 더 부른다(`merge_detect` 의 문).
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

/// 로컬 — 그래프의 블로킹 몸통.
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

    // base 커밋 — 표에 없는 것만 한 번에(몇 개씩 끊어서).
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

    // 만든 곳 — reflog 파일의 첫 줄(브랜치 그래프와 같다).
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

/// 커밋 해시 검사 — 16진 4~64자.
fn checked_hash(hash: &str) -> Result<String, String> {
    let h = hash.trim();
    if valid_commit(h) {
        Ok(h.to_string())
    } else {
        Err(tr!(ko: "커밋 해시가 올바르지 않습니다", en: "The commit hash is not valid"))
    }
}

/// 로컬 — 커밋 하나에서 바뀐 파일.
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

/// 워크트리 경로 글자 검사 — 비지 않고 제어 글자 없음.
fn checked_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() || p.chars().any(char::is_control) {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    }
    Ok(p.to_string())
}

/// 로컬 — 워크트리 하나의 커밋 안 한 파일. 그 경로가 저장소의 워크트리 목록에 있을 때만.
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

/// **로컬 저장소의 커밋 그래프** — 읽기만 한다.
#[tauri::command]
pub async fn git_commit_graph(
    repo: String,
    main_limit: Option<u32>,
) -> Result<CommitGraph, String> {
    let repo = repo_of(&repo)?;
    let limit = clamp_limit(main_limit);
    crate::worktree::blocking(move || graph_blocking(&repo, limit)).await
}

/// **로컬 저장소의 커밋 하나에서 바뀐 파일** — 병합 커밋은 목록 없이 `merge: true`.
#[tauri::command]
pub async fn git_commit_files(repo: String, hash: String) -> Result<CommitFiles, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || commit_files_blocking(&repo, &hash)).await
}

/// **로컬 워크트리 하나의 커밋 안 한 파일** — `path` 는 워크트리 목록의 글자.
#[tauri::command]
pub async fn git_worktree_wip_files(repo: String, path: String) -> Result<WipFiles, String> {
    let repo = repo_of(&repo)?;
    crate::worktree::blocking(move || wip_blocking(&repo, &path)).await
}

// ---------------------------------------------------------------------------
// 원격 — exec 한 번
// ---------------------------------------------------------------------------

/// 원격 그래프 스크립트 (**순수 함수**) — `sh -c '<…>'` 한 낱말.
///
/// 출력 줄(앞의 로그인 잡음은 버린다):
/// - `aynx-wt` … `aynx-wt-end` = `worktree list --porcelain` 그대로
/// - `aynx-ref=<refname>\t<hash>\t<unix>\t<subject>` — 최근 순 201개 + 주 브랜치 한 줄 더
/// - `aynx-fp=<hash>` — 주 브랜치 first-parent 줄
/// - `aynx-grp=main` 다음 커밋들 — 주 줄 앞부분
/// - `aynx-fold=<병합>\t<base>` 다음 커밋들 — 접힘 하나
/// - `aynx-br=<이름>\t<base>\t<뒤처짐>\t<앞섬>` 다음 커밋들 + 내용 판정 재료 `aynx-cm-…`(앞섬 > 0 — 셸 함수 `cm`,
///   `crate::merge_detect::remote_cm_function`) 또는 `aynx-rl=<reflog 글>` 줄들(앞섬 0)
/// - `aynx-made=<이름>\t<시각>\t<글>` — 브랜치 reflog 파일 첫 줄(이름 · 이메일은 awk 가 뗀다)
/// - `aynx-grp=bases` 다음 커밋들 — base 커밋
/// - 커밋 = `aynx-c=<H>\t<부모들>\t<시각>\t<제목>` + `aynx-n=<더한>\t<뺀>`(서버의 awk 가 numstat 을 합친 것 — 경로는 안 나온다)
/// - `aynx-dirty=<경로>\t<파일 수>\t<더한>\t<뺀>\t<새 파일 줄>` — 커밋 안 한 것이 있는 워크트리마다
/// - 서버에 git 이 없으면 `aynx-fail=nogit`, 저장소가 아니면 `aynx-fail=notrepo`
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

/// 원격 답에서 지금 커밋이 붙는 곳.
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

/// 원격 그래프 답 → 재료 (**순수 함수**). git 이 없거나 저장소가 아니면 `Err`(한 줄).
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

/// 원격 커밋 파일 스크립트 (**순수 함수**). 출력은 NUL 낱말: `aynx-cfiles` · `hash` <전체 해시> · `parents` <수> 다음
/// (부모 2 미만이면) `cns`(name-status) · `cnum`(numstat) 묶음, 각각 `aynx-end` 로 닫는다. 커밋이 없으면 `aynx-fail=nocommit`.
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

/// 원격 커밋 파일 답 → 답 (**순수 함수**).
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

/// 원격 커밋 안 한 파일 스크립트 (**순수 함수**). 그 경로가 워크트리 목록에 그 글자 그대로 있을 때만 — 없으면
/// `aynx-fail=nowt`. 출력은 NUL 낱말: `aynx-wip` · `head` <HEAD> 다음 `ust` · `unum` · `ulines` 묶음(바뀐 파일 명령과 같은 모양).
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

/// 원격 커밋 안 한 파일 답 → 답 (**순수 함수**).
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

/// exec 한 번 — 흔한 실패는 오류 한 줄로.
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

/// **원격 저장소의 커밋 그래프** — 살아 있는 SSH 세션 `id` 의 전송로로 exec **한 번**. 읽기만 하고, 파일 경로는 꺼내지 않는다.
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

/// **원격 저장소의 커밋 하나에서 바뀐 파일** — 사람이 그 커밋을 골랐을 때만 부른다.
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

/// **원격 워크트리 하나의 커밋 안 한 파일** — 사람이 그 워크트리를 골랐을 때만 부른다.
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
