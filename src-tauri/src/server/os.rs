//! 세션 서버의 OS 원시. 공개 함수마다 **몸통만** `#[cfg]` 로 가르고, 아직 구현하지 않은 OS 는 명시적 `None`/`Err` 스텁이다(스텁이 곧 문서).
//!
//! - exe 비교는 **`QueryFullProcessImageNameW` 끼리**([`image_path`] · [`same_exe`]) — `current_exe()` 는 정션을 실체로
//!   풀어 같은 파일을 다른 글자로 보일 수 있다.
//! - 자기 잡 `KILL_ON_JOB_CLOSE` 는 서버가 죽는 순간 잡 안 자식을 모두 끝낸다. 단 Store(MSIX) pwsh 는 잡에
//!   들지 않는다 — 그래서 정상 종료 경로는 [`terminate_descendants`] 도 거친다(크래시는 고아 가능 — 알고 받은 한계).

use std::path::Path;

/// `server.json`·hello·상태에 글자 그대로 실린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnMode {
    /// `CREATE_BREAKAWAY_FROM_JOB` — 부모 잡이 `BREAKAWAY_OK` 를 줄 때(바로 가기·Windows Terminal 아래) 또는 잡이 없을 때.
    Breakaway,
    /// 부모를 explorer 로 지정(`PROC_THREAD_ATTRIBUTE_PARENT_PROCESS`) — breakaway 가 err 5 일 때(`tauri dev` 의 cargo 잡).
    Explorer,
    /// 둘 다 실패 — GUI 와 같은 잡에서 돈다. **GUI 를 닫으면 서버(와 세션)도 닫힌다** — 상태로 밝힌다.
    SameJob,
}

impl SpawnMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SpawnMode::Breakaway => "breakaway",
            SpawnMode::Explorer => "explorer",
            SpawnMode::SameJob => "same-job",
        }
    }
}

pub(crate) fn image_path(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        win::image_path(pid)
    }
    #[cfg(not(windows))]
    {
        // 유닉스: `/proc/<pid>/exe` readlink(Linux) · `proc_pidpath`(macOS) — ③ 의 유닉스 조각에서.
        let _ = pid;
        None
    }
}

/// [`image_path`] 와 같은 API 로 — 비교의 양쪽 글자를 맞춘다.
pub(crate) fn own_image() -> Option<String> {
    image_path(std::process::id())
}

fn norm_path(s: &str) -> String {
    s.trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase()
}

/// `\\?\` 접두와 대소문자를 무시한다(Windows 경로 규칙).
pub(crate) fn same_exe(a: &str, b: &str) -> bool {
    norm_path(a) == norm_path(b)
}

pub(crate) fn exe_under(path: &str, dir: &Path) -> bool {
    let d = norm_path(&dir.to_string_lossy());
    let d = d.trim_end_matches('\\');
    !d.is_empty() && norm_path(path).starts_with(&format!("{d}\\"))
}

pub(crate) fn pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        win::pid_alive(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        false
    }
}

