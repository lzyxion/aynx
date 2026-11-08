//! 세션 서버 안의 **볼트 평면 op**(③-3b1) — 금고(`crate::vault::Vault`)·외부 MCP 실행 브로커·HTTP 헤더 프록시
//! (`crate::mcp_launch::Broker`)의 주인이 서버라서, GUI 는 이 op 들로만 닿는다(`server::vault_proxy` 가 같은 이름의
//! Tauri 명령으로 감싼다 — 프런트 변경 최소).
//!
//! ## op 표 — **값을 돌려주는 op 는 없다**
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `vault_status` | 읽기 | — → `{state, hasMaster, entryCount, lockReason?, relock}` |
//! | `vault_list` | 읽기 | — → `[{kind, target}]` |
//! | `vault_has` | 읽기 | `{kind, target}` → bool |
//! | `vault_create` | 쓰기 | `{master?}` → — (마스터는 GUI → 서버 한 방향) |
//! | `vault_unlock` | 쓰기 | `{master?}` → — (같음) |
//! | `vault_verify_master` | 쓰기 | `{master}` → `{result: ok\|bad\|no-master\|no-vault\|limited, retryAfterMs?}` — **상태를 바꾸지 않는다**(판 16 · 원격 웹 R1a-2) |
//! | `vault_lock` | 쓰기 | `{reason: shade\|user\|windows_zero}` → `{reason, revoked}` |
//! | `vault_set_master` | 쓰기 | `{new?, current?}` → — |
//! | `vault_store` | 쓰기 | `{kind, target, value}` → `mcp_env` 면 새 참조(`<label>:<무작위>` — 값 아님), 아니면 — |
//! | `vault_delete` · `vault_delete_all` | 쓰기 | `{kind, target}` / — → — |
//! | `vault_prune` | 쓰기 | `{saved: [참조]}` → — (설정 저장 뒤 — 살아 있는 티켓의 참조는 서버가 직접 모은다) |
//! | `mcp_prepare` | 쓰기 | `{server, cwd?}` → 티켓이 박힌 실행 모양(도우미 인자 · 프록시 URL — 값·변수 이름·헤더 이름 없음) |
//! | `mcp_retain` | 쓰기 | `{servers}` → — (설정 저장 뒤 — 구성이 바뀐 서버의 티켓 회수) |
//!
//! 모든 몸에 `lang`(`"ko"`·`"en"`)이 붙을 수 있다 — 서버가 만드는 사람 문구(`[vault-locked]` 등 이유 코드 포함)의 언어.
//!
//! **값이 실리는 방향은 GUI → 서버 하나**(사람이 친 마스터·비밀번호·암호구·MCP 값). 응답에 값이 없다는 것을 시험이
//! 못 박는다(`tests::vault_ops_never_answer_with_a_secret` — 아는 비밀을 담고 모든 op 의 응답 JSON 을 훑는다).
//! 몸을 못 풀면 serde 오류 문구 대신 고정 문구 하나다(serde 의 "invalid type: string \"…\"" 가 값을 되풀이하지 않게).
//! 로그에는 op·까닭·개수만 남는다.
//!
//! ## SSH 는 금고를 **같은 프로세스에서** 읽는다 (③-3b2)
//!
//! SSH 대화형 접속(`ssh/auth.rs` 의 `vault_secrets`)·헤드리스 위임(`headless.rs` — `vault_passphrase` 위임 호스트)은 세션
//! 서버에서 돌고 `server::hub::vault` 로 이 금고를 직접 본다. ③-3b1 의 과도기 op `vault_credential_transitional` 은 지웠다 —
//! 값이 응답으로 나가는 op 는 이제 하나도 없다.
//!
//! ## 잠금 정책 (2026-10-09 결정 4)
//!
//! - `shade`·`user` → 볼트 잠금 + **HTTP 헤더 프록시 티켓 폐기**(예전 그대로 — 해제해도 되살지 않는다).
//! - `windows_zero` → 볼트 잠금 + 티켓 **정지**(지우지 않는다 — 잠긴 동안 프록시는 503 + 짧은 이유, 브로커는 값을 안 내준다,
//!   해제하면 같은 티켓이 되산다). GUI 가 마지막 창을 파괴할 때 보내고, **서버도 클라이언트가 0 이 되는 순간 스스로 건다**
//!   (`serve::serve_conn` — GUI kill 대비). 이미 창 0개로 잠긴 금고에 가림막이 와도 정지는 폐기로 바뀌지 않는다(`Vault::lock`).
//! - 이미 넘긴 환경변수·진행 중 요청의 비밀은 회수되지 않는다(설계 4.4 — 정직한 한계).

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::ipc::frame::code;
use crate::i18n::tr;
use super::ipc::WireError;
use crate::agent_mcp::McpServer;
use crate::fail_limit::FailLimiter;
use crate::mcp_launch::Broker;
use crate::vault::{self, Kind, LockReason, Vault};

