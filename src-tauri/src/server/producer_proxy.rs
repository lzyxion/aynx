//! GUI 쪽 **프로듀서 채팅 껍데기**(오케스트레이션 2단계 단계 2 — 설계 1-2 · 7절). 레지스트리 · stdin · 어댑터는 세션 서버에 산다
//! (`server::producer`). 여기 있는 것은 같은 이름의 Tauri 명령(전부 `async fn`)과 **사건 구독 라우터** 하나다(단계 3 — `(window, subGen) → Channel`).
//!
//! | Tauri 명령 | 서버 op | 등급 | 인자 → 답 |
//! | --- | --- | --- | --- |
//! | [`producer_chat_open`] | 같은 이름 | 쓰기 | `chat, cli, model, effort?, studio, mode` → 스냅숏(띄우지 않는다 · 스튜디오는 서버가 맡기기에서 다시 읽는다) |
//! | [`producer_chat_send`] | 같은 이름 | 쓰기 | `chat, clientId, text` → `{state, position?, epoch}` |
//! | [`producer_chat_interrupt`] | 같은 이름 | 쓰기 | `chat, deliverQueued` → bool |
//! | [`producer_chat_set_model`] · [`producer_chat_set_effort`] | 같은 이름 | 쓰기 | → bool |
//! | [`producer_chat_decide`] | 같은 이름 | 쓰기 | `chat, epoch, requestId, decision, message?` → true(허용 목록 두 카드에만 뜻 — **승인 등급 아님**) |
//! | [`producer_chat_queue_cancel`] | 같은 이름 | 쓰기 | `chat, clientId` → bool |
//! | [`producer_chat_close`] | 같은 이름 | 쓰기 | `chat` → bool |
//! | [`producer_chat_attach`] · [`producer_chat_status`] · [`producer_chat_list`] | 같은 이름 | 읽기 | 스냅숏 · 상태 · 목록 |
//! | [`producer_chat_subscribe`] | 같은 이름 | 쓰기 | `chat, channel` → `{subGen, snapshot}`(이 창의 그 채팅 통로를 건다 · 같은 창 · 같은 채팅은 갈음) |
//! | [`producer_chat_unsubscribe`] | 같은 이름 | 쓰기 | `chat, subGen` → bool(같은 `subGen` 만 지운다) |
//!
//! - **창 이름은 GUI 가 채운다** — 부른 웹뷰의 창 라벨(`webview.window().label()`)이고 프런트가 준 값은 받지 않는다. 사이드 채팅과 달리 주 창만이
//!   아니다(보조 창 · 원격 창도 그 탭의 프로듀서 잎을 그린다 — 설계 7절).
//! - **사건 중계는 방송하지 않는다**: 서버 이벤트 `producer-chat-event{chat, epoch, seq, ev, subs: [{conn, window, subGen}]}` 는 몸에 대화 본문이 있어
//!   `client::RELAYED` 에 넣지 않는다. [`on_event`] 가 몸의 `subs` 가운데 **이 GUI 가 그 `(window, subGen)` 으로 통로를 쥔 것 · 그 통로의 채팅이 몸의
//!   `chat` 과 같은 것 · 창이 살아 있는 것**에만 보낸다(판정은 순수 [`route`]). `subGen` 은 서버 전역 단조 증가라 같은 창의 옛 구독(F5 · 크래시 뒤)과
//!   섞이지 않는다 — 옛 통로는 새 구독이 갈음하거나 보내기 실패로 걷힌다. 원격 창의 Channel 은 `remote::bridge` 가 가로채 **그 연결의 ws 로만** 보낸다.
//!   `conn` 은 보지 않는다(이 GUI 의 연결 하나 — 끊긴 연결의 구독은 서버가 `conn_gone` 으로 지운다).
//! - 창이 사라지면(파괴 · 원격 연결 끝) 서버가 `close_window` · `detach_window` 에서 그 창의 구독을 지우고, 여기 통로는 보낼 때 창이 없으면 걷는다.
//!
//! 원격 웹: 전부 `remote::deny::ALLOW`(사람의 말 · 결정 · 끊기 — 스튜디오 · 종류 · 세대 · 미귀속 상한은 서버가 본다 · 맡기기 넓힘은 REAUTH 그대로).
//! **로그**: 몸(사람 글)은 남기지 않는다. 토큰은 이 파일이 모른다(토큰 표 이름이 한 글자도 없다 — 소스 훑기 시험이 지킨다).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::PRODUCER_PROTOCOL;
use super::ipc::Grade;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 판 20 미만 서버면 보내지 않는다(서버도 받을 때 다시 본다).
fn check_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < PRODUCER_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 프로듀서 채팅을 열 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run producer chats — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    check_protocol()?;
    client::request(kind, op, body).await.map_err(wire_message)
}

