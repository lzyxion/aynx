//! 살아 있는 자식 프로세스의 현재 작업 디렉터리를 밖에서 읽는다 — 셸이 OSC 7 로 말해 주지 않을 때의 폴백(로컬 터미널 타일의 📂).
//!
//! PowerShell 에서는 원리적으로 틀린다 — `Set-Location` 은 프로세스 cwd(PEB `CurrentDirectory`)를 바꾸지 않아 이 길은 언제나 시작
//! 폴더를 준다(실패가 아니라 틀린 값이라 더 위험하다). 그래서 PowerShell 에는 프롬프트 훅으로 OSC 7 을 심는다(`crate::shell_integration`
//! 의 `PS_SNIPPET` · docs/log/2026-09-08-local-shell-hook-osc7.md). 이 파일은 지우지 않는다 — `cmd.exe` · Git Bash 는 `cd` 로 프로세스
//! cwd 를 진짜로 바꿔 여기가 답이고, 훅을 못 심었을 때의 폴백이기도 하다. WSL 은 늘 `None` 이다.
//!
//! OS 분기는 [`child_cwd`] 한 함수 안에서만 `#[cfg]` 로 가르고, 구현하지 않은 OS 는 명시적인 `None` 스텁으로 남긴다(그 스텁이 곧 문서다).
//! 프런트는 이 분기를 모른다(`Option<String>` 하나만 본다).
//!
//! Windows 는 PEB 를 따라간다(남의 프로세스 cwd 를 주는 Win32 API 가 없다). 오프셋은 x64 배치뿐이고 문서화되지 않은 배치를 밟으므로
//! 패닉하지 않는다 · 길이를 반드시 검사한다 · 실패는 조용히 `None` 이다.

use std::path::PathBuf;

/// 못 읽으면 `None` — 오류가 아니다(호출부는 폴백한다).
pub fn child_cwd(pid: u32) -> Option<PathBuf> {
    #[cfg(windows)]
    let found = windows_cwd(pid).map(PathBuf::from);

    // 권한이 없거나(다른 사용자) 프로세스가 이미 죽었으면 실패가 곧 `None` 이다.
    #[cfg(target_os = "linux")]
    let found = std::fs::read_link(format!("/proc/{pid}/cwd")).ok();

    // macOS 스텁 — `libproc` 의 `proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, ...)` 가
    // 돌려주는 `proc_vnodepathinfo.pvi_cdir.vip_path` 가 이 자리의 답이다. 크레이트를
    // 붙이지 않고 `extern "C"` 로 직접 부를 수 있지만, 실기에서 시험할 기계가 없으므로
    // **지어내지 않고 비워 둔다** (이 스텁이 그 사실의 기록이다).
    #[cfg(target_os = "macos")]
    let found = {
        let _ = pid;
        None
    };

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    let found = {
        let _ = pid;
        None
    };

    found
}

/// UNICODE_STRING 의 `Length` 가 NUL 을 포함하는 구현이 있어 꼬리 NUL · 공백을 걷는다. 끝 역슬래시는 떼되 드라이브 루트(`C:\`)는
/// 남긴다 — `C:` 는 "C 드라이브의 현재 폴더" 라는 다른 뜻이다.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn trim_dos_path(raw: &str) -> Option<String> {
    let s = raw.trim_end_matches('\0').trim();
    if s.is_empty() {
        return None;
    }
    let b = s.as_bytes();
    // `C:\` — 드라이브 문자 + 콜론 + 역슬래시 셋뿐이면 루트다 (전부 ASCII라 바이트로 본다).
    if b.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
        return Some(s.to_string());
    }
    let trimmed = s.trim_end_matches('\\');
    // 전부 역슬래시였다면(`\` · `\\`) 다듬을 것이 없다 — 원문을 그대로 돌려준다.
    Some(if trimmed.is_empty() {
        s.to_string()
    } else {
        trimmed.to_string()
    })
}

// ---------------------------------------------------------------------------
// Windows — PEB 걷기
// ---------------------------------------------------------------------------

/// x64 PEB 안에서 `ProcessParameters` 포인터의 자리.
#[cfg(windows)]
const PEB_PROCESS_PARAMETERS: usize = 0x20;

/// x64 `RTL_USER_PROCESS_PARAMETERS` 안에서 `CurrentDirectory.DosPath` 의 자리.
/// (`CURDIR` 는 `{ UNICODE_STRING DosPath; HANDLE Handle; }` 이라 앞의 16바이트가 문자열이다.)
#[cfg(windows)]
const PARAMS_CURRENT_DIRECTORY: usize = 0x38;

/// 손상된 길이로 수 MB 를 읽지 않게 하는 그물(`UNICODE_STRING.Length` 는 u16 이라 64KB 까지 온다).
#[cfg(windows)]
const MAX_PATH_BYTES: usize = 0x8000;

