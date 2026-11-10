//! 세션 출력 경로의 공용 부품 — 수문([`Gate`]) · 채널 슬롯([`OutputSlot`] — 이관 재생용 꼬리 링
//! [`TailRing`] 을 함께 쥔다) · 전달 계수기([`OutputStats`]) · 배처([`spawn_batcher`]).
//!
//! 로컬 PTY(`pty.rs`)와 SSH(`ssh.rs`) 두 세션 종류가 같은 배칭·역압 규칙을 쓰려고 나눠 갖는
//! 것들이다. 출력이 가는 곳은 [`OutputSink`] 하나로 가린다 — GUI 안의 SSH 는 웹뷰 `Channel`, 세션 서버 안의 로컬 PTY
//! (③-2)는 파이프 연결(`server::sessions` 의 연결 싱크 — 오프셋을 실은 출력 프레임 + ACK 크레딧)이다. 어느 한 세션 종류의 상태도 알지 않으므로 세션 층 **아래**에 둔다 — 원래 `pty.rs`
//! 에 있었는데 그 탓에 `ssh` 가 `pty` 에 기대는 간선이 생겼다.
//!
//! **싱크는 여럿이다**(원격 웹 R2-A — `crate::session_core` 의 시청자): 슬롯은 **주 싱크 하나**(예전의 그 채널 — 주 임대의 것,
//! [`swap_output`]·[`attach_output`]·[`clear_output`] 이 다룬다)와 **시청자 싱크 목록**([`attach_viewer_output`]·
//! [`remove_viewer_output`])을 쥔다. 배처는 링에 적은 뒤 주와 시청자 모두에게 같은 배치를 나눈다 — 같은 잠금 안이라 모두 같은 순서의
//! 바이트를 받는다. **시청자 싱크의 send 가 실패하면 그 싱크만 뺀다**(예산 초과 · 연결 끊김 — 주 싱크는 예전처럼 실패해도 남는다).
//! 수문([`Gate`])을 세우는 것은 여전히 주의 크레딧뿐이다(`server::credit`). 터미널 질의에 서버가 대신 답할지는 [`Responder`] 가 정한다.
//!
//! **서버 해석기**(2026-11-09 — `crate::screen_mirror`): 슬롯은 세션의 해석기 하나를 쥐고([`set_tap`]), 배처는 링에 적은 배치의 사본을 슬롯 잠금
//! **밖에서** 먹인다. 주 싱크를 빼면([`clear_output`]) 거울 펜이 서버로, 꽂으면([`swap_output`] · [`attach_output`] · [`swap_output_replaying`]) 창으로
//! 간다(슬롯 잠금 안에서는 원자 값만).
//!
//! 조각: 수문 [`Gate`] 는 `output/gate.rs`, 터미널 질의 해석 · 답 내용은 `output/queries.rs`(순수 — 대답 손은 여기 배처가 슬롯 잠금 밖에서 부른다). 슬롯 ·
//! 꼬리 링 · 재생 · 배처는 **한 파일**에 둔다 — 링 기록 · 재생 · 싱크 교체 · 전송이 같은 슬롯 잠금을 쓰는 원자성이 이 파일의 계약이다.
//! 시험은 `output/tests/`(수문 · 슬롯 · 꼬리 링 · 시청자는 모듈 이름 예전 그대로 · 질의 시험은 `queries::dsr_tests`).

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

// 출력 배칭: 4ms 또는 64KB 단위로 묶어 웹뷰로 넘긴다 (설계안 "터미널 데이터 경로").
const BATCH_WINDOW: Duration = Duration::from_millis(4);
const BATCH_MAX_BYTES: usize = 64 * 1024;

// ---------------------------------------------------------------------------
// 출력 채널 슬롯 (창 간 이관 — docs/log/2026-09-02-tear-out.md)
// ---------------------------------------------------------------------------

