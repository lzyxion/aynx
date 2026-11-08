//! **실패 빈도 제한** 한 벌 — 암호 확인처럼 "틀리면 다시 쳐 볼 수 있는" 문의 무차별 대입을 늦춘다.
//!
//! 규칙: 잇단 실패가 `threshold` 번이면 `base` 동안 막고, 막힐 때마다 그 시간이 두 배(상한 `cap`)가 된다. 성공하면 처음으로
//! 돌아간다. 마지막 실패에서 [`DECAY`] 가 지나면 배수도 잊는다(오래전의 잠김이 오늘의 오타를 한 시간짜리로 만들지 않게).
//! 시각은 부르는 쪽이 넣는다(`Instant`) — 시험이 시계를 흉내 내지 않고 순수하게 잰다.
//!
//! 쓰는 곳: 세션 서버의 `vault_verify_master`(`server::vault_ops`) · 원격 관문의 기기별·전역 잠금 해제(`remote::auth`).
//! 로그에는 횟수만 남는다(무엇을 쳤는지는 이 모듈이 보지도 않는다).

use std::time::{Duration, Instant};

/// 마지막 실패에서 이만큼 지나면 잠김 배수를 잊는다.
pub(crate) const DECAY: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone)]
pub(crate) struct FailLimiter {
    threshold: u32,
    base: Duration,
    cap: Duration,
    /// 지금 잠김 뒤(또는 처음부터) 잇단 실패 수.
    count: u32,
    /// 지금까지 걸린 잠김 수 — 다음 잠김 길이 = `base * 2^lockouts`.
    lockouts: u32,
    until: Option<Instant>,
    last_fail: Option<Instant>,
    /// 모든 실패의 누계(로그용 — 성공해도 줄지 않는다).
    total: u64,
}

impl FailLimiter {
    pub(crate) const fn new(threshold: u32, base: Duration, cap: Duration) -> Self {
        FailLimiter {
            threshold,
            base,
            cap,
            count: 0,
            lockouts: 0,
            until: None,
            last_fail: None,
            total: 0,
        }
    }

    /// 지금 막혀 있으면 남은 시간.
    pub(crate) fn blocked(&self, now: Instant) -> Option<Duration> {
        self.until.and_then(|u| u.checked_duration_since(now)).filter(|d| !d.is_zero())
    }

    /// 실패 하나를 센다 — 이번 실패로 잠겼으면 그 길이.
    pub(crate) fn fail(&mut self, now: Instant) -> Option<Duration> {
        if self.last_fail.is_some_and(|t| now.saturating_duration_since(t) >= DECAY) {
            self.lockouts = 0;
            self.count = 0;
        }
        self.last_fail = Some(now);
        self.total = self.total.saturating_add(1);
        self.count += 1;
        if self.count < self.threshold {
            return None;
        }
        self.count = 0;
        let factor = 1u32.checked_shl(self.lockouts.min(16)).unwrap_or(u32::MAX);
        let span = self.base.saturating_mul(factor).min(self.cap);
        self.lockouts = self.lockouts.saturating_add(1);
        self.until = Some(now + span);
        Some(span)
    }

    /// 성공 — 처음으로 돌아간다(누계는 남는다).
    pub(crate) fn success(&mut self) {
        self.count = 0;
        self.lockouts = 0;
        self.until = None;
    }

    /// 실패 누계(로그용).
    pub(crate) fn total(&self) -> u64 {
        self.total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Duration = Duration::from_secs(1);

    #[test]
    fn locks_after_threshold_and_doubles() {
        let t0 = Instant::now();
        let mut l = FailLimiter::new(3, 60 * S, 600 * S);
        assert_eq!(l.fail(t0), None);
        assert_eq!(l.fail(t0), None);
        assert_eq!(l.blocked(t0), None);
        assert_eq!(l.fail(t0), Some(60 * S));
        assert_eq!(l.blocked(t0 + 10 * S), Some(50 * S));
        assert_eq!(l.blocked(t0 + 60 * S), None);
        let t1 = t0 + 61 * S;
        l.fail(t1);
        l.fail(t1);
        assert_eq!(l.fail(t1), Some(120 * S));
        let t2 = t1 + 121 * S;
        for _ in 0..2 {
            l.fail(t2);
        }
        assert_eq!(l.fail(t2), Some(240 * S));
        let t3 = t2 + 241 * S;
        for _ in 0..2 {
            l.fail(t3);
        }
        assert_eq!(l.fail(t3), Some(480 * S));
        let t4 = t3 + 481 * S;
        for _ in 0..2 {
            l.fail(t4);
        }
        // 상한
        assert_eq!(l.fail(t4), Some(600 * S));
        assert_eq!(l.total(), 15);
    }

    #[test]
    fn success_resets_and_decay_forgets() {
        let t0 = Instant::now();
        let mut l = FailLimiter::new(2, 10 * S, 1000 * S);
        l.fail(t0);
        assert_eq!(l.fail(t0), Some(10 * S));
        l.success();
        assert_eq!(l.blocked(t0), None);
        l.fail(t0);
        assert_eq!(l.fail(t0), Some(10 * S), "성공 뒤에는 처음 길이");
        let t1 = t0 + 11 * S;
        l.fail(t1);
        assert_eq!(l.fail(t1), Some(20 * S));
        // 한 시간 넘게 조용하면 배수를 잊는다
        let t2 = t1 + DECAY + S;
        l.fail(t2);
        assert_eq!(l.fail(t2), Some(10 * S));
    }
}
