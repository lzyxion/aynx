//! **채팅 프로세스 코어** — 사이드 채팅 · 프로듀서 채팅이 함께 쓴다. 주인이 항목마다 [`Core`] 하나를 자기 잠금 아래 쥔다.
//!
//! - 코어는 어댑터의 `handshake` · `on_line` · `close_pending` · `dropped` 만 부른다 — 사람 글 · 결정을 짓는 `encode_*` 는 부르지 않는다
//!   (시험 `side_chat_stdin_only_human` 이 이 폴더도 훑는다). 무엇을 stdin 에 쓸지는 주인의 정책이다.
//! - 실행 파일 · 인자 · 환경은 주인이 지은 [`Launch`] 그대로 넘긴다 — 코어는 환경을 고치거나 더하지 않는다(시험 `side_chat_env_uses_tile_scrub`).
//! - **세대([`ProcId`])는 서버 전역 단조 증가 · 재사용 없음** — 옛 프로세스의 늦은 줄 · 끝 정리(채팅 토큰 거두기 포함)는 정확히 같은
//!   `ProcId` 만 견주므로 새 세대에 닿지 않는다(시험 `proc_id_never_reused`).
//! - 코어는 TTL · 떼어 둠 · 임대를 모른다 — 끝은 [`Host::on_ending`](잠금 안 · 끝 사건 전) · [`Host::on_exit`](잠금 **밖**)로만 알린다.
//! - **입력 전송기 하나** — 주인이 쓰는 stdin 길은 [`apply`] 하나(+ 띄울 때의 악수)이고, 줄은 쓰기 스레드 하나가 순서대로 쓴다.
//! - 코어는 로그를 쓰지 않는다 — 끝 코드 · 버린 줄 수는 [`ProcExit`] 로 주인에게 넘긴다.

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

pub(crate) use io::{apply, flush, push};
pub(crate) use spawn::{start, Launch, Spot};

const DELTA_MS: u64 = 50;
/// 사건 수 — 넘으면 앞을 버린다(지난 쪽은 기록 파일에 있다).
const LIVE_MAX: usize = 4096;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// ProcId
// ---------------------------------------------------------------------------

static NEXT_PROC: AtomicU64 = AtomicU64::new(1);

/// 화면 · op 몸에는 수(`epoch`)로 나간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub(crate) struct ProcId(u64);

impl ProcId {
    /// 아직 띄운 적 없음.
    pub(crate) const NONE: ProcId = ProcId(0);

    /// 띄우기 직전에 주인이 뽑는다(토큰 · 임시 자리 이름이 이 값을 쓴다).
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
    /// 프로세스 없음 — 다음 보내기가 띄운다.
    Stopped,
    Starting,
    Ready,
    Running,
}

struct Delta {
    item: Option<String>,
    text: String,
    since: Instant,
}

struct Proc {
    job: Arc<os::JobProc>,
    /// 끝 `\n` 없이 — 스레드가 붙인다. 떨어뜨리면 stdin 이 닫힌다.
    stdin: mpsc::Sender<String>,
    adapter: Box<dyn Adapter>,
    /// 우리가 닫는 까닭 — 없으면 끝 코드로 정한다.
    closing: Option<&'static str>,
    stderr: Arc<Mutex<turn::TailRing>>,
    /// 떨어지면 지운다.
    _spot: Spot,
}

/// 프로세스가 바뀌어도 같은 값 — `seq` 는 이어 센다.
pub(crate) struct Core {
    /// 끝난 뒤에도 남는다(옛 세대 호출 판정).
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

    pub(crate) fn pending(&self) -> Vec<&Ev> {
        self.pending.values().collect()
    }

    pub(crate) fn is_pending(&self, request_id: &str) -> bool {
        self.pending.contains_key(request_id)
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// 닫는 중 포함.
    pub(crate) fn has_proc(&self) -> bool {
        self.proc.is_some()
    }

    /// 닫는 중이면 `None`(채팅 토큰 판정).
    pub(crate) fn live(&self) -> Option<ProcId> {
        self.proc.as_ref().filter(|p| p.closing.is_none()).map(|_| self.id)
    }

    /// 주인 op 가 줄을 짓는다 — 지은 걸음은 [`apply`] 로 넘긴다.
    pub(crate) fn adapter(&mut self) -> Option<&mut (dyn Adapter + 'static)> {
        self.proc.as_mut().map(|p| p.adapter.as_mut())
    }

    /// 끝 사건은 감시 스레드가 낸다.
    pub(crate) fn kill(&mut self, reason: &'static str) {
        if let Some(p) = self.proc.as_mut() {
            if p.closing.is_none() {
                p.closing = Some(reason);
            }
            p.job.terminate();
        }
    }

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
                // 꼬리를 비운다 — 화면은 기록 파일의 최신 쪽을 다시 받는다.
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
            // 화면 칩의 사실(외부 MCP 이름 · 사이드 채팅의 권한 모드)이라 지금 턴 꼬리에 넣지 않는다 — 스냅숏의 칸이 맞춘다.
            Ev::McpServers { .. } | Ev::PermPolicy { .. } => return,
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

pub(crate) struct ProcExit {
    pub proc: ProcId,
    pub code: Option<i64>,
    /// `exit` · `crash` · 우리가 닫은 까닭(`closed` · `protocol` · `start-timeout`).
    pub reason: &'static str,
    pub dropped: Dropped,
}

/// 코어의 세 스레드가 주인을 `Arc` 로 쥐고 [`Host::state`] 의 잠금 아래에서만 반영한다.
pub(crate) trait Host: Send + Sync + 'static {
    type St: Send;
    fn state(&self) -> MutexGuard<'_, Self::St>;
    fn core(st: &mut Self::St) -> &mut Core;
    /// 코어 장부에 반영하기 **전**(잠금 안) — 지금 턴 꼬리에도 채운 모양으로 남아 다시 붙은 창이 그린다.
    fn shape(&self, _st: &mut Self::St, _ev: &mut Ev) {}
    /// 잠금 안. `seq` 는 이 사건의 번호.
    fn on_event(&self, st: &mut Self::St, proc: ProcId, seq: u64, ev: &Ev);
    /// 잠금 안 · 프로세스 칸 · 임시 자리 · stdin 은 이미 떨어졌다 · **끝 사건 전** — 그 세대의 토큰 거두기 자리.
    fn on_ending(&self, st: &mut Self::St, proc: ProcId);
    /// **잠금 밖** — 주인이 다른 잠금을 잡을 수 있다.
    fn on_exit(&self, exit: ProcExit);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 가짜 CLI 통합은 `server::tests_side_chat` 의 `proc_id_never_reused_across_close_open_with_fake_cli`.
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
