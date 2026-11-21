//! 명령 — 파일 하나 다운로드: 256KiB 씩 `<local>.part` 로 흘려 담고 다 받은 뒤 rename · 진행률은 누적 바이트.

use std::time::Instant;

use russh_sftp::client::fs::File;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::i18n::tr;
use crate::sftp::{forget, sftp_of};

use super::*;

// ---------------------------------------------------------------------------
// 명령 — 다운로드
// ---------------------------------------------------------------------------

/// 통째로 읽지 않는다 — 큰 파일을 메모리에 올리지 않고, 받는 도중에 진행률을 내야 한다(읽기가 순차다).
pub(super) async fn stream_to_part(
    file: &mut File,
    part: &str,
    on_progress: &Channel<u64>,
) -> Result<u64, String> {
    let mut out = tokio::fs::File::create(part).await.map_err(|e| {
        tr!(
            ko: "{part} 를 만들지 못했습니다: {e}",
            en: "Could not create {part}: {e}",
        )
    })?;

    let mut buffer = vec![0u8; CHUNK];
    let mut total: u64 = 0;
    let mut reported: u64 = 0;
    let mut last = Instant::now();

    loop {
        let read = file.read(&mut buffer).await.map_err(|e| {
            tr!(
                ko: "원격 파일을 읽지 못했습니다: {e}",
                en: "Could not read the remote file: {e}",
            )
        })?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read]).await.map_err(|e| {
            tr!(
                ko: "{part} 에 쓰지 못했습니다: {e}",
                en: "Could not write to {part}: {e}",
            )
        })?;
        total += read as u64;

        if should_report(total - reported, last.elapsed()) {
            // 누적 총합을 보낸다 — 한 건이 유실돼도 다음 한 건이 상태를 되돌린다.
            let _ = on_progress.send(total);
            reported = total;
            last = Instant::now();
        }
    }

    out.flush().await.map_err(|e| {
        tr!(
            ko: "{part} 를 마무리하지 못했습니다: {e}",
            en: "Could not finish writing {part}: {e}",
        )
    })?;
    Ok(total)
}

/// `<local>.part` 에 쓰고 다 받은 뒤에만 rename — 끊겨도 반쯤 받은 파일이 최종 이름으로 남지 않는다. `onProgress` 는 누적 바이트(최소 100ms 간격 · 마지막에 총합).
#[tauri::command]
pub async fn sftp_download(
    app: tauri::AppHandle,
    session: u32,
    remote: String,
    local: String,
    on_progress: Channel<u64>,
) -> Result<u64, String> {
    if local.trim().is_empty() {
        return Err(tr!(ko: "저장할 로컬 경로가 없습니다", en: "No local path to save to"));
    }

    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &remote).await?;

    // 여기만 심링크를 **따라간다** — 링크를 클릭해 파일을 받는 것은 자연스러운 동작이다.
    let meta = match sftp.metadata(full.clone()).await {
        Ok(meta) => meta,
        Err(e) => {
            return Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 찾지 못했습니다", en: "Could not find {full}"),
            )
            .await)
        }
    };
    if meta.file_type().is_dir() {
        return Err(tr!(
            ko: "폴더 다운로드는 아직 지원하지 않습니다",
            en: "Downloading folders is not supported yet",
        ));
    }

    let part = part_path(&local);
    if let Some(parent) = std::path::Path::new(&part).parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            tr!(
                ko: "{what} 를 만들지 못했습니다: {e}",
                en: "Could not create {what}: {e}",
                what = parent.display(),
            )
        })?;
    }

    let mut file = match sftp.open(full.clone()).await {
        Ok(file) => file,
        Err(e) => {
            return Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 열지 못했습니다", en: "Could not open {full}"),
            )
            .await)
        }
    };

    let _ = on_progress.send(0);
    let transferred = stream_to_part(&mut file, &part, &on_progress).await;
    let _ = file.close().await;

    let total = match transferred {
        Ok(total) => total,
        Err(message) => {
            // 읽기 실패는 io::Error 로 감싸 와 원인을 가릴 수 없어 채널을 버린다 — 헛되면 다음 요청이 새로 열 뿐이다.
            forget(session).await;
            let _ = tokio::fs::remove_file(&part).await;
            return Err(message);
        }
    };

    tokio::fs::rename(&part, &local).await.map_err(|e| {
        tr!(
            ko: "{local} 로 옮기지 못했습니다: {e}",
            en: "Could not move it to {local}: {e}",
        )
    })?;
    let _ = on_progress.send(total);
    Ok(total)
}
