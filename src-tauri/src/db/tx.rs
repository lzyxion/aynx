//! **트랜잭션 작업**(쿼리 타일 1단계 — 10-13 결정, docs/log/2026-10-13-db-write-mcp-design.md) — 앱이 여는 트랜잭션 하나의 상태 ·
//! 방치 시계 · 화면에 줄 꼴. **순수**(입출력 없음 — 시각은 부르는 쪽이 준다). 엔진 일은 `table` 이 하고, 이 모듈은 칸만 바꾼다.
//!
//! ## 상태
//!
//! | `state`(화면 꼴) | 뜻 | 새 작업을 열 수 있나 |
//! |---|---|---|
//! | `none` | 작업 없음(대기) · 지난 작업이 커밋 · 되돌림 · 방치 되돌림으로 끝남(`ended` 에 결과) | 예 |
//! | `open` | 열림 — 문장이 도는 중도 여기다(도는 것은 표의 `running` 이 따로 안다) | 아니오 |
//! | `ending` | 커밋 · 되돌리기를 엔진에 보냈다(답을 기다림) | 아니오 |
//! | `errorRolledBack` | 오류로 되돌려짐 — 엔진이 트랜잭션 **전체**를 끝냈다(MySQL 교착 1213 · SQLite 가 스스로 되감음 · 세이브포인트로 되감지 못함) · 커밋이 서버에서 거절됨. 보통의 실행 실패는 세이브포인트로 그 실행만 되돌리고 작업이 계속된다(10-14 결정 — PG 포함)(직렬화 실패 · 미뤄 둔 제약) | 예 |
//! | `unknown` | **결과 불명** — `COMMIT` 을 보낸 뒤 답 전에 연결이 끊겼다 · 문장이 트랜잭션을 스스로 끝냈다(`CALL` 안의 `COMMIT` · 암묵 커밋) | 예 |
//! | `disconnected` | 연결이 끊겨 서버가 되돌렸다(커밋을 보내기 전) | 예(다시 연결 뒤) |
//!
//! 끝난 뒤의 셋(`errorRolledBack` · `unknown` · `disconnected`)은 **다음 작업을 열 때까지** 그 상태로 남는다(화면이 눈에 띄게 그린다).
//! 커밋 · 되돌림 · 방치 되돌림은 `none` 으로 돌아가고 결과는 `ended` 칸으로만 알린다(결과 알림 한 줄).
//!
//! ## 방치 시계(서버에 산다 — 10-13 결정)
//!
//! - 무활동 [`IDLE_LIMIT`](10분)이면 서버가 되돌린다 · [`IDLE_WARN`](1분) 전에 경고 이벤트. **활동 = 사람의 문장 실행 · 명시적 연장
//!   뿐** — 상태 조회 · 스키마 트리 · 테이블 구조 · DDL 보기는 시계를 늘리지 않는다.
//! - 연결의 떼어 두기(TTL 10분 — `table::DETACH_TTL`)와는 **별개 시계**다. 떼어 둔 동안에도 흐르고(연장할 화면이 없다), 다시 붙으면
//!   남은 시간 그대로 칩이 돌아온다.
//! - 작업 id(`id`)는 커밋 · 되돌리기 · 연장 · 문장 실행이 싣고 온다 — 재부착 전의 낡은 요청이 새 작업에 닿지 않게(`[db-tx-stale]`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::errors::{with_reason, DB_TX_STALE};
use crate::i18n::tr;

/// 무활동 상한 — 넘으면 서버가 되돌린다(10-13 결정 · Beekeeper Studio 와 같음).
pub(crate) const IDLE_LIMIT: Duration = Duration::from_secs(600);
/// 상한 몇 전에 경고하나.
pub(crate) const IDLE_WARN: Duration = Duration::from_secs(60);

/// 시험이 짧게 바꾸는 자리(ms) — 0 이면 원래 값.
static LIMIT_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);
static WARN_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

/// 지금의 (상한, 경고 앞당김).
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

