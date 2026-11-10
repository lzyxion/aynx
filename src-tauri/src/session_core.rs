//! 세션 코어 — 세션의 **표·임대·종료 장부** (설계 `docs/internal/session-server-design-2026-10-08.md` 4.3 · 9절 ②).
//!
//! 세션의 수명을 창(웹뷰)에서 떼는 규칙을 같은 프로세스 안의 경계로 먼저 긋는다. **로컬 PTY(②-1)와 SSH 대화형
//! 타일(②-2)** 이 이 표에 오른다. 헤드리스 위임 접속(`crate::headless`)은 창이 없어 오르지 않는다.
//!
//! ## 나눔
//!
//! - **여기(코어)**: 스트림 열쇠(`historyStreamId`) → [`Entry`] 표 · 세션 회차(`session_epoch`) · 임대
//!   (`lease_epoch` · 붙은 창) · 상태(`Attached`/`Detached`/`Exited`/`Disconnected`) · 스트림별 열기 예약 · 체크포인트 사서함.
//!   순수한 [`Core`] 와 그것을 감싼 전역 잠금 [`core`] 이 전부다 — Tauri 도 자원도 모른다(시험 대상).
//! - **`crate::pty`**·**`crate::ssh::session`**: 자원 소유 — ConPTY master·writer·자식 kill·종료 감시 / 셸 채널·
//!   포워드·SFTP·신호 토큰 — 와 출력 슬롯·수문. u32 id 는 그 표의 내부 손잡이일 뿐이고(두 표의 카운터는 따로
//!   돈다 — 그래서 손잡이는 언제나 `(Kind, id)` 다) "누가 이 세션을 쥐었나" 는 코어만 안다. **옛 `owner` 라벨은
//!   여기 [`Entry::home`] 로 옮겼다** — 두 군데 두지 않는다(`crate::reap`·`crate::handoff` 도 이 값을 읽고 쓴다).
//! - **[`local`]**: 코어와 자원 표를 함께 만지는 kind 무관 명령 — 붙기(attach)·떨어지기(detach)·살피기(probe)·
//!   체크포인트·복원이 데려가지 않은 세션 닫기, 그리고 리로드 거둠의 "떨어뜨리기".
//!
//! ## 열쇠 셋과 임대 규칙
//!
//! - `stream` = 타일의 계보(저장·이관·리로드를 넘는 키). `session_epoch` = 그 계보의 실행 회차 — 같은 스트림을
//!   다시 열 때마다 +1(표에서 지워져도 [`Core::epochs`] 가 기억한다). `lease_epoch` = 그 회차 안의 임대 회차 —
//!   열기가 1, 붙기(attach)·이관 재부착마다 +1.
//! - write·resize·pause·resume 은 `(stream, session_epoch, lease_epoch)` 가 **지금 붙어 있는 임대**와 같아야 한다.
//!   close 는 상태와 무관하게 회차 둘이 같으면 된다(떨어진 뒤·끝난 뒤의 닫기도 받는다). 다르면 `[stale-lease]`.
//! - 열기는 **스트림별 예약**을 먼저 잡는다 — 같은 스트림이 살아 있으면(`Attached`/`Detached`) `[session-alive]`
//!   (붙으라는 뜻), 다른 열기가 진행 중이면 `[session-busy]`. 끝난(`Exited`)·끊긴(`Disconnected`) 항목은 새 회차가
//!   덮는다 — SSH 재접속은 **새 채널 = 새 세션**(설계 4.3)이라 회차 +1 이다.
//! - 둘째 창의 붙기는 거절(`[session-attached]`) — `take` 를 주면 옛 임대를 즉시 무효화하고 이전한다
//!   (이관 재부착 `crate::handoff::reattach_output` 이 [`Core::adopt`] 로 같은 일을 한다 — 짐을 꺼낸 창이 받는다).
//! - **시청자**(원격 웹 R2-A — [`viewers`] 머리말): 위 규칙은 **주 임대**의 것이고 그대로다. 그 밖에 여러 창이 빼앗지 않고 시청자로
//!   덧붙는다([`Core::attach_viewer`]). 주·시청자의 임대 회차는 한 카운터([`Entry::issued`])에서 나와 겹치지 않고, 쓰기·크기·ACK 는
//!   둘 다 받는다([`Core::holder`]) — 닫기·체크포인트·`detach` 는 주의 열쇠로만(`last_lease`). 크기는 마지막 사람 입력이 정한다(크기 주인).
//!
//! ## 잠금 순서
//!
//! `crate::reap` generation → **코어** → `pty::Sessions`·`ssh::SshSessions` 표 → 출력 슬롯. 코어 잠금을 쥔 채 `await`·블로킹하지
//! 않는다(전부 맵 조작이다). 반대 방향(표를 쥔 채 코어)은 어디에도 없다.

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

