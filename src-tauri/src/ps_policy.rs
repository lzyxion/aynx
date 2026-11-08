//! **Windows PowerShell 5.1 실행 정책** — 로컬 셸 통합 스크립트(`integration.ps1`)를 점 소싱할 수 있는가.
//!
//! Windows 클라이언트의 5.1 기본 정책은 `Restricted`(정의 없음 = Restricted)라, 깨끗한 PC 에서는 `-Command . '<…>.ps1'`
//! 이 막혀 타일마다 빨간 오류가 뜨고 **감싸개(`claude` · `codex` 함수)가 서지 않는다** — 그런데 [`crate::agent_tile::has_wrapper`] 는
//! 스크립트 파일이 쓰였는지만 보므로 AI 타일의 장식(MCP · 권한 훅 · 추가 인자)이 조용히 빠졌다(2026-11-03 첫 설치 점검).
//!
//! 그래서 **유효 정책이 Restricted 일 때만** 그 타일 프로세스에 `-ExecutionPolicy RemoteSigned` 를 준다(사용자 결정 2026-11-03 —
//! 늘 `Bypass` 는 아니다). 프로세스 범위라 그 타일(과 그 안에서 뜬 자식 PowerShell)에만 걸리고, 로컬 스크립트만 풀며, `AllSigned`
//! 같은 더 엄격한 사용자 선택은 낮추지 않는다. **그룹 정책이 정했으면 손대지 않는다**(명령줄 인자가 이기지 못한다 — 회사 PC 의 결정).
//!
//! 판정은 [`needs_relax`] 하나(순수)이고 OS 를 읽는 것은 [`windows_powershell_needs_relax`] 하나다. PowerShell 7(`pwsh`)은 대상이 아니다 —
//! Windows 기본이 `RemoteSigned` 이고 정책이 레지스트리가 아니라 `powershell.config.json` 에 산다.

/// 정책이 놓일 수 있는 자리들 — PowerShell 이 보는 차례(그룹 정책 → Process → CurrentUser → LocalMachine).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Scopes {
    /// 그룹 정책(MachinePolicy · UserPolicy)이 정한 값 — 하나라도 있으면 `Some`(`EnableScripts = 0` 은 `"Restricted"`).
    pub group_policy: Option<String>,
    /// `PSExecutionPolicyPreference` 환경변수(Process 범위).
    pub process: Option<String>,
    /// `HKCU\…\ShellIds\Microsoft.PowerShell` 의 `ExecutionPolicy`.
    pub current_user: Option<String>,
    /// `HKLM\…\ShellIds\Microsoft.PowerShell` 의 `ExecutionPolicy`.
    pub local_machine: Option<String>,
}

/// 이 정책 자리들에서 **`-ExecutionPolicy RemoteSigned` 를 줄 것인가** — **순수 함수**.
///
/// 그룹 정책이 있으면 `false`(우리가 바꿀 수 없고 바꾸지도 않는다). 아니면 Process → CurrentUser → LocalMachine 에서 처음 정의된
/// 값(빈 값 · `Undefined` 는 정의 없음)이 유효 정책이고, 정의가 없으면 클라이언트 기본 `Restricted` 다. 유효 정책이 `Restricted` 일 때만 `true`.
pub(crate) fn needs_relax(s: &Scopes) -> bool {
    if s.group_policy.is_some() {
        return false;
    }
    let effective = [&s.process, &s.current_user, &s.local_machine]
        .into_iter()
        .flatten()
        .map(|v| v.trim())
        .find(|v| !v.is_empty() && !v.eq_ignore_ascii_case("Undefined"));
    match effective {
        None => true,
        Some(v) => v.eq_ignore_ascii_case("Restricted"),
    }
}

/// 이 PC 의 Windows PowerShell 5.1 에 [`needs_relax`] 인가 — 레지스트리 · 환경을 읽는다(값싸다 — 셸 하나 띄울 때 한 번).
#[cfg(windows)]
pub(crate) fn windows_powershell_needs_relax() -> bool {
    needs_relax(&reg::read_scopes())
}

/// Windows PowerShell 5.1 은 Windows 에만 있다 — 다른 OS 에는 고칠 것이 없다.
#[cfg(not(windows))]
pub(crate) fn windows_powershell_needs_relax() -> bool {
    false
}

#[cfg(windows)]
mod reg {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    use super::Scopes;

