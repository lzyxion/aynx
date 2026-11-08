//! 전송 — Windows 명명 파이프(사용자 SID 전용 DACL · `FIRST_PIPE_INSTANCE` 선점 · 원격 거부 · 바이트 스트림) 와
//! **상대 프로세스 확인**. 유닉스(`$XDG_RUNTIME_DIR/aynx[-dev]/server.sock` 0700 + `flock`)는 명시적 스텁이다.
//!
//! - 이름 `\\.\pipe\aynx[-dev]-<FNV64(사용자 SID)>` — 인스턴스(dev/release) 접미사는 `instance::app_dir_name` 하나를 따른다.
//! - **선점이 인스턴스 잠금의 실체**다: 첫 인스턴스는 `FIRST_PIPE_INSTANCE` 로 만들고, 이미 있으면 err 5 → [`BindError::Taken`].
//!   `server.json` 은 안내일 뿐이다(설계 4.1).
//! - **양방향 확인**(설계 4.6 · 스파이크 4): 같은 사용자는 FIRST 깃발 없이 같은 이름에 인스턴스를 **덧붙일 수 있다** — 그래서
//!   서버는 클라이언트의 exe 를, 클라이언트(GUI)는 서버의 exe 를 `QueryFullProcessImageNameW` 로 확인한다([`peer_image`]).
//!   비교 규칙(무엇을 같은 exe 로 치나)은 부르는 쪽(`server::serve` · `server::client`)이 정한다 — 여기는 pid·경로만 준다.

use tokio::io::{AsyncRead, AsyncWrite};

/// 파이프·소켓 위의 바이트 스트림 하나(서버·클라이언트 공용 상자).
pub(crate) trait Stream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> Stream for T {}
pub(crate) type BoxStream = Box<dyn Stream>;

/// 상대 프로세스 — pid 와 그 이미지 경로(못 읽으면 `None` = 거부 대상).
#[derive(Debug, Clone, Default)]
pub(crate) struct Peer {
    pub pid: Option<u32>,
    pub image: Option<String>,
}

/// 이 사용자·이 인스턴스의 서버 주소. 아직 구현하지 않은 OS 는 `None`.
pub(crate) fn endpoint() -> Option<String> {
    #[cfg(windows)]
    {
        let sid = win::user_sid_string().ok()?;
        Some(pipe_name(crate::instance::app_dir_name(crate::instance::DEV), &sid))
    }
    #[cfg(not(windows))]
    {
        // 유닉스: `$XDG_RUNTIME_DIR/aynx[-dev]/server.sock`(없으면 `instance::data_root()` 아래), 디렉터리 0700 ·
        // 소유 uid 확인 · 같은 폴더 `server.lock` 에 `flock(LOCK_EX|LOCK_NB)` 을 쥔 뒤에만 낡은 소켓을 지우고 bind —
        // 스파이크 `unix_sketch::socket_path`. ③ 의 유닉스 조각에서.
        None
    }
}

/// FNV-1a 64 — 이름이 SID 를 그대로 드러내지 않게(결정적, 비밀 아님).
pub(crate) fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// `\\.\pipe\<prefix>-<FNV64(sid) 16자리>`.
pub(crate) fn pipe_name(prefix: &str, sid: &str) -> String {
    format!(r"\\.\pipe\{prefix}-{:016x}", fnv1a64(sid))
}

/// 현재 사용자 SID 하나만 `GENERIC_ALL` 을 받는 보호(상속 끊긴) DACL, 소유자도 그 SID.
pub(crate) fn sddl_for(sid: &str) -> String {
    format!("O:{sid}D:P(A;;GA;;;{sid})")
}

#[derive(Debug)]
pub(crate) enum BindError {
    /// 같은 이름의 첫 인스턴스가 이미 있다(err 5) — 다른 서버가 돈다.
    Taken,
    Other(String),
}

/// 서버 쪽 듣기 — 첫 인스턴스는 선점으로 만들고, 붙을 때마다 다음 인스턴스를 미리 세운다.
pub(crate) struct Listener {
    #[cfg(windows)]
    name: String,
    #[cfg(windows)]
    sid: String,
    #[cfg(windows)]
    next: tokio::net::windows::named_pipe::NamedPipeServer,
}

impl Listener {
    /// `name` 을 선점한다. 이미 있으면 [`BindError::Taken`].
    pub(crate) fn bind(name: &str) -> Result<Listener, BindError> {
        #[cfg(windows)]
        {
            let sid = win::user_sid_string().map_err(|e| BindError::Other(format!("sid: os error {e}")))?;
            let next = win::create_instance(name, &sid, true).map_err(|e| {
                if e.raw_os_error() == Some(5) {
                    BindError::Taken
                } else {
                    BindError::Other(e.to_string())
                }
            })?;
            Ok(Listener {
                name: name.to_string(),
                sid,
                next,
            })
        }
        #[cfg(not(windows))]
        {
            let _ = name;
            Err(BindError::Other("session server transport: not implemented on this OS".into()))
        }
    }

