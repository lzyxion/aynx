//! 로컬 PTY 세션의 **자원** — 셸 고르기(`list_shells`) · 띄울 재료(`prepare_spawn` — GUI) · 띄우기(`spawn_shell` — 세션
//! 서버) · 쓰기 · 크기 · 닫기 · 종료 감시. 세션은 **세션 서버 프로세스**(`aynx session-server`)의 전역 표 [`SESSIONS`]
//! 에 산다(③-2 — 설계 `docs/internal/session-server-design-2026-10-08.md` 9절 ③). GUI 의 Tauri 명령(`open_local_session`·
//! `write_session` …)은 `crate::server::proxy` 가 파이프로 옮기는 껍데기다 — 이 파일을 부르는 것은 서버(`server::sessions`)와
//! GUI 의 재료 준비(`prepare_spawn`)뿐이다.
//!
//! 맡지 않는 것: 출력 배칭·수문 부품은 `crate::output`, 타일 환경변수 **이름**은 `crate::tile_env`,
//! OS 에 묻는 작업 폴더는 `crate::cwd`, 셸 통합 스크립트 글자는 `crate::shell_integration`, 임대·크레딧·연결은 `server::sessions`.
//!
//! 불변식:
//! - 셸 **생성**은 [`SPAWN_LOCK`] 으로 직렬화한다 — ConPTY 동시 생성은 파이프 핸들을 교차 상속해
//!   빈 검은 타일을 남긴다 (docs/log/2026-09-05-conpty-spawn-race.md).
//! - 블로킹 함수(`*_blocking` · [`spawn_shell`] · [`release_now`])는 서버가 블로킹 풀에서 부른다 — 서버의 파이프 고리를
//!   막지 않는다(GUI 쪽 근거는 docs/log/2026-09-05-async-commands.md 와 같다).
//! - 이 파일은 **자원 소유**(ConPTY master·writer·자식 kill·종료 감시·출력 슬롯·수문)만 쥔다. 표·임대·종료 장부
//!   (누가 붙어 있나 · 회차 · 떨어짐/끝남)는 [`crate::session_core`] 다(서버 프로세스의 것).
//! - **종료는 Rust 가 마감한다**([`spawn_exit_watch`]) — 마지막 배치를 배처 뒤로 정렬해 내보내고, 코어에
//!   `Exited` 를 적고, 수문·ConPTY 를 거둔 뒤 [`LocalEvents`] 로 알린다(서버 → GUI 이벤트 프레임 → 창의 `local-exit`).
//! - 신호 전용 토큰은 모든 로컬 타일(스트림이 있을 때), MCP 토큰은 AI 타일만(docs/log/2026-09-25-shell-claude-signals.md).
//!   ③-3a 부터 신호 몫(주소 = 서버 신호 포트 · 스트림 · 신호 토큰)은 **서버가** 뽑아 채우고([`signal_env_vars`] ·
//!   `server::sessions::open`) 세션 자원을 거둘 때 서버가 거둔다([`release_now`] → [`LocalEvents::released`]). **MCP 토큰도 3차 4단계부터
//!   서버가** AI 타일(`open` 몸의 `mcp`)마다 따로 뽑아 넣고 같은 주인 번호로 함께 거둔다(`crate::tile_token` — `(stream, sessionEpoch)` 에
//!   묶임). GUI 재료에는 토큰이 없다. 서버는 값을 자식 환경에 넣을 뿐 로그에 남기지 않는다.
//! - 붙은 창이 없는 동안 셸의 커서 위치 질의(`ESC[6n`)에는 서버가 답한다([`pump_output`]).

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock, Mutex};

use crate::i18n::tr;
use crate::output::{output_slot, spawn_batcher_with, Chunk, Gate, OutputSlot, OutputStats};
use crate::session_core::{core, Kind};

/// 세션 하나의 **입력 쪽 손잡이**. 세션 표(`Sessions`)와 따로 잠근다.
///
/// [`write_session`] 은 블로킹 풀에서 도는데(파이프가 가득 차면 `write_all` 이 멈춘다),
/// 그동안 세션 표의 잠금까지 쥐고 있으면 표를 건드리는 **다른 모든 명령**(닫기·크기·수문)이
/// 함께 멈춘다. 그래서 표에서는 이 `Arc` 만 복제해 나오고 표 잠금은 곧바로 푼다 —
/// SSH 쪽 `Arc<ChannelWriteHalf>`([`crate::ssh::attach_parts`])와 같은 모양이다.
pub(crate) type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

pub struct Session {
    writer: PtyWriter,
    master: Box<dyn MasterPty + Send>,
    /// 자식 프로세스를 **죽이기만** 하는 손잡이 (`close_session`).
    ///
    /// `Child` 자체가 아니라 [`ChildKiller`] 인 것이 요점이다: 진짜 `Child` 는 종료를
    /// 기다리는 대기 스레드가 가져가 `wait()` 로 붙들고 있다 ([`spawn_exit_watch`]).
    /// 하나를 둘이 나눠 갖는 자리라 portable-pty 가 준 분리를 그대로 쓴다 — 그러지 않으면
    /// 대기 중인 `wait()` 가 잠금을 쥔 채로 `kill()` 을 영원히 막는다.
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// 이 세션의 출력 수문. 읽기 스레드가 같은 것을 들고 대기한다.
    gate: Arc<Gate>,
    /// 지금 이 세션의 출력을 받는 곳 — 세션 서버의 연결 싱크(붙은 임대의 것). 창을 옮기면 여기만 갈아 끼운다.
    output: OutputSlot,
    /// 이 세션이 웹뷰로 내보낸 양 — 진단 전용 ([`OutputStats`] · [`crate::session_commands::session_stats`]).
    stats: Arc<OutputStats>,
    /// 마지막으로 PTY 에 알린 크기 `cols << 16 | rows` — 붙기가 같은 크기면 resize 를 건너뛰고(ConPTY 는 같은 크기
    /// resize 에도 화면을 다시 그려 이어진 화면에 줄을 한 벌 더 얹는다), DSR 대답이 맨 아래 줄 번호로 쓴다(배처 스레드가
    /// 표 잠금 없이 읽는다 — 그래서 원자 값이다).
    size: Arc<AtomicU32>,
    /// 이 세션의 **자식 셸 pid** ([`cwd_pid`] 가 이걸로 OS 에 묻는다).
    ///
    /// 생성 시점에 한 번 적고 다시 건드리지 않는다 — 프로세스가 죽으면 값만 낡을 뿐이고,
    /// 그때 [`crate::cwd::child_cwd`] 는 `None` 을 돌려준다 (pid 재사용은 있을 수 있지만
    /// 그 창은 프로세스가 죽자마자 타일이 '종료됨' 으로 넘어가 닫히므로 실기에서 닿지 않는다).
    /// `None` 이면 portable-pty 가 pid 를 안 준 것이다.
    pid: Option<u32>,
    /// 이 세션을 연 셸 id (`ShellInfo.id`). [`cwd_pid`] 가 `wsl:` 을 가려내는 데만 쓴다.
    shell: Option<String>,
    /// 이 타일이 받은 **신호 전용 토큰**의 열쇠(스트림 · 주인 번호) — 닫을 때 거둔다
    /// ([`crate::agent_signal::revoke`]). 토큰 값은 여기 남기지 않는다(자식 환경으로 이미 갔다).
    signal: Option<(String, u64)>,
}

impl Session {
    /// 출력 슬롯(싱크 + 꼬리 링) — 서버가 표에 올리기 전에 싱크를 꽂는다.
    pub(crate) fn output_slot(&self) -> OutputSlot {
        Arc::clone(&self.output)
    }

    /// 출력 수문 — 서버가 임대의 크레딧에 묶는다.
    pub(crate) fn gate(&self) -> Arc<Gate> {
        Arc::clone(&self.gate)
    }
}

/// 살아 있는 로컬 세션 표.
///
/// `Arc` 인 이유: 명령들이 [`tauri::async_runtime::spawn_blocking`] 으로 일을 내보낼 때
/// `tauri::State` 는 수명에 묶여 옮길 수 없다. 표 자체를 `Arc` 로 들면 필요한 명령이
/// 복제 하나만 들고 블로킹 풀로 건너간다 (다른 모듈은 여전히 `state.0.lock()` 그대로다 —
/// `Arc` 가 `Mutex` 로 역참조된다).
#[derive(Default)]
pub struct Sessions(pub Arc<Mutex<HashMap<u32, Session>>>);

/// 이 프로세스의 로컬 세션 표 — 세션 서버에서만 차 있다(GUI 프로세스에서는 늘 비어 있다).
pub(crate) static SESSIONS: LazyLock<Sessions> = LazyLock::new(Sessions::default);

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// ConPTY **생성**을 한 번에 하나씩만 하도록 세우는 잠금.
///
/// 왜: Windows ConPTY 를 동시에 여러 개 만들면(여러 `openpty()` + `slave.spawn_command()`
/// 가 블로킹 풀에서 나란히 돌면) 자식 프로세스가 **남의 파이프 핸들을 교차 상속**할 수 있다
/// — `CreateProcess` 가 상속 가능 핸들을 프로세스 전역에서 훑는 고전적 경쟁이다. 그 자식은
/// 자기 출력 파이프가 죽은 채로 태어나, 몇 바이트 뱉고는 영원히 침묵한다(프로세스는 살아
/// 있고 입력도 들어가는데 화면만 검다). 실기 측정: 4-타일 동시 열기에서 ~3/60 타일이 이렇게
/// 멎었고, 순차 단일 열기에서는 0/20 이었다 (docs/log/2026-09-05-conpty-spawn-race.md).
///
/// 그래서 **생성만** 직렬화한다. 비용은 셸 생성 수 ms × 개수뿐이고 그것도 블로킹 풀에서만
/// 든다 — UI 스레드도 이미 열린 세션의 출력 경로도 건드리지 않는다. 로컬 셸을 한꺼번에 여는
/// 일 자체가 드물어(부팅 복원·저장된 배치 열기) 이 직렬화 비용은 사실상 무의미하다.
///
/// 로컬 PTY 전용이다 — SSH 에는 ConPTY 가 없어 `ssh.rs` 는 건드리지 않는다.
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

