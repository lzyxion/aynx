//! 트레이 — 마지막 창을 닫아도 GUI 프로세스가 알림 영역에 남는다(설정 `[app] tray_on_close`).
//!
//! - 트레이로 가면 세션은 임대만 풀린다(`proxy::QUITTING` — 창 파괴 거둠이 닫지 않는다). 볼트는 창 0개 잠금 그대로다.
//! - 창이 열려 있으면 [GUI 종료] · [모든 세션 종료…] 는 주 창의 `quitAll`(저장 안 한 문서 확인)을 거친다(이벤트 `tray-quit`).
//! - OS 분기는 `imp` 하나 — Windows 만 트레이가 있고 나머지는 스텁(창을 모두 닫으면 GUI 가 끝난다 · 세션은 산다). 프런트는 `tray_status().supported` 만 본다.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::tr;
use crate::server::ipc::Grade;

pub(crate) const TRAY_ID: &str = "aynx-tray";

const REFRESH_EVERY: Duration = Duration::from_secs(3);

/// 새 주 창이 부팅에서 꺼낼 일(`take_tray_intent`).
static INTENT: Mutex<Option<&'static str>> = Mutex::new(None);

/// 프런트와 맞춘 값 — `take_tray_intent` · 이벤트 `tray-intent` 로 나간다.
pub(crate) const INTENT_DETACHED: &str = "detached";

pub(crate) fn supported() -> bool {
    imp::SUPPORTED
}

/// **블로킹**(설정 파일).
pub(crate) fn stays_on_close() -> bool {
    supported() && crate::settings::tray_on_close()
}

pub(crate) fn active(app: &AppHandle) -> bool {
    imp::exists(app)
}

pub(crate) fn install(app: &AppHandle) {
    sync(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if imp::exists(&app) {
                let view = gather(&app).await;
                imp::update(&app, &view);
                *LAST_VIEW.lock().unwrap_or_else(|e| e.into_inner()) = Some(view);
            }
            tokio::time::sleep(REFRESH_EVERY).await;
        }
    });
}

pub(crate) fn sync(app: &AppHandle) {
    if stays_on_close() {
        imp::ensure(app);
    } else {
        imp::remove(app);
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct View {
    pub connected: bool,
    pub sessions: u64,
    pub detached: usize,
    pub pending: usize,
}

pub(crate) fn tooltip(view: &View) -> String {
    let app = crate::instance::window_title(crate::instance::DEV);
    if !view.connected {
        return format!(
            "{app} — {}",
            tr!(ko: "세션 서버에 연결되지 않음", en: "Not connected to the session server")
        );
    }
    let mut parts = vec![tr!(ko: "세션 {n}", en: "Sessions {n}", n = view.sessions)];
    if view.pending > 0 {
        parts.push(tr!(ko: "작업안 대기 {n}", en: "Plans awaiting {n}", n = view.pending));
    }
    format!("{app} — {}", parts.join(" · "))
}

pub(crate) fn detached_label(n: usize) -> String {
    tr!(ko: "떨어진 세션 {n}", en: "Detached sessions {n}", n = n)
}

/// 메뉴 순서 그대로(구분선 제외) — `imp` 의 칸 자리(`DETACHED_AT`)가 이 순서에 기댄다.
pub(crate) fn menu_labels(detached: usize) -> [(&'static str, String); 4] {
    [
        ("open", tr!(ko: "열기", en: "Open")),
        ("detached", detached_label(detached)),
        (
            "quit-gui",
            tr!(ko: "GUI 종료 (세션은 계속 실행)", en: "Quit the GUI (sessions keep running)"),
        ),
        ("end-all", tr!(ko: "모든 세션 종료…", en: "End all sessions…")),
    ]
}

static LAST_VIEW: Mutex<Option<View>> = Mutex::new(None);

/// 메뉴 글자는 세울 때 한 번 만들어 이것이 없으면 옛 언어로 남는다(시작값 한국어 → 프런트가 OS 언어로 바로잡는 첫 `set_language` 도 이 길).
pub(crate) fn language_changed(app: &AppHandle) {
    let view = LAST_VIEW.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    imp::relabel(app, &view);
}

async fn gather(app: &AppHandle) -> View {
    let Ok(status) = crate::server::client::request(Grade::Read, "status", Value::Null).await else {
        return View::default();
    };
    let sessions = status.get("sessions").and_then(Value::as_u64).unwrap_or(0);
    let detached = crate::server::proxy::detached_visible(app).await.len();
    let pending = crate::server::ai_proxy::call(Grade::Read, "ops_list", json!({}))
        .await
        .ok()
        .and_then(|v| v.get("pending").and_then(Value::as_array).map(Vec::len))
        .unwrap_or(0);
    View {
        connected: true,
        sessions,
        detached,
        pending,
    }
}

#[tauri::command]
pub async fn take_tray_intent() -> Result<Option<String>, String> {
    Ok(INTENT.lock().unwrap_or_else(|e| e.into_inner()).take().map(str::to_string))
}

/// 독 끝내기 모달의 [모두 종료] — 판을 고른 것이 곧 확인이다(두 번 묻지 않는다). 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_end_all_sessions(app: AppHandle) -> Result<(), String> {
    proceed_end_all(&app);
    Ok(())
}

/// 설정 `tray_on_close` 와 상관없이 트레이에 남는다. 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_hide_to_tray(app: AppHandle) -> Result<(), String> {
    if !crate::remote::home_windows(&app).is_empty() {
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "tray" }));
    }
    Ok(())
}

