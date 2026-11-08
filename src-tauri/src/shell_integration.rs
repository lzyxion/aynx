//! OSC 133 셸 통합 — 훅 스니펫과 그것을 서버에 심는 부트스트랩 문자열.
//!
//! 원격 셸이 "프롬프트가 여기서 시작한다 / 명령이 여기서 시작한다 / 명령이 이 코드로
//! 끝났다" 를 스스로 말해 주지 않으면 터미널은 화면에 흐르는 바이트만 본다. OSC 133 은
//! 그 경계를 표준 이스케이프로 알리는 규약이고, **그 시퀀스를 만드는 것은 셸의 몫**이다
//! (xterm 은 받아서 해석만 한다 — docs/verification/xterm.md §4).
//!
//! 그래서 접속할 때 훅을 심는다. **전달 방식은 타이핑이 아니라 "시작 파일로 실행" 이다.**
//!
//! ```text
//!  authenticate 성공
//!    ▼
//!  ⓪ SFTP 채널 하나로 ~/.aynx/integration.sh + ~/.aynx/rc 를 쓰고 /bin/sh 를 stat 한다
//!    │   (내용이 이미 같으면 쓰지도 않는다 · 화면에 아무것도 안 남는다)
//!    ▼
//!  ① channel_open_session → request_pty → **request_exec**
//!    │   exec sh -c 'if [ "${SHELL##*/}" = bash ]; then exec "$SHELL" --rcfile "$HOME/.aynx/rc" -i; …'
//!    ▼
//!  ② 사용자의 on_connect (셸이 선 뒤에 타이핑 — 이것만은 그대로다)
//!    ▼
//!  **첫 프롬프트부터** A/B, 명령마다 C, 끝날 때 D;<코드>
//! ```
//!
//! **순서가 계약이다** ([`crate::ssh::prepare_on_connect`] 주석의 ①스니펫 → ②on_connect).
//! 스니펫이 먼저 서야 사용자 명령의 시작·끝이 마커로 잡히고, `on_connect` 가 셸 상태를
//! 바꿔도(`exec`·`tmux attach`) 스니펫은 이미 적용된 뒤다.
//!
//! # 왜 타이핑을 그만뒀나 (2026-09-08)
//!
//! 예전에는 파일도 셸에 타이핑해 심었고(`cat > … <<'AYNX_EOF'`), 그 뒤엔 **한 줄로** 줄였다
//! (`. ~/.aynx/integration.sh; …`). 줄이 하나가 되어도 남는 문제는 그대로였다 — 타이핑은
//! 사용자의 입력과 구별되지 않기 때문이다:
//!
//! - 서버의 **`~/.bash_history` 맨 위**에 남아 ↑ 한 번이면 튀어나온다.
//! - 화면의 에코를 지우려고 [`EchoFilter`] 라는 기계가 따로 필요했다.
//! - **첫 프롬프트는 훅이 걸리기 전에** 그려진다 (그 명령 하나는 블록으로 안 잡힌다).
//!
//! 셋 다 "셸이 선 뒤에 넣는다" 는 방식 자체에서 나온다. 그래서 [`exec_launcher`] 로
//! **시작 파일을 지정해 셸을 띄운다** — WSL 타일이 `--rcfile` 로 하던 것과 같은 수법이고
//! (docs/log/2026-09-08-wsl-cwd-hook.md), 셸은 처음부터 훅을 물고 뜬다.
//! 그 rc 는 로그인 셸과 같은 순서로 프로필을 먼저 읽는다 ([`remote_rc_body`]).
//!
//! # 그래서 길이 넷이다 ([`bootstrap_plan`])
//!
//! | 조건 | 계획 | 셸을 여는 법 | 타이핑 |
//! | --- | --- | --- | --- |
//! | SFTP ○ · `/bin/sh` ○ · 로그인 셸이 **bash** | [`BootstrapPlan::Exec`] | `request_exec` + 런처 | **없다** (on_connect 만) |
//! | SFTP ○ · bash 가 아니거나 `/bin/sh` ✕ | [`BootstrapPlan::ShellQuiet`] | `request_shell` | 조용한 한 줄 |
//! | SFTP ✕ | [`BootstrapPlan::ShellHeredoc`] | `request_shell` | heredoc 도배 |
//! | `shell_integration = false` | [`BootstrapPlan::ShellOptOut`] | `request_shell` | 없다 (on_connect 만) |
//!
//! **로그인 셸이 bash 인지는 앱이 먼저 물어본다** ([`probe_login_shell`] — 접속당 exec 왕복
//! 하나). 셸 안의 판정에만 맡기면 zsh·fish 서버가 런처의 `else` 갈래로 뜬 채 **훅을
//! 잃는다** — 앱이 "런처를 보냈다" 고 믿어 타이핑을 건너뛰기 때문이다. 앱이 먼저 알면
//! 그 서버들은 오늘까지와 **한 글자도 다르지 않게** 조용한 한 줄을 받는다.
//! [`EchoFilter`] 는 이제 **타이핑하는 길에만** 선다.
//!
//! 투명성은 자리를 옮겼을 뿐 사라지지 않았다:
//! - **파일이 숨겨지지 않는다** — 서버에서 `cat ~/.aynx/integration.sh` · `cat ~/.aynx/rc` 로
//!   언제든 열어 볼 수 있는 **고정된 자리**에 있다 (tmux 안까지 훅을 넣으려면 사용자가
//!   rc 에서 그 경로를 직접 읽어야 한다).
//! - **세션 로그에는 원본이 남는다** — 감춘 것은 화면뿐이다.
//! - **사용자의 `on_connect` 는 지우지 않는다** — 자기가 적은 명령은 자기 화면에 보여야 한다.
//!
//! 30줄을, 그리고 한 줄을 매번 다시 보여 주는 것은 투명성이 아니라 소음이었다.
//!
//! # 정직한 한계
//!
//! - **tmux 안의 셸은 자동으로 훅을 얻지 못한다.** 우리는 서버의 rc 파일을 건드리지
//!   않으므로, `on_connect` 가 `tmux new -A` 로 **새 셸**을 열면 그 셸은 이 스니펫을
//!   source 한 적이 없다. 파일(`~/.aynx/integration.sh`)은 이미 서버에 있으니 사용자가
//!   자기 rc 에 `[ -f ~/.aynx/integration.sh ] && . ~/.aynx/integration.sh` 한 줄을
//!   더하면 tmux 안까지 완전히 동작한다 (그때 passthrough 래핑이 빛을 본다).
//!   자동화는 후속 작업이다. (2026-10-08: **앱이 새로 만드는** tmux 세션은 셸을 같은 rc 로 띄운다 —
//!   [`tmux_session_shell`]. 이미 있는 세션에 붙을 때는 그대로다.)
//! - **기존 `DEBUG` trap 은 대체된다** (bash). `PROMPT_COMMAND` 는 보존·체이닝하지만
//!   `trap ... DEBUG` 는 하나뿐이라 그럴 수 없다 — 다만 이전 핸들러가 **함수 이름 하나**
//!   인 흔한 경우(oh-my-posh 의 실행 시간 측정 등)에는 우리 핸들러가 먼저 그것을 부른다.
//! - **호스트별 옵트아웃이 있다.** `sessions.toml` 의 `shell_integration = false` 면 위 그림의
//!   ⓪①②가 통째로 사라지고 [`build_bootstrap_opt_out`] 이 사용자의 `on_connect` 만 보낸다
//!   (`crate::ssh::open_ssh_session`). 적지 않았거나 `true` 면 현행 그대로다.
//!   실패해도 세션은 유지된다 (기존 `on_connect` 계약과 같다 — 전송 실패는 접속 실패가 아니다).
//!
//! # 로컬 셸에도 같은 통로가 있다 (파일 아래쪽 — PowerShell · WSL)
//!
//! 원격이 `~/.aynx/integration.sh` 라면 로컬은 `<config_dir>/aynx/` 안의 파일들이다. 심는
//! 법은 원격과 다르다: 셸에 타이핑하지 않고 **띄울 때 인자로 준다**
//! (`crate::pty::shell_command`). 그래서 지울 에코도 없다.
//!
//! | 셸 | 파일 | 거는 법 | 내는 것 |
//! | --- | --- | --- | --- |
//! | PowerShell (`pwsh`·`powershell`) | `integration.ps1` | `-NoExit -Command . '<경로>'` ([`ps_dot_source`]) | OSC 7 |
//! | WSL bash (`wsl:<배포판>`) | `integration.sh` + `integration-wsl.rc` | `sh -c 'exec bash --rcfile <rc> -i'` ([`wsl_launch_script`]) | OSC 7 + OSC 133 |
//!
//! WSL 이 읽는 `integration.sh` 는 **원격에 심는 [`SNIPPET`] 과 같은 바이트**다 — 리눅스
//! bash 라는 점이 같으므로 스니펫을 둘로 나눌 이유가 없다. `.rc` 는 그것을 사용자의
//! `~/.bashrc` **뒤에** 읽어 주는 얇은 껍데기다 ([`wsl_rc_body`]).
//!
//! PowerShell 쪽 스크립트가 하는 일은 아직 **OSC 7 하나**고, OSC 133 은 나중에 **같은 파일
//! 안에** 얹는다 — 주입 통로를 둘로 만들지 않는다. `cmd` · Git Bash 에는 훅이 없다
//! (그 둘은 프로세스 cwd 를 진짜로 바꿔 `crate::cwd` 의 PEB 읽기가 답이다).
//! 자세한 내력은 docs/log/2026-09-08-local-shell-hook-osc7.md ·
//! docs/log/2026-09-08-wsl-cwd-hook.md.
//!
//! 현재 위층을 부름: 서버에 스니펫을 올릴 때(`upload_via_handle`) `crate::sftp` 를 쓴다.

use std::path::{Path, PathBuf};

use russh::client::Handle;
use russh_sftp::client::SftpSession;

use crate::i18n::tr;
use crate::ssh::SshHandler;

/// heredoc 종료 표식. 스니펫 본문에 이 줄이 있으면 파일이 잘리므로 조립 전에 검사한다.
pub(crate) const HEREDOC_TAG: &str = "AYNX_EOF";

/// 서버에 남는 스니펫 경로 (홈 기준). 재접속마다 **덮어쓴다** (멱등).
///
/// 명령 이력은 그 옆 `~/.aynx/history` 에 `ISO시각<TAB>종료코드<TAB>명령` 으로 쌓인다
/// (로드맵 2단계). tmux passthrough 가 막히거나 재접속으로 마커가 날아가도 **서버에는
/// 남는다** 는 것이 그 파일의 존재 이유다 (docs/verification/tmux.md §3). 경로는
/// [`SNIPPET`] 안에 박혀 있고 로테이션은 후속 작업이다.
pub(crate) const SNIPPET_PATH: &str = "~/.aynx/integration.sh";

/// 같은 파일을 **SFTP 로** 가리키는 경로.
///
/// SFTP 서브시스템에는 `~` 를 풀어 줄 셸이 없다 — OpenSSH sftp-server 는 `~/x` 를 "`~` 라는
/// 이름의 디렉터리 안의 x" 로 읽는다. 대신 SFTP v3 에서 **상대 경로의 기준이 로그인
/// 사용자의 홈**이라, `~/` 를 뗀 이 문자열이 [`SNIPPET_PATH`] 와 정확히 같은 자리다
/// (`crate::sftp::normalize_remote` 와 같은 근거 — 테스트가 두 상수를 묶어 둔다).
const REMOTE_PATH: &str = ".aynx/integration.sh";

/// 그 파일이 사는 디렉터리 (없으면 만든다 — 셸의 `mkdir -p` 자리).
const REMOTE_DIR: &str = ".aynx";

/// **시작 파일** — `bash --rcfile` 이 읽는 그 파일 (홈 기준 표기).
///
/// [`SNIPPET_PATH`] 가 "훅 그 자체" 라면 이것은 "훅을 언제 읽을지" 를 정하는 껍데기다.
/// 로그인 셸이 읽을 프로필들을 같은 순서로 먼저 읽고([`remote_rc_body`]) 맨 뒤에 스니펫을
/// 얹는다 — WSL 의 [`WSL_RC_NAME`] 과 같은 자리, 다른 내용이다(그쪽은 `~/.bashrc` 뿐이다).
pub(crate) const RC_PATH: &str = "~/.aynx/rc";

/// 그 rc 를 **SFTP 로** 가리키는 경로 ([`REMOTE_PATH`] 와 같은 근거의 상대 경로).
const REMOTE_RC_PATH: &str = ".aynx/rc";

/// 런처 안에서 rc 를 가리키는 모양.
///
/// `~` 는 큰따옴표 안에서 풀리지 않으므로 `$HOME` 을 쓴다. 그리고 **작은따옴표를 쓸 수
/// 없다** — 런처 전체가 이미 `sh -c '…'` 한 겹 안에 들어가기 때문이다
/// ([`exec_launcher`] 의 인용 규칙).
const RC_IN_LAUNCHER: &str = "$HOME/.aynx/rc";

/// rc 본문에서 스니펫을 가리키는 모양 (같은 이유로 `$HOME`).
const SNIPPET_IN_HOME: &str = "$HOME/.aynx/integration.sh";

/// **POSIX 서버인지** 를 묻는 탐침 경로.
///
/// `/bin/sh` 가 있으면 sshd 가 exec 요청을 `<로그인 셸> -c <명령>` 으로 실행해 주는 유닉스
/// 계열이라는 뜻이고, 그래야 [`exec_launcher`] 가 성립한다. Windows OpenSSH 처럼 이것이
/// 없는 서버에서는 런처가 그대로 cmd/PowerShell 에 넘어가 뜻 모를 오류가 되므로
/// **옛 타이핑 경로로 물러난다**.
const POSIX_PROBE: &str = "/bin/sh";

