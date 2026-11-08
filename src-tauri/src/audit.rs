//! 감사 로그 — 로드맵 **단계 10a**. 승인된 작업안이 실행될 때 **명령·대상·승인 방식·시각·
//! 결과**를 로컬 파일에 append 하는 **순수 부가 기록**이다.
//!
//! ```text
//!   approve_operation ──► [approved 레코드] ──┐
//!   executor finalize ──► [finished 레코드] ──┴─► audit 쓰기 스레드 ──► <data_dir>/aynx/audit/audit-<YYYYMMDD>.jsonl
//! ```
//!
//! ## 청사진은 [`crate::session_log`]
//!
//! 같은 뼈대다 — **전용 std 쓰기 스레드 + 채널**(런타임을 굶기지 않는다), 유닉스 파일 권한
//! `0o600`([`session_log`] 가 하는 그대로), **쓰기 실패가 실행을 막지 않는다**(채널 send 는
//! 실패해도 삼키고, 스레드 쪽 오류는 경고 한 줄).
//!
//! ## 왜 별도 스레드인가
//!
//! 계측 지점([`crate::operations`] 의 `approve_operation`·`finalize`)은 UI 스레드/executor
//! 태스크 위다. 거기서 파일에 직접 쓰면 디스크가 느릴 때 그 경로가 물린다. 그래서
//! [`session_log`] 와 똑같이 전용 스레드에 채널로 넘긴다 — 부르는 쪽은 `send` 한 번이다.
//!
//! ## 기본 켬
//!
//! 세션 로깅과 달리 감사는 **옵트인이 아니다**("모든 실행을 기록"이 불변). 다만 파일을 못 쓰는
//! 것은 무해하다 — 폴더를 못 만들면 로거가 조용히 꺼지고([`Audit::tx`] = `None`) 실행은 그대로다.
//!
//! ## 자격증명은 별도로 담지 않는다
//!
//! 명령줄(`command`)은 **그대로** 기록한다 — 무엇을 실행했는지가 감사의 목적이다. 그러나
//! 비밀번호·키를 담는 **별도 필드는 만들지 않는다**(보안 불변 · CLAUDE.md).
//!
//! ## 사람이 읽는 장부 — 실행 기록 화면 (2026-09-28)
//!
//! 대시보드 작업안 칸의 **기록** 보기가 이 로그를 읽는다([`audit_runs`] — `approved`·`finished` 두
//! 줄을 `operationId` 로 묶어 한 실행으로 돌려준다). 그 화면을 위해 선택 칸이 붙었다: 승인 줄의
//! 제목·경로·검증 명령, 대상별 결과의 시작·끝 시각, 그리고 **옵트인** 출력 발췌
//! (`[automation] audit_output_excerpt`, 기본 끔 — [`tail_excerpt`]). 모두 `serde(default)` 라 옛 줄도
//! 그대로 읽힌다. **보관 기간**(`[automation] audit_retention_days`, 기본 90일, 0 = 지우지 않음)은
//! 쓰기 스레드가 앱 시작과 날짜가 바뀐 첫 쓰기에서 지난 날짜 파일을 통째로 지운다
//! ([`expired_audit_files`]). 감사 자체는 여전히 옵트인이 아니다 — 보관 기간은 기록을 끄는 칸이
//! 아니라 오래된 파일을 치우는 칸이다 (docs/log/2026-09-28-run-history.md).
//!
//! ## AI 의 DB 읽기 (쿼리 타일 3a)
//!
//! MCP DB 도구(`mcp::db`)의 호출도 같은 쓰기 스레드로 한 줄씩 남긴다(`event: "db_read"` — [`AuditRecord::db_read`] · 칸
//! [`AuditDbRead`]: 도구 · 연결 · SQL/인자 · 행 수 · ms · 결과 코드). 셸 읽기(`get_scrollback`)는 감사하지 않지만 DB 읽기는 "무엇이
//! 모델 제공자로 나갔나" 를 되짚을 유일한 길이다. **결과 값은 남기지 않는다** — 칸이 없다. 실행 기록 화면(`join_runs`)은 이 줄을 건너뛴다.
//!
//! ## 단계 10b(자동 승인) 전제
//!
//! [`AuditRecord::approval_method`] 는 지금 언제나 `"manual"`(사람이 앱에서 승인)이다. 정책
//! 기반 자동 승인이 생기는 단계 10b 에서 같은 자리에 `"auto"` 가 들어오도록 문자열로 열어 둔다.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// 지금 epoch ms — 쓰기 성공 시각([`AuditHealth::last_ok_at`])이 쓴다.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `<data_dir>/aynx/audit`.
///
/// [`crate::session_log::logs_dir`] 이 `<data_dir>/aynx/logs` 를 쓰는 것과 같은 헬퍼(`dirs::data_dir`)
/// 다 — 로그·감사 모두 사용자가 손으로 고치는 설정이 아니라 앱이 쌓는 **데이터**다.
pub(crate) fn audit_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("audit"))
}

/// 오늘 날짜(`YYYYMMDD`, 로컬) — 파일 이름에만 쓴다.
fn today_stamp() -> String {
    chrono::Local::now().format("%Y%m%d").to_string()
}

/// `audit-<YYYYMMDD>.jsonl` — **순수 함수**(유닛 테스트 대상). 날짜별 파일이라 파일 하나가
/// 무한히 커지지 않고, 파일 이름만 보고 언제 것인지 안다([`session_log`] 의 날짜 스탬프 관행).
pub(crate) fn audit_file_name(date: &str) -> String {
    format!("audit-{date}.jsonl")
}

/// 한 대상의 실행 결과 요약 — [`AuditRecord::results`] 의 칸 하나. camelCase 로 직렬화된다.
///
/// [`crate::operations::TargetResult`] 전체가 아니라 감사에 필요한 칸만 담는다: 어느
/// 세션(`stream_id`)이 어떤 상태(`state`)로, 어떤 종료 코드(`exit_code`)로, 언제(`started_at`·
/// `ended_at`) 끝났는가. 출력 꼬리(`stdout_tail`·`stderr_tail`)는 **설정을 켠 경우에만**
/// 실린다(`[automation] audit_output_excerpt`, 기본 끔 — [`tail_excerpt`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTargetResult {
    /// 대상 세션 id(= [`crate::operations::Operation::targets`] 의 항목 = 거울 streamId).
    pub stream_id: String,
    /// 대상 상태(camelCase 문자열 — `crate::operations::TargetState` 의 직렬화형).
    pub state: String,
    /// 종료 코드(있으면). 타임아웃·취소·오류·미시작이면 `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    /// 시작 시각(epoch ms). 시작 전에 취소된 대상은 없다 — 기록 화면의 canary 멈춤 판정이 이 빈칸을
    /// 읽는다(결과 알림의 `isCanaryStop` 과 같은 규칙). 2026-09-28 전의 줄에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// 종료 시각(epoch ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    /// stdout 꼬리 — **출력 발췌 설정을 켰고** 그 대상이 AI 읽기 공유 중일 때만([`tail_excerpt`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout_tail: Option<String>,
    /// stderr 꼬리 — 위와 같은 조건.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr_tail: Option<String>,
}