/// ConPTY 가 아닌 자식 생성이 **상속 가능 핸들을 잠깐 여는 틈**을 같은 잠금 아래에 둔다 — 오케스트레이션 수락 전 검증
/// (`server::os::verify_spawn`)이 표준 입출력 파이프 끝을 상속 가능으로 바꾸고 `CreateProcessW` 한 뒤 닫는 동안, 동시에 서는
/// ConPTY 셸이 그 핸들을 물려받지 않게(위 경쟁과 같은 원리).
pub(crate) fn with_spawn_lock<T>(f: impl FnOnce() -> T) -> T {
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

// ---------------------------------------------------------------------------
// 셸 감지 (탭 바 "+" 드롭다운)
// ---------------------------------------------------------------------------

/// 이 기기에서 열 수 있는 셸 하나.
///
/// `id` 는 프런트가 그대로 되돌려 주는 **불투명 키**다. 프런트는 이 값을
/// `open_local_session { shell }` 로 실어 보내기만 하고, 해석은 전부
/// [`shell_command`] 한 곳에서 한다.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellInfo {
    /// `"pwsh"` | `"powershell"` | `"cmd"` | `"wsl:<distro>"` | `"gitbash"`
    pub id: String,
    /// 드롭다운에 그대로 찍는 한국어 표시 이름
    pub label: String,
}

impl ShellInfo {
    fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        ShellInfo {
            id: id.into(),
            label: label.into(),
        }
    }
}

/// Git for Windows 기본 설치 경로(시스템 범위) — 찾기가 아무것도 못 찾았을 때 띄울 이름이기도 하다.
const GIT_BASH: &str = r"C:\Program Files\Git\bin\bash.exe";

/// 이 PC 의 Git Bash(`<Git 뿌리>\bin\bash.exe`) — 찾은 것이 없으면 [`GIT_BASH`](그때는 셸 목록에도 없다).
///
/// 예전에는 [`GIT_BASH`] 하나만 봐서 **사용자 범위 설치**(설치 프로그램의 "Only for me" — `%LOCALAPPDATA%\Programs\Git`)나
/// scoop 같은 설치가 셸 목록에 나오지 않았다(2026-11-03 첫 설치 점검). 처음 한 번 찾고 기억한다 — 프로세스가 사는 동안
/// Git 을 새로 깔면 다음 실행부터 보인다(셸 목록과 같은 감지 비용 원칙).
fn git_bash_exe() -> &'static str {
    static FOUND: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    FOUND.get_or_init(|| {
        let local = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
        let path = std::env::var_os("PATH");
        find_git_bash(local.as_deref(), path.as_deref(), &|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| GIT_BASH.to_string())
    })
}

/// Git Bash 후보를 차례로 본다 — **순수**(파일 존재는 `exists` 로 받는다).
///
/// 1. 시스템 범위 기본 경로([`GIT_BASH`])
/// 2. 사용자 범위 기본 경로(`%LOCALAPPDATA%\Programs\Git\bin\bash.exe`)
/// 3. PATH 의 `git.exe` 에서 거슬러 올라간 Git 뿌리(`…\cmd\git.exe` · `…\bin\git.exe` · `…\mingw64\bin\git.exe`)의 `bin\bash.exe`
///
/// PATH 에서 `bash.exe` 를 **바로** 찾지 않는다 — `System32\bash.exe` 는 WSL 이다.
fn find_git_bash(
    local_app_data: Option<&std::path::Path>,
    path: Option<&std::ffi::OsStr>,
    exists: &dyn Fn(&std::path::Path) -> bool,
) -> Option<std::path::PathBuf> {
    use std::path::{Path, PathBuf};
    let system = PathBuf::from(GIT_BASH);
    if exists(&system) {
        return Some(system);
    }
    if let Some(local) = local_app_data {
        let user = local.join(r"Programs\Git\bin\bash.exe");
        if exists(&user) {
            return Some(user);
        }
    }
    for dir in std::env::split_paths(path?) {
        if dir.as_os_str().is_empty() || !dir.is_absolute() || !exists(&dir.join("git.exe")) {
            continue;
        }
        // `git.exe` 가 든 폴더의 조상 둘까지 — `cmd` · `bin` 은 한 칸, `mingw64\bin` 은 두 칸 위가 뿌리다.
        let mut root: Option<&Path> = dir.parent();
        for _ in 0..2 {
            let Some(r) = root else { break };
            let bash = r.join(r"bin\bash.exe");
            if exists(&bash) {
                return Some(bash);
            }
            root = r.parent();
        }
    }
    None
}

/// `CREATE_NO_WINDOW` — 감지용 프로세스가 콘솔 창을 번쩍이지 않게 한다.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 감지용 프로세스는 전부 이걸로 만든다 — 창 없음 + 출력은 버림.
fn quiet_command(exe: &str) -> std::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 셸 id → 실제로 띄울 명령. **순수 함수** (프로세스를 만들지 않아 테스트 가능).
///
/// 알 수 없는 id 는 오류다 — 프런트가 낡은 목록을 들고 있거나 값이 손상됐을 때
/// 엉뚱한 실행 파일이 도는 대신 조용히 실패하게 한다.
///
/// `integration` 은 그 셸에 걸 **로컬 셸 통합의 훅 경로**다. 종류에 따라 뜻이 다르다:
///
/// | id | 값 | 쓰임 |
/// | --- | --- | --- |
/// | `pwsh`·`powershell` | `<config_dir>\aynx\integration.ps1` (윈도우 경로) | `-Command . '<경로>'` |
/// | `wsl:<배포판>` | `/mnt/c/…/aynx/integration-wsl.rc` (**WSL 쪽 경로**) | `sh -c 'exec bash --rcfile …'` |
/// | `gitbash` | `/c/…/aynx/integration-gitbash.rc` (**MSYS 쪽 경로**) | `bash.exe --rcfile <경로> -i` |
/// | `cmd` | 언제나 `None` | cmd 에는 preexec/postexec 가 **원리적으로 없다** |
///
/// `None` 이면 아무것도 붙지 않는다: 파일을 못 썼거나(디스크·권한·UNC 설정 폴더) 그 셸에는
/// 훅이 없다. 그때 argv 는 이 기능이 생기기 전과 **바이트가 같다**.
/// **인자로 받는 것이 계약이다** — 이 함수가 디스크를 만지면 순수성이 사라지고 테스트가
/// 실기 파일 시스템에 묶인다 (경로를 만드는 쪽은 [`spawn_shell`]).
///
/// `relax_ps51` 은 Windows PowerShell 5.1 의 유효 실행 정책이 Restricted 라 그 타일에 `-ExecutionPolicy RemoteSigned` 를
/// 줄지다([`crate::ps_policy`] — 정하는 쪽도 [`spawn_shell`]). `powershell` 에 훅이 있을 때만 뜻이 있고 나머지는 무시한다.
fn shell_command(id: &str, integration: Option<&str>, relax_ps51: bool) -> Result<CommandBuilder, String> {
    if let Some(distro) = id.strip_prefix("wsl:") {
        if distro.is_empty() {
            return Err(
                tr!(ko: "WSL 배포판 이름이 비어 있습니다", en: "The WSL distribution name is empty"),
            );
        }
        return Ok(wsl_command(distro, integration));
    }
    match id {
        "pwsh" => Ok(powershell_command("pwsh.exe", integration, false)),
        "powershell" => Ok(powershell_command("powershell.exe", integration, relax_ps51)),
        "cmd" => Ok(CommandBuilder::new("cmd.exe")),
        "gitbash" => Ok(gitbash_command(integration)),
        other => Err(tr!(ko: "알 수 없는 셸입니다: {other}", en: "Unknown shell: {other}")),
    }
}

/// PowerShell(둘 다) 을 띄우는 명령 — 훅이 있으면 **점 소싱 한 줄**을 붙인다.
///
/// ```text
/// pwsh.exe -NoExit -Command . '<config_dir>\aynx\integration.ps1'
/// ```
///
/// - **`-NoProfile` 을 넣지 않는다.** 사용자의 프로파일(oh-my-posh · starship · PSReadLine
///   설정)은 그대로 돌아야 한다. 프로파일이 `-Command` 보다 **먼저** 돌기 때문에 우리 훅이
///   사용자의 `prompt` 를 감쌀 수 있는 것이기도 하다
///   ([`crate::shell_integration::ps_dot_source`]).
/// - **`-NoExit` 이 짝이다.** `-Command` 만 주면 셸이 그 줄을 읽고 곧바로 끝나 타일이
///   빈 채로 죽는다.
/// - **훅이 없으면 인자도 없다** — 그때 argv 는 이 기능이 생기기 전과 **바이트가 같다**.
/// - `relax` 면 맨 앞에 `-ExecutionPolicy RemoteSigned`(프로세스 범위) — 깨끗한 PC 의 5.1 기본 Restricted 가 점 소싱을
///   막아 감싸개가 서지 않던 것([`crate::ps_policy`]). 훅이 없으면 붙이지 않는다(실을 스크립트가 없다).
fn powershell_command(exe: &str, integration: Option<&str>, relax: bool) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(exe);
    if let Some(path) = integration {
        if relax {
            cmd.args(["-ExecutionPolicy", "RemoteSigned"]);
        }
        cmd.args([
            "-NoExit".to_string(),
            "-Command".to_string(),
            crate::shell_integration::ps_dot_source(path),
        ]);
    }
    cmd
}

