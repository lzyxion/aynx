//! 세션 수명 — 사건 → 이벤트 · 연결 개폐 · 서버 끝 · 자원 닫기 · 떨어진 세션 목록. **연결 해제는 세션 종료가 아니다**(임대만 푼다).

use serde::Deserialize;
use serde_json::Value;
use tokio::sync::broadcast;

use super::io::{retire_credit, retire_credit_of, settle, unplug};
use super::types::{blocking, serr};
use crate::server::ipc::WireError;
use crate::server::log;
use crate::pty::{self, LocalEvents, LocalExit};
use crate::session_core::{core, Kind};

// ---------------------------------------------------------------------------
// 사건 → 이벤트 프레임
// ---------------------------------------------------------------------------

/// 몸 없는 이벤트 — GUI 가 같은 이름의 Tauri 이벤트로 창에 중계한다.
pub(crate) const DETACHED_CHANGED: &str = "sessions-detached-changed";

pub(crate) fn detached_changed() {
    super::hub::emit(DETACHED_CHANGED, Value::Null);
}

pub(crate) struct Broadcaster(pub broadcast::Sender<(String, Value)>);

static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 세션을 닫기 **전에** 부른다.
pub(crate) fn mark_stopping() {
    STOPPING.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// 서버가 끝나며 닫은 셸은 pid 트리째 끝나 종료 코드 1 이 된다 — 그대로 보내면 셸이 실패한 것처럼 보인다. 서버 kill 때
/// GUI 가 파이프 EOF 에서 만드는 코드(`server::proxy::on_server_lost`)와 같은 `server-stopped` 로 바꾼다.
pub(super) fn exit_for_stop(mut ev: LocalExit, stopping: bool) -> LocalExit {
    if stopping {
        ev.code = "server-stopped".into();
        ev.exit_code = None;
        ev.detail = None;
    }
    ev
}

impl LocalEvents for Broadcaster {
    fn exited(&self, ev: LocalExit) {
        let ev = exit_for_stop(ev, STOPPING.load(std::sync::atomic::Ordering::SeqCst));
        retire_credit(ev.id);
        // 붙은 창 없이 끝났으면 거울을 지울 손(`Terminal` 의 `dropSession`)이 없으니 서버가 거둔다.
        if let Some(stream) = ev.stream.as_deref().filter(|_| ev.removed) {
            super::ai::on_session_removed(stream);
        }
        let removed = ev.removed;
        settle();
        let _ = self
            .0
            .send(("local-exit".into(), serde_json::to_value(&ev).unwrap_or(Value::Null)));
        if removed {
            let _ = self.0.send((DETACHED_CHANGED.into(), Value::Null));
        }
    }

    fn released(&self, id: u32, signal: Option<(String, u64)>) {
        if let Some((stream, owner)) = signal {
            if crate::agent_signal::revoke(&stream, owner).is_some() {
                log::line(format!("signal token revoked — local {id} · stream {stream}"));
            }
            if crate::tile_token::revoke(&stream, owner) {
                log::line(format!("tile MCP token revoked — local {id} · stream {stream}"));
            }
            if crate::server::tile_permission::revoke(&stream, owner) {
                log::line(format!("permission token revoked — local {id} · stream {stream}"));
            }
            super::ai::on_session_released(&stream);
        }
    }
}

// ---------------------------------------------------------------------------
// 수명 — 연결 끊김 · 서버 끝
// ---------------------------------------------------------------------------

/// 열기·붙기가 끝나기 전에 연결이 끊겼다 — 세션은 떨어진 세션 목록으로 간다.
pub(super) fn plugged_too_late(what: &str, stream: &str, conn: u64) -> WireError {
    detached_changed();
    log::line(format!("{what} {stream} finished after conn {conn} was gone — left detached"));
    serr("client connection is gone".into())
}

pub(crate) fn conn_opened(conn: u64) {
    core().conn_opened(conn);
    crate::db::table::conn_opened(conn);
    super::side_chat::conn_opened(conn);
}

/// 그 연결이 쥔 임대를 모두 푼다 — 세션은 산다(GUI 정상 종료·kill 이 같은 길).
pub(crate) fn conn_gone(conn: u64) {
    let dbs = crate::db::table::conn_gone(conn);
    if dbs > 0 {
        detached_changed();
        log::line(format!("client conn {conn} gone — {dbs} db connection(s) kept as detached"));
    }
    let chats = super::side_chat::conn_gone(conn);
    if chats > 0 {
        log::line(format!("client conn {conn} gone — {chats} side chat(s) detached"));
    }
    super::producer::conn_gone(conn);
    let detached = core().detach_conn(conn);
    for (kind, id, _) in &detached {
        unplug(*kind, *id);
    }
    settle();
    if !detached.is_empty() {
        detached_changed();
        let names: Vec<String> = detached
            .iter()
            .map(|(k, id, s)| format!("{} {id} ({s})", k.as_str()))
            .collect();
        log::line(format!(
            "client conn {conn} gone — {} session(s) detached, still alive: {names:?}",
            detached.len()
        ));
    }
}

/// 떨어진 쿼리 타일의 DB 연결은 들지 않는다(`serve::Busy` 가 따로 더한다).
pub(crate) fn live_count() -> usize {
    core().live_count()
}

/// **블로킹**.
pub(crate) fn close_everything_blocking() -> usize {
    let ids = pty::all_ids();
    for id in &ids {
        retire_credit(*id);
        pty::close_by_id_blocking(*id);
    }
    ids.len()
}

pub(crate) async fn close_all_ssh() -> usize {
    let ids = crate::ssh::all_ids();
    for id in &ids {
        retire_credit_of(Kind::Ssh, *id);
        crate::ssh::close_ssh_by_id(*id).await;
    }
    ids.len()
}

/// 코어에서는 부른 쪽이 이미 뺐다.
pub(super) async fn close_resource(kind: Kind, id: u32) -> Result<(), WireError> {
    retire_credit_of(kind, id);
    match kind {
        Kind::Local => {
            if let Some(session) = pty::take(id) {
                blocking(move || pty::release_now(id, session)).await?;
            }
        }
        Kind::Ssh => crate::ssh::release_ssh(crate::ssh::table(), id).await,
    }
    Ok(())
}

pub(super) async fn close_ids(ids: Vec<u32>) -> Result<usize, WireError> {
    let n = ids.len();
    blocking(move || {
        for id in ids {
            retire_credit(id);
            pty::close_by_id_blocking(id);
        }
    })
    .await?;
    Ok(n)
}

/// GUI 가 창 목록으로 거른 뒤 프런트에 그대로 넘긴다.
#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetachedSession {
    pub stream: String,
    pub kind: String,
    /// 마지막으로 붙어 있던 창의 라벨(책임 창).
    pub home: String,
    pub opened_at: u64,
    pub detached_at: Option<u64>,
    pub last_output_at: Option<u64>,
    /// 로컬 셸 id(`ShellInfo.id`).
    pub shell: Option<String>,
    pub alias: Option<String>,
    pub tmux: Option<String>,
    pub ai_read: bool,
    /// 책임 창이 복원을 마치며 데려가지 않았다.
    pub unclaimed: bool,
    /// 쿼리 타일(`kind: "db"`)의 연결 id. 판 28 이하 서버는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_tx: Option<bool>,
}

