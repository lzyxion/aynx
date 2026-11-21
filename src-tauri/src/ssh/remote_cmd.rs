//! 원격 셸에 흘려 넣는 첫 입력 글자 · tmux 질의 명령 조립 — 전부 순수 함수다.
//!
//! 불변식: 원격 셸로 가는 인자의 인용은 [`sh_quote`] 한 곳이 한다.

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// on_connect
// ---------------------------------------------------------------------------

/// 비었거나 공백뿐이면 보내지 않는다(`on_connect = ""` 로 상위 계층을 지우는 용법). 안쪽 개행은 그대로 둔다(여러 명령이 의도다).
///
/// 앱이 해석 · 이스케이프하지 않고 셸 입력 큐에 그대로 넣는다 — 화면에 에코되는 것이 의도다(앱이 몰래 실행하는 일이 없다는 것이 드러나야 한다).
/// 순서 계약: **셸 통합 스니펫 → 사용자 `on_connect`**([`crate::shell_integration::build_bootstrap`]) — 반대면 사용자가 셸을 바꿀 때(`exec` 등) 마커를 둘 다 놓친다.
pub(crate) fn prepare_on_connect(cmd: &str) -> Option<String> {
    if cmd.trim().is_empty() {
        return None;
    }
    if cmd.ends_with('\n') {
        Some(cmd.to_string())
    } else {
        Some(format!("{cmd}\n"))
    }
}

// ---------------------------------------------------------------------------
// tmux 로 접속
//
// tmux 줄이 `on_connect` · 셸 통합 스니펫의 자리를 대신한다(`exec tmux` 뒤에는 그 셸이 없다).
// passthrough(DCS 로 감싼 OSC 133)는 하지 않는다 — 정확성이 보장되지 않고, 반쯤 맞는 블록 이력은 AI 가 사실로 읽는다.
// 그래서 tmux 타일은 "화면만 있는 세션"(간이 모드)으로 표시된다(프런트 `PaneSpec.tmux` · MCP `mode`) (docs/verification/tmux.md).
// ---------------------------------------------------------------------------

/// 사람이 손으로 만든 세션과 섞이지 않게.
const TMUX_NAME_PREFIX: &str = "aynx-";

/// 앱이 만드는 이름의 모양 — 셸 안전의 자물쇠는 이것이 아니라 [`safe_tmux_target`] + [`sh_quote`] 다.
pub(crate) fn valid_tmux_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// 서버가 준 남의 세션 이름(공백 · 한글 · 따옴표)을 셸 명령에 넣어도 되는가 — 모양이 아니라 위험을 잠근다.
/// 개행을 막는 것이 핵심이다 — `'…'` 안에서도 개행은 **새 명령줄**이 되는 유일한 탈출구다. 넣을 때는 [`sh_quote`] 가 감싼다.
pub(crate) fn safe_tmux_target(name: &str) -> Option<&str> {
    let t = name.trim();
    (!t.is_empty() && t.len() <= 128 && !t.chars().any(char::is_control)).then_some(t)
}

/// POSIX sh 의 작은따옴표 인용.
pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// 이 앱의 살아 있는 다른 타일이 물고 있는 이름이면 `-D` 를 붙이지 않는다 — 떼어 낼 것이 낡은 클라이언트가 아니라 지금 사람이 보는 화면이다.
/// 거절하지 않고 `-A` 로 함께 본다 — 빼앗기는 것과 달리 함께 보는 것은 눈에 보이고 되돌릴 수 있다.
pub(crate) fn kick_stale_for_hint(hint: &str, taken: &[String]) -> bool {
    !taken.iter().any(|t| t == hint)
}

