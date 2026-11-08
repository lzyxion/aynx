//! 로컬 → 원격(업로드) — 올릴 수 있는 항목 · 로컬 권한 비트 · 훑어 계획 세우기 · 걸음 실행.

use std::path::{Path, PathBuf};

use russh_sftp::client::SftpSession;

use crate::fs_transfer::{Cancel, Kind, OnConflict, Progress};
use crate::i18n::tr;
use crate::local_browser::show;
use crate::sftp::forget;

use super::*;

// ── 로컬 → 원격 (업로드) ───────────────────────────────────────────────────

/// 올릴 로컬 항목 하나 — **디렉터리와 보통 파일만**이다.
///
/// 심링크는 **가리키는 것이 파일일 때만** 그 내용을 올린다. 디렉터리 링크를 따라가면
/// 순환으로 트리가 끝나지 않을 수 있고, 원격에 링크를 다시 만드는 길은 [`copyable`] 이
/// 설명한 이유로 닫혀 있다.
pub(super) fn uploadable(path: &Path) -> Option<(Kind, u64)> {
    let meta = std::fs::metadata(path).ok()?; // 링크를 따라간 뒤의 정보
    if meta.is_dir() {
        let raw = std::fs::symlink_metadata(path).ok()?;
        return (!raw.file_type().is_symlink()).then_some((Kind::Dir, 0));
    }
    meta.is_file().then_some((Kind::File, meta.len()))
}

/// 유닉스 권한 비트 (윈도우에는 그런 값이 없으므로 `None`).
#[cfg(unix)]
pub(super) fn local_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
pub(super) fn local_mode(_path: &Path) -> Option<u32> {
    None
}

/// 로컬 트리를 훑어 업로드 계획을 세운다.
pub(super) async fn plan_upload(
    sftp: &SftpSession,
    sources: &[PathBuf],
    dest: &str,
    on_conflict: OnConflict,
    cancel: &Cancel,
) -> Result<Plan, String> {
    let mut plan = Plan::default();
    let mut stack: Vec<(PathBuf, String, bool, bool)> = sources
        .iter()
        .rev()
        .map(|path| (path.clone(), dest.to_string(), true, false))
        .collect();

    while let Some((source, parent, top, parent_fresh)) = stack.pop() {
        cancel.check()?;
        let Some((kind, size)) = uploadable(&source) else {
            continue;
        };
        let name = source
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| {
                tr!(
                    ko: "{what} 의 이름을 읽지 못했습니다",
                    en: "Could not read the name of {what}",
                    what = show(&source),
                )
            })?;
        let placed = if parent_fresh {
            Some(fresh_place(&parent, &name))
        } else {
            place_remote(sftp, &parent, &name, kind, on_conflict).await?
        };
        let Some((target, clear, existed)) = placed else {
            continue;
        };
        if top {
            plan.top(show(&source), target.clone(), !existed || clear);
        }

        if kind.is_dir() {
            plan.steps.push(Step::Dir {
                target: target.clone(),
                clear,
                existed,
            });
            let read = std::fs::read_dir(&source).map_err(|e| {
                tr!(
                    ko: "{what} 목록을 읽지 못했습니다: {e}",
                    en: "Could not list {what}: {e}",
                    what = show(&source),
                )
            })?;
            let mut children: Vec<PathBuf> = read
                .filter_map(|item| item.ok().map(|item| item.path()))
                .collect();
            children.sort();
            let fresh = !existed || clear;
            for child in children.into_iter().rev() {
                stack.push((child, target.clone(), false, fresh));
            }
        } else {
            plan.files += 1;
            plan.bytes += size;
            plan.steps.push(Step::File {
                source: show(&source),
                target,
                clear,
                existed,
                mode: local_mode(&source),
            });
        }
    }
    Ok(plan)
}

/// 계획의 **걸음 한 토막**을 실행한다 (로컬 → 원격).
pub(super) async fn run_upload(
    session: u32,
    sftp: &SftpSession,
    steps: &[Step],
    cancel: &Cancel,
    progress: &mut Progress,
) -> Result<(), String> {
    for step in steps {
        cancel.check()?;
        match step {
            Step::Dir {
                target,
                clear,
                existed,
            } => ensure_remote_dir(session, sftp, target, *clear, *existed).await?,
            Step::File {
                source,
                target,
                clear,
                existed,
                mode,
            } => {
                if *clear {
                    remove_remote_any(session, sftp, target).await?;
                }
                let fresh = !*existed || *clear;
                progress.start(target);

                let mut input = tokio::fs::File::open(source).await.map_err(|e| {
                    tr!(
                        ko: "{source} 을(를) 열지 못했습니다: {e}",
                        en: "Could not open {source}: {e}",
                    )
                })?;
                let mut output = match sftp.create(target.clone()).await {
                    Ok(file) => file,
                    Err(e) => {
                        return Err(fail(
                            session,
                            e,
                            &tr!(
                                ko: "{target} 을(를) 만들지 못했습니다",
                                en: "Could not create {target}",
                            ),
                        )
                        .await)
                    }
                };
                let moved = pump(&mut input, &mut output, cancel, progress).await;
                let _ = output.close().await;
                if let Err(message) = moved {
                    if fresh {
                        let _ = sftp.remove_file(target.clone()).await;
                    }
                    if !crate::errors::is_cancelled(&message) {
                        forget(session).await;
                    }
                    return Err(format!("{source} → {target}: {message}"));
                }

                try_set_mode(sftp, target, *mode).await;
                progress.file_done();
            }
        }
    }
    Ok(())
}
