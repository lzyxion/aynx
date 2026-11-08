//! 명령 — 묶음 작업: 원격 안 복사 · 이동(rename) · 여럿 지우기 · 충돌 사전 조회 · 경로 업로드 · 경로 다운로드.

use tauri::ipc::Channel;

use crate::fs_transfer::{Cancel, Conflict, OnConflict, Progress, TransferProgress};
use crate::i18n::tr;
use crate::sftp::{join_remote, sftp_of};

use super::*;

// ---------------------------------------------------------------------------
// 명령 — 묶음 작업
// ---------------------------------------------------------------------------

/// 원격 안에서 **복사**한다. 돌려주는 값은 만들어진 경로들.
///
/// SFTP 에는 서버측 복사가 없다 — 바이트가 우리를 한 번 지나므로 같은 서버 안의
/// 복사도 다운로드 + 업로드만큼 걸린다. 심링크는 건너뛴다([`copyable`]).
#[tauri::command]
pub async fn sftp_copy(
    app: tauri::AppHandle,
    session: u32,
    paths: Vec<String>,
    dest_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    let sftp = sftp_of(&app, session).await?;
    let (dest, sources, _) = prepare_remote(session, &sftp, &paths, &dest_dir).await?;
    let side = Side {
        id: session,
        sftp: &sftp,
    };

    let cancel = Cancel::claim(op);
    let plan = plan_between(side, side, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);
    run_between(side, side, &plan.steps, &cancel, &mut progress).await?;
    progress.finish();
    Ok(plan.made())
}

/// 원격 안에서 **옮긴다**(`rename`). 돌려주는 값은 옮겨진 뒤의 경로들.
///
/// 이름 바꾸기 한 번이라 바이트가 움직이지 않는다 — 진행률 채널도 취소도 없다.
/// **덮어쓰기로 디렉터리를 합치지는 못한다**: SFTP 의 rename 은 대상이 있으면 실패하고,
/// 그렇다고 남의 디렉터리를 통째로 지우고 자리를 내주는 것은 사용자가 시킨 일이 아니다.
#[tauri::command]
pub async fn sftp_move(
    app: tauri::AppHandle,
    session: u32,
    paths: Vec<String>,
    dest_dir: String,
    on_conflict: OnConflict,
) -> Result<Vec<String>, String> {
    let sftp = sftp_of(&app, session).await?;
    let (dest, sources, home) = prepare_remote(session, &sftp, &paths, &dest_dir).await?;

    let mut made: Vec<String> = Vec::with_capacity(sources.len());
    for source in &sources {
        if is_protected(source, &home) {
            return Err(tr!(
                ko: "{source} 은(는) 옮길 수 없습니다 (루트·홈)",
                en: "{source} cannot be moved (root or home)",
            ));
        }
        let meta = match sftp.symlink_metadata(source.clone()).await {
            Ok(meta) => meta,
            Err(e) => {
                return Err(fail(
                    session,
                    e,
                    &tr!(ko: "{source} 을(를) 찾지 못했습니다", en: "Could not find {source}"),
                )
                .await)
            }
        };
        let kind = kind_from_attributes(&meta);

        let Some((target, clear, existed)) =
            place_remote(&sftp, &dest, leaf_name(source), kind, on_conflict).await?
        else {
            continue;
        };
        // 이미 그 자리에 있다 (같은 디렉터리로 옮기기).
        if &target == source {
            made.push(target);
            continue;
        }

        // SFTP 의 rename 은 **덮어쓰지 않는다** — 자리를 먼저 비워야 한다. 자리가 차 있는
        // 것은 `Overwrite` 뿐이다(나머지 정책은 위에서 이미 갈렸다).
        if existed {
            // `clear` 가 거짓인데 원본이 디렉터리면 **대상도 디렉터리**다 (모양이 같아
            // 지우지 않기로 한 자리). 로컬은 복사+삭제로 합치지만 원격에는 그 길이
            // 없고, 남의 디렉터리를 통째로 지우고 자리를 내주는 것은 시킨 일이 아니다.
            if kind.is_dir() && !clear {
                return Err(crate::errors::dir_exists_no_merge(&target));
            }
            remove_remote_any(session, &sftp, &target).await?;
        }

        match sftp.rename(source.clone(), target.clone()).await {
            Ok(()) => made.push(target),
            Err(e) => {
                return Err(fail(
                    session,
                    e,
                    &tr!(ko: "{source} 을(를) 옮기지 못했습니다", en: "Could not move {source}"),
                )
                .await)
            }
        }
    }
    Ok(made)
}

