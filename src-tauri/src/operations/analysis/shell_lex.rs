//! 셸 글 쪼개기 — 구획 · 낱말(원문 코드 포인트 자리)과 구획 밖 근거(리다이렉트 · 치환 · heredoc · 해석 실패). 거절하지 않고 끝까지 나눈다.

use super::types::{stronger, Computed, Verdict};

/// 구획의 낱말 하나 — 따옴표를 벗긴 글자와 원문 안의 자리(**코드 포인트** 색인 [start, end) — 따옴표 · 이스케이프 포함).
pub(super) struct Word {
    pub(super) text: String,
    pub(super) start: usize,
    pub(super) end: usize,
    /// 따옴표 · 이스케이프 · 치환 없이 적힌 그대로인가 — 효과 낱말(`-delete` …)은 이런 낱말에서만 찾는다(`'-delete'` 는 글자일 수 있다).
    pub(super) plain: bool,
}

/// 쪼갠 결과 — 구획(낱말들)과 구획 밖의 근거(리다이렉트 · 치환 · 해석 실패).
pub(super) struct Split {
    /// 구획 밖의 근거들(리다이렉트 · 치환 · heredoc · 해석 실패) — 차례대로, 같은 것은 한 번.
    pub(super) specials: Vec<Verdict>,
    pub(super) segments: Vec<Vec<Word>>,
    pub(super) extra: Verdict,
    /// 구획 밖 근거의 연산자 자리(`>` · `>>` · `&>` · `$(` · 백틱 · `<<` · `<(`) — 나올 때마다(같은 것도) · 코드 포인트 [start, end).
    /// `/dev/null` 로 가는 리다이렉트 · fd 복제(`2>&1`)는 없다. 해석 실패(`?`)는 자리가 없다.
    pub(super) ops: Vec<(usize, usize, Computed)>,
}

/// 구획 하나의 낱말 글자들 — [`segment`] 에 넘긴다.
pub(super) fn texts_of(seg: &[Word]) -> Vec<String> {
    seg.iter().map(|w| w.text.clone()).collect()
}

