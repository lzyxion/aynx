//! 자동 승인 정책 평가기 — 백엔드 권위. 프런트 `src/lib/policy.ts` · `operations.ts` 의 판정은 사전 점검 · 자문이고, 승인은 Tauri 명령
//! `approve_operation` 하나로 들어와 프런트 버그 · 조작으로 `method:"auto"` 가 정책 밖 명령과 올 수 있다 — **여기 판정이 진짜 경계**다
//! (caps 는 [`crate::operations::exceeds_limits`]). AI 는 자가 승인 못 한다 — approve 는 MCP 도구가 아니다(→ docs/invariants.md 전문 4).
//!
//! TS ↔ Rust 는 같은 케이스로 검증한다(`policy.test.ts` · `operations.test.ts` 의 케이스를 아래 시험이 미러링).
//! **규칙을 바꾸면 `src/lib/policy.ts` · `src/lib/operations.ts` 도 함께 고친다.**

use std::sync::LazyLock;

use regex::Regex;

use crate::settings::AutomationPrefs;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Risk {
    Safe,
    Dangerous,
}

/// `src/lib/operations.ts` 의 `DANGEROUS` 와 케이스가 같아야 한다(바꾸면 함께). 넓게(보수적으로) 잡는다 — 오탐이 미탐보다 낫다.
/// JS `\b` · `\w` 는 ASCII 이고 Rust regex 는 유니코드지만, 명령 텍스트는 ASCII 라 판정이 같다.
static DANGEROUS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"\brm\b",
        r"\brmdir\b",
        r"\bdd\b",
        r"\bmkfs(\.\w+)?\b",
        r"\bsudo\b",
        r"\bsu\b",
        r"\bchmod\b",
        r"\bchown\b",
        r"\b(kill|killall|pkill)\b",
        r"\breboot\b",
        r"\bshutdown\b",
        r"\bhalt\b",
        r"\bpoweroff\b",
        r"\bsystemctl\b[^\n]*\b(restart|stop)\b",
        r">>?", // 리다이렉트 — 덮어쓰기/이어쓰기
        r"\bfind\b[^\n]*-delete\b",
        r"\bgit\b[^\n]*\breset\b[^\n]*--hard\b",
        r"\btruncate\b",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("정적 위험 패턴은 항상 유효하다"))
    .collect()
});

/// ⚠️ 자문이자 자동 승인의 배제 조건이지 실행을 막는 경계가 아니다 — 수동 승인은 사람이 권위라 위험이어도 통과한다.
pub(crate) fn classify_risk(command: &str) -> Risk {
    if DANGEROUS.iter().any(|re| re.is_match(command)) {
        Risk::Dangerous
    } else {
        Risk::Safe
    }
}

