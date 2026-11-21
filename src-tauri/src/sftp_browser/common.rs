//! 공통 — SFTP 오류 → 한 줄([`fail`], 전송이 죽었으면 채널 캐시 버리기) · 홈·절대 경로 풀기 · 목적지 디렉터리 확인 · 심링크 해석(8개씩 겹침).

use std::sync::Arc;

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::StatusCode;
use tokio::task::JoinSet;

use crate::fs_entry::SftpEntry;
use crate::i18n::tr;
use crate::sftp::{forget, is_transport_error, normalize_remote};

use super::*;

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/// 전송이 죽은 오류면 캐시된 채널을 버린다 — 안 그러면 한 번 끊긴 세션에서 같은 오류만 난다.
pub(crate) async fn fail(session: u32, error: SftpError, what: &str) -> String {
    fail_on(Some(session), error, what).await
}

/// [`fail`] 의 세션 없는 짝 — 캐시 밖에서 한 번 열고 닫는 채널(셸 통합 스니펫 심기)은 버릴 캐시가 없다.
pub(crate) async fn fail_on(session: Option<u32>, error: SftpError, what: &str) -> String {
    if let Some(session) = session.filter(|_| is_transport_error(&error)) {
        forget(session).await;
    }
    match &error {
        SftpError::Status(status) => {
            let line = match code_message(status.status_code) {
                Some(message) => format!("{what}: {message}"),
                None => format!("{what}: {error}"),
            };
            // 이유 코드는 감싼 바깥에 붙는다 — 사람이 읽는 줄이 `[…]` 로 시작하지 않게.
            if is_connection_lost(status.status_code) {
                crate::errors::with_reason(crate::errors::SESSION_GONE, line)
            } else {
                line
            }
        }
        _ => format!("{what}: {error}"),
    }
}

/// 서버가 **전송이 죽었다**고 말한 상태 코드인가 — 프런트가 "연결 대기" 배너로 접는 갈래.
pub(super) fn is_connection_lost(code: StatusCode) -> bool {
    matches!(code, StatusCode::NoConnection | StatusCode::ConnectionLost)
}

/// 로그인 사용자의 홈(= 상대 경로의 기준). `realpath(".")` 한 번이다.
pub(crate) async fn home_of(session: u32, sftp: &SftpSession) -> Result<String, String> {
    match sftp.canonicalize(".").await {
        Ok(home) => Ok(trim_dir(&home).to_string()),
        Err(e) => Err(fail(
            session,
            e,
            &tr!(ko: "홈 디렉터리를 찾지 못했습니다", en: "Could not find the home folder"),
        )
        .await),
    }
}

/// `realpath` 를 쓰지 않는다 — 마지막 조각의 심링크까지 따라가 `/usr/bin/python` 삭제가 `python3.12` 삭제가 된다. 홈만 앞에 붙인다.
pub(super) async fn absolute(
    session: u32,
    sftp: &SftpSession,
    path: &str,
) -> Result<String, String> {
    let normalized = normalize_remote(path)?;
    if normalized.starts_with('/') {
        return Ok(normalized);
    }
    Ok(join_home(&home_of(session, sftp).await?, &normalized))
}

/// 그 자리가 **디렉터리인가** — 묶음 작업의 목적지는 언제나 디렉터리여야 한다.
pub(super) async fn expect_dir(session: u32, sftp: &SftpSession, dest: &str) -> Result<(), String> {
    match sftp.metadata(dest.to_string()).await {
        Ok(meta) if meta.file_type().is_dir() => Ok(()),
        Ok(_) => Err(tr!(ko: "{dest} 은(는) 디렉터리가 아닙니다", en: "{dest} is not a folder")),
        Err(e) => Err(fail(
            session,
            e,
            &tr!(ko: "{dest} 을(를) 찾지 못했습니다", en: "Could not find {dest}"),
        )
        .await),
    }
}

/// 보호 대상 판단용 — 홈을 알아야 해서 절대 경로여도 `realpath(".")` 한 번을 낸다.
pub(super) async fn absolute_and_home(
    session: u32,
    sftp: &SftpSession,
    path: &str,
) -> Result<(String, String), String> {
    let home = home_of(session, sftp).await?;
    let absolute = under_home(&home, path)?;
    Ok((absolute, home))
}

/// 심링크 항목에 `symlinkTarget` · `linkIsDir` 를 채운다 — 끊어진 링크의 stat 실패는 오류가 아니다(`linkIsDir: false`).
pub(super) async fn resolve_symlinks(sftp: &Arc<SftpSession>, entries: &mut [SftpEntry]) {
    let links: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.kind == "symlink")
        .map(|(i, _)| i)
        .take(SYMLINK_LIMIT)
        .collect();

    for batch in links.chunks(SYMLINK_BATCH) {
        let mut tasks = JoinSet::new();
        for &index in batch {
            let sftp = Arc::clone(sftp);
            let path = entries[index].path.clone();
            tasks.spawn(async move {
                let (meta, target) =
                    tokio::join!(sftp.metadata(path.clone()), sftp.read_link(path));
                (
                    index,
                    meta.map(|m| m.file_type().is_dir()).unwrap_or(false),
                    target.ok(),
                )
            });
        }
        while let Some(done) = tasks.join_next().await {
            if let Ok((index, link_is_dir, target)) = done {
                entries[index].link_is_dir = link_is_dir;
                entries[index].symlink_target = target;
            }
        }
    }
}
