//! 원격 셸에 흘려 넣는 **첫 입력 글자** 조립 — `on_connect`, tmux 이름·부트스트랩·질의 명령,
//! 프로젝트 시작 줄, 신호 환경 export, 인용([`sh_quote`]). 전부 순수 함수다.
//!
//! 불변식: 원격 셸로 가는 인자의 인용은 [`sh_quote`] 한 곳이 한다.

use crate::i18n::tr;

// ---------------------------------------------------------------------------
// on_connect (접속 후 실행 명령)
// ---------------------------------------------------------------------------

/// `sessions.toml` 의 `on_connect` 를 **실제로 보낼 문자열**로 다듬는다.
/// 보낼 것이 없으면 `None`.
///
/// 규칙은 둘뿐이다.
/// - 비었거나 공백뿐이면 보내지 않는다 (`on_connect = ""` 로 상위 계층을 지우는 용법).
/// - 안쪽 개행은 **그대로 둔다** (여러 줄이면 셸이 여러 명령으로 읽는 것이 의도다).
///   끝에 개행이 없을 때만 하나 붙인다 — 붙이지 않으면 명령이 입력 줄에 걸린 채 실행되지 않는다.
///
/// 이 문자열은 셸의 **입력 큐에 그대로 들어간다** — 앱이 해석하거나 이스케이프하지 않는다
/// (사용자가 자기 파일에 적은 것을 자기 셸이 읽는 관계라 중간에서 손대면 오히려 놀란다).
/// 셸이 에코하므로 사용자 화면에 명령이 보이는데, 이는 **의도된 동작**이다 — 앱이 몰래
/// 무언가를 실행하는 일이 없다는 것이 화면에 그대로 드러나야 한다.
///
/// **①스니펫 → ②사용자 `on_connect`** 순서 계약 (5단계에서 실현 —
/// [`crate::shell_integration::build_bootstrap`], docs/log/2026-09-02-osc133.md).
/// 스니펫이 먼저 서야 사용자 명령의 시작·끝이 마커로 잡히고, 사용자가 `on_connect` 에서
/// 셸 상태를 바꿔도(`exec`·`tmux attach` 등) 스니펫은 이미 적용된 뒤다. 반대 순서면 둘 다
/// 놓친다. 이 함수는 그 계약의 ②를 다듬을 뿐이고, 실제 조립은 `build_bootstrap` 이 한다.
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
// tmux 로 접속 (호스트별 토글 — docs/log/2026-09-16-tmux-toggle.md)
//
// `sessions.toml` 의 `tmux = true` 인 호스트는 셸 대신 **tmux 세션에 붙는다**. 앱이 하는 일은
// 첫 입력 한 줄을 조립하는 것뿐이고, 그 줄이 `on_connect`·셸 통합 스니펫의 **자리를 대신
// 차지한다** (셋을 같은 입력 큐에 섞어 넣을 수 없다 — `exec tmux` 뒤에는 그 셸이 없다).
//
// **passthrough 는 하지 않는다.** tmux 안에서 OSC 133 마커를 살리려면 DCS 로 감싸야 하는데
// (docs/verification/tmux.md), 그 정확성이 tmux 버전·`allow-passthrough` 값·재접속 재그리기에
// 걸려 **보장되지 않는다**. 반쯤 맞는 블록 이력은 없는 것보다 나쁘다 — AI 가 그것을 사실로
// 읽는다. 그래서 tmux 타일은 정직하게 **"화면만 있는 세션"**(간이 모드)이고, 블록에 기대는
// 기능은 조용히 깨지는 대신 **꺼진 것으로 표시된다** (프런트 `PaneSpec.tmux` · MCP `mode`).
// ---------------------------------------------------------------------------

/// 앱이 만드는 tmux 세션 이름의 접두사. 사람이 자기 손으로 만든 세션과 섞이지 않게 한다.
const TMUX_NAME_PREFIX: &str = "aynx-";

/// **앱이 만드는 이름의 모양** — `[A-Za-z0-9-]` 만, 비어 있지 않게.
///
/// 셸 안전의 자물쇠였던 자리는 [`safe_tmux_target`] + [`sh_quote`] 로 옮겼다(목록에서 고른
/// **남의 세션 이름**에는 공백·한글이 들어 있다). 남은 뜻은 하나다: [`pick_tmux_name`] 이
/// 내놓는 이름이 앱 자신의 규칙 안에 있는가 — 접두사를 바꾸는 사람이 그 자리에서 걸린다.
pub(crate) fn valid_tmux_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// 셸 명령에 **서버가 준 이름**을 넣어도 되는가 — 통과하면 다듬은 이름을 돌려준다
/// (docs/log/2026-09-16-tmux-toggle.md · 세션 목록/전환).
///
/// [`valid_tmux_name`] 은 **앱이 만든 이름**의 모양(`aynx-N`)을 지키는 자물쇠다. 그런데 세션
/// 목록에서 고른 이름은 **서버에 있던 남의 세션**일 수 있어 공백·한글·따옴표가 들어온다.
/// 그것까지 `aynx-N` 규칙으로 막으면 "목록에서 골랐는데 아무 일도 안 난다" 가 된다.
///
/// 그래서 잠그는 것을 **모양이 아니라 위험**으로 바꾼다: 제어문자(개행 포함)가 하나도 없고
/// 비어 있지 않으면 통과시키고, 셸에 넣을 때는 [`sh_quote`] 가 감싼다. 개행을 막는 것이
/// 핵심이다 — `'…'` 안에서도 개행은 **새 명령줄**이 되는 유일한 탈출구다.
pub(crate) fn safe_tmux_target(name: &str) -> Option<&str> {
    let t = name.trim();
    (!t.is_empty() && t.len() <= 128 && !t.chars().any(char::is_control)).then_some(t)
}

