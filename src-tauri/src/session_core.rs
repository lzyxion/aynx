//! 세션 코어 — 세션의 표 · 임대 · 종료 장부(로컬 PTY · SSH 대화형 타일 — 헤드리스는 오르지 않는다). Tauri 도 자원도 모르는 순수 [`Core`].
//!
//! "누가 이 세션을 쥐었나" 는 코어만 안다 — 자원 표(`crate::pty` · `crate::ssh::session`)의 u32 id 는 내부 손잡이일 뿐이고
//! 두 표의 카운터가 따로 돌아 손잡이는 늘 `(Kind, id)` 다. 책임 창 라벨은 [`Entry::home`] 한 곳에만 둔다.
//!
//! ## 열쇠 셋과 임대 규칙
//!
//! - `stream` = 타일의 계보 · `session_epoch` = 그 계보의 실행 회차(표에서 지워져도 [`Core::epochs`] 가 기억한다) ·
//!   `lease_epoch` = 그 회차 안의 임대 회차.
//! - write · resize · pause · resume 은 열쇠 셋이 지금 붙어 있는 임대와 같아야 한다. close 는 상태와 무관하게 회차 둘만 같으면 된다. 다르면 `[stale-lease]`.
//! - 열기는 스트림별 예약을 먼저 잡는다 — 살아 있으면 `[session-alive]`(붙으라는 뜻), 다른 열기가 진행 중이면 `[session-busy]`.
//!   SSH 재접속은 새 채널 = 새 세션이라 회차 +1 이다.
//! - 둘째 창의 붙기는 거절(`[session-attached]`) — `take` 를 주면 옛 임대를 즉시 무효화하고 이전한다.
//! - 시청자([`viewers`] 머리말)는 주 임대 규칙과 따로 빼앗지 않고 덧붙는다. 주 · 시청자의 임대 회차는 한 카운터([`Entry::issued`])라
//!   겹치지 않고, 쓰기 · 크기 · ACK 는 둘 다 받는다 — 닫기 · 체크포인트 · `detach` 는 주의 열쇠로만.
//!
//! ## 잠금 순서
//!
//! `crate::reap` generation → 코어 → `pty::Sessions`·`ssh::SshSessions` 표 → 출력 슬롯. 코어 잠금을 쥔 채 `await`·블로킹하지
//! 않는다. 반대 방향(표를 쥔 채 코어)은 어디에도 없다.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::i18n::tr;

pub(crate) mod commands;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_viewers;
mod viewers;

