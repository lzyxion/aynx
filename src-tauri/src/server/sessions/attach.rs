//! 붙기 · 떨어지기 · 이관. 싱크는 늘 `plug`(코어 잠금 안 생존 검사)로 꽂는다.

use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};

use super::io::{new_credit, new_viewer_credit, plug, settle_now, sink, unplug, ViewerSink};
use super::lifecycle::{detached_changed, plugged_too_late};
use super::types::{blocking, core_err, serr, ConnCtx, LeaseArgs};
use crate::i18n::tr;
use crate::server::ipc::WireError;
use crate::server::log;
use crate::output;
use crate::pty;
use crate::session_core::{core, Checkpoint, GoneReason, Kind};

#[derive(Deserialize)]
pub(super) struct Detach {
    #[serde(flatten)]
    lease: LeaseArgs,
    checkpoint: Option<Checkpoint>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachArgs {
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    take: Option<bool>,
    window: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

/// 크기는 다르거나 링이 넘쳤을 때만 맞춘다 — ConPTY 는 같은 크기에도 다시 그려 줄을 한 벌 더 얹는다.
pub(super) async fn attach(a: AttachArgs, ctx: &ConnCtx) -> Result<Value, WireError> {
    let got = {
        let mut core = core();
        let got = core
            .attach(&a.stream, a.expected_session_epoch, &a.window, a.take.unwrap_or(false))
            .map_err(|e| core_err("attach", &a.stream, e))?;
        if let (Some(c), Some(r)) = (a.cols, a.rows) {
            core.note_size(&a.stream, got.keys.lease_epoch, c, r);
        }
        core.set_lease_conn(&a.stream, ctx.id);
        // 맡겨 둔 화면은 **지우지 않는다** — 새 체크포인트 전에 GUI 가 끝나면 다음 붙기가 이 화면부터 그린다(없으면 세션 시작부터를 유실로 센다).
        got
    };
    if let Some(from) = &got.taken_from {
        log::line(format!("stream {} taken from window {from} by {}", a.stream, a.window));
    }
    detached_changed();
    if got.kind == Kind::Ssh {
        return attach_ssh(a, got, ctx).await;
    }
    let Some((slot, gate, size)) = pty::attach_parts_sized(got.id) else {
        return Err(serr(crate::errors::session_gone_closed()));
    };
    gate.lease();
    gate.resume();
    let Some(replay) = plug(&got.keys, ctx.id, &gate, || {
        let credit = new_credit(Kind::Local, got.id, Arc::clone(&gate));
        output::attach_output(&slot, sink(ctx, &got.keys, credit), a.consumed.unwrap_or(0))
    }) else {
        return Err(plugged_too_late("attach", &a.stream, ctx.id));
    };
    let redraw = replay.overrun_bytes > 0 || !replay.contiguous;
    let (cols, rows) = match (a.cols, a.rows) {
        (Some(c), Some(r)) => (c, r),
        _ => size,
    };
    if redraw || size != (cols, rows) {
        let id = got.id;
        if let Ok(Err(e)) = tokio::task::spawn_blocking(move || pty::resize_blocking(id, cols, rows)).await {
            log::line(format!("attach resize failed ({}): {e}", a.stream));
        }
    }
    if replay.overrun_bytes > 0 {
        log::line(format!(
            "attach {} — ring overrun, lost {} bytes (replaying what is left + redraw)",
            a.stream, replay.overrun_bytes
        ));
    }
    Ok(json!({
        "id": got.id,
        "kind": "local",
        "lease": got.keys,
        "start": replay.start,
        "end": replay.end,
        "replayed": replay.contiguous,
        "overrunBytes": replay.overrun_bytes,
        // 붙기 **전** PTY 크기 — 링의 재생분은 이 크기의 화면에 쓰였다(ConPTY 는 커서를 절대 위치로 옮긴다). 다른 폭에 그대로
        // 재생하면 줄 끝 글자가 엉뚱한 줄에 남는다.
        "ptyCols": size.0,
        "ptyRows": size.1,
        "shell": pty::shell_of(got.id),
        "sizeOwner": core().size_owner(&a.stream) == Some(got.keys.lease_epoch),
    }))
}

/// 원격 커널은 같은 크기면 SIGWINCH 를 내지 않아 `window-change` 를 보내도 덧그림이 없다. 원격 autorun·셸 통합·훅 설치는 다시 보내지 않는다.
async fn attach_ssh(a: AttachArgs, got: crate::session_core::Attach, ctx: &ConnCtx) -> Result<Value, WireError> {
    let Some((slot, gate, writer)) = crate::ssh::attach_parts(crate::ssh::table(), got.id) else {
        return Err(serr(crate::errors::session_gone_closed()));
    };
    gate.lease();
    gate.resume();
    let Some(replay) = plug(&got.keys, ctx.id, &gate, || {
        let credit = new_credit(Kind::Ssh, got.id, Arc::clone(&gate));
        output::attach_output(&slot, sink(ctx, &got.keys, credit), a.consumed.unwrap_or(0))
    }) else {
        return Err(plugged_too_late("attach", &a.stream, ctx.id));
    };
    if let (Some(c), Some(r)) = (a.cols, a.rows) {
        if let Err(e) = writer.window_change(c as u32, r as u32, 0, 0).await {
            log::line(format!("attach window-change failed ({}): {e}", a.stream));
        }
        output::resize_tap(&slot, c, r);
    }
    if replay.overrun_bytes > 0 {
        log::line(format!(
            "attach {} — ring overrun, lost {} bytes (replaying what is left)",
            a.stream, replay.overrun_bytes
        ));
    }
    Ok(json!({
        "id": got.id,
        "kind": "ssh",
        "lease": got.keys,
        "start": replay.start,
        "end": replay.end,
        "replayed": replay.contiguous,
        "overrunBytes": replay.overrun_bytes,
        "shell": null,
        "sizeOwner": core().size_owner(&a.stream) == Some(got.keys.lease_epoch),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ViewerArgs {
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    window: String,
    cols: Option<u16>,
    rows: Option<u16>,
    /// 기본 참 — 폰은 거짓.
    #[serde(default)]
    size_owner_eligible: Option<bool>,
    /// GUI 경로 번호 — 이 시청자의 출력 머리에 실린다(`server::proxy` 의 시청자 경로표).
    route: u64,
}

/// 빼앗지 않는다. 크기 주인이 됐으면 적어 둔 크기를 적용한 뒤 답한다.
pub(super) async fn attach_viewer(a: ViewerArgs, ctx: &ConnCtx) -> Result<Value, WireError> {
    let size = match (a.cols, a.rows) {
        (Some(c), Some(r)) => Some((c, r)),
        _ => None,
    };
    let got = {
        let mut core = core();
        let got = core
            .attach_viewer(
                &a.stream,
                a.expected_session_epoch,
                &a.window,
                a.size_owner_eligible.unwrap_or(true),
                size,
            )
            .map_err(|e| core_err("attach_viewer", &a.stream, e))?;
        if !core.set_viewer_conn(&got.keys, ctx.id) {
            drop(core);
            return Err(plugged_too_late("attach viewer", &a.stream, ctx.id));
        }
        got
    };
    let epoch = got.keys.lease_epoch;
    let parts = match got.kind {
        Kind::Local => pty::attach_parts_sized(got.id).map(|(slot, _, size)| (slot, Some(size))),
        Kind::Ssh => crate::ssh::attach_parts(crate::ssh::table(), got.id).map(|(slot, _, _)| (slot, None)),
    };
    let Some((slot, pty_size)) = parts else {
        core().drop_viewer(&a.stream, got.keys.session_epoch, epoch, GoneReason::Ended);
        return Err(serr(crate::errors::session_gone_closed()));
    };
    let rt = tokio::runtime::Handle::try_current().ok();
    // 꽂기는 코어 잠금 안에서 — 그 시청자가 아직 이 연결 것일 때만(`plug` 와 같은 이유).
    let replay = {
        let core = core();
        core.holds_viewer(&got.keys, ctx.id).then(|| {
            let credit = new_viewer_credit(got.kind, got.id, epoch);
            let sink = ViewerSink {
                tx: ctx.tx.clone(),
                keys: got.keys.clone(),
                credit,
                route: a.route,
                rt,
                tripped: std::sync::atomic::AtomicBool::new(false),
            };
            output::attach_viewer_output(&slot, epoch, sink, a.consumed.unwrap_or(0))
        })
    };
    let Some(replay) = replay else {
        return Err(plugged_too_late("attach viewer", &a.stream, ctx.id));
    };
    settle_now().await;
    let (owner, owner_size, owner_primary) = {
        let core = core();
        (
            core.size_owner(&a.stream) == Some(epoch),
            core.owner_size(&a.stream),
            core.owner_info(&a.stream).is_some_and(|i| i.2),
        )
    };
    let owner_size = owner_size.or(pty_size);
    log::line(format!(
        "viewer {epoch} attached to {} {} (stream {}) — window {} · conn {} · size owner {owner}",
        got.kind.as_str(),
        got.id,
        a.stream,
        a.window,
        ctx.id
    ));
    Ok(json!({
        "id": got.id,
        "kind": got.kind.as_str(),
        "lease": got.keys,
        "start": replay.start,
        "end": replay.end,
        "replayed": replay.contiguous,
        "overrunBytes": replay.overrun_bytes,
        "ptyCols": pty_size.map(|s| s.0),
        "ptyRows": pty_size.map(|s| s.1),
        "shell": if got.kind == Kind::Local { pty::shell_of(got.id) } else { None },
        "viewer": true,
        "sizeOwner": owner,
        "ownerCols": owner_size.map(|s| s.0),
        "ownerRows": owner_size.map(|s| s.1),
        // 이벤트의 `primary` 와 같은 뜻.
        "ownerPrimary": owner_primary,
    }))
}

/// 임대 해제 — 세션은 산다.
pub(super) fn detach(d: Detach) -> Result<(), WireError> {
    let k = &d.lease;
    let detached = {
        let mut core = core();
        let detached = core
            .detach(&k.stream, k.session_epoch, k.lease_epoch)
            .map_err(|e| core_err("detach", &k.stream, e))?;
        if let Some(cp) = d.checkpoint {
            // 체크포인트 실패(크기·회차)는 떨어지기를 막지 않는다 — 붙기는 링만으로도 이어진다.
            if let Err(e) = core.put_checkpoint(&k.stream, cp, Instant::now()) {
                log::line(format!("checkpoint refused for {} — {}", k.stream, e.message()));
            }
        }
        detached
    };
    if let Some((kind, id)) = detached {
        unplug(kind, id);
    }
    Ok(())
}

/// `kind` 가 없으면 로컬(옛 몸 모양).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Adopt {
    #[serde(default)]
    kind: Option<String>,
    id: u32,
    window: String,
    consumed: Option<u64>,
    cols: u16,
    rows: u16,
}

/// 이관 재부착 — 임대를 빼앗아 받는다(옛 창의 손잡이는 이 순간 낡는다).
pub(super) async fn adopt(a: Adopt, ctx: &ConnCtx) -> Result<Value, WireError> {
    if a.kind.as_deref() == Some("ssh") {
        return adopt_ssh(a, ctx).await;
    }
    let gone = || {
        serr(tr!(
            ko: "이어받을 로컬 세션이 없습니다 (이미 닫혔습니다)",
            en: "There is no local session to take over (it is already closed)"
        ))
    };
    let keys = {
        let mut core = core();
        let keys = core.adopt(Kind::Local, a.id, &a.window).ok_or_else(gone)?;
        core.note_size(&keys.stream, keys.lease_epoch, a.cols, a.rows);
        core.set_lease_conn(&keys.stream, ctx.id);
        keys
    };
    let (slot, gate, _) = pty::attach_parts_sized(a.id).ok_or_else(gone)?;
    gate.lease();
    gate.resume();
    let Some(mut done) = plug(&keys, ctx.id, &gate, || {
        let credit = new_credit(Kind::Local, a.id, Arc::clone(&gate));
        output::swap_output_replaying(&slot, sink(ctx, &keys, credit), a.consumed)
    }) else {
        return Err(plugged_too_late("adopt", &keys.stream, ctx.id));
    };
    if let Some(reason) = &done.reason {
        log::line(format!("handoff replay skipped (local {}) — redraw instead: {reason}", a.id));
    }
    done.lease = Some(keys);
    let (id, cols, rows) = (a.id, a.cols, a.rows);
    blocking(move || pty::resize_blocking(id, cols, rows)).await?.map_err(serr)?;
    Ok(serde_json::to_value(done).unwrap_or(Value::Null))
}

/// 실패한 `window-change` 는 이관을 막지 않는다(크기가 어긋난 화면 > 멈춘 화면).
async fn adopt_ssh(a: Adopt, ctx: &ConnCtx) -> Result<Value, WireError> {
    let gone = || {
        serr(tr!(
            ko: "이어받을 SSH 세션이 없습니다 (이미 닫혔습니다)",
            en: "There is no SSH session to take over (it is already closed)"
        ))
    };
    let keys = {
        let mut core = core();
        let keys = core.adopt(Kind::Ssh, a.id, &a.window).ok_or_else(gone)?;
        core.note_size(&keys.stream, keys.lease_epoch, a.cols, a.rows);
        core.set_lease_conn(&keys.stream, ctx.id);
        keys
    };
    let (slot, gate, writer) = crate::ssh::attach_parts(crate::ssh::table(), a.id).ok_or_else(gone)?;
    gate.lease();
    gate.resume();
    let Some(mut done) = plug(&keys, ctx.id, &gate, || {
        let credit = new_credit(Kind::Ssh, a.id, Arc::clone(&gate));
        output::swap_output_replaying(&slot, sink(ctx, &keys, credit), a.consumed)
    }) else {
        return Err(plugged_too_late("adopt", &keys.stream, ctx.id));
    };
    if let Some(reason) = &done.reason {
        log::line(format!("handoff replay skipped (ssh {}) — redraw instead: {reason}", a.id));
    }
    done.lease = Some(keys);
    if let Err(e) = writer.window_change(a.cols as u32, a.rows as u32, 0, 0).await {
        log::line(format!("handoff window-change failed (ssh {}): {e}", a.id));
    }
    output::resize_tap(&slot, a.cols, a.rows);
    Ok(serde_json::to_value(done).unwrap_or(Value::Null))
}
