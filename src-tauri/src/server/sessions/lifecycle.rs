//! 세션 수명 — 사건 → 이벤트([`Broadcaster`] · 떨어진 목록 이벤트) · 연결 개폐(`conn_opened` · `conn_gone` — **연결 해제는 세션 종료가
//! 아니다**: 임대만 풀고 세션은 `Detached` 로 산다) · 서버 끝 · 자원 닫기 · 떨어진 세션 목록. `server/sessions.rs` 에서 그대로 옮겼다.

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

/// 떨어진 세션 목록이 바뀌었을 수 있다(③-4) — 몸 없는 이벤트. GUI 가 같은 이름의 Tauri 이벤트로 창에 중계한다.
pub(crate) const DETACHED_CHANGED: &str = "sessions-detached-changed";

/// [`DETACHED_CHANGED`] 를 모든 연결에 낸다(받는 연결이 없으면 버린다).
pub(crate) fn detached_changed() {
    super::hub::emit(DETACHED_CHANGED, Value::Null);
}

/// pty 의 사건 — `local-exit` 는 모든 연결의 이벤트로(GUI 가 창에 그대로 방송), 자원 회수는 **서버 안에서** 그 타일의 신호
/// 전용 토큰을 거두고(③-3a) `agent-mcp` 실행 설정 파일 주장을 놓는다(③-3c). 붙은 창 없이 끝났으면 거울도 서버가 거둔다.
pub(crate) struct Broadcaster(pub broadcast::Sender<(String, Value)>);

/// 서버가 끝나는 중(`serve::finish`) — 이 뒤로 끝나는 로컬 세션은 서버가 닫은 것이다(사람이 고른 [다시 시작]·고아 자진 종료).
static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 서버 끝을 표시한다 — 세션을 닫기 **전에** 부른다.
pub(crate) fn mark_stopping() {
    STOPPING.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// 서버가 끝나며 닫은 세션의 종료 사유는 **`server-stopped`** 다 — 셸을 pid 트리째 끝내 종료 코드가 1 이 되는데, 그대로 보내면
/// 타일이 "세션이 종료되었습니다 — 종료 코드 1" 로 셸이 실패한 것처럼 보인다(실측 10-10 `survival server-shutdown`). 서버 kill 은
/// GUI 가 파이프 EOF 에서 같은 코드를 만든다(`server::proxy::on_server_lost`) — 정상 종료도 같은 안내("세션 서버가 멈췄습니다")로.
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
        // 붙은 창 없이 끝나 표에서 지웠다 — 거울을 지울 손(`Terminal` 의 `dropSession`)이 없으니 서버가 거둔다(③-3c).
        if let Some(stream) = ev.stream.as_deref().filter(|_| ev.removed) {
            super::ai::on_session_removed(stream);
        }
        let removed = ev.removed;
        // 세션이 끝나 시청자가 떨어졌을 수 있다(떨어진 채 끝나 표에서 빠짐 — `session-viewer-ended{reason:"ended"}`).
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
            // 타일 MCP 토큰(3차 4단계 — 같은 주인 번호 · 같은 수명): 세션 회수면 거둔다(그 회차의 토큰은 이 뒤로 401 · 요청 기록도 함께 간다).
            if crate::tile_token::revoke(&stream, owner) {
                log::line(format!("tile MCP token revoked — local {id} · stream {stream}"));
            }
            // 권한 결정 토큰(2026-11-01 — 같은 주인 번호 · 같은 수명) — 그 스트림의 카드 · 세션 허용 기억도 함께 버린다.
            if crate::server::tile_permission::revoke(&stream, owner) {
                log::line(format!("permission token revoked — local {id} · stream {stream}"));
            }
            // 그 타일(AI 타일)이 주장한 `agent-mcp` 실행 설정 파일을 놓는다 — 아무도 안 쥐면 지운다(③-3c · 설계 4.4).
            super::ai::on_session_released(&stream);
        }
    }
}

// ---------------------------------------------------------------------------
// 수명 — 연결 끊김 · 서버 끝
// ---------------------------------------------------------------------------

/// 싱크를 꽂지 못했다 — 열기·붙기가 끝나기 전에 연결이 끊겼다(세션은 떨어진 세션 목록으로 간다). 답은 아무도 읽지 않는다.
pub(super) fn plugged_too_late(what: &str, stream: &str, conn: u64) -> WireError {
    detached_changed();
    log::line(format!("{what} {stream} finished after conn {conn} was gone — left detached"));
    serr("client connection is gone".into())
}

