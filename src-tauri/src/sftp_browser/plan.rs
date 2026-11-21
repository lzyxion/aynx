//! 묶음 작업의 뼈대 — 계획 모양(`Side`·`Step`·`Top`·`Plan`) · 원격 자리 정하기(충돌·자동 이름) · 자리 비우기 · 권한 맞추기 · 네 방향 공용 흘리기(`pump`).

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, FileType};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::fs_transfer::{
    candidate_name, decide, no_free_name, Cancel, Decision, Kind, OnConflict, Progress,
    RENAME_LIMIT,
};
use crate::i18n::tr;
use crate::sftp::join_remote;

use super::*;

// ---------------------------------------------------------------------------
// 묶음 작업 (docs/log/2026-09-04-fs-batch-ops-backend.md)
// ---------------------------------------------------------------------------
//
// 훑어서 계획(`Plan`)을 만든 뒤 실행한다 — 훑는 동안 충돌 정책을 다 풀어 두므로 진행률 분모는 실제로 옮길 것만 센다.

/// 특수 파일은 파일 쪽으로 접는다 — 충돌 판정에 필요한 것은 "디렉터리인가" 뿐이다.
pub(super) fn kind_from_attributes(meta: &FileAttributes) -> Kind {
    match meta.file_type() {
        FileType::Dir => Kind::Dir,
        FileType::Symlink => Kind::Link,
        _ => Kind::File,
    }
}

/// 디렉터리와 보통 파일만 — 심링크는 `SSH_FXP_SYMLINK` 인자 순서가 규격과 OpenSSH 사이에서 뒤집혀 엉뚱한 자리에 링크가 생길 수 있어 건너뛴다. 특수 파일은 읽으면 매달린다.
pub(super) fn copyable(meta: &FileAttributes) -> Option<(Kind, u64)> {
    match meta.file_type() {
        FileType::Dir => Some((Kind::Dir, 0)),
        FileType::File => Some((Kind::File, meta.len())),
        FileType::Symlink | FileType::Other => None,
    }
}

/// `path` 가 `ancestor` 자신이거나 그 **아래**인가 (원격은 언제나 `/` 이고 대소문자를 가린다).
pub(super) fn is_within(ancestor: &str, path: &str) -> bool {
    let (ancestor, path) = (trim_dir(ancestor), trim_dir(path));
    if ancestor == path {
        return true;
    }
    if ancestor == "/" {
        return path.starts_with('/');
    }
    // 접두사 뒤에 `/` 가 와야 한다 — `/a` 는 `/ab` 의 조상이 아니다.
    path.strip_prefix(ancestor)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// 원격 그 자리에 무엇이 있는가 (**lstat** — 링크는 따라가지 않는다). 빈자리면 `None`.
pub(super) async fn remote_kind(sftp: &SftpSession, path: &str) -> Option<Kind> {
    sftp.symlink_metadata(path.to_string())
        .await
        .ok()
        .map(|meta| kind_from_attributes(&meta))
}

/// 원격 한쪽 — 서버 A → B 에서는 읽는 쪽과 쓰는 쪽 세션이 달라, 오류 때 어느 채널을 버릴지 경로마다 짝지어 다닌다.
/// 두 쪽은 `sftp_of(from)` 을 끝낸 뒤 `sftp_of(to)` 로 얻는다 — 겹쳐 쥐지 않아 A→B 와 B→A 가 서로를 기다리지 않는다.
#[derive(Clone, Copy)]
pub(super) struct Side<'a> {
    pub(super) id: u32,
    pub(super) sftp: &'a SftpSession,
}

pub(super) enum Step {
    /// 이미 디렉터리로 있으면 그대로 쓴다 = 합치기.
    Dir {
        target: String,
        clear: bool,
        existed: bool,
    },
    File {
        source: String,
        target: String,
        clear: bool,
        existed: bool,
        /// 대상이 원격일 때만 시도한다.
        mode: Option<u32>,
    },
}

/// 최상위 항목 하나 — 다른 곳 사이의 이동이 원자성을 세는 단위다(그 항목의 걸음이 전부 끝난 뒤에야 원본을 지운다).
pub(super) struct Top {
    pub(super) source: String,
    /// 자동 이름으로 밀렸을 수 있다.
    pub(super) target: String,
    /// 끝은 다음 항목의 시작이다(깊이 우선이라 겹치지 않는다).
    pub(super) start: usize,
    /// 우리가 새로 만드는 자리인가 — 실패 때 치워도 되는지를 가른다(합쳐 넣은 남의 디렉터리는 건드리지 않는다).
    pub(super) fresh: bool,
}

#[derive(Default)]
pub(super) struct Plan {
    pub(super) steps: Vec<Step>,
    /// 건너뛴 항목은 여기 없다.
    pub(super) tops: Vec<Top>,
    pub(super) files: u32,
    pub(super) bytes: u64,
}

