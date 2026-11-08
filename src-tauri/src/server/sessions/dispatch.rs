//! op 표 — `inline_op`(서버 고리 안에서 곧바로 처리하는 op — 요청 처리 순서를 정하는 분류) · `handle`(op 하나 + 끝의 노트 비우기) ·
//! `handle_op`(갈래) · 쓰기의 문 `input_target` · op 몸 타입. `server/sessions.rs` 에서 그대로 옮겼다.

use std::collections::HashSet;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};

use super::attach::{adopt, attach, attach_viewer, detach, Detach};
use super::io::{notify_owner_size, resize_local_if_changed, retire_credit_of, settle, settle_now, unplug};
use super::lifecycle::{close_all_ssh, close_everything_blocking, close_ids, close_resource, detached_changed, detached_rows};
use super::open::{open, open_ssh};
use super::types::{blocking, body, core_err, serr, ConnCtx, LeaseArgs};
use crate::server::ipc::frame::code;
use crate::server::ipc::WireError;
use crate::server::log;
use crate::pty;
use crate::session_core::{core, Checkpoint, Holder, Kind};

// ---------------------------------------------------------------------------
// op
// ---------------------------------------------------------------------------

/// 서버 고리 안에서 곧바로(기다리지 않고 순서대로) 처리하는 op — 맵 조작뿐이다. 나머지는 태스크로 돈다(블로킹 풀을 쓴다).
pub(crate) fn inline_op(op: &str) -> bool {
    matches!(
        op,
        "probe"
            | "detach"
            | "detach_window"
            | "checkpoint"
            | "set_home"
            | "live_streams"
            | "stats"
            | "ssh_log_path"
            | "forward_list"
            | "worktree_answer"
            | "sessions_detached"
            | "session_ai_read"
            | "detach_viewer"
    )
}

/// 몸의 `lang`(`"ko"`·`"en"`)을 꺼내 서버가 만드는 사람 문구의 언어로 건다(서버에는 언어 설정이 없다 — `vault_ops` 와 같은
/// 규칙). SSH 열기·포워드의 오류 문구가 이 언어로 나간다.
fn take_lang(b: &mut Value) {
    if let Some(l) = b.get("lang").and_then(Value::as_str).and_then(crate::i18n::parse) {
        crate::i18n::set_lang(l);
    }
    if let Some(o) = b.as_object_mut() {
        o.remove("lang");
    }
}

/// 세션 op 하나 — 끝에서 코어의 노트를 비운다([`settle`]).
pub(crate) async fn handle(op: &str, b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
    let r = handle_op(op, b, ctx).await;
    settle();
    r
}

