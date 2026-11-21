//! SSH 세션 표 · 연결 공유 풀 · 셸 채널 조작 · 종료 마감. 이 표는 세션 서버 프로세스에만 산다 — GUI 가 원격에 닿는 길은 서버 op(`ssh_exec` · 채널 터널)뿐이다.
//!
//! 불변식:
//! - 표의 잠금은 `await` 전에 반드시 푼다(조각 함수로 나눈 이유).
//! - **이 표는 자원만 쥔다** — 대화형 타일의 표 · 임대 · 종료 장부는 [`crate::session_core`] 다. 쓰기 · 크기 · 닫기는 부른 쪽이 임대를 먼저 묻는다.
//!   헤드리스 위임 세션은 코어에 오르지 않는다(창이 없다).
//! - **종료는 Rust 가 마감한다**([`finish_exit`]).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use russh::client::{Handle, Msg};
use russh::{ChannelWriteHalf, Disconnect};

use crate::output::{Chunk, Gate, OutputSlot, OutputStats};
use crate::session_core::{core, End, Kind};
use crate::ssh_pool::{ExitToken, TransportPool, TransportSignal};

use super::*;

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/// `Arc` 를 복제해 들고 있어도 세션 수명이 늘지 않는다 — 표에서 지워지고 `disconnect` 가 불리면 그 위의 채널도 함께 죽는다.
pub(crate) type SessionHandle = Arc<Handle<SshHandler>>;

/// 대화형 셸 채널에 딸린 조각들 — **헤드리스 세션에는 없다**(`None`).
pub(crate) struct ShellPipe {
    pub(super) writer: Arc<ChannelWriteHalf<Msg>>,
    pub(super) gate: Arc<Gate>,
    /// 탭을 다른 창으로 옮기면 여기만 갈아 끼운다.
    pub(super) output: OutputSlot,
    pub(super) stats: Arc<OutputStats>,
    /// 이 앱이 셸 채널을 닫았다는 종 — 러시가 서버의 닫힘 답을 읽기 쪽에 넘기지 않아 펌프가 이것을 듣는다([`super::open::until_closed`]).
    pub(super) closed: Arc<tokio::sync::Notify>,
    /// 펌프가 끝을 정돈된 종료(`exit`)로 적어 살아 있는 타일이 자동 재접속을 돌지 않게 한다.
    pub(super) closing: Arc<std::sync::atomic::AtomicBool>,
    /// 종료 마감이 마지막 배치를 배처 뒤로 정렬해 최종 오프셋을 받는 입구.
    pub(super) mark: std::sync::Mutex<std::sync::mpsc::Sender<Chunk>>,
}

pub struct SshSession {
    pub(crate) handle: SessionHandle,
    /// **대상 세션의 전송로가 이 핸들의 direct-tcpip 채널 위에 얹혀 있으므로 반드시 함께 살려 둬야 한다.**
    pub(crate) jump: Option<Arc<Handle<SshHandler>>>,
    pub(crate) shell: Option<ShellPipe>,
    /// 서버가 여는 채널은 세션이 아니라 전송로에 도착한다 — 원격 포워드(-R) 길잡이 표의 열쇠([`transport_of`]).
    pub(crate) transport_id: u64,
    /// `None` 이면 풀 밖의 세션(헤드리스 위임)이라 닫을 때 자기 전송로를 그냥 끊는다.
    pub(crate) shared: Option<SharedPin>,
    /// 이미 서 있던 전송로에 얹혔다 — `info` 의 인증 한 벌은 그 전송로를 세운 세션의 것이다.
    pub(crate) joined: bool,
    /// 헤드리스 위임 세션은 언제나 `false` 다.
    pub(crate) agent_forward: bool,
    /// 신호 전용 토큰의 열쇠(스트림 · 주인 번호) — 닫을 때 거둔다. 토큰 값은 여기 남기지 않는다.
    pub(crate) signal: Option<(String, u64)>,
    pub(crate) alias: String,
    /// tmux 이름 장부 — 세션은 앱 전역이라 다른 창에서 같은 호스트에 연 타일도 이 이름을 보고 피한다([`pick_tmux_name`]).
    pub(crate) tmux: Option<String>,
    pub(crate) log_path: Option<String>,
    /// 접속하는 순간 이미 알던 값 — 세션이 사는 동안 바뀌지 않는다(RTT 는 물을 때마다 잰다).
    pub(crate) info: ConnectedAs,
}

