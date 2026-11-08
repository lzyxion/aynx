//! **프로젝트 설정 스크립트** — 새 워크트리를 만들 때 그 타일에서 에이전트보다 먼저 한 번 도는 여러 줄
//! (docs/log/2026-09-28-project-agent-setup-script.md).
//!
//! 스크립트 글자는 `projects.json` 의 그 프로젝트 줄에만 산다(`crate::projects::Project::setup_script`). 여기는
//! 그것을 **타일의 셸이 안전하게 돌릴 한 줄**로 바꾸는 자리다. 프런트는 프로젝트 id 만 넘기고 글자를 싣지 않는다 —
//! 스크립트는 이 모듈이 파일에서 직접 읽는다([`crate::projects::find_blocking`]). MCP 에는 이 길이 없다.
//!
//! ## 왜 여러 줄을 키로 치지 않나
//!
//! 여러 줄을 PTY 에 그대로 치면 줄마다 Enter 가 되고, PSReadLine · zsh 의 자동 완성 · 괄호 짝 맞추기 · 여러 줄
//! 붙여넣기 확인이 끼어든다(사람이 친 것과 다른 것이 돈다). 그래서 **타일에 치는 것은 언제나 한 줄**이고, 여러 줄은
//! 그 한 줄이 가리키는 곳에 산다:
//!
//! | 셸 | 치는 한 줄 | 스크립트가 사는 곳 | 실패 판정 |
//! | --- | --- | --- | --- |
//! | PowerShell(pwsh · powershell) | `pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File '<파일>'` | 앱 데이터 폴더의 임시 `.ps1`(BOM UTF-8 — 5.1 이 한글을 읽는다) · 스크립트는 base64 로 그 안에 | **문장마다** — 파서로 최상위 문장을 하나씩 돌리고(`> 문장` 을 먼저 찍는다) cmdlet 오류(`$ErrorActionPreference='Stop'`)나 네이티브 명령의 0 아닌 `$LASTEXITCODE` 에서 멈춘다 |
//! | cmd | `cmd /d /c "<파일>"` | 임시 `.cmd` 둘(감싸개 + 본문) · 도는 동안만 `chcp 65001` | 본문 **전체의 종료 코드**(마지막 명령) — cmd 에는 줄마다 멈추는 장치가 없다. 멈추려면 줄 끝에 `\|\| exit /b 1` |
//! | POSIX 로컬(Git Bash · WSL) | `sh '<데이터 폴더>/setup-run/run-<nonce>.sh'`(그 셸이 읽는 꼴 — `/c/…` · `/mnt/c/…`) | 임시 `.sh`(LF · BOM 없음) — 못 쓰면 아래 한 줄 | **줄마다** — `sh -e`(`set -e` 의 규칙) + `set -x`(`PS4='> '`)로 도는 명령을 찍는다 |
//! | 원격(첫 입력 · [다시 실행]) | `sh "$HOME/.cache/aynx/setup-<nonce>.sh"` | 같은 프로그램을 그 세션의 exec 로 서버 파일에 먼저 쓴다([`RemoteSetup`] — 못 쓰면 아래 한 줄) | 위와 같다 |
//! | 폴백(파일을 못 썼다) | `sh -c '<프로그램>'` | 그 한 줄 안 — 스크립트는 `printf %b` 의 8진 이스케이프로(치는 글자는 **전부 ASCII**) | 위와 같다 |
//!
//! 임시 파일은 스크립트가 끝나며 스스로 지우고, 남은 것(창을 닫아 끊긴 것)은 다음 부름이 하루 지난 것을 걷는다.
//! PowerShell 은 **자식** 프로세스로 돈다(`-NoProfile` — 프로필의 환경은 타일의 셸에서 이미 물려받았다 · 스크립트의
//! `exit` 가 타일의 셸을 닫지 않는다). 실행 정책은 이 파일에만 `Bypass` 다.
//!
//! ## 끝 신호 — OSC 7717
//!
//! 어느 셸이든 마지막에 `ESC ] 7717 ; aynx-setup ; <nonce> ; <종료 코드> BEL` 을 찍는다. 타일(`Terminal.svelte`)이
//! 그 타일이 기다리는 nonce 일 때만 받아 — 성공이면 에이전트를 띄우고, 실패면 오류 막대를 세운다. 로컬 ConPTY 도
//! 모르는 OSC 를 그대로 통과시킨다(2026-09-28 실측 — pwsh · cmd 둘 다, BEL · ST 둘 다). 원격은 에이전트가 같은 줄에
//! `&& <에이전트>` 로 붙어 있어 신호 없이도 성공일 때만 뜬다(신호는 막대와 기록에 쓴다).
//!
//! ## 환경
//!
//! `AYNX_ROOT_PATH` = 프로젝트의 **주 작업 폴더**(저장소). 스크립트는 그 워크트리 폴더에서 돈다(`cd` 를 먼저 한다).
//! Git Bash 는 `/c/…`, WSL 은 `/mnt/c/…` 꼴로 옮겨 준다.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::i18n::tr;
use crate::ssh::sh_quote;

