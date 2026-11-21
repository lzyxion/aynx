//! **AI 평면** — 세션 서버 프로세스 안의 MCP 서버(`/mcp` · `mcp.json`) · 컨텍스트 거울 · 실행 라우팅 · 작업안 · 감사 · 오케스트레이션.
//! GUI 가 없어도(종료 · 창 0개) AI 타일의 CLI 가 세션을 읽고, 승인된 작업안 · 사전 정책 자동 승인이 끝까지 돈다.
//!
//! - **사람의 승인은 여전히 GUI 다** — 승인 등급 프레임(`ops_approve`)을 만드는 코드는 GUI 의 Tauri 명령 `approve_operation` 하나뿐이고,
//!   서버는 그 프레임을 받아도 만료 · 상한 · 정책 · 빈도 한도를 **스스로 다시** 본다(`operations::approval::approve_in`).
//!   자동 승인은 서버 안의 함수 호출 `approve_in(method: auto)` 이지 파이프 프레임이 아니다.
//! - **MCP 에는 이 op 들로 가는 길이 없다** — MCP 도구는 같은 프로세스의 저장소를 직접 본다. 사람이 Run 을 여는 op 도 여기 없다.
//! - MCP 토큰은 서버가 뜰 때 새로 뽑는다(무작위원이 없으면 MCP 를 끈다) — **서버 재시작 = 새 포트 · 새 토큰**. `mcp.json` 은 서버만 쓴다.
//!   토큰은 AI 타일 환경 · `--mcp-config` · codex 인자에만 — 프런트 · 로그로 내보내지 않는다. 조정자 토큰은 없다.
//! - 거울 묶음은 **읽기 고리 안에서 온 순서대로** 적용한다(잠금과 대입뿐). 떨어진(살아 있는) 세션의 거울은 지우지 않는다.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::ipc::frame::code;
use super::ipc::WireError;
use super::log;
use crate::context::{CommandBlockMirror, LastCommand, Store};
use crate::mcp::{McpActivity, McpSignal};
use crate::operations::approval::OpsPlane;
use crate::operations::{OpEnv, OperationStore, ResultStore};
use crate::routing::RoutingTable;

pub(crate) struct AiPlane {
    pub ops: OpsPlane,
    pub signal: Arc<McpSignal>,
    pub last_seen: Arc<Mutex<Option<McpActivity>>>,
    /// 비었으면 MCP 꺼짐. **`Debug` 를 파생하지 않는다.**
    token: String,
    /// 신호 평면과 같은 포트 — 리스너가 서기 전엔 비어 있다.
    port: OnceLock<u16>,
    events: broadcast::Sender<(String, Value)>,
    /// `None` = 쓰지 않는다(시험).
    mcp_json: Option<PathBuf>,
    pub orch: Arc<crate::orchestration::Orchestration>,
}

impl AiPlane {
    /// `orch_dir` 에 남은 Run 은 orphaned 로 올라온다(`None` = 쓰지 않는다 — 시험).
    pub(crate) fn new(
        events: broadcast::Sender<(String, Value)>,
        audit_dir: Option<PathBuf>,
        mcp_json: Option<PathBuf>,
        orch_dir: Option<PathBuf>,
    ) -> Arc<AiPlane> {
        let watch_tx = events.clone();
        let emit_tx = events.clone();
        let emit: crate::operations::EmitFn = Arc::new(move |name: &str, body: Value| {
            let _ = emit_tx.send((name.to_string(), body));
        });
        let signal_tx = events;
        let signal = Arc::new(McpSignal::with_emit(Box::new(move |name: &str, body: Value| {
            let _ = signal_tx.send((name.to_string(), body));
        })));
        let token = crate::token::generate_token().unwrap_or_else(|| {
            log::line("no randomness source for the MCP token — MCP is off");
            String::new()
        });
        let audit = crate::audit::Audit::in_dir(audit_dir);
        let orch_emit = emit.clone();
        let orch = Arc::new(crate::orchestration::Orchestration::new(
            orch_dir,
            Arc::new(move |name: &str, body: Value| orch_emit(name, body)),
            audit.sender(),
        ));
        Arc::new(AiPlane {
            ops: OpsPlane {
                env: OpEnv {
                    emit,
                    ctx: Store::default(),
                    routing: RoutingTable::default(),
                },
                ops: OperationStore::default(),
                results: ResultStore::default(),
                cancels: Default::default(),
                rate: Arc::new(Default::default()),
                budget: crate::operations::ExecBudget::default().0,
                audit,
                auto: Default::default(),
                unseen: Default::default(),
                db: crate::operations::db_exec::live_db(),
            },
            orch,
            signal,
            last_seen: Arc::new(Mutex::new(None)),
            token,
            port: OnceLock::new(),
            events: watch_tx,
            mcp_json,
        })
    }

