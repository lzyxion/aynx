//! 워크트리 — 프로젝트 아래의 `git worktree`. 앱은 워크트리를 소유하지 않는다 — 목록의 원본은 언제나 git 이다.
//!
//! - 곁 파일 `worktrees.json` 은 "이 브랜치를 앱이 `-b` 로 만들었나" 를 적는다(git 은 기억하지 않는다). 적힌 것이 없으면
//!   먼저 있던 브랜치로 본다 — 모르면 지우지 않는다. 원격 줄 열쇠는 `ssh://<별칭><서버 절대 경로>`([`remote_key`]).
//! - 곁 파일은 GUI 와 세션 서버가 함께 쓴다 — 모든 쓰기는 [`modify_sidecar`] 하나를 지난다(시험이 소스를 훑어 지킨다).
//! - 워크트리 폴더는 저장소 안이면 안 된다 — 상위 저장소의 `git status` 에 통째로 잡힌다([`check_worktree_dir`]).
//! - git 은 셸 없이 낱개 인자로(`-C <저장소>` 가 맨 앞) · 시한 안에서 · `GIT_TERMINAL_PROMPT=0`. 원격은 이 목적 하나로 좁힌
//!   명령만 Rust 가 짓는다 — 범용 exec 을 프런트에 열지 않는다.
//! - 제거는 `--force` 없음 · 브랜치는 `git branch -d` 로만(`-D` 없음). 예외 하나: `-d` 가 거절하면 실행 순간 `crate::merge_detect` 가
//!   squash · rebase 병합을 다시 확인해, 방금 판정한 그 커밋을 조건으로 `update-ref -d`(그사이 움직였으면 git 이 거절).

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::app_state::{load_at, save_at};
use crate::i18n::tr;

pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(30);

const REMOTE_LIST_TIMEOUT: Duration = Duration::from_secs(10);

/// 콘솔 창이 번쩍이지 않게 한다.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeInfo {
    /// git 이 적은 그대로 — Windows 에서도 `/` 구분자다
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub bare: bool,
    pub detached: bool,
    /// 곁 파일에 그렇게 적혀 있고 그 브랜치가 아직 체크아웃돼 있을 때만 `true`
    pub created_by_app: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeAdded {
    pub path: String,
    pub branch: String,
    pub branch_created: bool,
    /// 원격 추적 브랜치를 받아 만들었으면 그 이름(`origin/feat-x`)
    pub tracked: Option<String>,
}

/// 프런트의 알림 문구가 이 글자로 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptReason {
    Unmerged,
    /// 워크트리보다 먼저 있던 브랜치다(앱이 만들지 않았다 · 모른다)
    Predates,
    NotRequested,
    /// 저장소의 지금 브랜치(주 작업 폴더가 체크아웃한 것)다
    Main,
}

/// `removed=false` 면 git 이 제거를 거절했고 브랜치는 손대지 않았다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeRemoved {
    pub removed: bool,
    pub branch: Option<String>,
    pub branch_deleted: bool,
    pub branch_kept_reason: Option<KeptReason>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BranchStep {
    /// 문을 다 지났다 — `git branch -d` 를 돌려 보라
    RunDelete,
    Deleted,
    Kept(KeptReason),
}

// ── 순수 규칙 ──

/// 아는 줄만 읽고 나머지(`locked …` · `prunable …`)는 넘긴다 — 새 git 이 줄을 더해도 깨지지 않는다.
pub(crate) fn parse_porcelain(text: &str) -> Vec<WorktreeInfo> {
    let mut out = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(w) = cur.take() {
                out.push(w);
            }
            continue;
        }
        let (key, value) = match line.split_once(' ') {
            Some((k, v)) => (k, Some(v)),
            None => (line, None),
        };
        match (key, value) {
            ("worktree", Some(p)) => {
                if let Some(w) = cur.take() {
                    out.push(w);
                }
                cur = Some(WorktreeInfo {
                    path: p.to_string(),
                    ..Default::default()
                });
            }
            ("HEAD", Some(h)) => {
                if let Some(w) = cur.as_mut() {
                    w.head = Some(h.to_string());
                }
            }
            ("branch", Some(b)) => {
                if let Some(w) = cur.as_mut() {
                    w.branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
                }
            }
            ("bare", None) => {
                if let Some(w) = cur.as_mut() {
                    w.bare = true;
                }
            }
            ("detached", None) => {
                if let Some(w) = cur.as_mut() {
                    w.detached = true;
                }
            }
            _ => {}
        }
    }
    if let Some(w) = cur.take() {
        out.push(w);
    }
    out
}

/// 워크트리보다 먼저 있던 브랜치와 병합되었다고 증명할 수 없는 브랜치는 남긴다. `-d` 의 결과를 넣고 다시 부르면 지웠다/남겼다가 나온다.
/// `merged` 는 프런트의 칸만 믿지 않고 Rust 가 스스로 다시 내린 판정이다 — 그래도 마지막 그물은 `-d` 다.
pub(crate) fn branch_decision(
    delete_requested: bool,
    created_by_app: bool,
    merged: bool,
    is_current: bool,
    git_d_result: Option<bool>,
) -> BranchStep {
    if !delete_requested {
        return BranchStep::Kept(KeptReason::NotRequested);
    }
    if is_current {
        return BranchStep::Kept(KeptReason::Main);
    }
    if !created_by_app && !merged {
        return BranchStep::Kept(KeptReason::Predates);
    }
    match git_d_result {
        None => BranchStep::RunDelete,
        Some(true) => BranchStep::Deleted,
        Some(false) => BranchStep::Kept(KeptReason::Unmerged),
    }
}

