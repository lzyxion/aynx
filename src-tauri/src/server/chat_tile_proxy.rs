//! GUI 쪽 채팅 타일 껍데기 — 표 · stdin · 어댑터는 세션 서버(`server::chat_tile`)에 산다. 명령은 전부 `async fn` 이다.
//!
//! - **창 이름은 GUI 가 채운다** — 부른 웹뷰의 라벨이고 프런트가 준 값은 받지 않는다. 주 창 · 보조 창 · 원격 창 모두 부른다.
//!   열기의 책임 창은 이 PC 의 창만이다 — 원격 라벨이면 `null` 을 싣는다(그 항목은 보조 창 파괴로 닫히지 않고 닫기 · TTL 로만).
//! - **사건 중계는 방송하지 않는다**: `chat-tile-event` 는 몸에 대화 본문이 있어 `client::RELAYED` 에 넣지 않는다. 몸의 `subs` 가운데 이 GUI 가
//!   그 `(window, subGen)` 으로 **같은 채팅**의 통로를 쥔 것 · 창이 살아 있는 것에만 보낸다([`route`]).
//! - `chat_tile_decide` 는 **승인 등급이 아니다**(쓰기 등급).
//! - 서버 op `chat_tile_goal` 은 명령 둘로 부른다 — 정하기 · 이어 하기 `chat_tile_goal_start`(원격 창에서 재확인) · 멈춤 · 지우기 `chat_tile_goal_stop`.
//!   원격 분류(`remote/deny.rs`)가 명령 이름으로 갈리므로 낱말은 각 명령이 먼저 가른다.
//! - **로그**: 몸(사람 글)은 남기지 않는다. 이 파일은 MCP 자격 증명을 모른다(소스 훑기 시험이 지킨다).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::{
    CHAT_TILE_ATTACH_PROTOCOL, CHAT_TILE_EXTRA_PROTOCOL, CHAT_TILE_PERM_PROTOCOL, CHAT_TILE_PROTOCOL, CHAT_TILE_REWIND_PROTOCOL, CHAT_TILE_SLASH_PROTOCOL,
};
use super::ipc::Grade;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 판 38 미만 서버면 보내지 않는다(서버도 받을 때 다시 본다).
fn check_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < CHAT_TILE_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 모양 AI 타일을 열 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run chat tiles — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 40 미만이면 권한 모드 · 늘 허용 · 질문 답을 보내지 않는다 — 옛 서버는 `[bad-decision]` · 모르는 op 로 거절한다.
fn perm_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < CHAT_TILE_PERM_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 타일의 권한 모드 · 늘 허용 · 질문 답을 쓸 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot change chat tile permission modes or take allow-for-conversation and answers — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 41 미만이면 압축 op 를 보내지 않는다 — 옛 서버는 모르는 op 로 거절한다.
fn slash_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < CHAT_TILE_SLASH_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 타일의 맥락 압축을 쓸 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot compact chat tile conversations — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 42 미만이면 되감기 op 를 보내지 않는다 — 옛 서버는 모르는 op 로 거절한다.
fn rewind_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < CHAT_TILE_REWIND_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 타일을 되감을 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot rewind chat tiles — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// 판 43 미만이면 검토 · 목표 · 속도 · MCP 상태 op 를 보내지 않는다.
fn extra_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < CHAT_TILE_EXTRA_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 타일의 검토 · 목표 · 속도 · MCP 상태를 쓸 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot run chat tile reviews, goals, speed or MCP status — restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

async fn call(kind: Grade, op: &str, body: Value) -> Result<Value, String> {
    check_protocol()?;
    client::request(kind, op, body).await.map_err(wire_message)
}

/// **띄우지 않는다** — 첫 보내기가 띄운다. 옛 서버는 `permMode` · `tier` 를 버린다(모드 · 속도는 사용자 설정으로 뜬다 — 거절하지 않는다).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_tile_open(
    webview: tauri::Webview,
    chat: String,
    cli: String,
    model: String,
    effort: Option<String>,
    mode: Value,
    perm_mode: Option<String>,
    tier: Option<String>,
) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    let home = (!crate::remote::is_remote_label(&label)).then_some(label);
    call(
        Grade::Write,
        "chat_tile_open",
        json!({ "chat": chat, "cli": cli, "model": model, "effort": effort, "mode": mode, "window": home, "permMode": perm_mode, "tier": tier }),
    )
    .await
}

