//! **로컬 디스크** 파일 브라우저 — 목록·이동·만들기·이름 바꾸기·삭제.
//!
//! 목록 한 줄의 모양([`crate::fs_entry::SftpEntry`])과 정렬은 SFTP 쪽과 **같은 함수**를 쓴다 — 프런트는 UI 하나에 백엔드만 갈아 끼운다.
//! 나가는 모든 경로는 [`strip_verbatim`] 을 지난다 · 삭제 보호는 드라이브 루트 **전부**를 막는다 · 모든 호출은 [`blocking`] 뒤에 둔다.
//!
//! 마지막 조각의 심링크는 따라가지 않는다 — `canonicalize` 로 끝까지 풀면 링크를 지우라는 요청이 실파일을 지운다. 고치는 명령은
//! [`link_path`] 로 부모만 풀고, 들어갈 자리를 정하는 [`local_list`] 만 [`real_path`] 로 통째로 푼다.

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

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;

/// 끌어다 놓기로 받을 수 있는 파일 하나의 최대 크기 — 원격 업로드([`crate::sftp::upload_file`])와 같은 값이다.
const WRITE_MAX_BYTES: usize = 100 * 1024 * 1024;

/// 링크 자신의 속성에서 디렉터리를 가리키는지 읽는다 (`Metadata::is_dir()` 는 심링크에 대해 언제나 `false` 다).
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;

// `A:` ~ `Z:` 를 하나씩 `metadata` 로 두드리지 않는다 — 미디어 없는 이동식 드라이브가 "디스크를 넣으십시오" 하드 오류 창을 띄울 수 있다.
#[cfg(windows)]
#[allow(non_snake_case)]
#[link(name = "kernel32")]
extern "system" {
    fn GetLogicalDrives() -> u32;
}

// ---------------------------------------------------------------------------
// 순수 함수 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 윈도우의 **verbatim 접두사**(`\\?\`)를 뗀다. UNC 는 `\\?\UNC\서버\공유` → `\\서버\공유` 로 되돌린다.
pub(crate) fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

pub(crate) fn show(path: &Path) -> String {
    strip_verbatim(&path.to_string_lossy())
}

fn trim_tail(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        ""
    } else {
        trimmed
    }
}

/// **뿌리인가** — 참이면 지우기·이름 바꾸기가 막힌다. 대소문자 · 구분자 방향 · 꼬리 슬래시로 우회할 수 없어야 한다.
fn is_root_path(path: &str) -> bool {
    let trimmed = trim_tail(path);
    if trimmed.is_empty() {
        return true; // "/" · "\" · "//"
    }
    let bytes = trimmed.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn drive_root_of(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some(format!("{}:\\", bytes[0].to_ascii_uppercase() as char));
    }
    None
}

/// **윈도우는 대소문자를 가리지 않는다** — `c:\users\wl` 로 홈 보호를 우회할 수 없어야 한다.
fn same_path(a: &str, b: &str) -> bool {
    let (a, b) = (trim_tail(a), trim_tail(b));
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// 지우거나 이름을 바꾸면 안 되는 자리 — **드라이브 루트와 홈 자신**(홈 안은 지울 수 있다).
fn is_protected(path: &str, home: Option<&str>) -> bool {
    is_root_path(path) || home.is_some_and(|home| same_path(path, home))
}

/// 프런트가 준 경로의 구분자를 OS 것으로 맞춘다 — 유닉스에서는 `\` 를 건드리지 않는다(멀쩡한 파일 이름 글자다).
fn normalize_input(path: &str) -> String {
    let trimmed = path.trim();
    if cfg!(windows) {
        trimmed.replace('/', "\\")
    } else {
        trimmed.to_string()
    }
}

/// 이름 한 조각인가. `:` 도 막는다 — NTFS 의 `dest\a:b` 는 파일 `a` 의 숨은 대체 데이터 스트림을 연다.
pub(crate) fn is_bare_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

/// `target` 이 `root` 아래에 있는가 — 문자열 접두사가 아니라 컴포넌트 단위다(`C:\dest2` 가 `C:\dest` 로 통과하면 안 된다).
/// `root` 자신은 거짓이다.
pub(crate) fn contained_in(root: &Path, target: &Path) -> bool {
    target != root && target.starts_with(root)
}

fn parent_of(path: &Path) -> Result<&Path, String> {
    path.parent()
        .ok_or_else(|| tr!(ko: "{what} 의 부모 디렉터리가 없습니다: 여기가 뿌리입니다", en: "{what} has no parent folder: this is the root", what = show(path)))
}

fn leaf_name(path: &Path) -> String {
    match path.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => show(path),
    }
}