/// 배처가 **지금** 바이트를 흘려보낼 웹뷰 채널 + 그 세션 출력의 꼬리 링([`TailRing`]).
///
/// 배처가 `Channel` 을 직접 소유하면 그 세션의 출력은 **연 창에 영구히 묶인다** —
/// 탭을 다른 창으로 옮겨도 바이트는 옛 웹뷰로 계속 간다. 그래서 한 겹을 씌워
/// [`crate::handoff::reattach_output`] 이 통째로 갈아 끼울 수 있게 한다.
///
/// **잠금 비용은 무시할 수 있다** — 배처는 4ms/64KB 로 묶은 **배치 하나마다 한 번**
/// 잠그지, 청크마다 잠그지 않는다 (초당 최대 250회 수준). 경합 상대도 이관 명령
/// 하나뿐이고 그것도 사람 손 속도다.
/// 채널은 비어 있을 수 있다 — 세션이 열리는 중이거나(아직 채널을 못 꽂았다) 붙어 있던 창이
/// 사라진 직후다. 비었으면 배치를 **버린다**: 되돌려 줄 곳이 없는 바이트를 Rust 쪽에
/// 쌓아 두면 역압 설계가 무너진다. (꼬리 링은 예외 하나 — 상한이 있는 **재생용 사본**이지
/// 대기열이 아니다. 아래.)
///
/// 링을 채널과 **같은 뮤텍스**에 두는 것이 이 구조의 전부다: 배처의 "링에 적고 보낸다" 와
/// 재부착의 "링 꼬리를 새 채널로 먼저 보내고 갈아 끼운다"([`swap_output_replaying`])가 한
/// 잠금 안에서 서로를 배제하므로, 새 채널에서 재생 바이트가 실시간보다 늦을 수 없다.
pub(crate) type OutputSlot = Arc<Mutex<SlotState>>;

/// [`OutputSlot`] 의 알맹이.
pub(crate) struct SlotState {
    /// 주 싱크(주 임대의 것) — 비면 배치를 주에게는 보내지 않는다.
    channel: Option<Box<dyn OutputSink>>,
    /// 시청자 싱크 — `(임대 회차, 싱크)`, 붙은 순서. send 가 실패한 것은 배처가 뺀다.
    viewers: Vec<(u64, Box<dyn OutputSink>)>,
    /// 터미널 질의에 누가 답하나(크기 주인 — `session_core` 의 `size_owner`).
    responder: Responder,
    tail: TailRing,
    /// 서버 해석기(2026-11-09 — `crate::screen_mirror`) — 배처가 배치마다 먹인다(슬롯 잠금 밖에서). 주 싱크가 빠지고 꽂힐 때 거울 펜을 넘긴다.
    tap: Option<Arc<crate::screen_mirror::Tap>>,
}

/// 터미널 질의(DSR·DA·DECRQM·OSC 10/11)에 답하는 쪽 — 세션 코어의 **크기 주인**과 같다(`session_core::viewers` 머리말).
/// 서버(배처의 대답 손)는 이 쪽이 지금 슬롯에 싱크를 꽂고 있지 않을 때만 대신 답한다 — 둘이 답하면 남는 답이 셸 입력으로 샌다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Responder {
    /// 주(기본 — 예전 "붙은 창이 답한다" 그대로: 주 싱크가 없으면 서버가 답한다).
    Primary,
    /// 그 임대 회차의 시청자.
    Viewer(u64),
    /// 자격 있는 붙은 쪽이 없다 — 서버가 답한다.
    Server,
}

impl SlotState {
    /// 지금 꽂힌 싱크 중 질의에 답할 쪽이 있나.
    fn client_answers(&self) -> bool {
        match self.responder {
            Responder::Primary => self.channel.is_some(),
            Responder::Viewer(e) => self.viewers.iter().any(|(k, _)| *k == e),
            Responder::Server => false,
        }
    }
}

/// 배치가 흘러가는 곳 — 웹뷰 채널(GUI 안의 SSH) 또는 파이프 연결(세션 서버의 로컬 PTY · `server::sessions`).
/// `offset` 은 그 바이트의 첫 오프셋(꼬리 링 축)이다 — 채널은 버리고, 파이프는 출력 프레임 머리에 싣는다.
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