/// 볼트 평면 한 벌 — 서버가 시작할 때 만든다(`serve::run`).
pub(crate) struct VaultPlane {
    pub vault: Arc<Vault>,
    /// 실행 브로커(못 띄웠으면 `None` — `mcp_prepare` 가 실패하고 AI 타일은 외부 MCP 없이 뜬다).
    pub broker: Option<Arc<Broker>>,
    /// `vault_verify_master` 의 실패 빈도 제한(서버 전역 하나 — 원격 관문의 기기별·전역 제한과 별개의 둘째 겹).
    verify_limit: Mutex<FailLimiter>,
}

/// `vault_verify_master` — 잇단 5번 틀리면 60초, 그 뒤 두 배씩(상한 1시간).
const VERIFY_LIMIT: FailLimiter = FailLimiter::new(5, Duration::from_secs(60), Duration::from_secs(60 * 60));

impl VaultPlane {
    pub(crate) fn new(dir: Option<std::path::PathBuf>) -> VaultPlane {
        let vault = Arc::new(Vault::new(dir));
        let broker = Broker::start(vault.clone()).ok();
        if broker.is_none() {
            super::log::line("mcp launch broker failed to start — AI tiles open without external MCP secrets");
        }
        VaultPlane {
            vault,
            broker,
            verify_limit: Mutex::new(VERIFY_LIMIT),
        }
    }

    /// 상태 줄(`status`)에 싣는 것 — 포트·티켓 수뿐(값·티켓 없음).
    pub(crate) fn status(&self) -> Value {
        match &self.broker {
            Some(b) => {
                let (stdio, http) = b.counts();
                json!({ "broker_port": b.port(), "proxy_port": b.proxy_port(), "stdio_tickets": stdio, "http_tickets": http })
            }
            None => Value::Null,
        }
    }
}

/// 이 파일이 받는 op 인가(`serve::serve_conn` 이 가른다 — 디스크·Argon2 를 쓰므로 블로킹 풀에서 돈다).
pub(crate) fn is_vault_op(op: &str) -> bool {
    matches!(
        op,
        "vault_status"
            | "vault_list"
            | "vault_has"
            | "vault_create"
            | "vault_unlock"
            | "vault_verify_master"
            | "vault_lock"
            | "vault_set_master"
            | "vault_store"
            | "vault_delete"
            | "vault_delete_all"
            | "vault_prune"
            | "mcp_prepare"
            | "mcp_retain"
    )
}

/// 볼트 op 실패 코드 — `message` 는 사람 문구(이유 코드 `[vault-locked]` 등을 그대로 싣는다 — 값은 없다).
pub(crate) const VAULT: &str = "vault";

fn verr(message: String) -> WireError {
    WireError::new(VAULT, message)
}

/// 몸 풀기 — serde 오류 문구를 싣지 않는다(값을 되풀이할 수 있다 — 머리말).
fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|_| WireError::new(code::BAD_BODY, "bad vault request body"))
}

#[derive(Deserialize)]
struct KindTarget {
    kind: String,
    target: String,
}

#[derive(Deserialize)]
struct Master {
    #[serde(default)]
    master: Option<String>,
}

#[derive(Deserialize)]
struct Verify {
    master: String,
}

#[derive(Deserialize)]
struct SetMaster {
    #[serde(default)]
    new: Option<String>,
    #[serde(default)]
    current: Option<String>,
}

#[derive(Deserialize)]
struct Lock {
    reason: String,
}

#[derive(Deserialize)]
struct Store {
    kind: String,
    target: String,
    value: String,
}

#[derive(Deserialize)]
struct Prune {
    saved: Vec<String>,
}

