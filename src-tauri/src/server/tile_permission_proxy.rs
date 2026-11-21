//! GUI 쪽 타일 권한 카드 껍데기 — 표와 판정은 세션 서버 `server::tile_permission`.
//!
//! - 창 이름은 GUI 가 채운다(부른 웹뷰의 라벨 — 프런트 값을 받지 않는다). 서버가 그 창이 그 세션의 주 임대 · 시청자인지 다시 본다.
//! - 결정은 쓰기 등급이다 — 승인 등급 프레임을 쓰지 않는다(작업안 승인과 다른 길 · 시험 `commands_mirror_the_server_ops`).
//! - 사건은 방송하지 않는다 — 몸에 도구 입력 본문이 있어 `client::RELAYED` 에 넣지 않고, 통로를 건 창의 Tauri `Channel` 에만 보낸다
//!   (`emit_to` 는 대상 `Any` 리스너 — 다른 창 · 원격 관문의 `listen_any` — 에도 닿는다).
//! - 몸 · 사유 글은 로그에 남기지 않는다. 토큰은 이 파일에 없다.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use super::ai_proxy::wire_message;
use super::client;
use super::ipc::frame::{TILE_FACE_PROTOCOL, TILE_PERMISSION_PROTOCOL, TILE_QUESTION_PROTOCOL};
use super::ipc::Grade;
use crate::errors::{with_reason, SERVER_OUTDATED};
use crate::i18n::tr;

/// 이 창이 그 타일을 지금 어느 면으로 보는가 — 대화 면으로 보는 창이 없으면 서버가 카드 없이 TUI 로 묻게 한다.
#[tauri::command]
pub async fn tile_permission_face(webview: tauri::Webview, stream: String, convo: bool) -> Result<(), String> {
    let window = webview.window().label().to_string();
    if client::negotiated_protocol().is_some_and(|p| p < TILE_FACE_PROTOCOL) {
        return Ok(());
    }
    client::request(Grade::Write, "tile_permission_face", json!({ "stream": stream, "window": window, "convo": convo }))
        .await
        .map(|_| ())
        .map_err(wire_message)
}

fn check_question_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < TILE_QUESTION_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 질문 카드에 답할 수 없습니다 — 터미널에서 답하거나 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot take question answers — answer in the terminal, or restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

fn check_protocol() -> Result<(), String> {
    match client::negotiated_protocol() {
        Some(p) if p < TILE_PERMISSION_PROTOCOL => Err(with_reason(
            SERVER_OUTDATED,
            tr!(
                ko: "세션 서버가 이전 판이라 권한 카드를 쓸 수 없습니다 — 터미널에서 답하거나 설정 › 세션 서버에서 [다시 시작] 하세요(열린 셸 세션이 닫힙니다)",
                en: "The session server is an older version and cannot show permission cards — answer in the terminal, or restart it in Settings › Session server (open shell sessions will close)"
            ),
        )),
        _ => Ok(()),
    }
}

/// `deny` 의 사유 글은 모델에게 간다 · `release` 는 결정 없이 풀기(터미널에서 답하기).
#[tauri::command]
pub async fn tile_permission_decide(
    webview: tauri::Webview,
    stream: String,
    session_epoch: u64,
    request_id: String,
    decision: String,
    message: Option<String>,
    answers: Option<Value>,
) -> Result<Value, String> {
    let window = webview.window().label().to_string();
    check_protocol()?;
    if decision == "answer" {
        check_question_protocol()?;
    }
    client::request(
        Grade::Write,
        "tile_permission_decide",
        json!({ "stream": stream, "sessionEpoch": session_epoch, "requestId": request_id, "decision": decision, "message": message, "answers": answers, "window": window }),
    )
    .await
    .map_err(wire_message)
}

#[tauri::command]
pub async fn tile_permission_snapshot(webview: tauri::Webview, stream: String) -> Result<Value, String> {
    let window = webview.window().label().to_string();
    check_protocol()?;
    client::request(Grade::Read, "tile_permission_snapshot", json!({ "stream": stream, "window": window }))
        .await
        .map_err(wire_message)
}

/// 명령 카드의 앱 분석 — 작업안 승인 카드와 같은 계산이다. 몸은 남기지 않는다.
#[tauri::command]
pub async fn tile_permission_analyze(command: String) -> crate::operations::analysis::PlanAnalysis {
    let cmd: String = command.chars().take(ANALYZE_MAX_CHARS).collect();
    crate::operations::analysis::analyze_plan(&cmd, None)
}