/// 서버 해석기를 꽂는다(세션 열기 — `crate::screen_mirror::install`). 지금까지 링에 적힌 바이트(SSH 는 꽂기 전의 보안 알림 · 첫 프롬프트)로
/// 먼저 따라잡는다 — **해석기 잠금을 먼저** 쥐고 슬롯 잠금 안에서 링을 베끼며 꽂으므로, 배처의 다음 배치는 따라잡기 뒤에 먹는다.
pub(crate) fn set_tap(slot: &OutputSlot, tap: Arc<crate::screen_mirror::Tap>) {
    let mut interp = tap.interp_guard();
    let seed = {
        let mut state = slot.lock().unwrap();
        let from = if state.tail.base() == 0 { 0 } else { state.tail.safe_base() };
        let seed = state.tail.since(from).unwrap_or_default();
        // 펜은 창의 것으로 시작한다 — SSH 는 꽂는 순간 아직 주 싱크가 없지만 곧 열기가 꽂는다(그 전엔 거울 항목도 없다).
        state.tap = Some(Arc::clone(&tap));
        seed
    };
    let _ = interp.feed(&seed);
}

/// 서버 해석기의 크기를 바꾼다(PTY · 원격 창의 크기가 바뀐 뒤 — 슬롯 잠금은 해석기 잠금 전에 놓는다).
pub(crate) fn resize_tap(slot: &OutputSlot, cols: u16, rows: u16) {
    let tap = slot.lock().unwrap().tap.clone();
    if let Some(tap) = tap {
        tap.resize(cols, rows);
    }
}

/// 질의에 답하는 쪽을 바꾼다(세션 서버가 크기 주인 노트를 비우며).
pub(crate) fn set_responder(slot: &OutputSlot, responder: Responder) {
    slot.lock().unwrap().responder = responder;
}

/// 시청자 싱크를 뺀다(제 손으로 뗌 · 창 · 연결 · 예산 초과 · 세션 끝). 있었으면 `true`.
pub(crate) fn remove_viewer_output(slot: &OutputSlot, epoch: u64) -> bool {
    let mut state = slot.lock().unwrap();
    let before = state.viewers.len();
    state.viewers.retain(|(k, _)| *k != epoch);
    state.viewers.len() != before
}

/// 지금 꽂힌 시청자 싱크의 회차들(시험).
#[cfg(test)]
pub(crate) fn viewer_sinks(slot: &OutputSlot) -> Vec<u64> {
    slot.lock().unwrap().viewers.iter().map(|(k, _)| *k).collect()
}

/// 슬롯의 채널을 비운다 — 붙은 창이 떠났다(`crate::session_core` 의 detach). 배처는 이 뒤로 배치를
/// 어디에도 보내지 않지만 **꼬리 링에는 계속 적는다**([`spawn_batcher`]) — 다음에 붙는 창이 재생한다.
pub(crate) fn clear_output(slot: &OutputSlot) {
    let mut state = slot.lock().unwrap();
    state.channel = None;
    // 붙은 창이 없다 — 이 뒤로 거울은 서버 해석기가 잇는다(`crate::screen_mirror` · 원자 값만).
    if let Some(tap) = &state.tap {
        tap.on_detach();
    }
}

/// 주 싱크를 꽂았다 — 거울은 다시 창(프런트)의 것이다.
fn primary_plugged(state: &SlotState) {
    if let Some(tap) = &state.tap {
        tap.on_attach();
    }
}

/// 꼬리 링의 끝 = 지금까지 **생산된** 바이트 수.
pub(crate) fn produced(slot: &OutputSlot) -> u64 {
    slot.lock().unwrap().tail.end
}

/// 마지막 출력 시각(epoch ms) — 아직 아무것도 안 나왔으면 `None`(떨어진 세션 목록 · ③-4).
pub(crate) fn last_output_ms(slot: &OutputSlot) -> Option<u64> {
    let at = slot.lock().unwrap().tail.last_at_ms;
    (at > 0).then_some(at)
}

