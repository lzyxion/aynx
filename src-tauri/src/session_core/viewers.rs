//! 시청자 — 한 세션을 주 임대와 함께 여러 창(메인 PC 창 · 원격 창)이 동시에 보고 둘 다 친다.
//!
//! ## 규칙
//!
//! - 주 임대 규칙은 그대로다. 시청자는 그 밖에서 빼앗지 않고 덧붙는다(주가 없어도 된다).
//! - 시청자의 임대 회차는 주와 같은 카운터에서 뽑아 열쇠 하나로 주 · 시청자가 갈린다 — 쓰기는 둘 다 · 크기 · ACK 도 같은 명령에 시청자 열쇠를 싣는다.
//!   시청자의 닫기 · 체크포인트 · `detach` 는 `[stale-lease]` 다(닫기는 주의 일).
//! - 창 파괴 · 리로드 · 연결 끊김 · 예산 초과는 그 창 · 연결의 시청자만 뗀다 — 세션은 닫지 않는다. 주가 떠나도 시청자는 계속 보고,
//!   시청자 크레딧은 생산자를 세우지 않는다.
//!
//! ## 크기 주인 (tmux `latest`)
//!
//! - 크기 주인 = 마지막으로 키를 치거나 붙여넣은 자격 있는 쪽(터미널 응답 `protocol` · 마우스 `mouse` 는 바꾸지 않는다 — 마우스는
//!   셸에는 간다) — 폰 시청자는 자격이 없을 수 있다.
//! - resize 는 크기 주인의 것만 적용하고, 아닌 쪽은 적어 두었다가 주인이 되는 순간 서버가 적용한다.
//! - 되찾기([`Core::claim_size_owner`])는 셸에 아무 바이트도 보내지 않는다.
//! - 주인이 떠나면 주 → 붙은 순서의 첫 자격 있는 시청자 → 없음 순으로 다시 고른다. "주인 없음" 일 때만 서버가 터미널 질의에 대신 답한다.
//! - 터미널 질의(DSR·DA·DECRQM·OSC 10/11)에는 크기 주인만 답한다.
//!
//! ## 노트
//!
//! 코어는 자원을 모른다 — [`Note`] 를 쌓기만 하고 세션 서버가 코어 잠금 밖에서 비운다(`server::sessions::settle`).

use super::{now_ms, Attach, Core, CoreError, Entry, Keys, Kind, State};

/// 비우는 쪽이 없는 길(시험 · 서버 밖)에서 끝없이 쌓이지 않게.
pub(crate) const NOTES_CAP: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Viewer {
    pub window: String,
    pub epoch: u64,
    pub conn: u64,
    /// 크기 주인이 될 수 있나(폰은 거짓).
    pub eligible: bool,
    /// 마지막으로 요청한 크기 — 주인이 되면 적용한다.
    pub size: Option<(u16, u16)>,
    #[allow(dead_code)] // 진단용
    pub attached_at_ms: u64,
}

/// 이벤트 `session-viewer-ended` 의 `reason` 글자다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoneReason {
    Detached,
    /// 프런트는 다시 붙어 재동기화한다.
    Overflow,
    Window,
    Conn,
    Ended,
}

