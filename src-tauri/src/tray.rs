//! **트레이**(③-4 — GUI 기능 · 설계 4.1 "GUI 수명") — 마지막 창을 닫아도 GUI 프로세스가 알림 영역에 남는다.
//!
//! 세션은 원래 GUI 와 무관하게 세션 서버에 산다(③-2~③-3c). 트레이가 더하는 것은 **창이 0개인 동안의 GUI** 다:
//!
//! - 창을 모두 닫으면(주 창 X → `quitAll` → `workspace_exit_app`) 설정 `[app] tray_on_close`(기본 켬)가 켜져 있으면 프로세스를 끝내지
//!   않고 창만 모두 파괴한다([`leave_to_tray`]). 세션은 임대만 풀린다(`proxy::QUITTING` — 창 파괴 거둠이 닫지 않는다). 볼트는 보는
//!   창이 없으니 **창 0개 잠금**(`lib.rs` 의 `Destroyed` — 그대로다). 가림막은 [열기] 로 새 주 창이 뜰 때 선다.
//! - 트레이에 있는 동안 GUI 프로세스가 살아 서버에 붙어 있으므로 작업안 실행 결과를 **GUI Rust 가** OS 알림·메신저로 알린다
//!   ([`on_run_finished`] — 창이 있으면 프런트의 몫이다). 사전 정책 자동 승인은 ③-4 부터 서버의 시계라 창·GUI 와 무관하다
//!   (`operations::auto`).
//! - 메뉴: **열기**(주 창 복원 · 없으면 새 주 창 — 워크스페이스 복원이 세션에 다시 붙는다) · **떨어진 세션 N**(열기 + 떨어진 세션
//!   목록) · **GUI 종료**(세션은 서버에 계속 산다) · **모든 세션 종료…**(확인 한 번 → 서버의 세션을 모두 닫고 서버도 끝내고 GUI 도
//!   끝난다 — 남은 GUI 가 새 서버를 띄우지 않게). 창이 열려 있으면 둘 다 주 창의 `quitAll`(저장 안 한 문서 확인)을 거친다(이벤트
//!   `tray-quit`). [모든 세션 종료…] 의 확인 뒤 흐름([`proceed_end_all`])은 트레이에 매이지 않아 독의 종료 단추(`app_end_all_sessions` —
//!   확인은 앱 테마의 앱 안 상자)도 같은 것을 부른다 — 트레이 없는 OS 에서도 산다.
//! - 아이콘은 지금 고른 앱 아이콘(`app_icon::current_image`), 툴팁은 `AYNX — 세션 N · 작업안 대기 M`([`tooltip`]) — 3초마다
//!   서버에 물어 고친다. 앱 언어를 바꾸면(`i18n::set_language`) 메뉴 칸 전부와 툴팁을 곧바로 다시 건다([`language_changed`]).
//! - **OS 분기는 이 파일의 `imp` 하나**다 — Windows 만 트레이가 있고, 나머지는 [`supported`] 가 거짓인 스텁(트레이 없음 → 창을 모두
//!   닫으면 GUI 가 끝난다, 세션은 산다). 프런트는 `tray_status().supported` 만 본다. Tauri 의 `tray-icon` 기능도 Windows 대상에만
//!   켠다(Cargo.toml) — 리눅스 빌드가 appindicator 를 끌어오지 않게.
//! - 작업 표시줄 앱 ID(`taskbar_shortcut` · `app_icon::set_process_app_id`)와는 무관하다 — 트레이 아이콘은 알림 영역의 별개 항목이고
//!   창이 없을 때 작업 표시줄 단추는 원래 없다.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::tr;
use crate::server::ipc::Grade;

/// 트레이 아이콘의 id — 하나뿐이다.
pub(crate) const TRAY_ID: &str = "aynx-tray";

/// 툴팁·메뉴를 고치는 주기.
const REFRESH_EVERY: Duration = Duration::from_secs(3);

