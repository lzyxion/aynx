//! 창 소속 registry. 세션 owner/routing과는 독립적이다.
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::tr;
use crate::workspaces::schema::Scope;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub workspace_id: String,
    pub scope: Scope,
}
#[derive(Default)]
pub struct Bindings(pub Mutex<HashMap<String, Binding>>);

impl Bindings {
    pub(crate) fn get(&self, label: &str) -> Option<Binding> {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(label)
            .cloned()
    }
    pub(crate) fn remove(&self, label: &str) {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(label);
    }
}

#[tauri::command]
pub async fn workspace_bind_window(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Bindings>,
    workspace_id: String,
    scope: Scope,
) -> Result<(), String> {
    let label = window.label();
    let mut bindings = state.0.lock().unwrap_or_else(|p| p.into_inner());
    if label == "main" && scope != Scope::Main
        || label != "main" && !matches!(&scope, Scope::Aux { .. })
    {
        return Err("windowScopeMismatch".into());
    }
    if let Some(old) = bindings.get(label) {
        if label != "main" && (old.workspace_id != workspace_id || old.scope != scope) {
            return Err("workspaceMismatch".into());
        }
    }
    bindings.insert(
        label.to_string(),
        Binding {
            workspace_id,
            scope,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn workspace_window_binding(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Bindings>,
) -> Result<Option<Binding>, String> {
    Ok(state.get(window.label()))
}

#[tauri::command]
pub async fn workspace_windows(app: AppHandle) -> Result<Vec<String>, String> {
    let mut labels: Vec<_> = crate::remote::home_windows(&app).into_keys().collect();
    labels.sort();
    Ok(labels)
}

#[tauri::command]
pub async fn focus_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| tr!(ko: "창이 이미 닫혔습니다", en: "The window is already closed"))?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// **주 창이 떠난다**(`quitAll` 의 끝 — 창마다 세션을 체크포인트와 함께 놓은 뒤). `mode`:
///
/// - `null`(주 창 X) — `[app] tray_on_close`(기본 켬)이고 트레이가 서 있으면 **창만 모두 닫고 트레이에 남는다**(③-4 — `tray`),
///   아니면 GUI 를 끝낸다.
/// - `"exit"`(트레이 [GUI 종료]) — GUI 를 끝낸다.
/// - `"endSessions"`(트레이 [모든 세션 종료] — 확인은 트레이가 이미 받았다) — 세션을 모두 닫고 서버와 GUI 를 끝낸다.
///
/// 어느 쪽이든 GUI 를 끝내거나 트레이로 가는 길은 로컬·SSH 세션을 닫지 않는다(창 파괴 거둠이 서버에 `close_window` 를 보내지
/// 않는다 — `proxy::QUITTING`). 연결이 끊기면 서버가 이 GUI 의 임대를 풀고 세션은 산다(다음에 켜면 복원이 다시 붙는다).
#[tauri::command]
pub async fn workspace_exit_app(
    app: AppHandle,
    window: tauri::WebviewWindow,
    mode: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("mainWindowRequired".into());
    }
    app.emit("workspace-quitting", ())
        .map_err(|e| e.to_string())?;
    match mode.as_deref() {
        Some("endSessions") => crate::tray::end_all_and_exit(&app).await,
        Some("exit") => crate::tray::exit_gui(&app),
        // 끝내기 모달의 [트레이로 숨기기](2026-10-28) — 설정 `tray_on_close` 와 상관없이 트레이에 남는다(트레이가 없으면 GUI 종료).
        Some("tray") => {
            if crate::tray::active(&app) {
                crate::tray::leave_to_tray(&app);
            } else {
                crate::tray::exit_gui(&app);
            }
        }
        _ => {
            let to_tray = tauri::async_runtime::spawn_blocking(crate::tray::stays_on_close)
                .await
                .unwrap_or(false);
            if to_tray && crate::tray::active(&app) {
                crate::tray::leave_to_tray(&app);
            } else {
                crate::tray::exit_gui(&app);
            }
        }
    }
    Ok(())
}
