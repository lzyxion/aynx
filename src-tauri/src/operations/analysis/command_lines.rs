//! 줄 나누기 — 긴 셸 명령을 최상위 구획(줄)으로 나누고(글자를 잃지 않는다) 줄마다 효과 · 줄 안 효과 낱말 자리를 단다.

use super::shell_effect::{analyze_flat, base, segment_at, short_has, SegScan};
use super::shell_lex::{heredoc_delim, heredoc_end, split_shell, texts_of};
use super::types::{CmdLine, Computed, LineMark};

// ---------------------------------------------------------------------------
// 줄 나누기 — 긴 한 줄 명령을 카드에 줄로 펼친다
// ---------------------------------------------------------------------------

/// 따옴표 · 치환 · 괄호를 아는 **최상위 구획 훑개** — [`split_shell`] 과 따로다(그쪽은 낱말을 뽑고, 이쪽은 원문 글자를 고치지 않고
/// 구획 경계만 찾는다). 맨 위의 heredoc 본문은 [`scan_pieces`] 가 연 줄에 붙여 건넌다. 괄호(`$(…)`) 안에서 `<<` 를 만나면 `heredoc` 을
/// 세운다 — 본문 글자가 짝 찾기를 흔들 수 있어 그때는 줄을 내지 않는다.
struct LineScan<'a> {
    c: &'a [char],
    heredoc: bool,
}

impl LineScan<'_> {
    /// 낱말의 첫 자리인가(앞이 없거나 빈칸 · 연산자) — `#` 주석 · `{` 묶음을 알아보는 데 쓴다.
    fn word_start(&self, i: usize) -> bool {
        i == 0 || matches!(self.c[i - 1], ' ' | '\t' | '\n' | '\r' | ';' | '&' | '|' | '(' | ')')
    }

    /// `'` 에서 — 닫는 `'` 다음 자리(닫히지 않으면 끝).
    fn squote(&self, i: usize) -> usize {
        let mut k = i + 1;
        while k < self.c.len() && self.c[k] != '\'' {
            k += 1;
        }
        (k + 1).min(self.c.len())
    }

    /// `"` 에서 — 닫는 `"` 다음 자리. 안의 `$(…)` · 백틱은 그 짝까지 건넌다(안에 `"` 가 또 있을 수 있다).
    fn dquote(&mut self, i: usize) -> usize {
        let n = self.c.len();
        let mut k = i + 1;
        while k < n {
            match self.c[k] {
                '\\' => k += 2,
                '"' => return k + 1,
                '$' if self.c.get(k + 1) == Some(&'(') => k = self.paren(k + 2),
                '`' => k = self.backtick(k),
                _ => k += 1,
            }
        }
        n
    }

    /// 백틱에서 — 닫는 백틱 다음 자리.
    fn backtick(&self, i: usize) -> usize {
        let n = self.c.len();
        let mut k = i + 1;
        while k < n {
            match self.c[k] {
                '\\' => k += 2,
                '`' => return k + 1,
                _ => k += 1,
            }
        }
        n
    }

    /// `(` 바로 다음에서 — 짝 `)` 다음 자리(`$(…)` · `(…)` · `<(…)` 모두). 안의 따옴표 · 주석 · 겹친 괄호를 건넌다.
    fn paren(&mut self, i: usize) -> usize {
        let n = self.c.len();
        let mut depth = 1usize;
        let mut k = i;
        while k < n {
            match self.c[k] {
                '\'' => k = self.squote(k),
                '"' => k = self.dquote(k),
                '`' => k = self.backtick(k),
                '\\' => k += 2,
                '(' => {
                    depth += 1;
                    k += 1;
                }
                ')' => {
                    depth -= 1;
                    k += 1;
                    if depth == 0 {
                        return k;
                    }
                }
                '<' if self.c.get(k + 1) == Some(&'<') => {
                    self.heredoc = true;
                    k += 2;
                }
                '#' if self.word_start(k) => {
                    while k < n && self.c[k] != '\n' {
                        k += 1;
                    }
                }
                _ => k += 1,
            }
        }
        n
    }
}

