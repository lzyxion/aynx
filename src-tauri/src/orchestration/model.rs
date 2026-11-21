//! 오케스트레이션 **자료형** — Run · Task · Attempt · Report · AcceptedArtifact · 한도 · 타임라인.
//!
//! 불변식:
//! - 이 파일의 자료형은 **비밀을 담지 않는다** — 역할 토큰은 `store.rs` 의 표에만 있다. 그래서 `Debug` 파생이 안전하고 `Run` 을 통째로
//!   영속 파일에 써도 토큰이 새지 않는다(시험 `run_json_has_no_tokens_or_bodies`). 프롬프트 전문 · 대화 기록 · PTY 출력 칸도 없다.
//! - 보고 본문(`summary` · `notes`)은 작업자가 쓴 글이라 영속 파일 · 사람 보기에는 싣지만 **감사에는 길이만**.
//! - `AcceptedArtifact` 는 한 번 만들면 **바뀌지 않는다** — 뒤집기는 `revoked_at` · `revoked_by` 를 한 번 채우는 것뿐이고 다시 수락하면
//!   새 기록을 더한다. 유효한 수락 = 그 Task 의 마지막 · 거둬지지 않은 기록.
//! - 직렬화 이름 · 상태 글자는 영속 파일 · MCP · 프런트 계약이다 — 바꾸지 않는다.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const FILE_VERSION: u32 = 4;

/// 판 4 하나만 읽는다. 판 1~3은 몸을 해석하거나 지우지 않고 로그 한 줄로 건너뛴다.
pub(crate) const SUPPORTED_FILE_VERSIONS: [u32; 1] = [4];

/// 판정형은 이 글자와 무관하게 늘 읽기 전용이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemberGrade {
    Read,
    Edit,
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlbumMember {
    pub artist: String,
    pub name: String,
    pub grade: MemberGrade,
    pub allowed_commands: Vec<String>,
    pub joined_rev: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlbumConfig {
    pub rev: u32,
    pub members: Vec<AlbumMember>,
    pub accept: crate::orchestration::config::AcceptRules,
    pub verify_auto: bool,
    pub plan_tools: bool,
    pub wake_max: u32,
    pub risk_confirmed_at: Option<u64>,
    pub changed_at: u64,
    /// 사람이 앨범 시작 · [앨범 권한]에서만 켠다 — 검증 명령이 있어야 켜진다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub auto_merge: bool,
}

pub(crate) const IDEMPOTENCY_KEEP: usize = 512;

pub(crate) const LOG_KEEP: usize = 1000;

/// `orphaned` = 서버 재시작 뒤 파일에서 읽어 올린 **읽기 전용** Run(토큰 없음 · 자동 재개 없음).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RunState {
    Running,
    Paused,
    Stopping,
    Stopped,
    Done,
    Orphaned,
}

impl RunState {
    /// 서버 자진 종료를 막고 동시 Run 한도에 센다 — orphaned 는 아니다.
    pub(crate) fn active(self) -> bool {
        matches!(self, RunState::Running | RunState::Paused | RunState::Stopping)
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RunState::Running => "running",
            RunState::Paused => "paused",
            RunState::Stopping => "stopping",
            RunState::Stopped => "stopped",
            RunState::Done => "done",
            RunState::Orphaned => "orphaned",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TaskState {
    Todo,
    Active,
    Reported,
    Accepted,
    Rejected,
    Cancelled,
    /// 통합 작업([`IntegrationJob`]) 중 — Task 쓰기는 `task-busy`, 사람 [취소]는 커밋 단계 전까지만.
    Integrating,
    Conflict,
}

impl TaskState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            TaskState::Todo => "todo",
            TaskState::Active => "active",
            TaskState::Reported => "reported",
            TaskState::Accepted => "accepted",
            TaskState::Rejected => "rejected",
            TaskState::Cancelled => "cancelled",
            TaskState::Integrating => "integrating",
            TaskState::Conflict => "conflict",
        }
    }

    pub(crate) fn terminal(self) -> bool {
        matches!(self, TaskState::Accepted | TaskState::Rejected | TaskState::Cancelled)
    }
}

/// `stop-unconfirmed` = 트리 종료를 확인하지 못했다 — 산 것으로 센다.
/// 옛 PTY 작업자의 변이(`starting` · `ready` · `working` · `awaiting-human` · `needs-recovery` · `exit-unconfirmed`)는 읽기만 — 새 Attempt 는 그 상태로 가지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AttemptState {
    Spawning,
    Starting,
    Ready,
    Working,
    AwaitingHuman,
    NeedsRecovery,
    Running,
    /// 턴이 끝났고(트리 종료 확인) 닫히지 않았다 — worktree · 대화를 쥐고 산 토큰은 없다.
    Idle,
    Reported,
    Exited,
    Stopping,
    Stopped,
    StopUnconfirmed,
    ExitUnconfirmed,
}

impl AttemptState {
    /// PTY 갈래(옛 파일)의 바탕일 뿐이다 — 이 파일 밖에서는 술어 넷([`turn_may_live`] …)을 쓴다.
    fn process_may_live(self) -> bool {
        !matches!(self, AttemptState::Exited | AttemptState::Stopped)
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AttemptState::Spawning => "spawning",
            AttemptState::Starting => "starting",
            AttemptState::Ready => "ready",
            AttemptState::Working => "working",
            AttemptState::AwaitingHuman => "awaiting-human",
            AttemptState::NeedsRecovery => "needs-recovery",
            AttemptState::Running => "running",
            AttemptState::Idle => "idle",
            AttemptState::Reported => "reported",
            AttemptState::Exited => "exited",
            AttemptState::Stopping => "stopping",
            AttemptState::Stopped => "stopped",
            AttemptState::StopUnconfirmed => "stop-unconfirmed",
            AttemptState::ExitUnconfirmed => "exit-unconfirmed",
        }
    }
}