/// Git Bash 를 띄우는 명령 — 훅이 있으면 **`--login` 대신 `--rcfile`** 로 뜬다.
///
/// ```text
/// bash.exe --rcfile /c/Users/x/AppData/Roaming/aynx/integration-gitbash.rc -i
/// ```
///
/// - **`--login` 과 `--rcfile` 은 함께 못 쓴다.** bash 는 `--rcfile` 을 **대화형 non-login**
///   셸에서만 본다 — `--login` 을 붙인 채 rc 를 주면 아무 일도 일어나지 않는다. 그래서
///   `--login` 을 떼고, 로그인 셸이 읽던 프로필들은 rc 가 대신 읽는다
///   ([`crate::shell_integration::ensure_gitbash_scripts`] · `PROFILE_CHAIN`).
/// - **경로는 MSYS 모양**(`/c/…`)으로 준다 — `bash.exe` 에게는 그쪽이 자기 파일 시스템이다.
/// - **훅이 없으면 argv 가 예전과 바이트가 같다**(`--login -i`). 설정 폴더가 UNC 위에
///   있거나 파일을 못 썼을 때, 그리고 `[terminal] local_shell_integration = false` 일 때다.
fn gitbash_command(integration: Option<&str>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(git_bash_exe());
    match integration {
        Some(rc) => cmd.args(["--rcfile", rc, "-i"]),
        // 로그인 셸로 띄워야 ~/.bash_profile · PATH 가 Git Bash 창과 같아진다.
        None => cmd.args(["--login", "-i"]),
    }
    cmd
}

/// WSL 배포판 하나를 띄우는 명령 — 훅이 있으면 **`sh -c` 한 줄**을 거쳐 간다.
///
/// ```text
/// wsl.exe -d Ubuntu-24.04 -- sh -c 'if [ "${SHELL##*/}" = bash ]; then exec bash --rcfile '\''…'\'' -i; else exec "${SHELL:-/bin/sh}" -l; fi'
/// ```
///
/// - **`sh -c` 를 한 겹 거치는 이유**는 `$SHELL` 을 **배포판 안에서** 봐야 하기 때문이다.
///   윈도우 쪽에서는 그 배포판의 로그인 셸이 무엇인지 알 수 없고, 알아내려고 `wsl.exe` 를
///   한 번 더 띄우면 세션 생성이 그만큼 늦어진다 (`exec` 라 껍데기 프로세스는 남지 않는다).
/// - **bash 에만 훅이 붙는다** ([`crate::shell_integration::wsl_launch_script`] 의 주석 —
///   zsh 는 `ZDOTDIR` 이 필요해 후속 작업이다).
/// - **훅이 없으면 인자도 없다** — argv 가 이 기능이 생기기 전과 바이트가 같다
///   (`wsl.exe -d <배포판>`). 설정 폴더가 UNC 위에 있거나 파일을 못 썼을 때가 그 경우다.
fn wsl_command(distro: &str, integration: Option<&str>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("wsl.exe");
    match integration {
        Some(rc) => cmd.args([
            "-d".to_string(),
            distro.to_string(),
            "--".to_string(),
            "sh".to_string(),
            "-c".to_string(),
            crate::shell_integration::wsl_launch_script(rc),
        ]),
        None => cmd.args(["-d", distro]),
    }
    cmd
}

/// UTF-16LE 바이트열 → String.
///
/// `wsl.exe` 는 파이프로 받아도 **UTF-16LE** 로 쓴다. 그대로 `from_utf8` 하면
/// 글자 사이마다 NUL 이 낀 쓰레기가 나오므로 여기서 반드시 디코딩한다.
/// BOM(FF FE) 이 있으면 건너뛰고, 홀수로 남은 마지막 1바이트는 버린다.
fn decode_utf16le(bytes: &[u8]) -> String {
    let body = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// `wsl -l -q` 출력에서 배포판 이름만 뽑는다.
///
/// 빈 줄과 `docker-desktop*`(Docker Desktop 이 만드는 내부 배포판) 은 뺀다.
fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
    decode_utf16le(stdout)
        .lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{0}'))
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(str::to_string)
        .collect()
}

/// 설치된 WSL 배포판 목록. wsl.exe 가 없거나 실패하면 **조용히 빈 목록** 이다
/// (WSL 미설치는 오류가 아니라 그냥 고를 항목이 없는 것).
fn wsl_distros() -> Vec<String> {
    let out = match quiet_command("wsl.exe").args(["-l", "-q"]).output() {
        Ok(out) if out.status.success() => out,
        _ => return Vec::new(),
    };
    parse_wsl_list(&out.stdout)
}

/// **이 OS 의 초기 기본 셸** — 설정(`[shell] default`)이 아직 비어 있을 때 프런트가
/// "골라 둔 것처럼" 보여 줄 id 다. 셸을 지정하지 않고 연 세션이 실제로 띄우는 셸이기도
/// 하다 ([`spawn_shell`] 의 `None` 갈래가 이 값을 쓴다).
///
/// **OS 분기는 이 함수 하나뿐이다** (CLAUDE.md 의 전 OS 규칙 · `cwd.rs` 의 `child_cwd` 와
/// 같은 모양). 프런트는 분기를 모르고 `list_shells` 의 `default_id` 로 결과만 받는다.
///
/// `None` 은 **아직 구현하지 않은 OS** 다 — 그 스텁이 곧 "여기가 비어 있다" 는 문서다.
/// 그때 프런트는 기본을 고르지 않은 채로 두고, 세션은 백엔드 폴백으로 열린다.
pub fn os_default_shell_id() -> Option<String> {
    // Windows 에는 "OS 가 정한 셸" 이라는 것이 없다. 그래서 **우리가 고른다**:
    // PowerShell 7 이 깔려 있으면 그것, 없으면 Windows 에 언제나 있는 Windows PowerShell.
    #[cfg(windows)]
    let id = Some(if which_pwsh() { "pwsh" } else { "powershell" }.to_string());

    // macOS 스텁 — 답은 로그인 셸(`$SHELL`, 없으면 `dscl . -read ~ UserShell`)이다.
    // 그 id 를 [`shell_command`] 가 아직 알아보지 못하므로 **지어내지 않고 비워 둔다**.
    #[cfg(target_os = "macos")]
    let id: Option<String> = None; // 로그인 셸 `$SHELL` — 미구현

    // Linux 스텁 — 같은 이유로 비어 있다.
    #[cfg(target_os = "linux")]
    let id: Option<String> = None; // 로그인 셸 `$SHELL` — 미구현

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    let id: Option<String> = None; // 로그인 셸 `$SHELL` — 미구현

    id
}

/// `list_shells` 의 답 — **목록 + 이 OS 의 초기 기본**.
///
/// 기본을 따로 싣는 이유는 프런트가 **순서에 기대지 않게** 하려는 것이다. 지금도
/// [`list_shells_blocking`] 의 첫 항목이 곧 기본이지만, 그건 우연히 그런 것이라
/// 목록에 항목이 하나 끼어드는 순간 조용히 어긋난다.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ShellList {
    /// 이 기기에서 열 수 있는 셸들 (드롭다운 순서 그대로)
    pub shells: Vec<ShellInfo>,
    /// [`os_default_shell_id`] — 아직 구현하지 않은 OS 에서는 `null`
    pub default_id: Option<String>,
}

/// 기기에 실제로 있는 셸 목록 + 이 OS 의 초기 기본. 프런트의 "+" 드롭다운·설정 화면이
/// 이걸 그대로 그린다.
///
/// `powershell.exe` · `cmd.exe` 는 Windows 에 항상 있으므로 검사하지 않는다.
///
/// **프로세스를 띄우는 조회라 블로킹 풀로 내보낸다.** `wsl.exe -l -q` 는 WSL 이 설치돼
/// 있으면 수백 ms 가 걸리고([`wsl_distros`]), 첫 호출에는 `pwsh.exe` 탐지까지 붙는다
/// ([`which_pwsh`] 은 한 번만 검사하지만 그 한 번이 여기다). 동기였을 때는 그 시간 동안
/// UI 스레드가 멈춰 살아 있는 터미널의 출력 채널이 통째로 막혔다
/// (docs/log/2026-09-05-async-commands.md).
#[tauri::command]
pub async fn list_shells() -> ShellList {
    // 조회 실패(블로킹 풀 조인 오류)는 빈 목록 + 기본 없음이다 — 반환 타입에 오류 자리가
    // 없고, 프런트는 빈 목록을 "고를 것이 없음" 으로 그린다.
    tauri::async_runtime::spawn_blocking(shell_list_blocking)
        .await
        .unwrap_or_default()
}

fn shell_list_blocking() -> ShellList {
    ShellList {
        shells: list_shells_blocking(),
        default_id: os_default_shell_id(),
    }
}

