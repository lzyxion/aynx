//! 상수(청크·진행률 간격·심링크 한도·`.part`)와 순수 함수 — 종류·권한 비트·경로 잇기·보호 판정·목록 한 줄·상태 코드 문구.

use std::time::Duration;

use russh_sftp::protocol::{FileAttributes, FileType, StatusCode};

use crate::fs_entry::SftpEntry;
use crate::i18n::tr;
use crate::sftp::normalize_remote;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 상한이다 — 실제 요청 길이는 서버가 알린 `max_read_len` 으로 더 잘릴 수 있다.
pub(super) const CHUNK: usize = 256 * 1024;

/// 청크마다 웹뷰로 보내면 큰 파일에서 IPC 가 수천 건이 되어 UI 에 얹힌다 — 10Hz 면 충분하다.
pub(super) const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// 한 번에 겹쳐 보내는 심링크 해석 수 (`crate::sftp` 모듈 주석의 "쓰기 8개 겹침" 과 같은 눈금).
pub(super) const SYMLINK_BATCH: usize = 8;

/// 한 디렉터리에서 풀어 보는 심링크 상한 — 목록이 한 번에 뜨는 것이 이 화면의 계약이라(`/usr/bin` 같은 자리), 넘는 만큼은 `linkIsDir: false` · `symlinkTarget: null` 로 둔다(`kind` 는 `"symlink"` 그대로).
pub(super) const SYMLINK_LIMIT: usize = 512;

pub(super) const PART_SUFFIX: &str = ".part";

// ---------------------------------------------------------------------------
// 순수 함수
// ---------------------------------------------------------------------------

pub(super) fn kind_of(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Dir => "dir",
        FileType::File => "file",
        FileType::Symlink => "symlink",
        FileType::Other => "other",
    }
}

/// 종류는 상위 4비트(S_IFMT)에만 있다. `permissions` 가 없으면 `0` → `"other"` — 모르는 것을 파일이라 단정하지 않는다.
pub(super) fn kind_from_mode(mode: u32) -> &'static str {
    kind_of(FileType::from(mode))
}

/// setuid·setgid·sticky 는 살린다 — 목록에서 보여 줄 값이다.
pub(super) fn permission_bits(mode: u32) -> u32 {
    mode & 0o7777
}

pub(super) fn trim_dir(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/"
    } else {
        trimmed
    }
}

/// [`crate::sftp::normalize_remote`] 가 `~/` 를 벗긴 상대 경로를 홈에 붙인다.
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

/// 홈을 인자로 받는다 — 서버 간 복사는 원본과 목적지의 홈이 둘이다.
pub(crate) fn under_home(home: &str, path: &str) -> Result<String, String> {
    let normalized = normalize_remote(path)?;
    Ok(if normalized.starts_with('/') {
        normalized
    } else {
        join_home(home, &normalized)
    })
}

/// 루트는 `/` 자신이 이름이다.
pub(super) fn leaf_name(path: &str) -> &str {
    let trimmed = trim_dir(path);
    if trimmed == "/" {
        return "/";
    }
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

/// 루트와 홈 자신만 막는다(홈 안의 것은 지울 수 있어야 한다). `..` 은 `normalize_remote` 가 거절하므로 "홈처럼 보이는 다른 경로" 로 우회할 길이 없다.
pub(super) fn is_protected(path: &str, home: &str) -> bool {
    let path = trim_dir(path);
    path == "/" || path == trim_dir(home)
}

/// 다 받은 뒤에만 `rename` 하므로 반쯤 받은 파일이 최종 이름으로 남지 않는다.
pub(super) fn part_path(local: &str) -> String {
    format!("{local}{PART_SUFFIX}")
}

pub(super) fn should_report(since_last: u64, elapsed: Duration) -> bool {
    since_last > 0 && elapsed >= PROGRESS_INTERVAL
}

/// 심링크 항목은 나중에 채운다.
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
        // SFTP 에는 "숨김 속성" 이 없다(점 파일이 대신한다) — 모른다고 말한다.
        hidden: None,
    }
}

/// 없는 것은 원문을 그대로 실어 보낸다.
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
        // 이유 코드는 [`fail`] 이 [`is_connection_lost`] 를 다시 보고 감싼 바깥에 얹는다.
        StatusCode::NoConnection | StatusCode::ConnectionLost => {
            Some(crate::errors::session_lost_text())
        }
        _ => None,
    }
}
