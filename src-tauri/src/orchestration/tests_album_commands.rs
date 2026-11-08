//! S4 사람 명령 계약. S2의 가짜 실행 손으로 실제 예약과 효과 직전 재검사를 확인한다.

use super::super::album_change::handle;
use super::*;
use crate::audit::AuditRecord;

fn observed(dir: Option<std::path::PathBuf>) -> (H, mpsc::Receiver<AuditRecord>, mpsc::Receiver<Value>) {
    let (audit, audits) = mpsc::channel();
    let (emit, events) = mpsc::channel();
    let h = harness_observed(
        dir,
        Arc::new(move |_, v| {
            emit.send(v).unwrap();
        }),
        Some(audit),
    );
    audits.try_iter().for_each(drop);
    events.try_iter().for_each(drop);
    (h, audits, events)
}

fn next(h: &H) -> Value {
    let a = h.run().album.unwrap();
    json!({"members": a.members.iter().map(|m| json!({"artist": m.artist, "grade": m.grade,
        "allowedCommands": m.allowed_commands})).collect::<Vec<_>>(),
        "accept": a.accept, "verifyAuto": a.verify_auto, "planTools": a.plan_tools, "wakeMax": a.wake_max, "autoMerge": a.auto_merge})
}

fn change(h: &H, next: Value, widen: bool, confirmed: bool) -> Result<Value, OrchError> {
    let mut b = json!({"runId": h.id, "expectRev": h.run().album.unwrap().rev, "next": next});
    if widen {
        b["riskConfirmed"] = json!(confirmed);
    }
    handle(
        if widen {
            "orchestration_album_widen"
        } else {
            "orchestration_album_set"
        },
        b,
        &h.o,
    )
}

fn verify(h: &H) {
    h.edit(|r| {
        r.verify = Some(
            serde_json::from_value(json!({"command": "사람의 고정 검증",
        "commandSha": "고정", "timeoutMinutes": 10, "autoRun": false,
        "keepDirs": [], "cacheKeyFiles": [], "extraEnvNames": []}))
            .unwrap(),
        )
    });
}

#[test]
fn album_set_rejects_widening() {
    type Edit = fn(&mut Value);
    let cases: &[Edit] = &[
        |a| a["members"][0]["grade"] = json!("full"),
        |a| a["members"][0]["allowedCommands"] = json!(["cargo test"]),
        |a| a["verifyAuto"] = json!(true),
        |a| a["planTools"] = json!(true),
        |a| a["autoMerge"] = json!(true),
        |a| a["wakeMax"] = json!(31),
        |a| a["accept"]["require"] = json!([]),
        |a| a["accept"]["require"][0]["passes"] = json!(1),
        |a| a["accept"]["maxRework"] = json!(4),
    ];
    for edit in cases {
        let (h, audits, events) = observed(None);
        verify(&h);
        h.edit(|r| {
            r.album.as_mut().unwrap().accept.require.push(AcceptRule {
                role: JUDGE.into(),
                passes: 2,
            })
        });
        let before = serde_json::to_value(h.run()).unwrap();
        let mut a = next(&h);
        edit(&mut a);
        assert_eq!(change(&h, a, false, false).unwrap_err().code, "widens");
        assert_eq!(serde_json::to_value(h.run()).unwrap(), before);
        assert!(audits.try_recv().is_err() && events.try_recv().is_err());
    }
}

/// 자동 병합 — 검증 명령이 있어야 켜진다(서버 판정) · 칸을 빼면 꺼짐(좁힘 · `_set` 으로 된다).
#[test]
fn auto_merge_needs_a_verify_command_and_turns_off_by_omission() {
    let h = harness();
    let mut a = next(&h);
    a["autoMerge"] = json!(true);
    assert_eq!(change(&h, a.clone(), true, true).unwrap_err().code, "no-verify-command");
    assert!(!h.run().album.unwrap().auto_merge);
    verify(&h);
    assert_eq!(change(&h, a, true, true).unwrap()["widened"], true);
    assert!(h.run().album.unwrap().auto_merge);
    let mut off = next(&h);
    off.as_object_mut().unwrap().remove("autoMerge");
    assert_eq!(change(&h, off, false, false).unwrap()["widened"], false);
    assert!(!h.run().album.unwrap().auto_merge);
}

