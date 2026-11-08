//! **AI 의 DB 평면**(쿼리 타일 3단계 3a — docs/log/2026-10-13-db-write-mcp-design.md B-3 ~ B-5 · D5) — 세션 서버의 MCP(`mcp::db`)가
//! 부르는 **유일한 입구**다. 사람 타일의 연결 표(`table`)와 따로 산다.
//!
//! ## 불변식
//!
//! - **권한 판정을 지나야 들어온다** — 입구 [`run`] 은 [`Grant`] 를 받고, `Grant` 는 [`authorize`] 만 만든다(칸 비공개). `authorize` 는
//!   `delegation.toml` `[[database]]` 의 단계 + 신원 스냅샷(`Delegation::db_level`)을 본다. `run` 은 요청이 바라는 단계를 한 번 더 본다.
//! - **AI 전용 연결** — 연결 id 하나에 연결 하나(이 모듈의 풀). 사람 타일의 연결(`table` 의 표 · 타일 `stream` · 트랜잭션 작업)에 닿는
//!   길이 없다(시험 `db_ai_never_touches_tile_entries` 가 소스를 훑는다) — AI 문장이 사람의 열린 트랜잭션 안에서 돌거나 사람이 켠 쓰기
//!   모드가 AI 에 번지는 일이 없다(D5).
//! - **늘 읽기 전용** — 연결은 읽기 전용으로 열고(SQLite 읽기 전용 열기 · PG/MySQL 은 쓰기 플래그를 켜는 함수를 이 모듈이 부르지 않는다),
//!   조회는 가드의 읽기 전용 모드(`script::plan(…, ScriptMode::ReadOnly)` — 문장마다 첫 낱말 허용 목록) → 엔진 `READ ONLY` 트랜잭션.
//!   열린 연결이 쓰기 가능으로 보이면 쓰지 않고 거절한다(그물). 시험 `db_ai_connections_are_read_only_forever`.
//! - **비밀번호는 볼트에서만**(`net::password_for(None, id)` — 세션 서버 안 · 값이 이 모듈 밖으로 나가지 않는다). AI 는 비밀번호를 칠 수
//!   없으므로 없거나 볼트가 잠겼으면 "사람이 쿼리 타일에서 한 번 열어 저장" 안내 오류.
//! - **경유 SSH 는 헤드리스 규칙**(`SharedCreds::unattended`) — 사람의 답을 받지 않고(호스트 키 · 비밀번호 · 암호구), 볼트의 SSH 비밀번호를
//!   쓰지 않으며, 볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만. 사람이 이미 연 같은 호스트의 공유 전송로에는 그대로
//!   얹힌다(인증 없음).
//! - **세션 코어 · 떨어진 세션 목록에 오르지 않는다**(DB 평면 불변 그대로) · 로그에 SQL · 결과가 없다.
//!
//! ## 수명
//!
//! | 사건 | AI 연결 |
//! |---|---|
//! | 도구 호출 | 있으면 다시 쓰고(신원 스냅샷이 같고 살아 있을 때) 없으면 연다 |
//! | 무활동 [`IDLE_CLOSE`](5분) | 닫는다(시계 하나 — [`ensure_reaper`]) — 비밀번호를 오래 쥔 연결 · SSH 핀을 남기지 않는다 |
//! | 연결 정의가 바뀜(주소 · 경유 …) | 다음 호출이 옛것을 닫고 새로 연다(권한은 스냅샷이 이미 끔으로 읽는다) |
//! | 끊김(전송로 사망 · 서버가 끊음) | 다음 호출이 새로 연다(화면 이벤트 없음 — 타일이 아니다) |
//! | 서버 끝 | 닫는다([`close_all`] — `serve::run` 끝) |
//!
//! 근거(5분): 도구 호출은 한 대화 안에서 몰려 온다(구조 → 조회 몇 번) — 매번 열면 SSH 경유 · TLS 접속이 호출마다 붙는다. 길게 쥐면
//! 풀러의 서버 연결 · SSH 핀 · 사람이 지운 볼트 값으로 연 연결이 남는다. 쿼리 타일의 떼어 두기 TTL(10분)의 절반.
//!
//! ## 상한(B-4)
//!
//! 행 기본 [`ROWS_DEFAULT`] · 최대 [`ROWS_MAX`] · 칸 [`CELL_MAX`] · 응답 [`RESPONSE_MAX`] · 시간 기본 [`TIMEOUT_DEFAULT_MS`] · 최대
//! [`TIMEOUT_MAX_MS`] · 객체 목록 [`OBJECTS_MAX`] · DDL [`DEFINITION_MAX`] · 연결 하나에 AI 조회 하나(돌면 곧바로 `busy`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

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
/// `db_query` 의 기본 행 상한.
pub(crate) const ROWS_DEFAULT: usize = 50;
/// `db_query` 행 상한의 최대.
pub(crate) const ROWS_MAX: usize = 500;
/// 칸 하나의 글자 상한(바이트) — 넘으면 글자 경계에서 자르고 `cellTruncated`.
pub(crate) const CELL_MAX: usize = 1024;
/// 응답 하나(도구 결과 JSON)의 상한 — 행은 넘기 전에서 끊고 `truncated`.
pub(crate) const RESPONSE_MAX: usize = 256 * 1024;
/// `db_query` 의 기본 시간 제한.
pub(crate) const TIMEOUT_DEFAULT_MS: u64 = 15_000;
/// `db_query` 시간 제한의 최대.
pub(crate) const TIMEOUT_MAX_MS: u64 = 60_000;
/// 구조 도구(스키마 · 객체 · 구조 · DDL)의 시간 제한(고정).
pub(crate) const META_TIMEOUT_MS: u64 = 15_000;
/// `db_list_objects` 의 상한(사람 트리는 5000).
pub(crate) const OBJECTS_MAX: usize = 500;
/// `db_get_definition` 의 상한(사람 보기는 1 MiB).
pub(crate) const DEFINITION_MAX: usize = 64 * 1024;
/// `db_query` 문장 글자의 상한.
pub(crate) const SQL_MAX: usize = 64 * 1024;
/// 무활동이면 닫는 시간.
pub(crate) const IDLE_CLOSE: Duration = Duration::from_secs(300);
/// 도구 하나의 바깥 시한 여유 — 표의 그물(시한 + 2초 · 끊은 뒤 5초)과 접속(15초)보다 넉넉히. MCP 요청 스레드가 무한히 묶이지 않게.
pub(crate) const CALL_GRACE: Duration = Duration::from_secs(20);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// 권한 — 판정을 지난 증표
// ---------------------------------------------------------------------------

