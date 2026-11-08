//! 사람이 첫 말로 여는 앨범(설계 3-1). 파일 · git은 잠금 밖, Run · 묶음 · 귀속만 한 잠금에서 확정한다.

use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};

use super::album::AlbumInputs;
use super::artists::Artists;
pub(crate) use super::model::ProducerConfig;
use super::model::*;
pub(crate) use super::store::StartRun;
use super::store::{OrchError, Orchestration, Seat};
use super::verify::{validate_input, VerifyInput};
use crate::orchestration::config::{self as repo, AcceptRules, RoleKind};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MemberInput {
    pub artist: String,
    pub grade: MemberGrade,
    #[serde(default)]
    pub allowed_commands: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AlbumInput {
    pub members: Vec<MemberInput>,
    pub accept: AcceptRules,
    #[serde(default)]
    pub verify: VerifyInput,
    pub limits: AlbumLimits,
    pub plan_tools: bool,
    pub wake_max: u32,
    pub risk_confirmed: bool,
    /// 완료되면 자동 병합 — 칸 없음 = 꺼짐(켠 값만 싣는다 — 판 26 서버의 `deny_unknown_fields`).
    #[serde(default)]
    pub auto_merge: bool,
}

/// 화면에 있는 다섯 한도만 받는다. 나머지 서버 브레이크는 고정이다.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AlbumLimits {
    pub max_concurrent_workers: u32,
    pub max_total_workers: u32,
    pub coordination_minutes: u32,
    pub turn_minutes: u32,
    pub max_reviews: u32,
}

fn bad(text: &str) -> OrchError {
    OrchError::new("bad-args", text)
}

