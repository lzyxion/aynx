//! 워크트리 — 프로젝트 아래의 `git worktree` (docs/log/2026-09-24-worktrees.md).
//!
//! 개발 도구 확장 첫 조각의 둘째다(설계 노트 "프로젝트와 워크트리"). 앱은 워크트리를
//! **소유하지 않는다** — 사용자가 셸에서 만든 것도 같은 목록에 나오고(`git worktree list
//! --porcelain`), 만드는 것·지우는 것도 `git worktree add`·`git worktree remove` 를 사람이
//! 누른 순간 대신 쳐 주는 것뿐이다. 목록의 원본은 언제나 git 이다.
//!
//! ## 곁 파일 하나 — `<config_dir>/aynx/worktrees.json` (브랜치를 누가 만들었나)
//!
//! 저장하는 것은 **"이 워크트리의 브랜치를 앱이 `-b` 로 만들었는가"** 한 가지뿐이다. 제거가
//! 브랜치도 같이 지우는데(Orca 의 규칙 — docs/log/2026-09-24-worktrees.md "브랜치는 같이
//! 지운다"), **워크트리보다 먼저 있던 브랜치는 남긴다** — 그 사실은 git 이 기억하지 않으므로
//! 만든 순간 적어 둔다. 적힌 것이 없으면(셸에서 만든 워크트리·곁 파일이 지워졌다) **먼저 있던
//! 것으로 본다** — 모르면 지우지 않는 쪽이다. 목록을 읽을 때 git 목록에 없는 줄(그 저장소 것만)은
//! 걷어 낸다. 파일 관례는 `projects.json` 과 같다(원자적 쓰기 · 깨지면 빈 표 + 경고 한 번).
//!
//! 같은 줄에 **설정 스크립트 실행 기록** 한 칸이 더 산다(`setup` — 돌렸는지 · 성공했는지 · 언제 · 종료 코드,
//! 2026-09-28 · docs/log/2026-09-28-project-agent-setup-script.md). 앱이 만들지 않은 워크트리(주 작업 폴더 ·
//! 셸에서 만든 것)에서 돌렸으면 브랜치를 모르는 줄(`created_by_app: false`)로 선다 — 브랜치 삭제 판정은 그대로다.
//! 워크트리를 지우면(제거 · 목록의 걷어 내기) 그 줄과 함께 사라지고, 프로젝트를 지우면 그 저장소의 기록만 걷는다
//! ([`forget_setup_records`]). 원격 워크트리의 스크립트 실행 기록은 없다(아래 "원격").
//!
//! **원격 줄**(2026-09-29): 원격 새 워크트리도 앱이 만들므로(`crate::remote_worktree`) 같은 파일에
//! `ssh://<별칭><서버의 절대 경로>` 열쇠로 브랜치 기록을 적는다([`remote_key`]) — 원격 목록이 그 줄로
//! `created_by_app` 을 싣고, 원격 제거가 그 줄을 걷는다.
//!
//! ## 새 워크트리의 자리 — `<워크트리 폴더>/<이름>`
//!
//! 워크트리 폴더는 프로젝트의 `worktreeDir` 칸이고, 비어 있으면 기본 자리
//! `<저장소 부모>/<저장소명>-wt` 다([`worktree_base`]). `C:\src\proj` 에 `feat-x` 를 만들면
//! 기본으로 `C:\src\proj-wt\feat-x`, 브랜치는 `feat-x`(없으면 `-b` 로 새로, 있으면 그 브랜치를
//! 체크아웃). 그 칸은 사용자 피드백(2026-09-24, "워크트리가 어디 생기는지 모르겠다")으로
//! 폼에 드러났다 — 규칙이 숨어 있으면 사람은 폴더를 찾아 헤맨다. 저장소 **안**은 안 된다
//! ([`check_worktree_dir`] — 워크트리를 저장소 작업 폴더 안에 두면 상위 저장소의
//! `git status` 에 통째로 잡힌다). 다른 자리의 워크트리(셸에서 만든 것)도 목록에 똑같이 열린다.
//!
//! ## git 을 부르는 방식
//!
//! - **셸을 거치지 않는다.** `std::process::Command` 에 인자를 낱개로 넘긴다(`-C <저장소>`
//!   가 언제나 맨 앞). 이름은 [`valid_name`] 을 지난 글자뿐이라 `-` 로 시작해 옵션으로
//!   읽히는 일도 없다.
//! - **블로킹 풀에서, 시한 30초**([`GIT_TIMEOUT`]). 넘기면 자식을 죽이고 오류 한 줄이다 —
//!   `git` 이 자격 증명을 물으며 멈추는 일은 워크트리 명령에 없지만(원격을 안 만진다),
//!   네트워크 드라이브의 저장소처럼 느린 자리가 UI 를 붙잡지 않게 한다. 자격 증명 대화는
//!   애초에 막는다(`GIT_TERMINAL_PROMPT=0`).
//! - `git` 이 PATH 에 없으면 그 사실을 그대로 말한다(`git_missing`).
//!
//! ## 원격
//!
//! 원격 프로젝트의 **만들기**는 여기가 아니라 새 SSH 타일이 접속한 뒤 · 첫 입력 전에 그 전송로의 exec 로 한다
//! (`crate::remote_worktree` — 같은 이름 규칙 [`valid_name`] 을 지난다, 2026-09-29 B안). **목록**은 그 호스트에 살아 있는
//! 세션이 있을 때만 exec 왕복 하나로 읽는다([`ssh_git_worktree_list`]) — 명령 글자를 프런트가
//! 짓지 않도록 **이 목적 하나로 좁힌 명령**이다(범용 exec 을 프런트에 열지 않는다).
//! 원격 **제거**도 같은 모양의 좁힌 명령이다([`ssh_git_worktree_remove`]) — 브랜치 삭제는 사람이 켠 칸이
//! 동의다(프런트는 곁 파일의 원격 줄이 "앱이 만든 브랜치" 면 로컬처럼 켠 채로, 모르면 꺼진 채로 연다).
//!
//! ## 브랜치 삭제는 `-d` — 단 하나의 예외 (2026-10-05)
//!
//! 브랜치는 `git branch -d` 로만 지운다(`-D` · `--force` 없음). 예외 하나: `-d` 가 거절했을 때, 실행 순간에 내용 기준
//! 판정(`crate::merge_detect` — squash · rebase 병합)을 다시 내려 병합됨이고 어느 워크트리에도 체크아웃돼 있지 않으면,
//! **방금 판정한 그 커밋**을 조건으로 `git update-ref -d refs/heads/<이름> <해시>`(그사이 움직였으면 git 이 거절)
//! — `merge_detect::delete_verified_local` · `delete_verified_remote`. 판정이 아니라고 하면 예전처럼 남긴다(`unmerged`).

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