/// 권한 판정을 지난 증표 — [`authorize`] 만 만든다(칸이 이 모듈 밖에서 비공개). [`run`] 은 이것 없이는 부를 수 없다.
pub(crate) struct Grant {
    conn: DbConn,
    level: DbAiLevel,
    /// 경유 별칭이 지금 가리키는 곳(스냅샷 비교에 쓴 값 — 풀의 지문).
    via_target: Option<String>,
    /// 경유 호스트에 `vault_passphrase` 위임이 있다(헤드리스 규칙).
    via_vault_passphrase: bool,
}

/// 시험 전용 — 증표의 연결 id.
#[cfg(test)]
pub(crate) fn grant_conn_id_for_test(g: &Grant) -> String {
    g.conn.id.clone()
}

impl Grant {
    /// 판정을 지난 연결(읽기만 — 증표는 여전히 [`authorize`] 만 만든다).
    pub(crate) fn conn(&self) -> &DbConn {
        &self.conn
    }

    /// 판정 때의 단계.
    pub(crate) fn level(&self) -> DbAiLevel {
        self.level
    }

    /// 이 연결의 신원 스냅샷(판정 때의 연결 + 경유 대상) — 3b 작업안이 만들 때 떠 두고 실행 직전에 다시 맞춘다.
    pub(crate) fn identity(&self) -> DbIdentity {
        DbIdentity::of(&self.conn, self.via_target.clone())
    }
}

/// 판정 거절.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Denied {
    /// 권한이 끔이거나 스냅샷이 어긋났다 — AI 에게는 **없는 연결과 같은 말**을 한다(있다는 것도 알리지 않는다).
    Off,
    /// 단계가 모자란다(지금 단계).
    Below(DbAiLevel),
}

/// **권한 판정** — 그 연결의 단계(+ 신원 스냅샷)가 `need` 이상이면 증표. `via_target` = 경유 별칭이 지금 가리키는 곳. **순수.**
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
    })
}

// ---------------------------------------------------------------------------
// 요청
// ---------------------------------------------------------------------------

