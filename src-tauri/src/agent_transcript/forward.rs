//! **전방 증분 읽기**(오케스트레이션 6단계 — 설계 docs/log/2026-10-14-orchestration-design.md C-6). 기록 보기의 거꾸로 읽기
//! ([`super::read_page_from`])는 그대로 두고, 같은 **줄 파서**([`super::LineEvents`] — 생각 제외 · Claude sidechain 제외)와 같은
//! 요약 · 발췌 함수로 **앞에서 뒤로** 읽는다. 부르는 곳은 오케스트레이션 하나(`crate::orchestration::progress` — 조정자 `read_worker` ·
//! 보드 최근 활동)이고, 읽는 파일은 그 Attempt 에 **고정된 대화 파일 하나**다(사용자 전체 색인이 아니다).
//!
//! 커서 = `{파일 세대(파일 식별 · 크기 · 수정 시각), 바이트 위치}`([`Cursor`] — 글자로 오가는 불투명 값).
//! - 끝의 **미완성 줄**(줄바꿈이 아직 없다 — CLI 가 쓰는 중)은 읽지 않고 다음 번으로 미룬다(위치는 그 줄의 시작).
//! - 결과가 늦게 붙는 도구 호출은 같은 호출 id 의 **갱신 항목**(`update: true`)으로 다시 낸다. 같은 쪽 안에서 만나면 한 항목에 붙인다.
//! - 파일이 **줄거나 교체되면**(식별이 다르다 · 크기가 커서보다 작다 · 수정 시각이 뒤로 갔다 · 커서 앞 바이트가 줄바꿈이 아니다)
//!   처음부터 다시 읽고 `reset` 을 세운다.
//!
//! 크기: 쪽마다 항목 [`ITEMS_MAX`] · 도구 입력/결과 각 [`FIELD_MAX_BYTES`] · 말 하나 [`TEXT_MAX_BYTES`] · 글자 합은 부르는 쪽이 주는
//! 예산(응답 64 KiB 에서 다른 칸을 뺀 것). 잘렸으면 칸마다 표시(`truncated` · `inputTruncated` · `outputTruncated`), 예산에서
//! 멈췄으면 `more`.
//!
//! **개인정보** — 본문은 사용자 · 에이전트의 글자다. 이 모듈의 자료형은 `Debug` 를 파생하지 않고(패닉 · 로그에 찍히지 않게) 로그 ·
//! 감사 · 영속 파일에 싣지 않는다(모듈 머리말 — 나가는 곳은 화면과 오케스트레이션 조정자뿐).

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::{tool_input_text, tool_summary, Ev, LineEvents, Speaker};
use crate::agent_sessions::ms_of;

/// 한 쪽의 최대 항목 수(설계 C-6 — 조정자에게 주는 양).
pub(crate) const ITEMS_MAX: usize = 50;
/// 도구 입력 · 결과 발췌의 최대 바이트(각각).
pub(crate) const FIELD_MAX_BYTES: usize = 1024;
/// 말(사용자 · 에이전트) 하나의 최대 바이트.
pub(crate) const TEXT_MAX_BYTES: usize = 4096;
/// 한 줄의 상한 — 넘는 줄(거대한 도구 결과 등)은 건너뛴다(메모리를 지킨다).
const LINE_MAX_BYTES: u64 = 16 * 1024 * 1024;
/// 한 번의 호출이 훑는 최대 바이트 — 넘으면 `more` 로 멈춘다.
const SCAN_MAX_BYTES: u64 = 32 * 1024 * 1024;
/// 항목 하나의 겉 무게(키 이름 · 따옴표 등 — 예산 계산의 대강).
const ITEM_OVERHEAD: usize = 96;

/// `n` 바이트 안에서 글자 경계로 자른다 — (자른 글, 잘렸나).
pub(crate) fn cap_bytes(s: &str, n: usize) -> (String, bool) {
    if s.len() <= n {
        return (s.to_owned(), false);
    }
    let mut end = n;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_owned(), true)
}

// ---------------------------------------------------------------------------
// 커서 — 파일 세대 + 바이트 위치
// ---------------------------------------------------------------------------

