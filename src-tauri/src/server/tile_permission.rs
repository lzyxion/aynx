//! 타일 권한 카드 — 세션 서버 쪽(순수 몸통과 불변식은 `crate::tile_permission` 머리말).
//!
//! - `/agent-permission` 문지기: 경로 → 출처 → POST → 권한 결정 토큰(그 스트림 · 지금 산 회차만 — 신호 · MCP 토큰은 401) → 본문 상한(413) 순.
//! - 결정 op 는 쓰기 등급이다 — 승인 등급이 아니다(작업안 승인 `ops_approve` 와 다른 길). 결정은 처음 하나만 먹는다.
//! - 사건은 GUI 가 방송하지 않는다(몸의 `windows` 가 건 통로에만). 로그에는 고정 글자 · 수만 — 본문 · 토큰 · 사유 글은 남기지 않는다.
//! - 면 규칙(Codex 만 — Claude 는 훅이 도는 동안에도 TUI 가 함께 떠 있어 늘 카드): 카드를 세우고 · 붙들고 · 시계가 보는 "보는 창" 은 그 타일을
//!   대화 면으로 보는 사람 창이다 — 없으면 카드 없이 TUI 가 묻는다. 결정 · 스냅숏의 문(`not-viewing`)은 그 세션을 보는 모든 창이다.
//! - 메신저 다리가 돌보는 스트림이면 "보는 창" 에 표지 [`BRIDGE_WINDOW`] 가 덧붙는다 — 표지는 사건 몸의 `windows` 에 싣지 않고, 창의 op 는 그 이름을
//!   받지 않으며, 다리의 결정은 [`resolve_from_bridge`] 하나(Allow · Deny 만)다.
//! - 잠금 순서: 카드 표 잠금 안에서 다리를 부르지 않는다. 다리 잠금은 세션 코어 · 카드 표와 겹쳐 쥐지 않는다.

use std::sync::{Condvar, LazyLock, Mutex, MutexGuard, Once};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::hub;
use super::ipc::WireError;
use crate::loopback_http::{bearer, header_value, read_body_capped, respond};
use crate::tile_permission::{
    face_rule_applies, parse_envelope, Asked, Decision, Ev, Outcome, Phase, Table, EVENT, HOLD_MS, MAX_BODY_BYTES,
};

pub(crate) const TILE_PERMISSION: &str = "tile-permission";

struct State {
    table: Mutex<Table>,
    cv: Condvar,
}

static STATE: LazyLock<State> = LazyLock::new(|| State { table: Mutex::new(Table::default()), cv: Condvar::new() });

fn table() -> MutexGuard<'static, Table> {
    STATE.table.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    crate::agent_signal::now_ms()
}

/// 질문의 일반 `PreToolUse` 가 늦어도 대기 · 알림을 지우지 않게 — 판정 · 상태 갱신 · 방송은 카드 표의 같은 잠금 안
pub(crate) fn forward_signal(sig: &crate::agent_signal::AgentSignal, at: u64, emit: &super::signal_http::Emit) {
    let t = table();
    if sig.cli == Some("codex") && sig.event == crate::agent_signal::SignalEvent::Tool && t.codex_question_waiting(&sig.stream) {
        return;
    }
    let step = crate::agent_state::record(sig, at);
    let mut payload = sig.payload(at as i64);
    crate::agent_state::attach(&mut payload, &step);
    emit(payload);
    // 메신저 다리는 카드 표 잠금 밖에서 부른다(잠금 순서)
    drop(t);
    super::messenger_bridge::on_signal(sig, &step);
}

/// 신호 방송은 재진입 없는 채널 쓰기뿐 — 카드 표 잠금 안에서 순서를 지킨다(`hub::emit`)
fn emit_signal(payload: Value) {
    hub::emit(crate::agent_signal::EVENT, payload);
}

/// 빈칸 · `#` 이 있어 Tauri 창 라벨이 될 수 없어야 한다 — 이 라벨로 결정하는 길은 [`resolve_from_bridge`] 하나다.
pub(crate) const BRIDGE_WINDOW: &str = "#messenger bridge";

/// 다리 표지 없음.
fn real_watchers(stream: &str) -> Option<Vec<String>> {
    crate::session_core::core().watchers(stream)
}