/// 빈 번호(구멍)를 먼저 메운다 — 사람이 `tmux ls` 로 보기에 맞다.
pub(crate) fn pick_tmux_name(taken: &[String]) -> String {
    for n in 1.. {
        let candidate = format!("{TMUX_NAME_PREFIX}{n}");
        if !taken.iter().any(|t| t == &candidate) {
            debug_assert!(
                valid_tmux_name(&candidate),
                "앱이 만든 tmux 이름이 자기 규칙을 어겼습니다: {candidate}"
            );
            return candidate;
        }
    }
    unreachable!("1.. 는 끝나지 않는다")
}

/// 서버에 이미 있는 세션 이름도 피한다 — 피하지 않으면 `new-session -A` 가 앱이 모르는 옛 세션에 붙어 `-c` · 시작 명령을 버린다.
/// 힌트가 온 재접속 · 복원은 이 함수를 지나지 않는다(같은 이름에 일부러 붙는다).
pub(crate) fn pick_new_tmux_name(app_taken: &[String], on_server: &[TmuxSessionInfo]) -> String {
    let mut taken = app_taken.to_vec();
    taken.extend(on_server.iter().map(|s| s.name.clone()));
    pick_tmux_name(&taken)
}

/// - `which` 가 아니라 `command -v` — `which` 는 없는 서버가 있다.
/// - `-D` 는 재접속(힌트가 온 경우)에만 — 새 이름에 붙이면 사람이 다른 곳에서 보던 화면을 말없이 빼앗는다.
/// - tmux 가 없는 서버는 `echo` 한 줄을 남기고 평범한 셸로 남는다 — 앱은 그것을 알 방법이 없어 사람이 화면에서 읽는다.
///
/// `name` 은 [`safe_tmux_target`] 을 통과한 값이어야 한다(호출부가 보장한다).
pub(crate) fn tmux_attach_command(name: &str, kick_stale_client: bool) -> String {
    tmux_attach_command_with_env(name, kick_stale_client, None)
}

/// - `export` 는 **tmux 세션의 자기 명령 안에** 선다 — 이미 떠 있던 tmux 서버는 새 클라이언트의 환경을 물려주지 않는다.
/// - `-A` 가 이미 있는 세션에 붙으면 그 명령은 무시된다 — 신호 파일 방식([`RemoteSignalEnv::in_file`])이면 앱이 접속마다 파일을 갈아 써
///   이미 돌던 CLI 도 다음 훅부터 새 주소 · 토큰을 탄다. 폴백(export)이면 옛 주소 · 토큰에 남는 한계가 그대로다.
/// - `env` 가 없으면 [`tmux_attach_command`] 와 글자 하나 다르지 않다.
pub(crate) fn tmux_attach_command_with_env(
    name: &str,
    kick_stale_client: bool,
    env: Option<&RemoteSignalEnv>,
) -> String {
    debug_assert!(
        safe_tmux_target(name).is_some(),
        "tmux 세션 이름이 잠금 규칙을 어겼습니다: {name}"
    );
    let detach = if kick_stale_client { " -D" } else { "" };
    let q = sh_quote(name);
    // **번역문도 [`sh_quote`] 를 지난다** — 따옴표 하나가 섞이면 줄이 깨진다.
    let missing = sh_quote(&tr!(
        ko: "[Aynx] tmux 가 없어 일반 셸로 남깁니다",
        en: "[Aynx] tmux is missing — keeping a plain shell"
    ));
    let titles = tmux_title_chain(&q);
    let Some(env) = env else {
        return format!(
            "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A{detach} -s {q}{titles} \
             || echo {missing}"
        );
    };
    let exports = signal_exports(env);
    let shell = crate::shell_integration::tmux_session_shell(env.agent_path);
    let inner = sh_quote(&format!("{exports}{shell}"));
    format!(
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A{detach} -s {q} {inner}{titles} \
         || {{ echo {missing}; {exports}}}"
    )
}

