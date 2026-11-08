//! **DB 연결 표** — 세션 서버 프로세스에 한 벌. 열쇠는 타일의 `stream`(프런트 tileKey 글자), 값은 핸들·임대 회차·쥔 창·
//! 엔진 연결이다. **세션 코어(`session_core`)에 오르지 않는다** — DB 연결은 셸 세션이 아니라 MCP·떨어진 세션 목록에 섞이면
//! 안 된다. 임대 규칙만 세션 코어와 같은 꼴(`[stale-lease]`)로 따로 둔다.
//!
//! ## 규칙(5단계 — 기본만)
//!
//! - `db_open` 이 **같은 stream · 같은 연결 참조**로 오면 새로 열지 않고 기존 연결에 다시 붙는다 — 임대 회차 +1, 쥔 창·연결을
//!   바꾸고 `reattached: true`(페이지 리로드·창 이관 뒤의 타일). 연결 참조가 다르면 옛 연결을 닫고 새로 연다.
//! - 핸들을 받는 호출(`db_query`·`db_schema`·`db_objects`·`db_table_detail`·`db_definition`·`db_set_write`·`db_tx`)은 **지금 임대 회차**와 같아야 한다 — 옛 임대면
//!   `[stale-lease]`(다른 창이 같은 타일에 다시 붙었다). 없는 핸들은 `[session-gone]`(닫혔다 — 프런트는 다시 연다).
//! - `db_cancel` 은 임대를 보지 않는다(그 쿼리 id 가 지금 돌 때만 끊는다). `db_close` 는 임대를 주면 본다.
//! - 쿼리는 연결 하나에 **한 번에 하나**(돌고 있으면 바로 거절 — 줄 세우지 않는다). 실행 · 작업 시작 · [커밋] · [되돌리기] · 모드
//!   바꾸기(쓰기 · 자동 커밋) · 메타 조회 · 방치 되돌리기가 모두 **한 조정 장치**([`claim`])를 지나고, 작업 id · 모드 검증도 그 안에서
//!   한다(Codex 검토 반영 2 — 검증과 엔진 진입 사이에 다른 요청이 끼지 않게). 실행이 돌면 [커밋]도 바쁨으로 거절한다.
//! - 시간 제한은 이 표가 잰다 — 넘으면 엔진의 끊기(`interrupt`)를 부르고 엔진이 돌아오기를 기다린다. 끊긴 까닭(시간 초과·
//!   사람의 취소)을 가르는 것도 여기다.
//!
//! - 엔진: SQLite(블로킹 풀) · PostgreSQL(비동기 — `pg`) · MySQL/MariaDB(비동기 — `mysql`). SSH 경유는 서버가 `db-connections.json`
//!   에서 연결을 직접 해석하고 그 호스트의 공유 SSH 전송로를 빌린다(`net`). **끊긴 네트워크 연결**(`is_dead`)에는 다시 붙지 않고
//!   새로 연다(`[다시 연결]`).
//!
//! ## 수명(9단계 — session_core 를 흉내 내되 그 밖에 산다)
//!
//! | 사건 | DB 연결 |
//! |---|---|
//! | 타일 닫기(`db_close`) | 닫음 |
//! | 페이지 리로드·웹뷰 크래시(`detach_window`) | **떼어 둠** → [`DETACH_TTL`] 뒤 닫음 · 그 안에 같은 stream 으로 `db_open` 이면 재부착 |
//! | GUI 종료·강제 종료·마지막 창 X(quitAll)·GUI 연결 끊김(`conn_gone`) | 떼어 둠 → TTL(셸은 살지만 DB 는 TTL 만 — 다시 켜서 복원되면 재부착) |
//! | 보조 창 파괴(`close_window`) | 닫음(떼어 둔 것까지 · 이관 중인 stream 은 뺀다) |
//! | 트레이 [모든 세션 종료](`close_all`) · 서버 끝 | 닫음(비밀번호를 묻는 동안 세워 둔 전송로까지 — `net::drop_all_parked`) |
//! | 탭·타일 이관(handoff) | 받는 창이 짐을 꺼낼 때 쥔 창을 옮기고(`set_home` — 보낸 창의 `close_window` 보다 먼저), 같은 stream 으로 `db_open` = 재부착(옛 창 임대는 stale) |
//!
//! - **떼어 둔다** = 쥔 쪽(창·연결)은 그대로 두고 떼어 둔 시각을 적는다 · 도는 쿼리는 취소한다. 엔진·SSH 전송로 핀·터널·제어 연결은
//!   그대로 쥐고 있다가 TTL 이 지나면 [`retire`](엔진 `shutdown` — 핀·터널·제어 연결까지)로 거둔다. 지금 임대로 다시 부르면(늦게 닿은
//!   `detach_window` 가 살아 있는 타일을 떼어 놓은 경우) 다시 붙은 것으로 친다.
//! - TTL 시계는 **표 하나에 태스크 하나**([`reaper`]) — 가장 이른 마감까지 자고, 떼어 둘 때마다 깨운다.
//! - **세션 코어 밖이다** — 떨어진 세션 목록·MCP `list_sessions` 에 섞이지 않는다(서버 통합 시험이 지킨다).
//!
//! ## 트랜잭션 작업(1단계 — 칸은 `tx`, 엔진 몫은 각 엔진의 `tx_begin` · `tx_end` · `in_tx`)
//!
//! | 사건 | 열린 작업 |
//! |---|---|
//! | 사람의 [커밋] · [되돌리기](`db_tx`) | 그 작업 id 일 때만(`[db-tx-stale]`) — 끝나면 대기(새 작업을 저절로 열지 않는다) |
//! | 작업 안 실행(문장 하나 · 스크립트 한 벌) | 엔진이 **세이브포인트 하나**로 감싼다(10-14 결정 — 실패하면 그 실행만 되돌리고 작업은 계속, 세 엔진 공통). 그 뒤 엔진의 진실로 맞춘다([`after_tx_statement`] — 엔진이 트랜잭션 전체를 끝냈을 때만 작업이 끝난다: 교착 · SQLite 되감김 · 끊김) |
//! | 자동 커밋 끔(10-14 — [`Entry::auto_commit`]) | 작업 밖 조회는 엔진의 읽기 전용 길 · 데이터를 바꾸는 문장은 작업을 저절로 연다([`query`] · [`script`]). 허용 목록 문장을 PG · MySQL 엔진이 **실행 중에** 읽기 전용으로 거절하면 다시 돌지 않고 `[db-needs-work]` 안내로 끝낸다(부작용이 두 번 나지 않게 — Codex 검토 반영 1) |
//! | 응답 대기 중단([`run_timed`] 의 버림) | **실행 결과 미확인**(`EngineError::Unconfirmed`) — 그 연결은 버린다(엔진 `abandon` — 끊김 표시 + 소켓 닫기 · 열린 작업은 서버가 되돌린다 → `disconnected`). "이번 실행만 되돌림" 이라 하지 않는다 |
//! | 무활동 10분(`tx::IDLE_LIMIT`) | [`reaper`] 가 1분 전 경고 이벤트 → 되돌림(이벤트) — 사람의 문장 · [연장] 만 시계를 늘린다. 다른 일이 돌거나 엔진이 바쁘면 미뤘다가 다시 간다(그 일이 끝날 때 · [`IDLE_RETRY`] 뒤 — Codex 검토 반영 2) |
//! | 페이지 리로드 · 크래시 · GUI 종료(떼어 둠) | **그대로 둔다**(방치 시계는 계속 흐른다 · 도는 문장도 끊지 않는다 — 끊으면 그 실행분이 되돌려진다). 다시 붙으면 `Opened.tx` 로 칩이 돌아온다 |
//! | 이관(handoff) | 같은 항목 · 같은 작업(시계 유지) — 받는 창이 다시 붙는다 |
//! | 쓰기 끄기([`set_write`]) | 되돌린 뒤 끈다(화면이 먼저 확인을 받는다) |
//! | 타일 닫기 · 보조 창 파괴 · 트레이 [모든 세션 종료] · 서버 끝 · TTL | 연결을 닫는다 = 서버가 되돌린다(화면이 타일 · 보조 창 닫기 전에 확인을 받는다) |
//!
//! ## 스크립트 실행(2단계 — 실행기는 `db::script`, 입구는 [`script`])
//!
//! | 사건 | 도는 스크립트 |
//! |---|---|
//! | [취소](`db_cancel`) | 멈추고 되돌린다(작업 안이면 그 실행분만 — 세이브포인트) |
//! | 페이지 리로드 · 크래시 · GUI 종료(떼어 둠) | **끊지 않는다**(`Work::Script`) — 서버가 끝까지 끝내거나 되돌리고, 떼어 둔 동안 끝났으면 요약을 남겨 다시 붙는 화면에 한 번(`Opened.last_script`) |
//! | 타일 닫기 · 보조 창 파괴 · 모두 닫기 · TTL · 서버 끝 | 멈추고 되돌린다([`retire`] 가 취소 깃발을 세우고 엔진을 닫는다 — 연결이 닫히면 서버도 되돌린다) |
//! - **서버 고아 자진 종료(`serve::Busy`)는 DB 연결을 세지 않는다** — 붙은 DB 연결은 그 GUI 연결이 이미 `clients` 로 세이고, 떼어 둔
//!   것의 TTL(10분)은 고아 시계(기본 10분 — `server::DEFAULT_IDLE`)와 같은 순간(GUI 연결이 끊긴 때)에 함께 시작한다. 그래서 DB
//!   만 남은 서버는 TTL 즈음 함께 끝나고, 끝날 때 남은 DB 연결을 닫는다([`close_all`]) — 세면 "TTL 10분 + 고아 10분" 으로 서버가
//!   쓸데없이 두 배를 산다. 셸 세션이 있으면 서버는 계속 살고 DB 는 TTL 이 거둔다.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::mysql::{self, Mysql};
use super::net::{self, NetTarget, OpenError, OpenSecrets};
use super::pg::{self, Pg};
use super::sqlite::Sqlite;
use super::script::{self, ScriptMode, ScriptOut};
use super::{conns, guard, tx, Dialect, EngineError, QueryOut, RunEnd, TxEndError};
use crate::errors::{with_reason, CANCELLED, DB_NEEDS_WORK, DB_UNCONFIRMED, SESSION_GONE, STALE_LEASE};
use crate::i18n::tr;
use super::conns::DbEngine;

/// stream 글자의 상한.
const STREAM_MAX: usize = 256;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `db_open` 의 연결 **참조** — 값(경로·주소·경유)이 아니라 열쇠(`db-connections.json` 의 id)다. 서버가 파일에서 해석한다.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) struct ConnRef {
    pub id: String,
}

/// 엔진 연결.
#[derive(Clone)]
pub(crate) enum Engine {
    Sqlite(Arc<Sqlite>),
    Pg(Arc<Pg>),
    Mysql(Arc<Mysql>),
}

impl Engine {
    pub(crate) fn dialect(&self) -> Dialect {
        match self {
            Engine::Sqlite(_) => Dialect::Sqlite,
            Engine::Pg(_) => Dialect::Postgres,
            Engine::Mysql(_) => Dialect::Mysql,
        }
    }

    pub(crate) fn interrupt(&self) {
        match self {
            Engine::Sqlite(s) => s.interrupt(),
            Engine::Pg(p) => p.interrupt(),
            Engine::Mysql(m) => m.interrupt(),
        }
    }