#[test]
fn album_widen_requires_risk_confirm() {
    for feature in ["full", "verifyAuto", "planTools", "autoMerge"] {
        let h = harness();
        verify(&h);
        let mut a = next(&h);
        if feature == "full" {
            a["members"][0]["grade"] = json!("full");
        } else {
            a[feature] = json!(true);
        }
        assert_eq!(change(&h, a.clone(), true, false).unwrap_err().code, "risk-not-confirmed");
        assert_eq!(h.run().album.unwrap().rev, 1);
        assert_eq!(change(&h, a, true, true).unwrap()["rev"], 2);
        assert_eq!(h.run().album.unwrap().risk_confirmed_at, Some(1_000_000));
        // 확인한 위험을 남기고 다른 칸을 좁히는 것은 ALLOW로 된다.
        let mut a = next(&h);
        a["wakeMax"] = json!(0);
        assert_eq!(change(&h, a, false, false).unwrap()["rev"], 3);
        assert_eq!(h.run().album.unwrap().risk_confirmed_at, Some(1_000_000));
    }
}

#[test]
fn album_rev_conflict() {
    let (h, audits, events) = observed(None);
    let a = next(&h);
    let b = json!({"runId": h.id, "expectRev": 1, "next": a});
    assert_eq!(handle("orchestration_album_set", b.clone(), &h.o).unwrap()["rev"], 2);
    let before = serde_json::to_value(h.run()).unwrap();
    audits.try_iter().for_each(drop);
    events.try_iter().for_each(drop);
    // 충돌을 구성 검사보다 먼저 돌려준다.
    let mut stale = b;
    stale["next"]["members"][0]["artist"] = json!("없음");
    assert_eq!(handle("orchestration_album_set", stale, &h.o).unwrap_err().code, "album-changed");
    assert_eq!(serde_json::to_value(h.run()).unwrap(), before);
    assert!(audits.try_recv().is_err() && events.try_recv().is_err());
}

#[test]
fn album_change_rejects_ended_and_orphaned() {
    for (state, code) in [
        (RunState::Done, "run-stopped"),
        (RunState::Stopped, "run-stopped"),
        (RunState::Orphaned, "run-orphaned"),
    ] {
        let h = harness();
        h.edit(|r| r.state = state);
        assert_eq!(change(&h, next(&h), true, true).unwrap_err().code, code);
        assert_eq!(
            handle("orchestration_rename_album", json!({"runId": h.id, "name": "새 이름"}), &h.o)
                .unwrap_err()
                .code,
            code
        );
    }
    for state in [RunState::Running, RunState::Paused, RunState::Stopping] {
        let h = harness();
        h.edit(|r| r.state = state);
        change(&h, next(&h), false, false).unwrap();
        assert_eq!(h.run().state, state);
    }
}

#[test]
fn album_change_cannot_write_verify_or_limits() {
    let h = harness();
    verify(&h);
    let before = serde_json::to_value(h.run()).unwrap();
    for (key, value) in [
        ("verify", json!({"command": "모델 글"})),
        ("command", json!("모델 글")),
        ("limits", json!({"turnMinutes": 999})),
        ("turnMinutes", json!(999)),
        ("rev", json!(999)),
        ("riskConfirmed", json!(true)),
        ("members", Value::Null),
    ] {
        let mut a = next(&h);
        a[key] = value;
        assert_eq!(change(&h, a, true, true).unwrap_err().code, "bad-args", "{key}");
        assert_eq!(serde_json::to_value(h.run()).unwrap(), before);
    }
    for key in ["members", "accept", "verifyAuto", "planTools", "wakeMax"] {
        let mut a = next(&h);
        a.as_object_mut().unwrap().remove(key);
        assert_eq!(change(&h, a, false, false).unwrap_err().code, "bad-args");
    }
    let mut a = next(&h);
    a["wakeMax"] = json!(0);
    change(&h, a, false, false).unwrap();
    let after = serde_json::to_value(h.run()).unwrap();
    assert_eq!(after["verify"], before["verify"]);
    assert_eq!(after["limits"], before["limits"]);
}

