//! 프로젝트 설정 스크립트 — 새 워크트리 타일에서 에이전트보다 먼저 한 번 도는 여러 줄을, 타일의 셸이 안전하게 돌릴 한 줄로 바꾼다.
//!
//! - 스크립트 글자는 이 모듈이 `projects.json` 에서 직접 읽는다 — 프런트는 프로젝트 id 만 넘기고, MCP 에는 이 길이 없다.
//! - 여러 줄을 PTY 에 키로 치지 않는다 — 줄마다 Enter · 자동 완성 · 붙여넣기 확인이 끼어든다. 치는 것은 언제나 한 줄이고, 여러 줄은 임시 파일(못 쓰면 `printf %b` 8진 이스케이프 한 줄 — 전부 ASCII)에 산다.
//! - 실패 판정: PowerShell 은 최상위 문장마다 · cmd 는 본문 전체의 종료 코드(줄마다 멈추는 장치가 없다) · POSIX 는 `sh -e` 로 줄마다.
//! - PowerShell 은 자식 프로세스(`-NoProfile`)로 돈다 — 스크립트의 `exit` 가 타일의 셸을 닫지 않는다. 실행 정책은 이 파일에만 `Bypass` 다.
//! - 끝 신호 `ESC ] 7717 ; aynx-setup ; <nonce> ; <종료 코드> BEL` — 타일(`Terminal.svelte`)이 기다리는 nonce 일 때만 받는다. 로컬 ConPTY 도 모르는 OSC 를 통과시킨다(pwsh · cmd · BEL · ST 실측).
//! - `AYNX_ROOT_PATH` = 프로젝트의 주 작업 폴더(Git Bash `/c/…` · WSL `/mnt/c/…` 꼴). 스크립트는 워크트리 폴더에서 돈다.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::i18n::tr;
use crate::ssh::sh_quote;

/// 끝 신호의 OSC 번호 — 프런트 `src/lib/setup-script.ts` 의 `SETUP_OSC` 와 같은 수.
pub(crate) const SETUP_OSC: u32 = 7717;

/// 끝 신호의 첫 칸 — 같은 번호를 다른 프로그램이 써도 이 글자가 아니면 타일이 무시한다.
const SETUP_TAG: &str = "aynx-setup";

const RUN_DIR: &str = "setup-run";

