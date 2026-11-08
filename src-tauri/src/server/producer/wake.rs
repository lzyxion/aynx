//! **앱이 깨움 — 레지스트리 몫**(오케스트레이션 2단계 단계 4 — 설계 aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 3-5).
//! 재료 · 판정 · 장부는 `orchestration::wake`(L1)이고, 여기는 **언제 보고 · 어떻게 쓰나**다.
//!
//! - 보는 때: 프로듀서 시계(`wake_reaper` — 1초마다 · 깨우면 곧바로)가 [`tick`] 을 부른다. 새 사건이 없어도 시한(턴 끝 + 2초 · 첫 후보 + 3초 ·
//!   마지막 예약 + 20초 · 재시도)이 차면 다시 판정한다.
//! - 예약 세 걸음(설계 3-5 — 잠금 순서 2-6): ① L4 — 쉬면(대기열 빔 · 보류 없음 · 권한 대기 없음 · 프로세스 준비) 전송기를 `WakeReserved` 로(이
//!   순간부터 사람 글은 대기열로) → 놓음 → ② L1 `wake_reserve`(조건 재판정 · 문장 · 장부) → ③ L4 — 예약이 그대로면 **같은 전송기**
//!   [`super::dispatch`] 로 쓴다 · 아니면 거두고 그 사이 대기열에 든 사람 글부터 보낸다.
//! - 깨움 턴 시한(30분)을 넘기면 그 턴에 끊기 의도를 붙여 끊는다(대기열은 곧바로) — 시계가 붙이는 유일한 끊기.
//!
//! **L4(채팅 잠금)를 쥔 채 오케스트레이션을 부르지 않는다** — 늦은 일은 [`super::orch_later`](시험 `producer_lock_order` 가 이 파일도 본다).
//! 깨움은 프로듀서 채팅에만 — 여기서 보는 것은 프로듀서 채팅 레지스트리뿐이고 타일 PTY 에 쓰는 길은 없다(타일은 조정자 자리가 되지 못한다).

use std::sync::Arc;

use super::{dispatch, lock, now_ms, orch, orch_later, seat, send_interrupt, Life, ProducerChat, State, TABLE};
use crate::orchestration::wake::{Due, WakeEnd};
use crate::orchestration::Orchestration;
use crate::server::chat_proc::{ProcId, Status};
use super::input::Next;

/// 쉬나(설계 3-5 의 조건 중 레지스트리 몫).
fn idle(st: &State) -> bool {
    st.life == Life::Live
        && st.core.has_proc()
        && st.core.status() == Status::Ready
        && !st.input.busy()
        && st.input.queue.is_empty()
        && !st.input.held
        && !st.core.has_pending()
        && !st.read_only
}

/// 한 번 본다(시계) — 채팅마다 판정하고 지금이면 깨운다.
pub(super) fn tick() {
    let Some(o) = orch() else { return };
    let chats: Vec<Arc<ProducerChat>> = lock(&TABLE).chats.values().cloned().collect();
    // 지금 앨범의 상한을 넘긴다. 앨범 없음·신원/구성 판정 실패는 0으로 닫는다.
    for c in chats {
        let (proc, idle_now, rest) = {
            let st = lock(&c.st);
            (st.core.live(), idle(&st), st.last_turn_end)
        };
        let Some(proc) = proc else { continue };
        let s = seat(&c.id, proc);
        if o.wake_overdue(&s).is_some() {
            let mut st = lock(&c.st);
            if st.core.live() == Some(proc) && st.input.stop_wake() {
                send_interrupt(&c, &mut st);
            }
            continue;
        }
        let cap = match o.album_producer_policy(&c.id) {
            Some(policy) => Some(policy.map_or(0, |(_, _, max)| max)),
            None => Some(0),
        };
        if o.wake_check(&s, idle_now, rest, cap) == Due::Now {
            fire(&c, &o, proc);
        }
    }
}

/// **깨운다**(설계 3-5 의 세 걸음).
fn fire(c: &Arc<ProducerChat>, o: &Orchestration, proc: ProcId) {
    // 사람 말 사이 상한 — 예약마다 지금 Run.album.wake_max에서(앨범 신원 판정 포함).
    let cap = match o.album_producer_policy(&c.id) {
        Some(policy) => policy.map_or(0, |(_, _, max)| max),
        None => 0,
    };
    // ① L4 — 전송기를 예약한다.
    let rest = {
        let mut st = lock(&c.st);
        if st.core.live() != Some(proc) || !idle(&st) || !st.input.reserve_wake() {
            return;
        }
        st.last_turn_end
    };
    // ② L1 — 다시 판정 · 문장 · 장부.
    let s = seat(&c.id, proc);
    let reserved = o.wake_reserve(&s, rest, Some(cap));
    // ③ L4 — 예약이 그대로면 같은 전송기로 쓴다.
    let mut st = lock(&c.st);
    let kept = st.input.wake_reserved() && st.core.live() == Some(proc);
    let Some(r) = reserved else {
        if let Next::Dispatch { src, text } = st.input.release_wake(now_ms()) {
            dispatch(c, &mut st, src, text);
        }
        return;
    };
    let wake_id = r.wake_id.clone();
    if kept {
        let src = st.input.start_wake(&r.wake_id, &r.text, now_ms());
        st.wake_view = Some(r.event);
        let text = r.text;
        if dispatch(c, &mut st, src, text) {
            return;
        }
        st.wake_view = None;
        orch_later(move |o| o.wake_ended(&s, &wake_id, WakeEnd::Unacked));
        return;
    }
    // 그 사이 프로세스가 끝났다 — 예약한 깨움은 나가지 않았다.
    let end = if st.core.live() == Some(proc) { WakeEnd::Unacked } else { WakeEnd::Exited };
    if let Next::Dispatch { src, text } = st.input.release_wake(now_ms()) {
        dispatch(c, &mut st, src, text);
    }
    orch_later(move |o| o.wake_ended(&s, &wake_id, end));
}