/// 여기에 **비밀번호는 없다** — `identity` 는 키에 붙은 설명 한 줄이다(`ssh-add -l` 의 그 글자).
pub(crate) struct ConnectedAs {
    pub(crate) server_version: Option<String>,
    pub(crate) method: AuthMethod,
    pub(crate) identity: Option<String>,
    /// 그 키 파일을 볼트의 암호구로 열었는가.
    pub(crate) identity_stored: bool,
    pub(crate) jump: Option<String>,
    pub(crate) connected_at_ms: u64,
    pub(crate) keepalive_secs: Option<u64>,
}

/// 표시 전용 — 시계가 1970 이전이면 0.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct SshSessions(pub Mutex<HashMap<u32, SshSession>>);

/// **세션 서버에서만 채워진다.**
static SSH: LazyLock<SshSessions> = LazyLock::new(SshSessions::default);

pub(crate) fn table() -> &'static SshSessions {
    &SSH
}

// ---------------------------------------------------------------------------
// 연결 공유
// ---------------------------------------------------------------------------

/// 풀에서 꺼낼 때 잠금을 문장 하나 안에서 끝내려면 참조가 아니라 값이 나와야 해서 `Clone` 이다.
#[derive(Clone)]
pub(crate) struct SharedTransport {
    pub(super) handle: SessionHandle,
    pub(super) transport_id: u64,
    pub(super) jump: Option<Arc<Handle<SshHandler>>>,
    pub(super) signal: Arc<TransportSignal>,
    /// 이 전송로를 실제로 인증한 한 벌 — 나중에 얹힌 세션도 이 값을 그대로 보고한다.
    pub(super) server_version: Option<String>,
    pub(super) method: AuthMethod,
    pub(super) identity: Option<String>,
    pub(super) identity_stored: bool,
    pub(super) jump_label: Option<String>,
    pub(super) keepalive_secs: Option<u64>,
}

#[derive(Clone)]
pub(crate) struct SharedPin {
    pub(super) key: String,
    pub(super) signal: Arc<TransportSignal>,
    pub(super) token: ExitToken,
}

/// **앱 전역**이다 — 전송로는 창의 것이 아니라 앱의 것이다(탭은 창 사이를 건너다닌다).
pub(crate) static TRANSPORTS: LazyLock<TransportPool<SharedTransport>> =
    LazyLock::new(TransportPool::new);

/// 같은 서버를 가리키는 별칭 둘을 합치지 **않는다** — config 에는 우리가 읽지 않는 줄(`SetEnv` · `RemoteCommand` …)이 있어 합친 연결이
/// 사용자가 적은 것과 다르게 동작할 수 있다(애매하면 나눈다). 해석된 결과도 함께 굽는다 — 앱이 도는 중에 config 를 고치면 같은 별칭이 다른 서버를 가리킨다.
/// 구분자 `\x1f` — 사용자가 적을 수 있는 글자로 이으면 다른 조합이 같은 문자열이 될 수 있다.
pub(crate) fn transport_key(params: &ConnectParams, alias: &str, adhoc: bool) -> String {
    const SEP: char = '\x1f';
    // config 매칭(`resolve_params`)과 같은 규칙으로 대소문자를 무시한다.
    let name = if adhoc {
        String::new()
    } else {
        alias.to_ascii_lowercase()
    };
    let jump = params
        .jump
        .as_ref()
        .map(|j| format!("{}@{}:{}", j.user, j.host, j.port))
        .unwrap_or_default();
    format!(
        "{name}{SEP}{}@{}:{}{SEP}{jump}{SEP}{}{SEP}{}",
        params.user,
        params.host,
        params.port,
        params.identities_only,
        params.identity_file.as_deref().unwrap_or("")
    )
}

pub(crate) static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// 서버가 다시 떠도 GUI 가 쥔 옛 id(타일 · SFTP 캐시 · 포워드 목록)와 겹치지 않게 시각에서 뽑은 바탕이다(로컬 `pty::seed_ids` 와 같은 규칙).
pub(crate) fn seed_ids(base: u32) {
    NEXT_ID.store(base.max(1), Ordering::Relaxed);
}

/// [`crate::reap`] 의 기준선.
pub(crate) fn next_id() -> u32 {
    NEXT_ID.load(Ordering::Relaxed)
}

