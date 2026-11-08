//! **SQLite 엔진**(rusqlite 0.40, bundled) — 모든 함수가 **블로킹**이다(부르는 쪽 `table` 이 블로킹 풀에서 부른다 — 서버의
//! 비동기 고리를 막지 않는다).
//!
//! - **읽기 전용**: `SQLITE_OPEN_READ_ONLY` 로 열고 `PRAGMA query_only=ON` 을 건다(파일·연결 두 겹). 쓰기를 켜면
//!   `SQLITE_OPEN_READ_WRITE` 로 **다시 연다**(끄면 다시 읽기 전용으로 — 열린 트랜잭션은 그때 되감긴다).
//!   만들기(`CREATE`)·URI(`file:…?mode=rwc`) 깃발은 쓰지 않는다 — 없는 파일을 만들지 않고 경로 글자가 열기 방식을 바꾸지 못한다.
//! - **문장 하나**: 가드(`guard::check`) 다음에 prepare 꼬리(`Error::MultipleStatement`)로 한 번 더.
//! - **쓰기 문장**: 읽기 전용 모드에서 `Statement::readonly()` 가 거짓이면 실행하지 않는다(가드 · `query_only` 에 더해 셋째 겹).
//! - **끊기**: [`Sqlite::interrupt`] (`InterruptHandle` — 다른 스레드에서) → 도는 문장이 `OperationInterrupted` 로 끝난다.
//! - **한 번에 하나**: 연결 잠금을 `try_lock` 으로 잡는다 — 이미 돌고 있으면 [`EngineError::Busy`](줄 세우지 않는다 —
//!   기다리는 동안 시간 제한이 엉뚱하게 흐르지 않게).
//! - 행 상한은 반복자를 그 자리에서 멈추면 끝(드레인 없음 — 스파이크 실측).
//! - **트랜잭션 작업**(1단계 — 상태는 `table` · `tx`): 앱 고정 `BEGIN DEFERRED` 로 열고 `COMMIT` · `ROLLBACK` 으로 닫는다. 그 사이
//!   문장은 같은 연결에서 돈다(메타 조회도 — 트랜잭션 안에서 내 변경이 보인다). 진실은 엔진의 `is_autocommit()` 이다 — 문장마다
//!   다시 읽어(10-13 실측: `interrupt` 로 끊긴 쓰기 · `INSERT OR ROLLBACK` 충돌은 SQLite 가 **트랜잭션 전체**를 되감는다) 표가 "오류로
//!   되돌려짐" 을 안다. 문장만 실패한 경우(UNIQUE · 없는 표 · 트랜잭션 안 `VACUUM`)는 작업이 계속된다.
//! - 실행 한 번의 정리([`Sqlite::savepoint_end`] → [`RunEnd`] — Codex 검토 반영 1): 세이브포인트를 풀기 직전에 멈춤 깃발(취소 · 스크립트
//!   전체 시한)을 다시 보고, `ROLLBACK TO` 가 성공했을 때만 "복구 성공". 정리에 실패하면 더 실행하지 않고 작업 전체를 되돌린다(사람 문장은
//!   트랜잭션을 끝낼 수 없어 — 가드 — 되돌림이 증명된다). 되돌리기마저 실패하면 연결을 다시 연다(닫히는 연결의 트랜잭션은 되감긴다).
//! - `SQLITE_BUSY_SNAPSHOT`(WAL — 이 트랜잭션의 스냅숏이 낡아 쓰기를 못 함)은 "작업을 처음부터 다시" 를 붙인다(같은 문장만 다시 해서는 풀리지
//!   않는다).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

use rusqlite::{ffi::ErrorCode, Connection, InterruptHandle, OpenFlags};
use serde_json::{json, Value};

use super::definition::{self, DefKind, DefTarget, DefinitionOut};
use super::guard::{self, GuardError};
use super::value::{self, approx_len};
use super::detail::{self, ConstraintOut, ForeignKeyOut, IndexOut, TableDetail, TriggerOut};
use super::{cap_objects, objects_json, ColumnOut, Dialect, EngineError, ObjectOut, QueryOut, RunEnd, RESPONSE_MAX, RUN_SAVEPOINT};
use crate::i18n::tr;

/// 잠긴 DB 를 기다리는 시간(다른 프로세스가 쓰는 중).
const BUSY_WAIT: Duration = Duration::from_secs(2);

