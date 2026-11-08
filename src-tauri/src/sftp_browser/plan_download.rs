//! 원격 → 로컬(다운로드) — 받을 수 있는 항목 · 훑어 계획 세우기(원격 이름 검증 F1) · 걸음 실행(`.part` → rename).

use std::path::{Path, PathBuf};

use russh_sftp::client::SftpSession;

use crate::fs_transfer::{Cancel, Kind, OnConflict, Progress};
use crate::i18n::tr;
use crate::local_browser::{kind_at, place_at, remove_any, show};
use crate::sftp::{forget, join_remote};

use super::*;

// ── 원격 → 로컬 (다운로드) ─────────────────────────────────────────────────

/// 내려받을 원격 항목 하나. 심링크는 **가리키는 것이 파일일 때만** 내용을 받는다
/// ([`uploadable`] 과 같은 이유 — 디렉터리 링크는 순환을 만들 수 있다).
pub(super) async fn downloadable(sftp: &SftpSession, path: &str) -> Option<(Kind, u64)> {
    let raw = sftp.symlink_metadata(path.to_string()).await.ok()?;
    if raw.file_type().is_symlink() {
        let meta = sftp.metadata(path.to_string()).await.ok()?;
        return meta.file_type().is_file().then(|| (Kind::File, meta.len()));
    }
    copyable(&raw)
}

/// 원격 트리를 훑어 다운로드 계획을 세운다 (대상이 로컬이라 자리 정하기는 stat 이다).
///
/// **원격이 준 이름은 믿지 않는다(F1).** 서버가 목록에 `..` 나 `a/b` 같은 이름을 섞으면
/// `dest.join(name)` 이 받는 자리를 `dest` 밖으로 끌어낸다 — 악의적인/뚫린 서버 하나가
/// 사용자 디스크 아무 데나 쓰는 길이다. 그래서 [`read_dir`] 가 준 **자식 이름**을 이어
/// 붙이기 전에 [`crate::local_browser::is_bare_name`] 으로 거른다. [`leaf_name`] 은 그대로
/// 두는데, 검증이 그 앞단(자식 이름)에서 끝나 순회가 여기서 막히기 때문이다.
pub(super) async fn plan_download(
    session: u32,
    sftp: &SftpSession,
    sources: &[String],
    dest: &Path,
    on_conflict: OnConflict,
    cancel: &Cancel,
) -> Result<Plan, String> {
    let mut plan = Plan::default();
    let mut stack: Vec<(String, PathBuf, bool)> = sources
        .iter()
        .rev()
        .map(|path| (path.clone(), dest.to_path_buf(), true))
        .collect();

    while let Some((source, parent, top)) = stack.pop() {
        cancel.check()?;
        let Some((kind, size)) = downloadable(sftp, &source).await else {
            continue;
        };
        let Some((target, clear, existed)) =
            place_at(&parent, leaf_name(&source), kind, on_conflict)?
        else {
            continue;
        };
        // 벨트-앤-서스펜더(F1): 자식 이름은 아래에서 이미 걸렀고 `place_at` 도 막지만, 받는
        // 자리가 `dest` 밖으로 나갔다면 어떤 경로로 나갔든 여기서 끊는다 — 계획에 한 줄이라도
        // 들어가면 실행 단계는 그대로 쓴다.
        if !crate::local_browser::contained_in(dest, &target) {
            eprintln!(
                "[aynx] 다운로드 대상이 받을 폴더 밖입니다 — 건너뜁니다 ({:?})",
                show(&target)
            );
            continue;
        }
        if top {
            plan.top(source.clone(), show(&target), !existed || clear);
        }

        if kind.is_dir() {
            plan.steps.push(Step::Dir {
                target: show(&target),
                clear,
                existed,
            });
            let read =
                match sftp.read_dir(source.clone()).await {
                    Ok(read) => read,
                    Err(e) => return Err(fail(
                        session,
                        e,
                        &tr!(ko: "{source} 목록을 읽지 못했습니다", en: "Could not list {source}"),
                    )
                    .await),
                };
            // 원격 이름 검증(F1). 수상한 항목 하나로 다운로드 전체를 죽이지는 않는다 —
            // 멀쩡한 나머지는 받고 그 항목만 버린다.
            let mut skipped = 0u32;
            let mut children: Vec<String> = Vec::new();
            for entry in read {
                let name = entry.file_name();
                if !crate::local_browser::is_bare_name(&name) {
                    // 이름에 제어문자가 섞여 있을 수 있어 Debug 로 이스케이프해 찍는다.
                    eprintln!("[aynx] SFTP 목록에 수상한 이름 — 건너뜁니다 ({name:?})");
                    skipped += 1;
                    continue;
                }
                children.push(join_remote(&source, &name));
            }
            if skipped > 0 {
                eprintln!("[aynx] {source} 목록에서 {skipped}개를 건너뛰었습니다");
            }
            children.sort();
            for child in children.into_iter().rev() {
                stack.push((child, target.clone(), false));
            }
        } else {
            plan.files += 1;
            plan.bytes += size;
            plan.steps.push(Step::File {
                source,
                target: show(&target),
                clear,
                existed,
                // 유닉스 mode 를 로컬(윈도우일 수 있다)에 그대로 씌우지 않는다.
                mode: None,
            });
        }
    }
    Ok(plan)
}