/// AI 의 요청 하나.
#[derive(Debug, Clone)]
pub(crate) enum AiRequest {
    Schemas,
    Objects { schema: Option<String> },
    Describe { schema: Option<String>, table: String },
    Definition(DefTarget),
    /// 문장 하나 — 여럿이면 2단계 실행기의 **읽기 모드 스크립트**(한 `READ ONLY` 트랜잭션 · 첫 오류에서 멈춤).
    Query { sql: String, max_rows: usize, timeout_ms: u64 },
}

impl AiRequest {
    /// 바라는 단계.
    pub(crate) fn needs(&self) -> DbAiLevel {
        match self {
            AiRequest::Query { .. } => DbAiLevel::Read,
            _ => DbAiLevel::Schema,
        }
    }

    /// 엔진 일의 시한.
    pub(crate) fn timeout_ms(&self) -> u64 {
        match self {
            AiRequest::Query { timeout_ms, .. } => *timeout_ms,
            _ => META_TIMEOUT_MS,
        }
    }
}

/// 요청 상한을 다듬는다 — 행(1..=[`ROWS_MAX`], 없으면 [`ROWS_DEFAULT`]) · 시간 초(1..=60, 없으면 15) → ms. **순수.**
pub(crate) fn clamp_query(max_rows: Option<u64>, timeout_seconds: Option<u64>) -> (usize, u64) {
    let rows = max_rows.map(|n| (n as usize).clamp(1, ROWS_MAX)).unwrap_or(ROWS_DEFAULT);
    let ms = timeout_seconds
        .map(|s| s.saturating_mul(1000).clamp(1000, TIMEOUT_MAX_MS))
        .unwrap_or(TIMEOUT_DEFAULT_MS);
    (rows, ms)
}

/// 한 번의 결과 — 도구가 돌려줄 값과 감사에 남길 행 수.
#[derive(Debug, Clone)]
pub(crate) struct AiOutcome {
    pub value: Value,
    pub rows: Option<u64>,
}

/// 비밀번호를 어디서 — 제품은 늘 볼트(시험만 값을 직접 준다 — 사용자 볼트를 건드리지 않게).
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
}

static POOL: LazyLock<Mutex<HashMap<String, Arc<AiConn>>>> = LazyLock::new(Default::default);
/// 여는 일을 줄 세운다(같은 연결을 두 번 열지 않게 — AI 호출은 드물어 연결마다 문을 둘 까닭이 없다).
static OPEN_GATE: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(Default::default);
static REAPER: AtomicBool = AtomicBool::new(false);

/// 바쁨 표시를 지운다.
struct BusyGuard(Arc<AiConn>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        *lock(&self.0.last_used) = Instant::now();
        self.0.busy.store(false, Ordering::SeqCst);
    }
}

fn busy_text() -> String {
    "Another AI query is running on this connection — wait for it to finish (one AI query per connection at a time)".into()
}

/// 무활동 연결을 닫는다(돌고 있는 것 · `now` 기준 [`IDLE_CLOSE`] 안 쓴 것) — 닫은 수.
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

/// 모두 닫는다(서버 끝). 닫은 수.
pub(crate) fn close_all() -> usize {
    let all: Vec<Arc<AiConn>> = lock(&POOL).drain().map(|(_, c)| c).collect();
    for c in &all {
        c.engine.shutdown();
    }
    all.len()
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

/// 지금 열린 AI 연결 수(서버 `status`).
pub(crate) fn live_count() -> usize {
    lock(&POOL).len()
}

/// 무활동 시계 — 처음 연 때 한 번 띄운다(30초마다 [`close_idle`]).
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

/// 연결을 빌린다 — 같은 스냅샷의 살아 있는 것이 있으면 그것, 아니면 연다.
async fn acquire(grant: &Grant, src: &PasswordSource) -> Result<Arc<AiConn>, String> {
    let ident = DbIdentity::of(&grant.conn, grant.via_target.clone());
    let reuse = |ident: &DbIdentity| -> Option<Arc<AiConn>> {
        let mut p = lock(&POOL);
        let c = p.get(&grant.conn.id)?.clone();
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
    let engine = open_engine(grant, src).await?;
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
    });
    if let Some(old) = lock(&POOL).insert(grant.conn.id.clone(), Arc::clone(&c)) {
        old.engine.shutdown();
    }
    ensure_reaper();
    Ok(c)
}

