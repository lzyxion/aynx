//! **DB 연결 표** — 세션 서버 프로세스에 한 벌. 열쇠는 타일의 `stream`(프런트 tileKey 글자).
//! **세션 코어(`session_core`)에 오르지 않는다** — MCP `list_sessions` 에 섞이면 안 된다(서버 통합 시험이 지킨다). 임대 규칙만 같은 꼴(`[stale-lease]`)로 따로 둔다.
//!
//! ## 규칙
//!
//! - 핸들을 받는 호출은 지금 임대 회차와 같아야 한다 — 옛 임대면 `[stale-lease]`, 없는 핸들은 `[session-gone]`. `db_cancel` 은 임대를 보지 않는다.
//! - [연결 테스트](`db_test` — [`test`])는 이 표에 오르지 않는다. 볼트 비밀번호는 저장된 줄과 대상이 같을 때만([`test_vault_allowed`]).
//! - **빌린 비밀번호**(`db::borrowed`)를 담는 곳은 [`open`] 하나 — 인증에 쓴 바로 그 값이고 [연결 테스트] · 재부착 · SQLite 는 담지 않는다. 그 연결 id 의
//!   마지막 항목이 표에서 빠질 때([`retire`])만 지운다 — 볼트 잠금 · 가림막 · 창 0개와는 무관하다(→ docs/invariants.md 전문 8).
//! - 쿼리는 연결 하나에 한 번에 하나(줄 세우지 않는다). 실행 · 작업 시작 · [커밋] · 모드 바꾸기 · 메타 조회 · 방치 되돌리기가 모두 [`claim`] 하나를
//!   지나고 작업 id · 모드 검증도 그 안에서 한다 — 검증과 엔진 진입 사이에 다른 요청이 끼지 않게.
//!
//! ## 수명 — session_core 를 흉내 내되 그 밖에 산다
//!
//! - 리로드 · 웹뷰 크래시는 떼어 둠 → [`DETACH_TTL`] 뒤 닫음. 창이 사라지면(GUI 종료 · 연결 끊김 · 마지막 창 X) 떨어진 세션으로 남긴다(TTL 없음) —
//!   열린 트랜잭션만 떨어진 지 TTL 이면 되돌린다(연결은 남는다 · DB 잠금을 무기한 쥐지 않게).
//! - 떼어 두기는 작업 안 문장 · 스크립트를 끊지 않는다 — 끊으면 그 실행분이 되돌려진다.
//! - 응답 대기를 멈춘 실행은 결과 미확인(`EngineError::Unconfirmed`)이고 그 연결은 버린다 — "이번 실행만 되돌림" 이라 하지 않는다.
//! - 서버 고아 자진 종료(`serve::Busy`)는 떨어진 세션으로 남은 DB 연결을 세션으로 센다([`kept_count`]).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::borrowed;
use super::mysql::{self, Mysql};
use crate::delegation::database::DbIdentity;
use super::net::{self, NetTarget, OpenError, OpenSecrets};
use super::pg::{self, Pg};
use super::sqlite::Sqlite;
use super::script::{self, ScriptMode, ScriptOut};
use super::{conns, guard, tx, Dialect, EngineError, QueryOut, RunEnd, TxEndError};
use crate::errors::{with_reason, CANCELLED, DB_CARRY, DB_NEEDS_WORK, DB_UNCONFIRMED, SESSION_GONE, STALE_LEASE};
use crate::i18n::tr;
use super::conns::DbEngine;

