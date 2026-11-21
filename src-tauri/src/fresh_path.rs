//! 지금의 PATH — 프로세스의 PATH 는 켜질 때 물려받은 값에 머물러, 앱을 켜 둔 채 깐 CLI 를 못 찾는다.
//! 감지할 때만 OS 가 지금 들고 있는 PATH 를 다시 읽는다 — 앱 프로세스 자신의 환경은 바꾸지 않는다.

/// 기기 → 사용자 순서로 잇는다(탐색기가 새 프로세스에 주는 것과 같은 순서). 읽지 못하면 `None` — 호출자는 물려받은 PATH 를 쓴다.
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

    /// `REG_EXPAND_SZ` 는 `%USERPROFILE%` 같은 자리를 펼쳐서 돌려준다.
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
    #[cfg(windows)]
    #[test]
    fn reads_machine_path_with_system32() {
        let p = super::current().expect("레지스트리 PATH");
        assert!(p.to_string_lossy().to_ascii_lowercase().contains(r"\system32"), "{p:?}");
    }
}
