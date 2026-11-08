//! S3 계약 시험. 실행 파일 자신인 기존 가짜 Claude만 띄운다(모델 호출 없음).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::super::{find, lock, FAKE, TABLE, TEST_ORCH};
use super::live::{err, ok, setup, teardown, wait_ev, SERIAL};
use crate::orchestration::config::{RoleCli, RoleKind};
use crate::orchestration::repo_identity::identity_now;
use crate::orchestration::album::AlbumInputs;
use crate::orchestration::album_start::{fail_at, AlbumInput};
use crate::orchestration::artists::Artist;
use crate::orchestration::{GitRefs, Orchestration};

const WRITE: &str = "a-00000001";
const JUDGE: &str = "a-00000002";

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn init(repo: &Path) {
    std::fs::create_dir_all(repo.join("sub")).unwrap();
    git(repo, &["init", "-q", "-b", "main"]);
    git(repo, &["config", "user.name", "S3 시험"]);
    git(repo, &["config", "user.email", "s3@example.invalid"]);
    git(repo, &["commit", "-qm", "base", "--allow-empty"]);
}

fn artists() -> Vec<Artist> {
    [(WRITE, RoleKind::Write), (JUDGE, RoleKind::Judge)]
        .into_iter()
        .map(|(id, kind)| Artist {
            id: id.into(),
            name: id.into(),
            icon: "claude".into(),
            cli: RoleCli::Claude,
            kind,
            model: "haiku".into(),
            effort: "low".into(),
            instructions: String::new(),
        })
        .collect()
}

struct H {
    root: PathBuf,
    repo: PathBuf,
    o: Arc<Orchestration>,
}
impl H {
    fn new(tag: &str) -> H {
        let root = setup(tag);
        let repo = root.join("repo");
        init(&repo);
        let o = lock(&TEST_ORCH).as_ref().unwrap().clone();
        o.set_ephemeral(true);
        o.set_integrator(Arc::new(GitRefs));
        o.set_album_source(Arc::new(|repo| AlbumInputs {
            identity: identity_now(Path::new(repo)),
            artists: Ok(artists()),
        }));
        // 새 길은 맡기기 파일을 조회하면 실패해야 한다.
        H { root, repo, o }
    }

    fn body(&self, chat: &str) -> Value {
        json!({"chat": chat, "clientId": "first", "text": "첫 줄 앨범\n일을 시작해 주세요", "cli": "claude", "model": "haiku", "repo": self.repo,
            "album": {"members": [{"artist": WRITE, "grade": "edit", "allowedCommands": []}, {"artist": JUDGE, "grade": "read", "allowedCommands": []}],
            "accept": {"require": [{"role": JUDGE, "passes": 1}], "maxRework": 3}, "verify": {"command": "echo human-s3", "auto": false},
            "limits": {"maxConcurrentWorkers": 2, "maxTotalWorkers": 4, "coordinationMinutes": 60, "turnMinutes": 30, "maxReviews": 3},
            "planTools": false, "wakeMax": 0, "riskConfirmed": false}})
    }

    fn refs(&self) -> String {
        git(&self.repo, &["for-each-ref", "--format=%(refname)", "refs/aynx/orch/"])
    }
}

impl Drop for H {
    fn drop(&mut self) {
        let chats: Vec<_> = lock(&TABLE).chats.values().cloned().collect();
        for c in &chats {
            super::super::close(&c.id, super::super::EndWhy::Closed);
        }
        let until = Instant::now() + Duration::from_secs(5);
        while chats.iter().any(|c| lock(&c.st).core.has_proc()) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(10));
        }
        teardown(&self.root);
    }
}

