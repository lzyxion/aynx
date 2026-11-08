//! 세션의 소유 주체([`SessionOwnerKind`]) — 창인가 위임(헤드리스)인가.
//!
//! 거울(`crate::context`)과 SSH 세션 표(`crate::ssh`)·MCP·실행 브로커가 모두 이 값으로 가른다.
//! `context` 안에 있었을 때는 세션 층(`ssh`)이 이 열거형 하나 때문에 기능 층(`context`)을 불렀다 —
//! 아무것도 모르는 값이라 맨 아래에 둔다.

/// 세션의 **소유 주체** — 창(사람이 연 타일)인가, 위임(헤드리스)인가.
///
/// 창 세션은 소유 창 라벨([`crate::context::SessionContext::owner`])로 [`crate::reap`] 이 거둔다. 헤드리스 세션은
/// 창이 없어 창 정리로 거둬지지 않는다(명시적 [`crate::headless::close_headless_session`] 이나 앱
/// 종료로만 사라진다) — [`crate::context::reclaim_window`] 가 이 값으로 헤드리스 세션을 건너뛴다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SessionOwnerKind {
    /// 사람이 타일에서 연 세션(기본). [`crate::session_commands::report_session`] 이 만든다.
    #[default]
    Window,
    /// AI 위임 헤드리스 세션([`crate::delegation`]). [`crate::context::report_delegated`] 이 만든다.
    Delegated,
}
