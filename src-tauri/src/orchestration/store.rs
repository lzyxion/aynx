//! 오케스트레이션 저장소 — Run 표 · 역할 토큰 표 · 한도 · 멱등 · 사건(seq) · 영속 · 감사. 잠금 · `Inner` 의 주인은 이 파일 하나다(조각은 `store/`).
//! - **잠금은 하나**(`inner`) — Task 생성/갱신 · 버전 비교 · 순환 검사 · 한도 예약 · 멱등이 모두 그 안에서 한 번에. 그 잠금을 쥔 채 다른 저장소(거울 · 작업안)의 잠금을 잡지 않는다.
//! - 변화 알림은 조건 변수 — 상태를 바꾸는 길이 [`Orchestration::after_change`] 하나로 모여 놓칠 깨움이 없다(같은 잠금 안에서 `notify_all`).
//! - **역할 토큰**(작업자 · 검토자 — 턴마다)은 `tokens` 표에만 산다 — `Debug` 파생 없음 · 로그 · 이벤트 · 영속 파일 · 스냅숏에 싣지 않는다.
//!   역할은 이 표에서만 읽고(요청이 보낸 역할 글자는 믿지 않는다) 비교는 상수 시간([`crate::token::ct_eq`]).
//! - **조정자 토큰은 없다** — 조정자는 프로듀서 채팅의 채팅 토큰(인증 때 확정한 `(chat, ProcId)`)에 이 표의 묶음(`Slot.coordinator`)이 붙인 역할이다.
//!   묶음은 프로세스 끝 · 중단 · Run 끝 · 세대 교체(`adopt_run`) 때 풀리고 메모리뿐이다. 조율 요청은 예상 `runId` · `gen` 이 묶음과 맞을 때만(`tile.rs`).
//! - 타일 토큰은 자리가 되지 못한다 — 타일의 `adopt_run` · 조율 호출은 모르는 도구(`tools.rs` `is_tool_for`).
//! - 작업자 · 검토자 토큰은 그 턴의 트리 종료 확인 · 생성 실패 · Run stopped 때 거둔다 — `idle` 에는 산 토큰이 없다.
//! - **역할 토큰은 이름표지 자물쇠가 아니다** — 같은 Windows 계정의 프로세스는 읽을 수 있다(→ docs/invariants.md 전문 9).
//! - **디스크 쓰기는 잠금 밖** — 잠금 안에서는 순서 있는 스냅숏만 쓰기 줄에 넣는다(디스크가 중단 · 개입 · 신호 · 인증을 막지 않게). 이벤트에는 토큰이 없다.
//! - 감사는 고정 칸(`audit::OrchestrationAudit`)만 — 토큰 · Task 본문(goal · scope) 없음, 제목은 길이만.
//! - 사유 표 `reason` 은 `mcp/insight.rs` 가 이 파일 소스에서 읽는다.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};

use serde_json::{json, Value};

use super::model::*;
use super::persist;
use crate::audit::{AuditLimits, AuditRecord, OrchestrationAudit};
use crate::server::log;
// 조각이 부모를 거쳐 `super::roles` 등 같은 이름으로 닿게.
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

/// 몸 `{runId, seq}` — 토큰 · 본문 없음. GUI 가 같은 이름으로 창에 중계한다(`RELAYED`).
pub(crate) const EVT_CHANGED: &str = "orchestration-changed";

/// **seq 를 올리지 않는 사건**이라 `wait_run` 을 깨우지 않고 영속 쓰기도 없다. GUI 가 같은 이름으로 중계한다(`RELAYED`).
pub(crate) const EVT_PROGRESS: &str = "orchestration-progress";

pub(crate) type EmitFn = Arc<dyn Fn(&str, Value) + Send + Sync>;
/// epoch ms — 시험이 끼운다.
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

