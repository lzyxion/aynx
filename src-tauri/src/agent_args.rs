//! **aynx 이 띄우는 에이전트에 붙일 추가 인자** — 그 규칙이 사는 한 곳 (docs/log/2026-09-27-agent-extra-args.md).
//!
//! 설정 › AI 의 "Claude Code 추가 인자" · "Codex 추가 인자"(`[ai.args] <에이전트 id> = "…"`)를 aynx 이 **띄우는**
//! 명령에만 붙인다 — AI 타일의 autorun · 셸 메뉴 · 프로젝트 시작 화면 · 재개 · 새 대화로 계속. 이것들은 전부
//! `crate::agent_autorun::agent_autorun_command` 한 문을 지나고, 그 문이 [`apply_configured`] 를 부른다. 로컬 PowerShell · Git Bash
//! 타일(셸 통합 켬)에 손으로 친 `claude`/`codex` 에는 타일 장식 파일(`crate::agent_tile` — 2026-10-26)을 읽는 감싸개가 같은 낱말을 같은
//! 자리(`place`)에 붙인다. 원격은 호스트별 추가 인자(`crate::sessions_meta`)를 PATH 심(`crate::agent_shim`)이.
//!
//! ## 에이전트 하나 = 표 한 줄 ([`TARGETS`])
//!
//! 실행 파일 이름 · 인자를 놓을 자리 · 위험 표시할 플래그 · 미리보기의 바탕. 셋째 에이전트는 한 줄로 붙고
//! 설정 화면의 줄도 이 표를 돌며 그린다([`agent_args_targets`]). id 는 훅 표(`crate::agent_hooks::TARGETS`)와 같다.
//!
//! ## 한 줄 → 낱말 ([`parse_args`]) — 셸을 타지 않는 규칙
//!
//! - 공백(유니코드 공백 포함)으로 나눈다. `"…"` · `'…'` 는 공백을 품은 한 낱말로 묶는다(따옴표는 벗긴다 ·
//!   `--x="a b"` 처럼 낱말 중간에 붙어도 된다). 따옴표 안에 이스케이프는 없다 — `\` 는 그냥 글자다(Windows 경로).
//! - 변수 확장 · 글롭 · 명령 치환은 **없다** — 글자는 글자다.
//! - 따옴표 **밖**의 `;` `&` `|` `<` `>` `` ` `` `$` 는 거절한다 — 사용자가 셸 문법을 기대한 것이라 조용히
//!   글자로 넘기는 것보다 알리는 편이 낫다(따옴표 안이면 글자로 받는다).
//! - 어디서든 거절: 제어 문자(줄바꿈 · 탭 — 줄은 PTY 에 **키로** 쳐지므로 Enter · 자동 완성이 된다) ·
//!   낱말 안의 `"`(PowerShell 5.1 이 네이티브 인자로 넘기며 망가뜨리고 cmd 는 따옴표 안에 적을 길이 없다 — TOML
//!   문자열이 필요하면 `-c "model='o3'"` 처럼 작은따옴표로) · `%`(cmd 와 npm 의 `.cmd` 심이 `%이름%` 을 펼친다) ·
//!   `‘ ’ ‚ ‛`(PowerShell 이 작은따옴표로 읽는다) · 빈 낱말(`''` — PowerShell 5.1 이 버린다) · `\` 로 끝나는 낱말
//!   (인용하면 `\"` 가 되어 Windows 프로그램의 인자 해석이 따옴표로 읽는다 — PowerShell 5.1 · cmd 실측) · 2000 자 넘는 줄.
//!
//! ## 낱말 → 그 타일의 셸 글자 ([`quote`])
//!
//! 명령은 타일의 셸에 **쳐지므로** 낱말마다 그 셸에 맞게 다시 인용한다. 안전한 글자만이면 그대로, 아니면:
//!
//! | 셸 | 인용 | 그대로 둘 글자 |
//! | --- | --- | --- |
//! | PowerShell(pwsh · powershell) | `'…'`(안의 `'` 는 `''`) | 영숫자 `_ - = / +` (`--` 한 낱말은 인용) |
//! | cmd | `"…"`(안에 `"` · `%` 는 규칙이 이미 막았다) | 영숫자 `_ - . / : + @` |
//! | POSIX(Git Bash · WSL · 그 밖) | `'…'`(안의 `'` 는 `'\''`) | 영숫자 `_ - = . / : + , @` (`=` 로 시작하면 인용) |
//!
//! 셸을 모르면 OS 의 기본 셸 모양이다([`quote_style`] — OS 를 타는 곳은 거기 하나).
//!
//! ## 자리 ([`place`]) — 추가 인자를 **먼저** 놓고 다른 장식이 뒤따른다
//!
//! | 에이전트 | 명령 | 결과 |
//! | --- | --- | --- |
//! | Claude | `claude` · `claude --resume <id>` · `… --fork-session` | 줄 **끝**에 — `claude --resume <id> <추가…>` |
//! | Codex | `codex` · `codex exec …` | 실행 파일 **바로 뒤** — `codex --no-daemon <추가…> …` |
//! | Codex | `codex resume <id>` · `codex fork <id>` | 하위명령 **뒤 · id 앞** — `codex resume --no-daemon <추가…> <id>` |
//!
//! 추가 인자를 먼저 놓으면 뒤따르는 장식(`--no-daemon` — `crate::codex_launch`)이 사용자가 정한 것을 본다: `--remote` ·
//! `--no-daemon` 이 있으면 `--no-daemon` 을 끼우지 않는다(둘이 되지 않는다). Claude 에는 덧붙이는 장식이 없다(한도 % 는
//! 타일 환경의 mod 가 받는다 — `crate::claude_usage`). Claude 는 옵션 순서가 자유롭다
//! (`claude [options] [command] [prompt]`), Codex 의 `resume`/`fork` 는 `[OPTIONS] [SESSION_ID] [PROMPT]` 라
//! 옵션이 id 앞에 서야 한다(`codex resume --help` 0.157.1).