/// 새 주 창이 부팅에서 꺼낼 일(`take_tray_intent`) — 지금은 "떨어진 세션 목록 열기" 하나.
static INTENT: Mutex<Option<&'static str>> = Mutex::new(None);

/// 떨어진 세션 목록을 열라는 뜻.
pub(crate) const INTENT_DETACHED: &str = "detached";

/// 트레이가 있는 OS 인가.
pub(crate) fn supported() -> bool {
    imp::SUPPORTED
}

/// 창을 모두 닫으면 트레이에 남는가 — 지원 OS 이고 설정이 켜져 있다(기본 켬). **블로킹**(설정 파일).
pub(crate) fn stays_on_close() -> bool {
    supported() && crate::settings::tray_on_close()
}

/// 지금 트레이 아이콘이 서 있나.
pub(crate) fn active(app: &AppHandle) -> bool {
    imp::exists(app)
}

/// setup 에서 한 번 — 설정대로 트레이를 세우고(또는 두지 않고) 툴팁 시계를 돈다.
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

/// 설정을 저장한 뒤 — 켜면 세우고 끄면 걷는다(`settings::save_settings`).
pub(crate) fn sync(app: &AppHandle) {
    if stays_on_close() {
        imp::ensure(app);
    } else {
        imp::remove(app);
    }
}

/// 트레이 툴팁·메뉴가 보이는 수.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct View {
    pub connected: bool,
    pub sessions: u64,
    pub detached: usize,
    pub pending: usize,
}

/// 툴팁 — `AYNX — 세션 3 · 작업안 대기 1`. 서버에 닿지 못하면 그 사실을. **순수**.
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

/// 메뉴의 "떨어진 세션 N". **순수**.
pub(crate) fn detached_label(n: usize) -> String {
    tr!(ko: "떨어진 세션 {n}", en: "Detached sessions {n}", n = n)
}

/// 메뉴 칸들의 `(id, 글자)` — 메뉴 순서 그대로(구분선 제외). 세울 때([`imp`] 의 `build`)와 언어를 바꿀 때([`language_changed`])
/// 같은 목록을 쓴다. **순수**(지금 언어를 읽는다).
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

/// 마지막으로 모은 수 — 언어를 바꿀 때 툴팁·"떨어진 세션 N" 을 다음 갱신(3초)까지 기다리지 않고 새 언어로 곧바로 다시 그린다.
static LAST_VIEW: Mutex<Option<View>> = Mutex::new(None);

/// **앱 언어가 바뀌었다**(`i18n::set_language`) — 트레이 메뉴의 모든 칸과 툴팁을 새 언어로 다시 건다. 메뉴는 세울 때 한 번
/// `tr!` 로 만들었으므로 이것이 없으면 "열기"·"GUI 종료"·"모든 세션 종료…" 가 옛 언어로 남는다(시작값 한국어 → 프런트가 OS 언어로
/// 바로잡는 첫 `set_language` 도 이 길이다). 트레이가 없으면 아무것도 안 한다.
pub(crate) fn language_changed(app: &AppHandle) {
    let view = LAST_VIEW.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    imp::relabel(app, &view);
}

/// 서버에 물어 수를 모은다(닿지 못하면 `connected:false`).
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

/// 새 주 창이 부팅에서 한 번 꺼낸다(`"detached"` 면 떨어진 세션 목록을 연다).
#[tauri::command]
pub async fn take_tray_intent() -> Result<Option<String>, String> {
    Ok(INTENT.lock().unwrap_or_else(|e| e.into_inner()).take().map(str::to_string))
}

/// 독 끝내기 모달의 [모두 종료] — 판을 고른 것이 곧 확인이다(2026-10-28 사용자 결정 — 두 번 묻지 않는다). 여기서는 트레이
/// [모든 세션 종료…] 의 확인 **뒤** 흐름([`proceed_end_all`])만 탄다. 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_end_all_sessions(app: AppHandle) -> Result<(), String> {
    proceed_end_all(&app);
    Ok(())
}