/// 파일 세대 — 식별(Windows = 볼륨 일련번호 + 파일 인덱스 · 유닉스 = 장치 + inode · 못 읽으면 빈 글자) · 크기 · 수정 시각(ms).
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct FileGen {
    pub id: String,
    pub size: u64,
    pub mtime_ms: i64,
}

/// 전방 커서 — 그 세대에서 다음에 읽을 바이트(늘 줄의 시작)와, 그 줄에서 **이미 낸 사건 수**(`skip` — 리뷰 F8: 한 줄이 항목 50 · 응답
/// 64 KiB 보다 크면 그 줄을 사건 단위로 나누어 낸다. 0 이면 줄의 처음부터).
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Cursor {
    pub gen: FileGen,
    pub pos: u64,
    pub skip: u32,
}

impl Cursor {
    /// 글자로 — `t1.<식별>.<크기>.<수정 시각>.<위치>`(줄 안 자리가 0), 줄 안이면 `t2.<…>.<위치>.<줄 안 사건 수>`(조정자에게는 불투명 값).
    pub(crate) fn encode(&self) -> String {
        if self.skip == 0 {
            format!("t1.{}.{}.{}.{}", self.gen.id, self.gen.size, self.gen.mtime_ms, self.pos)
        } else {
            format!("t2.{}.{}.{}.{}.{}", self.gen.id, self.gen.size, self.gen.mtime_ms, self.pos, self.skip)
        }
    }

    /// [`Cursor::encode`] 의 거꾸로 — 모양이 틀리면 `None`.
    pub(crate) fn decode(s: &str) -> Option<Cursor> {
        let mut it = s.split('.');
        let two = match it.next()? {
            "t1" => false,
            "t2" => true,
            _ => return None,
        };
        let id = it.next()?;
        if id.len() > 64 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
            return None;
        }
        let size = it.next()?.parse::<u64>().ok()?;
        let mtime_ms = it.next()?.parse::<i64>().ok()?;
        let pos = it.next()?.parse::<u64>().ok()?;
        let skip = if two {
            let k = it.next()?.parse::<u32>().ok()?;
            if k == 0 {
                return None;
            }
            k
        } else {
            0
        };
        if it.next().is_some() || pos > size {
            return None;
        }
        Some(Cursor {
            gen: FileGen {
                id: id.to_owned(),
                size,
                mtime_ms,
            },
            pos,
            skip,
        })
    }
}

/// 이 파일 손잡이의 식별 — **OS 를 타는 곳은 이 함수 하나**(CLAUDE.md — 몸통만 `cfg` 로 가른다).
#[cfg(windows)]
fn file_identity(f: &File) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    // SAFETY: 살아 있는 `File` 의 손잡이와 이 함수 안의 구조체 하나를 넘긴다 — 함수는 그 구조체만 채운다.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) };
    (ok != 0).then(|| format!("{:08x}-{:08x}{:08x}", info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow))
}

#[cfg(unix)]
fn file_identity(f: &File) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let m = f.metadata().ok()?;
    Some(format!("{:x}-{:x}", m.dev(), m.ino()))
}

/// 아직 구현하지 않은 OS — 식별 없음(크기 · 수정 시각 · 줄바꿈 검사만으로 세대를 가린다).
#[cfg(not(any(windows, unix)))]
fn file_identity(_f: &File) -> Option<String> {
    None
}

/// 열린 파일의 지금 세대.
pub(crate) fn file_gen(f: &File) -> std::io::Result<FileGen> {
    let m = f.metadata()?;
    let mtime_ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Ok(FileGen {
        id: file_identity(f).unwrap_or_default(),
        size: m.len(),
        mtime_ms,
    })
}

