//! **PostgreSQL 엔진**(tokio-postgres 0.7) — 비동기다. 경유 · 세워 두기 · 생사는 `net`(MySQL 엔진과 같은 규칙).
//!
//! ## 연결
//!
//! - SSH 경유면 드라이버는 `hostaddr=127.0.0.1` + `host=<프리셋 host>` + `port=<임시>` 로 붙는다 — 이름을 따로 두어야 TLS 의 SNI · 이름
//!   검증이 터널 뒤에서도 원래 이름으로 선다.
//! - 취소 요청도 같은 TLS 설정으로 보낸다(Require 연결의 취소를 평문으로 보내면 드라이버가 거절한다).
//! - **비밀번호는 로그 · 오류 · `Debug` 에 없다.**
//!
//! ## 실행 — 확장 프로토콜만
//!
//! - **사용자 문장은 늘 `prepare` 를 지난다** — simple query 는 다중 문장을 한 번에 돈다. 예외는 아래 25001 재시도 하나(같은 글자를 이미
//!   트랜잭션 안 `prepare` 가 받았다).
//! - 읽기 전용의 계약은 **문장마다의 `START TRANSACTION READ ONLY` 트랜잭션 하나**다(세션 기본값 · 시작 옵션에 기대지 않는다 — 아래 "풀러").
//! - 쓰기는 문장마다 `BEGIN` … `COMMIT` 으로 감싸므로 사람의 트랜잭션 문장은 가드가 거절한다. 쓰기 토글은 앱 플래그 하나다 — 서버에
//!   아무것도 보내지 않는다.
//! - **트랜잭션 밖에서만 도는 문장**은 25001(서버가 문장을 시작하기 전에 거절 — 아무것도 바뀌지 않음) 뒤 simple query 한 번으로 다시 돈다.
//!   **한계** — 이 길에는 서버 `statement_timeout` 이 없어 표의 타이머 → `CancelRequest` 만 지킨다(닿지 않으면 서버 쪽 문장은 끝까지 돌 수 있다).
//!
//! ## 트랜잭션 작업
//!
//! - `Transaction<'a>` 는 `&mut Client` 를 빌려 요청을 넘길 수 없어 **담당 태스크**([`tx_task`])가 `Client` 를 쥐고 우편함으로 일을 받는다.
//!   이 연결의 모든 일은 먼저 **일의 문**(`gate`)을 지난다.
//! - 실행 한 번 = 세이브포인트 하나([`RUN_SAVEPOINT`]). `SET LOCAL statement_timeout` 은 세이브포인트 **뒤**에 건다(되돌리면 그 값도 되감긴다).
//!   정리가 실패하면 더 실행하지 않고 작업 전체를 되돌린다 — PG 의 사람 문장은 트랜잭션 블록 안에서 커밋할 수 없어(2D000) 되돌림이 증명된다.
//! - 메타 조회는 같은 트랜잭션 안 세이브포인트에서 돈다 — 별도 연결은 작업 안 내 변경이 안 보이고, 내 작업의 잠금에 막히고, 비밀번호를
//!   연결 수명 동안 들어야 해서 쓰지 않는다.
//! - 커밋 응답 유실(드라이버 쪽 오류 — 서버 답이 아님)은 결과 불명이다 — 다시 보내지 않는다.
//!
//! ## 풀러(PgBouncer `pool_mode=transaction`) — 세션 상태를 두지 않는다
//!
//! 트랜잭션이 끝날 때마다 백엔드가 바뀔 수 있다(시험 `pg_engine_keeps_no_session_state`).
//! - **시작 옵션 없음**(`options`) — 풀러가 거절한다. **세션 `SET` 없음** — 시간 제한은 `SET LOCAL`.
//! - **`prepare` 와 실행은 늘 같은 트랜잭션 안** — 밖에서는 그 사이에 백엔드가 바뀐다. 접속 때의 `SHOW server_version` 도 그래서 simple query 다.
//! - 남은 한계: 모르는 형의 `typeinfo` 캐시는 `max_prepared_statements = 0` 인 풀러에서 다른 백엔드에 닿으면 26000 으로 실패한다 — 안내만
//!   붙이고(`driver_statement_lost`) 자동 회복은 두지 않는다(캐시를 비울 공개 API 가 없다).
//! - PgBouncer 는 비밀번호 거절을 08P01 로 답한다 — 같은 `[db-auth]` 로 읽는다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::AbortHandle;
use tokio_postgres::error::{ErrorPosition, SqlState};
use tokio_postgres::config::SslMode;
use tokio_postgres::{CancelToken, Client, Config, NoTls, Row, SimpleQueryMessage, Statement, Transaction};
use tokio_postgres_rustls::MakeRustlsConnect;

use super::definition::{self, DefKind, DefTarget, DefinitionOut, PgAggregate, PgColumn, PgDomain, PgSequence, PgTableHead};
use super::guard;
use super::script::{self, Ctl, End, EngineRun, Planned, ScriptMode, Stop};
use super::net::{self, disconnected, Life, NetTarget, OpenError, OpenSecrets, Transport, CONNECT_TIMEOUT};
use super::pg_value::{self, Raw};
use super::tls;
use super::value::{self, approx_len};
use super::detail::{self, ConstraintOut, ForeignKeyOut, IndexOut, PartitionOut, TableDetail, TriggerOut};
use super::{cap_objects, objects_json, ColumnOut, Dialect, EngineError, ObjectOut, QueryOut, RunEnd, RESPONSE_MAX, RUN_SAVEPOINT};
use crate::errors::{with_reason, DB_AUTH, DB_PASSWORD, DB_STORED_REJECTED};
use crate::i18n::tr;
use crate::db::conns::DbTlsMode;

pub(crate) const DEFAULT_PORT: u16 = 5432;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 검증 여부는 여기가 아니라 검증기(`tls::verifier`)가 정한다.
pub(crate) fn ssl_mode_for(mode: DbTlsMode) -> SslMode {
    match mode {
        DbTlsMode::Disable => SslMode::Disable,
        DbTlsMode::Prefer => SslMode::Prefer,
        DbTlsMode::Require | DbTlsMode::VerifyCa | DbTlsMode::VerifyFull => SslMode::Require,
    }
}

/// `target.host` 는 이름(TLS 의 SNI · 이름 검증도 이 이름이다). 이 함수는 비밀을 모른다.
/// **시작 옵션(`options`)을 두지 않는다** — 트랜잭션 모드 풀러가 거절한다.
pub(crate) fn config_for(target: &NetTarget, addr: Option<std::net::SocketAddr>) -> Config {
    let mut c = Config::new();
    c.host(&target.host);
    match addr {
        Some(a) => {
            c.hostaddr(a.ip());
            c.port(a.port());
        }
        None => {
            c.port(target.port);
        }
    }
    c.user(target.user.clone().unwrap_or_else(|| net::os_user("postgres")));
    if let Some(db) = &target.database {
        c.dbname(db);
    }
    c.application_name("Aynx");
    c.connect_timeout(CONNECT_TIMEOUT);
    c.ssl_mode(ssl_mode_for(target.tls));
    c
}

/// 25001 은 서버가 문장을 시작하기 전에 내므로 다시 돌아도 두 번 바뀌지 않는다. 키워드 목록으로 미리 가르지 않는다 — 판마다 늘고
/// 함수 안에서도 나서, 서버의 답이 정답이다.
pub(crate) fn retry_outside_transaction(code: Option<&SqlState>, returns_rows: bool) -> bool {
    !returns_rows && code == Some(&SqlState::ACTIVE_SQL_TRANSACTION)
}

async fn simple_affected(c: &Client, text: &str) -> Result<u64, tokio_postgres::Error> {
    let msgs = c.simple_query(text).await?;
    Ok(msgs
        .iter()
        .rev()
        .find_map(|m| match m {
            SimpleQueryMessage::CommandComplete(n) => Some(*n),
            _ => None,
        })
        .unwrap_or(0))
}

enum TxCmd {
    /// `count` = 돌려준 행 수가 곧 바뀐 행 수인 문장(`RETURNING`).
    Query {
        text: String,
        count: bool,
        max_rows: usize,
        timeout_ms: u64,
        /// 세이브포인트를 풀기 직전에 다시 본다.
        stop: Arc<AtomicBool>,
        reply: oneshot::Sender<QueryRan>,
    },
    Script {
        stmts: Vec<Planned>,
        max_rows: usize,
        ctl: Arc<Ctl>,
        reply: oneshot::Sender<ScriptRan>,
    },
    Meta {
        job: MetaJob,
        timeout_ms: u64,
        reply: oneshot::Sender<Result<Option<Value>, tokio_postgres::Error>>,
    },
    End {
        commit: bool,
        reply: oneshot::Sender<Result<(), tokio_postgres::Error>>,
    },
}

type Ran = (Statement, Vec<Row>, Option<u64>);

enum RunErr {
    Db(tokio_postgres::Error),
    Stopped,
}

