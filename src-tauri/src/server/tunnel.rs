//! **채널 터널**(③-3b2 · 사용자 결정 3 "SFTP = 채널 터널") — 세션 서버가 쥔 SSH 전송로 위의 서브시스템 채널(`sftp`)의
//! 바이트를 파이프의 [`Frame::Channel`] 로 GUI 에 나르고, GUI 의 russh-sftp 클라이언트(`crate::sftp` · `crate::sftp_browser`)는
//! **예전 코드 그대로** 그 스트림 위에서 돈다(`russh_sftp::client::SftpSession::new(stream)` — 스트림만 바뀌었다).
//!
//! ```text
//!  GUI                                    파이프                          세션 서버
//!  SftpSession ⇄ DuplexStream ⇄ 펌프 ──Channel{chan, bytes}──▶ 쓰기 태스크 ──▶ russh 채널(sftp)
//!                                  ◀──ChanAck{chan, consumed}──
//!                              ◀──Channel{chan, bytes}── 읽기 펌프 ◀── russh 채널
//!                              ──ChanAck{chan, consumed}──▶
//! ```
//!
//! - **열기**: GUI op `chan_open{session, subsystem: "sftp"}`(쓰기) → 서버가 그 세션의 전송로에 채널을 열고 서브시스템을
//!   청한 뒤 번호를 돌려준다. 서브시스템은 `sftp` 하나만 받는다(임의 채널·exec 를 여는 문이 아니다).
//! - **흐름 제어** — 출력/ACK(③-2)와 같은 규칙을 **양방향**으로: 보내는 쪽은 받은 쪽이 [`Frame::ChanAck`] 로 돌려준 누적
//!   소비량과의 차이가 [`CHAN_BUDGET`] 을 넘으면 다음 덩어리를 보내지 않는다(서버의 읽기 펌프가 멈추면 russh 가 창을 더 열지
//!   않아 원격까지 역압이 간다). ACK 는 단조 증가만, 보낸 끝을 넘으면 버린다([`super::credit::Ledger`]).
//! - **끝**: 0 바이트 `Channel` = 그 방향의 EOF. GUI 쪽이 닫히면(SftpSession 드롭) EOF + `chan_close`, 서버 쪽 채널이 닫히면
//!   EOF 를 보낸다. 연결이 끊기면 서버는 그 연결의 채널을 모두 닫고(`conn_gone`), SSH 세션이 거둬지면 그 세션의 채널도 닫는다
//!   ([`close_session`] — 예전 `sftp::stop_session_sftp` 의 자리).
//! - 다른 연결이 연 채널 번호의 프레임은 버린다(주인 연결만).
//!
//! 이 파일에는 두 프로세스의 몸이 함께 있다 — 위는 **서버**(`open`·`from_client`·`server_ack`·`close*`), 아래는 **GUI**
//! (`open_sftp`·`on_channel`·`on_chan_ack`·`on_server_lost`). 둘은 같은 크레딧 장부([`Flow`])를 쓴다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use russh::ChannelMsg;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Notify};

use super::credit::{AckRefusal, Ledger};
use super::ipc::frame::{code, Frame};
use super::ipc::{Grade, WireError};
use super::sessions::ConnCtx;

/// 한 방향에서 ACK 없이 보낼 수 있는 양.
pub(crate) const CHAN_BUDGET: u64 = 1 << 20;
/// GUI 쪽 펌프가 한 번에 읽는 양(프레임 하나).
const READ_CHUNK: usize = 32 * 1024;
/// GUI 쪽 이음 버퍼(russh-sftp ⇄ 펌프).
const DUPLEX_BUF: usize = 256 * 1024;
/// 서버가 채널을 열고 서브시스템을 청하는 상한.
const OPEN_LIMIT: Duration = Duration::from_secs(20);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// 크레딧 (두 프로세스 공용)
// ---------------------------------------------------------------------------

/// 한 방향의 흐름 — 보낸 끝 · 받은 ACK(장부) + 자리가 났다는 종 + 닫힘.
pub(crate) struct Flow {
    ledger: Mutex<Ledger>,
    room: Notify,
    closed: AtomicBool,
}

impl Default for Flow {
    fn default() -> Self {
        Flow {
            ledger: Mutex::new(Ledger::starting_at(0)),
            room: Notify::new(),
            closed: AtomicBool::new(false),
        }
    }
}