/// 세션 코어 잠금을 놓은 뒤 다리 잠금을 잡는다(겹쳐 쥐지 않는다).
fn with_bridge(stream: &str, w: Option<Vec<String>>) -> Option<Vec<String>> {
    let mut w = w?;
    if super::messenger_bridge::tends(stream) {
        w.push(BRIDGE_WINDOW.to_string());
    }
    Some(w)
}

fn watchers(stream: &str) -> Option<Vec<String>> {
    with_bridge(stream, real_watchers(stream))
}

/// 스트림 → (창 → 대화 면인가). 알리지 않은 창은 터미널 면으로 친다.
static FACES: LazyLock<Mutex<std::collections::HashMap<String, std::collections::HashMap<String, bool>>>> = LazyLock::new(Default::default);

fn faces() -> MutexGuard<'static, std::collections::HashMap<String, std::collections::HashMap<String, bool>>> {
    FACES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 다리는 대화 면처럼 카드로 답하므로 돌보는 스트림이면 표지도 넣는다.
fn convo_watchers(stream: &str) -> Option<Vec<String>> {
    let w = real_watchers(stream)?;
    let people: Vec<String> = {
        let f = faces();
        let on = f.get(stream);
        w.into_iter().filter(|win| on.and_then(|m| m.get(win)).copied().unwrap_or(false)).collect()
    };
    with_bridge(stream, Some(people))
}

/// 표 잠금 밖에서 부른다(세션 코어를 읽는다). 몸의 `windows` 는 사람 창뿐 — 다리 표지는 GUI 로 새지 않는다.
fn emit(evs: Vec<Ev>) {
    if evs.is_empty() {
        return;
    }
    for ev in &evs {
        let windows: Vec<String> = real_watchers(&ev.stream).unwrap_or_default().into_iter().filter(|w| w != BRIDGE_WINDOW).collect();
        hub::emit(EVENT, json!({ "windows": windows, "stream": ev.stream, "sessionEpoch": ev.session_epoch, "ev": ev.body }));
    }
    super::messenger_bridge::on_card_events(&evs);
}

/// 질문 카드는 뺀다. 세션 코어 · 카드 표 잠금을 차례로 잡는다(겹쳐 쥐지 않는다).
pub(crate) fn standing_cards(stream: &str) -> Vec<Value> {
    let Some(epoch) = crate::session_core::core().live_epoch(stream) else { return Vec::new() };
    let cards = table().snapshot(stream, epoch);
    cards.into_iter().filter(|c| c.get("kind").and_then(Value::as_str) != Some("question")).collect()
}

/// 메신저 다리의 결정 — `Allow | Deny` 둘뿐(세션 허용 · 풀기 · 답 · 사유 없음)이고 훅 응답으로만 간다(PTY 에 쓰지 않는다).
/// 다리가 그 스트림을 돌보지 않으면 `Err("not-viewing")`. 다리 잠금을 쥐지 않은 채 불러야 한다.
pub(crate) fn resolve_from_bridge(stream: &str, epoch: u64, request_id: &str, allow: bool) -> Result<bool, &'static str> {
    let w = watchers(stream).unwrap_or_default();
    let decision = if allow { Decision::Allow } else { Decision::Deny };
    let mut t = table();
    let question = t.codex_question(stream, epoch, request_id);
    let (applied, evs) = t.decide(stream, epoch, request_id, BRIDGE_WINDOW, decision, None, &w)?;
    if applied && question && !t.codex_question_waiting(stream) {
        emit_signal(crate::agent_state::question_signal(stream, false));
    }
    drop(t);
    if applied {
        STATE.cv.notify_all();
    }
    emit(evs);
    Ok(applied)
}

/// 자기 토큰만 거둔다.
pub(crate) fn revoke(stream: &str, owner: u64) -> bool {
    if !crate::tile_permission::revoke(stream, owner) {
        return false;
    }
    let evs = table().forget_stream(stream);
    faces().remove(stream);
    STATE.cv.notify_all();
    emit(evs);
    true
}

static SWEEPER: Once = Once::new();

