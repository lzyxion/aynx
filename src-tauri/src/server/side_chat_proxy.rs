//! GUI 쪽 **사이드 채팅 껍데기**(v2 3단계 — 설계 docs/log/2026-10-23-side-chat-v2-design.md 1절 · 3절 · 4절). 프로세스 표 · stdin ·
//! 어댑터는 세션 서버에 산다(`server::side_chat`). 여기 있는 것은 같은 이름의 Tauri 명령(전부 `async fn`)과 사건 중계 하나다.
//!
//! | Tauri 명령 | 서버 op | 등급 | 인자 → 답 |
//! | --- | --- | --- | --- |
//! | [`side_chat_open`] | 같은 이름 | 쓰기 | `chat, cli, model, effort?, mode` → 스냅숏(띄우지 않는다) |
//! | [`side_chat_send`] | 같은 이름 | 쓰기 | `chat, epoch, text, clientId?, linkName?, images?` → `{epoch, link}`(프로세스가 없으면 서버가 여기서 띄운다) |
//! | [`side_chat_interrupt`] | 같은 이름 | 쓰기 | `chat, epoch` → bool |
//! | [`side_chat_set_model`] | 같은 이름 | 쓰기 | `chat, epoch, model` → bool |
//! | [`side_chat_set_effort`] | 같은 이름 | 쓰기 | `chat, epoch, effort?`(없음 = CLI 기본) → bool |
//! | [`side_chat_decide`] | 같은 이름 | 쓰기 | `chat, epoch, requestId, decision, message?` → true(사람의 권한 결정 — **승인 등급 아님**) |
//! | [`side_chat_close`] | 같은 이름 | 쓰기 | `chat` → bool |
//! | [`side_chat_attach`] | 같은 이름 | 읽기 | `chat` → 스냅숏(이 창을 보는 창에 덧붙인다 — F5 · 웹뷰 크래시 뒤 · 다른 창) |
//! | [`side_chat_list`] | 같은 이름 | 읽기 | → 서버 표의 채팅들(`viewers` = 보는 창 수 — 창 라벨 없음) |
//! | [`side_chat_subscribe`] | (없음 — GUI 안) | — | `channel` → —(이 창의 사건 통로를 건다 · 다시 부르면 갈음) |
//! | [`side_chat_link`] | 같은 이름 | 쓰기 | `chat, epoch?, stream?`(없음 = 연결 끊기) → `{link, changed}`(5단계 — 연결 칩 · 서버 거울의 창 타일만) |
//!
//! - **창 이름은 GUI 가 채운다** — 부른 웹뷰의 창 라벨(`webview.window().label()`)이고, 프런트가 준 값은 받지 않는다. 그리고 **사람 창만**
//!   부를 수 있다(독이 있는 창 — 집 PC 주 창 · 원격 웹 창 `remote-<기기>-<세대>` · [`human_window`] — 2026-11-01). 보조 · 떼어 낸 창은
//!   `[main-window-only]` 로 거절. 원격 관문(`remote::deny`)에서 `side_chat_*` 는 모두 ALLOW 다(사용자 결정 2026-11-01 — 원격 창은 이미
//!   셸에 칠 수 있다 · `side_chat_decide` 도 재확인 없음).
//! - **사건 중계는 방송하지 않는다**: 서버 이벤트 `side-chat-event{windows, chat, epoch, seq, ev}` 는 몸에 대화 본문이 있어 `client::RELAYED`
//!   (모든 창에 같은 이름으로 방송)에 넣지 않는다. 대신 [`on_event`] 가 몸의 `windows`(그 채팅을 보는 창들 — 서버 표가 기준) 가운데 사람 창 ·
//!   살아 있고 · [`side_chat_subscribe`] 로 통로를 건 창의 **Tauri `Channel` 에만** 보낸다(판정은 순수 [`route`]). 라벨을 지정한 `emit_to` 를
//!   쓰지 않은 까닭: Tauri 2 의 `emit_to` 는 대상이 맞는 리스너 말고도 **대상 `Any` 리스너**(어느 창이든 전역 `listen` · 원격 관문의
//!   `listen_any`)에 그대로 닿는다(`tauri` `event/listener.rs` `match_any_or_filter`) — 다른 원격 창이 `listen("side-chat-event")` 만 해도 본문을
//!   받게 된다. Channel 은 건 웹뷰의 콜백 하나에만 간다 — 원격 라벨의 Channel 은 `remote::bridge::channel_interceptor` 가 가로채 **그 연결의
//!   ws 로만** 보낸다(새 길 없음 — 프로듀서 채팅과 같다).
//! - 창이 없거나(파괴) 통로를 걸지 않았으면 버린다 — 빈틈은 `seq` 로 프런트가 알아채 다시 attach 한다(서버의 broadcast 도 빠질 수 있다).
//!   창이 부서지면(원격 ws 끝 포함) `server::proxy::close_window` 가 [`forget_window`] 로 그 통로를 걷고, 서버는 `close_window` 에서 그 창을 뗀다.
//! - **창마다 통로 하나**(라벨 열쇠 — 다시 걸면 갈음). F5 의 새 페이지는 같은 라벨로 갈음하므로 `detach_window` 에서는 통로를 걷지 않는다.
//! - **로그**: 몸(사람 글 · 모델 답 · 도구 출력)은 어디에도 남기지 않는다 — 실패도 창 라벨까지만.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::SIDE_CHAT_VIEWERS_PROTOCOL;
use super::ipc::Grade;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 집 PC 의 주 창 라벨.
pub(crate) const MAIN_WINDOW: &str = "main";
/// 사람 창(주 창 · 원격 창)이 아닌 창의 호출 거절 이유 — 낱말은 옛 이름 그대로(프런트가 이 낱말로 가른다).
pub(crate) const MAIN_WINDOW_ONLY: &str = "main-window-only";

