//! **스크립트 실행기**(쿼리 타일 2단계 — 10-13 결정, docs/log/2026-10-13-db-write-mcp-design.md) — 문장 목록을 **한 요청**으로 받아
//! 실행 **전에 전부 검증**하고, 한 연결을 쥔 채 **한 트랜잭션**으로 차례로 돌린다. 첫 오류에서 멈추고 전부 되돌리며, 모두 성공하면 커밋한다.
//!
//! 이 모듈은 사람 화면(`table` — 타일의 연결 표 · 임대 · 작업 칸)을 모른다. 입구는 둘이다:
//! - [`plan`] — 글 → 검증된 문장 목록([`Planned`] — 이 모듈만 만든다: **엔진의 스크립트 길은 가드를 지난 문장만 받는다**를 형으로 지킨다).
//! - [`execute`] — 엔진 연결 하나 + 계획 → 문장별 결과([`EngineRun`]). 연결은 부르는 쪽이 준다 — 사람 타일의 연결(`table::script`)이든
//!   3단계 AI 작업안이 따로 연 연결이든 같은 함수다(3단계는 여기에 붙인다 — 지금 MCP 에는 DB 도구가 없다).
//!
//! ## 모드([`ScriptMode`])
//!
//! | 모드 | 언제 | 트랜잭션 | 가드 |
//! |---|---|---|---|
//! | `ReadOnly` | 읽기 전용 타일 · 자동 커밋을 끈 쓰기 타일의 조회만 든 스크립트(작업 없음 — `table::script`) | 엔진의 `READ ONLY` 트랜잭션 하나 → 끝에 늘 `ROLLBACK` | 문장마다 읽기 전용 허용 목록 |
//! | `Write` | 쓰기 모드 · 자동 커밋 켬 · 작업 없음 | 트랜잭션 하나 → 모두 성공하면 `COMMIT` · 첫 오류 · 취소 · 시한이면 `ROLLBACK` | 문장마다 [`guard::Mode::Transaction`](사람의 트랜잭션 문장 · MySQL 암묵 커밋 · PG 트랜잭션 밖 전용 거절) |
//! | `InWork` | 1단계 트랜잭션 작업이 열려 있음(자동 커밋을 끈 타일이 저절로 연 것 포함) | **그 작업 안**에서 차례로 — 커밋하지 않는다(사람이 [커밋]) · 스크립트 한 벌이 **세이브포인트 하나**(10-14 결정): 첫 오류 · 멈춤이면 이번 실행분만 되돌리고 작업은 산다([`End::WorkRunUndone`]) · 엔진이 트랜잭션 전체를 끝냈으면(교착 · SQLite 되감김 · 끊김) [`End::WorkEnded`] | 같음 |
//!
//! ## 상한
//!
//! - 문장 수 [`STATEMENTS_MAX`](100) · 글 [`SCRIPT_BYTES_MAX`](1 MiB) — 손으로 쓰는 스크립트의 넉넉한 크기. 덤프 적재 도구가 아니다.
//! - 시간: 문장마다 타일의 시한(기본 30초 · 서버의 `statement_timeout` 등 지금 규칙) **그리고** 스크립트 전체 [`SCRIPT_TIMEOUT`](10분 —
//!   한 문장의 상한 `TIMEOUT_MAX_MS` 와 같다). 남은 전체 시간이 문장 시한보다 짧으면 그 문장의 시한을 줄인다.
//! - 결과: SELECT(행을 돌려주는 문장)마다 타일의 행 상한 그대로, **응답 전체**는 [`RESULT_BUDGET`](8 MiB — 단문 응답 상한과 같다)에서
//!   자른다(넘으면 뒤 결과의 행부터 빠지고 `truncated`). 문장을 하나 끝낼 때마다 잘라 서버 기억도 그 안에 머문다.
//!
//! ## 영향 행 수
//!
//! 문장마다 엔진이 알려 준 수다 — PG 의 `RETURNING` 이 붙은 `INSERT`·`UPDATE`·`DELETE`·`MERGE` 는 돌려준 행을 끝까지 세어 준다(행
//! 상한 너머는 세기만 하고 버린다 — 3단계 `maxAffected` 가 기댄다). **트리거 · 외래 키 연쇄 · CTE 안의 쓰기는 세지 않는다**(엔진의
//! 명령 태그 · `changes()` 와 같은 뜻). MySQL 의 `UPDATE` 는 실제로 바뀐 행 수다(값이 같아 안 바뀐 행은 빠진다 — 서버 기본).
//!
//! ## 멈추기
//!
//! - 취소(`db_cancel`): 문장 사이면 다음 문장을 시작하지 않고, 도는 중이면 엔진 끊기(`interrupt`) — 어느 쪽이든 되돌린다.
//! - 시한: [`watchdog`] 가 지금 문장의 시한(+ 네트워크 엔진은 2초 여유 — 서버의 시한이 먼저)을 넘으면 끊는다.
//! - 커밋을 보낸 뒤에는 끊지 않는다(끊는 것은 결과를 더 모르게 할 뿐이다) — 답을 못 받으면 **결과 불명**(다시 보내지 않는다).
//! - GUI 가 사라져도(F5 · 크래시 · GUI 종료) 실행기는 서버 태스크라 끝까지 간다(커밋 또는 되돌림) — 반쯤 실행한 트랜잭션을 열어 두지
//!   않는다. 타일 닫기 · TTL · 서버 끝은 연결을 닫으므로 서버가 되돌린다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::guard::{self, GuardError};
use super::table::Engine;
use super::value::approx_len;
use super::{Dialect, EngineError, QueryOut, RunEnd};
use crate::i18n::tr;

