//! S2 — 앨범 판정 원천의 계약. 실행 손은 장부만 받는 가짜이며 AI CLI는 띄우지 않는다.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::album::{self, AlbumInputs, RunInputs};
use super::artists::Artist;
use super::model::*;
use super::spawn::{LaunchJob, WorkerLauncher};
use super::store::*;
use super::test_album as td;
use super::turn::Grade;
use crate::orchestration::config::{AcceptRule, AcceptRules, RoleCli, RoleKind};
use super::repo_identity::{IdentityError, RepoIdentity};

const WRITE: &str = "a-00000001";
const JUDGE: &str = "a-00000002";

fn member(id: &str, grade: MemberGrade) -> AlbumMember {
    AlbumMember {
        artist: id.into(),
        name: id.into(),
        grade,
        allowed_commands: Vec::new(),
        joined_rev: 1,
    }
}

fn config() -> AlbumConfig {
    AlbumConfig {
        rev: 1,
        members: vec![member(WRITE, MemberGrade::Edit), member(JUDGE, MemberGrade::Read)],
        accept: AcceptRules::default(),
        verify_auto: false,
        plan_tools: false,
        wake_max: 30,
        risk_confirmed_at: Some(1),
        changed_at: 1,
        auto_merge: false,
    }
}

fn inputs() -> AlbumInputs {
    AlbumInputs {
        identity: Ok(RepoIdentity {
            git_dir: td::GIT_DIR.into(),
            repo_id: Some(td::REPO_ID.into()),
        }),
        artists: Ok([(WRITE, RoleKind::Write), (JUDGE, RoleKind::Judge)]
            .into_iter()
            .map(|(id, kind)| Artist {
                id: id.into(),
                name: format!("현재 {id}"),
                icon: "claude".into(),
                cli: RoleCli::Claude,
                kind,
                model: "sonnet".into(),
                effort: "high".into(),
                instructions: "지금 지침".into(),
            })
            .collect()),
    }
}

struct Fake(mpsc::Sender<LaunchJob>);
impl WorkerLauncher for Fake {
    fn launch(&self, job: LaunchJob) {
        self.0.send(job).unwrap();
    }
    fn stop(&self, _: &str, _: &str) {}
    fn tree_gone(&self, _: &str) -> bool {
        true
    }
}

struct H {
    o: Orchestration,
    id: String,
    caller: Caller,
    task: String,
    source: Arc<Mutex<AlbumInputs>>,
    jobs: mpsc::Receiver<LaunchJob>,
}

fn harness() -> H {
    harness_observed(None, Arc::new(|_, _| {}), None)
}

fn harness_observed(dir: Option<std::path::PathBuf>, emit: EmitFn, audit: Option<mpsc::Sender<crate::audit::AuditRecord>>) -> H {
    harness_with_clock(dir, emit, audit, Arc::new(|| 1_000_000))
}

fn harness_with_clock(dir: Option<std::path::PathBuf>, emit: EmitFn, audit: Option<mpsc::Sender<crate::audit::AuditRecord>>, clock: Clock) -> H {
    let o = Orchestration::with_clock(dir, emit, audit, clock);
    o.set_ephemeral(true);
    td::delegate_all(&o);
    let (id, _) = o
        .start_run(StartRun {
            name: "앨범 시험".into(),
            repo: "C:/repo".into(),
            worktree_dir: "C:/repo-wt".into(),
            limits: Limits::default(),
            verify: None,
        })
        .unwrap();
    {
        let mut g = o.lock();
        let run = &mut g.runs.get_mut(&id).unwrap().run;
        run.album = Some(config());
        run.limits.turn_minutes = 73;
        run.limits.max_reviews = 2;
        run.producers = vec!["pc-album-test".into()];
        g.producer_ever.insert("pc-album-test".into(), id.clone());
    }
    o.bind_coordinator(&id, 1, "pc-album-test").unwrap();
    let caller = o.coordinator_caller(&id).unwrap();
    let source = Arc::new(Mutex::new(inputs()));
    let s = source.clone();
    o.set_album_source(Arc::new(move |_| s.lock().unwrap().clone()));
    // 넓은 맡기기여도 앨범 판정에서는 한 번도 읽으면 안 된다.
    let (tx, jobs) = mpsc::channel();
    o.set_launcher(Arc::new(Fake(tx)));
    o.set_turn_start_wait_ms(0);
    let task = o
        .call_tool(
            &caller,
            "create_task",
            Some(&json!({"requestId": "task", "title": "트랙", "goal": "작업"})),
        )
        .unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    H {
        o,
        id,
        caller,
        task,
        source,
        jobs,
    }
}

