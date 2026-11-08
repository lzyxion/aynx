//! **조정자 `get_diff`**(통합 설계 2026-10-15-orchestration-integration-design 3-1 · D13 — 1단계): 보고 하나의 **고정 OID**
//! (`Report.base_commit_oid` … `Report.commit_oid`)로 바뀐 파일 목록 + 파일별 패치 한 쪽. 보드의 [파일 목록](op
//! `orchestration_report_files`)이 같은 목록을 쓴다.
//!
//! 불변식:
//! - **읽기 전용** · **자기 Run 만**(조정자 — `coordinator_slot`). 대상은 보고 기록의 두 OID 다 — worktree 의 지금 상태 · 브랜치 이름이
//!   아니다(보고 뒤 작업자가 더 커밋해도 같은 답). 응답에 늘 `reportId · base · commit` 을 싣는다.
//! - git 은 서버 집행 실행기(`git.rs` — 신뢰된 git · 셸 없음 · `GIT_*` 걷기 · 훅 끔)로 Run 저장소에서, `diff --no-ext-diff --no-textconv
//!   --no-color -M`(외부 diff · textconv 프로그램을 돌리지 않는다 — 시스템 설정의 `diff.astextplain.textconv` 도) + `--attr-source=<보고
//!   커밋>`(주 작업 폴더의 `.gitattributes` 가 아니라 그 커밋의 속성 — git 2.42+). 잠금 **밖**.
//! - **잘림을 숨기지 않는다** — 파일 [`FILES_MAX`] 개 넘음 · git 출력 상한 · 패치 [`PATCH_MAX`] 넘음은 모두 `truncated: true`. 패치는
//!   [`PAGE_BYTES`] 쪽(줄 경계 — 아주 긴 줄만 글자 경계)으로 나눠 `page/pages` 를 싣는다.

use std::ffi::OsString;
use std::path::Path;

use serde_json::{json, Value};

use super::git::{child_env, hex40, Git};
use super::model::*;
use super::store::{not_found_run, reason, OrchError, Orchestration, Slot};
use super::tools::{bad, coordinator_slot, opt_text, req_text};

/// 목록에 싣는 파일 상한.
pub(crate) const FILES_MAX: usize = 500;
/// 패치 한 쪽(바이트).
pub(crate) const PAGE_BYTES: usize = 32 * 1024;
/// 파일 하나의 패치를 읽는 상한(바이트) — 넘으면 거기까지만 쪽으로 나누고 `truncated`.
pub(crate) const PATCH_MAX: usize = 1024 * 1024;
/// 목록 git(numstat · name-status) 출력 상한.
const LIST_OUT_MAX: usize = 8 * 1024 * 1024;

/// 고정된 대상 — 보고 하나의 두 OID.
#[derive(Debug, Clone)]
pub(crate) struct Target {
    pub repo: String,
    pub task_id: String,
    pub report_id: String,
    pub attempt_id: String,
    pub base: String,
    pub commit: String,
}

/// 바뀐 파일 한 줄.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileEntry {
    pub path: String,
    pub old_path: Option<String>,
    /// `added` · `modified` · `deleted` · `renamed` · `copied` · `type-changed` · `unmerged` · `unknown`.
    pub status: &'static str,
    pub adds: Option<u64>,
    pub dels: Option<u64>,
    pub binary: bool,
}

impl FileEntry {
    fn json(&self) -> Value {
        let mut v = json!({
            "path": self.path,
            "status": self.status,
            "adds": self.adds,
            "dels": self.dels,
            "binary": self.binary,
        });
        if let (Some(o), Some(m)) = (&self.old_path, v.as_object_mut()) {
            m.insert("oldPath".into(), json!(o));
        }
        v
    }
}

fn status_word(letter: char) -> &'static str {
    match letter {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'T' => "type-changed",
        'U' => "unmerged",
        _ => "unknown",
    }
}

/// `diff --name-status -z` → `(상태 글자, 옛 경로?, 경로)` 들(순수). 이름 바꿈 · 복사는 `R100\0옛\0새\0`.
pub(crate) fn parse_name_status(out: &str) -> Vec<(char, Option<String>, String)> {
    let mut v = Vec::new();
    let mut it = out.split('\0');
    while let Some(st) = it.next() {
        let Some(letter) = st.chars().next() else { continue };
        if matches!(letter, 'R' | 'C') {
            let (Some(old), Some(new)) = (it.next(), it.next()) else { break };
            v.push((letter, Some(old.to_string()), new.to_string()));
        } else {
            let Some(p) = it.next() else { break };
            v.push((letter, None, p.to_string()));
        }
    }
    v
}