const ANALYZE_MAX_CHARS: usize = 16 * 1024;

static CHANNELS: LazyLock<Mutex<HashMap<String, Channel<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn channels() -> std::sync::MutexGuard<'static, HashMap<String, Channel<Value>>> {
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner())
}

/// F5 · 크래시 재부착은 새 통로로 갈음한다.
#[tauri::command]
pub async fn tile_permission_subscribe(webview: tauri::Webview, channel: Channel<Value>) -> Result<(), String> {
    let label = webview.window().label().to_string();
    channels().insert(label, channel);
    Ok(())
}

pub(crate) fn route(body: &Value, alive: impl Fn(&str) -> bool, subscribed: impl Fn(&str) -> bool) -> Vec<String> {
    let Some(ws) = body.get("windows").and_then(Value::as_array) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for w in ws.iter().filter_map(Value::as_str) {
        if !w.is_empty() && alive(w) && subscribed(w) && !out.iter().any(|o| o == w) {
            out.push(w.to_string());
        }
    }
    out
}

pub(crate) fn on_event(app: &tauri::AppHandle, body: &Value) {
    let mut chs = channels();
    chs.retain(|w, _| app.get_webview_window(w).is_some());
    for w in route(body, |l| app.get_webview_window(l).is_some(), |l| chs.contains_key(l)) {
        if !chs.get(&w).is_some_and(|c| c.send(body.clone()).is_ok()) {
            chs.remove(&w);
        }
    }
}

pub(crate) fn forget_window(label: &str) {
    channels().remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_matches_the_plan_card() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let a = rt.block_on(tile_permission_analyze("rm -rf build".into()));
        assert_eq!(a.effect, crate::operations::analysis::Computed::Delete);
        let r = rt.block_on(tile_permission_analyze("ls -la".into()));
        assert_eq!(r.effect, crate::operations::analysis::Computed::Read);
        let long = rt.block_on(tile_permission_analyze("x".repeat(ANALYZE_MAX_CHARS * 2)));
        assert_ne!(long.effect, crate::operations::analysis::Computed::Delete);
    }

    #[test]
    fn route_targets_only_the_viewing_windows() {
        let ev = |w: &[&str]| json!({ "windows": w, "stream": "s", "sessionEpoch": 1, "ev": { "t": "request", "card": { "input": { "command": "rm -rf x" } } } });
        let all = |_: &str| true;
        assert_eq!(route(&ev(&["main", "remote-a-1", "main"]), all, all), ["main", "remote-a-1"]);
        assert_eq!(route(&ev(&["aux-1"]), all, all), ["aux-1"], "타일이 사는 보조 창도");
        assert!(route(&ev(&["main"]), |_| false, all).is_empty(), "없는 창");
        assert!(route(&ev(&["main"]), all, |_| false).is_empty(), "통로 없는 창");
        assert!(route(&ev(&[""]), all, all).is_empty());
        assert!(route(&json!({ "stream": "s" }), all, all).is_empty(), "창 목록이 없으면 아무 데도");
    }

    #[test]
    fn commands_mirror_the_server_ops() {
        use super::super::ipc::frame;
        let src = include_str!("tile_permission_proxy.rs").replace("\r\n", "\n");
        let src = src.split("#[cfg(test)]").next().unwrap();
        for (op, grade) in [("tile_permission_decide", Grade::Write), ("tile_permission_snapshot", Grade::Read)] {
            assert!(src.contains(&format!("pub async fn {op}(")), "{op}");
            assert_eq!(frame::required_grade(op), Some(grade), "{op}");
        }
        assert!(!src.contains("Grade::Approve") && !src.contains("request_approve"));
        assert!(!src.contains("window: String"), "프런트가 준 창 이름을 받지 않는다");
        assert!(src.contains("pub async fn tile_permission_analyze("), "분석도 async");
        for bad in ["emit(", "emit_to(", "emit_filter(", "eprintln!", "log::", "PERMISSION_TOKEN"] {
            assert!(!src.contains(bad), "{bad}");
        }
        let client = include_str!("client.rs");
        let relayed = &client[client.find("const RELAYED").unwrap()..];
        let relayed = &relayed[..relayed.find("];").unwrap()];
        assert!(!relayed.contains("tile_permission"), "RELAYED 에 권한 카드 사건");
        assert!(client.contains("n if n == crate::tile_permission::EVENT => super::tile_permission_proxy::on_event(app, body)"));
        assert!(include_str!("proxy.rs").contains("super::tile_permission_proxy::forget_window(label);"));
    }
}
