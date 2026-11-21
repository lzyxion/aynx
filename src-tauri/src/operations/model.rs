//! 작업안 모델.
//!
//! 불변식: 작업안은 **메모리 전용**이다(파일에 쓰지 않는다) — 계획서는 명령·대상을 **저장만** 하고, 실행 경로는 승인
//! (Tauri 명령 전용) 뒤 executor 가 `operation_id` 로 다시 읽는다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::analysis::{Effect, PlanAnalysis};

/// camelCase 직렬화(`awaitingApproval`) — 프런트 · MCP 와 맞춘 값이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationState {
    Draft,
    AwaitingApproval,
    Rejected,
    /// 시간 초과 · 대상 세션이 옵트아웃/닫힘.
    Expired,
    Approved,
    Running,
    Succeeded,
    Partial,
    Failed,
    Cancelled,
}

impl OperationState {
    /// 승인 · 실행이 시작된 작업안은 대상 수정 · 무효화가 건드리지 못한다(실행 중 대상 세션이 닫혀도 실행은 흔들리지 않는다).
    pub(super) fn is_open(self) -> bool {
        matches!(
            self,
            OperationState::Draft | OperationState::AwaitingApproval
        )
    }
}

/// 계획서 — 저장만 하고 실행하지 않는다. 실행은 늘 순차 canary(`targets[0]` 먼저)다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub operation_id: String,
    pub command: String,
    /// `targets[0]` 가 canary 다.
    pub targets: Vec<String>,
    /// 감사는 `cd …` 로 합성하기 전의 원시 명령을 기록한다.
    pub cwd: Option<String>,
    /// canary 사후 검증 명령 — 자동 승인이면 본 명령과 같은 술어를 통과해야 한다.
    pub validate: Option<String>,
    /// 해석되지 않는 메타데이터 — 실행은 늘 순차 canary 다.
    pub mode: String,
    /// `mode` 와 같이 실행에 반영되지 않는다.
    pub strategy: String,
    pub concurrency: u32,
    /// 대상별(초).
    pub timeout_seconds: u32,
    pub state: OperationState,
    /// epoch ms.
    pub created_at: u64,
    /// epoch ms — MCP 응답의 `requestedAt`(AI 가 "언제부터 기다리는가" 를 아는 유일한 값).
    #[serde(default)]
    pub requested_at: Option<i64>,
    /// epoch ms · `None` = 만료 없음.
    #[serde(default)]
    pub expires_at: Option<i64>,
    pub title: Option<String>,
    pub reason: Option<String>,
    /// 같은 키로 다시 부르면 새 작업안 대신 기존 작업안을 돌려준다(재시도 중복 방지).
    pub idempotency_key: Option<String>,
    /// `"manual"` · `"auto"` — 감사 `approval_method` 와 같은 값.
    #[serde(default)]
    pub approval_method: Option<String>,
    /// 'YOLO' 규칙으로 넘어갔는가 — `approval_method` 는 그대로 `"auto"` 이고 이 칸이 규칙을 밝힌다(감사 `approveAll` 과 같은 값).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub approve_all: bool,
    /// 사람이 실행 도중 [취소]를 눌렀는가 — 집계 상태는 그대로(`partial` 등)이고 이 곁 사실로 알림 · 기록이 "취소됨" 이라 말한다.
    #[serde(default)]
    pub cancelled_by_user: bool,
    /// 있으면 대상은 `db:<연결 id>` 하나이고 실행은 쓰기 연결의 한 트랜잭션이다. `command` 는 표시 · 감사용 이어 붙인 글(실행기는 `db.statements`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<DbPlan>,
    /// AI 가 쓴 설명 — 믿지 않는 글자다(화면은 `AI` 표지 · 메신저는 남의 글자처럼 걷는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// AI 가 선언한 효과 — 없으면(옛 작업안) 견주지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<Effect>,
    /// 원문만 보고 만들 때 한 번 매긴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<PlanAnalysis>,
    /// 선언이 분석보다 약한가 — 참이면 검토 카드가 두 번 눌러 승인.
    #[serde(default)]
    pub mismatch: bool,
    /// 남의 글자일 수 있다(창 제목).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_by: Option<String>,
    /// 만들 때 거울에서 찾은 이름 — 창이 없을 때도 메신저가 이름을 적게.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub target_labels: std::collections::BTreeMap<String, String>,
}

/// MCP `create_db_write_plan` 이 사전 검증을 지난 뒤에만 만든다.
/// 주소 · 사용자 · 경유 별칭 · 신원 스냅샷은 직렬화하지 않는다(`identity` 는 서버 메모리에만).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlan {
    pub conn_id: String,
    pub conn_name: String,
    /// `postgres` · `mysql` · `mariadb` · `sqlite`.
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    /// 경유 별칭은 싣지 않는다.
    #[serde(default)]
    pub through_ssh: bool,
    pub statements: Vec<DbPlanStmt>,
    /// 영향 행 합의 상한 — 넘으면 커밋 전에 되돌린다.
    pub max_affected: u64,
    /// 문장마다(초).
    pub timeout_seconds: u32,
    /// 실행 직전 지금 연결과 다르면 실행하지 않는다.
    #[serde(skip)]
    pub identity: Option<crate::delegation::database::DbIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlanStmt {
    pub sql: String,
    /// 첫 낱말(대문자).
    pub keyword: String,
    #[serde(default)]
    pub counted: bool,
    /// 바꾸지만 영향 행을 세지 않는 문장(DDL · `TRUNCATE` · `WITH …`) — `maxAffected` 가 막지 못한다.
    #[serde(default)]
    pub uncounted: bool,
}

/// 감사 `db_read` 줄과 같은 꼴.
pub(crate) const DB_TARGET_PREFIX: &str = "db:";

pub(crate) fn db_target_id(conn_id: &str) -> String {
    format!("{DB_TARGET_PREFIX}{conn_id}")
}

pub(crate) fn is_db_target(id: &str) -> bool {
    id.starts_with(DB_TARGET_PREFIX)
}

pub type OperationStore = Arc<Mutex<HashMap<String, Operation>>>;

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 예측 가능한 id 를 만들지 않는다 — OS 엔트로피가 없으면 `None`(작업안을 만들지 않는다).
pub(crate) fn new_operation_id() -> Option<String> {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).ok()?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(3 + buf.len() * 2);
    s.push_str("op-");
    for &b in &buf {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    Some(s)
}