/// 1970 이전(시계가 틀어진 채 만들어진 파일)은 음수다.
fn secs_since_epoch(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_secs() as i64,
        Err(before) => -(before.duration().as_secs() as i64),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn hidden_from_attributes(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg_attr(not(windows), allow(dead_code))]
fn is_directory_attribute(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_DIRECTORY != 0
}

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

/// 프런트가 준 경로 → **절대 경로**. 상대 경로는 거절한다 — 프로세스 현재 디렉터리 기준이면 지우는 명령이 엉뚱한 자리를 가리킨다.
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

pub(crate) fn real_path(path: &str) -> Result<PathBuf, String> {
    let input = absolute_input(path)?;
    std::fs::canonicalize(&input)
        .map_err(|e| tr!(ko: "{what} 을(를) 찾지 못했습니다: {e}", en: "Could not find {what}: {e}", what = show(&input)))
}

/// **부모만** 실경로로 풀고 마지막 조각은 그대로 둔다 (lstat 의미). 마지막 조각은 아직 없어도 된다.
pub(crate) fn link_path(path: &str) -> Result<PathBuf, String> {
    let input = absolute_input(path)?;
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

/// 윈도우는 `null` 이다 — ACL 은 세 자리로 접히지 않아 지어내지 않는다(프런트는 `mode == null` 이면 권한 칸을 접는다).
#[cfg(unix)]
fn mode_of(meta: &Metadata) -> Option<u32> {
    Some(meta.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn mode_of(_meta: &Metadata) -> Option<u32> {
    None
}

/// 윈도우 밖은 `false` 다 — 점 파일 규칙은 프런트가 이름으로 판단해 OR 로 묶는다.
#[cfg(windows)]
fn hidden_of(meta: &Metadata) -> Option<bool> {
    Some(hidden_from_attributes(meta.file_attributes()))
}

#[cfg(not(windows))]
fn hidden_of(_meta: &Metadata) -> Option<bool> {
    Some(false)
}

/// 심링크가 적어 둔 문자열과 가리키는 곳이 디렉터리인지 — 끊어진 링크는 오류가 아니다.
fn link_info(path: &Path) -> (Option<String>, bool) {
    let target = std::fs::read_link(path).ok().map(|target| show(&target));
    let link_is_dir = std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    (target, link_is_dir)
}

fn entry_at(path: &Path, name: String, meta: &Metadata) -> SftpEntry {
    let file_type = meta.file_type();
    // 심링크를 먼저 본다 — 윈도우의 디렉터리 심링크는 `is_dir()` 이 false 다.
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

/// 있는 자리면 실경로로 돌려준다 (목록이 주는 경로와 모양이 같아야 한다).
fn home() -> Result<String, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| tr!(ko: "홈 디렉터리를 찾지 못했습니다: 사용자 프로필 경로가 없습니다", en: "Could not find the home folder: there is no user profile path"))?;
    Ok(std::fs::canonicalize(&home)
        .map(|real| show(&real))
        .unwrap_or_else(|_| show(&home)))
}

/// 보호 판정에 쓸 홈. 없어도 계속 간다 — 뿌리 보호는 홈 없이도 선다.
fn home_for_guard() -> Option<String> {
    home().ok()
}

#[cfg(windows)]
fn roots() -> Vec<String> {
    let drives = drives_from_mask(unsafe { GetLogicalDrives() });
    if !drives.is_empty() {
        return drives;
    }
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

fn list(path: &str) -> Result<Vec<SftpEntry>, String> {
    let dir = real_path(path)?;
    let read = std::fs::read_dir(&dir)
        .map_err(|e| tr!(ko: "{what} 목록을 읽지 못했습니다: {e}", en: "Could not list {what}: {e}", what = show(&dir)))?;

    let mut entries: Vec<SftpEntry> = Vec::new();
    for item in read {
        // 훑는 도중 사라진 항목 하나 때문에 목록 전체가 실패하면 안 된다 — 그 한 줄만 빠진다.
        let Ok(item) = item else { continue };
        let Ok(meta) = item.metadata() else { continue };
        let full = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        entries.push(entry_at(&full, name, &meta));
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// **lstat 이다** — 심링크는 자기 자신으로 보고된다.
fn stat(path: &str) -> Result<SftpEntry, String> {
    let full = link_path(path)?;
    let meta = std::fs::symlink_metadata(&full)
        .map_err(|e| tr!(ko: "{what} 정보를 읽지 못했습니다: {e}", en: "Could not read information about {what}: {e}", what = show(&full)))?;
    Ok(entry_at(&full, leaf_name(&full), &meta))
}

/// 디렉터리를 만든다. 중간 경로는 만들지 않는다 — 오타 한 번으로 없던 트리를 통째로 만들지 않게.
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

/// 빈 파일을 만든다 — 이미 있으면 [exists] 로 거절하고 덮어쓰지 않는다(`create_new` 라 확인과 만들기 사이의 틈도 OS 가 막는다).
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

/// `to` 를 목표 경로로 푼다 — **절대 경로**이거나 **새 이름 한 조각**이다. 상대 경로로 트리 밖을 가리킬 길은 없다.
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

/// 대상이 이미 있으면 거절한다 — `MoveFileEx` 는 덮어쓰기가 기본이다. 대소문자만 바꾸는 경우(`a.txt` → `A.txt`)는 예외다.
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

/// 심링크·정션은 **링크만** 지운다 — 디렉터리를 가리키는 링크는 `remove_dir` 로 지워야 하고, 어느 쪽인지는 링크 자신의 속성이 말한다.
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

fn is_non_empty(path: &Path) -> bool {
    std::fs::read_dir(path)
        .map(|mut read| read.next().is_some())
        .unwrap_or(false)
}

/// 파일이나 디렉터리를 지운다 — 심링크·정션은 링크만 · 드라이브 루트와 홈은 어떤 경우에도 거절한다.
///
/// [`crate::sftp_browser`] 도 이 몸통을 탄다 — 보호 규칙이 한 자리에만 있어야 한다.
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

/// **심링크가 먼저다** — 윈도우의 디렉터리 심링크는 `is_dir()` 이 거짓이지만 파일도 아니다.
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

/// 그 자리에 무엇이 있는가 (**링크는 따라가지 않는다**).
pub(crate) fn kind_at(path: &Path) -> Option<Kind> {
    std::fs::symlink_metadata(path)
        .ok()
        .map(|meta| kind_of_meta(&meta))
}

/// `path` 가 `ancestor` 자신이거나 그 **아래**인가 — 막지 않으면 `C:\a` → `C:\a\b` 복사가 자기가 만든 것을 다시 훑으며 디스크를 채운다.
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

/// 무엇이든 그 자리에서 치운다(없으면 성공) — 심링크는 **링크만** 지운다.
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

/// 계획 한 걸음. 충돌 정책은 **이미 적용된** 상태다.
enum Step {
    /// 이미 디렉터리로 있으면 그대로 쓴다 = 합치기.
    Dir { target: PathBuf, clear: bool },
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

#[derive(Default)]
struct Plan {
    steps: Vec<Step>,
    /// 최상위 항목이 **실제로 놓인** 자리 (자동 이름으로 밀렸을 수 있다).
    made: Vec<String>,
    files: u32,
    bytes: u64,
}

/// 돌려주는 값은 `(놓을 자리, 지우고 놓아야 하는가, 이미 있던 자리인가)` 다. `None` 이면 건너뛴다.
pub(crate) fn place_at(
    dest: &Path,
    name: &str,
    source: Kind,
    on_conflict: OnConflict,
) -> Result<Option<(PathBuf, bool, bool)>, String> {
    // 이름 한 조각이 아니면 `dest.join(name)` 이 `dest` 밖으로 나간다 — 원격 목록이 준 이름이 여기까지 오므로 먼저 막는다.
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
    // 자기 자신 위에 놓으라는 요청은 아무것도 하지 않는다 — 막지 않으면 `Overwrite` 가 원본을 잘라 놓고 그 잘린 파일을 읽는다.
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

/// `fresh` 는 이 자리가 비어 있었는가 — 중간에 끊기면 우리가 만든 것만 지운다(덮어쓰던 남의 파일까지 없애지 않는다).
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

    // 권한 보존은 **시도**뿐이다 — 실패해도 복사 자체는 성공이다.
    if let Ok(meta) = std::fs::metadata(source) {
        let _ = std::fs::set_permissions(target, meta.permissions());
    }
    Ok(())
}

#[cfg(windows)]
fn copy_link(source: &Path, target: &Path) -> Result<(), String> {
    let raw = std::fs::read_link(source)
        .map_err(|e| tr!(ko: "{what} 링크를 읽지 못했습니다: {e}", en: "Could not read the link {what}: {e}", what = show(source)))?;
    // 디렉터리 링크와 파일 링크는 만드는 API 가 다르다 — 링크 자신의 속성으로 가른다.
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

/// **자기 자신·자기 하위로 넣는 요청은 여기서 막는다**.
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

/// `channel` 이 `None` 인 경로는 테스트뿐이다.
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
        if same_path(&shown, &show(&target)) {
            made.push(show(&target));
            continue;
        }
        if clear {
            remove_any(&target)?;
        }

        if std::fs::rename(source, &target).is_ok() {
            made.push(show(&target));
            continue;
        }

        // rename 이 안 됐다(볼륨이 다르거나 합치기) — **복사가 끝난 것을 확인한 뒤에만** 원본을 지운다.
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

/// 여러 항목을 지운다 — **첫 실패에서 멈추고 어디까지 됐는지 말해 준다**(지운 것은 되돌릴 수 없다).
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

/// 문서 보기 타일용으로 **앞 [`VIEW_MAX_BYTES`] 만** 읽는다. 심링크는 따라간다.
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

/// 문서 편집의 **저장** (docs/log/2026-09-27-doc-edit.md "R — 저장 명령") — 심링크면 실파일에 쓰고 링크는 링크로 남는다.
/// `expected` 가 다르면 쓰지 않는다([conflict]). 확인과 교체 사이의 틈(TOCTOU)은 알고 받은 한계다 — 잠금 없이 둔다.
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
    // 권한 비트가 아니라 **실제로 쓸 수 있는가** — 쓰기로 열기만 하고(자르지 않는다) 곧 닫는다.
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

/// 같은 폴더의 임시 파일에 쓰고 rename 으로 교체한다. **`false` 면 교체하지 않았다**(임시 파일을 못 만들었거나 소유자·그룹이
/// 바뀐다) — 부른 쪽이 제자리 덮어쓰기로 간다. 임시 파일은 어느 길로 나가든 남기지 않는다.
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

/// 제자리 덮어쓰기 — 쓰다 끊기면 반쯤 쓰인 파일이 된다. 원자적 교체를 할 수 없을 때만 온다.
fn write_in_place(target: &Path, bytes: &[u8], shown: &str) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(target)
        .and_then(|mut file| file.write_all(bytes).and_then(|()| file.sync_all()))
        .map_err(|e| tr!(ko: "{shown} 을(를) 저장하지 못했습니다: {e}", en: "Could not save {shown}: {e}"))
}

fn conflicts(paths: &[String], dest_dir: &str) -> Result<Vec<Conflict>, String> {
    let dest = real_path(dest_dir)?;
    let mut found: Vec<Conflict> = Vec::new();
    for path in paths {
        let source = link_path(path)?;
        let target = dest.join(leaf_name(&source));
        let Some(kind) = kind_at(&target) else {
            continue;
        };
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

/// 잠든 디스크 · 네트워크 드라이브에서 `read_dir` 하나가 수백 ms 를 먹는다 — tokio 워커를 붙잡지 않게 넘긴다.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))?
}

#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    blocking(home).await
}

#[tauri::command]
pub async fn local_roots() -> Result<Vec<String>, String> {
    blocking(|| Ok(roots())).await
}

/// 이름은 프런트가 종류로 사전을 찾는다(Rust 는 글자를 짓지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LocalPlace {
    pub kind: &'static str,
    pub path: String,
}

/// 장소 패널의 붙박이 폴더들 (docs/log/2026-10-07-file-tile-dolphin.md) — OS 분기는 `dirs` 크레이트 안에 있어 여기에는 `#[cfg]` 가 없다.
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

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<SftpEntry>, String> {
    blocking(move || list(&path)).await
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<SftpEntry, String> {
    blocking(move || stat(&path)).await
}

#[tauri::command]
pub async fn local_read_text(path: String) -> Result<TextFile, String> {
    blocking(move || read_text(&path)).await
}

/// 미리 보기 패널의 파일 한 장 — **원시 바이트**(`ipc::Response`) (docs/log/2026-10-07-file-tile-dolphin.md "10").
/// 자산 프로토콜의 허용 범위를 넓히지 않으려고 이 길을 탄다.
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
    // 상한 + 1 까지만 읽는다 — 그사이 파일이 커졌으면 거절한다
    let mut bytes: Vec<u8> = Vec::new();
    file.take(PREVIEW_MAX_BYTES + 1).read_to_end(&mut bytes).map_err(
        |e| tr!(ko: "{shown} 을(를) 읽지 못했습니다: {e}", en: "Could not read {shown}: {e}"),
    )?;
    if bytes.len() as u64 > PREVIEW_MAX_BYTES {
        return Err(preview_too_large(&shown));
    }
    Ok(bytes)
}

/// **이미지 타일**의 큰 그림 한 장 — 상한이 [`IMAGE_MAX_BYTES`] 이고 취소는 파일 묶음 작업과 같은 깃발(`op` → `transfer_cancel`)이다.
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

/// `channel` 이 `None` 인 길과 `max` 를 낮춘 길은 테스트뿐이다.
fn read_image(
    path: &str,
    op: u64,
    channel: Option<Channel<TransferProgress>>,
    max: u64,
) -> Result<Vec<u8>, String> {
    // 깃발을 먼저 집는다 — 부르자마자 누른 취소도 놓치지 않는다
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

#[tauri::command]
pub async fn local_write_text(
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<SavedFile, String> {
    blocking(move || write_text(&path, &text, expected_version.as_deref())).await
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<String, String> {
    blocking(move || mkdir(&path)).await
}

#[tauri::command]
pub async fn local_create_file(path: String) -> Result<String, String> {
    blocking(move || create_file(&path)).await
}

#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<String, String> {
    blocking(move || rename(&from, &to)).await
}

#[tauri::command]
pub async fn local_remove(path: String, recursive: bool) -> Result<(), String> {
    blocking(move || remove(&path, recursive)).await
}

/// 디렉터리는 재귀로, **심링크는 링크로** 복사한다 (따라가지 않는다).
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

#[tauri::command]
pub async fn local_move(
    paths: Vec<String>,
    dest_dir: String,
    on_conflict: OnConflict,
) -> Result<Vec<String>, String> {
    blocking(move || move_many(&paths, &dest_dir, on_conflict)).await
}

#[tauri::command]
pub async fn local_remove_many(paths: Vec<String>, recursive: bool) -> Result<(), String> {
    blocking(move || remove_many(&paths, recursive)).await
}

#[tauri::command]
pub async fn local_conflicts(
    paths: Vec<String>,
    dest_dir: String,
) -> Result<Vec<Conflict>, String> {
    blocking(move || conflicts(&paths, &dest_dir)).await
}

/// **바이트 한 덩어리를 이 폴더에 파일로 쓴다** — 탐색기에서 끌어다 놓은 파일의 문 (docs/log/2026-09-04-native-drag-out.md "반대 방향").
///
/// 경로가 아니라 바이트인 이유: `dragDropEnabled: false` 라 웹 표준 DnD 의 `File` 에는 원본 경로가 없다.
/// 모양은 [`crate::sftp::upload_file`] 과 같다 — 프런트의 한 업로드 모달이 목적지만 바꿔 양쪽을 태운다.
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
    // 바디는 요청에 매여 있어(`'_`) 전용 스레드로 넘기려면 한 벌 복사한다.
    let bytes = data.clone();
    blocking(move || write_file(&dir, &name, &bytes, on_conflict)).await
}

/// **사람이 저장 대화상자에서 고른 전체 경로**에 텍스트를 쓴다 (docs/log/2026-09-17-scrollback-export-and-logs.md).
/// 덮어쓸지는 OS 대화상자가 이미 물었다 · 상대 경로는 거절한다(기준이 앱의 현재 작업 디렉터리가 된다).
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

/// `None` 이면 건너뛴 것이다.
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
    // 모양이 다른 것(디렉터리·심링크)이 그 이름을 차지하고 있으면 먼저 치운다 — 파일끼리는 잘라 쓰기가 곧 덮어쓰기다.
    if clear {
        remove_any(&target)?;
    }
    std::fs::write(&target, bytes)
        .map_err(|e| tr!(ko: "{what} 에 쓰지 못했습니다: {e}", en: "Could not write to {what}: {e}", what = show(&target)))?;
    Ok(Some(show(&target)))
}

#[cfg(test)]
mod tests;
