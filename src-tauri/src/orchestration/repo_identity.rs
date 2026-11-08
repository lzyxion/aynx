//! 앨범 저장소 신원 — 파일과 git 조회는 잠금 밖에서 수행한다.
use crate::i18n::tr;
use std::path::Path;

/// 지금 그 경로의 저장소 신원.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepoIdentity {
    /// `git rev-parse --path-format=absolute --git-common-dir` 를 [`crate::worktree::comparable`] 로 편 것.
    pub git_dir: String,
    /// `<작업 폴더 식별>/<공통 .git 식별>` — 식별을 못 재는 OS(스텁)면 `None`.
    pub repo_id: Option<String>,
}

/// 신원을 못 쟀다 — 화면 상태(`missing` · `identity-changed`)와 저장 거절 문구를 가른다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IdentityError {
    /// 폴더가 없다(옮겼거나 지웠다).
    Missing,
    /// 절대 경로가 아니다.
    NotAbsolute,
    /// `.git` 이 없다.
    NotRepo,
    /// `.git` 이 파일이다(보조 worktree — 주 저장소만 맡긴다).
    Secondary,
    /// 폴더 또는 `.git` 이 정션 · 심볼릭 링크다(따라가지 않는다 — S16).
    Link,
    /// git 이 공통 폴더를 말하지 못했다.
    Git(String),
}

impl IdentityError {
    pub(crate) fn text(&self) -> String {
        match self {
            IdentityError::Missing => tr!(ko: "폴더가 없습니다", en: "The folder does not exist"),
            IdentityError::NotAbsolute => {
                tr!(ko: "저장소 경로는 절대 경로여야 합니다", en: "The repository path must be absolute")
            }
            IdentityError::NotRepo => {
                tr!(ko: "git 저장소가 아닙니다(.git 이 없음)", en: "Not a git repository (no .git)")
            }
            IdentityError::Secondary => tr!(
                ko: "보조 worktree 는 맡길 수 없습니다 — 주 저장소 폴더를 고르세요",
                en: "A linked worktree cannot be delegated — pick the main repository folder"
            ),
            IdentityError::Link => tr!(
                ko: "정션 · 심볼릭 링크인 폴더는 맡길 수 없습니다 — 실제 폴더를 고르세요",
                en: "A junction or symbolic link cannot be delegated — pick the real folder"
            ),
            IdentityError::Git(why) => {
                tr!(ko: "git 이 저장소를 읽지 못했습니다: {why}", en: "git could not read the repository: {why}", why = why)
            }
        }
    }
}

/// 실체 식별 두 개를 이어 붙인다 — 식별을 재는 OS 에서 하나라도 못 재면(링크) `Err(Link)`, 스텁 OS 면 `Ok(None)`. `id` 는 OS 함수
/// (시험이 바꿔 끼운다).
fn repo_id_of(
    repo: &Path,
    git_dir: &Path,
    supported: bool,
    id: impl Fn(&Path) -> Option<String>,
) -> Result<Option<String>, IdentityError> {
    if !supported {
        return Ok(None);
    }
    match (id(repo), id(git_dir)) {
        (Some(a), Some(b)) => Ok(Some(format!("{a}/{b}"))),
        _ => Err(IdentityError::Link),
    }
}

/// 지금 그 경로의 신원 — **블로킹**(git 한 번). 주 저장소(`.git` 이 폴더)만.
pub(crate) fn identity_now(path: &Path) -> Result<RepoIdentity, IdentityError> {
    if !path.is_absolute() {
        return Err(IdentityError::NotAbsolute);
    }
    if !path.is_dir() {
        return Err(IdentityError::Missing);
    }
    let dot = path.join(".git");
    match std::fs::symlink_metadata(&dot) {
        Err(_) => return Err(IdentityError::NotRepo),
        Ok(m) if m.is_file() => return Err(IdentityError::Secondary),
        Ok(m) if !m.is_dir() => return Err(IdentityError::Link),
        Ok(_) => {}
    }
    use crate::orchestration::git::{child_env, Git};
    let env = child_env(std::env::vars_os());
    let hooks = crate::orchestration::worktree::empty_hooks_dir();
    let g =
        Git::new(path, &hooks, &env, "not-a-repo").map_err(|e| IdentityError::Git(e.message))?;
    let common = g
        .ok(
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            &[],
            None,
        )
        .map_err(|e| IdentityError::Git(e.message))?;
    let common = common.trim().to_string();
    let repo_id = repo_id_of(
        path,
        Path::new(&common),
        dir_identity_supported(),
        dir_identity,
    )?;
    Ok(RepoIdentity {
        git_dir: crate::worktree::comparable(&common),
        repo_id,
    })
}

/// 적어 둔 신원과 지금 신원이 같은가 — 공통 폴더는 비교용 글자로, 실체 식별은 둘 다 있을 때 같아야 하고 한쪽만 있으면 어긋남(손 편집 ·
/// OS 가 바뀜 — 닫힌 쪽). 둘 다 없으면(스텁 OS) 경로 · 공통 폴더만. 순수.
pub(crate) fn identity_matches(expected: &RepoIdentity, now: &RepoIdentity) -> bool {
    let git_ok = Some(expected.git_dir.as_str()).is_some_and(|g| {
        crate::worktree::comparable(g) == crate::worktree::comparable(&now.git_dir)
    });
    let id_ok = match (expected.repo_id.as_deref(), now.repo_id.as_deref()) {
        (Some(a), Some(b)) => a == b,
        (None, None) => true,
        _ => false,
    };
    git_ok && id_ok
}

