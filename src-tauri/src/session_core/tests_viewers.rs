//! 세션 코어의 **시청자**(원격 웹 R2-A — `viewers` 머리말) — 주 임대 규칙은 그대로, 시청자는 덧붙고, 크기 주인은 마지막 사람 입력.

use super::*;
use std::time::Instant;

const S: &str = "v-1";

fn opened(core: &mut Core, stream: &str, id: u32, window: &str) -> Keys {
    core.reserve(stream).expect("예약");
    core.commit(stream, Kind::Local, id, window, Instant::now())
}

fn viewer(core: &mut Core, window: &str, eligible: bool, size: Option<(u16, u16)>) -> Keys {
    core.attach_viewer(S, None, window, eligible, size).expect("시청자").keys
}

/// `(주인, 주인가, 적어 둔 크기)`.
type OwnerRow = (Option<u64>, bool, Option<(u16, u16)>);

fn owner_notes(notes: &[Note]) -> Vec<OwnerRow> {
    notes
        .iter()
        .filter_map(|n| match n {
            Note::Owner { owner, primary, size, .. } => Some((*owner, *primary, *size)),
            _ => None,
        })
        .collect()
}

fn gone_notes(notes: &[Note]) -> Vec<(u64, GoneReason)> {
    notes
        .iter()
        .filter_map(|n| match n {
            Note::ViewerGone { epoch, reason, .. } => Some((*epoch, *reason)),
            _ => None,
        })
        .collect()
}

/// 주 임대 규칙은 그대로(둘째 주 거절 · `take` 는 빼앗는다) — 시청자는 빼앗지 않고 덧붙으며, 열쇠는 주와 같은 카운터라 겹치지 않는다.
#[test]
fn viewers_attach_without_stealing_and_primary_rules_stay() {
    let mut core = Core::default();
    let p = opened(&mut core, S, 7, "main");
    let v1 = viewer(&mut core, "remote-a-1", true, None);
    let v2 = viewer(&mut core, "remote-b-1", false, None);
    assert_eq!((v1.lease_epoch, v2.lease_epoch), (2, 3), "주(1)와 겹치지 않는 회차");
    assert_eq!(core.check(S, 1, 1), Ok(7), "주는 그대로 붙어 있다");
    assert_eq!(core.attach(S, None, "tear-1", false).unwrap_err(), CoreError::Attached, "둘째 주는 여전히 거절");
    assert_eq!(core.holder(S, 1, v1.lease_epoch), Ok(Holder { kind: Kind::Local, id: 7, viewer: true }));
    assert_eq!(core.holder(S, 1, p.lease_epoch).map(|h| h.viewer), Ok(false));
    // 빼앗기 — 새 주의 회차는 시청자 뒤(4). 시청자는 그대로 산다.
    let t = core.attach(S, None, "tear-1", true).unwrap();
    assert_eq!(t.keys.lease_epoch, 4);
    assert_eq!(core.check(S, 1, 1), Err(CoreError::Stale), "옛 주는 낡았다");
    assert_eq!(core.viewer_epochs(S), vec![2, 3]);
    // 시청자의 닫기·체크포인트·떨어지기는 주의 일이다 — 낡은 열쇠로 거절.
    assert_eq!(core.close(Kind::Local, S, 1, 2), Err(CoreError::Stale));
    assert_eq!(core.check_owner(S, 1, 2), Err(CoreError::Stale));
    assert_eq!(core.detach(S, 1, 2), Err(CoreError::Stale));
}

