//! AI 의 DB 평면 — 세션 서버의 MCP(`mcp::db`)가 부르는 유일한 입구(docs/log/2026-10-13-db-write-mcp-design.md B-3 ~ B-5 · D5). 사람 타일의
//! 연결 표(`table`)와 따로 산다(→ docs/invariants.md 전문 8).
//!
//! ## 불변식
//!
//! - 권한 판정을 지나야 들어온다 — [`run`] 은 [`Grant`] 를 받고 `Grant` 는 [`authorize`] 만 만든다(칸 비공개 · `delegation.toml`
//!   `[[database]]` 단계 + 신원 스냅샷). `run` 은 요청이 바라는 단계를 한 번 더 본다.
//! - AI 전용 연결 — 사람 타일의 연결(표 · 타일 `stream` · 트랜잭션 작업)에 닿는 길이 없다(시험 `db_ai_never_touches_tile_entries`) —
//!   AI 문장이 사람의 열린 트랜잭션 안에서 돌거나 사람이 켠 쓰기 모드가 AI 에 번지지 않는다(D5).
//! - 늘 읽기 전용 — 읽기 전용으로 열고(쓰기 플래그를 켜는 함수를 부르지 않는다) 조회는 가드의 읽기 전용 모드 → 엔진 `READ ONLY` 트랜잭션.
//!   열린 연결이 쓰기 가능으로 보이면 쓰지 않고 거절한다(시험 `db_ai_connections_are_read_only_forever`).
//! - 비밀번호는 빌린 값 → 볼트(`db::borrowed`): 그 연결의 사람 쿼리 타일이 비밀번호(친 값 · 볼트 값)로 인증해 붙어 있는 동안은 그 값을
//!   먼저 쓴다 — 볼트 잠금 · 가림막 · 창 0개와 무관하다. 볼트 차례는 그 연결에 헤드리스 위임(`[[database]] headless`)이 있을 때만이고,
//!   없으면 볼트도 경유 SSH 도 열지 않고 [`headless_off_text`] 로 실패한다. 판정은 증표(호출마다 지금 `delegation.toml`)와 [`open_with`]
//!   한 곳 · 빌린 값이 거절되면 버리고 (헤드리스면) 볼트로 한 번 더. 값은 세션 서버 안 · 이 모듈 밖으로 나가지 않는다.
//! - SQLite 도 헤드리스 칸을 따른다 — 그 연결의 사람 쿼리 타일이 서버 표에 있으면 칸과 무관하게 열고, 없으면 헤드리스 위임이 있을 때만
//!   ([`sqlite_gate`] — 읽기 · 쓰기 작업안 연결 공통). 빌린 값으로 연 연결은 그 값이 지워지면 거둔다([`retire_borrowed`] — 도는 조회는 끝까지).
//! - 경유 SSH 는 헤드리스 규칙(`SharedCreds::unattended`) — 사람의 답(호스트 키 · 비밀번호 · 암호구)을 받지 않고, 볼트의 SSH 비밀번호를
//!   쓰지 않으며, 볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만. 사람이 이미 연 같은 호스트의 공유 전송로에는 그대로 얹힌다.
//! - 세션 코어 · 떨어진 세션 목록에 오르지 않는다 · 로그에 SQL · 결과가 없다.
//!
//! ## 수명
//!
//! 같은 스냅샷의 살아 있는 연결은 다시 쓰고 없으면 연다. 무활동 [`IDLE_CLOSE`](5분)이면 닫는다 — 비밀번호를 오래 쥔 연결 · SSH 핀을
//! 남기지 않는다. 헤드리스 위임이 꺼지면 볼트 차례로 연 것 · 타일 없이 비밀번호 없이 연 것은 다음 호출이 쓰지 않고 거둔다([`reusable`]).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::borrowed::{self, Missing};
use super::mysql::Mysql;
use super::net::{OpenError, OpenSecrets};
use super::pg::Pg;
use super::script::{self, ScriptMode};
use super::sqlite::Sqlite;
use super::table::{self, Engine, Resolved};
use super::QueryOut;
use crate::audit::AuditRecord;
use crate::delegation::database::DbIdentity;

// MCP(`mcp::db`)는 이 모듈만 들여온다 — 쓰는 꼴도 여기서 다시 낸다.
pub(crate) use super::conns::DbConn;
pub(crate) use super::definition::DefTarget;
pub(crate) use crate::delegation::database::DbAiLevel;
use crate::delegation::Delegation;
use crate::errors::{has_reason, DB_AUTH, DB_PASSWORD, DB_STORED_REJECTED};
use crate::ssh::open::{SharedCreds, Unattended};
use crate::ssh::SshOpenError;

/// AI 연결의 열쇠 앞머리 — 엔진의 생사(`net::Life`)가 이 앞머리면 화면 이벤트를 내지 않는다.
pub(crate) const STREAM_PREFIX: &str = "ai-db:";
pub(crate) const ROWS_DEFAULT: usize = 50;
pub(crate) const ROWS_MAX: usize = 500;
pub(crate) const CELL_MAX: usize = 1024;
pub(crate) const RESPONSE_MAX: usize = 256 * 1024;
pub(crate) const TIMEOUT_DEFAULT_MS: u64 = 15_000;
pub(crate) const TIMEOUT_MAX_MS: u64 = 60_000;
pub(crate) const META_TIMEOUT_MS: u64 = 15_000;
pub(crate) const OBJECTS_MAX: usize = 500;
pub(crate) const DEFINITION_MAX: usize = 64 * 1024;
pub(crate) const SQL_MAX: usize = 64 * 1024;
pub(crate) const IDLE_CLOSE: Duration = Duration::from_secs(300);
/// 표의 그물(시한 + 2초 · 끊은 뒤 5초)과 접속(15초)보다 넉넉히 — MCP 요청 스레드가 무한히 묶이지 않게.
pub(crate) const CALL_GRACE: Duration = Duration::from_secs(20);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// 권한 — 판정을 지난 증표
// ---------------------------------------------------------------------------

/// 권한 판정을 지난 증표 — [`authorize`] 만 만든다(칸 비공개). [`run`] 은 이것 없이는 부를 수 없다.
pub(crate) struct Grant {
    conn: DbConn,
    level: DbAiLevel,
    /// 스냅샷 비교에 쓴 값 — 풀의 지문.
    via_target: Option<String>,
    via_vault_passphrase: bool,
    /// 거짓이면 빌린 값이 없을 때 볼트를 읽지 않는다([`open_with`]).
    headless: bool,
}

#[cfg(test)]
pub(crate) fn grant_conn_id_for_test(g: &Grant) -> String {
    g.conn.id.clone()
}

