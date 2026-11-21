//! 로컬 PTY 세션의 자원 — 셸 고르기 · 띄울 재료(GUI) · 띄우기 · 쓰기 · 크기 · 닫기 · 종료 감시. 표는 세션 서버 프로세스에만 찬다.
//!
//! 불변식:
//! - 셸 생성은 [`SPAWN_LOCK`] 으로 직렬화한다 — ConPTY 동시 생성은 파이프 핸들을 교차 상속해 빈 검은 타일을 남긴다(docs/log/2026-09-05-conpty-spawn-race.md).
//! - 블로킹 함수(`*_blocking` · [`spawn_shell`] · [`release_now`])는 서버가 블로킹 풀에서 부른다.
//! - 신호 전용 토큰은 모든 로컬 타일, MCP 토큰은 AI 타일만 — 둘 다 서버가 뽑아 넣고 거둔다. GUI 재료에는 토큰이 없고 값은 로그에 남기지 않는다.

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

/// 세션 표와 따로 잠근다 — `write_all` 이 막히는 동안 표 잠금을 쥐면 닫기 · 크기 · 수문이 함께 멈춘다.
pub(crate) type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

pub struct Session {
    writer: PtyWriter,
    master: Box<dyn MasterPty + Send>,
    /// `Child` 가 아니라 [`ChildKiller`] 다 — 진짜 `Child` 는 종료 감시가 `wait()` 로 붙들고 있어, 나눠 가지면 `kill()` 이 영원히 막힌다.
    killer: Box<dyn ChildKiller + Send + Sync>,
    gate: Arc<Gate>,
    output: OutputSlot,
    stats: Arc<OutputStats>,
    /// 마지막으로 PTY 에 알린 크기 `cols << 16 | rows` — ConPTY 는 같은 크기 resize 에도 화면을 다시 그려 줄을 한 벌 더 얹으니 같으면 건너뛴다.
    /// 배처 스레드가 표 잠금 없이 읽어 원자 값이다.
    size: Arc<AtomicU32>,
    /// 자식 셸 pid — 생성 때 한 번 적는다. 프로세스가 죽으면 낡는다.
    pid: Option<u32>,
    shell: Option<String>,
    /// 신호 전용 토큰의 열쇠(스트림 · 주인 번호) — 닫을 때 거둔다. 토큰 값은 여기 남기지 않는다.
    signal: Option<(String, u64)>,
}

impl Session {
    pub(crate) fn output_slot(&self) -> OutputSlot {
        Arc::clone(&self.output)
    }

    pub(crate) fn gate(&self) -> Arc<Gate> {
        Arc::clone(&self.gate)
    }
}

/// `Arc` 라 표 복제 하나만 들고 블로킹 풀로 건너간다(`tauri::State` 는 수명에 묶여 옮기지 못한다).
#[derive(Default)]
pub struct Sessions(pub Arc<Mutex<HashMap<u32, Session>>>);

/// 세션 서버에서만 차 있다(GUI 프로세스에서는 늘 비어 있다).
pub(crate) static SESSIONS: LazyLock<Sessions> = LazyLock::new(Sessions::default);

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// ConPTY 생성을 한 번에 하나씩 — 동시 생성은 자식이 남의 파이프 핸들을 교차 상속해, 출력 파이프가 죽은 채 화면만 검은 타일이 된다
/// (docs/log/2026-09-05-conpty-spawn-race.md). 생성만 직렬화한다.
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