/// POSIX sh 의 작은따옴표 인용 — **순수 함수**(테스트 대상).
///
/// `'` 하나를 `'\''`(따옴표 닫기 · 이스케이프된 따옴표 · 다시 열기)로 바꾸고 전체를 `'…'` 로
/// 감싼다. 작은따옴표 안에서는 `$`·백틱·백슬래시가 전부 글자라, 이 한 가지 치환만 제대로
/// 하면 **어떤 바이트열도 한 낱말**로 들어간다.
pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// 힌트로 붙을 때 `-D`(낡은 클라이언트 떼어 내기)를 붙일 것인가 — **순수 함수**(테스트 대상).
///
/// 규칙 하나: **이 앱이 지금 물고 있는 이름이면 붙이지 않는다.** `-D` 의 존재 이유는 "끊긴
/// 이쪽의 낡은 클라이언트" 를 떼어 크기를 맞추는 것인데, 그 이름을 살아 있는 다른 타일이
/// 물고 있다면 떼어 낼 대상은 낡은 클라이언트가 아니라 **지금 사람이 보고 있는 화면**이다.
///
/// 그때는 `-A` 만으로 붙어 **두 타일이 같은 화면을 함께 본다**(tmux 의 기본 동작 — 크기는
/// 작은 쪽에 맞춰진다). 거절하지 않는 이유: 거절은 "왜 안 되는지" 를 한 번 더 설명해야 하고,
/// 빼앗기는 것과 달리 **함께 보는 것은 눈에 보이고 되돌릴 수 있다**(한쪽 타일을 닫으면 끝).
pub(crate) fn kick_stale_for_hint(hint: &str, taken: &[String]) -> bool {
    !taken.iter().any(|t| t == hint)
}

/// 이 호스트에서 아직 쓰이지 않은 가장 작은 `aynx-N` — **순수 함수**(테스트 대상).
///
/// `taken` 은 **같은 별칭**의 살아 있는 세션들이 물고 있는 이름이다. 빈 번호(구멍)를 먼저
/// 메운다: 타일 셋을 열었다가 가운데를 닫으면 다음 타일이 `aynx-4` 가 아니라 `aynx-2` 를
/// 되찾는 편이 사람이 `tmux ls` 로 보기에 맞다.
pub(crate) fn pick_tmux_name(taken: &[String]) -> String {
    for n in 1.. {
        let candidate = format!("{TMUX_NAME_PREFIX}{n}");
        if !taken.iter().any(|t| t == &candidate) {
            // 앱이 만드는 이름은 앱 자신의 모양 안에 있어야 한다 — 접두사를 건드리면 여기서 걸린다.
            debug_assert!(
                valid_tmux_name(&candidate),
                "앱이 만든 tmux 이름이 자기 규칙을 어겼습니다: {candidate}"
            );
            return candidate;
        }
    }
    unreachable!("1.. 는 끝나지 않는다")
}

/// **새 타일**의 tmux 이름 — 이 앱이 물고 있는 이름(`app_taken`)과 **서버에 이미 있는 세션**(`on_server` —
/// `tmux ls` 의 [`parse_tmux_list`]) 둘 다 피한다(**순수 함수**). 서버의 이름을 피하지 않으면 `new-session -A` 가 앱이
/// 모르는 옛 세션에 붙어 `-c` · 시작 명령을 버린다(2026-09-29 — docs/log/2026-09-28-project-agent-setup-script.md).
/// 힌트가 온 재접속 · 복원은 이 함수를 지나지 않는다(같은 이름에 일부러 붙는다).
pub(crate) fn pick_new_tmux_name(app_taken: &[String], on_server: &[TmuxSessionInfo]) -> String {
    let mut taken = app_taken.to_vec();
    taken.extend(on_server.iter().map(|s| s.name.clone()));
    pick_tmux_name(&taken)
}

