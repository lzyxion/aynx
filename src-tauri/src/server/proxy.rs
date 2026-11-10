//! GUI 쪽 **세션 프록시** — 프런트가 부르던 Tauri 명령(`open_local_session`·`write_session`·`resize_session`·
//! `close_session`·`local_cwd`)을 같은 이름·인자·반환으로 두고 몸만 세션 서버 op 로 옮긴다(③-2). **③-3b2 부터 SSH 타일도
//! 서버에 산다** — 쓰기·크기·닫기·ACK 는 로컬과 같은 명령(kind 무관 op)이고, SSH 만의 것(열기·연결 상태·포워드)은
//! `server::ssh_proxy`. 세션 코어의 kind 무관 명령(`attach_session` …)·이관(`reattach_output`)·창 거둠(`reap`)·통계도 이 파일의
//! 문을 지난다.
//!
//! ## 출력 경로표
//!
//! 서버의 출력 프레임(`Output{stream, sessionEpoch, leaseEpoch, offset}`)을 그 스트림의 웹뷰 `Channel` 로 옮긴다
//! ([`on_output`]). GUI 프로세스 하나 = 연결 하나라, 한 스트림의 프레임은 이관 전후가 한 줄로 온다. 그래서 경로 하나가
//! **지금 받을 임대**를 안다:
//! - 열기·붙기·이관을 보낼 때 경로를 "대기" 로 세운다 — 응답(새 열쇠)보다 먼저 오는 프레임(붙기의 재생)도 받아야 한다.
//!   대기 중에는 **옛 열쇠보다 큰** 임대의 프레임만 받는다(바닥 = 그 스트림이 마지막으로 쥐었던 열쇠 — 옛 창 몫이 새 창에
//!   섞이지 않게).
//! - 응답이 오면 열쇠를 박는다 — 그 뒤로는 그 임대의 프레임만.
//! - 닫기·떨어지기·종료면 지운다(그 열쇠일 때만 — 새 경로를 건드리지 않는다).
//!
//! **시청자 경로**(원격 웹 R2-A — 판 17)는 따로다: 스트림 하나에 시청자 여럿(집 PC 창 · `remote-*` 숨은 창 — 원격 창의 `Channel` 은
//! 관문이 가로채 ws 이진 프레임으로 보낸다)이라 열쇠는 GUI 가 뽑은 **경로 번호**(`route`)다. `attach_viewer` 몸에 실어 보내면 서버가 그
//! 시청자의 출력 머리에 그대로 싣는다 — 응답 전에 오는 재생 프레임도 번호로 바로 간다(대기·바닥이 필요 없다). 경로는 시청자 떼기 ·
//! 이벤트 `session-viewer-ended`(예산 초과 재동기화 · 세션 끝 · 창 · 연결) · 그 창의 파괴/리로드 · 떨어진 채 끝남 · 서버 끊김에서 지운다.
//! 시청자의 쓰기·크기·ACK 는 예전 명령 그대로 시청자의 열쇠를 싣는다(서버가 가른다).
//!
//! ## ACK
//!
//! 프런트가 화면에 반영한 오프셋을 `ack_local_output` 으로 보내면 그대로 ACK 프레임이 된다(응답 없음). 예전 `pause_/
//! resume_local_output` 은 없다 — 파이프 너머의 순서 없는 두 신호 대신 단조 값 하나다(`server::credit`).
//!
//! ## 서버가 멈추면
//!
//! 연결이 끊기면([`on_server_lost`]) 경로를 쥔 타일마다 종료를 알린다 — 로컬은 `local-exit`("세션 서버가 멈췄습니다 —
//! Enter 로 새 셸"), SSH 는 `ssh-exit{reason:"error"}`(끊김과 같은 길 — 재접속 배너·자동 재접속이 새 서버에 새 회차를
//! 연다). 신호 토큰·SSH 연결은 서버와 함께 사라졌다. 연결 고리(`client`)는 곧바로 새 서버를 띄운다.
//!
//! ## 신호 평면 (③-3a)
//!
//! 토큰 표·에이전트 상태 표·`/agent-signal` 수신은 서버에 산다(`server::signals` · `server::signal_http`). 여기 있는 것은
//! 창의 Tauri 명령 [`agent_states_snapshot`] · [`agent_state_forget`](이름·반환은 예전 그대로) 둘뿐이다. 신호 토큰은 로컬·
//! 원격 모두 서버 안에서 뽑고 거둬 이 파일(=파이프)을 지나지 않는다(③-3b2 — 원격 토큰도 SSH 와 함께 서버로 갔다).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;

use super::client;
use super::ipc::frame::{Ack, OutputHeader};
use super::ipc::Grade;
use crate::i18n::tr;
use crate::session_core::{Keys, Kind};

/// 앱 전체 종료(메인 창 X → `workspace_exit_app`) 중 — 창 파괴 거둠이 로컬 세션을 **닫지 않는다**(끊기만 한다 — 세션은
/// 서버에 산다). ③-2 의 변화: 예전 quitAll 은 세션을 모두 닫았다.
pub(crate) static QUITTING: AtomicBool = AtomicBool::new(false);

struct Route {
    channel: Channel<InvokeResponseBody>,
    /// 세션 종류 — 서버가 멈췄을 때 보낼 이벤트(`local-exit`·`ssh-exit`)를 고른다.
    kind: Kind,
    /// 서버 세션 id(응답이 온 뒤) — 서버가 멈췄을 때 타일에 보낼 종료 이벤트의 열쇠.
    id: Option<u32>,
    /// 지금 받을 임대 `(sessionEpoch, leaseEpoch)` — `None` 이면 대기(아래 `floor` 보다 큰 것을 받는다).
    keys: Option<(u64, u64)>,
    floor: Option<(u64, u64)>,
}

static ROUTES: LazyLock<Mutex<HashMap<String, Route>>> = LazyLock::new(Default::default);

fn routes() -> std::sync::MutexGuard<'static, HashMap<String, Route>> {
    ROUTES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 시청자 경로 하나(R2-A) — 열쇠는 경로 번호(머리말 "시청자 경로").
struct ViewerRoute {
    stream: String,
    /// 그 시청자의 창 라벨 — 창이 사라지면 지운다.
    window: String,
    channel: Channel<InvokeResponseBody>,
    kind: Kind,
    id: Option<u32>,
    /// 응답이 온 뒤의 열쇠 `(sessionEpoch, leaseEpoch)` — 그 뒤로는 그 열쇠의 프레임만.
    keys: Option<(u64, u64)>,
}

static VIEWER_ROUTES: LazyLock<Mutex<HashMap<u64, ViewerRoute>>> = LazyLock::new(Default::default);
static NEXT_ROUTE: AtomicU64 = AtomicU64::new(1);

fn viewer_routes() -> std::sync::MutexGuard<'static, HashMap<u64, ViewerRoute>> {
    VIEWER_ROUTES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 조건에 맞는 시청자 경로를 지운다 — 지운 것.
