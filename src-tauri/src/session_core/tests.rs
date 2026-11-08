//! 세션 코어 표 — 임대·예약·떨어짐·종료 장부·체크포인트 (설계 4.3 · 10절 F5 행의 Rust 몫).

use super::*;
use std::collections::HashSet;
use std::time::{Duration, Instant};

const S: &str = "s-1";

fn opened(core: &mut Core, stream: &str, id: u32, window: &str) -> Keys {
    core.reserve(stream).expect("예약");
    core.commit(stream, Kind::Local, id, window, Instant::now())
}

fn cp(session_epoch: u64, consumed: u64) -> Checkpoint {
    Checkpoint {
        buffer: "screen".into(),
        cols: 80,
        rows: 24,
        consumed,
        session_epoch,
    }
}

#[test]
fn open_issues_first_lease_and_old_lease_is_refused() {
    let mut core = Core::default();
    let k = opened(&mut core, S, 7, "main");
    assert_eq!((k.session_epoch, k.lease_epoch), (1, 1));
    assert_eq!(core.check(S, 1, 1), Ok(7));
    assert_eq!(core.check(S, 1, 2), Err(CoreError::Stale));
    assert_eq!(core.check(S, 2, 1), Err(CoreError::Stale));
    assert_eq!(core.check("nope", 1, 1), Err(CoreError::Gone));
}

#[test]
fn reservation_refuses_a_live_stream_and_a_second_open() {
    let mut core = Core::default();
    core.reserve(S).unwrap();
    assert_eq!(core.reserve(S), Err(CoreError::Busy), "진행 중인 열기");
    core.commit(S, Kind::Local, 1, "main", Instant::now());
    assert_eq!(core.reserve(S), Err(CoreError::Alive), "붙어 있음 → 붙으라");
    core.detach(S, 1, 1).unwrap();
    assert_eq!(
        core.reserve(S),
        Err(CoreError::Alive),
        "떨어져 있어도 살아 있다"
    );

    // 끝난 세션은 새 회차가 덮는다.
    core.exited(Kind::Local, 1, None, 10);
    let mut core2 = Core::default();
    let k = opened(&mut core2, S, 1, "main");
    core2.exited(Kind::Local, 1, Some("코드 1".into()), 5);
    core2.reserve(S).expect("끝난 스트림은 다시 연다");
    let k2 = core2.commit(S, Kind::Local, 2, "main", Instant::now());
    assert_eq!(
        k2.session_epoch,
        k.session_epoch + 1,
        "같은 스트림을 다시 열면 회차 +1"
    );
    assert_eq!(core2.stream_of(Kind::Local, 1), None, "옛 손잡이는 지워졌다");
    assert_eq!(core2.stream_of(Kind::Local, 2).as_deref(), Some(S));

    // 예약을 풀면 다시 잡힌다.
    let mut core3 = Core::default();
    core3.reserve(S).unwrap();
    core3.unreserve(S);
    core3.reserve(S).expect("풀린 예약");
}

#[test]
fn attach_bumps_the_lease_refuses_a_second_window_and_take_steals() {
    let mut core = Core::default();
    opened(&mut core, S, 3, "main");
    assert_eq!(
        core.attach(S, None, "main", false).unwrap_err(),
        CoreError::Attached,
        "붙어 있는 세션에 빼앗기 없이 붙지 않는다"
    );
    core.detach(S, 1, 1).unwrap();
    let a = core.attach(S, Some(1), "main", false).unwrap();
    assert_eq!(
        (a.id, a.keys.lease_epoch, a.taken_from.clone()),
        (3, 2, None)
    );
    assert_eq!(
        core.check(S, 1, 1),
        Err(CoreError::Stale),
        "리로드 전 손잡이는 낡았다"
    );
    assert_eq!(core.check(S, 1, 2), Ok(3));

    assert_eq!(
        core.attach(S, None, "tear-9", false).unwrap_err(),
        CoreError::Attached,
        "둘째 창은 거절"
    );
    let b = core.attach(S, None, "tear-9", true).unwrap();
    assert_eq!(b.taken_from.as_deref(), Some("main"));
    assert_eq!(b.keys.lease_epoch, 3);
    assert_eq!(
        core.check(S, 1, 2),
        Err(CoreError::Stale),
        "빼앗긴 임대는 즉시 낡는다"
    );
    assert_eq!(core.homes(Kind::Local), vec![(3, "tear-9".to_string())]);

    assert_eq!(
        core.attach(S, Some(9), "x", true).unwrap_err(),
        CoreError::Stale,
        "회차가 다르면"
    );
}