/// `git` 한 번의 시한 — 넘기면 자식을 죽인다(모듈 머리말).
pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// 원격 목록 exec 왕복의 시한 — 목록 하나 읽는 데 이보다 오래 걸리면 메뉴가 기다릴 일이 아니다.
const REMOTE_LIST_TIMEOUT: Duration = Duration::from_secs(10);

/// `CREATE_NO_WINDOW` — 콘솔 창이 번쩍이지 않게 한다 ([`crate::keygen`] 과 같은 값).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 워크트리 하나 — `git worktree list --porcelain` 의 한 덩어리.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeInfo {
    /// 워크트리 폴더 (git 이 적은 그대로 — Windows 에서도 `/` 구분자다)
    pub path: String,
    /// 체크아웃한 브랜치 (`refs/heads/` 를 뗀 이름). 분리된 HEAD·bare 면 `None`
    pub branch: Option<String>,
    /// HEAD 커밋 (없으면 `None` — bare)
    pub head: Option<String>,
    /// 작업 폴더 없는 bare 저장소 줄인가 (열 수 없다)
    pub bare: bool,
    /// 분리된 HEAD 인가
    pub detached: bool,
    /// 지금 브랜치를 **앱이 `-b` 로 만들었는가** — 곁 파일(모듈 머리말)에 그렇게 적혀 있고 그
    /// 브랜치가 아직 체크아웃돼 있을 때만 `true`. 제거 확인의 "브랜치도 삭제" 칸이 이 값으로
    /// 켜지거나 흐려진다. 원격 목록은 곁 파일의 원격 줄([`remote_key`])로 같은 판정을 한다(2026-09-29).
    pub created_by_app: bool,
}

/// [`git_worktree_add`] 의 답.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeAdded {
    pub path: String,
    pub branch: String,
    /// 브랜치를 새로 만들었는가 (`-b`). `false` 면 이미 있던 브랜치를 체크아웃했다
    pub branch_created: bool,
    /// 원격 추적 브랜치를 받아 만들었으면 그 이름(`origin/feat-x`) — `crate::worktree_branch::AddPlan::Track`
    pub tracked: Option<String>,
}

/// 브랜치를 **남긴** 까닭 — 프런트의 알림 문구가 이 글자로 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptReason {
    /// `git branch -d` 가 거절했고 내용 기준 판정(squash · rebase)도 병합됨이 아니다 — 병합되었다고 증명할 수 없는 커밋이
    /// 있다(`-D` 는 쓰지 않는다 — 모듈 머리말 "단 하나의 예외")
    Unmerged,
    /// 워크트리보다 먼저 있던 브랜치다(앱이 만들지 않았다 · 모른다)
    Predates,
    /// 사람이 "브랜치도 삭제" 를 껐다
    NotRequested,
    /// 저장소의 지금 브랜치(주 작업 폴더가 체크아웃한 것)다
    Main,
}

/// [`git_worktree_remove`] 의 답.
///
/// `removed=false` 면 git 이 워크트리 제거를 거절한 것이고(커밋하지 않은 변경 등) `message` 가
/// 그 한 줄이다 — 브랜치는 손대지 않았다. `removed=true` 면 브랜치 갈래가 셋 중 하나다:
/// 지웠다(`branch_deleted`) · 남겼다(`branch_kept_reason`) · 브랜치가 없었다(분리된 HEAD — 둘 다 비었다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeRemoved {
    pub removed: bool,
    pub branch: Option<String>,
    pub branch_deleted: bool,
    pub branch_kept_reason: Option<KeptReason>,
    pub message: Option<String>,
}

/// 브랜치 갈래의 한 걸음 — [`branch_decision`] 의 답.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BranchStep {
    /// 문을 다 지났다 — `git branch -d` 를 돌려 보라
    RunDelete,
    /// `-d` 가 지웠다
    Deleted,
    /// 남긴다
    Kept(KeptReason),
}

// ---------------------------------------------------------------------------
// 순수 규칙 — 유닛 테스트 대상
// ---------------------------------------------------------------------------

/// `git worktree list --porcelain` 을 읽는다 — **순수 함수**.
///
/// 덩어리는 빈 줄로 갈린다. 아는 줄만 읽고 나머지(`locked …`·`prunable …`)는 넘긴다 —
/// 새 git 이 줄을 더해도 깨지지 않는다. `worktree` 줄이 없는 덩어리는 버린다. 줄 끝의 `\r`
/// (Windows 의 exec 왕복)도 받는다.
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