#[test]
fn album_start_order() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-order");
    for phase in ["shape", "identity", "artists", "ref", "ready", "bind"] {
        let chat = format!("pc-s3-fail-{phase}");
        fail_at(phase);
        assert!(err("producer_album_start", h.body(&chat)).contains("[test-failure]"), "{phase}");
        assert_eq!(h.o.active_count(), 0, "{phase}의 Run 회수");
        assert!(h.refs().is_empty(), "{phase}의 ref 회수");
        assert!(h.o.producer_run(&chat).is_none());
        assert!(find(&chat).is_err(), "{phase}의 채팅 회수");
    }
    // 실제 띄우기 실패도 ref를 남기지 않는다(진짜 CLI 경로는 쓰지 않는다).
    let exe = {
        let mut f = lock(&FAKE);
        let f = f.as_mut().unwrap();
        std::mem::replace(&mut f.exe, h.root.join("missing-fake.exe").display().to_string())
    };
    assert!(super::super::handle("producer_album_start", h.body("pc-s3-spawn-fail"), 1).is_err());
    lock(&FAKE).as_mut().unwrap().exe = exe;
    assert!(h.refs().is_empty());
    assert_eq!(h.o.active_count(), 0);
    // 유일하게 Run을 남기는 실패는 첫 말 쓰기다.
    fail_at("stdin");
    let r = ok("producer_album_start", h.body("pc-s3-not-sent"));
    assert_eq!(r["sent"], false);
    assert_eq!(h.o.active_count(), 1);
    assert_eq!(h.o.producer_run("pc-s3-not-sent").as_deref(), r["runId"].as_str());
    assert_eq!(h.refs().lines().count(), 1);
    let c = find("pc-s3-not-sent").unwrap();
    let p = lock(&c.st).core.live().unwrap();
    assert_eq!(crate::chat_token::album_of(&c.id, p).as_deref(), r["runId"].as_str());
    assert_eq!(h.o.bound_seat(&super::super::seat(&c.id, p)).unwrap().0, r["runId"]);
    assert_eq!(ok("producer_album_start", h.body(&c.id)), r, "미전송 답도 처음 결과");
    assert!(lock(&c.st).input.queue.is_empty(), "글은 화면에만 돌려준다");
    assert_eq!(
        ok("producer_chat_send", json!({"chat": c.id, "clientId": "retry", "text": "첫 글 다시 보내기"}))["state"],
        "dispatching"
    );
    wait_ev(&c.id, |e| e["t"] == "turnEnded");
}

#[test]
fn album_start_idempotent_and_already_produced() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-idem");
    let b = h.body("pc-s3-idem");
    let r = ok("producer_album_start", b.clone());
    assert_eq!(r["sent"], true);
    wait_ev("pc-s3-idem", |e| e["t"] == "turnEnded");
    let mut changed = b.clone();
    changed["text"] = json!("재전송 글은 결과를 바꾸지 않습니다");
    assert_eq!(ok("producer_album_start", changed), r);
    assert_eq!(h.o.active_count(), 1);
    assert_eq!(h.refs().lines().count(), 1);
    let mut other = b.clone();
    other["clientId"] = json!("other");
    let e = err("producer_album_start", other);
    assert!(e.contains("[already-produced]") && e.contains(r["runId"].as_str().unwrap()));
    let view = h.o.run_detail(r["runId"].as_str().unwrap()).unwrap();
    assert_eq!(view["name"], "첫 줄 앨범");
    assert_eq!(view["origin"]["by"], "human");
    let c = find("pc-s3-idem").unwrap();
    let proc = lock(&c.st).core.live().unwrap();
    let caller = crate::orchestration::Caller::Producer { chat: c.id.clone(), proc };
    assert_eq!(h.o.call_tool(&caller, "get_run", None).unwrap()["runId"], r["runId"], "첫 턴은 무인자 get_run");
    assert!(!crate::orchestration::is_tool_for(&caller, "start_run"));
    ok("producer_chat_close", json!({"chat": "pc-s3-idem"}));
    assert_eq!(ok("producer_album_start", b), r, "닫은 채팅도 처음 결과");
}

