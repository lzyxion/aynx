//! 세션 출력 경로의 공용 부품 — 수문 · 채널 슬롯 · 꼬리 링 · 전달 계수기 · 배처. 로컬 PTY 와 SSH 가 같은 배칭 · 역압 규칙을 쓴다.
//!
//! - 슬롯은 주 싱크 하나와 시청자 싱크 목록을 쥔다. 배처는 링에 적은 뒤 모두에게 같은 배치를 같은 잠금 안에서 나눈다(같은 순서의 바이트).
//!   **시청자 싱크의 send 가 실패하면 그 싱크만 뺀다** — 주 싱크는 실패해도 남는다. 수문을 세우는 것은 주의 크레딧뿐이다(`server::credit`).
//! - 서버 해석기(`crate::screen_mirror`)는 배처가 슬롯 잠금 **밖에서** 먹인다. 주 싱크를 빼면 거울 펜이 서버로, 꽂으면 창으로 간다(슬롯 잠금
//!   안에서는 원자 값만).
//! - 슬롯 · 꼬리 링 · 재생 · 배처는 **한 파일**에 둔다 — 링 기록 · 재생 · 싱크 교체 · 전송이 같은 슬롯 잠금을 쓰는 원자성이 이 파일의 계약이다.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};

mod gate;
mod queries;

pub(crate) use gate::Gate;
pub(crate) use queries::{next_carry, scan_queries, term_reply, TermQuery};

const BATCH_WINDOW: Duration = Duration::from_millis(4);
const BATCH_MAX_BYTES: usize = 64 * 1024;

// ---------------------------------------------------------------------------
// 출력 채널 슬롯
// ---------------------------------------------------------------------------

/// 배처가 `Channel` 을 직접 소유하면 그 세션의 출력이 연 창에 영구히 묶인다 — 한 겹을 씌워 재부착이 통째로 갈아 끼운다.
/// 채널이 비었으면 배치를 **버린다**(꼬리 링에만 적는다) — Rust 쪽에 쌓아 두면 역압 설계가 무너진다.
/// 링을 채널과 **같은 뮤텍스**에 둔다 — 배처의 "적고 보낸다" 와 재부착의 재생이 서로를 배제해 재생 바이트가 실시간보다 늦을 수 없다.
pub(crate) type OutputSlot = Arc<Mutex<SlotState>>;

pub(crate) struct SlotState {
    channel: Option<Box<dyn OutputSink>>,
    viewers: Vec<(u64, Box<dyn OutputSink>)>,
    /// `session_core` 의 크기 주인(`size_owner`)과 같아야 한다.
    responder: Responder,
    tail: TailRing,
    tap: Option<Arc<crate::screen_mirror::Tap>>,
}

/// 터미널 질의(DSR · DA · DECRQM · OSC 10/11)에 답하는 쪽 — 세션 코어의 크기 주인과 같다. 서버는 이 쪽이 지금 싱크를 꽂고 있지 않을 때만
/// 대신 답한다 — 둘이 답하면 남는 답이 셸 입력으로 샌다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Responder {
    Primary,
    Viewer(u64),
    Server,
}

impl SlotState {
    fn client_answers(&self) -> bool {
        match self.responder {
            Responder::Primary => self.channel.is_some(),
            Responder::Viewer(e) => self.viewers.iter().any(|(k, _)| *k == e),
            Responder::Server => false,
        }
    }
}

/// `offset` 은 그 바이트의 첫 오프셋(꼬리 링 축) — 채널은 버리고 파이프는 출력 프레임 머리에 싣는다.
/// 슬롯 잠금 안에서 불린다 — 막히지 않아야 한다(파이프 쪽은 무한 큐 + 크레딧으로 묶는다).
pub(crate) trait OutputSink: Send {
    fn send(&self, offset: u64, bytes: Vec<u8>) -> Result<(), String>;
}

impl OutputSink for Channel<InvokeResponseBody> {
    fn send(&self, _offset: u64, bytes: Vec<u8>) -> Result<(), String> {
        Channel::send(self, InvokeResponseBody::Raw(bytes)).map_err(|e| e.to_string())
    }
}

