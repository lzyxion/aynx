//! 본문 없는 쓴 자리 기록. 계획은 읽기만 하고, 반영 결과는 현재 기록에 병합한다.
//! 단일 워크트리는 추가만 확정한다. 제거는 전체 반영이 모든 워크트리의 부재를 확인할 때 확정한다.
use super::*;

pub(super) type Written = BTreeMap<String, BTreeSet<String>>;
static REPORTED_CORRUPTION: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(super) fn path() -> Result<PathBuf, String> {
    crate::instance::data_root().map(|root| root.join("instructions-written.json"))
        .ok_or_else(|| tr!(ko: "지침 기록 폴더를 찾을 수 없습니다", en: "Could not locate the instruction history folder"))
}

pub(super) fn decode(text: &str) -> Option<Written> {
    let written: Written = serde_json::from_str(text).ok()?;
    for paths in written.values() {
        for path in paths {
            if normalize_subpath(Some(path)).ok().flatten().as_ref() != Some(path) {
                return None;
            }
        }
    }
    Some(written)
}

pub(super) fn load(path: &Path) -> Result<Written, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Written::new()),
        Err(e) => return Err(io_error(e)),
    };
    if let Some(written) = std::str::from_utf8(&bytes).ok().and_then(decode) { return Ok(written); }
    if !REPORTED_CORRUPTION.swap(true, std::sync::atomic::Ordering::Relaxed) {
        eprintln!("지침 쓴 자리 기록이 깨져 빈 기록으로 시작합니다");
    }
    Ok(Written::new())
}

pub(super) fn update(written: &mut Written, rows: &[FileChange], complete: bool) {
    // 실패 중 쓰기가 끝났을 가능성도 기록한다. 다음 전체 반영이 실제 블록을 다시 확인한다.
    for row in rows {
        let Some(subpath) = &row.subpath else { continue; };
        if row.block.is_some() && (row.attempted_write
            || matches!(row.action, Action::Create | Action::Update | Action::Unchanged))
        {
            for owner in &row.owners {
                written.entry(owner.clone()).or_default().insert(subpath.clone());
            }
        }
    }
    if !complete { return; }
    written.retain(|owner, paths| {
        paths.retain(|subpath| {
            let relevant: Vec<_> = rows.iter().filter(|row| row.owners.contains(owner)
                && (row.subpath.as_ref() == Some(subpath)
                    || (row.subpath.is_none() && matches!(row.action, Action::Error | Action::Skipped))))
                .collect();
            relevant.is_empty() || relevant.iter().any(|row| {
                row.action == Action::Error
                    || (row.action == Action::Skipped && !row.missing_subfolder)
                    || row.block.is_some()
            })
        });
        !paths.is_empty()
    });
}

pub(super) fn persist_at(path: &Path, rows: &[FileChange], complete: bool) -> Result<(), String> {
    let mut written = load(path)?;
    update(&mut written, rows, complete);
    let text = serde_json::to_string_pretty(&written).expect("지침 경로 기록 직렬화");
    write_atomic(path, &text, true)
}

/// FILE_LOCK을 잡은 블로킹 문맥에서만 호출한다.
pub(super) fn persist(rows: &[FileChange], complete: bool) -> Result<(), String> {
    persist_at(&path()?, rows, complete)
}