type QueryRan = (Result<Ran, RunErr>, RunEnd);

type StmtsRan = (Vec<QueryOut>, Option<tokio_postgres::Error>, Option<Stop>);

type ScriptRan = (Vec<QueryOut>, Option<tokio_postgres::Error>, Option<Stop>, RunEnd);

struct TxLink {
    cmd: mpsc::UnboundedSender<TxCmd>,
    alive: Arc<AtomicBool>,
}

enum MetaJob {
    Schema,
    Objects { schema: String },
    TableDetail { schema: String, table: String },
    Definition { kind: DefKind, target: DefTarget },
}

pub(crate) struct Pg {
    client: Arc<tokio::sync::Mutex<Client>>,
    /// **일의 문** — 한 번에 하나(`try_lock` — 못 잡으면 `Busy`, 줄 세우지 않는다). 작업이 열려 있으면 그동안 `Client` 는 담당 태스크가 쥔다.
    gate: tokio::sync::Mutex<Option<TxLink>>,
    /// 문을 쥐지 않고 읽는다([`Pg::in_tx`]).
    tx_alive: Mutex<Option<Arc<AtomicBool>>>,
    last_run: Mutex<Option<RunEnd>>,
    cancel: CancelToken,
    writable: AtomicBool,
    version: String,
    life: Arc<Life>,
    conn_task: AbortHandle,
    transport: Mutex<Option<Transport>>,
    /// 취소 요청도 이것으로 보낸다.
    tls: Option<MakeRustlsConnect>,
}

fn watch<F>(connection: F, life: &Arc<Life>) -> AbortHandle
where
    F: std::future::Future<Output = Result<(), tokio_postgres::Error>> + Send + 'static,
{
    let life = Arc::clone(life);
    tokio::spawn(async move {
        let _ = connection.await;
        life.mark_dead();
    })
    .abort_handle()
}

/// 비밀번호는 실리지 않는다(드라이버 문구에도 없다).
fn connect_error(e: &tokio_postgres::Error, from_vault: bool, name: &str) -> String {
    if let Some(m) = tls::cert_error_in(e, name) {
        return m;
    }
    // TLS 를 요구했는데 서버가 'N' — tokio-postgres 의 고정 글자.
    if e.as_db_error().is_none() && chain(e).contains("server does not support TLS") {
        return tls::server_without_tls();
    }
    if e.code() == Some(&SqlState::INVALID_PASSWORD) || pooler_auth_failed(e) {
        let msg = tr!(
            ko: "DB 비밀번호가 맞지 않습니다: {detail}",
            en: "The database password was rejected: {detail}",
            detail = describe(e)
        );
        return if from_vault {
            with_reason(DB_AUTH, with_reason(DB_STORED_REJECTED, msg))
        } else {
            with_reason(DB_AUTH, msg)
        };
    }
    // 서버가 비밀번호를 청했는데 실은 것이 없다 — tokio-postgres 의 설정 오류 문구(크레이트 고정 글자).
    if e.as_db_error().is_none() && chain(e).contains("password missing") {
        return with_reason(
            DB_PASSWORD,
            tr!(ko: "이 DB 는 비밀번호가 필요합니다", en: "This database needs a password"),
        );
    }
    tr!(
        ko: "PostgreSQL 에 붙지 못했습니다: {detail}",
        en: "Could not connect to PostgreSQL: {detail}",
        detail = describe(e)
    )
}

