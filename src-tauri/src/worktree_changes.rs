//! 워크트리 변경 상태 — 독 워크트리 줄의 배지 `+84 −19 ↑2` · `병합됨` 재료 (docs/log/2026-09-29-worktree-badges.md).
//!
//! 소스 컨트롤 1단계다. **읽기 전용** — git 에 쓰는 명령은 하나도 없다(`diff` 도 `--no-optional-locks` 로 부른다:
//! 에이전트가 같은 워크트리에서 git 을 쓰는 중에 이 읽기가 `index.lock` 을 잡으면 그쪽 명령이 실패한다).
//!
//! ## 세는 것 (2026-10-04 — 커밋 기준 + 병합됨, GitHub PR 과 같은 규칙)
//!
//! 기준은 **주 작업 폴더의 브랜치(`git worktree list` 의 첫 덩어리, 보통 `main`) 하나뿐**이다. 곁 파일의 시작 커밋
//! (`WorktreeRecord.base`)은 더 이상 읽지 않는다 — 그 기준은 main 에 병합한 뒤에도 숫자를 남겼다.
//!
//! - **앞선 커밋 `↑N`** — `git rev-list --count refs/heads/<main>..HEAD`(갈라진 지점부터 이쪽에만 있는 커밋). 주 폴더가
//!   분리된 HEAD 라 main 을 모르거나 셀 수 없으면 `None` — 배지에서 `↑` 를 뺀다.
//! - **줄 수 `+A −D`** — **커밋한 것만**: `git diff --numstat <merge-base(HEAD, refs/heads/<main>)> HEAD`(작업 트리가
//!   아니다). merge-base 를 못 잡으면 0·0. 바이너리(numstat 의 `-`)는 세지 않는다. **커밋 안 한 변경 · 추적 안 하는 새
//!   파일은 세지 않는다** — 그것은 브랜치 그래프의 ✎ 줄이 보여 준다.
//! - **병합됨 `merged`** — 지금 브랜치가 있고(분리 HEAD 아님) · main 이 아니고 · `ahead == Some(0)` 이고 · 그 브랜치
//!   reflog 에 커밋 기록이 있다([`is_merged`] · [`reflog_has_commits`]). reflog 가 `branch: Created from …` 한 줄뿐이면
//!   갓 만든 브랜치(아직 아무것도 안 했다)라 병합됨이 아니다. reflog 를 못 읽으면 `false`.
//!   그게 아니고 앞선 커밋이 있으면 **내용 기준**(squash · rebase 병합 — `crate::merge_detect`, 2026-10-05)으로 한 번 더
//!   본다. 무엇으로 병합됐는지는 `merged_kind`(`ancestry` · `squash` · `rebase`) — 셋 다 같은 칩이고 툴팁만 다르다.
//!   squash · rebase 병합이면 `ahead` 는 그대로 N 이지만 프런트는 병합됨처럼 숫자 배지를 숨긴다.
//!
//! [`classify`] · [`text_lines`] · [`UNTRACKED_MAX_FILES`] · [`UNTRACKED_MAX_BYTES`] · [`valid_commit`] 은 이 모듈이 더는
//! 쓰지 않지만 함께 쓰는 조각이라 여기 둔다 — 커밋 안 한 것의 규칙(`crate::branch_graph::uncommitted_parts` → 커밋 그래프
//! `crate::commit_graph` 의 dirty · ✎ 줄)이 앞의 넷을, 커밋 그래프 · 새 워크트리(`crate::worktree_branch`)가 `valid_commit`
//! 을 쓴다.
//!
//! ## 로컬 · 원격
//!
//! 로컬은 `git` 을 셸 없이 낱개 인자로(`crate::worktree::run_git`). 원격은 목록과 같은 규칙 — **그 호스트에 이미 붙은
//! 세션**의 전송로로 exec **한 번**에 여러 워크트리를 도는 `sh -c` 스크립트([`remote_changes_command`] — 글자는 Rust 가
//! 짓고 프런트는 저장소 · 경로만 넘긴다, 범용 exec 을 열지 않는다). 출력은 기계용 줄뿐이라 로케일을 타지 않는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use crate::i18n::tr;
use crate::merge_detect::{content_local, judge, ContentFacts, MergeKind};
use crate::worktree::{comparable, git_failure, parse_porcelain, path_key, run_git};

/// 한 번에 물을 수 있는 워크트리 수 — 넘치는 것은 버린다(독 한 프로젝트의 워크트리가 이보다 많을 일은 드물다).
pub(crate) const MAX_PATHS: usize = 64;
/// 로컬 git 한 번의 시한.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(15);
/// 원격 exec 한 번(워크트리 여럿을 한꺼번에)의 시한.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);

