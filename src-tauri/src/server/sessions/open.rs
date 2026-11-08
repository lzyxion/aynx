//! 세션 열기 — 로컬(`open` — 스트림 예약 · 신호/타일 토큰 · **셸 생성 `pty::spawn_shell` 의 유일한 자리** · 실패면 예약 · 토큰을
//! 되돌림)과 SSH(`open_ssh`). 싱크는 펌프보다 먼저 `plug` 로 꽂는다. `server/sessions.rs` 에서 그대로 옮겼다.

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

/// `open_ssh` — 몸을 풀고(serde 문구 대신 고정 문구 — 몸에 비밀번호·암호구가 실린다) 연다. 성공하면 그 임대의 연결 싱크를
/// 꽂고 링을 0 부터 재생한다(열기 중의 보안 알림·첫 프롬프트). 실패는 코드 `ssh-open` + `SshOpenError` JSON(GUI 가 풀어
/// 예전 계약 그대로 프런트에 돌려준다 — 호스트 키·비밀번호·암호구 모달은 GUI 의 일).
pub(super) async fn open_ssh(b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
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
    // 주의 크기를 적어 둔다(R2-A — 시청자가 크기 주인이었다가 주가 다시 칠 때 돌아갈 크기).
    core().note_size(&opened.lease.stream, opened.lease.lease_epoch, open_size.0, open_size.1);
    if let Some((slot, gate, _)) = crate::ssh::attach_parts(crate::ssh::table(), opened.id) {
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

/// `open_ssh` 실패 코드 — 메시지가 `SshOpenError` JSON 이다(`server::proxy::open_ssh_session` 이 푼다).
pub(crate) const SSH_OPEN: &str = "ssh-open";

/// `open` 몸 — 스트림(GUI 가 늘 채운다 — 없는 타일엔 이름을 지어 준다) · 창 라벨 · 띄울 재료 · **신호를 받을 타일인가**
/// (프런트가 스트림 id 를 준 타일 — 지어 준 이름의 타일은 훅이 가리킬 스트림이 없어 받지 않는다) · **MCP 토큰을 받을 타일인가**(`mcp` — 3차 4단계
/// 로컬 AI 타일 · 2026-10-26 감싸개가 있는 로컬 셸 타일도, AI 타일인가는 `ai`:
/// 서버가 그 타일만의 MCP 토큰을 뽑아 셸 환경에 넣는다 · 신호를 받는 타일일 때만 — 같은 주인 번호로 함께 거둔다).
#[derive(Deserialize)]
pub(super) struct Open {
    stream: String,
    window: String,
    spec: SpawnSpec,
    #[serde(default)]
    signal: bool,
    #[serde(default)]
    mcp: bool,
    /// 앱이 띄운 AI 타일인가(2026-10-26 — 감싸개가 있는 로컬 셸 타일도 `mcp` 를 켠다). 없으면 `mcp` 와 같다(옛 GUI).
    #[serde(default)]
    ai: Option<bool>,
}

/// 진행 중인 열기의 스트림 예약 — 서지 못한 채 떨어지면(실패) 스스로 푼다.
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
    // **스트림별 예약**을 먼저 — 같은 스트림이 살아 있으면 `[session-alive]`(GUI 는 붙는다), 열기 중이면 `[session-busy]`.
    core().reserve(&o.stream).map_err(|e| serr(e.message()))?;
    let mut reservation = Reservation {
        stream: o.stream.clone(),
        committed: false,
    };
    let mut spec = o.spec;
    // 신호 몫(주소 = **이 서버의** 신호 포트 · 스트림 · 신호 전용 토큰)은 서버가 뽑아 자식 환경에 넣는다(③-3a) — 로컬 토큰은
    // 파이프를 타지 않는다. GUI 가 준 같은 이름은 지운다(MCP 토큰만 GUI 몫이다).
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
    // **타일 MCP 토큰**(3차 4단계 — `crate::tile_token`): MCP 토큰은 이제 GUI 가 주지 않는다 — 서버가 AI 타일 · 감싸개가 있는 로컬 셸 타일
    // (`mcp` — 2026-10-26 · 둘의 구분은 `ai`)마다 뽑아 넣고(신호 토큰과
    // 같은 주인 번호 · 같은 수명), 회차가 서면 그 회차에 묶는다. GUI 가 같은 이름을 실어 보냈으면 지운다(전역 토큰이 타일로 새지 않게).
    spec.env.retain(|(k, _)| k != crate::tile_env::MCP_TOKEN_ENV);
    let tile_owner = match (&signal_key, o.mcp) {
        (Some((s, owner)), true) => crate::tile_token::issue(s, *owner, o.ai.unwrap_or(true)).map(|tok| {
            spec.env.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), tok));
            *owner
        }),
        _ => None,
    };
    // **권한 결정 토큰**(2026-11-01 — `crate::tile_permission`): 같은 타일(`mcp`)에 · 같은 주인 번호 · 같은 수명. 신호 토큰과 따로다(서로의 경로에서
    // 401). GUI 가 같은 이름을 실어 보냈으면 지운다.
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
    let gate = session.gate();
    let id = pty::alloc_id();
    let keys = {
        let mut core = core();
        let keys = core.commit(&o.stream, Kind::Local, id, &o.window, Instant::now());
        // 주의 크기를 적어 둔다 — 시청자가 크기 주인이었다가 주가 다시 칠 때 돌아갈 크기(R2-A).
        core.note_size(&o.stream, keys.lease_epoch, open_size.0, open_size.1);
        core.set_lease_conn(&o.stream, ctx.id);
        keys
    };
    reservation.committed = true;
    // 타일 MCP 토큰을 이 회차에 묶는다(코어 잠금 밖 — `tile_token` 머리말의 잠금 순서). 이 뒤로 그 토큰은 이 회차가 사는 동안만 통한다.
    if let Some(owner) = tile_owner {
        crate::tile_token::bind_epoch(&o.stream, owner, keys.session_epoch);
    }
    if let Some(owner) = perm_owner {
        crate::tile_permission::bind_epoch(&o.stream, owner, keys.session_epoch);
    }
    // 싱크는 펌프보다 먼저 — 첫 바이트(오프셋 0)부터 이 임대로 간다. 그 사이 연결이 끊겼으면 꽂지 않고 떨어진 채 띄운다.
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
    // 종료 감시는 **표에 오른 뒤** — 곧바로 끝나는 셸도 코어에 `Exited` 를 적을 항목이 있어야 한다.
    pty::spawn_exit_watch(id, child, mark, slot, Box::new(retire_credit));
    if !plugged {
        return Err(plugged_too_late("open local", &o.stream, ctx.id));
    }
    log::line(format!("open local {id} — stream {} · window {} · conn {}", o.stream, o.window, ctx.id));
    Ok(json!({ "id": id, "shell": shell, "lease": keys }))
}