    pub(super) fn writable(&self) -> bool {
        match self {
            Engine::Sqlite(s) => s.writable(),
            Engine::Pg(p) => p.writable(),
            Engine::Mysql(m) => m.writable(),
        }
    }

    pub(super) fn server_version(&self) -> String {
        match self {
            Engine::Sqlite(_) => Sqlite::server_version(),
            Engine::Pg(p) => p.server_version(),
            Engine::Mysql(m) => m.server_version(),
        }
    }

    /// 연결이 이미 끊겼다(PG · MySQL — 전송로 사망 · 서버가 끊음). 다시 붙기 대신 새로 연다.
    pub(super) fn is_dead(&self) -> bool {
        match self {
            Engine::Sqlite(_) => false,
            Engine::Pg(p) => p.is_dead(),
            Engine::Mysql(m) => m.is_dead(),
        }
    }

    /// 앱이 연 트랜잭션 작업이 엔진에서 살아 있나(엔진의 진실 — 마지막 일 뒤).
    fn in_tx(&self) -> bool {
        match self {
            Engine::Sqlite(s) => s.in_tx(),
            Engine::Pg(p) => p.in_tx(),
            Engine::Mysql(m) => m.in_tx(),
        }
    }

    /// 결과를 확인하지 못한 실행이 남은 연결을 버린다 — 끊김으로 표시하고 소켓을 닫는다(Codex 검토 반영 1 — 다음 일에 다시 쓰지 않는다).
    pub(crate) fn abandon(&self) {
        match self {
            Engine::Sqlite(s) => s.abandon(),
            Engine::Pg(p) => p.abandon(),
            Engine::Mysql(m) => m.abandon(),
        }
    }

    /// 마지막 작업 안 실행 한 번의 정리(엔진의 판정 — 한 번 꺼낸다).
    fn take_run_end(&self) -> Option<RunEnd> {
        match self {
            Engine::Sqlite(s) => s.take_run_end(),
            Engine::Pg(p) => p.take_run_end(),
            Engine::Mysql(m) => m.take_run_end(),
        }
    }

    /// 표에서 빠질 때 — 도는 것을 끊는다(PG 는 연결·터널·전송로 자리까지 놓는다).
    pub(super) fn shutdown(&self) {
        match self {
            Engine::Sqlite(s) => s.interrupt(),
            Engine::Pg(p) => p.shutdown(),
            Engine::Mysql(m) => m.shutdown(),
        }
    }
}

/// 연결의 일 한 가지 — **조정 장치**([`Entry::running`] · [`claim`])가 한 번에 하나만 들인다(Codex 검토 반영 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Work {
    /// 문장 하나(`db_query`) — 떼어 두기가 끊는다(작업 밖일 때).
    Query,
    /// 스크립트(`db_script`) — 떼어 두기가 끊지 않는다(서버가 끝까지 끝내거나 되돌린다).
    Script,
    /// 메타 조회(스키마 · 객체 · 테이블 구조 · 정의) — 방치 시계가 이 동안 되돌리러 가지 않는다.
    Meta,
    /// 작업 시작([트랜잭션 작업 시작]).
    Begin,
    /// 사람의 [커밋] · [되돌리기].
    End,
    /// 모드 바꾸기(쓰기 · 자동 커밋).
    Mode,
    /// 방치 시계의 되돌리기.
    Idle,
}

/// 지금 도는 일.
struct Running {
    work: Work,
    /// 화면이 붙인 쿼리 id(`Query` · `Script` 만 — 취소의 열쇠).
    query_id: String,
    cancelled: Arc<AtomicBool>,
}

/// 쥔 쪽 — 창 라벨(`detach_window`·`close_window`·`set_home` 의 열쇠) + 서버 연결 번호(`conn_gone` 의 열쇠).
#[derive(Debug, Clone)]
struct Holder {
    window: String,
    conn: u64,
}

struct Entry {
    handle: u64,
    stream: String,
    target: ConnRef,
    engine: Engine,
    lease: AtomicU64,
    holder: Mutex<Holder>,
    /// **조정 장치**(Codex 검토 반영 2) — 실행 · 작업 시작 · 끝내기 · 모드 바꾸기 · 메타 조회 · 방치 되돌리기가 모두 여기서 한 번에
    /// 하나만 든다([`claim`]). 작업 id · 모드 검증도 이 잠금 안에서 한다 — "쿼리의 작업 id 검사 통과 → 다른 요청이 커밋 → 쿼리가 엔진에
    /// 들어감(자동 커밋 길)" 순서가 생기지 않게. 돌고 있으면 바로 거절(줄 세우지 않는다 — 커밋이 사람이 결과를 못 본 실행 뒤에 줄 서지 않게).
    running: Mutex<Option<Running>>,
    /// 방치 되돌리기가 엔진에 닿지 못했다(바쁨 등) — 이 시각 전에는 다시 가지 않는다(시계가 헛돌지 않게 · [`tx_tick`]).
    idle_retry_at: Mutex<Option<Instant>>,
    /// 떼어 둔 시각(`None` = 붙어 있다) — 이로부터 TTL 뒤에 [`reaper`] 가 닫는다.
    detached: Mutex<Option<Instant>>,
    /// 트랜잭션 작업(1단계 — `tx`). 방치 시계도 [`reaper`] 가 같이 본다.
    tx: Mutex<tx::Slot>,
    /// 떼어 둔 동안 끝난 스크립트의 요약(2단계) — 다시 붙는 화면에 한 번 건넨다(`Opened.last_script`).
    script_note: Mutex<Option<ScriptOut>>,
    /// **자동 커밋**(쓰기 모드 띠의 토글 — 10-14 결정, 기본 켬). 끄면 작업 밖의 데이터를 바꾸는 문장이 작업을 저절로 연다([`query`] ·
    /// [`script`]). 저장하지 않는다 — 새 연결은 켬, 재부착은 이 값 그대로(F5 뒤에 자동 커밋으로 몰래 돌아가지 않게 서버가 쥔다). 쓰기를
    /// 끄면 켬으로 돌아간다.
    auto_commit: AtomicBool,
}

impl Entry {
    /// 자동 커밋을 끈 쓰기 타일인가.
    fn auto_off(&self) -> bool {
        self.engine.writable() && !self.auto_commit.load(Ordering::SeqCst)
    }

    fn detached_at(&self) -> Option<Instant> {
        *lock(&self.detached)
    }

    /// 떼어 둔다 — 이미 떼어 뒀으면 시각을 그대로 둔다(TTL 이 늘어나지 않게). 도는 쿼리는 취소한다(받을 화면이 없다) — **트랜잭션
    /// 작업 안이면 끊지 않는다**: 끊긴 실행은 되돌려지므로(10-13 결정 — 떼어 두기는 작업을 지킨다 · 10-14 부터는 세이브포인트로 그 실행분만) 그 문장은 제 시간
    /// 제한까지 돌고 결과만 버려진다.
    fn detach(&self, now: Instant) -> bool {
        {
            let mut d = lock(&self.detached);
            if d.is_some() {
                return false;
            }
            *d = Some(now);
        }
        let in_tx = lock(&self.tx).open_id().is_some();
        if let Some(run) = lock(&self.running).as_ref() {
            if !in_tx && run.work == Work::Query {
                run.cancelled.store(true, Ordering::SeqCst);
                self.engine.interrupt();
            }
        }
        true
    }

    /// 표의 작업 칸을 엔진의 진실에 맞춘다 — 표가 모르게 끝난 작업(버려진 PG 담당 태스크 · 끊긴 연결)을 결과로 옮긴다. 옮겼으면
    /// 그 결과.
    fn reconcile_tx(&self) -> Option<tx::Outcome> {
        let mut s = lock(&self.tx);
        if !s.is_open() || self.engine.in_tx() {
            return None;
        }
        let outcome = if self.engine.is_dead() {
            tx::Outcome::Disconnected
        } else {
            tx::Outcome::ErrorRolledBack
        };
        let note = (outcome == tx::Outcome::Disconnected).then(tx_disconnected_note);
        s.finish(outcome, note).map(|e| e.outcome)
    }

    /// 화면 꼴(엔진의 진실에 맞춘 뒤).
    fn tx_view(&self) -> tx::TxView {
        self.reconcile_tx();
        lock(&self.tx).view(Instant::now())
    }

    fn reattach(&self) {
        *lock(&self.detached) = None;
    }
}

#[derive(Default)]
struct Table {
    by_stream: HashMap<String, Arc<Entry>>,
    by_handle: HashMap<u64, Arc<Entry>>,
    /// 지금 살아 있는 서버 연결 번호 — 끊긴 뒤에 끝난 열기·다시 붙기는 곧바로 떼어 둔다(아무도 `conn_gone` 을 다시 부르지 않는다 ·
    /// 세션 쪽 재리뷰 R02 와 같은 구멍).
    conns: HashSet<u64>,
}

/// 떼어 둔 DB 연결을 살려 두는 시간 — 페이지 리로드·GUI 재시작 뒤 같은 타일이 비밀번호를 다시 묻지 않고 붙게(10-12 사용자 결정).
pub(crate) const DETACH_TTL: Duration = Duration::from_secs(600);
/// 시험이 짧게 바꾸는 자리(ms) — 0 이면 [`DETACH_TTL`].
static TTL_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn ttl() -> Duration {
    match TTL_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => DETACH_TTL,
        ms => Duration::from_millis(ms),
    }
}

/// 시험 전용 — 떼어 둔 연결의 TTL 을 바꾼다(`None` = 원래대로).
#[cfg(test)]
pub(crate) fn set_detach_ttl_for_test(d: Option<Duration>) {
    TTL_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
    REAPER_WAKE.notify_one();
}

static TABLE: LazyLock<Mutex<Table>> = LazyLock::new(Default::default);

/// 핸들의 바탕 — 서버가 다시 떠도 GUI 가 쥔 옛 핸들과 겹치지 않게 시각에서 뽑는다(SSH id 와 같은 규칙).
static NEXT_HANDLE: LazyLock<AtomicU64> = LazyLock::new(|| {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    AtomicU64::new((secs % 2000 + 1) * 1_000_000)
});

/// `db_open` 의 답.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opened {
    pub handle: u64,
    pub lease: u64,
    pub dialect: &'static str,
    pub server_version: String,
    pub writable: bool,
    pub reattached: bool,
    /// 트랜잭션 작업(1단계) — 다시 붙으면 열린 작업의 칩이 돌아온다. 판 8 GUI 는 모르는 칸이라 무시한다.
    pub tx: tx::TxView,
    /// 판 10 — 스크립트 실행(`db_script`)을 받는다(화면이 [스크립트 실행] 을 세운다 — 판 9 서버는 이 칸이 없다).
    pub scripts: bool,
    /// 떼어 둔 동안 끝난 스크립트의 요약(다시 붙을 때 한 번 — 결과 행 없음).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_script: Option<ScriptOut>,
    /// 판 13 — 자동 커밋 토글의 지금 값(쓰기 모드가 아니면 늘 참). 판 12 서버는 이 칸이 없다(화면이 토글을 숨긴다).
    pub auto_commit: bool,
}

fn opened(e: &Entry, reattached: bool) -> Opened {
    Opened {
        handle: e.handle,
        lease: e.lease.load(Ordering::SeqCst),
        dialect: e.engine.dialect().as_str(),
        server_version: e.engine.server_version(),
        writable: e.engine.writable(),
        reattached,
        tx: e.tx_view(),
        scripts: true,
        last_script: if reattached { lock(&e.script_note).take() } else { None },
        auto_commit: !e.auto_off(),
    }
}

