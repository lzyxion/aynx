//! **서버 해석기** — 세션 출력 바이트 → 화면 · 스크롤백 글자 · OSC 133 명령 구간. 잠금도 저장소도 모르는 순수 자료구조다.
//!
//! - **스크롤백은 `vt100` 에 맡기지 않는다**(용량 0) — 셀 단위로 쥐면 세션마다 수십 MB 다. 밀려난 줄을 글자로 바꿔 절대 줄 번호로 쥔다.
//! - 프런트와 **같은 의미**여야 한다: OSC 133 상태 기계 = `src/lib/shell-integration/osc133.ts` · 발췌 = `src/lib/block-history.ts` 의
//!   `makeExcerpt`(단위도 UTF-16 코드 유닛) · 줄 읽기 = `shell-integration/buffer-read.ts` 의 `readLineArray`.
//! - 프런트와 다를 수 있는 것(알고 받은 것): 크기를 바꿀 때 다시 흘리지 않는다(xterm 은 reflow) · 래핑된 줄 끝의 공백 · 화면 지우기 뒤의
//!   상태 띠 정리. 이 차이가 블록 · 종료 코드 · 명령문을 바꾸지 않는다.

use std::collections::VecDeque;
use std::num::NonZeroU16;

use crate::context::{CommandBlockMirror, LastCommand};

/// 프런트 타일의 기본 스크롤백(`DEFAULT_SCROLLBACK`)과 같다.
pub(crate) const SCROLLBACK_ROWS: usize = 5000;

/// 프런트 `pushContext` 의 `shell.tail(400)` 과 같다.
pub(crate) const TAIL_ROWS: usize = 400;

/// UTF-16 코드 유닛 — 넘치면 **뒤를 남긴다**(오류는 끝에 나온다). 블록 발췌의 머리+꼬리 합과 같다.
pub(crate) const LAST_OUTPUT_UNITS: usize = 64 * 1024;

/// 프런트 `BLOCK_CAPS` 와 같은 값.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Caps {
    pub head_lines: usize,
    pub tail_lines: usize,
    pub line_units: usize,
    pub head_units: usize,
    pub tail_units: usize,
}

pub(crate) const BLOCK_CAPS: Caps = Caps {
    head_lines: 20,
    tail_lines: 500,
    line_units: 4 * 1024,
    head_units: 16 * 1024,
    tail_units: 48 * 1024,
};

#[derive(Debug, Clone)]
struct Row {
    text: Box<str>,
    /// 다음 줄이 이 줄에 이어지는가.
    wrapped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tag {
    Aynx,
    Foreign,
}

/// 줄 번호는 모두 절대 번호다.
#[derive(Debug, Clone)]
struct Rec {
    prompt: u64,
    /// `B` 의 줄과 그 자리 왼쪽의 글자(프롬프트) — 명령문은 이 글자 뒤부터다.
    b: Option<(u64, String)>,
    cmd: Option<u64>,
    exit: Option<i64>,
    command_line: String,
    output: String,
}

#[derive(Debug, Clone)]
struct OpenBlock {
    command_line: String,
    cwd: Option<String>,
    started_at: i64,
}

/// 블록 번호는 0 — 저장소가 매긴다.
#[derive(Debug, Default)]
pub(crate) struct Fed {
    pub changed: bool,
    pub blocks: Vec<CommandBlockMirror>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Snapshot {
    pub status: Option<String>,
    pub last: Option<LastCommand>,
    pub tail: Vec<String>,
}

struct Hooks {
    rows: VecDeque<Row>,
    /// `rows[0]` 의 절대 줄 번호.
    base: u64,
    /// 주 화면 위로 밀려난 줄 수 = 화면 0번 줄의 절대 번호.
    scrolled: u64,
    cap: usize,
    source: Option<Tag>,
    cur: Option<Rec>,
    last_cmd: Option<Rec>,
    status: Option<&'static str>,
    cwd: Option<String>,
    open: Option<OpenBlock>,
    fed: Fed,
    caps: Caps,
}

impl Hooks {
    /// 스크롤백 먼저 — 크기를 키운 뒤 화면 위쪽 빈 줄과 겹치는 자리는 스크롤백이 진짜다.
    fn row_at(&self, screen: &vt100::Screen, visible: &mut Option<Vec<(String, bool)>>, y: u64) -> Option<(String, bool)> {
        if y < self.base {
            return None;
        }
        let in_store = y - self.base;
        if in_store < self.rows.len() as u64 {
            let r = &self.rows[in_store as usize];
            return Some((r.text.to_string(), r.wrapped));
        }
        let r = y.checked_sub(self.scrolled)? as usize;
        let rows = visible.get_or_insert_with(|| visible_rows(screen));
        rows.get(r).cloned()
    }

