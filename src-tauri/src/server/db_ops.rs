//! **DB 평면 op**(쿼리 타일 5단계 — 판 8) — 몸은 `crate::db::table`. 기다림(블로킹 풀·시간 제한)이 있어 `serve::serve_conn` 이
//! 태스크로 돌린다(긴 쿼리가 같은 연결의 다른 op 를 막지 않는다).
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `db_open` | 쓰기 | `{stream, window, conn: {id}, password?, ssh?: {hostKeyDecision?, password?, passphrase?, passphraseFor?, declinedKeys?}, reattachOnly?, lang}` → `{handle, lease, dialect, serverVersion, writable, reattached}` · 경유 SSH 관문은 코드 `ssh-open` + `SshOpenError` JSON(터미널 `open_ssh` 와 같은 꼴) · `reattachOnly` = 있는 연결에 붙기만(없으면 `[session-gone]`) |
//! | `db_test` | 쓰기 | 판 28 — `{stream: "dbtest-…", conn: <DbConn 한 줄 — db_conn_save 의 꼴>, password?, ssh?, lang}` → `{dialect, serverVersion, via?, elapsedMs}`(DB 연결 폼의 [연결 테스트] — 저장 안 한 초안으로 한 번 붙고 곧바로 닫는다 · 표 · 접속 기록에 남지 않는다 · 볼트 물러남은 서버가 저장된 줄과 대상을 견줘 정한다 — `table::test`) · 실패는 `db_open` 과 같은 꼴 |
//! | `db_query` | 쓰기 | `{handle, lease, sql, queryId, maxRows?, timeoutMs?, txId?}` → `{columns: [{name, type}], rows, truncated, cellTruncated, affected?, elapsedMs, tx}` · `txId`(판 9 — 화면이 아는 작업 id, 0 = 작업 없음)가 지금 작업과 다르면 `[db-tx-stale]` |
//! | `db_cancel` | 쓰기 | `{handle, queryId}` → bool(지금 돌던 그 쿼리를 끊었나) |
//! | `db_schema` | 읽기 | `{handle, lease}` → `{schemas: [{name}]}`(스키마 이름만 — 트리 첫 단계) |
//! | `db_objects` | 읽기 | `{handle, lease, schema?}` → `{objects: [{kind, name, sub?, args?, returns?, on?, detail?}], truncated: [kind]}`(스키마를 펼칠 때 — 종류 = 트리 폴더) |
//! | `db_table_detail` | 읽기 | `{handle, lease, schema?, table}` → `{columns, indexes, constraints, foreignKeys, referencedBy, triggers, partitions, truncated}`(테이블 · 뷰를 펼칠 때 한 번 — 꼴은 `db::detail`) |
//! | `db_definition` | 읽기 | `{handle, lease, schema?, kind, name, table?, args?}` → `{sql, reconstructed, truncated}`(트리 잎의 "DDL 보기" — 꼴은 `db::definition` · 실행하지 않는다) |
//! | `db_set_write` | 쓰기 | `{handle, lease, on, autoCommit?}` → `{writable, autoCommit}` · `autoCommit`(판 13 — 자동 커밋 토글, 쓰기 모드에서만 끌 수 있고 작업이 열려 있으면 바꾸지 않는다 · 쓰기를 끄면 켬으로 돌아감) |
//! | `db_close` | 쓰기 | `{handle, lease?}` → bool(닫았나 — 이미 없으면 false) |
//! | `db_script` | 쓰기 | 판 10 — `{handle, lease, sql, queryId, maxRows?, timeoutMs?, txId?}` → `{outcome, reason?, total, results: [{index, start, end, keyword, columns, rows, truncated, cellTruncated, affected?, elapsedMs}], failed?: {index, start, end, message}, message?, elapsedMs, tx}`(스크립트 — 꼴은 `db::script::ScriptOut` · 자리는 UTF-16) |
//! | `db_tx` | 쓰기 | 판 9 — `{handle, lease, action: begin\|commit\|rollback\|extend\|state, txId?}` → `{tx}`(트랜잭션 작업 — 꼴은 `db::tx::TxView`) · commit · rollback · extend 는 `txId` 가 지금 작업이어야 한다(`[db-tx-stale]`) |
//!
//! `db_query` 가 **쓰기 등급**인 것은 쿼리가 무엇이든(읽기 전용 모드여도) 사람이 친 글자를 엔진에 넣는 일이기 때문이다.
//! 실패는 코드 [`DB`] + 사람 문구(엔진 오류 메시지 포함 · 비밀 없음 · `[stale-lease]`·`[session-gone]`·`[cancelled]` 같은 이유 코드).
//!
//! **로그**: op·핸들·SQL 길이·행 수·ms 만. SQL 본문·결과·경로·오류 문구(식별자가 섞인다)는 남기지 않는다.
//! `password`(DB) · `ssh.password` · `ssh.passphrase` 는 이 접속 한 번에만 쓰고 곧바로 0 으로 덮는다(`Zeroizing`) — 로그·응답에 없다.