/// 술어 넷과 잔존 판정이 이것으로 갈린다. `Pty` 는 옛 파일에만 있다 — 세션 하나가 Attempt 수명 내내(보고 뒤에도) 산다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExecMode {
    Pty,
    Headless,
}

/// 턴(프로세스)이 살아 있을 수 있나. 헤드리스의 옛 변이(`working` · `exit-unconfirmed` 등)는 산 것으로 센다 — 닫힌 쪽으로 읽지 않는다.
pub(crate) fn turn_may_live(state: AttemptState, mode: ExecMode) -> bool {
    match mode {
        ExecMode::Pty => state.process_may_live(),
        ExecMode::Headless => !matches!(
            state,
            AttemptState::Idle | AttemptState::Reported | AttemptState::Exited | AttemptState::Stopped
        ),
    }
}

/// 더는 일을 받지 않는다. PTY(옛 파일)는 닫힌 뒤에도 CLI 가 살 수 있다 — 그동안은 [`owns_worktree`] 가 참이다.
pub(crate) fn attempt_closed(state: AttemptState, _mode: ExecMode) -> bool {
    matches!(state, AttemptState::Reported | AttemptState::Stopped | AttemptState::Exited)
}

/// worktree · 대화 등 Attempt 자원을 쥐고 있나.
pub(crate) fn owns_worktree(state: AttemptState, mode: ExecMode) -> bool {
    !attempt_closed(state, mode) || turn_may_live(state, mode)
}

/// 같은 대화로 이어지는 지시를 받을 수 있나 — 상태 몫만. 대화 끊김은 [`Attempt::resumable`] 이, Run running 은 부르는 쪽 관문이 본다.
pub(crate) fn resumable(state: AttemptState, mode: ExecMode) -> bool {
    match mode {
        ExecMode::Pty => state == AttemptState::Ready,
        ExecMode::Headless => state == AttemptState::Idle,
    }
}

/// 쓰기형 = 작업자 · 해결자(resume 되는 Attempt), 판정형 = 검토자(한 턴). 이 칸이 있으면 헤드리스다([`Attempt::exec_mode`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AttemptKind {
    Write,
    Judge,
}

impl AttemptKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AttemptKind::Write => "write",
            AttemptKind::Judge => "judge",
        }
    }
}

/// `blocked` 보고 — **비종결**(턴이 끝나면 `idle` + 이 표지). `need` 는 작업자가 쓴 글이라 영속 · 보드 · 조정자에만 — 감사에는 길이 · 해시만.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Blocked {
    pub need: String,
    pub at: u64,
}

/// 사람 수락이 넘은 규칙. 옛 `review_waived*` 는 `{rule: "review"}` 한 줄로 읽는다([`AcceptedArtifact::waivers`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Waiver {
    pub rule: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_name: Option<String>,
    #[serde(default)]
    pub need: u32,
    #[serde(default)]
    pub have: u32,
}

/// Run 이 처음 읽은 저장소 신원 사본 — 턴 · 무인 검증 · 통합 직전마다 지금 신원이 이것과 같아야 한다(같은 경로에 다시 clone 한 저장소를 가린다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunDelegation {
    pub path: String,
    pub git_dir: String,
    /// 식별을 못 재는 OS 면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    pub accepted_sha: String,
    pub at: u64,
}

/// 칸이 없는 옛 파일은 사람이 연 Run 으로 읽는다. `producer` 는 비밀이 아니다(프로듀서 채팅 id).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunOrigin {
    /// `human` · `ai`.
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_config: Option<ProducerConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProducerConfig {
    pub cli: String,
    pub model: String,
    pub effort: Option<String>,
}

impl RunOrigin {
}

pub(crate) fn human_origin() -> RunOrigin {
    RunOrigin {
        by: "human".into(),
        producer: None,
        producer_config: None,
    }
}

/// 옛 파일 호환 — 새 Run 에는 없다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkerPermission {
    Ask,
    AcceptEdits,
    FullAuto,
}

impl WorkerPermission {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            WorkerPermission::Ask => "ask",
            WorkerPermission::AcceptEdits => "acceptEdits",
            WorkerPermission::FullAuto => "fullAuto",
        }
    }
}

/// 옛 파일 호환 — 디코딩용으로만 남는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttachMode {
    OnDemand,
    Always,
}

/// 메시지는 첫 줄만 · 경로 목록은 싣지 않는다(개수만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerCommit {
    pub attempt_id: String,
    pub commit_oid: String,
    pub parent_oid: String,
    pub branch: String,
    pub subject: String,
    pub files: u32,
    pub at: u64,
}

/// 마지막 `commit_changes` 거절 — **경로 목록 · 메시지 본문은 싣지 않는다**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitRejection {
    pub reason: String,
    /// 인자가 깨져 읽지 못했으면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// `"all"` 이면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<u32>,
    #[serde(default)]
    pub needs_human: bool,
    pub seq: u64,
    pub at: u64,
}

/// 작업자가 다시 해 봐도 풀리지 않는 거절 — 감독 알림도 낸다. 나머지는 작업자가 고칠 수 있어 타임라인 · 감사만.
pub(crate) fn commit_needs_human(reason: &str) -> bool {
    matches!(reason, "filters-configured" | "no-git-identity" | "worktree-mismatch" | "commit-failed")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkerCli {
    Claude,
    Codex,
}

impl WorkerCli {
    /// 실행 파일 이름 · 훅 신호의 `cli` 와 같은 글자.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            WorkerCli::Claude => "claude",
            WorkerCli::Codex => "codex",
        }
    }
}

/// 역할은 **서버 표에서만** 읽는다. 조정자 토큰은 없다 — 조정자는 프로듀서 채팅 토큰에 서버 표의 묶음(`Slot.coordinator`)이 붙인 역할이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    Worker,
    /// **역할 기반 보조 검토**다 — 같은 계정 안의 이름표 토큰이라 작업자가 토큰을 훔쳐 사칭하는 것은 막지 못한다(독립 진위 보증이 아니다).
    Reviewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Actor {
    Human,
    Coordinator,
    Worker,
    Server,
    Reviewer,
}

