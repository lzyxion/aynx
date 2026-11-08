//! 오케스트레이션 **저장소** — Run 표 · 역할 토큰 표 · 한도 · 멱등 · 사건(seq) · 영속 · 감사(설계 B · C-1 · C-7 · E-2).
//! 세션 서버의 AI 평면(`server::ai::AiPlane`)이 한 벌 쥔다.
//!
//! 불변식:
//! - **잠금은 하나**(`inner`) — Task 생성/갱신 · 버전 비교(`conflict`) · DAG 순환 검사 · 한도 원자 예약 · 멱등 기록이 모두 그 안에서
//!   한 번에 일어난다. 그 잠금을 쥔 채로 다른 저장소(거울 · 작업안)의 잠금을 잡지 않는다.
//! - **변화 알림은 조건 변수**([`Orchestration::changed`]) — 작업안의 `wait_for_operation` 은 상태를 바꾸는 쪽이 여럿(Tauri 승인 ·
//!   실행기 · 게으른 만료)이라 250ms 폴링을 골랐다. 여기서는 상태를 바꾸는 길이 **이 파일의 [`Orchestration::after_change`]
//!   하나**로 모이므로 조건 변수가 더 단순하고 정확하다(놓칠 깨움이 없다 — 바꾸는 쪽은 늘 같은 잠금 안에서 `notify_all`).
//! - **역할 토큰**(작업자 · 검토자 — 턴마다)은 이 파일의 `tokens` 표에만 산다 — `Debug` 를 파생하지 않고 · 로그 · 이벤트 · 영속 파일 ·
//!   스냅숏 어디에도 싣지 않는다. 역할은 **이 표에서만** 읽는다(요청이 보낸 역할 글자는 믿지 않는다). 비교는 상수 시간([`crate::token::ct_eq`]).
//! - **조정자 토큰은 없다**: 조정자는 **프로듀서 채팅의 채팅 토큰**(`crate::chat_token` 종류 `producer` — 인증 때 확정한 `(chat, ProcId)`)에
//!   이 표가 붙인 역할이다 — 묶음 `Slot.coordinator = (gen, Seat{chat, proc})`. 묶음이 풀리는 때: 프로듀서 프로세스 끝(`coordinator_exited_seat`) ·
//!   중단(stopping) · Run 끝 · 세대 교체(`adopt_run`) · orphaned(애초에 메모리뿐).
//!   조율 요청은 예상 `runId` · `gen` 이 묶음과 맞을 때만(`tile.rs` — `stale-run` · `stale-generation` · `run-ended` · `not-coordinator`).
//!   타일 토큰(`crate::tile_token`)은 자리가 되지 못한다 — 타일의 `start_run` · `adopt_run` · 조율 호출은 모르는 도구(`tools.rs` `is_tool_for`).
//! - 작업자 · 검토자 토큰은 **턴마다** 뽑고(3차 3a — 첫 턴은 `spawn_worker`, 이어지는 턴은 `send_prompt`) 그 턴의 트리 종료가 확인될 때 ·
//!   생성 실패 · Run 이 stopped 가 될 때 거둔다(`attempts.rs` — `idle` 에는 산 토큰이 없다).
//! - **역할 토큰은 이름표지 자물쇠가 아니다**(설계 C-1 (가)) — 같은 Windows 계정의 프로세스는 읽을 수 있다. 보장하는 것은 정상
//!   에이전트의 역할 구분 · 귀속 · 실수 방지다.
//! - 사건마다 `seq` 를 올리고(Run 마다 단조) 영속 파일을 원자 교체하고 이벤트 `orchestration-changed {runId, seq}`(토큰 없음)를 낸다.
//!   **디스크 쓰기는 잠금 밖**(리뷰 F10): 잠금 안에서는 순서 있는 스냅숏만 쓰기 줄에 넣고, 쓰기 스레드 하나가 직렬화 · 원자 교체를 한다
//!   (디스크가 중단 · 개입 · 신호 · 인증을 막지 않는다). 서버 종료 · 저장소가 사라질 때 줄을 비운다.
//!   orphaned Run 은 바뀌지 않으므로 다시 쓰지 않는다.
//! - 감사는 고정 칸(`audit::OrchestrationAudit`)만 — 토큰 · Task 본문(goal · scope) 없음, 제목은 길이만.
//!
//! 조각(2026-10-27 분할 — 바깥 경로 `store::…` 는 재수출 그대로 · **잠금 · `Inner` 의 주인은 이 파일 하나**): `store/saver.rs`(영속 쓰기 줄 ·
//! 저장 확인 — `persist::save` 의 유일한 자리) · `store/view.rs`(Run 보기 · 목록 · 조회 메서드) · `store/rules.rs`(잠금 안의 판정 조각) ·
//! `store/lifecycle.rs`(수명 전이 · 시한 · 조정자 종료) · `store/auth.rs`(호출자 해석 · 조정자 묶음 · 작업자 예약 · 토큰).
//! 여기 남은 것(core): 사유 표 `reason`(`mcp/insight.rs` 가 이 파일에서 읽는다) · 타입(`Slot` · `Inner` · `Orchestration`) · 초기화 ·
//! 잠금 · `after_change`/`publish` · 감사 자료.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};

use serde_json::{json, Value};

use super::model::*;
use super::persist;
use crate::audit::{AuditLimits, AuditRecord, OrchestrationAudit};
use crate::server::log;
// 조각의 몸이 `super::roles` 등으로 부르는 형제 — 조각이 부모를 거쳐 같은 이름으로 닿게.
use super::{album, album_start, attempts, cleanup, integrate, progress, review, roles, verify};

mod archive;
mod auth;
mod lifecycle;
mod rules;
mod saver;
mod view;

pub(super) use auth::{bind_seat, coordinates, has_coordinator, revoke_coordinator, revoke_run, revoke_worker, unbind_coordinator};
pub(super) use rules::{
    admit_call, check_dependencies, conflict, human_slot, not_found_run, on_hold, release_request, request_seen, request_sha,
    reserve_request, settle_stopping, state_error, writable,
};
use rules::no_randomness;
use saver::Saver;
pub(super) use saver::{PersistMark, SaveWait};
pub(super) use view::view;

/// 서버 이벤트 — Run 에 사건이 생겼다(몸 `{runId, seq}` — 토큰 · 본문 없음). GUI 가 같은 이름으로 창에 중계한다(`RELAYED`).
pub(crate) const EVT_CHANGED: &str = "orchestration-changed";

/// 서버 이벤트(F4) — 도는 턴의 진행 칸이 바뀌었다(몸 `{runId, attemptId, turn}` — 토큰 · 본문 없음). **seq 를 올리지 않는 사건**이라 `wait_run`
/// 을 깨우지 않고 영속 쓰기도 없다(`Orchestration::attempt_turn_progress`). 보던 Run 의 보드만 다시 읽는다. GUI 가 같은 이름으로 중계한다(`RELAYED`).
pub(crate) const EVT_PROGRESS: &str = "orchestration-progress";

/// 이벤트를 내보내는 손(서버의 이벤트 방송).
pub(crate) type EmitFn = Arc<dyn Fn(&str, Value) + Send + Sync>;
/// 벽시계(epoch ms) — 시험이 끼운다.
pub(crate) type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