/// 계획의 **걸음 한 토막**을 실행한다 (원격 → 로컬). 파일은 `<대상>.part` 에 받고 다 받은
/// 뒤에만 옮긴다 — 중간에 끊겨도 **반쯤 받은 파일이 최종 이름으로 남지 않는다**
/// ([`sftp_download`](super::download::sftp_download) 와 같다).
pub(super) async fn run_download(
    session: u32,
    sftp: &SftpSession,
    steps: &[Step],
    cancel: &Cancel,
    progress: &mut Progress,
) -> Result<(), String> {
    for step in steps {
        cancel.check()?;
        match step {
            Step::Dir { target, clear, .. } => {
                let path = PathBuf::from(target);
                if *clear {
                    remove_any(&path)?;
                }
                // 로컬 확인은 왕복이 아니라 시스템 호출 하나다 — 훑을 때의 정보를 믿는
                // 대신 지금 한 번 더 본다 (그사이 누가 만들었을 수 있다).
                if kind_at(&path).is_none() {
                    std::fs::create_dir(&path).map_err(|e| {
                        tr!(
                            ko: "{target} 을(를) 만들지 못했습니다: {e}",
                            en: "Could not create {target}: {e}",
                        )
                    })?;
                }
            }
            Step::File {
                source,
                target,
                clear,
                ..
            } => {
                let path = PathBuf::from(target);
                if *clear {
                    remove_any(&path)?;
                }
                progress.start(target);

                let part = part_path(target);
                let mut input = match sftp.open(source.clone()).await {
                    Ok(file) => file,
                    Err(e) => {
                        return Err(fail(
                            session,
                            e,
                            &tr!(
                                ko: "{source} 을(를) 열지 못했습니다",
                                en: "Could not open {source}",
                            ),
                        )
                        .await)
                    }
                };
                let mut output = match tokio::fs::File::create(&part).await {
                    Ok(file) => file,
                    Err(e) => {
                        let _ = input.close().await;
                        return Err(tr!(
                            ko: "{part} 를 만들지 못했습니다: {e}",
                            en: "Could not create {part}: {e}",
                        ));
                    }
                };
                let moved = pump(&mut input, &mut output, cancel, progress).await;
                let _ = input.close().await;
                drop(output);

                if let Err(message) = moved {
                    let _ = tokio::fs::remove_file(&part).await;
                    if !crate::errors::is_cancelled(&message) {
                        forget(session).await;
                    }
                    return Err(format!("{source} → {target}: {message}"));
                }
                tokio::fs::rename(&part, target).await.map_err(|e| {
                    tr!(
                        ko: "{target} 로 옮기지 못했습니다: {e}",
                        en: "Could not move it to {target}: {e}",
                    )
                })?;
                progress.file_done();
            }
        }
    }
    Ok(())
}
