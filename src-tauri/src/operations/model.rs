//! 작업안 모델 — [`OperationState`](상태 열) · [`Operation`](계획서 한 장) · 저장소 [`OperationStore`]/[`Operations`] ·
//! 시각 [`now_ms`] · 작업안 id [`new_operation_id`].
//!
//! 불변식: 작업안은 **메모리 전용**이다(파일에 쓰지 않는다) — 계획서는 명령·대상을 **저장만** 하고, 실행 경로는 승인
//! (Tauri 명령 전용) 뒤 executor 가 `operation_id` 로 다시 읽는다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::analysis::{Effect, PlanAnalysis};

/// 작업안의 상태.
///
/// **단계 8 까지는 넷**(Draft·AwaitingApproval·Rejected·Expired)뿐이었다 — executor 가 없다는
/// 사실을 타입이 강제했다. **단계 9(실행 브로커)가 실행 상태를 더한다**: 사용자가 앱에서 승인하면
/// (Tauri 명령 [`approve_operation`](super::approval::approve_operation), **MCP 아님**) `AwaitingApproval → Approved → Running` 으로
/// 가고, executor 가 대상별 결과를 모아 `Succeeded`/`Partial`/`Failed`/`Cancelled` 로 봉한다.
///
/// 실행 상태를 더해도 **불변은 그대로다**: 승인/실행 경로는 MCP 에 없고(AI 는 닿지 못한다),
/// executor 는 저장된 작업안의 `operation_id` 로 `command`·`targets` 를 읽을 뿐 명령 문자열을
/// 다시 받지 않는다(AI 재주입 차단 · CLAUDE.md).
///
/// camelCase 로 직렬화된다(`awaitingApproval`) — 프런트·MCP 계약과 같은 관례.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationState {
    /// 방금 만들어진 초안 — 아직 사용자 검토를 요청하지 않았다.
    Draft,
    /// 검토 요청됨 — 사용자가 보고 거절하거나 대상을 고칠 수 있다. **승인/실행은 없다.**
    AwaitingApproval,
    /// 사용자가 거절함(종료 상태).
    Rejected,
    /// 대상 세션이 옵트아웃/닫혀 더는 유효하지 않다(종료 상태 — [`invalidate_for_target`]).
    Expired,
    /// **사용자가 승인함**(단계 9). executor 가 곧 실행을 시작한다 — 이미 "열린" 상태가 아니다.
    Approved,
    /// **실행 중**(단계 9). 대상별 결과가 [`ResultStore`] 에 쌓이는 중이다.
    Running,
    /// 모든 대상이 성공(exit 0).
    Succeeded,
    /// 일부만 성공(성공·실패가 섞임).
    Partial,
    /// 성공한 대상이 하나도 없다(실패·타임아웃·오류).
    Failed,
    /// 실행이 취소되어 성공한 대상이 없다(남은 대상은 취소됨).
    Cancelled,
}

impl OperationState {
    /// 아직 사용자가 손댈 수 있는 상태인가(= 검토 단계). 전이·수정·무효화가 이걸로 게이트한다.
    ///
    /// **실행 상태(Approved/Running)와 종료 상태(성공/부분/실패/취소/거절/만료)는 열려 있지 않다** —
    /// 승인·실행이 시작된 작업안을 대상 수정·무효화가 건드리지 못하게 하는 것이 단계 9 의 요점이다
    /// (실행 중 대상 세션이 닫혀 [`invalidate_for_target`] 가 돌아도 실행은 흔들리지 않는다).
    pub(super) fn is_open(self) -> bool {
        matches!(
            self,
            OperationState::Draft | OperationState::AwaitingApproval
        )
    }
}