/// 셸 인용 없이도 안전한 글자뿐이라 원격 첫 입력에도 같은 규칙이 그대로 쓰인다. `..` 은 경로로는 저장소 밖으로 나간다.
pub(crate) fn valid_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    let bad = || {
        Err(tr!(
            ko: "워크트리 이름은 영문·숫자·. _ / - 만 쓸 수 있고 - 로 시작하거나 .. 을 담을 수 없습니다",
            en: "A worktree name may only use letters, digits and . _ / -, and may not start with - or contain .."
        ))
    };
    if n.is_empty() {
        return Err(tr!(ko: "워크트리 이름이 비어 있습니다", en: "The worktree name is empty"));
    }
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
    {
        return bad();
    }
    if n.starts_with('-') || n.contains("..") {
        return bad();
    }
    if n.starts_with('/')
        || n.ends_with('/')
        || n.split('/').any(|seg| seg.is_empty() || seg == ".")
    {
        return bad();
    }
    Ok(n)
}

/// 비교용 — Windows 꼴(드라이브 글자 · `\`)이면 소문자로 편다(그 파일 시스템은 대소문자를 가리지 않는다).
pub(crate) fn comparable(path: &str) -> String {
    let p = path.trim();
    let windowsish = p.contains('\\') || p.as_bytes().get(1) == Some(&b':');
    let mut s = p.replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    if windowsish {
        s = s.to_lowercase();
    }
    s
}

/// 로컬은 `~` 를 받지 않는다 — 셸 없이 불린 git 에서는 펴지지 않아 저장소 안에 `~` 폴더가 생긴다.
pub(crate) fn is_absolute_dir(dir: &str, remote: bool) -> bool {
    let d = dir.trim();
    if remote {
        return d.starts_with('/') || d == "~" || d.starts_with("~/");
    }
    let b = d.as_bytes();
    d.starts_with('/')
        || d.starts_with("\\\\")
        || (b.len() >= 3
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b[2] == b'\\' || b[2] == b'/'))
}

/// 프런트의 `worktreeDirProblem` 과 같은 표다 — 한쪽만 고치면 폼은 통과시키고 저장이 거절한다.
pub(crate) fn check_worktree_dir(repo: &str, dir: &str, remote: bool) -> Result<(), String> {
    if dir.chars().any(char::is_control) || !is_absolute_dir(dir, remote) {
        return Err(tr!(
            ko: "워크트리 폴더는 절대 경로여야 합니다: {dir}",
            en: "The worktree folder must be an absolute path: {dir}",
            dir = dir.trim()
        ));
    }
    let r = comparable(repo);
    let d = comparable(dir);
    if !r.is_empty() && (d == r || d.starts_with(&format!("{r}/"))) {
        return Err(tr!(
            ko: "워크트리 폴더는 저장소 폴더 밖이어야 합니다: {dir}",
            en: "The worktree folder must be outside the repository folder: {dir}",
            dir = dir.trim()
        ));
    }
    Ok(())
}

/// 칸이 비면 `<저장소 부모>/<저장소명>-wt`.
pub(crate) fn worktree_base(repo: &Path, dir: Option<&str>) -> Result<PathBuf, String> {
    if let Some(d) = dir.map(str::trim).filter(|d| !d.is_empty()) {
        check_worktree_dir(&repo.to_string_lossy(), d, false)?;
        return Ok(PathBuf::from(d));
    }
    let (Some(parent), Some(base)) = (repo.parent(), repo.file_name()) else {
        return Err(tr!(
            ko: "이 폴더 옆에는 워크트리를 둘 자리가 없습니다: {shown}",
            en: "There is no room next to this folder for a worktree: {shown}",
            shown = repo.display()
        ));
    };
    Ok(parent.join(format!("{}-wt", base.to_string_lossy())))
}

/// 이름의 `/` 는 폴더 층이 된다(`feat/x` → `…-wt/feat/x`).
pub(crate) fn worktree_path(repo: &Path, dir: Option<&str>, name: &str) -> Result<PathBuf, String> {
    let name = valid_name(name)?;
    let mut out = worktree_base(repo, dir)?;
    for seg in name.split('/') {
        out.push(seg);
    }
    Ok(out)
}

// ── 곁 파일 ──

/// 칸 이름은 `worktrees.json` 에 글자 그대로 남는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct WorktreeRecord {
    /// 만든 순간 체크아웃한 브랜치 — 지금 브랜치와 다르면(셸에서 바꿨다) 이 줄은 뜻이 없다
    pub branch: String,
    pub created_by_app: bool,
    /// 읽는 곳은 없다 — 파일을 보는 사람을 위한 것
    #[serde(default)]
    pub created_at: u64,
    /// 곁 파일은 모든 프로젝트가 함께 쓴다 — 목록을 읽을 때 그 저장소의 줄만 걷어 내려고 둔다. 없으면 걷지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<SetupRun>,
    /// 옛 칸 — 새로 적지도 읽지도 않는다. 옛 곁 파일을 다시 쓸 때 잃지 않게 칸만 남긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// 오케스트레이션 Run 이 만든 worktree 면 그 Run id — 그 층의 삭제는 자기 Run 인 줄만 받는다(사람이 만든 worktree 거절).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    /// 서버 임시 자리(`verify` · `review`)면 그 역할 — 폐기 정책은 이 칸 + `run` 이 그 Run 인 줄만 지운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct SetupRun {
    pub ok: bool,
    pub code: i32,
    pub at: u64,
}

/// 키는 워크트리 폴더([`path_key`]).
pub(crate) type Sidecar = BTreeMap<String, WorktreeRecord>;

pub(crate) fn sidecar_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("worktrees.json"))
}

static SIDECAR_LOCK: Mutex<()> = Mutex::new(());

static SIDECAR_WARNED: AtomicBool = AtomicBool::new(false);