use serde::Serialize;

use crate::i18n::tr;

/// 줄 길이 상한 — 설정 칸 하나에 적을 만큼.
const MAX_LEN: usize = 2000;

/// 추가 인자를 놓을 자리.
#[derive(Clone, Copy, Debug)]
enum Place {
    /// 줄 끝.
    End,
    /// 실행 파일 뒤 — 첫 낱말 뒤가 `subcommands` 중 하나면 그 뒤. 그 자리에 `skip` 낱말이 이미 있으면 그 뒤.
    AfterSubcommand {
        subcommands: &'static [&'static str],
        skip: &'static [&'static str],
    },
}

/// 에이전트 하나.
pub(crate) struct ArgsTarget {
    /// 안정 id — 설정 `[ai.args]` 의 키 · 훅 표와 같은 id.
    pub id: &'static str,
    /// 제품 이름 — 번역하지 않는다.
    pub display: &'static str,
    /// 첫 낱말이 이것(대소문자 무관)이면 이 에이전트를 띄우는 줄이다.
    exes: &'static [&'static str],
    place: Place,
    /// 권한 확인을 건너뛰는 플래그 — `--dangerously…` · `--allow-dangerously…` 로 시작하는 것은 따로 적지 않아도 걸린다.
    dangerous: &'static [&'static str],
    /// 미리보기 — 새 대화 한 줄에 aynx 의 다른 장식을 입힌다(파일은 쓰지 않는다). 인자: 줄 · Codex 따로 켬.
    preview_decorate: fn(&str, bool) -> String,
}

fn claude_preview(line: &str, _no_daemon: bool) -> String {
    line.to_owned()
}

fn codex_preview(line: &str, no_daemon: bool) -> String {
    crate::codex_launch::codex_line(line, no_daemon).unwrap_or_else(|| line.to_owned())
}