/// 커서를 지금 파일에 대 본다 — (읽기 시작 위치, `reset`). 처음(커서 없음)이면 0 · `reset` 아님. 파일이 교체됐거나(식별이 다르다)
/// 줄었거나(크기 · 위치가 지금보다 크다) 수정 시각이 뒤로 갔거나 커서 앞 바이트가 줄바꿈이 아니면 0 · `reset`. **순수 함수** —
/// 앞 바이트는 부르는 쪽이 읽어 준다.
pub(crate) fn resume_at(cur: Option<&Cursor>, now: &FileGen, byte_before: impl FnOnce(u64) -> Option<u8>) -> (u64, bool) {
    let Some(c) = cur else { return (0, false) };
    let replaced = !c.gen.id.is_empty() && !now.id.is_empty() && c.gen.id != now.id;
    let shrunk = now.size < c.gen.size || c.pos > now.size;
    let rewound = now.mtime_ms < c.gen.mtime_ms;
    if replaced || shrunk || rewound {
        return (0, true);
    }
    if c.pos > 0 && byte_before(c.pos) != Some(b'\n') {
        return (0, true);
    }
    (c.pos, false)
}

// ---------------------------------------------------------------------------
// 항목 — 조정자 · 보드가 받는 모양
// ---------------------------------------------------------------------------

/// 도구 호출 하나(camelCase). **`Debug` 없음**.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FwdTool {
    /// 호출 id — 늦게 붙는 결과(갱신 항목)를 이 id 로 맞춘다. 결과 줄이 없는 도구(웹 검색)는 빈 글자.
    pub id: String,
    /// 도구 이름 — 갱신 항목에서 같은 쪽에 호출이 없었으면 빈 글자.
    pub name: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub input_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub output_truncated: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub error: bool,
    /// 이 쪽 끝까지 결과가 없었다 — 나중에 같은 id 의 갱신 항목으로 온다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
}

/// 항목 하나(camelCase). `role` — `user` · `assistant` · `tool`. **`Debug` 없음**.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FwdItem {
    pub role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub images: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<FwdTool>,
    pub at: Option<i64>,
    /// 앞 쪽에서 이미 낸 도구 호출의 **갱신**(결과가 늦게 붙었다) — 같은 `tool.id`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub update: bool,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// 한 쪽. **`Debug` 없음**.
pub(crate) struct FwdPage {
    pub items: Vec<FwdItem>,
    /// 다음에 읽을 바이트(줄의 시작).
    pub next: u64,
    /// `next` 줄에서 이미 낸 사건 수(0 = 줄의 처음 — 리뷰 F8).
    pub next_skip: u32,
    /// 예산 · 훑기 상한에서 멈췄다 — 지금 더 읽을 것이 있다.
    pub more: bool,
    /// 끝에 쓰는 중인(줄바꿈 없는) 줄이 있어 미뤘다.
    pub partial: bool,
}

/// 예산 — 항목 수 · 글자 합(바이트, 대강).
#[derive(Clone, Copy)]
pub(crate) struct Budget {
    pub items: usize,
    pub bytes: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Budget {
            items: ITEMS_MAX,
            bytes: 56 * 1024,
        }
    }
}

fn text_item(who: Speaker, text: &str, images: u32, at: Option<i64>) -> FwdItem {
    let (text, truncated) = cap_bytes(text, TEXT_MAX_BYTES);
    FwdItem {
        role: if who == Speaker::User { "user" } else { "assistant" },
        text: Some(text),
        truncated,
        images,
        tool: None,
        at,
        update: false,
    }
}

fn tool_item(id: &str, name: &str, input: &Value, at: Option<i64>) -> FwdItem {
    let (input_text, input_truncated) = cap_bytes(&tool_input_text(input), FIELD_MAX_BYTES);
    FwdItem {
        role: "tool",
        text: None,
        truncated: false,
        images: 0,
        tool: Some(FwdTool {
            id: id.to_owned(),
            name: name.to_owned(),
            summary: tool_summary(input),
            input: (!input_text.trim().is_empty()).then_some(input_text),
            input_truncated,
            output: None,
            output_truncated: false,
            error: false,
            // 결과 줄이 없는 도구(빈 id — 웹 검색)는 기다리지 않는다.
            pending: !id.is_empty(),
        }),
        at,
        update: false,
    }
}

