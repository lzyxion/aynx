//! 명령 — 문서 보기 타일의 원격 파일 읽기 · 편집 저장. 덮어쓰기 저장 원시([`save_target`] · [`overwrite_remote`])는
//! 외부 편집기 되올리기 · 셸 통합 스니펫 · 에이전트 지침도 함께 탄다.

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use tauri::ipc::Channel;

use crate::fs_transfer::{Cancel, Progress, TransferProgress};
use crate::i18n::tr;
use crate::sftp::{forget, is_transport_error, sftp_of};
use crate::text_file::{
    assemble, image_too_large, preview_too_large, SavedFile, TextFile, IMAGE_MAX_BYTES,
    PREVIEW_MAX_BYTES, VIEW_MAX_BYTES,
};

use super::*;

/// 링크는 따라가 폴더를 거르고 앞 [`VIEW_MAX_BYTES`] 만 읽는다 — 큰 로그를 통째로 끌어오지 않는다.
#[tauri::command]
pub async fn sftp_read_text(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<TextFile, String> {
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;

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
            ko: "{full} 은(는) 폴더라 내용을 볼 수 없습니다",
            en: "{full} is a folder, so there is nothing to view",
        ));
    }

    let file = match sftp.open(full.clone()).await {
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
    let mut bytes: Vec<u8> = Vec::new();
    let mut bounded = file.take(VIEW_MAX_BYTES);
    let read = bounded.read_to_end(&mut bytes).await;
    let _ = bounded.into_inner().close().await;
    if let Err(e) = read {
        // 읽기 실패는 io::Error 로 감싸 와 원인을 가릴 수 없어 채널을 버린다(헛되면 다음 요청이 새로 열 뿐이다).
        forget(session).await;
        return Err(
            tr!(ko: "{full} 을(를) 읽지 못했습니다: {e}", en: "Could not read {full}: {e}"),
        );
    }
    Ok(assemble(&bytes, meta.len()))
}

/// 미리 보기 패널의 원격 파일 — 로컬 짝 `local_read_preview` 와 같은 규칙(원시 바이트 · 상한 · 폴더 거절).
#[tauri::command]
pub async fn sftp_read_preview(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;
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
            ko: "{full} 은(는) 폴더라 내용을 볼 수 없습니다",
            en: "{full} is a folder, so there is nothing to view",
        ));
    }
    if meta.len() > PREVIEW_MAX_BYTES {
        return Err(preview_too_large(&full));
    }
    let file = match sftp.open(full.clone()).await {
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
    let mut bytes: Vec<u8> = Vec::new();
    let mut bounded = file.take(PREVIEW_MAX_BYTES + 1);
    let read = bounded.read_to_end(&mut bytes).await;
    let _ = bounded.into_inner().close().await;
    if let Err(e) = read {
        forget(session).await;
        return Err(
            tr!(ko: "{full} 을(를) 읽지 못했습니다: {e}", en: "Could not read {full}: {e}"),
        );
    }
    if bytes.len() as u64 > PREVIEW_MAX_BYTES {
        return Err(preview_too_large(&full));
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// 이미지 타일의 원격 그림 — 로컬 짝 `local_read_image` 와 같은 규칙(원시 바이트 · 상한 [`IMAGE_MAX_BYTES`] · 진행률 · 취소 깃발 `op` · 폴더 거절).
/// 취소되면 다음 조각 앞에서 멈추고 읽은 것은 버린다. 미리 보기의 `sftp_read_preview` 상한은 그대로다.
#[tauri::command]
pub async fn sftp_read_image(
    app: tauri::AppHandle,
    session: u32,
    path: String,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<tauri::ipc::Response, String> {
    // 깃발을 먼저 집는다 — 채널을 여는 사이 누른 취소도 놓치지 않는다(`Cancel::claim`)
    let cancel = Cancel::claim(op);
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;
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
            ko: "{full} 은(는) 폴더라 내용을 볼 수 없습니다",
            en: "{full} is a folder, so there is nothing to view",
        ));
    }
    let total = meta.len();
    if total > IMAGE_MAX_BYTES {
        return Err(image_too_large(&full));
    }
    cancel.check()?;
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
    let mut progress = Progress::new(op, on_progress, 1, total);
    progress.start(&full);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
    let mut buffer = vec![0u8; CHUNK];
    let outcome: Result<(), String> = loop {
        if let Err(e) = cancel.check() {
            break Err(e);
        }
        let read = match file.read(&mut buffer).await {
            Ok(read) => read,
            Err(e) => {
                // 읽기 실패는 원인을 가릴 수 없다 — `sftp_read_text` 와 같이 캐시된 채널을 버린다
                forget(session).await;
                break Err(tr!(ko: "{full} 을(를) 읽지 못했습니다: {e}", en: "Could not read {full}: {e}"));
            }
        };
        if read == 0 {
            break Ok(());
        }
        if (bytes.len() + read) as u64 > IMAGE_MAX_BYTES {
            break Err(image_too_large(&full));
        }
        bytes.extend_from_slice(&buffer[..read]);
        progress.advance(read as u64);
    };
    let _ = file.close().await;
    outcome?;
    progress.file_done();
    progress.finish();
    Ok(tauri::ipc::Response::new(bytes))
}

