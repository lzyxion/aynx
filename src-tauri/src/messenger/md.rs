//! 메신저로 가는 AI 글의 마크다운 — 작은 해석기 하나 · 채널 중립 IR([`Block`] · [`Inline`]) · IR 의 그리기(Telegram HTML · Discord 마크다운 · 평문).
//! Slack `rich_text` 조각은 이 IR 로 `server::messenger_bridge::sl` 이 짓는다. 순수 함수뿐이다.
//!
//! - **링크는 누를 수 없는 글자로** — `[글자](주소)` → `글자 (주소)`(주소가 글자와 같으면 한 번) · 그림 → alt · `<https://…>` → 주소.
//!   링크 · 멘션 요소를 만드는 IR 은 없다 — 글자는 그리는 쪽이 채널마다 걷는다.
//! - 강조는 CommonMark 의 flanking 을 따르지 않는다 — 여는 기호 뒤 · 닫는 기호 앞이 공백이 아니면 짝(한국어 `**굵게**는`).
//!   `_` 만 낱말 경계를 본다(`snake_case`) · `__이름__`(영숫자 · `_` 뿐)은 굵게가 아니다(파이썬 `__init__`).
//! - IR 의 `Open` · `Close` 는 구성상 늘 짝이 맞고 겹치지 않는다 — 그리기는 태그 균형을 따로 맞추지 않는다.
//! - 코드 span · 링크의 짝 찾기는 [`LOOKAHEAD`] 글자 안에서만 — 기호뿐인 긴 줄에서 제곱 시간이 되지 않게.

/// 짝 찾기의 앞보기 상한(글자).
const LOOKAHEAD: usize = 1000;
/// 링크 글자 안의 링크는 이 깊이까지만 해석한다(그 안은 글자 그대로 — 되부름 깊이 상한).
const LINK_DEPTH: usize = 3;
/// 코드 블록 언어 이름 상한 — Discord 의 울타리 머리에만 쓴다.
const LANG_MAX: usize = 20;
const ZWSP: char = '\u{200b}';

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Bold,
    Italic,
    Strike,
}

impl Mark {
    fn idx(self) -> usize {
        match self {
            Mark::Bold => 0,
            Mark::Italic => 1,
            Mark::Strike => 2,
        }
    }
}

/// `Debug` 없음 — 대화 글자가 `{:?}` 로 흐를 틈을 두지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum Inline {
    Text(String),
    Code(String),
    Open(Mark),
    Close(Mark),
}

/// 글 한 줄 — 제목은 온 줄 굵게, 목록은 `• ` 글자로 이미 바뀌었다.
#[derive(Clone, Default)]
pub(crate) struct Line {
    pub(crate) quote: bool,
    pub(crate) items: Vec<Inline>,
}

pub(crate) enum Block {
    Line(Line),
    /// 울타리 코드 블록 · 표(원문 그대로).
    Code { lang: String, text: String },
    Blank,
}

// ---------------------------------------------------------------------------
// 블록
// ---------------------------------------------------------------------------

/// 울타리 머리 줄.
pub(crate) struct Fence {
    pad: String,
    ch: char,
    len: usize,
    info: String,
}

fn pad_len(line: &str) -> usize {
    line.bytes().take_while(|b| *b == b' ' || *b == b'\t').count()
}

impl Fence {
    pub(crate) fn open(line: &str) -> Option<Fence> {
        let p = pad_len(line);
        let t = &line[p..];
        let ch = t.chars().next().filter(|c| *c == '`' || *c == '~')?;
        let len = t.chars().take_while(|c| *c == ch).count();
        if len < 3 {
            return None;
        }
        let info = t[len..].trim();
        if ch == '`' && info.contains('`') {
            return None;
        }
        Some(Fence { pad: line[..p].to_string(), ch, len, info: info.to_string() })
    }

    fn closes(&self, line: &str) -> bool {
        let t = line.trim();
        t.len() >= self.len && t.chars().all(|c| c == self.ch)
    }

    fn lang(&self) -> String {
        let w = self.info.split_whitespace().next().unwrap_or("");
        let ok = w.chars().count() <= LANG_MAX && w.chars().all(|c| c.is_ascii_alphanumeric() || "+#._-".contains(c));
        if ok { w.to_string() } else { String::new() }
    }