/// `side_chat_send` 의 응답 상한 — 서버가 프로세스를 띄우고 준비를 `turn::START_MS` 까지 기다린다(+ `SPAWN_LOCK` 줄서기 여유).
pub(crate) fn send_timeout() -> Duration {
    Duration::from_millis(crate::orchestration::turn::START_MS) + Duration::from_secs(30)
}

/// 사이드 채팅을 쓰는 창인가 — **순수**. 집 PC 주 창 · 원격 웹 창(`remote::is_remote_label`)만(보조 · 떼어 낸 창은 아니다).
pub(crate) fn is_human_window(label: &str) -> bool {
    label == MAIN_WINDOW || crate::remote::is_remote_label(label)
}

/// 사람 창만 — 순수.
pub(crate) fn human_window(label: &str) -> Result<(), String> {
    if is_human_window(label) {
        return Ok(());
    }
    Err(with_reason(
        MAIN_WINDOW_ONLY,
        tr!(
            ko: "사이드 채팅은 주 창 · 원격 창의 독에서만 쓸 수 있습니다",
            en: "Side chat is only available from the dock in the main window or the remote client"
        ),
    ))
}

/// 판 21 미만 서버면 보내지 않는다(서버도 받을 때 다시 본다 — 보는 창 여럿의 뜻을 옛 서버와 섞지 않는다).
fn check_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < SIDE_CHAT_VIEWERS_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 사이드 채팅을 열 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run side chats — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 부른 창을 확인하고(사람 창 · 서버 판) 그 라벨을 돌려준다.
fn caller(webview: &tauri::Webview) -> Result<String, String> {
    let label = webview.window().label().to_string();
    human_window(&label)?;
    check_protocol()?;
    Ok(label)
}

async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    client::request(kind, op, body).await.map_err(wire_message)
}

/// 채팅을 연다 — **띄우지 않는다**(뜻만 적고 임대를 이 창으로). `mode` = `{kind: fresh}` · `{kind: resume, conv, project?}` ·
/// `{kind: fork, from}`(타일 대화 이어 가기 — 6단계: 경로는 받지 않고 서버가 대화 색인의 기록된 cwd 로 정한다 · `server::side_chat` 머리말).
/// 같은 채팅 · 같은 CLI 면 서버가 다시 붙인다.
#[tauri::command]
pub async fn side_chat_open(
    webview: tauri::Webview,
    chat: String,
    cli: String,
    model: String,
    effort: Option<String>,
    mode: Value,
) -> Result<Value, String> {
    let window = caller(&webview)?;
    call(
        Grade::Write,
        "side_chat_open",
        json!({ "chat": chat, "cli": cli, "model": model, "effort": effort, "mode": mode, "window": window }),
    )
    .await
}

