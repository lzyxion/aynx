//! **프로듀서 채팅 레지스트리**(오케스트레이션 2단계 "구조화 프로듀서" 단계 2 — 설계 aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md
//! 1-2 · 1-3 · 2절 · 4절) — 세션 서버 프로세스에 한 벌. 사이드 채팅 표(`server::side_chat`)와 **따로** 산다(표를 합치지 않는다 — R1): 프로세스
//! 몸(띄우기 · 세 스레드 · 걸음 · 끝)은 공용 코어 `server::chat_proc` 이고, 이 파일은 그 주인([`chat_proc::Host`] `for ProducerChat`)이다.
//!
//! 열쇠는 **논리적 채팅** id(`pc-` + 영숫자 · `-` — 사이드 채팅 id 와 섞이지 않는다 · `side_chat_*` 는 `pc-` 를 `[wrong-chat-kind]` 로 거절).
//! 칸: 앨범 저장소 경로 · cli/모델/강도 · 대화 id · 입력 상태기계
//! ([`input`]) · 끝난 이유 · 구독. 앨범 귀속은 여기 없다 — 오케스트레이션 장부(Run 파일 `producers`)가 권위다(설계 2-3).
//!
//! ## op(`serve` 가 블로킹 풀 태스크로 — 판 20)
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `producer_album_start` | 쓰기 | 첫 말 · 저장소 · 앨범 구성 → `{runId, gen, chat, sent, state, epoch}`(ref → 프로세스 → Run과 묶음 → 단일 전송기) |
//! | `orchestration_album_widen` · `_set` | 쓰기 | `{runId, expectRev, next, riskConfirmed?}` → `{runId, rev, widened, latestSeq}`(원격은 넓힘 REAUTH · 좁힘 ALLOW) |
//! | `orchestration_rename_album` | 쓰기 | `{runId, name}` → `{runId, name, latestSeq}`(사람만 · ALLOW) |
//! | `producer_fork_probe` · `orchestration_album_defaults` | 읽기 | `{agent, conv}` → `{repo}` · `{repo}` → 지난 구성 초안 |
//! | `producer_chat_open` | 쓰기 | `{chat, cli, model, effort?, mode: {kind: resume, conv} \| {kind: adopt, run}}` → 스냅숏 · 이미 열린 앨범의 재개와 이어받기만 · **띄우지 않는다** · 귀속 앨범이 orphaned 면 `readOnly` |
//! | `producer_chat_send` | 쓰기 | `{chat, clientId, text}` → `{state, position?, epoch}` — 전송기([`input`]): 쉬면 곧바로(프로세스가 없으면 여기서 띄운다) · 아니면 대기열 |
//! | `producer_chat_interrupt` | 쓰기 | `{chat, deliverQueued}` → bool(끊기를 보냈나) — 그 자리의 `wait_run` 을 **먼저** 취소한다 |
//! | `producer_chat_set_model` · `_set_effort` | 쓰기 | `{chat, model}` · `{chat, effort?}` → bool |
//! | `producer_chat_decide` | 쓰기 | `{chat, epoch, requestId, decision, message?}` → true — **카드로 선 요청만**(허용 목록 둘 — `side_chat::guard`) |
//! | `producer_chat_queue_cancel` | 쓰기 | `{chat, clientId}` → bool · 보냈으면 `[already-sent]` |
//! | `producer_chat_close` | 쓰기 | `{chat}` → bool — 레지스트리에서 지운다(대기열 버림 · 재시작 없음) |
//! | `producer_chat_subscribe` · `_unsubscribe` | 쓰기 | `{chat, window}` → `{subGen, snapshot}` · `{chat, window, subGen}` → bool(같은 `subGen` 만 지운다) |
//! | `producer_chat_attach` · `_status` · `_list` | 읽기 | 스냅숏 · `{open, …}` 또는 `{gone: closed \| server-restarted, album?}` · 목록 |
//!
//! 사건 `producer-chat-event{chat, epoch, seq, ev, subs: [{conn, window, subGen}]}` — 받을 구독을 몸에 싣는다(GUI 라우터가 그 Channel 에만 —
//! 단계 3). 본문이 있어 `client::RELAYED` 에 넣지 않는다.
//!
//! ## stdin — 사람의 입력과 앱이 깨움뿐
//!
//! 새 사용자 턴의 본문을 짓는 곳은 [`dispatch`] 하나(`encode_user` — 시험 `producer_stdin_only_human_or_wake`). 부르는 곳은 사람 op 둘(보내기 ·
//! 쉬는 중의 [끊고 전달]) · 턴 끝의 대기열 처리(사람이 이미 보낸 글) · **깨움 하나**([`wake`] 의 `fire` — 글은 오케스트레이션이 Run 장부에서
//! 제한된 타입으로 지은 문장 `orchestration::wake::wake_text` 하나 · 단계 4)뿐이다. 제어 프레임(끊기 · 모델 · 강도 · 결정)은 사람 op 에서만
//! (깨움 턴 시한의 끊기 하나는 예외 — 시계가 붙이는 끊기 의도). MCP 결과 · 작업자 대화 · 보고 · 판정 본문이 여기로 오는 길은 없다.
//!
//! ## 잠금 순서(설계 2-6)
//!
//! L3 이 표 → L4 채팅 항목(코어 잠금 포함) → L2 토큰 표(`chat_token::revoke`)만. **L4 를 쥔 채 오케스트레이션(L1)을 부르지 않는다** —
//! 턴 끝의 커서 확정은 [`later`](순서 보장 일꾼 하나)로, 끝의 묶음 해제는 코어의 `on_exit`(잠금 밖)에서, 끊기의 대기 취소는 잠금을 잡기 전에.
//! 시험 `producer_lock_order`.
//!
//! ## 종료 순서(설계 2-5)
//!
//! 닫기 시작(우리가 끊음)과 끝 감지(`on_ending`) 모두에서 **토큰을 먼저** 거두고(`chat_token::revoke(chat, proc)` — 그 순간부터 그 세대의 MCP 는
//! 401) → `on_exit`(잠금 밖)에서 `coordinator_exited_seat(Seat{chat, proc})`(그 자리 묶음만 · 대기 취소 · 잠정 커서 되돌림) → 그 뒤에야
//! 끝 사건(`exited{reason, why, restartable}`)을 구독에 낸다(코어가 잠금 안에서 낸 끝 사건은 내보내지 않고 쥐었다가). 시험 `producer_end_order`.
//!
//! ## 수명(설계 1-3)
//!
//! | 사건 | 묶이기 전(귀속 앨범 없음) | 귀속 앨범 있음 |
//! |---|---|---|
//! | 앨범 끝(done · stopped · 보관) | — | 쉬는 순간 닫음(`album-ended` — 대기열이 남았으면 그것부터) · [`ALBUM_END_GRACE`] 뒤 끊고 닫음 |
//! | 서버 재시작 | 사라짐(`status` = `server-restarted`) | orphaned 앨범의 채팅은 `readOnly`(`send` = `[album-orphaned]`) |
//!
//! **로그**: 채팅 id · 세대 · pid · 끝 코드 · 버린 줄 수만. 글 · 답 · 도구 출력 · 경로 · 토큰은 남기지 않는다.