fn start_sweeper() {
    SWEEPER.call_once(|| {
        let _ = std::thread::Builder::new().name("aynx-perm-sweep".into()).spawn(|| loop {
            std::thread::sleep(Duration::from_millis(500));
            sweep_once();
        });
    });
}

/// 보는 창은 표 잠금 밖에서 먼저 읽는다 — 세션 코어와 표를 겹쳐 쥐지 않는다.
fn sweep_once() {
    let streams: Vec<(String, bool)> = {
        let t = table();
        if !t.has_pending() {
            return;
        }
        t.pending_streams().into_iter().map(|s| { let codex = t.stream_cli(&s).is_some_and(face_rule_applies); (s, codex) }).collect()
    };
    let seen: std::collections::HashMap<String, Option<Vec<String>>> = streams
        .into_iter()
        .map(|(s, codex)| { let w = if codex { convo_watchers(&s) } else { watchers(&s) }; (s, w) })
        .collect();
    let evs = table().sweep(now_ms(), |s| seen.get(s).cloned().unwrap_or(None));
    if !evs.is_empty() {
        STATE.cv.notify_all();
    }
    emit(evs);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/// 퍼센트 해독 없이 모양만 본다(스트림 · id 는 그 글자들만 받는다).
fn query(url: &str) -> Option<(String, Phase, Option<String>)> {
    let q = url.split_once('?')?.1;
    let (mut stream, mut phase, mut id) = (None, None, None);
    for kv in q.split('&') {
        match kv.split_once('=') {
            Some(("stream", v)) if crate::tile_env::stream_ok(v) => stream = Some(v.to_string()),
            Some(("phase", v)) => phase = Phase::parse(v),
            Some(("id", v)) if v.len() == 32 && v.bytes().all(|b| b.is_ascii_hexdigit()) => id = Some(v.to_string()),
            _ => {}
        }
    }
    Some((stream?, phase?, id))
}

fn respond_json(request: tiny_http::Request, body: &Value) -> bool {
    let response = tiny_http::Response::from_string(body.to_string()).with_status_code(200);
    let response = match tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        Ok(h) => response.with_header(h),
        Err(_) => response,
    };
    request.respond(response).is_ok()
}

fn outcome_body(o: &Outcome) -> Value {
    match o {
        Outcome::Decided(v) => json!({ "state": "decided", "output": v }),
        Outcome::Release => json!({ "state": "release" }),
    }
}

/// 메신저 다리의 문지기 — 서 있으면 넣지 않는다.
pub(crate) fn asking(stream: &str) -> bool {
    table().asking(stream)
}

pub(crate) fn interrupted(stream: &str) {
    let evs = table().drop_questions(stream);
    if !evs.is_empty() {
        STATE.cv.notify_all();
    }
    emit(evs);
}