/// 조율 · 사람 명령의 거절 사유 — `code` 는 MCP · 프런트 계약 낱말(영어), `message` 는 AI 가 읽는 영어 문장.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OrchError {
    pub code: &'static str,
    pub message: String,
}

impl OrchError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        OrchError {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for OrchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// 거절 사유 낱말(설계 C-2 · B).
pub(crate) mod reason {
    pub const NOT_FOUND: &str = "not-found";
    // 앨범 보관함(`store/archive.rs`) — 작업자 worktree 가 남아 보관하지 않는다 · 보관한 파일을 읽지 못해(판 · 형식) 복원 · 삭제하지 않는다.
    pub const WORKTREES_LEFT: &str = "worktrees-left";
    pub const ARCHIVE_UNREADABLE: &str = "archive-unreadable";
    pub const RUN_PAUSED: &str = "run-paused";
    pub const RUN_STOPPED: &str = "run-stopped";
    pub const RUN_ORPHANED: &str = "run-orphaned";
    pub const STALE_GENERATION: &str = "stale-generation";
    pub const CONFLICT: &str = "conflict";
    pub const DEPENDENCY_CYCLE: &str = "dependency-cycle";
    pub const UNKNOWN_DEPENDENCY: &str = "unknown-dependency";
    pub const TOO_MANY_TASKS: &str = "too-many-tasks";
    pub const RATE_LIMITED: &str = "rate-limited";
    pub const TOO_MANY_WAITERS: &str = "too-many-waiters";
    pub const TOO_MANY_RUNS: &str = "too-many-runs";
    pub const WORKER_LIMIT: &str = "worker-limit";
    pub const INVALID_ARGUMENT: &str = "invalid-argument";
    pub const INVALID_STATE: &str = "invalid-state";
    pub const NOT_REPORTED: &str = "not-reported";
    pub const TASK_NOT_EDITABLE: &str = "task-not-editable";
    pub const RISK_NOT_CONFIRMED: &str = "risk-not-confirmed";
    pub const NOT_A_REPO: &str = "not-a-repo";
    pub const LIMIT_REACHED: &str = "limit-reached";
    pub const INTERNAL: &str = "internal";
    // 3단계 — 작업자 생성 · worktree.
    pub const TASK_BUSY: &str = "task-busy";
    pub const DEPENDENCY_NOT_ACCEPTED: &str = "dependency-not-accepted";
    pub const NEEDS_MERGE: &str = "needs-merge";
    pub const SPAWN_UNAVAILABLE: &str = "spawn-unavailable";
    pub const WORKTREE_FAILED: &str = "worktree-failed";
    pub const WORKTREE_DIRTY: &str = "worktree-dirty";
    pub const WORKTREE_IN_USE: &str = "worktree-in-use";
    pub const NOT_RUN_WORKTREE: &str = "not-run-worktree";
    pub const BRANCH_HAS_UNMERGED: &str = "branch-has-unmerged";
    // 4단계 — 보고 · 수락.
    pub const STALE_ATTEMPT: &str = "stale-attempt";
    pub const ALREADY_REPORTED: &str = "already-reported";
    pub const DIRTY_REPORT: &str = "dirty-report";
    pub const NOT_SUCCESS: &str = "not-success";
    pub const NO_COMMIT: &str = "no-commit";
    // 6단계 — 진행 기록(고정 대화를 아직 못 찾았거나 검증을 지나지 못했다).
    pub const TRANSCRIPT_UNAVAILABLE: &str = "transcript-unavailable";
    // 리뷰 F9 — 같은 requestId 의 첫 호출이 아직 효과를 내는 중이다.
    pub const REQUEST_IN_PROGRESS: &str = "request-in-progress";
    /// (F6) 같은 Run 의 같은 `requestId` 를 다른 도구 · 다른 입력이 썼다 — 프로듀서 채팅 단위 기록(`chat_token`)과 같은 낱말.
    pub const REQUEST_ID_REUSED: &str = crate::chat_token::REQUEST_ID_REUSED;
    // 10-15 — 서버가 집행하는 작업자 커밋(`commit_changes` · `commit.rs`). 작업자 MCP 에만 보인다.
    pub const HEAD_MOVED: &str = "head-moved";
    pub const BRANCH_MISMATCH: &str = "branch-mismatch";
    pub const WORKTREE_MISMATCH: &str = "worktree-mismatch";
    pub const FILTERS_CONFIGURED: &str = "filters-configured";
    pub const NO_GIT_IDENTITY: &str = "no-git-identity";
    pub const NOTHING_TO_COMMIT: &str = "nothing-to-commit";
    pub const PATH_OUTSIDE: &str = "path-outside";
    pub const COMMIT_FAILED: &str = "commit-failed";
    /// 보고가 Attempt 의 브랜치 · 기준과 맞지 않는다(`Report.mismatch`) — 수락할 수 없다.
    pub const REPORT_MISMATCH: &str = "report-mismatch";
    // 통합 설계 1단계(10-15) — 공용 git 실행기(`git.rs`) · 조정자 `get_diff`(`diff.rs`).
    /// git 출력이 상한을 넘었다 — 잘린 글을 전부인 척 쓰지 않는다.
    pub const OUTPUT_TOO_LARGE: &str = "output-too-large";
    /// 서버 집행 git 이 실패했다(`get_diff` — 커밋은 `commit-failed`).
    pub const GIT_FAILED: &str = "git-failed";
    // 통합 설계 2단계(10-15) — 영속 의도 · 취소 계약 · 보류 · Run 완료(`integrate.rs`).
    /// Run 이 보류 중이다(통합 ref 어긋남 · 의도 저장 실패 · 정리 대기) — 새 Job · 새 Attempt · 조율 쓰기 · 재개가 막힌다.
    pub const RUN_ON_HOLD: &str = "run-on-hold";
    /// 이 Run 의 다른 통합 작업이 진행 중이다(Run 당 하나).
    pub const INTEGRATION_BUSY: &str = "integration-busy";
    /// 통합이 올리기(커밋 단계) 중이라 취소할 수 없다 — 몇 초 뒤 다시.
    pub const INTEGRATION_COMMITTING: &str = "integration-committing";
    /// 이미 통합 ref 에 올라간 수락이다 — 뒤집기 · 취소 불가(되돌리기는 사람이 직접 — 4-7).
    pub const ALREADY_INTEGRATED: &str = "already-integrated";
    /// 통합이 실패했다(ref 트랜잭션 · 서버 git).
    pub const INTEGRATION_FAILED: &str = "integration-failed";
    /// Run 완료 조건을 채우지 못했다(통합 설계 3-4) — 메시지에 막는 것들.
    pub const NOT_COMPLETABLE: &str = "not-completable";
    // 통합 설계 3단계(10-15) — 통합(`accept.rs` · `merge.rs`).
    /// 이 PC 의 git 이 통합에 필요한 판(2.42)보다 낮다 — Run 시작 거절.
    pub const GIT_TOO_OLD: &str = "git-too-old";
    /// 저장소 git 설정이 자동 통합 지원 밖이다(병합 드라이버 · 필터 · renormalize · submodule — 메시지 앞에 사유 낱말).
    pub const GIT_UNSUPPORTED: &str = "git-unsupported";
    /// 내보낼 브랜치가 어느 worktree 에 체크아웃돼 있다.
    pub const EXPORT_CHECKED_OUT: &str = "export-checked-out";
    /// 내보낸 브랜치를 사람이 앱 밖에서 바꿨다 — 덮지 않는다.
    pub const EXPORT_BRANCH_MOVED: &str = "export-branch-moved";
    // 통합 설계 3b(10-16) — 충돌 해결 Attempt(`resolve.rs`).
    /// 충돌이 일반 텍스트 내용 충돌 밖이다(이름 바꿈/삭제 · 수정/삭제 · 바이너리 · 모드 · symlink · submodule …) — 해결 Attempt 를 받지 않는다.
    pub const CONFLICT_NEEDS_HUMAN: &str = "conflict-needs-human";
    /// 해결자의 커밋 · 보고에 충돌 표식이 남았다.
    pub const CONFLICT_MARKERS_LEFT: &str = "conflict-markers-left";
    /// 해결 보고의 `resolved` 가 충돌 경로 전부를 덮지 않는다.
    pub const UNRESOLVED_CONFLICTS: &str = "unresolved-conflicts";
    // 통합 설계 4단계(10-16) — 수락 전 검증(`verify.rs`).
    /// 검증이 통과하지 않았다(같은 보고의 검증 횟수를 다 썼다 — 새 Attempt 로) · 덮어쓰기 대상이 실패한 검증이 아니다.
    pub const VERIFY_FAILED: &str = "verify-failed";
    /// Run 당 검증 횟수 한도를 다 썼다.
    pub const VERIFY_LIMIT: &str = "verify-limit";
    /// 이 OS 에서는 검증을 돌릴 수 없다(명시적 스텁).
    pub const VERIFY_UNSUPPORTED: &str = "verify-unsupported";
    /// 사람 확인이 묶인 값(후보 · 명령 해시 · 통합 머리)이 지금과 다르다 — 다시 보고 확인한다.
    pub const APPROVAL_STALE: &str = "approval-stale";
    /// 사람 확인 대기 시한(30분)이 지났다.
    pub const APPROVAL_EXPIRED: &str = "approval-expired";
    // 통합 설계 5단계(10-16) — 검토자(`review.rs`).
    /// 그 보고(또는 이 Run)에 검토가 이미 돌고 있다 — 보고당 하나 · Run 당 동시 하나.
    pub const REVIEW_ACTIVE: &str = "review-active";
    /// 활성 검토가 끝나지 않았다 — 조정자 수락은 판정 뒤에.
    pub const REVIEW_PENDING: &str = "review-pending";
    // (3a) 옛 `review-required` · `review-changes-requested` 는 수락 규칙의 `accept-rule-unmet` 하나로 묶었다(3-2a).
    /// 검토 예산(`maxReviews`)을 다 썼다.
    pub const REVIEW_BUDGET_EXHAUSTED: &str = "review-budget-exhausted";
    /// 검토 자리의 추적 symlink 가 자리 밖을 가리킨다(9절 위험 5 확정) — 검토를 띄우지 않았다.
    pub const SYMLINK_OUTSIDE: &str = "symlink-outside";
    // 통합 설계 6단계(10-16) — 정리(`cleanup.rs`).
    /// 서버 임시 자리에 예상 밖 변경이 남았거나 아직 쓰는 프로세스가 있다 — 지우지 않고 남겼다(사람이 보고 [그래도 지우기]).
    pub const CLEANUP_PENDING: &str = "cleanup-pending";
    /// [정리] 대상이 아니다(이 Run 의 것이 아님 · 아직 열린 Task · 작업자가 살아 있음 · 내보낸 브랜치 없는 통합 ref …).
    pub const NOT_CLEANABLE: &str = "not-cleanable";
    // 3차 3a(10-16) — 헤드리스 작업자 · 맡기기 · 역할 · 수락 규칙(`roles.rs` · `resume.rs`).
    /// 이 Run 의 저장소가 지금 맡겨져 있지 않다(블록 없음 · 신원 어긋남 · 처음 읽은 저장소와 다름) — 새 Attempt · 새 턴 · 조정자 수락 거절.
    /// 맡기기 블록이 앱 밖에서 바뀌었다(받아들인 판 해시와 다름) — 적용하지 않는다.
    /// 고른 역할 id 가 맡기기의 역할 표에 없다.
    pub const UNKNOWN_ROLE: &str = "unknown-role";
    /// 그 역할을 지금 쓸 수 없다(손 편집의 모르는 글자 · 위험 확인 없는 `full`).
    pub const ROLE_INVALID: &str = "role-invalid";
    /// Attempt 의 역할이 맡기기에서 지워졌다(다음 턴 거절).
    pub const ROLE_REMOVED: &str = "role-removed";
    /// Attempt 의 역할의 CLI · 종류가 바뀌었다(같은 대화로 이을 수 없다).
    pub const ROLE_CHANGED: &str = "role-changed";
    /// 되돌림 한도(맡기기 `max_rework`)를 넘는다.
    pub const REWORK_LIMIT: &str = "rework-limit";
    /// 조정자 수락이 수락 규칙(필수 판정)을 채우지 못했다 — 메시지가 `{unmet, reviewsLeft, hint}` JSON.
    pub const ACCEPT_RULE_UNMET: &str = "accept-rule-unmet";
    /// 그 작업자의 턴이 아직 돈다 — 큐 없음(`wait_run until=ready attemptIds=[…]`). 메시지가 `{attemptIds}` JSON.
    pub const BUSY: &str = "busy";
    /// 고정 대화가 없다(첫 턴이 대화 id 를 알리지 못했다).
    pub const NO_CONVERSATION: &str = "no-conversation";
    /// 대화가 끊겼다(resume 의 대화 id 가 고정 id 와 달랐다) — 더는 이어 시킬 수 없다.
    pub const CONVERSATION_BROKEN: &str = "conversation-broken";
    /// Run 의 이어지는 턴 수 한도.
    pub const TURN_LIMIT: &str = "turn-limit";
    /// 지시 글이 인자 상한(24 KiB)을 넘는다.
    pub const TEXT_TOO_LONG: &str = "text-too-long";
    /// 이어지는 지시의 대상이 작업자(쓰기형)가 아니다(판정형은 한 턴).
    pub const NOT_A_WORKER: &str = "not-a-worker";
    /// 그 Attempt 는 이미 닫혔다(보고 · 중단 · 끝).
    pub const CLOSED: &str = "closed";
    /// 그 Attempt 는 보고했다(닫힘 — 반려 뒤 새 Attempt 로).
    pub const REPORTED: &str = "reported";
    /// 인자가 3차 계약과 맞지 않는다(예: `spawn_worker` 의 옛 `cli` 인자 — 조용히 무시하지 않는다).
    pub const BAD_ARGS: &str = "bad-args";
    // 3차 4단계(10-17) — 타일 토큰 · 조정자 묶음(`tile.rs` · 설계 3-1 · 리뷰 D4).
    /// 조율 요청의 `runId` 가 이 자리가 묶인 Run 이 아니다(늦게 온 다른 Run 의 요청 · 프로세스가 끝나 풀린 옛 Run).
    pub const STALE_RUN: &str = "stale-run";
    /// 그 Run 이 끝났다(중단 · 끝 · orphaned) — 묶음이 풀렸다.
    pub const RUN_ENDED: &str = "run-ended";
    /// 이 자리(프로듀서 채팅)는 어느 Run 의 조정자도 아니다.
    pub const NOT_COORDINATOR: &str = "not-coordinator";
    /// 전역 토큰(`mcp.json`)이다 — 조율은 오케스트레이션 탭의 프로듀서 채팅 토큰으로만(낱말은 옛 이름 그대로).
    pub const NOT_A_TILE: &str = "not-a-tile";
    /// 이 자리는 이미 다른 산 Run 의 조정자다.
    pub const ALREADY_COORDINATING: &str = "already-coordinating";
    // 3차 5단계(10-17) — AI 가 Run 을 연다(`start.rs` · 설계 3-2 · 3-4 · 리뷰 D12).
    /// `adopt_run` 의 대상이 아니다(조정자 CLI 가 끝나 멈춘 Run 만 — 메시지 JSON 의 `why`).
    pub const NOT_ADOPTABLE: &str = "not-adoptable";
    /// 사람 [재개] — 이 Run 에 지금 세대의 조정자가 없다(프로세스 끝 · 거두기) — 프로듀서 채팅이 `adopt_run` 으로 이어받거나 중단한다.
    pub const NO_COORDINATOR: &str = "no-coordinator";
    /// (2단계 단계 2 — 설계 2-3) 이 프로듀서 채팅은 이미 앨범 하나에 귀속됐다(채팅 하나 = 앨범 하나 · 메시지 JSON 의 `runId`).
    pub const ALREADY_PRODUCED: &str = "already-produced";
    /// 프로듀서 채팅의 `start_run` · `adopt_run` 저장소가 그 채팅의 스튜디오가 아니다.
    pub const OUT_OF_SCOPE_REPO: &str = "out-of-scope:repo";
    /// (설계 3-3) 그 자리의 `wait_run` 이 취소됐다(사람 interrupt · 거두기 · 프로세스 끝 · 묶음 해제).
    pub const WAIT_CANCELLED: &str = "wait-cancelled";
}

/// MCP 요청의 호출자 — `/mcp` 인증이 서버 표에서 정한다(`mcp/http.rs`). 토큰 값은 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Caller {
    /// 서버 전역 MCP 토큰(`mcp.json`) — 13개 도구 그대로 · 조율 도구는 `not-a-tile`(3차 4단계).
    Global,
    /// **로컬 AI 타일 · 감싸개 셸 타일의 토큰**(`crate::tile_token`: 살아 있는 `(stream, sessionEpoch)`). 읽기 13개 · DB · 작업안은 전역과 같은
    /// 판정이다. **자리가 되지 못한다** — 타일 도구 · 조율 도구는 모르는 도구(`tools.rs` `is_tool_for` 에 갈래가 없다).
    Tile { stream: String },
    /// Run 세대의 조정자 — 자리 판정(`tile.rs`)이 묶음 · `runId` · `gen` 을 확인한 **뒤에만** 만든다(토큰으로 직접 오는 길은 없다).
    Coordinator { run_id: String, gen: u32 },
    /// Attempt 의 작업자(3단계부터 발급).
    Worker { run_id: String, gen: u32, attempt_id: String },
    /// 검토 Attempt 의 검토자(통합 설계 3-3 — 5단계). 이름표지 자물쇠가 아니다(같은 계정 — 역할 기반 보조 검토).
    Reviewer { run_id: String, gen: u32, attempt_id: String },
    /// **사이드 채팅 프로세스**(사이드 채팅 v2 5단계 — `crate::chat_token`: 지금 프로세스 세대의 채팅). 읽기 도구만(DB · 작업안 · 조율 도구 없음) ·
    /// 사람이 연결 칩으로 고른 세션 하나만(`mcp/chat_read.rs` — 요청마다 서버 판정).
    SideChat { chat: String },
    /// **프로듀서 채팅 프로세스**(오케스트레이션 2단계 단계 2 — 설계 2-2): 채팅 토큰(종류 `producer`)으로 인증한 `(채팅, 프로세스 세대)`.
    /// **인증 때 확정한 세대 그대로** — 요청 처리 어디서도 지금 세대로 바꾸지 않는다(묶음 · 멱등 · 정리는 이 값을 정확히 비교한다).
    /// 읽기 13 · DB · 타일 도구 · 조율 도구(조정자 판정은 [`Seat`] 묶음 — `tile.rs`).
    Producer { chat: String, proc: crate::server::chat_proc::ProcId },
}

