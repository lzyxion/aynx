//! 세션 출력의 자원 쪽 — 주 · 시청자 크레딧 표(`BUDGET` · `CREDITS` · `VIEWER_CREDITS` — 각자 정의는 여기 하나) · 연결 싱크([`ConnSink`] ·
//! [`ViewerSink`]) · ACK · 꽂기/뽑기(`plug` — **코어 잠금 안에서** 임대 생존 검사 → 싱크 설치 · `unplug`) · 노트 비우기(`settle` 과
//! 기다리는 판 `settle_now` — resize 뒤 입력 순서 보장이라 합치지 않는다). 잠금 순서 코어 → 자원 표 → 출력 슬롯. `server/sessions.rs` 에서 그대로 옮겼다.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use serde_json::{json, Value};

use super::types::{ConnCtx, OutTx};
use crate::server::credit::{Budget, Credit, ViewerCredit};
use crate::server::ipc::frame::{Ack, OutputHeader};
use crate::server::ipc::Frame;
use crate::server::log;
use crate::output::{self, OutputSink};
use crate::pty;
use crate::session_core::{core, GoneReason, Keys, Kind, Note};

static BUDGET: LazyLock<Arc<Budget>> = LazyLock::new(|| Arc::new(Budget::default()));

/// `(종류, 세션 id)` → 지금 임대의 크레딧(붙어 있을 때만). 로컬·SSH 의 id 카운터는 따로 돌아 종류를 열쇠에 싣는다.
type CreditMap = HashMap<(Kind, u32), Arc<Credit>>;

static CREDITS: LazyLock<Mutex<CreditMap>> = LazyLock::new(Default::default);

pub(super) fn credits() -> std::sync::MutexGuard<'static, CreditMap> {
    CREDITS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 새 임대의 크레딧을 세운다(옛 것은 거둔다).
pub(super) fn new_credit(kind: Kind, id: u32, gate: Arc<output::Gate>) -> Arc<Credit> {
    let c = Credit::new_lazy(gate, Arc::clone(&BUDGET));
    if let Some(old) = credits().insert((kind, id), Arc::clone(&c)) {
        old.retire();
    }
    c
}

pub(super) fn retire_credit_of(kind: Kind, id: u32) {
    let old = credits().remove(&(kind, id));
    if let Some(c) = old {
        c.retire();
    }
    // 세션 자원이 끝나면 그 세션의 시청자 크레딧도(노트가 먼저 거뒀어도 멱등).
    viewer_credits().retain(|(k, i, _), _| !(*k == kind && *i == id));
}

/// `(종류, 세션 id, 시청자 임대 회차)` → 그 시청자의 크레딧.
type ViewerCreditMap = HashMap<(Kind, u32, u64), Arc<ViewerCredit>>;

static VIEWER_CREDITS: LazyLock<Mutex<ViewerCreditMap>> = LazyLock::new(Default::default);

pub(super) fn viewer_credits() -> std::sync::MutexGuard<'static, ViewerCreditMap> {
    VIEWER_CREDITS.lock().unwrap_or_else(|e| e.into_inner())
}

pub(super) fn new_viewer_credit(kind: Kind, id: u32, epoch: u64) -> Arc<ViewerCredit> {
    let c = ViewerCredit::new();
    viewer_credits().insert((kind, id, epoch), Arc::clone(&c));
    c
}

pub(super) fn retire_credit(id: u32) {
    retire_credit_of(Kind::Local, id);
}

/// SSH 세션의 크레딧을 거둔다 — 종료 마감(`ssh::session::finish_exit`)이 부른다.
pub(crate) fn retire_ssh_credit(id: u32) {
    retire_credit_of(Kind::Ssh, id);
}

/// 임대 하나의 출력 싱크 — 배치를 출력 프레임으로 연결 큐에 넣고 크레딧에 적는다.
pub(super) struct ConnSink {
    tx: OutTx,
    keys: Keys,
    credit: Arc<Credit>,
}

impl OutputSink for ConnSink {
    fn send(&self, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
        self.credit.on_send(offset, bytes.len());
        let header = OutputHeader {
            stream: self.keys.stream.clone(),
            session_epoch: self.keys.session_epoch,
            lease_epoch: self.keys.lease_epoch,
            offset,
            route: None,
        };
        self.tx
            .send(Frame::Output { header, bytes })
            .map_err(|_| "client connection is gone".to_string())
    }
}

pub(super) fn sink(ctx: &ConnCtx, keys: &Keys, credit: Arc<Credit>) -> ConnSink {
    ConnSink {
        tx: ctx.tx.clone(),
        keys: keys.clone(),
        credit,
    }
}

