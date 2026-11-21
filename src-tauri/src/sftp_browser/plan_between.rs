//! 원격 → 원격(같은 서버 · 서버 A → B) — 훑어 계획 세우기 · 파일 하나 흘리기 · 디렉터리 만들기 · 걸음 실행.

use russh_sftp::client::SftpSession;

use crate::fs_transfer::{Cancel, OnConflict, Progress};
use crate::i18n::tr;
use crate::sftp::{forget, join_remote};

use super::*;

// ── 원격 → 원격 ────────────────────────────────────────────────────────────

/// 원격 트리를 훑어 계획을 세운다 — 훑기는 `src`, 자리 정하기는 `dst`(같은 세션이면 서버 안 복사).
pub(super) async fn plan_between(
    src: Side<'_>,
    dst: Side<'_>,
    sources: &[String],
    dest: &str,
    on_conflict: OnConflict,
    cancel: &Cancel,
) -> Result<Plan, String> {
    let mut plan = Plan::default();
    // (원본, 놓일 부모, 최상위인가, 그 부모가 빈자리인가). 뒤에서부터 넣어 이름순으로 본다.
    let mut stack: Vec<(String, String, bool, bool)> = sources
        .iter()
        .rev()
        .map(|path| (path.clone(), dest.to_string(), true, false))
        .collect();

    while let Some((source, parent, top, parent_fresh)) = stack.pop() {
        cancel.check()?;
        let meta = match src.sftp.symlink_metadata(source.clone()).await {
            Ok(meta) => meta,
            Err(e) => {
                return Err(fail(
                    src.id,
                    e,
                    &tr!(ko: "{source} 을(를) 찾지 못했습니다", en: "Could not find {source}"),
                )
                .await)
            }
        };
        // 심링크·특수 파일은 계획에 담기지 않는다 (`copyable` 주석).
        let Some((kind, size)) = copyable(&meta) else {
            continue;
        };
        let placed = if parent_fresh {
            Some(fresh_place(&parent, leaf_name(&source)))
        } else {
            place_remote(dst.sftp, &parent, leaf_name(&source), kind, on_conflict).await?
        };
        let Some((target, clear, existed)) = placed else {
            continue;
        };
        if top {
            plan.top(source.clone(), target.clone(), !existed || clear);
        }
        // 제자리 요청은 아무것도 하지 않는다 — `Overwrite` 가 원본을 잘라 놓고 그 잘린 파일을 읽는 사고를 막는다. 같은 서버일 때만 같은 자리다.
        if src.id == dst.id && target == source {
            continue;
        }

        if kind.is_dir() {
            plan.steps.push(Step::Dir {
                target: target.clone(),
                clear,
                existed,
            });
            let read =
                match src.sftp.read_dir(source.clone()).await {
                    Ok(read) => read,
                    Err(e) => return Err(fail(
                        src.id,
                        e,
                        &tr!(ko: "{source} 목록을 읽지 못했습니다", en: "Could not list {source}"),
                    )
                    .await),
                };
            let mut children: Vec<String> = read
                .map(|entry| join_remote(&source, &entry.file_name()))
                .collect();
            children.sort();
            // 자리를 비우고 만들 디렉터리 아래에는 부딪힐 것이 없다.
            let fresh = !existed || clear;
            for child in children.into_iter().rev() {
                stack.push((child, target.clone(), false, fresh));
            }
        } else {
            plan.files += 1;
            plan.bytes += size;
            plan.steps.push(Step::File {
                source,
                target,
                clear,
                existed,
                mode: meta.permissions,
            });
        }
    }
    Ok(plan)
}

/// 서버측 복사가 없어 바이트가 우리를 거친다(서버가 다르면 A 에서 받아 곧바로 B 로) — 중간 파일 없이 버퍼 하나뿐이다.
pub(super) async fn copy_remote_file(
    src: Side<'_>,
    dst: Side<'_>,
    step: (&str, &str, bool),
    cancel: &Cancel,
    progress: &mut Progress,
) -> Result<(), String> {
    let (source, target, fresh) = step;
    let mut input = match src.sftp.open(source.to_string()).await {
        Ok(file) => file,
        Err(e) => {
            return Err(fail(
                src.id,
                e,
                &tr!(ko: "{source} 을(를) 열지 못했습니다", en: "Could not open {source}"),
            )
            .await)
        }
    };
    let mut output = match dst.sftp.create(target.to_string()).await {
        Ok(file) => file,
        Err(e) => {
            let _ = input.close().await;
            return Err(fail(
                dst.id,
                e,
                &tr!(ko: "{target} 을(를) 만들지 못했습니다", en: "Could not create {target}"),
            )
            .await);
        }
    };

    let moved = pump(&mut input, &mut output, cancel, progress).await;
    let _ = input.close().await;
    let _ = output.close().await;

    if let Err(message) = moved {
        // 우리가 만든 것만 치운다 — 덮어쓰던 남의 파일까지 없애지 않는다.
        if fresh {
            let _ = dst.sftp.remove_file(target.to_string()).await;
        }
        if !crate::errors::is_cancelled(&message) {
            // 어느 쪽이 죽었는지 `pump` 의 io::Error 로 가릴 수 없어 둘 다 버린다(헛되면 다음 요청이 새로 열 뿐이다).
            forget(src.id).await;
            if dst.id != src.id {
                forget(dst.id).await;
            }
        }
        return Err(format!("{source} → {target}: {message}"));
    }
    Ok(())
}

/// 이미 디렉터리면 그대로 쓴다(합치기).
pub(super) async fn ensure_remote_dir(
    session: u32,
    sftp: &SftpSession,
    target: &str,
    clear: bool,
    existed: bool,
) -> Result<(), String> {
    if clear {
        remove_remote_any(session, sftp, target).await?;
    } else if existed {
        return Ok(()); // 훑을 때 이미 디렉터리로 있던 자리다 — 만들 것이 없다
    }
    match sftp.create_dir(target.to_string()).await {
        Ok(()) => Ok(()),
        Err(e) => {
            // 훑기와 실행 사이에 누가 먼저 만들었을 수 있다 — 실패한 뒤에만 한 번 더 확인한다(`sftp_mkdir` 과 같은 규칙).
            if sftp.try_exists(target.to_string()).await.unwrap_or(false) {
                return Ok(());
            }
            Err(fail(
                session,
                e,
                &tr!(ko: "{target} 을(를) 만들지 못했습니다", en: "Could not create {target}"),
            )
            .await)
        }
    }
}

/// 이동은 최상위 항목 하나의 토막씩, 복사는 계획 전체를 넘긴다.
pub(super) async fn run_between(
    src: Side<'_>,
    dst: Side<'_>,
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
            } => ensure_remote_dir(dst.id, dst.sftp, target, *clear, *existed).await?,
            Step::File {
                source,
                target,
                clear,
                existed,
                mode,
            } => {
                if *clear {
                    remove_remote_any(dst.id, dst.sftp, target).await?;
                }
                let fresh = !*existed || *clear;
                progress.start(target);
                copy_remote_file(src, dst, (source, target, fresh), cancel, progress).await?;
                try_set_mode(dst.sftp, target, *mode).await;
                progress.file_done();
            }
        }
    }
    Ok(())
}
