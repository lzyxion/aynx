//! 오케스트레이션 **영속** — Run 마다 `<데이터 루트>/orchestration/run-<id>.json` 한 파일(설계 C-7 · 10-14 결정: JSON 한 파일,
//! SQLite 아님, 자동 재개 없음).
//!
//! 불변식:
//! - 쓰기는 **원자 교체**(같은 폴더의 임시 파일 → rename — `crate::fs_atomic::write_atomic`). 읽는 쪽은 옛것 아니면 새것만 본다.
//! - 싣는 것은 `model::Run` 그대로다 — 그 자료형에 토큰 · 프롬프트 전문 · 대화 기록 · PTY 출력 칸이 **없다**(시험
//!   `run_json_has_no_tokens_or_bodies`). 판 번호 `version` 을 함께 싣는다.
//! - 읽기(서버 시작)는 파일마다 따로 — 깨진 파일 · 지원하지 않는 판 · 이름과 id 가 다른 파일은 **그 파일만** 건너뛰고 서버 로그에
//!   한 줄(파일 이름과 사유만 — 내용 · 비밀 없음).
//! - **판 집합은 {4} 하나**(앨범 먼저 설계 S2 · 13절). 옛 판 1~3은 몸을 Run으로 해석하지 않고 로그 한 줄로 건너뛴다. 파일은 남긴다.
//! - 읽은 Run 은 **`orphaned`(읽기 전용)** 으로 올린다 — 토큰은 되살리지 않는다(새 서버의 새 비밀).
//! - 사람의 [보관] 은 파일을 지우지 않고 `archived/` 로 옮긴다(되돌릴 수 있는 쪽 — 다음 시작 때 Run 으로는 읽지 않는다 · 보관함 목록 · 복원 ·
//!   영구 삭제는 `store/archive.rs` · [새 앨범]의 지난 구성 기본값은 여기서도 읽는다 — `album_start.rs` `album_defaults`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::{is_id, Run, RunState, FILE_VERSION, SUPPORTED_FILE_VERSIONS};

/// 제품의 자리 — `<data_root>/orchestration`.
pub(crate) fn store_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("orchestration"))
}

/// `run-<id>.json`.
pub(crate) fn file_name(run_id: &str) -> String {
    format!("{run_id}.json")
}

#[derive(Serialize)]
struct FileOut<'a> {
    version: u32,
    run: &'a Run,
}

/// 판만 먼저 읽는다(몸은 무시).
#[derive(Deserialize)]
struct VersionOnly {
    version: u32,
}

/// 몸(판은 [`VersionOnly`] 로 먼저 검사했다).
#[derive(Deserialize)]
struct FileIn {
    run: Run,
}

/// Run 하나를 JSON 바이트로(판 포함).
pub(crate) fn encode(run: &Run) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(&FileOut {
        version: FILE_VERSION,
        run,
    })
    .map_err(|e| e.to_string())
}

/// JSON 바이트 → Run(지원하지 않는 판이면 오류). 판을 먼저 본다 — 모르는 판의 몸은 해석하지 않는다.
pub(crate) fn decode(bytes: &[u8]) -> Result<Run, String> {
    let head: VersionOnly = serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))?;
    if !SUPPORTED_FILE_VERSIONS.contains(&head.version) {
        return Err(format!("version {} (supported {SUPPORTED_FILE_VERSIONS:?})", head.version));
    }
    let f: FileIn = serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))?;
    Ok(f.run)
}

/// 저장 실패(F7) — 분류 낱말(`kind` — 보드 · MCP 에 나가는 것은 이것뿐: `disk-full` · `permission-denied` · `read-only` · `encode-failed` ·
/// `io-error`)과 원문(`detail` — 경로 · OS 문장이 섞일 수 있어 서버 로그에만).
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

/// 사건마다 원자 교체로 쓴다. 폴더가 없으면 만든다.
pub(crate) fn save(dir: &Path, run: &Run) -> Result<(), SaveError> {
    std::fs::create_dir_all(dir).map_err(SaveError::io)?;
    let bytes = encode(run).map_err(|detail| SaveError {
        kind: "encode-failed",
        detail,
    })?;
    crate::fs_atomic::write_atomic(&dir.join(file_name(&run.id)), &bytes).map_err(SaveError::io)
}

/// 폴더의 `run-*.json` 을 파일 그대로 읽는다(상태는 건드리지 않는다). 못 읽은 파일은 `skip(파일 이름, 사유)` 로 알리고 건너뛴다.
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

/// 재시작 때 읽는 규칙 하나 — 읽기 전용(`orphaned`)으로 올리고 그 전 상태를 남긴다.
fn mark_orphaned(run: &mut Run) {
    if run.state != RunState::Orphaned {
        run.previous_state = Some(run.state);
    }
    run.state = RunState::Orphaned;
}

/// 서버 시작 — 폴더의 `run-*.json` 을 읽어 **orphaned** 로 올린다. 못 읽은 파일은 `skip(파일 이름, 사유)` 로 알리고 건너뛴다.
pub(crate) fn load_orphans(dir: &Path, skip: impl FnMut(&str, &str)) -> Vec<Run> {
    let mut runs = read_run_files(dir, skip);
    runs.iter_mut().for_each(mark_orphaned);
    runs
}

/// 복원 규칙 — 끝난 기록(done · stopped)은 그대로, 그 밖(orphaned · 옛 파일에 남은 도는 상태)은 재시작과 같이 orphaned. **다시 돌지 않는다.**
pub(crate) fn restored(run: &mut Run) {
    if !matches!(run.state, RunState::Done | RunState::Stopped) {
        mark_orphaned(run);
    }
    run.archived_at = None;
}

/// 보관함 폴더.
pub(crate) fn archive_dir(dir: &Path) -> PathBuf {
    dir.join("archived")
}

/// 사람의 [보관] — 파일을 `archived/` 로 옮긴다(없으면 조용히 끝).
pub(crate) fn archive(dir: &Path, run_id: &str) -> Result<(), String> {
    let from = dir.join(file_name(run_id));
    if !from.exists() {
        return Ok(());
    }
    let to_dir = archive_dir(dir);
    std::fs::create_dir_all(&to_dir).map_err(|e| e.to_string())?;
    std::fs::rename(&from, to_dir.join(file_name(run_id))).map_err(|e| e.to_string())
}

/// 보관함 목록의 재료 — 파일에 적힌 상태 그대로.
pub(crate) fn load_archived(dir: &Path, skip: impl FnMut(&str, &str)) -> Vec<Run> {
    read_run_files(&archive_dir(dir), skip)
}

/// 보관한 파일 하나를 읽는 결과. `run_id` 는 부르는 쪽이 [`is_id`] 로 이미 걸렀다(경로 탈출 없음).
pub(crate) enum ArchivedRead {
    Missing,
    /// 판이 맞지 않거나 깨졌다 · 이름과 id 가 다르다(사유에 내용 없음).
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

/// 보관한 파일을 다시 폴더로(복원) — 원자 이동.
pub(crate) fn unarchive(dir: &Path, run_id: &str) -> Result<(), String> {
    std::fs::rename(archive_dir(dir).join(file_name(run_id)), dir.join(file_name(run_id))).map_err(|e| e.to_string())
}

/// 보관한 파일을 지운다(영구 삭제의 끝 단계).
pub(crate) fn remove_archived(dir: &Path, run_id: &str) -> Result<(), String> {
    std::fs::remove_file(archive_dir(dir).join(file_name(run_id))).map_err(|e| e.to_string())
}