/// 시청자 하나의 출력 싱크 — 출력 머리에 GUI 경로 번호(`route`)를 싣고 [`ViewerCredit`] 에 적는다. **예산을 넘으면 보내지 않고
/// 실패한다** — 배처가 슬롯에서 이 싱크를 빼고, 여기서 한 번 그 시청자를 코어에서 떼는 일을 건다([`viewer_overflowed`]). 주의 수문은
/// 건드리지 않는다(느린 시청자가 생산자를 세우지 않는다).
pub(super) struct ViewerSink {
    pub(super) tx: OutTx,
    pub(super) keys: Keys,
    pub(super) credit: Arc<ViewerCredit>,
    pub(super) route: u64,
    /// 떼는 일을 걸 런타임(붙기 op 안에서 잡는다 — 배처는 표준 스레드다).
    pub(super) rt: Option<tokio::runtime::Handle>,
    pub(super) tripped: std::sync::atomic::AtomicBool,
}

impl OutputSink for ViewerSink {
    fn send(&self, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
        if !self.credit.on_send(offset, bytes.len()) {
            if !self.tripped.swap(true, std::sync::atomic::Ordering::SeqCst) {
                viewer_overflowed(self.keys.clone(), self.rt.clone());
            }
            return Err("viewer over budget".into());
        }
        let header = OutputHeader {
            stream: self.keys.stream.clone(),
            session_epoch: self.keys.session_epoch,
            lease_epoch: self.keys.lease_epoch,
            offset,
            route: Some(self.route),
        };
        self.tx
            .send(Frame::Output { header, bytes })
            .map_err(|_| "client connection is gone".to_string())
    }
}

/// 시청자가 예산을 넘었다 — 코어에서 떼고(노트 `ViewerGone{Overflow}`) 노트를 비운다(이벤트 · 크기 주인 다시 고르기). 배처가 슬롯
/// 잠금을 쥔 채 부르므로 **다른 스레드·태스크에서** 한다(잠금 순서 코어 → 슬롯).
fn viewer_overflowed(keys: Keys, rt: Option<tokio::runtime::Handle>) {
    let job = move || {
        if core().drop_viewer(&keys.stream, keys.session_epoch, keys.lease_epoch, GoneReason::Overflow) {
            log::line(format!(
                "viewer {} of stream {} over budget — dropped (it re-attaches to resync)",
                keys.lease_epoch, keys.stream
            ));
        }
        settle();
    };
    match rt {
        Some(h) => {
            h.spawn(async move { job() });
        }
        None => {
            std::thread::spawn(job);
        }
    }
}

// ---------------------------------------------------------------------------
// 노트 비우기 — 크기 주인 · 시청자 떨어짐 (R2-A)
// ---------------------------------------------------------------------------

/// 크기 주인이 바뀌었다 — `{stream, sessionEpoch, leaseEpoch: 주인의 임대 회차 | null, primary, cols, rows}`. 프런트는 제 열쇠와 견줘 질의에
/// 답할지 정한다(주인만 답한다 — `null` 이면 서버가 답한다). `cols`·`rows`(R2-B — 옛 GUI 는 모르는 칸을 버린다)는 주인의 크기(= PTY 크기 —
/// 주인이 아닌 쪽이 그 크기로 그린다, 모르면 `null`). **주인이 크기를 바꿔도** 시청자가 있으면 같은 몸으로 다시 낸다([`notify_owner_size`]).
pub(crate) const SIZE_OWNER_EVENT: &str = "session-size-owner";

/// 로컬 PTY 의 지금 크기(SSH 는 `None` — 서버가 원격 크기를 따로 적지 않는다).
fn pty_size_of(kind: Kind, id: u32) -> Option<(u16, u16)> {
    match kind {
        Kind::Local => pty::attach_parts_sized(id).map(|(_, _, size)| size),
        Kind::Ssh => None,
    }
}

/// 크기 주인 알림의 몸 — 크기는 주인이 적어 둔 것 → 없으면 로컬 PTY 크기 → 모르면 `null`.
fn owner_event_body(
    stream: &str,
    session_epoch: u64,
    owner: Option<u64>,
    primary: bool,
    size: Option<(u16, u16)>,
) -> Value {
    json!({
        "stream": stream,
        "sessionEpoch": session_epoch,
        "leaseEpoch": owner,
        "primary": primary,
        "cols": size.map(|s| s.0),
        "rows": size.map(|s| s.1),
    })
}