/// 여러 항목을 지운다 — **첫 실패에서 멈추고 어디까지 됐는지 말해 준다**
/// (루트·홈 보호는 [`sftp_remove`] 와 같다).
#[tauri::command]
pub async fn sftp_remove_many(
    app: tauri::AppHandle,
    session: u32,
    paths: Vec<String>,
    recursive: bool,
) -> Result<(), String> {
    let sftp = sftp_of(&app, session).await?;
    let home = home_of(session, &sftp).await?;

    for (done, path) in paths.iter().enumerate() {
        let full = under_home(&home, path)?;
        if let Err(e) = remove_at(session, &sftp, &full, &home, recursive).await {
            return Err(if done == 0 {
                e
            } else {
                tr!(
                    ko: "{done}개를 지운 뒤 멈췄습니다 — {e}",
                    en: "Stopped after deleting {done} items — {e}",
                )
            });
        }
    }
    Ok(())
}

/// 붙여넣기 전에 "덮어쓸까요?" 를 묻기 위한 사전 조회 — 원격 목적지에서 부딪히는 것들.
#[tauri::command]
pub async fn sftp_conflicts(
    app: tauri::AppHandle,
    session: u32,
    paths: Vec<String>,
    dest_dir: String,
) -> Result<Vec<Conflict>, String> {
    let sftp = sftp_of(&app, session).await?;
    let home = home_of(session, &sftp).await?;
    let dest = under_home(&home, &dest_dir)?;

    let mut found: Vec<Conflict> = Vec::new();
    for path in &paths {
        let source = under_home(&home, path)?;
        let target = join_remote(&dest, leaf_name(&source));
        // 제자리(원본 자신)는 충돌이 아니다.
        if target == source {
            continue;
        }
        if let Some(kind) = remote_kind(&sftp, &target).await {
            found.push(Conflict {
                path: target,
                kind: kind.label().to_string(),
            });
        }
    }
    Ok(found)
}

/// 로컬 경로 목록(파일·디렉터리)을 원격 디렉터리로 **올린다**.
///
/// `sftp::upload_file` 은 웹 표준 DnD 가 주는 **바이트**를 받는 문이고, 이쪽은
/// **경로**를 받는 문이다 (파일 대화상자·타일 간 드래그). 둘 다 결국 같은 SFTP 채널로
/// 흐르지만, 이쪽은 통째로 메모리에 올리지 않고 청크로 흘려 크기 상한이 없다.
#[tauri::command]
pub async fn sftp_upload_paths(
    app: tauri::AppHandle,
    session: u32,
    local_paths: Vec<String>,
    remote_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    let (sftp, dest, sources) = prepare_upload(&app, session, &local_paths, &remote_dir).await?;

    let cancel = Cancel::claim(op);
    let plan = plan_upload(&sftp, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);
    run_upload(session, &sftp, &plan.steps, &cancel, &mut progress).await?;
    progress.finish();
    Ok(plan.made())
}

/// 원격 경로 목록(파일·디렉터리)을 로컬 디렉터리로 **내려받는다**.
///
/// [`sftp_download`](super::download::sftp_download) 는 "이 파일을 이 이름으로" 한 건이고, 이쪽은 여러 개를 디렉터리
/// 안으로 재귀로 받는다 — 파일마다 `<대상>.part` 규칙은 같다.
#[tauri::command]
pub async fn sftp_download_paths(
    app: tauri::AppHandle,
    session: u32,
    remote_paths: Vec<String>,
    local_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    let (sftp, dest, sources, _) =
        prepare_download(&app, session, &remote_paths, &local_dir).await?;

    let cancel = Cancel::claim(op);
    let plan = plan_download(session, &sftp, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);
    run_download(session, &sftp, &plan.steps, &cancel, &mut progress).await?;
    progress.finish();
    Ok(plan.made())
}
