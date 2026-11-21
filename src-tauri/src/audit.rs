//! 감사 로그 — 승인된 작업안의 실행(명령 · 대상 · 승인 방식 · 시각 · 결과)을 `<data_dir>/aynx/audit/audit-<YYYYMMDD>.jsonl` 에
//! append 한다.
//!
//! - 전용 쓰기 스레드 + 채널([`crate::session_log`] 와 같은 뼈대) — 부르는 쪽은 `send` 한 번이고, **쓰기 실패가 실행을 막지 않는다**.
//! - 감사는 **옵트인이 아니다**("모든 실행을 기록" 이 불변). 보관 기간(`[automation] audit_retention_days`)은 기록을 끄는 칸이
//!   아니라 오래된 날짜 파일을 치우는 칸이다(docs/log/2026-09-28-run-history.md).
//! - 명령줄(`command`)은 그대로 기록하지만 비밀번호 · 키를 담는 별도 필드는 만들지 않는다.
//! - 출력 발췌는 옵트인이다(`[automation] audit_output_excerpt`, 기본 끔 — [`tail_excerpt`]).
//! - AI 의 DB 읽기(`event: "db_read"`)도 남긴다 — "무엇이 모델 제공자로 나갔나" 를 되짚을 유일한 길이다. **결과 값은 남기지 않는다** — 칸이 없다.
//! - 덧붙인 칸은 모두 `serde(default)` 다 — 옛 줄도 그대로 읽힌다.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 로그 · 감사 모두 사용자가 손으로 고치는 설정이 아니라 앱이 쌓는 **데이터**다.
pub(crate) fn audit_dir() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("audit"))
}

fn today_stamp() -> String {
    chrono::Local::now().format("%Y%m%d").to_string()
}

pub(crate) fn audit_file_name(date: &str) -> String {
    format!("audit-{date}.jsonl")
}

/// 출력 꼬리(`stdout_tail` · `stderr_tail`)는 **설정을 켠 경우에만** 실린다([`tail_excerpt`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTargetResult {
    pub stream_id: String,
    /// camelCase 문자열 — `crate::operations::TargetState` 의 직렬화형.
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    /// 시작 전에 취소된 대상은 없다 — 기록 화면의 canary 멈춤 판정이 이 빈칸을 읽는다(결과 알림의 `isCanaryStop` 과 같은 규칙).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// epoch ms
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    /// **출력 발췌 설정을 켰고** 그 대상이 AI 읽기 공유 중일 때만([`tail_excerpt`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout_tail: Option<String>,
    /// 위와 같은 조건.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr_tail: Option<String>,
}

pub const EXCERPT_MAX_LINES: usize = 40;
/// 줄 상한과 **둘 다** 건다 — 긴 한 줄이 줄 상한을 뚫고 파일을 키우지 못하게.
pub const EXCERPT_MAX_BYTES: usize = 4096;

/// 넘치면 앞을 잘라 **줄 머리에서** 시작하게 한다(한 줄이 상한보다 길면 그 줄의 꼬리를 문자 경계에서 남긴다).
pub(crate) fn tail_excerpt(s: &str) -> Option<String> {
    let trimmed = s.trim_end();
    if trimmed.trim().is_empty() {
        return None;
    }
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
        tail = match rest.find('\n') {
            Some(nl) if nl + 1 < rest.len() => &rest[nl + 1..],
            _ => rest,
        };
    }
    Some(tail.to_string())
}

/// streamId 는 세션이 사라지면 불투명해져 로그 시점의 `label` · `code` 를 함께 박는다. 완전한 host/account(SSH user@host)는
/// 담지 않는다 — 거울에 안정 host 키가 없다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTargetLabel {
    pub id: String,
    pub label: String,
    /// `p2` / `t7·p2` — 로그 시점의 타일 위치.
    pub code: String,
}