const STREAM_MAX: usize = 256;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 값(주소 · 경로)이 아니라 `db-connections.json` 의 id 다 — 서버가 파일에서 해석한다.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) struct ConnRef {
    pub id: String,
}

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

    pub(super) fn is_dead(&self) -> bool {
        match self {
            Engine::Sqlite(_) => false,
            Engine::Pg(p) => p.is_dead(),
            Engine::Mysql(m) => m.is_dead(),
        }
    }

    fn in_tx(&self) -> bool {
        match self {
            Engine::Sqlite(s) => s.in_tx(),
            Engine::Pg(p) => p.in_tx(),
            Engine::Mysql(m) => m.in_tx(),
        }
    }

    /// 결과를 확인하지 못한 실행이 남은 연결을 버린다 — 다음 일에 다시 쓰지 않는다.
    pub(crate) fn abandon(&self) {
        match self {
            Engine::Sqlite(s) => s.abandon(),
            Engine::Pg(p) => p.abandon(),
            Engine::Mysql(m) => m.abandon(),
        }
    }

    fn take_run_end(&self) -> Option<RunEnd> {
        match self {
            Engine::Sqlite(s) => s.take_run_end(),
            Engine::Pg(p) => p.take_run_end(),
            Engine::Mysql(m) => m.take_run_end(),
        }
    }

    pub(super) fn shutdown(&self) {
        match self {
            Engine::Sqlite(s) => s.interrupt(),
            Engine::Pg(p) => p.shutdown(),
            Engine::Mysql(m) => m.shutdown(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Work {
    /// 문장 하나(`db_query`) — 떼어 두기가 끊는다(작업 밖일 때).
    Query,
    /// 스크립트(`db_script`) — 떼어 두기가 끊지 않는다(서버가 끝까지 끝내거나 되돌린다).
    Script,
    Meta,
    Begin,
    End,
    Mode,
    Idle,
}

struct Running {
    work: Work,
    query_id: String,
    cancelled: Arc<AtomicBool>,
}

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
    /// 조정 장치([`claim`]) — 돌고 있으면 바로 거절한다(줄 세우면 커밋이 사람이 결과를 못 본 실행 뒤에 선다).
    running: Mutex<Option<Running>>,
    idle_retry_at: Mutex<Option<Instant>>,
    detached: Mutex<Option<Detached>>,
    /// epoch ms
    opened_at_ms: u64,
    tx: Mutex<tx::Slot>,
    script_note: Mutex<Option<ScriptOut>>,
    /// 저장하지 않는다 — 재부착은 이 값 그대로(F5 뒤에 자동 커밋으로 몰래 돌아가지 않게 서버가 쥔다).
    auto_commit: AtomicBool,
}

impl Entry {
    fn auto_off(&self) -> bool {
        self.engine.writable() && !self.auto_commit.load(Ordering::SeqCst)
    }

    fn detached_at(&self) -> Option<Instant> {
        lock(&self.detached).map(|d| d.at)
    }

    fn reload_detached_at(&self) -> Option<Instant> {
        lock(&self.detached).filter(|d| d.how == How::Reload).map(|d| d.at)
    }

    fn kept_since(&self) -> Option<Instant> {
        lock(&self.detached).filter(|d| d.how != How::Reload).map(|d| d.at)
    }

    /// 이미 떼어 뒀으면 시각을 두고(TTL 이 늘지 않게) 모양은 올리기만 한다(다시 켠 GUI 의 리로드 거둠이 남은 것에 TTL 을 걸지 않게).
    /// 작업 안이면 도는 쿼리를 끊지 않는다 — 끊긴 실행은 되돌려진다. 바뀌었나를 돌려준다.
    fn detach(&self, now: Instant, how: How) -> bool {
        {
            let mut d = lock(&self.detached);
            if let Some(cur) = d.as_mut() {
                if cur.how == How::Reload && how != How::Reload {
                    cur.how = how;
                    return true;
                }
                if cur.how == How::Kept && how == How::Unclaimed {
                    cur.how = how;
                    return true;
                }
                return false;
            }
            *d = Some(Detached { at: now, at_ms: crate::session_core::now_ms(), how });
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

    fn tx_view(&self) -> tx::TxView {
        self.reconcile_tx();
        lock(&self.tx).view(Instant::now())
    }

    /// 떨어진 세션으로 남아 있었나를 돌려준다(목록이 바뀐다).
    fn reattach(&self) -> bool {
        lock(&self.detached).take().is_some_and(|d| d.how != How::Reload)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum How {
    /// 페이지 리로드 · 웹뷰 크래시 — 창은 살아 곧 다시 붙는다. [`DETACH_TTL`] 뒤 닫는다.
    Reload,
    /// 창이 사라졌다 — TTL 없이 남는다.
    Kept,
    /// [`How::Kept`] 인데 책임 창이 복원을 마치며 데려가지 않았다(`restore_done` — 세션 코어의 `unclaimed` 와 같은 뜻).
    Unclaimed,
}

#[derive(Debug, Clone, Copy)]
struct Detached {
    at: Instant,
    /// 같은 순간의 벽시계(epoch ms)
    at_ms: u64,
    how: How,
}

#[derive(Default)]
struct Table {
    by_stream: HashMap<String, Arc<Entry>>,
    by_handle: HashMap<u64, Arc<Entry>>,
    /// 끊긴 뒤에 끝난 열기 · 다시 붙기는 곧바로 떼어 둔다 — 아무도 `conn_gone` 을 다시 부르지 않는다.
    conns: HashSet<u64>,
}

pub(crate) const DETACH_TTL: Duration = Duration::from_secs(600);
static TTL_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn ttl() -> Duration {
    match TTL_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => DETACH_TTL,
        ms => Duration::from_millis(ms),
    }
}

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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opened {
    pub handle: u64,
    pub lease: u64,
    pub dialect: &'static str,
    pub server_version: String,
    pub writable: bool,
    pub reattached: bool,
    pub tx: tx::TxView,
    /// 판 10 — 화면이 [스크립트 실행] 을 세운다(판 9 서버는 이 칸이 없다).
    pub scripts: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_script: Option<ScriptOut>,
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
        // 지금 임대가 부른다 = 그 타일은 살아 있다(늦게 닿은 `detach_window` 가 떼어 놓았어도).
        if e.reattach() {
            crate::server::sessions::detached_changed();
        }
    }
    Ok(e)
}

fn stream_ok(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= STREAM_MAX && !s.chars().any(char::is_control)
}

fn retire(t: &mut Table, e: &Arc<Entry>) {
    t.by_handle.remove(&e.handle);
    if e.kept_since().is_some() {
        crate::server::sessions::detached_changed();
    }
    if t.by_stream.get(&e.stream).is_some_and(|x| Arc::ptr_eq(x, e)) {
        t.by_stream.remove(&e.stream);
    }
    if let Some(run) = lock(&e.running).as_ref() {
        run.cancelled.store(true, Ordering::SeqCst);
    }
    e.engine.shutdown();
    // 그 연결 id 의 마지막 사람 타일이었다 — 빌린 비밀번호를 지운다.
    if !t.by_handle.values().any(|x| x.target.id == e.target.id) {
        borrowed::last_tile_closed(&e.target.id);
    }
}

#[derive(Debug)]
pub(super) enum Resolved {
    Sqlite(String),
    Pg(NetTarget),
    /// MySQL · MariaDB(엔진 하나 — 갈래는 접속 뒤 서버 버전으로).
    Mysql(NetTarget),
}

/// 참조를 파일에서 해석한다 — GUI 가 보낸 주소를 믿지 않는다. 경유 호스트가 `~/.ssh/config` 에 없으면 거절한다(SSH 쪽은 모르는
/// 별칭을 호스트 이름으로 보고 붙으려 한다).
async fn resolve(target: &ConnRef) -> Result<(Resolved, DbIdentity), String> {
    let id = target.id.clone();
    tokio::task::spawn_blocking(move || {
        let d = conns::find(&id)?;
        let ident = DbIdentity::of(&d, None);
        let hosts = match d.via {
            Some(_) => crate::ssh_config::load_default()?.hosts,
            None => Vec::new(),
        };
        resolve_conn(d, |alias| hosts.iter().any(|h| conns::same_alias(&h.name, alias))).map(|r| (r, ident))
    })
    .await
    .map_err(|_| task_failed())?
}

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

/// 빌린 비밀번호의 재료 — 인증에 쓴 값과 그 줄의 신원(**`Debug` 없음**).
pub(super) type Borrow = (DbIdentity, zeroize::Zeroizing<String>);

/// 비밀번호 자리는 엔진에 넘기기 전에 정한다(`settle_password`) — 그래야 인증에 쓴 바로 그 값을 담는다.
async fn open_engine(
    stream: &str,
    target: &ConnRef,
    mut secrets: OpenSecrets,
    carried: Option<Borrow>,
) -> Result<(Engine, Option<Borrow>), OpenError> {
    let (resolved, ident) = resolve(target).await?;
    if !matches!(resolved, Resolved::Sqlite(_)) {
        seat_carried(&mut secrets, carried, &ident);
        secrets.settle_password(&target.id);
    }
    let used = secrets.password.clone();
    let borrow = |used: Option<zeroize::Zeroizing<String>>| used.map(|pw| (ident, pw));
    match resolved {
        Resolved::Sqlite(path) => {
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), false))
                .await
                .map_err(|_| task_failed())??;
            Ok((Engine::Sqlite(Arc::new(s)), None))
        }
        Resolved::Pg(t) => Ok((Engine::Pg(Arc::new(Pg::connect(stream, t, secrets).await?)), borrow(used))),
        Resolved::Mysql(t) => Ok((Engine::Mysql(Arc::new(Mysql::connect(stream, t, secrets).await?)), borrow(used))),
    }
}

/// 비밀번호 차례는 몸 → 끊긴 항목의 빌린 값(신원이 같을 때) → 볼트다. 빌린 값이 섰으면 볼트에 닿지 않는다(잠겨 있어도 묻지 않고
/// 붙는다 — `db::borrowed`).
pub(super) fn seat_carried(secrets: &mut OpenSecrets, carried: Option<Borrow>, ident: &DbIdentity) {
    if secrets.password.is_none() {
        secrets.password = carried.filter(|(i, _)| i.same(ident)).map(|(_, pw)| pw);
    }
}

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
    // 아래 재부착이 끊긴 항목을 거두며 빌린 값을 지우기 전에 잡아 둔다(값은 이 프로세스 밖으로 나가지 않는다).
    let carried = {
        let t = lock(&TABLE);
        t.by_stream
            .get(&stream)
            .filter(|e| e.target == target && e.engine.is_dead())
            .and_then(|_| borrowed::carry(&target.id))
    };
    if let Some(e) = reattach(&stream, &target, &window, conn) {
        return Ok(e);
    }
    let (engine, borrow) = open_engine(&stream, &target, secrets, carried).await?;
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
        opened_at_ms: crate::session_core::now_ms(),
        tx: Mutex::new(tx::Slot::default()),
        script_note: Mutex::new(None),
        auto_commit: AtomicBool::new(true),
    });
    // 여는 사이 그 서버 연결이 끊겼다 — 받을 화면이 없으니 곧바로 떨어진 세션으로 남긴다.
    if !t.conns.contains(&conn) && entry.detach(Instant::now(), How::Kept) {
        wake_reaper();
        crate::server::sessions::detached_changed();
    }
    t.by_stream.insert(stream, entry.clone());
    t.by_handle.insert(entry.handle, entry.clone());
    borrowed::tile_opened(&entry.target.id);
    // 그 연결의 사람 타일이 붙어 있는 동안 AI 연결이 빌려 쓴다("볼트에 저장" 체크 · 볼트 잠금과 무관).
    if let Some((ident, pw)) = borrow {
        borrowed::remember(&entry.target.id, ident, pw);
    }
    Ok(opened(&entry, false))
}