/// 깨졌으면 빈 표 + 경고 한 번 — 빈 표는 "전부 먼저 있던 브랜치" 라 잃어도 지우는 쪽으로 틀리지 않는다.
pub(crate) fn load_sidecar(path: &Path) -> Sidecar {
    let warn_once = |what: String| {
        if !SIDECAR_WARNED.swap(true, Ordering::Relaxed) {
            eprintln!("[aynx] worktrees.json 을 읽을 수 없어 빈 표로 시작합니다: {what}");
        }
    };
    match load_at(path) {
        Ok(None) => Sidecar::new(),
        Ok(Some(raw)) => serde_json::from_str::<Sidecar>(&raw).unwrap_or_else(|e| {
            warn_once(e.to_string());
            Sidecar::new()
        }),
        Err(e) => {
            warn_once(e);
            Sidecar::new()
        }
    }
}

fn write_sidecar(path: &Path, file: &Sidecar) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    save_at(path, &json).map(|_| ())
}

/// 모든 쓰기가 이 함수 하나를 지난다 — GUI 와 세션 서버가 함께 쓰므로 프로세스 안 잠금만으로는 한쪽 줄이 사라질 수 있어
/// 옆 잠금 파일의 OS 배타 잠금을 함께 쥔다.
pub(crate) fn modify_sidecar(path: &Path, f: impl FnOnce(&mut Sidecar) -> bool) -> Result<bool, String> {
    let _guard = SIDECAR_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    with_file_lock(path, || {
        let mut file = load_sidecar(path);
        if !f(&mut file) {
            return Ok(false);
        }
        write_sidecar(path, &file)?;
        Ok(true)
    })
}

/// 잠금 파일을 못 열면 잠금 없이 돈다 — 곁 파일을 못 쓰는 것보다 낫다.
pub(crate) fn with_file_lock<T>(path: &Path, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".lock");
    let lock_path = path.with_file_name(name);
    if let Some(dir) = lock_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path);
    match lock {
        Ok(file) => {
            let locked = file.lock().is_ok();
            let out = f();
            if locked {
                let _ = file.unlock();
            }
            out
        }
        Err(_) => f(),
    }
}

#[cfg(test)]
pub(crate) fn run_of(file: &Sidecar, key: &str) -> Option<String> {
    record_for(file, key).and_then(|r| r.run.clone())
}

pub(crate) fn record_run_added(sidecar: &Path, path: &str, repo: &Path, branch: &str, run_id: &str) -> Result<bool, String> {
    let key = path_key(path);
    let rec = WorktreeRecord {
        branch: branch.to_string(),
        created_by_app: true,
        created_at: now_ms(),
        repo: Some(path_key(&repo.to_string_lossy())),
        setup: None,
        base: None,
        run: Some(run_id.to_string()),
        role: None,
    };
    modify_sidecar(sidecar, |f| {
        let want = comparable(&key);
        f.retain(|k, _| comparable(k) != want);
        f.insert(key, rec);
        true
    })
}

pub(crate) fn record_server_place(sidecar: &Path, path: &str, repo: &Path, run_id: &str, role: &str) -> Result<bool, String> {
    let key = path_key(path);
    let rec = WorktreeRecord {
        branch: String::new(),
        created_by_app: true,
        created_at: now_ms(),
        repo: Some(path_key(&repo.to_string_lossy())),
        setup: None,
        base: None,
        run: Some(run_id.to_string()),
        role: Some(role.to_string()),
    };
    modify_sidecar(sidecar, |f| {
        let want = comparable(&key);
        f.retain(|k, _| comparable(k) != want);
        f.insert(key, rec);
        true
    })
}

/// `(폴더 열쇠, 역할)`.
pub(crate) fn server_places_of(file: &Sidecar, run_id: &str) -> Vec<(String, String)> {
    file.iter()
        .filter(|(_, r)| r.run.as_deref() == Some(run_id))
        .filter_map(|(k, r)| r.role.clone().map(|role| (k.clone(), role)))
        .collect()
}

pub(crate) fn role_of(file: &Sidecar, key: &str) -> Option<(String, String)> {
    record_for(file, key).and_then(|r| Some((r.run.clone()?, r.role.clone()?)))
}

pub(crate) fn forget_path(sidecar: &Path, key: &str) -> Result<bool, String> {
    let want = comparable(key);
    modify_sidecar(sidecar, |f| {
        let before = f.len();
        f.retain(|k, _| comparable(k) != want);
        f.len() != before
    })
}

/// 곁 파일을 못 써도 워크트리 일은 이미 끝났다 — 콘솔 한 줄.
fn note_sidecar(r: Result<bool, String>) {
    if let Err(e) = r {
        eprintln!("[aynx] worktrees.json 을 쓰지 못했습니다: {e}");
    }
}

/// Windows 의 `canonicalize` 가 붙이는 `\\?\` 머리를 뗀다.
pub(crate) fn strip_verbatim(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p.to_string()
    }
}

/// 있는 폴더면 `canonicalize`(짧은 이름 · 심볼릭 링크를 편다), 없으면 받은 글자 그대로. 비교는 언제나 [`comparable`] 로 한다 —
/// git 은 `C:/src/x`, `git_worktree_add` 는 `C:\src\x` 를 준다.
pub(crate) fn path_key(path: &str) -> String {
    match std::fs::canonicalize(path.trim()) {
        Ok(p) => strip_verbatim(&p.to_string_lossy()),
        Err(_) => path.trim().to_string(),
    }
}

/// `key` 는 [`path_key`] 를 지난 글자.
pub(crate) fn record_for<'a>(file: &'a Sidecar, key: &str) -> Option<&'a WorktreeRecord> {
    let want = comparable(key);
    file.iter()
        .find(|(k, _)| comparable(k) == want)
        .map(|(_, r)| r)
}

