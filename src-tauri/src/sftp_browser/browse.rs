//! 명령 — 둘러보기: 홈 · 목록 · 항목 하나(`lstat`) · 남은 공간(`statvfs@openssh.com`).

use crate::fs_entry::{sort_entries, SftpEntry};
use crate::fs_space::DiskSpace;
use crate::i18n::tr;
use crate::sftp::{join_remote, sftp_of};

use super::*;

// ---------------------------------------------------------------------------
// 명령 — 둘러보기
// ---------------------------------------------------------------------------

/// 브라우저가 처음 열 자리 — 로그인 사용자의 홈(`realpath(".")`).
#[tauri::command]
pub async fn sftp_home(app: tauri::AppHandle, session: u32) -> Result<String, String> {
    let sftp = sftp_of(&app, session).await?;
    home_of(session, &sftp).await
}

/// 디렉터리 하나의 목록. `~`·상대 경로는 홈 기준으로 풀고, `.`/`..` 항목은 빼고 준다.
#[tauri::command]
pub async fn sftp_list(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let sftp = sftp_of(&app, session).await?;
    let dir = absolute(session, &sftp, &path).await?;

    let read = match sftp.read_dir(dir.clone()).await {
        Ok(read) => read,
        Err(e) => {
            return Err(fail(
                session,
                e,
                &tr!(ko: "{dir} 목록을 읽지 못했습니다", en: "Could not list {dir}"),
            )
            .await)
        }
    };

    // readdir 이 이름과 속성을 함께 준다 — 여기서 항목마다 stat 을 더 부르지 않는다.
    // (`ReadDir` 이터레이터는 `.` 과 `..` 을 이미 걸러 준다.)
    let mut entries: Vec<SftpEntry> = read
        .map(|entry| {
            let name = entry.file_name();
            let full = join_remote(&dir, &name);
            entry_from(name, full, &entry.metadata())
        })
        .collect();

    resolve_symlinks(&sftp, &mut entries).await;
    sort_entries(&mut entries);
    Ok(entries)
}

/// 항목 하나의 정보 (작업 뒤 새로고침·상세 표시용).
///
/// **`lstat` 이다** — 심링크는 자기 자신으로 보고된다 (`kind: "symlink"`). 가리키는 곳의
/// 정보는 목록과 똑같이 `symlinkTarget` · `linkIsDir` 로 딸려 온다.
#[tauri::command]
pub async fn sftp_stat(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<SftpEntry, String> {
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;

    let meta = match sftp.symlink_metadata(full.clone()).await {
        Ok(meta) => meta,
        Err(e) => {
            return Err(fail(
                session,
                e,
                &tr!(
                    ko: "{full} 정보를 읽지 못했습니다",
                    en: "Could not read information for {full}",
                ),
            )
            .await)
        }
    };

    let mut one = [entry_from(leaf_name(&full).to_string(), full, &meta)];
    resolve_symlinks(&sftp, &mut one).await;
    let [entry] = one;
    Ok(entry)
}

/// 이 경로가 사는 볼륨의 남은 공간 — 파일 타일의 상태 줄 (docs/log/2026-10-07-file-tile-dolphin.md).
///
/// SFTP 본 규격에는 이런 질문이 없다. OpenSSH 의 확장 `statvfs@openssh.com` 을 **서버가 알린 때만** 묻고
/// (`SftpSession::fs_info` 가 확장 목록을 보고 `None` 을 준다), 모르는 서버·실패는 `Ok(None)` 이다 — 화면은 그 칸을
/// 숨긴다. 세션을 못 찾은 것만 `Err` 다(목록과 같은 갈래 — 화면이 이미 연결 대기 배너를 띄운다).
#[tauri::command]
pub async fn sftp_free_space(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<Option<DiskSpace>, String> {
    let sftp = sftp_of(&app, session).await?;
    let Ok(dir) = absolute(session, &sftp, &path).await else {
        return Ok(None);
    };
    Ok(match sftp.fs_info(dir).await {
        Ok(Some(v)) => {
            // `f_frsize` 가 0 인 서버가 있다 — 그때는 `f_bsize` 가 단위다(statvfs(3) 의 옛 의미)
            let unit = if v.fragment_size > 0 { v.fragment_size } else { v.block_size };
            DiskSpace::sane(v.blocks_avail.saturating_mul(unit), v.blocks.saturating_mul(unit))
        }
        _ => None,
    })
}
