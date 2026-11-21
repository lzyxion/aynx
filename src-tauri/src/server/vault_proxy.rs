//! GUI 쪽 볼트 평면 껍데기 — 금고 · 실행 브로커 · 헤더 프록시는 세션 서버(`server::vault_ops`)에 산다.
//!
//! - 값을 돌려받는 명령은 없다 — 프런트가 받는 것은 상태 · 종류 · 대상 · MCP 참조뿐. 값은 GUI → 서버 한 방향이고 로그 · Debug 에 남기지 않는다.
//! - 호스트 비밀번호 · 키 암호구를 GUI 로 받는 길도 없다 — SSH 인증 · 헤드리스는 서버에서 금고를 직접 읽는다(→ docs/invariants.md 전문 2).

use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::ipc::Grade;
use super::proxy::call;
use crate::agent_mcp::McpServer;
use crate::i18n::{self, Lang};

/// 서버에는 언어 설정이 없다 — 몸마다 싣는다.
fn lang() -> &'static str {
    match i18n::lang() {
        Lang::En => "en",
        Lang::Ko => "ko",
    }
}

async fn vcall(kind: Grade, op: &str, mut body: Value) -> Result<Value, String> {
    if let Some(o) = body.as_object_mut() {
        o.insert("lang".into(), json!(lang()));
    } else {
        body = json!({ "lang": lang() });
    }
    call(kind, op, body).await
}

async fn unit(op: &str, body: Value) -> Result<(), String> {
    vcall(Grade::Write, op, body).await.map(|_| ())
}

/// 프런트의 `UNKNOWN` 과 같은 그림.
fn absent() -> Value {
    json!({ "state": "absent", "hasMaster": false, "entryCount": 0, "relock": false })
}

// ── 프런트 계약 (`src/lib/vault.ts`) ─────────────────────────────────────

/// 오류를 내지 않는다 — 서버에 닿지 못하면 "없다".
#[tauri::command]
pub async fn vault_status() -> Value {
    vcall(Grade::Read, "vault_status", json!({})).await.unwrap_or_else(|_| absent())
}

#[tauri::command]
pub async fn vault_create(master: Option<String>) -> Result<(), String> {
    let master = master.map(Zeroizing::new);
    unit("vault_create", json!({ "master": master.as_deref() })).await
}

#[tauri::command]
pub async fn vault_unlock(master: Option<String>) -> Result<(), String> {
    let master = master.map(Zeroizing::new);
    unit("vault_unlock", json!({ "master": master.as_deref() })).await
}

/// 창 0개 잠금(`windows_zero`)은 프런트가 보낼 수 없다 — 그 밖은 `shade` 로 접힌다.
#[tauri::command]
pub async fn vault_lock(reason: Option<String>) -> Result<(), String> {
    let reason = match reason.as_deref() {
        Some("user") => "user",
        _ => "shade",
    };
    unit("vault_lock", json!({ "reason": reason })).await
}

#[tauri::command]
pub async fn vault_set_master(new: Option<String>, current: Option<String>) -> Result<(), String> {
    let (new, current) = (new.map(Zeroizing::new), current.map(Zeroizing::new));
    unit("vault_set_master", json!({ "new": new.as_deref(), "current": current.as_deref() })).await
}

/// 설정 › 보안의 들어가기 관문 — 확인만 한다(볼트 상태를 바꾸지 않는다 · 실패 빈도는 서버가 센다).
#[tauri::command]
pub async fn vault_verify_master(master: String) -> Result<Value, String> {
    let master = Zeroizing::new(master);
    Ok(match verify_master(&master).await? {
        MasterVerdict::Ok => json!({ "result": "ok" }),
        MasterVerdict::Bad(ms) => json!({ "result": "bad", "retryAfterMs": ms }),
        MasterVerdict::NoMaster => json!({ "result": "no-master" }),
        MasterVerdict::NoVault => json!({ "result": "no-vault" }),
        MasterVerdict::Limited(ms) => json!({ "result": "limited", "retryAfterMs": ms }),
    })
}

/// 종류와 대상뿐.
#[tauri::command]
pub async fn vault_list() -> Result<Value, String> {
    vcall(Grade::Read, "vault_list", json!({})).await
}

#[tauri::command]
pub async fn vault_delete(kind: String, target: String) -> Result<(), String> {
    unit("vault_delete", json!({ "kind": kind, "target": target })).await
}

#[tauri::command]
pub async fn vault_delete_all() -> Result<(), String> {
    unit("vault_delete_all", json!({})).await
}

async fn store(kind: &str, target: String, value: String) -> Result<Value, String> {
    let value = Zeroizing::new(value);
    vcall(
        Grade::Write,
        "vault_store",
        json!({ "kind": kind, "target": target, "value": value.as_str() }),
    )
    .await
}

#[tauri::command]
pub async fn vault_store_password(alias: String, value: String) -> Result<(), String> {
    store("host_password", alias, value).await.map(|_| ())
}

#[tauri::command]
pub async fn vault_store_passphrase(path: String, value: String) -> Result<(), String> {
    store("key_passphrase", path, value).await.map(|_| ())
}