pub(crate) fn output_slot(channel: Option<Box<dyn OutputSink>>) -> OutputSlot {
    Arc::new(Mutex::new(SlotState {
        channel,
        viewers: Vec::new(),
        responder: Responder::Primary,
        tail: TailRing::default(),
        tap: None,
    }))
}

/// 지금까지 링에 적힌 바이트로 먼저 따라잡는다 — **해석기 잠금을 먼저** 쥐고 슬롯 잠금 안에서 링을 베끼며 꽂으므로 배처의 다음 배치는
/// 따라잡기 뒤에 먹는다.
pub(crate) fn set_tap(slot: &OutputSlot, tap: Arc<crate::screen_mirror::Tap>) {
    let mut interp = tap.interp_guard();
    let seed = {
        let mut state = slot.lock().unwrap();
        let from = if state.tail.base() == 0 { 0 } else { state.tail.safe_base() };
        let seed = state.tail.since(from).unwrap_or_default();
        // 펜은 창의 것으로 시작한다 — SSH 는 꽂는 순간 아직 주 싱크가 없지만 곧 열기가 꽂는다.
        state.tap = Some(Arc::clone(&tap));
        seed
    };
    let _ = interp.feed(&seed);
}

/// 슬롯 잠금은 해석기 잠금 전에 놓는다.
pub(crate) fn resize_tap(slot: &OutputSlot, cols: u16, rows: u16) {
    let tap = slot.lock().unwrap().tap.clone();
    if let Some(tap) = tap {
        tap.resize(cols, rows);
    }
}

pub(crate) fn set_responder(slot: &OutputSlot, responder: Responder) {
    slot.lock().unwrap().responder = responder;
}

pub(crate) fn remove_viewer_output(slot: &OutputSlot, epoch: u64) -> bool {
    let mut state = slot.lock().unwrap();
    let before = state.viewers.len();
    state.viewers.retain(|(k, _)| *k != epoch);
    state.viewers.len() != before
}

#[cfg(test)]
pub(crate) fn viewer_sinks(slot: &OutputSlot) -> Vec<u64> {
    slot.lock().unwrap().viewers.iter().map(|(k, _)| *k).collect()
}

/// 배처는 이 뒤로 배치를 어디에도 보내지 않지만 **꼬리 링에는 계속 적는다** — 다음에 붙는 창이 재생한다.
pub(crate) fn clear_output(slot: &OutputSlot) {
    let mut state = slot.lock().unwrap();
    state.channel = None;
    // 이 뒤로 거울은 서버 해석기가 잇는다(원자 값만).
    if let Some(tap) = &state.tap {
        tap.on_detach();
    }
}

fn primary_plugged(state: &SlotState) {
    if let Some(tap) = &state.tap {
        tap.on_attach();
    }
}

pub(crate) fn produced(slot: &OutputSlot) -> u64 {
    slot.lock().unwrap().tail.end
}

pub(crate) fn last_output_ms(slot: &OutputSlot) -> Option<u64> {
    let at = slot.lock().unwrap().tail.last_at_ms;
    (at > 0).then_some(at)
}

pub(crate) fn swap_output(slot: &OutputSlot, next: impl OutputSink + 'static) {
    let mut state = slot.lock().unwrap();
    state.channel = Some(Box::new(next));
    primary_plugged(&state);
}

// ---------------------------------------------------------------------------
// 꼬리 링
// ---------------------------------------------------------------------------

pub(crate) const TAIL_CAP: usize = 256 * 1024;

/// 세션 출력의 마지막 [`TAIL_CAP`] 바이트와 그 절대 오프셋. 이관은 dragstart 에 화면을 뜨고 재부착은 놓은 뒤에야 와서 그 사이 출력이
/// 사라진다(SSH 는 재그림으로 덮이지 않는다) — 그래서 `[consumed, end)` 를 새 채널에 먼저 흘린다.
/// 오프셋 축은 **"배처가 생산한 순서"** 하나다 — 채널이 비어도 · send 가 실패해도 적는다. 프런트(`Terminal.svelte`)는 0 에서 센다.
/// [`OutputStats`] 는 "채널로 **시도한** 전송" 만 센다(진단의 짝이 프런트의 받은 수라서).
#[derive(Debug, Default)]
pub(crate) struct TailRing {
    buf: VecDeque<u8>,
    end: u64,
    last_at_ms: u64,
}