fn gone() -> String {
    with_reason(
        SESSION_GONE,
        tr!(
            ko: "DB 연결을 찾을 수 없습니다 — 이미 닫혔습니다",
            en: "Could not find the database connection — it is already closed"
        ),
    )
}

fn stale() -> String {
    with_reason(
        STALE_LEASE,
        tr!(
            ko: "이 타일의 DB 연결 손잡이가 낡았습니다 — 다른 창이 같은 연결에 다시 붙었습니다",
            en: "This tile's database connection handle is stale — another window reattached to it"
        ),
    )
}

fn task_failed() -> String {
    tr!(ko: "DB 작업이 실패했습니다(작업 스레드)", en: "The database task failed (worker thread)")
}

fn lookup(handle: u64, lease: Option<u64>) -> Result<Arc<Entry>, String> {
    let e = lock(&TABLE).by_handle.get(&handle).cloned().ok_or_else(gone)?;
    if let Some(l) = lease {
        if e.lease.load(Ordering::SeqCst) != l {
            return Err(stale());
        }
        // 지금 임대가 부른다 = 그 타일은 살아 있다(늦게 닿은 `detach_window` 가 떼어 놓았어도) — 다시 붙은 것으로.
        e.reattach();
    }
    Ok(e)
}

fn stream_ok(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= STREAM_MAX && !s.chars().any(char::is_control)
}

/// 옛 연결을 표에서 빼고 도는 쿼리를 끊는다(엔진은 마지막 `Arc` 가 떨어질 때 닫힌다).
fn retire(t: &mut Table, e: &Arc<Entry>) {
    t.by_handle.remove(&e.handle);
    if t.by_stream.get(&e.stream).is_some_and(|x| Arc::ptr_eq(x, e)) {
        t.by_stream.remove(&e.stream);
    }
    // 도는 스크립트는 멈추고 되돌린다(다음 문장을 시작하지 않는다 — 연결이 닫히면 서버도 되돌린다).
    if let Some(run) = lock(&e.running).as_ref() {
        run.cancelled.store(true, Ordering::SeqCst);
    }
    e.engine.shutdown();
}

/// 참조가 가리키는 연결 — 파일에서 해석한 값.
#[derive(Debug)]
pub(super) enum Resolved {
    Sqlite(String),
    Pg(NetTarget),
    /// MySQL · MariaDB(엔진 하나 — 갈래는 접속 뒤 서버 버전으로).
    Mysql(NetTarget),
}

/// 참조를 **파일에서** 해석한다(블로킹 풀) — `db-connections.json` 의 그 id 줄(GUI 가 보낸 주소를 믿지 않는다 — 몸에는 참조뿐이다).
/// 경유 호스트가 `~/.ssh/config` 에 없으면 분명한 문구로 거절한다(SSH 쪽은 모르는 별칭을 호스트 이름으로 보고 붙으려 한다).
async fn resolve(target: &ConnRef) -> Result<Resolved, String> {
    let id = target.id.clone();
    tokio::task::spawn_blocking(move || {
        let d = conns::find(&id)?;
        let hosts = match d.via {
            Some(_) => crate::ssh_config::load_default()?.hosts,
            None => Vec::new(),
        };
        resolve_conn(d, |alias| hosts.iter().any(|h| conns::same_alias(&h.name, alias)))
    })
    .await
    .map_err(|_| task_failed())?
}

/// 파일의 한 줄 → 붙을 곳 — **순수**(경유 호스트가 있는지는 `known` 이 답한다 — 시험이 주입).
pub(super) fn resolve_conn(d: conns::DbConn, known: impl Fn(&str) -> bool) -> Result<Resolved, String> {
    if d.engine == DbEngine::Sqlite {
        if d.via.is_some() {
            return Err(tr!(
                ko: "SSH 경유 SQLite 연결은 지원하지 않습니다 — SQLite 는 이 PC 의 파일만 엽니다",
                en: "SQLite connections over SSH are not supported — SQLite opens files on this PC only"
            ));
        }
        return d.path.map(Resolved::Sqlite).ok_or_else(|| {
            tr!(ko: "SQLite 연결에는 파일 경로가 필요합니다", en: "A SQLite connection needs a file path")
        });
    }
    if let Some(alias) = d.via.as_deref() {
        if !known(alias) {
            return Err(tr!(
                ko: "경유 호스트 '{alias}' 를 찾을 수 없습니다 — 호스트 목록(~/.ssh/config)에 없습니다. DB 연결을 편집해 경유를 고르세요",
                en: "Could not find the jump host '{alias}' — it is not in the host list (~/.ssh/config). Edit the database connection and pick a jump host"
            ));
        }
    }
    let pg = d.engine == DbEngine::Postgres;
    let t = NetTarget {
        id: d.id,
        host: d.host.unwrap_or_else(|| "localhost".into()),
        port: d.port.unwrap_or(if pg { pg::DEFAULT_PORT } else { mysql::DEFAULT_PORT }),
        database: d.database,
        user: d.user,
        tls: d.tls_mode.unwrap_or_default(),
        tls_ca: d.tls_ca,
        via: d.via,
        adhoc: None,
    };
    Ok(if pg { Resolved::Pg(t) } else { Resolved::Mysql(t) })
}

/// 엔진을 연다 — 참조를 파일에서 해석한 값으로.
async fn open_engine(stream: &str, target: &ConnRef, secrets: OpenSecrets) -> Result<Engine, OpenError> {
    match resolve(target).await? {
        Resolved::Sqlite(path) => {
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), false))
                .await
                .map_err(|_| task_failed())??;
            Ok(Engine::Sqlite(Arc::new(s)))
        }
        Resolved::Pg(t) => Ok(Engine::Pg(Arc::new(Pg::connect(stream, t, secrets).await?))),
        Resolved::Mysql(t) => Ok(Engine::Mysql(Arc::new(Mysql::connect(stream, t, secrets).await?))),
    }
}

/// 연다 — 같은 stream·같은 참조면 다시 붙는다(끊긴 PG 연결이면 새로 연다). `secrets` 는 새로 열 때만 쓴다.
pub(crate) async fn open(
    stream: String,
    window: String,
    conn: u64,
    target: ConnRef,
    secrets: OpenSecrets,
) -> Result<Opened, OpenError> {
    if !stream_ok(&stream) {
        return Err(OpenError::Msg(tr!(ko: "타일 열쇠가 올바르지 않습니다", en: "The tile key is invalid")));
    }
    if let Some(e) = reattach(&stream, &target, &window, conn) {
        return Ok(e);
    }
    let engine = open_engine(&stream, &target, secrets).await?;
    let mut t = lock(&TABLE);
    // 여는 사이 같은 stream 이 섰다 — 같은 참조면 그쪽에 붙고(방금 연 것은 버린다), 다르면 옛것을 닫는다.
    if let Some(old) = t.by_stream.get(&stream).cloned() {
        if old.target == target && !old.engine.is_dead() {
            drop(t);
            engine.shutdown();
            if let Some(e) = reattach(&stream, &target, &window, conn) {
                return Ok(e);
            }
            return Err(OpenError::Msg(gone()));
        }
        retire(&mut t, &old);
    }
    let entry = Arc::new(Entry {
        handle: NEXT_HANDLE.fetch_add(1, Ordering::SeqCst),
        stream: stream.clone(),
        target,
        engine,
        lease: AtomicU64::new(1),
        holder: Mutex::new(Holder { window, conn }),
        running: Mutex::new(None),
        idle_retry_at: Mutex::new(None),
        detached: Mutex::new(None),
        tx: Mutex::new(tx::Slot::default()),
        script_note: Mutex::new(None),
        auto_commit: AtomicBool::new(true),
    });
    // 여는 사이 그 연결이 끊겼다 — 받을 화면이 없다. 곧바로 떼어 둔다(TTL 이 거둔다 · 다시 켠 GUI 가 붙을 수 있다).
    if !t.conns.contains(&conn) && entry.detach(Instant::now()) {
        wake_reaper();
    }
    t.by_stream.insert(stream, entry.clone());
    t.by_handle.insert(entry.handle, entry.clone());
    Ok(opened(&entry, false))
}

/// 있는 연결에 **다시 붙기만** 한다(`db_open` 의 `reattachOnly`) — 없거나(TTL 이 지났다 · 닫혔다) 참조가 다르거나 끊겼으면
/// `[session-gone]`(새로 열지 않는다 — 부르는 쪽이 볼트·비밀번호 관문을 지나 평소처럼 연다).
pub(crate) fn reattach_only(stream: &str, window: &str, conn: u64, target: &ConnRef) -> Result<Opened, String> {
    if !stream_ok(stream) {
        return Err(gone());
    }
    reattach(stream, target, window, conn).ok_or_else(gone)
}

/// 같은 stream·같은 참조의 연결이 있으면 임대 회차 +1 · 쥔 쪽 교체. 참조가 다르거나 끊긴 연결이면 옛것을 닫고 `None`.
fn reattach(stream: &str, target: &ConnRef, window: &str, conn: u64) -> Option<Opened> {
    let mut t = lock(&TABLE);
    let e = t.by_stream.get(stream).cloned()?;
    if e.target != *target || e.engine.is_dead() {
        retire(&mut t, &e);
        return None;
    }
    e.lease.fetch_add(1, Ordering::SeqCst);
    *lock(&e.holder) = Holder {
        window: window.to_string(),
        conn,
    };
    if t.conns.contains(&conn) {
        e.reattach();
    } else if e.detach(Instant::now()) {
        wake_reaper();
    }
    Some(opened(&e, true))
}

/// 네트워크 엔진(PG · MySQL)은 서버(`statement_timeout` · `max_execution_time`/`max_statement_time`)나 엔진 자신의 타이머
/// (MySQL 의 SELECT 아닌 문장 — `KILL QUERY`)가 먼저 끊는다 — 표의 타이머는 그 뒤의 그물(전송로가 멈춰 서버에 닿지 못할 때).
const PG_TIMER_GRACE: Duration = Duration::from_secs(2);
/// 끊기를 보낸 뒤 엔진이 돌아오기를 기다리는 한도(네트워크 엔진 — 끊기 요청이 닿지 않을 수 있다). 넘으면 작업을 버린다.
const PG_ABANDON_AFTER: Duration = Duration::from_secs(5);

/// 엔진 일 하나 — 시한을 넘으면 끊고 돌아오기를 기다린다(네트워크 엔진은 [`PG_ABANDON_AFTER`] 까지만). `bool` = 시간 초과로 끊었나.
/// `stop` = 시한에 세울 멈춤 깃발(작업 안 문장 — 엔진이 세이브포인트를 풀기 직전에 본다).
///
/// 네트워크 엔진이 끊기 뒤에도 돌아오지 않으면 **기다리기를 멈춘다** — 그 실행은 서버에서 계속 돌 수 있어 결과가 **미확인**이다
/// ([`EngineError::Unconfirmed`] — "되돌림" 이 아니다, Codex 검토 반영 1). 그 연결은 버린다(`Engine::abandon` — 끊김 표시 + 소켓 닫기:
/// 열린 트랜잭션은 서버가 되돌리고, 화면은 [다시 연결] 로 새 연결을 연다).
pub(crate) async fn run_timed<T: Send + 'static>(
    engine: &Engine,
    timeout: Duration,
    mut task: tokio::task::JoinHandle<Result<T, EngineError>>,
    stop: Option<&AtomicBool>,
) -> (Result<T, EngineError>, bool) {
    let pg = matches!(engine, Engine::Pg(_) | Engine::Mysql(_));
    let timer = if pg { timeout + PG_TIMER_GRACE } else { timeout };
    let mut timed_out = false;
    let r = tokio::select! {
        r = &mut task => r,
        _ = tokio::time::sleep(timer) => {
            timed_out = true;
            if let Some(s) = stop {
                s.store(true, Ordering::SeqCst);
            }
            engine.interrupt();
            if pg {
                match tokio::time::timeout(PG_ABANDON_AFTER, &mut task).await {
                    Ok(r) => r,
                    Err(_) => {
                        task.abort();
                        engine.abandon();
                        return (Err(EngineError::Unconfirmed(unconfirmed_message())), true);
                    }
                }
            } else {
                task.await
            }
        }
    };
    (r.unwrap_or_else(|_| Err(EngineError::Message(task_failed()))), timed_out)
}

