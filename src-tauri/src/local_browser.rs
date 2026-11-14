//! **로컬 디스크** 파일 브라우저 — 목록·이동·만들기·이름 바꾸기·삭제.
//!
//! ```text
//!  local_home()                       dirs::home_dir()    → "C:\Users\wl"
//!  local_roots()                      드라이브 비트마스크  → ["C:\", "D:\"]
//!  local_list(path)                   read_dir 한 번       → [SftpEntry]
//!  local_stat / local_mkdir / local_create_file / local_rename / local_remove
//!  local_read_text(path)              앞 2 MiB 까지       → TextFile (문서 보기 타일)
//!  local_write_text(path, text, v)    version 확인 → 임시 파일 → rename → SavedFile (문서 편집)
//! ```
//!
//! 사람은 원격에서만 일하지 않는다. 프런트는 **브라우저 UI 하나**를 두고 백엔드만
//! 갈아 끼우므로, 목록 한 줄의 모양([`crate::fs_entry::SftpEntry`])과 정렬
//! ([`crate::fs_entry::sort_entries`])은 SFTP 쪽과 **같은 함수**를 쓴다 — 복사해 두면
//! 한쪽만 고쳐지는 날이 오고, 그날 UI 는 두 벌의 규칙을 갖는다.
//!
//! ## 원격과 다른 세 가지
//!
//! 1. **`\\?\` 를 떼고 준다.** 윈도우의 `canonicalize` 는 언제나 verbatim 경로
//!    (`\\?\C:\Users\wl`)를 돌려준다. 그대로 내보내면 주소창이 흉하고, 사용자가 복사해
//!    다른 곳에 붙이면 잘 안 먹는다 — 나가는 모든 경로는 [`strip_verbatim`] 을 지난다.
//! 2. **뿌리가 여럿이다.** 유닉스는 `/` 하나지만 윈도우는 `C:\` · `D:\` … 다. 그래서
//!    [`local_roots`] 가 따로 있고, 삭제 보호도 "루트 하나" 가 아니라 **드라이브 루트
//!    전부**를 막는다.
//! 3. **모든 호출이 블로킹이다.** 잠든 디스크·네트워크 드라이브에서 `read_dir` 하나가
//!    수백 ms 를 먹는다. 전부 [`blocking`] (= `spawn_blocking`) 뒤에 둔다.
//!
//! ## 마지막 조각의 심링크는 따라가지 않는다
//!
//! `canonicalize` 는 **끝까지** 링크를 푼다. 그러면 `C:\bin\node` 를 지우라는 요청이
//! 링크가 가리키는 실파일을 지우는 요청이 되고, 목록에서 링크는 자기 이름을 잃는다.
//! 그래서 고치는 명령들은 [`link_path`] 로 **부모만** 풀고 마지막 조각은 손대지 않는다
//! (`sftp_browser` 가 `realpath` 를 쓰지 않는 것과 같은 이유다). 들어갈 자리를 정하는
//! [`local_list`] 만 [`real_path`] 로 통째로 푼다 — 링크된 디렉터리로 **들어가는** 것은
//! 자연스러운 동작이다.

use std::fs::Metadata;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::Channel;

use crate::fs_entry::{sort_entries, SftpEntry};
use crate::fs_transfer::{
    candidate_name, decide, no_free_name, Cancel, Conflict, Decision, Kind, OnConflict, Progress,
    TransferProgress, CHUNK, RENAME_LIMIT,
};
use crate::i18n::tr;
use crate::text_file::{
    assemble, image_too_large, preview_too_large, SavedFile, TextFile, IMAGE_MAX_BYTES,
    PREVIEW_MAX_BYTES, VIEW_MAX_BYTES,
};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

// ---------------------------------------------------------------------------
// 상수 · 외부 선언
// ---------------------------------------------------------------------------

/// `FILE_ATTRIBUTE_HIDDEN`. 윈도우 값이지만 판정이 순수 함수라 어느 OS 에서도 테스트한다.
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;

/// 끌어다 놓기로 받을 수 있는 파일 하나의 최대 크기 (100MB).
///
/// 원격 업로드([`crate::sftp::upload_file`])와 **같은 값**이다. 근거도 같다: 웹뷰가 준
/// `File` 을 통째로 메모리에 올려 IPC 로 넘기는 길이라 큰 파일에서는 앱이 멈춘 것처럼
/// 보인다. 로컬은 탐색기에서 그냥 복사하면 되는 자리라 거절이 특히 싸다.
const WRITE_MAX_BYTES: usize = 100 * 1024 * 1024;

/// `FILE_ATTRIBUTE_DIRECTORY`. 심링크·정션이 **디렉터리를 가리키는지**를 링크 자신의
/// 속성에서 읽을 때 쓴다 (`Metadata::is_dir()` 는 심링크에 대해 언제나 `false` 다).
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;

// 마운트된 드라이브 문자 비트마스크(bit0 = `A:`)를 커널에서 그대로 받는다.
//
// `A:` ~ `Z:` 를 하나씩 `metadata` 로 두드리지 않는 이유: 미디어가 없는 이동식
// 드라이브를 건드리면 **"디스크를 넣으십시오" 하드 오류 창**이 뜰 수 있고(윈도우는
// 기본적으로 이 창을 막지 않는다), 목록 한 번에 26번의 디스크 I/O 가 붙는다. 커널은
// 이 답을 이미 메모리에 갖고 있다. (kernel32 는 std 가 이미 링크한다 — 새 의존성이
// 붙지 않는다.)
#[cfg(windows)]
#[allow(non_snake_case)]
#[link(name = "kernel32")]
extern "system" {
    fn GetLogicalDrives() -> u32;
}

// ---------------------------------------------------------------------------
// 순수 함수 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 윈도우의 **verbatim 접두사**(`\\?\`)를 뗀다. UNC 는 `\\?\UNC\서버\공유` →
/// `\\서버\공유` 로 되돌린다.
///
/// `canonicalize` 가 붙여 주는 이 접두사는 "경로 해석을 하지 말라" 는 커널용 표시라
/// 사람에게 보일 값이 아니다 — 주소창·오류 문구·프런트로 나가는 모든 경로에서 뗀다.
pub(crate) fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

/// 경로 하나를 **사람에게 보일 문자열**로. 유효하지 않은 유니코드는 대체 문자로 바꾼다
/// (목록이 한 항목 때문에 통째로 실패하는 것보다 낫다).
pub(crate) fn show(path: &Path) -> String {
    strip_verbatim(&path.to_string_lossy())
}

/// 비교용으로 꼬리 구분자를 뗀다. 루트는 빈 문자열이 된다 (`"C:\\"` → `"C:"`).
fn trim_tail(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        ""
    } else {
        trimmed
    }
}

/// **뿌리인가** — 유닉스 `/` 이거나 윈도우 드라이브 루트(`C:\` · `C:/`).
///
/// 여기서 참이면 지우기·이름 바꾸기가 막힌다. 대소문자와 구분자 방향, 꼬리 슬래시
/// 개수로 우회할 수 없어야 한다.
fn is_root_path(path: &str) -> bool {
    let trimmed = trim_tail(path);
    if trimmed.is_empty() {
        return true; // "/" · "\" · "//"
    }
    let bytes = trimmed.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// 경로가 든 드라이브의 루트 (`C:\Users\wl` → `C:\`). 드라이브 문자가 없으면 `None`.
fn drive_root_of(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some(format!("{}:\\", bytes[0].to_ascii_uppercase() as char));
    }
    None
}

/// 같은 자리를 가리키는가. **윈도우는 대소문자를 가리지 않는다** — `c:\users\wl` 로
/// 홈 보호를 우회할 수 없어야 한다.
fn same_path(a: &str, b: &str) -> bool {
    let (a, b) = (trim_tail(a), trim_tail(b));
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// 지우거나 이름을 바꾸면 안 되는 자리 — **드라이브 루트와 홈 자신**.
///
/// 실수 한 번이 컴퓨터를 못 쓰게 만드는 자리들이다. 홈 **안**의 것은 지울 수 있어야
/// 하므로(그게 이 기능이다) 홈 자신만 막는다.
fn is_protected(path: &str, home: Option<&str>) -> bool {
    is_root_path(path) || home.is_some_and(|home| same_path(path, home))
}

/// 프런트가 준 경로의 구분자를 OS 것으로 맞춘다.
///
/// 윈도우에서 `/` 를 받는 이유: 프런트가 문자열을 이어 붙일 때, 사용자가 유닉스 습관으로
/// 적을 때 둘 다 자연스럽게 들어온다. 반대로 **유닉스에서는 `\` 를 건드리지 않는다** —
/// 거기서 역슬래시는 멀쩡한 파일 이름 글자다.
fn normalize_input(path: &str) -> String {
    let trimmed = path.trim();
    if cfg!(windows) {
        trimmed.replace('/', "\\")
    } else {
        trimmed.to_string()
    }
}

/// 이름 한 조각인가 (구분자도 드라이브 문자도 없다). `local_rename` 의 `to` 가 새 이름만
/// 왔는지 가른다.
///
/// `:` 를 막는 이유는 드라이브 문자만이 아니다 — 윈도우 NTFS 의 **대체 데이터 스트림**
/// 때문이기도 하다: `dest\a:b` 는 `b` 라는 파일이 아니라 **파일 `a` 의 숨은 스트림**을 연다.
/// 원격이 준 이름을 그대로 쓰는 자리(F1)에서는 그 한 글자가 목록에 안 보이는 쓰기가 된다.
pub(crate) fn is_bare_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

/// `target` 이 `root` 아래에 있는가 — 컨테인먼트 확인(F1 벨트).
///
/// 문자열 접두사가 아니라 [`Path::starts_with`](std::path::Path::starts_with) 의 **컴포넌트
/// 단위** 비교를 쓴다 (`C:\dest2` 가 `C:\dest` 의 접두사로 통과하면 안 된다). `root` 자신은
/// 거짓이다 — 여기 쓰는 자리는 전부 "root **안**에 놓는다" 이지 root 를 갈아치우는 게 아니다.
pub(crate) fn contained_in(root: &Path, target: &Path) -> bool {
    target != root && target.starts_with(root)
}

/// 만들거나 이름 붙일 자리의 **부모**. 드라이브 루트·유닉스 루트에는 부모가 없다.
fn parent_of(path: &Path) -> Result<&Path, String> {
    path.parent()
        .ok_or_else(|| tr!(ko: "{what} 의 부모 디렉터리가 없습니다: 여기가 뿌리입니다", en: "{what} has no parent folder: this is the root", what = show(path)))
}

/// 경로의 마지막 이름 조각. 루트는 자기 자신이 이름이다 (`C:\` · `/`).
fn leaf_name(path: &Path) -> String {
    match path.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => show(path),
    }
}

