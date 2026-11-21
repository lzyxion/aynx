//! 브랜치 타일의 공유 조각 — 커밋 그래프([`crate::commit_graph`])와 새 워크트리([`crate::worktree_branch`])가 쓰는
//! git 출력 해석 · 읽기 도우미 (docs/log/2026-10-04-commit-graph.md).
//!
//! **읽기 전용** — git 에 쓰는 명령은 하나도 없다(`status` · `diff` · `ls-files` 는 `--no-optional-locks`: 에이전트가 같은
//! 워크트리에서 git 을 쓰는 중에 이 읽기가 `index.lock` 을 잡으면 그쪽 명령이 실패한다). reflog 의 이름 · 이메일 칸은 읽지 않는다.
//! 추적 안 하는 새 파일의 줄 수는 [`crate::worktree_changes`] 와 같은 규칙이다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::i18n::tr;
use crate::worktree::{run_git, WorktreeInfo};
use crate::worktree_changes::{
    classify, text_lines, valid_commit, Change, UNTRACKED_MAX_BYTES, UNTRACKED_MAX_FILES,
};

/// 그래프에 싣는 브랜치 수의 상한 — 최근 커밋 순으로 자르고, 주 브랜치는 늘 넣는다.
pub(crate) const MAX_BRANCHES: usize = 200;
pub(crate) const MAX_FILES: usize = 500;
pub(crate) const LOCAL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ChangedFile {
    /// 저장소 뿌리 기준(이름 바뀜이면 새 이름)
    pub path: String,
    pub old_path: Option<String>,
    /// `M` · `A` · `D` · `R`
    pub status: String,
    /// 더한 줄 — 바이너리 · 모름이면 `None`
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 참조 · 주 브랜치
// ---------------------------------------------------------------------------

/// `for-each-ref` 한 줄(`<refname>\t<hash>\t<unix>\t<subject>`)의 재료.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RefLine {
    pub name: String,
    pub head: String,
    pub time: i64,
    pub subject: String,
}

/// 로컬 `for-each-ref` 의 서식 — 원격 스크립트도 같은 서식을 쓴다.
pub(crate) const REF_FORMAT: &str =
    "%(refname)%09%(objectname)%09%(committerdate:unix)%09%(subject)";

pub(crate) fn parse_ref_line(line: &str) -> Option<RefLine> {
    let line = line.trim_end_matches('\r');
    let mut f = line.splitn(4, '\t');
    let name = f.next()?.strip_prefix("refs/heads/")?.to_string();
    let head = f.next()?.trim().to_string();
    let time = f.next()?.trim().parse().ok()?;
    let subject = f.next().unwrap_or("").to_string();
    (!name.is_empty() && valid_commit(&head)).then_some(RefLine {
        name,
        head,
        time,
        subject,
    })
}

/// `왼쪽\t오른쪽` → (뒤처짐, 앞섬).
pub(crate) fn parse_left_right(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let l = it.next()?.parse().ok()?;
    let r = it.next()?.parse().ok()?;
    it.next().is_none().then_some((l, r))
}

/// `<옛> <새> <이름> <이메일> <시각> <시간대>\t<글>` → (시각, 글). 이름 · 이메일은 버린다.
pub(crate) fn parse_reflog_file_line(line: &str) -> Option<(i64, String)> {
    let (head, msg) = line.trim_end_matches(['\r', '\n']).split_once('\t')?;
    let mut parts = head.rsplitn(3, ' ');
    let _tz = parts.next()?;
    let at = parts.next()?.parse().ok()?;
    Some((at, msg.to_string()))
}

pub(crate) fn created_from(msg: &str) -> Option<String> {
    let from = msg.strip_prefix("branch: Created from ")?.trim();
    (!from.is_empty()).then(|| from.to_string())
}

/// 주 브랜치는 늘 넣는다. 둘째 값은 "잘렸나".
pub(crate) fn select_refs(refs: &[RefLine], main: Option<&str>) -> (Vec<RefLine>, bool) {
    let mut seen: Vec<&str> = Vec::new();
    let mut unique: Vec<&RefLine> = Vec::new();
    for r in refs {
        if !seen.contains(&r.name.as_str()) {
            seen.push(&r.name);
            unique.push(r);
        }
    }
    let truncated = unique.len() > MAX_BRANCHES;
    let mut out: Vec<RefLine> = unique
        .iter()
        .take(MAX_BRANCHES)
        .map(|r| (*r).clone())
        .collect();
    if let Some(m) = main {
        if !out.iter().any(|r| r.name == m) {
            if let Some(r) = unique.iter().find(|r| r.name == m) {
                if out.len() >= MAX_BRANCHES {
                    out.pop();
                }
                out.push((*r).clone());
            }
        }
    }
    (out, truncated)
}