impl Plan {
    pub(super) fn top(&mut self, source: String, target: String, fresh: bool) {
        let start = self.steps.len();
        self.tops.push(Top {
            source,
            target,
            start,
            fresh,
        });
    }

    pub(super) fn made(&self) -> Vec<String> {
        self.tops.iter().map(|top| top.target.clone()).collect()
    }

    pub(super) fn span(&self, index: usize) -> std::ops::Range<usize> {
        let start = self.tops[index].start;
        let end = self
            .tops
            .get(index + 1)
            .map_or(self.steps.len(), |next| next.start);
        start..end
    }
}

/// 첫 항목에서 멈추면 원인만 말한다. 취소도 이 길로 나가므로 프런트의 취소 판정은 부분 일치여야 한다(`fs-ops.ts` 의 `isTransferCanceled`).
pub(super) fn move_failure(done: usize, error: &str) -> String {
    if done == 0 {
        error.to_string()
    } else {
        tr!(
            ko: "{done}개 이동 완료, {next}번째에서 중단 — {error}",
            en: "Moved {done}, stopped at item {next} — {error}",
            next = done + 1,
        )
    }
}

/// `(놓을 자리, 지우고 놓는가, 이미 있던 자리인가)` — `None` 이면 건너뛴다. `Rename` 의 빈자리 찾기는 후보마다 왕복 하나다.
pub(super) async fn place_remote(
    sftp: &SftpSession,
    dir: &str,
    name: &str,
    source: Kind,
    on_conflict: OnConflict,
) -> Result<Option<(String, bool, bool)>, String> {
    let target = join_remote(dir, name);
    let existing = remote_kind(sftp, &target).await;
    match decide(existing, source, on_conflict) {
        Decision::Use { clear } => Ok(Some((target, clear, existing.is_some()))),
        Decision::Skip => Ok(None),
        Decision::Fail => Err(crate::errors::exists_choose_overwrite(&target)),
        Decision::Rename => {
            for index in 2..=RENAME_LIMIT {
                let candidate = join_remote(dir, &candidate_name(name, index, source.is_dir()));
                if remote_kind(sftp, &candidate).await.is_none() {
                    return Ok(Some((candidate, false, false)));
                }
            }
            Err(no_free_name(name))
        }
    }
}

/// 부모가 **방금 만들어질 자리**라 부딪힐 것이 없을 때의 답 (왕복 없음).
pub(super) fn fresh_place(dir: &str, name: &str) -> (String, bool, bool) {
    (join_remote(dir, name), false, false)
}

/// 원격 자리를 무엇이든 치운다 (덮어쓰기 전 자리 비우기). 없으면 성공이다.
pub(super) async fn remove_remote_any(
    session: u32,
    sftp: &SftpSession,
    path: &str,
) -> Result<(), String> {
    match remote_kind(sftp, path).await {
        None => Ok(()),
        Some(Kind::Dir) => remove_tree(session, sftp, path).await,
        // 심링크도 `remove_file` 이다 — 링크만 지운다.
        Some(_) => match sftp.remove_file(path.to_string()).await {
            Ok(()) => Ok(()),
            Err(e) => Err(fail(
                session,
                e,
                &tr!(ko: "{path} 을(를) 지우지 못했습니다", en: "Could not delete {path}"),
            )
            .await),
        },
    }
}

/// 권한을 맞춰 본다 — 실패는 복사의 실패가 아니다(setstat 거절 · mode 없는 파일시스템).
pub(super) async fn try_set_mode(sftp: &SftpSession, path: &str, mode: Option<u32>) {
    let Some(mode) = mode else { return };
    let _ = sftp
        .set_metadata(
            path.to_string(),
            FileAttributes {
                // 종류 비트를 함께 보내면 서버에 따라 거절한다 — 권한 비트만 준다.
                permissions: Some(permission_bits(mode)),
                ..Default::default()
            },
        )
        .await;
}

/// 네 방향이 다 지나는 흘리기. 취소는 abort 가 아니라 청크마다 스스로 멈춘다 — 그래야 반쯤 쓰인 파일을 부른 쪽이 치운다.
pub(super) async fn pump<R, W>(
    input: &mut R,
    output: &mut W,
    cancel: &Cancel,
    progress: &mut Progress,
) -> Result<(), String>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = vec![0u8; crate::fs_transfer::CHUNK];
    loop {
        cancel.check()?;
        let read = input
            .read(&mut buffer)
            .await
            .map_err(|e| tr!(ko: "읽지 못했습니다: {e}", en: "Could not read: {e}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .await
            .map_err(|e| tr!(ko: "쓰지 못했습니다: {e}", en: "Could not write: {e}"))?;
        progress.advance(read as u64);
    }
    output
        .flush()
        .await
        .map_err(|e| tr!(ko: "마무리하지 못했습니다: {e}", en: "Could not finish: {e}"))
}
