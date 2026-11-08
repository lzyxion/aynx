//! 상수(청크·진행률 간격·심링크 한도·`.part`)와 순수 함수 — 종류·권한 비트·경로 잇기·보호 판정·목록 한 줄·상태 코드 문구 (유닛 테스트 대상).

use std::time::Duration;

use russh_sftp::protocol::{FileAttributes, FileType, StatusCode};

use crate::fs_entry::SftpEntry;
use crate::i18n::tr;
use crate::sftp::normalize_remote;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 다운로드 한 덩어리. 실제 요청 길이는 서버가 알려 준 `max_read_len` 으로 더 잘릴 수
/// 있다(러시 쪽 `poll_read` 가 `min(버퍼, 한도)` 를 쓴다) — 여기 값은 **상한**이다.
pub(super) const CHUNK: usize = 256 * 1024;

/// 진행률 보고 최소 간격. 청크마다 웹뷰로 보내면 100MB 짜리에서 수백~수천 건의 IPC 가
/// 되고, 그 비용은 전송이 아니라 UI 쪽에 얹힌다. 사람 눈에는 10Hz 면 충분하다.
pub(super) const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// 한 번에 겹쳐 보내는 심링크 해석 수 (`crate::sftp` 모듈 주석의 "쓰기 8개 겹침" 과 같은 눈금).
pub(super) const SYMLINK_BATCH: usize = 8;

/// 한 디렉터리에서 풀어 보는 심링크의 최대 개수.
///
/// `/usr/bin` 처럼 심링크가 수백 개인 자리가 실제로 있다. 상한이 없으면 RTT 50ms 에서
/// 5000개짜리 디렉터리가 30초 넘게 매달린다 — 목록이 **한 번에 뜨는 것**이 이 화면의
/// 계약이므로, 넘는 만큼은 `linkIsDir: false` · `symlinkTarget: null` 로 둔다
/// (`kind` 는 그대로 `"symlink"` 라 UI 는 여전히 링크로 그린다).
pub(super) const SYMLINK_LIMIT: usize = 512;

/// 다운로드 임시 파일 꼬리표.
pub(super) const PART_SUFFIX: &str = ".part";

// ---------------------------------------------------------------------------
// 순수 함수 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 파일 종류 → 프런트가 쓰는 문자열.
pub(super) fn kind_of(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Dir => "dir",
        FileType::File => "file",
        FileType::Symlink => "symlink",
        FileType::Other => "other",
    }
}

/// 유닉스 mode 비트(`0o100644` 같은 값) → 종류 문자열. 종류는 상위 4비트(S_IFMT)에만 있다.
///
/// 서버가 `permissions` 를 아예 안 주면 `0` 이 들어와 `"other"` 가 된다 — 모르는 것을
/// 파일이라고 단정하는 것보다 낫다 (러시의 `file_type()` 도 같은 기본값을 쓴다).
pub(super) fn kind_from_mode(mode: u32) -> &'static str {
    kind_of(FileType::from(mode))
}

/// 권한 비트만 남긴다 (setuid·setgid·sticky 는 살린다 — 목록에서 보여 줄 값이다).
pub(super) fn permission_bits(mode: u32) -> u32 {
    mode & 0o7777
}

/// 디렉터리 경로의 꼬리 `/` 를 뗀다. 루트는 `/` 그대로다.
pub(super) fn trim_dir(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/"
    } else {
        trimmed
    }
}

/// 정규화된 **상대** 경로를 홈에 붙인다.
///
/// [`crate::sftp::normalize_remote`] 이 `~/` 를 이미 벗겨 상대 경로로 만들어 두므로
/// (SFTP 에는 `~` 를 풀어 줄 셸이 없다), 브라우저가 **절대 경로**를 돌려주려면 여기서
/// 한 번만 홈을 앞에 붙이면 된다.
pub(super) fn join_home(home: &str, relative: &str) -> String {
    let base = trim_dir(home);
    if relative.is_empty() || relative == "." {
        return base.to_string();
    }
    if base == "/" {
        format!("/{relative}")
    } else {
        format!("{base}/{relative}")
    }
}

