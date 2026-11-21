//! 사이드 채팅 — 채팅 사이드 독의 백엔드. 어댑터([`claude`] · [`codex`])는 순수하다 — 프로세스를 띄우지 않고 파일 · 환경을 읽지 않는다
//! (docs/log/2026-10-23-side-chat-v2-design.md).
//!
//! **stdin 에 닿는 것은 사람이 보낸 글과 사람의 권한 결정뿐**(→ docs/invariants.md 전문 4) — 어댑터가 스스로 짓는 줄은 악수 · CLI 가 물은 것에 대한
//! 고정 답(모르는 요청 거절 · 대화형 도구 거절)뿐이고, 사람 글은 [`Adapter::encode_user`] · 결정은 [`Adapter::encode_decision`] 으로만 든다.
//! 권한 결정은 사람의 그 자리 결정, 또는 사람이 그 채팅에 정한 모드 · 허용 목록([`perm`])에 따라 세션 서버가 대신 낸 **허용**이다.
//! 사람이 그 글에 붙인 그림(첨부 자리 안의 파일만 · 서버가 본다)도 그 사람 글의 일부로 같은 줄에 든다.

pub mod store;

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod claude;
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod codex;
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) mod event;
pub(crate) mod guard;
pub(crate) mod perm;

#[cfg(test)]
mod tests;

#[cfg_attr(not(test), allow(unused_imports))]
pub(crate) use event::{Cli, Decision, Ev, Step, UserImage};

/// 답변 지침(모델이 읽는 고정 글 · 두 CLI 공용 · 직업 · OS 를 가정하지 않는 범용 글). 프로듀서 채팅에는 싣지 않는다.
pub(crate) const ANSWER_GUIDE: &str = "\
Answering (Aynx side chat):
- Lead with the answer, then explain only as far as it helps.
- Keep it concise and well structured: short paragraphs, lists when there are several items, no filler preamble, no restating the question, no closing summary.
- Put code, commands, file paths and configuration in fenced code blocks with a language tag.
- Before recommending anything destructive or hard to undo, say what it changes.
- When a session is linked to this chat, base the answer on what it shows and quote only the relevant lines.
- If the request is ambiguous, ask one short clarifying question instead of guessing; if you are unsure, say so.";

pub(crate) fn fixed_guide() -> String {
    format!("{ANSWER_GUIDE}\n\n{SEARCH_GUIDE}")
}

/// Codex 사이드 채팅의 `developerInstructions` — 상한은 Claude 지침 파일과 같아야 한다.
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

/// 웹 검색 지침(모델이 읽는 고정 글 · 두 CLI 공용). 도구 이름을 부르지 않는다 — 두 CLI 의 검색 도구가 다르다.
pub(crate) const SEARCH_GUIDE: &str = "\
Web search (Aynx side chat):
- For facts that may be recent, changing or uncertain (versions, releases, prices, news, APIs, schedules), search the web instead of answering from memory.
- Use several short, focused queries and cross-check the results rather than trusting a single one.
- Prefer primary and official sources (vendor docs, release notes, standards, original announcements) and confirm a specific detail there before stating it.
- Open the relevant pages to confirm details instead of relying on search snippets alone.
- Cite each source in parentheses right after the sentence (or at the end of the paragraph) it supports, as a Markdown link named after the site or document, e.g. Tauri 2 supports channels ([Tauri docs](https://v2.tauri.app/)). Put several sources in one pair of parentheses, separated by commas: ([A](url1), [B](url2)).
- Link a word itself only when the link is what you are talking about (a download page, a repository the person asked for).
- When it matters, say which date or version the information refers to.
- If sources disagree or you could not confirm something, say so plainly.
- Answer in the language the person writes in.";

/// 두 어댑터의 같은 얼굴. 오류 값은 프런트가 받는 짧은 낱말(`not-ready` · `no-turn` · `bad-model` · `bad-effort` · `unknown-request`)이다.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) trait Adapter: Send {
    fn cli(&self) -> Cli;
    fn handshake(&mut self) -> Vec<String>;
    fn on_line(&mut self, line: &str) -> Step;
    /// `client_id` 는 프런트의 낙관 표시 id — 받아들여지면 `userAccepted{clientId}` 로 돌아온다.
    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str>;
    fn encode_interrupt(&mut self) -> Result<Step, &'static str>;
    fn encode_set_model(&mut self, model: &str) -> Result<Step, &'static str>;
    /// 다시 띄우지 않는다.
    fn encode_set_effort(&mut self, effort: Option<&str>) -> Result<Step, &'static str>;
    fn encode_decision(&mut self, request_id: &str, decision: Decision, message: Option<&str>) -> Result<Step, &'static str>;
    fn close_pending(&mut self) -> Vec<Ev>;
    fn dropped(&self) -> event::Dropped;
}