/// 셸 글을 구획(낱말들)으로 — 파이프 · `&&` · `||` · `;` · `&` · 줄바꿈 · `(` `)` 에서 나눈다. 거절하지 않는다(모듈 머리말).
/// 낱말마다 원문 자리를 함께 적는다 — 줄 안의 효과 낱말 표시([`line_marks`])가 같은 나눔을 그대로 쓴다(따로 훑지 않는다).
pub(super) fn split_shell(cmd: &str) -> Split {
    let chars: Vec<char> = cmd.chars().collect();
    let n = chars.len();
    let mut segments: Vec<Vec<Word>> = Vec::new();
    let mut words: Vec<Word> = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    // 지금 낱말의 첫 자리 · 적힌 그대로인가.
    let mut wstart = 0usize;
    let mut plain = true;
    let mut extra = Verdict::read();
    // 구획 밖의 근거를 **나온 차례대로** 하나씩(같은 것은 한 번) — 칩 줄이 `>` · `$()` 를 제 색으로 그린다.
    let mut specials: Vec<Verdict> = Vec::new();
    let mut ops: Vec<(usize, usize, Computed)> = Vec::new();
    // 본문을 아직 건너지 않은 heredoc 들(이 줄의 `<<` 차례대로) — 다음 줄바꿈에서 본문을 건넌다.
    let mut heredocs: Vec<Heredoc> = Vec::new();
    // here-string(`<<<`) 뒤 낱말을 구획에서 뺄 자리 — (그때의 구획 수 · 낱말 수).
    let mut herestr: Option<(usize, usize)> = None;
    let mut i = 0usize;

    fn end_word(cur: &mut String, in_word: &mut bool, words: &mut Vec<Word>, start: usize, end: usize, plain: &mut bool) {
        if *in_word {
            words.push(Word { text: std::mem::take(cur), start, end, plain: *plain });
            *in_word = false;
        }
        *plain = true;
    }
    fn end_seg(words: &mut Vec<Word>, segments: &mut Vec<Vec<Word>>) {
        if !words.is_empty() {
            segments.push(std::mem::take(words));
        }
    }

    while i < n {
        let c = chars[i];
        let i0 = i;
        let was = in_word;
        match c {
            '\'' => {
                in_word = true;
                plain = false;
                let mut j = i + 1;
                while j < n && chars[j] != '\'' {
                    cur.push(chars[j]);
                    j += 1;
                }
                if j >= n {
                    note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "?"));
                }
                i = j + 1;
            }
            '"' => {
                in_word = true;
                plain = false;
                let mut j = i + 1;
                let mut closed = false;
                while j < n {
                    let d = chars[j];
                    if d == '\\' && j + 1 < n && matches!(chars[j + 1], '"' | '\\' | '$' | '`') {
                        cur.push(chars[j + 1]);
                        j += 2;
                        continue;
                    }
                    if d == '"' {
                        closed = true;
                        break;
                    }
                    if d == '`' {
                        note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                        ops.push((j, j + 1, Computed::Unknown));
                    } else if d == '$' && chars.get(j + 1) == Some(&'(') {
                        note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                        ops.push((j, j + 2, Computed::Unknown));
                    }
                    cur.push(d);
                    j += 1;
                }
                if !closed {
                    note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "?"));
                }
                i = j + 1;
            }
            '\\' => {
                // 따옴표 밖 이스케이프 — 다음 글자는 글자다(`\;` 는 나누지 않는다). 줄 이음(`\` + 줄바꿈)은 지운다.
                if let Some(&d) = chars.get(i + 1) {
                    if d != '\n' {
                        cur.push(d);
                        in_word = true;
                        plain = false;
                    }
                }
                i += 2;
            }
            '`' => {
                note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                ops.push((i, i + 1, Computed::Unknown));
                cur.push(c);
                in_word = true;
                plain = false;
                i += 1;
            }
            '$' if chars.get(i + 1) == Some(&'(') => {
                note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                ops.push((i, i + 2, Computed::Unknown));
                cur.push(c);
                in_word = true;
                plain = false;
                i += 1;
            }
            '#' if !in_word => {
                // 줄 주석 — 줄 끝까지.
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
            }
            ' ' | '\t' => {
                end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                i += 1;
            }
            '\n' => {
                end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                end_seg(&mut words, &mut segments);
                if heredocs.is_empty() {
                    i += 1;
                } else {
                    // 이 줄의 heredoc 본문들 — 표준 입력으로 가는 **데이터**라 구획 · 낱말이 아니다. 차례대로 건너 마지막 구분 줄 끝으로.
                    let mut at = i + 1;
                    let mut last = i;
                    for h in heredocs.drain(..) {
                        match heredoc_end(&chars, at, &h.delim, h.dash) {
                            Some((body_end, line_end)) => {
                                // 따옴표 없는 구분 낱말이면 본문의 치환이 돈다 — 확인 필요(표시는 `<<` 에 — 본문은 칠하지 않는다).
                                if !h.quoted && has_substitution(&chars[at..body_end]) {
                                    note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                                    ops.push((h.op.0, h.op.1, Computed::Unknown));
                                }
                                last = line_end;
                                at = line_end + 1;
                            }
                            None => {
                                // 구분 줄이 없다 — 어디까지가 본문인지 모른다.
                                note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "<<"));
                                ops.push((h.op.0, h.op.1, Computed::Unknown));
                                last = n;
                                at = n + 1;
                            }
                        }
                    }
                    i = last;
                }
            }
            '\r' | ';' | '(' | ')' => {
                end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                end_seg(&mut words, &mut segments);
                i += 1;
            }
            '|' => {
                end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                end_seg(&mut words, &mut segments);
                i += if matches!(chars.get(i + 1), Some('|') | Some('&')) { 2 } else { 1 };
            }
            '&' => {
                if chars.get(i + 1) == Some(&'>') {
                    // `&>` · `&>>` — 표준 출력 + 오류를 파일로.
                    end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                    let mut j = i + 2;
                    if chars.get(j) == Some(&'>') {
                        j += 1;
                    }
                    let (target, next) = redirect_target(&chars, j);
                    if target != "/dev/null" {
                        note(&mut extra, &mut specials, Verdict::of(Computed::Write, ">"));
                        ops.push((i, j, Computed::Write));
                    }
                    i = next;
                    continue;
                }
                end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                end_seg(&mut words, &mut segments);
                i += if chars.get(i + 1) == Some(&'&') { 2 } else { 1 };
            }
            '>' => {
                // 앞 낱말이 숫자뿐이면 그것은 fd 번호다(`2>`) — 낱말에서 뺀다.
                if in_word && !cur.is_empty() && cur.chars().all(|d| d.is_ascii_digit()) {
                    cur.clear();
                    in_word = false;
                    plain = true;
                } else {
                    end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                }
                let mut j = i + 1;
                if matches!(chars.get(j), Some('>') | Some('|')) {
                    j += 1;
                }
                if chars.get(j) == Some(&'&') {
                    // fd 복제(`2>&1` · `>&-`) — 파일을 쓰지 않는다.
                    j += 1;
                    while j < n && (chars[j].is_ascii_digit() || chars[j] == '-') {
                        j += 1;
                    }
                    i = j;
                    continue;
                }
                let (target, next) = redirect_target(&chars, j);
                if target != "/dev/null" {
                    note(&mut extra, &mut specials, Verdict::of(Computed::Write, ">"));
                    ops.push((i, j, Computed::Write));
                }
                i = next;
            }
            '<' => {
                if in_word && !cur.is_empty() && cur.chars().all(|d| d.is_ascii_digit()) {
                    cur.clear();
                    in_word = false;
                    plain = true;
                } else {
                    end_word(&mut cur, &mut in_word, &mut words, wstart, i, &mut plain);
                }
                match chars.get(i + 1) {
                    // here-string `<<< 낱말` — 그 낱말은 표준 입력으로 가는 글(데이터)이다. 평소처럼 읽되(따옴표 안 `$(` 은 그대로
                    // 잡힌다) 구획 낱말에서는 뺀다(아래 `drop_herestring`).
                    Some('<') if chars.get(i + 2) == Some(&'<') => {
                        herestr = Some((segments.len(), words.len()));
                        i += 3;
                    }
                    // heredoc `<<` · `<<-` — 구분 낱말을 읽고 본문은 다음 줄바꿈에서 건넌다(데이터 — 받는 프로그램이 효과를 정한다:
                    // `cat` 읽기 · `tee` 쓰기 · `bash` · 표 밖은 확인 필요).
                    Some('<') => {
                        let dash = chars.get(i + 2) == Some(&'-');
                        let op_end = i + 2 + usize::from(dash);
                        let (delim, quoted, next) = heredoc_delim(&chars, op_end);
                        if delim.is_empty() {
                            note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "<<"));
                            ops.push((i, op_end, Computed::Unknown));
                        } else {
                            heredocs.push(Heredoc { delim, dash, quoted, op: (i, op_end) });
                        }
                        i = next;
                    }
                    // 프로세스 치환 `<(…)`.
                    Some('(') => {
                        note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "$()"));
                        ops.push((i, i + 2, Computed::Unknown));
                        i += 1;
                    }
                    _ => {
                        // 입력 리다이렉트 — 대상 낱말을 버린다.
                        let (_, next) = redirect_target(&chars, i + 1);
                        i = next;
                    }
                }
            }
            _ => {
                cur.push(c);
                in_word = true;
                i += 1;
            }
        }
        // 이 걸음에서 낱말이 시작됐으면 그 첫 자리.
        if !was && in_word {
            wstart = i0;
        }
        drop_herestring(&mut herestr, &mut words, segments.len());
    }
    end_word(&mut cur, &mut in_word, &mut words, wstart, n, &mut plain);
    drop_herestring(&mut herestr, &mut words, segments.len());
    end_seg(&mut words, &mut segments);
    // 본문이 오지 않은 heredoc(`<<` 줄이 마지막 줄) — 구분 줄이 없는 것과 같다.
    for h in heredocs {
        note(&mut extra, &mut specials, Verdict::of(Computed::Unknown, "<<"));
        ops.push((h.op.0, h.op.1, Computed::Unknown));
    }
    Split { segments, extra, specials, ops }
}

