//! 세션 서버 상태·전역 등록 해제 이관. 현재·옛 이름 중 이 인스턴스 것만 걷는다.
//! 새 전역 등록은 만들지 않으며 블로킹 I/O·CLI 스폰은 블로킹 풀에서만 돈다.

use std::path::PathBuf;
use tauri::{Emitter, Manager};

use crate::i18n::tr;
use super::*;

/// 세션 서버의 MCP 좌표(③-3c — 주인은 서버, `crate::server::ai_proxy::mcp_coords`). 서버에 닿지 못하면 `running: false`.
#[tauri::command]
pub async fn mcp_status() -> Result<McpStatus, ()> {
    let coords = crate::server::ai_proxy::mcp_coords().await;
    Ok(McpStatus {
        name: MCP_NAME.to_owned(),
        running: coords.as_ref().is_some_and(|c| c.running),
        url: coords.map(|c| c.url).unwrap_or_default(),
    })
}

/// Claude 사용자 범위만 읽는다. 프로젝트·로컬·관리 설정은 조회하지 않는다.
fn claude_user_config_path() -> Option<PathBuf> {
    match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir).join(".claude.json")),
        None => Some(dirs::home_dir()?.join(".claude.json")),
    }
}

/// 토큰이 있는 JSON도 이름만 꺼낸다. 파서 오류·파일 내용은 밖으로 내보내지 않는다.
fn user_server_names(text: &str, names: &[&str]) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(servers) = value.get("mcpServers").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    names.iter().filter(|name| servers.contains_key(**name)).map(|name| (*name).to_owned()).collect()
}

/// 기존 해제 경로 — Claude는 사용자 범위를 지정하고 Codex는 표만 원자적으로 걷는다.
fn unregister_now(adapter: &CliAdapter, name: &str) -> bool {
    match adapter.remover {
        Remover::Cli { remove_post } => adapter.command()
            .args(CliAdapter::remove_args(remove_post, name))
            .output().is_ok_and(|output| output.status.success()),
        Remover::CodexConfig => crate::codex_mcp::config_path()
            .is_some_and(|path| crate::codex_mcp::remove_at(&path, name) == Ok(true)),
    }
}

/// 기존 우편함 이벤트 이름을 유지해 늦게 뜬 창도 결과를 한 번 받는다.
pub const REREGISTERED_EVENT: &str = "mcp-reregistered";

/// 서버가 못 떠도 이전 전역 등록은 해제한다. 없는 항목·다른 인스턴스 이름은 쓰지 않는다.
pub fn spawn_unregister_migration(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let names: Vec<&str> = std::iter::once(MCP_NAME).chain(LEGACY_MCP_NAMES.iter().copied()).collect();
        let mut removed = false;
        for adapter in ADAPTERS {
            let present = match adapter.remover {
                Remover::Cli { .. } => claude_user_config_path()
                    .and_then(|path| std::fs::read_to_string(path).ok())
                    .map(|text| user_server_names(&text, &names)).unwrap_or_default(),
                // remove_at는 항목이 없으면 파일을 쓰지 않고 false를 돌려준다. CLI 설치도 필요 없다.
                Remover::CodexConfig => names.iter().map(|name| (*name).to_owned()).collect(),
            };
            for name in present {
                removed |= unregister_now(adapter, &name);
            }
        }
        if !removed {
            return;
        }
        let message = tr!(
            ko: "AYNX 세션 서버 전역 등록을 해제했습니다 — 이제 AYNX 가 띄우는 에이전트에만 실립니다",
            en: "Removed the global AYNX session server registration — it now loads only for agents launched by AYNX"
        );
        if let Ok(mut slot) = app.state::<McpState>().notice.lock() {
            *slot = Some(message.clone());
        }
        let _ = app.emit(REREGISTERED_EVENT, message);
    });
}

/// 이관 알림을 **가져간다**(가져가면 비워진다 — 토스트가 두 번 뜨지 않게).
///
/// **동기로 남는다** (docs/conventions.md 의 예외): `Mutex<Option<String>>` 에서 `take()`
/// 한 번이다. 무거운 일(`claude mcp remove`)은 [`spawn_unregister_migration`] 이 블로킹 풀에서 한다.
#[tauri::command]
pub fn take_mcp_notice(state: tauri::State<'_, McpState>) -> Option<String> {
    state.notice.lock().ok().and_then(|mut slot| slot.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_reads_only_user_names_for_this_instance() {
        // 옛 이름 후보는 지금 비어 있다(2026-10-22 2차) — 기계는 가짜 옛 이름(`old-sessions*`)으로 잰다.
        let text = r#"{"mcpServers":{"aynx-sessions":{},"old-sessions":{},"aynx-sessions-dev":{},"old-sessions-dev":{},"aynx":{},"other":{}},
            "projects":{"/work":{"mcpServers":{"old-sessions":{}}}}}"#;
        for dev in [false, true] {
            let legacy = if dev { "old-sessions-dev" } else { "old-sessions" };
            let names: Vec<_> = std::iter::once(crate::instance::mcp_name(dev))
                .chain(crate::instance::legacy_mcp_names(dev).iter().copied())
                .chain(std::iter::once(legacy))
                .collect();
            let found = user_server_names(text, &names);
            assert_eq!(found, if dev { vec!["aynx-sessions-dev", "old-sessions-dev"] } else { vec!["aynx-sessions", "old-sessions"] });
        }
        assert!(user_server_names("invalid secret", &["aynx"]).is_empty());
        assert!(user_server_names(r#"{"projects":{"/work":{"mcpServers":{"aynx":{}}}}}"#, &["aynx"]).is_empty());
    }
}