const BOUNDARY_WINDOW: usize = 64 * 1024;

const fn is_continuation(b: u8) -> bool {
    b & 0xC0 == 0x80
}

/// `bytes` 를 바닥 상태에서 읽어 끝에 끝나지 않은 이스케이프 시퀀스 · UTF-8 글자가 걸려 있으면 그 시작 인덱스.
/// VT 파서의 큰 갈래만 따른다(xterm 과 같은 끝맺음 · CAN/SUB 는 시퀀스를 끊고 시퀀스 안의 C0 는 시퀀스를 잇는다).
pub(crate) fn open_sequence_start(bytes: &[u8]) -> Option<usize> {
    #[derive(Clone, Copy)]
    enum S {
        Ground,
        Utf8 { need: u8 },
        Esc,
        EscInter,
        Csi,
        Str { osc: bool },
        StrEsc,
    }
    let mut s = S::Ground;
    let mut start = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        s = match s {
            S::Ground => match b {
                0x1b => {
                    start = i;
                    S::Esc
                }
                0xC2..=0xDF => {
                    start = i;
                    S::Utf8 { need: 1 }
                }
                0xE0..=0xEF => {
                    start = i;
                    S::Utf8 { need: 2 }
                }
                0xF0..=0xF4 => {
                    start = i;
                    S::Utf8 { need: 3 }
                }
                _ => S::Ground,
            },
            S::Utf8 { need } => {
                if is_continuation(b) {
                    if need == 1 {
                        S::Ground
                    } else {
                        S::Utf8 { need: need - 1 }
                    }
                } else {
                    // 깨진 글자 — 이 바이트를 바닥에서 다시 읽는다.
                    s = S::Ground;
                    continue;
                }
            }
            S::Esc => match b {
                b'[' => S::Csi,
                b']' => S::Str { osc: true },
                b'P' | b'X' | b'^' | b'_' => S::Str { osc: false },
                0x1b => {
                    start = i;
                    S::Esc
                }
                0x18 | 0x1a => S::Ground,
                0x20..=0x2F => S::EscInter,
                0x30..=0x7E => S::Ground,
                _ => S::Esc,
            },
            S::EscInter => match b {
                0x20..=0x2F => S::EscInter,
                0x30..=0x7E | 0x18 | 0x1a => S::Ground,
                0x1b => {
                    start = i;
                    S::Esc
                }
                _ => S::EscInter,
            },
            S::Csi => match b {
                0x40..=0x7E | 0x18 | 0x1a => S::Ground,
                0x1b => {
                    start = i;
                    S::Esc
                }
                _ => S::Csi,
            },
            S::Str { osc } => match b {
                0x07 if osc => S::Ground,
                0x18 | 0x1a => S::Ground,
                0x1b => S::StrEsc,
                _ => S::Str { osc },
            },
            // 문자열 안의 ESC — `\` 면 끝(ST), 아니면 새 시퀀스의 시작(xterm 도 문자열을 버리고 새로 읽는다).
            S::StrEsc => match b {
                b'\\' => S::Ground,
                _ => {
                    start = i - 1;
                    s = S::Esc;
                    continue;
                }
            },
        };
        i += 1;
    }
    match s {
        S::Ground => None,
        _ => Some(start),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplayRefusal {
    Overrun { consumed: u64, base: u64 },
    Ahead { consumed: u64, end: u64 },
}

impl std::fmt::Display for ReplayRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplayRefusal::Overrun { consumed, base } => {
                write!(f, "overrun (consumed {consumed} < base {base})")
            }
            ReplayRefusal::Ahead { consumed, end } => {
                write!(f, "ahead (consumed {consumed} > end {end})")
            }
        }
    }
}