impl Flow {
    /// `n` 바이트를 보냈다.
    pub(crate) fn on_send(&self, n: usize) {
        let mut l = lock(&self.ledger);
        let start = l.sent_end;
        l.sent(start, start + n as u64);
    }

    /// 받은 쪽의 누적 소비량 — 단조 증가만, 보낸 끝을 넘으면 거부.
    pub(crate) fn on_ack(&self, consumed: u64) -> Result<(), AckRefusal> {
        lock(&self.ledger).ack(consumed)?;
        self.room.notify_waiters();
        Ok(())
    }

    pub(crate) fn outstanding(&self) -> u64 {
        lock(&self.ledger).outstanding()
    }

    /// 미확인이 예산 아래로 내려올 때까지 기다린다 — 닫혔으면 `false`.
    pub(crate) async fn wait_room(&self) -> bool {
        loop {
            let notified = self.room.notified();
            if self.closed.load(Ordering::SeqCst) {
                return false;
            }
            if self.outstanding() <= CHAN_BUDGET {
                return true;
            }
            notified.await;
        }
    }

    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.room.notify_waiters();
    }
}

// ---------------------------------------------------------------------------
// 서버 쪽
// ---------------------------------------------------------------------------

struct SrvChan {
    conn: u64,
    session: u32,
    /// GUI → 원격 바이트(쓰기 태스크가 받는다). 떨어뜨리면 쓰기 태스크가 채널을 닫는다.
    to_remote: mpsc::UnboundedSender<Vec<u8>>,
    /// 서버 → GUI 방향의 크레딧(읽기 펌프가 기다린다).
    flow: Arc<Flow>,
    pump: tokio::task::AbortHandle,
}

static SRV: LazyLock<Mutex<HashMap<u64, SrvChan>>> = LazyLock::new(Default::default);
static NEXT_CHAN: AtomicU64 = AtomicU64::new(1);

fn serr(m: impl Into<String>) -> WireError {
    WireError::new(code::SESSION, m)
}