/// 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_quit_gui(app: AppHandle) -> Result<(), String> {
    on_quit_gui(&app);
    Ok(())
}

#[tauri::command]
pub async fn tray_status() -> Result<Value, String> {
    Ok(json!({ "supported": supported() }))
}

pub(crate) fn open_main(app: &AppHandle, intent: Option<&'static str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(i) = intent {
            let _ = app.emit_to("main", "tray-intent", i);
        }
        return;
    }
    if let Some(i) = intent {
        *INTENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(i);
    }
    // 트레이로 갈 때 세운 표식을 걷는다 — 창 파괴 거둠이 다시 "창을 닫으면 세션도 닫는다" 로 돌아온다.
    crate::server::proxy::QUITTING.store(false, std::sync::atomic::Ordering::SeqCst);
    let Some(cfg) = app.config().app.windows.first().cloned() else {
        eprintln!("[tray] 설정에 창이 없어 주 창을 만들지 못했습니다");
        return;
    };
    if let Err(e) = tauri::WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
        eprintln!("[tray] 주 창을 만들지 못했습니다: {e}");
    }
}

/// 창이 0개가 되면 Tauri 의 종료 요청을 `lib.rs` 의 `run` 이 막는다(트레이가 서 있을 때만).
pub(crate) fn leave_to_tray(app: &AppHandle) {
    crate::server::proxy::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    for (_, w) in crate::remote::home_windows(app) {
        let _ = w.destroy();
    }
}

pub(crate) fn exit_gui(app: &AppHandle) {
    crate::server::proxy::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// 재연결을 먼저 멈춘다 — 남은 GUI 가 새 서버를 띄우지 않게.
pub(crate) async fn end_all_and_exit(app: &AppHandle) {
    crate::server::proxy::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    crate::server::client::stop_reconnecting();
    match crate::server::client::request(Grade::Write, "close_all", json!({})).await {
        Ok(n) => eprintln!("[tray] 모든 세션 종료 — {n} 개를 닫았습니다"),
        Err(e) => eprintln!("[tray] close_all 실패: {} {}", e.code, e.message),
    }
    if let Err(e) = crate::server::client::request(Grade::Write, "shutdown", json!({})).await {
        eprintln!("[tray] shutdown 실패: {} {}", e.code, e.message);
    }
    app.exit(0);
}

fn on_quit_gui(app: &AppHandle) {
    if crate::remote::home_windows(app).is_empty() {
        exit_gui(app);
    } else {
        open_main(app, None);
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "exit" }));
    }
}

/// 네이티브 확인 상자 — 창이 0개일 수 있어 앱 안 상자를 못 띄운다.
pub(crate) fn confirm_end_all(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let view = gather(&app).await;
        let body = end_all_question(view.sessions);
        let ok = tr!(ko: "모든 세션 종료", en: "End all sessions");
        let cancel = tr!(ko: "취소", en: "Cancel");
        let title = crate::instance::window_title(crate::instance::DEV).to_string();
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        let app2 = app.clone();
        app.dialog()
            .message(body)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel))
            .show(move |yes| {
                if yes {
                    proceed_end_all(&app2);
                }
            });
    });
}

/// 확인 뒤의 한 길(트레이 메뉴 · 독의 종료 단추) — 트레이에 매이지 않아 트레이 없는 OS 에서도 산다.
pub(crate) fn proceed_end_all(app: &AppHandle) {
    if crate::remote::home_windows(app).is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { end_all_and_exit(&app).await });
    } else {
        open_main(app, None);
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "endSessions" }));
    }
}