/// 셸이 서자마자 보낼 **한 줄** — **순수 함수**(테스트 대상).
///
/// ```sh
/// command -v tmux >/dev/null 2>&1 && exec tmux new-session -A [-D] -s 'aynx-1' \; set-option … || echo '[aynx] …'
/// ```
///
/// - `command -v` 는 POSIX sh 내장이라 bash·zsh·dash·ksh 어디서나 같다 (`which` 는 없는 서버가 있다).
/// - `new-session -A` = "있으면 붙고 없으면 만든다" (tmux 1.8+). `-D` 는 **그 세션에 붙어 있던
///   낡은 클라이언트를 떼어 낸다** — 재접속(힌트가 온 경우)에만 붙인다. 새 이름을 고르는
///   경우에는 붙일 클라이언트가 애초에 없고, 붙이면 사람이 다른 곳에서 보고 있던 화면을
///   말없이 빼앗는다.
/// - `exec` 라 tmux 가 끝나면 그 셸도 끝난다 = 타일이 정상 종료(`exit`)로 닫힌다.
/// - **tmux 가 없는 서버**는 `echo` 한 줄만 남기고 **평범한 셸로 남는다**. 앱은 그것을 알
///   방법이 없다(우리가 보내는 것은 입력뿐이고 결과는 화면에만 있다) — 그래서 그 줄을
///   신호로 남겨 두고, 사용자가 화면에서 읽는다.
/// - 뒤의 `\; set-option …` 은 안쪽 프로그램의 창 제목을 바깥으로 넘기는 체인이다([`tmux_title_chain`]).
///
/// `name` 은 [`safe_tmux_target`] 을 통과한 값이어야 한다(호출부가 보장한다 — 디버그 빌드에서는
/// `debug_assert` 로 잡힌다). 앱이 만든 `aynx-N` 이든 목록에서 고른 남의 세션이든 셸에 넣는
/// 자리는 [`sh_quote`] 하나뿐이다.
pub(crate) fn tmux_attach_command(name: &str, kick_stale_client: bool) -> String {
    tmux_attach_command_with_env(name, kick_stale_client, None)
}

/// [`tmux_attach_command`] 에 **신호 환경**을 얹은 것 (**순수 함수**) — 시작 명령이 없는 원격 타일(평범한 셸 ·
/// 재접속)이 호스트 AI 권한(읽기 전용 이상)으로 신호를 받을 때(docs/log/2026-10-08-remote-signals-by-permission.md).
///
/// - `export` 는 [`tmux_attach_command_with_start`] 와 같은 까닭으로 **tmux 세션의 자기 명령 안에** 선다 —
///   `'export …; exec "${SHELL:-/bin/sh}" -l'`. 이미 떠 있던 tmux 서버는 새 클라이언트의 환경을 물려주지 않는다.
/// - 그 `exec` 자리는 [`crate::shell_integration::tmux_session_shell`] 이다(2026-10-08) — 서버에 셸 통합 rc 가 있고
///   로그인 셸이 bash 면 `exec "$SHELL" --rcfile "$HOME/.aynx/rc" -i`(tmux 안에도 셸 통합 · 손으로 친 `codex` 의
///   `--no-daemon` 감싸개), 아니면 위 그대로. 판정은 서버의 셸이 한다.
/// - `-A` 가 **이미 있는 세션에 붙으면**(재접속 · 목록에서 고른 세션) 그 명령은 무시된다 — 그래도 신호 파일 방식
///   ([`RemoteSignalEnv::in_file`])이면 그 안의 셸은 같은 스트림 id 를 쥐고 있고 앱이 접속마다 파일을 갈아 쓰므로, 이미 돌던
///   CLI 도 다음 훅부터 새 주소·새 토큰을 탄다(09-24 기록 7절의 한계 해소 — 2026-10-08 ①b). 폴백(export)이면 옛 한계 그대로.
/// - tmux 가 없는 서버의 폴백 갈래(평범한 셸로 남는다)에도 같은 `export` 가 선다.
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
    // 사람이 읽는 줄이라 언어를 따라간다. **번역문도 [`sh_quote`] 를 지난다** — 셸에 그대로
    // 들어가는 자리라 따옴표 하나가 섞이면 줄이 깨진다(리터럴을 믿지 않는다).
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

/// `new-session` 뒤에 잇는 **제목 전달** 체인 — **순수 함수**(테스트 대상). `q` 는 [`sh_quote`] 를 지난 세션 이름.
///
/// ```sh
///  \; set-option -t 'aynx-1' set-titles on \; set-option -t 'aynx-1' set-titles-string '#T'
/// ```
///
/// - 왜: tmux 는 안쪽 프로그램의 OSC 제목을 바깥 터미널로 넘기지 않는다 — 그래서 tmux 안에서 손으로 띄운
///   `claude` 가 AI 타일로 보이지 않았다(제목 갈래 — `src/lib/pane-identity.ts`). `set-titles on` +
///   `set-titles-string '#T'` 이면 tmux 가 활성 패널의 제목을 그대로 바깥으로 보낸다(2026-10-07 사용자 실측).
/// - **세션 옵션**(`-t <세션>`, `-g` 아님) — 앱이 연/붙은 그 세션에만 걸리고 사용자의 다른 tmux 세션·
///   `~/.tmux.conf` 는 건드리지 않는다. 늘 건다(설정 없음 — 2026-10-07 사용자 결정).
/// - `\;` 는 바깥 셸이 `;` 낱말 하나로 넘기고, tmux 가 그것을 **명령 구분자**로 읽는다. `new-session -A` 가
///   이미 있는 세션에 **붙는** 경우에도(attach-session 과 같다) 체인의 뒤 명령은 이어서 돈다 — 그래서 새로
///   만들 때와 붙을 때가 같은 한 줄이다.
/// - `'#T'` 는 작은따옴표 안이라 바깥 셸이 건드리지 않는다(`#` 주석이 아니다).
fn tmux_title_chain(q: &str) -> String {
    format!(
        " \\; set-option -t {q} set-titles on \\; set-option -t {q} set-titles-string '#T'"
    )
}

