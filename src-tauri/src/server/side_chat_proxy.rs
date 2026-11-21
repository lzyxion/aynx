//! GUI 쪽 사이드 채팅 껍데기 — 프로세스 표 · stdin · 어댑터는 세션 서버(`server::side_chat`)에 살고, 여기는 같은 이름의 Tauri 명령과 사건 중계뿐이다.
//!
//! - 창 이름은 GUI 가 채운다(부른 웹뷰의 라벨 — 프런트 값을 받지 않는다). 사람 창(메인 PC 주 창 · 원격 웹 창)만 부를 수 있고 보조 · 떼어 낸 창은
//!   `[main-window-only]` 로 거절한다. 원격 관문에서 `side_chat_*` 는 모두 ALLOW 다(원격 창은 이미 셸에 칠 수 있다 · `side_chat_decide` 도 재확인 없음).
//! - 사건 중계는 방송하지 않는다 — 몸에 대화 본문이 있어 `client::RELAYED` 에 넣지 않고, 그 채팅을 보는 사람 창의 Tauri `Channel` 에만 보낸다.
//!   `emit_to` 를 쓰지 않는 까닭: Tauri 2 의 `emit_to` 는 대상 `Any` 리스너(전역 `listen` · 원격 관문의 `listen_any`)에도 닿아 다른 창이 본문을 받는다.
//! - F5 의 새 페이지는 같은 라벨로 통로를 갈음하므로 `detach_window` 에서는 통로를 걷지 않는다 — 창 파괴 때만 걷는다.
//! - 몸(사람 글 · 모델 답 · 도구 출력)은 어디에도 로그로 남기지 않는다.
//! - 판 32 이하 서버(여러 타일 연결 전)에 붙으면 여기서 옛 모양 ↔ 새 모양을 옮긴다 — 프런트는 늘 새 모양만 본다.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::{
    SIDE_CHAT_FILES_PROTOCOL, SIDE_CHAT_LINKS_PROTOCOL, SIDE_CHAT_PERM_PROTOCOL, SIDE_CHAT_SEEN_PROTOCOL, SIDE_CHAT_VIEWERS_PROTOCOL,
};
use super::ipc::Grade;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 메인 PC 의 주 창 라벨.
pub(crate) const MAIN_WINDOW: &str = "main";
/// 낱말은 옛 이름 그대로다 — 프런트가 이 낱말로 가른다.
pub(crate) const MAIN_WINDOW_ONLY: &str = "main-window-only";

/// 서버가 프로세스를 띄우고 준비를 `turn::START_MS` 까지 기다린다(+ `SPAWN_LOCK` 줄서기 여유).
pub(crate) fn send_timeout() -> Duration {
    Duration::from_millis(crate::orchestration::turn::START_MS) + Duration::from_secs(30)
}

pub(crate) fn is_human_window(label: &str) -> bool {
    label == MAIN_WINDOW || crate::remote::is_remote_label(label)
}

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

/// 보는 창 여럿의 뜻을 옛 서버와 섞지 않는다.
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

fn caller(webview: &tauri::Webview) -> Result<String, String> {
    let label = webview.window().label().to_string();
    human_window(&label)?;
    check_protocol()?;
    Ok(label)
}

async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    client::request(kind, op, body).await.map_err(wire_message)
}

fn links_outdated() -> bool {
    client::negotiated_protocol().is_some_and(|p| p < SIDE_CHAT_LINKS_PROTOCOL)
}

/// 옛 판 서버의 `link`(하나 | `null`) → `links`(0~1칸).
pub(crate) fn links_from_old(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        if !o.contains_key("links") {
            let one = o.remove("link").unwrap_or(Value::Null);
            o.insert("links".into(), if one.is_null() { json!([]) } else { json!([one]) });
        }
    }
    v
}

/// 옛 판 서버의 보내기 답 `link: null | {label} | {unlinked: true}` → `null | {labels, unlinked}`.
pub(crate) fn note_from_old(mut v: Value) -> Value {
    if let Some(l) = v.get_mut("link") {
        if let Some(o) = l.as_object().filter(|o| !o.contains_key("labels")) {
            let unlinked = o.get("unlinked").and_then(Value::as_bool).unwrap_or(false);
            let label = o.get("label").and_then(Value::as_str).filter(|_| !unlinked);
            *l = json!({ "labels": label.into_iter().collect::<Vec<_>>(), "unlinked": unlinked });
        }
    }
    v
}