/// **사람이 보낸 글** — 프로세스가 없으면 서버가 여기서 띄우고 준비를 기다린다(그래서 시한이 길다 — [`send_timeout`]).
#[tauri::command]
pub async fn side_chat_send(
    webview: tauri::Webview,
    chat: String,
    epoch: u64,
    text: String,
    client_id: Option<String>,
    link_name: Option<String>,
    images: Option<Vec<String>>,
) -> Result<Value, String> {
    caller(&webview)?;
    client::request_timed(
        Grade::Write,
        "side_chat_send",
        json!({ "chat": chat, "epoch": epoch, "text": text, "clientId": client_id, "linkName": link_name, "images": images.unwrap_or_default() }),
        send_timeout(),
    )
    .await
    .map_err(wire_message)
}

/// 도는 턴을 끊는다(없으면 false).
#[tauri::command]
pub async fn side_chat_interrupt(webview: tauri::Webview, chat: String, epoch: u64) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_interrupt", json!({ "chat": chat, "epoch": epoch })).await
}

/// 모델 바꾸기 — 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다).
#[tauri::command]
pub async fn side_chat_set_model(webview: tauri::Webview, chat: String, epoch: u64, model: String) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_set_model", json!({ "chat": chat, "epoch": epoch, "model": model })).await
}

/// 추론 강도 바꾸기(`effort` 없음 = CLI 기본) — 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다). 다시 띄우지 않는다.
#[tauri::command]
pub async fn side_chat_set_effort(webview: tauri::Webview, chat: String, epoch: u64, effort: Option<String>) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_set_effort", json!({ "chat": chat, "epoch": epoch, "effort": effort })).await
}

/// **사람의 권한 결정**([허용 한 번] · [거절] — `decision` = `allow` · `deny`). 쓰기 등급이다 — 승인 등급 프레임은 `ops_approve` 하나뿐
/// (`client::request` 가 승인 등급을 거부한다). MCP 에는 이 길이 없다(시험 `side_chat_stdin_only_human`).
#[tauri::command]
pub async fn side_chat_decide(
    webview: tauri::Webview,
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    message: Option<String>,
) -> Result<Value, String> {
    caller(&webview)?;
    call(
        Grade::Write,
        "side_chat_decide",
        json!({ "chat": chat, "epoch": epoch, "requestId": request_id, "decision": decision, "message": message }),
    )
    .await
}

/// 닫는다(표에서 빼고 프로세스를 잡째 끝낸다) — 표에 있었나.
#[tauri::command]
pub async fn side_chat_close(webview: tauri::Webview, chat: String) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_close", json!({ "chat": chat })).await
}

/// 스냅숏 + 이 창을 보는 창에 덧붙이기(F5 · 웹뷰 크래시 뒤 새 페이지 · 다른 창 · `seq` 빈틈). 표에 없으면 `[session-gone]`.
#[tauri::command]
pub async fn side_chat_attach(webview: tauri::Webview, chat: String) -> Result<Value, String> {
    let window = caller(&webview)?;
    call(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": window })).await
}

/// **연결 칩**(5단계) — 그 채팅이 MCP 로 읽을 타일을 사람이 고른다(`stream` = 타일의 `historyStreamId` · 없음 = 끊기). 서버가 거울에
/// 있는 창 타일인지 다시 보고(`[bad-link]`), 바뀌었으면 다음 보내기에 앱 고정 연결 머리글을 붙인다. 읽기 판정은 MCP 호출마다 서버가.
#[tauri::command]
pub async fn side_chat_link(webview: tauri::Webview, chat: String, epoch: Option<u64>, stream: Option<String>) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_link", json!({ "chat": chat, "epoch": epoch, "stream": stream })).await
}

/// 서버 표의 채팅들(`[{chat, cli, model, effort, epoch, status, conversationId, viewers, detached}]`).
#[tauri::command]
pub async fn side_chat_list(webview: tauri::Webview) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Read, "side_chat_list", json!({})).await
}

// ---------------------------------------------------------------------------
// 사건 통로(머리말 "사건 중계는 방송하지 않는다")
// ---------------------------------------------------------------------------

/// 창 라벨 → 그 창이 건 통로(창마다 하나 — 다시 걸면 갈음한다).
static CHANNELS: LazyLock<Mutex<HashMap<String, Channel<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn channels() -> std::sync::MutexGuard<'static, HashMap<String, Channel<Value>>> {
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner())
}