/// 슬롯의 채널을 통째로 갈아 끼운다 — **순수 조작** (유닛 테스트 대상). 꼬리 링은 그대로다.
/// 배치 단위로만 잠기므로 이 교체는 배치 경계에서 원자적으로 보인다.
pub(crate) fn swap_output(slot: &OutputSlot, next: impl OutputSink + 'static) {
    let mut state = slot.lock().unwrap();
    state.channel = Some(Box::new(next));
    primary_plugged(&state);
}

// ---------------------------------------------------------------------------
// 꼬리 링 — 창 이관 틈의 출력 재생 (R02)
// ---------------------------------------------------------------------------

/// 꼬리 링 상한. 넘치면 앞을 버린다 — 이관 틈(드래그를 들고 있는 몇 초)의 출력을 덮기에
/// 넉넉하고, 세션마다 상시 켜져 있어도 부담이 없는 크기.
pub(crate) const TAIL_CAP: usize = 256 * 1024;

/// 세션 출력의 **마지막 [`TAIL_CAP`] 바이트**와 그 절대 오프셋.
///
/// 왜: 이관은 dragstart 에 화면을 뜨고(`tear.ts` `buildTear`) 재부착은 놓은 뒤에야 오므로,
/// 그 사이 출력은 옛 채널로 가서 사라진다(옛 xterm 은 버려졌거나 창이 닫혔다). 로컬은 재부착
/// resize 에 ConPTY 가 화면을 다시 그려 덮이지만 **SSH 는 그 구간이 그대로 빈다.** 그래서
/// 배처가 **내보낸(시도한) 모든 바이트**를 오프셋과 함께 적어 두고, 프런트가 "화면에 반영된
/// 데까지(consumed)" 를 짐에 실어 오면 `[consumed, end)` 를 새 채널에 먼저 흘린다.
///
/// 오프셋 축은 **"배처가 생산한 순서"** 하나다(2026-10-08 세션 코어 ② — 예전엔 "채널로 내보낸 순서").
/// 채널이 비어 있어도(붙은 창이 없는 떨어진 세션) 적는다 — 그래야 다시 붙는 창이 그 사이 출력을 재생한다.
/// 채널 send 의 성공·실패와도 무관하다. 세션의 첫 채널이 오프셋 0 에서 시작하므로(로컬은 펌프 전에
/// 채널을 꽂고, SSH 는 채널을 들고 태어난다) 새 세션의 프런트는 0 에서 세면 맞는다 — 채널이 빈 순간은
/// 열리는 중(아직 바이트 없음)이거나 떨어진 뒤(다음 붙기가 링에서 이어 받는다)뿐이다.
/// [`OutputStats`] 는 여전히 "채널로 **시도한** 전송" 만 센다(진단의 짝이 프런트의 받은 수라서).
#[derive(Debug, Default)]
pub(crate) struct TailRing {
    buf: VecDeque<u8>,
    /// 지금까지 적은 총 바이트 = 다음 바이트의 오프셋.
    end: u64,
    /// 마지막으로 바이트를 적은 시각(epoch ms, 0 = 아직 없음) — 떨어진 세션 목록의 "마지막 출력"(③-4).
    last_at_ms: u64,
}

/// 재생 시작점을 고를 때 들여다보는 폭 — 이 안에서 시퀀스·줄 경계를 찾는다(긴 OSC 52 조각도 대개 들어간다).
const BOUNDARY_WINDOW: usize = 64 * 1024;

const fn is_continuation(b: u8) -> bool {
    b & 0xC0 == 0x80
}

/// `bytes` 를 **바닥 상태에서** 읽어 끝에 끝나지 않은 이스케이프 시퀀스·UTF-8 글자가 걸려 있으면 그 시작 인덱스.
///
/// VT 파서의 큰 갈래만 따른다(xterm 과 같은 끝맺음): `ESC [`…최종 바이트(CSI) · `ESC ]`…BEL/ST(OSC) · `ESC P/X/^/_`…ST(DCS 등
/// 문자열) · `ESC` 중간 바이트…최종 바이트 · UTF-8 앞 바이트 + 이어지는 바이트. CAN/SUB 는 시퀀스를 끊는다. 시퀀스 안의 C0 는
/// 실행되고 시퀀스는 이어진다(VT 규칙). 순수 함수 — 시험 대상.
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

