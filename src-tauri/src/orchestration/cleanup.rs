//! **정리 — 서버 임시 자리 폐기 · ref 회수 · Run 끝 [정리]**(통합 설계 6단계 — docs/log/2026-10-15-orchestration-integration-design.md
//! 1절 D10, 6-2 · 6-3, 4-1 보존 ref, 검토 R12 · R13).
//!
//! 셋:
//! - **서버 임시 자리 폐기**([`Orchestration::sweep_temps`]) — 검증 worktree(`orch-<run8>-verify`) · 검증 임시(`orch-<run8>-tmp`) · 검토 worktree
//!   (`orch-<task8>-<att8>-rv`) · 검토자 빈 cwd(`<데이터>/orchestration/<run>/review-<att8>`). 끝난 Run(done · stopped)과 orphaned(재시작 뒤)를
//!   서버 시계가 **서버 수명마다 한 번** 정리한다(재시작 = 재정리). [Run 완료]는 그 자리에서, orphaned [닫기]는 정리가 깨끗할 때만 닫는다.
//! - **ref 회수**([`Orchestration::reclaim_refs`]) — `candidate/<job>`(끝난 Job 의 것 — 그 기록의 OID 로) · `conflict/<task>`(그 Task 가 종결된
//!   뒤). 서버 시계가 "끝난 Job 수 · 종결 Task 수" 가 바뀐 Run 만 본다. 통합 성공의 candidate 는 올리기 트랜잭션이 이미 함께 지운다.
//! - **Run 끝 [정리]**(사람 — op `orchestration_cleanup_preview` · `orchestration_cleanup` · `orchestration_discard_temp`) — 작업자 worktree
//!   (통합된 것은 기본 체크, 반려 · 취소 · 충돌 미해결 · 열린 채 끝난 Task 는 기본 해제 · 미커밋이면 거절 · 브랜치는 기본 남김) · 보존 ref(`done/` · `accepted/` ·
//!   `diverged/` — 기본 남김) · 통합 ref `int`(내보낸 브랜치가 그것을 품거나 시작 커밋 그대로일 때만 — 잃을 커밋이 없다) · 남긴 서버 임시 자리 [그래도 지우기].
//!
//! 서버 임시 자리 폐기 규칙(6-2 — 작업자 worktree 와 **다른 정책**):
//! ① 소유 — 곁 파일(`worktrees.json`) 줄의 `role`(verify · temp · review) + `run` 이 이 Run 이거나, Run 장부가 아는 자리(검토 Attempt 의
//!   `reviewOf.place/cwd`)만. 서버가 지은 이름(검증 · 검증 임시)은 **곁 파일 소유 줄이 있을 때만**(리뷰 F4 — 예상 이름만으로는 아니다).
//! ② 원래 경로가 뿌리 아래에서 링크(정션 · symlink)를 지나지 않는다 — 자리 자신이 링크면 **링크만** 걷고 대상은 지우지 않는다(리뷰 F4).
//!   실제 경로(링크 풀어)가 Run 자리(검토 cwd 는 서버 데이터의 그 Run 폴더) 안. ③ 그 자리를 쓰는
//!   프로세스 0 — 검증 트리 0(`stop-unconfirmed` 가 있었으면 쓰는 중으로 본다) · 검토자 Attempt 종료(orphaned 는 지금 남은 프로세스로).
//! ④ **쉬는 상태와 비교** — 검증: 보존 폴더 밖 무엇이든(무시 파일 포함) 남았으면 · 검토: 분리 HEAD 가 보고 커밋이 아니거나 무엇이든 남았으면 ·
//!   빈 cwd: 무엇이든 있으면 → **지우지 않고 남긴다**(`Run.tempPending` · 알림 `cleanup-pending` · 끝난 Run 은 보류 `cleanup-pending` 표시).
//! ⑤ 지울 때는 **안의 정션 · 심볼릭 링크를 링크만 먼저 걷고**(`worktree::unlink_links` — 추적 링크까지 전부: `--force` 라 git 이 그것을 변경으로
//!   보지 않는다) `git worktree remove --force`. `git worktree remove` 는 정션을 따라가 대상 내용을 지운다(10-15 노트 저장소 사고) — 이 순서를
//!   바꾸지 않는다. 실패하면 걷은 링크를 되돌리고 남긴다.
//!
//! 불변식: 사람의 worktree · 다른 Run 의 자리 · Run 자리 밖은 건드리지 않는다. 경로는 감사 · 알림에 싣지 않는다(수만). 보존 ref(`done` ·
//! `accepted` · `diverged`)와 통합 ref 는 **사람의 [정리] 에서만** 지운다(서버 시계로 지우지 않는다 — R13).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::git::{child_env, hex40, Git};
use super::integrate::{refs, run_base, set_hold, TxOutcome};
use super::merge::RefOp;
use super::model::*;
use super::store::{not_found_run, reason, OrchError, Orchestration, Slot};
use crate::audit::OrchestrationAudit;
use crate::server::log;
use crate::worktree as wt;

/// 곁 파일 `role` — 검증 worktree.
pub(crate) const ROLE_VERIFY: &str = "verify";
/// 곁 파일 `role` — 검토 worktree.
pub(crate) const ROLE_REVIEW: &str = "review";
const ROLE_REVIEW_CWD: &str = "review-cwd";
/// 곁 파일 `role` — 검증 임시 폴더(TEMP · TMP — 검증 `prepare` 가 만들 때 적는다).
pub(crate) const ROLE_TEMP: &str = "temp";

/// [정리] · 서버 임시 자리 폐기를 할 수 있는 Run 상태 — 끝난 Run(done · stopped) · orphaned.
pub(super) fn cleanable_state(s: RunState) -> bool {
    matches!(s, RunState::Done | RunState::Stopped | RunState::Orphaned)
}

/// 이 Run 의 작업자 worktree 경로(잠금 안 — 검토 자리 제외 · 같은 글자는 한 번). 보관 판정 · 라이브러리 줄의 재료.
pub(super) fn worker_worktree_paths(run: &Run) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in run.attempts.iter().filter(|a| a.role != AttemptRole::Reviewer).filter_map(|a| a.worktree.as_ref()) {
        if !out.contains(w) {
            out.push(w.clone());
        }
    }
    out
}

/// 그중 지금 디스크에 남은 수(잠금 밖 — 파일 시스템을 본다 · 같은 실제 경로는 한 번).
pub(super) fn worktrees_left(paths: &[String]) -> usize {
    paths.iter().filter(|p| Path::new(p).is_dir()).map(|p| super::worktree::wt_key(p)).collect::<HashSet<_>>().len()
}

