//! 대상별 결과.
//!
//! 불변식: 결과 행렬은 작업안 저장소와 **별개의 잠금**이다 — 둘을 겹쳐 쥐지 않는다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetState {
    Pending,
    Running,
    Succeeded,
    Failed,
    TimedOut,
    /// 명령이 원격에 나가기 전에 멈췄다(아무것도 실행되지 않음).
    Cancelled,
    /// 시작한 뒤 종료를 확인 못 함 — 협력적 취소는 원격 종료를 보장하지 않아 계속 돌 수 있다. 자동 재시도의 근거가 되어선 안 된다.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetResult {
    pub state: TargetState,
    pub exit_code: Option<i64>,
    /// 꼬리(64KB 상한).
    pub stdout: String,
    pub stderr: String,
    /// 이 칸이 생기기 전 모양과 호환되도록 `default`.
    #[serde(default)]
    pub stdout_truncated: bool,
    #[serde(default)]
    pub stderr_truncated: bool,
    /// epoch ms.
    pub started_at: Option<u64>,
    pub ended_at: Option<u64>,
    pub error_class: Option<String>,
    /// `db:` 대상만 — 사람 화면은 전문, MCP 는 지금 읽기 권한이 있을 때만 행을 싣는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<serde_json::Value>,
}

impl TargetResult {
    pub(super) fn pending() -> Self {
        TargetResult {
            state: TargetState::Pending,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
            started_at: None,
            ended_at: None,
            error_class: None,
            db: None,
        }
    }
}

/// `operationId → (streamId → 결과)`.
pub type ResultStore = Arc<Mutex<HashMap<String, HashMap<String, TargetResult>>>>;

/// streamId 오름차순 — 실행 중 부분 결과도 지금 있는 만큼.
pub(crate) fn results_snapshot(
    store: &ResultStore,
    operation_id: &str,
) -> Vec<(String, TargetResult)> {
    let Ok(map) = store.lock() else {
        return Vec::new();
    };
    let Some(per) = map.get(operation_id) else {
        return Vec::new();
    };
    let mut v: Vec<(String, TargetResult)> =
        per.iter().map(|(k, r)| (k.clone(), r.clone())).collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}
