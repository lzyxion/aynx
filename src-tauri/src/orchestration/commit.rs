//! **서버가 집행하는 작업자 커밋**(`commit_changes` — 사용자 결정 10-15 · 자문 S+ 안 5 · 6절). 작업자는 **무엇을** 커밋할지(전부 ·
//! 파일 목록 · 메시지)만 정하고, git 쓰기는 세션 서버가 이 파일 하나로 한다 — 작업자 샌드박스(Codex `workspace-write`)는 `.git` 쓰기 없이
//! 그대로 둔다(10-15 이전의 `writable_roots` 시도는 효과가 없어 걷었다).
//!
//! 불변식:
//! - **자리는 서버 기록에서만** — worktree 경로 · 브랜치 · 저장소는 그 Attempt 의 서버 기록이고, 요청의 cwd · gitdir · ref · git 옵션은
//!   받지 않는다(스키마에 없고, 와도 무시한다). 실행 전에 그 worktree 의 최상위 · 공용 git 디렉터리가 **Run 저장소의 `.git`** 인지
//!   실제 경로로 다시 본다(작업자가 `.git` 포인터 파일을 바꿔 다른 저장소를 가리키게 해도 거절 `worktree-mismatch`).
//! - **git 실행** — 신뢰된 절대 경로의 실행 파일(PATH 의 절대 폴더에서 찾은 것 · 처음 한 번) · 셸 없음 · 인자 배열 · 환경은 서버 자기 환경에서
//!   **`GIT_*` 를 모두 걷은 것**(작업자 환경은 애초에 물려받지 않는다) · `-c core.hooksPath=<빈 폴더>` · `core.fsmonitor=false` ·
//!   `commit.gpgSign=false`(+ `--no-gpg-sign`) · editor/pager 끔(`--no-pager` · `core.editor=:` · `core.pager=cat`) · 자동 정리 끔 ·
//!   `GIT_TERMINAL_PROMPT=0` · 시한.
//!   실행기는 공용 `git.rs`(통합 설계 1단계 — 끝 코드 보존 · stdout 바이트 상한, 넘으면 `output-too-large`).
//! - **필터** — `.gitattributes` 의 clean/process 필터는 외부 프로그램을 돌린다. 설정(시스템 · 전역 · 저장소 어디든)에 clean/process 가 있는
//!   필터 이름을, 이번에 stage 할 수 있는 파일(전부 = `ls-files` 의 추적 + 무시되지 않은 새 파일, 목록 = 그 파일들)이 `filter` 속성으로
//!   쓰면 **거절**(`filters-configured` — 사람에게 안내). `--no-filters` 계열(원시 내용 저장)은 LFS · 줄바꿈 의미가 바뀌어 고르지 않았다
//!   (보수적). Git for Windows 는 시스템 설정에 `filter.lfs` 를 늘 두므로 "설정이 있다" 만으로 거절하지 않고 **속성이 그 이름을 쓸 때만**
//!   거절한다. 한계: 검사와 stage 사이에 작업자가 `.gitattributes` 를 바꾸면 설정된(사람 · 시스템이 정한) 필터가 돌 수 있다 — 작업자가
//!   필터 **명령**을 새로 정할 수는 없다(그건 `.git/config` 쓰기라 샌드박스 작업자에게 없다).
//! - **전용 임시 index** — `GIT_INDEX_FILE` = 서버가 정한 임시 파일에 `read-tree <HEAD>` → 선택분만 `add -A`(목록은 `:(literal)` ·
//!   NUL 구분 · stdin) → `write-tree` → `commit-tree -p <HEAD>` → `update-ref refs/heads/<브랜치> <새> <옛>`(CAS — 그사이 움직였으면
//!   `head-moved`). 실제 worktree index 는 커밋 뒤 `read-tree <새>` + `update-index --refresh` 로 맞춘다(작업 파일은 건드리지 않는다 ·
//!   ref 를 움직이는 `reset` 은 쓰지 않는다).
//! - **신원** — 저장소 · 사용자 git 설정의 `user.name` · `user.email` 그대로(작업자가 고르지 못한다). 없으면 `no-git-identity`.
//!   메시지 끝에 trailer `Aynx-Task` · `Aynx-Attempt`(작업자가 쓴 같은 이름의 줄은 걷는다).
//! - **경로** — 상대 경로만 · `..` · 절대 · 드라이브 · `:` · `.git` 낱말(대소문자 · 끝 점/공백 무시) 거절 · 실제 경로가 worktree 밖이면
//!   거절(정션 · 심볼릭 링크 부모) · 폴더는 받지 않는다(파일 단위) — 모두 `path-outside` · `invalid-argument`. 상한: 파일 [`PATHS_MAX`] ·
//!   메시지 [`MESSAGE_MAX`].

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub(crate) use super::git::child_env;
use super::git::{hex40, Git};