/// ConPTY 가 아닌 자식 생성이 상속 가능 핸들을 잠깐 여는 틈(`server::os::verify_spawn`)도 같은 잠금 아래에 둔다 — 동시에 서는 ConPTY 셸이 물려받지 않게.
pub(crate) fn with_spawn_lock<T>(f: impl FnOnce() -> T) -> T {
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

// ── 셸 감지 ──

/// `id` 는 불투명 키다 — 해석은 [`shell_command`] 한 곳에서만.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellInfo {
    /// `"pwsh"` | `"powershell"` | `"cmd"` | `"wsl:<distro>"` | `"gitbash"`
    pub id: String,
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

/// 이 PC 의 Git Bash — 없으면 [`GIT_BASH`](그때는 셸 목록에도 없다). 처음 한 번 찾고 기억한다.
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

/// Git Bash 후보: 시스템 기본 경로 → 사용자 범위(`%LOCALAPPDATA%\Programs\Git`) → PATH 의 `git.exe` 에서 거슬러 올라간 뿌리.
/// PATH 에서 `bash.exe` 를 바로 찾지 않는다 — `System32\bash.exe` 는 WSL 이다.
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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn quiet_command(exe: &str) -> std::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 셸 id → 띄울 명령(순수). 알 수 없는 id 는 오류다 — 엉뚱한 실행 파일이 돌지 않게.
/// `integration` 은 셸 통합 훅 경로(PowerShell 은 윈도우 경로 · WSL 은 WSL 쪽 경로 · Git Bash 는 MSYS 경로 · cmd 는 늘 `None`)다.
/// `None` 이면 argv 가 이 기능이 없을 때와 바이트가 같다. `relax_ps51` 은 `powershell` 에 훅이 있을 때만 뜻이 있다.
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

/// - `-NoProfile` 을 넣지 않는다 — 사용자 프로파일이 `-Command` 보다 먼저 돌아야 훅이 사용자의 `prompt` 를 감싼다.
/// - `-NoExit` 이 짝이다 — 없으면 셸이 그 줄만 읽고 끝나 타일이 죽는다.
/// - `relax` 면 `-ExecutionPolicy RemoteSigned`(프로세스 범위) — 5.1 기본 Restricted 가 점 소싱을 막는다([`crate::ps_policy`]).
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

/// `--login` 과 `--rcfile` 은 함께 못 쓴다(bash 는 `--rcfile` 을 대화형 non-login 에서만 본다) — 로그인 셸 프로필은 rc 가 대신 읽는다.
/// 경로는 MSYS 모양(`/c/…`).
fn gitbash_command(integration: Option<&str>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(git_bash_exe());
    match integration {
        Some(rc) => cmd.args(["--rcfile", rc, "-i"]),
        None => cmd.args(["--login", "-i"]),
    }
    cmd
}

/// `sh -c` 를 한 겹 거치는 것은 `$SHELL` 을 배포판 안에서 봐야 해서다. 훅은 bash 에만 붙는다(zsh 는 `ZDOTDIR` 이 필요해 미구현).
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

/// `wsl.exe` 는 파이프로도 UTF-16LE 로 쓴다. BOM 은 건너뛰고 홀수로 남은 1바이트는 버린다.
fn decode_utf16le(bytes: &[u8]) -> String {
    let body = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
    let units: Vec<u16> = body
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .collect();
    String::from_utf16_lossy(&units)
}

/// `docker-desktop*`(Docker Desktop 내부 배포판)은 뺀다.
fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
    decode_utf16le(stdout)
        .lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{0}'))
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(str::to_string)
        .collect()
}

/// wsl.exe 가 없거나 실패하면 빈 목록이다(WSL 미설치는 오류가 아니다).
fn wsl_distros() -> Vec<String> {
    let out = match quiet_command("wsl.exe").args(["-l", "-q"]).output() {
        Ok(out) if out.status.success() => out,
        _ => return Vec::new(),
    };
    parse_wsl_list(&out.stdout)
}

/// 이 OS 의 초기 기본 셸 — `[shell] default` 가 비었을 때의 값이자 셸을 지정하지 않은 세션이 띄우는 셸. OS 분기는 이 함수 하나뿐이다.
///
/// `None` 은 아직 구현하지 않은 OS 다 — 그 스텁이 곧 "여기가 비어 있다" 는 문서다.
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

/// 기본을 따로 싣는다 — 프런트가 목록 순서에 기대지 않게.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ShellList {
    pub shells: Vec<ShellInfo>,
    pub default_id: Option<String>,
}

/// 블로킹 풀로 내보낸다 — `wsl.exe -l -q` · 첫 `pwsh.exe` 탐지가 수백 ms 라 동기면 UI 스레드가 멈춰 다른 세션 출력이 막힌다
/// (docs/log/2026-09-05-async-commands.md).
#[tauri::command]
pub async fn list_shells() -> ShellList {
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
    // 표시 이름만 언어를 탄다 — id(`cmd`)는 설정 · 타일 스펙에 저장되는 값이다.
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

/// 새 셸의 시작 폴더 — 요청한 폴더가 실제로 있으면 그것, 아니면 홈. 틀린 값은 오류가 아니라 "안 정함" 이다(타일이 못 여는 것보다 낫다).
fn spawn_cwd(requested: Option<&str>) -> Option<std::path::PathBuf> {
    if let Some(dir) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            return Some(path.to_path_buf());
        }
    }
    dirs::home_dir()
}