/// 이 파일에서 공유 전송로를 끊는 자리는 여기 하나다 — **마지막 사용자였을 때만** 끊는다.
/// 점프는 대상 **뒤에** 끊는다 — 대상의 작별 인사가 아직 그 통로를 타고 나가야 한다.
pub(super) async fn unpin_shared(pin: &SharedPin, id: u32) {
    pin.signal.leave(pin.token);
    let Some(last) = TRANSPORTS.release(&pin.key, id) else {
        return;
    };
    let _ = last
        .handle
        .disconnect(Disconnect::ByApplication, "closed by user", "en")
        .await;
    if let Some(jump) = &last.jump {
        let _ = jump
            .disconnect(Disconnect::ByApplication, "closed by user", "en")
            .await;
    }
}

fn writer_of(
    state: &SshSessions,
    id: u32,
) -> Result<Arc<ChannelWriteHalf<Msg>>, String> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref())
        .map(|sh| Arc::clone(&sh.writer))
        .ok_or_else(|| "no such ssh session".to_string())
}

pub(crate) fn attach_parts(
    state: &SshSessions,
    id: u32,
) -> Option<(OutputSlot, Arc<Gate>, Arc<ChannelWriteHalf<Msg>>)> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref())
        .map(|sh| {
            (
                Arc::clone(&sh.output),
                Arc::clone(&sh.gate),
                Arc::clone(&sh.writer),
            )
        })
}

/// 떨어진 세션 목록의 메타 — 호스트 별칭 · tmux 세션 이름 · 마지막 출력 시각.
pub(crate) fn detached_meta_of(id: u32) -> Option<(String, Option<String>, Option<u64>)> {
    let row = table()
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref().map(|sh| (s.alias.clone(), s.tmux.clone(), Arc::clone(&sh.output))));
    row.map(|(alias, tmux, slot)| (alias, tmux, crate::output::last_output_ms(&slot)))
}

pub(crate) fn log_path_of(state: &SshSessions, id: u32) -> Option<String> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.log_path.clone())
}

pub(crate) fn stats_of(state: &SshSessions, id: u32) -> Option<Arc<OutputStats>> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref())
        .map(|sh| Arc::clone(&sh.stats))
}

// ---------------------------------------------------------------------------
// 연결 상태
// ---------------------------------------------------------------------------

/// 비밀번호 · 키 바이트는 없다 — 앱이 애초에 들고 있지 않다.
/// keepalive 성공 시각 칸은 두지 않는다 — 러시의 자동 keepalive 는 응답을 버려, 대신 [`SessionInfo::rtt_ms`] 가 물을 때 한 번 같은 요청으로 잰다.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionInfo {
    /// 못 읽었으면 빈 문자열.
    pub server_version: String,
    pub auth_method: AuthMethod,
    pub identity: Option<String>,
    pub identity_stored: bool,
    pub jump: Option<String>,
    pub connected_at_ms: u64,
    pub keepalive_secs: Option<u64>,
    /// 못 쟀으면 `None` — 값이 없는 것과 0 은 다르다.
    pub rtt_ms: Option<u64>,
    /// 같은 연결을 쓰는 **다른** 타일 수(혼자면 0).
    pub shared_with: u32,
    /// 같은 전송로를 빌린 쿼리 타일의 DB 연결 수 — 타일 수([`shared_with`](Self::shared_with))에서 뺐다.
    pub db_conns: u32,
    pub joined: bool,
    /// 서버가 거절했어도 참이다.
    pub agent_forward: bool,
}

/// 넘으면 `rtt_ms = None` 이고 **오류가 아니다** — 말풍선 한 줄 때문에 사용자를 기다리게 하지 않는다.
const RTT_TIMEOUT_MS: u64 = 1500;

/// 세션 서버 op `ssh_info` 의 몸.
pub(crate) async fn session_info(id: u32) -> Result<SessionInfo, String> {
    let state = table();
    // 잠금 안에서는 복사만 한다 — 아래 `await` 까지 들고 가면 그 세션의 출력 · 입력이 함께 선다.
    let (
        handle,
        server_version,
        method,
        identity,
        identity_stored,
        jump,
        connected_at_ms,
        keepalive_secs,
        share_key,
        joined,
        agent_forward,
    ) = {
        let map = state.0.lock().unwrap();
        let s = map.get(&id).ok_or_else(crate::errors::session_gone)?;
        (
            Arc::clone(&s.handle),
            s.info.server_version.clone(),
            s.info.method,
            s.info.identity.clone(),
            s.info.identity_stored,
            s.info.jump.clone(),
            s.info.connected_at_ms,
            s.info.keepalive_secs,
            s.shared.as_ref().map(|p| p.key.clone()),
            s.joined,
            s.agent_forward,
        )
    };

    let (tiles, db_pins) = share_key.as_deref().map_or((0, 0), |k| TRANSPORTS.count_users(k));
    let shared_with = tiles.saturating_sub(1) as u32;
    let db_conns = db_pins as u32;

    let started = std::time::Instant::now();
    let rtt_ms =
        match tokio::time::timeout(Duration::from_millis(RTT_TIMEOUT_MS), handle.send_ping()).await
        {
            Ok(Ok(())) => Some(started.elapsed().as_millis() as u64),
            _ => None,
        };

    Ok(SessionInfo {
        server_version: server_version.unwrap_or_default(),
        auth_method: method,
        identity,
        identity_stored,
        jump,
        connected_at_ms,
        keepalive_secs,
        rtt_ms,
        shared_with,
        db_conns,
        joined,
        agent_forward,
    })
}