    /// `serve::run` 이 한 번 부른다. 끝난 실행 · 감독 사건은 **붙은 GUI 가 하나도 없을 때만** 서버가 알린다 — GUI 가 붙어 있으면 그쪽이 알린다.
    pub(crate) fn start_timers(self: &Arc<Self>, clients: Arc<std::sync::atomic::AtomicUsize>) {
        // 영속 쓰기가 있어 블로킹 풀에서.
        let orch = Arc::clone(&self.orch);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(5));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let o = Arc::clone(&orch);
                if let Ok((n, m)) = tokio::task::spawn_blocking(move || (o.tick(), o.recheck_unconfirmed())).await {
                    if n > 0 {
                        log::line(format!("orchestration — {n} run(s) changed on the timer"));
                    }
                    if m > 0 {
                        log::line(format!("orchestration — {m} unconfirmed worker stop(s) now confirmed"));
                    }
                }
            }
        });
        // 작업자 고정 대화의 크기 — 파일 stat 이라 블로킹 풀에서.
        let orch = Arc::clone(&self.orch);
        tokio::spawn(async move {
            let every = std::time::Duration::from_millis(crate::orchestration::progress::GROWTH_EVERY_MS);
            let mut tick = tokio::time::interval(every);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                let o = Arc::clone(&orch);
                let _ = tokio::task::spawn_blocking(move || o.transcript_tick()).await;
            }
        });
        let plane = Arc::clone(self);
        // 검토 요청이 오면 박자를 기다리지 않고 **곧바로** 훑는다 — 자동 승인될 작업안이 검토 카드로 번쩍이지 않게.
        // 훑기 몸은 그대로 하나다(`auto::sweep` → `approve_in(…, "auto")`).
        let mut wake = Some(self.events.subscribe());
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(crate::operations::auto::SWEEP_EVERY);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                match wake.as_mut() {
                    Some(rx) => {
                        tokio::select! {
                            _ = tick.tick() => {}
                            ev = rx.recv() => match ev {
                                Ok((name, body)) if name == crate::operations::EVT_STATE && body.get("state").and_then(Value::as_str) == Some("awaitingApproval") => {}
                                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(broadcast::error::RecvError::Closed) => {
                                    wake = None;
                                    continue;
                                }
                            },
                        }
                    }
                    None => {
                        tick.tick().await;
                    }
                }
                let p = Arc::clone(&plane);
                match tokio::task::spawn_blocking(move || crate::operations::auto::sweep(&p.ops)).await {
                    Ok(n) if n > 0 => log::line(format!("auto-approval — {n} task plan(s) approved by policy")),
                    _ => {}
                }
            }
        });
        let plane = Arc::clone(self);
        let mut rx = self.events.subscribe();
        tokio::spawn(async move {
            loop {
                let (name, body) = match rx.recv().await {
                    Ok(e) => e,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if clients.load(std::sync::atomic::Ordering::SeqCst) > 0 {
                    continue;
                }
                // 사건 id 로 큐에 한 번만 섰으므로 같은 사건을 두 번 보내지 않는다.
                if name == crate::orchestration::EVT_NOTICE {
                    if let Ok(n) = serde_json::from_value::<NoticeWire>(body) {
                        log::line(format!("orchestration — notice {} ({}) with no GUI attached — queued", n.id, n.kind));
                        tokio::spawn(send_notice_messenger(n));
                    }
                    continue;
                }
                if name != crate::operations::EVT_STATE {
                    continue;
                }
                // 자동 승인 훑기가 지나간 뒤에도 사람을 기다리면 메신저로 한 통.
                if let Some(id) = plane.entered_review(&body) {
                    let plane = Arc::clone(&plane);
                    tokio::spawn(async move {
                        tokio::time::sleep(crate::operations::notify::PENDING_GRACE).await;
                        if let Some(op) = plane.unattended_pending(&id) {
                            log::line(format!("plan {id} awaits approval with no GUI attached — messenger"));
                            crate::operations::notify::send_pending_messenger(op, log::line).await;
                        }
                    });
                    continue;
                }
                if let Some(run) = plane.unattended_finish(&body) {
                    log::line(format!(
                        "run {} finished ({}) with no GUI attached — queued for the next GUI",
                        run.operation_id, run.state
                    ));
                    tokio::spawn(crate::operations::notify::send_messenger(run, log::line));
                }
            }
        });
    }

    pub(crate) fn entered_review(&self, body: &Value) -> Option<String> {
        let state: crate::operations::OperationState = serde_json::from_value(body.get("state")?.clone()).ok()?;
        (state == crate::operations::OperationState::AwaitingApproval).then(|| body.get("operationId")?.as_str().map(str::to_string))?
    }

    /// 이 프로세스가 처음 보내는 것일 때만.
    pub(crate) fn unattended_pending(&self, id: &str) -> Option<crate::operations::Operation> {
        let op = {
            let map = self.ops.ops.lock().ok()?;
            map.get(id).filter(|op| crate::operations::notify::still_pending(op))?.clone()
        };
        crate::operations::notify::first_pending(id).then_some(op)
    }

    pub(crate) fn unattended_finish(&self, body: &Value) -> Option<crate::operations::notify::FinishedRun> {
        let state: crate::operations::OperationState = serde_json::from_value(body.get("state")?.clone()).ok()?;
        if !crate::operations::notify::is_finished(&state) {
            return None;
        }
        let id = body.get("operationId")?.as_str()?;
        let run = {
            let map = self.ops.ops.lock().ok()?;
            crate::operations::notify::FinishedRun::of(map.get(id)?, crate::operations::now_ms())
        };
        self.ops.unseen.push(run.clone());
        Some(run)
    }

    pub(crate) fn ctx(&self) -> &Store {
        &self.ops.env.ctx
    }

    pub(crate) fn routing(&self) -> &RoutingTable {
        &self.ops.env.routing
    }

    /// MCP 가 꺼져 있으면 `None`(그 포트의 `/mcp` 는 404).
    pub(crate) fn mcp_route(self: &Arc<Self>) -> Option<super::signal_http::McpRoute> {
        if self.token.is_empty() {
            return None;
        }
        let plane = Arc::clone(self);
        // 요청 스레드(std)가 이 런타임에 DB 일을 맡긴다 — DB 도구는 op 를 지나지 않는다.
        let db = match tokio::runtime::Handle::try_current() {
            Ok(rt) => crate::mcp::DbEnv::new(Arc::new(crate::db::ai::Live::new(rt, self.ops.audit.sender()))),
            Err(_) => crate::mcp::DbEnv::none(),
        };
        Some(Arc::new(move |request: tiny_http::Request, port: u16| {
            crate::mcp::handle_request(
                request,
                plane.ctx(),
                &plane.ops.ops,
                &plane.ops.results,
                &plane.signal,
                &plane.last_seen,
                &plane.token,
                Some(&plane.orch),
                port,
                &db,
            );
        }))
    }

    pub(crate) fn bound(&self, port: Option<u16>) {
        let Some(port) = port else {
            log::line("loopback listener failed — MCP is off");
            return;
        };
        let _ = self.port.set(port);
        if !self.running() {
            return;
        }
        if let Some(path) = &self.mcp_json {
            match crate::mcp::save_config_at(path, port, &self.token) {
                Ok(()) => log::line(format!("mcp on 127.0.0.1:{port}/mcp — mcp.json written")),
                Err(e) => log::line(format!("mcp.json write failed: {e}")),
            }
        }
    }

    pub(crate) fn running(&self) -> bool {
        !self.token.is_empty() && self.port.get().is_some()
    }

    fn coords(&self) -> Value {
        let port = self.port.get().copied().unwrap_or(0);
        json!({
            "running": self.running(),
            "port": port,
            "url": crate::mcp::endpoint_url(port),
        })
    }

    /// 비밀 없음.
    pub(crate) fn status(&self) -> Value {
        json!({
            "mcp_running": self.running(),
            "mcp_port": self.port.get(),
            "mirrors": self.ctx().lock().map(|m| m.len()).unwrap_or(0),
            "plans_in_progress": self.ops.in_progress(),
            "agent_mcp_claims": crate::agent_mcp::claimed_files().len(),
            "ai_db_connections": crate::db::ai::live_count(),
            "runs_active": self.orch.active_count(),
        })
    }
}