use serde::Deserialize;
use serde_json::{json, Value};

use super::ipc::frame::code;
use super::ipc::WireError;
use super::log;
use super::sessions::ConnCtx;
use crate::db::net::{OpenError, OpenSecrets};
use crate::db::{self, table};
use crate::ssh::open::SharedCreds;
use crate::ssh::HostKeyDecision;

/// DB op 실패 코드.
pub(crate) const DB: &str = "db";

/// 이 파일이 받는 op 인가.
pub(crate) fn is_db_op(op: &str) -> bool {
    matches!(
        op,
        "db_open"
            | "db_test"
            | "db_query"
            | "db_cancel"
            | "db_schema"
            | "db_objects"
            | "db_table_detail"
            | "db_definition"
            | "db_set_write"
            | "db_close"
            | "db_tx"
            | "db_script"
    )
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    // serde 문구는 몸(SQL)을 되풀이할 수 있다 — 싣지 않는다.
    serde_json::from_value(v).map_err(|_| WireError::new(code::BAD_BODY, "bad db request body"))
}

fn derr(m: String) -> WireError {
    WireError::new(DB, m)
}

fn take_lang(b: &mut Value) {
    if let Some(l) = b.get("lang").and_then(Value::as_str).and_then(crate::i18n::parse) {
        crate::i18n::set_lang(l);
    }
    if let Some(o) = b.as_object_mut() {
        o.remove("lang");
    }
}

#[derive(Deserialize)]
struct Open {
    stream: String,
    #[serde(default)]
    window: String,
    conn: table::ConnRef,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    ssh: Option<SshGate>,
    /// 떼어 둔(또는 붙은) 연결에 **다시 붙기만** 한다 — 없으면 새로 열지 않고 `[session-gone]`(9단계: 리로드·재시작 뒤의 타일이
    /// 볼트 잠금 해제·비밀번호를 묻기 전에 먼저 시도한다).
    #[serde(default, rename = "reattachOnly")]
    reattach_only: bool,
}

/// 경유 SSH 관문의 답 — 터미널 `open_ssh` 의 같은 이름 칸과 같은 뜻(**`Debug` 없음**).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SshGate {
    #[serde(default)]
    host_key_decision: Option<HostKeyDecision>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    passphrase: Option<String>,
    #[serde(default)]
    passphrase_for: Option<String>,
    #[serde(default)]
    declined_keys: Option<Vec<String>>,
}

/// `db_test` 의 몸(판 28) — 연결은 **참조가 아니라 초안 한 줄**이다(저장 전 값을 시험한다 · 서버가 저장과 같은 검사를 다시 한다).
#[derive(Deserialize)]
struct Test {
    stream: String,
    conn: db::conns::DbConn,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    ssh: Option<SshGate>,
}

/// 비밀 재료 — `vault` 는 볼트 물러남(타일 열기는 참 · 연결 테스트는 `table::test` 가 다시 정한다).
fn secrets(password: Option<String>, ssh: Option<SshGate>, vault: bool) -> OpenSecrets {
    let g = ssh.unwrap_or_default();
    OpenSecrets {
        vault,
        password: password.map(zeroize::Zeroizing::new),
        ssh: SharedCreds {
            host_key_decision: g.host_key_decision,
            password: g.password,
            passphrase: g.passphrase.map(zeroize::Zeroizing::new),
            passphrase_for: g.passphrase_for,
            declined_keys: g.declined_keys.unwrap_or_default(),
            unattended: None,
        },
        from_vault: false,
    }
}