/// 프런트가 준 원격 경로 하나를 **그 서버의 홈 기준**으로 절대 경로로 만든다.
///
/// 홈을 인자로 받는 이유는 서버 간 복사([`sftp_copy_between`](super::cross::sftp_copy_between)) 때문이다 — 원본과 목적지가
/// **서로 다른 서버**라 홈도 둘이다. 한 세션 안의 명령들은 자기 홈 하나를 넘긴다.
pub(crate) fn under_home(home: &str, path: &str) -> Result<String, String> {
    let normalized = normalize_remote(path)?;
    Ok(if normalized.starts_with('/') {
        normalized
    } else {
        join_home(home, &normalized)
    })
}

/// 경로의 마지막 이름 조각. 루트는 `/` 자신이 이름이다.
pub(super) fn leaf_name(path: &str) -> &str {
    let trimmed = trim_dir(path);
    if trimmed == "/" {
        return "/";
    }
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

/// 지우면 안 되는 자리인가 — **루트와 홈**.
///
/// 실수 한 번이 서버를 못 쓰게 만드는 두 자리다. 홈 안의 것은 지울 수 있어야 하므로
/// (그게 이 기능이다) 홈 **자신**만 막는다. 상위 이동(`..`)은 `normalize_remote` 이
/// 이미 거절하므로 "홈처럼 보이는 다른 경로" 로 우회할 길이 없다.
pub(super) fn is_protected(path: &str, home: &str) -> bool {
    let path = trim_dir(path);
    path == "/" || path == trim_dir(home)
}

/// 다운로드 중에 쓰는 임시 파일. 다 받은 뒤에만 `rename` 하므로 **반쯤 받은 파일이
/// 최종 이름으로 남지 않는다** (`crate::sftp::save_remote` 의 tmp+rename 과 같은 규칙).
pub(super) fn part_path(local: &str) -> String {
    format!("{local}{PART_SUFFIX}")
}

/// 진행률을 지금 보낼까. 마지막 보고 이후 **받은 게 있고** 간격이 찼을 때만 보낸다.
pub(super) fn should_report(since_last: u64, elapsed: Duration) -> bool {
    since_last > 0 && elapsed >= PROGRESS_INTERVAL
}

/// readdir/stat 이 준 속성 한 덩어리 → 목록 한 줄 (심링크 항목은 나중에 채운다).
pub(super) fn entry_from(name: String, path: String, meta: &FileAttributes) -> SftpEntry {
    SftpEntry {
        name,
        path,
        kind: kind_from_mode(meta.permissions.unwrap_or_default()).to_string(),
        size: meta.len(),
        mtime: meta.mtime.map(i64::from),
        mode: meta.permissions.map(permission_bits),
        symlink_target: None,
        link_is_dir: false,
        // SFTP 에는 "숨김 속성" 이 없다 (점 파일이 그 자리를 대신한다) — 모른다고 말한다.
        hidden: None,
    }
}

/// 서버가 돌려준 상태 코드를 사람 말로. 없는 것은 원문을 그대로 실어 보낸다.
pub(super) fn code_message(code: StatusCode) -> Option<String> {
    match code {
        StatusCode::NoSuchFile => Some(tr!(
            ko: "그런 파일이나 디렉터리가 없습니다",
            en: "No such file or folder"
        )),
        StatusCode::PermissionDenied => Some(tr!(ko: "권한이 없습니다", en: "Permission denied")),
        StatusCode::OpUnsupported => Some(tr!(
            ko: "서버가 지원하지 않는 동작입니다",
            en: "The server does not support this operation"
        )),
        // 이 갈래만 **이유 코드**를 달고 나간다 — 접두사는 감싼 바깥에 붙으므로
        // [`fail`] 이 [`is_connection_lost`] 를 다시 보고 얹는다.
        StatusCode::NoConnection | StatusCode::ConnectionLost => {
            Some(crate::errors::session_lost_text())
        }
        _ => None,
    }
}
