//! 사이드 채팅 — 채팅 사이드 독의 백엔드. 어댑터([`claude`] · [`codex`])는 순수하다 — 프로세스를 띄우지 않고 파일 · 환경을 읽지 않는다
//! (docs/log/2026-10-23-side-chat-v2-design.md).
//!
//! **stdin 에 닿는 것은 사람이 보낸 글과 사람의 권한 결정뿐**(→ docs/invariants.md 전문 4) — 어댑터가 스스로 짓는 줄은 악수 · CLI 가 물은 것에 대한
//! 고정 답(모르는 요청 거절 · 대화형 도구 거절) · 채팅 타일의 목록 읽기(Codex `skills/list` — 악수 끝 한 번) · 사람이 연 MCP 상태 읽기의 다음 쪽
//! (Codex `mcpServerStatus/list`)뿐이고, 사람 글은 [`Adapter::encode_user`] · 결정은 [`Adapter::encode_decision`] 으로만 든다(채팅 타일은 더해 사람의 칩
//! [`Adapter::encode_set_perm_mode`] · 늘 허용 · 질문 답 [`Adapter::encode_tile_answer`] · 압축 [`Adapter::encode_compact`] · 되감기 [`Adapter::encode_rewind`] ·
//! 검토 [`Adapter::encode_review`] · 목표 [`Adapter::encode_goal`] · MCP 상태 읽기 [`Adapter::encode_mcp_status`]). 맥락 사용량 · MCP 상태 · 목표 상태는 CLI 가 알린 줄에서 받기만 한다.
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

/// 두 어댑터의 같은 얼굴. 오류 값은 프런트가 받는 짧은 낱말(`not-ready` · `no-turn` · `bad-model` · `bad-effort` · `unknown-request` · `bad-mode` ·
/// `bad-answer` · `no-session-allow` · `turn-running` · `bad-skill` · `unsupported` · `rewind-running` · `bad-anchor` · `bad-tier`)이다.
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
    /// 채팅 타일만 — 기본 몸 `Err("unsupported")`. 사이드 채팅 · 프로듀서 어댑터(같은 타입의 `tile: false`)와 `ProducerGuard` 는 이 몸을 쓴다.
    fn encode_set_perm_mode(&mut self, _mode: &str) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — [이 대화에서 늘 허용] · 질문 답. 무엇을 실을지는 어댑터가 제 대기 장부에서 고른다(프런트가 보낸 글자를 믿지 않는다). 오류면 대기에서 빼지 않는다.
    fn encode_tile_answer(&mut self, _request_id: &str, _answer: event::TileAnswer<'_>) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 사람이 부른 맥락 압축. 턴 중 · 보낸 글이 아직 턴을 열지 않았으면 `Err("turn-running")`.
    fn encode_compact(&mut self, _instructions: Option<&str>) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 사람이 부른 되감기(미리 보기 · 실행). 답은 `Ev::Rewind` 로. `last_seen` = 서버가 기록에서 읽은 현재 갈래의 마지막 사람 말(Claude 대화 되감기만 쓴다).
    /// 턴 중 · 보낸 글이 아직 턴을 열지 않았으면 `Err("turn-running")` · 답을 기다리는 되감기가 있으면 `Err("rewind-running")`.
    fn encode_rewind(&mut self, _anchor: &str, _scope: &str, _dry_run: bool, _last_seen: Option<&str>) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 다음 `encode_user` 가 실을 스킬(이름 → 경로는 어댑터의 목록에서). stdin 을 짓지 않는다. 모르는 이름 `Err("bad-skill")`.
    fn encode_tile_skills(&mut self, _names: &[String]) -> Result<(), &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 사람이 고른 검토(Codex). 턴 중 · 보낸 글이 아직 턴을 열지 않았으면 `Err("turn-running")`.
    fn encode_review(&mut self, _target: &event::ReviewTarget) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 사람이 정한 · 멈춘 · 이어 간 · 지운 목표(Codex). `origin:"user"` 는 이 몸에서만 싣는다.
    fn encode_goal(&mut self, _action: &event::GoalAction<'_>) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 다음 턴부터의 속도 등급(Codex · `None` = CLI 기본). stdin 을 짓지 않는다. 그 모델의 목록 밖이면 `Err("bad-tier")`.
    fn encode_set_tier(&mut self, _tier: Option<&str>) -> Result<(), &'static str> {
        Err("unsupported")
    }
    /// 채팅 타일만 — 사람이 연 MCP 상태 풍선의 읽기 한 번. 답은 `Ev::McpStatus{source:"list"}` 로.
    fn encode_mcp_status(&mut self) -> Result<Step, &'static str> {
        Err("unsupported")
    }
    fn close_pending(&mut self) -> Vec<Ev>;
    fn dropped(&self) -> event::Dropped;
}