fn drop_viewer_routes(pred: impl Fn(&ViewerRoute) -> bool) -> Vec<ViewerRoute> {
    let mut v = viewer_routes();
    let doomed: Vec<u64> = v.iter().filter(|(_, r)| pred(r)).map(|(k, _)| *k).collect();
    doomed.into_iter().filter_map(|k| v.remove(&k)).collect()
}

/// 대기로 세우기 전에 그 스트림이 쥐었던 경로 — 요청이 거절되면 [`route_abandon`] 이 되돌린다.
pub(super) struct Prev(Option<Route>);

/// 경로를 대기로 세운다 — 바닥은 그 스트림이 쥐었던 마지막 열쇠. 옛 경로를 돌려준다(거절되면 되돌린다).
pub(super) fn route_pending(stream: &str, channel: Channel<InvokeResponseBody>, id: Option<u32>, kind: Kind) -> Prev {
    let mut r = routes();
    let floor = r.get(stream).and_then(|old| old.keys.or(old.floor));
    Prev(r.insert(
        stream.to_string(),
        Route {
            channel,
            kind,
            id,
            keys: None,
            floor,
        },
    ))
}

/// 응답의 열쇠를 박는다.
pub(super) fn route_pin(keys: &Keys, id: u32) {
    if let Some(r) = routes().get_mut(&keys.stream) {
        if r.keys.is_none() {
            r.keys = Some((keys.session_epoch, keys.lease_epoch));
            r.id = Some(id);
        }
    }
}

/// 실패한 대기를 거둔다(아직 열쇠가 없을 때만) — 대기 전의 경로가 있었으면 **되돌린다**. 거절된 붙기·열기(`[session-attached]`·
/// `[session-alive]` — 다른 창·다른 페이지가 그 세션을 쥐고 있다)가 경로를 지우기만 하면 붙어 있는 타일의 출력이 갈 곳을 잃어
/// 화면이 멈춘다(실측 10-10 `scripts/dev/survival` 의 `stale-lease` 행: 거절된 둘째 attach 뒤 번호가 멎음).
pub(super) fn route_abandon(stream: &str, prev: Prev) {
    let mut r = routes();
    if r.get(stream).is_some_and(|x| x.keys.is_none()) {
        match prev.0 {
            Some(old) => {
                r.insert(stream.to_string(), old);
            }
            None => {
                r.remove(stream);
            }
        }
    }
}

/// 그 임대의 경로를 지운다(다른 임대의 경로는 그대로).
pub(super) fn route_drop(stream: &str, session_epoch: u64, lease_epoch: u64) {
    let mut r = routes();
    if r
        .get(stream)
        .is_some_and(|x| x.keys == Some((session_epoch, lease_epoch)))
    {
        r.remove(stream);
    }
}

/// 서버의 출력 프레임 → 그 스트림의 웹뷰 채널(지금 받을 임대의 것만).
pub(crate) fn on_output(h: OutputHeader, bytes: Vec<u8>) {
    let k = (h.session_epoch, h.lease_epoch);
    // 시청자의 프레임 — 경로 번호로(R2-A).
    if let Some(route) = h.route {
        let channel = {
            let v = viewer_routes();
            match v.get(&route) {
                Some(r) if r.stream == h.stream && r.keys.is_none_or(|x| x == k) => r.channel.clone(),
                _ => return,
            }
        };
        let _ = channel.send(InvokeResponseBody::Raw(bytes));
        return;
    }
    let channel = {
        let r = routes();
        let Some(route) = r.get(&h.stream) else {
            return;
        };
        let take = match route.keys {
            Some(keys) => keys == k,
            None => route.floor.is_none_or(|f| k > f),
        };
        if !take {
            return;
        }
        route.channel.clone()
    };
    let _ = channel.send(InvokeResponseBody::Raw(bytes));
}

/// 서버 이벤트 `local-exit` — 창에 그대로 방송하고(프런트가 id 로 고른다), 떨어진 채 끝났으면 경로를 지운다(MCP 거울은 서버가
/// 스스로 거둔다 — ③-3c, `server::ai::on_session_removed`).
pub(crate) fn on_local_exit(app: &tauri::AppHandle, body: &Value) {
    let _ = app.emit("local-exit", body.clone());
    if let Some(stream) = body.get("stream").and_then(Value::as_str) {
        if body.get("removed").and_then(Value::as_bool) == Some(true) {
            routes().remove(stream);
            drop_viewer_routes(|r| r.stream == stream);
        }
    }
}

/// 서버 이벤트 `ssh-exit` — 창에 그대로 방송하고, 붙은 창 없이 끝나 표에서 지웠으면(`removed`) 경로를 지운다(거울은 서버가
/// 거둔다). 그 세션 id 의 SFTP 채널 캐시도 버린다(GUI 의 터널 — 다음 요청이 없는 세션으로 실패한다).
pub(crate) fn on_ssh_exit(app: &tauri::AppHandle, body: &Value) {
    let _ = app.emit("ssh-exit", body.clone());
    if let Some(id) = body.get("id").and_then(Value::as_u64) {
        crate::sftp::stop_session_sftp(id as u32);
    }
    if let Some(stream) = body.get("stream").and_then(Value::as_str) {
        if body.get("removed").and_then(Value::as_bool) == Some(true) {
            routes().remove(stream);
            drop_viewer_routes(|r| r.stream == stream);
        }
    }
}

/// 서버 이벤트 `session-viewer-ended`(R2-A) — 그 시청자의 경로를 지우고 창에 그대로 중계한다. 프런트는 제 열쇠와 견줘 `reason` 으로
/// 가른다(`overflow` = 다시 붙어 재동기화 · `ended` = 세션이 끝났다).
pub(crate) fn on_viewer_ended(app: &tauri::AppHandle, body: &Value) {
    let _ = app.emit(super::sessions::VIEWER_ENDED_EVENT, body.clone());
    let (Some(stream), Some(se), Some(le)) = (
        body.get("stream").and_then(Value::as_str),
        body.get("sessionEpoch").and_then(Value::as_u64),
        body.get("leaseEpoch").and_then(Value::as_u64),
    ) else {
        return;
    };
    drop_viewer_routes(|r| r.stream == stream && r.keys == Some((se, le)));
}

