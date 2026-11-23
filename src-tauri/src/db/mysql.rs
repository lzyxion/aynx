//! **MySQL · MariaDB 엔진**(mysql_async 0.37). 연결 규칙(경유 · 비밀번호를 묻는 동안 전송로 세워 두기 · 생사)은 PG 와 같다(`net`).
//! 서버 버전 글자로 갈래([`Flavor`])를 알아 시간 제한 방식만 고른다.
//!
//! ## 연결
//!
//! - 연결을 **둘** 연다 — 본 연결과 `KILL QUERY` 를 보낼 **제어 연결**. 취소할 때 새로 붙지 않으므로 비밀번호를 붙들 필요가 없다.
//!   제어 연결의 하트비트가 `wait_timeout` 끊김을 막고, 실패하면 서버가 끊은 것으로 본다(PG 처럼 연결 태스크가 없어 저절로 알 길이 없다).
//! - 옵션: `prefer_socket(false)`(루프백 터널에 붙은 뒤 **이 PC 의** 유닉스 소켓으로 갈아타지 않게) · 문장 캐시 0 · `LOAD DATA LOCAL`
//!   처리기 없음(서버가 이 PC 의 파일을 청할 수 없다) · `enable_cleartext_plugin` 꺼짐(TLS 위에서도).
//! - **비밀번호는 로그 · 오류 · `Debug` 에 없다.**
//!
//! ## 실행
//!
//! - **사용자 문장은 늘 prepare(`COM_STMT_PREPARE`)만** — mysql_async 0.37 은 `CLIENT_MULTI_STATEMENTS` 를 늘 켜고 끌 옵션이 없다.
//!   prepare 는 문장 하나만 받는다. 글자 프로토콜은 앱이 고정한 문장(SET · 트랜잭션 · KILL)만 탄다.
//! - 읽기 전용: 세션 기본값 `SET SESSION TRANSACTION READ ONLY` + 문장마다 `START TRANSACTION READ ONLY` → 사용자 문장 → `ROLLBACK`.
//! - **행 상한은 서버 쪽에서**(`sql_select_limit`) — 결과를 중간에 버리면 드라이버가 나머지를 다음 질의 때 다 받는다.
//! - 시간 제한: MySQL `max_execution_time` 은 **SELECT 에만** 걸려 그 밖은 앱 타이머가 제어 연결로 `KILL QUERY` 를 보낸다.
//! - **트랜잭션 작업의 종료문은 늘 `… AND NO CHAIN NO RELEASE`**([`COMMIT_SQL`] · [`ROLLBACK_SQL`]) — `completion_type` 이 1 이면 화면에 없는
//!   새 트랜잭션이 열리고 2 면 연결이 끊긴다. 진실은 서버의 `SERVER_STATUS_IN_TRANS` 플래그다. 단 플래그는 **지금** 트랜잭션이 있는지만
//!   말하고 끝난 까닭은 증명하지 못한다 — "되돌림" 은 교착 1213 · 1205 일 때만이고 그 밖에 사라진 트랜잭션은 **결과 불명**이다.
//! - 세이브포인트 정리가 실패하면 **더 실행하지 않고 작업 전체를 되돌린다**(결과는 불명). 풀기 직전에 취소 · 앱 타이머의 끊기를 다시
//!   본다 — `SELECT SLEEP(…)` 은 끊겨도 오류 없이 1 을 돌려준다.
//! - `ROLLBACK TO` 는 그 뒤에 잡은 행 잠금을 풀지 않는다(InnoDB) — 되돌린 실행의 안내에 늘 적는다. 경고 1196(비트랜잭션 테이블)은 결과에 밝힌다.
//! - 메타 조회는 트랜잭션을 열지 않고 세션 값(`SET SESSION …` — 암묵 커밋 아님)만 쓴다 — 작업 중에도 같은 연결에서 돈다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mysql_async::prelude::Queryable;
use mysql_async::{Column, Conn, Opts, OptsBuilder, Row};
use serde_json::{json, Value};
use tokio::task::AbortHandle;

use super::definition::{self, DefTarget, DefinitionOut};
use super::guard;
use super::mysql_tls;
use super::script;
use super::mysql_value;
use super::net::{self, disconnected, Life, NetTarget, OpenError, OpenSecrets, Transport, CONNECT_TIMEOUT};
use super::tls;
use super::value::{self, approx_len};
use super::detail::{self, ConstraintOut, ForeignKeyOut, IndexOut, TableDetail, TriggerOut};
use super::{cap_objects, comment_of, objects_json, ColumnOut, Dialect, EngineError, ObjectOut, QueryOut, RunEnd, RESPONSE_MAX, RUN_SAVEPOINT};
use crate::errors::{with_reason, DB_AUTH, DB_PASSWORD, DB_STORED_REJECTED};
use crate::i18n::tr;
use crate::db::conns::DbTlsMode;

pub(crate) const DEFAULT_PORT: u16 = 3306;
/// 서버 `wait_timeout` 에 끊기지 않게 · 서버가 끊은 것을 알아채게.
const HEARTBEAT: Duration = Duration::from_secs(30);
const PING_TIMEOUT: Duration = Duration::from_secs(10);
/// 넘으면 연결을 죽은 것으로 본다.
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(10);

/// 연결의 기본 데이터베이스면 보인다.
const SYSTEM_DBS: [&str; 4] = ["mysql", "information_schema", "performance_schema", "sys"];

const ER_ACCESS_DENIED: u16 = 1045;
const ER_QUERY_INTERRUPTED: u16 = 1317;
const ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION: u16 = 1792;
const ER_QUERY_TIMEOUT: u16 = 3024; // MySQL max_execution_time
const ER_STATEMENT_TIMEOUT: u16 = 1969; // MariaDB max_statement_time
const ER_UNSUPPORTED_PS: u16 = 1295;
const ER_SPECIFIC_ACCESS_DENIED: u16 = 1227;
const ER_TABLEACCESS_DENIED: u16 = 1142;
const ER_LOCK_WAIT_TIMEOUT: u16 = 1205; // innodb_rollback_on_timeout = ON 이면 트랜잭션 전체를 되감는다
const ER_LOCK_DEADLOCK: u16 = 1213;
const ER_WARNING_NOT_COMPLETE_ROLLBACK: u16 = 1196;

/// `completion_type` 과 무관하게 체인(새 트랜잭션) · 끊기 없이(MySQL · MariaDB 공통 문법).
pub(crate) const COMMIT_SQL: &str = "COMMIT AND NO CHAIN NO RELEASE";
pub(crate) const ROLLBACK_SQL: &str = "ROLLBACK AND NO CHAIN NO RELEASE";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Flavor {
    Mysql,
    Mariadb,
}

impl Flavor {
    pub(crate) fn from_version(v: &str) -> Flavor {
        if v.to_ascii_lowercase().contains("mariadb") {
            Flavor::Mariadb
        } else {
            Flavor::Mysql
        }
    }

    fn name(self) -> &'static str {
        match self {
            Flavor::Mysql => "MySQL",
            Flavor::Mariadb => "MariaDB",
        }
    }

/// 배포 꼬리표는 뗀다.
    pub(crate) fn version_label(self, raw: &str) -> String {
        let v = match self {
            Flavor::Mariadb => raw.split("-MariaDB").next().unwrap_or(raw),
            Flavor::Mysql => raw,
        };
        format!("{} {}", self.name(), v.trim()).trim().to_string()
    }

    pub(crate) fn server_times(self, keyword: &str) -> bool {
        match self {
            Flavor::Mariadb => true,
            Flavor::Mysql => keyword == "SELECT",
        }
    }