/// 끝 신호의 OSC 번호 — 프런트 `src/lib/setup-script.ts` 의 `SETUP_OSC` 와 같은 수.
pub(crate) const SETUP_OSC: u32 = 7717;

/// 끝 신호의 첫 칸 — 같은 번호를 다른 프로그램이 써도 이 글자가 아니면 타일이 무시한다.
const SETUP_TAG: &str = "aynx-setup";

/// 임시 파일이 사는 폴더 이름(`<data_root>/setup-run/`).
const RUN_DIR: &str = "setup-run";

/// 남은 임시 파일을 걷는 나이.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// 스크립트를 돌릴 셸의 모양.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScriptShell {
    /// 실행 파일 이름 — `pwsh` · `powershell`
    PowerShell(&'static str),
    Cmd,
    Posix(PathStyle),
}

/// POSIX 셸이 이 PC 의 경로를 읽는 모양.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathStyle {
    /// 그대로(원격 · 리눅스·맥의 로컬 셸)
    Native,
    /// WSL — `C:\x` → `/mnt/c/x`
    Wsl,
    /// Git Bash(MSYS) — `C:\x` → `/c/x`
    Msys,
}

/// 타일의 셸 id(`crate::pty::ShellInfo.id`) → 모양. 모르면 OS 의 기본 셸 모양이다([`default_shell`]).
pub(crate) fn shell_of(id: Option<&str>) -> ScriptShell {
    match id {
        Some("pwsh") => ScriptShell::PowerShell("pwsh"),
        Some("powershell") => ScriptShell::PowerShell("powershell"),
        Some("cmd") => ScriptShell::Cmd,
        Some("gitbash") => ScriptShell::Posix(PathStyle::Msys),
        Some(s) if s.starts_with("wsl:") => ScriptShell::Posix(PathStyle::Wsl),
        _ => default_shell(),
    }
}

/// 셸을 모를 때의 모양 — **OS 를 타는 곳은 여기 하나다**(Windows 는 Windows PowerShell, 그 밖은 POSIX).
fn default_shell() -> ScriptShell {
    #[cfg(windows)]
    {
        ScriptShell::PowerShell("powershell")
    }
    #[cfg(not(windows))]
    {
        ScriptShell::Posix(PathStyle::Native)
    }
}

// ---------------------------------------------------------------------------
// 문구 — 스크립트가 찍는 줄들
// ---------------------------------------------------------------------------

/// 자리표시를 가르는 표지 — 문구 안의 `{secs}` · `{code}` 자리에 끼워 둔 뒤 여기서 앞·뒤로 자른다.
const CUT: &str = "\u{1}";

/// 스크립트가 찍는 줄들 — 앞·뒤 조각(숫자는 셸이 그 사이에 넣는다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Labels {
    pub header: String,
    pub ok_pre: String,
    pub ok_post: String,
    /// 걸린 시간을 재지 않는 셸(cmd)의 성공 줄
    pub ok_plain: String,
    pub fail_pre: String,
    pub fail_post: String,
    /// 성공 줄 꼬리 — `· Claude Code 를 띄웁니다`(띄울 에이전트가 없으면 빈 글자)
    pub ok_tail: String,
    /// 실패 줄 꼬리 — `· 에이전트를 띄우지 않았습니다`(띄울 에이전트가 없었으면 빈 글자)
    pub fail_tail: String,
}

fn cut(s: String) -> (String, String) {
    match s.split_once(CUT) {
        Some((a, b)) => (a.to_string(), b.to_string()),
        None => (s, String::new()),
    }
}

/// 문구를 짓는다 — `agent` 는 성공하면 띄울 에이전트의 제품 이름.
pub(crate) fn labels(project: &str, agent: Option<&str>) -> Labels {
    let (ok_pre, ok_post) = cut(tr!(
        ko: "✓ 설정 스크립트 끝 ({secs}초)",
        en: "✓ Setup script done ({secs}s)",
        secs = CUT
    ));
    let (fail_pre, fail_post) = cut(tr!(
        ko: "✗ 설정 스크립트 실패 (종료 코드 {code})",
        en: "✗ Setup script failed (exit code {code})",
        code = CUT
    ));
    Labels {
        header: tr!(ko: "── 설정 스크립트 · {project} ──", en: "── Setup script · {project} ──"),
        ok_pre,
        ok_post,
        ok_plain: tr!(ko: "✓ 설정 스크립트 끝", en: "✓ Setup script done"),
        fail_pre,
        fail_post,
        ok_tail: agent
            .map(|a| tr!(ko: " · {a} 를 띄웁니다", en: " · starting {a}"))
            .unwrap_or_default(),
        fail_tail: agent
            .map(|_| tr!(ko: " · 에이전트를 띄우지 않았습니다", en: " · the agent was not started"))
            .unwrap_or_default(),
    }
}

// ---------------------------------------------------------------------------
// POSIX — 한 줄 안에 전부 (Git Bash · WSL · 원격)
// ---------------------------------------------------------------------------

