//! **채팅 프로세스 코어**(오케스트레이션 2단계 "구조화 프로듀서" 단계 1 — 설계 aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md
//! 1-2 · 9절 단계 1). 사이드 채팅(`server::side_chat`)의 프로세스 몸을 **옮겨 온** 것 — 새로 쓴 것이 아니다. 주인(사이드 채팅 표 · 단계 2 의
//! 프로듀서 레지스트리)이 항목마다 [`Core`] 하나를 자기 잠금 아래 쥐고, 코어는 그 잠금으로 줄 · 조각 · 끝을 반영한다.
//!
//! ## 코어가 쥐는 것 · 쥐지 않는 것
//!
//! | 코어 | 주인 |
//! |---|---|
//! | 띄우기([`start`] — 잡 생성(stdin 파이프) 하나 · 임시 자리 [`Spot`]) · 세 스레드(stdout 줄 → 어댑터 · stderr 꼬리 · 감시) · 어댑터 걸음 적용([`apply`]) · `seq` · 지금 턴 꼬리 · `textDelta` 모으기 · 권한 요청 표(`pending`) · 끝 감지([`Host::on_ending`] → `exited` → [`Host::on_exit`]) · **[`ProcId`]** | 실행 재료([`Launch`] — 인자 · cwd · 환경 · 임시 파일 · 어댑터를 주인이 짓는다) · 임대 · 구독 · TTL · 연결 · 대화 id · 사건을 **어디로** 내보낼지([`Host::on_event`]) · **무엇을 stdin 에 쓸지의 정책**(사람 글 · 결정 · 끊기 · 모델 · 강도 — 주인 op 가 [`Core::adapter`] 로 줄을 짓고 [`apply`] 로 넘긴다) |
//!
//! - 코어는 어댑터의 `handshake` · `on_line` · `close_pending` · `dropped` 만 부른다 — 사람 글 · 결정을 짓는 `encode_*` 는 부르지 않는다(시험
//!   `side_chat_stdin_only_human` 이 이 폴더도 훑는다). stdin 으로 가는 길은 [`apply`] 하나(+ 띄울 때의 악수)이고, 줄은 쓰기 스레드 하나가 순서대로 쓴다.
//! - 실행 파일 · 인자 · 환경은 주인이 지은 [`Launch`] 그대로 넘긴다 — 코어는 환경을 고치거나 더하지 않는다(시험 `side_chat_env_uses_tile_scrub`).
//!
//! ## 세대 — [`ProcId`]
//!
//! 띄울 때마다 **서버 전역 단조 증가** 값 하나(1부터 · 재사용 없음 · 0 = [`ProcId::NONE`] = 아직 안 띄움). 같은 주인 항목을 닫았다 다시 열어도,
//! 다른 주인이어도 겹치지 않는다 — 옛 프로세스의 늦은 줄 · 끝 정리(채팅 토큰 거두기 포함)는 **정확히 같은 `ProcId`** 만 견주므로 새 세대에 닿지
//! 않는다(시험 `proc_id_never_reused`). 단계 1 의 유일한 동작 변화다(예전에는 채팅 항목의 `epoch` 칸 — 닫고 다시 열면 0 부터 다시 셌다).
//!
//! ## 단계 2 를 막지 않는 경계(설계 9절 단계 1)
//!
//! - **종류별 수명** — 코어는 TTL · 떼어 둠 · 임대를 모른다. 끝은 [`Host::on_ending`](잠금 안 · 끝 사건 전 — 토큰 거두기 자리) · [`Host::on_exit`]
//!   (잠금 **밖** — 주인이 다른 잠금을 잡을 수 있다)로만 알린다.
//! - **별도 레지스트리가 코어를 소유** — [`Core`] 는 주인 상태의 칸 하나이고 [`Host`] 는 주인 타입마다 따로 구현한다(표를 나누지 않는다).
//! - **입력 전송기 하나** — 주인이 쓰는 stdin 길은 [`apply`] 하나다. 단계 2 의 프로듀서 전송기는 그 위에 대기열 · 상태기계를 얹는다.
//!
//! **로그**: 코어는 로그를 쓰지 않는다 — 끝 코드 · 버린 줄 수는 [`ProcExit`] 로 주인에게 넘긴다(주인이 id · 세대 · pid 만 적는다).