/// 다른 저장소의 줄 · 저장소를 모르는 줄은 건드리지 않는다.
pub(crate) fn prune_sidecar(file: &mut Sidecar, repo_key: &str, listed_keys: &[String]) -> bool {
    let repo = comparable(repo_key);
    let listed: Vec<String> = listed_keys.iter().map(|k| comparable(k)).collect();
    let before = file.len();
    file.retain(|k, r| {
        let mine = r.repo.as_deref().map(comparable).as_deref() == Some(repo.as_str());
        !mine || listed.contains(&comparable(k))
    });
    file.len() != before
}

/// 줄이 없으면 브랜치를 모르는 줄(`created_by_app: false`)로 세운다 — 브랜치 삭제 판정은 그대로다.
pub(crate) fn record_setup_in(
    file: &mut Sidecar,
    key: &str,
    repo_key: &str,
    run: SetupRun,
) -> bool {
    let want = comparable(key);
    if let Some((_, rec)) = file.iter_mut().find(|(k, _)| comparable(k) == want) {
        rec.setup = Some(run);
        if rec.repo.is_none() {
            rec.repo = Some(repo_key.to_string());
        }
        return true;
    }
    file.insert(
        key.to_string(),
        WorktreeRecord {
            branch: String::new(),
            created_by_app: false,
            created_at: run.at,
            repo: Some(repo_key.to_string()),
            setup: Some(run),
            base: None,
            run: None,
            role: None,
        },
    );
    true
}

/// 브랜치 기록은 남기고, 기록 하나만 들고 있던 줄은 통째로 뺀다.
pub(crate) fn forget_setup_in(file: &mut Sidecar, repo_key: &str) -> bool {
    let repo = comparable(repo_key);
    let mut changed = false;
    for rec in file.values_mut() {
        if rec.repo.as_deref().map(comparable).as_deref() == Some(repo.as_str())
            && rec.setup.is_some()
        {
            rec.setup = None;
            changed = true;
        }
    }
    let before = file.len();
    file.retain(|_, r| r.created_by_app || !r.branch.is_empty() || r.setup.is_some());
    changed || file.len() != before
}

pub(crate) fn setup_count_in(file: &Sidecar, repo_key: &str) -> usize {
    let repo = comparable(repo_key);
    file.values()
        .filter(|r| {
            r.setup.is_some() && r.repo.as_deref().map(comparable).as_deref() == Some(repo.as_str())
        })
        .count()
}

/// 곁 파일 줄의 브랜치와 지금 브랜치가 같을 때만 믿는다 — 셸에서 바꿨으면 그 브랜치는 앱의 것이 아니다.
fn made_by_app(rec: Option<&WorktreeRecord>, branch: Option<&str>) -> bool {
    matches!((rec, branch), (Some(r), Some(b)) if r.created_by_app && r.branch == b)
}

// ── 곁 파일의 원격 줄 ──
// 열쇠 `ssh://<별칭(소문자)><서버 절대 경로>` 는 로컬 열쇠와 섞이지 않고, [`comparable`] 이 Windows 꼴로 보지 않아 대소문자를 그대로 둔다.
// 경로는 git 이 적는 절대 경로다 — 사람이 적은 `~/…` 가 아니다.

pub(crate) fn remote_key(alias: &str, path: &str) -> String {
    let p = path.trim();
    let t = p.trim_end_matches('/');
    let p = if t.is_empty() && p.starts_with('/') {
        "/"
    } else {
        t
    };
    format!("ssh://{}{p}", alias.trim().to_ascii_lowercase())
}

/// `line` 의 `repo` 칸은 여기서 채운다.
pub(crate) fn record_remote_added_in(
    file: &mut Sidecar,
    alias: &str,
    repo_root: &str,
    path: &str,
    mut line: WorktreeRecord,
) -> bool {
    let key = remote_key(alias, path);
    file.retain(|k, _| comparable(k) != comparable(&key));
    line.repo = Some(remote_key(alias, repo_root));
    file.insert(key, line);
    true
}

pub(crate) fn mark_remote_list(file: &Sidecar, alias: &str, list: &mut [WorktreeInfo]) {
    for w in list.iter_mut() {
        w.created_by_app = made_by_app(
            record_for(file, &remote_key(alias, &w.path)),
            w.branch.as_deref(),
        );
    }
}

/// `(저장소 열쇠, 목록의 열쇠들)` — 저장소는 git 의 첫 덩어리(주 작업 폴더)다.
pub(crate) fn remote_prune_keys(
    alias: &str,
    list: &[WorktreeInfo],
) -> Option<(String, Vec<String>)> {
    let main = list.first()?;
    Some((
        remote_key(alias, &main.path),
        list.iter().map(|w| remote_key(alias, &w.path)).collect(),
    ))
}

/// **블로킹**.
pub(crate) fn record_remote_added(
    alias: &str,
    repo_root: &str,
    path: &str,
    branch: &str,
    created: bool,
) {
    if let Some(side) = sidecar_path() {
        let line = WorktreeRecord {
            branch: branch.to_string(),
            created_by_app: created,
            created_at: now_ms(),
            repo: None,
            setup: None,
            base: None,
            run: None,
            role: None,
        };
        note_sidecar(modify_sidecar(&side, |f| {
            record_remote_added_in(f, alias, repo_root, path, line)
        }));
    }
}

fn apply_remote_sidecar_blocking(alias: &str, list: &mut [WorktreeInfo]) {
    let Some(side) = sidecar_path() else { return };
    let file = load_sidecar(&side);
    mark_remote_list(&file, alias, list);
    if let Some((repo_key, keys)) = remote_prune_keys(alias, list) {
        if prune_sidecar(&mut file.clone(), &repo_key, &keys) {
            note_sidecar(modify_sidecar(&side, |f| {
                prune_sidecar(f, &repo_key, &keys)
            }));
        }
    }
}