/// 스크립트 하나의 문장 수 상한.
pub(crate) const STATEMENTS_MAX: usize = 100;
/// 스크립트 글의 상한(바이트).
pub(crate) const SCRIPT_BYTES_MAX: usize = 1024 * 1024;
/// 스크립트 전체의 시한 — 한 문장의 상한(`TIMEOUT_MAX_MS`)과 같다.
pub(crate) const SCRIPT_TIMEOUT: Duration = Duration::from_millis(super::TIMEOUT_MAX_MS);
/// 응답 전체(결과 행 JSON)의 대략 상한 — 단문 응답 상한과 같다.
pub(crate) const RESULT_BUDGET: usize = super::RESPONSE_MAX;
/// 네트워크 엔진의 시한 여유 — 서버의 시한(`statement_timeout` · `max_execution_time` …)이 먼저 끊게(`table` 의 그물과 같은 값).
const NET_GRACE: Duration = Duration::from_secs(2);
/// 엔진이 시한 뒤에도 안 돌아올 때 기다리는 마지막 한도 — 넘으면 결과 불명으로 돌려준다(엔진 태스크는 제 길을 끝까지 간다).
const ABANDON_AFTER: Duration = Duration::from_secs(60);

/// 실행 모드(머리말 표).
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

/// 가드를 지난 문장 하나 — [`plan`] 만 만든다(칸이 이 모듈 밖에서 비공개).
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

/// 실행 전 거절 — 아무것도 실행하지 않았다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlanError {
    TooLarge,
    TooMany(usize),
    /// 나누기 자체가 거절됐다(빈 글 · 경계가 해석마다 다름 · `DELIMITER` …).
    Split(GuardError),
    /// `index` 번째(0 기준) 문장이 가드에 걸렸다 — 자리는 UTF-16 · `total` = 나뉜 문장 수.
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

/// 바이트 자리들(오름차순) → UTF-16 자리들.
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

/// 글 → 검증된 문장 목록 — **하나라도 거절이면 아무것도 돌려주지 않는다**(실행 0).
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

/// 왜 멈췄나(문장의 오류가 아닌 것).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stop {
    Cancelled,
    TimedOut,
    /// 영향 행 합이 상한([`Ctl::with_affected_cap`] — 3단계 AI 작업안의 `maxAffected`)을 넘었다 — 커밋하지 않고 되돌린다.
    OverLimit,
}