/// 출력 발췌의 **줄 상한** — 스트림마다·대상마다 마지막 40줄.
pub const EXCERPT_MAX_LINES: usize = 40;
/// 출력 발췌의 **바이트 상한** — 스트림마다·대상마다 4 KB. 줄 상한과 **둘 다** 건다(긴 한 줄이
/// 40줄 상한을 뚫고 파일을 키우지 못하게). 대상 20곳 × 두 스트림이면 한 실행이 최대 160 KB 다.
pub const EXCERPT_MAX_BYTES: usize = 4096;

/// 출력 한 스트림의 **꼬리 발췌** — 순수 함수(테스트 대상).
///
/// 끝의 빈 줄·공백을 떼고, 마지막 [`EXCERPT_MAX_LINES`] 줄을 잡은 뒤, 그래도 [`EXCERPT_MAX_BYTES`]
/// 를 넘으면 앞을 잘라 **줄 머리에서** 시작하게 한다(가운데서 잘린 줄 조각을 남기지 않는다 — 한
/// 줄이 상한보다 길면 그 줄의 꼬리를 문자 경계에서 남긴다). 남을 것이 없으면 `None`.
pub(crate) fn tail_excerpt(s: &str) -> Option<String> {
    let trimmed = s.trim_end();
    if trimmed.trim().is_empty() {
        return None;
    }
    // 마지막 N 줄 — 뒤에서 N 번째 개행 다음부터.
    let mut start = 0;
    let mut seen = 0;
    for (i, b) in trimmed.bytes().enumerate().rev() {
        if b == b'\n' {
            seen += 1;
            if seen == EXCERPT_MAX_LINES {
                start = i + 1;
                break;
            }
        }
    }
    let mut tail = &trimmed[start..];
    if tail.len() > EXCERPT_MAX_BYTES {
        let mut cut = tail.len() - EXCERPT_MAX_BYTES;
        while !tail.is_char_boundary(cut) {
            cut += 1;
        }
        let rest = &tail[cut..];
        // 잘린 줄 조각을 버리고 다음 줄 머리에서 — 남는 줄이 없으면(한 줄이 상한보다 길다) 조각 그대로.
        tail = match rest.find('\n') {
            Some(nl) if nl + 1 < rest.len() => &rest[nl + 1..],
            _ => rest,
        };
    }
    Some(tail.to_string())
}

/// 한 대상의 **사람이 읽는 스냅샷** — [`AuditRecord::target_labels`] 의 칸 하나. camelCase.
///
/// streamId 는 세션이 사라지면 불투명해진다. 그래서 로그 시점에 컨텍스트 거울에서 뽑은
/// `label`(호스트명/셸 라벨)·`code`(타일 위치)를 함께 박아, 사후에도 어느 세션이었는지 읽히게 한다.
/// **완전한 host/account(SSH user@host)는 담지 않는다** — 거울에 안정 host 키가 없어서다(후속: 신원
/// 모델이 생기면 그때). 거울에 없는(공유 안 됨/닫힘) 대상은 이 목록에서 빠진다(id 만 targets 에 남는다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTargetLabel {
    /// 대상 세션 id(= 거울 streamId).
    pub id: String,
    /// 사람이 읽는 이름(SSH 별칭·로컬 셸 라벨).
    pub label: String,
    /// 타일 코드(`p2` / `t7·p2`) — 로그 시점의 타일 위치.
    pub code: String,
}

/// 감사 레코드 하나 = JSONL 한 줄. camelCase 로 직렬화된다(프런트·MCP 계약과 같은 관례).
///
/// `event`: `"approved"`(승인/실행 시작) · `"finished"`(종료 — 대상별 결과 + 집계 상태) ·
/// `"rejected"`(사용자가 거절) · `"cancelled"`(사용자가 취소) · `"expired"`(**시계**가 거둠 —
/// 검토 대기 만료, docs/log/2026-09-21-approval-ttl.md). 책임성 — 누가(또는 무엇이) 무엇을
/// 승인·거절·취소·만료시켰는지가 전부 로그에 남는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    /// 어느 작업안인가 — [`crate::operations::Operation::operation_id`].
    pub operation_id: String,
    /// `"approved"` | `"finished"` | `"rejected"` | `"cancelled"` | `"expired"`.
    pub event: String,
    /// 실행한 명령문 그대로(감사의 핵심). 자격증명은 별도 필드로 담지 않는다.
    pub command: String,
    /// 대상 세션 id 들.
    pub targets: Vec<String>,
    /// 대상별 사람이 읽는 스냅샷(로그 시점 거울에서) — 비면 직렬화에서 빠진다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_labels: Vec<AuditTargetLabel>,
    /// 승인 방식 — `"manual"`(지금) / `"auto"`(단계 10b). `finished`·`rejected`·`cancelled` 에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_method: Option<String>,
    /// **'YOLO' 로 자동 승인됐는가**(2026-10-23 — `approved` 줄에만 · 참일 때만 실린다). `approval_method` 는 그대로 `"auto"`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub approve_all: bool,
    /// 기록 시각(epoch ms).
    pub at: u64,
    /// 대상별 결과 — `finished` 에만 채워진다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub results: Vec<AuditTargetResult>,
    /// 집계 상태(camelCase 문자열) — `finished` 에만 있다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// 작업안 제목(AI 가 붙인 것) — `approved` 에만 있다. 2026-09-28 전의 줄에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 실행 작업 디렉터리 — `approved` 에만 있다(위와 같다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// canary 사후 검증 명령 — `approved` 에만 있다(위와 같다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validate: Option<String>,
    /// **AI 가 쓴 설명**(승인 요약 `summary`) — `approved` 에만 있다(10-22 전의 줄에는 없다). 기록 화면의 상세가 `AI` 표지와 함께 보인다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// **AI 가 적은 이유**(작업안 `reason` — 선택) — `approved` 에만 있다. 거절 까닭 칸 `reason` 과 다른 칸이다(이름이 겹치지 않게).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_reason: Option<String>,
    /// **AI 의 DB 읽기**(`event: "db_read"` — 쿼리 타일 3단계 3a) — 도구 · 연결 · 행 수 · ms · 결과 코드. `command` 는 그 SQL(조회) 또는
    /// 도구 인자 요약(구조 도구), `targets` 는 `["db:<연결 id>"]`. **결과 값(행 · 칸)은 남기지 않는다** — "무엇을 물었고 몇 행이
    /// 나갔나" 만. `operation_id` 는 빈 글자다(작업안이 아니다 — 실행 기록 화면 `join_runs` 는 이 줄을 건너뛴다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<AuditDbRead>,
    /// **AI 의 DB 쓰기 작업안 결과**(쿼리 타일 3단계 3b — `finished` 줄에만) — 연결 · 엔진 · 상한 · 영향 행 합 · 결과 · 문장마다 첫 낱말 ·
    /// 영향 행 · ms. SQL 글자는 `command` 에 있고 **값(행 · 칸 · `RETURNING`)은 없다.**
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_write: Option<AuditDbWrite>,
    /// 기록의 갈래 — 없으면 작업안(지금까지의 모든 줄), `"orchestration"` 이면 오케스트레이션 사건(2026-10-14 — 설계 E-2).
    /// 오케스트레이션 줄은 `operation_id` 에 Run id 를, `event` 에 사건 이름을 싣고 `command`·`targets` 는 비운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// 오케스트레이션 사건의 고정 칸 — `kind == "orchestration"` 일 때만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orchestration: Option<OrchestrationAudit>,
}

