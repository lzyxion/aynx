//! exec 채널(실행 브로커 · 단계 9) — PTY 를 요청하지 않는 명령 한 판([`run_exec`] ·
//! [`run_exec_bytes`])과 시한·취소 래퍼([`await_bounded`]).
//!
//! ## 어느 프로세스에서 도나 — [`ExecHandle`] (③-3b2)
//!
//! SSH 전송로는 **세션 서버 프로세스**에 산다. 그래서 exec 의 대상은 둘 중 하나다:
//! - [`ExecHandle::Direct`] — 이 프로세스가 쥔 러시 핸들(세션 서버 안: SSH 열기의 tmux 목록·설정 스크립트 쓰기·원격 워크트리
//!   준비·원격 훅 자동 설치).
//! - [`ExecHandle::Server`] — 세션 서버 표의 세션 id(GUI: git-over-ssh·원격 훅 메뉴·원격 대화 목록·작업안 실행기 …). 몸은
//!   서버 op `ssh_exec`(`server::ssh_ops`)가 `Direct` 로 돌린다. **명령 글자는 GUI Rust 의 고정 조립 함수가 짓는다** — 프런트·
//!   MCP 에서 임의 문자열이 이 길로 오는 문은 없다(원시 `send_command` 가 아니다 — `ssh_ops` 머리말).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;

use crate::i18n::tr;

use super::*;

// ---------------------------------------------------------------------------
// exec 채널 (로드맵 단계 9 — 실행 브로커). **PTY 미요청.**
//
// 셸 세션(위 `open_ssh_session`)은 `request_pty` + `request_shell`/exec-런처로 **대화형 셸**을
// 띄우고 stdout/stderr 가 한 스트림으로 뭉친다. 실행 브로커는 반대다: 승인된 작업안의 명령을
// **PTY 를 요청하지 않는 별도 exec 채널**에서 돌려(`request_pty` 안 함) stdout·stderr 를 나눠
// 받고, 사용자의 대화형 셸 세션을 건드리지 않는다. **PTY 미요청 ≠ 셸 미사용**이다 — 명령은
// 여전히 원격 로그인 셸이 실행한다(그래서 [`crate::operations::compose_command`] 의
// `cd … && …` 합성이 통한다). 결과(종료 코드·출력)는 [`crate::operations`] executor 가 대상별
// 결과 행렬에 쓴다.
//
// 협력적 취소·타임아웃의 한계는 [`run_exec`] 주석에 정직히 적는다.
// ---------------------------------------------------------------------------

/// exec 의 대상 — 이 프로세스의 러시 핸들(서버) 또는 세션 서버 표의 세션 id(GUI). 모듈 머리말.
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
    /// 세션 서버 표의 세션 하나(GUI 쪽).
    pub(crate) fn server(id: u32) -> Self {
        ExecHandle::Server(id)
    }
}

type Boxed<T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send>>;
/// `ExecHandle::Server` 의 글자 판 몸(GUI 가 꽂는다 — `server::ssh_ops::exec_text`).
pub(crate) type RemoteText = fn(u32, String, Duration, Arc<AtomicBool>) -> Boxed<ExecOutcome>;
/// `ExecHandle::Server` 의 바이트 판 몸(GUI 가 꽂는다 — `server::ssh_ops::exec_bytes`).
pub(crate) type RemoteBytes = fn(u32, String, Duration, usize) -> Boxed<ExecBytes>;

/// GUI 프로세스가 시작할 때 꽂는 서버 exec 길 — **함수 포인터로 꽂는 이유**: [`run_exec`] 이 GUI 의 파이프 클라이언트
/// (`server::client` — 창 손잡이를 쥔다)를 직접 부르면 세션 서버 쪽 코드(SSH 열기의 tmux 목록 등)에서도 그 클라이언트가
/// 정적으로 닿아 테스트 실행파일까지 창 코드(comctl32 v6)를 끌고 온다(docs/log/2026-09-22-review-request-signal.md 의 함정과
/// 같은 원인). 서버 프로세스에서는 꽂히지 않는다 — `Server` 갈래가 오면 "세션 서버에 닿지 못했다" 로 끝난다.
static REMOTE: std::sync::OnceLock<(RemoteText, RemoteBytes)> = std::sync::OnceLock::new();

/// GUI 시작(`server::client::start`)에서 한 번.
pub(crate) fn set_remote_exec(text: RemoteText, bytes: RemoteBytes) {
    let _ = REMOTE.set((text, bytes));
}

fn no_remote() -> String {
    tr!(ko: "세션 서버에 닿지 못했습니다", en: "Could not reach the session server")
}

/// exec 채널이 stdout·stderr 로 쌓아 두는 tail 상한(바이트). 넘치면 **앞을 버린다** — 오류·요약은
/// 보통 끝에 나오므로 최근이 살아 있어야 한다(스크롤백 tail 규칙과 같다).
pub(crate) const EXEC_OUTPUT_CAP: usize = 64 * 1024;