/// **조정자 자리**(설계 2-3) — Run 세대의 묶음(`Slot.coordinator`)이 가리키는 것: 프로듀서 채팅 하나의 프로세스 세대 `(chat, proc)`. 자리 열쇠는
/// `ProcId` 까지다: 다시 띄운 같은 채팅(새 세대)은 다른 자리라 옛 묶음을 물려받지 않는다(그래서 `adopt_run`). 1단계의 타일 자리(`Tile(stream)`)는
/// 걷었다(묶음은 메모리뿐이다 — 서버 재시작 = orphaned).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Seat {
    pub chat: String,
    pub proc: crate::server::chat_proc::ProcId,
}

impl Seat {
    /// 같은 주인(같은 채팅 — 세대 무관)인가 — 풀린 자리의 늦은 요청을 `stale-run` 으로 답할 때(`past_coordinators`).
    pub(crate) fn same_owner(&self, other: &Seat) -> bool {
        self.chat == other.chat
    }

    /// 시험 손 — 세대 없는 자리(`ProcId::NONE` — 제품에서는 서지 않는 값). 묶음 · 판정 시험이 채팅 id 하나로 자리를 세운다.
    #[cfg(test)]
    pub(crate) fn test(chat: &str) -> Seat {
        Seat { chat: chat.to_string(), proc: crate::server::chat_proc::ProcId::NONE }
    }
}