mod io;
mod spawn;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;

use super::os;
use crate::orchestration::turn;
use crate::side_chat::event::Dropped;
use crate::side_chat::{Adapter, Ev};

pub(crate) use io::{apply, flush};
pub(crate) use spawn::{start, Launch, Spot};

/// `textDelta` 모으는 틈(ms).
const DELTA_MS: u64 = 50;
/// 지금 턴 꼬리의 상한(사건 수 — 넘으면 앞을 버린다 · 지난 쪽은 기록 파일에 있다).
const LIVE_MAX: usize = 4096;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// ProcId
// ---------------------------------------------------------------------------

/// 다음에 줄 [`ProcId`] — 서버 프로세스 전역 하나(1부터).
static NEXT_PROC: AtomicU64 = AtomicU64::new(1);

/// **프로세스 세대** — 서버 전역 단조 증가 · 재사용 없음(머리말 "세대"). 화면 · op 몸에는 수(`epoch`)로 나간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub(crate) struct ProcId(u64);

impl ProcId {
    /// 아직 띄운 적 없음.
    pub(crate) const NONE: ProcId = ProcId(0);

    /// 새 세대 하나 — 띄우기 직전에 주인이 뽑는다(토큰 · 임시 자리 이름이 이 값을 쓴다).
    pub(crate) fn next() -> ProcId {
        ProcId(NEXT_PROC.fetch_add(1, Ordering::SeqCst))
    }

    pub(crate) fn get(self) -> u64 {
        self.0
    }
}

impl std::fmt::Display for ProcId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

// ---------------------------------------------------------------------------
// 코어 상태
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Status {
    /// 프로세스 없음(아직 안 띄움 · 끝남) — 다음 보내기가 띄운다.
    Stopped,
    /// 띄웠고 악수 중.
    Starting,
    /// 보낼 수 있다.
    Ready,
    /// 턴이 돈다.
    Running,
}

/// 모으는 중인 `textDelta`.
struct Delta {
    item: Option<String>,
    text: String,
    since: Instant,
}

/// 산 프로세스.
struct Proc {
    job: Arc<os::JobProc>,
    /// 쓰기 스레드로 가는 줄(끝 `\n` 없이 — 스레드가 붙인다). 떨어뜨리면 stdin 이 닫힌다.
    stdin: mpsc::Sender<String>,
    adapter: Box<dyn Adapter>,
    /// 우리가 닫는 까닭(`closed` · `protocol` · `start-timeout`) — 없으면 끝 코드로 정한다.
    closing: Option<&'static str>,
    stderr: Arc<Mutex<turn::TailRing>>,
    /// 서버 임시 자리 — 떨어지면 지운다.
    _spot: Spot,
}

/// 주인 항목 하나의 프로세스 칸 — 주인의 잠금 아래 산다(프로세스가 바뀌어도 같은 값 — `seq` 는 이어 센다).
pub(crate) struct Core {
    /// 지금(마지막) 프로세스의 세대 — 끝난 뒤에도 남는다(옛 세대 호출 판정 · [`ProcId::NONE`] = 아직 안 띄움).
    id: ProcId,
    status: Status,
    seq: u64,
    live_turn: Vec<Ev>,
    pending: BTreeMap<String, Ev>,
    delta: Option<Delta>,
    proc: Option<Proc>,
}

impl Core {
    pub(crate) fn new() -> Core {
        Core {
            id: ProcId::NONE,
            status: Status::Stopped,
            seq: 0,
            live_turn: Vec::new(),
            pending: BTreeMap::new(),
            delta: None,
            proc: None,
        }
    }