/// 브랜치를 지울지의 판정 (**순수 함수**) — Orca 의 규칙: "제거는 체크아웃된 로컬 브랜치도
/// 지우려 한다; 워크트리보다 먼저 있던 브랜치와 병합되었다고 증명할 수 없는 브랜치는 남긴다".
///
/// 문의 차례: 사람이 원했나 → 저장소의 지금 브랜치가 아닌가 → 앱이 만든 것이거나 **main 에 병합됐나** →
/// (여기까지 지나면) `git branch -d` 를 돌린다(`git_d_result = None` 이면 [`BranchStep::RunDelete`]).
/// `-d` 의 결과를 넣고 다시 부르면 지웠다/남겼다(`unmerged`)가 나온다. **`-D` 는 없다** —
/// 병합 판정은 git 에게 맡기고, git 이 증명하지 못하면 남긴다. 단 `-d` 가 거절한 뒤 Rust 가 내용 기준(squash · rebase)으로
/// 병합됨을 **다시 확인해** 판정한 커밋을 조건으로 지웠으면 그것도 `Some(true)` 로 넣는다(모듈 머리말 "단 하나의 예외").
///
/// `merged` (2026-10-05, docs/log/2026-10-05-worktree-one-to-one.md "2026-10-05 추가") — 앱이 만들지 않은 브랜치라도
/// 독의 "병합됨" 칩과 **같은 판정**([`crate::worktree_changes::is_merged`])을 Rust 가 다시 내려 참이면 문을 연다.
/// 프런트의 칸(사람이 켠 것)만 믿는 것이 아니라 Rust 가 스스로 다시 본다 — 그래도 마지막 그물은 `-d` 다.
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

/// 워크트리·브랜치 이름 — 쓸 수 있으면 다듬은 글자, 아니면 사람이 읽을 한 줄 (**순수 함수**).
///
/// 규칙: `[A-Za-z0-9._/-]+` · `-` 로 시작하지 않는다(git 이 옵션으로 읽는다) · `..` 이 없다
/// (브랜치 이름으로도 금지이고, 경로로는 저장소 밖으로 나간다) · `/` 로 시작·끝나지 않고 `//`
/// 이 없다 · `.` 한 조각(`a/./b`)이 없다. 셸 인용 없이도 안전한 글자뿐이라 원격 첫 입력에도
/// 같은 규칙이 그대로 쓰인다.
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

/// 경로 글자를 **비교용으로** 편다 — 구분자를 `/` 로, 끝의 구분자를 떼고, Windows 꼴
/// (드라이브 글자·`\`)이면 소문자로(그 파일 시스템은 대소문자를 가리지 않는다).
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

/// 이 글자가 **절대 자리**인가 — 로컬이면 `/`·`\\`·`X:\`, 원격이면 `/`·`~`(셸이 편다).
///
/// 로컬의 `~` 를 받지 않는 이유: `git` 은 셸을 거치지 않고 불리므로 `~` 가 펴지지 않고,
/// `-C <저장소>` 기준 상대 경로가 되어 **저장소 안**에 `~` 라는 폴더가 생긴다.
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

/// 워크트리 폴더 칸 검사 (**순수 함수**) — 절대 자리여야 하고 저장소 자신·그 안이면 안 된다.
///
/// 프로젝트 저장(`projects::normalize`)과 만들기([`add_blocking`])가 같은 규칙을 지난다 —
/// 프런트의 `worktreeDirProblem` 과 **같은 표**다(한쪽만 고치면 폼은 통과시키고 저장이 거절).
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

/// 새 워크트리들의 **부모 폴더** (**순수 함수**, 로컬) — 칸(`dir`)이 있으면 그것, 없으면
/// `<저장소 부모>/<저장소명>-wt`.
///
/// 부모나 이름이 없는 저장소 경로(`C:\`·`/`)에 칸도 비어 있으면 오류다 — 저장소를 드라이브
/// 뿌리에 둔 경우는 옆에 둘 자리가 없다(그때는 폼에서 폴더를 적으면 된다).
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

/// 새 워크트리의 폴더 — `<워크트리 폴더>/<이름>` (**순수 함수**, 로컬).
///
/// 이름의 `/` 는 폴더 층이 된다(`feat/x` → `…-wt/feat/x`, 브랜치도 `feat/x`).
pub(crate) fn worktree_path(repo: &Path, dir: Option<&str>, name: &str) -> Result<PathBuf, String> {
    let name = valid_name(name)?;
    let mut out = worktree_base(repo, dir)?;
    for seg in name.split('/') {
        out.push(seg);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 곁 파일 — 브랜치를 누가 만들었나 (모듈 머리말)
// ---------------------------------------------------------------------------

/// 곁 파일의 한 줄 — 키는 워크트리 폴더([`path_key`]).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct WorktreeRecord {
    /// 만든 순간 체크아웃한 브랜치 — 지금 브랜치와 다르면(셸에서 바꿨다) 이 줄은 뜻이 없다
    pub branch: String,
    /// `-b` 로 앱이 만들었나 (`false` = 있던 브랜치를 체크아웃했다)
    pub created_by_app: bool,
    /// 만든 때 (유닉스 ms) — 읽는 곳은 없다, 파일을 보는 사람을 위한 것
    #[serde(default)]
    pub created_at: u64,
    /// 저장소 폴더([`path_key`]) — 목록을 읽을 때 **그 저장소의 줄만** 걷어 내려고 둔다
    /// (곁 파일은 모든 프로젝트가 함께 쓴다). 없으면 걷지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    /// 설정 스크립트 실행 기록 — 이 워크트리에서 마지막으로 돌린 결과 (모듈 머리말). 없으면 돌린 적이 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<SetupRun>,
    /// **시작 커밋**(옛 칸) — 2026-09-29 ~ 10-03 에 앱이 워크트리를 만든 직후의 `HEAD` 를 적었다(독 변경 배지의 기준).
    /// 2026-10-04 부터 배지 기준은 주 폴더 브랜치 하나라(`crate::worktree_changes`) **새로 적지도 읽지도 않는다** —
    /// 옛 곁 파일을 그대로 읽고 다시 쓸 때 잃지 않게 칸만 남긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// **오케스트레이션 Run 이 만든 worktree** 면 그 Run id(2026-10-15 — 설계 C-3 ②). 세션 서버의 worktree op 층
    /// (`crate::orchestration::worktree`)이 적고, 그 층의 삭제는 이 칸이 자기 Run 인 줄만 받는다(사람이 만든 worktree 거절).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    /// **서버 임시 자리**면 그 역할(`verify` · `review` — 통합 설계 6-2, 2026-10-16). 세션 서버가 Run 의 검증 · 검토 worktree 를 만들 때 적고,
    /// 폐기 정책(`crate::orchestration::cleanup`)은 이 칸 + `run` 이 그 Run 인 줄(또는 Run 장부가 아는 자리)만 지운다. 작업자 worktree 는 없음.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// 설정 스크립트 한 번의 결과 — 곁 파일의 `setup` 칸.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct SetupRun {
    /// 종료 코드가 0 이었나
    pub ok: bool,
    /// 종료 코드
    pub code: i32,
    /// 끝난 때 (유닉스 ms)
    pub at: u64,
}

/// 곁 파일 한 장 — `{ "<워크트리 폴더>": { branch, created_by_app, created_at, repo } }`.
pub(crate) type Sidecar = BTreeMap<String, WorktreeRecord>;

pub(crate) fn sidecar_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("worktrees.json"))
}