#[test]
fn producer_cwd_from_run_not_body() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-cwd");
    let log = h.root.join("cwd.txt");
    lock(&FAKE)
        .as_mut()
        .unwrap()
        .env
        .push(("AYNX_TEST_SIDE_CHAT_CWD".into(), log.display().to_string()));
    let mut b = h.body("pc-s3-cwd");
    b["repo"] = json!(h.repo.join("sub"));
    let r = ok("producer_album_start", b);
    wait_ev("pc-s3-cwd", |e| e["t"] == "turnEnded");
    assert_eq!(
        crate::worktree::comparable(&std::fs::read_to_string(log).unwrap()),
        crate::worktree::comparable(&h.repo.display().to_string())
    );
    let snap = ok(
        "producer_chat_open",
        json!({"chat": "pc-s3-cwd", "cli": "claude", "model": "haiku", "repo": h.root.join("wrong"), "mode": {"kind": "resume", "conv": find("pc-s3-cwd").unwrap().st.lock().unwrap().conversation.clone().unwrap()}}),
    );
    assert_eq!(snap["epoch"], r["epoch"]);
    assert_eq!(
        crate::worktree::comparable(snap["repo"].as_str().unwrap()),
        crate::worktree::comparable(&h.repo.display().to_string())
    );
    let c = find("pc-s3-cwd").unwrap();
    let st = lock(&c.st);
    let dir = h.root.join(".run").join(format!("{}-{}", c.id, st.core.id()));
    let instructions = std::fs::read_to_string(dir.join("instructions.md")).unwrap();
    assert!(instructions.contains(r["runId"].as_str().unwrap()) && instructions.contains("Call get_run first"));
    assert!(!instructions.contains("Open an album with start_run"));
}

#[test]
fn producer_fork_repo_from_conversation() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-fork");
    let conv = "0f0f0f0f-1111-4222-8333-444444444444";
    let index = h.root.join("conversations");
    let proj = index.join("project");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(
        proj.join(format!("{conv}.jsonl")),
        format!(
            "{}\n",
            json!({"type": "user", "cwd": h.repo.join("sub"), "sessionId": conv,
        "timestamp": "2026-10-30T01:00:00.000Z", "message": {"role": "user", "content": "사람의 원래 대화"}})
        ),
    )
    .unwrap();
    {
        let mut fake = lock(&FAKE);
        let f = fake.as_mut().unwrap();
        f.conv_roots = vec![("claude", index)];
    }
    let probe = ok("producer_fork_probe", json!({"agent": "claude", "conv": conv}));
    assert_eq!(
        crate::worktree::comparable(probe["repo"].as_str().unwrap()),
        crate::worktree::comparable(&h.repo.display().to_string())
    );
    let other = h.root.join("other");
    init(&other);
    let mut b = h.body("pc-s3-fork");
    b["fork"] = json!({"agent": "claude", "conv": conv});
    b["repo"] = json!(other);
    assert!(err("producer_album_start", b.clone()).contains("[out-of-scope:repo]"));
    b["repo"] = probe["repo"].clone();
    let r = ok("producer_album_start", b);
    assert_eq!(r["sent"], true);
    assert_eq!(lock(&find("pc-s3-fork").unwrap().st).fork_from.as_deref(), Some(conv));
}

#[test]
fn verify_command_only_from_album_start() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-verify");
    let r = ok("producer_album_start", h.body("pc-s3-verify"));
    let id = r["runId"].as_str().unwrap();
    assert_eq!(h.o.run_detail(id).unwrap()["verify"]["command"], "echo human-s3");
    let c = find("pc-s3-verify").unwrap();
    let proc = lock(&c.st).core.live().unwrap();
    let caller = crate::orchestration::Caller::Producer { chat: c.id.clone(), proc };
    assert!(h
        .o
        .call_tool(
            &caller,
            "start_run",
            Some(&json!({"name": "AI가 구성 쓰기", "requestId": "no", "verify": {"command": "echo model"}}))
        )
        .is_err());
    assert_eq!(h.o.run_detail(id).unwrap()["verify"]["command"], "echo human-s3");
    let d = ok("orchestration_album_defaults", json!({"repo": h.repo}));
    assert_eq!(d["verify"]["command"], "echo human-s3");
    assert_eq!(d["producer"]["model"], "haiku");
    let mut input = d;
    input.as_object_mut().unwrap().remove("producer");
    input.as_object_mut().unwrap().remove("verifyAuto");
    assert_eq!(input.as_object_mut().unwrap().remove("fromLast"), Some(json!(true)), "같은 저장소의 지난 Run");
    input["riskConfirmed"] = json!(false);
    serde_json::from_value::<AlbumInput>(input).unwrap().validate(1).unwrap();
}