/// **앱 고정 글자**(숫자만 끼운다). `None` = DEFAULT.
    pub(crate) fn limits_sql(self, select_limit: Option<usize>, timeout_ms: u64) -> String {
        let limit = select_limit.map_or_else(|| "DEFAULT".to_string(), |n| n.to_string());
        let time = match self {
            Flavor::Mysql => format!("max_execution_time = {timeout_ms}"),
            Flavor::Mariadb => format!("max_statement_time = {}.{:03}", timeout_ms / 1000, timeout_ms % 1000),
        };
        format!("SET SESSION sql_select_limit = {limit}, SESSION {time}")
    }

    /// MariaDB(10.2.7+)는 기본값을 **SQL 식 글자**로 준다(글자 리터럴 `'x'` · 기본값 NULL 은 글자 `NULL`) — MySQL 꼴로 맞춘다.
    pub(crate) fn column_default(self, raw: Option<String>) -> Option<String> {
        let raw = raw?;
        if self == Flavor::Mysql {
            return Some(raw);
        }
        if raw.eq_ignore_ascii_case("NULL") {
            return None;
        }
        match raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
            Some(inner) if raw.len() >= 2 => Some(inner.replace("''", "'")),
            _ => Some(raw),
        }
    }

    pub(crate) fn reset_sql(self) -> &'static str {
        match self {
            Flavor::Mysql => "SET SESSION sql_select_limit = DEFAULT, SESSION max_execution_time = DEFAULT",
            Flavor::Mariadb => "SET SESSION sql_select_limit = DEFAULT, SESSION max_statement_time = DEFAULT",
        }
    }
}

/// `addr` 은 실제로 TCP 를 열 곳(터널이면 `127.0.0.1:<임시>`). 이 함수는 비밀을 모른다.
pub(crate) fn opts_for(target: &NetTarget, addr: Option<std::net::SocketAddr>) -> OptsBuilder {
    let (host, port) = match addr {
        Some(a) => (a.ip().to_string(), a.port()),
        None => (target.host.clone(), target.port),
    };
    let mut attrs = HashMap::new();
    attrs.insert("program_name".to_string(), "Aynx".to_string());
    OptsBuilder::default()
        .ip_or_hostname(host)
        .tcp_port(port)
        .user(Some(target.user.clone().unwrap_or_else(|| net::os_user("root"))))
        .db_name(target.database.clone())
        .prefer_socket(false)
        .stmt_cache_size(0)
        .tcp_nodelay(true)
        .enable_cleartext_plugin(false)
        .connect_attributes(attrs)
}

/// 비밀은 실리지 않는다.
fn describe(e: &mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(s) => format!("{} [ERROR {} ({})]", s.message, s.code, s.state),
        other => other.to_string(),
    }
}

fn server_code(e: &mysql_async::Error) -> Option<u16> {
    match e {
        mysql_async::Error::Server(s) => Some(s.code),
        _ => None,
    }
}

/// 서버 오류 · 값 변환 오류는 연결이 산다.
fn is_fatal(e: &mysql_async::Error) -> bool {
    matches!(
        e,
        mysql_async::Error::Io(_) | mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed)
    )
}

pub(crate) fn engine_error(e: &mysql_async::Error, flavor: Flavor) -> EngineError {
    if is_fatal(e) {
        return EngineError::Message(disconnected());
    }
    match server_code(e) {
        Some(ER_QUERY_INTERRUPTED | ER_QUERY_TIMEOUT | ER_STATEMENT_TIMEOUT) => EngineError::Interrupted,
        Some(ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION) => EngineError::Message(format!(
            "{}
{}",
            tr!(
                ko: "읽기 전용 모드에서는 데이터를 바꾸는 문장을 실행하지 않습니다 — 위 띠의 '읽기 전용'을 눌러 쓰기를 켠 뒤 실행하세요",
                en: "Statements that change data do not run in read-only mode — click 'Read-only' in the bar above to turn on writing first"
            ),
            describe(e)
        )),
        _ => EngineError::Message(tr!(
            ko: "{engine} 오류: {detail}",
            en: "{engine} error: {detail}",
            engine = flavor.name(),
            detail = describe(e)
        )),
    }
}

/// `sent` = 비밀번호를 실었다.
pub(crate) fn connect_error(e: &mysql_async::Error, sent: bool, from_vault: bool, flavor_name: &str) -> String {
    if server_code(e) == Some(ER_ACCESS_DENIED) {
        if !sent {
            return with_reason(
                DB_PASSWORD,
                tr!(ko: "이 DB 는 비밀번호가 필요합니다", en: "This database needs a password"),
            );
        }
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
    tr!(
        ko: "{engine} 에 붙지 못했습니다: {detail}",
        en: "Could not connect to {engine}: {detail}",
        engine = flavor_name,
        detail = describe(e)
    )
}

pub(crate) fn no_server_ssl(e: &mysql_async::Error) -> bool {
    matches!(e, mysql_async::Error::Driver(mysql_async::DriverError::NoClientSslFlagFromServer))
}

fn tls_connect_error(e: &mysql_async::Error, name: &str) -> Option<String> {
    if no_server_ssl(e) {
        return Some(tls::server_without_tls());
    }
    tls::cert_error_in(e, name)
}

async fn connect_one(opts: Opts) -> Result<Conn, mysql_async::Error> {
    match tokio::time::timeout(CONNECT_TIMEOUT, Conn::new(opts)).await {
        Ok(r) => r,
        Err(_) => Err(mysql_async::Error::Io(mysql_async::IoError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "connect timed out",
        )))),
    }
}

pub(crate) struct Mysql {
    conn: tokio::sync::Mutex<Conn>,
    /// 하트비트가 끊긴 것을 보면 `None`.
    control: Arc<tokio::sync::Mutex<Option<Conn>>>,
    conn_id: u32,
    flavor: Flavor,
    writable: AtomicBool,
    in_tx: AtomicBool,
    /// 사라진 트랜잭션의 까닭을 가른다([`Mysql::vanished`]).
    last_code: AtomicU16,
    last_run: Mutex<Option<RunEnd>>,
    version: String,
    life: Arc<Life>,
    heartbeat: AbortHandle,
    transport: Mutex<Option<Transport>>,
}