    pub(crate) fn id(&self) -> ProcId {
        self.id
    }

    pub(crate) fn status(&self) -> Status {
        self.status
    }

    pub(crate) fn seq(&self) -> u64 {
        self.seq
    }

    pub(crate) fn live_turn(&self) -> &[Ev] {
        &self.live_turn
    }

    /// 기다리는 권한 요청(요청 id 순).
    pub(crate) fn pending(&self) -> Vec<&Ev> {
        self.pending.values().collect()
    }

    pub(crate) fn is_pending(&self, request_id: &str) -> bool {
        self.pending.contains_key(request_id)
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// 프로세스 칸이 있다(닫는 중 포함).
    pub(crate) fn has_proc(&self) -> bool {
        self.proc.is_some()
    }

    /// 지금 산 프로세스의 세대 — 없거나 닫는 중이면 `None`(채팅 토큰 판정).
    pub(crate) fn live(&self) -> Option<ProcId> {
        self.proc.as_ref().filter(|p| p.closing.is_none()).map(|_| self.id)
    }

    /// 산 프로세스의 어댑터 — 주인 op 가 사람 글 · 결정 · 끊기 · 모델 · 강도의 줄을 짓는다(지은 걸음은 [`apply`] 로).
    pub(crate) fn adapter(&mut self) -> Option<&mut (dyn Adapter + 'static)> {
        self.proc.as_mut().map(|p| p.adapter.as_mut())
    }

    /// 프로세스를 닫는다(잡째) — 끝 사건은 감시 스레드가 낸다.
    pub(crate) fn kill(&mut self, reason: &'static str) {
        if let Some(p) = self.proc.as_mut() {
            if p.closing.is_none() {
                p.closing = Some(reason);
            }
            p.job.terminate();
        }
    }

    /// 상태 · 꼬리 · 기다림 장부에 반영한다(내보내기 전 — 주인 칸은 [`Host::on_event`] 가).
    fn record(&mut self, ev: &Ev) {
        match ev {
            Ev::Ready { .. } => {
                self.status = Status::Ready;
                return;
            }
            Ev::TurnStarted { .. } => {
                self.status = Status::Running;
                self.live_turn.clear();
            }
            Ev::TurnEnded { .. } => {
                // 턴 끝 — 꼬리를 비운다(화면은 기록 파일의 최신 쪽을 다시 받는다 — 사이드 채팅 설계 1절).
                if self.status == Status::Running {
                    self.status = Status::Ready;
                }
                self.live_turn.clear();
                return;
            }
            Ev::Permission { request_id, .. } => {
                self.pending.insert(request_id.clone(), ev.clone());
            }
            Ev::PermissionResolved { request_id, .. } => {
                self.pending.remove(request_id);
            }
            Ev::McpServers { .. } => return,
            Ev::Exited { .. } => {
                self.status = Status::Stopped;
                self.live_turn.clear();
                return;
            }
            _ => {}
        }
        if self.status != Status::Running {
            return;
        }
        // 같은 item 의 조각은 꼬리에서도 하나로.
        if let (Ev::TextDelta { item, text }, Some(Ev::TextDelta { item: last, text: acc })) = (ev, self.live_turn.last_mut()) {
            if item == last {
                acc.push_str(text);
                return;
            }
        }
        self.live_turn.push(ev.clone());
        if self.live_turn.len() > LIVE_MAX {
            let over = self.live_turn.len() - LIVE_MAX;
            self.live_turn.drain(..over);
        }
    }
}

// ---------------------------------------------------------------------------
// 주인
// ---------------------------------------------------------------------------

/// 프로세스가 끝났다 — [`Host::on_exit`] 의 몸(잠금 밖).
pub(crate) struct ProcExit {
    pub proc: ProcId,
    pub code: Option<i64>,
    /// `exit` · `crash` · 우리가 닫은 까닭(`closed` · `protocol` · `start-timeout`).
    pub reason: &'static str,
    pub dropped: Dropped,
}

/// 코어의 주인(사이드 채팅 항목 — 단계 2 의 프로듀서 항목). 코어의 세 스레드가 주인을 `Arc` 로 쥐고 [`Host::state`] 의 잠금 아래에서만 반영한다.
pub(crate) trait Host: Send + Sync + 'static {
    type St: Send;
    /// 주인 상태의 잠금 — 코어 칸([`Host::core`])이 이 안에 산다.
    fn state(&self) -> MutexGuard<'_, Self::St>;
    fn core(st: &mut Self::St) -> &mut Core;
    /// 사건 하나를 코어 장부에 반영하기 **전**(잠금 안) — 주인이 제 칸에서 사건을 채운다(사이드 채팅: `userAccepted` 에 사람이 보낸 글 ·
    /// 그림 이름 — 지금 턴 꼬리에도 그 모양으로 남아 다시 붙은 창이 그린다). 기본은 그대로.
    fn shape(&self, _st: &mut Self::St, _ev: &mut Ev) {}
    /// 사건 하나가 코어 장부에 반영된 뒤(잠금 안) — 주인 칸 반영 · 내보내기. `seq` 는 이 사건의 번호.
    fn on_event(&self, st: &mut Self::St, proc: ProcId, seq: u64, ev: &Ev);
    /// 프로세스가 끝났다(잠금 안 · 프로세스 칸 · 임시 자리 · stdin 은 이미 떨어졌다 · **끝 사건 전**) — 그 세대의 토큰 거두기 같은 것.
    fn on_ending(&self, st: &mut Self::St, proc: ProcId);
    /// 끝 사건을 낸 뒤 — **잠금 밖**.
    fn on_exit(&self, exit: ProcExit);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 시험 `proc_id_never_reused`(설계 9절 단계 1 · 리뷰 F1) — 세대는 서버 전역 단조 증가 · 재사용 없음 · 0(없음)을 주지 않는다. 여러 스레드가
    /// 함께 뽑아도 겹치지 않고 스레드마다 늘어난다. 같은 채팅 id 를 닫았다 다시 열어(새 [`Core`]) 띄운 세대는 옛 세대와 다르므로, 옛 프로세스의
    /// 늦은 끝 정리(`chat_token::revoke(chat, 옛 세대)`)가 새 칸을 거두지 못한다 — 가짜 CLI 통합은 `server::tests_side_chat` 의
    /// `proc_id_never_reused_across_close_open_with_fake_cli`.
    #[test]
    fn proc_id_never_reused() {
        let threads: Vec<_> = (0..8)
            .map(|_| {
                std::thread::spawn(|| {
                    let ids: Vec<ProcId> = (0..500).map(|_| ProcId::next()).collect();
                    assert!(ids.windows(2).all(|w| w[0] < w[1]), "스레드 안에서 늘어난다");
                    ids
                })
            })
            .collect();
        let mut all: Vec<ProcId> = threads.into_iter().flat_map(|t| t.join().unwrap()).collect();
        assert!(all.iter().all(|p| *p != ProcId::NONE && p.get() > 0));
        let n = all.len();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), n, "겹친 세대");

        // 닫고 다시 연 같은 채팅 — 새 코어는 NONE 에서 시작하지만 띄울 때 받는 세대는 옛 것과 다르다.
        let old = ProcId::next();
        let fresh = Core::new();
        assert_eq!(fresh.id(), ProcId::NONE);
        let new = ProcId::next();
        assert!(new > old);
        let mut t = crate::chat_token::ChatTokens::default();
        t.insert("c1", "old".into(), old);
        t.insert("c1", "new".into(), new);
        assert!(!t.revoke("c1", old), "옛 세대의 늦은 거두기는 새 칸을 못 거둔다");
        assert!(t.revoke("c1", new));
    }
}