impl Actor {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Actor::Human => "human",
            Actor::Coordinator => "coordinator",
            Actor::Worker => "worker",
            Actor::Server => "server",
            Actor::Reviewer => "reviewer",
        }
    }
}

/// 기본값이 곧 상한이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Limits {
    pub max_tasks: u32,
    /// 조정자 하나의 조율 도구 호출 — 읽기 · 쓰기 · 대기 모두 센다.
    pub max_calls_per_minute: u32,
    pub max_waiters: u32,
    /// 넘으면 paused + 사건.
    pub coordination_minutes: u32,
    /// 실행 한도 = 조율 한도 + 이만큼(분) — 넘으면 stopping.
    pub execution_grace_minutes: u32,
    pub max_concurrent_workers: u32,
    pub max_total_workers: u32,
    /// 이어지는 턴(`send_prompt` 의 resume 턴) 수 — 영속 칸 이름은 옛 "전달 횟수" 그대로.
    pub max_deliveries: u32,
    /// 작업자 한도와 따로 센다.
    #[serde(default = "default_max_reviews")]
    pub max_reviews: u32,
    #[serde(default = "default_turn_minutes")]
    pub turn_minutes: u32,
}

pub(crate) const DEFAULT_TURN_MINUTES: u32 = 60;

fn default_turn_minutes() -> u32 {
    DEFAULT_TURN_MINUTES
}

pub(crate) const DEFAULT_MAX_REVIEWS: u32 = 6;
#[cfg(test)]
pub(crate) const MAX_REVIEWS_CAP: u32 = 20;

fn default_max_reviews() -> u32 {
    DEFAULT_MAX_REVIEWS
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_tasks: 50,
            max_calls_per_minute: 60,
            max_waiters: 2,
            coordination_minutes: 120,
            execution_grace_minutes: 30,
            max_concurrent_workers: 3,
            max_total_workers: 8,
            max_deliveries: 200,
            max_reviews: DEFAULT_MAX_REVIEWS,
            turn_minutes: DEFAULT_TURN_MINUTES,
        }
    }
}

pub(crate) const MAX_ACTIVE_RUNS: usize = 2;

#[cfg(test)]
const MAX_MINUTES: u32 = 24 * 60;

/// 시험 전용 한도 입력 — [`Self::resolve`] 가 상한으로 자른다.
#[cfg(test)]
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LimitsInput {
    pub max_tasks: Option<u32>,
    pub max_calls_per_minute: Option<u32>,
    pub max_waiters: Option<u32>,
    pub coordination_minutes: Option<u32>,
    pub execution_grace_minutes: Option<u32>,
    pub max_concurrent_workers: Option<u32>,
    pub max_total_workers: Option<u32>,
    pub max_deliveries: Option<u32>,
    pub max_reviews: Option<u32>,
}

#[cfg(test)]
impl LimitsInput {
    pub(crate) fn resolve(self) -> Limits {
        let d = Limits::default();
        let cap = |v: Option<u32>, max: u32| v.map_or(max, |v| v.clamp(1, max));
        Limits {
            max_tasks: cap(self.max_tasks, d.max_tasks),
            max_calls_per_minute: cap(self.max_calls_per_minute, d.max_calls_per_minute),
            max_waiters: cap(self.max_waiters, d.max_waiters),
            coordination_minutes: self.coordination_minutes.map_or(d.coordination_minutes, |v| v.clamp(1, MAX_MINUTES)),
            execution_grace_minutes: self
                .execution_grace_minutes
                .map_or(d.execution_grace_minutes, |v| v.min(MAX_MINUTES)),
            max_concurrent_workers: cap(self.max_concurrent_workers, d.max_concurrent_workers),
            max_total_workers: cap(self.max_total_workers, d.max_total_workers),
            max_deliveries: cap(self.max_deliveries, d.max_deliveries),
            max_reviews: self.max_reviews.map_or(d.max_reviews, |v| v.clamp(1, MAX_REVIEWS_CAP)),
            turn_minutes: d.turn_minutes,
        }
    }
}

/// 명세 글자(goal · scope · doneWhen)는 영속 파일에는 싣지만 **감사에는 싣지 않는다**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Task {
    pub id: String,
    pub title: String,
    pub goal: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub done_when: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub version: u64,
    pub state: TaskState,
    #[serde(default)]
    pub current_attempt: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// 해결 Attempt 가 이것으로 일하므로 active · reported 동안은 남고, 그 충돌이 뜻을 잃는 전이(수락 · 반려 · 취소)에서 걷는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict: Option<ConflictInfo>,
    /// 작업자 수명(`current_attempt` · Task 상태)과 따로 — 바뀌어도 Task 버전은 오르지 않는다.
    #[serde(default)]
    pub review: ReviewSlot,
    /// `reported → rejected` 로 간 횟수 — 충돌 해결자 · `blocked` 뒤 resume 은 세지 않는다.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rework_count: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// 판정이 서면 `active` 만 비고 `target` 은 마지막 대상으로 남는다. 무효화(보고 교체 · 반려 · 취소 · 수락)는 둘 다 비운다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSlot {
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
}

/// 해결 Attempt 도 작업자다 — `resolves` 로 가린다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttemptRole {
    #[default]
    Worker,
    Reviewer,
}

/// 띄울 때 정하고 바뀌지 않는다. `cwd` 는 `place`(보고 커밋 worktree)가 아닌 서버의 빈 폴더다 — 작업자가 커밋한 프로젝트 설정 파일이
/// 검토자 CLI 의 설정으로 읽히지 않게.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewOf {
    pub report_id: String,
    pub commit_oid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// 권한 표시 전용 — 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 · 대화 id 는 **싣지 않는다**(`turn::args_label` 하나가 짓는다).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnArgsLabel {
    pub cli: String,
    pub grade: String,
    pub settings_control: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_rules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions_sha: Option<String>,
    #[serde(default)]
    pub resume: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_minutes: Option<u32>,
}

