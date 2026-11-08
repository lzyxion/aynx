//! **ACK 크레딧** — 세션 서버가 파이프로 내보낸 출력과 클라이언트가 화면에 반영했다고 돌려준 오프셋(ACK)의 차이로
//! 생산자(PTY 읽기 스레드 — `crate::output::Gate`)를 멈추고 푼다(설계 4.2 "흐름 제어" · ③-2).
//!
//! 예전(같은 프로세스)에는 프런트가 미소비 바이트를 세다 `pause_*`/`resume_*` 를 불렀다. 파이프 너머에서는 그 신호가
//! 순서 없이 늦게 닿을 수 있어, 대신 **소비 오프셋(`consumed`)** 을 돌려받는다 — 값 하나라 늦게 와도 뜻이 같다.
//!
//! - 임대마다 [`Credit`] 하나: `sent_end`(이 임대로 내보낸 끝) · `acked`(받은 ACK). 송신 − ACK > [`SESSION_BUDGET`] 이면
//!   수문을 닫고, [`RESUME_BELOW`] 이하로 내려오면 연다.
//! - **ACK 규칙**: 단조 증가(같거나 작은 값은 무시) · 송신 상한 이하(넘으면 거부 — 축이 어긋났다). 옛 임대의 ACK 는
//!   [`Credit`] 에 닿기 전에 서버가 버린다(`server::sessions` — 세션 코어의 임대 검사).
//! - **전체 예산**([`Budget`]): 모든 임대의 미확인 합이 [`GLOBAL_BUDGET`] 을 넘으면 새로 보내는 임대도 멈춘다. 합이
//!   [`GLOBAL_RESUME_BELOW`] 아래로 내려오는 순간 멈춰 있던 임대를 모두 다시 본다([`Budget::wake`]) — 자기 몫은 0 인데
//!   전체 때문에 멈춘 임대는 제 ACK 가 오지 않으므로 누군가 깨워야 한다.
//!
//! - **시청자**(원격 웹 R2-A): 시청자마다 [`ViewerCredit`] — 장부만 있고 수문·전체 예산과 무관하다. 생산자를 세우는 것은 **주 임대의
//!   크레딧뿐**이고, 시청자가 [`VIEWER_BUDGET`] 을 넘으면 그 시청자만 떼어(재동기화) 느린 폰이 집 PC 화면을 멈추지 못한다.
//!
//! 잠금 순서: 슬롯(`output`) → 장부([`Credit`]) → 예산([`Budget`]) → 수문(`Gate`). 두 장부를 겹쳐 쥐지 않는다.

use std::sync::{Arc, Mutex, Weak};

use crate::output::Gate;

/// 임대 하나가 ACK 없이 내보낼 수 있는 양.
pub(crate) const SESSION_BUDGET: u64 = 1 << 20;
/// 멈춘 임대를 다시 여는 수위(히스테리시스 — 경계에서 진동하지 않게).
pub(crate) const RESUME_BELOW: u64 = SESSION_BUDGET / 2;
/// 모든 임대의 미확인 합의 상한.
pub(crate) const GLOBAL_BUDGET: u64 = 16 << 20;
pub(crate) const GLOBAL_RESUME_BELOW: u64 = GLOBAL_BUDGET / 2;

/// ACK 를 받지 않은 이유.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AckRefusal {
    /// 보낸 적 없는 오프셋 — 축이 어긋났다(무시하고 로그 한 줄).
    Ahead { consumed: u64, sent_end: u64 },
}

/// 장부 — 순수 자료(시험 대상).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Ledger {
    pub sent_end: u64,
    pub acked: u64,
    /// 첫 송신 전이면 거짓 — 붙기의 재생 시작점은 싱크가 처음 보내는 오프셋이라 그때 정한다([`Ledger::sent`]).
    pub started: bool,
}

impl Ledger {
    /// 임대가 시작되는 오프셋 — 그 앞은 이미 화면에 있다. 채널 터널의 크레딧(`server::tunnel` — 0 부터)도 이 장부다.
    pub(crate) fn starting_at(offset: u64) -> Self {
        Ledger {
            sent_end: offset,
            acked: offset,
            started: true,
        }
    }