/// 응답 대기를 멈췄다 — 실행 결과 미확인.
fn unconfirmed_message() -> String {
    tr!(
        ko: "시간 제한 뒤 취소를 보냈는데도 서버가 답하지 않아 기다리기를 멈추고 이 연결을 끊었습니다 — 그 문장이 실행됐는지(자동 커밋이면 반영됐는지) 앱은 알 수 없습니다. 다시 연결해 데이터를 확인하세요",
        en: "The server did not answer even after a cancel at the time limit, so the app stopped waiting and closed this connection — it cannot tell whether the statement ran (or, with auto-commit, was applied). Reconnect and check the data"
    )
}

/// 자동 커밋을 끈 타일의 조회 길에서 PG · MySQL 엔진이 **실행 중에** 읽기 전용으로 거절했다 — 다시 돌지 않는다(Codex 검토 반영 1).
fn needs_work_message(engine_msg: &str) -> String {
    with_reason(DB_NEEDS_WORK, needs_work_text(engine_msg))
}

/// [`needs_work_message`] 의 이유 코드 없는 꼴 — 스크립트 결과의 문장 실패 줄(화면이 이유 코드를 떼지 않는 자리).
fn needs_work_text(engine_msg: &str) -> String {
    format!(
        "{}\n{engine_msg}",
        tr!(
            ko: "이 문장은 데이터를 바꿉니다(함수 · CTE 안의 쓰기) — 조회로 실행해 보다 엔진이 거절했고, 그 앞의 부작용이 두 번 나지 않게 다시 실행하지 않았습니다. [트랜잭션 작업 시작] 뒤 다시 실행하세요.",
            en: "This statement changes data (a write inside a function or CTE) — the engine refused it when run as a query, and the app did not run it again so side effects before that do not happen twice. Use [Start transaction], then run it again."
        )
    )
}

fn timed_out_message(ms: u64) -> String {
    tr!(
        ko: "시간 제한({secs}초)을 넘어 쿼리를 멈췄습니다",
        en: "The query was stopped after the time limit ({secs} s)",
        secs = ms.div_ceil(1000)
    )
}

/// 엔진 오류 → 사람 문구.
pub(super) fn message(err: EngineError, timed_out: bool, cancelled: bool, timeout_ms: u64) -> String {
    match err {
        EngineError::Interrupted if cancelled && !timed_out => {
            with_reason(CANCELLED, tr!(ko: "쿼리를 취소했습니다", en: "The query was cancelled"))
        }
        // 사람의 취소가 아니면 시간 초과다 — PG 는 서버의 `statement_timeout` 이 표의 타이머보다 먼저 끊는다.
        EngineError::Interrupted => timed_out_message(timeout_ms),
        EngineError::Busy => EngineError::busy_message(),
        // 결과 미확인 — 이유 코드를 단다(판 15 · 화면이 '결과 불명' 틀로 보인다).
        EngineError::Unconfirmed(m) => with_reason(DB_UNCONFIRMED, m),
        EngineError::Message(m) | EngineError::ReadOnlyRefused(m) => m,
    }
}

/// 도는 일 표시를 지운다(같은 일일 때만). 방치 되돌리기가 아닌 일이 끝나면 시계를 깨운다 — 그 일 때문에 미룬 방치 되돌리기가
/// 곧바로 다시 간다([`tx_tick`] — 메타 조회 · 문장 · 작업 시작 등 무엇이든).
struct ClearRunning<'a>(&'a Entry, Arc<AtomicBool>);

impl Drop for ClearRunning<'_> {
    fn drop(&mut self) {
        let wake = {
            let mut r = lock(&self.0.running);
            match r.as_ref() {
                Some(x) if Arc::ptr_eq(&x.cancelled, &self.1) => {
                    let wake = x.work != Work::Idle;
                    *r = None;
                    wake
                }
                _ => false,
            }
        };
        if wake && lock(&self.0.tx).open_id().is_some() {
            wake_reaper();
        }
    }
}

/// **조정 장치에 든다**(Codex 검토 반영 2) — 다른 일이 돌고 있으면 바쁨. 잠금을 쥔 채 엔진의 진실로 작업 칸을 맞추고(`reconcile_tx`)
/// `check`(작업 id · 모드 검증)를 부른다 — 그래서 검증과 엔진 진입 사이에 다른 요청(커밋 · 작업 시작 · 모드 바꾸기 · 방치 되돌리기)이
/// 끼지 못한다. 든 표지(취소 깃발)를 돌려준다 — 부르는 쪽이 곧바로 [`ClearRunning`] 으로 쥔다.
fn claim(e: &Entry, work: Work, query_id: String, check: impl FnOnce(&Entry) -> Result<(), String>) -> Result<Arc<AtomicBool>, String> {
    let mut r = lock(&e.running);
    if r.is_some() {
        return Err(EngineError::busy_message());
    }
    e.reconcile_tx();
    check(e)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    *r = Some(Running {
        work,
        query_id,
        cancelled: cancelled.clone(),
    });
    Ok(cancelled)
}

/// 메타 조회 · 모드 바꾸기처럼 검증할 것이 없는 일.
fn no_check(_: &Entry) -> Result<(), String> {
    Ok(())
}

/// 시험 전용 — 그 핸들의 다음 `db_query` 를 **조정 장치에 든 직후 · 엔진에 들기 전**에 세운다(`reached` 를 울리고 `go` 를 기다린다).
/// 경합 재현 시험이 "작업 id 검사 통과 → 다른 요청의 커밋 → 엔진 진입" 순서를 강제하는 자리.
#[cfg(test)]
type PausePair = (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>);
#[cfg(test)]
static PAUSE_AFTER_CLAIM: LazyLock<Mutex<HashMap<u64, PausePair>>> = LazyLock::new(Default::default);

/// 시험 전용 — [`PAUSE_AFTER_CLAIM`] 을 건다. `(reached, go)`.
#[cfg(test)]
pub(crate) fn pause_query_after_claim_for_test(handle: u64) -> PausePair {
    let pair = (Arc::new(tokio::sync::Notify::new()), Arc::new(tokio::sync::Notify::new()));
    lock(&PAUSE_AFTER_CLAIM).insert(handle, pair.clone());
    pair
}

#[cfg(test)]
async fn pause_point(handle: u64) {
    let pair = lock(&PAUSE_AFTER_CLAIM).remove(&handle);
    if let Some((reached, go)) = pair {
        reached.notify_one();
        go.notified().await;
    }
}

/// 문장 하나를 돌린다. `tx_expect` = 부르는 화면이 아는 트랜잭션 작업 id(`0` = 작업 없음 · `None` = 판 8 GUI — 보지 않는다) —
/// 다르면 `[db-tx-stale]`(재부착 · 이관 사이에 작업이 바뀌었다 — 자동 커밋으로 알고 친 문장이 남의 작업 안에서 돌지 않게).
///
/// **자동 커밋을 끈 쓰기 타일**(10-14 결정 — [`Entry::auto_commit`])이고 작업이 없으면: 가드의 읽기 전용 허용 목록 안 문장(SELECT 류)은
/// **트랜잭션을 열지 않고** 엔진의 읽기 전용 길(문장마다 `READ ONLY` 트랜잭션 · 곧바로 되돌림 — MySQL 메타데이터 잠금 · PG 스냅숏을
/// 남기지 않는다)로 돌고, 그 밖의 문장(데이터를 바꾸는 문장)은 **작업을 저절로 열고** 그 안에서 돈다. 허용 목록 문장이 엔진의 읽기
/// 전용에 걸리면(함수 · CTE 안의 쓰기): SQLite 는 실행 **전** 판정(`readonly()`)이라 작업을 열어 다시 돌고, PG · MySQL 은 실행 **중**
/// 거절이라(그 앞의 부작용 — `pg_advisory_lock` · `GET_LOCK` 등 — 이 이미 났을 수 있다) **다시 돌지 않고** `[db-needs-work]` 안내로
/// 끝낸다(Codex 검토 반영 1). 저절로 연 작업에서 그 첫 실행이 실패하면(쌓인 문장 0) 빈 작업을 조용히 닫는다(잠금 · 방치 시계를 남기지 않게).
pub(crate) async fn query(
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    max_rows: usize,
    timeout_ms: u64,
    tx_expect: Option<u64>,
) -> Result<QueryOut, String> {
    let e = lookup(handle, Some(lease))?;
    // 작업 id 검사는 조정 장치 안에서 — 그 뒤 엔진에 들 때까지 다른 요청이 작업 · 모드를 바꾸지 못한다(Codex 검토 반영 2).
    let cancelled = claim(&e, Work::Query, query_id, |e| match tx_expect {
        Some(id) => lock(&e.tx).expect(id).map_err(|r| r.message()),
        None => Ok(()),
    })?;
    let _clear = ClearRunning(&e, cancelled.clone());
    #[cfg(test)]
    pause_point(e.handle).await;
    let mut read = false;
    let mut opened_now = false;
    if e.auto_off() && !lock(&e.tx).is_open() {
        if auto_off_reads(&sql, e.engine.dialect())? {
            read = true;
        } else {
            begin_work(&e).await?;
            opened_now = true;
        }
    }
    // 저절로 연 작업 — "이번 실행만 되돌림" 의 덧말은 빈 작업을 닫아 본 뒤에 고른다(`held` 에 엔진의 덧말을 맡겨 둔다).
    let mut held: Option<Option<String>> = None;
    let mut r = match exec(&e, &sql, max_rows, timeout_ms, read, &cancelled, opened_now.then_some(&mut held)).await {
        Ok(r) => r,
        Err(_) if cancelled.load(Ordering::SeqCst) => Err(message(EngineError::Interrupted, false, true, timeout_ms)),
        // SQLite — 실행 전 판정이라 바뀐 것 없음. 작업을 열고 그 안에서 다시 돈다.
        Err(_) if e.engine.dialect() == Dialect::Sqlite => {
            begin_work(&e).await?;
            opened_now = true;
            exec(&e, &sql, max_rows, timeout_ms, false, &cancelled, Some(&mut held)).await.unwrap_or_else(|_| Err(task_failed()))
        }
        // PG · MySQL — 실행 중 거절. 다시 돌지 않는다(부작용이 두 번 나지 않게).
        Err(m) => Err(needs_work_message(&m)),
    };
    if opened_now && r.is_err() {
        let closed = drop_empty_work(&e).await;
        if let (Some(extra), Err(m)) = (held, r.as_mut()) {
            let note = if closed {
                fresh_undone_note(extra.as_deref())
            } else {
                tx_run_undone_note(lock(&e.tx).view(Instant::now()).statements, extra.as_deref())
            };
            *m = format!("{m}\n{note}");
        }
    }
    r.map(|mut out| {
        out.tx = Some(e.tx_view());
        out
    })
}