/// 세션 종류 — 자원 표를 가르는 열쇠. 두 자원 표의 id 카운터는 따로 돌아 손잡이는 늘 `(Kind, id)` 다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Kind {
    Local,
    /// SSH 대화형 타일(`crate::ssh::open`) — 헤드리스 위임 접속은 오르지 않는다.
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

/// 세션의 상태. `Detached`(살아 있고 붙은 창 없음)와 끝난 것을 섞지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum State {
    Attached,
    Detached,
    /// 자식이 끝났다. 붙은 창이 닫기를 부를 때까지(멱등) 항목이 남는다 — 떨어진 채 끝났으면 곧바로 지운다.
    Exited {
        reason: Option<String>,
        final_offset: u64,
    },
    /// **SSH 전송로가 끊겼다**(셸이 끝났다는 증거 없이 — keepalive 무응답·소켓 오류). 자원은 이미 거뒀고
    /// (`crate::ssh::session` 의 종료 마감) 붙은 창의 재접속이 **새 회차**로 이 항목을 덮는다. 떨어진 채 끊겼으면
    /// 곧바로 지운다.
    Disconnected { at_ms: u64, reason: Option<String> },
}

impl State {
    /// 끝났다(셸 종료·전송로 끊김) — 쓰기·붙기·떨어지기의 대상이 아니다.
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

/// 종료 마감이 적는 끝 — [`Core::ended`].
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

/// 지금 붙어 있는 임대 — 창 라벨과 그 회차, 그리고 (세션 서버에서) 그 임대를 쥔 **클라이언트 연결**.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Lease {
    pub window: String,
    pub epoch: u64,
    /// 세션 서버의 연결 번호(③-2 — 1부터). 연결이 끊기면 그 연결의 임대를 모두 푼다([`Core::detach_conn`]).
    /// 같은 프로세스 안(GUI 의 SSH)에서는 늘 0 이다.
    pub conn: u64,
}