/// **서버 연결이 끊겼다**(서버 크래시·kill·`shutdown`) — 경로를 쥔 타일마다 종료를 알린다.
pub(crate) fn on_server_lost(app: &tauri::AppHandle) {
    let lost: Vec<(String, Route)> = routes().drain().collect();
    // 시청자만 있던 스트림(이 GUI 에 주 경로가 없다)도 종료를 받아야 한다 — 이벤트는 앱 전체 방송이라 같은 id 의 타일이 모두 받는다.
    let mut lost = lost;
    let viewers: Vec<ViewerRoute> = viewer_routes().drain().map(|(_, r)| r).collect();
    for v in viewers {
        if lost.iter().any(|(s, _)| *s == v.stream) {
            continue;
        }
        lost.push((
            v.stream,
            Route {
                channel: v.channel,
                kind: v.kind,
                id: v.id,
                keys: v.keys,
                floor: None,
            },
        ));
    }
    let mut ssh = 0;
    for (stream, route) in &lost {
        let Some(id) = route.id else { continue };
        match route.kind {
            // 문구는 프런트가 만든다(`code` — `pty::LocalExit` 와 같은 모양).
            Kind::Local => {
                let _ = app.emit(
                    "local-exit",
                    json!({
                        "id": id,
                        "reason": "exit",
                        "code": "server-stopped",
                        "exitCode": null,
                        "detail": null,
                        "stream": stream,
                        "sessionEpoch": route.keys.map(|k| k.0),
                    }),
                );
            }
            // SSH 는 끊김과 같은 길 — 재접속 배너(자동 재접속이 켜져 있으면 새 서버에 새 회차를 연다).
            Kind::Ssh => {
                ssh += 1;
                crate::sftp::stop_session_sftp(id);
                let _ = app.emit(
                    "ssh-exit",
                    json!({
                        "id": id,
                        "reason": "error",
                        "message": tr!(
                            ko: "세션 서버가 멈췄습니다 — 원격 연결이 함께 끊겼습니다",
                            en: "The session server stopped — the remote connection went with it"
                        ),
                        "stream": stream,
                        "sessionEpoch": route.keys.map(|k| k.0),
                        "removed": false,
                    }),
                );
            }
        }
    }
    if !lost.is_empty() {
        eprintln!(
            "[server] 세션 서버 연결이 끊겼습니다 — 타일 {}개(SSH {ssh})를 '세션 서버가 멈췄습니다' 로 넘깁니다",
            lost.len()
        );
    }
}

/// 서버 요청 하나 — 실패는 사람 문구(세션 코어의 이유 코드 `[stale-lease]` 등은 서버가 이미 실었다).
pub(crate) async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    client::request(kind, op, body).await.map_err(|e| match e.code.as_str() {
        "not-connected" | "closed" | "io" | "timeout" => tr!(
            ko: "세션 서버에 닿지 못했습니다 ({code}: {msg})",
            en: "Could not reach the session server ({code}: {msg})",
            code = e.code,
            msg = e.message
        ),
        _ => e.message,
    })
}

/// [`call`] 의 기다리지 않는 판([`client::request_now`]) — 연결이 없으면 할 일도 없는 요청.
async fn call_now(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    client::request_now(kind, op, body)
        .await
        .map_err(|e| format!("{}: {}", e.code, e.message))
}

fn anonymous_stream() -> String {
    static ANON: AtomicU32 = AtomicU32::new(1);
    format!(
        "local-anon-{}-{}",
        std::process::id(),
        ANON.fetch_add(1, Ordering::Relaxed)
    )
}

/// [`open_local_session`] 의 반환값 — 새 세션 id · **해석된 셸 id**(헤더가 "로컬" 대신 진짜 셸 이름을 띄운다) · 세션
/// 코어의 임대 열쇠(프런트 손잡이가 이 뒤의 모든 be 호출에 동봉한다).
#[derive(serde::Serialize, serde::Deserialize)]
pub struct LocalSession {
    id: u32,
    shell: String,
    lease: Keys,
}