/// 크기 주인 = 마지막 사람 입력(자격 있는 쪽) — 시청자가 치면 주인이 되고 적어 둔 크기가 노트에 실린다. 주인이 아닌 쪽의 resize 는 적기만
/// 한다(무시). 터미널 응답(`protocol`)·자격 없는 시청자는 주인을 바꾸지 않는다. 주가 다시 치면 주의 크기로 돌아간다.
#[test]
fn last_human_writer_owns_the_size() {
    let mut core = Core::default();
    let p = opened(&mut core, S, 7, "main");
    core.note_size(S, 1, 120, 40);
    let v = viewer(&mut core, "remote-a-1", true, Some((80, 24)));
    let phone = viewer(&mut core, "remote-p-1", false, Some((40, 20)));
    assert!(core.take_notes().is_empty(), "주가 있으면 시청자가 붙어도 주인은 주");
    assert_eq!(core.size_owner(S), Some(1));

    // 주인이 아닌 시청자의 resize — 적기만 하고 적용하지 않는다(오류 아님).
    assert_eq!(core.resize_request(S, 1, v.lease_epoch, 100, 30), Ok(None));
    // 주인(주)의 resize 는 적용한다.
    assert_eq!(core.resize_request(S, 1, 1, 120, 40).map(|h| h.is_some()), Ok(true));

    // 터미널 응답은 주인을 바꾸지 않는다.
    core.input(S, 1, v.lease_epoch, false).unwrap();
    assert_eq!(core.size_owner(S), Some(1));
    // 사람이 치면 바뀐다 — 그 시청자가 마지막에 요청한 크기(100×30)가 노트에 실린다.
    core.input(S, 1, v.lease_epoch, true).unwrap();
    assert_eq!(core.size_owner(S), Some(v.lease_epoch));
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(v.lease_epoch), false, Some((100, 30)))]);
    // 이제 주의 resize 는 무시된다(적기만).
    assert_eq!(core.resize_request(S, 1, p.lease_epoch, 130, 50), Ok(None));
    assert_eq!(core.resize_request(S, 1, v.lease_epoch, 90, 30).map(|h| h.is_some()), Ok(true));

    // 자격 없는 폰은 쳐도 주인이 되지 않는다(쓰기는 받는다).
    assert!(core.input(S, 1, phone.lease_epoch, true).is_ok());
    assert_eq!(core.size_owner(S), Some(v.lease_epoch));
    assert!(core.take_notes().is_empty());

    // 주가 다시 치면 주인 — 주가 마지막에 요청한 크기(130×50)로.
    core.input(S, 1, p.lease_epoch, true).unwrap();
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(1), true, Some((130, 50)))]);
}

/// 낡은 시청자 열쇠는 `[stale-lease]` — 뗀 뒤 · 다른 회차. 끝난 세션이면 `Gone`. 떼기는 멱등(이미 떨어졌으면 `false`).
#[test]
fn stale_viewer_keys_are_refused() {
    let mut core = Core::default();
    opened(&mut core, S, 7, "main");
    let v = viewer(&mut core, "remote-a-1", true, None);
    assert_eq!(core.detach_viewer(S, 1, v.lease_epoch), Ok(true));
    assert_eq!(core.detach_viewer(S, 1, v.lease_epoch), Ok(false), "멱등");
    assert_eq!(core.input(S, 1, v.lease_epoch, true).unwrap_err(), CoreError::Stale);
    assert_eq!(core.resize_request(S, 1, v.lease_epoch, 80, 24).unwrap_err(), CoreError::Stale);
    assert_eq!(core.holder(S, 2, 1).unwrap_err(), CoreError::Stale, "다른 회차");
    assert_eq!(core.detach_viewer(S, 2, 1).unwrap_err(), CoreError::Stale);
    assert_eq!(core.attach_viewer(S, Some(9), "remote-a-1", true, None).unwrap_err(), CoreError::Stale);
    assert_eq!(gone_notes(&core.take_notes()), vec![(v.lease_epoch, GoneReason::Detached)]);

    // 끝난 세션(붙은 채 끝남)은 시청자도 받지 않는다.
    let v2 = viewer(&mut core, "remote-a-1", true, None);
    core.exited(Kind::Local, 7, None, 10);
    assert_eq!(core.holder(S, 1, v2.lease_epoch).unwrap_err(), CoreError::Gone);
    assert_eq!(core.attach_viewer(S, None, "remote-b-1", true, None).unwrap_err(), CoreError::Gone);
}