/// 명령 판정에는 더 쓰지 않는다 — 남은 쓰임은 자동 승인의 `cwd` 검사 하나(`operations::gate`). cwd 는 디렉터리라 체이닝을 허용할 이유가 없다.
pub(crate) fn has_shell_metachar(command: &str) -> bool {
    command.chars().any(|c| {
        matches!(
            c,
            ';' | '|' | '&' | '`' | '$' | '>' | '<' | '(' | ')' | '\n' | '\r' | '\\'
        )
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Quote {
    None,
    Single,
    Double,
}

/// 못 나누면 `None`(= 자동 승인 불가). `policy.ts segmentsForAutoApproval` 과 같은 의미 — 양쪽이 같은 표로 검증된다.
/// 체이닝은 구획마다 위험 아님 + allowlist 를 통과해야 한다 — 한 구획이라도 걸리면 명령 전체가 수동으로 간다.
/// 어디서든 탈락: `$` · `` ` `` · 개행/CR. 따옴표 밖 탈락: 홑 `|` · 홑 `&` · `>` `<` · `(` `)` · `{` `}` · `\`. 빈 구획 · 안 닫힌 따옴표도 `None`.
/// `$` 를 통째로 막는 것은 의도다 — 변수가 경로를 숨길 수 있어(`$HOME/x`) 여기서는 풀지 않는다.
#[cfg_attr(not(test), allow(dead_code))] // 공유 표 시험이 이 이름으로 잠근다
pub(crate) fn segments_for_auto_approval(command: &str) -> Option<Vec<String>> {
    split_segments(command).ok()
}

/// `policy.ts splitForPolicy` 와 같은 의미. 파이프 허용이 꺼져 있으면 [`split_segments`] 그대로. 켜져 있고 파이프로만 실패했으면 맨 `|` 와
/// `&&` 에서 나누고(`;` · `||` 와 섞이면 `PipeMix`), 파이프라인이면 부르는 쪽이 단계마다 [`pipe_stage_refused`] 를 본다.
pub(crate) fn split_for_policy(command: &str, allow_pipes: bool) -> Result<(Vec<String>, bool), SplitFail> {
    match split_segments(command) {
        Ok(s) => Ok((s, false)),
        Err(SplitFail::Pipe) if allow_pipes => split_pipeline(command).map(|s| (s, true)),
        Err(e) => Err(e),
    }
}

/// 파이프라인 단계에서 **늘 거절하는** 프로그램 — 다른 명령을 실행하거나(xargs · 셸 · 감싸개 · 권한 상승 · 원격 · 인터프리터)
/// 파일을 쓰는(`tee`) 것. 허용 목록에 있어도 거절한다. **바꾸면 `policy.ts` 의 `PIPE_REFUSED` 도 함께 고친다.**
pub(crate) const PIPE_REFUSED: &[&str] = &[
    "xargs", "parallel", "sh", "bash", "zsh", "dash", "ksh", "fish", "busybox", "env", "eval", "exec", "command", "builtin",
    "source", ".", "nohup", "time", "timeout", "watch", "nice", "ionice", "stdbuf", "chrt", "taskset", "sudo", "su", "doas",
    "pkexec", "ssh", "python", "python3", "perl", "ruby", "node", "php", "lua", "tee",
];

/// 파이프라인 단계 하나를 **늘 거절하는가** — [`PIPE_REFUSED`] · 변수 대입 앞머리(`A=1 cmd`) · `find` 의
/// `-exec`/`-execdir`/`-ok`/`-okdir`/`-delete` · `awk` 류 스크립트의 `system(` · `|`(스크립트 안 파이프) · 낱말로 못 나눔. **순수**.
pub(crate) fn pipe_stage_refused(segment: &str) -> bool {
    let Some(words) = shell_words(segment) else {
        return true;
    };
    let Some(first) = words.first() else {
        return true;
    };
    if first.contains('=') {
        return true;
    }
    let exec = basename(first);
    if PIPE_REFUSED.contains(&exec) {
        return true;
    }
    let args = &words[1..];
    match exec {
        "find" => args
            .iter()
            .any(|a| matches!(a.as_str(), "-exec" | "-execdir" | "-ok" | "-okdir" | "-delete")),
        "awk" | "gawk" | "mawk" | "nawk" => args.iter().any(|a| a.contains("system") || a.contains('|')),
        _ => false,
    }
}

fn split_pipeline(command: &str) -> Result<Vec<String>, SplitFail> {
    split_with(command, true)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SplitFail {
    Pipe,
    /// 파이프와 `;` · `||` 가 섞였다(파이프 허용을 켜도 사람 승인).
    PipeMix,
    Redirect,
    Subst,
    Background,
    Group,
    Escape,
    Newline,
    Quote,
    Empty,
}

pub(crate) fn split_segments(command: &str) -> Result<Vec<String>, SplitFail> {
    split_with(command, false)
}

fn split_with(command: &str, pipes: bool) -> Result<Vec<String>, SplitFail> {
    let chars: Vec<char> = command.chars().collect();
    let mut segments: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quote = Quote::None;
    let mut i = 0usize;

    fn push(cur: &mut String, segments: &mut Vec<String>) -> bool {
        let seg = cur.trim().to_string();
        cur.clear();
        if seg.is_empty() {
            return false;
        }
        segments.push(seg);
        true
    }

    while i < chars.len() {
        let c = chars[i];
        // 치환 · 개행은 따옴표 안에서도 탈락 — `"$(x)"` · ``"`x`"`` 는 큰따옴표 안에서도 살아 있다.
        if matches!(c, '$' | '`') {
            return Err(SplitFail::Subst);
        }
        if matches!(c, '\n' | '\r') {
            return Err(SplitFail::Newline);
        }

        match quote {
            Quote::Single => {
                if c == '\'' {
                    quote = Quote::None;
                }
                cur.push(c);
                i += 1;
            }
            Quote::Double => {
                // `\"` · `\\` 만 한 쌍으로 삼킨다 — 닫힘 판정이 어긋나지 않게.
                if c == '\\' && matches!(chars.get(i + 1), Some('"') | Some('\\')) {
                    cur.push(c);
                    cur.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if c == '"' {
                    quote = Quote::None;
                }
                cur.push(c);
                i += 1;
            }
            Quote::None => match c {
                '\'' => {
                    quote = Quote::Single;
                    cur.push(c);
                    i += 1;
                }
                '"' => {
                    quote = Quote::Double;
                    cur.push(c);
                    i += 1;
                }
                '&' => {
                    if chars.get(i + 1) != Some(&'&') {
                        return Err(SplitFail::Background);
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 2;
                }
                '|' => {
                    if chars.get(i + 1) != Some(&'|') {
                        if !pipes {
                            return Err(SplitFail::Pipe);
                        }
                        // `|&` 는 오류까지 넘기는 파이프라 탈락.
                        if chars.get(i + 1) == Some(&'&') {
                            return Err(SplitFail::Background);
                        }
                        if !push(&mut cur, &mut segments) {
                            return Err(SplitFail::Empty);
                        }
                        i += 1;
                        continue;
                    }
                    if pipes {
                        return Err(SplitFail::PipeMix);
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 2;
                }
                ';' => {
                    if pipes {
                        return Err(SplitFail::PipeMix);
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 1;
                }
                '>' | '<' => return Err(SplitFail::Redirect),
                '(' | ')' | '{' | '}' => return Err(SplitFail::Group),
                '\\' => return Err(SplitFail::Escape),
                _ => {
                    cur.push(c);
                    i += 1;
                }
            },
        }
    }

    if quote != Quote::None {
        return Err(SplitFail::Quote);
    }
    if !push(&mut cur, &mut segments) {
        return Err(SplitFail::Empty);
    }
    Ok(segments)
}

/// `policy.ts commandPassesAutoPolicy` 와 같은 의미. **모든 구획**이 위험 아님 + (평탄 prefix 또는 구조적 규칙)이어야 한다 — 가장 약한 구획이
/// 전체를 끌어내린다. AI 가 준 검증 명령도 같은 술어를 통과해야 한다(`operations::gate`). 구조적 규칙은 사용자 `allow` 와 켜진 묶음이 펼친
/// 규칙의 합집합 — 묶음의 효력은 프런트가 아니라 **여기서** 난다(프런트가 펼쳐 보내면 프런트 버그가 곧 범위 확장이다).
pub(crate) fn command_passes_auto_policy(command: &str, prefs: &AutomationPrefs) -> bool {
    let Ok((segments, pipeline)) = split_for_policy(command, prefs.allow_pipes) else {
        return false;
    };
    if pipeline && segments.iter().any(|s| pipe_stage_refused(s)) {
        return false;
    }
    let rules = crate::automation_presets::effective_allow_rules(prefs);
    for seg in &segments {
        if classify_risk(seg) != Risk::Safe {
            return false;
        }
        // 무엇으로 매칭돼도 바닥(위험 아님 · 구획 분해 성공)은 AND 로 남는다.
        if !matches_allowlist(seg, &prefs.allow_patterns) && !matches_structured_allow(seg, &rules)
        {
            return false;
        }
    }
    true
}

/// `policy.ts matchesAllowlist` 와 같은 의미 — 단어 경계 prefix: `"df"` 는 `df` · `df -h` 를 맞추고 `dfx` 는 아니다.
pub(crate) fn matches_allowlist(command: &str, patterns: &[String]) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }
    for raw in patterns {
        let p = raw.trim();
        if p.is_empty() {
            continue;
        }
        if cmd == p {
            return true;
        }
        // 바로 뒤 문자가 공백이어야 한다(단어 경계). 문자열 끝은 JS `charAt` 과 같게 false.
        if let Some(stripped) = cmd.strip_prefix(p) {
            if stripped.chars().next().is_some_and(char::is_whitespace) {
                return true;
            }
        }
    }
    false
}

/// `policy.ts matchesStructuredAllow` 와 같은 의미. exec = 첫 토큰의 basename · 서브커맨드 = exec 뒤 `-` 로 시작하지 않는 첫 토큰.
/// 인자 제약이 없는 옛 모양 규칙은 예전과 글자 그대로 같은 판정이다. 같은 exec 의 규칙은 OR · **모호하면 `false` 쪽으로**(수동 승인).
pub(crate) fn matches_structured_allow(
    command: &str,
    rules: &[crate::settings::AllowRule],
) -> bool {
    let Some(seg) = SegmentWords::new(command) else {
        return false;
    };
    rules
        .iter()
        .any(|rule| matches!(seg.check(rule), RuleCheck::Pass))
}

pub(crate) struct SegmentWords<'a> {
    command: &'a str,
    exec: &'a str,
    subcommand: Option<&'a str>,
    words: std::cell::OnceCell<Option<Vec<String>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RuleCheck {
    Miss,
    SubMiss(Option<String>),
    Fail(ArgFail),
    Pass,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ArgFail {
    /// `deny_flags` 항목 형식이 틀려 규칙째 꺼져 있다.
    BadDeny,
    /// 낱말로 못 나누거나 공백 분해와 어긋났다(따옴표가 경계를 바꿈).
    Words,
    SubFirst,
    Deny(String),
    NotAllowed(String),
    Require(String),
    FirstArg(String),
    MaxArgs(u32),
}

impl<'a> SegmentWords<'a> {
    pub(crate) fn new(command: &'a str) -> Option<Self> {
        let mut tokens = command.split_whitespace();
        let first = tokens.next()?;
        let exec = basename(first);
        if exec.is_empty() {
            return None;
        }
        let subcommand = tokens.find(|t| !t.starts_with('-'));
        Some(Self {
            command,
            exec,
            subcommand,
            words: std::cell::OnceCell::new(),
        })
    }

    fn second_is_flag(&self) -> bool {
        self.command
            .split_whitespace()
            .nth(1)
            .is_some_and(|t| t.starts_with('-'))
    }

    pub(crate) fn check(&self, rule: &crate::settings::AllowRule) -> RuleCheck {
        if rule.exec != self.exec {
            return RuleCheck::Miss;
        }
        // 서브커맨드 찾기는 플래그를 건너뛰어 그 값을 서브커맨드로 읽으므로(`git -C /srv status` → `/srv`) 이유를 먼저 정한다 — 판정은 같다.
        if rule.sub_first && !rule.subcommands.is_empty() && self.second_is_flag() {
            return RuleCheck::Fail(ArgFail::SubFirst);
        }
        if !rule.subcommands.is_empty() {
            match self.subcommand {
                Some(sub) if rule.subcommands.iter().any(|s| s == sub) => {}
                other => return RuleCheck::SubMiss(other.map(str::to_string)),
            }
        }
        if !has_arg_constraints(rule) {
            return RuleCheck::Pass; // 옛 모양 규칙 — 인자는 보지 않는다(하위 호환).
        }
        let Some(ws) = self
            .words
            .get_or_init(|| shell_words(self.command))
            .as_deref()
        else {
            return RuleCheck::Fail(ArgFail::Words); // 제약을 확인할 수 없으니 불통.
        };
        let raw_sub = if rule.subcommands.is_empty() {
            None
        } else {
            self.subcommand
        };
        match arg_constraints_check(rule, self.exec, raw_sub, ws) {
            Ok(()) => RuleCheck::Pass,
            Err(f) => RuleCheck::Fail(f),
        }
    }
}

fn basename(token: &str) -> &str {
    token.rsplit('/').next().unwrap_or(token)
}

pub(crate) fn has_arg_constraints(rule: &crate::settings::AllowRule) -> bool {
    !rule.deny_flags.is_empty()
        || !rule.allow_flags.is_empty()
        || !rule.require_flags.is_empty()
        || !rule.first_arg.is_empty()
        || rule.max_args.is_some()
        || rule.sub_first
}

/// `policy.ts shellWords` 와 같다. 낱말 경계는 ASCII 공백뿐 — 비ASCII 공백은 글자다(공백 분해와 어긋나면 [`arg_constraints_check`] 가 불통).
/// 따옴표 밖 `\` · 개행은 `None`(구획 분해가 이미 막지만 직접 불려도 안전하게). `''` 는 빈 낱말 하나다.
pub(crate) fn shell_words(segment: &str) -> Option<Vec<String>> {
    let chars: Vec<char> = segment.chars().collect();
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote = Quote::None;
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            Quote::Single => {
                if c == '\'' {
                    quote = Quote::None;
                } else {
                    cur.push(c);
                }
            }
            Quote::Double => {
                if c == '\\' && matches!(chars.get(i + 1), Some('"') | Some('\\')) {
                    cur.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if c == '"' {
                    quote = Quote::None;
                } else {
                    cur.push(c);
                }
            }
            Quote::None => match c {
                ' ' | '\t' | '\u{0b}' | '\u{0c}' => {
                    if in_word {
                        words.push(std::mem::take(&mut cur));
                        in_word = false;
                    }
                }
                '\'' => {
                    quote = Quote::Single;
                    in_word = true;
                }
                '"' => {
                    quote = Quote::Double;
                    in_word = true;
                }
                '\\' | '\n' | '\r' => return None,
                _ => {
                    cur.push(c);
                    in_word = true;
                }
            },
        }
        i += 1;
    }
    if quote != Quote::None {
        return None;
    }
    if in_word {
        words.push(cur);
    }
    Some(words)
}

/// 홀로 선 `-` 는 플래그가 아니다(표준 입력이라는 인자다).
fn is_flag(word: &str) -> bool {
    word.chars().count() >= 2 && word.starts_with('-')
}

fn is_short_cluster(word: &str) -> bool {
    is_flag(word) && !word.starts_with("--")
}

fn short_letter(pattern: &str) -> Option<char> {
    let mut it = pattern.chars();
    match (it.next(), it.next(), it.next()) {
        (Some('-'), Some(c), None) if c != '-' => Some(c),
        _ => None,
    }
}

fn flag_name(word: &str) -> &str {
    word.split('=').next().unwrap_or(word)
}

fn split_wild(pattern: &str) -> (&str, bool) {
    match pattern.strip_suffix('*') {
        Some(stem) => (stem, true),
        None => (pattern, false),
    }
}

/// `-` 로 시작하고 `*` 는 끝에만. 틀린 항목이 하나라도 있으면 그 규칙은 **매칭되지 않는다**(의도한 금지를 못 지킬 바엔 수동이 낫다).
fn deny_pattern_ok(pattern: &str) -> bool {
    let (stem, _) = split_wild(pattern);
    pattern.starts_with('-') && !stem.contains('*')
}

/// `-x`: 짧은 묶음 낱말 안 어디든(값이 붙은 `-owide` 의 글자도 봐서 오탐이 있다 — 수동으로 떨어지는 안전한 방향).
/// `--name`: 이름이 같거나 `*` 면 접두이거나 **줄임**(`--fol` → `--follow` — getopt_long · git 이 받는다). `-name`: 같되 대시 하나짜리 낱말에만.
fn deny_hits(pattern: &str, word: &str) -> bool {
    let (stem, wild) = split_wild(pattern);
    let name = flag_name(word);
    let long_match = |min_abbrev: usize| {
        let direct = if wild {
            name.starts_with(stem)
        } else {
            name == stem
        };
        direct || (name.chars().count() >= min_abbrev && stem.starts_with(name))
    };
    if stem.starts_with("--") {
        word.starts_with("--") && long_match(3)
    } else if let (false, Some(c)) = (wild, short_letter(stem)) {
        is_short_cluster(word) && word.chars().skip(1).any(|w| w == c)
    } else {
        is_short_cluster(word) && long_match(2)
    }
}

/// 짧은 묶음이면 글자마다 `-글자` 가 목록에 있어야 한다. 줄임은 받지 않는다.
fn flag_allowed(list: &[String], word: &str) -> bool {
    let name = flag_name(word);
    let named = list.iter().any(|p| {
        let (stem, wild) = split_wild(p);
        if wild {
            name.starts_with(stem)
        } else {
            name == stem
        }
    });
    if named {
        return true;
    }
    is_short_cluster(word)
        && word
            .chars()
            .skip(1)
            .all(|c| list.iter().any(|p| short_letter(p) == Some(c)))
}

/// 같은 이름에 값이 붙은 낱말(`--no-stream=false`)이 하나라도 있으면 없는 것으로 본다.
fn required_present(pattern: &str, flags: &[&str]) -> bool {
    let letter = short_letter(pattern);
    let found = flags.iter().any(|w| {
        *w == pattern
            || letter.is_some_and(|c| {
                is_short_cluster(w) && !w.contains('=') && w.chars().skip(1).any(|x| x == c)
            })
    });
    let poisoned = flags
        .iter()
        .any(|w| w.contains('=') && flag_name(w) == pattern);
    found && !poisoned
}

fn arg_matches(pattern: &str, arg: &str) -> bool {
    let (stem, wild) = split_wild(pattern);
    if wild {
        arg.starts_with(stem)
    } else {
        arg == stem
    }
}

/// `policy.ts argConstraintsHold` 와 같다. 공백 분해로 찾은 exec · 서브커맨드와 낱말 분해가 어긋나면(따옴표가 경계를 바꿈) 불통.
/// `--` 뒤는 전부 인자다. `first_arg` 는 첫 인자가 없으면 통과.
fn arg_constraints_check(
    rule: &crate::settings::AllowRule,
    exec: &str,
    raw_sub: Option<&str>,
    words: &[String],
) -> Result<(), ArgFail> {
    if !rule.deny_flags.iter().all(|p| deny_pattern_ok(p)) {
        return Err(ArgFail::BadDeny);
    }
    let Some((first, rest)) = words.split_first() else {
        return Err(ArgFail::Words);
    };
    if basename(first) != exec {
        return Err(ArgFail::Words);
    }
    // 서브커맨드는 exec 바로 다음 낱말이어야 한다 — 앞 플래그의 값이 서브커맨드로 위장하지 못하게.
    if let (true, Some(sub)) = (rule.sub_first, raw_sub) {
        match rest.first() {
            Some(w) if w == sub => {}
            Some(w) if is_flag(w) => return Err(ArgFail::SubFirst),
            _ => return Err(ArgFail::Words),
        }
    }
    let mut flags: Vec<&str> = Vec::new();
    let mut positionals: Vec<&str> = Vec::new();
    let mut after_dd = false;
    for w in rest {
        if after_dd {
            positionals.push(w);
        } else if w == "--" {
            after_dd = true;
        } else if is_flag(w) {
            flags.push(w);
        } else {
            positionals.push(w);
        }
    }
    let args: &[&str] = match raw_sub {
        Some(sub) => match positionals.split_first() {
            Some((first_pos, after)) if *first_pos == sub => after,
            _ => return Err(ArgFail::Words),
        },
        None => &positionals,
    };

    if let Some(w) = flags
        .iter()
        .find(|w| rule.deny_flags.iter().any(|p| deny_hits(p, w)))
    {
        return Err(ArgFail::Deny((*w).to_string()));
    }
    if !rule.allow_flags.is_empty() {
        if let Some(w) = flags.iter().find(|w| !flag_allowed(&rule.allow_flags, w)) {
            return Err(ArgFail::NotAllowed((*w).to_string()));
        }
    }
    if let Some(p) = rule
        .require_flags
        .iter()
        .find(|p| !required_present(p, &flags))
    {
        return Err(ArgFail::Require(p.clone()));
    }
    if let (false, Some(a)) = (rule.first_arg.is_empty(), args.first()) {
        if !rule.first_arg.iter().any(|p| arg_matches(p, a)) {
            return Err(ArgFail::FirstArg((*a).to_string()));
        }
    }
    if let Some(max) = rule.max_args {
        if args.len() > max as usize {
            return Err(ArgFail::MaxArgs(max));
        }
    }
    Ok(())
}

/// `policy.ts shouldAutoApprove` 와 같은 5조건 AND(켬 · 구획 분해 · 구획마다 위험 아님 · 구획마다 allowlist · `target_count <= max_targets`).
/// **바꾸면 `policy.ts` 도 함께 고친다.** `max_concurrency` 는 수동 · 자동 공통이라 [`crate::operations::exceeds_limits`] 가 따로 강제한다.
pub(crate) fn should_auto_approve(
    command: &str,
    target_count: usize,
    prefs: &AutomationPrefs,
) -> bool {
    if !prefs.auto_approve {
        return false;
    }
    if !command_passes_auto_policy(command, prefs) {
        return false;
    }
    if target_count > prefs.max_targets as usize {
        return false;
    }
    true
}

pub(crate) mod explain;

#[cfg(test)]
mod tests;