/// 문서 편집의 원격 저장 — 로컬 짝 `local_write_text` 와 같은 규칙(docs/log/2026-09-27-doc-edit.md).
/// `expected_version` 이 있으면 앞 [`VIEW_MAX_BYTES`] 를 읽어 비교하고 다르면 충돌이다. 교체 · 제자리 규칙은 [`overwrite_remote`].
#[tauri::command]
pub async fn sftp_write_text(
    app: tauri::AppHandle,
    session: u32,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<SavedFile, String> {
    crate::text_file::check_save_size(&text)?;
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;
    let Some((target, meta)) = save_target(Some(session), &sftp, &full).await? else {
        return Err(crate::errors::missing(&full));
    };

    if let Some(expected) = expected_version.as_deref() {
        let file = match sftp.open(target.clone()).await {
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
        let mut head: Vec<u8> = Vec::new();
        let mut bounded = file.take(VIEW_MAX_BYTES);
        let read = bounded.read_to_end(&mut head).await;
        let _ = bounded.into_inner().close().await;
        if let Err(e) = read {
            forget(session).await;
            return Err(
                tr!(ko: "{full} 을(를) 읽지 못했습니다: {e}", en: "Could not read {full}: {e}"),
            );
        }
        if !crate::text_file::matches_expected(&head, meta.len(), expected) {
            return Err(crate::errors::conflict(&full));
        }
    }

    let bytes = text.as_bytes();
    overwrite_remote(Some(session), &sftp, &target, &meta, bytes, &full).await?;
    Ok(crate::text_file::saved(bytes))
}

/// `Ok(None)` 이면 파일이 없다(끊긴 링크 포함). 링크면 대상 파일을 고른다 — 링크 자리에 tmp→rename 하면 링크가 파일로 바뀐다.
/// 쓸 수 있는가를 먼저 연다(자르지 않는다) — 읽기 전용 파일도 폴더에 쓰기 권한이 있으면 rename 으로는 바뀌어 버린다.
pub(crate) async fn save_target(
    session: Option<u32>,
    sftp: &SftpSession,
    full: &str,
) -> Result<Option<(String, FileAttributes)>, String> {
    let not_found = |e: &SftpError| matches!(e, SftpError::Status(s) if s.status_code == StatusCode::NoSuchFile);
    let find_fail = tr!(ko: "{full} 을(를) 찾지 못했습니다", en: "Could not find {full}");

    let target = match sftp.symlink_metadata(full.to_string()).await {
        Ok(meta) if meta.file_type().is_symlink() => match sftp.canonicalize(full.to_string()).await {
            Ok(real) => real,
            Err(e) if not_found(&e) => return Ok(None),
            Err(e) => return Err(fail_on(session, e, &find_fail).await),
        },
        Ok(_) => full.to_string(),
        Err(e) if not_found(&e) => return Ok(None),
        Err(e) => return Err(fail_on(session, e, &find_fail).await),
    };
    let meta = match sftp.metadata(target.clone()).await {
        Ok(meta) => meta,
        Err(e) if not_found(&e) => return Ok(None),
        Err(e) => return Err(fail_on(session, e, &find_fail).await),
    };
    if meta.file_type().is_dir() {
        return Err(tr!(
            ko: "{full} 은(는) 폴더라 저장할 수 없습니다",
            en: "{full} is a folder, so it cannot be saved",
        ));
    }
    match sftp.open_with_flags(target.clone(), OpenFlags::WRITE).await {
        Ok(file) => {
            let _ = file.close().await;
        }
        Err(e) => {
            return Err(fail_on(
                session,
                e,
                &tr!(ko: "{full} 에 쓸 수 없습니다", en: "Cannot write to {full}"),
            )
            .await)
        }
    }
    Ok(Some((target, meta)))
}

/// 원격 덮어쓰기 저장의 한 문 — 같은 폴더 임시 파일 → rename 교체를 먼저, 권한·주인이 바뀌거나 임시 파일을 못 만들면 제자리 덮어쓰기.
/// `meta` 가 기본값(없는 파일)이면 비교 없이 교체로 만든다. `session` 은 전송이 죽었을 때 버릴 채널 캐시의 세션 — 캐시 밖 채널이면 `None`.
pub(crate) async fn overwrite_remote(
    session: Option<u32>,
    sftp: &SftpSession,
    target: &str,
    meta: &FileAttributes,
    bytes: &[u8],
    shown: &str,
) -> Result<(), String> {
    match replace_remote(session, sftp, target, meta, bytes, shown).await? {
        Replace::Done => Ok(()),
        Replace::InPlace { staged } => {
            write_remote_in_place(session, sftp, target, bytes, shown, staged).await
        }
    }
}

enum Replace {
    Done,
    /// `staged` = 새 내용 전부가 이미 올라간 같은 폴더 임시 파일 — 제자리 쓰기의 보험으로 넘긴다.
    InPlace { staged: Option<String> },
}

/// `/` 가 없으면 상대 경로(홈 기준)라 폴더는 `.`.
pub(super) fn split_remote(target: &str) -> (&str, &str) {
    match target.rfind('/') {
        Some(0) => ("/", &target[1..]),
        Some(at) => (&target[..at], &target[at + 1..]),
        None => (".", target),
    }
}

/// 제자리 쓰기 실패 문구 — 임시 파일을 남겼으면 그 경로를 붙인다(새 내용 전부가 거기 있다).
pub(super) fn in_place_failure(message: String, staged: Option<&str>) -> String {
    match staged {
        Some(tmp) => tr!(
            ko: "{message} — 새 내용은 {tmp} 에 있습니다",
            en: "{message} — the new contents are at {tmp}",
        ),
        None => message,
    }
}

/// 대상과 같은 폴더에 새 내용 전부를 담은 임시 파일을 올린다. `Ok(None)` = 만들 수 없다(전송 오류가 아닌 거절).
/// 쓰다 실패하면 임시 파일을 지우고 오류다(원본은 아직 그대로다).
async fn upload_temp(
    session: Option<u32>,
    sftp: &SftpSession,
    target: &str,
    mode: Option<u32>,
    bytes: &[u8],
    save_fail: &str,
) -> Result<Option<String>, String> {
    let (dir, name) = split_remote(target);
    let tmp = crate::sftp::join_remote(dir, &crate::text_file::save_temp_name(name));
    let created = sftp
        .open_with_flags_and_attributes(
            tmp.clone(),
            OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            FileAttributes {
                permissions: mode,
                ..Default::default()
            },
        )
        .await;
    let mut file = match created {
        Ok(file) => file,
        Err(e) if is_transport_error(&e) => return Err(fail_on(session, e, save_fail).await),
        Err(_) => return Ok(None),
    };
    // flush = 겹쳐 보낸 쓰기의 확인 + (서버가 지원하면) fsync, shutdown = 핸들 닫기.
    let written = async {
        file.write_all(bytes).await?;
        file.flush().await?;
        file.shutdown().await
    }
    .await;
    drop(file);
    if let Err(e) = written {
        let _ = sftp.remove_file(tmp.clone()).await;
        if let Some(session) = session {
            forget(session).await;
        }
        return Err(format!("{save_fail}: {e}"));
    }
    Ok(Some(tmp))
}

/// `posix-rename@openssh.com` 은 쓰지 않는다 — russh-sftp 2.4 `SftpSession` 이 확장 요청을 열지 않는다. 대신 백업 이름으로 비켜 두는 두 번의 rename 이다(OpenSSH 는 대상이 있으면 rename 이 실패한다).
/// 둘째가 실패해도 원본을 되돌릴 수 있다 — 대가는 두 왕복 동안 경로가 비는 틈이다.
async fn replace_remote(
    session: Option<u32>,
    sftp: &SftpSession,
    target: &str,
    meta: &FileAttributes,
    bytes: &[u8],
    shown: &str,
) -> Result<Replace, String> {
    let save_fail = tr!(ko: "{shown} 을(를) 저장하지 못했습니다", en: "Could not save {shown}");
    let mode = meta.permissions.map(permission_bits);
    let Some(tmp) = upload_temp(session, sftp, target, mode, bytes, &save_fail).await? else {
        return Ok(Replace::InPlace { staged: None }); // 폴더에 쓸 수 없다 등 — 제자리로
    };

    // 만들 때 준 권한은 umask 에 깎인다 — 다시 입히고, 못 입히면(setstat 거절) 교체가 권한을 바꾸므로 제자리로 간다.
    let keeps_identity = match mode {
        Some(mode) => sftp
            .set_metadata(
                tmp.clone(),
                FileAttributes {
                    permissions: Some(mode),
                    ..Default::default()
                },
            )
            .await
            .is_ok(),
        None => true,
    } && match (meta.uid, meta.gid) {
        // 교체하면 파일 주인이 **나**가 된다 — 주인이나 그룹이 다르면 제자리로.
        (Some(uid), Some(gid)) => sftp
            .metadata(tmp.clone())
            .await
            .map(|made| made.uid == Some(uid) && made.gid == Some(gid))
            .unwrap_or(false),
        _ => true,
    };
    if !keeps_identity {
        // 지우지 않는다 — 새 내용 전부가 이미 올라가 있어 제자리 쓰기의 보험이 된다.
        return Ok(Replace::InPlace { staged: Some(tmp) });
    }

    if sftp.rename(tmp.clone(), target.to_string()).await.is_ok() {
        return Ok(Replace::Done);
    }
    let (dir, name) = split_remote(target);
    let backup = crate::sftp::join_remote(dir, &crate::text_file::save_temp_name(name));
    if let Err(e) = sftp.rename(target.to_string(), backup.clone()).await {
        let _ = sftp.remove_file(tmp.clone()).await;
        return Err(fail_on(session, e, &save_fail).await);
    }
    if let Err(e) = sftp.rename(tmp.clone(), target.to_string()).await {
        let restored = sftp
            .rename(backup.clone(), target.to_string())
            .await
            .is_ok();
        let _ = sftp.remove_file(tmp.clone()).await;
        let message = fail_on(session, e, &save_fail).await;
        return Err(if restored {
            message
        } else {
            tr!(
                ko: "{message} — 원본은 {backup} 에 남아 있습니다",
                en: "{message} — the original is kept at {backup}",
            )
        });
    }
    let _ = sftp.remove_file(backup).await;
    Ok(Replace::Done)
}

/// 제자리 덮어쓰기 — 주인·권한·inode 가 남는다. `TRUNCATE` 라 쓰다 끊기면 원본이 비므로, 자르기 전에 새 내용 전부가 같은 폴더 임시 파일에 있게 한다.
/// 쓰다 실패하면 임시 파일을 남기고 오류가 그 경로를 알려 준다. 열기 거절이면 아직 안 잘렸으니 치운다(전송 오류는 잘렸는지 몰라 남긴다).
/// 폴더에 임시 파일을 만들 수 없으면 보험 없이 쓴다 — 알고 둔다.
async fn write_remote_in_place(
    session: Option<u32>,
    sftp: &SftpSession,
    target: &str,
    bytes: &[u8],
    shown: &str,
    staged: Option<String>,
) -> Result<(), String> {
    let save_fail = tr!(ko: "{shown} 을(를) 저장하지 못했습니다", en: "Could not save {shown}");
    let staged = match staged {
        Some(tmp) => Some(tmp),
        None => upload_temp(session, sftp, target, Some(0o600), bytes, &save_fail).await?,
    };
    let mut file = match sftp
        .open_with_flags(target.to_string(), OpenFlags::WRITE | OpenFlags::TRUNCATE)
        .await
    {
        Ok(file) => file,
        Err(e) => {
            let kept = if is_transport_error(&e) {
                staged
            } else {
                discard(sftp, staged).await;
                None
            };
            let message = fail_on(session, e, &save_fail).await;
            return Err(in_place_failure(message, kept.as_deref()));
        }
    };
    // flush = 겹쳐 보낸 쓰기의 확인 + (서버가 지원하면) fsync, shutdown = 핸들 닫기.
    let written = async {
        file.write_all(bytes).await?;
        file.flush().await?;
        file.shutdown().await
    }
    .await;
    if let Err(e) = written {
        if let Some(session) = session {
            forget(session).await;
        }
        return Err(in_place_failure(format!("{save_fail}: {e}"), staged.as_deref()));
    }
    discard(sftp, staged).await;
    Ok(())
}

/// 다 쓴 보험 임시 파일을 지운다 (실패는 무시 — 숨김 이름의 찌꺼기 하나가 남을 뿐이다).
async fn discard(sftp: &SftpSession, staged: Option<String>) {
    if let Some(tmp) = staged {
        let _ = sftp.remove_file(tmp).await;
    }
}
