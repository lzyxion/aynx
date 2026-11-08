//! 세션 서버 안의 **세션 op** — `session_core`(표·임대·예약·체크포인트) × 자원 표(`pty` — ConPTY · `ssh` — SSH 셸 채널) ×
//! 파이프 연결(출력 프레임·ACK 크레딧). ③-2 로컬 · **③-3b2 SSH** (설계 `docs/internal/session-server-design-2026-10-08.md`
//! 4.2·4.3 · 9절 ③).
//!
//! GUI 의 Tauri 명령(`open_local_session`·`open_ssh_session`·`write_session`·`attach_session` …)은 `server::proxy` 가 이 op
//! 들로 옮긴다. 쓰기·크기·닫기·붙기·떨어지기·체크포인트·이관·창 거둠은 **kind 무관**이다 — 스트림 열쇠 하나로 부르고 종류는
//! 코어가 안다(`Core::kind_of`). SSH 만의 op 는 열기(`open_ssh`)·연결 상태(`ssh_info`)·로그 경로(`ssh_log_path`)·포워드
//! (`forward_*`)·원격 워크트리 답(`worktree_answer`) — 아래 [`handle`] 의 표.
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `open_ssh` | 쓰기 | [`crate::ssh::open::OpenSsh`] → `{id, tmux, lease}` · 실패면 코드 `ssh-open` + 메시지 = `SshOpenError` JSON |
//! | `ssh_info` | 읽기 | `{id}` → `SessionInfo` |
//! | `ssh_log_path` | 읽기 | `{id}` → 경로? |
//! | `forward_list` | 읽기 | `{sessionId}` → `[ForwardInfo]` |
//! | `forward_add` | 쓰기 | `{sessionId, localPort, remoteHost, remotePort, kind?}` → `ForwardInfo`(검사·127.0.0.1 바인드는 서버) |
//! | `forward_remove` | 쓰기 | `{id}` → — |
//! | `worktree_answer` | 쓰기 | `{ticket, answer, window}` → bool |
//! | `sessions_detached` | 읽기 | → `[DetachedSession]`(③-4 — 떨어진 세션 전부: 스트림·종류·마지막 창·떨어진 시각·마지막 출력·셸/별칭·표시) |
//! | `restore_done` | 쓰기 | `{window, keep}` → `{closed, unclaimed}`(③-4 — 복원이 데려가지 않은 떨어진 세션은 **닫지 않고** 표시만) |
//! | `close_detached` | 쓰기 | `{stream}` → bool(지금 떨어져 있을 때만 닫는다) |
//! | `session_ai_read` | 쓰기 | `{stream, on}` → bool(로컬 타일의 "AI 읽기 허용" 을 세션 메타에) |
//!
//! 떨어진 세션 목록이 바뀌었을 수 있는 사건(떨어짐·붙음·표시·닫힘·떨어진 채 끝남)마다 이벤트 [`DETACHED_CHANGED`] 를 낸다(몸 없음 —
//! GUI 가 같은 이름으로 창에 중계하고 창이 목록을 다시 읽는다).
//!
//! ## 연결 = 클라이언트, 임대 = (연결, 창 라벨)
//!
//! - GUI 프로세스 하나 = 연결 하나(`server::client` — 창이 몇이든 한 연결을 나눠 쓴다). 그래서 한 스트림의 출력 프레임은
//!   이관(창 A → 창 B) 전후가 **한 줄**로 오고, GUI 는 프레임 머리의 임대 회차로 옛 창 몫을 가른다(`server::proxy` 의 경로표).
//! - 세션 코어의 `home` 은 창 라벨, 임대의 `conn` 은 연결 번호다. **연결이 끊기면**(GUI 정상 종료·kill) 그 연결의 임대를
//!   모두 푼다([`conn_gone`]) — 세션은 `Detached` 로 살고 링은 계속 적는다. 세션 종료는 명시 op(`close`·`close_window`·
//!   `close_detached`·`close_all`·서버 끝)와 셸의 자연 종료뿐이다. **복원이 데려가지 않은 세션도 닫지 않는다**(③-4 — `restore_done`
//!   은 표시만 하고 떨어진 세션 목록이 [새 탭에 붙이기]·[닫기] 를 사람에게 맡긴다).