pub(crate) const TARGETS: &[ArgsTarget] = &[
    ArgsTarget {
        id: "claude",
        display: "Claude Code",
        exes: &["claude", "claude.exe", "claude.cmd"],
        place: Place::End,
        dangerous: &[
            "--dangerously-skip-permissions",
            "--allow-dangerously-skip-permissions",
        ],
        preview_decorate: claude_preview,
    },
    ArgsTarget {
        id: "codex",
        display: "Codex",
        exes: &["codex", "codex.exe", "codex.cmd"],
        place: Place::AfterSubcommand {
            subcommands: &["resume", "fork"],
            skip: &[crate::codex_launch::NO_DAEMON_FLAG],
        },
        dangerous: &["--dangerously-bypass-approvals-and-sandbox", "--yolo"],
        preview_decorate: codex_preview,
    },
];

fn target(id: &str) -> Result<&'static ArgsTarget, String> {
    TARGETS
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"))
}

// ---------------------------------------------------------------------------
// 한 줄 → 낱말
// ---------------------------------------------------------------------------

/// [`parse_args`] 가 거절한 까닭.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ArgsError {
    /// 닫히지 않은 따옴표.
    Unclosed(char),
    /// 따옴표 밖의 셸 문법 글자.
    ShellMeta(char),
    /// 어디서든 쓸 수 없는 글자.
    Forbidden(char),
    /// 제어 문자(줄바꿈 · 탭 …).
    Control,
    /// 빈 낱말(`''`).
    Empty,
    /// `\` 로 끝나는 낱말 — 인용하면 `\"` 가 되어 Windows 프로그램이 따옴표로 읽는다.
    TrailingBackslash,
    TooLong,
}

impl ArgsError {
    pub(crate) fn message(&self) -> String {
        match self {
            ArgsError::Unclosed(q) => {
                tr!(ko: "닫히지 않은 따옴표({q})가 있습니다", en: "Unclosed quote ({q})")
            }
            ArgsError::ShellMeta(c) => tr!(
                ko: "따옴표 밖의 '{c}' 는 쓸 수 없습니다 — 셸 문법은 받지 않습니다(글자로 넘기려면 따옴표로 감싸세요)",
                en: "'{c}' outside quotes is not allowed — shell syntax is not accepted (quote it to pass it literally)"
            ),
            ArgsError::Forbidden('"') => tr!(
                ko: "인자 안의 큰따옴표는 쓸 수 없습니다 — 작은따옴표를 쓰세요",
                en: "A double quote inside an argument is not allowed — use single quotes"
            ),
            ArgsError::Forbidden(c) => tr!(
                ko: "'{c}' 는 쓸 수 없습니다 — 셸이 따로 읽는 글자입니다",
                en: "'{c}' is not allowed — shells read it specially"
            ),
            ArgsError::Control => tr!(
                ko: "줄바꿈 · 탭 같은 제어 문자는 쓸 수 없습니다",
                en: "Control characters such as newlines or tabs are not allowed"
            ),
            ArgsError::Empty => {
                tr!(ko: "빈 인자('')는 쓸 수 없습니다", en: "Empty arguments ('') are not allowed")
            }
            ArgsError::TrailingBackslash => tr!(
                ko: "인자는 \\ 로 끝날 수 없습니다 — 폴더 경로면 끝의 \\ 를 빼세요",
                en: "An argument cannot end with \\ — drop the trailing \\ from folder paths"
            ),
            ArgsError::TooLong => tr!(
                ko: "너무 깁니다 ({MAX_LEN}자까지)",
                en: "Too long (up to {MAX_LEN} characters)"
            ),
        }
    }
}

/// 따옴표 밖에서 거절하는 셸 문법 글자.
fn is_shell_meta(c: char) -> bool {
    matches!(c, ';' | '&' | '|' | '<' | '>' | '`' | '$')
}

/// 낱말 안 어디서든 거절하는 글자(따옴표 문자 `"` 는 따옴표 안에서만 이 판정에 온다).
pub(crate) fn is_forbidden(c: char) -> bool {
    matches!(
        c,
        '"' | '%' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}'
    )
}