    /// 조각을 나눈 뒤 다음 조각 머리에서 다시 여는 줄 — 언어 이름만 남긴다(상한 [`LANG_MAX`]).
    pub(crate) fn opener(&self) -> String {
        format!("{}{}{}", self.pad, self.ch.to_string().repeat(self.len), self.lang())
    }

    pub(crate) fn closer(&self) -> String {
        format!("{}{}", self.pad, self.ch.to_string().repeat(self.len))
    }
}

/// 글이 열린 울타리 안에서 끝나면 그 울타리 — [`parse`] 와 같은 규칙으로 본다.
pub(crate) fn unclosed_fence(text: &str) -> Option<Fence> {
    let mut open: Option<Fence> = None;
    for line in text.lines() {
        match &open {
            Some(f) if f.closes(line) => open = None,
            Some(_) => {}
            None => open = Fence::open(line),
        }
    }
    open
}

fn dedent(line: &str, n: usize) -> &str {
    &line[pad_len(line).min(n)..]
}

fn is_rule(t: &str) -> bool {
    let mut cs = t.chars().filter(|c| !c.is_whitespace());
    let Some(first) = cs.next() else { return false };
    let n = 1 + cs.clone().count();
    matches!(first, '-' | '*' | '_') && n >= 3 && cs.all(|c| c == first)
}

fn is_table_row(line: &str) -> bool {
    line.trim_start().starts_with('|')
}

fn is_table_rule(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('|') && t.contains('-') && t.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t'))
}

fn heading(t: &str) -> Option<&str> {
    let n = t.bytes().take_while(|b| *b == b'#').count();
    if n == 0 || n > 6 {
        return None;
    }
    let rest = &t[n..];
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let rest = rest.trim();
    let body = rest.trim_end_matches('#');
    // 닫는 `#` 줄은 앞이 공백일 때만(`C#` 은 글자)
    Some(if body.is_empty() || body.ends_with([' ', '\t']) { body.trim_end() } else { rest })
}

fn bullet(t: &str) -> Option<&str> {
    ["- ", "* ", "+ ", "-\t", "*\t", "+\t"].iter().find_map(|p| t.strip_prefix(p))
}

fn text_line(raw: &str) -> Line {
    let raw = raw.trim_end();
    let p = pad_len(raw);
    let (pad, mut t) = raw.split_at(p);
    let quote = t.starts_with('>');
    while let Some(r) = t.strip_prefix('>') {
        t = r.trim_start();
    }
    let mut items = Vec::new();
    if let Some(h) = heading(t) {
        if !h.is_empty() {
            items.push(Inline::Open(Mark::Bold));
            items.extend(inline(h).into_iter().filter(|i| !matches!(i, Inline::Open(Mark::Bold) | Inline::Close(Mark::Bold))));
            items.push(Inline::Close(Mark::Bold));
        }
    } else if let Some(rest) = bullet(t).filter(|_| !is_rule(t)) {
        items.push(Inline::Text(format!("{}• ", if quote { "" } else { pad })));
        items.extend(inline(rest));
    } else {
        if !quote && !pad.is_empty() {
            items.push(Inline::Text(pad.to_string()));
        }
        items.extend(inline(t));
    }
    Line { quote, items: normalize(items) }
}

/// 줄 기반 해석 — 울타리 코드(닫히지 않으면 끝까지) · 표 · 제목 · 목록 · 인용 · 가로줄(빈 줄로) · 빈 줄(여럿은 하나로).
pub(crate) fn parse(src: &str) -> Vec<Block> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out: Vec<Block> = Vec::new();
    let blank = |out: &mut Vec<Block>| {
        if !matches!(out.last(), None | Some(Block::Blank)) {
            out.push(Block::Blank);
        }
    };
    let mut i = 0;
    while i < lines.len() {
        let raw = lines[i];
        if let Some(f) = Fence::open(raw) {
            let mut body: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() && !f.closes(lines[i]) {
                body.push(dedent(lines[i], f.pad.len()));
                i += 1;
            }
            i += 1;
            let text = body.join("\n");
            if !text.trim().is_empty() {
                out.push(Block::Code { lang: f.lang(), text });
            }
            continue;
        }
        if is_table_row(raw) {
            let end = (i..lines.len()).find(|&j| !is_table_row(lines[j])).unwrap_or(lines.len());
            if end - i >= 2 && lines[i..end].iter().any(|l| is_table_rule(l)) {
                let text = lines[i..end].iter().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n");
                out.push(Block::Code { lang: String::new(), text });
                i = end;
                continue;
            }
        }
        let t = raw.trim();
        if t.is_empty() || is_rule(t) {
            blank(&mut out);
        } else {
            let l = text_line(raw);
            if l.visible() == 0 {
                blank(&mut out);
            } else {
                out.push(Block::Line(l));
            }
        }
        i += 1;
    }
    if matches!(out.last(), Some(Block::Blank)) {
        out.pop();
    }
    out
}

