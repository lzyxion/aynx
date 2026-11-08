//! GUI 쪽 **DB 평면 껍데기**(쿼리 타일 5단계) — 연결 표·엔진은 세션 서버에 산다(`server::db_ops` · `crate::db`). 여기 있는
//! 것은 같은 이름의 Tauri 명령(전부 `async fn`)이고, 몸은 서버 op 하나씩이다.
//!
//! | Tauri 명령 | 서버 op | 인자 → 답 |
//! | --- | --- | --- |
//! | [`db_open`] | `db_open` | `stream, conn: {id}, password?, ssh?` → `{handle, lease, dialect, serverVersion, writable, reattached}` (창 라벨은 부른 창) · 실패는 **글자** 또는 경유 SSH 관문의 `SshOpenError` 객체(`{kind, …}` — 터미널 열기와 같은 꼴) |
//! | [`db_query`] | `db_query` | `handle, lease, sql, queryId, maxRows?, timeoutMs?` → `{columns, rows, truncated, cellTruncated, affected?, elapsedMs}` |
//! | [`db_cancel`] | `db_cancel` | `handle, queryId` → bool |
//! | [`db_schema`] · [`db_objects`] · [`db_table_detail`] | 같은 이름 | `handle, lease(, schema?(, table))` → 목록(스키마 이름 · 스키마의 객체 · 테이블 구조) |
//! | [`db_definition`] | `db_definition` | `handle, lease, schema?, kind, name, table?, args?` → `{sql, reconstructed, truncated}`(정의 읽기 전용 보기) |
//! | [`db_set_write`] | `db_set_write` | `handle, lease, on, autoCommit?` → `{writable, autoCommit?}`(자동 커밋 토글 — 판 13, 낮은 판 서버면 `autoCommit` 을 보내지 않고 `[server-outdated]`) |
//! | [`db_close`] | `db_close` | `handle, lease?` → bool |
//! | [`db_script`] | `db_script` | `handle, lease, sql, queryId, maxRows?, timeoutMs?, txId?` → `{outcome, total, results, failed?, …}`(스크립트 실행 — 판 10) |
//! | [`db_tx`] | `db_tx` | `handle, lease, action, txId?` → `{tx}`(트랜잭션 작업 — 판 9) |
//!
//! - **판**: 붙은 서버가 판 8 미만이면 보내지 않고 `[server-outdated]` 문구로 끝낸다(셸·SSH 는 그 서버에서 그대로 돈다 — 판 7
//!   서버와도 협상이 서기 때문이다. `ipc::frame::DB_PROTOCOL`).
//! - `password`(DB) · `ssh`(경유 SSH 관문의 답 — 비밀번호·암호구 포함)는 이 호출 한 번의 몸에만 싣는다(로그·`Debug` 없음).
//! - 경로·주소·경유를 보내지 않는다 — 서버가 `db-connections.json` 에서 다시 읽는다(`db::conns`). 그 목록의 편집 명령은
//!   `db::conns::db_conn_list`·`db_conn_save`(GUI 가 파일을 직접 — 비밀이 없다).

use std::time::Duration;

use serde_json::{json, Value};

use super::client;
use super::ipc::frame::{DB_AUTOCOMMIT_PROTOCOL, DB_PROTOCOL, DB_SCRIPT_PROTOCOL, DB_TX_PROTOCOL, DB_TX_SERIAL_PROTOCOL, DB_TX_VERDICT_PROTOCOL};
use super::ipc::Grade;
use super::ssh_proxy::lang;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 판 8 미만 서버면 보내지 않는다.
fn check_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_PROTOCOL => Err(outdated()),
        _ => Ok(()),
    }
}

/// 판 9 미만 서버면 트랜잭션 작업만 보내지 않는다(쿼리 타일의 나머지는 판 8 서버에서 그대로 선다).
fn check_tx_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_TX_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 트랜잭션 작업을 열 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run transactions — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 10 미만 서버면 스크립트 실행만 보내지 않는다(쿼리 타일의 나머지는 그대로 선다).
fn check_script_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_SCRIPT_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 스크립트를 실행할 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run scripts — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 13 미만 서버면 자동 커밋 토글만 보내지 않는다(쿼리 타일의 나머지는 그대로 선다).
fn check_autocommit_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_AUTOCOMMIT_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 자동 커밋을 끌 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot turn off auto-commit — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

