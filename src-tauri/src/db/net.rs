//! **네트워크 DB 엔진의 공용 자리**(PG · MySQL/MariaDB — 쿼리 타일 7·8단계) — 붙을 곳(`NetTarget`) · 열기 실패 꼴 · 비밀 재료 ·
//! SSH 경유 전송로(공유 SSH 전송로 자리 + 앱 안쪽 터널) · 비밀번호를 묻는 동안 전송로 세워 두기 · 연결의 생사(`Life`).
//! 엔진(`pg` · `mysql`)은 드라이버만 다르고 이 규칙들은 같다 — 7단계 `pg.rs` 에서 그대로 옮겼다(동작 불변).
//!
//! - **SSH 경유**: 그 호스트의 공유 SSH 전송로를 **빌리고**([`acquire_shared`] — 터미널 타일과 같은 관문·같은
//!   [`SshOpenError`]) 그 위에 [`TunnelListener`](`127.0.0.1:<임시>` → `direct-tcpip(프리셋 host, port)`)를 세운다. 엔진은
//!   그 임시 주소로 붙는다(이름은 프리셋 host 그대로 — TLS 의 SNI·이름 검증은 그 이름으로 선다, `tls`).
//! - 비밀번호를 묻는 사이 전송로를 놓으면 다시 열 때 SSH 관문을 또 지나야 한다 — 그래서 `[db-password]`·`[db-auth]` 로 끝난
//!   열기는 전송로·터널을 그 타일 열쇠에 **잠깐([`PARK_TTL`]) 세워 둔다**([`after_failure`]). 같은 타일·같은 참조로 다시 열면 그것을 쓴다.
//! - 전송로 사망([`DeathHook`]) → 그 전송로에 앉은 엔진의 [`Life`] 를 죽은 것으로 → 서버 이벤트 [`EVT_STATE`] 한 번.

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

/// 접속(TCP + 인증) 시한.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 비밀번호를 묻는 동안 전송로·터널을 세워 두는 시간.
const PARK_TTL: Duration = Duration::from_secs(60);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 붙을 곳 — 서버가 파일(`db-connections.json`)에서 해석한 값이다(GUI 가 보낸 주소가 아니다).
#[derive(Debug, Clone)]
pub(crate) struct NetTarget {
    /// 프리셋 id — 볼트 열쇠.
    pub id: String,
    /// DB 주소(SSH 경유면 **경유 호스트에서 본** 주소).
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub user: Option<String>,
    pub tls: DbTlsMode,
    /// 사용자가 준 CA 파일(전체 경로) — 검증 모드에서만 서버가 접속 순간 읽는다(`tls::read_ca`).
    pub tls_ca: Option<String>,
    /// 경유 호스트 별칭(`None` = 경유 없음).
    pub via: Option<String>,
    /// 경유가 `~/.ssh/config` 밖의 그 자리 대상(빠른 접속 꼴)일 때 — **제품 경로는 늘 `None`**(연결의 경유는 별칭뿐이다).
    /// 통합 시험이 사용자 설정 파일을 건드리지 않고 임시 sshd 를 거치려고 쓴다.
    pub adhoc: Option<crate::ssh::AdhocTarget>,
}

/// 열기 실패 — 사람 문구 또는 SSH 관문(터미널 SSH 열기와 같은 JSON 꼴로 프런트까지 간다).
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

/// `db_open` 몸의 비밀 재료 — **`Debug` 없음**. `password` 는 DB 비밀번호, `ssh` 는 경유 SSH 관문의 답.
#[derive(Default)]
pub(crate) struct OpenSecrets {
    pub password: Option<Zeroizing<String>>,
    pub ssh: SharedCreds,
}

/// 쓸 비밀번호 — 몸의 값(이번 한 번) → 없으면 볼트(`db_password_for(id)`). `bool` = 볼트에서 왔다(거절되면 `[db-stored-rejected]`).
pub(crate) fn password_for(body: Option<Zeroizing<String>>, id: &str) -> (Option<Zeroizing<String>>, bool) {
    match body {
        Some(p) => (Some(p), false),
        None => {
            let v = crate::server::hub::vault().and_then(|v| v.db_password_for(id));
            let some = v.is_some();
            (v, some)
        }
    }
}

/// OS 사용자 이름 — 사용자 칸이 비었을 때의 기본(libpq 와 같은 규칙).
pub(crate) fn os_user(fallback: &str) -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| fallback.into())
}

// ---------------------------------------------------------------------------
// 연결의 생사
// ---------------------------------------------------------------------------