/// 실행 중의 제어 — 취소 깃발(표의 `Running` 과 같은 것) · 시한 · 결과 예산. 엔진 루프와 [`watchdog`] 가 함께 본다.
pub(crate) struct Ctl {
    cancelled: Arc<AtomicBool>,
    timed_out: AtomicBool,
    deadline: Instant,
    stmt_ms: u64,
    /// 지금 도는 문장의 시한(없으면 문장 사이 · 커밋 중).
    current: Mutex<Option<Instant>>,
    /// 남은 결과 예산(바이트).
    budget: Mutex<usize>,
    /// 영향 행 합의 상한(없으면 보지 않는다 — 사람의 스크립트) · 지금까지의 합 · 넘었나.
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

    /// **영향 행 합의 상한**(3단계 AI 작업안의 `maxAffected`) — 문장을 하나 끝낼 때마다([`Ctl::keep`]) 엔진이 알려 준 영향 행을 더하고,
    /// 합이 상한을 넘으면 그 자리에서 멈춘다([`Stop::OverLimit`] — 다음 문장을 시작하지 않고 커밋 대신 되돌린다). 영향 행을 모르는
    /// 문장(`None` — DDL · 행을 세지 않는 꼴)은 0 으로 센다(검토 카드가 그런 문장을 따로 밝힌다).
    pub(crate) fn with_affected_cap(mut self, cap: u64) -> Ctl {
        self.affected_cap = Some(cap);
        self
    }

    /// 지금까지 끝낸 문장들의 영향 행 합.
    pub(crate) fn affected_total(&self) -> u64 {
        *Self::lock(&self.affected)
    }

    fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 다음 문장을 시작한다 — 그 문장의 시한(ms). 취소됐거나 전체 시한이 다 됐으면 `None`(멈춘다).
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

    /// 문장이 끝났다(시계를 내린다).
    pub(crate) fn end_stmt(&self) {
        *Self::lock(&self.current) = None;
    }

    /// 멈추라는 말이 있나(취소 · 시한) — 커밋 직전에도 · 작업 안 세이브포인트를 풀기 직전에도 본다(Codex 검토 반영 1 — 마지막 문장이 도는
    /// 중의 취소가 다음 문장 없이 끝나도 놓치지 않게). **전체 시한**도 여기서 다시 잰다(지났으면 시한으로 멈춘다).
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

    /// 끊긴 문장(`Interrupted`)의 까닭 — 사람의 취소가 아니면 시한이다.
    pub(crate) fn interrupt_reason(&self) -> Stop {
        if self.cancelled.load(Ordering::SeqCst) {
            Stop::Cancelled
        } else {
            Stop::TimedOut
        }
    }

    /// 결과 하나를 예산 안으로 자르고 쥔다 — 넘으면 그 결과의 뒤 행부터 빼고 `truncated`.
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

    /// 시한을 넘은 문장을 [`watchdog`] 가 보았다 — 그 문장을 끊는다.
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

/// 엔진이 스크립트를 어떻게 끝냈나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum End {
    /// 모두 성공 → 커밋했다.
    Committed,
    /// 되돌렸다(오류 · 취소 · 시한 — 엔진이 스스로 되감은 경우 포함).
    RolledBack,
    /// 읽기 전용 스크립트를 끝냈다(늘 되돌림).
    ReadOnlyDone,
    /// 커밋을 서버가 거절했다(직렬화 실패 · 미뤄 둔 제약) — 서버가 되돌렸다.
    CommitFailed(String),
    /// 커밋을 보냈는데 답을 못 받았다 — 결과 불명.
    CommitLost(String),
    /// 문장이 트랜잭션을 스스로 끝냈다(가드가 못 본 암묵 커밋 · 프로시저 안의 `COMMIT`) — 앞 문장들이 커밋됐는지 모른다.
    EndedByStatement,
    /// 연결이 끊겼다(커밋을 보내기 전) — 서버가 되돌렸다.
    Disconnected,
    /// 작업 안 — 작업은 열려 있다(커밋하지 않았다).
    WorkKept,
    /// 작업 안 — 엔진이 작업을 끝냈다(교착 · SQLite 되감김 · 끊김 · 세이브포인트마저 실패).
    WorkEnded,
    /// 작업 안 — 첫 오류 · 멈춤에서 **이번 실행분만** 세이브포인트로 되돌렸다(`ROLLBACK TO` 성공을 확인했다). 작업은 열려 있다(앞서 쌓은
    /// 변경은 그대로 — 10-14 결정).
    WorkRunUndone,
    /// 작업 안 — 트랜잭션이 끝났는데 결과를 증명할 수 없다(세이브포인트 복구 실패 · 알 수 없는 까닭으로 사라짐 — Codex 검토 반영 1). 사연.
    WorkUnknown(String),
}