/// 로컬 셸 세션 하나를 연다 — 재료는 여기서(GUI) 만들고 셸은 세션 서버가 띄운다.
///
/// - 창의 generation 을 **시작할 때** 읽어 두고, 서버가 답한 뒤 다시 본다(`crate::reap::admit`) — 그 사이 창이 리로드·
///   파괴됐으면 방금 연 세션을 닫는다(R06 — 창이 사라진 열기 취소는 GUI 의 일).
/// - 신호 전용 토큰은 **모든 로컬 타일**(스트림이 있을 때 — 서버가 `open` 안에서 뽑아 채운다, ③-3a), MCP 토큰은 AI 타일
///   (`injectMcpToken`)과 감싸개가 있는 로컬 셸 타일(2026-10-26 — `crate::agent_tile`) — docs/log/2026-09-25-shell-claude-signals.md. (3차 4단계)
///   MCP 토큰도 **서버가** 타일마다 뽑는다(`open` 몸의 `mcp` — `crate::tile_token`) — GUI 는 값을 싣지 않고 서버는 로그에 남기지 않는다.
/// - 같은 스트림이 살아 있으면 서버가 `[session-alive]` 로 거절한다(프런트는 붙는다).
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약
#[tauri::command]
pub async fn open_local_session(
    webview: tauri::Webview,
    on_data: Channel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    inject_mcp_token: Option<bool>,
    cwd: Option<String>,
    stream_id: Option<String>,
    codex_tile: Option<bool>,
) -> Result<LocalSession, String> {
    let label = webview.window().label().to_string();
    let seen = crate::reap::generation(&label);
    let stream = stream_id.clone().unwrap_or_else(anonymous_stream);

    let ai = inject_mcp_token.unwrap_or(false);
    let signal = stream_id.is_some();

    let mut spec = tauri::async_runtime::spawn_blocking(move || {
        crate::pty::prepare_spawn(cols, rows, shell.as_deref(), cwd)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r)?;
    // **Codex 전용으로 여는 AI 타일**(autorun CLI = codex — 프런트가 알린다)이면 그 타일 셸 자체의 PATH 를 거른다(2026-10-15 사용자
    // 결정 2 — `codex_launch` 머리말: 스토어 pwsh 를 빼 Codex 샌드박스가 셸을 띄우게). 셸 줄로 바꾸지 않는다(그 셸 전체에 남는다).
    if codex_tile.unwrap_or(false) && !spec.shell_id.starts_with("wsl:") {
        crate::codex_launch::apply_tile_path(&mut spec.env, crate::codex_launch::codex_launch_env().as_ref());
    }
    // **감싸개가 있는 로컬 셸 타일**(2026-10-26 에이전트 활성화 — `crate::agent_tile`): 그 셸에서 친 `claude` · `codex` 가 AI 타일과 같게 — 장식 파일의
    // 경로를 셸 환경에 넣고(파일은 열기가 선 뒤에 쓴다 — 토큰이 `open` 에서 뽑힌다) 타일 MCP 토큰을 받는다.
    let decorate = stream_id
        .as_deref()
        .filter(|_| crate::agent_tile::has_wrapper(&spec.shell_id, spec.integration.is_some()))
        .and_then(|s| crate::agent_tile::path_for(s).as_deref().and_then(crate::agent_tile::env_value));
    if let Some(path) = &decorate {
        spec.env.push((crate::tile_env::TILE_AGENT_ENV.to_string(), path.clone()));
    }
    // **타일 MCP 토큰**(3차 4단계): AI 타일(`injectMcpToken`) · 감싸개가 있는 로컬 셸 타일이면 세션 서버가 `open` 에서 그 타일만의 토큰을 뽑아 셸 환경에
    // 넣는다(`mcp` — GUI 는 값을 싣지 않는다 · `(stream, sessionEpoch)` 에 묶임 · AI 타일인가는 `ai` — 셸 타일의 AI 읽기 허용은 예전 그대로). (3차 6단계)
    // 사람이 띄우는 조정자 타일(`orchestrationRunId`)은 걷었다 — 어느 AI 타일이든 `start_run` · `adopt_run` 으로 조정자가 되고, 묶음은 서버가 그 잠금
    // 안에서 세운다(GUI 는 묶지 않는다).
    let mcp = ai || decorate.is_some();
    let decorate_with = decorate.map(|_| (spec.shell_id.clone(), spec.cwd.clone()));

    let prev = route_pending(&stream, on_data, None, Kind::Local);
    let opened = call(
        Grade::Write,
        "open",
        json!({ "stream": stream, "window": label, "spec": spec, "signal": signal, "mcp": mcp, "ai": ai }),
    )
    .await
    .and_then(|v| serde_json::from_value::<LocalSession>(v).map_err(|e| e.to_string()));
    let opened = match opened {
        Ok(o) => o,
        Err(e) => {
            route_abandon(&stream, prev);
            return Err(e);
        }
    };
    route_pin(&opened.lease, opened.id);
    if crate::reap::admit(&label, seen, (), |()| {}).is_err() {
        eprintln!(
            "세션 정리: `{label}` 창이 여는 사이 다시 떴거나 닫혀 로컬 {} 을 거뒀습니다",
            opened.id
        );
        let k = &opened.lease;
        let _ = call(Grade::Write, "close", lease_body(k)).await;
        route_drop(&k.stream, k.session_epoch, k.lease_epoch);
        return Err(crate::reap::window_gone_message());
    }
    // 장식 파일 — 열기가 섰으니 그 타일의 토큰이 있다. 돌려주기 **전에** 쓴다(뒤따르는 autorun 줄이 감싸개를 지날 때 파일이 있게).
    if let Some((shell, cwd)) = decorate_with {
        crate::agent_tile::prepare(stream, shell, cwd).await;
    }
    Ok(opened)
}

// ---------------------------------------------------------------------------
// 신호 평면 (③-3a) — 서버 op 의 GUI 쪽 껍데기(상태 표 둘 — 토큰은 파이프를 타지 않는다, ③-3b2)
// ---------------------------------------------------------------------------

/// 에이전트 상태 표의 스냅숏/// 에이전트 상태 표의 스냅숏 — 창의 부팅·이관 재부착(`src/lib/app/agent-status.svelte.ts`). 표는 서버에 산다(③-3a).
/// 반환 모양은 예전 그대로 `[[stream, state], …]`.
#[tauri::command]
pub async fn agent_states_snapshot() -> Result<Value, String> {
    call(Grade::Read, "agent_states_snapshot", Value::Null).await
}

/// 대화 ↔ 스트림 장부(`crate::agent_state::convo` — 어느 대화를 어느 산 스트림이 쥐었나 · 언제 놓였나, id 뿐) — 지난 대화 목록의
/// "열림 · 밖에서 열림" 판정(`src/lib/app/agent-sessions.svelte.ts`). 서버 op 같은 이름(읽기).
#[tauri::command]
pub async fn agent_conversation_links() -> Result<Value, String> {
    call(Grade::Read, "agent_conversation_links", Value::Null).await
}

/// 같은 장부를 GUI Rust 가 읽는다 — 지난 대화 이름 바꾸기 · 지우기의 문(`agent_sessions::edit::locate_idle`). 기다리지 않는다:
/// 연결이 없거나 옛 서버(op 를 모름)면 빈 장부 = 기록 없음 → 그 문은 예전 mtime 규칙으로 물러선다.
pub(crate) async fn conversation_links_now() -> Vec<crate::agent_state::convo::ConvoLinkRow> {
    match call_now(Grade::Read, "agent_conversation_links", Value::Null).await {
        Ok(v) => serde_json::from_value(v).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 창이 본 사건(같은 타일의 새 CLI · 셸 복귀)으로 그 스트림의 재료를 버린다 — 서버 op 같은 이름. `cause` 는 그 사건
/// (`cli-start` · `replay` · `shell-return` — `crate::agent_state::ForgetCause`, 띄우며 적은 연결의 수명이 갈린다).
#[tauri::command]
pub async fn agent_state_forget(stream: String, cause: Option<String>) -> Result<(), String> {
    call(Grade::Write, "agent_state_forget", json!({ "stream": stream, "cause": cause }))
        .await
        .map(|_| ())
}

/// **대화 면 [중지]**(2026-11-02) — 창이 그 타일 TUI 에 Esc 를 보낸 뒤 부른다. 그 스트림이 실행 · 권한 대기면 서버 표가 `interrupt` 를 적고
/// `agent-signal` 로 방송한다(Claude 는 Esc 로 끊을 때 훅이 없다 — 실측). 답은 풀었나.
#[tauri::command]
pub async fn agent_state_interrupt(stream: String) -> Result<bool, String> {
    call(Grade::Write, "agent_state_interrupt", json!({ "stream": stream }))
        .await
        .map(|v| v.get("interrupted").and_then(Value::as_bool).unwrap_or(false))
}

/// **완료 확인 공유**(2026-11-04) — 이 창에서 사람이 그 타일의 턴 끝을 봤다. 서버 표는 그대로이고 낡지 않았으면 `agent-seen` 으로 방송해 다른 창의 "안 봄" 표식이 풀린다.
/// 판 25 미만 서버면 보내지 않는다(조용히 — 표시만 창마다 따로인 예전 그대로).
#[tauri::command]
pub async fn agent_state_seen(stream: String, seq: u64) -> Result<(), String> {
    if client::negotiated_protocol().is_some_and(|p| p < super::ipc::frame::AGENT_SEEN_PROTOCOL) {
        return Ok(());
    }
    call(Grade::Write, "agent_state_seen", json!({ "stream": stream, "seq": seq })).await.map(|_| ())
}

/// 창이 그 타일(스트림)에 대화를 여는 명령을 쓴다(재개 autorun — 쓰기 직전). 세션 서버 장부가 신호를
/// 기다리지 않고 그 대화를 그 스트림에 잇는다(`crate::agent_state::AgentStates::note_launch` — id 뿐). 답은 적었나(산 신호 토큰이 없는
/// 스트림이면 거짓 — 그 타일은 예전 규칙).
#[tauri::command]
pub async fn agent_conversation_launched(stream: String, agent: String, id: String) -> Result<bool, String> {
    let v = call(Grade::Write, "agent_conversation_launched", json!({ "stream": stream, "agent": agent, "id": id })).await?;
    Ok(v.get("linked").and_then(Value::as_bool).unwrap_or(false))
}

pub(super) fn lease_body(k: &Keys) -> Value {
    json!({ "stream": k.stream, "sessionEpoch": k.session_epoch, "leaseEpoch": k.lease_epoch })
}

/// 키 입력을 셸에 — 서버가 블로킹 풀에서 쓴다(파이프가 가득 차면 거기서 기다린다). `source` 는 입력 출처(`keyboard` · `paste` ·
/// `protocol` — 프런트 `$lib/term/input-source`, 없으면 서버가 키보드로 친다): 오케스트레이션 작업자 타일의 사람 개입 판정(5단계).
#[tauri::command]
pub async fn write_session(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    data: String,
    source: Option<String>,
) -> Result<(), String> {
    call(
        Grade::Write,
        "write",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch, "data": data, "source": source }),
    )
    .await
    .map(|_| ())
}

/// 터미널 크기를 셸에 알린다.
#[tauri::command]
pub async fn resize_session(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    call(
        Grade::Write,
        "resize",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch, "cols": cols, "rows": rows }),
    )
    .await
    .map(|_| ())
}