/// 이 창의 사이드 채팅 사건 통로를 건다(페이지가 뜰 때마다 한 번 — F5 · 크래시 재부착은 새 통로로 갈음). 사람 창만(주 창 · 원격 창).
#[tauri::command]
pub async fn side_chat_subscribe(webview: tauri::Webview, channel: Channel<Value>) -> Result<(), String> {
    let label = webview.window().label().to_string();
    human_window(&label)?;
    channels().insert(label, channel);
    Ok(())
}

/// 사건을 받을 창들 — **순수**. 몸의 `windows`(그 채팅을 보는 창 — 서버 표) 가운데 사람 창이고, 살아 있고(`alive`), 통로를 건(`subscribed`)
/// 라벨만(같은 라벨은 한 번). 그 밖(빈 라벨 · 보조 창 · 없는 창 · 몸에 없는 창)은 버린다. 방송 갈래는 없다.
pub(crate) fn route(body: &Value, alive: impl Fn(&str) -> bool, subscribed: impl Fn(&str) -> bool) -> Vec<String> {
    let Some(ws) = body.get("windows").and_then(Value::as_array) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for w in ws.iter().filter_map(Value::as_str) {
        if is_human_window(w) && alive(w) && subscribed(w) && !out.iter().any(|o| o == w) {
            out.push(w.to_string());
        }
    }
    out
}

/// [`route`] 가 고른 통로에 보낸다 — **순수 · 시험용 일반형**. 보내기가 실패한 통로(죽은 페이지)는 그 창 것만 걷는다(다른 창은 그대로).
fn deliver<T>(chs: &mut HashMap<String, T>, body: &Value, alive: impl Fn(&str) -> bool, send: impl Fn(&T, &Value) -> bool) {
    for w in route(body, alive, |l| chs.contains_key(l)) {
        if !chs.get(&w).is_some_and(|c| send(c, body)) {
            // 죽은 통로(페이지가 사라짐) — 걷는다. 다음 페이지가 다시 건다.
            chs.remove(&w);
        }
    }
}

/// 서버 이벤트 `side-chat-event` — [`route`] 가 고른 창들의 통로에만 보낸다(`client::on_event`). 사라진 창의 통로는 먼저 걷는다. 몸은
/// 로그에 남기지 않는다.
pub(crate) fn on_event(app: &tauri::AppHandle, body: &Value) {
    let mut chs = channels();
    chs.retain(|w, _| app.get_webview_window(w).is_some());
    deliver(&mut chs, body, |l| app.get_webview_window(l).is_some(), |c, b| c.send(b.clone()).is_ok());
}

