//! 사이드 채팅의 CLI 무관 사건 꼴 · 어댑터가 함께 쓰는 작은 재료. 순수.
//!
//! 사건은 serde 꼬리표 `t` · camelCase 로 프런트까지 그대로 간다 — [`Ev`] 갈래는 프런트 `EV_TAGS` 와 같아야 한다(`side-chat-api.test.ts` 가 대조).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

/// 사람이 보낸 글 — `Debug` 는 길이만(로그 · `Debug` 에 본문을 남기지 않는다).
#[derive(Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct Said(pub(crate) String);

impl std::fmt::Debug for Said {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Said(<{} bytes>)", self.0.len())
    }
}

/// 바이트.
pub(crate) const DETAIL_MAX: usize = 16 * 1024;
/// 글자.
pub(crate) const SUMMARY_MAX: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Cli {
    Claude,
    Codex,
}

/// 갈라 오기의 원본은 Rust 가 색인에서 찾은 대화 id 다 — 경로는 프런트에서 받지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode<'a> {
    Fresh,
    Resume { conv: &'a str },
    Fork { from: &'a str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PermKind {
    Tool,
    /// Codex 명령 실행(샌드박스 밖 — 권한 상승 요청).
    Command,
    FileChange,
    /// 외부 MCP 서버의 도구 하나 — 늘 묻는다(묻지 않기는 사이드 채팅의 모드 · 허용 목록으로 서버가 정한다).
    McpTool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResolvedBy {
    Human,
    Cli,
    Closed,
    /// 사람이 그 채팅에 정한 모드가 Auto 라 세션 서버가 허용으로 답했다.
    Auto,
    /// 사람이 그 채팅에서 허용한 종류(허용 목록)라 세션 서버가 허용으로 답했다.
    Remembered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Outcome {
    Ok,
    /// 사람이 끊었다 — 실패가 아니다.
    Interrupted,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum Ev {
    /// `efforts` 열쇠 `""` = 지금 뜬 CLI 기본 모델 · 빈 목록 = 강도를 받지 않는 모델 · 열쇠가 없는 모델 = 모른다.
    Ready {
        cli: Cli,
        version: Option<String>,
        model: Option<String>,
        models: Vec<String>,
        efforts: BTreeMap<String, Vec<String>>,
        conversation_id: Option<String>,
    },
    TurnStarted {
        turn: Option<String>,
    },
    /// `text` · `files` 는 어댑터가 채우지 않는다 — 세션 서버가 사람이 보낸 글을 얹는다. 없으면 칸째 싣지 않는다(프로듀서 채팅의 모양은 그대로).
    UserAccepted {
        client_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<Said>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        files: Vec<String>,
    },
    TextDelta {
        item: Option<String>,
        text: String,
    },
    /// 그 앞의 조각을 이것으로 갈음한다.
    Text {
        item: Option<String>,
        text: String,
    },
    ToolStarted {
        item: String,
        name: String,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },
    ToolOutput {
        item: String,
        text: String,
    },
    ToolFinished {
        item: String,
        ok: bool,
        output: Option<String>,
    },
    /// 사람의 답은 `side_chat_decide` 하나 — MCP 에는 길이 없다.
    Permission {
        request_id: String,
        kind: PermKind,
        title: String,
        detail: String,
        tool_name: String,
    },
    PermissionResolved {
        request_id: String,
        decision: Option<Decision>,
        by: ResolvedBy,
    },
    /// 서버가 카드 없이 대신 허용한 요청 — 어댑터는 내지 않는다. 코어 장부에는 `Permission` 으로 적히고 화면으로 나가는 몸만 이 꼴이다.
    PermissionAuto {
        request_id: String,
        kind: PermKind,
        title: String,
        tool_name: String,
        by: ResolvedBy,
    },
    PermPolicy {
        mode: super::perm::PermMode,
        allow: Vec<String>,
    },
    TurnEnded {
        turn: Option<String>,
        outcome: Outcome,
        message: Option<String>,
    },
    ModelChanged {
        model: String,
    },
    /// `None` = CLI 기본.
    EffortChanged {
        effort: Option<String>,
    },
    /// 화면 문구는 프런트가 낱말로 고른다.
    Notice {
        code: &'static str,
        detail: Option<String>,
    },
    /// 이름만 — 명령 · URL · 값은 싣지 않는다.
    McpServers {
        names: Vec<String>,
    },
    /// 어댑터가 낼 때는 악수 실패(`protocol`)다 — 서버는 그 프로세스를 닫는다.
    Exited {
        code: Option<i32>,
        reason: &'static str,
    },
}

/// stdin 줄은 끝 `\n` 없이.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Step {
    pub evs: Vec<Ev>,
    pub stdin: Vec<String>,
}

impl Step {
    pub(crate) fn ev(e: Ev) -> Self {
        Step { evs: vec![e], stdin: Vec::new() }
    }
    pub(crate) fn line(s: String) -> Self {
        Step { evs: Vec::new(), stdin: vec![s] }
    }
}

/// 사람 글에 붙인 그림 하나 — 서버가 앱 첨부 자리 안의 그림 파일인지 본 뒤에만 선다. `data` 는 Claude 몫 base64(Codex 는 `None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UserImage {
    pub path: String,
    pub media_type: &'static str,
    pub data: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Dropped {
    pub bad: u32,
    pub unknown: u32,
}

/// 인자 배열 · JSON 에 싣기 전에 Rust 가 다시 본다.
pub(crate) fn word_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-:[]".contains(&b))
}

/// 빈 값 = CLI 기본. 대화 중 바꾸기(`encode_set_model`)는 빈 값을 받지 않는다(그때는 프런트가 닫고 다시 연다).
pub(crate) fn model_ok(s: &str) -> bool {
    s.is_empty() || word_ok(s)
}

/// Claude 는 모르는 강도 낱말을 조용히 무시하고 성공으로 답한다 — 그래서 Rust 가 악수의 목록으로 거른다.
pub(crate) fn effort_ok(efforts: &BTreeMap<String, Vec<String>>, e: &str) -> bool {
    word_ok(e) && (efforts.values().all(Vec::is_empty) || efforts.values().any(|l| l.iter().any(|x| x == e)))
}

pub(crate) fn uuid_ok(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

pub(crate) fn one_line(s: &str) -> String {
    let flat: String = s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut out: String = flat.chars().take(SUMMARY_MAX).collect();
    if flat.chars().count() > SUMMARY_MAX {
        out.push('…');
    }
    out
}

pub(crate) fn cap(s: &str) -> String {
    if s.len() <= DETAIL_MAX {
        return s.to_string();
    }
    let mut end = DETAIL_MAX;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…(잘림)", &s[..end])
}

/// `mcp__<서버>__<도구>` — Codex 어댑터도 Claude 와 같은 꼴로 낸다.
pub(crate) fn split_mcp_tool<'a>(name: &'a str, server: Option<&'a str>) -> Option<(&'a str, &'a str)> {
    let rest = name.strip_prefix("mcp__")?;
    if let Some(s) = server {
        if let Some(tool) = rest.strip_prefix(s).and_then(|t| t.strip_prefix("__")) {
            return Some((s, tool));
        }
    }
    rest.split_once("__").filter(|(s, t)| !s.is_empty() && !t.is_empty())
}

pub(crate) fn mcp_summary(input: &Value) -> String {
    input.as_object().and_then(|o| o.values().find_map(Value::as_str)).map(one_line).unwrap_or_default()
}

pub(crate) fn str_of(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// 프로듀서 지침 머리글의 틀 — 갈라 온 Codex 프로듀서의 첫 사람 글 앞에 붙는다(`thread/fork` 에 실은 `developerInstructions` 는 서지 않는다).
/// 사이에는 프로듀서 고정 지침만 든다 — 사람 · AI 글은 넣지 않는다. 깨움 틀(`orchestration::wake::PREFIX`)과 다른 글자로 시작해야 기록 판독이 섞지 않는다.
pub(crate) const BRIEF_OPEN: &str = "[Aynx producer brief — fixed app text for this chat, not from the person]\n";
pub(crate) const BRIEF_CLOSE: &str = "\n[end of Aynx producer brief — the person's message follows]\n\n";

pub(crate) fn parse_producer_brief(text: &str) -> Option<&str> {
    let rest = text.strip_prefix(BRIEF_OPEN)?;
    let at = rest.find(BRIEF_CLOSE)?;
    Some(&rest[at + BRIEF_CLOSE.len()..])
}

pub(crate) const LINK_NAME_MAX: usize = 60;
pub(crate) const LINK_HEADER_NONE: &str = "[연결된 타일 없음 — 사람이 연결을 끊었습니다] ";

/// 연결 머리글 — 연결이 서거나 바뀐 뒤 사람의 다음 글 앞에 붙는 고정 앱 글. 값 · 출력은 붙이지 않는다(AI 가 도구로 읽는다).
/// `[` 로 시작한다(`<` 아님 — 기록 보기 규칙). 타일 코드(`p6`)는 넣지 않는다 — F5 · 옮기기에 번호가 바뀐다. 옛 기록의 `p6 로컬` 꼴도 그대로 읽힌다.
pub(crate) fn link_header(link: Option<(&str, &str)>) -> String {
    let Some((stream, name)) = link else {
        return LINK_HEADER_NONE.to_string();
    };
    let flat: String = name.chars().map(|c| if c.is_control() || c == '[' || c == ']' { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = flat.chars().take(LINK_NAME_MAX).collect();
    let stream: String = stream.chars().filter(|c| link_stream_char(*c)).take(LINK_STREAM_MAX).collect();
    if name.is_empty() {
        format!("{LINK_HEADER_OPEN}{LINK_SESSION}{stream}{LINK_HEADER_CLOSE}")
    } else {
        format!("{LINK_HEADER_OPEN}{name}{LINK_NAME_SEP}{LINK_SESSION}{stream}{LINK_HEADER_CLOSE}")
    }
}

pub(crate) fn link_headers(links: &[(&str, &str)]) -> String {
    if links.is_empty() {
        return LINK_HEADER_NONE.to_string();
    }
    links.iter().map(|l| link_header(Some(*l))).collect()
}

/// 입력 칸 칩의 이름(`hint`)이 먼저 — 같은 타일이면 기록 칩과 입력 칸 칩이 같은 글자가 된다.
pub(crate) fn link_display_name(hint: Option<&str>, fallback: Option<&str>) -> String {
    let pick = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    pick(hint).or_else(|| pick(fallback)).unwrap_or_default()
}

// 머리글 조각 — 짓기와 읽기가 같은 글자를 쓴다. 기록에 글자 그대로 남는다 — 바꾸면 옛 기록을 못 읽는다.
const LINK_HEADER_OPEN: &str = "[연결된 타일: ";
const LINK_NAME_SEP: &str = " · ";
const LINK_SESSION: &str = "세션 ";
const LINK_HEADER_CLOSE: &str = "] ";
const LINK_STREAM_MAX: usize = 128;

/// `tile_env::stream_ok` 의 글자와 같다.
fn link_stream_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct LinkNote {
    pub labels: Vec<String>,
    pub unlinked: bool,
}

pub(crate) fn parse_link_note(text: &str) -> Option<(LinkNote, &str)> {
    if let Some(rest) = text.strip_prefix(LINK_HEADER_NONE) {
        return Some((LinkNote { labels: Vec::new(), unlinked: true }, rest));
    }
    let mut labels = Vec::new();
    let mut rest = text;
    while let Some((label, after)) = parse_one_header(rest) {
        labels.push(label.to_string());
        rest = after;
    }
    (!labels.is_empty()).then_some((LinkNote { labels, unlinked: false }, rest))
}

fn parse_one_header(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix(LINK_HEADER_OPEN)?;
    let end = rest.find(']')?;
    let body = rest[end..].strip_prefix(LINK_HEADER_CLOSE)?;
    let inner = &rest[..end];
    let (name, stream) = match inner.rsplit_once(&format!("{LINK_NAME_SEP}{LINK_SESSION}")) {
        Some((name, stream)) if !name.is_empty() => (name, stream),
        Some(_) => return None,
        None => ("", inner.strip_prefix(LINK_SESSION)?),
    };
    let stream_ok = !stream.is_empty() && stream.chars().count() <= LINK_STREAM_MAX && stream.chars().all(link_stream_char);
    let name_ok = name.chars().count() <= LINK_NAME_MAX
        && !name.chars().any(|c| c.is_control() || c == '[')
        && name.split_whitespace().collect::<Vec<_>>().join(" ") == name;
    (stream_ok && name_ok).then_some((name, body))
}

/// `server::side_chat::with_file_refs` 가 짓고 [`parse_file_refs`] 가 읽는다 — 같은 글자.
pub(crate) const FILE_REF_PREFIX: &str = "Attached file: ";
/// 보내기의 첨부 상한과 같다.
const FILE_REFS_MAX: usize = 8;

/// `with_file_refs` 가 짓는 꼴 그대로 맨 끝이 꼬리일 때만 읽는다 — 닮은 글 · 가운데의 꼬리는 손대지 않는다.
pub(crate) fn parse_file_refs(text: &str) -> Option<(Vec<String>, &str)> {
    let mut names = Vec::new();
    let mut end = text.len();
    loop {
        let start = text[..end].rfind('\n').map_or(0, |i| i + 1);
        let Some(name) = text[start..end].strip_prefix(FILE_REF_PREFIX).and_then(file_ref_name) else { break };
        names.push(name);
        if names.len() > FILE_REFS_MAX {
            return None;
        }
        if start == 0 {
            names.reverse();
            return Some((names, ""));
        }
        end = start - 1;
    }
    if names.is_empty() {
        return None;
    }
    let body = text[..end].strip_suffix('\n')?;
    if body.is_empty() || body.ends_with('\n') || body.ends_with('\r') {
        return None;
    }
    names.reverse();
    Some((names, body))
}

fn file_ref_name(path: &str) -> Option<String> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return None;
    }
    let b = path.as_bytes();
    let absolute = path.starts_with('/') || path.starts_with(r"\\") || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/'));
    let mut parts = path.rsplit(['\\', '/']);
    let name = parts.next().filter(|n| !n.is_empty())?;
    (absolute && parts.next() == Some("attachments")).then(|| name.to_string())
}

pub(crate) const IMAGE_ALT_MAX: usize = 80;

/// 생성한 그림 → 마크다운 — 실시간(`codex.rs`)과 기록 다시 읽기(`agent_transcript::codex_events`)가 같은 글자를 낸다. 그림 바이트는 싣지 않는다.
/// 경로의 퍼센트 인코딩은 프런트 `markdown.ts` 의 `readTarget` · `classifyDocHref` 를 지나도록 고른 글자다 — `\` 는 그대로(드라이브 경로).
pub(crate) fn image_markdown(alt: &str, path: &str) -> String {
    let flat: String = alt.chars().map(|c| if c.is_control() || matches!(c, '[' | ']' | '\\' | '`') { ' ' } else { c }).collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut alt: String = flat.chars().take(IMAGE_ALT_MAX).collect();
    if flat.chars().count() > IMAGE_ALT_MAX {
        alt.push('…');
    }
    if alt.is_empty() {
        alt.push_str("image");
    }
    let mut dest = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_control() || matches!(c, '%' | ' ' | '(' | ')' | '<' | '>' | '[' | ']' | '#' | '?' | '`') {
            let mut b = [0u8; 4];
            for byte in c.encode_utf8(&mut b).bytes() {
                dest.push_str(&format!("%{byte:02X}"));
            }
        } else {
            dest.push(c);
        }
    }
    format!("![{alt}]({dest})")
}