fn forget_remote_blocking(alias: &str, path: &str) {
    let Some(side) = sidecar_path() else { return };
    let want = comparable(&remote_key(alias, path));
    note_sidecar(modify_sidecar(&side, |f| {
        let before = f.len();
        f.retain(|k, _| comparable(k) != want);
        f.len() != before
    }));
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── git 한 번 — 셸 없이, 시한 안에서 ──

fn git_missing() -> String {
    tr!(
        ko: "git 을 찾을 수 없습니다 — git 을 설치하고 PATH 에 두어야 워크트리를 다룰 수 있습니다",
        en: "Could not find git — install git and put it on PATH to work with worktrees"
    )
}

pub(crate) struct GitRun {
    pub(crate) ok: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

pub(crate) fn git_failure(run: &GitRun) -> String {
    let msg = run.stderr.trim();
    if msg.is_empty() {
        tr!(ko: "git 이 실패했습니다", en: "git failed")
    } else {
        msg.to_string()
    }
}

/// **블로킹**. 출력은 스레드 둘이 끝까지 읽는다 — 파이프가 차서 자식이 멈추면 `try_wait` 가 영영 오지 않는다.
pub(crate) fn run_git(repo: &Path, args: &[&str], timeout: Duration) -> Result<GitRun, String> {
    run_git_env(repo, args, timeout, &[])
}

/// 운영 코드는 늘 빈 목록 — 테스트가 전역 git 설정을 떼어 내는 데 쓴다.
pub(crate) fn run_git_env(
    repo: &Path,
    args: &[&str],
    timeout: Duration,
    env: &[(&str, &str)],
) -> Result<GitRun, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .envs(env.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            git_missing()
        } else {
            tr!(ko: "git 을 실행하지 못했습니다: {e}", en: "Could not run git: {e}")
        }
    })?;
    let pump = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out_t = pump(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err_t = pump(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(tr!(
                    ko: "git 이 {secs}초 안에 끝나지 않아 멈췄습니다",
                    en: "git did not finish within {secs} seconds and was stopped",
                    secs = timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => {
                let _ = child.kill();
                return Err(
                    tr!(ko: "git 을 기다리지 못했습니다: {e}", en: "Could not wait for git: {e}"),
                );
            }
        }
    };
    Ok(GitRun {
        ok: status.success(),
        stdout: out_t.join().unwrap_or_default(),
        stderr: err_t.join().unwrap_or_default(),
    })
}

/// 이 저장소의 곁 파일 줄 중 git 목록에서 사라진 것(셸에서 지운 것)을 걷어 낸다.
pub(crate) fn list_blocking(repo: &Path, sidecar: Option<&Path>) -> Result<Vec<WorktreeInfo>, String> {
    let run = run_git(repo, &["worktree", "list", "--porcelain"], GIT_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    let mut list = parse_porcelain(&run.stdout);
    if let Some(side) = sidecar {
        let keys: Vec<String> = list.iter().map(|w| path_key(&w.path)).collect();
        let repo_key = path_key(&repo.to_string_lossy());
        let file = load_sidecar(side);
        for (w, key) in list.iter_mut().zip(&keys) {
            w.created_by_app = made_by_app(record_for(&file, key), w.branch.as_deref());
        }
        // 걷을 것이 있을 때만 쓴다 — 목록을 읽을 때마다 디스크를 잠그지 않게.
        if prune_sidecar(&mut file.clone(), &repo_key, &keys) {
            note_sidecar(modify_sidecar(side, |f| prune_sidecar(f, &repo_key, &keys)));
        }
    }
    Ok(list)
}

/// 만든 뒤 곁 파일에 "누가 브랜치를 만들었나" 를 적는다 — 제거가 브랜치를 지울지 이 줄로 가른다.
pub(crate) fn add_blocking(
    repo: &Path,
    dir: Option<&str>,
    name: &str,
    sidecar: Option<&Path>,
) -> Result<WorktreeAdded, String> {
    let name = valid_name(name)?.to_string();
    let dir = worktree_path(repo, dir, &name)?;
    let dir_s = dir.to_string_lossy().into_owned();
    let facts = crate::worktree_branch::local_facts(repo)?;
    let plan = crate::worktree_branch::plan_add(&name, &facts)?;
    let created = plan.creates_branch();
    let tracked = match &plan {
        crate::worktree_branch::AddPlan::Track(r) => Some(r.clone()),
        _ => None,
    };
    let args = crate::worktree_branch::add_args(&dir_s, &name, &plan);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let run = run_git(repo, &refs, GIT_TIMEOUT)?;
    if !run.ok {
        return Err(git_failure(&run));
    }
    if let Some(side) = sidecar {
        let key = path_key(&dir_s);
        let rec = WorktreeRecord {
            branch: name.clone(),
            created_by_app: created,
            created_at: now_ms(),
            repo: Some(path_key(&repo.to_string_lossy())),
            setup: None,
            base: None,
            run: None,
            role: None,
        };
        note_sidecar(modify_sidecar(side, |f| {
            // 같은 폴더의 옛 줄(구분자만 다른 글자)을 먼저 걷는다.
            let want = comparable(&key);
            f.retain(|k, _| comparable(k) != want);
            f.insert(key, rec);
            true
        }));
    }
    Ok(WorktreeAdded {
        path: dir_s,
        branch: name,
        branch_created: created,
        tracked,
    })
}

pub(crate) fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// `--force` 는 붙이지 않는다 — 커밋하지 않은 변경이 있으면 git 이 거절하고 그 한 줄이 `removed=false` 로 간다.
fn remove_blocking(
    repo: &Path,
    path: &str,
    delete_branch: bool,
    sidecar: Option<&Path>,
) -> Result<WorktreeRemoved, String> {
    let path = path.trim();
    if path.is_empty() || path.starts_with('-') || path.chars().any(char::is_control) {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    }
    // 폴더가 사라지기 전에 키를 잡는다(`canonicalize` 는 있는 폴더에서만 편다).
    let key = path_key(path);
    let want = comparable(&key);
    let listing = run_git(repo, &["worktree", "list", "--porcelain"], GIT_TIMEOUT)?;
    let list = if listing.ok {
        parse_porcelain(&listing.stdout)
    } else {
        Vec::new()
    };
    let branch = list
        .iter()
        .find(|w| comparable(&path_key(&w.path)) == want)
        .and_then(|w| w.branch.clone());
    let current = list.first().and_then(|w| w.branch.clone());

    let run = run_git(repo, &["worktree", "remove", path], GIT_TIMEOUT)?;
    if !run.ok {
        return Ok(WorktreeRemoved {
            removed: false,
            branch,
            branch_deleted: false,
            branch_kept_reason: None,
            message: Some(git_failure(&run)),
        });
    }

    let file = sidecar.map(load_sidecar).unwrap_or_default();
    let mut out = WorktreeRemoved {
        removed: true,
        branch: branch.clone(),
        branch_deleted: false,
        branch_kept_reason: None,
        message: None,
    };
    if let Some(b) = branch.as_deref() {
        let created = made_by_app(record_for(&file, &key), Some(b));
        let is_current = current.as_deref() == Some(b);
        let merged = delete_branch
            && !created
            && !is_current
            && crate::worktree_changes::branch_merged_blocking(repo, b, current.as_deref());
        let mut step = branch_decision(delete_branch, created, merged, is_current, None);
        if step == BranchStep::RunDelete {
            // `-` 로 시작하면 git 이 옵션으로 읽는다 — git 이 그런 브랜치를 막지만 한 번 더.
            let ok = if b.starts_with('-') {
                false
            } else {
                let d = run_git(repo, &["branch", "-d", b], GIT_TIMEOUT)?;
                if d.ok {
                    true
                } else if crate::merge_detect::delete_verified_local(repo, b)?.is_some() {
                    // `-d` 는 조상 관계만 본다 — squash · rebase 병합은 지금 다시 확인한 그 커밋 조건으로 지운다.
                    true
                } else {
                    out.message = Some(first_line(&git_failure(&d)));
                    false
                }
            };
            step = branch_decision(delete_branch, created, merged, is_current, Some(ok));
        }
        match step {
            BranchStep::Deleted => out.branch_deleted = true,
            BranchStep::Kept(r) => out.branch_kept_reason = Some(r),
            BranchStep::RunDelete => {}
        }
    }
    if let Some(side) = sidecar {
        note_sidecar(modify_sidecar(side, |f| {
            let before = f.len();
            f.retain(|k, _| comparable(k) != want);
            f.len() != before
        }));
    }
    Ok(out)
}

pub(crate) fn repo_of(repo: &str) -> Result<PathBuf, String> {
    let r = repo.trim();
    if r.is_empty() {
        return Err(tr!(ko: "프로젝트 경로가 비어 있습니다", en: "The project path is empty"));
    }
    Ok(PathBuf::from(r))
}

pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| tr!(ko: "git 작업이 실패했습니다: {e}", en: "The git task failed: {e}"))?
}