impl Mysql {
    /// 실패하면 아무것도 쥐지 않는다(비밀번호 갈래는 전송로를 세워 둔다).
    pub(crate) async fn connect(stream: &str, target: NetTarget, secrets: OpenSecrets) -> Result<Mysql, OpenError> {
        // CA 파일은 SSH 관문보다 먼저 — 틀린 설정이면 전송로를 열지 않는다.
        let ca = tls::read_ca(target.tls, target.tls_ca.as_deref()).await?;
        let OpenSecrets { password, ssh, vault, from_vault } = secrets;
        let transport = net::transport_for(stream, &target, ssh).await?;
        let addr = transport.as_ref().map(Transport::local_addr);
        let tls_name = if target.tls == DbTlsMode::VerifyCa {
            let (dial_host, dial_port) = addr.map_or_else(|| (target.host.clone(), target.port), |a| (a.ip().to_string(), a.port()));
            match mysql_tls::probe_name((&dial_host, dial_port), &target.host, ca.as_ref()).await {
                Ok(n) => n,
                Err(msg) => {
                    net::after_failure(stream, transport, &msg).await;
                    return Err(OpenError::Msg(msg));
                }
            }
        } else {
            target.host.clone()
        };
        let ssl = mysql_tls::ssl_opts_for(target.tls, ca.as_ref(), &tls_name);
        let (password, from_vault) = net::password_for(password, from_vault, &target.id, vault);
        let sent = password.is_some();
        let base = opts_for(&target, addr).pass(password.as_ref().map(|p| p.as_str().to_string()));
        drop(password);
        let prefer = target.tls == DbTlsMode::Prefer;
        let r = async {
            let mut opts: Opts = base.clone().ssl_opts(ssl).into();
            let mut main = match connect_one(opts.clone()).await {
                // 드라이버에는 prefer 가 없다.
                Err(e) if prefer && no_server_ssl(&e) => {
                    opts = base.ssl_opts(None::<mysql_async::SslOpts>).into();
                    connect_one(opts.clone()).await?
                }
                r => r?,
            };
            let control = connect_one(opts).await?;
            let version: Option<String> = main.query_first("SELECT VERSION()").await?;
            main.query_drop("SET SESSION TRANSACTION READ ONLY").await?;
            Ok::<_, mysql_async::Error>((main, control, version.unwrap_or_default()))
        }
        .await;
        let (main, control, raw_version) = match r {
            Ok(x) => x,
            Err(e) => {
                let msg = tls_connect_error(&e, &target.host).unwrap_or_else(|| connect_error(&e, sent, from_vault, "MySQL / MariaDB"));
                net::after_failure(stream, transport, &msg).await;
                return Err(OpenError::Msg(msg));
            }
        };
        let flavor = Flavor::from_version(&raw_version);
        let life = Life::new(stream);
        if let Some(t) = &transport {
            t.attach(&life);
        }
        let conn_id = main.id();
        let conn = tokio::sync::Mutex::new(main);
        let control = Arc::new(tokio::sync::Mutex::new(Some(control)));
        let heartbeat = spawn_heartbeat(Arc::clone(&control), Arc::clone(&life));
        Ok(Mysql {
            conn,
            control,
            conn_id,
            flavor,
            writable: AtomicBool::new(false),
            in_tx: AtomicBool::new(false),
            last_code: AtomicU16::new(0),
            last_run: Mutex::new(None),
            version: flavor.version_label(&raw_version),
            life,
            heartbeat,
            transport: Mutex::new(transport),
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

    /// 아무것도 안 돌면 서버가 무시한다.
    pub(crate) fn interrupt(&self) {
        kill_query(&self.control, self.conn_id);
    }

    /// 결과를 확인하지 못한 실행이 남은 연결을 다시 쓰지 않는다 — `KILL CONNECTION` 으로 서버가 열린 트랜잭션을 되돌리게 한다.
    pub(crate) fn abandon(&self) {
        self.in_tx.store(false, Ordering::SeqCst);
        self.life.mark_dead();
        kill_connection(&self.control, self.conn_id);
    }

    pub(crate) fn take_run_end(&self) -> Option<RunEnd> {
        lock(&self.last_run).take()
    }

    /// 멱등.
    pub(crate) fn shutdown(&self) {
        self.life.set_closing();
        self.heartbeat.abort();
        self.interrupt();
        let control = Arc::clone(&self.control);
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                if let Some(c) = control.lock().await.take() {
                    let _ = tokio::time::timeout(PING_TIMEOUT, c.disconnect()).await;
                }
            });
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

    fn try_conn(&self) -> Result<tokio::sync::MutexGuard<'_, Conn>, EngineError> {
        self.conn.try_lock().map_err(|_| EngineError::Busy)
    }

    fn err(&self, e: mysql_async::Error) -> EngineError {
        if is_fatal(&e) {
            self.life.mark_dead();
            self.in_tx.store(false, Ordering::SeqCst);
        }
        // 쓰기 모드 세션의 1792 는 앱이 연 `START TRANSACTION READ ONLY`(자동 커밋을 끈 타일의 조회 길)에서만 난다.
        if self.writable() && server_code(&e) == Some(ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION) {
            return EngineError::ReadOnlyRefused(tr!(
                ko: "{engine} 오류: {detail}",
                en: "{engine} error: {detail}",
                engine = self.flavor.name(),
                detail = describe(&e)
            ));
        }
        engine_error(&e, self.flavor)
    }

    pub(crate) fn in_tx(&self) -> bool {
        self.in_tx.load(Ordering::SeqCst) && !self.is_dead()
    }

    /// 마지막 OK 패킷이 없으면(오류 직후) 상태를 바꾸지 않는 탐침 `DO 0` 뒤에 읽는다. 읽지 못하면 `None`.
    async fn server_in_tx(&self, c: &mut Conn) -> Option<bool> {
        if c.last_ok_packet().is_none() {
            if let Err(e) = c.query_drop("DO 0").await {
                let _ = self.err(e);
                return None;
            }
        }
        c.last_ok_packet()
            .map(|ok| ok.status_flags().contains(mysql_async::consts::StatusFlags::SERVER_STATUS_IN_TRANS))
    }

    /// **끄기만** 한다 — 가드가 못 본 `CALL` 안의 `SET autocommit = 0` 같은 숨은 트랜잭션이 작업으로 올라오지 않게.
    async fn sync_tx(&self, c: &mut Conn) {
        if self.in_tx.load(Ordering::SeqCst) && self.server_in_tx(c).await != Some(true) {
            self.in_tx.store(false, Ordering::SeqCst);
        }
    }

    /// 앱의 종료문 뒤 — 트랜잭션이 남았으면 되돌리고, 그래도 남거나 읽지 못하면 연결을 버린다.
    async fn ensure_ended(&self, c: &mut Conn) -> bool {
        self.in_tx.store(false, Ordering::SeqCst);
        match self.server_in_tx(c).await {
            Some(false) | None => return true,
            Some(true) => {}
        }
        if cleanup(c, ROLLBACK_SQL).await.is_ok() && self.server_in_tx(c).await == Some(false) {
            return true;
        }
        self.abandon();
        false
    }

    async fn nontx_note(&self, c: &mut Conn) -> Option<String> {
        if c.get_warnings() == 0 {
            return None;
        }
        let rows: Vec<(String, u16, String)> = c.query("SHOW WARNINGS").await.ok()?;
        rows.iter().any(|(_, code, _)| *code == ER_WARNING_NOT_COMPLETE_ROLLBACK).then(nontx_rollback_note)
    }

    fn vanished(&self, failed: bool) -> RunEnd {
        let code = self.last_code.load(Ordering::SeqCst);
        if failed && matches!(code, ER_LOCK_DEADLOCK | ER_LOCK_WAIT_TIMEOUT) {
            RunEnd::RolledBack { note: None }
        } else {
            RunEnd::Unknown(super::tx_vanished_note())
        }
    }

    /// 접근 모드는 세션의 것.
    pub(crate) async fn tx_begin(&self) -> Result<(), EngineError> {
        self.alive()?;
        let mut c = self.try_conn()?;
        // 두 번째 `START TRANSACTION` 은 첫 작업을 **암묵 커밋**한다 — 문을 쥔 채 다시 본다.
        if self.in_tx() {
            return Err(EngineError::Message(super::tx::Refusal::AlreadyOpen.message()));
        }
        // 화면에 없는 트랜잭션도 `START TRANSACTION` 이 암묵 커밋한다 — 열지 않는다.
        if self.server_in_tx(&mut c).await == Some(true) {
            return Err(EngineError::Message(tr!(
                ko: "이 연결에 화면에 없는 트랜잭션이 열려 있습니다(프로시저 안의 SET autocommit = 0 등) — 위 띠의 쓰기를 껐다 켜서 되돌린 뒤 다시 시작하세요",
                en: "This connection has a transaction the app did not open (SET autocommit = 0 inside a procedure, etc.) — turn writing off and on in the bar above to roll it back, then start again"
            )));
        }
        c.query_drop("START TRANSACTION").await.map_err(|e| self.err(e))?;
        let on = self.server_in_tx(&mut c).await == Some(true);
        self.in_tx.store(on, Ordering::SeqCst);
        if on {
            Ok(())
        } else {
            Err(EngineError::Message(tr!(
                ko: "서버가 트랜잭션을 열지 않았습니다(START TRANSACTION 뒤 상태 플래그가 꺼져 있음)",
                en: "The server did not open a transaction (the status flag is off after START TRANSACTION)"
            )))
        }
    }

    pub(crate) async fn tx_end(&self, commit: bool) -> Result<Option<String>, super::TxEndError> {
        if self.is_dead() {
            return Err(super::TxEndError::Lost(disconnected()));
        }
        let mut c = self.try_conn().map_err(|_| super::TxEndError::Busy)?;
        match c.query_drop(if commit { COMMIT_SQL } else { ROLLBACK_SQL }).await {
            Ok(()) => {
                let note = if commit { None } else { self.nontx_note(&mut c).await };
                if self.ensure_ended(&mut c).await {
                    Ok(note)
                } else {
                    Err(super::TxEndError::Unverified(tx_left_note()))
                }
            }
            Err(e) if is_fatal(&e) => {
                let _ = self.err(e);
                Err(super::TxEndError::Lost(disconnected()))
            }
            Err(e) => {
                let m = match engine_error(&e, self.flavor) {
                    EngineError::Message(m) | EngineError::ReadOnlyRefused(m) | EngineError::Unconfirmed(m) => m,
                    EngineError::Interrupted => describe(&e),
                    EngineError::Busy => EngineError::busy_message(),
                };
                self.sync_tx(&mut c).await;
                Err(super::TxEndError::Failed(m))
            }
        }
    }

    pub(crate) async fn query(&self, sql: &str, max_rows: usize, timeout_ms: u64) -> Result<QueryOut, EngineError> {
        self.query_as(sql, max_rows, timeout_ms, false).await
    }

    /// `read` 면 쓰기 모드여도 읽기 전용 길로 돈다(작업 밖 조회 — 트랜잭션을 남기지 않아 메타데이터 잠금을 쥐지 않는다).
    /// 작업 안이면 `read` 를 보지 않고 세이브포인트([`RUN_SAVEPOINT`])로 감싼다.
    pub(crate) async fn query_as(&self, sql: &str, max_rows: usize, timeout_ms: u64, read: bool) -> Result<QueryOut, EngineError> {
        self.query_ctl(sql, max_rows, timeout_ms, read, &AtomicBool::new(false)).await
    }

    /// 작업 안이면 세이브포인트를 풀기 **직전에** 멈춤 깃발과 앱 타이머의 끊기를 다시 본다 — 끊긴 `SLEEP()` 은 오류 없이 1 을 돌려준다.
    pub(crate) async fn query_ctl(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
        read: bool,
        stop: &AtomicBool,
    ) -> Result<QueryOut, EngineError> {
        self.alive()?;
        let started = Instant::now();
        let mut c = self.try_conn()?;
        // 잠금을 쥔 뒤에 읽는다 — 쓰기 전환도 같은 잠금 안에서 바뀐다.
        let writable = self.writable();
        let in_work = writable && self.in_tx();
        let read_path = !writable || (read && !in_work);
        let mode = if read_path { guard::Mode::ReadOnly } else { guard::Mode::of(true, in_work) };
        let checked = guard::check_mode(sql, Dialect::Mysql, mode)?;
        let out = self.run_checked(&mut c, checked.sql, &checked.keyword, read_path, in_work, max_rows, timeout_ms, stop).await;
        // 가드가 못 보는 `CALL` 안의 트랜잭션도 여기서 보인다.
        if writable && !self.is_dead() {
            self.sync_tx(&mut c).await;
        }
        let out = out?;
        Ok(QueryOut {
            elapsed_ms: started.elapsed().as_millis() as u64,
            ..out
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_checked(
        &self,
        c: &mut Conn,
        text: &str,
        keyword: &str,
        read_path: bool,
        in_work: bool,
        max_rows: usize,
        timeout_ms: u64,
        stop: &AtomicBool,
    ) -> Result<QueryOut, EngineError> {
        *lock(&self.last_run) = None;
        if in_work {
            cleanup(c, &format!("SAVEPOINT {RUN_SAVEPOINT}")).await.map_err(|e| self.err(e))?;
        }
        let killed = Arc::new(AtomicBool::new(false));
        let mut out = self.run(c, text, keyword, read_path, max_rows, timeout_ms, Some(&killed)).await;
        if in_work && !self.is_dead() {
            if out.is_ok() && (stop.load(Ordering::SeqCst) || killed.load(Ordering::SeqCst)) {
                out = Err(EngineError::Interrupted);
            }
            let end = self.savepoint_end(c, out.is_ok()).await;
            *lock(&self.last_run) = Some(end);
        }
        out
    }

    /// **시험 전용** — 가드를 건너뛰고 읽기 전용 길만 탄다.
    #[cfg(test)]
    pub(crate) async fn query_unguarded(&self, sql: &str, max_rows: usize, timeout_ms: u64) -> Result<QueryOut, EngineError> {
        let mut c = self.try_conn()?;
        let keyword = sql.split_whitespace().next().unwrap_or_default().to_ascii_uppercase();
        self.run(&mut c, sql, &keyword, true, max_rows, timeout_ms, None).await
    }

    /// **시험 전용** — 가드를 건너뛰고 작업 안 길만 탄다.
    #[cfg(test)]
    pub(crate) async fn query_in_work_unguarded(&self, sql: &str) -> (Result<QueryOut, EngineError>, Option<RunEnd>) {
        let mut c = self.try_conn().expect("연결");
        assert!(self.in_tx(), "작업 안에서만");
        let keyword = sql.split_whitespace().next().unwrap_or_default().to_ascii_uppercase();
        let r = self.run_checked(&mut c, sql, &keyword, false, true, 100, 10_000, &AtomicBool::new(false)).await;
        if !self.is_dead() {
            self.sync_tx(&mut c).await;
        }
        (r, self.take_run_end())
    }

    /// **시험 전용** — 앱 고정 글자를 그대로 보낸다.
    #[cfg(test)]
    pub(crate) async fn raw_for_test(&self, sql: &str) {
        self.try_conn().expect("연결").query_drop(sql).await.expect("raw");
    }

    /// **시험 전용** — `(IN_TRANS, AUTOCOMMIT)`.
    #[cfg(test)]
    pub(crate) async fn tx_flags(&self) -> (bool, bool) {
        use mysql_async::consts::StatusFlags;
        let mut c = self.try_conn().expect("연결");
        c.query_drop("DO 0").await.expect("DO 0");
        let f = c.last_ok_packet().expect("OK 패킷").status_flags();
        (f.contains(StatusFlags::SERVER_STATUS_IN_TRANS), f.contains(StatusFlags::SERVER_STATUS_AUTOCOMMIT))
    }

    #[allow(clippy::too_many_arguments)]
    async fn run(
        &self,
        c: &mut Conn,
        text: &str,
        keyword: &str,
        read_only: bool,
        max_rows: usize,
        timeout_ms: u64,
        killed: Option<&Arc<AtomicBool>>,
    ) -> Result<QueryOut, EngineError> {
        self.last_code.store(0, Ordering::SeqCst);
        let before = self.flavor.limits_sql(Some(max_rows.saturating_add(1)), timeout_ms);
        let r = if read_only {
            c.query_drop(format!("{before}; START TRANSACTION READ ONLY")).await
        } else {
            c.query_drop(before).await
        };
        r.map_err(|e| self.err(e))?;
        let timer = (!self.flavor.server_times(keyword)).then(|| {
            let (control, id) = (Arc::clone(&self.control), self.conn_id);
            let killed = killed.cloned();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
                if let Some(k) = killed {
                    k.store(true, Ordering::SeqCst);
                }
                kill_query(&control, id);
            })
            .abort_handle()
        });
        let result = exec_user(c, text, max_rows, super::counts_returned_rows(keyword)).await;
        if let Some(t) = timer {
            t.abort();
        }
        if let Err(e) = &result {
            self.last_code.store(server_code(e).unwrap_or(0), Ordering::SeqCst);
        }
        // 사용자 문장이 실패해도 되돌린다. 읽기 전용 길의 되돌리기도 체인 없이(새 `READ ONLY` 트랜잭션이 남지 않게).
        let fatal = result.as_ref().err().is_some_and(is_fatal);
        if !fatal {
            let after = if read_only {
                format!("{ROLLBACK_SQL}; {}", self.flavor.reset_sql())
            } else {
                self.flavor.reset_sql().to_string()
            };
            if let Err(e) = cleanup(c, &after).await {
                return Err(self.err(e));
            }
        }
        let (cols, rows, affected) = result.map_err(|e| self.err(e))?;
        let (columns, rows, truncated, cell_truncated) = shape(&cols, rows, max_rows);
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

    async fn savepoint_end(&self, c: &mut Conn, keep: bool) -> RunEnd {
        match self.server_in_tx(c).await {
            None => return RunEnd::RolledBack { note: None },
            Some(false) => return self.vanished(!keep),
            Some(true) => {}
        }
        if keep {
            return match cleanup(c, &format!("RELEASE SAVEPOINT {RUN_SAVEPOINT}")).await {
                Ok(()) => RunEnd::Kept,
                Err(e) => self.recovery_failed(c, e).await,
            };
        }
        if let Err(e) = cleanup(c, &format!("ROLLBACK TO SAVEPOINT {RUN_SAVEPOINT}")).await {
            return self.recovery_failed(c, e).await;
        }
        let nontx = self.nontx_note(c).await;
        match cleanup(c, &format!("RELEASE SAVEPOINT {RUN_SAVEPOINT}")).await {
            Ok(()) => RunEnd::Undone {
                note: Some(match nontx {
                    Some(n) => format!("{n}\n{}", lock_kept_note()),
                    None => lock_kept_note(),
                }),
            },
            Err(e) => self.recovery_failed(c, e).await,
        }
    }

    /// MySQL 은 그 전에 프로시저가 커밋했을 수 있어 결과는 늘 불명이다.
    async fn recovery_failed(&self, c: &mut Conn, e: mysql_async::Error) -> RunEnd {
        if is_fatal(&e) {
            let _ = self.err(e);
            return RunEnd::RolledBack { note: None };
        }
        let why = describe(&e);
        let rolled = cleanup(c, ROLLBACK_SQL).await.is_ok() && self.server_in_tx(c).await == Some(false);
        self.in_tx.store(false, Ordering::SeqCst);
        if !rolled {
            self.abandon();
        }
        RunEnd::Unknown(super::recovery_failed_note(&why, rolled, true))
    }

    async fn meta_prelude(&self, c: &mut Conn, timeout_ms: u64) -> Result<(), EngineError> {
        c.query_drop(self.flavor.limits_sql(None, timeout_ms)).await.map_err(|e| self.err(e))
    }

    pub(crate) async fn schema(&self, timeout_ms: u64) -> Result<Value, EngineError> {
        self.alive()?;
        let mut c = self.try_conn()?;
        self.meta_prelude(&mut c, timeout_ms).await?;
        let sys = SYSTEM_DBS.map(|s| format!("'{s}'")).join(", ");
        let r: Result<Vec<String>, mysql_async::Error> = c
            .query(format!(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
                 WHERE SCHEMA_NAME NOT IN ({sys}) OR SCHEMA_NAME = DATABASE() \
                 ORDER BY SCHEMA_NAME <> COALESCE(DATABASE(), ''), SCHEMA_NAME"
            ))
            .await;
        let reset = cleanup(&mut c, self.flavor.reset_sql()).await;
        let names = r.map_err(|e| self.err(e))?;
        reset.map_err(|e| self.err(e))?;
        let schemas: Vec<Value> = names.into_iter().map(|n| json!({ "name": n })).collect();
        Ok(json!({ "schemas": schemas }))
    }

    /// 데이터베이스 이름과 줄 상한은 **바인드 인자**. 이름이 없으면 연결의 기본 데이터베이스.
    pub(crate) async fn objects(&self, schema: Option<&str>, timeout_ms: u64) -> Result<Value, EngineError> {
        self.alive()?;
        let mut c = self.try_conn()?;
        self.meta_prelude(&mut c, timeout_ms).await?;
        let limit = (super::OBJECTS_MAX + 1) as u64;
        type Rel = (String, String, Option<String>, Option<u64>);
        type Routine = (String, String, Option<String>, Option<String>, Option<String>);
        type Lists = (Vec<Rel>, Vec<Routine>);
        let r: Result<Lists, mysql_async::Error> = async {
            let rels: Vec<Rel> = c
                .exec(
                    "SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT, TABLE_ROWS FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) ORDER BY TABLE_NAME LIMIT ?",
                    (schema, limit),
                )
                .await?;
            let routines: Vec<Routine> = c
                .exec(
                    "SELECT r.ROUTINE_NAME, r.ROUTINE_TYPE, r.DTD_IDENTIFIER, \
                     (SELECT GROUP_CONCAT(CONCAT_WS(' ', IF(p.ROUTINE_TYPE = 'FUNCTION', NULL, p.PARAMETER_MODE), p.PARAMETER_NAME, \n                     p.DTD_IDENTIFIER) \
                     ORDER BY p.ORDINAL_POSITION SEPARATOR ', ') FROM information_schema.PARAMETERS p \
                     WHERE p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME \
                     AND p.ROUTINE_TYPE = r.ROUTINE_TYPE AND p.ORDINAL_POSITION > 0), r.ROUTINE_COMMENT \
                     FROM information_schema.ROUTINES r \
                     WHERE r.ROUTINE_SCHEMA = COALESCE(?, DATABASE()) AND r.ROUTINE_TYPE IN ('FUNCTION', 'PROCEDURE') \
                     ORDER BY r.ROUTINE_NAME LIMIT ?",
                    (schema, limit),
                )
                .await?;
            Ok((rels, routines))
        }
        .await;
        let reset = cleanup(&mut c, self.flavor.reset_sql()).await;
        let (rels, routines) = r.map_err(|e| self.err(e))?;
        reset.map_err(|e| self.err(e))?;
        let rels: Vec<ObjectOut> = rels
            .into_iter()
            .map(|(name, ty, comment, rows)| table_object(name, &ty, comment, rows))
            .collect();
        let routines: Vec<ObjectOut> = routines
            .into_iter()
            .map(|(name, ty, returns, args, comment)| {
                let procedure = ty == "PROCEDURE";
                ObjectOut {
                    args: Some(args.unwrap_or_default()),
                    returns: if procedure { None } else { returns },
                    comment: comment_of(comment),
                    ..ObjectOut::new(if procedure { "procedure" } else { "function" }, name)
                }
            })
            .collect();
        let mut truncated = Vec::new();
        let mut out = cap_objects(rels, &["table", "view", "sequence"], &mut truncated);
        out.extend(cap_objects(routines, &["function", "procedure"], &mut truncated));
        Ok(objects_json(out, truncated))
    }

    /// 이름과 줄 상한은 **바인드 인자**이고, 트랜잭션을 열지 않는다(쓰기 모드에서 사람이 연 트랜잭션을 암묵 커밋하지 않게).
    pub(crate) async fn table_detail(&self, schema: Option<&str>, table: &str, timeout_ms: u64) -> Result<Value, EngineError> {
        self.alive()?;
        let mut c = self.try_conn()?;
        self.meta_prelude(&mut c, timeout_ms).await?;
        let limit = (super::OBJECTS_MAX + 1) as u64;
        type ColRow = (String, String, String, Option<String>, u64, Option<String>);
        type IdxRow = (String, i64, Option<String>, Option<i64>, String, Option<String>);
        type ConRow = (String, String, Option<String>, Option<String>);
        type FkRow = (String, String, String, String, String, String, String, Option<String>, Option<String>);
        type TrgRow = (String, String, String, Option<String>);
        type Lists = (Vec<ColRow>, Vec<IdxRow>, Vec<ConRow>, Vec<FkRow>, Vec<FkRow>, Vec<TrgRow>, Option<(String, Option<String>)>);
        let r: Result<Lists, mysql_async::Error> = async {
            let columns: Vec<ColRow> = c
                .exec(
                    "SELECT c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, COALESCE(k.ORDINAL_POSITION, 0), c.COLUMN_COMMENT \
                     FROM information_schema.COLUMNS c \
                     LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.TABLE_SCHEMA = c.TABLE_SCHEMA \
                     AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY' \
                     WHERE c.TABLE_SCHEMA = COALESCE(?, DATABASE()) AND c.TABLE_NAME = ? \
                     ORDER BY c.ORDINAL_POSITION LIMIT ?",
                    (schema, table, limit),
                )
                .await?;
            if columns.is_empty() {
                return Ok((columns, Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), None));
            }
            let head: Option<(String, Option<String>)> = c
                .exec_first(
                    "SELECT TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ?",
                    (schema, table),
                )
                .await?;
            let has: Vec<(String, String)> = c
                .exec(
                    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' \
                     AND ((TABLE_NAME = 'STATISTICS' AND COLUMN_NAME = 'EXPRESSION') \
                     OR (TABLE_NAME = 'CHECK_CONSTRAINTS' AND COLUMN_NAME IN ('CHECK_CLAUSE', 'TABLE_NAME')))",
                    (),
                )
                .await?;
            let feature = |t: &str, col: &str| has.iter().any(|(a, b)| a.eq_ignore_ascii_case(t) && b.eq_ignore_ascii_case(col));
            let indexes: Vec<IdxRow> = c
                .exec(
                    mysql_index_sql(feature("STATISTICS", "EXPRESSION")),
                    (schema, table, limit),
                )
                .await?;
            let constraints: Vec<ConRow> = c
                .exec(
                    mysql_constraint_sql(feature("CHECK_CONSTRAINTS", "CHECK_CLAUSE"), feature("CHECK_CONSTRAINTS", "TABLE_NAME")),
                    (schema, table, limit),
                )
                .await?;
            let fks: Vec<FkRow> = c.exec(mysql_fk_sql(false), (schema, table, limit)).await?;
            let refs: Vec<FkRow> = c.exec(mysql_fk_sql(true), (schema, table, limit)).await?;
            let triggers: Vec<TrgRow> = c
                .exec(
                    "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS \
                     WHERE EVENT_OBJECT_SCHEMA = COALESCE(?, DATABASE()) AND EVENT_OBJECT_TABLE = ? \
                     ORDER BY TRIGGER_NAME LIMIT ?",
                    (schema, table, limit),
                )
                .await?;
            Ok((columns, indexes, constraints, fks, refs, triggers, head))
        }
        .await;
        let reset = cleanup(&mut c, self.flavor.reset_sql()).await;
        let (columns, indexes, constraints, fks, refs, triggers, head) = r.map_err(|e| self.err(e))?;
        reset.map_err(|e| self.err(e))?;
        if columns.is_empty() {
            return Err(EngineError::Message(tr!(
                ko: "테이블 {table} 을(를) 찾지 못했습니다",
                en: "Could not find the table {table}"
            )));
        }
        let columns: Vec<Value> = columns
            .into_iter()
            .map(|(name, ty, nullable, default, pk, comment)| {
                let default = self.flavor.column_default(default);
                detail::column_json(name, ty, nullable == "NO", default, pk as i64, comment)
            })
            .collect();
        let indexes = detail::group_runs(indexes, |r| r.0.clone())
            .into_iter()
            .map(|g| IndexOut {
                name: g[0].0.clone(),
                unique: g[0].1 == 0,
                primary: g[0].0 == "PRIMARY",
                method: Some(g[0].4.clone()),
                columns: g.iter().map(|r| Some(mysql_index_column(r.2.as_deref(), r.3, r.5.as_deref()))).collect(),
                predicate: None,
                definition: None,
            })
            .collect();
        let constraints = detail::group_runs(constraints, |r| (r.0.clone(), r.1.clone()))
            .into_iter()
            .map(|g| {
                let ty = match g[0].1.as_str() {
                    "PRIMARY KEY" => "primary",
                    "UNIQUE" => "unique",
                    _ => "check",
                };
                ConstraintOut {
                    name: Some(g[0].0.clone()),
                    ty,
                    columns: g.iter().filter_map(|r| r.2.clone()).collect(),
                    definition: g[0].3.as_ref().map(|e| format!("CHECK ({e})")),
                }
            })
            .collect();
        Ok(TableDetail {
            comment: head.and_then(|(ty, comment)| table_object(String::new(), &ty, comment, None).comment),
            columns,
            indexes,
            constraints,
            foreign_keys: mysql_fks(fks),
            referenced_by: mysql_fks(refs),
            triggers: triggers
                .into_iter()
                .map(|(name, timing, event, body)| TriggerOut {
                    name,
                    detail: format!("{timing} {event}"),
                    definition: body,
                })
                .collect(),
            partitions: Vec::new(),
            truncated: Vec::new(),
        }
        .json())
    }

    /// 식별자는 바인드가 안 되므로 먼저 `information_schema` 에 바인드 질의로 있는지 확인하고, 카탈로그가 돌려준 이름을 인용해
    /// 넣는다. 서버가 prepare 로 받지 않으면(1295) 같은 글자를 글자 프로토콜로 한 번 — 고정 꼴 + 확인된 식별자뿐이라 문장이 하나다.
    pub(crate) async fn definition(&self, t: &DefTarget, timeout_ms: u64) -> Result<Value, EngineError> {
        let kind = definition::check(t)?;
        let Some((lookup, word)) = definition::mysql_lookup(kind) else {
            return Err(definition::unsupported(&t.kind));
        };
        self.alive()?;
        let mut c = self.try_conn()?;
        self.meta_prelude(&mut c, timeout_ms).await?;
        let schema = t.schema.as_deref();
        let name = t.name.as_str();
        let r: Result<Option<Option<String>>, mysql_async::Error> = async {
            let found: Option<(String, String)> = c.exec_first(lookup, (schema, name)).await?;
            let Some((s, n)) = found else {
                return Ok(None);
            };
            let sql = definition::mysql_show_sql(word, &s, &n);
            let row: Option<Row> = match c.exec_first(sql.as_str(), ()).await {
                Err(e) if server_code(&e) == Some(ER_UNSUPPORTED_PS) => c.query_first(sql.as_str()).await?,
                Err(e) if matches!(server_code(&e), Some(ER_TABLEACCESS_DENIED | ER_SPECIFIC_ACCESS_DENIED)) => return Ok(Some(None)),
                r => r?,
            };
            let Some(row) = row else {
                return Ok(None);
            };
            let names: Vec<String> = row.columns_ref().iter().map(|c| c.name_str().into_owned()).collect();
            let Some(i) = definition::mysql_definition_column(&names) else {
                return Ok(Some(None));
            };
            Ok(Some(row.get_opt::<Option<String>, usize>(i).and_then(Result::ok).flatten()))
        }
        .await;
        let reset = cleanup(&mut c, self.flavor.reset_sql()).await;
        let found = r.map_err(|e| self.err(e))?;
        reset.map_err(|e| self.err(e))?;
        match found {
            None => Err(definition::not_found(t)),
            Some(None) => Err(definition::hidden(&t.name)),
            Some(Some(sql)) => Ok(DefinitionOut::new(definition::with_semicolon(&sql), false).json()),
        }
    }

    /// 끌 때는 먼저 `ROLLBACK` + `autocommit = 1` — 그러지 않으면 다음 `START TRANSACTION READ ONLY` 가 사람이 연 트랜잭션을 **암묵 커밋**한다.
    pub(crate) async fn set_write(&self, on: bool) -> Result<(), EngineError> {
        self.alive()?;
        let mut c = self.try_conn()?;
        if self.writable() == on {
            return Ok(());
        }
        let sql = if on {
            "SET SESSION TRANSACTION READ WRITE"
        } else {
            "ROLLBACK AND NO CHAIN NO RELEASE; SET SESSION autocommit = 1; SET SESSION TRANSACTION READ ONLY"
        };
        c.query_drop(sql).await.map_err(|e| self.err(e))?;
        self.writable.store(on, Ordering::SeqCst);
        self.in_tx.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// 오류인데 `IN_TRANS` 가 꺼졌으면 교착 1213 · 1205 만 "서버가 전체를 되감음", 그 밖은 **결과 불명**. 커밋 직전에 취소 · 전체 시한을 다시 본다.
    pub(crate) async fn script(
        &self,
        plan: &[script::Planned],
        mode: script::ScriptMode,
        max_rows: usize,
        ctl: &Arc<script::Ctl>,
    ) -> Result<script::EngineRun, EngineError> {
        use script::{End, ScriptMode};
        self.alive()?;
        let mut c = self.try_conn()?;
        let in_work = mode == ScriptMode::InWork;
        let state_ok = match mode {
            ScriptMode::InWork => self.in_tx(),
            ScriptMode::Write => self.writable() && !self.in_tx(),
        // 쓰기 모드에서도 받는다 — 자동 커밋을 끈 타일의 조회만 든 스크립트.
            ScriptMode::ReadOnly => !self.in_tx(),
        };
        if !state_ok {
            return Err(script::state_changed());
        }
        if in_work {
            cleanup(&mut c, &format!("SAVEPOINT {RUN_SAVEPOINT}")).await.map_err(|e| self.err(e))?;
        } else {
            let begin = if mode == ScriptMode::ReadOnly { "START TRANSACTION READ ONLY" } else { "START TRANSACTION" };
            c.query_drop(begin).await.map_err(|e| self.err(e))?;
        }
        let mut run = script::EngineRun::new();
        let mut vanished: Option<RunEnd> = None;
        let mut dead = false;
        for p in plan {
            let Some(ms) = ctl.begin_stmt() else {
                run.stopped = ctl.stopped();
                break;
            };
            let started = Instant::now();
            let killed = Arc::new(AtomicBool::new(false));
            let mut r = self.run(&mut c, p.text(), p.keyword(), false, max_rows, ms, Some(&killed)).await;
            ctl.end_stmt();
        // 앱 타이머가 끊었는데 문장이 성공으로 돌아왔다(`SLEEP()` 은 끊겨도 1).
            if r.is_ok() && killed.load(Ordering::SeqCst) {
                r = Err(EngineError::Interrupted);
            }
            if self.is_dead() {
                run.failed = Some(r.err().unwrap_or_else(|| EngineError::Message(disconnected())));
                dead = true;
                break;
            }
            let in_trans = self.server_in_tx(&mut c).await;
            match r {
                Ok(out) => {
                    run.done.push(ctl.keep(QueryOut {
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        ..out
                    }));
                    if in_trans != Some(true) {
                        vanished = Some(self.vanished(false));
                        break;
                    }
                }
                Err(e) => {
                    run.failed = Some(e);
                    if in_trans != Some(true) {
                        vanished = Some(self.vanished(true));
                    }
                    break;
                }
            }
        }
        if dead {
            run.end = if in_work { End::WorkEnded } else { End::Disconnected };
            return Ok(run);
        }
        if in_work {
            // 세이브포인트를 풀기 직전에 다시 본다(마지막 문장의 취소가 그 실행을 남기지 않게).
            if run.failed.is_none() && run.stopped.is_none() {
                run.stopped = ctl.stopped();
            }
            let end = match vanished {
                Some(v) => v,
                None => self.savepoint_end(&mut c, run.failed.is_none() && run.stopped.is_none()).await,
            };
            self.sync_tx(&mut c).await;
            run.end = if self.is_dead() { End::Disconnected } else { End::in_work(end, &mut run) };
            return Ok(run);
        }
        match vanished {
            Some(RunEnd::RolledBack { .. }) => {
                run.end = End::RolledBack;
                return Ok(run);
            }
            Some(_) => {
                run.end = End::EndedByStatement;
                return Ok(run);
            }
            None => {}
        }
        if mode == ScriptMode::ReadOnly || run.must_roll_back(ctl) {
            if run.stopped.is_none() && mode != ScriptMode::ReadOnly {
                run.stopped = ctl.stopped();
            }
            run.end = match cleanup(&mut c, ROLLBACK_SQL).await {
                Ok(()) if mode == ScriptMode::ReadOnly => End::ReadOnlyDone,
                Ok(()) => {
                    run.note = self.nontx_note(&mut c).await;
                    End::RolledBack
                }
                Err(e) => {
                    let _ = self.err(e);
                    End::Disconnected
                }
            };
            if !self.is_dead() {
                self.ensure_ended(&mut c).await;
            }
            return Ok(run);
        }
        // 커밋 — 끊지 않는다. 답을 못 받으면 결과 불명.
        run.end = match tokio::time::timeout(super::pg::COMMIT_TIMEOUT, c.query_drop(COMMIT_SQL)).await {
            Ok(Ok(())) if self.ensure_ended(&mut c).await => End::Committed,
            Ok(Ok(())) => End::CommitLost(tx_left_note()),
            Ok(Err(e)) if is_fatal(&e) => {
                let _ = self.err(e);
                End::CommitLost(disconnected())
            }
            Ok(Err(e)) => {
                let m = describe(&e);
                if self.server_in_tx(&mut c).await == Some(true) {
                    let _ = cleanup(&mut c, ROLLBACK_SQL).await;
                }
                End::CommitFailed(m)
            }
            Err(_) => End::CommitLost(super::pg::commit_timeout_note()),
        };
        Ok(run)
    }
}

fn nontx_rollback_note() -> String {
    tr!(
        ko: "주의: 트랜잭션을 지원하지 않는 테이블(MyISAM 등)의 변경은 되돌려지지 않았습니다(MySQL 경고 1196) — 그 테이블의 데이터를 확인하세요.",
        en: "Warning: changes to non-transactional tables (MyISAM, etc.) were not rolled back (MySQL warning 1196) — check that table's data."
    )
}

pub(crate) fn lock_kept_note() -> String {
    tr!(
        ko: "MySQL · MariaDB 는 되돌린 실행이 잡은 행 잠금을 작업이 끝날 때까지 쥘 수 있습니다 — 다른 연결이 기다리면 [커밋]이나 [되돌리기]로 작업을 끝내세요.",
        en: "MySQL · MariaDB may keep the row locks taken by the rolled-back run until the transaction ends — if other connections wait, finish with [Commit] or [Roll back]."
    )
}

fn tx_left_note() -> String {
    tr!(
        ko: "서버가 끝내기를 받았는데 트랜잭션이 남아 있어(체인 · 숨은 트랜잭션) 정리하지 못했습니다 — 연결을 끊었습니다. 결과를 확인하세요",
        en: "The server accepted the end of the transaction but one is still open (chain · hidden transaction) and could not be cleared — the connection was closed. Check the result"
    )
}

/// `count` 면(MariaDB `… RETURNING`) 흘려 받은 줄까지 세어 영향 행 수로 준다.
async fn exec_user(
    c: &mut Conn,
    text: &str,
    max_rows: usize,
    count: bool,
) -> Result<(Arc<[Column]>, Vec<Row>, Option<u64>), mysql_async::Error> {
    let stmt = c.prep(text).await?;
    let r: Result<_, mysql_async::Error> = async {
        let mut result = c.exec_iter(&stmt, ()).await?;
        let cols = result.columns().unwrap_or_default();
        let mut affected = cols.is_empty().then(|| result.affected_rows());
        let mut rows = Vec::new();
        let mut seen = 0u64;
        while let Some(row) = result.next().await? {
            seen += 1;
            if rows.len() <= max_rows {
                rows.push(row);
            }
        }
        if count && !cols.is_empty() {
            affected = Some(seen);
        }
        result.drop_result().await?;
        Ok((cols, rows, affected))
    }
    .await;
    if !r.as_ref().err().is_some_and(is_fatal) {
        let _ = c.close(stmt).await;
    }
    r
}

/// KILL 이 마침 이 문장에 닿았으면(1317) 한 번 더. 시한을 넘으면 연결이 끊긴 것으로 본다.
async fn cleanup(c: &mut Conn, sql: &str) -> Result<(), mysql_async::Error> {
    for attempt in 0..2 {
        match tokio::time::timeout(CLEANUP_TIMEOUT, c.query_drop(sql)).await {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(e)) if attempt == 0 && server_code(&e) == Some(ER_QUERY_INTERRUPTED) => continue,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed)),
        }
    }
    Ok(())
}