pub(crate) fn main_of(list: &[WorktreeInfo]) -> Option<String> {
    list.first()
        .filter(|w| !w.bare)
        .and_then(|w| w.branch.clone())
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 바뀐 파일 (`-z` 낱말들)
// ---------------------------------------------------------------------------

/// 원격 묶음의 끝 표식 — 레코드가 시작하는 자리에서만 본다(경로 칸은 읽지 않는다 — 그 자리의 같은 글자는 파일 이름이다).
const END: &str = "aynx-end";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NameStatus {
    pub status: char,
    pub path: String,
    pub old_path: Option<String>,
}

fn ns_letter(s: &str) -> char {
    match s.chars().next() {
        Some('A') | Some('C') => 'A',
        Some('D') => 'D',
        Some('R') => 'R',
        _ => 'M',
    }
}

/// 끝나거나 [`END`] 를 만나면 멈춘다. 이름 바뀜 · 복사는 낱말 둘(옛 · 새).
pub(crate) fn parse_name_status<'a>(it: &mut impl Iterator<Item = &'a str>) -> Vec<NameStatus> {
    let mut out = Vec::new();
    while let Some(tok) = it.next() {
        if tok.is_empty() {
            continue;
        }
        if tok == END {
            break;
        }
        let two = matches!(tok.chars().next(), Some('R') | Some('C'));
        let first = match it.next() {
            Some(p) => p.to_string(),
            None => break,
        };
        let (path, old_path) = if two {
            match it.next() {
                Some(p) => (p.to_string(), Some(first)),
                None => break,
            }
        } else {
            (first, None)
        };
        out.push(NameStatus {
            status: ns_letter(tok),
            path,
            old_path,
        });
    }
    out
}

/// 바이너리(`-`)는 `None`. 이름 바뀜은 `a\td\t` 뒤에 옛 · 새 낱말이 따로 오고 열쇠는 새 이름이다.
pub(crate) fn parse_numstat<'a>(
    it: &mut impl Iterator<Item = &'a str>,
) -> HashMap<String, Option<(u32, u32)>> {
    let mut out = HashMap::new();
    while let Some(tok) = it.next() {
        if tok.is_empty() {
            continue;
        }
        if tok == END {
            break;
        }
        let mut f = tok.splitn(3, '\t');
        let (Some(a), Some(d), Some(rest)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        let counts = match (a.parse::<u32>(), d.parse::<u32>()) {
            (Ok(a), Ok(d)) => Some((a, d)),
            _ => None,
        };
        let path = if rest.is_empty() {
            let _old = it.next();
            match it.next() {
                Some(p) => p.to_string(),
                None => break,
            }
        } else {
            rest.to_string()
        };
        out.insert(path, counts);
    }
    out
}

/// `XY 경로` — 앞자리(인덱스)가 이름 바뀜 · 복사면 다음 낱말이 옛 이름. 무시된 것(`!!`)은 뺀다.
pub(crate) fn parse_status_z<'a>(it: &mut impl Iterator<Item = &'a str>) -> Vec<NameStatus> {
    let mut out = Vec::new();
    while let Some(tok) = it.next() {
        if tok.is_empty() {
            continue;
        }
        if tok == END {
            break;
        }
        let (Some(xy), Some(path)) = (tok.get(..2), tok.get(3..)) else {
            continue;
        };
        let x = xy.as_bytes()[0];
        let old_path = if x == b'R' || x == b'C' {
            it.next().map(str::to_string)
        } else {
            None
        };
        let status = if xy.contains('R') {
            'R'
        } else {
            match classify(xy) {
                Some(Change::Added) => 'A',
                Some(Change::Deleted) => 'D',
                Some(Change::Modified) => 'M',
                None => continue,
            }
        };
        out.push(NameStatus {
            status,
            path: path.to_string(),
            old_path: old_path.filter(|_| status == 'R'),
        });
    }
    out
}

