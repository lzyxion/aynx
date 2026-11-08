//! **시청자**(원격 웹 R2-A — 설계 `aynx-notes/docs/log/2026-10-15-remote-web-client-design.md` 4절) — 한 세션을 주 임대
//! ([`super::Entry::lease`] — 예전 그대로)와 함께 **여러 창이 동시에 본다**. 집 PC 창과 원격 창(`remote-<기기>-<세대>` — GUI 안의 숨은
//! 웹뷰)이 같은 타일을 보고 둘 다 친다.
//!
//! ## 규칙
//!
//! - **주 임대는 그대로다** — 둘째 주는 여전히 `[session-attached]`, `take` 는 빼앗는다, 닫기·체크포인트·떨어지기(`detach`)는 주의
//!   열쇠로만(`last_lease`). 시청자는 그 규칙 밖에서 **덧붙는다**([`Core::attach_viewer`] — 빼앗지 않음, 주가 없어도 된다).
//! - **열쇠**: 시청자의 임대 회차는 주와 같은 카운터([`super::Entry::issued`])에서 뽑는다 — `(stream, sessionEpoch, leaseEpoch)` 하나로
//!   주인지 어느 시청자인지 갈린다. 그래서 쓰기·크기·ACK 는 예전 명령 그대로 시청자의 열쇠를 싣는다([`Core::holder`]). 시청자의
//!   닫기·체크포인트·`detach` 는 `[stale-lease]` 다(닫기는 주의 일 — 원격의 닫기 요청은 주 창이 적용한다).
//! - **떨어지기**: 시청자는 [`Core::detach_viewer`] 로 제 시청만 끝낸다. 창 파괴·리로드([`Core::detach_window`] · `close_window`) ·
//!   연결 끊김([`Core::detach_conn`]) · 예산 초과([`Core::drop_viewer`] — `server::credit`)도 그 창·연결의 시청자만 뗀다. 세션은 닫지 않는다.
//! - **주가 떠나도**(떨어짐) 시청자는 계속 본다 — 세션은 `Detached`(주 없음) 의미 그대로다: 떨어진 세션 목록에 오르고, 수문은 주의
//!   크레딧을 놓아 열리며(시청자 크레딧은 생산자를 세우지 않는다), 세션을 끝내려면 여전히 명시 닫기가 필요하다. 주가 다시 붙으면
//!   주로 돌아온다. 세션이 끝나 표에서 빠지면(닫기 · 떨어진 채 끝남 · 덮임) 시청자마다 [`GoneReason::Ended`] 노트가 나간다.
//!
//! ## 크기 주인 (tmux `latest` — 10-15 결정)
//!
//! - 크기 주인 = **마지막으로 사람이 입력한 자격 있는 쪽**([`Core::input`] — 출처가 터미널 응답 `protocol` 이면 바꾸지 않는다). 시청자는
//!   붙을 때 자격(`size_owner_eligible` — 기본 참, 폰은 거짓 · R5)을 받는다. 주는 늘 자격이 있다.
//! - resize 는 **크기 주인의 것만 적용**한다([`Core::resize_request`]). 주인이 아닌 쪽의 resize 는 그 쪽의 크기로 **적어 두기만** 하고(오류
//!   아님 — `Ok`), 그 쪽이 입력해 주인이 되는 순간 적어 둔 크기를 서버가 적용한다(노트 [`Note::Owner`] 의 `size`). 적어 둔 크기가 없으면
//!   크기는 그대로다(그 쪽이 다음 resize 로 건다).
//! - **입력 없이 되찾기**([`Core::claim_size_owner`] — 10-20, 주인이 아닌 타일의 [이 창 크기로] · [모두 되돌리기]): 입력과 같은 자격
//!   규칙으로 그 쪽을 주인으로 삼고 함께 보낸 크기를 건다 — **셸에 아무 바이트도 보내지 않는다**. 자격 없는 폰 시청자는 되찾지 못한다
//!   (`owner: false` — 오류 아님), 낡은 열쇠는 `[stale-lease]`.
//! - 주가 붙으면(열기 · `attach` · `take` · 이관) 주가 주인이 된다 — 붙는 주는 예전처럼 제 크기를 건다.
//! - 주인이 떠나면(떨어짐 · 시청자 뗌) **주 → 붙은 순서의 첫 자격 있는 시청자 → 없음** 순으로 다시 고른다. 그래서 "주인 없음" 은 곧
//!   "자격 있는 붙은 쪽이 없음" 이고, 그때만 서버가 터미널 질의에 대신 답한다(`output::Responder::Server` — 예전 "붙은 창 없음" 과 같은 자리).
//! - 터미널 질의(DSR·DA·DECRQM·OSC 10/11)에는 **크기 주인만** 답한다 — 프런트(커밋 B)는 이벤트 `session-size-owner` 와 붙기 답의
//!   `sizeOwner` 로 제가 주인인지 안다.
//!
//! ## 노트
//!
//! 코어는 자원을 모른다. 주인이 바뀌거나 시청자가 떨어지면 [`Note`] 를 쌓고, 세션 서버가 코어 잠금 밖에서 비운다(`server::sessions::settle`
//! — 시청자 싱크·크레딧 거두기 · 크기 적용 · 질의 답하는 쪽 · 이벤트). 같은 프로세스의 GUI 쪽 코어(비어 있음)에는 쌓이지 않는다.

