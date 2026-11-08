//! **앨범 보관함**(사람 — op `orchestration_archive` · `_archive_list` · `_restore` · `_delete_archived`) — 끝난 앨범을 라이브러리에서 빼고
//! 되돌리거나 영구히 지운다. 옛 [닫기](`close_orphaned`)의 몸이 여기로 왔다 — orphaned 의 닫기도 이 보관이다(길은 하나).
//!
//! - **보관**: 끝난 앨범만([`cleanable_state`](super::cleanup::cleanable_state)). 서버 임시 자리를 한 번 더 비워 보고(남으면 `cleanup-pending`) 작업자
//!   worktree 가 디스크에 남았으면 `worktrees-left` — 보관한 뒤에는 그 자리를 판정할 장부가 표에 없다. 기록과 ref 는 그대로 남는다.
//!   **파일 순서**: 마지막 스냅숏을 쓰기 줄에 넣고(이 Run 은 더 넣지 않는다 — `Slot::archiving`) 저장 확인을 받은 뒤 옮기고 표에서 뺀다. 그래야 쓰기 줄에
//!   남은 옛 스냅숏이 옮긴 파일을 되살리지 않는다.
//! - **복원**: 끝난 기록으로만 돌아온다([`persist::restored`] — done · stopped 는 그대로, 그 밖은 재시작과 같이 orphaned). 작업자 · 프로듀서 · 토큰 · 조정자
//!   묶음을 되살리지 않는다(새 `Slot` 뿐 · 프로세스를 띄우는 길이 없다).
//! - **영구 삭제**: 보관함에서만. 이 앨범의 ref 전부(저장된 통합 ref 의 뿌리 아래 — `refs::base_of` · 그 OID 로 CAS)를 먼저, 모두 지운 뒤 파일. ref 삭제가 실패하면
//!   파일을 남기고 오류 — 다시 시도할 수 있다. 저장소가 사라졌으면 ref 는 건너뛴다. **내보낸 브랜치 · 병합된 커밋은 `refs/heads` 라 뿌리 밖이다 — 닿지 않는다.**
//!
//! 불변식: 이 파일의 길은 사람의 Tauri 명령뿐이고 MCP 에는 없다(시험 `archive_has_no_mcp_path`). id 는 [`is_id`] 를 지난 것만 파일 이름이 된다(경로 탈출 없음).
//! 이벤트 몸의 `archive: true` 는 보관함 목록을 다시 읽으라는 표지다(토큰 · 본문 없음). 문구 · 로그 · 감사에 경로 · 비밀을 싣지 않는다.

use std::path::Path;

use serde_json::{json, Value};

use super::{human_detail, not_found_run, persist, reason, OrchError, Orchestration, Slot, EVT_CHANGED};
use crate::orchestration::cleanup::{cleanable_state, worker_worktree_paths, worktrees_left};
use crate::orchestration::integrate::{refs, IntegrationGit, TxOutcome};
use crate::orchestration::merge::RefOp;
use crate::orchestration::model::*;
use crate::server::log;

fn not_ended() -> OrchError {
    OrchError::new(reason::INVALID_STATE, "only an ended album can be archived")
}

/// id 검사 — 이것을 지난 글자만 파일 이름이 된다(`..` · 구분자 없음 — 32자리 소문자 hex).
fn check_id(run_id: &str) -> Result<(), OrchError> {
    if is_id("run", run_id) {
        Ok(())
    } else {
        Err(OrchError::new(reason::INVALID_ARGUMENT, "not an album id"))
    }
}

/// 내보내지 않은 통합 결과가 있나 — 통합 머리가 시작 커밋과 다르고 내보낸 브랜치가 품지 않는다(저장소를 못 읽으면 장부의 내보낸 머리로).
fn has_unexported(git: Option<&dyn IntegrationGit>, run: &Run) -> bool {
    let Some(i) = &run.integration else { return false };
    // 사람이 [정리]로 지운 통합 ref — 내보낸 브랜치가 품거나 시작 커밋 그대로일 때만 지워진다.
    if i.work_ref_removed || i.expected_head == i.base_commit {
        return false;
    }
    let repo = Path::new(&run.repo);
    if let Some(git) = git.filter(|_| repo.join(".git").exists()) {
        match git.read_ref(repo, &format!("refs/heads/{}", i.export_branch)) {
            Ok(None) => return true,
            Ok(Some(branch)) => {
                if let Ok(contained) = git.is_ancestor(repo, &i.expected_head, &branch) {
                    return !contained;
                }
            }
            Err(_) => {}
        }
    }
    i.exported_head.as_deref() != Some(i.expected_head.as_str())
}