/// 옛 판 서버의 `linkName` — 칩 이름이 하나뿐일 때만.
pub(crate) fn old_link_name(names: Option<&HashMap<String, String>>) -> Option<String> {
    let names = names?;
    (names.len() == 1).then(|| names.values().next().cloned()).flatten()
}

/// 서버 `side_chat::dedup_streams` 와 같은 규칙이어야 한다.
fn dedup(streams: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(streams.len());
    for s in streams {
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// 띄우지 않는다 — 프로세스는 첫 보내기 때 선다. `fork` 는 경로를 받지 않는다(서버가 대화 색인의 기록된 cwd 로 정한다).
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
    let snap = call(
        Grade::Write,
        "side_chat_open",
        json!({ "chat": chat, "cli": cli, "model": model, "effort": effort, "mode": mode, "window": window }),
    )
    .await?;
    Ok(if links_outdated() { links_from_old(snap) } else { snap })
}

/// 사람이 보낸 글 — 프로세스가 없으면 서버가 여기서 띄우고 준비를 기다린다(그래서 시한이 길다).
// Tauri 명령 인자는 프런트 `invoke` 의 칸 이름 그대로라 묶지 않는다
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn side_chat_send(
    webview: tauri::Webview,
    chat: String,
    epoch: u64,
    text: String,
    client_id: Option<String>,
    link_names: Option<HashMap<String, String>>,
    images: Option<Vec<String>>,
    files: Option<Vec<String>>,
) -> Result<Value, String> {
    caller(&webview)?;
    let files = files.unwrap_or_default();
    // 옛 판 서버는 `files` 를 버린다 — 사람이 붙인 파일이 소리 없이 빠지지 않게 보내지 않는다
    if !files.is_empty() && client::negotiated_protocol().is_some_and(|p| p < SIDE_CHAT_FILES_PROTOCOL) {
        return Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 파일을 붙일 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot take attached files — restart it in Settings › Session server (open shell sessions will close)"
            ),
        ));
    }
    let images = images.unwrap_or_default();
    let old = links_outdated();
    let body = if old {
        let link_name = old_link_name(link_names.as_ref());
        json!({ "chat": chat, "epoch": epoch, "text": text, "clientId": client_id, "linkName": link_name, "images": images, "files": files })
    } else {
        json!({ "chat": chat, "epoch": epoch, "text": text, "clientId": client_id, "linkNames": link_names, "images": images, "files": files })
    };
    let r = client::request_timed(Grade::Write, "side_chat_send", body, send_timeout()).await.map_err(wire_message)?;
    Ok(if old { note_from_old(r) } else { r })
}

/// 완료 확인 공유 — 이 창에서 사람이 그 채팅의 턴 끝을 봤다. 옛 판 서버면 조용히 보내지 않는다.
#[tauri::command]
pub async fn side_chat_seen(webview: tauri::Webview, chat: String, epoch: u64, seq: u64) -> Result<Value, String> {
    caller(&webview)?;
    if client::negotiated_protocol().is_some_and(|p| p < SIDE_CHAT_SEEN_PROTOCOL) {
        return Ok(json!({ "sent": false }));
    }
    call(Grade::Write, "side_chat_seen", json!({ "chat": chat, "epoch": epoch, "seq": seq })).await
}

#[tauri::command]
pub async fn side_chat_interrupt(webview: tauri::Webview, chat: String, epoch: u64) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_interrupt", json!({ "chat": chat, "epoch": epoch })).await
}

#[tauri::command]
pub async fn side_chat_set_model(webview: tauri::Webview, chat: String, epoch: u64, model: String) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_set_model", json!({ "chat": chat, "epoch": epoch, "model": model })).await
}

/// `effort` 없음 = CLI 기본.
#[tauri::command]
pub async fn side_chat_set_effort(webview: tauri::Webview, chat: String, epoch: u64, effort: Option<String>) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_set_effort", json!({ "chat": chat, "epoch": epoch, "effort": effort })).await
}