    /// 시작점을 아직 모르는 장부 — 첫 송신의 오프셋이 시작점이 된다.
    pub(crate) fn unstarted() -> Self {
        Ledger {
            sent_end: 0,
            acked: 0,
            started: false,
        }
    }

    pub(crate) fn outstanding(&self) -> u64 {
        self.sent_end.saturating_sub(self.acked)
    }

    /// `[offset, end)` 를 보냈다 — 늘어난 미확인 양. 첫 송신이면 `offset` 이 시작점이다(그 앞은 이미 화면에 있다).
    pub(crate) fn sent(&mut self, offset: u64, end: u64) -> u64 {
        if !self.started {
            self.started = true;
            self.sent_end = offset;
            self.acked = offset;
        }
        if end <= self.sent_end {
            return 0;
        }
        let before = self.outstanding();
        self.sent_end = end;
        self.outstanding() - before
    }

    /// ACK — 줄어든 미확인 양. 같거나 작은 값은 0(늦게 온 옛 ACK), 보낸 끝을 넘으면 거부.
    pub(crate) fn ack(&mut self, consumed: u64) -> Result<u64, AckRefusal> {
        if consumed > self.sent_end {
            return Err(AckRefusal::Ahead {
                consumed,
                sent_end: self.sent_end,
            });
        }
        if consumed <= self.acked {
            return Ok(0);
        }
        let before = self.outstanding();
        self.acked = consumed;
        Ok(before - self.outstanding())
    }
}

/// 전체 예산 — 미확인 합과 살아 있는 임대들(깨우기용).
#[derive(Default)]
pub(crate) struct Budget {
    total: Mutex<u64>,
    credits: Mutex<Vec<Weak<Credit>>>,
}

impl Budget {
    #[cfg(test)]
    pub(crate) fn total(&self) -> u64 {
        *self.total.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 전체 합이 내려왔다 — 멈춰 있을 수 있는 임대를 모두 다시 본다(장부를 쥐지 않은 채 부른다).
    fn wake(&self) {
        let live: Vec<Arc<Credit>> = {
            let mut list = self.credits.lock().unwrap_or_else(|e| e.into_inner());
            list.retain(|w| w.strong_count() > 0);
            list.iter().filter_map(Weak::upgrade).collect()
        };
        for c in live {
            c.maybe_resume();
        }
    }
}

/// 임대 하나의 크레딧 — 장부 + 그 세션의 수문 + 전체 예산.
pub(crate) struct Credit {
    ledger: Mutex<Ledger>,
    gate: Arc<Gate>,
    budget: Arc<Budget>,
}

impl Credit {
    #[cfg(test)]
    pub(crate) fn new(gate: Arc<Gate>, budget: Arc<Budget>, start: u64) -> Arc<Self> {
        Self::with_ledger(gate, budget, Ledger::starting_at(start))
    }

    /// 시작점을 첫 송신으로 정하는 크레딧(붙기·이관 — 재생 시작점을 싱크가 안다).
    pub(crate) fn new_lazy(gate: Arc<Gate>, budget: Arc<Budget>) -> Arc<Self> {
        Self::with_ledger(gate, budget, Ledger::unstarted())
    }

    fn with_ledger(gate: Arc<Gate>, budget: Arc<Budget>, ledger: Ledger) -> Arc<Self> {
        let c = Arc::new(Credit {
            ledger: Mutex::new(ledger),
            gate,
            budget: Arc::clone(&budget),
        });
        budget
            .credits
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Arc::downgrade(&c));
        c
    }

    fn ledger(&self) -> std::sync::MutexGuard<'_, Ledger> {
        self.ledger.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `[offset, offset+len)` 을 내보냈다 — 넘치면 수문을 닫는다(장부 → 예산 → 수문 순서로 한 번에).
    pub(crate) fn on_send(&self, offset: u64, len: usize) {
        let mut l = self.ledger();
        let add = l.sent(offset, offset + len as u64);
        let mut total = self.budget.total.lock().unwrap_or_else(|e| e.into_inner());
        *total += add;
        if l.outstanding() > SESSION_BUDGET || *total > GLOBAL_BUDGET {
            self.gate.pause();
        }
    }