use super::{now_ms, Attach, Core, CoreError, Entry, Keys, Kind, State};

/// 노트 상한 — 비우는 쪽이 없는 길(시험 · 서버 밖)에서 끝없이 쌓이지 않게. 넘치면 오래된 것부터 버린다.
pub(crate) const NOTES_CAP: usize = 4096;

/// 시청자 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Viewer {
    pub window: String,
    /// 이 시청자의 임대 회차(주와 같은 카운터 — 겹치지 않는다).
    pub epoch: u64,
    /// 세션 서버의 연결 번호(주 임대의 `conn` 과 같은 뜻).
    pub conn: u64,
    /// 크기 주인이 될 수 있나(폰은 거짓 — R5).
    pub eligible: bool,
    /// 마지막으로 요청한 크기 — 주인이 되면 적용한다.
    pub size: Option<(u16, u16)>,
    #[allow(dead_code)] // 진단용
    pub attached_at_ms: u64,
}

/// 시청자가 떨어진 까닭 — 이벤트 `session-viewer-ended` 의 `reason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoneReason {
    /// 제 손으로 뗐다(`detach_viewer`).
    Detached,
    /// 예산을 넘었다 — **다시 붙어 재동기화**한다(링·체크포인트 재생).
    Overflow,
    /// 그 창이 사라졌거나 다시 떴다.
    Window,
    /// 그 연결이 끊겼다.
    Conn,
    /// 세션이 끝나 표에서 빠졌다(닫기 · 떨어진 채 끝남 · 새 회차가 덮음).
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

/// 서버가 코어 잠금 밖에서 처리할 일.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Note {
    /// 크기 주인이 바뀌었다. `owner` = 새 주인의 임대 회차(`None` = 없음 → 서버가 질의에 답한다), `primary` = 그 주인이 주인가,
    /// `size` = 새 주인이 적어 둔 크기(있으면 서버가 적용한다).
    Owner {
        stream: String,
        session_epoch: u64,
        kind: Kind,
        id: u32,
        owner: Option<u64>,
        primary: bool,
        size: Option<(u16, u16)>,
    },
    /// 시청자 하나가 떨어졌다 — 서버가 그 싱크·크레딧을 거두고 이벤트를 낸다.
    ViewerGone {
        stream: String,
        session_epoch: u64,
        kind: Kind,
        id: u32,
        epoch: u64,
        reason: GoneReason,
    },
}

/// 쓰기·크기·ACK 의 열쇠가 가리키는 것 — 주 또는 시청자.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Holder {
    pub kind: Kind,
    pub id: u32,
    pub viewer: bool,
}

