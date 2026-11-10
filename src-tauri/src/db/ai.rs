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
//! - **비밀번호는 빌린 값 → 볼트**(2026-11-09 사용자 결정 — `db::borrowed`): 그 연결의 사람 쿼리 타일이 비밀번호(친 값 · 볼트 값)로 인증해
//!   붙어 있는 동안은 그 값(세션 서버 메모리)을 먼저 — **볼트 잠금 · 가림막 · 창 0개와 무관하다** — 없으면 볼트(`net::password_for` — 볼트가
//!   열려 있어야 한다). **볼트 차례는 그 연결에 헤드리스 위임(`[[database]] headless` — 타일 없이 AI 접속)이 있을 때만**(2026-11-09 — 사람 없이
//!   새로 여는 것은 명시적 위임) — 없으면 볼트를 읽지 않고(경유 SSH 도 열지 않고) 따로 가른 문구로 실패한다([`headless_off_text`]). 판정은 증표
//!   ([`authorize`] — 호출마다 지금 `delegation.toml`)와 [`open_with`] 한 곳. 빌린 값이 거절되면 그 값을 버리고 (헤드리스면) 볼트로 한 번 더.
//!   값은 세션 서버 안 · 이 모듈 밖으로 나가지 않는다.
//! - **SQLite 도 헤드리스 칸을 따른다**(2026-11-09 사용자 결정 — 비밀번호가 없어도 사람 없이 AI 가 새로 여는 것은 명시적 위임): 그 연결 id 의
//!   사람 쿼리 타일이 서버 표에 있으면(`borrowed` 의 타일 집합 — 엔진 무관 · [`tile_open`]) 칸과 무관하게 열고, 없으면 헤드리스 위임이 있을 때만
//!   ([`sqlite_gate`] — 읽기 · 쓰기 작업안 연결 공통). 비밀번호 없이 붙은 PG · MySQL 타일(`Missing::NoPassword`)과 같은 모양이다.
//!   AI 는 비밀번호를 칠 수 없으므로 둘 다 없으면 까닭(타일 없음 · 대상 바뀜 · 거절 · 비밀번호 없이 붙음)과 볼트 상태(없음 · 잠김 · 값 없음)를
//!   가른 안내 오류. 빌린 값으로 연 연결은 그 값이 지워지면(마지막 타일 닫힘 · 대상 바뀜) 거둔다([`retire_borrowed`] — 도는 조회는 끝까지 두고
//!   끝나면 닫는다).
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
//! | 빌린 비밀번호가 지워짐(마지막 사람 타일 닫힘 · 대상 바뀜) | 그 값으로 연 것만 거둔다 — 돌고 있으면 끝난 뒤 닫는다([`retire_borrowed`]) |
//! | 헤드리스 위임이 꺼짐(`[[database]] headless = false`) | 볼트 차례로 연 것 · 사람 타일이 없는데 비밀번호 없이 연 것(SQLite 포함)은 다음 호출이 쓰지 않고 거둔다 — 돌고 있으면 끝난 뒤 닫는다([`reusable`]) · 그 호출은 새로 연다(타일도 위임도 없으면 열지 않는다) |
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
    /// 이 연결에 **타일 없이 AI 접속**(볼트의 비밀번호)이 위임됐다(`[[database]] headless` — `Delegation::db_headless`). 거짓이면 빌린 값이
    /// 없을 때 볼트를 읽지 않는다([`open_with`]).
    headless: bool,
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

    /// 판정 때의 헤드리스 위임(타일 없이 볼트의 비밀번호로 열어도 되나) — 시험이 읽는다(판정은 [`open_with`] 가 칸을 직접 본다).
    #[cfg(test)]
    pub(crate) fn headless(&self) -> bool {
        self.headless
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
        headless: d.db_headless(conn, via_target),
    })
}

/// `list_db_connections` 의 `headless` — 사람 타일 없이 AI 연결이 설 수 있나: 엔진 무관 헤드리스 위임(`Delegation::db_headless` — 단계 · 스냅샷
/// 포함 · SQLite 도 2026-11-09 부터). AI 가 "타일을 열어 달라" 고 먼저 말할지 고르는 표지다(판정은 [`open_with`] · [`sqlite_gate`]). **순수.**
pub(crate) fn opens_without_tile(d: &Delegation, conn: &DbConn, via_target: Option<&str>) -> bool {
    d.db_headless(conn, via_target)
}