#[cfg(test)]
thread_local! {
    static FAILURE: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn fail_at(phase: &'static str) {
    FAILURE.with(|f| *f.borrow_mut() = Some(phase));
}

/// 가짜 CLI 시험이 단계 경계마다 끊는다. 제품에서는 빈 함수다.
pub(crate) fn checkpoint(_phase: &str) -> Result<(), OrchError> {
    #[cfg(test)]
    if FAILURE.with(|f| {
        let hit = *f.borrow() == Some(_phase);
        if hit {
            f.borrow_mut().take();
        }
        hit
    }) {
        return Err(OrchError::new("test-failure", "시험에서 시작 걸음을 끊었습니다"));
    }
    Ok(())
}

pub(crate) fn empty_album() -> AlbumConfig {
    AlbumConfig {
        rev: 1,
        members: Vec::new(),
        accept: AcceptRules::default(),
        verify_auto: false,
        plan_tools: false,
        wake_max: 0,
        risk_confirmed_at: None,
        changed_at: 0,
        auto_merge: false,
    }
}

impl AlbumInput {
    /// ① 순수 모양 · 위험 검사. 검증 글자는 이 사람 입력에서만 사본이 된다.
    pub(crate) fn validate(&self, now: u64) -> Result<(AlbumConfig, Limits, Option<VerifyConfig>), OrchError> {
        if self.members.len() > repo::ROLES_MAX || self.wake_max > 200 || self.accept.max_rework > repo::REWORK_MAX {
            return Err(bad("앨범 멤버 · 깨움 · 되돌림 한도가 올바르지 않습니다"));
        }
        let members = member_shape(&self.members, &self.accept)?;
        let l = self.limits;
        for (n, (_, _, max)) in [
            l.max_concurrent_workers,
            l.max_total_workers,
            l.coordination_minutes,
            l.turn_minutes,
            l.max_reviews,
        ]
        .into_iter()
        .zip(repo::LIMIT_TABLE)
        {
            if !(1..=max).contains(&n) {
                return Err(bad("앨범 한도가 범위를 벗어났습니다"));
            }
        }
        let album = AlbumConfig {
            rev: 1,
            members,
            accept: self.accept.clone(),
            verify_auto: self.verify.auto_run,
            plan_tools: self.plan_tools,
            wake_max: self.wake_max,
            risk_confirmed_at: self.risk_confirmed.then_some(now),
            changed_at: now,
            auto_merge: self.auto_merge,
        };
        // 자동 병합의 조건이 "검증 통과" 다 — 검증 명령이 없으면 켤 수 없다(서버 판정 — 화면의 비활성은 거울).
        if album.auto_merge && self.verify.command.trim().is_empty() {
            return Err(OrchError::new("no-verify-command", "자동 병합은 검증 명령이 있어야 켤 수 있습니다"));
        }
        if (album.verify_auto || album.plan_tools || album.auto_merge || album.members.iter().any(|m| m.grade == MemberGrade::Full)) && !self.risk_confirmed {
            return Err(OrchError::new("risk-not-confirmed", "위험 확인이 필요합니다"));
        }
        let verify = validate_input(self.verify.clone(), self.risk_confirmed)?;
        let limits = Limits {
            max_concurrent_workers: l.max_concurrent_workers,
            max_total_workers: l.max_total_workers,
            coordination_minutes: l.coordination_minutes,
            turn_minutes: l.turn_minutes,
            max_reviews: l.max_reviews,
            ..Limits::default()
        };
        Ok((album, limits, verify))
    }
}

/// ⑤에서 만든 ref의 소유자. 확정 전 어느 반환 길로 나가도 ref를 거둔다.
pub(crate) struct PreparedAlbum {
    owner: Arc<Orchestration>,
    pub id: String,
    pub start: StartRun,
    pub integration: Integration,
    pub album: AlbumConfig,
    pub identity: RunDelegation,
    pub inputs: AlbumInputs,
    pub producer: ProducerConfig,
    committed: bool,
}

impl Drop for PreparedAlbum {
    fn drop(&mut self) {
        if !self.committed {
            self.owner.discard_integration(&self.start.repo, &self.integration);
        }
    }
}

impl PreparedAlbum {
    /// ⑦ 채팅 잠금을 놓고 부른다. 생존 · 상한 · 귀속을 확정 잠금에서 다시 본다.
    pub(crate) fn commit(&mut self, seat: &Seat) -> Result<(), OrchError> {
        super::start::before_bind();
        checkpoint("bind")?;
        self.owner
            .start_run_core_with_album(self.start.clone(), self.id.clone(), Some(self.integration.clone()), Some((self, seat)))?;
        self.committed = true;
        Ok(())
    }
}

impl Orchestration {
    pub(crate) fn producer_run(&self, chat: &str) -> Option<String> {
        self.lock().producer_ever.get(chat).cloned()
    }

    pub(crate) fn producer_scope(&self, chat: &str) -> Option<(String, String)> {
        let g = self.lock();
        let id = g.producer_ever.get(chat)?;
        let run = &g.runs.get(id)?.run;
        run.album.as_ref()?;
        Some((id.clone(), run.repo.clone()))
    }

    /// 파일 목록은 시작 · 기본값 · 판정이 같은 원천을 사용한다. 시험은 가짜 원천을 꽂는다.
    pub(crate) fn album_start_inputs(&self, repo: &str) -> AlbumInputs {
        let source = self.album_source.read().unwrap_or_else(|e| e.into_inner()).clone();
        source(repo)
    }

    /// ③~⑤ 서버가 읽은 저장소와 프로필로 구성 사본을 완성하고 통합 ref만 만든다.
    pub(crate) fn prepare_album(self: &Arc<Self>, start: StartRun, mut album: AlbumConfig, producer: ProducerConfig) -> Result<PreparedAlbum, OrchError> {
        let inputs = self.album_start_inputs(&start.repo);
        let identity = inputs.identity.as_ref().map_err(|e| OrchError::new("not-a-repo", e.text()))?;
        checkpoint("identity")?;
        let artists = inputs.artists.as_ref().map_err(|_| bad("아티스트 목록을 읽을 수 없습니다"))?;
        for m in &mut album.members {
            let a = artists
                .iter()
                .find(|a| a.id == m.artist)
                .ok_or_else(|| OrchError::new("unknown-role", "목록에 없는 아티스트입니다"))?;
            if a.kind == RoleKind::Judge && (m.grade != MemberGrade::Read || !m.allowed_commands.is_empty()) {
                return Err(bad("판정형은 읽기 전용이어야 합니다"));
            }
            m.name.clone_from(&a.name);
        }
        if !album
            .members
            .iter()
            .any(|m| m.grade >= MemberGrade::Edit && artists.iter().any(|a| a.id == m.artist && a.kind == RoleKind::Write))
        {
            return Err(OrchError::new("no-usable-artist", "편집 이상 작업형이 하나 필요합니다"));
        }
        if album
            .accept
            .require
            .iter()
            .any(|q| !album.members.iter().any(|m| m.artist == q.role) || !artists.iter().any(|a| a.id == q.role && a.kind == RoleKind::Judge))
        {
            return Err(bad("필수 판정은 앨범의 판정형 멤버만 가리킬 수 있습니다"));
        }
        checkpoint("artists")?;
        if self.lock().runs.values().filter(|s| s.run.state.active()).count() >= MAX_ACTIVE_RUNS {
            return Err(OrchError::new("too-many-runs", "동시 앨범 상한은 2개입니다"));
        }
        let identity = RunDelegation {
            path: start.repo.clone(),
            git_dir: identity.git_dir.clone(),
            repo_id: identity.repo_id.clone(),
            accepted_sha: crate::chat_token::input_sha(&json!(album)),
            at: self.now(),
        };
        let (id, integration) = self.prepare_integration(&start.repo)?;
        let prepared = PreparedAlbum {
            owner: Arc::clone(self),
            id,
            start,
            integration,
            album,
            identity,
            inputs,
            producer,
            committed: false,
        };
        checkpoint("ref")?;
        Ok(prepared)
    }

    /// 이어받기 진입은 귀속만 세운다. 조정자 묶음과 구성은 바꾸지 않는다.
    pub(crate) fn open_adopt(&self, chat: &str, run: &str) -> Result<String, OrchError> {
        let mut g = self.lock();
        if let Some(other) = g.producer_ever.get(chat).filter(|id| *id != run) {
            return Err(OrchError::new("already-produced", json!({"runId": other}).to_string()));
        }
        let slot = g.runs.get_mut(run).ok_or_else(|| OrchError::new("not-found", "앨범이 없습니다"))?;
        if slot.run.album.is_none() || !super::start::adopt_verdict(slot, self.now()).restore {
            return Err(OrchError::new("not-adoptable", "이어받을 수 없는 앨범입니다"));
        }
        if !slot.run.producers.iter().any(|c| c == chat) {
            if slot.run.producers.len() >= PRODUCERS_MAX {
                return Err(OrchError::new("not-adoptable", "프로듀서 귀속 상한입니다"));
            }
            slot.run.producers.push(chat.into());
        }
        let repo = slot.run.repo.clone();
        g.producer_ever.insert(chat.into(), run.into());
        self.after_change(&g, run);
        Ok(repo)
    }

    pub(crate) fn artist_in_use(&self, artist: &str) -> Vec<String> {
        let mut ids: Vec<_> = self
            .lock()
            .runs
            .values()
            .filter(|s| s.run.state.active() && s.run.album.as_ref().is_some_and(|a| a.members.iter().any(|m| m.artist == artist)))
            .map(|s| s.run.id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// 같은 저장소의 최근 구성. 보관함은 잠금 밖에서 읽고 목록에 없는 멤버 · 규칙은 뺀다.
    pub(crate) fn album_defaults(&self, repo: &str) -> Result<Value, OrchError> {
        let artists = self.album_start_inputs(repo).artists.map_err(|_| bad("아티스트 목록을 읽을 수 없습니다"))?;
        let mut runs: Vec<_> = self.lock().runs.values().map(|s| s.run.clone()).collect();
        if let Some(dir) = &self.dir {
            runs.extend(super::persist::load_orphans(&dir.join("archived"), |_, _| {}));
        }
        let latest = runs
            .into_iter()
            .filter(|r| r.album.is_some() && crate::worktree::comparable(&r.repo) == crate::worktree::comparable(repo))
            .max_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        // 화면의 "지난번에 고른 구성" 문구는 같은 저장소의 지난 Run 이 있을 때만(없으면 씨앗 기본).
        let from_last = latest.is_some();
        let (mut album, limits, verify, producer) = match latest {
            Some(r) => (r.album.unwrap(), r.limits, r.verify, r.origin.producer_config),
            None => (default_album(&artists), Limits::default(), None, None),
        };
        album.members.retain(|m| artists.iter().any(|a| a.id == m.artist));
        album
            .accept
            .require
            .retain(|q| album.members.iter().any(|m| m.artist == q.role) && artists.iter().any(|a| a.id == q.role && a.kind == RoleKind::Judge));
        let verify = verify
            .map(|v| {
                json!({"command": v.command, "timeoutMinutes": v.timeout_minutes, "auto": album.verify_auto,
            "keepDirs": v.keep_dirs, "cacheKeyFiles": v.cache_key_files, "extraEnv": v.extra_env_names})
            })
            .unwrap_or(json!({"command": "", "auto": false}));
        Ok(
            json!({"members": album.members.iter().map(|m| json!({"artist": m.artist, "grade": m.grade, "allowedCommands": m.allowed_commands})).collect::<Vec<_>>(),
            "accept": album.accept, "verify": verify,
            "limits": {"maxConcurrentWorkers": limits.max_concurrent_workers, "maxTotalWorkers": limits.max_total_workers,
                "coordinationMinutes": limits.coordination_minutes, "turnMinutes": limits.turn_minutes, "maxReviews": limits.max_reviews},
            "verifyAuto": album.verify_auto, "planTools": album.plan_tools, "wakeMax": album.wake_max, "producer": producer, "fromLast": from_last}),
        )
    }
}

fn default_album(artists: &Artists) -> AlbumConfig {
    let mut a = empty_album();
    for kind in [RoleKind::Write, RoleKind::Judge] {
        if let Some(artist) = artists.iter().find(|a| a.kind == kind) {
            a.members.push(AlbumMember {
                artist: artist.id.clone(),
                name: artist.name.clone(),
                grade: if kind == RoleKind::Write { MemberGrade::Edit } else { MemberGrade::Read },
                allowed_commands: Vec::new(),
                joined_rev: 1,
            });
            if kind == RoleKind::Judge {
                a.accept.require.push(repo::AcceptRule {
                    role: artist.id.clone(),
                    passes: 1,
                });
            }
        }
    }
    a.wake_max = 30;
    a
}

/// git toplevel을 서버가 다시 읽고 주 저장소 신원까지 확인한다(몸의 경로를 실행 cwd로 쓰지 않는다).
pub(crate) fn repository(path: &str) -> Result<String, OrchError> {
    let top = super::repo_toplevel(path).map_err(|_| OrchError::new("not-a-repo", "git 저장소가 아닙니다"))?;
    super::repo_identity::identity_now(Path::new(&top)).map_err(|e| OrchError::new("not-a-repo", e.text()))?;
    Ok(top)
}

/// 시작 · 변경의 공통 모양 검사. 이름 사본은 지금 아티스트 목록으로 채운다.
pub(super) fn member_shape(members_input: &[MemberInput], accept: &AcceptRules) -> Result<Vec<AlbumMember>, OrchError> {
    let mut members: Vec<AlbumMember> = Vec::new();
    for m in members_input {
        if !super::artists::id_ok(&m.artist)
            || members.iter().any(|x| x.artist == m.artist)
            || m.allowed_commands.len() > repo::ALLOWED_MAX
            || m.allowed_commands
                .iter()
                .any(|c| c.trim().is_empty() || c.chars().count() > repo::ALLOWED_LEN_MAX || c.chars().any(char::is_control) || c.contains(['(', ')', '*']))
        {
            return Err(bad("멤버 또는 허용 명령이 올바르지 않습니다"));
        }
        members.push(AlbumMember {
            artist: m.artist.clone(),
            name: String::new(),
            grade: m.grade,
            allowed_commands: m.allowed_commands.clone(),
            joined_rev: 1,
        });
    }
    let mut seen = std::collections::HashSet::new();
    if accept
        .require
        .iter()
        .any(|q| !(1..=repo::PASSES_MAX).contains(&q.passes) || !seen.insert(&q.role))
    {
        return Err(bad("필수 판정 규칙이 올바르지 않습니다"));
    }
    Ok(members)
}

/// 앨범 시작 · 이름 변경의 공통 규칙. 시작에서만 빈 이름을 첫 말로 채운다.
pub(crate) fn name_ok(name: &str) -> bool {
    name.chars().count() <= 80 && !name.chars().any(char::is_control)
}
