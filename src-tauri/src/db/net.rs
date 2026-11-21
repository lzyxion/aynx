//! **네트워크 DB 엔진(PG · MySQL/MariaDB)의 공용 자리** — 붙을 곳 · 열기 실패 꼴 · 비밀 재료 · SSH 경유 전송로 · 연결의 생사(`Life`).
//!
//! - SSH 경유는 터미널 타일과 같은 공유 전송로를 빌리고 그 위에 [`TunnelListener`]를 세운다. 이름은 프리셋 host 그대로 — TLS 의
//!   SNI · 이름 검증은 그 이름으로 선다.
//! - 비밀번호를 묻는 사이 전송로를 놓으면 SSH 관문을 또 지나야 해서 `[db-password]` · `[db-auth]` 로 끝난 열기는 전송로를 잠깐
//!   ([`PARK_TTL`]) 세워 둔다([`after_failure`]).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde_json::json;
use zeroize::Zeroizing;

use super::EVT_STATE;
use crate::errors::{has_reason, with_reason, DB_AUTH, DB_DISCONNECTED, DB_PASSWORD};
use crate::i18n::tr;
use crate::port_forward::TunnelListener;
use crate::db::conns::DbTlsMode;
use crate::ssh::open::{acquire_shared, DeathHook, SharedCreds, SharedLease};
use crate::ssh::SshOpenError;

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PARK_TTL: Duration = Duration::from_secs(60);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 서버가 파일(`db-connections.json`)에서 해석한 값이다(GUI 가 보낸 주소가 아니다).
#[derive(Debug, Clone)]
pub(crate) struct NetTarget {
    /// 볼트 열쇠.
    pub id: String,
    /// SSH 경유면 **경유 호스트에서 본** 주소.
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub user: Option<String>,
    pub tls: DbTlsMode,
    /// 검증 모드에서만 서버가 접속 순간 읽는다.
    pub tls_ca: Option<String>,
    pub via: Option<String>,
    /// **제품 경로는 늘 `None`** — 통합 시험이 사용자 설정 파일을 건드리지 않고 임시 sshd 를 거치려고 쓴다.
    pub adhoc: Option<crate::ssh::AdhocTarget>,
}

/// 터미널 SSH 열기와 같은 JSON 꼴로 프런트까지 간다.
#[derive(Debug)]
pub(crate) enum OpenError {
    Msg(String),
    Ssh(SshOpenError),
}

impl From<String> for OpenError {
    fn from(m: String) -> Self {
        OpenError::Msg(m)
    }
}

/// **`Debug` 없음**. `vault` = 몸에 비밀번호가 없을 때 볼트로 물러나도 되나 — 기본값은 거짓(닫힌 쪽). 타일은 늘 참 · AI 연결은 볼트 차례에서만
/// 참(빌린 비밀번호를 실은 차례는 거짓)이고, 폼의 [연결 테스트](`table::test`)는 서버가 파일을 다시 읽어 저장된 연결과 대상이 같을 때만 참이다.
/// `from_vault` = 몸의 값이 이미 볼트에서 읽은 값이다(거절되면 `[db-stored-rejected]`).
#[derive(Default)]
pub(crate) struct OpenSecrets {
    pub password: Option<Zeroizing<String>>,
    pub ssh: SharedCreds,
    pub vault: bool,
    pub from_vault: bool,
}

impl OpenSecrets {
    /// 몸이 비었고 `vault` 면 볼트 값을 몸에 옮긴다 — 쿼리 타일의 새 열기 하나가 부른다(인증에 성공한 그 값이 빌린 비밀번호의 재료다).
    pub(crate) fn settle_password(&mut self, id: &str) {
        self.settle_password_with(|| crate::server::hub::vault().and_then(|v| v.db_password_for(id)));
    }

    pub(crate) fn settle_password_with(&mut self, read_vault: impl FnOnce() -> Option<Zeroizing<String>>) {
        if self.password.is_none() && self.vault {
            self.password = read_vault();
            self.from_vault = self.password.is_some();
        }
    }
}