/// 표 한 줄.
#[derive(Debug)]
pub(crate) struct Entry {
    pub kind: Kind,
    /// 자원 표(`crate::pty::Sessions` · `crate::ssh::SshSessions`)의 손잡이.
    pub id: u32,
    pub session_epoch: u64,
    pub state: State,
    /// `Attached` 일 때만 `Some`.
    pub lease: Option<Lease>,
    /// 마지막으로 발급한 임대 회차 — 떨어진 뒤에도 남는다(다음 붙기가 +1, 떨어진 뒤의 닫기가 이 값으로 검사).
    pub last_lease: u64,
    /// **이 세션을 책임지는 창** — 붙어 있으면 그 창, 떨어졌으면 마지막으로 붙어 있던 창. 옛 `pty::Session.owner`
    /// 의 자리다: 창 파괴 거둠(`crate::reap`)·복원 뒤 고아 정리가 이 라벨로 고른다.
    pub home: String,
    #[allow(dead_code)] // 진단용 — 목록은 벽시계(`opened_at_ms`)를 보인다.
    pub opened_at: Instant,
    /// 연 시각(epoch ms) — 떨어진 세션 목록(③-4 · 0c)이 보인다.
    pub opened_at_ms: u64,
    /// 떨어진 시각(epoch ms) — `Detached` 일 때만 `Some`(붙으면 지운다).
    pub detached_at_ms: Option<u64>,
    /// **복원이 데려가지 않았다**(③-4) — 이 세션의 책임 창이 복원을 마치며(`restore_done`) 남긴 떨어진 세션. 예전에는
    /// 닫았다(`release_unclaimed` — 0c 전 임시 정책). 이제 닫지 않고 떨어진 세션 목록에 남긴다. 붙으면 지운다.
    pub unclaimed: bool,
    /// **로컬 타일의 "AI 읽기 허용"**(③-4) — 창 메모리에만 있어 GUI 재시작마다 꺼지던 값을 세션 메타로 들고 있다가 재부착이
    /// 되살린다([`Probe::ai_read`]). 세션이 끝나면 함께 사라진다. SSH 는 호스트 AI 권한이 정해 이 칸을 쓰지 않는다.
    pub ai_read: bool,
    /// **시청자**(원격 웹 R2-A — `viewers` 머리말) — 주 임대([`Entry::lease`])와 따로 같은 세션을 보는 창들. 빼앗지 않고, 주 임대의
    /// 규칙(둘째 창 거절 · `take`)과 무관하다. 붙은 순서대로.
    pub viewers: Vec<Viewer>,
    /// 이 회차에서 마지막으로 발급한 임대 회차 — **주·시청자 공용 카운터**(둘의 열쇠가 겹치지 않게). `last_lease` 는 그중 주의 것.
    pub issued: u64,
    /// **크기 주인**의 임대 회차(주 또는 시청자) — 마지막으로 입력한 자격 있는 쪽(tmux `latest`). 터미널 질의(DSR·DA·DECRQM)에 답하는
    /// 쪽도 이것이다. `None` = 자격 있는 붙은 쪽이 없다 → 서버가 대신 답한다.
    pub size_owner: Option<u64>,
    /// 주가 마지막으로 요청한 크기 — 크기 주인이 아닐 때 받은 resize 를 적어 두었다가 주인이 되면 적용한다.
    pub primary_size: Option<(u16, u16)>,
}

/// 떨어진 세션 한 줄(③-4 — op `sessions_detached`). 자원 쪽 메타(셸·별칭·마지막 출력)는 `server::sessions` 가 붙인다.
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

/// 프런트가 모든 be 호출에 동봉하는 열쇠 셋 (`SessionLease` — `session/contract.ts`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keys {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
}

/// **체크포인트** — 창이 맡겨 두는 화면 한 장(설계 4.3). 세션당 최근 1장 — 세션이 살아 있는 동안 남는다([`CHECKPOINT_TTL`] 은 표에 없는
/// 스트림의 것에만).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// xterm 직렬화(`SerializeAddon` — 이관 `buildTear` 와 같은 것).
    pub buffer: String,
    pub cols: u16,
    pub rows: u16,
    /// 그 화면에 반영돼 있던 출력 오프셋(꼬리 링 축) — 붙기가 이 뒤를 재생한다.
    pub consumed: u64,
    /// 뜬 세션의 회차 — 다른 회차의 세션에는 쓰지 않는다.
    pub session_epoch: u64,
}

/// 표에 없는 스트림의 체크포인트 수명 — 이관 사서함(`crate::handoff`)과 같은 5분. 살아 있는 세션의 것은 닫힐 때 간다.
pub(crate) const CHECKPOINT_TTL: Duration = Duration::from_secs(300);
/// 체크포인트 한 장의 상한 — 스크롤백 5000줄 직렬화는 보통 1MB 아래다. 넘으면 받지 않는다(링만으로 복원).
pub(crate) const CHECKPOINT_MAX_BYTES: usize = 8 * 1024 * 1024;

/// 코어가 거절한 이유. 프런트는 이유 코드(`errors.rs`)로 갈래를 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CoreError {
    /// 그 스트림에 세션이 없다(이미 닫혔다).
    Gone,
    /// 회차가 다르다 — 옛 임대의 호출.
    Stale,
    /// 같은 스트림이 살아 있다 — 새로 열지 말고 붙어라.
    Alive,
    /// 같은 스트림을 다른 열기가 여는 중이다.
    Busy,
    /// 다른 창이 붙어 있다(`take` 없이).
    Attached,
    /// 체크포인트가 너무 크다.
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

