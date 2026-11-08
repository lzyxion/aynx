//! **호출자 · 역할** — 조정자 묶음(시험의 묶기 · 지금 세대 · 조정자 호출자) · 역할 토큰 해석(`resolve` — 상수 시간 비교) · 작업자 슬롯 예약 ·
//! 작업자 토큰 발급과 거두기(`revoke_*` · `unbind_coordinator` · `coordinates`). 토큰 표는 부모(`store.rs`)의 `Inner.tokens` 하나다(자기 잠금 없음).
//! `store.rs` 에서 그대로 옮겼다.

use super::*;

impl Orchestration {
    /// 지금 세대 번호(조율을 받는 Run — running · paused 만). 중단 중 · 끝 · orphaned 면 `None`. **시험 전용**(3차 6단계 — 사람이 띄우는
    /// 조정자 타일 길과 op `orchestration_active_gen` 은 걷었다).
    #[cfg(test)]
    pub(crate) fn active_gen(&self, run_id: &str) -> Option<u32> {
        self.lock()
            .runs
            .get(run_id)
            .filter(|s| matches!(s.run.state, RunState::Running | RunState::Paused))
            .map(|s| s.run.gen)
    }

    /// 시험 자리([`Seat::test`] — 채팅 id 하나 · 세대 없음)를 이 Run 세대에 묶는다 — **시험 전용**(제품에서 묶음이 서는 길은 프로듀서 채팅의
    /// `start_run` · `adopt_run` 뿐 — `start.rs`). 이 묶음이 **조정자 역할**이다 — 그 자리의 호출자(`Caller::Producer{chat, ProcId::NONE}`)가
    /// 조정자로 판정된다(`tile.rs`). 지금 세대가 아니면 `stale-generation`, 그 자리가 이미 **다른** 산 Run 의 조정자면 `already-coordinating`. 같은
    /// Run 에 다른 자리가 묶여 있었으면 그 묶음은 풀린다(한 Run 의 조정자는 하나). 사건이 아니라 seq 를 올리지 않는다(메모리 칸 하나).
    #[cfg(test)]
    pub(crate) fn bind_coordinator(&self, run_id: &str, gen: u32, chat: &str) -> Result<(), OrchError> {
        if chat.is_empty() || chat.len() > 256 || chat.chars().any(char::is_control) {
            return Err(OrchError::new(reason::INVALID_ARGUMENT, "chat must be 1..256 printable characters"));
        }
        self.bind_seat_for_test(run_id, gen, &Seat::test(chat))
    }

    /// [`Self::bind_coordinator`] 의 몸 — 자리를 그대로 받는다(진짜 세대의 시험 프로듀서 `chat_token::FakeProducer` 를 묶을 때). **시험 전용**.
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

    /// **시험 전용** — 그 Run 의 지금 세대 조정자 호출자(자리 판정을 거친 뒤의 모양 — `tile.rs`). 조율 도구 몸의 시험이 자리 · 묶음 없이 부른다
    /// (자리 → 조정자 판정 자체는 `tests_tile.rs` · `tests_producer.rs` · `tests_headless.rs` 가 본다). 살아 있는 Run 이 아니면 `None`(옛 조정자 토큰과 같은 뜻).
    #[cfg(test)]
    pub(crate) fn coordinator_caller(&self, run_id: &str) -> Option<Caller> {
        let g = self.lock();
        let s = g.runs.get(run_id).filter(|s| s.run.state.active())?;
        Some(Caller::Coordinator {
            run_id: run_id.to_string(),
            gen: s.run.gen,
        })
    }