fn kill_query(control: &Arc<tokio::sync::Mutex<Option<Conn>>>, id: u32) {
    kill(control, format!("KILL QUERY {id}"));
}

/// 열린 트랜잭션은 서버가 되돌린다.
fn kill_connection(control: &Arc<tokio::sync::Mutex<Option<Conn>>>, id: u32) {
    kill(control, format!("KILL CONNECTION {id}"));
}

fn kill(control: &Arc<tokio::sync::Mutex<Option<Conn>>>, sql: String) {
    let Ok(rt) = tokio::runtime::Handle::try_current() else {
        return;
    };
    let control = Arc::clone(control);
    rt.spawn(async move {
        let mut g = control.lock().await;
        if let Some(c) = g.as_mut() {
            if let Err(e) = c.query_drop(sql).await {
                if is_fatal(&e) {
                    *g = None;
                }
            }
        }
    });
}

/// ping 이 실패하면 연결이 죽은 것으로 본다(제어와 본 연결은 같은 길이다).
fn spawn_heartbeat(control: Arc<tokio::sync::Mutex<Option<Conn>>>, life: Arc<Life>) -> AbortHandle {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT).await;
            let mut g = control.lock().await;
            let Some(c) = g.as_mut() else {
                life.mark_dead();
                return;
            };
            let ok = matches!(tokio::time::timeout(PING_TIMEOUT, c.ping()).await, Ok(Ok(())));
            if !ok {
                *g = None;
                life.mark_dead();
                return;
            }
        }
    })
    .abort_handle()
}