/// 클라이언트 연결이 섰다 — `serve_conn` 첫머리. 이 뒤로 이 연결에 임대를 적을 수 있다([`conn_gone`] 까지).
pub(crate) fn conn_opened(conn: u64) {
    core().conn_opened(conn);
    crate::db::table::conn_opened(conn);
    super::side_chat::conn_opened(conn);
}

/// **연결이 끊겼다** — 그 연결이 쥔 임대를 모두 푼다(세션은 산다). GUI 정상 종료·kill 이 같은 길이다(로컬·SSH 모두). 쿼리 타일의
/// DB 연결도 떨어진 세션으로 남는다(TTL 없음 — `db::table` 머리말 · 2026-11-09 ②).
pub(crate) fn conn_gone(conn: u64) {
    let dbs = crate::db::table::conn_gone(conn);
    if dbs > 0 {
        detached_changed();
        log::line(format!("client conn {conn} gone — {dbs} db connection(s) kept as detached"));
    }
    // 사이드 채팅도 떼어 둔다(TTL — `server::side_chat` 머리말).
    let chats = super::side_chat::conn_gone(conn);
    if chats > 0 {
        log::line(format!("client conn {conn} gone — {chats} side chat(s) detached"));
    }
    // 프로듀서 채팅 — 그 연결의 구독을 지운다(묶이기 전이면 TTL 이 시작된다).
    super::producer::conn_gone(conn);
    let detached = core().detach_conn(conn);
    for (kind, id, _) in &detached {
        unplug(*kind, *id);
    }
    // 그 연결의 시청자 싱크·크레딧(노트) · 주가 풀린 세션의 크기 주인.
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

/// 살아 있는 세션 수(붙었거나 떨어진) — 고아 자진 종료 조건(떨어진 쿼리 타일의 DB 연결은 `serve::Busy` 가 따로 더한다).
pub(crate) fn live_count() -> usize {
    core().live_count()
}

/// 표의 로컬 세션을 전부 닫는다 — **블로킹**(서버 끝 · `close_all`). 닫은 수.
pub(crate) fn close_everything_blocking() -> usize {
    let ids = pty::all_ids();
    for id in &ids {
        retire_credit(*id);
        pty::close_by_id_blocking(*id);
    }
    ids.len()
}

/// 표의 SSH 세션(대화형·헤드리스)을 전부 닫는다 — 서버 끝 · `close_all`. 포워드 리스너·SFTP·신호 토큰·원격 신호 파일·
/// 셸 채널·전송로를 차례로 거둔다(`ssh::release_ssh`). 닫은 수.
pub(crate) async fn close_all_ssh() -> usize {
    let ids = crate::ssh::all_ids();
    for id in &ids {
        retire_credit_of(Kind::Ssh, *id);
        crate::ssh::close_ssh_by_id(*id).await;
    }
    ids.len()
}

/// 세션 하나의 자원을 닫는다(코어에서는 부른 쪽이 이미 뺐다) — 로컬은 ConPTY 자식, SSH 는 `release_ssh`(포워드·SFTP·신호
/// 토큰·원격 신호 파일·셸 채널·전송로 자리).
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

/// 떨어진 세션 한 줄의 바깥 모양(③-4 — op `sessions_detached`). GUI 가 창 목록으로 거른 뒤 프런트에 그대로 넘긴다.
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
    /// SSH 호스트 별칭.
    pub alias: Option<String>,
    /// SSH tmux 세션 이름.
    pub tmux: Option<String>,
    pub ai_read: bool,
    /// 책임 창이 복원을 마치며 데려가지 않았다.
    pub unclaimed: bool,
    /// 쿼리 타일(`kind: "db"` — ②)의 연결 id(`db-connections.json`). 화면이 이름 · AI 권한을 제 사본에서 푼다. 판 28 이하 서버는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conn: Option<String>,
    /// 쿼리 타일의 쓰기 모드.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writable: Option<bool>,
    /// 쿼리 타일에 열린 트랜잭션 작업이 있다(떨어진 지 10분이면 되돌린다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_tx: Option<bool>,
}

/// 코어의 떨어진 세션에 자원 쪽 메타(셸·별칭·tmux·마지막 출력)를 붙인다 — 코어 잠금을 먼저 풀고 자원 표를 본다(잠금 순서). 떨어진
/// 세션으로 남은 쿼리 타일의 DB 연결(`kind: "db"` — ②)을 뒤에 잇는다(순서는 GUI · 화면이 떨어진 시각으로 다시 굳힌다).
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
