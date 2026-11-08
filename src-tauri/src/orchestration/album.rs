//! 앨범 판정 원천(앨범 먼저 설계 2-4 · S2). 파일 · git 은 잠금 밖, 판정은 Run 과 읽은 재료만 본다.
//! 앨범 구성만 판정하며 저장소 맡기기 값은 읽지 않는다. 앨범이 없거나 판정에 실패하면 실행 범위를 닫는다.

use std::sync::Arc;

use serde_json::{json, Value};

use super::artists::Artists;
use super::model::*;
use super::roles::{self, AcceptGate, TurnRole};
use super::store::{OrchError, Orchestration, Slot};
use super::turn::Grade;
use super::config::{RoleCli, RoleKind};
use super::repo_identity::{IdentityError, RepoIdentity};

/// 저장소 신원과 지금 프로필. 목록 읽기 실패도 빈 목록과 구별해 좁은 쪽으로 판정한다.
#[derive(Debug, Clone)]
pub(crate) struct AlbumInputs {
    pub identity: Result<RepoIdentity, IdentityError>,
    pub artists: Result<Artists, String>,
}

pub(crate) type AlbumSource = Arc<dyn Fn(&str) -> AlbumInputs + Send + Sync>;

pub(super) fn default_source() -> AlbumSource {
    #[cfg(test)]
    {
        Arc::new(|_| AlbumInputs {
            identity: Err(IdentityError::Missing),
            artists: Err("시험 원천 없음".into()),
        })
    }
    #[cfg(not(test))]
    {
        Arc::new(|repo| AlbumInputs {
            identity: crate::orchestration::repo_identity::identity_now(std::path::Path::new(repo)),
            artists: crate::instance::config_root()
                .ok_or_else(|| "설정 폴더 없음".into())
                .and_then(|root| super::artists::load_artists(&root)),
        })
    }
}

/// 앨범 판정 재료. 앨범 없는 Run 도 관문에서 거절한다.
#[derive(Debug, Clone)]
pub(crate) enum RunInputs {
    Album(AlbumInputs),
}

fn error(code: &'static str, text: &str) -> OrchError {
    OrchError::new(code, text)
}

/// 넓힘 표(2-3). 판정형은 유효한 구성에서 언제나 read 이므로 들이기만으로 넓어지지 않는다.
pub(crate) fn widens(old: &AlbumConfig, new: &AlbumConfig) -> bool {
    new.members.iter().any(|n| match old.members.iter().find(|o| o.artist == n.artist) {
        Some(o) => n.grade > o.grade || n.allowed_commands.iter().any(|c| !o.allowed_commands.contains(c)),
        None => n.grade > MemberGrade::Read || !n.allowed_commands.is_empty(),
    }) || (!old.verify_auto && new.verify_auto)
        || (!old.plan_tools && new.plan_tools)
        || (!old.auto_merge && new.auto_merge)
        || new.wake_max > old.wake_max
        || new.accept.max_rework > old.accept.max_rework
        || old.accept.require.iter().any(|o| {
            new.accept
                .require
                .iter()
                .find(|n| n.role == o.role)
                .is_none_or(|n| n.passes < o.passes)
        })
}

/// 저장소 신원 관문. 사본 없음 · 읽기 실패 · 실체 변경이면 모두 repo-changed 이다.
pub(crate) fn identity_gate<'a>(run: &'a Run, inputs: &AlbumInputs) -> Result<&'a AlbumConfig, OrchError> {
    let changed = || {
        error(
            "repo-changed",
            "앨범을 연 저장소 신원을 확인할 수 없습니다 — 사람에게 저장소를 확인해 달라고 하세요",
        )
    };
    let album = run.album.as_ref().ok_or_else(changed)?;
    let snap = run.delegation.as_ref().ok_or_else(changed)?;
    let now = inputs.identity.as_ref().map_err(|_| changed())?;
    if crate::worktree::comparable(&snap.path) != crate::worktree::comparable(&run.repo)
        || !super::repo_identity::identity_matches(&RepoIdentity { git_dir: snap.git_dir.clone(), repo_id: snap.repo_id.clone() }, now)
    {
        return Err(changed());
    }
    Ok(album)
}

