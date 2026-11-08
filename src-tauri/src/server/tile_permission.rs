//! **타일 권한 카드 — 세션 서버 쪽**(2026-11-01 · 순수 몸통과 불변식은 `crate::tile_permission` 머리말).
//!
//! - HTTP: 신호 평면 리스너(`server::signal_http`)의 경로 `/agent-permission` — 문지기는 경로 → 출처(`signal_origin_ok` — 같은 규칙) → POST →
//!   **권한 결정 토큰**(질의의 `stream` 에 뽑힌 것 · 지금 산 회차만 — 신호 토큰 · MCP 토큰은 401) → 본문 256 KiB(413) 순. 동시 상한은
//!   이 갈래 따로(`CLASS_PERM`) — 롱폴이 신호 · `/mcp` 자리를 먹지 않는다.
//! - 롱폴: `ask` · `wait` 는 결정이 날 때까지 최대 [`HOLD_MS`] 붙든다(`Condvar`). 응답을 쓰지 못하면(훅이 죽음) 곧바로 그 카드를 치운다.
//! - 시계: 첫 `ask` 때 스레드 하나(`aynx-perm-sweep`)가 0.5초마다 [`Table::sweep`] — 시한 · 보는 창 없음 · 훅 사라짐.
//! - op(GUI Rust 만 — `server::tile_permission_proxy`): `tile_permission_decide`(쓰기 — 사람의 결정 · 처음 하나만) ·
//!   `tile_permission_snapshot`(읽기 — 그 창이 보는 스트림의 선 카드). **승인 등급이 아니다**(작업안 승인 `ops_approve` 와 다른 길).
//! - 사건 `tile-permission-event{windows, stream, sessionEpoch, ev}` — `hub::emit` 으로 GUI 에 가지만 GUI 는 방송하지 않는다(`client::RELAYED`
//!   밖 — 몸의 `windows` 가 건 통로에만). `windows` = 그 순간 그 세션을 보는 창(주 임대 + 시청자 — `session_core::Core::watchers`).
//! - 로그에는 고정 글자 · 수만 — 본문 · 토큰 · 사유 글은 남기지 않는다.
//! - **면 규칙**(2026-11-02 사용자 승인 — 대화 면에서는 카드로, 터미널 면에서는 TUI 로 · **Codex 만** — `crate::tile_permission::face_rule_applies`.
//!   Claude 는 훅이 도는 동안에도 TUI 창이 함께 떠 있어 예전처럼 늘 카드): 창마다 그 타일의 지금 면(op `tile_permission_face` — 판 24)을
//!   [`FACES`] 에 적는다. 카드를 세우고 · 붙들고 · 시계가 보는 "보는 창" 은 **그 타일을 대화 면으로 보는 사람 창**([`convo_watchers`])이다 — 없으면 `ask`
//!   가 곧바로 빈 출력(TUI 가 묻는다 · 카드 없음), 카드가 선 동안 모두 터미널 면으로 넘기면 곧바로 풀고(`release_stream`), 창이 사라진 것은 예전
//!   유예(5초 — F5) 뒤에 푼다. 결정 · 스냅숏의 문(`not-viewing`)은 예전대로 그 세션을 보는 모든 창이다.

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

/// op 오류 코드.
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
}

/// 신호 방송은 재진입 없는 채널 쓰기뿐 — 카드 표 잠금 안에서 순서를 지킨다(`hub::emit`)
fn emit_signal(payload: Value) {
    hub::emit(crate::agent_signal::EVENT, payload);
}

fn watchers(stream: &str) -> Option<Vec<String>> {
    crate::session_core::core().watchers(stream)
}

/// 스트림 → (창 → 대화 면인가) — 창이 알린 그 타일의 지금 면(op `tile_permission_face`). 알리지 않은 창은 터미널 면으로 친다.
static FACES: LazyLock<Mutex<std::collections::HashMap<String, std::collections::HashMap<String, bool>>>> = LazyLock::new(Default::default);

fn faces() -> MutexGuard<'static, std::collections::HashMap<String, std::collections::HashMap<String, bool>>> {
    FACES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 그 타일을 **대화 면으로 보는** 사람 창들 — 그 세션을 보는 창(주 임대 + 시청자) 가운데 대화 면이라고 알린 것. 세션이 없으면 `None`.