/// 실기 16: 프런트의 기본 강도 `""` 를 `word_ok("")` 가 bad-args 로 거절해 앨범이 서지 않았다. 빈 값 · null · 생략 = 칸 없음(CLI 기본)이고
/// Run · 채팅 칸에 빈 값이 남지 않는다.
#[test]
fn album_start_blank_effort_is_default() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-effort");
    for (chat, effort) in [("pc-s3-effort-blank", Some(json!(""))), ("pc-s3-effort-null", Some(Value::Null)), ("pc-s3-effort-none", None)] {
        let mut b = h.body(chat);
        b["model"] = json!("");
        if let Some(e) = effort {
            b["effort"] = e;
        }
        let r = ok("producer_album_start", b);
        assert_eq!(r["sent"], true, "{chat}");
        assert_eq!(lock(&find(chat).unwrap().st).effort, None, "{chat}의 채팅 칸");
        let d = ok("orchestration_album_defaults", json!({"repo": h.repo}));
        assert_eq!(d["producer"]["effort"], Value::Null, "{chat}의 Run 구성");
        wait_ev(chat, |e| e["t"] == "turnEnded");
        h.o.stop(r["runId"].as_str().unwrap()).unwrap(); // 동시 앨범 상한(2) 밖으로
    }
    let mut bad = h.body("pc-s3-effort-bad");
    bad["effort"] = json!("high effort");
    assert!(err("producer_album_start", bad).contains("[bad-args]"), "모양이 틀린 강도는 여전히 거절");
}

#[test]
fn album_opens_only_from_human_op() {
    let src = include_str!("album.rs");
    assert!(src.contains("prepared.commit(") && src.contains("dispatch(&chat, &mut st, src, text)"));
    for tool in [
        "producer_album_start",
        "orchestration_album_defaults",
        "producer_fork_probe",
    ] {
        for caller in [
            crate::orchestration::Caller::Global,
            crate::orchestration::Caller::SideChat { chat: "side".into() },
        ] {
            assert!(!crate::orchestration::is_tool_for(&caller, tool));
        }
        assert!(!crate::orchestration::TILE_TOOLS.contains(&tool));
        assert!(!crate::orchestration::COORDINATOR_TOOLS.contains(&tool));
    }
}

#[test]
fn album_start_shape_validation() {
    let e = super::super::handle("producer_album_start", json!({"album": {"members": [{"grade": "unknown"}]}}), 1).unwrap_err();
    assert!(e.message.contains("[bad-args]"));
    let input = json!({"members": [{"artist": WRITE, "grade": "edit", "allowedCommands": []}],
        "accept": {"require": [], "maxRework": 3}, "verify": {"command": "echo human", "auto": false},
        "limits": {"maxConcurrentWorkers": 3, "maxTotalWorkers": 8, "coordinationMinutes": 120, "turnMinutes": 240, "maxReviews": 20},
        "planTools": false, "wakeMax": 0, "riskConfirmed": false});
    let validate = |v: Value| serde_json::from_value::<AlbumInput>(v).unwrap().validate(1);
    validate(input.clone()).unwrap();
    // 자동 병합 — 검증 명령 없이는 위험을 확인해도 시작하지 못한다 · 켜면 위험 확인이 필요하다.
    {
        let mut on = input.clone();
        on["autoMerge"] = json!(true);
        assert_eq!(validate(on.clone()).unwrap_err().code, "risk-not-confirmed");
        on["riskConfirmed"] = json!(true);
        assert!(validate(on.clone()).unwrap().0.auto_merge);
        on["verify"]["command"] = json!("");
        assert_eq!(validate(on).unwrap_err().code, "no-verify-command");
    }
    for (key, max) in [
        ("maxConcurrentWorkers", 3),
        ("maxTotalWorkers", 8),
        ("coordinationMinutes", 120),
        ("turnMinutes", 240),
        ("maxReviews", 20),
    ] {
        for invalid in [0, max + 1] {
            let mut v = input.clone();
            v["limits"][key] = json!(invalid);
            assert_eq!(validate(v).unwrap_err().code, "bad-args");
        }
    }
    for command in ["cargo *", "echo (x)", "echo x\necho y"] {
        let mut v = input.clone();
        v["members"][0]["allowedCommands"] = json!([command]);
        assert_eq!(validate(v).unwrap_err().code, "bad-args");
    }
    for key in ["planTools", "verify"] {
        let mut v = input.clone();
        if key == "verify" {
            v[key]["auto"] = json!(true);
        } else {
            v[key] = json!(true);
        }
        assert_eq!(validate(v).unwrap_err().code, "risk-not-confirmed");
    }
    let mut v = input;
    v["members"][0]["grade"] = json!("full");
    assert_eq!(validate(v).unwrap_err().code, "risk-not-confirmed");
}