/// 프로듀서 채팅을 연다 — **띄우지 않는다**(첫 보내기가 띄운다). `studio` = 맡긴 저장소의 경로 열쇠(서버가 지금 맡기기에서 다시 읽는다).
#[tauri::command]
pub async fn producer_chat_open(
    chat: String,
    cli: String,
    model: String,
    effort: Option<String>,
    mode: Value,
) -> Result<Value, String> {
    call(
        Grade::Write,
        "producer_chat_open",
        json!({ "chat": chat, "cli": cli, "model": model, "effort": effort, "mode": mode }),
    )
    .await
}

/// 첫 말로 앨범 시작(원격 REAUTH). 몸은 서버가 검사하며 첫 전송까지 기다린다.
#[tauri::command]
pub async fn producer_album_start(input: Value) -> Result<Value, String> {
    check_protocol()?;
    client::request_timed(Grade::Write, "producer_album_start", input, super::side_chat_proxy::send_timeout()).await.map_err(wire_message)
}

/// 사람의 앨범 권한 넓히기(원격 REAUTH). next는 바꿀 구성 전체다.
#[tauri::command]
pub async fn orchestration_album_widen(run_id: String, expect_rev: u32, next: Value, risk_confirmed: bool) -> Result<Value, String> {
    call(Grade::Write, "orchestration_album_widen", json!({"runId": run_id, "expectRev": expect_rev, "next": next, "riskConfirmed": risk_confirmed})).await
}

/// 넓힘 없는 앨범 권한 변경(원격 ALLOW). 넓힘 여부는 서버가 판정한다.
#[tauri::command]
pub async fn orchestration_album_set(run_id: String, expect_rev: u32, next: Value) -> Result<Value, String> {
    call(Grade::Write, "orchestration_album_set", json!({"runId": run_id, "expectRev": expect_rev, "next": next})).await
}

/// 사람만 앨범 이름을 바꾼다(원격 ALLOW).
#[tauri::command]
pub async fn orchestration_rename_album(run_id: String, name: String) -> Result<Value, String> {
    call(Grade::Write, "orchestration_rename_album", json!({"runId": run_id, "name": name})).await
}

#[tauri::command]
pub async fn producer_fork_probe(agent: String, conv: String) -> Result<Value, String> {
    call(Grade::Read, "producer_fork_probe", json!({"agent": agent, "conv": conv})).await
}

#[tauri::command]
pub async fn orchestration_album_defaults(repo: String) -> Result<Value, String> {
    call(Grade::Read, "orchestration_album_defaults", json!({"repo": repo})).await
}

/// **사람이 보낸 글** — 서버의 전송기가 곧바로 보내거나 대기열에 넣는다(`clientId` = 서버 중복 제거 열쇠). 프로세스가 없으면 서버가 여기서
/// 띄우고 준비를 기다린다(그래서 시한이 길다).
#[tauri::command]
pub async fn producer_chat_send(chat: String, client_id: String, text: String) -> Result<Value, String> {
    check_protocol()?;
    client::request_timed(
        Grade::Write,
        "producer_chat_send",
        json!({ "chat": chat, "clientId": client_id, "text": text }),
        super::side_chat_proxy::send_timeout(),
    )
    .await
    .map_err(wire_message)
}