fn convo_watchers(stream: &str) -> Option<Vec<String>> {
    let w = watchers(stream)?;
    let f = faces();
    let on = f.get(stream);
    Some(w.into_iter().filter(|win| on.and_then(|m| m.get(win)).copied().unwrap_or(false)).collect())
}

/// 사건들을 내보낸다 — 표 잠금 밖에서(세션 코어를 읽는다).
fn emit(evs: Vec<Ev>) {
    for ev in evs {
        let windows = watchers(&ev.stream).unwrap_or_default();
        hub::emit(EVENT, json!({ "windows": windows, "stream": ev.stream, "sessionEpoch": ev.session_epoch, "ev": ev.body }));
    }
}

/// 토큰을 거두고(자기 것만) 그 스트림의 카드 · 표지 · 세션 허용 기억을 버린다 — 세션 회수 · 열기 실패.
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

/// 시계 한 번 — 보는 창은 표 잠금 밖에서 먼저 읽는다(잠금 순서: 세션 코어 ↔ 표를 겹쳐 쥐지 않는다).
fn sweep_once() {
    let streams: Vec<(String, bool)> = {
        let t = table();
        if !t.has_pending() {
            return;
        }
        t.pending_streams().into_iter().map(|s| { let codex = t.stream_cli(&s).is_some_and(face_rule_applies); (s, codex) }).collect()
    };
    // 시계의 "보는 창" — Codex 카드면 대화 면으로 보는 창(모두 사라지면 유예 뒤 푼다) · Claude 면 예전대로 그 세션을 보는 모든 창
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

/// 질의 `stream=…&phase=…[&id=…]` — 퍼센트 해독 없이 모양만(스트림 · id 는 그 글자들만 받는다).
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

/// 응답을 쓴다 — 실패(상대가 이미 끊음)면 거짓.
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

/// 그 스트림의 턴 끊음 · CLI 끝(`interrupt` · `session-end`) — Codex 질문 카드 · TUI 표지를 걷는다(기다리는 훅은 빈 출력으로).
pub(crate) fn interrupted(stream: &str) {
    let evs = table().drop_questions(stream);
    if !evs.is_empty() {
        STATE.cv.notify_all();
    }
    emit(evs);
}

/// `/agent-permission` 요청 하나(신호 평면이 갈래를 나눠 부른다 — 머리말의 문지기 순서).
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
                    // 면 규칙(Codex 만) — 그 타일을 대화 면으로 보는 창이 없으면 카드 없이 곧바로 빈 출력(TUI 가 묻는다). Claude 는 예전대로 보는 창 모두
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

/// 롱폴 하나 — 결정이 오면 곧바로, 아니면 [`HOLD_MS`] 뒤 `pending`. 쓰기가 실패하면 그 카드를 치운다(훅이 죽었다).
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
    /// 그 창이 이 타일을 대화 면으로 보는가
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
    /// `decision: "answer"`(질문 카드 — 2026-11-02)의 답 `{질문 글: 답}` — 그 밖 결정에는 없다.
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

/// op 하나 — 잠금과 대입뿐이라 읽기 고리 안에서 돈다. 몸(사유 글)은 로그에 남기지 않는다.
pub(crate) fn handle(op: &str, body: Value) -> Result<Value, WireError> {
    match op {
        "tile_permission_decide" => {
            let b: DecideBody = serde_json::from_value(body).map_err(|_| bad("bad decide body"))?;
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
            if !crate::tile_env::stream_ok(&b.stream) || b.window.is_empty() || b.window.len() > 128 {
                return Err(bad("bad face body"));
            }
            faces().entry(b.stream.clone()).or_default().insert(b.window, b.convo);
            // 대화 면으로 보는 창이 하나도 없으면 선 카드를 곧바로 푼다(TUI 로 — [터미널에서 답하기]와 같다)
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

    /// 시험 `live_permission_plane` — 실제 리스너: 토큰은 서로의 경로에서 401 · 카드 → 사람 결정 → 롱폴이 훅 응답을 받는다 · 둘째 결정은 조용히 ·
    /// 훅이 끊기면(롱폴이 다시 안 옴) 시계가 카드를 치운다.
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