/// 다시 붙기만 한다 — 없거나 참조가 다르거나 끊겼으면 `[session-gone]`(새로 열지 않는다). 끊긴 같은 참조의 항목이 빌린 비밀번호를
/// 쥐고 있으면 `[db-carry]` 를 덧단다.
pub(crate) fn reattach_only(stream: &str, window: &str, conn: u64, target: &ConnRef) -> Result<Opened, String> {
    if !stream_ok(stream) {
        return Err(gone());
    }
    reattach_with(stream, target, window, conn, true).ok_or_else(|| {
        let carry = lock(&TABLE)
            .by_stream
            .get(stream)
            .is_some_and(|e| e.target == *target && e.engine.is_dead() && borrowed::can_carry(&target.id));
        gone_after_reattach(carry)
    })
}

/// 표지는 값이 아니라 있다는 것뿐이다 — 프런트(`query/open-flow`)는 이 표지면 볼트 잠금 해제 관문 앞에서 한 번 열어 본다.
pub(super) fn gone_after_reattach(carry: bool) -> String {
    if carry {
        with_reason(DB_CARRY, gone())
    } else {
        gone()
    }
}

/// `keep_dead` 면 끊긴 같은 참조의 항목을 표에 둔다 — 뒤따르는 [`open`] 이 그 항목의 빌린 비밀번호로 다시 붙는다.
fn reattach_with(stream: &str, target: &ConnRef, window: &str, conn: u64, keep_dead: bool) -> Option<Opened> {
    let mut t = lock(&TABLE);
    let e = t.by_stream.get(stream).cloned()?;
    if e.target != *target || e.engine.is_dead() {
        if !(keep_dead && e.target == *target) {
            retire(&mut t, &e);
        }
        return None;
    }
    e.lease.fetch_add(1, Ordering::SeqCst);
    *lock(&e.holder) = Holder {
        window: window.to_string(),
        conn,
    };
    let listed = if t.conns.contains(&conn) {
        e.reattach()
    } else {
        if e.detach(Instant::now(), How::Kept) {
            wake_reaper();
        }
        true
    };
    drop(t);
    if listed {
        crate::server::sessions::detached_changed();
    }
    Some(opened(&e, true))
}

