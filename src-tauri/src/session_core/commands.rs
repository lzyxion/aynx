//! 세션 코어 × 자원 표 — **kind 무관** 명령들. 스트림 열쇠 하나로 부르고, 종류는 코어가 안다.
//!
//! **③-3b2 부터 로컬·SSH 모두 세션 서버에 산다** — GUI 프로세스의 코어는 비어 있고, 이 명령들은 같은 이름·인자·반환의 서버
//! op 프록시다(`crate::server::proxy`). 서버의 같은 연결 위에서 차례로 처리되므로(리로드의 떨어뜨리기 → 새 페이지의 붙기)
//! 순서가 선다.
//!
//! - [`detach_session`] — 창이 손을 놓는다(페이지가 떠나는 `pagehide`). 체크포인트를 함께 맡길 수 있다.
//! - [`probe_session`] — 새 페이지의 타일이 "살아 있는 세션이 있나 · 맡겨 둔 화면이 있나" 를 묻는다.
//! - [`attach_session`] — 떨어진 세션에 붙는다(새 임대 · 링 재생 · 수문 임대 · 필요할 때만 resize/window-change).
//! - [`stash_checkpoint`] — 붙어 있는 동안 주기적으로 화면을 맡긴다(30초·창이 가려질 때 — 프런트가 정한다).
//! - [`restore_done_sessions`] — 복원이 끝난 창이 "데려간 스트림" 을 알린다. 나머지 떨어진 세션은 **닫지 않고** 떨어진
//!   세션 목록에 남긴다(③-4 — 0c 전의 임시 정책 "복원이 데려가지 않은 세션 닫기" 를 걷었다).
//! - [`detached_sessions`]·[`close_detached_session`] — 떨어진 세션 목록(독·대시보드·트레이 — ③-4).
//! - [`set_session_ai_read`] — 로컬 타일의 "AI 읽기 허용" 을 세션 메타에(재부착이 되살린다 — ③-4).
//! - [`attach_session_viewer`]·[`detach_session_viewer`] — **시청자**로 붙기·떼기(원격 웹 R2-A — `session_core::viewers` 머리말). 시청자의
//!   쓰기·크기·ACK 는 예전 명령(`write_session`·`resize_session`·`ack_local_output`)에 시청자의 열쇠를 싣는다. 닫기·체크포인트·
//!   `detach_session` 은 주의 일이다(시청자의 열쇠면 `[stale-lease]`).
//!
//! **SSH 가 떨어져 있는 동안에도 사는 것**: 셸 채널(원격 셸·안의 CLI) · 전송로(풀의 자리) · 포워드(`-L`·`-R`·신호 `-R`) ·
//! 신호 토큰과 서버의 `signal/<스트림>.env` · 세션 로그 · MCP 거울. 떨어뜨리기는 출력 싱크를 빼고 수문 임대를 풀 뿐이다 —
//! 꼬리 링은 계속 적는다(`crate::output`). **GUI 연결이 끊겨도(종료·kill) 같다** — 서버가 그 연결의 임대를 푼다.

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::Checkpoint;
use crate::server::ipc::Grade;

/// 창이 손을 놓는다 — 임대 해제(세션은 산다). 체크포인트가 있으면 함께 맡긴다(그 뒤 붙는 창이 먼저 그린다).
/// 이미 떨어져 있었으면(같은 임대의 두 번째 detach) 성공이다.
#[tauri::command]
pub async fn detach_session(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    checkpoint: Option<Checkpoint>,
    release: Option<bool>,
) -> Result<(), String> {
    crate::server::proxy::detach(&stream, session_epoch, lease_epoch, checkpoint, release.unwrap_or(false)).await
}

/// 화면을 맡긴다(주기·창이 가려질 때·`beforeunload`). 그 임대여야 한다 — 막 떨어진 같은 임대도 받는다.
#[tauri::command]
pub async fn stash_checkpoint(
    stream: String,
    session_epoch: u64,
    lease_epoch: u64,
    checkpoint: Checkpoint,
) -> Result<(), String> {
    crate::server::proxy::call(
        Grade::Write,
        "checkpoint",
        serde_json::json!({
            "stream": stream,
            "sessionEpoch": session_epoch,
            "leaseEpoch": lease_epoch,
            "checkpoint": checkpoint,
        }),
    )
    .await
    .map(|_| ())
}

/// 새 페이지의 타일이 묻는다 — 이 스트림이 살아 있나(종류·상태), 맡겨 둔 화면(같은 회차)이 있나. 세션 서버에 묻는다 —
/// 서버에 닿지 못하면 "없음"(새로 연다). `kind` 는 예전 계약의 인자(이제 쓰지 않는다 — SSH 도 서버에 산다).
#[tauri::command]
pub async fn probe_session(stream: String, kind: Option<String>) -> Value {
    let _ = kind;
    match crate::server::proxy::probe(&stream).await {
        Some(v) => v,
        None => serde_json::json!({ "state": "none" }),
    }
}

