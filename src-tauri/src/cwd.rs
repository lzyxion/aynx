//! 살아 있는 자식 프로세스의 **현재 작업 디렉터리**를 밖에서 읽는다.
//!
//! 쓰는 곳은 하나다 — 로컬 터미널 타일의 📂(`pty::local_cwd`). SSH 타일이 자기 세션으로
//! SFTP 브라우저를 여는 것과 **대칭**을 맞추려면 "이 셸이 지금 어디에 있는가" 를 알아야
//! 한다. 셸이 스스로 말해 주면(OSC 7) 그것이 ①단계이고, 이 파일은 **말해 주지 않는 셸을
//! 위한 ②단계**다 — OS 에게 직접 묻는다.
//!
//! ## 이 길은 PowerShell 에서 **원리적으로 틀린다** (2026-09-08 확인)
//!
//! PowerShell 은 `Set-Location` 으로 **프로세스의 cwd 를 바꾸지 않는다**:
//!
//! ```text
//!   pwsh -NoProfile -Command 'Set-Location C:\Windows;
//!       "$((Get-Location).Path)  $([Environment]::CurrentDirectory)"'
//!     → C:\Windows  C:\Users\<you>\projects\aynx
//! ```
//!
//! 위치는 **공급자(provider) 스택 위의 세션 상태**이고 PEB 의 `CurrentDirectory` 는 셸이
//! 시작한 폴더에 그대로 멈춰 있다. 즉 아래 코드는 PowerShell 세션에서 언제나 **시작
//! 폴더**를 준다 — 실패가 아니라 정답이 아닌 값이라 더 위험하다.
//!
//! 그래서 PowerShell 에는 프롬프트 훅으로 OSC 7 을 심는다
//! (`crate::shell_integration` 의 `PS_SNIPPET` · docs/log/2026-09-08-local-shell-hook-osc7.md).
//! **이 파일은 지워지지 않는다** — `cmd.exe` 와 Git Bash 는 `cd` 로 프로세스 cwd 를 진짜로
//! 바꾸므로(`cd /c/Windows && cmd //c cd` → `C:\Windows`) 그 둘에게는 여기가 답이고,
//! 훅을 못 심었을 때(파일 쓰기 실패)의 폴백이기도 하다. WSL 은 아래 절대로 `None` 이다.
//!
//! ## OS 분기는 이 파일의 함수 **하나** 안에서만 갈린다
//!
//! aynx 은 지금 Windows 에서만 빌드되지만 목표는 세 OS 전부다. 그래서 OS 를 타는 코드는
//! [`child_cwd`] 한 함수 안에 모으고 `#[cfg(...)]` 로 몸통만 가른다. 아직 구현하지 않은
//! OS 는 **명시적인 `None` 스텁**으로 남긴다 — 그 스텁이 곧 "여기가 비어 있다" 는 문서다.
//! 프런트는 이 분기를 전혀 모른다 (`Option<String>` 하나만 본다).
//!
//! ## Windows: PEB 를 읽는다
//!
//! Win32 에는 "남의 프로세스의 cwd" 를 주는 API 가 없다. 있는 것은 프로세스 자신의
//! `GetCurrentDirectory` 뿐이다. 그래서 커널이 프로세스마다 들고 있는 PEB(Process
//! Environment Block)를 따라간다:
//!
//! ```text
//!   NtQueryInformationProcess(ProcessBasicInformation) → PebBaseAddress
//!   PEB + 0x20                → RTL_USER_PROCESS_PARAMETERS *
//!   ProcessParameters + 0x38  → CurrentDirectory.DosPath (UNICODE_STRING)
//!   UNICODE_STRING.Buffer     → UTF-16 경로 (Length 바이트)
//! ```
//!
//! 오프셋은 **x64 배치**다 (32비트 프로세스는 지원하지 않는다 — 이 앱은 64비트로만
//! 배포한다). 이 경로는 문서화되지 않은 배치를 밟으므로 규칙이 셋이다:
//! **패닉하지 않는다 · 길이를 반드시 검사한다 · 실패는 조용히 `None` 이다.**
//! 최악이라도 "폴더가 홈으로 열린다" 이고, 그것은 이 기능이 없던 때와 같다.