//!
//! ## 출력과 크레딧
//!
//! 붙은 임대마다 연결 싱크([`ConnSink`])가 출력 슬롯에 꽂힌다 — 배치를 `Output{stream, sessionEpoch, leaseEpoch, offset}`
//! 프레임으로 연결 큐에 넣고, 내보낸 양을 그 임대의 [`Credit`] 에 적는다. 클라이언트의 ACK(`consumed`)가 크레딧을 돌려주고,
//! 송신 − ACK 가 예산을 넘으면 생산자(PTY 읽기 스레드)가 멈춘다(`server::credit`). 옛 임대의 ACK 는 코어의 임대 검사에서
//! 버린다. 떨어지면 싱크를 빼고(링만 적는다) 수문을 연다 — 그동안 셸의 커서 위치 질의는 서버가 답한다(`pty::pump_output`).
//!
//! ## 시청자 (원격 웹 R2-A — 판 17)
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `attach_viewer` | 쓰기 | `{stream, expectedSessionEpoch?, consumed?, window, cols?, rows?, sizeOwnerEligible?, route}` → `attach` 답 + `viewer: true` · `sizeOwner` · `ownerCols`/`ownerRows` · `ownerPrimary` |
//! | `detach_viewer` | 쓰기 | `{stream, sessionEpoch, leaseEpoch}` → bool(이미 떨어졌으면 거짓 — 멱등) |
//! | `claim_size` | 쓰기 | `{stream, sessionEpoch, leaseEpoch, cols, rows}` → `{sizeOwner}`(10-20 — 입력 없이 크기 주인 되찾기 · 셸에 쓰지 않음 · 자격 없으면 거짓) |
//!
//! 규칙은 `crate::session_core::viewers` 머리말 하나다. 여기 있는 것은 자원 쪽: 시청자마다 [`ViewerSink`](출력 머리에 GUI 경로 번호
//! `route` 를 싣는다) + [`ViewerCredit`](수문·전체 예산과 무관 — 넘치면 그 시청자만 떼고 `session-viewer-ended{reason:"overflow"}` →
//! 프런트가 다시 붙어 재동기화). 쓰기·크기·ACK 는 예전 op 가 시청자의 열쇠도 받는다(`Core::input`·`Core::resize_request`·`Core::holder`)
//! — 사람 입력이면 그 쪽이 크기 주인이 된다([`input_target`]). 코어가 쌓은 노트(크기 주인
//! 바뀜 · 시청자 떨어짐)는 op 마다 끝에서, 그리고 종료 마감·연결 끊김에서 [`settle`] 이 비운다 — 시청자 싱크·크레딧 거두기 · 질의에
//! 답하는 쪽(`output::Responder`) · 새 주인의 크기 적용 · 이벤트 [`SIZE_OWNER_EVENT`]·[`VIEWER_ENDED_EVENT`].

//!
//! ## 조각(`server/sessions/` — 2026-10-27 분할 · 바깥 경로 `server::sessions::…` 는 재수출 그대로)
//!
//! 의존 방향 `dispatch → open/attach/lifecycle → io → types`. `types.rs`(연결 문맥 · 임대 열쇠 몸 · 오류 변환) · `io.rs`(크레딧 표 · 싱크 ·
//! ACK · `plug`/`unplug` · 노트 비우기) · `lifecycle.rs`(사건 → 이벤트 · 연결 개폐 · 서버 끝 · 자원 닫기 · 떨어진 목록) · `dispatch.rs`(op 표 ·
//! `inline_op`) · `attach.rs`(붙기 · 시청자 · 떨어지기 · 이관) · `open.rs`(열기 — 셸 생성의 유일한 자리). 시험은 `sessions/tests.rs`.

// 몸이 `super::hub` · `super::ai` · `super::side_chat` 로 부르는 형제 — 조각이 부모를 거쳐 같은 이름으로 닿게.
use super::{ai, hub, producer, side_chat};

mod types;
mod io;
mod lifecycle;
mod dispatch;
mod attach;
mod open;

// 바깥에서 아직 안 부르는 것(`input_target` · `detached_rows` · `OutTx`)도 예전 경로로 이름 붙일 수 있게 그대로 내보낸다.
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