/// 앨범 관문 — 신원([`identity_gate`]) + 구성 · 위험 확인. 사람의 [병합]은 신원만 본다(아티스트 목록을 못 읽어도 병합은 그 일이 아니다).
pub(crate) fn gate<'a>(run: &'a Run, inputs: &AlbumInputs) -> Result<&'a AlbumConfig, OrchError> {
    let album = identity_gate(run, inputs)?;
    let artists = inputs
        .artists
        .as_ref()
        .map_err(|_| error(super::store::reason::ROLE_INVALID, "아티스트 목록을 읽을 수 없습니다"))?;
    // 위험 확인이 필요한 네 칸도 넓힘 판정을 공유한다(모든 자동 · 자동 검증 · 작업안 도구 · 자동 병합).
    let mut safe = album.clone();
    safe.verify_auto = false;
    safe.plan_tools = false;
    safe.auto_merge = false;
    for m in &mut safe.members {
        if m.grade == MemberGrade::Full && artists.iter().any(|a| a.id == m.artist && a.kind == RoleKind::Write) {
            m.grade = MemberGrade::Edit;
        }
    }
    if album.rev == 0 || album.wake_max > super::wake::SEGMENT_MAX || (widens(&safe, album) && album.risk_confirmed_at.is_none()) {
        return Err(error(super::store::reason::ROLE_INVALID, "앨범 구성 또는 위험 확인이 올바르지 않습니다"));
    }
    Ok(album)
}

/// 멤버 범위 + 지금 프로필 → 한 턴의 역할. 읽기 작업형은 실행 모드가 아니다(2-7 b).
pub(crate) fn pick_role(run: &Run, inputs: &AlbumInputs, id: &str) -> Result<TurnRole, OrchError> {
    let album = gate(run, inputs)?;
    let member = album
        .members
        .iter()
        .find(|m| m.artist == id)
        .ok_or_else(|| error(super::store::reason::UNKNOWN_ROLE, "앨범 멤버가 아닙니다 — get_run의 roles에서 고르세요"))?;
    let artist = inputs
        .artists
        .as_ref()
        .ok()
        .and_then(|a| a.iter().find(|a| a.id == id))
        .ok_or_else(|| error(super::store::reason::UNKNOWN_ROLE, "아티스트 목록에 없습니다 — get_run의 roles에서 고르세요"))?;
    if !crate::orchestration::config::model_ok(&artist.model)
        || !crate::orchestration::config::effort_ok(artist.cli, &artist.effort)
        || artist.instructions.len() > crate::orchestration::config::INSTRUCTIONS_MAX
        || artist.instructions.contains('\0')
    {
        return Err(error(super::store::reason::ROLE_INVALID, "아티스트 프로필이 올바르지 않습니다"));
    }
    let grade = match (artist.kind, member.grade) {
        (RoleKind::Judge, _) => Grade::ReadOnly,
        (RoleKind::Write, MemberGrade::Read) => {
            return Err(error(
                "role-read-only",
                &json!({
                    "hint": "사람에게 [앨범 권한]에서 이 작업형의 등급을 올려 달라고 하세요"
                })
                .to_string(),
            ))
        }
        (RoleKind::Write, MemberGrade::Edit) => Grade::Edit,
        (RoleKind::Write, MemberGrade::Full) => Grade::Full,
    };
    Ok(TurnRole {
        id: id.into(),
        name: artist.name.clone(),
        kind: if artist.kind == RoleKind::Write {
            AttemptKind::Write
        } else {
            AttemptKind::Judge
        },
        cli: if artist.cli == RoleCli::Claude {
            WorkerCli::Claude
        } else {
            WorkerCli::Codex
        },
        grade,
        model: (!artist.model.trim().is_empty()).then(|| artist.model.clone()),
        effort: (!artist.effort.trim().is_empty()).then(|| artist.effort.clone()),
        allowed_commands: if artist.kind == RoleKind::Write {
            member.allowed_commands.clone()
        } else {
            Vec::new()
        },
        instructions: (!artist.instructions.trim().is_empty()).then(|| artist.instructions.clone()),
    })
}