/// exec 한 판의 산출물 — [`run_exec`] 이 돌려준다. 상태 분류(성공/실패/타임아웃/취소)는
/// [`crate::operations`] 가 이 값을 보고 매긴다(exec 원시는 사실만 담고 판정하지 않는다). 파이프(`ssh_exec` 의 답)로도
/// 오간다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ExecOutcome {
    /// 종료 코드(`exit-status`). 못 받았으면(끊김·타임아웃·취소) `None`.
    pub exit_code: Option<i64>,
    /// stdout(`Data`) 누적 — tail 상한([`EXEC_OUTPUT_CAP`]).
    pub stdout: String,
    /// stderr(`ExtendedData`) 누적 — tail 상한.
    pub stderr: String,
    /// 타임아웃으로 채널을 닫았는가.
    pub timed_out: bool,
    /// 협력적 취소 플래그를 보고 멈췄는가(원격에서 이미 시작된 명령은 계속 돌 수 있다 — 아래 주석).
    pub cancelled: bool,
    /// stdout 이 [`EXEC_OUTPUT_CAP`] 을 넘어 앞을 버렸는가.
    pub stdout_truncated: bool,
    /// stderr 가 상한을 넘어 앞을 버렸는가.
    pub stderr_truncated: bool,
    /// **명령이 실제로 원격에 전송됐는가** — `channel.exec()` 가 `Ok` 를 돌려준 뒤에만 `true`.
    ///
    /// 채널을 여는 도중이거나 exec 요청이 ack 되기 전에 끝났으면(취소·타임아웃·오류) `false` —
    /// 아무것도 실행되지 않았다. exec 이 ack 된 뒤의 취소·타임아웃·정상 종료는 `true` — 명령이
    /// 이미 나갔으므로 원격 효과를 확신할 수 없다. [`crate::operations::classification::classify`] 가 이 값으로
    /// **시작 전 취소(Cancelled)** 와 **시작 후 취소(Unknown·상태 불명)** 를 가른다(슬라이스 A5).
    pub launched: bool,
    /// 채널을 열거나 exec 을 요청하지 못했다(전송 오류). 있으면 실패로 분류된다.
    pub error: Option<String>,
}

/// stdout/stderr 누적기 — russh 타입과 무관한 **순수** 상태라 단위 테스트가 쉽다.
///
/// [`run_exec`] 의 펌프가 `Data`→[`push_stdout`](Self::push_stdout)·
/// `ExtendedData`→[`push_stderr`](Self::push_stderr)·`exit-status`→[`set_exit`](Self::set_exit)
/// 로 옮겨 담고, 끝나면 [`into_outcome`](Self::into_outcome) 로 봉한다.
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
    /// 펌프가 어떻게 끝났는지(타임아웃·취소·정상)와 명령이 실제로 나갔는지(`launched`)를 얹어 봉한다.
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

/// 한 스트림(stdout 또는 stderr)의 조각을 UTF-8 로 풀어 tail 상한 안에 쌓는다 — **순수**(테스트 대상).
///
/// russh 조각(≤32KiB)은 글자 경계를 모른다 — 조각마다 손실 변환하면 두 조각에 걸친 한글 한 글자가
/// 양쪽 U+FFFD 로 깨진다. 그래서 끝에 걸린 **미완성 글자 꼬리(≤3바이트)** 를 들고 있다가 다음 조각
/// 앞에 붙여 푼다. 진짜 잘못된 바이트만 U+FFFD 가 되고, 스트림 끝에 남은 꼬리는
/// [`finish`](Self::finish) 가 손실 변환으로 마무리한다.
#[derive(Default)]
pub(crate) struct CappedText {
    text: String,
    /// 다음 조각을 기다리는 미완성 글자의 앞 바이트(≤3).
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
                        // 잘못된 바이트 — 그 자리만 U+FFFD 로 바꾸고 계속 푼다.
                        Some(n) => {
                            decoded.push(char::REPLACEMENT_CHARACTER);
                            rest = &bad[n..];
                        }
                        // 조각 끝에서 글자가 덜 왔다 — 다음 조각을 기다린다.
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

    /// 남은 꼬리를 손실 변환으로 마무리하고 (글자, 앞을 버렸는가) 를 돌려준다.
    pub(crate) fn finish(mut self) -> (String, bool) {
        if !self.pending.is_empty() {
            let tail = String::from_utf8_lossy(&self.pending).into_owned();
            self.truncated |= append_capped(&mut self.text, &tail);
        }
        (self.text, self.truncated)
    }
}

