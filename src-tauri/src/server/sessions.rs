//! 세션 서버 안의 **세션 op** — `session_core`(표·임대) × 자원 표(ConPTY · SSH 셸 채널) × 파이프 연결(출력 프레임·ACK 크레딧).
//! 설계 `docs/internal/session-server-design-2026-10-08.md`.
//!
//! - GUI 프로세스 하나 = 연결 하나 — 이관 전후 출력이 한 줄로 오고 GUI 는 프레임 머리의 임대 회차로 옛 창 몫을 가른다.
//! - **연결이 끊겨도 세션은 산다**(임대만 푼다 · `Detached`). 세션 종료는 명시 op 와 셸의 자연 종료뿐이고, 복원이 데려가지 않은 세션도 닫지 않는다.
//! - 시청자 규칙은 `crate::session_core::viewers` 머리말 하나다. 시청자 크레딧은 수문·전체 예산과 무관 — 넘치면 그 시청자만 뗀다.

use super::{ai, chat_tile, hub, producer, side_chat};

mod types;
mod io;
mod lifecycle;
mod dispatch;
mod attach;
mod open;

#[allow(unused_imports)]
pub(crate) use dispatch::{handle, inline_op, input_target};
pub(crate) use io::{ack, retire_ssh_credit, settle, SIZE_OWNER_EVENT, VIEWER_ENDED_EVENT};
#[allow(unused_imports)]
pub(crate) use lifecycle::{
    close_all_ssh, close_everything_blocking, conn_gone, conn_opened, detached_changed, detached_rows, live_count, mark_stopping, Broadcaster,
    DetachedSession, DETACHED_CHANGED,
};
pub(crate) use open::SSH_OPEN;
#[allow(unused_imports)]
pub(crate) use types::{ConnCtx, OutTx};

#[cfg(test)]
mod tests;