/// 파일 시각 → 유닉스 **초**. 1970 이전(시계가 틀어진 채 만들어진 파일)은 음수다.
fn secs_since_epoch(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_secs() as i64,
        Err(before) => -(before.duration().as_secs() as i64),
    }
}

/// 윈도우 숨김 속성이 켜져 있는가.
#[cfg_attr(not(windows), allow(dead_code))]
fn hidden_from_attributes(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_HIDDEN != 0
}

/// 이 항목의 속성이 **디렉터리**라고 말하는가 (심링크·정션 자신에게 물을 때 쓴다).
#[cfg_attr(not(windows), allow(dead_code))]
fn is_directory_attribute(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_DIRECTORY != 0
}

/// 드라이브 비트마스크 → 루트 문자열들 (`0b101` → `["A:\", "C:\"]`).
#[cfg_attr(not(windows), allow(dead_code))]
fn drives_from_mask(mask: u32) -> Vec<String> {
    (0..26u32)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| format!("{}:\\", (b'A' + bit as u8) as char))
        .collect()
}

// ---------------------------------------------------------------------------
// 경로 해석
// ---------------------------------------------------------------------------

/// 프런트가 준 경로 → **절대 경로**. 존재 여부는 보지 않는다.
///
/// 상대 경로를 거절하는 이유: 로컬 브라우저에는 "기준 디렉터리" 가 없다. 프로세스의
/// 현재 디렉터리를 기준으로 삼으면 앱을 어디서 띄웠느냐에 따라 같은 요청이 다른 자리를
/// 가리키게 된다 — 지우는 명령에서는 그것이 사고다. 시작점은 `local_home` ·
/// `local_roots` 가 준다.
fn absolute_input(path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_input(path);
    if normalized.is_empty() {
        return Err(
            tr!(ko: "경로를 읽지 못했습니다: 빈 문자열입니다", en: "Could not read the path: it is an empty string"),
        );
    }
    let candidate = PathBuf::from(&normalized);
    if !candidate.is_absolute() {
        return Err(tr!(
            ko: "{normalized} 을(를) 열지 못했습니다: 절대 경로가 아닙니다",
            en: "Could not open {normalized}: it is not an absolute path"
        ));
    }
    Ok(candidate)
}

/// 있는 경로를 **실경로**로 (심링크와 `..` 를 모두 푼다). 들어갈 자리를 정할 때 쓴다.
pub(crate) fn real_path(path: &str) -> Result<PathBuf, String> {
    let input = absolute_input(path)?;
    std::fs::canonicalize(&input)
        .map_err(|e| tr!(ko: "{what} 을(를) 찾지 못했습니다: {e}", en: "Could not find {what}: {e}", what = show(&input)))
}

/// **부모만** 실경로로 풀고 마지막 조각은 그대로 둔다 (lstat 의미).
///
/// 마지막 조각은 아직 없어도 된다 (`local_mkdir` 이 만들 자리). 부모는 있어야 한다 —
/// 없으면 "찾지 못했습니다" 가 만들기 실패보다 정확한 답이다.
pub(crate) fn link_path(path: &str) -> Result<PathBuf, String> {
    let input = absolute_input(path)?;
    // 루트이거나 `.`/`..` 로 끝나면 마지막 조각이라 할 게 없다 — 통째로 푼다.
    let Some(leaf) = input.file_name() else {
        return real_path(path);
    };
    let parent = parent_of(&input)?;
    let parent = std::fs::canonicalize(parent)
        .map_err(|e| tr!(ko: "{what} 을(를) 찾지 못했습니다: {e}", en: "Could not find {what}: {e}", what = show(parent)))?;
    Ok(parent.join(leaf))
}

// ---------------------------------------------------------------------------
// 목록 한 줄 만들기
// ---------------------------------------------------------------------------

/// 유닉스는 권한 비트를, **윈도우는 `null`** 을 준다.
///
/// 윈도우의 접근 권한은 ACL 이라 `0o755` 같은 세 자리로 접히지 않는다. 읽기 전용
/// 속성만 보고 `0o444` 를 지어내면 UI 는 "그룹·기타 권한" 을 아는 척하게 된다 —
/// 모르는 것은 모른다고 말하고, 프런트는 `mode == null` 이면 권한 칸을 접는다.
#[cfg(unix)]
fn mode_of(meta: &Metadata) -> Option<u32> {
    Some(meta.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn mode_of(_meta: &Metadata) -> Option<u32> {
    None
}

/// 숨김 여부. 윈도우는 속성 비트, 그 밖에서는 그런 속성이 없으므로 `false` 다
/// (점 파일 규칙은 프런트가 이름으로 판단한다 — 둘을 OR 로 묶는다).
#[cfg(windows)]
fn hidden_of(meta: &Metadata) -> Option<bool> {
    Some(hidden_from_attributes(meta.file_attributes()))
}

#[cfg(not(windows))]
fn hidden_of(_meta: &Metadata) -> Option<bool> {
    Some(false)
}

/// 심링크가 적어 둔 문자열과 **가리키는 곳이 디렉터리인지**.
///
/// 끊어진 링크는 오류가 아니다 — `linkIsDir: false` 로 남는 정상적인 답이다 (목록에는
/// 링크로 그대로 보인다).
fn link_info(path: &Path) -> (Option<String>, bool) {
    let target = std::fs::read_link(path).ok().map(|target| show(&target));
    let link_is_dir = std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    (target, link_is_dir)
}

/// lstat 한 덩어리 → 목록 한 줄.
fn entry_at(path: &Path, name: String, meta: &Metadata) -> SftpEntry {
    let file_type = meta.file_type();
    // 심링크를 먼저 본다 — 윈도우에서 디렉터리 심링크는 `is_dir()` 이 false 지만
    // 사용자에게는 여전히 "들어갈 수 있는 링크" 다 (linkIsDir 가 그 답을 담는다).
    let kind = if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "dir"
    } else if file_type.is_file() {
        "file"
    } else {
        "other"
    };

    let (symlink_target, link_is_dir) = if kind == "symlink" {
        link_info(path)
    } else {
        (None, false)
    };

    SftpEntry {
        name,
        path: show(path),
        kind: kind.to_string(),
        size: meta.len(),
        mtime: meta.modified().ok().map(secs_since_epoch),
        mode: mode_of(meta),
        symlink_target,
        link_is_dir,
        hidden: hidden_of(meta),
    }
}

// ---------------------------------------------------------------------------
// 실제 일 (블로킹 — 전부 spawn_blocking 안에서 돈다)
// ---------------------------------------------------------------------------

/// 사용자 홈. 있는 자리면 실경로로 돌려준다 (목록이 주는 경로와 모양이 같아야 한다).
fn home() -> Result<String, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| tr!(ko: "홈 디렉터리를 찾지 못했습니다: 사용자 프로필 경로가 없습니다", en: "Could not find the home folder: there is no user profile path"))?;
    Ok(std::fs::canonicalize(&home)
        .map(|real| show(&real))
        .unwrap_or_else(|_| show(&home)))
}

/// 보호 판정에 쓸 홈. **없어도 계속 간다** — 홈을 못 찾는 것과 삭제를 못 하는 것은
/// 다른 문제이고, 뿌리 보호는 홈 없이도 선다.
fn home_for_guard() -> Option<String> {
    home().ok()
}