/// 턴 stdout 의 이상 입력 셈 — 본문은 싣지 않는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnAnomalies {
    #[serde(default)]
    pub truncated: u32,
    #[serde(default)]
    pub oversized: u32,
    #[serde(default)]
    pub unknown: u32,
    #[serde(default)]
    pub non_json: u32,
}

impl TurnAnomalies {
    pub(crate) fn is_zero(&self) -> bool {
        *self == TurnAnomalies::default()
    }
}

/// 낱말 · 수만 — **프롬프트 · 지침 · 모델 글 · 도구 입력 · 토큰 · 대화 id 는 싣지 않는다**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnRecord {
    pub n: u32,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(default)]
    pub denials: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub denial_kinds: Vec<String>,
    #[serde(default)]
    pub tools: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub args: TurnArgsLabel,
    #[serde(default, skip_serializing_if = "TurnAnomalies::is_zero")]
    pub anomalies: TurnAnomalies,
}

pub(crate) const TURNS_KEPT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ReviewVerdict {
    Pass,
    ChangesRequested,
}

impl ReviewVerdict {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ReviewVerdict::Pass => "pass",
            ReviewVerdict::ChangesRequested => "changes-requested",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "pass" => Some(ReviewVerdict::Pass),
            "changes-requested" => Some(ReviewVerdict::ChangesRequested),
            _ => None,
        }
    }
}

/// `current` 만 상태에 든다 — `stale`(대상 무효화 뒤) · `late`(중단 · 세대 교체 뒤)는 기록만.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReviewReportState {
    Current,
    Stale,
    Late,
}

impl ReviewReportState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ReviewReportState::Current => "current",
            ReviewReportState::Stale => "stale",
            ReviewReportState::Late => "late",
        }
    }
}

pub(crate) const REVIEW_FINDINGS_MAX: usize = 20;
pub(crate) const REVIEW_FINDING_CHARS: usize = 500;
pub(crate) const REVIEW_SUMMARY_MAX: usize = 4 * 1024;

/// 대상(`reportId` · `commitOid`)은 Attempt 의 고정 대상 그대로다(검토자가 보낸 글자가 아니다). 본문은 영속 · 사람 보기 · 조정자에만 —
/// **감사에는 길이 · 개수만**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewReport {
    pub review_id: String,
    pub attempt_id: String,
    pub task_id: String,
    pub report_id: String,
    pub commit_oid: String,
    pub verdict: ReviewVerdict,
    #[serde(default)]
    pub findings: Vec<String>,
    pub summary: String,
    pub at: u64,
    pub state: ReviewReportState,
}

pub(crate) const CONFLICT_ENTRIES_MAX: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictStage {
    /// 1 = base · 2 = ours(통합 머리) · 3 = theirs(보고 커밋).
    pub stage: u8,
    pub mode: String,
    pub blob: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictEntry {
    pub paths: Vec<String>,
    /// `CONFLICT (<종류>)` 의 종류 낱말들 — 한 경로에 둘 이상 올 수 있다.
    pub kinds: Vec<String>,
    pub stages: Vec<ConflictStage>,
}

/// 메시지 원문은 싣지 않는다(종류 낱말만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictInfo {
    pub job_id: String,
    pub old: String,
    pub report_commit: String,
    pub merge_base: String,
    /// 충돌 트리(표식 박힌 blob)를 붙잡은 커밋 — 못 만들었으면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_commit: Option<String>,
    pub entries: Vec<ConflictEntry>,
    #[serde(default)]
    pub more: u32,
    /// 자동 해결 Attempt 대상이 아니다(일반 텍스트 내용 충돌 밖) — 항목이 상한을 넘었거나 충돌 트리 커밋이 없어도 사람에게.
    pub needs_human: bool,
    pub at: u64,
}

/// 작업자 · 검토자 한 번.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attempt {
    pub id: String,
    pub task_id: String,
    pub cli: WorkerCli,
    pub gen: u32,
    pub state: AttemptState,
    #[serde(default)]
    pub stream: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub base_commit: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    /// 고정된 대화 id — 대화 기록 자체는 싣지 않는다.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 실행 줄에 실제로 쓴 권한 인자 — 토큰 · 프롬프트는 싣지 않는다.
    #[serde(default)]
    pub launch_args: Option<String>,
    #[serde(default)]
    pub attention: Option<String>,
    pub started_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub exit_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_recovery: Option<String>,
    /// 고정 대화가 아닌 대화 id 가 왔다 — 고정은 그대로 둔다(판독은 고정 대화만). 한 번 서면 내려가지 않는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conversation_changed: bool,
    /// 커밋이 서면 걷힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_commit_rejection: Option<CommitRejection>,
    /// 충돌 해결 Attempt 면 그 충돌의 Job id(`ConflictInfo.jobId`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolves: Option<String>,
    /// 검토자는 Task 상태 · `current_attempt` 를 건드리지 않고 작업자 한도에 세지 않는다.
    #[serde(default)]
    pub role: AttemptRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_of: Option<ReviewOf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub turns: Vec<TurnRecord>,
    /// 띄울 때의 사본 · 바뀌지 않는다. 있으면 헤드리스다(첫 턴 전 `spawning` 도 가린다 — [`Attempt::exec_mode`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AttemptKind>,
    /// 턴마다 이 id 로 지금 역할을 다시 찾는다(`role-removed` · `role-changed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    /// 보기용 사본 — 역할을 지운 뒤에도 이름을 보인다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_name: Option<String>,
    /// 새 턴이 서면 지운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<Blocked>,
    /// resume 턴의 init 이 고정 id 와 다르거나 두 번 왔다 — 더는 resume 하지 않는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conversation_broken: bool,
    /// `stop-unconfirmed` 가 나중에 확인될 때 `stopped` 로 갈지(아니면 턴의 자연 끝 — `idle` · `reported`)를 가른다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stop_requested: bool,
}