fn list_shells_blocking() -> Vec<ShellInfo> {
    let mut shells = Vec::new();
    if which_pwsh() {
        shells.push(ShellInfo::new("pwsh", "PowerShell 7"));
    }
    shells.push(ShellInfo::new("powershell", "Windows PowerShell"));
    // 셸 **표시 이름**만 언어를 탄다 — id(`cmd`)는 설정·타일 스펙에 저장되는 값이라 그대로다.
    // 나머지 넷은 제품 고유명(PowerShell 7 · Windows PowerShell · Git Bash · WSL)이라 두 언어가
    // 같은 글자다. 프런트의 `SHELL_LABELS`(session.ts)는 아직 한국어이고 단계 ②의 몫이다.
    shells.push(ShellInfo::new(
        "cmd",
        tr!(ko: "명령 프롬프트", en: "Command Prompt"),
    ));
    for distro in wsl_distros() {
        shells.push(ShellInfo::new(
            format!("wsl:{distro}"),
            format!("WSL: {distro}"),
        ));
    }
    if std::path::Path::new(git_bash_exe()).exists() {
        shells.push(ShellInfo::new("gitbash", "Git Bash"));
    }
    shells
}

/// 새 셸을 **어느 폴더에서** 띄울 것인가 — 요청한 폴더가 실제로 있으면 그것, 아니면 홈.
///
/// AI 타일이 사용자의 프로젝트 폴더에서 뜨게 하려고 생겼다(홈에서 뜬 Claude Code 는 폴더
/// 안전 확인만 반복하고 맥락이 없다). 요청은 프런트가 정한다 — 포커스된 로컬 타일의 지금
/// 폴더(OSC 7 · `local_cwd`), 없으면 설정 `[ai] start_dir`.
///
/// **틀린 값이 셸을 못 열게 하지 않는다.** 지워진 폴더·오타·파일 경로는 오류가 아니라
/// "안 정함" 으로 읽고 홈으로 떨어진다 — 시작 폴더 하나 덜 맞는 것과 타일이 안 열리는 것은
/// 무게가 다르다 (프런트의 `resolveLocalCwd` 가 실패를 전부 삼키는 것과 같은 규칙).
///
/// OS 를 타는 것은 [`dirs::home_dir`] 하나뿐이라 여기에 `#[cfg]` 가 없다.
fn spawn_cwd(requested: Option<&str>) -> Option<std::path::PathBuf> {
    if let Some(dir) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            return Some(path.to_path_buf());
        }
    }
    dirs::home_dir()
}

/// 로컬 타일 셸에 심는 **신호 몫**의 이름 셋 — 서버 신호 포트 주소(`AYNX_MCP_URL`) · 스트림 id(`AYNX_STREAM`) ·
/// 신호 전용 토큰(`AYNX_SIGNAL_TOKEN`). 세션 서버의 `open` 이 서버 안에서 채운다(③-3a — [`signal_env_vars`]).
pub(crate) const SIGNAL_ENV_NAMES: [&str; 3] = [
    crate::tile_env::MCP_URL_ENV,
    crate::tile_env::STREAM_ENV,
    crate::tile_env::SIGNAL_TOKEN_ENV,
];

/// [`spawn_shell`] 이 물려받은 값을 지우는 타일 이름 전부 — 신호 몫 셋 + MCP 토큰 + 권한 결정 토큰(2026-11-01 — 헤드리스 · 사이드 채팅 ·
/// 프로듀서도 이 목록으로 걷는다: 혹시 사용자 설정의 훅이 권한 도우미를 불러도 곧바로 결정 없이 끝난다).
const TILE_ENV_NAMES: [&str; 5] = [
    crate::tile_env::MCP_URL_ENV,
    crate::tile_env::MCP_TOKEN_ENV,
    crate::tile_env::STREAM_ENV,
    crate::tile_env::SIGNAL_TOKEN_ENV,
    crate::tile_env::PERMISSION_TOKEN_ENV,
];

/// **다른 인스턴스**의 MCP 토큰 변수 이름 — 우리가 싣지는 않지만 물려받았으면 지운다(개발 앱을 릴리스
/// 타일에서 띄우면 릴리스 토큰이 그 이름으로 들어 있다).
const OTHER_INSTANCE_TOKEN_ENV: &str = crate::instance::mcp_token_env(!crate::instance::DEV);

/// **서버 쪽** — 신호 몫 `(이름, 값)` 들 (**순수 함수**). 스트림은 모양이 맞을 때만([`crate::tile_env::stream_ok`] — 훅 스크립트가
/// 이 값을 이스케이프 없이 JSON 에 끼워 넣는다). 주소와 토큰은 **둘 다 있을 때만**(신호 평면 포트 · 그 스트림에 뽑은 토큰) —
/// 하나만 있으면 훅이 401 만 쌓는다.
pub(crate) fn signal_env_vars(port: Option<u16>, stream: &str, token: Option<&str>) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if let (Some(port), Some(tok)) = (port, token) {
        out.push((crate::tile_env::MCP_URL_ENV, crate::tile_env::base_url(port)));
        out.push((crate::tile_env::SIGNAL_TOKEN_ENV, tok.to_owned()));
    }
    if crate::tile_env::stream_ok(stream) {
        out.push((crate::tile_env::STREAM_ENV, stream.to_owned()));
    }
    out
}

/// **셸을 띄울 재료 한 벌** — GUI 가 만들어([`prepare_spawn`]) 세션 서버의 `open` 요청 몸으로 보내고, 서버가 그대로
/// 띄운다([`spawn_shell`]). 서버는 설정·상태줄 도우미 경로·셸 통합 파일을 스스로 정하지 않는다 — 개발 빌드의 서버는
/// 그림자 사본(`server::launch`)에서 돌아 `current_exe()` 가 달라지기 때문이다(도우미 경로가 원본 exe 를 가리켜야 한다).
///
/// **`Debug` 를 파생하지 않는다** — `env` 에 MCP·신호 토큰이 있다(`McpState` 와 같은 규칙). 서버는 이 몸을 로그에 남기지 않는다.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpawnSpec {
    pub cols: u16,
    pub rows: u16,
    /// **해석된** 셸 id(기본 `None` 도 `pwsh`/`powershell` 로 환원된 것).
    pub shell_id: String,
    /// 셸 통합 훅 경로([`shell_command`] 의 `integration`) — 없으면 argv 가 이 기능 전과 같다.
    pub integration: Option<String>,
    /// 자식 환경에 **더할** 값들(타일 신호·MCP 몫 · codex 감싸개 표식 · 상태줄 도우미). 물려받은 같은 이름은 먼저 지운다.
    pub env: Vec<(String, String)>,
    /// 시작 폴더 요청 — 판정은 서버의 [`spawn_cwd`](없는 폴더는 홈).
    pub cwd: Option<String>,
}

/// GUI 쪽 — 셸 id 를 환원하고, 셸 통합 파일을 쓰고(설정이 켰을 때), 자식 환경에 더할 값을 모은다. **블로킹**(파일·pwsh 탐지).
/// 알 수 없는 셸 id 는 여기서 실패한다(서버까지 가지 않는다).
pub(crate) fn prepare_spawn(cols: u16, rows: u16, shell: Option<&str>, cwd: Option<String>) -> Result<SpawnSpec, String> {
    // 기본 셸(`None`)도 **id 로 먼저 환원한다** — 그래야 훅을 붙이는 자리가 하나로 남는다(`"pwsh"` → `pwsh.exe`).
    // 환원의 규칙은 [`os_default_shell_id`] 한 곳이다 (OS 분기가 사는 함수). 그 함수가 `None` 인 OS(스텁)에서는
    // 지금까지의 동작대로 Windows PowerShell 로 떨어진다 — [`shell_command`] 가 아직 Windows 셸만 알아보기 때문이다.
    let os_default = os_default_shell_id();
    let id = match shell {
        Some(id) => id.to_string(),
        None => os_default.unwrap_or_else(|| "powershell".into()),
    };
    // 로컬 셸 통합 스크립트는 **cmd 를 뺀 모든 로컬 셸**에 붙는다 — PowerShell · WSL · Git Bash
    // (docs/log/2026-09-08-block-history-design.md 결정 4). `[terminal] local_shell_integration = false` 면 `None` 이라
    // argv 가 이 기능들이 생기기 전과 바이트가 같다. 실패해도 `None` 일 뿐이라 셸은 그대로 열린다.
    let integration: Option<String> = if !crate::settings::local_shell_integration() {
        None
    } else if matches!(id.as_str(), "pwsh" | "powershell") {
        crate::shell_integration::ensure_ps_script().map(|p| p.to_string_lossy().into_owned())
    } else if id.starts_with("wsl:") {
        crate::shell_integration::ensure_wsl_scripts()
    } else if id == "gitbash" {
        crate::shell_integration::ensure_gitbash_scripts()
    } else {
        None
    };
    // id 해석을 서버에 보내기 전에 — 알 수 없는 id 로 실패할 때 서버 자원이 들지 않는다.
    shell_command(&id, integration.as_deref(), false)?;
    let mut env: Vec<(String, String)> = Vec::new();
    // MCP 토큰 · 신호 몫(주소·스트림·신호 토큰)은 GUI 가 싣지 않는다 — 세션 서버가 `open` 에서 더한다(신호 ③-3a · **타일 MCP 토큰은 3차 4단계**:
    // AI 타일과 감싸개가 있는 로컬 셸 타일(`open` 몸의 `mcp` — 2026-10-26 `crate::agent_tile`)마다 서버가 뽑는다 — `crate::tile_token`).
    // 장식 파일 경로(`AYNX_TILE_AGENT`)는 스트림을 아는 `server::proxy::open_local_session` 이 더한다.
    // 셸 통합의 `codex` 감싸개를 세울지 — `[ai] codex_no_daemon`(기본 켬)일 때만 표식을 심는다
    // (`crate::codex_launch` · docs/log/2026-09-26-codex-hooks.md "다시 켬").
    if crate::settings::codex_no_daemon() {
        env.push((crate::tile_env::NO_DAEMON_ENV.to_string(), "1".into()));
    }
    // Claude Code 요금제 한도 mod — 이 타일에서 뜨는 모든 claude 가 싣는다(`CLAUDE_CODE_PLUGIN_DIRS` + 도우미 경로, 판정은
    // `crate::claude_usage` 한 곳). **GUI 의 exe** 로 정한다 — 개발 빌드의 서버는 그림자 사본에서 돈다.
    env.extend(crate::claude_usage::tile_env(&id));
    Ok(SpawnSpec {
        cols,
        rows,
        shell_id: id,
        integration,
        env,
        cwd,
    })
}