/// 최상위 뿌리들. 윈도우는 마운트된 드라이브 문자, 그 밖에서는 `/` 하나다.
#[cfg(windows)]
fn roots() -> Vec<String> {
    let drives = drives_from_mask(unsafe { GetLogicalDrives() });
    if !drives.is_empty() {
        return drives;
    }
    // 커널이 0 을 주는 일은 사실상 없지만, 그때도 화면은 떠야 한다 — 홈이 있는
    // 드라이브 하나가 최소한의 답이다.
    vec![home()
        .ok()
        .as_deref()
        .and_then(drive_root_of)
        .unwrap_or_else(|| "C:\\".to_string())]
}

#[cfg(not(windows))]
fn roots() -> Vec<String> {
    vec!["/".to_string()]
}

/// 디렉터리 하나의 목록.
///
/// `read_dir` 은 이름과 함께 **속성도 준다**(윈도우는 `FindNextFileW` 가 통째로 주고,
/// 유닉스는 `DirEntry::metadata` 가 lstat 한 번이다) — 항목마다 stat 을 또 부르지
/// 않는다. 심링크만 예외로 두 번 더 본다(`read_link` + 따라간 `metadata`). `.` 과
/// `..` 는 `read_dir` 이 이미 걸러 준다.
fn list(path: &str) -> Result<Vec<SftpEntry>, String> {
    let dir = real_path(path)?;
    let read = std::fs::read_dir(&dir)
        .map_err(|e| tr!(ko: "{what} 목록을 읽지 못했습니다: {e}", en: "Could not list {what}: {e}", what = show(&dir)))?;

    let mut entries: Vec<SftpEntry> = Vec::new();
    for item in read {
        // 훑는 도중 사라진 항목 하나 때문에 목록 전체가 실패하면 안 된다 (빌드 산출물
        // 디렉터리에서 실제로 일어난다). 그 한 줄만 빠진다.
        let Ok(item) = item else { continue };
        let Ok(meta) = item.metadata() else { continue };
        let full = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        entries.push(entry_at(&full, name, &meta));
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// 항목 하나의 정보. **lstat 이다** — 심링크는 자기 자신으로 보고된다.
fn stat(path: &str) -> Result<SftpEntry, String> {
    let full = link_path(path)?;
    let meta = std::fs::symlink_metadata(&full)
        .map_err(|e| tr!(ko: "{what} 정보를 읽지 못했습니다: {e}", en: "Could not read information about {what}: {e}", what = show(&full)))?;
    Ok(entry_at(&full, leaf_name(&full), &meta))
}

/// 디렉터리를 만든다. 돌려주는 값은 **만들어진 절대 경로**.
///
/// 중간 경로는 만들지 않는다(`create_dir`) — "한 칸 만들기" 버튼이 오타 한 번으로
/// 없던 트리를 통째로 만드는 것보다, 부모가 없다고 말해 주는 편이 낫다.
fn mkdir(path: &str) -> Result<String, String> {
    let full = link_path(path)?;
    let shown = show(&full);
    if std::fs::symlink_metadata(&full).is_ok() {
        return Err(crate::errors::exists(&shown));
    }
    std::fs::create_dir(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 만들지 못했습니다: {e}", en: "Could not create {shown}: {e}"),
    )?;
    Ok(shown)
}

/// 빈 파일을 만든다 — 이미 있으면(파일 · 폴더 · 링크) [exists] 로 거절하고 덮어쓰지 않는다(`create_new` — 확인과 만들기 사이의
/// 틈에 생긴 것도 OS 가 거절한다). 돌려주는 값은 만들어진 경로.
fn create_file(path: &str) -> Result<String, String> {
    let full = link_path(path)?;
    let shown = show(&full);
    if std::fs::symlink_metadata(&full).is_ok() {
        return Err(crate::errors::exists(&shown));
    }
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&full) {
        Ok(_) => Ok(shown),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(crate::errors::exists(&shown)),
        Err(e) => Err(tr!(ko: "{shown} 을(를) 만들지 못했습니다: {e}", en: "Could not create {shown}: {e}")),
    }
}

/// `to` 를 목표 경로로 푼다 — **절대 경로**이거나 **새 이름 한 조각**이다.
///
/// 이름만 받는 쪽을 여는 이유: 목록에서 F2 로 이름을 고치는 흐름에서 프런트가 부모
/// 경로를 다시 이어 붙일 이유가 없다. 이름에 구분자가 섞여 있으면(`../x`) 절대 경로로
/// 취급되어 거절된다 — 상대 경로로 트리 밖을 가리킬 길은 없다.
fn rename_target(source: &Path, to: &str) -> Result<PathBuf, String> {
    let normalized = normalize_input(to);
    if normalized.is_empty() {
        return Err(
            tr!(ko: "이름을 바꾸지 못했습니다: 새 이름이 비어 있습니다", en: "Could not rename: the new name is empty"),
        );
    }
    if is_bare_name(&normalized) {
        let parent = parent_of(source)?;
        return Ok(parent.join(&normalized));
    }
    link_path(&normalized)
}

/// 이름을 바꾸거나 같은 디스크 안에서 옮긴다. 돌려주는 값은 **바뀐 뒤의 절대 경로**.
///
/// 대상이 이미 있으면 거절한다 — 윈도우의 `MoveFileEx` 는 덮어쓰기가 기본이라, 막지
/// 않으면 이름 한 번 잘못 적은 것이 남의 파일을 없앤다. 예외는 **대소문자만 바꾸는
/// 경우**다(`a.txt` → `A.txt`): 윈도우는 그 둘을 같은 파일로 보므로 "이미 있다" 로
/// 막으면 정당한 이름 고치기가 영영 안 된다.
fn rename(from: &str, to: &str) -> Result<String, String> {
    let source = link_path(from)?;
    let shown = show(&source);
    if is_protected(&shown, home_for_guard().as_deref()) {
        return Err(tr!(
            ko: "{shown} 은(는) 이름을 바꿀 수 없습니다 (드라이브 루트·홈)",
            en: "{shown} cannot be renamed (a drive root or the home folder)"
        ));
    }

    let target = rename_target(&source, to)?;
    let target_shown = show(&target);
    if source == target {
        return Ok(target_shown);
    }
    if !same_path(&shown, &target_shown) && std::fs::symlink_metadata(&target).is_ok() {
        return Err(crate::errors::exists_pick_another_name(&target_shown));
    }

    std::fs::rename(&source, &target).map_err(
        |e| tr!(ko: "{shown} 이름을 바꾸지 못했습니다: {e}", en: "Could not rename {shown}: {e}"),
    )?;
    Ok(target_shown)
}

/// 심링크·정션은 **링크만** 지운다 (가리키는 곳은 건드리지 않는다).
///
/// 윈도우에서는 링크가 디렉터리를 가리키면 `DeleteFileW`(= `remove_file`)가 거절한다 —
/// 디렉터리 심링크와 정션은 `RemoveDirectoryW`(= `remove_dir`)로 지워야 하고, 그쪽도
/// 링크만 지운다. 어느 쪽인지는 **링크 자신의 속성**이 말해 준다 (`Metadata::is_dir()`
/// 는 심링크에 대해 언제나 `false` 라 쓸 수 없다).
#[cfg_attr(not(windows), allow(unused_variables))]
fn remove_link(path: &Path, meta: &Metadata) -> Result<(), String> {
    let shown = show(path);
    #[cfg(windows)]
    if is_directory_attribute(meta.file_attributes()) {
        return std::fs::remove_dir(path)
            .map_err(|e| tr!(ko: "{shown} 링크를 지우지 못했습니다: {e}", en: "Could not delete the link {shown}: {e}"));
    }
    std::fs::remove_file(path).map_err(|e| tr!(ko: "{shown} 링크를 지우지 못했습니다: {e}", en: "Could not delete the link {shown}: {e}"))
}

/// 디렉터리에 뭔가 들어 있는가 (실패한 `rmdir` 의 이유를 가릴 때만 본다).
fn is_non_empty(path: &Path) -> bool {
    std::fs::read_dir(path)
        .map(|mut read| read.next().is_some())
        .unwrap_or(false)
}

/// 파일이나 디렉터리를 지운다.
///
/// - 심링크·정션 → **링크만** 지운다 (트리 밖 남의 디렉터리를 지우는 사고를 막는 자리).
/// - 파일 → `remove_file`.
/// - 디렉터리 + `recursive: false` → `rmdir`. 비어 있지 않으면 그렇게 말해 준다.
/// - 디렉터리 + `recursive: true` → `remove_dir_all` (std 가 링크를 따라가지 않는다).
///
/// 드라이브 루트와 홈은 어떤 경우에도 거절한다.
///
/// [`crate::sftp_browser`] 도 이 몸통을 탄다 — 로컬 → 원격 **이동**이 옮긴 뒤 원본을 지울 때
/// 보호 규칙이 한 자리에만 있어야 한다 (docs/log/2026-09-04-fs-batch-ops-backend.md).
pub(crate) fn remove(path: &str, recursive: bool) -> Result<(), String> {
    let full = link_path(path)?;
    let shown = show(&full);
    if is_protected(&shown, home_for_guard().as_deref()) {
        return Err(tr!(
            ko: "{shown} 은(는) 지울 수 없습니다 (드라이브 루트·홈 디렉터리)",
            en: "{shown} cannot be deleted (a drive root or the home folder)"
        ));
    }

    // lstat 이라 심링크는 심링크로 보인다 — 링크를 따라가 남의 파일을 지우지 않는다.
    let meta = std::fs::symlink_metadata(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;

    if meta.file_type().is_symlink() {
        return remove_link(&full, &meta);
    }
    if !meta.is_dir() {
        return std::fs::remove_file(&full)
            .map_err(|e| tr!(ko: "{shown} 을(를) 지우지 못했습니다: {e}", en: "Could not delete {shown}: {e}"));
    }
    if recursive {
        return std::fs::remove_dir_all(&full)
            .map_err(|e| tr!(ko: "{shown} 을(를) 지우지 못했습니다: {e}", en: "Could not delete {shown}: {e}"));
    }

    std::fs::remove_dir(&full).map_err(|e| {
        if is_non_empty(&full) {
            crate::errors::not_empty(&shown)
        } else {
            tr!(ko: "{shown} 을(를) 지우지 못했습니다: {e}", en: "Could not delete {shown}: {e}")
        }
    })
}

// ---------------------------------------------------------------------------
// 여러 항목을 한꺼번에 — 복사·이동·삭제 (docs/log/2026-09-04-fs-batch-ops-backend.md)
// ---------------------------------------------------------------------------

/// lstat 한 덩어리의 종류. **심링크가 먼저다** — 윈도우의 디렉터리 심링크는
/// `is_dir()` 이 거짓이지만, 그렇다고 파일도 아니다.
fn kind_of_meta(meta: &Metadata) -> Kind {
    let file_type = meta.file_type();
    if file_type.is_symlink() {
        Kind::Link
    } else if file_type.is_dir() {
        Kind::Dir
    } else {
        Kind::File
    }
}

/// 그 자리에 무엇이 있는가 (**링크는 따라가지 않는다**). 빈자리면 `None`.
pub(crate) fn kind_at(path: &Path) -> Option<Kind> {
    std::fs::symlink_metadata(path)
        .ok()
        .map(|meta| kind_of_meta(&meta))
}

/// `path` 가 `ancestor` 자신이거나 그 **아래**인가.
///
/// 자기 자신(또는 자기 하위)으로 복사·이동하는 것을 막는 자리다 — 막지 않으면
/// `C:\a` 를 `C:\a\b` 로 복사하는 요청이 자기가 만든 것을 다시 훑으며 디스크를 채운다.
/// 윈도우는 대소문자를 가리지 않는다 (`c:\a` 로 우회할 수 없어야 한다).
fn is_within(ancestor: &str, path: &str) -> bool {
    let (ancestor, path) = (trim_tail(ancestor), trim_tail(path));
    if same_path(ancestor, path) {
        return true;
    }
    // 접두사 뒤에 **구분자가 와야** 한다 — `C:\a` 는 `C:\ab` 의 조상이 아니다.
    let Some(head) = path.get(..ancestor.len()) else {
        return false;
    };
    let same_head = if cfg!(windows) {
        head.eq_ignore_ascii_case(ancestor)
    } else {
        head == ancestor
    };
    same_head && path[ancestor.len()..].starts_with(['/', '\\'])
}

/// 무엇이든 그 자리에서 치운다 (덮어쓰기 전에 자리를 비울 때). 없으면 성공이다.
/// 심링크는 **링크만** 지운다 ([`remove_link`] 와 같은 규칙).
pub(crate) fn remove_any(path: &Path) -> Result<(), String> {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return Ok(());
    };
    let shown = show(path);
    if meta.file_type().is_symlink() {
        return remove_link(path, &meta);
    }
    if meta.is_dir() {
        return std::fs::remove_dir_all(path)
            .map_err(|e| tr!(ko: "{shown} 을(를) 지우지 못했습니다: {e}", en: "Could not delete {shown}: {e}"));
    }
    std::fs::remove_file(path).map_err(
        |e| tr!(ko: "{shown} 을(를) 지우지 못했습니다: {e}", en: "Could not delete {shown}: {e}"),
    )
}

/// 계획 한 걸음. 충돌 정책은 **이미 적용된** 상태라 실행기는 정책을 모른다.
enum Step {
    /// 디렉터리를 만든다 (이미 디렉터리로 있으면 그대로 쓴다 = 합치기).
    Dir { target: PathBuf, clear: bool },
    /// 파일 하나를 청크로 흘려 담는다.
    File {
        source: PathBuf,
        target: PathBuf,
        clear: bool,
    },
    /// 심링크를 **링크로** 다시 만든다 (따라가지 않는다).
    Link {
        source: PathBuf,
        target: PathBuf,
        clear: bool,
    },
}

/// 훑어서 만든 계획 — 실행만 남은 목록과 진행률의 분모.
#[derive(Default)]
struct Plan {
    steps: Vec<Step>,
    /// 최상위 항목이 **실제로 놓인** 자리 (자동 이름으로 밀렸을 수 있다). 명령의 반환값.
    made: Vec<String>,
    files: u32,
    bytes: u64,
}

/// 대상 이름을 정한다. `None` 이면 이 항목은 건너뛴다.
///
/// 돌려주는 값은 `(놓을 자리, 지우고 놓아야 하는가, 이미 있던 자리인가)` 다
/// ([`crate::fs_transfer::decide`] 가 그 규칙을 갖는다). 셋째 값이 필요한 이유는
/// **훑기와 실행 사이**에 있다 — 빈자리에 놓는 항목은 안쪽까지 충돌이 없으므로 아래
/// 항목들의 확인을 통째로 건너뛸 수 있다 (원격에서는 그 확인 하나가 왕복 하나다).
pub(crate) fn place_at(
    dest: &Path,
    name: &str,
    source: Kind,
    on_conflict: OnConflict,
) -> Result<Option<(PathBuf, bool, bool)>, String> {
    // 이름 한 조각이 아니면 `dest.join(name)` 이 `dest` 밖으로 나간다 — `..` 는 위로 올라가고
    // 절대 경로(`C:\…` · `/etc`)는 `dest` 를 **통째로 무시**한다. 원격 목록이 준 이름이 여기까지
    // 오므로(SFTP 재귀 다운로드) 자리를 정하기 **전에** 막는다(F1).
    if !is_bare_name(name) {
        return Err(
            tr!(ko: "{name:?} 은(는) 쓸 수 없는 이름입니다", en: "{name:?} is not a usable name"),
        );
    }
    let target = dest.join(name);
    let existing = kind_at(&target);
    match decide(existing, source, on_conflict) {
        Decision::Use { clear } => Ok(Some((target, clear, existing.is_some()))),
        Decision::Skip => Ok(None),
        Decision::Fail => Err(crate::errors::exists_choose_overwrite(&show(&target))),
        Decision::Rename => {
            for index in 2..=RENAME_LIMIT {
                let candidate = dest.join(candidate_name(name, index, source.is_dir()));
                if kind_at(&candidate).is_none() {
                    return Ok(Some((candidate, false, false)));
                }
            }
            Err(no_free_name(name))
        }
    }
}

/// 항목 하나(와 그 아래 전부)를 `dest` 에 놓는 계획을 세운다. 돌려주는 값은 **놓일 자리**
/// (건너뛰면 `None`).
///
/// 훑으면서 충돌을 다 풀어 두므로 진행률의 분모는 **실제로 옮길 것만** 센다. 재귀로 쓴
/// 이유는 로컬 훑기가 동기(블로킹)라 원격처럼 명시적 스택이 필요 없어서다.
fn plan_copy(
    source: &Path,
    dest: &Path,
    on_conflict: OnConflict,
    cancel: &Cancel,
    plan: &mut Plan,
) -> Result<Option<PathBuf>, String> {
    cancel.check()?;
    let shown = show(source);
    let meta = std::fs::symlink_metadata(source).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;
    let kind = kind_of_meta(&meta);

    let Some((target, clear, _)) = place_at(dest, &leaf_name(source), kind, on_conflict)? else {
        return Ok(None);
    };
    // 자기 자신 위에 놓으라는 요청은 아무것도 하지 않는다. 막지 않으면 `Overwrite` 가
    // 원본을 잘라 놓고 그 잘린 파일을 읽게 된다 — 조용한 데이터 손실이다.
    if same_path(&shown, &show(&target)) {
        return Ok(Some(target));
    }

    match kind {
        Kind::Link => {
            plan.files += 1;
            plan.steps.push(Step::Link {
                source: source.to_path_buf(),
                target: target.clone(),
                clear,
            });
        }
        Kind::File => {
            plan.files += 1;
            plan.bytes += meta.len();
            plan.steps.push(Step::File {
                source: source.to_path_buf(),
                target: target.clone(),
                clear,
            });
        }
        Kind::Dir => {
            plan.steps.push(Step::Dir {
                target: target.clone(),
                clear,
            });
            let read = std::fs::read_dir(source)
                .map_err(|e| tr!(ko: "{shown} 목록을 읽지 못했습니다: {e}", en: "Could not list {shown}: {e}"))?;
            // 이름순으로 훑는다 — 진행률에 뜨는 순서가 목록과 같아야 사람이 따라간다.
            let mut children: Vec<PathBuf> = read
                .filter_map(|item| item.ok().map(|item| item.path()))
                .collect();
            children.sort();
            for child in children {
                plan_copy(&child, &target, on_conflict, cancel, plan)?;
            }
        }
    }
    Ok(Some(target))
}

/// 파일 하나를 청크로 흘려 담는다. `fresh` 는 **이 자리가 비어 있었는가** — 중간에
/// 끊기면 우리가 만든 것만 지운다 (덮어쓰던 남의 파일까지 없애지 않는다).
fn stream_file(
    source: &Path,
    target: &Path,
    fresh: bool,
    cancel: &Cancel,
    progress: &mut Progress,
) -> Result<(), String> {
    let mut input = std::fs::File::open(source)
        .map_err(|e| tr!(ko: "{what} 을(를) 열지 못했습니다: {e}", en: "Could not open {what}: {e}", what = show(source)))?;
    let mut output = std::fs::File::create(target)
        .map_err(|e| tr!(ko: "{what} 을(를) 만들지 못했습니다: {e}", en: "Could not create {what}: {e}", what = show(target)))?;

    let mut buffer = vec![0u8; CHUNK];
    let copied = loop {
        if cancel.stopped() {
            break Err(crate::errors::cancelled());
        }
        let read = match input.read(&mut buffer) {
            Ok(0) => break Ok(()),
            Ok(read) => read,
            Err(e) => {
                break Err(
                    tr!(ko: "{what} 을(를) 읽지 못했습니다: {e}", en: "Could not read {what}: {e}", what = show(source)),
                )
            }
        };
        if let Err(e) = output.write_all(&buffer[..read]) {
            break Err(
                tr!(ko: "{what} 에 쓰지 못했습니다: {e}", en: "Could not write to {what}: {e}", what = show(target)),
            );
        }
        progress.advance(read as u64);
    };
    drop(output);

    if let Err(message) = copied {
        if fresh {
            let _ = std::fs::remove_file(target);
        }
        return Err(message);
    }

    // 권한 보존 **시도** — 실패해도 복사 자체는 성공이다 (윈도우의 ACL 은 이 값으로
    // 표현되지 않고, 유닉스에서도 대상 파일시스템이 거절할 수 있다).
    if let Ok(meta) = std::fs::metadata(source) {
        let _ = std::fs::set_permissions(target, meta.permissions());
    }
    Ok(())
}

/// 심링크를 **링크로** 다시 만든다 (가리키는 내용을 복사하지 않는다).
#[cfg(windows)]
fn copy_link(source: &Path, target: &Path) -> Result<(), String> {
    let raw = std::fs::read_link(source)
        .map_err(|e| tr!(ko: "{what} 링크를 읽지 못했습니다: {e}", en: "Could not read the link {what}: {e}", what = show(source)))?;
    // 디렉터리 링크와 파일 링크는 만드는 API 가 다르다 — 어느 쪽인지는 **링크 자신의
    // 속성**이 말해 준다 (`Metadata::is_dir()` 는 심링크에 대해 언제나 false 다).
    let directory = std::fs::symlink_metadata(source)
        .map(|meta| is_directory_attribute(meta.file_attributes()))
        .unwrap_or(false);
    let made = if directory {
        std::os::windows::fs::symlink_dir(&raw, target)
    } else {
        std::os::windows::fs::symlink_file(&raw, target)
    };
    made.map_err(|e| {
        tr!(
            ko: "{what} 링크를 만들지 못했습니다: {e} — 윈도우에서 심링크를 만들려면 개발자 모드나 관리자 권한이 필요합니다",
            en: "Could not create the link {what}: {e} — making a symlink on Windows needs developer mode or administrator rights",
            what = show(target),
        )
    })
}

#[cfg(not(windows))]
fn copy_link(source: &Path, target: &Path) -> Result<(), String> {
    let raw = std::fs::read_link(source)
        .map_err(|e| tr!(ko: "{what} 링크를 읽지 못했습니다: {e}", en: "Could not read the link {what}: {e}", what = show(source)))?;
    std::os::unix::fs::symlink(&raw, target)
        .map_err(|e| tr!(ko: "{what} 링크를 만들지 못했습니다: {e}", en: "Could not create the link {what}: {e}", what = show(target)))
}

/// 계획을 실행한다. 걸음마다 취소를 보고, 파일 안에서는 청크마다 본다.
fn run_plan(plan: &Plan, cancel: &Cancel, progress: &mut Progress) -> Result<(), String> {
    for step in &plan.steps {
        cancel.check()?;
        match step {
            Step::Dir { target, clear } => {
                if *clear {
                    remove_any(target)?;
                }
                if kind_at(target).is_none() {
                    std::fs::create_dir(target)
                        .map_err(|e| tr!(ko: "{what} 을(를) 만들지 못했습니다: {e}", en: "Could not create {what}: {e}", what = show(target)))?;
                }
            }
            Step::File {
                source,
                target,
                clear,
            } => {
                if *clear {
                    remove_any(target)?;
                }
                let fresh = kind_at(target).is_none();
                progress.start(&show(target));
                stream_file(source, target, fresh, cancel, progress)?;
                progress.file_done();
            }
            Step::Link {
                source,
                target,
                clear,
            } => {
                if *clear {
                    remove_any(target)?;
                }
                progress.start(&show(target));
                copy_link(source, target)?;
                progress.file_done();
            }
        }
    }
    progress.finish();
    Ok(())
}

/// 목적지와 원본들을 푼다 — **자기 자신·자기 하위로 넣는 요청은 여기서 막는다**.
fn prepare(paths: &[String], dest_dir: &str) -> Result<(PathBuf, Vec<PathBuf>), String> {
    if paths.is_empty() {
        return Err(tr!(ko: "옮길 항목이 없습니다", en: "There is nothing to move"));
    }
    let dest = real_path(dest_dir)?;
    if !dest.is_dir() {
        return Err(
            tr!(ko: "{what} 은(는) 디렉터리가 아닙니다", en: "{what} is not a folder", what = show(&dest)),
        );
    }

    let shown_dest = show(&dest);
    let mut sources: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for path in paths {
        let source = link_path(path)?;
        let shown = show(&source);
        if is_within(&shown, &shown_dest) {
            return Err(tr!(
                ko: "{shown} 을(를) 자기 자신(이나 그 안)으로는 넣을 수 없습니다",
                en: "{shown} cannot be put inside itself"
            ));
        }
        sources.push(source);
    }
    Ok((dest, sources))
}

/// 복사 — 계획을 세우고(분모 계산 포함) 실행한다.
///
/// `channel` 이 `None` 인 경로는 테스트뿐이다 (명령은 언제나 채널을 준다).
fn copy_many(
    paths: &[String],
    dest_dir: &str,
    on_conflict: OnConflict,
    op: u64,
    channel: Option<Channel<TransferProgress>>,
) -> Result<Vec<String>, String> {
    let (dest, sources) = prepare(paths, dest_dir)?;
    let cancel = Cancel::claim(op);

    let mut plan = Plan::default();
    for source in &sources {
        if let Some(target) = plan_copy(source, &dest, on_conflict, &cancel, &mut plan)? {
            plan.made.push(show(&target));
        }
    }

    let mut progress = match channel {
        Some(channel) => Progress::new(op, channel, plan.files, plan.bytes),
        None => Progress::silent(),
    };
    run_plan(&plan, &cancel, &mut progress)?;
    Ok(plan.made)
}

/// 이동 — `rename` 한 번이면 끝나는 길을 먼저 보고, 안 되면 복사한 뒤 지운다.
fn move_many(
    paths: &[String],
    dest_dir: &str,
    on_conflict: OnConflict,
) -> Result<Vec<String>, String> {
    let (dest, sources) = prepare(paths, dest_dir)?;
    let home = home_for_guard();
    let cancel = Cancel::inert();
    let mut made: Vec<String> = Vec::with_capacity(sources.len());

    for source in &sources {
        let shown = show(source);
        if is_protected(&shown, home.as_deref()) {
            return Err(tr!(
                ko: "{shown} 은(는) 옮길 수 없습니다 (드라이브 루트·홈)",
                en: "{shown} cannot be moved (a drive root or the home folder)"
            ));
        }
        let meta = std::fs::symlink_metadata(source).map_err(
            |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
        )?;

        let Some((target, clear, _)) =
            place_at(&dest, &leaf_name(source), kind_of_meta(&meta), on_conflict)?
        else {
            continue;
        };
        // 이미 그 자리에 있다 (같은 디렉터리로 옮기기) — 아무것도 하지 않는다.
        if same_path(&shown, &show(&target)) {
            made.push(show(&target));
            continue;
        }
        if clear {
            remove_any(&target)?;
        }

        // 같은 볼륨이면 여기서 끝난다 — 바이트가 움직이지 않으므로 진행률도 필요 없다.
        if std::fs::rename(source, &target).is_ok() {
            made.push(show(&target));
            continue;
        }

        // 볼륨이 다르거나(윈도우 `ERROR_NOT_SAME_DEVICE`), 대상 디렉터리가 이미 있어
        // rename 이 거절됐다(합치기). **복사가 끝난 것을 확인한 뒤에만** 원본을 지운다.
        let mut plan = Plan::default();
        let Some(landed) = plan_copy(source, &dest, on_conflict, &cancel, &mut plan)? else {
            continue;
        };
        let mut silent = Progress::silent();
        run_plan(&plan, &cancel, &mut silent)?;
        remove(&shown, true)?;
        made.push(show(&landed));
    }
    Ok(made)
}

/// 여러 항목을 지운다 — **첫 실패에서 멈추고 어디까지 됐는지 말해 준다**.
///
/// 지운 것을 되돌릴 방법이 없으므로 "몇 개는 됐고 어디서 멈췄다" 가 사용자가 다음에
/// 무엇을 할지 정할 수 있는 유일한 답이다.
fn remove_many(paths: &[String], recursive: bool) -> Result<(), String> {
    for (done, path) in paths.iter().enumerate() {
        remove(path, recursive).map_err(|e| {
            if done == 0 {
                e
            } else {
                tr!(ko: "{done}개를 지운 뒤 멈췄습니다 — {e}", en: "Stopped after deleting {done} items — {e}")
            }
        })?;
    }
    Ok(())
}

/// 문서 보기 타일용으로 파일 하나를 읽는다 — **앞 [`VIEW_MAX_BYTES`] 만** 읽는다.
///
/// 심링크는 따라간다(링크된 설정 파일도 그 내용을 보는 것이 자연스럽다). 폴더는 거절한다.
fn read_text(path: &str) -> Result<TextFile, String> {
    let full = absolute_input(path)?;
    let shown = show(&full);
    let meta = std::fs::metadata(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;
    if meta.is_dir() {
        return Err(
            tr!(ko: "{shown} 은(는) 폴더라 내용을 볼 수 없습니다", en: "{shown} is a folder, so there is nothing to view"),
        );
    }
    let file = std::fs::File::open(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 열지 못했습니다: {e}", en: "Could not open {shown}: {e}"),
    )?;
    let mut bytes: Vec<u8> = Vec::new();
    file.take(VIEW_MAX_BYTES).read_to_end(&mut bytes).map_err(
        |e| tr!(ko: "{shown} 을(를) 읽지 못했습니다: {e}", en: "Could not read {shown}: {e}"),
    )?;
    Ok(assemble(&bytes, meta.len()))
}

/// 문서 편집의 **저장** — 파일 하나를 새 글로 바꾼다 (docs/log/2026-09-27-doc-edit.md "R — 저장 명령").
///
/// ```text
///   경로 ─ canonicalize ─→ 대상 파일 (심링크면 링크가 가리키는 실파일 — 링크는 링크로 남는다)
///     ├ 없음 → [missing]      폴더 → 오류      쓰기 불가(읽기 전용) → 오류
///     ├ expected 가 있으면: 앞 2 MiB 를 읽어 version 비교 → 다르면 [conflict] (쓰지 않는다)
///     └ 같은 폴더의 .{이름}.aynx-save-* 에 쓰고 fsync → 원본의 권한을 입힌다 → rename(교체)
///         └ 임시 파일을 못 만들거나(폴더 쓰기 불가) 소유자·그룹이 달라지면 → 제자리 덮어쓰기
/// ```
///
/// 확인과 교체 사이의 짧은 틈(TOCTOU)은 남는다 — 그 사이에 다른 프로그램이 쓰면 그 변경은
/// 덮인다. 사람이 누르는 저장 한 번의 창이라 잠금 없이 둔다.
fn write_text(path: &str, text: &str, expected: Option<&str>) -> Result<SavedFile, String> {
    crate::text_file::check_save_size(text)?;
    let input = absolute_input(path)?;
    let shown = show(&input);
    let target = match std::fs::canonicalize(&input) {
        Ok(target) => target,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(crate::errors::missing(&shown))
        }
        Err(e) => {
            return Err(
                tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
            )
        }
    };
    let meta = std::fs::metadata(&target).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;
    if !meta.is_file() {
        return Err(
            tr!(ko: "{shown} 은(는) 파일이 아니라 저장할 수 없습니다", en: "{shown} is not a file, so it cannot be saved"),
        );
    }
    if meta.permissions().readonly() {
        return Err(
            tr!(ko: "{shown} 은(는) 읽기 전용이라 저장할 수 없습니다", en: "{shown} is read-only, so it cannot be saved"),
        );
    }
    // 권한 비트가 아니라 **실제로 쓸 수 있는가** — 유닉스의 남의 파일·윈도우 ACL 을 함께 본다.
    // 쓰기로 열기만 하고(자르지 않는다) 곧 닫으므로 내용도 시각도 바뀌지 않는다.
    std::fs::OpenOptions::new()
        .write(true)
        .open(&target)
        .map_err(
            |e| tr!(ko: "{shown} 에 쓸 수 없습니다: {e}", en: "Cannot write to {shown}: {e}"),
        )?;

    if let Some(expected) = expected {
        let file = std::fs::File::open(&target).map_err(
            |e| tr!(ko: "{shown} 을(를) 열지 못했습니다: {e}", en: "Could not open {shown}: {e}"),
        )?;
        let mut head: Vec<u8> = Vec::new();
        file.take(VIEW_MAX_BYTES).read_to_end(&mut head).map_err(
            |e| tr!(ko: "{shown} 을(를) 읽지 못했습니다: {e}", en: "Could not read {shown}: {e}"),
        )?;
        if !crate::text_file::matches_expected(&head, meta.len(), expected) {
            return Err(crate::errors::conflict(&shown));
        }
    }

    let bytes = text.as_bytes();
    if !replace_via_temp(&target, &meta, bytes, &shown)? {
        write_in_place(&target, bytes, &shown)?;
    }
    Ok(crate::text_file::saved(bytes))
}

/// 같은 폴더의 임시 파일에 쓰고 rename 으로 교체한다. **`false` 면 교체하지 않았다** —
/// 부른 쪽이 제자리 덮어쓰기로 간다 (임시 파일을 못 만들었거나, 교체하면 소유자·그룹이
/// 바뀐다). 임시 파일은 어느 길로 나가든 남기지 않는다.
fn replace_via_temp(
    target: &Path,
    meta: &Metadata,
    bytes: &[u8],
    shown: &str,
) -> Result<bool, String> {
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return Ok(false);
    };
    let tmp = dir.join(crate::text_file::save_temp_name(&name.to_string_lossy()));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    // 숨김·시스템 같은 **속성**을 임시 파일에 먼저 입힌다 — 교체 뒤에도 그대로 보이게.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const KEEP: u32 = FILE_ATTRIBUTE_HIDDEN | 0x4 /* SYSTEM */ | 0x20 /* ARCHIVE */ | 0x2000 /* NOT_CONTENT_INDEXED */;
        options.attributes(meta.file_attributes() & KEEP);
    }
    let Ok(mut file) = options.open(&tmp) else {
        return Ok(false);
    };
    let written = file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .and_then(|()| std::fs::set_permissions(&tmp, meta.permissions()));
    drop(file);
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(
            tr!(ko: "{shown} 을(를) 저장하지 못했습니다: {e}", en: "Could not save {shown}: {e}"),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let same_owner = std::fs::metadata(&tmp)
            .map(|made| made.uid() == meta.uid() && made.gid() == meta.gid())
            .unwrap_or(false);
        if !same_owner {
            let _ = std::fs::remove_file(&tmp);
            return Ok(false);
        }
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(
            tr!(ko: "{shown} 을(를) 저장하지 못했습니다: {e}", en: "Could not save {shown}: {e}"),
        );
    }
    Ok(true)
}