/// 사람의 권한 결정 — `remember` 의 종류는 서버가 기다리는 요청에서 읽는다(프런트 값을 받지 않는다). 쓰기 등급이다 — 승인 등급 프레임은
/// `ops_approve` 하나뿐. MCP 에는 이 길이 없다(시험 `side_chat_stdin_only_human`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn side_chat_decide(
    webview: tauri::Webview,
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    message: Option<String>,
    remember: Option<bool>,
) -> Result<Value, String> {
    caller(&webview)?;
    let remember = remember.unwrap_or(false);
    if remember {
        check_perm_protocol()?;
    }
    call(
        Grade::Write,
        "side_chat_decide",
        json!({ "chat": chat, "epoch": epoch, "requestId": request_id, "decision": decision, "message": message, "remember": remember }),
    )
    .await
}

/// 옛 판 서버면 권한 모드 op · `remember` 를 보내지 않는다 — 사람이 고른 것이 소리 없이 빠지지 않게.
fn check_perm_protocol() -> Result<(), String> {
    if client::negotiated_protocol().is_some_and(|p| p < SIDE_CHAT_PERM_PROTOCOL) {
        return Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 사이드 채팅 권한 모드를 바꿀 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot change a side chat's permission mode — restart it in Settings › Session server (open shell sessions will close)"
            ),
        ));
    }
    Ok(())
}

/// 채팅의 권한 모드(`manual` · `auto`) — 사람이 모드 칩에서 고른다. Auto 면 기다리는 카드도 허용으로 답한다. MCP 에는 이 길이 없다.
#[tauri::command]
pub async fn side_chat_set_perm_mode(webview: tauri::Webview, chat: String, mode: String) -> Result<Value, String> {
    caller(&webview)?;
    check_perm_protocol()?;
    call(Grade::Write, "side_chat_set_perm_mode", json!({ "chat": chat, "mode": mode })).await
}

/// 허용 목록에서 빼기만 한다.
#[tauri::command]
pub async fn side_chat_forget_allow(webview: tauri::Webview, chat: String, kind: String) -> Result<Value, String> {
    caller(&webview)?;
    check_perm_protocol()?;
    call(Grade::Write, "side_chat_forget_allow", json!({ "chat": chat, "kind": kind })).await
}

#[tauri::command]
pub async fn side_chat_close(webview: tauri::Webview, chat: String) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Write, "side_chat_close", json!({ "chat": chat })).await
}

#[tauri::command]
pub async fn side_chat_attach(webview: tauri::Webview, chat: String) -> Result<Value, String> {
    let window = caller(&webview)?;
    let snap = call(Grade::Read, "side_chat_attach", json!({ "chat": chat, "window": window })).await?;
    Ok(if links_outdated() { links_from_old(snap) } else { snap })
}

/// 연결 칩 — 그 채팅이 MCP 로 읽을 타일들을 사람이 고른다(연결 묶음 통째로 · 빈 배열 = 모두 끊기). 이 길이 연결을 바꾸는 하나뿐이고,
/// 읽기 판정은 MCP 호출마다 서버가 한다.
#[tauri::command]
pub async fn side_chat_link(webview: tauri::Webview, chat: String, epoch: Option<u64>, streams: Vec<String>) -> Result<Value, String> {
    caller(&webview)?;
    if !links_outdated() {
        return call(Grade::Write, "side_chat_link", json!({ "chat": chat, "epoch": epoch, "streams": streams })).await;
    }
    let streams = dedup(streams);
    if streams.len() > 1 {
        return Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 타일을 여러 개 연결할 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot link more than one tile — restart it in Settings › Session server (open shell sessions will close)"
            ),
        ));
    }
    let r = call(Grade::Write, "side_chat_link", json!({ "chat": chat, "epoch": epoch, "stream": streams.first() })).await?;
    Ok(links_from_old(r))
}

#[tauri::command]
pub async fn side_chat_list(webview: tauri::Webview) -> Result<Value, String> {
    caller(&webview)?;
    call(Grade::Read, "side_chat_list", json!({})).await
}

// ---------------------------------------------------------------------------
// 사건 통로
// ---------------------------------------------------------------------------

