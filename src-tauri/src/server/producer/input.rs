//! **입력 상태기계** — 순수. 사람 글 · 대기열 · 깨움이 stdin 에 닿는 길은 **전송기 하나**이고, 그 판정이 이 파일이다.
//!
//! - `Dispatching`(stdin 에 썼고 턴 시작을 아직 못 봤다)도 **실행 중으로 친다** — 턴 중 입력은 두 CLI 모두 지금 턴에 섞인다.
//! - 사람 글은 늘 깨움보다 먼저 — 깨움은 쉬고 · 대기열이 비고 · 보류가 없을 때만 예약된다. 깨움 글은 대기열에 넣지 않는다.
//! - **끊기 의도는 턴에 붙는다** — 다음 턴 끝이 어떤 결과든 소비한다. 그래서 끊기 ↔ 자연 종료 경합이 대기열 처리를 바꾸지 않는다.
//! - 사람 글은 **자동 재전송하지 않는다**(중복 위험) — 못 보내면 `failed` 로 맨 앞에 두고 보류한다. 프로세스 끝에 자동 재시작 없음.

use std::collections::VecDeque;

pub(crate) const QUEUE_MAX: usize = 3;
pub(crate) const SEEN_MAX: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Src {
    Human { client_id: String },
    Queue { client_id: String },
    /// 오케스트레이션이 장부에서 지은 고정 문장(`orchestration::wake::wake_text`). 대기열 · 중복 제거 밖.
    Wake { wake_id: String },
}

impl Src {
    pub(crate) fn client_id(&self) -> &str {
        match self {
            Src::Human { client_id } | Src::Queue { client_id } => client_id,
            Src::Wake { wake_id } => wake_id,
        }
    }