/// `chan_open` — 그 세션의 전송로에 `sftp` 서브시스템 채널을 열고 펌프 둘을 띄운다. 채널 번호.
pub(crate) async fn open(session: u32, subsystem: &str, ctx: &ConnCtx) -> Result<Value, WireError> {
    if subsystem != "sftp" {
        return Err(WireError::new(code::BAD_BODY, "only the sftp subsystem can be tunnelled"));
    }
    let handle = crate::ssh::handle_of(crate::ssh::table(), session)
        .ok_or_else(|| serr(crate::errors::session_gone_closed()))?;
    let channel = tokio::time::timeout(OPEN_LIMIT, async {
        let channel = handle.channel_open_session().await.map_err(|e| {
            crate::i18n::tr!(ko: "SFTP 채널을 열지 못했습니다: {e}", en: "Could not open an SFTP channel: {e}")
        })?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| {
            crate::i18n::tr!(ko: "서버가 SFTP 를 지원하지 않습니다: {e}", en: "The server does not support SFTP: {e}")
        })?;
        Ok::<_, String>(channel)
    })
    .await
    .map_err(|_| {
        serr(crate::i18n::tr!(
            ko: "SFTP 채널을 여는 데 너무 오래 걸립니다 — 연결 상태를 확인하세요",
            en: "Opening the SFTP channel is taking too long — check the connection"
        ))
    })?
    .map_err(serr)?;

    let chan = NEXT_CHAN.fetch_add(1, Ordering::Relaxed);
    let (mut reader, writer) = channel.split();
    let flow = Arc::new(Flow::default());
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // 쓰기 — GUI 의 바이트를 원격에. 다 쓴 만큼 ChanAck 를 돌려준다(GUI 쪽 크레딧).
    let out = ctx.tx.clone();
    tokio::spawn(async move {
        let mut consumed = 0u64;
        while let Some(b) = rx.recv().await {
            if b.is_empty() {
                let _ = writer.eof().await;
                break;
            }
            let n = b.len() as u64;
            if writer.data_bytes(b).await.is_err() {
                break;
            }
            consumed += n;
            if out.send(Frame::ChanAck { chan, consumed }).is_err() {
                break;
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), writer.close()).await;
    });

    // 읽기 펌프 — 원격의 바이트를 GUI 로. 크레딧이 모자라면 기다린다(그동안 russh 창이 안 열린다 — 원격까지 역압).
    let out = ctx.tx.clone();
    let pump_flow = Arc::clone(&flow);
    let pump = tokio::spawn(async move {
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if !pump_flow.wait_room().await {
                        break;
                    }
                    pump_flow.on_send(data.len());
                    if out
                        .send(Frame::Channel {
                            chan,
                            bytes: data.to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
        let _ = out.send(Frame::Channel { chan, bytes: Vec::new() });
        forget(chan);
    });

    lock(&SRV).insert(
        chan,
        SrvChan {
            conn: ctx.id,
            session,
            to_remote: tx,
            flow,
            pump: pump.abort_handle(),
        },
    );
    super::log::line(format!("chan {chan} opened — sftp on ssh {session} · conn {}", ctx.id));
    Ok(json!({ "chan": chan }))
}

/// 표에서만 뺀다(펌프가 스스로 끝났다).
fn forget(chan: u64) {
    lock(&SRV).remove(&chan);
}

fn shut(chan: u64, c: SrvChan) {
    c.flow.close();
    c.pump.abort();
    drop(c.to_remote); // 쓰기 태스크가 rx 끝을 보고 채널을 닫는다
    super::log::line(format!("chan {chan} closed (ssh {})", c.session));
}

/// `chan_close` — 그 연결의 채널이면 닫는다(멱등).
pub(crate) fn close(chan: u64, conn: u64) {
    let c = {
        let mut m = lock(&SRV);
        if m.get(&chan).is_some_and(|c| c.conn == conn) {
            m.remove(&chan)
        } else {
            None
        }
    };
    if let Some(c) = c {
        shut(chan, c);
    }
}

/// 그 연결이 연 채널을 모두 닫는다(연결 끊김).
pub(crate) fn close_conn(conn: u64) {
    let dead: Vec<(u64, SrvChan)> = {
        let mut m = lock(&SRV);
        let ids: Vec<u64> = m.iter().filter(|(_, c)| c.conn == conn).map(|(k, _)| *k).collect();
        ids.into_iter().filter_map(|k| m.remove(&k).map(|c| (k, c))).collect()
    };
    for (k, c) in dead {
        shut(k, c);
    }
}

/// 그 SSH 세션 위의 채널을 모두 닫는다 — 세션 자원 회수(`ssh::release_ssh`)가 부른다.
pub(crate) fn close_session(session: u32) {
    let dead: Vec<(u64, SrvChan)> = {
        let mut m = lock(&SRV);
        let ids: Vec<u64> = m.iter().filter(|(_, c)| c.session == session).map(|(k, _)| *k).collect();
        ids.into_iter().filter_map(|k| m.remove(&k).map(|c| (k, c))).collect()
    };
    for (k, c) in dead {
        shut(k, c);
    }
}

/// 클라이언트의 채널 바이트 — 주인 연결의 것만 쓰기 태스크로(0 바이트 = EOF).
pub(crate) fn from_client(conn: u64, chan: u64, bytes: Vec<u8>) {
    let tx = {
        let m = lock(&SRV);
        m.get(&chan).filter(|c| c.conn == conn).map(|c| c.to_remote.clone())
    };
    if let Some(tx) = tx {
        let _ = tx.send(bytes);
    }
}

/// 클라이언트의 채널 ACK — 서버 → GUI 방향의 크레딧을 돌려준다(주인 연결의 것만).
pub(crate) fn server_ack(conn: u64, chan: u64, consumed: u64) {
    let flow = {
        let m = lock(&SRV);
        m.get(&chan).filter(|c| c.conn == conn).map(|c| Arc::clone(&c.flow))
    };
    if let Some(f) = flow {
        if let Err(e) = f.on_ack(consumed) {
            super::log::line(format!("chan {chan} ack refused — {e:?}"));
        }
    }
}

// ---------------------------------------------------------------------------
// GUI 쪽
// ---------------------------------------------------------------------------

struct GuiChan {
    /// 서버 → GUI 바이트(이음 버퍼에 쓰는 태스크가 받는다).
    inbound: mpsc::UnboundedSender<Vec<u8>>,
    /// GUI → 서버 방향의 크레딧(펌프가 기다린다).
    flow: Arc<Flow>,
}

static GUI: LazyLock<Mutex<HashMap<u64, GuiChan>>> = LazyLock::new(Default::default);

/// 바이트 수집기 — `ssh_exec` 의 바이트 모드가 stdout 을 채널 프레임으로 먼저 보내고 응답을 뒤에 보낸다(`ssh_ops`). 번호는
/// GUI 가 뽑는다(위 터널 번호와 겹치지 않게 맨 윗 비트를 세운다).
static COLLECT: LazyLock<Mutex<HashMap<u64, Vec<u8>>>> = LazyLock::new(Default::default);
static NEXT_COLLECT: AtomicU64 = AtomicU64::new(1);
pub(crate) const COLLECT_BIT: u64 = 1 << 63;

/// 수집기 하나를 연다 — 번호.
pub(crate) fn collect_open() -> u64 {
    let id = COLLECT_BIT | NEXT_COLLECT.fetch_add(1, Ordering::Relaxed);
    lock(&COLLECT).insert(id, Vec::new());
    id
}

/// 수집기를 닫고 모은 바이트를 꺼낸다.
pub(crate) fn collect_take(id: u64) -> Vec<u8> {
    lock(&COLLECT).remove(&id).unwrap_or_default()
}

/// 서버의 `sftp` 채널 하나를 터널로 연다 — russh-sftp 가 그대로 쓸 수 있는 양방향 스트림.
pub(crate) async fn open_sftp(session: u32) -> Result<tokio::io::DuplexStream, String> {
    let v = super::proxy::call(
        Grade::Write,
        "chan_open",
        json!({ "session": session, "subsystem": "sftp", "lang": super::ssh_proxy::lang() }),
    )
    .await?;
    let chan = v
        .get("chan")
        .and_then(Value::as_u64)
        .ok_or_else(|| "bad chan_open reply".to_string())?;
    let (ours, theirs) = tokio::io::duplex(DUPLEX_BUF);
    let (mut rd, mut wr) = tokio::io::split(ours);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let flow = Arc::new(Flow::default());
    lock(&GUI).insert(
        chan,
        GuiChan {
            inbound: tx,
            flow: Arc::clone(&flow),
        },
    );

    // 서버 → russh-sftp. 이음 버퍼에 다 쓴 만큼 ACK(서버 쪽 읽기 펌프의 크레딧).
    tokio::spawn(async move {
        let mut consumed = 0u64;
        while let Some(b) = rx.recv().await {
            if b.is_empty() || wr.write_all(&b).await.is_err() {
                break;
            }
            consumed += b.len() as u64;
            let _ = super::client::send_frame(&Frame::ChanAck { chan, consumed }).await;
        }
        let _ = wr.shutdown().await;
    });

    // russh-sftp → 서버. 크레딧이 모자라면 기다린다. 끝나면(SftpSession 이 떨어졌다) EOF + `chan_close`.
    tokio::spawn(async move {
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            let n = match rd.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            if !flow.wait_room().await {
                break;
            }
            flow.on_send(n);
            let sent = super::client::send_frame(&Frame::Channel {
                chan,
                bytes: buf[..n].to_vec(),
            })
            .await;
            if !sent {
                break;
            }
        }
        let _ = super::client::send_frame(&Frame::Channel { chan, bytes: Vec::new() }).await;
        let _ = super::client::request_now(Grade::Write, "chan_close", json!({ "chan": chan })).await;
        lock(&GUI).remove(&chan);
    });
    Ok(theirs)
}