#[test]
fn album_change_validates_members_and_rules() {
    let h = harness();
    for (key, value, want) in [
        ("wakeMax", json!(201), "bad-args"),
        ("verifyAuto", json!(true), "no-verify-command"),
        ("members", json!([{"artist": "a-12345678", "grade": "edit"}]), "unknown-role"),
        ("members", json!([{"artist": JUDGE, "grade": "edit"}]), "bad-args"),
        (
            "members",
            json!([{"artist": WRITE, "grade": "edit", "allowedCommands": ["x(*)"]}]),
            "bad-args",
        ),
        (
            "members",
            json!([{"artist": WRITE, "grade": "read"}, {"artist": WRITE, "grade": "read"}]),
            "bad-args",
        ),
        (
            "accept",
            json!({"require": [{"role": WRITE, "passes": 1}], "maxRework": 3}),
            "bad-args",
        ),
        (
            "accept",
            json!({"require": [{"role": JUDGE, "passes": 0}], "maxRework": 3}),
            "bad-args",
        ),
    ] {
        let mut a = next(&h);
        a[key] = value;
        assert_eq!(change(&h, a, true, true).unwrap_err().code, want, "{key}");
        assert_eq!(h.run().album.unwrap().rev, 1);
    }
}

#[test]
fn album_change_applies_next_turn() {
    let h = harness();
    verify(&h);
    let a = h.spawn(WRITE, "first").unwrap()["attemptId"].as_str().unwrap().to_string();
    let running = h.job();
    let gen = h.run().gen;
    let mut n = next(&h);
    n["members"][0]["grade"] = json!("full");
    n["members"][0]["allowedCommands"] = json!(["cargo check"]);
    n["verifyAuto"] = json!(true);
    n["planTools"] = json!(true);
    n["wakeMax"] = json!(31);
    n["accept"]["require"] = json!([{"role": JUDGE, "passes": 1}]);
    change(&h, n, true, true).unwrap();
    assert_eq!(h.run().gen, gen, "구성 rev는 조정자 세대가 아니다");
    assert_eq!(running.turn.role.grade, Grade::Edit);
    assert!(running.turn.role.allowed_commands.is_empty(), "이미 도는 턴은 그대로");
    assert_eq!(h.o.turn_preflight(&h.id, &a).unwrap().unwrap().0.grade, Grade::Full);
    assert!(h.o.unattended_verify_ok(&h.id).is_ok());
    assert!(h.o.album_verify_preflight(&h.id, true).is_ok());
    let r = h.run();
    assert_eq!(
        album::accept_gate(&r, &inputs(), &r.tasks[0], Reviewer::Coordinator)
            .unwrap_err()
            .code,
        "accept-rule-unmet"
    );
    assert_eq!(
        h.o.album_producer_policy("pc-album-test").unwrap().unwrap(),
        ("C:/repo".into(), true, 31)
    );
    let task = h
        .call("create_task", json!({"requestId": "full-task", "title": "넓힌 뒤", "goal": "작업"}))
        .unwrap();
    let spawned = h
        .call(
            "spawn_worker",
            json!({"requestId": "full-spawn", "taskId": task["task"]["id"], "role": WRITE}),
        )
        .unwrap();
    let full_spawn = h.job();
    assert_eq!(full_spawn.turn.role.grade, Grade::Full);
    assert_eq!(full_spawn.turn.role.allowed_commands, ["cargo check"]);
    h.idle(spawned["attemptId"].as_str().unwrap());
    h.idle(&a);
    h.resume(&a, "full-turn").unwrap();
    let full = h.job();
    assert_eq!(full.turn.role.grade, Grade::Full);
    assert_eq!(full.turn.role.allowed_commands, ["cargo check"]);
    let mut n = next(&h);
    n["members"][0]["grade"] = json!("edit");
    n["members"][0]["allowedCommands"] = json!([]);
    n["verifyAuto"] = json!(false);
    n["planTools"] = json!(false);
    n["wakeMax"] = json!(0);
    change(&h, n, false, false).unwrap();
    assert_eq!(full.turn.role.grade, Grade::Full);
    let (fresh, minutes) = h.o.turn_preflight(&h.id, &a).unwrap().unwrap();
    assert_eq!(fresh.grade, Grade::Edit);
    assert!(fresh.allowed_commands.is_empty());
    assert_eq!(minutes, 73);
    assert_eq!(h.o.unattended_verify_ok(&h.id), Err("confirm-required"));
    assert_eq!(h.o.album_verify_preflight(&h.id, true), Err("confirm-required"));
    assert_eq!(
        h.o.album_producer_policy("pc-album-test").unwrap().unwrap(),
        ("C:/repo".into(), false, 0)
    );
    h.idle(&a);
    h.resume(&a, "edit-turn").unwrap();
    assert_eq!(h.job().turn.role.grade, Grade::Edit);
    h.idle(&a);
    // 다음 spawn_worker도 현재 rev를 읽는다.
    let t = h
        .call("create_task", json!({"requestId": "second-task", "title": "다음", "goal": "작업"}))
        .unwrap();
    h.call(
        "spawn_worker",
        json!({"requestId": "second-spawn", "taskId": t["task"]["id"], "role": WRITE}),
    )
    .unwrap();
    assert_eq!(h.job().turn.role.grade, Grade::Edit);
    let mut n = next(&h);
    n["members"][0]["grade"] = json!("read");
    change(&h, n, false, false).unwrap();
    assert_eq!(h.o.turn_preflight(&h.id, &a).unwrap_err().code, "role-read-only");
    assert_eq!(code(h.resume(&a, "read-turn")), "role-read-only");
    let mut n = next(&h);
    n["members"].as_array_mut().unwrap().remove(0);
    change(&h, n, false, false).unwrap();
    assert_eq!(h.o.turn_preflight(&h.id, &a).unwrap_err().code, "role-removed");
    assert_eq!(code(h.resume(&a, "removed-turn")), "role-removed");
    // 수락 규칙을 넓힘 명령으로 풀면 바로 다음 판정은 통과한다.
    let mut n = next(&h);
    n["accept"]["require"] = json!([]);
    change(&h, n, true, false).unwrap();
    let r = h.run();
    assert!(album::accept_gate(&r, &inputs(), &r.tasks[0], Reviewer::Coordinator).is_ok());
}