/// 드라이버가 캐시한 typeinfo 문장(`s<번호>`)을 서버가 모른다(26000) — 풀러가 다른 백엔드를 줬다. 사용자의 `EXECUTE 이름` 이 내는
/// 26000 과는 이름 꼴로 가른다.
fn driver_statement_lost(e: &tokio_postgres::Error) -> bool {
    e.as_db_error().is_some_and(|db| {
        db.code() == &SqlState::INVALID_SQL_STATEMENT_NAME
            && db
                .message()
                .strip_prefix("prepared statement \"s")
                .and_then(|r| r.strip_suffix("\" does not exist"))
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// PgBouncer 는 비밀번호 거절을 08P01 에 고정 글자로 답한다(SCRAM "SASL authentication failed" · md5 · 평문 "password authentication
/// failed" — 꼬리로 본다).
fn pooler_auth_failed(e: &tokio_postgres::Error) -> bool {
    e.as_db_error()
        .is_some_and(|db| db.code() == &SqlState::PROTOCOL_VIOLATION && db.message().ends_with("authentication failed"))
}

/// tokio-postgres 의 `Display` 는 종류만 말하고 까닭은 `source()` 에 있다.
fn chain(e: &tokio_postgres::Error) -> String {
    let mut s = e.to_string();
    let mut cur = std::error::Error::source(e);
    while let Some(c) = cur {
        let t = c.to_string();
        if !s.contains(&t) {
            s.push_str(": ");
            s.push_str(&t);
        }
        cur = c.source();
    }
    s
}

/// `Display` 는 그냥 "db error" 라 `as_db_error()` 의 칸들로 만든다.
pub(crate) fn describe(e: &tokio_postgres::Error) -> String {
    let Some(db) = e.as_db_error() else {
        return chain(e);
    };
    let mut s = db.message().to_string();
    if let Some(d) = db.detail() {
        s.push('\n');
        s.push_str(&tr!(ko: "상세: {d}", en: "Detail: {d}"));
    }
    if let Some(h) = db.hint() {
        s.push('\n');
        s.push_str(&tr!(ko: "힌트: {h}", en: "Hint: {h}"));
    }
    if let Some(ErrorPosition::Original(p)) = db.position() {
        s.push('\n');
        s.push_str(&tr!(ko: "위치: 문장의 {p}번째 글자", en: "Position: character {p} of the statement"));
    }
    s.push_str(&format!(" [SQLSTATE {}]", db.code().code()));
    s
}

impl Pg {
    /// 실패하면 아무것도 쥐지 않는다(비밀번호 갈래는 전송로를 세워 둔다).
    pub(crate) async fn connect(stream: &str, target: NetTarget, secrets: OpenSecrets) -> Result<Pg, OpenError> {
        // CA 파일 · 검증기는 SSH 관문보다 먼저 — 틀린 설정이면 전송로를 열지 않는다.
        let ca = tls::read_ca(target.tls, target.tls_ca.as_deref()).await?;
        let tls_connect = tls::verifier(target.tls, ca.as_ref())?
            .map(|v| tls::client_config(v).map(MakeRustlsConnect::new))
            .transpose()?;
        let OpenSecrets { password, ssh, vault, from_vault } = secrets;
        let transport = net::transport_for(stream, &target, ssh).await?;
        let addr = transport.as_ref().map(Transport::local_addr);
        let (password, from_vault) = net::password_for(password, from_vault, &target.id, vault);
        let mut config = config_for(&target, addr);
        if let Some(p) = &password {
            config.password(p.as_bytes());
        }
        let life = Life::new(stream);
        let r = match tls_connect.clone() {
            None => config.connect(NoTls).await.map(|(c, conn)| (c, watch(conn, &life))),
            Some(t) => config.connect(t).await.map(|(c, conn)| (c, watch(conn, &life))),
        };
        drop(config); // 비밀번호 사본을 곧바로 놓는다(설정은 연결에 넘어가지 않는다)
        drop(password);
        let (client, conn_task) = match r {
            Ok(x) => x,
            Err(e) => {
                let msg = connect_error(&e, from_vault, &target.host);
                net::after_failure(stream, transport, &msg).await;
                return Err(OpenError::Msg(msg));
            }
        };
        if let Some(t) = &transport {
            t.attach(&life);
        }
        let cancel = client.cancel_token();
        // 트랜잭션 밖 prepare → 실행은 풀러 뒤에서 백엔드가 바뀔 수 있다.
        let version = match client.simple_query("SHOW server_version").await {
            Ok(msgs) => msgs
                .into_iter()
                .find_map(|m| match m {
                    SimpleQueryMessage::Row(r) => r.get(0).map(str::to_string),
                    _ => None,
                })
                .unwrap_or_default(),
            Err(_) => String::new(),
        };
        Ok(Pg {
            client: Arc::new(tokio::sync::Mutex::new(client)),
            gate: tokio::sync::Mutex::new(None),
            tx_alive: Mutex::new(None),
            last_run: Mutex::new(None),
            cancel,
            writable: AtomicBool::new(false),
            version: format!("PostgreSQL {version}").trim().to_string(),
            life,
            conn_task,
            transport: Mutex::new(transport),
            tls: tls_connect,
        })
    }

    pub(crate) fn server_version(&self) -> String {
        self.version.clone()
    }

    pub(crate) fn writable(&self) -> bool {
        self.writable.load(Ordering::SeqCst)
    }

    pub(crate) fn is_dead(&self) -> bool {
        self.life.is_dead()
    }

    /// 결과를 확인하지 못한 실행이 남은 연결을 다시 쓰지 않는다 — 소켓이 닫히면 서버 · 풀러가 열린 트랜잭션을 되돌린다.
    pub(crate) fn abandon(&self) {
        self.life.mark_dead();
        self.interrupt();
        self.conn_task.abort();
    }

    pub(crate) fn take_run_end(&self) -> Option<RunEnd> {
        lock(&self.last_run).take()
    }

    /// 취소 요청을 새 TCP 로 보낸다(아무것도 안 돌면 서버가 무시한다).
    pub(crate) fn interrupt(&self) {
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            let token = self.cancel.clone();
            let tls = self.tls.clone();
            rt.spawn(async move {
                let _ = match tls {
                    None => token.cancel_query(NoTls).await,
                    Some(t) => token.cancel_query(t).await,
                };
            });
        }
    }

    /// 멱등. 열린 트랜잭션 작업은 연결이 끊기며 서버가 되돌린다.
    pub(crate) fn shutdown(&self) {
        self.life.set_closing();
        self.interrupt();
        self.conn_task.abort();
        if let Ok(mut g) = self.gate.try_lock() {
            g.take();
        }
        let t = lock(&self.transport).take();
        net::release_on_shutdown(t);
    }

    fn alive(&self) -> Result<(), EngineError> {
        if self.is_dead() {
            Err(EngineError::Message(disconnected()))
        } else {
            Ok(())
        }
    }

    fn try_client(&self) -> Result<tokio::sync::MutexGuard<'_, Client>, EngineError> {
        self.client.try_lock().map_err(|_| EngineError::Busy)
    }

    fn try_gate(&self) -> Result<tokio::sync::MutexGuard<'_, Option<TxLink>>, EngineError> {
        self.gate.try_lock().map_err(|_| EngineError::Busy)
    }

    /// **연결이 죽었으면 거짓** — 담당 태스크는 끊김을 모른 채 손잡이를 살려 두지만 서버는 이미 되돌렸다. 안 보면 표가 끊긴 작업을
    /// '열림' 으로 들고 있다가 "되돌렸다" 고 잘못 적는다.
    pub(crate) fn in_tx(&self) -> bool {
        lock(&self.tx_alive).as_ref().is_some_and(|a| a.load(Ordering::SeqCst)) && !self.is_dead()
    }

    fn live_link(gate: &mut Option<TxLink>) -> Option<&TxLink> {
        if gate.as_ref().is_some_and(|l| !l.alive.load(Ordering::SeqCst)) {
            *gate = None;
        }
        gate.as_ref()
    }

    fn task_gone(&self) -> EngineError {
        if self.is_dead() {
            EngineError::Message(disconnected())
        } else {
            EngineError::Message(tr!(
                ko: "트랜잭션 작업이 이미 끝났습니다",
                en: "The transaction has already ended"
            ))
        }
    }

    /// 접근 모드는 서버 기본.
    pub(crate) async fn tx_begin(&self) -> Result<(), EngineError> {
        self.alive()?;
        let mut gate = self.try_gate()?;
        if Self::live_link(&mut gate).is_some() {
            return Err(EngineError::Message(super::tx::Refusal::AlreadyOpen.message()));
        }
        let client = Arc::clone(&self.client).try_lock_owned().map_err(|_| EngineError::Busy)?;
        let (cmd, rx) = mpsc::unbounded_channel();
        let alive = Arc::new(AtomicBool::new(false));
        let (opened_tx, opened_rx) = oneshot::channel();
        tokio::spawn(tx_task(client, rx, Arc::clone(&alive), opened_tx));
        match opened_rx.await {
            Ok(Ok(())) => {
                *lock(&self.tx_alive) = Some(Arc::clone(&alive));
                *gate = Some(TxLink { cmd, alive });
                Ok(())
            }
            Ok(Err(e)) => Err(self.err(e)),
            Err(_) => Err(self.task_gone()),
        }
    }

    /// 보낸 뒤 연결이 끊기면(드라이버 쪽 오류 — 서버 답이 아니다) `Lost`, 서버가 거절하면(서버가 되돌렸다) `Failed`.
    pub(crate) async fn tx_end(&self, commit: bool) -> Result<Option<String>, super::TxEndError> {
        use super::TxEndError;
        let mut gate = self.gate.try_lock().map_err(|_| TxEndError::Busy)?;
        let lost = || TxEndError::Lost(disconnected());
        if Self::live_link(&mut gate).is_none() {
            return Err(if self.is_dead() {
                lost()
            } else {
                TxEndError::Failed(tr!(ko: "열린 트랜잭션 작업이 없습니다", en: "There is no open transaction"))
            });
        }
        // 끝내기는 문을 쥔 채 손잡이를 꺼내 간다 — 답이 오면 작업은 어느 쪽이든 끝났다.
        let Some(link) = gate.take() else {
            return Err(lost());
        };
        let (reply, rx) = oneshot::channel();
        if link.cmd.send(TxCmd::End { commit, reply }).is_err() {
            return Err(lost());
        }
        match rx.await {
            Ok(Ok(())) => Ok(None),
            Ok(Err(e)) if e.as_db_error().is_some() => Err(TxEndError::Failed(match self.err(e) {
                EngineError::Message(m) => m,
                other => format!("{other:?}"),
            })),
            Ok(Err(e)) => {
                if e.is_closed() {
                    self.life.mark_dead();
                }
                Err(TxEndError::Lost(describe(&e)))
            }
            Err(_) => Err(lost()),
        }
    }

    /// 작업 전체를 되돌리지도 못한 결과 불명이면 그 연결을 버린다.
    fn note_run_end(&self, end: RunEnd) {
        if matches!(end, RunEnd::Unknown(_)) && !self.in_tx() {
            self.abandon();
        }
        *lock(&self.last_run) = Some(end);
    }

    /// `None` = 대상을 못 찾음.
    async fn meta(&self, job: MetaJob, timeout_ms: u64) -> Result<Option<Value>, EngineError> {
        self.alive()?;
        let mut gate = self.try_gate()?;
        if let Some(link) = Self::live_link(&mut gate) {
            let (reply, rx) = oneshot::channel();
            if link.cmd.send(TxCmd::Meta { job, timeout_ms, reply }).is_err() {
                return Err(self.task_gone());
            }
            return match rx.await {
                Ok(r) => r.map_err(|e| self.err(e)),
                Err(_) => Err(self.task_gone()),
            };
        }
        let mut c = self.try_client()?;
        let r: Result<Option<Value>, tokio_postgres::Error> = async {
            let tx = c.build_transaction().read_only(true).start().await?;
            tx.batch_execute(&format!("SET LOCAL statement_timeout = {timeout_ms}")).await?;
            let out = run_meta(&tx, &job).await?;
            tx.rollback().await?;
            Ok(out)
        }
        .await;
        r.map_err(|e| self.err(e))
    }

    fn err(&self, e: tokio_postgres::Error) -> EngineError {
        if e.code() == Some(&SqlState::QUERY_CANCELED) {
            return EngineError::Interrupted;
        }
        if e.is_closed() {
            self.life.mark_dead();
            return EngineError::Message(disconnected());
        }
        // 쓰기 모드의 25006 은 서버 쪽 읽기 전용(대기 서버 · 역할 기본값 `default_transaction_read_only`)이다 — 토글 안내를 붙이지 않는다.
        if e.code() == Some(&SqlState::READ_ONLY_SQL_TRANSACTION) && !self.writable() {
            return EngineError::Message(format!(
                "{}\n{}",
                tr!(
                    ko: "읽기 전용 모드에서는 데이터를 바꾸는 문장을 실행하지 않습니다 — 위 띠의 '읽기 전용'을 눌러 쓰기를 켠 뒤 실행하세요",
                    en: "Statements that change data do not run in read-only mode — click 'Read-only' in the bar above to turn on writing first"
                ),
                describe(&e)
            ));
        }
        let detail = describe(&e);
        // 쓰기 모드 연결의 25006 — 앱이 연 `READ ONLY` 조회 길이거나 서버 쪽 읽기 전용이다. 표가 조회 길에서만 "데이터를 바꾸는 문장" 으로 읽는다.
        if e.code() == Some(&SqlState::READ_ONLY_SQL_TRANSACTION) {
            return EngineError::ReadOnlyRefused(tr!(ko: "PostgreSQL 오류: {detail}", en: "PostgreSQL error: {detail}"));
        }
        if driver_statement_lost(&e) {
            return EngineError::Message(format!(
                "{}\n{}",
                tr!(
                    ko: "트랜잭션 모드 풀러(PgBouncer) 뒤에서 드라이버의 형 조회 문장이 다른 서버 연결로 옮겨 갔습니다 — 풀러의 max_prepared_statements 를 0보다 크게 두거나, 이 연결을 다시 여세요",
                    en: "Behind a transaction-mode pooler (PgBouncer) the driver's type lookup statement moved to another server connection — set the pooler's max_prepared_statements above 0, or reopen this connection"
                ),
                detail
            ));
        }
        if e.code() == Some(&SqlState::T_R_SERIALIZATION_FAILURE) {
            return EngineError::Message(format!(
                "{}\n{}",
                tr!(ko: "PostgreSQL 오류: {detail}", en: "PostgreSQL error: {detail}"),
                super::serialization_note()
            ));
        }
        EngineError::Message(tr!(ko: "PostgreSQL 오류: {detail}", en: "PostgreSQL error: {detail}"))
    }

    pub(crate) async fn query(&self, sql: &str, max_rows: usize, timeout_ms: u64) -> Result<QueryOut, EngineError> {
        self.query_as(sql, max_rows, timeout_ms, false).await
    }

    /// `read` 면 쓰기 모드여도 읽기 전용 길로 돈다(작업 밖 조회). 작업이 열려 있으면 `read` 를 보지 않는다.
    pub(crate) async fn query_as(&self, sql: &str, max_rows: usize, timeout_ms: u64, read: bool) -> Result<QueryOut, EngineError> {
        self.query_ctl(sql, max_rows, timeout_ms, read, &Arc::new(AtomicBool::new(false))).await
    }

    /// 작업 안이면 담당 태스크가 세이브포인트를 풀기 직전에 `stop` 을 다시 본다(섰으면 성공한 실행도 되돌린다).
    /// 자동 커밋 단문의 `COMMIT` 응답을 못 받으면 [`EngineError::Unconfirmed`].
    pub(crate) async fn query_ctl(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
        read: bool,
        stop: &Arc<AtomicBool>,
    ) -> Result<QueryOut, EngineError> {
        self.alive()?;
        let started = Instant::now();
        let mut gate = self.try_gate()?;
        *lock(&self.last_run) = None;
        // 문을 쥔 뒤에 읽는다 — 쓰기 전환 · 작업 열기도 같은 문 안에서 바뀐다.
        let writable = self.writable() && !read;
        let (stmt, rows, affected) = if let Some(link) = Self::live_link(&mut gate) {
            let checked = guard::check_mode(sql, Dialect::Postgres, guard::Mode::Transaction)?;
            let (reply, rx) = oneshot::channel();
            let cmd = TxCmd::Query {
                text: checked.sql.to_string(),
                count: super::counts_returned_rows(&checked.keyword),
                max_rows,
                timeout_ms,
                stop: Arc::clone(stop),
                reply,
            };
            if link.cmd.send(cmd).is_err() {
                return Err(self.task_gone());
            }
            let (r, end) = match rx.await {
                Ok(x) => x,
                Err(_) => return Err(self.task_gone()),
            };
            self.note_run_end(end);
            match r {
                Ok(ran) => ran,
                Err(RunErr::Db(e)) => return Err(self.err(e)),
                Err(RunErr::Stopped) => return Err(EngineError::Interrupted),
            }
        } else {
            let mut c = self.try_client()?;
            let checked = guard::check_mode(sql, Dialect::Postgres, guard::Mode::of(writable, false))?;
            let text = checked.sql;
            if writable {
                match self.run_write(&mut c, text, super::counts_returned_rows(&checked.keyword), max_rows, timeout_ms).await {
                    Ok(x) => x,
                    Err(WriteErr::Db(e)) => return Err(self.err(e)),
                    Err(WriteErr::CommitLost(e)) => {
                        if e.is_closed() {
                            self.life.mark_dead();
                        }
                        return Err(EngineError::Unconfirmed(super::commit_lost_note(&describe(&e))));
                    }
                }
            } else {
                self.run_read(&mut c, text, max_rows, timeout_ms).await.map_err(|e| self.err(e))?
            }
        };
        let (columns, rows, truncated, cell_truncated) = shape(stmt.columns(), rows, max_rows);
        Ok(QueryOut {
            columns,
            rows,
            truncated,
            cell_truncated,
            affected,
            elapsed_ms: started.elapsed().as_millis() as u64,
            tx: None,
        })
    }

    /// **시험 전용** — 가드를 건너뛰고 읽기 전용 길만 탄다.
    #[cfg(test)]
    pub(crate) async fn query_unguarded(&self, sql: &str, max_rows: usize, timeout_ms: u64) -> Result<QueryOut, EngineError> {
        let mut c = self.try_client()?;
        let (stmt, rows, affected) = self.run_read(&mut c, sql, max_rows, timeout_ms).await.map_err(|e| self.err(e))?;
        let (columns, rows, truncated, cell_truncated) = shape(stmt.columns(), rows, max_rows);
        Ok(QueryOut {
            columns,
            rows,
            truncated,
            cell_truncated,
            affected,
            elapsed_ms: 0,
            tx: None,
        })
    }

    async fn run_read(
        &self,
        c: &mut Client,
        text: &str,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<(Statement, Vec<Row>, Option<u64>), tokio_postgres::Error> {
        let tx = c.build_transaction().read_only(true).start().await?;
        tx.batch_execute(&format!("SET LOCAL statement_timeout = {timeout_ms}")).await?;
        let stmt = tx.prepare(text).await?;
        let no_rows = stmt.columns().is_empty();
        let rows = if no_rows {
            tx.execute(&stmt, &[]).await?;
            Vec::new()
        } else {
            let portal = tx.bind(&stmt, &[]).await?;
            let want = i32::try_from(max_rows.saturating_add(1)).unwrap_or(i32::MAX);
            tx.query_portal(&portal, want).await?
        };
        tx.rollback().await?;
        Ok((stmt, rows, None))
    }

    /// 접근 모드는 서버 기본값을 따른다(`READ WRITE` 를 강제하면 대기 서버에서 `SELECT` 까지 실패한다).
    async fn run_write(
        &self,
        c: &mut Client,
        text: &str,
        count: bool,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<(Statement, Vec<Row>, Option<u64>), WriteErr> {
        let tx = c.transaction().await?;
        tx.batch_execute(&format!("SET LOCAL statement_timeout = {timeout_ms}")).await?;
        let stmt: Statement = tx.prepare(text).await?;
        if stmt.columns().is_empty() {
            return match tx.execute(&stmt, &[]).await {
                Ok(n) => {
                    commit_or_lost(tx).await?;
                    Ok((stmt, Vec::new(), Some(n)))
                }
                Err(e) if retry_outside_transaction(e.code(), false) => {
                    tx.rollback().await?;
                    // 트랜잭션 밖 simple query — 보낸 뒤 답을 못 받으면(끊김) 실행됐는지 모른다.
                    let n = simple_affected(c, text).await.map_err(|e| {
                        if e.as_db_error().is_some() {
                            WriteErr::Db(e)
                        } else {
                            WriteErr::CommitLost(e)
                        }
                    })?;
                    Ok((stmt, Vec::new(), Some(n)))
                }
                Err(e) => Err(e.into()),
            };
        }
        let (rows, affected) = portal_rows(&tx, &stmt, max_rows, count).await?;
        commit_or_lost(tx).await?;
        Ok((stmt, rows, affected))
    }

    pub(crate) async fn schema(&self, timeout_ms: u64) -> Result<Value, EngineError> {
        Ok(self.meta(MetaJob::Schema, timeout_ms).await?.unwrap_or_else(|| json!({ "schemas": [] })))
    }

    /// 확장이 만든 함수 · 범위 형의 생성자는 뺀다(PostGIS 같은 확장은 `public` 에 함수 수백 개를 둔다). 스키마 이름은 **바인드 인자**.
    pub(crate) async fn objects(&self, schema: Option<&str>, timeout_ms: u64) -> Result<Value, EngineError> {
        let schema = schema.unwrap_or("public").to_string();
        Ok(self.meta(MetaJob::Objects { schema }, timeout_ms).await?.unwrap_or_else(|| objects_json(Vec::new(), Vec::new())))
    }

    /// 이름은 바인드 인자. 스키마가 없으면 `public`.
    pub(crate) async fn table_detail(&self, schema: Option<&str>, table: &str, timeout_ms: u64) -> Result<Value, EngineError> {
        let job = MetaJob::TableDetail {
            schema: schema.unwrap_or("public").to_string(),
            table: table.to_string(),
        };
        self.meta(job, timeout_ms).await?.ok_or_else(|| {
            EngineError::Message(tr!(
                ko: "테이블 {table} 을(를) 찾지 못했습니다",
                en: "Could not find the table {table}"
            ))
        })
    }

    /// 이름 · 인자는 **바인드 인자**. 스키마가 없으면 `public`.
    pub(crate) async fn definition(&self, t: &DefTarget, timeout_ms: u64) -> Result<Value, EngineError> {
        let kind = definition::check(t)?;
        let job = MetaJob::Definition { kind, target: t.clone() };
        self.meta(job, timeout_ms).await?.ok_or_else(|| definition::not_found(t))
    }

    /// **앱 플래그만** 바꾼다 — 세션 `SET` 은 풀러 뒤에서 남의 세션에 샌다. 도는 쿼리와 엇갈리지 않게 같은 잠금을 쥔다.
    pub(crate) async fn set_write(&self, on: bool) -> Result<(), EngineError> {
        self.alive()?;
        let mut gate = self.try_gate()?;
        // 트랜잭션 작업이 열려 있으면 바꾸지 않는다 — 표(`table::set_write`)가 먼저 되돌린다.
        if Self::live_link(&mut gate).is_some() {
            return Err(EngineError::Message(super::tx::Refusal::AlreadyOpen.message()));
        }
        let _c = self.try_client()?;
        self.writable.store(on, Ordering::SeqCst);
        Ok(())
    }

    /// 문장마다 `SET LOCAL statement_timeout` 을 그 문장의 시한으로 다시 건다. 풀러 뒤에서도 트랜잭션 하나라 같은 백엔드다.
    pub(crate) async fn script(
        &self,
        plan: &[Planned],
        mode: ScriptMode,
        max_rows: usize,
        ctl: &Arc<Ctl>,
    ) -> Result<EngineRun, EngineError> {
        self.alive()?;
        let mut gate = self.try_gate()?;
        if let Some(link) = Self::live_link(&mut gate) {
            if mode != ScriptMode::InWork {
                return Err(script::state_changed());
            }
            let (reply, rx) = oneshot::channel();
            let cmd = TxCmd::Script {
                stmts: plan.to_vec(),
                max_rows,
                ctl: Arc::clone(ctl),
                reply,
            };
            if link.cmd.send(cmd).is_err() {
                return Err(self.task_gone());
            }
            let (done, err, stopped, end) = rx.await.map_err(|_| self.task_gone())?;
            let mut run = EngineRun::new();
            run.done = done;
            run.stopped = stopped;
            run.failed = err.map(|e| self.err(e));
            if matches!(end, RunEnd::Unknown(_)) && !self.in_tx() {
                self.abandon();
            }
            // 복구 성공일 때만 "이번 실행분만 되돌림". 끊겼으면 끊김.
            run.end = if self.is_dead() { End::Disconnected } else { End::in_work(end, &mut run) };
            return Ok(run);
        }
        // 읽기 전용 스크립트는 쓰기 모드에서도 받는다(자동 커밋을 끈 타일의 조회만 든 스크립트).
        if mode == ScriptMode::InWork || (mode == ScriptMode::Write && !self.writable()) {
            return Err(script::state_changed());
        }
        let mut c = self.try_client()?;
        let read_only = mode == ScriptMode::ReadOnly;
        let tx = if read_only {
            c.build_transaction().read_only(true).start().await
        } else {
            c.transaction().await
        }
        .map_err(|e| self.err(e))?;
        let (done, err, stopped) = script_in_tx(&tx, plan, max_rows, ctl).await;
        let mut run = EngineRun::new();
        run.done = done;
        run.stopped = stopped;
        if let Some(e) = err {
            let closed = e.is_closed();
            run.failed = Some(self.err(e));
            run.end = if closed || self.is_dead() {
                End::Disconnected
            } else {
                // 되돌리기가 실패해도(끊김) 서버가 되돌린다.
                let _ = tx.rollback().await;
                End::RolledBack
            };
            return Ok(run);
        }
        if read_only || run.must_roll_back(ctl) {
            if run.stopped.is_none() && !read_only {
                run.stopped = ctl.stopped();
            }
            run.end = match tx.rollback().await {
                Ok(()) if read_only => End::ReadOnlyDone,
                Ok(()) => End::RolledBack,
                Err(e) => {
                    let _ = self.err(e);
                    End::Disconnected
                }
            };
            return Ok(run);
        }
        // 커밋 — 끊지 않는다. 답을 못 받으면 결과 불명.
        run.end = match tokio::time::timeout(COMMIT_TIMEOUT, tx.commit()).await {
            Ok(Ok(())) => End::Committed,
            Ok(Err(e)) if e.as_db_error().is_some() => End::CommitFailed(describe(&e)),
            Ok(Err(e)) => {
                if e.is_closed() {
                    self.life.mark_dead();
                }
                End::CommitLost(describe(&e))
            }
            Err(_) => End::CommitLost(commit_timeout_note()),
        };
        Ok(run)
    }
}

/// 넘으면 결과 불명(끊지 않는다 · `table` 의 작업 끝내기와 같은 값).
pub(crate) const COMMIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

pub(crate) fn commit_timeout_note() -> String {
    tr!(
        ko: "서버가 {secs}초 안에 커밋에 답하지 않았습니다",
        en: "The server did not answer the commit within {secs} s",
        secs = COMMIT_TIMEOUT.as_secs()
    )
}

// ── 트랜잭션 작업 — 담당 태스크 ──

const META_SAVEPOINT: &str = "aynx_meta";


/// `SET LOCAL statement_timeout` 은 **그 뒤에** 건다 — 되돌리면 세이브포인트 안에서 건 시한도 함께 되감긴다.
async fn run_savepoint(tx: &Transaction<'_>) -> Result<(), tokio_postgres::Error> {
    tx.batch_execute(&format!("SAVEPOINT {RUN_SAVEPOINT}")).await
}

/// `RELEASE` 가 실패하면(마침 닿은 취소 요청 등) `ROLLBACK TO` 로 되돌려 보고 그 오류를 둘째 값으로 준다. `Err` = 정리마저 실패 —
/// 부르는 쪽이 작업 전체를 끝낸다([`abort_work`]).
async fn finish_run(tx: &Transaction<'_>, keep: bool) -> Result<(RunEnd, Option<tokio_postgres::Error>), tokio_postgres::Error> {
    let undo = format!("ROLLBACK TO SAVEPOINT {RUN_SAVEPOINT}; RELEASE SAVEPOINT {RUN_SAVEPOINT}");
    if keep {
        return match tx.batch_execute(&format!("RELEASE SAVEPOINT {RUN_SAVEPOINT}")).await {
            Ok(()) => Ok((RunEnd::Kept, None)),
            Err(e) if e.is_closed() => Err(e),
            Err(e) => {
                tx.batch_execute(&undo).await?;
                Ok((RunEnd::Undone { note: None }, Some(e)))
            }
        };
    }
    tx.batch_execute(&undo).await?;
    Ok((RunEnd::Undone { note: None }, None))
}

/// 끊겼으면 서버가 이미 되돌렸다. 되돌리기마저 실패하면 결과 불명 — 표가 그 연결을 버린다.
async fn abort_work(tx: Transaction<'_>, e: &tokio_postgres::Error) -> RunEnd {
    if e.is_closed() {
        return RunEnd::RolledBack { note: None };
    }
    let why = describe(e);
    match tx.rollback().await {
        Ok(()) => RunEnd::RolledBack { note: Some(super::recovery_failed_note(&why, true, false)) },
        Err(e2) if e2.is_closed() => RunEnd::RolledBack { note: None },
        Err(_) => RunEnd::Unknown(super::recovery_failed_note(&why, false, false)),
    }
}

/// `COMMIT` 을 보냈는데 답을 못 받음은 서버의 거절이 아니다 — 결과 불명.
enum WriteErr {
    Db(tokio_postgres::Error),
    CommitLost(tokio_postgres::Error),
}

impl From<tokio_postgres::Error> for WriteErr {
    fn from(e: tokio_postgres::Error) -> Self {
        WriteErr::Db(e)
    }
}

async fn commit_or_lost(tx: Transaction<'_>) -> Result<(), WriteErr> {
    match tx.commit().await {
        Ok(()) => Ok(()),
        Err(e) if e.as_db_error().is_some() => Err(WriteErr::Db(e)),
        Err(e) => Err(WriteErr::CommitLost(e)),
    }
}

/// **트랜잭션 작업 담당 태스크** — 끝내는 길은 [`TxCmd::End`] · 오류 · 우편함이 닫힘(엔진이 떨어짐 → `ROLLBACK`) 셋이다.
/// 끝날 때는 **생사를 먼저 끄고 · `Client` 를 놓은 뒤 · 답한다** — 답을 받은 쪽이 곧바로 연결 잠금을 잡을 수 있게.
async fn tx_task(
    mut client: tokio::sync::OwnedMutexGuard<Client>,
    rx: mpsc::UnboundedReceiver<TxCmd>,
    alive: Arc<AtomicBool>,
    opened: oneshot::Sender<Result<(), tokio_postgres::Error>>,
) {
    // 트랜잭션의 빌림은 `tx_loop` 안에서 끝난다 — 그 뒤에 생사를 끄고 · `Client` 를 놓고 · 마지막 답을 보낸다.
    let last = tx_loop(&mut client, rx, &alive, opened).await;
    alive.store(false, Ordering::SeqCst);
    drop(client);
    last.send();
}

/// `Client` 를 놓은 **뒤에** 보낸다.
enum LastReply {
    None,
    Opened(oneshot::Sender<Result<(), tokio_postgres::Error>>, tokio_postgres::Error),
    Query(oneshot::Sender<QueryRan>, tokio_postgres::Error, RunEnd),
    Meta(oneshot::Sender<Result<Option<Value>, tokio_postgres::Error>>, tokio_postgres::Error),
    End(oneshot::Sender<Result<(), tokio_postgres::Error>>, Result<(), tokio_postgres::Error>),
    Script(oneshot::Sender<ScriptRan>, ScriptRan),
}

impl LastReply {
    fn send(self) {
        match self {
            LastReply::None => {}
            LastReply::Opened(s, e) => {
                let _ = s.send(Err(e));
            }
            LastReply::Query(s, e, end) => {
                let _ = s.send((Err(RunErr::Db(e)), end));
            }
            LastReply::Meta(s, e) => {
                let _ = s.send(Err(e));
            }
            LastReply::End(s, r) => {
                let _ = s.send(r);
            }
            LastReply::Script(s, r) => {
                let _ = s.send(r);
            }
        }
    }
}

async fn tx_loop(
    client: &mut Client,
    mut rx: mpsc::UnboundedReceiver<TxCmd>,
    alive: &AtomicBool,
    opened: oneshot::Sender<Result<(), tokio_postgres::Error>>,
) -> LastReply {
    let tx = match client.transaction().await {
        Ok(t) => t,
        Err(e) => return LastReply::Opened(opened, e),
    };
    alive.store(true, Ordering::SeqCst);
    if opened.send(Ok(())).is_err() {
        alive.store(false, Ordering::SeqCst);
        let _ = tx.rollback().await;
        return LastReply::None;
    }
    loop {
        let Some(cmd) = rx.recv().await else {
            // 손잡이가 떨어졌다 — 되돌리고 끝낸다(연결이 이미 끊겼으면 서버가 되돌렸다).
            alive.store(false, Ordering::SeqCst);
            let _ = tx.rollback().await;
            return LastReply::None;
        };
        match cmd {
            TxCmd::Query {
                text,
                count,
                max_rows,
                timeout_ms,
                stop,
                reply,
            } => {
                let r = match run_savepoint(&tx).await {
                    Ok(()) => run_in_tx(&tx, &text, count, max_rows, timeout_ms).await,
                    Err(e) => Err(e),
                };
                if let Err(e) = &r {
                    if e.is_closed() {
                        alive.store(false, Ordering::SeqCst);
                        let Err(e) = r else { unreachable!() };
                        return LastReply::Query(reply, e, RunEnd::RolledBack { note: None });
                    }
                }
                let mut r = r.map_err(RunErr::Db);
                // 성공했어도 멈춤 깃발이 섰으면 그 실행을 남기지 않는다.
                if r.is_ok() && stop.load(Ordering::SeqCst) {
                    r = Err(RunErr::Stopped);
                }
                match finish_run(&tx, r.is_ok()).await {
                    Ok((end, release_err)) => {
                        if let Some(e) = release_err {
                            r = Err(RunErr::Db(e));
                        }
                        let _ = reply.send((r, end));
                    }
                    Err(e) => {
                        alive.store(false, Ordering::SeqCst);
                        let end = abort_work(tx, &e).await;
                        return LastReply::Query(reply, e, end);
                    }
                }
            }
            TxCmd::Meta { job, timeout_ms, reply } => match meta_in_tx(&tx, &job, timeout_ms).await {
                Ok(out) => {
                    let _ = reply.send(out);
                }
                Err(e) => {
                    alive.store(false, Ordering::SeqCst);
                    if !e.is_closed() {
                        let _ = tx.rollback().await;
                    }
                    return LastReply::Meta(reply, e);
                }
            },
            TxCmd::Script {
                stmts,
                max_rows,
                ctl,
                reply,
            } => {
                let (done, err, mut stopped) = match run_savepoint(&tx).await {
                    Ok(()) => script_in_tx(&tx, &stmts, max_rows, &ctl).await,
                    Err(e) => (Vec::new(), Some(e), None),
                };
                // 세이브포인트를 풀기 직전에 취소 · 전체 시한을 다시 본다.
                if err.is_none() && stopped.is_none() {
                    stopped = ctl.stopped();
                }
                let keep = err.is_none() && stopped.is_none();
                if err.as_ref().is_some_and(|e| e.is_closed()) {
                    alive.store(false, Ordering::SeqCst);
                    return LastReply::Script(reply, (done, err, stopped, RunEnd::RolledBack { note: None }));
                }
                match finish_run(&tx, keep).await {
                    Ok((end, release_err)) => {
                        let _ = reply.send((done, err.or(release_err), stopped, end));
                    }
                    Err(e) => {
                        alive.store(false, Ordering::SeqCst);
                        let end = abort_work(tx, &e).await;
                        return LastReply::Script(reply, (done, err.or(Some(e)), stopped, end));
                    }
                }
            }
            TxCmd::End { commit, reply } => {
                let r = if commit { tx.commit().await } else { tx.rollback().await };
                return LastReply::End(reply, r);
            }
        }
    }
}

/// 문장마다 `SET LOCAL statement_timeout` 을 다시 건다 — 사람이 친 `SET LOCAL … = 0` 도 다음 문장 앞에서 덮인다(마지막 값이 이긴다).
async fn run_in_tx(
    tx: &Transaction<'_>,
    text: &str,
    count: bool,
    max_rows: usize,
    timeout_ms: u64,
) -> Result<Ran, tokio_postgres::Error> {
    tx.batch_execute(&format!("SET LOCAL statement_timeout = {timeout_ms}")).await?;
    let stmt = tx.prepare(text).await?;
    if stmt.columns().is_empty() {
        let n = tx.execute(&stmt, &[]).await?;
        return Ok((stmt, Vec::new(), Some(n)));
    }
    let (rows, affected) = portal_rows(tx, &stmt, max_rows, count).await?;
    Ok((stmt, rows, affected))
}

/// `count` 면 상한 너머의 행을 **세기만 하고 버려** 정확한 영향 행 수를 준다(`maxAffected` 가 기댄다). 서버의 명령 태그는 가져오기
/// 한 번의 줄 수라 쓰지 않고 직접 센다.
async fn portal_rows(
    tx: &Transaction<'_>,
    stmt: &Statement,
    max_rows: usize,
    count: bool,
) -> Result<(Vec<Row>, Option<u64>), tokio_postgres::Error> {
    let portal = tx.bind(stmt, &[]).await?;
    let want = i32::try_from(max_rows.saturating_add(1)).unwrap_or(i32::MAX);
    let rows = tx.query_portal(&portal, want).await?;
    if !count {
        return Ok((rows, None));
    }
    let mut n = rows.len() as u64;
    if rows.len() >= want as usize {
        // 남은 행은 조각으로 받아 세고 버린다(기억이 한 조각 안에 머문다).
        const CHUNK: i32 = 10_000;
        loop {
            let more = tx.query_portal(&portal, CHUNK).await?;
            n += more.len() as u64;
            if more.len() < CHUNK as usize {
                break;
            }
        }
    }
    Ok((rows, Some(n)))
}

/// 되돌리기 · 커밋은 부르는 쪽 몫이다.
async fn script_in_tx(tx: &Transaction<'_>, stmts: &[Planned], max_rows: usize, ctl: &Ctl) -> StmtsRan {
    let mut done = Vec::with_capacity(stmts.len());
    for p in stmts {
        let Some(ms) = ctl.begin_stmt() else {
            return (done, None, ctl.stopped());
        };
        let started = Instant::now();
        let r = run_in_tx(tx, p.text(), super::counts_returned_rows(p.keyword()), max_rows, ms).await;
        ctl.end_stmt();
        match r {
            Ok((stmt, rows, affected)) => {
                let (columns, rows, truncated, cell_truncated) = shape(stmt.columns(), rows, max_rows);
                done.push(ctl.keep(QueryOut {
                    columns,
                    rows,
                    truncated,
                    cell_truncated,
                    affected,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    tx: None,
                }));
            }
            Err(e) => return (done, Some(e), None),
        }
    }
    (done, None, None)
}

/// **늘** `ROLLBACK TO` + `RELEASE` 한다(세이브포인트가 쌓이지 않게). 바깥 `Result` 의 오류 = 되감기마저 실패(연결이 끊김).
async fn meta_in_tx(
    tx: &Transaction<'_>,
    job: &MetaJob,
    timeout_ms: u64,
) -> Result<Result<Option<Value>, tokio_postgres::Error>, tokio_postgres::Error> {
    tx.batch_execute(&format!("SAVEPOINT {META_SAVEPOINT}")).await?;
    let r = async {
        tx.batch_execute(&format!("SET LOCAL statement_timeout = {timeout_ms}")).await?;
        run_meta(tx, job).await
    }
    .await;
    tx.batch_execute(&format!("ROLLBACK TO SAVEPOINT {META_SAVEPOINT}; RELEASE SAVEPOINT {META_SAVEPOINT}"))
        .await?;
    Ok(r)
}

/// `None` = 대상을 못 찾음.
async fn run_meta(tx: &Transaction<'_>, job: &MetaJob) -> Result<Option<Value>, tokio_postgres::Error> {
    match job {
        MetaJob::Schema => schema_in(tx).await.map(Some),
        MetaJob::Objects { schema } => objects_in(tx, schema).await.map(Some),
        MetaJob::TableDetail { schema, table } => table_detail_in(tx, schema, table).await,
        MetaJob::Definition { kind, target } => {
            let schema = target.schema.as_deref().unwrap_or("public");
            let version: i32 = tx.query_one(definition::PG_VERSION_NUM, &[]).await?.get(0);
            Ok(pg_definition(tx, *kind, schema, &target.name, target, version)
                .await?
                .map(DefinitionOut::json))
        }
    }
}

async fn schema_in(tx: &Transaction<'_>) -> Result<Value, tokio_postgres::Error> {
    let names = tx
        .query(
            "SELECT nspname::text FROM pg_catalog.pg_namespace \
             WHERE nspname NOT IN ('pg_catalog', 'information_schema') \
             AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp\\_%' \
             ORDER BY nspname <> 'public', nspname",
            &[],
        )
        .await?;
    let schemas: Vec<Value> = names.iter().map(|r| json!({ "name": r.get::<_, String>(0) })).collect();
    Ok(json!({ "schemas": schemas }))
}

async fn objects_in(tx: &Transaction<'_>, schema: &str) -> Result<Value, tokio_postgres::Error> {
    let limit = (super::OBJECTS_MAX + 1) as i64;
    let version: i32 = tx
        .query_one("SELECT current_setting('server_version_num')::int4", &[])
        .await?
        .get(0);
    let rels = tx
        .query(
            "SELECT c.relname::text, c.relkind::text \
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') \
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i \
             JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent \
             WHERE i.inhrelid = c.oid AND pc.relkind = 'p') \
             ORDER BY c.relname LIMIT $2",
            &[&schema, &limit],
        )
        .await?;
    let funcs = tx.query(proc_sql(version), &[&schema, &limit]).await?;
    let types = tx
        .query(
            "SELECT t.typname::text, t.typtype::text \
             FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace \
             WHERE n.nspname = $1 \
             AND (t.typtype IN ('e', 'd', 'r') OR (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c \
             WHERE c.oid = t.typrelid AND c.relkind = 'c'))) \
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d \
             WHERE d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e') \
             ORDER BY t.typname LIMIT $2",
            &[&schema, &limit],
        )
        .await?;
    let rels: Vec<ObjectOut> = rels
        .iter()
        .map(|r| {
            let (kind, sub) = rel_object(&r.get::<_, String>(1));
            ObjectOut { sub, ..ObjectOut::new(kind, r.get(0)) }
        })
        .collect();
    let funcs: Vec<ObjectOut> = funcs
        .iter()
        .map(|r| {
            let (kind, sub) = proc_object(&r.get::<_, String>(1));
            ObjectOut {
                sub,
                args: Some(r.get(2)),
                returns: r.get(3),
                ..ObjectOut::new(kind, r.get(0))
            }
        })
        .collect();
    let types: Vec<ObjectOut> = types
        .iter()
        .map(|r| ObjectOut {
            sub: type_sub(&r.get::<_, String>(1)),
            ..ObjectOut::new("type", r.get(0))
        })
        .collect();
    let mut truncated = Vec::new();
    let mut out = cap_objects(rels, &["table", "view", "matview", "foreign", "sequence"], &mut truncated);
    out.extend(cap_objects(funcs, &["function", "procedure"], &mut truncated));
    out.extend(cap_objects(types, &["type"], &mut truncated));
    Ok(objects_json(out, truncated))
}

/// 없으면 `None`.
async fn table_detail_in(tx: &Transaction<'_>, schema: &str, table: &str) -> Result<Option<Value>, tokio_postgres::Error> {
    let limit = (super::OBJECTS_MAX + 1) as i64;
    let Some(rel) = tx.query_opt(detail::PG_REL, &[&schema, &table]).await? else {
        return Ok(None);
    };
    let oid: u32 = rel.get(0);
    let partitioned = rel.get::<_, String>(1) == "p";
    let version: i32 = tx
        .query_one("SELECT current_setting('server_version_num')::int4", &[])
        .await?
        .get(0);
    let columns = tx.query(detail::PG_COLUMNS, &[&oid, &limit]).await?;
    let indexes = tx.query(&detail::pg_index_sql(version), &[&oid, &limit]).await?;
    let constraints = tx.query(detail::PG_CONSTRAINTS, &[&oid, &limit]).await?;
    let fks = tx.query(&detail::pg_fk_sql(version, false), &[&oid, &limit]).await?;
    let refs = tx.query(&detail::pg_fk_sql(version, true), &[&oid, &limit]).await?;
    let triggers = tx.query(detail::PG_TRIGGERS, &[&oid, &limit]).await?;
    let partitions = if partitioned {
        tx.query(detail::PG_PARTITIONS, &[&oid, &limit]).await?
    } else {
        Vec::new()
    };
    let fk = |r: &Row| ForeignKeyOut {
        name: Some(r.get(0)),
        schema: r.get(1),
        table: r.get(2),
        columns: r.get(3),
        ref_schema: r.get(4),
        ref_table: r.get(5),
        ref_columns: r.get(6),
        on_update: detail::pg_fk_action(&r.get::<_, String>(7)),
        on_delete: detail::pg_fk_action(&r.get::<_, String>(8)),
    };
    Ok(Some(
        TableDetail {
            columns: columns
                .iter()
                .map(|r| {
                    json!({
                        "name": r.get::<_, String>(0),
                        "type": r.get::<_, String>(1),
                        "notNull": r.get::<_, bool>(2),
                        "default": r.get::<_, Option<String>>(3),
                        "pk": r.get::<_, i32>(4),
                    })
                })
                .collect(),
            indexes: indexes
                .iter()
                .map(|r| IndexOut {
                    name: r.get(0),
                    unique: r.get(1),
                    primary: r.get(2),
                    method: Some(r.get(3)),
                    columns: r.get::<_, Vec<String>>(4).into_iter().map(Some).collect(),
                    predicate: r.get(5),
                    definition: r.get(6),
                })
                .collect(),
            constraints: constraints
                .iter()
                .map(|r| ConstraintOut {
                    name: Some(r.get(0)),
                    ty: detail::pg_constraint_type(&r.get::<_, String>(1)),
                    columns: r.get(2),
                    definition: r.get(3),
                })
                .collect(),
            foreign_keys: fks.iter().map(fk).collect(),
            referenced_by: refs.iter().map(fk).collect(),
            triggers: triggers
                .iter()
                .map(|r| TriggerOut {
                    name: r.get(0),
                    detail: detail::pg_trigger_detail(r.get(1)),
                    definition: r.get(2),
                })
                .collect(),
            partitions: partitions
                .iter()
                .map(|r| PartitionOut {
                    schema: r.get(0),
                    name: r.get(1),
                    bound: r.get(2),
                    sub: (r.get::<_, String>(3) == "p").then_some("partitioned"),
                })
                .collect(),
            truncated: Vec::new(),
        }
        .json(),
    ))
}

/// 없으면 `None`.
async fn pg_definition(
    tx: &Transaction<'_>,
    kind: DefKind,
    schema: &str,
    name: &str,
    t: &DefTarget,
    version: i32,
) -> Result<Option<DefinitionOut>, tokio_postgres::Error> {
    let table = t.table.as_deref().unwrap_or("");
    let text = |rows: Vec<Row>| rows.first().and_then(|r| r.get::<_, Option<String>>(0));
    let indexes = |oid: u32| async move {
        let rows = tx.query(definition::PG_TABLE_INDEXES, &[&oid]).await?;
        Ok::<Vec<String>, tokio_postgres::Error>(rows.iter().map(|r| r.get(0)).collect())
    };
    Ok(match kind {
        DefKind::Table | DefKind::Foreign => {
            let Some(h) = tx.query_opt(&definition::pg_table_head_sql(version), &[&schema, &name]).await? else {
                return Ok(None);
            };
            let oid: u32 = h.get(0);
            let partition_of = match (h.get::<_, bool>(4), h.get::<_, Option<String>>(5), h.get::<_, Option<String>>(6)) {
                (true, Some(p), Some(b)) => Some((p, b)),
                _ => None,
            };
            let head = PgTableHead {
                relkind: h.get(1),
                name: h.get(2),
                persistence: h.get(3),
                partition_of,
                partition_key: h.get(7),
                inherits: h.get(8),
                options: h.get(9),
                server: h.get(10),
                server_options: h.get(11),
            };
            let cols: Vec<PgColumn> = tx
                .query(&definition::pg_table_columns_sql(version), &[&oid])
                .await?
                .iter()
                .filter(|r| r.get::<_, bool>(7))
                .map(|r| PgColumn {
                    name: r.get(0),
                    ty: r.get(1),
                    collation: r.get(2),
                    default: r.get(3),
                    not_null: r.get(4),
                    identity: r.get(5),
                    generated: r.get(6),
                })
                .collect();
            let cons: Vec<(String, String)> = tx
                .query(&definition::pg_table_constraints_sql(version), &[&oid])
                .await?
                .iter()
                .map(|r| (r.get(0), r.get(1)))
                .collect();
            let idx = indexes(oid).await?;
            Some(DefinitionOut::new(definition::pg_table_ddl(&head, &cols, &cons, &idx), true))
        }
        DefKind::View | DefKind::Matview => {
            let relkind = if kind == DefKind::View { "v" } else { "m" };
            let Some(v) = tx.query_opt(definition::PG_VIEW, &[&schema, &name, &relkind]).await? else {
                return Ok(None);
            };
            let (oid, qname, def, opts): (u32, String, Option<String>, Option<String>) = (v.get(0), v.get(1), v.get(2), v.get(3));
            let def = def.unwrap_or_default();
            let sql = if kind == DefKind::View {
                definition::pg_view_ddl(&qname, opts.as_deref(), &def)
            } else {
                let idx = indexes(oid).await?;
                definition::pg_matview_ddl(&qname, opts.as_deref(), &def, v.get(4), &idx)
            };
            Some(DefinitionOut::new(sql, false))
        }
        DefKind::Function | DefKind::Procedure => {
            let args = t.args.as_deref();
            let Some(p) = tx.query_opt(definition::pg_proc_find_sql(version), &[&schema, &name, &args]).await? else {
                return Ok(None);
            };
            let (oid, k): (u32, String) = (p.get(0), p.get(1));
            if k == "a" {
                let Some(a) = tx.query_opt(&definition::pg_aggregate_sql(version), &[&oid]).await? else {
                    return Ok(None);
                };
                let agg = PgAggregate {
                    name: a.get(0),
                    args: a.get(1),
                    sfunc: a.get(2),
                    stype: a.get(3),
                    finalfunc: a.get(4),
                    combinefunc: a.get(5),
                    initcond: a.get(6),
                };
                Some(DefinitionOut::new(definition::pg_aggregate_ddl(&agg), true))
            } else {
                text(tx.query(definition::PG_FUNCTIONDEF, &[&oid]).await?).map(|s| DefinitionOut::new(s, false))
            }
        }
        DefKind::Trigger => text(tx.query(definition::PG_TRIGGER, &[&schema, &table, &name]).await?)
            .map(|s| DefinitionOut::new(definition::with_semicolon(&s), false)),
        DefKind::Index => text(tx.query(definition::PG_INDEX, &[&schema, &name]).await?)
            .map(|s| DefinitionOut::new(definition::with_semicolon(&s), false)),
        DefKind::Constraint => tx
            .query_opt(definition::PG_CONSTRAINT, &[&schema, &table, &name])
            .await?
            .map(|r| DefinitionOut::new(definition::pg_constraint_ddl(&r.get::<_, String>(0), &r.get::<_, String>(1), &r.get::<_, String>(2)), false)),
        DefKind::Sequence => {
            if version < 100_000 {
                return Ok(None);
            }
            tx.query_opt(definition::PG_SEQUENCE, &[&schema, &name]).await?.map(|r| {
                let owned = match (r.get::<_, Option<String>>(8), r.get::<_, Option<String>>(9)) {
                    (Some(c), Some(k)) => Some((c, k)),
                    _ => None,
                };
                let q = PgSequence {
                    name: r.get(0),
                    ty: r.get(1),
                    start: r.get(2),
                    increment: r.get(3),
                    max: r.get(4),
                    min: r.get(5),
                    cache: r.get(6),
                    cycle: r.get(7),
                    owned,
                };
                DefinitionOut::new(definition::pg_sequence_ddl(&q), true)
            })
        }
        DefKind::Type => {
            let Some(ty) = tx.query_opt(definition::PG_TYPE, &[&schema, &name]).await? else {
                return Ok(None);
            };
            let (oid, typtype, qname): (u32, String, String) = (ty.get(0), ty.get(1), ty.get(2));
            let sql = match typtype.as_str() {
                "e" => {
                    let labels: Vec<String> = tx.query(definition::PG_ENUM_LABELS, &[&oid]).await?.iter().map(|r| r.get(0)).collect();
                    definition::pg_enum_ddl(&qname, &labels)
                }
                "d" => {
                    let checks = tx
                        .query(definition::PG_DOMAIN_CHECKS, &[&oid])
                        .await?
                        .iter()
                        .map(|r| (r.get(0), r.get(1)))
                        .collect();
                    definition::pg_domain_ddl(&PgDomain {
                        name: qname,
                        base: ty.get::<_, Option<String>>(3).unwrap_or_default(),
                        not_null: ty.get(4),
                        default: ty.get(5),
                        collation: ty.get(6),
                        checks,
                    })
                }
                "r" => {
                    let Some(rg) = tx.query_opt(definition::PG_RANGE, &[&oid]).await? else {
                        return Ok(None);
                    };
                    definition::pg_range_ddl(&qname, &rg.get::<_, String>(0), rg.get::<_, Option<&str>>(1), rg.get::<_, Option<&str>>(2))
                }
                _ => {
                    let rel: u32 = ty.get(7);
                    let attrs: Vec<(String, String)> =
                        tx.query(definition::PG_COMPOSITE_ATTRS, &[&rel]).await?.iter().map(|r| (r.get(0), r.get(1))).collect();
                    definition::pg_composite_ddl(&qname, &attrs)
                }
            };
            Some(DefinitionOut::new(sql, true))
        }
    })
}

/// 분할 표(`p`)는 표 폴더 안의 갈래다.
pub(crate) fn rel_object(k: &str) -> (&'static str, Option<&'static str>) {
    match k {
        "v" => ("view", None),
        "m" => ("matview", None),
        "f" => ("foreign", None),
        "S" => ("sequence", None),
        "p" => ("table", Some("partitioned")),
        _ => ("table", None),
    }
}

/// 11 아래는 [`proc_sql`] 의 `CASE` 가 같은 글자를 만든다.
pub(crate) fn proc_object(k: &str) -> (&'static str, Option<&'static str>) {
    match k {
        "p" => ("procedure", None),
        "a" => ("function", Some("aggregate")),
        "w" => ("function", Some("window")),
        _ => ("function", None),
    }
}

pub(crate) fn type_sub(k: &str) -> Option<&'static str> {
    match k {
        "e" => Some("enum"),
        "d" => Some("domain"),
        "r" => Some("range"),
        "c" => Some("composite"),
        _ => None,
    }
}

/// 확장이 만든 함수(`deptype = 'e'`)와 서버가 딸려 만든 함수(`'i'` — 범위 형의 생성자)는 뺀다.
pub(crate) fn proc_sql(server_version_num: i32) -> &'static str {
    if server_version_num >= 110_000 {
        "SELECT p.proname::text, p.prokind::text, pg_catalog.pg_get_function_identity_arguments(p.oid), \
         CASE WHEN p.prokind = 'p' THEN NULL ELSE pg_catalog.pg_get_function_result(p.oid) END \
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d \
         WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype IN ('e', 'i')) \
         ORDER BY p.proname, 3 LIMIT $2"
    } else {
        "SELECT p.proname::text, CASE WHEN p.proisagg THEN 'a' WHEN p.proiswindow THEN 'w' ELSE 'f' END, \
         pg_catalog.pg_get_function_identity_arguments(p.oid), pg_catalog.pg_get_function_result(p.oid) \
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d \
         WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype IN ('e', 'i')) \
         ORDER BY p.proname, 3 LIMIT $2"
    }
}