/// 거절 사유 낱말 — MCP · 프런트 계약.
pub(crate) mod reason {
    pub const NOT_FOUND: &str = "not-found";
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
    pub const TASK_BUSY: &str = "task-busy";
    pub const DEPENDENCY_NOT_ACCEPTED: &str = "dependency-not-accepted";
    pub const NEEDS_MERGE: &str = "needs-merge";
    pub const SPAWN_UNAVAILABLE: &str = "spawn-unavailable";
    pub const WORKTREE_FAILED: &str = "worktree-failed";
    pub const WORKTREE_DIRTY: &str = "worktree-dirty";
    pub const WORKTREE_IN_USE: &str = "worktree-in-use";
    pub const NOT_RUN_WORKTREE: &str = "not-run-worktree";
    pub const BRANCH_HAS_UNMERGED: &str = "branch-has-unmerged";
    pub const STALE_ATTEMPT: &str = "stale-attempt";
    pub const ALREADY_REPORTED: &str = "already-reported";
    pub const DIRTY_REPORT: &str = "dirty-report";
    pub const NOT_SUCCESS: &str = "not-success";
    pub const NO_COMMIT: &str = "no-commit";
    pub const TRANSCRIPT_UNAVAILABLE: &str = "transcript-unavailable";
    pub const REQUEST_IN_PROGRESS: &str = "request-in-progress";
    pub const REQUEST_ID_REUSED: &str = crate::chat_token::REQUEST_ID_REUSED;
    // 서버가 집행하는 작업자 커밋 — 작업자 MCP 에만 보인다.
    pub const HEAD_MOVED: &str = "head-moved";
    pub const BRANCH_MISMATCH: &str = "branch-mismatch";
    pub const WORKTREE_MISMATCH: &str = "worktree-mismatch";
    pub const FILTERS_CONFIGURED: &str = "filters-configured";
    pub const NO_GIT_IDENTITY: &str = "no-git-identity";
    pub const NOTHING_TO_COMMIT: &str = "nothing-to-commit";
    pub const PATH_OUTSIDE: &str = "path-outside";
    pub const COMMIT_FAILED: &str = "commit-failed";
    pub const REPORT_MISMATCH: &str = "report-mismatch";
    /// git 출력이 상한을 넘었다 — 잘린 글을 전부인 척 쓰지 않는다.
    pub const OUTPUT_TOO_LARGE: &str = "output-too-large";
    pub const GIT_FAILED: &str = "git-failed";
    pub const RUN_ON_HOLD: &str = "run-on-hold";
    pub const INTEGRATION_BUSY: &str = "integration-busy";
    pub const INTEGRATION_COMMITTING: &str = "integration-committing";
    pub const ALREADY_INTEGRATED: &str = "already-integrated";
    pub const INTEGRATION_FAILED: &str = "integration-failed";
    pub const NOT_COMPLETABLE: &str = "not-completable";
    /// 이 PC 의 git 이 통합에 필요한 판(2.42)보다 낮다.
    pub const GIT_TOO_OLD: &str = "git-too-old";
    pub const GIT_UNSUPPORTED: &str = "git-unsupported";
    pub const EXPORT_CHECKED_OUT: &str = "export-checked-out";
    /// 내보낸 브랜치를 사람이 앱 밖에서 바꿨다 — 덮지 않는다.
    pub const EXPORT_BRANCH_MOVED: &str = "export-branch-moved";
    pub const CONFLICT_NEEDS_HUMAN: &str = "conflict-needs-human";
    pub const CONFLICT_MARKERS_LEFT: &str = "conflict-markers-left";
    pub const UNRESOLVED_CONFLICTS: &str = "unresolved-conflicts";
    pub const VERIFY_FAILED: &str = "verify-failed";
    pub const VERIFY_LIMIT: &str = "verify-limit";
    /// 이 OS 에서는 검증을 돌릴 수 없다(명시적 스텁).
    pub const VERIFY_UNSUPPORTED: &str = "verify-unsupported";
    pub const APPROVAL_STALE: &str = "approval-stale";
    pub const APPROVAL_EXPIRED: &str = "approval-expired";
    pub const REVIEW_ACTIVE: &str = "review-active";
    pub const REVIEW_PENDING: &str = "review-pending";
    pub const REVIEW_BUDGET_EXHAUSTED: &str = "review-budget-exhausted";
    pub const SYMLINK_OUTSIDE: &str = "symlink-outside";
    pub const CLEANUP_PENDING: &str = "cleanup-pending";
    pub const NOT_CLEANABLE: &str = "not-cleanable";
    pub const UNKNOWN_ROLE: &str = "unknown-role";
    pub const ROLE_INVALID: &str = "role-invalid";
    pub const ROLE_REMOVED: &str = "role-removed";
    /// Attempt 의 역할의 CLI · 종류가 바뀌었다 — 같은 대화로 이을 수 없다.
    pub const ROLE_CHANGED: &str = "role-changed";
    pub const REWORK_LIMIT: &str = "rework-limit";
    /// 메시지가 `{unmet, reviewsLeft, hint}` JSON.
    pub const ACCEPT_RULE_UNMET: &str = "accept-rule-unmet";
    /// 큐 없음. 메시지가 `{attemptIds}` JSON.
    pub const BUSY: &str = "busy";
    pub const NO_CONVERSATION: &str = "no-conversation";
    /// resume 의 대화 id 가 고정 id 와 달랐다 — 더는 이어 시킬 수 없다.
    pub const CONVERSATION_BROKEN: &str = "conversation-broken";
    pub const TURN_LIMIT: &str = "turn-limit";
    pub const TEXT_TOO_LONG: &str = "text-too-long";
    pub const NOT_A_WORKER: &str = "not-a-worker";
    pub const CLOSED: &str = "closed";
    pub const REPORTED: &str = "reported";
    /// 예: `spawn_worker` 의 옛 `cli` 인자 — 조용히 무시하지 않는다.
    pub const BAD_ARGS: &str = "bad-args";
    pub const STALE_RUN: &str = "stale-run";
    pub const RUN_ENDED: &str = "run-ended";
    pub const NOT_COORDINATOR: &str = "not-coordinator";
    /// 전역 토큰(`mcp.json`)의 조율 요청 · 사라진 프로듀서 프로세스 — 낱말은 옛 이름 그대로.
    pub const NOT_A_TILE: &str = "not-a-tile";
    pub const ALREADY_COORDINATING: &str = "already-coordinating";
    /// 메시지 JSON 의 `why`.
    pub const NOT_ADOPTABLE: &str = "not-adoptable";
    /// 사람 [재개] — 지금 세대의 조정자가 없다(프로듀서 채팅이 `adopt_run` 으로 이어받거나 사람이 중단한다).
    pub const NO_COORDINATOR: &str = "no-coordinator";
    /// 채팅 하나 = 앨범 하나 — 메시지 JSON 의 `runId`.
    pub const ALREADY_PRODUCED: &str = "already-produced";
    /// 프로듀서 채팅이 다룬 앨범의 저장소가 그 채팅의 스튜디오가 아니다.
    pub const OUT_OF_SCOPE_REPO: &str = "out-of-scope:repo";
    pub const WAIT_CANCELLED: &str = "wait-cancelled";
}