/// pid 의 **전용 작업 집합**(바이트) — 작업 관리자 "메모리" 칸과 같은 기준. OS 가 이 값을 주지 않으면(Windows 10 21H2 전)
/// `None` — 부르는 쪽이 작업 집합 그대로 둔다. 유닉스는 RSS 그대로라 스텁(`/proc/<pid>/smaps_rollup` 의 Private_* 가 자리).
pub(crate) fn private_memory(pid: u32) -> Option<u64> {
    #[cfg(windows)]
    {
        win::private_memory(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

/// 반환값은 프로세스 끝까지 쥐는 손잡이다. 유닉스는 `PR_SET_CHILD_SUBREAPER`+`PDEATHSIG` 자리 — 스텁.
pub(crate) fn create_kill_on_close_job() -> Result<OwnJob, String> {
    #[cfg(windows)]
    {
        win::create_kill_on_close_job()
            .map(|h| OwnJob(h as usize))
            .map_err(|e| format!("job: os error {e}"))
    }
    #[cfg(not(windows))]
    {
        Err("own job: not implemented on this OS".into())
    }
}

/// 자기 잡 손잡이 — 일부러 닫지 않는다(프로세스가 끝날 때 OS 가 닫는다 — 그 순간이 곧 잡 안 자식의 끝).
#[derive(Debug)]
pub(crate) struct OwnJob(#[allow(dead_code)] usize);

/// 정상 종료 경로 — Store pwsh 처럼 잡에 안 드는 손자를 이것이 거둔다.
pub(crate) fn terminate_descendants() -> usize {
    #[cfg(windows)]
    {
        win::terminate_descendants(std::process::id())
    }
    #[cfg(not(windows))]
    {
        // 유닉스: 세션별 pgid 에 killpg — ③ 의 유닉스 조각에서.
        0
    }
}


/// 서버 진입에서 가장 먼저 — 물려받은 "Ctrl+C 무시" 속성을 걷는다. 이 속성은 PEB 의 프로세스 속성이라 **콘솔이 없는 서버라도
/// 자식에게 상속**된다 — 걷지 않으면 ConPTY 셸이 키보드 Ctrl+C 로 안 끊긴다(개발 앱의 node→cargo 사슬이 이미 무시 상태). 서버 자신은
/// 콘솔이 없어 걷어도 안전하다(docs/log/2026-10-10-ctrl-c-inherit.md).
pub(crate) fn enable_ctrl_c_for_children() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
    }
    // 유닉스: 해당 없음 — SIGINT 는 세션의 전경 프로세스 그룹에 pty 가 직접 보낸다(서버의 무시 상태는 `setsid` 자식에 영향 없음).
}

/// GUI 쪽 — 서버를 **분리 실행**한다. `args_for(mode)` 는 방식마다의 인자(서버가 제 `launch_mode` 를 알도록)를 만든다.
pub(crate) fn spawn_server_detached(
    exe: &str,
    args_for: &dyn Fn(SpawnMode) -> Vec<String>,
) -> Result<(SpawnMode, u32), String> {
    #[cfg(windows)]
    {
        win::spawn_server_detached(exe, args_for)
    }
    #[cfg(not(windows))]
    {
        // 유닉스: `Command::pre_exec(|| setsid())` + stdio /dev/null — 스파이크 `unix_sketch::spawn_server_detached`.
        let _ = (exe, args_for);
        Err("session server: not implemented on this OS".into())
    }
}

/// **잡에 생성과 동시에 든 프로세스**. 손잡이를 닫으면(`Drop`) 잡 안에 남은 것이 모두 끝난다(`KILL_ON_JOB_CLOSE`).
pub(crate) struct JobProc {
    #[cfg_attr(not(windows), allow(dead_code))]
    job: usize,
    #[cfg_attr(not(windows), allow(dead_code))]
    process: usize,
    /// 잔존 판정 · 로그용 — 트리 판정은 잡이 한다.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub pid: u32,
    /// 자식 쪽 끝은 생성 직후 닫았다 — 잡이 비면 EOF 가 선다.
    pub stdout: Option<std::fs::File>,
    pub stderr: Option<std::fs::File>,
    /// [`Stdin::Pipe`] 일 때만.
    pub stdin: Option<std::fs::File>,
}

/// 검증 · 헤드리스 턴은 [`Stdin::Eof`](사람 입력을 기다리는 명령이 멈추지 않게). [`Stdin::Pipe`] 는 채팅 프로세스(`server::chat_proc`)만 —
/// MCP · AI 문자열에서 그 stdin 으로 가는 길은 없다(→ docs/architecture.md `arch-orch-spawn`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stdin {
    Eof,
    Pipe,
}

pub(crate) type VerifyProc = JobProc;

impl Drop for JobProc {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            win::close_handle(self.process);
            win::close_handle(self.job);
        }
    }
}

impl JobProc {
    pub(crate) fn wait(&self, ms: u32) -> Option<i64> {
        #[cfg(windows)]
        {
            win::wait_exit(self.process, ms)
        }
        #[cfg(not(windows))]
        {
            let _ = ms;
            None
        }
    }

    pub(crate) fn terminate(&self) {
        #[cfg(windows)]
        win::job_terminate(self.job);
    }