/// 독 끝내기 모달의 [트레이로 숨기기] — 창을 모두 닫고 트레이에 남는다(세션은 산다 · 설정 `tray_on_close` 와 상관없이). 주 창의
/// `quitAll`(저장 안 한 문서 확인)을 거치도록 [GUI 종료] 와 같은 이벤트에 모드 `tray` 를 싣는다. 창이 없으면 할 일이 없다.
/// 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_hide_to_tray(app: AppHandle) -> Result<(), String> {
    if !crate::remote::home_windows(&app).is_empty() {
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "tray" }));
    }
    Ok(())
}

/// 독 끝내기 모달의 [GUI 종료] — 트레이 [GUI 종료] 와 같은 길([`on_quit_gui`] — 주 창의 `quitAll` 이 저장 안 한 문서를 묻고, 세션은
/// 산다). 어느 OS 든(트레이에 매이지 않는다). 원격 창은 부르지 못한다(`remote::deny::HOME_ONLY`).
#[tauri::command]
pub async fn app_quit_gui(app: AppHandle) -> Result<(), String> {
    on_quit_gui(&app);
    Ok(())
}

/// 설정 화면이 묻는다 — 이 환경에 트레이가 있나(없으면 토글을 흐리고 안내한다). 프런트는 OS 를 모른다.
#[tauri::command]
pub async fn tray_status() -> Result<Value, String> {
    Ok(json!({ "supported": supported() }))
}

/// **주 창을 연다** — 있으면 앞으로(최소화 풀기·보이기·포커스), 없으면(트레이에 남은 동안) 설정의 첫 창으로 새로 만든다. 새 주
/// 창은 부팅에서 워크스페이스를 복원하며 떨어진 세션에 다시 붙는다. `intent` 는 그 창이 할 일(떨어진 세션 목록).
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
    // 창 파괴 거둠이 다시 "창을 닫으면 세션도 닫는다" 로 돌아온다(트레이로 갈 때 세운 표식을 걷는다 — 그때의 파괴는 이미 다 지났다).
    crate::server::proxy::QUITTING.store(false, std::sync::atomic::Ordering::SeqCst);
    let Some(cfg) = app.config().app.windows.first().cloned() else {
        eprintln!("[tray] 설정에 창이 없어 주 창을 만들지 못했습니다");
        return;
    };
    if let Err(e) = tauri::WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
        eprintln!("[tray] 주 창을 만들지 못했습니다: {e}");
    }
}

/// **창을 모두 닫고 트레이에 남는다**(주 창 X 의 끝 — `workspace_exit_app`). 세션은 닫지 않는다(`QUITTING` — 창 파괴 거둠이
/// 임대만 푼다). 창이 0개가 되면 Tauri 의 종료 요청을 `lib.rs` 의 `run` 이 막는다(트레이가 서 있을 때만).
pub(crate) fn leave_to_tray(app: &AppHandle) {
    crate::server::proxy::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    for (_, w) in crate::remote::home_windows(app) {
        let _ = w.destroy();
    }
}

/// GUI 만 끝낸다 — 세션은 서버에 산다(다음에 켜면 복원이 다시 붙는다).
pub(crate) fn exit_gui(app: &AppHandle) {
    crate::server::proxy::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// **모든 세션 종료** — 서버의 세션을 모두 닫고(`close_all`) 서버를 끝내고(`shutdown`) GUI 도 끝낸다. 남은 GUI 가 새 서버를 띄우지
/// 않게 클라이언트의 재연결을 먼저 멈춘다(`client::stop_reconnecting`).
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

/// 메뉴 [GUI 종료] — 창이 있으면 주 창의 `quitAll` 을 거친다(저장 안 한 문서), 없으면 곧바로.
fn on_quit_gui(app: &AppHandle) {
    if crate::remote::home_windows(app).is_empty() {
        exit_gui(app);
    } else {
        open_main(app, None);
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "exit" }));
    }
}