/// `/mcp` 인증이 서버 표에서 정한다(`mcp/http.rs`). 토큰 값은 싣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Caller {
    /// 서버 전역 MCP 토큰(`mcp.json`) — 조율 도구는 `not-a-tile`.
    Global,
    /// 로컬 AI 타일 · 감싸개 셸 타일의 토큰. **자리가 되지 못한다** — 타일 도구 · 조율 도구는 모르는 도구(`tools.rs` `is_tool_for` 에 갈래가 없다).
    Tile { stream: String },
    /// 자리 판정(`tile.rs`)이 묶음 · `runId` · `gen` 을 확인한 **뒤에만** 만든다 — 토큰으로 직접 오는 길은 없다.
    Coordinator { run_id: String, gen: u32 },
    Worker { run_id: String, gen: u32, attempt_id: String },
    /// 이름표지 자물쇠가 아니다(같은 계정 — 역할 기반 보조 검토).
    Reviewer { run_id: String, gen: u32, attempt_id: String },
    /// 사이드 채팅 프로세스 — 읽기 도구만(DB · 작업안 · 조율 도구 없음) · 사람이 연결 칩으로 고른 세션만(`mcp/chat_read.rs` — 요청마다 서버 판정).
    SideChat { chat: String },
    /// 프로듀서 채팅 프로세스 — **인증 때 확정한 세대 그대로**, 요청 처리 어디서도 지금 세대로 바꾸지 않는다(묶음 · 멱등 · 정리가 이 값을 정확히 비교한다).
    Producer { chat: String, proc: crate::server::chat_proc::ProcId },
}