/// 작업안 하나 — "이 명령을, 이 대상들에, 이렇게 돌리자" 는 **계획서**(실행되지 않는다).
///
/// `command`·`targets` 는 무엇을/어디에, `cwd` 는 어느 디렉터리에서, `mode`/`strategy`/
/// `concurrency`/`timeout_seconds` 는 어떻게(자유 문자열·숫자). `title`/`reason` 은 AI 가
/// 사람에게 남기는 설명이다.
///
/// ## 실행 방식은 **항상 순차 canary 로 강제**된다 (mode/strategy 는 해석되지 않는 메타데이터)
///
/// executor([`execute`])는 언제나 **`targets[0]` 를 canary 로 홀로 먼저** 돌리고, 그것이
/// **종료 코드 0**(성공 조건은 exit 0 뿐이다 — 서비스 정상 여부까지 보장하지 않는다)이어야만
/// 나머지를 `concurrency` 만큼 동시에 돌린다([`canary_proceed`]). `mode`·`strategy` 는 AI 가
/// 남기는 **자유 문자열 메타데이터일 뿐 실행에 반영되지 않는다** — 어떤 값이 오든 실행은 순차
/// canary 로 고정이다(이 모듈은 그 둘을 해석하지 않고 저장·표시만 한다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    /// 이 작업안의 불투명 식별자(crypto 난수 — [`new_operation_id`]).
    pub operation_id: String,
    /// 돌릴 명령문 그대로. **저장만 한다** — 실행하지 않는다.
    pub command: String,
    /// 대상 세션들 — [`crate::context`] 저장소 키(=streamId)다. MCP `list_sessions` 의 `id`.
    ///
    /// **`targets[0]` 가 canary 다** — executor 가 이 첫 대상을 홀로 먼저 돌리고, exit 0 이어야만
    /// 나머지로 번진다([`execute`]·[`canary_proceed`]).
    pub targets: Vec<String>,
    /// 실행 작업 디렉터리(선택). `Some(dir)` 이면 exec 채널에서 `cd -- <dir> && ( 명령 )` 으로
    /// 그 디렉터리에서 돌린다([`compose_command`]) — SSH `exec` 는 원격 로그인 셸을 거치므로
    /// 이 합성이 통한다. `None` 이면 로그인 기본 디렉터리에서 돈다. **감사는 합성 전 원시 명령을
    /// 기록한다**(이 `cd …` 래퍼가 아니라).
    pub cwd: Option<String>,
    /// canary 사후 검증 명령(선택) — canary 성공 뒤 canary 대상에서 실행해 **exit 0 이어야** 나머지로
    /// 번진다. exit 0 ≠ 서비스 정상이므로 이걸로 실제 상태를 확인한다([`execute`]). `None` 이면 검증
    /// 없이 canary exit 0 만으로 번진다(예전 그대로). 자동 승인일 때는 이 명령도 본 명령과 같은
    /// 안전 술어를 통과해야 한다([`approval_reject_reason`]).
    pub validate: Option<String>,
    /// 실행 방식(자유 문자열 — **해석되지 않는 메타데이터**다. 실행은 항상 순차 canary 로 강제되고
    /// 이 값은 반영되지 않는다 — 위 struct 주석 참고).
    pub mode: String,
    /// 전개 전략(자유 문자열 — `mode` 와 같이 **해석되지 않는 메타데이터**. 실행에 반영되지 않는다).
    pub strategy: String,
    /// 동시 실행 수(저장만).
    pub concurrency: u32,
    /// 대상별 타임아웃(초, 저장만).
    pub timeout_seconds: u32,
    /// 현재 상태 — 넷 중 하나.
    pub state: OperationState,
    /// 만들어진 시각(epoch ms).
    pub created_at: u64,
    /// **검토를 요청한 시각**(epoch ms) — [`request`] 가 찍는다. 아직 요청 전(Draft)이면 `None`.
    ///
    /// AI 가 "언제부터 기다리는 중인가" 를 알 수 있는 유일한 값이다(MCP 응답에 `requestedAt`
    /// 으로 실린다 — docs/log/2026-09-21-approval-ttl.md).
    #[serde(default)]
    pub requested_at: Option<i64>,
    /// **이 검토 요청이 만료되는 시각**(epoch ms). `None` = 만료 없음.
    ///
    /// [`request`] 가 `requested_at + TTL`(`[automation] approval_ttl_minutes`)로 찍는다 —
    /// TTL 이 `0`(만료 없음)이면 `None` 이다. 시계는 없고, 저장소를 **읽거나 전이할 때 그
    /// 자리에서** [`expire_stale`] 이 이 값을 지난 대기를 만료시킨다.
    #[serde(default)]
    pub expires_at: Option<i64>,
    /// 사람이 읽는 제목(AI 가 붙인다, 선택).
    pub title: Option<String>,
    /// 이 작업안의 이유(AI 가 붙인다, 선택).
    pub reason: Option<String>,
    /// 멱등 키(선택) — AI 가 요청마다 한 번 생성하는 고유 토큰. 같은 키로 다시 부르면 새 작업안을
    /// 만들지 않고 **기존 작업안을 돌려준다**(재시도로 중복 저장·중복 실행 방지).
    pub idempotency_key: Option<String>,
    /// **어떻게 승인됐나** — `"manual"`(사람이 앱에서 눌렀다) · `"auto"`(자동 승인 정책).
    /// 승인 전이면 `None`. [`approve`] 가 감사 기록(`AuditRecord.approval_method`)과 **같은 값**을
    /// 찍는다. 앱의 실행 결과 알림이 자동 승인으로 돈 실행에 `자동` 표식을 붙이는 근거다
    /// (docs/log/2026-09-28-run-result-notify.md). 비밀이 아니라 MCP 응답에도 그대로 실린다.
    #[serde(default)]
    pub approval_method: Option<String>,
    /// **'YOLO' 로 자동 승인됐는가**(2026-10-23) — 대상이 전부 단계 'YOLO' 라 명령 정책 · 빈도 한도 없이 넘어갔다
    /// ([`approve_all_plan`](super::approve_all_plan)). `approval_method` 는 그대로 `"auto"` 다(알림 · 기록의 '자동' 표식이 같이 선다) —
    /// 이 칸은 그 위에 "어떤 규칙으로" 를 밝힌다(감사 `approveAll` 과 같은 값).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub approve_all: bool,
    /// **사람이 실행 도중 [취소]를 눌렀는가** — [`cancel_operation`](super::approval::cancel_operation) 이 도는 실행에만 찍는다.
    ///
    /// 집계 상태([`aggregate`])는 그대로다 — 일부가 성공하고 나머지가 시작 전에 취소되면 여전히
    /// `partial` 로 봉한다(MCP·AI 가 읽는 뜻을 바꾸지 않는다). 이것은 **곁 사실**이다: 앱의 결과 알림과
    /// 기록이 그 `partial` 을 `일부 실패` 가 아니라 `취소됨` 으로 말하는 근거다(모양으로 짐작하지 않는다 —
    /// docs/log/2026-09-28-run-history.md "사람의 취소").
    #[serde(default)]
    pub cancelled_by_user: bool,
    /// **DB 쓰기 작업안**(쿼리 타일 3단계 3b) — 있으면 이 작업안의 대상은 `db:<연결 id>` **하나**이고, 실행은 SSH exec 가 아니라
    /// 세션 서버가 따로 연 쓰기 연결의 **한 트랜잭션**이다([`DbPlan`] · `operations::db_exec`). `command` 는 문장들을 이어 붙인 글(표시 ·
    /// 감사용 — 실행기는 `db.statements` 를 쓴다). 자동 승인은 연결이 'YOLO' 일 때뿐이다(`approve_in` 이 그 밖의 `auto` 를 거부).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<DbPlan>,
    /// **AI 가 쓴 설명**(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 사람에게 보이는 평문(제어 글자를 걷고 300자에서 자름 ·
    /// [`clean_summary`](super::analysis::clean_summary)). **믿지 않는 글자다** — 화면은 `AI` 표지를 붙여 그리고, 메신저는 남의 글자처럼
    /// 걷는다. 옛 작업안 · 서버 안에서 만든 작업안에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// AI 가 **선언한** 효과(`read` · `write` · `delete`). 없으면(옛 작업안) 견주지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<Effect>,
    /// **앱 분석** — 원문(명령 · 검증 명령 · DB 문장)만 보고 만들 때 한 번 매긴다([`super::analysis`]). 원문은 검토에서 바뀌지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<PlanAnalysis>,
    /// **선언이 분석보다 약한가**(읽기 < 쓰기 < 삭제 · 확인 필요는 적어도 쓰기) — 참이면 검토 카드가 실패색 테두리 · 두 번 눌러 승인,
    /// 메신저는 주의 줄.
    #[serde(default)]
    pub mismatch: bool,
    /// 요청한 AI 타일의 이름표(타일 토큰으로 왔고 거울에 그 타일이 있을 때 — 메신저의 "요청" 줄). 남의 글자일 수 있다(창 제목).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_by: Option<String>,
    /// 대상 id → 사람이 읽는 이름(만들 때 거울에서 찾은 호스트 별칭 · 라벨 — 창이 없을 때도 메신저가 이름을 적게). 대상을 좁혀도
    /// 남은 id 의 이름만 쓴다.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub target_labels: std::collections::BTreeMap<String, String>,
}

