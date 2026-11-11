//! 사이드 채팅 v2 의 **CLI 무관 사건 꼴**(설계 3절) · 어댑터가 함께 쓰는 작은 재료. 순수.
//!
//! 사건은 serde 꼬리표 `t` · camelCase 로 프런트까지 그대로 간다(2단계 `side-chat-event{chat,epoch,seq,ev}` 의 `ev`). 본문(모델 글 ·
//! 도구 출력)을 싣는다 — 이 사건은 **주 창에만** 간다(설계 1절). 도구 출력 · 권한 상세는 [`DETAIL_MAX`] 에서 자른다.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

/// **사람이 보낸 글**(사건 `userAccepted.text`) — 직렬화는 글 그대로(구독 창으로 간다), `Debug` 는 길이만(로그 · `Debug` 에 본문을 남기지
/// 않는다 — 2026-11-01).
#[derive(Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct Said(pub(crate) String);

impl std::fmt::Debug for Said {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Said(<{} bytes>)", self.0.len())
    }
}

/// 도구 출력 · 권한 상세 · 도구 입력 한 덩어리의 상한(바이트 — 넘으면 앞부분만 + 잘림 표시 · 입력은 뺀다).
pub(crate) const DETAIL_MAX: usize = 16 * 1024;
/// 도구 한 줄 요약 · 권한 제목의 상한(글자).
pub(crate) const SUMMARY_MAX: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Cli {
    Claude,
    Codex,
}

/// 띄우는 모양(설계 3절 `side_chat_open.mode`). 갈라 오기의 원본은 Rust 가 색인에서 찾은 대화 id 다(경로는 프런트에서 받지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode<'a> {
    /// 새 대화.
    Fresh,
    /// 같은 대화를 잇는다(Claude `--resume` · Codex `thread/resume`).
    Resume { conv: &'a str },
    /// 원본을 그대로 두고 새 대화로 갈라 온다(Claude `--resume --fork-session` · Codex `thread/fork`).
    Fork { from: &'a str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PermKind {
    /// Claude 도구 하나(`can_use_tool`).
    Tool,
    /// Codex 명령 실행(샌드박스 밖 — 권한 상승 요청).
    Command,
    /// Codex 파일 바꾸기.
    FileChange,
    /// 외부 MCP 서버의 도구 하나(2026-10-25 — Claude `can_use_tool{mcp_server}` · Codex `mcpServer/elicitation/request{codex_approval_kind:
    /// mcp_tool_call}`). '묻지 않기' 를 끈 서버만 온다.
    McpTool,
}

/// 사람의 결정 — v2 첫 판은 [허용 한 번] [거절] 둘뿐("늘 허용" 류 없음 — 설계 4절).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResolvedBy {
    /// 사람이 정했다(`side_chat_decide`).
    Human,
    /// CLI 가 거둬 갔다(턴 끊김 · 취소 알림).
    Cli,
    /// 프로세스가 끝나 기다리던 요청이 닫혔다.
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Outcome {
    Ok,
    /// 사람이 끊었다 — 실패가 아니다(spike 함정 2).
    Interrupted,
    Error,
}

/// CLI 무관 사건(설계 3절).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum Ev {
    /// 악수가 끝났다 — 이제 보낼 수 있다. `models` 는 칩의 고르기 목록(Claude 별칭 · Codex 모델 id).
    /// `efforts` = 모델 → 그 모델이 받는 추론 강도(악수가 알린 것 — Claude `initialize` 의 `models[].supportedEffortLevels` · Codex
    /// `model/list` 의 `supportedReasoningEfforts`). 열쇠 `""` = 지금 뜬 CLI 기본 모델(Claude `default` · Codex 스레드의 모델). 빈 목록 =
    /// 강도를 받지 않는 모델(칩을 숨긴다) · 열쇠가 없는 모델 = 모른다.
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
    /// 보낸 글이 CLI 에 들어갔다(턴이 그 글로 시작했다). `text` · `files` 는 어댑터가 채우지 않는다 — 사이드 채팅 주인
    /// (`server::side_chat` 의 `Host::shape`)이 그 채팅에 **사람이 보낸** 글(연결 머리글 없는 본문)과 붙인 그림의 파일 이름을 얹는다(다른
    /// 창이 보낸 글을 곧바로 그리게 — 2026-11-01 원격 사이드 채팅). 없으면 칸째 싣지 않는다(프로듀서 채팅의 모양은 그대로).
    UserAccepted {
        client_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<Said>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        files: Vec<String>,
    },
    /// 모델 글 조각 — 모으기는 서버 몫(2단계).
    TextDelta {
        item: Option<String>,
        text: String,
    },
    /// 모델 글 한 덩어리가 끝났다(그 앞의 조각을 이것으로 갈음한다).
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
    /// 사람에게 묻는다 — 답은 `side_chat_decide` 하나(MCP 없음).
    Permission {
        request_id: String,
        kind: PermKind,
        title: String,
        detail: String,
        tool_name: String,
    },
    /// 기다리던 요청이 끝났다. `decision` 은 사람이 정했을 때만.
    PermissionResolved {
        request_id: String,
        decision: Option<Decision>,
        by: ResolvedBy,
    },
    TurnEnded {
        turn: Option<String>,
        outcome: Outcome,
        message: Option<String>,
    },
    ModelChanged {
        model: String,
    },
    /// 추론 강도가 바뀌었다 — `None` = CLI 기본(Claude 는 CLI 가 받았다고 답한 뒤 · Codex 는 곧바로 — 다음 `turn/start` 에 싣는다).
    EffortChanged {
        effort: Option<String>,
    },
    /// 사람에게 보일 만한 일(낱말 하나 + 짧은 상세) — 화면 문구는 프런트가 낱말로 고른다.
    Notice {
        code: &'static str,
        detail: Option<String>,
    },
    /// 이 프로세스에 실린 **외부 MCP 서버 이름**(2026-10-25 — 서버가 띄울 때 한 번 · 머리줄 "MCP N" 칩). 이름만(명령 · URL · 값 없음).
    McpServers {
        names: Vec<String>,
    },
    /// 프로세스가 끝났다(서버가 낸다) · 어댑터가 낼 때는 **악수 실패 = `protocol`** — 서버는 그 프로세스를 닫는다.
    Exited {
        code: Option<i32>,
        reason: &'static str,
    },
}