/// 자동 커밋을 끈 타일의 작업 밖 문장 하나 — 읽기 전용 길로 돌 조회인가(`true`), 작업을 열 문장인가(`false`). 작업 안에서도 받지
/// 않을 문장이면(트랜잭션 문장 · 여러 문장 · MySQL 암묵 커밋 · PG 트랜잭션 밖 전용) 아무것도 열지 않고 거절 문구.
pub(crate) fn auto_off_reads(sql: &str, d: Dialect) -> Result<bool, String> {
    guard::check_mode(sql, d, guard::Mode::Transaction).map_err(|err| auto_off_refusal(&err))?;
    Ok(guard::check_mode(sql, d, guard::Mode::ReadOnly).is_ok())
}

/// 자동 커밋을 끈 동안의 가드 거절 문구 — 작업 안에서 못 도는 문장(MySQL 암묵 커밋 · PG 트랜잭션 밖 전용)은 "자동 커밋을 켜고" 로
/// 안내한다(작업이 아직 없으니 "작업을 끝낸 뒤" 가 아니다). 나머지는 가드의 문구 그대로.
pub(crate) fn auto_off_refusal(err: &guard::GuardError) -> String {
    match err {
        guard::GuardError::ImplicitCommit => tr!(
            ko: "자동 커밋을 끈 동안에는 MySQL · MariaDB 가 암묵적으로 커밋하는 문장(DDL · 계정 · 권한 · 관리 문장 · LOAD DATA)을 실행하지 않습니다 — 위 띠의 스위치를 '자동 커밋'으로 바꾸고 실행하세요.",
            en: "While auto-commit is off, statements that MySQL · MariaDB commit implicitly (DDL · accounts · privileges · admin statements · LOAD DATA) do not run — flip the switch in the bar above to 'Auto-commit' and run it."
        ),
        guard::GuardError::OutsideTransaction => tr!(
            ko: "자동 커밋을 끈 동안에는 PostgreSQL 이 트랜잭션 안에서 실행하지 않는 문장(VACUUM · … CONCURRENTLY · CREATE/DROP DATABASE · ALTER SYSTEM 등)을 실행하지 않습니다 — 위 띠의 스위치를 '자동 커밋'으로 바꾸고 실행하세요.",
            en: "While auto-commit is off, statements PostgreSQL does not run inside a transaction (VACUUM · … CONCURRENTLY · CREATE/DROP DATABASE · ALTER SYSTEM, etc.) do not run — flip the switch in the bar above to 'Auto-commit' and run it."
        ),
        guard::GuardError::ProcedureCall => tr!(
            ko: "자동 커밋을 끈 동안에는 MySQL · MariaDB 프로시저 호출(CALL)을 실행하지 않습니다 — 프로시저 안의 COMMIT · ROLLBACK 을 앱이 볼 수 없어 [커밋] 전까지 반영되지 않는다는 약속을 지킬 수 없습니다. 위 띠의 스위치를 '자동 커밋'으로 바꾸고 실행하세요.",
            en: "While auto-commit is off, MySQL · MariaDB procedure calls (CALL) do not run — the app cannot see a COMMIT · ROLLBACK inside the procedure, so it cannot keep the promise that nothing applies before [Commit]. Flip the switch in the bar above to 'Auto-commit' and run it."
        ),
        guard::GuardError::TemporaryTable => tr!(
            ko: "자동 커밋을 끈 동안에는 MySQL · MariaDB 임시 테이블 만들기 · 지우기(CREATE/DROP TEMPORARY TABLE)를 실행하지 않습니다 — 되돌려지지 않습니다. 위 띠의 스위치를 '자동 커밋'으로 바꾸고 실행하세요.",
            en: "While auto-commit is off, MySQL · MariaDB temporary table creation · removal (CREATE/DROP TEMPORARY TABLE) does not run — it is not rolled back. Flip the switch in the bar above to 'Auto-commit' and run it."
        ),
        other => other.message(),
    }
}

/// 엔진에 문장 하나 — `read` = 쓰기 모드여도 읽기 전용 길(자동 커밋을 끈 타일의 작업 밖 조회). 작업 안이면 끝에 작업 칸을 엔진의
/// 진실로 맞춘다. `Err(엔진 문구)` = 읽기 전용 길이 데이터를 바꾸는 문장이라 엔진이 거절했다(부르는 쪽이 엔진에 따라 고른다 — [`query`]).
/// `cancelled` 는 엔진에도 멈춤 깃발로 건넨다(작업 안이면 세이브포인트를 풀기 직전에 다시 본다) — 시한 그물도 그 깃발을 세운다.
/// `held` = 이 실행이 **저절로 연 작업**의 첫 실행이다 — "이번 실행만 되돌림" 덧말을 붙이지 않고 엔진의 덧말을 여기 맡긴다(부르는
/// 쪽이 빈 작업을 닫아 본 뒤 고른다 — [`query`]).
async fn exec(
    e: &Entry,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
    read: bool,
    cancelled: &Arc<AtomicBool>,
    held: Option<&mut Option<Option<String>>>,
) -> Result<Result<QueryOut, String>, String> {
    // 작업 안의 문장 — 시작도 활동이다(긴 문장이 도는 동안 방치 시계가 먼저 닿지 않게 · 끝에서 다시 잰다).
    let in_tx = {
        let mut s = lock(&e.tx);
        s.touch(Instant::now());
        s.is_open()
    };
    let sql = sql.to_string();
    let stop = Arc::clone(cancelled);
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.query_ctl(&sql, max_rows, read, &stop)),
        Engine::Pg(p) => tokio::spawn(async move { p.query_ctl(&sql, max_rows, timeout_ms, read, &stop).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.query_ctl(&sql, max_rows, timeout_ms, read, &stop).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(timeout_ms), task, Some(cancelled)).await;
    if read && !in_tx {
        if let Err(EngineError::ReadOnlyRefused(m)) = r {
            return Err(m);
        }
    }
    let r = r.map_err(|err| message(err, timed_out, cancelled.load(Ordering::SeqCst), timeout_ms));
    Ok(if in_tx { after_tx_statement(e, r, held) } else { r })
}

/// 작업 안 문장 하나가 끝났다 — 엔진의 진실로 작업 칸을 맞춘다(10-13 결정: PG 는 트랜잭션 안 오류 = 곧바로 되돌림 · MySQL·
/// SQLite 는 엔진이 알려 준 대로 — 문장만 실패했으면 작업이 계속된다). 작업이 끝났으면 오류 문구에 그 사연을 한 줄 더한다.
///
/// 엔진의 정리([`RunEnd`] — Codex 검토 반영 1)를 따른다: **"이번 실행만 되돌림" 은 복구 성공(`Undone`)을 엔진이 확인했을 때만** 말한다.
/// 정리가 없으면(가드 거절 · 바쁨 — 엔진에 닿기 전) 덧말 없이 그대로. 엔진이 트랜잭션 전체를 끝냈으면 그 판정(되돌림 · 결과 불명)대로,
/// 끊겼으면 끊김(서버가 되돌린다). `held`(저절로 연 작업의 첫 실행)가 있으면 복구 성공의 덧말은 붙이지 않고 거기 맡긴다.
fn after_tx_statement(e: &Entry, r: Result<QueryOut, String>, held: Option<&mut Option<Option<String>>>) -> Result<QueryOut, String> {
    let now = Instant::now();
    let end = e.engine.take_run_end();
    let ended = {
        let mut s = lock(&e.tx);
        if !s.is_open() {
            None
        } else if e.engine.is_dead() {
            let note = tx_disconnected_note();
            s.finish(tx::Outcome::Disconnected, Some(note.clone()));
            Some(note)
        } else if e.engine.in_tx() {
            match end {
                Some(RunEnd::Undone { note }) => {
                    s.statement_done(false, now);
                    match held {
                        Some(slot) => {
                            *slot = Some(note);
                            None
                        }
                        None => Some(tx_run_undone_note(s.view(now).statements, note.as_deref())),
                    }
                }
                Some(RunEnd::Kept) => {
                    s.statement_done(r.is_ok(), now);
                    None
                }
                // 판정이 없다(엔진에 닿기 전 거절) · 작업이 산 채 다른 판정(일어나지 않는다) — 센 것만 맞춘다.
                _ => {
                    s.statement_done(false, now);
                    None
                }
            }
        } else {
            let (outcome, note) = match end {
                Some(RunEnd::Unknown(m)) => (tx::Outcome::Unknown, m),
                Some(RunEnd::RolledBack { note }) => (
                    tx::Outcome::ErrorRolledBack,
                    note.map_or_else(|| tx_error_note(e.engine.dialect()), |n| format!("{n}\n{}", tx_error_note(e.engine.dialect()))),
                ),
                _ if r.is_err() => (tx::Outcome::ErrorRolledBack, tx_error_note(e.engine.dialect())),
                _ => (tx::Outcome::Unknown, tx_ended_by_statement_note()),
            };
            s.finish(outcome, Some(note.clone()));
            Some(note)
        }
    };
    wake_reaper();
    match (r, ended) {
        (Err(m), Some(note)) => Err(format!("{m}\n{note}")),
        (r, _) => r,
    }
}

/// 저절로 연 작업(자동 커밋 끔)의 첫 실행이 실패해 쌓인 문장이 없다 — 빈 작업을 조용히 되돌리고 칸을 비운다(결과 알림 없음 — 사람은
/// 문장의 오류만 본다). 되돌리지 못했으면(엔진에 작업이 남음) 그대로 열어 둔다(칩이 보인다). `true` = 닫았다(작업이 남지 않았다).
async fn drop_empty_work(e: &Entry) -> bool {
    let Some(id) = lock(&e.tx).empty_open_id() else {
        return false;
    };
    if lock(&e.tx).start_ending(id).is_err() {
        return false;
    }
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.tx_end(false)),
        Engine::Pg(p) => tokio::spawn(async move { p.tx_end(false).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.tx_end(false).await }),
    };
    let _ = tokio::time::timeout(TX_END_TIMEOUT, task).await;
    let mut s = lock(&e.tx);
    let closed = !e.engine.in_tx();
    if closed {
        s.discard();
    } else {
        s.cancel_ending();
    }
    drop(s);
    wake_reaper();
    closed
}