/// `orchestration::notice::Notice` 의 직렬화 모양과 맞춘다.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoticeWire {
    id: String,
    kind: String,
    run_name: String,
    #[serde(default)]
    task_title: Option<String>,
}

/// 창이 없으면 자리 비움으로 본다(`operations::notify` 머리말과 같다).
async fn send_notice_messenger(n: NoticeWire) {
    let prefs = match tokio::task::spawn_blocking(crate::settings::messenger_prefs).await {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut channels = Vec::new();
    if prefs.discord != Some(false) {
        channels.push(crate::messenger::Channel::Discord);
    }
    if prefs.slack != Some(false) {
        channels.push(crate::messenger::Channel::Slack);
    }
    if prefs.telegram != Some(false) {
        channels.push(crate::messenger::Channel::Telegram);
    }
    if channels.is_empty() {
        return;
    }
    let kind: &'static str = crate::orchestration::notice::kind_word(&n.kind);
    // 진단성 사건은 메신저로 보내지 않는다(앱 안 알림만).
    let Some(grade) = crate::orchestration::notice::messenger_grade(kind) else {
        return;
    };
    let text = crate::orchestration::notice::message_text(&crate::orchestration::notice::Notice {
        id: n.id,
        run_id: String::new(),
        run_name: n.run_name.clone(),
        kind,
        attempt_id: None,
        task_title: n.task_title,
        detail: None,
        at: 0,
    });
    // 이름을 읽을 수 없으면 머리 글자만 쓴다.
    let label = crate::orchestration::notice::messenger_label(&n.run_name);
    let message =
        crate::messenger::Message::plain(crate::instance::window_title(crate::instance::DEV), label, text).graded(Some(grade));
    if let Err(e) = crate::messenger::send_plain(message, channels).await {
        log::line(format!("messenger — orchestration notice not sent: {e}"));
    }
}

pub(crate) fn is_ai_op(op: &str) -> bool {
    crate::orchestration::ops::is_op(op)
        || matches!(
        op,
        "mcp_coords"
            | "mcp_token"
            | "mcp_tile_token"
            | "mcp_activity"
            | "mcp_tools"
            | "mcp_calls"
            | "console_sessions"
            | "ops_list"
            | "ops_results"
            | "audit_status"
            | "agent_mcp_claims"
            | "ctx_batch"
            | "ops_reject"
            | "ops_modify_targets"
            | "ops_cancel"
            | "agent_mcp_claim"
            | "ops_reviewing"
            | "ops_unseen_take"
            | "ops_approve"
    )
}

/// 읽기 고리 안에서 온 순서대로 처리한다 — 잠금과 대입뿐인 것만 둔다. 거울은 순서가 곧 정확성이다.
pub(crate) fn inline_op(op: &str) -> bool {
    matches!(
        op,
        "ctx_batch" | "mcp_coords" | "mcp_token" | "mcp_tile_token" | "mcp_activity" | "mcp_tools" | "mcp_calls" | "agent_mcp_claim" | "agent_mcp_claims" | "ops_reviewing"
            | "ops_unseen_take"
    )
}

fn bad_body() -> WireError {
    WireError::new(code::BAD_BODY, "bad ai request body")
}

fn fail(m: String) -> WireError {
    WireError::new(code::SESSION, m)
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|_| bad_body())
}