/// 읽고-고치고-쓰는 한 벌을 한 번에 하나만 (`projects.rs` 의 `FILE_LOCK` 과 같은 이유).
static SIDECAR_LOCK: Mutex<()> = Mutex::new(());

/// 깨진 곁 파일을 한 번 알렸는가.
static SIDECAR_WARNED: AtomicBool = AtomicBool::new(false);

/// 곁 파일을 읽는다 — 없으면 빈 표, **깨졌으면 빈 표 + 경고 한 번**(`projects::load_file` 과 같다).
/// 빈 표는 "전부 먼저 있던 브랜치" 라는 뜻이라 잃어도 지우는 쪽으로 틀리지 않는다.
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

/// 읽고 → 고치고(`f` 가 `true` 면) → 쓴다. 곁 파일이 못 쓰여도 워크트리 일 자체는 이미 끝났으므로
/// 부르는 쪽은 오류를 콘솔에만 남긴다([`note_sidecar`]).
///
/// **쓰기 주인은 하나다(2026-10-15 — 설계 C-3 ②)**: 이 파일은 GUI(로컬 worktree 명령)와 세션 서버(원격 새 worktree ·
/// 오케스트레이션 worktree op)가 함께 쓴다. 프로세스 안의 [`SIDECAR_LOCK`] 만으로는 두 프로세스의 읽고-고치고-쓰기가 겹쳐 한쪽
/// 줄이 사라질 수 있다 — 그래서 곁 파일 옆 잠금 파일(`worktrees.json.lock`)의 **OS 배타 잠금**을 함께 쥔다([`with_file_lock`]).
/// 모든 쓰기가 이 함수 하나를 지나므로 프로세스가 몇이든 한 번에 하나만 쓴다.
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

/// `path` 옆 잠금 파일(`<이름>.lock`)의 OS 배타 잠금을 쥐고 `f` 를 돌린다 — 다른 프로세스(같은 프로세스의 다른 파일 손잡이도)는
/// 풀릴 때까지 기다린다. 잠금 파일을 못 열면 잠금 없이 돈다(곁 파일을 못 쓰는 것보다 낫다 — 예전 동작).
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

/// 이 폴더의 곁 파일 줄이 오케스트레이션 Run 의 것인가 — 그 Run id(`crate::orchestration::worktree` 의 삭제 관문).
pub(crate) fn run_of(file: &Sidecar, key: &str) -> Option<String> {
    record_for(file, key).and_then(|r| r.run.clone())
}

/// 오케스트레이션 worktree 를 곁 파일에 적는다(서버 — `crate::orchestration::worktree`). 같은 폴더의 옛 줄은 걷고 새 줄 하나로.
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

/// 서버 임시 자리(검증 · 검토 worktree — 분리 HEAD)를 곁 파일에 적는다(통합 설계 6-2 — `role` 칸). 같은 폴더의 옛 줄은 걷는다.
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

/// 이 Run 의 서버 임시 자리 줄들 — `(폴더 열쇠, 역할)`.
pub(crate) fn server_places_of(file: &Sidecar, run_id: &str) -> Vec<(String, String)> {
    file.iter()
        .filter(|(_, r)| r.run.as_deref() == Some(run_id))
        .filter_map(|(k, r)| r.role.clone().map(|role| (k.clone(), role)))
        .collect()
}

/// 이 폴더의 곁 파일 줄의 서버 임시 자리 역할(있으면).
pub(crate) fn role_of(file: &Sidecar, key: &str) -> Option<(String, String)> {
    record_for(file, key).and_then(|r| Some((r.run.clone()?, r.role.clone()?)))
}

/// 곁 파일에서 그 폴더의 줄을 걷는다(서버 — 오케스트레이션 worktree 삭제 뒤).
pub(crate) fn forget_path(sidecar: &Path, key: &str) -> Result<bool, String> {
    let want = comparable(key);
    modify_sidecar(sidecar, |f| {
        let before = f.len();
        f.retain(|k, _| comparable(k) != want);
        f.len() != before
    })
}

/// 곁 파일 쓰기가 실패했을 때 — 콘솔 한 줄(사람의 일은 이미 끝났다).
fn note_sidecar(r: Result<bool, String>) {
    if let Err(e) = r {
        eprintln!("[aynx] worktrees.json 을 쓰지 못했습니다: {e}");
    }
}

/// Windows 의 `canonicalize` 가 붙이는 `\\?\` 머리를 뗀다 (`\\?\UNC\s\x` → `\\s\x`).
pub(crate) fn strip_verbatim(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p.to_string()
    }
}

/// 폴더 하나의 **키 글자** — 있는 폴더면 실제 자리(`canonicalize` — 짧은 이름 `LONGNA~1`·심볼릭
/// 링크를 편다), 없으면 받은 글자 그대로. git 은 `C:/src/x`, `git_worktree_add` 는 `C:\src\x` 를
/// 주므로 **비교는 언제나 [`comparable`] 로** 한다(키 글자 자체는 사람이 읽을 모양으로 둔다).
pub(crate) fn path_key(path: &str) -> String {
    match std::fs::canonicalize(path.trim()) {
        Ok(p) => strip_verbatim(&p.to_string_lossy()),
        Err(_) => path.trim().to_string(),
    }
}