/// `printf %b` 가 읽을 글자로 — **순수 함수**. 영숫자 · 공백 · `-_.,:/@+=%^~#` 는 그대로, 나머지 바이트는 전부
/// `\0NNN`(8진)이다. 그래서 결과는 **ASCII 뿐**이고 `"` 안에 그대로 넣어도 셸이 건드릴 글자(`$` `` ` `` `"` `\` `!`)가
/// 없다 — `'` 도 없어서 바깥의 `sh -c '…'` 인용이 한 겹으로 끝난다(fish 의 작은따옴표 규칙으로도 같은 글자다 — 실측 전).
/// `\\` 도 만들지 않는다(fish 는 작은따옴표 안의 `\\` 를 `\` 로 읽는다) — 역슬래시도 `\0134` 다.
pub(crate) fn printf_b_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        let keep = b.is_ascii_alphanumeric() || b" -_.,:/@+=%^~#".contains(&b);
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("\\0{b:03o}"));
        }
    }
    out
}

/// 경로를 `"…"` 식 하나로 — 앞의 `~` 는 `$HOME` 으로 펴고 나머지는 [`printf_b_escape`] 를 지난 글자를 명령 치환으로
/// 되살린다(**순수 함수**). 예: `~/api` → `"$HOME/$(printf %b "api")"`.
pub(crate) fn posix_path_expr(path: &str) -> String {
    let p = path.trim();
    if p == "~" {
        return "\"$HOME\"".to_string();
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return format!("\"$HOME/$(printf %b \"{}\")\"", printf_b_escape(rest));
    }
    format!("\"$(printf %b \"{}\")\"", printf_b_escape(p))
}

/// 이 PC 의 경로를 그 POSIX 셸이 읽는 꼴로 (**순수 함수**). 드라이브 경로만 옮긴다 — `C:\src\x` →
/// `/c/src/x`(Git Bash) · `/mnt/c/src/x`(WSL). UNC 는 Git Bash 면 `//srv/share`, WSL 이면 그대로다.
pub(crate) fn posix_local_path(path: &str, style: PathStyle) -> String {
    let p = path.trim();
    if style == PathStyle::Native {
        return p.to_string();
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        let drive = (b[0] as char).to_ascii_lowercase();
        let rest = p[2..].replace('\\', "/");
        let rest = rest.trim_end_matches('/');
        let head = if style == PathStyle::Wsl {
            format!("/mnt/{drive}")
        } else {
            format!("/{drive}")
        };
        return if rest.is_empty() {
            head
        } else if rest.starts_with('/') {
            format!("{head}{rest}")
        } else {
            format!("{head}/{rest}")
        };
    }
    if style == PathStyle::Msys && p.starts_with("\\\\") {
        return p.replace('\\', "/");
    }
    p.to_string()
}

/// POSIX 프로그램 한 줄 — `sh -c` 에 실린다(**순수 함수**). `cwd`·`root` 는 이미 [`posix_path_expr`] 를 지난 식이다.
///
/// 1. 워크트리 폴더로 들어가고(`cd` 가 실패하면 종료 코드 1 로 멈춘다 — 신호는 찍는다) `AYNX_ROOT_PATH` 를 export.
/// 2. 머리줄 → `sh -e -c "<본문>"`(본문 = `PS4='> '` + `set -x` + 스크립트 — 도는 명령마다 `> 명령` 이 찍힌다).
/// 3. 결과 줄(성공: 걸린 초 · 실패: 종료 코드) → 끝 신호(OSC 7717) → 그 종료 코드로 끝난다(`&& 에이전트` 가 갈린다).
pub(crate) fn posix_program(
    cwd: &str,
    root: &str,
    script: &str,
    nonce: &str,
    l: &Labels,
) -> String {
    let body = format!("PS4='> '\nset -x\n{script}\n");
    let e = printf_b_escape;
    format!(
        "rc=0; cd -- {cwd} || rc=1; \
         if [ \"$rc\" -eq 0 ]; then \
         AYNX_ROOT_PATH={root}; export AYNX_ROOT_PATH; \
         t0=$(date +%s 2>/dev/null); \
         printf \"\\033[90m%b\\033[0m\\n\" \"{header}\"; \
         sh -e -c \"$(printf %b \"{body}\")\"; rc=$?; \
         el=$(expr \"$(date +%s 2>/dev/null)\" - \"$t0\" 2>/dev/null); \
         fi; \
         if [ \"$rc\" -eq 0 ]; then \
         printf \"\\033[32m%b%s%b\\033[0m\\033[90m%b\\033[0m\\n\" \"{ok_pre}\" \"$el\" \"{ok_post}\" \"{ok_tail}\"; \
         else \
         printf \"\\033[31m%b%s%b\\033[0m\\033[90m%b\\033[0m\\n\" \"{fail_pre}\" \"$rc\" \"{fail_post}\" \"{fail_tail}\"; \
         fi; \
         printf \"\\033]{osc};{tag};{nonce};%s\\007\" \"$rc\"; \
         exit \"$rc\"",
        header = e(&l.header),
        body = e(&body),
        ok_pre = e(&l.ok_pre),
        ok_post = e(&l.ok_post),
        ok_tail = e(&l.ok_tail),
        fail_pre = e(&l.fail_pre),
        fail_post = e(&l.fail_post),
        fail_tail = e(&l.fail_tail),
        osc = SETUP_OSC,
        tag = SETUP_TAG,
    )
}

