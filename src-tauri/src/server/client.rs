//! GUI 안의 서버 클라이언트 — 찾거나 띄워 붙고, 끊기면 다시 붙는다. GUI 프로세스 하나가 연결 **하나**를 쥐고 모든 창이 나눠 쓴다.
//!
//! - **승인 등급 프레임**은 [`request_approve`] 하나가 만든다 — [`request`]·[`request_now`] 는 그 등급을 거부한다.
//! - 서버 신원: 붙자마자 파이프 상대 pid 의 이미지가 믿을 exe(`launch::trusted_server_image`)가 아니면 끊는다.
//! - 판 불일치는 **자동으로 다시 시도하지 않는다** — 서버가 세션을 쥐고 있을 수 있어 사람의 [다시 시작] 을 기다린다.
//!   예외 하나: 세션 op 가 없던 판([`SESSIONLESS_MAX`] 이하)은 쥔 세션이 없으니 조용히 끝내고 새로 띄운다.
//! - 서버 이벤트는 [`RELAYED`] 표의 것만 창에 중계한다. 파이프를 중계하는 CLI 하위 명령은 없다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::WriteHalf;
use tokio::sync::{oneshot, watch, Notify};

use super::ipc::frame::{self, code, Ack};
use super::ipc::{transport, BoxStream, Frame, Grade, Hello, ProtocolRange, Welcome, WireError};
use super::launch;

const BACKOFF_START: Duration = Duration::from_secs(5);
const BACKOFF_MAX: Duration = Duration::from_secs(60);
const DISCOVERY_WAIT: Duration = Duration::from_secs(3);
/// 서버가 죽었으면 곧바로 새로 띄운다 — 타일의 [다시 열기] 가 기다리지 않게.
const LOST_RETRY: Duration = Duration::from_millis(300);
/// 세션 op 가 없던 판의 최대 — 이 판 이하의 서버만 조용히 갈아 띄운다(쥔 세션이 없음이 확실하다).
const SESSIONLESS_MAX: u32 = 1;

/// 부팅 직후 타일이 서버보다 먼저 연다.
pub(crate) const CONNECT_WAIT: Duration = Duration::from_secs(10);

