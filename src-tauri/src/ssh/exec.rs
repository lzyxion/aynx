//! exec 채널 — PTY 를 요청하지 않는 명령 한 판. 사용자의 대화형 셸 세션을 건드리지 않는다(PTY 미요청이지 셸 미사용은 아니다 —
//! 명령은 원격 로그인 셸이 실행한다).
//!
//! SSH 전송로는 세션 서버 프로세스에 산다 — GUI 는 [`ExecHandle::Server`] 로 서버 op `ssh_exec` 를 거친다.
//! **명령 글자는 GUI Rust 의 고정 조립 함수가 짓는다** — 프런트 · MCP 에서 임의 문자열이 이 길로 오는 문은 없다
//! (원시 `send_command` 가 아니다 — `ssh_ops` 머리말).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;

use crate::i18n::tr;

use super::*;

/// `Direct` = 이 프로세스(세션 서버)의 러시 핸들 · `Server` = 세션 서버 표의 세션 id(GUI).
#[derive(Clone)]
pub(crate) enum ExecHandle {
    Direct(SessionHandle),
    Server(u32),
}

impl From<SessionHandle> for ExecHandle {
    fn from(h: SessionHandle) -> Self {
        ExecHandle::Direct(h)
    }
}

impl ExecHandle {
    pub(crate) fn server(id: u32) -> Self {
        ExecHandle::Server(id)
    }
}

type Boxed<T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send>>;
pub(crate) type RemoteText = fn(u32, String, Duration, Arc<AtomicBool>) -> Boxed<ExecOutcome>;
pub(crate) type RemoteBytes = fn(u32, String, Duration, usize) -> Boxed<ExecBytes>;

/// 함수 포인터로 꽂는다 — GUI 의 파이프 클라이언트를 직접 부르면 테스트 실행파일까지 창 코드(comctl32 v6)를 끌고 온다.
/// 서버 프로세스에서는 꽂히지 않는다.
static REMOTE: std::sync::OnceLock<(RemoteText, RemoteBytes)> = std::sync::OnceLock::new();

pub(crate) fn set_remote_exec(text: RemoteText, bytes: RemoteBytes) {
    let _ = REMOTE.set((text, bytes));
}

fn no_remote() -> String {
    tr!(ko: "세션 서버에 닿지 못했습니다", en: "Could not reach the session server")
}

/// 넘치면 앞을 버린다 — 오류·요약은 보통 끝에 나온다.
pub(crate) const EXEC_OUTPUT_CAP: usize = 64 * 1024;

/// 사실만 담고 판정하지 않는다(분류는 [`crate::operations`]). 파이프(`ssh_exec` 의 답)로도 오간다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ExecOutcome {
    pub exit_code: Option<i64>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    /// `channel.exec()` 가 ack 된 뒤에만 `true` — 분류가 이 값으로 시작 전 취소(Cancelled)와 시작 후 취소(Unknown)를 가른다.
    pub launched: bool,
    pub error: Option<String>,
}

#[derive(Default)]
pub(crate) struct ExecAccum {
    exit_code: Option<i64>,
    stdout: CappedText,
    stderr: CappedText,
}

impl ExecAccum {
    pub(crate) fn push_stdout(&mut self, bytes: &[u8]) {
        self.stdout.push(bytes);
    }
    pub(crate) fn push_stderr(&mut self, bytes: &[u8]) {
        self.stderr.push(bytes);
    }
    pub(crate) fn set_exit(&mut self, code: i64) {
        self.exit_code = Some(code);
    }
    pub(crate) fn into_outcome(
        self,
        timed_out: bool,
        cancelled: bool,
        launched: bool,
    ) -> ExecOutcome {
        let (stdout, stdout_truncated) = self.stdout.finish();
        let (stderr, stderr_truncated) = self.stderr.finish();
        ExecOutcome {
            exit_code: self.exit_code,
            stdout,
            stderr,
            timed_out,
            cancelled,
            stdout_truncated,
            stderr_truncated,
            launched,
            error: None,
        }
    }
}

/// russh 조각은 글자 경계를 모른다 — 조각마다 손실 변환하면 두 조각에 걸친 한글 한 글자가 깨진다. 미완성 꼬리를 들고 있다가 잇는다.
#[derive(Default)]
pub(crate) struct CappedText {
    text: String,
    pending: Vec<u8>,
    truncated: bool,
}

