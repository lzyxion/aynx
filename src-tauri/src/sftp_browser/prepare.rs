//! 묶음 작업의 경로 준비 — 원격 안 · 서버 둘 · 업로드 · 다운로드 (자기 하위로 넣기 막기 · 목적지 디렉터리 확인).

use std::path::PathBuf;
use std::sync::Arc;

use russh_sftp::client::SftpSession;

use crate::i18n::tr;
use crate::local_browser::show;
use crate::sftp::sftp_of;

use super::*;

// ── 경로 준비 ──────────────────────────────────────────────────────────────

/// 원격 목적지와 원본들을 절대 경로로 푼다 — **자기 자신·자기 하위로 넣는 요청은 여기서
/// 막는다**. 돌려주는 세 번째 값은 보호 판정에 쓸 홈이다.
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

/// **서로 다른 두 서버**의 경로를 각자의 홈으로 푼다. 돌려주는 값은
/// `(목적지 절대 경로, 원본 절대 경로들, 원본 쪽 홈)` 이다.
///
/// 자기 하위 판정([`is_within`])이 없는 이유: 서버가 다르면 글자가 같아도 같은 자리가
/// 아니다 — `/srv/a` 를 다른 서버의 `/srv/a/b` 로 넣는 것은 자기 안에 넣는 것이 아니라
/// **남의 서버에 놓는 것**이다. 그래서 같은 세션끼리는 부르는 쪽에서 아예 이 길로 오지
/// 않고 [`prepare_remote`] 를 타는 명령([`sftp_copy`]·[`sftp_move`])에 위임한다.
///
/// 원본 쪽 홈을 함께 주는 이유는 이동 때문이다 — 옮기고 나서 지울 원본이 **원본 서버의**
/// 루트·홈인지 판정해야 한다([`is_protected`]).
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

/// 업로드(로컬 → 원격)의 준비 — 채널 하나, 원격 목적지, 로컬 원본들.
/// 복사([`sftp_upload_paths`])와 이동([`local_to_sftp_move`](super::cross::local_to_sftp_move))이 같은 몸통을 탄다.
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

/// 다운로드(원격 → 로컬)의 준비 — 채널 하나, 로컬 목적지, 원격 원본들, 그리고 원격 홈
/// (이동이 옮긴 뒤 지울 원본의 루트·홈 보호를 판정하는 데 쓴다).
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