/// [`Core::claim_size_owner`] 의 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Claim {
    pub holder: Holder,
    /// 부른 뒤 이 쪽이 크기 주인인가(자격이 없으면 거짓 — 오류 아님).
    pub owner: bool,
    /// 이 부름으로 주인이 바뀌었나(노트가 쌓였다 — 서버가 적어 둔 크기를 건다).
    pub changed: bool,
}

impl Entry {
    /// 지금 붙어 있는 주의 임대 회차.
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

    /// 쌓인 노트를 비운다(세션 서버 — 코어 잠금을 쥔 채 처리하지 않는다).
    pub(crate) fn take_notes(&mut self) -> Vec<Note> {
        std::mem::take(&mut self.notes)
    }

    /// 크기 주인을 `epoch` 로(바뀌었으면 노트).
    pub(super) fn set_owner(&mut self, stream: &str, epoch: u64) {
        let Some(e) = self.streams.get_mut(stream) else { return };
        if e.size_owner == Some(epoch) {
            return;
        }
        e.size_owner = Some(epoch);
        let note = e.owner_note(stream);
        self.push_note(note);
    }

    /// 주인이 떠났으면 다시 고른다 — 주 → 붙은 순서의 첫 자격 있는 시청자 → 없음. 바뀌었으면 노트. 끝난 세션은 건드리지 않는다.
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

    /// **시청자로 붙는다** — 빼앗지 않는다(주가 있든 없든). 끝났거나 없으면 [`CoreError::Gone`], 회차가 다르면 [`CoreError::Stale`].
    /// 자격 있는 시청자가 붙었는데 주인이 없으면(주 없음) 그 시청자가 주인이 된다(`size` 를 적어 두면 서버가 적용한다).
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

    /// 시청자를 쥔 연결을 적는다(붙기 직후 같은 잠금 안에서). 그 연결이 이미 끊겼으면 그 시청자를 떼고 `false`
    /// ([`Core::set_lease_conn`] 과 같은 이유 — 죽은 연결에 붙은 채 남지 않게).
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

    /// 이 시청자 열쇠가 아직 붙어 있고 `conn` 의 것인가 — 싱크를 꽂기 직전 같은 잠금 안에서 본다.
    pub(crate) fn holds_viewer(&self, keys: &Keys, conn: u64) -> bool {
        self.streams.get(&keys.stream).is_some_and(|e| {
            !e.state.ended()
                && e.session_epoch == keys.session_epoch
                && e.viewers.iter().any(|v| v.epoch == keys.lease_epoch && v.conn == conn)
        })
    }

    /// 시청자 하나를 뗀다(노트 [`Note::ViewerGone`] · 주인이었으면 다시 고른다). 뗐으면 `true`.
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

    /// **시청자가 제 시청을 끝낸다** — 세션은 그대로. 회차가 다르면 [`CoreError::Stale`], 이미 떨어졌으면 `Ok(false)`(멱등 — 예산 초과로
    /// 서버가 먼저 뗐을 수 있다).
    pub(crate) fn detach_viewer(&mut self, stream: &str, session_epoch: u64, epoch: u64) -> Result<bool, CoreError> {
        let e = self.streams.get(stream).ok_or(CoreError::Gone)?;
        if e.session_epoch != session_epoch {
            return Err(CoreError::Stale);
        }
        Ok(self.drop_viewer(stream, session_epoch, epoch, GoneReason::Detached))
    }

    /// 조건에 맞는 시청자를 모두 뗀다(창 · 연결). 뗀 수.
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

    /// 그 창의 시청자를 모두 뗀다(창 파괴 — `close_window` · 앱 종료 중의 창 파괴). 뗀 수.
    pub(crate) fn remove_window_viewers(&mut self, window: &str) -> usize {
        self.remove_viewers_where(|v| v.window == window, GoneReason::Window)
    }

    /// 열쇠가 가리키는 것 — 지금 붙은 주 또는 지금 붙은 시청자. 끝났으면 [`CoreError::Gone`], 그 밖은 [`CoreError::Stale`].
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

