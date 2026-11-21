//! 명령 — 서버 A → B 복사·이동 · 로컬 ↔ 원격 이동 (복사한 뒤 원본 삭제, 원자성 단위 = 최상위 항목 하나).

use std::path::Path;

use tauri::ipc::Channel;

use crate::fs_transfer::{Cancel, OnConflict, Progress, TransferProgress};
use crate::i18n::tr;
use crate::local_browser::{remove as remove_local, remove_any};
use crate::sftp::sftp_of;

use super::*;

// ---------------------------------------------------------------------------
// 명령 — 서버 간 복사 · 다른 곳 사이의 이동
// ---------------------------------------------------------------------------
//
// SFTP 에는 서버측 복사도 서버끼리의 길도 없다 — 바이트가 우리를 두 번 지난다(중간 파일 없이 청크 하나씩).
// 다른 곳 사이의 이동은 "복사한 뒤 원본 삭제" 라 원자적이지 않다 — 원자성의 단위는 최상위 항목 하나([`Top`]): 완전히 복사된 뒤에야 그 원본을 지운다.

/// 이동 중 실패한 항목의 목적지 부분물을 치운다 — 새로 만든 자리(`fresh`)일 때만(`overwrite` 로 합쳐 넣던 남의 디렉터리는 우리 것이 아니다).
pub(super) async fn undo_remote_top(dst: Side<'_>, top: &Top) {
    if top.fresh {
        let _ = remove_remote_any(dst.id, dst.sftp, &top.target).await;
    }
}

/// `from == to` 면 [`sftp_copy`] 로 넘긴다(자기 하위 판정은 같은 서버에서만 뜻이 있다).
/// 두 채널은 한 번에 하나씩 얻는다 — 겹쳐 쥐는 잠금이 없어 A→B 와 B→A 가 서로를 기다리지 않는다.
// 인자 여덟 — 구조체로 묶으면 프런트가 보내는 JSON 이 한 겹 깊어져 다른 명령과 모양이 달라진다.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sftp_copy_between(
    app: tauri::AppHandle,
    from: u32,
    paths: Vec<String>,
    to: u32,
    dest_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    if from == to {
        return sftp_copy(app, from, paths, dest_dir, on_conflict, op, on_progress).await;
    }
    let source_sftp = sftp_of(&app, from).await?;
    let dest_sftp = sftp_of(&app, to).await?;
    let src = Side {
        id: from,
        sftp: &source_sftp,
    };
    let dst = Side {
        id: to,
        sftp: &dest_sftp,
    };
    let (dest, sources, _) = prepare_between(src, &paths, dst, &dest_dir).await?;

    let cancel = Cancel::claim(op);
    let plan = plan_between(src, dst, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);
    run_between(src, dst, &plan.steps, &cancel, &mut progress).await?;
    progress.finish();
    Ok(plan.made())
}

/// `from == to` 면 [`sftp_move`] 로 넘긴다(`rename` 한 번이면 된다).
// 인자가 여덟인 이유는 [`sftp_copy_between`] 과 같다.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sftp_move_between(
    app: tauri::AppHandle,
    from: u32,
    paths: Vec<String>,
    to: u32,
    dest_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    if from == to {
        // 진행률 막대가 떴다면 닫아 준다 — rename 은 보고할 중간이 없다.
        let mut progress = Progress::new(op, on_progress, 0, 0);
        let made = sftp_move(app, from, paths, dest_dir, on_conflict).await?;
        progress.finish();
        return Ok(made);
    }
    let source_sftp = sftp_of(&app, from).await?;
    let dest_sftp = sftp_of(&app, to).await?;
    let src = Side {
        id: from,
        sftp: &source_sftp,
    };
    let dst = Side {
        id: to,
        sftp: &dest_sftp,
    };
    let (dest, sources, home) = prepare_between(src, &paths, dst, &dest_dir).await?;
    for source in &sources {
        if is_protected(source, &home) {
            return Err(tr!(
                ko: "{source} 은(는) 옮길 수 없습니다 (루트·홈)",
                en: "{source} cannot be moved (root or home)",
            ));
        }
    }

    let cancel = Cancel::claim(op);
    let plan = plan_between(src, dst, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);

    let mut moved: Vec<String> = Vec::with_capacity(plan.tops.len());
    for index in 0..plan.tops.len() {
        let top = &plan.tops[index];
        let steps = &plan.steps[plan.span(index)];
        if let Err(e) = run_between(src, dst, steps, &cancel, &mut progress).await {
            undo_remote_top(dst, top).await;
            return Err(move_failure(moved.len(), &e));
        }
        // 여기가 원자성의 경계 — 이 항목은 **완전히** 놓였다.
        if let Err(e) = remove_at(src.id, src.sftp, &top.source, &home, true).await {
            return Err(move_failure(moved.len(), &e));
        }
        moved.push(top.target.clone());
    }
    progress.finish();
    Ok(moved)
}