/// 실제로 입력 큐에 넣는 문자열 — 조립한 줄 + `\r`(엔터).
///
/// `\r` 인 이유: PTY 입력에서 엔터 키가 보내는 바이트가 `\r` 이다(`on_connect` 의 `\n` 도
/// 줄 규율의 `ICRNL` 덕에 같이 동작하지만, 사람이 친 것과 **완전히 같은** 바이트를 보내는
/// 편이 놀랄 자리가 없다 — 로컬 `autorun` 도 같은 선택이다).
pub(crate) fn tmux_bootstrap(name: &str, kick_stale_client: bool) -> String {
    format!("{}\r", tmux_attach_command(name, kick_stale_client))
}

// ---------------------------------------------------------------------------
// 프로젝트로 연 타일의 첫 입력 (docs/log/2026-09-24-projects.md)
//
// 원격 프로젝트를 "열면" SSH 타일이 그 서버의 저장소 폴더에서 시작 명령(`claude` …)을 한 번
// 돌린다. 그 한 줄을 **여기서** 조립하는 이유는 첫 입력의 주인이 이미 여기이기 때문이다 —
// `on_connect`·셸 통합 스니펫·tmux 부트스트랩이 전부 이 파일에서 한 줄로 합쳐진다. 프런트는
// 재료(경로·명령)만 보내고 인용은 [`sh_quote`] 한 곳이 한다.
//
// **1회용이다** — 프런트(`Terminal.svelte`)는 타일의 **첫 접속**에만 이 값을 싣고, 재연결에는
// 싣지 않는다(로컬 `autorun` 과 같은 수명). tmux 타일의 재연결은 힌트로 같은 세션에 다시 붙으므로
// 에이전트는 그 안에서 그대로 돌고 있다 — 그것이 tmux 에 올리는 이유다.
// ---------------------------------------------------------------------------

/// 프로젝트 타일의 **첫 입력 재료** — 폴더와 시작 명령. 명령이 비면 폴더로 들어가기만 한다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshStart {
    pub cwd: String,
    #[serde(default)]
    pub command: Option<String>,
    /// **새 워크트리에서 열기**(docs/log/2026-09-24-worktrees.md) — 있으면 `cwd` 는 만들 워크트리의
    /// 폴더다. 워크트리는 첫 입력이 아니라 **접속한 뒤 · 첫 입력 전에 앱이 이 전송로의 exec 로** 만든다
    /// ([`crate::remote_worktree::prepare`] — 2026-09-29 B안, docs/log/2026-09-29-remote-worktree-after-connect.md).
    /// 1회용 — 프런트가 첫 접속에만 싣고, 재접속 힌트(`tmux_name`)가 오면 Rust 도 무시한다.
    #[serde(default)]
    pub worktree: Option<SshWorktree>,
    /// **설정 스크립트**(docs/log/2026-09-28-project-agent-setup-script.md) — 있으면 첫 접속이 선 뒤 이 프로젝트의
    /// 스크립트를 `projects.json` 에서 읽어 서버 임시 파일에 exec 로 써 두고 명령 자리를 `sh <파일> && <명령>` 으로
    /// 바꾼다(쓰지 못하면 `sh -c '<스크립트>' && <명령>`)
    /// ([`crate::setup_script::remote_start_command`]). 프런트는 스크립트 글자를 싣지 않는다 — id 와 끝 신호 값뿐.
    /// 1회용(`worktree` 와 같다).
    #[serde(default)]
    pub setup: Option<SshSetup>,
    /// **에이전트 신호 환경** — 프런트가 싣지 않는다(`serde(skip)`). 원격 AI 타일이면
    /// [`open_ssh_session`](super::open::open_ssh_session) 이 원격 포워드를 세운 뒤 채워 넣고, 첫 입력의 명령 앞에 `export` 로 붙는다
    /// ([`signal_exports`] · docs/log/2026-09-24-remote-agent-signals.md).
    #[serde(skip)]
    pub signal_env: Option<RemoteSignalEnv>,
}