#[test]
fn album_audit_no_text() {
    let dir = std::env::temp_dir().join(format!("aynx-s4-{}", new_id("run").unwrap()));
    std::fs::create_dir_all(&dir).unwrap();
    let (h, audits, events) = observed(Some(dir.clone()));
    verify(&h);
    let mut n = next(&h);
    n["members"][0]["allowedCommands"] = json!(["비밀 아닌 허용 명령"]);
    n["planTools"] = json!(true);
    let result = change(&h, n, true, true).unwrap();
    let records: Vec<_> = audits.try_iter().filter(|a| a.event == "album_changed").collect();
    assert_eq!(records.len(), 1);
    let detail = serde_json::to_value(records[0].orchestration.as_ref().unwrap()).unwrap();
    assert_eq!(
        detail,
        json!({"gen": 1, "actor": "human", "rev": 2, "widened": true,
        "members": [{"artist": WRITE, "grade": "edit"}, {"artist": JUDGE, "grade": "read"}],
        "allowedCommands": 1, "verifyAuto": false, "planTools": true, "autoMerge": false, "wakeMax": 30})
    );
    let text = serde_json::to_string(&records[0]).unwrap();
    for body in ["비밀 아닌 허용 명령", "사람의 고정 검증", "지금 지침", "앨범 시험", "현재"] {
        assert!(!text.contains(body), "{body}");
    }
    assert_eq!(
        events.try_iter().collect::<Vec<_>>(),
        [json!({"runId": h.id, "seq": result["latestSeq"]})]
    );
    let r = h.run();
    let line = r.log.last().unwrap();
    assert_eq!(line.actor, Actor::Human);
    assert_eq!(line.action, "album_changed");
    assert_eq!(line.outcome, "rev 2");
    assert!(line.target.is_none());
    h.o.flush_saves();
    let saved: Value = serde_json::from_slice(&std::fs::read(dir.join(super::super::persist::file_name(&h.id))).unwrap()).unwrap();
    assert_eq!(saved["run"]["album"]["rev"], 2);
    assert_eq!(
        saved["run"]["album"]["members"][0]["allowedCommands"],
        json!(["비밀 아닌 허용 명령"])
    );
    assert_eq!(
        h.o.run_detail_fresh(&h.id).unwrap()["album"]["members"][0]["allowedCommands"],
        json!(["비밀 아닌 허용 명령"])
    );
    assert_eq!(h.call("get_run", json!({})).unwrap()["album"], json!({"rev": 2}));
    drop(h);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn album_changed_wakes_from_human_ledger() {
    use std::sync::atomic::{AtomicU64, Ordering};
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let c = clock.clone();
    let h = harness_with_clock(None, Arc::new(|_, _| {}), None, Arc::new(move || c.load(Ordering::SeqCst)));
    let from = h.run().seq;
    let mut n = next(&h);
    n["members"][0]["grade"] = json!("read");
    change(&h, n, false, false).unwrap();
    let r = h.run();
    let note = super::super::wake::WakeNote::build(&r, from, r.seq).unwrap();
    assert_eq!(note.items.len(), 1);
    assert_eq!(note.items[0].what.word(), "album-changed");
    assert_eq!(note.items[0].seq, r.seq);
    assert!(note.items[0].task.is_none() && note.items[0].attempt.is_none());
    let text = super::super::wake::wake_text(&note);
    assert!(text.contains("album-changed"));
    assert!(!text.contains("rev 2") && !text.contains("앨범 시험"));
    assert!(super::super::wake::parse_wake_note(&text).is_some());
    let seat = h.o.lock().runs[&h.id].coordinator.as_ref().unwrap().1.clone();
    assert_eq!(
        h.o.wake_check(&seat, true, None, None),
        super::super::wake::Due::At(1_000_000 + super::super::wake::BATCH_MS)
    );
    clock.fetch_add(super::super::wake::BATCH_MS, Ordering::SeqCst);
    assert_eq!(h.o.wake_check(&seat, true, None, None), super::super::wake::Due::Now);
    let wake = h.o.wake_reserve(&seat, None, None).unwrap();
    assert!(wake.text.contains("album-changed"));
    assert_eq!(h.run().wakes.last().unwrap().items[0].what, "album-changed");
}

#[test]
fn album_rename_human_only_and_name_rules() {
    let (h, audits, events) = observed(None);
    let before = h.run().album.unwrap();
    for bad in ["".into(), "   ".into(), "a\nb".into(), "a\0b".into(), "가".repeat(81)] {
        assert_eq!(
            handle("orchestration_rename_album", json!({"runId": h.id, "name": bad}), &h.o)
                .unwrap_err()
                .code,
            "bad-args"
        );
    }
    for name in ["가".repeat(80), "  새 앨범  ".into()] {
        let result = handle("orchestration_rename_album", json!({"runId": h.id, "name": name}), &h.o).unwrap();
        assert_eq!(result["name"], name.trim());
        assert_eq!(h.run().name, name.trim());
        let line = h.run().log.pop().unwrap();
        assert_eq!(line.actor, Actor::Human);
        assert_eq!(line.action, "album_renamed");
        assert_eq!(line.outcome, "renamed");
    }
    assert_eq!(
        serde_json::to_value(h.run().album.unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
    assert_eq!(events.try_iter().count(), 2);
    assert!(audits.try_recv().is_err(), "이름 본문을 감사에 더하지 않는다");
}

#[test]
fn album_config_has_no_mcp_writer() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![root.join("mcp.rs")];
    files.extend(
        std::fs::read_dir(root.join("mcp"))
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "rs")),
    );
    files.extend(
        [
            "server/ai.rs",
            "server/serve.rs",
            "orchestration/tools.rs",
            "orchestration/ops.rs",
            "server/orchestration_proxy.rs",
        ]
        .map(|p| root.join(p)),
    );
    let commands = ["orchestration_album_widen", "orchestration_album_set", "orchestration_rename_album"];
    for path in files {
        let src = std::fs::read_to_string(&path).unwrap();
        for writer in [
            "album_widen",
            "album_set",
            "rename_album",
            "change_album",
            "start_album_core",
            "artist_set",
            "artist_remove",
            "write_artists",
        ] {
            assert!(!src.contains(writer), "{}: {writer}", path.display());
        }
    }
    let lib = include_str!("../lib.rs");
    let h = harness();
    for cmd in commands {
        assert_eq!(lib.matches(cmd).count(), 1);
        // 목록 판정과 실제 디스패치를 모든 MCP 역할에서 함께 확인한다.
        let callers = [
            h.caller.clone(), Caller::Global, Caller::SideChat { chat: "side".into() },
            Caller::Tile { stream: "tile".into() },
            Caller::Producer { chat: "pc-writer".into(), proc: crate::server::chat_proc::ProcId::next() },
            Caller::Worker { run_id: h.id.clone(), gen: 1, attempt_id: "worker".into() },
            Caller::Reviewer { run_id: h.id.clone(), gen: 1, attempt_id: "judge".into() },
        ];
        for caller in &callers {
            assert!(!super::super::is_tool_for(caller, cmd));
            let e = h.o.call_tool(caller, cmd, Some(&json!({}))).unwrap_err();
            assert!(e.contains("Unknown tool"), "{cmd}: {e}");
        }
        assert!(!super::super::preallowed_tools().any(|name| name == cmd));
        assert_eq!(
            crate::server::ipc::frame::required_grade(cmd),
            Some(crate::server::ipc::Grade::Write)
        );
        assert!(crate::server::producer::is_producer_op(cmd));
    }
    assert!(!crate::server::producer::is_producer_op("producer_album_start_basic"));
    assert_eq!(crate::server::ipc::frame::required_grade("producer_album_start_basic"), None);
}