#[derive(Deserialize)]
struct Prepare {
    server: McpServer,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct Retain {
    servers: Vec<McpServer>,
}


fn kind(s: &str) -> Result<Kind, WireError> {
    vault::parse_kind(s).map_err(verr)
}

fn broker(plane: &VaultPlane) -> Result<&Broker, WireError> {
    plane
        .broker
        .as_deref()
        .ok_or_else(|| verr("Could not start the MCP launcher".into()))
}

/// 잠근다 — 까닭에 따라 HTTP 티켓을 폐기하거나(가림막·사람) 그대로 둔다(창 0개 = 정지). `{reason, revoked}`.
pub(crate) fn lock(plane: &VaultPlane, reason: LockReason, why: &str) -> Value {
    let effective = plane.vault.lock(reason);
    let revoked = match (&plane.broker, effective) {
        (_, LockReason::WindowsZero) | (None, _) => 0,
        (Some(b), _) => b.revoke_http(),
    };
    let http = plane.broker.as_ref().map_or(0, |b| b.counts().1);
    super::log::line(format!(
        "vault locked — {} ({why}) · http tickets revoked {revoked} · kept {http}{}",
        effective.wire(),
        if effective == LockReason::WindowsZero { " (suspended until unlock)" } else { "" }
    ));
    json!({ "reason": effective.wire(), "revoked": revoked })
}

/// 마스터 확인 — 상태를 바꾸지 않는다(`Vault::verify_master`). 막혀 있으면 Argon2 를 돌리지도 않는다. 확인이 오류로 끝나면
/// (디스크 등) 빈도 제한에 세지 않고 `{result: "error"}` 다(문구에 값은 없다 — 그래도 싣지 않는다). 로그엔 갈래·누계만.
pub(crate) fn verify_master(plane: &VaultPlane, master: &str, now: Instant) -> Value {
    let blocked = plane.verify_limit.lock().unwrap_or_else(|e| e.into_inner()).blocked(now);
    if let Some(left) = blocked {
        return json!({ "result": "limited", "retryAfterMs": left.as_millis() as u64 });
    }
    let checked = plane.vault.verify_master(master);
    let mut limit = plane.verify_limit.lock().unwrap_or_else(|e| e.into_inner());
    match checked {
        Ok(vault::MasterCheck::Bad) => {
            let locked = limit.fail(now);
            super::log::line(format!(
                "vault master check — bad (total fails {}){}",
                limit.total(),
                if locked.is_some() { " · locked out" } else { "" }
            ));
            match locked {
                Some(span) => json!({ "result": "bad", "retryAfterMs": span.as_millis() as u64 }),
                None => json!({ "result": "bad" }),
            }
        }
        Ok(r) => {
            if r == vault::MasterCheck::Ok {
                limit.success();
            }
            json!({ "result": r.wire() })
        }
        Err(_) => {
            super::log::line("vault master check — error");
            json!({ "result": "error" })
        }
    }
}

/// op 하나 — **블로킹**(디스크·Argon2). `serve` 가 `spawn_blocking` 으로 부른다.
pub(crate) fn handle(op: &str, mut b: Value, plane: &VaultPlane) -> Result<Value, WireError> {
    if let Some(l) = b.get("lang").and_then(Value::as_str).and_then(crate::i18n::parse) {
        crate::i18n::set_lang(l);
    }
    if let Some(o) = b.as_object_mut() {
        o.remove("lang");
    }
    let v = &plane.vault;
    match op {
        "vault_status" => Ok(serde_json::to_value(v.status()).unwrap_or(Value::Null)),
        "vault_list" => v
            .list()
            .map(|items| serde_json::to_value(items).unwrap_or(Value::Null))
            .map_err(verr),
        "vault_has" => {
            let a: KindTarget = body(b)?;
            v.has(kind(&a.kind)?, &a.target).map(Value::Bool).map_err(verr)
        }
        "vault_create" => {
            let a: Master = body(b)?;
            let master = a.master.map(Zeroizing::new);
            v.create(master.as_deref().map(String::as_str)).map_err(verr)?;
            super::log::line("vault created");
            Ok(Value::Null)
        }
        "vault_unlock" => {
            let a: Master = body(b)?;
            let master = a.master.map(Zeroizing::new);
            v.unlock(master.as_deref().map(String::as_str)).map_err(verr)?;
            let http = plane.broker.as_ref().map_or(0, |b| b.counts().1);
            super::log::line(format!("vault unlocked · http tickets live {http}"));
            Ok(Value::Null)
        }
        "vault_verify_master" => {
            let a: Verify = body(b)?;
            let master = Zeroizing::new(a.master);
            Ok(verify_master(plane, &master, Instant::now()))
        }
        "vault_lock" => {
            let a: Lock = body(b)?;
            let reason = LockReason::parse(&a.reason)
                .ok_or_else(|| WireError::new(code::BAD_BODY, "unknown lock reason"))?;
            Ok(lock(plane, reason, "client"))
        }
        "vault_set_master" => {
            let a: SetMaster = body(b)?;
            let (new, current) = (a.new.map(Zeroizing::new), a.current.map(Zeroizing::new));
            v.set_master(new.as_deref().map(String::as_str), current.as_deref().map(String::as_str))
                .map_err(verr)?;
            super::log::line("vault key source changed");
            Ok(Value::Null)
        }
        "vault_store" => {
            let a: Store = body(b)?;
            let value = Zeroizing::new(a.value);
            match kind(&a.kind)? {
                Kind::McpEnv => v.store_mcp_env(&a.target, value).map(Value::String).map_err(verr),
                k => v.store(k, a.target, value).map(|()| Value::Null).map_err(verr),
            }
        }
        "vault_delete" => {
            let a: KindTarget = body(b)?;
            v.delete(kind(&a.kind)?, &a.target).map(|()| Value::Null).map_err(verr)
        }
        "vault_delete_all" => v.delete_all().map(|()| Value::Null).map_err(verr),
        "vault_prune" => {
            let a: Prune = body(b)?;
            // 티켓 표 → 볼트 순서(락을 겹쳐 쥐지 않는다 — 참조를 모으면 티켓 락은 놓였다).
            let active = match &plane.broker {
                Some(br) => br.active_secret_refs().map_err(|()| verr("ticket table poisoned".into()))?,
                None => HashSet::new(),
            };
            v.prune_mcp_env(a.saved.into_iter().collect(), active).map_err(|_| {
                verr(tr!(
                    ko: "미사용 MCP 비밀 값을 정리하지 못했습니다",
                    en: "Could not clean up unused MCP secrets",
                ))
            })?;
            Ok(Value::Null)
        }
        "mcp_prepare" => {
            let a: Prepare = body(b)?;
            let prepared = broker(plane)?.prepare(&a.server, a.cwd.as_deref()).map_err(verr)?;
            Ok(serde_json::to_value(prepared).unwrap_or(Value::Null))
        }
        "mcp_retain" => {
            let a: Retain = body(b)?;
            if let Some(br) = &plane.broker {
                br.retain(&a.servers);
            }
            Ok(Value::Null)
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane(tag: &str) -> (VaultPlane, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("aynx-verify-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let plane = VaultPlane {
            vault: Arc::new(Vault::new(Some(dir.clone()))),
            broker: None,
            verify_limit: Mutex::new(VERIFY_LIMIT),
        };
        (plane, dir)
    }

    /// `vault_verify_master` — 맞음·틀림·없음을 가르고 상태를 바꾸지 않으며, 5번 틀리면 막혀 Argon2 를 돌리지 않는다(맞는 암호도
    /// 막힌 동안은 `limited`). 응답에 암호가 없다.
    #[test]
    fn verify_master_op_rate_limits_and_never_echoes() {
        const MASTER: &str = "m-SECRET-verify";
        let (p, dir) = plane("op");
        let t0 = Instant::now();
        assert_eq!(verify_master(&p, "x", t0), json!({ "result": "no-vault" }));
        p.vault.create(Some(MASTER)).unwrap();
        p.vault.lock(LockReason::Shade);
        assert_eq!(handle("vault_verify_master", json!({ "master": MASTER, "lang": "en" }), &p).unwrap(), json!({ "result": "ok" }));
        assert!(!p.vault.is_unlocked(), "확인은 열지 않는다");
        let mut last = Value::Null;
        for _ in 0..5 {
            last = verify_master(&p, "wrong", t0);
            assert!(!last.to_string().contains("wrong"));
        }
        assert_eq!(last["result"], "bad");
        assert_eq!(last["retryAfterMs"], 60_000);
        let r = verify_master(&p, MASTER, t0 + Duration::from_secs(1));
        assert_eq!(r["result"], "limited");
        assert!(!r.to_string().contains(MASTER));
        // 풀린 뒤 맞는 암호 → ok, 다시 처음부터 센다
        assert_eq!(verify_master(&p, MASTER, t0 + Duration::from_secs(61)), json!({ "result": "ok" }));
        assert_eq!(verify_master(&p, "wrong", t0 + Duration::from_secs(62)), json!({ "result": "bad" }));
        // 몸이 틀리면 고정 문구
        assert_eq!(handle("vault_verify_master", json!({ "master": 5 }), &p).unwrap_err().code, code::BAD_BODY);
        assert!(is_vault_op("vault_verify_master"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