#[test]
fn detach_is_idempotent_for_the_same_lease_and_refuses_an_old_one() {
    let mut core = Core::default();
    opened(&mut core, S, 1, "main");
    assert_eq!(core.detach(S, 1, 1), Ok(Some((Kind::Local, 1))));
    assert_eq!(core.detach(S, 1, 1), Ok(None), "같은 임대의 두 번째 detach");
    assert_eq!(
        core.check(S, 1, 1),
        Err(CoreError::Stale),
        "떨어진 뒤 쓰기는 거부"
    );
    core.attach(S, None, "main", false).unwrap();
    assert_eq!(
        core.detach(S, 1, 1),
        Err(CoreError::Stale),
        "옛 페이지의 늦은 detach"
    );
}

#[test]
fn reload_detaches_only_this_windows_attached_sessions_and_destroyed_still_finds_them() {
    let mut core = Core::default();
    opened(&mut core, "a", 1, "main");
    opened(&mut core, "b", 2, "main");
    opened(&mut core, "c", 3, "tear-1");
    opened(&mut core, "d", 4, "main");
    let held: HashSet<(Kind, u32)> = [(Kind::Local, 4)].into_iter().collect();
    let got = core.detach_window("main", &held);
    assert_eq!(
        got,
        vec![
            (Kind::Local, 1, "a".to_string()),
            (Kind::Local, 2, "b".to_string())
        ]
    );
    assert!(core.check("c", 1, 1).is_ok(), "다른 창은 그대로");
    assert!(core.check("d", 1, 1).is_ok(), "이관 중인 것은 그대로");
    // 떨어진 세션도 책임 창은 남는다 — 창 파괴 거둠(`reap::doomed`)이 그 라벨로 닫는다.
    let doomed = crate::reap::doomed(&core.homes(Kind::Local), "main", u32::MAX, &HashSet::new());
    assert_eq!(doomed, vec![1, 2, 4]);
    // 리로드는 거울을 남길 살아 있는 스트림을 안다.
    let live = core.live_streams_of("main");
    assert_eq!(
        live,
        ["a", "b", "d"].into_iter().map(String::from).collect()
    );
}

#[test]
fn exit_while_attached_waits_for_close_and_exit_while_detached_is_removed_now() {
    let mut core = Core::default();
    opened(&mut core, "a", 1, "main");
    let e = core.exited(Kind::Local, 1, None, 120).unwrap();
    assert!(!e.removed);
    assert_eq!(core.probe("a", Instant::now()).state, "exited");
    assert_eq!(
        core.check("a", 1, 1),
        Err(CoreError::Gone),
        "끝난 세션에 쓰지 않는다"
    );
    assert_eq!(core.reserve("a"), Ok(()), "끝난 스트림은 다시 연다");
    core.unreserve("a");
    assert_eq!(
        core.close(Kind::Local, "a", 1, 1),
        Ok(Some(1)),
        "창의 닫기는 끝난 뒤에도 받는다"
    );
    assert_eq!(core.close(Kind::Local, "a", 1, 1), Ok(None), "두 번째 닫기는 멱등");

    opened(&mut core, "b", 2, "main");
    core.detach("b", 1, 1).unwrap();
    let e = core.exited(Kind::Local, 2, Some("코드 3".into()), 9).unwrap();
    assert!(e.removed, "붙은 창 없이 끝난 셸은 표에 남지 않는다");
    assert_eq!(core.probe("b", Instant::now()).state, "none");
    assert!(core.homes(Kind::Local).is_empty());
    assert_eq!(core.exited(Kind::Local, 99, None, 0), None);
}