/// 줄 하나 처리의 결과 — 사건 + 곧바로 stdin 에 쓸 줄(각각 끝 `\n` 없이).
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

/// **사람 글에 붙인 그림 하나**(2026-10-24) — 서버가 앱 첨부 자리 안의 그림 파일인지 본 뒤에만 선다(`server::side_chat` 의
/// `chat_images`). `path` = 그 파일의 실제 경로(Codex `localImage`), `data` = 바이트의 base64(Claude 몫 — Codex 는 읽지 않아 `None`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UserImage {
    pub path: String,
    pub media_type: &'static str,
    pub data: Option<String>,
}

/// 세고 버린 줄.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Dropped {
    /// JSON 객체가 아닌 줄.
    pub bad: u32,
    /// 모르는 사건 · 알림 · 우리가 묻지 않은 답.
    pub unknown: u32,
}

/// 모델 · 강도 낱말인가 — 인자 배열 · JSON 에 싣기 전에 Rust 가 다시 본다(설계 2절). 영숫자와 `. _ - : [ ]` · 1..=64자.
pub(crate) fn word_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-:[]".contains(&b))
}

/// 띄울 모델 값인가 — **빈 값 = CLI 기본**(Claude 는 `--model` 을 싣지 않고 · Codex 는 `model: null` — v1 칩의 "CLI 기본" · 4단계) 또는
/// [`word_ok`]. 대화 중 바꾸기(`encode_set_model`)는 빈 값을 받지 않는다(그때는 프런트가 닫고 다시 연다).
pub(crate) fn model_ok(s: &str) -> bool {
    s.is_empty() || word_ok(s)
}

/// 대화 중 바꿀 강도로 받는가 — [`word_ok`] 이고, 악수가 강도 목록을 알렸으면 그 어느 모델의 목록에 있어야 한다(Claude 는 모르는
/// 낱말을 **조용히 무시하고** 성공으로 답한다 — 10-23 실측 · 그래서 Rust 가 거른다). 목록을 아직 모르면 낱말 모양만.
pub(crate) fn effort_ok(efforts: &BTreeMap<String, Vec<String>>, e: &str) -> bool {
    word_ok(e) && (efforts.values().all(Vec::is_empty) || efforts.values().any(|l| l.iter().any(|x| x == e)))
}