/// 프로세스가 없으면 서버가 여기서 띄우고 준비를 기다린다 — 그래서 시한이 길다. 첨부 경로는 서버가 다시 본다.
/// `skills` 는 이름만(경로는 서버의 어댑터가 제 목록에서 찾는다) — 옛 서버는 칸을 버려 글의 `$이름` 만 가니 판으로 막지 않는다.
#[tauri::command]
pub async fn chat_tile_send(
    chat: String,
    epoch: u64,
    text: String,
    client_id: String,
    images: Option<Vec<String>>,
    files: Option<Vec<String>>,
    skills: Option<Vec<String>>,
) -> Result<Value, String> {
    check_protocol()?;
    let images = images.unwrap_or_default();
    let files = files.unwrap_or_default();
    let skills = skills.unwrap_or_default();
    // 옛 서버는 칸을 버려 첨부 없이 글만 간다 — 보내지 않는다
    if (!images.is_empty() || !files.is_empty()) && client::negotiated_protocol().is_some_and(|p| p < CHAT_TILE_ATTACH_PROTOCOL) {
        return Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 채팅 타일에 파일을 붙일 수 없습니다 — 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot take files in chat tiles — restart it in Settings › Session server (open shell sessions will close)"
            ),
        ));
    }
    client::request_timed(
        Grade::Write,
        "chat_tile_send",
        json!({ "chat": chat, "epoch": epoch, "text": text, "clientId": client_id, "images": images, "files": files, "skills": skills }),
        super::side_chat_proxy::send_timeout(),
    )
    .await
    .map_err(wire_message)
}

#[tauri::command]
pub async fn chat_tile_interrupt(chat: String, epoch: u64) -> Result<Value, String> {
    call(Grade::Write, "chat_tile_interrupt", json!({ "chat": chat, "epoch": epoch })).await
}

#[tauri::command]
pub async fn chat_tile_set_model(chat: String, epoch: u64, model: String) -> Result<Value, String> {
    call(Grade::Write, "chat_tile_set_model", json!({ "chat": chat, "epoch": epoch, "model": model })).await
}

#[tauri::command]
pub async fn chat_tile_set_effort(chat: String, epoch: u64, effort: Option<String>) -> Result<Value, String> {
    call(Grade::Write, "chat_tile_set_effort", json!({ "chat": chat, "epoch": epoch, "effort": effort })).await
}

/// CLI 자신의 권한 모드(칩) — 고를 수 있는 값은 서버가 다시 본다.
#[tauri::command]
pub async fn chat_tile_set_perm_mode(chat: String, epoch: u64, mode: String) -> Result<Value, String> {
    check_protocol()?;
    perm_protocol()?;
    call(Grade::Write, "chat_tile_set_perm_mode", json!({ "chat": chat, "epoch": epoch, "mode": mode })).await
}

/// 사람의 권한 결정 — 그 자리의 카드에만(서버가 대신 답하는 길은 없다). 결정 낱말과 질문 답뿐 — 늘 허용이 실을 제안은 서버가 고른다.
#[tauri::command]
pub async fn chat_tile_decide(
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    message: Option<String>,
    answers: Option<Value>,
) -> Result<Value, String> {
    if decision != "allow" && decision != "deny" {
        perm_protocol()?;
    }
    call(
        Grade::Write,
        "chat_tile_decide",
        json!({ "chat": chat, "epoch": epoch, "requestId": request_id, "decision": decision, "message": message, "answers": answers }),
    )
    .await
}

/// 사람이 부른 맥락 압축 — 프로세스가 없으면 서버가 `[not-started]` 로 거절한다(띄우지 않는다).
#[tauri::command]
pub async fn chat_tile_compact(chat: String, epoch: u64, instructions: Option<String>) -> Result<Value, String> {
    check_protocol()?;
    slash_protocol()?;
    call(Grade::Write, "chat_tile_compact", json!({ "chat": chat, "epoch": epoch, "instructions": instructions })).await
}