use super::model::{commit_needs_human, Actor, AttemptState, CommitRejection, RunState, WorkerCommit, CHANGED_FILES_MAX};
use super::store::{reason, release_request, request_seen, reserve_request, OrchError, Orchestration, Slot};
use super::tools::{arg, bad, opt_text, req_text, request_id};
use crate::audit::OrchestrationAudit;

/// 메시지 상한(바이트 — trailer 제외).
pub(crate) const MESSAGE_MAX: usize = 8 * 1024;
/// 파일 목록 상한.
pub(crate) const PATHS_MAX: usize = 500;
/// 경로 하나의 상한(바이트).
const PATH_MAX: usize = 1024;
/// 보드에 싣는 메시지 첫 줄 상한(글자).
pub(crate) const SUBJECT_MAX: usize = 120;
/// 무엇을 커밋하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Selection {
    /// worktree 의 모든 변경(추가 · 수정 · 삭제 · 무시되지 않은 새 파일).
    All,
    /// 이 파일들만(worktree 기준 상대 경로 — 검사 전 글자).
    Paths(Vec<String>),
}

/// 커밋 한 번의 재료 — 자리는 **서버 기록**에서 온다.
pub(crate) struct CommitJob<'a> {
    /// Run 저장소(주 작업 폴더) — 공용 git 디렉터리 확인.
    pub repo: &'a Path,
    /// Attempt 의 worktree.
    pub worktree: &'a Path,
    /// Attempt 의 브랜치(`refs/heads/` 없이).
    pub branch: &'a str,
    pub expected_head: Option<&'a str>,
    pub selection: &'a Selection,
    /// 최종 메시지(trailer 포함 — [`final_message`]).
    pub message: &'a str,
    /// 빈 훅 폴더.
    pub hooks_dir: &'a Path,
    /// 임시 index 를 둘 폴더(절대 경로).
    pub index_dir: &'a Path,
    /// 자식 git 의 환경 재료 — 보통 서버 자기 환경(`std::env::vars_os`). [`child_env`] 가 `GIT_*` 를 걷는다.
    pub env: Vec<(OsString, OsString)>,
    /// 충돌 해결 Attempt 면 표식 검사(통합 설계 3b · 3-2) — 새 트리의 충돌 경로에 표식이 남으면 `conflict-markers-left`.
    pub markers: Option<&'a super::resolve::MarkerCheck>,
}

/// 커밋 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Committed {
    pub commit: String,
    pub parent: String,
    pub branch: String,
    pub files: usize,
    /// 커밋 뒤 남은 변경(추적 안 된 파일 포함 · 무시 파일 제외 — 상한 [`CHANGED_FILES_MAX`]).
    pub remaining: Vec<String>,
    pub remaining_truncated: bool,
    /// 실제 index 맞추기가 실패했다(커밋 · ref 는 섰다 — 작업자의 git 이 index 를 잡고 있었다 등). 경고만.
    pub index_sync_failed: bool,
}

fn fail(code: &'static str, msg: impl Into<String>) -> OrchError {
    OrchError::new(code, msg)
}

fn failed(msg: impl Into<String>) -> OrchError {
    fail(reason::COMMIT_FAILED, msg)
}

/// 메시지 다듬기(순수) — 제어 문자(TAB · LF 빼고)를 지우고, 작업자가 쓴 `Aynx-*:` 줄을 걷고, 끝에 trailer 둘을 붙인다.
/// 빈 메시지면 `None`.
pub(crate) fn final_message(raw: &str, task_id: &str, attempt_id: &str) -> Option<String> {
    let clean = super::spawn::sanitize_text(raw);
    let body: Vec<&str> = clean
        .lines()
        .filter(|l| !l.trim_start().to_ascii_lowercase().starts_with("aynx-"))
        .collect();
    let body = body.join("\n");
    let body = body.trim_end();
    if body.trim().is_empty() {
        return None;
    }
    Some(format!("{body}\n\nAynx-Task: {task_id}\nAynx-Attempt: {attempt_id}\n"))
}