#[test]
fn close_refuses_an_old_session_epoch_or_lease() {
    let mut core = Core::default();
    opened(&mut core, S, 1, "main");
    core.detach(S, 1, 1).unwrap();
    core.attach(S, None, "main", false).unwrap();
    assert_eq!(
        core.close(Kind::Local, S, 1, 1),
        Err(CoreError::Stale),
        "옛 임대의 늦은 닫기가 새 세션을 죽이지 않는다"
    );
    assert_eq!(core.close(Kind::Local, S, 2, 2), Err(CoreError::Stale));
    assert_eq!(core.close(Kind::Local, S, 1, 2), Ok(Some(1)));
    // 떨어진 세션도 같은 임대의 닫기는 받는다(보조 창 닫기와 pagehide 의 detach 가 엇갈려도 닫힌다).
    opened(&mut core, "x", 5, "main");
    core.detach("x", 1, 1).unwrap();
    assert_eq!(core.close(Kind::Local, "x", 1, 1), Ok(Some(5)));
    assert_eq!(core.close(Kind::Local, "missing", 1, 1), Ok(None));
}

#[test]
fn unclaimed_are_detached_sessions_of_this_window_not_kept_by_restore() {
    let mut core = Core::default();
    opened(&mut core, "kept", 1, "main");
    opened(&mut core, "orphan", 2, "main");
    opened(&mut core, "other", 3, "tear-1");
    opened(&mut core, "attached", 4, "main");
    core.detach_window("main", &[(Kind::Local, 4)].into_iter().collect());
    core.detach_window("tear-1", &HashSet::new());
    let keep: HashSet<String> = ["kept".to_string()].into_iter().collect();
    assert_eq!(core.unclaimed("main", &keep), vec![(Kind::Local, 2)]);
    assert_eq!(core.unclaimed("tear-1", &keep), vec![(Kind::Local, 3)]);
    assert_eq!(core.remove_id(Kind::Local, 2).as_deref(), Some("orphan"));
    assert_eq!(core.unclaimed("main", &keep), Vec::<(Kind, u32)>::new());
    // 붙어 있다 끝났는데 그 창이 다시 떠 닫기를 못 받은 것도 데려가지 않으면 치운다.
    opened(&mut core, "ended", 6, "main");
    core.exited(Kind::Local, 6, None, 0);
    assert_eq!(core.unclaimed("main", &keep), vec![(Kind::Local, 6)]);
}

#[test]
fn checkpoints_follow_the_session_epoch_ttl_and_size() {
    let mut core = Core::default();
    let t0 = Instant::now();
    opened(&mut core, S, 1, "main");
    assert_eq!(
        core.put_checkpoint(S, cp(2, 0), t0),
        Err(CoreError::Stale),
        "다른 회차"
    );
    assert_eq!(
        core.put_checkpoint("none", cp(1, 0), t0),
        Err(CoreError::Gone)
    );
    let mut big = cp(1, 0);
    big.buffer = "x".repeat(CHECKPOINT_MAX_BYTES + 1);
    assert_eq!(core.put_checkpoint(S, big, t0), Err(CoreError::TooLarge));

    core.put_checkpoint(S, cp(1, 10), t0).unwrap();
    core.put_checkpoint(S, cp(1, 42), t0).unwrap();
    let p = core.probe(S, t0);
    assert_eq!(p.state, "attached");
    assert_eq!(p.checkpoint.unwrap().consumed, 42, "세션당 최근 1장");

    // 살아 있는 세션의 화면은 5분이 지나도 남는다 — GUI 를 끄고 몇 시간 뒤 다시 켜도 그 화면부터 그린다(③ 뒤 · 10절 GUI 종료 행).
    let later = t0 + CHECKPOINT_TTL + Duration::from_secs(1);
    assert_eq!(
        core.probe(S, later).checkpoint.map(|c| c.consumed),
        Some(42),
        "살아 있는 세션의 화면은 수명이 없다"
    );
    let much_later = t0 + Duration::from_secs(8 * 3600);
    assert!(core.probe(S, much_later).checkpoint.is_some(), "여덟 시간 뒤에도");

    core.put_checkpoint(S, cp(1, 1), later).unwrap();
    core.drop_checkpoint(S);
    assert!(core.probe(S, later).checkpoint.is_none(), "붙은 뒤 지운다");
    core.put_checkpoint(S, cp(1, 1), later).unwrap();
    core.close(Kind::Local, S, 1, 1).unwrap();
    opened(&mut core, S, 2, "main");
    assert!(
        core.probe(S, later).checkpoint.is_none(),
        "닫으면 체크포인트도 간다"
    );
}