/// 오케스트레이션 감사의 **고정 칸**(설계 E-2) — 토큰 · 비밀 · Task 본문(goal · scope · doneWhen) · 프롬프트 · 대화 기록은
/// 칸이 없어서 실릴 수 없다. 제목은 길이만(`title_len`).
///
/// 사건(`AuditRecord::event`): `run_started`(권한 모드 · 한도) · `task_created` · `task_updated` · `human_paused` ·
/// `human_resumed` · `human_stopped` · `human_continued` · `run_ended` · `limit_reached`(어느 한도) · (4단계) `worker_reported`
/// (결과 · 커밋 · dirty · late — 요약은 길이만) · `task_accepted` · `task_rejected`(검토자 · 뒤집기).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationAudit {
    /// 그때의 조정자 세대.
    pub gen: u32,
    /// `human` · `coordinator` · `worker` · `server`.
    pub actor: String,
    /// 사건 뒤 Run 상태.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_state: Option<String>,
    /// 작업자 권한 모드(`run_started`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_permission: Option<String>,
    /// 한도(`run_started`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<AuditLimits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_state: Option<String>,
    /// Task 제목의 글자 수(제목 자체는 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_len: Option<u32>,
    /// 다다른 한도 이름(`limit_reached` — `coordination-time` · `execution-time`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<String>,
    /// 작업자 Attempt(3단계 — `worker_spawned` · `spawn_failed` · `worker_stopping` · `worker_exited` …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    /// 작업자 CLI(`claude` · `codex`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<String>,
    /// 사건 뒤 Attempt 상태.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_state: Option<String>,
    /// 보고 결과(4단계 — `worker_reported`: `success` · `failure` · `blocked`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    /// 보고 · 수락의 커밋(`worker_reported` · `task_accepted`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_oid: Option<String>,
    /// 보고 때 미커밋 변경이 있었나.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    /// 중단 뒤 · 세대 교체 뒤의 보고(기록만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub late: Option<bool>,
    /// 보고 요약의 글자 수(요약 자체는 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_len: Option<u32>,
    /// 바뀐 파일 수(이름은 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<u32>,
    /// 검토자(`task_accepted` · `task_rejected` — `coordinator` · `human`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer: Option<String>,
    /// 앞선 판정을 뒤집었나(사람).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flipped: Option<bool>,
    /// 전달 결과(5단계 — `prompt_sent`: `rejected` · `pasted-unconfirmed` · `submitted-unconfirmed` · `acknowledged`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_state: Option<String>,
    /// 전달 본문의 바이트 수(본문 자체는 싣지 않는다 — E-2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_len: Option<u32>,
    /// 전달 본문의 SHA-1(hex).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_sha1: Option<String>,
    /// 거절 · 미확인 까닭(짧은 낱말) · 사람 복구 결과(`processed` · `not-processed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 작업자 요청 id(10-15 `worker_committed` — 작업자가 고른 짧은 글자, 제어 문자 없음).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// 통합 작업 id(통합 설계 2단계 — `task_integrating` · `task_integrated` · `integration_aborted`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    /// 수락 전 검증(통합 설계 4단계 — `verify_approved` · `verify_started` · `verify_finished` · `human_override_verify`). **명령 글자 ·
    /// 출력은 싣지 않는다** — 명령은 `run_started` 에 길이 · SHA-256 · 자동 실행 여부만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_id: Option<String>,
    /// 검증 명령의 SHA-256(hex).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_sha: Option<String>,
    /// 검증 명령의 글자 수(`run_started`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_len: Option<u32>,
    /// '검증 자동 실행'(`run_started` — '전부 자동' 과 같은 위험 등급).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_run: Option<bool>,
    /// 검증을 허락한 쪽(`human` · `auto`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    /// 검증 끝 코드.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    /// 검증에 걸린 시간(ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// 검토 보고 id(통합 설계 5단계 — `reviewer_reported` · `review_waived`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// 검토가 찾은 것의 **개수**(본문은 싣지 않는다 — `reviewer_reported`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings: Option<u32>,
    /// 정리(통합 설계 6단계 — `server_temp_cleaned` · `run_cleanup` · `refs_reclaimed`)가 지운 것의 **수**(경로 · ref 이름은 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleaned: Option<u32>,
    /// 정리가 지우지 않고 남긴 것의 수(예상 밖 변경 · 쓰는 중 · 실패).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept: Option<u32>,
    /// 헤드리스 턴 번호(3차 3a — `turn_started` · `turn_ended`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<u32>,
    /// 이어지는 턴(resume)인가.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<bool>,
    /// 띄운 역할의 id(맡기기 `[[repo.role]]` — 이름 · 지침 본문은 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    /// 그 턴의 모델 · 강도 낱말(역할 칸 — 개발 덮기 뒤의 실제 인자).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// 그 턴 지침 파일 본문의 SHA-256(본문은 싣지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions_sha: Option<String>,
    /// 맡기기 블록의 받아들인 판 해시(`run_started` · 첫 작업자 — 값은 해시뿐).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation_sha: Option<String>,
    /// 앨범 구성 지문(명령 · 지침 본문 없음).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_sha: Option<String>,
    /// 앨범 변경의 고정 재료. 허용 명령은 전체 개수만, 이름 · 글자 · 지침은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rev: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widened: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<AuditAlbumMember>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_commands: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_tools: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_merge: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake_max: Option<u32>,
    /// 턴의 거절 수(`turn_ended`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub denials: Option<u32>,
    /// 못 채운 수락 규칙의 역할 id 들(`accept_refused` — 낱말뿐).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unmet: Option<Vec<String>>,
    /// 사람 수락이 넘은 규칙 낱말들(`accept_waived` — `judgment` · `review`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waived: Option<Vec<String>>,
    /// 누가 Run 을 열었나(`run_started` — `human` · `ai`, 3차 5단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// (2단계 단계 4) 앱이 깨움 — `producer_woken` · `producer_wake_ended`: 깨움 id · 깨운 프로듀서 채팅 · 장부 범위 · 항목 종류 낱말 · 재시도인가.
    /// **문장은 싣지 않는다**(재료가 장부의 id · 열거 값뿐이라 장부 · 감사로 다시 지을 수 있다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry: Option<bool>,
}