/// 서버 임시 자리 폐기의 결과(수만).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Swept {
    pub removed: usize,
    /// 예상 밖 변경 · 지우기 실패로 남긴 것.
    pub kept: usize,
    /// 아직 쓰는 프로세스가 있을 수 있어 손대지 않은 것.
    pub busy: usize,
}

impl Swept {
    pub(crate) fn to_json(self) -> Value {
        json!({ "removed": self.removed, "kept": self.kept, "busy": self.busy })
    }
}

/// 서버 임시 자리 하나(재료).
#[derive(Debug, Clone)]
struct Place {
    path: PathBuf,
    role: &'static str,
    /// 검토 자리의 쉬는 상태 — 분리 HEAD 가 이 커밋.
    expect_head: Option<String>,
    /// 쓰는 프로세스가 있을 수 있다.
    busy: bool,
    /// 이름만으로 고른 자리(검증 · 검증 임시) — 곁 파일에 서버가 만든 소유 줄(`run` · `role`)이 있어야 대상이다(리뷰 F4).
    needs_record: bool,
}

/// 잠금 안에서 모은 재료.
struct Snap {
    repo: PathBuf,
    wt_dir: PathBuf,
    /// 검토자 빈 cwd 의 뿌리(`<데이터>/orchestration/<run>`) — 영속 폴더가 없으면(시험) `None`.
    cwd_root: Option<PathBuf>,
    keep_dirs: Vec<String>,
    places: Vec<Place>,
    /// 곁 파일에서 더 찾을 때의 기본 "쓰는 중"(검토자 중 자리를 모르는 산 Attempt 가 있으면 참).
    unknown_review_busy: bool,
    verify_busy: bool,
}

/// 하나의 판정.
enum Verdict {
    Gone,
    Removed,
    Kept(&'static str),
    Busy,
}

fn same(a: &Path, b: &Path) -> bool {
    super::worktree::wt_key(&a.to_string_lossy()) == super::worktree::wt_key(&b.to_string_lossy())
}

/// Attempt 가 자리(worktree · 검토 자리 · cwd)를 아직 쓰나 — orphaned 는 영속 상태가 아니라 지금 남은 프로세스로(리뷰 F12).
/// 술어 `owns_worktree`(헤드리스 설계 4-5 표 — `cleanup.rs` 의 자원 판정: 3차 `idle` 도 자기 worktree 를 쥔다). orphaned 의 잔존 판정은
/// 판마다 갈린다(`attempts::leftover_process_alive`).
fn attempt_alive(state: RunState, a: &Attempt) -> bool {
    if state == RunState::Orphaned {
        super::attempts::leftover_process_alive(a)
    } else {
        a.owns_worktree()
    }
}

/// 잠금 안 — 이 Run 의 서버 임시 자리 재료.
fn collect_places(slot: &Slot, data_dir: Option<&Path>) -> Snap {
    let r = &slot.run;
    let wt_dir = PathBuf::from(&r.worktree_dir);
    let orphaned = r.state == RunState::Orphaned;
    // 검증 트리 — orphaned 는 옛 서버의 잡이 닫히며 끝났다(잡 선귀속 · KILL_ON_JOB_CLOSE).
    let verify_busy = !orphaned && (slot.verify_trees > 0 || slot.verify_unconfirmed);
    let (vname, tname) = super::verify::place_names(&r.id);
    let mut places = vec![
        Place { path: wt_dir.join(vname), role: ROLE_VERIFY, expect_head: None, busy: verify_busy, needs_record: true },
        Place { path: wt_dir.join(tname), role: ROLE_TEMP, expect_head: None, busy: verify_busy, needs_record: true },
    ];
    let mut unknown_review_busy = false;
    for a in r.attempts.iter().filter(|a| a.role == AttemptRole::Reviewer) {
        let alive = attempt_alive(r.state, a);
        let Some(of) = &a.review_of else { continue };
        if of.place.is_none() && alive {
            unknown_review_busy = true;
        }
        if let Some(p) = &of.place {
            places.push(Place {
                path: PathBuf::from(p),
                role: ROLE_REVIEW,
                expect_head: Some(of.commit_oid.clone()),
                busy: alive,
                needs_record: false,
            });
        }
        if let Some(c) = &of.cwd {
            places.push(Place { path: PathBuf::from(c), role: ROLE_REVIEW_CWD, expect_head: None, busy: alive, needs_record: false });
        }
    }
    // 남긴 자리(지난 정리) — 위에서 다시 만나지 않은 것도 다시 본다.
    for p in &r.temp_pending {
        let role = match p.role.as_str() {
            ROLE_VERIFY => ROLE_VERIFY,
            ROLE_REVIEW => ROLE_REVIEW,
            ROLE_REVIEW_CWD => ROLE_REVIEW_CWD,
            _ => ROLE_TEMP,
        };
        let path = PathBuf::from(&p.path);
        if !places.iter().any(|x| same(&x.path, &path)) {
            let by_name = role == ROLE_VERIFY || role == ROLE_TEMP;
            let busy = if by_name { verify_busy } else { unknown_review_busy };
            places.push(Place { path, role, expect_head: None, busy, needs_record: by_name });
        }
    }
    Snap {
        repo: PathBuf::from(&r.repo),
        wt_dir,
        cwd_root: data_dir.map(|d| d.join(&r.id)),
        keep_dirs: r.verify.as_ref().map(|v| v.keep_dirs.clone()).unwrap_or_default(),
        places,
        unknown_review_busy,
        verify_busy,
    }
}

/// 잠금 밖 — 곁 파일 · 서버 데이터 폴더에서 더 찾는다(장부에 없는 자리 — 자리를 적기 전에 멈춘 검토 등). 이름만으로 고른 자리(검증 ·
/// 검증 임시)는 곁 파일에 이 Run 의 같은 역할 줄이 있을 때만 남긴다(리뷰 F4 — 예상 이름이라는 것만으로 남의 폴더를 지우지 않는다).
fn discover(snap: &mut Snap, run_id: &str, sidecar: Option<&Path>) {
    let mut owned: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(side) = sidecar {
        let file = wt::load_sidecar(side);
        for (key, role) in wt::server_places_of(&file, run_id) {
            let role = match role.as_str() {
                ROLE_VERIFY => ROLE_VERIFY,
                ROLE_REVIEW => ROLE_REVIEW,
                ROLE_TEMP => ROLE_TEMP,
                _ => continue,
            };
            let path = PathBuf::from(&key);
            owned.push((path.clone(), role));
            if snap.places.iter().any(|x| same(&x.path, &path)) {
                continue;
            }
            let busy = if role == ROLE_REVIEW { snap.unknown_review_busy } else { snap.verify_busy };
            snap.places.push(Place { path, role, expect_head: None, busy, needs_record: false });
        }
    }
    snap.places.retain(|p| !p.needs_record || owned.iter().any(|(k, r)| *r == p.role && same(k, &p.path)));
    if let Some(root) = &snap.cwd_root {
        if let Ok(rd) = std::fs::read_dir(root) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if !name.starts_with("review-") {
                    continue;
                }
                let path = e.path();
                if snap.places.iter().any(|x| same(&x.path, &path)) {
                    continue;
                }
                snap.places.push(Place {
                    path,
                    role: ROLE_REVIEW_CWD,
                    expect_head: None,
                    busy: snap.unknown_review_busy,
                    needs_record: false,
                });
            }
        }
    }
}