fn take_lang(b: &mut Value) {
    if let Some(l) = b.get("lang").and_then(Value::as_str).and_then(crate::i18n::parse) {
        crate::i18n::set_lang(l);
    }
    if let Some(o) = b.as_object_mut() {
        o.remove("lang");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpId {
    operation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Approve {
    operation_id: String,
    #[serde(default)]
    approval_method: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Modify {
    operation_id: String,
    targets: Vec<String>,
}

#[derive(Deserialize)]
struct Reviewing {
    ids: Vec<String>,
}

#[derive(Deserialize)]
struct Claim {
    stream: String,
    file: String,
}

#[derive(Deserialize)]
struct StreamBody {
    stream: String,
}

#[derive(Deserialize)]
struct Batch {
    ops: Vec<MirrorLine>,
}

/// `at` = GUI 가 그 줄을 큐에 넣은 시각 — 창 거둠의 기준선(GUI 의 시각)과 같은 축이어야 "기준선 이전에 보고된 거울" 판정이
/// 큐 지연에 흔들리지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MirrorLine {
    pub at: u64,
    #[serde(flatten)]
    pub op: MirrorOp,
}

/// 모양은 GUI 의 거울 Tauri 명령 인자 그대로(camelCase) — 프런트 계약이다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum MirrorOp {
    Report {
        key: String,
        label: String,
        kind: String,
        code: String,
        opted_in: bool,
        #[serde(default)]
        ssh_session_id: Option<u32>,
        #[serde(default)]
        screen_only: Option<bool>,
        #[serde(default)]
        workspace_id: Option<String>,
        #[serde(default)]
        workspace_name: Option<String>,
        #[serde(default)]
        tab_key: Option<String>,
        #[serde(default)]
        host_alias: Option<String>,
        owner: String,
    },
    Update {
        key: String,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        last: Option<LastCommand>,
        #[serde(default)]
        scrollback_tail: Vec<String>,
    },
    Block {
        key: String,
        block: CommandBlockMirror,
    },
    Blocks {
        key: String,
        blocks: Vec<CommandBlockMirror>,
    },
    Drop {
        key: String,
    },
    /// 죽은 창의 거울 중 기준선(GUI 의 벽시계) 이전 것만 거둔다.
    Reclaim {
        window: String,
        before: u64,
        #[serde(default)]
        keep: Vec<String>,
    },
}

impl MirrorOp {
    /// `reclaim` 은 창 단위라 열쇠가 없다 — 합치기의 벽이다.
    pub(crate) fn key(&self) -> Option<&str> {
        match self {
            MirrorOp::Report { key, .. }
            | MirrorOp::Update { key, .. }
            | MirrorOp::Block { key, .. }
            | MirrorOp::Blocks { key, .. }
            | MirrorOp::Drop { key } => Some(key),
            MirrorOp::Reclaim { .. } => None,
        }
    }
}

/// 거울 항목을 실제로 갱신했을 때(버전이 올랐을 때)만 신선도 표식을 그 줄의 시각으로.
fn apply_line(plane: &AiPlane, line: MirrorLine) -> Value {
    let key = line.op.key().map(str::to_string);
    let version = |plane: &AiPlane| {
        key.as_ref().and_then(|k| {
            plane.ctx().lock().ok().and_then(|m| m.get(k).map(|e| e.context_version))
        })
    };
    let before = version(plane);
    let out = apply_mirror(plane, line.op);
    if let Some(k) = &key {
        let after = version(plane);
        if after.is_some() && after != before {
            if let Some(e) = plane.ctx().lock().unwrap_or_else(|e| e.into_inner()).get_mut(k) {
                e.captured_at = line.at;
            }
        }
    }
    out
}

/// 락은 겹쳐 쥐지 않는다(컨텍스트 → 라우팅 → 작업안, 앞 잠금을 풀고 다음을 잡는다).
pub(crate) fn apply_mirror(plane: &AiPlane, op: MirrorOp) -> Value {
    match op {
        MirrorOp::Report {
            key,
            label,
            kind,
            code,
            opted_in,
            ssh_session_id,
            screen_only,
            workspace_id,
            workspace_name,
            tab_key,
            host_alias,
            owner,
        } => {
            let is_ssh = kind == "ssh";
            {
                let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
                crate::context::report(&mut map, key.clone(), label, kind, code, opted_in);
                if let Some(entry) = map.get_mut(&key) {
                    entry.owner = owner;
                    entry.workspace_id = workspace_id;
                    entry.workspace_name = workspace_name;
                    entry.tab_key = tab_key;
                    entry.screen_only = screen_only.unwrap_or(false);
                    // 로컬 타일에는 호스트 권한이 없다 — 별칭이 실려 와도 버린다. 빈 별칭도 없는 것과 같다.
                    entry.host_alias = if is_ssh {
                        host_alias.map(|a| a.trim().to_string()).filter(|a| !a.is_empty())
                    } else {
                        None
                    };
                }
            }
            {
                // **공유(opted_in)된 SSH 세션만** 라우팅에 싣는다. 실행 자격은 실행 직전에 다시 본다.
                let mut rmap = plane.routing().lock().unwrap_or_else(|e| e.into_inner());
                match ssh_session_id {
                    Some(id) if is_ssh && opted_in => crate::routing::set(&mut rmap, key.clone(), id),
                    // 아직 붙지 않은 채의 보고(GUI 재시작·리로드 직후)는 잇던 라우팅을 지우지 않는다 — 지우면 그 사이 승인된 작업안이
                    // "대상 없음" 으로 실패한다. 정말 끝난 id 는 실행 직전의 생존 확인(`operations::live_exec_handle`)이 막는다.
                    None if is_ssh && opted_in => {}
                    _ => crate::routing::clear(&mut rmap, &key),
                }
            }
            if !opted_in {
                // 사라진 공유를 향한 대기 작업안이 유효한 척 남지 않게.
                let mut opmap = plane.ops.ops.lock().unwrap_or_else(|e| e.into_inner());
                crate::operations::invalidate_for_target(&mut opmap, &key);
            }
            Value::Null
        }
        MirrorOp::Update {
            key,
            status,
            last,
            scrollback_tail,
        } => {
            let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
            crate::context::update(&mut map, &key, status, last, scrollback_tail);
            Value::Null
        }
        MirrorOp::Block { key, block } => {
            let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
            crate::context::push_block(&mut map, &key, block);
            Value::Null
        }
        MirrorOp::Blocks { key, blocks } => {
            let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
            crate::context::push_blocks(&mut map, &key, blocks);
            Value::Null
        }
        MirrorOp::Drop { key } => {
            drop_stream(plane, &key);
            Value::Null
        }
        MirrorOp::Reclaim { window, before, keep } => {
            let keep: HashSet<String> = keep.into_iter().collect();
            let reclaimed = {
                let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
                crate::context::reclaim_window(&mut map, &window, before, &keep)
            };
            if !reclaimed.is_empty() {
                {
                    let mut rmap = plane.routing().lock().unwrap_or_else(|e| e.into_inner());
                    for sid in &reclaimed {
                        crate::routing::clear(&mut rmap, sid);
                    }
                }
                let mut opmap = plane.ops.ops.lock().unwrap_or_else(|e| e.into_inner());
                for sid in &reclaimed {
                    crate::operations::invalidate_for_target(&mut opmap, sid);
                }
            }
            json!(reclaimed)
        }
    }
}

/// 헤드리스 거울(`delegated:…`)은 이 열쇠로 오지 않는다.
pub(crate) fn drop_stream(plane: &AiPlane, key: &str) {
    plane.ctx().lock().unwrap_or_else(|e| e.into_inner()).remove(key);
    crate::routing::clear(&mut plane.routing().lock().unwrap_or_else(|e| e.into_inner()), key);
    crate::operations::invalidate_for_target(&mut plane.ops.ops.lock().unwrap_or_else(|e| e.into_inner()), key);
}

/// 붙은 창 없이 끝나 세션 표에서 지운 스트림 — GUI 가 없어도 거울이 남지 않게 서버가 거둔다.
pub(crate) fn on_session_removed(stream: &str) {
    if let Some(plane) = super::hub::ai() {
        drop_stream(&plane, stream);
    }
}

pub(crate) fn on_session_released(stream: &str) {
    let removed = crate::agent_mcp::release_stream(stream);
    if removed > 0 {
        log::line(format!("agent-mcp — {removed} config file(s) of a released session removed"));
    }
}

/// 멱등. 관문·인증은 `crate::headless::open_delegated` 가 하고, 거울 가시성은 위임의 `read` 를 따른다.
pub(crate) async fn connect_delegated(
    ctx: &Store,
    routing: &RoutingTable,
    alias: &str,
) -> Result<String, crate::ssh::SshOpenError> {
    let stream_id = crate::routing::delegated_stream_id(alias);
    let existing = {
        let rmap = routing.lock().unwrap_or_else(|e| e.into_inner());
        crate::routing::resolve(&rmap, &stream_id)
    };
    if let Some(id) = existing {
        if crate::ssh::handle_of(crate::ssh::table(), id).is_some_and(|h| !h.is_closed()) {
            return Ok(stream_id);
        }
    }
    let id = crate::headless::open_delegated(alias).await?;
    let read = crate::delegation::Delegation::load_default().read_granted(alias);
    {
        let mut map = ctx.lock().unwrap_or_else(|e| e.into_inner());
        crate::context::report_delegated(&mut map, stream_id.clone(), alias.to_string(), alias.to_string(), read);
    }
    {
        let mut rmap = routing.lock().unwrap_or_else(|e| e.into_inner());
        crate::routing::set(&mut rmap, stream_id.clone(), id);
    }
    Ok(stream_id)
}

/// 멱등.
pub(crate) async fn close_delegated(plane: &AiPlane, stream_id: &str) {
    let ssh_id = {
        let rmap = plane.routing().lock().unwrap_or_else(|e| e.into_inner());
        crate::routing::resolve(&rmap, stream_id)
    };
    if let Some(id) = ssh_id {
        crate::headless::close_delegated(id).await;
    }
    crate::routing::clear(&mut plane.routing().lock().unwrap_or_else(|e| e.into_inner()), stream_id);
    plane.ctx().lock().unwrap_or_else(|e| e.into_inner()).remove(stream_id);
}

/// 그 id 를 아직 가리키는 라우팅만 지운다 — 재연결은 실행기가 다음 실행에서 다시 잇는다.
pub(crate) fn on_headless_exit(id: u32, alias: &str) {
    let Some(plane) = super::hub::ai() else {
        return;
    };
    let stream_id = crate::routing::delegated_stream_id(alias);
    {
        let mut rmap = plane.routing().lock().unwrap_or_else(|e| e.into_inner());
        if crate::routing::resolve(&rmap, &stream_id) == Some(id) {
            crate::routing::clear(&mut rmap, &stream_id);
        }
    }
    let mut map = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
    crate::context::mark_delegated_disconnected(&mut map, &stream_id);
}

/// 몸·응답은 로그에 남기지 않는다(토큰·거울 내용).
pub(crate) fn handle(op: &str, mut b: Value, plane: &Arc<AiPlane>) -> Result<Value, WireError> {
    take_lang(&mut b);
    match op {
        "mcp_coords" => Ok(plane.coords()),
        "mcp_token" => Ok(json!({ "token": plane.running().then(|| plane.token.clone()) })),
        // 그 스트림의 **살아 있는 회차**의 것만 — GUI Rust 만 받는다(프런트 명령 없음 · 로그 금지).
        "mcp_tile_token" => {
            let a: StreamBody = body(b)?;
            Ok(json!({ "token": plane.running().then(|| crate::tile_token::token_for(&a.stream)).flatten() }))
        }
        "mcp_activity" => Ok(plane
            .last_seen
            .lock()
            .ok()
            .and_then(|s| s.clone())
            .map(|a| serde_json::to_value(a).unwrap_or(Value::Null))
            .unwrap_or(Value::Null)),
        // 비밀 없음(`mcp::insight`).
        "mcp_tools" => Ok(serde_json::to_value(crate::mcp::insight::tool_catalog()).unwrap_or(Value::Null)),
        "mcp_calls" => Ok(serde_json::to_value(crate::mcp::insight::CALLS.recent()).unwrap_or(Value::Null)),
        "console_sessions" => Ok(crate::mcp::sessions::console_list(plane.ctx())),
        "ops_list" => crate::operations::commands::list_in(&plane.ops)
            .map(|l| {
                // 읽기만 — 승인은 훑기의 `approve_in(…, "auto")` 하나.
                let prefs = crate::settings::automation_prefs();
                let all = crate::operations::auto::AllView::load(
                    &plane.ops,
                    &l.pending,
                    crate::delegation::Delegation::load_default(),
                );
                let auto_pending = crate::operations::auto::auto_pending(&plane.ops, &l.pending, &prefs, &all);
                let auto_why = crate::operations::auto::auto_why(&plane.ops, &l.pending, &prefs, &all);
                let mut v = serde_json::to_value(l).unwrap_or(Value::Null);
                if let Some(o) = v.as_object_mut() {
                    o.insert("autoRefusals".into(), json!(plane.ops.auto.refusals()));
                    o.insert("autoPending".into(), json!(auto_pending));
                    o.insert("autoWhy".into(), json!(auto_why));
                }
                v
            })
            .map_err(fail),
        "ops_reviewing" => {
            let a: Reviewing = body(b)?;
            plane.ops.auto.set_reviewing(a.ids);
            Ok(Value::Null)
        }
        "ops_unseen_take" => Ok(json!(plane.ops.unseen.take())),
        "ops_results" => {
            let a: OpId = body(b)?;
            crate::operations::commands::results_in(&plane.ops, &a.operation_id)
                .map(|r| serde_json::to_value(r).unwrap_or(Value::Null))
                .map_err(fail)
        }
        "audit_status" => Ok(serde_json::to_value(plane.ops.audit.status()).unwrap_or(Value::Null)),
        "agent_mcp_claims" => Ok(json!(crate::agent_mcp::claimed_files())),
        "ctx_batch" => {
            let a: Batch = body(b)?;
            Ok(Value::Array(a.ops.into_iter().map(|line| apply_line(plane, line)).collect()))
        }
        "ops_reject" => {
            let a: OpId = body(b)?;
            crate::operations::commands::reject_in(&plane.ops, &a.operation_id)
                .map(|o| serde_json::to_value(o).unwrap_or(Value::Null))
                .map_err(fail)
        }
        "ops_modify_targets" => {
            let a: Modify = body(b)?;
            crate::operations::commands::modify_in(&plane.ops, &a.operation_id, a.targets)
                .map(|o| serde_json::to_value(o).unwrap_or(Value::Null))
                .map_err(fail)
        }
        "ops_cancel" => {
            let a: OpId = body(b)?;
            crate::operations::approval::cancel_in(&plane.ops, a.operation_id).map(|()| Value::Null).map_err(fail)
        }
        "agent_mcp_claim" => {
            let a: Claim = body(b)?;
            if crate::agent_mcp::claim(&a.stream, &a.file) {
                Ok(Value::Null)
            } else {
                Err(bad_body())
            }
        }
        // 영속 파일을 써서 블로킹 풀에서 온다.
        op if crate::orchestration::ops::is_op(op) => crate::orchestration::ops::handle(op, b, &plane.orch),
        "ops_approve" => {
            // 등급(승인)은 `serve` 의 `check_grade` 가 이미 봤다. 판정은 전부 여기서 다시 — GUI 를 믿지 않는다.
            let a: Approve = body(b)?;
            log::line(format!(
                "ops_approve {} ({})",
                a.operation_id,
                a.approval_method.as_deref().unwrap_or("manual")
            ));
            crate::operations::approval::approve_in(&plane.ops, a.operation_id, a.approval_method)
                .map(|o| serde_json::to_value(o).unwrap_or(Value::Null))
                .map_err(fail)
        }
        _ => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_ops_round_trip_and_apply_in_order() {
        let (tx, _rx) = broadcast::channel(16);
        let plane = AiPlane::new(tx, None, None, None);
        let ops: Vec<MirrorOp> = serde_json::from_value(json!([
            { "op": "report", "key": "s1", "label": "web", "kind": "ssh", "code": "p1", "optedIn": true,
              "sshSessionId": 7, "hostAlias": " web ", "owner": "main" },
            { "op": "update", "key": "s1", "status": "ok", "last": null, "scrollbackTail": ["a", "b"] },
            { "op": "block", "key": "s1", "block": { "id": 1, "commandLine": "ls", "cwd": null, "startedAt": 1,
              "endedAt": 2, "exit": 0, "running": false, "excerptHead": [], "excerptTail": [], "truncated": false,
              "capture": "complete" } },
            { "op": "report", "key": "s2", "label": "pwsh", "kind": "local", "code": "p2", "optedIn": true, "owner": "main" },
            { "op": "drop", "key": "s2" },
        ]))
        .unwrap();
        for op in ops {
            apply_mirror(&plane, op);
        }
        {
            let m = plane.ctx().lock().unwrap();
            let e = m.get("s1").expect("거울");
            assert_eq!((e.owner.as_str(), e.host_alias.as_deref()), ("main", Some("web")));
            assert_eq!(e.scrollback, vec!["a".to_string(), "b".to_string()]);
            assert_eq!(e.history.len(), 1);
            assert!(!m.contains_key("s2"), "지운 거울");
        }
        assert_eq!(crate::routing::resolve(&plane.routing().lock().unwrap(), "s1"), Some(7));
        // 아직 붙지 않은 채의 보고(GUI 재시작 직후 — id 없음)는 잇던 라우팅을 지우지 않는다.
        apply_mirror(
            &plane,
            serde_json::from_value(json!({ "op": "report", "key": "s1", "label": "web", "kind": "ssh", "code": "p1",
                "optedIn": true, "owner": "main" }))
            .unwrap(),
        );
        assert_eq!(crate::routing::resolve(&plane.routing().lock().unwrap(), "s1"), Some(7));
        // 공유를 끄면 라이브 필드·라우팅이 그 자리에서 비고 대기 작업안도 무효.
        apply_mirror(
            &plane,
            serde_json::from_value(json!({ "op": "report", "key": "s1", "label": "web", "kind": "ssh", "code": "p1",
                "optedIn": false, "sshSessionId": 7, "owner": "main" }))
            .unwrap(),
        );
        assert!(plane.ctx().lock().unwrap()["s1"].scrollback.is_empty());
        assert_eq!(crate::routing::resolve(&plane.routing().lock().unwrap(), "s1"), None);
        // 창 거둠 — 기준선 이전에 보고된 그 창의 거울만(남길 목록은 뺀다).
        let r = apply_mirror(
            &plane,
            MirrorOp::Reclaim { window: "main".into(), before: u64::MAX, keep: vec![] },
        );
        assert_eq!(r, json!(["s1"]));
        assert!(plane.ctx().lock().unwrap().is_empty());
    }

    /// 로컬 AI 타일(타일 MCP 토큰이 있는 스트림)의 거울 보고도 평범한 로컬 셸처럼 사람이 켠 대로 적힌다.
    #[test]
    fn local_ai_tile_report_follows_opt_in() {
        let (tx, _rx) = broadcast::channel(16);
        let plane = AiPlane::new(tx, None, None, None);
        let ai = format!("ai-tile-optin-{}", std::process::id());
        let shell = format!("shell-optin-{}", std::process::id());
        assert!(crate::tile_token::issue(&ai, 9_001).is_some());
        for key in [&ai, &shell] {
            apply_mirror(
                &plane,
                serde_json::from_value(json!({ "op": "report", "key": key, "label": "claude", "kind": "local", "code": "p1",
                    "optedIn": true, "owner": "main" }))
                .unwrap(),
            );
            apply_mirror(
                &plane,
                serde_json::from_value(json!({ "op": "update", "key": key, "status": "ok", "last": null, "scrollbackTail": ["x"] }))
                    .unwrap(),
            );
        }
        let d = crate::delegation::Delegation::default();
        {
            let m = plane.ctx().lock().unwrap();
            for key in [&ai, &shell] {
                assert!(m[key].opted_in && !m[key].scrollback.is_empty() && crate::context::ai_readable(&m[key], &d), "{key}");
            }
        }
        assert!(crate::tile_token::revoke(&ai, 9_001));
    }

    #[test]
    fn unattended_finish_queues_only_finished_runs() {
        let (tx, _rx) = broadcast::channel(16);
        let plane = AiPlane::new(tx, None, None, None);
        {
            let mut map = plane.ops.ops.lock().unwrap();
            crate::operations::create_plan(
                &mut map,
                "op-x".into(),
                "uptime".into(),
                vec!["s1".into()],
                None,
                None,
                "sequential".into(),
                "canary".into(),
                1,
                30,
                Some("업타임".into()),
                None,
                1,
                None,
            );
            map.get_mut("op-x").unwrap().state = crate::operations::OperationState::Succeeded;
            map.get_mut("op-x").unwrap().approval_method = Some("auto".into());
        }
        assert!(plane.unattended_finish(&json!({ "operationId": "op-x", "state": "running" })).is_none());
        assert!(plane.unattended_finish(&json!({ "operationId": "op-none", "state": "failed" })).is_none());
        let run = plane.unattended_finish(&json!({ "operationId": "op-x", "state": "succeeded" })).unwrap();
        assert!(run.auto && run.title.as_deref() == Some("업타임"));
        let taken = handle("ops_unseen_take", Value::Null, &plane).unwrap();
        assert_eq!(taken.as_array().map(Vec::len), Some(1));
        assert_eq!(handle("ops_unseen_take", Value::Null, &plane).unwrap(), json!([]), "꺼내면 비운다");
        // 검토 중 집합 · 거부 사유 칸
        handle("ops_reviewing", json!({ "ids": ["op-x"] }), &plane).unwrap();
        let list = handle("ops_list", Value::Null, &plane).unwrap();
        assert_eq!(list["autoRefusals"], json!({}));
    }

    #[test]
    fn ai_ops_have_grades() {
        use super::super::ipc::frame::{check_grade, required_grade};
        use super::super::ipc::Grade;
        for op in ["mcp_coords", "mcp_token", "mcp_tile_token", "mcp_activity", "mcp_tools", "mcp_calls", "console_sessions", "ops_list", "ops_results", "audit_status", "agent_mcp_claims"] {
            assert!(is_ai_op(op), "{op}");
            assert_eq!(required_grade(op), Some(Grade::Read), "{op}");
        }
        for op in ["ctx_batch", "ops_reject", "ops_modify_targets", "ops_cancel", "agent_mcp_claim", "ops_reviewing", "ops_unseen_take"] {
            assert!(is_ai_op(op), "{op}");
            assert_eq!(required_grade(op), Some(Grade::Write), "{op}");
            assert_eq!(check_grade(op, Grade::Approve).unwrap_err().code, code::APPROVE_REFUSED, "{op}");
        }
        assert!(is_ai_op("ops_approve"));
        assert_eq!(required_grade("ops_approve"), Some(Grade::Approve));
        assert!(check_grade("ops_approve", Grade::Approve).is_ok());
        for g in [Grade::Read, Grade::Write] {
            assert_eq!(check_grade("ops_approve", g).unwrap_err().code, code::GRADE_MISMATCH);
        }
    }

    /// `is_op` 의 `matches!` 목록을 소스에서 읽어 하나씩 본다 — 등급 표에 빠뜨린 op 가 없어야 한다.
    #[test]
    fn orchestration_ops_all_have_grades() {
        use super::super::ipc::frame::required_grade;
        use super::super::ipc::Grade;
        let src = include_str!("../orchestration/ops.rs");
        let start = src.find("pub(crate) fn is_op(").expect("is_op");
        let body = &src[start..start + src[start..].find("\n}\n").or_else(|| src[start..].find("\r\n}\r\n")).expect("is_op 끝")];
        let ops: Vec<&str> = body.split('"').skip(1).step_by(2).collect();
        assert!(ops.len() > 25, "is_op 목록을 못 읽었다: {}", ops.len());
        for op in ops {
            assert!(crate::orchestration::ops::is_op(op), "{op}");
            assert!(matches!(required_grade(op), Some(Grade::Read | Grade::Write)), "{op} 는 등급 표에 없다");
        }
        // 걷은 op 가 등급 표에 남아 옛 길을 되살리지 않게.
        for gone in [
            "orchestration_start_run",
            "orchestration_start_preview",
            "orchestration_continue",
            "orchestration_active_gen",
            "orchestration_bind_coordinator",
            "orchestration_wt_create",
            "orchestration_wt_list",
            "orchestration_close_orphaned",
        ] {
            assert!(!crate::orchestration::ops::is_op(gone), "{gone}");
            assert!(required_grade(gone).is_none(), "{gone} 이 등급 표에 남았다");
        }
    }
}