    /// ACK 를 받는다 — 줄었으면 이 임대를 열어 보고, 전체가 내려왔으면 다른 임대도 깨운다.
    pub(crate) fn on_ack(&self, consumed: u64) -> Result<(), AckRefusal> {
        let wake_all = {
            let mut l = self.ledger();
            let freed = l.ack(consumed)?;
            let mut total = self.budget.total.lock().unwrap_or_else(|e| e.into_inner());
            let before = *total;
            *total = total.saturating_sub(freed);
            if l.outstanding() <= RESUME_BELOW && *total <= GLOBAL_RESUME_BELOW {
                self.gate.resume();
            }
            before > GLOBAL_RESUME_BELOW && *total <= GLOBAL_RESUME_BELOW
        };
        if wake_all {
            self.budget.wake();
        }
        Ok(())
    }

    /// 전체 예산이 내려왔을 때 — 제 몫도 낮으면 연다.
    fn maybe_resume(&self) {
        let l = self.ledger();
        let total = self.budget.total.lock().unwrap_or_else(|e| e.into_inner());
        if l.outstanding() <= RESUME_BELOW && *total <= GLOBAL_RESUME_BELOW {
            self.gate.resume();
        }
    }

    /// 임대가 끝났다(떨어짐·이관·닫기) — 제 미확인 몫을 전체에서 뺀다. 수문은 부른 쪽이 다룬다(`unlease`·`release`).
    pub(crate) fn retire(&self) {
        let wake_all = {
            let mut l = self.ledger();
            let freed = l.outstanding();
            l.acked = l.sent_end;
            let mut total = self.budget.total.lock().unwrap_or_else(|e| e.into_inner());
            let before = *total;
            *total = total.saturating_sub(freed);
            before > GLOBAL_RESUME_BELOW && *total <= GLOBAL_RESUME_BELOW
        };
        if wake_all {
            self.budget.wake();
        }
    }

}

/// 시청자 하나가 ACK 없이 받을 수 있는 양(원격 웹 R2-A). 넘으면 **그 시청자만 뗀다**(재동기화) — 생산자를 세우지 않는다.
/// 주 임대([`SESSION_BUDGET`])보다 넉넉하다: 주가 수문을 세우는 동안 따라오는 폭(주의 예산)과 원격 왕복 지연을 함께 덮는다.
pub(crate) const VIEWER_BUDGET: u64 = 4 << 20;

/// **시청자의 크레딧**(R2-A — 설계 4절 "크레딧은 시청자마다 따로") — 장부만 있고 수문·전체 예산과 무관하다. 느린 폰 하나가 집 PC
/// 화면(주)을 멈추지 못하게: 예산을 넘으면 [`ViewerCredit::on_send`] 가 거짓을 돌려주고 부른 쪽(시청자 싱크)이 그 시청자를 뗀다
/// — 그 시청자는 다시 붙어 링·체크포인트로 재동기화한다(`output::attach_viewer_output`).
pub(crate) struct ViewerCredit {
    ledger: Mutex<Ledger>,
    budget: u64,
}

impl ViewerCredit {
    pub(crate) fn new() -> Arc<Self> {
        Self::with_budget(VIEWER_BUDGET)
    }

    pub(crate) fn with_budget(budget: u64) -> Arc<Self> {
        Arc::new(ViewerCredit {
            ledger: Mutex::new(Ledger::unstarted()),
            budget,
        })
    }

    fn ledger(&self) -> std::sync::MutexGuard<'_, Ledger> {
        self.ledger.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `[offset, offset+len)` 을 보내려 한다 — 보낸 뒤에도 예산 안이면 `true`(적는다), 넘으면 `false`(적지 않는다 — 떼라).
    pub(crate) fn on_send(&self, offset: u64, len: usize) -> bool {
        let mut l = self.ledger();
        let mut probe = *l;
        probe.sent(offset, offset + len as u64);
        if probe.outstanding() > self.budget {
            return false;
        }
        *l = probe;
        true
    }

    pub(crate) fn on_ack(&self, consumed: u64) -> Result<(), AckRefusal> {
        self.ledger().ack(consumed).map(|_| ())
    }