/// `expression` = `STATISTICS.EXPRESSION` 칸이 있다(MySQL 8.0.13+).
pub(crate) fn mysql_index_sql(expression: bool) -> &'static str {
    if expression {
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, INDEX_TYPE, EXPRESSION FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? ORDER BY INDEX_NAME <> 'PRIMARY', INDEX_NAME, SEQ_IN_INDEX LIMIT ?"
    } else {
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, INDEX_TYPE, NULL FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? ORDER BY INDEX_NAME <> 'PRIMARY', INDEX_NAME, SEQ_IN_INDEX LIMIT ?"
    }
}

/// `check_table` — MariaDB 는 체크 이름이 테이블마다라 테이블까지 맞춘다(MySQL 은 데이터베이스마다).
pub(crate) fn mysql_constraint_sql(check: bool, check_table: bool) -> String {
    let (clause, join) = match (check, check_table) {
        (false, _) => ("NULL", String::new()),
        (true, t) => (
            "cc.CHECK_CLAUSE",
            format!(
                " LEFT JOIN information_schema.CHECK_CONSTRAINTS cc ON tc.CONSTRAINT_TYPE = 'CHECK' \
                 AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME{}",
                if t { " AND cc.TABLE_NAME = tc.TABLE_NAME" } else { "" }
            ),
        ),
    };
    format!(
        "SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, k.COLUMN_NAME, {clause} \
         FROM information_schema.TABLE_CONSTRAINTS tc \
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA \
         AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
         AND k.REFERENCED_TABLE_NAME IS NULL{join} \
         WHERE tc.TABLE_SCHEMA = COALESCE(?, DATABASE()) AND tc.TABLE_NAME = ? \
         AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'CHECK') \
         ORDER BY FIELD(tc.CONSTRAINT_TYPE, 'PRIMARY KEY', 'UNIQUE', 'CHECK'), tc.CONSTRAINT_NAME, k.ORDINAL_POSITION LIMIT ?"
    )
}