/// **크기 되찾기**(10-20 — 주인이 아닌 타일의 [이 창 크기로] · [모두 되돌리기]) — 이 임대(주 또는 시청자)를 입력 없이 크기 주인으로 삼고
/// 이 창의 크기(`cols`·`rows`)를 건다. **셸에 아무것도 쓰지 않는다** — 효과는 키 하나 친 것과 같은 크기 바꿈뿐이다. 자격 없는 폰 시청자는
/// 되찾지 못하고 `false`(서버 `Core::claim_size_owner`). 낡은 임대는 `[stale-lease]`. 바뀜은 이벤트 `session-size-owner` 로 모든 창에 간다.
#[tauri::command]
pub async fn claim_session_size(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    let v = call(
        Grade::Write,
        "claim_size",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch, "cols": cols, "rows": rows }),
    )
    .await?;
    Ok(v.get("sizeOwner").and_then(Value::as_bool).unwrap_or(false))
}

/// **명시 닫기**(타일·탭 닫기 · 끝난 세션의 정리) — 회차 둘이 같으면 붙어 있든 떨어졌든 끝났든 닫는다. 옛 임대의 닫기는
/// `[stale-lease]`. 이미 닫힌 세션은 성공(멱등).
#[tauri::command]
pub async fn close_session(stream: String, session_epoch: u64, lease_epoch: u64) -> Result<(), String> {
    let r = call(
        Grade::Write,
        "close",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch }),
    )
    .await;
    if r.is_ok() {
        route_drop(&stream, session_epoch, lease_epoch);
    }
    r.map(|_| ())
}

/// 화면에 반영한 출력 오프셋(ACK) — 서버 크레딧의 근거. 응답이 없다(단조 값이라 늦거나 겹쳐도 뜻이 같다).
#[tauri::command]
pub async fn ack_local_output(stream: String, session_epoch: u64, lease_epoch: u64, consumed: u64) {
    client::send_ack(Ack {
        stream,
        session_epoch,
        lease_epoch,
        consumed,
    })
    .await;
}

/// 이 로컬 세션의 셸이 **지금 있는 폴더** — 서버가 자식 pid 로 OS 에 묻는다(`crate::cwd`). 모르면 `Ok(None)`.
#[tauri::command]
pub async fn local_cwd(id: u32) -> Result<Option<String>, String> {
    let v = call(Grade::Read, "local_cwd", json!({ "id": id })).await?;
    Ok(v.as_str().map(str::to_string))
}

/// 떨어진 세션(로컬·SSH)에 이 창이 붙는다(`session_core::commands::attach_session`) — 서버의 답을 그대로 돌려준다. 경로의
/// 종류는 서버의 답(`kind`)으로 바로잡는다(대기 중에는 모른다 — 출력 경로표는 종류를 보지 않는다).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn attach(
    label: &str,
    stream: &str,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    take: Option<bool>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<Value, String> {
    let prev = route_pending(stream, on_data, None, Kind::Local);
    let r = call(
        Grade::Write,
        "attach",
        json!({
            "stream": stream,
            "expectedSessionEpoch": expected_session_epoch,
            "consumed": consumed,
            "take": take,
            "window": label,
            "cols": cols,
            "rows": rows,
        }),
    )
    .await;
    match r {
        Ok(v) => {
            match (
                v.get("lease").cloned().and_then(|l| serde_json::from_value::<Keys>(l).ok()),
                v.get("id").and_then(Value::as_u64),
            ) {
                (Some(keys), Some(id)) => {
                    route_pin(&keys, id as u32);
                    if v.get("kind").and_then(Value::as_str) == Some("ssh") {
                        if let Some(r) = routes().get_mut(stream) {
                            r.kind = Kind::Ssh;
                        }
                    }
                }
                _ => route_abandon(stream, prev),
            }
            Ok(v)
        }
        Err(e) => {
            route_abandon(stream, prev);
            Err(e)
        }
    }
}

/// 떨어지기(kind 무관) — 서버가 임대를 풀고 체크포인트를 맡는다. 경로는 지운다. `release` — 사람이 작업자 타일을 닫아 놓는다
/// (10-15 — 서버가 작업자 스트림만 떨어진 세션 목록에 곧바로 보이게 표시한다).
pub(crate) async fn detach(
    stream: &str,
    session_epoch: u64,
    lease_epoch: u64,
    checkpoint: Option<crate::session_core::Checkpoint>,
    release: bool,
) -> Result<(), String> {
    let r = call(
        Grade::Write,
        "detach",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch, "checkpoint": checkpoint, "release": release }),
    )
    .await;
    route_drop(stream, session_epoch, lease_epoch);
    r.map(|_| ())
}

/// **시청자로 붙는다**(R2-A — 서버 op `attach_viewer`) — 빼앗지 않는다. 경로 번호를 뽑아 시청자 경로를 먼저 세우고(재생 프레임이 응답보다
/// 먼저 온다) 몸에 실어 보낸다. 판 16 이하 서버면 보내지 않는다(`[server-outdated]` — 시청자 op 만).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn attach_viewer(
    label: &str,
    stream: &str,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
    size_owner_eligible: Option<bool>,
) -> Result<Value, String> {
    if client::negotiated_protocol().is_some_and(|p| p < super::ipc::frame::VIEWER_PROTOCOL) {
        return Err(crate::errors::with_reason(
            crate::errors::SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 같은 타일을 여러 창에서 함께 볼 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요",
                en: "The session server is an older version and cannot share a tile between windows — restart it in Settings › Session server"
            ),
        ));
    }
    let route = NEXT_ROUTE.fetch_add(1, Ordering::Relaxed);
    viewer_routes().insert(
        route,
        ViewerRoute {
            stream: stream.to_string(),
            window: label.to_string(),
            channel: on_data,
            kind: Kind::Local,
            id: None,
            keys: None,
        },
    );
    let r = call(
        Grade::Write,
        "attach_viewer",
        json!({
            "stream": stream,
            "expectedSessionEpoch": expected_session_epoch,
            "consumed": consumed,
            "window": label,
            "cols": cols,
            "rows": rows,
            "sizeOwnerEligible": size_owner_eligible,
            "route": route,
        }),
    )
    .await;
    let pinned = r.as_ref().ok().and_then(|v| {
        let keys = v.get("lease").cloned().and_then(|l| serde_json::from_value::<Keys>(l).ok())?;
        let id = v.get("id").and_then(Value::as_u64)? as u32;
        let kind = if v.get("kind").and_then(Value::as_str) == Some("ssh") { Kind::Ssh } else { Kind::Local };
        Some((keys, id, kind))
    });
    match pinned {
        Some((keys, id, kind)) => {
            if let Some(vr) = viewer_routes().get_mut(&route) {
                vr.keys = Some((keys.session_epoch, keys.lease_epoch));
                vr.id = Some(id);
                vr.kind = kind;
            }
        }
        None => {
            viewer_routes().remove(&route);
        }
    }
    r
}