/// 창이 사라지면(파괴 · 리로드) **그 창의 시청자만** 떨어진다 — 세션도 다른 창의 시청자도 그대로. 연결이 끊기면 그 연결의 것만.
#[test]
fn window_and_conn_loss_remove_only_their_viewers() {
    let mut core = Core::default();
    core.conn_opened(5);
    core.conn_opened(6);
    opened(&mut core, S, 7, "main");
    let a = viewer(&mut core, "remote-a-1", true, None);
    let b = viewer(&mut core, "remote-b-1", true, None);
    assert!(core.set_viewer_conn(&a, 5));
    assert!(core.set_viewer_conn(&b, 6));
    assert!(core.holds_viewer(&a, 5) && !core.holds_viewer(&a, 6));

    assert_eq!(core.remove_window_viewers("remote-a-1"), 1);
    assert_eq!(core.viewer_epochs(S), vec![b.lease_epoch]);
    assert_eq!(core.state_of_stream(S), Some("attached"), "세션은 닫지 않는다");
    assert_eq!(gone_notes(&core.take_notes()), vec![(a.lease_epoch, GoneReason::Window)]);

    // 리로드(`detach_window`) — 그 창의 주와 시청자를 함께 뗀다.
    let c = viewer(&mut core, "main", true, None);
    core.detach_window("main", &HashSet::new());
    assert_eq!(core.viewer_epochs(S), vec![b.lease_epoch]);
    assert_eq!(gone_notes(&core.take_notes()), vec![(c.lease_epoch, GoneReason::Window)]);

    // 연결 끊김 — 그 연결의 시청자만.
    core.detach_conn(6);
    assert!(core.viewer_epochs(S).is_empty());
    assert_eq!(gone_notes(&core.take_notes()), vec![(b.lease_epoch, GoneReason::Conn)]);
    // 끊긴 연결에 붙는 시청자는 서지 않는다.
    let late = viewer(&mut core, "remote-c-1", true, None);
    assert!(!core.set_viewer_conn(&late, 6));
    assert!(core.viewer_epochs(S).is_empty());
}

/// **주가 떠나도 시청자는 본다** — 세션은 `Detached`(떨어진 세션 목록), 크기 주인은 첫 자격 있는 시청자(적어 둔 크기). 자격 있는 쪽이 없으면
/// 주인 없음(서버가 질의에 답한다). 주가 다시 붙으면 주가 주인이다.
#[test]
fn primary_leaving_keeps_viewers_and_hands_over_the_size() {
    let mut core = Core::default();
    opened(&mut core, S, 7, "main");
    let phone = viewer(&mut core, "remote-p-1", false, Some((40, 20)));
    let pc = viewer(&mut core, "remote-a-1", true, Some((100, 30)));
    core.take_notes();
    core.detach(S, 1, 1).unwrap();
    assert_eq!(core.state_of_stream(S), Some("detached"));
    assert!(core.detached().iter().any(|r| r.stream == S), "떨어진 세션 목록에 오른다");
    assert_eq!(core.size_owner(S), Some(pc.lease_epoch), "자격 없는 폰은 건너뛴다");
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(pc.lease_epoch), false, Some((100, 30)))]);
    assert!(core.input(S, 1, phone.lease_epoch, true).is_ok(), "주 없이도 시청자의 쓰기는 받는다");

    // 자격 있는 시청자가 떠나면 주인 없음 → 서버가 답한다.
    core.detach_viewer(S, 1, pc.lease_epoch).unwrap();
    assert_eq!(core.size_owner(S), None);
    assert_eq!(owner_notes(&core.take_notes()), vec![(None, false, None)]);

    // 주가 다시 붙으면 주가 주인.
    let back = core.attach(S, None, "main", false).unwrap();
    assert_eq!(core.size_owner(S), Some(back.keys.lease_epoch));
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(back.keys.lease_epoch), true, None)]);
}

/// 세션을 닫는 것은 주의 일이고, 닫히면 **모든 시청자가 끝을 받는다**(노트 `Ended`). 떨어진 채 끝나 표에서 빠질 때도 같다.
#[test]
fn closing_or_ending_the_session_ends_every_viewer() {
    let mut core = Core::default();
    opened(&mut core, S, 7, "main");
    let a = viewer(&mut core, "remote-a-1", true, None);
    let b = viewer(&mut core, "remote-b-1", false, None);
    core.take_notes();
    assert_eq!(core.close(Kind::Local, S, 1, 1), Ok(Some(7)));
    assert_eq!(
        gone_notes(&core.take_notes()),
        vec![(a.lease_epoch, GoneReason::Ended), (b.lease_epoch, GoneReason::Ended)]
    );
    assert_eq!(core.holder(S, 1, a.lease_epoch).unwrap_err(), CoreError::Gone);

    // 떨어진 채(주 없음) 끝나면 표에서 곧바로 빠진다 — 시청자도 끝.
    let mut core = Core::default();
    opened(&mut core, S, 8, "main");
    let c = viewer(&mut core, "remote-a-1", true, None);
    core.detach(S, 1, 1).unwrap();
    core.take_notes();
    let exit = core.exited(Kind::Local, 8, None, 0).unwrap();
    assert!(exit.removed);
    assert_eq!(gone_notes(&core.take_notes()), vec![(c.lease_epoch, GoneReason::Ended)]);
}

