//! **파일 한 장을 원자적으로 갈아 끼운다** — 같은 폴더의 고유 임시 파일에 쓰고 `rename` 한다.
//!
//! 처음 `agent_instructions` 안에 있던 한 벌을 공용으로 뺐다(설정·위임 표·`~/.ssh/config` 가 함께 쓴다).
//! 지키는 것:
//! - 중간에 죽어도 **반쯤 쓰인 파일이 남지 않는다** — 읽는 쪽은 옛것 아니면 새것만 본다.
//! - 임시 이름은 pid **와** 순번이다 — 창이 여럿이어도 한 프로세스라 pid 만으로는 두 저장이
//!   같은 임시 파일을 덮는다. `create_new` 로 열어 남의 파일을 이어 쓰지 않는다.
//! - 실패하면 임시 파일을 치운다. `rename` 은 Windows 에서도 대상이 있으면 덮는다(MOVEFILE_REPLACE_EXISTING).
//! - 유닉스면 원본의 권한 비트를 임시 파일에 옮긴 뒤 바꾼다(`~/.ssh/config` 의 0600). Windows 는
//!   임시 파일이 같은 폴더의 ACL 을 물려받는다 — 숨김 같은 파일 속성은 옮기지 않는다.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// `path` 를 `bytes` 로 원자적으로 바꾼다. 상위 폴더는 부르는 쪽이 만든다.
///
/// `path` 가 심볼릭 링크면 **링크를 그대로 두고 대상을 바꾼다**(dotfile 링크를 끊지 않는다 — 예전
/// `fs::write` 와 같은 결과). 링크 자체를 갈아 끼우던 `agent_instructions` 는 [`write_atomic`] 을 쓴다.
pub(crate) fn replace_through_link(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic(&link_target(path)?, bytes)
}

/// `path` 이름 그대로 원자 교체한다(링크면 링크 자리에 새 파일이 선다).
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(std::io::ErrorKind::NotFound.into());
    };
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{}.{}-{sequence}.tmp", name.to_string_lossy(), std::process::id()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    // 이름을 바꾸기 **전에** 내용을 디스크로 내린다 — 전원이 끊겨도 "이름은 새것, 내용은 빈" 파일이 없게.
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    let saved = written
        .and_then(|()| keep_mode(path, &tmp))
        .and_then(|()| std::fs::rename(&tmp, path));
    if saved.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    saved
}

/// 링크면 가리키는 실제 경로, 아니면(없는 파일 포함) 그대로.
fn link_target(path: &Path) -> std::io::Result<PathBuf> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => std::fs::canonicalize(path),
        _ => Ok(path.to_path_buf()),
    }
}

#[cfg(unix)]
fn keep_mode(target: &Path, tmp: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(target) {
        Ok(meta) => std::fs::set_permissions(tmp, std::fs::Permissions::from_mode(meta.permissions().mode() & 0o7777)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // 첫 저장 — 기본 권한
        Err(e) => Err(e),
    }
}

/// 유닉스 밖은 옮길 권한 비트가 없다 — 위 머리말의 ACL 상속이 그 자리다.
#[cfg(not(unix))]
fn keep_mode(_target: &Path, _tmp: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("aynx-atomic-{tag}-{}-{sequence}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> =
            std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn replaces_existing_and_leaves_no_temp_file() {
        let dir = temp_dir("replace");
        let path = dir.join("a.toml");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        assert_eq!(names(&dir), ["a.toml"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_rename_cleans_up_the_temp_file() {
        let dir = temp_dir("fail");
        let path = dir.join("taken");
        std::fs::create_dir(&path).unwrap(); // 폴더 자리에는 파일로 갈아 끼울 수 없다
        assert!(write_atomic(&path, b"x").is_err());
        assert_eq!(names(&dir), ["taken"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_mode_and_follows_links() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        let real = dir.join("config");
        std::fs::write(&real, "old").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        replace_through_link(&link, b"new").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
        assert_eq!(std::fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