/// 제자리 덮어쓰기 — 소유자·권한·inode 가 그대로 남지만, 쓰다 끊기면 반쯤 쓰인 파일이 된다.
/// 원자적 교체를 할 수 없을 때만 온다 ([`replace_via_temp`]).
fn write_in_place(target: &Path, bytes: &[u8], shown: &str) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(target)
        .and_then(|mut file| file.write_all(bytes).and_then(|()| file.sync_all()))
        .map_err(|e| tr!(ko: "{shown} 을(를) 저장하지 못했습니다: {e}", en: "Could not save {shown}: {e}"))
}

/// 붙여넣기 전에 프런트가 묻는 값 — **목적지에서 부딪히는 것들**.
fn conflicts(paths: &[String], dest_dir: &str) -> Result<Vec<Conflict>, String> {
    let dest = real_path(dest_dir)?;
    let mut found: Vec<Conflict> = Vec::new();
    for path in paths {
        let source = link_path(path)?;
        let target = dest.join(leaf_name(&source));
        let Some(kind) = kind_at(&target) else {
            continue;
        };
        // 제자리(원본 자신)는 충돌이 아니다 — 물어볼 것이 없다.
        if same_path(&show(&source), &show(&target)) {
            continue;
        }
        found.push(Conflict {
            path: show(&target),
            kind: kind.label().to_string(),
        });
    }
    Ok(found)
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 파일시스템 호출은 **블로킹**이다. 잠든 디스크나 네트워크 드라이브에서 `read_dir`
/// 하나가 수백 ms 를 먹는 일이 흔해서, tokio 워커를 붙잡지 않도록 전용 스레드로 넘긴다.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))?
}