/// 타일에 칠 한 줄 — `sh -c '<프로그램>'`(**순수 함수**). 프로그램에 `'` 가 없으므로 인용은 한 겹이다.
pub(crate) fn posix_line(program: &str) -> String {
    format!("sh -c {}", sh_quote(program))
}

// ---------------------------------------------------------------------------
// PowerShell — 임시 .ps1 (자식 프로세스)
// ---------------------------------------------------------------------------

/// 표준 base64 (패딩 있음) — 감싸개에 스크립트를 싣는 데만 쓴다(의존성 하나를 들이지 않으려고 여기 짧게 둔다).
pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// PowerShell 작은따옴표 글자 — `'` 는 `''`.
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// PowerShell 감싸개 파일의 본문 (**순수 함수**) — 모듈 머리말의 표. 스크립트는 base64(UTF-8)로 싣는다(어떤 글자든
/// here-string 끝 표지와 부딪치지 않는다).
pub(crate) fn powershell_wrapper(
    cwd: &str,
    root: &str,
    script: &str,
    nonce: &str,
    l: &Labels,
) -> String {
    let b64 = base64_encode(script.as_bytes());
    let q = ps_quote;
    format!(
        r#"# aynx 설정 스크립트 — 끝나면 이 파일은 스스로 지워진다 (docs/log/2026-09-28-project-agent-setup-script.md)
$ErrorActionPreference = 'Stop'
$aynxCode = 0
$aynxDone = $false
$global:aynxExit = $null
$aynxWatch = [Diagnostics.Stopwatch]::StartNew()
# `exit N` 은 잡을 수 없는 흐름이라(이 파일의 finally 는 돌지만 N 을 모른다) 돌리기 전에 글자를 바꿔 둔다 — N 을 적고 던진다.
function aynxRewrite($node) {{
    $text = $node.Extent.Text
    $base = $node.Extent.StartOffset
    $exits = @($node.FindAll({{ param($n) $n -is [System.Management.Automation.Language.ExitStatementAst] }}, $true)) |
        Sort-Object {{ $_.Extent.StartOffset }} -Descending
    foreach ($x in $exits) {{
        $v = if ($x.Pipeline) {{ $x.Pipeline.Extent.Text }} else {{ '0' }}
        $text = $text.Substring(0, $x.Extent.StartOffset - $base) + "`$global:aynxExit = ($v); throw 'aynx-exit'" + $text.Substring($x.Extent.EndOffset - $base)
    }}
    $text
}}
try {{
    Set-Location -LiteralPath {cwd}
    $env:AYNX_ROOT_PATH = {root}
    Write-Host {header} -ForegroundColor DarkGray
    $aynxSrc = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{b64}'))
    $aynxErrors = $null
    $aynxAst = [System.Management.Automation.Language.Parser]::ParseInput($aynxSrc, [ref]$null, [ref]$aynxErrors)
    if ($aynxErrors -and $aynxErrors.Count -gt 0) {{
        Write-Host ($aynxErrors[0].ToString()) -ForegroundColor Red
        $aynxCode = 1
    }} elseif ($null -eq $aynxAst.EndBlock -or $aynxAst.BeginBlock -or $aynxAst.ProcessBlock -or $aynxAst.ParamBlock) {{
        $global:LASTEXITCODE = 0
        . ([ScriptBlock]::Create((aynxRewrite $aynxAst)))
        if ($LASTEXITCODE) {{ $aynxCode = $LASTEXITCODE }}
    }} else {{
        foreach ($aynxSt in $aynxAst.EndBlock.Statements) {{
            $aynxText = $aynxSt.Extent.Text
            $aynxShown = ($aynxText -split "`r?`n")[0]
            if ($aynxText.Contains("`n")) {{ $aynxShown += ' …' }}
            Write-Host ('> ' + $aynxShown) -ForegroundColor DarkGray
            $global:LASTEXITCODE = 0
            . ([ScriptBlock]::Create((aynxRewrite $aynxSt)))
            if ($LASTEXITCODE) {{ $aynxCode = $LASTEXITCODE; break }}
        }}
    }}
    $aynxDone = $true
}} catch {{
    $aynxDone = $true
    if ($null -ne $global:aynxExit) {{
        try {{ $aynxCode = [int]$global:aynxExit }} catch {{ $aynxCode = 1 }}
    }} else {{
        Write-Host (($_ | Out-String).TrimEnd()) -ForegroundColor Red
        if ($LASTEXITCODE) {{ $aynxCode = $LASTEXITCODE }} else {{ $aynxCode = 1 }}
    }}
}} finally {{
    # 끝까지 오지 못했다(Ctrl+C 등) — 실패로 본다.
    if (-not $aynxDone) {{ $aynxCode = 1 }}
    if ($aynxCode -eq 0) {{
        $aynxSecs = [Math]::Round($aynxWatch.Elapsed.TotalSeconds, 1).ToString([Globalization.CultureInfo]::InvariantCulture)
        Write-Host ({ok_pre} + $aynxSecs + {ok_post}) -ForegroundColor Green -NoNewline
        Write-Host {ok_tail} -ForegroundColor DarkGray
    }} else {{
        Write-Host ({fail_pre} + $aynxCode + {fail_post}) -ForegroundColor Red -NoNewline
        Write-Host {fail_tail} -ForegroundColor DarkGray
    }}
    [Console]::Write([string][char]27 + ']{osc};{tag};{nonce};' + $aynxCode + [string][char]7)
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}}
exit $aynxCode
"#,
        cwd = q(cwd),
        root = q(root),
        header = q(&l.header),
        ok_pre = q(&l.ok_pre),
        ok_post = q(&l.ok_post),
        ok_tail = q(&l.ok_tail),
        fail_pre = q(&l.fail_pre),
        fail_post = q(&l.fail_post),
        fail_tail = q(&l.fail_tail),
        osc = SETUP_OSC,
        tag = SETUP_TAG,
    )
}

