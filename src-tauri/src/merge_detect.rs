//! 내용 기준 병합 판정 — squash · rebase 로 병합한 브랜치도 "병합됨" (docs/log/2026-10-05-squash-merge-detection.md).
//!
//! 사용자의 흐름은 `git merge --squash`(GitHub 의 "Squash and merge" · "Rebase and merge" 도)다. 이 병합들은 **새 해시**의
//! 커밋을 main 에 남기므로, 조상 관계만 보는 옛 규칙(앞선 커밋 0 + reflog 에 일한 자국 — `crate::worktree_changes::is_merged`)
//! 으로는 브랜치가 영영 "↑N" 으로 남았다. 여기는 그 둘을 **내용**으로 알아본다.
//!
//! ## 규칙 (로컬 · 원격이 같은 재료 [`ContentFacts`] → 같은 순수 판정 [`judge`])
//!
//! 병합됨 = (a) **조상** — 앞선 커밋 0 + reflog 에 일한 자국(옛 규칙, 이 모듈 밖) · 또는
//! - (c) **squash** — 브랜치의 변경 전체(`git diff <merge-base> <브랜치>`)의 `git patch-id --stable` 이 merge-base 이후 main
//!   커밋(병합 커밋 빼고, 최근 [`MAIN_WINDOW`] 개) **하나**의 patch-id 와 같다. 맞은 main 커밋(= squash 커밋)을 함께 준다.
//! - (b) **rebase** — `git cherry <main> <브랜치>` 의 줄이 모두 `-`(브랜치의 커밋마다 patch 가 같은 커밋이 main 에 있다).
//!   main 쪽 짝 = 브랜치 끝 커밋의 patch-id 와 같은 main 커밋(창 안에 없으면 `None` — 병합됨은 그대로).
//!
//! (c) 를 (b) 보다 먼저 본다 — 커밋 하나짜리 브랜치는 둘 다 맞고, 사용자의 흐름이 squash 라 그 이름을 붙인다.
//! **빈 변경은 절대 병합됨이 아니다** — 갓 만든 브랜치는 diff 가 비어 patch-id 가 없고 cherry 에 `-` 도 없다.
//!
//! ## 값싸게 (부르는 쪽의 문)
//!
//! (b)/(c) 는 (a) 가 아니고 · 브랜치가 main 보다 앞선 커밋이 있고 · **main 이 merge-base 에서 움직였을 때만** 본다 —
//! main 이 그대로면 그 사이에 병합됐을 리 없다(진행 중인 브랜치의 보통 경우는 git 세 번으로 끝난다). 이 문은
//! [`local_facts`] 와 원격 셸 함수 [`remote_cm_function`] 가 같은 모양으로 지킨다.
//!
//! ## 읽기 전용 · 셸 없음
//!
//! 판정은 git 에 아무것도 쓰지 않는다(`commit-tree` 같은 임시 객체도 없다). 로컬은 git 을 셸 없이 띄우고 그 stdout 을
//! Rust 가 `git patch-id --stable` 의 stdin 에 잇는다([`patch_ids_of`]). 원격은 Rust 가 짓는 셸 함수 `cm` 하나를 각 좁힌
//! 스크립트(독 배지 · 커밋 그래프 · 확인된 삭제) 안에 싣는다 — 새 범용 exec 길은 없다. 원격은 맞춰 볼 patch-id 두 개와
//! 같은 main 줄만 awk 로 걸러 보낸다(답이 작다 — 판정은 여전히 Rust).
//!
//! ## 확인된 삭제 — `branch -d` 가 거절한 squash · rebase 병합 브랜치 ([`verified_target`])
//!
//! `git branch -d` 는 조상 관계만 보므로 squash · rebase 병합 브랜치를 거절한다. 그때(**그때만**) 실행 순간에 이 판정을 다시
//! 내리고, (b)/(c) 로 병합됨이며 어느 워크트리에도 체크아웃돼 있지 않으면 **방금 판정한 그 커밋**을 조건으로
//! `git update-ref -d refs/heads/<이름> <해시>` 로 지운다(그사이 브랜치가 움직였으면 git 이 거절한다 — compare-and-swap).
//! 이어서 `branch -d` 가 하던 대로 `branch.<이름>` 설정 묶음을 걷는다(없으면 조용히). `branch -D` · `--force` 는 쓰지 않는다.
//! 조상 병합은 여전히 `-d` 만, 병합 안 된 브랜치는 예전처럼 남는다.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::i18n::tr;
use crate::worktree::{parse_porcelain, run_git, GIT_TIMEOUT};
use crate::worktree_changes::valid_commit;

