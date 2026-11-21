//! 명령 — 고치기: 새 폴더 · 새 파일 · 이름 바꾸기 · 지우기(루트·홈 보호, 트리는 아래에서 위로 · 심링크는 링크만).

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;

use crate::i18n::tr;
use crate::sftp::{join_remote, sftp_of};

use super::*;

// ---------------------------------------------------------------------------
// 명령 — 고치기
// ---------------------------------------------------------------------------

/// `CREATE | EXCLUDE` 라 이미 있으면 서버가 거절하고 덮어쓰지 않는다. 권한은 서버 기본(umask).
#[tauri::command]
pub async fn sftp_create_file(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<String, String> {
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;

    match sftp
        .open_with_flags(full.clone(), OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE)
        .await
    {
        Ok(file) => {
            drop(file);
            Ok(full)
        }
        Err(e) => {
            // `sftp_mkdir` 과 같은 규칙 — "이미 있음" 은 실패한 뒤에만 한 번 더 확인해 가른다.
            if sftp.try_exists(full.clone()).await.unwrap_or(false) {
                return Err(crate::errors::exists(&full));
            }
            Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 만들지 못했습니다", en: "Could not create {full}"),
            )
            .await)
        }
    }
}

#[tauri::command]
pub async fn sftp_mkdir(
    app: tauri::AppHandle,
    session: u32,
    path: String,
) -> Result<String, String> {
    let sftp = sftp_of(&app, session).await?;
    let full = absolute(session, &sftp, &path).await?;

    match sftp.create_dir(full.clone()).await {
        Ok(()) => Ok(full),
        Err(e) => {
            // SFTP v3 에는 "이미 있음" 코드가 없다 — 실패한 뒤에만 한 번 더 확인해 문구를 가른다(성공 경로에 왕복이 안 붙는다).
            if sftp.try_exists(full.clone()).await.unwrap_or(false) {
                return Err(crate::errors::exists(&full));
            }
            Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 만들지 못했습니다", en: "Could not create {full}"),
            )
            .await)
        }
    }
}

/// 대상이 이미 있으면 거절한다 — SFTP v3 의 `SSH_FXP_RENAME` 은 덮어쓰기를 정의하지 않는다.
#[tauri::command]
pub async fn sftp_rename(
    app: tauri::AppHandle,
    session: u32,
    from: String,
    to: String,
) -> Result<String, String> {
    let sftp = sftp_of(&app, session).await?;
    let (source, home) = absolute_and_home(session, &sftp, &from).await?;
    let target = under_home(&home, &to)?;

    if is_protected(&source, &home) {
        return Err(tr!(
            ko: "{source} 은(는) 이름을 바꿀 수 없습니다 (루트·홈)",
            en: "{source} cannot be renamed (root or home)",
        ));
    }
    if source == target {
        return Ok(target);
    }
    if sftp.try_exists(target.clone()).await.unwrap_or(false) {
        return Err(crate::errors::exists_pick_another_name(&target));
    }

    match sftp.rename(source.clone(), target.clone()).await {
        Ok(()) => Ok(target),
        Err(e) => Err(fail(
            session,
            e,
            &tr!(ko: "{source} 이름을 바꾸지 못했습니다", en: "Could not rename {source}"),
        )
        .await),
    }
}

/// 트리를 아래에서 위로 지운다(명시적 스택 — `async fn` 재귀는 박싱이 필요하다).
/// 심링크는 따라가지 않는다 — readdir 속성이 `lstat` 이라 링크만 지워진다(트리 밖 남의 디렉터리를 지우는 사고를 막는 자리).
pub(super) async fn remove_tree(
    session: u32,
    sftp: &SftpSession,
    root: &str,
) -> Result<(), String> {
    let mut stack: Vec<(String, bool)> = vec![(root.to_string(), false)];

    while let Some((dir, visited)) = stack.pop() {
        if visited {
            if let Err(e) = sftp.remove_dir(dir.clone()).await {
                return Err(fail(
                    session,
                    e,
                    &tr!(ko: "{dir} 을(를) 지우지 못했습니다", en: "Could not delete {dir}"),
                )
                .await);
            }
            continue;
        }

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

        stack.push((dir.clone(), true));
        for entry in read {
            let child = join_remote(&dir, &entry.file_name());
            if entry.file_type().is_dir() {
                stack.push((child, false));
            } else if let Err(e) = sftp.remove_file(child.clone()).await {
                return Err(fail(
                    session,
                    e,
                    &tr!(ko: "{child} 을(를) 지우지 못했습니다", en: "Could not delete {child}"),
                )
                .await);
            }
        }
    }
    Ok(())
}

/// 심링크는 링크만 지운다. `recursive` 는 항목 하나에 왕복 하나라 큰 트리는 오래 걸린다. 루트(`/`)와 홈은 어떤 경우에도 거절한다.
#[tauri::command]
pub async fn sftp_remove(
    app: tauri::AppHandle,
    session: u32,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let sftp = sftp_of(&app, session).await?;
    let (full, home) = absolute_and_home(session, &sftp, &path).await?;
    remove_at(session, &sftp, &full, &home, recursive).await
}

/// [`sftp_remove_many`] 도 이 몸통을 타야 보호 규칙(루트·홈)과 "비어 있지 않다" 문구가 한 자리에만 산다.
pub(super) async fn remove_at(
    session: u32,
    sftp: &SftpSession,
    full: &str,
    home: &str,
    recursive: bool,
) -> Result<(), String> {
    let full = full.to_string();
    if is_protected(&full, home) {
        return Err(tr!(
            ko: "{full} 은(는) 지울 수 없습니다 (루트·홈 디렉터리)",
            en: "{full} cannot be deleted (root or home folder)",
        ));
    }

    // lstat 이라 심링크는 심링크로 보인다 — 링크를 따라가 남의 파일을 지우지 않는다.
    let meta = match sftp.symlink_metadata(full.clone()).await {
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

    if !meta.file_type().is_dir() {
        return match sftp.remove_file(full.clone()).await {
            Ok(()) => Ok(()),
            Err(e) => Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 지우지 못했습니다", en: "Could not delete {full}"),
            )
            .await),
        };
    }

    if recursive {
        return remove_tree(session, sftp, &full).await;
    }

    match sftp.remove_dir(full.clone()).await {
        Ok(()) => Ok(()),
        Err(e) => {
            // v3 에는 ENOTEMPTY 가 없다 — 실패한 뒤 한 번 들여다보고 "비어 있지 않다" 를 확정한다.
            let non_empty = sftp
                .read_dir(full.clone())
                .await
                .map(|mut d| d.next().is_some())
                .unwrap_or(false);
            if non_empty {
                return Err(crate::errors::not_empty(&full));
            }
            Err(fail(
                session,
                e,
                &tr!(ko: "{full} 을(를) 지우지 못했습니다", en: "Could not delete {full}"),
            )
            .await)
        }
    }
}