/// [`TailRing::since`] 가 재생을 거절한 이유.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplayRefusal {
    /// 링이 넘쳐 `consumed` 이후의 앞부분이 이미 버려졌다.
    Overrun { consumed: u64, base: u64 },
    /// 프런트가 Rust 가 보낸 적 없는 오프셋을 말한다 — 축이 어긋났다.
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
    /// 링에 남은 가장 오래된 바이트의 오프셋.
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

    /// 링의 `[from, to)` 바이트(둘 다 링 안이어야 한다).
    fn range(&self, from: u64, to: u64) -> Vec<u8> {
        let base = self.base();
        self.buf
            .iter()
            .skip((from - base) as usize)
            .take((to - from) as usize)
            .copied()
            .collect()
    }

    /// **재생 시작점을 시퀀스·글자 경계로 당긴다** — `consumed` 앞이 끝나지 않은 이스케이프 시퀀스·UTF-8 글자의 중간이면 그
    /// 시작으로. 창의 소비 오프셋은 배치 경계(바이트 단위 — 시퀀스 한가운데일 수 있다)이고, 그 순간 xterm 파서가 쥐고 있던
    /// 조각은 화면 직렬화(체크포인트·이관 짐)에 없다. 그 뒤부터 재생하면 시퀀스 꼬리(`2;120;200m`)가 글자로 찍힌다 — 시작부터
    /// 다시 보내야 맞다. 시작이 링 밖이면 당기지 않는다(그대로). 판정은 [`open_sequence_start`].
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

    /// **링이 넘친 붙기의 시작점** — 링 첫 바이트는 바이트 수로 잘린 아무 자리다(시퀀스·글자 한가운데일 수 있다 — 실측 10-10
    /// `survival boundary c1a`: 재생 첫 줄이 `252;120;200m한글…` 으로 찍혔다). 처음 줄 시작(LF 뒤)으로, 창 안에 줄바꿈이 없으면
    /// 처음 시퀀스 시작(ESC — 문자열 끝 `ESC \` 은 빼고)으로, 그것도 없으면 처음 글자 시작(UTF-8 이어지는 바이트를 건너뛴다)으로
    /// **민다**. 민 만큼도 잃은 바이트다(부른 쪽이 센다).
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

    /// `[consumed, end)` — 화면에 아직 반영되지 않은 꼬리. 링 밖이면 거절한다.
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

/// 재부착 결과 — 프런트(`reattachSession`)가 받는 모양.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Reattached {
    /// 새 채널의 **첫 바이트**가 갖는 오프셋. 재생했으면 `consumed`, 아니면 교체 순간의 `end`.
    /// 프런트는 여기서부터 콜백이 돌아온 바이트를 더해 다음 이관의 `consumed` 를 낸다.
    pub start: u64,
    /// 꼬리를 재생했는가. `consumed` 가 없었거나(옛 짐·자가 회복) 거절됐으면 `false`.
    pub replayed: bool,
    /// 재생하지 않은 이유 (진단). 재생했거나 `consumed` 가 없었으면 `None`.
    pub reason: Option<String>,
    /// 이 창이 새로 받은 임대([`crate::session_core::Keys`]) — 로컬·SSH 모두(②-2). 이 뒤의 write·resize·close 는
    /// 이 값을 싣는다. 코어에 없는 세션(이미 끝남)이면 `None`.
    pub lease: Option<crate::session_core::Keys>,
}

/// 채널을 갈아 끼우되, `consumed` 가 있으면 **그 전에** 링의 `[consumed, end)` 를 새 채널로
/// 먼저 보낸다 — 전부 슬롯 잠금 하나 안에서다(배처는 그동안 기록도 전송도 못 한다). 그래서
/// 새 채널의 메시지 순서는 언제나 "재생 꼬리 → 실시간" 이고, 둘 사이에 빈틈도 겹침도 없다.
///
/// 거절(링 넘침·오프셋 불일치)이나 재생 전송 실패면 재생 없이 갈아 끼우기만 하고 이유를
/// 돌려준다 — 그때는 지금까지처럼 재부착 resize 의 재그림에 맡긴다. 재생 바이트는 링에 다시
/// 적지 않고 [`OutputStats`] 에도 세지 않는다(이미 한 번 내보낸 바이트다).
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
        // 시퀀스·글자 한가운데의 소비 오프셋은 그 시작으로 당긴다(`TailRing::pull_back`).
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