mod album;
mod input;
mod launch;
mod wake;

#[cfg(test)]
mod tests;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::chat_proc::{self, Core, ProcExit, ProcId, Status};
use super::ipc::WireError;
use super::{hub, log};
use crate::errors::{with_reason, SESSION_GONE};
use crate::orchestration::{Orchestration, Seat};
use crate::side_chat::event::{model_ok, uuid_ok, word_ok};
use crate::side_chat::event::Outcome;
use crate::side_chat::{Cli, Decision, Ev};
use crate::orchestration::wake::WakeEnd;
use input::{End, Input, Next, Src, Submit};

/// 사건 이벤트 이름(서버 → GUI).
pub(crate) const EVENT: &str = "producer-chat-event";
/// op 실패 코드.
pub(crate) const PRODUCER: &str = "producer-chat";
/// 프로듀서 채팅 id 머리.
pub(crate) const ID_PREFIX: &str = "pc-";
/// 묶이기 전(귀속 앨범 없음) · 구독 0 의 살려 두기(설계 1-3 [잠정]).
/// 그 TTL 에 턴이 돌면 더 기다리는 시간([잠정]) — 그 뒤 끊고 닫는다.
/// 앨범이 끝난 뒤 쉬기를 기다리는 시간([잠정]).
pub(crate) const ALBUM_END_GRACE: Duration = Duration::from_secs(600);
/// 산 미귀속 프로세스 상한([잠정]).
/// `Dispatching` 시한(ms · [잠정] — 실측 P2 · P3: 턴 시작 신호는 0.5초 안).
pub(crate) const DISPATCH_MS: u64 = 30_000;
/// 보낸 글 하나의 상한(바이트).
const TEXT_MAX: usize = 256 * 1024;
/// 닫힌 채팅의 까닭 기억 수(`status` 의 `gone`).
const GONE_MAX: usize = 256;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(super) fn fail(reason: &str, message: impl Into<String>) -> WireError {
    WireError::new(PRODUCER, with_reason(reason, message.into()))
}

fn now_ms() -> u64 {
    crate::operations::now_ms()
}

/// 이 파일이 받는 op 인가.
pub(crate) fn is_producer_op(op: &str) -> bool {
    matches!(
        op,
        "producer_chat_open"
            | "producer_album_start"
            | "producer_fork_probe"
            | "orchestration_album_widen"
            | "orchestration_album_set"
            | "orchestration_rename_album"
            | "orchestration_album_defaults"
            | "orchestration_artist_remove"
            | "producer_chat_send"
            | "producer_chat_interrupt"
            | "producer_chat_set_model"
            | "producer_chat_set_effort"
            | "producer_chat_decide"
            | "producer_chat_queue_cancel"
            | "producer_chat_close"
            | "producer_chat_subscribe"
            | "producer_chat_unsubscribe"
            | "producer_chat_attach"
            | "producer_chat_status"
            | "producer_chat_list"
    )
}

/// 프로듀서 채팅 id 모양 — `pc-` + 사이드 채팅 id 규칙(폴더 이름 하나 · 토큰 표가 같은 판정).
pub(crate) fn id_ok(id: &str) -> bool {
    id.starts_with(ID_PREFIX) && id.len() > ID_PREFIX.len() && crate::side_chat::store::id_ok(id)
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

/// 끝난 이유(설계 1-3 표 — 다음 보내기의 재시작 허용).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EndWhy {
    Exited,
    Crashed,
    AlbumEnded,
    Closed,
    CloseAll,
    StartFailed,
    AlbumStartFailed,
}

impl EndWhy {
    fn word(self) -> &'static str {
        match self {
            EndWhy::Exited => "exited",
            EndWhy::Crashed => "crashed",
            EndWhy::AlbumEnded => "album-ended",
            EndWhy::Closed => "closed",
            EndWhy::CloseAll => "close-all",
            EndWhy::StartFailed => "start-failed",
            EndWhy::AlbumStartFailed => "album-start-failed",
        }
    }

    /// 다음 사람 보내기가 resume 으로 다시 띄우나(닫기 · 모두 닫기는 레지스트리에 항목이 없다).
    fn restartable(self) -> bool {
        !matches!(self, EndWhy::Closed | EndWhy::CloseAll)
    }
}

/// 프로세스 수명의 단계.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Life {
    /// 프로세스 없음(아직 안 띄움) · 산 프로세스.
    Live,
    /// 끝을 알았다(토큰 거둠) — 묶음 해제를 기다린다. 이 동안 들어온 글은 대기열로 · 다시 띄우지 않는다.
    Exiting,
    /// 끝났다(묶음 해제 끝 · 끝 사건 냄).
    Ended(EndWhy),
}

/// 구독 — `(conn, window, subGen)`(설계 7 R11). 같은 `subGen` 만 지운다.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Sub {
    conn: u64,
    window: String,
    gen: u64,
}

pub(super) struct State {
    pub(super) cli: Cli,
    pub(super) model: String,
    pub(super) effort: Option<String>,
    /// 스튜디오(맡긴 저장소 `block.path` — 서버가 다시 읽은 값).
    pub(super) repo: String,
    /// 새 길의 앨범 id는 준비한 Run 또는 이어받기 대상에서만 온다.
    pub(super) album: Option<String>,
    /// ref · 프로세스만 준비된 틈에는 다른 사람 보내기가 먼저 들어가지 못한다.
    album_starting: bool,
    /// 이어 갈 대화(턴이 한 번 선 것만).
    pub(super) conversation: Option<String>,
    /// 갈라 올 원본 대화(그 CLI 의 대화 id — [오케스트레이션으로 이어 가기] · 단계 5). 이 채팅 자신의 대화가 서기 전의 띄우기만 갈라 오기다.
    pub(super) fork_from: Option<String>,
    conv_seen: Option<String>,
    core: Core,
    input: Input,
    life: Life,
    /// 우리가 닫는 까닭(끝 사건의 `why` — 없으면 끝 코드로).
    closing: Option<EndWhy>,
    /// 코어가 잠금 안에서 낸 끝 사건(내보내지 않고 쥐었다가 묶음 해제 뒤에 — 머리말 "종료 순서").
    held_exit: Option<(ProcId, u64, Ev)>,
    subs: Vec<Sub>,
    /// 구독이 0 이 된 때(묶이기 전 TTL 의 시작).
    /// 귀속 앨범이 끝난 것을 처음 본 때.
    album_end_seen: Option<Instant>,
    /// 귀속 앨범이 orphaned(서버 재시작) — 기록만 · 보내기 거절.
    read_only: bool,
    /// 마지막 턴이 끝난 때(ms — 깨움의 "턴 끝 + 2초").
    last_turn_end: Option<u64>,
    /// 지금 보내는 · 도는 깨움의 화면 몸(`woken` 사건 · 스냅숏 `wake` — id · 낱말 · 수만).
    wake_view: Option<Value>,
}