    /// 프런트 `buffer.active.length` 와 같은 뜻.
    fn end(&self, screen: &vt100::Screen) -> u64 {
        self.scrolled + u64::from(screen.size().0.get())
    }

    fn read_line_array(&self, screen: &vt100::Screen, start: u64, end: u64) -> Vec<String> {
        let mut visible = None;
        let to = end.min(self.end(screen));
        let rows: Vec<(String, bool)> = (start..to).filter_map(|y| self.row_at(screen, &mut visible, y)).collect();
        join_rows(rows)
    }

    fn read_lines(&self, screen: &vt100::Screen, start: u64, end: u64) -> String {
        self.read_line_array(screen, start, end).join("\n")
    }

    /// 프런트 `commandLineOf` 와 같다.
    fn command_line_of(&self, screen: &vt100::Screen, rec: &Rec) -> String {
        let end = rec.cmd.unwrap_or(rec.prompt + 1);
        match &rec.b {
            Some((b_row, prefix)) if *b_row < end && *b_row >= self.base => {
                let mut lines = self.read_line_array(screen, *b_row, end);
                if let Some(first) = lines.first_mut() {
                    *first = match first.strip_prefix(prefix.as_str()) {
                        Some(rest) => rest.to_string(),
                        None => first.chars().skip(prefix.chars().count()).collect(),
                    };
                }
                lines.join("\n")
            }
            _ => self.read_lines(screen, rec.prompt, end),
        }
    }

    fn cursor_row(&self, screen: &vt100::Screen) -> u64 {
        self.scrolled + u64::from(screen.cursor_position().0)
    }

