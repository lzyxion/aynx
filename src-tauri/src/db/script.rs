//! **스크립트 실행기** — 문장 목록을 실행 **전에 전부 검증**하고, 한 연결을 쥔 채 **한 트랜잭션**으로 차례로 돌린다. 첫 오류에서 멈추고
//! 전부 되돌리며, 모두 성공하면 커밋한다. 트랜잭션 작업 안에서는 스크립트 한 벌이 세이브포인트 하나다(커밋하지 않는다).
//!
//! - **엔진의 스크립트 길은 가드를 지난 문장만 받는다** — [`Planned`] 는 [`plan`] 만 만든다(형으로 지킨다).
//! - 영향 행 수는 엔진이 알려 준 수다 — **트리거 · 외래 키 연쇄 · CTE 안의 쓰기는 세지 않는다**(AI 작업안의 `maxAffected` 가 기댄다).
//! - 커밋을 보낸 뒤에는 끊지 않는다 — 답을 못 받으면 **결과 불명**(다시 보내지 않는다).
//! - GUI 가 사라져도 실행기는 서버 태스크라 끝까지 간다(커밋 또는 되돌림) — 반쯤 실행한 트랜잭션을 열어 두지 않는다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::guard::{self, GuardError};
use super::table::Engine;
use super::value::approx_len;
use super::{Dialect, EngineError, QueryOut, RunEnd};
use crate::i18n::tr;

pub(crate) const STATEMENTS_MAX: usize = 100;
/// 바이트.
pub(crate) const SCRIPT_BYTES_MAX: usize = 1024 * 1024;
/// 한 문장의 상한(`TIMEOUT_MAX_MS`)과 같다.
pub(crate) const SCRIPT_TIMEOUT: Duration = Duration::from_millis(super::TIMEOUT_MAX_MS);
/// 대략 — 단문 응답 상한과 같다.
pub(crate) const RESULT_BUDGET: usize = super::RESPONSE_MAX;
/// 서버의 시한(`statement_timeout` · `max_execution_time` …)이 먼저 끊게(`table` 의 그물과 같은 값).
const NET_GRACE: Duration = Duration::from_secs(2);
/// 넘으면 결과 불명으로 돌려준다(엔진 태스크는 제 길을 끝까지 간다).
const ABANDON_AFTER: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScriptMode {
    ReadOnly,
    Write,
    InWork,
}

impl ScriptMode {
    fn guard_mode(self) -> guard::Mode {
        match self {
            ScriptMode::ReadOnly => guard::Mode::ReadOnly,
            ScriptMode::Write | ScriptMode::InWork => guard::Mode::Transaction,
        }
    }
}

/// [`plan`] 만 만든다(칸이 이 모듈 밖에서 비공개).
#[derive(Debug, Clone)]
pub(crate) struct Planned {
    text: String,
    keyword: String,
    /// 원래 글에서의 자리(UTF-16 — 화면 편집기의 글자 위치와 같은 단위).
    start: usize,
    end: usize,
}

impl Planned {
    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    pub(crate) fn keyword(&self) -> &str {
        &self.keyword
    }
}

/// 아무것도 실행하지 않았다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlanError {
    TooLarge,
    TooMany(usize),
    Split(GuardError),
    /// 자리는 UTF-16 · `total` = 나뉜 문장 수.
    Statement { index: usize, start: usize, end: usize, total: usize, err: GuardError },
}

impl PlanError {
    pub(crate) fn message(&self) -> String {
        match self {
            PlanError::TooLarge => tr!(
                ko: "스크립트가 너무 큽니다(1 MiB 까지) — 나눠서 실행하세요",
                en: "The script is too large (up to 1 MiB) — run it in parts"
            ),
            PlanError::TooMany(n) => tr!(
                ko: "문장이 {n}개입니다 — 스크립트는 {max}문장까지 실행합니다. 나눠서 실행하세요",
                en: "The script has {n} statements — up to {max} run at once. Run it in parts",
                max = STATEMENTS_MAX
            ),
            PlanError::Split(e) => e.message(),
            PlanError::Statement { index, err, .. } => tr!(
                ko: "{n}번째 문장: {why}",
                en: "Statement {n}: {why}",
                n = index + 1,
                why = err.message()
            ),
        }
    }
}