pub(crate) fn handle_of(state: &SshSessions, id: u32) -> Option<SessionHandle> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| Arc::clone(&s.handle))
}

pub(crate) fn transport_of(
    state: &SshSessions,
    id: u32,
) -> Option<(SessionHandle, u64)> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| (Arc::clone(&s.handle), s.transport_id))
}

/// 임대 검사는 부른 쪽(`server::sessions`)이 한다.
pub(crate) async fn write(id: u32, data: Vec<u8>) -> Result<(), String> {
    let writer = writer_of(table(), id)?;
    writer.data_bytes(data).await.map_err(|e| e.to_string())
}

pub(crate) async fn resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let writer = writer_of(table(), id)?;
    writer
        .window_change(cols as u32, rows as u32, 0, 0)
        .await
        .map_err(|e| e.to_string())?;
    resize_tap(id, cols, rows);
    Ok(())
}

/// 서버 해석기(`crate::screen_mirror`)를 원격 창 크기에 맞춘다 — `window-change` 를 보낸 자리마다 부른다.
pub(crate) fn resize_tap(id: u32, cols: u16, rows: u16) {
    if let Some((slot, _, _)) = attach_parts(table(), id) {
        crate::output::resize_tap(&slot, cols, rows);
    }
}

const SHELL_CLOSE_LIMIT: std::time::Duration = std::time::Duration::from_secs(2);

pub(super) async fn shut_shell(shell: &ShellPipe) {
    // 읽기 쪽이 아래 닫기보다 먼저 끝나도 정돈된 종료로 적히게 먼저 세운다.
    shell.closing.store(true, Ordering::SeqCst);
    // 수문을 먼저 열어야 대기 중인 펌프 태스크가 깨어난다.
    shell.gate.release();
    // 시한 아래에서 — russh 의 close 는 세션 루프로 가는 mpsc send 라 루프가 죽어 있으면 끝나지 않을 수 있다.
    if tokio::time::timeout(SHELL_CLOSE_LIMIT, shell.writer.close())
        .await
        .is_err()
    {
        eprintln!(
            "[aynx] SSH 셸 채널 닫기가 {SHELL_CLOSE_LIMIT:?} 안에 끝나지 않아 건너뜁니다"
        );
    }
    // 펌프를 **우리가** 끝낸다 — 러시가 이 닫기의 답을 읽기 쪽에 넘기지 않아, 공유 전송로에서는 `reader.wait()` 가 전송로가 끝날 때까지 안 끝난다.
    shell.closed.notify_one();
}

/// 임대 검사 없이 닫는다(창 파괴 거둠 · 복원이 데려가지 않은 세션 · 서버 끝).
pub(crate) async fn close_ssh_by_id(id: u32) {
    core().remove_id(Kind::Ssh, id);
    release_ssh(table(), id).await;
}

pub(crate) fn all_ids() -> Vec<u32> {
    let mut ids: Vec<u32> = table().0.lock().unwrap().keys().copied().collect();
    ids.sort_unstable();
    ids
}