#[test]
fn album_change_reads_artists_outside_lock_and_preserves_joins() {
    let h = harness();
    let n = next(&h);
    let id = h.id.clone();
    let o = Arc::new(h.o);
    let weak = Arc::downgrade(&o);
    o.set_album_source(Arc::new(move |_| {
        assert!(
            weak.upgrade().unwrap().inner.try_lock().is_ok(),
            "아티스트 목록은 Run 잠금 밖에서 읽는다"
        );
        inputs()
    }));
    handle("orchestration_album_set", json!({"runId": id, "expectRev": 1, "next": n}), &o).unwrap();
    assert_eq!(o.lock().runs[&id].run.album.as_ref().unwrap().members[0].joined_rev, 1);
    let mut removed = n.clone();
    removed["members"].as_array_mut().unwrap().remove(0);
    handle("orchestration_album_set", json!({"runId": id, "expectRev": 2, "next": removed}), &o).unwrap();
    let mut rejoined = n;
    rejoined["members"][0]["grade"] = json!("read");
    handle(
        "orchestration_album_set",
        json!({"runId": id, "expectRev": 3, "next": rejoined}),
        &o,
    )
    .unwrap();
    let a = o.lock().runs[&id].run.album.clone().unwrap();
    assert_eq!(a.members[0].joined_rev, 4);
    assert_eq!(a.members[0].name, format!("현재 {WRITE}"));
    assert_eq!(a.members[1].joined_rev, 1);
}

#[test]
fn album_rev_conflict_serializes_writers() {
    let (h, audits, events) = observed(None);
    let n = next(&h);
    let id = h.id.clone();
    let o = Arc::new(h.o);
    let readers = Arc::new(std::sync::Barrier::new(2));
    o.set_album_source(Arc::new(move |_| {
        readers.wait();
        inputs()
    }));
    let handles: Vec<_> = [0, 1]
        .into_iter()
        .map(|cap| {
            let o = o.clone();
            let mut n = n.clone();
            n["wakeMax"] = json!(cap);
            let id = id.clone();
            std::thread::spawn(move || handle("orchestration_album_set", json!({"runId": id, "expectRev": 1, "next": n}), &o))
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(results.into_iter().find_map(Result::err).unwrap().code, "album-changed");
    assert_eq!(o.lock().runs[&id].run.album.as_ref().unwrap().rev, 2);
    assert_eq!(audits.try_iter().count(), 1);
    assert_eq!(events.try_iter().count(), 1);
}