/// 저절로 연 작업의 첫 실행이 실패해 그 작업을 닫았다 — 이번 실행분은 되돌렸고 작업은 남지 않았다(바뀐 것 없음). 엔진의 덧말 가운데
/// "행 잠금이 작업 끝까지 남을 수 있음"(MySQL · MariaDB)은 빼고(작업을 닫아 잠금도 풀렸다) 나머지(되돌리지 못한 비트랜잭션 변경)는 남긴다.
fn fresh_undone_note(extra: Option<&str>) -> String {
    let base = tr!(
        ko: "전부 되돌렸습니다 — 바뀐 것은 없습니다(트랜잭션 작업은 열리지 않았습니다).",
        en: "Everything was rolled back — nothing changed (no transaction was left open)."
    );
    match without_lock_note(extra) {
        Some(x) => format!("{base}
{x}"),
        None => base,
    }
}

/// 엔진의 덧말에서 MySQL · MariaDB 의 "남은 행 잠금" 줄을 뺀다(작업을 닫았을 때 — 잠금은 이미 풀렸다). 남는 것이 없으면 `None`.
pub(crate) fn without_lock_note(extra: Option<&str>) -> Option<String> {
    let lock_line = super::mysql::lock_kept_note();
    let kept: Vec<&str> = extra?.lines().filter(|l| *l != lock_line).collect();
    (!kept.is_empty()).then(|| kept.join("
"))
}

/// 작업 안 실행이 실패했다 — 세이브포인트로 이번 실행분만 되돌렸다(10-14 결정 — 세 엔진 공통 · 엔진이 복구 성공을 확인했을 때만).
/// `n` = 작업에 남은 문장 수 · `extra` = 엔진의 덧말(MySQL — 되돌리지 못한 비트랜잭션 변경 · 남은 행 잠금).
fn tx_run_undone_note(n: u32, extra: Option<&str>) -> String {
    let base = tr!(
        ko: "이번 실행만 되돌렸습니다 — 트랜잭션 작업은 그대로 열려 있습니다(앞서 실행한 {n}문장 유지).",
        en: "Only this run was rolled back — the transaction is still open (the {n} statements run before are kept).",
        n = n
    );
    match extra {
        Some(x) => format!("{base}\n{x}"),
        None => base,
    }
}

/// 엔진이 트랜잭션 전체를 되돌렸다(교착 1213 · `innodb_rollback_on_timeout` · SQLite 의 끊긴 쓰기 · PG · SQLite 의 세이브포인트 복구 실패 뒤
/// 전체 되돌리기 — 사람 문장이 커밋할 길이 없어 증명된다).
fn tx_error_note(_d: Dialect) -> String {
    tr!(
        ko: "엔진이 트랜잭션 전체를 되돌렸습니다(교착 · 끊긴 쓰기 등) — 커밋된 것은 없습니다.",
        en: "The engine rolled back the whole transaction (deadlock · interrupted write, etc.) — nothing was committed."
    )
}

fn tx_disconnected_note() -> String {
    tr!(
        ko: "연결이 끊겨 열린 트랜잭션은 서버가 되돌렸습니다 — 커밋된 것은 없습니다.",
        en: "The connection was lost, so the server rolled back the open transaction — nothing was committed."
    )
}

fn tx_ended_by_statement_note() -> String {
    tr!(
        ko: "이 문장이 트랜잭션을 스스로 끝냈습니다(프로시저 안의 COMMIT · ROLLBACK 또는 암묵 커밋) — 앞 문장들이 커밋됐는지 되돌려졌는지 앱은 알 수 없습니다.",
        en: "This statement ended the transaction by itself (COMMIT · ROLLBACK inside a procedure, or an implicit commit) — the app cannot tell whether the earlier statements were committed or rolled back."
    )
}

// ---------------------------------------------------------------------------
// 스크립트 실행(2단계) — 사람 타일의 입구(실행기는 `db::script`)
// ---------------------------------------------------------------------------

/// **스크립트를 돌린다**(2단계 — 규칙은 `db::script`). 모드는 이 타일의 지금 모양이 정한다: 작업이 열려 있으면 그 안(`InWork` — 커밋
/// 안 함), 쓰기 모드면 스크립트 자체가 트랜잭션 하나(`Write`), 읽기 전용이면 `READ ONLY` 트랜잭션 하나(`ReadOnly`). 실행 전 거절은
/// `Ok` + `outcome: "refused"`(화면이 그 문장을 짚는다 — 아무것도 실행하지 않았다).
///
/// 떼어 두기(F5 · 크래시 · GUI 종료)는 스크립트를 **끊지 않는다** — 서버 태스크가 끝까지 끝내거나 되돌리고, 떼어 둔 동안 끝났으면 요약을
/// 남겨 다시 붙는 화면에 한 번 건넨다(`Opened.last_script`). 타일 닫기 · 연결 닫기는 멈추고 되돌린다([`retire`]). 취소는 [`cancel`].
pub(crate) async fn script(
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    max_rows: usize,
    timeout_ms: u64,
    tx_expect: Option<u64>,
) -> Result<ScriptOut, String> {
    let e = lookup(handle, Some(lease))?;
    // 조정 장치 안에서 작업 id 를 검사하고, 모드(작업 안 · 자동 커밋 끔)도 든 뒤에 읽는다 — 끝날 때까지 다른 요청이 바꾸지 못한다.
    let cancelled = claim(&e, Work::Script, query_id, |e| match tx_expect {
        Some(id) => lock(&e.tx).expect(id).map_err(|r| r.message()),
        None => Ok(()),
    })?;
    let _clear = ClearRunning(&e, cancelled.clone());
    let in_work = lock(&e.tx).is_open();
    let auto_off = e.auto_off() && !in_work;
    let d = e.engine.dialect();
    let mut mode = if in_work || auto_off {
        ScriptMode::InWork
    } else if e.engine.writable() {
        ScriptMode::Write
    } else {
        ScriptMode::ReadOnly
    };
    let mut plan = match script::plan(&sql, d, mode) {
        Ok(p) => p,
        Err(pe) => {
            let mut out = script::refused(&pe);
            if let (true, script::PlanError::Statement { err, .. }, Some(f)) = (auto_off, &pe, out.failed.as_mut()) {
                f.message = auto_off_refusal(err);
            }
            out.tx = Some(e.tx_view());
            return Ok(out);
        }
    };
    // 자동 커밋 끔 · 작업 없음 — 조회만 든 스크립트는 작업을 열지 않고 `READ ONLY` 트랜잭션 하나로(단문과 같은 규칙 — [`query`]).
    let reads = auto_off.then(|| script::plan(&sql, d, ScriptMode::ReadOnly).ok()).flatten();
    if let Some(p) = &reads {
        mode = ScriptMode::ReadOnly;
        plan = p.clone();
    }
    let mut opened_now = false;
    if auto_off && reads.is_none() {
        begin_work(&e).await?;
        opened_now = true;
    }
    if mode == ScriptMode::InWork {
        lock(&e.tx).touch(Instant::now());
    }
    let mut ctl = Arc::new(script::Ctl::new(cancelled.clone(), timeout_ms, script::SCRIPT_TIMEOUT));
    let started = Instant::now();
    let mut run = script::execute(e.engine.clone(), plan.clone(), mode, max_rows, Arc::clone(&ctl))
        .await
        .map_err(|err| message(err, false, false, timeout_ms))?;
    let refused_read = reads.is_some() && matches!(run.failed, Some(EngineError::ReadOnlyRefused(_))) && !cancelled.load(Ordering::SeqCst);
    // 조회만 든 줄 알았는데 PG · MySQL 엔진이 실행 중에 읽기 전용으로 거절했다 — 다시 돌지 않는다(앞 문장의 부작용이 두 번 나지 않게 —
    // Codex 검토 반영 1). 그 문장의 실패 문구에 안내를 단다.
    if refused_read && d != Dialect::Sqlite {
        if let Some(EngineError::ReadOnlyRefused(m)) = run.failed.take() {
            run.failed = Some(EngineError::Message(needs_work_text(&m)));
        }
    }
    // SQLite — 실행 전 판정이라 그 문장은 돌지 않았다. 그래도 앞 문장들은 돌았다(조회뿐 — `readonly()` 를 지난 것) — 작업을 열고 다시.
    if refused_read && d == Dialect::Sqlite {
        plan = script::plan(&sql, d, ScriptMode::InWork).map_err(|pe| pe.message())?;
        mode = ScriptMode::InWork;
        begin_work(&e).await?;
        opened_now = true;
        lock(&e.tx).touch(Instant::now());
        ctl = Arc::new(script::Ctl::new(cancelled, timeout_ms, script::SCRIPT_TIMEOUT));
        run = script::execute(e.engine.clone(), plan.clone(), mode, max_rows, Arc::clone(&ctl))
            .await
            .map_err(|err| message(err, false, false, timeout_ms))?;
    }
    let mut work_closed = false;
    if mode == ScriptMode::InWork {
        after_tx_script(&e, &run);
        if opened_now && run.end != script::End::WorkKept {
            let closed = drop_empty_work(&e).await;
            work_closed = closed && run.end == script::End::WorkRunUndone;
        }
        wake_reaper();
    }
    let mut out = script::report(&plan, run, mode, &ctl, timeout_ms, started.elapsed().as_millis() as u64);
    if work_closed {
        // 저절로 연 작업의 첫 실행이 실패해 그 작업까지 닫았다 — "이번 실행만 되돌림 · 작업 유지" 가 아니라 전부 되돌림(바뀐 것 없음 ·
        // 작업은 열리지 않음). 판 15 GUI 도 아는 `rolledBack` 으로 싣고 `workClosed` 로 가른다. 남은 행 잠금 안내는 뺀다(잠금도 풀렸다).
        out.outcome = "rolledBack";
        out.work_closed = true;
        out.message = without_lock_note(out.message.as_deref());
    }
    out.tx = Some(e.tx_view());
    out.needs_work = refused_read && d != Dialect::Sqlite;
    // 떼어 둔 동안 끝났다 — 받을 화면이 없으니 요약을 남긴다(다시 붙는 화면에 한 번 · 결과 행은 버린다).
    *lock(&e.script_note) = e.detached_at().is_some().then(|| script::summary(out.clone()));
    Ok(out)
}

/// 작업 안 스크립트가 끝났다 — 작업에 남은 문장을 세고(활동 — 세이브포인트로 되돌린 실행분은 세지 않는다) 엔진의 진실로 작업 칸을
/// 맞춘다([`after_tx_statement`] 와 같은 규칙).
fn after_tx_script(e: &Entry, run: &script::EngineRun) {
    let now = Instant::now();
    let mut s = lock(&e.tx);
    if !s.is_open() {
        return;
    }
    if run.end == script::End::WorkKept {
        for _ in &run.done {
            s.statement_done(true, now);
        }
    }
    s.touch(now);
    if e.engine.in_tx() {
        return;
    }
    let (outcome, note) = match &run.end {
        _ if e.engine.is_dead() => (tx::Outcome::Disconnected, tx_disconnected_note()),
        script::End::WorkUnknown(m) => (tx::Outcome::Unknown, m.clone()),
        script::End::WorkEnded => (
            tx::Outcome::ErrorRolledBack,
            run.note
                .as_ref()
                .map_or_else(|| tx_error_note(e.engine.dialect()), |n| format!("{n}\n{}", tx_error_note(e.engine.dialect()))),
        ),
        _ if run.failed.is_some() => (tx::Outcome::ErrorRolledBack, tx_error_note(e.engine.dialect())),
        _ => (tx::Outcome::Unknown, tx_ended_by_statement_note()),
    };
    s.finish(outcome, Some(note));
}

// ---------------------------------------------------------------------------
// 트랜잭션 작업(1단계) — 열기 · 끝내기 · 연장 · 상태
// ---------------------------------------------------------------------------

/// 끝내기 한 번의 시한 — 넘으면 결과 불명(끊지 않는다 — `COMMIT` 을 끊는 것은 결과를 더 모르게 할 뿐이다).
const TX_END_TIMEOUT: Duration = Duration::from_secs(120);

/// 왜 끝내나.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EndBy {
    Commit,
    Rollback,
    /// 방치 상한 — 서버의 시계가 되돌린다.
    Idle,
}

/// 트랜잭션 작업을 연다 — 쓰기 모드여야 한다.
pub(crate) async fn tx_begin(handle: u64, lease: u64) -> Result<tx::TxView, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Begin, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    begin_work(&e).await?;
    Ok(e.tx_view())
}

/// 작업 열기의 몸 — [`tx_begin`](사람의 [트랜잭션 작업 시작]) · 자동 커밋을 끈 타일의 저절로 열기([`query`] · [`script`]). 부르는 쪽이
/// 늘 조정 장치에 들어 있다([`claim`]).
async fn begin_work(e: &Entry) -> Result<(), String> {
    if !e.engine.writable() {
        return Err(tx::Refusal::ReadOnly.message());
    }
    if lock(&e.tx).open_id().is_some() {
        return Err(tx::Refusal::AlreadyOpen.message());
    }
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.tx_begin()),
        Engine::Pg(p) => tokio::spawn(async move { p.tx_begin().await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.tx_begin().await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))?;
    lock(&e.tx).begin(tx::next_id(), Instant::now()).map_err(|r| r.message())?;
    *lock(&e.idle_retry_at) = None;
    wake_reaper();
    Ok(())
}