const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScriptShell {
    /// 실행 파일 이름 — `pwsh` · `powershell`
    PowerShell(&'static str),
    Cmd,
    Posix(PathStyle),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathStyle {
    Native,
    Wsl,
    Msys,
}

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
// 문구
// ---------------------------------------------------------------------------

/// 자리표시를 가르는 표지 — 문구 안의 `{secs}` · `{code}` 자리에 끼워 둔 뒤 여기서 앞·뒤로 자른다.
const CUT: &str = "\u{1}";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Labels {
    pub header: String,
    pub ok_pre: String,
    pub ok_post: String,
    /// 걸린 시간을 재지 않는 셸(cmd)의 성공 줄
    pub ok_plain: String,
    pub fail_pre: String,
    pub fail_post: String,
    pub ok_tail: String,
    pub fail_tail: String,
}

fn cut(s: String) -> (String, String) {
    match s.split_once(CUT) {
        Some((a, b)) => (a.to_string(), b.to_string()),
        None => (s, String::new()),
    }
}

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

/// 영숫자 · 공백 · `-_.,:/@+=%^~#` 밖은 전부 `\0NNN`(8진) — 결과가 ASCII 뿐이고 `$` `` ` `` `"` `\` `!` `'` 가 없어 바깥 `sh -c '…'` 인용이 한 겹으로 끝난다.
/// `\\` 도 만들지 않는다 — fish 는 작은따옴표 안의 `\\` 를 `\` 로 읽는다.
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

/// `cwd`·`root` 는 이미 [`posix_path_expr`] 를 지난 식이다. `cd` 가 실패해도 끝 신호는 찍고, 그 종료 코드로 끝난다 — 원격의 `&& <에이전트>` 가 그것으로 갈린다.
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

/// 프로그램에 `'` 가 없으므로 인용은 한 겹이다.
pub(crate) fn posix_line(program: &str) -> String {
    format!("sh -c {}", sh_quote(program))
}

// ---------------------------------------------------------------------------
// PowerShell — 임시 .ps1
// ---------------------------------------------------------------------------

/// 표준 base64(패딩 있음) — 의존성 하나를 들이지 않으려고 여기 짧게 둔다.
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

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// 스크립트는 base64(UTF-8)로 싣는다 — 어떤 글자든 here-string 끝 표지와 부딪치지 않는다.
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

pub(crate) fn powershell_line(exe: &str, file: &Path) -> String {
    format!(
        "{exe} -NoLogo -NoProfile -ExecutionPolicy Bypass -File {}",
        ps_quote(&file.to_string_lossy())
    )
}

// ---------------------------------------------------------------------------
// cmd — 임시 .cmd 둘
// ---------------------------------------------------------------------------

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

/// 한글이 섞인 줄은 전부 `chcp 65001` 뒤에 둔다 — cmd 는 배치 파일을 그 줄을 읽는 순간의 코드 페이지로 읽는다.
/// 마지막 `(goto)` 줄은 도는 배치 파일이 자기를 지우는 cmd 의 관용구다.
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

/// 자식 cmd 로 돌린다 — 본문의 `exit` 가 타일의 cmd 를 닫지 않게.
pub(crate) fn cmd_line(file: &Path) -> String {
    format!("cmd /d /c \"{}\"", file.to_string_lossy())
}

// ---------------------------------------------------------------------------
// 조립
// ---------------------------------------------------------------------------

/// 16진 8~64자만 — 끝 신호 · 파일 이름에 들어간다.
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

/// `Debug` 는 일부러 없다 — `write_command` · `long` 에 스크립트가 인코딩돼 들어 있다(로그에 남기지 않는다).
pub(crate) struct RemoteSetup {
    pub write_command: String,
    pub short: String,
    pub long: String,
}

/// `XDG_RUNTIME_DIR` · `/tmp` 는 exec 세션과 tmux 서버 안에서 같다는 보장이 없어 쓰지 않는다 — `$HOME` 은 같다.
const REMOTE_RUN_DIR: &str = "\"$HOME/.cache/aynx\"";

/// nonce 는 [`check_nonce`] 를 지난 16진이다.
pub(crate) fn remote_file_expr(nonce: &str) -> String {
    format!("\"$HOME/.cache/aynx/setup-{nonce}.sh\"")
}

/// 첫 줄에서 자기를 지운다(`$0` 이 그 경로 · 이미 연 파일은 끝까지 읽힌다 — Ctrl+C 로 끊겨도 남지 않는다). 줄 끝은 LF.
pub(crate) fn posix_file_body(program: &str) -> String {
    format!("rm -f -- \"$0\"\n{program}\n")
}

/// 경로에 [`printf_b_escape`] 가 바꾸는 글자(한글 사용자 이름 등)가 있으면 치는 글자가 ASCII 로 남도록 `printf %b` 식으로 쓴다.
pub(crate) fn posix_file_line(path: &str) -> String {
    if printf_b_escape(path) == path {
        format!("sh {}", sh_quote(path))
    } else {
        format!("sh {}", posix_path_expr(path))
    }
}

/// 유닉스는 `0o600`(스크립트 글자가 들어 있다). Windows 는 데이터 폴더가 사용자 프로필 아래라 그 ACL 로 이미 막힌다(`audit::open_append` 와 같은 판단).
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

/// 본문은 [`printf_b_escape`] 를 지나 `'` · `"` · `$` 가 없어 인용이 한 겹이다(로그인 셸이 fish 여도). `umask 077` 이라 파일 600 · 폴더 700.
/// 하루 지난 `setup-*.sh` 걷기는 실패해도 쓰기는 간다.
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

/// 원격 첫 입력의 명령 — 블로킹. 스크립트가 그사이 지워졌으면 `None`(명령은 예전 그대로 간다).
/// 긴 한 줄을 대화형 셸에 치면 에코 + 줄 편집기 다시 그리기로 수십 줄이 두 번 찍힌다 — 그래서 exec 로 서버 파일에 먼저 쓰고 짧은 줄을 세운다.
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

/// 임시 파일을 못 쓰면 긴 한 줄([`posix_line`])로 간다 — 두 번 보일 뿐 도는 것은 같다.
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

enum Prepared {
    Line(String),
    Remote(RemoteSetup),
}

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
        // 원격 — 파일 쓰기는 부르는 쪽이 그 세션의 exec 로 한다(`project_setup_line`).
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

/// 설정 스크립트를 돌릴 한 줄 — 타일이 그 셸에 한 번 친다. 스크립트는 `projects.json` 에서 읽는다(프런트는 글자를 싣지 않는다).
/// `session_id` 가 오면(원격 [다시 실행]) 그 전송로의 exec 로 서버 파일에 먼저 쓰고 짧은 줄, 세션이 없거나 쓰기가 실패하면 긴 한 줄이다.
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
    // 쓰기는 서버 op `ssh_exec` — 명령 글자는 위의 고정 조립 함수가 지었다.
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