/// **시청자가 제 시청을 끝낸다**(서버 op `detach_viewer`) — 세션은 그대로. 경로는 지운다. 이미 떨어졌으면 `false`(멱등).
pub(crate) async fn detach_viewer(stream: &str, session_epoch: u64, lease_epoch: u64) -> Result<bool, String> {
    if client::negotiated_protocol().is_some_and(|p| p < super::ipc::frame::VIEWER_PROTOCOL) {
        // 그런 서버에는 시청자가 생길 수 없다.
        return Ok(false);
    }
    let r = call(
        Grade::Write,
        "detach_viewer",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "leaseEpoch": lease_epoch }),
    )
    .await;
    drop_viewer_routes(|v| v.stream == stream && v.keys == Some((session_epoch, lease_epoch)));
    r.map(|v| v.as_bool().unwrap_or(false))
}

/// 이관 재부착 — 서버가 임대를 빼앗아 이 창에 주고 짐의 `consumed` 뒤 꼬리를 새 채널로 먼저 흘린다(로컬·SSH 같은 op).
pub(crate) async fn adopt(
    label: &str,
    kind: Kind,
    id: u32,
    on_data: Channel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
    consumed: Option<u64>,
) -> Result<Value, String> {
    // 이 세션의 스트림 — 보낸 창의 경로가 안다(한 GUI 프로세스 = 한 경로표).
    let stream = routes()
        .iter()
        .find(|(_, r)| r.id == Some(id) && r.kind == kind)
        .map(|(s, _)| s.clone());
    let prev = stream.as_ref().map(|s| route_pending(s, on_data.clone(), Some(id), kind));
    let r = call(
        Grade::Write,
        "adopt",
        json!({ "kind": kind.as_str(), "id": id, "window": label, "consumed": consumed, "cols": cols, "rows": rows }),
    )
    .await;
    match r {
        Ok(v) => {
            if let Some(keys) = v
                .get("lease")
                .cloned()
                .and_then(|l| serde_json::from_value::<Keys>(l).ok())
            {
                if stream.is_none() {
                    // 경로를 몰랐다(일어나면 안 되는 길) — 재생은 놓치지만 실시간은 받는다.
                    let _ = route_pending(&keys.stream, on_data, Some(id), kind);
                }
                route_pin(&keys, id);
            }
            Ok(v)
        }
        Err(e) => {
            if let (Some(s), Some(prev)) = (&stream, prev) {
                route_abandon(s, prev);
            }
            Err(e)
        }
    }
}

/// 서버가 이 스트림을 아는가는 서버만 안다 — 살피기(로컬·SSH). 서버에 닿지 못하면 `None`(= 없음으로 친다).
pub(crate) async fn probe(stream: &str) -> Option<Value> {
    call(Grade::Read, "probe", json!({ "stream": stream })).await.ok()
}

/// 페이지 리로드 — 이 창의 임대(로컬·SSH)를 푼다(세션은 산다) · 쿼리 타일의 DB 연결은 떼어 둔다(TTL — `db::table`). `skip` =
/// 이관 중인 것. 붙어 있지 않으면 할 일이 없다(연결이 끊길 때 서버가 이 GUI 의 임대를 모두 풀었다) — 기다리지 않는다(부팅 첫
/// 줄이 서버를 기다리지 않게).
pub(crate) async fn detach_window(label: &str, skip: crate::reap::Held) {
    // 그 창의 시청자 경로 — 서버도 같은 op 에서 그 창의 시청자를 뗀다(R2-A).
    drop_viewer_routes(|r| r.window == label);
    // 그 창의 프로듀서 채팅 통로 — 지금 쥔 세대만 서버에서 뗀다(새 페이지가 이 뒤에 건 구독은 남는다 · `producer_proxy::take_window`).
    let producer_subs = super::producer_proxy::take_window(label);
    match call_now(Grade::Write, "detach_window", detach_body(label, skip, &producer_subs)).await {
        Ok(v) => {
            let streams: Vec<String> = serde_json::from_value(v).unwrap_or_default();
            if !streams.is_empty() {
                // 경로는 지운다 — 새 페이지의 타일이 붙을 때 다시 선다(그 사이 프레임은 오지 않는다 — 서버가 싱크를 뺐다).
                let mut r = routes();
                for s in &streams {
                    r.remove(s);
                }
                eprintln!("세션 서버: `{label}` 창이 다시 떠 {streams:?} 을 닫지 않고 떼어 두었습니다");
            }
        }
        Err(e) if e.starts_with("not-connected") => {}
        Err(e) => eprintln!("[server] detach_window `{label}` 실패: {e}"),
    }
}

/// 리로드의 떨어뜨리기 몸(op `detach_window` — `skip` = 이관 중인 것). **순수** — 시험이 GUI 가 실제로 보내는 몸을 그대로 쓴다.
pub(crate) fn detach_body(label: &str, skip: crate::reap::Held, producer_subs: &[u64]) -> Value {
    let skip_local: Vec<u32> = skip.local.into_iter().collect();
    let skip_ssh: Vec<u32> = skip.ssh.into_iter().collect();
    let skip_db: Vec<String> = skip.db_streams.into_iter().collect();
    json!({ "window": label, "ids": skip_local, "sshIds": skip_ssh, "dbStreams": skip_db, "producerSubs": producer_subs })
}

/// 앱 전체 종료 중의 창 파괴 몸(op `detach_window` 의 `dbOnly` — 그 창의 DB 연결을 떨어진 세션으로 남긴다 · TTL 없음). **순수**.
pub(crate) fn keep_body(label: &str, held_db: &[String], producer_subs: &[u64]) -> Value {
    json!({ "window": label, "dbStreams": held_db, "dbOnly": true, "producerSubs": producer_subs })
}

/// 창 파괴의 닫기 몸(op `close_window` — `held_*` = 이관 중인 것). **순수**.
pub(crate) fn close_body(label: &str, held_local: &[u32], held_ssh: &[u32], held_db: &[String], producer_subs: &[u64]) -> Value {
    json!({ "window": label, "ids": held_local, "sshIds": held_ssh, "dbStreams": held_db, "producerSubs": producer_subs })
}

async fn send_keep(label: &str, held_db: &[String], producer_subs: &[u64]) {
    if let Err(e) = call_now(Grade::Write, "detach_window", keep_body(label, held_db, producer_subs)).await {
        if !e.starts_with("not-connected") {
            eprintln!("[server] 종료 중 `{label}` 창의 DB 연결 남기기 실패: {e}");
        }
    }
}