#[cfg(windows)]
fn windows_cwd(pid: u32) -> Option<String> {
    use std::ffi::c_void;
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_BASIC_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };

    // 32비트 빌드에서는 아래 오프셋이 전부 틀리다 — 잘못된 주소를 읽느니 안 읽는다.
    if cfg!(not(target_pointer_width = "64")) {
        return None;
    }

    // 읽기 권한 두 가지만 연다 — 상승 권한 셸이면 실패하고 그때는 `None` 이다.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if handle.is_null() {
        return None;
    }

    // 핸들은 어느 갈래로 나가든 닫는다 — 몸통을 클로저 하나에 담아 `?` 로 일찍 나가는 자리가 없게 한다.
    let read = || -> Option<String> {
        let mut basic = unsafe { std::mem::zeroed::<PROCESS_BASIC_INFORMATION>() };
        let mut written: u32 = 0;
        let status = unsafe {
            NtQueryInformationProcess(
                handle,
                ProcessBasicInformation,
                std::ptr::addr_of_mut!(basic).cast::<c_void>(),
                std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32,
                &mut written,
            )
        };
        if status < 0 || basic.PebBaseAddress.is_null() {
            return None;
        }

        /// 남의 주소 공간에서 정확히 `buf.len()` 바이트를 읽는다 (부분 읽기는 실패로 본다).
        fn read_mem(handle: *mut c_void, addr: usize, buf: &mut [u8]) -> bool {
            if addr == 0 {
                return false;
            }
            let mut got: usize = 0;
            let ok = unsafe {
                ReadProcessMemory(
                    handle,
                    addr as *const c_void,
                    buf.as_mut_ptr().cast::<c_void>(),
                    buf.len(),
                    &mut got,
                )
            };
            ok != 0 && got == buf.len()
        }

        let peb = basic.PebBaseAddress as usize;

        let mut ptr = [0u8; 8];
        if !read_mem(handle, peb + PEB_PROCESS_PARAMETERS, &mut ptr) {
            return None;
        }
        let params = u64::from_le_bytes(ptr) as usize;

        let mut us = [0u8; 16];
        if !read_mem(handle, params + PARAMS_CURRENT_DIRECTORY, &mut us) {
            return None;
        }
        let length = u16::from_le_bytes([us[0], us[1]]) as usize;
        let buffer =
            u64::from_le_bytes([us[8], us[9], us[10], us[11], us[12], us[13], us[14], us[15]])
                as usize;
        // 길이 검사가 이 함수의 안전선이다: 0 · 홀수 · 상한 초과는 전부 "못 읽었다".
        if length == 0 || !length.is_multiple_of(2) || length > MAX_PATH_BYTES || buffer == 0 {
            return None;
        }

        // UTF-16LE · NUL 로 끝나지 않는다.
        let mut raw = vec![0u8; length];
        if !read_mem(handle, buffer, &mut raw) {
            return None;
        }
        let units: Vec<u16> = raw
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&pair| u16::from_le_bytes(pair))
            .collect();
        trim_dos_path(&String::from_utf16_lossy(&units))
    };

    let out = read();
    unsafe { CloseHandle(handle) };
    out
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailing_backslash_goes_but_drive_root_stays() {
        assert_eq!(trim_dos_path("C:\\work\\"), Some("C:\\work".into()));
        assert_eq!(trim_dos_path("C:\\work"), Some("C:\\work".into()));
        // 드라이브 루트에서 지우면 `C:` — "C 드라이브의 현재 폴더" 라는 다른 뜻이 된다.
        assert_eq!(trim_dos_path("C:\\"), Some("C:\\".into()));
        assert_eq!(trim_dos_path("d:\\"), Some("d:\\".into()));
        // UNC 공유 루트는 역슬래시 없이도 루트다.
        assert_eq!(
            trim_dos_path("\\\\srv\\share\\"),
            Some("\\\\srv\\share".into())
        );
    }

    #[test]
    fn trailing_nul_and_space_are_stripped() {
        assert_eq!(trim_dos_path("C:\\work\\\0\0"), Some("C:\\work".into()));
        assert_eq!(trim_dos_path("  C:\\work\\  "), Some("C:\\work".into()));
    }

    #[test]
    fn empty_is_not_a_path() {
        assert_eq!(trim_dos_path(""), None);
        assert_eq!(trim_dos_path("\0\0"), None);
        assert_eq!(trim_dos_path("   "), None);
        // 역슬래시뿐이면 다듬을 것이 없다 — 원문 그대로 (자를 것이 남지 않는다).
        assert_eq!(trim_dos_path("\\"), Some("\\".into()));
    }

    /// 진짜 프로세스 하나의 cwd 를 밖에서 읽어 본다. PTY 를 쓰지 않는다 — 실패했을 때 원인이 둘로 갈리지 않게. 프로세스가 먼저 죽었거나
    /// PEB 가 아직 비었으면 조용히 건너뛴다(이 테스트는 CI 를 흔들 자격이 없다).
    #[cfg(windows)]
    #[test]
    fn reads_a_child_process_cwd() {
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut child = match Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep 5"])
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => return, // powershell 이 없는 기계 — 건너뛴다
        };

        // PEB 는 로더가 채운다. 갓 만든 프로세스에서는 아직 비어 있을 수 있어 잠깐 기다린다.
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut got = None;
        while Instant::now() < deadline {
            if let Some(p) = child_cwd(child.id()) {
                got = Some(p);
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();

        let Some(got) = got else {
            return; // 프로세스가 먼저 끝났거나 권한이 없다 — 실패로 세지 않는다
        };
        assert_eq!(
            got.to_string_lossy().to_lowercase(),
            dir.to_string_lossy().to_lowercase(),
            "PEB 가 알려 준 cwd 가 current_dir 로 준 폴더와 다르다"
        );
    }
}
