//! **사이드 채팅** — 채팅 사이드 독의 백엔드(2026-10-23).
//!
//! - [`store`] — v1 그대로: 채팅 목록 파일(`chats.json`) · 채팅마다 폴더 · 지우기(Tauri 명령 넷).
//! - v2 구조화 모드의 **순수 층**(설계 docs/log/2026-10-23-side-chat-v2-design.md 3절 · 7절 1단계 — 실측
//!   docs/log/2026-10-23-side-chat-structured-spike.md): CLI 무관 사건 꼴 [`event`] · CLI 마다 어댑터 [`claude`] · [`codex`].
//!   어댑터는 프로세스를 띄우지 않고 파일 · 환경을 읽지 않는다 — 인자 배열을 짓고, stdin 줄을 짓고, stdout 줄 하나를 사건으로 바꿀 뿐이다
//!   (상태는 줄 사이의 작은 장부뿐 — 대기 중 권한 요청 · 요청 id · 지금 턴). 띄우기 · 줄 나누기(`orchestration::turn::LineSplitter`) ·
//!   `textDelta` 모으기 · 표 · 임대는 세션 서버(2단계 `server/side_chat.rs` — 프로세스 몸은 공용 코어 `server/chat_proc/`)의 일이다.
//!
//! **stdin 에 닿는 것은 사람이 보낸 글과 사람의 권한 결정뿐**(설계 2절 ③) — 어댑터가 스스로 짓는 줄은 악수 · CLI 가 물은 것에 대한
//! 고정 답(모르는 요청 거절 · 대화형 도구 거절)뿐이고, 사람 글은 [`Adapter::encode_user`] · 결정은 [`Adapter::encode_decision`] 으로만 든다.
//! 사람이 그 글에 붙인 그림(2026-10-24 — 첨부 자리 안의 파일만 · 서버가 본다)도 그 사람 글의 일부로 같은 줄에 든다.

pub mod store;

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod claude;
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod codex;
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod event;
/// 프로듀서 승인 정책(오케스트레이션 2단계 단계 2 — 카드 둘 · 그 밖 자동 거절).
pub(crate) mod guard;

#[cfg(test)]
mod tests;

#[cfg_attr(not(test), allow(unused_imports))]
pub(crate) use event::{Cli, Decision, Ev, Step, UserImage};

/// 답변 지침(모델이 읽는 고정 글 · 두 CLI 공용 — 2026-11-01 사용자 승인 · 직업 · OS 를 가정하지 않는 범용 글). 검색 지침 **앞에** 싣는다
/// ([`fixed_guide`]). 프로듀서 채팅에는 싣지 않는다(그쪽은 프로듀서 고정 지침).
pub(crate) const ANSWER_GUIDE: &str = "\
Answering (AYNX side chat):
- Lead with the answer, then explain only as far as it helps.
- Keep it concise and well structured: short paragraphs, lists when there are several items, no filler preamble, no restating the question, no closing summary.
- Put code, commands, file paths and configuration in fenced code blocks with a language tag.
- Before recommending anything destructive or hard to undo, say what it changes.
- When a session is linked to this chat, base the answer on what it shows and quote only the relevant lines.
- If the request is ambiguous, ask one short clarifying question instead of guessing; if you are unsure, say so.";

/// 사이드 채팅의 앱 고정 지침 — 답변 지침 다음 검색 지침(두 CLI 같은 글 · Claude 지침 파일의 맨 앞 · Codex `developerInstructions`).
pub(crate) fn fixed_guide() -> String {
    format!("{ANSWER_GUIDE}\n\n{SEARCH_GUIDE}")
}

/// Codex 사이드 채팅의 `developerInstructions` — 앱 고정 지침([`fixed_guide`]) 뒤에 사람이 설정 › 지침에서 쓴 **사이드 채팅 지침**
/// (`<데이터 루트>/sidechat/CLAUDE.md` — 세션 서버가 읽어 넘긴다 · Claude 는 같은 글을 지침 파일에 싣는다). 비었으면 고정 지침만. 정화
/// (`sanitize_text`) 하고 [`crate::orchestration::turn::INSTRUCTIONS_DOC_MAX`] 에서 자른다(Claude 지침 파일과 같은 상한). **순수**.
pub(crate) fn codex_instructions(person: Option<&str>) -> String {
    let mut out = fixed_guide();
    let Some(p) = person.map(str::trim).filter(|p| !p.is_empty()) else {
        return out;
    };
    let mut body = crate::orchestration::spawn::sanitize_text(p);
    let max = crate::orchestration::turn::INSTRUCTIONS_DOC_MAX;
    let cut = body.len() > max;
    if cut {
        let mut end = max;
        while !body.is_char_boundary(end) {
            end -= 1;
        }
        body.truncate(end);
    }
    out.push_str("\n\nSide chat instructions (from the person):\n");
    out.push_str(&body);
    if cut {
        out.push_str("\n\n(truncated)");
    }
    out
}

