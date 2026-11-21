//! 호출자 · 역할 — 조정자 묶음 · 역할 토큰 해석 · 작업자 슬롯 예약 · 토큰 발급과 거두기. 토큰 표는 `store.rs` 의 `Inner.tokens` 하나다(자기 잠금 없음).

use super::*;

impl Orchestration {
    #[cfg(test)]
    pub(crate) fn active_gen(&self, run_id: &str) -> Option<u32> {
        self.lock()
            .runs
            .get(run_id)
            .filter(|s| matches!(s.run.state, RunState::Running | RunState::Paused))
            .map(|s| s.run.gen)
    }

    /// 시험 전용 — 제품에서 묶음이 서는 길은 사람의 앨범 시작(`producer_album_start`) · `adopt_run` 뿐이다.
    #[cfg(test)]
    pub(crate) fn bind_coordinator(&self, run_id: &str, gen: u32, chat: &str) -> Result<(), OrchError> {
        if chat.is_empty() || chat.len() > 256 || chat.chars().any(char::is_control) {
            return Err(OrchError::new(reason::INVALID_ARGUMENT, "chat must be 1..256 printable characters"));
        }
        self.bind_seat_for_test(run_id, gen, &Seat::test(chat))
    }

    #[cfg(test)]
    pub(crate) fn bind_seat_for_test(&self, run_id: &str, gen: u32, seat: &Seat) -> Result<(), OrchError> {
        let mut g = self.lock();
        let elsewhere = g.runs.iter().find_map(|(id, s)| (id != run_id && coordinates(s, seat)).then(|| id.clone()));
        if let Some(other) = elsewhere {
            return Err(OrchError::new(
                reason::ALREADY_COORDINATING,
                format!("this chat already coordinates run {other} — one chat coordinates one run"),
            ));
        }
        let slot = human_slot(&mut g, run_id)?;
        if !matches!(slot.run.state, RunState::Running | RunState::Paused) {
            return Err(state_error(slot.run.state));
        }
        if slot.run.gen != gen {
            return Err(OrchError::new(
                reason::STALE_GENERATION,
                format!("the run is at generation {} — this coordinator belongs to an older one", slot.run.gen),
            ));
        }
        if slot.coordinator.as_ref().is_some_and(|(_, s)| s != seat) {
            unbind_coordinator(slot);
        }
        bind_seat(slot, gen, seat.clone());
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn coordinator_caller(&self, run_id: &str) -> Option<Caller> {
        let g = self.lock();
        let s = g.runs.get(run_id).filter(|s| s.run.state.active())?;
        Some(Caller::Coordinator {
            run_id: run_id.to_string(),
            gen: s.run.gen,
        })
    }

    /// 작업자 · 검토자의 턴 토큰만 본다 — 조정자는 프로듀서 채팅 토큰에 서버 표의 묶음이 붙인 역할이다.
    pub(crate) fn resolve(&self, header: Option<&str>) -> Option<Caller> {
        let presented = header?.strip_prefix("Bearer ")?.trim();
        if presented.is_empty() {
            return None;
        }
        let g = self.lock();
        // 일찍 빠지지 않는다 — 어느 칸에서 맞았는지가 시간으로 새지 않게.
        let mut hit: Option<&Binding> = None;
        for (t, b) in &g.tokens {
            if crate::token::ct_eq(t.as_bytes(), presented.as_bytes()) {
                hit = Some(b);
            }
        }
        let b = hit?;
        // 거둠과 경합하는 틈을 한 번 더 막는다.
        let run = &g.runs.get(&b.run_id)?.run;
        if !run.state.active() {
            return None;
        }
        Some(match b.role {
            Role::Worker => Caller::Worker {
                run_id: b.run_id.clone(),
                gen: b.gen,
                attempt_id: b.attempt_id.clone().unwrap_or_default(),
            },
            Role::Reviewer => Caller::Reviewer {
                run_id: b.run_id.clone(),
                gen: b.gen,
                attempt_id: b.attempt_id.clone().unwrap_or_default(),
            },
        })
    }

    // ── 작업자 슬롯 · 작업자 토큰 — 지금은 단위 시험만 부른다 ──

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn reserve_worker(&self, run_id: &str) -> Result<(), OrchError> {
        let mut g = self.lock();
        let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
        writable(&slot.run)?;
        let l = slot.run.limits;
        let live = slot.run.live_workers() as u32 + slot.reserved_workers;
        let total = slot.run.worker_count() as u32 + slot.reserved_workers;
        if live >= l.max_concurrent_workers {
            return Err(OrchError::new(
                reason::WORKER_LIMIT,
                format!("at most {} workers can run at once in this run", l.max_concurrent_workers),
            ));
        }
        if total >= l.max_total_workers {
            return Err(OrchError::new(
                reason::WORKER_LIMIT,
                format!("this run may start at most {} workers in total", l.max_total_workers),
            ));
        }
        slot.reserved_workers += 1;
        Ok(())
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn release_worker(&self, run_id: &str) {
        if let Some(slot) = self.lock().runs.get_mut(run_id) {
            slot.reserved_workers = slot.reserved_workers.saturating_sub(1);
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn issue_worker_token(&self, run_id: &str, attempt_id: &str) -> Result<String, OrchError> {
        let token = crate::token::generate_token().ok_or_else(no_randomness)?;
        let mut g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
        if !slot.run.state.active() {
            return Err(state_error(slot.run.state));
        }
        let gen = slot
            .run
            .attempts
            .iter()
            .find(|a| a.id == attempt_id)
            .map(|a| a.gen)
            .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no attempt {attempt_id} in this run")))?;
        g.tokens.push((
            token.clone(),
            Binding {
                role: Role::Worker,
                run_id: run_id.to_string(),
                gen,
                attempt_id: Some(attempt_id.to_string()),
            },
        ));
        Ok(token)
    }
}

/// Run 이 끝났을 때(살아 있는 작업자가 없다)만 — 묶였던 자리의 늦은 조율 요청은 `run-ended`.
pub(in crate::orchestration) fn revoke_run(g: &mut Inner, run_id: &str) {
    g.tokens.retain(|(_, b)| b.run_id != run_id);
    if let Some(slot) = g.runs.get_mut(run_id) {
        unbind_coordinator(slot);
    }
}

/// 중단 즉시 — 작업자 토큰은 그 프로세스 종료 확인까지 남는다(사용자 결정). 묶음을 푸는 것이 곧 조정자 역할을 거두는 것이다(채팅 토큰은 남는다).
pub(in crate::orchestration) fn revoke_coordinator(g: &mut Inner, run_id: &str) {
    if let Some(slot) = g.runs.get_mut(run_id) {
        unbind_coordinator(slot);
    }
}

/// 그 자리의 `wait_run` 을 취소하고 잠정 커서를 되돌린다 — 부르는 쪽이 `changed` 를 깨운다.
pub(in crate::orchestration) fn unbind_coordinator(slot: &mut Slot) -> Option<u32> {
    let (gen, seat) = slot.coordinator.take()?;
    slot.past_coordinators.retain(|s| *s != seat);
    if slot.past_coordinators.len() >= 8 {
        slot.past_coordinators.pop_front();
    }
    slot.past_coordinators.push_back(seat);
    slot.cursor.cancel_gen += 1;
    slot.cursor.pending = slot.cursor.committed;
    // 나가 있던 깨움은 그 자리와 함께 끝난다 — 처리 끝을 올리지 않으므로 다시 묶인 새 자리가 이어받은 뒤 깨운다.
    slot.wake.live = None;
    Some(gen)
}

/// 새 자리의 커서는 옛 자리의 `committed` 를 물려받지 않는다(취소 세대는 이어 센다).
pub(in crate::orchestration) fn bind_seat(slot: &mut Slot, gen: u32, seat: Seat) {
    slot.past_coordinators.retain(|s| *s != seat);
    slot.cursor = SeatCursor { committed: 0, pending: 0, cancel_gen: slot.cursor.cancel_gen + 1 };
    slot.coordinator = Some((gen, seat));
}

/// 자리는 `(chat, proc)` 을 정확히 견준다 — 다시 띄운 같은 채팅은 다른 자리다.
pub(in crate::orchestration) fn coordinates(slot: &Slot, seat: &Seat) -> bool {
    matches!(slot.run.state, RunState::Running | RunState::Paused)
        && slot.coordinator.as_ref().is_some_and(|(gen, s)| *gen == slot.run.gen && s == seat)
}

/// "조정자 있음" 의 판정은 `pause_reason` 이 아니라 이 묶음이다 — 사람 일시정지 · 보류 중에 프로세스가 끝나도 까닭 글자는 그대로라서.
pub(in crate::orchestration) fn has_coordinator(slot: &Slot) -> bool {
    slot.coordinator.as_ref().is_some_and(|(gen, _)| *gen == slot.run.gen)
}

pub(in crate::orchestration) fn revoke_worker(g: &mut Inner, attempt_id: &str) {
    g.tokens.retain(|(_, b)| b.attempt_id.as_deref() != Some(attempt_id));
}