    /// 다음 클라이언트를 기다린다 — 상대 정보와 함께.
    pub(crate) async fn accept(&mut self) -> std::io::Result<(BoxStream, Peer)> {
        #[cfg(windows)]
        {
            self.next.connect().await?;
            let fresh = win::create_instance(&self.name, &self.sid, false)?;
            let conn = std::mem::replace(&mut self.next, fresh);
            let peer = peer_image(&conn, true);
            Ok((Box::new(conn), peer))
        }
        #[cfg(not(windows))]
        {
            Err(std::io::Error::other("not implemented on this OS"))
        }
    }
}

/// 클라이언트 쪽 — 이름에 붙는다(바쁘면 잠깐 기다린다). 서버 상대 정보와 함께. 서버가 없으면 `NotFound`.
pub(crate) async fn connect(name: &str) -> std::io::Result<(BoxStream, Peer)> {
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;
        const ERROR_PIPE_BUSY: i32 = 231;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let client = loop {
            match ClientOptions::new().open(name) {
                Ok(c) => break c,
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && std::time::Instant::now() < deadline => {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Err(e) => return Err(e),
            }
        };
        let peer = peer_image(&client, false);
        Ok((Box::new(client), peer))
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err(std::io::Error::other("not implemented on this OS"))
    }
}

/// 열린 파이프 손잡이의 **상대** pid·exe — 서버 쪽이면 클라이언트를, 클라이언트 쪽이면 서버를 본다.
/// 유닉스: `SO_PEERCRED`→`/proc/<pid>/exe`(Linux) · `LOCAL_PEERPID`→`proc_pidpath`(macOS) — 스텁.
#[cfg(windows)]
pub(crate) fn peer_image(conn: &impl std::os::windows::io::AsRawHandle, server_side: bool) -> Peer {
    win::peer_image(conn.as_raw_handle(), server_side)
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub(crate) fn peer_image<T>(conn: &T, server_side: bool) -> Peer {
    let _ = (conn, server_side);
    Peer::default()
}

#[cfg(windows)]
mod win {
    use super::Peer;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::RawHandle;
    use std::ptr::null_mut;
    use tokio::net::windows::named_pipe::{NamedPipeServer, PipeMode, ServerOptions};
    use windows_sys::core::PWSTR;
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Security::Authorization::*;
    use windows_sys::Win32::Security::*;
    use windows_sys::Win32::System::Pipes::*;
    use windows_sys::Win32::System::Threading::*;

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    fn from_wide_ptr(p: *const u16) -> String {
        unsafe {
            let mut n = 0;
            while *p.add(n) != 0 {
                n += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
        }
    }

    /// 현재 프로세스 토큰의 사용자 SID 문자열(S-1-5-21-…).
    pub(super) fn user_sid_string() -> Result<String, u32> {
        unsafe {
            let mut tok: HANDLE = null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut tok) == 0 {
                return Err(GetLastError());
            }
            let mut len = 0u32;
            GetTokenInformation(tok, TokenUser, null_mut(), 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            if GetTokenInformation(tok, TokenUser, buf.as_mut_ptr() as *mut c_void, len, &mut len) == 0 {
                let e = GetLastError();
                CloseHandle(tok);
                return Err(e);
            }
            CloseHandle(tok);
            let tu = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut s: PWSTR = null_mut();
            if ConvertSidToStringSidW(tu.User.Sid, &mut s) == 0 {
                return Err(GetLastError());
            }
            let out = from_wide_ptr(s);
            LocalFree(s as *mut c_void);
            Ok(out)
        }
    }

    /// 사용자 SID 전용 DACL 을 단 파이프 인스턴스 하나. `first` 면 선점(`FIRST_PIPE_INSTANCE`).
    pub(super) fn create_instance(name: &str, sid: &str, first: bool) -> std::io::Result<NamedPipeServer> {
        unsafe {
            let mut psd: PSECURITY_DESCRIPTOR = null_mut();
            let sddl = wide(&super::sddl_for(sid));
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut psd, null_mut())
                == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            let mut sa = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: psd,
                bInheritHandle: 0,
            };
            let r = ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .pipe_mode(PipeMode::Byte)
                .create_with_security_attributes_raw(name, &mut sa as *mut _ as *mut c_void);
            LocalFree(psd);
            r
        }
    }

    pub(super) fn peer_image(h: RawHandle, server_side: bool) -> Peer {
        let mut pid = 0u32;
        let ok = unsafe {
            if server_side {
                GetNamedPipeClientProcessId(h as HANDLE, &mut pid)
            } else {
                GetNamedPipeServerProcessId(h as HANDLE, &mut pid)
            }
        };
        if ok == 0 {
            return Peer::default();
        }
        Peer {
            pid: Some(pid),
            image: crate::server::os::image_path(pid),
        }
    }
}