#[test]
fn adopt_run_token_scoped() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-adopt");
    let mut ids = Vec::new();
    for chat in ["pc-s3-adopt-source1", "pc-s3-adopt-source2"] {
        let r = ok("producer_album_start", h.body(chat));
        ids.push(r["runId"].as_str().unwrap().to_string());
        wait_ev(chat, |e| e["t"] == "turnEnded");
        ok("producer_chat_close", json!({"chat": chat}));
        wait_ev(chat, |e| e["t"] == "exited");
    }
    let before = h.o.run_detail(&ids[0]).unwrap();
    let snap = ok(
        "producer_chat_open",
        json!({"chat": "pc-s3-adopter", "cli": "claude", "model": "haiku", "mode": {"kind": "adopt", "run": ids[0]}}),
    );
    assert_eq!(snap["epoch"], 0, "진입은 띄우지 않는다");
    assert_eq!(snap["album"]["runId"], ids[0]);
    ok(
        "producer_chat_send",
        json!({"chat": "pc-s3-adopter", "clientId": "continue", "text": "이어서 해 주세요"}),
    );
    let c = find("pc-s3-adopter").unwrap();
    let proc = lock(&c.st).core.live().unwrap();
    let caller = crate::orchestration::Caller::Producer { chat: c.id.clone(), proc };
    assert_eq!(crate::chat_token::album_of(&c.id, proc).as_deref(), Some(ids[0].as_str()));
    let e =
        h.o.call_tool(&caller, "adopt_run", Some(&json!({"runId": ids[1], "requestId": "wrong"})))
            .unwrap_err();
    assert!(e.contains("out-of-scope:run"), "{e}");
    let adopted =
        h.o.call_tool(&caller, "adopt_run", Some(&json!({"runId": ids[0], "requestId": "right"})))
            .unwrap();
    assert_eq!(adopted["gen"], 2);
    let after = h.o.run_detail(&ids[0]).unwrap();
    for key in ["album", "verify", "limits", "roles", "acceptRules"] {
        assert_eq!(before[key], after[key], "이어받기가 {key}를 바꿨습니다");
    }
    assert_eq!(h.o.call_tool(&caller, "get_run", None).unwrap()["runId"], ids[0]);
    assert!(err(
        "producer_chat_open",
        json!({"chat": "pc-s3-adopter", "cli": "claude", "model": "haiku", "mode": {"kind": "adopt", "run": ids[1]}})
    )
    .contains("[already-produced]"));
}

#[test]
fn artist_in_use_blocks_server_delete() {
    let _serial = SERIAL.blocking_lock();
    let h = H::new("s3-artist-use");
    let r = ok("producer_album_start", h.body("pc-s3-artist-use"));
    let id = r["runId"].as_str().unwrap();
    assert_eq!(h.o.artist_in_use(WRITE), vec![id]);
    let e = err("orchestration_artist_remove", json!({"id": WRITE}));
    assert!(e.contains("[artist-in-use]") && e.contains(id));
    h.o.pause(id).unwrap();
    assert_eq!(h.o.artist_in_use(JUDGE), vec![id]);
    h.o.stop(id).unwrap();
    assert!(h.o.artist_in_use(WRITE).is_empty());
}

#[test]
fn producer_open_rejects_unbound_modes() {
    let _serial=SERIAL.blocking_lock();
    let h=H::new("r1-open-modes");
    for mode in [json!({"kind":"fresh"}),json!({"kind":"fork","from":"11111111-2222-4333-8444-555555555555"})] {
        let e=err("producer_chat_open",json!({"chat":"pc-r1-unbound","cli":"claude","model":"","repo":h.repo,"mode":mode}));
        assert!(e.contains("bad producer chat request body"),"{e}");
        assert!(find("pc-r1-unbound").is_err());
        assert_eq!(h.o.active_count(),0);
    }
}