/// (c) 에서 맞춰 보는 main 커밋 수 — merge-base 이후 최근 것부터(병합 커밋 빼고).
pub(crate) const MAIN_WINDOW: usize = 200;
/// 로컬 git 한 번의 시한.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(15);
/// `CREATE_NO_WINDOW` — 콘솔 창이 번쩍이지 않게(`crate::worktree` 와 같은 값).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// patch-id 를 낼 diff 의 옵션 — 로컬 · 원격, diff · log 가 **같은 글자**로 만든다(설정 차이로 어긋나지 않게).
const DIFF_OPTS: [&str; 4] = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
];
/// patch-id 에 넣을 log 의 머리 — `commit <해시>` 줄만(patch-id 가 그 해시를 짝으로 적는다).
const LOG_FORMAT: &str = "--format=commit %H";

/// 원격 답의 줄 표식 — [`remote_cm_function`] 이 찍고 [`absorb_line`] 이 읽는다.
const TAG_SQ: &str = "aynx-cm-sq=";
const TAG_TIP: &str = "aynx-cm-tip=";
const TAG_MAIN: &str = "aynx-cm-main=";
const TAG_CHERRY: &str = "aynx-cm-cherry=";

/// 무엇으로 병합됐나 — 프런트가 툴팁 · 접힘 상세에 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeKind {
    /// 조상 관계(앞선 커밋 0 — 보통 병합 · fast-forward)
    Ancestry,
    /// rebase 병합 — 커밋마다 같은 patch 가 main 에 있다
    Rebase,
    /// squash 병합 — 변경 전체가 main 커밋 하나와 같다
    Squash,
}

/// 내용 판정의 재료 — 로컬([`local_facts`])과 원격([`absorb_line`])이 같은 모양으로 모은다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ContentFacts {
    /// `diff <merge-base> <브랜치>` 의 patch-id — 빈 변경이면 `None`
    pub squash_id: Option<String>,
    /// 브랜치 끝 커밋의 patch-id — 병합 커밋이면 `None`
    pub tip_id: Option<String>,
    /// merge-base 이후 main 커밋들의 (patch-id, 커밋) — 최근 것부터(원격은 위 둘과 같은 줄만)
    pub main_ids: Vec<(String, String)>,
    /// `git cherry` 의 (`+` 줄 수, `-` 줄 수) — 못 읽었으면 `None`
    pub cherry: Option<(u32, u32)>,
}

/// 내용 판정의 답.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContentMerge {
    /// [`MergeKind::Squash`] · [`MergeKind::Rebase`]
    pub kind: MergeKind,
    /// 맞은 main 커밋(squash 커밋 · rebase 된 끝 커밋) — 창 안에서 못 찾으면 `None`
    pub commit: Option<String>,
}

/// 브랜치 하나의 판정 — 확인된 삭제가 쓰는 꼴(판정한 브랜치 커밋까지).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Verdict {
    pub merge: ContentMerge,
    /// 판정에 쓴 브랜치 끝 커밋(전체 해시) — 삭제의 compare-and-swap 값
    pub head: String,
}

// ---------------------------------------------------------------------------
// 순수 규칙
// ---------------------------------------------------------------------------