fn git_at<'a>(dir: &'a Path, env: &'a [(std::ffi::OsString, std::ffi::OsString)], hooks: &Path) -> Option<Git<'a>> {
    Git::new(dir, hooks, env, reason::WORKTREE_FAILED).ok()
}

fn common_dir(g: &Git) -> Option<String> {
    let o = g.ok(&["rev-parse", "--path-format=absolute", "--git-common-dir"], &[], None).ok()?;
    Some(wt::comparable(o.trim()))
}

/// 이 폴더가 그 저장소의 worktree 인가(`.git` 파일 · 같은 공용 git 폴더).
fn is_worktree_of(dir: &Path, repo: &Path) -> bool {
    if !dir.join(".git").is_file() {
        return false;
    }
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let (Some(d), Some(r)) = (git_at(dir, &env, &hooks), git_at(repo, &env, &hooks)) else { return false };
    let (a, b) = (common_dir(&d), common_dir(&r));
    a.is_some() && a == b
}

/// 쉬는 상태와 같은가(④) — 다르면 그 까닭 낱말.
fn rest_mismatch(place: &Place, real: &Path, repo: &Path, keep: &[String]) -> Option<&'static str> {
    match place.role {
        ROLE_TEMP => None,
        ROLE_REVIEW_CWD => match std::fs::read_dir(real) {
            Ok(mut rd) => rd.next().is_some().then_some("changed"),
            Err(_) => Some("unreadable"),
        },
        _ => {
            if !is_worktree_of(real, repo) {
                return Some("not-a-worktree");
            }
            let env = child_env(std::env::vars_os());
            let hooks = super::worktree::empty_hooks_dir();
            let Some(g) = git_at(real, &env, &hooks) else { return Some("unreadable") };
            let Ok(st) = g.ok(&["status", "--porcelain=v2", "--ignored", "-z"], &[], None) else {
                return Some("unreadable");
            };
            let keep: &[String] = if place.role == ROLE_VERIFY { keep } else { &[] };
            if !super::verify::clean_status(&st, keep) {
                return Some("changed");
            }
            if let Some(want) = &place.expect_head {
                let head = g.ok(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], &[], None).ok();
                if head.as_deref().map(str::trim) != Some(want.as_str()) {
                    return Some("changed");
                }
            }
            None
        }
    }
}

/// 자리 하나를 지운다 — **링크 · 정션을 링크만 먼저 걷고**(⑤) worktree 는 `git worktree remove --force`, 그 밖은 링크를 따라가지 않는 재귀 삭제.
fn remove_place(place: &Place, real: &Path, repo: &Path) -> Result<(), String> {
    match place.role {
        ROLE_VERIFY | ROLE_REVIEW if is_worktree_of(real, repo) => {
            let unlinked = super::worktree::unlink_links(real, &[])?;
            let env = child_env(std::env::vars_os());
            let hooks = super::worktree::empty_hooks_dir();
            let r = match git_at(repo, &env, &hooks) {
                Some(g) => g.ok(&["worktree", "remove", "--force", &real.to_string_lossy()], &[], None).map(|_| ()).map_err(|e| e.message),
                None => Err("git was not found".to_string()),
            };
            if let Err(e) = r {
                let left = super::worktree::relink(&unlinked);
                if !left.is_empty() {
                    log::line(format!("orchestration — {} link(s) could not be restored after a failed removal", left.len()));
                }
                return Err(e);
            }
            // git 이 남긴 빈 껍데기(있으면) — 링크를 따라가지 않는다.
            if std::fs::symlink_metadata(real).is_ok() {
                super::verify::remove_no_follow(real)?;
            }
            Ok(())
        }
        _ => super::verify::remove_no_follow(real),
    }
}

/// 소유 자리 판정(②) — 실제 경로가 허용 뿌리 안. 검토 cwd 는 서버 데이터의 그 Run 폴더, 나머지는 Run 자리.
fn inside_root(place: &Place, snap: &Snap) -> bool {
    match place.role {
        ROLE_REVIEW_CWD => snap.cwd_root.as_deref().is_some_and(|root| super::worktree::inside(root, &place.path)),
        _ => super::worktree::inside(&snap.wt_dir, &place.path),
    }
}

/// `path` 의 조상을 `root`(글자 그대로 또는 실제 경로)에 닿을 때까지 거슬러 오르며 링크(정션 · symlink)인 구성요소가 있나 — `root`
/// 아래가 아니면(닿지 못하면) 참(보수적). `path` 자신은 보지 않는다(부르는 쪽이 따로 본다).
fn linked_between(root: &Path, path: &Path) -> bool {
    let mut roots = vec![wt::comparable(&root.to_string_lossy())];
    if let Some(r) = super::worktree::real_path(root) {
        roots.push(wt::comparable(&r.to_string_lossy()));
    }
    let mut cur = path.parent();
    while let Some(c) = cur {
        if roots.contains(&wt::comparable(&c.to_string_lossy())) {
            return false;
        }
        if std::fs::symlink_metadata(c).is_ok_and(|m| m.file_type().is_symlink()) {
            return true;
        }
        cur = c.parent();
    }
    true
}