/// PowerShell 타일에 칠 한 줄 (**순수 함수**) — 같은 PowerShell 을 자식으로 띄워 그 파일 하나만 돌린다.
pub(crate) fn powershell_line(exe: &str, file: &Path) -> String {
    format!(
        "{exe} -NoLogo -NoProfile -ExecutionPolicy Bypass -File {}",
        ps_quote(&file.to_string_lossy())
    )
}

// ---------------------------------------------------------------------------
// cmd — 임시 .cmd 둘
// ---------------------------------------------------------------------------

/// cmd 의 `echo` 에 실을 글자 — `^ & | < > %` 를 막는다(**순수 함수**).
fn cmd_echo(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '^' | '&' | '|' | '<' | '>' => {
                out.push('^');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out
}

/// cmd 감싸개 파일의 본문 (**순수 함수**) — 본문 파일(`body`)을 `call` 하고 그 종료 코드로 가른다. 한글이 섞인
/// 줄은 전부 `chcp 65001` **뒤**에 있다(cmd 는 배치 파일을 그 줄을 읽는 순간의 코드 페이지로 읽는다). 끝에서 코드
/// 페이지를 되돌리고 두 파일을 지운다(`(goto)` — 도는 배치 파일이 자기를 지우는 cmd 의 관용구). ESC 는 파일에
/// 글자 그대로 넣는다(`echo` 가 그대로 내보낸다 — `prompt $E` 요령보다 곧다).
pub(crate) fn cmd_wrapper(cwd: &str, root: &str, body: &Path, nonce: &str, l: &Labels) -> String {
    let body = body.to_string_lossy();
    let lines = [
        "@echo off".to_string(),
        "for /f \"tokens=2 delims=:.\" %%a in ('chcp') do set \"AYNX_CP=%%a\"".to_string(),
        "chcp 65001 >nul".to_string(),
        "set \"AYNX_ESC=\u{1b}\"".to_string(),
        format!("set \"AYNX_ROOT_PATH={root}\""),
        "set \"AYNX_RC=1\"".to_string(),
        format!("cd /d \"{cwd}\" || goto aynx_done"),
        format!("echo %AYNX_ESC%[90m{}%AYNX_ESC%[0m", cmd_echo(&l.header)),
        format!("call \"{body}\""),
        "set \"AYNX_RC=%ERRORLEVEL%\"".to_string(),
        ":aynx_done".to_string(),
        "if not \"%AYNX_RC%\"==\"0\" goto aynx_fail".to_string(),
        format!(
            "echo %AYNX_ESC%[32m{}%AYNX_ESC%[0m%AYNX_ESC%[90m{}%AYNX_ESC%[0m",
            cmd_echo(&l.ok_plain),
            cmd_echo(&l.ok_tail)
        ),
        "goto aynx_end".to_string(),
        ":aynx_fail".to_string(),
        format!(
            "echo %AYNX_ESC%[31m{}%AYNX_RC%{}%AYNX_ESC%[0m%AYNX_ESC%[90m{}%AYNX_ESC%[0m",
            cmd_echo(&l.fail_pre),
            cmd_echo(&l.fail_post),
            cmd_echo(&l.fail_tail)
        ),
        ":aynx_end".to_string(),
        format!("<nul set /p \"=%AYNX_ESC%]{SETUP_OSC};{SETUP_TAG};{nonce};%AYNX_RC%%AYNX_ESC%\\\""),
        "echo.".to_string(),
        "if defined AYNX_CP chcp %AYNX_CP% >nul".to_string(),
        format!("del \"{body}\" 2>nul"),
        "(goto) 2>nul & del \"%~f0\" & exit /b %AYNX_RC%".to_string(),
    ];
    let mut out = lines.join("\r\n");
    out.push_str("\r\n");
    out
}

/// cmd 타일에 칠 한 줄 (**순수 함수**) — 자식 cmd 로 돌린다(본문의 `exit` 가 타일의 cmd 를 닫지 않게).
pub(crate) fn cmd_line(file: &Path) -> String {
    format!("cmd /d /c \"{}\"", file.to_string_lossy())
}

// ---------------------------------------------------------------------------
// 조립 — 프로젝트 id 로
// ---------------------------------------------------------------------------

/// nonce 검사 — 16진 8~64자만(끝 신호 · 파일 이름에 들어간다).
fn check_nonce(nonce: &str) -> Result<(), String> {
    let ok = (8..=64).contains(&nonce.len()) && nonce.bytes().all(|b| b.is_ascii_hexdigit());
    if ok {
        Ok(())
    } else {
        Err(
            tr!(ko: "설정 스크립트 신호 값이 올바르지 않습니다", en: "The setup script signal value is not valid"),
        )
    }
}

/// 임시 파일 폴더 — 없으면 만들고, 하루 지난 것을 걷는다.
fn run_dir() -> Result<PathBuf, String> {
    let dir = crate::instance::data_root()
        .ok_or_else(crate::app_state::missing_dir)?
        .join(RUN_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let now = SystemTime::now();
        for e in entries.flatten() {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .is_some_and(|age| age > STALE_AFTER);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(dir)
}

/// 스크립트가 있는 프로젝트를 읽는다 — 없거나 스크립트가 비었으면 사람이 읽을 한 줄.
fn project_with_script(project_id: &str) -> Result<crate::projects::Project, String> {
    let p = crate::projects::find_blocking(project_id).ok_or_else(
        || tr!(ko: "프로젝트를 찾을 수 없습니다", en: "The project could not be found"),
    )?;
    if p.setup_script.trim().is_empty() {
        return Err(
            tr!(ko: "이 프로젝트에는 설정 스크립트가 없습니다", en: "This project has no setup script"),
        );
    }
    Ok(p)
}

/// 원격 첫 입력의 설정 스크립트 재료 — [`remote_start_command`] 가 짓는다. `Debug` 는 일부러 없다(`write_command` ·
/// `long` 에 스크립트가 인코딩돼 들어 있다 — 로그에 남기지 않는다).
pub(crate) struct RemoteSetup {
    /// 서버에 스크립트 파일을 먼저 써 두는 exec 명령([`remote_write_command`]).
    pub write_command: String,
    /// 파일이 써졌을 때 명령 자리에 설 짧은 줄 — `sh "$HOME/.cache/aynx/setup-<nonce>.sh" && <명령>`.
    pub short: String,
    /// 쓰지 못했을 때의 명령 자리 — 예전의 긴 한 줄(`sh -c '<프로그램>' && <명령>`).
    pub long: String,
}

/// 원격 임시 파일 폴더 — 셸 식(`"$HOME/…"`). exec 채널과 타일의 셸이 같은 `$HOME` 을 편다(`XDG_RUNTIME_DIR` ·
/// `/tmp` 는 exec 세션과 tmux 서버 안에서 같다는 보장이 없어 쓰지 않는다).
const REMOTE_RUN_DIR: &str = "\"$HOME/.cache/aynx\"";

/// 원격 임시 파일 경로의 셸 식 (**순수 함수**) — nonce 는 [`check_nonce`] 를 지난 16진이다.
pub(crate) fn remote_file_expr(nonce: &str) -> String {
    format!("\"$HOME/.cache/aynx/setup-{nonce}.sh\"")
}

/// POSIX 임시 파일(원격 · 로컬 Git Bash · WSL)의 본문 (**순수 함수**) — 첫 줄에서 **자기를 지운다**(`sh <파일>` 이라
/// `$0` 이 그 경로다 · 이미 연 파일은 지워져도 끝까지 읽힌다 — 도중에 Ctrl+C 로 끊겨도 남지 않는다). 그다음은 한 줄
/// 판과 같은 프로그램이다. 프로그램이 ASCII 뿐이라 글자는 인코딩과 무관하고, 줄 끝은 LF 다.
pub(crate) fn posix_file_body(program: &str) -> String {
    format!("rm -f -- \"$0\"\n{program}\n")
}

/// 로컬 POSIX 셸이 이 파일을 돌리는 짧은 줄 (**순수 함수**) — `path` 는 그 셸이 읽는 꼴([`posix_local_path`]).
/// 경로가 [`printf_b_escape`] 가 그대로 두는 글자뿐이면 `sh '<경로>'`, 아니면(한글 사용자 이름 등) 치는 글자가
/// ASCII 로 남도록 `sh "$(printf %b "…")"` 다.
pub(crate) fn posix_file_line(path: &str) -> String {
    if printf_b_escape(path) == path {
        format!("sh {}", sh_quote(path))
    } else {
        format!("sh {}", posix_path_expr(path))
    }
}

/// 이 사용자만 읽는 파일로 쓴다 — 유닉스는 `0o600`(스크립트 글자가 들어 있다). Windows 는 데이터 폴더가 사용자
/// 프로필 아래라 그 ACL 로 이미 막힌다(`audit::open_append` 와 같은 판단).
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)?.write_all(bytes)
}

/// 서버에 파일을 쓰는 exec 명령 (**순수 함수**) — `sh -c '<W>'`. 본문은 [`printf_b_escape`] 를 지나 `'` · `"` · `$` 가
/// 없으므로 인용이 한 겹이다(로그인 셸이 fish 여도 같은 글자). `umask 077` 이라 파일은 600, 폴더는 700 으로 선다.
/// 하루 지난 `setup-*.sh`(타일이 치기 전에 닫혀 남은 것)는 같은 자리에서 걷는다 — 실패해도 쓰기는 간다.
pub(crate) fn remote_write_command(nonce: &str, body: &str) -> String {
    let w = format!(
        "umask 077 && mkdir -p {dir} && {{ find {dir} -name \"setup-*.sh\" -mtime +0 -exec rm -f {{}} + 2>/dev/null; \
         printf %b \"{esc}\" > {file}; }}",
        dir = REMOTE_RUN_DIR,
        esc = printf_b_escape(body),
        file = remote_file_expr(nonce),
    );
    format!("sh -c {}", sh_quote(&w))
}

/// **원격 첫 입력의 명령** — 프로젝트 `project_id` 의 스크립트를 워크트리 `cwd` 에서 돌리고, 성공하면 `command`
/// (에이전트 — 없으면 셸에 머문다). `crate::ssh` 가 첫 접속의 `SshStart.setup` 을 받으면 부른다 — **블로킹**.
/// 스크립트가 없어졌으면(그사이 폼에서 지웠다) `None` — 명령은 예전 그대로 간다.
///
/// 타일에는 **짧은 줄**이 서도록 스크립트는 exec 채널로 서버 파일에 먼저 쓴다(`crate::ssh` 가 `write_command` 를 돌리고
/// 성공하면 `short`, 아니면 `long`). 긴 한 줄을 대화형 셸에 치면 에코 + 줄 편집기의 다시 그리기로 수십 줄이 두 번
/// 찍혔다(2026-09-29 dev-01 실기).
pub(crate) fn remote_start_command(
    project_id: &str,
    nonce: &str,
    cwd: &str,
    command: Option<&str>,
) -> Option<RemoteSetup> {
    check_nonce(nonce).ok()?;
    let p = project_with_script(project_id).ok()?;
    let agent = command
        .and_then(crate::agent_args::agent_of_line)
        .and_then(|(id, _)| crate::agent_args::display_of(id));
    let l = labels(&p.name, agent);
    let program = posix_program(
        &posix_path_expr(cwd),
        &posix_path_expr(&p.path),
        &p.setup_script,
        nonce,
        &l,
    );
    Some(remote_setup_of(&program, nonce, command))
}

/// [`RemoteSetup`] 조립 (**순수 함수**).
fn remote_setup_of(program: &str, nonce: &str, command: Option<&str>) -> RemoteSetup {
    let tail = |line: String| match command.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => format!("{line} && {c}"),
        None => line,
    };
    RemoteSetup {
        write_command: remote_write_command(nonce, &posix_file_body(program)),
        short: tail(format!("sh {}", remote_file_expr(nonce))),
        long: tail(posix_line(program)),
    }
}