/// 최상위 구획(원문 조각 · 그 뒤 구분자) — 빈 조각도 그대로. 괄호 안 heredoc 이 있으면 `None`. 맨 위 heredoc 의 본문(`<<` 줄 끝의
/// 줄바꿈부터 구분 줄까지)은 연 줄의 조각에 붙는다 — 본문 안 줄바꿈 · 본문이 오기 전 같은 줄의 구분자에서는 나누지 않는다.
/// 나누는 곳: 깊이 0 의 `;` · `&&` · `||` · 홀로 `&` · 줄바꿈. 나누지 않는 곳: 파이프(`|` · `|&`) · 리다이렉트(`&>` · `>&` · `2>&1` · `<&`) ·
/// 따옴표 · `$(…)` · 백틱 · `(…)` · `{ … }` 안 · `#` 주석(줄 끝까지 — 줄바꿈은 나눈다) · 줄 이음(`\` + 줄바꿈).
fn scan_pieces(cmd: &str) -> Option<Vec<(String, Option<&'static str>)>> {
    let chars: Vec<char> = cmd.chars().collect();
    let n = chars.len();
    let mut sc = LineScan { c: &chars, heredoc: false };
    let mut pieces = Vec::new();
    // 이 줄에서 연 heredoc 의 (구분 낱말 · `<<-`) — 본문은 그 줄 몫이라 다음 줄바꿈에서 구분 줄까지 한 조각으로 건넌다.
    let mut pending: Vec<(String, bool)> = Vec::new();
    let mut start = 0usize;
    let mut brace = 0usize;
    let mut i = 0usize;
    while i < n {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let mut sep: Option<(&'static str, usize)> = None;
        match c {
            '\'' => i = sc.squote(i),
            '"' => i = sc.dquote(i),
            '`' => i = sc.backtick(i),
            '\\' => i += 2,
            '$' if next == Some('(') => i = sc.paren(i + 2),
            '(' => i = sc.paren(i + 1),
            '#' if sc.word_start(i) => {
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
            }
            '{' if sc.word_start(i) && next.is_none_or(char::is_whitespace) => {
                brace += 1;
                i += 1;
            }
            '}' if brace > 0
                && i > 0
                && matches!(chars[i - 1], ' ' | '\t' | '\n' | ';' | '&')
                && next.is_none_or(|d| d.is_whitespace() || matches!(d, ';' | '&' | '|' | ')')) =>
            {
                brace -= 1;
                i += 1;
            }
            // here-string `<<<` — 뒤 낱말은 보통 글이다.
            '<' if next == Some('<') && chars.get(i + 2) == Some(&'<') => i += 3,
            '<' if next == Some('<') => {
                let dash = chars.get(i + 2) == Some(&'-');
                let (delim, _, nx) = heredoc_delim(&chars, i + 2 + usize::from(dash));
                if !delim.is_empty() {
                    pending.push((delim, dash));
                }
                i = nx;
            }
            // 리다이렉트의 fd 복제 · 파일(`2>&1` · `<&3` · `&>` · `|&`) — 구분자가 아니다.
            '<' | '>' if next == Some('&') => i += 2,
            '&' if next == Some('>') => i += 2,
            '|' if next == Some('&') => i += 2,
            '|' if next == Some('|') => sep = Some(("||", 2)),
            '&' if next == Some('&') => sep = Some(("&&", 2)),
            '&' => sep = Some(("&", 1)),
            ';' => sep = Some((";", 1)),
            '\n' => sep = Some(("\n", 1)),
            _ => i += 1,
        }
        if let Some((s, len)) = sep {
            if !pending.is_empty() {
                if s == "\n" {
                    // 본문들을 건너 마지막 구분 줄의 끝으로(그 줄바꿈이 다음 구분자다 — 못 찾으면 글 끝까지 본문).
                    let mut at = i + 1;
                    let mut last = n;
                    for (d, dash) in pending.drain(..) {
                        let Some((_, le)) = heredoc_end(&chars, at, &d, dash) else {
                            last = n;
                            break;
                        };
                        last = le;
                        at = le + 1;
                    }
                    i = last;
                } else {
                    // 본문이 아직 오지 않았다 — 같은 줄의 `;` · `&&` 에서 나누면 본문이 뒤 조각으로 넘어간다. 나누지 않는다.
                    i += len;
                }
                continue;
            }
            if brace == 0 {
                pieces.push((chars[start..i].iter().collect::<String>(), Some(s)));
                start = i + len;
            }
            i += len;
        }
    }
    if sc.heredoc {
        return None;
    }
    pieces.push((chars[start.min(n)..].iter().collect::<String>(), None));
    Some(pieces)
}

/// 긴 명령의 줄들 — 2줄 이상일 때, 또는 한 줄이라도 읽기가 아니거나 `sudo` 표시가 있을 때(그 한 줄 — 줄 안 표시를 실으려고).
/// 그 밖의 읽기 한 줄 · 치환 안 heredoc 이면 비움.
/// 빈 조각은 버리되 구분자 글자는 잃지 않는다
/// (앞 줄 구분자가 줄바꿈이면 이것으로 바꾸고, 이미 구분자가 있으면 이어 붙인다 — `a;;` 같은 드문 꼴). **글자를 잃지 않는다**:
/// 공백을 빼면 원문 = 줄마다 `text + sep` 를 이은 것(시험 `lines_are_lossless`).
pub(crate) fn command_lines(cmd: &str) -> Vec<CmdLine> {
    let Some(pieces) = scan_pieces(cmd) else {
        return Vec::new();
    };
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    // 첫 줄 앞의 구분자(문법 오류지만 글자는 지킨다) — 다음 줄 글 앞에 붙인다.
    let mut carry = String::new();
    for (raw, sep) in pieces {
        let text = raw.trim();
        if text.is_empty() {
            let Some(s) = sep.filter(|s| *s != "\n") else { continue };
            match out.last_mut() {
                Some((_, Some(p))) if p.as_str() != "\n" => p.push_str(s),
                Some((_, prev)) => *prev = Some(s.to_string()),
                None => carry.push_str(s),
            }
            continue;
        }
        let text = if carry.is_empty() { text.to_string() } else { format!("{} {text}", std::mem::take(&mut carry)) };
        out.push((text, sep.map(str::to_string)));
    }
    // 마지막 줄 뒤 줄바꿈은 뜻이 없다 — 걷는다(`;` · `&` 는 남긴다: 백그라운드 `&` 는 말해 줄 것이 있다).
    if let Some((_, sep)) = out.last_mut() {
        if sep.as_deref() == Some("\n") {
            *sep = None;
        }
    }
    if out.is_empty() {
        return Vec::new();
    }
    let lines: Vec<CmdLine> = out
        .into_iter()
        .map(|(text, sep)| {
            if text.starts_with('#') {
                // 주석뿐인 줄 — 하는 일이 없다(빈 명령의 "확인 필요" 가 아니다).
                return CmdLine { text, sep, effect: Computed::Read, cause: None, quiet: true, over: false, marks: Vec::new(), danger: false };
            }
            let a = analyze_flat(&text);
            let quiet = a.effect == Computed::Read
                && !a.programs.is_empty()
                && a.programs.iter().all(|p| matches!(p.as_str(), "echo" | "printf" | "true" | ":"))
                && !a.tokens.iter().any(|t| t.special);
            // 읽기 줄에는 효과 낱말이 없다 — 남는 것은 권한 올리기(`sudo`) 표시뿐이다.
            let marks = line_marks(&text);
            CmdLine { text, sep, effect: a.effect, cause: a.cause, quiet, over: false, marks, danger: false }
        })
        .collect();
    // 한 줄이면 읽기가 아니거나 `sudo` 표시가 있을 때만 — 그 밖의 읽기 한 줄은 두 줄 접기 상자 그대로(보일 것이 없다).
    if lines.len() == 1 && lines[0].effect == Computed::Read && lines[0].marks.is_empty() {
        return Vec::new();
    }
    lines
}

/// **줄 안의 효과 낱말** — 줄 하나를 [`split_shell`] 로 다시 나눠(같은 나눔 · 같은 따옴표 규칙) 읽기가 아닌 구획마다
/// ① 프로그램 낱말([`segment_at`] 이 감싸개를 벗기고 고른 것 — `sudo rm` 이면 `rm`) ② 근거(`cause`)의 프로그램 뒤 낱말들
/// (`find -delete` → `-delete` · `journalctl --vacuum` → `--vacuum-time=7d` · `sed -i` → `-ri` · `find -exec rm` → `-exec` · `rm`)을,
/// 그리고 구획 밖 근거의 연산자(`>` · `&>` · `$(` · 백틱 · `<<` · `<(`)를 표시한다. 읽기 구획은 칠하지 않는다 — 다만 권한 올리기 낱말
/// (`sudo` · `doas` · `pkexec` · `su`)은 구획의 효과와 무관하게 `kind: "sudo"` 로 표시한다. heredoc 본문은 낱말이 아니라 칠해지지 않는다.
///
/// **틀린 자리는 내지 않는다** — 근거 낱말은 그 구획 안 프로그램 뒤에서 차례대로, 따옴표 없이 적힌 낱말에서만 찾고, 못 찾으면 그 표시만
/// 빠진다. 겹치면 앞의 것만 남긴다. 순수.
fn line_marks(text: &str) -> Vec<LineMark> {
    let split = split_shell(text);
    let mut marks: Vec<LineMark> = Vec::new();
    for seg in &split.segments {
        let SegScan { prog, verdict: v, at, sudo_at, .. } = segment_at(&texts_of(seg));
        // 권한 올리기 낱말 — 읽기 구획에서도(효과와 따로 보이는 사실이다). 같은 자리의 프로그램 표시(`su`)보다 먼저 넣어 이긴다.
        for k in sudo_at {
            if seg[k].plain {
                marks.push(LineMark { start: seg[k].start, end: seg[k].end, effect: v.effect, kind: Some("sudo".into()) });
            }
        }
        if v.effect == Computed::Read {
            continue;
        }
        let Some(at) = at else { continue };
        marks.push(LineMark { start: seg[at].start, end: seg[at].end, effect: v.effect, kind: None });
        let Some(cause) = v.cause.as_deref() else { continue };
        let mut toks = cause.split_whitespace();
        // 근거가 이 프로그램으로 시작할 때만 나머지 낱말을 찾는다.
        if toks.next() != prog.as_deref() {
            continue;
        }
        let mut from = at + 1;
        for t in toks {
            if let Some(k) = (from..seg.len()).find(|&k| seg[k].plain && trigger_matches(&seg[k].text, t)) {
                marks.push(LineMark { start: seg[k].start, end: seg[k].end, effect: v.effect, kind: None });
                from = k + 1;
            }
        }
    }
    for &(start, end, effect) in &split.ops {
        marks.push(LineMark { start, end, effect, kind: None });
    }
    marks.sort_by_key(|m| (m.start, m.end));
    let mut out: Vec<LineMark> = Vec::with_capacity(marks.len());
    for m in marks {
        if m.start < m.end && out.last().is_none_or(|p| m.start >= p.end) {
            out.push(m);
        }
    }
    out
}

/// 근거의 낱말 `t` 가 적힌 낱말 `w` 인가 — 같은 글자 · 경로를 뗀 이름(`/bin/rm`) · 대소문자만 다른 값(`curl -X post`) · 값을 붙인
/// 플래그(`--vacuum` → `--vacuum-time=7d` · `-out` → `-out=x` — 바로 뒤가 `=` 이거나 긴 플래그의 `-` 일 때만: `-out` 이 `-outform`
/// 을 칠하지 않게) · 짧은 플래그 하나가 든 묶음(`-i` → `-ri`).
fn trigger_matches(w: &str, t: &str) -> bool {
    if w == t || base(w) == t || (!t.starts_with('-') && w.eq_ignore_ascii_case(t)) {
        return true;
    }
    if t.starts_with('-') {
        if let Some(rest) = w.strip_prefix(t) {
            if rest.starts_with('=') || (t.starts_with("--") && rest.starts_with('-')) {
                return true;
            }
        }
    }
    let mut cs = t.chars();
    if let (Some('-'), Some(c), None) = (cs.next(), cs.next(), cs.next()) {
        return c != '-' && short_has(w, c);
    }
    false
}