    /// 프런트 `registerOsc133` 의 갈래 그대로.
    fn osc133(&mut self, screen: &vt100::Screen, data: &str) {
        let fields: Vec<&str> = data.split(';').collect();
        let kind = fields.first().copied().unwrap_or("");
        let tag = if fields.contains(&"aynx=1") { Tag::Aynx } else { Tag::Foreign };
        // 출처 고정 — 첫 `A` 가 정하고, 그 뒤로 다른 태그의 마커는 버린다(`A` 보다 먼저 온 조각은 받는다).
        if kind == "A" {
            match self.source {
                None => self.source = Some(tag),
                Some(t) if t != tag => return,
                _ => {}
            }
        } else if self.source.is_some_and(|t| t != tag) {
            return;
        }
        let row = self.cursor_row(screen);
        match kind {
            "A" => {
                // 같은 줄의 둘째 `A`(명령이 아직 시작되지 않은 직전 레코드)는 같은 프롬프트다.
                if self.cur.as_ref().is_some_and(|c| c.cmd.is_none() && c.prompt == row) {
                    return;
                }
                self.cur = Some(Rec {
                    prompt: row,
                    b: None,
                    cmd: None,
                    exit: None,
                    command_line: String::new(),
                    output: String::new(),
                });
            }
            "B" => {
                let (r, col) = screen.cursor_position();
                let prefix = screen.contents_between(r, 0, r, col);
                if let Some(c) = self.cur.as_mut() {
                    c.b = Some((row, prefix));
                }
            }
            "C" => {
                if let Some(mut c) = self.cur.take() {
                    c.cmd = Some(row);
                    c.command_line = self.command_line_of(screen, &c);
                    // 직전 블록이 아직 열려 있으면(`D` 를 못 봤다) 버린다 — 프런트도 그 블록을 거울로 올리지 않는다.
                    self.open = Some(OpenBlock {
                        command_line: c.command_line.clone(),
                        cwd: self.cwd.clone(),
                        started_at: now(),
                    });
                    self.last_cmd = Some(c.clone());
                    self.cur = Some(c);
                }
                self.set_status("running");
            }
            "D" => {
                let exit = parse_exit(fields.get(1).copied().unwrap_or(""));
                if let Some(mut c) = self.cur.take() {
                    c.exit = Some(exit);
                    // `C` 를 못 본 `D` — 그 자리에서 블록을 연다(명령문은 프롬프트 줄에서).
                    if c.cmd.is_none() {
                        self.open = Some(OpenBlock {
                            command_line: self.command_line_of(screen, &c),
                            cwd: self.cwd.clone(),
                            started_at: now(),
                        });
                    }
                    let from = c.cmd.unwrap_or(c.prompt);
                    let start = c.cmd.unwrap_or(c.prompt + 1);
                    // 스크롤백 밖으로 밀렸으면 못 읽는다 — "무출력" 과 가른다.
                    let captured = from >= self.base;
                    let lines = if captured { self.read_line_array(screen, start, row) } else { Vec::new() };
                    if let Some(open) = self.open.take() {
                        let ended = now();
                        let (head, tail, truncated, capture) = if captured {
                            make_excerpt(&lines, &self.caps)
                        } else {
                            (Vec::new(), Vec::new(), true, "unavailable")
                        };
                        self.fed.blocks.push(CommandBlockMirror {
                            id: 0,
                            command_line: open.command_line,
                            cwd: open.cwd,
                            started_at: open.started_at,
                            ended_at: Some(ended),
                            exit: Some(exit),
                            running: false,
                            excerpt_head: head,
                            excerpt_tail: tail,
                            truncated,
                            capture: capture.to_string(),
                        });
                    }
                    if c.cmd.is_some() {
                        c.output = keep_tail_units(&lines.join("\n"), LAST_OUTPUT_UNITS);
                        self.last_cmd = Some(c.clone());
                    }
                    self.cur = Some(c);
                }
                self.set_status(if exit == 0 { "ok" } else { "fail" });
            }
            _ => {}
        }
    }

    fn set_status(&mut self, s: &'static str) {
        self.status = Some(s);
        self.fed.changed = true;
    }

    /// `ED 3` — 그 줄에 걸린 마커는 이제 못 읽는다(xterm 이 마커를 버리는 것과 같다).
    fn clear_scrollback(&mut self) {
        self.rows.clear();
        self.base = self.scrolled.max(self.base);
    }
}

impl vt100::Callbacks for Hooks {
    fn unhandled_osc(&mut self, screen: &mut vt100::Screen, params: &[&[u8]]) {
        let Some((head, rest)) = params.split_first() else {
            return;
        };
        let data = rest.iter().map(|p| String::from_utf8_lossy(p)).collect::<Vec<_>>().join(";");
        match *head {
            b"133" => self.osc133(screen, &data),
            b"7" => {
                if let Some(cwd) = parse_osc7_cwd(&data) {
                    self.cwd = Some(cwd);
                }
            }
            b"9" => {
                if let Some(cwd) = parse_osc9_cwd(&data) {
                    self.cwd = Some(cwd);
                }
            }
            _ => {}
        }
    }