/// 연결의 생사 — 전송로 훅 · 드라이버(연결 태스크 · 실패한 호출)가 함께 본다.
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

    /// 우리가 닫는다 — 그 뒤의 죽음은 알리지 않는다.
    pub(crate) fn set_closing(&self) {
        self.closing.store(true, Ordering::SeqCst);
    }

    /// 죽었다 — 우리가 닫는 중이 아니면 한 번만 서버 이벤트를 쏜다.
    pub(crate) fn mark_dead(&self) {
        if self.closing.load(Ordering::SeqCst) {
            return;
        }
        // AI 전용 연결(`db::ai`)은 타일이 아니다 — 화면에 알릴 것이 없다(다음 도구 호출이 죽은 연결을 보고 새로 연다).
        if !self.dead.swap(true, Ordering::SeqCst) && !self.stream.starts_with(super::ai::STREAM_PREFIX) {
            crate::server::hub::emit(EVT_STATE, json!({ "stream": self.stream, "state": "disconnected" }));
        }
    }
}

/// `[db-disconnected]` 문구.
pub(crate) fn disconnected() -> String {
    with_reason(
        DB_DISCONNECTED,
        tr!(
            ko: "DB 연결이 끊겼습니다 — [다시 연결] 로 다시 붙으세요",
            en: "The database connection was lost — reconnect to continue"
        ),
    )
}

// ---------------------------------------------------------------------------
// 전송로(SSH 경유) — 빌린 자리 + 터널 · 비밀번호를 묻는 동안 세워 두기
// ---------------------------------------------------------------------------

/// 전송로 사망을 받을 자리 — 세워 둔(park) 동안은 비고, 엔진이 쓰면 그 엔진의 [`Life`] 가 앉는다.
type Slot = Arc<Mutex<Option<Arc<Life>>>>;

pub(crate) struct Transport {
    alias: String,
    host: String,
    port: u16,
    lease: SharedLease,
    tunnel: TunnelListener,
    slot: Slot,
    /// 전송로가 이미 죽었다(세워 둔 동안 포함).
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

    /// 엔진이 붙을 주소 — `127.0.0.1:<임시>`.
    pub(crate) fn local_addr(&self) -> std::net::SocketAddr {
        self.tunnel.local_addr()
    }

    /// 엔진의 생사를 이 전송로에 앉힌다 — 이미 죽었으면 곧바로 죽음 표시.
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

/// 비밀번호를 묻는 동안 세워 둔다 — [`PARK_TTL`] 뒤에 아무도 안 가져갔으면 놓는다(같은 열쇠의 옛것은 곧바로 놓는다).
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

/// 세워 둔 것을 가져간다 — 같은 경유·같은 목적지이고 살아 있을 때만(아니면 놓는다).
async fn unpark(stream: &str, alias: &str, host: &str, port: u16) -> Option<Transport> {
    let p = lock(&PARKED).remove(stream)?;
    if p.transport.same(alias, host, port) && !p.transport.dead.load(Ordering::SeqCst) && !p.transport.lease.is_dead() {
        return Some(p.transport);
    }
    p.transport.release().await;
    None
}

/// 세워 둔 것이 있으면 놓는다(타일이 다른 연결로 바뀌었거나 닫혔다).
pub(crate) fn drop_parked(stream: &str) {
    if let Some(p) = lock(&PARKED).remove(stream) {
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(p.transport.release());
        }
    }
}

/// 세워 둔 것을 모두 놓는다 — 트레이 [모든 세션 종료] · 서버 끝(`table::close_all`). 놓은 수.
pub(crate) fn drop_all_parked() -> usize {
    let all: Vec<Parked> = lock(&PARKED).drain().map(|(_, p)| p).collect();
    let n = all.len();
    for p in all {
        release_on_shutdown(Some(p.transport));
    }
    n
}

/// 전송로를 빌리고 터널을 세운다(또는 세워 둔 것을 쓴다).
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

/// 경유가 있으면 전송로를 연다(없으면 `None` — 프리셋 주소로 바로 붙는다).
pub(crate) async fn transport_for(stream: &str, target: &NetTarget, creds: SharedCreds) -> Result<Option<Transport>, OpenError> {
    match &target.via {
        Some(alias) => Ok(Some(open_transport(stream, alias, target, creds).await?)),
        None => Ok(None),
    }
}

/// DB 접속이 실패한 뒤 — 비밀번호 갈래(`[db-password]`·`[db-auth]`)면 전송로를 세워 두고, 아니면 놓는다.
pub(crate) async fn after_failure(stream: &str, transport: Option<Transport>, msg: &str) {
    if let Some(t) = transport {
        if has_reason(msg, DB_PASSWORD) || has_reason(msg, DB_AUTH) {
            park(stream, t);
        } else {
            t.release().await;
        }
    }
}

/// 닫을 때 — 자리를 비우고 터널·전송로 자리를 놓는다(런타임 밖이면 터널만 닫는다).
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