/// 끊기 — ✕(`deliverQueued: false` — 대기열 보류) · [끊고 전달](true). 서버가 그 자리의 `wait_run` 을 먼저 취소한다.
#[tauri::command]
pub async fn producer_chat_interrupt(chat: String, deliver_queued: bool) -> Result<Value, String> {
    call(Grade::Write, "producer_chat_interrupt", json!({ "chat": chat, "deliverQueued": deliver_queued })).await
}

#[tauri::command]
pub async fn producer_chat_set_model(chat: String, model: String) -> Result<Value, String> {
    call(Grade::Write, "producer_chat_set_model", json!({ "chat": chat, "model": model })).await
}

#[tauri::command]
pub async fn producer_chat_set_effort(chat: String, effort: Option<String>) -> Result<Value, String> {
    call(Grade::Write, "producer_chat_set_effort", json!({ "chat": chat, "effort": effort })).await
}

/// **사람의 권한 결정** — 카드로 선 요청만(스튜디오 밖 Read · Aynx DB 읽기 도구 — 그 밖은 서버가 카드 없이 거절해 표에 없다).
#[tauri::command]
pub async fn producer_chat_decide(
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    message: Option<String>,
) -> Result<Value, String> {
    call(
        Grade::Write,
        "producer_chat_decide",
        json!({ "chat": chat, "epoch": epoch, "requestId": request_id, "decision": decision, "message": message }),
    )
    .await
}

#[tauri::command]
pub async fn producer_chat_queue_cancel(chat: String, client_id: String) -> Result<Value, String> {
    call(Grade::Write, "producer_chat_queue_cancel", json!({ "chat": chat, "clientId": client_id })).await
}

#[tauri::command]
pub async fn producer_chat_close(chat: String) -> Result<Value, String> {
    call(Grade::Write, "producer_chat_close", json!({ "chat": chat })).await
}

#[tauri::command]
pub async fn producer_chat_attach(chat: String) -> Result<Value, String> {
    call(Grade::Read, "producer_chat_attach", json!({ "chat": chat })).await
}

/// 그 채팅이 열려 있나 · 아니면 끝난 이유(`closed` · `server-restarted`)와 귀속 앨범 — 화면은 `session-gone` 에 스스로 열지 않고 이것을 묻는다.
#[tauri::command]
pub async fn producer_chat_status(chat: String) -> Result<Value, String> {
    call(Grade::Read, "producer_chat_status", json!({ "chat": chat })).await
}

#[tauri::command]
pub async fn producer_chat_list() -> Result<Value, String> {
    call(Grade::Read, "producer_chat_list", json!({})).await
}

// ---------------------------------------------------------------------------
// 사건 구독 라우터(머리말 "사건 중계는 방송하지 않는다")
// ---------------------------------------------------------------------------

/// `(창 라벨, subGen)` → `(채팅 id, 통로)`. 같은 창 · 같은 채팅은 하나(다시 구독하면 갈음).
type Subs<T> = HashMap<(String, u64), (String, T)>;

static CHANNELS: LazyLock<Mutex<Subs<Channel<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn channels() -> std::sync::MutexGuard<'static, Subs<Channel<Value>>> {
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 통로를 단다 — 같은 `(창, 채팅)` 의 옛 통로를 먼저 걷는다(순수 · 시험용 일반형).
fn register<T>(subs: &mut Subs<T>, window: &str, gen: u64, chat: &str, ch: T) {
    subs.retain(|(w, _), (c, _)| !(w == window && c == chat));
    subs.insert((window.to_string(), gen), (chat.to_string(), ch));
}

/// 통로를 뗀다 — 그 `(창, subGen)` 이고 채팅이 같을 때만. 뗐나.
fn unregister<T>(subs: &mut Subs<T>, window: &str, gen: u64, chat: &str) -> bool {
    let key = (window.to_string(), gen);
    if subs.get(&key).is_some_and(|(c, _)| c == chat) {
        subs.remove(&key);
        return true;
    }
    false
}