pub(crate) fn end_all_question(sessions: u64) -> String {
    tr!(
        ko: "현재 열린 세션 {n}개를 모두 닫고 앱을 종료합니다.",
        en: "Closes all {n} open sessions and quits the app.",
        n = sessions
    )
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => open_main(app, None),
        "detached" => open_main(app, Some(INTENT_DETACHED)),
        "quit-gui" => on_quit_gui(app),
        "end-all" => confirm_end_all(app),
        _ => {}
    }
}

/// 같은 종료 이벤트가 다시 와도 한 번만 알린다.
static NOTIFIED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// 창이 0개인 동안에만 부른다 — 창이 있으면 프런트의 `operation-notify` 가 알린다.
pub(crate) fn on_run_finished(app: &AppHandle, body: &Value) {
    let Some(state) = body
        .get("state")
        .and_then(|s| serde_json::from_value::<crate::operations::OperationState>(s.clone()).ok())
    else {
        return;
    };
    if !crate::operations::notify::is_finished(&state) {
        return;
    }
    let Some(id) = body.get("operationId").and_then(Value::as_str).map(str::to_string) else {
        return;
    };
    if !NOTIFIED.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone()) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(run) = finished_run(&id).await else {
            return;
        };
        let prefs = tokio::task::spawn_blocking(crate::settings::automation_prefs).await.unwrap_or_default();
        if prefs.notify_operation_results {
            use tauri_plugin_notification::NotificationExt;
            let title = format!(
                "{} — {}",
                crate::instance::window_title(crate::instance::DEV),
                tr!(ko: "작업안", en: "Task plan")
            );
            let body = format!("{} — {}", run.label(true), run.outcome());
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                eprintln!("[tray] OS 알림 실패: {e}");
            }
        }
        crate::operations::notify::send_messenger(run, |l| eprintln!("[tray] {l}")).await;
    });
}

/// 창이 0개인 동안에만 부른다. 자동 승인 훑기가 지나갈 만큼 기다렸다가 아직 사람을 기다리면 메신저로만 한 통(OS 알림은 창의 몫).
pub(crate) fn on_review_requested(body: &Value) {
    let awaiting = body
        .get("state")
        .and_then(|s| serde_json::from_value::<crate::operations::OperationState>(s.clone()).ok())
        == Some(crate::operations::OperationState::AwaitingApproval);
    let Some(id) = body.get("operationId").and_then(Value::as_str).map(str::to_string) else {
        return;
    };
    if !awaiting {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(crate::operations::notify::PENDING_GRACE).await;
        let Some(op) = crate::server::ai_proxy::pending_operation(&id).await else {
            return;
        };
        if !crate::operations::notify::first_pending(&id) {
            return;
        }
        crate::operations::notify::send_pending_messenger(op, |l| eprintln!("[tray] {l}")).await;
    });
}