/// 붙기 결과 — 손잡이와 새 열쇠, 그리고 빼앗았으면 옛 창.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Attach {
    pub kind: Kind,
    pub id: u32,
    pub keys: Keys,
    pub taken_from: Option<String>,
}

/// 종료 기록 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exit {
    pub stream: String,
    pub session_epoch: u64,
    /// 떨어진 채 끝나 표에서 곧바로 지웠다(붙은 창이 닫기를 부를 일이 없다).
    pub removed: bool,
}

/// [`Core::probe`] 의 답 — 프런트 부팅 복원이 "붙을까 열까" 를 고른다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// `"none"` · `"attached"` · `"detached"` · `"exited"` · `"disconnected"` (예약 중이면 `"opening"`)
    pub state: &'static str,
    /// 세션 종류(`"local"`·`"ssh"`) — 없으면 `None`. 프런트는 타일 종류와 다르면 붙지 않는다.
    pub kind: Option<&'static str>,
    pub session_epoch: Option<u64>,
    /// 그 회차의 체크포인트가 있으면.
    pub checkpoint: Option<Checkpoint>,
    /// 로컬 타일의 "AI 읽기 허용"(세션 메타 — [`Entry::ai_read`]). 붙은 타일이 되살린다.
    pub ai_read: bool,
}

struct Stashed {
    checkpoint: Checkpoint,
    at: Instant,
}

/// 표 본체 — 순수 자료구조. 시간은 인자로 받는다(시험이 시계를 안 쓴다).
#[derive(Default)]
pub(crate) struct Core {
    streams: HashMap<String, Entry>,
    by_id: HashMap<(Kind, u32), String>,
    /// 진행 중인 열기(스트림별 예약).
    reserved: HashSet<String>,
    /// 스트림마다 마지막으로 쓴 세션 회차 — 표에서 지워져도 남아 다음 열기가 +1 한다. 스트림 하나에 u64
    /// 하나라 지우지 않는다(`crate::reap::Generations` 와 같은 이유 — 지우면 옛 회차와 겹칠 수 있다).
    epochs: HashMap<String, u64>,
    checkpoints: HashMap<String, Stashed>,
    /// 지금 살아 있는 클라이언트 연결(세션 서버 — [`Core::conn_opened`] 가 넣고 [`Core::detach_conn`] 이 뺀다). 열기·붙기가
    /// 끝나 임대에 연결을 적는 순간 그 연결이 이미 끊겼으면 붙이지 않고 떨어뜨린다([`Core::set_lease_conn`] — 재리뷰 R02).
    live_conns: HashSet<u64>,
    /// 서버가 비울 **노트**(R2-A — 크기 주인 바뀜 · 시청자 떨어짐). 코어는 자원을 모르므로 알리기만 하고, 서버가 코어 잠금 밖에서
    /// 싱크·크레딧·크기·이벤트를 처리한다(`server::sessions::settle`). 상한 `viewers::NOTES_CAP`.
    notes: Vec<Note>,
}

impl Core {
    /// 열기 예약. 살아 있으면 [`CoreError::Alive`], 다른 열기가 진행 중이면 [`CoreError::Busy`].
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

    /// 예약을 푼다(열기 실패·창이 사라짐). 없으면 아무 일도 없다.
    pub(crate) fn unreserve(&mut self, stream: &str) {
        self.reserved.remove(stream);
    }