/// 서버의 채널 바이트 — 터널이면 이음 버퍼로, 수집기면 모은다.
pub(crate) fn on_channel(chan: u64, bytes: Vec<u8>) {
    if chan & COLLECT_BIT != 0 {
        if let Some(buf) = lock(&COLLECT).get_mut(&chan) {
            buf.extend_from_slice(&bytes);
        }
        return;
    }
    let tx = lock(&GUI).get(&chan).map(|c| c.inbound.clone());
    if let Some(tx) = tx {
        let _ = tx.send(bytes);
    }
}

/// 서버의 채널 ACK — GUI → 서버 방향의 크레딧.
pub(crate) fn on_chan_ack(chan: u64, consumed: u64) {
    let flow = lock(&GUI).get(&chan).map(|c| Arc::clone(&c.flow));
    if let Some(f) = flow {
        if let Err(e) = f.on_ack(consumed) {
            eprintln!("[tunnel] chan {chan} ack refused — {e:?}");
        }
    }
}

/// 서버 연결이 끊겼다 — 터널을 모두 끊는다(SftpSession 은 EOF 를 보고 오류로 끝난다). SFTP 캐시는 SSH 종료 알림이 비운다.
pub(crate) fn on_server_lost() {
    let dead: Vec<GuiChan> = lock(&GUI).drain().map(|(_, c)| c).collect();
    for c in dead {
        c.flow.close();
        let _ = c.inbound.send(Vec::new());
    }
    lock(&COLLECT).clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 크레딧 — 예산까지는 바로 지나가고, 넘으면 ACK 가 자리를 낼 때까지 기다린다. ACK 는 단조 증가·보낸 끝 이하.
    #[tokio::test]
    async fn flow_waits_over_budget_and_wakes_on_ack() {
        let f = Arc::new(Flow::default());
        assert!(f.wait_room().await);
        f.on_send(CHAN_BUDGET as usize + 10);
        let waiter = {
            let f = Arc::clone(&f);
            tokio::spawn(async move { f.wait_room().await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiter.is_finished(), "예산을 넘으면 기다린다");
        assert!(f.on_ack(CHAN_BUDGET * 4).is_err(), "보낸 끝을 넘는 ACK 는 거부");
        f.on_ack(20).unwrap();
        assert!(f.on_ack(10).is_ok(), "늦게 온 작은 ACK 는 무시(오류 아님)");
        assert_eq!(f.outstanding(), CHAN_BUDGET - 10);
        assert!(tokio::time::timeout(Duration::from_secs(1), waiter).await.unwrap().unwrap());
        // 닫히면 기다리던 쪽이 false 로 풀린다.
        f.on_send(CHAN_BUDGET as usize * 2);
        let waiter = {
            let f = Arc::clone(&f);
            tokio::spawn(async move { f.wait_room().await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        f.close();
        assert!(!tokio::time::timeout(Duration::from_secs(1), waiter).await.unwrap().unwrap());
    }

    /// 다른 연결이 연 채널 번호의 프레임은 버린다(주인 연결만) — 표에 없는 번호도 조용히.
    #[tokio::test]
    async fn foreign_conn_frames_are_ignored() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let flow = Arc::new(Flow::default());
        let task = tokio::spawn(async {});
        lock(&SRV).insert(
            9_000_001,
            SrvChan {
                conn: 7,
                session: 1,
                to_remote: tx,
                flow: Arc::clone(&flow),
                pump: task.abort_handle(),
            },
        );
        from_client(8, 9_000_001, b"nope".to_vec());
        assert!(rx.try_recv().is_err(), "남의 연결");
        from_client(7, 9_000_001, b"yes".to_vec());
        assert_eq!(rx.try_recv().unwrap(), b"yes".to_vec());
        flow.on_send(100);
        server_ack(8, 9_000_001, 100);
        assert_eq!(flow.outstanding(), 100, "남의 연결의 ACK 는 버린다");
        server_ack(7, 9_000_001, 100);
        assert_eq!(flow.outstanding(), 0);
        from_client(7, 1234, b"x".to_vec()); // 없는 번호 — 아무 일도 없다
        close(9_000_001, 8);
        assert!(lock(&SRV).contains_key(&9_000_001), "남의 연결은 닫지 못한다");
        close_conn(7);
        assert!(!lock(&SRV).contains_key(&9_000_001));
        assert!(flow.wait_room().await || flow.outstanding() == 0);
    }

    /// 수집기 번호는 터널 번호와 겹치지 않는다(맨 윗 비트) — 모은 바이트를 순서대로 꺼낸다.
    #[test]
    fn collectors_gather_in_order() {
        let id = collect_open();
        assert!(id & COLLECT_BIT != 0);
        on_channel(id, b"ab".to_vec());
        on_channel(id, b"cd".to_vec());
        assert_eq!(collect_take(id), b"abcd".to_vec());
        assert!(collect_take(id).is_empty());
    }
}