// ---------------------------------------------------------------------------
// 인라인
// ---------------------------------------------------------------------------

enum Tok {
    Text(String),
    /// 코드 span · 링크 글자 — 강조가 감쌀 수는 있어도 가르지는 못한다.
    Atom(Vec<Inline>),
    /// `left` = 닫는 쪽으로 쓴 수(왼쪽부터) · `right` = 여는 쪽으로 쓴 수(오른쪽부터).
    Delim { ch: char, len: usize, left: usize, right: usize, open: bool, close: bool },
}

impl Tok {
    fn rest(&self) -> usize {
        match self {
            Tok::Delim { len, left, right, .. } => len - left - right,
            _ => 0,
        }
    }

    fn ch(&self) -> Option<char> {
        match self {
            Tok::Delim { ch, .. } => Some(*ch),
            _ => None,
        }
    }
}

fn run(chars: &[char], i: usize, c: char) -> usize {
    chars[i..].iter().take_while(|x| **x == c).count()
}

/// `from` 부터 정확히 `n` 개짜리 백틱 줄 — 그 시작 위치.
fn backtick_close(chars: &[char], from: usize, n: usize) -> Option<usize> {
    let end = chars.len().min(from + LOOKAHEAD);
    let mut j = from;
    while j < end {
        if chars[j] == '`' {
            let m = run(chars, j, '`');
            if m == n {
                return Some(j);
            }
            j += m;
        } else {
            j += 1;
        }
    }
    None
}

/// 짝 괄호의 닫는 위치 — `\` 다음 글자는 건너뛴다.
fn matching(chars: &[char], from: usize, open: char, close: char) -> Option<usize> {
    let end = chars.len().min(from + LOOKAHEAD);
    let mut depth = 0usize;
    let mut j = from;
    while j < end {
        let c = chars[j];
        if c == '\\' {
            j += 2;
            continue;
        }
        if c == open {
            depth += 1;
        } else if c == close {
            if depth == 0 {
                return Some(j);
            }
            depth -= 1;
        }
        j += 1;
    }
    None
}

/// `[` 위치 `i` 부터 `[글자](주소)` — (글자, 주소, 다음 위치).
fn link(chars: &[char], i: usize) -> Option<(String, String, usize)> {
    let close = matching(chars, i + 1, '[', ']')?;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = matching(chars, close + 2, '(', ')')?;
    let label: String = chars[i + 1..close].iter().collect();
    let inside: String = chars[close + 2..end].iter().collect();
    let inside = inside.trim();
    let url = match inside.strip_prefix('<') {
        Some(r) => r.split('>').next().unwrap_or(""),
        None => inside.split_whitespace().next().unwrap_or(""),
    };
    Some((label, url.to_string(), end + 1))
}

/// `<https://…>` 의 주소.
fn autolink(chars: &[char], i: usize) -> Option<(String, usize)> {
    let end = chars.len().min(i + 1 + LOOKAHEAD);
    let gt = (i + 1..end).find(|&j| chars[j] == '>' || chars[j] == '<' || chars[j].is_whitespace())?;
    if chars[gt] != '>' {
        return None;
    }
    let inner: String = chars[i + 1..gt].iter().collect();
    ["http://", "https://", "mailto:"].iter().any(|p| inner.starts_with(p)).then_some((inner, gt + 1))
}