    pub(crate) fn active(&self) -> Option<u32> {
        #[cfg(windows)]
        {
            win::job_active(self.job)
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    #[cfg(test)]
    pub(crate) fn in_job(&self) -> bool {
        #[cfg(windows)]
        {
            win::in_job(self.process, self.job)
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
}

/// 검증 실행 전 확인(`orchestration::verify`). **Windows 만**(다른 OS 는 명시적 스텁 — 목표 OS 의 `sh -c` 는
/// 그 OS 빌드 때 [`verify_spawn`] 몸통과 함께).
pub(crate) fn verify_supported() -> bool {
    cfg!(windows) && system_cmd().is_some()
}

/// 신뢰된 셸 — `GetSystemDirectoryW()\cmd.exe`(환경 `ComSpec` 를 믿지 않는다). 다른 OS 는 `None`(스텁).
pub(crate) fn system_cmd() -> Option<String> {
    #[cfg(windows)]
    {
        win::system_cmd()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// **잡에 생성과 동시에 넣어 띄운다** — OS 를 타는 몸은 이 함수 하나(검증 · 헤드리스 턴 · 채팅 공용). `env` = 자식 환경 **전부**(부르는 쪽이
/// 정한다). 배정이 안 서면 프로세스를 시작하지 않는다 — 생성 뒤 pid 로 넣는 대체 경로는 없다(시험 `job_assigned_at_creation_or_turn_not_started`).
/// 상속 가능 핸들을 여는 틈 · `CreateProcessW` 는 **`SPAWN_LOCK` 아래**(ConPTY 셸이 이 파이프를 물려받지 않게 — 시험
/// `headless_spawn_holds_spawn_lock`). 실패 낱말은 `job` · `pipe` · `create` · `unsupported`.
pub(crate) fn spawn_in_job(
    app: &str,
    cmdline: &str,
    cwd: &Path,
    env: &[(String, String)],
    stdin: Stdin,
) -> Result<JobProc, (&'static str, String)> {
    #[cfg(windows)]
    {
        use std::os::windows::io::FromRawHandle;
        let r = win::spawn_in_job(app, cmdline, &cwd.to_string_lossy(), env, stdin == Stdin::Pipe)?;
        // SAFETY: 파이프 끝들은 우리만 쥔 새 핸들이다 — `File` 이 닫는다.
        let (out, err, input) = unsafe {
            (
                std::fs::File::from_raw_handle(r.out as std::os::windows::io::RawHandle),
                std::fs::File::from_raw_handle(r.err as std::os::windows::io::RawHandle),
                r.input.map(|h| std::fs::File::from_raw_handle(h as std::os::windows::io::RawHandle)),
            )
        };
        Ok(JobProc {
            job: r.job as usize,
            process: r.process as usize,
            pid: r.pid,
            stdout: Some(out),
            stderr: Some(err),
            stdin: input,
        })
    }
    #[cfg(not(windows))]
    {
        // 유닉스: `posix_spawn` + 새 세션(setsid) · pgid 단위 정리 — 그 OS 빌드 때. 지금은 시작하지 않는다(명시적 스텁).
        let _ = (app, cmdline, cwd, env, stdin);
        Err(("unsupported", "starting a process in a job is not implemented on this OS".into()))
    }
}

/// `cmdline` 은 고정 직렬화된 명령 줄 그대로(Rust 인자 배열의 인용을 쓰지 않는다) · `env` 는 허용 목록 환경만(서버 환경을 물려주지 않는다).
/// 다른 OS 는 명시적 스텁 `Err(("unsupported", …))`.
pub(crate) fn verify_spawn(
    app: &str,
    cmdline: &str,
    cwd: &Path,
    env: &[(String, String)],
) -> Result<VerifyProc, (&'static str, String)> {
    #[cfg(windows)]
    {
        spawn_in_job(app, cmdline, cwd, env, Stdin::Eof)
    }
    #[cfg(not(windows))]
    {
        // 유닉스: `sh -c "<글자>"` + 새 세션(setsid) · pgid 단위 정리 — 그 OS 빌드 때. 지금은 시작하지 않는다.
        let _ = (app, cmdline, cwd, env);
        Err(("unsupported", "verification is not implemented on this OS".into()))
    }
}

#[cfg(windows)]
mod win {
    use super::SpawnMode;
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
    use windows_sys::Win32::System::JobObjects::*;
    use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows_sys::Win32::System::Threading::*;

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    fn last_err() -> u32 {
        unsafe { GetLastError() }
    }

    pub(super) fn image_path(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    pub(super) fn pid_alive(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            ok != 0 && code == STILL_ACTIVE as u32
        }
    }

    pub(super) fn private_memory(pid: u32) -> Option<u64> {
        use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2};
        if pid == 0 {
            return None;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut c: PROCESS_MEMORY_COUNTERS_EX2 = zeroed();
            c.cb = size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32;
            let ok = K32GetProcessMemoryInfo(h, &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb);
            CloseHandle(h);
            // 옛 Windows 는 EX2 크기를 받아도 앞쪽만 채운다 — 전용 칸이 0 이면 모르는 것으로 본다(작업 집합이 0 인 산 프로세스는 없다)
            (ok != 0 && c.PrivateWorkingSetSize > 0).then_some(c.PrivateWorkingSetSize as u64)
        }
    }

    pub(super) fn create_kill_on_close_job() -> Result<HANDLE, u32> {
        unsafe {
            let job = CreateJobObjectW(null(), null());
            if job.is_null() {
                return Err(last_err());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let e = last_err();
                CloseHandle(job);
                return Err(e);
            }
            if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
                let e = last_err();
                CloseHandle(job);
                return Err(e);
            }
            Ok(job)
        }
    }

    struct Proc {
        pid: u32,
        ppid: u32,
        name: String,
    }

    fn processes() -> Vec<Proc> {
        let mut out = vec![];
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return out;
            }
            let mut e: PROCESSENTRY32W = zeroed();
            e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e);
            while ok != 0 {
                let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push(Proc {
                    pid: e.th32ProcessID,
                    ppid: e.th32ParentProcessID,
                    name: String::from_utf16_lossy(&e.szExeFile[..n]),
                });
                ok = Process32NextW(snap, &mut e);
            }
            CloseHandle(snap);
        }
        out
    }

    /// `root` 의 자손 — 뿌리에서 내려가는 사슬만(잎이 뒤).
    pub(super) fn descendants_of(root: u32) -> Vec<u32> {
        let all = processes();
        let mut order: Vec<u32> = vec![];
        let mut frontier = vec![root];
        while let Some(p) = frontier.pop() {
            for c in all.iter().filter(|c| c.ppid == p && c.pid != root && c.pid != 0) {
                if !order.contains(&c.pid) {
                    order.push(c.pid);
                    frontier.push(c.pid);
                }
            }
        }
        order
    }

    pub(super) fn close_handle(h: usize) {
        if h != 0 {
            unsafe { CloseHandle(h as HANDLE) };
        }
    }

    pub(super) fn job_terminate(h: usize) {
        if h != 0 {
            unsafe { TerminateJobObject(h as HANDLE, 1) };
        }
    }

    pub(super) fn system_cmd() -> Option<String> {
        let mut buf = [0u16; 520];
        let n = unsafe { windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
        if n == 0 || n >= buf.len() {
            return None;
        }
        let dir = String::from_utf16_lossy(&buf[..n]);
        let exe = format!("{}\\cmd.exe", dir.trim_end_matches('\\'));
        std::path::Path::new(&exe).is_file().then_some(exe)
    }

    /// 맏 프로세스가 끝났으면 끝 코드(`u32` 를 부호 있는 수로 — NTSTATUS 같은 큰 코드도 0 이 아니게 남는다).
    pub(super) fn wait_exit(h: usize, ms: u32) -> Option<i64> {
        if h == 0 {
            return None;
        }
        unsafe {
            if WaitForSingleObject(h as HANDLE, ms) != WAIT_OBJECT_0 {
                return None;
            }
            let mut code = 0u32;
            (GetExitCodeProcess(h as HANDLE, &mut code) != 0).then_some(code as i32 as i64)
        }
    }

    pub(super) struct RawJobProc {
        pub job: HANDLE,
        pub process: HANDLE,
        pub pid: u32,
        pub out: HANDLE,
        pub err: HANDLE,
        /// stdin 쓰는 끝(`keep_stdin` 일 때만).
        pub input: Option<HANDLE>,
    }

    /// 시험 — 맏 프로세스가 그 잡에 들어 있나(`IsProcessInJob`).
    #[cfg(test)]
    pub(super) fn in_job(process: usize, job: usize) -> bool {
        let mut r = 0;
        // SAFETY: 우리가 쥔 두 손잡이와 이 함수의 지역 값 하나만 넘긴다.
        let ok = unsafe { IsProcessInJob(process as HANDLE, job as HANDLE, &mut r) };
        ok != 0 && r != 0
    }

    /// 환경 블록(UTF-16 `K=V\0…\0`) — 이름 순(대소문자 무시)으로.
    fn env_block(env: &[(String, String)]) -> Vec<u16> {
        let mut pairs: Vec<&(String, String)> = env.iter().collect();
        pairs.sort_by_key(|(k, _)| k.to_uppercase());
        let mut out: Vec<u16> = Vec::new();
        for (k, v) in pairs {
            out.extend(std::ffi::OsStr::new(&format!("{k}={v}")).encode_wide());
            out.push(0);
        }
        if out.is_empty() {
            out.push(0);
        }
        out.push(0);
        out
    }

    fn close_all(hs: &[HANDLE]) {
        for h in hs {
            if !h.is_null() {
                unsafe { CloseHandle(*h) };
            }
        }
    }

    /// 머리말 [`super::spawn_in_job`]. `PROC_THREAD_ATTRIBUTE_JOB_LIST` 방식 — 재개 경쟁이 없다.
    pub(super) fn spawn_in_job(
        app: &str,
        cmdline: &str,
        cwd: &str,
        env: &[(String, String)],
        keep_stdin: bool,
    ) -> Result<RawJobProc, (&'static str, String)> {
        use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
        use windows_sys::Win32::System::Pipes::CreatePipe;
        unsafe {
            // 1) 잡 — KILL_ON_JOB_CLOSE(손잡이를 닫으면 남은 것 전부 끝).
            let job = CreateJobObjectW(null(), null());
            if job.is_null() {
                return Err(("job", format!("os error {}", last_err())));
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let e = last_err();
                CloseHandle(job);
                return Err(("job", format!("os error {e}")));
            }
            // 2) 파이프 셋 — 모두 상속 안 됨으로 만들고, 자식에게 줄 끝만 생성 순간에 상속 가능으로 바꾼다(아래 잠금 안).
            let sa = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 0,
            };
            let mut h: [HANDLE; 6] = [null_mut(); 6];
            let [in_r, in_w, out_r, out_w, err_r, err_w] = &mut h;
            if CreatePipe(in_r, in_w, &sa, 0) == 0
                || CreatePipe(out_r, out_w, &sa, 0) == 0
                || CreatePipe(err_r, err_w, &sa, 0) == 0
            {
                let e = last_err();
                close_all(&h);
                CloseHandle(job);
                return Err(("pipe", format!("os error {e}")));
            }
            let [in_r, in_w, out_r, out_w, err_r, err_w] = h;
            // 3) 속성 둘 — 상속 핸들 목록(표준 입출력 셋만) · 잡 목록(생성과 동시에 귀속).
            let mut sz: usize = 0;
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut sz);
            let mut abuf = vec![0u8; sz.max(1)];
            let list = abuf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            // UpdateProcThreadAttribute 는 값의 **주소**를 기억한다 — CreateProcessW 까지 살아 있어야 한다.
            let mut inherit: [HANDLE; 3] = [in_r, out_w, err_w];
            let mut jobs: [HANDLE; 1] = [job];
            let fail_attr = |what: &'static str| {
                let e = last_err();
                close_all(&h);
                CloseHandle(job);
                Err((what, format!("os error {e}")))
            };
            if InitializeProcThreadAttributeList(list, 2, 0, &mut sz) == 0 {
                return fail_attr("create");
            }
            if UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                inherit.as_mut_ptr() as *mut c_void,
                size_of::<HANDLE>() * inherit.len(),
                null_mut(),
                null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(list);
                return fail_attr("create");
            }
            if UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                jobs.as_mut_ptr() as *mut c_void,
                size_of::<HANDLE>(),
                null_mut(),
                null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(list);
                return fail_attr("job");
            }
            let mut si: STARTUPINFOEXW = zeroed();
            si.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = in_r;
            si.StartupInfo.hStdOutput = out_w;
            si.StartupInfo.hStdError = err_w;
            si.lpAttributeList = list;
            let block = env_block(env);
            let app_w = wide(app);
            let mut cl = wide(cmdline);
            let cwd_w = wide(cwd);
            let mut pi: PROCESS_INFORMATION = zeroed();
            // 상속 가능 핸들이 열린 틈에 ConPTY 생성이 끼면 교차 상속된다(conpty-spawn-race) — 같은 잠금 아래에서만 연다.
            let (ok, e) = crate::pty::with_spawn_lock(|| {
                for c in inherit {
                    SetHandleInformation(c, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
                }
                let ok = CreateProcessW(
                    app_w.as_ptr(),
                    cl.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                    block.as_ptr() as *const c_void,
                    cwd_w.as_ptr(),
                    &si.StartupInfo,
                    &mut pi,
                );
                let e = last_err();
                // 자식 쪽 끝은 우리에게 필요 없다 — 닫아야 자식(과 잡)이 끝날 때 EOF 가 선다.
                close_all(&[in_r, out_w, err_w]);
                (ok, e)
            });
            DeleteProcThreadAttributeList(list);
            drop(abuf);
            let _ = (&inherit, &jobs);
            // 표준 입력 — 기본은 곧바로 EOF(사람 입력을 기다리는 명령이 멈추지 않게). 사이드 채팅만 쓰는 끝을 쥔다.
            let input = if keep_stdin && ok != 0 {
                Some(in_w)
            } else {
                CloseHandle(in_w);
                None
            };
            if ok == 0 {
                close_all(&[out_r, err_r]);
                CloseHandle(job);
                // 잡 배정이 안 서는 경우도 생성 실패로 온다 — 어느 쪽이든 프로세스는 시작하지 않았다.
                return Err(("create", format!("os error {e}")));
            }
            CloseHandle(pi.hThread);
            Ok(RawJobProc {
                job,
                process: pi.hProcess,
                pid: pi.dwProcessId,
                out: out_r,
                err: err_r,
                input,
            })
        }
    }

    pub(super) fn job_active(h: usize) -> Option<u32> {
        unsafe {
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = zeroed();
            let ok = QueryInformationJobObject(
                h as HANDLE,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut c_void,
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            );
            (ok != 0).then_some(info.ActiveProcesses)
        }
    }

    /// 자식 트리를 잎부터 끝낸다. ppid 는 pid 재사용에 약하다(부모가 먼저 죽은 손자) — 그래서 뿌리(살아 있는 우리)에서
    /// 내려가는 사슬만 따른다.
    pub(super) fn terminate_descendants(root: u32) -> usize {
        let order = descendants_of(root);
        let mut n = 0;
        for pid in order.iter().rev() {
            unsafe {
                let h = OpenProcess(PROCESS_TERMINATE, 0, *pid);
                if !h.is_null() {
                    if TerminateProcess(h, 1) != 0 {
                        n += 1;
                    }
                    CloseHandle(h);
                }
            }
        }
        n
    }

    // `CREATE_NEW_PROCESS_GROUP` 은 넣지 않는다 — 새 프로세스에 "Ctrl+C 무시" 를 켜 **서버가 띄운 셸까지 상속**시킨다(키보드 Ctrl+C 가
    // 셸을 못 끊는다). `DETACHED_PROCESS` 라 그룹 분리는 뜻도 없다.
    const DETACH_FLAGS: u32 = DETACHED_PROCESS;

    /// 우리 인자는 경로·짧은 낱말뿐이다 — 따옴표가 든 인자는 부르는 쪽이 만들지 않는다.
    fn command_line(exe: &str, args: &[String]) -> String {
        std::iter::once(exe)
            .chain(args.iter().map(String::as_str))
            .map(|a| format!("\"{a}\""))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// `CreateProcessW` 한 번 — `parent` 가 있으면 그 프로세스를 부모로 지정한다(자식은 그 부모의 잡 소속을 받는다).
    fn create(cmdline: &str, flags: u32, parent: Option<HANDLE>) -> Result<u32, u32> {
        unsafe {
            let mut attr_buf: Vec<u8> = vec![];
            let mut list: LPPROC_THREAD_ATTRIBUTE_LIST = null_mut();
            // UpdateProcThreadAttribute 는 값의 **주소**를 기억한다 — CreateProcessW 까지 살아 있어야 한다.
            let mut parent_val: HANDLE = null_mut();
            if let Some(p) = parent {
                let mut sz: usize = 0;
                InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut sz);
                attr_buf = vec![0u8; sz];
                list = attr_buf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
                if InitializeProcThreadAttributeList(list, 1, 0, &mut sz) == 0 {
                    return Err(last_err());
                }
                parent_val = p;
                if UpdateProcThreadAttribute(
                    list,
                    0,
                    PROC_THREAD_ATTRIBUTE_PARENT_PROCESS as usize,
                    &mut parent_val as *mut _ as *mut c_void,
                    size_of::<HANDLE>(),
                    null_mut(),
                    null(),
                ) == 0
                {
                    let e = last_err();
                    DeleteProcThreadAttributeList(list);
                    return Err(e);
                }
            }
            let mut si: STARTUPINFOEXW = zeroed();
            si.StartupInfo.cb = if parent.is_some() {
                size_of::<STARTUPINFOEXW>() as u32
            } else {
                size_of::<STARTUPINFOW>() as u32
            };
            si.lpAttributeList = list;
            let mut pi: PROCESS_INFORMATION = zeroed();
            let mut cl = wide(cmdline);
            let extra = if parent.is_some() { EXTENDED_STARTUPINFO_PRESENT } else { 0 };
            let ok = CreateProcessW(
                null(),
                cl.as_mut_ptr(),
                null(),
                null(),
                0,
                flags | extra,
                null(),
                null(),
                &si.StartupInfo,
                &mut pi,
            );
            let e = last_err();
            if !list.is_null() {
                DeleteProcThreadAttributeList(list);
            }
            drop(attr_buf);
            let _ = parent_val;
            if ok == 0 {
                return Err(e);
            }
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            Ok(pi.dwProcessId)
        }
    }

    /// 같은 로그온 세션의 explorer.exe 를 `PROCESS_CREATE_PROCESS` 로 연다(다른 사용자의 것은 권한에서 막힌다).
    fn open_explorer() -> Result<HANDLE, String> {
        let mut mine = 0u32;
        unsafe { ProcessIdToSessionId(std::process::id(), &mut mine) };
        for p in processes().into_iter().filter(|p| p.name.eq_ignore_ascii_case("explorer.exe")) {
            let mut sess = u32::MAX;
            if unsafe { ProcessIdToSessionId(p.pid, &mut sess) } == 0 || sess != mine {
                continue;
            }
            let h = unsafe { OpenProcess(PROCESS_CREATE_PROCESS, 0, p.pid) };
            if !h.is_null() {
                return Ok(h);
            }
        }
        Err("no explorer.exe in this session".into())
    }

    pub(super) fn spawn_server_detached(
        exe: &str,
        args_for: &dyn Fn(SpawnMode) -> Vec<String>,
    ) -> Result<(SpawnMode, u32), String> {
        // 1) breakaway — 부모 잡이 BREAKAWAY_OK 면(또는 잡이 없으면) 여기서 끝난다.
        let cl = command_line(exe, &args_for(SpawnMode::Breakaway));
        let breakaway_err = match create(&cl, DETACH_FLAGS | CREATE_BREAKAWAY_FROM_JOB, None) {
            Ok(pid) => return Ok((SpawnMode::Breakaway, pid)),
            Err(e) => e,
        };
        // 2) explorer 부모 — cargo 잡(`tauri dev`)처럼 breakaway 를 거부하는 잡 아래(err 5).
        let explorer_err = match open_explorer() {
            Ok(h) => {
                let cl = command_line(exe, &args_for(SpawnMode::Explorer));
                let r = create(&cl, DETACH_FLAGS, Some(h));
                unsafe { CloseHandle(h) };
                match r {
                    Ok(pid) => return Ok((SpawnMode::Explorer, pid)),
                    Err(e) => format!("os error {e}"),
                }
            }
            Err(e) => e,
        };
        // 3) 같은 잡 — 경고는 상태로 싣는다(조용한 실패 없음).
        let cl = command_line(exe, &args_for(SpawnMode::SameJob));
        create(&cl, DETACH_FLAGS, None)
            .map(|pid| (SpawnMode::SameJob, pid))
            .map_err(|e| {
                format!(
                    "spawn failed: breakaway os error {breakaway_err}; explorer {explorer_err}; same-job os error {e}"
                )
            })
    }
}