/// 코어 잠금을 먼저 풀고 자원 표를 본다(잠금 순서).
pub(crate) fn detached_rows() -> Vec<DetachedSession> {
    let rows = core().detached();
    let dbs = crate::db::table::detached_rows().into_iter().map(|d| DetachedSession {
        stream: d.stream,
        kind: "db".into(),
        home: d.home,
        opened_at: d.opened_at_ms,
        detached_at: Some(d.detached_at_ms),
        last_output_at: None,
        shell: None,
        alias: None,
        tmux: None,
        ai_read: false,
        unclaimed: d.unclaimed,
        conn: Some(d.conn),
        writable: Some(d.writable),
        in_tx: Some(d.in_tx),
    });
    rows.into_iter()
        .map(|r| {
            let (shell, alias, tmux, last) = match r.kind {
                Kind::Local => {
                    let (shell, last) = pty::detached_meta_of(r.id).unwrap_or((None, None));
                    (shell, None, None, last)
                }
                Kind::Ssh => match crate::ssh::detached_meta_of(r.id) {
                    Some((alias, tmux, last)) => (None, Some(alias), tmux, last),
                    None => (None, None, None, None),
                },
            };
            DetachedSession {
                stream: r.stream,
                kind: r.kind.as_str().into(),
                home: r.home,
                opened_at: r.opened_at_ms,
                detached_at: r.detached_at_ms,
                last_output_at: last,
                shell,
                alias,
                tmux,
                ai_read: r.ai_read,
                unclaimed: r.unclaimed,
                conn: None,
                writable: None,
                in_tx: None,
            }
        })
        .chain(dbs)
        .collect()
}