/// 메시지 첫 줄(보드 — 제어 문자 없이 [`SUBJECT_MAX`] 글자까지).
pub(crate) fn subject(message: &str) -> String {
    message
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(SUBJECT_MAX)
        .collect()
}

/// 경로 하나를 검사해 worktree 기준 `/` 상대 경로로(순수 부분 + 실제 경로 확인). `wt_real` 은 worktree 의 실제 경로.
pub(crate) fn check_path(wt_real: &Path, raw: &str) -> Result<String, OrchError> {
    let outside = |why: &str| fail(reason::PATH_OUTSIDE, format!("path {:?} is not allowed: {why}", short(raw)));
    if raw.is_empty() || raw.len() > PATH_MAX || raw.chars().any(char::is_control) {
        return Err(fail(reason::INVALID_ARGUMENT, "each path must be a non-empty relative file path (≤1024 bytes, no control characters)"));
    }
    let s = raw.replace('\\', "/");
    let b = s.as_bytes();
    if s.starts_with('/') || (b.len() >= 2 && b[1] == b':') {
        return Err(outside("absolute paths are not accepted — give a path relative to your worktree"));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in s.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(outside("'..' is not accepted")),
            p => {
                if p.contains(':') {
                    return Err(outside("':' is not accepted in a path"));
                }
                let bare = p.trim_end_matches(['.', ' ']);
                if bare.eq_ignore_ascii_case(".git") {
                    return Err(outside("paths under .git are not accepted"));
                }
                parts.push(p);
            }
        }
    }
    if parts.is_empty() {
        return Err(fail(reason::INVALID_ARGUMENT, "a path names no file"));
    }
    let rel = parts.join("/");
    let full = wt_real.join(&rel);
    let real = super::worktree::real_path(&full).ok_or_else(|| outside("it cannot be resolved"))?;
    let base = crate::worktree::comparable(&wt_real.to_string_lossy());
    let got = crate::worktree::comparable(&real.to_string_lossy());
    if !got.starts_with(&format!("{base}/")) {
        return Err(outside("it resolves outside your worktree (a link?)"));
    }
    if full.is_dir() {
        return Err(fail(reason::INVALID_ARGUMENT, format!("path {:?} is a folder — list the files", short(raw))));
    }
    Ok(rel)
}

fn short(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(120).collect()
}

/// 임시 index 파일 — 떨어지면 지운다(`.lock` 도).
struct TempIndex(PathBuf);

impl Drop for TempIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        let mut lock = self.0.clone().into_os_string();
        lock.push(".lock");
        let _ = std::fs::remove_file(PathBuf::from(lock));
    }
}

fn temp_index(dir: &Path) -> Result<TempIndex, OrchError> {
    std::fs::create_dir_all(dir).map_err(|e| failed(format!("no index folder: {e}")))?;
    let mut b = [0u8; 12];
    getrandom::fill(&mut b).map_err(|_| failed("no randomness source"))?;
    let name: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(TempIndex(dir.join(format!("commit-{name}.index"))))
}

/// 같은 자리인가(실제 경로 · 비교 열쇠).
fn same_place(a: &Path, b: &Path) -> bool {
    match (super::worktree::real_path(a), super::worktree::real_path(b)) {
        (Some(x), Some(y)) => crate::worktree::comparable(&x.to_string_lossy()) == crate::worktree::comparable(&y.to_string_lossy()),
        _ => false,
    }
}

