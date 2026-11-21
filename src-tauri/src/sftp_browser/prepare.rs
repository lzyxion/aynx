//! 묶음 작업의 경로 준비 — 원격 안 · 서버 둘 · 업로드 · 다운로드 (자기 하위로 넣기 막기 · 목적지 디렉터리 확인).

use std::path::PathBuf;
use std::sync::Arc;

use russh_sftp::client::SftpSession;

use crate::i18n::tr;
use crate::local_browser::show;
use crate::sftp::sftp_of;

use super::*;

// ── 경로 준비 ──────────────────────────────────────────────────────────────

/// 자기 자신·자기 하위로 넣는 요청은 여기서 막는다. 세 번째 값은 보호 판정에 쓸 홈이다.
pub(super) async fn prepare_remote(
    session: u32,
    sftp: &SftpSession,
    paths: &[String],
    dest_dir: &str,
) -> Result<(String, Vec<String>, String), String> {
    if paths.is_empty() {
        return Err(tr!(ko: "옮길 항목이 없습니다", en: "There is nothing to move"));
    }
    let home = home_of(session, sftp).await?;
    let dest = under_home(&home, dest_dir)?;
    expect_dir(session, sftp, &dest).await?;

    let mut sources: Vec<String> = Vec::with_capacity(paths.len());
    for path in paths {
        let source = under_home(&home, path)?;
        if is_within(&source, &dest) {
            return Err(tr!(
                ko: "{source} 을(를) 자기 자신(이나 그 안)으로는 넣을 수 없습니다",
                en: "{source} cannot be put inside itself",
            ));
        }
        sources.push(source);
    }
    Ok((dest, sources, home))
}

/// 서로 다른 두 서버의 경로를 각자의 홈으로 푼다 — `(목적지, 원본들, 원본 쪽 홈)`.
/// 자기 하위 판정이 없다 — 서버가 다르면 글자가 같아도 같은 자리가 아니다(같은 세션은 부르는 쪽이 [`prepare_remote`] 쪽 명령으로 보낸다). 원본 쪽 홈은 이동 뒤 원본 서버의 루트·홈 보호 판정에 쓴다.
pub(super) async fn prepare_between(
    src: Side<'_>,
    paths: &[String],
    dst: Side<'_>,
    dest_dir: &str,
) -> Result<(String, Vec<String>, String), String> {
    if paths.is_empty() {
        return Err(tr!(ko: "옮길 항목이 없습니다", en: "There is nothing to move"));
    }
    let dest_home = home_of(dst.id, dst.sftp).await?;
    let dest = under_home(&dest_home, dest_dir)?;
    expect_dir(dst.id, dst.sftp, &dest).await?;

    let src_home = home_of(src.id, src.sftp).await?;
    let mut sources: Vec<String> = Vec::with_capacity(paths.len());
    for path in paths {
        sources.push(under_home(&src_home, path)?);
    }
    Ok((dest, sources, src_home))
}

pub(super) async fn prepare_upload(
    app: &tauri::AppHandle,
    session: u32,
    local_paths: &[String],
    remote_dir: &str,
) -> Result<(Arc<SftpSession>, String, Vec<PathBuf>), String> {
    if local_paths.is_empty() {
        return Err(tr!(ko: "올릴 항목이 없습니다", en: "There is nothing to upload"));
    }
    let sources: Vec<PathBuf> = local_paths
        .iter()
        .map(|path| crate::local_browser::link_path(path))
        .collect::<Result<_, _>>()?;

    let sftp = sftp_of(app, session).await?;
    let dest = absolute(session, &sftp, remote_dir).await?;
    expect_dir(session, &sftp, &dest).await?;
    Ok((sftp, dest, sources))
}

/// 네 번째 값(원격 홈)은 이동이 옮긴 뒤 지울 원본의 루트·홈 보호 판정에 쓴다.
pub(super) async fn prepare_download(
    app: &tauri::AppHandle,
    session: u32,
    remote_paths: &[String],
    local_dir: &str,
) -> Result<(Arc<SftpSession>, PathBuf, Vec<String>, String), String> {
    if remote_paths.is_empty() {
        return Err(tr!(ko: "내려받을 항목이 없습니다", en: "There is nothing to download"));
    }
    let dest = crate::local_browser::real_path(local_dir)?;
    if !dest.is_dir() {
        return Err(tr!(
            ko: "{what} 은(는) 디렉터리가 아닙니다",
            en: "{what} is not a folder",
            what = show(&dest),
        ));
    }

    let sftp = sftp_of(app, session).await?;
    let home = home_of(session, &sftp).await?;
    let mut sources: Vec<String> = Vec::with_capacity(remote_paths.len());
    for path in remote_paths {
        sources.push(under_home(&home, path)?);
    }
    Ok((sftp, dest, sources, home))
}