/// **창이 부서진다**(원격 창의 ws 끝 포함 — `server::proxy::close_window`) — 그 창의 통로를 걷는다. F5 · 크래시(`detach_window`)는 새
/// 페이지가 같은 라벨로 갈음하므로 부르지 않는다.
pub(crate) fn forget_window(label: &str) {
    channels().remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(windows: &[&str]) -> Value {
        json!({ "windows": windows, "chat": "c1", "epoch": 1, "seq": 3, "ev": { "t": "text", "item": null, "text": "본문" } })
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// 몸의 `windows` 가운데 사람 창 · 산 창 · 통로를 건 창에만(같은 라벨은 한 번) — 방송 없음.
    #[test]
    fn route_targets_the_viewing_human_windows() {
        let all = |_: &str| true;
        assert_eq!(route(&ev(&["main"]), all, all), s(&["main"]));
        assert_eq!(route(&ev(&["main", "remote-dev1-2"]), all, all), s(&["main", "remote-dev1-2"]));
        assert_eq!(route(&ev(&["remote-dev1-2", "remote-dev1-2"]), all, all), s(&["remote-dev1-2"]));
        // 보조 · 떼어 낸 창 · 빈 라벨 — 몸에 실려 와도 버린다.
        assert_eq!(route(&ev(&["aux-1", "tear-3", "", "main"]), all, all), s(&["main"]));
        // 창이 없거나 통로를 걸지 않은 창은 버린다(다른 창은 그대로).
        assert_eq!(route(&ev(&["main", "remote-a-1"]), |l| l != "main", all), s(&["remote-a-1"]));
        assert_eq!(route(&ev(&["main", "remote-a-1"]), all, |l| l == "main"), s(&["main"]));
        // 몸에 창 목록이 없거나(옛 `window` 하나 포함) 모양이 틀리면 버린다.
        assert!(route(&json!({ "chat": "c1" }), all, all).is_empty());
        assert!(route(&json!({ "window": "main" }), all, all).is_empty());
        assert!(route(&json!({ "windows": [1, null] }), all, all).is_empty());
    }

    /// 보내기가 실패한 통로만 걷힌다 — 같은 사건은 다른 창에 그대로 간다 · 몸에 없는 창(같은 채팅을 안 보는 원격 창)에는 가지 않는다.
    #[test]
    fn deliver_drops_only_the_dead_channel() {
        use std::cell::RefCell;
        let mut chs: HashMap<String, &str> = HashMap::new();
        chs.insert("main".into(), "main");
        chs.insert("remote-a-1".into(), "dead");
        chs.insert("remote-b-1".into(), "other");
        let got = RefCell::new(Vec::new());
        let send = |c: &&str, _: &Value| {
            got.borrow_mut().push(c.to_string());
            *c != "dead"
        };
        deliver(&mut chs, &ev(&["main", "remote-a-1"]), |_| true, send);
        let mut sent = got.borrow().clone();
        sent.sort();
        assert_eq!(sent, ["dead", "main"], "remote-b-1 은 이 채팅을 보지 않는다");
        assert!(!chs.contains_key("remote-a-1") && chs.contains_key("main") && chs.contains_key("remote-b-1"));
    }

    /// 사람 창(주 창 · 원격 웹 창)만 부를 수 있다 — 보조 · 떼어 낸 창은 거절.
    #[test]
    fn only_human_windows_may_call() {
        for w in ["main", "remote-x", "remote-dev1-3"] {
            assert!(human_window(w).is_ok(), "{w}");
        }
        for w in ["aux-1", "tear-2", "Main", "", "xremote-1"] {
            let e = human_window(w).unwrap_err();
            assert!(e.starts_with("[main-window-only] "), "{w}: {e}");
        }
        // 창 파괴 길(`server::proxy::close_window`)이 그 창의 통로를 걷는다.
        let proxy = include_str!("proxy.rs");
        assert!(proxy.contains("super::side_chat_proxy::forget_window(label);"));
    }

    /// 명령은 모두 `async fn` · 창 라벨은 웹뷰에서 · 등급은 서버 표와 같다 · 승인 등급 없음 · 방송 없음(소스 훑기).
    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        // 체크아웃이 CRLF 일 수 있다(autocrlf) — 줄바꿈을 낀 문자열로 찾으므로 LF 로 맞춘다.
        let src = include_str!("side_chat_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        for (op, grade) in [
            ("side_chat_open", "Grade::Write"),
            ("side_chat_send", "Grade::Write"),
            ("side_chat_interrupt", "Grade::Write"),
            ("side_chat_set_model", "Grade::Write"),
            ("side_chat_set_effort", "Grade::Write"),
            ("side_chat_decide", "Grade::Write"),
            ("side_chat_close", "Grade::Write"),
            ("side_chat_attach", "Grade::Read"),
            ("side_chat_list", "Grade::Read"),
            ("side_chat_link", "Grade::Write"),
        ] {
            assert!(src.contains(&format!("pub async fn {op}(webview: tauri::Webview")) || src.contains(&format!("pub async fn {op}(\n    webview: tauri::Webview")), "{op}");
            assert!(src.contains(&format!("{grade},\n        \"{op}\"")) || src.contains(&format!("{grade}, \"{op}\"")), "{op} 등급");
            let want = if grade == "Grade::Read" { super::super::ipc::Grade::Read } else { super::super::ipc::Grade::Write };
            assert_eq!(frame::required_grade(op), Some(want), "{op}");
        }
        assert!(!src.contains("Grade::Approve") && !src.contains("request_approve"));
        // 프런트가 준 창 이름을 받는 인자가 없다.
        assert!(!src.contains("window: String"));
        // 방송 · 전역 이벤트로 내보내지 않는다.
        for bad in ["emit(", "emit_to(", "emit_filter(", "eprintln!", "log::"] {
            assert!(!src.contains(bad), "{bad}");
        }
        // GUI 중계 표(`RELAYED`)에 이 이벤트가 없다 — `client.rs` 가 따로 이 파일의 `on_event` 로 넘긴다.
        let client = include_str!("client.rs");
        let relayed = &client[client.find("const RELAYED").unwrap()..];
        let relayed = &relayed[..relayed.find("];").unwrap()];
        assert!(!relayed.contains("side_chat"), "RELAYED 에 사이드 채팅 사건");
        assert!(client.contains("n if n == super::side_chat::EVENT => super::side_chat_proxy::on_event(app, body)"));
    }
}
