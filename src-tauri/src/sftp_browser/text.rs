//! 명령 — 문서 보기 타일의 원격 파일 읽기 · 편집 저장(version 확인 → 임시 파일 → rename, 안 되면 제자리 덮어쓰기).
//! 덮어쓰기 저장 원시([`save_target`] · [`overwrite_remote`])는 외부 편집기 되올리기 · 셸 통합 스니펫 · 에이전트 지침도
//! 함께 탄다 — 제자리로 갈 때도 자르기 전에 새 내용 전부를 같은 폴더 임시 파일에 둔다(끊기면 오류가 그 경로를 알려 준다).

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::i18n::tr;
use crate::sftp::{forget, is_transport_error, sftp_of};
use crate::text_file::{
    assemble, preview_too_large, SavedFile, TextFile, PREVIEW_MAX_BYTES, VIEW_MAX_BYTES,
};

use super::*;

/// 문서 보기 타일이 읽는 원격 파일 한 장 ([`crate::text_file`]).
///
/// 먼저 `stat`(링크는 따라간다)으로 폴더를 거르고 전체 크기를 안 뒤, **앞
/// [`VIEW_MAX_BYTES`] 만** 읽는다 — 큰 로그를 통째로 끌어와 버리지 않는다.
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
        // 읽기 실패는 io::Error 로 감싸여 와 원인을 가릴 수 없다 — 다운로드와 같은 이유로
        // 캐시된 채널을 버린다 (헛되게 버려도 다음 요청이 새로 열 뿐이다).
        forget(session).await;
        return Err(
            tr!(ko: "{full} 을(를) 읽지 못했습니다: {e}", en: "Could not read {full}: {e}"),
        );
    }
    Ok(assemble(&bytes, meta.len()))
}

/// 미리 보기 패널의 원격 파일 한 장 — 로컬 짝 `local_read_preview` 와 같은 규칙(원시 바이트 · 상한 · 폴더 거절)
/// (docs/log/2026-10-07-file-tile-dolphin.md "10"). 세션의 SFTP 채널 캐시를 그대로 탄다.
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

/// 문서 편집의 **원격 저장** — 로컬 짝 `local_write_text` 와 같은 규칙
/// (docs/log/2026-09-27-doc-edit.md "R — 저장 명령").
///
/// ```text
///   lstat ─ 없음 → [missing]
///     └ 심링크면 realpath 로 대상 파일 (링크는 링크로 남는다; 끊긴 링크 → [missing])
///   stat(대상) ─ 폴더 → 오류 · open(WRITE) 로 쓸 수 있는지 (자르지 않는다)
///   expected 가 있으면 앞 2 MiB 를 읽어 version 비교 → 다르면 [conflict]
///   같은 폴더 .{이름}.aynx-save-* 를 CREATE|EXCLUDE 로 쓰고 → setstat(원본 권한) → 소유자 확인
///     → rename(tmp → 대상) ─ 실패(OpenSSH 는 대상이 있으면 늘 실패)
///         → rename(대상 → 백업) → rename(tmp → 대상) → 백업 지움 (둘째가 실패하면 백업을 되돌린다)
///   임시 파일을 못 만들거나 · 권한을 못 입히거나 · 소유자·그룹이 달라지면 → 제자리 덮어쓰기
///     (자르기 전에 새 내용 전부를 같은 폴더 임시 파일에 둔다 — 쓰다 끊기면 오류가 그 경로를 알려 준다)
/// ```
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

/// 덮어쓸 자리를 정한다 — `Ok(None)` 이면 파일이 없다(끊긴 링크 포함).
///
/// 마지막 조각이 링크면 대상 파일을 고른다 — tmp→rename 을 링크 자리에 하면 링크가 파일로 바뀐다.
/// 폴더는 거절하고, **쓸 수 있는가를 먼저 연다**(자르지 않는다) — 읽기 전용 파일도 폴더에 쓰기
/// 권한이 있으면 rename 으로는 바뀌어 버린다. 외부 편집기 되올리기([`crate::sftp::save_remote`])도 같은 문이다.
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

/// 원격 덮어쓰기 저장의 **한 문** — 교체([`replace_remote`])를 먼저, 안 되면 보호된 제자리 덮어쓰기
/// ([`write_remote_in_place`]). 문서 타일 · 외부 편집기 되올리기 · 셸 통합 스니펫 · 에이전트 지침이 함께 탄다.
///
/// `meta` 는 대상의 속성이다 — 없는 파일이면 기본값(권한·주인 비교 없이 임시 파일 → rename 으로 만든다).
/// `session` 은 전송이 죽었을 때 버릴 채널 캐시의 세션 — 캐시 밖 채널이면 `None`.
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

/// 교체 시도의 결과.
enum Replace {
    Done,
    /// 교체하지 않았다 — 제자리 덮어쓰기로 간다. `staged` 는 새 내용 **전부**가 이미 올라간 같은 폴더
    /// 임시 파일(권한·주인 때문에 교체만 못 한 경우) — 제자리 쓰기의 보험으로 그대로 넘긴다.
    InPlace { staged: Option<String> },
}

/// 원격 경로를 (폴더, 이름) 으로 가른다. `/` 가 없으면 상대 경로(홈 기준)라 폴더는 `.`.
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

/// 대상과 같은 폴더에 새 내용 **전부**를 담은 임시 파일(`.{이름}.aynx-save-*`)을 올린다.
/// `Ok(None)` = 임시 파일을 만들 수 없다(폴더에 쓸 수 없다 등 — 전송 오류가 아닌 거절).
/// 쓰다 실패하면 임시 파일을 지우고 오류다(원본은 아직 건드리지 않았다).
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

/// 원격 저장의 원자적 교체. 흐름은 [`sftp_write_text`] 의 그림.
///
/// `posix-rename@openssh.com` 을 쓰지 않는 이유: russh-sftp 2.4 의 `SftpSession` 은 확장
/// 요청(`extended`)을 밖에 열지 않는다(원시 세션이 비공개 필드다). 그 자리를 **백업 이름으로
/// 비켜 두는 두 번의 rename** 이 맡는다 — "원본 지우고 rename" 과 달리 둘째가 실패해도
/// 원본을 되돌릴 수 있다. 대가는 두 왕복 동안 경로가 비는 틈이다.
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

    // 만들 때 준 권한은 서버의 umask 에 깎인다 — 한 번 더 명시적으로 입힌다. 못 입히면
    // (서버가 setstat 을 거절) 교체하면 권한이 바뀌므로 제자리로 간다.
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

/// 제자리 덮어쓰기 (원격) — 주인·권한·inode 가 남는다.
///
/// `TRUNCATE` 로 연 뒤 쓰므로 쓰다 끊기면(SSH 단절·디스크 부족) 원본이 비거나 반쯤 남는다. 그래서
/// **자르기 전에** 새 내용 전부가 같은 폴더 임시 파일에 있게 한다 — `staged`(교체 시도가 남긴 것)가
/// 없으면 여기서 0600 으로 올린다. 성공하면 지우고, 쓰다 실패하면 **남겨 두고** 오류 문구가 그 경로를
/// 알려 준다: 어느 순간 끊겨도 원본이나 새 내용 전부 중 하나는 디스크에 있다. 열기가 거절되면 아직
/// 자르지 않았으니 임시 파일을 치운다(전송 오류는 잘렸는지 알 수 없어 남긴다). 폴더에 임시 파일을
/// 만들 수 없으면(쓰기 권한 없는 폴더 안의 쓸 수 있는 파일) 보험 없이 쓴다 — 알고 둔다.
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