/// 사람이 부른 되감기 — 미리 보기(`dry_run`) 뒤에만 서버가 실행을 받는다. 미리 보기는 프로세스가 없으면 같은 대화를 띄울 수 있어 시한이 보내기와 같다.
#[tauri::command]
pub async fn chat_tile_rewind(chat: String, epoch: u64, anchor: String, scope: String, dry_run: bool) -> Result<Value, String> {
    check_protocol()?;
    rewind_protocol()?;
    client::request_timed(
        Grade::Write,
        "chat_tile_rewind",
        json!({ "chat": chat, "epoch": epoch, "anchor": anchor, "scope": scope, "dryRun": dry_run }),
        super::side_chat_proxy::send_timeout(),
    )
    .await
    .map_err(wire_message)
}

/// 사람이 고른 Codex 검토 — 대상 꼴은 서버가 본다. 프로세스가 없으면 같은 대화를 띄울 수 있어 시한이 보내기와 같다.
#[tauri::command]
pub async fn chat_tile_review(chat: String, epoch: u64, target: Value) -> Result<Value, String> {
    check_protocol()?;
    extra_protocol()?;
    client::request_timed(
        Grade::Write,
        "chat_tile_review",
        json!({ "chat": chat, "epoch": epoch, "target": target }),
        super::side_chat_proxy::send_timeout(),
    )
    .await
    .map_err(wire_message)
}

/// 목표 정하기 · 이어 하기(`set` · `resume`) — 원격 창에서는 재확인 명령이다(`remote/deny.rs`). 멈춤 · 지우기는 [`chat_tile_goal_stop`].
#[tauri::command]
pub async fn chat_tile_goal_start(chat: String, epoch: u64, action: String, objective: Option<String>, token_budget: Option<u64>) -> Result<Value, String> {
    // 원격 분류가 명령 이름으로 갈리므로 낱말을 여기서 가른다 — 멈춤 명령으로 목표를 걸지 못하게
    if action != "set" && action != "resume" {
        return Err(with_reason("bad-goal", "this command only sets or resumes a goal".into()));
    }
    check_protocol()?;
    extra_protocol()?;
    client::request_timed(
        Grade::Write,
        "chat_tile_goal",
        json!({ "chat": chat, "epoch": epoch, "action": action, "objective": objective, "tokenBudget": token_budget }),
        super::side_chat_proxy::send_timeout(),
    )
    .await
    .map_err(wire_message)
}

/// 목표 멈춤 · 지우기 — 띄우지 않는다.
#[tauri::command]
pub async fn chat_tile_goal_stop(chat: String, epoch: u64, action: String) -> Result<Value, String> {
    if action != "pause" && action != "clear" {
        return Err(with_reason("bad-goal", "this command only pauses or clears a goal".into()));
    }
    extra_protocol()?;
    call(Grade::Write, "chat_tile_goal", json!({ "chat": chat, "epoch": epoch, "action": action })).await
}

/// 다음 턴부터의 Codex 속도 등급 — `null` = CLI 기본. 띄우지 않는다.
#[tauri::command]
pub async fn chat_tile_set_tier(chat: String, epoch: u64, tier: Option<String>) -> Result<Value, String> {
    extra_protocol()?;
    call(Grade::Write, "chat_tile_set_tier", json!({ "chat": chat, "epoch": epoch, "tier": tier })).await
}

/// 사람이 연 MCP 상태 풍선의 읽기 한 번 — 답은 사건 `mcpStatus` 로 온다.
#[tauri::command]
pub async fn chat_tile_mcp_status(chat: String, epoch: u64) -> Result<Value, String> {
    extra_protocol()?;
    call(Grade::Write, "chat_tile_mcp_status", json!({ "chat": chat, "epoch": epoch })).await
}

#[tauri::command]
pub async fn chat_tile_close(chat: String) -> Result<Value, String> {
    call(Grade::Write, "chat_tile_close", json!({ "chat": chat })).await
}

#[tauri::command]
pub async fn chat_tile_attach(chat: String) -> Result<Value, String> {
    call(Grade::Read, "chat_tile_attach", json!({ "chat": chat })).await
}

