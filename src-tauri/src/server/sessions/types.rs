//! 세션 op 의 바탕 — 연결 문맥([`ConnCtx`] · 나가는 큐 [`OutTx`]) · 임대 열쇠 몸([`LeaseArgs`]) · 오류 변환(`serr` · `core_err`) ·
//! 몸 풀기(`body`) · 블로킹 풀(`blocking`). `server/sessions.rs` 에서 그대로 옮겼다.

use serde::Deserialize;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::server::ipc::frame::code;
use crate::server::ipc::{Frame, WireError};
use crate::session_core::CoreError;

/// 연결 하나의 나가는 큐 — 응답·이벤트·출력 프레임이 한 줄로 나간다. 무한 큐인 이유: 배처(표준 스레드)가 슬롯 잠금 안에서
/// 막히지 않고 넣어야 한다. 크기는 크레딧(임대당·전체 예산)이 묶는다.
pub(crate) type OutTx = mpsc::UnboundedSender<Frame>;

/// op 를 부른 연결.
#[derive(Clone)]
pub(crate) struct ConnCtx {
    pub id: u64,
    pub tx: OutTx,
    /// 이 서버의 신호 평면 포트(③-3a — `server::signal_http`). 못 띄웠으면 `None`(타일은 신호 없이 연다).
    pub signal_port: Option<u16>,
}

pub(super) fn serr(message: String) -> WireError {
    WireError::new(code::SESSION, message)
}

pub(super) fn core_err(what: &str, stream: &str, e: CoreError) -> WireError {
    serr(crate::session_core::refuse(what, stream, e))
}

pub(super) fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    serde_json::from_value(v).map_err(|e| WireError::new(code::BAD_BODY, e.to_string()))
}

pub(super) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, WireError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| serr(e.to_string()))
}

/// 임대 열쇠 셋(프런트 `SessionLease` 와 같은 이름).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeaseArgs {
    pub(super) stream: String,
    pub(super) session_epoch: u64,
    pub(super) lease_epoch: u64,
}