fn tokens(s: &str, depth: usize) -> Vec<Tok> {
    let chars: Vec<char> = s.chars().collect();
    let mut out: Vec<Tok> = Vec::new();
    let mut buf = String::new();
    let flush = |buf: &mut String, out: &mut Vec<Tok>| {
        if !buf.is_empty() {
            out.push(Tok::Text(std::mem::take(buf)));
        }
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' if chars.get(i + 1).is_some_and(char::is_ascii_punctuation) => {
                buf.push(chars[i + 1]);
                i += 2;
            }
            '`' => {
                let n = run(&chars, i, '`');
                match backtick_close(&chars, i + n, n) {
                    Some(end) => {
                        let inner: String = chars[i + n..end].iter().collect();
                        // 앞뒤 공백 한 칸씩은 걷는다(공백뿐이면 그대로)
                        let inner = match inner.strip_prefix(' ').and_then(|x| x.strip_suffix(' ')) {
                            Some(x) if !inner.trim().is_empty() => x.to_string(),
                            _ => inner,
                        };
                        flush(&mut buf, &mut out);
                        out.push(Tok::Atom(vec![Inline::Code(inner)]));
                        i = end + n;
                    }
                    None => {
                        buf.extend(std::iter::repeat_n('`', n));
                        i += n;
                    }
                }
            }
            '!' if chars.get(i + 1) == Some(&'[') => match link(&chars, i + 1) {
                Some((alt, _, next)) => {
                    buf.push_str(&alt);
                    i = next;
                }
                None => {
                    buf.push('!');
                    i += 1;
                }
            },
            '[' if depth < LINK_DEPTH => match link(&chars, i) {
                Some((label, url, next)) => {
                    let mut items = inline_at(&label, depth + 1);
                    if !url.is_empty() && plain_items(&items) != url {
                        items.push(Inline::Text(format!(" ({url})")));
                    }
                    flush(&mut buf, &mut out);
                    out.push(Tok::Atom(items));
                    i = next;
                }
                None => {
                    buf.push('[');
                    i += 1;
                }
            },
            '<' => match autolink(&chars, i) {
                Some((url, next)) => {
                    buf.push_str(&url);
                    i = next;
                }
                None => {
                    buf.push('<');
                    i += 1;
                }
            },
            '*' | '_' | '~' => {
                let n = run(&chars, i, c);
                let prev = i.checked_sub(1).map(|p| chars[p]);
                let next = chars.get(i + n).copied();
                let mut open = next.is_some_and(|x| !x.is_whitespace());
                let mut close = prev.is_some_and(|x| !x.is_whitespace());
                if c == '_' {
                    open &= !prev.is_some_and(char::is_alphanumeric);
                    close &= !next.is_some_and(char::is_alphanumeric);
                }
                // `~` 는 둘일 때만 취소선(하나 · 셋 이상은 글자)
                if (c == '~' && n != 2) || !(open || close) {
                    buf.extend(std::iter::repeat_n(c, n));
                } else {
                    flush(&mut buf, &mut out);
                    out.push(Tok::Delim { ch: c, len: n, left: 0, right: 0, open, close });
                }
                i += n;
            }
            _ => {
                buf.push(c);
                i += 1;
            }
        }
    }
    flush(&mut buf, &mut out);
    out
}