// ── 명령 ──

/// 주 작업 폴더가 첫 줄이다(git 의 순서).
#[tauri::command]
pub async fn git_worktree_list(repo: String) -> Result<Vec<WorktreeInfo>, String> {
    let repo = repo_of(&repo)?;
    blocking(move || list_blocking(&repo, sidecar_path().as_deref())).await
}

/// 돌려주는 `path` 가 실제로 만든 자리다 — 프런트의 알림이 이 글자를 그대로 쓴다.
#[tauri::command]
pub async fn git_worktree_add(
    repo: String,
    name: String,
    dir: Option<String>,
) -> Result<WorktreeAdded, String> {
    let repo = repo_of(&repo)?;
    blocking(move || add_blocking(&repo, dir.as_deref(), &name, sidecar_path().as_deref())).await
}

/// git 이 제거를 거절하면 `Err` 가 아니라 `removed=false` + 그 한 줄이다.
#[tauri::command]
pub async fn git_worktree_remove(
    repo: String,
    path: String,
    delete_branch: bool,
) -> Result<WorktreeRemoved, String> {
    let repo = repo_of(&repo)?;
    blocking(move || remove_blocking(&repo, &path, delete_branch, sidecar_path().as_deref())).await
}

/// 못 써도 사람의 일은 끝났으므로 오류는 콘솔 한 줄이고 `Ok` 다.
#[tauri::command]
pub async fn worktree_setup_record(repo: String, path: String, code: i32) -> Result<(), String> {
    let repo = repo_of(&repo)?;
    let path = path.trim().to_string();
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    }
    blocking(move || {
        if let Some(side) = sidecar_path() {
            let key = path_key(&path);
            let repo_key = path_key(&repo.to_string_lossy());
            let run = SetupRun {
                ok: code == 0,
                code,
                at: now_ms(),
            };
            note_sidecar(modify_sidecar(&side, |f| {
                record_setup_in(f, &key, &repo_key, run)
            }));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn worktree_setup_count(repo: String) -> Result<usize, String> {
    let repo = repo_of(&repo)?;
    blocking(move || {
        let Some(side) = sidecar_path() else {
            return Ok(0);
        };
        Ok(setup_count_in(
            &load_sidecar(&side),
            &path_key(&repo.to_string_lossy()),
        ))
    })
    .await
}

/// **블로킹**.
pub(crate) fn forget_setup_records(repo: &str) {
    let r = repo.trim();
    if r.is_empty() {
        return;
    }
    if let Some(side) = sidecar_path() {
        let repo_key = path_key(r);
        note_sidecar(modify_sidecar(&side, |f| forget_setup_in(f, &repo_key)));
    }
}

pub(crate) fn remote_list_command(repo: &str) -> Option<String> {
    let r = repo.trim();
    if r.is_empty() || r.chars().any(char::is_control) {
        return None;
    }
    Some(format!(
        "git -C {} worktree list --porcelain",
        crate::ssh::sh_path(r)
    ))
}

/// 화면(PTY)을 건드리지 않는다. 프런트가 넘기는 것은 저장소 경로뿐이다.
#[tauri::command]
pub async fn ssh_git_worktree_list(
    id: u32,
    repo: String,
) -> Result<Vec<WorktreeInfo>, String> {
    let Some(command) = remote_list_command(&repo) else {
        return Err(
            tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        );
    };
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let alias = crate::server::ssh_ops::alias_of(id).await;
    let outcome = crate::ssh::run_exec(
        handle,
        command,
        REMOTE_LIST_TIMEOUT,
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
            secs = REMOTE_LIST_TIMEOUT.as_secs()
        ));
    }
    if outcome.exit_code != Some(0) {
        let msg = outcome.stderr.trim();
        return Err(if msg.is_empty() {
            tr!(ko: "원격 git 이 실패했습니다", en: "The remote git failed")
        } else {
            msg.to_string()
        });
    }
    let list = parse_porcelain(&outcome.stdout);
    let Some(alias) = alias else { return Ok(list) };
    let fallback = list.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let mut list = list;
        apply_remote_sidecar_blocking(&alias, &mut list);
        list
    })
    .await
    .unwrap_or(fallback))
}