/// `REFERENTIAL_CONSTRAINTS` 는 바깥 조인 — MariaDB 는 `SELECT` 권한만 든 계정에 그 표를 비워 보인다.
pub(crate) fn mysql_fk_sql(incoming: bool) -> &'static str {
    if incoming {
        "SELECT k.CONSTRAINT_NAME, k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, \
         k.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k \
         LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA \
         AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME \
         WHERE k.REFERENCED_TABLE_SCHEMA = COALESCE(?, DATABASE()) AND k.REFERENCED_TABLE_NAME = ? \
         ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION LIMIT ?"
    } else {
        "SELECT k.CONSTRAINT_NAME, k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, \
         k.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k \
         LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA \
         AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME \
         WHERE k.TABLE_SCHEMA = COALESCE(?, DATABASE()) AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION LIMIT ?"
    }
}

pub(crate) fn mysql_index_column(column: Option<&str>, sub_part: Option<i64>, expression: Option<&str>) -> String {
    match (column, expression) {
        (Some(c), _) => match sub_part {
            Some(n) => format!("{c}({n})"),
            None => c.to_string(),
        },
        (None, Some(e)) => format!("({e})"),
        (None, None) => String::new(),
    }
}

#[allow(clippy::type_complexity)]
pub(crate) fn mysql_fks(rows: Vec<(String, String, String, String, String, String, String, Option<String>, Option<String>)>) -> Vec<ForeignKeyOut> {
    detail::group_runs(rows, |r| (r.1.clone(), r.2.clone(), r.0.clone()))
        .into_iter()
        .map(|g| {
            let f = &g[0];
            ForeignKeyOut {
                name: Some(f.0.clone()),
                schema: f.1.clone(),
                table: f.2.clone(),
                columns: g.iter().map(|r| r.3.clone()).collect(),
                ref_schema: f.4.clone(),
                ref_table: f.5.clone(),
                ref_columns: g.iter().map(|r| r.6.clone()).collect(),
                on_update: f.7.clone(),
                on_delete: f.8.clone(),
            }
        })
        .collect()
}

