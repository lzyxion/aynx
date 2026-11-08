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
// 묶음 작업 — 복사·이동·삭제·업로드·다운로드 (docs/log/2026-09-04-fs-batch-ops-backend.md)
// ---------------------------------------------------------------------------
//
// 다섯 명령이 **같은 두 단계**를 탄다: 훑어서 계획(`Plan`)을 만들고, 계획을 실행한다.
// 훑는 동안 충돌 정책을 다 풀어 두므로 진행률의 분모는 실제로 옮길 것만 센다
// (`crate::fs_transfer` 모듈 주석). 훑기가 재귀가 아니라 **명시적 스택**인 이유는
// `remove_tree` 와 같다 — `async fn` 의 재귀는 무한 크기 타입이 되어 박싱이 필요하다.

/// 속성 한 덩어리 → 종류. 특수 파일(fifo·소켓·장치)은 파일 쪽으로 접는다 — 충돌
/// 판정에서 필요한 것은 "디렉터리인가" 뿐이다.
pub(super) fn kind_from_attributes(meta: &FileAttributes) -> Kind {
    match meta.file_type() {
        FileType::Dir => Kind::Dir,
        FileType::Symlink => Kind::Link,
        _ => Kind::File,
    }
}

/// **복사 계획에 담을 수 있는가** — 디렉터리와 보통 파일만이다.
///
/// 심링크를 건너뛰는 이유는 `SSH_FXP_SYMLINK` 의 인자 순서가 규격과 OpenSSH 사이에서
/// 뒤집혀 있다는 널리 알려진 비호환 때문이다. 어느 순서로 보내든 서버에 따라 **엉뚱한
/// 자리에** 링크가 생길 수 있다 — 남의 서버에 예상 못 한 파일을 만드느니 원본을 그대로
/// 두고 건너뛰는 편이 낫다. 특수 파일은 읽으면 매달린다.
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

/// 원격 **한쪽** — 세션 번호와 그 세션의 SFTP 채널.
///
/// 서버 A → 서버 B 복사([`sftp_copy_between`](super::cross::sftp_copy_between))에서는 **읽는 쪽과 쓰는 쪽이 서로 다른
/// 세션**이다. 오류가 났을 때 어느 채널을 버릴지([`crate::sftp::forget`])가 그 둘 사이에서
/// 갈리므로, 경로마다 "이건 어느 세션 것인가" 를 짝지어 다닌다.
///
/// ## 두 세션을 함께 쥐는 순서
///
/// [`crate::sftp::sftp_of`] 는 **전역 맵 잠금을 잠깐 쥐었다 놓고** `Arc<SftpSession>` 을
/// 돌려준다 — 전송 내내 쥐고 있는 잠금이 아니다. 그래서 두 쪽을 얻을 때는 `sftp_of(from)`
/// 을 **먼저 끝내고** 그다음 `sftp_of(to)` 를 부른다 (한 번에 하나씩, 겹쳐 쥐지 않는다).
/// 겹쳐 쥐는 잠금이 없으니 A→B 와 B→A 가 동시에 돌아도 서로를 기다리지 않는다.
#[derive(Clone, Copy)]
pub(super) struct Side<'a> {
    /// 세션 번호 (오류 문구·채널 버리기에 쓴다).
    pub(super) id: u32,
    pub(super) sftp: &'a SftpSession,
}

/// 계획 한 걸음. 양쪽 경로가 다 문자열이라 **네 방향 모두** 이 모양을 쓴다
/// (원격↔원격·로컬→원격·원격→로컬).
pub(super) enum Step {
    /// 디렉터리를 만든다 (이미 디렉터리로 있으면 그대로 쓴다 = 합치기).
    Dir {
        target: String,
        clear: bool,
        existed: bool,
    },
    /// 파일 하나를 청크로 흘려 담는다.
    File {
        source: String,
        target: String,
        clear: bool,
        existed: bool,
        /// 원본의 권한 비트 (모르면 `None`). 대상이 원격일 때만 **시도**한다.
        mode: Option<u32>,
    },
}