    /// 열기가 섰다 — 예약을 풀고 새 회차·첫 임대로 올린다. 같은 스트림의 끝난·끊긴 항목은 덮는다.
    pub(crate) fn commit(
        &mut self,
        stream: &str,
        kind: Kind,
        id: u32,
        window: &str,
        now: Instant,
    ) -> Keys {
        self.reserved.remove(stream);
        // 덮이는 옛 항목(끝난·끊긴 회차)의 시청자에게도 끝을 알린다(`remove_stream`).
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

    /// **주** 임대의 검사 — 지금 붙어 있는 주와 같아야 한다. 맞으면 자원 손잡이. 제품의 쓰기·크기·ACK 는 시청자도 받는
    /// [`Core::holder`]·[`Core::input`]·[`Core::resize_request`] 를 지난다(R2-A) — 이것은 주만의 규칙을 시험이 고정하는 자리다.
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

    /// 끝나지 않은 스트림의 자원 `(종류, 손잡이, 세션 회차)` — 임대와 무관하다(시험 전용 — 3a 에서 이것을 쓰던 오케스트레이션 붙여넣기
    /// 길(`deliver.rs`)은 걷혔다: 작업자는 헤드리스 턴이다).
    #[cfg(test)]
    pub(crate) fn live_resource(&self, stream: &str) -> Option<(Kind, u32, u64)> {
        self.streams
            .get(stream)
            .filter(|e| !e.state.ended())
            .map(|e| (e.kind, e.id, e.session_epoch))
    }

    /// 이 스트림의 세션 종류(표에 없으면 `None`) — 세션 서버의 kind 무관 op(`write`·`close` …)가 자원 표를 고른다(③-3b2).
    pub(crate) fn kind_of(&self, stream: &str) -> Option<Kind> {
        self.streams.get(stream).map(|e| e.kind)
    }

    /// [`check`](Self::check) + 종류 — 다른 종류의 명령(로컬 write 로 SSH 스트림)은 없는 세션이다.
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

    /// 체크포인트 맡기기 — 그 임대(마지막으로 발급한 회차)면 붙어 있든 막 떨어졌든 받는다. `beforeunload` 의 맡기기가
    /// `pagehide` 의 detach 보다 늦게 닿아도 같은 페이지의 것이라 거절하지 않는다(실기 2026-10-08).
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

    /// 명시 닫기 — 회차 둘이 같으면 상태와 무관하게 표에서 뺀다. 없으면 `Ok(None)`(멱등).
    /// `Some(id)` 면 부른 쪽이 자원을 닫는다(끝난 세션이면 종료 마감이 이미 거둬 아무 일도 없다). 다른 종류의
    /// 스트림이면 없는 것과 같다(`Ok(None)` — 그 종류의 자원 표에는 이 스트림이 없다).
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

    /// 떨어지기(임대 해제). `Ok(Some(id))` 면 방금 떨어졌다(부른 쪽이 채널을 비우고 수문을 연다),
    /// `Ok(None)` 이면 이미 떨어져 있었다(같은 임대의 두 번째 detach — 멱등).
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

    /// 이 창에 붙어 있던 세션을 전부 떨어뜨린다(페이지 리로드·웹뷰 크래시) — `skip` 은 이관 중인 손잡이.
    /// 돌려주는 것은 방금 떨어진 `(kind, id, stream)` — 로컬이 먼저, 각 종류 안에서 id 순.
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
        // 그 창의 시청자도 뗀다(그 페이지가 사라졌다 — 새 페이지의 타일이 다시 붙는다). 주가 풀린 세션의 크기 주인도 다시 고른다.
        self.remove_viewers_where(|v| v.window == window, GoneReason::Window);
        for (_, _, stream) in &out {
            self.reassign_owner(stream);
        }
        out
    }

    /// 붙기 — 새 임대(회차 +1)를 이 창에 준다. 떨어진 세션만, 붙은 세션은 `take` 일 때만.
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
        // 새 주는 붙으며 제 크기를 건다(예전 그대로) — 그래서 크기 주인이 된다. 크기는 부른 쪽이 [`Core::note_size`] 로 적는다.
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

    /// 클라이언트 연결이 섰다(세션 서버 `serve_conn` 첫머리). `conn` 0(같은 프로세스)은 적지 않는다 — 늘 산 것으로 본다.
    pub(crate) fn conn_opened(&mut self, conn: u64) {
        if conn != 0 {
            self.live_conns.insert(conn);
        }
    }

    /// 지금 임대를 쥔 연결을 적는다(세션 서버 — 열기·붙기·이관 직후 같은 잠금 안에서). 붙어 있지 않으면 아무 일도 없다.
    ///
    /// **그 연결이 이미 끊겼으면**(열기·붙기가 느린 일을 하는 사이 [`Core::detach_conn`] 이 먼저 돌았다) 임대를 적지 않고 세션을
    /// `Detached` 로 내린다 — 죽은 연결에 붙은 채 남으면 아무도 떼지 않는다(재리뷰 R02). 그때 `false` — 부른 쪽은 싱크를 꽂지
    /// 않는다([`Core::holds_lease`] 가 같은 판정을 한 번 더 한다).
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