/// 사람의 [커밋] · [되돌리기] — `id` 는 화면이 아는 작업(다르면 `[db-tx-stale]`). **실행이 돌고 있으면 바쁨으로 거절**한다(Codex
/// 검토 반영 2 — 기다리지 않는다: 사람이 결과를 보지 못한 실행 뒤에 커밋이 줄 서면 무엇을 커밋하는지 모르게 된다. 화면도 실행 중에는
/// 단추를 막는다).
pub(crate) async fn tx_end(handle: u64, lease: u64, id: u64, commit: bool) -> Result<tx::TxView, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::End, String::new(), |e| lock(&e.tx).start_ending(id).map_err(|r| r.message()))?;
    let _clear = ClearRunning(&e, flag);
    end_engine(&e, if commit { EndBy::Commit } else { EndBy::Rollback }).await?;
    Ok(e.tx_view())
}

/// [연장] — 방치 시계를 새로 잰다(명시적 연장 — 10-13 결정).
pub(crate) fn tx_extend(handle: u64, lease: u64, id: u64) -> Result<tx::TxView, String> {
    let e = lookup(handle, Some(lease))?;
    e.reconcile_tx();
    {
        let mut s = lock(&e.tx);
        s.expect(id).map_err(|r| r.message())?;
        s.touch(Instant::now());
    }
    wake_reaper();
    Ok(e.tx_view())
}

/// 지금 상태 — 시계를 늘리지 않는다.
pub(crate) fn tx_state(handle: u64, lease: u64) -> Result<tx::TxView, String> {
    Ok(lookup(handle, Some(lease))?.tx_view())
}

/// 끝내기의 엔진 몫 — 칸은 이미 `ending` 이다(`start_ending`). 결과를 칸에 적는다. 엔진이 받지 못했으면(바쁨 · 거절했는데
/// 작업이 남음) 칸을 열림으로 되돌리고 오류를 돌려준다.
async fn end_engine(e: &Entry, by: EndBy) -> Result<(), String> {
    let commit = by == EndBy::Commit;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.tx_end(commit)),
        Engine::Pg(p) => tokio::spawn(async move { p.tx_end(commit).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.tx_end(commit).await }),
    };
    let r = match tokio::time::timeout(TX_END_TIMEOUT, task).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err(TxEndError::Lost(task_failed())),
        Err(_) => Err(TxEndError::Lost(tr!(
            ko: "서버가 {secs}초 안에 답하지 않았습니다",
            en: "The server did not answer within {secs} s",
            secs = TX_END_TIMEOUT.as_secs()
        ))),
    };
    let mut s = lock(&e.tx);
    match r {
        Ok(note) => {
            let outcome = match by {
                EndBy::Commit => tx::Outcome::Committed,
                EndBy::Rollback => tx::Outcome::RolledBack,
                EndBy::Idle => tx::Outcome::IdleRolledBack,
            };
            s.finish(outcome, note);
            Ok(())
        }
        Err(TxEndError::Unverified(m)) => {
            // 서버는 끝냈다고 답했는데 트랜잭션이 남았다 — 엔진이 연결을 버렸다(Codex 검토 반영 1). 결과 불명.
            s.finish(tx::Outcome::Unknown, Some(m));
            Ok(())
        }
        Err(TxEndError::Busy) => {
            s.cancel_ending();
            Err(EngineError::busy_message())
        }
        Err(TxEndError::Failed(m)) if e.engine.in_tx() => {
            s.cancel_ending();
            Err(m)
        }
        Err(TxEndError::Failed(m)) => {
            // 서버가 거절하며 되돌렸다(커밋의 직렬화 실패 · 미뤄 둔 제약 — 되돌리기라면 어차피 끝났다).
            let outcome = if commit { tx::Outcome::ErrorRolledBack } else { tx::Outcome::RolledBack };
            s.finish(outcome, Some(m));
            Ok(())
        }
        Err(TxEndError::Lost(m)) => {
            // 커밋을 보냈는데 답을 못 받았다 — 결과 불명(다시 보내지 않는다). 되돌리기였다면 끊김이 곧 되돌림이다.
            let outcome = if commit { tx::Outcome::Unknown } else { tx::Outcome::Disconnected };
            let note = if commit {
                tr!(
                    ko: "커밋을 보낸 뒤 답을 받기 전에 연결이 끊겼습니다 — 커밋됐는지 앱은 알 수 없습니다. 다시 연결해 데이터를 확인하세요({m})",
                    en: "The connection was lost after sending COMMIT and before the answer — the app cannot tell whether it was committed. Reconnect and check the data ({m})"
                )
            } else {
                tx_disconnected_note()
            };
            s.finish(outcome, Some(note));
            Ok(())
        }
    }
}

/// 방치 되돌리기가 엔진에 닿지 못했을 때(바쁨 등) 다시 가기까지의 틈.
const IDLE_RETRY: Duration = Duration::from_millis(1500);
/// 시험이 짧게 바꾸는 자리(ms) — 0 이면 [`IDLE_RETRY`].
static IDLE_RETRY_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn idle_retry() -> Duration {
    match IDLE_RETRY_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => IDLE_RETRY,
        ms => Duration::from_millis(ms),
    }
}

/// 시험 전용 — 방치 되돌리기 재시도 틈을 바꾼다(`None` = 원래대로).
#[cfg(test)]
pub(crate) fn set_idle_retry_for_test(d: Option<Duration>) {
    IDLE_RETRY_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
}

/// 방치 상한 — 서버의 시계가 되돌린다(칸은 이미 `ending` · 조정 장치에도 들어 있다 — [`tx_tick`] 이 동기로 걸었다). 끝나면 이벤트로 알린다.
/// 엔진에 닿지 못했으면(바쁨 — 조정 장치 밖의 엔진 잠금 · 거절했는데 작업이 남음) [`idle_retry`] 뒤 다시 간다(Codex 검토 반영 2 — 전에는
/// 다른 활동이 없으면 만료된 작업이 그대로 남을 수 있었다).
async fn idle_rollback(e: Arc<Entry>, flag: Arc<AtomicBool>) {
    let _clear = ClearRunning(&e, flag);
    let r = end_engine(&e, EndBy::Idle).await;
    if r.is_err() {
        let first = lock(&e.idle_retry_at).replace(Instant::now() + idle_retry()).is_none();
        let retry = idle_retry();
        tokio::spawn(async move {
            tokio::time::sleep(retry).await;
            wake_reaper();
        });
        if !first {
            // 같은 작업의 거듭된 실패는 한 줄만 남긴다(로그가 재시도마다 늘지 않게).
            return;
        }
    } else {
        *lock(&e.idle_retry_at) = None;
    }
    // 실제 결과를 적는다 — 되돌리기를 보내다 연결이 끊긴 것(`disconnected`)을 "rolled back" 이라 적지 않는다.
    let outcome = lock(&e.tx).view(Instant::now()).ended.map(|x| x.outcome);
    crate::server::log::line(format!(
        "db: idle transaction limit on handle {} → {}",
        e.handle,
        match (&r, outcome) {
            (Err(_), _) => "rollback failed (still open)",
            (Ok(()), Some(tx::Outcome::IdleRolledBack)) => "rolled back",
            (Ok(()), Some(tx::Outcome::Disconnected)) => "connection lost (the server rolls it back)",
            (Ok(()), _) => "ended",
        }
    ));
    emit_tx(&e);
}

/// 작업 상태 이벤트 — `db-state {stream, state: "tx", tx}`(경고 · 방치 되돌림 — 서버가 스스로 바꾼 것만).
fn emit_tx(e: &Entry) {
    crate::server::hub::emit(
        super::EVT_STATE,
        serde_json::json!({ "stream": e.stream, "state": "tx", "tx": e.tx_view() }),
    );
}

/// 그 쿼리 id 가 지금 돌면 끊는다 — 끊었으면 `true`.
pub(crate) fn cancel(handle: u64, query_id: &str) -> Result<bool, String> {
    let e = lookup(handle, None)?;
    let r = lock(&e.running);
    match r.as_ref() {
        Some(run) if matches!(run.work, Work::Query | Work::Script) && run.query_id == query_id => {
            run.cancelled.store(true, Ordering::SeqCst);
            e.engine.interrupt();
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// 스키마 목록.
pub(crate) async fn schema(handle: u64, lease: u64) -> Result<Value, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Meta, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.schema()),
        Engine::Pg(p) => tokio::spawn(async move { p.schema(ms).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.schema(ms).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))
}

/// 스키마 하나의 객체(트리에서 스키마를 펼칠 때).
pub(crate) async fn objects(handle: u64, lease: u64, schema: Option<String>) -> Result<Value, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Meta, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.objects(schema.as_deref())),
        Engine::Pg(p) => tokio::spawn(async move { p.objects(schema.as_deref(), ms).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.objects(schema.as_deref(), ms).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))
}

/// 테이블(· 뷰) 하나의 구조 — 컬럼 · 인덱스 · 제약 조건 · 외래 키 · 참조됨 · 트리거 · 파티션(트리에서 테이블을 펼칠 때 한 번).
pub(crate) async fn table_detail(handle: u64, lease: u64, schema: Option<String>, table: String) -> Result<Value, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Meta, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.table_detail(schema.as_deref(), &table)),
        Engine::Pg(p) => tokio::spawn(async move { p.table_detail(schema.as_deref(), &table, ms).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.table_detail(schema.as_deref(), &table, ms).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))
}

/// 객체 하나의 정의(DDL) — 트리 잎의 "DDL 보기"(`{sql, reconstructed, truncated}` — 꼴은 `db::definition`).
pub(crate) async fn definition(handle: u64, lease: u64, target: super::definition::DefTarget) -> Result<Value, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Meta, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.definition(&target)),
        Engine::Pg(p) => tokio::spawn(async move { p.definition(&target, ms).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.definition(&target, ms).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))
}

/// 쓰기를 켜고 끈다 — 지금 모양을 돌려준다. 끌 때 열린 트랜잭션 작업이 있으면 **먼저 되돌린다**(화면은 확인 대화를 먼저 받는다 —
/// 끄기는 늘 안전한 쪽이라는 `write-toggle` 규칙).
pub(crate) async fn set_write(handle: u64, lease: u64, on: bool) -> Result<bool, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Mode, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    if !on {
        let open = lock(&e.tx).open_id();
        if let Some(id) = open {
            lock(&e.tx).start_ending(id).map_err(|r| r.message())?;
            end_engine(&e, EndBy::Rollback).await?;
        }
    }
    let ms = super::META_TIMEOUT_MS;
    let task = match e.engine.clone() {
        Engine::Sqlite(s) => tokio::task::spawn_blocking(move || s.set_write(on)),
        Engine::Pg(p) => tokio::spawn(async move { p.set_write(on).await }),
        Engine::Mysql(m) => tokio::spawn(async move { m.set_write(on).await }),
    };
    let (r, timed_out) = run_timed(&e.engine, Duration::from_millis(ms), task, None).await;
    r.map_err(|err| message(err, timed_out, false, ms))?;
    if !e.engine.writable() {
        // 쓰기를 끄면 자동 커밋 토글도 사라진다 — 다시 켜면 기본(켬)이다.
        e.auto_commit.store(true, Ordering::SeqCst);
    }
    Ok(e.engine.writable())
}

