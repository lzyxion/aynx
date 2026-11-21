//! 세션 열기 — 로컬 · SSH. **셸 생성 `pty::spawn_shell` 의 유일한 자리**다(시험 `server_spawns_only_turns_and_verify`).

use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};

use super::io::{new_credit, plug, retire_credit, sink};
use super::lifecycle::plugged_too_late;
use super::types::{blocking, serr, ConnCtx};
use crate::server::ipc::frame::code;
use crate::server::ipc::WireError;
use crate::server::log;
use crate::output;
use crate::pty::{self, SpawnSpec, Spawned};
use crate::session_core::{core, Kind};

pub(super) async fn open_ssh(b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
    // serde 문구 대신 고정 문구 — 몸에 비밀번호·암호구가 실린다.
    let o: crate::ssh::open::OpenSsh =
        serde_json::from_value(b).map_err(|_| WireError::new(code::BAD_BODY, "bad open_ssh body"))?;
    let (stream, window) = (o.stream.clone(), o.window.clone());
    let open_size = (o.cols, o.rows);
    let opened = match crate::ssh::open::open_ssh(o, ctx.id).await {
        Ok(r) => r,
        Err(e) => {
            return Err(WireError::new(
                SSH_OPEN,
                serde_json::to_string(&e).unwrap_or_else(|_| "{}".into()),
            ))
        }
    };
    // 시청자가 크기 주인이었다가 주가 다시 칠 때 돌아갈 크기.
    core().note_size(&opened.lease.stream, opened.lease.lease_epoch, open_size.0, open_size.1);
    if let Some((slot, gate, _)) = crate::ssh::attach_parts(crate::ssh::table(), opened.id) {
        crate::screen_mirror::install(&slot, &opened.lease.stream, Kind::Ssh, open_size.0, open_size.1);
        let plugged = plug(&opened.lease, ctx.id, &gate, || {
            let credit = new_credit(Kind::Ssh, opened.id, Arc::clone(&gate));
            output::attach_output(&slot, sink(ctx, &opened.lease, credit), 0)
        });
        if plugged.is_none() {
            return Err(plugged_too_late("open ssh", &stream, ctx.id));
        }
    }
    log::line(format!(
        "open ssh {} — stream {stream} · window {window} · conn {}",
        opened.id, ctx.id
    ));
    Ok(serde_json::to_value(opened).unwrap_or(Value::Null))
}

/// 메시지가 `SshOpenError` JSON 이다(`server::proxy::open_ssh_session` 이 푼다).
pub(crate) const SSH_OPEN: &str = "ssh-open";

/// `mcp` 는 신호를 받는 타일(`signal`)일 때만 통한다. GUI 가 싣는 `ai` 는 모르는 칸이라 버린다 — 서버는 AI 타일과 감싸개 셸 타일을 가르지 않는다.
#[derive(Deserialize)]
pub(super) struct Open {
    stream: String,
    window: String,
    spec: SpawnSpec,
    #[serde(default)]
    signal: bool,
    #[serde(default)]
    mcp: bool,
}

struct Reservation {
    stream: String,
    committed: bool,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            core().unreserve(&self.stream);
        }
    }
}