    /// 이 임대(`keys`)가 아직 붙어 있고 `conn` 의 것인가 — 싱크를 꽂기 직전 같은 잠금 안에서 본다(`server::sessions::plug`).
    pub(crate) fn holds_lease(&self, keys: &Keys, conn: u64) -> bool {
        self.streams.get(&keys.stream).is_some_and(|e| {
            e.state == State::Attached
                && e.session_epoch == keys.session_epoch
                && matches!(&e.lease, Some(l) if l.epoch == keys.lease_epoch && l.conn == conn)
        })
    }

    /// **클라이언트 연결이 끊겼다** — 그 연결이 쥔 임대를 모두 푼다(세션은 `Detached` 로 산다). GUI 의 정상 종료·kill 이
    /// 모두 이 길이다(설계 4.3 "죽이는 다섯의 새 뜻"). 돌려주는 것은 방금 떨어진 `(kind, id, stream)`. `conn` 0 은 받지 않는다.
    pub(crate) fn detach_conn(&mut self, conn: u64) -> Vec<(Kind, u32, String)> {
        if conn == 0 {
            return Vec::new();
        }
        // 같은 잠금 안에서 죽은 연결로 적는다 — 이 뒤에 끝나는 열기·붙기는 이 연결에 임대를 적지 못한다(`set_lease_conn`).
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
        // 그 연결의 시청자도 뗀다(원격 창도 GUI 연결 위에 있다 — 연결이 끊기면 함께 사라진다).
        self.remove_viewers_where(|v| v.conn == conn, GoneReason::Conn);
        for (_, _, stream) in &out {
            self.reassign_owner(stream);
        }
        out
    }

    /// 살아 있는(붙었거나 떨어진 — 끝나지 않은) 세션 수 — 세션 서버의 고아 자진 종료 조건(`Busy.sessions`).
    pub(crate) fn live_count(&self) -> usize {
        self.streams.values().filter(|e| !e.state.ended()).count()
    }

    /// 이관 재부착(`crate::handoff::reattach_output`) — 짐을 꺼낸 창이 **빼앗기**로 임대를 받는다. 끝났거나 없으면 `None`.
    pub(crate) fn adopt(&mut self, kind: Kind, id: u32, window: &str) -> Option<Keys> {
        let stream = self.by_id.get(&(kind, id))?.clone();
        self.attach(&stream, None, window, true)
            .ok()
            .map(|a| a.keys)
    }

    /// 책임 창만 바꾼다(이관 짐을 꺼내는 순간 — `crate::handoff::take_handoff`). 임대는 재부착이 옮긴다.
    pub(crate) fn set_home(&mut self, kind: Kind, id: u32, window: &str) {
        if let Some(entry) = self
            .by_id
            .get(&(kind, id))
            .and_then(|s| self.streams.get_mut(s))
        {
            entry.home = window.to_string();
        }
    }

    /// 자식이 끝났다 — [`ended`](Self::ended) 의 `Exited` 판.
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

    /// 세션이 끝났다(셸 종료 · SSH 전송로 끊김) — 떨어져 있었으면 표에서 곧바로 지우고, 붙어 있으면 `Exited`/
    /// `Disconnected` 로 남긴다(창의 닫기 · 재접속을 기다린다). 이미 끝난 것으로 적혀 있으면 겹친 기록은 무시한다.
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

    /// 손잡이로 지운다(창 파괴 거둠·고아 정리 — 임대 검사 없음, 부른 쪽이 이미 골랐다).
    pub(crate) fn remove_id(&mut self, kind: Kind, id: u32) -> Option<String> {
        let stream = self.by_id.get(&(kind, id))?.clone();
        self.remove_stream(&stream);
        Some(stream)
    }