/// 로컬 POSIX 셸(Git Bash · WSL)의 줄 — 프로그램을 `<data_root>/setup-run/run-<nonce>.sh` 에 쓰고 그 파일을 가리키는
/// 짧은 줄([`posix_file_line`]). 못 쓰면(데이터 폴더가 없다 · 쓰기 거절) 예전의 긴 한 줄([`posix_line`])로 간다 —
/// 긴 줄은 셸의 에코와 줄 편집기의 다시 그리기로 두 번 보일 뿐 도는 것은 같다. 파일은 첫 줄에서 스스로 지우고,
/// 남은 것은 [`run_dir`] 이 하루 지난 것을 걷는다.
fn local_posix_line(program: &str, nonce: &str, style: PathStyle) -> String {
    let wrote = run_dir().and_then(|dir| {
        let file = dir.join(format!("run-{nonce}.sh"));
        write_private(&file, posix_file_body(program).as_bytes()).map_err(|e| e.to_string())?;
        Ok(file)
    });
    match wrote {
        Ok(file) => posix_file_line(&posix_local_path(&file.to_string_lossy(), style)),
        Err(e) => {
            eprintln!("설정 스크립트: 임시 .sh 를 쓰지 못해 긴 한 줄로 칩니다 ({e})");
            posix_line(program)
        }
    }
}