/// 사용자가 적은 한 줄을 낱말로 나눈다 — 규칙은 모듈 머리말. 빈 줄은 빈 목록.
pub(crate) fn parse_args(s: &str) -> Result<Vec<String>, ArgsError> {
    if s.chars().count() > MAX_LEN {
        return Err(ArgsError::TooLong);
    }
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    // 이 낱말이 시작됐나 — 따옴표만 있는 낱말(`''`)을 알아보려고 글자와 따로 센다.
    let mut started = false;
    let mut quote: Option<char> = None;
    let finish =
        |cur: &mut String, started: &mut bool, out: &mut Vec<String>| -> Result<(), ArgsError> {
            if *started {
                if cur.is_empty() {
                    return Err(ArgsError::Empty);
                }
                if cur.ends_with('\\') {
                    return Err(ArgsError::TrailingBackslash);
                }
                out.push(std::mem::take(cur));
                *started = false;
            }
            Ok(())
        };
    for c in s.chars() {
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                } else if c.is_control() {
                    return Err(ArgsError::Control);
                } else if is_forbidden(c) {
                    return Err(ArgsError::Forbidden(c));
                } else {
                    cur.push(c);
                }
            }
            None => {
                if c == ' ' || (c.is_whitespace() && !c.is_control()) {
                    finish(&mut cur, &mut started, &mut out)?;
                } else if c.is_control() {
                    return Err(ArgsError::Control);
                } else if c == '"' || c == '\'' {
                    quote = Some(c);
                    started = true;
                } else if is_shell_meta(c) {
                    return Err(ArgsError::ShellMeta(c));
                } else if is_forbidden(c) {
                    return Err(ArgsError::Forbidden(c));
                } else {
                    cur.push(c);
                    started = true;
                }
            }
        }
    }
    if let Some(q) = quote {
        return Err(ArgsError::Unclosed(q));
    }
    finish(&mut cur, &mut started, &mut out)?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// 낱말 → 셸 글자
// ---------------------------------------------------------------------------

/// 줄이 쳐질 셸의 인용 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QuoteStyle {
    Posix,
    PowerShell,
    Cmd,
}

/// 타일 셸 id(`crate::pty` 의 `pwsh` · `powershell` · `cmd` · `gitbash` · `wsl:<배포판>`) → 인용 모양.
/// 모르면(`None`) 그 OS 의 기본 셸 모양 — OS 를 타는 곳은 여기 하나다.
pub(crate) fn quote_style(shell: Option<&str>) -> QuoteStyle {
    match shell {
        Some("pwsh") | Some("powershell") => QuoteStyle::PowerShell,
        Some("cmd") => QuoteStyle::Cmd,
        Some(_) => QuoteStyle::Posix,
        None => {
            #[cfg(windows)]
            {
                QuoteStyle::PowerShell
            }
            #[cfg(not(windows))]
            {
                QuoteStyle::Posix
            }
        }
    }
}