/// 이 창에서 그 채팅의 사건 통로를 건다 — 서버에 구독(`{chat, window}` — 창 라벨은 웹뷰에서)하고 받은 `subGen` 으로 통로를 단다. 답은 그대로
/// `{subGen, snapshot}`(화면은 스냅숏의 `seq` 에서 시작한다). F5 · 크래시 뒤 새 페이지는 다시 부른다(새 `subGen` — 옛 것은 갈음).
#[tauri::command]
pub async fn producer_chat_subscribe(webview: tauri::Webview, chat: String, channel: Channel<Value>) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    let v = call(Grade::Write, "producer_chat_subscribe", json!({ "chat": chat, "window": label })).await?;
    let gen = v.get("subGen").and_then(Value::as_u64).ok_or_else(|| "bad producer subscribe reply".to_string())?;
    register(&mut channels(), &label, gen, &chat, channel);
    Ok(v)
}

/// 이 창의 그 구독을 뗀다(잎이 사라짐 · 탭 닫기) — 같은 `subGen` 만(늦은 정리가 새 구독을 지우지 않게).
#[tauri::command]
pub async fn producer_chat_unsubscribe(webview: tauri::Webview, chat: String, sub_gen: u64) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    unregister(&mut channels(), &label, sub_gen, &chat);
    call(Grade::Write, "producer_chat_unsubscribe", json!({ "chat": chat, "window": label, "subGen": sub_gen })).await
}

/// 사건을 받을 통로들 — **순수**. 몸의 `subs` 가운데 창이 살아 있고(`alive`) 이 GUI 가 그 `(창, subGen)` 으로 **같은 채팅**의 통로를 쥔 것만.
/// 몸에 `chat` · `subs` 가 없거나 모양이 틀리면 빈 목록(버린다). 방송 갈래는 없다.
pub(crate) fn route(body: &Value, alive: impl Fn(&str) -> bool, has: impl Fn(&str, u64, &str) -> bool) -> Vec<(String, u64)> {
    let Some(chat) = body.get("chat").and_then(Value::as_str) else { return Vec::new() };
    let Some(subs) = body.get("subs").and_then(Value::as_array) else { return Vec::new() };
    let mut out: Vec<(String, u64)> = Vec::new();
    for s in subs {
        let (Some(w), Some(g)) = (s.get("window").and_then(Value::as_str), s.get("subGen").and_then(Value::as_u64)) else {
            continue;
        };
        if alive(w) && has(w, g, chat) && !out.iter().any(|(ow, og)| ow == w && *og == g) {
            out.push((w.to_string(), g));
        }
    }
    out
}

/// [`route`] 가 고른 통로에 보낸다 — **순수 · 시험용 일반형**. 보내기가 실패한 통로(죽은 페이지 · 느린 수신자)는 **그 구독만** 걷고
/// `(창, subGen, 채팅)` 을 돌려준다(부르는 쪽이 서버 구독도 같은 세대로 뗀다 — 다른 창 · 같은 창의 다른 세대는 그대로).
fn deliver<T>(
    subs: &mut Subs<T>,
    body: &Value,
    alive: impl Fn(&str) -> bool,
    send: impl Fn(&T, &Value) -> bool,
) -> Vec<(String, u64, String)> {
    let targets = route(body, &alive, |w, g, c| subs.get(&(w.to_string(), g)).is_some_and(|(chat, _)| chat == c));
    let mut dead = Vec::new();
    for key in targets {
        if !subs.get(&key).is_some_and(|(_, ch)| send(ch, body)) {
            if let Some((chat, _)) = subs.remove(&key) {
                dead.push((key.0, key.1, chat));
            }
        }
    }
    dead
}