/// 원격 셸에 심는 신호 환경 셋 — 서버 쪽 포워드 주소 · **신호 전용 토큰** · 스트림 id.
///
/// **MCP 토큰은 여기 없다** — 원격에는 신호 전용 토큰만 간다(CLAUDE.md 보안 제약 ·
/// `crate::agent_signal` 머리말). `Debug` 는 손으로 짓는다 — 토큰을 가린다.
#[derive(Clone)]
pub struct RemoteSignalEnv {
    /// `http://127.0.0.1:<서버가 고른 포트>` — 서버 루프백의 원격 포워드.
    pub url: String,
    pub token: String,
    pub stream: String,
    /// 설정 `[ai] codex_no_daemon`(기본 켬) — 참이면 `AYNX_CODEX_NO_DAEMON=1` 도 싣는다. 서버 셸 통합의
    /// `codex` 감싸개(`crate::shell_integration::SNIPPET`)가 이 표식을 보고 손으로 친 `codex` 를 `--no-daemon` 으로
    /// 감싼다 — 로컬 타일의 표식(`crate::pty`)과 같은 값 · 같은 규칙(docs/log/2026-09-26-codex-hooks.md "다시 켬").
    pub codex_no_daemon: bool,
    /// 주소·토큰을 서버의 신호 파일(`~/.config/aynx/signal/<스트림>.env`, 0600)에 썼는가 — 참이면 셸에는
    /// **스트림 id(와 codex 표식)만** export 한다([`signal_exports`] · `crate::remote_signal_file` · 2026-10-08 ①b).
    /// 거짓(셸 통합 끔 · SFTP 실패)이면 예전처럼 셋 다 export 한다. **신호를 세우지 않은 타일**(에이전트 활성화만 —
    /// 주소·토큰이 비었다)도 참이다 — 셸에 싣는 것은 스트림 id 와 PATH 뿐이다.
    pub in_file: bool,
    /// **에이전트 활성화**(2026-10-26 — `crate::sessions_meta::HostMeta::agent`) — 참이면 PATH 심 폴더를 앞에 더한다
    /// (`crate::agent_shim::PATH_EXPORT` — 비밀이 아니다).
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

/// 신호 환경의 `export` 머리 — 끝이 `; ` 라 뒤의 명령과 한 줄로 잇는다(**순수 함수**). 값은 셋 다
/// [`sh_quote`] 를 지난다. `codex_no_daemon` 이면 끝에 `AYNX_CODEX_NO_DAEMON=1` 이 붙는다.
///
/// 주소·토큰을 서버 파일에 썼으면([`RemoteSignalEnv::in_file`] — 2026-10-08 ①b) **스트림 id 만** 싣는다 — 토큰·포트가
/// tmux 명령 문자열(`ps`)·화면·이력에 남지 않고, 훅(9판)은 그 파일에서 읽는다(재접속하면 파일만 바뀐다):
///
/// ```sh
/// export AYNX_STREAM='…' AYNX_CODEX_NO_DAEMON=1;
/// ```
///
/// 파일을 못 썼으면(폴백) 예전 그대로 셋:
///
/// ```sh
/// export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='…' AYNX_STREAM='…' AYNX_CODEX_NO_DAEMON=1;
/// ```
///
/// 에이전트 활성화([`RemoteSignalEnv::agent_path`])면 스트림 뒤에 `PATH="$HOME/.config/aynx/bin:$PATH"` 가 선다 — 손으로 친
/// `claude` · `codex` 가 PATH 심(`crate::agent_shim`)을 지난다.
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

/// 시작 명령이 없는 tmux 아닌 원격 타일(평범한 셸 · 재접속)의 **신호 환경 한 줄** (**순수 함수**) — 사용자
/// `on_connect` **앞에** 선다(그 뒤의 명령과, 사람이 그 셸에서 띄울 에이전트가 물려받는다). 앞 공백은
/// `HISTCONTROL=ignorespace`(배포판 bash 기본 `ignoreboth`) 셸의 이력에 이 줄을 남기지 않게 한다.
///
/// **화면에는 남기지 않는다**(2026-10-27 — 10-08 의 "화면에는 찍힌다" 를 바꿈). 셸 통합 exec 런처로 뜨는 bash 는
/// 이 줄을 아예 타이핑하지 않고 런처 앞에 싣는다([`signal_rides_launcher`] · [`exec_launcher_with_signal`]). 그 밖의 길
/// (zsh · fish · 셸 통합 끔 · SFTP 실패 · 비밀이 든 폴백)만 이 줄을 타이핑하고, 그 에코는 출력 경로의
/// [`crate::shell_integration::EchoFilter`] 가 지운다([`signal_echo_needle`]).
pub(crate) fn signal_export_line(env: &RemoteSignalEnv) -> String {
    format!(" {}\n", signal_exports(env).trim_end().trim_end_matches(';'))
}

/// 신호 환경이 **타이핑 없이** 셸 통합 exec 런처를 탈 수 있는가 (**순수 판정** · 2026-10-27).
///
/// - 계획이 [`crate::shell_integration::BootstrapPlan::Exec`] 여야 한다 — sshd 가 exec 명령을 넘기는 로그인 셸이 bash 라고
///   앱이 이미 물어 확인한 길이다([`crate::shell_integration::probe_login_shell`]). 그래서 런처 **바깥**에 `export …;` 를
///   (작은따옴표째) 둬도 된다 — 런처 안쪽의 "작은따옴표 없음" 규칙은 fish · csh 를 위한 것인데 이 길에는 오지 않는다.
/// - **비밀이 없어야 한다**([`RemoteSignalEnv::in_file`]) — exec 명령은 짧게나마 서버의 `ps` 에 보인다(다른 계정에게도).
///   폴백(주소 · 토큰을 export)이면 예전처럼 타이핑한다(화면 에코는 필터가 지운다).
pub(crate) fn signal_rides_launcher(
    plan: crate::shell_integration::BootstrapPlan,
    env: &RemoteSignalEnv,
) -> bool {
    plan == crate::shell_integration::BootstrapPlan::Exec && env.in_file
}

/// 셸 통합 exec 런처 앞에 신호 환경을 얹은 exec 명령 (**순수 함수**) — [`signal_rides_launcher`] 가 참일 때만 쓴다.
///
/// ```sh
/// export AYNX_STREAM='…' PATH="$HOME/.config/aynx/bin:$PATH" AYNX_CODEX_NO_DAEMON=1; exec sh -c 'if …; fi'
/// ```
///
/// 환경은 `sh` → `bash --rcfile ~/.aynx/rc -i` 로 물려 내려간다. 프로필이 `PATH` 를 갈아 써도 rc 의 꼬리
/// (`crate::agent_shim::RC_SHIM_FRONT`)가 심 폴더를 다시 맨 앞에 세운다 — tmux 세션 명령과 같은 처지 · 같은 처방이다.
pub(crate) fn exec_launcher_with_signal(env: &RemoteSignalEnv) -> String {
    format!(
        "{}{}",
        signal_exports(env),
        crate::shell_integration::exec_launcher()
    )
}

/// tmux 아닌 평범한 타일이 **타이핑해야 하는** 신호 줄 (**순수 함수**) — 런처를 타면 `None`.
pub(crate) fn typed_signal_line(
    plan: crate::shell_integration::BootstrapPlan,
    env: Option<&RemoteSignalEnv>,
) -> Option<String> {
    env.filter(|e| !signal_rides_launcher(plan, e))
        .map(signal_export_line)
}

/// 타이핑한 신호 줄의 **에코를 찾을 바늘** (**순수 함수**) — 앞 공백 · 끝 개행을 뗀다.
///
/// 앞 공백을 떼는 이유: 바늘이 공백으로 시작하면 프롬프트 끝의 공백(`root@dev-01:~# `)이 부분 일치로 붙들려 다음 출력이
/// 올 때까지 화면에 늦게 선다. `export AYNX_STREAM='<스트림>'` 은 스트림 id 가 들어 있어 사람 출력과 겹칠 일이 없다.
/// 지운 뒤에는 공백 하나와 줄바꿈이 남는다(Enter 한 번 친 빈 줄과 같다 — [`crate::shell_integration::EchoFilter`] 의 계약).
pub(crate) fn signal_echo_needle(line: &str) -> &str {
    line.trim_matches(|c: char| c == ' ' || c == '\n')
}

/// 원격 설정 스크립트의 재료 — 프로젝트 id 와 끝 신호(OSC 7717)에 실릴 값.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSetup {
    pub project_id: String,
    pub nonce: String,
}