/// 대상은 DB 연결의 고정 `id`(`db-connections.json`)다 — 호스트 별칭이 아니다.
#[tauri::command]
pub async fn vault_store_db_password(id: String, value: String) -> Result<(), String> {
    store("db_password", id, value).await.map(|_| ())
}

/// 돌려받는 것은 새 참조다(값이 아니다).
#[tauri::command]
pub async fn vault_store_mcp_env(label: String, value: String) -> Result<String, String> {
    let v = store("mcp_env", label, value).await?;
    v.as_str()
        .map(str::to_owned)
        .ok_or_else(|| "bad vault reply".to_string())
}

async fn has(kind: &str, target: String) -> Result<bool, String> {
    vcall(Grade::Read, "vault_has", json!({ "kind": kind, "target": target }))
        .await
        .map(|v| v.as_bool().unwrap_or(false))
}

#[tauri::command]
pub async fn vault_has_password(alias: String) -> Result<bool, String> {
    has("host_password", alias).await
}

#[tauri::command]
pub async fn vault_has_passphrase(path: String) -> Result<bool, String> {
    has("key_passphrase", path).await
}

#[tauri::command]
pub async fn vault_has_db_password(id: String) -> Result<bool, String> {
    has("db_password", id).await
}

// ── GUI 의 Rust 가 쓰는 문 ─────────────────────────────────────────────

/// 티켓이 박힌 실행 모양을 받는다(값 · 변수 이름 · 헤더 이름 없음). `block_on` 이라 블로킹 풀에서만 부른다.
pub(crate) fn mcp_prepare_blocking(server: &McpServer, cwd: Option<&str>) -> Result<McpServer, String> {
    let body = json!({ "server": server, "cwd": cwd });
    let v = tauri::async_runtime::block_on(vcall(Grade::Write, "mcp_prepare", body))?;
    serde_json::from_value(v).map_err(|_| "bad mcp_prepare reply".to_string())
}

/// 티켓 회수 → 안 쓰는 MCP 값 정리, 이 순서다. 블로킹 풀에서만 부른다.
pub(crate) fn settings_saved_blocking(servers: &[McpServer], saved: Vec<String>) {
    let r = tauri::async_runtime::block_on(async {
        unit("mcp_retain", json!({ "servers": servers })).await?;
        unit("vault_prune", json!({ "saved": saved })).await
    });
    if r.is_err() {
        eprintln!("[aynx] 미사용 MCP 비밀 값을 정리하지 못했습니다");
    }
}

/// 창 파괴 이벤트 훅(동기)에서 부른다. 서버에 닿지 못해도 괜찮다 — 연결이 끊기면 서버가 클라이언트 0 으로 스스로 잠근다.
pub(crate) fn lock_on_last_window() {
    tauri::async_runtime::block_on(lock_windows_zero());
}

pub(crate) async fn lock_windows_zero() {
    let sent = tokio::time::timeout(
        std::time::Duration::from_millis(1500),
        super::client::request_now(Grade::Write, "vault_lock", json!({ "reason": "windows_zero", "lang": lang() })),
    )
    .await;
    match sent {
        Ok(Ok(_)) => eprintln!("[server] 마지막 창 — 볼트 잠금(창 0개) 보냄"),
        _ => eprintln!("[server] 마지막 창 — 볼트 잠금을 보내지 못했습니다(서버가 클라이언트 0 으로 스스로 잠근다)"),
    }
}


// ── 원격 웹 관문이 쓰는 문 — Tauri 명령이 아니다 ─────────────────────

/// 서버에 닿지 못하면 "없다" 로 접지 않고 실패다 — 원격 가림막이 마스터 유무를 잘못 읽어 암호 없이 걷히지 않게.
pub(crate) async fn status_checked() -> Result<Value, String> {
    vcall(Grade::Read, "vault_status", json!({})).await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MasterVerdict {
    Ok,
    /// 틀림 — 이번 실패로 서버가 막았으면 그 길이(ms).
    Bad(Option<u64>),
    NoMaster,
    NoVault,
    /// 서버의 실패 빈도 제한에 막혀 확인하지 않았다(남은 ms).
    Limited(u64),
}

pub(crate) async fn verify_master(master: &str) -> Result<MasterVerdict, String> {
    if super::client::negotiated_protocol().is_some_and(|p| p < super::ipc::frame::VAULT_VERIFY_PROTOCOL) {
        return Err(crate::errors::with_reason(
            crate::errors::SERVER_OUTDATED,
            crate::i18n::tr!(
                ko: "세션 서버가 이전 판이라 마스터 암호를 확인할 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요",
                en: "The session server is an older version and cannot check the master password — restart it in Settings › Session server"
            ),
        ));
    }
    let v = vcall(Grade::Write, "vault_verify_master", json!({ "master": master })).await?;
    let ms = |k: &str| v.get(k).and_then(Value::as_u64);
    Ok(match v.get("result").and_then(Value::as_str) {
        Some("ok") => MasterVerdict::Ok,
        Some("bad") => MasterVerdict::Bad(ms("retryAfterMs")),
        Some("no-master") => MasterVerdict::NoMaster,
        Some("no-vault") => MasterVerdict::NoVault,
        Some("limited") => MasterVerdict::Limited(ms("retryAfterMs").unwrap_or(60_000)),
        _ => return Err("vault master check failed".into()),
    })
}