/// 브라우저가 처음 열 자리 — 사용자 홈 (`C:\Users\<user>`).
#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    blocking(home).await
}

/// 최상위 뿌리들 — 윈도우는 마운트된 드라이브(`C:\` · `D:\` …), 그 밖에서는 `["/"]`.
/// 프런트의 주소 표시줄과 루트 선택기가 이 목록 위에 선다.
#[tauri::command]
pub async fn local_roots() -> Result<Vec<String>, String> {
    blocking(|| Ok(roots())).await
}

/// 장소 패널의 붙박이 줄 하나 — 종류(`home` · `desktop` · `documents` · `downloads`)와 경로.
/// 이름은 프런트가 종류로 사전을 찾는다(Rust 는 글자를 짓지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LocalPlace {
    pub kind: &'static str,
    pub path: String,
}

/// 장소 패널의 붙박이 폴더들 — 홈 · 바탕 화면 · 문서 · 다운로드 (docs/log/2026-10-07-file-tile-dolphin.md).
///
/// **OS 가 알려 주는 자리**다 — `dirs` 크레이트가 Windows 는 알려진 폴더(KNOWNFOLDERID — OneDrive 로 옮긴 바탕
/// 화면도 그대로), 리눅스는 XDG 사용자 폴더, macOS 는 표준 경로로 푼다. OS 를 타는 분기가 그 크레이트 안에 있어
/// 여기에는 `#[cfg]` 가 없고 프런트도 OS 를 모른다. 실제로 있는 폴더만, 같은 경로는 한 번만(리눅스에서 XDG 가 없으면
/// 바탕 화면이 홈과 같아진다) 준다.
#[tauri::command]
pub async fn local_places() -> Result<Vec<LocalPlace>, String> {
    blocking(|| Ok(places())).await
}