/// 떨어진 세션에 새 창이 붙을 때의 재생 결과 ([`attach_output`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttachReplay {
    /// 새 채널의 첫 바이트 오프셋.
    pub start: u64,
    /// 재생이 끝나는 오프셋 = 교체 순간의 링 끝. 이 뒤는 실시간이다(프런트가 재생 표시를 끄는 기준).
    pub end: u64,
    /// `consumed` 부터 빈틈없이 이어 재생했는가. `false` 면 앞부분이 링 밖으로 밀려났거나 재생하지 못했다.
    pub contiguous: bool,
    /// 링을 넘쳐 잃은 바이트(`base - consumed`) — 프런트 배너 "출력 일부 유실(N KiB)".
    pub overrun_bytes: u64,
}

/// [`swap_output_replaying`] 의 **붙기(attach)** 판 — 떨어진 세션은 이어 받을 화면(체크포인트)이 없을 수도
/// 있고, 링이 넘쳤어도 남은 것은 보여 주는 편이 낫다(설계 4.3 "정확도 수준"). 그래서 거절하지 않는다:
///
/// - `consumed` 가 링 안 → `[consumed, end)` 재생, 이어짐(무손실).
/// - `consumed < base`(넘침) → 남은 링 전부 `[base, end)` 재생 + `overrun_bytes = base - consumed`.
/// - `consumed > end`(축 어긋남) → 재생 없음, 새 채널은 `end` 에서 시작.
///
/// 재생 send 가 실패하면 재생 없이 갈아 끼운다(그 채널은 어차피 죽었다). 한 잠금 안이라 재생이 실시간보다
/// 늦을 수 없는 것은 [`swap_output_replaying`] 과 같다. 재생 바이트는 링·[`OutputStats`] 에 다시 적지 않는다.
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

/// [`attach_output`] 의 **시청자** 판 — 같은 재생 규칙(`[consumed, end)` · 넘침이면 안전한 자리부터)으로 새 시청자 싱크에 먼저 흘리고
/// 목록에 꽂는다(같은 회차가 있으면 갈아 끼운다). 한 잠금 안이라 재생이 실시간보다 늦을 수 없다.
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

/// 붙기의 재생 — 슬롯 잠금을 쥔 채 부른다(꽂기는 부른 쪽).
fn replay_into(state: &SlotState, next: &dyn OutputSink, consumed: u64) -> AttachReplay {
    let end = state.tail.end;
    let base = state.tail.base();
    // 넘쳤으면 링 첫 안전한 자리(줄·시퀀스·글자 시작 — `TailRing::safe_base`)부터, 민 만큼도 유실로 센다. 링 안이면 소비 오프셋을
    // 시퀀스·글자 시작으로 당긴다(`TailRing::pull_back` — 창이 아직 그리지 않은 조각부터 다시 보낸다).
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
// 출력 전달 계수기 (진단 — docs/log/2026-09-05-silent-session-selfheal.md)
// ---------------------------------------------------------------------------

/// 세션 하나가 **웹뷰로 내보낸 양**. 오직 진단용이고 데이터 경로에는 영향이 없다.
///
/// 왜 필요한가: "타일이 검다" 는 증상은 원인이 둘인데 화면만 봐서는 구별되지 않는다.
///
/// - **Rust 가 안 보냈다** — 펌프가 멎었거나 수문이 닫힌 채 남았다 → `sent_chunks == 0`.
/// - **Rust 는 보냈는데 JS 가 못 받았다** — IPC 유실(채널 번호에 빈칸이 생겨 그 뒤가
///   영원히 큐에 갇힌다) → `sent_chunks > 0` 인데 프런트의 `received == 0`.
///
/// 그래서 프런트가 재부착을 발동할 때 이 값을 한 줄로 찍는다
/// ([`crate::session_commands::session_stats`] → `[aynx] 세션 N 출력 없음 → 채널 재부착 (보낸 X / 받은 Y)`).
///
/// 전부 원자 카운터라 배처 루프에 얹혀도 비용이 없다 (배치당 두 번 `fetch_add`).
/// `last_error` 만 뮤텍스인데, 실패했을 때만 잠근다 — 정상 경로에서는 건드리지 않는다.
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

/// [`OutputStats`] 를 프런트로 넘기는 모양 (`session_stats` 의 반환값).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SessionStats {
    /// 배처가 채널로 **내보낸 배치 수** (실패한 것도 시도로 센다).
    pub sent_chunks: u64,
    /// 그 배치들의 총 바이트.
    pub sent_bytes: u64,
    /// `Channel::send` 가 오류를 돌려준 횟수. **0 이 아니면 그 세션은 이미 침묵이다**
    /// (채널 번호에 빈칸이 생겼다).
    pub send_failures: u64,
    /// 마지막 전송 실패의 문자열. 없으면 `null`.
    pub last_error: Option<String>,
}