pub(crate) fn role_for_turn(run: &Run, inputs: &AlbumInputs, attempt: &Attempt) -> Result<TurnRole, OrchError> {
    let album = gate(run, inputs)?;
    let id = attempt
        .role_id
        .as_deref()
        .ok_or_else(|| error(super::store::reason::ROLE_REMOVED, "시도의 아티스트가 없습니다"))?;
    let artist = inputs.artists.as_ref().ok().and_then(|a| a.iter().find(|a| a.id == id));
    if !album.members.iter().any(|m| m.artist == id) || artist.is_none() {
        return Err(error(
            "role-removed",
            "앨범 멤버 또는 아티스트가 빠졌습니다 — 새 역할로 시도를 만드세요",
        ));
    }
    let artist = artist.unwrap();
    let kind = if artist.kind == RoleKind::Write {
        AttemptKind::Write
    } else {
        AttemptKind::Judge
    };
    let cli = if artist.cli == RoleCli::Claude {
        WorkerCli::Claude
    } else {
        WorkerCli::Codex
    };
    if Some(kind) != attempt.kind || cli != attempt.cli {
        return Err(error(super::store::reason::ROLE_CHANGED, "시작 때와 CLI 또는 종류가 달라졌습니다 — 새 시도를 만드세요"));
    }
    pick_role(run, inputs, id)
}

/// 무인 실행 권한은 지금 구성과 신원만 본다. 명령은 Run에 고정되어 있다.
pub(crate) fn unattended(run: &Run, inputs: &AlbumInputs) -> Result<(), OrchError> {
    let album = gate(run, inputs)?;
    if run.verify.as_ref().is_none_or(|v| v.command.is_empty()) {
        return Err(error("no-verify-command", "검증 명령이 없습니다"));
    }
    if !album.verify_auto {
        return Err(error("confirm-required", "검증은 사람 확인이 필요합니다"));
    }
    Ok(())
}

fn unmet(run: &Run, task: &Task, album: &AlbumConfig) -> (Vec<roles::Unmet>, Vec<String>) {
    roles::accept_rules_for(run, task, &album.accept, |id| {
        album.members.iter().find(|m| m.artist == id).map(|m| m.name.clone())
    })
}

pub(crate) fn accept_gate(run: &Run, inputs: &AlbumInputs, task: &Task, by: Reviewer) -> Result<AcceptGate, OrchError> {
    let album = gate(run, inputs)?;
    if by == Reviewer::Coordinator && task.review.active.is_some() {
        return Err(error(super::store::reason::REVIEW_PENDING, "아직 판정 중입니다"));
    }
    let (unmet, judgments) = unmet(run, task, album);
    if by == Reviewer::Coordinator && !unmet.is_empty() {
        let left = run.limits.max_reviews.saturating_sub(run.review_count() as u32);
        return Err(error(
            "accept-rule-unmet",
            &json!({
                "unmet": unmet.iter().map(roles::Unmet::to_json).collect::<Vec<_>>(),
                "reviewsLeft": left,
                "hint": if left == 0 { "사람에게 수락 또는 앨범 권한 확인을 요청하세요".into() }
                    else { format!("spawn_worker role={}", unmet[0].role) },
            })
            .to_string(),
        ));
    }
    Ok(AcceptGate {
        judgments,
        waived: unmet
            .iter()
            .map(|u| Waiver {
                rule: "judgment".into(),
                role: Some(u.role.clone()),
                role_name: u.role_name.clone(),
                need: u.need,
                have: u.have,
            })
            .collect(),
        drop_active: task.review.active.is_some(),
    })
}