pub(super) async fn open(o: Open, ctx: &ConnCtx) -> Result<Value, WireError> {
    core().reserve(&o.stream).map_err(|e| serr(e.message()))?;
    let mut reservation = Reservation {
        stream: o.stream.clone(),
        committed: false,
    };
    let mut spec = o.spec;
    // 신호 토큰은 서버가 뽑아 자식 환경에 넣는다 — 파이프를 타지 않는다. GUI 가 준 같은 이름은 지운다.
    let grant = if o.signal {
        ctx.signal_port.and_then(|_| crate::agent_signal::issue(&o.stream, None))
    } else {
        None
    };
    if o.signal {
        spec.env.retain(|(k, _)| !pty::SIGNAL_ENV_NAMES.contains(&k.as_str()));
        spec.env.extend(
            pty::signal_env_vars(ctx.signal_port, &o.stream, grant.as_ref().map(|g| g.token.as_str()))
                .into_iter()
                .map(|(k, v)| (k.to_string(), v)),
        );
    }
    let signal_key = grant.as_ref().map(crate::agent_signal::SignalGrant::key);
    drop(grant);
    // 타일 MCP 토큰은 GUI 가 주지 않는다 — 서버가 타일마다 뽑는다. GUI 가 같은 이름을 실어 보냈으면 지운다(전역 토큰이 타일로 새지 않게).
    spec.env.retain(|(k, _)| k != crate::tile_env::MCP_TOKEN_ENV);
    let tile_owner = match (&signal_key, o.mcp) {
        (Some((s, owner)), true) => crate::tile_token::issue(s, *owner).map(|tok| {
            spec.env.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), tok));
            *owner
        }),
        _ => None,
    };
    // 권한 결정 토큰은 신호 토큰과 따로다(서로의 경로에서 401). GUI 가 같은 이름을 실어 보냈으면 지운다.
    spec.env.retain(|(k, _)| k != crate::tile_env::PERMISSION_TOKEN_ENV);
    let perm_owner = match (&signal_key, o.mcp) {
        (Some((s, owner)), true) => crate::tile_permission::issue(s, *owner).map(|tok| {
            spec.env.push((crate::tile_env::PERMISSION_TOKEN_ENV.to_string(), tok));
            *owner
        }),
        _ => None,
    };
    let shell = spec.shell_id.clone();
    let open_size = (spec.cols, spec.rows);
    let spawned = blocking(move || pty::spawn_shell(&spec)).await?.map_err(serr);
    let Spawned {
        session,
        reader,
        child,
    } = match spawned {
        Ok(s) => s,
        Err(e) => {
            if let Some((s, o)) = &signal_key {
                crate::agent_signal::revoke(s, *o);
                crate::tile_token::revoke(s, *o);
                crate::server::tile_permission::revoke(s, *o);
            }
            return Err(e);
        }
    };
    let slot = session.output_slot();
    // 펌프보다 먼저 꽂아야 첫 바이트부터 따라간다.
    crate::screen_mirror::install(&slot, &o.stream, Kind::Local, open_size.0, open_size.1);
    let gate = session.gate();
    let id = pty::alloc_id();
    let keys = {
        let mut core = core();
        let keys = core.commit(&o.stream, Kind::Local, id, &o.window, Instant::now());
        // 시청자가 크기 주인이었다가 주가 다시 칠 때 돌아갈 크기.
        core.note_size(&o.stream, keys.lease_epoch, open_size.0, open_size.1);
        core.set_lease_conn(&o.stream, ctx.id);
        keys
    };
    reservation.committed = true;
    // 코어 잠금 밖에서 — `tile_token` 머리말의 잠금 순서.
    if let Some(owner) = tile_owner {
        crate::tile_token::bind_epoch(&o.stream, owner, keys.session_epoch);
    }
    if let Some(owner) = perm_owner {
        crate::tile_permission::bind_epoch(&o.stream, owner, keys.session_epoch);
    }
    // 싱크는 펌프보다 먼저 — 첫 바이트(오프셋 0)부터 이 임대로 간다.
    let plugged = plug(&keys, ctx.id, &gate, || {
        let credit = new_credit(Kind::Local, id, Arc::clone(&gate));
        output::swap_output(&slot, sink(ctx, &keys, credit));
    })
    .is_some();
    pty::install(id, session);
    pty::set_signal(id, signal_key);
    let Some(mark) = pty::pump_output(id, reader) else {
        return Err(serr(crate::errors::session_gone_closed()));
    };
    // 종료 감시는 표에 오른 뒤 — 곧바로 끝나는 셸도 코어에 `Exited` 를 적을 항목이 있어야 한다.
    pty::spawn_exit_watch(id, child, mark, slot, Box::new(retire_credit));
    if !plugged {
        return Err(plugged_too_late("open local", &o.stream, ctx.id));
    }
    log::line(format!("open local {id} — stream {} · window {} · conn {}", o.stream, o.window, ctx.id));
    Ok(json!({ "id": id, "shell": shell, "lease": keys }))
}