impl TailRing {
    fn base(&self) -> u64 {
        self.end - self.buf.len() as u64
    }

    fn record(&mut self, bytes: &[u8]) {
        if !bytes.is_empty() {
            self.last_at_ms = crate::session_core::now_ms();
        }
        self.end += bytes.len() as u64;
        if bytes.len() >= TAIL_CAP {
            self.buf.clear();
            self.buf.extend(&bytes[bytes.len() - TAIL_CAP..]);
            return;
        }
        let over = (self.buf.len() + bytes.len()).saturating_sub(TAIL_CAP);
        self.buf.drain(..over);
        self.buf.extend(bytes);
    }

    /// `from` · `to` 둘 다 링 안이어야 한다.
    fn range(&self, from: u64, to: u64) -> Vec<u8> {
        let base = self.base();
        self.buf
            .iter()
            .skip((from - base) as usize)
            .take((to - from) as usize)
            .copied()
            .collect()
    }

    /// 창의 소비 오프셋은 배치 경계라 시퀀스 한가운데일 수 있다 — 거기서 재생하면 시퀀스 꼬리(`2;120;200m`)가 글자로 찍히므로 끝나지 않은
    /// 시퀀스 · 글자의 시작으로 당긴다. 시작이 링 밖이면 그대로.
    fn pull_back(&self, consumed: u64) -> u64 {
        let base = self.base();
        if consumed <= base || consumed > self.end {
            return consumed;
        }
        let from = consumed.saturating_sub(BOUNDARY_WINDOW as u64).max(base);
        let window = self.range(from, consumed);
        // 바닥 상태라고 믿을 수 있는 자리 — 창 안 마지막 줄바꿈 뒤(CSI·글자는 줄바꿈을 넘지 않는다). 없으면 창 처음.
        let ground = window.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        match open_sequence_start(&window[ground..]) {
            Some(i) => from + (ground + i) as u64,
            None => consumed,
        }
    }

    /// 링 첫 바이트는 바이트 수로 잘린 아무 자리다 — 줄 시작 → 시퀀스 시작(문자열 끝 `ESC \` 은 빼고) → 글자 시작 순으로 민다.
    /// 민 만큼도 잃은 바이트다(부른 쪽이 센다).
    fn safe_base(&self) -> u64 {
        let base = self.base();
        let window = self.range(base, (base + BOUNDARY_WINDOW as u64).min(self.end));
        let at = if let Some(i) = window.iter().position(|&b| b == b'\n') {
            i + 1
        } else if let Some(i) =
            (0..window.len()).find(|&i| window[i] == 0x1b && window.get(i + 1) != Some(&b'\\'))
        {
            i
        } else {
            window
                .iter()
                .position(|&b| !is_continuation(b))
                .unwrap_or(window.len())
        };
        base + at as u64
    }

    fn since(&self, consumed: u64) -> Result<Vec<u8>, ReplayRefusal> {
        let base = self.base();
        if consumed < base {
            return Err(ReplayRefusal::Overrun { consumed, base });
        }
        if consumed > self.end {
            return Err(ReplayRefusal::Ahead {
                consumed,
                end: self.end,
            });
        }
        Ok(self.buf.iter().skip((consumed - base) as usize).copied().collect())
    }
}

/// 프런트(`reattachSession`)가 받는 모양.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Reattached {
    /// 프런트는 여기서부터 세어 다음 이관의 `consumed` 를 낸다.
    pub start: u64,
    pub replayed: bool,
    pub reason: Option<String>,
    /// 이 창이 새로 받은 임대 — 이 뒤의 write · resize · close 는 이 값을 싣는다.
    pub lease: Option<crate::session_core::Keys>,
}