pub(super) struct ProducerChat {
    id: String,
    st: Mutex<State>,
    /// 준비 · 끝(보내기의 준비 기다리기).
    cv: Condvar,
}

#[derive(Default)]
struct Table {
    chats: HashMap<String, Arc<ProducerChat>>,
    gone: VecDeque<(String, &'static str)>,
    next_sub: u64,
}

static TABLE: LazyLock<Mutex<Table>> = LazyLock::new(Default::default);

fn find(id: &str) -> Result<Arc<ProducerChat>, WireError> {
    if !id_ok(id) {
        return Err(fail("wrong-chat-kind", "that id is not a producer chat"));
    }
    lock(&TABLE)
        .chats
        .get(id)
        .cloned()
        .ok_or_else(|| WireError::new(PRODUCER, with_reason(SESSION_GONE, "this producer chat is not open on the session server".into())))
}

fn remember_gone(t: &mut Table, id: &str, why: &'static str) {
    t.gone.retain(|(c, _)| c != id);
    if t.gone.len() >= GONE_MAX {
        t.gone.pop_front();
    }
    t.gone.push_back((id.to_string(), why));
}

/// 오케스트레이션(세션 서버의 AI 평면 — 시험은 끼운 것).
pub(super) fn orch() -> Option<Arc<Orchestration>> {
    #[cfg(test)]
    if let Some(o) = lock(&TEST_ORCH).clone() {
        return Some(o);
    }
    hub::ai().map(|p| p.orch.clone())
}

/// **채팅 → 오케스트레이션 방향의 늦은 일**(턴 끝의 커서 확정) — 채팅 잠금 안에서는 부르지 않고 순서 보장 일꾼 하나에 넘긴다(설계 2-6).
type Job = Box<dyn FnOnce() + Send>;

fn later(f: impl FnOnce() + Send + 'static) {
    static TX: LazyLock<Mutex<mpsc::Sender<Job>>> = LazyLock::new(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::spawn(move || {
            for job in rx {
                job();
            }
        });
        Mutex::new(tx)
    });
    let _ = lock(&TX).send(Box::new(f));
}

/// 채팅 잠금 밖의 오케스트레이션 일 — 순서 보장 일꾼([`later`])에게.
fn orch_later(f: impl FnOnce(&Orchestration) + Send + 'static) {
    later(move || {
        if let Some(o) = orch() {
            f(&o);
        }
    });
}

fn seat(id: &str, proc: ProcId) -> Seat {
    Seat { chat: id.to_string(), proc }
}

// ---------------------------------------------------------------------------
// 사건 내보내기
// ---------------------------------------------------------------------------

fn emit(chat: &ProducerChat, st: &State, proc: ProcId, seq: u64, ev: &Value) {
    let subs: Vec<Value> = st.subs.iter().map(|s| json!({ "conn": s.conn, "window": s.window, "subGen": s.gen })).collect();
    let body = json!({ "chat": chat.id, "epoch": proc, "seq": seq, "ev": ev, "subs": subs });
    #[cfg(test)]
    lock(&TEST_EVENTS).push(body.clone());
    hub::emit(EVENT, body);
}

/// 레지스트리 자신의 알림(대기열 · 정책 · 끝) — 코어 `seq` 를 올리지 않는다(화면은 상태를 다시 묻는다).
fn notice(chat: &ProducerChat, st: &State, code: &'static str, detail: Option<String>) {
    let ev = serde_json::to_value(Ev::Notice { code, detail }).unwrap_or(Value::Null);
    emit(chat, st, st.core.id(), st.core.seq(), &ev);
}

// ---------------------------------------------------------------------------
// 코어의 주인
// ---------------------------------------------------------------------------