/// **트레이 [모든 세션 종료…]** — 네이티브 확인 상자 하나(창이 0개일 수 있어 앱 안 상자를 못 띄운다) → [`proceed_end_all`].
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

/// **모든 세션 종료 — 확인 뒤의 한 길**(트레이 메뉴 · 독의 종료 단추). 창이 있으면 주 창을 앞으로 불러 그 `quitAll`(저장 안 한
/// 문서 확인 → 세션 놓기 → `workspace_exit_app`), 없으면 곧바로 [`end_all_and_exit`]. 트레이에 매이지 않는다 — 트레이 없는
/// OS 에서도 그대로다.
pub(crate) fn proceed_end_all(app: &AppHandle) {
    if crate::remote::home_windows(app).is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { end_all_and_exit(&app).await });
    } else {
        open_main(app, None);
        let _ = app.emit_to("main", "tray-quit", json!({ "mode": "endSessions" }));
    }
}

/// [모든 세션 종료…] 의 물음. **순수**.
pub(crate) fn end_all_question(sessions: u64) -> String {
    tr!(
        ko: "현재 열린 세션 {n}개를 모두 닫고 앱을 종료합니다.",
        en: "Closes all {n} open sessions and quits the app.",
        n = sessions
    )
}

/// 메뉴 한 칸을 눌렀다.
fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => open_main(app, None),
        "detached" => open_main(app, Some(INTENT_DETACHED)),
        "quit-gui" => on_quit_gui(app),
        "end-all" => confirm_end_all(app),
        _ => {}
    }
}

/// 이미 알린 실행(같은 종료 이벤트가 다시 와도 한 번만).
static NOTIFIED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// **창이 0개인 동안 끝난 작업안 실행**(③-4) — GUI Rust 가 OS 알림 한 장(`[automation] notify_operation_results`)과 메신저(켰으면)를
/// 낸다. 창이 있으면 부르지 않는다(프런트의 `operation-notify` 가 한다 — `server::client::on_event`).
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

/// **창이 0개인 동안 검토 대기에 들어온 작업안**(승인 요약) — 자동 승인 훑기가 지나갈 만큼 기다렸다가 아직 사람을 기다리면 메신저로
/// 한 통(켰으면 — `[messenger] operation_pending`). OS 알림은 내지 않는다(검토 요청 OS 알림은 창의 몫이다). 창이 있으면 부르지 않는다.
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

/// 작업안 하나의 끝난 실행 한 줄 — 서버 목록에서 찾는다.
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

    /// 글자를 고칠 메뉴 칸 — [`menu_labels`] 와 같은 순서(1 번이 "떨어진 세션 N"). 언어를 바꾸면 전부, 3초 갱신은 1 번만 고친다.
    static ITEMS: Mutex<Option<[MenuItem<Wry>; 4]>> = Mutex::new(None);

    /// "떨어진 세션 N" 칸의 자리.
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

    /// 칸들을 꺼낸다(잠금은 곧바로 놓는다 — `set_text` 는 메인 스레드로 넘겨 기다린다).
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

    /// 언어가 바뀌었다 — 모든 칸과 툴팁을 지금 언어로. 메뉴·트레이 조작은 Tauri 가 메인 스레드로 넘긴다(`update` 와 같다).
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

    /// 고른 앱 아이콘이 바뀌었다 — 트레이 아이콘도 맞춘다.
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

/// 고른 앱 아이콘이 바뀌었다 — 트레이 아이콘도 맞춘다(`app_icon::set_app_icon`).
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

    /// 메뉴 칸 글자는 지금 언어를 따른다 — 언어를 바꾼 뒤 `language_changed` 가 같은 목록으로 다시 건다.
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