    /// `Authorization` 머리 → 역할 호출자(작업자 · 검토자 — 턴 토큰). 전역 토큰 · 타일 토큰은 여기서 보지 않는다(`mcp/http.rs` — 조정자는 타일
    /// 토큰에 묶음이 붙인 역할이다). 모르는 토큰 · 빈 토큰이면 `None`.
    pub(crate) fn resolve(&self, header: Option<&str>) -> Option<Caller> {
        let presented = header?.strip_prefix("Bearer ")?.trim();
        if presented.is_empty() {
            return None;
        }
        let g = self.lock();
        // 상수 시간 비교로 **전부** 훑는다(일찍 빠지지 않는다 — 어느 칸에서 맞았는지가 시간으로 새지 않게).
        let mut hit: Option<&Binding> = None;
        for (t, b) in &g.tokens {
            if crate::token::ct_eq(t.as_bytes(), presented.as_bytes()) {
                hit = Some(b);
            }
        }
        let b = hit?;
        // 표에 남아 있어도 Run 이 살아 있어야 한다(거둠과 경합하는 틈을 한 번 더 막는다).
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

    // -----------------------------------------------------------------------
    // 3단계가 쓰는 자리(작업자 슬롯 · 작업자 토큰) — 지금은 단위 시험만 부른다
    // -----------------------------------------------------------------------

    /// 작업자 슬롯 하나를 **원자적으로** 예약한다 — 동시(산 Attempt + 예약) < 동시 한도, 총(Attempt + 예약) < 총 한도.
    #[cfg_attr(not(test), allow(dead_code))] // 3단계(`spawn_worker`)가 쓴다.
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

    /// 예약 반납(생성 실패 · Attempt 로 선 뒤).
    #[cfg_attr(not(test), allow(dead_code))] // 3단계가 쓴다.
    pub(crate) fn release_worker(&self, run_id: &str) {
        if let Some(slot) = self.lock().runs.get_mut(run_id) {
            slot.reserved_workers = slot.reserved_workers.saturating_sub(1);
        }
    }

    /// 작업자 토큰을 뽑는다(그 Run 의 Attempt 에만).
    #[cfg_attr(not(test), allow(dead_code))] // 3단계가 쓴다.
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

/// 이 Run 의 역할 토큰(작업자 · 검토자)을 모두 거두고 조정자 묶음을 푼다 — Run 이 끝났을 때(stopped · done — 살아 있는 작업자가 없다).
/// 묶였던 자리의 늦은 조율 요청은 `run-ended`(3차 4단계 · 설계 3-1 표 "Run 끝").
pub(in crate::orchestration) fn revoke_run(g: &mut Inner, run_id: &str) {
    g.tokens.retain(|(_, b)| b.run_id != run_id);
    if let Some(slot) = g.runs.get_mut(run_id) {
        unbind_coordinator(slot);
    }
}

/// 이 Run 의 조정자 묶음만 푼다(중단 즉시 — 작업자 토큰은 그 프로세스 종료 확인까지 남는다, 사용자 결정 1). 조정자 토큰은 없고
/// 조정자 = 프로듀서 채팅 토큰 + 이 묶음이라, 묶음을 푸는 것이 곧 조정자 역할을 거두는 것이다(채팅 토큰 자체는 그 프로세스 것 — 남는다).
pub(in crate::orchestration) fn revoke_coordinator(g: &mut Inner, run_id: &str) {
    if let Some(slot) = g.runs.get_mut(run_id) {
        unbind_coordinator(slot);
    }
}

/// 조정자 묶음을 푼다 — 풀린 자리는 [`Slot::past_coordinators`] 로(최근 8개). 풀린 묶음의 세대(없었으면 `None`). (2단계 단계 2 — 설계 2-5 ·
/// 3-3) 그 자리의 `wait_run` 을 취소하고(`cancel_gen` +1 — 부르는 쪽이 `changed` 를 깨운다) 잠정 커서를 되돌린다.
pub(in crate::orchestration) fn unbind_coordinator(slot: &mut Slot) -> Option<u32> {
    let (gen, seat) = slot.coordinator.take()?;
    slot.past_coordinators.retain(|s| *s != seat);
    if slot.past_coordinators.len() >= 8 {
        slot.past_coordinators.pop_front();
    }
    slot.past_coordinators.push_back(seat);
    slot.cursor.cancel_gen += 1;
    slot.cursor.pending = slot.cursor.committed;
    // (단계 4 — 설계 3-4 "오류 끝 · 프로세스 끝") 나가 있던 깨움은 그 자리와 함께 끝난다 — 범위는 그대로(처리 끝을 올리지 않는다)라 다시 묶인
    // 새 자리가 이어받은 뒤 깨운다. 재시도 · 셈은 Run 에 남는다.
    slot.wake.live = None;
    Some(gen)
}

/// 자리를 묶는다(세대 `gen`) — 새 자리의 커서는 옛 자리의 `committed` 를 물려받지 않는다(설계 3-3 끝 문단 — 0 에서 · 취소 세대는 이어 센다).
pub(in crate::orchestration) fn bind_seat(slot: &mut Slot, gen: u32, seat: Seat) {
    slot.past_coordinators.retain(|s| *s != seat);
    slot.cursor = SeatCursor { committed: 0, pending: 0, cancel_gen: slot.cursor.cancel_gen + 1 };
    slot.coordinator = Some((gen, seat));
}

/// 이 Run 이 지금 이 자리를 조정자로 쥐는가 — 묶음이 **지금 세대**이고 Run 이 조율을 받는 상태(running · paused)일 때만. 자리는
/// `(chat, proc)` 을 **정확히** 견준다(다시 띄운 같은 채팅은 다른 자리).
pub(in crate::orchestration) fn coordinates(slot: &Slot, seat: &Seat) -> bool {
    matches!(slot.run.state, RunState::Running | RunState::Paused)
        && slot.coordinator.as_ref().is_some_and(|(gen, s)| *gen == slot.run.gen && s == seat)
}

/// 이 Run 에 지금 세대의 조정자가 묶여 있는가(자리 무관) — "조정자 있음" 의 판정은 `pause_reason` 이 아니라 이 묶음이다(사람 [재개] 의
/// `no-coordinator` · `adopt_run` 의 대상 · 보기의 `coordinatorAttached`). 사람 일시정지 · 보류 중에 프로세스가 끝나도 까닭 글자는 그대로라서.
pub(in crate::orchestration) fn has_coordinator(slot: &Slot) -> bool {
    slot.coordinator.as_ref().is_some_and(|(gen, _)| *gen == slot.run.gen)
}

/// Attempt 하나의 작업자 토큰을 거둔다(프로세스 종료 확인 · 생성 실패).
pub(in crate::orchestration) fn revoke_worker(g: &mut Inner, attempt_id: &str) {
    g.tokens.retain(|(_, b)| b.attempt_id.as_deref() != Some(attempt_id));
}
