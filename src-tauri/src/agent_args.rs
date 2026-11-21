//! aynx 이 띄우는 에이전트에 붙일 추가 인자(`[ai.args] <에이전트 id>`)의 규칙 — 셸을 타지 않는 낱말 · 그 타일의 셸 인용 · 자리 (docs/log/2026-09-27-agent-extra-args.md).
//! 로컬 셸 타일에 손으로 친 `claude`/`codex` 는 감싸개(`crate::agent_tile`), 원격은 PATH 심(`crate::agent_shim`)이 같은 낱말을 같은 자리(`place`)에 붙인다.
//!
//! 거절하는 글자의 까닭:
//! - 따옴표 밖 `;` `&` `|` `<` `>` `` ` `` `$` — 셸 문법을 기대한 것이라 조용히 글자로 넘기지 않고 알린다. 따옴표 안 `\` 는 그냥 글자다(Windows 경로).
//! - 제어 문자 — 줄은 PTY 에 키로 쳐지므로 Enter · 자동 완성이 된다. 낱말 안 `"` — PowerShell 5.1 이 망가뜨리고 cmd 는 적을 길이 없다.
//! - `%` — cmd 와 npm 의 `.cmd` 심이 `%이름%` 을 펼친다. `‘ ’ ‚ ‛` — PowerShell 이 작은따옴표로 읽는다. 빈 낱말 — PowerShell 5.1 이 버린다.
//! - `\` 로 끝나는 낱말 — 인용하면 `\"` 가 되어 Windows 프로그램이 따옴표로 읽는다.
//!
//! 추가 인자를 먼저 놓아야 뒤따르는 `--no-daemon` 장식(`crate::codex_launch`)이 사용자가 정한 `--remote` · `--no-daemon` 을 보고 둘이 되지 않는다.
//! Codex 의 `resume`/`fork` 는 `[OPTIONS] [SESSION_ID] [PROMPT]` 라 옵션이 id 앞에 서야 한다.

use serde::Serialize;

use crate::i18n::tr;

const MAX_LEN: usize = 2000;

#[derive(Clone, Copy, Debug)]
enum Place {
    End,
    AfterSubcommand {
        subcommands: &'static [&'static str],
        skip: &'static [&'static str],
    },
}

pub(crate) struct ArgsTarget {
    /// 안정 id — 설정 `[ai.args]` 의 키 · 훅 표와 같은 id.
    pub id: &'static str,
    /// 제품 이름 — 번역하지 않는다.
    pub display: &'static str,
    exes: &'static [&'static str],
    place: Place,
    dangerous: &'static [&'static str],
    /// 미리보기 장식 — 파일은 쓰지 않는다.
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

// ── 한 줄 → 낱말 ──

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ArgsError {
    Unclosed(char),
    ShellMeta(char),
    Forbidden(char),
    Control,
    Empty,
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

fn is_shell_meta(c: char) -> bool {
    matches!(c, ';' | '&' | '|' | '<' | '>' | '`' | '$')
}

pub(crate) fn is_forbidden(c: char) -> bool {
    matches!(
        c,
        '"' | '%' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}'
    )
}

pub(crate) fn parse_args(s: &str) -> Result<Vec<String>, ArgsError> {
    if s.chars().count() > MAX_LEN {
        return Err(ArgsError::TooLong);
    }
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    // 따옴표만 있는 낱말(`''`)을 알아보려고 글자와 따로 센다.
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

// ── 낱말 → 셸 글자 ──

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QuoteStyle {
    Posix,
    PowerShell,
    Cmd,
}

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

/// [`parse_args`] 를 지난 낱말만 받는다(빈 낱말 · `"` · `%` · 제어 문자가 없다).
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

// ── 자리 ──

/// 공백으로만 가른다 — `crate::codex_launch::codex_line` 과 같은 읽기.
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

fn target_of_line(line: &str) -> Option<&'static ArgsTarget> {
    let first = line.split_whitespace().next()?.to_ascii_lowercase();
    TARGETS.iter().find(|t| t.exes.contains(&first.as_str()))
}

pub(crate) fn agent_of_line(line: &str) -> Option<(&'static str, String)> {
    let t = target_of_line(line)?;
    let trimmed = line.trim_start();
    let first_len = trimmed.split_whitespace().next().map_or(0, str::len);
    Some((t.id, trimmed[first_len..].trim().to_string()))
}

pub(crate) fn is_agent(id: &str) -> bool {
    TARGETS.iter().any(|t| t.id == id)
}

pub(crate) fn display_of(id: &str) -> Option<&'static str> {
    TARGETS.iter().find(|t| t.id == id).map(|t| t.display)
}

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

/// 에이전트 줄이 아니거나 · 적은 것이 없거나 · 규칙에 어긋나면(손으로 고친 파일) 받은 그대로 — 띄우기를 막지 않는다.
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

pub(crate) fn with_tokens(line: &str, shell: Option<&str>, tokens: &[String]) -> String {
    let Some(t) = target_of_line(line) else {
        return line.to_owned();
    };
    let style = quote_style(shell);
    let quoted: Vec<String> = tokens.iter().map(|x| quote(x, style)).collect();
    place(line, t, &quoted)
}

/// 설정 파일을 읽으므로 블로킹 문맥에서만. 다른 장식보다 먼저 불러야 한다.
pub(crate) fn apply_configured(line: &str, shell: Option<&str>) -> String {
    with_extra_args(line, shell, crate::settings::agent_extra_args)
}

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

// ── 설정 화면 ──

#[derive(Debug, Serialize)]
pub struct ArgsTargetInfo {
    pub id: &'static str,
    pub display: &'static str,
}

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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreview {
    pub line: Option<String>,
    pub error: Option<String>,
    /// 권한 확인을 건너뛰는 낱말들 — 막지 않고 알린다.
    pub dangerous: Vec<String>,
}

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