impl Attempt {
    pub(crate) fn is_reviewer(&self) -> bool {
        self.role == AttemptRole::Reviewer
    }

    pub(crate) fn exec_mode(&self) -> ExecMode {
        if self.kind.is_some() || !self.turns.is_empty() || (self.is_reviewer() && self.stream.is_none()) {
            ExecMode::Headless
        } else {
            ExecMode::Pty
        }
    }

    pub(crate) fn turn_no(&self) -> u32 {
        self.turns.last().map_or(0, |t| t.n)
    }

    pub(crate) fn last_turn_may_live(&self) -> bool {
        self.turns.last().is_some_and(|t| matches!(t.outcome.as_str(), "running" | "stop-unconfirmed"))
    }

    pub(crate) fn turn_may_live(&self) -> bool {
        turn_may_live(self.state, self.exec_mode())
    }

    pub(crate) fn attempt_closed(&self) -> bool {
        attempt_closed(self.state, self.exec_mode())
    }

    pub(crate) fn owns_worktree(&self) -> bool {
        owns_worktree(self.state, self.exec_mode())
    }

    /// Run running 은 부르는 쪽이 본다.
    pub(crate) fn resumable(&self) -> bool {
        resumable(self.state, self.exec_mode()) && !self.conversation_broken
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DeliveryState {
    Rejected,
    Writing,
    PastedUnconfirmed,
    SubmittedUnconfirmed,
    Acknowledged,
}

/// 옛 파일 읽기 · 보존만 — 상태 · 길이 · 해시만, 본문 없음.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeliveryRecord {
    pub request_id: String,
    pub attempt_id: String,
    pub state: DeliveryState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub len: u32,
    pub sha1: String,
    pub at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovered_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReportOutcome {
    Success,
    Failure,
    Blocked,
}

impl ReportOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ReportOutcome::Success => "success",
            ReportOutcome::Failure => "failure",
            ReportOutcome::Blocked => "blocked",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "success" => Some(ReportOutcome::Success),
            "failure" => Some(ReportOutcome::Failure),
            "blocked" => Some(ReportOutcome::Blocked),
            _ => None,
        }
    }
}

/// git 칸(`commit_oid` · `dirty` · `changed_files`)은 **서버가 그 worktree 에서 읽은 것**이다(작업자가 보낸 글자가 아니다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub report_id: String,
    pub attempt_id: String,
    #[serde(default)]
    pub task_id: String,
    pub outcome: ReportOutcome,
    pub summary: String,
    #[serde(default)]
    pub notes: Option<String>,
    /// 수락 대상은 늘 이 커밋이다(보고 뒤 worktree 가 바뀌어도).
    #[serde(default)]
    pub commit_oid: Option<String>,
    #[serde(default)]
    pub base_commit_oid: Option<String>,
    /// 미커밋 변경(추적 안 된 파일 포함 · 무시 파일 제외) — 성공 보고라도 수락 불가.
    pub dirty: bool,
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub changed_files_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_error: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub no_changes: bool,
    /// 있으면 수락할 수 없다(`report-mismatch`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mismatch: Option<String>,
    pub at: u64,
    /// 중단 · 세대 교체 뒤에 온 보고 — 기록만, Task 상태는 바꾸지 않는다.
    #[serde(default)]
    pub late: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved: Vec<ResolvedPath>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedPath {
    pub path: String,
    pub how: String,
}

pub(crate) const CHANGED_FILES_MAX: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Reviewer {
    Coordinator,
    Human,
}

impl Reviewer {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Reviewer::Coordinator => "coordinator",
            Reviewer::Human => "human",
        }
    }
}

/// 판정마다 **새 줄**이다(옛 줄은 남는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewRecord {
    pub task_id: String,
    #[serde(default)]
    pub attempt_id: Option<String>,
    #[serde(default)]
    pub report_id: Option<String>,
    pub decision: Decision,
    pub reviewer: Reviewer,
    #[serde(default)]
    pub flipped: bool,
    pub at: u64,
}

/// **명령 글자는 싣지 않는다**(Run 의 `verify` 칸에만 — 해시로 묶는다). 덮어쓰기로 수락해도 실패한 결과는 실패로 남는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Verification {
    #[serde(default)]
    pub verify_id: String,
    #[serde(default)]
    pub job_id: String,
    pub outcome: VerifyOutcome,
    #[serde(default)]
    pub exit_code: Option<i64>,
    #[serde(default)]
    pub command_sha: String,
    #[serde(default = "default_true")]
    pub hermetic: bool,
    #[serde(default)]
    pub overridden: bool,
}

fn default_true() -> bool {
    true
}

/// **사람이 [새 앨범] 구성에서만** 정하고 앨범 시작 때 Run 에 고정된다 — MCP · 조정자 · 작업자 인자 어디에도 없고 도중에 바꾸는 길도 없다.
/// 명령 글자는 이 칸에만 있다(감사 · 결과에는 길이 · SHA-256 만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyConfig {
    /// `cmd.exe /d /s /v:off /c "<이 글자>"` 로 그대로 돈다(보간 없음).
    pub command: String,
    /// 사람 확인 · 결과를 묶는 열쇠.
    pub command_sha: String,
    pub timeout_minutes: u32,
    /// 켜면 후보마다 사람 확인 없이 돈다('전부 자동' 과 같은 위험 등급).
    pub auto_run: bool,
    /// 있으면 결과는 `hermetic: false`.
    #[serde(default)]
    pub keep_dirs: Vec<String>,
    /// 후보에서의 blob 이 지난번과 다르면 보존 폴더를 지운다.
    #[serde(default)]
    pub cache_key_files: Vec<String>,
    /// 환경 변수 **이름**만 — 값은 서버 환경에서.
    #[serde(default)]
    pub extra_env_names: Vec<String>,
}