fn reattach(stream: &str, target: &ConnRef, window: &str, conn: u64) -> Option<Opened> {
    reattach_with(stream, target, window, conn, false)
}

// ---------------------------------------------------------------------------
// [연결 테스트]
// ---------------------------------------------------------------------------

/// 타일 열쇠(`query:…`)와 섞이지 않게 이 머리만 받는다 — 비밀번호를 묻는 동안 세워 둔 경유 전송로(`net::park`)를 타일 것과
/// 나눠 갖지 않는다.
pub(crate) const TEST_STREAM_PREFIX: &str = "dbtest-";

/// 비밀 없음.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Tested {
    pub dialect: &'static str,
    pub server_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    pub elapsed_ms: u64,
}

/// 저장된 같은 id 의 줄이 있고 대상(`DbIdentity`)이 같을 때만 참 — 볼트의 비밀번호가 사람이 고르지 않은 다른 서버로 가지 않게.
/// 경유 별칭이 가리키는 SSH 서버는 비교에서 뺀다(`None`).
pub(crate) fn test_vault_allowed(saved: Option<&conns::DbConn>, draft: &conns::DbConn) -> bool {
    saved.is_some_and(|s| s.id == draft.id && DbIdentity::of(s, None).same(&DbIdentity::of(draft, None)))
}

/// 저장하지 않은 초안으로 한 번 붙고 곧바로 닫는다 — 접속이 이미 하는 것 밖의 문장은 보내지 않는다. 표 · 접속 기록에 남지 않는다.
/// 볼트 물러남은 서버가 저장된 파일을 다시 읽어 정한다(GUI 가 보낸 판단은 없다).
pub(crate) async fn test(stream: &str, draft: conns::DbConn, mut secrets: OpenSecrets) -> Result<Tested, OpenError> {
    if !stream_ok(stream) || !stream.starts_with(TEST_STREAM_PREFIX) {
        return Err(OpenError::Msg(tr!(ko: "연결 테스트 열쇠가 올바르지 않습니다", en: "The connection test key is invalid")));
    }
    let started = Instant::now();
    let (resolved, vault, via) = tokio::task::spawn_blocking(move || {
        let clean = conns::validate_list(std::slice::from_ref(&draft))?.pop().ok_or_else(task_failed)?;
        // 파일이 없거나 못 읽으면 없는 것 — 닫힌 쪽: 볼트를 쓰지 않는다.
        let saved = conns::path()
            .and_then(|p| conns::load_at(&p).ok())
            .and_then(|l| l.conns.into_iter().find(|d| d.id == clean.id));
        let vault = test_vault_allowed(saved.as_ref(), &clean);
        let hosts = match clean.via {
            Some(_) => crate::ssh_config::load_default()?.hosts,
            None => Vec::new(),
        };
        let via = clean.via.clone();
        resolve_conn(clean, |alias| hosts.iter().any(|h| conns::same_alias(&h.name, alias))).map(|r| (r, vault, via))
    })
    .await
    .map_err(|_| task_failed())??;
    secrets.vault = vault;
    let engine = match resolved {
        Resolved::Sqlite(path) => {
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), false))
                .await
                .map_err(|_| task_failed())??;
            Engine::Sqlite(Arc::new(s))
        }
        Resolved::Pg(t) => Engine::Pg(Arc::new(Pg::connect(stream, t, secrets).await?)),
        Resolved::Mysql(t) => Engine::Mysql(Arc::new(Mysql::connect(stream, t, secrets).await?)),
    };
    let out = Tested {
        dialect: engine.dialect().as_str(),
        server_version: engine.server_version(),
        via,
        elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    };
    engine.shutdown();
    Ok(out)
}

/// 네트워크 엔진은 서버 · 엔진의 타이머가 먼저 끊는다 — 표의 타이머는 그 뒤의 그물(전송로가 멈춰 서버에 닿지 못할 때).
const PG_TIMER_GRACE: Duration = Duration::from_secs(2);
/// 끊기를 보낸 뒤 엔진을 기다리는 한도 — 넘으면 작업을 버린다.
const PG_ABANDON_AFTER: Duration = Duration::from_secs(5);

/// `bool` = 시간 초과로 끊었나 · `stop` = 시한에 세울 멈춤 깃발. 네트워크 엔진이 끊기 뒤에도 돌아오지 않으면 기다리기를 멈춘다 —
/// 서버에서 계속 돌 수 있어 결과가 미확인이고 그 연결은 버린다("되돌림" 이 아니다).
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

fn unconfirmed_message() -> String {
    tr!(
        ko: "시간 제한 뒤 취소를 보냈는데도 서버가 답하지 않아 기다리기를 멈추고 이 연결을 끊었습니다 — 그 문장이 실행됐는지(자동 커밋이면 반영됐는지) 앱은 알 수 없습니다. 다시 연결해 데이터를 확인하세요",
        en: "The server did not answer even after a cancel at the time limit, so the app stopped waiting and closed this connection — it cannot tell whether the statement ran (or, with auto-commit, was applied). Reconnect and check the data"
    )
}