/// 보관함 한 줄 — 토큰 · 본문 없음(경로는 사람 보기의 저장소 칸뿐).
fn archived_row(git: Option<&dyn IntegrationGit>, r: &Run) -> Value {
    let unexported = has_unexported(git, r);
    let exported = r.integration.as_ref().filter(|i| i.exported_head.is_some()).map(|i| i.export_branch.clone());
    json!({
        "runId": r.id,
        "name": r.name,
        "repo": r.repo,
        "state": r.state,
        "previousState": r.previous_state,
        "taskCount": r.tasks.len(),
        "createdAt": r.created_at,
        "archivedAt": r.archived_at.unwrap_or(r.updated_at),
        "exportedBranch": exported,
        "unexported": unexported,
        // [Export first] 는 복원 뒤 앨범 화면의 [브랜치로 내보내기]다 — orphaned 는 서버가 내보내지 않고(읽기 전용) 저장소가 없으면 낼 곳이 없다.
        "exportable": unexported && r.state != RunState::Orphaned && Path::new(&r.repo).join(".git").exists(),
    })
}

impl Orchestration {
    fn archive_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.archive_ops.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 보관 · 복원 · 삭제 이벤트 — 보관함 목록을 다시 읽으라는 표지(`archive`). `closed` 면 표에서 사라졌다.
    fn emit_archive(&self, run_id: &str, seq: u64, closed: bool) {
        (self.emit)(EVT_CHANGED, json!({ "runId": run_id, "seq": seq, "closed": closed, "archive": true }));
        self.changed.notify_all();
    }

    /// [보관](사람) — 머리말. 블로킹(git · 디스크).
    pub(crate) fn archive_run(&self, run_id: &str) -> Result<Value, OrchError> {
        let _ops = self.archive_guard();
        {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            if !cleanable_state(slot.run.state) {
                return Err(not_ended());
            }
        }
        // 서버 임시 자리(통합 설계 6-2): 쉬는 상태면 지우고, 예상 밖 변경 · 아직 쓰는 프로세스가 남으면 보관하지 않는다
        // (사람이 보드에서 보고 [그래도 지우기] — 보관한 뒤에는 이 Run 의 자리를 판정할 장부가 없다).
        let left = self.sweep_temps(run_id);
        if left.kept + left.busy > 0 {
            return Err(OrchError::new(
                reason::CLEANUP_PENDING,
                format!(
                    "{} server temp folder(s) of this run were kept (unexpected changes or a process still using them) — look at them on the album page first",
                    left.kept + left.busy
                ),
            ));
        }
        let paths = worker_worktree_paths(&self.lock().runs.get(run_id).ok_or_else(not_found_run)?.run);
        let n = worktrees_left(&paths);
        if n > 0 {
            return Err(OrchError::new(reason::WORKTREES_LEFT, n.to_string()));
        }
        let now = self.now();
        // 마지막 스냅숏 — 이 뒤로 이 Run 은 쓰기 줄에 들어가지 않는다.
        let (wait, gen, state, seq) = {
            let mut g = self.lock();
            let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
            if !cleanable_state(slot.run.state) {
                return Err(not_ended());
            }
            if slot.sweeping || !slot.wt_busy.is_empty() {
                return Err(OrchError::new(reason::INVALID_STATE, "a cleanup of this album is running — try again in a moment"));
            }
            if !slot.run.temp_pending.is_empty() {
                let kept = slot.run.temp_pending.len();
                return Err(OrchError::new(reason::CLEANUP_PENDING, format!("{kept} server temp folder(s) of this run were kept")));
            }
            slot.run.archived_at = Some(now);
            let (gen, state, seq) = (slot.run.gen, slot.run.state, slot.run.seq);
            let wait = self.publish(&g, run_id, true, true);
            if let Some(slot) = g.runs.get_mut(run_id) {
                slot.archiving = true;
            }
            (wait, gen, state, seq)
        };
        let saved = if self.dir.is_some() { wait.wait() } else { Ok(()) };
        let mut g = self.lock();
        let moved = saved.and_then(|()| match &self.dir {
            Some(d) => persist::archive(d, run_id),
            None => Ok(()),
        });
        if let Err(e) = moved {
            log::line(format!("orchestration — {run_id}: could not archive the album file: {e}"));
            if let Some(slot) = g.runs.get_mut(run_id) {
                slot.archiving = false;
                slot.run.archived_at = None;
            }
            return Err(OrchError::new(reason::INTERNAL, "could not archive the album file"));
        }
        g.runs.remove(run_id);
        drop(g);
        self.emit_archive(run_id, seq, true);
        self.audit("run_archived", run_id, human_detail(gen, state));
        Ok(json!({ "runId": run_id, "archivedAt": now }))
    }

    /// 보관함 목록(최근 보관 먼저). 못 읽는 파일은 건너뛰고 로그 한 줄(이름 · 사유만). 블로킹(파일 · git).
    pub(crate) fn archived_list(&self) -> Value {
        let Some(dir) = &self.dir else { return json!([]) };
        // 목록은 보일 때마다 읽는다 — 건너뛴 파일의 로그는 파일 하나당 서버 수명에 한 번만.
        let mut runs = persist::load_archived(dir, |name, why| {
            if self.archive_skips.lock().unwrap_or_else(|e| e.into_inner()).insert(name.to_string()) {
                log::line(format!("orchestration — skipped archived {name}: {why}"));
            }
        });
        runs.sort_by_key(|r| std::cmp::Reverse(r.archived_at.unwrap_or(r.updated_at)));
        let git = self.integrator();
        Value::Array(runs.iter().map(|r| archived_row(git.as_deref(), r)).collect())
    }