/// 로컬 타일 셸에 심는 신호 몫의 이름 셋 — 서버가 [`signal_env_vars`] 로 채운다.
pub(crate) const SIGNAL_ENV_NAMES: [&str; 3] = [
    crate::tile_env::MCP_URL_ENV,
    crate::tile_env::STREAM_ENV,
    crate::tile_env::SIGNAL_TOKEN_ENV,
];

/// [`spawn_shell`] 이 물려받은 값을 지우는 타일 이름 전부 — 헤드리스 · 사이드 채팅 · 프로듀서도 이 목록으로 걷는다.
const TILE_ENV_NAMES: [&str; 5] = [
    crate::tile_env::MCP_URL_ENV,
    crate::tile_env::MCP_TOKEN_ENV,
    crate::tile_env::STREAM_ENV,
    crate::tile_env::SIGNAL_TOKEN_ENV,
    crate::tile_env::PERMISSION_TOKEN_ENV,
];

/// 다른 인스턴스의 MCP 토큰 변수 — 싣지는 않지만 물려받았으면 지운다(릴리스 타일에서 개발 앱을 띄운 경우).
const OTHER_INSTANCE_TOKEN_ENV: &str = crate::instance::mcp_token_env(!crate::instance::DEV);

/// 서버 쪽 신호 몫(순수). 스트림은 모양이 맞을 때만 — 훅 스크립트가 이스케이프 없이 JSON 에 끼운다.
/// 주소와 토큰은 둘 다 있을 때만 — 하나만 있으면 훅이 401 만 쌓는다.
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

/// 셸을 띄울 재료 — GUI 가 만들고 서버는 그대로 띄운다. 서버가 경로를 스스로 정하지 않는 것은 개발 빌드의 서버가 그림자 사본에서 돌아
/// `current_exe()` 가 달라서다. `Debug` 를 파생하지 않는다 — `env` 에 토큰이 실릴 수 있다.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpawnSpec {
    pub cols: u16,
    pub rows: u16,
    /// 해석된 셸 id(기본 `None` 도 환원된 것).
    pub shell_id: String,
    pub integration: Option<String>,
    /// 자식 환경에 더할 값들 — 물려받은 같은 이름은 먼저 지운다.
    pub env: Vec<(String, String)>,
    /// 판정은 서버의 [`spawn_cwd`].
    pub cwd: Option<String>,
}