/// **그 자리의 깨움 커서 · 대기 취소**(설계 3-3 — 지금 세대의 묶인 자리 하나에 대해 · 메모리만). `pending` = 이 턴에 유효한 조회 응답으로 돌려준
/// 스냅숏 범위(잠정) · `committed` = 그 턴이 **자연 종료**로 끝나 확정된 범위 · `cancel_gen` = 이 자리의 `wait_run` 을 깨워 `wait-cancelled` 로
/// 내보낼 때마다 +1(사람 interrupt · 거두기 · 프로세스 끝 · 묶음 해제). 묶음이 바뀌면 새 자리는 옛 `committed` 를 물려받지 않는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SeatCursor {
    pub committed: u64,
    pub pending: u64,
    pub cancel_gen: u64,
}

/// 토큰 표의 한 칸 — 토큰 값은 표의 열쇠 쪽에만 있다.
#[derive(Clone)]
pub(super) struct Binding {
    pub role: Role,
    pub run_id: String,
    pub gen: u32,
    pub attempt_id: Option<String>,
}

/// Run 하나 + 메모리에만 있는 칸(호출 빈도 · 대기 수 · 작업자 예약).
pub(super) struct Slot {
    pub run: Run,
    /// 최근 조율 도구 호출 시각(분당 한도 — 60초 창).
    pub calls: VecDeque<u64>,
    /// 지금 `wait_run` 중인 수.
    pub waiters: u32,
    /// 예약했지만 아직 Attempt 로 서지 않은 작업자 슬롯(3단계).
    pub reserved_workers: u32,
    /// 조정자 자리의 (세대, [`Seat`]) — 프로듀서 채팅의 `start_run` · `adopt_run` 이 묶는다(`start.rs`). 이 묶음이 곧 **조정자 역할**이다(그 세대의
    /// 채팅 토큰이 조정자로 판정된다 · `tile.rs`). 그 프로세스가 끝나면 레지스트리가 토큰을 거둔 뒤 Run 을 멈춘다
    /// ([`Orchestration::coordinator_exited_seat`]). 메모리만(영속 안 함 — 서버 재시작 = orphaned · 묶음 없음).
    pub coordinator: Option<(u32, Seat)>,
    /// 이 Run 에 묶였다가 풀린 자리(최근 것 몇 — 메모리만). 풀린 프로듀서의 늦은 조율 요청을 `not-coordinator` 가 아니라 `stale-run` ·
    /// `stale-generation` 으로 답하려고(설계 3-1 표 "CLI 종료 → 옛 Run 의 조율은 stale-run").
    pub past_coordinators: VecDeque<Seat>,
    /// 지금 묶인 자리의 커서 · 대기 취소 세대([`SeatCursor`] — 묶음이 바뀔 때 새로 · 메모리만).
    pub cursor: SeatCursor,
    /// **앱이 깨움의 산 칸**(2단계 단계 4 — `wake.rs`: 최소 간격 · 사람 말 사이 셈 · 무반응 연속 · 나가 있는 깨움 · 재시도). Run 에 귀속(adopt ·
    /// 프로세스 재시작 무관) · 메모리만 — 누적은 영속 칸 `Run.wakes` 가 센다(서버 재시작 = orphaned 라 깨움이 없다).
    pub wake: super::wake::WakeMem,
    /// orphaned Run 의 **잔존 자원**(서버 시작 때 한 번 — 남은 프로세스 · 반쯤 만든 worktree, 설계 C-7). 사람 보기에만.
    pub leftovers: Vec<Value>,
    /// 마지막으로 읽은 이 Run 저장소의 맡기기(3a — `get_run` · 생성 · 턴 · 수락이 잠금 밖에서 새로 읽을 때마다 바꾼다). 보기(`roles` ·
    /// `acceptRules` · `delegation`)가 이것을 쓴다 — 판정은 늘 그 자리에서 새로 읽은 것으로 한다. 메모리만(비밀 없음 · 지침 본문은 보기에 안 실림).
    pub inputs_seen: Option<super::album::RunInputs>,
    /// Attempt 마다 고정 대화 파일 지켜보기(6단계 — `progress.rs`). **메모리만**(경로 · 크기 · 마지막 증가 — 본문 없음).
    pub transcripts: HashMap<String, super::progress::Watch>,
    /// **진행 중인 요청**(리뷰 F9) — `requestId` → (도구, 입력 해시 — F6 [`rules::request_sha`]). 잠금 밖에서 효과를 내는 쓰기(`send_prompt` ·
    /// worktree 쓰기)가 효과 **전에** 세운다. 완료 기록(`run.requests` — 영속)과 한 `requestId` 공간이다([`request_seen`]). 메모리만.
    pub pending_requests: HashMap<String, (&'static str, String)>,
    /// **worktree 자리 예약**(리뷰 F4) — 실제 경로 열쇠(`worktree::wt_key`) → `removing` · `creating`. 지우기 · 만들기가 효과 전에 세우고
    /// 이어 쓰기 · 다른 지우기 · 만들기가 같은 잠금 안에서 본다. 메모리만.
    pub wt_busy: HashMap<String, &'static str>,
    /// 살아 있는 검증 수(통합 설계 5-3 — `verify.rs` 가 `verifying` 으로 넘길 때 올리고 트리 종료 확인 뒤 내린다). `settle_stopping` 이 이것도
    /// 0 일 때만 stopped.
    pub verify_trees: u32,
    /// 진행 중 검증의 손잡이(Job id → 취소 깃발 — 중단 · 취소 · 세대 교체가 트리를 끝내게). 메모리만.
    pub verify_runs: HashMap<String, Arc<super::verify::VerifyCtl>>,
    /// 검증 출력 꼬리(Job id → 끝 8 KiB · 제어 문자 걷은 글) — **메모리만**(영속 · 감사에는 길이 · 해시만, 통합 설계 2-4).
    pub verify_tails: HashMap<String, String>,
    /// 캐시 키 파일들의 지난 blob(N2 — 다르면 보존 폴더를 지운다). **메모리만 — 영속하지 않는다**(6단계 판단): 재시작 뒤 Run 은 orphaned 라
    /// 다시 검증하지 않고(자동 재개 없음), 모르는 키는 "바뀜" 으로 보아 지우는 쪽(N2 의 안전한 방향)이다. 그 자리는 폐기 정책이 지운다.
    pub verify_cache_key: Option<String>,
    /// 무효화된 검토자(통합 설계 3-3 — 보고 교체 · 반려 · 취소 · 수락)의 멈출 몫 — 잠금 안에서 `stopping` 으로 올리고 여기 쌓으면 부른
    /// 쪽이 잠금 밖에서 [`Orchestration::drain_stops`] 로 서버 손에 맡긴다(서버 시계도 비운다). 메모리만.
    pub stop_queue: Vec<String>,
    /// 서버 임시 자리 폐기(통합 설계 6-2 — `cleanup.rs`)를 이 서버 수명에서 이미 했나. 끝난 Run(done · stopped)과 orphaned(재시작 뒤)는
    /// 서버 시계가 한 번 정리하고 이 칸을 세운다. 메모리만 — **서버가 다시 뜨면 다시 정리한다**(재시작 재정리).
    pub temp_swept: bool,
    /// 이 앨범의 병합이 도는 중(`album_merge.rs` — 메모리만 · 한 번에 하나).
    pub merging: bool,
    /// ref 회수(candidate · conflict — `cleanup.rs`)를 마지막으로 본 때의 판(끝난 Job 수 · 종결 Task 수). 다르면 서버 시계가 다시 본다. 메모리만.
    pub ref_sig: Option<(usize, usize)>,
    /// 정리가 도는 중(서버 시계 · 사람 [정리] 가 겹치지 않게). 메모리만.
    pub sweeping: bool,
    /// 이 서버 수명에서 검증 트리 종료를 확인하지 못한 적이 있다(`stop-unconfirmed`) — 정리는 검증 자리를 "아직 쓰는 중" 으로 본다. 메모리만.
    /// 남은 손잡이([`Slot::verify_leftovers`])가 모두 확인되면 내린다.
    pub verify_unconfirmed: bool,
    /// 종료를 확인하지 못한 검증 트리의 손잡이(리뷰 F8 — Job id · 손잡이). 이것이 있는 동안 `verify_trees` 가 내려가지 않고 새 검증이
    /// 서지 않는다. 서버 시계가 다시 확인한다(`verify::reconfirm_leftovers`). 메모리만.
    pub verify_leftovers: Vec<(String, super::verify::Leftover)>,
    /// 올리기 결과를 모르는 `committing` Job(리뷰 F7) — 서버 시계가 증거 ref 로 다시 판정한다. 메모리만(재시작 뒤에는 재시작 복구가 본다).
    pub commit_unknown: Vec<String>,
    /// 영속 저장 상태(F7 — 마지막 저장 seq · 이어지는 실패). 쓰기 스레드의 결과 알림이 고친다([`Orchestration::on_saved`]). 메모리만.
    pub persist: PersistMark,
    /// 보관 중(`store/archive.rs`) — 마지막 스냅숏을 쓰기 줄에 넣은 뒤로는 이 Run 을 더 넣지 않고(옮긴 파일이 되살아나지 않게) 정리도 서지 않는다. 메모리만.
    pub archiving: bool,
}

impl Slot {
    fn new(run: Run) -> Self {
        Slot {
            run,
            calls: VecDeque::new(),
            waiters: 0,
            reserved_workers: 0,
            coordinator: None,
            past_coordinators: VecDeque::new(),
            cursor: SeatCursor::default(),
            wake: Default::default(),
            leftovers: Vec::new(),
            inputs_seen: None,
            transcripts: HashMap::new(),
            pending_requests: HashMap::new(),
            wt_busy: HashMap::new(),
            verify_trees: 0,
            verify_runs: HashMap::new(),
            verify_tails: HashMap::new(),
            verify_cache_key: None,
            stop_queue: Vec::new(),
            temp_swept: false,
            merging: false,
            ref_sig: None,
            sweeping: false,
            verify_unconfirmed: false,
            verify_leftovers: Vec::new(),
            commit_unknown: Vec::new(),
            persist: PersistMark::default(),
            archiving: false,
        }
    }
}

/// 잠금 하나 아래의 표. **`Debug` 를 파생하지 않는다**(토큰).
pub(super) struct Inner {
    pub runs: BTreeMap<String, Slot>,
    /// (토큰, 묶음) — 조회는 상수 시간 비교로 전부 훑는다.
    pub tokens: Vec<(String, Binding)>,
    /// **귀속 색인**(2단계 단계 2 — 설계 2-3 · R5): 프로듀서 채팅 id → 그 채팅이 연 · 이어받은 Run. 권위 있는 자리는 Run 파일의 `producers`
    /// (영속)이고 이것은 그 메모리 색인이다 — 서버 시작 때 Run 파일들에서 다시 짓고([`Orchestration::rebuild_producer_index`]) Run 을 세우는 ·
    /// 이어받는 잠금 안에서 함께 고친다. 지우지 않는다(채팅 하나 = 앨범 하나 — 평생). 귀속은 권한이 아니다(묶음을 세우지 않는다).
    pub producer_ever: HashMap<String, String>,
}

/// 오케스트레이션 저장소 — 세션 서버에 한 벌.
pub(crate) struct Orchestration {
    pub(super) inner: Mutex<Inner>,
    /// 변화 알림 — `wait_run` 이 잔다.
    pub(super) changed: Condvar,
    /// 영속 폴더(`None` = 쓰지 않는다 — 시험).
    pub(super) dir: Option<PathBuf>,
    pub(super) emit: EmitFn,
    /// 감사 쓰기 스레드로 가는 손(꺼져 있으면 `None`).
    audit: Mutex<Option<mpsc::Sender<AuditRecord>>>,
    clock: Clock,
    /// 작업자를 띄우고 멈추는 손(3단계 — 서버가 `server::workers` 를 꽂는다, 시험은 가짜). 없으면 `spawn_worker` 는 `spawn-unavailable`.
    pub(super) launcher: std::sync::RwLock<Option<Arc<dyn super::spawn::WorkerLauncher>>>,
    /// worktree 의 git 상태를 읽는 손(4단계 — 보고 · 보고 뒤 변경 · 이어 쓰기 확인). 기본은 진짜 git(`report::git_probe`), 시험이 갈아 끼운다.
    pub(super) probe: std::sync::RwLock<super::report::Probe>,
    #[cfg(test)]
    pub(crate) test_config: Mutex<Option<super::model::AlbumConfig>>,
    pub(super) album_source: std::sync::RwLock<super::album::AlbumSource>,
    /// CLI 대화 루트를 정하는 손(6단계 — 기본은 `progress::cli_roots`, 시험이 임시 폴더로 갈아 끼운다).
    pub(super) transcript_roots: std::sync::RwLock<Option<super::progress::RootsFn>>,
    /// `send_prompt` 가 이어지는 턴의 생성 결과(섰다 · 못 섰다)를 기다리는 상한(ms — 3a · 시험이 줄인다).
    pub(super) turn_start_wait_ms: std::sync::atomic::AtomicU64,
    /// 영속 쓰기 줄(리뷰 F10) — 잠금 안에서는 순서 있는 스냅숏만 넣고 직렬화 · 원자 교체는 쓰기 스레드 하나가 한다.
    saver: Option<Saver>,
    /// 감독 사건(리뷰 F11 · 설계 C-7 "알림 — 서버가 낸다") — 사건 id · 미확인 큐(`notice.rs`).
    pub(super) notices: super::notice::Notices,
    /// 통합 ref 를 읽고 올리는 손(통합 설계 4-3 ⑥ · 4-4 — 서버는 진짜 git `integrate::GitRefs` 를 꽂고, 시험은 가짜). `None` 이면
    /// 올리기 · 재시작 복구 판정을 하지 않는다.
    pub(super) integrator: std::sync::RwLock<Option<Arc<dyn super::integrate::IntegrationGit>>>,
    /// 자기 자신(약한 참조 — 통합 작업을 따로 스레드에서 돌리려고, 통합 설계 3단계 `accept.rs`). 서버가 [`Orchestration::install_self`] 로
    /// 채운다. 없으면(시험) 통합 작업은 부른 스레드에서 끝까지 돈다.
    pub(super) me: std::sync::RwLock<std::sync::Weak<Orchestration>>,
    /// 통합 올리기의 단계 갈고리(시험 — 그 틈에 취소 · 중단을 끼우거나 "죽음" 을 흉내 낸다).
    #[cfg(test)]
    pub(crate) integrate_hook: Mutex<Option<super::integrate::IntegrateHook>>,
    /// 시험의 명시적 비영속 모드(리뷰 F10 — [`Orchestration::set_ephemeral`]).
    #[cfg(test)]
    ephemeral: std::sync::atomic::AtomicBool,
    /// 검증 시한의 "1분" 길이(ms — 시험이 줄인다). 제품은 늘 60 000.
    pub(super) verify_minute_ms: std::sync::atomic::AtomicU64,
    /// worktree 곁 파일(`worktrees.json`) 자리 — 서버 임시 자리의 소유 기록(통합 설계 6-2 `role`) · 작업자 worktree 정리. 서버가
    /// [`Orchestration::set_sidecar`] 로 꽂는다(시험은 임시 파일 · 없으면 곁 기록 없이 Run 장부만으로 판정).
    pub(super) sidecar: std::sync::RwLock<Option<PathBuf>>,
    /// 보관 · 복원 · 영구 삭제를 한 줄로(`store/archive.rs`) — 삭제가 ref 를 지우는 동안 복원이 파일을 되살리지 않게. 잠금 순서는 이것 → 표 잠금 한 방향.
    pub(super) archive_ops: Mutex<()>,
    /// 보관함 목록에서 건너뛰며 로그를 남긴 파일 이름(서버 수명에 한 번씩).
    pub(super) archive_skips: Mutex<std::collections::HashSet<String>>,
}

/// Run 시작 — AI 타일의 `start_run`(`start.rs`)이 맡기기 안에서 정한 것. (3차 6단계) 2차 시작 대화의 칸(작업자 권한 · 허용 CLI · 붙이기 ·
/// 자동 종료 · 검토 필수 · 검토자 CLI)은 걷었다 — 작업자 · 판정형은 맡기기의 역할 표가 정한다.
#[derive(Debug, Clone)]
pub(crate) struct StartRun {
    pub name: String,
    pub repo: String,
    pub worktree_dir: String,
    pub limits: Limits,
    /// 수락 전 검증(통합 설계 5절) — 맡기기의 사본(`start.rs` — 시작 때 고정).
    pub verify: Option<VerifyConfig>,
}

const MINUTE_MS: u64 = 60_000;

/// Run 들의 `producers` → 귀속 색인(채팅 → Run). 한 채팅이 여러 파일에 있으면(옛 손 편집 등) 먼저 연 Run(`created_at`)을 둔다 — 어느 쪽이든
/// 그 채팅은 새 앨범을 열 수 없다(좁은 쪽). 순수.
pub(super) fn producer_index<'a>(runs: impl Iterator<Item = &'a Run>) -> HashMap<String, String> {
    let mut sorted: Vec<&Run> = runs.collect();
    sorted.sort_by_key(|r| (r.created_at, r.id.clone()));
    let mut out = HashMap::new();
    for r in sorted {
        for c in &r.producers {
            out.entry(c.clone()).or_insert_with(|| r.id.clone());
        }
    }
    out
}