/// **그 연결 id 의 사람 쿼리 타일이 세션 서버 표에 있나**(엔진 무관 — `borrowed` 의 타일 집합: `table::open` 이 세우고 그 id 의 마지막 항목이
/// 빠질 때 걷는다 · 창이 사라져 떨어진 세션으로 남은 동안도 있다). 빌린 비밀번호 표의 값 칸은 비밀번호 엔진만 담지만 타일 칸은 SQLite 도 담는다.
/// 시험의 `Given` 은 타일 없음으로 본다.
pub(crate) fn tile_open(grant: &Grant, src: &PasswordSource) -> bool {
    match src {
        PasswordSource::Vault => borrowed::missing(&grant.conn.id) != Some(Missing::TileClosed),
        #[cfg(test)]
        PasswordSource::Given(_) => false,
    }
}

/// **SQLite 를 열어도 되나**(읽기 · 쓰기 작업안 연결 공통 — 2026-11-09): 사람 타일이 표에 있거나([`tile_open`]) 헤드리스 위임이 있을 때만. 아니면
/// 파일에 닿지 않고 [`headless_off_sqlite_text`] 로 실패한다.
pub(crate) fn sqlite_gate(grant: &Grant, src: &PasswordSource) -> Result<(), String> {
    if sqlite_opens(grant.headless, tile_open(grant, src)) {
        Ok(())
    } else {
        Err(headless_off_sqlite_text())
    }
}

/// [`sqlite_gate`] 의 판정 — 타일이 열려 있으면 칸과 무관 · 없으면 헤드리스 위임. **순수.**
pub(crate) fn sqlite_opens(headless: bool, tile_open: bool) -> bool {
    headless || tile_open
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

/// 비밀번호를 어디서 — 제품은 늘 `Vault`(= 빌린 값(`db::borrowed`) → 볼트 — [`open_with`]). 시험만 값을 직접 준다(사용자 볼트를 건드리지
/// 않게 — 그때는 빌린 값도 보지 않는다).
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
    /// 무슨 비밀번호로 열었나 — 빌린 값이면 그 값이 지워질 때 거두고([`retire_borrowed`]), 볼트 차례면 헤드리스 위임이 꺼진 호출이 다시 쓰지
    /// 않는다([`reusable`]).
    from: PwFrom,
    /// 거뒀다(풀에서 빠짐) — 도는 조회가 끝나는 순간 닫는다([`BusyGuard`]).
    retired: AtomicBool,
}

/// 풀 연결이 무슨 비밀번호로 열렸나.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum PwFrom {
    /// 사람 타일에서 빌린 값(`db::borrowed`).
    Borrowed,
    /// 볼트 차례(헤드리스 위임으로 연 것 — 서버가 비밀번호를 실제로 청했는지는 모른다, 그래서 볼트로 본다).
    Vault,
    /// 비밀번호 없이(SQLite · 헤드리스 끔 + 타일이 비밀번호 없이 붙음) — 사람 타일이 있거나 헤드리스일 때만 다시 쓴다([`reusable`]).
    NoPassword,
}