/// PG · MySQL 엔진이 실행 중에 읽기 전용으로 거절했다 — 앞의 부작용이 두 번 나지 않게 다시 돌지 않는다.
fn needs_work_message(engine_msg: &str) -> String {
    with_reason(DB_NEEDS_WORK, needs_work_text(engine_msg))
}

/// 이유 코드 없는 꼴 — 화면이 이유 코드를 떼지 않는 자리(스크립트 결과의 문장 실패 줄).
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

pub(super) fn message(err: EngineError, timed_out: bool, cancelled: bool, timeout_ms: u64) -> String {
    match err {
        EngineError::Interrupted if cancelled && !timed_out => {
            with_reason(CANCELLED, tr!(ko: "쿼리를 취소했습니다", en: "The query was cancelled"))
        }
        // 사람의 취소가 아니면 시간 초과다 — PG 는 서버의 `statement_timeout` 이 표의 타이머보다 먼저 끊는다.
        EngineError::Interrupted => timed_out_message(timeout_ms),
        EngineError::Busy => EngineError::busy_message(),
        EngineError::Unconfirmed(m) => with_reason(DB_UNCONFIRMED, m),
        EngineError::Message(m) | EngineError::ReadOnlyRefused(m) => m,
    }
}

/// 방치 되돌리기가 아닌 일이 끝나면 시계를 깨운다 — 그 일 때문에 미룬 방치 되돌리기가 곧바로 다시 간다.
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

/// 다른 일이 돌고 있으면 바쁨. 잠금을 쥔 채 작업 칸을 맞추고 `check` 를 부른다 — 검증과 엔진 진입 사이에 다른 요청이 끼지 못한다.
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

fn no_check(_: &Entry) -> Result<(), String> {
    Ok(())
}

/// 시험 전용 — 다음 `db_query` 를 조정 장치에 든 직후 · 엔진에 들기 전에 세운다(경합 재현 시험).
#[cfg(test)]
type PausePair = (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>);
#[cfg(test)]
static PAUSE_AFTER_CLAIM: LazyLock<Mutex<HashMap<u64, PausePair>>> = LazyLock::new(Default::default);

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

/// `tx_expect` 가 화면이 아는 작업 id 와 다르면 `[db-tx-stale]` — 자동 커밋으로 알고 친 문장이 남의 작업 안에서 돌지 않게(`None` = 보지 않는다).
/// 자동 커밋 끔 · 작업 없음: 허용 목록 조회는 작업을 열지 않고 읽기 전용 길로, 나머지는 작업을 저절로 연다. 조회가 읽기 전용에 걸리면
/// SQLite 는 실행 전 판정이라 작업을 열어 다시 돌고, PG · MySQL 은 실행 중 거절이라 다시 돌지 않는다(부작용이 두 번 나지 않게).
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
    // 저절로 연 작업 — "이번 실행만 되돌림" 의 덧말은 빈 작업을 닫아 본 뒤에 고른다.
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

/// 데이터 탭의 조회 — 타일이 쓰기 모드여도 늘 읽기 전용이다(가드 + 엔진의 읽기 전용 길 · 사람이 친 WHERE 가 섞여도). 이 길이 [`query`] 보다 넓은 것은 없다.
/// 열린 작업이 있으면 거절한다 — PG · MySQL 은 접근 모드를 트랜잭션 머리에서만 정해 작업 안에서 읽기 전용을 걸 길이 없다.
pub(crate) async fn query_read(handle: u64, lease: u64, sql: String, query_id: String, max_rows: usize, timeout_ms: u64) -> Result<QueryOut, String> {
    let e = lookup(handle, Some(lease))?;
    let cancelled = claim(&e, Work::Query, query_id, |e| {
        if lock(&e.tx).is_open() || e.engine.in_tx() {
            Err(read_in_work_message())
        } else {
            Ok(())
        }
    })?;
    let _clear = ClearRunning(&e, cancelled.clone());
    // 가드를 여기서도 한 번 — 엔진의 읽기 전용 길의 모양에 기대지 않는다.
    guard::check_mode(&sql, e.engine.dialect(), guard::Mode::ReadOnly).map_err(|err| match err {
        // 가드의 공용 문구는 [실행] · Alt+X 안내라 데이터 탭에 맞지 않는다.
        guard::GuardError::Multiple => read_multiple_message(),
        other => read_refused_message(&other.message()),
    })?;
    let r = match exec(&e, &sql, max_rows, timeout_ms, true, &cancelled, None).await {
        Ok(r) => r,
        Err(_) if cancelled.load(Ordering::SeqCst) => Err(message(EngineError::Interrupted, false, true, timeout_ms)),
        // 쓰기 모드 연결의 읽기 전용 길이 데이터를 바꾸는 문장이라 거절했다 — 다시 돌지 않는다.
        Err(m) => Err(read_refused_message(&m)),
    };
    r.map(|mut out| {
        out.tx = Some(e.tx_view());
        out
    })
}

fn read_in_work_message() -> String {
    tr!(
        ko: "트랜잭션 작업이 열려 있는 동안에는 데이터 탭이 조회하지 않습니다 — 데이터 탭은 늘 읽기 전용으로 도는데, 열린 작업 안에서는 읽기 전용을 걸 수 없습니다. [커밋] 또는 [되돌리기] 뒤 새로 고치세요.",
        en: "The data tab does not query while a transaction is open — it always runs read-only, and read-only cannot be set inside an open transaction. [Commit] or [Roll back], then refresh."
    )
}