/// `git patch-id` 의 줄들 `<patch-id> <커밋>` → 쌍들 (**순수 함수**). 모양이 어긋난 줄은 버린다.
pub(crate) fn parse_patch_ids(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let mut f = l.trim_end_matches('\r').split_whitespace();
            let (id, c) = (f.next()?, f.next()?);
            (valid_commit(id) && valid_commit(c)).then(|| (id.to_string(), c.to_string()))
        })
        .collect()
}

/// patch-id 출력의 첫 id (**순수 함수**) — 빈 변경(출력 없음)이면 `None`.
pub(crate) fn first_patch_id(text: &str) -> Option<String> {
    parse_patch_ids(text).into_iter().next().map(|(id, _)| id)
}

/// `git cherry <main> <브랜치>` 의 출력 → (`+` 줄 수, `-` 줄 수) (**순수 함수**). 다른 줄은 세지 않는다.
pub(crate) fn parse_cherry(text: &str) -> (u32, u32) {
    let (mut plus, mut minus) = (0u32, 0u32);
    for l in text.lines() {
        let l = l.trim_end_matches('\r');
        if l.starts_with("+ ") {
            plus = plus.saturating_add(1);
        } else if l.starts_with("- ") {
            minus = minus.saturating_add(1);
        }
    }
    (plus, minus)
}

/// `<수> <수>` 한 쌍 (**순수 함수**).
fn parse_pair(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    it.next().is_none().then_some((a, b))
}

/// **내용 판정** (**순수 함수**, 모듈 머리말의 (c) → (b)). 빈 변경 · 재료 없음은 `None`.
pub(crate) fn judge(f: &ContentFacts) -> Option<ContentMerge> {
    let find = |id: &str| {
        f.main_ids
            .iter()
            .find(|(p, _)| p == id)
            .map(|(_, c)| c.clone())
    };
    if let Some(c) = f.squash_id.as_deref().and_then(find) {
        return Some(ContentMerge {
            kind: MergeKind::Squash,
            commit: Some(c),
        });
    }
    match f.cherry {
        Some((0, minus)) if minus > 0 => Some(ContentMerge {
            kind: MergeKind::Rebase,
            commit: f.tip_id.as_deref().and_then(find),
        }),
        _ => None,
    }
}

/// 원격 답 한 줄을 재료에 더한다 (**순수 함수**) — `aynx-cm-…` 줄이면 `true`(첫 줄에서 재료를 연다).
pub(crate) fn absorb_line(slot: &mut Option<ContentFacts>, line: &str) -> bool {
    let line = line.trim_end_matches('\r');
    if !line.starts_with("aynx-cm-") {
        return false;
    }
    let f = slot.get_or_insert_with(ContentFacts::default);
    let hex = |v: &str| Some(v.trim().to_string()).filter(|h| valid_commit(h));
    if let Some(v) = line.strip_prefix(TAG_SQ) {
        f.squash_id = hex(v);
    } else if let Some(v) = line.strip_prefix(TAG_TIP) {
        f.tip_id = hex(v);
    } else if let Some(v) = line.strip_prefix(TAG_MAIN) {
        f.main_ids.extend(parse_patch_ids(v));
    } else if let Some(v) = line.strip_prefix(TAG_CHERRY) {
        f.cherry = parse_pair(v);
    }
    true
}

/// 확인된 삭제의 판정 (**순수 함수**, 모듈 머리말 "확인된 삭제") — 지울 커밋(compare-and-swap 값) 또는 `None`(남긴다).
/// 체크아웃돼 있으면 · 판정이 없으면 · 조상 병합이면(그건 `-d` 의 몫) `None`.
pub(crate) fn verified_target(verdict: Option<&Verdict>, checked_out: bool) -> Option<&str> {
    if checked_out {
        return None;
    }
    let v = verdict?;
    matches!(v.merge.kind, MergeKind::Squash | MergeKind::Rebase)
        .then_some(v.head.as_str())
        .filter(|h| valid_commit(h))
}