/// 이 연결의 엔진을 연다(읽기 전용 · 볼트 비밀번호 · 무인 SSH).
async fn open_engine(grant: &Grant, src: &PasswordSource) -> Result<Engine, String> {
    let via = grant.conn.via.clone();
    let resolved = resolve_for(grant).await?;
    let stream = format!("{STREAM_PREFIX}{}", grant.conn.id);
    let secrets = secrets_for(grant, src);
    let opened = match resolved {
        Resolved::Sqlite(path) => {
            // 읽기 전용 열기(`writable = false`) — `SQLITE_OPEN_READ_ONLY` + `query_only`.
            let s = tokio::task::spawn_blocking(move || Sqlite::open(std::path::Path::new(&path), false))
                .await
                .map_err(|_| "The database task failed (worker thread)".to_string())??;
            Ok(Engine::Sqlite(Arc::new(s)))
        }
        Resolved::Pg(t) => Pg::connect(&stream, t, secrets).await.map(|p| Engine::Pg(Arc::new(p))),
        Resolved::Mysql(t) => Mysql::connect(&stream, t, secrets).await.map(|m| Engine::Mysql(Arc::new(m))),
    };
    opened.map_err(|e| open_error_text(e, via.as_deref()))
}

/// 연결 정의를 여는 꼴로 편다(경유 별칭이 `~/.ssh/config` 에 있는지 · 주소 · 파일) — 블로킹 일은 작업 스레드에서. 3b 의 쓰기 연결
/// (`db::ai_write`)도 같은 길을 쓴다.
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