fn read_refused_message(engine_msg: &str) -> String {
    format!(
        "{}\n{engine_msg}",
        tr!(
            ko: "데이터 탭은 읽기만 합니다 — 읽기 전용으로 돌 수 없는 조건이라 거절했습니다.",
            en: "The data tab only reads — this condition cannot run read-only, so it was refused."
        )
    )
}

fn read_multiple_message() -> String {
    tr!(
        ko: "데이터 탭은 읽기만 합니다 — WHERE 칸에는 조건 하나만 넣을 수 있습니다(세미콜론으로 문장을 잇지 마세요).",
        en: "The data tab only reads — the WHERE box takes one condition (do not chain statements with a semicolon)."
    )
}

/// `true` = 읽기 전용 길로 돌 조회 · `false` = 작업을 열 문장. 작업 안에서도 받지 않을 문장이면 아무것도 열지 않고 거절 문구.
pub(crate) fn auto_off_reads(sql: &str, d: Dialect) -> Result<bool, String> {
    guard::check_mode(sql, d, guard::Mode::Transaction).map_err(|err| auto_off_refusal(&err))?;
    Ok(guard::check_mode(sql, d, guard::Mode::ReadOnly).is_ok())
}

/// 작업 안에서 못 도는 문장은 "자동 커밋을 켜고" 로 안내한다(작업이 아직 없으니 "작업을 끝낸 뒤" 가 아니다).
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

/// `read` = 쓰기 모드여도 읽기 전용 길. `Err(엔진 문구)` = 그 길을 엔진이 거절했다(다시 돌지는 부르는 쪽이 엔진에 따라 고른다).
/// `held` = 저절로 연 작업의 첫 실행 — "이번 실행만 되돌림" 덧말 대신 엔진의 덧말을 여기 맡긴다.
async fn exec(
    e: &Entry,
    sql: &str,
    max_rows: usize,
    timeout_ms: u64,
    read: bool,
    cancelled: &Arc<AtomicBool>,
    held: Option<&mut Option<Option<String>>>,
) -> Result<Result<QueryOut, String>, String> {
    // 시작도 활동이다 — 긴 문장이 도는 동안 방치 시계가 먼저 닿지 않게(끝에서 다시 잰다).
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

/// 작업 안 문장 하나가 끝났다 — 엔진의 정리([`RunEnd`])로 작업 칸을 맞춘다. "이번 실행만 되돌림" 은 엔진이 복구 성공(`Undone`)을
/// 확인했을 때만 말한다.
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
                // 판정이 없다(엔진에 닿기 전 거절) — 센 것만 맞춘다.
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

/// 저절로 연 작업의 첫 실행이 실패해 쌓인 문장이 없다 — 빈 작업을 조용히 되돌린다. `true` = 닫았다.
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

/// 작업을 닫아 행 잠금도 풀렸으니 엔진의 덧말에서 "남은 행 잠금" 줄(MySQL · MariaDB)은 뺀다.
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

pub(crate) fn without_lock_note(extra: Option<&str>) -> Option<String> {
    let lock_line = super::mysql::lock_kept_note();
    let kept: Vec<&str> = extra?.lines().filter(|l| *l != lock_line).collect();
    (!kept.is_empty()).then(|| kept.join("
"))
}

/// `n` = 작업에 남은 문장 수 · `extra` = 엔진의 덧말.
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
// 스크립트 실행
// ---------------------------------------------------------------------------

/// 실행 전 거절은 `Ok` + `outcome: "refused"`(아무것도 실행하지 않았다). 떼어 두기는 스크립트를 끊지 않는다 — 떼어 둔 동안 끝났으면
/// 요약을 남겨 다시 붙는 화면에 한 번 건넨다(`Opened.last_script`).
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
    // 작업 id 검사는 조정 장치 안에서, 모드는 든 뒤에 읽는다 — 끝날 때까지 다른 요청이 바꾸지 못한다.
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
    // 조회만 든 스크립트는 작업을 열지 않고 `READ ONLY` 트랜잭션 하나로(단문과 같은 규칙).
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
    // PG · MySQL 이 실행 중에 읽기 전용으로 거절했다 — 다시 돌지 않는다(앞 문장의 부작용이 두 번 나지 않게).
    if refused_read && d != Dialect::Sqlite {
        if let Some(EngineError::ReadOnlyRefused(m)) = run.failed.take() {
            run.failed = Some(EngineError::Message(needs_work_text(&m)));
        }
    }
    // SQLite — 실행 전 판정이라 그 문장은 돌지 않았다(앞 문장은 조회뿐) — 작업을 열고 다시.
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
        // 저절로 연 작업까지 닫았다 — 전부 되돌림(바뀐 것 없음). 판 15 GUI 도 아는 `rolledBack` 으로 싣고 `workClosed` 로 가른다.
        out.outcome = "rolledBack";
        out.work_closed = true;
        out.message = without_lock_note(out.message.as_deref());
    }
    out.tx = Some(e.tx_view());
    out.needs_work = refused_read && d != Dialect::Sqlite;
    // 떼어 둔 동안 끝났다 — 요약을 남긴다(결과 행은 버린다).
    *lock(&e.script_note) = e.detached_at().is_some().then(|| script::summary(out.clone()));
    Ok(out)
}

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
// 트랜잭션 작업
// ---------------------------------------------------------------------------

/// 넘으면 결과 불명 — 끊지 않는다(`COMMIT` 을 끊으면 결과를 더 모르게 할 뿐이다).
const TX_END_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EndBy {
    Commit,
    Rollback,
    Idle,
}

pub(crate) async fn tx_begin(handle: u64, lease: u64) -> Result<tx::TxView, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::Begin, String::new(), no_check)?;
    let _clear = ClearRunning(&e, flag);
    begin_work(&e).await?;
    Ok(e.tx_view())
}