/// `consumed` 가 있으면 링의 `[consumed, end)` 를 새 채널로 먼저 보낸다 — 한 잠금 안이라 순서는 늘 "재생 꼬리 → 실시간" 이고 빈틈 · 겹침이
/// 없다. 거절 · 전송 실패면 재생 없이 갈아 끼운다. 재생 바이트는 링 · [`OutputStats`] 에 다시 적지 않는다.
pub(crate) fn swap_output_replaying(
    slot: &OutputSlot,
    next: impl OutputSink + 'static,
    consumed: Option<u64>,
) -> Reattached {
    let mut state = slot.lock().unwrap();
    let end = state.tail.end;
    let mut out = Reattached {
        start: end,
        replayed: false,
        reason: None,
        lease: None,
    };
    if let Some(consumed) = consumed {
        let consumed = state.tail.pull_back(consumed);
        match state.tail.since(consumed) {
            Ok(bytes) => {
                let sent = if bytes.is_empty() {
                    Ok(())
                } else {
                    next.send(consumed, bytes)
                };
                match sent {
                    Ok(()) => {
                        out.start = consumed;
                        out.replayed = true;
                    }
                    Err(e) => out.reason = Some(format!("send failed: {e}")),
                }
            }
            Err(refusal) => out.reason = Some(refusal.to_string()),
        }
    }
    state.channel = Some(Box::new(next));
    primary_plugged(&state);
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttachReplay {
    pub start: u64,
    /// 이 뒤는 실시간이다(프런트가 재생 표시를 끄는 기준).
    pub end: u64,
    pub contiguous: bool,
    /// 프런트 배너 "출력 일부 유실(N KiB)".
    pub overrun_bytes: u64,
}

/// 붙기 판 — 거절하지 않는다: 링이 넘쳤어도 남은 것을 재생하고 잃은 바이트를 센다. `consumed > end`(축 어긋남)면 재생 없이 `end` 에서 시작.
pub(crate) fn attach_output(
    slot: &OutputSlot,
    next: impl OutputSink + 'static,
    consumed: u64,
) -> AttachReplay {
    let mut state = slot.lock().unwrap();
    let out = replay_into(&state, &next, consumed);
    state.channel = Some(Box::new(next));
    primary_plugged(&state);
    out
}

pub(crate) fn attach_viewer_output(
    slot: &OutputSlot,
    epoch: u64,
    next: impl OutputSink + 'static,
    consumed: u64,
) -> AttachReplay {
    let mut state = slot.lock().unwrap();
    let out = replay_into(&state, &next, consumed);
    state.viewers.retain(|(k, _)| *k != epoch);
    state.viewers.push((epoch, Box::new(next)));
    out
}

/// 슬롯 잠금을 쥔 채 부른다(꽂기는 부른 쪽).
fn replay_into(state: &SlotState, next: &dyn OutputSink, consumed: u64) -> AttachReplay {
    let end = state.tail.end;
    let base = state.tail.base();
    let (from, overrun_bytes) = if consumed < base {
        let safe = state.tail.safe_base();
        (safe, safe - consumed)
    } else {
        (state.tail.pull_back(consumed), 0)
    };
    let mut out = AttachReplay {
        start: end,
        end,
        contiguous: false,
        overrun_bytes,
    };
    if from <= end {
        let bytes: Vec<u8> = state
            .tail
            .buf
            .iter()
            .skip((from - base) as usize)
            .copied()
            .collect();
        let sent = if bytes.is_empty() {
            Ok(())
        } else {
            next.send(from, bytes)
        };
        if sent.is_ok() {
            out.start = from;
            out.contiguous = overrun_bytes == 0;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 출력 전달 계수기
// ---------------------------------------------------------------------------

/// 진단용 — 데이터 경로에 영향이 없다. "타일이 검다" 의 두 원인을 가린다: Rust 가 안 보냈다(`sent_chunks == 0`) · IPC 유실
/// (`sent_chunks > 0` 인데 프런트의 `received == 0`). (docs/log/2026-09-05-silent-session-selfheal.md)
#[derive(Debug, Default)]
pub(crate) struct OutputStats {
    sent_chunks: AtomicU64,
    sent_bytes: AtomicU64,
    send_failures: AtomicU64,
    last_error: Mutex<Option<String>>,
}

impl OutputStats {
    fn sent(&self, bytes: usize) {
        self.sent_chunks.fetch_add(1, Ordering::Relaxed);
        self.sent_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    fn failed(&self, err: String) {
        self.send_failures.fetch_add(1, Ordering::Relaxed);
        *self.last_error.lock().unwrap() = Some(err);
    }

    pub(crate) fn snapshot(&self) -> SessionStats {
        SessionStats {
            sent_chunks: self.sent_chunks.load(Ordering::Relaxed),
            sent_bytes: self.sent_bytes.load(Ordering::Relaxed),
            send_failures: self.send_failures.load(Ordering::Relaxed),
            last_error: self.last_error.lock().unwrap().clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SessionStats {
    /// 실패한 것도 시도로 센다.
    pub sent_chunks: u64,
    pub sent_bytes: u64,
    /// 0 이 아니면 그 세션은 이미 침묵이다(채널 번호에 빈칸이 생겼다).
    pub send_failures: u64,
    pub last_error: Option<String>,
}

/// 표식은 그 앞의 덩어리를 전부 링에 적은 뒤 그 순간의 링 끝을 돌려준다 — 종료를 배처 **뒤로** 정렬하는 길이다.
pub(crate) enum Chunk {
    Data(Vec<u8>),
    Mark(mpsc::Sender<u64>),
}

impl From<Vec<u8>> for Chunk {
    fn from(bytes: Vec<u8>) -> Self {
        Chunk::Data(bytes)
    }
}

/// 배처가 끝났거나 `wait` 안에 답이 없으면 슬롯에서 직접 읽는다(근사 — 기록용 값이라 막히지 않는 편이 낫다).
pub(crate) fn flush_mark(tx: &mpsc::Sender<Chunk>, slot: &OutputSlot, wait: Duration) -> u64 {
    let (reply, answer) = mpsc::channel::<u64>();
    if tx.send(Chunk::Mark(reply)).is_ok() {
        if let Ok(end) = answer.recv_timeout(wait) {
            return end;
        }
    }
    produced(slot)
}

/// 채널을 소유하지 않고 [`OutputSlot`] 에서 배치마다 꺼내 쓴다. **전송 실패로 루프를 끊지 않는다** — 끊으면 창을 옮긴 세션이 새 창에서
/// 영영 벙어리가 된다. 종료 조건은 생산자가 사라지는 것(`rx.recv()` 실패) 하나뿐이다.
pub(crate) fn spawn_batcher<T: Into<Chunk> + Send + 'static>(
    rx: mpsc::Receiver<T>,
    output: OutputSlot,
    stats: Arc<OutputStats>,
) {
    spawn_batcher_with(rx, output, stats, None);
}

/// 손은 PTY 에 **직접** 쓴다 — 사람이 친 입력의 길(`write` op)을 타지 않으므로 사람 개입으로 세지 않는다.
pub(crate) type QueryHook = Box<dyn Fn(Vec<TermQuery>) + Send>;

/// 붙은 창이 없는 동안 배치의 터미널 질의에 `answer` 를 부른다 — 안 답하면 셸(PSReadLine) · TUI(Claude Code)가 답을 기다리며 멈춘다.
/// 붙어 있으면 창의 xterm 이 답한다(두 번 답하면 남는 답이 셸 입력으로 샌다).
pub(crate) fn spawn_batcher_with<T: Into<Chunk> + Send + 'static>(
    rx: mpsc::Receiver<T>,
    output: OutputSlot,
    stats: Arc<OutputStats>,
    answer: Option<QueryHook>,
) {
    std::thread::spawn(move || {
        let mut carry: Vec<u8> = Vec::new();
        // 전송 실패는 세션당 한 번만 알린다 — Tauri 채널은 번호가 보내기 전에 올라가고 JS 는 빠진 번호를 영원히 기다려, 실패 하나가 그 터미널을
        // 영구 침묵으로 만든다. 창을 닫은 뒤의 실패는 정상이라 한 줄만(docs/log/2026-09-05-multi-local-open.md).
        let mut warned = false;
        while let Ok(first) = rx.recv() {
            let mut batch = match first.into() {
                Chunk::Data(bytes) => bytes,
                // 모아 둔 것이 없다 — 지금의 링 끝이 곧 답이다.
                Chunk::Mark(reply) => {
                    let _ = reply.send(output.lock().unwrap().tail.end);
                    continue;
                }
            };
            // 배치를 모으는 중에 온 표식 — 이 배치를 내보낸 **뒤에** 답한다.
            let mut mark: Option<mpsc::Sender<u64>> = None;
            let deadline = Instant::now() + BATCH_WINDOW;
            while batch.len() < BATCH_MAX_BYTES {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match rx.recv_timeout(deadline - now).map(Into::into) {
                    Ok(Chunk::Data(chunk)) => batch.extend_from_slice(&chunk),
                    Ok(Chunk::Mark(reply)) => {
                        mark = Some(reply);
                        break;
                    }
                    Err(_) => break,
                }
            }
            let mut slot = output.lock().unwrap();
            let client_answers = slot.client_answers();
            // 서버 해석기 몫(사본) — 슬롯 잠금 밖에서 먹인다(해석이 출력 전달을 늦추지 않게).
            let tap = slot.tap.clone();
            let tap_bytes = tap.as_ref().map(|_| batch.clone());
            let SlotState { channel, viewers, tail, .. } = &mut *slot;
            // 꼬리 링은 **채널이 없어도** 적는다 — 같은 잠금 안이라 재부착 · 붙기의 재생과 서로를 배제한다.
            let offset = tail.end;
            tail.record(&batch);
            let end = tail.end;
            // 질의는 **붙은 창이 없을 때만** 대신 답한다(잠금 밖에서). carry 는 채널과 무관하게 이어 간다.
            let mut unanswered = if answer.is_some() && !client_answers {
                scan_queries(&carry, &batch)
            } else {
                Vec::new()
            };
            // 스트림 맨 앞의 커서 위치 질의 = ConPTY 의 커서 상속 질의 — 빈 화면이라 `1;1`([`TermQuery::DsrStart`]).
            if offset == 0 && batch.starts_with(b"\x1b[6n") {
                if let Some(q) = unanswered.first_mut() {
                    if *q == TermQuery::Dsr {
                        *q = TermQuery::DsrStart;
                    }
                }
            }
            if answer.is_some() {
                carry = next_carry(&carry, &batch);
            }
            // 실패한 시청자 싱크는 뺀다(그 시청자는 다시 붙어 재동기화한다). 주와 같은 배치 · 같은 오프셋.
            viewers.retain(|(_, sink)| sink.send(offset, batch.clone()).is_ok());
            if let Some(channel) = channel.as_ref() {
                let bytes = batch.len();
                // 성공 · 실패와 무관하게 **시도한 것**을 센다 — 프런트의 "받은 수" 와 짝이라, 실패를 빼면 IPC 유실을 가릴 수 없다.
                stats.sent(bytes);
                if let Err(err) = channel.send(offset, batch) {
                    if !warned {
                        warned = true;
                        eprintln!(
                            "[aynx] 출력 채널 전송 실패 — 이 세션의 이후 출력이 웹뷰에 닿지 않을 수 있습니다: {err}"
                        );
                    }
                    stats.failed(err);
                }
            }
            drop(slot);
            if let (Some(tap), Some(bytes)) = (tap, tap_bytes) {
                tap.feed(&bytes);
            }
            if !unanswered.is_empty() {
                if let Some(hook) = &answer {
                    hook(unanswered);
                }
            }
            if let Some(reply) = mark {
                let _ = reply.send(end);
            }
        }
    });
}

#[cfg(test)]
#[path = "output/tests/gate.rs"]
mod gate_tests;

#[cfg(test)]
#[path = "output/tests/slot.rs"]
mod output_slot_tests;

#[cfg(test)]
#[path = "output/tests/tail.rs"]
mod tail_ring_tests;

#[cfg(test)]
#[path = "output/tests/viewers.rs"]
mod viewer_tests;