/// 예산 초과로 뗀 시청자는 다시 붙어 새 열쇠를 받는다(옛 열쇠는 낡음). 주가 떨어진 세션(리로드 · GUI 종료)에도 시청자가 붙는다.
/// (3a — 서버가 주 없이 띄우던 오케스트레이션 작업자 세션은 걷혔다: 작업자는 헤드리스 턴이다.)
#[test]
fn overflow_drop_then_reattach_and_viewers_on_a_detached_session() {
    let mut core = Core::default();
    let p0 = opened(&mut core, "det-w", 9, "main");
    core.detach("det-w", 1, p0.lease_epoch).unwrap();
    let v = core.attach_viewer("det-w", Some(1), "remote-a-1", true, None).unwrap().keys;
    assert_eq!(v.lease_epoch, 2, "주(1) 뒤의 회차");
    assert_eq!(core.size_owner("det-w"), Some(2), "주가 없으면 자격 있는 시청자가 주인");
    assert!(core.drop_viewer("det-w", 1, 2, GoneReason::Overflow));
    assert_eq!(core.holder("det-w", 1, 2).unwrap_err(), CoreError::Stale);
    assert_eq!(core.size_owner("det-w"), None);
    let again = core.attach_viewer("det-w", Some(1), "remote-a-1", true, None).unwrap().keys;
    assert_eq!(again.lease_epoch, 3, "새 열쇠");
    // 주가 다시 붙으면 주는 회차 4 — 시청자와 겹치지 않는다.
    let p = core.attach("det-w", Some(1), "main", false).unwrap();
    assert_eq!(p.keys.lease_epoch, 4);
    assert_eq!(core.live_resource("det-w"), Some((Kind::Local, 9, 1)));
}

/// **주인의 크기**(R2-B — 주인이 아닌 쪽이 그 크기로 그린다). 주가 다시 붙으면(리로드) 주가 주인이고, 그 크기는 붙기 **뒤에** 적힌다 —
/// 서버는 노트를 비울 때 `owner_size` 로 지금 크기를 다시 읽는다(노트 때의 크기는 아직 없다). 끝난 세션은 정보가 없다.
#[test]
fn owner_size_follows_the_owner_and_a_reattached_primary() {
    let mut core = Core::default();
    let p = opened(&mut core, S, 7, "main");
    core.note_size(S, p.lease_epoch, 120, 40);
    let v = viewer(&mut core, "remote-a-1", true, Some((80, 24)));
    assert_eq!(core.owner_size(S), Some((120, 40)), "주가 주인");
    assert_eq!(core.owner_info(S), Some((1, Some(1), true, 1)));
    // 시청자가 친다 — 주인 · 크기가 시청자 것.
    core.input(S, 1, v.lease_epoch, true).unwrap();
    assert_eq!(core.owner_size(S), Some((80, 24)));
    assert_eq!(core.owner_info(S), Some((1, Some(v.lease_epoch), false, 1)));
    // 주가 떠났다 다시 붙는다(리로드) — 노트 때는 새 주의 크기가 없고, 붙은 뒤 적으면 그것이 주인 크기.
    core.detach(S, 1, p.lease_epoch).unwrap();
    let back = core.attach(S, Some(1), "main", false).unwrap();
    let notes = core.take_notes();
    assert_eq!(owner_notes(&notes).last(), Some(&(Some(back.keys.lease_epoch), true, None)), "노트 때는 크기를 모른다");
    core.note_size(S, back.keys.lease_epoch, 150, 45);
    assert_eq!(core.owner_size(S), Some((150, 45)), "비울 때 다시 읽으면 새 주의 크기");
    core.close(Kind::Local, S, 1, back.keys.lease_epoch).unwrap();
    assert_eq!(core.owner_info(S), None);
}

