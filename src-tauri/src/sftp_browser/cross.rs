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
// 앞의 여섯이 못 하던 두 가지다 (docs/log/2026-09-04-fs-batch-ops-backend.md 후속 절).
//
//  1. **서버 A → 서버 B**. SFTP 에는 서버측 복사도, 서버끼리 이야기하는 길도 없다 —
//     바이트가 우리를 **두 번** 지난다 (A 에서 내려받아 곧바로 B 로 올린다). 중간 파일은
//     만들지 않는다: 청크 하나를 읽어 그대로 쓰므로 메모리에 남는 것은 버퍼 하나다.
//
//  2. **다른 곳 사이의 잘라내기**. 로컬↔원격·원격↔원격에는 `rename` 이 없으니 이동은
//     "복사한 뒤 원본 삭제" 이고, 그 둘 사이는 원자적이지 않다. 원자성의 단위를
//     **최상위 항목 하나**로 정한다 ([`Top`]) — 항목 하나가 **완전히** 복사된 뒤에야 그
//     항목의 원본을 지운다. 중간에 멈추면 그 항목은 통째로 안 옮겨진 것이 되고, 앞서
//     끝난 항목은 이미 옮겨진 것이 된다. 오류가 그 자리를 말해 준다([`move_failure`]).

/// 이동 중 한 항목이 실패했을 때 **목적지에 남은 부분물**을 치운다.
///
/// 우리가 새로 만든 자리(`fresh`)일 때만 치운다 — `overwrite` 로 남의 디렉터리에 합쳐
/// 넣던 중이었다면 그 디렉터리는 우리 것이 아니다.
pub(super) async fn undo_remote_top(dst: Side<'_>, top: &Top) {
    if top.fresh {
        let _ = remove_remote_any(dst.id, dst.sftp, &top.target).await;
    }
}

/// 서버 **A → 서버 B** 로 복사한다. 돌려주는 값은 B 에 만들어진 경로들.
///
/// `from == to` 면 [`sftp_copy`] 로 넘긴다 — 같은 서버 안에서는 자기 하위로 넣는 요청을
/// 막아야 하는데(`prepare_remote`), 서버가 다르면 그 판정 자체가 뜻이 없기 때문이다.
///
/// 두 세션의 SFTP 채널은 **한 번에 하나씩** 얻는다([`Side`] 주석) — `sftp_of` 는 전역 맵
/// 잠금을 잠깐 쥐었다 놓으므로 겹쳐 쥐는 잠금이 없고, 그래서 A→B 와 B→A 가 동시에 돌아도
/// 서로를 기다리지 않는다.
// 인자가 여덟인 것은 **한쪽이 늘었기 때문**이다 (`sftp_copy` 의 일곱 + 목적지 세션).
// 구조체로 묶으면 프런트가 보내는 JSON 이 한 겹 깊어져 나머지 여섯 명령과 모양이 달라진다.
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

/// 서버 **A → 서버 B** 로 옮긴다 (복사한 뒤 원본 삭제, **최상위 항목 단위**).
///
/// `from == to` 면 [`sftp_move`] 로 넘긴다 — 같은 서버 안에서는 `rename` 한 번이면 되므로
/// 바이트를 우리 쪽으로 끌어올 이유가 없다.
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

/// 로컬 → 원격 **이동** (올린 뒤 원본 삭제, **최상위 항목 단위**).
///
/// 원본 삭제는 [`crate::local_browser`] 의 삭제와 **같은 몸통**이라 드라이브 루트·홈
/// 보호가 그대로 선다.
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

/// 원격 → 로컬 **이동** (내려받은 뒤 원본 삭제, **최상위 항목 단위**).
///
/// 원본 삭제는 [`sftp_remove`] 와 **같은 몸통**이라 원격의 루트·홈 보호가 그대로 선다.
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