fn reach_error(e: super::ipc::WireError) -> String {
    match e.code.as_str() {
        "not-connected" | "closed" | "io" | "timeout" => tr!(
            ko: "세션 서버에 닿지 못했습니다 ({code}: {msg})",
            en: "Could not reach the session server ({code}: {msg})",
            code = e.code,
            msg = e.message
        ),
        // 판 7 서버가 모르는 op 라고 답했다(협상 뒤 서버가 바뀐 틈) — 같은 안내.
        "unknown-op" | "protocol-mismatch" => outdated(),
        _ => e.message,
    }
}

fn outdated() -> String {
    with_reason(
        SERVER_OUTDATED,
        tr!(
            ko: "세션 서버가 이전 판이라 쿼리 타일을 열 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
            en: "The session server is an older version and cannot open query tiles — restart it in Settings › Session server (open shell sessions will close)"
        ),
    )
}

async fn dcall(kind: Grade, op: &str, mut body: Value, limit: Option<Duration>) -> Result<Value, String> {
    check_protocol()?;
    if let Some(o) = body.as_object_mut() {
        o.insert("lang".into(), json!(lang()));
    }
    let r = match limit {
        Some(l) => client::request_timed(kind, op, body, l).await,
        None => client::request(kind, op, body).await,
    };
    r.map_err(reach_error)
}

/// 연다 — 같은 `stream`·같은 참조면 서버가 다시 붙는다(`reattached`). 실패는 사람 문구(글자) 또는 경유 SSH 관문의
/// `SshOpenError`(객체 — 프런트의 `runSshGates` 가 묻고 다시 부른다).
#[tauri::command]
pub async fn db_open(
    webview: tauri::Webview,
    stream: String,
    conn: Value,
    password: Option<String>,
    ssh: Option<Value>,
    reattach_only: Option<bool>,
) -> Result<Value, Value> {
    let window = webview.window().label().to_string();
    let password = password.map(zeroize::Zeroizing::new);
    check_protocol().map_err(Value::String)?;
    let body = json!({
        "stream": stream,
        "window": window,
        "conn": conn,
        "password": password.as_deref(),
        "ssh": ssh,
        "reattachOnly": reattach_only.unwrap_or(false),
        "lang": lang(),
    });
    match client::request(Grade::Write, "db_open", body).await {
        Ok(mut v) => {
            // 판 14 표지 — 서버의 작업 판정이 Codex 검토 반영 1 규칙인가(`[db-needs-work]` 를 내는가). 칸은 GUI 가 얹는다(서버 답 모양 그대로).
            if let Some(o) = v.as_object_mut() {
                let ready = client::negotiated_protocol().is_none_or(|p| p >= DB_TX_VERDICT_PROTOCOL);
                o.insert("txVerdicts".into(), Value::Bool(ready));
                // 판 15 표지 — 연결별 조정 장치(실행 중 [커밋] 거절 · 방치 되돌리기 재시도)가 선 서버인가.
                let serial = client::negotiated_protocol().is_none_or(|p| p >= DB_TX_SERIAL_PROTOCOL);
                o.insert("txSerial".into(), Value::Bool(serial));
            }
            Ok(v)
        }
        Err(e) if e.code == super::sessions::SSH_OPEN => match serde_json::from_str::<Value>(&e.message) {
            Ok(v) if v.get("kind").is_some() => Err(v),
            _ => Err(Value::String(e.message)),
        },
        Err(e) => Err(Value::String(reach_error(e))),
    }
}

/// 문장 하나 — GUI 쪽 요청 시한은 다듬은 `timeoutMs` + 15초.
#[tauri::command]
pub async fn db_query(
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    max_rows: Option<u64>,
    timeout_ms: Option<u64>,
    tx_id: Option<u64>,
) -> Result<Value, String> {
    let (_, ms) = crate::db::clamp_limits(max_rows, timeout_ms);
    dcall(
        Grade::Write,
        "db_query",
        json!({ "handle": handle, "lease": lease, "sql": sql, "queryId": query_id, "maxRows": max_rows, "timeoutMs": ms, "txId": tx_id }),
        Some(Duration::from_millis(ms + 15_000)),
    )
    .await
}