/// 서버 이벤트 `producer-chat-event` — [`route`] 가 고른 통로에만 보낸다(`client::on_event`). 보내기 실패 통로는 걷고 서버 구독도 그 세대로
/// 뗀다(화면은 `seq` 빈틈에서 다시 구독한다). 사라진 창의 통로는 걷는다. 몸은 로그에 남기지 않는다.
pub(crate) fn on_event(app: &tauri::AppHandle, body: &Value) {
    let dead = {
        let mut chs = channels();
        // 창이 사라진 통로부터 걷는다(서버는 `close_window` 에서 그 창의 구독을 지운다).
        chs.retain(|(w, _), _| app.get_webview_window(w).is_some());
        deliver(&mut chs, body, |l| app.get_webview_window(l).is_some(), |ch, b| ch.send(b.clone()).is_ok())
    };
    for (window, gen, chat) in dead {
        tauri::async_runtime::spawn(async move {
            let _ = call(Grade::Write, "producer_chat_unsubscribe", json!({ "chat": chat, "window": window, "subGen": gen })).await;
        });
    }
}

/// **창이 사라진다 · 다시 뜬다**(F5 · 크래시 · 파괴 — `server::proxy` 의 `detach_window` · `close_window`) — 이 GUI 가 그 창에 쥔 통로를 걷고 그
/// `subGen` 들을 돌려준다(서버 op 몸 `producerSubs` — 서버는 **그 세대만** 지운다 · 같은 라벨의 새 페이지가 이 뒤에 건 구독은 남는다).
pub(crate) fn take_window(label: &str) -> Vec<u64> {
    take_window_in(&mut channels(), label)
}