fn weight(i: &FwdItem) -> usize {
    let t = i.tool.as_ref().map_or(0, |t| {
        t.id.len() + t.name.len() + t.summary.len() + t.input.as_ref().map_or(0, String::len) + t.output.as_ref().map_or(0, String::len)
    });
    // JSON 이스케이프(따옴표 · 줄바꿈 · 비 ASCII 그대로)로 조금 는다 — 대강 1/8 을 더 친다.
    let body = i.text.as_ref().map_or(0, String::len) + t;
    ITEM_OVERHEAD + body + body / 8
}

/// 한 줄 읽기의 결과.
enum Line {
    /// 끝(더 읽을 바이트 없음).
    Eof,
    /// 줄바꿈으로 끝난 줄 — 먹은 바이트 수(줄바꿈 포함).
    Complete(u64),
    /// 줄바꿈 없이 끝에 닿았다 — 쓰는 중인 줄(위치를 옮기지 않는다).
    Partial,
    /// 상한을 넘는 줄 — 건너뛰었다(먹은 바이트 수).
    TooLong(u64),
}

fn next_line<R: BufRead>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<Line> {
    buf.clear();
    let n = r.by_ref().take(LINE_MAX_BYTES + 1).read_until(b'\n', buf)? as u64;
    if n == 0 {
        return Ok(Line::Eof);
    }
    if buf.last() == Some(&b'\n') {
        return Ok(Line::Complete(n));
    }
    if n <= LINE_MAX_BYTES {
        return Ok(Line::Partial);
    }
    // 너무 긴 줄 — 줄바꿈까지 버린다(끝까지 줄바꿈이 없으면 쓰는 중인 줄로 미룬다).
    let mut eaten = n;
    let mut sink = Vec::new();
    loop {
        sink.clear();
        let k = r.by_ref().take(1024 * 1024).read_until(b'\n', &mut sink)? as u64;
        if k == 0 {
            return Ok(Line::Partial);
        }
        eaten += k;
        if sink.last() == Some(&b'\n') {
            return Ok(Line::TooLong(eaten));
        }
    }
}

/// `[start, size)` 를 앞에서 뒤로 — 한 쪽(줄의 처음부터). [`read_forward_from_at`] 의 `skip = 0`.
#[cfg_attr(not(test), allow(dead_code))] // 시험의 합성 표본.
pub(crate) fn read_forward_from<R: Read + Seek>(
    f: R,
    size: u64,
    start: u64,
    parse: LineEvents,
    budget: Budget,
) -> std::io::Result<FwdPage> {
    read_forward_from_at(f, size, start, 0, parse, budget)
}

/// 사건 하나를 쪽에 싣는다 — (더한 무게, 새 항목 수). `calls` 는 이 쪽의 도구 호출 id → 항목 번호(같은 쪽 안의 결과는 그 항목에 붙인다).
fn apply_event(page: &mut FwdPage, calls: &mut HashMap<String, usize>, e: &Ev, at: Option<i64>, dry: bool) -> (usize, usize) {
    match e {
        Ev::Text { who, text, images } => {
            let it = text_item(*who, text, *images, at);
            let w = weight(&it);
            if !dry {
                page.items.push(it);
            }
            (w, 1)
        }
        Ev::ToolUse { id, name, input } => {
            let it = tool_item(id, name, input, at);
            let w = weight(&it);
            if !dry {
                if !id.is_empty() {
                    calls.insert(id.clone(), page.items.len());
                }
                page.items.push(it);
            }
            (w, 1)
        }
        // 끊김 · 거절 표지는 기록 보기 화면의 것 — 조정자의 판독(`read_worker`)에는 싣지 않는다(지금 모양 그대로).
        Ev::Interrupted | Ev::Declined => (0, 0),
        Ev::ToolResult { id, output, error, .. } => {
            let (out, cut) = cap_bytes(output, FIELD_MAX_BYTES);
            let earlier = calls
                .get(id)
                .copied()
                .filter(|k| !id.is_empty() && page.items[*k].tool.as_ref().is_some_and(|t| t.output.is_none()));
            if let Some(k) = earlier {
                let w = out.len() + out.len() / 8;
                if !dry {
                    if let Some(t) = page.items[k].tool.as_mut() {
                        t.output = Some(out);
                        t.output_truncated = cut;
                        t.error = *error;
                        t.pending = false;
                    }
                }
                return (w, 0);
            }
            // 앞 쪽에서 낸 호출의 갱신 — 같은 id 로 다시 낸다.
            let it = FwdItem {
                role: "tool",
                text: None,
                truncated: false,
                images: 0,
                tool: Some(FwdTool {
                    id: id.clone(),
                    name: String::new(),
                    summary: String::new(),
                    input: None,
                    input_truncated: false,
                    output: Some(out),
                    output_truncated: cut,
                    error: *error,
                    pending: false,
                }),
                at,
                update: true,
            };
            let w = weight(&it);
            if !dry {
                page.items.push(it);
            }
            (w, 1)
        }
    }
}