/// 원본 삭제는 [`crate::local_browser`] 의 삭제와 같은 몸통이라 드라이브 루트·홈 보호가 그대로 선다.
#[tauri::command]
pub async fn local_to_sftp_move(
    app: tauri::AppHandle,
    session: u32,
    local_paths: Vec<String>,
    remote_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    let (sftp, dest, sources) = prepare_upload(&app, session, &local_paths, &remote_dir).await?;
    let dst = Side {
        id: session,
        sftp: &sftp,
    };

    let cancel = Cancel::claim(op);
    let plan = plan_upload(&sftp, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);

    let mut moved: Vec<String> = Vec::with_capacity(plan.tops.len());
    for index in 0..plan.tops.len() {
        let top = &plan.tops[index];
        let steps = &plan.steps[plan.span(index)];
        if let Err(e) = run_upload(session, &sftp, steps, &cancel, &mut progress).await {
            undo_remote_top(dst, top).await;
            return Err(move_failure(moved.len(), &e));
        }
        if let Err(e) = remove_local(&top.source, true) {
            return Err(move_failure(moved.len(), &e));
        }
        moved.push(top.target.clone());
    }
    progress.finish();
    Ok(moved)
}

/// 원본 삭제는 [`sftp_remove`] 와 같은 몸통이라 원격의 루트·홈 보호가 그대로 선다.
#[tauri::command]
pub async fn sftp_to_local_move(
    app: tauri::AppHandle,
    session: u32,
    remote_paths: Vec<String>,
    local_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    let (sftp, dest, sources, home) =
        prepare_download(&app, session, &remote_paths, &local_dir).await?;
    for source in &sources {
        if is_protected(source, &home) {
            return Err(tr!(
                ko: "{source} 은(는) 옮길 수 없습니다 (루트·홈)",
                en: "{source} cannot be moved (root or home)",
            ));
        }
    }

    let cancel = Cancel::claim(op);
    let plan = plan_download(session, &sftp, &sources, &dest, on_conflict, &cancel).await?;
    let mut progress = Progress::new(op, on_progress, plan.files, plan.bytes);

    let mut moved: Vec<String> = Vec::with_capacity(plan.tops.len());
    for index in 0..plan.tops.len() {
        let top = &plan.tops[index];
        let steps = &plan.steps[plan.span(index)];
        if let Err(e) = run_download(session, &sftp, steps, &cancel, &mut progress).await {
            // 목적지(로컬)에 남은 부분물은 **우리가 만든 자리일 때만** 치운다.
            if top.fresh {
                let _ = remove_any(Path::new(&top.target));
            }
            return Err(move_failure(moved.len(), &e));
        }
        if let Err(e) = remove_at(session, &sftp, &top.source, &home, true).await {
            return Err(move_failure(moved.len(), &e));
        }
        moved.push(top.target.clone());
    }
    progress.finish();
    Ok(moved)
}