/// **크기 되찾기**(10-20 — [이 창 크기로]) — 입력 없이 주인을 이 쪽으로: 크기를 적고 노트에 싣는다(서버가 건다). 이미 주인이면 노트 없이
/// `changed: false`. 자격 없는 폰 시청자는 되찾지 못한다(크기만 적힌다 · 오류 아님). 주(집 PC)도 시청자에게서 되찾는다.
#[test]
fn claim_switches_the_owner_without_input() {
    let mut core = Core::default();
    let p = opened(&mut core, S, 7, "main");
    core.note_size(S, p.lease_epoch, 120, 40);
    let v = viewer(&mut core, "remote-a-1", true, Some((80, 24)));
    let phone = viewer(&mut core, "remote-p-1", false, Some((40, 20)));
    core.input(S, 1, v.lease_epoch, true).unwrap();
    core.take_notes();
    assert_eq!(core.size_owner(S), Some(v.lease_epoch), "원격이 쳐서 주인");

    // 집 PC(주)가 되찾는다 — 새 크기로.
    let c = core.claim_size_owner(S, 1, p.lease_epoch, 130, 42).unwrap();
    assert_eq!((c.owner, c.changed, c.holder.viewer), (true, true, false));
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(p.lease_epoch), true, Some((130, 42)))]);
    assert_eq!(core.owner_size(S), Some((130, 42)));

    // 이미 주인 — 노트 없이 크기만 적는다(부른 쪽이 resize 처럼 건다).
    let again = core.claim_size_owner(S, 1, p.lease_epoch, 131, 42).unwrap();
    assert_eq!((again.owner, again.changed), (true, false));
    assert!(core.take_notes().is_empty());
    assert_eq!(core.owner_size(S), Some((131, 42)));

    // 자격 없는 폰은 되찾지 못한다 — 주인 그대로 · 크기는 적힌다.
    let no = core.claim_size_owner(S, 1, phone.lease_epoch, 41, 21).unwrap();
    assert_eq!((no.owner, no.changed), (false, false));
    assert!(core.take_notes().is_empty());
    assert_eq!(core.size_owner(S), Some(p.lease_epoch));

    // 자격 있는 시청자는 되찾는다.
    let back = core.claim_size_owner(S, 1, v.lease_epoch, 90, 30).unwrap();
    assert_eq!((back.owner, back.changed, back.holder.viewer), (true, true, true));
    assert_eq!(owner_notes(&core.take_notes()), vec![(Some(v.lease_epoch), false, Some((90, 30)))]);
}

/// 낡은 열쇠의 되찾기는 `[stale-lease]` — 뗀 시청자 · 다른 회차 · 빼앗긴 옛 주. 끝난 세션이면 `Gone`. 주인은 그대로.
#[test]
fn stale_claims_are_refused() {
    let mut core = Core::default();
    opened(&mut core, S, 7, "main");
    let v = viewer(&mut core, "remote-a-1", true, None);
    assert_eq!(core.detach_viewer(S, 1, v.lease_epoch), Ok(true));
    assert_eq!(core.claim_size_owner(S, 1, v.lease_epoch, 80, 24).unwrap_err(), CoreError::Stale);
    assert_eq!(core.claim_size_owner(S, 2, 1, 80, 24).unwrap_err(), CoreError::Stale, "다른 회차");
    let t = core.attach(S, None, "tear-1", true).unwrap();
    assert_eq!(core.claim_size_owner(S, 1, 1, 80, 24).unwrap_err(), CoreError::Stale, "빼앗긴 옛 주");
    assert_eq!(core.size_owner(S), Some(t.keys.lease_epoch));
    assert!(crate::session_core::refuse("claim_size", S, CoreError::Stale).contains("stale-lease"));
    core.exited(Kind::Local, 7, None, 10);
    assert_eq!(core.claim_size_owner(S, 1, t.keys.lease_epoch, 80, 24).unwrap_err(), CoreError::Gone);
}
