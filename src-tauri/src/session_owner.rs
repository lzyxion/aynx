//! 세션의 소유 주체([`SessionOwnerKind`]) — 창인가 위임(헤드리스)인가.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SessionOwnerKind {
    #[default]
    Window,
    /// 헤드리스 세션은 창 정리로 거둬지지 않는다 — 명시적 닫기나 앱 종료로만 사라진다.
    Delegated,
}
