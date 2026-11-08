//! 시험의 앨범 구성과 아티스트 목록. 실제 설정 파일은 읽지 않는다.
use super::album::AlbumInputs;
use super::artists::Artist;
use super::config::*;
use super::model::*;
use super::repo_identity::RepoIdentity;
use super::store::Orchestration;
use std::sync::{Arc, Mutex};
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum RolePermission {
    Edit,
    Full,
    ReadOnly,
}
pub(crate) const WRITER: &str = "a-000000a1";
pub(crate) const WRITER_CODEX: &str = "a-000000a2";
pub(crate) const WRITER_FULL: &str = "a-000000a3";
pub(crate) const JUDGE: &str = "a-000000b1";
pub(crate) const JUDGE_CODEX: &str = "a-000000b2";
pub(crate) const GIT_DIR: &str = "c:/test-repo/.git";
pub(crate) const REPO_ID: &str = "fixture-repo";

#[derive(Clone)]
pub(crate) struct Role {
    pub id: String,
    pub name: String,
    pub kind: Option<RoleKind>,
    pub cli: Option<RoleCli>,
    pub model: String,
    pub effort: String,
    pub permission: Option<RolePermission>,
    pub allowed_commands: Vec<String>,
    pub instructions: String,
}

#[derive(Clone)]
pub(crate) struct RoleSet {
    pub roles: Vec<Role>,
    pub accept: AcceptRules,
    pub limits: Limits,
}
#[derive(Clone)]
pub(crate) struct Verify {
    pub command: String,
}
#[derive(Clone)]
pub(crate) struct Fixture {
    pub set: RoleSet,
    pub verify: Verify,
}
pub(crate) fn role(
    id: &str,
    name: &str,
    kind: RoleKind,
    cli: RoleCli,
    permission: RolePermission,
) -> Role {
    Role {
        id: id.into(),
        name: name.into(),
        kind: Some(kind),
        cli: Some(cli),
        permission: Some(permission),
        model: String::new(),
        effort: String::new(),
        allowed_commands: vec!["npm test".into()],
        instructions: String::new(),
    }
}
pub(crate) fn default_roles() -> Vec<Role> {
    vec![
        role(
            WRITER,
            "구현",
            RoleKind::Write,
            RoleCli::Claude,
            RolePermission::Edit,
        ),
        role(
            WRITER_CODEX,
            "구현",
            RoleKind::Write,
            RoleCli::Codex,
            RolePermission::Edit,
        ),
        role(
            WRITER_FULL,
            "구현",
            RoleKind::Write,
            RoleCli::Claude,
            RolePermission::Full,
        ),
        role(
            JUDGE,
            "검토",
            RoleKind::Judge,
            RoleCli::Claude,
            RolePermission::ReadOnly,
        ),
        role(
            JUDGE_CODEX,
            "검토",
            RoleKind::Judge,
            RoleCli::Codex,
            RolePermission::ReadOnly,
        ),
    ]
}
pub(crate) fn block(
    _: &str,
    roles: Vec<Role>,
    require: Vec<(&str, u32)>,
    verify: Option<&str>,
) -> Fixture {
    Fixture {
        set: RoleSet {
            roles,
            accept: AcceptRules {
                require: require
                    .into_iter()
                    .map(|(role, passes)| AcceptRule {
                        role: role.into(),
                        passes,
                    })
                    .collect(),
                max_rework: 3,
            },
            limits: Limits::default(),
        },
        verify: Verify {
            command: verify.unwrap_or_default().into(),
        },
    }
}
pub(crate) fn active(f: Fixture) -> Fixture {
    f
}
#[derive(Clone)]
pub(crate) struct Shared(pub Arc<Mutex<Fixture>>);
pub(crate) fn delegate_all(o: &Orchestration) -> Shared {
    delegate_with(o, block("", default_roles(), vec![], None))
}
pub(crate) fn delegate_with(o: &Orchestration, f: Fixture) -> Shared {
    let config = AlbumConfig {
        rev: 1,
        members: f
            .set
            .roles
            .iter()
            .map(|r| AlbumMember {
                artist: r.id.clone(),
                name: r.name.clone(),
                grade: match r.permission {
                    Some(RolePermission::Full) => MemberGrade::Full,
                    Some(RolePermission::Edit) if r.kind == Some(RoleKind::Write) => {
                        MemberGrade::Edit
                    }
                    _ => MemberGrade::Read,
                },
                allowed_commands: if r.kind == Some(RoleKind::Write) {
                    r.allowed_commands.clone()
                } else {
                    vec![]
                },
                joined_rev: 1,
            })
            .collect(),
        accept: f.set.accept.clone(),
        verify_auto: !f.verify.command.is_empty(),
        plan_tools: false,
        wake_max: 30,
        risk_confirmed_at: Some(1),
        changed_at: 1,
        auto_merge: false,
    };
    *o.test_config.lock().unwrap() = Some(config);
    let shared = Shared(Arc::new(Mutex::new(f)));
    let src = shared.clone();
    o.set_album_source(Arc::new(move |_| AlbumInputs {
        identity: Ok(RepoIdentity {
            git_dir: GIT_DIR.into(),
            repo_id: Some(REPO_ID.into()),
        }),
        artists: Ok(src
            .0
            .lock()
            .unwrap()
            .set
            .roles
            .iter()
            .map(|r| Artist {
                id: r.id.clone(),
                name: r.name.clone(),
                icon: String::new(),
                kind: r.kind.unwrap(),
                cli: r.cli.unwrap(),
                model: r.model.clone(),
                effort: r.effort.clone(),
                instructions: r.instructions.clone(),
            })
            .collect()),
    }));
    shared
}