/// **앱 전체 종료 · 트레이로 가는 중의 창 파괴**(`reap::Event::Leaving` — 리로드와 같은 떨어뜨리기 [`detach_window`] **뒤에**) — 그 창의
/// 쿼리 타일 DB 연결을 떨어진 세션으로 남긴다(`dbOnly` — 앞의 떨어뜨리기가 리로드(TTL 10분)로 떼어 둔 것을 남김(TTL 없음)으로 올린다 ·
/// `held_db` = 이관 중인 stream). 2026-11-09 실기: 이것이 없어 트레이로 간 창의 DB 타일이 10분 뒤 닫혔다.
pub(crate) async fn keep_window_dbs(label: &str, held_db: Vec<String>) {
    // 프로듀서 통로는 앞의 떨어뜨리기가 이미 걷었다 — 다시 걷지 않는다(같은 라벨의 새 창이 건 구독을 건드리지 않게).
    send_keep(label, &held_db, &[]).await;
}

/// 창 파괴 — 이 창이 책임지는 세션(로컬·SSH)과 쿼리 타일의 DB 연결을 닫는다(이관 중인 것 `held_*` 는 빼고). 닫은 `(로컬, SSH)` id.
///
/// 앱 전체 종료 중(`QUITTING` — 마지막 창 X · 트레이로 · GUI 끝내기)이면 닫지 않는다. 세션은 quitAll 이 이미 떼어 뒀고, DB 연결은
/// 여기서 **떨어진 세션으로 남긴다**(`detach_window` 의 `dbOnly` — TTL 없음 · 2026-11-09 ②). 트레이에 남으면 GUI 연결이 살아 있어
/// `conn_gone` 이 오지 않으므로, 이것이 없으면 그 DB 연결은 아무도 보지 않는 채 붙은 것으로 남는다(떨어진 세션 목록에도 없다).
pub(crate) async fn close_window(
    label: &str,
    held_local: Vec<u32>,
    held_ssh: Vec<u32>,
    held_db: Vec<String>,
) -> (Vec<u32>, Vec<u32>) {
    // 그 창이 **시청하던** 경로 — 서버도 같은 op 에서 그 창의 시청자를 뗀다(세션은 닫지 않는다 — R2-A). 원격 창의 ws 가 닫혀 숨은
    // 창이 부서질 때도 이 길이다.
    drop_viewer_routes(|r| r.window == label);
    // 그 창의 프로듀서 채팅 통로 — 지금 쥔 세대만 서버에서 뗀다(`producer_proxy::take_window` — 같은 라벨의 다음 창이 건 구독은 남는다).
    let producer_subs = super::producer_proxy::take_window(label);
    // 그 창의 사이드 채팅 통로(창이 부서졌다 — 서버도 같은 op 에서 그 창을 보는 창에서 뗀다).
    super::side_chat_proxy::forget_window(label);
    // 그 창의 타일 권한 카드 통로.
    super::tile_permission_proxy::forget_window(label);
    if QUITTING.load(Ordering::SeqCst) {
        send_keep(label, &held_db, &producer_subs).await;
        return (Vec::new(), Vec::new());
    }
    match call(Grade::Write, "close_window", close_body(label, &held_local, &held_ssh, &held_db, &producer_subs)).await {
        Ok(v) => {
            let ids = |k: &str| -> Vec<u32> {
                v.get(k)
                    .cloned()
                    .and_then(|x| serde_json::from_value(x).ok())
                    .unwrap_or_default()
            };
            (ids("local"), ids("ssh"))
        }
        Err(e) => {
            eprintln!("[server] close_window `{label}` 실패: {e}");
            (Vec::new(), Vec::new())
        }
    }
}

/// **보일 떨어진 세션**(③-4) — 서버의 떨어진 세션 중 아무 창도 데려가지 않은 것: 책임 창이 복원을 마치며 데려가지
/// 않았거나(`unclaimed`) 책임 창이 지금 없다. 곧 다시 붙을 것(리로드 중인 창 · 복원 중인 창의 세션)은 뺀다. **순수**.
/// 줄마다 `homeOpen` 을 덧붙인다(프런트는 참고만 — 창 목록을 몰라도 된다).
pub(crate) fn visible_detached(rows: Vec<crate::server::sessions::DetachedSession>, open: &[String]) -> Vec<Value> {
    rows.into_iter()
        .filter_map(|r| {
            let home_open = open.contains(&r.home);
            if !(r.unclaimed || !home_open) {
                return None;
            }
            let mut v = serde_json::to_value(&r).ok()?;
            if let Some(o) = v.as_object_mut() {
                o.insert("homeOpen".into(), Value::Bool(home_open));
            }
            Some(v)
        })
        .collect()
}

/// [`visible_detached`] 의 입출력 — 서버 op `sessions_detached` 를 읽어 지금 열린 창 목록으로 거른다. 닿지 못하면 빈 목록.
pub(crate) async fn detached_visible(app: &tauri::AppHandle) -> Vec<Value> {
    use tauri::Manager;
    let rows: Vec<crate::server::sessions::DetachedSession> = match call(Grade::Read, "sessions_detached", json!({})).await {
        Ok(v) => serde_json::from_value(v).unwrap_or_default(),
        Err(_) => return Vec::new(),
    };
    // 원격 창(`remote-*`)도 넣는다 — 원격 창이 연 세션의 책임 창은 그 원격 창이다(창을 세는 곳 중 일부러 빼지 않는 하나 · `remote::windows`).
    let open: Vec<String> = app.webview_windows().into_keys().collect();
    visible_detached(rows, &open)
}