/// `__이름__` — 사이가 영숫자 · `_` 글자 하나뿐이면 짝으로 보지 않는다.
fn dunder(toks: &[Tok], o: usize, t: usize) -> bool {
    let two = |k: usize| matches!(toks[k], Tok::Delim { len: 2, .. });
    two(o)
        && two(t)
        && t == o + 2
        && matches!(&toks[o + 1], Tok::Text(s) if s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
}

/// 짝 맞추기 — (여는 토큰, 닫는 토큰, 표시)를 맞춘 차례대로. 사이의 여는 기호는 버리므로 구간은 늘 포개진다.
fn emphasis(toks: &mut [Tok]) -> Vec<(usize, usize, Mark)> {
    let mut stack: Vec<usize> = Vec::new();
    let mut matches = Vec::new();
    for t in 0..toks.len() {
        let Tok::Delim { ch, open, close, .. } = toks[t] else { continue };
        if close {
            while toks[t].rest() > 0 {
                let Some(pos) = stack.iter().rposition(|&o| toks[o].ch() == Some(ch) && toks[o].rest() > 0) else { break };
                let o = stack[pos];
                if ch == '_' && dunder(toks, o, t) {
                    break;
                }
                let (ro, rt) = (toks[o].rest(), toks[t].rest());
                if ch == '~' && (ro < 2 || rt < 2) {
                    break;
                }
                let n = if ro >= 2 && rt >= 2 { 2 } else { 1 };
                let mark = match (ch, n) {
                    ('~', _) => Mark::Strike,
                    (_, 2) => Mark::Bold,
                    _ => Mark::Italic,
                };
                if let Tok::Delim { right, .. } = &mut toks[o] {
                    *right += n;
                }
                if let Tok::Delim { left, .. } = &mut toks[t] {
                    *left += n;
                }
                matches.push((o, t, mark));
                stack.truncate(pos + 1);
                if toks[o].rest() == 0 {
                    stack.pop();
                }
            }
        }
        if open && toks[t].rest() > 0 {
            stack.push(t);
        }
    }
    matches
}

fn inline_at(s: &str, depth: usize) -> Vec<Inline> {
    let mut toks = tokens(s, depth);
    let matches = emphasis(&mut toks);
    let mut opens: Vec<Vec<Mark>> = vec![Vec::new(); toks.len()];
    let mut closes: Vec<Vec<Mark>> = vec![Vec::new(); toks.len()];
    for &(o, t, m) in &matches {
        opens[o].push(m);
        closes[t].push(m);
    }
    let mut out = Vec::new();
    for (i, tok) in toks.into_iter().enumerate() {
        // 닫는 쪽은 먼저 맞춘 것이 안쪽, 여는 쪽은 나중에 맞춘 것이 바깥쪽이다
        out.extend(closes[i].iter().map(|m| Inline::Close(*m)));
        match tok {
            Tok::Text(s) => out.push(Inline::Text(s)),
            Tok::Atom(v) => out.extend(v),
            t @ Tok::Delim { ch, .. } => {
                let lit = t.rest();
                if lit > 0 {
                    out.push(Inline::Text(ch.to_string().repeat(lit)));
                }
            }
        }
        out.extend(opens[i].iter().rev().map(|m| Inline::Open(*m)));
    }
    normalize(out)
}

/// 한 줄의 인라인 해석(줄을 넘지 않는다).
pub(crate) fn inline(s: &str) -> Vec<Inline> {
    inline_at(s, 0)
}

/// 같은 표시 안의 같은 표시 · 빈 짝 · 맞붙은 짝(`**a****b**`)을 걷고 글자를 잇는다 — Discord 가 `****` 를 읽지 못한다.
fn normalize(items: Vec<Inline>) -> Vec<Inline> {
    let mut depth = [0usize; 3];
    let mut out: Vec<Inline> = Vec::new();
    for it in items {
        match it {
            Inline::Open(m) => {
                depth[m.idx()] += 1;
                if depth[m.idx()] > 1 {
                    continue;
                }
                if matches!(out.last(), Some(Inline::Close(k)) if *k == m) {
                    out.pop();
                } else {
                    out.push(it);
                }
            }
            Inline::Close(m) => {
                let d = &mut depth[m.idx()];
                *d = d.saturating_sub(1);
                if *d > 0 {
                    continue;
                }
                if matches!(out.last(), Some(Inline::Open(k)) if *k == m) {
                    out.pop();
                } else {
                    out.push(it);
                }
            }
            Inline::Text(s) | Inline::Code(s) if s.is_empty() => {}
            Inline::Text(s) => match out.last_mut() {
                Some(Inline::Text(p)) => p.push_str(&s),
                _ => out.push(Inline::Text(s)),
            },
            code => out.push(code),
        }
    }
    out
}

fn plain_items(items: &[Inline]) -> String {
    items
        .iter()
        .filter_map(|i| match i {
            Inline::Text(s) | Inline::Code(s) => Some(s.as_str()),
            _ => None,
        })
        .collect()
}

impl Line {
    pub(crate) fn plain(s: impl Into<String>) -> Line {
        Line { quote: false, items: normalize(vec![Inline::Text(s.into())]) }
    }

    /// 코드 블록에서 온 줄 — 인라인 해석을 하지 않는다.
    pub(crate) fn code(s: impl Into<String>) -> Line {
        Line { quote: false, items: normalize(vec![Inline::Code(s.into())]) }
    }

    /// 보이는 글자 수.
    pub(crate) fn visible(&self) -> usize {
        self.items
            .iter()
            .map(|i| match i {
                Inline::Text(s) | Inline::Code(s) => s.chars().count(),
                _ => 0,
            })
            .sum()
    }

    pub(crate) fn text(&self) -> String {
        plain_items(&self.items)
    }

    /// 공백 줄기를 한 칸으로 · 앞뒤 공백을 뗀다(알림 발췌).
    pub(crate) fn squash(self) -> Line {
        let squeeze = |s: &str| {
            let mut o = String::with_capacity(s.len());
            let mut ws = false;
            for c in s.chars() {
                if c.is_whitespace() {
                    if !ws {
                        o.push(' ');
                    }
                    ws = true;
                } else {
                    o.push(c);
                    ws = false;
                }
            }
            o
        };
        let mut items: Vec<Inline> = self
            .items
            .into_iter()
            .map(|i| match i {
                Inline::Text(s) => Inline::Text(squeeze(&s)),
                Inline::Code(s) => Inline::Code(squeeze(&s)),
                m => m,
            })
            .collect();
        if let Some(Inline::Text(s) | Inline::Code(s)) = items.iter_mut().find(|i| matches!(i, Inline::Text(_) | Inline::Code(_))) {
            *s = s.trim_start().to_string();
        }
        if let Some(Inline::Text(s) | Inline::Code(s)) = items.iter_mut().rev().find(|i| matches!(i, Inline::Text(_) | Inline::Code(_))) {
            *s = s.trim_end().to_string();
        }
        Line { quote: self.quote, items: normalize(items) }
    }

    /// 보이는 글자 `max` 안으로 — 넘치면 `max - 1` 글자 + 열린 표시 닫기 + `…`.
    pub(crate) fn truncate(&self, max: usize) -> Line {
        if self.visible() <= max {
            return self.clone();
        }
        let budget = max.saturating_sub(1);
        let mut used = 0;
        let mut open: Vec<Mark> = Vec::new();
        let mut items = Vec::new();
        for it in &self.items {
            match it {
                Inline::Text(s) | Inline::Code(s) => {
                    let n = s.chars().count();
                    if used + n <= budget {
                        items.push(it.clone());
                        used += n;
                        continue;
                    }
                    let part: String = s.chars().take(budget - used).collect();
                    items.push(match it {
                        Inline::Code(_) => Inline::Code(part),
                        _ => Inline::Text(part),
                    });
                    break;
                }
                Inline::Open(m) => {
                    open.push(*m);
                    items.push(it.clone());
                }
                Inline::Close(_) => {
                    open.pop();
                    items.push(it.clone());
                }
            }
        }
        items.extend(open.into_iter().rev().map(Inline::Close));
        items.push(Inline::Text("…".into()));
        Line { quote: self.quote, items: normalize(items) }
    }

    pub(crate) fn mark_cut(&mut self) {
        if !self.text().ends_with('…') {
            self.items.push(Inline::Text("…".into()));
            self.items = normalize(std::mem::take(&mut self.items));
        }
    }
}

// ---------------------------------------------------------------------------
// 그리기 — Telegram HTML
// ---------------------------------------------------------------------------

fn tag(m: Mark, close: bool) -> &'static str {
    match (m, close) {
        (Mark::Bold, false) => "<b>",
        (Mark::Italic, false) => "<i>",
        (Mark::Strike, false) => "<s>",
        (Mark::Bold, true) => "</b>",
        (Mark::Italic, true) => "</i>",
        (Mark::Strike, true) => "</s>",
    }
}