/// 워크트리 하나의 변경 상태 — 프런트 `$lib/worktree-changes` 가 읽는다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct WorktreeChanges {
    /// 물은 경로 그대로(프런트의 열쇠)
    pub path: String,
    /// 주 폴더 브랜치보다 앞선 커밋 수 — 그 브랜치를 모르면 `None`
    pub ahead: Option<u32>,
    /// merge-base 부터 `HEAD` 까지 더한 줄 수(커밋한 것만, 바이너리 제외)
    pub added_lines: u32,
    /// merge-base 부터 `HEAD` 까지 뺀 줄 수
    pub deleted_lines: u32,
    /// 커밋이 모두 주 폴더 브랜치에 들어갔다 — 모듈 머리말 "병합됨"(조상 · squash · rebase)
    pub merged: bool,
    /// 무엇으로 병합됐나 — `merged` 일 때만
    pub merged_kind: Option<MergeKind>,
}

/// 추적 안 하는 새 파일 — 앞에서 이 개수까지만 줄을 센다(나머지는 건너뛴다). 커밋 안 한 것의 규칙(`branch_graph` · `commit_graph`)이 쓴다.
pub(crate) const UNTRACKED_MAX_FILES: usize = 200;
/// 추적 안 하는 새 파일 — 이보다 큰 파일은 줄을 세지 않는다(1 MiB). 커밋 안 한 것의 규칙이 쓴다.
pub(crate) const UNTRACKED_MAX_BYTES: u64 = 1024 * 1024;
/// 바이너리 판정에 보는 앞부분 — git 과 같은 8000바이트.
const BINARY_SNIFF: usize = 8000;

/// reflog 한 줄(`%gs`)이 이 글자로 시작하면 그 브랜치에 커밋 기록이 있다 — 로컬([`reflog_has_commits`])과 원격 스크립트의
/// awk 가 **같은 표**를 쓴다(어긋나지 않게).
pub(crate) const HISTORY_PREFIXES: [&str; 5] = ["commit", "merge ", "cherry-pick", "rebase", "pull"];

/// XY 한 쌍의 갈래 — 브랜치 그래프의 커밋 안 한 변경(✎ 줄)이 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Change {
    Modified,
    Added,
    Deleted,
}

// ---------------------------------------------------------------------------
// 순수 규칙
// ---------------------------------------------------------------------------

