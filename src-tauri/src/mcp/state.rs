//! MCP 관리 상태 — GUI 의 우편함 [`McpState`] · 세션 서버의 MCP 가 창을 깨우는 [`McpSignal`] · 활동 도장 [`McpActivity`].
//!
//! - 토큰을 담는 구조체는 **`Debug` 를 파생하지 않는다** — 토큰이 로그·패닉 메시지에 찍히면 안 된다.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::operations;

/// 프런트가 [`take_mcp_notice`](super::register::take_mcp_notice) 로 **한 번** 가져가면 비워진다.
#[derive(Default)]
pub struct McpState {
    pub notice: Mutex<Option<String>>,
}

/// MCP 요청 스레드가 창을 깨우는 통로 — 이벤트가 없으면 배지·카드가 30초 폴링까지 늦는다(docs/log/2026-09-22-review-request-signal.md).
///
/// 칸에는 `AppHandle` 이 아니라 클로저를 담는다 — `AppHandle` 필드를 두면 `cargo test` 실행파일이 `STATUS_ENTRYPOINT_NOT_FOUND`(0xc0000139)로 죽는다.
#[derive(Default)]
pub struct McpSignal {
    /// 비어 있으면 no-op(시험).
    pub emit: Mutex<Option<Emit>>,
}

/// `(이벤트 이름, 페이로드)` — `AppHandle` 을 가두려고 타입을 지운다([`McpSignal`] 의 링크 함정).
pub type Emit = Box<dyn Fn(&str, Value) + Send + Sync>;

impl McpSignal {
    pub fn with_emit(emit: Emit) -> Self {
        McpSignal {
            emit: Mutex::new(Some(emit)),
        }
    }

    /// `operations` 가 쓰는 것과 **같은 이름·같은 모양**(`operation-state` · `{operationId, state}`).
    pub fn emit_state(&self, operation_id: &str, state: operations::OperationState) {
        self.send(
            operations::EVT_STATE,
            json!({ "operationId": operation_id, "state": state }),
        );
    }

    fn send(&self, event: &str, payload: Value) {
        if let Ok(slot) = self.emit.lock() {
            if let Some(emit) = slot.as_ref() {
                emit(event, payload);
            }
        }
    }
}

/// 서버 op `mcp_activity` 의 계약(camelCase). 이름은 `initialize` 의 `clientInfo.name` 에서만 온다 — 뒤 요청은 [`merge_activity`](super::rpc::merge_activity) 가 지켜 준다.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpActivity {
    /// 한 번도 `initialize` 를 못 봤으면 `None`.
    pub client: Option<String>,
    /// epoch ms.
    pub at_ms: i64,
}