/// GUI 쪽 — 셸 id 환원 · 셸 통합 파일 쓰기 · 더할 환경 모으기. 블로킹. 알 수 없는 셸 id 는 서버까지 가지 않고 여기서 실패한다.
pub(crate) fn prepare_spawn(cols: u16, rows: u16, shell: Option<&str>, cwd: Option<String>) -> Result<SpawnSpec, String> {
    // `None` 인 OS(스텁)에서는 Windows PowerShell 로 떨어진다 — [`shell_command`] 가 아직 Windows 셸만 안다.
    let os_default = os_default_shell_id();
    let id = match shell {
        Some(id) => id.to_string(),
        None => os_default.unwrap_or_else(|| "powershell".into()),
    };
    // 셸 통합은 cmd 를 뺀 모든 로컬 셸에 붙는다. 실패해도 `None` 일 뿐 셸은 열린다.
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
    shell_command(&id, integration.as_deref(), false)?;
    let mut env: Vec<(String, String)> = Vec::new();
    // MCP 토큰 · 신호 몫은 GUI 가 싣지 않는다 — 세션 서버가 `open` 에서 더한다.
    if crate::settings::codex_no_daemon() {
        env.push((crate::tile_env::NO_DAEMON_ENV.to_string(), "1".into()));
    }
    // 한도 mod 도우미 경로는 GUI 의 exe 로 정한다 — 개발 빌드의 서버는 그림자 사본에서 돈다.
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

pub(crate) struct Spawned {
    pub session: Session,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// 서버 쪽 — 재료대로 셸을 띄운다. 블로킹. 물려받은 타일 이름들을 먼저 지운다 — 다른 aynx 타일 안에서 뜬 GUI 의 토큰 · 주소가 새지 않게
/// (docs/log/2026-09-26-dev-release-isolation.md). 토큰은 환경으로만 — 명령줄 · 로그에 남지 않는다.
pub(crate) fn spawn_shell(spec: &SpawnSpec) -> Result<Spawned, String> {
    let relax_ps51 = spec.shell_id == "powershell"
        && spec.integration.is_some()
        && crate::ps_policy::windows_powershell_needs_relax();
    let mut cmd = shell_command(&spec.shell_id, spec.integration.as_deref(), relax_ps51)?;
    // 재료가 PATH 를 덮으면 셸 실행 파일은 덮기 전의 PATH 로 찾아 둔다 — portable-pty 가 못 찾고 넘긴 이름을 `CreateProcessW` 는 PATH 로 다시 찾지 않는다.
    if spec.env.iter().any(|(k, _)| k.eq_ignore_ascii_case("PATH")) {
        resolve_argv0(&mut cmd, std::env::var_os("PATH").as_deref());
    }
    child_env(&mut cmd, &spec.env);
    spawn_command(cmd, spec.cols, spec.rows, spawn_cwd(spec.cwd.as_deref()), spec.shell_id.clone())
}

/// 물려받은 것을 먼저 걷고 앱의 값을 그 뒤에 더한다 — 순서를 뒤집으면 앱이 넣는 `CLAUDE_CODE_PLUGIN_DIRS` 가 지워진다.
fn child_env(cmd: &mut CommandBuilder, env: &[(String, String)]) {
    clean_tile_env(cmd);
    for (name, value) in env {
        cmd.env(name, value);
    }
}

/// 부모 에이전트 세션의 표식 — 앱이 Claude Code · Codex 세션 안에서 떴으면 그 값이 타일 · 작업자로 상속돼 자식 CLI 가 자기를 자식 세션으로 오인한다.
/// 접두가 아니라 이름 목록이다 — `CLAUDE_CODE_GIT_BASH_PATH` · `CLAUDE_CODE_USE_BEDROCK` · `CODEX_HOME` 같은 사용자 설정이 같은 접두를 쓴다.
/// `CODEX_THREAD_ID` 는 훅 13판의 중첩 CLI 판정에 쓰므로 반드시 걷는다.
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

/// 물려받으면 지우는 이름 전부 — PTY 자식과 헤드리스 턴(`orchestration::turn::headless_env`)이 이 목록 하나를 쓴다(시험 `headless_env_uses_tile_scrub`).
pub(crate) fn scrub_env_names() -> impl Iterator<Item = &'static str> {
    TILE_ENV_NAMES.into_iter().chain(PARENT_AGENT_ENV).chain([
        OTHER_INSTANCE_TOKEN_ENV,
        crate::tile_env::NO_DAEMON_ENV,
        crate::tile_env::USAGE_HELPER_ENV,
        crate::tile_env::TILE_AGENT_ENV,
    ])
}

/// 목록은 [`scrub_env_names`] 하나.
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

/// 시험 전용 — 셸 없이 프로그램 하나를 ConPTY 로 띄운다(같은 [`SPAWN_LOCK`] 길). 제품에는 이 길이 없다.
#[cfg(test)]
pub(crate) fn spawn_argv_for_test(argv: &[String], cwd: &std::path::Path) -> Result<Spawned, String> {
    let cmd = CommandBuilder::from_argv(argv.iter().map(std::ffi::OsString::from).collect());
    spawn_command(cmd, 80, 24, Some(cwd.to_path_buf()), "test".into())
}

fn spawn_command(
    mut cmd: CommandBuilder,
    cols: u16,
    rows: u16,
    cwd: Option<std::path::PathBuf>,
    shell: String,
) -> Result<Spawned, String> {
    // 잠금이 오염돼도 셸 생성이 영구히 막히면 안 되므로 안쪽 값을 꺼낸다. 가드는 함수 끝까지 산다.
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
    // pid 는 여기서만 얻는다 — 진짜 `Child` 는 곧 종료 감시로 넘어간다.
    let pid = child.process_id();

    Ok(Spawned {
        session: Session {
            writer: Arc::new(Mutex::new(writer)),
            master: pair.master,
            killer,
            gate: Arc::new(Gate::new()),
            output: output_slot(None),
            stats: Arc::new(OutputStats::default()),
            size: Arc::new(AtomicU32::new(pack_size(cols, rows))),
            pid,
            shell: Some(shell),
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

/// `local-exit` 페이로드 — SSH `ssh-exit` 과 같은 모양이다(프런트 `parseExitReason` 이 둘을 같이 읽는다). `reason` 은 늘 `"exit"`.
/// 사유는 문구가 아니라 코드다 — 서버는 화면 언어를 모른다. GUI 가 만드는 `"server-stopped"` 도 같은 칸이다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalExit {
    pub id: u32,
    pub reason: String,
    pub code: String,
    pub exit_code: Option<u32>,
    pub detail: Option<String>,
    pub stream: Option<String>,
    pub session_epoch: Option<u64>,
    /// 붙은 창 없이 끝나 표에서 곧바로 지웠다 — 서버가 MCP 거울을 거둔다.
    #[serde(default)]
    pub removed: bool,
}

/// 로컬 세션의 사건을 받는 손 — 세션 서버가 꽂는다. 없으면 버린다(시험).
pub(crate) trait LocalEvents: Send + Sync {
    fn exited(&self, ev: LocalExit);
    fn released(&self, id: u32, signal: Option<(String, u64)>);
}

static EVENTS: std::sync::RwLock<Option<Arc<dyn LocalEvents>>> = std::sync::RwLock::new(None);

pub(crate) fn set_events(events: Arc<dyn LocalEvents>) {
    *EVENTS.write().unwrap_or_else(|e| e.into_inner()) = Some(events);
}

fn events() -> Option<Arc<dyn LocalEvents>> {
    EVENTS.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// 종료 마감 유예 — 자식이 끝난 뒤 ConPTY 파이프에 남은 마지막 바이트가 배처로 넘어갈 틈.
const EXIT_DRAIN_GRACE: std::time::Duration = std::time::Duration::from_millis(50);
const EXIT_MARK_WAIT: std::time::Duration = std::time::Duration::from_millis(500);

/// 자식 셸 종료를 기다렸다가 종료 마감을 한 번 한다. 읽기 스레드의 EOF 가 아니라 프로세스 종료를 본다 — ConPTY 출력 파이프는
/// `master` 가 드롭될 때까지 살아 있을 수 있다. 마지막 배치를 배처 뒤로 정렬해 최종 오프셋을 받은 뒤 코어에 `Exited` 를 적는다.
pub(crate) fn spawn_exit_watch(
    id: u32,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mark: mpsc::Sender<Chunk>,
    slot: OutputSlot,
    on_end: Box<dyn FnOnce(u32) + Send>,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        let (code, exit_code, detail) = match status {
            Ok(s) if s.success() => ("exit", None, None),
            Ok(s) => ("exit", Some(s.exit_code()), None),
            Err(e) => ("wait-failed", None, Some(e.to_string())),
        };
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

/// PowerShell 7 이 있는가 — 한 번만 검사하고 기억한다(검사가 `pwsh.exe` 를 실제로 띄운다). 앱이 도는 중 설치 · 삭제는 다음 실행부터 보인다.
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

/// 읽기 스레드 + 배처를 세우고 배처로 가는 표식 입구를 돌려준다. 붙은 창이 없는 동안 셸의 커서 위치 질의(`ESC[6n`)에는 배처가 답한다 —
/// 아무도 답하지 않으면 셸이 멈춘다. 답 쓰기는 배처를 막지 않게 따로 스레드로.
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

/// 질의 답은 PTY 에 직접 쓴다(사람 입력의 길이 아니다).
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
                    // 수문이 닫혀 있으면 여기서 선다 — ConPTY 버퍼가 차 자식의 write 가 막힌다(역압).
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


// ── 자원 표 조작 ──

pub(crate) fn alloc_id() -> u32 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// 세션 서버가 시작할 때 한 번 — 새 서버의 id 가 GUI 가 아직 쥔 옛 id(이관 사서함 · 늦은 이벤트)와 겹치지 않게.
pub(crate) fn seed_ids(base: u32) {
    NEXT_ID.store(base.max(1), Ordering::Relaxed);
}

pub(crate) fn install(id: u32, session: Session) {
    SESSIONS.0.lock().unwrap().insert(id, session);
}

/// 자원은 부른 쪽이 [`release_now`] 로 거둔다.
pub(crate) fn take(id: u32) -> Option<Session> {
    SESSIONS.0.lock().unwrap().remove(&id)
}

pub(crate) fn all_ids() -> Vec<u32> {
    let mut ids: Vec<u32> = SESSIONS.0.lock().unwrap().keys().copied().collect();
    ids.sort_unstable();
    ids
}

pub(crate) fn set_signal(id: u32, signal: Option<(String, u64)>) {
    if let Some(s) = SESSIONS.0.lock().unwrap().get_mut(&id) {
        s.signal = signal;
    }
}

/// 셸의 지금 폴더를 OS 에 물을 pid — WSL 셸이면 `None`(그 pid 는 `wsl.exe` 라 셸의 자리와 무관하다).
pub(crate) fn cwd_pid(id: u32) -> Option<u32> {
    let table = SESSIONS.0.lock().unwrap();
    let session = table.get(&id)?;
    match session.shell.as_deref() {
        Some(s) if s.starts_with("wsl:") => None,
        _ => session.pid,
    }
}

/// 자식 셸 pid(WSL 이면 `wsl.exe`) — 낡을 수 있다.
pub(crate) fn shell_pid(id: u32) -> Option<u32> {
    SESSIONS.0.lock().unwrap().get(&id).and_then(|s| s.pid)
}

/// 표 잠금은 이 함수 안에서 끝난다 — 막히는 쓰기를 잠금 위에서 하지 않는다.
fn writer_of(id: u32) -> Result<PtyWriter, String> {
    SESSIONS
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| Arc::clone(&s.writer))
        .ok_or_else(|| "no such session".to_string())
}

/// 블로킹 — ConPTY 입력 파이프가 가득 차면 자식이 읽어 갈 때까지 멈춘다.
pub(crate) fn write_blocking(id: u32, data: &[u8]) -> Result<(), String> {
    let writer = writer_of(id)?;
    let mut w = writer.lock().unwrap();
    w.write_all(data).map_err(|e| e.to_string())
}

/// 블로킹. 표 전체 잠금을 쥔 채 부른다 — 겹치는 표 조작은 resize 한 번 길이만큼 기다릴 수 있다.
pub(crate) fn resize_blocking(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let slot = {
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
        Arc::clone(&session.output)
    };
    // 표 잠금 밖에서 — `crate::screen_mirror` 의 잠금 순서.
    crate::output::resize_tap(&slot, cols, rows);
    Ok(())
}

pub(crate) fn attach_parts_sized(id: u32) -> Option<(OutputSlot, Arc<Gate>, (u16, u16))> {
    SESSIONS.0.lock().unwrap().get(&id).map(|s| {
        (
            Arc::clone(&s.output),
            Arc::clone(&s.gate),
            unpack_size(s.size.load(Ordering::Relaxed)),
        )
    })
}

pub(crate) fn shell_of(id: u32) -> Option<String> {
    SESSIONS.0.lock().unwrap().get(&id).and_then(|s| s.shell.clone())
}

pub(crate) fn detached_meta_of(id: u32) -> Option<(Option<String>, Option<u64>)> {
    let row = SESSIONS
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| (s.shell.clone(), Arc::clone(&s.output)));
    row.map(|(shell, slot)| (shell, crate::output::last_output_ms(&slot)))
}

pub(crate) fn stats_of(id: u32) -> Option<Arc<OutputStats>> {
    SESSIONS.0.lock().unwrap().get(&id).map(|s| Arc::clone(&s.stats))
}

/// 임대 검사 없이 닫는다. 코어에서도 뺀다. 블로킹(`kill`).
pub(crate) fn close_by_id_blocking(id: u32) {
    core().remove_id(Kind::Local, id);
    if let Some(session) = take(id) {
        release_now(id, session);
    }
}

/// 표에서 빼낸 세션을 닫는다. 블로킹 — ConPTY 종료는 수십~수백 ms 가 든다.
pub(crate) fn release_now(id: u32, mut session: Session) {
    let signal = session.signal.take();
    if let Some(ev) = events() {
        ev.released(id, signal);
    }
    // 수문을 먼저 연다 — 닫힌 채 죽이면 읽기 스레드가 영구 대기한다.
    session.gate.release();
    let _ = session.killer.kill();
}

#[cfg(test)]
mod shell_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 하나라도 빠지면 다른 aynx 의 값이 그 이름으로 새어 들어간다.
    #[test]
    fn inherited_tile_env_names_cover_everything_we_inject() {
        let mut names: Vec<&str> = signal_env_vars(Some(53812), "s-1", Some("sig"))
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        names.push(crate::tile_env::MCP_TOKEN_ENV);
        names.push(crate::tile_env::PERMISSION_TOKEN_ENV);
        assert_eq!(names.len(), TILE_ENV_NAMES.len());
        assert!(names.iter().all(|n| TILE_ENV_NAMES.contains(n)), "{names:?}");
        assert!(SIGNAL_ENV_NAMES.iter().all(|n| TILE_ENV_NAMES.contains(n)));
    }

    #[test]
    fn signal_env_comes_from_the_server_and_the_mcp_token_only_to_ai_tiles() {
        let v = signal_env_vars(Some(41000), "s-1", Some("sig"));
        assert_eq!(
            v,
            vec![
                ("AYNX_MCP_URL", "http://127.0.0.1:41000".to_string()),
                ("AYNX_SIGNAL_TOKEN", "sig".to_string()),
                ("AYNX_STREAM", "s-1".to_string()),
            ]
        );
        assert_eq!(signal_env_vars(None, "s-1", Some("sig")), vec![("AYNX_STREAM", "s-1".to_string())]);
        assert_eq!(signal_env_vars(Some(1), "s-1", None), vec![("AYNX_STREAM", "s-1".to_string())]);
        assert!(signal_env_vars(None, "a b", None).is_empty());
    }

    // portable-pty 0.9 의 Windows 읽기 리그레션(wezterm#6783) 확인.
    #[test]
    fn conpty_produces_readable_output() {
        // `_session` 이 드롭되면 master 가 닫혀 읽기 스레드가 먼저 끝난다.
        let spec = prepare_spawn(80, 24, None, None).expect("재료");
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

    /// 홈은 `dirs::home_dir()` 과 맞춰 본다 — 테스트가 OS 를 타지 않게.
    #[test]
    fn spawn_cwd_falls_back_to_home_unless_the_dir_exists() {
        let home = dirs::home_dir();

        let tmp = std::env::temp_dir();
        assert_eq!(
            spawn_cwd(tmp.to_str()),
            Some(tmp.clone()),
            "있는 폴더는 그대로 쓴다"
        );

        let missing = tmp.join("aynx-없는-폴더-검사-0d7f1c");
        assert!(!missing.is_dir(), "검사용 경로가 실제로 있으면 안 된다");
        assert_eq!(spawn_cwd(missing.to_str()), home, "없는 폴더는 홈으로");

        assert_eq!(spawn_cwd(Some(file!())), home, "파일 경로는 홈으로");

        assert_eq!(spawn_cwd(None), home, "생략은 홈");
        assert_eq!(spawn_cwd(Some("")), home, "빈 값은 홈");
        assert_eq!(spawn_cwd(Some("   ")), home, "공백만도 홈");
    }

    fn inherited_cmd() -> CommandBuilder {
        let mut cmd = CommandBuilder::new("cmd.exe");
        for name in PARENT_AGENT_ENV {
            cmd.env(name, "parent");
        }
        cmd.env("CODEX_HOME", "C:/me/.codex");
        cmd.env("CLAUDE_CODE_GIT_BASH_PATH", "C:/Git/bin/bash.exe");
        cmd
    }

    #[test]
    fn parent_agent_session_env_is_stripped() {
        assert!(PARENT_AGENT_ENV.contains(&"CODEX_THREAD_ID"), "훅 13판 중첩 표지");
        let mut cmd = inherited_cmd();
        child_env(&mut cmd, &[]);
        for name in PARENT_AGENT_ENV {
            assert!(cmd.get_env(name).is_none(), "{name} 이 남았다");
        }
    }

    #[test]
    fn app_injected_plugin_dirs_survives() {
        let mut cmd = inherited_cmd();
        let ours = vec![(crate::claude_usage::PLUGIN_DIRS_ENV.to_string(), "C:/app/mods".to_string())];
        child_env(&mut cmd, &ours);
        assert_eq!(cmd.get_env(crate::claude_usage::PLUGIN_DIRS_ENV), Some(std::ffi::OsStr::new("C:/app/mods")));
        assert!(cmd.get_env("CLAUDECODE").is_none());
    }

    #[test]
    fn codex_home_is_kept() {
        let mut cmd = inherited_cmd();
        child_env(&mut cmd, &[]);
        assert_eq!(cmd.get_env("CODEX_HOME"), Some(std::ffi::OsStr::new("C:/me/.codex")));
        assert_eq!(cmd.get_env("CLAUDE_CODE_GIT_BASH_PATH"), Some(std::ffi::OsStr::new("C:/Git/bin/bash.exe")));
    }
}