/// `[start, size)` 를 앞에서 뒤로 — 한 쪽(몸통 — 시험은 임의의 `Read + Seek` 를 넘긴다). `size` 는 이번에 본 파일 크기이고 그 뒤에
/// 덧붙은 바이트는 읽지 않는다(다음 번 몫). `skip` 은 `start` 줄에서 이미 낸 사건 수.
///
/// **사건 단위로 싣는다**(리뷰 F8) — 한 줄(JSONL 레코드 하나)에 사건이 많거나 커도 항목 수 · 글자 예산을 넘기 직전에 멈추고, 커서를
/// 그 줄 안의 자리(`next` = 그 줄 · `next_skip` = 낸 사건 수)로 둔다. 쪽이 비어 있을 때의 첫 사건은 예산보다 커도 싣는다(칸마다 이미
/// 잘렸다 — 말 4 KiB · 도구 입력/결과 각 1 KiB) — 그래서 **커서는 늘 앞으로 간다**.
pub(crate) fn read_forward_from_at<R: Read + Seek>(
    mut f: R,
    size: u64,
    start: u64,
    skip: u32,
    parse: LineEvents,
    budget: Budget,
) -> std::io::Result<FwdPage> {
    let mut page = FwdPage {
        items: Vec::new(),
        next: start,
        next_skip: 0,
        more: false,
        partial: false,
    };
    if start >= size {
        return Ok(page);
    }
    f.seek(SeekFrom::Start(start))?;
    let mut r = BufReader::with_capacity(64 * 1024, f.take(size - start));
    let mut buf: Vec<u8> = Vec::new();
    let mut pos = start;
    let mut first_skip = skip as usize;
    let mut bytes = 0usize;
    let mut calls: HashMap<String, usize> = HashMap::new();
    loop {
        if pos - start > SCAN_MAX_BYTES && !page.items.is_empty() {
            page.more = true;
            break;
        }
        let n = match next_line(&mut r, &mut buf)? {
            Line::Eof => break,
            Line::Partial => {
                page.partial = true;
                break;
            }
            Line::TooLong(n) => {
                pos += n;
                first_skip = 0;
                continue;
            }
            Line::Complete(n) => n,
        };
        let begin = std::mem::take(&mut first_skip);
        let raw = &buf[..buf.len() - 1];
        if raw.iter().all(u8::is_ascii_whitespace) {
            pos += n;
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(raw) else {
            pos += n;
            continue;
        };
        let evs = parse(&v);
        let total = evs.len();
        let at = ms_of(&v["timestamp"]);
        // 이 줄에서 어디까지 실었나(`None` = 끝까지).
        let mut stop_at: Option<usize> = None;
        for (k, e) in evs.into_iter().enumerate().skip(begin) {
            let (add, new_items) = apply_event(&mut page, &mut calls, &e, at, true);
            let over = page.items.len() + new_items > budget.items || bytes + add > budget.bytes;
            if over && !page.items.is_empty() {
                stop_at = Some(k);
                break;
            }
            apply_event(&mut page, &mut calls, &e, at, false);
            bytes += add;
            if over {
                // 빈 쪽의 첫 사건이 예산보다 컸다 — 싣고 멈춘다.
                stop_at = Some(k + 1);
                break;
            }
        }
        match stop_at {
            Some(k) if k < total => {
                page.more = true;
                page.next = pos;
                page.next_skip = k as u32;
                return Ok(page);
            }
            Some(_) => {
                pos += n;
                page.more = true;
                break;
            }
            None => pos += n,
        }
    }
    page.next = pos;
    page.next_skip = 0;
    Ok(page)
}

/// 파일 하나를 커서에서 앞으로 — (쪽, 새 커서, `reset`). 열어서 [`read_forward_file`].
#[cfg_attr(not(test), allow(dead_code))] // 시험이 경로로 부른다 — 오케스트레이션은 검증한 손잡이를 넘긴다(`read_forward_file`).
pub(crate) fn read_forward(
    path: &Path,
    cur: Option<&Cursor>,
    parse: LineEvents,
    budget: Budget,
) -> std::io::Result<(FwdPage, Cursor, bool)> {
    read_forward_file(File::open(path)?, cur, parse, budget)
}

/// **열린 파일 손잡이**를 커서에서 앞으로 — (쪽, 새 커서, `reset`). 손잡이는 부르는 쪽이 고정 · 검증한 것(`orchestration::progress` —
/// 검증한 그 손잡이로 읽는다, 리뷰 F7).
pub(crate) fn read_forward_file(
    mut f: File,
    cur: Option<&Cursor>,
    parse: LineEvents,
    budget: Budget,
) -> std::io::Result<(FwdPage, Cursor, bool)> {
    let gen = file_gen(&f)?;
    let (start, reset) = resume_at(cur, &gen, |p| {
        let mut one = [0u8; 1];
        f.seek(SeekFrom::Start(p - 1)).ok()?;
        f.read_exact(&mut one).ok()?;
        Some(one[0])
    });
    let skip = match cur {
        Some(c) if !reset && start == c.pos => c.skip,
        _ => 0,
    };
    let page = read_forward_from_at(&mut f, gen.size, start, skip, parse, budget)?;
    let next = Cursor {
        gen: gen.clone(),
        pos: page.next,
        skip: page.next_skip,
    };
    Ok((page, next, reset))
}

// ---------------------------------------------------------------------------
// 보드의 최근 활동 — 끝에서 거꾸로 한 쪽(기록 보기와 같은 리더)
// ---------------------------------------------------------------------------

/// 최근 활동 — 마지막 에이전트 말 한 줄 · 최근 도구 호출(이름 · 짧은 요약). **`Debug` 없음**.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Recent {
    pub last_text: Option<String>,
    /// 오래된 것부터 — 최대 셋.
    pub tools: Vec<RecentTool>,
    pub last_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentTool {
    pub name: String,
    pub summary: String,
    pub pending: bool,
}

/// 한 줄 글자의 상한(보드).
const RECENT_LINE_MAX: usize = 160;
const RECENT_SUMMARY_MAX: usize = 80;

fn one_line(s: &str, n: usize) -> String {
    let line = s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let joined = line.split_whitespace().collect::<Vec<_>>().join(" ");
    match super::cap(&joined, n) {
        (t, true) => format!("{}…", t.trim_end()),
        (t, false) => t,
    }
}

/// 고정 파일의 최근 활동 — 끝에서 거꾸로 한 쪽(기록 보기와 같은 리더 · 같은 짝 맞추기). 손잡이는 부르는 쪽이 검증한 것(리뷰 F7).
pub(crate) fn recent(f: File, parse: LineEvents) -> Result<Recent, String> {
    let page = super::page_of_file(f, None, Some(30), parse)?;
    let mut out = Recent {
        last_at: page.items.iter().rev().find_map(|i| i.at),
        ..Default::default()
    };
    out.last_text = page
        .items
        .iter()
        .rev()
        .find(|i| i.role == "assistant")
        .and_then(|i| i.text.as_deref())
        .map(|t| one_line(t, RECENT_LINE_MAX))
        .filter(|t| !t.is_empty());
    let mut tools: Vec<RecentTool> = page
        .items
        .iter()
        .rev()
        .filter_map(|i| i.tool.as_ref())
        .filter(|t| !t.name.is_empty())
        .take(3)
        .map(|t| RecentTool {
            name: t.name.clone(),
            summary: one_line(&t.summary, RECENT_SUMMARY_MAX),
            pending: t.output.is_none(),
        })
        .collect();
    tools.reverse();
    out.tools = tools;
    Ok(out)
}