/// 조정자 자리 — 열쇠는 `ProcId` 까지다: 다시 띄운 같은 채팅(새 세대)은 다른 자리라 옛 묶음을 물려받지 않는다(그래서 `adopt_run`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Seat {
    pub chat: String,
    pub proc: crate::server::chat_proc::ProcId,
}

impl Seat {
    pub(crate) fn same_owner(&self, other: &Seat) -> bool {
        self.chat == other.chat
    }

    /// `ProcId::NONE` — 제품에서는 서지 않는 값.
    #[cfg(test)]
    pub(crate) fn test(chat: &str) -> Seat {
        Seat { chat: chat.to_string(), proc: crate::server::chat_proc::ProcId::NONE }
    }
}

/// 지금 세대의 묶인 자리 하나에 대해 · 메모리만. `committed` = 턴이 **자연 종료**로 끝나 확정된 범위.
/// 묶음이 바뀌면 새 자리는 옛 `committed` 를 물려받지 않는다.
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

pub(super) struct Slot {
    pub run: Run,
    /// 분당 한도 — 60초 창.
    pub calls: VecDeque<u64>,
    pub waiters: u32,
    pub reserved_workers: u32,
    /// 이 묶음이 곧 **조정자 역할**이다. 메모리만 — 서버 재시작 = orphaned · 묶음 없음.
    pub coordinator: Option<(u32, Seat)>,
    /// 풀린 프로듀서의 늦은 조율 요청을 `not-coordinator` 가 아니라 `stale-run` · `stale-generation` 으로 답하려고.
    pub past_coordinators: VecDeque<Seat>,
    pub cursor: SeatCursor,
    /// Run 에 귀속(adopt · 프로세스 재시작 무관) · 메모리만 — 누적은 영속 칸 `Run.wakes` 가 센다.
    pub wake: super::wake::WakeMem,
    pub leftovers: Vec<Value>,
    /// 보기만 이것을 쓴다 — 판정은 늘 그 자리에서 새로 읽은 앨범 구성으로 한다.
    pub inputs_seen: Option<super::album::RunInputs>,
    /// 메모리만 — 본문 없음.
    pub transcripts: HashMap<String, super::progress::Watch>,
    /// 잠금 밖에서 효과를 내는 쓰기가 효과 **전에** 세운다. 완료 기록(`run.requests`)과 한 `requestId` 공간이다.
    pub pending_requests: HashMap<String, (&'static str, String)>,
    /// 지우기 · 만들기가 효과 전에 세우고 같은 잠금 안에서 서로 본다.
    pub wt_busy: HashMap<String, &'static str>,
    /// `settle_stopping` 은 이것도 0 일 때만 stopped.
    pub verify_trees: u32,
    pub verify_runs: HashMap<String, Arc<super::verify::VerifyCtl>>,
    /// **메모리만** — 영속 · 감사에는 길이 · 해시만.
    pub verify_tails: HashMap<String, String>,
    /// **영속하지 않는다** — 재시작 뒤 모르는 키는 "바뀜" 으로 보아 보존 폴더를 지우는 쪽(안전한 방향)이다.
    pub verify_cache_key: Option<String>,
    /// 무효화된 검토자의 멈출 몫 — 부른 쪽이 잠금 밖에서 [`Orchestration::drain_stops`] 로 서버 손에 맡긴다.
    pub stop_queue: Vec<String>,
    /// 메모리만 — **서버가 다시 뜨면 다시 정리한다**.
    pub temp_swept: bool,
    /// 한 번에 하나 · 메모리만.
    pub merging: bool,
    pub ref_sig: Option<(usize, usize)>,
    /// 서버 시계 · 사람 [정리] 가 겹치지 않게.
    pub sweeping: bool,
    /// 정리는 검증 자리를 "아직 쓰는 중" 으로 본다. 남은 손잡이가 모두 확인되면 내린다.
    pub verify_unconfirmed: bool,
    /// 이것이 있는 동안 `verify_trees` 가 내려가지 않고 새 검증이 서지 않는다.
    pub verify_leftovers: Vec<(String, super::verify::Leftover)>,
    pub commit_unknown: Vec<String>,
    pub persist: PersistMark,
    /// 마지막 스냅숏을 쓰기 줄에 넣은 뒤로는 이 Run 을 더 넣지 않고(옮긴 파일이 되살아나지 않게) 정리도 서지 않는다.
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
    /// 권위 있는 자리는 Run 파일의 `producers` 이고 이것은 그 메모리 색인이다. 지우지 않는다(채팅 하나 = 앨범 하나). 귀속은 권한이 아니다.
    pub producer_ever: HashMap<String, String>,
}

pub(crate) struct Orchestration {
    pub(super) inner: Mutex<Inner>,
    pub(super) changed: Condvar,
    /// `None` = 쓰지 않는다(시험).
    pub(super) dir: Option<PathBuf>,
    pub(super) emit: EmitFn,
    audit: Mutex<Option<mpsc::Sender<AuditRecord>>>,
    clock: Clock,
    pub(super) launcher: std::sync::RwLock<Option<Arc<dyn super::spawn::WorkerLauncher>>>,
    pub(super) probe: std::sync::RwLock<super::report::Probe>,
    #[cfg(test)]
    pub(crate) test_config: Mutex<Option<super::model::AlbumConfig>>,
    pub(super) album_source: std::sync::RwLock<super::album::AlbumSource>,
    pub(super) transcript_roots: std::sync::RwLock<Option<super::progress::RootsFn>>,
    pub(super) turn_start_wait_ms: std::sync::atomic::AtomicU64,
    saver: Option<Saver>,
    pub(super) notices: super::notice::Notices,
    /// `None` 이면 올리기 · 재시작 복구 판정을 하지 않는다.
    pub(super) integrator: std::sync::RwLock<Option<Arc<dyn super::integrate::IntegrationGit>>>,
    /// 없으면(시험) 통합 작업은 부른 스레드에서 끝까지 돈다.
    pub(super) me: std::sync::RwLock<std::sync::Weak<Orchestration>>,
    #[cfg(test)]
    pub(crate) integrate_hook: Mutex<Option<super::integrate::IntegrateHook>>,
    #[cfg(test)]
    ephemeral: std::sync::atomic::AtomicBool,
    /// 검증 시한의 "1분"(ms) — 제품은 늘 60 000.
    pub(super) verify_minute_ms: std::sync::atomic::AtomicU64,
    /// 없으면 곁 기록 없이 Run 장부만으로 판정한다.
    pub(super) sidecar: std::sync::RwLock<Option<PathBuf>>,
    /// 보관 · 복원 · 영구 삭제를 한 줄로 — 삭제가 ref 를 지우는 동안 복원이 파일을 되살리지 않게. 잠금 순서는 이것 → 표 잠금 한 방향.
    pub(super) archive_ops: Mutex<()>,
    pub(super) archive_skips: Mutex<std::collections::HashSet<String>>,
}

/// 사람의 앨범 시작이 앨범 구성에서 정한 Run 시작 값.
#[derive(Debug, Clone)]
pub(crate) struct StartRun {
    pub name: String,
    pub repo: String,
    pub worktree_dir: String,
    pub limits: Limits,
    /// 수락 전 검증 — 시작 때 고정한 사본.
    pub verify: Option<VerifyConfig>,
}

const MINUTE_MS: u64 = 60_000;

/// 한 채팅이 여러 파일에 있으면 먼저 연 Run 을 둔다 — 어느 쪽이든 그 채팅은 새 앨범을 열 수 없다(좁은 쪽).
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
        let saver = dir.clone().and_then(Saver::start);
        // 귀속 색인은 Run 파일들의 `producers` 에서 다시 짓는다 — 재시작 뒤에도 채팅 하나 = 앨범 하나.
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