/// 그 폴더의 곁 파일 줄 (키 비교는 [`comparable`]) — `key` 는 [`path_key`] 를 지난 글자.
pub(crate) fn record_for<'a>(file: &'a Sidecar, key: &str) -> Option<&'a WorktreeRecord> {
    let want = comparable(key);
    file.iter()
        .find(|(k, _)| comparable(k) == want)
        .map(|(_, r)| r)
}

/// 이 저장소(`repo_key`)의 줄 중 **git 목록에 없는 폴더**의 줄을 걷는다 (**순수 함수**). 다른
/// 저장소의 줄·저장소를 모르는 줄은 건드리지 않는다. 걷은 것이 있으면 `true`.
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

/// 설정 스크립트 결과를 그 워크트리의 줄에 적는다 (**순수 함수**) — 줄이 없으면(앱이 만들지 않은 워크트리)
/// 브랜치를 모르는 줄(`created_by_app: false`)로 새로 세운다. 늘 `true`(적었다).
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

/// 이 저장소의 **설정 스크립트 기록**만 걷는다 (**순수 함수** — 프로젝트를 지울 때). 브랜치 기록(`created_by_app`)은
/// 남기고, 기록 하나만 들고 있던 줄(브랜치를 모르는 줄)은 통째로 뺀다. 걷은 것이 있으면 `true`.
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

/// 이 저장소에서 설정 스크립트를 돌린 워크트리 수 (**순수 함수** — 프로젝트 제거 확인의 "실행 기록 N개").
pub(crate) fn setup_count_in(file: &Sidecar, repo_key: &str) -> usize {
    let repo = comparable(repo_key);
    file.values()
        .filter(|r| {
            r.setup.is_some() && r.repo.as_deref().map(comparable).as_deref() == Some(repo.as_str())
        })
        .count()
}

/// 앱이 만든 브랜치가 **지금도** 그 워크트리에 체크아웃돼 있나 — 곁 파일 줄의 브랜치와 git 이 준
/// 지금 브랜치가 같을 때만 믿는다(셸에서 다른 브랜치로 바꿨으면 그 브랜치는 앱의 것이 아니다).
fn made_by_app(rec: Option<&WorktreeRecord>, branch: Option<&str>) -> bool {
    matches!((rec, branch), (Some(r), Some(b)) if r.created_by_app && r.branch == b)
}

// ---------------------------------------------------------------------------
// 곁 파일의 원격 줄 (2026-09-29 — docs/log/2026-09-29-remote-worktree-after-connect.md)
//
// 원격 새 워크트리도 이제 **앱이** 만든다(접속한 뒤 · 첫 입력 전에 exec 로 — `crate::remote_worktree`). 그래서
// "브랜치를 앱이 `-b` 로 만들었나" 를 로컬과 같은 곁 파일에 적는다. 열쇠는 로컬 줄과 부딪히지 않게
// `ssh://<별칭(소문자)><서버의 절대 경로>` 다 — 로컬 열쇠는 드라이브 글자·`\`·`/` 로 시작하므로 섞이지 않고,
// [`comparable`] 은 이 글자를 Windows 꼴로 보지 않아 대소문자를 그대로 둔다(리눅스 경로는 대소문자를 가린다).
// 경로는 git 이 적는 절대 경로다(`rev-parse --show-toplevel` · `worktree list`) — 사람이 적은 `~/…` 가 아니다.
// ---------------------------------------------------------------------------

/// 원격 곁 파일 열쇠 (**순수 함수**) — `ssh://dev-01/home/me/api-wt/x`. 경로 끝의 `/` 는 뗀다.
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

/// 원격 새 워크트리를 적는다 (**순수 함수**) — 같은 열쇠의 옛 줄은 걷고 새 줄 하나로. 로컬 [`add_blocking`] 과 같은 모양.
/// `line` 의 `repo` 칸은 여기서 채운다(`ssh://<별칭><저장소 루트>`).
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

/// 원격 목록에 곁 파일의 `created_by_app` 을 싣는다 (**순수 함수**) — 로컬 [`list_blocking`] 과 같은 판정([`made_by_app`]).
pub(crate) fn mark_remote_list(file: &Sidecar, alias: &str, list: &mut [WorktreeInfo]) {
    for w in list.iter_mut() {
        w.created_by_app = made_by_app(
            record_for(file, &remote_key(alias, &w.path)),
            w.branch.as_deref(),
        );
    }
}

/// 원격 목록을 읽은 뒤 걷을 것 — `(저장소 열쇠, 목록의 열쇠들)`. 저장소는 git 의 첫 덩어리(주 작업 폴더)다.
/// 목록이 비었으면 `None`(걷을 기준이 없다).
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

/// 원격 새 워크트리를 곁 파일에 적는다 — **블로킹**(부르는 쪽이 블로킹 풀 안이다). 못 쓰면 콘솔 한 줄.
/// 시작 커밋(`base`)은 적지 않는다 — 독 배지의 기준은 주 폴더 브랜치 하나다(2026-10-04).
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

/// 원격 목록에 곁 파일을 싣고, 이 저장소의 원격 줄 중 목록에 없는 것을 걷는다 — **블로킹**.
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

/// 원격 워크트리를 지운 뒤 그 줄을 걷는다 — **블로킹**.
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

// ---------------------------------------------------------------------------
// git 한 번 — 셸 없이, 시한 안에서
// ---------------------------------------------------------------------------

/// `git` 이 PATH 에 없다.
fn git_missing() -> String {
    tr!(
        ko: "git 을 찾을 수 없습니다 — git 을 설치하고 PATH 에 두어야 워크트리를 다룰 수 있습니다",
        en: "Could not find git — install git and put it on PATH to work with worktrees"
    )
}