    fn on_scroll(&mut self, contents: vt100::capture::RowContents<'_>, alternate_screen: bool) {
        // 대체 화면(vim · TUI)의 줄은 스크롤백에 남지 않는다(xterm 과 같다).
        if alternate_screen {
            return;
        }
        // 크기를 키울 때 vt100 이 위에 끼운 빈 줄(밀려난 줄의 자리)이 다시 밀려난 것 — 진짜 글자는 이미 스크롤백에 있다.
        if self.scrolled < self.base + self.rows.len() as u64 {
            self.scrolled += 1;
            return;
        }
        let mut formatted = String::new();
        let mut state = vt100::capture::BasicFormattedCaptureState::new();
        let _ = contents.write_formatted_basic(&mut formatted, &mut state);
        let text: String = vt100::capture::basic_formatted_to_plain(&formatted).collect();
        // 래핑 여부는 같은 상태로 한 번 더 써 보면 안다 — 이어지지 않는 줄이면 첫 글자가 줄바꿈이다(첫 쓰기에서 멈춘다).
        let mut probe = FirstChar(None);
        let _ = contents.write_formatted_basic(&mut probe, &mut state);
        let wrapped = probe.0 != Some('\n');
        self.rows.push_back(Row {
            text: text.into_boxed_str(),
            wrapped,
        });
        self.scrolled += 1;
        while self.rows.len() > self.cap {
            self.rows.pop_front();
            self.base += 1;
        }
    }
}

struct FirstChar(Option<char>);

impl std::fmt::Write for FirstChar {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        if let Some(c) = s.chars().next() {
            self.0 = Some(c);
            return Err(std::fmt::Error);
        }
        Ok(())
    }
}

/// 프런트 `readLineArray` 와 같은 규칙. vt100 은 래핑을 넘어간 그 줄에 적는다(xterm 은 다음 줄의 `isWrapped`) — 뜻은 같다.
fn join_rows(rows: Vec<(String, bool)>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut prev_wrapped = false;
    for (text, wrapped) in rows {
        let text = if wrapped { text } else { text.trim_end().to_string() };
        match out.last_mut() {
            Some(last) if prev_wrapped => last.push_str(&text),
            _ => out.push(text),
        }
        prev_wrapped = wrapped;
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    out
}

fn visible_rows(screen: &vt100::Screen) -> Vec<(String, bool)> {
    let cols = screen.size().1.get();
    screen
        .rows(0, cols)
        .enumerate()
        .map(|(i, text)| {
            let wrapped = u16::try_from(i).is_ok_and(|r| screen.row_wrapped(r));
            (text, wrapped)
        })
        .collect()
}

fn now() -> i64 {
    crate::session_core::now_ms() as i64
}

/// 프런트와 같게 JS `parseInt(raw, 10)` 처럼 읽는다 — 빈 값 · 숫자 아님은 0.
pub(crate) fn parse_exit(raw: &str) -> i64 {
    let t = raw.trim_start();
    let (sign, digits) = match t.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, t.strip_prefix('+').unwrap_or(t)),
    };
    let n: String = digits.chars().take_while(char::is_ascii_digit).collect();
    n.parse::<i64>().map(|v| sign * v).unwrap_or(0)
}

/// 프런트 `parseOsc7Cwd` 와 같다.
pub(crate) fn parse_osc7_cwd(data: &str) -> Option<String> {
    let raw = data.trim();
    if !raw.to_ascii_lowercase().starts_with("file://") {
        return None;
    }
    let rest = &raw["file://".len()..];
    let slash = rest.find('/')?;
    let path = decode_percent(&rest[slash..]);
    let b = path.as_bytes();
    let stripped = if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        path[1..].to_string()
    } else {
        path
    };
    (!stripped.is_empty()).then_some(stripped)
}

/// 프런트 `parseOsc9Cwd` 와 같다.
pub(crate) fn parse_osc9_cwd(data: &str) -> Option<String> {
    let body = data.strip_prefix("9;")?.trim();
    if body.is_empty() {
        return None;
    }
    if body.to_ascii_lowercase().starts_with("file://") {
        return parse_osc7_cwd(body);
    }
    Some(body.to_string())
}