/// 앨범 감사의 멤버 사본 — 서버 id와 등급 낱말만.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuditAlbumMember {
    pub artist: String,
    pub grade: String,
}

/// Run 한도의 감사 사본(고정 칸).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLimits {
    pub max_tasks: u32,
    pub max_calls_per_minute: u32,
    pub max_waiters: u32,
    pub coordination_minutes: u32,
    pub execution_grace_minutes: u32,
    pub max_concurrent_workers: u32,
    pub max_total_workers: u32,
    pub max_deliveries: u32,
}

/// [`AuditRecord::db_write`] — 승인된 DB 작업안 한 번의 실행(값 없음).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDbWrite {
    pub conn_id: String,
    #[serde(default)]
    pub engine: String,
    pub max_affected: u64,
    pub total_affected: u64,
    /// `committed` · `rolledBack` · `unknown` · `disconnected` · `notRun`.
    pub outcome: String,
    /// 멈춘 까닭(`error` · `cancelled` · `timedOut` · `commitFailed` · `maxAffected`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 실행한 문장들(성공한 것 — 멈춘 문장은 `reason` 이 말한다).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<AuditDbStmt>,
}

/// [`AuditDbWrite::statements`] 의 한 줄.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDbStmt {
    pub keyword: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
}

/// [`AuditRecord::db`] — AI 의 DB 도구 호출 한 번.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDbRead {
    /// MCP 도구 이름(`db_query` · `db_list_objects` …).
    pub tool: String,
    /// `db-connections.json` 의 연결 id.
    pub conn_id: String,
    /// 그 연결의 엔진(`postgres` · `mysql` · `mariadb` · `sqlite` — 모르는 연결이면 빈 글자).
    #[serde(default)]
    pub engine: String,
    /// 돌려준 행(또는 항목) 수 — 실패면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u64>,
    pub elapsed_ms: u64,
    /// `ok` · `error` · `denied`(권한 판정에서 거절 — 연결에 닿지 않았다).
    pub outcome: String,
}

impl AuditRecord {
    /// 승인/실행 시작 레코드 — **순수 생성자**(테스트 대상).
    pub fn approved(
        operation_id: String,
        command: String,
        targets: Vec<String>,
        approval_method: String,
        at: u64,
    ) -> Self {
        AuditRecord {
            operation_id,
            event: "approved".to_string(),
            command,
            targets,
            target_labels: Vec::new(),
            approval_method: Some(approval_method),
            approve_all: false,
            at,
            results: Vec::new(),
            state: None,
            title: None,
            cwd: None,
            validate: None,
            summary: None,
            plan_reason: None,
            db: None,
            db_write: None,
            kind: None,
            orchestration: None,
        }
    }

    /// 거절/취소/만료 레코드 — **순수 생성자**(테스트 대상). 책임성: 무엇이 막았는지 남긴다.
    /// `event` 는 `"rejected"`·`"cancelled"`(사람이 막았다) 또는 `"expired"`(시계가 거뒀다 —
    /// 검토 대기 TTL). 승인 방식·결과·집계 상태는 없다.
    pub fn user_action(
        event: &str,
        operation_id: String,
        command: String,
        targets: Vec<String>,
        at: u64,
    ) -> Self {
        AuditRecord {
            operation_id,
            event: event.to_string(),
            command,
            targets,
            target_labels: Vec::new(),
            approval_method: None,
            approve_all: false,
            at,
            results: Vec::new(),
            state: None,
            title: None,
            cwd: None,
            validate: None,
            summary: None,
            plan_reason: None,
            db: None,
            db_write: None,
            kind: None,
            orchestration: None,
        }
    }

    /// 오케스트레이션 사건 레코드 — **순수 생성자**(테스트 대상). `operation_id` 에 Run id, `command`·`targets` 는 비운다.
    pub fn orchestration(event: &str, run_id: &str, detail: OrchestrationAudit, at: u64) -> Self {
        AuditRecord {
            operation_id: run_id.to_string(),
            event: event.to_string(),
            command: String::new(),
            targets: Vec::new(),
            target_labels: Vec::new(),
            approval_method: None,
            approve_all: false,
            at,
            results: Vec::new(),
            state: None,
            title: None,
            cwd: None,
            validate: None,
            summary: None,
            plan_reason: None,
            db: None,
            db_write: None,
            kind: Some("orchestration".to_string()),
            orchestration: Some(detail),
        }
    }

    /// 대상별 사람이-읽는 스냅샷을 얹는다(빌더) — 로그 시점 거울에서 뽑아 넘긴다. 기존 생성자
    /// 시그니처를 건드리지 않으려고 뒤에 붙이는 방식이다.
    pub fn with_labels(mut self, labels: Vec<AuditTargetLabel>) -> Self {
        self.target_labels = labels;
        self
    }

    /// 작업안의 제목·경로·검증 명령을 얹는다(빌더) — `approved` 줄이 쓴다. 기록 화면의 상세가
    /// 이 칸을 읽는다(비어 있으면 직렬화에서 빠진다).
    pub fn with_plan(
        mut self,
        title: Option<String>,
        cwd: Option<String>,
        validate: Option<String>,
    ) -> Self {
        self.title = title;
        self.cwd = cwd;
        self.validate = validate;
        self
    }

    /// 'YOLO' 로 자동 승인됐음을 얹는다(빌더 — `approved` 줄, 2026-10-23).
    pub fn with_approve_all(mut self, approve_all: bool) -> Self {
        self.approve_all = approve_all;
        self
    }

    /// AI 가 쓴 설명 · 이유를 얹는다(빌더 — `approved` 줄, 승인 요약 10-22). 기록에서 나중에 볼 수 있게 — 비면 직렬화에서 빠진다.
    pub fn with_ai_text(mut self, summary: Option<String>, reason: Option<String>) -> Self {
        let clean = |v: Option<String>| v.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        self.summary = clean(summary);
        self.plan_reason = clean(reason);
        self
    }

    /// DB 작업안의 결과를 얹는다(빌더 — `finished` 줄, 3b). `None` 이면 그대로.
    pub fn with_db_write(mut self, db_write: Option<AuditDbWrite>) -> Self {
        self.db_write = db_write;
        self
    }