pub(crate) use viewers::{GoneReason, Holder, Note, Viewer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Kind {
    Local,
    Ssh,
}

impl Kind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Kind::Local => "local",
            Kind::Ssh => "ssh",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum State {
    Attached,
    Detached,
    /// 붙은 창이 닫기를 부를 때까지 항목이 남는다 — 떨어진 채 끝났으면 곧바로 지운다.
    Exited {
        reason: Option<String>,
        final_offset: u64,
    },
    /// SSH 전송로가 끊겼다(셸이 끝났다는 증거 없이). 자원은 이미 거뒀고 재접속이 새 회차로 덮는다.
    Disconnected { at_ms: u64, reason: Option<String> },
}

impl State {
    fn ended(&self) -> bool {
        matches!(self, State::Exited { .. } | State::Disconnected { .. })
    }

    fn name(&self) -> &'static str {
        match self {
            State::Attached => "attached",
            State::Detached => "detached",
            State::Exited { .. } => "exited",
            State::Disconnected { .. } => "disconnected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum End {
    Exited {
        reason: Option<String>,
        final_offset: u64,
    },
    Disconnected {
        at_ms: u64,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Lease {
    pub window: String,
    pub epoch: u64,
    /// 세션 서버의 연결 번호(1부터) — 끊기면 그 연결의 임대를 모두 푼다. 같은 프로세스 안(GUI 의 SSH)에서는 늘 0.
    pub conn: u64,
}

#[derive(Debug)]
pub(crate) struct Entry {
    pub kind: Kind,
    pub id: u32,
    pub session_epoch: u64,
    pub state: State,
    /// `Attached` 일 때만 `Some`.
    pub lease: Option<Lease>,
    /// 주의 마지막 임대 회차 — 떨어진 뒤에도 남아 떨어진 뒤의 닫기를 이 값으로 검사한다.
    pub last_lease: u64,
    /// 이 세션을 책임지는 창 — 떨어졌으면 마지막으로 붙어 있던 창. 창 파괴 거둠 · 복원 뒤 고아 정리가 이 라벨로 고른다.
    pub home: String,
    #[allow(dead_code)] // 진단용 — 목록은 벽시계(`opened_at_ms`)를 보인다.
    pub opened_at: Instant,
    pub opened_at_ms: u64,
    /// `Detached` 일 때만 `Some`.
    pub detached_at_ms: Option<u64>,
    /// 복원이 데려가지 않은 떨어진 세션 — 닫지 않고 떨어진 세션 목록에 남긴다. 붙으면 지운다.
    pub unclaimed: bool,
    /// 로컬 타일의 "AI 읽기 허용" — 재부착이 되살린다. SSH 는 호스트 AI 권한이 정해 이 칸을 쓰지 않는다.
    pub ai_read: bool,
    pub viewers: Vec<Viewer>,
    /// 주 · 시청자 공용 임대 회차 카운터 — 둘의 열쇠가 겹치지 않게.
    pub issued: u64,
    /// 크기 주인의 임대 회차 — 마지막으로 입력한 자격 있는 쪽(tmux `latest`)이고 터미널 질의(DSR·DA·DECRQM)에도 답한다.
    /// `None` 이면 서버가 대신 답한다.
    pub size_owner: Option<u64>,
    /// 크기 주인이 아닐 때 받은 주의 resize — 주인이 되면 적용한다.
    pub primary_size: Option<(u16, u16)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DetachedRow {
    pub stream: String,
    pub kind: Kind,
    pub id: u32,
    pub home: String,
    pub opened_at_ms: u64,
    pub detached_at_ms: Option<u64>,
    pub unclaimed: bool,
    pub ai_read: bool,
}

/// 프런트 `SessionLease`(`session/contract.ts`)와 같은 모양.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keys {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
}

/// 창이 맡겨 두는 화면 한 장 — 세션당 최근 1장.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub buffer: String,
    pub cols: u16,
    pub rows: u16,
    /// 그 화면에 반영돼 있던 출력 오프셋(꼬리 링 축) — 붙기가 이 뒤를 재생한다.
    pub consumed: u64,
    /// 다른 회차의 세션에는 쓰지 않는다.
    pub session_epoch: u64,
}

/// 표에 없는 스트림의 것에만 — 살아 있는 세션의 체크포인트는 닫힐 때 간다.
pub(crate) const CHECKPOINT_TTL: Duration = Duration::from_secs(300);
/// 넘으면 받지 않는다(링만으로 복원).
pub(crate) const CHECKPOINT_MAX_BYTES: usize = 8 * 1024 * 1024;

/// 프런트는 이유 코드(`errors.rs`)로 갈래를 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CoreError {
    Gone,
    Stale,
    Alive,
    Busy,
    Attached,
    TooLarge,
}

impl CoreError {
    pub(crate) fn message(self) -> String {
        use crate::errors::{
            with_reason, SESSION_ALIVE, SESSION_ATTACHED, SESSION_BUSY, STALE_LEASE,
        };
        match self {
            CoreError::Gone => crate::errors::session_gone_closed(),
            CoreError::Stale => with_reason(
                STALE_LEASE,
                tr!(
                    ko: "이 타일의 세션 손잡이가 낡았습니다 — 다른 창이 세션을 가져갔거나 새 세션으로 바뀌었습니다",
                    en: "This tile's session handle is stale — another window took the session or it was replaced"
                ),
            ),
            CoreError::Alive => with_reason(
                SESSION_ALIVE,
                tr!(
                    ko: "이 타일의 세션이 아직 살아 있습니다 — 새로 열지 않고 다시 붙습니다",
                    en: "This tile's session is still alive — attach to it instead of opening a new one"
                ),
            ),
            CoreError::Busy => with_reason(
                SESSION_BUSY,
                tr!(
                    ko: "이 타일의 세션을 이미 여는 중입니다",
                    en: "This tile's session is already being opened"
                ),
            ),
            CoreError::Attached => with_reason(
                SESSION_ATTACHED,
                tr!(
                    ko: "다른 창이 이 세션에 붙어 있습니다",
                    en: "Another window is attached to this session"
                ),
            ),
            CoreError::TooLarge => tr!(
                ko: "화면 체크포인트가 너무 큽니다",
                en: "The screen checkpoint is too large"
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Attach {
    pub kind: Kind,
    pub id: u32,
    pub keys: Keys,
    pub taken_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exit {
    pub stream: String,
    pub session_epoch: u64,
    /// 떨어진 채 끝나 표에서 곧바로 지웠다.
    pub removed: bool,
}

/// 프런트 부팅 복원이 "붙을까 열까" 를 고른다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// `"none"` · `"attached"` · `"detached"` · `"exited"` · `"disconnected"` (예약 중이면 `"opening"`)
    pub state: &'static str,
    /// 프런트는 타일 종류와 다르면 붙지 않는다.
    pub kind: Option<&'static str>,
    pub session_epoch: Option<u64>,
    pub checkpoint: Option<Checkpoint>,
    pub ai_read: bool,
}

struct Stashed {
    checkpoint: Checkpoint,
    at: Instant,
}

/// 시간은 인자로 받는다(시험이 시계를 안 쓴다).
#[derive(Default)]
pub(crate) struct Core {
    streams: HashMap<String, Entry>,
    by_id: HashMap<(Kind, u32), String>,
    reserved: HashSet<String>,
    /// 지우지 않는다 — 지우면 옛 회차와 겹칠 수 있다.
    epochs: HashMap<String, u64>,
    checkpoints: HashMap<String, Stashed>,
    /// 임대에 연결을 적는 순간 그 연결이 이미 끊겼으면 붙이지 않고 떨어뜨린다([`Core::set_lease_conn`]).
    live_conns: HashSet<u64>,
    /// 코어는 자원을 모르므로 알리기만 하고, 서버가 코어 잠금 밖에서 처리한다(`server::sessions::settle`).
    notes: Vec<Note>,
}

impl Core {
    pub(crate) fn reserve(&mut self, stream: &str) -> Result<(), CoreError> {
        if self.reserved.contains(stream) {
            return Err(CoreError::Busy);
        }
        if let Some(entry) = self.streams.get(stream) {
            if !entry.state.ended() {
                return Err(CoreError::Alive);
            }
        }
        self.reserved.insert(stream.to_string());
        Ok(())
    }

    pub(crate) fn unreserve(&mut self, stream: &str) {
        self.reserved.remove(stream);
    }

    pub(crate) fn commit(
        &mut self,
        stream: &str,
        kind: Kind,
        id: u32,
        window: &str,
        now: Instant,
    ) -> Keys {
        self.reserved.remove(stream);
        // 덮이는 옛 항목의 시청자에게도 끝을 알린다
        self.remove_stream(stream);
        let epoch = self.epochs.entry(stream.to_string()).or_insert(0);
        *epoch += 1;
        let session_epoch = *epoch;
        self.streams.insert(
            stream.to_string(),
            Entry {
                kind,
                id,
                session_epoch,
                state: State::Attached,
                lease: Some(Lease {
                    window: window.to_string(),
                    epoch: 1,
                    conn: 0,
                }),
                last_lease: 1,
                home: window.to_string(),
                opened_at: now,
                opened_at_ms: now_ms(),
                detached_at_ms: None,
                unclaimed: false,
                ai_read: false,
                viewers: Vec::new(),
                issued: 1,
                size_owner: Some(1),
                primary_size: None,
            },
        );
        self.by_id.insert((kind, id), stream.to_string());
        Keys {
            stream: stream.to_string(),
            session_epoch,
            lease_epoch: 1,
        }
    }

    /// 주만의 규칙을 시험이 고정하는 자리 — 제품의 쓰기 · 크기 · ACK 는 시청자도 받는 [`Core::holder`] 를 지난다.
    #[cfg(test)]
    pub(crate) fn check(
        &self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
    ) -> Result<u32, CoreError> {
        let entry = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if entry.session_epoch != session_epoch {
            return Err(CoreError::Stale);
        }
        match (&entry.state, &entry.lease) {
            (State::Attached, Some(lease)) if lease.epoch == lease_epoch => Ok(entry.id),
            (state, _) if state.ended() => Err(CoreError::Gone),
            _ => Err(CoreError::Stale),
        }
    }

    /// 임대와 무관하다 — 부르는 곳은 메신저 다리의 문지기 · 넣기 하나다.
    pub(crate) fn live_resource(&self, stream: &str) -> Option<(Kind, u32, u64)> {
        self.streams
            .get(stream)
            .filter(|e| !e.state.ended())
            .map(|e| (e.kind, e.id, e.session_epoch))
    }

    pub(crate) fn kind_of(&self, stream: &str) -> Option<Kind> {
        self.streams.get(stream).map(|e| e.kind)
    }

    /// 다른 종류의 명령(로컬 write 로 SSH 스트림)은 없는 세션이다.
    #[cfg(test)]
    pub(crate) fn check_kind(
        &self,
        kind: Kind,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
    ) -> Result<u32, CoreError> {
        if self.streams.get(stream).is_some_and(|e| e.kind != kind) {
            return Err(CoreError::Gone);
        }
        self.check(stream, session_epoch, lease_epoch)
    }

    /// 붙어 있든 막 떨어졌든 받는다 — `beforeunload` 의 체크포인트가 `pagehide` 의 detach 보다 늦게 닿아도 거절하면 안 된다.
    pub(crate) fn check_owner(
        &self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
    ) -> Result<u32, CoreError> {
        let entry = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if entry.state.ended() {
            return Err(CoreError::Gone);
        }
        if entry.session_epoch != session_epoch || entry.last_lease != lease_epoch {
            return Err(CoreError::Stale);
        }
        Ok(entry.id)
    }

    /// `Some(id)` 면 부른 쪽이 자원을 닫는다. 없거나 다른 종류의 스트림이면 `Ok(None)`(멱등).
    pub(crate) fn close(
        &mut self,
        kind: Kind,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
    ) -> Result<Option<u32>, CoreError> {
        let Some(entry) = self.streams.get(stream) else {
            return Ok(None);
        };
        if entry.kind != kind {
            return Ok(None);
        }
        if entry.session_epoch != session_epoch || entry.last_lease != lease_epoch {
            return Err(CoreError::Stale);
        }
        Ok(self.remove_stream(stream))
    }

    /// `Ok(Some(_))` 면 방금 떨어졌다(부른 쪽이 채널을 비우고 수문을 연다) · `Ok(None)` 이면 이미 떨어져 있었다(멱등).
    pub(crate) fn detach(
        &mut self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
    ) -> Result<Option<(Kind, u32)>, CoreError> {
        let entry = self.streams.get_mut(stream).ok_or(CoreError::Gone)?;
        if entry.session_epoch != session_epoch || entry.last_lease != lease_epoch {
            return Err(CoreError::Stale);
        }
        match entry.state {
            State::Attached => {
                entry.state = State::Detached;
                entry.lease = None;
                entry.detached_at_ms = Some(now_ms());
                let handle = (entry.kind, entry.id);
                self.reassign_owner(stream);
                Ok(Some(handle))
            }
            State::Detached => Ok(None),
            State::Exited { .. } | State::Disconnected { .. } => Err(CoreError::Gone),
        }
    }

    /// 페이지 리로드 · 웹뷰 크래시는 닫지 않고 떨어뜨리기만 한다 — `skip` 은 이관 중인 손잡이.
    pub(crate) fn detach_window(
        &mut self,
        window: &str,
        skip: &HashSet<(Kind, u32)>,
    ) -> Vec<(Kind, u32, String)> {
        let mut out = Vec::new();
        for (stream, entry) in self.streams.iter_mut() {
            let mine = matches!(&entry.lease, Some(l) if l.window == window);
            if mine && entry.state == State::Attached && !skip.contains(&(entry.kind, entry.id)) {
                entry.state = State::Detached;
                entry.lease = None;
                entry.detached_at_ms = Some(now_ms());
                out.push((entry.kind, entry.id, stream.clone()));
            }
        }
        out.sort_unstable_by_key(|(k, id, _)| (*k == Kind::Ssh, *id));
        self.remove_viewers_where(|v| v.window == window, GoneReason::Window);
        for (_, _, stream) in &out {
            self.reassign_owner(stream);
        }
        out
    }

    /// 붙은 세션은 `take` 일 때만.
    pub(crate) fn attach(
        &mut self,
        stream: &str,
        expected_session_epoch: Option<u64>,
        window: &str,
        take: bool,
    ) -> Result<Attach, CoreError> {
        let entry = self.streams.get_mut(stream).ok_or(CoreError::Gone)?;
        if expected_session_epoch.is_some_and(|e| e != entry.session_epoch) {
            return Err(CoreError::Stale);
        }
        let taken_from = match (&entry.state, &entry.lease) {
            (State::Exited { .. } | State::Disconnected { .. }, _) => return Err(CoreError::Gone),
            (State::Attached, Some(lease)) if !take => {
                let _ = lease;
                return Err(CoreError::Attached);
            }
            (State::Attached, lease) => lease.as_ref().map(|l| l.window.clone()),
            (State::Detached, _) => None,
        };
        entry.issued += 1;
        entry.last_lease = entry.issued;
        entry.lease = Some(Lease {
            window: window.to_string(),
            epoch: entry.last_lease,
            conn: 0,
        });
        entry.state = State::Attached;
        entry.home = window.to_string();
        entry.detached_at_ms = None;
        entry.unclaimed = false;
        // 새 주는 붙으며 제 크기를 걸어 크기 주인이 된다 — 크기는 부른 쪽이 [`Core::note_size`] 로 적는다
        entry.primary_size = None;
        let got = Attach {
            kind: entry.kind,
            id: entry.id,
            keys: Keys {
                stream: stream.to_string(),
                session_epoch: entry.session_epoch,
                lease_epoch: entry.last_lease,
            },
            taken_from,
        };
        self.set_owner(stream, got.keys.lease_epoch);
        Ok(got)
    }

    /// `conn` 0(같은 프로세스)은 적지 않는다 — 늘 산 것으로 본다.
    pub(crate) fn conn_opened(&mut self, conn: u64) {
        if conn != 0 {
            self.live_conns.insert(conn);
        }
    }

    /// 그 연결이 이미 끊겼으면 임대를 적지 않고 `Detached` 로 내린다 — 죽은 연결에 붙은 채 남으면 아무도 떼지 않는다.
    /// 그때 `false` — 부른 쪽은 싱크를 꽂지 않는다.
    pub(crate) fn set_lease_conn(&mut self, stream: &str, conn: u64) -> bool {
        let live = conn == 0 || self.live_conns.contains(&conn);
        let Some(entry) = self.streams.get_mut(stream) else {
            return false;
        };
        let Some(lease) = entry.lease.as_mut() else {
            return false;
        };
        if live {
            lease.conn = conn;
            return true;
        }
        if entry.state == State::Attached {
            entry.state = State::Detached;
            entry.lease = None;
            entry.detached_at_ms = Some(now_ms());
            self.reassign_owner(stream);
        }
        false
    }

    /// 싱크를 꽂기 직전 같은 잠금 안에서 본다.
    pub(crate) fn holds_lease(&self, keys: &Keys, conn: u64) -> bool {
        self.streams.get(&keys.stream).is_some_and(|e| {
            e.state == State::Attached
                && e.session_epoch == keys.session_epoch
                && matches!(&e.lease, Some(l) if l.epoch == keys.lease_epoch && l.conn == conn)
        })
    }

    /// 연결이 끊기면 임대만 푼다(세션은 `Detached` 로 산다) — GUI 의 정상 종료 · kill 이 모두 이 길이다.
    pub(crate) fn detach_conn(&mut self, conn: u64) -> Vec<(Kind, u32, String)> {
        if conn == 0 {
            return Vec::new();
        }
        // 같은 잠금 안에서 죽은 연결로 적어야 이 뒤에 끝나는 열기 · 붙기가 이 연결에 임대를 적지 못한다
        self.live_conns.remove(&conn);
        let mut out = Vec::new();
        for (stream, entry) in self.streams.iter_mut() {
            let mine = matches!(&entry.lease, Some(l) if l.conn == conn);
            if mine && entry.state == State::Attached {
                entry.state = State::Detached;
                entry.lease = None;
                entry.detached_at_ms = Some(now_ms());
                out.push((entry.kind, entry.id, stream.clone()));
            }
        }
        out.sort_unstable_by_key(|(k, id, _)| (*k == Kind::Ssh, *id));
        self.remove_viewers_where(|v| v.conn == conn, GoneReason::Conn);
        for (_, _, stream) in &out {
            self.reassign_owner(stream);
        }
        out
    }

    pub(crate) fn live_count(&self) -> usize {
        self.streams.values().filter(|e| !e.state.ended()).count()
    }

    /// 이관 재부착 — 짐을 꺼낸 창이 빼앗기(`take`)로 임대를 받는다.
    pub(crate) fn adopt(&mut self, kind: Kind, id: u32, window: &str) -> Option<Keys> {
        let stream = self.by_id.get(&(kind, id))?.clone();
        self.attach(&stream, None, window, true)
            .ok()
            .map(|a| a.keys)
    }

    /// 책임 창만 바꾼다 — 임대는 재부착이 옮긴다.
    pub(crate) fn set_home(&mut self, kind: Kind, id: u32, window: &str) {
        if let Some(entry) = self
            .by_id
            .get(&(kind, id))
            .and_then(|s| self.streams.get_mut(s))
        {
            entry.home = window.to_string();
        }
    }

    pub(crate) fn exited(
        &mut self,
        kind: Kind,
        id: u32,
        reason: Option<String>,
        final_offset: u64,
    ) -> Option<Exit> {
        self.ended(
            kind,
            id,
            End::Exited {
                reason,
                final_offset,
            },
        )
    }

    /// 이미 끝난 것으로 적혀 있으면 겹친 기록은 무시한다.
    pub(crate) fn ended(&mut self, kind: Kind, id: u32, end: End) -> Option<Exit> {
        let stream = self.by_id.get(&(kind, id))?.clone();
        let entry = self.streams.get_mut(&stream)?;
        let session_epoch = entry.session_epoch;
        let removed = match entry.state {
            State::Attached => {
                entry.state = match end {
                    End::Exited {
                        reason,
                        final_offset,
                    } => State::Exited {
                        reason,
                        final_offset,
                    },
                    End::Disconnected { at_ms, reason } => State::Disconnected { at_ms, reason },
                };
                false
            }
            State::Exited { .. } | State::Disconnected { .. } => false,
            State::Detached => {
                self.remove_stream(&stream);
                true
            }
        };
        Some(Exit {
            stream,
            session_epoch,
            removed,
        })
    }

    /// 임대 검사 없음 — 부른 쪽이 이미 골랐다.
    pub(crate) fn remove_id(&mut self, kind: Kind, id: u32) -> Option<String> {
        let stream = self.by_id.get(&(kind, id))?.clone();
        self.remove_stream(&stream);
        Some(stream)
    }

    fn remove_stream(&mut self, stream: &str) -> Option<u32> {
        let entry = self.streams.remove(stream)?;
        self.by_id.remove(&(entry.kind, entry.id));
        self.checkpoints.remove(stream);
        for v in &entry.viewers {
            self.push_note(Note::ViewerGone {
                stream: stream.to_string(),
                session_epoch: entry.session_epoch,
                kind: entry.kind,
                id: entry.id,
                epoch: v.epoch,
                reason: GoneReason::Ended,
            });
        }
        Some(entry.id)
    }

    pub(crate) fn homes(&self, kind: Kind) -> Vec<(u32, String)> {
        self.streams
            .values()
            .filter(|e| e.kind == kind)
            .map(|e| (e.id, e.home.clone()))
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn state_of_stream(&self, stream: &str) -> Option<&'static str> {
        self.streams.get(stream).map(|e| e.state.name())
    }

    /// 타일 MCP 토큰의 판정에 쓴다 — 떨어진 세션도 산 것이다(F5 · 웹뷰 크래시 재부착은 회차를 바꾸지 않는다).
    pub(crate) fn live_epoch(&self, stream: &str) -> Option<u64> {
        self.streams
            .get(stream)
            .filter(|e| e.kind == Kind::Local && !e.state.ended())
            .map(|e| e.session_epoch)
    }

    /// 그 세션을 지금 보는 창들(주 + 시청자) — 끝났거나 없으면 `None`, 떨어져 있으면 빈 목록.
    pub(crate) fn watchers(&self, stream: &str) -> Option<Vec<String>> {
        let e = self.streams.get(stream).filter(|e| !e.state.ended())?;
        let mut out: Vec<String> = Vec::new();
        if let (State::Attached, Some(l)) = (&e.state, &e.lease) {
            out.push(l.window.clone());
        }
        for v in &e.viewers {
            if !out.contains(&v.window) {
                out.push(v.window.clone());
            }
        }
        Some(out)
    }

    pub(crate) fn status_of_stream(&self, stream: &str) -> Option<(&'static str, u64)> {
        self.streams.get(stream).map(|e| (e.state.name(), e.session_epoch))
    }

    /// 리로드가 거울을 남겨 둘 목록.
    pub(crate) fn live_streams_of(&self, window: &str) -> HashSet<String> {
        self.streams
            .iter()
            .filter(|(_, e)| e.home == window && !e.state.ended())
            .map(|(s, _)| s.clone())
            .collect()
    }

    /// 시험 전용 — 제품은 [`Self::restore_done`].
    #[cfg(test)]
    pub(crate) fn unclaimed(&self, window: &str, keep: &HashSet<String>) -> Vec<(Kind, u32)> {
        let mut ids: Vec<(Kind, u32)> = self
            .streams
            .iter()
            .filter(|(s, e)| {
                e.home == window
                    && !keep.contains(*s)
                    && (e.state == State::Detached || e.state.ended())
            })
            .map(|(_, e)| (e.kind, e.id))
            .collect();
        ids.sort_unstable_by_key(|(k, id)| (*k == Kind::Ssh, *id));
        ids
    }

    /// 복원이 데려가지 않은 떨어진 세션은 닫지 않는다 — [`Entry::unclaimed`] 로 표시만 하고, 끝난 잔해만 돌려준다.
    /// `(끝난 잔해, 새로 표시한 스트림)`.
    pub(crate) fn restore_done(
        &mut self,
        window: &str,
        keep: &HashSet<String>,
    ) -> (Vec<(Kind, u32)>, Vec<String>) {
        let mut ended: Vec<(Kind, u32)> = Vec::new();
        let mut marked: Vec<String> = Vec::new();
        for (s, e) in self.streams.iter_mut() {
            if e.home != window || keep.contains(s) {
                continue;
            }
            if e.state.ended() {
                ended.push((e.kind, e.id));
            } else if e.state == State::Detached && !e.unclaimed {
                e.unclaimed = true;
                marked.push(s.clone());
            }
        }
        ended.sort_unstable_by_key(|(k, id)| (*k == Kind::Ssh, *id));
        marked.sort();
        (ended, marked)
    }

    /// 떨어진 것 전부 — 보일 것은 창 목록을 아는 GUI 가 거른다.
    pub(crate) fn detached(&self) -> Vec<DetachedRow> {
        let mut rows: Vec<DetachedRow> = self
            .streams
            .iter()
            .filter(|(_, e)| e.state == State::Detached)
            .map(|(s, e)| DetachedRow {
                stream: s.clone(),
                kind: e.kind,
                id: e.id,
                home: e.home.clone(),
                opened_at_ms: e.opened_at_ms,
                detached_at_ms: e.detached_at_ms,
                unclaimed: e.unclaimed,
                ai_read: e.ai_read,
            })
            .collect();
        rows.sort_by(|a, b| b.detached_at_ms.cmp(&a.detached_at_ms).then_with(|| a.stream.cmp(&b.stream)));
        rows
    }

    /// 지금 떨어져 있을 때만 — 붙은 세션을 목록의 [닫기]가 닫지 않게.
    pub(crate) fn take_detached(&mut self, stream: &str) -> Option<(Kind, u32)> {
        let e = self.streams.get(stream)?;
        if e.state != State::Detached {
            return None;
        }
        let handle = (e.kind, e.id);
        self.remove_stream(stream);
        Some(handle)
    }

    pub(crate) fn set_ai_read(&mut self, stream: &str, on: bool) -> bool {
        match self.streams.get_mut(stream) {
            Some(e) if !e.state.ended() => {
                e.ai_read = on;
                true
            }
            _ => false,
        }
    }

    /// 서버 해석기가 거울에 쓰기 직전에 다시 본다 — 창이 없을 때도 사람이 마지막으로 정한 값보다 넓어지지 않게.
    pub(crate) fn ai_read_of(&self, stream: &str) -> bool {
        self.streams.get(stream).is_some_and(|e| e.ai_read && !e.state.ended())
    }

    #[cfg(test)]
    pub(crate) fn drop_checkpoint(&mut self, stream: &str) {
        self.checkpoints.remove(stream);
    }
    pub(crate) fn stream_of(&self, kind: Kind, id: u32) -> Option<String> {
        self.by_id.get(&(kind, id)).cloned()
    }

    pub(crate) fn probe(&mut self, stream: &str, now: Instant) -> Probe {
        self.sweep(now);
        let Some(entry) = self.streams.get(stream) else {
            return Probe {
                state: if self.reserved.contains(stream) {
                    "opening"
                } else {
                    "none"
                },
                kind: None,
                session_epoch: None,
                checkpoint: None,
                ai_read: false,
            };
        };
        let state = entry.state.name();
        let checkpoint = self
            .checkpoints
            .get(stream)
            .filter(|c| c.checkpoint.session_epoch == entry.session_epoch)
            .map(|c| c.checkpoint.clone());
        Probe {
            state,
            kind: Some(entry.kind.as_str()),
            session_epoch: Some(entry.session_epoch),
            checkpoint,
            ai_read: entry.ai_read,
        }
    }

    pub(crate) fn put_checkpoint(
        &mut self,
        stream: &str,
        checkpoint: Checkpoint,
        now: Instant,
    ) -> Result<(), CoreError> {
        let entry = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if entry.session_epoch != checkpoint.session_epoch {
            return Err(CoreError::Stale);
        }
        if checkpoint.buffer.len() > CHECKPOINT_MAX_BYTES {
            return Err(CoreError::TooLarge);
        }
        self.sweep(now);
        // 늦게 닿은 옛 화면이 새 화면을 덮지 않게 — 같은 회차면 오프셋이 큰 쪽을 둔다
        let older = self.checkpoints.get(stream).is_some_and(|s| {
            s.checkpoint.session_epoch == checkpoint.session_epoch
                && s.checkpoint.consumed > checkpoint.consumed
        });
        if !older {
            self.checkpoints.insert(
                stream.to_string(),
                Stashed {
                    checkpoint,
                    at: now,
                },
            );
        }
        Ok(())
    }


    /// 수명은 표에 없는 스트림의 화면에만 건다 — GUI 를 끄고 몇 시간 뒤 다시 켜도 세션은 살아 있어, 그 화면을 버리면 다시 붙는
    /// 타일이 링 앞의 화면을 통째로 잃는다.
    fn sweep(&mut self, now: Instant) {
        let streams = &self.streams;
        self.checkpoints
            .retain(|stream, s| streams.contains_key(stream) || now.duration_since(s.at) < CHECKPOINT_TTL);
    }
}

static CORE: LazyLock<Mutex<Core>> = LazyLock::new(Default::default);

/// 쥔 채 `await`·블로킹 금지(모듈 머리말 "잠금 순서").
pub(crate) fn core() -> MutexGuard<'static, Core> {
    CORE.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 옛 임대의 호출은 조용히 사라지면 원인을 못 찾는다 — 한 줄 남긴다.
pub(crate) fn refuse(what: &str, stream: &str, err: CoreError) -> String {
    if err == CoreError::Stale {
        eprintln!("[aynx] 세션 코어: 옛 임대의 {what} 거부 — 스트림 {stream}");
    }
    err.message()
}