fn places() -> Vec<LocalPlace> {
    let found = [
        ("home", dirs::home_dir()),
        ("desktop", dirs::desktop_dir()),
        ("documents", dirs::document_dir()),
        ("downloads", dirs::download_dir()),
    ];
    let mut out: Vec<LocalPlace> = Vec::new();
    for (kind, dir) in found {
        let Some(dir) = dir.filter(|d| d.is_dir()) else {
            continue;
        };
        let path = std::fs::canonicalize(&dir)
            .map(|real| show(&real))
            .unwrap_or_else(|_| show(&dir));
        if out.iter().any(|p| p.path == path) {
            continue;
        }
        out.push(LocalPlace { kind, path });
    }
    out
}

/// 디렉터리 하나의 목록. 정렬은 SFTP 브라우저와 **같은 함수**다 (디렉터리 먼저,
/// 이름 오름차순·대소문자 무시).
#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<SftpEntry>, String> {
    blocking(move || list(&path)).await
}

/// 항목 하나의 정보 (작업 뒤 새로고침·상세 표시용). lstat 의미다.
#[tauri::command]
pub async fn local_stat(path: String) -> Result<SftpEntry, String> {
    blocking(move || stat(&path)).await
}

/// 문서 보기 타일이 읽는 파일 한 장 — 앞 2 MiB 까지, 이진·잘림·UTF-8 여부와 `version` 을
/// 함께 준다 ([`crate::text_file`]). 폴더는 오류다.
#[tauri::command]
pub async fn local_read_text(path: String) -> Result<TextFile, String> {
    blocking(move || read_text(&path)).await
}