/// JSONL 한 줄(camelCase). `"expired"` 는 **시계**가 거둔 것(검토 대기 만료)이다 — 누가(또는 무엇이) 승인 · 거절 · 취소 ·
/// 만료시켰는지가 전부 로그에 남는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub operation_id: String,
    /// 작업안 `"approved"` | `"finished"` | `"rejected"` | `"cancelled"` | `"expired"` · DB 읽기 `"db_read"` · 오케스트레이션 사건 이름.
    pub event: String,
    /// 실행한 명령문 그대로(감사의 핵심). 자격증명은 별도 필드로 담지 않는다.
    pub command: String,
    pub targets: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_labels: Vec<AuditTargetLabel>,
    /// `"manual"` · `"auto"` — `finished` · `rejected` · `cancelled` 에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_method: Option<String>,
    /// 'YOLO' 로 자동 승인됐는가 — `approved` 줄에만 · 참일 때만 실린다. `approval_method` 는 그대로 `"auto"`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub approve_all: bool,
    /// epoch ms
    pub at: u64,
    /// `finished` 에만.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub results: Vec<AuditTargetResult>,
    /// camelCase 문자열 — `finished` 에만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// AI 가 붙인 작업안 제목 — `approved` 에만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// `approved` 에만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// canary 사후 검증 명령 — `approved` 에만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validate: Option<String>,
    /// AI 가 쓴 승인 요약 — `approved` 에만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// AI 가 적은 이유(작업안 `reason`) — `approved` 에만. 거절 까닭 칸 `reason` 과 다른 칸이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_reason: Option<String>,
    /// AI 의 DB 읽기(`event: "db_read"`) — `command` 는 그 SQL 또는 도구 인자 요약, `targets` 는 `["db:<연결 id>"]`, `operation_id`
    /// 는 빈 글자. **결과 값(행 · 칸)은 남기지 않는다.**
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db: Option<AuditDbRead>,
    /// AI 의 DB 쓰기 작업안 결과(`finished` 줄에만) — SQL 글자는 `command` 에 있고 **값(행 · 칸 · `RETURNING`)은 없다.**
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_write: Option<AuditDbWrite>,
    /// 없으면 작업안, `"orchestration"` 이면 오케스트레이션 사건 — 그 줄은 `operation_id` 에 Run id, `event` 에 사건 이름을 싣고
    /// `command` · `targets` 는 비운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orchestration: Option<OrchestrationAudit>,
}

/// 오케스트레이션 감사의 **고정 칸** — 토큰 · 비밀 · Task 본문(goal · scope · doneWhen) · 프롬프트 · 대화 기록은 칸이 없어서
/// 실릴 수 없다. 제목은 길이만(`title_len`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationAudit {
    /// 그때의 조정자 세대.
    pub gen: u32,
    /// `human` · `coordinator` · `worker` · `server`.
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_permission: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<AuditLimits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_state: Option<String>,
    /// 제목 자체는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_len: Option<u32>,
    /// `coordination-time` · `execution-time`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_state: Option<String>,
    /// `success` · `failure` · `blocked`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    /// 중단 뒤 · 세대 교체 뒤의 보고(기록만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub late: Option<bool>,
    /// 요약 자체는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_len: Option<u32>,
    /// 바뀐 파일 수 — 이름은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<u32>,
    /// `coordinator` · `human`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flipped: Option<bool>,
    /// `rejected` · `pasted-unconfirmed` · `submitted-unconfirmed` · `acknowledged`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_state: Option<String>,
    /// 전달 본문의 바이트 수 — 본문 자체는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_len: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_sha1: Option<String>,
    /// 거절 · 미확인 까닭(짧은 낱말) · 사람 복구 결과(`processed` · `not-processed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 작업자가 고른 짧은 글자(제어 문자 없음).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    /// **명령 글자 · 출력은 싣지 않는다** — 명령은 `run_started` 에 길이 · SHA-256 · 자동 실행 여부만.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_len: Option<u32>,
    /// '검증 자동 실행' — '전부 자동' 과 같은 위험 등급.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_run: Option<bool>,
    /// `human` · `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// 검토가 찾은 것의 개수 — 본문은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings: Option<u32>,
    /// 정리가 지운 것의 수 — 경로 · ref 이름은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleaned: Option<u32>,
    /// 정리가 남긴 것의 수(예상 밖 변경 · 쓰는 중 · 실패).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<bool>,
    /// 맡기기 `[[repo.role]]` 의 id — 이름 · 지침 본문은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    /// 개발 덮기 뒤의 실제 인자.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// 그 턴 지침 파일 본문의 SHA-256 — 본문은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions_sha: Option<String>,
    /// 맡기기 블록의 받아들인 판 해시 — 값은 해시뿐.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation_sha: Option<String>,
    /// 앨범 구성 지문(명령 · 지침 본문 없음).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_sha: Option<String>,
    /// 허용 명령은 전체 개수만, 이름 · 글자 · 지침은 싣지 않는다.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub denials: Option<u32>,
    /// `accept_refused` — 역할 id 낱말뿐.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unmet: Option<Vec<String>>,
    /// `judgment` · `review`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waived: Option<Vec<String>>,
    /// `human` · `ai`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// 앱이 깨움(`producer_woken` · `producer_wake_ended`) — **문장은 싣지 않는다**(재료가 장부의 id · 열거 값뿐이라 다시 지을 수 있다).
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