/// 제목 전달 체인 — tmux 는 안쪽 프로그램의 OSC 제목을 바깥으로 넘기지 않아, 없으면 tmux 안에서 띄운 `claude` 가 AI 타일로 보이지 않는다
/// (제목 갈래 — `src/lib/pane-identity.ts`). **세션 옵션**(`-t`, `-g` 아님)이라 사용자의 다른 세션 · `~/.tmux.conf` 는 건드리지 않는다. `q` 는 [`sh_quote`] 를 지난 이름.
fn tmux_title_chain(q: &str) -> String {
    format!(
        " \\; set-option -t {q} set-titles on \\; set-option -t {q} set-titles-string '#T'"
    )
}

/// `\r` — 사람이 친 엔터와 완전히 같은 바이트(로컬 `autorun` 과 같은 선택).
pub(crate) fn tmux_bootstrap(name: &str, kick_stale_client: bool) -> String {
    format!("{}\r", tmux_attach_command(name, kick_stale_client))
}

// ---------------------------------------------------------------------------
// 프로젝트로 연 타일의 첫 입력
//
// 프런트는 재료(경로 · 명령)만 보낸다. **1회용이다** — 첫 접속에만 실리고 재연결에는 실리지 않는다(로컬 `autorun` 과 같은 수명).
// ---------------------------------------------------------------------------

/// 명령이 비면 폴더로 들어가기만 한다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshStart {
    pub cwd: String,
    #[serde(default)]
    pub command: Option<String>,
    /// 있으면 `cwd` 는 만들 워크트리의 폴더다 — 첫 입력이 아니라 접속한 뒤 · 첫 입력 전에 exec 로 만든다([`crate::remote_worktree::prepare`]).
    /// 1회용 — 재접속 힌트(`tmux_name`)가 오면 Rust 도 무시한다.
    #[serde(default)]
    pub worktree: Option<SshWorktree>,
    /// 프런트는 스크립트 글자를 싣지 않는다 — id 와 끝 신호 값뿐(스크립트는 `projects.json` 에서 읽는다). 1회용(`worktree` 와 같다).
    #[serde(default)]
    pub setup: Option<SshSetup>,
    /// 프런트가 싣지 않는다(`serde(skip)`) — 서버의 열기가 원격 포워드를 세운 뒤 채운다.
    #[serde(skip)]
    pub signal_env: Option<RemoteSignalEnv>,
}

/// **MCP 토큰은 여기 없다** — 원격에는 신호 전용 토큰만 간다(`crate::agent_signal` 머리말).
/// `Debug` 는 손으로 짓는다 — 토큰을 가린다.
#[derive(Clone)]
pub struct RemoteSignalEnv {
    /// 서버 루프백의 원격 포워드.
    pub url: String,
    pub token: String,
    pub stream: String,
    /// 로컬 타일의 표식(`crate::pty`)과 같은 값 · 같은 규칙이다.
    pub codex_no_daemon: bool,
    /// 주소 · 토큰을 서버의 신호 파일(0600)에 썼는가 — 참이면 셸에는 **스트림 id(와 비밀 아닌 표식)만** export 한다.
    /// 신호를 세우지 않은 타일(에이전트 활성화만 — 주소 · 토큰이 비었다)도 참이다.
    pub in_file: bool,
    /// PATH 심 폴더 — 비밀이 아니다.
    pub agent_path: bool,
}

impl std::fmt::Debug for RemoteSignalEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RemoteSignalEnv")
            .field("url", &self.url)
            .field("token", &"<redacted>")
            .field("stream", &self.stream)
            .field("codex_no_daemon", &self.codex_no_daemon)
            .field("in_file", &self.in_file)
            .field("agent_path", &self.agent_path)
            .finish()
    }
}