/// 망가진 이스케이프 · UTF-8 이 아니면 원문 그대로(`decodeURIComponent` 실패와 같게).
fn decode_percent(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = b.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
            match hex {
                Some(v) => {
                    out.push(v);
                    i += 3;
                    continue;
                }
                None => return s.to_string(),
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// 프런트 `String.length` 와 같은 단위.
fn units(s: &str) -> usize {
    s.encode_utf16().count()
}

fn units_of(lines: &[String]) -> usize {
    lines.iter().map(|l| units(l) + 1).sum()
}

fn clamp_units(s: &str, cap: usize) -> String {
    let mut n = 0;
    let mut out = String::new();
    for c in s.chars() {
        n += c.len_utf16();
        if n > cap {
            break;
        }
        out.push(c);
    }
    out
}

fn keep_tail_units(s: &str, cap: usize) -> String {
    if units(s) <= cap {
        return s.to_string();
    }
    let mut n = 0;
    let mut start = s.len();
    for (i, c) in s.char_indices().rev() {
        n += c.len_utf16();
        if n > cap {
            break;
        }
        start = i;
    }
    s[start..].to_string()
}

/// 프런트 `fitUnits` 와 같다.
fn fit_units(lines: &[String], cap: usize, keep_head: bool) -> (Vec<String>, bool) {
    if units_of(lines) <= cap {
        return (lines.to_vec(), false);
    }
    let mut out: Vec<String> = Vec::new();
    let mut n = 0;
    let order: Vec<&String> = if keep_head { lines.iter().collect() } else { lines.iter().rev().collect() };
    for line in order {
        let next = n + units(line) + 1;
        if !out.is_empty() && next > cap {
            break;
        }
        out.push(line.clone());
        n = next;
    }
    let dropped = out.len() < lines.len();
    if !keep_head {
        out.reverse();
    }
    (out, dropped)
}

/// 프런트 `makeExcerpt` 와 같다. 출력을 실제로 읽었을 때만 부른다.
pub(crate) fn make_excerpt(lines: &[String], caps: &Caps) -> (Vec<String>, Vec<String>, bool, &'static str) {
    let mut truncated = false;
    let clamped: Vec<String> = lines
        .iter()
        .map(|l| {
            if units(l) <= caps.line_units {
                l.clone()
            } else {
                truncated = true;
                clamp_units(l, caps.line_units)
            }
        })
        .collect();
    let head_count = caps.head_lines.min(clamped.len());
    let head = &clamped[..head_count];
    let tail_start = head_count.max(clamped.len().saturating_sub(caps.tail_lines));
    if tail_start > head_count {
        truncated = true;
    }
    let tail = &clamped[tail_start..];
    let (h, hd) = fit_units(head, caps.head_units, true);
    let (t, td) = fit_units(tail, caps.tail_units, false);
    if hd || td {
        truncated = true;
    }
    (h, t, truncated, if truncated { "partial" } else { "complete" })
}

/// 본문 글자이므로 `Debug` 없음 · 로그에 쓰지 않는다.
pub(crate) struct InputView {
    pub bracketed: bool,
    pub rows: Vec<Vec<(String, bool)>>,
}

pub(crate) struct Interp {
    parser: vt100::Parser<Hooks>,
    /// `ESC [ 3 J` 를 몇 바이트까지 맞췄나(배치 경계를 넘는다).
    ed3: u8,
}

const ED3: &[u8; 4] = b"\x1b[3J";

fn nz(v: u16) -> NonZeroU16 {
    NonZeroU16::new(v.max(1)).unwrap_or(NonZeroU16::MIN)
}

impl Interp {
    pub(crate) fn new(cols: u16, rows: u16) -> Interp {
        Interp::with_caps(cols, rows, SCROLLBACK_ROWS, BLOCK_CAPS)
    }

    pub(crate) fn with_caps(cols: u16, rows: u16, scrollback: usize, caps: Caps) -> Interp {
        let hooks = Hooks {
            rows: VecDeque::new(),
            base: 0,
            scrolled: 0,
            cap: scrollback,
            source: None,
            cur: None,
            last_cmd: None,
            status: None,
            cwd: None,
            open: None,
            fed: Fed::default(),
            caps,
        };
        Interp {
            parser: vt100::Parser::new_with_callbacks(nz(rows), nz(cols), 0, hooks),
            ed3: 0,
        }
    }

    /// `ESC [ 3 J` 는 앞 바이트를 먼저 먹인 뒤 그 자리에서 스크롤백을 버린다.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Fed {
        let mut start = 0;
        for (i, &b) in bytes.iter().enumerate() {
            let want = ED3[self.ed3 as usize];
            if b == want {
                self.ed3 += 1;
                if self.ed3 as usize == ED3.len() {
                    self.ed3 = 0;
                    self.parser.process(&bytes[start..=i]);
                    self.parser.callbacks_mut().clear_scrollback();
                    start = i + 1;
                }
            } else {
                self.ed3 = u8::from(b == ED3[0]);
            }
        }
        if start < bytes.len() {
            self.parser.process(&bytes[start..]);
        }
        std::mem::take(&mut self.parser.callbacks_mut().fed)
    }

    /// 키울 때 vt100 이 위에 빈 줄을 끼우면(밀려난 줄의 자리) 그만큼 화면의 절대 번호를 당긴다.
    pub(crate) fn resize(&mut self, cols: u16, rows: u16) {
        let (old_rows, old_cols) = self.parser.screen().size();
        if old_rows.get() == rows.max(1) && old_cols.get() == cols.max(1) {
            return;
        }
        let before = self.parser.screen().cursor_position().0;
        let alternate = self.parser.screen().alternate_screen();
        self.parser.set_size(nz(rows), nz(cols));
        if !alternate && rows > old_rows.get() {
            let after = self.parser.screen().cursor_position().0;
            let pulled = u64::from(after.saturating_sub(before));
            let h = self.parser.callbacks_mut();
            h.scrolled = h.scrolled.saturating_sub(pulled);
        }
    }

    pub(crate) fn snapshot(&self) -> Snapshot {
        let h = self.parser.callbacks();
        let screen = self.parser.screen();
        // 대체 화면(vim · tmux)이면 그 화면만 — 프런트 `tail` 이 읽는 `buffer.active` 가 대체 버퍼다(스크롤백이 없다).
        let tail = if screen.alternate_screen() {
            let rows = visible_rows(screen);
            let skip = rows.len().saturating_sub(TAIL_ROWS);
            join_rows(rows.into_iter().skip(skip).collect())
        } else {
            let end = h.end(screen);
            h.read_line_array(screen, end.saturating_sub(TAIL_ROWS as u64), end)
        };
        let last = h.last_cmd.as_ref().filter(|r| r.prompt >= h.base).map(|r| LastCommand {
            command_line: r.command_line.clone(),
            output: r.output.clone(),
            exit: r.exit,
            running: r.cmd.is_some() && r.exit.is_none(),
        });
        Snapshot {
            status: h.status.map(str::to_string),
            last,
            tail,
        }
    }

    /// 메신저 다리의 넣기 문지기가 보는 화면 — 줄마다 (글자, 흐린가) 덩어리.
    pub(crate) fn input_view(&self) -> InputView {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let mut out = Vec::with_capacity(usize::from(rows.get()));
        for r in 0..rows.get() {
            let mut runs: Vec<(String, bool)> = Vec::new();
            for c in 0..cols.get() {
                let Some(cell) = screen.cell(r, c) else { continue };
                if cell.is_wide_continuation() {
                    continue;
                }
                let text = if cell.has_contents() { cell.contents() } else { " " };
                let dim = cell.dim();
                match runs.last_mut() {
                    Some((t, d)) if *d == dim => t.push_str(text),
                    _ => runs.push((text.to_string(), dim)),
                }
            }
            out.push(runs);
        }
        InputView { bracketed: screen.bracketed_paste(), rows: out }
    }

    #[cfg(test)]
    pub(crate) fn scrollback_len(&self) -> usize {
        self.parser.callbacks().rows.len()
    }
}