impl Orchestration {
    /// 저장소를 세운다 — `dir` 이 있으면 그 폴더의 Run 파일을 **orphaned** 로 올린다(설계 C-7).
    pub(crate) fn new(dir: Option<PathBuf>, emit: EmitFn, audit: Option<mpsc::Sender<AuditRecord>>) -> Self {
        Self::with_clock(dir, emit, audit, Arc::new(crate::operations::now_ms))
    }

    pub(crate) fn with_clock(
        dir: Option<PathBuf>,
        emit: EmitFn,
        audit: Option<mpsc::Sender<AuditRecord>>,
        clock: Clock,
    ) -> Self {
        let mut runs = BTreeMap::new();
        if let Some(d) = &dir {
            let loaded = persist::load_orphans(d, |name, why| {
                log::line(format!("orchestration — skipped {name}: {why}"));
            });
            if !loaded.is_empty() {
                log::line(format!("orchestration — {} run file(s) loaded as orphaned (read-only)", loaded.len()));
            }
            for run in loaded {
                let mut slot = Slot::new(run);
                // 파일에서 읽었다 = 그 seq 까지는 디스크에 있다.
                slot.persist.last_saved_seq = Some(slot.run.seq);
                slot.leftovers = super::attempts::leftovers_of(&slot.run);
                if !slot.leftovers.is_empty() {
                    log::line(format!(
                        "orchestration — {} has {} leftover worker resource(s) to review",
                        slot.run.id,
                        slot.leftovers.len()
                    ));
                }
                runs.insert(slot.run.id.clone(), slot);
            }
        }
        // (F10) 닫힌 AI Run 도 시작 빈도에 센다 — 보관함의 최근 파일만(창 판정은 셈 때 `created_at` 으로).
        let saver = dir.clone().and_then(Saver::start);
        // (2단계 단계 2) 귀속 색인 — Run 파일들의 `producers` 에서 다시 짓는다(재시작 뒤에도 채팅 하나 = 앨범 하나 · 설계 2-3).
        let producer_ever = producer_index(runs.values().map(|s| &s.run));
        Orchestration {
            inner: Mutex::new(Inner {
                runs,
                tokens: Vec::new(),
                producer_ever,
            }),
            changed: Condvar::new(),
            dir,
            saver,
            notices: Default::default(),
            integrator: std::sync::RwLock::new(None),
            me: std::sync::RwLock::new(std::sync::Weak::new()),
            #[cfg(test)]
            integrate_hook: Mutex::new(None),
            #[cfg(test)]
            ephemeral: std::sync::atomic::AtomicBool::new(false),
            verify_minute_ms: std::sync::atomic::AtomicU64::new(MINUTE_MS),
            sidecar: std::sync::RwLock::new(None),
            archive_ops: Mutex::new(()),
            archive_skips: Mutex::default(),
            emit,
            audit: Mutex::new(audit),
            clock,
            launcher: std::sync::RwLock::new(None),
            probe: std::sync::RwLock::new(Arc::new(super::report::git_probe)),
            #[cfg(test)]
            test_config: Mutex::new(None),
            album_source: std::sync::RwLock::new(super::album::default_source()),
            transcript_roots: std::sync::RwLock::new(None),
            turn_start_wait_ms: std::sync::atomic::AtomicU64::new(super::resume::TURN_START_WAIT_MS),
        }
    }