/// 자리 하나 — ②~⑤. `force` 면 ④(쉬는 상태 비교)를 건너뛴다(사람의 [그래도 지우기]).
fn judge(place: &Place, snap: &Snap, force: bool) -> Verdict {
    let Ok(md) = std::fs::symlink_metadata(&place.path) else {
        return Verdict::Gone;
    };
    // 리뷰 F4 — 원래 경로의 재분석 지점(정션 · symlink). 뿌리와 자리 사이의 구성요소가 링크면 손대지 않는다(실제 대상이 뿌리 안이어도
    // 우리가 만든 모양이 아니다). 자리 자신이 링크면 **링크만** 걷는다 — 실제 대상은 지우지 않는다.
    let root = match place.role {
        ROLE_REVIEW_CWD => snap.cwd_root.as_deref(),
        _ => Some(snap.wt_dir.as_path()),
    };
    if root.is_none_or(|r| linked_between(r, &place.path)) {
        log::line("orchestration — a server temp folder path goes through a link — left alone");
        return Verdict::Kept("outside");
    }
    if place.busy {
        return Verdict::Busy;
    }
    if md.file_type().is_symlink() {
        return match std::fs::remove_dir(&place.path).or_else(|_| std::fs::remove_file(&place.path)) {
            Ok(()) => Verdict::Removed,
            Err(e) => {
                log::line(format!("orchestration — a linked server temp folder could not be unlinked: {e}"));
                Verdict::Kept("remove-failed")
            }
        };
    }
    if !inside_root(place, snap) {
        // 링크로 밖을 가리키거나 뿌리 밖 — 손대지 않는다(남긴 목록에 싣지도 않는다: 우리 자리가 아니다).
        log::line("orchestration — a server temp folder record points outside its root — left alone");
        return Verdict::Kept("outside");
    }
    let Some(real) = super::worktree::real_path(&place.path) else { return Verdict::Kept("unreadable") };
    if !force {
        if let Some(why) = rest_mismatch(place, &real, &snap.repo, &snap.keep_dirs) {
            return Verdict::Kept(why);
        }
    }
    match remove_place(place, &real, &snap.repo) {
        Ok(()) => Verdict::Removed,
        Err(e) => {
            log::line(format!("orchestration — a server temp folder could not be removed: {e}"));
            Verdict::Kept("remove-failed")
        }
    }
}

/// 끝난 Job 수 · 종결 Task 수 — ref 회수의 판.
fn ref_sig(run: &Run) -> (usize, usize) {
    (
        run.jobs.iter().filter(|j| !j.phase.live()).count(),
        run.tasks.iter().filter(|t| t.state.terminal()).count(),
    )
}

/// [정리] 의 작업자 worktree 한 줄(판정).
#[derive(Debug, Clone)]
struct WtRow {
    path: String,
    attempt_id: String,
    task_id: String,
    task_title: String,
    task_state: TaskState,
    branch: Option<String>,
    exists: bool,
    in_use: bool,
    integrated: bool,
    /// 이 worktree 의 Attempt 가 낸, 이 Run 이 통합한 보고 커밋(유효한 수락 · 통합 커밋 있음) — [정리]의 브랜치 판정(E2E 10-16 #9).
    integrated_report: Option<String>,
    dirty: Option<bool>,
    /// Run 이 끝났다(done · stopped · orphaned — [`cleanable_state`]) — 열린 Task 도 더는 진행되지 않는다(E2E 10-16 #6).
    run_ended: bool,
}

impl WtRow {
    /// 지울 수 있나 — 그렇지 않으면 그 까닭 낱말.
    fn blocker(&self) -> Option<&'static str> {
        if !self.exists {
            return Some("missing");
        }
        if self.in_use {
            return Some("in-use");
        }
        match self.dirty {
            Some(false) => {}
            Some(true) => return Some("dirty"),
            None => return Some("unreadable"),
        }
        // 끝난 Run 의 열린 Task(보고됨 · 진행 중이던 것)는 더 진행되지 않는다 — 막지 않고 사람이 고른다(기본 체크는 통합된 것만 — `to_json`).
        // 진행 중 Run(running · paused · stopping)은 열린 Task 를 막는다(지금은 [정리] 자체가 끝난 Run 만 받지만 판정은 스스로 지킨다).
        let decided =
            self.run_ended || self.integrated || self.task_state.terminal() || self.task_state == TaskState::Conflict;
        (!decided).then_some("task-open")
    }

    fn to_json(&self) -> Value {
        let blocker = self.blocker();
        json!({
            "path": self.path,
            "attemptId": self.attempt_id,
            "taskId": self.task_id,
            "taskTitle": self.task_title,
            "taskState": self.task_state,
            "branch": self.branch,
            "exists": self.exists,
            "inUse": self.in_use,
            "dirty": self.dirty,
            "integrated": self.integrated,
            "eligible": blocker.is_none(),
            "blocker": blocker,
            // 통합된 Task 의 것만 기본 체크(6-3) — 반려 · 취소 · 충돌 미해결 · 끝난 Run 의 열린 Task 는 기본 해제.
            "defaultChecked": blocker.is_none() && self.integrated,
        })
    }
}

/// 잠금 안 — 작업자 worktree 줄들(경로 하나에 한 줄 — 이어 쓴 Attempt 들은 묶는다). git 상태는 잠금 밖에서 채운다.
fn worktree_rows(slot: &Slot) -> Vec<WtRow> {
    let r = &slot.run;
    let mut out: Vec<WtRow> = Vec::new();
    for a in r.attempts.iter().filter(|a| a.role != AttemptRole::Reviewer) {
        let Some(path) = a.worktree.clone() else { continue };
        let key = super::worktree::wt_key(&path);
        let task = r.task(&a.task_id);
        let art = r.valid_artifact(&a.task_id).filter(|art| art.attempt_id == a.id);
        let integrated = art.is_some();
        let integrated_report = art.filter(|art| art.integration_commit.is_some()).map(|art| art.commit_oid.clone());
        let alive = attempt_alive(r.state, a);
        if let Some(row) = out.iter_mut().find(|x| super::worktree::wt_key(&x.path) == key) {
            row.in_use |= alive;
            row.integrated |= integrated;
            if integrated_report.is_some() {
                row.integrated_report = integrated_report;
            }
            continue;
        }
        out.push(WtRow {
            path,
            attempt_id: a.id.clone(),
            task_id: a.task_id.clone(),
            task_title: task.map(|t| t.title.clone()).unwrap_or_default(),
            task_state: task.map(|t| t.state).unwrap_or(TaskState::Cancelled),
            branch: a.branch.clone(),
            exists: false,
            in_use: alive,
            integrated,
            integrated_report,
            dirty: None,
            run_ended: cleanable_state(r.state),
        });
    }
    out
}

/// 잠금 밖 — 폴더가 있나 · 미커밋 변경(추적 안 된 파일 포함 · 무시 파일 제외)이 있나.
fn fill_git(rows: &mut [WtRow]) {
    for row in rows.iter_mut() {
        row.exists = Path::new(&row.path).is_dir();
        if !row.exists {
            continue;
        }
        row.dirty = wt::run_git(Path::new(&row.path), &["status", "--porcelain"], wt::GIT_TIMEOUT)
            .ok()
            .filter(|s| s.ok)
            .map(|s| !s.stdout.trim().is_empty());
    }
}

/// ref 한 줄의 종류(`refs/aynx/orch/<run16>/<종류>[/…]`).
fn ref_kind(prefix: &str, name: &str) -> String {
    name.strip_prefix(prefix).unwrap_or(name).split('/').next().unwrap_or_default().to_string()
}