impl H {
    fn run(&self) -> Run {
        self.o.lock().runs[&self.id].run.clone()
    }
    fn edit(&self, f: impl FnOnce(&mut Run)) {
        f(&mut self.o.lock().runs.get_mut(&self.id).unwrap().run);
    }
    fn call(&self, tool: &str, args: Value) -> Result<Value, String> {
        self.o.call_tool(&self.caller, tool, Some(&args))
    }
    fn spawn(&self, role: &str, req: &str) -> Result<Value, String> {
        self.call("spawn_worker", json!({"requestId": req, "taskId": self.task, "role": role}))
    }
    fn job(&self) -> LaunchJob {
        self.jobs.recv_timeout(Duration::from_secs(3)).unwrap()
    }
    fn idle(&self, id: &str) {
        self.edit(|r| {
            let a = r.attempts.iter_mut().find(|a| a.id == id).unwrap();
            a.state = AttemptState::Idle;
            a.worktree = Some("C:/repo-wt/task".into());
            a.branch = Some("task".into());
            a.base_commit = Some("a".repeat(40));
            a.conversation_id = Some("11111111-1111-4111-8111-111111111111".into());
        });
    }
    fn resume(&self, id: &str, req: &str) -> Result<Value, String> {
        self.call("send_prompt", json!({"requestId": req, "attemptId": id, "text": "이어 하기"}))
    }
    fn reported(&self) -> String {
        let a = self.spawn(WRITE, "writer").unwrap()["attemptId"].as_str().unwrap().to_string();
        self.job();
        let report = new_id("rep").unwrap();
        self.edit(|r| {
            r.attempts.iter_mut().find(|x| x.id == a).unwrap().state = AttemptState::Reported;
            r.tasks[0].state = TaskState::Reported;
            r.reports.push(
                serde_json::from_value(json!({"reportId": report, "attemptId": a,
                "taskId": self.task, "outcome": "success", "summary": "완료", "dirty": false,
                "commitOid": "b".repeat(40), "baseCommitOid": "a".repeat(40), "at": 1}))
                .unwrap(),
            );
        });
        report
    }
    fn finish_judge(&self, id: &str, report: &str, verdict: ReviewVerdict) {
        self.edit(|r| {
            r.attempts.iter_mut().find(|a| a.id == id).unwrap().state = AttemptState::Reported;
            r.tasks[0].review.active = None;
            r.review_reports.push(ReviewReport {
                review_id: new_id("rev").unwrap(),
                attempt_id: id.into(),
                task_id: self.task.clone(),
                report_id: report.into(),
                commit_oid: "b".repeat(40),
                verdict,
                findings: Vec::new(),
                summary: "판정".into(),
                at: 1,
                state: ReviewReportState::Current,
            });
        });
    }
}

fn code<T: std::fmt::Debug>(result: Result<T, String>) -> String {
    result.unwrap_err().split(':').next().unwrap().to_string()
}