pub(crate) fn handle_http(mut request: tiny_http::Request) {
    let url = request.url().to_string();
    if url.split('?').next() != Some(crate::tile_permission::PATH) {
        respond(request, 404, "{\"error\":\"not found\"}");
        return;
    }
    if !super::signal_http::signal_origin_ok(header_value(&request, "Host"), header_value(&request, "Origin")) {
        respond(request, 403, "{\"error\":\"forbidden\"}");
        return;
    }
    if *request.method() != tiny_http::Method::Post {
        respond(request, 405, "{\"error\":\"method not allowed\"}");
        return;
    }
    let auth = header_value(&request, "Authorization").map(str::to_owned);
    let Some((stream, phase, id)) = query(&url) else {
        respond(request, 401, "{\"error\":\"unauthorized\"}");
        return;
    };
    let Some(epoch) = bearer(auth.as_deref()).and_then(|t| crate::tile_permission::authenticate(&stream, t)) else {
        respond(request, 401, "{\"error\":\"unauthorized\"}");
        return;
    };
    let body = match read_body_capped(&mut request, MAX_BODY_BYTES) {
        Ok(b) => b,
        Err(true) => {
            respond(request, 413, "{\"error\":\"body too large\"}");
            return;
        }
        Err(false) => {
            respond(request, 400, "{\"error\":\"bad body\"}");
            return;
        }
    };
    match phase {
        Phase::Wait => match id {
            Some(id) => hold(request, &stream, &id),
            None => respond(request, 400, "{\"error\":\"bad id\"}"),
        },
        Phase::Pre | Phase::Post | Phase::Ask => {
            let env = match parse_envelope(&body) {
                Ok(e) => e,
                Err(why) => {
                    respond(request, 400, &json!({ "error": why }).to_string());
                    return;
                }
            };
            match phase {
                Phase::Pre => {
                    let evs = {
                        let mut t = table();
                        let question = t.codex_question_waiting(&stream);
                        t.pre(&stream, &env, now_ms());
                        // 새 도구 — 지난 TUI 물음은 끝났다
                        let evs = t.clear_tui(&stream, epoch).into_iter().collect::<Vec<_>>();
                        if question && !t.codex_question_waiting(&stream) {
                            emit_signal(crate::agent_state::question_signal(&stream, false));
                        }
                        evs
                    };
                    respond(request, 204, "");
                    emit(evs);
                }
                Phase::Post => {
                    let evs = {
                        let mut t = table();
                        let question = t.codex_question_waiting(&stream);
                        let mut evs = t.post(&stream, &env);
                        evs.extend(t.clear_tui(&stream, epoch));
                        if question && !t.codex_question_waiting(&stream) {
                            emit_signal(crate::agent_state::question_signal(&stream, false));
                        }
                        evs
                    };
                    respond(request, 204, "");
                    emit(evs);
                }
                _ => {
                    start_sweeper();
                    let w = if face_rule_applies(env.cli) { convo_watchers(&stream) } else { watchers(&stream) }.unwrap_or_default();
                    let question = env.cli == crate::tile_permission::Cli::Codex && env.tool == "request_user_input";
                    let (asked, evs) = {
                        let mut t = table();
                        let (asked, evs) = t.ask(&stream, epoch, env, now_ms(), &w);
                        if question {
                            emit_signal(crate::agent_state::question_signal(&stream, true));
                        }
                        (asked, evs)
                    };
                    emit(evs);
                    match asked {
                        Asked::Now(o) => {
                            respond_json(request, &outcome_body(&o));
                        }
                        Asked::Pending(id) => hold(request, &stream, &id),
                    }
                }
            }
        }
    }
}

/// 응답 쓰기가 실패하면 훅이 죽은 것이라 그 카드를 치운다.
fn hold(request: tiny_http::Request, stream: &str, id: &str) {
    let mut t = table();
    if let Some(o) = t.begin_poll(stream, id) {
        drop(t);
        respond_json(request, &outcome_body(&o));
        return;
    }
    let until = Instant::now() + Duration::from_millis(HOLD_MS);
    loop {
        if let Some(o) = t.take(id) {
            drop(t);
            respond_json(request, &outcome_body(&o));
            return;
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            t.end_poll(id, now_ms());
            drop(t);
            if !respond_json(request, &json!({ "state": "pending", "id": id })) {
                let evs = table().hook_lost(id);
                emit(evs);
            }
            return;
        }
        t = STATE.cv.wait_timeout(t, left).map(|(g, _)| g).unwrap_or_else(|e| e.into_inner().0);
    }
}

// ---------------------------------------------------------------------------
// op — GUI Rust 만
// ---------------------------------------------------------------------------

pub(crate) fn is_op(op: &str) -> bool {
    matches!(op, "tile_permission_decide" | "tile_permission_snapshot" | "tile_permission_face")
}