/// **디렉터리의 실체 식별**(저장소 맡기기의 신원 — 헤드리스 설계 2-6 · 실측 S16). 같은 경로에 지우고 다시 만든 폴더 · 이름 바꾸고 원래
/// 이름에 새로 만든 폴더는 다른 값이 된다(경로 스냅샷만으로는 못 가린다). 마지막 낱말이 정션 · 심볼릭 링크면 **따라가지 않고 `None`**
/// (부르는 쪽이 거절 — 따라가면 대상의 식별이 나와 바꿔치기가 같은 것으로 보인다). Windows = 볼륨 일련번호 + 64비트 파일 인덱스
/// (`vvvvvvvv-hhhhhhhhllllllll`).
///
/// 아직 구현하지 않은 OS 는 **명시적 `None` 스텁**이다 — 그 OS 에서는 경로 + git 공통 폴더 스냅샷만으로 신원을 본다([`dir_identity_supported`]
/// 가 거짓). 유닉스의 몸은 `symlink_metadata` 의 `dev` · `ino`(링크면 `None`)가 될 자리다.
pub(crate) fn dir_identity(path: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        dir_identity_windows(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

/// 이 OS 가 [`dir_identity`] 를 재는가 — 거짓이면 `None` 은 "모른다"(스텁)이고, 참이면 `None` 은 "링크 · 없음 — 거절" 이다.
pub(crate) fn dir_identity_supported() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
fn dir_identity_windows(path: &std::path::Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use std::{
        mem::zeroed,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    let w: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: 끝이 NUL 인 넓은 글자 버퍼와 이 함수 안의 구조체 하나만 넘긴다 · 연 손잡이는 여기서 닫는다.
    unsafe {
        let h = CreateFileW(
            w.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        );
        if h == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = zeroed();
        let ok = GetFileInformationByHandle(h, &mut info);
        CloseHandle(h);
        if ok == 0
            || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return None;
        }
        Some(format!(
            "{:08x}-{:08x}{:08x}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repo_identity_includes_dir_id() {
        let a = RepoIdentity {
            git_dir: "C:/repo/.git".into(),
            repo_id: Some("a/b".into()),
        };
        let mut b = a.clone();
        assert!(identity_matches(&a, &b));
        b.repo_id = Some("new/b".into());
        assert!(!identity_matches(&a, &b));
        b.repo_id = None;
        assert!(!identity_matches(&a, &b));
        assert_eq!(
            repo_id_of(Path::new("a"), Path::new("b"), false, |_| None),
            Ok(None)
        );
        assert_eq!(
            repo_id_of(Path::new("a"), Path::new("b"), true, |_| None),
            Err(IdentityError::Link)
        );
    }
    #[test]
    #[cfg(windows)]
    fn dir_identity_tracks_recreate_and_rename() {
        let root = std::env::temp_dir().join(format!(
            "aynx-dirid-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let a = root.join("repo");
        std::fs::create_dir(&a).unwrap();
        let first = dir_identity(&a).expect("폴더는 잰다");
        assert!(first.len() == 25 && first.as_bytes()[8] == b'-', "{first}");
        std::fs::write(a.join("f.txt"), "x").unwrap();
        std::fs::create_dir(a.join("sub")).unwrap();
        assert_eq!(
            dir_identity(&a).as_deref(),
            Some(first.as_str()),
            "안을 고쳐도 그대로"
        );
        // 지우고 같은 자리에 다시
        std::fs::remove_dir_all(&a).unwrap();
        std::fs::create_dir(&a).unwrap();
        let second = dir_identity(&a).unwrap();
        assert_ne!(first, second, "같은 경로의 새 폴더");
        // 이름 바꾸고 원래 이름에 새로 — 옮긴 폴더는 옛 값을 지닌다
        let moved = root.join("repo-old");
        std::fs::rename(&a, &moved).unwrap();
        assert_eq!(dir_identity(&moved).as_deref(), Some(second.as_str()));
        std::fs::create_dir(&a).unwrap();
        assert_ne!(dir_identity(&a).as_deref(), Some(second.as_str()));
        // 파일 · 없는 경로는 None
        assert_eq!(dir_identity(&moved.join("nope")), None);
        std::fs::write(root.join("file"), "x").unwrap();
        assert_eq!(dir_identity(&root.join("file")), None);
        // 정션 — 따라가지 않는다(만들 수 있을 때만)
        let link = root.join("link");
        let made = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(&moved)
            .output()
            .is_ok_and(|o| o.status.success());
        if made {
            assert_eq!(dir_identity(&link), None, "정션은 None(거절)");
            let _ = std::fs::remove_dir(&link); // 링크만 걷는다(대상은 그대로)
        }
        std::fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn identity_now_rejects_non_main_repos() {
        assert_eq!(
            identity_now(Path::new("relative/x")),
            Err(IdentityError::NotAbsolute)
        );
        let root = std::env::temp_dir().join(format!(
            "aynx-repoid-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(
            identity_now(&root.join("missing")),
            Err(IdentityError::Missing)
        );
        assert_eq!(identity_now(&root), Err(IdentityError::NotRepo));
        std::fs::write(root.join(".git"), "gitdir: elsewhere").unwrap();
        assert_eq!(identity_now(&root), Err(IdentityError::Secondary));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