#[tauri::command]
pub async fn chat_tile_list() -> Result<Value, String> {
    call(Grade::Read, "chat_tile_list", json!({})).await
}

// ---------------------------------------------------------------------------
// 사건 구독 라우터(머리말 "사건 중계는 방송하지 않는다")
// ---------------------------------------------------------------------------

/// 같은 창 · 같은 채팅은 하나(다시 구독하면 갈음).
type Subs<T> = HashMap<(String, u64), (String, T)>;

static CHANNELS: LazyLock<Mutex<Subs<Channel<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn channels() -> std::sync::MutexGuard<'static, Subs<Channel<Value>>> {
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner())
}

fn register<T>(subs: &mut Subs<T>, window: &str, gen: u64, chat: &str, ch: T) {
    subs.retain(|(w, _), (c, _)| !(w == window && c == chat));
    subs.insert((window.to_string(), gen), (chat.to_string(), ch));
}

fn unregister<T>(subs: &mut Subs<T>, window: &str, gen: u64, chat: &str) -> bool {
    let key = (window.to_string(), gen);
    if subs.get(&key).is_some_and(|(c, _)| c == chat) {
        subs.remove(&key);
        return true;
    }
    false
}

/// 창 라벨은 웹뷰에서 읽는다.
#[tauri::command]
pub async fn chat_tile_subscribe(webview: tauri::Webview, chat: String, channel: Channel<Value>) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    let v = call(Grade::Write, "chat_tile_subscribe", json!({ "chat": chat, "window": label })).await?;
    let gen = v.get("subGen").and_then(Value::as_u64).ok_or_else(|| "bad chat tile subscribe reply".to_string())?;
    register(&mut channels(), &label, gen, &chat, channel);
    Ok(v)
}

/// 같은 `subGen` 만 — 늦은 정리가 새 구독을 지우지 않게.
#[tauri::command]
pub async fn chat_tile_unsubscribe(webview: tauri::Webview, chat: String, sub_gen: u64) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    unregister(&mut channels(), &label, sub_gen, &chat);
    call(Grade::Write, "chat_tile_unsubscribe", json!({ "chat": chat, "window": label, "subGen": sub_gen })).await
}

/// 방송 갈래는 없다 — 모양이 틀린 몸은 버린다.
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

/// 보내기가 실패한 통로는 **그 구독만** 걷고 돌려준다 — 부르는 쪽이 서버 구독도 같은 세대로 뗀다.
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

/// 몸은 로그에 남기지 않는다.
pub(crate) fn on_event(app: &tauri::AppHandle, body: &Value) {
    let dead = {
        let mut chs = channels();
        chs.retain(|(w, _), _| app.get_webview_window(w).is_some());
        deliver(&mut chs, body, |l| app.get_webview_window(l).is_some(), |ch, b| ch.send(b.clone()).is_ok())
    };
    for (window, gen, chat) in dead {
        tauri::async_runtime::spawn(async move {
            let _ = call(Grade::Write, "chat_tile_unsubscribe", json!({ "chat": chat, "window": window, "subGen": gen })).await;
        });
    }
}

