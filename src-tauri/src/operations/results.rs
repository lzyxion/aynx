//! 대상별 결과 — [`TargetState`] · [`TargetResult`] · 결과 행렬 [`ResultStore`]/[`Results`] · 스냅샷 [`results_snapshot`].
//!
//! 불변식: 결과 행렬은 작업안 저장소와 **별개의 잠금**이다 — 둘을 겹쳐 쥐지 않는다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// 한 대상의 실행 상태 — 결과 행렬의 칸 하나. camelCase 로 직렬화된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetState {
    /// 아직 시작 전.
    Pending,
    /// 지금 exec 중.
    Running,
    /// exit 0.
    Succeeded,
    /// exit ≠ 0 이거나 전송/대상 오류.
    Failed,
    /// 타임아웃으로 채널을 닫음.
    TimedOut,
    /// 시작 전에 취소됨 — 명령이 원격에 나가기 전에 멈췄다(아무것도 실행되지 않음).
    Cancelled,
    /// 실행을 **시작한 뒤** 종료를 확인 못 함(취소·전송 손실) — 원격에서 계속 돌 수 있어 실패로 볼 수 없다.
    ///
    /// 협력적 취소는 로컬 펌프를 멈추고 채널을 떨어뜨릴 뿐, 이미 나간 명령의 원격 종료를 보장하지
    /// 않는다([`crate::ssh::run_exec`]). 그래서 exec 이 ack 된 **뒤**의 취소는 깨끗한 취소가 아니라
    /// **상태 불명**이다 — 자동 재시도의 근거가 되어선 안 된다(aynx 은 자동 재시도가 없다 · 슬라이스 A5).
    Unknown,
}

/// 한 대상의 실행 결과 — [`ResultStore`] 의 칸. `app.emit("operation-progress")` 로도 이 모양이 간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetResult {
    pub state: TargetState,
    /// 종료 코드(있으면). 타임아웃·취소·오류면 `None`.
    pub exit_code: Option<i64>,
    /// stdout tail(exec 원시가 64KB 상한을 지킨 것).
    pub stdout: String,
    /// stderr tail.
    pub stderr: String,
    /// exec 원시가 stdout 상한(64KB)을 넘어 **앞부분을 버렸는가**. 이 필드가 생기기 전 모양과
    /// 호환되도록 `default`(= false).
    #[serde(default)]
    pub stdout_truncated: bool,
    /// stderr 쪽 같은 표시.
    #[serde(default)]
    pub stderr_truncated: bool,
    /// 시작 시각(epoch ms). Running 으로 넘어갈 때 찍는다.
    pub started_at: Option<u64>,
    /// 종료 시각(epoch ms).
    pub ended_at: Option<u64>,
    /// 오류분류(사람이 읽는 짧은 사유) — 성공이면 `None`. 취소는 협력적 한계를 정직히 담는다.
    pub error_class: Option<String>,
    /// **DB 작업안의 결과**(3b — `db:` 대상만): `outcome`(`committed` · `rolledBack` · `unknown` · `disconnected` · `notRun`) · `reason` ·
    /// `message` · `maxAffected` · `totalAffected` · 문장별 `{index, keyword, affected, elapsedMs, columns?, rows?}`(행은 문장마다 20 ·
    /// 칸 1 KiB) · `failed`. 사람 화면은 전문, MCP 는 지금 읽기 권한이 있을 때만 행을 싣는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<serde_json::Value>,
}

impl TargetResult {
    /// 아직 시작 전의 빈 칸.
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

/// 대상별 결과 저장소 — `operationId → (streamId → 결과)`. 작업안 저장소와 **별개의 잠금**이다.
pub type ResultStore = Arc<Mutex<HashMap<String, HashMap<String, TargetResult>>>>;

/// 한 작업안의 대상별 결과를 **안정 순서(streamId 오름차순)** 로 스냅샷 복제한다 — 없으면 빈 벡터.
///
/// [`ResultStore`] 잠금을 **짧게** 잡고 복제만 한다(호출부는 잠금을 들고 있지 않는다). MCP 읽기
/// 도구(`get_operation_results`)가 이걸로 대상 배열을 만든다 — HashMap 순서는 매번 다르므로 id 로
/// 정렬해 결정적 순서를 준다. 집계 상태와 무관하게 **지금 있는 만큼** 돌려준다(실행 중 부분 결과도).
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