/// 끝이 `; ` 라 뒤의 명령과 한 줄로 잇는다. 신호 파일 방식이면 **스트림 id 만** 싣는다 — 토큰 · 포트가 tmux 명령 문자열(`ps`) · 화면 · 이력에 남지 않는다.
pub(crate) fn signal_exports(env: &RemoteSignalEnv) -> String {
    let path = if env.agent_path {
        format!(" {}", crate::agent_shim::PATH_EXPORT)
    } else {
        String::new()
    };
    let no_daemon = if env.codex_no_daemon {
        format!(" {}=1", crate::tile_env::NO_DAEMON_ENV)
    } else {
        String::new()
    };
    if env.in_file {
        return format!(
            "export {}={}{path}{no_daemon}; ",
            crate::tile_env::STREAM_ENV,
            sh_quote(&env.stream),
        );
    }
    format!(
        "export {}={} {}={} {}={}{path}{no_daemon}; ",
        crate::tile_env::MCP_URL_ENV,
        sh_quote(&env.url),
        crate::tile_env::SIGNAL_TOKEN_ENV,
        sh_quote(&env.token),
        crate::tile_env::STREAM_ENV,
        sh_quote(&env.stream),
    )
}

/// 사용자 `on_connect` **앞에** 선다. 앞 공백은 `HISTCONTROL=ignorespace` 셸의 이력에 이 줄을 남기지 않게 한다.
/// 타이핑한 줄의 에코는 출력 경로의 [`crate::shell_integration::EchoFilter`] 가 지운다([`signal_echo_needle`]).
pub(crate) fn signal_export_line(env: &RemoteSignalEnv) -> String {
    format!(" {}\n", signal_exports(env).trim_end().trim_end_matches(';'))
}

/// 신호 환경이 타이핑 없이 셸 통합 exec 런처를 탈 수 있는가.
/// - `Exec` 계획은 로그인 셸이 bash 라고 이미 확인한 길이라 런처 **바깥**에 작은따옴표째 `export` 를 둬도 된다(안쪽 "작은따옴표 없음" 규칙은 fish · csh 용).
/// - **비밀이 없어야 한다**([`RemoteSignalEnv::in_file`]) — exec 명령은 짧게나마 서버의 `ps` 에 보인다(다른 계정에게도).
pub(crate) fn signal_rides_launcher(
    plan: crate::shell_integration::BootstrapPlan,
    env: &RemoteSignalEnv,
) -> bool {
    plan == crate::shell_integration::BootstrapPlan::Exec && env.in_file
}

/// [`signal_rides_launcher`] 가 참일 때만 쓴다. 프로필이 `PATH` 를 갈아 써도 rc 의 꼬리(`crate::agent_shim::RC_SHIM_FRONT`)가 심 폴더를 다시 맨 앞에 세운다.
pub(crate) fn exec_launcher_with_signal(env: &RemoteSignalEnv) -> String {
    format!(
        "{}{}",
        signal_exports(env),
        crate::shell_integration::exec_launcher()
    )
}

pub(crate) fn typed_signal_line(
    plan: crate::shell_integration::BootstrapPlan,
    env: Option<&RemoteSignalEnv>,
) -> Option<String> {
    env.filter(|e| !signal_rides_launcher(plan, e))
        .map(signal_export_line)
}

/// 앞 공백을 뗀다 — 바늘이 공백으로 시작하면 프롬프트 끝의 공백이 부분 일치로 붙들려 다음 출력까지 화면에 늦게 선다.
pub(crate) fn signal_echo_needle(line: &str) -> &str {
    line.trim_matches(|c: char| c == ' ' || c == '\n')
}

/// `nonce` 는 끝 신호(OSC 7717)에 실릴 값.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSetup {
    pub project_id: String,
    pub nonce: String,
}

/// `ticket` — 접속이 서기 전이라 세션 번호가 없어, 준비 이벤트(`ssh-worktree-prep`)와 답(`ssh_worktree_answer`)이 이 글자로 그 타일을 가리킨다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshWorktree {
    pub repo: String,
    pub name: String,
    #[serde(default)]
    pub ticket: String,
}