/// 띄운 셸 — 표에 오를 세션 · 출력 읽기 손잡이 · 자식(종료 감시가 가져간다).
pub(crate) struct Spawned {
    pub session: Session,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// 서버 쪽 — 재료([`SpawnSpec`])대로 셸을 띄운다. **블로킹**(ConPTY 생성 — [`SPAWN_LOCK`] 으로 직렬화).
///
/// 자식 환경: 물려받은 타일 이름들(과 다른 인스턴스의 토큰 이름 · codex 표식 · 한도 도우미)을 **먼저 지운다** — 서버는 GUI 의
/// 환경을 물려받고, GUI 가 다른 aynx 의 타일 안에서 떴으면(릴리스 타일에서 `npm run tauri dev`) 그 창의 토큰·주소·
/// 스트림이 들어 있다(docs/log/2026-09-26-dev-release-isolation.md). 그 뒤 `spec.env` 를 더한다. **토큰은 환경으로만** —
/// `cmd.env` 는 프로세스 환경 블록이라 명령줄·로그에 남지 않는다 (docs/log/2026-09-24-agent-hook-signals.md).
pub(crate) fn spawn_shell(spec: &SpawnSpec) -> Result<Spawned, String> {
    // 실행 정책은 셸을 띄우는 이 자리(세션 서버)에서 읽는다 — 그 PC 의 지금 값(레지스트리 몇 칸 · 값싸다).
    let relax_ps51 = spec.shell_id == "powershell"
        && spec.integration.is_some()
        && crate::ps_policy::windows_powershell_needs_relax();
    let mut cmd = shell_command(&spec.shell_id, spec.integration.as_deref(), relax_ps51)?;
    // 재료가 PATH 를 덮으면(일반 Codex AI 타일 — `codex_launch::apply_tile_path`) 셸 실행 파일은 **덮기 전의** PATH 로 찾아 둔다 —
    // portable-pty 는 자식 환경의 PATH 로 찾고 못 찾으면 이름만 넘기는데, 그 이름은 `CreateProcessW` 가 PATH 를 다시 보지 않는다.
    if spec.env.iter().any(|(k, _)| k.eq_ignore_ascii_case("PATH")) {
        resolve_argv0(&mut cmd, std::env::var_os("PATH").as_deref());
    }
    child_env(&mut cmd, &spec.env);
    spawn_command(cmd, spec.cols, spec.rows, spawn_cwd(spec.cwd.as_deref()), spec.shell_id.clone())
}

/// 자식 환경 — 물려받은 것을 먼저 걷고([`clean_tile_env`]) 앱이 정한 값(`env`)을 **그 뒤에** 더한다. 이 순서라 물려받은
/// `CLAUDE_CODE_PLUGIN_DIRS` 는 지워지고 앱이 넣는 한도 mod 의 값(`crate::claude_usage::tile_env`)은 남는다.
fn child_env(cmd: &mut CommandBuilder, env: &[(String, String)]) {
    clean_tile_env(cmd);
    for (name, value) in env {
        cmd.env(name, value);
    }
}

/// **부모 에이전트 세션의 표식** — 앱(GUI · 세션 서버)이 Claude Code · Codex 세션 안에서 떴으면(개발 앱을 에이전트의 셸에서
/// `npm run tauri dev`) 그 세션의 값이 타일 · 작업자로 상속된다. 자식 CLI 가 자기를 "부모 세션 안의 자식" 으로 오인할 수 있고
/// (메시징 소켓 · 토큰 · 세션 id), 물려받을 이유가 없다 — 오케스트레이션 설계 기록 "진행 기록" 의 env 발견.
///
/// **접두가 아니라 이름 목록**이다: `CLAUDE_CODE_GIT_BASH_PATH` · `CLAUDE_CODE_USE_BEDROCK` · `CODEX_HOME` 처럼 사용자가 일부러
/// 정한 설정이 같은 접두를 쓴다 — 지우면 그 타일의 CLI 가 깨진다. 근거:
/// - Claude Code: Claude Code 2.x 셸 안의 실측 env(`CLAUDECODE` · `CLAUDE_CODE_{CHILD_SESSION, SESSION_ID, SESSION_ATTENDED,
///   ENTRYPOINT, EXECPATH, MESSAGING_SOCKET, MESSAGING_TOKEN, PLUGIN_DIRS}` · `CLAUDE_PID` · `CLAUDE_EFFORT`) + IDE 연결 포트
///   `CLAUDE_CODE_SSE_PORT`.
/// - Codex: codex-cli 0.162.1 바이너리 문자열에서 고른 세션·실행 표식(모델 호출 없이는 자식 env 를 실측하지 못했다) —
///   샌드박스 표식(`CODEX_SANDBOX` · `CODEX_SANDBOX_NETWORK_DISABLED`) · 세션 id(`CODEX_SESSION_ID` · `CODEX_THREAD_ID`) ·
///   패키지 관리자 런처 표식(`CODEX_MANAGED_BY_*`). `CODEX_HOME` · `CODEX_API_KEY` 등 설정은 둔다.
///   `CODEX_THREAD_ID` 는 2026-11-06 Codex 셸에서도 이름을 확인했고, 훅 13판의 중첩 CLI 판정에 쓰므로 반드시 걷는다.
const PARENT_AGENT_ENV: [&str; 20] = [
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_PLUGIN_DIRS",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CODEX_MANAGED_BY_NPM",
    "CODEX_MANAGED_BY_BUN",
    "CODEX_MANAGED_BY_PNPM",
    "CODEX_MANAGED_BY_VITE_PLUS",
];

/// **공용 환경 정화 목록**(헤드리스 설계 D11 — 한 함수) — 물려받으면 지우는 이름 전부: 타일 이름들(양쪽 인스턴스의 MCP 토큰 · 신호
/// 토큰 · 스트림 · 주소) · 부모 에이전트 세션 표식 · 다른 인스턴스 토큰 · codex 감싸개 표식 · 한도 도우미. PTY 자식
/// ([`clean_tile_env`])과 오케스트레이션 헤드리스 턴(`orchestration::turn::headless_env`)이 **이 목록 하나**를 함께 쓴다(시험
/// `headless_env_uses_tile_scrub`) — 한쪽에만 이름을 더하는 일이 없게.
pub(crate) fn scrub_env_names() -> impl Iterator<Item = &'static str> {
    TILE_ENV_NAMES.into_iter().chain(PARENT_AGENT_ENV).chain([
        OTHER_INSTANCE_TOKEN_ENV,
        crate::tile_env::NO_DAEMON_ENV,
        crate::tile_env::USAGE_HELPER_ENV,
        crate::tile_env::TILE_AGENT_ENV,
    ])
}

/// 물려받은 타일 이름들(과 다른 인스턴스의 토큰 이름 · codex 표식 · 한도 도우미 · 부모 에이전트 세션 표식)을 지운다 —
/// [`spawn_shell`] 머리말. 목록은 [`scrub_env_names`] 하나.
fn clean_tile_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    for name in scrub_env_names() {
        cmd.env_remove(name);
    }
}

/// argv[0] 이 이름뿐이면 `path` 에서 그 이름 그대로의 파일을 찾아 절대 경로로 바꾼다(못 찾으면 그대로).
fn resolve_argv0(cmd: &mut CommandBuilder, path: Option<&std::ffi::OsStr>) {
    let Some(path) = path else { return };
    let Some(first) = cmd.get_argv().first().cloned() else { return };
    if std::path::Path::new(&first).is_absolute() {
        return;
    }
    if let Some(found) = std::env::split_paths(path).map(|d| d.join(&first)).find(|p| p.is_absolute() && p.is_file()) {
        cmd.get_argv_mut()[0] = found.into_os_string();
    }
}

/// **시험 전용** — 셸 없이 프로그램 하나를 ConPTY 로 띄운다(일반 타일과 같은 [`SPAWN_LOCK`] 길 — 헤드리스 턴 · 검증과의 동시 생성 시험
/// S8). (3a) 오케스트레이션 작업자는 더 이상 PTY 프로그램이 아니다(헤드리스 턴 — `server::workers`) — 제품에는 이 길이 없다.
#[cfg(test)]
pub(crate) fn spawn_argv_for_test(argv: &[String], cwd: &std::path::Path) -> Result<Spawned, String> {
    let cmd = CommandBuilder::from_argv(argv.iter().map(std::ffi::OsString::from).collect());
    spawn_command(cmd, 80, 24, Some(cwd.to_path_buf()), "test".into())
}