    fn is_wake(&self) -> bool {
        matches!(self, Src::Wake { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Phase {
    /// 프로세스가 없어도 보낼 수 있다 — 보내기가 띄운다.
    Idle,
    /// `since` 는 부르는 쪽의 시각(ms · 시한 판정).
    Dispatching { src: Src, text: String, since: u64, stop: Option<bool> },
    /// `stop` = 끊기 의도(`Some(deliverQueued)`).
    Running { src: Src, stop: Option<bool> },
    /// 오케스트레이션 판정을 기다린다 — 실행 중으로 친다(사람 글은 대기열로).
    WakeReserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClientState {
    Queued,
    Dispatching,
    Sent,
    Cancelled,
    Failed,
}

impl ClientState {
    pub(crate) fn word(self) -> &'static str {
        match self {
            ClientState::Queued => "queued",
            ClientState::Dispatching => "dispatching",
            ClientState::Sent => "sent",
            ClientState::Cancelled => "cancelled",
            ClientState::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Seen {
    client_id: String,
    sha: String,
    state: ClientState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Queued {
    pub client_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Submit {
    /// 부르는 쪽이 이 글을 쓴다.
    Dispatch { src: Src, text: String },
    /// 1부터.
    Queued { position: usize },
    /// 같은 `clientId` 의 재전송 — 효과 없음.
    Duplicate(ClientState),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Next {
    Dispatch { src: Src, text: String },
    Nothing,
}

/// 코어의 `turnEnded.outcome`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum End {
    Natural,
    Interrupted,
    Error,
}

#[derive(Debug, Clone)]
pub(crate) struct Input {
    pub phase: Phase,
    pub queue: VecDeque<Queued>,
    /// 사람이 [보내기] · 새 글을 보내면 풀린다.
    pub held: bool,
    seen: VecDeque<Seen>,
}

impl Default for Input {
    fn default() -> Self {
        Input { phase: Phase::Idle, queue: VecDeque::new(), held: false, seen: VecDeque::new() }
    }
}

fn sha(text: &str) -> String {
    crate::orchestration::verify::sha256_hex(text.as_bytes())
}

impl Input {
    fn mark(&mut self, client_id: &str, state: ClientState) {
        if let Some(s) = self.seen.iter_mut().find(|s| s.client_id == client_id) {
            s.state = state;
        }
    }

    pub(crate) fn state_of(&self, client_id: &str) -> Option<ClientState> {
        self.seen.iter().find(|s| s.client_id == client_id).map(|s| s.state)
    }

    pub(crate) fn busy(&self) -> bool {
        !matches!(self.phase, Phase::Idle)
    }

    fn take_front(&mut self, now: u64) -> Option<(Src, String)> {
        if self.busy() || self.held {
            return None;
        }
        let q = self.queue.pop_front()?;
        let src = Src::Queue { client_id: q.client_id.clone() };
        self.mark(&q.client_id, ClientState::Dispatching);
        self.phase = Phase::Dispatching { src: src.clone(), text: q.text.clone(), since: now, stop: None };
        Some((src, q.text))
    }

    /// `can_dispatch` = 프로세스가 끝나는 중(`Exiting`)이 아니다.
    pub(crate) fn submit(&mut self, client_id: &str, text: &str, now: u64, can_dispatch: bool) -> Result<Submit, &'static str> {
        let h = sha(text);
        if let Some(s) = self.seen.iter().find(|s| s.client_id == client_id) {
            if s.sha != h {
                return Err("client-id-reused");
            }
            return Ok(Submit::Duplicate(s.state));
        }
        let free = !self.busy() && can_dispatch;
        if free && self.queue.is_empty() {
            self.held = false;
            self.remember(client_id, h, ClientState::Dispatching);
            let src = Src::Human { client_id: client_id.to_string() };
            self.phase = Phase::Dispatching { src: src.clone(), text: text.to_string(), since: now, stop: None };
            return Ok(Submit::Dispatch { src, text: text.to_string() });
        }
        if self.queue.len() >= QUEUE_MAX {
            return Err("queue-full");
        }
        self.remember(client_id, h, ClientState::Queued);
        self.queue.push_back(Queued { client_id: client_id.to_string(), text: text.to_string() });
        if free {
            self.held = false;
            if let Some((src, text)) = self.take_front(now) {
                return Ok(Submit::Dispatch { src, text });
            }
        }
        Ok(Submit::Queued { position: self.queue.len() })
    }

    fn remember(&mut self, client_id: &str, sha: String, state: ClientState) {
        if self.seen.len() >= SEEN_MAX {
            self.seen.pop_front();
        }
        self.seen.push_back(Seen { client_id: client_id.to_string(), sha, state });
    }

    /// 전송과 같은 잠금에서 판정된다.
    pub(crate) fn cancel(&mut self, client_id: &str) -> Result<bool, &'static str> {
        match self.state_of(client_id) {
            Some(ClientState::Queued) => {
                self.queue.retain(|q| q.client_id != client_id);
                self.mark(client_id, ClientState::Cancelled);
                Ok(true)
            }
            Some(ClientState::Dispatching | ClientState::Sent) => Err("already-sent"),
            _ => Ok(false),
        }
    }

    pub(crate) fn write_failed(&mut self) {
        if let Phase::Dispatching { src, text, .. } = std::mem::replace(&mut self.phase, Phase::Idle) {
            self.fail_back(src, text);
        }
    }

    /// 깨움 글은 버린다 — 오케스트레이션이 재시도를 정한다.
    fn fail_back(&mut self, src: Src, text: String) {
        if src.is_wake() {
            return;
        }
        let id = src.client_id().to_string();
        self.mark(&id, ClientState::Failed);
        self.queue.push_front(Queued { client_id: id, text });
        self.held = true;
    }

    /// 끊기 의도가 이미 있으면 true(곧바로 끊기를 보낸다).
    pub(crate) fn turn_started(&mut self) -> bool {
        match std::mem::replace(&mut self.phase, Phase::Idle) {
            Phase::Dispatching { src, stop, .. } => {
                self.mark(src.client_id(), ClientState::Sent);
                self.phase = Phase::Running { src, stop };
                stop.is_some()
            }
            other => {
                self.phase = other;
                false
            }
        }
    }

    /// true 면 부르는 쪽이 CLI 에 끊기를 보낸다(`Dispatching` 이면 턴 시작을 본 즉시).
    pub(crate) fn interrupt(&mut self, deliver_queued: bool, now: u64) -> (bool, Next) {
        match &mut self.phase {
            Phase::Running { stop, .. } => {
                *stop = Some(deliver_queued);
                (true, Next::Nothing)
            }
            Phase::Dispatching { stop, .. } => {
                *stop = Some(deliver_queued);
                (false, Next::Nothing)
            }
            Phase::WakeReserved => (false, Next::Nothing),
            Phase::Idle => {
                if deliver_queued {
                    self.held = false;
                    if let Some((src, text)) = self.take_front(now) {
                        return (false, Next::Dispatch { src, text });
                    }
                }
                (false, Next::Nothing)
            }
        }
    }


    pub(crate) fn turn_ended(&mut self, end: End, now: u64) -> Next {
        let stop = match std::mem::replace(&mut self.phase, Phase::Idle) {
            Phase::Running { stop, .. } => stop,
            Phase::Dispatching { src, text, stop, .. } => {
                // 턴 시작 없이 끝(Codex `turn/start` 오류) — 그 글은 받아들여지지 않았다.
                self.fail_back(src, text);
                stop
            }
            Phase::Idle | Phase::WakeReserved => None,
        };
        match (stop, end) {
            (Some(true), _) => {
                self.held = false;
                self.take_front(now).map_or(Next::Nothing, |(src, text)| Next::Dispatch { src, text })
            }
            (Some(false), _) | (None, End::Error) => {
                self.held = !self.queue.is_empty();
                Next::Nothing
            }
            (None, End::Natural | End::Interrupted) => {
                self.take_front(now).map_or(Next::Nothing, |(src, text)| Next::Dispatch { src, text })
            }
        }
    }

    pub(crate) fn proc_exited(&mut self) {
        match std::mem::replace(&mut self.phase, Phase::Idle) {
            Phase::Dispatching { src, text, .. } => self.fail_back(src, text),
            Phase::Running { .. } | Phase::Idle | Phase::WakeReserved => {}
        }
        self.held = !self.queue.is_empty();
    }

    /// 사람 글은 **자동 재전송하지 않는다**(중복 위험). 깨움 글은 버린다 — 부르는 쪽이 오케스트레이션에 알린다.
    pub(crate) fn dispatch_expired(&mut self, now: u64, deadline_ms: u64) -> Option<Src> {
        let src = match &self.phase {
            Phase::Dispatching { since, src, .. } if now.saturating_sub(*since) >= deadline_ms => src.clone(),
            _ => return None,
        };
        self.write_failed();
        Some(src)
    }

    /// 이 순간부터 사람 글은 대기열로 간다 — 사람 글이 먼저 접수됐으면 이미 `Idle` 이 아니다(사람 우선).
    pub(crate) fn reserve_wake(&mut self) -> bool {
        if self.phase != Phase::Idle || !self.queue.is_empty() || self.held {
            return false;
        }
        self.phase = Phase::WakeReserved;
        true
    }

    pub(crate) fn wake_reserved(&self) -> bool {
        self.phase == Phase::WakeReserved
    }

    pub(crate) fn start_wake(&mut self, wake_id: &str, text: &str, now: u64) -> Src {
        let src = Src::Wake { wake_id: wake_id.to_string() };
        self.phase = Phase::Dispatching { src: src.clone(), text: text.to_string(), since: now, stop: None };
        src
    }

    pub(crate) fn release_wake(&mut self, now: u64) -> Next {
        if self.phase != Phase::WakeReserved {
            return Next::Nothing;
        }
        self.phase = Phase::Idle;
        self.take_front(now).map_or(Next::Nothing, |(src, text)| Next::Dispatch { src, text })
    }

    pub(crate) fn live_wake(&self) -> Option<(String, bool)> {
        match &self.phase {
            Phase::Dispatching { src: Src::Wake { wake_id }, stop, .. } | Phase::Running { src: Src::Wake { wake_id }, stop } => {
                Some((wake_id.clone(), stop.is_some()))
            }
            _ => None,
        }
    }

    /// 깨움 턴 시한 — 시계가 붙이는 유일한 끊기다.
    pub(crate) fn stop_wake(&mut self) -> bool {
        match &mut self.phase {
            Phase::Running { src: Src::Wake { .. }, stop } => {
                *stop = Some(true);
                true
            }
            _ => false,
        }
    }

    /// 서버는 본문을 다시 보내지 않는다 — 글은 화면이 이미 안다.
    pub(crate) fn queue_view(&self) -> serde_json::Value {
        let rows: Vec<serde_json::Value> = self
            .queue
            .iter()
            .map(|q| {
                let st = self.state_of(&q.client_id).unwrap_or(ClientState::Queued);
                serde_json::json!({ "clientId": q.client_id, "state": st.word() })
            })
            .collect();
        serde_json::json!({ "items": rows, "held": self.held })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dispatched(s: Submit) -> String {
        match s {
            Submit::Dispatch { text, .. } => text,
            other => panic!("보내지 않음: {other:?}"),
        }
    }

    /// 시험 `producer_queue_table` — 끝난 이유별 대기열 처리.
    #[test]
    fn producer_queue_table() {
        // 자연 종료 → 맨 앞 곧바로.
        let mut i = Input::default();
        assert_eq!(dispatched(i.submit("a", "A", 0, true).unwrap()), "A");
        assert_eq!(i.submit("b", "B", 1, true).unwrap(), Submit::Queued { position: 1 });
        assert!(!i.turn_started());
        assert_eq!(i.turn_ended(End::Natural, 2), Next::Dispatch { src: Src::Queue { client_id: "b".into() }, text: "B".into() });
        assert!(i.busy());
        i.turn_started();
        assert_eq!(i.turn_ended(End::Natural, 3), Next::Nothing);
        assert!(!i.busy());

        // ✕(deliverQueued false) → 보류 · 결과 무관(엇갈린 자연 종료도).
        for end in [End::Interrupted, End::Natural, End::Error] {
            let mut i = Input::default();
            i.submit("a", "A", 0, true).unwrap();
            i.turn_started();
            i.submit("b", "B", 1, true).unwrap();
            assert_eq!(i.interrupt(false, 1), (true, Next::Nothing));
            assert_eq!(i.turn_ended(end, 2), Next::Nothing, "{end:?}");
            assert!(i.held);
            // 사람이 [보내기](= 쉬는 중의 끊고 전달) → 보류 풀고 맨 앞.
            assert_eq!(i.interrupt(true, 3).1, Next::Dispatch { src: Src::Queue { client_id: "b".into() }, text: "B".into() });
        }

        // [끊고 전달] → 결과 무관 맨 앞 곧바로.
        for end in [End::Interrupted, End::Natural, End::Error] {
            let mut i = Input::default();
            i.submit("a", "A", 0, true).unwrap();
            i.turn_started();
            i.submit("b", "B", 1, true).unwrap();
            assert!(i.interrupt(true, 1).0);
            assert!(matches!(i.turn_ended(end, 2), Next::Dispatch { .. }), "{end:?}");
        }

        // 오류 끝(의도 없음) → 보류 · 새 글이 풀고 앞 것부터.
        let mut i = Input::default();
        i.submit("a", "A", 0, true).unwrap();
        i.turn_started();
        i.submit("b", "B", 1, true).unwrap();
        assert_eq!(i.turn_ended(End::Error, 2), Next::Nothing);
        assert!(i.held);
        assert_eq!(dispatched(i.submit("c", "C", 3, true).unwrap()), "B", "보류된 앞 것부터");
        assert_eq!(i.queue.len(), 1);

        // 프로세스 끝 — 보내던 글은 failed 로 맨 앞 · 보류.
        let mut i = Input::default();
        i.submit("a", "A", 0, true).unwrap();
        i.proc_exited();
        assert_eq!(i.state_of("a"), Some(ClientState::Failed));
        assert!(i.held && i.queue.len() == 1);

        // Exiting 중의 글은 대기열로.
        let mut i = Input::default();
        assert_eq!(i.submit("a", "A", 0, false).unwrap(), Submit::Queued { position: 1 });

        // 대기열 상한.
        let mut i = Input::default();
        i.submit("a", "A", 0, true).unwrap();
        for n in 0..QUEUE_MAX {
            i.submit(&format!("q{n}"), "x", 0, true).unwrap();
        }
        assert_eq!(i.submit("over", "x", 0, true).unwrap_err(), "queue-full");
    }

    /// 시험 `producer_wake_input`: 깨움은 쉬고 · 대기열이 비고 · 보류가 없을 때만 예약된다(사람 우선) · 예약 중의 사람 글은
    /// 대기열로 · 예약을 거두면 그 글부터 · 깨움 글은 못 쓰거나 시작 확인이 없어도 대기열로 되돌리지 않는다 · 깨움 턴 시한의 끊기는 깨움 턴에만 ·
    /// 끊기 의도가 붙은 깨움 턴은 `live_wake` 가 알린다.
    #[test]
    fn producer_wake_input() {
        // 사람 글이 먼저면 예약되지 않는다.
        let mut i = Input::default();
        i.submit("h", "H", 0, true).unwrap();
        assert!(!i.reserve_wake());
        // 보류된 대기열이 있으면 예약되지 않는다.
        i.turn_started();
        i.submit("q", "Q", 0, true).unwrap();
        i.interrupt(false, 0);
        i.turn_ended(End::Interrupted, 1);
        assert!(i.held && !i.reserve_wake(), "보류 = 사람 우선");
        // 예약 중의 사람 글 → 대기열 · 거두면 그 글부터.
        let mut i = Input::default();
        assert!(i.reserve_wake() && i.busy());
        assert_eq!(i.submit("h", "H", 0, true).unwrap(), Submit::Queued { position: 1 });
        assert_eq!(i.release_wake(1), Next::Dispatch { src: Src::Queue { client_id: "h".into() }, text: "H".into() });
        // 예약 → 보냄 → 못 씀: 대기열로 되돌리지 않는다(사람 글이 아니다).
        let mut i = Input::default();
        assert!(i.reserve_wake());
        let src = i.start_wake("wake-1", "N", 0);
        assert_eq!(i.live_wake(), Some(("wake-1".into(), false)));
        i.write_failed();
        assert!(i.queue.is_empty() && !i.held && !i.busy(), "{src:?}");
        // 시작 확인 없음 — 출처를 돌려준다 · 대기열 그대로.
        assert!(i.reserve_wake());
        i.start_wake("wake-2", "N", 0);
        assert_eq!(i.dispatch_expired(30_000, 30_000), Some(Src::Wake { wake_id: "wake-2".into() }));
        assert!(i.queue.is_empty() && !i.held);
        // 시한 끊기는 깨움 턴에만 · 사람 턴에는 붙지 않는다.
        let mut i = Input::default();
        i.submit("h", "H", 0, true).unwrap();
        i.turn_started();
        assert!(!i.stop_wake());
        i.turn_ended(End::Natural, 1);
        assert!(i.reserve_wake());
        i.start_wake("wake-3", "N", 2);
        i.turn_started();
        assert!(i.stop_wake());
        assert_eq!(i.live_wake(), Some(("wake-3".into(), true)));
        // 프로세스 끝 — 예약 · 깨움 글은 대기열로 가지 않는다.
        i.proc_exited();
        assert!(i.queue.is_empty() && i.live_wake().is_none());
    }

    /// 시험 `producer_input_races`: 두 창 보내기 · 같은 clientId 재전송 · 취소 ↔ 전송 · `turnStarted` 지연 · interrupt ↔ 자연 종료.
    #[test]
    fn producer_input_races() {
        let mut i = Input::default();
        // 두 창이 곧바로 보냄 — 둘째는 Dispatching(턴 시작 전)이라도 실행 중으로 쳐 대기열로.
        assert!(matches!(i.submit("w1", "one", 0, true).unwrap(), Submit::Dispatch { .. }));
        assert_eq!(i.submit("w2", "two", 0, true).unwrap(), Submit::Queued { position: 1 });
        // 같은 clientId 재전송 = 같은 답 · 효과 없음 · 글이 다르면 거절.
        assert_eq!(i.submit("w1", "one", 0, true).unwrap(), Submit::Duplicate(ClientState::Dispatching));
        assert_eq!(i.submit("w1", "other", 0, true).unwrap_err(), "client-id-reused");
        assert_eq!(i.queue.len(), 1);
        // 취소 ↔ 전송: 큐에 있으면 취소가 이기고, 보내는 중이면 already-sent.
        assert_eq!(i.cancel("w1").unwrap_err(), "already-sent");
        assert_eq!(i.cancel("w2"), Ok(true));
        assert_eq!(i.cancel("w2"), Ok(false));
        assert_eq!(i.submit("w2", "two", 0, true).unwrap(), Submit::Duplicate(ClientState::Cancelled));
        // turnStarted 지연 — 시한을 넘기면 사람 글은 재전송하지 않고 failed · 보류.
        assert_eq!(i.dispatch_expired(10, 30_000), None);
        assert_eq!(i.dispatch_expired(30_000, 30_000), Some(Src::Human { client_id: "w1".into() }));
        assert_eq!(i.state_of("w1"), Some(ClientState::Failed));
        assert!(i.held && !i.busy());
        // 끊기가 Dispatching 에 붙으면 턴 시작을 본 즉시 끊는다.
        let mut i = Input::default();
        i.submit("a", "A", 0, true).unwrap();
        assert_eq!(i.interrupt(false, 0), (false, Next::Nothing));
        assert!(i.turn_started(), "턴이 서자마자 끊기");
        // interrupt ↔ 자연 종료: 의도는 어떤 끝이 와도 한 번 소비된다 — 다음 턴에 남지 않는다.
        i.submit("b", "B", 0, true).unwrap();
        assert_eq!(i.turn_ended(End::Natural, 1), Next::Nothing);
        assert!(i.held);
        assert!(matches!(i.interrupt(true, 2).1, Next::Dispatch { .. }));
        i.turn_started();
        assert!(matches!(i.phase, Phase::Running { stop: None, .. }), "옛 의도가 새 턴에 붙지 않는다");
    }
}