impl PwFrom {
    /// 연 차례 → 표지. SQLite 는 비밀번호가 없다 · 빌린 값이 없고 헤드리스면 볼트 차례([`open_with`]) · 아니면 비밀번호 없이 열었다. **순수.**
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

/// **풀 연결을 이번 호출이 다시 써도 되나**(위임 판정은 호출마다 지금 파일 — 풀에서 꺼내 쓰는 것도 판정을 지난다 · 2026-11-09): 볼트 차례로
/// 연 연결은 이번 증표에 헤드리스 위임이 있을 때만. 빌린 값으로 연 것은 그 값이 살아 있는 동안([`retire_borrowed`] · `still_lent` — 칸과
/// 무관). 비밀번호 없이 연 것(SQLite · 비밀번호 없이 붙은 타일)은 **여는 판정과 같은 문** — 그 연결의 사람 타일이 지금 표에 있거나(`tile_open`)
/// 헤드리스 위임이 있을 때만(타일이 닫히고 칸이 꺼졌으면 다음 호출이 쓰지 않는다). **순수.**
pub(crate) fn reusable(from: PwFrom, headless: bool, tile_open: bool) -> bool {
    match from {
        PwFrom::Borrowed => true,
        PwFrom::Vault => headless,
        PwFrom::NoPassword => headless || tile_open,
    }
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
        // 도는 사이 거뒀다 — 끝났으니 닫는다(거두는 쪽이 바쁨을 보고 미뤘다).
        if self.0.retired.load(Ordering::SeqCst) {
            self.0.engine.shutdown();
        }
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

/// **빌린 비밀번호로 연 연결을 거둔다**(`db::borrowed` 가 그 연결 id 의 값을 지울 때). 풀에서 곧바로 빼(다음 호출은 새로 열고 빌릴 값이
/// 없으면 볼트 차례) 돌지 않으면 닫고, 돌고 있으면 그 조회가 끝난 뒤 닫는다([`BusyGuard`]). 거둔 수.
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

/// 시험 전용 — 그 증표의 연결(SQLite)을 읽기 전용으로 열어 `from` 표지로 풀에 심는다(PG · MySQL 서버 없이 볼트 · 빌린 값으로 연 풀 연결을
/// 흉내 — 다시 쓰기 판정은 엔진 종류를 보지 않는다).
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

/// 시험 전용 — [`acquire`] 를 지나 받은 연결의 표지 · 심은 것과 같은 연결인가(포인터).
#[cfg(test)]
pub(crate) async fn acquire_for_test(grant: &Grant) -> Result<(PwFrom, bool), String> {
    let before = lock(&POOL).get(&grant.conn.id).cloned();
    let c = acquire(grant, &PasswordSource::Vault).await?;
    Ok((c.from, before.is_some_and(|b| Arc::ptr_eq(&b, &c))))
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
        // 타일 표는 풀 잠금 밖에서 본다(잠금 순서 — `borrowed` 는 값을 지울 때 풀을 잠근다).
        let tile = tile_open(grant, src);
        let mut p = lock(&POOL);
        let c = p.get(&grant.conn.id)?.clone();
        if !reusable(c.from, grant.headless, tile) {
            // 볼트로 연 연결인데 이번 증표는 헤드리스 끔 · 비밀번호 없이 연 연결인데 타일도 위임도 없음 — 풀에서 빼고 새 열기(`open_with` ·
            // `sqlite_gate` — 빌린 값 또는 헤드리스 끔 문구)로 간다. 돌고 있으면
            // 그 조회가 끝난 뒤 닫는다([`BusyGuard`] — [`retire_borrowed`] 와 같은 모양).
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
        // 여는 사이 빌린 값이 지워졌다(마지막 타일 닫힘 · 대상 바뀜) — 이번 호출만 이 연결로 돌고 끝나면 닫는다(풀에 넣지 않는다 — 거두는 쪽이 이미
        // 풀을 훑고 지나갔다). 풀 잠금 안에서 본다(거두기와 엇갈려 풀에 남지 않게).
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

/// 이 연결의 엔진을 연다(읽기 전용 · 빌린 값 → 볼트 비밀번호 · 무인 SSH). 둘째 값 = 빌린 값으로 열었으면 그 번호.
async fn open_engine(grant: &Grant, src: &PasswordSource) -> Result<(Engine, Option<u64>), String> {
    let via = grant.conn.via.clone();
    let resolved = resolve_for(grant).await?;
    let stream = format!("{STREAM_PREFIX}{}", grant.conn.id);
    let opened = match resolved {
        Resolved::Sqlite(path) => {
            // 사람 타일이 없으면 헤드리스 위임이 있어야 연다(2026-11-09 — 파일에 닿기 전에).
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

/// 빌릴 값 — 제품(`Vault`)만 사람 타일의 빌린 값을 본다(시험의 `Given` 은 보지 않는다). 대상이 바뀌었으면 여기서 버린다(`borrowed::lend`).
/// 없는 까닭은 표에 남는다 — 열기가 실패하면 [`open_error_text`] 가 `borrowed::missing` 으로 읽는다.
pub(crate) fn lend_for(grant: &Grant, src: &PasswordSource) -> Option<borrowed::Lent> {
    match src {
        PasswordSource::Vault => borrowed::lend(&grant.conn).ok(),
        #[cfg(test)]
        PasswordSource::Given(_) => None,
    }
}

/// **비밀번호 차례** — 빌린 값(`lent` — 사람 타일이 방금 인증에 쓴 값)으로 먼저 열고, DB 가 그 값을 거절하면(`[db-auth]`) 그 값을 버리고
/// (`borrowed::reject`) 볼트 차례(`secrets_for` — 몸 없음 · 볼트 물러남)로 한 번 더 연다. 빌린 값이 없으면 곧바로 볼트 차례. 둘째 값 = 빌린
/// 값으로 열었으면 그 번호(풀이 거둘 표지). 근거(물러남 한 번): 사람이 타일 밖에서 비밀번호를 바꿨고 볼트에는 새 값이 있을 수 있다 — 같은 값을
/// 두 번 보내지 않으니 잠금 계정 위험은 볼트만 쓰던 때와 같다.
///
/// **볼트 차례는 헤드리스 위임이 있을 때만**(`Grant::headless` — 2026-11-09): 없으면 볼트에 닿지 않는다(`vault: false`). 그때 사람 타일이
/// 비밀번호 없이 붙어 있으면(`Missing::NoPassword` — 서버가 요구하지 않았다) 비밀번호 없이 한 번 열어 보고, 타일이 없거나(닫힘 · 대상 바뀜 ·
/// 거절) 서버가 비밀번호를 청하면 **아무것도 열지 않고**(경유 SSH 도) [`headless_off_text`] 로 실패한다 — 볼트 잠김 · 값 없음과 다른 문구다.
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

/// 여는 데 쓸 비밀(볼트 차례) — 비밀번호는 볼트(시험만 몸으로 · 빌린 값은 [`open_with`] 가 이 위에 얹는다) · 경유 SSH 는 **무인 관문**
/// (헤드리스 규칙 — 볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만).
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

/// 빌린 값이 없는 까닭 → AI 문구의 앞 절(영어).
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

/// 헤드리스 위임이 꺼진 연결에 빌린 값이 없을 때 AI 가 읽는 문구(영어 — MCP 표면) — **볼트는 보지 않았다**(잠김 · 값 없음을 말하지
/// 않는다). **순수.**
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

/// 헤드리스 위임이 꺼진 SQLite 연결에 사람 타일이 없을 때 AI 가 읽는 문구(영어 — MCP 표면) — 비밀번호 · 볼트를 말하지 않는다. **순수.**
pub(crate) fn headless_off_sqlite_text() -> String {
    "No query tile in the aynx app has this SQLite connection open, and the user has not allowed AI to open it without a query tile \
     (headless access is off), so the file was not opened — ask the user to open it in a query tile, or to turn on 'AI access without a \
     tile' in the connection form (AI permission). While a person keeps it open in a query tile, AI connections can open it."
        .into()
}

/// 비밀번호가 없을 때 AI 가 읽는 문구(영어 — MCP 표면) — 빌린 값이 없는 까닭(`borrowed::Missing`)과 볼트 상태를 가른다. **순수.**
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
// 열기 실패 → AI 가 읽는 문구(영어 — MCP 표면). 비밀번호 · SSH 관문은 "사람이 해야 하는 일" 로 바꾼다.
pub(crate) fn open_error_text(e: OpenError, via: Option<&str>, conn_id: &str) -> String {
    match e {
        // 볼트의 값이 거절됐다(스냅샷 표지 `[db-stored-rejected]`).
        OpenError::Msg(m) if has_reason(&m, DB_STORED_REJECTED) => format!(
            "The database rejected the password stored in the vault ({}). A person has to reconnect in a query tile in the aynx \
             app and save the new password to the vault.",
            plain(&m)
        ),
        // 비밀번호가 없었다(빌린 값 없음 · 볼트에 없음 · 볼트 잠김 · 볼트 없음) — MySQL 은 없는 비밀번호도 인증 실패(`[db-auth]`)로 온다.
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
        let t = open_error_text(OpenError::Ssh(SshOpenError::other("x".to_string())), Some("web-01"), "Abc_none0001");
        assert!(t.contains("web-01") && t.contains("terminal tile"), "{t}");
    }

    /// 헤드리스 끔 문구 — 볼트를 보지 않았다는 것(잠김 · 값 없음 · 볼트 없음을 말하지 않는다) · 켜는 자리(연결 폼) · 타일 까닭을 가르고, 볼트
    /// 잠김 문구(`no_password_text`)와 다르다.
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

    /// 비밀번호가 없을 때의 문구 — 까닭 넷(타일 없음 · 대상 바뀜 · 거절 · 비밀번호 없이 붙음)과 볼트 상태 셋(열림 · 잠김 · 없음)을 가르고, AI 는
    /// 비밀번호를 치지 않는다는 문장 · 빌린 값의 규칙(친 값 · 볼트 값 · 잠겨도)을 늘 싣는다. 잠김 갈래는 "잠금 해제" 를, 그 밖은 볼트 저장을 안내한다.
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