/// ConPTY 를 열고 `cmd` 를 띄운다 — [`spawn_shell`] 의 몸.
fn spawn_command(
    mut cmd: CommandBuilder,
    cols: u16,
    rows: u16,
    cwd: Option<std::path::PathBuf>,
    shell: String,
) -> Result<Spawned, String> {
    // ConPTY 동시 생성 경쟁을 막는다 — openpty → spawn_command 의 파이프 핸들 상속 구간을
    // 한 번에 하나씩만 지나가게 한다. 잠금이 오염돼도(직전 spawn 이 패닉) 셸 생성이 영구히
    // 막히면 안 되므로 안쪽 값을 그대로 꺼내 쓴다. 가드는 함수 끝(spawn_command 반환 뒤)까지
    // 산다. (근거: SPAWN_LOCK 주석)
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    // pid 는 **여기서만** 얻을 수 있다 — 진짜 `Child` 는 곧 대기 스레드로 넘어가고
    // (`spawn_exit_watch`) 세션이 들고 있는 것은 죽이는 손잡이뿐이다.
    let pid = child.process_id();

    Ok(Spawned {
        session: Session {
            writer: Arc::new(Mutex::new(writer)),
            master: pair.master,
            killer,
            gate: Arc::new(Gate::new()),
            // 싱크는 서버가 꽂는다(`server::sessions` — 임대 열쇠를 실은 연결 싱크) — 여기는 프로세스만 세우는 자리다.
            output: output_slot(None),
            stats: Arc::new(OutputStats::default()),
            size: Arc::new(AtomicU32::new(pack_size(cols, rows))),
            pid,
            // **해석된** 셸 id — `wsl:` 판정 · 다시 붙은 타일 헤더의 진짜 셸 이름.
            shell: Some(shell),
            // 신호 토큰의 열쇠는 서버가 적는다(뽑는 것은 GUI 다 — `open` 요청 몸).
            signal: None,
        },
        reader,
        child,
    })
}

fn pack_size(cols: u16, rows: u16) -> u32 {
    ((cols as u32) << 16) | rows as u32
}

fn unpack_size(v: u32) -> (u16, u16) {
    ((v >> 16) as u16, (v & 0xffff) as u16)
}

/// `local-exit` 이벤트 페이로드 — SSH 의 `ssh-exit` 과 **같은 모양**이다
/// (`{ id, reason, message }`). 프런트는 두 이벤트를 같은 파서로 읽는다
/// (`session.ts` 의 `parseExitReason`). 세션 서버가 이벤트 프레임으로 GUI 에 보내고, GUI 가 그대로 창에 방송한다.
///
/// `reason` 은 언제나 `"exit"` 다. 로컬 셸에는 SSH 의 `"error"`(전송로가 사라졌다)에
/// 해당하는 상태가 없다 — 프로세스가 끝났으면 그냥 끝난 것이고, 자동 재연결을 돌릴
/// 이유도 없다 (프런트는 `"exit"` 를 **종료됨 배너**로 받는다).
///
/// **사유는 문구가 아니라 코드다**(③-2) — 서버 프로세스는 앱의 화면 언어를 모른다. `code` = `"exit"`(자식이 끝났다 —
/// `exitCode` 가 0 이 아니면 그 값) · `"wait-failed"`(자식을 기다리지 못했다 — `detail` 은 OS 오류 원문) · GUI 가 만드는
/// `"server-stopped"`(서버가 멈췄다 — `server::proxy::on_server_lost`). 문구는 프런트 i18n 이 만든다(`Terminal` `exitNote`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalExit {
    pub id: u32,
    pub reason: String,
    pub code: String,
    pub exit_code: Option<u32>,
    pub detail: Option<String>,
    /// 세션 코어의 스트림·회차 — 표에 오르기 전에 끝났으면 없다.
    pub stream: Option<String>,
    pub session_epoch: Option<u64>,
    /// 붙은 창 없이 끝나 표에서 곧바로 지웠다 — 세션 서버가 MCP 거울을 거둔다(③-3c — 창이 닫기를 부를 일이 없다).
    #[serde(default)]
    pub removed: bool,
}

/// 로컬 세션의 사건을 받는 손 — 세션 서버가 꽂는다(`server::sessions` — 이벤트 프레임으로 GUI 에). 없으면 버린다(시험).
pub(crate) trait LocalEvents: Send + Sync {
    /// 자식이 끝났다(종료 마감 뒤).
    fn exited(&self, ev: LocalExit);
    /// 세션 자원을 거뒀다(닫기·종료·서버 끝) — 신호 전용 토큰 열쇠(스트림 · 주인 번호)가 있으면 서버가 그 자리에서 거둔다.
    fn released(&self, id: u32, signal: Option<(String, u64)>);
}

static EVENTS: std::sync::RwLock<Option<Arc<dyn LocalEvents>>> = std::sync::RwLock::new(None);

/// 사건 손을 꽂는다(서버 시작 — 다시 꽂으면 갈아 끼운다).
pub(crate) fn set_events(events: Arc<dyn LocalEvents>) {
    *EVENTS.write().unwrap_or_else(|e| e.into_inner()) = Some(events);
}

fn events() -> Option<Arc<dyn LocalEvents>> {
    EVENTS.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// 종료 마감 유예 — 자식이 끝난 뒤 ConPTY 파이프에 남은 마지막 바이트를 읽기 스레드가 배처로 넘길 틈.
/// 그 뒤 표식을 배처에 넣어 "그 앞의 배치가 다 나간 순간" 의 링 끝을 최종 오프셋으로 받는다.
const EXIT_DRAIN_GRACE: std::time::Duration = std::time::Duration::from_millis(50);
/// 표식 답을 기다리는 상한 — 배처가 이미 끝났으면 슬롯에서 직접 읽는다.
const EXIT_MARK_WAIT: std::time::Duration = std::time::Duration::from_millis(500);

/// 자식 셸이 끝나기를 기다렸다가 종료 마감을 **한 번** 하는 스레드.
///
/// 왜 읽기 스레드의 EOF 가 아니라 프로세스 종료를 보는가: Windows ConPTY 의 출력 파이프는
/// 의사 콘솔이 닫힐 때까지(= `master` 가 드롭될 때까지) 살아 있을 수 있어서, 셸이 죽어도
/// `read` 가 0 을 돌려준다는 보장이 없다. 프로세스 종료는 그런 사정이 없다.
///
/// ## 종료 마감 (설계 4.3 "종료는 Rust 가 마감")
///
/// ① 자식 종료 ② 유예 뒤 배처에 표식 → 그 앞 배치를 다 내보낸 링 끝 = 최종 오프셋 ③ 코어에 `Exited` (떨어져 있었으면
/// 표에서 곧바로 지움) ④ 자원 회수(신호 토큰 열쇠 → [`LocalEvents::released`] · 수문 · ConPTY) ⑤ [`LocalEvents::exited`].
/// 프런트의 닫기는 그 뒤에 와도 멱등이다. `on_end` 는 서버가 그 세션의 크레딧을 거두는 자리다.
pub(crate) fn spawn_exit_watch(
    id: u32,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mark: mpsc::Sender<Chunk>,
    slot: OutputSlot,
    on_end: Box<dyn FnOnce(u32) + Send>,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        // 정상 종료(0)는 사유가 없다 — 배너가 "세션이 종료되었습니다" 로 끝난다. 문구는 프런트가 만든다(위 `LocalExit`).
        let (code, exit_code, detail) = match status {
            Ok(s) if s.success() => ("exit", None, None),
            Ok(s) => ("exit", Some(s.exit_code()), None),
            Err(e) => ("wait-failed", None, Some(e.to_string())),
        };
        // 코어의 종료 기록(진단·MCP)에는 기계가 읽는 짧은 글자만.
        let message = exit_code
            .map(|c| format!("exit {c}"))
            .or_else(|| detail.clone());
        std::thread::sleep(EXIT_DRAIN_GRACE);
        let final_offset = crate::output::flush_mark(&mark, &slot, EXIT_MARK_WAIT);
        drop(mark);
        let exit = core().exited(Kind::Local, id, message.clone(), final_offset);
        on_end(id);
        if let Some(session) = take(id) {
            release_now(id, session);
        }
        if let Some(e) = exit.as_ref().filter(|e| e.removed) {
            eprintln!(
                "세션 코어: 붙은 창 없이 끝난 로컬 {id} (스트림 {}) 을 표에서 지웠습니다 — 최종 오프셋 {final_offset}",
                e.stream
            );
        }
        if let Some(ev) = events() {
            ev.exited(LocalExit {
                id,
                reason: "exit".into(),
                code: code.into(),
                exit_code,
                detail,
                session_epoch: exit.as_ref().map(|e| e.session_epoch),
                removed: exit.as_ref().is_some_and(|e| e.removed),
                stream: exit.map(|e| e.stream),
            });
        }
    });
}

/// PowerShell 7 이 이 기기에 있는가 — **한 번만 검사하고 기억한다**.
///
/// 검사가 곧 `pwsh.exe` 를 실제로 띄워 종료를 기다리는 일이라 수백 ms 가 든다. 예전에는
/// 셸을 열 때마다 이걸 다시 했다 — 타일 네 개를 동시에 열면 아무도 보지 않는 pwsh 프로세스가
/// 네 번 더 뜨고 그 시간만큼 명령이 붙들려 있었다 (docs/log/2026-09-05-multi-local-open.md).
///
/// 앱이 도는 중에 PowerShell 7 을 설치·삭제하면 다시 켤 때까지 반영되지 않는다. 셸 목록은
/// 앱을 켤 때 정해지는 성격의 값이라 그 대가는 싸다.
fn which_pwsh() -> bool {
    static FOUND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FOUND.get_or_init(|| {
        quiet_command("pwsh.exe")
            .arg("-NoLogo")
            .arg("-Command")
            .arg("exit")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok()
    })
}

