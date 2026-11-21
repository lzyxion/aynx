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

/// `quitAll` 의 끝(창마다 세션을 놓은 뒤). `mode` 글자는 프런트와 맞춘 값이다. `endSessions` 밖의 길은 세션을 닫지 않는다(`proxy::QUITTING`).
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
        // 설정 `tray_on_close` 와 상관없이 트레이에 남는다.
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