impl Grant {
    /// 읽기만 — 증표는 여전히 [`authorize`] 만 만든다.
    pub(crate) fn conn(&self) -> &DbConn {
        &self.conn
    }

    pub(crate) fn level(&self) -> DbAiLevel {
        self.level
    }

    /// 시험이 읽는다 — 판정은 [`open_with`] 가 칸을 직접 본다.
    #[cfg(test)]
    pub(crate) fn headless(&self) -> bool {
        self.headless
    }

    /// 3b 작업안이 만들 때 떠 두고 실행 직전에 다시 맞춘다.
    pub(crate) fn identity(&self) -> DbIdentity {
        DbIdentity::of(&self.conn, self.via_target.clone())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Denied {
    /// 권한이 끔이거나 스냅샷이 어긋났다 — AI 에게는 없는 연결과 같은 말을 한다(있다는 것도 알리지 않는다).
    Off,
    Below(DbAiLevel),
}

pub(crate) fn authorize(d: &Delegation, conn: &DbConn, via_target: Option<&str>, need: DbAiLevel) -> Result<Grant, Denied> {
    let level = d.db_level(conn, via_target);
    if level == DbAiLevel::Off {
        return Err(Denied::Off);
    }
    if level < need.max(DbAiLevel::Schema) {
        return Err(Denied::Below(level));
    }
    Ok(Grant {
        conn: conn.clone(),
        level,
        via_target: via_target.map(str::to_owned),
        via_vault_passphrase: conn.via.as_deref().is_some_and(|v| d.vault_passphrase_granted(v)),
        headless: d.db_headless(conn, via_target),
    })
}

/// AI 가 "타일을 열어 달라" 고 먼저 말할지 고르는 표지다(판정은 [`open_with`] · [`sqlite_gate`]).
pub(crate) fn opens_without_tile(d: &Delegation, conn: &DbConn, via_target: Option<&str>) -> bool {
    d.db_headless(conn, via_target)
}

/// 그 연결 id 의 사람 쿼리 타일이 세션 서버 표에 있나 — 엔진 무관 · 창이 사라져 떨어진 세션으로 남은 동안도 있다. 시험의 `Given` 은 타일 없음.
pub(crate) fn tile_open(grant: &Grant, src: &PasswordSource) -> bool {
    match src {
        PasswordSource::Vault => borrowed::missing(&grant.conn.id) != Some(Missing::TileClosed),
        #[cfg(test)]
        PasswordSource::Given(_) => false,
    }
}

/// 사람 타일이 표에 있거나 헤드리스 위임이 있을 때만 연다 — 아니면 파일에 닿지 않는다(읽기 · 쓰기 작업안 연결 공통).
pub(crate) fn sqlite_gate(grant: &Grant, src: &PasswordSource) -> Result<(), String> {
    if sqlite_opens(grant.headless, tile_open(grant, src)) {
        Ok(())
    } else {
        Err(headless_off_sqlite_text())
    }
}

pub(crate) fn sqlite_opens(headless: bool, tile_open: bool) -> bool {
    headless || tile_open
}

// ---------------------------------------------------------------------------
// 요청
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) enum AiRequest {
    Schemas,
    Objects { schema: Option<String> },
    Describe { schema: Option<String>, table: String },
    Definition(DefTarget),
    /// 여럿이면 읽기 모드 스크립트(한 `READ ONLY` 트랜잭션 · 첫 오류에서 멈춤).
    Query { sql: String, max_rows: usize, timeout_ms: u64 },
}

impl AiRequest {
    pub(crate) fn needs(&self) -> DbAiLevel {
        match self {
            AiRequest::Query { .. } => DbAiLevel::Read,
            _ => DbAiLevel::Schema,
        }
    }