/// `pass` 만 올리기로 간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum VerifyOutcome {
    Pass,
    Fail,
    Timeout,
    Cancelled,
    /// 끝난 뒤 추적 파일이 바뀌었다 — 실패로 친다.
    ModifiedTracked,
    SpawnFailed,
    /// 추적 symlink 가 검증 자리 밖을 가리킨다 — 그 후보의 검증을 거절했다.
    SymlinkOutside,
    /// 트리 종료를 확인하지 못했다 — 실패로 친다.
    StopUnconfirmed,
}

impl VerifyOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            VerifyOutcome::Pass => "pass",
            VerifyOutcome::Fail => "fail",
            VerifyOutcome::Timeout => "timeout",
            VerifyOutcome::Cancelled => "cancelled",
            VerifyOutcome::ModifiedTracked => "modified-tracked",
            VerifyOutcome::SpawnFailed => "spawn-failed",
            VerifyOutcome::SymlinkOutside => "symlink-outside",
            VerifyOutcome::StopUnconfirmed => "stop-unconfirmed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VerifyApprover {
    Human,
    Auto,
}

impl VerifyApprover {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            VerifyApprover::Human => "human",
            VerifyApprover::Auto => "auto",
        }
    }
}

/// `{jobId, candidate, commandSha, old}` 에 묶인다 — 실행 직전 같은 잠금에서 다시 대조한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyApproval {
    pub by: VerifyApprover,
    pub candidate: String,
    pub command_sha: String,
    pub old: String,
    pub at: u64,
}

/// 출력 본문은 **메모리만**(`Slot.verify_tails`) — 여기에는 바이트 수 · 꼬리의 SHA-256 만.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyResult {
    pub verify_id: String,
    pub job_id: String,
    pub candidate: String,
    pub command_sha: String,
    pub env_policy: String,
    pub hermetic: bool,
    #[serde(default)]
    pub exit_code: Option<i64>,
    pub outcome: VerifyOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub duration_ms: u64,
    pub out_bytes: u64,
    pub tail_sha256: String,
    pub approved_by: VerifyApprover,
    pub at: u64,
}

/// **실패한 그 Job** 의 `{후보, 실패 검증 id, 그때 머리}` 에 묶인다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyOverride {
    pub failed_job_id: String,
    pub verify_id: String,
    pub candidate: String,
    pub old: String,
    pub by: Reviewer,
    pub at: u64,
}

/// 한 번 만들면 바뀌지 않는다(뒤집기는 `revoked_*` 를 한 번 채울 뿐). 후속 Task 는 worktree 경로가 아니라 유효한 기록의 `commit_oid` 를 참조한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptedArtifact {
    pub task_id: String,
    pub attempt_id: String,
    pub report_id: String,
    pub commit_oid: String,
    #[serde(default)]
    pub base_commit_oid: Option<String>,
    pub reviewer: Reviewer,
    /// 칸은 늘 직렬화한다(`verification: null`).
    #[serde(default)]
    pub verification: Option<Verification>,
    pub accepted_at: u64,
    #[serde(default)]
    pub revoked_at: Option<u64>,
    #[serde(default)]
    pub revoked_by: Option<Reviewer>,
    /// 있으면 뒤집기는 `already-integrated`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// 새 수락은 `waived` 가 주이고, 이 칸은 면제가 있으면 함께 채운다(옛 보기와의 이음).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_waived_by: Option<Reviewer>,
    /// 옛 파일은 비어 있다 — [`Self::waivers`] 가 옛 칸을 읽는다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waived: Vec<Waiver>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waived_by: Option<Reviewer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub judgments: Vec<String>,
}

impl AcceptedArtifact {
    pub(crate) fn waivers(&self) -> Vec<Waiver> {
        if !self.waived.is_empty() {
            return self.waived.clone();
        }
        match self.review_waived_by {
            Some(_) => vec![Waiver {
                rule: "review".into(),
                role: None,
                role_name: None,
                need: 1,
                have: 0,
            }],
            None => Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Integration {
    /// 진실 ref(비브랜치) — 사람용 브랜치는 `export_branch`.
    pub work_ref: String,
    pub export_branch: String,
    pub base_commit: String,
    /// 분리 HEAD 면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    /// 서버가 마지막으로 올린 머리 — 서버는 이것만 이어 쓴다(다르면 Run 보류).
    pub expected_head: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_head: Option<String>,
    /// 사람이 [정리]로 통합 ref 를 지웠다 — 그 뒤 통합 ref 부재는 기대한 상태다(거짓 `integration-diverged` 를 걸지 않게).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub work_ref_removed: bool,
}

impl Integration {
    pub(crate) fn head_matches(&self, current: Option<&str>) -> bool {
        match current {
            Some(c) => c == self.expected_head,
            None => self.work_ref_removed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum HoldReason {
    /// 사람의 [조정] 뒤에만 풀린다.
    IntegrationDiverged,
    /// 통합 의도를 디스크에 저장하지 못했다 — 올리기(CAS)를 하지 않았다.
    PersistFailed,
    CleanupPending,
    /// 통합 Job 시작 직전 저장소 신원이 Run 이 처음 읽은 것과 다르다 — 사람이 보고 푼다.
    RepoIdentityChanged,
}

impl HoldReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            HoldReason::IntegrationDiverged => "integration-diverged",
            HoldReason::PersistFailed => "persist-failed",
            HoldReason::CleanupPending => "cleanup-pending",
            HoldReason::RepoIdentityChanged => "repo-identity-changed",
        }
    }
}

/// 서 있는 동안 Run 은 paused 이고 새 Job · 새 Attempt · 조율 쓰기는 `run-on-hold`, [재개]도 막힌다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunHold {
    pub reason: HoldReason,
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// `committing` 은 취소를 받지 않는다(같은 잠금에서 직렬화 — `integration-committing`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JobPhase {
    Prepared,
    Candidate,
    AwaitingApproval,
    Verifying,
    Committing,
    Integrated,
    Conflict,
    Aborted,
}

impl JobPhase {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            JobPhase::Prepared => "prepared",
            JobPhase::Candidate => "candidate",
            JobPhase::AwaitingApproval => "awaiting-approval",
            JobPhase::Verifying => "verifying",
            JobPhase::Committing => "committing",
            JobPhase::Integrated => "integrated",
            JobPhase::Conflict => "conflict",
            JobPhase::Aborted => "aborted",
        }
    }