/// 미리 보기 패널의 파일 한 장 — **원시 바이트**(`tauri::ipc::Response` — JSON 숫자 배열로 부풀리지 않는다)
/// (docs/log/2026-10-07-file-tile-dolphin.md "10"). 프런트가 Blob URL 로 그린다 — 자산 프로토콜의 허용 범위를 넓히지
/// 않으려고 이 길을 탄다. [`PREVIEW_MAX_BYTES`] 를 넘거나 폴더면 오류다.
#[tauri::command]
pub async fn local_read_preview(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || read_preview(&path))
        .await
        .map(tauri::ipc::Response::new)
}

fn read_preview(path: &str) -> Result<Vec<u8>, String> {
    let full = absolute_input(path)?;
    let shown = show(&full);
    let meta = std::fs::metadata(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;
    if meta.is_dir() {
        return Err(
            tr!(ko: "{shown} 은(는) 폴더라 내용을 볼 수 없습니다", en: "{shown} is a folder, so there is nothing to view"),
        );
    }
    if meta.len() > PREVIEW_MAX_BYTES {
        return Err(preview_too_large(&shown));
    }
    let file = std::fs::File::open(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 열지 못했습니다: {e}", en: "Could not open {shown}: {e}"),
    )?;
    // 상한 + 1 까지만 읽는다 — 그사이 파일이 커졌으면 통째로 끌어오지 않고 거절한다
    let mut bytes: Vec<u8> = Vec::new();
    file.take(PREVIEW_MAX_BYTES + 1).read_to_end(&mut bytes).map_err(
        |e| tr!(ko: "{shown} 을(를) 읽지 못했습니다: {e}", en: "Could not read {shown}: {e}"),
    )?;
    if bytes.len() as u64 > PREVIEW_MAX_BYTES {
        return Err(preview_too_large(&shown));
    }
    Ok(bytes)
}

/// **이미지 타일**의 큰 그림 한 장 — [`local_read_preview`] 와 같은 원시 바이트(`ipc::Response`)이되 상한이
/// [`IMAGE_MAX_BYTES`] 이고 [`CHUNK`] 씩 읽으며 진행률(`TransferProgress` — 파일 1개 · 누적 바이트)을 보낸다. 취소는
/// 파일 묶음 작업과 같은 깃발(`op` → `transfer_cancel`)이라 다음 조각에서 멈추고 읽은 것은 버린다. 폴더면 오류다.
/// 미리 보기 패널은 이 명령을 쓰지 않는다(그쪽 상한은 그대로).
#[tauri::command]
pub async fn local_read_image(
    path: String,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<tauri::ipc::Response, String> {
    blocking(move || read_image(&path, op, Some(on_progress), IMAGE_MAX_BYTES))
        .await
        .map(tauri::ipc::Response::new)
}

/// [`local_read_image`] 의 몸통 — `channel` 이 `None` 인 길과 `max` 를 낮춘 길은 테스트뿐이다.
fn read_image(
    path: &str,
    op: u64,
    channel: Option<Channel<TransferProgress>>,
    max: u64,
) -> Result<Vec<u8>, String> {
    // 깃발을 먼저 집는다 — 부르자마자 누른 취소도 놓치지 않는다(`Cancel::claim`)
    let cancel = Cancel::claim(op);
    let full = absolute_input(path)?;
    let shown = show(&full);
    let meta = std::fs::metadata(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 찾지 못했습니다: {e}", en: "Could not find {shown}: {e}"),
    )?;
    if meta.is_dir() {
        return Err(
            tr!(ko: "{shown} 은(는) 폴더라 내용을 볼 수 없습니다", en: "{shown} is a folder, so there is nothing to view"),
        );
    }
    if meta.len() > max {
        return Err(image_too_large(&shown));
    }
    let mut file = std::fs::File::open(&full).map_err(
        |e| tr!(ko: "{shown} 을(를) 열지 못했습니다: {e}", en: "Could not open {shown}: {e}"),
    )?;
    let mut progress = match channel {
        Some(channel) => Progress::new(op, channel, 1, meta.len()),
        None => Progress::silent(),
    };
    progress.start(&shown);
    let mut bytes: Vec<u8> = Vec::with_capacity(meta.len() as usize);
    let mut buffer = vec![0u8; CHUNK];
    loop {
        cancel.check()?;
        let read = file.read(&mut buffer).map_err(
            |e| tr!(ko: "{shown} 을(를) 읽지 못했습니다: {e}", en: "Could not read {shown}: {e}"),
        )?;
        if read == 0 {
            break;
        }
        // 그사이 파일이 커졌으면 상한에서 멈춘다(통째로 끌어오지 않는다)
        if (bytes.len() + read) as u64 > max {
            return Err(image_too_large(&shown));
        }
        bytes.extend_from_slice(&buffer[..read]);
        progress.advance(read as u64);
    }
    progress.file_done();
    progress.finish();
    Ok(bytes)
}

/// 문서 편집의 저장 — `expectedVersion` 이 있으면 디스크가 그대로일 때만 쓴다(다르면
/// `[conflict]`, 파일이 없으면 `[missing]`). 돌려주는 값은 새 내용의 `version`·크기.
#[tauri::command]
pub async fn local_write_text(
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<SavedFile, String> {
    blocking(move || write_text(&path, &text, expected_version.as_deref())).await
}

/// 디렉터리를 만든다. 돌려주는 값은 만들어진 절대 경로.
#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<String, String> {
    blocking(move || mkdir(&path)).await
}

/// 빈 파일을 만든다(파일 타일의 [새 파일…]). 돌려주는 값은 만들어진 절대 경로.
#[tauri::command]
pub async fn local_create_file(path: String) -> Result<String, String> {
    blocking(move || create_file(&path)).await
}

/// 이름을 바꾼다. `to` 는 **절대 경로**이거나 **새 이름 한 조각**이다.
#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<String, String> {
    blocking(move || rename(&from, &to)).await
}

/// 지운다. 디렉터리는 `recursive` 가 참일 때만 안쪽까지 지운다.
#[tauri::command]
pub async fn local_remove(path: String, recursive: bool) -> Result<(), String> {
    blocking(move || remove(&path, recursive)).await
}

/// 여러 항목을 `destDir` 안으로 **복사**한다. 돌려주는 값은 만들어진 경로들.
///
/// - 디렉터리는 재귀로 복사하고, **심링크는 링크로** 복사한다 (따라가지 않는다).
/// - 자기 자신이나 자기 하위로 넣는 요청은 거절한다.
/// - 진행률은 `onProgress` 로 흐른다 (`op` 는 [`crate::fs_transfer::transfer_cancel`] 에 쓸 번호).
#[tauri::command]
pub async fn local_copy(
    paths: Vec<String>,
    dest_dir: String,
    on_conflict: OnConflict,
    op: u64,
    on_progress: Channel<TransferProgress>,
) -> Result<Vec<String>, String> {
    blocking(move || copy_many(&paths, &dest_dir, on_conflict, op, Some(on_progress))).await
}

/// 여러 항목을 `destDir` 안으로 **옮긴다**. 돌려주는 값은 옮겨진 뒤의 경로들.
///
/// 같은 볼륨이면 `rename` 한 번이라 바이트가 움직이지 않는다 — 그래서 진행률 채널이
/// 없다. 볼륨이 다르면 복사한 뒤 **복사 성공을 확인하고** 원본을 지운다.
#[tauri::command]
pub async fn local_move(
    paths: Vec<String>,
    dest_dir: String,
    on_conflict: OnConflict,
) -> Result<Vec<String>, String> {
    blocking(move || move_many(&paths, &dest_dir, on_conflict)).await
}

/// 여러 항목을 지운다 (드라이브 루트·홈 보호는 [`local_remove`] 와 같다).
#[tauri::command]
pub async fn local_remove_many(paths: Vec<String>, recursive: bool) -> Result<(), String> {
    blocking(move || remove_many(&paths, recursive)).await
}

/// 붙여넣기 전에 "덮어쓸까요?" 를 묻기 위한 사전 조회 — 목적지에서 부딪히는 것들.
#[tauri::command]
pub async fn local_conflicts(
    paths: Vec<String>,
    dest_dir: String,
) -> Result<Vec<Conflict>, String> {
    blocking(move || conflicts(&paths, &dest_dir)).await
}

/// **바이트 한 덩어리를 이 폴더에 파일로 쓴다** — 탐색기에서 로컬 파일 타일로 끌어다 놓은
/// 파일이 지나는 문 (docs/log/2026-09-04-native-drag-out.md "반대 방향").
///
/// ## 왜 경로가 아니라 바이트인가
///
/// 창이 `dragDropEnabled: false` 라 OS 파일 드롭은 **웹 표준 DnD** 로 들어온다 — 웹뷰가
/// 주는 것은 `File` 객체뿐이고 거기에는 원본 경로가 없다 (브라우저가 일부러 감춘다).
/// 그래서 이미 있는 `local_copy`(경로 → 경로)를 쓸 수 없고, 내용을 실어 보내는 문이
/// 하나 더 필요하다. 폴더는 `File` 로 오지 않으므로 이 문으로는 오지 않는다 — 그쪽은
/// 우클릭 [폴더 가져오기…] 가 대화상자로 경로를 받아 `local_copy` 로 간다.
///
/// ## 모양은 [`crate::sftp::upload_file`] 과 같다
///
/// 메타는 헤더로, 내용은 **raw 바디**로 온다. 두 문이 같은 모양이어야 프런트의 한 모달이
/// 목적지만 바꿔 양쪽을 다 태울 수 있다 (`+page` 의 업로드 모달).
///
/// 충돌은 붙여넣기와 **같은 정책 값**([`OnConflict`])을 받는다 — 정책이 `Skip` 이라
/// 아무것도 쓰지 않았으면 `null` 을 돌려준다 (오류가 아니다).
#[tauri::command]
pub async fn local_write_file(request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let header = |name: &str| -> Option<String> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };

    let dir = crate::sftp::percent_decode(&header("x-dir").ok_or_else(
        || tr!(ko: "대상 폴더가 없습니다", en: "The destination folder is missing"),
    )?)?;
    let name = crate::sftp::percent_decode(
        &header("x-file-name")
            .ok_or_else(|| tr!(ko: "파일 이름이 없습니다", en: "The file name is missing"))?,
    )?;
    let on_conflict = match header("x-on-conflict").as_deref() {
        None | Some("fail") => OnConflict::Fail,
        Some("overwrite") => OnConflict::Overwrite,
        Some("skip") => OnConflict::Skip,
        Some("rename") => OnConflict::Rename,
        Some(other) => {
            return Err(
                tr!(ko: "알 수 없는 충돌 정책입니다: {other}", en: "Unknown conflict policy: {other}"),
            )
        }
    };

    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(tr!(ko: "본문이 바이너리가 아닙니다", en: "The body is not binary"));
    };
    if data.len() > WRITE_MAX_BYTES {
        return Err(tr!(
            ko: "파일이 너무 큽니다 ({size}) — 끌어다 놓기는 {max} 까지만 지원합니다 (그보다 큰 것은 탐색기에서 복사하세요)",
            en: "The file is too large ({size}) — drag and drop supports up to {max} (copy anything larger in the file manager)",
            size = crate::sftp::human_size(data.len() as u64),
            max = crate::sftp::human_size(WRITE_MAX_BYTES as u64),
        ));
    }
    // 한 벌 복사한다. 바디는 요청에 매여 있는데(`'_`) 실제 쓰기는 전용 스레드로 넘기므로
    // (`blocking` — 잠든 디스크에서 write 하나가 초 단위다) `'static` 이 필요하다.
    let bytes = data.clone();
    blocking(move || write_file(&dir, &name, &bytes, on_conflict)).await
}