/// 여는 데 쓸 비밀 — 비밀번호는 볼트(시험만 몸으로) · 경유 SSH 는 **무인 관문**(헤드리스 규칙 — 볼트의 키 암호구는 그 호스트에
/// `vault_passphrase` 위임이 있을 때만).
pub(super) fn secrets_for(grant: &Grant, src: &PasswordSource) -> OpenSecrets {
    OpenSecrets {
        password: src.body(),
        ssh: SharedCreds {
            unattended: Some(Unattended {
                vault_passphrase: grant.via_vault_passphrase,
            }),
            ..Default::default()
        },
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

fn vault_unlocked() -> bool {
    crate::server::hub::vault().is_some_and(|v| v.is_unlocked())
}

/// 열기 실패 → AI 가 읽는 문구(영어 — MCP 표면). 비밀번호 · SSH 관문은 "사람이 해야 하는 일" 로 바꾼다.
pub(super) fn open_error_text(e: OpenError, via: Option<&str>) -> String {
    match e {
        // 볼트의 값이 거절됐다(스냅샷 표지 `[db-stored-rejected]`).
        OpenError::Msg(m) if has_reason(&m, DB_STORED_REJECTED) => format!(
            "The database rejected the password stored in the vault ({}). A person has to reconnect in a query tile in the aynx \
             app and save the new password to the vault.",
            plain(&m)
        ),
        // 비밀번호가 없었다(볼트에 없음 · 잠김) — MySQL 은 없는 비밀번호도 인증 실패(`[db-auth]`)로 온다.
        OpenError::Msg(m) if has_reason(&m, DB_PASSWORD) || has_reason(&m, DB_AUTH) => {
            if vault_unlocked() {
                "This connection needs a database password and none is stored for it. A person has to open it once in a query tile \
                 in the aynx app and save the password to the vault — the AI never types passwords."
                    .into()
            } else {
                "This connection needs its database password from the aynx vault, but the vault is locked (it locks while no \
                 aynx window is open or the privacy veil is up) or has not been set up. Ask the user to unlock it in the app — if \
                 no password is stored yet, a person has to open the connection once in a query tile and save it."
                    .into()
            }
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

/// 엔진 하나의 일 — 사람 표와 같은 시한 그물(`table::run_timed`)로. 엔진 오류는 사람 문구로.
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

/// **입구** — 판정을 지난 요청 하나를 그 연결의 AI 전용 연결에서 돌린다.
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

/// 조회 — 읽기 전용 가드(문장마다) → 하나면 엔진의 단문 길, 여럿이면 읽기 모드 스크립트.
async fn query(engine: &Engine, sql: &str, max_rows: usize, ms: u64) -> Result<AiOutcome, String> {
    if sql.len() > SQL_MAX {
        return Err(format!("The SQL is too long (at most {} KiB)", SQL_MAX / 1024));
    }
    let max_rows = max_rows.clamp(1, ROWS_MAX);
    // **늘 읽기 전용** — 가드를 읽기 전용 모드로(엔진의 쓰기 플래그와 무관하게) 먼저 지난다. 엔진도 제 단문 길에서 한 번 더 본다.
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

/// AI 에게 하는 읽기 전용 거절 — 사람 타일의 "위 띠의 '읽기 전용' 을 눌러 쓰기를 켜라" 는 AI 연결에 뜻이 없다(사람의 쓰기 모드는 AI 에
/// 번지지 않는다).
const AI_READ_ONLY: &str = "db_query is read-only: statements that change data never run on the AI connection (the user's query tile write mode does not apply to it, and this server has no write tools).";

/// 엔진이 사람 타일에 하던 읽기 전용 안내 줄(두 언어)을 AI 문구로 바꾼다.
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

/// 계획(가드) 거절 → AI 문구 — 읽기 전용 거절은 AI 말로, 나머지(문장 없음 · 따옴표 · 상한 …)는 그대로.
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

/// 글자를 바이트 상한에서 글자 경계로 자른다.
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

/// 칸 하나의 글자를 [`CELL_MAX`] 로 — 잘랐나.
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

/// 엔진의 결과 → AI 꼴(칸 상한 · 응답 예산) — `(값, 실은 행 수)`. **순수**(예산은 여러 문장이 나눠 쓴다).
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

/// 객체 목록을 [`OBJECTS_MAX`] 로 — 넘으면 `objectsCapped: true`. **순수.**
pub(crate) fn cap_objects(mut v: Value) -> Value {
    let capped = match v.get_mut("objects").and_then(Value::as_array_mut) {
        Some(a) if a.len() > OBJECTS_MAX => {
            a.truncate(OBJECTS_MAX);
            true
        }
        _ => false,
    };
    if capped {
        v["objectsCapped"] = json!(true);
    }
    v
}

/// DDL 글자를 [`DEFINITION_MAX`] 로 — 넘으면 `truncated: true`. **순수.**
pub(crate) fn cap_definition(mut v: Value) -> Value {
    let short = v.get("sql").and_then(Value::as_str).and_then(|s| cut(s, DEFINITION_MAX));
    if let Some(s) = short {
        v["sql"] = json!(s);
        v["truncated"] = json!(true);
    }
    v
}

/// 마지막 그물 — 응답 전체가 [`RESPONSE_MAX`] 를 넘으면 오류(구조 도구 — 한 스키마 · 한 테이블로 좁히라고).
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

/// MCP(`mcp::db`)가 DB 평면에 닿는 **유일한 표면**. 판정(`authorize`)은 MCP 가 파일을 읽어 하고, 이 뒷면은 증표를 받은 일만 한다.
pub(crate) trait AiDb: Send + Sync {
    /// `db-connections.json` 의 연결들(서버가 파일에서 직접 — 비밀 없음).
    fn connections(&self) -> Vec<DbConn>;
    /// 경유 별칭이 지금 가리키는 SSH 서버(`user@host:port` — 못 펴면 `None`).
    fn via_target(&self, alias: &str) -> Option<String>;
    /// 판정을 지난 요청 하나(블로킹 — MCP 요청 스레드가 부른다).
    fn run(&self, grant: &Grant, req: AiRequest) -> Result<AiOutcome, String>;
    /// 감사 한 줄(결과 값 없음).
    fn audit(&self, rec: AuditRecord);
}

/// 제품 뒷면 — 세션 서버 런타임에 일을 맡기고(요청 스레드는 std 스레드다) 바깥 시한(도구 시한 + [`CALL_GRACE`])까지만 기다린다.
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

    /// 상한 자르기 — 칸 1 KiB(글자 경계) · 응답 256 KiB 예산에서 행을 끊는다.
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
        let d = cap_definition(json!({ "sql": "x".repeat(DEFINITION_MAX + 10), "reconstructed": false, "truncated": false }));
        assert_eq!(d["sql"].as_str().unwrap().len(), DEFINITION_MAX);
        assert_eq!(d["truncated"], json!(true));
    }

    #[test]
    fn error_texts_drop_reason_tags() {
        assert_eq!(plain("[db-auth] 거절"), "거절");
        assert_eq!(plain("[db-auth] [db-stored-rejected] 거절"), "거절");
        assert_eq!(plain("그냥"), "그냥");
        let t = open_error_text(OpenError::Ssh(SshOpenError::other("x".to_string())), Some("web-01"));
        assert!(t.contains("web-01") && t.contains("terminal tile"), "{t}");
    }
}
