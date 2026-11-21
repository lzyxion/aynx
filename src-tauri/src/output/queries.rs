//! 창 없는 동안 서버가 대신 답하는 터미널 질의 — 해석 · 답 내용 표. 순수 코드(슬롯 · 배처는 모른다).

/// TUI(Claude Code · Codex)가 시작할 때 보내고 답을 기다리는 것들. kitty 그래픽 질의는 **일부러 넣지 않는다** — kitty 규약은 DA1 답이
/// 먼저 오면 미지원으로 보고 붙은 창의 xterm.js 도 답하지 않는다. 오류로 답하면 "지원은 하는데 실패" 로 읽힐 수 있어 침묵이 안전하다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TermQuery {
    Dsr,
    /// 스트림 맨 앞의 DSR 6 — ConPTY 의 커서 상속 질의(`PSEUDOCONSOLE_INHERIT_CURSOR`). 빈 화면이라 `1;1` 로 답한다 — 맨 아래 줄로 답하면
    /// ConPTY 가 줄이 넘칠 때 절대 위치로 다시 찍어, 빈 xterm 에 재생하면 그 글자가 엉뚱한 줄 끝에 남는다.
    DsrStart,
    Da1,
    Da2,
    XtVersion,
    Decrqm { private: bool, mode: u32 },
    /// `st` = ST(`ESC \`)로 끝났나(답도 같은 끝맺음).
    Color { which: u8, st: bool },
}

/// 배치 경계에 걸친 질의를 잇는 `carry` 의 크기를 정한다. 이보다 긴 시퀀스는 질의가 아니다.
const QUERY_MAX: usize = 24;

/// 질의가 아닌 시퀀스면 `(None, _)`, 아직 덜 왔으면 `None`(다음 배치가 `carry` 로 잇는다).
fn parse_query_at(bytes: &[u8], i: usize) -> Option<(Option<TermQuery>, usize)> {
    let limit = bytes.len().min(i + QUERY_MAX);
    match bytes.get(i + 1)? {
        b'[' => {
            let mut j = i + 2;
            while j < limit && (0x30..=0x3F).contains(&bytes[j]) {
                j += 1;
            }
            let params = &bytes[i + 2..j];
            let inter_start = j;
            while j < limit && (0x20..=0x2F).contains(&bytes[j]) {
                j += 1;
            }
            let inter = &bytes[inter_start..j];
            if j >= limit {
                // 끝 바이트가 아직 없다 — 너무 길어서면 질의가 아니고, 덜 와서면 다음 배치에서 다시 본다.
                return if j >= i + QUERY_MAX { Some((None, j)) } else { None };
            }
            let fin = bytes[j];
            if !(0x40..=0x7E).contains(&fin) {
                return Some((None, j));
            }
            let q = match (params, inter, fin) {
                (b"6", b"", b'n') => Some(TermQuery::Dsr),
                (b"" | b"0", b"", b'c') => Some(TermQuery::Da1),
                (b">" | b">0", b"", b'c') => Some(TermQuery::Da2),
                (b">" | b">0", b"", b'q') => Some(TermQuery::XtVersion),
                (p, b"$", b'p') => {
                    let (private, digits) = match p.strip_prefix(b"?") {
                        Some(rest) => (true, rest),
                        None => (false, p),
                    };
                    std::str::from_utf8(digits)
                        .ok()
                        .filter(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
                        .and_then(|d| d.parse().ok())
                        .map(|mode| TermQuery::Decrqm { private, mode })
                }
                _ => None,
            };
            Some((q, j + 1))
        }
        b']' => {
            // OSC 10/11 질의만 — `10;?` · `11;?` 뒤 BEL 또는 ST.
            let body = &bytes[i + 2..];
            let which = if body.starts_with(b"10;?") {
                10
            } else if body.starts_with(b"11;?") {
                11
            } else if body.len() < 4 && (b"10;?".starts_with(body) || b"11;?".starts_with(body)) {
                return None; // 덜 왔다
            } else {
                return Some((None, i + 1));
            };
            match &body[4..] {
                [0x07, ..] => Some((Some(TermQuery::Color { which, st: false }), i + 2 + 5)),
                [0x1b, b'\\', ..] => Some((Some(TermQuery::Color { which, st: true }), i + 2 + 6)),
                [] | [0x1b] => None, // 덜 왔다
                _ => Some((None, i + 1)),
            }
        }
        _ => Some((None, i + 1)),
    }
}

/// `carry` 안에서 끝나는 질의는 이미 앞에서 답했으므로 뺀다.
pub(crate) fn scan_queries(carry: &[u8], batch: &[u8]) -> Vec<TermQuery> {
    let mut joined = Vec::with_capacity(carry.len() + batch.len());
    joined.extend_from_slice(carry);
    joined.extend_from_slice(batch);
    (0..joined.len())
        .filter(|&i| joined[i] == 0x1b)
        .filter_map(|i| match parse_query_at(&joined, i) {
            Some((Some(q), end)) if end > carry.len() => Some(q),
            _ => None,
        })
        .collect()
}

/// 기본 터미널 테마 `graphite-dark`(`src/lib/theme.ts`)의 값. 창이 붙으면 그 창의 실제 테마로 xterm 이 답한다.
const DEFAULT_FG: &str = "rgb:d8d8/d8d8/dcdc";
const DEFAULT_BG: &str = "rgb:1111/1111/1313";

/// 답 내용 표 한 곳. DA1 · DA2 는 붙은 창의 xterm.js 와 같은 값(창이 있든 없든 같은 터미널로 보이게). XTVERSION 은 xterm.js 가 답하지
/// 않지만 창 없는 동안 기다림을 확실히 끝내려고 이름을 답한다.
pub(crate) fn term_reply(q: &TermQuery, rows: u16) -> Vec<u8> {
    match q {
        TermQuery::Dsr => format!("\x1b[{};1R", rows.max(1)).into_bytes(),
        TermQuery::DsrStart => b"\x1b[1;1R".to_vec(),
        TermQuery::Da1 => b"\x1b[?1;2c".to_vec(),
        TermQuery::Da2 => b"\x1b[>0;276;0c".to_vec(),
        TermQuery::XtVersion => format!("\x1bP>|Aynx({})\x1b\\", env!("CARGO_PKG_VERSION")).into_bytes(),
        TermQuery::Decrqm { private, mode } => format!("\x1b[{}{mode};0$y", if *private { "?" } else { "" }).into_bytes(),
        TermQuery::Color { which, st } => {
            let rgb = if *which == 10 { DEFAULT_FG } else { DEFAULT_BG };
            let end = if *st { "\x1b\\" } else { "\x07" };
            format!("\x1b]{which};{rgb}{end}").into_bytes()
        }
    }
}

pub(crate) fn next_carry(carry: &[u8], batch: &[u8]) -> Vec<u8> {
    let keep = QUERY_MAX - 1;
    let mut joined = carry.to_vec();
    joined.extend_from_slice(batch);
    joined[joined.len().saturating_sub(keep)..].to_vec()
}

#[cfg(test)]
#[path = "tests/queries.rs"]
mod dsr_tests;