#[test]
fn album_widen_table() {
    // 2-3의 여덟 줄과 그 줄 안의 개별 변경을 각각 확인한다.
    let mut old = config();
    old.accept.require.push(AcceptRule {
        role: JUDGE.into(),
        passes: 2,
    });
    old.members[0].allowed_commands = vec!["cargo test".into()];
    type Change = (&'static str, bool, fn(&mut AlbumConfig));
    let cases: &[Change] = &[
        ("등급 올림", true, |a| a.members[0].grade = MemberGrade::Full),
        ("작업형 편집 들이기", true, |a| {
            a.members.push(member("a-00000003", MemberGrade::Edit))
        }),
        ("자동 검증", true, |a| a.verify_auto = true),
        ("명령 추가", true, |a| a.members[0].allowed_commands.push("cargo check".into())),
        ("작업안 도구", true, |a| a.plan_tools = true),
        ("자동 병합", true, |a| a.auto_merge = true),
        ("깨움 올림", true, |a| a.wake_max += 1),
        ("필수 판정 빼기", true, |a| a.accept.require.clear()),
        ("pass 내림", true, |a| a.accept.require[0].passes = 1),
        ("되돌림 올림", true, |a| a.accept.max_rework += 1),
        ("등급 내림", false, |a| a.members[0].grade = MemberGrade::Read),
        ("멤버 빼기", false, |a| {
            a.members.remove(0);
        }),
        ("명령 지우기", false, |a| a.members[0].allowed_commands.clear()),
        ("깨움 내림", false, |a| a.wake_max -= 1),
        ("수락 강화", false, |a| a.accept.require[0].passes = 3),
        ("되돌림 내림", false, |a| a.accept.max_rework -= 1),
        ("판정형 들이기", false, |a| {
            a.members.push(member("a-00000004", MemberGrade::Read))
        }),
        ("작업형 읽기 들이기", false, |a| {
            a.members.push(member("a-00000003", MemberGrade::Read))
        }),
        ("판 메타데이터", false, |a| {
            a.rev += 1;
            a.changed_at += 1;
        }),
    ];
    for (name, want, change) in cases {
        let mut new = old.clone();
        change(&mut new);
        assert_eq!(album::widens(&old, &new), *want, "{name}");
    }
    for (name, change) in [
        (
            "자동 검증 끔",
            (|a: &mut AlbumConfig| a.verify_auto = false) as fn(&mut AlbumConfig),
        ),
        ("작업안 끔", |a: &mut AlbumConfig| a.plan_tools = false),
    ] {
        let mut old = old.clone();
        old.verify_auto = true;
        old.plan_tools = true;
        let mut new = old.clone();
        change(&mut new);
        assert!(!album::widens(&old, &new), "{name}");
    }
}

#[test]
fn album_judge_spawn_grade_and_profiles() {
    for (grade, want) in [(MemberGrade::Edit, Grade::Edit), (MemberGrade::Full, Grade::Full)] {
        let h = harness();
        h.edit(|r| {
            let a = r.album.as_mut().unwrap();
            a.members[0].grade = grade;
            a.members[0].allowed_commands = vec!["cargo test".into()];
        });
        h.spawn(WRITE, "spawn").unwrap();
        let job = h.job();
        assert_eq!(job.turn.role.grade, want);
        assert_eq!(job.turn.role.allowed_commands, ["cargo test"]);
        assert_eq!(job.turn.role.model.as_deref(), Some("sonnet"));
        assert_eq!(job.turn.role.effort.as_deref(), Some("high"));
        assert_eq!(job.turn.role.instructions.as_deref(), Some("지금 지침"));
        assert_eq!(job.turn.turn_minutes, 73);
    }
}

#[test]
fn album_judge_read_only_unknown_role() {
    let h = harness();
    h.edit(|r| r.album.as_mut().unwrap().members[0].grade = MemberGrade::Read);
    let e = h.spawn(WRITE, "read").unwrap_err();
    assert!(e.starts_with("role-read-only:"));
    assert!(e.contains("hint"));
    assert_eq!(code(h.spawn(td::WRITER_FULL, "legacy")), "unknown-role");
    assert!(h.run().attempts.is_empty());
    assert!(h.jobs.try_recv().is_err());
}

#[test]
fn album_judge_role_changed_removed_and_invalid() {
    let h = harness();
    let a = h.spawn(WRITE, "spawn").unwrap()["attemptId"].as_str().unwrap().to_string();
    h.job();
    h.idle(&a);
    h.source.lock().unwrap().artists.as_mut().unwrap()[0].cli = RoleCli::Codex;
    assert_eq!(code(h.resume(&a, "cli")), "role-changed");
    assert_eq!(h.o.turn_preflight(&h.id, &a).unwrap_err().code, "role-changed");
    *h.source.lock().unwrap() = inputs();
    h.source.lock().unwrap().artists.as_mut().unwrap()[0].kind = RoleKind::Judge;
    assert_eq!(code(h.resume(&a, "kind")), "role-changed");
    *h.source.lock().unwrap() = inputs();
    h.source.lock().unwrap().artists.as_mut().unwrap().remove(0);
    assert_eq!(code(h.resume(&a, "missing")), "role-removed");
    *h.source.lock().unwrap() = inputs();
    h.edit(|r| {
        r.album.as_mut().unwrap().members.remove(0);
    });
    assert_eq!(code(h.resume(&a, "member")), "role-removed");
    h.edit(|r| r.album = Some(config()));
    h.source.lock().unwrap().artists.as_mut().unwrap()[0].instructions = "\0".into();
    assert_eq!(code(h.resume(&a, "invalid")), "role-invalid");
    assert!(h.jobs.try_recv().is_err());
}

#[test]
fn album_judge_resume_and_effect_use_current_rev() {
    let h = harness();
    let a = h.spawn(WRITE, "spawn").unwrap()["attemptId"].as_str().unwrap().to_string();
    h.job();
    h.idle(&a);
    h.edit(|r| {
        let a = r.album.as_mut().unwrap();
        a.rev = 2;
        a.members[0].grade = MemberGrade::Full;
        a.members[0].allowed_commands = vec!["cargo check".into()];
    });
    h.source.lock().unwrap().artists.as_mut().unwrap()[0].instructions = "새 지침".into();
    h.resume(&a, "resume").unwrap();
    let job = h.job();
    assert_eq!(job.turn.role.grade, Grade::Full);
    assert_eq!(job.turn.role.allowed_commands, ["cargo check"]);
    assert_eq!(job.turn.role.instructions.as_deref(), Some("새 지침"));
    assert_eq!(job.turn.turn_minutes, 73);
    h.edit(|r| r.album.as_mut().unwrap().members[0].grade = MemberGrade::Edit);
    let (fresh, minutes) = h.o.turn_preflight(&h.id, &a).unwrap().unwrap();
    assert_eq!(fresh.grade, Grade::Edit);
    assert_eq!(minutes, 73);
    h.edit(|r| r.album.as_mut().unwrap().members[0].grade = MemberGrade::Read);
    assert_eq!(h.o.turn_preflight(&h.id, &a).unwrap_err().code, "role-read-only");
}

#[test]
fn album_judge_accept_rules_rework_and_human_waiver() {
    let h = harness();
    h.edit(|r| {
        r.album.as_mut().unwrap().accept.require = vec![AcceptRule {
            role: JUDGE.into(),
            passes: 2,
        }];
        r.album.as_mut().unwrap().accept.max_rework = 0;
        r.tasks[0].rework_count = 1;
    });
    // 되돌림 관문은 반려된 트랙에만 적용한다.
    h.edit(|r| r.tasks[0].state = TaskState::Rejected);
    assert_eq!(code(h.spawn(WRITE, "rework2")), "rework-limit");
    let r = h.run();
    let task = &r.tasks[0];
    let i = inputs();
    assert_eq!(
        album::accept_gate(&r, &i, task, Reviewer::Coordinator).unwrap_err().code,
        "accept-rule-unmet"
    );
    let human = album::accept_gate(&r, &i, task, Reviewer::Human).unwrap();
    assert_eq!((human.waived[0].role.as_deref(), human.waived[0].need), (Some(JUDGE), 2));
    h.edit(|r| r.album.as_mut().unwrap().accept.require.clear());
    let r = h.run();
    assert!(album::accept_gate(&r, &i, &r.tasks[0], Reviewer::Coordinator).is_ok());
}

#[test]
fn album_judge_unattended_verify() {
    let h = harness();
    h.edit(|r| {
        r.verify = Some(
            serde_json::from_value(json!({"command": "사람이 고정한 명령", "commandSha": "고정 해시",
            "timeoutMinutes": 1, "autoRun": false, "keepDirs": [], "cacheKeyFiles": [], "extraEnvNames": []}))
            .unwrap(),
        );
    });
    assert_eq!(h.o.unattended_verify_ok(&h.id), Err("confirm-required"));
    assert_eq!(h.o.album_verify_preflight(&h.id, true), Err("confirm-required"));
    assert!(h.o.album_verify_preflight(&h.id, false).is_ok());
    h.edit(|r| r.album.as_mut().unwrap().verify_auto = true);
    assert!(
        h.o.unattended_verify_ok(&h.id).is_ok(),
        "Run.verify.autoRun과 무관하게 지금 구성으로 판정"
    );
    h.source.lock().unwrap().identity = Err(IdentityError::Missing);
    assert_eq!(h.o.unattended_verify_ok(&h.id), Err("repo-changed"));
    assert_eq!(h.o.album_verify_preflight(&h.id, false), Err("repo-changed"));
    *h.source.lock().unwrap() = inputs();
    h.edit(|r| r.verify = None);
    assert_eq!(h.o.unattended_verify_ok(&h.id), Err("no-verify-command"));
}

#[test]
fn album_judge_review_budget_deadline_and_acceptance() {
    let h = harness();
    let report = h.reported();
    h.edit(|r| {
        r.album.as_mut().unwrap().accept.require = vec![AcceptRule {
            role: JUDGE.into(),
            passes: 2,
        }];
        // 판정형은 등급 글자와 무관하게 읽기만 한다.
        r.album.as_mut().unwrap().members[1].grade = MemberGrade::Full;
    });
    for n in 0..2 {
        let v = h.spawn(JUDGE, &format!("judge{n}")).unwrap();
        let a = v["attemptId"].as_str().unwrap();
        let job = h.job();
        assert_eq!(job.turn.role.grade, Grade::ReadOnly);
        assert!(job.turn.role.allowed_commands.is_empty());
        assert_eq!(job.turn.turn_minutes, 73);
        h.finish_judge(a, &report, ReviewVerdict::Pass);
        let r = h.run();
        let gate = album::accept_gate(&r, &inputs(), &r.tasks[0], Reviewer::Coordinator);
        if n == 0 {
            assert_eq!(gate.unwrap_err().code, "accept-rule-unmet");
        } else {
            assert_eq!(gate.unwrap().judgments.len(), 2);
        }
    }
    assert_eq!(code(h.spawn(JUDGE, "budget")), "review-budget-exhausted");
    let v = h.call("get_run", json!({})).unwrap();
    assert_eq!(v["remaining"]["reviews"], 0);
    let version = h.run().tasks[0].version;
    h.call(
        "update_task",
        json!({"requestId": "accept", "taskId": h.task, "version": version, "state": "accepted"}),
    )
    .unwrap();
    assert_eq!(h.run().tasks[0].state, TaskState::Accepted);
}

#[test]
fn album_judge_accept_entry_and_human_failure_are_closed() {
    let h = harness();
    h.reported();
    h.edit(|r| {
        r.album.as_mut().unwrap().accept.require = vec![AcceptRule {
            role: JUDGE.into(),
            passes: 1,
        }]
    });
    let version = h.run().tasks[0].version;
    assert_eq!(
        code(h.call(
            "update_task",
            json!({"requestId": "accept", "taskId": h.task, "version": version, "state": "accepted"})
        )),
        "accept-rule-unmet"
    );
    h.source.lock().unwrap().artists = Err("읽기 실패".into());
    assert_eq!(
        h.o.human_review(&h.id, &h.task, version, Decision::Accepted).unwrap_err().code,
        "role-invalid"
    );
    assert_eq!(h.run().tasks[0].state, TaskState::Reported);
    *h.source.lock().unwrap() = inputs();
    h.o.human_review(&h.id, &h.task, version, Decision::Accepted).unwrap();
    assert_eq!(h.run().accepted[0].waived[0].role.as_deref(), Some(JUDGE));
}

#[test]
fn album_judge_failure_never_falls_back() {
    let h = harness();
    for identity in [
        Err(IdentityError::Missing),
        Ok(RepoIdentity {
            git_dir: "C:/other/.git".into(),
            repo_id: None,
        }),
    ] {
        h.source.lock().unwrap().identity = identity;
        assert_eq!(code(h.spawn(WRITE, "identity")), "repo-changed");
        assert!(h.o.identity_drifted(&h.id));
        let r = h.run();
        for by in [Reviewer::Coordinator, Reviewer::Human] {
            assert_eq!(
                album::accept_gate(&r, &h.o.album_inputs(&h.id), &r.tasks[0], by).unwrap_err().code,
                "repo-changed"
            );
        }
    }
    *h.source.lock().unwrap() = inputs();
    h.source.lock().unwrap().artists = Err("읽기 실패".into());
    assert_eq!(code(h.spawn(WRITE, "artists")), "role-invalid");
    *h.source.lock().unwrap() = inputs();
    h.edit(|r| r.delegation = None);
    assert_eq!(code(h.spawn(WRITE, "snapshot")), "repo-changed");
    assert!(h.run().attempts.is_empty());
    assert!(h.jobs.try_recv().is_err());

}

#[test]
fn album_judge_plan_tools_wake_max_and_view() {
    let h = harness();
    assert_eq!(
        h.o.album_producer_policy("pc-album-test").unwrap().unwrap(),
        ("C:/repo".into(), false, 30)
    );
    h.edit(|r| {
        let a = r.album.as_mut().unwrap();
        a.plan_tools = true;
        a.wake_max = 0;
        a.rev = 2;
    });
    assert_eq!(
        h.o.album_producer_policy("pc-album-test").unwrap().unwrap(),
        ("C:/repo".into(), true, 0)
    );
    h.o.run_detail_fresh(&h.id).unwrap();
    let v = h.call("get_run", json!({})).unwrap();
    assert_eq!(v["album"]["rev"], 2);
    assert!(v.get("delegation").is_none());
    assert_eq!(v["roles"][0]["id"], WRITE);
    assert_eq!(v["roles"][0]["name"], format!("현재 {WRITE}"));
    assert_eq!(v["roles"][0]["instructionsLen"], "지금 지침".len());
    assert!(!v.to_string().contains("지금 지침"));
    let seat = h.o.lock().runs[&h.id].coordinator.as_ref().unwrap().1.clone();
    h.edit(|r| {
        r.bump(1, Actor::Human, "task_updated", Some(&h.task), "updated");
    });
    assert_eq!(h.o.wake_check(&seat, true, None, Some(200)), super::wake::Due::Off("off"));
    assert_eq!(h.o.lock().runs[&h.id].wake.cap, Some(0), "스튜디오에서 넘어온 상한을 쓰지 않는다");
    assert!(h.o.wake_reserve(&seat, None, Some(200)).is_none());
    h.edit(|r| r.album.as_mut().unwrap().wake_max = 1);
    assert_eq!(h.o.wake_check(&seat, true, None, Some(0)), super::wake::Due::Now);
    let wake = h.o.wake_reserve(&seat, None, Some(0)).unwrap();
    h.o.wake_ended(&seat, &wake.wake_id, super::wake::WakeEnd::Unacked);
    assert_eq!(h.o.wake_check(&seat, true, None, Some(200)), super::wake::Due::Off("segment-max"));
    h.source.lock().unwrap().artists = Err("목록 읽기 실패".into());
    assert!(h.o.album_producer_policy("pc-album-test").unwrap().is_err());
}

#[test]
fn album_judge_plan_tools_mcp_current_policy() {
    let h = harness();
    let chat = format!("pc-album-rpc-{}", new_id("run").unwrap());
    let proc = crate::server::chat_proc::ProcId::next();
    crate::chat_token::insert_producer_for_test(&chat, proc, "C:/repo", true);
    h.o.lock().producer_ever.insert(chat.clone(), h.id.clone());
    let caller = Caller::Producer { chat: chat.clone(), proc };
    let call = || {
        let store = Default::default();
        let ops = Default::default();
        let results = Default::default();
        let signal = crate::mcp::McpSignal::default();
        let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "get_auto_approval_policy", "arguments": {}}});
        match crate::mcp::dispatch_as(
            &caller,
            Some(&h.o),
            &store,
            &ops,
            &results,
            &signal,
            &request.to_string(),
            crate::delegation::Delegation::default,
            &crate::mcp::DbEnv::none(),
        ) {
            crate::mcp::RpcReply::Json(s) => serde_json::from_str::<Value>(&s).unwrap()["result"].clone(),
            _ => panic!("도구 결과가 필요합니다"),
        }
    };
    assert!(call()["content"][0]["text"]
        .as_str()
        .unwrap()
        .starts_with("producer-plan-tools-off"));
    h.edit(|r| r.album.as_mut().unwrap().plan_tools = true);
    assert!(!call()["isError"].as_bool().unwrap_or(false), "목록을 다시 만들지 않아도 지금 구성을 판정");
    h.edit(|r| r.album.as_mut().unwrap().plan_tools = false);
    assert_eq!(call()["isError"], true);
    h.edit(|r| r.album.as_mut().unwrap().plan_tools = true);
    h.source.lock().unwrap().artists = Err("목록 읽기 실패".into());
    assert_eq!(call()["isError"], true, "읽기 실패는 실행을 닫는다");
    h.o.lock().runs.remove(&h.id);
    assert_eq!(call()["isError"], true, "귀속된 Run이 없어도 스튜디오로 떨어지지 않는다");
    crate::chat_token::revoke(&chat, proc);
}

