//! **자리 → 조정자 판정**(3차 4단계 — 설계 3-1 · 리뷰 D4 · 2단계 2-3) — `/mcp` 가 채팅 토큰으로 정한 [`Caller::Producer`] 의 조율 요청을, 서버 표의
//! 묶음(`Slot.coordinator = (gen, Seat{chat, proc})`)과 요청의 **예상 `runId` · `gen`** 으로 [`Caller::Coordinator`] 로 올린다. 조율 도구의 몸
//! (`tools.rs` · `attempts.rs` …)은 지금처럼 `Caller::Coordinator` 만 받는다 — 그 호출자를 만드는 운영 길은 이 파일 하나다(파일 이름은 3차의 "타일"
//! 그대로).
//!
//! 판정 순서(한 잠금 안):
//! 1. 인자 — `runId` · `gen` 은 **필수**(`get_run` 만 생략 가능 — 조정자가 자기 Run 의 `runId` · `gen` 을 읽는 길이고 읽기 전용이라 다른 Run 에
//!    적용될 효과가 없다). 모양이 틀리면 `invalid-argument`.
//! 2. 그 자리가 **지금 세대**로 묶인 산 Run(running · paused)이 있으면: 요청의 `runId` 가 다르면 `stale-run`(그 Run 을 예전에 조정했고 지금
//!    끝났으면 `run-ended`), `gen` 이 다르면 `stale-generation`. 맞으면 조정자.
//! 3. 묶인 Run 이 없으면: 요청의 Run 을 **이 채팅이 예전에 조정했으면**(묶음이 풀렸다 — `past_coordinators`) Run 이 끝났으면 `run-ended` ·
//!    세대가 바뀌었으면 `stale-generation` · 아니면(프로세스 끝으로 풀림) `stale-run`. 그 밖은 `not-coordinator`(남의 Run 이
//!    있는지 없는지는 흘리지 않는다).
//!
//! 전역 토큰([`Caller::Global`])의 조율 요청은 여기 오기 전에 `not-a-tile`(`mcp/rpc.rs`). 타일 토큰([`Caller::Tile`]) · 작업자 · 검토자 토큰은
//! 조율 도구가 없다(모르는 도구 — `tools.rs` `is_tool_for`).

use serde_json::Value;

use super::model::RunState;
use super::store::{coordinates, reason, Caller, OrchError, Orchestration, Seat};
use super::tools::{arg, bad};

impl Orchestration {
    /// 시험 손 — 세대 없는 시험 자리([`Seat::test`])가 지금 조정자로 묶인 Run.
    #[cfg(test)]
    pub(crate) fn bound_coordinator(&self, chat: &str) -> Option<(String, u32)> {
        self.bound_seat(&Seat::test(chat))
    }

    /// 이 자리가 지금 조정자로 묶인 Run — `(runId, gen)`.
    pub(crate) fn bound_seat(&self, seat: &Seat) -> Option<(String, u32)> {
        let g = self.lock();
        g.runs
            .iter()
            .find(|(_, s)| coordinates(s, seat))
            .map(|(id, s)| (id.clone(), s.run.gen))
    }


    /// 자리의 조율 요청 → 조정자 호출자(머리말의 판정 순서). 인증 때 확정한 `(chat, proc)` 그대로 견준다(지금 세대를 다시 읽지 않는다 —
    /// 설계 2-2). 거절은 이유 낱말.
    pub(super) fn seat_coordinator(&self, seat: &Seat, tool: &str, args: Option<&Value>) -> Result<Caller, OrchError> {
        let asked_run = match arg(args, "runId") {
            None => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err(bad("runId must be a string")),
        };
        let asked_gen = match arg(args, "gen") {
            None => None,
            Some(v) => Some(
                v.as_u64()
                    .and_then(|g| u32::try_from(g).ok())
                    .ok_or_else(|| bad("gen must be a whole number (the generation from get_run)"))?,
            ),
        };
        if tool != "get_run" && (asked_run.is_none() || asked_gen.is_none()) {
            return Err(bad(
                "runId and gen are required — read them with get_run (its answer carries runId and gen) and pass both on every coordination call",
            ));
        }
        let g = self.lock();
        let ended = |id: &str| g.runs.get(id).is_some_and(|s| !matches!(s.run.state, RunState::Running | RunState::Paused));
        let was_coordinator = |id: &str| {
            g.runs.get(id).is_some_and(|s| {
                s.past_coordinators.iter().any(|x| x.same_owner(seat))
                    || s.coordinator.as_ref().is_some_and(|(_, x)| x.same_owner(seat) && x != seat)
            })
        };
        let bound = g.runs.iter().find(|(_, s)| coordinates(s, seat)).map(|(id, s)| (id.clone(), s.run.gen));
        match bound {
            Some((run_id, gen)) => {
                if let Some(asked) = asked_run.as_deref().filter(|a| *a != run_id) {
                    return Err(if was_coordinator(asked) && ended(asked) { run_ended() } else { stale_run(&run_id) });
                }
                if let Some(asked) = asked_gen.filter(|a| *a != gen) {
                    return Err(stale_generation(asked, gen));
                }
                Ok(Caller::Coordinator { run_id, gen })
            }
            None => {
                if let Some(asked) = asked_run.as_deref().filter(|a| was_coordinator(a)) {
                    if ended(asked) {
                        return Err(run_ended());
                    }
                    let now_gen = g.runs.get(asked).map(|s| s.run.gen).unwrap_or(0);
                    if let Some(a) = asked_gen.filter(|a| *a != now_gen) {
                        return Err(stale_generation(a, now_gen));
                    }
                    return Err(OrchError::new(
                        reason::STALE_RUN,
                        "this chat no longer coordinates that album (its producer process ended) — if the person asks you to continue it, call adopt_run; otherwise tell the person",
                    ));
                }
                Err(OrchError::new(
                    reason::NOT_COORDINATOR,
                    "this chat is not the coordinator of an album — ask the person to open an album; adopt_run takes over its paused run",
                ))
            }
        }
    }