/// **주인이 크기를 바꿨다**(R2-B) — 시청자가 붙어 있으면 [`SIZE_OWNER_EVENT`] 를 같은 몸으로 다시 낸다(주인이 아닌 쪽이 새 크기로 그린다).
/// 시청자가 없으면 아무도 다른 크기로 그리지 않으므로 내지 않는다.
pub(super) fn notify_owner_size(stream: &str, cols: u16, rows: u16) {
    let Some((session_epoch, owner, primary, viewers)) = core().owner_info(stream) else { return };
    if viewers == 0 {
        return;
    }
    super::hub::emit(SIZE_OWNER_EVENT, owner_event_body(stream, session_epoch, owner, primary, Some((cols, rows))));
}
/// 시청자 하나가 떨어졌다 — `{stream, sessionEpoch, leaseEpoch, id, kind, reason}`. `reason` = `overflow`(다시 붙어 재동기화) ·
/// `ended`(세션이 끝났다) · `window` · `conn` · `detached`.
pub(crate) const VIEWER_ENDED_EVENT: &str = "session-viewer-ended";

/// 크기 적용 한 건(새 크기 주인이 적어 둔 크기).
struct ResizeJob {
    kind: Kind,
    id: u32,
    stream: String,
    cols: u16,
    rows: u16,
}

fn slot_of(kind: Kind, id: u32) -> Option<output::OutputSlot> {
    match kind {
        Kind::Local => pty::attach_parts_sized(id).map(|(slot, _, _)| slot),
        Kind::Ssh => crate::ssh::attach_parts(crate::ssh::table(), id).map(|(slot, _, _)| slot),
    }
}

/// 코어의 노트를 비워 **값싼 일**(시청자 싱크·크레딧 거두기 · 질의에 답하는 쪽 · 이벤트)을 곧바로 하고, 크기 적용은 돌려준다.
/// 코어 잠금은 노트를 꺼내는 순간만 쥔다.
fn settle_notes() -> Vec<ResizeJob> {
    let notes = core().take_notes();
    let mut jobs = Vec::new();
    for note in notes {
        match note {
            Note::ViewerGone {
                stream,
                session_epoch,
                kind,
                id,
                epoch,
                reason,
            } => {
                if let Some(slot) = slot_of(kind, id) {
                    output::remove_viewer_output(&slot, epoch);
                }
                viewer_credits().remove(&(kind, id, epoch));
                super::hub::emit(
                    VIEWER_ENDED_EVENT,
                    json!({
                        "stream": stream,
                        "sessionEpoch": session_epoch,
                        "leaseEpoch": epoch,
                        "id": id,
                        "kind": kind.as_str(),
                        "reason": reason.as_str(),
                    }),
                );
            }
            Note::Owner {
                stream,
                session_epoch,
                kind,
                id,
                owner,
                primary,
                size,
            } => {
                if let Some(slot) = slot_of(kind, id) {
                    output::set_responder(
                        &slot,
                        match owner {
                            None => output::Responder::Server,
                            Some(_) if primary => output::Responder::Primary,
                            Some(e) => output::Responder::Viewer(e),
                        },
                    );
                }
                if let Some((cols, rows)) = size {
                    jobs.push(ResizeJob {
                        kind,
                        id,
                        stream: stream.clone(),
                        cols,
                        rows,
                    });
                }
                // 실을 크기: 노트의 크기(새 주인이 적어 둔 것 — 곧 건다) → **지금** 주인이 적어 둔 크기(주가 붙으면 노트가 쌓인 뒤에 제 크기를
                // 적고 PTY 에 건다 — 노트 때는 아직 없었다 · 실기 R2-B: 집 PC 리로드 뒤 원격이 옛 크기를 받았다) → 로컬 PTY 크기.
                let shown = size
                    .or_else(|| owner.and_then(|_| core().owner_size(&stream)))
                    .or_else(|| owner.and(pty_size_of(kind, id)));
                super::hub::emit(SIZE_OWNER_EVENT, owner_event_body(&stream, session_epoch, owner, primary, shown));
            }
        }
    }
    jobs
}

/// 로컬 크기 적용 — 지금 크기와 같으면 건너뛴다(ConPTY 는 같은 크기에도 다시 그려 줄을 한 벌 더 얹는다). **블로킹.**
pub(super) fn resize_local_if_changed(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    if pty::attach_parts_sized(id).is_some_and(|(_, _, size)| size == (cols, rows)) {
        return Ok(());
    }
    pty::resize_blocking(id, cols, rows)
}

async fn apply_resizes(jobs: Vec<ResizeJob>) {
    for j in jobs {
        let r = match j.kind {
            Kind::Local => {
                let (id, c, r) = (j.id, j.cols, j.rows);
                tokio::task::spawn_blocking(move || resize_local_if_changed(id, c, r))
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()))
            }
            Kind::Ssh => crate::ssh::resize(j.id, j.cols, j.rows).await,
        };
        if let Err(e) = r {
            log::line(format!("size owner resize failed ({}): {e}", j.stream));
        }
    }
}

