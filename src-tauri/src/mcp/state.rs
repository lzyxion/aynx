//! 관리 상태 — GUI 의 [`McpState`](우편함 한 칸) · 세션 서버의 MCP 가 창을 깨우는 [`McpSignal`] · 활동 도장 [`McpActivity`].
//!
//! ③-3c 부터 MCP 서버(포트·토큰·`mcp.json`·도구)는 **세션 서버 프로세스**에 산다(`crate::server::ai`). GUI 의 `McpState` 에는
//! 좌표가 없다 — 좌표·토큰·활동 도장은 서버 op(`mcp_coords`·`mcp_token`·`mcp_activity`)로 그때그때 읽는다(`crate::server::ai_proxy`).
//!
//! 불변식:
//! - 토큰을 담는 구조체는 **`Debug` 를 파생하지 않는다** — 토큰이 로그·패닉 메시지에 찍히면 안 된다.
//! - `McpSignal` 의 칸에는 `AppHandle` 이 아니라 **내보내기 클로저**를 담는다(테스트 실행파일 링크 함정 — 지금은 서버의 이벤트
//!   방송을 가둔 클로저다).

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::operations;

// ---------------------------------------------------------------------------
// GUI 관리 상태 — 전역 등록 해제 이관의 우편함 한 칸.
// ---------------------------------------------------------------------------

/// GUI 의 `.manage()` 상태 — 전역 등록 해제 이관([`spawn_unregister_migration`](super::register::spawn_unregister_migration))이 남긴
/// 한 줄. 프런트가 [`take_mcp_notice`](super::register::take_mcp_notice) 로 **한 번** 가져가면 비워진다.
#[derive(Default)]
pub struct McpState {
    pub notice: Mutex<Option<String>>,
}

/// MCP 요청 스레드가 **창을 깨우는 통로** — 내보내기 한 칸.
///
/// 요청 스레드가 상태 표식을 바꾸면(검토 요청 · 게으른 만료) 배지·카드가 바로 따라와야 한다(이벤트가 없으면 30초 폴링까지
/// 늦는다 — docs/log/2026-09-22-review-request-signal.md). ③-3c 부터 MCP 는 세션 서버에 살아, 이 칸에는 서버의 이벤트 방송을
/// 가둔 클로저가 꽂힌다([`McpSignal::with_emit`]) — GUI(`server::client`)가 같은 이름(`operation-state`)으로 창에 중계한다.
/// 예전 우편함 칸(전역 등록 해제 이관)은 GUI 의 [`McpState`] 로 갔다.
///
/// ## ⚠️ 칸에 담는 것은 `AppHandle` 이 **아니라 클로저**다 (링크 함정)
///
/// `Mutex<Option<tauri::AppHandle>>` 을 필드로 두면 **`cargo test` 가 통째로 죽는다** —
/// `aynx_lib-*.exe` 가 실행 전에 `STATUS_ENTRYPOINT_NOT_FOUND`(0xc0000139)로 떨어진다(창 코드가 comctl32 v6 전용 심볼을
/// 끌고 들어온다). 그래서 내보내기를 **클로저 안에 가둬** 타입을 지운다(`Box<dyn Fn>`).
#[derive(Default)]
pub struct McpSignal {
    /// 서버가 뜰 때 꽂는 **내보내기 한 줄**([`Emit`]) — 세션 서버의 이벤트 방송(GUI 가 같은 이름으로 창에 중계한다). 비어
    /// 있으면 no-op(시험).
    pub emit: Mutex<Option<Emit>>,
}

/// 창으로 이벤트 하나를 내보내는 일 — `(이벤트 이름, 페이로드)`.
///
/// `AppHandle` 을 가두는 것이 요점이라 **타입이 지워져 있어야** 한다([`McpSignal`] 의 링크
/// 함정 문단).
pub type Emit = Box<dyn Fn(&str, Value) + Send + Sync>;

impl McpSignal {
    /// 내보내기를 꽂은 신호 — 세션 서버(`crate::server::ai`)가 이벤트 방송을 가둔 클로저를 넘긴다.
    pub fn with_emit(emit: Emit) -> Self {
        McpSignal {
            emit: Mutex::new(Some(emit)),
        }
    }

    /// 작업안 하나의 상태 변화를 프런트로 — `operations` 가 쓰는 것과 **같은 이름·같은 모양**
    /// (`operation-state` · `{operationId, state}`). 꽂힌 게 없으면 조용한 no-op.
    pub fn emit_state(&self, operation_id: &str, state: operations::OperationState) {
        self.send(
            operations::EVT_STATE,
            json!({ "operationId": operation_id, "state": state }),
        );
    }

    /// 꽂혀 있을 때만 내보낸다(방송 큐에 넣기 한 번이라 잠금 위에서도 짧다).
    fn send(&self, event: &str, payload: Value) {
        if let Ok(slot) = self.emit.lock() {
            if let Some(emit) = slot.as_ref() {
                emit(event, payload);
            }
        }
    }
}

/// MCP 서버가 마지막으로 처리한 요청 한 건 — 서버 op `mcp_activity`(GUI 명령 `mcp_activity`)의 계약(camelCase).
///
/// **이름은 `initialize` 에서만 온다**(`clientInfo.name`). 그 뒤의 `tools/list`·`tools/call`
/// 은 자기가 누구인지 말하지 않으므로, 앞서 적어 둔 이름을 [`merge_activity`](super::rpc::merge_activity) 가 지켜 준다.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpActivity {
    /// 붙어 있는 AI 클라이언트 이름(`"claude"` 등). 한 번도 `initialize` 를 못 봤으면 `None`.
    pub client: Option<String>,
    /// 그 요청을 처리한 시각(epoch ms).
    pub at_ms: i64,
}