/// SQLite 연결 하나.
pub(crate) struct Sqlite {
    path: PathBuf,
    conn: Mutex<Connection>,
    interrupt: Mutex<InterruptHandle>,
    writable: AtomicBool,
    /// 앱이 연 트랜잭션 안인가 — 연결 잠금을 쥔 일마다 `!is_autocommit()` 로 맞춘다(1단계).
    in_tx: AtomicBool,
    /// 마지막 작업 안 실행 한 번의 정리([`RunEnd`]) — 표가 꺼내 간다(`take_run_end`).
    last_run: Mutex<Option<RunEnd>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn open_conn(path: &Path, writable: bool) -> Result<Connection, String> {
    if !path.is_absolute() {
        return Err(tr!(
            ko: "SQLite 파일 경로는 절대 경로여야 합니다",
            en: "The SQLite file path must be absolute"
        ));
    }
    let mode = if writable {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    let conn = Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| {
        tr!(
            ko: "SQLite 파일을 열지 못했습니다 ({path}): {e}",
            en: "Could not open the SQLite file ({path}): {e}",
            path = path.display()
        )
    })?;
    let setup = conn.busy_timeout(BUSY_WAIT).and_then(|_| {
        if writable {
            Ok(())
        } else {
            conn.pragma_update(None, "query_only", true)
        }
    });
    setup.map_err(|e| tr!(ko: "SQLite 연결을 준비하지 못했습니다: {e}", en: "Could not prepare the SQLite connection: {e}"))?;
    Ok(conn)
}

/// rusqlite 오류 → 엔진 오류(끊김은 따로).
fn engine_err(e: rusqlite::Error) -> EngineError {
    if e.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) {
        return EngineError::Interrupted;
    }
    if matches!(e, rusqlite::Error::MultipleStatement) {
        return GuardError::Multiple.into();
    }
    if let rusqlite::Error::SqliteFailure(f, _) = &e {
        if f.extended_code == rusqlite::ffi::SQLITE_BUSY_SNAPSHOT {
            return EngineError::Message(format!(
                "{}\n{}",
                tr!(ko: "SQLite 오류: {e}", en: "SQLite error: {e}"),
                super::serialization_note()
            ));
        }
    }
    EngineError::Message(tr!(ko: "SQLite 오류: {e}", en: "SQLite error: {e}"))
}

/// 붙인 DB 이름(`main` · `temp` · `ATTACH` 이름) — `seq` 순.
fn database_names(conn: &Connection) -> Result<Vec<String>, EngineError> {
    let mut st = conn
        .prepare("SELECT name FROM pragma_database_list ORDER BY seq")
        .map_err(engine_err)?;
    let it = st.query_map([], |r| r.get::<_, String>(0)).map_err(engine_err)?;
    it.collect::<Result<_, _>>().map_err(engine_err)
}

/// 붙인 DB 이름인가 — 이름은 **바인드 인자**(식별자 자리에 넣기 전에 확인한다).
fn known_database(conn: &Connection, name: &str) -> Result<bool, EngineError> {
    conn.query_row("SELECT EXISTS (SELECT 1 FROM pragma_database_list WHERE name = ?1)", [name], |r| r.get(0))
        .map_err(engine_err)
}