async fn handle_op(op: &str, mut b: Value, ctx: &ConnCtx) -> Result<Value, WireError> {
    take_lang(&mut b);
    match op {
        "open" => open(body(b)?, ctx).await,
        "open_ssh" => open_ssh(b, ctx).await,
        "write" => {
            let w: Write = body(b)?;
            // 주·시청자 모두(R2-A). 입력 출처는 원격 웹 크기 주인 판정에만 쓴다(3a — 작업자 타일 · 개입 잠금은 없다).
            let Holder { kind, id, .. } = input_target(&w.lease.stream, w.lease.session_epoch, w.lease.lease_epoch, w.source.as_deref())?;
            // 이 입력으로 크기 주인이 바뀌었으면 그 쪽이 적어 둔 크기를 **먼저** 건다(tmux `latest`).
            settle_now().await;
            match kind {
                Kind::Local => blocking(move || pty::write_blocking(id, w.data.as_bytes()))
                    .await?
                    .map_err(serr)?,
                Kind::Ssh => crate::ssh::write(id, w.data.into_bytes()).await.map_err(serr)?,
            }
            Ok(Value::Null)
        }
        "resize" => {
            let r: Resize = body(b)?;
            // 크기 주인의 것만 적용한다 — 나머지는 적어 두기만(R2-A · `Core::resize_request`). 오류가 아니다.
            let applied = core()
                .resize_request(&r.lease.stream, r.lease.session_epoch, r.lease.lease_epoch, r.cols, r.rows)
                .map_err(|e| core_err("resize", &r.lease.stream, e))?;
            let Some(Holder { kind, id, .. }) = applied else {
                return Ok(Value::Null);
            };
            match kind {
                Kind::Local => blocking(move || pty::resize_blocking(id, r.cols, r.rows))
                    .await?
                    .map_err(serr)?,
                Kind::Ssh => crate::ssh::resize(id, r.cols, r.rows).await.map_err(serr)?,
            }
            // 주인의 새 크기를 다른 쪽(시청자 · 주인이 아닌 주)에 알린다(R2-B).
            notify_owner_size(&r.lease.stream, r.cols, r.rows);
            Ok(Value::Null)
        }
        "claim_size" => {
            let r: Resize = body(b)?;
            // **입력 없이 크기 주인 되찾기**(10-20 — `Core::claim_size_owner`): 자격 규칙은 사람 입력과 같고 셸에는 아무것도 쓰지 않는다.
            let c = core()
                .claim_size_owner(&r.lease.stream, r.lease.session_epoch, r.lease.lease_epoch, r.cols, r.rows)
                .map_err(|e| core_err("claim_size", &r.lease.stream, e))?;
            if c.changed {
                // 노트가 새 주인의 크기를 싣는다 — 건 뒤에 답한다(이벤트 `session-size-owner` 도 여기서 나간다).
                settle_now().await;
            } else if c.owner {
                // 이미 주인 — resize 와 같다(같은 크기면 로컬은 건너뛴다).
                let Holder { kind, id, .. } = c.holder;
                match kind {
                    Kind::Local => blocking(move || resize_local_if_changed(id, r.cols, r.rows))
                        .await?
                        .map_err(serr)?,
                    Kind::Ssh => crate::ssh::resize(id, r.cols, r.rows).await.map_err(serr)?,
                }
                notify_owner_size(&r.lease.stream, r.cols, r.rows);
            }
            Ok(json!({ "sizeOwner": c.owner }))
        }
        "close" => {
            let k: LeaseArgs = body(b)?;
            // 표에 없으면(이미 닫힘 — 종료 마감이 먼저 거뒀다) 성공이다(멱등).
            let Some(kind) = core().kind_of(&k.stream) else {
                return Ok(Value::Null);
            };
            let id = core()
                .close(kind, &k.stream, k.session_epoch, k.lease_epoch)
                .map_err(|e| core_err("close", &k.stream, e))?;
            if let Some(id) = id {
                close_resource(kind, id).await?;
            }
            Ok(Value::Null)
        }
        "attach" => attach(body(b)?, ctx).await,
        "attach_viewer" => attach_viewer(body(b)?, ctx).await,
        "detach_viewer" => {
            let k: LeaseArgs = body(b)?;
            let gone = core()
                .detach_viewer(&k.stream, k.session_epoch, k.lease_epoch)
                .map_err(|e| core_err("detach_viewer", &k.stream, e))?;
            Ok(json!(gone))
        }
        "detach" => {
            let d: Detach = body(b)?;
            detach(d)?;
            detached_changed();
            Ok(Value::Null)
        }
        "probe" => {
            let p: StreamArg = body(b)?;
            Ok(serde_json::to_value(core().probe(&p.stream, Instant::now())).unwrap_or(Value::Null))
        }
        "checkpoint" => {
            let c: Stash = body(b)?;
            let mut core = core();
            core.check_owner(&c.lease.stream, c.lease.session_epoch, c.lease.lease_epoch)
                .map_err(|e| core_err("checkpoint", &c.lease.stream, e))?;
            core.put_checkpoint(&c.lease.stream, c.checkpoint, Instant::now())
                .map_err(|e| serr(e.message()))?;
            Ok(Value::Null)
        }
        "restore_done" => {
            // ③-4 — 복원이 데려가지 않은 떨어진 세션은 **닫지 않는다**(떨어진 세션 목록에 남긴다 — 옛 `release_unclaimed` 의 임시
            // 정책을 걷었다). 창 없이 끝나 닫기를 못 받은 끝난 잔해만 거둔다.
            let r: Release = body(b)?;
            let keep: HashSet<String> = r.keep.into_iter().collect();
            let (ended, marked) = core().restore_done(&r.window, &keep);
            for (kind, id) in &ended {
                core().remove_id(*kind, *id);
                close_resource(*kind, *id).await?;
            }
            if !marked.is_empty() || !ended.is_empty() {
                log::line(format!(
                    "window {} restore left {} detached session(s) kept as unclaimed {marked:?} · {} ended leftover(s) removed",
                    r.window,
                    marked.len(),
                    ended.len()
                ));
                detached_changed();
            }
            Ok(json!({ "closed": ended.len(), "unclaimed": marked.len() }))
        }
        "sessions_detached" => Ok(json!(detached_rows())),
        "close_detached" => {
            let a: StreamArg = body(b)?;
            let taken = core().take_detached(&a.stream);
            let Some((kind, id)) = taken else {
                return Ok(json!(false));
            };
            close_resource(kind, id).await?;
            log::line(format!("closed detached {} {id} (stream {}) from the detached list", kind.as_str(), a.stream));
            detached_changed();
            Ok(json!(true))
        }
        "session_ai_read" => {
            let a: AiRead = body(b)?;
            // 앱이 띄운 로컬 AI 타일에는 AI 읽기 허용이 없다(10-23) — 켬은 끔으로 적는다(되살리기 probe 의 `aiRead` 도 끔)
            let on = a.on && !crate::tile_token::is_ai_tile(&a.stream);
            Ok(json!(core().set_ai_read(&a.stream, on)))
        }
        "detach_window" => {
            let d: WindowIds = body(b)?;
            if d.db_only {
                // 그 창의 시청자는 뗀다(창이 사라졌다 — 세션은 quitAll 이 이미 떼어 뒀다).
                core().remove_window_viewers(&d.window);
                let db_skip: HashSet<String> = d.db_streams.into_iter().collect();
                let dbs = crate::db::table::detach_window(&d.window, &db_skip);
                if dbs > 0 {
                    log::line(format!("window {} gone while quitting — {dbs} db connection(s) detached", d.window));
                }
                // 트레이로 가는 창의 사이드 채팅도 떼어 둔다(다시 연 창이 attach 하거나 TTL). 프로듀서 채팅은 그 창의 구독만 지운다.
                super::side_chat::detach_window(&d.window);
                super::producer::detach_window(&d.window, &d.producer_subs);
                return Ok(json!([]));
            }
            let skip: HashSet<(Kind, u32)> = d
                .ids
                .iter()
                .map(|id| (Kind::Local, *id))
                .chain(d.ssh_ids.iter().map(|id| (Kind::Ssh, *id)))
                .collect();
            let detached = core().detach_window(&d.window, &skip);
            for (kind, id, _) in &detached {
                unplug(*kind, *id);
            }
            if !detached.is_empty() {
                detached_changed();
            }
            // 쿼리 타일의 DB 연결도 떼어 둔다(TTL — `db::table` 머리말). 떨어진 세션 목록에는 오르지 않는다.
            let db_skip: HashSet<String> = d.db_streams.into_iter().collect();
            let dbs = crate::db::table::detach_window(&d.window, &db_skip);
            if dbs > 0 {
                log::line(format!("window {} reloaded — {dbs} db connection(s) detached", d.window));
            }
            // 사이드 채팅도 떼어 둔다 — 프로세스는 산다(새 페이지가 `side_chat_attach` · 설계 1절).
            let chats = super::side_chat::detach_window(&d.window);
            if chats > 0 {
                log::line(format!("window {} reloaded — {chats} side chat(s) detached", d.window));
            }
            // 프로듀서 채팅 — 그 창의 구독만 지운다(프로세스는 산다 · 새 페이지가 다시 구독 — `server::producer`).
            super::producer::detach_window(&d.window, &d.producer_subs);
            // 그 창의 원격 새 워크트리 준비(첫 커밋 질문 대기)도 멈춘다 — 사건 **뒤에** 새 페이지가 연 접속(번호가 지금
            // 이상)은 건드리지 않는다. 이 op 는 같은 연결 위에서 새 페이지의 열기보다 먼저 처리된다.
            crate::remote_worktree::cancel_for_window(&d.window, crate::ssh::next_id());
            Ok(json!(detached.into_iter().map(|(_, _, s)| s).collect::<Vec<_>>()))
        }
        "close_window" => {
            let d: WindowIds = body(b)?;
            let prepping = crate::remote_worktree::cancel_for_window(&d.window, crate::ssh::next_id());
            if prepping > 0 {
                log::line(format!("window {} gone — stopped {prepping} remote worktree preparation(s)", d.window));
            }
            // 그 창이 **시청하던** 세션은 닫지 않는다 — 시청만 끝낸다(R2-A · 원격 창의 ws 가 닫혀 숨은 창이 부서질 때도 이 길이다).
            core().remove_window_viewers(&d.window);
            // 그 창의 프로듀서 채팅 구독도 지운다(프로세스는 산다 — 묶이기 전이면 TTL 이 시작된다 · `server::producer`).
            super::producer::detach_window(&d.window, &d.producer_subs);
            // 그 창을 사이드 채팅의 보는 창에서 뗀다(다른 창은 계속 받는다 · 남은 창이 없으면 TTL — `server::side_chat` "보는 창 여럿").
            super::side_chat::detach_window(&d.window);
            let held_local: HashSet<u32> = d.ids.into_iter().collect();
            let held_ssh: HashSet<u32> = d.ssh_ids.into_iter().collect();
            // 선별은 `reap::doomed` 의 규칙(그 창 · 이관 중 아님) — 창 파괴라 새 페이지가 없어 기준선은 없다.
            let pick = |kind: Kind, held: &HashSet<u32>| -> Vec<u32> {
                crate::reap::doomed(&core().homes(kind), &d.window, u32::MAX, held)
            };
            let local = pick(Kind::Local, &held_local);
            let ssh = pick(Kind::Ssh, &held_ssh);
            // 그 창의 DB 연결도 닫는다(떼어 둔 것까지 · 이관 중인 것은 빼고 — `db::table`).
            let held_db: HashSet<String> = d.db_streams.into_iter().collect();
            let dbs = crate::db::table::close_window(&d.window, &held_db);
            if dbs > 0 {
                log::line(format!("window {} gone — closed {dbs} db connection(s)", d.window));
            }
            close_ids(local.clone()).await?;
            for id in &ssh {
                retire_credit_of(Kind::Ssh, *id);
                crate::ssh::close_ssh_by_id(*id).await;
            }
            Ok(json!({ "local": local, "ssh": ssh }))
        }
        "live_streams" => {
            let w: WindowArg = body(b)?;
            let mut v: Vec<String> = core().live_streams_of(&w.window).into_iter().collect();
            v.sort();
            Ok(json!(v))
        }
        "adopt" => adopt(body(b)?, ctx).await,
        "set_home" => {
            let d: WindowIds = body(b)?;
            let mut core = core();
            for id in d.ids {
                core.set_home(Kind::Local, id, &d.window);
            }
            for id in d.ssh_ids {
                core.set_home(Kind::Ssh, id, &d.window);
            }
            drop(core);
            crate::db::table::set_home(&d.db_streams, &d.window);
            Ok(Value::Null)
        }
        "local_cwd" => {
            let i: IdArg = body(b)?;
            let Some(pid) = pty::cwd_pid(i.id) else {
                return Ok(Value::Null);
            };
            let cwd = blocking(move || crate::cwd::child_cwd(pid).map(|p| p.to_string_lossy().into_owned())).await?;
            Ok(json!(cwd))
        }
        "stats" => {
            let i: KindId = body(b)?;
            let s = match i.kind() {
                Kind::Local => pty::stats_of(i.id),
                Kind::Ssh => crate::ssh::stats_of(crate::ssh::table(), i.id),
            }
            .ok_or_else(|| serr("no such session".into()))?;
            Ok(serde_json::to_value(s.snapshot()).unwrap_or(Value::Null))
        }
        "close_all" => {
            let n = blocking(close_everything_blocking).await?;
            let m = close_all_ssh().await;
            // DB 연결도(떼어 둔 것 · 비밀번호를 묻는 동안 세워 둔 전송로까지) — 세션이 아니라 수에는 넣지 않는다.
            let d = crate::db::table::close_all();
            // 사이드 채팅 프로세스도(설계 1절 — db 와 같은 줄 · 세션 수에는 넣지 않는다).
            let c = super::side_chat::close_all();
            let p = super::producer::close_all();
            log::line(format!(
                "close_all — closed {n} local · {m} ssh session(s) · {d} db connection(s) · {c} side chat(s) · {p} producer chat(s)"
            ));
            Ok(json!(n + m))
        }
        "ssh_info" => {
            let i: IdArg = body(b)?;
            let info = crate::ssh::session_info(i.id).await.map_err(serr)?;
            Ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "ssh_log_path" => {
            let i: IdArg = body(b)?;
            Ok(json!(crate::ssh::log_path_of(crate::ssh::table(), i.id)))
        }
        "forward_list" => {
            let f: ForwardSession = body(b)?;
            Ok(serde_json::to_value(crate::port_forward::list_forwards(f.session_id)).unwrap_or(Value::Null))
        }
        "forward_add" => {
            let f: ForwardAdd = body(b)?;
            let info = crate::port_forward::add_forward(f.session_id, f.local_port, f.remote_host, f.remote_port, f.kind)
                .await
                .map_err(serr)?;
            Ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "forward_remove" => {
            let i: IdArg = body(b)?;
            crate::port_forward::remove_forward(i.id).await.map_err(serr)?;
            Ok(Value::Null)
        }
        "worktree_answer" => {
            let a: WorktreeAnswer = body(b)?;
            crate::remote_worktree::answer_op(&a.ticket, &a.answer, &a.window)
                .map(Value::Bool)
                .map_err(serr)
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// **쓰기의 문**(kind 무관) — 주 또는 지금 붙은 시청자의 열쇠면 `Holder`. 사람 입력(출처가 터미널 응답 `protocol` 이 아님 — 프런트
/// `src/lib/term/input-source.ts` 가 분류한다 · 모르는 값 · 없음은 사람으로 친다)이면 그 쪽이 크기 주인이 된다(`Core::input` — 원격 웹 R2).
pub(crate) fn input_target(stream: &str, session_epoch: u64, lease_epoch: u64, source: Option<&str>) -> Result<Holder, WireError> {
    let human = source != Some("protocol");
    core()
        .input(stream, session_epoch, lease_epoch, human)
        .map_err(|e| core_err("write", stream, e))
}

#[derive(Deserialize)]
struct Write {
    #[serde(flatten)]
    lease: LeaseArgs,
    data: String,
    /// 입력 출처(5단계 — `keyboard` · `paste` · `protocol`). 프런트가 분류하고, 없으면 키보드(사람)로 친다.
    #[serde(default)]
    source: Option<String>,
}

#[derive(Deserialize)]
struct Resize {
    #[serde(flatten)]
    lease: LeaseArgs,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct Stash {
    #[serde(flatten)]
    lease: LeaseArgs,
    checkpoint: Checkpoint,
}

#[derive(Deserialize)]
struct StreamArg {
    stream: String,
}

#[derive(Deserialize)]
struct WindowArg {
    window: String,
}

#[derive(Deserialize)]
struct IdArg {
    id: u32,
}

/// `{kind?, id}` — 종류가 없으면 로컬(③-2 의 몸 모양).
#[derive(Deserialize)]
struct KindId {
    #[serde(default)]
    kind: Option<String>,
    id: u32,
}

impl KindId {
    fn kind(&self) -> Kind {
        if self.kind.as_deref() == Some("ssh") {
            Kind::Ssh
        } else {
            Kind::Local
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardSession {
    session_id: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardAdd {
    session_id: u32,
    local_port: u16,
    #[serde(default)]
    remote_host: String,
    #[serde(default)]
    remote_port: u16,
    #[serde(default)]
    kind: Option<crate::port_forward::ForwardKind>,
}

#[derive(Deserialize)]
struct WorktreeAnswer {
    ticket: String,
    answer: String,
    window: String,
}

#[derive(Deserialize)]
struct Release {
    window: String,
    keep: Vec<String>,
}

#[derive(Deserialize)]
struct AiRead {
    stream: String,
    on: bool,
}

/// 창 라벨 + 손잡이 목록 — `ids` 는 로컬, `sshIds` 는 SSH, `dbStreams` 는 쿼리 타일의 DB 연결 열쇠(이관 중인 것 · 책임 창을 옮길
/// 것 — DB 연결은 세션 코어 밖 `db::table` 에 산다).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowIds {
    window: String,
    #[serde(default)]
    ids: Vec<u32>,
    #[serde(default)]
    ssh_ids: Vec<u32>,
    #[serde(default)]
    db_streams: Vec<String>,
    /// `detach_window` 만 — DB 연결만 떼어 둔다(앱 전체 종료 중의 창 파괴 — 세션은 quitAll 이 이미 떼어 뒀다 · `proxy::close_window`).
    #[serde(default)]
    db_only: bool,
    /// 그 창에서 GUI 가 쥐었던 프로듀서 채팅 구독 세대(`subGen`) — 그 세대만 지운다(같은 라벨의 새 페이지가 건 구독은 그대로 ·
    /// `server::producer::detach_window`). 비면 지울 구독이 없다.
    #[serde(default)]
    producer_subs: Vec<u64>,
}
