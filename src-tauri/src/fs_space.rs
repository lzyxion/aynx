//! **남은 공간** — 파일 타일의 상태 줄과 장소 패널의 드라이브 막대가 묻는다
//! (docs/log/2026-10-07-file-tile-dolphin.md).
//!
//! ```text
//!  local_free_space(path)            OS 에 직접 묻기 (아래 `disk_space`)   → Some({free, total}) | None
//!  sftp_free_space(session, path)    statvfs@openssh.com 확장             → Some | None   (sftp_browser/browse.rs)
//! ```
//!
//! **모르면 `None` 이다 — 오류가 아니다.** 화면은 그 칸을 숨길 뿐이고, 남은 공간을 못 읽었다고 목록이 실패한 것처럼
//! 보이면 안 된다. 그래서 두 명령 모두 실패를 `Ok(None)` 으로 접는다(세션이 사라진 것만은 예외 — 원격 쪽 주석).
//!
//! ## OS 분기는 이 파일의 함수 **하나** 안에서만 갈린다
//!
//! [`crate::cwd`] 와 같은 규칙이다 — OS 를 타는 코드는 [`disk_space`] 한 함수에 모으고 `#[cfg(...)]` 로 몸통만
//! 가른다. 아직 구현하지 않은 OS 는 **명시적인 `None` 스텁**으로 남긴다(그 스텁이 곧 "여기가 비어 있다" 는 문서다).
//! 프런트는 이 분기를 전혀 모른다(`Option<DiskSpace>` 하나만 본다).

use std::path::Path;

use serde::Serialize;

/// 한 경로가 사는 볼륨의 크기 — 바이트. `free` 는 **이 사용자가 쓸 수 있는** 만큼이다(할당량·예약 블록을 뺀 값).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DiskSpace {
    pub free: u64,
    pub total: u64,
}

impl DiskSpace {
    /// 말이 되는 값만 — 전체가 0 이면(가상 파일 시스템 · 서버가 0 을 채워 보낸 statvfs) 모른다고 본다.
    pub(crate) fn sane(free: u64, total: u64) -> Option<DiskSpace> {
        (total > 0).then(|| DiskSpace {
            free: free.min(total),
            total,
        })
    }
}

/// 이 경로가 사는 볼륨의 남은 공간. 못 읽으면 `None`.
///
/// **OS 분기는 여기 한 곳뿐이다** (모듈 머리말 참고).
pub fn disk_space(path: &Path) -> Option<DiskSpace> {
    #[cfg(windows)]
    let found = windows_space(path);

    // 리눅스·macOS 스텁 — 답은 `statvfs(3)` 이다(`f_bavail × f_frsize` / `f_blocks × f_frsize`). `libc` 를 직접
    // 의존으로 올리면 몇 줄이지만 지금 빌드하는 OS 가 아니라 실기로 시험할 수 없으므로 **지어내지 않고 비워 둔다**
    // (`cwd.rs` 의 macOS 스텁과 같은 규칙 — 이 스텁이 그 사실의 기록이다). 화면은 칸을 숨긴다.
    #[cfg(not(windows))]
    let found = {
        let _ = path;
        None
    };

    found
}

/// 로컬 경로의 남은 공간 — 상태 줄 · 장소 패널의 드라이브 막대. 빈 경로(합성 루트 "내 PC")는 `None`.
///
/// 잠든 디스크·네트워크 드라이브는 수백 ms 를 먹으므로 블로킹 풀에서 묻는다 (docs/conventions.md 의 async 규칙).
#[tauri::command]
pub async fn local_free_space(path: String) -> Result<Option<DiskSpace>, String> {
    if path.trim().is_empty() {
        return Ok(None);
    }
    Ok(tokio::task::spawn_blocking(move || disk_space(Path::new(&path)))
        .await
        .unwrap_or(None))
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/// `SHGetDiskFreeSpaceExW` — 볼륨 안의 어느 경로를 줘도 그 볼륨의 값이 온다(드라이브 뿌리가 아니어도 된다).
/// `GetDiskFreeSpaceExW` 와 같은 값을 주는 셸 쪽 짝인데, 이미 켜 둔 `Win32_UI_Shell` 기능에 들어 있어 새 기능 게이트가
/// 필요 없다.
///
/// 미디어가 없는 이동식 드라이브(빈 카드 리더)를 건드리면 윈도우가 **"디스크를 넣으십시오" 하드 오류 창**을 띄울 수
/// 있다(`local_browser` 의 `GetLogicalDrives` 주석과 같은 사정). 장소 패널은 드라이브마다 이것을 부르므로 이 스레드만
/// 그 창을 끄고(`SEM_FAILCRITICALERRORS`) 부른 뒤 되돌린다 — 실패는 조용히 `None` 이다.
#[cfg(windows)]
fn windows_space(path: &Path) -> Option<DiskSpace> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS};
    use windows_sys::Win32::UI::Shell::SHGetDiskFreeSpaceExW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut avail: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    let mut old_mode = 0;
    // SAFETY: `wide` 는 NUL 로 끝나는 UTF-16 이고 이 호출 동안 산다. 나머지는 이 함수 지역 변수의 포인터다.
    let ok = unsafe {
        let switched = SetThreadErrorMode(SEM_FAILCRITICALERRORS, &mut old_mode) != 0;
        let ok = SHGetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, &mut total, &mut total_free) != 0;
        if switched {
            SetThreadErrorMode(old_mode, std::ptr::null_mut());
        }
        ok
    };
    if !ok {
        return None;
    }
    DiskSpace::sane(avail, total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sane_drops_zero_totals_and_clamps_free() {
        assert_eq!(DiskSpace::sane(5, 0), None);
        assert_eq!(DiskSpace::sane(5, 10), Some(DiskSpace { free: 5, total: 10 }));
        assert_eq!(DiskSpace::sane(50, 10), Some(DiskSpace { free: 10, total: 10 }));
    }

    #[cfg(windows)]
    #[test]
    fn windows_reads_the_temp_volume() {
        let space = disk_space(&std::env::temp_dir()).expect("임시 폴더의 볼륨은 읽혀야 한다");
        assert!(space.total > 0 && space.free <= space.total);
    }

    #[test]
    fn missing_path_is_none_not_a_panic() {
        // 없는 드라이브·경로 — 값이 없을 뿐 터지지 않는다
        let _ = disk_space(Path::new("Q:\\definitely\\not\\here"));
    }
}