#[test]
fn run_v4_roundtrip() {
    let h = harness();
    h.edit(|r| {
        let a = r.album.as_mut().unwrap();
        a.rev = 3;
        a.verify_auto = true;
        a.plan_tools = true;
        a.wake_max = 7;
        a.members[0].grade = MemberGrade::Full;
        a.members[0].allowed_commands = vec!["cargo test".into()];
        a.accept.require = vec![AcceptRule {
            role: JUDGE.into(),
            passes: 2,
        }];
        a.accept.max_rework = 1;
    });
    let r = h.run();
    let bytes = super::persist::encode(&r).unwrap();
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap()["version"], 4);
    assert_eq!(super::persist::decode(&bytes).unwrap(), r);
}

#[test]
fn album_judge_source_reads_outside_lock() {
    let o = Arc::new(Orchestration::new(None, Arc::new(|_, _| {}), None));
    let (id, _) = o
        .start_run(StartRun {
            name: "원천 시험".into(),
            repo: "C:/repo".into(),
            worktree_dir: "C:/repo-wt".into(),
            limits: Limits::default(),
            verify: None,
        })
        .unwrap();
    let weak = Arc::downgrade(&o);
    o.set_album_source(Arc::new(move |repo| {
        assert_eq!(repo, "C:/repo");
        assert!(weak.upgrade().unwrap().inner.try_lock().is_ok(), "읽기 손은 Run 잠금 밖에서 돈다");
        inputs()
    }));
    assert!(o.album_inputs(&id).identity.is_ok());
}