/// 원격 `<n>\t<경로>` — 숫자가 아니면(바이너리 `-` · 건너뜀) 그 파일은 모름.
pub(crate) fn parse_untracked_lines<'a>(
    it: &mut impl Iterator<Item = &'a str>,
) -> HashMap<String, u32> {
    let mut out = HashMap::new();
    for tok in it.by_ref() {
        if tok.is_empty() {
            continue;
        }
        if tok == END {
            break;
        }
        if let Some((n, path)) = tok.split_once('\t') {
            if let Ok(n) = n.trim().parse() {
                out.insert(path.to_string(), n);
            }
        }
    }
    out
}

/// `untracked` 는 추적 안 한 새 파일(`??`)의 더한 줄 — 커밋 안 함 묶음에서만 쓴다.
pub(crate) fn merge_files(
    list: Vec<NameStatus>,
    counts: &HashMap<String, Option<(u32, u32)>>,
    untracked: &HashMap<String, u32>,
) -> (Vec<ChangedFile>, bool) {
    let truncated = list.len() > MAX_FILES;
    let files = list
        .into_iter()
        .take(MAX_FILES)
        .map(|f| {
            let c = counts
                .get(&f.path)
                .copied()
                .flatten()
                .or_else(|| untracked.get(&f.path).map(|n| (*n, 0)));
            ChangedFile {
                added: c.map(|x| x.0),
                deleted: c.map(|x| x.1),
                status: f.status.to_string(),
                path: f.path,
                old_path: f.old_path,
            }
        })
        .collect();
    (files, truncated)
}

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

pub(crate) fn git_ok(dir: &Path, args: &[&str]) -> Option<String> {
    run_git(dir, args, LOCAL_TIMEOUT)
        .ok()
        .filter(|r| r.ok)
        .map(|r| r.stdout)
}

/// `rev-parse --git-common-dir` 은 저장소 기준 상대 경로를 줄 수 있다.
pub(crate) fn common_dir(repo: &Path) -> Option<PathBuf> {
    let s = git_ok(repo, &["rev-parse", "--git-common-dir"])?;
    let p = PathBuf::from(s.trim());
    Some(if p.is_absolute() { p } else { repo.join(p) })
}

fn untracked_lines(path: &Path) -> Option<u32> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > UNTRACKED_MAX_BYTES {
        return None;
    }
    text_lines(&std::fs::read(path).ok()?)
}

/// 커밋 안 한 것의 재료 — (status 목록, HEAD 기준 numstat, 추적 안 한 새 파일의 줄 수).
pub(crate) type Uncommitted = (
    Vec<NameStatus>,
    HashMap<String, Option<(u32, u32)>>,
    HashMap<String, u32>,
);

pub(crate) fn uncommitted_parts(dir: &Path) -> Uncommitted {
    let dir = dir.to_path_buf();
    let st = git_ok(
        &dir,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ],
    )
    .unwrap_or_default();
    let list = parse_status_z(&mut st.split('\0'));
    let num = if git_ok(&dir, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_some() {
        git_ok(
            &dir,
            &[
                "--no-optional-locks",
                "diff",
                "--no-ext-diff",
                "--numstat",
                "-z",
                "-M",
                "HEAD",
                "--",
            ],
        )
        .unwrap_or_default()
    } else {
        String::new()
    };
    let mut untracked = HashMap::new();
    if let Some(r) = git_ok(
        &dir,
        &[
            "--no-optional-locks",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    ) {
        for name in r
            .split('\0')
            .filter(|n| !n.is_empty())
            .take(UNTRACKED_MAX_FILES)
        {
            if let Some(n) = untracked_lines(&dir.join(name)) {
                untracked.insert(name.to_string(), n);
            }
        }
    }
    (list, parse_numstat(&mut num.split('\0')), untracked)
}

pub(crate) fn repo_of(repo: &str) -> Result<PathBuf, String> {
    let r = repo.trim();
    if r.is_empty() {
        return Err(tr!(ko: "프로젝트 경로가 비어 있습니다", en: "The project path is empty"));
    }
    Ok(PathBuf::from(r))
}

pub(crate) fn exec_failure(e: &crate::ssh::ExecBytes, timeout: Duration) -> Option<String> {
    if let Some(err) = &e.error {
        return Some(err.clone());
    }
    if e.timed_out {
        return Some(tr!(
            ko: "원격 git 이 {secs}초 안에 답하지 않았습니다",
            en: "The remote git did not answer within {secs} seconds",
            secs = timeout.as_secs()
        ));
    }
    None
}

#[cfg(test)]
mod tests;