/// `~` 는 따옴표 안에서 펴지지 않으므로 앞의 `~` 만 `"$HOME"` 으로 바꾸고 나머지를 인용한다(펴는 일은 바깥 셸이 한 번 한다).
pub(crate) fn sh_path(path: &str) -> String {
    if path == "~" {
        "\"$HOME\"".to_string()
    } else if let Some(rest) = path.strip_prefix("~/") {
        format!("\"$HOME\"/{}", sh_quote(rest))
    } else {
        sh_quote(path)
    }
}

/// 제어문자(개행 포함)가 있으면 버린다 — 개행은 인용 안에서도 **새 명령줄**이 된다. 워크트리는 이미 만들어졌다(첫 입력에 git 명령이 없다).
fn start_parts(start: &SshStart) -> Option<(String, Option<&str>)> {
    let cwd = start.cwd.trim();
    let cmd = start
        .command
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty());
    if cwd.is_empty() || cwd.chars().any(char::is_control) {
        return None;
    }
    if cmd.is_some_and(|c| c.chars().any(char::is_control)) {
        return None;
    }
    Some((sh_path(cwd), cmd))
}

/// 프로젝트 타일은 프로젝트의 토글 하나가 정한다(호스트 tmux 와 AND 하지 않는다) · 둘 다 참이면 `no_tmux` 가 이긴다(모르면 끄는 편이 안전하다).
pub(crate) fn use_tmux_for(host_tmux: Option<bool>, no_tmux: bool, force_tmux: bool) -> bool {
    if no_tmux {
        return false;
    }
    force_tmux || host_tmux.unwrap_or(false)
}

/// 명령은 **인용하지 않는다** — 사람이 폼에 적은 한 줄이 그대로 셸에 가야 한다(`on_connect` 와 같은 대접).
pub(crate) fn project_start_line(start: &SshStart) -> Option<String> {
    let (dir, cmd) = start_parts(start)?;
    let env = start
        .signal_env
        .as_ref()
        .map(signal_exports)
        .unwrap_or_default();
    Some(match cmd {
        Some(c) => format!("{env}cd -- {dir} && {c}\n"),
        None => format!("{env}cd -- {dir}\n"),
    })
}

/// - 명령은 tmux 세션의 **자기 명령**으로 돈다(SSH 가 끊겨도 계속 간다). 뒤의 셸은 명령이 끝난 창을 이어 받는다 — 없으면 claude 를 빠져나오는 순간 세션 · 타일이 끝난다.
/// - `-A` 라 같은 이름의 세션이 이미 있으면 `-c` · 명령은 무시된다 — 서버 목록을 묻지 못했을 때(시한 · exec 거절)만 남는 한계다.
/// - 신호 `export` 는 **tmux 명령 문자열 안에** 넣는다 — 바깥 셸에서 하면 tmux 서버가 먼저 떠 있던 호스트에서 조용히 빠진다.
pub(crate) fn tmux_attach_command_with_start(
    name: &str,
    kick_stale_client: bool,
    start: &SshStart,
) -> String {
    let Some((dir, cmd)) = start_parts(start) else {
        return tmux_attach_command(name, kick_stale_client);
    };
    let detach = if kick_stale_client { " -D" } else { "" };
    let q = sh_quote(name);
    let missing = sh_quote(&tr!(
        ko: "[Aynx] tmux 가 없어 일반 셸로 남깁니다",
        en: "[Aynx] tmux is missing — keeping a plain shell"
    ));
    let env = start
        .signal_env
        .as_ref()
        .map(signal_exports)
        .unwrap_or_default();
    let agent = start.signal_env.as_ref().is_some_and(|e| e.agent_path);
    let shell = crate::shell_integration::tmux_session_shell(agent);
    let (inner, fallback) = match cmd {
        Some(c) => (
            format!(
                " {}",
                sh_quote(&format!("{env}{c}; {shell}"))
            ),
            format!("{env}cd -- {dir} && {c}"),
        ),
        None if !env.is_empty() => (
            format!(
                " {}",
                sh_quote(&format!("{env}{shell}"))
            ),
            format!("{env}cd -- {dir}"),
        ),
        None => (String::new(), format!("cd -- {dir}")),
    };
    // 제목 전달 체인은 세션 명령(`{inner}`) **뒤에** 선다 — 그 앞이면 tmux 가 `\;` 를 새 세션의 명령으로 읽는다.
    let titles = tmux_title_chain(&q);
    format!(
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A{detach} -s {q} -c {dir}{inner}{titles} \
         || {{ echo {missing}; {fallback}; }}"
    )
}