fn utf16_positions(s: &str, bytes: &[usize]) -> Vec<usize> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut it = bytes.iter().peekable();
    let mut u16s = 0usize;
    for (b, ch) in s.char_indices() {
        while let Some(&&want) = it.peek() {
            if want > b {
                break;
            }
            out.push(u16s);
            it.next();
        }
        u16s += ch.len_utf16();
    }
    for _ in it {
        out.push(u16s);
    }
    out
}

/// **하나라도 거절이면 아무것도 돌려주지 않는다**(실행 0).
pub(crate) fn plan(sql: &str, dialect: Dialect, mode: ScriptMode) -> Result<Vec<Planned>, PlanError> {
    if sql.len() > SCRIPT_BYTES_MAX {
        return Err(PlanError::TooLarge);
    }
    let spans = guard::split_script(sql, dialect).map_err(PlanError::Split)?;
    if spans.len() > STATEMENTS_MAX {
        return Err(PlanError::TooMany(spans.len()));
    }
    let flat: Vec<usize> = spans.iter().flat_map(|&(s, e)| [s, e]).collect();
    let pos = utf16_positions(sql, &flat);
    let mut out = Vec::with_capacity(spans.len());
    for (i, &(s, e)) in spans.iter().enumerate() {
        let (start, end) = (pos[2 * i], pos[2 * i + 1]);
        let piece = &sql[s..e];
        let checked = guard::check_mode(piece, dialect, mode.guard_mode())
            .map_err(|err| PlanError::Statement {
                index: i,
                start,
                end,
                total: spans.len(),
                err,
            })?;
        out.push(Planned {
            text: checked.sql.to_string(),
            keyword: checked.keyword,
            start,
            end,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stop {
    Cancelled,
    TimedOut,
    /// [`Ctl::with_affected_cap`] 을 넘었다 — 커밋하지 않고 되돌린다.
    OverLimit,
}

pub(crate) struct Ctl {
    cancelled: Arc<AtomicBool>,
    timed_out: AtomicBool,
    deadline: Instant,
    stmt_ms: u64,
    /// 없으면 문장 사이 · 커밋 중.
    current: Mutex<Option<Instant>>,
    budget: Mutex<usize>,
    affected_cap: Option<u64>,
    affected: Mutex<u64>,
    over: AtomicBool,
}

impl Ctl {
    pub(crate) fn new(cancelled: Arc<AtomicBool>, stmt_ms: u64, total: Duration) -> Ctl {
        Ctl {
            cancelled,
            timed_out: AtomicBool::new(false),
            deadline: Instant::now() + total,
            stmt_ms: stmt_ms.max(1),
            current: Mutex::new(None),
            budget: Mutex::new(RESULT_BUDGET),
            affected_cap: None,
            affected: Mutex::new(0),
            over: AtomicBool::new(false),
        }
    }

    /// 합이 상한을 넘으면 그 자리에서 멈춘다(다음 문장을 시작하지 않고 커밋 대신 되돌린다). 영향 행을 모르는 문장(DDL 등)은 0 으로 센다.
    pub(crate) fn with_affected_cap(mut self, cap: u64) -> Ctl {
        self.affected_cap = Some(cap);
        self
    }

    pub(crate) fn affected_total(&self) -> u64 {
        *Self::lock(&self.affected)
    }

    fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 그 문장의 시한(ms). 취소됐거나 전체 시한이 다 됐으면 `None`.
    pub(crate) fn begin_stmt(&self) -> Option<u64> {
        if self.cancelled.load(Ordering::SeqCst) || self.timed_out.load(Ordering::SeqCst) || self.over.load(Ordering::SeqCst) {
            return None;
        }
        let now = Instant::now();
        let left = self.deadline.saturating_duration_since(now).as_millis() as u64;
        if left == 0 {
            self.timed_out.store(true, Ordering::SeqCst);
            return None;
        }
        let ms = self.stmt_ms.min(left);
        *Self::lock(&self.current) = Some(now + Duration::from_millis(ms));
        Some(ms)
    }

    pub(crate) fn end_stmt(&self) {
        *Self::lock(&self.current) = None;
    }

    /// 커밋 직전에도 · 작업 안 세이브포인트를 풀기 직전에도 본다(마지막 문장이 도는 중의 취소를 놓치지 않게). 전체 시한도 여기서 다시 잰다.
    pub(crate) fn stopped(&self) -> Option<Stop> {
        if !self.timed_out.load(Ordering::SeqCst) && Instant::now() >= self.deadline {
            self.timed_out.store(true, Ordering::SeqCst);
        }
        if self.cancelled.load(Ordering::SeqCst) {
            Some(Stop::Cancelled)
        } else if self.timed_out.load(Ordering::SeqCst) {
            Some(Stop::TimedOut)
        } else if self.over.load(Ordering::SeqCst) {
            Some(Stop::OverLimit)
        } else {
            None
        }
    }

    /// 사람의 취소가 아니면 시한이다.
    pub(crate) fn interrupt_reason(&self) -> Stop {
        if self.cancelled.load(Ordering::SeqCst) {
            Stop::Cancelled
        } else {
            Stop::TimedOut
        }
    }

    /// 넘으면 그 결과의 뒤 행부터 빼고 `truncated`.
    pub(crate) fn keep(&self, mut out: QueryOut) -> QueryOut {
        if let Some(cap) = self.affected_cap {
            let mut sum = Self::lock(&self.affected);
            *sum = sum.saturating_add(out.affected.unwrap_or(0));
            if *sum > cap {
                self.over.store(true, Ordering::SeqCst);
            }
        }
        let mut left = Self::lock(&self.budget);
        let mut used = 0usize;
        let mut cut = out.rows.len();
        for (i, row) in out.rows.iter().enumerate() {
            let size = 2 + row.iter().map(approx_len).sum::<usize>();
            if used + size > *left {
                cut = i;
                break;
            }
            used += size;
        }
        if cut < out.rows.len() {
            out.rows.truncate(cut);
            out.truncated = true;
        }
        *left -= used;
        out
    }

    fn expire_current(&self, grace: Duration) -> bool {
        let mut cur = Self::lock(&self.current);
        match *cur {
            Some(at) if Instant::now() >= at + grace => {
                *cur = None;
                self.timed_out.store(true, Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum End {
    Committed,
    /// 엔진이 스스로 되감은 경우 포함.
    RolledBack,
    ReadOnlyDone,
    /// 서버가 되돌렸다.
    CommitFailed(String),
    /// 커밋을 보냈는데 답을 못 받았다 — 결과 불명.
    CommitLost(String),
    /// 가드가 못 본 암묵 커밋 · 프로시저 안의 `COMMIT` — 앞 문장들이 커밋됐는지 모른다.
    EndedByStatement,
    /// 커밋을 보내기 전 — 서버가 되돌렸다.
    Disconnected,
    WorkKept,
    WorkEnded,
    /// `ROLLBACK TO` 성공을 확인했다 — 앞서 쌓은 변경은 그대로.
    WorkRunUndone,
    /// 결과를 증명할 수 없다(세이브포인트 복구 실패 · 알 수 없는 까닭으로 사라짐). 사연.
    WorkUnknown(String),
}

impl End {
    pub(crate) fn in_work(r: RunEnd, run: &mut EngineRun) -> End {
        match r {
            RunEnd::Kept => End::WorkKept,
            RunEnd::Undone { note } => {
                run.note = note;
                End::WorkRunUndone
            }
            RunEnd::RolledBack { note } => {
                run.note = note;
                End::WorkEnded
            }
            RunEnd::Unknown(m) => End::WorkUnknown(m),
        }
    }
}

#[derive(Debug)]
pub(crate) struct EngineRun {
    /// `done.len()` 번째가 멈춘 자리.
    pub done: Vec<QueryOut>,
    pub failed: Option<EngineError>,
    pub stopped: Option<Stop>,
    pub end: End,
    /// 화면의 `message` 로.
    pub note: Option<String>,
}

impl EngineRun {
    pub(crate) fn new() -> EngineRun {
        EngineRun {
            done: Vec::new(),
            failed: None,
            stopped: None,
            end: End::RolledBack,
            note: None,
        }
    }

    pub(crate) fn must_roll_back(&self, ctl: &Ctl) -> bool {
        self.failed.is_some() || self.stopped.is_some() || ctl.stopped().is_some()
    }
}

/// 계획을 세운 뒤 쓰기 · 작업 상태가 바뀌었다.
pub(crate) fn state_changed() -> EngineError {
    EngineError::Message(tr!(
        ko: "실행 직전에 쓰기 모드 · 트랜잭션 작업 상태가 바뀌었습니다 — 다시 실행하세요",
        en: "Write mode or the transaction state changed just before running — run again"
    ))
}

/// 지금 문장의 시한(+ 여유)을 넘으면 엔진을 끊는다. 실행이 끝나면 부르는 쪽이 멈춘다(`abort`).
async fn watchdog(engine: Engine, ctl: Arc<Ctl>, grace: Duration) {
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if ctl.expire_current(grace) {
            engine.interrupt();
        }
    }
}

/// 엔진이 받기 전 거절은 `Err` — 그때는 아무것도 실행하지 않았다.
pub(crate) async fn execute(
    engine: Engine,
    plan: Vec<Planned>,
    mode: ScriptMode,
    max_rows: usize,
    ctl: Arc<Ctl>,
) -> Result<EngineRun, EngineError> {
    let grace = if matches!(engine, Engine::Sqlite(_)) { Duration::ZERO } else { NET_GRACE };
    let dog = tokio::spawn(watchdog(engine.clone(), Arc::clone(&ctl), grace));
    let task = match engine.clone() {
        Engine::Sqlite(s) => {
            let ctl = Arc::clone(&ctl);
            tokio::task::spawn_blocking(move || s.script(&plan, mode, max_rows, &ctl))
        }
        Engine::Pg(p) => {
            let ctl = Arc::clone(&ctl);
            tokio::spawn(async move { p.script(&plan, mode, max_rows, &ctl).await })
        }
        Engine::Mysql(m) => {
            let ctl = Arc::clone(&ctl);
            tokio::spawn(async move { m.script(&plan, mode, max_rows, &ctl).await })
        }
    };
    let r = tokio::time::timeout(SCRIPT_TIMEOUT + ABANDON_AFTER, task).await;
    dog.abort();
    match r {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err(EngineError::Message(tr!(
            ko: "스크립트 작업이 실패했습니다(작업 스레드)",
            en: "The script task failed (worker thread)"
        ))),
        Err(_) => {
            // 결과 미확인 — 그 연결은 다시 쓰지 않는다(열린 트랜잭션은 서버가 되돌린다).
            engine.abandon();
            let mut run = EngineRun::new();
            run.end = End::CommitLost(tr!(
                ko: "엔진이 스크립트 시한 뒤에도 답하지 않습니다(연결이 멈췄을 수 있습니다)",
                en: "The engine did not answer even after the script time limit (the connection may be stuck)"
            ));
            Ok(run)
        }
    }
}

// ── 화면 꼴 ──

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StmtOut {
    pub index: usize,
    pub start: usize,
    pub end: usize,
    pub keyword: String,
    #[serde(flatten)]
    pub out: QueryOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptFailed {
    pub index: usize,
    pub start: usize,
    pub end: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptOut {
    /// `committed` · `rolledBack` · `readOnly` · `refused` · `unknown` · `disconnected` · `work` · `workUndone` · `workEnded` —
    /// 저절로 연 작업의 첫 실행이라 작업까지 닫았으면 `rolledBack` + [`ScriptOut::work_closed`].
    pub outcome: &'static str,
    /// `error` · `cancelled` · `timedOut` · `commitFailed` · `maxAffected`(없으면 끝까지 갔다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    /// 거절이면 나뉜 수 — 나누기부터 거절이면 0.
    pub total: usize,
    pub results: Vec<StmtOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<ScriptFailed>,
    /// 비밀 없음.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<super::tx::TxView>,
    /// 떼어 둔 동안 끝나 다시 붙은 화면에 건네는 요약이다(결과 행은 버렸다).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub detached: bool,
    /// 판 15 — 자동 커밋 끔 · 조회만 든 스크립트를 엔진이 읽기 전용으로 거절했다(다시 돌지 않았다 — 단문의 `[db-needs-work]` 와 같은 뜻).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub needs_work: bool,
    /// 저절로 연 작업을 첫 오류 · 멈춤으로 되돌린 뒤 닫았다(`outcome: "rolledBack"` 과 함께). 모르는 GUI 는 버리고 `rolledBack` 으로 읽는다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub work_closed: bool,
}

pub(crate) fn refused(e: &PlanError) -> ScriptOut {
    let total = match e {
        PlanError::Statement { total, .. } => *total,
        _ => 0,
    };
    let failed = match e {
        PlanError::Statement { index, start, end, err, .. } => Some(ScriptFailed {
            index: *index,
            start: *start,
            end: *end,
            message: err.message(),
        }),
        _ => None,
    };
    ScriptOut {
        outcome: "refused",
        reason: None,
        total,
        results: Vec::new(),
        message: failed.is_none().then(|| e.message()),
        failed,
        elapsed_ms: 0,
        tx: None,
        detached: false,
        needs_work: false,
        work_closed: false,
    }
}

/// 이유 코드 없이 — 목록의 한 줄.
fn failure_text(e: &EngineError, ctl: &Ctl, ms: u64) -> String {
    match e {
        EngineError::Interrupted => match ctl.interrupt_reason() {
            Stop::Cancelled => tr!(ko: "취소했습니다", en: "Cancelled"),
            Stop::TimedOut => tr!(
                ko: "시간 제한({secs}초)을 넘어 멈췄습니다",
                en: "Stopped after the time limit ({secs} s)",
                secs = ms.div_ceil(1000)
            ),
            // 상한은 문장 사이에서만 멈춘다(끊지 않는다).
            Stop::OverLimit => tr!(ko: "영향 행 상한을 넘었습니다", en: "Over the affected-row limit"),
        },
        EngineError::Busy => EngineError::busy_message(),
        EngineError::Message(m) | EngineError::ReadOnlyRefused(m) | EngineError::Unconfirmed(m) => m.clone(),
    }
}

pub(crate) fn report(plan: &[Planned], run: EngineRun, mode: ScriptMode, ctl: &Ctl, stmt_ms: u64, elapsed_ms: u64) -> ScriptOut {
    let n = run.done.len();
    let results: Vec<StmtOut> = run
        .done
        .into_iter()
        .zip(plan.iter())
        .enumerate()
        .map(|(i, (out, p))| StmtOut {
            index: i,
            start: p.start,
            end: p.end,
            keyword: p.keyword.clone(),
            out,
        })
        .collect();
    let failed = run.failed.as_ref().and_then(|e| {
        plan.get(n).map(|p| ScriptFailed {
            index: n,
            start: p.start,
            end: p.end,
            message: failure_text(e, ctl, stmt_ms),
        })
    });
    let stop_reason = |s: Stop| match s {
        Stop::Cancelled => "cancelled",
        Stop::TimedOut => "timedOut",
        Stop::OverLimit => "maxAffected",
    };
    let reason = match (&run.failed, run.stopped) {
        (Some(EngineError::Interrupted), _) => Some(stop_reason(ctl.interrupt_reason())),
        (Some(_), _) => Some("error"),
        (None, Some(s)) => Some(stop_reason(s)),
        (None, None) => None,
    };
    let note = run.note.clone();
    let (outcome, reason, message) = match (&run.end, mode) {
        (End::Committed, _) => ("committed", None, note),
        (End::ReadOnlyDone, _) => ("readOnly", reason, None),
        (End::RolledBack, ScriptMode::ReadOnly) => ("readOnly", reason, None),
        (End::RolledBack, _) => ("rolledBack", reason.or(Some("error")), note),
        (End::CommitFailed(m), _) => ("rolledBack", Some("commitFailed"), Some(m.clone())),
        (End::CommitLost(m), _) => ("unknown", reason, Some(m.clone())),
        (End::EndedByStatement, _) => (
            "unknown",
            reason,
            Some(tr!(
                ko: "문장이 트랜잭션을 스스로 끝냈습니다(프로시저 안의 COMMIT · 암묵 커밋) — 앞 문장들이 커밋됐는지 앱은 알 수 없습니다",
                en: "A statement ended the transaction by itself (COMMIT inside a procedure · implicit commit) — the app cannot tell whether the earlier statements were committed"
            )),
        ),
        (End::Disconnected, _) => ("disconnected", reason, None),
        (End::WorkKept, _) => ("work", reason, None),
        (End::WorkEnded, _) => ("workEnded", reason.or(Some("error")), note),
        (End::WorkRunUndone, _) => ("workUndone", reason.or(Some("error")), note),
        // 판 13 GUI 도 아는 `unknown` 으로 싣는다(새 결과 이름 없음) — 작업 칸(`tx`)도 `unknown` 이다.
        (End::WorkUnknown(m), _) => ("unknown", reason, Some(m.clone())),
    };
    ScriptOut {
        outcome,
        reason,
        total: plan.len(),
        results,
        failed,
        message,
        elapsed_ms,
        tx: None,
        detached: false,
        needs_work: false,
        work_closed: false,
    }
}

/// 결과 행을 버린다(컬럼 · 영향 행 수 · 시간은 남긴다).
pub(crate) fn summary(mut out: ScriptOut) -> ScriptOut {
    for r in &mut out.results {
        if !r.out.rows.is_empty() {
            r.out.rows.clear();
            r.out.truncated = true;
        }
    }
    out.detached = true;
    out
}