/// [`setup_line_blocking`] 의 답 — 로컬은 칠 줄 그대로, 원격은 exec 쓰기를 거쳐야 하는 재료.
enum Prepared {
    Line(String),
    Remote(RemoteSetup),
}

/// 타일이 칠 한 줄을 짓는다 — 블로킹 몸통([`project_setup_line`]).
fn setup_line_blocking(
    project_id: &str,
    cwd: &str,
    shell: Option<&str>,
    nonce: &str,
    launch_agent: bool,
) -> Result<Prepared, String> {
    check_nonce(nonce)?;
    let cwd = cwd.trim();
    if cwd.is_empty() || cwd.chars().any(char::is_control) {
        return Err(
            tr!(ko: "워크트리 경로가 올바르지 않습니다", en: "The worktree path is not valid"),
        );
    }
    let p = project_with_script(project_id)?;
    let agent_name = p.agent.as_deref().and_then(crate::agent_args::display_of);
    if p.host.is_some() {
        // 원격 — 성공하면 같은 줄에서 에이전트(다시 실행 · 첫 입력과 같은 모양). 파일 쓰기는 부르는 쪽이 그 세션의
        // exec 로 한다(`project_setup_line`).
        let l = labels(&p.name, if launch_agent { agent_name } else { None });
        let program = posix_program(
            &posix_path_expr(cwd),
            &posix_path_expr(&p.path),
            &p.setup_script,
            nonce,
            &l,
        );
        let agent = p.agent.as_deref().filter(|_| launch_agent);
        return Ok(Prepared::Remote(remote_setup_of(&program, nonce, agent)));
    }
    // 로컬 — 에이전트는 끝 신호를 받은 타일이 띄운다(AI 타일과 같은 문 — 추가 인자 · 장식).
    let l = labels(&p.name, if launch_agent { agent_name } else { None });
    match shell_of(shell) {
        ScriptShell::Posix(style) => {
            let program = posix_program(
                &posix_path_expr(&posix_local_path(cwd, style)),
                &posix_path_expr(&posix_local_path(&p.path, style)),
                &p.setup_script,
                nonce,
                &l,
            );
            Ok(Prepared::Line(local_posix_line(&program, nonce, style)))
        }
        ScriptShell::PowerShell(exe) => {
            let file = run_dir()?.join(format!("run-{nonce}.ps1"));
            let text = powershell_wrapper(cwd, &p.path, &p.setup_script, nonce, &l);
            // BOM — Windows PowerShell 5.1 은 BOM 없는 파일을 시스템 코드 페이지로 읽는다(한글이 깨진다).
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(text.as_bytes());
            std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
            Ok(Prepared::Line(powershell_line(exe, &file)))
        }
        ScriptShell::Cmd => {
            let dir = run_dir()?;
            let body = dir.join(format!("body-{nonce}.cmd"));
            let file = dir.join(format!("run-{nonce}.cmd"));
            let mut script = p.setup_script.replace('\n', "\r\n");
            script.push_str("\r\n");
            std::fs::write(&body, script).map_err(|e| e.to_string())?;
            std::fs::write(&file, cmd_wrapper(cwd, &p.path, &body, nonce, &l))
                .map_err(|e| e.to_string())?;
            Ok(Prepared::Line(cmd_line(&file)))
        }
    }
}