    /// AI 의 DB 읽기 한 번 — **순수 생성자**. 결과 값은 받지도 않는다(칸이 없다).
    pub fn db_read(command: String, read: AuditDbRead, at: u64) -> Self {
        AuditRecord {
            operation_id: String::new(),
            event: "db_read".to_string(),
            command,
            targets: vec![format!("db:{}", read.conn_id)],
            target_labels: Vec::new(),
            approval_method: None,
            approve_all: false,
            at,
            results: Vec::new(),
            state: None,
            title: None,
            cwd: None,
            validate: None,
            summary: None,
            plan_reason: None,
            db: Some(read),
            db_write: None,
            kind: None,
            orchestration: None,
        }
    }

    /// 종료 레코드 — **순수 생성자**(테스트 대상). 대상별 결과와 집계 상태를 담는다.
    pub fn finished(
        operation_id: String,
        command: String,
        targets: Vec<String>,
        results: Vec<AuditTargetResult>,
        state: String,
        at: u64,
    ) -> Self {
        AuditRecord {
            operation_id,
            event: "finished".to_string(),
            command,
            targets,
            target_labels: Vec::new(),
            approval_method: None,
            approve_all: false,
            at,
            results,
            state: Some(state),
            title: None,
            cwd: None,
            validate: None,
            summary: None,
            plan_reason: None,
            db: None,
            db_write: None,
            kind: None,
            orchestration: None,
        }
    }
}

/// 감사 쓰기 스레드의 **건강 지표** — 로거가 실제로 쓰고 있는지 사용자가 볼 수 있게 한다.
///
/// 예전엔 쓰기 실패가 **stderr 로만** 나가 앱에서 감사가 도는지 알 길이 없었다. 이제 쓰기
/// 스레드가 이 카운터를 갱신하고, [`audit_status`] 명령이 읽어 관제판에 한 줄로 보여 준다.
/// 원자 카운터라 잠금 없이 스레드가 갱신하고 명령이 읽는다.
#[derive(Default)]
pub struct AuditHealth {
    /// 성공적으로 쓰고 flush 한 레코드 수.
    pub written: AtomicU64,
    /// 실패한 쓰기·직렬화·파일 열기 수.
    pub failed: AtomicU64,
    /// 마지막으로 성공적으로 쓴 시각(epoch ms). 0 = 아직 없음.
    pub last_ok_at: AtomicU64,
    /// 쓰기 스레드가 살아 있는가(스폰 성공 후 true, 채널 닫혀 스레드가 끝나면 false).
    pub running: AtomicBool,
}

/// 감사 로거 — 세션 서버의 작업안 평면(`operations::approval::OpsPlane`)이 한 벌 쥔다(③-3c). 전용 쓰기 스레드로 가는
/// [`mpsc::Sender`] 를 쥔다.
///
/// `tx` 가 `None` 이면 로거가 꺼진 것이다(폴더를 못 만든 환경) — 그때 [`Audit::log`] 는 아무것도
/// 하지 않는다(실행은 그대로 · 무해). `Mutex` 로 감싼 것은 Tauri State 가 `Sync` 를 요구하기
/// 때문이다([`mpsc::Sender`] 자체는 `Sync` 가 아니다) — 잠금은 `send` 한 번 동안뿐이라 짧다.
///
/// `health` 는 쓰기 스레드와 공유하는 건강 지표, `dir` 은 감사 파일 폴더(꺼졌어도 어디에 **쓸**
/// 자리인지 보여 주려 담는다).
pub struct Audit {
    tx: Mutex<Option<mpsc::Sender<AuditRecord>>>,
    health: Arc<AuditHealth>,
    dir: Option<PathBuf>,
}

impl Default for Audit {
    fn default() -> Self {
        Audit::in_dir(audit_dir())
    }
}

impl Audit {
    /// 이 폴더에 쓰는 로거 — 세션 서버가 한 벌 쥔다(③-3c · 시험은 임시 폴더). `None` 이면 꺼진 로거.
    pub(crate) fn in_dir(dir: Option<PathBuf>) -> Self {
        let health = Arc::new(AuditHealth::default());
        let tx = start_writer(Arc::clone(&health), dir.clone());
        Audit {
            tx: Mutex::new(tx),
            health,
            dir,
        }
    }

    /// 건강 상태 — 세션 서버 op `audit_status` 가 돌려준다.
    pub(crate) fn status(&self) -> AuditStatus {
        AuditStatus {
            running: self.health.running.load(Ordering::Relaxed),
            written: self.health.written.load(Ordering::Relaxed),
            failed: self.health.failed.load(Ordering::Relaxed),
            last_ok_at: self.health.last_ok_at.load(Ordering::Relaxed),
            dir: self.dir.as_ref().map(|p| p.display().to_string()),
        }
    }
}

/// [`audit_status`] 결과(camelCase) — 관제판이 "감사가 도는지" 를 볼 수 있게.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditStatus {
    pub running: bool,
    pub written: u64,
    pub failed: u64,
    pub last_ok_at: u64,
    pub dir: Option<String>,
}

/// 감사 로거의 건강 상태를 읽는다 — 관제판이 "감사: 기록 N · 실패 M" 을 보이는 창구. ③-3c 부터 로거(쓰기 스레드)는 세션
/// 서버에 산다(승인·실행이 거기서 돈다) — 서버 op `audit_status`(읽기). 서버에 닿지 못하면 `running: false`(그 사실 그대로).
#[tauri::command]
pub async fn audit_status() -> AuditStatus {
    let v = crate::server::ai_proxy::call(crate::server::ipc::Grade::Read, "audit_status", serde_json::json!({}))
        .await
        .ok();
    v.and_then(|v| serde_json::from_value(v).ok()).unwrap_or(AuditStatus {
        running: false,
        written: 0,
        failed: 0,
        last_ok_at: 0,
        dir: audit_dir().map(|p| p.display().to_string()),
    })
}

impl Audit {
    /// 레코드 하나를 쓰기 스레드로 넘긴다. **실패해도 삼킨다** — 감사 쓰기가 실행을 막지 않는다.
    pub fn log(&self, record: AuditRecord) {
        if let Ok(guard) = self.tx.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(record);
            }
        }
    }

    /// 쓰기 스레드로 가는 송신자 클론 — executor 태스크(`finalize`)가 들고 가 종료 레코드를 보낸다.
    /// 로거가 꺼져 있으면 `None`.
    pub fn sender(&self) -> Option<mpsc::Sender<AuditRecord>> {
        self.tx.lock().ok().and_then(|g| g.clone())
    }
}