fn request_timeout(op: &str) -> Duration {
    match op {
        "open" => Duration::from_secs(60),
        "write" | "close" | "close_all" | "close_window" | "restore_done" | "close_detached" | "shutdown" => {
            Duration::from_secs(30)
        }
        "attach" | "adopt" | "resize" | "claim_size" | "local_cwd" => Duration::from_secs(15),
        // 원격 워크트리 준비는 사람의 답을 기다린다 — 시한 없음에 가깝게.
        "open_ssh" => Duration::from_secs(3600),
        "headless_open" | "chan_open" | "ssh_copy_id" => Duration::from_secs(90),
        "ctx_batch" | "console_sessions" | "ops_list" | "ops_approve" | "ops_reject" | "ops_modify_targets" => {
            Duration::from_secs(15)
        }
        "forward_add" | "ssh_info" | "headless_close" => Duration::from_secs(30),
        // 보내기는 `side_chat_proxy::send_timeout` 을 따로 준다.
        "side_chat_open" | "side_chat_close" | "side_chat_attach" => Duration::from_secs(30),
        "messenger_bot_set_token" | "messenger_bot_pair" | "messenger_bot_test" | "messenger_bot_notify" => Duration::from_secs(30),
        // 몸의 시한(`timeoutMs`)은 서버가 지킨다 — 여기서는 넉넉한 바깥 상한.
        "ssh_exec" => Duration::from_secs(660),
        "db_open" | "db_test" => Duration::from_secs(60),
        "db_schema" | "db_objects" | "db_table_detail" | "db_definition" | "db_set_write" => Duration::from_millis(crate::db::META_TIMEOUT_MS + 15_000),
        // 서버가 끝내기를 120초까지 기다린다(`table::TX_END_TIMEOUT` — 커밋을 끊지 않는다) + 여유.
        "db_tx" => Duration::from_secs(150),
        // 보통은 [`request_timed`] 가 몸의 `timeoutMs` + 여유를 따로 준다 — 이것은 그 문을 거치지 않았을 때의 바깥 상한.
        "db_query" => Duration::from_millis(crate::db::TIMEOUT_MAX_MS + 30_000),
        // 서버의 전체 시한 + 커밋 대기 + 여유. 몸이 시한을 실어도 늘 이 바깥 상한을 쓴다.
        "db_script" => crate::db::script::SCRIPT_TIMEOUT + Duration::from_secs(180),
        // 마스터 걸기는 Argon2 를 두 번 유도한다.
        "vault_create" | "vault_unlock" | "vault_set_master" | "vault_store" | "vault_status" | "vault_list" => {
            Duration::from_secs(20)
        }
        _ => Duration::from_secs(5),
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Status {
    pub connected: bool,
    pub server_pid: Option<u32>,
    pub protocol: Option<u32>,
    pub app_version: Option<String>,
    /// `breakaway` · `explorer` · `same-job`(GUI 를 닫으면 함께 닫힘).
    pub launch_mode: Option<String>,
    pub uptime_ms: Option<u64>,
    pub clients: Option<u64>,
    pub sessions: Option<u64>,
    pub own_job: Option<bool>,
    pub signal_port: Option<u16>,
    pub mismatch: bool,
    pub last_error: Option<String>,
    /// 토큰은 싣지 않는다.
    pub mcp_port: Option<u16>,
    pub plans_in_progress: Option<u64>,
    pub mirror: super::ai_proxy::MirrorStats,
}

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value, WireError>>>>;

struct Conn {
    writer: tokio::sync::Mutex<WriteHalf<BoxStream>>,
    pending: Pending,
    next_id: AtomicU64,
}

impl Conn {
    async fn request(&self, kind: Grade, op: &str, body: Value) -> Result<Value, WireError> {
        self.request_for(kind, op, body, request_timeout(op)).await
    }

    async fn request_for(&self, kind: Grade, op: &str, body: Value, limit: Duration) -> Result<Value, WireError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);
        let f = Frame::Request {
            id,
            kind,
            op: op.into(),
            body,
        };
        let sent = {
            let mut w = self.writer.lock().await;
            frame::write_frame(&mut *w, &f).await
        };
        if let Err(e) = sent {
            lock(&self.pending).remove(&id);
            return Err(WireError::new("io", e.to_string()));
        }
        match tokio::time::timeout(limit, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(WireError::new("closed", "connection closed")),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(WireError::new("timeout", format!("{op} timed out")))
            }
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 몸은 로그에 남기지 않는다.
fn on_event(_seq: u64, name: &str, body: &Value) {
    let Some(app) = CLIENT.app.get() else {
        return;
    };
    match name {
        "local-exit" => super::proxy::on_local_exit(app, body),
        "ssh-exit" => super::proxy::on_ssh_exit(app, body),
        n if n == super::sessions::VIEWER_ENDED_EVENT => super::proxy::on_viewer_ended(app, body),
        // 창이 하나도 없으면(트레이) GUI Rust 가 알린다 — 창이 있으면 프런트가 한다.
        n if n == crate::operations::EVT_STATE => {
            use tauri::Emitter;
            let _ = app.emit(n, body.clone());
            if crate::remote::home_windows(app).is_empty() {
                crate::tray::on_run_finished(app, body);
                crate::tray::on_review_requested(body);
            }
        }
        // 몸에 대화 본문이 있어 방송하지 않는다 — 통로를 건 창에만.
        n if n == super::side_chat::EVENT => super::side_chat_proxy::on_event(app, body),
        // 같은 까닭으로 방송하지 않는다.
        n if n == super::producer::EVENT => super::producer_proxy::on_event(app, body),
        // 몸에 도구 입력 본문이 있어 방송하지 않는다 — 그 세션을 보는 창 중 통로를 건 창에만.
        n if n == crate::tile_permission::EVENT => super::tile_permission_proxy::on_event(app, body),
        n if RELAYED.contains(&n) => {
            use tauri::Emitter;
            let _ = app.emit(n, body.clone());
        }
        _ => {}
    }
}

/// 이름 그대로 창에 중계하는 것 — 표에 없는 이름은 버린다(서버가 창에 아무 이벤트나 쏘게 두지 않는다).
const RELAYED: &[&str] = &[
    crate::agent_signal::EVENT,
    crate::agent_state::SEEN_EVENT,
    super::side_chat::SEEN_EVENT,
    crate::host_history::CHANGED_EVENT,
    crate::db_history::CHANGED_EVENT,
    crate::remote_worktree::PREP_EVENT,
    crate::agent_hooks::REMOTE_AUTO_EVENT,
    crate::operations::EVT_STATE,
    crate::operations::EVT_PROGRESS,
    super::sessions::DETACHED_CHANGED,
    crate::operations::auto::EVT_AUTO_REFUSED,
    super::sessions::SIZE_OWNER_EVENT,
    crate::db::EVT_STATE,
    crate::orchestration::EVT_CHANGED,
    crate::orchestration::EVT_PROGRESS,
    crate::orchestration::EVT_NOTICE,
    super::serve::EVENTS_LAGGED,
    super::messenger_bridge::EVENT,
];

/// 멈추지 않으면 연결이 끊긴 순간 새 서버를 띄운다.
static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn stop_reconnecting() {
    STOPPING.store(true, Ordering::SeqCst);
}

/// 업데이트 설치기를 못 띄웠을 때 앱이 다시 서버를 띄워 붙는다.
pub(crate) fn resume_reconnecting() {
    STOPPING.store(false, Ordering::SeqCst);
    CLIENT.kick.notify_one();
}

async fn park_while_stopping() {
    while STOPPING.load(Ordering::SeqCst) {
        CLIENT.kick.notified().await;
    }
}

struct Client {
    status: Mutex<Status>,
    conn: Mutex<Option<Arc<Conn>>>,
    up: watch::Sender<bool>,
    kick: Notify,
    app: std::sync::OnceLock<tauri::AppHandle>,
    /// 다시 붙을 때 서버가 바뀌었는지 가른다.
    last_pid: Mutex<Option<u32>>,
}

static CLIENT: LazyLock<Client> = LazyLock::new(|| Client {
    status: Mutex::new(Status::default()),
    conn: Mutex::new(None),
    up: watch::channel(false).0,
    kick: Notify::new(),
    app: std::sync::OnceLock::new(),
    last_pid: Mutex::new(None),
});

fn set_status(f: impl FnOnce(&mut Status)) {
    f(&mut lock(&CLIENT.status));
}

fn set_conn(conn: Option<Arc<Conn>>) {
    let up = conn.is_some();
    *lock(&CLIENT.conn) = conn;
    CLIENT.up.send_replace(up);
}

/// 앱 시작(setup)에서 한 번. 막지 않는다.
pub(crate) fn start(app: tauri::AppHandle) {
    let _ = CLIENT.app.set(app);
    super::ssh_ops::install_remote_exec();
    tauri::async_runtime::spawn(run_loop());
}

enum Fail {
    /// 사람을 기다린다.
    Mismatch(String),
    Other(String),
}

async fn run_loop() {
    let mut backoff = BACKOFF_START;
    loop {
        park_while_stopping().await;
        match connect_once().await {
            Ok((conn, welcome, reader)) => {
                backoff = BACKOFF_START;
                set_conn(Some(conn));
                set_status(|s| {
                    *s = Status {
                        connected: true,
                        server_pid: Some(welcome.server_pid),
                        protocol: Some(welcome.protocol),
                        app_version: Some(welcome.app_version.clone()),
                        launch_mode: Some(welcome.launch_mode.clone()),
                        uptime_ms: None,
                        clients: None,
                        sessions: None,
                        own_job: None,
                        signal_port: welcome.signal_port,
                        mismatch: false,
                        last_error: None,
                        mcp_port: None,
                        plans_in_progress: None,
                        mirror: Default::default(),
                    }
                });
                eprintln!(
                    "[server] connected to session server pid {} ({}) · signal port {:?}",
                    welcome.server_pid, welcome.launch_mode, welcome.signal_port
                );
                // 다시 붙었다 — 창들이 볼트를 다시 본다: 끊긴 사이 서버가 클라이언트 0 으로 잠갔거나, 서버가 바뀌었으면
                // (볼트는 메모리와 함께 사라졌다) 가림막을 세운다.
                let prev = lock(&CLIENT.last_pid).replace(welcome.server_pid);
                if let (Some(prev), Some(app)) = (prev, CLIENT.app.get()) {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "session-server-connected",
                        json!({ "replaced": prev != welcome.server_pid }),
                    );
                }
                // 새 서버일 수 있다 — 서버 자동 승인이 사람이 연 카드를 건드리지 않게 검토 중 집합을 다시 알린다.
                tauri::async_runtime::spawn(super::ai_proxy::push_reviewing());
                let _ = reader.await;
                set_conn(None);
                park_while_stopping().await;
                set_status(|s| {
                    s.connected = false;
                    s.last_error = Some("connection closed".into());
                });
                if let Some(app) = CLIENT.app.get() {
                    super::proxy::on_server_lost(app);
                }
                super::tunnel::on_server_lost();
                tokio::select! {
                    _ = tokio::time::sleep(LOST_RETRY) => {}
                    _ = CLIENT.kick.notified() => {}
                }
                continue;
            }
            Err(Fail::Mismatch(e)) if replace_legacy_server().await => {
                eprintln!("[server] 옛 판 서버(세션 없음)를 끝내고 새로 띄웁니다 — {e}");
                continue;
            }
            Err(Fail::Mismatch(e)) => {
                set_status(|s| {
                    s.connected = false;
                    s.mismatch = true;
                    s.last_error = Some(e);
                });
                // 자동 재시도 없음 — [다시 시작] 만 깨운다.
                CLIENT.kick.notified().await;
                backoff = BACKOFF_START;
                continue;
            }
            Err(Fail::Other(e)) => {
                eprintln!("[server] {e}");
                set_status(|s| {
                    s.connected = false;
                    s.last_error = Some(e);
                });
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = CLIENT.kick.notified() => {}
        }
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

/// 찾기 파일의 서버가 세션 op 가 없는 옛 판(판 최대 ≤ [`SESSIONLESS_MAX`])일 때만 끝낸다. 끝냈으면 `true`.
async fn replace_legacy_server() -> bool {
    let Some(d) = tokio::task::spawn_blocking(launch::live_discovery).await.ok().flatten() else {
        return false;
    };
    if d.protocol.max > SESSIONLESS_MAX {
        return false;
    }
    if shutdown_fresh().await.is_err() {
        return false;
    }
    let pid = d.pid;
    tokio::task::spawn_blocking(move || launch::wait_for_exit(pid, Duration::from_secs(5)))
        .await
        .unwrap_or(false)
}

async fn connect_once() -> Result<(Arc<Conn>, Welcome, tokio::task::JoinHandle<()>), Fail> {
    let ep = transport::endpoint().ok_or_else(|| Fail::Other("session server is not available on this OS".into()))?;
    let live = tokio::task::spawn_blocking(launch::live_discovery).await.ok().flatten();
    match attach(&ep).await {
        Ok(r) => return Ok(r),
        Err(Fail::Mismatch(e)) => return Err(Fail::Mismatch(e)),
        Err(Fail::Other(e)) if live.is_some() => {
            // 살아 있는 서버가 답하지 않는다 — 둘째를 띄우면 선점에서 진다. 다음 회차에 다시.
            return Err(Fail::Other(format!("session server pid {} is not answering: {e}", live.map_or(0, |d| d.pid))));
        }
        Err(Fail::Other(_)) => {}
    }
    let (mode, pid) = tokio::task::spawn_blocking(launch::spawn)
        .await
        .map_err(|e| Fail::Other(e.to_string()))?
        .map_err(Fail::Other)?;
    eprintln!("[server] spawned session server pid {pid} ({})", mode.as_str());
    let _ = tokio::task::spawn_blocking(move || launch::wait_for_discovery(pid, DISCOVERY_WAIT)).await;
    attach(&ep).await
}

async fn attach(ep: &str) -> Result<(Arc<Conn>, Welcome, tokio::task::JoinHandle<()>), Fail> {
    let (conn, reader) = open_conn(ep).await.map_err(Fail::Other)?;
    let hello = Hello {
        protocol: ProtocolRange::OURS,
        app_version: env!("CARGO_PKG_VERSION").into(),
        client: "gui".into(),
        window: None,
    };
    match conn
        .request(Grade::Read, "hello", serde_json::to_value(&hello).unwrap_or(Value::Null))
        .await
    {
        Ok(v) => serde_json::from_value::<Welcome>(v)
            .map(|w| (conn, w, reader))
            .map_err(|e| Fail::Other(format!("bad hello reply: {e}"))),
        Err(e) if e.code == code::PROTOCOL_MISMATCH => {
            reader.abort();
            Err(Fail::Mismatch(format!("protocol mismatch — {}", e.message)))
        }
        Err(e) => {
            reader.abort();
            Err(Fail::Other(format!("hello failed: {} {}", e.code, e.message)))
        }
    }
}

async fn open_conn(ep: &str) -> Result<(Arc<Conn>, tokio::task::JoinHandle<()>), String> {
    let (stream, peer) = transport::connect(ep).await.map_err(|e| format!("connect: {e}"))?;
    let trusted = peer.image.as_deref().is_some_and(launch::trusted_server_image);
    if !trusted {
        eprintln!(
            "[server] refused pipe server pid {:?} exe {:?} — not the app executable",
            peer.pid, peer.image
        );
        return Err(format!("pipe server pid {:?} is not the app executable", peer.pid));
    }
    let (mut rd, wr) = tokio::io::split(stream);
    let conn = Arc::new(Conn {
        writer: tokio::sync::Mutex::new(wr),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(0),
    });
    let c = conn.clone();
    let reader = tokio::spawn(async move {
        while let Ok(Some(f)) = frame::read_frame(&mut rd).await {
            match f {
                Frame::Response { id, ok, body, error } => {
                    if let Some(tx) = lock(&c.pending).remove(&id) {
                        let r = if ok {
                            Ok(body.unwrap_or(Value::Null))
                        } else {
                            Err(error.unwrap_or_else(|| WireError::new("unknown", "")))
                        };
                        let _ = tx.send(r);
                    }
                }
                Frame::Event { seq, name, body } => on_event(seq, &name, &body),
                Frame::Output { header, bytes } => super::proxy::on_output(header, bytes),
                Frame::Channel { chan, bytes } => super::tunnel::on_channel(chan, bytes),
                Frame::ChanAck { chan, consumed } => super::tunnel::on_chan_ack(chan, consumed),
                Frame::Request { .. } | Frame::Ack(_) => {}
            }
        }
        // 남은 요청은 보낸 쪽이 사라져 `closed` 로 끝난다.
        lock(&c.pending).clear();
    });
    Ok((conn, reader))
}

async fn conn_or_wait() -> Option<Arc<Conn>> {
    if let Some(c) = lock(&CLIENT.conn).clone() {
        return Some(c);
    }
    if lock(&CLIENT.status).mismatch {
        return None;
    }
    let mut rx = CLIENT.up.subscribe();
    let _ = tokio::time::timeout(CONNECT_WAIT, rx.wait_for(|up| *up)).await;
    lock(&CLIENT.conn).clone()
}

/// [`request_approve`] 하나만 승인 등급을 싣는다.
fn no_approve(kind: Grade, op: &str) -> Result<(), WireError> {
    if kind == Grade::Approve {
        eprintln!("[server] 승인 등급은 request_approve 로만 보낸다 — {op} 거부");
        return Err(WireError::new(code::APPROVE_REFUSED, "approve frames are sent only by approve_operation"));
    }
    Ok(())
}

/// **읽기·쓰기 등급만**(승인은 [`request_approve`]).
pub(crate) async fn request(kind: Grade, op: &str, body: Value) -> Result<Value, WireError> {
    no_approve(kind, op)?;
    match conn_or_wait().await {
        Some(c) => c.request(kind, op, body).await,
        None => Err(WireError::new("not-connected", "session server is not connected")),
    }
}

pub(crate) async fn request_timed(kind: Grade, op: &str, body: Value, limit: Duration) -> Result<Value, WireError> {
    no_approve(kind, op)?;
    match conn_or_wait().await {
        Some(c) => c.request_for(kind, op, body, limit).await,
        None => Err(WireError::new("not-connected", "session server is not connected")),
    }
}

pub(crate) fn negotiated_protocol() -> Option<u32> {
    let st = lock(&CLIENT.status);
    st.connected.then_some(st.protocol).flatten()
}

/// **승인 등급 프레임을 만드는 유일한 함수** — 부르는 곳은 GUI 의 Tauri 명령 `approve_operation` 하나다(시험
/// `approve_frames_come_from_one_place` 가 소스를 훑어 고정한다). MCP 에서 이 함수로 오는 길은 없다. 서버는 받아도 판정을 다시 한다.
pub(crate) async fn request_approve(op: &'static str, body: Value) -> Result<Value, WireError> {
    match conn_or_wait().await {
        Some(c) => c.request(Grade::Approve, op, body).await,
        None => Err(WireError::new("not-connected", "session server is not connected")),
    }
}

/// 기다리지 않는다 — "연결이 없으면 할 일도 없는" 요청이 쓴다(연결이 끊길 때 서버가 이 GUI 의 임대를 이미 풀었다).
pub(crate) async fn request_now(kind: Grade, op: &str, body: Value) -> Result<Value, WireError> {
    no_approve(kind, op)?;
    let conn = lock(&CLIENT.conn).clone();
    match conn {
        Some(c) => c.request(kind, op, body).await,
        None => Err(WireError::new("not-connected", "session server is not connected")),
    }
}

/// 붙어 있지 않으면 버린다 — 다음 ACK 가 같은 뜻을 싣는다.
pub(crate) async fn send_ack(ack: Ack) {
    let _ = send_frame(&Frame::Ack(ack)).await;
}

pub(crate) async fn send_frame(f: &Frame) -> bool {
    let Some(c) = lock(&CLIENT.conn).clone() else {
        return false;
    };
    let mut w = c.writer.lock().await;
    frame::write_frame(&mut *w, f).await.is_ok()
}

#[tauri::command]
pub async fn session_server_status() -> Result<Status, String> {
    let mut st = lock(&CLIENT.status).clone();
    if st.connected {
        if let Ok(v) = request(Grade::Read, "status", Value::Null).await {
            st.uptime_ms = v.get("uptime_ms").and_then(Value::as_u64);
            st.clients = v.get("clients").and_then(Value::as_u64);
            st.sessions = v.get("sessions").and_then(Value::as_u64);
            st.own_job = v.get("own_job").and_then(Value::as_bool);
            st.signal_port = v
                .get("signal_port")
                .and_then(Value::as_u64)
                .and_then(|p| u16::try_from(p).ok());
            st.mcp_port = v
                .pointer("/ai/mcp_port")
                .and_then(Value::as_u64)
                .and_then(|p| u16::try_from(p).ok());
            st.plans_in_progress = v.pointer("/ai/plans_in_progress").and_then(Value::as_u64);
        }
    }
    st.mirror = super::ai_proxy::mirror_stats();
    Ok(st)
}

/// 서버는 남는다 — 트레이 메뉴의 같은 이름(`tray::end_all_and_exit`)은 서버와 GUI 까지 끝낸다.
#[tauri::command]
pub async fn session_server_close_all() -> Result<u64, String> {
    request(Grade::Write, "close_all", json!({}))
        .await
        .map(|v| v.as_u64().unwrap_or(0))
        .map_err(|e| format!("{} {}", e.code, e.message))
}

/// **서버의 로컬 세션이 모두 닫힌다**(서버 끝 = 세션 끝). 판이 어긋난 서버에도 통한다(`shutdown` 은 판에 무관한 op).
#[tauri::command]
pub async fn session_server_restart() -> Result<Status, String> {
    let old_pid = shutdown_and_wait().await?;
    set_status(|s| {
        s.mismatch = false;
        s.connected = false;
        s.last_error = None;
    });
    CLIENT.kick.notify_one();
    for _ in 0..80 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let st = lock(&CLIENT.status).clone();
        if st.connected && st.server_pid != old_pid {
            return session_server_status().await;
        }
    }
    session_server_status().await
}

/// 다시 띄우지 않는다 — 재연결을 막는 것은 부르는 쪽의 몫이다(업데이트는 [`stop_reconnecting`] 을 먼저 부른다).
/// 업데이트 설치는 판이 다른 옛 서버를 새 GUI 가 스스로 갈지 않으므로 설치 전에 이것으로 끝내 둔다.
pub(crate) async fn shutdown_and_wait() -> Result<Option<u32>, String> {
    let old_pid = lock(&CLIENT.status).server_pid.or_else(|| launch::live_discovery().map(|d| d.pid));
    let sent = match request(Grade::Write, "shutdown", json!({})).await {
        Ok(_) => Ok(()),
        // 붙어 있지 않다(판 불일치 등) — 따로 붙어 hello 없이 보낸다.
        Err(_) => shutdown_fresh().await,
    };
    if let Err(e) = sent {
        if old_pid.is_some() {
            return Err(e);
        }
    }
    if let Some(pid) = old_pid {
        let gone = tokio::task::spawn_blocking(move || launch::wait_for_exit(pid, Duration::from_secs(5)))
            .await
            .unwrap_or(false);
        if !gone {
            return Err(format!("session server pid {pid} did not exit"));
        }
    }
    Ok(old_pid)
}

async fn shutdown_fresh() -> Result<(), String> {
    let ep = transport::endpoint().ok_or("session server is not available on this OS")?;
    let (conn, reader) = open_conn(&ep).await?;
    let r = conn
        .request(Grade::Write, "shutdown", json!({}))
        .await
        .map(|_| ())
        .map_err(|e| format!("shutdown failed: {} {}", e.code, e.message));
    reader.abort();
    r
}