/// **설정 스크립트를 돌릴 한 줄** — 타일이 그 셸에 한 번 친다(모듈 머리말의 표).
///
/// - `project_id` — 스크립트는 이 명령이 `projects.json` 에서 읽는다(프런트는 글자를 싣지 않는다).
/// - `cwd` — 워크트리 폴더(이 PC 의 경로 · 원격이면 그 서버의 경로). `shell` — 로컬 타일의 셸 id(원격이면 무시).
/// - `nonce` — 끝 신호(OSC 7717)에 실릴 16진 글자. 타일이 이것을 들고 기다린다.
/// - `launch_agent` — 성공하면 에이전트를 띄울 것인가(결과 줄의 꼬리 · 원격이면 줄 끝의 `&& <에이전트>`).
/// - `session_id` — 원격 타일의 SSH 세션 번호(실패 막대의 [다시 실행]). 오면 첫 입력과 같이 **그 전송로의 exec 로**
///   서버 파일(`~/.cache/aynx/setup-<nonce>.sh`)에 먼저 쓰고 짧은 줄을 돌려준다. 없거나 · 세션이 사라졌거나 · 쓰기가
///   실패하면(종료 코드 0 아님 · 시한 5초) 예전의 긴 한 줄이다. 로컬이면 무시한다.
///
/// 파일을 쓰므로 async + 블로킹 풀.
#[tauri::command]
pub async fn project_setup_line(
    project_id: String,
    cwd: String,
    shell: Option<String>,
    nonce: String,
    launch_agent: bool,
    session_id: Option<u32>,
) -> Result<String, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        setup_line_blocking(&project_id, &cwd, shell.as_deref(), &nonce, launch_agent)
    })
    .await
    .map_err(|e| tr!(ko: "설정 스크립트를 준비하지 못했습니다: {e}", en: "Could not prepare the setup script: {e}"))??;
    let remote = match prepared {
        Prepared::Line(line) => return Ok(line),
        Prepared::Remote(r) => r,
    };
    // 원격 타일의 세션은 세션 서버에 산다 — 쓰기는 서버 op `ssh_exec`(명령 글자는 위의 고정 조립 함수가 지었다).
    let Some(handle) = session_id.and_then(crate::server::ssh_ops::handle_of) else {
        return Ok(remote.long);
    };
    let wrote = crate::ssh::run_exec(
        handle,
        remote.write_command,
        crate::ssh::SETUP_WRITE_TIMEOUT,
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    )
    .await;
    if wrote.exit_code == Some(0) {
        Ok(remote.short)
    } else {
        eprintln!("설정 스크립트 다시 실행: 서버에 임시 파일을 쓰지 못해 긴 한 줄로 칩니다 (종료 코드 {:?})", wrote.exit_code);
        Ok(remote.long)
    }
}

#[cfg(test)]
mod tests;