/// `diff --numstat -z` → `(새 경로, 더한 줄, 지운 줄)` 들(순수 — 바이너리는 `None`). 이름 바꿈은 `더\t지\t\0옛\0새\0`.
pub(crate) fn parse_numstat(out: &str) -> Vec<(String, Option<u64>, Option<u64>)> {
    let mut v = Vec::new();
    let mut it = out.split('\0');
    while let Some(rec) = it.next() {
        if rec.is_empty() {
            continue;
        }
        let mut f = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (f.next(), f.next(), f.next()) else { continue };
        let path = if p.is_empty() {
            // 이름 바꿈 — 다음 두 칸이 옛 · 새.
            let (Some(_old), Some(new)) = (it.next(), it.next()) else { break };
            new.to_string()
        } else {
            p.to_string()
        };
        v.push((path, a.parse().ok(), d.parse().ok()));
    }
    v
}

/// 패치를 쪽으로 나눈다(순수) — 쪽마다 [`PAGE_BYTES`] 이하, 줄 경계에서. 쪽보다 긴 줄은 글자 경계에서 자른다. 빈 패치는 빈 쪽 하나.
pub(crate) fn paginate(patch: &str, page_bytes: usize) -> Vec<String> {
    let mut pages: Vec<String> = Vec::new();
    let mut cur = String::new();
    for line in patch.split_inclusive('\n') {
        if cur.len() + line.len() > page_bytes && !cur.is_empty() {
            pages.push(std::mem::take(&mut cur));
        }
        if line.len() <= page_bytes {
            cur.push_str(line);
            continue;
        }
        // 한 줄이 한 쪽보다 길다 — 글자 경계에서.
        for ch in line.chars() {
            if cur.len() + ch.len_utf8() > page_bytes {
                pages.push(std::mem::take(&mut cur));
            }
            cur.push(ch);
        }
    }
    if !cur.is_empty() || pages.is_empty() {
        pages.push(cur);
    }
    pages
}

/// 보고 고르기(잠금 안) — `reportId` 가 있으면 그 Task 의 그 보고, 없으면 현재 Attempt 의 늦지 않은 보고(없으면 그 Task 의 마지막 보고).
/// 두 OID 가 다 있어야 한다(`no-commit`).
pub(super) fn target(slot: &Slot, task_id: &str, report_id: Option<&str>) -> Result<Target, OrchError> {
    let run = &slot.run;
    let task = run
        .task(task_id)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")))?;
    let rep: Option<&Report> = match report_id {
        Some(id) => run.reports.iter().find(|r| r.report_id == id && r.task_id == task_id),
        None => task
            .current_attempt
            .as_deref()
            .and_then(|att| run.report_of(att))
            .filter(|r| !r.late)
            .or_else(|| run.reports.iter().rev().find(|r| r.task_id == task_id)),
    };
    let rep = rep.ok_or_else(|| {
        OrchError::new(
            reason::NOT_FOUND,
            match report_id {
                Some(id) => format!("task {task_id} has no report {id}"),
                None => format!("task {task_id} has no report yet"),
            },
        )
    })?;
    let (Some(base), Some(commit)) = (
        rep.base_commit_oid.clone().filter(|b| hex40(b)),
        rep.commit_oid.clone().filter(|c| hex40(c)),
    ) else {
        return Err(OrchError::new(
            reason::NO_COMMIT,
            "that report has no base or head commit recorded — there is no diff to read",
        ));
    };
    Ok(Target {
        repo: run.repo.clone(),
        task_id: task_id.to_string(),
        report_id: rep.report_id.clone(),
        attempt_id: rep.attempt_id.clone(),
        base,
        commit,
    })
}

fn head(t: &Target) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    m.insert("taskId".into(), json!(t.task_id));
    m.insert("reportId".into(), json!(t.report_id));
    m.insert("attemptId".into(), json!(t.attempt_id));
    m.insert("base".into(), json!(t.base));
    m.insert("commit".into(), json!(t.commit));
    m
}