/// 커밋 해시로 쓸 수 있는 글자인가 (**순수 함수**) — 16진 4~64자. 스크립트에 실리는 글자라 이것만 받는다.
pub(crate) fn valid_commit(s: &str) -> bool {
    (4..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// porcelain v1 의 XY → 갈래 (**순수 함수**). 새 파일 `A` = 추적 안 하는 것(`??`) + 인덱스에 새로 더한 것(`A`) ·
/// 삭제 `D` = 어느 쪽이든 `D` · 나머지는 수정 `M`(이름 바뀜 `R` · 복사 `C` · 형식 바뀜 `T` · 충돌 `U`·`AA`·`DD` 포함).
/// 무시된 것 · 모르는 모양은 `None`.
pub(crate) fn classify(xy: &str) -> Option<Change> {
    let b = xy.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let (x, y) = (b[0], b[1]);
    match (x, y) {
        (b'?', b'?') => Some(Change::Added),
        (b'!', b'!') => None,
        // 충돌(unmerged) — 수정으로 묶는다
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => Some(Change::Modified),
        (b'A', _) | (_, b'A') => Some(Change::Added),
        (b'D', _) | (_, b'D') => Some(Change::Deleted),
        (b' ', b' ') => None,
        _ => Some(Change::Modified),
    }
}

/// `rev-list --count` 의 답 (**순수 함수**) — 숫자 한 줄이 아니면 `None`.
pub(crate) fn parse_count(s: &str) -> Option<u32> {
    s.trim().parse().ok()
}

/// `git diff --numstat` 의 줄들 → (더한 줄, 뺀 줄) 합계 (**순수 함수**). 바이너리(`-` `-`)와 모양이 어긋난 줄은
/// 세지 않는다. 경로 칸은 보지 않는다(이름 바뀜 `a => b` 도 한 줄이다).
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

/// 텍스트 파일의 줄 수 (**순수 함수**) — git numstat 과 같게: 줄바꿈 수, 끝에 줄바꿈 없이 남은 글자가 있으면 하나 더.
/// 앞 [`BINARY_SNIFF`] 바이트에 NUL 이 있으면(바이너리) `None`. 브랜치 그래프가 쓴다.
pub(crate) fn text_lines(bytes: &[u8]) -> Option<u32> {
    if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
        return None;
    }
    let nl = bytes.iter().filter(|&&b| b == b'\n').count();
    let tail = usize::from(bytes.last().is_some_and(|&b| b != b'\n'));
    Some(u32::try_from(nl + tail).unwrap_or(u32::MAX))
}

/// `git reflog show --format=%gs refs/heads/<브랜치>` 의 줄들 → 커밋 기록이 있나 (**순수 함수**, 모듈 머리말 "병합됨").
/// 한 줄이라도 [`HISTORY_PREFIXES`] 로 시작하면 `true`. `branch: Created from …` 뿐(갓 만든 브랜치) · 빈 글자는 `false`.
pub(crate) fn reflog_has_commits(text: &str) -> bool {
    text.lines().any(|raw| {
        let line = raw.trim_end_matches('\r');
        HISTORY_PREFIXES.iter().any(|p| line.starts_with(p))
    })
}

/// 병합됨인가 (**순수 함수**, 모듈 머리말 "병합됨") — 브랜치가 있고(분리 HEAD 아님) · 주 폴더 브랜치가 아니고 ·
/// 앞선 커밋이 정확히 0 이고 · 커밋 기록이 있다. 주 폴더 브랜치를 모르면(`main` 이 `None`) `ahead` 도 `None` 이라 `false`.
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

/// 병합 판정 하나로 (**순수 함수**) — 조상 병합이 먼저, 아니면 내용 판정의 종류.
pub(crate) fn merged_kind_of(ancestry: bool, content: Option<MergeKind>) -> Option<MergeKind> {
    if ancestry {
        Some(MergeKind::Ancestry)
    } else {
        content
    }
}

/// 내용 판정을 볼 만한가 (**순수 함수**) — 브랜치가 있고 · main 이 아니고 · 앞선 커밋이 있다(조상 병합이 아닐 때만 부른다).
pub(crate) fn wants_content(branch: Option<&str>, main: Option<&str>, ahead: Option<u32>) -> bool {
    let Some(b) = branch.map(str::trim).filter(|b| !b.is_empty()) else {
        return false;
    };
    main.is_some_and(|m| m.trim() != b) && ahead.is_some_and(|a| a > 0)
}

/// 브랜치 이름 → `refs/heads/<이름>` — `-` 로 시작하면(옵션으로 읽힌다) · 비었으면 짓지 않는다.
fn branch_ref(name: &str) -> Option<String> {
    let m = name.trim();
    (!m.is_empty() && !m.starts_with('-')).then(|| format!("refs/heads/{m}"))
}

/// 주 폴더 브랜치 기준의 범위 — `refs/heads/<main>..HEAD`.
fn main_range(main: &str) -> Option<String> {
    branch_ref(main).map(|r| format!("{r}..HEAD"))
}

/// 물을 경로들 — 빈 것 · 제어 문자 · 겹친 것을 걸러 [`MAX_PATHS`] 개까지.
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

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

/// 그 브랜치 reflog 에 커밋 기록이 있나 — 못 읽으면 `false` (모듈 머리말 "병합됨").
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

/// 로컬 브랜치 하나가 **병합됨**인가 — 독 칩([`changes_blocking`])과 같은 판정(조상 [`is_merged`] · 아니면 내용
/// `crate::merge_detect`)을 워크트리 폴더 없이 저장소에서 다시 내린다. 워크트리 제거가 앱이 만들지 않은 브랜치를 지워도
/// 되는지 다시 볼 때 쓴다(`crate::worktree::branch_decision` 의 `merged`). 모르면 `false`.
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

/// 로컬 — 블로킹 몸통. 저장소의 워크트리 목록에 **있는** 경로만 센다(다른 폴더를 가리키는 경로는 버린다). 한 워크트리가
/// 실패하면(폴더가 사라졌다) 그 줄만 빠진다.
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
        // 폴더가 사라졌다 · git 작업 폴더가 아니다 — 그 줄은 빠진다.
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
        // reflog 는 병합됨 후보(앞선 커밋 0 · main 아님)일 때만 읽는다.
        let ancestry = is_merged(branch, main.as_deref(), ahead, true)
            && branch.is_some_and(|b| branch_has_history(&dir, b));
        // 내용 판정은 앞선 커밋이 있을 때만(그 안에서도 main 이 merge-base 에서 움직였을 때만 — `merge_detect` 의 문).
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

/// **로컬 워크트리들의 변경 상태** — 저장소 `repo` 의 워크트리 경로들(`paths`, 목록에서 받은 글자)마다 한 줄.
/// 읽기만 한다. 목록에 없는 경로 · 읽지 못한 워크트리는 답에서 빠진다.
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

// ---------------------------------------------------------------------------
// 원격 — exec 한 번에 여러 워크트리
// ---------------------------------------------------------------------------

/// 원격 변경 상태 스크립트 (**순수 함수**) — `sh -c '<…>'` 한 낱말(로그인 셸 무관).
///
/// ```sh
/// command -v git >/dev/null 2>&1 || { echo aynx-fail=nogit; exit 0; }
/// main=$(git -C R worktree list --porcelain 2>/dev/null | sed -n '/^$/q;s/^branch refs\/heads\///p')
/// ns() { awk 로 numstat 의 더한/뺀 줄 합계 "A D"; }
/// hist() { awk 로 reflog 줄 중 HISTORY_PREFIXES 로 시작하는 것이 있으면 1, 없으면 0; }
/// w() {
///   git -C "$2" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
///   echo "aynx-wt=$1"
///   b=$(git -C "$2" symbolic-ref --short -q HEAD)
///   printf 'branch=%s\nmain=%s\n' "$b" "$main"
///   [ -n "$main" ] || return 0
///   printf 'ahead=%s\n' "$(git -C "$2" rev-list --count "refs/heads/$main..HEAD")"
///   mb=$(git -C "$2" merge-base HEAD "refs/heads/$main")
///   if [ -n "$mb" ]; then printf 'lines=%s\n' "$(git -C "$2" --no-optional-locks diff --numstat "$mb" HEAD -- | ns)"; fi
///   if [ -n "$b" ]; then printf 'hist=%s\n' "$(git -C "$2" --no-optional-locks reflog show --format=%gs "refs/heads/$b" -- | hist)"; fi
///   if [ -n "$b" ] && [ "$b" != "$main" ] && [ "$a" -gt 0 ]; then cm "$2" "refs/heads/$main" HEAD; fi
/// }
/// w 0 P0
/// w 1 P1
/// ```
///
/// - 워크트리마다 `aynx-wt=<번호>` 로 덩어리를 연다(경로를 되돌려 적지 않는다 — 인용할 일이 없다). 폴더가 없거나 git 작업
///   폴더가 아니면 덩어리가 없다(그 줄은 답에서 빠진다).
/// - 줄 수 · reflog 판정은 **합계 · 0/1 만** — numstat 의 파일 이름 · reflog 의 커밋 제목은 서버 안의 awk 에서 끝난다.
/// - 병합됨 판정(브랜치 ≠ main · `ahead == 0` · `hist=1`)은 Rust 가 로컬과 같은 [`is_merged`] 로 가른다. 앞선 커밋이
///   있으면 셸 함수 `cm`(`crate::merge_detect::remote_cm_function`)이 내용 판정의 재료 줄(`aynx-cm-…`)을 더 찍고,
///   판정은 Rust 의 `merge_detect::judge` 가 한다.
/// - 경로는 `crate::ssh::sh_path`(`~/x` → `"$HOME"/'x'`), 원격 절대 자리(`/`·`~`)만.
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

/// 원격 스크립트의 덩어리 하나 — 해석 전의 재료.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RemoteBlock {
    /// [`remote_changes_command`] 에 넘긴 경로의 번호
    pub index: usize,
    /// 지금 브랜치 — 분리된 HEAD 면 `None`
    pub branch: Option<String>,
    /// 주 폴더 브랜치 이름 — 모르면 `None`
    pub main: Option<String>,
    /// 주 폴더 브랜치보다 앞선 커밋 수
    pub ahead: Option<u32>,
    /// 커밋한 줄 수 (더한, 뺀) — merge-base 부터 `HEAD` 까지
    pub lines: Option<(u32, u32)>,
    /// 그 브랜치 reflog 에 커밋 기록이 있나(`hist=1`)
    pub history: bool,
    /// 내용 판정의 재료(`aynx-cm-…` 줄) — 앞선 커밋이 있고 main 이 움직였을 때만
    pub content: Option<ContentFacts>,
}

/// `A D` 한 쌍 (**순수 함수**) — 두 숫자가 아니면 `None`.
fn parse_pair(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let a = it.next()?.parse().ok()?;
    let d = it.next()?.parse().ok()?;
    it.next().is_none().then_some((a, d))
}

/// 원격 스크립트의 출력 → 덩어리들 (**순수 함수**). `aynx-wt=` 앞의 줄(로그인 스크립트의 잡음)은 버린다.
/// 서버에 git 이 없으면 `Err`(한 줄).
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

/// 덩어리들 → 답 (**순수 함수**). `paths[i]` 는 스크립트의 `w i` 에 실은 경로다.
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

/// **원격 워크트리들의 변경 상태** — 살아 있는 SSH 세션 `id` 의 전송로로 exec **한 번**. 읽기만 한다.
/// 명령 글자는 여기서 짓는다(프런트는 저장소 · 경로만).
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