/// 부르는 쪽이 늘 조정 장치에 들어 있다([`claim`]).
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

/// 실행이 돌고 있으면 바쁨으로 거절한다 — 사람이 결과를 보지 못한 실행 뒤에 커밋이 줄 서면 무엇을 커밋하는지 모르게 된다.
pub(crate) async fn tx_end(handle: u64, lease: u64, id: u64, commit: bool) -> Result<tx::TxView, String> {
    let e = lookup(handle, Some(lease))?;
    let flag = claim(&e, Work::End, String::new(), |e| lock(&e.tx).start_ending(id).map_err(|r| r.message()))?;
    let _clear = ClearRunning(&e, flag);
    end_engine(&e, if commit { EndBy::Commit } else { EndBy::Rollback }).await?;
    Ok(e.tx_view())
}

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

/// 시계를 늘리지 않는다.
pub(crate) fn tx_state(handle: u64, lease: u64) -> Result<tx::TxView, String> {
    Ok(lookup(handle, Some(lease))?.tx_view())
}

/// 칸은 이미 `ending` 이다. 엔진이 받지 못했으면(바쁨 · 거절했는데 작업이 남음) 칸을 열림으로 되돌리고 오류를 돌려준다.
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
            // 서버는 끝냈다고 답했는데 트랜잭션이 남았다 — 엔진이 연결을 버렸다. 결과 불명.
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

const IDLE_RETRY: Duration = Duration::from_millis(1500);
static IDLE_RETRY_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn idle_retry() -> Duration {
    match IDLE_RETRY_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => IDLE_RETRY,
        ms => Duration::from_millis(ms),
    }
}

#[cfg(test)]
pub(crate) fn set_idle_retry_for_test(d: Option<Duration>) {
    IDLE_RETRY_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
}

/// 칸은 이미 `ending` · 조정 장치에도 들어 있다([`tx_tick`] 이 동기로 걸었다). 엔진에 닿지 못했으면 [`idle_retry`] 뒤 다시 간다.
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

/// 서버가 스스로 바꾼 것(경고 · 방치 되돌림)만 알린다.
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

/// 끌 때 열린 작업이 있으면 먼저 되돌린다(화면이 확인을 먼저 받는다 — 끄기는 늘 안전한 쪽이라는 `write-toggle` 규칙).
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
        e.auto_commit.store(true, Ordering::SeqCst);
    }
    Ok(e.engine.writable())
}

pub(crate) fn auto_commit(handle: u64, lease: u64) -> Result<bool, String> {
    Ok(!lookup(handle, Some(lease))?.auto_off())
}