/// `beforeunload` 의 맡기기가 `pagehide` 의 detach 뒤에 닿아도 받되, 늦게 온 옛 화면이 새 화면을 덮지 않는다(실기).
#[test]
fn a_late_checkpoint_of_the_same_lease_is_kept_but_never_older_than_the_newest() {
    let mut core = Core::default();
    let t0 = Instant::now();
    opened(&mut core, S, 1, "main");
    core.detach(S, 1, 1).unwrap();
    core.put_checkpoint(S, cp(1, 50), t0).unwrap();
    assert_eq!(core.check_owner(S, 1, 1), Ok(1), "막 떨어진 같은 임대");
    core.put_checkpoint(S, cp(1, 40), t0).unwrap();
    assert_eq!(
        core.probe(S, t0).checkpoint.unwrap().consumed,
        50,
        "옛 화면은 덮지 않는다"
    );
    core.attach(S, None, "main", false).unwrap();
    assert_eq!(
        core.check_owner(S, 1, 1),
        Err(CoreError::Stale),
        "새 임대가 선 뒤엔 낡았다"
    );
    core.exited(Kind::Local, 1, None, 0);
    assert_eq!(core.check_owner(S, 1, 2), Err(CoreError::Gone));
}

#[test]
fn adopt_moves_the_lease_for_handoff() {
    let mut core = Core::default();
    opened(&mut core, S, 8, "main");
    core.set_home(Kind::Local, 8, "tear-2");
    assert_eq!(core.homes(Kind::Local), vec![(8, "tear-2".to_string())]);
    let k = core.adopt(Kind::Local, 8, "tear-2").unwrap();
    assert_eq!(k.lease_epoch, 2);
    assert_eq!(
        core.check(S, 1, 1),
        Err(CoreError::Stale),
        "보낸 창의 손잡이는 낡았다"
    );
    assert_eq!(core.check(S, 1, 2), Ok(8));
    assert_eq!(core.adopt(Kind::Local, 99, "x"), None);
}

#[test]
fn errors_carry_their_reason_codes() {
    use crate::errors::has_reason;
    assert!(has_reason(
        &CoreError::Stale.message(),
        crate::errors::STALE_LEASE
    ));
    assert!(has_reason(
        &CoreError::Alive.message(),
        crate::errors::SESSION_ALIVE
    ));
    assert!(has_reason(
        &CoreError::Busy.message(),
        crate::errors::SESSION_BUSY
    ));
    assert!(has_reason(
        &CoreError::Attached.message(),
        crate::errors::SESSION_ATTACHED
    ));
    assert!(has_reason(
        &CoreError::Gone.message(),
        crate::errors::SESSION_GONE
    ));
}


// ---------------------------------------------------------------------------
// ②-2 — SSH 대화형 타일이 같은 표에 오른다
// ---------------------------------------------------------------------------