    pub(crate) fn timeout_ms(&self) -> u64 {
        match self {
            AiRequest::Query { timeout_ms, .. } => *timeout_ms,
            _ => META_TIMEOUT_MS,
        }
    }
}

pub(crate) fn clamp_query(max_rows: Option<u64>, timeout_seconds: Option<u64>) -> (usize, u64) {
    let rows = max_rows.map(|n| (n as usize).clamp(1, ROWS_MAX)).unwrap_or(ROWS_DEFAULT);
    let ms = timeout_seconds
        .map(|s| s.saturating_mul(1000).clamp(1000, TIMEOUT_MAX_MS))
        .unwrap_or(TIMEOUT_DEFAULT_MS);
    (rows, ms)
}

#[derive(Debug, Clone)]
pub(crate) struct AiOutcome {
    pub value: Value,
    pub rows: Option<u64>,
}

/// 제품은 늘 `Vault`(빌린 값 → 볼트). 시험만 값을 직접 준다 — 사용자 볼트를 건드리지 않게, 그때는 빌린 값도 보지 않는다.
pub(crate) enum PasswordSource {
    Vault,
    #[cfg(test)]
    Given(Option<String>),
}

impl PasswordSource {
    fn body(&self) -> Option<zeroize::Zeroizing<String>> {
        match self {
            PasswordSource::Vault => None,
            #[cfg(test)]
            PasswordSource::Given(p) => p.clone().map(zeroize::Zeroizing::new),
        }
    }
}

// ---------------------------------------------------------------------------
// AI 전용 연결 풀
// ---------------------------------------------------------------------------

struct AiConn {
    engine: Engine,
    ident: DbIdentity,
    last_used: Mutex<Instant>,
    busy: AtomicBool,
    /// 빌린 값이면 그 값이 지워질 때 거두고, 볼트 차례면 헤드리스 위임이 꺼진 호출이 다시 쓰지 않는다.
    from: PwFrom,
    /// 거뒀다(풀에서 빠짐) — 도는 조회가 끝나는 순간 닫는다([`BusyGuard`]).
    retired: AtomicBool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum PwFrom {
    Borrowed,
    /// 헤드리스 위임으로 연 것 — 서버가 비밀번호를 실제로 청했는지는 몰라 볼트로 본다.
    Vault,
    /// SQLite · 헤드리스 끔 + 비밀번호 없이 붙은 타일 — 사람 타일이 있거나 헤드리스일 때만 다시 쓴다.
    NoPassword,
}

impl PwFrom {
    fn of(lent: Option<u64>, sqlite: bool, headless: bool) -> PwFrom {
        if lent.is_some() {
            PwFrom::Borrowed
        } else if headless && !sqlite {
            PwFrom::Vault
        } else {
            PwFrom::NoPassword
        }
    }
}

/// 위임 판정은 호출마다 지금 파일이다 — 풀에서 꺼내 쓰는 것도 판정을 지난다. 비밀번호 없이 연 것은 여는 판정과 같은 문(타일 또는 헤드리스).
pub(crate) fn reusable(from: PwFrom, headless: bool, tile_open: bool) -> bool {
    match from {
        PwFrom::Borrowed => true,
        PwFrom::Vault => headless,
        PwFrom::NoPassword => headless || tile_open,
    }
}

static POOL: LazyLock<Mutex<HashMap<String, Arc<AiConn>>>> = LazyLock::new(Default::default);
/// 같은 연결을 두 번 열지 않게 줄 세운다(AI 호출은 드물어 연결마다 문을 둘 까닭이 없다).
static OPEN_GATE: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(Default::default);
static REAPER: AtomicBool = AtomicBool::new(false);

struct BusyGuard(Arc<AiConn>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        *lock(&self.0.last_used) = Instant::now();
        self.0.busy.store(false, Ordering::SeqCst);
        // 도는 사이 거뒀다 — 끝났으니 닫는다(거두는 쪽이 바쁨을 보고 미뤘다).
        if self.0.retired.load(Ordering::SeqCst) {
            self.0.engine.shutdown();
        }
    }
}

fn busy_text() -> String {
    "Another AI query is running on this connection — wait for it to finish (one AI query per connection at a time)".into()
}

pub(crate) fn close_idle(now: Instant) -> usize {
    let gone: Vec<Arc<AiConn>> = {
        let mut p = lock(&POOL);
        let ids: Vec<String> = p
            .iter()
            .filter(|(_, c)| {
                !c.busy.load(Ordering::SeqCst)
                    && (c.engine.is_dead() || now.saturating_duration_since(*lock(&c.last_used)) >= IDLE_CLOSE)
            })
            .map(|(k, _)| k.clone())
            .collect();
        ids.iter().filter_map(|k| p.remove(k)).collect()
    };
    for c in &gone {
        c.engine.shutdown();
    }
    gone.len()
}

pub(crate) fn close_all() -> usize {
    let all: Vec<Arc<AiConn>> = lock(&POOL).drain().map(|(_, c)| c).collect();
    for c in &all {
        c.engine.shutdown();
    }
    all.len()
}

/// `db::borrowed` 가 그 연결 id 의 값을 지울 때 부른다 — 돌지 않으면 닫고, 돌고 있으면 그 조회가 끝난 뒤 닫는다([`BusyGuard`]).
pub(crate) fn retire_borrowed(id: &str) -> usize {
    let gone: Vec<Arc<AiConn>> = {
        let mut p = lock(&POOL);
        let ids: Vec<String> = p
            .iter()
            .filter(|(k, c)| c.from == PwFrom::Borrowed && k.as_str() == id)
            .map(|(k, _)| k.clone())
            .collect();
        ids.iter().filter_map(|k| p.remove(k)).collect()
    };
    for c in &gone {
        c.retired.store(true, Ordering::SeqCst);
        if !c.busy.load(Ordering::SeqCst) {
            c.engine.shutdown();
        }
    }
    gone.len()
}

/// 시험 전용 — 그 연결들만 닫는다(병렬 시험이 서로의 연결을 닫지 않게).
#[cfg(test)]
pub(crate) fn close_for_test(ids: &[&str]) {
    let gone: Vec<Arc<AiConn>> = {
        let mut p = lock(&POOL);
        ids.iter().filter_map(|id| p.remove(*id)).collect()
    };
    for c in gone {
        c.engine.shutdown();
    }
}

/// 시험 전용 — SQLite 연결을 `from` 표지로 풀에 심는다(다시 쓰기 판정은 엔진 종류를 보지 않는다).
#[cfg(test)]
pub(crate) fn plant_for_test(grant: &Grant, from: PwFrom) {
    let s = Sqlite::open(std::path::Path::new(grant.conn.path.as_deref().expect("SQLite 연결")), false).expect("열기");
    let c = Arc::new(AiConn {
        engine: Engine::Sqlite(Arc::new(s)),
        ident: DbIdentity::of(&grant.conn, grant.via_target.clone()),
        last_used: Mutex::new(Instant::now()),
        busy: AtomicBool::new(false),
        from,
        retired: AtomicBool::new(false),
    });
    if let Some(old) = lock(&POOL).insert(grant.conn.id.clone(), c) {
        old.engine.shutdown();
    }
}

#[cfg(test)]
pub(crate) async fn acquire_for_test(grant: &Grant) -> Result<(PwFrom, bool), String> {
    let before = lock(&POOL).get(&grant.conn.id).cloned();
    let c = acquire(grant, &PasswordSource::Vault).await?;
    Ok((c.from, before.is_some_and(|b| Arc::ptr_eq(&b, &c))))
}

pub(crate) fn live_count() -> usize {
    lock(&POOL).len()
}

fn ensure_reaper() {
    if REAPER.swap(true, Ordering::SeqCst) {
        return;
    }
    match tokio::runtime::Handle::try_current() {
        Ok(rt) => {
            rt.spawn(async {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    close_idle(Instant::now());
                }
            });
        }
        Err(_) => REAPER.store(false, Ordering::SeqCst),
    }
}

async fn acquire(grant: &Grant, src: &PasswordSource) -> Result<Arc<AiConn>, String> {
    let ident = DbIdentity::of(&grant.conn, grant.via_target.clone());
    let reuse = |ident: &DbIdentity| -> Option<Arc<AiConn>> {
        // 타일 표는 풀 잠금 밖에서 본다(잠금 순서 — `borrowed` 는 값을 지울 때 풀을 잠근다).
        let tile = tile_open(grant, src);
        let mut p = lock(&POOL);
        let c = p.get(&grant.conn.id)?.clone();
        if !reusable(c.from, grant.headless, tile) {
            // 다시 쓸 수 없다 — 풀에서 빼고 새 열기로 간다(돌고 있으면 그 조회가 끝난 뒤 닫는다).
            p.remove(&grant.conn.id);
            c.retired.store(true, Ordering::SeqCst);
            if !c.busy.load(Ordering::SeqCst) {
                c.engine.shutdown();
            }
            return None;
        }
        if c.ident == *ident && !c.engine.is_dead() {
            return Some(c);
        }
        if !c.busy.load(Ordering::SeqCst) {
            p.remove(&grant.conn.id);
            c.engine.shutdown();
        }
        None
    };
    if let Some(c) = reuse(&ident) {
        return Ok(c);
    }
    let _gate = OPEN_GATE.lock().await;
    if let Some(c) = reuse(&ident) {
        return Ok(c);
    }
    let (engine, lent) = open_engine(grant, src).await?;
    let from = PwFrom::of(lent, matches!(engine, Engine::Sqlite(_)), grant.headless);
    if engine.writable() {
        // 그물 — 이 모듈은 쓰기를 켜지 않는다. 그래도 쓰기 가능으로 보이면 쓰지 않는다.
        engine.shutdown();
        return Err("refused: the AI connection is not read-only".into());
    }
    let c = Arc::new(AiConn {
        engine,
        ident,
        last_used: Mutex::new(Instant::now()),
        busy: AtomicBool::new(false),
        from,
        retired: AtomicBool::new(false),
    });
    {
        let mut p = lock(&POOL);
        // 여는 사이 빌린 값이 지워졌다 — 이번 호출만 이 연결로 돌고 풀에 넣지 않는다(거두는 쪽이 이미 지나갔다). 풀 잠금 안에서 봐야
        // 거두기와 엇갈려 풀에 남지 않는다.
        if lent.is_some_and(|stamp| !borrowed::still_lent(&grant.conn.id, stamp)) {
            c.retired.store(true, Ordering::SeqCst);
            return Ok(c);
        }
        if let Some(old) = p.insert(grant.conn.id.clone(), Arc::clone(&c)) {
            old.engine.shutdown();
        }
    }
    ensure_reaper();
    Ok(c)
}