    #[cfg(test)]
    pub(crate) fn set_turn_start_wait_ms(&self, ms: u64) {
        self.turn_start_wait_ms.store(ms, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn set_probe(&self, p: super::report::Probe) {
        *self.probe.write().unwrap_or_else(|e| e.into_inner()) = p;
    }

    pub(super) fn probe(&self) -> super::report::Probe {
        self.probe.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

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

    /// **같은 잠금 안에서** 부른다(넣는 순서 = 사건 순서). 직렬화 · 원자 교체는 쓰기 스레드가 잠금 밖에서 한다.
    pub(super) fn after_change(&self, inner: &Inner, run_id: &str) {
        let _ = self.publish(inner, run_id, false, false);
    }

    /// 저장 결과를 돌려받는다 — 잠금 밖에서 [`SaveWait::wait`].
    pub(super) fn after_change_confirmed(&self, inner: &Inner, run_id: &str) -> SaveWait {
        self.publish(inner, run_id, true, false)
    }

    /// 재시작 복구가 판정을 남길 때만 — 평소의 orphaned 는 바뀌지 않아 다시 쓰지 않는다.
    pub(super) fn save_orphaned(&self, inner: &Inner, run_id: &str) {
        let _ = self.publish(inner, run_id, false, true);
    }

    fn publish(&self, inner: &Inner, run_id: &str, confirm: bool, orphaned_too: bool) -> SaveWait {
        // 확인을 청했는데 저장기가 없으면 실패 — 시험의 명시적 비영속 모드만 예외.
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

    /// 시험 전용 — 제품은 저장기가 없으면 통합 올리기가 `persist-failed`.
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

    #[cfg(test)]
    pub(crate) fn set_save_fault(&self, on: bool) {
        if let Some(s) = &self.saver {
            s.fault.store(on, std::sync::atomic::Ordering::SeqCst);
        }
    }

    pub(crate) fn flush_saves(&self) {
        if let Some(s) = &self.saver {
            s.flush(std::time::Duration::from_secs(5));
        }
    }

    /// 손은 약한 참조만 쥔다(저장소 ↔ 쓰기 줄 고리 없음).
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

    /// **실패 표지가 바뀌었을 때만**(생김 · 지워짐) 사건을 낸다. 그 사건은 쓰기 줄에 넣지 않는다([`Self::announce`]) — 실패 → 사건 → 다시 저장 → 실패
    /// 고리를 끊는다. orphaned Run 은 바꾸지 않는다.
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

    fn announce(&self, inner: &Inner, run_id: &str) {
        if let Some(slot) = inner.runs.get(run_id) {
            (self.emit)(EVT_CHANGED, json!({ "runId": run_id, "seq": slot.run.seq }));
        }
        self.changed.notify_all();
    }

    /// 잠금 밖에서 부른다. 실패는 삼킨다(감사가 조율을 막지 않는다).
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