/// 감사 폴더를 만들고 쓰기 스레드를 띄운다. 폴더를 못 만들면 경고 한 줄 + `None`(로거 꺼짐,
/// `running` 은 false 그대로). `dir` 은 [`Audit`] 이 이미 뽑아 두고 넘긴다(상태 표시에도 쓴다).
fn start_writer(
    health: Arc<AuditHealth>,
    dir: Option<PathBuf>,
) -> Option<mpsc::Sender<AuditRecord>> {
    let dir = match dir {
        Some(d) => d,
        None => {
            eprintln!("[aynx] 감사 로그: 데이터 디렉터리를 찾을 수 없습니다 — 감사 기록이 꺼집니다");
            return None;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "[aynx] 감사 로그: {} 폴더를 만들지 못했습니다 — 감사 기록이 꺼집니다: {e}",
            dir.display()
        );
        return None;
    }
    Some(spawn_writer_in(dir, health, retention_days_from_settings))
}

/// 보관 일수를 설정 파일에서 읽는다 — 쓰기 스레드 위에서만 부른다(디스크 읽기라 UI 스레드가 아니다).
fn retention_days_from_settings() -> u32 {
    crate::settings::automation_prefs().audit_retention_days
}

/// `audit-<YYYYMMDD>.jsonl` → 그 날짜. 모양이 다르면 `None`(손으로 둔 다른 파일은 건드리지 않는다).
fn parse_audit_date(name: &str) -> Option<chrono::NaiveDate> {
    let stamp = name.strip_prefix("audit-")?.strip_suffix(".jsonl")?;
    if stamp.len() != 8 || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    chrono::NaiveDate::parse_from_str(stamp, "%Y%m%d").ok()
}

/// **보관 기간이 지난 날짜 파일** — 순수 함수(테스트 대상).
///
/// `today` 에서 `days` 일보다 **더 지난** 날짜의 `audit-YYYYMMDD.jsonl` 이름만 고른다 — `days`=90 이면
/// 오늘부터 90일 전 파일까지 남고 91일 전부터 지운다. `days`=0 은 "지우지 않음" 이라 빈 목록이다.
/// 모양이 다른 이름(손으로 둔 파일·다른 확장자)은 고르지 않는다 — 앱이 쓴 날짜 파일만 치운다.
pub(crate) fn expired_audit_files(
    names: &[String],
    today: chrono::NaiveDate,
    days: u32,
) -> Vec<String> {
    if days == 0 {
        return Vec::new();
    }
    names
        .iter()
        .filter(|n| parse_audit_date(n).is_some_and(|d| (today - d).num_days() > i64::from(days)))
        .cloned()
        .collect()
}

/// 폴더에서 보관 기간이 지난 날짜 파일을 지운다 — 쓰기 스레드가 부른다. 실패는 경고 한 줄뿐이다
/// (지우지 못한 파일은 다음 날 다시 고른다).
fn prune_expired(dir: &std::path::Path, today: chrono::NaiveDate, days: u32) {
    if days == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let names: Vec<String> = rd
        .filter_map(|e| e.ok().and_then(|e| e.file_name().into_string().ok()))
        .collect();
    for name in expired_audit_files(&names, today, days) {
        if let Err(e) = std::fs::remove_file(dir.join(&name)) {
            eprintln!("[aynx] 감사 로그: 보관 기간이 지난 {name} 을 지우지 못했습니다: {e}");
        }
    }
}