/// 본문을 기다리는 heredoc 하나.
struct Heredoc {
    delim: String,
    /// `<<-` — 구분 줄 앞의 탭을 허용한다
    dash: bool,
    /// 구분 낱말에 따옴표 · 이스케이프가 있었다 — 본문의 치환이 돌지 않는다
    quoted: bool,
    /// `<<` 연산자의 자리(코드 포인트 [start, end))
    op: (usize, usize),
}

/// here-string 뒤 낱말이 끝났으면 구획에서 뺀다 — 그사이 구획이 끝났으면(낱말 없이 `;`) 그냥 잊는다.
fn drop_herestring(herestr: &mut Option<(usize, usize)>, words: &mut Vec<Word>, segs: usize) {
    if let Some((s, len)) = *herestr {
        if segs != s {
            *herestr = None;
        } else if words.len() > len {
            words.truncate(len);
            *herestr = None;
        }
    }
}

/// heredoc 구분 낱말 — `<<` · `<<-` 바로 뒤(공백을 건너)에서 읽는다: (따옴표를 벗긴 낱말 · 따옴표 · 이스케이프가 있었나 · 다음 자리).
pub(super) fn heredoc_delim(chars: &[char], mut j: usize) -> (String, bool, usize) {
    let n = chars.len();
    while j < n && matches!(chars[j], ' ' | '\t') {
        j += 1;
    }
    let mut out = String::new();
    let mut quoted = false;
    while j < n {
        let c = chars[j];
        if matches!(c, ' ' | '\t' | '\n' | '\r' | ';' | '|' | '&' | '(' | ')' | '<' | '>') {
            break;
        }
        if c == '\'' || c == '"' {
            quoted = true;
            let mut k = j + 1;
            while k < n && chars[k] != c {
                out.push(chars[k]);
                k += 1;
            }
            j = k + 1;
            continue;
        }
        if c == '\\' {
            quoted = true;
            if let Some(&d) = chars.get(j + 1) {
                out.push(d);
            }
            j += 2;
            continue;
        }
        out.push(c);
        j += 1;
    }
    (out, quoted, j.min(n))
}