fn opened_ssh(core: &mut Core, stream: &str, id: u32, window: &str) -> Keys {
    core.reserve(stream).expect("예약");
    core.commit(stream, Kind::Ssh, id, window, Instant::now())
}

/// 두 자원 표의 id 카운터는 따로 돈다 — 로컬 3번과 SSH 3번이 표에서 서로를 덮거나 지우지 않는다.
#[test]
fn ssh_and_local_ids_never_collide() {
    let mut core = Core::default();
    opened(&mut core, "loc", 3, "main");
    opened_ssh(&mut core, "rem", 3, "main");
    assert_eq!(core.stream_of(Kind::Local, 3).as_deref(), Some("loc"));
    assert_eq!(core.stream_of(Kind::Ssh, 3).as_deref(), Some("rem"));
    assert_eq!(core.homes(Kind::Ssh), vec![(3, "main".to_string())]);
    assert_eq!(core.homes(Kind::Local), vec![(3, "main".to_string())]);
    assert_eq!(core.remove_id(Kind::Ssh, 3).as_deref(), Some("rem"));
    assert_eq!(
        core.stream_of(Kind::Local, 3).as_deref(),
        Some("loc"),
        "SSH 를 지워도 로컬은 그대로"
    );
    // 종류가 다른 명령은 없는 세션이다 — 로컬 write 로 SSH 스트림을 건드리지 못한다.
    opened_ssh(&mut core, "rem2", 4, "main");
    assert_eq!(core.check_kind(Kind::Local, "rem2", 1, 1), Err(CoreError::Gone));
    assert_eq!(core.check_kind(Kind::Ssh, "rem2", 1, 1), Ok(4));
    assert_eq!(
        core.close(Kind::Local, "rem2", 1, 1),
        Ok(None),
        "로컬 닫기는 SSH 를 닫지 않는다"
    );
    assert_eq!(core.close(Kind::Ssh, "rem2", 1, 1), Ok(Some(4)));
}

/// SSH 임대·예약 — 로컬과 같은 규칙(열기 1, 붙기 +1, 옛 임대 거부, 살아 있으면 `[session-alive]`).
#[test]
fn ssh_lease_and_reservation_follow_the_local_rules() {
    let mut core = Core::default();
    let k = opened_ssh(&mut core, S, 9, "main");
    assert_eq!((k.session_epoch, k.lease_epoch), (1, 1));
    assert_eq!(core.reserve(S), Err(CoreError::Alive));
    assert_eq!(core.detach(S, 1, 1), Ok(Some((Kind::Ssh, 9))));
    assert_eq!(core.reserve(S), Err(CoreError::Alive), "떨어진 SSH 도 살아 있다");
    let p = core.probe(S, Instant::now());
    assert_eq!((p.state, p.kind), ("detached", Some("ssh")));
    let a = core.attach(S, Some(1), "main", false).unwrap();
    assert_eq!((a.kind, a.id, a.keys.lease_epoch), (Kind::Ssh, 9, 2));
    assert_eq!(core.check_kind(Kind::Ssh, S, 1, 1), Err(CoreError::Stale));
    assert_eq!(core.check_kind(Kind::Ssh, S, 1, 2), Ok(9));
    // 이관 재부착(`reattach_output`)도 SSH 임대를 빼앗아 옮긴다.
    let k = core.adopt(Kind::Ssh, 9, "tear-1").unwrap();
    assert_eq!(k.lease_epoch, 3);
    assert_eq!(core.homes(Kind::Ssh), vec![(9, "tear-1".to_string())]);
    assert_eq!(core.check_kind(Kind::Ssh, S, 1, 2), Err(CoreError::Stale));
}