/// 배처가 받는 것 — 출력 덩어리, 또는 **표식**(로컬 PTY 의 종료 마감).
///
/// 표식은 그 앞에 들어온 덩어리를 전부 내보낸(링에 적은) 뒤 그 순간의 링 끝(= 생산된 총 바이트)을
/// 돌려준다 — 종료를 배처 **뒤로** 정렬하는 길이다(`crate::pty` 의 종료 감시 · `crate::ssh::session::finish_exit` ·
/// 설계 4.3 "종료는 Rust 가 마감").
pub(crate) enum Chunk {
    Data(Vec<u8>),
    Mark(mpsc::Sender<u64>),
}

impl From<Vec<u8>> for Chunk {
    fn from(bytes: Vec<u8>) -> Self {
        Chunk::Data(bytes)
    }
}

/// 배처에 표식을 보내고 그 앞의 배치가 다 나간 순간의 링 끝을 받는다. 배처가 이미 끝났거나 `wait` 안에
/// 답이 없으면 슬롯에서 직접 읽는다(근사 — 기록용 값이라 막히지 않는 편이 낫다).
pub(crate) fn flush_mark(tx: &mpsc::Sender<Chunk>, slot: &OutputSlot, wait: Duration) -> u64 {
    let (reply, answer) = mpsc::channel::<u64>();
    if tx.send(Chunk::Mark(reply)).is_ok() {
        if let Ok(end) = answer.recv_timeout(wait) {
            return end;
        }
    }
    produced(slot)
}

/// 청크 스트림을 4ms/64KB 로 묶어 웹뷰 채널로 흘려보내는 소비자 스레드.
///
/// 로컬 PTY(동기 리더)와 SSH 세션(tokio 태스크)이 같은 배칭 규칙을 쓰도록
/// 공유한다. 생산자는 `tx` 로 청크를 밀어 넣고, `tx` 를 떨어뜨리면 이 스레드도 끝난다.
///
/// 채널을 소유하지 않고 [`OutputSlot`] 에서 **배치마다 한 번 꺼내 쓴다** — 그래야 탭을
/// 다른 창으로 옮길 때 출력을 그 창으로 돌릴 수 있다 (`reattach_output`).
///
/// **전송 실패로 루프를 끊지 않는다.** 창이 닫히면 그 창의 채널은 즉시 오류를 돌려주는데,
/// 거기서 끊어 버리면 창을 옮긴 세션이 새 창에서 영영 벙어리가 된다. 종료 조건은
/// 예전과 같이 **생산자가 사라지는 것**(`rx.recv()` 실패) 하나뿐이다.
pub(crate) fn spawn_batcher<T: Into<Chunk> + Send + 'static>(
    rx: mpsc::Receiver<T>,
    output: OutputSlot,
    stats: Arc<OutputStats>,
) {
    spawn_batcher_with(rx, output, stats, None);
}