/// 브랜치 이름이 인자로 쓸 만한가 — 비지 않고 · `-` 로 시작하지 않고 · 제어 글자 없음.
fn plain_branch(name: &str) -> Option<&str> {
    let b = name.trim();
    (!b.is_empty() && !b.starts_with('-') && !b.chars().any(char::is_control)).then_some(b)
}

// ---------------------------------------------------------------------------
// 원격 글자 (**순수 함수** — 이 글자들만 서버로 나간다)
// ---------------------------------------------------------------------------

/// 원격 셸 함수 `cm <저장소> <main 참조> <브랜치 rev>` — 로컬 [`local_facts`] 와 같은 문 · 같은 재료를 `aynx-cm-…` 줄로.
/// 변수는 `_cm` 으로 시작한다(부르는 스크립트의 `mb` · `b` 를 덮지 않게). 스크립트 안에 그대로 싣는다(바깥에서 한 번
/// `sh_quote` 된다).
pub(crate) fn remote_cm_function() -> String {
    let diff = DIFF_OPTS.join(" ");
    format!(
        r#"cm() {{
  _cmb=$(git -C "$1" merge-base "$2" "$3" 2>/dev/null)
  _cmt=$(git -C "$1" rev-parse -q --verify "$2^{{commit}}" 2>/dev/null)
  [ -n "$_cmb" ] && [ "$_cmb" != "$_cmt" ] || return 0
  [ "$(git -C "$1" rev-list --count "$_cmb..$3" 2>/dev/null)" -gt 0 ] 2>/dev/null || return 0
  _cms=$(git -C "$1" --no-optional-locks diff {diff} "$_cmb" "$3" -- 2>/dev/null | git patch-id --stable 2>/dev/null | awk 'NR == 1 {{ print $1 }}')
  _cmp=$(git -C "$1" --no-optional-locks log -n 1 {diff} '{fmt}' -p "$3" -- 2>/dev/null | git patch-id --stable 2>/dev/null | awk 'NR == 1 {{ print $1 }}')
  printf '{sq}%s\n{tip}%s\n' "$_cms" "$_cmp"
  git -C "$1" --no-optional-locks log --no-merges -n {win} {diff} '{fmt}' -p "$_cmb..$2" -- 2>/dev/null | git patch-id --stable 2>/dev/null | awk -v a="$_cms" -v b="$_cmp" '($1 == a && a != "") || ($1 == b && b != "") {{ print "{main}" $1 " " $2 }}'
  printf '{cherry}%s\n' "$(git -C "$1" cherry "$2" "$3" 2>/dev/null | awk '/^\+ / {{ p++ }} /^- / {{ m++ }} END {{ printf "%d %d", p, m }}')"
}}
"#,
        fmt = LOG_FORMAT,
        win = MAIN_WINDOW,
        sq = TAG_SQ,
        tip = TAG_TIP,
        main = TAG_MAIN,
        cherry = TAG_CHERRY,
    )
}

/// 원격 확인된 삭제의 판정 스크립트 (**순수 함수**) — `sh -c '<…>'` 한 낱말. 출력: `aynx-busy=1`(어느 워크트리에든
/// 체크아웃됨) · `aynx-main=<주 브랜치>` · `aynx-head=<브랜치 커밋>` · `cm` 의 재료 줄. 이름이 쓸 수 없으면 `None`.
pub(crate) fn remote_judge_command(repo: &str, branch: &str) -> Option<String> {
    let r = repo.trim();
    if r.is_empty() || r.chars().any(char::is_control) {
        return None;
    }
    let b = plain_branch(branch)?;
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 0; }}
R={repo}
B={bref}
{cm}main=$(git -C "$R" worktree list --porcelain 2>/dev/null | sed -n '/^$/q;s/^branch refs\/heads\///p')
if git -C "$R" worktree list --porcelain 2>/dev/null | grep -qxF "branch $B"; then echo aynx-busy=1; fi
[ -n "$main" ] || exit 0
printf 'aynx-main=%s\n' "$main"
H=$(git -C "$R" rev-parse -q --verify "$B^{{commit}}" 2>/dev/null) || exit 0
printf 'aynx-head=%s\n' "$H"
cm "$R" "refs/heads/$main" "$H"
"#,
        repo = crate::ssh::sh_path(r),
        bref = crate::ssh::sh_quote(&format!("refs/heads/{b}")),
        cm = remote_cm_function(),
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