/// 리로드 = detach(SSH 도) · 파괴 = 종료(책임 창으로 고른다) · 이관 중인 SSH 는 건드리지 않는다.
#[test]
fn reload_detaches_ssh_too_and_destroyed_finds_detached_ssh_by_home() {
    let mut core = Core::default();
    opened(&mut core, "l", 1, "main");
    opened_ssh(&mut core, "r", 1, "main");
    opened_ssh(&mut core, "moving", 2, "main");
    let skip: HashSet<(Kind, u32)> = [(Kind::Ssh, 2)].into_iter().collect();
    let got = core.detach_window("main", &skip);
    assert_eq!(
        got,
        vec![
            (Kind::Local, 1, "l".to_string()),
            (Kind::Ssh, 1, "r".to_string())
        ]
    );
    assert_eq!(core.probe("r", Instant::now()).state, "detached");
    assert_eq!(core.probe("moving", Instant::now()).state, "attached");
    let live = core.live_streams_of("main");
    assert!(live.contains("r") && live.contains("l"), "리로드는 SSH 거울도 남긴다");
    let doomed = crate::reap::doomed(&core.homes(Kind::Ssh), "main", u32::MAX, &HashSet::new());
    assert_eq!(doomed, vec![1, 2], "창 파괴는 떨어진 SSH 까지 닫는다");
}

/// 전송로 끊김 — 붙어 있으면 `Disconnected` 로 남고(재접속이 새 회차로 덮는다), 떨어져 있으면 곧바로 지운다.
#[test]
fn disconnect_while_attached_waits_for_reconnect_with_a_new_epoch() {
    let mut core = Core::default();
    opened_ssh(&mut core, S, 5, "main");
    let e = core
        .ended(
            Kind::Ssh,
            5,
            End::Disconnected {
                at_ms: 42,
                reason: Some("keepalive".into()),
            },
        )
        .unwrap();
    assert!(!e.removed);
    assert_eq!(e.session_epoch, 1);
    assert_eq!(core.probe(S, Instant::now()).state, "disconnected");
    assert_eq!(core.check_kind(Kind::Ssh, S, 1, 1), Err(CoreError::Gone), "끊긴 채널에 쓰지 않는다");
    assert_eq!(core.detach(S, 1, 1), Err(CoreError::Gone));
    assert_eq!(core.attach(S, None, "main", false).unwrap_err(), CoreError::Gone);
    // 겹친 기록(펌프 끝 + 전송로 끊김)은 무시된다.
    let again = core.ended(
        Kind::Ssh,
        5,
        End::Exited {
            reason: None,
            final_offset: 7,
        },
    );
    assert_eq!(again.map(|e| e.removed), Some(false));
    assert_eq!(core.probe(S, Instant::now()).state, "disconnected");
    // 재접속 = 새 채널 = 새 세션 — 끊긴 항목을 덮고 회차 +1.
    core.reserve(S).expect("끊긴 스트림은 다시 연다");
    let k = core.commit(S, Kind::Ssh, 6, "main", Instant::now());
    assert_eq!((k.session_epoch, k.lease_epoch), (2, 1));
    assert_eq!(core.stream_of(Kind::Ssh, 5), None, "옛 손잡이는 지워졌다");
    // 옛 손잡이의 늦은 닫기는 새 세션을 죽이지 않는다.
    assert_eq!(core.close(Kind::Ssh, S, 1, 1), Err(CoreError::Stale));
    assert_eq!(core.check_kind(Kind::Ssh, S, 2, 1), Ok(6));

    // 떨어진 채 끊겼다 — 표에서 곧바로 빠진다(부른 쪽이 거울·자원을 거둔다).
    opened_ssh(&mut core, "d", 8, "main");
    core.detach("d", 1, 1).unwrap();
    let e = core
        .ended(
            Kind::Ssh,
            8,
            End::Disconnected {
                at_ms: 1,
                reason: None,
            },
        )
        .unwrap();
    assert!(e.removed);
    assert_eq!(core.probe("d", Instant::now()).state, "none");
    assert!(core.homes(Kind::Ssh).iter().all(|(id, _)| *id != 8));
}