impl End {
    /// 작업 안 실행 한 번의 엔진 판정([`RunEnd`]) → 끝(덧말은 [`EngineRun::note`] 로).
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

/// 엔진 한 번의 스크립트 결과.
#[derive(Debug)]
pub(crate) struct EngineRun {
    /// 성공한 문장들의 결과(차례대로 — `done.len()` 번째가 멈춘 자리).
    pub done: Vec<QueryOut>,
    /// 멈춘 문장의 오류.
    pub failed: Option<EngineError>,
    /// 문장 사이에서 멈췄다(취소 · 전체 시한).
    pub stopped: Option<Stop>,
    pub end: End,
    /// 덧말(MySQL 경고 1196 — 되돌리지 못한 비트랜잭션 변경 · 남은 행 잠금 · 복구 실패의 사연) — 화면의 `message` 로.
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

    /// 커밋하면 안 되는가(오류 · 멈춤).
    pub(crate) fn must_roll_back(&self, ctl: &Ctl) -> bool {
        self.failed.is_some() || self.stopped.is_some() || ctl.stopped().is_some()
    }
}

/// 엔진이 스크립트를 받기 전 상태 확인의 거절 — 계획을 세운 뒤 쓰기 · 작업 상태가 바뀌었다.
pub(crate) fn state_changed() -> EngineError {
    EngineError::Message(tr!(
        ko: "실행 직전에 쓰기 모드 · 트랜잭션 작업 상태가 바뀌었습니다 — 다시 실행하세요",
        en: "Write mode or the transaction state changed just before running — run again"
    ))
}

/// **시계** — 지금 문장의 시한(+ 여유)을 넘으면 엔진을 끊는다. 실행이 끝나면 부르는 쪽이 멈춘다(`abort`).
async fn watchdog(engine: Engine, ctl: Arc<Ctl>, grace: Duration) {
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if ctl.expire_current(grace) {
            engine.interrupt();
        }
    }
}

/// 계획을 엔진 연결 하나에서 돌린다 — 표를 모르는 함수(머리말 "입구"). 엔진이 받기 전 거절(바쁨 · 끊김 · 상태가 바뀜 · 트랜잭션을
/// 열지 못함)은 `Err` — 그때는 아무것도 실행하지 않았다.
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
            // 결과 미확인 — 그 연결은 다시 쓰지 않는다(끊김으로 표시하고 닫는다 — 열린 트랜잭션은 서버가 되돌린다, Codex 검토 반영 1).
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

// ---------------------------------------------------------------------------
// 화면 꼴
// ---------------------------------------------------------------------------

/// 문장 하나의 결과(성공한 것만 — 실패는 [`ScriptFailed`]).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StmtOut {
    /// 0 기준 차례.
    pub index: usize,
    /// 원래 글에서의 자리(UTF-16).
    pub start: usize,
    pub end: usize,
    /// 첫 낱말(대문자 — 화면 목록의 이름표).
    pub keyword: String,
    #[serde(flatten)]
    pub out: QueryOut,
}