/// 이 창이 책임지는 살아 있는 스트림(로컬·SSH — 리로드가 거울을 남겨 둘 목록).
pub(crate) async fn live_streams(label: &str) -> Vec<String> {
    call_now(Grade::Read, "live_streams", json!({ "window": label }))
        .await
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(out: std::sync::mpsc::Sender<Vec<u8>>) -> Channel<InvokeResponseBody> {
        Channel::new(move |body| {
            if let InvokeResponseBody::Raw(b) = body {
                let _ = out.send(b);
            }
            Ok(())
        })
    }

    /// R2-A — 시청자 경로는 경로 번호로 간다(주 경로와 따로 · 응답 전 재생도 받고 박은 뒤에는 그 열쇠만). 창이 사라지거나 서버가
    /// 시청자를 떼면(이벤트) 그 경로만 지운다.
    #[test]
    fn viewer_routes_are_keyed_by_route_number() {
        let s = "route-viewer-stream";
        let (tx_p, rx_p) = std::sync::mpsc::channel();
        let _ = route_pending(s, probe(tx_p), None, Kind::Local);
        route_pin(&Keys { stream: s.into(), session_epoch: 1, lease_epoch: 1 }, 4);
        let (tx_a, rx_a) = std::sync::mpsc::channel();
        let (tx_b, rx_b) = std::sync::mpsc::channel();
        for (route, window, ch) in [(9001u64, "remote-a-1", probe(tx_a)), (9002, "main", probe(tx_b))] {
            viewer_routes().insert(
                route,
                ViewerRoute { stream: s.into(), window: window.into(), channel: ch, kind: Kind::Local, id: None, keys: None },
            );
        }
        let vh = |le: u64, route: u64| OutputHeader { route: Some(route), ..hdr(s, 1, le) };
        on_output(vh(2, 9001), b"replay-a".to_vec()); // 응답 전 — 번호로 받는다
        viewer_routes().get_mut(&9001).unwrap().keys = Some((1, 2));
        on_output(vh(2, 9001), b"live-a".to_vec());
        on_output(vh(9, 9001), b"wrong-key".to_vec());
        on_output(vh(3, 9002), b"b".to_vec());
        on_output(hdr(s, 1, 1), b"primary".to_vec());
        on_output(OutputHeader { route: Some(9001), ..hdr("other", 1, 2) }, b"other".to_vec());
        assert_eq!(rx_a.try_iter().collect::<Vec<_>>(), vec![b"replay-a".to_vec(), b"live-a".to_vec()]);
        assert_eq!(rx_b.try_iter().collect::<Vec<_>>(), vec![b"b".to_vec()]);
        assert_eq!(rx_p.try_iter().collect::<Vec<_>>(), vec![b"primary".to_vec()], "주 경로는 주의 프레임만");
        // 창 하나가 사라지면 그 창의 시청자 경로만.
        assert_eq!(drop_viewer_routes(|r| r.window == "remote-a-1").len(), 1);
        on_output(vh(2, 9001), b"gone".to_vec());
        assert!(rx_a.try_iter().next().is_none());
        assert!(viewer_routes().contains_key(&9002));
        assert!(routes().contains_key(s), "주 경로는 그대로");
        drop_viewer_routes(|r| r.stream == s);
        route_drop(s, 1, 1);
    }

    fn hdr(stream: &str, se: u64, le: u64) -> OutputHeader {
        OutputHeader {
            stream: stream.into(),
            session_epoch: se,
            lease_epoch: le,
            offset: 0,
            route: None,
        }
    }

    fn row(stream: &str, home: &str, unclaimed: bool) -> crate::server::sessions::DetachedSession {
        crate::server::sessions::DetachedSession {
            stream: stream.into(),
            kind: "local".into(),
            home: home.into(),
            opened_at: 1,
            detached_at: Some(2),
            last_output_at: None,
            shell: Some("pwsh".into()),
            alias: None,
            tmux: None,
            ai_read: false,
            unclaimed,
            conn: None,
            writable: None,
            in_tx: None,
        }
    }

    /// 떨어진 세션 목록(③-4)은 "아무 창도 데려가지 않은 것" 만 — 복원이 데려가지 않았거나(unclaimed) 책임 창이 없다. 리로드·복원
    /// 중인 창(열려 있고 표시 전)의 세션은 곧 다시 붙으니 빠진다. 창이 하나도 없으면(트레이) 떨어진 것이 전부 보인다.
    #[test]
    fn detached_list_shows_only_sessions_no_window_will_take() {
        let rows = vec![
            row("reloading", "main", false),
            row("left-by-restore", "main", true),
            row("lost-tear", "tear-3", false),
        ];
        let open = vec!["main".to_string()];
        let v = visible_detached(rows.clone(), &open);
        let streams: Vec<&str> = v.iter().map(|r| r["stream"].as_str().unwrap()).collect();
        assert_eq!(streams, vec!["left-by-restore", "lost-tear"]);
        assert_eq!(v[0]["homeOpen"], json!(true));
        assert_eq!(v[1]["homeOpen"], json!(false));
        assert_eq!(v[0]["unclaimed"], json!(true));
        assert_eq!(v[0]["lastOutputAt"], Value::Null);
        // 트레이(창 0개) — 전부 떨어진 세션이다.
        assert_eq!(visible_detached(rows, &[]).len(), 3);
    }

    /// 경로표 — 대기 중에는 옛 열쇠보다 큰 임대만, 박은 뒤에는 그 임대만. 이관(같은 스트림 새 창)이 옛 창 몫을 받지 않는다.
    #[test]
    fn routes_follow_the_current_lease_only() {
        let s = "route-test-stream";
        let (tx_a, rx_a) = std::sync::mpsc::channel();
        route_pending(s, probe(tx_a), None, Kind::Local);
        on_output(hdr(s, 1, 1), b"early".to_vec()); // 응답 전 프레임도 받는다
        route_pin(
            &Keys {
                stream: s.into(),
                session_epoch: 1,
                lease_epoch: 1,
            },
            7,
        );
        on_output(hdr(s, 1, 1), b"live".to_vec());
        assert_eq!(rx_a.try_iter().collect::<Vec<_>>(), vec![b"early".to_vec(), b"live".to_vec()]);

        // 이관 — 창 B 가 대기로 선다. 옛 임대(1,1)의 늦은 프레임은 B 로 가지 않는다.
        let (tx_b, rx_b) = std::sync::mpsc::channel();
        route_pending(s, probe(tx_b), Some(7), Kind::Local);
        on_output(hdr(s, 1, 1), b"stale".to_vec());
        on_output(hdr(s, 1, 2), b"replay".to_vec());
        route_pin(
            &Keys {
                stream: s.into(),
                session_epoch: 1,
                lease_epoch: 2,
            },
            7,
        );
        on_output(hdr(s, 1, 2), b"live-b".to_vec());
        assert_eq!(rx_b.try_iter().collect::<Vec<_>>(), vec![b"replay".to_vec(), b"live-b".to_vec()]);
        assert!(rx_a.try_iter().next().is_none());

        // 옛 열쇠의 닫기는 새 경로를 지우지 않는다.
        route_drop(s, 1, 1);
        assert!(routes().contains_key(s));
        route_drop(s, 1, 2);
        assert!(!routes().contains_key(s));
    }

    /// **거절된 붙기·열기는 붙어 있는 타일의 경로를 되돌린다** — 둘째 attach(`[session-attached]`)가 경로를 지우기만 하면 붙어 있는
    /// 타일의 출력이 갈 곳을 잃는다(실측 10-10 survival `stale-lease`). 대기 전 경로가 없었으면 지운다(예전 그대로).
    #[test]
    fn refused_attach_restores_the_live_route() {
        let s = "route-refused-stream";
        let (tx_a, rx_a) = std::sync::mpsc::channel();
        let _ = route_pending(s, probe(tx_a), None, Kind::Local);
        route_pin(
            &Keys {
                stream: s.into(),
                session_epoch: 1,
                lease_epoch: 1,
            },
            9,
        );
        // 둘째 창(또는 늦은 페이지)의 붙기 — 서버가 거절했다.
        let (tx_b, rx_b) = std::sync::mpsc::channel();
        let prev = route_pending(s, probe(tx_b), None, Kind::Local);
        route_abandon(s, prev);
        on_output(hdr(s, 1, 1), b"still-a".to_vec());
        assert_eq!(rx_a.try_iter().collect::<Vec<_>>(), vec![b"still-a".to_vec()]);
        assert!(rx_b.try_iter().next().is_none());
        assert_eq!(routes().get(s).and_then(|r| r.id), Some(9));
        route_drop(s, 1, 1);

        // 경로가 없던 스트림의 거절은 대기를 지운다.
        let (tx_c, _rx_c) = std::sync::mpsc::channel();
        let prev = route_pending("route-refused-new", probe(tx_c), None, Kind::Local);
        route_abandon("route-refused-new", prev);
        assert!(!routes().contains_key("route-refused-new"));
    }
}