impl CappedText {
    pub(crate) fn push(&mut self, bytes: &[u8]) {
        let mut joined = std::mem::take(&mut self.pending);
        joined.extend_from_slice(bytes);
        let mut decoded = String::new();
        let mut rest = &joined[..];
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    decoded.push_str(s);
                    break;
                }
                Err(e) => {
                    let (good, bad) = rest.split_at(e.valid_up_to());
                    decoded.push_str(&String::from_utf8_lossy(good));
                    match e.error_len() {
                        Some(n) => {
                            decoded.push(char::REPLACEMENT_CHARACTER);
                            rest = &bad[n..];
                        }
                        None => {
                            self.pending = bad.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        self.truncated |= append_capped(&mut self.text, &decoded);
    }

    pub(crate) fn finish(mut self) -> (String, bool) {
        if !self.pending.is_empty() {
            let tail = String::from_utf8_lossy(&self.pending).into_owned();
            self.truncated |= append_capped(&mut self.text, &tail);
        }
        (self.text, self.truncated)
    }
}

pub(super) fn append_capped(buf: &mut String, s: &str) -> bool {
    buf.push_str(s);
    if buf.len() <= EXEC_OUTPUT_CAP {
        return false;
    }
    let mut cut = buf.len() - EXEC_OUTPUT_CAP;
    while cut < buf.len() && !buf.is_char_boundary(cut) {
        cut += 1;
    }
    *buf = buf.split_off(cut);
    true
}

/// 취소는 로컬 펌프를 멈추고 채널을 떨어뜨릴 뿐이다 — **원격에서 이미 시작된 명령은 계속 돌 수 있다**(SSH 는 실행 중 프로세스를
/// 죽일 표준 신호를 보장하지 않는다 — 알고 받은 한계). 취소는 "결과를 더 기다리지 않는다" 는 뜻이다.
pub(crate) async fn run_exec(
    handle: impl Into<ExecHandle>,
    command: String,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> ExecOutcome {
    match handle.into() {
        ExecHandle::Direct(h) => run_exec_direct(h, command, timeout, cancel).await,
        ExecHandle::Server(id) => match REMOTE.get() {
            Some((text, _)) => text(id, command, timeout, cancel).await,
            None => ExecOutcome {
                error: Some(no_remote()),
                ..Default::default()
            },
        },
    }
}

pub(crate) async fn run_exec_direct(
    handle: SessionHandle,
    command: String,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> ExecOutcome {
    if cancel.load(Ordering::SeqCst) {
        return ExecAccum::default().into_outcome(false, true, false);
    }

    // 데드라인을 가장 먼저 잡는다 — 채널 열기·exec 요청 자체가 hang 해도 시한과 취소가 덮어야 한다.
    let deadline = tokio::time::Instant::now() + timeout;

    let channel = match await_bounded(handle.channel_open_session(), deadline, &cancel).await {
        Bounded::Ready(Ok(c)) => c,
        Bounded::Ready(Err(e)) => {
            return ExecOutcome {
                error: Some(
                    tr!(ko: "exec 채널을 열지 못했습니다: {e}", en: "Could not open the exec channel: {e}"),
                ),
                ..Default::default()
            }
        }
        Bounded::TimedOut => return ExecAccum::default().into_outcome(true, false, false),
        Bounded::Cancelled => return ExecAccum::default().into_outcome(false, true, false),
    };

    match await_bounded(channel.exec(true, command.as_bytes()), deadline, &cancel).await {
        Bounded::Ready(Ok(())) => {}
        Bounded::Ready(Err(e)) => {
            return ExecOutcome {
                error: Some(
                    tr!(ko: "exec 요청이 거부되었습니다: {e}", en: "The exec request was refused: {e}"),
                ),
                ..Default::default()
            }
        }
        Bounded::TimedOut => return ExecAccum::default().into_outcome(true, false, false),
        Bounded::Cancelled => return ExecAccum::default().into_outcome(false, true, false),
    }

    // stdin 은 즉시 EOF — 안 보내면 입력을 기다리는 명령이 데드라인까지 매달린다. EOF 보내기도 시한 아래에서
    // (russh 의 eof 는 세션 루프로 가는 mpsc send 라 루프가 죽으면 멈출 수 있다).
    let (mut reader, writer) = channel.split();
    let _ = await_bounded(writer.eof(), deadline, &cancel).await;
    drop(writer);

    let mut accum = ExecAccum::default();
    let mut timed_out = false;
    let mut cancelled = false;

    loop {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            timed_out = true;
            break;
        }
        let tick = std::cmp::min(deadline, now + CANCEL_POLL);
        match tokio::time::timeout_at(tick, reader.wait()).await {
            Ok(Some(ChannelMsg::Data { data })) => accum.push_stdout(&data),
            Ok(Some(ChannelMsg::ExtendedData { data, .. })) => accum.push_stderr(&data),
            Ok(Some(ChannelMsg::ExitStatus { exit_status })) => accum.set_exit(exit_status as i64),
            // Eof 뒤에 늦게 오는 exit-status 를 놓치지 않으려 Close 까지 읽는다.
            Ok(Some(ChannelMsg::Close)) | Ok(None) => break,
            Ok(Some(_)) => {}
            Err(_) => {}
        }
    }

    accum.into_outcome(timed_out, cancelled, true)
}

const CANCEL_POLL: Duration = Duration::from_millis(200);

#[derive(Default)]
pub(crate) struct ExecBytes {
    pub exit_code: Option<i64>,
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub overflow: bool,
    pub timed_out: bool,
    pub error: Option<String>,
}

/// 바이트 판 — stdout 을 앞에서부터 쌓는다(경계 표식으로 가르는 출력이라 앞을 버리면 뜻이 없다).
pub(crate) async fn run_exec_bytes(
    handle: impl Into<ExecHandle>,
    command: String,
    timeout: Duration,
    max_stdout: usize,
) -> ExecBytes {
    match handle.into() {
        ExecHandle::Direct(h) => run_exec_bytes_direct(h, command, timeout, max_stdout).await,
        ExecHandle::Server(id) => match REMOTE.get() {
            Some((_, bytes)) => bytes(id, command, timeout, max_stdout).await,
            None => ExecBytes {
                error: Some(no_remote()),
                ..Default::default()
            },
        },
    }
}

pub(crate) async fn run_exec_bytes_direct(
    handle: SessionHandle,
    command: String,
    timeout: Duration,
    max_stdout: usize,
) -> ExecBytes {
    let never = AtomicBool::new(false);
    let deadline = tokio::time::Instant::now() + timeout;
    let mut out = ExecBytes {
        exit_code: None,
        stdout: Vec::new(),
        stderr: String::new(),
        overflow: false,
        timed_out: false,
        error: None,
    };
    let channel = match await_bounded(handle.channel_open_session(), deadline, &never).await {
        Bounded::Ready(Ok(c)) => c,
        Bounded::Ready(Err(e)) => {
            out.error = Some(
                tr!(ko: "exec 채널을 열지 못했습니다: {e}", en: "Could not open the exec channel: {e}"),
            );
            return out;
        }
        Bounded::TimedOut | Bounded::Cancelled => {
            out.timed_out = true;
            return out;
        }
    };
    match await_bounded(channel.exec(true, command.as_bytes()), deadline, &never).await {
        Bounded::Ready(Ok(())) => {}
        Bounded::Ready(Err(e)) => {
            out.error = Some(
                tr!(ko: "exec 요청이 거부되었습니다: {e}", en: "The exec request was refused: {e}"),
            );
            return out;
        }
        Bounded::TimedOut | Bounded::Cancelled => {
            out.timed_out = true;
            return out;
        }
    }
    let (mut reader, writer) = channel.split();
    // `run_exec_direct` 와 같은 이유로 EOF 도 데드라인 아래에서.
    let _ = await_bounded(writer.eof(), deadline, &never).await;
    drop(writer);
    let mut stderr = CappedText::default();
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            out.timed_out = true;
            break;
        }
        match tokio::time::timeout_at(deadline, reader.wait()).await {
            Ok(Some(ChannelMsg::Data { data })) => {
                if out.stdout.len() + data.len() > max_stdout {
                    out.overflow = true;
                    break;
                }
                out.stdout.extend_from_slice(&data);
            }
            Ok(Some(ChannelMsg::ExtendedData { data, .. })) => stderr.push(&data),
            Ok(Some(ChannelMsg::ExitStatus { exit_status })) => {
                out.exit_code = Some(exit_status as i64)
            }
            Ok(Some(ChannelMsg::Close)) | Ok(None) => break,
            Ok(Some(_)) => {}
            Err(_) => {
                out.timed_out = true;
                break;
            }
        }
    }
    out.stderr = stderr.finish().0;
    out
}

pub(super) enum Bounded<T> {
    Ready(T),
    TimedOut,
    Cancelled,
}

/// 미래는 `timeout_at` 이 소비하지 않게 핀으로 잡아 tick 마다 이어서 폴한다.
pub(super) async fn await_bounded<F, T>(
    fut: F,
    deadline: tokio::time::Instant,
    cancel: &AtomicBool,
) -> Bounded<T>
where
    F: std::future::Future<Output = T>,
{
    tokio::pin!(fut);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Bounded::Cancelled;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Bounded::TimedOut;
        }
        let tick = std::cmp::min(deadline, now + CANCEL_POLL);
        if let Ok(v) = tokio::time::timeout_at(tick, &mut fut).await {
            return Bounded::Ready(v);
        }
    }
}