/// 서버 id 와 등급 낱말만.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuditAlbumMember {
    pub artist: String,
    pub grade: String,
}

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

/// 승인된 DB 작업안 한 번의 실행 — 값 없음.
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
    /// 성공한 것 — 멈춘 문장은 `reason` 이 말한다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<AuditDbStmt>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDbStmt {
    pub keyword: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDbRead {
    pub tool: String,
    /// `db-connections.json` 의 연결 id.
    pub conn_id: String,
    /// 모르는 연결이면 빈 글자.
    #[serde(default)]
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u64>,
    pub elapsed_ms: u64,
    /// `ok` · `error` · `denied`(권한 판정에서 거절 — 연결에 닿지 않았다).
    pub outcome: String,
}

impl AuditRecord {
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

    pub fn with_labels(mut self, labels: Vec<AuditTargetLabel>) -> Self {
        self.target_labels = labels;
        self
    }

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

    pub fn with_approve_all(mut self, approve_all: bool) -> Self {
        self.approve_all = approve_all;
        self
    }

    pub fn with_ai_text(mut self, summary: Option<String>, reason: Option<String>) -> Self {
        let clean = |v: Option<String>| v.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        self.summary = clean(summary);
        self.plan_reason = clean(reason);
        self
    }

    pub fn with_db_write(mut self, db_write: Option<AuditDbWrite>) -> Self {
        self.db_write = db_write;
        self
    }

    /// 결과 값은 받지도 않는다(칸이 없다).
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

/// 쓰기 스레드의 건강 지표 — 원자 카운터라 잠금 없이 스레드가 갱신하고 [`audit_status`] 가 읽는다.
#[derive(Default)]
pub struct AuditHealth {
    pub written: AtomicU64,
    pub failed: AtomicU64,
    /// epoch ms — 0 = 아직 없음.
    pub last_ok_at: AtomicU64,
    pub running: AtomicBool,
}

/// `tx` 가 `None` 이면 로거가 꺼진 것이다(폴더를 못 만든 환경) — 실행은 그대로. `Mutex` 는 [`mpsc::Sender`] 가 `Sync` 가 아니어서다.
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
    pub(crate) fn in_dir(dir: Option<PathBuf>) -> Self {
        let health = Arc::new(AuditHealth::default());
        let tx = start_writer(Arc::clone(&health), dir.clone());
        Audit {
            tx: Mutex::new(tx),
            health,
            dir,
        }
    }

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

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditStatus {
    pub running: bool,
    pub written: u64,
    pub failed: u64,
    pub last_ok_at: u64,
    pub dir: Option<String>,
}

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
    /// **실패해도 삼킨다** — 감사 쓰기가 실행을 막지 않는다.
    pub fn log(&self, record: AuditRecord) {
        if let Ok(guard) = self.tx.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(record);
            }
        }
    }

    pub fn sender(&self) -> Option<mpsc::Sender<AuditRecord>> {
        self.tx.lock().ok().and_then(|g| g.clone())
    }
}

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

/// 쓰기 스레드 위에서만 부른다(디스크 읽기).
fn retention_days_from_settings() -> u32 {
    crate::settings::automation_prefs().audit_retention_days
}

/// 모양이 다르면 `None` — 손으로 둔 다른 파일은 건드리지 않는다.
fn parse_audit_date(name: &str) -> Option<chrono::NaiveDate> {
    let stamp = name.strip_prefix("audit-")?.strip_suffix(".jsonl")?;
    if stamp.len() != 8 || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    chrono::NaiveDate::parse_from_str(stamp, "%Y%m%d").ok()
}

/// `days` 일보다 **더 지난** 날짜 파일만 — `days`=0 은 "지우지 않음" 이다. 앱이 쓴 날짜 파일 모양만 고른다.
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

/// 보관 기간 정리도 이 스레드가 한다 — UI 스레드에서는 절대 돌지 않는다.
pub(crate) fn spawn_writer_in(
    dir: PathBuf,
    health: Arc<AuditHealth>,
    retention_days: fn() -> u32,
) -> mpsc::Sender<AuditRecord> {
    let (tx, rx) = mpsc::channel::<AuditRecord>();

    health.running.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        let mut current: Option<(String, std::io::BufWriter<std::fs::File>)> = None;

        let mut pruned_on = today_stamp();
        prune_expired(&dir, chrono::Local::now().date_naive(), retention_days());

        while let Ok(record) = rx.recv() {
            // 자정을 넘겨 켜 둔 앱도 하루 한 번 치운다.
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
                // 줄마다 flush — 앱이 죽어도 직전 기록이 남게 한다.
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
        // 관제판이 "감사 꺼짐" 을 볼 수 있게 표식을 내린다.
        health.running.store(false, Ordering::Relaxed);
    });

    tx
}