/// 시험 전용 — 방치 시계를 바꾼다(`None` = 원래대로). 부르는 쪽(`table`)이 시계를 깨운다.
#[cfg(test)]
pub(crate) fn set_clock_for_test(c: Option<(Duration, Duration)>) {
    let (l, w) = c.map_or((0, 0), |(l, w)| (l.as_millis().max(1) as u64, w.as_millis().max(1) as u64));
    LIMIT_OVERRIDE_MS.store(l, Ordering::SeqCst);
    WARN_OVERRIDE_MS.store(w, Ordering::SeqCst);
}

/// 작업 id 의 바탕 — 서버가 다시 떠도 GUI 가 쥔 옛 id 와 겹치지 않게 시각에서 뽑는다(핸들과 같은 규칙).
static NEXT_ID: LazyLock<AtomicU64> = LazyLock::new(|| {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    AtomicU64::new((secs % 100_000 + 1) * 1_000)
});

/// 새 작업 id(0 이 아니다 — 0 은 "작업 없음" 이다).
pub(crate) fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::SeqCst)
}

/// 끝난 작업의 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Outcome {
    Committed,
    RolledBack,
    /// 오류로 되돌려짐(머리말 표).
    ErrorRolledBack,
    /// 무활동 상한에서 서버가 되돌렸다.
    IdleRolledBack,
    /// 결과 불명(머리말 표).
    Unknown,
    /// 연결이 끊겨 서버가 되돌렸다.
    Disconnected,
}

impl Outcome {
    /// 끝난 뒤에도 그 상태로 남는가(머리말 표의 뒤 셋).
    fn sticky(self) -> Option<&'static str> {
        match self {
            Outcome::ErrorRolledBack => Some("errorRolledBack"),
            Outcome::Unknown => Some("unknown"),
            Outcome::Disconnected => Some("disconnected"),
            _ => None,
        }
    }
}

/// 열린 작업.
#[derive(Debug, Clone)]
pub(crate) struct Open {
    pub id: u64,
    started: Instant,
    /// 마지막 활동(문장 끝 · 연장) — 방치 시계의 바탕.
    last: Instant,
    statements: u32,
    /// 이번 바탕에서 경고를 냈다(활동이 생기면 다시 낼 수 있다).
    warned: bool,
    /// 커밋 · 되돌리기를 보냈다.
    ending: bool,
}

/// 끝난 작업.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ended {
    pub id: u64,
    pub outcome: Outcome,
    pub statements: u32,
    /// 사람 문구(오류 · 결과 불명의 사연) — 비밀 없음(엔진 오류 문구).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 거절 — 상태가 그 조작을 받지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// 쓰기 모드가 아니다.
    ReadOnly,
    /// 이미 열린 작업이 있다.
    AlreadyOpen,
    /// 열린 작업이 없거나 다른 작업이다(낡은 요청).
    Stale,
    /// 끝내는 중이다.
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

/// 연결 하나의 작업 칸 — 열린 것 하나 + 마지막으로 끝난 것 하나.
#[derive(Debug, Default)]
pub(crate) struct Slot {
    open: Option<Open>,
    ended: Option<Ended>,
}

/// 방치 시계의 다음 할 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Due {
    /// 경고를 낼 때가 됐다.
    Warn,
    /// 상한을 넘었다 — 되돌릴 때.
    Expire,
}

impl Slot {
    /// 열린(끝내는 중 포함) 작업의 id.
    pub(crate) fn open_id(&self) -> Option<u64> {
        self.open.as_ref().map(|o| o.id)
    }

    /// 열려 있고 끝내는 중이 아니다.
    pub(crate) fn is_open(&self) -> bool {
        self.open.as_ref().is_some_and(|o| !o.ending)
    }

    /// 연다 — 엔진이 `BEGIN` 을 받은 뒤에 부른다. 지난 결과는 지운다.
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