/// 대화 id 모양(UUID 8-4-4-4-12 hex — Claude 세션 · Codex thread 둘 다).
pub(crate) fn uuid_ok(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// 한 줄 요약 — 줄바꿈 · 제어 문자를 공백으로, [`SUMMARY_MAX`] 글자까지(넘으면 `…`).
pub(crate) fn one_line(s: &str) -> String {
    let flat: String = s.trim().chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut out: String = flat.chars().take(SUMMARY_MAX).collect();
    if flat.chars().count() > SUMMARY_MAX {
        out.push('…');
    }
    out
}

/// 긴 글을 [`DETAIL_MAX`] 바이트에서 자른다(글자 경계 · 잘렸으면 `\n…(잘림)` 표시).
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

/// MCP 도구 이름 `mcp__<서버>__<도구>`(Claude 꼴 — Codex 어댑터도 같은 꼴로 낸다) → (서버, 도구). 서버를 알면(`server`) 그 머리를 벗기고,
/// 모르면 첫 `__` 에서 가른다.
pub(crate) fn split_mcp_tool<'a>(name: &'a str, server: Option<&'a str>) -> Option<(&'a str, &'a str)> {
    let rest = name.strip_prefix("mcp__")?;
    if let Some(s) = server {
        if let Some(tool) = rest.strip_prefix(s).and_then(|t| t.strip_prefix("__")) {
            return Some((s, tool));
        }
    }
    rest.split_once("__").filter(|(s, t)| !s.is_empty() && !t.is_empty())
}

/// MCP 도구 입력의 한 줄 요약 — 첫 문자열 값(검색어 · 주소 따위). 없으면 빈 글자.
pub(crate) fn mcp_summary(input: &Value) -> String {
    input.as_object().and_then(|o| o.values().find_map(Value::as_str)).map(one_line).unwrap_or_default()
}

/// 문자열이면 그 값.
pub(crate) fn str_of(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// **프로듀서 지침 머리글의 틀**(오케스트레이션 2단계 단계 5 — [오케스트레이션으로 이어 가기] 의 Codex 갈래 · 실측 P6: 지침 없이 시작한 타일
/// 대화를 `thread/fork` 하며 실은 `developerInstructions` 는 서지 않았다). 갈라 온 Codex 프로듀서의 **첫 사람 글 앞**에 붙는 앱 고정 글의 앞 · 뒤 —
/// 사이에는 프로듀서 고정 지침(`server::producer::launch::fork_brief` — 짓는 곳 하나)만 든다. 사람 · AI 글은 넣지 않는다. 깨움 틀
/// (`orchestration::wake::PREFIX`)과 다른 글자로 시작한다(기록 판독이 섞지 않게). 읽기는 [`parse_producer_brief`].
pub(crate) const BRIEF_OPEN: &str = "[Aynx producer brief — fixed app text for this chat, not from the person]\n";
pub(crate) const BRIEF_CLOSE: &str = "\n[end of Aynx producer brief — the person's message follows]\n\n";

/// **프로듀서 지침 머리글 읽기**(기록 보기) — 글이 [`BRIEF_OPEN`] 으로 **맨 앞에서** 시작하고 [`BRIEF_CLOSE`] 가 있으면 머리글 뒤의 사람 글. 아니면 `None`.
pub(crate) fn parse_producer_brief(text: &str) -> Option<&str> {
    let rest = text.strip_prefix(BRIEF_OPEN)?;
    let at = rest.find(BRIEF_CLOSE)?;
    Some(&rest[at + BRIEF_CLOSE.len()..])
}

/// 연결 머리글의 이름 상한(글자).
pub(crate) const LINK_NAME_MAX: usize = 60;
/// 연결을 끊은 뒤 다음 글 앞의 머리글.
pub(crate) const LINK_HEADER_NONE: &str = "[연결된 타일 없음 — 사람이 연결을 끊었습니다] ";

/// **연결 머리글**(5단계 — v1 결정 10) — 연결이 서거나 바뀐 뒤 사람의 다음 글 앞에 붙는 고정 앱 글. `link` = (스트림 id, 이름 — 사람이 보는
/// 타일 표시 이름 · [`link_display_name`]). 값 · 출력은 붙이지 않는다(AI 가 도구로 읽는다). `[` 로 시작한다(`<` 아님 — 기록 보기 규칙). 이름은 한 줄 ·
/// 대괄호 걷기 · [`LINK_NAME_MAX`] 글자, 스트림 id 는 `tile_env::stream_ok` 글자만. 타일 코드(`p6`)는 **넣지 않는다**(10-24 실기 3차 — F5 · 옮기기에
/// 번호가 바뀌어 굳힌 기록 칩과 지금 칩이 어긋났다 · 모델이 짝지을 열쇠는 세션 id). 옛 기록의 `p6 로컬` 꼴도 그대로 읽힌다([`parse_link_note`]).
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

/// **머리글의 이름 고르기** — 화면이 보낼 때 실은 입력 칸 칩의 이름(`hint` — 프런트 `linkChipState` 의 이름 = 타일 표시 이름)이 먼저,
/// 없으면(옛 화면 · 칸 없음) 서버 거울의 타일 이름(`fallback` — 코드는 붙이지 않는다). 그래서 같은 타일이면 기록 칩과 입력 칸 칩이 같은 글자다.
pub(crate) fn link_display_name(hint: Option<&str>, fallback: Option<&str>) -> String {
    let pick = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    pick(hint).or_else(|| pick(fallback)).unwrap_or_default()
}

/// 머리글 조각 — 짓기([`link_header`])와 읽기([`parse_link_note`])가 같은 글자를 쓴다(따로 놀지 않게).
const LINK_HEADER_OPEN: &str = "[연결된 타일: ";
const LINK_NAME_SEP: &str = " · ";
const LINK_SESSION: &str = "세션 ";
const LINK_HEADER_CLOSE: &str = "] ";
/// 머리글의 스트림 id 상한(글자).
const LINK_STREAM_MAX: usize = 128;

/// 머리글의 스트림 id 에 남기는 글자(`tile_env::stream_ok` 의 글자).
fn link_stream_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')
}