    fn remove_stream(&mut self, stream: &str) -> Option<u32> {
        let entry = self.streams.remove(stream)?;
        self.by_id.remove(&(entry.kind, entry.id));
        self.checkpoints.remove(stream);
        // 시청자에게 "세션이 끝났다" 를 알린다(서버가 노트를 비우며 싱크·크레딧을 거두고 이벤트를 낸다).
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

    /// 그 종류의 `(id, 책임 창)` 한 벌 — 창 파괴 거둠(`crate::reap::doomed`)의 입력.
    pub(crate) fn homes(&self, kind: Kind) -> Vec<(u32, String)> {
        self.streams
            .values()
            .filter(|e| e.kind == kind)
            .map(|e| (e.id, e.home.clone()))
            .collect()
    }

    /// 스트림의 지금 상태 이름(`"attached"` …) — MCP 거울 목록의 `attached` 칸이 읽는다. 표에 없으면 `None`.
    #[cfg(test)]
    pub(crate) fn state_of_stream(&self, stream: &str) -> Option<&'static str> {
        self.streams.get(stream).map(|e| e.state.name())
    }

    /// **끝나지 않은 로컬 세션**의 지금 회차 — 타일 MCP 토큰의 요청마다 판정(`crate::tile_token` — 회차가 바뀌었거나 끝났으면 `stale-tile`).
    /// 떨어진(`Detached`) 세션도 산 것이다(F5 · 웹뷰 크래시 재부착은 회차를 바꾸지 않는다).
    pub(crate) fn live_epoch(&self, stream: &str) -> Option<u64> {
        self.streams
            .get(stream)
            .filter(|e| e.kind == Kind::Local && !e.state.ended())
            .map(|e| e.session_epoch)
    }

    /// **그 세션을 지금 보는 창들**(타일 권한 카드 — 2026-11-01 `crate::tile_permission`) — 붙은 주 임대의 창 + 시청자 창(같은 라벨은 한 번).
    /// 끝났거나 없는 세션이면 `None`, 떨어져(아무도 안 봄) 있으면 빈 목록.
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

    /// 상태 이름과 세션 회차 — MCP 거울의 연결 상태 칸(③-3c — `crate::mcp::sessions::enrich_sessions`).
    pub(crate) fn status_of_stream(&self, stream: &str) -> Option<(&'static str, u64)> {
        self.streams.get(stream).map(|e| (e.state.name(), e.session_epoch))
    }

    /// 이 창이 책임지는 살아 있는(끝나지 않은) 세션의 스트림 — 리로드가 거울을 남겨 둘 목록.
    pub(crate) fn live_streams_of(&self, window: &str) -> HashSet<String> {
        self.streams
            .iter()
            .filter(|(_, e)| e.home == window && !e.state.ended())
            .map(|(s, _)| s.clone())
            .collect()
    }

    /// **복원이 데려가지 않은 세션** — 이 창이 책임지는 떨어진(또는 창 없이 끝나 닫기를 못 받은) 세션 중
    /// `keep`(복원된 타일들의 스트림)에 없는 것. 붙어 있는 것은 건드리지 않는다. (시험 전용 — 제품은 [`Self::restore_done`].)
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

    /// **복원이 끝났다**(③-4 — op `restore_done`) — 이 창이 책임지는 세션 중 `keep`(복원된 타일들의 스트림)에 없는 것을
    /// 가른다: **떨어진(살아 있는) 세션은 닫지 않고** [`Entry::unclaimed`] 로 표시해 떨어진 세션 목록에 남기고(0c — 옛 임시
    /// 정책 "복원이 데려가지 않은 세션 닫기" 를 걷었다), 창 없이 끝나 닫기를 못 받은 **끝난 잔해**만 돌려준다(부른 쪽이 표에서
    /// 지우고 자원을 거둔다). 붙어 있는 것은 건드리지 않는다. `(끝난 잔해, 새로 표시한 스트림)`.
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

    /// **떨어진 세션**(③-4 — op `sessions_detached`) — 살아 있고 붙은 창이 없는 것 전부. 보일 것("아무 창도 데려가지 않은
    /// 것" = `unclaimed` 이거나 책임 창이 지금 없다)은 창 목록을 아는 GUI 가 거른다. 떨어진 시각 내림차순.
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