#[tauri::command]
pub async fn list_audit(limit: usize) -> Vec<AuditRecord> {
    tauri::async_runtime::spawn_blocking(move || read_recent(limit))
        .await
        .unwrap_or_default()
}

/// 최신순 — 가장 최근 레코드가 `[0]`.
fn read_recent(limit: usize) -> Vec<AuditRecord> {
    match audit_dir() {
        Some(dir) => read_recent_in(&dir, limit),
        None => Vec::new(),
    }
}

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

/// `visit` 이 `false` 를 돌려주면 멈춘다. 파싱 못 하는 줄은 건너뛴다(손으로 고쳤거나 옛 형식).
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
    // 이름이 `audit-<YYYYMMDD>.jsonl` 이라 이름 순 = 날짜 순.
    files.sort();
    files.reverse();

    for f in files {
        let Ok(content) = std::fs::read_to_string(&f) else {
            continue;
        };
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

/// `state` 가 `None` 이면 끝난 줄이 아직 없다. 거절 · 만료는 싣지 않는다(실행된 적이 없다). 실행 중 사람의 취소는
/// **`cancelled_by_user`** 로 얹는다 — 집계는 `partial` 로 봉해지므로 사람이 멈춘 것임을 화면이 알 길이 이 칸뿐이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRun {
    pub operation_id: String,
    pub command: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub validate: Option<String>,
    pub summary: Option<String>,
    pub reason: Option<String>,
    /// **`targets[0]` 가 canary 다**(실행 순서 그대로).
    pub targets: Vec<String>,
    pub target_labels: Vec<AuditTargetLabel>,
    pub approval_method: Option<String>,
    pub approve_all: bool,
    /// epoch ms — 목록의 시각 · 날짜 묶음이 이 값이다.
    pub approved_at: u64,
    /// epoch ms
    pub finished_at: Option<u64>,
    /// `succeeded` · `partial` · `failed` · `cancelled`.
    pub state: Option<String>,
    pub results: Vec<AuditTargetResult>,
    /// 같은 id 의 `cancelled` 사용자 줄이 **끝나기 전에** 있었다.
    pub cancelled_by_user: bool,
    /// 여러 번 눌렀으면 첫 번째.
    pub cancelled_at: Option<u64>,
}

const RUNS_MAX_LIMIT: usize = 5000;

/// 입력은 최신 먼저 — 끝난 줄은 승인 줄보다 **뒤에** 쓰이므로 먼저 보인다. 모아 두었다가 같은 id 의 승인 줄을 만나면 붙인다.
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
        // 오케스트레이션 줄은 실행 장부의 줄이 아니다.
        if rec.kind.is_some() {
            continue;
        }
        match rec.event.as_str() {
            "finished" => {
                // 같은 id 의 끝난 줄이 둘이면 먼저 본 것(최신)을 쓴다.
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

/// 하루 전 — 기록 시각과 파일 날짜가 자정 근처에서 어긋나는 몫이다. `0` 이면 제한 없음.
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

fn read_runs_in(dir: &std::path::Path, since_ms: u64, limit: usize) -> Vec<AuditRun> {
    let min = min_stamp_for(since_ms);
    let mut records: Vec<AuditRecord> = Vec::new();
    scan_newest_first(dir, min.as_deref(), |rec| {
        records.push(rec);
        true
    });
    join_runs(records, since_ms, limit)
}

/// **읽기 전용**이고 MCP 에는 없다(기록 화면은 사람을 위한 것이다 — AI 는 `get_operation_results` 로 제 실행을 읽는다).
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

/// 유닉스는 `0o600`.
fn open_append(dir: &std::path::Path, date: &str) -> std::io::Result<std::fs::File> {
    // 감사 로그에는 명령줄이 그대로 들어가 유닉스는 소유자만 읽고 쓰게 못 박는다. Windows 는 별도 ACL 이 필요 없다 — 감사 폴더가
    // 사용자 프로필 아래(`%APPDATA%\aynx`)라 그 ACL 로 이미 소유자에게만 제한된다.
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
