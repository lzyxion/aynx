//! 작업안 이벤트 — 세션 서버가 방송하고 GUI 가 같은 이름으로 창에 중계한다.

use std::sync::Arc;

use serde_json::Value;

use super::*;

pub(crate) const EVT_PROGRESS: &str = "operation-progress";
/// MCP 요청 스레드도 이 상수로 내보낸다 — 이름이 두 벌이 되면 프런트가 한쪽을 못 듣는다.
pub(crate) const EVT_STATE: &str = "operation-state";

/// `AppHandle` 을 쥐지 않는다(링크 함정) — 서버는 이벤트 방송을, 시험은 기록기를 꽂는다.
pub(crate) type EmitFn = Arc<dyn Fn(&str, Value) + Send + Sync>;

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
