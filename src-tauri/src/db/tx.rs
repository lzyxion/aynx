//! 트랜잭션 작업 칸 — 순수(시각은 부르는 쪽이 준다). 엔진 일은 `table` 이 한다.
//!
//! - `state` 글자는 프런트 `query/tx-work` 와의 약속이다. `errorRolledBack` = 엔진이 트랜잭션 **전체**를 끝냈다(보통의 실행 실패는
//!   세이브포인트로 그 실행만 되돌린다) · `unknown` = `COMMIT` 뒤 답 전에 끊김 또는 문장이 트랜잭션을 스스로 끝냄(암묵 커밋 등).
//! - 방치 시계의 **활동은 사람의 문장 실행 · 명시적 연장뿐**이다 — 상태 조회 · 스키마 트리 · 구조 · DDL 보기는 시계를 늘리지 않는다.
//!   연결의 떼어 두기 TTL 과는 별개 시계라 떼어 둔 동안에도 흐른다.
//! - 작업 id 는 재부착 전의 낡은 요청이 새 작업에 닿지 않게 한다(`[db-tx-stale]`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::errors::{with_reason, DB_TX_STALE};
use crate::i18n::tr;

pub(crate) const IDLE_LIMIT: Duration = Duration::from_secs(600);
pub(crate) const IDLE_WARN: Duration = Duration::from_secs(60);

/// 시험 전용(ms) — 0 이면 원래 값.
static LIMIT_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);
static WARN_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn clock() -> (Duration, Duration) {
    let limit = match LIMIT_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => IDLE_LIMIT,
        ms => Duration::from_millis(ms),
    };
    let warn = match WARN_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => IDLE_WARN,
        ms => Duration::from_millis(ms),
    };
    (limit, warn.min(limit))
}

/// 부르는 쪽(`table`)이 시계를 깨운다.
#[cfg(test)]
pub(crate) fn set_clock_for_test(c: Option<(Duration, Duration)>) {
    let (l, w) = c.map_or((0, 0), |(l, w)| (l.as_millis().max(1) as u64, w.as_millis().max(1) as u64));
    LIMIT_OVERRIDE_MS.store(l, Ordering::SeqCst);
    WARN_OVERRIDE_MS.store(w, Ordering::SeqCst);
}

/// 서버가 다시 떠도 GUI 가 쥔 옛 id 와 겹치지 않게 시각에서 뽑는다(핸들과 같은 규칙).
static NEXT_ID: LazyLock<AtomicU64> = LazyLock::new(|| {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    AtomicU64::new((secs % 100_000 + 1) * 1_000)
});

/// 0 이 아니다 — 0 은 "작업 없음" 이다.
pub(crate) fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::SeqCst)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Outcome {
    Committed,
    RolledBack,
    ErrorRolledBack,
    IdleRolledBack,
    Unknown,
    Disconnected,
}