    /// 그룹 정책 키(HKLM = MachinePolicy · HKCU = UserPolicy).
    const POLICY_KEY: &str = r"SOFTWARE\Policies\Microsoft\Windows\PowerShell";
    /// 사용자 · 기기 범위 키(5.1 의 `Microsoft.PowerShell` 셸).
    const SHELL_KEY: &str = r"SOFTWARE\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell";

    pub(super) fn read_scopes() -> Scopes {
        let group_policy = [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER].into_iter().find_map(group_policy_of);
        Scopes {
            group_policy,
            process: std::env::var("PSExecutionPolicyPreference").ok(),
            current_user: string(HKEY_CURRENT_USER, SHELL_KEY, "ExecutionPolicy"),
            local_machine: string(HKEY_LOCAL_MACHINE, SHELL_KEY, "ExecutionPolicy"),
        }
    }

    /// 그룹 정책 한 자리 — `EnableScripts` 가 있으면 그것이 정한다(0 = Restricted, 1 = `ExecutionPolicy` 값).
    fn group_policy_of(root: HKEY) -> Option<String> {
        match dword(root, POLICY_KEY, "EnableScripts")? {
            0 => Some("Restricted".into()),
            _ => Some(string(root, POLICY_KEY, "ExecutionPolicy").unwrap_or_default()),
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn string(root: HKEY, key: &str, name: &str) -> Option<String> {
        let (key, name) = (wide(key), wide(name));
        // 정책 이름은 짧다(`RemoteSigned` …) — 넘치면(`ERROR_MORE_DATA`) 값이 없는 것으로 본다.
        let mut buf = [0u16; 64];
        let mut bytes = std::mem::size_of_val(&buf) as u32;
        // SAFETY: 키 · 값 이름은 NUL 로 끝나는 UTF-16, `buf` 는 `bytes` 바이트 크기의 쓰기 가능한 버퍼다.
        let rc = unsafe {
            RegGetValueW(
                root,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if rc != 0 {
            return None;
        }
        let units = (bytes as usize / 2).min(buf.len());
        let end = buf[..units].iter().position(|&c| c == 0).unwrap_or(units);
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    fn dword(root: HKEY, key: &str, name: &str) -> Option<u32> {
        let (key, name) = (wide(key), wide(name));
        let mut value: u32 = 0;
        let mut bytes = std::mem::size_of::<u32>() as u32;
        // SAFETY: 키 · 값 이름은 NUL 로 끝나는 UTF-16, `value` 는 4바이트 쓰기 가능한 자리다.
        let rc = unsafe {
            RegGetValueW(
                root,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut value as *mut u32).cast(),
                &mut bytes,
            )
        };
        (rc == 0).then_some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(gp: Option<&str>, process: Option<&str>, user: Option<&str>, machine: Option<&str>) -> Scopes {
        Scopes {
            group_policy: gp.map(Into::into),
            process: process.map(Into::into),
            current_user: user.map(Into::into),
            local_machine: machine.map(Into::into),
        }
    }

    #[test]
    fn clean_client_defaults_to_restricted() {
        // 깨끗한 Windows 11 — 아무 자리에도 정의가 없다.
        assert!(needs_relax(&Scopes::default()));
        assert!(needs_relax(&s(None, Some(""), Some("Undefined"), None)));
    }

    #[test]
    fn explicit_restricted_is_relaxed() {
        assert!(needs_relax(&s(None, None, None, Some("Restricted"))));
        assert!(needs_relax(&s(None, None, Some("restricted"), Some("RemoteSigned"))));
    }

    #[test]
    fn looser_or_stricter_choices_are_left_alone() {
        for v in ["RemoteSigned", "Unrestricted", "Bypass", "AllSigned"] {
            assert!(!needs_relax(&s(None, None, Some(v), None)), "{v}");
            assert!(!needs_relax(&s(None, None, None, Some(v))), "{v}");
            assert!(!needs_relax(&s(None, Some(v), Some("Restricted"), None)), "{v}");
        }
    }

    #[test]
    fn group_policy_is_never_overridden() {
        // 회사 PC 의 결정 — Restricted 여도 명령줄 인자로 이기려 하지 않는다.
        assert!(!needs_relax(&s(Some("Restricted"), None, None, None)));
        assert!(!needs_relax(&s(Some("AllSigned"), None, None, None)));
        assert!(!needs_relax(&s(Some(""), None, None, None)));
    }
}