/// 원격 판정 답.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RemoteJudge {
    pub busy: bool,
    pub main: Option<String>,
    pub head: Option<String>,
    pub facts: Option<ContentFacts>,
}

/// 원격 판정 답 → 재료 (**순수 함수**). git 이 없으면 `Err`.
pub(crate) fn parse_remote_judge(stdout: &str) -> Result<RemoteJudge, String> {
    let mut out = RemoteJudge::default();
    for raw in stdout.lines() {
        let line = raw.trim_end_matches('\r');
        if line == "aynx-fail=nogit" {
            return Err(
                tr!(ko: "원격에 git 이 없습니다", en: "git is not installed on the remote"),
            );
        }
        if absorb_line(&mut out.facts, line) {
            continue;
        }
        if line == "aynx-busy=1" {
            out.busy = true;
        } else if let Some(v) = line.strip_prefix("aynx-main=") {
            out.main = Some(v.trim().to_string()).filter(|m| !m.is_empty());
        } else if let Some(v) = line.strip_prefix("aynx-head=") {
            out.head = Some(v.trim().to_string()).filter(|h| valid_commit(h));
        }
    }
    Ok(out)
}

/// 원격 판정 답 → 판정 (**순수 함수**) — 주 브랜치가 아니고 · 커밋을 알고 · 내용으로 병합됐을 때.
pub(crate) fn remote_verdict(j: &RemoteJudge, branch: &str) -> Option<Verdict> {
    let main = j.main.as_deref()?;
    if main == branch.trim() {
        return None;
    }
    Some(Verdict {
        merge: judge(j.facts.as_ref()?)?,
        head: j.head.clone()?,
    })
}

/// 원격 확인된 삭제 명령 (**순수 함수**) — `git -C <저장소> update-ref -d refs/heads/<이름> <해시>` 다음 `branch.<이름>` 설정
/// 묶음 걷기(실패해도 조용히 — 묶음이 없을 수 있다). 종료 코드는 update-ref 의 것이다.
pub(crate) fn remote_verified_delete_command(
    repo: &str,
    branch: &str,
    sha: &str,
) -> Option<String> {
    let r = repo.trim();
    if r.is_empty() || r.chars().any(char::is_control) || !valid_commit(sha) {
        return None;
    }
    let b = plain_branch(branch)?;
    let repo_q = crate::ssh::sh_path(r);
    Some(format!(
        "git -C {repo_q} update-ref -d {} {sha} && {{ git -C {repo_q} config --remove-section {} >/dev/null 2>&1; true; }}",
        crate::ssh::sh_quote(&format!("refs/heads/{b}")),
        crate::ssh::sh_quote(&format!("branch.{b}")),
    ))
}

// ---------------------------------------------------------------------------
// 로컬
// ---------------------------------------------------------------------------

/// git 한 번 — 성공했으면 stdout.
fn git_text(repo: &Path, args: &[&str]) -> Option<String> {
    run_git(repo, args, LOCAL_TIMEOUT)
        .ok()
        .filter(|o| o.ok)
        .map(|o| o.stdout)
}