/// 원격 워크트리 만들기의 재료 — 저장소 폴더 · 워크트리·브랜치 이름 · 그 타일의 **표** (`ticket`).
///
/// 표는 타일이 마운트에서 뽑은 짧은 난수다 — 접속이 서기 전이라 세션 번호가 없으므로, 준비 이벤트
/// (`ssh-worktree-prep`)와 답(`ssh_worktree_answer`)이 이 글자로 그 타일을 가리킨다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshWorktree {
    pub repo: String,
    pub name: String,
    #[serde(default)]
    pub ticket: String,
}

/// 원격 경로를 셸 낱말 하나로 — **순수 함수**(테스트 대상).
///
/// `~` 는 따옴표 안에서 펴지지 않으므로 `~/x` 를 통째로 [`sh_quote`] 하면 `'~/x'` 라는 **글자
/// 그대로의 폴더**를 찾는다. 그래서 앞의 `~` 만 `"$HOME"` 으로 바꾸고 나머지를 인용한다
/// (`"$HOME"/'aynx'`) — tmux 의 `-c` 에도 같은 낱말이 들어가므로, 펴는 일은 tmux 가 아니라
/// 바깥 셸이 한 번 한다. `~user/` 꼴은 받지 않는다(그대로 인용된다 — 거의 쓰이지 않는다).
pub(crate) fn sh_path(path: &str) -> String {
    if path == "~" {
        "\"$HOME\"".to_string()
    } else if let Some(rest) = path.strip_prefix("~/") {
        format!("\"$HOME\"/{}", sh_quote(rest))
    } else {
        sh_quote(path)
    }
}

/// 재료를 다듬는다 — 쓸 수 없으면 `None`(아무것도 보내지 않는다). 폴더가 비었거나, 폴더·명령
/// 어디에든 제어문자(개행 포함)가 있으면 버린다: 개행은 인용 안에서도 **새 명령줄**이 된다.
///
/// 워크트리 재료(`worktree`)는 여기서 보지 않는다 — 워크트리는 첫 입력 전에 앱이 exec 로 이미 만들었고
/// ([`crate::remote_worktree::prepare`]), 첫 입력은 그 폴더에서 **시작만** 한다(git 명령이 없다 — 2026-09-29 B안).
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

/// 이 접속이 tmux 로 붙는가 (**순수 함수**) — 호스트 설정(`sessions.toml` 의 `tmux`)과 타일의 두
/// 표식(`PaneSpec.noTmux` · `PaneSpec.forceTmux`)을 한 답으로.
///
/// - 프로젝트 타일은 **프로젝트의 토글 하나가 정한다**: 끔 = `no_tmux`, 켬 = `force_tmux`.
///   예전에는 "호스트 켬 **그리고** 프로젝트 켬" 이라 호스트 tmux 가 꺼진 서버에서 프로젝트 토글이
///   아무 효과가 없었다(2026-09-24 실기 ④ — 폼은 켜져 있는데 첫 접속이 평범한 셸로 갔다).
/// - 표식이 없는 타일(평범한 호스트 타일)은 예전 그대로 호스트 설정을 따른다.
/// - 둘 다 참이면 `no_tmux` 가 이긴다 — 만들어지지 않는 조합이지만, 모르면 끄는 편이 안전하다
///   (tmux 는 셸 통합·블록을 끈다).
pub(crate) fn use_tmux_for(host_tmux: Option<bool>, no_tmux: bool, force_tmux: bool) -> bool {
    if no_tmux {
        return false;
    }
    force_tmux || host_tmux.unwrap_or(false)
}