impl Outcome {
    /// 다음 작업을 열 때까지 `state` 로 남는 결과.
    fn sticky(self) -> Option<&'static str> {
        match self {
            Outcome::ErrorRolledBack => Some("errorRolledBack"),
            Outcome::Unknown => Some("unknown"),
            Outcome::Disconnected => Some("disconnected"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Open {
    pub id: u64,
    started: Instant,
    last: Instant,
    statements: u32,
    warned: bool,
    ending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ended {
    pub id: u64,
    pub outcome: Outcome,
    pub statements: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    ReadOnly,
    AlreadyOpen,
    Stale,
    Ending,
}

impl Refusal {
    pub(crate) fn message(&self) -> String {
        match self {
            Refusal::ReadOnly => tr!(
                ko: "트랜잭션 작업은 쓰기 모드에서만 시작합니다 — 위 띠의 '읽기 전용'을 눌러 쓰기를 켜세요",
                en: "A transaction starts only in write mode — click 'Read-only' in the bar above to turn on writing"
            ),
            Refusal::AlreadyOpen => tr!(
                ko: "이미 열린 트랜잭션 작업이 있습니다 — [커밋]이나 [되돌리기]로 먼저 끝내세요",
                en: "A transaction is already open — finish it with [Commit] or [Roll back] first"
            ),
            Refusal::Stale => with_reason(
                DB_TX_STALE,
                tr!(
                    ko: "이 트랜잭션 작업은 이미 끝났거나 다른 작업입니다 — 화면을 지금 상태로 맞춥니다",
                    en: "This transaction has already ended or is a different one — the view is being updated to the current state"
                ),
            ),
            Refusal::Ending => tr!(
                ko: "트랜잭션 작업을 끝내는 중입니다 — 잠시 뒤 다시 하세요",
                en: "The transaction is being finished — try again in a moment"
            ),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct Slot {
    open: Option<Open>,
    ended: Option<Ended>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Due {
    Warn,
    Expire,
}

impl Slot {
    pub(crate) fn open_id(&self) -> Option<u64> {
        self.open.as_ref().map(|o| o.id)
    }

    pub(crate) fn is_open(&self) -> bool {
        self.open.as_ref().is_some_and(|o| !o.ending)
    }

    /// 엔진이 `BEGIN` 을 받은 뒤에 부른다.
    pub(crate) fn begin(&mut self, id: u64, now: Instant) -> Result<(), Refusal> {
        if self.open.is_some() {
            return Err(Refusal::AlreadyOpen);
        }
        self.open = Some(Open {
            id,
            started: now,
            last: now,
            statements: 0,
            warned: false,
            ending: false,
        });
        self.ended = None;
        Ok(())
    }

    /// `0` = "작업 없음" 을 기대한다.
    pub(crate) fn expect(&self, id: u64) -> Result<(), Refusal> {
        match (&self.open, id) {
            (None, 0) => Ok(()),
            (Some(o), n) if o.id == n && !o.ending => Ok(()),
            (Some(o), n) if o.id == n => Err(Refusal::Ending),
            _ => Err(Refusal::Stale),
        }
    }

    /// 커밋 · 되돌리기를 보내기 전 — 그 사이 다른 끝내기(방치 시계 · 두 번 누름)를 막는다.
    pub(crate) fn start_ending(&mut self, id: u64) -> Result<(), Refusal> {
        match self.open.as_mut() {
            Some(o) if o.id == id && !o.ending => {
                o.ending = true;
                Ok(())
            }
            Some(o) if o.id == id => Err(Refusal::Ending),
            _ => Err(Refusal::Stale),
        }
    }

    pub(crate) fn cancel_ending(&mut self) {
        if let Some(o) = self.open.as_mut() {
            o.ending = false;
        }
    }

    pub(crate) fn finish(&mut self, outcome: Outcome, message: Option<String>) -> Option<Ended> {
        let o = self.open.take()?;
        let e = Ended {
            id: o.id,
            outcome,
            statements: o.statements,
            message,
        };
        self.ended = Some(e.clone());
        Some(e)
    }

    pub(crate) fn empty_open_id(&self) -> Option<u64> {
        self.open.as_ref().filter(|o| !o.ending && o.statements == 0).map(|o| o.id)
    }

    /// 엔진이 이미 되돌린 빈 작업을 결과 없이 걷는다.
    pub(crate) fn discard(&mut self) {
        self.open = None;
    }

    pub(crate) fn touch(&mut self, now: Instant) {
        if let Some(o) = self.open.as_mut() {
            o.last = now;
            o.warned = false;
        }
    }

    /// 성공한 문장만 센다 — 실패한 문장은 엔진이 되감았다.
    pub(crate) fn statement_done(&mut self, ok: bool, now: Instant) {
        if let Some(o) = self.open.as_mut() {
            if ok {
                o.statements += 1;
            }
        }
        self.touch(now);
    }

    pub(crate) fn next_due(&self, limit: Duration, warn: Duration) -> Option<(Instant, Due)> {
        let o = self.open.as_ref().filter(|o| !o.ending)?;
        let expire = o.last + limit;
        if o.warned {
            Some((expire, Due::Expire))
        } else {
            Some((expire.checked_sub(warn).unwrap_or(o.last), Due::Warn))
        }
    }

    pub(crate) fn mark_warned(&mut self) {
        if let Some(o) = self.open.as_mut() {
            o.warned = true;
        }
    }

    pub(crate) fn view(&self, now: Instant) -> TxView {
        let (limit, warn) = clock();
        let base = TxView {
            id: 0,
            state: "none",
            statements: 0,
            started_ago_ms: None,
            idle_left_ms: None,
            idle_limit_ms: limit.as_millis() as u64,
            warn_ms: warn.as_millis() as u64,
            warn: false,
            ended: self.ended.clone(),
        };
        match &self.open {
            Some(o) => {
                let left = (o.last + limit).saturating_duration_since(now);
                TxView {
                    id: o.id,
                    state: if o.ending { "ending" } else { "open" },
                    statements: o.statements,
                    started_ago_ms: Some(now.saturating_duration_since(o.started).as_millis() as u64),
                    idle_left_ms: Some(left.as_millis() as u64),
                    warn: left <= warn,
                    ..base
                }
            }
            None => TxView {
                state: self.ended.as_ref().and_then(|e| e.outcome.sticky()).unwrap_or("none"),
                ..base
            },
        }
    }
}

/// 프런트 `query-backend.ts` 의 `TxView` 와 같은 꼴. 시각은 프로세스 사이 시계를 맞추지 않게 **지금으로부터의 길이**로 준다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TxView {
    pub id: u64,
    pub state: &'static str,
    pub statements: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_ago_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_left_ms: Option<u64>,
    pub idle_limit_ms: u64,
    pub warn_ms: u64,
    pub warn: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended: Option<Ended>,
}
