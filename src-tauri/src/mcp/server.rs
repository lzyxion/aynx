//! `mcp.json`(포트·토큰) 쓰기와 옛 폴더 이전. 주인은 세션 서버(`crate::server::ai`) — GUI 는 이 파일을 쓰지 않고 서버 op `mcp_coords`·`mcp_token` 으로 읽는다.
//! 서버 재시작 = 새 포트·새 토큰(포트는 지속하지 않는다).

use std::path::{Path, PathBuf};

use crate::tile_env::base_url;

pub(crate) const MCP_PATH: &str = "/mcp";

// ---------------------------------------------------------------------------
// 포트·토큰 지속 (~/.aynx/mcp.json)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct McpConfig {
    pub(super) port: u16,
    pub(super) token: String,
}

#[cfg(test)]
pub(super) const HOME_DIR: &str = crate::instance::home_dir_name(false);

/// 옛 제품 이름 시절의 같은 폴더 — 순서가 곧 우선순위다(최근 이름 먼저).
#[cfg(test)]
pub(super) const LEGACY_HOME_DIRS: &[&str] = crate::instance::legacy_home_dir_names(false);

pub(crate) fn config_path() -> Option<PathBuf> {
    Some(crate::instance::home_root()?.join("mcp.json"))
}

/// `~/.<옛 이름>` → `~/.aynx` 1회 이전 — 부팅 최초 한 번(`lib.rs` 의 `run()`). 개발 빌드는 제 옛 폴더만 보고 릴리스의 옛 폴더는 건드리지 않는다.
pub fn migrate_legacy_home_dir() {
    let dev = crate::instance::DEV;
    if let Some(home) = dirs::home_dir() {
        migrate_home_dir_at(
            &home,
            crate::instance::legacy_home_dir_names(dev),
            crate::instance::home_dir_name(dev),
        );
    }
}

pub(super) fn migrate_home_dir_at(home: &Path, legacy: &[&str], new_name: &str) -> bool {
    crate::settings::rename_first_legacy_dir(home, legacy, new_name, "MCP 설정")
}

#[cfg(test)]
pub(super) fn load_config_at(path: &Path) -> Option<McpConfig> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 토큰이 실리므로 권한을 좁힌다(`vault::restrict_file`).
pub(crate) fn save_config_at(path: &Path, port: u16, token: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let cfg = McpConfig {
        port,
        token: token.to_string(),
    };
    let s = serde_json::to_string_pretty(&cfg)?;
    std::fs::write(path, s)?;
    let _ = crate::vault::restrict_file(path);
    Ok(())
}

pub(crate) fn endpoint_url(port: u16) -> String {
    format!("{}{MCP_PATH}", base_url(port))
}