    #[cfg(test)]
    pub(crate) fn outstanding(&self) -> u64 {
        self.ledger().outstanding()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 시청자 크레딧은 예산 안에서는 적고, 넘는 송신은 거절한다(적지 않는다 — 떼라는 뜻). ACK 로 다시 내려오면 받는다. 수문은 없다.
    #[test]
    fn viewer_credit_refuses_past_its_budget_without_a_gate() {
        let c = ViewerCredit::with_budget(100);
        assert!(c.on_send(1000, 60), "첫 송신이 시작점");
        assert!(c.on_send(1060, 40));
        assert_eq!(c.outstanding(), 100);
        assert!(!c.on_send(1100, 1), "예산을 넘는 송신은 거절");
        assert_eq!(c.outstanding(), 100, "거절한 송신은 적지 않는다");
        c.on_ack(1050).unwrap();
        assert!(c.on_send(1100, 50));
        assert!(c.on_ack(9999).is_err(), "보낸 끝을 넘는 ACK");
    }

    #[test]
    fn ledger_ack_is_monotonic_and_capped_by_what_was_sent() {
        let mut l = Ledger::starting_at(100);
        assert_eq!(l.outstanding(), 0);
        assert_eq!(l.sent(100, 150), 50);
        assert_eq!(l.sent(130, 140), 0, "되감기는 무시");
        assert_eq!(l.ack(120), Ok(20));
        assert_eq!(l.ack(110), Ok(0), "늦게 온 작은 ACK 는 무시");
        assert_eq!(l.ack(120), Ok(0), "같은 ACK 두 번");
        assert_eq!(
            l.ack(151),
            Err(AckRefusal::Ahead {
                consumed: 151,
                sent_end: 150
            }),
            "보낸 끝을 넘는 ACK 는 거부"
        );
        assert_eq!(l.outstanding(), 30);
        assert_eq!(l.ack(150), Ok(30));
        assert_eq!(l.outstanding(), 0);

        // 시작점을 모르는 장부(붙기) — 첫 송신의 오프셋부터 센다. 그 전의 ACK 는 보낸 적 없는 오프셋이다.
        let mut lazy = Ledger::unstarted();
        assert!(lazy.ack(10).is_err());
        assert_eq!(lazy.sent(5000, 5100), 100);
        assert_eq!(lazy.ack(4000), Ok(0), "시작점 앞의 ACK 는 이미 반영된 것");
        assert_eq!(lazy.ack(5100), Ok(100));
    }

    fn passable(g: &Gate) -> bool {
        g.passable()
    }

    #[test]
    fn credit_pauses_over_budget_and_resumes_below_the_low_mark() {
        let gate = Arc::new(Gate::new());
        let budget = Arc::new(Budget::default());
        let c = Credit::new(Arc::clone(&gate), Arc::clone(&budget), 0);
        c.on_send(0, SESSION_BUDGET as usize);
        assert!(passable(&gate), "예산까지는 열림");
        c.on_send(SESSION_BUDGET, 1);
        assert!(!passable(&gate), "넘으면 닫힘");
        assert_eq!(budget.total(), SESSION_BUDGET + 1);
        // 조금 받으면 아직 닫혀 있다(히스테리시스).
        c.on_ack(100).unwrap();
        assert!(!passable(&gate));
        // 낮은 수위 아래로 — 열린다.
        c.on_ack(SESSION_BUDGET).unwrap();
        assert!(passable(&gate));
        assert_eq!(budget.total(), 1);
        c.retire();
        assert_eq!(budget.total(), 0);
    }

    #[test]
    fn global_budget_pauses_quiet_sessions_and_wakes_them() {
        let budget = Arc::new(Budget::default());
        let ga = Arc::new(Gate::new());
        let gb = Arc::new(Gate::new());
        let a = Credit::new(Arc::clone(&ga), Arc::clone(&budget), 0);
        let b = Credit::new(Arc::clone(&gb), Arc::clone(&budget), 0);
        // a 가 전체를 거의 채운다(제 몫은 넘쳐 닫힘).
        a.on_send(0, (GLOBAL_BUDGET - 10) as usize);
        // b 가 조금 보내 전체를 넘긴다 — b 는 제 몫이 작아도 닫힌다.
        b.on_send(0, 100);
        assert!(!passable(&gb), "전체 예산으로 닫힘");
        // a 가 다 받으면 전체가 내려온다 — b 는 제 ACK 없이도 깨어난다.
        a.on_ack(GLOBAL_BUDGET - 10).unwrap();
        assert!(passable(&gb), "전체가 내려오면 깨운다");
    }
}
