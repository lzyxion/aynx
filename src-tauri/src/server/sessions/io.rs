//! 세션 출력의 자원 쪽 — 크레딧 표 · 연결 싱크 · ACK · 꽂기/뽑기 · 노트 비우기. 잠금 순서 코어 → 자원 표 → 출력 슬롯.

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

/// 로컬·SSH 의 id 카운터는 따로 돌아 종류를 열쇠에 싣는다.
type CreditMap = HashMap<(Kind, u32), Arc<Credit>>;

static CREDITS: LazyLock<Mutex<CreditMap>> = LazyLock::new(Default::default);

pub(super) fn credits() -> std::sync::MutexGuard<'static, CreditMap> {
    CREDITS.lock().unwrap_or_else(|e| e.into_inner())
}

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
    viewer_credits().retain(|(k, i, _), _| !(*k == kind && *i == id));
}

/// 열쇠 = (종류, 세션 id, 시청자 임대 회차).
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

pub(crate) fn retire_ssh_credit(id: u32) {
    retire_credit_of(Kind::Ssh, id);
}

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

/// 예산을 넘으면 보내지 않고 실패한다 — 주의 수문은 건드리지 않는다(느린 시청자가 생산자를 세우지 않는다).
pub(super) struct ViewerSink {
    pub(super) tx: OutTx,
    pub(super) keys: Keys,
    pub(super) credit: Arc<ViewerCredit>,
    pub(super) route: u64,
    /// 붙기 op 안에서 잡는다 — 배처는 표준 스레드다.
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

/// 배처가 슬롯 잠금을 쥔 채 부르므로 **다른 스레드·태스크에서** 한다(잠금 순서 코어 → 슬롯).
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
// 노트 비우기 — 크기 주인 · 시청자 떨어짐
// ---------------------------------------------------------------------------

/// 프런트는 `leaseEpoch` 를 제 열쇠와 견줘 질의에 답할지 정한다(주인만 답한다 — `null` 이면 서버가 답한다).
pub(crate) const SIZE_OWNER_EVENT: &str = "session-size-owner";

/// SSH 는 `None` — 서버가 원격 크기를 따로 적지 않는다.
fn pty_size_of(kind: Kind, id: u32) -> Option<(u16, u16)> {
    match kind {
        Kind::Local => pty::attach_parts_sized(id).map(|(_, _, size)| size),
        Kind::Ssh => None,
    }
}

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

pub(super) fn notify_owner_size(stream: &str, cols: u16, rows: u16) {
    let Some((session_epoch, owner, primary, viewers)) = core().owner_info(stream) else { return };
    if viewers == 0 {
        return;
    }
    super::hub::emit(SIZE_OWNER_EVENT, owner_event_body(stream, session_epoch, owner, primary, Some((cols, rows))));
}
/// `reason` 이 `overflow` 면 프런트가 다시 붙어 재동기화한다.
pub(crate) const VIEWER_ENDED_EVENT: &str = "session-viewer-ended";

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

/// 값싼 일은 곧바로 하고 크기 적용은 돌려준다. 코어 잠금은 노트를 꺼내는 순간만 쥔다.
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
                // **지금** 주인이 적어 둔 크기를 다시 본다 — 주는 노트가 쌓인 뒤에 제 크기를 적는다(빼면 메인 PC 리로드 뒤 원격이 옛 크기를 받는다).
                let shown = size
                    .or_else(|| owner.and_then(|_| core().owner_size(&stream)))
                    .or_else(|| owner.and(pty_size_of(kind, id)));
                super::hub::emit(SIZE_OWNER_EVENT, owner_event_body(&stream, session_epoch, owner, primary, shown));
            }
        }
    }
    jobs
}

/// 지금 크기와 같으면 건너뛴다 — ConPTY 는 같은 크기에도 다시 그려 줄을 한 벌 더 얹는다. **블로킹.**
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

/// 런타임이 없으면(종료 감시 스레드) 로컬 크기만 그 자리에서 건다 — SSH 의 `window-change` 는 async 라 건너뛴다.
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

/// [`settle`] 의 기다리는 판 — 쓰기가 새 주인의 크기 **뒤에** 셸에 닿아야 해서 합치지 않는다.
pub(super) async fn settle_now() {
    let jobs = settle_notes();
    if !jobs.is_empty() {
        apply_resizes(jobs).await;
    }
}

/// 출력 쪽만 "붙은 창 없음" 으로 — 링 · 셸 채널 · 포워드 · 신호 토큰 등은 그대로 산다.
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

/// **코어 잠금 안에서** 그 임대가 아직 이 연결 것일 때만 꽂는다 — `conn_gone` 이 같은 잠금으로 떨어뜨린다. 끊긴 뒤 꽂으면 죽은
/// 연결로 나간 바이트의 ACK 가 오지 않아 생산자가 멈춘다. `install` 은 크레딧 표·슬롯만 만진다(잠금 순서).
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

/// 옛 임대·끝난 세션의 ACK 는 조용히 버린다.
pub(crate) fn ack(a: Ack) {
    let Ok(h) = core().holder(&a.stream, a.session_epoch, a.lease_epoch) else {
        return;
    };
    // 시청자의 ACK 는 주의 수문과 무관하다.
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