#[test]
fn v3_file_skipped_without_reading_or_deleting_body() {
    let dir = std::env::temp_dir().join(format!("aynx-album-v3-{}", new_id("run").unwrap()));
    std::fs::create_dir_all(&dir).unwrap();
    let name = format!("{}.json", new_id("run").unwrap());
    let bytes = r#"{"version":3,"run":"판 4로 해석할 수 없는 몸"}"#.as_bytes();
    std::fs::write(dir.join(&name), bytes).unwrap();
    let mut logs = Vec::new();
    assert!(super::persist::load_orphans(&dir, |n, why| logs.push((n.to_string(), why.to_string()))).is_empty());
    assert_eq!(logs.len(), 1);
    assert!(logs[0].1.contains("version 3"));
    assert_eq!(std::fs::read(dir.join(&name)).unwrap(), bytes);
    std::fs::remove_file(dir.join(name)).unwrap();
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn artist_in_use() {
    let h = harness();
    for state in [RunState::Running, RunState::Paused, RunState::Stopping, RunState::Done, RunState::Stopped, RunState::Orphaned] {
        h.edit(|r| r.state = state);
        assert_eq!(h.o.artist_in_use(WRITE).contains(&h.id), state.active(), "{state:?}");
        assert!(h.o.artist_in_use("a-ffffffff").is_empty());
    }
}

#[test]
fn album_defaults_from_latest_and_archive() {
    let dir = std::env::temp_dir().join(format!("aynx-s3-defaults-{}", new_id("run").unwrap()));
    std::fs::create_dir_all(dir.join("archived")).unwrap();
    let h = harness();
    let mut older = h.run(); older.created_at = 1;
    let mut recent = older.clone(); recent.id = new_id("run").unwrap(); recent.created_at = 2;
    recent.album.as_mut().unwrap().members.push(member("a-ffffffff", MemberGrade::Edit));
    recent.album.as_mut().unwrap().accept.require = vec![AcceptRule { role: "a-ffffffff".into(), passes: 1 }];
    recent.album.as_mut().unwrap().wake_max = 17;
    recent.album.as_mut().unwrap().auto_merge = true;
    recent.origin.producer_config = Some(ProducerConfig { cli: "codex".into(), model: "gpt-test".into(), effort: Some("low".into()) });
    super::persist::save(&dir.join("archived"), &recent).unwrap();
    let o = Orchestration::new(Some(dir.clone()), Arc::new(|_, _| {}), None);
    o.set_album_source(Arc::new(|_| inputs()));
    let d = o.album_defaults("c:\\REPO").unwrap();
    assert_eq!(d["wakeMax"], 17);
    assert_eq!(d["fromLast"], true, "같은 저장소의 지난 Run 에서 왔다");
    assert_eq!(d.get("autoMerge"), None, "자동 병합은 기본 꺼짐 — 지난 앨범에서 물려받지 않는다");
    assert_eq!(d["producer"]["cli"], "codex");
    assert_eq!(d["members"].as_array().unwrap().len(), 2);
    assert!(d["accept"]["require"].as_array().unwrap().is_empty(), "지운 판정형 규칙도 빼야 한다");
    let fresh = o.album_defaults("C:/other").unwrap();
    assert_eq!(fresh["wakeMax"], 30);
    assert_eq!(fresh["fromLast"], false, "처음 쓰는 저장소는 씨앗 기본");
    assert_eq!(fresh["accept"]["require"][0]["role"], JUDGE);
    drop(o);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn album_start_order_seat_dies_before_commit() {
    let h = super::tests_start::harness("s3-dead-seat");
    let repo = h.repo.display().to_string();
    let profile_repo = repo.clone();
    h.o.set_album_source(Arc::new(move |_| AlbumInputs {
        identity: crate::orchestration::repo_identity::identity_now(std::path::Path::new(&profile_repo)), artists: inputs().artists,
    }));
    let mut prepared = h.o.prepare_album(StartRun { name: "시작 경쟁".into(), repo: repo.clone(),
        worktree_dir: h.root.join("wt").display().to_string(), limits: Limits::default(), verify: None }, config(),
        ProducerConfig { cli: "claude".into(), model: String::new(), effort: None }).unwrap();
    let id = prepared.id.clone();
    let proc = crate::server::chat_proc::ProcId::next();
    let chat = format!("pc-s3-dead-{}", id);
    crate::chat_token::issue_producer(&chat, proc, &repo, Some(&id), false).unwrap();
    let c = chat.clone();
    super::start::set_before_bind(move || { crate::chat_token::revoke(&c, proc); });
    assert_eq!(prepared.commit(&Seat { chat: chat.clone(), proc }).unwrap_err().code, "not-a-tile");
    assert_eq!(h.o.active_count(), 0);
    assert!(h.o.producer_run(&chat).is_none());
    let work_ref = prepared.integration.work_ref.clone();
    drop(prepared);
    assert!(h.o.integrator().unwrap().read_ref(&h.repo, &work_ref).unwrap().is_none());
}

#[test]
fn album_start_order_rechecks_capacity() {
    let h = super::tests_start::harness("s3-capacity");
    let repo = h.repo.display().to_string();
    let profile_repo = repo.clone();
    h.o.set_album_source(Arc::new(move |_| AlbumInputs {
        identity: crate::orchestration::repo_identity::identity_now(std::path::Path::new(&profile_repo)), artists: inputs().artists,
    }));
    let start = StartRun { name: "상한 경쟁".into(), repo: repo.clone(), worktree_dir: h.root.join("wt").display().to_string(),
        limits: Limits::default(), verify: None };
    let mut prepared = h.o.prepare_album(start.clone(), config(),
        ProducerConfig { cli: "claude".into(), model: String::new(), effort: None }).unwrap();
    let proc = crate::server::chat_proc::ProcId::next();
    let chat = format!("pc-s3-cap-{}", prepared.id);
    crate::chat_token::issue_producer(&chat, proc, &repo, Some(&prepared.id), false).unwrap();
    let o = Arc::clone(&h.o);
    super::start::set_before_bind(move || {
        o.start_run(start.clone()).unwrap();
        o.start_run(start).unwrap();
    });
    assert_eq!(prepared.commit(&Seat { chat: chat.clone(), proc }).unwrap_err().code, "too-many-runs");
    assert_eq!(h.o.active_count(), 2);
    assert!(h.o.producer_run(&chat).is_none());
    let work_ref = prepared.integration.work_ref.clone();
    drop(prepared);
    crate::chat_token::revoke(&chat, proc);
    assert!(h.o.integrator().unwrap().read_ref(&h.repo, &work_ref).unwrap().is_none());
}

#[path = "tests_album_commands.rs"]
mod commands;

#[test]
fn run_without_album_is_inert() {
    let h=harness(); h.reported(); h.edit(|r| r.album=None);
    assert_eq!(code(h.spawn(WRITE,"inert")),"repo-changed");
    let r=h.run(); let i=RunInputs::Album(inputs());
    for by in [Reviewer::Coordinator,Reviewer::Human] {
        assert_eq!(i.accept_gate(&r,&r.tasks[0],by).unwrap_err().code,"repo-changed");
    }
    assert_eq!(h.o.album_verify_preflight(&h.id,false),Err("repo-changed"));
    assert_eq!(h.o.album_verify_preflight(&h.id,true),Err("repo-changed"));
    assert_eq!(h.o.unattended_verify_ok(&h.id),Err("repo-changed"));
    assert!(h.jobs.try_recv().is_err());
}