impl Orchestration {
    /// 곁 파일 자리를 꽂는다(서버 시작 — `serve::run`, 시험은 임시 파일).
    pub(crate) fn set_sidecar(&self, path: Option<PathBuf>) {
        *self.sidecar.write().unwrap_or_else(|e| e.into_inner()) = path;
    }

    pub(crate) fn sidecar(&self) -> Option<PathBuf> {
        self.sidecar.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// 서버 시계(`tick`)의 정리 몫 — ref 회수가 필요한 Run(판이 바뀐 것) · 서버 임시 자리를 아직 정리하지 않은 끝난 Run · orphaned 를 골라
    /// 따로 스레드에서(자기 참조가 없으면 — 시험 — 이 자리에서) 정리한다.
    pub(super) fn cleanup_tick(&self) {
        let (refs_due, temps_due) = {
            let mut g = self.lock();
            let mut refs_due = Vec::new();
            let mut temps_due = Vec::new();
            for (id, slot) in g.runs.iter_mut() {
                if slot.run.integration.is_some() {
                    let sig = ref_sig(&slot.run);
                    if slot.ref_sig != Some(sig) {
                        slot.ref_sig = Some(sig);
                        refs_due.push(id.clone());
                    }
                }
                if !slot.temp_swept && !slot.sweeping && cleanable_state(slot.run.state) {
                    slot.temp_swept = true;
                    temps_due.push(id.clone());
                }
            }
            (refs_due, temps_due)
        };
        if refs_due.is_empty() && temps_due.is_empty() {
            return;
        }
        let work = move |o: &Orchestration| {
            for id in &refs_due {
                o.reclaim_refs(id);
            }
            for id in &temps_due {
                let s = o.sweep_temps(id);
                if s != Swept::default() {
                    log::line(format!(
                        "orchestration — {id}: server temp folders removed {}, kept {}, busy {}",
                        s.removed, s.kept, s.busy
                    ));
                }
            }
        };
        let me = self.me.read().unwrap_or_else(|e| e.into_inner()).upgrade();
        if let Some(me) = me {
            if std::thread::Builder::new()
                .name("orchestration-cleanup".into())
                .spawn(move || work(me.as_ref()))
                .is_ok()
            {
                return;
            }
            // 스레드를 못 세웠다 — 다음 시계에 다시(표시를 되돌리지는 않는다: 재시작이 다시 정리한다).
            return;
        }
        work(self);
    }

    /// **ref 회수**(6-2) — `candidate/<job>`(**끝난 Job 의 것만** — 그 Job 기록의 후보 OID 로, 리뷰 F6) · `conflict/<task>`(그 Task 가
    /// 종결됐을 때). 둘 다 그 OID 일 때만 지운다(CAS). 새 Job 의 후보 ref 는 이름이 달라 건드리지 않는다. 블로킹(git). 지운 수.
    pub(crate) fn reclaim_refs(&self, run_id: &str) -> usize {
        let Some(git) = self.integrator() else { return 0 };
        let (repo, base, ended_jobs, conflict_tasks, gen, state) = {
            let g = self.lock();
            let Some(s) = g.runs.get(run_id) else { return 0 };
            if s.run.integration.is_none() {
                return 0;
            }
            let ended: HashSet<&str> = s.run.tasks.iter().filter(|t| t.state.terminal()).map(|t| t.id.as_str()).collect();
            let mut tasks: Vec<String> = s
                .run
                .jobs
                .iter()
                .filter(|j| j.phase == JobPhase::Conflict && ended.contains(j.task_id.as_str()))
                .map(|j| j.task_id.clone())
                .collect();
            tasks.sort();
            tasks.dedup();
            // 끝난 Job → 기록된 후보 OID(계산 중 거둬져 후보를 적지 못했으면 `None`).
            let ended_jobs: Vec<(String, Option<String>)> =
                s.run.jobs.iter().filter(|j| !j.phase.live()).map(|j| (j.job_id.clone(), j.candidate.clone())).collect();
            (PathBuf::from(&s.run.repo), run_base(&s.run), ended_jobs, tasks, s.run.gen, s.run.state)
        };
        let mut dels: Vec<(String, String)> = Vec::new();
        if !ended_jobs.is_empty() {
            let prefix = refs::candidate_prefix(&base);
            for (name, oid) in git.list_refs(&repo, &prefix).unwrap_or_default() {
                let job = name.strip_prefix(&prefix).unwrap_or_default();
                // ref 꼬리는 Job id 의 짧은 이름이다(`refs::short`).
                match ended_jobs.iter().find(|(j, _)| refs::short(j) == job) {
                    // 기록된 후보가 있으면 그 OID 일 때만 · 없으면(후보를 적기 전에 끝남) 지금 OID 로 — 끝난 Job 은 다시 쓰지 않는다.
                    Some((_, Some(c))) if *c != oid => {}
                    Some(_) => dels.push((name, oid)),
                    None => {}
                }
            }
        }
        for name in conflict_tasks.iter().map(|t| refs::conflict(&base, t)) {
            if let Ok(Some(old)) = git.read_ref(&repo, &name) {
                dels.push((name, old));
            }
        }
        let mut n = 0;
        for (name, old) in dels {
            if matches!(git.update_refs(&repo, &[RefOp::Delete { name, old }]), Ok(TxOutcome::Committed)) {
                n += 1;
            }
        }
        if n > 0 {
            self.audit(
                "refs_reclaimed",
                run_id,
                OrchestrationAudit {
                    gen,
                    actor: Actor::Server.as_str().into(),
                    run_state: Some(state.as_str().into()),
                    cleaned: Some(n as u32),
                    ..Default::default()
                },
            );
        }
        n
    }

    /// **서버 임시 자리 폐기**(6-2 — 머리말 ①~⑤). 끝난 Run · orphaned 만(살아 있는 Run 은 아무것도 안 한다). 남긴 것은 `Run.tempPending` 에
    /// 적고(지난번 목록은 이번 판정으로 갈아 끼운다) 새로 남긴 것이 있으면 알림 `cleanup-pending`. 블로킹(git · 디스크).
    pub(crate) fn sweep_temps(&self, run_id: &str) -> Swept {
        let data_dir = self.dir.clone();
        let mut snap = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return Swept::default() };
            if !cleanable_state(slot.run.state) || slot.sweeping || slot.archiving {
                return Swept::default();
            }
            slot.sweeping = true;
            collect_places(slot, data_dir.as_deref())
        };
        discover(&mut snap, run_id, self.sidecar().as_deref());
        let sidecar = self.sidecar();
        let mut out = Swept::default();
        let mut kept: Vec<(PathBuf, &'static str, &'static str)> = Vec::new();
        for place in &snap.places {
            match judge(place, &snap, false) {
                Verdict::Gone => forget(sidecar.as_deref(), &place.path),
                Verdict::Removed => {
                    out.removed += 1;
                    forget(sidecar.as_deref(), &place.path);
                }
                Verdict::Kept("outside") => {}
                Verdict::Kept(why) => {
                    out.kept += 1;
                    kept.push((place.path.clone(), place.role, why));
                }
                Verdict::Busy => {
                    out.busy += 1;
                    kept.push((place.path.clone(), place.role, "in-use"));
                }
            }
        }
        // 검토 cwd 의 뿌리(`<데이터>/orchestration/<run>`) — 비었으면 걷는다(비지 않았으면 그대로 — `remove_dir` 는 빈 폴더만).
        if let Some(root) = &snap.cwd_root {
            let _ = std::fs::remove_dir(root);
        }
        self.record_sweep(run_id, out, kept, "server_temp_cleaned", Actor::Server);
        out
    }

    /// 폐기 결과를 장부에 적는다(잠금 안) — 남긴 목록 갈아 끼우기 · 알림 · 보류 표시 · 감사.
    fn record_sweep(&self, run_id: &str, out: Swept, kept: Vec<(PathBuf, &'static str, &'static str)>, event: &str, actor: Actor) {
        let now = self.now();
        let detail = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return };
            slot.sweeping = false;
            let before: Vec<String> = slot.run.temp_pending.iter().map(|p| super::worktree::wt_key(&p.path)).collect();
            let pending: Vec<TempPending> = kept
                .iter()
                .map(|(p, role, why)| TempPending {
                    path: p.to_string_lossy().into_owned(),
                    role: (*role).to_string(),
                    why: (*why).to_string(),
                    at: now,
                })
                .collect();
            let fresh = pending.iter().filter(|p| !before.contains(&super::worktree::wt_key(&p.path))).count();
            let changed = out.removed > 0 || slot.run.temp_pending != pending;
            slot.run.temp_pending = pending;
            if !changed {
                return;
            }
            let ended = matches!(slot.run.state, RunState::Done | RunState::Stopped);
            slot.run.bump(now, actor, event, None, &format!("removed {} · kept {}", out.removed, out.kept + out.busy));
            if fresh > 0 {
                if ended && slot.run.hold.is_none() {
                    // 끝난 Run 의 보류는 표시만(통합 설계 6-2).
                    set_hold(slot, HoldReason::CleanupPending, None, now);
                }
                self.raise(slot, "cleanup-pending", None, Some(&fresh.to_string()));
            }
            if slot.run.temp_pending.is_empty() && slot.run.hold.as_ref().is_some_and(|h| h.reason == HoldReason::CleanupPending) {
                slot.run.hold = None;
            }
            if slot.run.state == RunState::Orphaned {
                self.save_orphaned(&g, run_id);
            } else {
                self.after_change(&g, run_id);
            }
            let s = g.runs.get(run_id).map(|s| (s.run.gen, s.run.state));
            let (gen, state) = s.unwrap_or((0, RunState::Orphaned));
            OrchestrationAudit {
                gen,
                actor: actor.as_str().into(),
                run_state: Some(state.as_str().into()),
                cleaned: Some(out.removed as u32),
                kept: Some((out.kept + out.busy) as u32),
                ..Default::default()
            }
        };
        self.audit(event, run_id, detail);
    }

    /// 사람의 [그래도 지우기](op `orchestration_discard_temp`) — **남긴 목록에 있는** 서버 임시 자리 하나를 쉬는 상태 비교 없이 지운다. 소유 ·
    /// 실제 경로 · 쓰는 프로세스 0 · 링크 먼저 걷기는 그대로(⑤). 블로킹.
    pub(crate) fn discard_temp(&self, run_id: &str, path: &str) -> Result<Value, OrchError> {
        let data_dir = self.dir.clone();
        let mut snap = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
            if !cleanable_state(slot.run.state) {
                return Err(OrchError::new(reason::NOT_CLEANABLE, "server temp folders are removed only after the run ended"));
            }
            if slot.sweeping {
                return Err(OrchError::new(reason::INVALID_STATE, "a cleanup of this run is running — try again in a moment"));
            }
            let want = super::worktree::wt_key(path);
            if !slot.run.temp_pending.iter().any(|p| super::worktree::wt_key(&p.path) == want) {
                return Err(OrchError::new(reason::NOT_CLEANABLE, "that folder is not a kept server temp folder of this run"));
            }
            slot.sweeping = true;
            collect_places(slot, data_dir.as_deref())
        };
        discover(&mut snap, run_id, self.sidecar().as_deref());
        let want = super::worktree::wt_key(path);
        let place = snap.places.iter().find(|p| super::worktree::wt_key(&p.path.to_string_lossy()) == want).cloned();
        let sidecar = self.sidecar();
        let verdict = match &place {
            Some(p) => judge(p, &snap, true),
            None => Verdict::Kept("outside"),
        };
        // 남긴 목록에서 이 자리만 판정대로 고친다(나머지는 그대로).
        let (kept_rest, now_kept): (Vec<TempPending>, Option<&'static str>) = {
            let g = self.lock();
            let rest = g
                .runs
                .get(run_id)
                .map(|s| s.run.temp_pending.iter().filter(|p| super::worktree::wt_key(&p.path) != want).cloned().collect())
                .unwrap_or_default();
            let k = match &verdict {
                Verdict::Kept(w) => Some(*w),
                Verdict::Busy => Some("in-use"),
                _ => None,
            };
            (rest, k)
        };
        let mut out = Swept::default();
        let mut kept: Vec<(PathBuf, &'static str, &'static str)> = Vec::new();
        for p in &kept_rest {
            let role = match p.role.as_str() {
                ROLE_VERIFY => ROLE_VERIFY,
                ROLE_REVIEW => ROLE_REVIEW,
                ROLE_REVIEW_CWD => ROLE_REVIEW_CWD,
                _ => ROLE_TEMP,
            };
            let why = match p.why.as_str() {
                "changed" => "changed",
                "in-use" => "in-use",
                "remove-failed" => "remove-failed",
                "not-a-worktree" => "not-a-worktree",
                _ => "unreadable",
            };
            kept.push((PathBuf::from(&p.path), role, why));
        }
        match (&verdict, &place) {
            (Verdict::Removed | Verdict::Gone, Some(p)) => {
                out.removed += usize::from(matches!(verdict, Verdict::Removed));
                forget(sidecar.as_deref(), &p.path);
            }
            (_, Some(p)) => {
                out.kept += 1;
                kept.push((p.path.clone(), p.role, now_kept.unwrap_or("remove-failed")));
            }
            (_, None) => {}
        }
        out.kept += kept_rest.len();
        self.record_sweep(run_id, out, kept, "server_temp_discarded", Actor::Human);
        match verdict {
            Verdict::Removed | Verdict::Gone => Ok(json!({ "path": path, "removed": true })),
            Verdict::Busy => Err(OrchError::new(reason::CLEANUP_PENDING, "a process may still be using that folder")),
            Verdict::Kept(why) => Err(OrchError::new(reason::CLEANUP_PENDING, format!("the folder was not removed ({why})"))),
        }
    }

    /// [정리] 재료(op `orchestration_cleanup_preview` — 사람). 끝난 Run · orphaned 만. 작업자 worktree(지울 수 있나 · 기본 체크) · 이 Run 의
    /// ref(종류 · 기본 체크) · 남긴 서버 임시 자리. 블로킹(git 읽기).
    pub(crate) fn cleanup_preview(&self, run_id: &str) -> Result<Value, OrchError> {
        let (mut rows, repo, integ, pending, state) = {
            let g = self.lock();
            let s = g.runs.get(run_id).ok_or_else(not_found_run)?;
            if !cleanable_state(s.run.state) {
                return Err(OrchError::new(reason::NOT_CLEANABLE, "cleanup is available after the run ended"));
            }
            (worktree_rows(s), PathBuf::from(&s.run.repo), s.run.integration.clone(), s.run.temp_pending.clone(), s.run.state)
        };
        fill_git(&mut rows);
        let refs_view = match &integ {
            Some(i) => self.ref_rows(run_id, &repo, i)?,
            None => Vec::new(),
        };
        Ok(json!({
            "runId": run_id,
            "state": state,
            "worktrees": rows.iter().map(WtRow::to_json).collect::<Vec<_>>(),
            "refs": refs_view,
            "tempPending": pending,
            "exportBranch": integ.as_ref().map(|i| i.export_branch.clone()),
        }))
    }

    /// 이 Run 의 ref 줄들 — `{name, kind, oid, eligible, blocker?, defaultChecked}`.
    fn ref_rows(&self, run_id: &str, repo: &Path, integ: &Integration) -> Result<Vec<Value>, OrchError> {
        let git = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        // 저장된 통합 ref 의 뿌리를 따른다 — 개명 전에 선 Run 이면 그 옛 뿌리의 머리를 훑는다([`refs::base_of`]).
        let prefix = refs::base_of(run_id, &integ.work_ref).as_str().to_string();
        let listed = git
            .list_refs(repo, &prefix)
            .map_err(|e| OrchError::new(reason::GIT_FAILED, e.chars().take(240).collect::<String>()))?;
        // 통합 ref 는 내보낸 브랜치가 그 머리를 품을 때만(통합 결과가 브랜치에 남는다 — 6-2). 시작 커밋 그대로면 내보내지 않아도 된다(잃을 커밋이 없다).
        let branch = format!("refs/heads/{}", integ.export_branch);
        let exported = git.read_ref(repo, &branch).ok().flatten();
        let mut out = Vec::new();
        for (name, oid) in listed {
            let kind = ref_kind(&prefix, &name);
            let blocker = match kind.as_str() {
                "int" if oid == integ.base_commit => None,
                "int" => match &exported {
                    Some(b) if git.is_ancestor(repo, &oid, b).unwrap_or(false) => None,
                    Some(_) => Some("export-behind"),
                    None => Some("not-exported"),
                },
                _ => None,
            };
            out.push(json!({
                "name": name,
                "kind": kind,
                "oid": oid,
                "eligible": blocker.is_none(),
                "blocker": blocker,
                // 서버 임시 ref(남은 것)만 기본 체크 — 완료 증거 · 보존 · 되돌린 머리 · 통합 ref 는 기본 남김(R13).
                "defaultChecked": blocker.is_none() && matches!(kind.as_str(), "candidate" | "conflict"),
            }));
        }
        Ok(out)
    }

    /// [정리](op `orchestration_cleanup` — 사람). 고른 작업자 worktree(지금 다시 판정 — 지울 수 없으면 그 줄만 거절) · 고른 ref(지금 목록 ·
    /// 그 OID 로 CAS) · 그 앞에 서버 임시 자리 폐기를 한 번 더(재정리). `deleteBranches` 면 worktree 를 지우며 병합이 확인됐거나
    /// 끝이 보존 ref 가 지키는 통합된 보고 커밋인 브랜치만 지운다(`worktree::BranchRule::Lenient` — 못 지운 브랜치는 남기고 줄의 `branchKept`
    /// 에 까닭, 실패 아님 · 기본 남김). 통합 ref 를 지웠으면 장부에 남긴다(`integration.workRefRemoved`). 블로킹.
    pub(crate) fn cleanup_run(
        &self,
        run_id: &str,
        worktrees: &[String],
        ref_names: &[String],
        delete_branches: bool,
    ) -> Result<Value, OrchError> {
        let (repo, integ, gen, state, wt_dir) = {
            let g = self.lock();
            let s = g.runs.get(run_id).ok_or_else(not_found_run)?;
            if !cleanable_state(s.run.state) {
                return Err(OrchError::new(reason::NOT_CLEANABLE, "cleanup is available after the run ended"));
            }
            if s.archiving {
                return Err(OrchError::new(reason::INVALID_STATE, "this album is being archived"));
            }
            (PathBuf::from(&s.run.repo), s.run.integration.clone(), s.run.gen, s.run.state, s.run.worktree_dir.clone())
        };
        let temps = self.sweep_temps(run_id);
        let sidecar = self.sidecar();
        let mut done_wt: Vec<Value> = Vec::new();
        let mut failed: Vec<Value> = Vec::new();
        for path in worktrees {
            let mut rows = {
                let g = self.lock();
                let s = g.runs.get(run_id).ok_or_else(not_found_run)?;
                let want = super::worktree::wt_key(path);
                worktree_rows(s).into_iter().filter(|r| super::worktree::wt_key(&r.path) == want).collect::<Vec<_>>()
            };
            fill_git(&mut rows);
            let Some(row) = rows.into_iter().next() else {
                failed.push(json!({ "path": path, "reason": reason::NOT_CLEANABLE }));
                continue;
            };
            if let Some(b) = row.blocker() {
                failed.push(json!({ "path": path, "reason": b }));
                continue;
            }
            let key = match self.begin_worktree_removal(run_id, &row.path) {
                Ok(k) => k,
                Err(e) => {
                    failed.push(json!({ "path": path, "reason": e.code }));
                    continue;
                }
            };
            // 브랜치(E2E 10-16 #9): 못 지우면 worktree 정리의 실패가 아니다 — 남기고 까닭을 싣는다(`BranchRule::Lenient`). 통합은 squash 라
            // 작업자 브랜치는 통합 ref 의 조상이 될 수 없다 — 끝이 이 Run 이 통합한 보고 커밋이고 그것을 보존 ref 가 지금 지키면 지운다.
            // 같은 정리에서 그 보존 ref 를 지우면 커밋을 지킬 것이 없으니 남긴다.
            let preserve_ref = refs::accepted(&refs::base_of(run_id, integ.as_ref().map_or("", |i| i.work_ref.as_str())), &row.task_id);
            let preserve_dropped = ref_names.contains(&preserve_ref);
            let preserved = match (&row.integrated_report, delete_branches && !preserve_dropped) {
                (Some(oid), true) => self
                    .integrator()
                    .and_then(|git| git.read_ref(&repo, &preserve_ref).ok().flatten())
                    .filter(|held| held == oid),
                _ => None,
            };
            let rule = if delete_branches {
                super::worktree::BranchRule::Lenient { preserved: preserved.as_deref() }
            } else {
                super::worktree::BranchRule::Keep
            };
            // 줄은 Run 장부에서 왔다 — 곁 기록 줄이 빠진 worktree 도 장부 근거로 지운다(`LedgerClaim` · 11-09).
            let ledger = super::worktree::LedgerClaim { worktree_dir: &wt_dir, branch: row.branch.as_deref() };
            let r = super::worktree::remove_with(&repo, &row.path, rule, run_id, sidecar.as_deref(), Some(ledger));
            if r.is_ok() {
                self.note_worktree_removed(run_id, &row.path);
            }
            self.end_worktree_claim(run_id, &key);
            match r {
                Ok(mut removed) => {
                    if removed.branch_kept == Some("unmerged") && preserve_dropped && row.integrated_report.is_some() {
                        removed.branch_kept = Some("preserve-ref-removed");
                    }
                    done_wt.push(removed.to_json(&row.path))
                }
                Err(e) => failed.push(json!({ "path": path, "reason": e.code })),
            }
        }
        let mut done_refs: Vec<String> = Vec::new();
        if !ref_names.is_empty() {
            let integ = integ.ok_or_else(|| OrchError::new(reason::NOT_CLEANABLE, "this run has no integration refs"))?;
            let git = self
                .integrator()
                .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
            let rows = self.ref_rows(run_id, &repo, &integ)?;
            for name in ref_names {
                let Some(row) = rows.iter().find(|r| r["name"].as_str() == Some(name.as_str())) else {
                    failed.push(json!({ "ref": name, "reason": reason::NOT_CLEANABLE }));
                    continue;
                };
                if row["eligible"] != true {
                    failed.push(json!({ "ref": name, "reason": row["blocker"] }));
                    continue;
                }
                let old = row["oid"].as_str().unwrap_or_default().to_string();
                if !hex40(&old) {
                    failed.push(json!({ "ref": name, "reason": reason::GIT_FAILED }));
                    continue;
                }
                match git.update_refs(&repo, &[RefOp::Delete { name: name.clone(), old }]) {
                    Ok(TxOutcome::Committed) => done_refs.push(name.clone()),
                    _ => failed.push(json!({ "ref": name, "reason": reason::GIT_FAILED })),
                }
            }
        }
        let now = self.now();
        {
            let mut g = self.lock();
            if let Some(slot) = g.runs.get_mut(run_id) {
                // 사람이 지운 통합 ref 는 장부에 남긴다 — 재시작 복구 · 내보내기가 그 부재를 기대한 상태로 본다(E2E 10-16 #10).
                if let Some(i) = slot.run.integration.as_mut() {
                    if done_refs.contains(&i.work_ref) {
                        i.work_ref_removed = true;
                    }
                }
                slot.run.bump(
                    now,
                    Actor::Human,
                    "run_cleaned",
                    None,
                    &format!("worktrees {} · refs {} · failed {}", done_wt.len(), done_refs.len(), failed.len()),
                );
                if slot.run.state == RunState::Orphaned {
                    self.save_orphaned(&g, run_id);
                } else {
                    self.after_change(&g, run_id);
                }
            }
        }
        self.audit(
            "run_cleanup",
            run_id,
            OrchestrationAudit {
                gen,
                actor: Actor::Human.as_str().into(),
                run_state: Some(state.as_str().into()),
                cleaned: Some((done_wt.len() + done_refs.len()) as u32),
                kept: Some(failed.len() as u32),
                ..Default::default()
            },
        );
        Ok(json!({
            "runId": run_id,
            "worktrees": done_wt,
            "refs": done_refs,
            "failed": failed,
            "temps": temps.to_json(),
        }))
    }
}