/// 설정된 clean/process 필터 이름들(시스템 · 전역 · 저장소 · include 모두 — git 이 읽는 그대로).
fn configured_filters(g: &Git<'_>) -> Result<Vec<String>, OrchError> {
    let o = g.run(&["config", "-z", "--get-regexp", r"^filter\..*\.(clean|process)$"], &[], None)?;
    // 종료 1 = 없음.
    let mut names: Vec<String> = Vec::new();
    for rec in o.stdout.split('\0').filter(|r| !r.is_empty()) {
        // `-z` 꼴 = `<키>\n<값>\0`. 키 = `filter.<이름>.clean|process`(이름은 서브섹션 — 대소문자를 가린다, 나머지는 소문자).
        let key = rec.split('\n').next().unwrap_or("");
        let lower = key.to_ascii_lowercase();
        if !lower.starts_with("filter.") {
            continue;
        }
        let cut = if lower.ends_with(".clean") {
            ".clean".len()
        } else if lower.ends_with(".process") {
            ".process".len()
        } else {
            continue;
        };
        if key.len() <= "filter.".len() + cut {
            continue;
        }
        let name = &key["filter.".len()..key.len() - cut];
        if !names.iter().any(|x| x == name) {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// 이 파일들 중 설정된 필터를 `filter` 속성으로 쓰는 것이 있나.
fn uses_filters(g: &Git<'_>, files: &[String], names: &[String]) -> Result<Option<String>, OrchError> {
    if names.is_empty() || files.is_empty() {
        return Ok(None);
    }
    let mut input: Vec<u8> = Vec::new();
    for f in files {
        input.extend_from_slice(f.as_bytes());
        input.push(0);
    }
    let out = g.ok(&["check-attr", "-z", "--stdin", "filter"], &[], Some(&input))?;
    // `<경로>\0filter\0<값>\0` 반복.
    let parts: Vec<&str> = out.split('\0').collect();
    for chunk in parts.chunks(3) {
        if let [path, _attr, value] = chunk {
            if names.iter().any(|n| n == value) {
                return Ok(Some((*path).to_string()));
            }
        }
    }
    Ok(None)
}

/// 커밋을 집행한다 — **블로킹**(git). `before_cas` 는 ref 갱신 직전에 불린다(시험이 그 틈에 HEAD 를 움직인다 — 운영은 빈 함수).
pub(crate) fn commit_blocking(job: &CommitJob<'_>, before_cas: &dyn Fn()) -> Result<Committed, OrchError> {
    if !job.worktree.is_dir() {
        return Err(fail(reason::WORKTREE_MISMATCH, "your worktree folder is missing"));
    }
    let wt_real = super::worktree::real_path(job.worktree)
        .ok_or_else(|| fail(reason::WORKTREE_MISMATCH, "your worktree folder cannot be resolved"))?;
    let env = child_env(job.env.iter().cloned());
    let g = Git::new(&wt_real, job.hooks_dir, &env, reason::COMMIT_FAILED)?;
    // 1. 자리 — 최상위 = 이 worktree · 공용 git 디렉터리 = Run 저장소의 `.git`.
    let top = g.ok(&["rev-parse", "--path-format=absolute", "--show-toplevel"], &[], None)?;
    let common = g.ok(&["rev-parse", "--path-format=absolute", "--git-common-dir"], &[], None)?;
    if !same_place(Path::new(top.trim()), &wt_real) || !same_place(Path::new(common.trim()), &job.repo.join(".git")) {
        return Err(fail(
            reason::WORKTREE_MISMATCH,
            "your worktree no longer belongs to the run's repository — a person must check it",
        ));
    }
    // 2. 브랜치 · HEAD.
    let head_ref = g.run(&["symbolic-ref", "-q", "HEAD"], &[], None)?;
    let want = format!("refs/heads/{}", job.branch);
    if !head_ref.ok() || head_ref.stdout.trim() != want {
        return Err(fail(
            reason::BRANCH_MISMATCH,
            format!("your worktree is not on its branch {} — switch back to it (the app commits only to your attempt's branch)", job.branch),
        ));
    }
    let spec = format!("{want}^{{commit}}");
    let old = g.ok(&["rev-parse", "--verify", "-q", &spec], &[], None)?.trim().to_string();
    if !hex40(&old) {
        return Err(failed("your branch has no commit"));
    }
    if let Some(e) = job.expected_head.map(str::trim).filter(|e| !e.is_empty()) {
        let e = e.to_ascii_lowercase();
        if !(7..=40).contains(&e.len()) || !e.bytes().all(|b| b.is_ascii_hexdigit()) || !old.starts_with(&e) {
            return Err(fail(
                reason::HEAD_MOVED,
                format!("your branch is at {old}, not at expectedHead — read it again before committing"),
            ));
        }
    }
    // 3. 신원 — 설정 그대로(작업자가 고르지 못한다).
    let get = |k: &str| -> Result<String, OrchError> {
        let o = g.run(&["config", "--get", k], &[], None)?;
        Ok(if o.ok() { o.stdout.trim().to_string() } else { String::new() })
    };
    let (name, email) = (get("user.name")?, get("user.email")?);
    if name.is_empty() || email.is_empty() || name.chars().any(char::is_control) || email.chars().any(char::is_control) {
        return Err(fail(
            reason::NO_GIT_IDENTITY,
            "git has no user.name / user.email for this repository — a person must set it (git config user.name … / user.email …); nothing was committed",
        ));
    }
    // 4. 고를 파일 · 필터 검사.
    let files: Vec<String> = match job.selection {
        Selection::All => {
            let o = g.ok(&["ls-files", "-z", "--cached", "--others", "--exclude-standard"], &[], None)?;
            o.split('\0').filter(|s| !s.is_empty()).map(str::to_string).collect()
        }
        Selection::Paths(list) => {
            if list.is_empty() || list.len() > PATHS_MAX {
                return Err(fail(reason::INVALID_ARGUMENT, format!("selection.paths must list 1..{PATHS_MAX} files")));
            }
            let mut out: Vec<String> = Vec::new();
            for p in list {
                let rel = check_path(&wt_real, p)?;
                if !out.contains(&rel) {
                    out.push(rel);
                }
            }
            out
        }
    };
    let names = configured_filters(&g)?;
    if let Some(p) = uses_filters(&g, &files, &names)? {
        return Err(fail(
            reason::FILTERS_CONFIGURED,
            format!(
                "{} uses a git clean/process filter (e.g. Git LFS) — the app does not run filters for you; a person must commit this change",
                short(&p)
            ),
        ));
    }
    // 5. 임시 index — HEAD 에서 → 선택분 stage.
    let idx = temp_index(job.index_dir)?;
    let idx_s = idx.0.to_string_lossy().into_owned();
    let ienv: [(&str, &str); 1] = [("GIT_INDEX_FILE", idx_s.as_str())];
    g.ok(&["read-tree", &old], &ienv, None)?;
    let add = match job.selection {
        Selection::All => g.run(&["add", "-A"], &ienv, None)?,
        Selection::Paths(_) => {
            let mut spec: Vec<u8> = Vec::new();
            for f in &files {
                spec.extend_from_slice(b":(literal)");
                spec.extend_from_slice(f.as_bytes());
                spec.push(0);
            }
            g.run(&["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], &ienv, Some(&spec))?
        }
    };
    if !add.ok() {
        let line = add.line();
        if line.contains("did not match") {
            return Err(fail(reason::INVALID_ARGUMENT, format!("a listed path has no change and is not tracked: {line}")));
        }
        return Err(failed(line));
    }
    let staged = g.ok(&["diff-index", "--cached", "--name-only", "-z", "--no-renames", &old, "--"], &ienv, None)?;
    let count = staged.split('\0').filter(|s| !s.is_empty()).count();
    if count == 0 {
        return Err(fail(reason::NOTHING_TO_COMMIT, "there is nothing to commit in the selection"));
    }
    let tree = g.ok(&["write-tree"], &ienv, None)?.trim().to_string();
    if !hex40(&tree) {
        return Err(failed("git write-tree gave no tree"));
    }
    // 5b. 충돌 해결 Attempt — 커밋할 트리의 충돌 경로에 표식이 남았으면 거절(3-2 · 표식 크기 속성 · CRLF — `resolve.rs`).
    if let Some(check) = job.markers {
        let left = super::resolve::markers_left_blocking(&g, &tree, check)?;
        if !left.is_empty() {
            return Err(super::resolve::markers_left_error(&left));
        }
    }
    // 6. 커밋 객체 — 신원은 설정에서 읽은 것(서버가 넣는다).
    let cenv: [(&str, &str); 4] = [
        ("GIT_AUTHOR_NAME", name.as_str()),
        ("GIT_AUTHOR_EMAIL", email.as_str()),
        ("GIT_COMMITTER_NAME", name.as_str()),
        ("GIT_COMMITTER_EMAIL", email.as_str()),
    ];
    let new = g
        .ok(&["commit-tree", &tree, "-p", &old, "--no-gpg-sign", "-F", "-"], &cenv, Some(job.message.as_bytes()))?
        .trim()
        .to_string();
    if !hex40(&new) {
        return Err(failed("git commit-tree gave no commit"));
    }
    drop(idx);
    // 7. CAS — 그사이 브랜치가 움직였으면 거절(만든 커밋 객체는 아무 ref 도 가리키지 않아 git 이 나중에 치운다).
    before_cas();
    let upd = g.run(&["update-ref", "-m", "aynx: commit_changes", &want, &new, &old], &[], None)?;
    if !upd.ok() {
        let now = g.run(&["rev-parse", "--verify", "-q", &spec], &[], None)?;
        if now.stdout.trim() != old {
            return Err(fail(
                reason::HEAD_MOVED,
                "your branch moved while the app was committing — nothing was committed; read the state again and retry with a new requestId",
            ));
        }
        return Err(failed(upd.line()));
    }
    // 8. 실제 index 맞추기(작업 파일은 그대로) — 실패해도 커밋은 섰다.
    let sync = g.run(&["read-tree", &new], &[], None)?;
    let index_sync_failed = !sync.ok();
    if sync.ok() {
        let _ = g.run(&["update-index", "-q", "--refresh"], &[], None);
    }
    // 9. 남은 변경.
    let st = g.run(&["status", "--porcelain", "-z", "--untracked-files=normal"], &[("GIT_OPTIONAL_LOCKS", "0")], None)?;
    let remaining = if st.ok() { super::report::porcelain_z_paths(&st.stdout) } else { Vec::new() };
    let remaining_truncated = remaining.len() >= CHANGED_FILES_MAX;
    Ok(Committed {
        commit: new,
        parent: old,
        branch: job.branch.to_string(),
        files: count,
        remaining,
        remaining_truncated,
        index_sync_failed,
    })
}

// ---------------------------------------------------------------------------
// MCP 작업자 도구 `commit_changes`
// ---------------------------------------------------------------------------

/// 임시 index 폴더 — 서버 데이터 폴더 아래(없으면 임시 폴더).
fn index_dir() -> PathBuf {
    super::persist::store_dir().unwrap_or_else(std::env::temp_dir).join("commit-index")
}

/// 인자 `selection` — `"all"` 또는 `{paths: [..]}`.
fn selection_arg(args: Option<&Value>) -> Result<Selection, OrchError> {
    match arg(args, "selection") {
        Some(Value::String(s)) if s == "all" => Ok(Selection::All),
        Some(Value::Object(o)) => {
            let Some(Value::Array(items)) = o.get("paths") else {
                return Err(bad("selection must be \"all\" or {paths: [file, …]}"));
            };
            if items.is_empty() || items.len() > PATHS_MAX {
                return Err(bad(format!("selection.paths must list 1..{PATHS_MAX} files")));
            }
            let mut out: Vec<String> = Vec::new();
            for v in items {
                let s = v.as_str().ok_or_else(|| bad("selection.paths must be an array of file paths"))?;
                out.push(s.to_string());
            }
            Ok(Selection::Paths(out))
        }
        _ => Err(bad("selection is required: \"all\" or {paths: [file, …]}")),
    }
}

/// 커밋 관문(잠금 안) — 현재 Attempt · 살아 있는 Run · 보고 전 · 열린 상태. `(worktree, 브랜치, Task id, 해결 Attempt 의 표식 검사)`.
fn commit_gate(slot: &Slot, attempt_id: &str) -> Result<(String, String, String, Option<super::resolve::MarkerCheck>), OrchError> {
    let run = &slot.run;
    if matches!(run.state, RunState::Stopping | RunState::Stopped) {
        return Err(OrchError::new(reason::RUN_STOPPED, "the run is stopping or stopped — nothing is committed"));
    }
    let a = run
        .attempts
        .iter()
        .find(|a| a.id == attempt_id)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt"))?;
    let task = run.task(&a.task_id).ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
    if task.current_attempt.as_deref() != Some(attempt_id) || a.gen != run.gen {
        return Err(OrchError::new(
            reason::STALE_ATTEMPT,
            "this attempt is no longer the task's current attempt — nothing is committed",
        ));
    }
    if run.report_of(attempt_id).is_some() {
        return Err(OrchError::new(reason::ALREADY_REPORTED, "you already reported — commit before report_done"));
    }
    // 커밋은 **턴 안에서**만(3a — `running`). 옛 상태(2차 PTY)는 옛 파일 읽기용. `blocked` 뒤에도 보고가 없으니 다음 턴에서 커밋할 수 있다(D7).
    if !matches!(
        a.state,
        AttemptState::Running
            | AttemptState::Starting
            | AttemptState::Ready
            | AttemptState::Working
            | AttemptState::AwaitingHuman
            | AttemptState::NeedsRecovery
    ) {
        return Err(OrchError::new(
            reason::INVALID_STATE,
            format!("the attempt is {} and cannot commit now", a.state.as_str()),
        ));
    }
    let (Some(wt), Some(branch)) = (a.worktree.clone(), a.branch.clone()) else {
        return Err(OrchError::new(reason::INVALID_STATE, "the attempt has no worktree yet"));
    };
    let markers = super::resolve::resolve_info(run, a).map(super::resolve::marker_check);
    Ok((wt, branch, a.task_id.clone(), markers))
}

/// 거절 기록의 재료 — 인자에서 읽을 수 있는 만큼(깨진 인자면 없다). 요청 id 는 128자까지 · 파일 수는 목록일 때만.
fn rejection_hints(args: Option<&Value>) -> (Option<String>, Option<u32>) {
    let request = request_id(args).ok().map(|r| r.chars().take(128).collect());
    let files = match arg(args, "selection") {
        Some(Value::Object(o)) => o.get("paths").and_then(Value::as_array).map(|a| a.len().min(u32::MAX as usize) as u32),
        _ => None,
    };
    (request, files)
}

impl Orchestration {
    /// `commit_changes` 거절 하나를 남긴다(사용자 결정 10-15) — 타임라인 `commit_rejected`(사유 · Attempt · 요청 id · 파일 수) · Attempt 의
    /// 마지막 거절 칸(보드 · 조정자 요약) · 감사(같은 고정 칸). 사람이 해야 하는 사유([`commit_needs_human`])는 감독 알림도 — 그 Attempt 의
    /// **바로 앞 거절과 같은 사유면 다시 알리지 않는다**(작업자가 같은 거절을 되풀이해도 알림은 하나 · 보드 칸은 그대로 보인다 — 커밋이 서면
    /// 칸이 걷혀 다음 거절은 다시 알린다). **경로 목록 · 메시지 본문은 어디에도 싣지 않는다.** Run · Attempt 를 못 찾으면(없는 Run 등) 남기지 않는다.
    fn commit_rejected(&self, run_id: &str, attempt_id: &str, args: Option<&Value>, err: &OrchError) {
        let (request, files) = rejection_hints(args);
        let now = self.now();
        let detail = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else {
                return;
            };
            if slot.run.state == RunState::Orphaned {
                return;
            }
            let Some(idx) = slot.run.attempts.iter().position(|a| a.id == attempt_id) else {
                return;
            };
            let human = commit_needs_human(err.code);
            let seq = slot.run.bump(now, Actor::Worker, "commit_rejected", Some(attempt_id), err.code);
            if let Some(e) = slot.run.log.last_mut() {
                e.request_id = request.clone();
                e.files = files;
            }
            let a = &mut slot.run.attempts[idx];
            let repeat = a.last_commit_rejection.as_ref().is_some_and(|p| p.reason == err.code);
            a.last_commit_rejection = Some(CommitRejection {
                reason: err.code.to_string(),
                request_id: request.clone(),
                files,
                needs_human: human,
                seq,
                at: now,
            });
            let task_id = a.task_id.clone();
            if human && !repeat {
                self.raise(slot, "commit-rejected", Some(attempt_id), Some(err.code));
            }
            let detail = OrchestrationAudit {
                gen: slot.run.gen,
                actor: Actor::Worker.as_str().into(),
                task_id: Some(task_id),
                attempt_id: Some(attempt_id.to_string()),
                reason: Some(err.code.to_string()),
                changed_files: files,
                request_id: request,
                ..Default::default()
            };
            self.after_change(&g, run_id);
            detail
        };
        self.audit("commit_rejected", run_id, detail);
    }

    /// 작업자 `commit_changes` — 관문(잠금 안 · 요청 예약) → 커밋(잠금 밖 · 블로킹 git) → 기록(잠금 안 · 멱등).
    pub(super) fn commit_changes(&self, run_id: &str, attempt_id: &str, args: Option<&Value>) -> Result<Value, OrchError> {
        self.commit_changes_with(run_id, attempt_id, args, std::env::vars_os().collect(), &|| {})
    }

    /// [`Self::commit_changes`] 의 몸 — 환경 재료 · CAS 직전 손을 받는다(시험). 거절은 모두 [`Self::commit_rejected`] 로 남는다
    /// (`request-in-progress` — 같은 요청의 첫 호출이 아직 도는 중 — 만 빼고: 그건 거절이 아니라 기다림이다).
    pub(super) fn commit_changes_with(
        &self,
        run_id: &str,
        attempt_id: &str,
        args: Option<&Value>,
        env: Vec<(OsString, OsString)>,
        before_cas: &dyn Fn(),
    ) -> Result<Value, OrchError> {
        let r = self.commit_changes_body(run_id, attempt_id, args, env, before_cas);
        if let Err(e) = &r {
            if e.code != reason::REQUEST_IN_PROGRESS {
                self.commit_rejected(run_id, attempt_id, args, e);
            }
        }
        r
    }

    fn commit_changes_body(
        &self,
        run_id: &str,
        attempt_id: &str,
        args: Option<&Value>,
        env: Vec<(OsString, OsString)>,
        before_cas: &dyn Fn(),
    ) -> Result<Value, OrchError> {
        let request = request_id(args)?;
        let key = format!("{attempt_id}:{request}");
        let raw = req_text(args, "message", MESSAGE_MAX)?;
        let selection = selection_arg(args)?;
        let expected = opt_text(args, "expectedHead", 64)?;
        // 1. 관문 + 자리(서버 기록) · 요청 예약.
        let (worktree, branch, task_id, repo, markers) = {
            let mut g = self.lock();
            let slot = super::report::worker_run(&mut g, run_id)?;
            if let Some(first) = request_seen(slot, &key, "commit_changes", &super::store::request_sha(args))? {
                return Ok(first);
            }
            let (wt, branch, task_id, markers) = commit_gate(slot, attempt_id)?;
            reserve_request(slot, &key, "commit_changes", &super::store::request_sha(args));
            (wt, branch, task_id, slot.run.repo.clone(), markers)
        };
        let release = |o: &Orchestration| {
            let mut g = o.lock();
            if let Some(slot) = g.runs.get_mut(run_id) {
                release_request(slot, &key);
            }
        };
        let Some(message) = final_message(&raw, &task_id, attempt_id) else {
            release(self);
            return Err(bad("message must not be empty"));
        };
        // 2. git — 잠금 밖.
        let hooks = super::worktree::empty_hooks_dir();
        let idx = index_dir();
        let job = CommitJob {
            repo: Path::new(&repo),
            worktree: Path::new(&worktree),
            branch: &branch,
            expected_head: expected.as_deref(),
            selection: &selection,
            message: &message,
            hooks_dir: &hooks,
            index_dir: &idx,
            env,
            markers: markers.as_ref(),
        };
        let done = match commit_blocking(&job, before_cas) {
            Ok(c) => c,
            Err(e) => {
                release(self);
                return Err(e);
            }
        };
        // 3. 기록.
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else {
                return Err(super::store::not_found_run());
            };
            release_request(slot, &key);
            if let Some(a) = slot.run.attempts.iter_mut().find(|a| a.id == attempt_id) {
                a.last_commit_rejection = None;
            }
            slot.run.commits.push(WorkerCommit {
                attempt_id: attempt_id.to_string(),
                commit_oid: done.commit.clone(),
                parent_oid: done.parent.clone(),
                branch: done.branch.clone(),
                subject: subject(&message),
                files: done.files as u32,
                at: now,
            });
            let seq = slot.run.bump(now, Actor::Worker, "worker_committed", Some(attempt_id), "ok");
            let mut result = json!({
                "commitSha": done.commit,
                "parent": done.parent,
                "branch": done.branch,
                "files": done.files,
                "remaining": done.remaining,
                "remainingTruncated": done.remaining_truncated,
                "latestSeq": seq,
            });
            if done.index_sync_failed {
                if let Some(o) = result.as_object_mut() {
                    o.insert(
                        "warning".into(),
                        json!("the commit was made, but your worktree's git index could not be refreshed (another git command held it) — run `git status` before staging again"),
                    );
                }
            }
            slot.run.remember(&key, "commit_changes", &super::store::request_sha(args), result.clone());
            let detail = OrchestrationAudit {
                gen: slot.run.gen,
                actor: Actor::Worker.as_str().into(),
                task_id: Some(task_id.clone()),
                attempt_id: Some(attempt_id.to_string()),
                commit_oid: Some(done.commit.clone()),
                changed_files: Some(done.files as u32),
                request_id: Some(request.chars().take(128).collect()),
                ..Default::default()
            };
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit("worker_committed", run_id, detail);
        Ok(result)
    }
}