/// DB 쓰기 작업안의 몸(3b) — MCP `create_db_write_plan` 이 사전 검증(`db::ai_plan::check`)을 지난 뒤에만 만든다.
///
/// 직렬화되는 칸은 검토 카드와 AI 가 함께 보는 것뿐이다 — 연결 이름 · 엔진 · DB 이름 · 경유 여부 · 문장 · 상한. **주소 · 사용자 · 경유
/// 별칭 · 신원 스냅샷은 싣지 않는다**(3a `list_db_connections` 와 같은 규칙 — `identity` 는 `serde(skip)`: 서버 메모리에만 있고 실행 직전에
/// 지금 연결과 맞춰 본다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlan {
    /// `db-connections.json` 의 연결 id(= MCP 의 `connId`).
    pub conn_id: String,
    /// 만들 때의 연결 이름(표시용).
    pub conn_name: String,
    /// `postgres` · `mysql` · `mariadb` · `sqlite`.
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    /// SSH 경유로 닿는 연결인가(별칭은 싣지 않는다 — 화면은 자기 연결 목록에서 찾는다).
    #[serde(default)]
    pub through_ssh: bool,
    /// 검증을 지난 문장들(차례대로 한 트랜잭션).
    pub statements: Vec<DbPlanStmt>,
    /// 문장들의 영향 행 합의 상한 — 넘으면 커밋 전에 되돌린다.
    pub max_affected: u64,
    /// 문장마다의 시간 제한(초).
    pub timeout_seconds: u32,
    /// 만들 때의 신원 스냅샷(엔진 · 경유 · 주소 · 포트 · DB · 사용자 · 파일) — 실행 직전 지금 연결과 다르면 실행하지 않는다.
    #[serde(skip)]
    pub identity: Option<crate::delegation::database::DbIdentity>,
}