/// 앱 고정 문장 하나 → 줄 목록.
fn query_rows<T>(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    f: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, EngineError> {
    let mut st = conn.prepare(sql).map_err(engine_err)?;
    let it = st.query_map(params, f).map_err(engine_err)?;
    it.collect::<Result<_, _>>().map_err(engine_err)
}

/// 식별자를 큰따옴표로(안의 `"` 는 둘로).
fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

impl Sqlite {
    /// 연다 — 읽기 전용이 기본(`writable` 은 다시 붙기 뒤의 모양을 잇는 자리 — 지금 `db_open` 은 늘 거짓).
    pub(crate) fn open(path: &Path, writable: bool) -> Result<Sqlite, String> {
        let conn = open_conn(path, writable)?;
        let interrupt = conn.get_interrupt_handle();
        Ok(Sqlite {
            path: path.to_path_buf(),
            conn: Mutex::new(conn),
            interrupt: Mutex::new(interrupt),
            writable: AtomicBool::new(writable),
            in_tx: AtomicBool::new(false),
            last_run: Mutex::new(None),
        })
    }

    /// 엔진 판 — `SQLite 3.x.y`.
    pub(crate) fn server_version() -> String {
        format!("SQLite {}", rusqlite::version())
    }

    pub(crate) fn writable(&self) -> bool {
        self.writable.load(Ordering::SeqCst)
    }

    /// **시험 전용** — 연결이 트랜잭션 밖(자동 커밋)인가(`sqlite3_get_autocommit` — 10-13 실측: 사람 BEGIN·되감김을 정확히 따른다).
    #[cfg(test)]
    pub(crate) fn is_autocommit(&self) -> bool {
        lock(&self.conn).is_autocommit()
    }

    /// 도는 문장을 끊는다(아무것도 안 돌면 아무 일도 없다) — 어느 스레드에서든.
    pub(crate) fn interrupt(&self) {
        lock(&self.interrupt).interrupt();
    }

    /// **시험 전용** — 연결 잠금을 쥔다(표의 조정 장치 밖에서 엔진을 바쁘게 — 방치 되돌리기의 바쁨 재시도 시험).
    #[cfg(test)]
    pub(crate) fn hold_for_test(&self) -> std::sync::MutexGuard<'_, Connection> {
        lock(&self.conn)
    }

    fn try_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, EngineError> {
        match self.conn.try_lock() {
            Ok(g) => Ok(g),
            Err(TryLockError::Poisoned(p)) => Ok(p.into_inner()),
            Err(TryLockError::WouldBlock) => Err(EngineError::Busy),
        }
    }

    /// 앱이 연 트랜잭션 안인가(마지막 일 뒤의 엔진 상태).
    pub(crate) fn in_tx(&self) -> bool {
        self.in_tx.load(Ordering::SeqCst)
    }

    /// 엔진의 진실로 맞춘다 — 연결 잠금을 쥔 채로.
    fn sync_tx(&self, conn: &Connection) {
        self.in_tx.store(!conn.is_autocommit(), Ordering::SeqCst);
    }

    /// 트랜잭션 작업을 연다 — 앱 고정 `BEGIN DEFERRED`(첫 쓰기에서 잠금을 잡는다 — 조회만 하면 다른 연결을 막지 않는다).
    pub(crate) fn tx_begin(&self) -> Result<(), EngineError> {
        let conn = self.try_conn()?;
        if !conn.is_autocommit() {
            return Err(EngineError::Message(super::tx::Refusal::AlreadyOpen.message()));
        }
        let r = conn.execute_batch("BEGIN DEFERRED").map_err(engine_err);
        self.sync_tx(&conn);
        r
    }

    /// 트랜잭션 작업을 끝낸다 — 앱 고정 `COMMIT` · `ROLLBACK`. 실패하면(다른 연결의 읽기가 커밋을 막는 `SQLITE_BUSY` 등) 작업이
    /// 남았는지는 [`Sqlite::in_tx`] 가 말한다.
    pub(crate) fn tx_end(&self, commit: bool) -> Result<Option<String>, super::TxEndError> {
        let conn = self.try_conn().map_err(|_| super::TxEndError::Busy)?;
        let r = conn.execute_batch(if commit { "COMMIT" } else { "ROLLBACK" });
        self.sync_tx(&conn);
        r.map(|()| None).map_err(|e| super::TxEndError::Failed(match engine_err(e) {
            EngineError::Message(m) => m,
            other => format!("{other:?}"),
        }))
    }

    /// 결과를 확인하지 못한 실행이 남은 연결을 버린다 — SQLite 는 표가 끝까지 기다리므로(`table::run_timed`) 버릴 일이 없다.
    pub(crate) fn abandon(&self) {}

    /// 마지막 작업 안 실행 한 번의 정리를 꺼낸다(표가 한 번).
    pub(crate) fn take_run_end(&self) -> Option<RunEnd> {
        lock(&self.last_run).take()
    }

    /// 문장 하나를 돌린다 — 행 상한 `max_rows`, 칸 상한 · 응답 상한은 [`value`]·[`RESPONSE_MAX`].
    pub(crate) fn query(&self, sql: &str, max_rows: usize) -> Result<QueryOut, EngineError> {
        self.query_as(sql, max_rows, false)
    }

    /// [`Sqlite::query`] — `read` 면 쓰기 모드여도 **읽기 전용 길**(가드의 허용 목록 + `Statement::readonly()` 겹)로 돈다(자동 커밋을 끈
    /// 타일의 작업 밖 조회). 바꾸는 문장이면 실행 전에 [`EngineError::ReadOnlyRefused`]. 작업 안이면 `read` 를 보지 않고 문장 하나를
    /// **세이브포인트**(`RUN_SAVEPOINT`)로 감싼다(10-14 결정 — 실패하면 이번 실행분만 되돌림).
    pub(crate) fn query_as(&self, sql: &str, max_rows: usize, read: bool) -> Result<QueryOut, EngineError> {
        self.query_ctl(sql, max_rows, read, &AtomicBool::new(false))
    }

    /// [`Sqlite::query_as`] + 멈춤 깃발(`stop` — 표의 취소 · 시한 그물). 작업 안이면 세이브포인트를 풀기 직전에 그 깃발을 다시 본다(섰으면
    /// 성공한 실행도 되돌리고 [`EngineError::Interrupted`] — Codex 검토 반영 1). 정리 결과는 [`Sqlite::take_run_end`] 로.
    pub(crate) fn query_ctl(&self, sql: &str, max_rows: usize, read: bool, stop: &AtomicBool) -> Result<QueryOut, EngineError> {
        let mut conn = self.try_conn()?;
        *lock(&self.last_run) = None;
        let in_work = self.writable() && self.in_tx() && !conn.is_autocommit();
        let r = if in_work {
            conn.execute_batch(&format!("SAVEPOINT {RUN_SAVEPOINT}")).map_err(engine_err)?;
            let mut r = self.query_on(&conn, sql, max_rows, false);
            if r.is_ok() && stop.load(Ordering::SeqCst) {
                r = Err(EngineError::Interrupted);
            }
            let end = self.savepoint_end(&mut conn, r.is_ok());
            *lock(&self.last_run) = Some(end);
            r
        } else {
            self.query_on(&conn, sql, max_rows, read)
        };
        self.sync_tx(&conn);
        r
    }

    /// 실행 한 번의 뒤(작업 안) — 세이브포인트를 정리하고 그 결과([`RunEnd`] — Codex 검토 반영 1):
    /// - SQLite 가 트랜잭션 전체를 되감았으면(끊긴 쓰기 · `OR ROLLBACK`) 세이브포인트도 없다 — 건드리지 않는다(밖에서 `SAVEPOINT` 를 다시
    ///   걸면 새 트랜잭션이 열린다). 실패한 실행이면 되돌림(사람 문장은 트랜잭션을 커밋할 수 없다 — 가드), 성공했는데 사라졌으면 결과 불명.
    /// - `keep` 이면 `RELEASE`(유지), 아니면 `ROLLBACK TO` + `RELEASE`(복구 성공).
    /// - 정리가 실패하면 더 실행하지 않고 작업 전체를 `ROLLBACK` — 그마저 실패하면 연결을 다시 연다(닫히는 연결의 트랜잭션은 되감긴다).
    fn savepoint_end(&self, conn: &mut Connection, keep: bool) -> RunEnd {
        if conn.is_autocommit() {
            return if keep {
                RunEnd::Unknown(super::tx_vanished_note())
            } else {
                RunEnd::RolledBack { note: None }
            };
        }
        let sql = if keep {
            format!("RELEASE {RUN_SAVEPOINT}")
        } else {
            format!("ROLLBACK TO {RUN_SAVEPOINT}; RELEASE {RUN_SAVEPOINT}")
        };
        let e = match conn.execute_batch(&sql) {
            Ok(()) if keep => return RunEnd::Kept,
            Ok(()) => return RunEnd::Undone { note: None },
            Err(e) => e,
        };
        let why = e.to_string();
        if conn.execute_batch("ROLLBACK").is_ok() && conn.is_autocommit() {
            return RunEnd::RolledBack { note: Some(super::recovery_failed_note(&why, true, false)) };
        }
        // 되돌리지 못했다 — 연결을 새로 열어 옛것을 닫는다(트랜잭션이 되감긴다 · 같은 모드).
        match open_conn(&self.path, self.writable()) {
            Ok(fresh) => {
                *lock(&self.interrupt) = fresh.get_interrupt_handle();
                *conn = fresh;
                RunEnd::RolledBack { note: Some(super::recovery_failed_note(&why, false, false)) }
            }
            Err(m) => RunEnd::Unknown(format!("{}\n{m}", super::recovery_failed_note(&why, false, false))),
        }
    }

    /// 문장 하나 — `read_only` 면 읽기 전용 규칙(가드 허용 목록 + `readonly()` 겹 — 쓰기 모드 연결이면 거절은 `ReadOnlyRefused`).
    fn query_on(&self, conn: &Connection, sql: &str, max_rows: usize, read_only: bool) -> Result<QueryOut, EngineError> {
        let started = Instant::now();
        // 잠금을 쥔 뒤에 읽는다 — 쓰기 전환(`set_write`)도 같은 잠금 안에서 바뀐다.
        let writable = self.writable();
        let read_only = read_only || !writable;
        let mode = if read_only { guard::Mode::ReadOnly } else { guard::Mode::of(true, self.in_tx()) };
        let checked = guard::check_mode(sql, Dialect::Sqlite, mode)?;
        let mut stmt = conn.prepare(checked.sql).map_err(engine_err)?;
        if read_only && !stmt.readonly() {
            if writable {
                return Err(EngineError::ReadOnlyRefused(tr!(
                    ko: "SQLite: 데이터를 바꾸는 문장입니다",
                    en: "SQLite: this statement changes data"
                )));
            }
            return Err(EngineError::Message(tr!(
                ko: "읽기 전용 모드에서는 데이터를 바꾸는 문장을 실행하지 않습니다 — 위 띠의 '읽기 전용'을 눌러 쓰기를 켠 뒤 실행하세요",
                en: "Statements that change data do not run in read-only mode — click 'Read-only' in the bar above to turn on writing first"
            )));
        }
        let ncol = stmt.column_count();
        let mut columns: Vec<ColumnOut> = (0..ncol)
            .map(|i| ColumnOut {
                name: stmt.column_name(i).unwrap_or("?").to_string(),
                ty: String::new(),
            })
            .collect();
        let changes_data = !stmt.readonly();
        // `INSERT … RETURNING` 처럼 돌려준 행 수가 곧 바뀐 행 수인 문장 — 상한 너머의 줄도 세기만 한다(2단계 — 영향 행 수).
        let count_rows = changes_data && ncol > 0 && super::counts_returned_rows(&checked.keyword);
        let mut counted: u64 = 0;
        let mut out_rows: Vec<Vec<Value>> = Vec::new();
        let mut truncated = false;
        let mut cell_truncated = false;
        if ncol == 0 {
            stmt.execute([]).map_err(engine_err)?;
        } else {
            let mut size = 0usize;
            let mut rows = stmt.query([]).map_err(engine_err)?;
            while let Some(row) = rows.next().map_err(engine_err)? {
                counted += 1;
                if truncated {
                    continue;
                }
                if out_rows.len() >= max_rows {
                    truncated = true;
                    if count_rows {
                        continue;
                    }
                    break;
                }
                let mut line = Vec::with_capacity(ncol);
                let mut line_size = 2usize;
                for (i, col) in columns.iter_mut().enumerate() {
                    let v = row.get_ref(i).map_err(engine_err)?;
                    if col.ty.is_empty() {
                        if let Some(ty) = value::sqlite_storage_class(v) {
                            col.ty = ty.to_string();
                        }
                    }
                    let (j, cut) = value::to_json(value::from_sqlite(v));
                    cell_truncated |= cut;
                    line_size += approx_len(&j);
                    line.push(j);
                }
                if size + line_size > RESPONSE_MAX && !out_rows.is_empty() {
                    truncated = true;
                    if count_rows {
                        continue;
                    }
                    break;
                }
                size += line_size;
                out_rows.push(line);
            }
        }
        drop(stmt);
        let affected = if count_rows { Some(counted) } else { changes_data.then(|| conn.changes()) };
        Ok(QueryOut {
            columns,
            rows: out_rows,
            truncated,
            cell_truncated,
            affected,
            elapsed_ms: started.elapsed().as_millis() as u64,
            tx: None,
        })
    }

    /// 스키마(붙인 DB) 이름 목록 — `{schemas: [{name}]}`(`main` 이 맨 앞 · `temp` 는 쓰였을 때만 보인다). 객체는 [`Sqlite::objects`].
    pub(crate) fn schema(&self) -> Result<Value, EngineError> {
        let conn = self.try_conn()?;
        let names = database_names(&conn)?;
        let schemas: Vec<Value> = names.into_iter().map(|n| json!({ "name": n })).collect();
        Ok(json!({ "schemas": schemas }))
    }

    /// 붙인 DB 하나의 객체 — 테이블 · 뷰(`sqlite_` 내부 것 제외). 인덱스 · 트리거는 테이블 아래([`Sqlite::table_detail`] — 엔진끼리
    /// 모양을 맞춘다). DB 이름은 식별자 자리(`<이름>.sqlite_schema`)라 바인드할 수 없다 — 그래서 먼저 `pragma_database_list` 에 있는
    /// 이름인지 **바인드 인자로** 확인하고, 있을 때만 인용(`quote_ident`)해 넣는다. 없으면 빈 목록.
    pub(crate) fn objects(&self, schema: Option<&str>) -> Result<Value, EngineError> {
        let conn = self.try_conn()?;
        let schema = schema.unwrap_or("main");
        if !known_database(&conn, schema)? {
            return Ok(objects_json(Vec::new(), Vec::new()));
        }
        let sql = format!(
            "SELECT type, name FROM {}.sqlite_schema WHERE type IN ('table', 'view') \
             AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name LIMIT ?1",
            quote_ident(schema)
        );
        let mut st = conn.prepare(&sql).map_err(engine_err)?;
        let it = st
            .query_map([(super::OBJECTS_MAX + 1) as i64], |r| {
                let (ty, name): (String, String) = (r.get(0)?, r.get(1)?);
                Ok(ObjectOut::new(if ty == "view" { "view" } else { "table" }, name))
            })
            .map_err(engine_err)?;
        let rows: Vec<ObjectOut> = it.collect::<Result<_, _>>().map_err(engine_err)?;
        let mut truncated = Vec::new();
        let out = cap_objects(rows, &["table", "view"], &mut truncated);
        Ok(objects_json(out, truncated))
    }

    /// 테이블(· 뷰) 하나의 구조 — 컬럼(`pragma_table_info`) · 인덱스(`pragma_index_list` × `pragma_index_xinfo` — 자동 인덱스 포함,
    /// 식 열은 `null`) · 제약(기본 키 · 유니크 = 카탈로그, 체크 = 저장된 `CREATE TABLE` 글자를 렉서로) · 외래 키(`pragma_foreign_key_list`
    /// — 이름이 없고, 대상 열을 안 적었으면 대상의 기본 키) · 참조됨(DB 안 모든 테이블의 외래 키 중 이 테이블을 가리키는 것) · 트리거
    /// (때 · 사건은 `CREATE TRIGGER` 글자에서). 테이블 · DB 이름은 테이블값 pragma 함수의 **바인드 인자**이고, `sqlite_schema` 앞의
    /// DB 이름만 [`Sqlite::objects`] 처럼 존재를 확인한 뒤 인용해 넣는다. 없는 테이블이면 오류.
    pub(crate) fn table_detail(&self, schema: Option<&str>, table: &str) -> Result<Value, EngineError> {
        let conn = self.try_conn()?;
        let schema = schema.unwrap_or("main");
        let not_found = || {
            EngineError::Message(tr!(
                ko: "테이블 {table} 을(를) 찾지 못했습니다",
                en: "Could not find the table {table}"
            ))
        };
        if !known_database(&conn, schema)? {
            return Err(not_found());
        }
        let q = quote_ident(schema);
        let mut d = TableDetail::default();
        // 컬럼 — `pk` 는 기본 키 안의 순번(0 = 아님).
        let mut pk_cols: Vec<(i64, String)> = Vec::new();
        {
            let mut st = conn
                .prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1, ?2) ORDER BY cid")
                .map_err(engine_err)?;
            let mut rows = st.query(rusqlite::params![table, schema]).map_err(engine_err)?;
            while let Some(r) = rows.next().map_err(engine_err)? {
                let (name, pk): (String, i64) = (r.get(0).map_err(engine_err)?, r.get(4).map_err(engine_err)?);
                if pk > 0 {
                    pk_cols.push((pk, name.clone()));
                }
                d.columns.push(json!({
                    "name": name,
                    "type": r.get::<_, String>(1).map_err(engine_err)?,
                    "notNull": r.get::<_, i64>(2).map_err(engine_err)? != 0,
                    "default": r.get::<_, Option<String>>(3).map_err(engine_err)?,
                    "pk": pk,
                }));
            }
        }
        if d.columns.is_empty() {
            return Err(not_found());
        }
        pk_cols.sort();
        // 인덱스 — 줄 하나 = 인덱스의 키 열 하나. 정의 글자(자동 인덱스는 없음)는 `sqlite_schema` 에서.
        let defs: Vec<(String, Option<String>)> = query_rows(
            &conn,
            &format!("SELECT name, sql FROM {q}.sqlite_schema WHERE type = 'index' AND tbl_name = ?1 COLLATE NOCASE"),
            rusqlite::params![table],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        type IdxRow = (String, bool, String, Option<String>);
        let idx: Vec<IdxRow> = query_rows(
            &conn,
            "SELECT il.name, il.\"unique\", il.origin, ix.name FROM pragma_index_list(?1, ?2) AS il \
             JOIN pragma_index_xinfo(il.name, ?2) AS ix WHERE ix.key = 1 ORDER BY il.origin <> 'pk', il.name, ix.seqno",
            rusqlite::params![table, schema],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get(2)?, r.get(3)?)),
        )?;
        let mut unique_cons = Vec::new();
        for g in detail::group_runs(idx, |r| r.0.clone()) {
            let (name, unique, origin) = (g[0].0.clone(), g[0].1, g[0].2.clone());
            let columns: Vec<Option<String>> = g.into_iter().map(|r| r.3).collect();
            if origin == "u" {
                unique_cons.push(ConstraintOut {
                    name: None,
                    ty: "unique",
                    columns: columns.iter().flatten().cloned().collect(),
                    definition: None,
                });
            }
            d.indexes.push(IndexOut {
                definition: defs.iter().find(|(n, _)| *n == name).and_then(|(_, s)| s.clone()),
                name,
                columns,
                unique,
                primary: origin == "pk",
                method: None,
                predicate: None,
            });
        }
        // 제약 — 기본 키 · 유니크(카탈로그) · 체크(저장된 CREATE TABLE 글자).
        if !pk_cols.is_empty() {
            d.constraints.push(ConstraintOut {
                name: None,
                ty: "primary",
                columns: pk_cols.into_iter().map(|(_, n)| n).collect(),
                definition: None,
            });
        }
        d.constraints.extend(unique_cons);
        let create: Option<String> = query_rows(
            &conn,
            &format!("SELECT sql FROM {q}.sqlite_schema WHERE type = 'table' AND name = ?1 COLLATE NOCASE"),
            rusqlite::params![table],
            |r| r.get::<_, Option<String>>(0),
        )?
        .into_iter()
        .flatten()
        .next();
        for c in create.as_deref().map(detail::sqlite_checks).unwrap_or_default() {
            d.constraints.push(ConstraintOut {
                name: c.name,
                ty: "check",
                columns: c.column.into_iter().collect(),
                definition: Some(format!("CHECK ({})", c.expr)),
            });
        }
        // 외래 키 · 참조됨 — 줄 하나 = 외래 키의 열 하나(`id` 가 외래 키를 가른다).
        type FkRow = (String, i64, String, Option<String>, String, String, String);
        let to_fk = |rows: Vec<FkRow>, this_is_target: bool| -> Result<Vec<ForeignKeyOut>, EngineError> {
            let mut out = Vec::new();
            for g in detail::group_runs(rows, |r| (r.0.clone(), r.1)) {
                let (other, target) = (g[0].0.clone(), g[0].4.clone());
                let (src_table, ref_table) = if this_is_target { (other, table.to_string()) } else { (table.to_string(), target) };
                let mut ref_columns: Vec<String> = g.iter().filter_map(|r| r.3.clone()).collect();
                if ref_columns.len() < g.len() {
                    // 대상 열을 안 적었다 — 대상 테이블의 기본 키.
                    ref_columns = query_rows(
                        &conn,
                        "SELECT name FROM pragma_table_info(?1, ?2) WHERE pk > 0 ORDER BY pk",
                        rusqlite::params![ref_table, schema],
                        |r| r.get(0),
                    )?;
                }
                out.push(ForeignKeyOut {
                    name: None,
                    schema: schema.to_string(),
                    table: src_table,
                    columns: g.iter().map(|r| r.2.clone()).collect(),
                    ref_schema: schema.to_string(),
                    ref_table,
                    ref_columns,
                    on_update: Some(g[0].5.clone()),
                    on_delete: Some(g[0].6.clone()),
                });
            }
            Ok(out)
        };
        let fks: Vec<FkRow> = query_rows(
            &conn,
            "SELECT '', id, \"from\", \"to\", \"table\", on_update, on_delete FROM pragma_foreign_key_list(?1, ?2) ORDER BY id, seq",
            rusqlite::params![table, schema],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
        d.foreign_keys = to_fk(fks, false)?;
        let refs: Vec<FkRow> = query_rows(
            &conn,
            &format!(
                "SELECT m.name, f.id, f.\"from\", f.\"to\", f.\"table\", f.on_update, f.on_delete FROM {q}.sqlite_schema AS m \
                 JOIN pragma_foreign_key_list(m.name, ?2) AS f WHERE m.type = 'table' AND f.\"table\" = ?1 COLLATE NOCASE \
                 ORDER BY m.name, f.id, f.seq"
            ),
            rusqlite::params![table, schema],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )?;
        d.referenced_by = to_fk(refs, true)?;
        // 트리거 — 때 · 사건은 CREATE TRIGGER 글자에서.
        d.triggers = query_rows(
            &conn,
            &format!("SELECT name, sql FROM {q}.sqlite_schema WHERE type = 'trigger' AND tbl_name = ?1 COLLATE NOCASE ORDER BY name"),
            rusqlite::params![table],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )?
        .into_iter()
        .map(|(name, sql)| TriggerOut {
            name,
            detail: sql.as_deref().map(detail::sqlite_trigger_detail).unwrap_or_default(),
            definition: sql,
        })
        .collect();
        Ok(d.json())
    }

    /// 객체 하나의 정의 — `sqlite_schema.sql` 원문(테이블 · 뷰 · 인덱스 · 트리거). 종류 · 이름은 **바인드 인자**, DB 이름은
    /// [`Sqlite::objects`] 처럼 존재를 확인한 뒤 인용해 넣는다. 자동 인덱스(기본 키 · 유니크가 만든 것)는 원문이 없다 — 사람 문구.
    pub(crate) fn definition(&self, t: &DefTarget) -> Result<Value, EngineError> {
        let kind = definition::check(t)?;
        let ty = match kind {
            DefKind::Table => "table",
            DefKind::View => "view",
            DefKind::Index => "index",
            DefKind::Trigger => "trigger",
            _ => return Err(definition::unsupported(&t.kind)),
        };
        let conn = self.try_conn()?;
        let schema = t.schema.as_deref().unwrap_or("main");
        if !known_database(&conn, schema)? {
            return Err(definition::not_found(t));
        }
        let rows: Vec<Option<String>> = query_rows(
            &conn,
            &format!(
                "SELECT sql FROM {}.sqlite_schema WHERE type = ?1 AND name = ?2 COLLATE NOCASE ORDER BY name = ?2 DESC LIMIT 1",
                quote_ident(schema)
            ),
            rusqlite::params![ty, t.name],
            |r| r.get(0),
        )?;
        match rows.into_iter().next() {
            None => Err(definition::not_found(t)),
            Some(None) => Err(EngineError::Message(tr!(
                ko: "{name} 은(는) SQLite 가 기본 키 · 유니크 제약으로 자동으로 만든 인덱스라 DDL 원문이 없습니다 — 테이블의 DDL 을 보세요",
                en: "{name} is an index SQLite created automatically for a primary key or unique constraint, so it has no DDL text — see the table's DDL",
                name = t.name
            ))),
            Some(Some(sql)) => Ok(DefinitionOut::new(definition::with_semicolon(&sql), false).json()),
        }
    }

    /// **스크립트**(2단계 — 규칙은 `db::script`) — 블로킹. 앱 고정 `BEGIN DEFERRED` → 문장마다 지금과 같은 실행(`query_on` — 가드 ·
    /// 읽기 전용 열기 · `readonly()` 겹 그대로) → 첫 오류 · 멈춤이면 `ROLLBACK`, 모두 성공하면 `COMMIT`(읽기 전용은 늘 `ROLLBACK`).
    /// 진실은 `is_autocommit()` — 끊긴 쓰기 · `OR ROLLBACK` 충돌은 SQLite 가 트랜잭션 전체를 되감는다(10-13 실측). 트랜잭션 작업이 열려
    /// 있으면 그 안에서(커밋하지 않음 · 스크립트 한 벌이 세이브포인트 하나 — 오류 · 멈춤이면 이번 실행분만 되돌림, 10-14 결정). 시한은 부르는
    /// 쪽의 시계가 `interrupt` 로 지킨다.
    pub(crate) fn script(
        &self,
        plan: &[super::script::Planned],
        mode: super::script::ScriptMode,
        max_rows: usize,
        ctl: &super::script::Ctl,
    ) -> Result<super::script::EngineRun, EngineError> {
        use super::script::{state_changed, End, EngineRun, ScriptMode};
        let mut conn = self.try_conn()?;
        let in_work = mode == ScriptMode::InWork;
        let state_ok = match mode {
            ScriptMode::InWork => self.in_tx() && !conn.is_autocommit(),
            ScriptMode::Write => self.writable() && conn.is_autocommit(),
            // 쓰기 모드에서도 받는다 — 자동 커밋을 끈 타일의 조회만 든 스크립트(`table::script`).
            ScriptMode::ReadOnly => conn.is_autocommit(),
        };
        if !state_ok {
            return Err(state_changed());
        }
        let read_only = mode == ScriptMode::ReadOnly;
        if in_work {
            // 스크립트 한 벌 = 세이브포인트 하나(10-14 결정).
            conn.execute_batch(&format!("SAVEPOINT {RUN_SAVEPOINT}")).map_err(engine_err)?;
        } else {
            conn.execute_batch("BEGIN DEFERRED").map_err(engine_err)?;
        }
        let mut run = EngineRun::new();
        let mut ended: Option<End> = None;
        for p in plan {
            let Some(_ms) = ctl.begin_stmt() else {
                run.stopped = ctl.stopped();
                break;
            };
            let r = self.query_on(&conn, p.text(), max_rows, read_only);
            ctl.end_stmt();
            let gone = conn.is_autocommit();
            match r {
                Ok(out) => {
                    run.done.push(ctl.keep(out));
                    if gone {
                        ended = Some(if in_work { End::WorkEnded } else { End::EndedByStatement });
                        break;
                    }
                }
                Err(e) => {
                    run.failed = Some(e);
                    if gone {
                        // SQLite 가 트랜잭션 전체를 되감았다(끊긴 쓰기 · `OR ROLLBACK`).
                        ended = Some(if in_work { End::WorkEnded } else { End::RolledBack });
                    }
                    break;
                }
            }
        }
        if in_work {
            // 마지막 확인 — 세이브포인트를 풀기 직전에 취소 · 전체 시한을 다시 본다(Codex 검토 반영 1).
            if run.failed.is_none() && run.stopped.is_none() {
                run.stopped = ctl.stopped();
            }
            run.end = match ended {
                Some(End::WorkEnded) if run.failed.is_none() => End::WorkUnknown(super::tx_vanished_note()),
                Some(e) => e,
                None => {
                    let end = self.savepoint_end(&mut conn, run.failed.is_none() && run.stopped.is_none());
                    End::in_work(end, &mut run)
                }
            };
            self.sync_tx(&conn);
            return Ok(run);
        }
        if let Some(e) = ended {
            run.end = e;
            return Ok(run);
        }
        if read_only || run.must_roll_back(ctl) {
            if run.stopped.is_none() && !read_only {
                run.stopped = ctl.stopped();
            }
            let r = conn.execute_batch("ROLLBACK");
            run.end = match r {
                Ok(()) if read_only => End::ReadOnlyDone,
                Ok(()) => End::RolledBack,
                Err(e) => End::CommitLost(tr!(ko: "SQLite 오류: {e}", en: "SQLite error: {e}")),
            };
            return Ok(run);
        }
        run.end = match conn.execute_batch("COMMIT") {
            Ok(()) => End::Committed,
            Err(e) => {
                let m = tr!(ko: "SQLite 오류: {e}", en: "SQLite error: {e}");
                // 커밋이 막혔다(다른 연결의 읽기 — `SQLITE_BUSY`) — 트랜잭션이 남았으면 되돌린다.
                if !conn.is_autocommit() {
                    let _ = conn.execute_batch("ROLLBACK");
                }
                End::CommitFailed(m)
            }
        };
        Ok(run)
    }

    /// 쓰기를 켜고 끈다 — 같은 파일을 그 모드로 **다시 연다**(돌고 있는 문장이 있으면 `Busy`).
    pub(crate) fn set_write(&self, on: bool) -> Result<(), EngineError> {
        let mut conn = self.try_conn()?;
        if self.writable() == on {
            return Ok(());
        }
        let fresh = open_conn(&self.path, on).map_err(EngineError::Message)?;
        *lock(&self.interrupt) = fresh.get_interrupt_handle();
        // 옛 연결이 떨어지며 열린 트랜잭션은 되감긴다(`sqlite3_close`).
        *conn = fresh;
        self.writable.store(on, Ordering::SeqCst);
        self.sync_tx(&conn);
        Ok(())
    }
}