/// 읽기 스레드 + 배처를 세운다. 돌려주는 것은 배처로 가는 **표식 입구** — 종료 감시가 마지막 배치를
/// 배처 뒤로 정렬하는 데 쓴다([`spawn_exit_watch`]).
///
/// 배처는 **붙은 창이 없을 때** 셸의 커서 위치 질의(`ESC[6n`)에 대신 답한다 — `ESC[<rows>;1R`(지금 크기의 맨 아래 줄). 스트림
/// 맨 앞의 질의(ConPTY 커서 상속 — 빈 화면)만 `ESC[1;1R`(10-15 — `output::TermQuery::DsrStart`).
/// 세션 서버 안에서는 떨어진 동안 아무도 답하지 않으면 셸이 멈춘다(③-0 실측). 답 쓰기는 배처를 막지 않게 따로 스레드로.
pub(crate) fn pump_output(id: u32, reader: Box<dyn Read + Send>) -> Option<mpsc::Sender<Chunk>> {
    let (output, gate, stats, writer, size) = {
        let table = SESSIONS.0.lock().unwrap();
        let s = table.get(&id)?;
        (
            Arc::clone(&s.output),
            Arc::clone(&s.gate),
            Arc::clone(&s.stats),
            Arc::clone(&s.writer),
            Arc::clone(&s.size),
        )
    };
    Some(pump_parts(reader, output, gate, stats, Some(query_hook(writer, size))))
}

/// 질의 대답 손 — 질의마다 [`crate::output::term_reply`] 의 답을 차례로 PTY 에 직접 쓴다(사람 입력의 길이 아니다).
fn query_hook(writer: PtyWriter, size: Arc<AtomicU32>) -> crate::output::QueryHook {
    Box::new(move |queries: Vec<crate::output::TermQuery>| {
        let (_, rows) = unpack_size(size.load(Ordering::Relaxed));
        let reply: Vec<u8> = queries.iter().flat_map(|q| crate::output::term_reply(q, rows)).collect();
        let writer = Arc::clone(&writer);
        std::thread::spawn(move || {
            let _ = writer.lock().unwrap().write_all(&reply);
        });
    })
}

fn pump_parts(
    mut reader: Box<dyn Read + Send>,
    output: OutputSlot,
    gate: Arc<Gate>,
    stats: Arc<OutputStats>,
    answer: Option<crate::output::QueryHook>,
) -> mpsc::Sender<Chunk> {
    let (tx, rx) = mpsc::channel::<Chunk>();
    let mark = tx.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // 수문이 닫혀 있으면 여기서 스레드가 선다. 이 스레드는 이 세션 전용이라
                    // 블로킹해도 되고, 서면 ConPTY 버퍼가 차 자식 프로세스의 write 가
                    // 자연히 막힌다 (= 진짜 역압).
                    gate.wait_blocking();
                    if tx.send(Chunk::Data(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    spawn_batcher_with(rx, output, stats, answer);
    mark
}


// ---------------------------------------------------------------------------
// 자원 표 조작 — 세션 서버(`server::sessions`)가 부른다. 표 잠금은 각 함수 안에서 끝난다.
// ---------------------------------------------------------------------------

/// 새 세션 id 를 하나 뽑는다.
pub(crate) fn alloc_id() -> u32 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// id 카운터의 바탕을 정한다 — 세션 서버가 시작할 때 한 번(시각에서 뽑은 바탕). 서버가 죽고 새 서버가 떠도 GUI 가
/// 아직 쥔 옛 id(이관 사서함·늦은 이벤트)와 새 id 가 겹치지 않게 한다.
pub(crate) fn seed_ids(base: u32) {
    NEXT_ID.store(base.max(1), Ordering::Relaxed);
}

/// 띄운 세션을 표에 올린다.
pub(crate) fn install(id: u32, session: Session) {
    SESSIONS.0.lock().unwrap().insert(id, session);
}

/// 표에서 뺀다(닫기·종료 마감) — 자원은 부른 쪽이 [`release_now`]·[`shut_down`] 으로 거둔다.
pub(crate) fn take(id: u32) -> Option<Session> {
    SESSIONS.0.lock().unwrap().remove(&id)
}

/// 지금 표에 있는 id 전부(서버 끝·모두 종료).
pub(crate) fn all_ids() -> Vec<u32> {
    let mut ids: Vec<u32> = SESSIONS.0.lock().unwrap().keys().copied().collect();
    ids.sort_unstable();
    ids
}

/// 신호 전용 토큰의 열쇠를 적는다(서버 — GUI 가 뽑아 `open` 몸으로 보낸 것).
pub(crate) fn set_signal(id: u32, signal: Option<(String, u64)>) {
    if let Some(s) = SESSIONS.0.lock().unwrap().get_mut(&id) {
        s.signal = signal;
    }
}

/// 이 로컬 세션의 셸이 **지금 있는 폴더**를 OS 에 물을 pid — WSL 셸이면 `None`(그 pid 는 `wsl.exe` 라 Windows 쪽
/// 폴더가 셸의 자리와 무관하다). 프런트는 먼저 셸이 알려 준 cwd(OSC 7 · OSC 9;9)를 보고, 없을 때 이 길을 탄다
/// (`crate::cwd` 머리말 — PowerShell 은 `Set-Location` 이 프로세스 cwd 를 안 바꿔 이 값이 맞지 않는다).
pub(crate) fn cwd_pid(id: u32) -> Option<u32> {
    let table = SESSIONS.0.lock().unwrap();
    let session = table.get(&id)?;
    match session.shell.as_deref() {
        Some(s) if s.starts_with("wsl:") => None,
        _ => session.pid,
    }
}

/// 이 로컬 세션의 **자식 셸 pid**(WSL 이면 `wsl.exe`) — 자원 모니터(`server::resources`)가 그 아래 트리를 센다. 낡을 수 있다
/// (`Session` 의 `pid` 주석).
pub(crate) fn shell_pid(id: u32) -> Option<u32> {
    SESSIONS.0.lock().unwrap().get(&id).and_then(|s| s.pid)
}

/// 세션의 입력 손잡이만 꺼내 온다 — 표 잠금은 이 함수 안에서 끝난다
/// ([`crate::ssh::attach_parts`] 와 같은 이유: 느린 일을 잠금 위에서 하지 않는다).
fn writer_of(id: u32) -> Result<PtyWriter, String> {
    SESSIONS
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| Arc::clone(&s.writer))
        .ok_or_else(|| "no such session".to_string())
}

/// 키 입력을 셸에 흘려보낸다 — **블로킹**(서버는 블로킹 풀에서 부른다). `write_all` 은 ConPTY 입력 파이프가 가득 차면
/// (자식이 입력을 안 읽는 중 · 큰 붙여넣기) 자식이 읽어 갈 때까지 그 자리에서 멈춘다.
pub(crate) fn write_blocking(id: u32, data: &[u8]) -> Result<(), String> {
    let writer = writer_of(id)?;
    let mut w = writer.lock().unwrap();
    w.write_all(data).map_err(|e| e.to_string())
}

/// 크기를 바꾼다 — **블로킹**(`ResizePseudoConsole` 은 화면 버퍼를 다시 흘린다). 표 전체 잠금을 쥔 채 부른다 — 겹치는
/// 다른 표 조작은 resize **한 번** 길이만큼 기다릴 수 있다(docs/log/2026-09-05-async-commands.md ①).
pub(crate) fn resize_blocking(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS.0.lock().unwrap();
    let session = sessions.get(&id).ok_or("no such session")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    session.size.store(pack_size(cols, rows), Ordering::Relaxed);
    Ok(())
}

/// 붙기·이관에 필요한 셋 — 출력 슬롯 · 수문 · 지금 PTY 크기. 없는 세션이면 `None`. 잠금은 이 함수 안에서 끝난다.
pub(crate) fn attach_parts_sized(id: u32) -> Option<(OutputSlot, Arc<Gate>, (u16, u16))> {
    SESSIONS.0.lock().unwrap().get(&id).map(|s| {
        (
            Arc::clone(&s.output),
            Arc::clone(&s.gate),
            unpack_size(s.size.load(Ordering::Relaxed)),
        )
    })
}

/// 세션을 연 셸 id(해석된 것) — 붙기 결과가 헤더 이름으로 싣는다.
pub(crate) fn shell_of(id: u32) -> Option<String> {
    SESSIONS.0.lock().unwrap().get(&id).and_then(|s| s.shell.clone())
}

/// 떨어진 세션 목록(③-4)의 메타 — 셸 id · 마지막 출력 시각. 없는 세션이면 `None`.
pub(crate) fn detached_meta_of(id: u32) -> Option<(Option<String>, Option<u64>)> {
    let row = SESSIONS
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| (s.shell.clone(), Arc::clone(&s.output)));
    row.map(|(shell, slot)| (shell, crate::output::last_output_ms(&slot)))
}

/// 세션 하나의 출력 계수기를 꺼내 온다. 잠금은 이 함수 안에서 끝난다.
pub(crate) fn stats_of(id: u32) -> Option<Arc<OutputStats>> {
    SESSIONS.0.lock().unwrap().get(&id).map(|s| Arc::clone(&s.stats))
}

/// 손잡이로 닫는다 — 임대 검사 없이(창 파괴 거둠 · 복원이 데려가지 않은 세션 · 모두 종료 · 서버 끝). 코어에서도 뺀다.
/// **블로킹**(`kill`) — 서버는 블로킹 풀에서 부른다.
pub(crate) fn close_by_id_blocking(id: u32) {
    core().remove_id(Kind::Local, id);
    if let Some(session) = take(id) {
        release_now(id, session);
    }
}