/// tmux 타일에는 OSC 7 이 없어(간이 모드) 이것이 폴더를 아는 유일한 길이다.
pub(crate) fn tmux_cwd_command(name: &str) -> String {
    debug_assert!(
        safe_tmux_target(name).is_some(),
        "tmux 세션 이름이 잠금 규칙을 어겼습니다: {name}"
    );
    format!(
        "tmux display -p -t {} '#{{pane_current_path}}'",
        sh_quote(name)
    )
}

/// `ssh_tmux_kill` 의 문 — 끄기는 되돌릴 수 없어 [`safe_tmux_target`] 보다 **좁게** 모양까지 잠근다.
/// 다듬지 않는다(목록이 준 이름과 글자 그대로 같아야 한다) · `*?`(fnmatch) · `:` `.`(창 · 패널 구분)도 빠진다 — 그런 세션은 사람이 셸에서 끈다.
pub(crate) fn killable_tmux_name(name: &str) -> Option<&str> {
    const EXTRA: &str = " -_+@%,~#!^&()[]{}";
    let ok = !name.is_empty()
        && name.chars().count() <= 128
        && name.trim() == name
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || EXTRA.contains(c));
    ok.then_some(name)
}

/// `=` 접두는 tmux 대상의 **정확 일치**다 — 없으면 앞부분이 맞는 세션(`work` → `work-old`)이나 fnmatch 무늬로 엉뚱한 세션을 끈다.
pub(crate) fn tmux_kill_command(name: &str) -> String {
    debug_assert!(
        killable_tmux_name(name).is_some(),
        "끌 수 없는 tmux 세션 이름입니다: {name}"
    );
    format!("tmux kill-session -t {}", sh_quote(&format!("={name}")))
}

/// 기본 출력은 tmux 버전 · 로캘에 따라 달라지는 문장이라 파싱하지 않는다 — `-F` 는 우리가 모양을 정하는 계약이다.
const TMUX_LIST_FORMAT: &str =
    "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}";

pub(crate) fn tmux_list_command() -> String {
    format!("tmux ls -F '{TMUX_LIST_FORMAT}'")
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct TmuxSessionInfo {
    /// 서버가 준 값 그대로 — 공백 · 한글이 들어올 수 있다.
    pub name: String,
    pub windows: u32,
    pub attached: u32,
    /// Unix epoch 초.
    pub created: i64,
}

/// **뒤에서부터** 자른다 — 세션 이름에는 `|` 가 들어갈 수 있다. 망가진 줄(서버 rc 배너 · 경고)은 조용히 건너뛴다.
pub(crate) fn parse_tmux_list(stdout: &str) -> Vec<TmuxSessionInfo> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.rsplitn(4, '|');
        let (Some(created), Some(attached), Some(windows), Some(name)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (Ok(created), Ok(attached), Ok(windows)) = (
            created.trim().parse::<i64>(),
            attached.trim().parse::<u32>(),
            windows.trim().parse::<u32>(),
        ) else {
            continue;
        };
        // 제어문자는 여기서 떨군다 — 프런트가 그 이름을 셸 명령(`switch-client -t …`)에 싣는다.
        let Some(name) = safe_tmux_target(name) else {
            continue;
        };
        out.push(TmuxSessionInfo {
            name: name.to_string(),
            windows,
            attached,
            created,
        });
    }
    out
}
