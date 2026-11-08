//! GUI 쪽 **볼트 평면 껍데기**(③-3b1) — 금고·실행 브로커·헤더 프록시는 세션 서버에 산다(`server::vault_ops`). 여기 있는
//! 것은 프런트가 부르던 `vault_*` Tauri 명령(이름·인자·반환 그대로 — 프런트 변경 최소)과, GUI 의 Rust 가 쓰는 몇 문이다.
//!
//! - **값을 돌려받는 명령은 없다** — 프런트가 받는 것은 상태·종류·대상·MCP 참조뿐(예전 그대로). 값은 GUI → 서버 한 방향
//!   (사람이 친 마스터·비밀번호·암호구·MCP 값)이고, 이 파일은 그 값을 로그·Debug 에 남기지 않는다.
//! - AI 타일의 외부 MCP 조립(`agent_mcp::apply_configured`)은 [`mcp_prepare_blocking`] 으로 티켓이 박힌 실행 모양을 받는다.
//! - 설정 저장은 [`settings_saved_blocking`] — 구성이 바뀐 서버의 티켓 회수(`mcp_retain`) 뒤 안 쓰는 MCP 값 정리(`vault_prune`).
//! - 마지막 창이 파괴되면 [`lock_on_last_window`] 가 `vault_lock{windows_zero}` 를 보낸다(서버도 클라이언트 0 이면 스스로 건다).
//! - 호스트 비밀번호·키 암호구를 GUI 로 받는 길은 **없다**(③-3b2 — SSH 인증·헤드리스가 서버에서 금고를 직접 읽는다. ③-3b1 의
//!   과도기 op `vault_credential_transitional` 은 지웠다).

use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::ipc::Grade;
use super::proxy::call;
use crate::agent_mcp::McpServer;
use crate::i18n::{self, Lang};

/// 서버가 만드는 사람 문구의 언어 — 몸마다 싣는다(서버에는 언어 설정이 없다).
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

/// 서버에 닿지 못했을 때의 상태 — "없다"(프런트의 `UNKNOWN` 과 같은 그림).
fn absent() -> Value {
    json!({ "state": "absent", "hasMaster": false, "entryCount": 0, "relock": false })
}

// ── 프런트 계약 (`src/lib/vault.ts`) ─────────────────────────────────────

/// 금고가 있는가·잠겼는가·몇 개 들었는가 — **오류를 내지 않는다**(서버에 닿지 못하면 "없다").
/// `lockReason`·`relock`(③-3b1): 창 0개로 잠긴 금고면 붙는 창이 가림막을 **잠그지 않고** 세운다(`app/veil`).
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

/// 지금 잠근다 — `reason` 은 `"shade"`(가림막 — 기본)·`"user"`(설정 [잠그기]). 둘 다 HTTP 헤더 프록시 티켓을 폐기한다.
/// 창 0개 잠금은 프런트가 보내지 않는다([`lock_on_last_window`]·서버 자신).
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

/// 설정 › 보안의 **들어가기 관문**(2026-10-21) — 열린 볼트의 마스터 암호를 **확인만** 한다(서버 op `vault_verify_master` —
/// 상태를 바꾸지 않는다 · 서버가 실패 빈도를 센다 · 원격 관문의 재확인과 같은 문). 돌려주는 것은 판정 글자 하나
/// (`ok`·`bad`·`no-master`·`no-vault`·`limited`)와 막힌 길이(ms)뿐이고, 암호는 GUI → 서버 한 방향이다.
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

/// 무엇이 들어 있는가 — 종류와 대상뿐.
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

/// 호스트 비밀번호를 담는다(값은 GUI → 서버 한 방향).
#[tauri::command]
pub async fn vault_store_password(alias: String, value: String) -> Result<(), String> {
    store("host_password", alias, value).await.map(|_| ())
}

/// 개인키 파일의 암호구를 담는다.
#[tauri::command]
pub async fn vault_store_passphrase(path: String, value: String) -> Result<(), String> {
    store("key_passphrase", path, value).await.map(|_| ())
}

/// 쿼리 타일 DB 연결의 비밀번호를 담는다 — 대상은 DB 연결의 고정 `id`(`db-connections.json` — 호스트 별칭 아님).
#[tauri::command]
pub async fn vault_store_db_password(id: String, value: String) -> Result<(), String> {
    store("db_password", id, value).await.map(|_| ())
}

/// MCP 환경변수·헤더 값을 담고 **새 참조**를 받는다(값이 아니다).
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

/// AI 타일의 외부 MCP 서버 하나를 서버의 브로커에 맡기고 **티켓이 박힌 실행 모양**을 받는다(값·변수 이름·헤더 이름 없음).
/// 블로킹 풀에서 부른다(`agent_autorun::agent_autorun_command` 의 `spawn_blocking` 안 — 거기서 런타임에 블록한다).
pub(crate) fn mcp_prepare_blocking(server: &McpServer, cwd: Option<&str>) -> Result<McpServer, String> {
    let body = json!({ "server": server, "cwd": cwd });
    let v = tauri::async_runtime::block_on(vcall(Grade::Write, "mcp_prepare", body))?;
    serde_json::from_value(v).map_err(|_| "bad mcp_prepare reply".to_string())
}

/// 설정 [저장] 뒤 — 구성이 바뀐 서버의 티켓 회수 → 안 쓰는 MCP 값 정리(이 순서 — 예전 `save_settings` 그대로).
/// 블로킹 풀에서 부른다. 실패는 한 줄 로그(값 없음)로 접는다 — 설정 저장은 이미 끝났다.
pub(crate) fn settings_saved_blocking(servers: &[McpServer], saved: Vec<String>) {
    let r = tauri::async_runtime::block_on(async {
        unit("mcp_retain", json!({ "servers": servers })).await?;
        unit("vault_prune", json!({ "saved": saved })).await
    });
    if r.is_err() {
        eprintln!("[aynx] 미사용 MCP 비밀 값을 정리하지 못했습니다");
    }
}

/// 마지막 창이 파괴됐다 — 세션 서버에 창 0개 잠금을 보낸다(HTTP 티켓은 정지). **이벤트 훅(동기)에서 부른다** — 짧게
/// 기다린다(프로세스가 곧 끝난다). 서버에 닿지 못해도 괜찮다: 연결이 끊기면 서버가 클라이언트 0 으로 스스로 잠근다.
pub(crate) fn lock_on_last_window() {
    tauri::async_runtime::block_on(lock_windows_zero());
}

/// 창 0개 잠금 한 번 — [`lock_on_last_window`](창 파괴 훅)와 원격 창 셈(`remote::windows` — 마지막 원격 창이 빠졌고 집 PC 창도
/// 없을 때 · tokio 태스크에서)이 같이 쓴다.
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


// ── 원격 웹 관문(R1a-2)이 쓰는 문 — Tauri 명령이 아니다 ─────────────────────

/// `vault_status` 그대로 — 다만 서버에 닿지 못하면 "없다" 로 접지 않고 **실패**다(원격 가림막이 마스터 유무를 잘못 읽어 암호 없이
/// 걷히지 않게).
pub(crate) async fn status_checked() -> Result<Value, String> {
    vcall(Grade::Read, "vault_status", json!({})).await
}

/// [`verify_master`] 의 답 — 값이 없다.
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

/// 마스터 암호를 **확인만** 한다(서버 op `vault_verify_master` — 판 16 · 볼트 상태를 바꾸지 않는다 · 서버가 실패 빈도를 센다).
/// 판 15 이하 서버면 보내지 않는다(`[server-outdated]`). 암호는 GUI → 서버 한 방향이고 여기서 남기지 않는다.
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