fn shape(
    cols: &[tokio_postgres::Column],
    rows: Vec<Row>,
    max_rows: usize,
) -> (Vec<ColumnOut>, Vec<Vec<Value>>, bool, bool) {
    let columns: Vec<ColumnOut> = cols
        .iter()
        .map(|c| ColumnOut {
            name: c.name().to_string(),
            ty: pg_value::type_label(c.type_()),
        })
        .collect();
    let mut truncated = rows.len() > max_rows;
    let mut cell_truncated = false;
    let mut out = Vec::with_capacity(rows.len().min(max_rows));
    let mut size = 0usize;
    for row in rows.iter().take(max_rows) {
        let mut line = Vec::with_capacity(cols.len());
        let mut line_size = 2usize;
        for (i, col) in cols.iter().enumerate() {
            let cell = match row.try_get::<_, Raw>(i) {
                Ok(raw) => pg_value::decode(col.type_(), raw.0),
                Err(_) => value::Cell::Text(std::borrow::Cow::Owned(format!("‹{}›", col.type_().name()))),
            };
            let (j, cut) = value::to_json(cell);
            cell_truncated |= cut;
            line_size += approx_len(&j);
            line.push(j);
        }
        if size + line_size > RESPONSE_MAX && !out.is_empty() {
            truncated = true;
            break;
        }
        size += line_size;
        out.push(line);
    }
    (columns, out, truncated, cell_truncated)
}