/// 서버 집행 git 하나(Run 저장소 · 그 커밋의 속성).
fn git_in<'a>(repo: &'a Path, env: &'a [(OsString, OsString)], hooks: &Path, limit: usize) -> Result<Git<'a>, OrchError> {
    let mut g = Git::new(repo, hooks, env, reason::GIT_FAILED)?;
    g.limit = limit;
    Ok(g)
}

/// 바뀐 파일 목록 — **블로킹**(git 둘). `(목록 — 상한까지, 전체 수, 잘림)`.
pub(crate) fn list_blocking(t: &Target, env: &[(OsString, OsString)], hooks: &Path) -> Result<(Vec<FileEntry>, usize, bool), OrchError> {
    let repo = Path::new(&t.repo);
    let g = git_in(repo, env, hooks, LIST_OUT_MAX)?;
    let attr = format!("--attr-source={}", t.commit);
    let common = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "-z"];
    let mut ns_args = vec![attr.as_str(), "diff", "--name-status"];
    ns_args.extend_from_slice(&common);
    ns_args.extend_from_slice(&[t.base.as_str(), t.commit.as_str(), "--"]);
    let ns = g.run(&ns_args, &[], None)?;
    if !ns.ok() {
        return Err(OrchError::new(reason::GIT_FAILED, ns.line()));
    }
    let mut num_args = vec![attr.as_str(), "diff", "--numstat"];
    num_args.extend_from_slice(&common);
    num_args.extend_from_slice(&[t.base.as_str(), t.commit.as_str(), "--"]);
    let num = g.run(&num_args, &[], None)?;
    if !num.ok() {
        return Err(OrchError::new(reason::GIT_FAILED, num.line()));
    }
    let stats = parse_numstat(&num.stdout);
    let names = parse_name_status(&ns.stdout);
    let total = names.len();
    let mut out: Vec<FileEntry> = Vec::new();
    for (letter, old, path) in names.into_iter().take(FILES_MAX) {
        let s = stats.iter().find(|(p, _, _)| *p == path);
        let (adds, dels) = s.map(|(_, a, d)| (*a, *d)).unwrap_or((None, None));
        // numstat 의 `-\t-` = 바이너리(줄 수 없음). 목록에 없으면(잘린 출력) 모른다 — 바이너리로 치지 않는다.
        let binary = s.is_some() && adds.is_none() && dels.is_none();
        out.push(FileEntry {
            path,
            old_path: old,
            status: status_word(letter),
            adds,
            dels,
            binary,
        });
    }
    let truncated = total > FILES_MAX || ns.truncated || num.truncated;
    Ok((out, total, truncated))
}

/// 파일 하나의 패치 — **블로킹**. 그 경로가 목록에 있어야 한다(이름 바꿈이면 옛 경로도 pathspec 에 — 짝을 잃지 않게).
pub(crate) fn patch_blocking(
    t: &Target,
    entry: &FileEntry,
    env: &[(OsString, OsString)],
    hooks: &Path,
) -> Result<(String, bool), OrchError> {
    let repo = Path::new(&t.repo);
    let g = git_in(repo, env, hooks, PATCH_MAX)?;
    let attr = format!("--attr-source={}", t.commit);
    let lit_new = format!(":(literal){}", entry.path);
    let lit_old = entry.old_path.as_ref().map(|o| format!(":(literal){o}"));
    let mut args = vec![
        attr.as_str(),
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "-M",
        t.base.as_str(),
        t.commit.as_str(),
        "--",
    ];
    if let Some(o) = &lit_old {
        args.push(o.as_str());
    }
    args.push(lit_new.as_str());
    let o = g.run(&args, &[], None)?;
    if !o.ok() {
        return Err(OrchError::new(reason::GIT_FAILED, o.line()));
    }
    Ok((o.stdout, o.truncated))
}

fn server_env() -> Vec<(OsString, OsString)> {
    child_env(std::env::vars_os())
}