/// 자동 커밋 토글의 지금 값(쓰기 모드가 아니면 늘 참).
pub(crate) fn auto_commit(handle: u64, lease: u64) -> Result<bool, String> {
    Ok(!lookup(handle, Some(lease))?.auto_off())
}

/// 자동 커밋 토글(10-14 결정 — 쓰기 모드 띠) — 지금 값을 돌려준다. 끄기는 쓰기 모드에서만 · 작업이 열려 있으면 바꾸지 않는다(켜는 순간
/// 열린 작업을 커밋하는 JDBC 식 뜻과 헷갈리지 않게 — [커밋] · [되돌리기] 로 먼저 끝낸다).
pub(crate) fn set_auto_commit(handle: u64, lease: u64, on: bool) -> Result<bool, String> {
    let e = lookup(handle, Some(lease))?;
    // 조정 장치 안에서 검증하고 바꾼다 — 도는 실행이 길(자동 커밋 · 작업)을 고른 뒤 토글이 바뀌는 일이 없게(Codex 검토 반영 2).
    let flag = claim(&e, Work::Mode, String::new(), |e| {
        if !on && !e.engine.writable() {
            return Err(tx::Refusal::ReadOnly.message());
        }
        if on != e.auto_commit.load(Ordering::SeqCst) && lock(&e.tx).open_id().is_some() {
            return Err(tx::Refusal::AlreadyOpen.message());
        }
        e.auto_commit.store(on, Ordering::SeqCst);
        Ok(())
    })?;
    let _clear = ClearRunning(&e, flag);
    Ok(!e.auto_off())
}

/// 닫는다 — 임대를 주면 본다. 이미 없으면 `false`(멱등).
pub(crate) fn close(handle: u64, lease: Option<u64>) -> Result<bool, String> {
    let mut t = lock(&TABLE);
    let Some(e) = t.by_handle.get(&handle).cloned() else {
        return Ok(false);
    };
    if lease.is_some_and(|l| e.lease.load(Ordering::SeqCst) != l) {
        return Err(stale());
    }
    retire(&mut t, &e);
    net::drop_parked(&e.stream);
    Ok(true)
}

// ---------------------------------------------------------------------------
// 수명(9단계) — 떼어 두기 · TTL · 창 파괴 · 모두 닫기
// ---------------------------------------------------------------------------

/// 서버 연결이 섰다(`serve_conn` 첫머리).
pub(crate) fn conn_opened(conn: u64) {
    lock(&TABLE).conns.insert(conn);
}

/// 떼어 둔다 — `pick` 이 고른 것만. 떼어 둔 수(이미 떼어 둔 것은 세지 않는다).
fn detach_where(t: &Table, pick: impl Fn(&Entry) -> bool) -> usize {
    let now = Instant::now();
    let n = t.by_handle.values().filter(|e| pick(e)).filter(|e| e.detach(now)).count();
    if n > 0 {
        wake_reaper();
    }
    n
}

/// 닫는다 — `pick` 이 고른 것만(떼어 둔 것까지). 닫은 stream 들.
fn close_where(pick: impl Fn(&Entry) -> bool) -> Vec<String> {
    let mut t = lock(&TABLE);
    let doomed: Vec<Arc<Entry>> = t.by_handle.values().filter(|e| pick(e)).cloned().collect();
    for e in &doomed {
        retire(&mut t, e);
    }
    drop(t);
    let streams: Vec<String> = doomed.iter().map(|e| e.stream.clone()).collect();
    for s in &streams {
        net::drop_parked(s);
    }
    streams
}

/// 서버 연결이 끊겼다(GUI 종료·kill·quitAll 뒤) — 그 연결이 쥔 DB 연결을 떼어 둔다. 떼어 둔 수.
pub(crate) fn conn_gone(conn: u64) -> usize {
    let mut t = lock(&TABLE);
    t.conns.remove(&conn);
    detach_where(&t, |e| lock(&e.holder).conn == conn)
}

/// 페이지 리로드·웹뷰 크래시 — 그 창이 쥔 DB 연결을 떼어 둔다(`skip` = 이관 중인 stream). 떼어 둔 수.
pub(crate) fn detach_window(window: &str, skip: &HashSet<String>) -> usize {
    let t = lock(&TABLE);
    detach_where(&t, |e| !skip.contains(&e.stream) && lock(&e.holder).window == window)
}

/// 창 파괴(보조 창 닫기) — 그 창이 쥔 DB 연결을 닫는다(떼어 둔 것까지 · `held` = 이관 중인 stream 은 뺀다). 닫은 수.
pub(crate) fn close_window(window: &str, held: &HashSet<String>) -> usize {
    close_where(|e| !held.contains(&e.stream) && lock(&e.holder).window == window).len()
}

/// 이관 — 받는 창이 짐을 꺼냈다: 그 stream 들의 쥔 창을 옮긴다(보낸 창의 `close_window` 가 거두지 않게).
pub(crate) fn set_home(streams: &[String], window: &str) {
    let t = lock(&TABLE);
    for s in streams {
        if let Some(e) = t.by_stream.get(s) {
            lock(&e.holder).window = window.to_string();
        }
    }
}

/// 모두 닫는다 — 트레이 [모든 세션 종료](`close_all`) · 서버 끝. 비밀번호를 묻는 동안 세워 둔 전송로도 놓는다. 닫은 수.
pub(crate) fn close_all() -> usize {
    let n = close_where(|_| true).len();
    net::drop_all_parked();
    n
}

/// 지금 표에 있는 DB 연결 수(붙었거나 떼어 둔) — `status` 의 진단 칸.
pub(crate) fn live_count() -> usize {
    lock(&TABLE).by_handle.len()
}

/// TTL 이 지난 떼어 둔 연결을 거둔다 — 거둔 stream 들과 다음 마감(없으면 `None`).
fn expire(now: Instant) -> (Vec<String>, Option<Instant>) {
    let ttl = ttl();
    let next = lock(&TABLE)
        .by_handle
        .values()
        .filter_map(|e| e.detached_at().map(|at| at + ttl))
        .filter(|&due| due > now)
        .min();
    let gone = close_where(|e| e.detached_at().is_some_and(|at| at + ttl <= now));
    (gone, next)
}

/// **방치 시계**(트랜잭션 작업 — 10-13 결정) 한 바퀴 — 경고할 때가 된 작업은 이벤트를, 상한을 넘은 작업은 되돌리기를 띄운다(칸을
/// 여기서 동기로 `ending` 으로 걸어 두 번 띄우지 않는다). 문장이 도는 작업은 건너뛴다(끝나면 활동으로 다시 재고 시계를 깨운다).
/// 다음 할 일의 시각을 돌려준다.
fn tx_tick(now: Instant) -> Option<Instant> {
    let (limit, warn) = tx::clock();
    let entries: Vec<Arc<Entry>> = lock(&TABLE).by_handle.values().cloned().collect();
    let mut next: Option<Instant> = None;
    for e in entries {
        // 끊긴 연결의 작업은 방치 시계가 되돌리러 가지 않는다 — 여기서 '끊김' 으로 옮겨진다(PG `in_tx` 는 죽은 연결을 거짓으로 본다).
        if e.reconcile_tx() == Some(tx::Outcome::Disconnected) {
            crate::server::log::line(format!("db: open transaction on handle {} ended by a lost connection", e.handle));
        }
        loop {
            let due = lock(&e.tx).next_due(limit, warn);
            let Some((at, what)) = due else { break };
            if at > now {
                next = Some(next.map_or(at, |n| n.min(at)));
                break;
            }
            match what {
                tx::Due::Warn => {
                    lock(&e.tx).mark_warned();
                    emit_tx(&e);
                }
                tx::Due::Expire => {
                    // 지난번 되돌리기가 엔진에 닿지 못했다 — 재시도 시각까지 기다린다(헛돌지 않게).
                    let retry_at = *lock(&e.idle_retry_at);
                    if let Some(r) = retry_at.filter(|&r| r > now) {
                        next = Some(next.map_or(r, |n| n.min(r)));
                        break;
                    }
                    // 조정 장치에 든다 — 다른 일(문장 · 메타 조회 · 끝내기 …)이 돌면 미루고(그 일이 끝나며 시계를 깨운다 — [`ClearRunning`])
                    // 혹시 몰라 재시도 틈 뒤에도 다시 본다.
                    match claim(&e, Work::Idle, String::new(), |e| {
                        let mut s = lock(&e.tx);
                        match s.open_id() {
                            Some(id) => s.start_ending(id).map_err(|r| r.message()),
                            None => Err(String::new()),
                        }
                    }) {
                        Ok(flag) => {
                            tokio::spawn(idle_rollback(Arc::clone(&e), flag));
                        }
                        Err(_) => {
                            let r = now + idle_retry();
                            next = Some(next.map_or(r, |n| n.min(r)));
                        }
                    }
                    break;
                }
            }
        }
    }
    next
}

/// 시험 전용 — 방치 시계를 바꾸고(`None` = 원래대로) 시계를 깨운다.
#[cfg(test)]
pub(crate) fn set_tx_clock_for_test(c: Option<(Duration, Duration)>) {
    tx::set_clock_for_test(c);
    REAPER_WAKE.notify_one();
}

/// 시험 전용 — 그 핸들의 엔진(가드 밖 시험 준비 · 엔진 겹 혼자의 판정을 재는 자리).
#[cfg(test)]
pub(crate) fn engine_for_test(handle: u64) -> Engine {
    lookup(handle, None).expect("핸들").engine.clone()
}

static REAPER_WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
static REAPER_RUNNING: AtomicBool = AtomicBool::new(false);

/// 시계를 깨운다 — 없으면(처음 · 시험 런타임이 바뀌었다) 지금 런타임에 띄운다.
fn wake_reaper() {
    if !REAPER_RUNNING.swap(true, Ordering::SeqCst) {
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(reaper());
            }
            Err(_) => REAPER_RUNNING.store(false, Ordering::SeqCst),
        }
    }
    REAPER_WAKE.notify_one();
}

/// 런타임이 내려가 태스크가 떨어지면 다음 [`wake_reaper`] 가 다시 띄우게 표시를 내린다.
struct ReaperFlag;

impl Drop for ReaperFlag {
    fn drop(&mut self) {
        REAPER_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// **TTL 시계** — 표 하나에 태스크 하나. 가장 이른 마감까지 자고(떼어 둘 때마다 깨어 다시 잰다), 지난 것을 닫는다.
async fn reaper() {
    let _flag = ReaperFlag;
    loop {
        let now = Instant::now();
        let (gone, next) = expire(now);
        let next = match (next, tx_tick(now)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        if !gone.is_empty() {
            crate::server::log::line(format!(
                "db: closed {} detached connection(s) after the {} s grace",
                gone.len(),
                ttl().as_secs()
            ));
        }
        match next {
            Some(at) => {
                tokio::select! {
                    _ = tokio::time::sleep_until(at.into()) => {}
                    _ = REAPER_WAKE.notified() => {}
                }
            }
            None => REAPER_WAKE.notified().await,
        }
    }
}