/// 글자를 이어 붙이고 tail 상한을 지킨다 — 앞을 버렸으면 `true`. **순수 함수**(테스트 대상).
///
/// 상한을 넘으면 앞에서 버리되 **문자 경계**에서 자른다(멀티바이트 문자를 반토막 내지 않게).
pub(super) fn append_capped(buf: &mut String, s: &str) -> bool {
    buf.push_str(s);
    if buf.len() <= EXEC_OUTPUT_CAP {
        return false;
    }
    // 마지막 EXEC_OUTPUT_CAP 바이트를 남긴다 — 자를 지점을 문자 경계까지 앞으로 민다.
    let mut cut = buf.len() - EXEC_OUTPUT_CAP;
    while cut < buf.len() && !buf.is_char_boundary(cut) {
        cut += 1;
    }
    *buf = buf.split_off(cut);
    true
}

/// 살아 있는 SSH 핸들 위에 exec 채널을 하나 열어 `command` 를 돌린다 — **PTY 미요청**.
///
/// `Data`→stdout·`ExtendedData`→stderr 로 나눠 쌓고(tail 상한), `exit-status` 로 종료 코드를,
/// `Close`/전송로 소멸로 끝을 안다. `timeout` 을 넘기면 펌프를 멈추고 `timed_out` 으로 봉한다.
/// `cancel` 플래그가 서면 다음 확인점(≤[`CANCEL_POLL`])에서 멈추고 `cancelled` 로 봉한다.
///
/// **데드라인·취소는 채널 열기·exec 요청부터** 덮는다([`await_bounded`]) — 그 앞 단계가 hang 해도
/// 무방비가 아니다. split 뒤 **stdin 은 즉시 EOF** 로 닫아(비대화형 exec) 입력 대기 명령이 매달리지
/// 않게 한다.
///
/// ## 취소의 협력적 한계 (정직하게)
///
/// 취소는 **로컬 펌프를 멈추고 채널을 떨어뜨릴** 뿐이다. **원격에서 이미 시작된 명령은 계속
/// 돌 수 있다** — SSH 는 실행 중 프로세스를 죽일 표준 신호를 보장하지 않는다. 그래서 취소는
/// "결과를 더 기다리지 않는다" 는 뜻이지 "원격 작업이 멈췄다" 는 보장이 아니다. 이 사실은
/// 결과의 오류분류에도 그대로 남는다([`crate::operations`]).
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

/// [`run_exec`] 의 몸 — 이 프로세스가 쥔 러시 핸들 위에서(세션 서버 안).
pub(crate) async fn run_exec_direct(
    handle: SessionHandle,
    command: String,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> ExecOutcome {
    // 시작 전에 취소됐으면 채널조차 열지 않는다 — launched=false(아무것도 나가지 않았다).
    if cancel.load(Ordering::SeqCst) {
        return ExecAccum::default().into_outcome(false, true, false);
    }

    // 데드라인을 **가장 먼저** 잡는다 — 채널 열기·exec 요청 자체가 hang 해도 이 시한(과 취소
    // 플래그)이 덮는다. 예전엔 데드라인이 두 await 뒤에 걸려, 그 앞이 멈추면 타임아웃·취소가
    // 영영 적용되지 않았다.
    let deadline = tokio::time::Instant::now() + timeout;

    // 1) 채널 열기 — 시한·취소 아래에서. hang 이면 timed_out, 취소면 cancelled, 진짜 실패면 error.
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
        // 채널 열기 단계 — 아직 명령이 나가지 않았다(launched=false).
        Bounded::TimedOut => return ExecAccum::default().into_outcome(true, false, false),
        Bounded::Cancelled => return ExecAccum::default().into_outcome(false, true, false),
    };

    // 2) exec 요청 — 마찬가지로 시한·취소 아래에서(요청이 응답을 못 받아 매달려도 시한이 끊는다).
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
        // exec 요청이 ack 되기 전 — 명령이 아직 나가지 않았다(launched=false).
        Bounded::TimedOut => return ExecAccum::default().into_outcome(true, false, false),
        Bounded::Cancelled => return ExecAccum::default().into_outcome(false, true, false),
    }

    // 읽기 쪽만 취하고, **쓰기 쪽은 즉시 EOF** 로 닫는다 — 비대화형 exec 는 stdin 을 안 쓰므로
    // EOF 를 보내야 입력을 기다리는 명령이 데드라인까지 매달리지 않는다(`ChannelWriteHalf::eof`,
    // russh 0.63). best-effort — 실패해도 읽기 루프는 그대로 돈다. 그 뒤 writer 를 바로 드롭한다
    // (예전엔 `_writer` 를 함수 끝까지 들고 있어 EOF 가 늦었다). `ExtendedData` 는 stderr 로 따로.
    // EOF 보내기도 같은 데드라인·취소 아래에서 — russh 의 eof 는 세션 루프로 가는 mpsc send 라
    // 루프가 죽으면 멈출 수 있다. 시한에 걸리면 아래 루프가 곧바로 timed_out/cancelled 로 봉한다.
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
        // 취소 플래그를 자주 보되(≤CANCEL_POLL) 전체 타임아웃은 넘기지 않게 tick 을 잡는다.
        let tick = std::cmp::min(deadline, now + CANCEL_POLL);
        match tokio::time::timeout_at(tick, reader.wait()).await {
            Ok(Some(ChannelMsg::Data { data })) => accum.push_stdout(&data),
            Ok(Some(ChannelMsg::ExtendedData { data, .. })) => accum.push_stderr(&data),
            Ok(Some(ChannelMsg::ExitStatus { exit_status })) => accum.set_exit(exit_status as i64),
            // 정돈된 닫힘 = 끝. (Eof 뒤에 늦게 오는 exit-status 를 놓치지 않으려 Close 까지 읽는다.)
            Ok(Some(ChannelMsg::Close)) | Ok(None) => break,
            Ok(Some(_)) => {} // ExitSignal·Eof·창 조정 등 — exec 결과에는 쓰지 않는다.
            Err(_) => {}      // tick 경과 — 루프 위에서 취소·데드라인을 다시 본다.
        }
    }

    // 여기 도달했으면 exec 요청이 이미 ack 됐다 — 명령이 원격에 나갔다(launched=true). 이 뒤의
    // 취소·타임아웃은 "이미 시작된 명령"의 종료를 확인 못 한 것이라 상태 불명(Unknown)으로 분류된다.
    accum.into_outcome(timed_out, cancelled, true)
}