/// 지정한 폴더에 날짜별 JSONL 로 append 하는 쓰기 스레드를 띄운다 — 테스트가 부르는 알맹이.
///
/// 레코드마다 오늘 날짜의 파일(`audit-<YYYYMMDD>.jsonl`)에 한 줄 append 하고 flush 한다.
/// 날짜가 바뀌면 새 파일로 갈아 연다(자정을 넘겨 앱이 돌아도 파일이 날짜별로 갈린다).
/// 송신자가 전부 떨어지면 스레드가 마지막 flush 후 끝난다. **성공/실패마다 `health` 를 갱신**해
/// 앱이 감사가 도는지 볼 수 있게 한다([`audit_status`]).
///
/// **보관 기간 정리**도 이 스레드가 한다 — 시작할 때 한 번, 그리고 날짜가 바뀐 뒤의 첫 쓰기에서 한 번
/// ([`prune_expired`]). `retention_days` 는 그 순간의 보관 일수를 읽는 함수다(앱은 설정 파일을 읽고,
/// 테스트는 상수를 준다). UI 스레드에서는 절대 돌지 않는다.
pub(crate) fn spawn_writer_in(
    dir: PathBuf,
    health: Arc<AuditHealth>,
    retention_days: fn() -> u32,
) -> mpsc::Sender<AuditRecord> {
    let (tx, rx) = mpsc::channel::<AuditRecord>();

    // 스폰 성공 = 로거 가동. 스레드가 끝날 때(채널 닫힘) false 로 되돌린다.
    health.running.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        // (열려 있는 파일의 날짜, BufWriter) — 날짜가 바뀌면 갈아 연다.
        let mut current: Option<(String, std::io::BufWriter<std::fs::File>)> = None;

        // 앱 시작 — 지난 날짜 파일을 한 번 치운다.
        let mut pruned_on = today_stamp();
        prune_expired(&dir, chrono::Local::now().date_naive(), retention_days());

        while let Ok(record) = rx.recv() {
            // 날짜가 바뀐 뒤의 첫 쓰기 — 자정을 넘겨 켜 둔 앱도 하루 한 번 치운다.
            let stamp = today_stamp();
            if stamp != pruned_on {
                prune_expired(&dir, chrono::Local::now().date_naive(), retention_days());
                pruned_on = stamp;
            }
            let mut line = match serde_json::to_string(&record) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[aynx] 감사 레코드를 직렬화하지 못했습니다: {e}");
                    health.failed.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            line.push('\n');

            let date = today_stamp();
            let needs_open = current.as_ref().map(|(d, _)| d != &date).unwrap_or(true);
            if needs_open {
                if let Some((_, w)) = &mut current {
                    let _ = w.flush();
                }
                match open_append(&dir, &date) {
                    Ok(file) => current = Some((date, std::io::BufWriter::new(file))),
                    Err(e) => {
                        eprintln!("[aynx] 감사 로그 파일을 열지 못했습니다: {e}");
                        health.failed.fetch_add(1, Ordering::Relaxed);
                        current = None;
                        continue;
                    }
                }
            }

            if let Some((_, w)) = &mut current {
                // 감사 레코드는 드물다 — 줄마다 flush 해 앱이 죽어도 직전 기록이 남게 한다.
                match w.write_all(line.as_bytes()).and_then(|_| w.flush()) {
                    Ok(()) => {
                        health.written.fetch_add(1, Ordering::Relaxed);
                        health.last_ok_at.store(now_ms(), Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("[aynx] 감사 로그 쓰기 실패: {e}");
                        health.failed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }

        if let Some((_, mut w)) = current {
            let _ = w.flush();
        }
        // 채널이 닫혀 스레드가 끝난다 — 관제판이 "감사 꺼짐" 을 볼 수 있게 표식을 내린다.
        // (드레인 훅은 필요 없다 — 줄마다 flush 해 이미 crash-safe 다.)
        health.running.store(false, Ordering::Relaxed);
    });

    tx
}

/// 최근 감사 레코드 최대 N 개를 **최신순(newest-first)** 으로 읽어 온다 — 감사 뷰용 읽기 명령.
///
/// 감사 뷰(UI)는 이번 단계에 없다 — 이 명령은 로그 파일을 앱에서도 확인할 수 있게 하는 얇은
/// 창구다. **읽기 전용**이라 실행 경로와 무관하고, 파일이 없거나 깨졌으면 빈 목록이다.
#[tauri::command]
pub async fn list_audit(limit: usize) -> Vec<AuditRecord> {
    tauri::async_runtime::spawn_blocking(move || read_recent(limit))
        .await
        .unwrap_or_default()
}

/// [`list_audit`] 알맹이 — **최신 파일부터, 파일 안에서도 마지막 줄부터** 훑어 최대 `limit` 개를
/// 돌려준다. 반환 순서는 **최신순**(가장 최근 레코드가 `[0]`).
///
/// 예전엔 모든 파일을 시간순으로 다 읽어 끝에서 잘랐다 — 로그가 오래 쌓이면 매번 전부 읽는다.
/// 이제 최신 날짜 파일 하나를 tail 하는 것으로 대개 끝나고(`limit` 을 채우면 옛 파일은 열지도
/// 않는다), 필요한 만큼만 옛 파일로 거슬러 올라간다. 파싱 못 하는 줄은 건너뛴다(손으로 고쳤거나
/// 옛 형식) — 한 줄이 깨져도 나머지는 읽힌다.
fn read_recent(limit: usize) -> Vec<AuditRecord> {
    match audit_dir() {
        Some(dir) => read_recent_in(&dir, limit),
        None => Vec::new(),
    }
}

/// [`read_recent`] 알맹이 — 폴더를 받는 순수 I/O(테스트 대상). 최신 파일·마지막 줄부터 `limit` 까지.
fn read_recent_in(dir: &std::path::Path, limit: usize) -> Vec<AuditRecord> {
    if limit == 0 {
        return Vec::new();
    }
    let mut out: Vec<AuditRecord> = Vec::new();
    scan_newest_first(dir, None, |rec| {
        out.push(rec);
        out.len() < limit // limit 을 채우면 멈춘다 — 더 옛 파일은 열지 않는다.
    });
    out
}

/// 감사 레코드를 **최신 파일부터, 파일 안에서도 마지막 줄부터** 하나씩 `visit` 에 넘긴다 —
/// [`list_audit`] 와 [`audit_runs`] 가 함께 쓰는 읽기 알맹이. `visit` 이 `false` 를 돌려주면 멈춘다.
///
/// `min_stamp`(`YYYYMMDD`)가 있으면 그 날짜보다 옛 날짜 파일은 열지 않는다(모양이 다른 `.jsonl` 도
/// 건너뛴다). 파싱 못 하는 줄은 건너뛴다(손으로 고쳤거나 옛 형식) — 한 줄이 깨져도 나머지는 읽힌다.
fn scan_newest_first(
    dir: &std::path::Path,
    min_stamp: Option<&str>,
    mut visit: impl FnMut(AuditRecord) -> bool,
) {
    let mut files: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .filter(|p| match min_stamp {
                None => true,
                Some(min) => p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|n| n.strip_prefix("audit-")?.strip_suffix(".jsonl"))
                    .is_some_and(|stamp| stamp.len() == 8 && stamp >= min),
            })
            .collect(),
        Err(_) => return,
    };
    // 파일 이름이 `audit-<YYYYMMDD>.jsonl` 이라 이름 내림차순 = 날짜 내림차순(최신 파일 먼저).
    files.sort();
    files.reverse();

    for f in files {
        let Ok(content) = std::fs::read_to_string(&f) else {
            continue;
        };
        // 파일 안에서도 마지막 줄(가장 최근)부터.
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<AuditRecord>(line) {
                if !visit(rec) {
                    return;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 실행 기록 — `approved` + `finished` 를 한 실행으로 (docs/log/2026-09-28-run-history.md)
// ---------------------------------------------------------------------------

/// 실행 한 건 — 대시보드 작업안 칸 **기록** 보기의 한 줄(camelCase). `approved` 줄과 같은
/// `operationId` 의 `finished` 줄을 묶은 것이다. `state` 가 `None` 이면 끝난 줄이 아직 없다(도는 중
/// 이거나 앱이 끝나기 전에 닫혔다).
///
/// 거절·만료는 싣지 않는다 — 실행된 적이 없어 이 장부의 줄이 아니다. 실행 중 사람의 취소(`cancelled`
/// 줄)는 따로 줄을 만들지 않고 그 실행에 **`cancelled_by_user`** 로 얹는다 — 집계는 일부가 성공했으면
/// `partial` 로 봉해지므로, 그것이 "일부 실패" 가 아니라 사람이 멈춘 것임을 화면이 알 길이 이 칸뿐이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRun {
    pub operation_id: String,
    pub command: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub validate: Option<String>,
    /// AI 가 쓴 설명(승인 요약) — 10-22 전의 실행에는 없다.
    pub summary: Option<String>,
    /// AI 가 적은 이유(작업안 `reason` — 선택) — 기록 상세가 "AI가 적은 이유" 로 보인다.
    pub reason: Option<String>,
    /// 대상 id — **`targets[0]` 가 canary 다**(실행 순서 그대로).
    pub targets: Vec<String>,
    /// 승인 시점의 사람이 읽는 이름 스냅샷(거울에 있던 대상만).
    pub target_labels: Vec<AuditTargetLabel>,
    /// `"manual"` · `"auto"`.
    pub approval_method: Option<String>,
    /// 'YOLO' 로 자동 승인됐다(2026-10-23 — 기록 상세가 "모두 승인" 을 밝힌다). 옛 줄에는 없다(거짓).
    pub approve_all: bool,
    /// 승인(= 실행 시작) 시각(epoch ms) — 목록의 시각·날짜 묶음이 이 값이다.
    pub approved_at: u64,
    /// 끝난 시각(epoch ms) — 끝난 줄이 없으면 `None`.
    pub finished_at: Option<u64>,
    /// 집계 상태(`succeeded`·`partial`·`failed`·`cancelled`) — 끝난 줄이 없으면 `None`.
    pub state: Option<String>,
    /// 대상별 결과(`targets` 순서) — 끝난 줄이 없으면 빈 목록.
    pub results: Vec<AuditTargetResult>,
    /// 사람이 실행 도중 [취소]를 눌렀는가 — 같은 id 의 `cancelled` 사용자 줄이 **끝나기 전에** 있었다.
    pub cancelled_by_user: bool,
    /// 그 취소 시각(epoch ms) — 여러 번 눌렀으면 첫 번째.
    pub cancelled_at: Option<u64>,
}

/// 한 번에 돌려주는 실행 수의 상한 — 90일 치를 넉넉히 덮는다.
const RUNS_MAX_LIMIT: usize = 5000;

/// 최신순 레코드 → 실행 목록 — **순수 함수**(테스트 대상).
///
/// 입력은 [`scan_newest_first`] 가 주는 순서(최신 먼저)다. 끝난 줄은 승인 줄보다 **뒤에** 쓰이므로
/// 최신부터 훑으면 먼저 보인다 — 모아 두었다가 같은 id 의 승인 줄을 만나면 붙인다. 승인 시각이
/// `since_ms` 보다 옛 실행은 빠지고, `limit` 을 채우면 멈춘다. 반환은 승인 시각 내림차순이다.
pub(crate) fn join_runs(
    records: impl IntoIterator<Item = AuditRecord>,
    since_ms: u64,
    limit: usize,
) -> Vec<AuditRun> {
    let mut finished: std::collections::HashMap<String, AuditRecord> =
        std::collections::HashMap::new();
    // 사람의 취소 — id → 시각. 최신부터 훑으므로 덮어쓰면 마지막에 남는 것이 **첫** 취소다.
    let mut cancels: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut runs: Vec<AuditRun> = Vec::new();
    if limit == 0 {
        return runs;
    }
    for rec in records {
        // 오케스트레이션 줄은 실행 장부의 줄이 아니다(작업안 사건만 묶는다).
        if rec.kind.is_some() {
            continue;
        }
        match rec.event.as_str() {
            "finished" => {
                // 같은 id 의 끝난 줄이 둘이면(있을 수 없지만) 최신 것을 쓴다 — 먼저 본 것이 최신이다.
                finished.entry(rec.operation_id.clone()).or_insert(rec);
            }
            "cancelled" => {
                cancels.insert(rec.operation_id.clone(), rec.at);
            }
            "approved" => {
                if rec.at < since_ms || !seen.insert(rec.operation_id.clone()) {
                    continue;
                }
                let fin = finished.remove(&rec.operation_id);
                // 끝난 **뒤**에 누른 취소(이미 봉해진 실행)는 사람이 멈춘 것이 아니다.
                let cancelled_at = cancels
                    .remove(&rec.operation_id)
                    .filter(|&c| fin.as_ref().is_none_or(|f| c <= f.at));
                runs.push(AuditRun {
                    operation_id: rec.operation_id,
                    command: rec.command,
                    title: rec.title,
                    cwd: rec.cwd,
                    validate: rec.validate,
                    summary: rec.summary,
                    reason: rec.plan_reason,
                    targets: rec.targets,
                    target_labels: rec.target_labels,
                    approval_method: rec.approval_method,
                    approve_all: rec.approve_all,
                    approved_at: rec.at,
                    finished_at: fin.as_ref().map(|f| f.at),
                    state: fin.as_ref().and_then(|f| f.state.clone()),
                    results: fin.map(|f| f.results).unwrap_or_default(),
                    cancelled_by_user: cancelled_at.is_some(),
                    cancelled_at,
                });
                if runs.len() >= limit {
                    break;
                }
            }
            _ => {}
        }
    }
    runs.sort_by_key(|r| std::cmp::Reverse(r.approved_at));
    runs
}

/// `since_ms` 의 로컬 날짜 **하루 전** 스탬프 — 그보다 옛 날짜 파일은 열 필요가 없다(하루 여유는
/// 기록 시각과 파일 날짜가 자정 근처에서 어긋나는 경우 몫이다). `0` 이면 제한 없음.
fn min_stamp_for(since_ms: u64) -> Option<String> {
    use chrono::TimeZone;
    if since_ms == 0 {
        return None;
    }
    let dt = chrono::Local
        .timestamp_millis_opt(since_ms as i64)
        .single()?;
    let day = dt.date_naive().pred_opt()?;
    Some(day.format("%Y%m%d").to_string())
}

/// [`audit_runs`] 알맹이 — 폴더를 받는 I/O(테스트 대상).
fn read_runs_in(dir: &std::path::Path, since_ms: u64, limit: usize) -> Vec<AuditRun> {
    let min = min_stamp_for(since_ms);
    let mut records: Vec<AuditRecord> = Vec::new();
    scan_newest_first(dir, min.as_deref(), |rec| {
        records.push(rec);
        true
    });
    join_runs(records, since_ms, limit)
}

/// **실행 기록** — 승인 시각이 `since_ms` 이후인 실행을 최신순으로 최대 `limit` 건(대시보드 작업안 칸
/// › 기록 · 행렬의 재시작 뒤 채우기). Rust 가 파일을 읽고 두 줄을 묶는다 — 프런트는 받은 그대로 그린다.
///
/// **읽기 전용**이고 MCP 에는 없다(기록 화면은 사람을 위한 것이다 — AI 는 `get_operation_results` 로
/// 제 실행을 읽는다). 디스크를 읽으므로 `async` + `spawn_blocking`(docs/conventions.md).
#[tauri::command]
pub async fn audit_runs(since_ms: u64, limit: usize) -> Vec<AuditRun> {
    let limit = limit.clamp(1, RUNS_MAX_LIMIT);
    tauri::async_runtime::spawn_blocking(move || match audit_dir() {
        Some(dir) => read_runs_in(&dir, since_ms, limit),
        None => Vec::new(),
    })
    .await
    .unwrap_or_default()
}

/// 오늘 날짜 파일을 append 모드로 연다 — 유닉스는 `0o600`([`session_log`] 와 같은 F8 근거).
fn open_append(dir: &std::path::Path, date: &str) -> std::io::Result<std::fs::File> {
    // 감사 로그에는 실행한 명령줄이 그대로 들어간다(경로·인자). 유닉스 기본 umask 는 같은 기기의
    // 다른 사용자에게 읽기를 열어 줄 수 있어 소유자만 읽고 쓰게 못 박는다. import 도 cfg 로 묶어야
    // 윈도우 빌드에 unused import 경고가 나지 않는다(session_log 와 같다).
    //
    // **Windows 는 별도 ACL 작업이 필요 없다**: 감사 폴더는 사용자 프로필 아래(`%APPDATA%\aynx`)라
    // 그 프로필 ACL 로 이미 소유자에게만 제한된다 — 유닉스 `0o600` 이 막는 "같은 기기 타 사용자
    // 읽기" 누수가 Windows 엔 애초에 없다. (winapi ACL 세팅은 후속 항목도 아니다 — 불필요.)
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);

    options.open(dir.join(audit_file_name(date)))
}

#[cfg(test)]
mod tests;