#[derive(Deserialize)]
struct FaceBody {
    stream: String,
    window: String,
    convo: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecideBody {
    stream: String,
    session_epoch: u64,
    request_id: String,
    decision: String,
    #[serde(default)]
    message: Option<String>,
    /// `decision: "answer"` 의 답 `{질문 글: 답}` — 그 밖 결정에는 없다.
    #[serde(default)]
    answers: Option<Value>,
    window: String,
}

#[derive(Deserialize)]
struct SnapshotBody {
    stream: String,
    window: String,
}

fn bad(msg: &str) -> WireError {
    WireError::new(TILE_PERMISSION, msg)
}

/// 잠금과 대입뿐이라 읽기 고리 안에서 돈다. 몸(사유 글)은 로그에 남기지 않는다.
pub(crate) fn handle(op: &str, body: Value) -> Result<Value, WireError> {
    match op {
        "tile_permission_decide" => {
            let b: DecideBody = serde_json::from_value(body).map_err(|_| bad("bad decide body"))?;
            // 다리 표지로 결정하는 길은 `resolve_from_bridge` 하나 — 창의 op 는 그 이름을 받지 않는다
            if b.window == BRIDGE_WINDOW {
                return Err(bad("not-viewing"));
            }
            let w = watchers(&b.stream).unwrap_or_default();
            let mut t = table();
            let question = t.codex_question(&b.stream, b.session_epoch, &b.request_id);
            let (applied, evs) = if b.decision == "answer" {
                let answers = b.answers.as_ref().ok_or_else(|| bad("bad-answer"))?;
                t.answer(&b.stream, b.session_epoch, &b.request_id, &b.window, answers, &w).map_err(bad)?
            } else {
                let decision = Decision::parse(&b.decision).ok_or_else(|| bad("bad-decision"))?;
                t
                    .decide(&b.stream, b.session_epoch, &b.request_id, &b.window, decision, b.message.as_deref(), &w)
                    .map_err(bad)?
            };
            if applied && question && !t.codex_question_waiting(&b.stream) {
                emit_signal(crate::agent_state::question_signal(&b.stream, false));
            }
            drop(t);
            if applied {
                STATE.cv.notify_all();
            }
            emit(evs);
            Ok(json!({ "applied": applied }))
        }
        "tile_permission_face" => {
            let b: FaceBody = serde_json::from_value(body).map_err(|_| bad("bad face body"))?;
            if !crate::tile_env::stream_ok(&b.stream) || b.window.is_empty() || b.window.len() > 128 || b.window == BRIDGE_WINDOW {
                return Err(bad("bad face body"));
            }
            faces().entry(b.stream.clone()).or_default().insert(b.window, b.convo);
            // 대화 면으로 보는 창이 하나도 없으면 선 카드를 곧바로 TUI 로 푼다
            if convo_watchers(&b.stream).is_some_and(|w| w.is_empty()) {
                let evs = table().release_stream(&b.stream);
                if !evs.is_empty() {
                    STATE.cv.notify_all();
                }
                emit(evs);
            }
            Ok(Value::Null)
        }
        "tile_permission_snapshot" => {
            let b: SnapshotBody = serde_json::from_value(body).map_err(|_| bad("bad snapshot body"))?;
            let core = crate::session_core::core();
            let viewing = core.watchers(&b.stream).is_some_and(|w| w.contains(&b.window));
            let epoch = core.live_epoch(&b.stream);
            drop(core);
            match (viewing, epoch) {
                (true, Some(e)) => {
                    // 표 잠금 하나로(한 식에 두 번 잠그면 교착)
                    let t = table();
                    Ok(json!({ "sessionEpoch": e, "cards": t.snapshot(&b.stream, e), "tuiAsking": t.tui_asking(&b.stream) }))
                }
                _ => Ok(json!({ "sessionEpoch": null, "cards": [] })),
            }
        }
        _ => Err(bad("unknown op")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Arc;

    fn send(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(15))).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut buf = Vec::new();
        let _ = s.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    }

    fn req(port: u16, path: &str, tok: &str, body: &str) -> String {
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {tok}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn live_permission_plane() {
        let emit: super::super::signal_http::Emit = Arc::new(|_| {});
        let plane = super::super::signal_http::start(emit, None).expect("평면");
        let port = plane.port;
        let stream = format!("perm-live-{}", std::process::id());
        let window = "perm-live-window";
        let id = 3_950_000_000u32 + (std::process::id() % 1000);
        let keys = crate::session_core::core().commit(&stream, crate::session_core::Kind::Local, id, window, Instant::now());
        let owner = 7_700_000_000u64;
        let perm = crate::tile_permission::issue(&stream, owner).unwrap();
        assert!(crate::tile_permission::bind_epoch(&stream, owner, keys.session_epoch));
        let sig = crate::agent_signal::issue(&stream, None).unwrap();
        let q = |phase: &str| format!("{}?stream={stream}&phase={phase}", crate::tile_permission::PATH);
        let ask_body = json!({"cli": "claude", "tool": "Bash", "digest": "b".repeat(64), "input": {"command": "rm -rf build"}, "session": "c1"}).to_string();

        // 토큰은 서로의 경로에서 통하지 않는다.
        assert!(send(port, &req(port, &q("ask"), &sig.token, &ask_body)).starts_with("HTTP/1.1 401"), "신호 토큰으로 권한 경로");
        let signal = format!(r#"{{"stream":"{stream}","event":"stop"}}"#);
        assert!(send(port, &req(port, "/agent-signal", &perm, &signal)).starts_with("HTTP/1.1 401"), "권한 토큰으로 신호 경로");
        assert!(send(port, &req(port, "/agent-signal", &sig.token, &signal)).starts_with("HTTP/1.1 204"));
        assert!(send(port, &req(port, &format!("{}?stream=other&phase=ask", crate::tile_permission::PATH), &perm, &ask_body)).starts_with("HTTP/1.1 401"), "남의 스트림");

        // Codex 질문(면 규칙) — 그 창이 대화 면이라고 알리기 전에는 카드 없이 곧바로 빈 출력(TUI 가 묻는다).
        let codex_body = json!({"cli": "codex", "tool": "request_user_input", "digest": "c".repeat(64), "toolUseId": "call-1", "session": "x1",
            "input": {"questions": [{"id": "c", "header": "C", "question": "Which?", "options": [{"label": "A"}]}]}}).to_string();
        let now = send(port, &req(port, &q("ask"), &perm, &codex_body));
        assert!(now.contains(r#""state":"release""#), "{now}");
        let state = || crate::agent_state::snapshot().into_iter().find(|(s, _)| s == &stream).unwrap().1.state;
        assert_eq!(state(), Some(crate::agent_state::Phase::Permission), "TUI 질문도 대기 신호");
        let tool_signal = format!(r#"{{"stream":"{stream}","event":"tool","cli":"codex"}}"#);
        assert!(send(port, &req(port, "/agent-signal", &sig.token, &tool_signal)).starts_with("HTTP/1.1 204"));
        assert_eq!(state(), Some(crate::agent_state::Phase::Permission), "늦은 일반 PreToolUse 는 질문 대기를 덮지 않는다");
        let snap = handle("tile_permission_snapshot", json!({"stream": stream, "window": window})).unwrap();
        assert_eq!((snap["cards"].as_array().unwrap().len(), snap["tuiAsking"].as_bool()), (0, Some(true)));
        assert!(handle("tile_permission_face", json!({"stream": "a b", "window": window, "convo": true})).is_err());
        assert!(send(port, &req(port, &q("pre"), &perm, &ask_body)).starts_with("HTTP/1.1 204"));
        assert_eq!(state(), Some(crate::agent_state::Phase::Running), "다음 도구의 신호가 먼저 왔어도 pre 에서 대기를 푼다");

        // 셸 세션은 살아 있고 CLI 만 끝남 — 다음 Claude 훅이 Codex 질문 대기를 물려받지 않는다
        assert!(send(port, &req(port, &q("ask"), &perm, &codex_body)).contains(r#""state":"release""#));
        let ended = format!(r#"{{"stream":"{stream}","event":"session-end","cli":"codex"}}"#);
        assert!(send(port, &req(port, "/agent-signal", &sig.token, &ended)).starts_with("HTTP/1.1 204"));
        assert!(!table().codex_question_waiting(&stream));
        assert!(!table().tui_asking(&stream));
        assert!(send(port, &req(port, &q("pre"), &perm, &ask_body)).starts_with("HTTP/1.1 204"));
        assert!(!crate::agent_state::snapshot().iter().any(|(s, _)| s == &stream), "Claude pre 에서 Codex 실행 신호를 만들지 않는다");

        // Claude(면 규칙 밖) — 면을 알리지 않은(= 터미널 면) 창이라도 카드 → 결정 → 롱폴이 훅 응답을 받는다.
        let raw = req(port, &q("ask"), &perm, &ask_body);
        let waiter = std::thread::spawn(move || send(port, &raw));
        let card = (0..50)
            .find_map(|_| {
                std::thread::sleep(Duration::from_millis(50));
                table().snapshot(&stream, keys.session_epoch).first().cloned()
            })
            .expect("카드가 선다");
        let rid = card["requestId"].as_str().unwrap().to_string();
        let decide = |w: &str| {
            handle(
                "tile_permission_decide",
                json!({"stream": stream, "sessionEpoch": keys.session_epoch, "requestId": rid, "decision": "allow", "window": w}),
            )
        };
        assert!(decide("someone-else").is_err(), "보지 않는 창");
        assert_eq!(decide(window).unwrap()["applied"], true);
        assert_eq!(decide(window).unwrap()["applied"], false, "둘째는 조용히");
        let got = waiter.join().unwrap();
        assert!(got.starts_with("HTTP/1.1 200"), "{got}");
        assert!(got.contains(r#""state":"decided""#) && got.contains(r#""behavior":"allow""#), "{got}");
        let snap = handle("tile_permission_snapshot", json!({"stream": stream, "window": window})).unwrap();
        assert_eq!(snap["cards"].as_array().unwrap().len(), 0);
        assert_eq!(handle("tile_permission_snapshot", json!({"stream": stream, "window": "x"})).unwrap()["sessionEpoch"], Value::Null);

        // 면 규칙(Codex) — 대화 면이라고 알리면 카드가 서고, 카드가 선 동안 그 창이 터미널 면으로 넘기면 곧바로 풀린다(기다리던 롱폴은 빈 출력).
        handle("tile_permission_face", json!({"stream": stream, "window": window, "convo": true})).unwrap();
        let raw2 = req(port, &q("ask"), &perm, &codex_body);
        let waiter2 = std::thread::spawn(move || send(port, &raw2));
        assert!((0..50).any(|_| {
            std::thread::sleep(Duration::from_millis(50));
            !table().snapshot(&stream, keys.session_epoch).is_empty()
        }));
        handle("tile_permission_face", json!({"stream": stream, "window": window, "convo": false})).unwrap();
        let got2 = waiter2.join().unwrap();
        assert!(got2.contains(r#""state":"release""#), "{got2}");
        assert!(table().tui_asking(&stream));
        handle("tile_permission_face", json!({"stream": stream, "window": window, "convo": true})).unwrap();

        // 질문 카드의 답 — 훅 deny 로 끝나 PostToolUse 가 없어도 실행으로, 둘째 답은 신호도 더하지 않는다
        let raw3 = req(port, &q("ask"), &perm, &codex_body);
        let waiter3 = std::thread::spawn(move || send(port, &raw3));
        let card = (0..50).find_map(|_| {
            std::thread::sleep(Duration::from_millis(50));
            table().snapshot(&stream, keys.session_epoch).first().cloned()
        }).expect("질문 카드");
        assert_eq!(state(), Some(crate::agent_state::Phase::Permission));
        let answer = json!({"stream": stream, "sessionEpoch": keys.session_epoch, "requestId": card["requestId"], "decision": "answer", "answers": {"Which?": "A"}, "window": window});
        assert_eq!(handle("tile_permission_decide", answer.clone()).unwrap()["applied"], true);
        assert_eq!(handle("tile_permission_decide", answer).unwrap()["applied"], false);
        assert_eq!(state(), Some(crate::agent_state::Phase::Running));
        assert!(waiter3.join().unwrap().contains("permissionDecisionReason"));

        // 끊김 — 첫 롱폴의 `pending` 을 받고 다시 묻지 않는다(CLI 가 훅을 죽였다) → 시계가 치운다.
        let first = send(port, &req(port, &q("ask"), &perm, &ask_body));
        assert!(first.contains(r#""state":"pending""#), "{first}");
        assert_eq!(table().snapshot(&stream, keys.session_epoch).len(), 1);
        let gone = (0..40).any(|_| {
            std::thread::sleep(Duration::from_millis(250));
            table().snapshot(&stream, keys.session_epoch).is_empty()
        });
        assert!(gone, "훅이 사라진 카드는 치운다");

        assert!(revoke(&stream, owner));
        assert!(send(port, &req(port, &q("ask"), &perm, &ask_body)).starts_with("HTTP/1.1 401"), "거둔 뒤");
        let (s, o) = sig.key();
        crate::agent_signal::revoke(&s, o);
        crate::session_core::core().remove_id(crate::session_core::Kind::Local, id);
    }
}