/// 작업이 열려 있으면 바꾸지 않는다 — 켜는 순간 열린 작업을 커밋하는 JDBC 식 뜻과 헷갈리지 않게([커밋] · [되돌리기] 로 먼저 끝낸다).
pub(crate) fn set_auto_commit(handle: u64, lease: u64, on: bool) -> Result<bool, String> {
    let e = lookup(handle, Some(lease))?;
    // 조정 장치 안에서 검증하고 바꾼다 — 도는 실행이 길(자동 커밋 · 작업)을 고른 뒤 토글이 바뀌는 일이 없게.
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
// 수명
// ---------------------------------------------------------------------------

pub(crate) fn conn_opened(conn: u64) {
    lock(&TABLE).conns.insert(conn);
}

/// 바뀐 수 — 이미 같은 모양으로 떼어 둔 것은 세지 않는다.
fn detach_where(t: &Table, how: How, pick: impl Fn(&Entry) -> bool) -> usize {
    let now = Instant::now();
    let n = t.by_handle.values().filter(|e| pick(e)).filter(|e| e.detach(now, how)).count();
    if n > 0 {
        wake_reaper();
    }
    n
}

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

/// GUI 종료 · kill · quitAll 뒤 — 그 연결이 쥔 DB 연결을 떨어진 세션으로 남긴다(TTL 없음). 바뀐 수.
pub(crate) fn conn_gone(conn: u64) -> usize {
    let mut t = lock(&TABLE);
    t.conns.remove(&conn);
    detach_where(&t, How::Kept, |e| lock(&e.holder).conn == conn)
}

/// 페이지 리로드 · 웹뷰 크래시 — 그 창이 쥔 DB 연결을 떼어 둔다(TTL · `skip` = 이관 중인 stream).
pub(crate) fn detach_window(window: &str, skip: &HashSet<String>) -> usize {
    let t = lock(&TABLE);
    detach_where(&t, How::Reload, |e| !skip.contains(&e.stream) && lock(&e.holder).window == window)
}

/// 앱 전체 종료 중의 창 파괴(`detach_window` 의 `dbOnly`) — 떨어진 세션으로 남긴다(TTL 없음 · `skip` = 이관 중인 stream).
pub(crate) fn keep_window(window: &str, skip: &HashSet<String>) -> usize {
    let t = lock(&TABLE);
    detach_where(&t, How::Kept, |e| !skip.contains(&e.stream) && lock(&e.holder).window == window)
}

/// 복원이 끝났다 — 이 창의 떼어 둔 연결 중 `keep` 에 없는 것을 "데려가지 않음" 으로 적는다(리로드로 떼어 둔 것도 TTL 이 걷힌다).
pub(crate) fn restore_done(window: &str, keep: &HashSet<String>) -> usize {
    let t = lock(&TABLE);
    let now = Instant::now();
    t.by_handle
        .values()
        .filter(|e| e.detached_at().is_some() && !keep.contains(&e.stream) && lock(&e.holder).window == window)
        .filter(|e| {
            // 리로드 → 남김 → 데려가지 않음(`detach` 는 한 번에 한 칸만 올린다).
            e.detach(now, How::Kept);
            e.detach(now, How::Unclaimed)
        })
        .count()
}

/// 지금 떼어 둔 것만 닫는다(그 사이 누가 붙었으면 `false`).
pub(crate) fn close_detached(stream: &str) -> bool {
    let mut t = lock(&TABLE);
    let Some(e) = t.by_stream.get(stream).cloned().filter(|e| e.detached_at().is_some()) else {
        return false;
    };
    retire(&mut t, &e);
    drop(t);
    net::drop_parked(stream);
    true
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DetachedDb {
    pub stream: String,
    pub home: String,
    pub opened_at_ms: u64,
    pub detached_at_ms: u64,
    pub unclaimed: bool,
    pub conn: String,
    pub writable: bool,
    pub in_tx: bool,
}

pub(crate) fn detached_rows() -> Vec<DetachedDb> {
    let entries: Vec<Arc<Entry>> = lock(&TABLE).by_handle.values().cloned().collect();
    let mut rows: Vec<DetachedDb> = entries
        .iter()
        .filter_map(|e| {
            let d = (*lock(&e.detached)).filter(|d| d.how != How::Reload)?;
            Some(DetachedDb {
                stream: e.stream.clone(),
                home: lock(&e.holder).window.clone(),
                opened_at_ms: e.opened_at_ms,
                detached_at_ms: d.at_ms,
                unclaimed: d.how == How::Unclaimed,
                conn: e.target.id.clone(),
                writable: e.engine.writable(),
                in_tx: lock(&e.tx).open_id().is_some(),
            })
        })
        .collect();
    rows.sort_by(|a, b| b.detached_at_ms.cmp(&a.detached_at_ms).then_with(|| a.stream.cmp(&b.stream)));
    rows
}

pub(crate) fn kept_count() -> usize {
    lock(&TABLE).by_handle.values().filter(|e| e.kept_since().is_some()).count()
}

/// 보조 창 닫기 — 떼어 둔 것까지 닫는다(`held` = 이관 중인 stream 은 뺀다).
pub(crate) fn close_window(window: &str, held: &HashSet<String>) -> usize {
    close_where(|e| !held.contains(&e.stream) && lock(&e.holder).window == window).len()
}

/// 이관 — 보낸 창의 `close_window` 가 거두지 않게 쥔 창을 옮긴다.
pub(crate) fn set_home(streams: &[String], window: &str) {
    let t = lock(&TABLE);
    for s in streams {
        if let Some(e) = t.by_stream.get(s) {
            lock(&e.holder).window = window.to_string();
        }
    }
}

pub(crate) fn close_all() -> usize {
    let n = close_where(|_| true).len();
    net::drop_all_parked();
    n
}

pub(crate) fn live_count() -> usize {
    lock(&TABLE).by_handle.len()
}

fn expire(now: Instant) -> (Vec<String>, Option<Instant>) {
    let ttl = ttl();
    let next = lock(&TABLE)
        .by_handle
        .values()
        .filter_map(|e| e.reload_detached_at().map(|at| at + ttl))
        .filter(|&due| due > now)
        .min();
    let gone = close_where(|e| e.reload_detached_at().is_some_and(|at| at + ttl <= now));
    (gone, next)
}

/// 방치 시계 한 바퀴 — 칸을 여기서 동기로 `ending` 으로 걸어 되돌리기를 두 번 띄우지 않는다. 다음 할 일의 시각을 돌려준다.
fn tx_tick(now: Instant) -> Option<Instant> {
    let (limit, warn) = tx::clock();
    let ttl = ttl();
    let entries: Vec<Arc<Entry>> = lock(&TABLE).by_handle.values().cloned().collect();
    let mut next: Option<Instant> = None;
    for e in entries {
        // 끊긴 연결의 작업은 방치 시계가 되돌리러 가지 않는다 — 여기서 '끊김' 으로 옮겨진다(PG `in_tx` 는 죽은 연결을 거짓으로 본다).
        if e.reconcile_tx() == Some(tx::Outcome::Disconnected) {
            crate::server::log::line(format!("db: open transaction on handle {} ended by a lost connection", e.handle));
        }
        // 떨어진 세션으로 남은 연결의 열린 작업은 떨어진 지 TTL 이면 되돌린다(연결은 남는다).
        let kept_due = e.kept_since().map(|at| at + ttl);
        loop {
            let mut due = lock(&e.tx).next_due(limit, warn);
            if let (Some(k), Some((at, _))) = (kept_due, due) {
                if k <= at {
                    due = Some((k, tx::Due::Expire));
                }
            }
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
                    // 지난번 되돌리기가 엔진에 닿지 못했다 — 재시도 시각까지 기다린다.
                    let retry_at = *lock(&e.idle_retry_at);
                    if let Some(r) = retry_at.filter(|&r| r > now) {
                        next = Some(next.map_or(r, |n| n.min(r)));
                        break;
                    }
                    // 다른 일이 돌면 미룬다(그 일이 끝나며 시계를 깨운다) — 재시도 틈 뒤에도 다시 본다.
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

#[cfg(test)]
pub(crate) fn set_tx_clock_for_test(c: Option<(Duration, Duration)>) {
    tx::set_clock_for_test(c);
    REAPER_WAKE.notify_one();
}

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

/// TTL 시계 — 표 하나에 태스크 하나.
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