    /// **그 자리의 `wait_run` 을 취소한다**(2단계 단계 2 — 설계 3-3 · 리뷰 F5): 사람이 프로듀서의 턴을 끊기 **전에** 레지스트리가 부른다(채팅 잠금
    /// 밖). 같은 프로세스 안의 끊기라 `ProcId` 만으로는 부족하다 — 그래서 자리의 `cancel_gen` +1 + 깨움. 잠정 커서는 되돌린다(끊긴 턴은 자연
    /// 종료가 아니다). 그 자리가 지금 묶인 Run 이 없으면 아무 일 없음. 취소한 Run 수.
    pub(crate) fn cancel_seat_waits(&self, seat: &Seat) -> usize {
        let mut g = self.lock();
        let mut n = 0;
        for slot in g.runs.values_mut().filter(|s| coordinates(s, seat)) {
            slot.cursor.cancel_gen += 1;
            slot.cursor.pending = slot.cursor.committed;
            n += 1;
        }
        drop(g);
        if n > 0 {
            self.changed.notify_all();
        }
        n
    }

    /// **그 자리의 턴이 끝났다**(설계 3-3): 자연 종료면 잠정 커서를 확정(`committed = max(committed, pending)`), 그 밖(끊김 · 오류)은
    /// 되돌림(`pending = committed`). 정확히 그 자리로 지금 묶인 Run 만.
    pub(crate) fn seat_turn_ended(&self, seat: &Seat, natural: bool) {
        let mut g = self.lock();
        for slot in g.runs.values_mut().filter(|s| coordinates(s, seat)) {
            if natural {
                slot.cursor.committed = slot.cursor.committed.max(slot.cursor.pending);
            } else {
                slot.cursor.pending = slot.cursor.committed;
            }
        }
    }

    /// **그 채팅의 귀속 앨범**(설계 2-3 · 1-3 수명표) — `(runId, 상태, 이어받기 판정)`. 귀속 색인(Run 파일 `producers`)에서만 읽는다 — 묶음 ·
    /// 권한이 아니다. 레지스트리가 채팅 잠금 **밖에서** 부른다(수명 · orphaned 의 `readOnly` · 미귀속 상한).
    pub(crate) fn producer_album(&self, chat: &str) -> Option<(String, RunState, super::start::AdoptVerdict)> {
        let now = self.now();
        let g = self.lock();
        let run = g.producer_ever.get(chat)?;
        let slot = g.runs.get(run)?;
        Some((run.clone(), slot.run.state, super::start::adopt_verdict(slot, now)))
    }

    /// 그 채팅의 귀속 앨범이 표에서 사라졌다(사람이 보관했다) — 레지스트리가 끝난 앨범과 똑같이 프로세스를 닫는다. 귀속이 없는 채팅은 거짓.
    pub(crate) fn producer_album_gone(&self, chat: &str) -> bool {
        let g = self.lock();
        g.producer_ever.get(chat).is_some_and(|run| !g.runs.contains_key(run))
    }

    /// 시험 · 보기 — 그 Run 의 지금 자리 커서.
    #[cfg(test)]
    pub(crate) fn seat_cursor(&self, run_id: &str) -> Option<super::store::SeatCursor> {
        self.lock().runs.get(run_id).map(|s| s.cursor)
    }

}

fn run_ended() -> OrchError {
    OrchError::new(
        reason::RUN_ENDED,
        "that run has ended (stopped, done or closed) — its coordination is over; tell the person",
    )
}

fn stale_run(bound: &str) -> OrchError {
    OrchError::new(
        reason::STALE_RUN,
        format!("this chat coordinates run {bound}, not the runId you sent — read get_run and use its runId"),
    )
}

fn stale_generation(asked: u32, now: u32) -> OrchError {
    OrchError::new(
        reason::STALE_GENERATION,
        format!("gen {asked} is not the run's current coordinator generation ({now}) — another coordinator took over"),
    )
}