    /// **쓰기의 문** — 주·시청자 모두 받는다. 사람의 입력(`human` — 출처가 터미널 응답이 아님)이고 그 쪽이 자격이 있으면 크기 주인이
    /// 된다(바뀌었으면 노트 — 서버가 쓰기 **전에** 그 쪽이 적어 둔 크기를 적용한다).
    pub(crate) fn input(
        &mut self,
        stream: &str,
        session_epoch: u64,
        lease_epoch: u64,
        human: bool,
    ) -> Result<Holder, CoreError> {
        let h = self.holder(stream, session_epoch, lease_epoch)?;
        let eligible = self.streams.get(stream).is_some_and(|e| e.eligible(lease_epoch));
        if human && eligible {
            self.set_owner(stream, lease_epoch);
        }
        Ok(h)
    }

    /// **크기의 문** — 그 쪽의 크기를 적고, 크기 주인일 때만 `Some(손잡이)`(부른 쪽이 적용한다). 주인이 아니면 `Ok(None)` — 무시(오류
    /// 아님). 주인이 되는 것은 입력([`Core::input`]) · 되찾기([`Core::claim_size_owner`])로만이다.
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

    /// **크기 되찾기**(10-20 — 집 PC 타일의 [이 창 크기로]) — 입력 없이 이 쪽을 크기 주인으로 삼는다. 규칙은 사람 입력과 같다: 그 쪽의
    /// 크기를 적고(`cols`·`rows`), **자격이 있을 때만** 주인이 된다(폰 시청자는 "이 기기 크기로 맞추기" 를 켰을 때만 — 자격은 붙을 때
    /// 싣는다). 열쇠가 낡았으면 [`CoreError::Stale`](`[stale-lease]`), 끝났으면 [`CoreError::Gone`]. 주인이 바뀌면 노트가 적어 둔 크기를
    /// 싣고(서버가 적용한다), 이미 주인이었으면 노트 없이 `changed: false` — 부른 쪽이 resize 처럼 건다.
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

    /// 그 쪽(주 또는 시청자)이 요청한 크기를 적는다 — 열기·붙기·resize. 노트는 내지 않는다.
    pub(crate) fn note_size(&mut self, stream: &str, lease_epoch: u64, cols: u16, rows: u16) {
        let Some(e) = self.streams.get_mut(stream) else { return };
        if e.primary_epoch() == Some(lease_epoch) {
            e.primary_size = Some((cols, rows));
        } else if let Some(v) = e.viewers.iter_mut().find(|v| v.epoch == lease_epoch) {
            v.size = Some((cols, rows));
        }
    }

    /// 지금 크기 주인의 임대 회차.
    pub(crate) fn size_owner(&self, stream: &str) -> Option<u64> {
        self.streams.get(stream).and_then(|e| e.size_owner)
    }

    /// 지금 크기 주인이 적어 둔 크기(R2-B — 주인이 아닌 쪽이 그 크기로 그린다). 주인이 없거나 크기를 적은 적이 없으면 `None`.
    pub(crate) fn owner_size(&self, stream: &str) -> Option<(u16, u16)> {
        let e = self.streams.get(stream)?;
        e.size_owner.and_then(|o| e.size_of(o))
    }

    /// 크기 주인 알림에 실을 것(R2-B — 주인이 크기를 바꿨을 때 다른 쪽에 다시 알린다) — `(sessionEpoch, 주인, 주인이 주인가, 시청자 수)`.
    /// 끝났거나 없으면 `None`.
    pub(crate) fn owner_info(&self, stream: &str) -> Option<(u64, Option<u64>, bool, usize)> {
        let e = self.streams.get(stream)?;
        if e.state.ended() {
            return None;
        }
        let primary = e.size_owner.is_some() && e.size_owner == e.primary_epoch();
        Some((e.session_epoch, e.size_owner, primary, e.viewers.len()))
    }

    /// 그 스트림의 시청자 회차들(붙은 순서).
    #[cfg(test)]
    pub(crate) fn viewer_epochs(&self, stream: &str) -> Vec<u64> {
        self.streams
            .get(stream)
            .map(|e| e.viewers.iter().map(|v| v.epoch).collect())
            .unwrap_or_default()
    }
}