/// `<b>` `<i>` `<s>` `<code>` 만. **`<code>` 는 `<b>` · `<i>` · `<s>` 안에 넣지 않는다**(Bot API 의 엔티티 중첩 규칙 — 굵게 등은
/// pre · code 를 품지 못한다) — 코드 앞에서 열린 표시를 닫고 글자가 다시 올 때 연다. 여는 태그는 글자가 올 때만 내므로 빈 쌍이 없다.
pub(crate) fn inline_html(items: &[Inline]) -> String {
    let esc = crate::telegram::escape_html;
    let mut out = String::new();
    let mut want: Vec<Mark> = Vec::new();
    let mut shown: Vec<Mark> = Vec::new();
    let close_to = |shown: &mut Vec<Mark>, out: &mut String, n: usize| {
        while shown.len() > n {
            if let Some(m) = shown.pop() {
                out.push_str(tag(m, true));
            }
        }
    };
    for it in items {
        match it {
            Inline::Text(s) => {
                let same = shown.iter().zip(&want).take_while(|(a, b)| a == b).count();
                close_to(&mut shown, &mut out, same);
                for m in &want[same..] {
                    out.push_str(tag(*m, false));
                    shown.push(*m);
                }
                out.push_str(&esc(s));
            }
            Inline::Code(s) => {
                close_to(&mut shown, &mut out, 0);
                out.push_str("<code>");
                out.push_str(&esc(s));
                out.push_str("</code>");
            }
            Inline::Open(m) => want.push(*m),
            Inline::Close(_) => {
                want.pop();
                let keep = shown.iter().zip(&want).take_while(|(a, b)| a == b).count();
                close_to(&mut shown, &mut out, keep);
            }
        }
    }
    close_to(&mut shown, &mut out, 0);
    out
}