    /// `send_prompt` 의 생성 결과 대기 상한을 바꾼다(시험).
    #[cfg(test)]
    pub(crate) fn set_turn_start_wait_ms(&self, ms: u64) {
        self.turn_start_wait_ms.store(ms, std::sync::atomic::Ordering::SeqCst);
    }

    /// worktree git 읽기 손을 갈아 끼운다(시험).
    #[cfg(test)]
    pub(crate) fn set_probe(&self, p: super::report::Probe) {
        *self.probe.write().unwrap_or_else(|e| e.into_inner()) = p;
    }

    pub(super) fn probe(&self) -> super::report::Probe {
        self.probe.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// 작업자 띄우기 손을 꽂는다(서버 시작 — `serve::run`, 시험).
    pub(crate) fn set_launcher(&self, l: Arc<dyn super::spawn::WorkerLauncher>) {
        *self.launcher.write().unwrap_or_else(|e| e.into_inner()) = Some(l);
    }

    pub(super) fn launcher(&self) -> Option<Arc<dyn super::spawn::WorkerLauncher>> {
        self.launcher.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub(super) fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(super) fn now(&self) -> u64 {
        (self.clock)()
    }

    /// 사건 뒤 — 영속 · 이벤트 · 깨우기. **같은 잠금 안에서** 부른다(넣는 순서 = 사건 순서). 잠금 안에서는 스냅숏(복제)을 쓰기 줄에
    /// 넣기만 하고, 직렬화 · 원자 교체(`sync_all`)는 쓰기 스레드가 잠금 밖에서 한다(리뷰 F10 — 디스크가 중단 · 개입 · 신호를 막지 않게).
    pub(super) fn after_change(&self, inner: &Inner, run_id: &str) {
        let _ = self.publish(inner, run_id, false, false);
    }

    /// [`Self::after_change`] 와 같되 **저장 결과를 돌려받는다**(통합 설계 4-3 ⑥ — 의도 저장 확인). 잠금 밖에서 [`SaveWait::wait`].
    pub(super) fn after_change_confirmed(&self, inner: &Inner, run_id: &str) -> SaveWait {
        self.publish(inner, run_id, true, false)
    }

    /// orphaned Run 을 한 번 쓴다(재시작 복구가 판정을 남길 때 — `integrate.rs`). 평소의 orphaned 는 바뀌지 않아 다시 쓰지 않는다.
    pub(super) fn save_orphaned(&self, inner: &Inner, run_id: &str) {
        let _ = self.publish(inner, run_id, false, true);
    }

    /// 스냅숏을 쓰기 줄에 넣고(확인 손을 달 수 있다) 이벤트 · 깨우기.
    fn publish(&self, inner: &Inner, run_id: &str, confirm: bool, orphaned_too: bool) -> SaveWait {
        // 확인을 청했는데 저장기가 없으면 실패(리뷰 F10) — 시험의 명시적 비영속 모드만 예외.
        let mut wait = if confirm && !self.ephemeral() { SaveWait::Missing } else { SaveWait::Off };
        if let Some(slot) = inner.runs.get(run_id) {
            if (slot.run.state != RunState::Orphaned || orphaned_too) && !slot.archiving {
                if let Some(s) = &self.saver {
                    let ack = if confirm {
                        let (tx, rx) = mpsc::channel();
                        wait = SaveWait::Pending(rx);
                        Some(tx)
                    } else {
                        None
                    };
                    s.push(slot.run.clone(), ack);
                }
            }
            (self.emit)(EVT_CHANGED, json!({ "runId": run_id, "seq": slot.run.seq }));
        }
        self.changed.notify_all();
        wait
    }

    /// **시험의 명시적 비영속 모드**(리뷰 F10) — 켜면 저장기가 없어도 의도 저장 확인을 성공으로 본다. 제품 빌드에는 이 손이 없다
    /// (제품은 저장기가 없으면 통합 올리기가 `persist-failed`).
    #[cfg(test)]
    pub(crate) fn set_ephemeral(&self, on: bool) {
        self.ephemeral.store(on, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    fn ephemeral(&self) -> bool {
        self.ephemeral.load(std::sync::atomic::Ordering::SeqCst)
    }

    #[cfg(not(test))]
    fn ephemeral(&self) -> bool {
        false
    }

    /// 시험 — 영속 쓰기를 실패시킨다(디스크 오류 흉내).
    #[cfg(test)]
    pub(crate) fn set_save_fault(&self, on: bool) {
        if let Some(s) = &self.saver {
            s.fault.store(on, std::sync::atomic::Ordering::SeqCst);
        }
    }

    /// 영속 쓰기 줄이 비기를 기다린다(상한 5초 — 서버 종료 · 시험).
    pub(crate) fn flush_saves(&self) {
        if let Some(s) = &self.saver {
            s.flush(std::time::Duration::from_secs(5));
        }
    }

    /// 저장 결과 알림을 쓰기 줄에 꽂는다(F7 — `install_self` 가 부른다). 손은 약한 참조만 쥔다(저장소 ↔ 쓰기 줄 고리 없음).
    pub(super) fn install_save_hook(self: &Arc<Self>) {
        if let Some(s) = &self.saver {
            let me = Arc::downgrade(self);
            s.set_hook(Arc::new(move |run_id: &str, seq: u64, result: Result<(), &'static str>| {
                if let Some(o) = me.upgrade() {
                    o.on_saved(run_id, seq, result);
                }
            }));
        }
    }

    /// 저장 결과 하나(F7 — 쓰기 스레드에서 · saver 잠금 밖). 저장 상태를 고치고, **실패 표지가 바뀌었을 때만**(생김 · 지워짐) 사건
    /// `persist_failed` · `persist_recovered` 로 seq 를 올리고 이벤트를 낸다 — 보드가 다시 읽게(seq 가 앞서야 읽는다).
    ///
    /// **고리 끊기**: 그 사건은 쓰기 줄에 넣지 않는다([`Self::announce`] — 이벤트 · 깨우기만). 그래서 실패 → 사건 → 다시 저장 → 실패 …
    /// 고리가 생기지 않는다(디스크가 번갈아 성공 · 실패해도). 사건 줄은 다음 진짜 변경의 스냅숏에 함께 실린다(그 전에 서버가 끝나면 그 한
    /// 줄만 잃는다 — 실패 중엔 어차피 못 쓴 줄이다). orphaned Run 은 바꾸지 않는다(상태만 고친다).
    fn on_saved(&self, run_id: &str, seq: u64, result: Result<(), &'static str>) {
        let now = self.now();
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return };
        let Some(action) = slot.persist.record(seq, result, now) else { return };
        if slot.run.state != RunState::Orphaned {
            slot.run.bump(now, Actor::Server, action, None, result.err().unwrap_or("ok"));
        }
        self.announce(&g, run_id);
    }

    /// 이벤트 · 깨우기만(쓰기 줄에 넣지 않는다 — F7 저장 상태 사건).
    fn announce(&self, inner: &Inner, run_id: &str) {
        if let Some(slot) = inner.runs.get(run_id) {
            (self.emit)(EVT_CHANGED, json!({ "runId": run_id, "seq": slot.run.seq }));
        }
        self.changed.notify_all();
    }

    /// 감사 한 줄(고정 칸) — 잠금 밖에서 부른다. 실패는 삼킨다(감사가 조율을 막지 않는다).
    pub(super) fn audit(&self, event: &str, run_id: &str, detail: OrchestrationAudit) {
        let guard = self.audit.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(AuditRecord::orchestration(event, run_id, detail, self.now()));
        }
    }

}

pub(super) fn audit_limits(l: &Limits) -> AuditLimits {
    AuditLimits {
        max_tasks: l.max_tasks,
        max_calls_per_minute: l.max_calls_per_minute,
        max_waiters: l.max_waiters,
        coordination_minutes: l.coordination_minutes,
        execution_grace_minutes: l.execution_grace_minutes,
        max_concurrent_workers: l.max_concurrent_workers,
        max_total_workers: l.max_total_workers,
        max_deliveries: l.max_deliveries,
    }
}

pub(super) fn human_detail(gen: u32, state: RunState) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: Actor::Human.as_str().into(),
        run_state: Some(state.as_str().into()),
        ..Default::default()
    }
}

fn server_detail(gen: u32, state: RunState) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: Actor::Server.as_str().into(),
        run_state: Some(state.as_str().into()),
        ..Default::default()
    }
}

fn limit_detail(gen: u32, limit: &str, state: RunState) -> OrchestrationAudit {
    OrchestrationAudit {
        limit: Some(limit.into()),
        ..server_detail(gen, state)
    }
}