/// 멈춘 문장(실행 전 거절 · 실행 중 오류 · 끊김).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptFailed {
    pub index: usize,
    pub start: usize,
    pub end: usize,
    pub message: String,
}

/// `db_script` 의 답.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptOut {
    /// `committed` · `rolledBack` · `readOnly` · `refused`(실행 전 거절 — 실행 0) · `unknown`(결과 불명 — 작업 안 실행의 결과 불명도 이것 ·
    /// Codex 검토 반영 1) · `disconnected` ·
    /// `work`(작업 안 — 커밋 안 함, 작업은 열림) · `workUndone`(작업 안 — 이번 실행분만 되돌림, 작업은 열림 · 판 13 — 저절로 연 작업의
    /// 첫 실행이라 작업까지 닫았으면 `rolledBack` + [`ScriptOut::work_closed`]) ·
    /// `workEnded`(작업 안 — 엔진이 작업을 끝냄).
    pub outcome: &'static str,
    /// 멈춘 까닭 — `error` · `cancelled` · `timedOut` · `commitFailed` · `maxAffected`(AI 작업안의 영향 행 상한 — 없으면 끝까지 갔다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    /// 계획한 문장 수(거절이면 나뉜 수 — 나누기부터 거절이면 0).
    pub total: usize,
    pub results: Vec<StmtOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<ScriptFailed>,
    /// 사연(커밋 거절 · 결과 불명의 까닭 · 나누기 거절 문구) — 비밀 없음.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub elapsed_ms: u64,
    /// 트랜잭션 작업 상태(표가 채운다).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<super::tx::TxView>,
    /// 떼어 둔 동안 끝나 다시 붙은 화면에 건네는 요약이다(결과 행은 버렸다 — 기억을 들고 있지 않게).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub detached: bool,
    /// 판 15 — 자동 커밋 끔 · 조회만 든 줄 안 스크립트를 PG · MySQL 엔진이 실행 중에 읽기 전용으로 거절했다(다시 돌지 않았다 — 단문의
    /// `[db-needs-work]` 와 같은 뜻 · 표가 채운다). 화면이 [트랜잭션 작업 시작] 단추를 함께 보인다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub needs_work: bool,
    /// 자동 커밋 끔 · 작업 없음에서 이 실행이 작업을 **저절로 열었고**, 첫 오류 · 멈춤으로 이번 실행분을 되돌린 뒤 빈 작업도 닫았다
    /// (`outcome: "rolledBack"` 과 함께 — 바뀐 것 없음 · 작업은 남지 않음). 모르는 GUI 는 버리고 `rolledBack`("전부 되돌림")으로 읽는다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub work_closed: bool,
}

/// 실행 전 거절의 답.
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

/// 엔진 오류 → 문장 실패 문구(이유 코드 없이 — 목록의 한 줄).
fn failure_text(e: &EngineError, ctl: &Ctl, ms: u64) -> String {
    match e {
        EngineError::Interrupted => match ctl.interrupt_reason() {
            Stop::Cancelled => tr!(ko: "취소했습니다", en: "Cancelled"),
            Stop::TimedOut => tr!(
                ko: "시간 제한({secs}초)을 넘어 멈췄습니다",
                en: "Stopped after the time limit ({secs} s)",
                secs = ms.div_ceil(1000)
            ),
            // 끊김의 까닭은 사람의 취소 아니면 시한이다 — 상한은 문장 사이에서만 멈춘다(끊지 않는다).
            Stop::OverLimit => tr!(ko: "영향 행 상한을 넘었습니다", en: "Over the affected-row limit"),
        },
        EngineError::Busy => EngineError::busy_message(),
        EngineError::Message(m) | EngineError::ReadOnlyRefused(m) | EngineError::Unconfirmed(m) => m.clone(),
    }
}

/// 엔진의 결과 → 화면 꼴(작업 칸 `tx` 는 부르는 쪽이 채운다).
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

/// 떼어 둔 화면에 건넬 요약 — 결과 행을 버린다(컬럼 · 영향 행 수 · 시간은 남긴다).
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