/// 열기 실패 → 회신 — SSH 관문은 `open_ssh` 와 같은 코드·JSON(GUI 가 그대로 풀어 프런트의 관문 루프에 넘긴다).
fn open_err(e: OpenError) -> WireError {
    match e {
        OpenError::Msg(m) => derr(m),
        OpenError::Ssh(s) => WireError::new(
            super::sessions::SSH_OPEN,
            serde_json::to_string(&s).unwrap_or_else(|_| "{}".into()),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    #[serde(default)]
    max_rows: Option<u64>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// 판 9 — 화면이 아는 트랜잭션 작업 id(0 = 작업 없음). 판 8 GUI 는 싣지 않는다(보지 않는다).
    #[serde(default)]
    tx_id: Option<u64>,
}

/// 스크립트 op 의 몸(판 10) — `db_query` 와 같은 칸.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Script {
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    #[serde(default)]
    max_rows: Option<u64>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    tx_id: Option<u64>,
}

/// 트랜잭션 작업 op 의 몸(판 9).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tx {
    handle: u64,
    lease: u64,
    action: String,
    #[serde(default)]
    tx_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cancel {
    handle: u64,
    query_id: String,
}

#[derive(Deserialize)]
struct Leased {
    handle: u64,
    lease: u64,
}

#[derive(Deserialize)]
struct Objects {
    handle: u64,
    lease: u64,
    #[serde(default)]
    schema: Option<String>,
}

#[derive(Deserialize)]
struct TableDetail {
    handle: u64,
    lease: u64,
    #[serde(default)]
    schema: Option<String>,
    table: String,
}

#[derive(Deserialize)]
struct Definition {
    handle: u64,
    lease: u64,
    #[serde(flatten)]
    target: db::definition::DefTarget,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetWrite {
    handle: u64,
    lease: u64,
    on: bool,
    /// 판 13 — 자동 커밋 토글(없으면 그대로).
    #[serde(default)]
    auto_commit: Option<bool>,
}

#[derive(Deserialize)]
struct Close {
    handle: u64,
    #[serde(default)]
    lease: Option<u64>,
}

/// op 하나.
pub(crate) async fn handle(op: &str, mut b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
    take_lang(&mut b);
    let started = std::time::Instant::now();
    let ms = || started.elapsed().as_millis();
    match op {
        "db_open" => {
            let o: Open = body(b)?;
            if o.reattach_only {
                let r = table::reattach_only(&o.stream, &o.window, ctx.id, &o.conn);
                log::line(format!("db_open reattach-only hit {}", r.is_ok()));
                return r.map(|x| json!(x)).map_err(derr);
            }
            let s = secrets(o.password, o.ssh, true);
            let id = o.conn.id.clone();
            let r = table::open(o.stream, o.window, ctx.id, o.conn, s).await;
            match &r {
                Ok(x) => {
                    log::line(format!(
                        "db_open handle {} lease {} {} reattached {} ({} ms)",
                        x.handle,
                        x.lease,
                        x.dialect,
                        x.reattached,
                        ms()
                    ));
                    // 사람 쿼리 타일이 엔진을 **새로** 연 때만 접속 기록에 한 줄(독 DB 칸의 "최근" — `crate::db_history` 머리말).
                    // 다시 붙기는 접속이 아니고, AI 전용 연결(`db::ai` · `db::ai_write`)은 이 op 를 지나지 않는다.
                    if !x.reattached {
                        crate::db_history::record_ok(&id);
                    }
                }
                Err(OpenError::Ssh(_)) => log::line(format!("db_open ssh gate ({} ms)", ms())),
                Err(OpenError::Msg(_)) => log::line(format!("db_open failed ({} ms)", ms())),
            }
            r.map(|x| json!(x)).map_err(open_err)
        }
        "db_test" => {
            let o: Test = body(b)?;
            // 볼트 물러남은 거짓으로 시작한다 — `table::test` 가 저장된 줄과 대상을 견줘 그 자리에서 정한다.
            let s = secrets(o.password, o.ssh, false);
            let r = table::test(&o.stream, o.conn, s).await;
            // 한 줄 결과만(주소 · 경로 · 이름 · 오류 문구 없음 — 식별자가 섞인다).
            match &r {
                Ok(x) => log::line(format!("db_test ok {} ({} ms)", x.dialect, ms())),
                Err(OpenError::Ssh(_)) => log::line(format!("db_test ssh gate ({} ms)", ms())),
                Err(OpenError::Msg(_)) => log::line(format!("db_test failed ({} ms)", ms())),
            }
            r.map(|x| json!(x)).map_err(open_err)
        }
        "db_query" => {
            let q: Query = body(b)?;
            let (rows, timeout) = db::clamp_limits(q.max_rows, q.timeout_ms);
            let (handle, len) = (q.handle, q.sql.len());
            let r = table::query(q.handle, q.lease, q.sql, q.query_id, rows, timeout, q.tx_id).await;
            match &r {
                Ok(out) => log::line(format!(
                    "db_query handle {handle} sql {len} B rows {} truncated {} ({} ms)",
                    out.rows.len(),
                    out.truncated,
                    ms()
                )),
                Err(_) => log::line(format!("db_query handle {handle} sql {len} B failed ({} ms)", ms())),
            }
            r.map(|out| json!(out)).map_err(derr)
        }
        "db_script" => {
            let q: Script = body(b)?;
            let (rows, timeout) = db::clamp_limits(q.max_rows, q.timeout_ms);
            let (handle, len) = (q.handle, q.sql.len());
            let r = table::script(q.handle, q.lease, q.sql, q.query_id, rows, timeout, q.tx_id).await;
            match &r {
                Ok(out) => log::line(format!(
                    "db_script handle {handle} sql {len} B stmts {}/{} {} ({} ms)",
                    out.results.len(),
                    out.total,
                    out.outcome,
                    ms()
                )),
                Err(_) => log::line(format!("db_script handle {handle} sql {len} B failed ({} ms)", ms())),
            }
            r.map(|out| json!(out)).map_err(derr)
        }
        "db_cancel" => {
            let c: Cancel = body(b)?;
            let r = table::cancel(c.handle, &c.query_id);
            log::line(format!("db_cancel handle {} hit {:?}", c.handle, r.as_ref().ok()));
            r.map(|hit| json!(hit)).map_err(derr)
        }
        "db_schema" => {
            let l: Leased = body(b)?;
            table::schema(l.handle, l.lease).await.map_err(derr)
        }
        "db_objects" => {
            let o: Objects = body(b)?;
            table::objects(o.handle, o.lease, o.schema).await.map_err(derr)
        }
        "db_table_detail" => {
            let c: TableDetail = body(b)?;
            table::table_detail(c.handle, c.lease, c.schema, c.table).await.map_err(derr)
        }
        "db_definition" => {
            let d: Definition = body(b)?;
            let r = table::definition(d.handle, d.lease, d.target).await;
            match &r {
                Ok(v) => log::line(format!(
                    "db_definition handle {} {} B ({} ms)",
                    d.handle,
                    v["sql"].as_str().map_or(0, str::len),
                    ms()
                )),
                Err(_) => log::line(format!("db_definition handle {} failed ({} ms)", d.handle, ms())),
            }
            r.map_err(derr)
        }
        "db_set_write" => {
            let s: SetWrite = body(b)?;
            let r = match table::set_write(s.handle, s.lease, s.on).await {
                Ok(w) => match s.auto_commit {
                    Some(a) => table::set_auto_commit(s.handle, s.lease, a).map(|a| (w, a)),
                    None => table::auto_commit(s.handle, s.lease).map(|a| (w, a)),
                },
                Err(e) => Err(e),
            };
            log::line(format!("db_set_write handle {} on {} autoCommit {:?} ok {}", s.handle, s.on, s.auto_commit, r.is_ok()));
            r.map(|(w, a)| json!({ "writable": w, "autoCommit": a })).map_err(derr)
        }
        "db_tx" => {
            let t: Tx = body(b)?;
            let r = match t.action.as_str() {
                "begin" => table::tx_begin(t.handle, t.lease).await,
                "commit" => table::tx_end(t.handle, t.lease, t.tx_id, true).await,
                "rollback" => table::tx_end(t.handle, t.lease, t.tx_id, false).await,
                "extend" => table::tx_extend(t.handle, t.lease, t.tx_id),
                "state" => table::tx_state(t.handle, t.lease),
                _ => return Err(WireError::new(code::BAD_BODY, "bad db_tx action")),
            };
            match &r {
                Ok(v) => log::line(format!("db_tx handle {} {} -> {} ({} ms)", t.handle, t.action, v.state, ms())),
                Err(_) => log::line(format!("db_tx handle {} {} failed ({} ms)", t.handle, t.action, ms())),
            }
            r.map(|v| json!({ "tx": v })).map_err(derr)
        }
        "db_close" => {
            let c: Close = body(b)?;
            let r = table::close(c.handle, c.lease);
            log::line(format!("db_close handle {} closed {:?}", c.handle, r.as_ref().ok()));
            r.map(|closed| json!(closed)).map_err(derr)
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}