/// **노트를 비운다**(op 끝 · 연결 끊김 · 종료 마감 · 시청자 예산 초과). 크기 적용은 런타임이 있으면 태스크로, 없으면(종료 감시 스레드)
/// 로컬만 그 자리에서 한다(SSH 의 `window-change` 는 async 라 건너뛴다 — 끝난 세션 쪽 노트라 크기가 없는 것이 보통이다).
pub(crate) fn settle() {
    let jobs = settle_notes();
    if jobs.is_empty() {
        return;
    }
    match tokio::runtime::Handle::try_current() {
        Ok(h) => {
            h.spawn(apply_resizes(jobs));
        }
        Err(_) => {
            for j in jobs.into_iter().filter(|j| j.kind == Kind::Local) {
                if let Err(e) = resize_local_if_changed(j.id, j.cols, j.rows) {
                    log::line(format!("size owner resize failed ({}): {e}", j.stream));
                }
            }
        }
    }
}

/// [`settle`] 의 기다리는 판 — 크기 적용이 끝난 뒤 돌아온다(쓰기가 새 주인의 크기 **뒤에** 셸에 닿게 · 시청자 붙기의 답이 적용된 크기를 말하게).
pub(super) async fn settle_now() {
    let jobs = settle_notes();
    if !jobs.is_empty() {
        apply_resizes(jobs).await;
    }
}

/// 세션 하나의 출력 쪽을 "붙은 창 없음" 으로 — 싱크를 빼고(링은 계속 적는다) 수문 임대를 풀고 크레딧을 거둔다.
/// SSH 도 같다 — 셸 채널·전송로·포워드·SFTP·신호 토큰·원격 신호 파일·세션 로그는 그대로 산다.
pub(super) fn unplug(kind: Kind, id: u32) {
    let parts = match kind {
        Kind::Local => pty::attach_parts_sized(id).map(|(slot, gate, _)| (slot, gate)),
        Kind::Ssh => crate::ssh::attach_parts(crate::ssh::table(), id).map(|(slot, gate, _)| (slot, gate)),
    };
    if let Some((slot, gate)) = parts {
        output::clear_output(&slot);
        gate.unlease();
    }
    retire_credit_of(kind, id);
}

/// 새 임대에 연결 싱크를 꽂는다 — **코어 잠금 안에서** 그 임대가 아직 붙어 있고 이 연결 것일 때만(재리뷰 R02). `conn_gone` 이
/// 같은 잠금으로 떨어뜨리므로 둘 중 하나가 먼저다: 꽂은 뒤 끊기면 `conn_gone` 이 [`unplug`] 로 뽑고, 끊긴 뒤면(열기·붙기가 느린
/// 일을 하는 사이) 여기서 꽂지 않는다 — 세션은 `Detached` 로 살고 링은 계속 적는다(크레딧도 만들지 않는다 — 죽은 연결로 나간
/// 바이트의 ACK 는 오지 않아 생산자가 멈춘다). 그때 아무도 붙어 있지 않으면 수문 임대도 푼다. 꽂았으면 `Some(install 의 값)`.
///
/// 잠금 순서는 코어 → 자원 표 → 출력 슬롯 그대로다(`install` 은 크레딧 표·슬롯만 만지고 연결 큐는 무한 큐라 막히지 않는다).
pub(super) fn plug<R>(keys: &Keys, conn: u64, gate: &output::Gate, install: impl FnOnce() -> R) -> Option<R> {
    let core = core();
    if core.holds_lease(keys, conn) {
        return Some(install());
    }
    if core.status_of_stream(&keys.stream).map(|(state, _)| state) != Some("attached") {
        gate.unlease();
    }
    None
}

/// ACK — 지금 임대의 것만 크레딧에 반영한다(옛 임대·끝난 세션은 조용히 버린다). 로컬·SSH 공용.
pub(crate) fn ack(a: Ack) {
    let Ok(h) = core().holder(&a.stream, a.session_epoch, a.lease_epoch) else {
        return;
    };
    // 시청자의 ACK 는 그 시청자의 크레딧에만(R2-A) — 주의 수문과 무관하다.
    let r = if h.viewer {
        let credit = viewer_credits().get(&(h.kind, h.id, a.lease_epoch)).cloned();
        credit.map(|c| c.on_ack(a.consumed))
    } else {
        let credit = credits().get(&(h.kind, h.id)).cloned();
        credit.map(|c| c.on_ack(a.consumed))
    };
    if let Some(Err(e)) = r {
        log::line(format!("ack refused for {} — {e:?}", a.stream));
    }
}