/// **사람이 저장 대화상자에서 고른 자리에 텍스트 한 덩어리를 쓴다** —
/// 타일 메뉴의 "스크롤백 저장…" 이 지나는 문
/// (docs/log/2026-09-17-scrollback-export-and-logs.md).
///
/// [`local_write_file`] 과 나눠 두는 이유는 대상이 다르기 때문이다. 저쪽은 **폴더 + 이름**을
/// 받아 충돌 정책(`OnConflict`)으로 자리를 고르는 문이고(탐색기에서 끌어다 놓은 파일),
/// 이쪽은 **사람이 이미 고른 전체 경로** 하나를 받는다 — 덮어쓸지 말지는 OS 저장 대화상자가
/// 이미 물었으므로 여기서 다시 묻지 않는다(그 물음을 두 번 하면 사용자는 같은 질문에 두 번
/// 답하게 된다).
///
/// 관문은 **절대 경로뿐**이다. 상대 경로를 받으면 기준이 앱의 현재 작업 디렉터리가 되는데,
/// 그 자리는 사용자가 모르는 곳이고(개발 중에는 `src-tauri/`) 실행 방식에 따라 달라진다 —
/// 파일이 "어디로 갔는지 모르게" 저장되는 것보다 거절이 낫다.
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    blocking(move || {
        let target = PathBuf::from(&path);
        if !target.is_absolute() {
            return Err(tr!(
                ko: "전체 경로가 필요합니다: {what}",
                en: "A full path is required: {what}",
                what = path
            ));
        }
        std::fs::write(&target, contents.as_bytes()).map_err(|e| {
            tr!(
                ko: "{what} 에 쓰지 못했습니다: {e}",
                en: "Could not write to {what}: {e}",
                what = show(&target)
            )
        })
    })
    .await
}

/// 파일 하나를 쓴다 — 이름 검사 · 목적지 확인 · 충돌 정책 · 쓰기. `None` 이면 건너뛴 것이다.
fn write_file(
    dir: &str,
    name: &str,
    bytes: &[u8],
    on_conflict: OnConflict,
) -> Result<Option<String>, String> {
    if !is_bare_name(name) {
        return Err(
            tr!(ko: "파일 이름에 경로를 넣을 수 없습니다: {name}", en: "A file name cannot contain a path: {name}"),
        );
    }
    let dest = real_path(dir)?;
    if !dest.is_dir() {
        return Err(
            tr!(ko: "{what} 은(는) 디렉터리가 아닙니다", en: "{what} is not a folder", what = show(&dest)),
        );
    }
    let Some((target, clear, _)) = place_at(&dest, name, Kind::File, on_conflict)? else {
        return Ok(None);
    };
    // 모양이 다른 것(디렉터리·심링크)이 그 이름을 차지하고 있으면 먼저 치운다 — 파일끼리는
    // 잘라 쓰기가 곧 덮어쓰기라 지우지 않는다 ([`crate::fs_transfer::decide`] 의 규칙).
    if clear {
        remove_any(&target)?;
    }
    std::fs::write(&target, bytes)
        .map_err(|e| tr!(ko: "{what} 에 쓰지 못했습니다: {e}", en: "Could not write to {what}: {e}", what = show(&target)))?;
    Ok(Some(show(&target)))
}

#[cfg(test)]
mod tests;