/// 떨어진 채 원격 `exit` — 표에서 즉시 삭제, 붙어 있었으면 `Exited` 로 남아 창의 닫기를 기다린다.
#[test]
fn ssh_exit_while_detached_is_removed_now_and_unclaimed_includes_ended_ssh() {
    let mut core = Core::default();
    opened_ssh(&mut core, "a", 1, "main");
    core.detach("a", 1, 1).unwrap();
    let e = core.exited(Kind::Ssh, 1, None, 99).unwrap();
    assert!(e.removed);
    assert_eq!(core.state_of_stream("a"), None);

    opened_ssh(&mut core, "b", 2, "main");
    let e = core.exited(Kind::Ssh, 2, Some("코드 1".into()), 5).unwrap();
    assert!(!e.removed);
    assert_eq!(core.state_of_stream("b"), Some("exited"));
    assert_eq!(core.close(Kind::Ssh, "b", 1, 1), Ok(Some(2)), "끝난 뒤의 닫기도 받는다");
    assert_eq!(core.close(Kind::Ssh, "b", 1, 1), Ok(None), "멱등");

    // 복원이 데려가지 않은 것 — 떨어진 SSH · 끊긴 채 창이 다시 떠 닫기를 못 받은 SSH.
    opened_ssh(&mut core, "orphan", 3, "main");
    opened_ssh(&mut core, "gone", 4, "main");
    opened(&mut core, "loc", 4, "main");
    core.ended(
        Kind::Ssh,
        4,
        End::Disconnected {
            at_ms: 0,
            reason: None,
        },
    );
    core.detach_window("main", &HashSet::new());
    let keep: HashSet<String> = ["loc".to_string()].into_iter().collect();
    assert_eq!(
        core.unclaimed("main", &keep),
        vec![(Kind::Ssh, 3), (Kind::Ssh, 4)]
    );
    assert_eq!(core.state_of_stream("orphan"), Some("detached"));
}

/// **③-4 — 복원이 데려가지 않은 세션은 닫지 않는다**(옛 `release_unclaimed` 임시 정책 제거). 떨어진 채 남아 "복원이 데려가지 않음"
/// 표시만 붙고 떨어진 세션 목록에 오른다. 끝난 잔해만 돌려준다(부른 쪽이 거둔다). 다시 붙으면 표시가 걷힌다.
#[test]
fn restore_done_keeps_unclaimed_sessions_alive_and_lists_them() {
    let mut core = Core::default();
    opened(&mut core, "kept", 1, "main");
    opened(&mut core, "orphan", 2, "main");
    opened(&mut core, "tear-lost", 3, "tear-1");
    opened(&mut core, "ended", 4, "main");
    core.exited(Kind::Local, 4, None, 0);
    core.detach_window("main", &HashSet::new());
    core.detach_window("tear-1", &HashSet::new());
    let keep: HashSet<String> = ["kept".to_string()].into_iter().collect();
    let (ended, marked) = core.restore_done("main", &keep);
    assert_eq!(ended, vec![(Kind::Local, 4)], "끝난 잔해만");
    assert_eq!(marked, vec!["orphan".to_string()]);
    assert_eq!(core.state_of_stream("orphan"), Some("detached"), "닫지 않는다 — 살아 있다");
    assert_eq!(core.live_count(), 3, "kept·orphan·tear-lost — 끝난 잔해는 살아 있는 수에 없다");
    // 다시 불러도 같은 것을 두 번 표시하지 않는다.
    assert!(core.restore_done("main", &keep).1.is_empty());

    let rows = core.detached();
    let streams: Vec<&str> = rows.iter().map(|r| r.stream.as_str()).collect();
    assert_eq!(rows.len(), 3, "{streams:?}");
    assert!(rows.iter().all(|r| r.detached_at_ms.is_some()));
    let orphan = rows.iter().find(|r| r.stream == "orphan").unwrap();
    assert!(orphan.unclaimed && orphan.home == "main");
    assert!(!rows.iter().find(|r| r.stream == "tear-lost").unwrap().unclaimed);

    // [새 탭에 붙이기] — 붙으면 표시·떨어진 시각이 걷힌다.
    core.attach("orphan", None, "main", false).unwrap();
    assert!(core.detached().iter().all(|r| r.stream != "orphan"));
    // [닫기] — 떨어져 있을 때만 표에서 뺀다(붙은 것은 건드리지 않는다).
    assert_eq!(core.take_detached("orphan"), None, "붙어 있다");
    assert_eq!(core.take_detached("tear-lost"), Some((Kind::Local, 3)));
    assert_eq!(core.state_of_stream("tear-lost"), None);
}