/// 둘째 값 = 빌린 값으로 열었으면 그 번호.
async fn open_engine(grant: &Grant, src: &PasswordSource) -> Result<(Engine, Option<u64>), String> {
    let via = grant.conn.via.clone();
    let resolved = resolve_for(grant).await?;
    let stream = format!("{STREAM_PREFIX}{}", grant.conn.id);
    let opened = match resolved {
        Resolved::Sqlite(path) => {
            // 파일에 닿기 전에 문을 지난다.
            sqlite_gate(grant, src)?;
            // 읽기 전용 열기(`writable = false`) — `SQLITE_OPEN_READ_ONLY` + `query_only`.
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), false))
                .await
                .map_err(|_| "The database task failed (worker thread)".to_string())??;
            Ok((Engine::Sqlite(Arc::new(s)), None))
        }
        Resolved::Pg(t) => open_with(grant, src, lend_for(grant, src), |s| Pg::connect(&stream, t.clone(), s))
            .await
            .map(|(p, lent)| (Engine::Pg(Arc::new(p)), lent)),
        Resolved::Mysql(t) => open_with(grant, src, lend_for(grant, src), |s| Mysql::connect(&stream, t.clone(), s))
            .await
            .map(|(m, lent)| (Engine::Mysql(Arc::new(m)), lent)),
    };
    opened.map_err(|e| open_error_text(e, via.as_deref(), &grant.conn.id))
}

/// 제품(`Vault`)만 빌린 값을 본다. 없는 까닭은 표에 남아 열기가 실패하면 [`open_error_text`] 가 `borrowed::missing` 으로 읽는다.
pub(crate) fn lend_for(grant: &Grant, src: &PasswordSource) -> Option<borrowed::Lent> {
    match src {
        PasswordSource::Vault => borrowed::lend(&grant.conn).ok(),
        #[cfg(test)]
        PasswordSource::Given(_) => None,
    }
}

/// 빌린 값으로 먼저 열고, DB 가 거절하면(`[db-auth]`) 그 값을 버리고 볼트 차례로 한 번 더 연다 — 같은 값을 두 번 보내지 않으니 계정
/// 잠금 위험은 볼트만 쓰던 때와 같다. 볼트 차례는 헤드리스 위임이 있을 때만이다 — 없으면 볼트에 닿지 않고, 사람 타일이 비밀번호 없이
/// 붙어 있을 때만 비밀번호 없이 한 번 열어 본다. 그 밖에는 아무것도 열지 않고(경유 SSH 도) [`headless_off_text`] 로 실패한다.
pub(crate) async fn open_with<T, Fut>(
    grant: &Grant,
    src: &PasswordSource,
    lent: Option<borrowed::Lent>,
    mut open: impl FnMut(OpenSecrets) -> Fut,
) -> Result<(T, Option<u64>), OpenError>
where
    Fut: std::future::Future<Output = Result<T, OpenError>>,
{
    if let Some(l) = lent {
        let mut s = secrets_for(grant, src);
        s.password = Some(l.password);
        // 빌린 값이 거절되면 볼트 표지(`[db-stored-rejected]`)가 아니라 `[db-auth]` 로 온다 — 그때만 볼트로 물러난다(아래).
        s.vault = false;
        match open(s).await {
            Ok(x) => return Ok((x, Some(l.stamp))),
            Err(OpenError::Msg(m)) if has_reason(&m, DB_AUTH) => {
                borrowed::reject(&grant.conn.id, l.stamp);
            }
            Err(e) => return Err(e),
        }
    }
    if grant.headless {
        return open(secrets_for(grant, src)).await.map(|x| (x, None));
    }
    // 헤드리스 위임 없음 — 볼트에 닿지 않는다. 사람 타일이 비밀번호 없이 붙어 있을 때만 비밀번호 없이 열어 본다.
    let why = match src {
        PasswordSource::Vault => borrowed::missing(&grant.conn.id),
        #[cfg(test)]
        PasswordSource::Given(_) => Some(Missing::TileClosed),
    };
    if why != Some(Missing::NoPassword) {
        return Err(OpenError::Msg(headless_off_text(why)));
    }
    let mut s = secrets_for(grant, src);
    s.password = None;
    s.vault = false;
    match open(s).await {
        Ok(x) => Ok((x, None)),
        Err(OpenError::Msg(m)) if has_reason(&m, DB_PASSWORD) || has_reason(&m, DB_AUTH) => {
            Err(OpenError::Msg(headless_off_text(why)))
        }
        Err(e) => Err(e),
    }
}

/// 블로킹 일은 작업 스레드에서 — 쓰기 연결(`db::ai_write`)도 같은 길을 쓴다.
pub(super) async fn resolve_for(grant: &Grant) -> Result<Resolved, String> {
    let conn = grant.conn.clone();
    tokio::task::spawn_blocking(move || {
        let hosts = match conn.via {
            Some(_) => crate::ssh_config::load_default()?.hosts,
            None => Vec::new(),
        };
        table::resolve_conn(conn, |alias| hosts.iter().any(|h| super::conns::same_alias(&h.name, alias)))
    })
    .await
    .map_err(|_| "The database task failed (worker thread)".to_string())?
}

/// 볼트 차례의 비밀 — 경유 SSH 는 무인 관문(볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만).
pub(super) fn secrets_for(grant: &Grant, src: &PasswordSource) -> OpenSecrets {
    OpenSecrets {
        password: src.body(),
        ssh: SharedCreds {
            unattended: Some(Unattended {
                vault_passphrase: grant.via_vault_passphrase,
            }),
            ..Default::default()
        },
        // AI 연결의 비밀번호 자리는 볼트뿐이다(`PasswordSource` — 몸에 실린 값이 없으면 볼트).
        vault: true,
        from_vault: false,
    }
}