/// 최상위 항목 하나의 몫 — **다른 곳 사이의 이동**이 원자성을 세는 단위다.
///
/// 로컬↔원격·원격↔원격에는 `rename` 이 없어 이동은 "복사한 뒤 원본 삭제" 다. 그 둘 사이가
/// 원자적이지 않으므로, 어디까지를 한 덩어리로 볼지 정해야 한다: **최상위 항목 하나**다.
/// 항목 하나의 걸음이 전부 끝난 뒤에야 그 항목의 원본을 지운다 — 중간에 멈추면 그 항목은
/// 통째로 안 옮겨진 것이 되고, 앞서 끝난 항목들은 이미 옮겨진 것이 된다.
pub(super) struct Top {
    /// 원본 경로 (이동이 성공했을 때 지울 자리).
    pub(super) source: String,
    /// 실제로 놓인 자리 (자동 이름으로 밀렸을 수 있다).
    pub(super) target: String,
    /// 이 항목의 걸음이 [`Plan::steps`] 에서 시작하는 자리. 끝은 **다음 항목의 시작**이다
    /// (훑기가 항목 하나를 끝내고 다음으로 넘어가는 깊이 우선이라 겹치지 않는다).
    pub(super) start: usize,
    /// 목적지의 그 자리를 **우리가 새로 만드는가**. 중간에 실패했을 때 치워도 되는지를
    /// 가른다 — 합쳐 넣은 남의 디렉터리는 건드리지 않는다.
    pub(super) fresh: bool,
}

/// 훑어서 만든 계획 — 실행만 남은 목록과 진행률의 분모.
#[derive(Default)]
pub(super) struct Plan {
    pub(super) steps: Vec<Step>,
    /// 최상위 항목들 (놓인 자리와 걸음 경계). 건너뛴 항목은 여기 없다.
    pub(super) tops: Vec<Top>,
    pub(super) files: u32,
    pub(super) bytes: u64,
}

impl Plan {
    /// 최상위 항목 하나가 시작한다 — 지금까지 쌓인 걸음 수가 그 항목의 시작 자리다.
    pub(super) fn top(&mut self, source: String, target: String, fresh: bool) {
        let start = self.steps.len();
        self.tops.push(Top {
            source,
            target,
            start,
            fresh,
        });
    }

    /// 최상위 항목이 **실제로 놓인** 자리들 — 복사 명령의 반환값이다.
    pub(super) fn made(&self) -> Vec<String> {
        self.tops.iter().map(|top| top.target.clone()).collect()
    }

    /// `index` 번째 최상위 항목의 걸음 범위. 마지막 항목은 계획의 끝까지다.
    pub(super) fn span(&self, index: usize) -> std::ops::Range<usize> {
        let start = self.tops[index].start;
        let end = self
            .tops
            .get(index + 1)
            .map_or(self.steps.len(), |next| next.start);
        start..end
    }
}

/// 다른 곳 사이의 이동이 중간에 멈췄을 때의 문구 — **어디까지 됐는지**가 사용자가 다음에
/// 무엇을 할지 정할 수 있는 유일한 답이다 (`remove_many` 의 "N개를 지운 뒤" 와 같은 눈금).
///
/// 첫 항목에서 멈추면 개수 대신 원인만 말한다 — 옮겨진 것이 없으니 셀 것도 없고, 원인
/// 문구에 이미 어느 경로인지가 들어 있다. 취소도 같은 길로 나가므로 프런트의 취소 판정은
/// **부분 일치**여야 한다(`fs-ops.ts` 의 `isTransferCanceled`).
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

/// 원격 목적지에서 이름을 정한다 — `(놓을 자리, 지우고 놓는가, 이미 있던 자리인가)`.
/// `None` 이면 이 항목은 건너뛴다.
///
/// **빈자리에 놓는 디렉터리 아래는 확인을 통째로 건너뛴다** ([`fresh_place`]): 방금 우리가
/// 만들 자리라 부딪힐 것이 있을 수 없고, 그 확인 하나하나가 왕복이다. 반대로 `Rename` 의
/// 빈자리 찾기는 후보마다 왕복 하나라 같은 이름이 쌓인 자리에서는 그만큼 느리다.
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

/// 원격 파일의 권한을 **맞춰 본다**. 실패는 복사의 실패가 아니다 — 서버가 setstat 을
/// 거절할 수도, 파일시스템이 mode 를 갖지 않을 수도 있다.
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

/// 한쪽에서 읽어 다른 쪽으로 흘린다 — **네 방향이 다 이 함수를 지난다**.
///
/// 취소를 청크마다 본다: 태스크를 abort 하는 대신 여기서 스스로 멈춰야 반쯤 쓰인 파일을
/// 부른 쪽이 치울 수 있다.
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