/// 목록 응답(조정자 · 보드 공용).
fn list_value(t: &Target) -> Result<Value, OrchError> {
    let env = server_env();
    let hooks = super::worktree::empty_hooks_dir();
    let (files, total, truncated) = list_blocking(t, &env, &hooks)?;
    let mut m = head(t);
    m.insert("files".into(), Value::Array(files.iter().map(FileEntry::json).collect()));
    m.insert("fileCount".into(), json!(total));
    m.insert("truncated".into(), json!(truncated));
    if truncated {
        m.insert(
            "note".into(),
            json!(format!("the file list is cut — only the first {} of {total} files are listed; do not claim you saw every change", files.len())),
        );
    }
    Ok(Value::Object(m))
}

impl Orchestration {
    /// 조정자 `get_diff` — `{taskId, reportId?}` → 파일 목록, `{…, path, page?}` → 그 파일 패치 한 쪽. 잠금은 대상 고르기에만.
    pub(super) fn get_diff(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let task_id = req_text(args, "taskId", 64)?;
        let report_id = opt_text(args, "reportId", 64)?;
        let path = opt_text(args, "path", 4096)?;
        let page = page_arg(args)?;
        let now = self.now();
        let t = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            target(slot, &task_id, report_id.as_deref())?
        };
        answer(&t, path, page)
    }

    /// 검토자 `get_diff`(통합 설계 3-3 — 5단계) — **자기 Task 의 고정 대상 보고만**(`Attempt.review_of` — 검토자는 대상을 고르지 못한다).
    /// 답 모양은 조정자의 것과 같다. 읽기 전용.
    pub(super) fn reviewer_diff(&self, run_id: &str, attempt_id: &str, args: Option<&Value>) -> Result<Value, OrchError> {
        let path = opt_text(args, "path", 4096)?;
        let page = page_arg(args)?;
        let t = {
            let g = self.lock();
            let slot = g.runs.get(run_id).filter(|s| s.run.state != RunState::Orphaned).ok_or_else(not_found_run)?;
            let a = slot
                .run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id && a.is_reviewer())
                .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such review attempt"))?;
            let of = a.review_of.as_ref().ok_or_else(|| OrchError::new(reason::NOT_FOUND, "this attempt has no review target"))?;
            target(slot, &a.task_id, Some(&of.report_id))?
        };
        answer(&t, path, page)
    }
}

/// `page` 인자(1 부터 — 없으면 1).
fn page_arg(args: Option<&Value>) -> Result<usize, OrchError> {
    match super::tools::arg(args, "page") {
        None => Ok(1),
        Some(v) => Ok(v
            .as_u64()
            .filter(|&n| n >= 1)
            .ok_or_else(|| bad("page must be a whole number from 1"))? as usize),
    }
}

/// 목록(경로 없음) 또는 파일 하나의 패치 한 쪽 — 조정자 · 검토자 공용. **블로킹**(git) · 잠금 밖.
fn answer(t: &Target, path: Option<String>, page: usize) -> Result<Value, OrchError> {
    let Some(path) = path else {
        return list_value(t);
    };
    let env = server_env();
    let hooks = super::worktree::empty_hooks_dir();
    let (files, _, _) = list_blocking(t, &env, &hooks)?;
    let entry = files.iter().find(|f| f.path == path).cloned().ok_or_else(|| {
        OrchError::new(
            reason::NOT_FOUND,
            "that path is not in this report's file list — call get_diff without path to list the files",
        )
    })?;
    let (patch, cut) = patch_blocking(t, &entry, &env, &hooks)?;
    let pages = paginate(&patch, PAGE_BYTES);
    let n = pages.len();
    if page > n {
        return Err(bad(format!("page {page} is past the last page ({n})")));
    }
    let mut m = head(t);
    m.insert("file".into(), entry.json());
    m.insert("page".into(), json!(page));
    m.insert("pages".into(), json!(n));
    m.insert("patch".into(), json!(pages[page - 1]));
    m.insert("truncated".into(), json!(cut));
    if cut {
        m.insert(
            "note".into(),
            json!(format!("this file's patch is longer than {} bytes — the pages stop there; do not claim you read it in full", PATCH_MAX)),
        );
    }
    Ok(Value::Object(m))
}

impl Orchestration {
    /// 보드의 [파일 목록](op `orchestration_report_files`) — 조정자 `get_diff` 의 목록과 같다. orphaned Run 도 읽는다(읽기 전용).
    pub(crate) fn report_files(&self, run_id: &str, task_id: &str, report_id: Option<&str>) -> Result<Value, OrchError> {
        let t = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            target(slot, task_id, report_id)?
        };
        list_value(&t)
    }
}