async fn finished_run(id: &str) -> Option<crate::operations::notify::FinishedRun> {
    let list = crate::server::ai_proxy::call(Grade::Read, "ops_list", json!({})).await.ok()?;
    let ops = list
        .get("recent")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(list.get("pending").and_then(Value::as_array).into_iter().flatten());
    for v in ops {
        if v.get("operationId").and_then(Value::as_str) != Some(id) {
            continue;
        }
        let op: crate::operations::Operation = serde_json::from_value(v.clone()).ok()?;
        return Some(crate::operations::notify::FinishedRun::of(&op, crate::operations::now_ms()));
    }
    None
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::Mutex;

    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Wry};

    use super::{detached_label, menu_labels, tooltip, View, TRAY_ID};

    pub(super) const SUPPORTED: bool = true;

    /// [`menu_labels`] 와 같은 순서.
    static ITEMS: Mutex<Option<[MenuItem<Wry>; 4]>> = Mutex::new(None);

    const DETACHED_AT: usize = 1;

    pub(super) fn exists(app: &AppHandle) -> bool {
        app.tray_by_id(TRAY_ID).is_some()
    }

    pub(super) fn ensure(app: &AppHandle) {
        if exists(app) {
            return;
        }
        if let Err(e) = build(app) {
            eprintln!("[tray] 트레이를 세우지 못했습니다: {e}");
        }
    }

    fn build(app: &AppHandle) -> tauri::Result<()> {
        let [open, detached, quit, end] = menu_labels(0).map(|(id, text)| MenuItem::with_id(app, id, text, true, None::<&str>));
        let items = [open?, detached?, quit?, end?];
        let sep = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&items[0], &items[1], &sep, &items[2], &items[3]])?;
        let mut b = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip(tooltip(&View::default()))
            .on_menu_event(|app, event| super::on_menu(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    super::open_main(tray.app_handle(), None);
                }
            });
        if let Some(img) = crate::app_icon::current_image(app) {
            b = b.icon(img);
        }
        b.build(app)?;
        *ITEMS.lock().unwrap_or_else(|e| e.into_inner()) = Some(items);
        Ok(())
    }

    pub(super) fn remove(app: &AppHandle) {
        if app.remove_tray_by_id(TRAY_ID).is_some() {
            *ITEMS.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
    }

    /// 잠금은 곧바로 놓는다 — `set_text` 는 메인 스레드로 넘겨 기다린다.
    fn items() -> Option<[MenuItem<Wry>; 4]> {
        ITEMS.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub(super) fn update(app: &AppHandle, view: &View) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(tooltip(view)));
        }
        if let Some(items) = items() {
            let _ = items[DETACHED_AT].set_text(detached_label(view.detached));
        }
    }

    pub(super) fn relabel(app: &AppHandle, view: &View) {
        if let Some(items) = items() {
            for (item, (_, text)) in items.iter().zip(menu_labels(view.detached)) {
                let _ = item.set_text(text);
            }
        }
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(tooltip(view)));
        }
    }

    pub(super) fn set_icon(app: &AppHandle) {
        if let (Some(tray), Some(img)) = (app.tray_by_id(TRAY_ID), crate::app_icon::current_image(app)) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

/// 트레이 없는 OS — **명시적 스텁**(그 자체가 문서다): 창을 모두 닫으면 GUI 가 끝난다(세션은 세션 서버에 산다). 리눅스·macOS 의
/// 상태 영역 아이콘은 붙일 때 여기 몸만 채운다.
#[cfg(not(target_os = "windows"))]
mod imp {
    use tauri::AppHandle;

    use super::View;

    pub(super) const SUPPORTED: bool = false;

    pub(super) fn exists(_app: &AppHandle) -> bool {
        false
    }

    pub(super) fn ensure(_app: &AppHandle) {}

    pub(super) fn remove(_app: &AppHandle) {}

    pub(super) fn update(_app: &AppHandle, _view: &View) {}

    pub(super) fn relabel(_app: &AppHandle, _view: &View) {}

    pub(super) fn set_icon(_app: &AppHandle) {}
}

pub(crate) fn icon_changed(app: &AppHandle) {
    imp::set_icon(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_counts_sessions_and_pending_plans() {
        crate::i18n::set_lang(crate::i18n::Lang::Ko);
        let v = View {
            connected: true,
            sessions: 3,
            detached: 1,
            pending: 0,
        };
        assert!(tooltip(&v).ends_with("— 세션 3"), "{}", tooltip(&v));
        let v = View { pending: 2, ..v };
        assert!(tooltip(&v).ends_with("— 세션 3 · 작업안 대기 2"), "{}", tooltip(&v));
        assert!(tooltip(&View::default()).contains("연결되지 않음"));
        assert_eq!(detached_label(4), "떨어진 세션 4");
        assert!(end_all_question(5).contains("5개"));
    }

    #[test]
    fn menu_labels_follow_the_language() {
        use crate::i18n::{set_lang, Lang};
        set_lang(Lang::Ko);
        let ko = menu_labels(2);
        assert_eq!(ko.clone().map(|(id, _)| id),["open", "detached", "quit-gui", "end-all"]);
        assert_eq!(ko[0].1, "열기");
        assert_eq!(ko[1].1, "떨어진 세션 2");
        assert_eq!(ko[2].1, "GUI 종료 (세션은 계속 실행)");
        assert_eq!(ko[3].1, "모든 세션 종료…");
        set_lang(Lang::En);
        let en = menu_labels(2);
        assert_eq!(en.clone().map(|(id, _)| id), ["open", "detached", "quit-gui", "end-all"]);
        assert_eq!(en[0].1, "Open");
        assert_eq!(en[1].1, "Detached sessions 2");
        assert_eq!(en[2].1, "Quit the GUI (sessions keep running)");
        assert_eq!(en[3].1, "End all sessions…");
        assert!(tooltip(&View::default()).contains("Not connected"));
        let v = View {
            connected: true,
            sessions: 3,
            detached: 0,
            pending: 1,
        };
        assert!(tooltip(&v).ends_with("— Sessions 3 · Plans awaiting 1"), "{}", tooltip(&v));
        set_lang(Lang::Ko);
    }

    #[test]
    fn stub_matches_platform() {
        assert_eq!(supported(), cfg!(target_os = "windows"));
    }
}