/// 웹 검색 지침(모델이 읽는 고정 글 · 두 CLI 공용 — 2026-10-25 · 답변 지침 바로 뒤 — [`fixed_guide`]). Claude 는 지침 파일(`--append-system-prompt-file`),
/// Codex 는 `thread/{start,resume,fork}.developerInstructions`. 도구 이름을 부르지 않는다 — Claude 의 검색은 제목 · 주소만 주고 페이지
/// 읽기는 WebFetch(묻지 않음 — 10-25), Codex 의 내장 검색은 페이지를 연다.
pub(crate) const SEARCH_GUIDE: &str = "\
Web search (AYNX side chat):
- For facts that may be recent, changing or uncertain (versions, releases, prices, news, APIs, schedules), search the web instead of answering from memory.
- Use several short, focused queries and cross-check the results rather than trusting a single one.
- Prefer primary and official sources (vendor docs, release notes, standards, original announcements) and confirm a specific detail there before stating it.
- Open the relevant pages to confirm details instead of relying on search snippets alone.
- Cite each source in parentheses right after the sentence (or at the end of the paragraph) it supports, as a Markdown link named after the site or document, e.g. Tauri 2 supports channels ([Tauri docs](https://v2.tauri.app/)). Put several sources in one pair of parentheses, separated by commas: ([A](url1), [B](url2)).
- Link a word itself only when the link is what you are talking about (a download page, a repository the person asked for).
- When it matters, say which date or version the information refers to.
- If sources disagree or you could not confirm something, say so plainly.
- Answer in the language the person writes in.";

/// 두 어댑터의 같은 얼굴 — 세션 서버가 채팅마다 `Box<dyn Adapter>` 하나를 쥔다(2단계). 오류 값은 짧은 낱말(`not-ready` · `no-turn` ·
/// `bad-model` · `bad-effort` · `unknown-request`)이다.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) trait Adapter: Send {
    fn cli(&self) -> Cli;
    /// 프로세스가 선 직후 쓸 줄(Claude `initialize` 제어 요청 · Codex `initialize`). 준비(`ready`)는 그 답에서 온다.
    fn handshake(&mut self) -> Vec<String>;
    /// stdout 한 줄 → 사건 + (필요하면) 곧바로 쓸 stdin 답.
    fn on_line(&mut self, line: &str) -> Step;
    /// 사람이 보낸 글 하나 + 그 글에 붙인 그림(서버가 본 첨부 — 없으면 빈 조각 · 그림만이면 글이 빌 수 있다). `client_id` 는 프런트의
    /// 낙관 표시 id — 받아들여지면 `userAccepted{clientId}` 로 돌아온다. 그림의 바이트가 없으면(Claude) `bad-image`.
    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str>;
    fn encode_interrupt(&mut self) -> Result<Step, &'static str>;
    fn encode_set_model(&mut self, model: &str) -> Result<Step, &'static str>;
    /// 추론 강도 바꾸기(`None` = CLI 기본) — 다시 띄우지 않는다(Claude `apply_flag_settings{effortLevel}` · Codex 다음 `turn/start`).
    /// 모르는 낱말은 `bad-effort`(`event::effort_ok`).
    fn encode_set_effort(&mut self, effort: Option<&str>) -> Result<Step, &'static str>;
    /// 사람의 권한 결정 — 기다리는 `requestId` 가 아니면 `unknown-request`.
    fn encode_decision(&mut self, request_id: &str, decision: Decision, message: Option<&str>) -> Result<Step, &'static str>;
    /// 프로세스가 죽거나 다시 뜰 때 — 기다리던 요청을 모두 `permissionResolved{by: closed}` 로 닫는다.
    fn close_pending(&mut self) -> Vec<Ev>;
    /// 세고 버린 줄(모르는 사건 · JSON 아님).
    fn dropped(&self) -> event::Dropped;
}