// ── 원격 제거 ──

/// 한 걸음마다 잰다 — 확인 상자가 사람 앞에서 기다리므로 로컬보다 짧다.
const REMOTE_REMOVE_TIMEOUT: Duration = Duration::from_secs(15);

/// 이 글자들만 서버로 나간다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteRemoveCommands {
    pub list: String,
    /// `--force` 는 없다
    pub remove: String,
    /// `-d` 명령은 브랜치를 안 뒤에 짓는다
    repo_q: String,
}

impl RemoteRemoveCommands {
    /// `-D` 는 없다. `-` 로 시작하는 이름은 옵션으로 읽히므로 짓지 않는다.
    pub fn branch_delete(&self, branch: &str) -> Option<String> {
        let b = branch.trim();
        if b.is_empty() || b.starts_with('-') || b.chars().any(char::is_control) {
            return None;
        }
        Some(format!(
            "git -C {} branch -d {}",
            self.repo_q,
            crate::ssh::sh_quote(b)
        ))
    }
}

/// 경로는 원격의 절대 자리(`/` · `~`)만 — 상대 경로는 `-C` 기준으로 풀려 엉뚱한 폴더를 가리킨다. 제어 문자는 인용 안에서도 새 명령줄이다.
pub(crate) fn remote_remove_commands(repo: &str, path: &str) -> Option<RemoteRemoveCommands> {
    let list = remote_list_command(repo)?;
    let p = path.trim();
    if p.chars().any(char::is_control) || !is_absolute_dir(p, true) {
        return None;
    }
    let repo_q = crate::ssh::sh_path(repo.trim());
    Some(RemoteRemoveCommands {
        list,
        remove: format!("git -C {repo_q} worktree remove {}", crate::ssh::sh_path(p)),
        repo_q,
    })
}

/// 원격(리눅스)은 대소문자를 가리므로 [`comparable`] 과 달리 낮추지 않는다.
pub(crate) fn remote_comparable(path: &str, home: Option<&str>) -> String {
    let p = path.trim();
    let expanded = match (home, p.strip_prefix("~/")) {
        (Some(h), _) if p == "~" => h.to_string(),
        (Some(h), Some(rest)) => format!("{}/{rest}", h.trim_end_matches('/')),
        _ => p.to_string(),
    };
    let t = expanded.trim_end_matches('/');
    if t.is_empty() && expanded.starts_with('/') {
        "/".to_string()
    } else {
        t.to_string()
    }
}

/// `(찾은 줄, 주 작업 폴더인가)` — 저장소 경로 자신을 가리켜도 주 작업 폴더로 본다.
pub(crate) fn find_remote_entry<'a>(
    list: &'a [WorktreeInfo],
    repo: &str,
    path: &str,
    home: Option<&str>,
) -> (Option<&'a WorktreeInfo>, bool) {
    let want = remote_comparable(path, home);
    let hit = list
        .iter()
        .enumerate()
        .find(|(_, w)| remote_comparable(&w.path, None) == want);
    let is_main = hit.is_some_and(|(i, _)| i == 0) || remote_comparable(repo, home) == want;
    (hit.map(|(_, w)| w), is_main)
}

pub(crate) fn remote_failure_line(stderr: &str) -> String {
    let line = first_line(stderr);
    if line.is_empty() {
        tr!(ko: "원격 git 이 실패했습니다", en: "The remote git failed")
    } else {
        line
    }
}

pub(crate) async fn remote_git(
    handle: &crate::ssh::ExecHandle,
    command: String,
) -> Result<crate::ssh::ExecOutcome, String> {
    let outcome = crate::ssh::run_exec(
        handle.clone(),
        command,
        REMOTE_REMOVE_TIMEOUT,
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
            secs = REMOTE_REMOVE_TIMEOUT.as_secs()
        ));
    }
    Ok(outcome)
}