/// MySQL 의 `SYSTEM VIEW` 도 뷰다.
pub(crate) fn table_kind(ty: &str) -> &'static str {
    if ty.contains("VIEW") {
        "view"
    } else if ty == "SEQUENCE" {
        "sequence"
    } else {
        "table"
    }
}

/// 뷰의 `TABLE_COMMENT` 는 설명이 아니라 글자 `VIEW` 이고(뷰에는 설명이 없다), `TABLE_ROWS` 는 테이블만 뜻이 있다(시퀀스는 싣지 않는다).
pub(crate) fn table_object(name: String, ty: &str, comment: Option<String>, rows: Option<u64>) -> ObjectOut {
    let kind = table_kind(ty);
    ObjectOut {
        comment: if kind == "view" { None } else { comment_of(comment) },
        rows: if kind == "table" { rows } else { None },
        ..ObjectOut::new(kind, name)
    }
}

fn shape(cols: &[Column], rows: Vec<Row>, max_rows: usize) -> (Vec<ColumnOut>, Vec<Vec<Value>>, bool, bool) {
    let columns: Vec<ColumnOut> = cols
        .iter()
        .map(|c| ColumnOut {
            name: c.name_str().into_owned(),
            ty: mysql_value::type_label(c),
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
            let (j, cut) = value::to_json(mysql_value::decode(col, row.as_ref(i)));
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
