//! 찾기 파일 `instance::data_root()/server.json` — GUI 가 "서버가 이미 도나" 를 묻는 **안내**(잠금의 실체는 파이프 선점).
//!
//! `{pid, protocol: {min, max}, app_version, pipe, started_at_ms, launch_mode, sessions}` — **비밀 없음**(토큰·티켓을 싣지 않는다).
//! `sessions` 는 살아 있는 세션 수(③-4) — 서버가 수가 바뀔 때마다 다시 쓰고(시계 한 박자 안), **NSIS 설치기 훅**
//! (`src-tauri/nsis/hooks.nsh`)이 "살아 있는 세션 N개가 닫힙니다" 경고에 읽는다. 훅은 JSON 을 풀지 못해 **줄 단위**로 읽으므로
//! 보기 좋게(한 칸 한 줄) 쓰는 모양을 바꾸지 않는다(시험 `discovery_writes_sessions_on_its_own_line`).
//! 원자 교체(`fs_atomic::write_atomic`)라 읽는 쪽은 옛것 아니면 새것만 본다. 서버가 정상 종료하면 **자기 pid 일 때만** 지운다
//! (뒤이어 뜬 서버의 파일을 지우지 않게).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::ipc::ProtocolRange;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Discovery {
    pub pid: u32,
    pub protocol: ProtocolRange,
    pub app_version: String,
    pub pipe: String,
    pub started_at_ms: u64,
    #[serde(default)]
    pub launch_mode: String,
    /// 살아 있는 세션 수(③-4 — 설치기 경고).
    #[serde(default)]
    pub sessions: usize,
}

/// 이 인스턴스의 찾기 파일 경로.
pub(crate) fn path() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("server.json"))
}

pub(crate) fn write(path: &Path, d: &Discovery) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(d).map_err(std::io::Error::other)?;
    crate::fs_atomic::write_atomic(path, &bytes)
}

/// 읽기 — 없거나 깨졌으면 `None`(깨진 파일은 "서버 없음" 과 같다 — 파이프가 실체다).
pub(crate) fn read(path: &Path) -> Option<Discovery> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// 파일의 pid 가 `pid` 일 때만 지운다.
pub(crate) fn remove_if_ours(path: &Path, pid: u32) {
    if read(path).is_some_and(|d| d.pid == pid) {
        let _ = std::fs::remove_file(path);
    }
}