/// 로컬과 같은 답 · 같은 규칙이다. 다른 점 하나: "앱이 만든 브랜치인가" 자리에 사람이 켠 칸(`delete_branch`)을 넣는다 —
/// 프런트가 곁 파일의 원격 줄이 있으면 켠 채로, 없으면 꺼진 채로 연다(모르면 지우지 않는다).
#[tauri::command]
pub async fn ssh_git_worktree_remove(
    id: u32,
    repo: String,
    path: String,
    delete_branch: bool,
) -> Result<WorktreeRemoved, String> {
    let Some(cmds) = remote_remove_commands(&repo, &path) else {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    };
    let Some(handle) = crate::server::ssh_ops::handle_of(id) else {
        return Err(crate::errors::session_gone());
    };
    let alias = crate::server::ssh_ops::alias_of(id).await;

    // 홈 — git 은 절대 경로로 적으므로 맞대려고 묻는다. 못 알아내도 멈추지 않는다(글자 그대로 견준다).
    let tilde = |s: &str| s.trim().starts_with('~');
    let home = if tilde(&repo) || tilde(&path) {
        let o = remote_git(&handle, crate::ssh::REMOTE_HOME_COMMAND.to_string()).await?;
        if o.exit_code == Some(0) {
            crate::ssh::parse_remote_home(&o.stdout)
        } else {
            None
        }
    } else {
        None
    };

    let listing = remote_git(&handle, cmds.list.clone()).await?;
    if listing.exit_code != Some(0) {
        return Err(remote_failure_line(&listing.stderr));
    }
    let list = parse_porcelain(&listing.stdout);
    let (entry, is_main) = find_remote_entry(&list, &repo, &path, home.as_deref());
    if is_main {
        return Err(tr!(
            ko: "주 작업 폴더는 제거할 수 없습니다",
            en: "The main working tree cannot be removed"
        ));
    }
    let branch = entry.and_then(|w| w.branch.clone());
    // 곁 파일의 원격 줄 열쇠 — git 이 적은 절대 경로(사람이 적은 `~/…` 가 아니다).
    let entry_path = entry.map(|w| w.path.clone());
    let current = list.first().and_then(|w| w.branch.clone());

    let run = remote_git(&handle, cmds.remove.clone()).await?;
    if run.exit_code != Some(0) {
        return Ok(WorktreeRemoved {
            removed: false,
            branch,
            branch_deleted: false,
            branch_kept_reason: None,
            message: Some(remote_failure_line(&run.stderr)),
        });
    }
    if let (Some(alias), Some(p)) = (alias, entry_path) {
        let _ =
            tauri::async_runtime::spawn_blocking(move || forget_remote_blocking(&alias, &p)).await;
    }

    let mut out = WorktreeRemoved {
        removed: true,
        branch: branch.clone(),
        branch_deleted: false,
        branch_kept_reason: None,
        message: None,
    };
    if let Some(b) = branch.as_deref() {
        let is_current = current.as_deref() == Some(b);
        // 원격은 사람이 켠 칸 자체가 동의다 — 병합됨 다시 보기는 없고 `-d` 가 그물이다.
        let mut step = branch_decision(delete_branch, delete_branch, false, is_current, None);
        if step == BranchStep::RunDelete {
            let ok = match cmds.branch_delete(b) {
                None => false,
                Some(cmd) => match remote_git(&handle, cmd).await {
                    Ok(d) if d.exit_code == Some(0) => true,
                    Ok(d) => match crate::merge_detect::delete_verified_remote(&handle, &repo, b).await {
                        Ok(Some(_)) => true,
                        Ok(None) => {
                            out.message = Some(remote_failure_line(&d.stderr));
                            false
                        }
                        Err(e) => {
                            out.message = Some(e);
                            false
                        }
                    },
                    // 워크트리는 이미 지워졌다 — 전송 오류로 전체를 실패시키지 않고 남긴 까닭으로 싣는다.
                    Err(e) => {
                        out.message = Some(e);
                        false
                    }
                },
            };
            step = branch_decision(delete_branch, delete_branch, false, is_current, Some(ok));
        }
        match step {
            BranchStep::Deleted => out.branch_deleted = true,
            BranchStep::Kept(r) => out.branch_kept_reason = Some(r),
            BranchStep::RunDelete => {}
        }
    }
    Ok(out)
}

// ── 변경 파일 도장 — 메신저 알림의 "파일 N개 변경" ──

/// 넘으면 도장이 없다(그 칸을 빼고 보낸다).
const SNAPSHOT_MAX_ENTRIES: usize = 5000;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);

/// 줄 모양 `"<XY>\t<mtime>\t<경로>"` — 프런트가 두 도장의 서로 다른 줄의 경로 수로 바뀐 파일 수를 센다(다시 고친 파일은 mtime 이 바뀐다).
pub(crate) fn snapshot_entries(stdout: &str, mtime: impl Fn(&str) -> i64) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for rec in stdout.split('\0') {
        if rec.len() < 4 || !rec.is_char_boundary(3) || rec.as_bytes()[2] != b' ' {
            continue;
        }
        let (xy, path) = (&rec[..2], &rec[3..]);
        if out.len() >= SNAPSHOT_MAX_ENTRIES {
            return None;
        }
        out.push(format!("{xy}\t{}\t{path}", mtime(path)));
    }
    out.sort();
    Some(out)
}

fn change_snapshot_blocking(dir: &Path) -> Option<Vec<String>> {
    let top = run_git(dir, &["rev-parse", "--show-toplevel"], SNAPSHOT_TIMEOUT).ok()?;
    if !top.ok {
        return None;
    }
    let top = PathBuf::from(top.stdout.trim());
    let run = run_git(
        dir,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--no-renames",
            "--untracked-files=normal",
        ],
        SNAPSHOT_TIMEOUT,
    )
    .ok()?;
    if !run.ok {
        return None;
    }
    snapshot_entries(&run.stdout, |rel| {
        std::fs::symlink_metadata(top.join(rel.trim_end_matches('/')))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(-1, |d| d.as_millis() as i64)
    })
}

/// 알림 재료일 뿐이라 실패는 `None` 이다. 파일 이름은 담기지만 알림 몸통에 실리는 것은 개수뿐이다.
#[tauri::command]
pub async fn git_change_snapshot(dir: String) -> Option<Vec<String>> {
    let dir = PathBuf::from(dir.trim());
    if !dir.is_absolute() {
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if dir.is_dir() {
            change_snapshot_blocking(&dir)
        } else {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests;
