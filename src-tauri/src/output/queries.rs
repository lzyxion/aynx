//! 창 없는 동안 서버가 대신 답하는 **터미널 질의** — 해석([`scan_queries`] · 배치 경계를 잇는 [`next_carry`]) · 답 내용 표([`term_reply`]).
//! 순수 코드 — 슬롯 · 배처는 모른다(대답 손을 부르는 것은 부모 `output.rs` 의 배처 · 슬롯 잠금 밖). `output.rs` 에서 그대로 옮겼다.

/// 창 없는 동안 서버가 대신 답하는 터미널 질의 — TUI(Claude Code · Codex)가 시작할 때 보내고 답을 기다리는 것들.
///
/// kitty 그래픽 질의(`ESC _ G … a=q … ESC \`)는 **일부러 넣지 않는다**: kitty 규약은 지원 여부를 "질의 + DA1" 로 묻고
/// DA1 답이 먼저 오면 미지원으로 본다 — 지원하지 않는 터미널은 APC 를 그냥 버리는 것이 표준이고, 붙은 창의 xterm.js 도
/// 답하지 않는다. 오류로 답하면 "지원은 하는데 실패" 로 읽힐 수 있어 침묵이 안전하다(DA1 답이 기다림을 끝낸다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TermQuery {
    /// DSR 6 커서 위치 — `ESC[6n`.
    Dsr,
    /// **스트림 맨 앞**의 DSR 6(10-15) — ConPTY 가 시작하며 보내는 커서 상속 질의(`PSEUDOCONSOLE_INHERIT_CURSOR`). 아직 아무것도
    /// 그리지 않은 빈 화면이라 커서는 `1;1` 이다. 맨 아래 줄로 답하면 ConPTY 는 첫 줄을 맨 아래에 그린 것으로 알고, 줄이 넘칠 때 절대
    /// 위치(`ESC[<줄>;<칸>H`)로 다시 찍는다 — 빈 xterm 에 재생하면 그 글자가 엉뚱한 줄 끝에 남는다(작업자 타일 첫 줄 찌꺼기).
    DsrStart,
    /// DA1 — `ESC[c` · `ESC[0c`.
    Da1,
    /// DA2 — `ESC[>c` · `ESC[>0c`.
    Da2,
    /// XTVERSION — `ESC[>q` · `ESC[>0q`.
    XtVersion,
    /// DECRQM — `ESC[?Pn$p`(사설 모드) · `ESC[Pn$p`(ANSI 모드).
    Decrqm { private: bool, mode: u32 },
    /// OSC 10(전경) · 11(배경) 색 질의 — `ESC]10;?` + BEL 또는 ST. `st` = ST(`ESC \`)로 끝났나(답도 같은 끝맺음).
    Color { which: u8, st: bool },
}

/// 알아보는 질의의 최대 길이(바이트) — 배치 경계에 걸친 질의를 잇는 `carry` 의 크기를 정한다. 이보다 긴 시퀀스는 질의가 아니다.
const QUERY_MAX: usize = 24;

/// `bytes[i]`(ESC)에서 시작하는 질의 하나를 읽어 `(질의, 끝 위치)` 를 돌려준다. 질의가 아닌 시퀀스면 `(None, _)`,
/// 아직 덜 왔으면 `None`(다음 배치가 `carry` 로 잇는다).
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

/// `carry`(앞 배치의 끝 몇 바이트) + `batch` 에서 **새로 끝난** 질의들 — 배치 경계에 걸친 질의도 찾는다(`carry` 안에서 끝나는
/// 것은 이미 앞에서 답했으므로 뺀다). **순수 함수.**
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

/// 기본 전경 · 배경(OSC 10 · 11 답) — 기본 터미널 테마 `graphite-dark`(`src/lib/theme.ts`)의 값. 창이 붙으면 그 창의
/// 실제 테마로 xterm 이 답한다.
const DEFAULT_FG: &str = "rgb:d8d8/d8d8/dcdc";
const DEFAULT_BG: &str = "rgb:1111/1111/1313";

/// **답 내용 표 한 곳** — 질의 하나에 대한 답 바이트. `rows` = 지금 크기의 줄 수(DSR 답 — 맨 아래 줄).
/// DA1 · DA2 는 붙은 창의 xterm.js 와 같은 값(창이 있든 없든 같은 터미널로 보이게). DECRQM 은 0(모름 — 상태를 모른다).
/// XTVERSION 은 붙은 xterm.js 가 답하지 않는 질의지만, 창 없는 동안 기다림을 확실히 끝내려고 이름을 답한다.
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

/// 다음 배치의 `carry` — [`QUERY_MAX`] − 1 바이트(배치가 그보다 짧으면 앞 carry 를 이어 붙인 꼬리).
pub(crate) fn next_carry(carry: &[u8], batch: &[u8]) -> Vec<u8> {
    let keep = QUERY_MAX - 1;
    let mut joined = carry.to_vec();
    joined.extend_from_slice(batch);
    joined[joined.len().saturating_sub(keep)..].to_vec()
}

// 시험은 이 모듈 아래 — 상수([`QUERY_MAX`] · 기본 색)를 본다.
#[cfg(test)]
#[path = "tests/queries.rs"]
mod dsr_tests;