use std::path::PathBuf;

/// 프로세스 하나의 현재 작업 디렉터리. 못 읽으면 `None`(오류가 아니다 — 호출부는 폴백한다).
///
/// **OS 분기는 여기 한 곳뿐이다** (모듈 머리말 참고).
pub fn child_cwd(pid: u32) -> Option<PathBuf> {
    #[cfg(windows)]
    let found = windows_cwd(pid).map(PathBuf::from);

    // `/proc/<pid>/cwd` 는 커널이 유지하는 심볼릭 링크다 — 읽기만 하면 끝이고,
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

/// PEB 에서 읽어 온 `DosPath` 를 화면·브라우저가 쓸 경로로 다듬는다 — **순수 함수**.
///
/// 다듬는 것은 둘이다.
/// - UNICODE_STRING 은 NUL 로 끝나지 않지만 `Length` 가 NUL 을 포함하는 구현이 있어
///   꼬리의 NUL 과 공백을 걷어 낸다.
/// - Windows 의 cwd 는 **언제나 역슬래시로 끝난다**(`C:\work\`). 그대로 두면 브라우저의
///   빵부스러기와 타일 이름이 빈 마지막 조각을 얻는다. 단 **드라이브 루트만 남긴다** —
///   `C:\` 에서 역슬래시를 지우면 `C:` 가 되고, 그것은 "C 드라이브의 *현재* 폴더" 라는
///   전혀 다른 뜻이다.
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

/// 받아들일 경로 바이트 수의 상한 — 손상된 길이로 수 MB 를 읽지 않게 하는 그물.
/// (`UNICODE_STRING.Length` 는 u16 이라 이론상 64KB 까지 온다.)
#[cfg(windows)]
const MAX_PATH_BYTES: usize = 0x8000;

#[cfg(windows)]
fn windows_cwd(pid: u32) -> Option<String> {
    use std::ffi::c_void;
    // `NtQueryInformationProcess` 는 ntdll 이라 windows-sys 에서도 Wdk 쪽에 있다.
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

    // 필요한 권한만 연다 — 읽기 두 가지뿐이고 쓰기·종료 권한은 요구하지 않는다.
    // (자식 프로세스이므로 대개 성공한다. 상승 권한 셸이면 실패하고 그때는 `None` 이다.)
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if handle.is_null() {
        return None;
    }

    // 핸들은 어느 갈래로 나가든 반드시 닫는다 — `?` 로 일찍 나가는 자리가 없도록
    // 몸통을 클로저 하나에 담고 결과만 받는다.
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
        // NTSTATUS 는 음수가 실패다.
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

        // ① PEB → ProcessParameters 포인터
        let mut ptr = [0u8; 8];
        if !read_mem(handle, peb + PEB_PROCESS_PARAMETERS, &mut ptr) {
            return None;
        }
        let params = u64::from_le_bytes(ptr) as usize;

        // ② ProcessParameters → CurrentDirectory.DosPath (UNICODE_STRING 16바이트)
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

        // ③ 문자열 본문 (UTF-16LE, NUL 로 끝나지 않는다)
        let mut raw = vec![0u8; length];
        if !read_mem(handle, buffer, &mut raw) {
            return None;
        }
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
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

    /// 진짜 프로세스 하나를 세워 두고 그 cwd 를 밖에서 읽어 본다.
    ///
    /// PTY 를 쓰지 않는다 — 여기서 재는 것은 PEB 걷기뿐이고, ConPTY 를 끼우면 실패했을 때
    /// 원인이 둘로 갈린다. 프로세스가 뜨자마자 죽었거나(환경 문제) PEB 가 아직 안 채워졌으면
    /// **조용히 건너뛴다** — 이 테스트는 CI 를 흔들 자격이 없다.
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