    /// 보관한 파일 하나 — 없으면 `not-found` · 판이 맞지 않으면 `archive-unreadable`.
    fn archived_run(&self, run_id: &str) -> Result<(&Path, Run), OrchError> {
        check_id(run_id)?;
        let dir = self.dir.as_deref().ok_or_else(not_found_run)?;
        match persist::read_archived(dir, run_id) {
            persist::ArchivedRead::Found(run) => Ok((dir, *run)),
            persist::ArchivedRead::Missing => Err(not_found_run()),
            persist::ArchivedRead::Unreadable(why) => {
                log::line(format!("orchestration — archived {run_id} refused: {why}"));
                Err(OrchError::new(reason::ARCHIVE_UNREADABLE, "unsupported or broken file"))
            }
        }
    }

    /// [복원](사람) — 머리말. 파일을 먼저 옮기고(원자) 같은 잠금에서 표에 세운다.
    pub(crate) fn restore_archived(&self, run_id: &str) -> Result<Value, OrchError> {
        let _ops = self.archive_guard();
        let (dir, mut run) = self.archived_run(run_id)?;
        persist::restored(&mut run);
        let (gen, state, seq) = (run.gen, run.state, run.seq);
        {
            let mut g = self.lock();
            if g.runs.contains_key(run_id) || dir.join(persist::file_name(run_id)).exists() {
                return Err(OrchError::new(reason::INVALID_STATE, "this album is already in the library"));
            }
            persist::unarchive(dir, run_id).map_err(|e| {
                log::line(format!("orchestration — {run_id}: could not restore the album file: {e}"));
                OrchError::new(reason::INTERNAL, "could not restore the album file")
            })?;
            // 귀속 색인은 지우지 않는 칸이다(채팅 하나 = 앨범 하나) — 재시작을 지났으면 파일에서 다시 세운다. 귀속은 권한이 아니다.
            for chat in &run.producers {
                g.producer_ever.entry(chat.clone()).or_insert_with(|| run_id.to_string());
            }
            let mut slot = Slot::new(run);
            if slot.run.state == RunState::Orphaned {
                slot.leftovers = crate::orchestration::attempts::leftovers_of(&slot.run);
            }
            g.runs.insert(run_id.to_string(), slot);
            // 복원한 상태를 파일에도(보관 칸을 걷는다) — orphaned 도 이 한 번은 쓴다.
            let _ = self.publish(&g, run_id, false, true);
        }
        self.emit_archive(run_id, seq, false);
        self.audit("run_restored", run_id, human_detail(gen, state));
        Ok(json!({ "runId": run_id, "state": state }))
    }

    /// [영구 삭제](사람 — 원격은 재확인) — 머리말. 블로킹(git).
    pub(crate) fn delete_archived(&self, run_id: &str) -> Result<Value, OrchError> {
        let _ops = self.archive_guard();
        let (dir, run) = self.archived_run(run_id)?;
        if self.lock().runs.contains_key(run_id) {
            return Err(OrchError::new(reason::INVALID_STATE, "this album is in the library"));
        }
        let mut removed = 0usize;
        let repo = Path::new(&run.repo);
        if let Some(integ) = run.integration.as_ref().filter(|_| repo.join(".git").exists()) {
            let git = self
                .integrator()
                .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
            let base = refs::base_of(run_id, &integ.work_ref);
            let git_failed = |e: String| OrchError::new(reason::GIT_FAILED, e.chars().take(240).collect::<String>());
            for (name, old) in git.list_refs(repo, base.as_str()).map_err(git_failed)? {
                match git.update_refs(repo, &[RefOp::Delete { name, old }]) {
                    Ok(TxOutcome::Committed) => removed += 1,
                    Ok(TxOutcome::Refused(e)) | Err(e) => return Err(git_failed(e)),
                }
            }
        }
        persist::remove_archived(dir, run_id).map_err(|e| {
            log::line(format!("orchestration — {run_id}: could not delete the archived file: {e}"));
            OrchError::new(reason::INTERNAL, "could not delete the archived album file")
        })?;
        // 검토 cwd 의 뿌리(`<데이터>/orchestration/<run>`) — 비었으면 걷는다(`remove_dir` 는 빈 폴더만).
        let _ = std::fs::remove_dir(dir.join(run_id));
        self.emit_archive(run_id, run.seq, true);
        self.audit(
            "run_deleted",
            run_id,
            crate::audit::OrchestrationAudit { cleaned: Some(removed as u32), ..human_detail(run.gen, run.state) },
        );
        Ok(json!({ "runId": run_id, "refsRemoved": removed }))
    }
}