/// DB 작업안의 문장 하나.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlanStmt {
    pub sql: String,
    /// 첫 낱말(대문자).
    pub keyword: String,
    /// 엔진이 영향 행을 세는 문장(`maxAffected` 가 막을 수 있다).
    #[serde(default)]
    pub counted: bool,
    /// 바꾸지만 영향 행을 세지 않는 문장(DDL · `TRUNCATE` · `WITH …` — `maxAffected` 가 막지 못한다).
    #[serde(default)]
    pub uncounted: bool,
}

/// DB 대상 id 의 앞머리 — `db:<연결 id>`(감사 `db_read` 줄과 같은 꼴).
pub(crate) const DB_TARGET_PREFIX: &str = "db:";

/// 연결 id → 작업안 대상 id.
pub(crate) fn db_target_id(conn_id: &str) -> String {
    format!("{DB_TARGET_PREFIX}{conn_id}")
}

/// DB 대상 id 인가(세션 streamId 는 이 앞머리를 갖지 않는다).
pub(crate) fn is_db_target(id: &str) -> bool {
    id.starts_with(DB_TARGET_PREFIX)
}

/// 저장소 본체 — 키는 [`Operation::operation_id`].
pub type OperationStore = Arc<Mutex<HashMap<String, Operation>>>;

/// 지금 epoch ms — [`Operation::created_at`] 이 쓴다(시계가 이전이면 0).
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// crypto 난수 작업안 id (`op-` + 16바이트 hex). OS 엔트로피가 없으면 `None` —
/// 부르는 쪽은 작업안을 만들지 않고 오류를 낸다([`crate::mcp`]).
///
/// tear 토큰·MCP 토큰과 같은 방식([`getrandom`])이다 — 예측 가능한 id 를 만들지 않는다.
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