/// 떨어진 세션에 **이 창이** 붙는다(서버 op `attach` — 로컬·SSH 같은 몸).
///
/// - **로컬**: 크기가 다르거나 링이 넘쳤으면 resize(ConPTY·TUI 재그림). 같은 크기·이어짐이면 resize 하지 않는다.
/// - **SSH**: 크기를 받았으면 `window-change` 를 보낸다(원격 커널은 같은 크기면 SIGWINCH 를 내지 않는다). 원격 autorun·
///   셸 통합 스니펫·훅 설치는 다시 보내지 않는다(그것은 새 접속의 일 — `crate::ssh::open`).
///
/// 다른 창이 붙어 있으면 거절(`take` 면 빼앗는다 — 옛 임대는 즉시 낡는다). `cols`·`rows` 가 없으면 크기를 건드리지 않는다.
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약(`open_local_session` 과 같은 이유)
#[tauri::command]
pub async fn attach_session(
    webview: tauri::Webview,
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    take: Option<bool>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    crate::server::proxy::attach(
        &label,
        &stream,
        expected_session_epoch,
        consumed,
        take,
        on_data,
        cols,
        rows,
    )
    .await
}

/// **시청자로 붙는다**(원격 웹 R2-A — 서버 op `attach_viewer`) — 주 임대를 빼앗지 않고 같은 세션을 함께 본다(주가 없어도 된다). 답은
/// [`attach_session`] 과 같은 모양 + `viewer: true` · `sizeOwner`(이 쪽이 지금 크기 주인 — 터미널 질의에 답할 쪽). `sizeOwnerEligible`
/// (기본 참)이 거짓이면 쳐도 크기 주인이 되지 않는다(폰 — R5). 크기 주인이 아닐 때의 `resize_session` 은 적어 두기만 한다.
#[allow(clippy::too_many_arguments)] // 인자 이름 = 프런트 invoke 계약
#[tauri::command]
pub async fn attach_session_viewer(
    webview: tauri::Webview,
    stream: String,
    expected_session_epoch: Option<u64>,
    consumed: Option<u64>,
    on_data: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
    size_owner_eligible: Option<bool>,
) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    crate::server::proxy::attach_viewer(
        &label,
        &stream,
        expected_session_epoch,
        consumed,
        on_data,
        cols,
        rows,
        size_owner_eligible,
    )
    .await
}

/// 시청자가 제 시청을 끝낸다(서버 op `detach_viewer`) — 세션은 그대로. 이미 떨어졌으면(예산 초과로 서버가 먼저 뗐다) `false`.
#[tauri::command]
pub async fn detach_session_viewer(stream: String, session_epoch: u64, lease_epoch: u64) -> Result<bool, String> {
    crate::server::proxy::detach_viewer(&stream, session_epoch, lease_epoch).await
}

/// **복원이 끝났다** — 이 창이 다시 그린 타일들의 스트림(`keep`)을 받는다(서버 op `restore_done`). 이 창이 책임지는 떨어진
/// 세션 중 그 밖의 것은 **닫지 않고** "복원이 데려가지 않음" 으로 표시해 떨어진 세션 목록에 남긴다 — 끝난 잔해만 거둔다.
/// 서버에 닿지 못하면 `{closed:0, unclaimed:0}`(다음 복원이 다시 본다).
#[tauri::command]
pub async fn restore_done_sessions(webview: tauri::Webview, keep: Vec<String>) -> Result<Value, String> {
    let label = webview.window().label().to_string();
    Ok(crate::server::proxy::call(
        Grade::Write,
        "restore_done",
        serde_json::json!({ "window": label, "keep": keep }),
    )
    .await
    .unwrap_or_else(|_| serde_json::json!({ "closed": 0, "unclaimed": 0 })))
}

/// **떨어진 세션 목록**(③-4 — 독·대시보드·트레이) — 서버의 떨어진 세션 중 "아무 창도 데려가지 않은 것" 만: 책임 창이 복원을
/// 마치며 데려가지 않았거나(`unclaimed`), 책임 창이 지금 이 GUI 에 없다(트레이 · 떼어 낸 창을 잃음). 리로드 중인 창의 세션처럼
/// 곧 다시 붙을 것은 빠진다. 프런트는 창 목록을 몰라도 된다(`homeOpen` 은 참고용). 서버에 닿지 못하면 빈 목록.
#[tauri::command]
pub async fn detached_sessions(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    Ok(crate::server::proxy::detached_visible(&app).await)
}

/// 떨어진 세션 하나를 닫는다(목록의 [닫기]) — 서버가 **지금 떨어져 있을 때만** 닫는다(그 사이 누가 붙었으면 `false`).
#[tauri::command]
pub async fn close_detached_session(stream: String) -> Result<bool, String> {
    crate::server::proxy::call(Grade::Write, "close_detached", serde_json::json!({ "stream": stream }))
        .await
        .map(|v| v.as_bool().unwrap_or(false))
}

/// 로컬 타일의 "AI 읽기 허용" 을 세션 메타에 적는다 — GUI 가 다시 켜져 그 세션에 붙는 타일이 되살린다(`probe` 의 `aiRead`).
#[tauri::command]
pub async fn set_session_ai_read(stream: String, on: bool) -> Result<(), String> {
    crate::server::proxy::call(Grade::Write, "session_ai_read", serde_json::json!({ "stream": stream, "on": on }))
        .await
        .map(|_| ())
}
