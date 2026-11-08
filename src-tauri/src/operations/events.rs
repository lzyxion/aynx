//! 프런트로 나가는 이벤트 — 이름 [`EVT_STATE`]·`EVT_PROGRESS` · 실행 환경 [`OpEnv`] · 결과 칸 갈아 끼우기+emit [`store_and_emit`].
//!
//! 불변식: 이벤트 이름은 **한 벌**이다 — MCP 요청 스레드도 [`EVT_STATE`] 상수를 그대로 쓴다. ③-3c 부터 작업안 저장소·실행기는
//! **세션 서버 프로세스**에 살아, 내보내기는 서버의 이벤트 방송이고 GUI(`server::client`)가 같은 이름으로 창에 중계한다.

use std::sync::Arc;

use serde_json::Value;

use super::*;

/// 진행/집계를 프런트로 밀어 올리는 이벤트 이름. `operation-progress` 는 대상 칸 하나가,
/// `operation-state` 는 작업안 집계 상태가 바뀔 때 나간다.
pub(crate) const EVT_PROGRESS: &str = "operation-progress";
/// `pub(crate)` 인 이유: MCP 요청 스레드도 같은 이름으로 내보낸다(검토 요청·MCP 경로 만료 —
/// [`crate::mcp::McpSignal::emit_state`]). 이름이 두 벌이 되면 프런트가 한쪽을 못 듣는다.
pub(crate) const EVT_STATE: &str = "operation-state";

/// 이벤트 하나를 내보내는 손 — `(이름, 몸)`. 서버는 이벤트 방송을, 시험은 기록기를 꽂는다(`AppHandle` 을 쥐지 않는다 — 링크 함정).
pub(crate) type EmitFn = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// 실행기·승인이 드는 **환경** — 내보내기 · 컨텍스트 거울(권한 재검사·감사 라벨) · 라우팅 표(대상 → 살아 있는 SSH).
/// 예전에는 `tauri::AppHandle` 의 `emit`·`state` 였다(③-3c 에서 세션 서버로 오며 갈음).
#[derive(Clone)]
pub(crate) struct OpEnv {
    pub emit: EmitFn,
    pub ctx: crate::context::Store,
    pub routing: crate::routing::RoutingTable,
}

impl OpEnv {
    pub(crate) fn emit(&self, name: &str, body: Value) {
        (self.emit)(name, body);
    }
}

/// 결과 저장소의 한 칸을 갈아 끼우고 그 칸을 프런트로 emit 한다.
pub(super) fn store_and_emit(
    env: &OpEnv,
    results: &ResultStore,
    operation_id: &str,
    stream_id: &str,
    result: TargetResult,
) {
    if let Ok(mut map) = results.lock() {
        map.entry(operation_id.to_string())
            .or_default()
            .insert(stream_id.to_string(), result.clone());
    }
    env.emit(
        EVT_PROGRESS,
        serde_json::json!({ "operationId": operation_id, "streamId": stream_id, "result": result }),
    );
}