/// `vault` 가 거짓이면 볼트에 **닿지도 않는다**. `bool` = 볼트에서 왔다.
pub(crate) fn password_for(
    body: Option<Zeroizing<String>>,
    from_vault: bool,
    id: &str,
    vault: bool,
) -> (Option<Zeroizing<String>>, bool) {
    match body {
        Some(p) => (Some(p), from_vault),
        None if vault => {
            let v = crate::server::hub::vault().and_then(|v| v.db_password_for(id));
            let some = v.is_some();
            (v, some)
        }
        None => (None, false),
    }
}

/// 사용자 칸이 비었을 때의 기본(libpq 와 같은 규칙).
pub(crate) fn os_user(fallback: &str) -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| fallback.into())
}

// ── 연결의 생사 ──

pub(crate) struct Life {
    stream: String,
    dead: AtomicBool,
    closing: AtomicBool,
}

impl Life {
    pub(crate) fn new(stream: &str) -> Arc<Life> {
        Arc::new(Life {
            stream: stream.to_string(),
            dead: AtomicBool::new(false),
            closing: AtomicBool::new(false),
        })
    }

    pub(crate) fn is_dead(&self) -> bool {
        self.dead.load(Ordering::SeqCst)
    }

    /// 그 뒤의 죽음은 알리지 않는다.
    pub(crate) fn set_closing(&self) {
        self.closing.store(true, Ordering::SeqCst);
    }

    pub(crate) fn mark_dead(&self) {
        if self.closing.load(Ordering::SeqCst) {
            return;
        }
        // AI 전용 연결은 타일이 아니다 — 화면에 알릴 것이 없다.
        if !self.dead.swap(true, Ordering::SeqCst) && !self.stream.starts_with(super::ai::STREAM_PREFIX) {
            crate::server::hub::emit(EVT_STATE, json!({ "stream": self.stream, "state": "disconnected" }));
        }
    }
}

pub(crate) fn disconnected() -> String {
    with_reason(
        DB_DISCONNECTED,
        tr!(
            ko: "DB 연결이 끊겼습니다 — [다시 연결] 로 다시 붙으세요",
            en: "The database connection was lost — reconnect to continue"
        ),
    )
}

// ── 전송로(SSH 경유) ──

/// 세워 둔 동안은 비고, 엔진이 쓰면 그 엔진의 [`Life`] 가 앉는다.
type Slot = Arc<Mutex<Option<Arc<Life>>>>;

pub(crate) struct Transport {
    alias: String,
    host: String,
    port: u16,
    lease: SharedLease,
    tunnel: TunnelListener,
    slot: Slot,
    dead: Arc<AtomicBool>,
}

impl Transport {
    async fn release(self) {
        self.tunnel.close();
        self.lease.release().await;
    }

    fn same(&self, alias: &str, host: &str, port: u16) -> bool {
        self.alias == alias && self.host == host && self.port == port
    }

    pub(crate) fn local_addr(&self) -> std::net::SocketAddr {
        self.tunnel.local_addr()
    }

    /// 이미 죽었으면 곧바로 죽음 표시.
    pub(crate) fn attach(&self, life: &Arc<Life>) {
        *lock(&self.slot) = Some(Arc::clone(life));
        if self.dead.load(Ordering::SeqCst) {
            life.mark_dead();
        }
    }
}

struct Parked {
    generation: u64,
    transport: Transport,
}

static PARKED: LazyLock<Mutex<HashMap<String, Parked>>> = LazyLock::new(Default::default);
static PARK_GEN: AtomicU64 = AtomicU64::new(1);