/// 한 번 돈 결과 — 성공 여부와 두 출력.
pub(crate) struct GitRun {
    pub(crate) ok: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// 실패한 git 의 사람이 읽을 한 줄 — stderr 가 있으면 그것, 없으면 종료 사실.
pub(crate) fn git_failure(run: &GitRun) -> String {
    let msg = run.stderr.trim();
    if msg.is_empty() {
        tr!(ko: "git 이 실패했습니다", en: "git failed")
    } else {
        msg.to_string()
    }
}

/// `git -C <repo> <args…>` 를 **블로킹으로** 한 번 돌린다 (부르는 쪽이 `spawn_blocking` 안이다).
///
/// 출력은 스레드 둘이 끝까지 읽는다 — 파이프가 차서 자식이 멈추면 `try_wait` 가 영영 오지
/// 않는다. 시한을 넘기면 `kill` 하고 오류다.
pub(crate) fn run_git(repo: &Path, args: &[&str], timeout: Duration) -> Result<GitRun, String> {
    run_git_env(repo, args, timeout, &[])
}

/// [`run_git`] 에 환경 변수 몇 개를 더 얹은 것 — 운영 코드는 늘 빈 목록이고, 테스트가 전역 git 설정을
/// 떼어 내는 데(`GIT_CONFIG_GLOBAL` 등) 쓴다(`git_repo.rs` 의 왕복 테스트 — 사람 PC 의 `user.name` 에
/// 기대지 않고 "신원 없음" 실패 갈래까지 돈다).
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

/// 목록 — 블로킹 몸통. 곁 파일이 있으면 줄마다 `created_by_app` 을 채우고, 이 저장소의 줄 중
/// git 목록에서 사라진 것을 걷어 낸다(셸에서 `git worktree remove` 한 것 — 값싼 정리).
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

/// 만들기 — 블로킹 몸통. 브랜치는 [`crate::worktree_branch::plan_add`] 가 정한다(있는 것 · 원격 추적 · 주 브랜치에서 새로). 만든 뒤 곁
/// 파일에 "누가 브랜치를 만들었나" 를 적는다(제거가 브랜치를 지울지 이 줄로 가른다).
pub(crate) fn add_blocking(
    repo: &Path,
    dir: Option<&str>,
    name: &str,
    sidecar: Option<&Path>,
) -> Result<WorktreeAdded, String> {
    let name = valid_name(name)?.to_string();
    let dir = worktree_path(repo, dir, &name)?;
    let dir_s = dir.to_string_lossy().into_owned();
    // 브랜치 판정은 `worktree_branch::plan_add` 하나(있는 브랜치 · 원격 추적 하나 · 주 브랜치에서 새로 — 2026-10-05).
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
        // 시작 커밋(`base`)은 더 적지 않는다 — 독 배지의 기준은 주 폴더 브랜치 하나다(2026-10-04).
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
            // 같은 폴더의 옛 줄(구분자만 다른 글자)을 먼저 걷고 새 줄 하나로.
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

/// git 이 준 여러 줄 중 사람이 읽을 첫 줄 (`error: …` 한 줄 — 뒤의 `hint:` 들은 버린다).
pub(crate) fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// 제거 — 블로킹 몸통.
///
/// 1. 그 워크트리의 브랜치를 목록에서 읽는다(분리된 HEAD 면 브랜치 갈래가 없다).
/// 2. `git worktree remove <path>` — `--force` 는 **붙이지 않는다**: 커밋하지 않은 변경이 있으면
///    git 이 거절하고 그 한 줄을 `removed=false` 로 돌려준다(브랜치는 건드리지 않는다).
/// 3. [`branch_decision`] 의 문을 지나면 `git branch -d`(**`-D` 는 없다**) — 거절이면 내용 기준 판정을 다시 내려
///    squash · rebase 병합이 확인되면 그 커밋을 조건으로 `update-ref -d`([`crate::merge_detect::delete_verified_local`]),
///    아니면 남긴다. 앱이 만들지 않은 브랜치는 main 에 병합됐을 때만(Rust 가 다시 본다 —
///    [`crate::worktree_changes::branch_merged_blocking`]) 문을 지난다.
/// 4. 곁 파일의 그 줄을 지운다.
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
    // 폴더가 사라지기 **전에** 키를 잡는다(`canonicalize` 는 있는 폴더에서만 편다).
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
    // 저장소의 지금 브랜치 = git 의 첫 덩어리(주 작업 폴더)가 체크아웃한 것.
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
        // 앱이 만들지 않은 브랜치를 지우라고 하면 — 병합됨(독의 칩과 같은 판정)을 Rust 가 다시 본다.
        // 그 밖의 경우엔 git 을 더 부르지 않는다.
        let merged = delete_branch
            && !created
            && !is_current
            && crate::worktree_changes::branch_merged_blocking(repo, b, current.as_deref());
        let mut step = branch_decision(delete_branch, created, merged, is_current, None);
        if step == BranchStep::RunDelete {
            // 이름이 `-` 로 시작하면 git 이 옵션으로 읽는다 — 브랜치 이름으로는 git 이 막지만 한 번 더.
            let ok = if b.starts_with('-') {
                false
            } else {
                let d = run_git(repo, &["branch", "-d", b], GIT_TIMEOUT)?;
                if d.ok {
                    true
                } else if crate::merge_detect::delete_verified_local(repo, b)?.is_some() {
                    // `-d` 는 조상 관계만 본다 — squash · rebase 병합이 지금 다시 확인돼 그 커밋 조건으로 지웠다.
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

/// 저장소 경로 — 비었으면 오류.
pub(crate) fn repo_of(repo: &str) -> Result<PathBuf, String> {
    let r = repo.trim();
    if r.is_empty() {
        return Err(tr!(ko: "프로젝트 경로가 비어 있습니다", en: "The project path is empty"));
    }
    Ok(PathBuf::from(r))
}

/// 블로킹 몸통을 풀에서 돌린다 (docs/conventions.md — Tauri 명령은 async).
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| tr!(ko: "git 작업이 실패했습니다: {e}", en: "The git task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 로컬 저장소의 워크트리 목록 (주 작업 폴더가 첫 줄이다 — git 의 순서).
#[tauri::command]
pub async fn git_worktree_list(repo: String) -> Result<Vec<WorktreeInfo>, String> {
    let repo = repo_of(&repo)?;
    blocking(move || list_blocking(&repo, sidecar_path().as_deref())).await
}

/// 로컬 저장소에 새 워크트리 — 자리는 [`worktree_path`](`dir` = 프로젝트의 워크트리 폴더,
/// 없으면 기본 자리), 브랜치는 이름 그대로. 돌려주는 `path` 가 **실제로 만든 자리**다 —
/// 프런트의 알림("워크트리를 만들었습니다: …")은 이 글자를 그대로 쓴다.
#[tauri::command]
pub async fn git_worktree_add(
    repo: String,
    name: String,
    dir: Option<String>,
) -> Result<WorktreeAdded, String> {
    let repo = repo_of(&repo)?;
    blocking(move || add_blocking(&repo, dir.as_deref(), &name, sidecar_path().as_deref())).await
}

/// 로컬 워크트리 하나를 지운다 (`--force` 없이) — `delete_branch` 면 브랜치도 지우려 한다
/// ([`branch_decision`] 의 문을 지난 것만, `git branch -d` 로만). git 이 워크트리 제거를
/// 거절하면 `Err` 가 아니라 `removed=false` + 그 한 줄이다(사람이 읽고 셸에서 정리한다).
#[tauri::command]
pub async fn git_worktree_remove(
    repo: String,
    path: String,
    delete_branch: bool,
) -> Result<WorktreeRemoved, String> {
    let repo = repo_of(&repo)?;
    blocking(move || remove_blocking(&repo, &path, delete_branch, sidecar_path().as_deref())).await
}

/// **설정 스크립트 결과 적기** — 로컬 워크트리 `path`(저장소 `repo`)에서 돈 결과(종료 코드 `code`)를 곁 파일에
/// 한 칸으로(모듈 머리말). 타일이 스크립트의 끝 신호를 받은 순간 프런트가 부른다. 못 써도 사람의 일은 끝났으므로
/// 오류는 콘솔 한 줄이고 `Ok` 다.
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

/// 이 저장소에서 설정 스크립트를 돌린 워크트리 수 — 프로젝트 제거 확인이 "함께 지워지는 것" 에 적는다.
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

/// 이 저장소의 설정 스크립트 기록을 걷는다 — **블로킹**(부르는 쪽이 블로킹 풀 안이다 — `crate::projects` 의
/// 제거). 못 쓰면 콘솔 한 줄.
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

/// 원격 목록의 exec 명령 — `git -C <저장소> worktree list --porcelain` (**순수 함수**).
/// 경로 인용은 첫 입력과 같은 [`crate::ssh::sh_path`] 하나다(`~/api` → `"$HOME"/'api'`).
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

/// **원격** 저장소의 워크트리 목록 — 살아 있는 SSH 세션 `id` 의 전송로로 exec 왕복 하나.
///
/// 화면(PTY)을 건드리지 않는다(`ssh_tmux_list` 와 같은 길). 명령 글자는 여기서 짓는다 —
/// 프런트가 넘기는 것은 저장소 경로뿐이다. 실패(git 없음·저장소 아님)는 서버가 준 한 줄이다.
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
    // 앱이 만든 원격 브랜치(곁 파일의 원격 줄)를 싣는다 — 제거 확인의 "브랜치도 삭제" 가 로컬처럼 켜진 채 선다.
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

// ---------------------------------------------------------------------------
// 원격 제거 (docs/log/2026-09-24-worktrees.md "원격 제거")
// ---------------------------------------------------------------------------

/// 원격 제거 한 걸음의 시한 — 홈·목록·제거·`-d` 를 따로 잰다. 로컬(30초)보다 짧은 이유: 확인
/// 상자가 사람 앞에서 기다린다. `worktree remove` 는 폴더를 지우는 일이라 목록(10초)보다는 길게 준다.
const REMOTE_REMOVE_TIMEOUT: Duration = Duration::from_secs(15);

/// 원격 제거가 서버로 보내는 명령들 — **이 글자들만** 나간다(프런트는 저장소·경로만 넘긴다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteRemoveCommands {
    /// `git -C <저장소> worktree list --porcelain` — 브랜치와 "주 작업 폴더인가" 를 읽는다
    pub list: String,
    /// `git -C <저장소> worktree remove <경로>` — `--force` 는 **없다**
    pub remove: String,
    /// 인용한 저장소 — `-d` 명령은 브랜치를 안 뒤에 짓는다([`Self::branch_delete`])
    repo_q: String,
}

impl RemoteRemoveCommands {
    /// `git -C <저장소> branch -d <브랜치>` — **`-D` 는 없다**. `-` 로 시작하는 이름은 옵션으로
    /// 읽히므로 짓지 않는다(git 이 그런 브랜치를 만들지 않지만 로컬과 같이 한 번 더 막는다).
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

/// 원격 제거의 명령 글자 (**순수 함수**). 저장소·경로는 첫 입력·목록과 같은
/// [`crate::ssh::sh_path`] 로 인용한다(`~/api` → `"$HOME"/'api'`). 경로는 원격의 **절대 자리**
/// (`/`·`~`)여야 한다 — 상대 경로는 `-C` 기준으로 풀려 엉뚱한 폴더를 가리키고, `-` 로 시작하면
/// git 이 옵션으로 읽는다. 제어 문자(개행)는 인용 안에서도 새 명령줄이라 버린다.
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

/// 원격 경로를 **비교용으로** 편다 (**순수 함수**) — 앞의 `~` 를 홈으로(홈을 모르면 그대로),
/// 끝의 `/` 를 뗀다. 원격(리눅스)은 대소문자를 가리므로 [`comparable`] 과 달리 낮추지 않는다.
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

/// git 목록에서 지울 워크트리를 찾는다 (**순수 함수**). 답 = `(찾은 줄, 주 작업 폴더인가)`.
/// 주 작업 폴더는 git 의 첫 덩어리이고, 저장소 경로 자신을 가리켜도 그렇게 본다(git 도 거절한다).
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

/// 원격 git 이 거절했을 때 사람이 읽을 **첫 줄** (**순수 함수**) — 뒤의 `hint:` 들은 버린다.
/// stderr 가 비었으면 종료 사실 한 줄이다.
pub(crate) fn remote_failure_line(stderr: &str) -> String {
    let line = first_line(stderr);
    if line.is_empty() {
        tr!(ko: "원격 git 이 실패했습니다", en: "The remote git failed")
    } else {
        line
    }
}

/// exec 왕복 하나 — 전송 오류·시한 초과는 `Err`(사람이 읽을 한 줄), 끝까지 돌았으면 그 결과.
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

/// **원격** 워크트리 하나를 지운다 — 살아 있는 SSH 세션 `id` 의 전송로로 exec 왕복 몇 번.
///
/// 로컬 [`git_worktree_remove`] 와 같은 답·같은 규칙이다(`--force` 없음 · 브랜치는 `-d` 로만(+ 모듈 머리말의 확인된 예외) ·
/// 거절은 `removed=false` + git 의 첫 줄). 다른 점 하나: "앱이 만든 브랜치인가" 자리에 **사람이 켠 칸**
/// (`delete_branch`)을 넣는다 — 프런트가 곁 파일의 원격 줄([`remote_key`] — 앱이 만든 원격 워크트리)이 있으면 그 칸을
/// 켠 채로, 없으면 **꺼진 채로** 연다(모르면 지우지 않는다). 지웠으면 그 원격 줄을 걷는다.
///
/// 1. `~` 가 섞였으면 `printf %s "$HOME"` 로 홈을 묻는다(git 은 절대 경로로 적는다 — 맞대려고).
/// 2. `worktree list --porcelain` — 브랜치와 주 작업 폴더 여부. 주 작업 폴더면 거절한다.
/// 3. `worktree remove` — 거절이면 `removed=false` + 첫 줄, 브랜치는 손대지 않는다.
/// 4. [`branch_decision`] 을 지나면 `branch -d` — 거절이면 판정 스크립트로 squash · rebase 병합을 다시 확인해 그 커밋 조건으로
///    `update-ref -d`([`crate::merge_detect::delete_verified_remote`]), 아니면 `unmerged` + git 의 첫 줄.
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

    // 1) 홈 — `~` 가 없으면 묻지 않는다. 못 알아내도 멈추지 않는다(글자 그대로 견준다).
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

    // 2) 목록 — 저장소가 아니거나 git 이 없으면 여기서 그 한 줄로 멈춘다(제거도 어차피 실패한다).
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
    // 저장소의 지금 브랜치 = git 의 첫 덩어리(주 작업 폴더)가 체크아웃한 것 — 로컬과 같은 판정.
    let current = list.first().and_then(|w| w.branch.clone());

    // 3) 제거 — `--force` 없이.
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
    // 워크트리는 지워졌다 — 곁 파일의 그 줄(앱이 만든 브랜치의 기록)도 걷는다.
    if let (Some(alias), Some(p)) = (alias, entry_path) {
        let _ =
            tauri::async_runtime::spawn_blocking(move || forget_remote_blocking(&alias, &p)).await;
    }

    // 4) 브랜치 — 곁 파일 대신 사람이 켠 칸이 "지워도 된다" 의 동의다(함수 머리말).
    let mut out = WorktreeRemoved {
        removed: true,
        branch: branch.clone(),
        branch_deleted: false,
        branch_kept_reason: None,
        message: None,
    };
    if let Some(b) = branch.as_deref() {
        let is_current = current.as_deref() == Some(b);
        // 원격은 사람이 켠 칸 자체가 동의다(함수 머리말) — 병합됨 다시 보기는 없고 `-d` 가 그물이다.
        let mut step = branch_decision(delete_branch, delete_branch, false, is_current, None);
        if step == BranchStep::RunDelete {
            let ok = match cmds.branch_delete(b) {
                None => false,
                Some(cmd) => match remote_git(&handle, cmd).await {
                    Ok(d) if d.exit_code == Some(0) => true,
                    Ok(d) => match crate::merge_detect::delete_verified_remote(&handle, &repo, b).await {
                        // `-d` 는 조상 관계만 본다 — squash · rebase 병합이 지금 다시 확인돼 그 커밋 조건으로 지웠다.
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

// ---------------------------------------------------------------------------
// 변경 파일 도장 — 메신저 알림의 "파일 N개 변경" (docs/log/2026-09-27-discord-notify.md)
// ---------------------------------------------------------------------------

/// 도장 하나가 싣는 최대 줄 수 — 넘으면 도장이 없다(그 칸을 빼고 보낸다).
const SNAPSHOT_MAX_ENTRIES: usize = 5000;
/// 도장 한 번의 git 시한 — 알림 하나를 오래 붙잡지 않게.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);

/// `git status --porcelain=v1 -z --no-renames` 의 출력 → 도장 줄들(`"<XY>\t<mtime>\t<경로>"`, 줄 순으로 정렬).
/// **순수 함수** — `mtime` 은 저장소 맨 위 기준 경로 → 고친 시각(ms, 없으면 `-1`). 너무 많으면 `None`.
///
/// 두 도장의 **서로 다른 줄의 경로 수**가 그사이 바뀐 파일 수다: 새로 더러워진 파일 · 깨끗해진 파일 · 이미
/// 더러웠는데 다시 고친 파일(mtime 이 바뀐다) 모두 한 번씩 센다.
pub(crate) fn snapshot_entries(stdout: &str, mtime: impl Fn(&str) -> i64) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for rec in stdout.split('\0') {
        // `XY <경로>` — 두 글자 상태, 빈칸, 경로
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

/// 폴더 하나의 변경 도장 — 블로킹. git 저장소가 아니거나 · git 이 없거나 · 실패하면 `None`.
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

/// 로컬 폴더의 **변경 도장** — 에이전트 턴의 시작과 끝에 한 번씩 찍어 견주면 그 턴에 바뀐 파일 수가 나온다
/// (프런트 `src/lib/app/agent-turn.ts`). 알림 재료일 뿐이라 실패는 오류가 아니라 `None` 이다(그 칸을 뺀다).
/// 파일 이름은 담기지만 내용은 없다 — 알림 몸통에 실리는 것은 **개수**뿐이다.
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