impl GoneReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            GoneReason::Detached => "detached",
            GoneReason::Overflow => "overflow",
            GoneReason::Window => "window",
            GoneReason::Conn => "conn",
            GoneReason::Ended => "ended",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Note {
    /// `owner` 가 `None` 이면 서버가 질의에 답한다 · `size` 가 있으면 서버가 적용한다.
    Owner {
        stream: String,
        session_epoch: u64,
        kind: Kind,
        id: u32,
        owner: Option<u64>,
        primary: bool,
        size: Option<(u16, u16)>,
    },
    ViewerGone {
        stream: String,
        session_epoch: u64,
        kind: Kind,
        id: u32,
        epoch: u64,
        reason: GoneReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Holder {
    pub kind: Kind,
    pub id: u32,
    pub viewer: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Claim {
    pub holder: Holder,
    /// 자격이 없으면 거짓 — 오류 아님.
    pub owner: bool,
    /// 거짓이면(이미 주인이었다) 노트가 없으니 부른 쪽이 resize 처럼 건다.
    pub changed: bool,
}

impl Entry {
    fn primary_epoch(&self) -> Option<u64> {
        match (&self.state, &self.lease) {
            (State::Attached, Some(l)) => Some(l.epoch),
            _ => None,
        }
    }

    fn eligible(&self, epoch: u64) -> bool {
        self.primary_epoch() == Some(epoch) || self.viewers.iter().any(|v| v.epoch == epoch && v.eligible)
    }

    fn size_of(&self, epoch: u64) -> Option<(u16, u16)> {
        if self.primary_epoch() == Some(epoch) {
            return self.primary_size;
        }
        self.viewers.iter().find(|v| v.epoch == epoch).and_then(|v| v.size)
    }

    fn owner_note(&self, stream: &str) -> Note {
        Note::Owner {
            stream: stream.to_string(),
            session_epoch: self.session_epoch,
            kind: self.kind,
            id: self.id,
            owner: self.size_owner,
            primary: self.size_owner.is_some() && self.size_owner == self.primary_epoch(),
            size: self.size_owner.and_then(|o| self.size_of(o)),
        }
    }
}

impl Core {
    pub(super) fn push_note(&mut self, note: Note) {
        if self.notes.len() >= NOTES_CAP {
            self.notes.remove(0);
        }
        self.notes.push(note);
    }

    /// 코어 잠금을 쥔 채 처리하지 않는다.
    pub(crate) fn take_notes(&mut self) -> Vec<Note> {
        std::mem::take(&mut self.notes)
    }

    pub(super) fn set_owner(&mut self, stream: &str, epoch: u64) {
        let Some(e) = self.streams.get_mut(stream) else { return };
        if e.size_owner == Some(epoch) {
            return;
        }
        e.size_owner = Some(epoch);
        let note = e.owner_note(stream);
        self.push_note(note);
    }

    /// 끝난 세션은 건드리지 않는다.
    pub(super) fn reassign_owner(&mut self, stream: &str) {
        let Some(e) = self.streams.get_mut(stream) else { return };
        if e.state.ended() {
            return;
        }
        if e.size_owner.is_some_and(|o| e.eligible(o)) {
            return;
        }
        let next = e
            .primary_epoch()
            .or_else(|| e.viewers.iter().find(|v| v.eligible).map(|v| v.epoch));
        if next == e.size_owner {
            return;
        }
        e.size_owner = next;
        let note = e.owner_note(stream);
        self.push_note(note);
    }

    /// 자격 있는 시청자가 붙었는데 주인이 없으면 그 시청자가 주인이 된다.
    pub(crate) fn attach_viewer(
        &mut self,
        stream: &str,
        expected_session_epoch: Option<u64>,
        window: &str,
        eligible: bool,
        size: Option<(u16, u16)>,
    ) -> Result<Attach, CoreError> {
        let entry = self.streams.get_mut(stream).ok_or(CoreError::Gone)?;
        if expected_session_epoch.is_some_and(|e| e != entry.session_epoch) {
            return Err(CoreError::Stale);
        }
        if entry.state.ended() {
            return Err(CoreError::Gone);
        }
        entry.issued += 1;
        let epoch = entry.issued;
        entry.viewers.push(Viewer {
            window: window.to_string(),
            epoch,
            conn: 0,
            eligible,
            size,
            attached_at_ms: now_ms(),
        });
        let got = Attach {
            kind: entry.kind,
            id: entry.id,
            keys: Keys {
                stream: stream.to_string(),
                session_epoch: entry.session_epoch,
                lease_epoch: epoch,
            },
            taken_from: None,
        };
        self.reassign_owner(stream);
        Ok(got)
    }

    /// 그 연결이 이미 끊겼으면 그 시청자를 떼고 `false` — 죽은 연결에 붙은 채 남지 않게.
    pub(crate) fn set_viewer_conn(&mut self, keys: &Keys, conn: u64) -> bool {
        let live = conn == 0 || self.live_conns.contains(&conn);
        let Some(e) = self.streams.get_mut(&keys.stream) else { return false };
        if e.session_epoch != keys.session_epoch {
            return false;
        }
        let Some(v) = e.viewers.iter_mut().find(|v| v.epoch == keys.lease_epoch) else { return false };
        if live {
            v.conn = conn;
            return true;
        }
        self.drop_viewer(&keys.stream, keys.session_epoch, keys.lease_epoch, GoneReason::Conn);
        false
    }

    /// 싱크를 꽂기 직전 같은 잠금 안에서 본다.
    pub(crate) fn holds_viewer(&self, keys: &Keys, conn: u64) -> bool {
        self.streams.get(&keys.stream).is_some_and(|e| {
            !e.state.ended()
                && e.session_epoch == keys.session_epoch
                && e.viewers.iter().any(|v| v.epoch == keys.lease_epoch && v.conn == conn)
        })
    }

    pub(crate) fn drop_viewer(&mut self, stream: &str, session_epoch: u64, epoch: u64, reason: GoneReason) -> bool {
        let Some(e) = self.streams.get_mut(stream) else { return false };
        if e.session_epoch != session_epoch {
            return false;
        }
        let Some(at) = e.viewers.iter().position(|v| v.epoch == epoch) else { return false };
        e.viewers.remove(at);
        let note = Note::ViewerGone {
            stream: stream.to_string(),
            session_epoch,
            kind: e.kind,
            id: e.id,
            epoch,
            reason,
        };
        self.push_note(note);
        self.reassign_owner(stream);
        true
    }

    /// 이미 떨어졌으면 `Ok(false)` — 예산 초과로 서버가 먼저 뗐을 수 있다.
    pub(crate) fn detach_viewer(&mut self, stream: &str, session_epoch: u64, epoch: u64) -> Result<bool, CoreError> {
        let e = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if e.session_epoch != session_epoch {
            return Err(CoreError::Stale);
        }
        Ok(self.drop_viewer(stream, session_epoch, epoch, GoneReason::Detached))
    }

    pub(super) fn remove_viewers_where(&mut self, pred: impl Fn(&Viewer) -> bool, reason: GoneReason) -> usize {
        let doomed: Vec<(String, u64, u64)> = self
            .streams
            .iter()
            .flat_map(|(s, e)| {
                e.viewers
                    .iter()
                    .filter(|v| pred(v))
                    .map(move |v| (s.clone(), e.session_epoch, v.epoch))
            })
            .collect();
        for (s, se, ep) in &doomed {
            self.drop_viewer(s, *se, *ep, reason);
        }
        doomed.len()
    }

    pub(crate) fn remove_window_viewers(&mut self, window: &str) -> usize {
        self.remove_viewers_where(|v| v.window == window, GoneReason::Window)
    }

    pub(crate) fn holder(&self, stream: &str, session_epoch: u64, lease_epoch: u64) -> Result<Holder, CoreError> {
        let e = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if e.session_epoch != session_epoch {
            return Err(CoreError::Stale);
        }
        if e.state.ended() {
            return Err(CoreError::Gone);
        }
        let viewer = if e.primary_epoch() == Some(lease_epoch) {
            false
        } else if e.viewers.iter().any(|v| v.epoch == lease_epoch) {
            true
        } else {
            return Err(CoreError::Stale);
        };
        Ok(Holder {
            kind: e.kind,
            id: e.id,
            viewer,
        })
    }

    /// `claims_size`(키 · 붙여넣기)이고 자격이 있으면 크기 주인이 된다 — 서버는 쓰기 전에 그 쪽이 적어 둔 크기를 적용한다.
    pub(crate) fn input(
        &mut self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
        claims_size: bool,
    ) -> Result<Holder, CoreError> {
        let h = self.holder(stream, session_epoch, lease_epoch)?;
        let eligible = self.streams.get(stream).is_some_and(|e| e.eligible(lease_epoch));
        if claims_size && eligible {
            self.set_owner(stream, lease_epoch);
        }
        Ok(h)
    }

    /// 주인이 되는 것은 입력 · 되찾기로만이다 — resize 로는 되지 않는다.
    pub(crate) fn resize_request(
        &mut self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
        cols: u16,
        rows: u16,
    ) -> Result<Option<Holder>, CoreError> {
        let h = self.holder(stream, session_epoch, lease_epoch)?;
        self.note_size(stream, lease_epoch, cols, rows);
        let owner = self.streams.get(stream).and_then(|e| e.size_owner);
        Ok((owner == Some(lease_epoch)).then_some(h))
    }

    /// 입력 없이 크기 주인을 되찾는다 — 자격 규칙은 사람 입력과 같다.
    pub(crate) fn claim_size_owner(
        &mut self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
        cols: u16,
        rows: u16,
    ) -> Result<Claim, CoreError> {
        let holder = self.holder(stream, session_epoch, lease_epoch)?;
        self.note_size(stream, lease_epoch, cols, rows);
        let eligible = self.streams.get(stream).is_some_and(|e| e.eligible(lease_epoch));
        let before = self.size_owner(stream);
        if eligible {
            self.set_owner(stream, lease_epoch);
        }
        Ok(Claim {
            holder,
            owner: self.size_owner(stream) == Some(lease_epoch),
            changed: before != self.size_owner(stream),
        })
    }

    /// 노트는 내지 않는다.
    pub(crate) fn note_size(&mut self, stream: &str, lease_epoch: u64, cols: u16, rows: u16) {
        let Some(e) = self.streams.get_mut(stream) else { return };
        if e.primary_epoch() == Some(lease_epoch) {
            e.primary_size = Some((cols, rows));
        } else if let Some(v) = e.viewers.iter_mut().find(|v| v.epoch == lease_epoch) {
            v.size = Some((cols, rows));
        }
    }

    pub(crate) fn size_owner(&self, stream: &str) -> Option<u64> {
        self.streams.get(stream).and_then(|e| e.size_owner)
    }

    /// 주인이 아닌 쪽이 그 크기로 그린다.
    pub(crate) fn owner_size(&self, stream: &str) -> Option<(u16, u16)> {
        let e = self.streams.get(stream)?;
        e.size_owner.and_then(|o| e.size_of(o))
    }

    /// `(sessionEpoch, 주인, 주인이 주인가, 시청자 수)`
    pub(crate) fn owner_info(&self, stream: &str) -> Option<(u64, Option<u64>, bool, usize)> {
        let e = self.streams.get(stream)?;
        if e.state.ended() {
            return None;
        }
        let primary = e.size_owner.is_some() && e.size_owner == e.primary_epoch();
        Some((e.session_epoch, e.size_owner, primary, e.viewers.len()))
    }

    #[cfg(test)]
    pub(crate) fn viewer_epochs(&self, stream: &str) -> Vec<u64> {
        self.streams
            .get(stream)
            .map(|e| e.viewers.iter().map(|v| v.epoch).collect())
            .unwrap_or_default()
    }
}