/// **③-4 — 로컬 "AI 읽기 허용" 은 세션 메타**: 적어 두면 떨어졌다 다시 묻는 `probe` 가 돌려준다(GUI 재시작 뒤 되살리기). 끝난
/// 세션에는 적지 않는다.
#[test]
fn ai_read_lives_in_session_meta_and_survives_detach() {
    let mut core = Core::default();
    opened(&mut core, S, 9, "main");
    assert!(!core.probe(S, Instant::now()).ai_read);
    assert!(core.set_ai_read(S, true));
    core.detach_window("main", &HashSet::new());
    assert!(core.probe(S, Instant::now()).ai_read);
    assert!(core.detached()[0].ai_read);
    assert!(!core.set_ai_read("missing", true));
    core.attach(S, None, "main", false).unwrap();
    core.exited(Kind::Local, 9, None, 0);
    assert!(!core.set_ai_read(S, false), "끝난 세션에는 적지 않는다");
}

/// **재리뷰 R02 — 연결이 끊긴 뒤에 끝난 열기·붙기는 떨어진 세션이 된다.** `detach_conn` 이 연결을 죽은 것으로 적는 같은 잠금
/// 안에서 `set_lease_conn` 이 살아 있는지 보므로, 늦게 끝난 열기는 죽은 연결에 `Attached` 로 남지 않는다(아무도 떼지 않는 임대).
#[test]
fn a_lease_on_a_gone_conn_is_left_detached() {
    let mut core = Core::default();
    core.conn_opened(5);

    // 산 연결 — 예전 그대로 붙고, 그 연결이 끊기면 떨어진다.
    let k = opened(&mut core, "live", 1, "main");
    assert!(core.set_lease_conn("live", 5));
    assert!(core.holds_lease(&k, 5));
    assert!(!core.holds_lease(&k, 6), "다른 연결의 임대가 아니다");

    // 열기가 도는 사이 연결이 끊겼다 — 끊긴 뒤에 선 세션.
    core.reserve("late").expect("예약");
    let detached = core.detach_conn(5);
    assert_eq!(detached, vec![(Kind::Local, 1, "live".to_string())]);
    let late = core.commit("late", Kind::Local, 2, "main", Instant::now());
    assert!(!core.set_lease_conn("late", 5), "끊긴 연결에는 임대를 적지 않는다");
    assert_eq!(core.probe("late", Instant::now()).state, "detached");
    assert!(!core.holds_lease(&late, 5));
    assert_eq!(core.detached().len(), 2, "떨어진 세션 목록에 오른다");

    // 붙기도 같다 — 끊긴 연결로 붙은 것은 곧바로 떨어진다(다음 붙기의 회차는 그대로 오른다).
    let got = core.attach("late", None, "main", false).expect("붙기");
    assert!(!core.set_lease_conn("late", 5));
    assert_eq!(core.state_of_stream("late"), Some("detached"));
    assert!(!core.holds_lease(&got.keys, 5));

    // 한 번도 서지 않은 연결도 산 것이 아니다 · 같은 프로세스(0)는 늘 산 것으로 본다.
    let k0 = core.attach("live", None, "main", false).expect("붙기").keys;
    assert!(core.set_lease_conn("live", 0));
    assert!(core.holds_lease(&k0, 0));
    core.detach_window("main", &HashSet::new());
    core.attach("live", None, "main", false).expect("붙기");
    assert!(!core.set_lease_conn("live", 99));
}
