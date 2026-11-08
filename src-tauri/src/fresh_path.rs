//! **지금의 PATH**(2026-11-03 첫 설치 점검) — 앱이 뜬 뒤 깐 프로그램을 찾을 때.
//!
//! 프로세스의 PATH 는 켜질 때 물려받은 값에 머문다. 앱을 켜 둔 채 Claude Code · Codex 를 깔면 설치 프로그램은
//! 사용자 · 기기 환경 변수(레지스트리)의 PATH 만 바꾸므로, 앱의 `claude --version` 감지가 다시 켤 때까지
//! "찾을 수 없음" 이었다. 감지할 때만 OS 가 지금 들고 있는 PATH 를 다시 읽는다 — 앱 프로세스 자신의 환경은 바꾸지 않는다.
//!
//! OS 를 타는 것은 [`current`] 하나 — Windows 는 기기(`HKLM\…\Session Manager\Environment`) + 사용자(`HKCU\Environment`)
//! 의 `Path` 를 그 순서로 잇는다(탐색기가 새 프로세스에 주는 것과 같은 순서). 다른 OS 는 아직 `None` — 물려받은 PATH 그대로다.

/// 지금 OS 가 새 프로세스에 줄 PATH — 읽지 못하면 `None`(호출자는 물려받은 PATH 를 그대로 쓴다).
#[cfg(windows)]
pub(crate) fn current() -> Option<std::ffi::OsString> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    const MACHINE: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
    const USER: &str = "Environment";
    let parts: Vec<String> = [reg::string(HKEY_LOCAL_MACHINE, MACHINE, "Path"), reg::string(HKEY_CURRENT_USER, USER, "Path")]
        .into_iter()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .collect();
    (!parts.is_empty()).then(|| parts.join(";").into())
}

/// 아직 구현하지 않은 OS — 물려받은 PATH 를 그대로 쓴다.
#[cfg(not(windows))]
pub(crate) fn current() -> Option<std::ffi::OsString> {
    None
}

#[cfg(windows)]
mod reg {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 문자열 값 하나 — `REG_EXPAND_SZ` 는 `%USERPROFILE%` 같은 자리를 펼쳐서 돌려준다. 길이를 먼저 묻고 그만큼 받는다.
    pub(super) fn string(root: HKEY, key: &str, name: &str) -> Option<String> {
        let (key, name) = (wide(key), wide(name));
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        let mut bytes: u32 = 0;
        // SAFETY: 키 · 값 이름은 NUL 로 끝나는 UTF-16 — 버퍼 없이 크기만 묻는다.
        let rc = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes) };
        if rc != 0 || bytes == 0 {
            return None;
        }
        // 펼친 뒤 길이가 늘 수 있다 — 넉넉히(두 배) 잡는다.
        let mut buf = vec![0u16; (bytes as usize).div_ceil(2) * 2 + 1];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: `buf` 는 `size` 바이트 크기의 쓰기 가능한 버퍼다.
        let rc = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        if rc != 0 {
            return None;
        }
        let units = (size as usize / 2).min(buf.len());
        let end = buf[..units].iter().position(|&c| c == 0).unwrap_or(units);
        Some(String::from_utf16_lossy(&buf[..end]))
    }
}

#[cfg(test)]
mod tests {
    /// 이 PC 의 PATH 를 읽는다 — Windows 면 기기 PATH 에 늘 System32 가 있다.
    #[cfg(windows)]
    #[test]
    fn reads_machine_path_with_system32() {
        let p = super::current().expect("레지스트리 PATH");
        assert!(p.to_string_lossy().to_ascii_lowercase().contains(r"\system32"), "{p:?}");
    }
}
