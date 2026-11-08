//! 사람의 앨범 권한 · 이름 변경. 파일 읽기는 잠금 밖, rev 비교부터 장부 · 저장 요청 · 이벤트까지 한 잠금이다.

use serde::Deserialize;
use serde_json::{json, Value};

use super::album::{widens, RunInputs};
use super::album_start::{member_shape, MemberInput};
use super::model::*;
use super::store::{human_slot, state_error, OrchError, Orchestration};
use crate::audit::{AuditAlbumMember, OrchestrationAudit};
use crate::orchestration::config::{self as repo, AcceptRules, RoleKind};

/// 부분 패치가 아니다. 검증 글자 · 한도 · 서버 메타데이터는 이 몸에 들어올 수 없다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AlbumNext {
    pub members: Vec<MemberInput>,
    pub accept: AcceptRules,
    pub verify_auto: bool,
    pub plan_tools: bool,
    pub wake_max: u32,
    /// 칸 없음 = 꺼짐(켜진 값만 싣는다 — 판 26 서버의 `deny_unknown_fields` 가 새 칸을 거절하지 않게).
    #[serde(default)]
    pub auto_merge: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetBody {
    run_id: String,
    expect_rev: u32,
    next: AlbumNext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WidenBody {
    run_id: String,
    expect_rev: u32,
    next: AlbumNext,
    risk_confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameBody {
    run_id: String,
    name: String,
}

fn bad(text: &str) -> OrchError {
    OrchError::new("bad-args", text)
}

fn body<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, OrchError> {
    serde_json::from_value(value).map_err(|_| bad("앨범 변경 몸이 올바르지 않습니다"))
}

/// 사람 op 전용 입구. MCP 도구에는 등록하지 않는다.
pub(crate) fn handle(op: &str, value: Value, o: &Orchestration) -> Result<Value, OrchError> {
    match op {
        "orchestration_album_set" => {
            let b: SetBody = body(value)?;
            o.change_album(&b.run_id, b.expect_rev, b.next, false, false)
        }
        "orchestration_album_widen" => {
            let b: WidenBody = body(value)?;
            o.change_album(&b.run_id, b.expect_rev, b.next, true, b.risk_confirmed)
        }
        "orchestration_rename_album" => {
            let b: RenameBody = body(value)?;
            o.rename_album(&b.run_id, &b.name)
        }
        _ => Err(bad("모르는 앨범 변경 명령입니다")),
    }
}

impl Orchestration {
    fn change_album(&self, id: &str, expect_rev: u32, next: AlbumNext, allow_widen: bool, confirmed: bool) -> Result<Value, OrchError> {
        let inputs = self.album_inputs(id);
        let now = self.now();
        let (result, audit) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, id)?;
            let run = &mut slot.run;
            if !run.state.active() {
                return Err(state_error(run.state));
            }
            let old = run.album.as_ref().ok_or_else(|| bad("앨범 구성이 없습니다"))?;
            if expect_rev != old.rev {
                return Err(OrchError::new("album-changed", "앨범 권한이 바뀌었습니다 — 다시 읽고 적용하세요"));
            }
            if next.members.len() > repo::ROLES_MAX || next.wake_max > 200 || next.accept.max_rework > repo::REWORK_MAX {
                return Err(bad("앨범 멤버 · 깨움 · 되돌림 한도가 올바르지 않습니다"));
            }
            if (next.verify_auto || next.auto_merge) && run.verify.as_ref().is_none_or(|v| v.command.is_empty()) {
                return Err(OrchError::new("no-verify-command", "검증 명령이 없는 앨범입니다"));
            }
            let artists = inputs.artists.as_ref().map_err(|_| bad("아티스트 목록을 읽을 수 없습니다"))?;
            let rev = old.rev.checked_add(1).ok_or_else(|| bad("앨범 구성 판이 상한에 닿았습니다"))?;
            let mut members = member_shape(&next.members, &next.accept)?;
            for m in &mut members {
                let a = artists
                    .iter()
                    .find(|a| a.id == m.artist)
                    .ok_or_else(|| OrchError::new("unknown-role", "목록에 없는 아티스트입니다"))?;
                if a.kind == RoleKind::Judge && (m.grade != MemberGrade::Read || !m.allowed_commands.is_empty()) {
                    return Err(bad("판정형은 읽기 전용이어야 합니다"));
                }
                let previous = old.members.iter().find(|p| p.artist == m.artist);
                m.name = previous.map_or_else(|| a.name.clone(), |p| p.name.clone());
                m.joined_rev = previous.map_or(rev, |p| p.joined_rev);
            }
            if next.accept.require.iter().any(|q| {
                !members.iter().any(|m| m.artist == q.role) || !artists.iter().any(|a| a.id == q.role && a.kind == RoleKind::Judge)
            }) {
                return Err(bad("필수 판정은 앨범의 판정형 멤버만 가리킬 수 있습니다"));
            }
            let mut new = AlbumConfig {
                rev,
                members,
                accept: next.accept,
                verify_auto: next.verify_auto,
                plan_tools: next.plan_tools,
                wake_max: next.wake_max,
                risk_confirmed_at: None,
                changed_at: now,
                auto_merge: next.auto_merge,
            };
            let widened = widens(old, &new);
            if widened && !allow_widen {
                return Err(OrchError::new("widens", "앨범 권한 넓히기 재확인이 필요합니다"));
            }
            let risky = new.verify_auto || new.plan_tools || new.auto_merge || new.members.iter().any(|m| m.grade == MemberGrade::Full);
            let new_risk = (!old.verify_auto && new.verify_auto)
                || (!old.plan_tools && new.plan_tools)
                || (!old.auto_merge && new.auto_merge)
                || new.members.iter().any(|m| {
                    m.grade == MemberGrade::Full && !old.members.iter().any(|p| p.artist == m.artist && p.grade == MemberGrade::Full)
                });
            // 이미 확인한 위험을 유지하며 좁히는 _set은 그 확인을 잇는다. 새 위험은 반드시 다시 확인한다.
            if risky && (new_risk || old.risk_confirmed_at.is_none()) && !confirmed {
                return Err(OrchError::new("risk-not-confirmed", "위험 확인이 필요합니다"));
            }
            new.risk_confirmed_at = if !risky {
                None
            } else if confirmed {
                Some(now)
            } else {
                old.risk_confirmed_at
            };
            let audit = change_audit(run.gen, &new, widened);
            run.album = Some(new);
            run.bump(now, Actor::Human, "album_changed", None, &format!("rev {rev}"));
            slot.inputs_seen = Some(RunInputs::Album(inputs));
            let result = json!({"runId": id, "rev": rev, "widened": widened, "latestSeq": slot.run.seq});
            self.after_change(&g, id);
            (result, audit)
        };
        self.audit("album_changed", id, audit);
        Ok(result)
    }

    fn rename_album(&self, id: &str, name: &str) -> Result<Value, OrchError> {
        if !super::album_start::name_ok(name) || name.trim().is_empty() {
            return Err(bad("앨범 이름은 제어 문자 없이 1~80자여야 합니다"));
        }
        let now = self.now();
        let mut g = self.lock();
        let slot = human_slot(&mut g, id)?;
        if !slot.run.state.active() {
            return Err(state_error(slot.run.state));
        }
        if slot.run.album.is_none() {
            return Err(bad("앨범 구성이 없습니다"));
        }
        slot.run.name = name.trim().into();
        slot.run.bump(now, Actor::Human, "album_renamed", None, "renamed");
        let result = json!({"runId": id, "name": slot.run.name, "latestSeq": slot.run.seq});
        self.after_change(&g, id);
        Ok(result)
    }
}

fn change_audit(gen: u32, album: &AlbumConfig, widened: bool) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: "human".into(),
        rev: Some(album.rev),
        widened: Some(widened),
        members: Some(
            album
                .members
                .iter()
                .map(|m| AuditAlbumMember {
                    artist: m.artist.clone(),
                    grade: match m.grade {
                        MemberGrade::Read => "read",
                        MemberGrade::Edit => "edit",
                        MemberGrade::Full => "full",
                    }
                    .into(),
                })
                .collect(),
        ),
        allowed_commands: Some(album.members.iter().map(|m| m.allowed_commands.len() as u32).sum()),
        verify_auto: Some(album.verify_auto),
        plan_tools: Some(album.plan_tools),
        auto_merge: Some(album.auto_merge),
        wake_max: Some(album.wake_max),
        ..Default::default()
    }
}