/// tmux passthrough 를 켜는 관용형 한 줄 (docs/verification/tmux.md §5).
///
/// `all` 은 3.4+ 에서만 있고 (비가시 패널 포함), `on` 은 3.3+ (보이는 패널만),
/// 3.3 미만은 옵션 자체가 없이 **항상 통과**다 — 그래서 셋 다 실패해도 `true` 로 끝낸다.
/// 이 명령은 tmux 서버가 없으면 하나 띄운다 — `tmux new -A` 가 나중에 그 서버에 붙으므로
/// 옵션이 이미 켜진 채 시작한다는 뜻이고, 그것이 이 줄을 접속 시점에 두는 이유다.
const TMUX_PASSTHROUGH: &str = "command -v tmux >/dev/null 2>&1 && { tmux set -g allow-passthrough all 2>/dev/null || tmux set -g allow-passthrough on 2>/dev/null || true; }; true";

/// bash·zsh 겸용 OSC 133 훅.
///
/// # 방출 지점
///
/// | 시퀀스 | 뜻 | 언제 |
/// | --- | --- | --- |
/// | `A;aynx=1` | 프롬프트 시작 | precmd (프롬프트가 그려지기 직전) |
/// | `B;aynx=1` | 프롬프트 끝 = 입력 시작 | **`PS1` 의 맨 끝** (프롬프트가 다 그려진 자리) |
/// | `C;aynx=1` | 명령 실행 시작 | bash `DEBUG` trap (**`/dev/tty` 로** — 아래 v4 절) · zsh `preexec` |
/// | `D;<코드>;aynx=1` | 명령 종료 | precmd (다음 프롬프트 직전) |
///
/// # 마커에 `aynx=1` 이 붙는다 (v3)
///
/// 남의 셸 통합(VS Code · iTerm2 · kitty)이 이미 서 있는 셸에서는 프롬프트마다 `A` 가 둘이
/// 되어 블록이 갈라진다. 그래서 우리 마커에는 **출처 태그**를 단다 — 프런트는 payload 를
/// `;` 로 필드 분해해 **처음 본 `A` 의 태그로 소스를 고정**하고 다른 태그를 버린다
/// (`src/lib/shell-integration.ts`). 셸 쪽에서도 아래 탐지로 아예 안 걸리지만, 아는 이름만
/// 보므로 앱 쪽 태그가 최종 결정권이다 (docs/log/2026-09-08-block-history-design.md §5).
///
/// # 남의 훅이 서 있으면 아무것도 심지 않는다 (v3)
///
/// 두 줄째의 `if` 가 그것이다: 환경 변수 넷(`VSCODE_SHELL_INTEGRATION` ·
/// `ITERM_SHELL_INTEGRATION_INSTALLED` · `KITTY_SHELL_INTEGRATION` · `WARP_HONOR_PS1`)과
/// 함수 이름 셋(`__vsc_prompt_start` · `iterm2_preexec` · `starship_precmd`) 중 하나라도
/// 걸리면 `__aynx_loaded=1` 만 세우고 **곧바로 돌아간다**. 비용은 source 시점 1회다.
///
/// # `B` 는 `PS1` 의 **끝**에 있다 (v3 에서 옮겼다)
///
/// v2 는 precmd 에서 `A` 바로 뒤에 `B` 를 냈다 — **PS1 이 그려지기 전**이라 `B` 의 커서 열이
/// 언제나 0 이었고, 프런트가 `B..C` 로 읽는 명령문에 프롬프트 문자열이 그대로 붙었다
/// (docs/log/2026-09-08-block-search.md 의 남은 반쪽). 지금은 VS Code 와 같은 방식으로
/// **`PS1` 끝에 한 번 붙인다**:
///
/// ```sh
/// case "$PS1" in *"133;B"*) ;; *) PS1="$PS1\[$__aynx_b\]";; esac
/// ```
///
/// 붙이는 자리는 **`__aynx_ready`**(bash) · **`__aynx_ready`**(zsh, precmd 의 맨 뒤)다 —
/// starship·oh-my-posh 처럼 **프롬프트마다 `PS1` 을 통째로 다시 만드는** 테마가 있어서,
/// 한 번만 붙이면 그다음 프롬프트에서 사라진다. 사용자의 훅이 다 돈 **뒤에** 다시 확인하고
/// 없으면 다시 붙이는 것이 유일하게 견디는 모양이고, `case` 가드 덕에 안 바뀐 PS1 에서는
/// 아무 일도 하지 않는다.
///
/// 붙이는 문자열 `$__aynx_b` 는 [`SNIPPET`] 이 로드될 때 **한 번** 정해 둔다(프롬프트마다
/// 서브셸을 여는 비용이 없다). `$TMUX` 면 passthrough 로 감싼 꼴이다. 감싸개는 셸마다 다르다 —
/// bash 는 `\[…\]`, zsh 는 `%{…%}` (둘 다 "폭 0" 표시라 readline 이 줄 길이를 잘못 세지 않는다).
///
/// # bash 의 `$__aynx_b` 는 날 바이트가 아니라 **PS1 이스케이프 글자**다 (v5)
///
/// tmux passthrough 는 `ESC \`(ST)로 끝난다 — 날 바이트를 PS1 에 넣으면 값 끝의 `\` 가 감싸개의
/// `\]` 와 붙어 `\\` + `]` 로 읽힌다: 프롬프트 뒤에 `]` 가 찍히고 `\[` 가 안 닫혀 readline 이 줄 폭을
/// 잘못 센다(docs/log/2026-09-27-shell-marker-redirect.md 의 v5 절). 그래서 bash 갈래는 같은 바이트를
/// **PS1 이 푸는 글자**(`\033` · `\007` · `\\`)로 적는다 — bash 2.x 부터 있는 프롬프트 이스케이프뿐이라
/// 판마다 다른 `${v//pat/rep}` 인용 규칙에 기대지 않는다. 터미널에 나가는 바이트는 v4 와 같다.
/// zsh 는 프롬프트에서 `\` 가 특별하지 않아(`PROMPT_SUBST` 를 켜도) 날 바이트 그대로 둔다(실측).
///
/// 여기에 **OSC 7 하나가 더** 붙는다 (`__aynx_cwd` — precmd 에서 A 직전). 셸이 프롬프트마다
/// `file://<호스트>/<현재 폴더>` 를 말해 주면 원격 타일의 📂 가 그 자리에서 열리고, 같은
/// 스니펫을 그대로 읽는 **WSL(bash)** 타일도 덤으로 폴더를 얻는다
/// (docs/log/2026-09-08-wsl-cwd-hook.md). 호스트는 `$HOSTNAME`(없으면 `hostname`, 그것도
/// 없으면 `localhost`)이고 프런트는 그것을 **버린다**(`parseOsc7Cwd`).
///
/// **경로는 퍼센트 인코딩하지 않는다** — 셸에서 그 인코딩을 돌리려면 루프 한 벌이 더
/// 필요한데, 프런트 파서는 퍼센트 이스케이프를 풀되 **날것의 공백도 그대로 통과**시킨다
/// (`file://MYBOOK/home/a b` → `/home/a b`, 테스트가 못 박는다). `%` 가 든 폴더 이름은
/// 이스케이프가 깨진 것으로 보여 원문 그대로 남는다 — 그것도 맞는 답이다.
///
/// # oh-my-posh 공존
///
/// `PROMPT_COMMAND` 는 **보존**한다 — 우리 함수를 앞에, 준비 표시를 뒤에 끼워 넣고
/// 기존 값은 가운데 그대로 둔다 (bash 5.1+ 의 배열 형태도 처리한다). 우리 precmd 는
/// 마지막에 `return $?` 로 원래 종료 코드를 되돌려 준다 — 뒤이어 도는 테마 함수가
/// `$?` 로 프롬프트 색을 정하는 흔한 관례를 깨지 않기 위해서다.
///
/// # tmux passthrough
///
/// `$TMUX` 가 있으면 방출을 `ESC P tmux; … ESC \` 로 감싸고 **payload 안의 ESC 를 두 번**
/// 쓴다 (docs/verification/tmux.md §1). 감싼 시퀀스는 `tty_cmd_rawstring()` 으로 바깥
/// tty 에 원형 그대로 나간다.
///
/// # 상태 기계 (bash)
///
/// `__aynx_state` 0 = 사용자 입력이 아닌 것이 도는 중 · 1 = 프롬프트에서 입력 대기 ·
/// 2 = 명령 실행 중. `DEBUG` trap 은 1 에서만 명령으로 인정한다 — 그래야 `PROMPT_COMMAND`
/// 안에서 도는 테마 함수들이 "사용자 명령" 으로 잡히지 않는다. 0 → 1 전환은
/// `PROMPT_COMMAND` **맨 뒤**에 붙인 `__aynx_ready` 가 한다 (bash-preexec 와 같은 수법).
///
/// **시작값이 0 인 것이 중요하다**: trap 은 이 파일 한가운데서 걸리므로, 1 로 시작하면
/// 스니펫 자신의 남은 줄들이 첫 "사용자 명령" 으로 잡혀 이력 파일 맨 위에 남는다
/// (실기에서 확인).
///
/// # bash 의 `C` 는 `/dev/tty` 로 쓴다 (v4)
///
/// `DEBUG` trap 은 **단순 명령마다** 돈다. `{ a; b; } > f` · `( … ) > f` · `for …; done > f` ·
/// `while …; done | less` 같은 **복합 명령**에서는 첫 트랩이 복합 명령 **안쪽의 첫 단순 명령**
/// 앞에서 도는데, 그때는 복합 명령의 리다이렉트가 이미 걸려 있다 — stdout 이 파일·파이프다.
/// v3 까지는 `C` 를 stdout 에 냈으므로 `ESC ]133;C;aynx=1 BEL` 이 **사용자 파일 맨 앞**에
/// 박혔다 (docs/log/2026-09-27-shell-marker-redirect.md). 그래서 `C` 만은
/// `2>/dev/null >/dev/tty` 로 **제어 터미널에 직접** 쓴다 — 리다이렉트 순서가 중요하다:
/// `2>` 가 먼저 서야 `/dev/tty` 를 못 열 때(제어 터미널 없음)의 오류 문구까지 삼킨다(그때는
/// `C` 가 없을 뿐이고 프런트는 `D` 에서 블록을 한 번에 열고 닫는다). bash 3.2 에도 있는
/// 문법이고, tmux 안에서는 `/dev/tty` 가 그 패널이라 passthrough 래핑이 그대로 통한다.
/// Git Bash(ConPTY) 에서도 `/dev/tty` 는 콘솔(`/dev/cons0`)로 열린다 (실측).
///
/// 나머지 방출(`D`·`A`·OSC 7 — `PROMPT_COMMAND`, `B` — `PS1`)은 **최상위**에서 도므로 셸 자신의
/// stdout(터미널)이다. zsh 의 `preexec` 도 명령줄 전체가 돌기 **전에** 최상위에서 한 번 돌아
/// 리다이렉트가 아직 걸리지 않았다 — 그래서 둘 다 그대로 둔다.
///
/// # 손으로 친 `codex` 에 `--no-daemon` (v6, bash 만)
///
/// Git Bash rc 의 `codex` 감싸개([`GITBASH_AGENT_WRAPPER`] — 2026-10-26 부터 `claude` 도 · 장식 파일)와 같은 `--no-daemon` 규칙의 감싸개(`function codex { … command codex … }`)를 **원격 bash** 에도
/// 세운다 — 공용 데몬 안의 Codex 훅은 데몬을 띄운 셸의 환경을 받아 신호가 틀린 타일로 간다
/// (docs/log/2026-09-26-codex-hooks.md "다시 켬"). 표식은 로컬과 같다: `AYNX_STREAM` 과
/// `AYNX_CODEX_NO_DAEMON=1`(원격은 신호 환경의 `export` — `crate::ssh::signal_exports`)이 **둘 다** 있을 때만
/// 정의하고, 사용자가 이미 `codex` 함수를 세웠으면 건드리지 않는다.
///
/// 정의는 소스할 때가 아니라 **프롬프트마다**(`__aynx_ready` 맨 끝의 `__aynx_codex_arm`) 확인한다 — 원격은
/// 스니펫을 먼저 읽고 신호 `export` 는 그 **뒤의** 첫 입력 줄로 오기 때문이다. 한 번 서면(`__aynx_codex_armed`)
/// 다음부터는 변수 하나만 본다. 같은 줄에서 곧장 `codex` 를 치는 앱의 AI 타일(`export …; cd … && codex`)은 감싸개가
/// 서기 전이라 Rust 가 시작 명령에 직접 붙인다(`crate::ssh::open` 의 `codex_start_no_daemon`).
/// zsh 갈래에는 없다(`declare -F` 가 zsh 에서는 다른 뜻이다). Git Bash 는 rc 끝의 감싸개가 이미 서 있어 이 함수는
/// `declare -F codex` 에서 물러난다. WSL 은 표식이 건너가지 않아 서지 않는다.
///
/// # 본문에 `!` 를 쓰지 않는다
///
/// 이 문자열은 원격 셸에 **한 줄씩 타이핑되듯** 들어간다. 대화형 bash 는 읽는 줄마다
/// 히스토리 전개를 먼저 돌리는데, heredoc 본문도 예외가 아니다 — `*[!A-Za-z]*` 같은
/// 글로브가 있으면 `!A-Za-z` 를 히스토리 참조로 읽고 "event not found" 로 줄이 통째로
/// 날아간다. 그래서 부정 글로브 대신 `command -v` 로 같은 판정을 한다.
pub(crate) const SNIPPET: &str = r#"# aynx shell integration (v6) - generated; do not edit
[ -n "$__aynx_loaded" ] && return 0
if [ -n "$VSCODE_SHELL_INTEGRATION" ] || [ -n "$ITERM_SHELL_INTEGRATION_INSTALLED" ] || [ -n "$KITTY_SHELL_INTEGRATION" ] || [ -n "$WARP_HONOR_PS1" ] || command -v __vsc_prompt_start >/dev/null 2>&1 || command -v iterm2_preexec >/dev/null 2>&1 || command -v starship_precmd >/dev/null 2>&1; then __aynx_loaded=1; return 0; fi
__aynx_loaded=1
__aynx_emit(){ if [ -n "$TMUX" ]; then printf '\033Ptmux;\033\033]133;%s\007\033\\' "$1"; else printf '\033]133;%s\007' "$1"; fi; }
__aynx_cwd(){ local h="${HOSTNAME:-$(hostname 2>/dev/null)}"; [ -n "$h" ] || h=localhost; if [ -n "$TMUX" ]; then printf '\033Ptmux;\033\033]7;file://%s%s\007\033\\' "$h" "$PWD"; else printf '\033]7;file://%s%s\007' "$h" "$PWD"; fi; }
__aynx_log(){ [ -n "$2" ] || return 0; local l="${2//$'\n'/ }"; l="${l//$'\t'/ }"; mkdir -p "$HOME/.aynx" 2>/dev/null; printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$l" >> "$HOME/.aynx/history" 2>/dev/null; return 0; }
__aynx_state=0; __aynx_cmd=
if [ -n "$BASH_VERSION" ]; then
if [ -n "$TMUX" ]; then __aynx_b='\033Ptmux;\033\033]133;B;aynx=1\007\033\\'; else __aynx_b='\033]133;B;aynx=1\007'; fi
__aynx_prev=$(trap -p DEBUG); __aynx_prev=${__aynx_prev#trap -- \'}; __aynx_prev=${__aynx_prev%\' DEBUG}
command -v "$__aynx_prev" >/dev/null 2>&1 || __aynx_prev=
__aynx_pre(){ [ -n "$__aynx_prev" ] && "$__aynx_prev"; case "$BASH_COMMAND" in __aynx_*) return 0;; esac; [ -n "$COMP_LINE" ] && return 0; [ "$__aynx_state" = 1 ] || return 0; __aynx_state=2; __aynx_cmd=$BASH_COMMAND; __aynx_emit "C;aynx=1" 2>/dev/null >/dev/tty; return 0; }
__aynx_post(){ local c=$?; [ "$__aynx_state" = 2 ] && { __aynx_emit "D;$c;aynx=1"; __aynx_log "$c" "$__aynx_cmd"; }; __aynx_state=0; __aynx_cmd=; __aynx_cwd; __aynx_emit "A;aynx=1"; return $c; }
__aynx_ready(){ __aynx_state=1; case "$PS1" in *"133;B"*) ;; *) PS1="$PS1\[$__aynx_b\]";; esac; __aynx_codex_arm; }
__aynx_codex_arm(){
  [ -z "$__aynx_codex_armed" ] && [ -n "$AYNX_STREAM" ] && [ "$AYNX_CODEX_NO_DAEMON" = 1 ] || return 0
  __aynx_codex_armed=1
  declare -F codex >/dev/null 2>&1 && return 0
  function codex {
    local __a
    for __a in "$@"; do
      case $__a in --no-daemon|--remote|--remote=*) command codex "$@"; return ;; esac
    done
    case $1 in
      resume|fork) local __s=$1; shift; command codex "$__s" --no-daemon "$@" ;;
      *) command codex --no-daemon "$@" ;;
    esac
  }
}
trap '__aynx_pre' DEBUG
case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
"declare -a"*) PROMPT_COMMAND=(__aynx_post "${PROMPT_COMMAND[@]}" __aynx_ready);;
*) PROMPT_COMMAND="__aynx_post${PROMPT_COMMAND:+;$PROMPT_COMMAND};__aynx_ready";;
esac
elif [ -n "$ZSH_VERSION" ]; then
__aynx_b=$(__aynx_emit "B;aynx=1")
__aynx_pre(){ __aynx_cmd=$1; __aynx_emit "C;aynx=1"; }
__aynx_post(){ local c=$?; [ -n "$__aynx_cmd" ] && { __aynx_emit "D;$c;aynx=1"; __aynx_log "$c" "$__aynx_cmd"; __aynx_cmd=; }; __aynx_cwd; __aynx_emit "A;aynx=1"; return $c; }
__aynx_ready(){ case "$PS1" in *"133;B"*) ;; *) PS1="$PS1%{$__aynx_b%}";; esac; }
typeset -ga precmd_functions preexec_functions
precmd_functions=(__aynx_post ${precmd_functions:#__aynx_post})
precmd_functions=(${precmd_functions:#__aynx_ready} __aynx_ready)
preexec_functions=(__aynx_pre ${preexec_functions:#__aynx_pre})
fi"#;

/// 서버에 심을 **파일 내용** — 스니펫 + 끝 개행. 두 경로가 같은 바이트를 쓴다
/// (SFTP 로 올리는 것과 heredoc 이 만드는 것이 달라지면 생략 최적화가 거짓말이 된다).
fn snippet_file() -> String {
    let mut out = String::with_capacity(SNIPPET.len() + 1);
    out.push_str(SNIPPET);
    if !SNIPPET.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// 조용한 경로에서 셸에 **실제로 타이핑되는 그 한 줄** (개행 없음).
///
/// [`build_bootstrap_quiet`] 이 이 문자열을 그대로 넣고, 출력 쪽의 [`EchoFilter`] 가
/// **같은 문자열**을 지운다 — 두 곳이 갈라지면 에코가 화면에 남으므로 상수 하나로 묶는다
/// (테스트가 그 사실을 못 박는다).
pub(crate) fn quiet_command_line() -> String {
    format!(". {SNIPPET_PATH}; {TMUX_PASSTHROUGH}")
}

// ---------------------------------------------------------------------------
// 시작 파일로 실행 (exec 런처) — 타이핑하지 않는 길
// ---------------------------------------------------------------------------

/// `bash --rcfile` 이 읽을 **rc 파일의 내용** — **순수 함수**.
///
/// # 왜 프로필을 직접 읽는가
///
/// `--rcfile` 을 준 bash 는 **로그인 셸이 아니다**(`-i` 뿐이다). 그러면 `/etc/profile` 도
/// `~/.bash_profile` 도 자동으로 읽히지 않아 `PATH`·환경 변수가 통째로 빈다. 그래서 이
/// 파일이 **로그인 셸과 같은 순서**로 그것들을 대신 읽는다 (VS Code 터미널의
/// `shellIntegration-bash.sh` 가 쓰는 규칙과 같다): `/etc/profile` → `~/.bash_profile` ·
/// `~/.bash_login` · `~/.profile` 중 **처음 있는 것 하나**.
///
/// # `~/.bashrc` 를 따로 읽지 않는다
///
/// 로그인 bash 는 `~/.bashrc` 를 **프로필을 통해서만** 읽는다 (대개 `~/.bash_profile` 에
/// 사용자가 적어 둔 `. ~/.bashrc` 한 줄이다). 여기서 그것을 따로 한 번 더 읽으면 편하긴
/// 하지만, 프로필이 그 줄을 일부러 빼 둔 서버에서는 **로그인 셸과 다른 셸**이 뜬다.
/// 편의보다 로그인 셸과의 충실도가 먼저다 — 이 파일의 존재 이유가 "평소 뜨던 그 셸" 이다.
/// (WSL 의 [`wsl_rc_body`] 는 반대로 `~/.bashrc` 만 읽는다. 거기서 뜨는 것은 로그인 셸이
/// 아니라 대화형 셸이라 기준이 다르다.)
///
/// # 맨 뒤가 우리 것
///
/// 스니펫은 사용자의 `PROMPT_COMMAND` 를 **감싸므로** 그것이 다 선 뒤에 와야 한다
/// (원격 타이핑 경로에서 `source` 가 `on_connect` 보다 앞인 것과 같은 이유의 뒷자리다).
/// tmux passthrough 는 [`TMUX_PASSTHROUGH`] 그대로다 — 의미도 실패 관용도 바뀌지 않는다.
///
/// **줄바꿈은 LF 하나다.** 리눅스 bash 가 읽는 파일이라 CR 이 섞이면
/// `$'\r': command not found` 로 죽는다 (테스트가 못 박는다).
pub(crate) fn remote_rc_body() -> String {
    format!(
        "# aynx shell integration rc (v2) - generated; do not edit\n\
         # login-shell 과 같은 순서로 프로필을 읽는다 (VS Code 터미널의 shellIntegration-bash.sh 와 같은 규칙)\n\
         # ~/.bashrc 는 따로 읽지 않는다 - 로그인 bash 는 그것을 프로필을 통해서만 읽는다.\n\
         # 편의보다 로그인 셸과의 충실도가 먼저다.\n\
         # 프로필 뒤에 aynx PATH 심 폴더를 다시 맨 앞에 세운다 - 앱이 이 타일에 export 했을 때만(에이전트 활성화).\n\
         {mark}\
         {PROFILE_CHAIN}\
         {front}\
         [ -f \"{SNIPPET_IN_HOME}\" ] && . \"{SNIPPET_IN_HOME}\"\n\
         {TMUX_PASSTHROUGH}\n",
        mark = crate::agent_shim::RC_SHIM_MARK,
        front = crate::agent_shim::RC_SHIM_FRONT,
    )
}

/// **로그인 셸이 읽는 프로필들을 같은 순서로 읽는 다섯 줄** — `--rcfile` 로 뜨는 셸의 공통 머리.
///
/// `--rcfile` 을 준 bash 는 로그인 셸이 아니라 `PATH`·환경 변수가 통째로 빈다. 그래서
/// `/etc/profile` → `~/.bash_profile` · `~/.bash_login` · `~/.profile` 중 **처음 있는 것
/// 하나**를 대신 읽는다 (VS Code 터미널의 `shellIntegration-bash.sh` 와 같은 규칙).
///
/// 두 곳이 이 다섯 줄을 함께 쓴다 — 원격의 [`remote_rc_body`] 와 Git Bash 의
/// [`gitbash_rc_body`]. 둘 다 "로그인 셸로 뜨던 것을 `--rcfile` 로 바꿔 단" 자리라 같은
/// 보상이 필요하다 (WSL 의 [`wsl_rc_body`] 는 다르다 — 거기서 뜨던 것은 애초에 로그인 셸이
/// 아니라 대화형 셸이라 `~/.bashrc` 하나면 된다). 원격의 에이전트 rc(`crate::agent_shim::agent_rc_body` — 셸 통합 rc 가
/// 없는 tmux 세션의 `-l` 자리)도 같은 다섯 줄을 쓴다.
///
/// **줄바꿈은 LF 하나다** (리눅스·MSYS bash 가 읽는다 — CR 이 섞이면 `$'\r': command not found`).
pub(crate) const PROFILE_CHAIN: &str = "[ -f /etc/profile ] && . /etc/profile\n\
                             for __aynx_f in \"$HOME/.bash_profile\" \"$HOME/.bash_login\" \"$HOME/.profile\"; do\n\
                             \x20 if [ -f \"$__aynx_f\" ]; then . \"$__aynx_f\"; break; fi\n\
                             done\n\
                             unset __aynx_f\n";

/// sshd 의 **exec 요청**으로 보낼 그 한 줄 — **순수 함수**.
///
/// ```sh
/// exec sh -c 'if [ "${SHELL##*/}" = bash ]; then exec "$SHELL" --rcfile "$HOME/.aynx/rc" -i; else exec "${SHELL:-/bin/sh}" -l; fi'
/// ```
///
/// # 왜 exec 인가 — 타이핑은 서버에 흔적을 남긴다
///
/// 셸이 선 **뒤에** 부트스트랩을 타이핑하면 그 줄은 사용자의 입력과 구별되지 않는다:
/// 서버의 `~/.bash_history` 맨 위에 남아 ↑ 한 번이면 튀어나오고, 화면에서 지우려면
/// [`EchoFilter`] 가 따로 필요했으며, **첫 프롬프트는 훅이 걸리기 전에** 그려졌다.
/// 시작 파일로 실행하면 셋 다 사라진다 — 셸은 처음부터 훅을 물고 뜬다.
///
/// # 인용 규칙 — 안쪽에 작은따옴표가 하나도 없어야 한다
///
/// sshd 는 exec 명령을 **사용자의 로그인 셸**에게 `$SHELL -c <명령>` 으로 건넨다. 그 셸이
/// fish·csh 일 수도 있는데, 그런 셸에서도 깨지지 않는 유일한 모양이 **작은따옴표 한 겹**
/// 이다 (그 안은 어느 셸에서나 글자 그대로다). 그래서 안쪽 문자열에는 작은따옴표를 쓸 수
/// 없고 — sh 에는 그 안에서 쓸 탈출 문법이 없다 — 경로는 큰따옴표와 `$HOME` 으로 적는다
/// ([`RC_IN_LAUNCHER`]). 유닛 테스트가 "따옴표는 정확히 둘" 을 못 박는다.
///
/// # bash 가 아니면 평소의 로그인 셸
///
/// zsh 에는 `--rcfile` 이 없고(`ZDOTDIR` 로 폴더를 통째로 세워야 한다 — 후속 작업),
/// fish 는 문법 자체가 다르다. 그 서버들은 `"$SHELL" -l` 로 **예전과 똑같이** 뜨고,
/// 부르는 쪽이 뒤이어 옛 타이핑 부트스트랩을 보낸다 ([`BootstrapPlan`]).
/// `${SHELL:-/bin/sh}` 의 기본값은 `$SHELL` 이 빈 계정에서 `exec "" -l` 이 되는 것을 막는다
/// (WSL 런처와 같은 이유 — [`wsl_launch_script`]).
pub(crate) fn exec_launcher() -> String {
    format!(
        "exec sh -c 'if [ \"${{SHELL##*/}}\" = bash ]; \
         then exec \"$SHELL\" --rcfile \"{RC_IN_LAUNCHER}\" -i; \
         else exec \"${{SHELL:-/bin/sh}}\" -l; fi'"
    )
}

/// **tmux 새 세션의 셸** — 세션 명령 끝의 `exec …` 자리 (**순수 함수** · 2026-10-08).
///
/// ```sh
/// if [ -f "$HOME/.aynx/rc" ] && [ "${SHELL##*/}" = bash ]; then exec "$SHELL" --rcfile "$HOME/.aynx/rc" -i; else exec "${SHELL:-/bin/sh}" -l; fi
/// ```
///
/// 머리말 "정직한 한계" 의 첫 줄(tmux 안의 셸은 훅을 얻지 못한다)을 **앱이 연 새 tmux 세션에 한해** 메운다 —
/// [`exec_launcher`] 와 같은 rc 로 띄워 셸 통합 스니펫(과 그 안의 v6 `codex` 감싸개)이 tmux 안에도 선다. 손으로 친
/// `codex` 가 `--no-daemon` 으로 돌아야 훅 신호가 그 타일로 온다(Codex 에는 데몬을 끄는 설정 키·환경변수가 없다).
///
/// - rc 가 있는지는 **서버의 셸이** 가른다 — rc 는 셸 통합이 켜진 호스트에만 심기므로(`shell_integration = false`
///   · SFTP 실패면 없다) 앱이 미리 알 필요가 없다. 없거나 로그인 셸이 bash 가 아니면 예전 그대로 `-l`.
/// - `new-session -A` 가 **이미 있는 세션에 붙으면** 이 명령은 무시된다(재접속 · 목록에서 고른 세션 — 알려진 한계).
/// - **클라이언트 파서와는 다른 층이다.** 09-16 의 "tmux 타일에는 셸 통합을 끈다"(docs/log/2026-09-16-tmux-toggle.md)는
///   `Terminal.svelte` 가 간이 모드 타일에 OSC 133 파서를 **붙이지 않는다**는 뜻이고, 그 결정은 그대로다. 여기서
///   서버 쪽 스니펫이 돌면 OSC 133/7 이 `$TMUX` 갈래로 passthrough 되어 바깥까지 오지만, 간이 모드 타일에는 133·7
///   핸들러가 없어 xterm 이 조용히 버린다(OSC 9·52·777·7717 핸들러는 스니펫이 내지 않는 번호다) — 블록 이력이 생기지 않는다.
///
/// **에이전트 활성화**(`agent` — 앱이 이 타일에 심 PATH 를 export 했다 · 2026-10-26)면 셸 통합 rc 가 없을 때 둘째 갈래가 선다 —
/// bash 면 에이전트 rc(`crate::agent_shim::AGENT_RC_PATH` — 로그인 프로필 + 심 폴더 다시 앞으로)로 뜬다. `-l` 로 뜨면 사용자
/// 프로필의 `export PATH="$HOME/.local/bin:$PATH"` 같은 줄이 심을 가리기 때문이다. zsh · fish 는 예전 그대로 `-l`(알려진 한계).
/// `agent` 가 거짓이면 글자 하나 다르지 않다.
pub(crate) fn tmux_session_shell(agent: bool) -> String {
    let agent_rc = if agent {
        format!(
            "elif [ -f \"{rc}\" ] && [ \"${{SHELL##*/}}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"{rc}\" -i; ",
            rc = crate::agent_shim::AGENT_RC_PATH
        )
    } else {
        String::new()
    };
    format!(
        "if [ -f \"{RC_IN_LAUNCHER}\" ] && [ \"${{SHELL##*/}}\" = bash ]; \
         then exec \"$SHELL\" --rcfile \"{RC_IN_LAUNCHER}\" -i; \
         {agent_rc}else exec \"${{SHELL:-/bin/sh}}\" -l; fi"
    )
}

/// 로그인 셸을 묻는 **탐침 명령**.
///
/// sshd 는 이것도 `<로그인 셸> -c <명령>` 으로 돌린다 — 그래서 bash·zsh·fish·csh **어디서나**
/// 같은 뜻이어야 한다. `echo "$SHELL"` 은 그 넷 전부에서 변수 하나를 찍는다
/// (fish 의 `$SHELL` 도 같은 이름이고, csh 에도 있다). [`exec_launcher`] 와 같은 이유로
/// **작은따옴표를 쓰지 않는다**.
const LOGIN_SHELL_PROBE: &str = "echo \"$SHELL\"";

/// 그 탐침의 인내심. 접속 경로 한가운데라 **반드시 시간 안에 끝나야 한다** — 답이 늦으면
/// 세션이 열리는 것 자체가 늦는다. 못 받으면 "bash 가 아니다" 로 보고 옛 경로로 간다.
const LOGIN_SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// 서버의 **로그인 셸**을 물어본다 — 짧게 살았다 죽는 채널 하나.
///
/// # 왜 물어보나
///
/// [`exec_launcher`] 는 셸 안에서 `$SHELL` 을 보고 bash 에만 훅을 건다. 그런데 bash 가
/// 아니면 그 셸은 `"$SHELL" -l` 로 뜨고 **아무 훅도 없는 채** 남는다 — 앱이 "런처를 보냈으니
/// 됐다" 고 믿어 옛 타이핑 부트스트랩을 보내지 않기 때문이다. 그래서 판정을 **셸 안이 아니라
/// 앱 쪽에서** 한다: bash 가 아니면 처음부터 `request_shell` + 타이핑으로 가서
/// **zsh·fish 서버의 동작이 오늘까지와 한 글자도 다르지 않게** 한다.
///
/// 대가는 접속당 **exec 왕복 하나**다 (PTY 를 붙이지 않는 짧은 채널). 런처의 `else` 갈래는
/// 그대로 두되, 이제 그것은 오판을 대비한 안전망이다.
///
/// 실패·타임아웃·빈 답은 전부 `None` 이고 **"bash 가 아니다"** 로 읽힌다 (`ShellQuiet` —
/// 오늘까지의 경로). 접속을 막지 않는다.
pub(crate) async fn probe_login_shell(handle: &Handle<SshHandler>) -> Option<String> {
    tokio::time::timeout(LOGIN_SHELL_TIMEOUT, async {
        let mut channel = handle.channel_open_session().await.ok()?;
        channel.exec(true, LOGIN_SHELL_PROBE).await.ok()?;
        let mut out = Vec::new();
        while let Some(msg) = channel.wait().await {
            match msg {
                // stderr 는 버린다 — 프로필이 뱉는 잡음이 답에 섞이면 안 된다.
                russh::ChannelMsg::Data { data } => out.extend_from_slice(&data),
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        let _ = channel.close().await;
        let text = String::from_utf8_lossy(&out).trim().to_string();
        (!text.is_empty()).then_some(text)
    })
    .await
    .ok()
    .flatten()
}

/// 그 답이 bash 인가 — **순수 함수**. 경로가 아니라 **이름**으로 본다
/// (`/usr/bin/bash` · `/bin/bash` 를 한 번에 덮는다 — 런처의 `${SHELL##*/}` 와 같은 규칙).
fn is_bash(login_shell: Option<&str>) -> bool {
    login_shell.is_some_and(|s| s.rsplit('/').next() == Some("bash"))
}

/// SFTP 로 서버 쪽 준비를 해 본 결과 — [`bootstrap_plan`] 의 입력.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteSetup {
    /// 두 파일을 심었고 [`POSIX_PROBE`] 도 있다 — exec 런처를 쓸 수 있다.
    ExecReady,
    /// 스니펫은 심었지만 POSIX 서버가 아니다 (Windows OpenSSH 등).
    FilesOnly,
    /// SFTP 자체가 안 됐다 (서브시스템 비활성·권한 등).
    Failed,
}

/// 그래서 셸을 **어떻게 띄우고 무엇을 타이핑할 것인가** — [`bootstrap_plan`] 의 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BootstrapPlan {
    /// `request_exec` + [`exec_launcher`]. 타이핑하는 부트스트랩이 **없다**
    /// (사용자의 `on_connect` 는 예외 — 그것은 언제나 셸이 선 뒤에 간다).
    Exec,
    /// `request_shell` + [`build_bootstrap_quiet`] 한 줄 (에코는 [`EchoFilter`] 가 지운다).
    ShellQuiet,
    /// `request_shell` + [`build_bootstrap_heredoc`] 도배 (SFTP 없는 서버).
    ShellHeredoc,
    /// `request_shell` + [`build_bootstrap_opt_out`] — 우리 것은 한 글자도 없다.
    ShellOptOut,
}

/// 결정표 — **순수 함수**. 이 한 줄이 위의 넷 중 하나를 고른다.
///
/// | `shell_integration` | SFTP | `/bin/sh` | `login_shell` | 계획 |
/// | --- | --- | --- | --- | --- |
/// | `false` | (열지도 않는다) | — | — | [`BootstrapPlan::ShellOptOut`] |
/// | `true` | 성공 | 있다 | **bash** | [`BootstrapPlan::Exec`] |
/// | `true` | 성공 | 있다 | zsh·fish·빈 값·모름 | [`BootstrapPlan::ShellQuiet`] |
/// | `true` | 성공 | 없다 | — | [`BootstrapPlan::ShellQuiet`] |
/// | `true` | 실패 | — | — | [`BootstrapPlan::ShellHeredoc`] |
///
/// **`Exec` 는 bash 일 때만이다.** 그 외에는 오늘까지의 경로(`request_shell` + 조용한 한 줄)로
/// 가므로 zsh·fish 서버는 훅을 그대로 얻는다 — 판정을 셸 안이 아니라 앱 쪽에서 하는 이유다
/// ([`probe_login_shell`]). 답이 없으면(`None`) **모르는 쪽으로 안전하게** 기운다.
///
/// 옵트아웃이 **가장 세다** — 그 호스트에서는 SFTP 를 시도조차 하지 않으므로 나머지 인자가
/// 무엇이든 결과가 같다 (부르는 쪽은 [`RemoteSetup::Failed`] 를 넘긴다).
pub(crate) fn bootstrap_plan(
    shell_integration: bool,
    setup: RemoteSetup,
    login_shell: Option<&str>,
) -> BootstrapPlan {
    if !shell_integration {
        return BootstrapPlan::ShellOptOut;
    }
    match setup {
        RemoteSetup::ExecReady if is_bash(login_shell) => BootstrapPlan::Exec,
        RemoteSetup::ExecReady | RemoteSetup::FilesOnly => BootstrapPlan::ShellQuiet,
        RemoteSetup::Failed => BootstrapPlan::ShellHeredoc,
    }
}

/// 사용자의 `on_connect` 를 **맨 뒤**에 붙인다 (끝 개행 보장).
fn append_on_connect(out: &mut String, on_connect: Option<&str>) {
    if let Some(cmd) = on_connect {
        out.push_str(cmd);
        if !cmd.ends_with('\n') {
            out.push('\n');
        }
    }
}

/// **조용한 경로** — 파일은 이미 [`upload_via_handle`] 이 SFTP 로 심었다는 전제.
///
/// 셸에 타이핑되는 것은 앞 개행 하나와 **명령 한 줄**뿐이다:
///
/// ```text
/// . ~/.aynx/integration.sh; command -v tmux … ; true
/// ```
///
/// 두 명령을 `;` 로 한 줄에 붙인 이유는 에코 줄 수 그 자체다 — 두 줄이면 접속마다 두 줄이
/// 남는다. `source` 가 먼저인 순서는 그대로 지킨다 (앞의 실패가 뒤를 막지 않도록 `&&` 가
/// 아니라 `;` 다: tmux 줄은 스니펫과 독립이다).
///
/// 맨 앞 개행은 MOTD 직후에 도착한 바이트가 프롬프트 줄과 한 줄에 섞이지 않게 한다.
///
/// `on_connect` 는 [`crate::ssh::prepare_on_connect`] 를 이미 통과한 값이다
/// (비었으면 `None`, 끝에 개행이 있다). 실패할 데가 없으므로 `Result` 가 아니다.
pub(crate) fn build_bootstrap_quiet(on_connect: Option<&str>) -> String {
    let mut out = String::with_capacity(256);
    // ① MOTD 뒤 프롬프트 줄과 섞이지 않게
    out.push('\n');
    // ② 이 셸에 훅을 걸고, 이어서 tmux passthrough — **한 줄**
    out.push_str(&quiet_command_line());
    out.push('\n');
    // ③ 사용자의 on_connect — **언제나 마지막**이다 (셸 상태를 바꿔도 훅은 이미 걸렸다)
    append_on_connect(&mut out, on_connect);
    out
}

/// **exec 런처 경로** — 셸이 이미 훅을 물고 떴으니 타이핑할 것은 사용자의 `on_connect` 뿐이다.
///
/// 앞 개행도 붙이지 않는다 ([`build_bootstrap_opt_out`] 과 같은 이유 — 우리가 남길 줄이
/// 없으면 프롬프트와 떼어 놓을 것도 없다). 두 경로가 같은 몸통을 쓰는 것은 우연이 아니라
/// 사실이다: **화면에 우리 줄이 없다** 는 점에서 둘은 같다.
pub(crate) fn build_bootstrap_exec(on_connect: Option<&str>) -> String {
    build_bootstrap_opt_out(on_connect)
}

/// **폴백 경로** — SFTP 를 못 쓰는 서버에서 파일까지 셸에 타이핑해 심는다 (예전 동작).
///
/// 화면이 스니펫 길이만큼 도배되지만, OSC 133 이 아예 없는 세션보다는 낫다.
///
/// # heredoc 안전성
///
/// 스니펫은 인용된 heredoc(`<<'AYNX_EOF'`) 안에 들어가므로 원격 셸이 `$`·백틱·백슬래시를
/// **전혀 해석하지 않는다** — 스니펫을 이스케이프할 필요가 없는 이유다. 대신 본문에
/// `AYNX_EOF` 만 있는 줄이 있으면 파일이 거기서 잘리므로 그것만 검사한다 (`Err`).
/// 스니펫은 우리가 쓰는 상수라 이 검사는 실제로는 절대 걸리지 않는다 — 나중에 스니펫을
/// 고치다 사고를 내지 않게 두는 그물이고, 유닛 테스트가 그 사실을 못 박는다.
///
/// 사용자의 `on_connect` 는 **heredoc 바깥**(종료 표식 뒤)에 붙으므로 그 안에
/// `AYNX_EOF` 줄이 있어도 스니펫을 자르지 못한다. 그 사실도 테스트가 지킨다.
pub(crate) fn build_bootstrap_heredoc(on_connect: Option<&str>) -> Result<String, String> {
    if SNIPPET.lines().any(|line| line.trim_end() == HEREDOC_TAG) {
        return Err(tr!(
            ko: "셸 통합 스니펫 본문에 heredoc 종료 표식('{HEREDOC_TAG}')이 들어 있습니다",
            en: "The shell integration snippet contains the heredoc terminator ('{HEREDOC_TAG}')"
        ));
    }

    let mut out = String::with_capacity(SNIPPET.len() + 256);
    // ① 조용한 경로와 같은 이유의 앞 개행
    out.push('\n');
    // ② 파일로 심는다 (`>` — 멱등 덮어쓰기. 버전이 올라가면 다음 접속에서 갱신된다)
    out.push_str("mkdir -p ~/.aynx && cat > ");
    out.push_str(SNIPPET_PATH);
    out.push_str(" <<'");
    out.push_str(HEREDOC_TAG);
    out.push_str("'\n");
    out.push_str(&snippet_file());
    out.push_str(HEREDOC_TAG);
    out.push('\n');
    // ③ 지금 이 셸에 건다
    out.push_str(". ");
    out.push_str(SNIPPET_PATH);
    out.push('\n');
    // ④ tmux 가 있으면 passthrough
    out.push_str(TMUX_PASSTHROUGH);
    out.push('\n');
    // ⑤ 사용자의 on_connect — **언제나 마지막**이다
    append_on_connect(&mut out, on_connect);
    Ok(out)
}

/// **옵트아웃 경로** — 이 호스트에는 아무것도 심지 않는다
/// (`sessions.toml` 의 `shell_integration = false`).
///
/// 셸 통합이 하던 세 가지가 전부 사라진다: SFTP 업로드도, `source` 타이핑도,
/// `~/.aynx` 생성도 없다. 남는 것은 사용자가 직접 적은 `on_connect` 뿐이라 셸 통합이
/// 생기기 전의 [`crate::ssh::prepare_on_connect`] 전송과 **바이트가 같다**.
///
/// 앞 개행조차 붙이지 않는 것이 의도다 — 우리가 심을 것이 없으면 화면에 남길 것도 없다
/// (다른 두 경로의 앞 개행은 "우리 줄" 을 프롬프트와 떼어 놓으려던 것이다).
/// 보낼 것이 아무것도 없으면 빈 문자열이고, 부르는 쪽이 전송 자체를 건너뛴다.
///
/// **이미 심어진 파일은 앱이 지우지 않는다.** 서버의 `~/.aynx` 를 앱이 접속할 때마다
/// 지우면, 끄기 한 번이 사용자가 자기 rc 에 적어 둔 source 줄까지 깨뜨린다. 정리는
/// 서버에서 `rm -rf ~/.aynx` 로 — 폼 설명과 문서가 그 한 줄을 안내한다.
pub(crate) fn build_bootstrap_opt_out(on_connect: Option<&str>) -> String {
    let mut out = String::new();
    append_on_connect(&mut out, on_connect);
    out
}

// ---------------------------------------------------------------------------
// 부트스트랩 에코 지우기 (출력 경로의 1회성 필터)
// ---------------------------------------------------------------------------

/// 에코를 찾아 볼 예산 — 접속 직후 이만큼만 훑고 그 뒤로는 손대지 않는다.
///
/// 우리 줄은 MOTD 바로 뒤 첫 프롬프트에서 에코된다. 그보다 훨씬 뒤에 같은 문자열이
/// 나온다면 그건 **사용자가 친 것**이거나 로그에 흐른 것이라 지우면 안 된다.
/// 8KB 면 어지간한 MOTD 뒤까지 넉넉히 닿으면서, 매칭 비용도 접속당 한 줌으로 묶인다.
const ECHO_BUDGET: usize = 8 * 1024;

/// 우리가 타이핑한 그 한 줄의 **에코를 딱 한 번** 지우는 스트리밍 필터.
///
/// # 왜 필요한가
///
/// [`build_bootstrap_quiet`] 은 화면에 남는 줄을 30여 줄에서 **한 줄**로 줄였다. 그런데 그
/// 한 줄도 사용자에게는 "내가 치지 않은 알 수 없는 명령" 이다 (실기 피드백). 셸의 에코는
/// 우리가 끌 수 있는 것이 아니므로, **출력 경로에서 그 줄만 도려낸다**.
///
/// # 지우는 것과 남기는 것
///
/// 지우는 것은 **우리가 타이핑한 바이트 그 자체**([`quiet_command_line`])뿐이다. 줄바꿈은
/// 건드리지 않는다 — 지우면 뒤따르는 프롬프트가 앞 프롬프트에 붙어 버린다. 남는 것은
/// 사용자가 프롬프트에서 Enter 한 번 친 것과 똑같은 빈 프롬프트 줄이다.
///
/// **사용자의 `on_connect` 는 지우지 않는다.** 자기가 적은 명령은 자기 화면에 보여야 한다
/// (앱이 몰래 실행하는 것이 없다는 원칙 — [`crate::ssh::prepare_on_connect`]).
///
/// 같은 기계가 **신호 `export` 줄**(런처를 못 탄 평범한 원격 타일 — `crate::ssh::typed_signal_line`, 2026-10-27)의 에코도
/// 지운다. 그 줄은 두 번 보일 수 있어(터미널 드라이버 + 줄 편집기) 필터 둘을 잇대어 쓴다(`crate::ssh` 의 `echo_filters`).
///
/// # 계약
///
/// - **첫 등장 한 번만** 지운다. 그 뒤로는 필터가 스스로 꺼진다(`done`) — 같은 문자열을
///   사용자가 다시 쳐도 그것은 그대로 보인다.
/// - **청크 경계를 넘는다.** 반쯤 맞은 꼬리는 붙들어 뒀다가(`held`) 다음 청크와 이어 본다.
///   못 맞추면 붙들어 둔 것을 **순서 그대로** 돌려보낸다 (한 바이트도 삼키지 않는다).
/// - **못 찾으면 그대로 통과한다.** 에코가 꺼진 서버·heredoc 폴백 경로·프롬프트를 다시
///   그리는 readline 구현에서는 아무 일도 일어나지 않는다 (무해한 실패).
/// - **CR/LF 를 유연하게 본다.** needle 의 `\n` 하나는 스트림의 `\n`·`\r`·`\r\n` 어느 쪽과도
///   맞는다 (서버가 줄바꿈을 변환해 에코할 수 있다).
pub(crate) struct EchoFilter {
    /// 지울 바이트열. 비어 있으면 필터는 처음부터 꺼져 있다.
    needle: Vec<u8>,
    /// 부분 일치로 붙들어 둔 원본 바이트 (경계 걸침). needle 길이를 넘지 않는다.
    held: Vec<u8>,
    /// 예산 안에서 훑은 바이트 수.
    scanned: usize,
    /// 끝났다 — 지웠거나 예산을 다 썼다. 이후는 무조건 통과.
    done: bool,
}

/// [`EchoFilter::feed`] 가 한 청크에서 찾은 것.
enum Hit {
    /// needle 을 끝까지 맞췄다 — `[start, end)` 를 도려낸다.
    Full {
        start: usize,
        end: usize,
    },
    /// `start` 부터 맞다가 입력이 떨어졌다 — 그 뒤를 붙들어 다음 청크와 이어 본다.
    Partial {
        start: usize,
    },
    None,
}

/// 한 자리에서의 매칭 결과.
enum Step {
    /// 끝까지 맞았다 — buf 에서 소비한 마지막 **다음** 위치.
    Full(usize),
    /// 여기까지 맞았는데 buf 가 끝났다.
    Partial,
    No,
}

/// `buf[start..]` 가 needle 로 시작하는가 — **순수 함수**.
///
/// needle 의 `\n` 은 스트림의 `\n`·`\r`·`\r\n` 을 모두 받는다. `\r` 로 끝나면 뒤에 `\n` 이
/// 이어질 수 있으므로 판단을 미룬다(`Partial`) — 그러지 않으면 CRLF 가 청크 경계에 걸렸을 때
/// `\r` 만 먹고 `\n` 을 화면에 흘린다.
fn step_at(needle: &[u8], buf: &[u8], start: usize) -> Step {
    let mut i = start;
    let mut j = 0;
    while j < needle.len() {
        if i >= buf.len() {
            return Step::Partial;
        }
        if needle[j] == b'\n' {
            match buf[i] {
                b'\r' => {
                    i += 1;
                    if i >= buf.len() {
                        return Step::Partial;
                    }
                    if buf[i] == b'\n' {
                        i += 1;
                    }
                }
                b'\n' => i += 1,
                _ => return Step::No,
            }
        } else if buf[i] == needle[j] {
            i += 1;
        } else {
            return Step::No;
        }
        j += 1;
    }
    Step::Full(i)
}

/// buf 안에서 needle 의 **첫 등장**을 찾는다 — **순수 함수**.
///
/// 부분 일치를 만나면 거기서 멈춘다: 입력이 떨어져서 생긴 상태라 그보다 **뒤에서 시작하는
/// 완전 일치는 있을 수 없다** (뒤일수록 남은 바이트가 적다).
fn scan(needle: &[u8], buf: &[u8]) -> Hit {
    if needle.is_empty() {
        return Hit::None;
    }
    for start in 0..buf.len() {
        match step_at(needle, buf, start) {
            Step::Full(end) => return Hit::Full { start, end },
            Step::Partial => return Hit::Partial { start },
            Step::No => {}
        }
    }
    Hit::None
}

impl EchoFilter {
    /// 아무것도 지우지 않는 필터. 펌프는 이제 지울 줄이 없으면 필터를 아예 두지 않는다(`crate::ssh` 의 `echo_filters` —
    /// 빈 목록) — 시험만 이것을 쓴다.
    #[cfg(test)]
    pub(crate) fn passthrough() -> Self {
        EchoFilter {
            needle: Vec::new(),
            held: Vec::new(),
            scanned: 0,
            done: true,
        }
    }

    /// 이 한 줄의 에코를 한 번 지우는 필터.
    pub(crate) fn for_line(line: &str) -> Self {
        EchoFilter {
            needle: line.as_bytes().to_vec(),
            held: Vec::new(),
            scanned: 0,
            done: line.is_empty(),
        }
    }

    /// 끝났는가 — 지웠거나 예산을 다 썼다. 이후로는 무조건 통과하므로 부르는 쪽이 내려놓아도 된다.
    pub(crate) fn is_done(&self) -> bool {
        self.done && self.held.is_empty()
    }

    /// 청크 하나를 통과시킨다 — **순수 함수적** (내부 상태만 진행한다, I/O 없음).
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.done {
            return chunk.to_vec();
        }

        // 예산 안쪽만 훑는다. 넘치는 꼬리는 손대지 않고 그대로 뒤에 붙인다
        // (첫 청크가 64KB 여도 매칭 비용이 예산 크기로 묶인다).
        let room = ECHO_BUDGET.saturating_sub(self.scanned);
        let take = room.min(chunk.len());
        let (head, tail) = chunk.split_at(take);
        self.scanned += take;

        let mut buf = std::mem::take(&mut self.held);
        buf.extend_from_slice(head);

        let mut out = match scan(&self.needle, &buf) {
            Hit::Full { start, end } => {
                self.done = true;
                let mut out = Vec::with_capacity(buf.len() - (end - start) + tail.len());
                out.extend_from_slice(&buf[..start]);
                out.extend_from_slice(&buf[end..]);
                out
            }
            Hit::Partial { start } => {
                self.held = buf[start..].to_vec();
                buf.truncate(start);
                buf
            }
            Hit::None => buf,
        };

        if self.scanned >= ECHO_BUDGET {
            // 예산을 다 썼다 — 붙들어 둔 것을 돌려주고 이후는 통과시킨다.
            self.done = true;
            out.append(&mut self.held);
        }
        out.extend_from_slice(tail);
        out
    }
}

// ---------------------------------------------------------------------------
// 조용한 심기 (SFTP)
// ---------------------------------------------------------------------------

/// 서버 쪽 준비를 **SFTP 로** 끝낸다 — 화면에는 아무것도 남지 않는다.
///
/// 셸이 서기 **전에** 불린다. 그것이 이 함수의 자리가 바뀐 이유다: 파일이 먼저 있어야
/// [`exec_launcher`] 가 그것을 **시작 파일로** 읽을 수 있다 (뒤늦게 심으면 첫 프롬프트는
/// 이미 훅 없이 그려진 뒤다).
///
/// 하는 일 셋:
/// 1. `~/.aynx/integration.sh` — 훅 그 자체 ([`SNIPPET`]).
/// 2. [`POSIX_PROBE`] 를 `stat` 해 본다 — **같은 SFTP 채널**이라 왕복 하나면 끝이고,
///    셸을 띄워 물어볼 필요가 없다.
/// 3. POSIX 서버일 때만 `~/.aynx/rc` — 안 쓸 서버에 파일을 남기지 않는다.
///
/// 세션 맵에 id 가 등록되기 **전**(`open_ssh_session` 한가운데)에 불리므로
/// [`crate::sftp`] 의 세션 캐시를 쓸 수 없다. 대신 핸들로 채널을 직접 열고
/// ([`crate::sftp::open_sftp_on`]) 일이 끝나면 **바로 닫는다** — 이 채널은 한 번 쓰고
/// 버리는 것이라 캐시에 넣어 봐야 나중에 열릴 SFTP 캐시와 중복될 뿐이다.
///
/// `Ok(true)` = exec 런처를 쓸 수 있다, `Ok(false)` = 파일은 심었지만 POSIX 가 아니다.
/// 실패는 오류 문자열로 돌려줄 뿐 **접속을 막지 않는다** — 부르는 쪽이 heredoc 폴백으로
/// 물러난다 (`crate::ssh::open_ssh_session`).
pub(crate) async fn upload_via_handle(handle: &Handle<SshHandler>) -> Result<bool, String> {
    let sftp = crate::sftp::open_sftp_on(handle).await?;
    let result = prepare_remote(&sftp).await;
    // 성공이든 실패든 채널은 닫는다 (서버에 유령 채널을 남기지 않는다).
    let _ = sftp.close().await;
    result
}

/// 열린 SFTP 채널 위에서의 준비 본체 ([`upload_via_handle`] 의 세 단계).
async fn prepare_remote(sftp: &SftpSession) -> Result<bool, String> {
    put_file(sftp, REMOTE_PATH, snippet_file().as_bytes()).await?;
    // `/bin/sh` 가 있으면 sshd 가 exec 을 `<로그인 셸> -c` 로 돌려주는 유닉스다.
    // 실패는 곧 "아니다" 다 — 부재든 권한이든 런처를 걸어 볼 근거가 없는 것은 같다.
    let posix = sftp.metadata(POSIX_PROBE).await.is_ok();
    if posix {
        put_file(sftp, REMOTE_RC_PATH, remote_rc_body().as_bytes()).await?;
    }
    Ok(posix)
}

/// 열린 SFTP 채널에 파일 하나를 쓴다 — **내용이 이미 같으면 아무것도 하지 않는다**.
///
/// 접속마다 같은 바이트를 다시 쓸 이유가 없다: 왕복 두 번(임시 파일 쓰기 + rename)이
/// 그냥 사라지고, 파일 mtime 도 흔들리지 않는다 (`ls -l ~/.aynx` 가 "언제 스니펫이
/// 바뀌었나" 를 정직하게 말한다). 읽기 실패는 **없는 것으로 친다** — 부재든 권한이든
/// 답은 뒤이은 쓰기가 준다.
async fn put_file(sftp: &SftpSession, path: &str, content: &[u8]) -> Result<(), String> {
    if sftp
        .read(path)
        .await
        .is_ok_and(|existing| existing == content)
    {
        return Ok(());
    }
    // 이미 있으면 실패하지만 그건 우리가 원하던 상태다 — 판정은 다음 쓰기가 한다.
    let _ = sftp.create_dir(REMOTE_DIR).await;
    crate::sftp::save_remote(None, sftp, path, content)
        .await
        .map_err(|e| {
            tr!(
                ko: "셸 통합 파일({path})을 올리지 못했습니다: {e}",
                en: "Could not upload the shell integration file ({path}): {e}"
            )
        })
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — PowerShell 프롬프트 훅 (OSC 7)
// ---------------------------------------------------------------------------

/// `<config_dir>/aynx/` 안의 스크립트 파일 이름 (`settings.toml` 과 같은 폴더).
///
/// 사용자가 언제든 열어 볼 수 있는 **고정된 자리**에 둔다는 원칙은 원격
/// ([`SNIPPET_PATH`])과 같다 — 앱이 셸에 무엇을 심는지 감추지 않는다.
pub(crate) const PS_SCRIPT_NAME: &str = "integration.ps1";

/// 로컬 PowerShell 훅 — **프롬프트 문자열 안에** OSC 7 을 얹는다.
///
/// # 왜 이 훅이 필요한가 (검증된 사실)
///
/// PowerShell 은 `Set-Location` 으로 **프로세스의 cwd 를 바꾸지 않는다**:
///
/// ```text
/// pwsh -NoProfile -Command 'Set-Location C:\Windows;
///     "$((Get-Location).Path)  $([Environment]::CurrentDirectory)"'
///   → C:\Windows  C:\Users\<you>\projects\aynx
/// ```
///
/// 그래서 PEB 를 읽는 [`crate::cwd::child_cwd`] 는 PowerShell 세션에서 **언제나 셸이
/// 시작한 폴더**를 준다 (cmd.exe · Git Bash 는 진짜로 바꾸므로 그쪽에는 PEB 가 답이다).
/// 셸이 스스로 말해 주는 값만이 정확하고, 그것이 `resolveLocalCwd` 의 ①단계다.
///
/// # OSC 를 **반환 문자열 안에** 넣는 이유
///
/// `prompt` 안에서 `Write-Host` 로 따로 내보내면 PSReadLine 이 프롬프트를 다시 그릴 때
/// (창 크기 변경 · 히스토리 검색 · 여러 줄 편집) 그 시퀀스가 함께 재생되지 않는다.
/// 반환 문자열의 일부이면 프롬프트와 **한 몸**이라 매번 같이 나간다 — Windows Terminal 이
/// 문서로 안내하는 방식이 이것이다.
///
/// # 사용자 프롬프트를 **감싼다**
///
/// 프로파일(oh-my-posh · starship · Set-PSReadLineOption)은 `-Command` 보다 **먼저** 도므로,
/// 우리가 실행될 때 이미 사용자 `prompt` 함수가 서 있다. 그것을 `__aynx_prompt_orig` 로
/// 옮겨 두고 우리 `prompt` 가 먼저 호출한 뒤 꼬리에 OSC 를 붙인다. 사용자 프롬프트가 없으면
/// PowerShell 기본 프롬프트와 같은 문자열을 원본 자리에 넣는다. `Test-Path` 가드가 있어
/// **두 번 읽어도 자기 자신을 감싸지 않는다**(무한 재귀 방지).
///
/// # FileSystem 공급자일 때만
///
/// `HKLM:\` · `Env:\` · `Cert:\` 같은 자리에는 대응하는 폴더가 없다. 그때는 아무것도 내지
/// 않는다 — 열 수 없는 경로를 보고하느니 침묵하고 프런트가 폴백하게 둔다.
///
/// # 구분자는 슬래시
///
/// `file://` URL 문법이라 `C:/Users/x` 가 맞는 모양이고, 프런트의 `parseOsc7Cwd` 가 그대로
/// 받아 로컬 브라우저에 넘긴다 (`local_browser::normalize_input` 이 OS 구분자로 되돌린다 —
/// **프런트에서 백슬래시로 뜯어고치지 않는다**: 원격 셸이 보낸 POSIX 경로까지 망가진다).
/// 정규식이 아니라 `String.Replace` 를 쓴다 (`-replace '\\'` 는 잘못된 패턴으로 죽는다).
///
/// # 본문은 ASCII 만
///
/// Windows PowerShell 5.1 은 BOM 없는 파일을 **현재 ANSI 코드 페이지**로 읽는다. 한국어
/// 주석을 넣으면 949 로 해석돼 깨지고, BOM 을 붙이면 이번엔 pwsh 쪽 도구들이 성가시다.
/// 그래서 파일에는 ASCII 만 넣고 **설명은 전부 이 자리(러스트 주석)에 둔다.**
///
/// # OSC 133 (v2) — 블록 경계
///
/// `prompt` 가 돌려주는 **문자열 하나**가 이렇게 조립된다:
///
/// ```text
/// [D;<코드>;aynx=1]  A;aynx=1  <사용자 prompt>  OSC 7  B;aynx=1
/// ```
///
/// `B` 가 **정확하다** — bash 에서는 `PS1` 끝에 얹는 요령이 필요했지만 PowerShell 의
/// `prompt` 는 문자열 전체를 우리가 돌려주므로 진짜 끝에 놓을 수 있다.
///
/// `C`(명령 실행 시작)만 프롬프트 밖이다 — **PSReadLine 의 Enter 핸들러**가 낸다. 순서는
/// `GetBufferState` 로 파스 완결성을 본다 → `AcceptLine()` → (완결이면) `C`. `C` 를
/// `AcceptLine` **뒤에** 내는 이유는 그때라야 커서가 다음 줄, 즉 **출력의 첫 줄**에 있기
/// 때문이다 (bash 의 `DEBUG` trap 과 같은 자리). 파스 오류(여러 줄 입력 중간)와 빈 입력은
/// 걸러지므로 Enter 를 눌러도 블록이 생기지 않는다.
///
/// # 종료 코드 — `$?` 는 한 문장만에 사라진다
///
/// `prompt` 의 **첫 문장**이 `__aynx_code` 호출이고, 그 함수의 **첫 문장**이 `$?` 읽기다
/// (Windows Terminal 문서의 요령). **대입 한 줄이 `$?` 를 지운다**는 것을 실기로 확인했다:
///
/// ```text
/// cmd /c exit 7; $a = $LASTEXITCODE; $b = $?   →  ok=True   (거짓말)
/// cmd /c exit 7; f                             →  ok=False  (함수 첫 줄에서 읽으면 참)
/// ```
///
/// 실패일 때 코드를 고르는 규칙도 Windows Terminal 과 같다: `$Error[0]` 가 **지금 히스토리
/// 항목**에서 났으면 PowerShell 오류라 1, 아니면 네이티브 명령이 남긴 `$LASTEXITCODE` 다
/// (그 구분이 없으면 `Get-Item 없는파일` 이 직전 네이티브 명령의 코드를 물려받는다).
///
/// # 명령이 실제로 돌았을 때만 `D`
///
/// 깃발 둘을 본다: Enter 핸들러가 세우는 `$__aynx_ran` 과 **히스토리 id 의 변화**다. 빈
/// Enter 는 둘 다 안 움직이므로 가짜 `D` 가 나오지 않는다. 히스토리 쪽을 함께 보는 이유는
/// **PSReadLine 이 없는 세션**(ISE·비대화형 호스트) 때문이다 — 그때는 `C` 가 없는 채
/// `A`/`B`/`D` 만 오고, 프런트가 그 경우 블록을 한 번에 열고 닫는다
/// (`src/lib/shell-integration.ts` 의 `D` 핸들러).
///
/// # 남의 훅이 서 있으면 아무것도 하지 않는다
///
/// 첫 줄의 `if` 가 `$env:VSCODE_SHELL_INTEGRATION` · `$env:ITERM_SHELL_INTEGRATION_INSTALLED`
/// 를 보고 곧바로 `return` 한다 ([`SNIPPET`] 의 셸 쪽 탐지와 같은 규칙).
///
/// # 버전
///
/// 첫 줄의 `(v6)` 가 곧 버전이다(v3 = 파일 끝의 codex 감싸개 · v4 = 그 앞의 claude 감싸개 · v5 = 그 감싸개를 걷음 —
/// 한도 % 는 타일 환경의 mod 가 받는다, `crate::claude_usage` · v6 = 파일 끝의 [`PS_AGENT_WRAPPER`] — `claude` · `codex` 에 타일 장식 파일) — 내용이 바뀌면 [`ensure_ps_script`] 의 문자열 비교가
/// 달라져 다음 실행에서 자동으로 다시 쓰인다 (원격의 [`put_file`] 과 같은 규칙).
const PS_SNIPPET: &str = r#"# aynx shell integration (v6) - generated; do not edit
if ($env:VSCODE_SHELL_INTEGRATION -or $env:ITERM_SHELL_INTEGRATION_INSTALLED) { return }
if (-not (Test-Path Function:\global:__aynx_prompt_orig)) {
  $__f = Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue
  if ($__f) { Set-Item Function:\global:__aynx_prompt_orig -Value $__f.ScriptBlock }
  else { Set-Item Function:\global:__aynx_prompt_orig -Value { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " } }
  $global:__aynx_ran = $false
  $global:__aynx_hist = 0
  $__h0 = Get-History -Count 1
  if ($__h0) { $global:__aynx_hist = $__h0.Id }
  function global:__aynx_code {
    $__ok = $?
    $__gle = $global:LASTEXITCODE
    if ($__ok) { return 0 }
    $__he = Get-History -Count 1
    $__hid = 0
    if ($__he) { $__hid = $__he.Id }
    if ($Error.Count -gt 0 -and ($__hid -eq 0 -or $Error[0].InvocationInfo.HistoryId -eq $__hid)) { return 1 }
    if ($null -ne $__gle -and $__gle -ne 0) { return $__gle }
    return 1
  }
  function global:prompt {
    $__c = __aynx_code
    $__esc = [char]27
    $__bel = [char]7
    $__h = Get-History -Count 1
    $__id = 0
    if ($__h) { $__id = $__h.Id }
    $__ran = $global:__aynx_ran -or ($__id -ne $global:__aynx_hist)
    $global:__aynx_hist = $__id
    $global:__aynx_ran = $false
    $__d = ''
    if ($__ran) { $__d = "$__esc]133;D;$__c;aynx=1$__bel" }
    $__r = & $function:__aynx_prompt_orig
    $__loc = $executionContext.SessionState.Path.CurrentLocation
    $__w = ''
    if ($__loc.Provider.Name -eq 'FileSystem') {
      $__p = $__loc.ProviderPath.Replace('\', '/')
      $__w = "$__esc]7;file://localhost/$__p$__bel"
    }
    "$__d$__esc]133;A;aynx=1$__bel$__r$__w$__esc]133;B;aynx=1$__bel"
  }
  if (Get-Module PSReadLine) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
      $__a = $null; $__t = $null; $__pe = $null; $__cur = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$__a, [ref]$__t, [ref]$__pe, [ref]$__cur)
      $__txt = ''
      if ($null -ne $__a) { $__txt = $__a.Extent.Text }
      $__go = ($__txt.Trim().Length -gt 0) -and (($null -eq $__pe) -or ($__pe.Count -eq 0))
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
      if ($__go) {
        $global:__aynx_ran = $true
        [Console]::Write("$([char]27)]133;C;aynx=1$([char]7)")
      }
    }
  }
}"#;

/// 손으로 친 `claude` · `codex` 를 앱이 띄운 것과 같게 — PowerShell 감싸개 (2026-10-26 에이전트 활성화 · `crate::agent_tile`. 그 전에는
/// `codex` 에 `--no-daemon` 만 — docs/log/2026-09-26-codex-hooks.md "다시 켬 — --no-daemon").
///
/// - **aynx 타일 안에서만 선다** — `AYNX_STREAM` 과, 장식 파일 경로 `AYNX_TILE_AGENT`(`crate::server::proxy::open_local_session` 이 심는다)
///   또는 `AYNX_CODEX_NO_DAEMON=1`(설정 `[ai] codex_no_daemon` — `crate::pty`)이 있어야 정의한다. `claude` 는 장식 파일 경로가 있을 때만.
/// - 사용자가 이미 `claude` · `codex` 함수를 세웠으면(프로필) 그 이름은 건드리지 않는다.
/// - 진짜 실행 파일은 `Get-Command -CommandType Application,ExternalScript` 로 찾는다 — 설치 파일(`codex.exe`)도 npm 의
///   `codex.ps1`·`codex.cmd` 도. 함수 자신은 그 목록에 없으니 고리가 생기지 않는다.
/// - 장식 파일에서 `AYNX_ARGS_<에이전트>=` 줄만 읽고(소스하지 않는다 · `Invoke-Expression` 없음) `\x1f`(`[char]31`)로 나눈다 — 낱말은
///   `crate::agent_args::parse_args` 규칙을 지나 제어 문자가 없다. `[IO.File]::ReadAllLines` 는 5.1 에서도 UTF-8 로 읽는다. 파일이 없으면 낱말 없음.
/// - 자리는 `crate::agent_args` 의 `place` 와 같다: Claude 는 줄 끝, Codex 는 실행 파일 바로 뒤 · 첫 인자가 `resume`·`fork` 면 그 뒤(그 자리의
///   `--no-daemon` 은 건너뛴다). Codex 의 `--no-daemon` 은 표식이 있고 인자 · 낱말 어디에도 `--no-daemon` · `--remote` · `--remote=…` 가 없을 때
///   낱말 앞에 — [`crate::codex_launch`] 의 표.
/// - 인자는 **그대로** 넘긴다(splat). PowerShell 은 함수 호출에서 `--` 를 먹는다(언어 규칙) — `codex -- …` 는 감싸개를 거치면 그 토막이 빠진다.
/// - 스니펫 앞머리의 "남의 훅이 서 있으면 물러난다" `return` 뒤에 있으므로 그때는 감싸개도 없다.
///
/// 본문은 ASCII 만([`PS_SNIPPET`] 의 "본문은 ASCII 만").
const PS_AGENT_WRAPPER: &str = r#"if ($env:AYNX_STREAM -and ($env:AYNX_TILE_AGENT -or $env:AYNX_CODEX_NO_DAEMON -eq '1')) {
  function global:__aynx_agent([string]$__n, [object[]]$__a) {
    $__x = Get-Command $__n -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $__x) { Write-Error "${__n}: command not found"; return }
    $__a = @($__a)
    $__w = @()
    $__f = $env:AYNX_TILE_AGENT
    if ($__f -and [IO.File]::Exists($__f)) {
      $__k = 'AYNX_ARGS_' + $__n.ToUpperInvariant() + '='
      foreach ($__l in [IO.File]::ReadAllLines($__f)) {
        if ($__l.StartsWith($__k, [StringComparison]::Ordinal) -and $__l.Length -gt $__k.Length) { $__w = @($__l.Substring($__k.Length).Split([char]31)) }
      }
    }
    if ($__n -eq 'claude') { $__b = $__a + $__w }
    else {
      $__nd = $env:AYNX_CODEX_NO_DAEMON -eq '1' -and @(($__a + $__w) | Where-Object { "$_" -eq '--no-daemon' -or "$_" -eq '--remote' -or "$_" -like '--remote=*' }).Count -eq 0
      $__i = 0
      if ($__a.Count -gt 0 -and ("$($__a[0])" -eq 'resume' -or "$($__a[0])" -eq 'fork')) { $__i = 1 }
      while ($__i -lt $__a.Count -and "$($__a[$__i])" -eq '--no-daemon') { $__i++ }
      $__m = @()
      if ($__nd) { $__m = @('--no-daemon') }
      $__b = @($__a | Select-Object -First $__i) + $__m + $__w + @($__a | Select-Object -Skip $__i)
    }
    & $__x @__b
  }
  if ($env:AYNX_TILE_AGENT -and -not (Test-Path Function:\global:claude)) { function global:claude { __aynx_agent 'claude' $args } }
  if (-not (Test-Path Function:\global:codex)) { function global:codex { __aynx_agent 'codex' $args } }
}"#;

/// 디스크에 쓰는 **파일 내용** — 스니펫 + 에이전트 감싸개 + 끝 개행 ([`snippet_file`] 과 같은 규칙).
fn ps_snippet_file() -> String {
    let mut out = String::with_capacity(PS_SNIPPET.len() + PS_AGENT_WRAPPER.len() + 2);
    out.push_str(PS_SNIPPET);
    out.push('\n');
    out.push_str(PS_AGENT_WRAPPER);
    out.push('\n');
    out
}

/// 문자열 하나를 PowerShell **작은따옴표 리터럴**로 감싼다 — **순수 함수**.
///
/// 작은따옴표 안에서는 `$`·백틱·백슬래시가 전부 글자 그대로다. 탈출이 필요한 것은
/// 작은따옴표 자신뿐이고 규칙은 **두 번 적기**(`''`)다. 설정 폴더 경로에는 공백도 한글도
/// 들어갈 수 있고(`C:\Users\o'brien\…` 까지) 이 한 겹이 그 전부를 덮는다.
fn ps_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// `pwsh`·`powershell` 에 `-Command` 로 넘길 **그 한 줄** — **순수 함수**.
///
/// 원격은 셸에 타이핑하지만(그래서 [`EchoFilter`] 로 에코를 지운다) 로컬은 **띄울 때
/// 인자로 준다**: 화면에 아무것도 남지 않고, 프로파일이 먼저 돈 뒤에 실행된다는 순서도
/// 공짜로 따라온다. `-NoExit` 은 이 인자를 붙이는 쪽(`crate::pty::shell_command`)이 함께
/// 넣는다 — 그게 없으면 셸이 스크립트만 읽고 곧바로 끝난다.
pub(crate) fn ps_dot_source(path: &str) -> String {
    format!(". {}", ps_single_quote(path))
}

/// `<config_dir>/aynx/integration.ps1` 을 **내용이 다를 때만** 쓰고 그 경로를 돌려준다.
///
/// 실패는 전부 `None` 이고 **세션 생성을 막지 않는다** — 훅이 없으면 OSC 7 이 안 올 뿐이고
/// 프런트는 PEB(②) · 홈(③)으로 폴백한다. 셸이 안 열리는 것과는 무게가 다르다
/// (`crate::pty::spawn_shell` 이 `Option` 을 그대로 흘려보내는 이유).
///
/// 읽기 실패는 **없는 것으로 친다** — 부재든 권한이든 답은 뒤이은 쓰기가 준다
/// ([`put_snippet`] 과 같은 규칙). 같은 바이트를 매번 다시 쓰지 않으므로 파일 mtime 이
/// "언제 훅이 바뀌었나" 를 정직하게 말한다.
///
/// **디스크를 만지므로 블로킹 문맥에서만 부른다** (호출부인 `spawn_shell` 은 이미
/// `spawn_blocking` 안이다 — docs/conventions.md "Tauri 명령은 기본 async fn").
pub(crate) fn ensure_ps_script() -> Option<PathBuf> {
    let dir = crate::instance::config_root()?;
    write_if_changed(&dir, PS_SCRIPT_NAME, &ps_snippet_file())
}

/// `<dir>/<name>` 을 **내용이 다를 때만** 쓰고 그 경로를 돌려준다 — 로컬 훅 파일들의 공통 몸통.
///
/// 세 파일([`PS_SCRIPT_NAME`] · [`SH_SCRIPT_NAME`] · [`WSL_RC_NAME`])이 같은 규칙을 쓴다:
/// 같은 바이트면 다시 쓰지 않으므로 파일 mtime 이 "언제 훅이 바뀌었나" 를 정직하게 말하고,
/// 스니펫을 한 글자라도 고치면 다음 실행에서 자동으로 다시 쓰인다 (원격의 [`put_snippet`]
/// 과 같은 규칙 — **버전 문자열이 아니라 내용이 판정한다**).
///
/// 읽기 실패는 **없는 것으로 친다** — 부재든 권한이든 답은 뒤이은 쓰기가 준다.
/// 실패는 전부 `None` 이고 **세션 생성을 막지 않는다**: 훅이 없으면 폴더 보고가 안 올 뿐이다.
///
/// **줄바꿈은 `\n` 하나다.** 내용 문자열을 그대로 바이트로 쓰므로 윈도우에서도 CRLF 로
/// 부풀지 않는다 — `.sh`·`.rc` 는 리눅스 bash 가 읽는 파일이라 CR 이 섞이면
/// `$'\r': command not found` 로 죽는다.
fn write_if_changed(dir: &Path, name: &str, want: &str) -> Option<PathBuf> {
    let path = dir.join(name);
    if std::fs::read_to_string(&path).is_ok_and(|have| have == want) {
        return Some(path);
    }
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!(
            "[aynx] 로컬 셸 통합 폴더를 만들지 못했습니다 — 훅 없이 엽니다 ({}): {e}",
            dir.display()
        );
        return None;
    }
    match std::fs::write(&path, want.as_bytes()) {
        Ok(()) => Some(path),
        Err(e) => {
            eprintln!(
                "[aynx] 로컬 셸 통합 스크립트를 쓰지 못했습니다 — 훅 없이 엽니다 ({}): {e}",
                path.display()
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — WSL(bash) 에 원격과 **같은 스니펫**을 건다
// ---------------------------------------------------------------------------

/// WSL 이 읽는 스니펫 파일 이름 — 내용은 원격의 [`SNIPPET`] 과 **같은 바이트**다.
pub(crate) const SH_SCRIPT_NAME: &str = "integration.sh";

/// 그 스니펫을 사용자의 `~/.bashrc` **뒤에** 읽어 주는 얇은 rc 파일.
pub(crate) const WSL_RC_NAME: &str = "integration-wsl.rc";

/// 문자열 하나를 sh **작은따옴표 리터럴**로 감싼다 — **순수 함수**.
///
/// 작은따옴표 안에서는 모든 글자가 그대로다. 탈출이 필요한 것은 작은따옴표 자신뿐이고,
/// sh 에는 그 안에서 쓸 탈출 문법이 없어 **일단 닫고 붙였다가 다시 연다**(`'\''`).
/// (PowerShell 의 [`ps_single_quote`] 과 같은 자리, 다른 규칙.)
fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// 윈도우 경로 → WSL 의 `/mnt/<드라이브>/…` — **순수 함수**. 드라이브 문자가 아니면 `None`.
///
/// `C:\Users\x\AppData\Roaming\aynx` → `/mnt/c/Users/x/AppData/Roaming/aynx`.
/// 드라이브 문자는 **소문자**다 (`/mnt/C` 는 기본 설정의 WSL 에 없다).
///
/// UNC(`\\서버\공유\…`)에서 `None` 인 것이 중요하다 — 그런 자리에는 대응하는 `/mnt` 경로가
/// 없으므로 **주입을 통째로 건너뛴다**(훅 없이 그냥 띄운다). 설정 폴더가 네트워크 드라이브에
/// 있는 드문 경우고, 틀린 경로를 넘겨 셸이 "그런 파일 없음" 을 뱉게 하는 것보다 낫다.
fn windows_to_wsl_path(win: &str) -> Option<String> {
    drive_path(win, "/mnt/")
}

/// 윈도우 경로 → **MSYS(Git Bash)** 의 `/c/…` — **순수 함수**. 드라이브 문자가 아니면 `None`.
///
/// `C:\Users\x\AppData\Roaming\aynx` → `/c/Users/x/AppData/Roaming/aynx`.
/// [`windows_to_wsl_path`] 와 **규칙이 같고 앞머리만 다르다**(`/mnt/c` 대 `/c`) — 그래서
/// 몸통([`drive_path`])을 함께 쓴다. UNC·드라이브 상대 경로에서 `None` 인 것도 같은 이유다:
/// 그런 자리에는 대응하는 POSIX 경로가 없으므로 **주입을 통째로 건너뛴다**.
fn windows_to_msys_path(win: &str) -> Option<String> {
    drive_path(win, "/")
}

/// 두 변환의 공통 몸통 — `<접두사><소문자 드라이브><슬래시 경로>`. **순수 함수**.
///
/// 드라이브 문자는 **소문자**다 (`/mnt/C` 도 `/C` 도 없다). 꼬리 슬래시는 뗀다 —
/// `C:\` 가 `/mnt/c` · `/c` 가 되어 뒤에 `/파일` 을 붙일 때 슬래시가 겹치지 않는다.
fn drive_path(win: &str, prefix: &str) -> Option<String> {
    let bytes = win.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }
    let rest = &win[2..];
    if !rest.is_empty() && !rest.starts_with(['\\', '/']) {
        return None; // `C:relative` — 드라이브 상대 경로는 우리 것이 아니다
    }
    let drive = (bytes[0] as char).to_ascii_lowercase();
    let tail = rest.replace('\\', "/");
    Some(format!("{prefix}{drive}{}", tail.trim_end_matches('/')))
}

/// WSL bash 가 읽을 rc 파일의 **내용** — **순수 함수**.
///
/// `--rcfile` 을 주면 bash 는 **그 파일만** 읽는다. 사용자의 `~/.bashrc` 가 통째로 사라지면
/// 별칭도 프롬프트도 없는 낯선 셸이 되므로, 첫 줄에서 그것을 먼저 읽고 우리 스니펫을
/// **뒤에** 얹는다 (원격에서 `on_connect` 보다 스니펫이 먼저인 것과 방향이 반대인데,
/// 여기서는 사용자의 rc 가 `PROMPT_COMMAND` 를 세우고 우리가 그것을 감싸야 하기 때문이다).
///
/// `dir_in_wsl` 은 [`windows_to_wsl_path`] 가 옮긴 설정 폴더다. 공백·아포스트로피가 섞여도
/// [`sh_single_quote`] 한 겹이 덮는다.
fn wsl_rc_body(dir_in_wsl: &str) -> String {
    format!(
        "# aynx shell integration for WSL (v1) - generated; do not edit\n\
         [ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\
         . {}\n",
        sh_single_quote(&format!("{dir_in_wsl}/{SH_SCRIPT_NAME}"))
    )
}

/// `wsl.exe -d <배포판> -- sh -c '<이것>'` 로 넘길 **그 한 줄** — **순수 함수**.
///
/// ```sh
/// if [ "${SHELL##*/}" = bash ]; then exec bash --rcfile '<rc>' -i; else exec "${SHELL:-/bin/sh}" -l; fi
/// ```
///
/// - **bash 일 때만 훅이 붙는다.** zsh 는 `--rcfile` 에 해당하는 인자가 없고
///   `ZDOTDIR` 로 폴더 하나를 통째로 대신 세워야 한다 (`.zshrc` 를 우리가 쓰고 원본을 다시
///   읽어 주는 식) — **후속 작업**이다. fish 는 문법 자체가 다르다. 그 셸들은 평소의 로그인
///   셸로 그냥 뜬다: 훅이 없을 뿐 아무것도 깨지지 않는다.
/// - **`${SHELL:-/bin/sh}` 의 기본값이 있어야 한다.** `docker-desktop` 같은 내부 배포판은
///   `$SHELL` 이 비어 있을 수 있고, 그러면 `exec "" -l` 이 되어 셸이 아예 안 뜬다.
/// - **`--cd` 를 붙이지 않는다.** 시작 폴더 규칙은 이 기능이 생기기 전 그대로다.
/// - 판정에 `${SHELL##*/}` 를 쓰는 것은 `/usr/bin/bash` · `/bin/bash` 를 한 번에 덮기
///   위해서다 (경로가 아니라 이름으로 본다).
pub(crate) fn wsl_launch_script(rc_in_wsl: &str) -> String {
    format!(
        "if [ \"${{SHELL##*/}}\" = bash ]; then exec bash --rcfile {} -i; else exec \"${{SHELL:-/bin/sh}}\" -l; fi",
        sh_single_quote(rc_in_wsl)
    )
}

/// 두 파일(`integration.sh` · `integration-wsl.rc`)을 **내용이 다를 때만** 쓰고, rc 파일의
/// **WSL 쪽 경로**를 돌려준다. 하나라도 못 쓰면 `None` — 그러면 부르는 쪽이 훅 없이 띄운다.
///
/// **디스크를 만지므로 블로킹 문맥에서만 부른다** ([`ensure_ps_script`] 와 같은 규칙 —
/// 호출부인 `crate::pty::spawn_shell` 은 이미 `spawn_blocking` 안이다).
pub(crate) fn ensure_wsl_scripts() -> Option<String> {
    let dir = crate::instance::config_root()?;
    // 설정 폴더가 드라이브 문자 위에 없으면(UNC) WSL 에서 가리킬 자리가 없다 — 건너뛴다.
    let dir_in_wsl = windows_to_wsl_path(&dir.to_string_lossy())?;
    write_if_changed(&dir, SH_SCRIPT_NAME, &snippet_file())?;
    write_if_changed(&dir, WSL_RC_NAME, &wsl_rc_body(&dir_in_wsl))?;
    Some(format!("{dir_in_wsl}/{WSL_RC_NAME}"))
}

// ---------------------------------------------------------------------------
// 로컬 셸 통합 — Git Bash 도 같은 스니펫을 읽는다 (`--rcfile`)
// ---------------------------------------------------------------------------

/// Git Bash 가 `--rcfile` 로 읽는 파일 이름 ([`WSL_RC_NAME`] 과 같은 자리, 다른 내용).
pub(crate) const GITBASH_RC_NAME: &str = "integration-gitbash.rc";

/// 그 rc 의 **머리** — 로그인 셸이 읽던 프로필들을 대신 읽는다.
///
/// 지금까지 Git Bash 는 `bash.exe --login -i` 로 떴다. `--rcfile` 은 **대화형 non-login**
/// 셸에서만 보므로 `--login` 을 뗄 수밖에 없고, 그러면 `/etc/profile` 이 세우던
/// `PATH`·`MSYSTEM` 이 통째로 빈다 — [`PROFILE_CHAIN`] 이 그 자리를 메운다 (원격의
/// [`remote_rc_body`] 와 **같은 다섯 줄**이다).
const GITBASH_RC_HEAD: &str = "# aynx shell integration for Git Bash (v5) - generated; do not edit\n\
                               # --rcfile 로 뜨는 bash 는 로그인 셸이 아니다 - 로그인 순서를 여기서 대신 읽는다.\n";

/// 그 rc 의 **꼬리** — `__aynx_cwd` 를 Git Bash 용으로 갈아 끼운다.
///
/// # 왜 덮어쓰는가
///
/// [`SNIPPET`] 의 `__aynx_cwd` 는 `$PWD` 를 그대로 말한다. MSYS 에서 그 값은 `/c/Users/x` 라
/// **윈도우가 열 수 없는 경로**고, 로컬 파일 브라우저가 그것을 받으면 📂 가 깨진다 (지금은
/// PEB 읽기가 옳은 답을 주고 있다 — `crate::cwd`). 그래서 드라이브 앞머리만 되돌린다:
/// `/c/Users/x` → `/c:/Users/x` → 프런트의 `parseOsc7Cwd` 가 앞 슬래시를 벗겨 `c:/Users/x`.
///
/// `/tmp` 처럼 드라이브가 아닌 MSYS 가상 경로는 **그대로 둔다** — 대응하는 윈도우 폴더가
/// 없으므로 지어내지 않고, 브라우저가 못 열면 폴백이 홈을 연다.
///
/// `cygpath` 를 부르지 않는 것이 중요하다 — 프롬프트마다 프로세스를 하나 띄우게 된다.
const GITBASH_RC_TAIL: &str = "__aynx_cwd(){ local p=$PWD; case $p in /[A-Za-z]/*|/[A-Za-z]) p=\"/${p:1:1}:${p:2}\";; esac; if [ -n \"$TMUX\" ]; then printf '\\033Ptmux;\\033\\033]7;file://localhost%s\\007\\033\\\\' \"$p\"; else printf '\\033]7;file://localhost%s\\007' \"$p\"; fi; }\n";

/// 손으로 친 `claude` · `codex` 를 앱이 띄운 것과 같게 — bash 감싸개(Git Bash rc 의 맨 끝). [`PS_AGENT_WRAPPER`] 와 같은 규칙:
/// `AYNX_STREAM` 과, `AYNX_TILE_AGENT`(장식 파일 경로) 또는 `AYNX_CODEX_NO_DAEMON=1` 이 있을 때만 정의하고(`claude` 는 장식 파일 경로가 있을
/// 때만), 사용자가 이미 그 이름의 함수를 세웠으면 건드리지 않는다. 장식 파일의 `AYNX_ARGS_<에이전트>=` 줄만 읽어(소스 · `eval` 없음)
/// `IFS=$'\037' read -a` 로 나눈다(글롭 없음). 자리 · `--no-daemon` 규칙도 같다. 진짜 실행 파일은 `command claude` · `command codex`(함수를 건너뛴다).
///
/// `function codex { … }` 꼴로 쓴다 — `codex(){` 꼴은 사용자의 `alias codex=…` 가 정의 줄에서 먼저 풀려 깨진다.
/// 정의는 한 번 쓰고 버리는 함수 안에서 한다(전역에 남는 것은 `claude` · `codex` 와 공용 몸 `__aynx_agent`). `!` 를 쓰지 않는다([`SNIPPET`] 의 규칙).
///
/// WSL 에는 걸지 않는다 — 윈도우 쪽 `AYNX_*` 가 배포판 안으로 건너가지 않고(WSLENV 를 쓰지 않는다), 배포판 안의
/// codex 판을 모른다. 원격(SSH)은 [`SNIPPET`] 안의 `codex` 감싸개(`__aynx_codex_arm`, v6 — 2026-10-08 사용자
/// 결정)와 PATH 심(`crate::agent_shim`)이 맡는다 — 서버의 codex 가 `--no-daemon` 을 모르는 옛 판이면 그 실행이 인자 오류로 멎는다(설정 `[ai]
/// codex_no_daemon` 을 끄면 표식이 빠진다).
const GITBASH_AGENT_WRAPPER: &str = r#"function __aynx_agent {
  local __n=$1 __k=AYNX_ARGS_CODEX= __l __v= __nd= __h=() __w=()
  shift
  [ "$__n" = claude ] && __k=AYNX_ARGS_CLAUDE=
  if [ -n "$AYNX_TILE_AGENT" ] && [ -r "$AYNX_TILE_AGENT" ]; then
    while IFS= read -r __l || [ -n "$__l" ]; do
      case $__l in "$__k"?*) __v=${__l#"$__k"} ;; esac
    done < "$AYNX_TILE_AGENT"
    [ -n "$__v" ] && IFS=$'\037' read -r -a __w <<< "$__v"
  fi
  if [ "$__n" = claude ]; then
    command claude "$@" "${__w[@]}"
    return
  fi
  [ "$AYNX_CODEX_NO_DAEMON" = 1 ] && __nd=1
  for __l in "$@" "${__w[@]}"; do
    case $__l in --no-daemon|--remote|--remote=*) __nd= ;; esac
  done
  case $1 in resume|fork) __h=("$1"); shift ;; esac
  while [ "$#" -gt 0 ] && [ "$1" = --no-daemon ]; do __h+=("$1"); shift; done
  [ -n "$__nd" ] && __h+=(--no-daemon)
  command codex "${__h[@]}" "${__w[@]}" "$@"
}
__aynx_agent_wrap(){
  [ -n "$AYNX_STREAM" ] || return 0
  if [ -n "$AYNX_TILE_AGENT" ]; then
    declare -F claude >/dev/null 2>&1 || function claude { __aynx_agent claude "$@"; }
  fi
  if [ -n "$AYNX_TILE_AGENT" ] || [ "$AYNX_CODEX_NO_DAEMON" = 1 ]; then
    declare -F codex >/dev/null 2>&1 || function codex { __aynx_agent codex "$@"; }
  fi
}
__aynx_agent_wrap; unset -f __aynx_agent_wrap
"#;

/// Git Bash 가 읽을 rc 파일의 **내용** — **순수 함수**.
///
/// `dir_in_msys` 는 [`windows_to_msys_path`] 가 옮긴 설정 폴더(`/c/Users/…/aynx`)다.
/// 순서가 계약이다: 프로필 → 스니펫 → `__aynx_cwd` 덮어쓰기 (덮어쓰기는 스니펫이 그 함수를
/// 정의한 **뒤**여야 한다).
///
/// **줄바꿈은 LF 하나다** — MSYS bash 도 CR 이 섞이면 `$'\r': command not found` 로 죽는다.
fn gitbash_rc_body(dir_in_msys: &str) -> String {
    let snippet = sh_single_quote(&format!("{dir_in_msys}/{SH_SCRIPT_NAME}"));
    let mut out = String::with_capacity(768);
    out.push_str(GITBASH_RC_HEAD);
    out.push_str(PROFILE_CHAIN);
    out.push_str("[ -f ");
    out.push_str(&snippet);
    out.push_str(" ] && . ");
    out.push_str(&snippet);
    out.push('\n');
    out.push_str(GITBASH_RC_TAIL);
    out.push_str(GITBASH_AGENT_WRAPPER);
    out
}

/// 두 파일(`integration.sh` · `integration-gitbash.rc`)을 **내용이 다를 때만** 쓰고, rc 의
/// **MSYS 쪽 경로**를 돌려준다. 하나라도 못 쓰면 `None` — 그러면 부르는 쪽이
/// 옛 argv(`bash.exe --login -i`)로 그냥 띄운다.
///
/// **디스크를 만지므로 블로킹 문맥에서만 부른다** ([`ensure_wsl_scripts`] 와 같은 규칙).
pub(crate) fn ensure_gitbash_scripts() -> Option<String> {
    let dir = crate::instance::config_root()?;
    // 설정 폴더가 드라이브 문자 위에 없으면(UNC) MSYS 에서 가리킬 자리가 없다 — 건너뛴다.
    let dir_in_msys = windows_to_msys_path(&dir.to_string_lossy())?;
    write_if_changed(&dir, SH_SCRIPT_NAME, &snippet_file())?;
    write_if_changed(&dir, GITBASH_RC_NAME, &gitbash_rc_body(&dir_in_msys))?;
    Some(format!("{dir_in_msys}/{GITBASH_RC_NAME}"))
}

#[cfg(test)]
mod tests;