/// 취소 플래그를 다시 보는 주기 — exec 펌프가 이보다 오래 취소를 못 보고 있지 않게 한다.
const CANCEL_POLL: Duration = Duration::from_millis(200);

/// [`run_exec_bytes`] 의 산출물 — stdout 을 **바이트 그대로 · 앞에서부터** 쥔다.
#[derive(Default)]
pub(crate) struct ExecBytes {
    pub exit_code: Option<i64>,
    pub stdout: Vec<u8>,
    /// stderr — [`run_exec`] 과 같은 tail 상한의 글자.
    pub stderr: String,
    /// stdout 이 `max_stdout` 을 넘어 거기서 멈췄다(뒤는 버렸다 — 채널을 닫았다).
    pub overflow: bool,
    pub timed_out: bool,
    /// 채널을 열거나 exec 을 요청하지 못했다.
    pub error: Option<String>,
}

/// [`run_exec`] 의 **바이트 판** — 원격 파일의 머리·꼬리를 묶어 읽는 쪽(`crate::agent_sessions_remote`)이 쓴다.
///
/// 다른 점은 셋이다: stdout 을 손실 변환 없이 바이트로 쥐고, **앞에서부터** 쌓으며(tail 상한이 아니다 —
/// 경계 표식으로 가르는 출력이라 앞을 버리면 뜻이 없다), `max_stdout` 을 넘으면 그 자리에서 채널을 떨어뜨리고
/// `overflow` 로 봉한다. 취소 플래그는 없다(부르는 쪽이 시한만 쓴다). PTY 는 요청하지 않는다.
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

/// [`run_exec_bytes`] 의 몸 — 이 프로세스가 쥔 러시 핸들 위에서(세션 서버 안).
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
    // [`run_exec`] 과 같은 이유로 EOF 도 데드라인 아래에서(걸리면 아래 루프가 timed_out 으로 봉한다).
    let _ = await_bounded(writer.eof(), deadline, &never).await;
    drop(writer);
    // stderr 도 조각 경계에 걸린 글자를 이어 푼다([`CappedText`]).
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

/// [`await_bounded`] 결과 — 셋 중 하나.
pub(super) enum Bounded<T> {
    /// 미래가 값을 냈다.
    Ready(T),
    /// 데드라인을 넘겼다(단계가 hang).
    TimedOut,
    /// 취소 플래그가 섰다.
    Cancelled,
}

/// 미래 하나를 **데드라인과 취소 플래그** 아래에서 기다린다 — **순수 로직**(테스트 대상).
///
/// 읽기 루프와 같은 방식으로 취소를 자주(≤[`CANCEL_POLL`]) 확인하되 전체 데드라인은 넘기지
/// 않는다. [`run_exec`] 의 채널 열기·exec 요청을 감싸, 그 단계가 hang 해도 대상별 타임아웃·취소가
/// 먹게 한다(예전엔 데드라인이 그 뒤에 걸려 앞 단계 hang 이 무방비였다). 미래는 `timeout_at` 이
/// 소비하지 않게 핀으로 잡아 tick 마다 이어서 폴한다.
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
        // tick 경과 — 루프 위에서 취소·데드라인을 다시 본다.
    }
}
