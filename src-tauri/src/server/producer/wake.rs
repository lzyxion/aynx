//! 앱이 깨움 — 레지스트리 몫(설계 docs/log/2026-10-30-orchestration-structured-producer.md). 재료 · 판정 · 장부는 `orchestration::wake`(L1)이다.
//!
//! - 깨움 글은 서버가 Run 장부에서 만든 것뿐이다 — 프로듀서 채팅 stdin 에는 사람 입력과 이것만 든다(→ docs/architecture.md `arch-orch-spawn`).
//! - 예약은 세 걸음 — L4 에서 전송기를 `WakeReserved` 로(이 순간부터 사람 글은 대기열로) → 놓고 L1 재판정 → L4 에서 예약이 그대로일 때만
//!   **같은 전송기**([`super::dispatch`])로 쓴다.
//! - **L4(채팅 잠금)를 쥔 채 오케스트레이션을 부르지 않는다** — 늦은 일은 [`super::orch_later`](시험 `producer_lock_order` 가 이 파일도 본다).
//! - 깨움은 프로듀서 채팅에만 — 타일 PTY 에 쓰는 길은 없다(시험 `wake_never_for_tile_seat`).

use std::sync::Arc;

use super::{dispatch, lock, now_ms, orch, orch_later, seat, send_interrupt, Life, ProducerChat, State, TABLE};
use crate::orchestration::wake::{Due, WakeEnd};
use crate::orchestration::Orchestration;
use crate::server::chat_proc::{ProcId, Status};
use super::input::Next;

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

fn fire(c: &Arc<ProducerChat>, o: &Orchestration, proc: ProcId) {
    // 사람 말 사이 상한 — 예약마다 지금 Run.album.wake_max에서(앨범 신원 판정 포함).
    let cap = match o.album_producer_policy(&c.id) {
        Some(policy) => policy.map_or(0, |(_, _, max)| max),
        None => 0,
    };
    // ① L4
    let rest = {
        let mut st = lock(&c.st);
        if st.core.live() != Some(proc) || !idle(&st) || !st.input.reserve_wake() {
            return;
        }
        st.last_turn_end
    };
    // ② L1
    let s = seat(&c.id, proc);
    let reserved = o.wake_reserve(&s, rest, Some(cap));
    // ③ L4
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