impl chat_proc::Host for ProducerChat {
    type St = State;

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.st)
    }

    fn core(st: &mut State) -> &mut Core {
        &mut st.core
    }

    fn on_event(&self, st: &mut State, proc: ProcId, seq: u64, ev: &Ev) {
        let mut woke: Option<String> = None;
        match ev {
            Ev::Ready { conversation_id, .. } => {
                if conversation_id.is_some() {
                    st.conv_seen = conversation_id.clone();
                }
                self.cv.notify_all();
            }
            Ev::TurnStarted { .. } => {
                if st.conv_seen.is_some() {
                    st.conversation = st.conv_seen.clone();
                }
                woke = st.input.live_wake().map(|(w, _)| w);
                // 끊기 의도가 `Dispatching` 에 붙어 있었으면 턴이 선 즉시 끊는다(설계 4-2).
                if st.input.turn_started() {
                    send_interrupt(self, st);
                }
            }
            Ev::Notice { code: "conversation-changed", detail: Some(id) } => {
                st.conv_seen = Some(id.clone());
                if st.core.status() == Status::Running {
                    st.conversation = Some(id.clone());
                }
            }
            Ev::Exited { .. } => {
                // 끝 사건은 묶음 해제 뒤에(`on_exit`) — 지금은 쥔다.
                st.held_exit = Some((proc, seq, ev.clone()));
                self.cv.notify_all();
                return;
            }
            _ => {}
        }
        let v = serde_json::to_value(ev).unwrap_or(Value::Null);
        emit(self, st, proc, seq, &v);
        // 깨움 턴이 섰다 — "앱이 깨움" 표지(턴 시작 **뒤** — 화면의 접기가 턴 시작에 알림을 걷으므로) · 받아들여짐.
        if let Some(w) = woke {
            if let Some(view) = st.wake_view.clone() {
                let ev = json!({ "t": "woken", "wake": view });
                emit(self, st, proc, seq, &ev);
            }
            let s = seat(&self.id, proc);
            orch_later(move |o| o.wake_started(&s, &w));
        }
        if let Ev::TurnEnded { outcome, .. } = ev {
            let end = match outcome {
                Outcome::Ok => End::Natural,
                Outcome::Interrupted => End::Interrupted,
                Outcome::Error => End::Error,
            };
            let wake = st.input.live_wake();
            st.last_turn_end = Some(now_ms());
            if wake.is_some() {
                st.wake_view = None;
            }
            // 잠정 커서 확정 · 되돌림(설계 3-3) → (깨움 턴이었으면) 그 깨움의 끝 판정(3-4 — 확정 커서를 본다) — 오케스트레이션 잠금이라 채팅
            // 잠금 밖의 일꾼에게(순서 그대로).
            let s = seat(&self.id, proc);
            orch_later(move |o| {
                o.seat_turn_ended(&s, end == End::Natural);
                if let Some((w, stopped)) = wake {
                    let e = match end {
                        _ if stopped => WakeEnd::Interrupted,
                        End::Natural => WakeEnd::Natural,
                        End::Interrupted => WakeEnd::Interrupted,
                        End::Error => WakeEnd::Error,
                    };
                    o.wake_ended(&s, &w, e);
                }
            });
            if let Next::Dispatch { src, text } = st.input.turn_ended(end, now_ms()) {
                dispatch(self, st, src, text);
            }
        }
    }

    /// 끝 사건 전(잠금 안) — **그 세대의 토큰을 먼저** 거둔다(설계 2-5 — 이미 닫기 시작에서 거뒀으면 할 일 없음) · `Exiting`.
    fn on_ending(&self, st: &mut State, proc: ProcId) {
        crate::chat_token::revoke(&self.id, proc);
        st.life = Life::Exiting;
        st.input.proc_exited();
        let agent = match st.cli {
            Cli::Claude => "claude",
            Cli::Codex => "codex",
        };
        for conv in st.conversation.iter().chain(st.conv_seen.iter()) {
            crate::agent_state::note_released(agent, conv);
        }
    }

    /// 잠금 밖 — 묶음 해제(그 자리만 · 대기 취소 · 커서 되돌림) → 끝 상태 → 쥐었던 끝 사건을 구독에.
    fn on_exit(&self, e: ProcExit) {
        log::line(format!(
            "producer chat {} — process {} ended ({}, code {:?}, dropped {} bad · {} unknown line(s))",
            self.id, e.proc, e.reason, e.code, e.dropped.bad, e.dropped.unknown
        ));
        if let Some(o) = orch() {
            o.coordinator_exited_seat(&seat(&self.id, e.proc));
        }
        let mut st = lock(&self.st);
        let why = st.closing.take().unwrap_or(match e.reason {
            "exit" => EndWhy::Exited,
            "start-timeout" | "protocol" => EndWhy::StartFailed,
            _ => EndWhy::Crashed,
        });
        if st.core.id() == e.proc && !st.core.has_proc() {
            st.life = Life::Ended(why);
        }
        if let Some((proc, seq, Ev::Exited { code, reason })) = st.held_exit.take().filter(|(p, ..)| *p == e.proc) {
            let v = json!({ "t": "exited", "code": code, "reason": reason, "why": why.word(), "restartable": why.restartable() });
            emit(self, &st, proc, seq, &v);
        }
        self.cv.notify_all();
        drop(st);
        wake_reaper();
    }
}

/// 우리가 닫는다 — **토큰을 먼저** 거두고(설계 2-5) 잡째 끝낸다(끝 사건은 감시 스레드가).
fn close_proc(chat: &ProducerChat, st: &mut State, why: EndWhy) {
    if let Some(p) = st.core.live() {
        crate::chat_token::revoke(&chat.id, p);
        st.closing = Some(why);
        st.life = Life::Exiting;
        st.core.kill(why.word());
    }
}

/// 끊기를 CLI 에 보낸다(제어 프레임 — 사람 op · 턴 시작 즉시 끊기).
fn send_interrupt(chat: &ProducerChat, st: &mut State) -> bool {
    let Some(a) = st.core.adapter() else { return false };
    match a.encode_interrupt() {
        Ok(step) => chat_proc::apply(chat, st, step),
        Err(_) => false,
    }
}

/// **전송기 — 새 사용자 턴의 본문을 stdin 에 쓰는 유일한 곳**(머리말 "stdin"). 입력 상태기계가 `Dispatching` 으로 세운 글을 짓고 코어에
/// 넘긴다 — 쓰기 결과를 버리지 않는다(실패면 `failed` 로 대기열 맨 앞 · 보류 · 알림).
fn dispatch(chat: &ProducerChat, st: &mut State, src: Src, text: String) -> bool {
    let id = src.client_id().to_string();
    let wake = matches!(src, Src::Wake { .. });
    // 갈라 온 Codex 프로듀서의 첫 사람 글 — 앞에 앱 고정 지침 머리글(단계 5 · 실측 P6 — `launch::album_fork_brief` 하나 · 사람 · AI 글 없음)
    let text = if !wake && launch::needs_brief(st.cli, st.fork_from.is_some(), st.conversation.is_some()) {
        format!("{}{text}", launch::album_fork_brief(&st.repo, st.album.as_deref()))
    } else {
        text
    };
    let ok = match st.core.adapter() {
        Some(a) => match a.encode_user(&text, &[], Some(&id)) {
            Ok(step) => chat_proc::apply(chat, st, step),
            Err(_) => false,
        },
        None => false,
    };
    if !ok {
        st.input.write_failed();
        if !wake {
            notice(chat, st, "queue-failed", Some(id));
        }
    } else if !wake {
        // 전송된 사람 글 — 사람 말 사이 깨움 셈 · 무반응 · 실패를 처음으로(설계 3-4 · O6).
        let c = chat.id.clone();
        orch_later(move |o| o.wake_human_spoke(&c));
    }
    ok
}

// ---------------------------------------------------------------------------
// 띄우기
// ---------------------------------------------------------------------------

/// `<데이터 루트>/producer` — 시험은 임시 폴더.
fn producer_root() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(f) = fake().as_ref() {
        return Some(f.root.clone());
    }
    Some(crate::instance::data_root()?.join("producer"))
}

fn mcp_port() -> Option<u16> {
    #[cfg(test)]
    if let Some(f) = fake().as_ref() {
        return f.mcp_port;
    }
    hub::signal_port()
}

/// 띄우기 전의 판정(잠금 밖 — 파일 · git · 오케스트레이션): 지금 맡기기(스튜디오 · 작업안 칸) · 미귀속 상한.
struct PreSpawn {
    plan_tools: bool,
}

fn pre_spawn(chat: &ProducerChat) -> Result<Option<PreSpawn>, WireError> {
    let needs = { let st = lock(&chat.st); !st.core.has_proc() && st.life != Life::Exiting };
    if !needs { return Ok(None); }
    let policy = orch().and_then(|o| o.album_producer_policy(&chat.id))
        .ok_or_else(|| fail("repo-changed", "귀속된 앨범이 없습니다"))?;
    let (repo, plan_tools, _) = policy.map_err(|e| fail(e.code, e.message))?;
    let album = orch().and_then(|o| o.producer_run(&chat.id));
    let mut st = lock(&chat.st);
    st.repo = repo;
    st.album = album;
    Ok(Some(PreSpawn { plan_tools }))
}