impl RunInputs {
    fn album<'a>(&'a self, run: &Run) -> Result<&'a AlbumInputs, OrchError> {
        match (run.album.is_some(), self) {
            (true, Self::Album(a)) => Ok(a),
            _ => Err(error("repo-changed", "앨범 판정 원천을 확인할 수 없습니다")),
        }
    }

    pub(crate) fn gate(&self, run: &Run) -> Result<(), OrchError> {
        gate(run, self.album(run)?).map(|_| ())
    }
    pub(crate) fn pick_role(&self, run: &Run, id: &str) -> Result<TurnRole, OrchError> {
        pick_role(run, self.album(run)?, id)
    }
    pub(crate) fn role_for_turn(&self, run: &Run, a: &Attempt) -> Result<TurnRole, OrchError> {
        role_for_turn(run, self.album(run)?, a)
    }
    pub(crate) fn turn_minutes(&self, run: &Run) -> Result<u32, OrchError> {
        self.gate(run)?;
        Ok(run.limits.turn_minutes)
    }
    pub(crate) fn max_reviews(&self, run: &Run) -> u32 {
        if run.album.is_some() { run.limits.max_reviews } else { 0 }
    }
    pub(crate) fn rework_check(&self, run: &Run, task: &Task) -> Result<(), OrchError> {
        let max = gate(run, self.album(run)?)?.accept.max_rework;
        if task.rework_count > max {
            return Err(error(super::store::reason::REWORK_LIMIT, &json!({"used": task.rework_count, "max": max}).to_string()));
        }
        Ok(())
    }
    pub(crate) fn accept_gate(&self, run: &Run, task: &Task, by: Reviewer) -> Result<AcceptGate, OrchError> {
        accept_gate(run, self.album(run)?, task, by)
    }
    /// 보기 재료만 갱신한다. 신원은 앨범 시작 때 고정한다.
    pub(super) fn remember(&self, slot: &mut Slot) {
        slot.inputs_seen = Some(self.clone());
    }
}

impl Orchestration {
    #[cfg(test)]
    pub(crate) fn set_album_source(&self, source: AlbumSource) {
        *self.album_source.write().unwrap_or_else(|e| e.into_inner()) = source;
    }

    /// Run에서 경로만 복제한 뒤 잠금을 놓고 파일 · git을 읽는다.
    pub(crate) fn album_inputs(&self, run_id: &str) -> AlbumInputs {
        let repo = self.lock().runs.get(run_id).map(|s| s.run.repo.clone());
        let source = self.album_source.read().unwrap_or_else(|e| e.into_inner()).clone();
        match repo {
            Some(repo) => source(&repo),
            None => AlbumInputs {
                identity: Err(IdentityError::Missing),
                artists: Err("Run 없음".into()),
            },
        }
    }

    pub(super) fn run_inputs(&self, run_id: &str) -> RunInputs {
        RunInputs::Album(self.album_inputs(run_id))
    }