/// tmux 가 아닌 호스트의 첫 입력 한 줄 — `cd -- <폴더> && <명령>` + `\n` (**순수 함수**).
///
/// 명령은 **인용하지 않는다** — 사람이 폼에 적은 한 줄(`claude --resume`)이 그대로 셸에 가야
/// 한다(`on_connect` 와 같은 대접). `&&` 라 폴더가 없으면 명령은 돌지 않고 셸의 오류 한 줄이
/// 화면에 남는다. 끝의 `\n` 은 [`prepare_on_connect`] 와 같은 규칙이다(이 줄은 그 뒤에 붙는다).
///
/// 신호 환경([`SshStart::signal_env`])이 있으면 명령 앞에 [`signal_exports`] 가 붙는다 — 이 셸이 곧
/// 에이전트를 띄우는 셸이라 거기서 export 하면 에이전트와 그 훅이 물려받는다. 명령이 없는 폴더 타일도
/// 신호 환경이 있으면(호스트 AI 권한 읽기 이상 — 사람이 그 셸에서 에이전트를 띄운다) 붙인다.
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

/// tmux 호스트의 첫 입력 한 줄 — [`tmux_attach_command`] 에 **시작 폴더와 시작 명령**을 얹는다
/// (**순수 함수**).
///
/// ```sh
/// command -v tmux >/dev/null 2>&1 \
///   && exec tmux new-session -A -s 'aynx-1' -c "$HOME"/'aynx' 'claude; exec "${SHELL:-/bin/sh}" -l' \; set-option … \
///   || { echo '[aynx] …'; cd -- "$HOME"/'aynx' && claude; }
/// ```
///
/// - 명령은 tmux 세션의 **자기 명령**으로 돈다 — 노트북을 덮어 SSH 가 끊겨도 tmux 서버 안에서
///   계속 간다(이 기능의 요점). 뒤의 `exec "$SHELL" -l` 은 명령이 끝났을 때 그 창을 **로그인
///   셸로 이어 받는다**: 없으면 claude 를 빠져나오는 순간 tmux 세션이 닫히고 타일도 끝난다.
///   그 셸은 [`crate::shell_integration::tmux_session_shell`] 이다 — 셸 통합 rc 가 있고 bash 면 그 rc 로 뜬다(2026-10-08).
/// - `-c` 는 tmux 1.9+ 다. 없는 폴더면 tmux 가 홈에서 띄운다(명령은 그대로 돈다).
/// - `-A` 라 **같은 이름의 세션이 이미 있으면 붙기만 하고 `-c`·명령은 무시된다** — 재접속 힌트
///   로 오는 경우는 원래 그 뜻이다. 새 타일은 서버에 남은 이름(앱을 껐다 켠 뒤 이 앱이 모르는 `aynx-N`)도
///   피해 고른다([`pick_new_tmux_name`] — 2026-09-29). 목록을 묻지 못했을 때(시한 · exec 거절)만 옛 한계가 남는다.
/// - tmux 가 없는 서버는 예전처럼 한 줄을 남기고 **평범한 셸에서 같은 일**(`cd && 명령`)을 한다.
/// - 신호 환경([`SshStart::signal_env`])의 `export` 는 **tmux 명령 문자열 안에** 넣는다 — 이미 떠 있던
///   tmux 서버는 새 클라이언트의 환경을 물려주지 않으므로(`update-environment` 에 없는 이름), 바깥
///   셸에서 export 하면 서버가 먼저 떠 있던 호스트에서만 조용히 빠진다. 폴백 갈래에도 같은 머리가 선다.
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
    // 세션 명령 끝의 셸 — 서버에 셸 통합 rc 가 있고 bash 면 그 rc 로(tmux 안에도 훅 · `codex` 감싸개),
    // 아니면 예전 그대로 로그인 셸(`crate::shell_integration::tmux_session_shell` · 2026-10-08).
    // 에이전트 활성화면 셸 통합 rc 가 없을 때 에이전트 rc 로(사용자 프로필 뒤에 심 폴더를 다시 앞에).
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
        // 명령이 없는 폴더 타일 — 신호 환경이 있으면(호스트 AI 권한 읽기 이상) 셸을 그 환경으로 띄운다
        // (사람이 그 셸에서 띄울 에이전트가 물려받는다). 없으면 예전 그대로 세션 기본 셸.
        None if !env.is_empty() => (
            format!(
                " {}",
                sh_quote(&format!("{env}{shell}"))
            ),
            format!("{env}cd -- {dir}"),
        ),
        None => (String::new(), format!("cd -- {dir}")),
    };
    // 새 워크트리 폴더는 이 줄보다 **먼저** 앱이 exec 로 만들어 두었다(`crate::remote_worktree`) — `-c` 가
    // 홈으로 떨어지지 않는다. 제목 전달 체인은 세션 명령(`{inner}`) **뒤에** 선다 — 그 앞이면 tmux 가
    // `\;` 를 새 세션의 명령으로 읽는다.
    let titles = tmux_title_chain(&q);
    format!(
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A{detach} -s {q} -c {dir}{inner}{titles} \
         || {{ echo {missing}; {fallback}; }}"
    )
}