/// 멱등 — 명시 닫기 · 종료 마감 · 창 거둠이 겹쳐 와도 한 번. 코어 표는 만지지 않는다(부른 쪽의 몫).
pub(crate) async fn release_ssh(state: &SshSessions, id: u32) {
    // 포트 포워드를 **먼저** 멈춘다 — 리스너가 남으면 연결을 받아 놓고 곧바로 끊기만 하는 함정이 된다.
    crate::port_forward::stop_session_forwards(id);
    // 로컬 편집 파일은 남긴다 — 사용자가 편집기에 띄워 둔 작업물이다.
    crate::server::tunnel::close_session(id);

    let session = state.0.lock().unwrap().remove(&id);
    if let Some(session) = session {
        // 이 전송로에서 켠 마지막 세션이면 에이전트 중계까지 여기서 끊긴다(옆 타일이 전송로를 살려 두어도).
        crate::agent_forward::disable(session.transport_id, id);
        // 서버의 신호 파일은 이 주인이 거뒀을 때만 지운다(재연결이 이미 새 파일을 썼으면 둔다) — 전송로가 아직 살아 있을 때(아래 `unpin_shared` 앞)라야 닿는다.
        if let Some((stream, owner)) = &session.signal {
            if crate::agent_signal::revoke(stream, *owner) == Some(true) {
                crate::remote_signal_file::remove(&session.handle, stream).await;
            }
        }
        if let Some(shell) = &session.shell {
            shut_shell(shell).await;
        }
        match &session.shared {
            Some(pin) => unpin_shared(pin, id).await,
            None => {
                let _ = session
                    .handle
                    .disconnect(Disconnect::ByApplication, "closed by user", "en")
                    .await;
                // 점프는 대상 뒤에 끊는다 — 대상의 작별 인사가 아직 이 통로를 타고 나가야 한다.
                if let Some(jump) = &session.jump {
                    let _ = jump
                        .disconnect(Disconnect::ByApplication, "closed by user", "en")
                        .await;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 종료 마감
// ---------------------------------------------------------------------------

/// 펌프가 마지막으로 읽은 바이트가 배처에 닿을 틈(로컬 `pty::EXIT_DRAIN_GRACE` 와 같은 값).
const EXIT_DRAIN_GRACE: Duration = Duration::from_millis(50);
const EXIT_MARK_WAIT: Duration = Duration::from_millis(500);

/// 로컬 `local-exit` 과 같은 모양. `removed` — 붙은 창 없이 끝나 표에서 지웠다(거울은 서버가 이미 거뒀다 · GUI 는 출력 경로만 지운다).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SshExit {
    id: u32,
    reason: &'static str,
    message: Option<String>,
    stream: Option<String>,
    session_epoch: Option<u64>,
    removed: bool,
}

/// [`ExitSignal`] 이 정확히 한 번 부른다(창 세션만 — 헤드리스는 제 훅이 있다).
/// `ssh-exit` 를 자원 회수([`release_ssh`]) **앞에** 쏜다 — 죽은 전송로의 정리(채널 닫기 시한 등)가 재접속 배너를 늦추지 않게.
pub(super) async fn finish_exit(event: ExitEvent) {
    let id = event.id;
    let parts = {
        let map = table().0.lock().unwrap();
        map.get(&id)
            .and_then(|s| s.shell.as_ref())
            .map(|sh| (Arc::clone(&sh.output), sh.mark.lock().unwrap().clone()))
    };
    tokio::time::sleep(EXIT_DRAIN_GRACE).await;
    let final_offset = match parts {
        Some((slot, mark)) => tokio::task::spawn_blocking(move || {
            crate::output::flush_mark(&mark, &slot, EXIT_MARK_WAIT)
        })
        .await
        .unwrap_or(0),
        None => 0,
    };
    let end = if event.reason == REASON_EXIT {
        End::Exited {
            reason: event.message.clone(),
            final_offset,
        }
    } else {
        End::Disconnected {
            at_ms: crate::session_core::now_ms(),
            reason: event.message.clone(),
        }
    };
    let exit = core().ended(Kind::Ssh, id, end);
    // 떨어진 채 끝나 표에서 빠졌으면 시청자에게 끝을 알린다.
    crate::server::sessions::settle();
    let removed = exit.as_ref().is_some_and(|e| e.removed);
    if let Some(e) = exit.as_ref().filter(|e| e.removed) {
        crate::server::log::line(format!(
            "ssh {id} ended with no window attached (stream {}, {}) — removed · final offset {final_offset}",
            e.stream, event.reason
        ));
    }
    // 붙은 창이 없었으면 거울을 지울 손(`Terminal` 의 `dropSession`)도 없다 — 서버의 AI 평면이 거둔다.
    if let Some(e) = exit.as_ref().filter(|e| e.removed) {
        crate::server::ai::on_session_removed(&e.stream);
    }
    let body = SshExit {
        id,
        reason: event.reason,
        message: event.message,
        session_epoch: exit.as_ref().map(|e| e.session_epoch),
        stream: exit.map(|e| e.stream),
        removed,
    };
    crate::server::hub::emit("ssh-exit", serde_json::to_value(body).unwrap_or_default());
    if removed {
        crate::server::sessions::detached_changed();
    }
    crate::server::sessions::retire_ssh_credit(id);
    release_ssh(table(), id).await;
}