    /// 앨범 검증의 효과 직전 확인. 사람 승인도 신원을 생략하지 않는다.
    pub(super) fn album_verify_preflight(&self, run_id: &str, auto: bool) -> Result<(), &'static str> {
        let inputs = self.album_inputs(run_id);
        let g = self.lock();
        let run = &g.runs.get(run_id).ok_or("repo-changed")?.run;
        if auto {
            unattended(run, &inputs).map_err(|e| e.code)
        } else {
            gate(run, &inputs).map(|_| ()).map_err(|e| e.code)
        }
    }

    /// 귀속된 앨범의 정책 또는 거절. 귀속 기록이 없으면 None이며 호출부에서 실행을 거절한다.
    pub(crate) fn album_producer_policy(&self, chat: &str) -> Option<Result<(String, bool, u32), OrchError>> {
        let id = {
            let g = self.lock();
            let id = g.producer_ever.get(chat)?.clone();
            match g.runs.get(&id) {
                Some(_) => id,
                None => return Some(Err(error("run-ended", "귀속된 앨범을 읽을 수 없습니다"))),
            }
        };
        let inputs = self.album_inputs(&id);
        let g = self.lock();
        Some(
            g.runs
                .get(&id)
                .ok_or_else(|| error("repo-changed", "앨범이 없습니다"))
                .and_then(|s| {
                    let album = gate(&s.run, &inputs)?;
                    if !s.run.state.active() {
                        return Err(error("run-ended", "끝난 앨범입니다"));
                    }
                    Ok((s.run.repo.clone(), album.plan_tools, album.wake_max))
                }),
        )
    }
}

/// 앨범 보기. 프로필은 지금 값, 이름 사본은 목록에서 빠진 멤버의 보기용이다.
pub(crate) fn roles_view(run: &Run, inputs: Option<&RunInputs>) -> Value {
    let Some(album) = &run.album else { return json!([]) };
    let artists = match inputs {
        Some(RunInputs::Album(i)) => i.artists.as_ref().ok(),
        _ => None,
    };
    json!(album
        .members
        .iter()
        .map(|m| {
            let a = artists.and_then(|a| a.iter().find(|a| a.id == m.artist));
            let usable = match inputs {
                Some(RunInputs::Album(i)) => pick_role(run, i, &m.artist),
                _ => Err(error(super::store::reason::ROLE_INVALID, "판정 원천 없음")),
            };
            json!({"id": m.artist, "name": a.map(|a| &a.name).unwrap_or(&m.name),
            "kind": a.map(|a| a.kind.as_str()), "cli": a.map(|a| a.cli.as_str()),
            "model": a.map(|a| &a.model), "effort": a.map(|a| &a.effort),
            "permission": if a.is_some_and(|a| a.kind == RoleKind::Judge) { "read-only" }
                else { match m.grade { MemberGrade::Read => "read", MemberGrade::Edit => "edit", MemberGrade::Full => "full" } },
            "allowedCommands": m.allowed_commands.len(), "instructionsLen": a.map_or(0, |a| a.instructions.len()),
            "usable": usable.is_ok(), "unusableReason": usable.err().map(|e| e.code)})
        })
        .collect::<Vec<_>>())
}

/// 수락 규칙 보기의 낱말도 기존 get_run과 같다. 이름만 지금 프로필에서 보충한다.
pub(crate) fn accept_rules_view(run: &Run, inputs: Option<&RunInputs>) -> Value {
    let Some(album) = &run.album else { return Value::Null };
    let artists = match inputs {
        Some(RunInputs::Album(i)) => i.artists.as_ref().ok(),
        _ => None,
    };
    json!({"require": album.accept.require.iter().map(|q| json!({
        "role": q.role, "passes": q.passes,
        "roleName": artists.and_then(|a| a.iter().find(|a| a.id == q.role)).map(|a| a.name.clone())
            .or_else(|| album.members.iter().find(|m| m.artist == q.role).map(|m| m.name.clone())),
    })).collect::<Vec<_>>(), "maxRework": album.accept.max_rework})
}

pub(crate) fn readiness(run: &Run, task: &Task, inputs: Option<&RunInputs>) -> Value {
    match inputs {
        Some(i) => match i.accept_gate(run, task, Reviewer::Coordinator) {
            Ok(_) => json!({"ok": true, "unmet": []}),
            Err(e) => json!({"ok": false, "reason": e.code,
                "unmet": serde_json::from_str::<Value>(&e.message).ok().and_then(|v| v.get("unmet").cloned()).unwrap_or(json!([]))}),
        },
        None => json!({"ok": false, "reason": "role-invalid", "unmet": []}),
    }
}