    /// 떨어진 세션 하나를 표에서 뺀다(③-4 — 목록의 [닫기]) — **지금 떨어져 있을 때만**(붙은 세션을 목록이 닫지 않게). 뺀
    /// 손잡이(부른 쪽이 자원을 거둔다), 떨어져 있지 않으면 `None`.
    pub(crate) fn take_detached(&mut self, stream: &str) -> Option<(Kind, u32)> {
        let e = self.streams.get(stream)?;
        if e.state != State::Detached {
            return None;
        }
        let handle = (e.kind, e.id);
        self.remove_stream(stream);
        Some(handle)
    }

    /// 로컬 타일의 "AI 읽기 허용" 을 세션 메타에 적는다(③-4). 끝났거나 없으면 `false`.
    pub(crate) fn set_ai_read(&mut self, stream: &str, on: bool) -> bool {
        match self.streams.get_mut(stream) {
            Some(e) if !e.state.ended() => {
                e.ai_read = on;
                true
            }
            _ => false,
        }
    }

    /// 로컬 타일의 "AI 읽기 허용"(세션 메타) — 끝나지 않은 세션에서만 참. 서버 해석기가 거울에 쓰기 직전에 다시 본다(`crate::screen_mirror` —
    /// 창이 없을 때도 사람이 마지막으로 정한 값보다 넓어지지 않게).
    pub(crate) fn ai_read_of(&self, stream: &str) -> bool {
        self.streams.get(stream).is_some_and(|e| e.ai_read && !e.state.ended())
    }

    /// 붙은 뒤 — 체크포인트는 다 썼다(다음 리로드는 새로 맡긴다).
    #[cfg(test)]
    pub(crate) fn drop_checkpoint(&mut self, stream: &str) {
        self.checkpoints.remove(stream);
    }
    /// 손잡이의 스트림 열쇠(자원 모니터 `server::resources` 가 로컬 셸 pid 를 타일 열쇠에 잇는다).
    pub(crate) fn stream_of(&self, kind: Kind, id: u32) -> Option<String> {
        self.by_id.get(&(kind, id)).cloned()
    }

    /// 프런트 부팅 복원의 물음 — 이 스트림이 살아 있나, 맡겨 둔 화면이 있나(같은 회차의 것만).
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

    /// 체크포인트를 맡긴다 — 살아 있는 그 회차의 세션에만, 상한 안에서. 세션당 1장(덮어쓴다).
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
        // 늦게 닿은 옛 화면이 새 화면을 덮지 않는다 — 같은 회차면 오프셋이 큰(= 나중) 쪽을 둔다.
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


    /// 수명은 **표에 없는 스트림의 화면에만** 건다 — 살아 있는 세션의 화면은 그 세션이 닫힐 때(`close`·`remove_id`) 함께 간다.
    /// 예전(②)엔 모두 5분이었다: 세션이 GUI 와 함께 죽던 때라 리로드 틈만 덮으면 됐다. ③ 뒤로는 GUI 를 끄고(트레이·kill) 몇 시간 뒤
    /// 다시 켜도 세션이 살아 있으니, 5분 뒤 화면을 버리면 다시 붙는 타일이 소비 오프셋 0 에서 링만 재생해 링(256 KiB) 앞의 화면을
    /// 통째로 잃는다(설계 10절 "GUI 종료·kill → 복구④(마지막 체크포인트+링)").
    fn sweep(&mut self, now: Instant) {
        let streams = &self.streams;
        self.checkpoints
            .retain(|stream, s| streams.contains_key(stream) || now.duration_since(s.at) < CHECKPOINT_TTL);
    }
}

static CORE: LazyLock<Mutex<Core>> = LazyLock::new(Default::default);

/// 전역 코어 잠금. 쥔 채 `await`·블로킹 금지(모듈 머리말 "잠금 순서").
pub(crate) fn core() -> MutexGuard<'static, Core> {
    CORE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 지금 epoch ms — `Disconnected.at_ms`.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 거절을 한 줄 남기고 문구로 — 옛 임대의 호출은 조용히 사라지면 원인을 못 찾는다.
pub(crate) fn refuse(what: &str, stream: &str, err: CoreError) -> String {
    if err == CoreError::Stale {
        eprintln!("[aynx] 세션 코어: 옛 임대의 {what} 거부 — 스트림 {stream}");
    }
    err.message()
}