// ---------------------------------------------------------------------------
// 작업 중 파일(오케스트레이션 탭 ③ 작업자 상세 — 노트 2026-10-29-orchestration-player-tab 0-3 Q4)
// ---------------------------------------------------------------------------

/// 작업 중 파일 목록에 싣는 상한.
pub(crate) const WIP_FILES_MAX: usize = 200;
/// 작업 중 목록 git 한 번의 시한 — 화면이 기다리는 읽기라 큰 저장소에서 오래 막지 않게.
const WIP_GIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// 작업 중 목록 git 출력 상한(바이트).
const WIP_OUT_MAX: usize = 2 * 1024 * 1024;
/// 추적 안 된 새 파일의 줄을 세는 크기 상한(바이트) — 넘으면 줄 수 없이 "새 파일".
const UNTRACKED_COUNT_MAX: u64 = 512 * 1024;

/// `status --porcelain -z` → `(XY, 경로)` 들(순수). 이름 바꿈 · 복사(`R` · `C`)는 원래 경로가 다음 칸에 한 번 더 온다(건너뛴다).
pub(crate) fn parse_porcelain_z(out: &str) -> Vec<(String, String)> {
    let mut v = Vec::new();
    let mut it = out.split('\0');
    while let Some(rec) = it.next() {
        if rec.len() < 4 || !rec.is_char_boundary(2) || !rec.is_char_boundary(3) {
            continue;
        }
        let xy = &rec[..2];
        v.push((xy.to_string(), rec[3..].to_string()));
        if xy.contains('R') || xy.contains('C') {
            it.next();
        }
    }
    v
}

/// 바이트의 줄 수(순수) — NUL 이 있으면 바이너리(`None`). 마지막 줄에 줄바꿈이 없어도 한 줄로 센다(빈 파일은 0).
pub(crate) fn text_lines(bytes: &[u8]) -> Option<u64> {
    if bytes.contains(&0) {
        return None;
    }
    let n = bytes.iter().filter(|&&b| b == b'\n').count() as u64;
    Some(if bytes.last().is_some_and(|&b| b != b'\n') { n + 1 } else { n })
}

/// 추적 안 된 새 파일의 줄 수 — `(줄 수, 바이너리)`. 경로는 worktree 안의 평범한 마디만(`..` · 절대 경로 거절) · 링크는 따라가지
/// 않는다 · 크기 상한을 넘으면 세지 않는다(줄 수 없음).
fn untracked_lines(root: &Path, rel: &str) -> (Option<u64>, bool) {
    let p = Path::new(rel);
    if !p.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
        return (None, false);
    }
    let full = root.join(p);
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        return (None, false);
    };
    if !meta.is_file() || meta.len() > UNTRACKED_COUNT_MAX {
        return (None, false);
    }
    match std::fs::read(&full) {
        Ok(bytes) => match text_lines(&bytes) {
            Some(n) => (Some(n), false),
            None => (None, true),
        },
        Err(_) => (None, false),
    }
}

fn clean_path(p: &str) -> String {
    p.chars().filter(|c| !c.is_control()).collect()
}