fn take_window_in<T>(subs: &mut Subs<T>, label: &str) -> Vec<u64> {
    let mut gens: Vec<u64> = subs.keys().filter(|(w, _)| w == label).map(|(_, g)| *g).collect();
    gens.sort_unstable();
    subs.retain(|(w, _), _| w != label);
    gens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(chat: &str, subs: &[(&str, u64)]) -> Value {
        let subs: Vec<Value> = subs.iter().map(|(w, g)| json!({ "conn": 7, "window": w, "subGen": g })).collect();
        json!({ "chat": chat, "epoch": 1, "seq": 3, "ev": { "t": "text", "item": null, "text": "본문" }, "subs": subs })
    }

    /// 시험 `producer_subs_route` — 본문은 그 채팅을 구독한 `(창, subGen)` 의 통로에만 간다(방송 없음).
    #[test]
    fn producer_subs_route() {
        let mut subs: Subs<u8> = HashMap::new();
        register(&mut subs, "main", 4, "pc-a", 0);
        register(&mut subs, "aux-1", 5, "pc-a", 0);
        register(&mut subs, "main", 6, "pc-b", 0);
        let has = |w: &str, g: u64, c: &str| subs.get(&(w.to_string(), g)).is_some_and(|(chat, _)| chat == c);
        let all = |_: &str| true;
        // 두 창 모두 구독 — 둘 다.
        assert_eq!(route(&ev("pc-a", &[("main", 4), ("aux-1", 5)]), all, has), vec![("main".to_string(), 4), ("aux-1".to_string(), 5)]);
        // 몸에 없는 창은 받지 않는다(그 창이 통로를 쥐었어도 — 서버 구독이 기준).
        assert_eq!(route(&ev("pc-a", &[("main", 4)]), all, has), vec![("main".to_string(), 4)]);
        // 몸에 있어도 이 GUI 가 통로를 쥐지 않은 창(원격 라벨) · 옛 subGen · 다른 채팅의 통로 — 버린다.
        assert!(route(&ev("pc-a", &[("remote-x-1", 9)]), all, has).is_empty());
        assert!(route(&ev("pc-a", &[("main", 3)]), all, has).is_empty(), "옛 subGen");
        assert!(route(&ev("pc-a", &[("main", 6)]), all, has).is_empty(), "그 통로는 다른 채팅(pc-b)");
        // 사라진 창.
        assert!(route(&ev("pc-a", &[("main", 4)]), |_| false, has).is_empty());
        // 모양이 틀린 몸 — 버린다.
        assert!(route(&json!({ "chat": "pc-a" }), all, has).is_empty());
        assert!(route(&json!({ "subs": [{ "window": "main", "subGen": 4 }] }), all, has).is_empty());
        assert!(route(&json!({ "chat": "pc-a", "subs": [{ "window": 1, "subGen": "4" }] }), all, has).is_empty());
        // 같은 구독이 둘 실려도 한 번.
        assert_eq!(route(&ev("pc-a", &[("main", 4), ("main", 4)]), all, has).len(), 1);
    }

    /// 시험 `producer_subs_gen` — 같은 창 · 같은 채팅의 다시 구독은 옛 통로를 갈음하고(다른 채팅 · 다른 창은 그대로), 떼기는 같은 `subGen` 만.
    #[test]
    fn producer_subs_gen() {
        let mut subs: Subs<&str> = HashMap::new();
        register(&mut subs, "main", 1, "pc-a", "old");
        register(&mut subs, "main", 2, "pc-b", "b");
        register(&mut subs, "aux-1", 3, "pc-a", "aux");
        register(&mut subs, "main", 4, "pc-a", "new");
        assert!(!subs.contains_key(&("main".to_string(), 1)), "F5 뒤 새 구독이 옛 통로를 갈음");
        assert_eq!(subs.get(&("main".to_string(), 4)).map(|x| x.1), Some("new"));
        assert!(subs.contains_key(&("main".to_string(), 2)) && subs.contains_key(&("aux-1".to_string(), 3)));
        // 옛 subGen 의 늦은 떼기는 새 구독을 지우지 않는다 · 다른 채팅 이름으로도 못 뗀다.
        assert!(!unregister(&mut subs, "main", 1, "pc-a"));
        assert!(!unregister(&mut subs, "main", 4, "pc-b"));
        assert!(unregister(&mut subs, "main", 4, "pc-a"));
        assert!(!subs.contains_key(&("main".to_string(), 4)));
        assert_eq!(subs.len(), 2);
    }

    /// 단계 5 M20 `producer_slow_receiver_alone` — 보내기가 실패한 통로(느린 수신자 · 죽은 페이지)는 **그 구독만** 걷히고 서버에서 뗄 세대로
    /// 돌아온다 · 같은 사건은 나머지 통로(다른 원격 연결 · 보조 창)에 그대로 간다 · 원격 연결 둘의 본문은 서로의 통로로 새지 않는다(몸의 구독만).
    #[test]
    fn producer_slow_receiver_alone() {
        use std::cell::RefCell;
        let mut subs: Subs<&str> = HashMap::new();
        register(&mut subs, "main", 1, "pc-a", "main");
        register(&mut subs, "aux-1", 2, "pc-a", "aux");
        register(&mut subs, "remote-a-1", 3, "pc-a", "slow");
        register(&mut subs, "remote-b-1", 4, "pc-b", "b");
        let got = RefCell::new(Vec::new());
        let send = |ch: &&str, _: &Value| {
            got.borrow_mut().push(ch.to_string());
            *ch != "slow"
        };
        let dead = deliver(&mut subs, &ev("pc-a", &[("main", 1), ("aux-1", 2), ("remote-a-1", 3)]), |_| true, send);
        assert_eq!(dead, vec![("remote-a-1".to_string(), 3, "pc-a".to_string())]);
        let mut sent = got.borrow().clone();
        sent.sort();
        assert_eq!(sent, ["aux", "main", "slow"], "pc-b 의 원격 통로에는 가지 않는다");
        assert!(!subs.contains_key(&("remote-a-1".to_string(), 3)));
        assert_eq!(subs.len(), 3);
        // 다음 사건 — 걷힌 통로에는 가지 않는다(화면은 seq 빈틈에서 다시 구독한다)
        got.borrow_mut().clear();
        assert!(deliver(&mut subs, &ev("pc-a", &[("main", 1), ("remote-a-1", 3)]), |_| true, send).is_empty());
        assert_eq!(*got.borrow(), ["main"]);
    }

    /// 단계 5 `producer_take_window` — 창이 사라지거나 다시 뜰 때(F5 · 크래시 · 파괴) 그 라벨의 통로만 걷고 그 세대들을 돌려준다(서버는 그 세대만
    /// 지운다) — 다른 창 · 같은 채팅의 다른 창 통로는 그대로. 그 뒤 같은 라벨의 새 구독은 새 세대라 다음 정리에만 걸린다.
    #[test]
    fn producer_take_window() {
        let mut subs: Subs<u8> = HashMap::new();
        register(&mut subs, "main", 5, "pc-a", 0);
        register(&mut subs, "main", 7, "pc-b", 0);
        register(&mut subs, "remote-x-1", 6, "pc-a", 0);
        assert_eq!(take_window_in(&mut subs, "main"), vec![5, 7]);
        assert_eq!(subs.len(), 1);
        register(&mut subs, "main", 9, "pc-a", 0);
        assert_eq!(take_window_in(&mut subs, "remote-x-1"), vec![6]);
        assert!(subs.contains_key(&("main".to_string(), 9)));
        assert!(take_window_in(&mut subs, "aux-3").is_empty());
        // 사라지는 창의 통로 정리는 서버 op 몸에 그 세대를 싣는다(라벨만으로 지우지 않는다)
        let proxy = include_str!("proxy.rs");
        assert_eq!(proxy.matches("let producer_subs = super::producer_proxy::take_window(label);").count(), 2);
        assert_eq!(proxy.matches("\"producerSubs\": producer_subs").count(), 3);
    }

    /// 명령은 모두 `async fn` · 창 라벨은 웹뷰에서 · 등급은 서버 표와 같다 · 승인 등급 없음 · 방송 없음(소스 훑기).
    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        let src = include_str!("producer_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        for (op, grade) in [
            ("producer_chat_open", "Grade::Write"),
            ("producer_chat_send", "Grade::Write"),
            ("producer_chat_interrupt", "Grade::Write"),
            ("producer_chat_set_model", "Grade::Write"),
            ("producer_chat_set_effort", "Grade::Write"),
            ("producer_chat_decide", "Grade::Write"),
            ("producer_chat_queue_cancel", "Grade::Write"),
            ("producer_chat_close", "Grade::Write"),
            ("producer_chat_attach", "Grade::Read"),
            ("producer_chat_status", "Grade::Read"),
            ("producer_chat_list", "Grade::Read"),
            ("producer_chat_subscribe", "Grade::Write"),
            ("producer_chat_unsubscribe", "Grade::Write"),
        ] {
            assert!(src.contains(&format!("pub async fn {op}(")), "{op}");
            assert!(
                src.contains(&format!("{grade},\n        \"{op}\"")) || src.contains(&format!("{grade}, \"{op}\"")),
                "{op} 등급"
            );
            let want = if grade == "Grade::Read" { super::super::ipc::Grade::Read } else { super::super::ipc::Grade::Write };
            assert_eq!(frame::required_grade(op), Some(want), "{op}");
        }
        assert!(!src.contains("Grade::Approve") && !src.contains("request_approve"));
        // 프런트가 준 창 이름을 받는 인자가 없다.
        assert!(!src.contains("window: String"));
        for bad in ["emit(", "emit_to(", "emit_filter(", "eprintln!", "log::"] {
            assert!(!src.contains(bad), "{bad}");
        }
        // GUI 중계 표(`RELAYED`)에 이 이벤트가 없다 — `client.rs` 가 따로 이 파일의 `on_event` 로 넘긴다.
        let client = include_str!("client.rs");
        let relayed = &client[client.find("const RELAYED").unwrap()..];
        let relayed = &relayed[..relayed.find("];").unwrap()];
        assert!(!relayed.contains("producer"), "RELAYED 에 프로듀서 채팅 사건");
        assert!(client.contains("n if n == super::producer::EVENT => super::producer_proxy::on_event(app, body)"));
    }
}