/// 표에서 빼낸(또는 끝내 올리지 못한) 세션을 닫는다 — 신호 토큰 회수 알림 + 수문 열기 + 자식 kill. **블로킹.**
///
/// ConPTY 의 종료는 즉시가 아니다: 의사 콘솔이 정리되고 커널이 프로세스를 거두는 데 수십~수백 ms 가 든다
/// (docs/log/2026-09-05-async-commands.md) — 서버는 이것을 블로킹 풀에서 부른다.
pub(crate) fn release_now(id: u32, mut session: Session) {
    // 그 타일이 받은 신호 전용 토큰의 열쇠 — 서버가 거둔다(③-3a · 이 뒤로 그 토큰은 `/agent-signal` 에서 401).
    let signal = session.signal.take();
    if let Some(ev) = events() {
        ev.released(id, signal);
    }
    // 수문을 먼저 열어야 대기 중인 읽기 스레드가 깨어난다. 그 뒤 child 를 죽이면
    // 다음 read 가 EOF 를 돌려주고 스레드가 정상 종료한다 (닫힌 채 죽으면 영구 대기).
    session.gate.release();
    let _ = session.killer.kill();
    // master(의사 콘솔)는 여기서 드롭된다 — 읽기 스레드가 EOF 를 받고 배처도 끝난다.
}

#[cfg(test)]
mod shell_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 물려받은 값을 지우는 목록이 실을 수 있는 이름을 **전부** 덮는다 — 하나라도 빠지면 다른 aynx 의
    /// 값이 그 이름으로 새어 들어간다.
    #[test]
    fn inherited_tile_env_names_cover_everything_we_inject() {
        let mut names: Vec<&str> = signal_env_vars(Some(53812), "s-1", Some("sig"))
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        names.push(crate::tile_env::MCP_TOKEN_ENV);
        // 권한 결정 토큰(2026-11-01 — 서버 `open` 이 `mcp` 타일에 넣는다).
        names.push(crate::tile_env::PERMISSION_TOKEN_ENV);
        assert_eq!(names.len(), TILE_ENV_NAMES.len());
        assert!(names.iter().all(|n| TILE_ENV_NAMES.contains(n)), "{names:?}");
        assert!(SIGNAL_ENV_NAMES.iter().all(|n| TILE_ENV_NAMES.contains(n)));
    }

    /// 신호 몫(서버가 채움) — 무엇이 자식 환경에 가는가(docs/log/2026-09-25-shell-claude-signals.md · ③-3a). MCP 토큰도 3차 4단계부터 서버가
    /// AI 타일에만 채운다(`tile_token` — GUI 재료에는 없다: 아래 `prepare_spawn` 시험).
    #[test]
    fn signal_env_comes_from_the_server_and_the_mcp_token_only_to_ai_tiles() {
        // 서버 신호 포트 + 토큰 → 주소 · 토큰 · 스트림. 주소는 **서버 신호 포트**다.
        let v = signal_env_vars(Some(41000), "s-1", Some("sig"));
        assert_eq!(
            v,
            vec![
                ("AYNX_MCP_URL", "http://127.0.0.1:41000".to_string()),
                ("AYNX_SIGNAL_TOKEN", "sig".to_string()),
                ("AYNX_STREAM", "s-1".to_string()),
            ]
        );
        // 신호 평면이 없거나 토큰을 못 뽑았다 — 주소·토큰 없이 스트림만(셸 통합의 감싸개가 쓴다).
        assert_eq!(signal_env_vars(None, "s-1", Some("sig")), vec![("AYNX_STREAM", "s-1".to_string())]);
        assert_eq!(signal_env_vars(Some(1), "s-1", None), vec![("AYNX_STREAM", "s-1".to_string())]);
        // 모양이 틀린 스트림은 심지 않는다.
        assert!(signal_env_vars(None, "a b", None).is_empty());
    }

    // portable-pty 0.9 의 Windows 읽기 리그레션(wezterm#6783) 실기 확인:
    // ConPTY 가 실제로 프롬프트 바이트를 뱉는지, 깨진 값이 아닌지 본다.
    #[test]
    fn conpty_produces_readable_output() {
        // `_session` 은 끝까지 살아 있어야 한다 — 드롭되면 master(의사 콘솔)가 닫혀
        // 읽기 스레드가 먼저 끝난다. 죽이는 것은 이제 따로 받은 child 손잡이다.
        let spec = prepare_spawn(80, 24, None, None).expect("재료");
        // GUI 재료에는 MCP 토큰이 없다(3차 4단계 — 타일 토큰은 서버가 `open` 에서 넣는다).
        assert!(!spec.env.iter().any(|(k, _)| k == crate::tile_env::MCP_TOKEN_ENV));
        let Spawned {
            session: _session,
            mut reader,
            mut child,
        } = spawn_shell(&spec).expect("spawn shell");

        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let mut collected = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline && collected.len() < 16 {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) {
                collected.extend_from_slice(&chunk);
            }
        }

        let _ = child.kill();
        assert!(
            !collected.is_empty(),
            "ConPTY 가 15초 동안 아무 출력도 내지 않음"
        );
        let text = String::from_utf8_lossy(&collected);
        assert!(
            text.chars().any(|c| c.is_ascii_graphic()),
            "출력에 읽을 수 있는 문자가 없음 (깨진 바이트 의심): {:?}",
            &collected[..collected.len().min(64)]
        );
    }

    /// 시작 폴더 판정 — **있는 폴더만** 통과하고 나머지는 전부 홈이다.
    ///
    /// 홈을 직접 비교하지 않고 `dirs::home_dir()` 과 맞춰 보는 이유는 이 테스트가 OS 를
    /// 타지 않게 하려는 것이다 (그 함수가 이 모듈에서 유일한 OS 의존이다).
    #[test]
    fn spawn_cwd_falls_back_to_home_unless_the_dir_exists() {
        let home = dirs::home_dir();

        // 있는 폴더 → 그 폴더. (`env::temp_dir()` 은 언제나 있고 홈과 다르다.)
        let tmp = std::env::temp_dir();
        assert_eq!(
            spawn_cwd(tmp.to_str()),
            Some(tmp.clone()),
            "있는 폴더는 그대로 쓴다"
        );

        // 없는 폴더 → 홈. 오류가 아니라 "안 정함" 으로 읽는다.
        let missing = tmp.join("aynx-없는-폴더-검사-0d7f1c");
        assert!(!missing.is_dir(), "검사용 경로가 실제로 있으면 안 된다");
        assert_eq!(spawn_cwd(missing.to_str()), home, "없는 폴더는 홈으로");

        // 폴더가 아닌 것(이 소스 파일)도 마찬가지다 — `is_dir` 하나로 걸린다.
        assert_eq!(spawn_cwd(Some(file!())), home, "파일 경로는 홈으로");

        // 안 정함(생략)·빈 문자열·공백만 → 홈.
        assert_eq!(spawn_cwd(None), home, "생략은 홈");
        assert_eq!(spawn_cwd(Some("")), home, "빈 값은 홈");
        assert_eq!(spawn_cwd(Some("   ")), home, "공백만도 홈");
    }

    /// 물려받은 환경을 흉내 낸 명령 — 부모 에이전트 세션 표식 + 사용자가 일부러 정한 설정.
    fn inherited_cmd() -> CommandBuilder {
        let mut cmd = CommandBuilder::new("cmd.exe");
        for name in PARENT_AGENT_ENV {
            cmd.env(name, "parent");
        }
        cmd.env("CODEX_HOME", "C:/me/.codex");
        cmd.env("CLAUDE_CODE_GIT_BASH_PATH", "C:/Git/bin/bash.exe");
        cmd
    }

    /// 앱이 Claude Code · Codex 세션 안에서 떴어도 그 세션의 표식은 타일 · 작업자에 가지 않는다.
    #[test]
    fn parent_agent_session_env_is_stripped() {
        assert!(PARENT_AGENT_ENV.contains(&"CODEX_THREAD_ID"), "훅 13판 중첩 표지");
        let mut cmd = inherited_cmd();
        child_env(&mut cmd, &[]);
        for name in PARENT_AGENT_ENV {
            assert!(cmd.get_env(name).is_none(), "{name} 이 남았다");
        }
    }

    /// 앱이 넣는 `CLAUDE_CODE_PLUGIN_DIRS`(한도 mod)는 걷기 **뒤에** 더해지므로 남는다 — 물려받은 값은 지워진다.
    #[test]
    fn app_injected_plugin_dirs_survives() {
        let mut cmd = inherited_cmd();
        let ours = vec![(crate::claude_usage::PLUGIN_DIRS_ENV.to_string(), "C:/app/mods".to_string())];
        child_env(&mut cmd, &ours);
        assert_eq!(cmd.get_env(crate::claude_usage::PLUGIN_DIRS_ENV), Some(std::ffi::OsStr::new("C:/app/mods")));
        assert!(cmd.get_env("CLAUDECODE").is_none());
    }

    /// 사용자가 정한 설정(같은 접두라도)은 둔다 — `CODEX_HOME` · `CLAUDE_CODE_GIT_BASH_PATH`.
    #[test]
    fn codex_home_is_kept() {
        let mut cmd = inherited_cmd();
        child_env(&mut cmd, &[]);
        assert_eq!(cmd.get_env("CODEX_HOME"), Some(std::ffi::OsStr::new("C:/me/.codex")));
        assert_eq!(cmd.get_env("CLAUDE_CODE_GIT_BASH_PATH"), Some(std::ffi::OsStr::new("C:/Git/bin/bash.exe")));
    }
}