/// **작업 중 파일 목록**(작업자 상세의 곁 카드 — 사람 화면 전용 · 읽기 전용) — 그 worktree 의 지금 작업 트리를 기준 커밋(없으면 `HEAD`)과
/// 비교한 파일마다 `{path, status, adds, dels, binary, uncommitted, untracked?}`(커밋된 것 + 미커밋 + 추적 안 된 새 파일).
/// **블로킹** — git 셋(`diff --name-status` · `diff --numstat` · `status --porcelain`) · 잠금 밖.
///
/// - 서버 집행 실행기(`git.rs` — 신뢰된 git · 셸 없음 · `GIT_*` 걷기 · 훅 · fsmonitor 끔) · `--no-ext-diff --no-textconv`(외부 diff ·
///   textconv 프로그램을 돌리지 않는다). 작업 트리를 읽는 diff · status 는 그 저장소 설정의 clean 필터를 탈 수 있다 — 보고 · 보고 뒤
///   변경의 `status` 읽기(`report::git_probe`)와 같은 등급이다.
/// - 경로는 부르는 쪽이 Attempt 기록에서 꺼낸 worktree 하나뿐(화면이 경로를 주지 않는다). 상한: 파일 [`WIP_FILES_MAX`] · git 한 번
///   [`WIP_GIT_TIMEOUT`] · 출력 [`WIP_OUT_MAX`] — 넘으면 `truncated`(숨기지 않는다).
pub(crate) fn wip_blocking(worktree: &Path, base: Option<&str>, env: &[(OsString, OsString)], hooks: &Path) -> Result<Value, OrchError> {
    if !worktree.is_dir() {
        return Err(OrchError::new(reason::GIT_FAILED, "the worktree folder is missing"));
    }
    let mut g = Git::new(worktree, hooks, env, reason::GIT_FAILED)?;
    g.limit = WIP_OUT_MAX;
    g.timeout = WIP_GIT_TIMEOUT;
    let base = base.filter(|b| hex40(b));
    let from = base.unwrap_or("HEAD");
    let common = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-z"];
    let diff = |kind: &str| {
        let mut args = vec!["diff", kind];
        args.extend_from_slice(&common);
        args.extend_from_slice(&[from, "--"]);
        g.run(&args, &[], None)
    };
    let ns = diff("--name-status")?;
    let num = diff("--numstat")?;
    let st = g.run(&["status", "--porcelain", "-z", "--untracked-files=all"], &[], None)?;
    if !st.ok() {
        return Err(OrchError::new(reason::GIT_FAILED, st.line()));
    }
    let changes = parse_porcelain_z(&st.stdout);
    let uncommitted: std::collections::HashSet<&str> = changes.iter().map(|(_, p)| p.as_str()).collect();
    // 빈 저장소(HEAD 없음)면 추적 비교가 실패한다 — 그때는 추적 안 된 파일만.
    let (names, stats) = if ns.ok() && num.ok() {
        (parse_name_status(&ns.stdout), parse_numstat(&num.stdout))
    } else {
        (Vec::new(), Vec::new())
    };
    let stats: std::collections::HashMap<&str, (Option<u64>, Option<u64>)> = stats.iter().map(|(p, a, d)| (p.as_str(), (*a, *d))).collect();
    let mut files: Vec<Value> = Vec::new();
    let mut total = 0usize;
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for (letter, _old, path) in &names {
        seen.insert(path.as_str());
        total += 1;
        if files.len() >= WIP_FILES_MAX {
            continue;
        }
        let s = stats.get(path.as_str());
        let (adds, dels) = s.copied().unwrap_or((None, None));
        files.push(json!({
            "path": clean_path(path),
            "status": status_word(*letter),
            "adds": adds,
            "dels": dels,
            "binary": s.is_some() && adds.is_none() && dels.is_none(),
            "uncommitted": uncommitted.contains(path.as_str()),
        }));
    }
    for (xy, path) in &changes {
        if xy != "??" || seen.contains(path.as_str()) {
            continue;
        }
        total += 1;
        if files.len() >= WIP_FILES_MAX {
            continue;
        }
        let (adds, binary) = untracked_lines(worktree, path);
        files.push(json!({
            "path": clean_path(path),
            "status": "added",
            "adds": adds,
            "dels": if binary || adds.is_none() { Value::Null } else { json!(0) },
            "binary": binary,
            "uncommitted": true,
            "untracked": true,
        }));
    }
    let truncated = total > files.len() || ns.truncated || num.truncated || st.truncated;
    Ok(json!({ "files": files, "fileCount": total, "truncated": truncated, "base": base }))
}

/// [`wip_blocking`] 을 서버 환경으로 — 실패는 `{files: [], error}` 한 칸(화면은 목록 대신 그 한 줄).
pub(crate) fn wip_value(worktree: Option<&str>, base: Option<&str>) -> Value {
    let Some(w) = worktree else {
        return json!({ "files": [], "fileCount": 0, "truncated": false, "error": "no worktree" });
    };
    let env = server_env();
    let hooks = super::worktree::empty_hooks_dir();
    match wip_blocking(Path::new(w), base, &env, &hooks) {
        Ok(v) => v,
        Err(e) => json!({
            "files": [],
            "fileCount": 0,
            "truncated": false,
            "error": e.message.chars().filter(|c| !c.is_control()).take(240).collect::<String>(),
        }),
    }
}
