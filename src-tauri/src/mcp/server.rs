//! `~/.aynx/mcp.json`(포트·토큰) 읽기·쓰기와 옛 폴더 이전. 요청 하나하나의 처리는 `http.rs`.
//!
//! **③-3c 부터 이 파일의 주인은 세션 서버 프로세스다**(`crate::server::ai`) — 서버가 뜰 때 MCP 토큰을 새로 뽑고(무작위원이
//! 없으면 MCP 를 끈다 — F5), 신호 평면과 **같은 리스너**(`crate::server::signal_http`, 127.0.0.1 임시 포트)의 포트와 함께
//! 이 파일에 쓴다. **서버 재시작 = 새 포트·새 토큰**(세션도 함께 끝나므로 옛 좌표를 쥔 CLI 가 남지 않는다 — 전역 등록은
//! 없다). GUI 는 이 파일을 쓰지 않는다 — 좌표는 서버 op `mcp_coords`·`mcp_token` 으로 읽는다(둘째 GUI·둘째 실행이 덮을 일이
//! 없다). 예전의 "저장된 포트 다시 잡기(`SO_REUSEADDR`)" 는 지웠다 — 포트를 지속할 까닭이 사라졌다.

use std::path::{Path, PathBuf};

use crate::tile_env::base_url;

/// MCP 엔드포인트 경로. 이 경로에서만 응답한다.
pub(crate) const MCP_PATH: &str = "/mcp";

// ---------------------------------------------------------------------------
// 포트·토큰 지속 (~/.aynx/mcp.json)
// ---------------------------------------------------------------------------

/// 파일에 저장하는 것 — 포트와 토큰뿐이다.
#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct McpConfig {
    pub(super) port: u16,
    pub(super) token: String,
}

/// **릴리스**의 홈 아래 폴더 이름 — 옛 폴더 이전의 목적지(이전은 릴리스 빌드만 한다). 앱이 실제로
/// 쓰는 폴더는 [`crate::instance::home_root`] 가 정한다(개발 빌드는 `~/.aynx-dev`).
#[cfg(test)]
pub(super) const HOME_DIR: &str = crate::instance::home_dir_name(false);

/// 옛 제품 이름 시절의 같은 폴더(릴리스 판) — **이전(migration) 전용**, 결정은
/// [`crate::instance::legacy_home_dir_names`] 한 곳(지금은 비어 있다 — 다음 개명 때 채운다).
///
/// **순서가 곧 우선순위다**(최근 이름 먼저). 규칙은 [`crate::settings::rename_first_legacy_dir`].
#[cfg(test)]
pub(super) const LEGACY_HOME_DIRS: &[&str] = crate::instance::legacy_home_dir_names(false);

/// `~/.aynx/mcp.json` 경로(개발 빌드는 `~/.aynx-dev/mcp.json` — 포트·토큰이 릴리스와 섞이지 않는다).
pub(crate) fn config_path() -> Option<PathBuf> {
    Some(crate::instance::home_root()?.join("mcp.json"))
}

/// `~/.<옛 이름>` → `~/.aynx` **1회 이전**(후보는 [`crate::instance::legacy_home_dir_names`] — 지금은 없다)
/// (포트·토큰을 보존해 등록이 살아남게 한다).
///
/// 부팅 최초, [`start`] 가 `load_config()` 로 mcp.json 을 읽기 **전에** 딱 한 번 부른다
/// (`lib.rs` 의 `run()`). 새 폴더가 이미 있으면 아무것도 안 하고, 옛 후보가 여럿 남아 있으면
/// **최근 이름 하나만** 옮긴다 — 규칙과 "복사 폴백 없음" 의 근거는
/// [`crate::settings::rename_first_legacy_dir`]. 개발 빌드는 제 옛 폴더(`~/.<옛 이름>-dev` → `~/.aynx-dev`)만
/// 본다 — 릴리스의 옛 폴더는 건드리지 않는다([`crate::instance::legacy_home_dir_names`]).
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

/// 홈 디렉터리를 받는 순수 I/O — **테스트 대상**.
pub(super) fn migrate_home_dir_at(home: &Path, legacy: &[&str], new_name: &str) -> bool {
    crate::settings::rename_first_legacy_dir(home, legacy, new_name, "MCP 설정")
}

/// 경로를 받는 읽기 — **파일 I/O 만 하는 테스트 대상**(왕복 검증용).
#[cfg(test)]
pub(super) fn load_config_at(path: &Path) -> Option<McpConfig> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 경로를 받는 쓰기 — 세션 서버가 뜰 때(`crate::server::ai`)·시험. 부모 디렉터리는 만들어 준다. 토큰이 실리므로 권한을
/// 좁힌다(`agent-mcp` 실행 설정 파일과 같은 규칙 — `vault::restrict_file`).
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

/// 포트 → 엔드포인트 URL.
pub(crate) fn endpoint_url(port: u16) -> String {
    format!("{}{MCP_PATH}", base_url(port))
}