fn git_cmd(repo: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// `git <args>` 의 stdout 을 `git patch-id --stable` 의 stdin 에 잇는다 — 셸 없이(모듈 머리말). 앞의 git 이 실패하거나
/// 시한을 넘기면 `None`. 답은 patch-id 의 출력 그대로.
pub(crate) fn patch_ids_of(repo: &Path, args: &[&str]) -> Option<String> {
    let mut src = git_cmd(repo)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let Some(pipe) = src.stdout.take() else {
        let _ = src.kill();
        let _ = src.wait();
        return None;
    };
    let mut sink = match git_cmd(repo)
        .args(["patch-id", "--stable"])
        .stdin(Stdio::from(pipe))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => {
            let _ = src.kill();
            let _ = src.wait();
            return None;
        }
    };
    let out = sink.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = out {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let deadline = Instant::now() + LOCAL_TIMEOUT;
    let mut src_status = None;
    let mut sink_status = None;
    while src_status.is_none() || sink_status.is_none() {
        if src_status.is_none() {
            src_status = src.try_wait().ok().flatten();
        }
        if sink_status.is_none() {
            sink_status = sink.try_wait().ok().flatten();
        }
        if src_status.is_some() && sink_status.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = src.kill();
            let _ = sink.kill();
            let _ = src.wait();
            let _ = sink.wait();
            let _ = reader.join();
            return None;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let text = reader.join().unwrap_or_default();
    (src_status.is_some_and(|s| s.success()) && sink_status.is_some_and(|s| s.success()))
        .then_some(text)
}

/// **로컬 재료** — `main_ref`(`refs/heads/<main>`) 대비 `head`(브랜치 참조 · `HEAD` · 해시). 모듈 머리말의 문(main 이
/// merge-base 에서 움직였고 · 앞선 커밋이 있다)을 못 지나면 `None` — 그때는 내용으로 병합됐을 리 없다.
pub(crate) fn local_facts(repo: &Path, main_ref: &str, head: &str) -> Option<ContentFacts> {
    if main_ref.starts_with('-') || head.starts_with('-') {
        return None;
    }
    let mb = git_text(repo, &["merge-base", main_ref, head])?
        .trim()
        .to_string();
    let mt = git_text(
        repo,
        &[
            "rev-parse",
            "-q",
            "--verify",
            &format!("{main_ref}^{{commit}}"),
        ],
    )?
    .trim()
    .to_string();
    if !valid_commit(&mb) || mb == mt {
        return None;
    }
    let ahead = git_text(repo, &["rev-list", "--count", &format!("{mb}..{head}")])?;
    if ahead.trim().parse::<u32>().unwrap_or(0) == 0 {
        return None;
    }
    let with = |head_args: &[&str], tail: &[&str]| -> Vec<String> {
        let mut v: Vec<String> = vec!["--no-optional-locks".into()];
        v.extend(head_args.iter().map(|s| s.to_string()));
        v.extend(DIFF_OPTS.iter().map(|s| s.to_string()));
        v.extend(tail.iter().map(|s| s.to_string()));
        v
    };
    let run = |args: Vec<String>| {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        patch_ids_of(repo, &refs)
    };
    let squash_id = run(with(&["diff"], &[&mb, head, "--"])).and_then(|t| first_patch_id(&t));
    let tip_id = run(with(&["log", "-n", "1"], &[LOG_FORMAT, "-p", head, "--"]))
        .and_then(|t| first_patch_id(&t));
    let win = MAIN_WINDOW.to_string();
    let main_ids = run(with(
        &["log", "--no-merges", "-n", &win],
        &[LOG_FORMAT, "-p", &format!("{mb}..{main_ref}"), "--"],
    ))
    .map(|t| parse_patch_ids(&t))
    .unwrap_or_default();
    let cherry = git_text(repo, &["cherry", main_ref, head]).map(|t| parse_cherry(&t));
    Some(ContentFacts {
        squash_id,
        tip_id,
        main_ids,
        cherry,
    })
}

/// 로컬 — `head` 가 내용으로 병합됐나(독 배지 · 커밋 그래프). 모르면 `None`.
pub(crate) fn content_local(repo: &Path, main_ref: &str, head: &str) -> Option<ContentMerge> {
    judge(&local_facts(repo, main_ref, head)?)
}

/// 로컬 — 브랜치 하나의 판정(커밋까지 고정해서). 주 브랜치이거나 이름이 쓸 수 없으면 `None`.
pub(crate) fn judge_branch_local(repo: &Path, main: &str, branch: &str) -> Option<Verdict> {
    let (m, b) = (plain_branch(main)?, plain_branch(branch)?);
    if m == b {
        return None;
    }
    let head = git_text(
        repo,
        &[
            "rev-parse",
            "-q",
            "--verify",
            &format!("refs/heads/{b}^{{commit}}"),
        ],
    )?
    .trim()
    .to_string();
    if !valid_commit(&head) {
        return None;
    }
    let merge = content_local(repo, &format!("refs/heads/{m}"), &head)?;
    Some(Verdict { merge, head })
}

/// **로컬 확인된 삭제** (모듈 머리말) — `branch -d` 가 거절한 뒤에 부른다. 지금 다시 읽은 워크트리 목록으로 주 브랜치 ·
/// 체크아웃 여부를 보고, 내용으로 병합됐으면 판정한 커밋을 조건으로 `update-ref -d`. 지웠으면 그 종류, 아니면 `None`.
pub(crate) fn delete_verified_local(
    repo: &Path,
    branch: &str,
) -> Result<Option<MergeKind>, String> {
    let Some(b) = plain_branch(branch) else {
        return Ok(None);
    };
    let list = run_git(repo, &["worktree", "list", "--porcelain"], GIT_TIMEOUT)?;
    if !list.ok {
        return Ok(None);
    }
    let worktrees = parse_porcelain(&list.stdout);
    let busy = worktrees.iter().any(|w| w.branch.as_deref() == Some(b));
    let Some(main) = crate::branch_graph::main_of(&worktrees) else {
        return Ok(None);
    };
    let verdict = judge_branch_local(repo, &main, b);
    let Some(sha) = verified_target(verdict.as_ref(), busy) else {
        return Ok(None);
    };
    let r = run_git(
        repo,
        &["update-ref", "-d", &format!("refs/heads/{b}"), sha],
        GIT_TIMEOUT,
    )?;
    if !r.ok {
        return Ok(None);
    }
    // `branch -d` 가 하던 정리 — 묶음이 없으면 git 이 실패하지만 상관없다.
    let _ = run_git(
        repo,
        &["config", "--remove-section", &format!("branch.{b}")],
        GIT_TIMEOUT,
    );
    Ok(verdict.map(|v| v.merge.kind))
}

/// **원격 확인된 삭제** — 로컬과 같은 규칙(판정 스크립트 exec 하나 + 삭제 exec 하나). 지웠으면 그 종류.
pub(crate) async fn delete_verified_remote(
    handle: &crate::ssh::ExecHandle,
    repo: &str,
    branch: &str,
) -> Result<Option<MergeKind>, String> {
    let Some(cmd) = remote_judge_command(repo, branch) else {
        return Ok(None);
    };
    let o = crate::worktree::remote_git(handle, cmd).await?;
    if o.exit_code != Some(0) {
        return Ok(None);
    }
    let j = parse_remote_judge(&o.stdout)?;
    let verdict = remote_verdict(&j, branch);
    let Some(sha) = verified_target(verdict.as_ref(), j.busy) else {
        return Ok(None);
    };
    let Some(del) = remote_verified_delete_command(repo, branch, sha) else {
        return Ok(None);
    };
    let d = crate::worktree::remote_git(handle, del).await?;
    if d.exit_code != Some(0) {
        return Ok(None);
    }
    Ok(verdict.map(|v| v.merge.kind))
}

#[cfg(test)]
mod tests;
