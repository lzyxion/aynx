//! GUI 쪽 **DB 평면 껍데기** — 연결 표·엔진은 세션 서버에 산다. 같은 이름의 Tauri 명령이 서버 op 하나씩을 부른다.
//!
//! - **판**: 붙은 서버의 판이 낮으면 보내지 않고 `[server-outdated]` 로 끝낸다 — 판 7 서버와도 협상이 서므로 셸·SSH 는 그대로 돈다.
//! - `password`(DB) · `ssh`(경유 SSH 관문의 답 — 비밀번호·암호구 포함)는 이 호출 한 번의 몸에만 싣는다(로그·`Debug` 없음).
//! - 경로·주소·경유를 보내지 않는다 — 서버가 `db-connections.json` 에서 다시 읽는다. **예외 하나 — [`db_test`]** 는 저장 전 초안 한 줄을
//!   싣는다. 볼트 비밀번호로 물러날지는 저장된 줄과 대상을 견줘 **서버가** 정한다 — 이 몸에는 그 판단이 없다.

use std::time::Duration;

use serde_json::{json, Value};

use super::client;
use super::ipc::frame::{
    DB_AUTOCOMMIT_PROTOCOL, DB_PROTOCOL, DB_READ_QUERY_PROTOCOL, DB_SCRIPT_PROTOCOL, DB_TEST_PROTOCOL, DB_TX_PROTOCOL, DB_TX_SERIAL_PROTOCOL, DB_TX_VERDICT_PROTOCOL,
};
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

/// 폼은 `db_ai_list` 의 `connTest` 로 단추를 숨긴다 — 이것은 그 사이 서버가 바뀐 틈을 막는다.
fn check_test_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_TEST_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 연결을 테스트할 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot test connections — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 옛 서버는 `readOnly` 칸을 버리고 타일 모드대로 돌린다(쓰기 모드면 사람이 친 WHERE 글이 쓰기 길로 간다) — 그런 서버에는 보내지 않는다.
fn check_read_query_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < DB_READ_QUERY_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 데이터 탭을 조회할 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot load the data tab — restart it in Settings › Session server (open shell sessions will close)"
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
        // 협상 뒤 서버가 바뀐 틈 — 같은 안내.
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

/// 실패는 사람 문구(글자) 또는 경유 SSH 관문의 `SshOpenError` 객체(프런트의 `runSshGates` 가 묻고 다시 부른다).
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
            // 서버가 `[db-needs-work]` 를 내는 판인가 — 칸은 GUI 가 얹는다(서버 답 모양 그대로).
            if let Some(o) = v.as_object_mut() {
                let ready = client::negotiated_protocol().is_none_or(|p| p >= DB_TX_VERDICT_PROTOCOL);
                o.insert("txVerdicts".into(), Value::Bool(ready));
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

/// 저장 안 한 초안(`db_conn_save` 의 한 줄 꼴)으로 한 번 붙고 닫는다. 비밀 · 실패의 꼴은 [`db_open`] 과 같다.
#[tauri::command]
pub async fn db_test(stream: String, conn: Value, password: Option<String>, ssh: Option<Value>) -> Result<Value, Value> {
    let password = password.map(zeroize::Zeroizing::new);
    check_protocol().map_err(Value::String)?;
    check_test_protocol().map_err(Value::String)?;
    let body = json!({
        "stream": stream,
        "conn": conn,
        "password": password.as_deref(),
        "ssh": ssh,
        "lang": lang(),
    });
    match client::request(Grade::Write, "db_test", body).await {
        Ok(v) => Ok(v),
        Err(e) if e.code == super::sessions::SSH_OPEN => match serde_json::from_str::<Value>(&e.message) {
            Ok(v) if v.get("kind").is_some() => Err(v),
            _ => Err(Value::String(e.message)),
        },
        Err(e) => Err(Value::String(reach_error(e))),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약
pub async fn db_query(
    handle: u64,
    lease: u64,
    sql: String,
    query_id: String,
    max_rows: Option<u64>,
    timeout_ms: Option<u64>,
    tx_id: Option<u64>,
    read_only: Option<bool>,
) -> Result<Value, String> {
    let read_only = read_only.unwrap_or(false);
    if read_only {
        check_read_query_protocol()?;
    }
    let (_, ms) = crate::db::clamp_limits(max_rows, timeout_ms);
    dcall(
        Grade::Write,
        "db_query",
        json!({ "handle": handle, "lease": lease, "sql": sql, "queryId": query_id, "maxRows": max_rows, "timeoutMs": ms, "txId": tx_id, "readOnly": read_only }),
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

/// 실행하지 않는다.
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
    // 옛 서버는 모르는 칸을 버려 **끈 줄 알고 친 문장이 곧바로 커밋된다** — 보내지 않는다.
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

/// `action` = `begin` · `commit` · `rollback` · `extend` · `state`.
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