/// **프로세스를 띄운다** — [`ensure_ready`] 에서만(사람 op 의 전송 길). 토큰은 그 세대로 먼저 뽑고(MCP 없이 띄우지 않는다 —
/// `[producer-mcp-unavailable]`), 실패하면 곧바로 거둔다.
fn spawn(chat: &Arc<ProducerChat>, st: &mut State, pre: &PreSpawn) -> Result<(), WireError> {
    let proc = ProcId::next();
    let root = producer_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let port = mcp_port().ok_or_else(|| fail("producer-mcp-unavailable", "the session server has no MCP port"))?;
    let token = crate::chat_token::issue_producer(&chat.id, proc, &st.repo, st.album.as_deref(), pre.plan_tools)
        .ok_or_else(|| fail("producer-mcp-unavailable", "no producer token"))?;
    let revoke = |e: WireError| {
        crate::chat_token::revoke(&chat.id, proc);
        e
    };
    let server = crate::instance::mcp_name(crate::instance::DEV);
    let url = format!("{}/mcp", crate::tile_env::base_url(port));
    let l = launch::prepare(&chat.id, st, proc, &root, (server, &url, &token), pre.plan_tools).map_err(revoke)?;
    let pid = chat_proc::start(chat, st, proc, l).map_err(|(w, m)| revoke(fail(w, m)))?;
    log::line(format!("producer chat {} — started (process {proc}, pid {pid})", chat.id));
    st.conv_seen = None;
    st.life = Life::Live;
    st.closing = None;
    Ok(())
}

/// 프로세스가 없으면 띄우고 준비를 기다린다(사람 op 의 전송 길 — 보내기 · 쉬는 중의 끊고 전달).
fn ensure_ready<'a>(chat: &'a Arc<ProducerChat>, mut st: MutexGuard<'a, State>, pre: Option<&PreSpawn>) -> Result<MutexGuard<'a, State>, WireError> {
    if st.life == Life::Exiting {
        // 끝을 알았지만 묶음 해제 전 — 다시 띄우지 않는다(설계 2-5 · 그 글은 보류된 대기열로).
        st.input.write_failed();
        return Err(fail("exiting", "the producer process is ending — send again in a moment"));
    }
    if !st.core.has_proc() {
        let Some(pre) = pre else { return Err(fail("not-ready", "the producer process is not running")) };
        if let Err(e) = spawn(chat, &mut st, pre) {
            st.input.write_failed();
            return Err(e);
        }
    }
    let deadline = Instant::now() + Duration::from_millis(crate::orchestration::turn::START_MS);
    while st.core.status() == Status::Starting && st.core.has_proc() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            close_proc(chat, &mut st, EndWhy::StartFailed);
            st.input.write_failed();
            return Err(fail("start-timeout", "the producer CLI did not become ready in time"));
        }
        st = chat.cv.wait_timeout(st, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    if !st.core.has_proc() {
        st.input.write_failed();
        return Err(fail("exited", "the producer CLI exited before it was ready"));
    }
    Ok(st)
}