/// **붙은 창이 없을 때** 터미널 질의에 대신 답하는 손 — 이 배치에서 새로 끝난 질의들을 받는다(세션 서버의 로컬 PTY).
/// 답 내용은 [`term_reply`] 한 곳. 손은 PTY 에 **직접** 쓴다 — 사람이 친 입력의 길(`write` op)을 타지 않으므로 사람 개입으로
/// 세지 않는다.
pub(crate) type QueryHook = Box<dyn Fn(Vec<TermQuery>) + Send>;

/// [`spawn_batcher`] + 질의 대답 손(`answer`). **붙은 창이 없는 동안**(채널이 빈 슬롯 — 떨어진 세션) 배치에서 터미널 질의([`TermQuery`])를 보면
/// `answer` 를 부른다 — 안 답하면 셸(PSReadLine)·TUI(Claude Code)가 답을 기다리며 멈춘다(③-0 실측 — `docs/log/2026-10-08-session-server-spike.md`).
/// 붙어 있으면 창의 xterm 이 답한다(두 번 답하면 남는 답이 셸 입력으로 샌다).
pub(crate) fn spawn_batcher_with<T: Into<Chunk> + Send + 'static>(
    rx: mpsc::Receiver<T>,
    output: OutputSlot,
    stats: Arc<OutputStats>,
    answer: Option<QueryHook>,
) {
    std::thread::spawn(move || {
        let mut carry: Vec<u8> = Vec::new();
        // 전송 실패를 **세션당 한 번만** 알린다.
        //
        // Tauri 채널은 메시지마다 번호(index)를 매기는데 그 번호는 **보내기 전에** 올라가고,
        // JS 쪽 `Channel` 은 빠진 번호가 있으면 그 뒤 메시지를 전부 큐에 쌓아 둔 채 영원히
        // 기다린다. 그래서 실패한 배치 하나가 그 터미널을 **영구 침묵**으로 만든다 —
        // 프로세스는 살아 있고 입력도 들어가는데 화면만 검은 상태다
        // (docs/log/2026-09-05-multi-local-open.md). 빈 번호를 되메울 방법이 없으니
        // 최소한 흔적은 남긴다. 창을 닫은 뒤의 실패는 정상이므로 매 배치가 아니라 한 줄만.
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
            // 잠금은 배치 하나당 한 번이다 (청크마다가 아니다) — 비용이 사실상 없다.
            let mut slot = output.lock().unwrap();
            let client_answers = slot.client_answers();
            // 서버 해석기 몫(사본) — 슬롯 잠금 밖에서 먹인다(해석이 출력 전달을 늦추지 않게).
            let tap = slot.tap.clone();
            let tap_bytes = tap.as_ref().map(|_| batch.clone());
            let SlotState { channel, viewers, tail, .. } = &mut *slot;
            // 꼬리 링은 **채널이 없어도** 적는다 — 오프셋 축 = "생산한 순서" ([`TailRing`] 주석). 같은 잠금
            // 안이라 재부착·붙기의 재생과 서로를 배제한다.
            let offset = tail.end;
            tail.record(&batch);
            let end = tail.end;
            // 질의는 **붙은 창이 없을 때만** 대신 답한다(잠금 밖에서 — 아래). carry 는 채널과 무관하게 이어 간다.
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
            // 시청자에게 먼저(사본) — 실패한 싱크는 뺀다(예산 초과 · 연결 끊김 — 그 시청자는 다시 붙어 재동기화한다). 주와 같은 배치,
            // 같은 오프셋이다.
            viewers.retain(|(_, sink)| sink.send(offset, batch.clone()).is_ok());
            if let Some(channel) = channel.as_ref() {
                let bytes = batch.len();
                // 성공·실패와 무관하게 **시도한 것**을 먼저 센다. 프런트의 "받은 수" 와
                // 짝을 이뤄야 하는 값이라, 실패를 빼면 "Rust 는 보냈는데 JS 가 못 받았다"
                // 를 가릴 수 없다 (그 실패가 곧 IPC 유실이다).
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