/// tmux 안의 **지금 폴더**를 묻는 exec 명령 — 화면(PTY)을 건드리지 않는 짧은 왕복이다.
///
/// `display -p -t '<name>' '#{pane_current_path}'` 는 그 세션의 **활성 패널**이 있는 폴더를
/// 한 줄로 낸다. tmux 타일에는 OSC 7 이 없으므로(간이 모드) 📂 가 폴더를 아는 유일한 길이다.
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

/// **끌 수 있는 세션 이름**인가 — 통과하면 그 이름을 그대로 돌려준다(`ssh_tmux_kill` 의 문, **순수 함수**).
///
/// [`safe_tmux_target`] 보다 **좁다**. 전환 · 폴더 질의는 틀린 대상에 닿아도 화면이 바뀌거나 "모름" 으로 떨어질 뿐이지만,
/// 끄기는 되돌릴 수 없다. 그래서 모양까지 잠근다:
/// - 다듬지 않는다 — 앞뒤 공백이 있으면 거절(목록이 준 이름과 **글자 그대로** 같아야 한다).
/// - 첫 글자 `-` 거절(옵션으로 읽힐 모양 — 아래 `=` 접두로도 막히지만 두 겹으로).
/// - 허용 문자만: 글자 · 숫자(유니코드 — 한글 이름 포함) · 공백 · `-_+@%,~#!^&()[]{}`.
///   빠진 것: 제어 문자 · 따옴표(`'` `"` `` ` ``) · `\` · `$` · `;` · `|` · `<>` · `*?`(tmux 대상의 fnmatch) ·
///   `:` `.`(tmux 대상의 창 · 패널 구분 — tmux 는 세션 이름에 이 둘을 넣지 않는다) · `/` · `=`.
///   이런 이름의 세션은 목록에는 뜨지만 앱에서 끄지 못한다(거절 문구 — 사람이 셸에서 끈다).
/// - 128자까지(`safe_tmux_target` 과 같은 상한).
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

/// tmux 세션 하나를 **끄는** exec 명령 — `tmux kill-session -t '=<이름>'`(화면(PTY)을 건드리지 않는다).
///
/// `=` 접두는 tmux 대상의 **정확 일치**다. 접두가 없으면 tmux 는 이름이 정확히 맞는 세션이 없을 때 **앞부분이 맞는 세션**
/// (`work` → `work-old`)이나 fnmatch 무늬로 찾아 들어가 엉뚱한 세션을 끈다. 인용은 [`sh_quote`] 한 곳(`=` 까지 한 낱말).
pub(crate) fn tmux_kill_command(name: &str) -> String {
    debug_assert!(
        killable_tmux_name(name).is_some(),
        "끌 수 없는 tmux 세션 이름입니다: {name}"
    );
    format!("tmux kill-session -t {}", sh_quote(&format!("={name}")))
}

/// `tmux ls` 의 출력 형식 — 필드 넷을 `|` 로 잇는다.
///
/// 사람이 읽는 기본 출력(`main: 3 windows (created …) (attached)`)을 파싱하지 않는 이유는
/// 그것이 **tmux 버전·로캘에 따라 달라지는 문장**이기 때문이다. `-F` 는 우리가 모양을 정하는
/// 계약이고, 필드 이름은 tmux 1.8 부터 같다.
const TMUX_LIST_FORMAT: &str =
    "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}";

/// 서버에 있는 tmux 세션을 묻는 exec 명령 — 화면(PTY)을 건드리지 않는다.
pub(crate) fn tmux_list_command() -> String {
    format!("tmux ls -F '{TMUX_LIST_FORMAT}'")
}

/// `tmux ls -F` 한 줄에서 읽어 내는 것 — 목록에 뜨는 그대로다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct TmuxSessionInfo {
    /// 세션 이름 (서버가 준 값 그대로 — 공백·한글이 들어올 수 있다).
    pub name: String,
    /// 창 개수(`session_windows`).
    pub windows: u32,
    /// 붙어 있는 클라이언트 수(`session_attached`) — 0 이면 비어 있다.
    pub attached: u32,
    /// 만든 시각 (Unix epoch 초, `session_created`).
    pub created: i64,
}

/// `tmux ls -F` 출력 파싱 — **순수 함수**(테스트 대상).
///
/// **뒤에서부터 세 번 자른다**(`rsplitn(4, '|')`). tmux 세션 이름에는 `|` 가 들어갈 수 있고
/// (금지 문자는 `:` 와 `.` 뿐이다), 앞에서부터 자르면 그런 이름이 통째로 어긋난다. 뒤 세 칸은
/// 전부 숫자라 경계가 흔들리지 않는다.
///
/// **망가진 줄은 조용히 건너뛴다.** 이 출력에는 우리가 모르는 것이 섞일 수 있다 — 서버 rc 가
/// 찍는 배너, tmux 가 stderr 대신 stdout 으로 낸 경고 같은 것들. 한 줄 때문에 목록 전체를
/// 잃는 것보다 그 줄만 없는 편이 낫다.
pub(crate) fn parse_tmux_list(stdout: &str) -> Vec<TmuxSessionInfo> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        // rsplitn 은 **뒤에서부터** 내므로 순서가 created → attached → windows → name 이다.
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
        // 이름은 서버가 준 값이지만 **제어문자는 여기서 떨군다** — 프런트가 그 이름을 그대로
        // 셸 명령(`switch-client -t …`)에 싣기 때문이다.
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