/// 낱말 하나를 그 셸의 글자로 — [`parse_args`] 를 지난 낱말만 받는다(빈 낱말 · `"` · `%` · 제어 문자가 없다).
pub(crate) fn quote(token: &str, style: QuoteStyle) -> String {
    let plain = |extra: &str| {
        !token.is_empty()
            && token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
    };
    match style {
        QuoteStyle::PowerShell => {
            if plain("_-=/+") && token != "--" {
                token.to_owned()
            } else {
                format!("'{}'", token.replace('\'', "''"))
            }
        }
        QuoteStyle::Cmd => {
            if plain("_-./:+@") {
                token.to_owned()
            } else {
                format!("\"{token}\"")
            }
        }
        QuoteStyle::Posix => {
            if plain("_-=./:+,@") && !token.starts_with('=') {
                token.to_owned()
            } else {
                format!("'{}'", token.replace('\'', "'\\''"))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 자리
// ---------------------------------------------------------------------------

/// (시작 바이트, 낱말) — 공백으로만 가른다(`crate::codex_launch::codex_line` 과 같은 읽기).
fn spans(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                out.push((s, &line[s..i]));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push((s, &line[s..]));
    }
    out
}

/// 이 줄이 띄우는 에이전트 — 첫 낱말로.
fn target_of_line(line: &str) -> Option<&'static ArgsTarget> {
    let first = line.split_whitespace().next()?.to_ascii_lowercase();
    TARGETS.iter().find(|t| t.exes.contains(&first.as_str()))
}

/// **프로젝트의 에이전트** 판정 — 한 줄의 첫 낱말이 어느 에이전트의 실행 파일인가(id), 그리고 그 뒤에 남은 글자
/// (인자 — 앞뒤 공백은 뗀다). 옛 프로젝트의 "시작 명령"을 에이전트로 옮길 때 쓴다(`crate::projects` 의 이관 ·
/// docs/log/2026-09-28-project-agent-setup-script.md). 에이전트 줄이 아니면 `None`.
pub(crate) fn agent_of_line(line: &str) -> Option<(&'static str, String)> {
    let t = target_of_line(line)?;
    let trimmed = line.trim_start();
    let first_len = trimmed.split_whitespace().next().map_or(0, str::len);
    Some((t.id, trimmed[first_len..].trim().to_string()))
}

/// 표에 있는 에이전트 id 인가 — 프로젝트의 `agent` 칸 검사(`crate::projects::normalize`).
pub(crate) fn is_agent(id: &str) -> bool {
    TARGETS.iter().any(|t| t.id == id)
}

/// 에이전트의 제품 이름 — 모르면 `None`(설정 스크립트의 "… 를 띄웁니다" 한 줄이 쓴다).
pub(crate) fn display_of(id: &str) -> Option<&'static str> {
    TARGETS.iter().find(|t| t.id == id).map(|t| t.display)
}

/// 이미 셸 글자가 된 추가 인자(`extras`)를 그 에이전트의 자리에 놓는다. 나머지 글자는 건드리지 않는다.
fn place(line: &str, t: &ArgsTarget, extras: &[String]) -> String {
    if extras.is_empty() {
        return line.to_owned();
    }
    let joined = extras.join(" ");
    let at_end = |line: &str| format!("{} {joined}", line.trim_end());
    match t.place {
        Place::End => at_end(line),
        Place::AfterSubcommand { subcommands, skip } => {
            let sp = spans(line);
            let mut i = 1;
            if sp.get(1).is_some_and(|(_, w)| subcommands.contains(w)) {
                i = 2;
            }
            while sp.get(i).is_some_and(|(_, w)| skip.contains(w)) {
                i += 1;
            }
            match sp.get(i) {
                Some((pos, _)) => format!("{}{joined} {}", &line[..*pos], &line[*pos..]),
                None => at_end(line),
            }
        }
    }
}

/// 줄에 그 에이전트의 추가 인자를 놓는다 — **순수**. `raw_for` 는 에이전트 id → 사용자가 적은 한 줄.
/// 에이전트 줄이 아니거나 · 적은 것이 없거나 · 규칙에 어긋나면(손으로 고친 파일) **받은 그대로** — 띄우기를 막지 않는다.
fn with_extra_args(
    line: &str,
    shell: Option<&str>,
    raw_for: impl Fn(&str) -> Option<String>,
) -> String {
    let Some(t) = target_of_line(line) else {
        return line.to_owned();
    };
    let Some(raw) = raw_for(t.id) else {
        return line.to_owned();
    };
    let Ok(tokens) = parse_args(&raw) else {
        return line.to_owned();
    };
    let style = quote_style(shell);
    let quoted: Vec<String> = tokens.iter().map(|x| quote(x, style)).collect();
    place(line, t, &quoted)
}

/// 이미 검사한 낱말을 에이전트의 자리에 놓는다 — MCP 인자도 추가 인자와 같은 인용·자리 규칙을 쓴다.
pub(crate) fn with_tokens(line: &str, shell: Option<&str>, tokens: &[String]) -> String {
    let Some(t) = target_of_line(line) else {
        return line.to_owned();
    };
    let style = quote_style(shell);
    let quoted: Vec<String> = tokens.iter().map(|x| quote(x, style)).collect();
    place(line, t, &quoted)
}

/// 자동 실행 한 줄에 설정(`[ai.args]`)의 추가 인자를 놓는다 — 설정 파일을 읽으므로 블로킹 문맥에서만.
/// `crate::agent_autorun::agent_autorun_command` 가 다른 장식보다 **먼저** 부른다(모듈 머리말 "자리").
pub(crate) fn apply_configured(line: &str, shell: Option<&str>) -> String {
    with_extra_args(line, shell, crate::settings::agent_extra_args)
}

/// 권한 확인을 건너뛰는 낱말들(적힌 그대로 · 겹침 없이).
fn dangerous_of(tokens: &[String], t: &ArgsTarget) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tok in tokens {
        let flag = tok.split('=').next().unwrap_or(tok);
        let hit = flag.starts_with("--dangerously")
            || flag.starts_with("--allow-dangerously")
            || t.dangerous.contains(&flag);
        if hit && !out.contains(tok) {
            out.push(tok.clone());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------------------

/// 설정 화면의 줄 하나.
#[derive(Debug, Serialize)]
pub struct ArgsTargetInfo {
    pub id: &'static str,
    pub display: &'static str,
}

/// 에이전트 표 — 설정 › AI 가 이것을 돌며 칸을 그린다(에이전트를 화면에 손으로 적지 않는다).
#[tauri::command]
pub async fn agent_args_targets() -> Vec<ArgsTargetInfo> {
    TARGETS
        .iter()
        .map(|t| ArgsTargetInfo {
            id: t.id,
            display: t.display,
        })
        .collect()
}

/// 미리보기 — 적는 중인 한 줄의 판정과 새 대화 한 줄.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreview {
    /// 새 대화로 띄울 한 줄(`--settings` 파일 경로는 `…`) — 규칙에 어긋나면 `None`.
    pub line: Option<String>,
    /// 어긋난 까닭 — 그때는 저장하지 않는다.
    pub error: Option<String>,
    /// 권한 확인을 건너뛰는 낱말들 — 막지 않고 알린다.
    pub dangerous: Vec<String>,
}

/// 미리보기의 몸통 — **순수**.
fn preview_in(
    t: &ArgsTarget,
    args: &str,
    no_daemon: bool,
    shell: Option<&str>,
) -> LaunchPreview {
    match parse_args(args) {
        Err(e) => LaunchPreview {
            line: None,
            error: Some(e.message()),
            dangerous: Vec::new(),
        },
        Ok(tokens) => {
            let style = quote_style(shell);
            let quoted: Vec<String> = tokens.iter().map(|x| quote(x, style)).collect();
            let base = t.exes[0];
            let line = (t.preview_decorate)(&place(base, t, &quoted), no_daemon);
            LaunchPreview {
                line: Some(line),
                error: None,
                dangerous: dangerous_of(&tokens, t),
            }
        }
    }
}

/// 적는 중인 추가 인자(`args` — 아직 저장 전)의 판정 · 새 대화 한 줄 · 위험 플래그. `no_daemon` 은
/// 화면의 지금 스위치 값, `shell` 은 기본 셸 id(없으면 OS 기본 — 인용 모양만 가른다). 파일을 읽지도 쓰지도 않는다.
#[tauri::command]
pub async fn agent_launch_preview(
    agent: String,
    args: String,
    no_daemon: bool,
    shell: Option<String>,
) -> Result<LaunchPreview, String> {
    let t = target(&agent)?;
    Ok(preview_in(
        t,
        &args,
        no_daemon,
        shell.as_deref(),
    ))
}

#[cfg(test)]
mod tests;