/// 곁 파일에서 그 자리 줄을 걷는다(지웠거나 이미 없을 때) — 서버 임시 자리 줄만(`role` 이 있는 줄).
fn forget(sidecar: Option<&Path>, path: &Path) {
    let Some(side) = sidecar else { return };
    let key = wt::path_key(&path.to_string_lossy());
    let file = wt::load_sidecar(side);
    if wt::role_of(&file, &key).is_none() {
        return;
    }
    if let Err(e) = wt::forget_path(side, &key) {
        log::line(format!("orchestration — worktrees.json not written: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(state: TaskState, run_ended: bool) -> WtRow {
        WtRow {
            path: "C:/wt/orch-x".into(),
            attempt_id: "att-1".into(),
            task_id: "task-1".into(),
            task_title: "t".into(),
            task_state: state,
            branch: None,
            exists: true,
            in_use: false,
            integrated: false,
            integrated_report: None,
            dirty: Some(false),
            run_ended,
        }
    }

    /// E2E 10-16 #6 — 끝난 Run 의 열린 Task worktree 는 고를 수 있되 기본 해제 · 진행 중 Run 은 `task-open` 그대로 · 다른 막음은 그대로.
    #[test]
    fn open_task_blocks_only_while_the_run_lives() {
        for s in [TaskState::Reported, TaskState::Active, TaskState::Todo] {
            assert_eq!(row(s, false).blocker(), Some("task-open"), "{s:?}");
            let ended = row(s, true);
            assert_eq!(ended.blocker(), None, "{s:?}");
            assert_eq!(ended.to_json()["defaultChecked"], false, "{s:?} — 사람이 고른다");
        }
        let mut dirty = row(TaskState::Reported, true);
        dirty.dirty = Some(true);
        assert_eq!(dirty.blocker(), Some("dirty"));
        let mut busy = row(TaskState::Reported, true);
        busy.in_use = true;
        assert_eq!(busy.blocker(), Some("in-use"));
    }
}