    /// Run 당 하나(`integration-busy`) · 중단은 이것이 0 이 될 때까지 기다린다.
    pub(crate) fn live(self) -> bool {
        !matches!(self, JobPhase::Integrated | JobPhase::Conflict | JobPhase::Aborted)
    }

    /// 사람 [취소] · Run 중단 · 세대 교체를 받는 단계(커밋 단계 전).
    pub(crate) fn cancellable(self) -> bool {
        matches!(
            self,
            JobPhase::Prepared | JobPhase::Candidate | JobPhase::AwaitingApproval | JobPhase::Verifying
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobOutcome {
    pub reason: String,
    pub at: u64,
}

/// 통합 작업 기록 — **영속 의도**. `committing` 은 이 기록의 **영속 저장 성공이 확인된 뒤에만** ref 트랜잭션(CAS)으로 간다 — 재시작 뒤에는
/// 이 기록과 완료 증거 ref(`done/<job>`)로 통합 여부를 판정한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationJob {
    pub job_id: String,
    pub task_id: String,
    pub gen: u32,
    /// 올리기 직전 재확인한다.
    pub task_version: u64,
    pub attempt_id: String,
    pub report_id: String,
    pub report_commit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_base: Option<String>,
    /// CAS 의 old.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    /// CAS 의 new.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_tree: Option<String>,
    pub phase: JobPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<JobOutcome>,
    pub request_id: String,
    pub by: Reviewer,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committing_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<VerifyApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<VerifyResult>,
    /// 실패한 Job 에 묶인 새 Job 에만.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "override")]
    pub override_: Option<VerifyOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub review_waived: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waived: Vec<Waiver>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub judgments: Vec<String>,
}

/// 메타만 — 본문 없음.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    pub seq: u64,
    pub at: u64,
    pub actor: Actor,
    /// 감사의 `event` 와 같은 낱말.
    pub action: String,
    /// 없으면 Run 자신.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// 파일 이름은 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<u32>,
}

/// 멱등 기록 한 줄 — `(runId, requestId)` 의 **처음 결과**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdemEntry {
    pub request_id: String,
    pub tool: String,
    pub result: Value,
    /// 같은 id · 다른 입력이면 `request-id-reused`. `None`(옛 기록)은 도구만 맞춘다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_sha: Option<String>,
}

/// 터미널에서 직접 한 병합은 여기 적히지 않는다(보기 칸 `mergedOutside`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunMerge {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged: Option<MergedRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped: Option<MergeStop>,
}

/// `by` 가 server 면 자동 병합.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergedRecord {
    pub commit: String,
    pub head: String,
    pub target: String,
    pub by: Actor,
    pub at: u64,
}

/// 세부는 사람 보드에만 나간다(MCP · 알림은 낱말뿐).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeStop {
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Run {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<AlbumConfig>,
    pub id: String,
    pub name: String,
    pub state: RunState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_state: Option<RunState>,
    /// 조정자 세대 — 이어받을 때마다 1 씩.
    pub gen: u32,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    pub limits: Limits,
    /// 옛 파일 호환 — 읽고 다시 저장할 때 그대로 둔다. 새 Run 은 쓰지 않고 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_permission: Option<WorkerPermission>,
    /// 옛 파일 호환 — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attach_mode: Option<AttachMode>,
    /// 옛 파일 호환 — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_stop_reported: Option<bool>,
    /// 옛 파일 호환 — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_clis: Option<Vec<WorkerCli>>,
    pub repo: String,
    pub worktree_dir: String,
    /// epoch ms — 넘으면 paused.
    pub coordination_deadline_at: u64,
    /// epoch ms — 넘으면 stopping.
    pub execution_deadline_at: u64,
    #[serde(default)]
    pub pause_reason: Option<String>,
    pub seq: u64,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub attempts: Vec<Attempt>,
    #[serde(default)]
    pub reports: Vec<Report>,
    #[serde(default)]
    pub accepted: Vec<AcceptedArtifact>,
    /// 새 줄만 더한다.
    #[serde(default)]
    pub reviews: Vec<ReviewRecord>,
    /// 옛 파일 호환 — 읽고 다시 저장할 때 그대로 두며(빈 목록도) 턴 한도 셈에만 더한다. 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliveries: Option<Vec<DeliveryRecord>>,
    #[serde(default)]
    pub commits: Vec<WorkerCommit>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
    #[serde(default)]
    pub requests: VecDeque<IdemEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration: Option<Integration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<RunHold>,
    /// 끝난 것도 남는다.
    #[serde(default)]
    pub jobs: Vec<IntegrationJob>,
    /// `None` = 검증 없음.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<VerifyConfig>,
    /// 옛 파일 호환 — 옛 Run 의 사람 면제 기록에만 뜻이 있다. 새 Run 은 쓰지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_review: Option<bool>,
    /// 옛 파일 호환 — 새 Run 은 쓰지 않고 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer_clis: Option<Vec<WorkerCli>>,
    /// 새 줄만 더한다.
    #[serde(default)]
    pub review_reports: Vec<ReviewReport>,
    /// 예상 밖 변경으로 지우지 않고 남긴 서버 임시 자리 — 경로는 사람 보기에만(감사 · 알림에는 수만).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temp_pending: Vec<TempPending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<RunDelegation>,
    #[serde(default = "human_origin")]
    pub origin: RunOrigin,
    /// **귀속** — 이 Run 을 연 · 이어받은 프로듀서 채팅 id(순서대로). 귀속의 권위 있는 자리이고 프로세스 재시작 · 재부착 · 모델 변경 ·
    /// 서버 재시작으로 지우지 않는다(채팅 하나 = 앨범 하나). 권한이 아니다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub producers: Vec<String>,
    /// 예약한 깨움마다 한 줄(재시도 포함) — 앨범당 누적 상한([`super::wake::RUN_MAX`])이 곧 이 길이다 · 초기화 없음. 문장은 싣지 않고
    /// SHA-256 만 — 표시용일 뿐 권한 · 커서 · 셈의 근거가 아니다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wakes: Vec<WakeRecord>,
    /// 깨움으로 처리된 끝(seq) — Run 에 귀속된다(adopt · 프로세스 재시작으로 되돌리지 않는다).
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub wake_handled_to: u64,
    /// `archived/` 의 파일에만 있고 복원하면 지운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge: Option<RunMerge>,
}