/// heredoc 본문의 끝 — `start`(본문 첫 글자)부터 줄마다 보아 구분 낱말과 같은 줄(`<<-` 면 앞 탭 허용 · 끝 `\r` 무시)을 찾는다.
/// (본문 끝 = 구분 줄의 첫 자리, 구분 줄의 끝 = 그 줄의 줄바꿈 자리 또는 글 끝). 못 찾으면 `None`.
pub(super) fn heredoc_end(chars: &[char], start: usize, delim: &str, dash: bool) -> Option<(usize, usize)> {
    let n = chars.len();
    let mut ls = start;
    while ls < n {
        let le = chars[ls..].iter().position(|&c| c == '\n').map_or(n, |p| ls + p);
        let mut a = ls;
        if dash {
            while a < le && chars[a] == '\t' {
                a += 1;
            }
        }
        let b = if le > a && chars[le - 1] == '\r' { le - 1 } else { le };
        if chars[a..b].iter().copied().eq(delim.chars()) {
            return Some((ls, le));
        }
        ls = le + 1;
    }
    None
}

/// 글에 치환(`$(` · 백틱)이 있는가 — 따옴표 없는 heredoc 본문에서는 돈다.
fn has_substitution(body: &[char]) -> bool {
    body.iter().enumerate().any(|(k, &c)| c == '`' || (c == '$' && body.get(k + 1) == Some(&'(')))
}

/// 구획 밖의 근거 하나를 적는다 — 가장 센 것(`extra`)과 차례 목록(`specials`) 둘 다.
fn note(extra: &mut Verdict, specials: &mut Vec<Verdict>, v: Verdict) {
    if !specials.iter().any(|x| x.cause == v.cause) {
        specials.push(v.clone());
    }
    *extra = stronger(extra.clone(), v);
}

/// 리다이렉트 대상 낱말 하나(공백을 건너 따옴표를 벗긴 글자)와 그다음 자리.
fn redirect_target(chars: &[char], mut j: usize) -> (String, usize) {
    while j < chars.len() && matches!(chars[j], ' ' | '\t') {
        j += 1;
    }
    let mut out = String::new();
    while j < chars.len() {
        let c = chars[j];
        if matches!(c, ' ' | '\t' | '\n' | '\r' | ';' | '|' | '&' | '(' | ')' | '<' | '>') {
            break;
        }
        if c == '\'' || c == '"' {
            let mut k = j + 1;
            while k < chars.len() && chars[k] != c {
                out.push(chars[k]);
                k += 1;
            }
            j = k + 1;
            continue;
        }
        out.push(c);
        j += 1;
    }
    (out, j)
}
