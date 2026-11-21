//! 오케스트레이션 **영속** — Run 마다 JSON 한 파일(SQLite 아님 · 자동 재개 없음).
//!
//! 불변식:
//! - `model::Run` 에는 토큰 · 프롬프트 전문 · 대화 기록 · PTY 출력 칸이 **없다**(시험 `run_json_has_no_tokens_or_bodies`).
//! - 못 읽는 파일은 **그 파일만** 건너뛰고 로그에는 파일 이름과 사유만(내용 · 비밀 없음). 옛 판 1~3 의 몸은 해석하지 않고 파일은 남긴다.
//! - 읽은 Run 은 `orphaned`(읽기 전용)로 올리고 토큰은 되살리지 않는다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::{is_id, Run, RunState, FILE_VERSION, SUPPORTED_FILE_VERSIONS};

pub(crate) fn store_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("orchestration"))
}

pub(crate) fn file_name(run_id: &str) -> String {
    format!("{run_id}.json")
}

#[derive(Serialize)]
struct FileOut<'a> {
    version: u32,
    run: &'a Run,
}

#[derive(Deserialize)]
struct VersionOnly {
    version: u32,
}

#[derive(Deserialize)]
struct FileIn {
    run: Run,
}

pub(crate) fn encode(run: &Run) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(&FileOut {
        version: FILE_VERSION,
        run,
    })
    .map_err(|e| e.to_string())
}

/// 판을 먼저 본다 — 모르는 판의 몸은 해석하지 않는다.
pub(crate) fn decode(bytes: &[u8]) -> Result<Run, String> {
    let head: VersionOnly = serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))?;
    if !SUPPORTED_FILE_VERSIONS.contains(&head.version) {
        return Err(format!("version {} (supported {SUPPORTED_FILE_VERSIONS:?})", head.version));
    }
    let f: FileIn = serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))?;
    Ok(f.run)
}

/// 보드 · MCP 에 나가는 것은 `kind` 뿐 — `detail` 에는 경로 · OS 문장이 섞여 서버 로그에만.
#[derive(Debug, Clone)]
pub(crate) struct SaveError {
    pub kind: &'static str,
    pub detail: String,
}

impl SaveError {
    fn io(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        let kind = match e.kind() {
            ErrorKind::StorageFull | ErrorKind::QuotaExceeded => "disk-full",
            ErrorKind::PermissionDenied => "permission-denied",
            ErrorKind::ReadOnlyFilesystem => "read-only",
            _ => "io-error",
        };
        SaveError {
            kind,
            detail: e.to_string(),
        }
    }
}

pub(crate) fn save(dir: &Path, run: &Run) -> Result<(), SaveError> {
    std::fs::create_dir_all(dir).map_err(SaveError::io)?;
    let bytes = encode(run).map_err(|detail| SaveError {
        kind: "encode-failed",
        detail,
    })?;
    crate::fs_atomic::write_atomic(&dir.join(file_name(&run.id)), &bytes).map_err(SaveError::io)
}

fn read_run_files(dir: &Path, mut skip: impl FnMut(&str, &str)) -> Vec<Run> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.starts_with("run-") && n.ends_with(".json"))
        .collect();
    names.sort();
    let mut out = Vec::new();
    for name in names {
        let id = name.trim_end_matches(".json");
        if !is_id("run", id) {
            skip(&name, "not a run file name");
            continue;
        }
        let bytes = match std::fs::read(dir.join(&name)) {
            Ok(b) => b,
            Err(e) => {
                skip(&name, &format!("read: {}", e.kind()));
                continue;
            }
        };
        let run = match decode(&bytes) {
            Ok(r) => r,
            Err(e) => {
                // 사유에 내용을 싣지 않는다 — serde 오류는 위치(줄·칸)와 종류만 말한다.
                skip(&name, &e);
                continue;
            }
        };
        if run.id != id {
            skip(&name, "run id does not match the file name");
            continue;
        }
        out.push(run);
    }
    out
}

fn mark_orphaned(run: &mut Run) {
    if run.state != RunState::Orphaned {
        run.previous_state = Some(run.state);
    }
    run.state = RunState::Orphaned;
}

pub(crate) fn load_orphans(dir: &Path, skip: impl FnMut(&str, &str)) -> Vec<Run> {
    let mut runs = read_run_files(dir, skip);
    runs.iter_mut().for_each(mark_orphaned);
    runs
}

/// 복원한 Run 은 다시 돌지 않는다 — 끝난 기록 밖은 orphaned.
pub(crate) fn restored(run: &mut Run) {
    if !matches!(run.state, RunState::Done | RunState::Stopped) {
        mark_orphaned(run);
    }
    run.archived_at = None;
}

pub(crate) fn archive_dir(dir: &Path) -> PathBuf {
    dir.join("archived")
}

/// [보관]은 지우지 않고 옮긴다(되돌릴 수 있게).
pub(crate) fn archive(dir: &Path, run_id: &str) -> Result<(), String> {
    let from = dir.join(file_name(run_id));
    if !from.exists() {
        return Ok(());
    }
    let to_dir = archive_dir(dir);
    std::fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
    std::fs::rename(&from, to_dir.join(file_name(run_id))).map_err(|e| e.to_string())
}

pub(crate) fn load_archived(dir: &Path, skip: impl FnMut(&str, &str)) -> Vec<Run> {
    read_run_files(&archive_dir(dir), skip)
}

/// `run_id` 는 부르는 쪽이 [`is_id`] 로 이미 걸렀다(경로 탈출 없음).
pub(crate) enum ArchivedRead {
    Missing,
    /// 사유에 파일 내용을 싣지 않는다.
    Unreadable(String),
    Found(Box<Run>),
}

pub(crate) fn read_archived(dir: &Path, run_id: &str) -> ArchivedRead {
    let bytes = match std::fs::read(archive_dir(dir).join(file_name(run_id))) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ArchivedRead::Missing,
        Err(e) => return ArchivedRead::Unreadable(format!("read: {}", e.kind())),
    };
    match decode(&bytes) {
        Ok(run) if run.id == run_id => ArchivedRead::Found(Box::new(run)),
        Ok(_) => ArchivedRead::Unreadable("run id does not match the file name".into()),
        Err(e) => ArchivedRead::Unreadable(e),
    }
}

pub(crate) fn unarchive(dir: &Path, run_id: &str) -> Result<(), String> {
    std::fs::rename(archive_dir(dir).join(file_name(run_id)), dir.join(file_name(run_id))).map_err(|e| e.to_string())
}

pub(crate) fn remove_archived(dir: &Path, run_id: &str) -> Result<(), String> {
    std::fs::remove_file(archive_dir(dir).join(file_name(run_id))).map_err(|e| e.to_string())
}