static CHANNELS: LazyLock<Mutex<HashMap<String, Channel<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn channels() -> std::sync::MutexGuard<'static, HashMap<String, Channel<Value>>> {
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
pub async fn side_chat_subscribe(webview: tauri::Webview, channel: Channel<Value>) -> Result<(), String> {
    let label = webview.window().label().to_string();
    human_window(&label)?;
    channels().insert(label, channel);
    Ok(())
}

/// 방송 갈래는 없다 — 몸에 없는 창 · 보조 창에는 가지 않는다.
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

fn deliver<T>(chs: &mut HashMap<String, T>, body: &Value, alive: impl Fn(&str) -> bool, send: impl Fn(&T, &Value) -> bool) {
    for w in route(body, alive, |l| chs.contains_key(l)) {
        if !chs.get(&w).is_some_and(|c| send(c, body)) {
            chs.remove(&w);
        }
    }
}

/// 몸은 로그에 남기지 않는다.
pub(crate) fn on_event(app: &tauri::AppHandle, body: &Value) {
    let mut chs = channels();
    chs.retain(|w, _| app.get_webview_window(w).is_some());
    deliver(&mut chs, body, |l| app.get_webview_window(l).is_some(), |c, b| c.send(b.clone()).is_ok());
}

/// 창 파괴 때만 — F5 · 크래시는 새 페이지가 같은 라벨로 갈음하므로 부르지 않는다.
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

    #[test]
    fn old_server_link_shapes_become_new() {
        let view = json!({ "stream": "s1", "code": "p1", "label": "pwsh", "kind": "local", "readable": true, "closed": false });
        assert_eq!(links_from_old(json!({ "link": view, "chat": "c1" })), json!({ "links": [view], "chat": "c1" }));
        assert_eq!(links_from_old(json!({ "link": null, "changed": true })), json!({ "links": [], "changed": true }));
        assert_eq!(links_from_old(json!({ "changed": false })), json!({ "links": [], "changed": false }));
        assert_eq!(links_from_old(json!({ "links": [view] })), json!({ "links": [view] }));
        assert_eq!(note_from_old(json!({ "epoch": 3, "link": null })), json!({ "epoch": 3, "link": null }));
        assert_eq!(note_from_old(json!({ "epoch": 3, "link": { "label": "pwsh" } }))["link"], json!({ "labels": ["pwsh"], "unlinked": false }));
        assert_eq!(note_from_old(json!({ "epoch": 3, "link": { "label": "" } }))["link"], json!({ "labels": [""], "unlinked": false }));
        assert_eq!(note_from_old(json!({ "epoch": 3, "link": { "unlinked": true } }))["link"], json!({ "labels": [], "unlinked": true }));
        let new = json!({ "epoch": 3, "link": { "labels": ["a", "b"], "unlinked": false } });
        assert_eq!(note_from_old(new.clone()), new);
        let names = |x: &[(&str, &str)]| x.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>();
        assert_eq!(old_link_name(None), None);
        assert_eq!(old_link_name(Some(&names(&[]))), None);
        assert_eq!(old_link_name(Some(&names(&[("s1", "pwsh")]))).as_deref(), Some("pwsh"));
        assert_eq!(old_link_name(Some(&names(&[("s1", "a"), ("s2", "b")]))), None);
        assert_eq!(dedup(vec!["a".into(), "b".into(), "a".into()]), vec!["a".to_string(), "b".to_string()]);
    }

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

    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        // 체크아웃이 CRLF 일 수 있다 — 줄바꿈을 낀 문자열로 찾으므로 LF 로 맞춘다
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
            ("side_chat_seen", "Grade::Write"),
            ("side_chat_set_perm_mode", "Grade::Write"),
            ("side_chat_forget_allow", "Grade::Write"),
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
        // 완료 확인(`side_chat::SEEN_EVENT` — 몸이 채팅 id · 세대 · 번호뿐)만 예외로 방송한다.
        assert!(!relayed.replace("super::side_chat::SEEN_EVENT", "").contains("side_chat"), "RELAYED 에 사이드 채팅 사건");
        assert!(relayed.contains("super::side_chat::SEEN_EVENT"));
        assert!(client.contains("n if n == super::side_chat::EVENT => super::side_chat_proxy::on_event(app, body)"));
    }
}