fn is_zero_u64(v: &u64) -> bool {
    *v == 0
}

/// 본문 없음.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WakeRecord {
    pub wake_id: String,
    pub chat: String,
    /// `wake_text` 가 지은 문장의 SHA-256.
    pub sha: String,
    pub from_seq: u64,
    pub to_seq: u64,
    pub at: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retry: bool,
    /// 열거 낱말 · 그 Run 의 id 만 — 자유 글 없음.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<WakeRecordItem>,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub more: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub resync: bool,
}

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WakeRecordItem {
    pub what: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
}

pub(crate) const PRODUCERS_MAX: usize = 8;

impl Run {
    pub(crate) fn legacy_require_review(&self) -> bool {
        self.require_review == Some(true)
    }

    pub(crate) fn legacy_deliveries(&self) -> u32 {
        self.deliveries.as_ref().map_or(0, |d| d.len() as u32)
    }

}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempPending {
    pub path: String,
    pub role: String,
    pub why: String,
    pub at: u64,
}

impl Run {
    pub(crate) fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }

    pub(crate) fn valid_artifact(&self, task_id: &str) -> Option<&AcceptedArtifact> {
        self.accepted.iter().rev().find(|a| a.task_id == task_id && a.revoked_at.is_none())
    }

    /// 한 Attempt 에 하나(늦은 보고 포함).
    pub(crate) fn report_of(&self, attempt_id: &str) -> Option<&Report> {
        self.reports.iter().find(|r| r.attempt_id == attempt_id)
    }

    /// Run stopped 는 이것이 0 일 때만 — 프로세스 트리 종료 확인 뒤에만.
    pub(crate) fn live_attempts(&self) -> usize {
        self.attempts.iter().filter(|a| a.turn_may_live()).count()
    }


    /// 동시 작업자 한도 — 검토자는 따로 세고 `idle` 은 자리를 차지하지 않는다.
    pub(crate) fn live_workers(&self) -> usize {
        self.attempts.iter().filter(|a| !a.is_reviewer() && a.turn_may_live()).count()
    }

    pub(crate) fn worker_count(&self) -> usize {
        self.attempts.iter().filter(|a| !a.is_reviewer()).count()
    }

    pub(crate) fn review_count(&self) -> usize {
        self.attempts.iter().filter(|a| a.is_reviewer()).count()
    }

    /// 턴 기록은 최근 [`TURNS_KEPT`] 개뿐이라 기록 수가 아니라 턴 번호로 센다(첫 턴 = 1).
    pub(crate) fn resume_turns(&self) -> u32 {
        self.attempts
            .iter()
            .filter(|a| a.kind == Some(AttemptKind::Write))
            .map(|a| a.turn_no().saturating_sub(1))
            .sum()
    }

    pub(crate) fn live_job(&self) -> Option<&IntegrationJob> {
        self.jobs.iter().find(|j| j.phase.live())
    }

    pub(crate) fn live_jobs(&self) -> usize {
        self.jobs.iter().filter(|j| j.phase.live()).count()
    }

    /// 메모리만 — 영속 · 알림은 `store.rs` 의 `after_change`.
    pub(crate) fn bump(&mut self, now: u64, actor: Actor, action: &str, target: Option<&str>, outcome: &str) -> u64 {
        self.seq += 1;
        self.updated_at = now;
        self.log.push(LogEntry {
            seq: self.seq,
            at: now,
            actor,
            action: action.to_string(),
            target: target.map(str::to_string),
            outcome: outcome.to_string(),
            request_id: None,
            files: None,
        });
        if self.log.len() > LOG_KEEP {
            let over = self.log.len() - LOG_KEEP;
            self.log.drain(..over);
        }
        self.seq
    }

    pub(crate) fn remember(&mut self, request_id: &str, tool: &str, input_sha: &str, result: Value) {
        self.requests.push_back(IdemEntry {
            request_id: request_id.to_string(),
            tool: tool.to_string(),
            result,
            input_sha: Some(input_sha.to_string()),
        });
        while self.requests.len() > IDEMPOTENCY_KEEP {
            self.requests.pop_front();
        }
    }
}

/// OS 엔트로피가 없으면 `None` — 예측 가능한 id 를 만들지 않는다.
pub(crate) fn new_id(prefix: &str) -> Option<String> {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).ok()?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(prefix.len() + 1 + buf.len() * 2);
    s.push_str(prefix);
    s.push('-');
    for &b in &buf {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    Some(s)
}

pub(crate) fn is_id(prefix: &str, s: &str) -> bool {
    s.strip_prefix(prefix)
        .and_then(|r| r.strip_prefix('-'))
        .is_some_and(|hex| hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}