/// 돌려준 `subGen` 들은 서버 op 몸 `chatTileSubs` 로 간다 — 서버는 **그 세대만** 지운다(같은 라벨의 새 페이지가 건 구독은 남는다).
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

    /// 본문은 그 채팅을 구독한 `(창, subGen)` 의 통로에만 간다(방송 없음) · 같은 창 · 같은 채팅의 다시 구독은 갈음 · 떼기는 같은 세대만 ·
    /// 실패한 통로는 그 구독만 걷힌다.
    #[test]
    fn chat_tile_subs_route() {
        use std::cell::RefCell;
        let mut subs: Subs<u8> = HashMap::new();
        register(&mut subs, "main", 4, "ct-a", 0);
        register(&mut subs, "aux-1", 5, "ct-a", 0);
        register(&mut subs, "main", 6, "ct-b", 0);
        let has = |w: &str, g: u64, c: &str| subs.get(&(w.to_string(), g)).is_some_and(|(chat, _)| chat == c);
        let all = |_: &str| true;
        assert_eq!(route(&ev("ct-a", &[("main", 4), ("aux-1", 5)]), all, has), vec![("main".to_string(), 4), ("aux-1".to_string(), 5)]);
        assert_eq!(route(&ev("ct-a", &[("main", 4)]), all, has), vec![("main".to_string(), 4)]);
        assert!(route(&ev("ct-a", &[("remote-x-1", 9)]), all, has).is_empty(), "이 GUI 가 통로를 쥐지 않은 창");
        assert!(route(&ev("ct-a", &[("main", 3)]), all, has).is_empty(), "옛 subGen");
        assert!(route(&ev("ct-a", &[("main", 6)]), all, has).is_empty(), "그 통로는 다른 채팅");
        assert!(route(&ev("ct-a", &[("main", 4)]), |_| false, has).is_empty(), "사라진 창");
        assert!(route(&json!({ "chat": "ct-a" }), all, has).is_empty());
        assert!(route(&json!({ "subs": [{ "window": "main", "subGen": 4 }] }), all, has).is_empty());
        assert!(route(&json!({ "chat": "ct-a", "subs": [{ "window": 1, "subGen": "4" }] }), all, has).is_empty());
        assert_eq!(route(&ev("ct-a", &[("main", 4), ("main", 4)]), all, has).len(), 1);

        let mut subs: Subs<&str> = HashMap::new();
        register(&mut subs, "main", 1, "ct-a", "old");
        register(&mut subs, "aux-1", 3, "ct-a", "aux");
        register(&mut subs, "main", 4, "ct-a", "new");
        register(&mut subs, "remote-a-1", 5, "ct-a", "slow");
        assert!(!subs.contains_key(&("main".to_string(), 1)), "리로드 뒤 새 구독이 옛 통로를 갈음");
        assert!(!unregister(&mut subs, "main", 1, "ct-a"), "옛 subGen 의 늦은 떼기");
        assert!(!unregister(&mut subs, "main", 4, "ct-b"), "다른 채팅 이름");
        let got = RefCell::new(Vec::new());
        let send = |ch: &&str, _: &Value| {
            got.borrow_mut().push(ch.to_string());
            *ch != "slow"
        };
        let dead = deliver(&mut subs, &ev("ct-a", &[("main", 4), ("aux-1", 3), ("remote-a-1", 5)]), |_| true, send);
        assert_eq!(dead, vec![("remote-a-1".to_string(), 5, "ct-a".to_string())]);
        assert!(!subs.contains_key(&("remote-a-1".to_string(), 5)) && subs.len() == 2);
        assert!(unregister(&mut subs, "main", 4, "ct-a"));
    }

    /// 창이 사라지거나 다시 뜰 때 그 라벨의 통로만 걷고 그 세대들을 돌려준다 — 창 op 몸은 그 세대를 싣는다(라벨만으로 지우지 않는다).
    #[test]
    fn chat_tile_take_window() {
        let mut subs: Subs<u8> = HashMap::new();
        register(&mut subs, "main", 5, "ct-a", 0);
        register(&mut subs, "main", 7, "ct-b", 0);
        register(&mut subs, "remote-x-1", 6, "ct-a", 0);
        assert_eq!(take_window_in(&mut subs, "main"), vec![5, 7]);
        assert_eq!(subs.len(), 1);
        register(&mut subs, "main", 9, "ct-a", 0);
        assert_eq!(take_window_in(&mut subs, "remote-x-1"), vec![6]);
        assert!(subs.contains_key(&("main".to_string(), 9)));
        assert!(take_window_in(&mut subs, "aux-3").is_empty());
        let proxy = include_str!("proxy.rs").replace("\r\n", "\n");
        assert_eq!(proxy.matches("let chat_tile_subs = super::chat_tile_proxy::take_window(label);").count(), 2);
        assert_eq!(proxy.matches("\"chatTileSubs\": chat_tile_subs").count(), 3);
        assert_eq!(proxy.matches("\"chatTiles\": held_chat").count(), 1, "창 파괴 몸에만 이관 중 목록");
        // 이관 중 목록은 사서함에서 — 창 파괴 거둠이 넘긴다 · 이관 받기는 책임 창을 옮긴다.
        let reap = include_str!("../reap.rs");
        assert!(reap.contains("held.chat_tiles.iter().cloned().collect(),"));
        let handoff = include_str!("../handoff.rs");
        assert!(handoff.contains("\"chatTiles\": chat_tiles"));
    }

    /// 첨부는 판 39 서버에만 — 옛 서버는 몸의 칸을 버려 글만 간다.
    #[test]
    fn chat_tile_send_attachments_need_protocol_39() {
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        let at = src.find("pub async fn chat_tile_send(").unwrap();
        let body = &src[at..];
        let body = &body[..body.find("\n}").unwrap()];
        assert!(body.contains("images: Option<Vec<String>>,") && body.contains("files: Option<Vec<String>>,"));
        assert!(body.contains("client::negotiated_protocol().is_some_and(|p| p < CHAT_TILE_ATTACH_PROTOCOL)"));
        assert!(body.contains("SERVER_OUTDATED"));
        assert!(body.contains("\"images\": images, \"files\": files"));
        assert!(body.find("check_protocol()?").unwrap() < body.find("CHAT_TILE_ATTACH_PROTOCOL").unwrap());
        assert!(!body.contains("window: String"));
        assert_eq!(super::super::ipc::frame::CHAT_TILE_ATTACH_PROTOCOL, 39);
    }

    /// 권한 모드 · 늘 허용 · 질문 답은 판 40 서버에만 — 옛 서버는 모르는 op · `[bad-decision]` 으로 거절한다. allow · deny 는 판을 보지 않는다.
    #[test]
    fn chat_tile_perm_ops_need_protocol_40() {
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        let body = |sig: &str| {
            let at = src.find(sig).unwrap();
            let b = &src[at..];
            b[..b.find("\n}").unwrap()].to_string()
        };
        let set = body("pub async fn chat_tile_set_perm_mode(");
        assert!(set.find("check_protocol()?").unwrap() < set.find("perm_protocol()?").unwrap());
        assert!(set.contains("chat: String, epoch: u64, mode: String"));
        let decide = body("pub async fn chat_tile_decide(");
        assert!(decide.contains("if decision != \"allow\" && decision != \"deny\" {\n        perm_protocol()?;\n    }"));
        assert!(decide.contains("answers: Option<Value>,"));
        let open = body("pub async fn chat_tile_open(");
        assert!(open.contains("perm_mode: Option<String>,") && open.contains("\"permMode\": perm_mode"));
        assert!(!open.contains("perm_protocol"), "옛 서버는 칸을 버린다 — 열기를 막지 않는다");
        let guard = body("fn perm_protocol(");
        assert!(guard.contains("p < CHAT_TILE_PERM_PROTOCOL") && guard.contains("SERVER_OUTDATED"));
        for b in [&set, &decide, &open] {
            assert!(!b.contains("window: String"));
        }
        assert_eq!(super::super::ipc::frame::CHAT_TILE_PERM_PROTOCOL, 40);
    }

    /// 압축 op 는 판 41 서버에만 · 보내기의 `skills` 는 판을 보지 않는다(옛 서버는 칸을 버리고 글의 `$이름` 만 간다).
    #[test]
    fn chat_tile_slash_ops_need_protocol_41() {
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        let body = |sig: &str| {
            let at = src.find(sig).unwrap();
            let b = &src[at..];
            b[..b.find("\n}").unwrap()].to_string()
        };
        let compact = body("pub async fn chat_tile_compact(");
        assert!(compact.contains("chat: String, epoch: u64, instructions: Option<String>"));
        assert!(compact.find("check_protocol()?").unwrap() < compact.find("slash_protocol()?").unwrap());
        assert!(compact.contains("\"chat_tile_compact\", json!({ \"chat\": chat, \"epoch\": epoch, \"instructions\": instructions })"));
        let send = body("pub async fn chat_tile_send(");
        assert!(send.contains("skills: Option<Vec<String>>,") && send.contains("\"skills\": skills"));
        assert!(!send.contains("slash_protocol") && !send.contains("CHAT_TILE_SLASH_PROTOCOL"));
        let guard = body("fn slash_protocol(");
        assert!(guard.contains("p < CHAT_TILE_SLASH_PROTOCOL") && guard.contains("SERVER_OUTDATED"));
        for b in [&compact, &send] {
            assert!(!b.contains("window: String"));
        }
        assert_eq!(super::super::ipc::frame::CHAT_TILE_SLASH_PROTOCOL, 41);
    }

    /// 되감기 op 는 판 42 서버에만 · 시한은 보내기와 같다(미리 보기가 띄울 수 있다) · 몸은 기준점 · 범위 · 미리 보기 여부뿐.
    #[test]
    fn chat_tile_rewind_needs_protocol_42() {
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        let body = |sig: &str| {
            let at = src.find(sig).unwrap();
            let b = &src[at..];
            b[..b.find("\n}").unwrap()].to_string()
        };
        let rewind = body("pub async fn chat_tile_rewind(");
        assert!(rewind.contains("chat: String, epoch: u64, anchor: String, scope: String, dry_run: bool"));
        assert!(rewind.find("check_protocol()?").unwrap() < rewind.find("rewind_protocol()?").unwrap());
        assert!(rewind.contains("super::side_chat_proxy::send_timeout()"));
        assert!(rewind.contains("json!({ \"chat\": chat, \"epoch\": epoch, \"anchor\": anchor, \"scope\": scope, \"dryRun\": dry_run })"));
        assert!(!rewind.contains("window: String"));
        let guard = body("fn rewind_protocol(");
        assert!(guard.contains("p < CHAT_TILE_REWIND_PROTOCOL") && guard.contains("SERVER_OUTDATED"));
        assert_eq!(super::super::ipc::frame::CHAT_TILE_REWIND_PROTOCOL, 42);
    }

    /// 검토 · 목표 · 속도 · MCP 상태는 판 43 서버에만 · 열기의 `tier` 는 판을 보지 않는다(옛 서버는 칸을 버린다) · 목표 명령 둘은 제 낱말만 넘긴다
    /// (원격 분류가 명령 이름으로 갈린다 — 멈춤 명령으로 목표를 걸지 못한다) · 검토 · 목표 시작은 띄울 수 있어 시한이 보내기와 같다.
    #[test]
    fn chat_tile_extra_ops_need_protocol_43() {
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        let body = |sig: &str| {
            let at = src.find(sig).unwrap();
            let b = &src[at..];
            b[..b.find("\n}").unwrap()].to_string()
        };
        for cmd in ["chat_tile_review", "chat_tile_goal_start", "chat_tile_goal_stop", "chat_tile_set_tier", "chat_tile_mcp_status"] {
            let b = body(&format!("pub async fn {cmd}("));
            assert!(b.contains("extra_protocol()?"), "{cmd}");
            assert!(!b.contains("window: String"), "{cmd}");
        }
        let review = body("pub async fn chat_tile_review(");
        assert!(review.contains("chat: String, epoch: u64, target: Value"));
        assert!(review.contains("super::side_chat_proxy::send_timeout()"));
        let start = body("pub async fn chat_tile_goal_start(");
        assert!(start.contains("if action != \"set\" && action != \"resume\" {"));
        assert!(start.find("action != \"set\"").unwrap() < start.find("client::request_timed(").unwrap());
        assert!(start.contains("\"tokenBudget\": token_budget") && start.contains("super::side_chat_proxy::send_timeout()"));
        let stop = body("pub async fn chat_tile_goal_stop(");
        assert!(stop.contains("if action != \"pause\" && action != \"clear\" {"));
        assert!(stop.contains("json!({ \"chat\": chat, \"epoch\": epoch, \"action\": action })"), "멈춤 몸에 목표 글 · 한도 칸이 없다");
        let open = body("pub async fn chat_tile_open(");
        assert!(open.contains("tier: Option<String>,") && open.contains("\"tier\": tier"));
        assert!(!open.contains("extra_protocol"), "옛 서버는 칸을 버린다 — 열기를 막지 않는다");
        let guard = body("fn extra_protocol(");
        assert!(guard.contains("p < CHAT_TILE_EXTRA_PROTOCOL") && guard.contains("SERVER_OUTDATED"));
        assert_eq!(super::super::ipc::frame::CHAT_TILE_EXTRA_PROTOCOL, 43);
    }

    /// 명령은 모두 `async fn` · 창 라벨은 웹뷰에서 · 등급은 서버 표와 같다 · 승인 등급 없음 · 방송 없음(소스 훑기).
    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        let src = include_str!("chat_tile_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        // (명령, 서버 op, 등급) — 목표 op 하나는 원격 분류(명령 이름) 때문에 명령 둘로 갈린다
        let ops = [
            ("chat_tile_open", "chat_tile_open", "Grade::Write"),
            ("chat_tile_send", "chat_tile_send", "Grade::Write"),
            ("chat_tile_interrupt", "chat_tile_interrupt", "Grade::Write"),
            ("chat_tile_set_model", "chat_tile_set_model", "Grade::Write"),
            ("chat_tile_set_effort", "chat_tile_set_effort", "Grade::Write"),
            ("chat_tile_set_perm_mode", "chat_tile_set_perm_mode", "Grade::Write"),
            ("chat_tile_decide", "chat_tile_decide", "Grade::Write"),
            ("chat_tile_close", "chat_tile_close", "Grade::Write"),
            ("chat_tile_attach", "chat_tile_attach", "Grade::Read"),
            ("chat_tile_list", "chat_tile_list", "Grade::Read"),
            ("chat_tile_subscribe", "chat_tile_subscribe", "Grade::Write"),
            ("chat_tile_unsubscribe", "chat_tile_unsubscribe", "Grade::Write"),
            ("chat_tile_compact", "chat_tile_compact", "Grade::Write"),
            ("chat_tile_rewind", "chat_tile_rewind", "Grade::Write"),
            ("chat_tile_review", "chat_tile_review", "Grade::Write"),
            ("chat_tile_goal_start", "chat_tile_goal", "Grade::Write"),
            ("chat_tile_goal_stop", "chat_tile_goal", "Grade::Write"),
            ("chat_tile_set_tier", "chat_tile_set_tier", "Grade::Write"),
            ("chat_tile_mcp_status", "chat_tile_mcp_status", "Grade::Write"),
        ];
        for (cmd, op, grade) in ops {
            assert!(src.contains(&format!("pub async fn {cmd}(")), "{cmd}");
            assert!(
                src.contains(&format!("{grade},\n        \"{op}\"")) || src.contains(&format!("{grade}, \"{op}\"")),
                "{op} 등급"
            );
            let want = if grade == "Grade::Read" { super::super::ipc::Grade::Read } else { super::super::ipc::Grade::Write };
            assert_eq!(frame::required_grade(op), Some(want), "{op}");
            assert!(super::super::chat_tile::is_op(op), "{op}");
        }
        assert_eq!(src.matches("#[tauri::command]").count(), ops.len());
        assert!(!src.contains("Grade::Approve") && !src.contains("request_approve"));
        assert!(!src.contains("window: String"));
        for bad in ["emit(", "emit_to(", "emit_filter(", "eprintln!", "log::"] {
            assert!(!src.contains(bad), "{bad}");
        }
        // 등록된 명령 = 이 열아홉(lib.rs)
        let lib = include_str!("../lib.rs");
        for (cmd, _, _) in ops {
            assert!(lib.contains(&format!("server::chat_tile_proxy::{cmd},")), "{cmd} 가 generate_handler! 에 없다");
        }
        // GUI 중계 표(`RELAYED`)에 이 이벤트가 없다 — `client.rs` 가 따로 이 파일의 `on_event` 로 넘긴다.
        let client = include_str!("client.rs");
        let relayed = &client[client.find("const RELAYED").unwrap()..];
        let relayed = &relayed[..relayed.find("];").unwrap()];
        assert!(!relayed.contains("chat_tile") && !relayed.contains("chat-tile"), "RELAYED 에 채팅 타일 사건");
        assert!(client.contains("n if n == super::chat_tile::EVENT => super::chat_tile_proxy::on_event(app, body)"));
        assert_eq!(super::super::chat_tile::EVENT, "chat-tile-event");
    }
}