/// **머리글이 알린 연결**(기록 보기의 칩 · `op_send` 의 답) — `{label}`(타일 표시 이름 — 옛 기록은 코드가 붙은 꼴 그대로 · 비면 이름 없는 타일) 또는 `{unlinked: true}`.
/// 스트림 id 는 싣지 않는다(화면에 보이지 않는다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct LinkNote {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unlinked: bool,
}

/// **머리글 읽기** — 글이 [`link_header`] 가 짓는 꼴 그대로 **맨 앞에서** 시작하면 (연결, 머리글 뒤의 사람 글). 아니면 `None`(닮은 글 ·
/// 가운데의 머리글은 손대지 않는다). 이름은 짓기가 남기는 모양(한 줄 · 대괄호 없음 · 공백 하나씩 · [`LINK_NAME_MAX`] 글자)만,
/// 스트림 id 는 [`link_stream_char`] 글자만 받는다.
pub(crate) fn parse_link_note(text: &str) -> Option<(LinkNote, &str)> {
    if let Some(rest) = text.strip_prefix(LINK_HEADER_NONE) {
        return Some((LinkNote { label: None, unlinked: true }, rest));
    }
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
    (stream_ok && name_ok).then(|| (LinkNote { label: Some(name.to_string()), unlinked: false }, body))
}

/// 그림 대체 글자의 상한(글자).
pub(crate) const IMAGE_ALT_MAX: usize = 80;

/// **생성한 그림 한 장 → 마크다운 `![alt](경로)`**(2026-10-24 — Codex `imageGeneration` 의 `savedPath`) — 실시간(`codex.rs`)과
/// 기록 다시 읽기(`agent_transcript::codex_events`)가 같은 글자를 낸다. 그리기는 프런트의 그림 읽개(`doc-images` — 스킴 없는 경로만 ·
/// `<img>` + `blob:`)다 — 그림 바이트(base64 `result`)는 **싣지 않는다**.
///
/// - 대체 글자: 한 줄 · 대괄호 · 역슬래시 · 백틱은 공백 · [`IMAGE_ALT_MAX`] 글자(넘으면 `…`) · 비면 `image`.
/// - 경로: 프런트 파서(`markdown.ts` 의 `readTarget` — 공백 · 짝 없는 `)` 에서 끝난다)와 `classifyDocHref`(`?` · `#` 에서 가르고
///   `decodeURIComponent` 로 푼다)를 지나도록 `%` · 공백 · 괄호 · 꺾쇠 · 대괄호 · `#` · `?` · 백틱과 제어 문자를 퍼센트 인코딩한다. `\` 는 그대로(드라이브
///   경로 `C:\…` 는 경로로 읽힌다). 비-ASCII 는 그대로(풀 것이 없다).
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