// ---------------------------------------------------------------------------
// op
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ModeBody {
    Adopt { run: String },
    Resume { conv: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenBody {
    chat: String,
    cli: String,
    model: String,
    #[serde(default)]
    effort: Option<String>,
    mode: ModeBody,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    chat: String,
    client_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InterruptBody {
    chat: String,
    #[serde(default)]
    deliver_queued: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelBody {
    chat: String,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffortBody {
    chat: String,
    #[serde(default)]
    effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecideBody {
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientBody {
    chat: String,
    client_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatBody {
    chat: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubBody {
    chat: String,
    window: String,
    #[serde(default)]
    sub_gen: Option<u64>,
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|_| WireError::new(super::ipc::frame::code::BAD_BODY, "bad producer chat request body"))
}

/// op 하나(블로킹 — `serve` 가 블로킹 풀에서). `conn` 은 부른 서버 연결.
pub(crate) fn handle(op: &str, b: Value, conn: u64) -> Result<Value, WireError> {
    match op {
        "orchestration_album_widen" | "orchestration_album_set" | "orchestration_rename_album" => {
            let o = orch().ok_or_else(|| fail("unavailable", "오케스트레이션이 없습니다"))?;
            crate::orchestration::album_change::handle(op, b, &o).map_err(|e| fail(e.code, e.message))
        }
        "producer_album_start" => album::start(b),
        "producer_fork_probe" => album::probe(b),
        "orchestration_album_defaults" => album::defaults(b),
        "orchestration_artist_remove" => album::remove_artist(b),
        "producer_chat_open" => album::open(body(b)?),
        "producer_chat_send" => op_send(body(b)?),
        "producer_chat_interrupt" => op_interrupt(body(b)?),
        "producer_chat_set_model" => op_set_model(body(b)?),
        "producer_chat_set_effort" => op_set_effort(body(b)?),
        "producer_chat_decide" => op_decide(body(b)?),
        "producer_chat_queue_cancel" => op_queue_cancel(body(b)?),
        "producer_chat_close" => {
            let c: ChatBody = body(b)?;
            Ok(json!(close(&c.chat, EndWhy::Closed)))
        }
        "producer_chat_subscribe" => op_subscribe(body(b)?, conn),
        "producer_chat_unsubscribe" => op_unsubscribe(body(b)?, conn),
        "producer_chat_attach" => {
            let c: ChatBody = body(b)?;
            let chat = find(&c.chat)?;
            Ok(snapshot_of(&chat))
        }
        "producer_chat_status" => op_status(body(b)?),
        "producer_chat_list" => Ok(list()),
        _ => Err(WireError::new(super::ipc::frame::code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// 그 채팅의 귀속 앨범 보기(잠금 밖에서 — 오케스트레이션).
fn album_view(id: &str) -> Value {
    match orch().and_then(|o| o.producer_album(id)) {
        Some((run, state, verdict)) => json!({ "runId": run, "state": state, "adoptable": verdict.view() }),
        None => Value::Null,
    }
}

fn life_word(l: Life) -> (&'static str, Option<&'static str>) {
    match l {
        Life::Live => ("live", None),
        Life::Exiting => ("exiting", None),
        Life::Ended(w) => ("ended", Some(w.word())),
    }
}

fn snapshot(chat: &ProducerChat, st: &State, album: Value) -> Value {
    let (life, ended) = life_word(st.life);
    json!({
        "chat": chat.id,
        "cli": st.cli,
        "model": st.model,
        "effort": st.effort,
        "repo": st.repo,
        "epoch": st.core.id(),
        "seq": st.core.seq(),
        "status": st.core.status(),
        "life": life,
        "ended": ended,
        "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
        "forkFrom": st.fork_from,
        "readOnly": st.read_only,
        "queue": st.input.queue_view(),
        "liveTurn": st.core.live_turn(),
        "pending": st.core.pending(),
        "album": album,
        // 지금 도는 깨움(F5 · 다시 붙기 — 꼬리에는 사람 말풍선이 없어 화면이 표지를 다시 세운다).
        "wake": st.input.live_wake().and(st.wake_view.clone()),
    })
}

fn snapshot_of(chat: &ProducerChat) -> Value {
    let album = album_view(&chat.id);
    let st = lock(&chat.st);
    snapshot(chat, &st, album)
}

/// 빈 강도는 칸 없음(CLI 기본)으로 — 프런트의 "기본" 이 `""` 로 와도 `word_ok("")` 거절 · 빈 인자가 나지 않게.
pub(super) fn blank_none(e: Option<String>) -> Option<String> {
    e.filter(|e| !e.is_empty())
}

fn op_open(mut b: OpenBody) -> Result<Value, WireError> {
    b.effort = blank_none(b.effort);
    if !id_ok(&b.chat) {
        return Err(fail("wrong-chat-kind", "a producer chat id starts with pc-"));
    }
    let cli = match b.cli.as_str() {
        "claude" => Cli::Claude,
        "codex" => Cli::Codex,
        _ => return Err(fail("bad-cli", "unknown producer CLI")),
    };
    if !model_ok(&b.model) || b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-model", "invalid model"));
    }
    let adopt = match &b.mode { ModeBody::Adopt { run } => Some(run.clone()), _ => None };
    let conversation = match b.mode {
        ModeBody::Adopt { .. } => None,
        ModeBody::Resume { conv } if uuid_ok(&conv) => Some(conv),
        ModeBody::Resume { .. } => return Err(fail("bad-conversation", "invalid conversation id")),
    };
    // 스튜디오 — 몸의 경로가 아니라 지금 맡기기의 `block.path`(잠금 밖 · 파일 · git). 갈라 오기는 그 대화의 **기록된 cwd 의 git toplevel**
    // 이 맡긴 스튜디오일 때만(몸의 `repo` 는 읽지 않는다 — 단계 5).
    let scope = orch().and_then(|o| o.producer_scope(&b.chat));
    if adopt.is_some() && scope.is_none() && lock(&TABLE).chats.contains_key(&b.chat) {
        return Err(fail("chat-in-use", "이어받기는 새 프로듀서 채팅에서 열어야 합니다"));
    }
    let repo = if let Some(run) = adopt.as_deref() {
        orch().ok_or_else(|| fail("unavailable", "오케스트레이션이 없습니다"))?.open_adopt(&b.chat, run).map_err(|e| fail(e.code, e.message))?
    } else if let Some((_, repo)) = &scope {
        repo.clone()
    } else {
        return Err(fail("repo-changed", "사람이 연 앨범 또는 이어받기 대상이 필요합니다"));
    };
    // 귀속 앨범이 orphaned(서버 재시작)면 기록만(설계 1-3 · 리뷰 F12 — 프런트 문구가 아니라 서버 판정).
    let album = orch().and_then(|o| o.producer_album(&b.chat));
    let read_only = matches!(album, Some((_, crate::orchestration::RunState::Orphaned, _)));
    let (chat, old) = {
        let mut t = lock(&TABLE);
        let old = t.chats.get(&b.chat).cloned();
        let reuse = old.as_ref().filter(|c| {
            let st = lock(&c.st);
            st.cli == cli && crate::worktree::comparable(&st.repo) == crate::worktree::comparable(&repo)
        });
        let chat = match reuse {
            Some(c) => Arc::clone(c),
            None => {
                let c = Arc::new(ProducerChat {
                    id: b.chat.clone(),
                    st: Mutex::new(State {
                        cli,
                        model: b.model.clone(),
                        effort: b.effort.clone(),
                        repo: repo.clone(),
                        album: adopt.clone().or_else(|| scope.as_ref().map(|(id, _)| id.clone())),
                        album_starting: false,
                        conversation: conversation.clone(),
                        fork_from: None,
                        conv_seen: None,
                        core: Core::new(),
                        input: Input::default(),
                        life: Life::Live,
                        closing: None,
                        held_exit: None,
                        subs: Vec::new(),
                        album_end_seen: None,
                        read_only,
                        last_turn_end: None,
                        wake_view: None,
                    }),
                    cv: Condvar::new(),
                });
                t.chats.insert(b.chat.clone(), Arc::clone(&c));
                c
            }
        };
        let replaced = old.filter(|o| !Arc::ptr_eq(o, &chat));
        (chat, replaced)
    };
    if let Some(o) = old {
        let mut st = lock(&o.st);
        close_proc(&o, &mut st, EndWhy::Closed);
    }
    {
        let mut st = lock(&chat.st);
        st.read_only = read_only;
        st.album = adopt.clone().or_else(|| scope.as_ref().map(|(id, _)| id.clone()));
        st.repo.clone_from(&repo);
        if !st.core.has_proc() {
            st.model = b.model;
            st.effort = b.effort;
            if conversation.is_some() {
                st.conversation = conversation;
                        }
        }
    }
    wake_reaper();
    Ok(snapshot_of(&chat))
}

/// 그 에이전트의 대화 루트(시험은 가짜 색인).
fn conv_roots(t: &'static crate::agent_sessions::SessionTarget) -> Vec<PathBuf> {
    #[cfg(test)]
    if let Some(f) = fake().as_ref() {
        return f.conv_roots.iter().filter(|(a, _)| *a == t.id).map(|(_, p)| p.clone()).collect();
    }
    (t.roots)()
}

/// **사람이 보낸 글** — 전송기(설계 4-2). 쉬면 곧바로(프로세스가 없으면 여기서 띄운다), 아니면 대기열.
fn op_send(b: SendBody) -> Result<Value, WireError> {
    if b.text.trim().is_empty() || b.text.len() > TEXT_MAX {
        return Err(fail("bad-text", "the message is empty or too long"));
    }
    if b.client_id.is_empty() || b.client_id.len() > 128 || !word_ok(&b.client_id) {
        return Err(fail("bad-client-id", "clientId must be a short word"));
    }
    let chat = find(&b.chat)?;
    if lock(&chat.st).album_starting {
        return Err(fail("album-starting", "앨범을 여는 중입니다"));
    }
    if lock(&chat.st).read_only {
        return Err(fail("album-orphaned", "this chat's album was left by a server restart — it is read-only; start a new album"));
    }
    let pre = pre_spawn(&chat)?;
    let mut st = lock(&chat.st);
    let can = st.life != Life::Exiting;
    let sub = st.input.submit(&b.client_id, &b.text, now_ms(), can).map_err(|w| fail(w, "the message was not accepted"))?;
    match sub {
        Submit::Duplicate(s) => Ok(json!({ "state": s.word(), "epoch": st.core.id() })),
        Submit::Queued { position } => {
            notice(&chat, &st, "queue-changed", None);
            Ok(json!({ "state": "queued", "position": position, "epoch": st.core.id() }))
        }
        Submit::Dispatch { src, text } => {
            let mut st = ensure_ready(&chat, st, pre.as_ref())?;
            if !dispatch(&chat, &mut st, src, text) {
                return Err(fail("not-sent", "the message could not be written to the producer CLI"));
            }
            Ok(json!({ "state": "dispatching", "epoch": st.core.id() }))
        }
    }
}

/// **끊기**(✕ = `deliverQueued: false` · [끊고 전달] = true) — 그 자리의 `wait_run` 을 **먼저** 취소하고(설계 3-3 — 채팅 잠금 밖) 의도를 턴에
/// 붙인 뒤 CLI 에 끊기를 보낸다. 쉬는 중이면 끊을 턴이 없다(false) — 그때 `deliverQueued` 면 보류된 대기열을 곧바로 보낸다.
fn op_interrupt(b: InterruptBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let live = lock(&chat.st).core.live();
    if let (Some(p), Some(o)) = (live, orch()) {
        o.cancel_seat_waits(&seat(&chat.id, p));
    }
    let pre = if b.deliver_queued { pre_spawn(&chat)? } else { None };
    let mut st = lock(&chat.st);
    let (send, next) = st.input.interrupt(b.deliver_queued, now_ms());
    let sent = send && send_interrupt(&chat, &mut st);
    if let Next::Dispatch { src, text } = next {
        let mut st = ensure_ready(&chat, st, pre.as_ref())?;
        dispatch(&chat, &mut st, src, text);
    }
    Ok(json!(sent))
}

fn op_set_model(b: ModelBody) -> Result<Value, WireError> {
    if !word_ok(&b.model) {
        return Err(fail("bad-model", "invalid model"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    if st.album_starting { return Err(fail("album-starting", "앨범을 여는 중입니다")); }
    st.model = b.model.clone();
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    let step = a.encode_set_model(&b.model).map_err(|w| fail(w, "the model was not changed"))?;
    Ok(json!(chat_proc::apply(&*chat, &mut st, step)))
}

fn op_set_effort(mut b: EffortBody) -> Result<Value, WireError> {
    b.effort = blank_none(b.effort);
    if b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-effort", "invalid reasoning effort"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    if st.album_starting { return Err(fail("album-starting", "앨범을 여는 중입니다")); }
    let Some(a) = st.core.adapter() else {
        st.effort = b.effort;
        return Ok(json!(false));
    };
    let step = a.encode_set_effort(b.effort.as_deref()).map_err(|w| fail(w, "the reasoning effort was not changed"))?;
    st.effort = b.effort;
    Ok(json!(chat_proc::apply(&*chat, &mut st, step)))
}

/// **사람의 권한 결정** — 카드로 선 요청만(허용 목록 둘 — 정책으로 거절한 요청은 표에 없다 · 설계 4-3).
fn op_decide(b: DecideBody) -> Result<Value, WireError> {
    let decision = match b.decision.as_str() {
        "allow" => Decision::Allow,
        "deny" => Decision::Deny,
        _ => return Err(fail("bad-decision", "unknown decision")),
    };
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    if st.core.id().get() != b.epoch {
        return Err(fail("stale-chat", format!("stale producer process (now {})", st.core.id())));
    }
    if !st.core.is_pending(&b.request_id) {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    }
    let Some(a) = st.core.adapter() else { return Err(fail("unknown-request", "no such permission request is waiting")) };
    let step = a.encode_decision(&b.request_id, decision, b.message.as_deref()).map_err(|w| fail(w, "the decision was not sent"))?;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

fn op_queue_cancel(b: ClientBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    let r = st.input.cancel(&b.client_id).map_err(|w| fail(w, "that message was already sent"))?;
    if r {
        notice(&chat, &st, "queue-changed", None);
    }
    Ok(json!(r))
}

fn op_subscribe(b: SubBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let gen = {
        let mut t = lock(&TABLE);
        t.next_sub += 1;
        t.next_sub
    };
    let album = album_view(&chat.id);
    let mut st = lock(&chat.st);
    st.subs.retain(|s| !(s.conn == conn && s.window == b.window));
    st.subs.push(Sub { conn, window: b.window, gen });
    chat_proc::flush(&*chat, &mut st);
    Ok(json!({ "subGen": gen, "snapshot": snapshot(&chat, &st, album) }))
}

fn op_unsubscribe(b: SubBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    let before = st.subs.len();
    st.subs.retain(|s| !(s.conn == conn && s.window == b.window && Some(s.gen) == b.sub_gen));
    let removed = st.subs.len() != before;
    Ok(json!(removed))
}

/// 끝난 이유를 답한다 — 화면은 `session-gone` 에 스스로 열지 않고 이것을 묻는다(설계 5-2).
fn op_status(b: ChatBody) -> Result<Value, WireError> {
    if !id_ok(&b.chat) {
        return Err(fail("wrong-chat-kind", "that id is not a producer chat"));
    }
    let open = lock(&TABLE).chats.get(&b.chat).cloned();
    match open {
        Some(chat) => {
            let snap = snapshot_of(&chat);
            Ok(json!({ "open": true, "snapshot": snap }))
        }
        None => {
            let why = lock(&TABLE).gone.iter().find(|(c, _)| *c == b.chat).map(|(_, w)| *w).unwrap_or("server-restarted");
            Ok(json!({ "open": false, "gone": why, "album": album_view(&b.chat) }))
        }
    }
}

/// 닫는다(레지스트리에서 지우고 프로세스를 잡째 끝낸다 — 토큰 먼저). 표에 있었나.
fn close(id: &str, why: EndWhy) -> bool {
    let chat = {
        let mut t = lock(&TABLE);
        let Some(c) = t.chats.remove(id) else { return false };
        remember_gone(&mut t, id, why.word());
        c
    };
    let mut st = lock(&chat.st);
    st.input = Input::default();
    close_proc(&chat, &mut st, why);
    crate::chat_token::forget(id);
    true
}

fn list() -> Value {
    let chats: Vec<Arc<ProducerChat>> = lock(&TABLE).chats.values().cloned().collect();
    let mut rows: Vec<Value> = chats
        .iter()
        .map(|c| {
            let st = lock(&c.st);
            let (life, ended) = life_word(st.life);
            json!({
                "chat": c.id,
                "cli": st.cli,
                "model": st.model,
                "repo": st.repo,
                "epoch": st.core.id(),
                "status": st.core.status(),
                "life": life,
                "ended": ended,
                "subs": st.subs.len(),
            })
        })
        .collect();
    rows.sort_by(|a, b| a["chat"].as_str().cmp(&b["chat"].as_str()));
    json!(rows)
}

// ---------------------------------------------------------------------------
// 수명 — 구독 · TTL · 앨범 끝 · 모두 닫기
// ---------------------------------------------------------------------------

/// 서버 연결이 끊겼다 — 그 연결의 구독을 지운다(묶이기 전이면 TTL 이 시작된다).
pub(crate) fn conn_gone(conn: u64) -> usize {
    drop_subs(|s| s.conn == conn)
}

/// 창이 사라졌다(F5 · 크래시 · 파괴) — 그 창의 구독을 지운다(새 페이지가 다시 구독한다). `gens`(GUI 가 그 순간 쥔 그 창의 `subGen` 들 — 단계 5)
/// **그 세대만** 지운다: 같은 라벨의 새 페이지가 그 사이 건 새 구독을 옛 페이지의 늦은 정리가 지우지 않게(설계 7 R11 — 라벨만으로 정리하지 않는다).
pub(crate) fn detach_window(window: &str, gens: &[u64]) -> usize {
    drop_subs(|s| s.window == window && gens.contains(&s.gen))
}

fn drop_subs(pick: impl Fn(&Sub) -> bool) -> usize {
    let chats: Vec<Arc<ProducerChat>> = lock(&TABLE).chats.values().cloned().collect();
    let mut n = 0;
    for c in chats {
        let mut st = lock(&c.st);
        let before = st.subs.len();
        st.subs.retain(|s| !pick(s));
        n += before - st.subs.len();
    }
    if n > 0 {
        wake_reaper();
    }
    n
}

/// 모두 닫는다 — 트레이 [모든 세션 종료] · 서버 끝. 닫은 수.
pub(crate) fn close_all() -> usize {
    let ids: Vec<String> = lock(&TABLE).chats.keys().cloned().collect();
    ids.iter().filter(|id| close(id, EndWhy::CloseAll)).count()
}

/// 표에 있는 채팅 수(진단).
pub(crate) fn live_count() -> usize {
    lock(&TABLE).chats.len()
}

static END_GRACE_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn end_grace() -> Duration {
    match END_GRACE_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => ALBUM_END_GRACE,
        ms => Duration::from_millis(ms),
    }
}

/// 시험 전용 — TTL · 유예를 함께 바꾼다(`None` = 원래대로).
#[cfg(test)]
pub(crate) fn set_end_grace_for_test(d: Option<Duration>) {
    END_GRACE_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
    wake_reaper();
}

/// 한 번 훑는다(시계 · 시험이 부른다) — `Dispatching` 시한 · 묶이기 전 TTL · 앨범 끝. 닫은 프로세스 수.
pub(crate) fn sweep(now: Instant) -> usize {
    let grace = end_grace();
    let chats: Vec<Arc<ProducerChat>> = lock(&TABLE).chats.values().cloned().collect();
    let o = orch();
    let mut closed = 0;
    for c in chats {
        // 귀속 앨범 — 오케스트레이션 잠금은 채팅 잠금 **앞**에서(설계 2-6).
        let album = o.as_ref().and_then(|o| o.producer_album(&c.id));
        let album_gone = album.is_none() && o.as_ref().is_some_and(|o| o.producer_album_gone(&c.id));
        let mut st = lock(&c.st);
        match st.input.dispatch_expired(now_ms(), DISPATCH_MS) {
            Some(Src::Wake { wake_id }) => {
                // 깨움 글은 시작 확인이 없으면 버린다 — 재시도는 오케스트레이션이(`Unacked`).
                st.wake_view = None;
                if let Some(p) = st.core.live() {
                    let s = seat(&c.id, p);
                    orch_later(move |o| o.wake_ended(&s, &wake_id, WakeEnd::Unacked));
                }
            }
            Some(_) => notice(&c, &st, "queue-failed", None),
            None => {}
        }
        if !st.core.has_proc() || st.life != Life::Live {
            continue;
        }
        let idle = st.core.status() != Status::Running && !st.input.busy() && st.input.queue.is_empty();
        // 끝난 앨범 · 보관해 표에서 사라진 앨범(`album_gone`)은 같은 수명이다 — 쉬면 닫고 유예 뒤 끊고 닫는다.
        let ended = album_gone
            || matches!(album, Some((_, crate::orchestration::RunState::Done | crate::orchestration::RunState::Stopped, _)));
        let why = if ended {
            let seen = *st.album_end_seen.get_or_insert(now);
            (idle || now.saturating_duration_since(seen) >= grace).then_some(EndWhy::AlbumEnded)
        } else {
            None
        };
        if let Some(w) = why {
            close_proc(&c, &mut st, w);
            closed += 1;
        }
    }
    closed
}

static REAPER: LazyLock<(Mutex<bool>, Condvar)> = LazyLock::new(|| (Mutex::new(false), Condvar::new()));

/// 시계를 깨운다(처음이면 띄운다 — 스레드 하나 · 1초마다 · 깨우면 곧바로).
fn wake_reaper() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        std::thread::spawn(|| loop {
            let n = sweep(Instant::now());
            if n > 0 {
                log::line(format!("producer chat: closed {n} process(es) (ttl · album end)"));
            }
            // 앱이 깨움(단계 4) — 새 사건이 없어도 시한을 다시 판정한다(설계 3-5).
            wake::tick();
            let (m, cv) = &*REAPER;
            let g = lock(m);
            let (mut g, _) = cv.wait_timeout(g, Duration::from_secs(1)).unwrap_or_else(|e| e.into_inner());
            *g = false;
        });
    });
    let (m, cv) = &*REAPER;
    *lock(m) = true;
    cv.notify_all();
}

// ---------------------------------------------------------------------------
// 시험 — 가짜 CLI · 끼운 오케스트레이션
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) struct FakeCli {
    pub exe: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub root: PathBuf,
    pub mcp_port: Option<u16>,
    /// 스튜디오가 맡겨졌다고 보나 · 그 작업안 칸.
    /// 가짜 대화 색인(갈라 오기 시험 — `(에이전트, 루트)`).
    pub conv_roots: Vec<(&'static str, PathBuf)>,
}

#[cfg(test)]
static FAKE: Mutex<Option<FakeCli>> = Mutex::new(None);
#[cfg(test)]
static TEST_ORCH: Mutex<Option<Arc<Orchestration>>> = Mutex::new(None);
#[cfg(test)]
static TEST_EVENTS: Mutex<Vec<Value>> = Mutex::new(Vec::new());
#[cfg(test)]
static TEST_ARGV: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[cfg(test)]
fn fake() -> MutexGuard<'static, Option<FakeCli>> {
    lock(&FAKE)
}

#[cfg(test)]
fn note_argv_for_test(a: &[String]) {
    *lock(&TEST_ARGV) = a.to_vec();
}

#[cfg(test)]
pub(crate) fn album_brief_for_test(repo: &str) -> String {
    launch::album_fork_brief(repo, Some("run-test"))
}