/// `[이유] 문구` 의 이유 표지를 뗀다(AI 에게는 사람 문구만).
pub(super) fn plain(m: &str) -> String {
    let mut rest = m;
    while let Some((_, tail)) = rest.strip_prefix('[').and_then(|r| r.split_once("] ")) {
        rest = tail;
    }
    rest.to_string()
}

/// 볼트의 지금 상태 — AI 문구만 가른다(값은 보지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VaultNow {
    /// 열려 있다(이 연결의 값은 없다).
    Open,
    /// 잠겼다(가림막 · 창 0개 · 마스터 미입력).
    Locked,
    /// 볼트 파일이 없다(켜지 않았다).
    Absent,
}

fn vault_now() -> VaultNow {
    match crate::server::hub::vault().map(|v| v.status().state) {
        Some("unlocked") => VaultNow::Open,
        Some("locked") => VaultNow::Locked,
        _ => VaultNow::Absent,
    }
}

fn tile_reason(missing: Option<Missing>) -> &'static str {
    match missing {
        Some(Missing::TileClosed) => "no query tile in the aynx app has this connection open",
        Some(Missing::TargetChanged) => {
            "the connection's target changed since the query tile connected, so the password borrowed from it was discarded"
        }
        Some(Missing::Rejected) => "the database rejected the password borrowed from the query tile, so it was discarded",
        Some(Missing::NoPassword) | None => "the open query tile connected without a password, so there is none to borrow",
    }
}

/// 볼트는 보지 않았다 — 잠김 · 값 없음을 말하지 않는다.
pub(super) fn headless_off_text(missing: Option<Missing>) -> String {
    let tile = tile_reason(missing);
    let open = if missing == Some(Missing::TileClosed) { "open it in a query tile" } else { "reconnect it in a query tile" };
    format!(
        "This connection needs a database password: {tile}, and the user has not allowed AI to open this connection without a query tile \
         (headless access is off), so the vault was not used — ask the user to {open}, or to turn on 'Headless connection' on the \
         connection form's AI access tab. While a person keeps the connection open in a query tile, AI connections reuse the password that \
         tile authenticated with — the AI never types passwords."
    )
}

/// 비밀번호 · 볼트를 말하지 않는다.
pub(crate) fn headless_off_sqlite_text() -> String {
    "No query tile in the aynx app has this SQLite connection open, and the user has not allowed AI to open it without a query tile \
     (headless access is off), so the file was not opened — ask the user to open it in a query tile, or to turn on 'AI access without a \
     tile' in the connection form (AI permission). While a person keeps it open in a query tile, AI connections can open it."
        .into()
}

