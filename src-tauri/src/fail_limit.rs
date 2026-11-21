//! 실패 빈도 제한 — 암호 확인처럼 다시 쳐 볼 수 있는 문의 무차별 대입을 늦춘다. 잠김은 막힐 때마다 두 배(상한 `cap`)이고 성공하면 처음으로.

use std::time::{Duration, Instant};

/// 마지막 실패에서 이만큼 지나면 배수를 잊는다 — 오래전의 잠김이 오늘의 오타를 한 시간짜리로 만들지 않게.
pub(crate) const DECAY: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone)]
pub(crate) struct FailLimiter {
    threshold: u32,
    base: Duration,
    cap: Duration,
    count: u32,
    lockouts: u32,
    until: Option<Instant>,
    last_fail: Option<Instant>,
    /// 로그용 — 성공해도 줄지 않는다.
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

    pub(crate) fn blocked(&self, now: Instant) -> Option<Duration> {
        self.until.and_then(|u| u.checked_duration_since(now)).filter(|d| !d.is_zero())
    }

    /// 이번 실패로 잠겼으면 그 길이.
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

    pub(crate) fn success(&mut self) {
        self.count = 0;
        self.lockouts = 0;
        self.until = None;
    }

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
        let t2 = t1 + DECAY + S;
        l.fail(t2);
        assert_eq!(l.fail(t2), Some(10 * S));
    }
}