#[tauri::command]
pub async fn db_cancel(handle: u64, query_id: String) -> Result<bool, String> {
    dcall(Grade::Write, "db_cancel", json!({ "handle": handle, "queryId": query_id }), None)
        .await
        .map(|v| v.as_bool().unwrap_or(false))
}

#[tauri::command]
pub async fn db_schema(handle: u64, lease: u64) -> Result<Value, String> {
    dcall(Grade::Read, "db_schema", json!({ "handle": handle, "lease": lease }), None).await
}

#[tauri::command]
pub async fn db_objects(handle: u64, lease: u64, schema: Option<String>) -> Result<Value, String> {
    dcall(Grade::Read, "db_objects", json!({ "handle": handle, "lease": lease, "schema": schema }), None).await
}

/// 객체 하나의 정의(DDL) — 읽기 전용 보기(실행하지 않는다).
#[tauri::command]
pub async fn db_definition(
    handle: u64,
    lease: u64,
    schema: Option<String>,
    kind: String,
    name: String,
    table: Option<String>,
    args: Option<String>,
) -> Result<Value, String> {
    dcall(
        Grade::Read,
        "db_definition",
        json!({ "handle": handle, "lease": lease, "schema": schema, "kind": kind, "name": name, "table": table, "args": args }),
        None,
    )
    .await
}

#[tauri::command]
pub async fn db_table_detail(handle: u64, lease: u64, schema: Option<String>, table: String) -> Result<Value, String> {
    dcall(
        Grade::Read,
        "db_table_detail",
        json!({ "handle": handle, "lease": lease, "schema": schema, "table": table }),
        None,
    )
    .await
}

#[tauri::command]
pub async fn db_set_write(handle: u64, lease: u64, on: bool, auto_commit: Option<bool>) -> Result<Value, String> {
    // 자동 커밋 토글(판 13)을 판 12 서버에 보내면 서버가 모르는 칸을 버려 **끈 줄 알고 친 문장이 곧바로 커밋된다** — 보내지 않는다.
    if auto_commit.is_some() {
        check_autocommit_protocol()?;
    }
    let mut body = json!({ "handle": handle, "lease": lease, "on": on });
    if let Some(a) = auto_commit {
        body["autoCommit"] = json!(a);
    }
    dcall(Grade::Write, "db_set_write", body, None).await
}

#[tauri::command]
pub async fn db_close(handle: u64, lease: Option<u64>) -> Result<bool, String> {
    dcall(Grade::Write, "db_close", json!({ "handle": handle, "lease": lease }), None)
        .await
        .map(|v| v.as_bool().unwrap_or(false))
}

/// 트랜잭션 작업(판 9) — `action` = `begin` · `commit` · `rollback` · `extend` · `state`. `txId` 는 화면이 아는 작업(끝내기 · 연장).
#[tauri::command]
pub async fn db_tx(handle: u64, lease: u64, action: String, tx_id: Option<u64>) -> Result<Value, String> {
    check_tx_protocol()?;
    dcall(
        Grade::Write,
        "db_tx",
        json!({ "handle": handle, "lease": lease, "action": action, "txId": tx_id.unwrap_or(0) }),
        None,
    )
    .await
}

/// 스크립트 실행(판 10) — 문장 목록을 한 요청으로(서버가 나누고 전부 검증한 뒤 한 트랜잭션으로 돈다 — `db::script`). GUI 쪽 요청 시한은
/// 서버의 전체 시한 + 커밋 대기 + 여유(`client` 의 `db_script`).
#[tauri::command]
pub async fn db_script(
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    max_rows: Option<u64>,
    timeout_ms: Option<u64>,
    tx_id: Option<u64>,
) -> Result<Value, String> {
    check_script_protocol()?;
    let (_, ms) = crate::db::clamp_limits(max_rows, timeout_ms);
    dcall(
        Grade::Write,
        "db_script",
        json!({ "handle": handle, "lease": lease, "sql": sql, "queryId": query_id, "maxRows": max_rows, "timeoutMs": ms, "txId": tx_id }),
        None,
    )
    .await
}