pub(super) fn no_password_text(missing: Option<Missing>, vault: VaultNow) -> String {
    const NEVER: &str = "the AI never types passwords";
    let tile = tile_reason(missing);
    let store = match vault {
        VaultNow::Open => "no password for it is stored in the vault",
        VaultNow::Locked => "the vault is locked",
        VaultNow::Absent => "no vault is set up",
    };
    let open = if missing == Some(Missing::TileClosed) { "open it in a query tile" } else { "reconnect it in a query tile" };
    let ask = match vault {
        VaultNow::Locked => format!("ask the user to {open} or unlock aynx"),
        _ => format!("ask the user to {open}, or to save the password to the vault for continued use"),
    };
    format!(
        "This connection needs a database password: {tile}, and {store} — {ask}. While a person keeps the connection open in a query tile, \
         AI connections reuse the password that tile authenticated with (typed or from the vault), also while aynx is locked — {NEVER}."
    )
}
// 비밀번호 · SSH 관문 실패는 "사람이 해야 하는 일" 로 바꿔 말한다(AI 가 읽는 영어).
pub(crate) fn open_error_text(e: OpenError, via: Option<&str>, conn_id: &str) -> String {
    match e {
        OpenError::Msg(m) if has_reason(&m, DB_STORED_REJECTED) => format!(
            "The database rejected the password stored in the vault ({}). A person has to reconnect in a query tile in the aynx \
             app and save the new password to the vault.",
            plain(&m)
        ),
        // MySQL 은 없는 비밀번호도 인증 실패(`[db-auth]`)로 온다.
        OpenError::Msg(m) if has_reason(&m, DB_PASSWORD) || has_reason(&m, DB_AUTH) => {
            no_password_text(borrowed::missing(conn_id), vault_now())
        }
        OpenError::Msg(m) => plain(&m),
        OpenError::Ssh(s) => {
            let host = via.unwrap_or("?");
            let why = match s {
                SshOpenError::HostKeyUnknown { .. } => "its SSH host key is not known yet".to_string(),
                SshOpenError::HostKeyChanged { .. } => "its SSH host key has changed".to_string(),
                SshOpenError::PassphraseRequired { .. } => "the SSH key needs a passphrase (turn on 'Use the key passphrase from the \
                     vault' for that host's AI permission, or add the key to ssh-agent)"
                    .to_string(),
                SshOpenError::PasswordRequired { .. } | SshOpenError::Auth { .. } => {
                    "it needs an SSH password, which an AI connection never uses".to_string()
                }
                SshOpenError::Other { message, .. } => plain(&message),
            };
            format!(
                "The jump host '{host}' could not be reached without a person: {why}. Ask the user to connect to that host once from a \
                 terminal tile in aynx (an open connection is shared), then try again."
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

/// 사람 표와 같은 시한 그물(`table::run_timed`)로 돌린다.
macro_rules! on_engine {
    ($engine:expr, $ms:expr, $s:ident => $sq:expr, $p:ident => $pq:expr, $m:ident => $mq:expr) => {{
        let task = match $engine.clone() {
            Engine::Sqlite($s) => tokio::task::spawn_blocking(move || $sq),
            Engine::Pg($p) => tokio::spawn(async move { $pq }),
            Engine::Mysql($m) => tokio::spawn(async move { $mq }),
        };
        let (r, timed_out) = table::run_timed(&$engine, Duration::from_millis($ms), task, None).await;
        r.map_err(|e| plain(&table::message(e, timed_out, false, $ms)))
    }};
}

fn level_text(have: DbAiLevel, need: DbAiLevel) -> String {
    format!(
        "This connection's AI permission is '{}' — this tool needs '{}' or higher. Only the user can change it, in the app (database \
         connection form › AI permission).",
        have.name(),
        need.name()
    )
}

pub(crate) async fn run(grant: &Grant, req: AiRequest, src: &PasswordSource) -> Result<AiOutcome, String> {
    if grant.level < req.needs() {
        return Err(level_text(grant.level, req.needs()));
    }
    let c = acquire(grant, src).await?;
    if c.busy.swap(true, Ordering::SeqCst) {
        return Err(busy_text());
    }
    let _busy = BusyGuard(Arc::clone(&c));
    let engine = c.engine.clone();
    if engine.writable() {
        return Err("refused: the AI connection is not read-only".into());
    }
    let out = match req {
        AiRequest::Schemas => {
            let ms = META_TIMEOUT_MS;
            let v = on_engine!(engine, ms, s => s.schema(), p => p.schema(ms).await, m => m.schema(ms).await)?;
            let rows = v.get("schemas").and_then(Value::as_array).map(|a| a.len() as u64);
            AiOutcome { value: v, rows }
        }
        AiRequest::Objects { schema } => {
            let ms = META_TIMEOUT_MS;
            let v = on_engine!(engine, ms,
                s => s.objects(schema.as_deref()),
                p => p.objects(schema.as_deref(), ms).await,
                m => m.objects(schema.as_deref(), ms).await)?;
            let v = cap_objects(v);
            let rows = v.get("objects").and_then(Value::as_array).map(|a| a.len() as u64);
            AiOutcome { value: v, rows }
        }
        AiRequest::Describe { schema, table } => {
            let ms = META_TIMEOUT_MS;
            let v = on_engine!(engine, ms,
                s => s.table_detail(schema.as_deref(), &table),
                p => p.table_detail(schema.as_deref(), &table, ms).await,
                m => m.table_detail(schema.as_deref(), &table, ms).await)?;
            let v = cap_describe(v);
            let rows = v.get("columns").and_then(Value::as_array).map(|a| a.len() as u64);
            AiOutcome { value: v, rows }
        }
        AiRequest::Definition(target) => {
            let ms = META_TIMEOUT_MS;
            let v = on_engine!(engine, ms,
                s => s.definition(&target),
                p => p.definition(&target, ms).await,
                m => m.definition(&target, ms).await)?;
            AiOutcome { value: cap_definition(v), rows: None }
        }
        AiRequest::Query { sql, max_rows, timeout_ms } => query(&engine, &sql, max_rows, timeout_ms).await?,
    };
    fit(out)
}

async fn query(engine: &Engine, sql: &str, max_rows: usize, ms: u64) -> Result<AiOutcome, String> {
    if sql.len() > SQL_MAX {
        return Err(format!("The SQL is too long (at most {} KiB)", SQL_MAX / 1024));
    }
    let max_rows = max_rows.clamp(1, ROWS_MAX);
    // 가드를 읽기 전용 모드로(엔진의 쓰기 플래그와 무관하게) 먼저 지난다 — 엔진도 단문 길에서 한 번 더 본다.
    let plan = script::plan(sql, engine.dialect(), ScriptMode::ReadOnly).map_err(|e| plan_error_text(&e))?;
    let started = Instant::now();
    if let [one] = plan.as_slice() {
        let stmt = one.text().to_string();
        let out = on_engine!(engine, ms,
            s => s.query(&stmt, max_rows),
            p => p.query(&stmt, max_rows, ms).await,
            m => m.query(&stmt, max_rows, ms).await)
        .map_err(|m| read_only_text(&m))?;
        let mut budget = RESPONSE_MAX;
        let (v, n) = shape_query(out, &mut budget);
        return Ok(AiOutcome { value: v, rows: Some(n) });
    }
    let ctl = Arc::new(script::Ctl::new(Arc::new(AtomicBool::new(false)), ms, Duration::from_millis(ms)));
    let run = script::execute(engine.clone(), plan.clone(), ScriptMode::ReadOnly, max_rows, Arc::clone(&ctl))
        .await
        .map_err(|e| plain(&table::message(e, false, false, ms)))?;
    let out = script::report(&plan, run, ScriptMode::ReadOnly, &ctl, ms, started.elapsed().as_millis() as u64);
    let mut budget = RESPONSE_MAX;
    let mut total = 0u64;
    let statements: Vec<Value> = out
        .results
        .into_iter()
        .map(|r| {
            let (mut v, n) = shape_query(r.out, &mut budget);
            total += n;
            v["index"] = json!(r.index);
            v["keyword"] = json!(r.keyword);
            v
        })
        .collect();
    let mut v = json!({
        "script": true,
        "outcome": out.outcome,
        "statementCount": out.total,
        "statements": statements,
        "elapsedMs": out.elapsed_ms,
    });
    if let Some(f) = out.failed {
        v["failed"] = json!({ "index": f.index, "message": read_only_text(&f.message) });
    }
    if let Some(m) = out.message {
        v["message"] = json!(m);
    }
    if let Some(r) = out.reason {
        v["reason"] = json!(r);
    }
    Ok(AiOutcome { value: v, rows: Some(total) })
}

/// 사람 타일의 "쓰기를 켜라" 안내는 AI 연결에 뜻이 없다 — 사람의 쓰기 모드는 AI 에 번지지 않는다.
const AI_READ_ONLY: &str = "db_query is read-only: statements that change data never run on the AI connection (the user's query tile write mode does not apply to it, and this server has no write tools).";

/// 엔진이 사람 타일에 내는 안내 줄(두 언어)과 글자 그대로 같아야 AI 문구로 바뀐다.
fn read_only_text(m: &str) -> String {
    const TILE_HINTS: [&str; 2] = [
        "읽기 전용 모드에서는 데이터를 바꾸는 문장을 실행하지 않습니다 — 위 띠의 '읽기 전용'을 눌러 쓰기를 켠 뒤 실행하세요",
        "Statements that change data do not run in read-only mode — click 'Read-only' in the bar above to turn on writing first",
    ];
    let mut out = m.to_string();
    for h in TILE_HINTS {
        out = out.replace(h, AI_READ_ONLY);
    }
    out
}

fn plan_error_text(e: &script::PlanError) -> String {
    use super::guard::GuardError;
    match e {
        script::PlanError::Statement { index, err: GuardError::ReadOnly { keyword, dialect }, .. } => {
            let allowed = match dialect {
                super::Dialect::Postgres => "SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW",
                super::Dialect::Mysql => "SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW, DESCRIBE, DESC",
                super::Dialect::Sqlite => "SELECT, WITH, VALUES, EXPLAIN, read-only PRAGMA",
            };
            let word = if keyword.is_empty() { "this statement".to_string() } else { format!("'{keyword}'") };
            format!("Statement {}: {AI_READ_ONLY} {word} is not a read statement — only {allowed} run here.", index + 1)
        }
        script::PlanError::Statement { index, err: GuardError::IntoFile, .. } => {
            format!("Statement {}: {AI_READ_ONLY} INTO OUTFILE/DUMPFILE writes a file on the server.", index + 1)
        }
        other => other.message(),
    }
}

fn cut(s: &str, max: usize) -> Option<String> {
    if s.len() <= max {
        return None;
    }
    let mut at = max;
    while !s.is_char_boundary(at) {
        at -= 1;
    }
    Some(s[..at].to_string())
}

fn cap_cell(v: &mut Value) -> bool {
    match v {
        Value::String(s) => match cut(s, CELL_MAX) {
            Some(short) => {
                *s = short;
                true
            }
            None => false,
        },
        _ => false,
    }
}

/// `(값, 실은 행 수)` — 예산은 여러 문장이 나눠 쓴다.
pub(crate) fn shape_query(out: QueryOut, budget: &mut usize) -> (Value, u64) {
    let mut cell_truncated = out.cell_truncated;
    let mut truncated = out.truncated;
    let mut rows: Vec<Vec<Value>> = Vec::with_capacity(out.rows.len());
    let head = serde_json::to_string(&out.columns).map(|s| s.len()).unwrap_or(0) + 128;
    *budget = budget.saturating_sub(head);
    for mut row in out.rows {
        for cell in row.iter_mut() {
            cell_truncated |= cap_cell(cell);
        }
        let size = serde_json::to_string(&row).map(|s| s.len()).unwrap_or(0) + 1;
        if size > *budget {
            truncated = true;
            break;
        }
        *budget -= size;
        rows.push(row);
    }
    let n = rows.len() as u64;
    let mut v = json!({
        "columns": out.columns,
        "rows": rows,
        "rowCount": n,
        "truncated": truncated,
        "cellTruncated": cell_truncated,
        "elapsedMs": out.elapsed_ms,
    });
    if let Some(a) = out.affected {
        v["affected"] = json!(a);
    }
    (v, n)
}

/// 설명 · 추정 행 수는 사람 화면 전용이라 지운다 — MCP `db_list_objects` 의 출력 모양과 상한은 그대로.
pub(crate) fn cap_objects(mut v: Value) -> Value {
    let capped = match v.get_mut("objects").and_then(Value::as_array_mut) {
        Some(a) => {
            for o in a.iter_mut().filter_map(Value::as_object_mut) {
                o.remove("comment");
                o.remove("rows");
            }
            let over = a.len() > OBJECTS_MAX;
            a.truncate(OBJECTS_MAX);
            over
        }
        None => false,
    };
    if capped {
        v["objectsCapped"] = json!(true);
    }
    v
}

/// 테이블 · 컬럼 설명은 사람 화면 전용이라 지운다 — MCP `db_describe_table` 의 출력 모양은 그대로.
pub(crate) fn cap_describe(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.remove("comment");
    }
    if let Some(a) = v.get_mut("columns").and_then(Value::as_array_mut) {
        for c in a.iter_mut().filter_map(Value::as_object_mut) {
            c.remove("comment");
        }
    }
    v
}

pub(crate) fn cap_definition(mut v: Value) -> Value {
    let short = v.get("sql").and_then(Value::as_str).and_then(|s| cut(s, DEFINITION_MAX));
    if let Some(s) = short {
        v["sql"] = json!(s);
        v["truncated"] = json!(true);
    }
    v
}

/// 마지막 그물 — 구조 도구 응답이 넘치면 한 스키마 · 한 테이블로 좁히라고 오류를 낸다.
fn fit(out: AiOutcome) -> Result<AiOutcome, String> {
    let size = serde_json::to_string(&out.value).map(|s| s.len()).unwrap_or(0);
    if size > RESPONSE_MAX + 4096 {
        return Err(format!(
            "The result is larger than {} KiB — narrow the request (one schema, one table, or fewer columns/rows)",
            RESPONSE_MAX / 1024
        ));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// MCP 쪽에서 보는 뒷면 — 제품은 [`Live`], 시험은 가짜를 꽂는다
// ---------------------------------------------------------------------------

/// MCP(`mcp::db`)가 DB 평면에 닿는 유일한 표면 — 판정(`authorize`)은 MCP 가 파일을 읽어 하고, 이 뒷면은 증표를 받은 일만 한다.
pub(crate) trait AiDb: Send + Sync {
    /// 서버가 파일에서 직접 — 비밀 없음.
    fn connections(&self) -> Vec<DbConn>;
    /// 경유 별칭이 지금 가리키는 SSH 서버(`user@host:port` — 못 펴면 `None`).
    fn via_target(&self, alias: &str) -> Option<String>;
    /// 블로킹 — MCP 요청 스레드가 부른다.
    fn run(&self, grant: &Grant, req: AiRequest) -> Result<AiOutcome, String>;
    /// 결과 값 없음.
    fn audit(&self, rec: AuditRecord);
}

/// 요청 스레드는 std 스레드라 세션 서버 런타임에 맡기고 바깥 시한(도구 시한 + [`CALL_GRACE`])까지만 기다린다.
pub(crate) struct Live {
    rt: tokio::runtime::Handle,
    audit: Option<mpsc::Sender<AuditRecord>>,
}

impl Live {
    pub(crate) fn new(rt: tokio::runtime::Handle, audit: Option<mpsc::Sender<AuditRecord>>) -> Live {
        Live { rt, audit }
    }
}

impl AiDb for Live {
    fn connections(&self) -> Vec<DbConn> {
        super::conns::path()
            .and_then(|p| super::conns::load_at(&p).ok())
            .map(|l| l.conns)
            .unwrap_or_default()
    }

    fn via_target(&self, alias: &str) -> Option<String> {
        crate::delegation::database::current_via_target(alias)
    }

    fn run(&self, grant: &Grant, req: AiRequest) -> Result<AiOutcome, String> {
        let limit = Duration::from_millis(req.timeout_ms()) + CALL_GRACE;
        self.rt
            .block_on(async { tokio::time::timeout(limit, run(grant, req, &PasswordSource::Vault)).await })
            .unwrap_or_else(|_| Err(format!("The database did not answer within {} s", limit.as_secs())))
    }

    fn audit(&self, rec: AuditRecord) {
        if let Some(tx) = &self.audit {
            let _ = tx.send(rec);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ColumnOut;

    #[test]
    fn query_limits_clamp() {
        assert_eq!(clamp_query(None, None), (50, 15_000));
        assert_eq!(clamp_query(Some(0), Some(0)), (1, 1000));
        assert_eq!(clamp_query(Some(10_000), Some(3600)), (500, 60_000));
        assert_eq!(clamp_query(Some(120), Some(30)), (120, 30_000));
    }

    #[test]
    fn shape_caps_cells_and_response() {
        let big = "가".repeat(1000); // 3000 바이트
        let out = QueryOut {
            columns: vec![ColumnOut { name: "t".into(), ty: "text".into() }],
            rows: (0..400).map(|_| vec![json!(big)]).collect(),
            truncated: false,
            cell_truncated: false,
            affected: None,
            elapsed_ms: 3,
            tx: None,
        };
        let mut budget = RESPONSE_MAX;
        let (v, n) = shape_query(out, &mut budget);
        assert!(v["cellTruncated"].as_bool().unwrap());
        let first = v["rows"][0][0].as_str().unwrap();
        assert!(first.len() <= CELL_MAX && first.len() > CELL_MAX - 3);
        // 칸 하나 ≈ 1 KiB 라 256 KiB 예산 안에 400행이 다 들지 않는다.
        assert!(v["truncated"].as_bool().unwrap());
        assert!(n < 400 && n > 200, "{n}");
        assert!(serde_json::to_string(&v).unwrap().len() <= RESPONSE_MAX + 1024);
    }

    #[test]
    fn objects_and_definition_caps() {
        let objs: Vec<Value> = (0..600).map(|i| json!({ "kind": "table", "name": format!("t{i}") })).collect();
        let v = cap_objects(json!({ "objects": objs, "truncated": [] }));
        assert_eq!(v["objects"].as_array().unwrap().len(), OBJECTS_MAX);
        assert_eq!(v["objectsCapped"], json!(true));
        let small = cap_objects(json!({ "objects": [], "truncated": [] }));
        assert!(small.get("objectsCapped").is_none());
        // 설명 · 추정 행 수는 AI 쪽에 없다.
        let o = cap_objects(json!({
            "objects": [{ "kind": "table", "name": "t", "sub": "partitioned", "comment": "고객", "rows": 12 }],
            "truncated": []
        }));
        assert_eq!(o["objects"], json!([{ "kind": "table", "name": "t", "sub": "partitioned" }]));
        assert!(o.get("objectsCapped").is_none());
        // 테이블 · 컬럼 설명도 AI 쪽에 없다.
        let t = cap_describe(json!({
            "comment": "고객",
            "columns": [
                { "name": "id", "type": "int", "notNull": true, "default": null, "pk": 1, "comment": "번호" },
                { "name": "n", "type": "text", "notNull": false, "default": null, "pk": 0 }
            ],
            "indexes": [],
            "truncated": []
        }));
        assert_eq!(
            t,
            json!({
                "columns": [
                    { "name": "id", "type": "int", "notNull": true, "default": null, "pk": 1 },
                    { "name": "n", "type": "text", "notNull": false, "default": null, "pk": 0 }
                ],
                "indexes": [],
                "truncated": []
            })
        );
        let d = cap_definition(json!({ "sql": "x".repeat(DEFINITION_MAX + 10), "reconstructed": false, "truncated": false }));
        assert_eq!(d["sql"].as_str().unwrap().len(), DEFINITION_MAX);
        assert_eq!(d["truncated"], json!(true));
    }

    #[test]
    fn error_texts_drop_reason_tags() {
        assert_eq!(plain("[db-auth] 거절"), "거절");
        assert_eq!(plain("[db-auth] [db-stored-rejected] 거절"), "거절");
        assert_eq!(plain("그냥"), "그냥");
        let t = open_error_text(OpenError::Ssh(SshOpenError::other("x".to_string())), Some("web-01"), "Abc_none0001");
        assert!(t.contains("web-01") && t.contains("terminal tile"), "{t}");
    }

    #[test]
    fn headless_off_text_is_its_own() {
        for m in [Some(Missing::TileClosed), Some(Missing::TargetChanged), Some(Missing::Rejected), Some(Missing::NoPassword)] {
            let t = headless_off_text(m);
            assert!(t.contains("headless access is off") && t.contains("'Headless connection'") && t.contains("the vault was not used"), "{t}");
            assert!(!t.contains("vault is locked") && !t.contains("stored in the vault") && !t.contains("no vault is set up") && !t.contains("unlock"), "{t}");
            assert!(t.contains(tile_reason(m)) && t.contains("the AI never types passwords"), "{t}");
            for v in [VaultNow::Open, VaultNow::Locked, VaultNow::Absent] {
                assert_ne!(t, no_password_text(m, v));
            }
        }
        assert!(headless_off_text(Some(Missing::TileClosed)).contains("ask the user to open it in a query tile"));
        assert!(headless_off_text(Some(Missing::Rejected)).contains("ask the user to reconnect it in a query tile"));
    }

    #[test]
    fn no_password_texts_tell_the_reason() {
        let closed_locked = no_password_text(Some(Missing::TileClosed), VaultNow::Locked);
        assert!(
            closed_locked.contains("no query tile in the aynx app has this connection open, and the vault is locked")
                && closed_locked.contains("ask the user to open it in a query tile or unlock aynx"),
            "{closed_locked}"
        );
        let closed = no_password_text(Some(Missing::TileClosed), VaultNow::Open);
        assert!(closed.contains("no password for it is stored in the vault") && closed.contains("save the password to the vault"), "{closed}");
        assert!(!closed.contains("unlock"), "{closed}");
        let absent = no_password_text(Some(Missing::TileClosed), VaultNow::Absent);
        assert!(absent.contains("no vault is set up") && !absent.contains("unlock"), "{absent}");
        let moved = no_password_text(Some(Missing::TargetChanged), VaultNow::Open);
        assert!(moved.contains("target changed since the query tile connected") && moved.contains("reconnect it in a query tile"), "{moved}");
        let rejected = no_password_text(Some(Missing::Rejected), VaultNow::Locked);
        assert!(rejected.contains("database rejected the password borrowed") && rejected.contains("reconnect it in a query tile or unlock aynx"), "{rejected}");
        let none = no_password_text(Some(Missing::NoPassword), VaultNow::Open);
        assert!(none.contains("connected without a password"), "{none}");
        assert_eq!(no_password_text(None, VaultNow::Open), none);
        let all = [&closed, &moved, &rejected, &none];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a.split(", and ").next(), b.split(", and ").next(), "까닭마다 첫머리가 다르다");
            }
        }
        for t in [&closed_locked, &closed, &absent, &moved, &rejected, &none] {
            assert!(t.contains("the AI never types passwords") && t.contains("typed or from the vault") && t.contains("also while aynx is locked"), "{t}");
            assert!(!t.contains("paused") && !t.contains("resumes"), "정지 · 이어짐은 없다: {t}");
        }
    }
}