    /// 사람이 보낸 작업 id 가 지금 것과 맞나 — `0` = "작업 없음" 을 기대한다(열린 것이 있으면 낡은 요청).
    pub(crate) fn expect(&self, id: u64) -> Result<(), Refusal> {
        match (&self.open, id) {
            (None, 0) => Ok(()),
            (Some(o), n) if o.id == n && !o.ending => Ok(()),
            (Some(o), n) if o.id == n => Err(Refusal::Ending),
            _ => Err(Refusal::Stale),
        }
    }

    /// 커밋 · 되돌리기를 보내기 전 — 열린 그 작업이어야 한다. 그 사이 다른 끝내기(방치 시계 · 두 번 누름)는 막힌다.
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

    /// 끝내기가 엔진에 닿지 못했다(바쁨 — 작업은 그대로 열려 있다).
    pub(crate) fn cancel_ending(&mut self) {
        if let Some(o) = self.open.as_mut() {
            o.ending = false;
        }
    }

    /// 끝났다 — 열린 것을 결과로 옮긴다(열린 것이 없으면 아무 일도 없다).
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

    /// 열려 있고(끝내는 중이 아님) 작업에 남은 문장이 없는 작업의 id — 자동 커밋을 끈 타일이 저절로 연 작업의 첫 실행이 실패했을 때
    /// 조용히 닫을 대상(`table::drop_empty_work`).
    pub(crate) fn empty_open_id(&self) -> Option<u64> {
        self.open.as_ref().filter(|o| !o.ending && o.statements == 0).map(|o| o.id)
    }

    /// 열린 작업을 결과 없이 걷는다(엔진이 이미 되돌렸다 — 알릴 것이 없는 빈 작업). 지난 결과(`ended`)는 건드리지 않는다.
    pub(crate) fn discard(&mut self) {
        self.open = None;
    }

    /// 활동 — 시계를 새로 잰다(사람의 문장 시작 · 명시적 연장).
    pub(crate) fn touch(&mut self, now: Instant) {
        if let Some(o) = self.open.as_mut() {
            o.last = now;
            o.warned = false;
        }
    }

    /// 문장 하나가 작업 안에서 끝났다 — 센다(성공한 문장만 — 실패한 문장은 엔진이 되감았다) + 활동.
    pub(crate) fn statement_done(&mut self, ok: bool, now: Instant) {
        if let Some(o) = self.open.as_mut() {
            if ok {
                o.statements += 1;
            }
        }
        self.touch(now);
    }

    /// 방치 시계 — `(다음 할 일의 시각, 할 일)`. 끝내는 중 · 작업 없음이면 `None`.
    pub(crate) fn next_due(&self, limit: Duration, warn: Duration) -> Option<(Instant, Due)> {
        let o = self.open.as_ref().filter(|o| !o.ending)?;
        let expire = o.last + limit;
        if o.warned {
            Some((expire, Due::Expire))
        } else {
            Some((expire.checked_sub(warn).unwrap_or(o.last), Due::Warn))
        }
    }

    /// 경고를 냈다고 적는다(같은 바탕에서 두 번 내지 않게).
    pub(crate) fn mark_warned(&mut self) {
        if let Some(o) = self.open.as_mut() {
            o.warned = true;
        }
    }

    /// 화면 꼴.
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

/// 화면에 주는 꼴(`db_tx` · `db_query` · `db_open` 의 `tx` 칸 · 이벤트 `db-state {state: "tx"}`). 시각은 서로 다른 프로세스의
/// 시계를 맞추지 않게 **지금으로부터의 길이**로 준다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TxView {
    /// 열린 작업 id(없으면 0).
    pub id: u64,
    /// 머리말 표의 상태.
    pub state: &'static str,
    /// 작업 안에서 성공한 문장 수.
    pub statements: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_ago_ms: Option<u64>,
    /// 방치 상한까지 남은 시간.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_left_ms: Option<u64>,
    pub idle_limit_ms: u64,
    /// 남은 시간이 이보다 짧으면 경고.
    pub warn_ms: u64,
    pub warn: bool,
    /// 마지막으로 끝난 작업(다음 작업을 열 때 지운다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended: Option<Ended>,
}