/// 인용 줄 묶음 = `<blockquote>` 하나 · 코드 = `<pre>`(안에 태그 없음).
pub(crate) fn html(doc: &[Block]) -> String {
    let mut out = String::new();
    let mut quote = false;
    for (i, b) in doc.iter().enumerate() {
        let in_quote = matches!(b, Block::Line(l) if l.quote);
        if quote && !in_quote {
            out.push_str("</blockquote>");
        }
        if i > 0 {
            out.push('\n');
        }
        if in_quote && !quote {
            out.push_str("<blockquote>");
        }
        quote = in_quote;
        match b {
            Block::Line(l) => out.push_str(&inline_html(&l.items)),
            Block::Code { text, .. } => {
                out.push_str("<pre>");
                out.push_str(&crate::telegram::escape_html(text));
                out.push_str("</pre>");
            }
            Block::Blank => {}
        }
    }
    if quote {
        out.push_str("</blockquote>");
    }
    out
}

// ---------------------------------------------------------------------------
// 그리기 — Discord 마크다운
// ---------------------------------------------------------------------------

/// 앞에 `\` — 글자 그대로 그려지고 멘션(`<@…>`) · 가린 링크(`[..](..)`)가 서식으로 읽히지 않는다.
pub(crate) fn escape_discord(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        if super::DISCORD_MARKDOWN_CHARS.contains(&c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn marker(m: Mark) -> &'static str {
    match m {
        Mark::Bold => "**",
        Mark::Italic => "*",
        Mark::Strike => "~~",
    }
}

/// 안의 가장 긴 백틱 줄보다 하나 긴 백틱으로 감싼다(백틱으로 시작 · 끝나면 공백 한 칸).
fn code_span(s: &str) -> String {
    let mut longest = 0;
    let mut cur = 0;
    for c in s.chars() {
        cur = if c == '`' { cur + 1 } else { 0 };
        longest = longest.max(cur);
    }
    let ticks = "`".repeat(longest + 1);
    let pad = if s.starts_with('`') || s.ends_with('`') { " " } else { "" };
    format!("{ticks}{pad}{s}{pad}{ticks}")
}

/// 맞붙은 두 기호(닫기 → 열기 · 코드 → 코드)가 같은 글자면 폭 없는 공백을 끼운다 — `**a***b*` 를 Discord 가 잘못 읽는다.
pub(crate) fn inline_discord(items: &[Inline]) -> String {
    let mut out = String::new();
    let mut after_end = false;
    for it in items {
        let piece = match it {
            Inline::Text(s) => escape_discord(s),
            Inline::Code(s) => code_span(s),
            Inline::Open(m) | Inline::Close(m) => marker(*m).to_string(),
        };
        let starts_new = matches!(it, Inline::Open(_) | Inline::Code(_));
        if after_end && starts_new && out.chars().next_back().is_some_and(|c| piece.starts_with(c)) {
            out.push(ZWSP);
        }
        after_end = matches!(it, Inline::Close(_) | Inline::Code(_));
        out.push_str(&piece);
    }
    out
}

/// 코드 블록 안의 백틱 둘 사이마다 폭 없는 공백 — 안의 ``` 가 블록을 닫지 않는다.
fn discord_code(lang: &str, text: &str) -> String {
    let mut body = String::with_capacity(text.len() + 8);
    let mut prev_tick = false;
    for c in text.chars() {
        if c == '`' && prev_tick {
            body.push(ZWSP);
        }
        prev_tick = c == '`';
        body.push(c);
    }
    format!("```{lang}\n{body}\n```")
}

pub(crate) fn discord(doc: &[Block]) -> String {
    doc.iter()
        .map(|b| match b {
            Block::Line(l) if l.quote => format!("> {}", inline_discord(&l.items)),
            Block::Line(l) => inline_discord(&l.items),
            Block::Code { lang, text } => discord_code(lang, text),
            Block::Blank => String::new(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// 그리기 — 평문(기호를 걷은 보이는 글자)
// ---------------------------------------------------------------------------

pub(crate) fn plain(doc: &[Block]) -> String {
    doc.iter()
        .map(|b| match b {
            Block::Line(l) => l.text(),
            Block::Code { text, .. } => text.clone(),
            Block::Blank => String::new(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
pub(crate) mod tests;