/// 같은 열쇠의 옛것은 곧바로 놓는다.
fn park(stream: &str, t: Transport) {
    *lock(&t.slot) = None;
    let generation = PARK_GEN.fetch_add(1, Ordering::Relaxed);
    let old = lock(&PARKED).insert(stream.to_string(), Parked { generation, transport: t });
    let Ok(rt) = tokio::runtime::Handle::try_current() else {
        return;
    };
    if let Some(old) = old {
        rt.spawn(old.transport.release());
    }
    let key = stream.to_string();
    rt.spawn(async move {
        tokio::time::sleep(PARK_TTL).await;
        let gone = {
            let mut m = lock(&PARKED);
            match m.get(&key) {
                Some(p) if p.generation == generation => m.remove(&key),
                _ => None,
            }
        };
        if let Some(p) = gone {
            p.transport.release().await;
        }
    });
}

/// 같은 경유 · 같은 목적지이고 살아 있을 때만.
async fn unpark(stream: &str, alias: &str, host: &str, port: u16) -> Option<Transport> {
    let p = lock(&PARKED).remove(stream)?;
    if p.transport.same(alias, host, port) && !p.transport.dead.load(Ordering::SeqCst) && !p.transport.lease.is_dead() {
        return Some(p.transport);
    }
    p.transport.release().await;
    None
}

pub(crate) fn drop_parked(stream: &str) {
    if let Some(p) = lock(&PARKED).remove(stream) {
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(p.transport.release());
        }
    }
}

pub(crate) fn drop_all_parked() -> usize {
    let all: Vec<Parked> = lock(&PARKED).drain().map(|(_, p)| p).collect();
    let n = all.len();
    for p in all {
        release_on_shutdown(Some(p.transport));
    }
    n
}

async fn open_transport(stream: &str, alias: &str, target: &NetTarget, creds: SharedCreds) -> Result<Transport, OpenError> {
    if let Some(t) = unpark(stream, alias, &target.host, target.port).await {
        return Ok(t);
    }
    let slot: Slot = Arc::default();
    let dead = Arc::new(AtomicBool::new(false));
    let hook: DeathHook = {
        let (slot, dead) = (Arc::clone(&slot), Arc::clone(&dead));
        Box::new(move |_failure| {
            dead.store(true, Ordering::SeqCst);
            let life = lock(&slot).clone();
            if let Some(life) = life {
                life.mark_dead();
            }
        })
    };
    let lease = acquire_shared(alias, target.adhoc.as_ref(), creds, Some(hook)).await.map_err(OpenError::Ssh)?;
    let tunnel = match TunnelListener::open(Arc::clone(lease.handle()), &target.host, target.port).await {
        Ok(t) => t,
        Err(e) => {
            lease.release().await;
            return Err(OpenError::Msg(tr!(
                ko: "DB 로 가는 터널을 세우지 못했습니다: {e}",
                en: "Could not set up the tunnel to the database: {e}"
            )));
        }
    };
    Ok(Transport {
        alias: alias.to_string(),
        host: target.host.clone(),
        port: target.port,
        lease,
        tunnel,
        slot,
        dead,
    })
}

pub(crate) async fn transport_for(stream: &str, target: &NetTarget, creds: SharedCreds) -> Result<Option<Transport>, OpenError> {
    match &target.via {
        Some(alias) => Ok(Some(open_transport(stream, alias, target, creds).await?)),
        None => Ok(None),
    }
}

pub(crate) async fn after_failure(stream: &str, transport: Option<Transport>, msg: &str) {
    if let Some(t) = transport {
        if has_reason(msg, DB_PASSWORD) || has_reason(msg, DB_AUTH) {
            park(stream, t);
        } else {
            t.release().await;
        }
    }
}

/// 런타임 밖이면 터널만 닫는다.
pub(crate) fn release_on_shutdown(t: Option<Transport>) {
    let Some(t) = t else {
        return;
    };
    *lock(&t.slot) = None;
    match tokio::runtime::Handle::try_current() {
        Ok(rt) => {
            rt.spawn(t.release());
        }
        Err(_) => t.tunnel.close(),
    }
}
