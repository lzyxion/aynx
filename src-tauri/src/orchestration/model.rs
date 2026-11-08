//! 오케스트레이션 **자료형** — Run · Task · Attempt · Report · AcceptedArtifact · 한도 · 타임라인(설계 B ·
//! docs/log/2026-10-14-orchestration-design.md).
//!
//! 불변식:
//! - 이 파일의 자료형은 **비밀을 담지 않는다** — 역할 토큰은 `store.rs` 의 표에만 있고 여기 어느 칸에도 없다. 그래서 `Debug` 파생이
//!   안전하고, `Run` 을 통째로 영속 파일(`persist.rs`)에 써도 토큰이 새지 않는다(시험 `run_json_has_no_tokens_or_bodies`).
//! - 프롬프트 전문 · 대화 기록 · PTY 출력 칸도 없다(설계 C-7 "싣지 않는 것"). 전달 기록([`DeliveryRecord`] — 5단계)도 길이 · 해시만 싣는다.
//! - `Attempt` 는 3단계(작업자 생성 — `attempts.rs`)가 채운다. `Report` · `AcceptedArtifact` · `ReviewRecord` 는 4단계(보고 · 수락 —
//!   `report.rs`)가 만든다. 보고 본문(`summary` · `notes`)은 작업자가 쓴 글이라 영속 파일 · 사람 보기에는 싣지만 **감사에는 길이만**(E-2).
//! - `AcceptedArtifact` 는 한 번 만들면 **바뀌지 않는다** — 뒤집기(사람의 반려)는 `revoked_at` · `revoked_by` 두 칸을 **한 번** 채우는 것뿐이고
//!   (`None` → `Some`), 다시 수락하면 새 기록을 더한다(옛 것은 남는다). 유효한 수락 = 그 Task 의 마지막 · 거둬지지 않은 기록.
//! - 직렬화 이름은 camelCase(MCP · 프런트 계약과 같은 관례). 상태 글자는 설계 B 표 그대로.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 영속 파일의 판 — 판 4는 앨범 구성을 싣는다(앨범 먼저 설계 S2 · 13절).
pub(crate) const FILE_VERSION: u32 = 4;

/// 판 4 하나만 읽는다. 판 1~3은 몸을 해석하거나 지우지 않고 로그 한 줄로 건너뛴다.
pub(crate) const SUPPORTED_FILE_VERSIONS: [u32; 1] = [4];

/// 앨범 등급 — 판정형은 이 글자와 무관하게 늘 읽기 전용이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemberGrade {
    Read,
    Edit,
    Full,
}

/// 앨범에 들인 아티스트와 그 앨범에서만 유효한 실행 범위.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlbumMember {
    pub artist: String,
    pub name: String,
    pub grade: MemberGrade,
    pub allowed_commands: Vec<String>,
    pub joined_rev: u32,
}

/// 사람 구성의 지금 판 — 프로필 · 검증 글자 · 한도 · 저장소 신원은 각자의 원천에 남긴다.
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
    /// 완료되면 자동 병합(`album_merge.rs`) — 사람이 앨범 시작 · [앨범 권한]에서만 켠다. 검증 명령이 있어야 켜진다 · 넓힘 · 위험 확인. 옛 파일은 꺼짐.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub auto_merge: bool,
}

/// 멱등 기록을 Run 마다 몇 개까지 두나(가장 오래된 것부터 버린다).
pub(crate) const IDEMPOTENCY_KEEP: usize = 512;

/// 타임라인을 Run 마다 몇 줄까지 두나(가장 오래된 것부터 버린다 — 영속 파일이 끝없이 커지지 않게).
pub(crate) const LOG_KEEP: usize = 1000;

/// Run 상태(설계 B) — `orphaned` 는 서버 재시작 뒤 파일에서 읽어 올린 **읽기 전용** Run 이다(C-7).
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
    /// 살아 있는 Run 인가 — 서버 자진 종료를 막고(`serve::Busy.runs`) 동시 Run 한도에 센다. orphaned 는 아니다.
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

/// Task 상태(설계 B).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TaskState {
    Todo,
    Active,
    Reported,
    Accepted,
    Rejected,
    Cancelled,
    /// 수락 요청이 통합 작업([`IntegrationJob`])이 됐다(통합 설계 2-3) — 끝나면 accepted · conflict · reported. 이 동안 Task 쓰기는
    /// `task-busy`, 사람 [취소]는 커밋 단계 전까지만(`integrate.rs`).
    Integrating,
    /// 통합 후보가 충돌했다 — 수락 안 됨(`Task.conflict` 에 구조 기록). 나가는 길: 반려 · 취소(해결 Attempt 는 3b).
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

    /// 종결 상태인가(Run 완료 조건 — 통합 설계 3-4).
    pub(crate) fn terminal(self) -> bool {
        matches!(self, TaskState::Accepted | TaskState::Rejected | TaskState::Cancelled)
    }
}

/// Attempt 상태(설계 B · 헤드리스 설계 4-8). **3차(3a) 헤드리스 Attempt 의 상태는 여덟**이다 — `spawning` · `running`(턴이 돈다) ·
/// `idle`(턴이 끝났고 열려 있다 — 같은 대화로 이어 시킬 수 있다) · `reported`(보고한 턴이 끝났다 — 닫힘) · `stopping` · `stopped` ·
/// `stop-unconfirmed`(트리 종료를 확인하지 못했다 — 산 것으로 센다) · `exited`(검토자 무판정 · 첫 턴 생성 실패 — 닫힘).
/// 옛 변이(`starting` · `ready` · `working` · `awaiting-human` · `needs-recovery` · `exit-unconfirmed` — 2차 PTY 작업자)는 **읽기 전용**이다
/// (v1 · v2 파일을 깨지 않고 읽는다 — 새 Attempt 는 그 상태로 가지 않는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AttemptState {
    Spawning,
    /// (옛 — 2차 PTY 부트스트랩) 읽기만.
    Starting,
    /// (옛 — 2차 PTY 입력 대기) 읽기만.
    Ready,
    /// (옛 — 2차 PTY 일하는 중 · 2단계 헤드리스 검토자) 읽기만.
    Working,
    /// (옛 — 2차 권한 화면 · 첫 화면 · 멈춤) 읽기만.
    AwaitingHuman,
    /// (옛 — 2차 결과를 모르는 붙여넣기) 읽기만.
    NeedsRecovery,
    /// (3차) 턴(= 프로세스 하나)이 돈다 — 첫 턴 · 이어지는 턴 모두.
    Running,
    /// (3차) 턴이 끝났고(트리 종료 확인) 닫히지 않았다 — 보고 없이 끝난 턴 · `blocked` 보고 뒤. worktree · 대화를 쥐고 산 토큰은 없다.
    Idle,
    Reported,
    Exited,
    Stopping,
    Stopped,
    StopUnconfirmed,
    /// (옛 — 2차 PTY 자연 종료의 트리 미확인) 읽기만. 3차는 `stop-unconfirmed` 하나로 센다(4-4 표).
    ExitUnconfirmed,
}

impl AttemptState {
    /// (2차 뜻) 프로세스가 아직 살아 있을 수 있는가 — 중단이 `stopped` 로 넘어가려면 이것이 모두 거짓이어야 한다(설계 C-7
    /// "stopped 는 종료 확인 뒤에만"). `stop-unconfirmed` 는 확인하지 못한 것이라 산 것으로 센다.
    ///
    /// (3차 3a-0) 이 한 술어가 지던 뜻은 술어 넷([`turn_may_live`] · [`attempt_closed`] · [`owns_worktree`] · [`resumable`] — 헤드리스
    /// 설계 4-5 · D9)으로 갈랐다. 이 파일 밖에서는 부르지 않는다 — PTY 갈래(옛 파일)의 바탕일 뿐이다.
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

/// Attempt 의 실행 방식(헤드리스 설계 4-5 · 5절 D13) — 술어 넷과 잔존 판정이 이것으로 갈린다.
/// - `Pty`: 2차 작업자(그리고 2단계 전의 검토자) — 세션 하나(`stream`)가 Attempt 수명 내내 산다. 보고(`reported`) 뒤에도 CLI 가 끝날
///   때까지 산다(보고 뒤 자동 종료가 끝냈다). **옛 파일에만 있다**(3a 부터 새 Attempt 는 모두 헤드리스).
/// - `Headless`: 턴(= 프로세스)으로 사는 Attempt — 3a 의 작업자 · 해결자 · 검토자(`kind` 칸이 있다), 2단계의 검토자(`turns` 가 있거나
///   스트림 없는 검토자).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExecMode {
    Pty,
    Headless,
}

/// 술어 1 — **턴(프로세스)이 살아 있을 수 있나**(헤드리스 설계 4-5 표). 동시 한도 · `busy` · Run stopping → stopped · 서버 재시작 잔존
/// 판정 · 정리 거절 · 종료 감시가 쓴다.
/// - 헤드리스(3차): spawning · running · stopping · stop-unconfirmed. `idle` · `reported`(턴 끝에만 선다 — 턴 밖) · `exited` · `stopped` 는
///   거짓. 옛 변이(2단계 헤드리스 검토자의 `working` · 옛 `exit-unconfirmed` 등)는 옛 뜻 그대로 산 것으로 센다(닫힌 쪽으로 읽지 않는다).
/// - PTY(옛 파일): 옛 `process_may_live` — 보고 뒤에도 세션이 산다.
pub(crate) fn turn_may_live(state: AttemptState, mode: ExecMode) -> bool {
    match mode {
        // 옛 파일 호환(v1 · v2 PTY 작업자).
        ExecMode::Pty => state.process_may_live(),
        ExecMode::Headless => !matches!(
            state,
            AttemptState::Idle | AttemptState::Reported | AttemptState::Exited | AttemptState::Stopped
        ),
    }
}

/// 술어 2 — **Attempt 가 닫혔나**(더는 일을 받지 않는다 — reported · stopped · exited). `send_prompt` · `completable` · 토큰 · 소유 해제가
/// 쓴다. 헤드리스의 `reported` 는 턴이 끝난 뒤에만 서므로 닫힌 헤드리스 Attempt 의 턴은 살아 있지 않다. PTY(옛 파일)는 보고 뒤에도 CLI
/// 가 살 수 있다(그동안은 [`owns_worktree`] 가 참이다).
pub(crate) fn attempt_closed(state: AttemptState, _mode: ExecMode) -> bool {
    matches!(state, AttemptState::Reported | AttemptState::Stopped | AttemptState::Exited)
}

/// 술어 3 — **worktree · 대화 등 Attempt 자원을 쥐고 있나** = 닫히지 않았거나(`idle` 포함) 턴이 아직 살 수 있다. worktree 재사용
/// (`reuseWorktreeOf`) · 사람 [정리] 거절 · `cleanup.rs` · `integrate.rs` 의 자원 판정 · Task 의 현재 Attempt 판정이 쓴다.
pub(crate) fn owns_worktree(state: AttemptState, mode: ExecMode) -> bool {
    !attempt_closed(state, mode) || turn_may_live(state, mode)
}

/// 술어 4 — **같은 대화로 이어지는 지시를 받을 수 있나**(Attempt 의 상태 몫 — `send_prompt` · `wait_run until=ready`).
/// - 헤드리스(3차): `idle`. **대화 끊김(`conversationBroken`)은 [`Attempt::resumable`] 이, Run running 은 부르는 쪽 관문이 본다**(Run 상태는
///   Attempt 가 모른다).
/// - PTY(옛 파일): `ready`(2차 입력 대기 — 옛 `wait_run until=ready` 의 판정 그대로).
pub(crate) fn resumable(state: AttemptState, mode: ExecMode) -> bool {
    match mode {
        // 옛 파일 호환(v1 · v2 PTY 작업자 — orphaned 로만 오른다).
        ExecMode::Pty => state == AttemptState::Ready,
        ExecMode::Headless => state == AttemptState::Idle,
    }
}

/// Attempt 의 바탕 종류(헤드리스 설계 4-7 · U6 — 역할의 `kind` 사본). 쓰기형 = 작업자 · 해결자(resume 되는 Attempt), 판정형 = 검토자(한 턴).
/// 이 칸이 있으면 3차 Attempt 다(헤드리스 — [`Attempt::exec_mode`]).
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

/// `blocked` 보고(헤드리스 설계 4-6 · D7) — **비종결**: Attempt 는 그 턴이 끝나면 `idle` + 이 표지(미커밋 작업 · worktree · 대화는 그대로).
/// 새 턴이 서면 지운다. `need` 는 작업자가 쓴 글(요약 — 정화 · 1 KiB 까지)이라 영속 · 보드 · 조정자에만 — 감사에는 길이 · 해시만.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Blocked {
    pub need: String,
    pub at: u64,
}

/// 수락 규칙 면제 한 줄(헤드리스 설계 3-2a · E18) — 사람 수락이 넘은 규칙. 옛 `review_waived*`(2차 `requireReview`)는 `{rule: "review"}` 한
/// 줄로 읽는다([`AcceptedArtifact::waivers`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Waiver {
    /// `judgment`(필수 판정) · `review`(옛 `requireReview`).
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

/// Run 이 맡기기에서 읽은 신원 사본(헤드리스 설계 2-4 · 2-6 · 4-8 — 처음 읽은 때). 이 뒤의 턴 · 무인 검증 · 통합 직전마다 지금 신원이 이것과
/// 같아야 한다(같은 경로에 다시 clone 한 저장소 · 바뀐 맡기기를 가린다). 값은 해시 · 식별뿐(비밀 없음).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunDelegation {
    /// 맡긴 경로(블록의 열쇠).
    pub path: String,
    /// git 공통 폴더(비교용 글자).
    pub git_dir: String,
    /// 실체 식별(식별을 못 재는 OS 면 없다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    /// 처음 읽은 때 블록의 받아들인 판 해시(감사용).
    pub accepted_sha: String,
    pub at: u64,
}

/// 누가 Run 을 열었나(헤드리스 설계 3-2 · 5단계 — 판 3 의 칸). 칸이 없는 옛 파일은 **사람이 연 Run**(시작 대화)으로 읽는다.
/// AI 가 연 Run(`start_run`)은 그 프로듀서 채팅 id 를 적는다(`producer` — 비밀이 아니다 · 앨범 머리의 "AI 가 연 앨범 · 프로듀서 채팅" 한 줄).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunOrigin {
    /// `human` · `ai`.
    pub by: String,
    /// 연 프로듀서 채팅 id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer: Option<String>,
    /// 사람이 앨범을 열 때 고른 프로듀서 기본값(대화 본문은 없다).
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

/// 옛 파일(칸 없음) · 사람이 연 Run.
pub(crate) fn human_origin() -> RunOrigin {
    RunOrigin {
        by: "human".into(),
        producer: None,
        producer_config: None,
    }
}

/// 작업자 권한 모드(설계 C-5) — **옛 파일 호환**(2차 시작 대화에서 사람이 고르던 값 — 3차 6단계부터 새 Run 에는 없다 · 감사의 `run_started`
/// 에 옛 값이 있으면 그대로).
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

/// 작업자 타일을 Run 탭에 붙이는 방식(사용자 결정 10-15) — **옛 파일 호환**(2차 시작 대화의 칸 — 디코딩용으로만 남는다. 3a 부터 작업자
/// 타일이 없다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttachMode {
    /// 사람이 필요할 때만(2차).
    OnDemand,
    /// 늘(10-15 이전 동작).
    Always,
}

/// 서버가 집행한 작업자 커밋 한 줄(`commit_changes` — `commit.rs`). 메시지는 **첫 줄만**(짧게 자른다) · 경로 목록은 싣지 않는다(개수만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerCommit {
    pub attempt_id: String,
    pub commit_oid: String,
    pub parent_oid: String,
    pub branch: String,
    /// 메시지 첫 줄(제어 문자 없이 · 120자까지).
    pub subject: String,
    /// 이 커밋에 든 파일 수.
    pub files: u32,
    pub at: u64,
}

/// 마지막 `commit_changes` 거절(사용자 결정 10-15 — 보드 작업자 칸 · 조정자 `get_run` · `read_worker` 요약). 사유 낱말 · 요청 id ·
/// 파일 수만 — **경로 목록 · 메시지 본문은 싣지 않는다**. 그 뒤 커밋이 서면 걷힌다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitRejection {
    /// 거절 사유 낱말(`filters-configured` · `no-git-identity` · `head-moved` · …).
    pub reason: String,
    /// 작업자 요청 id(제어 문자 없음 · 128자까지). 인자가 깨져 읽지 못했으면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// 고른 파일 수(`selection.paths` 의 길이 — `"all"` 이면 없다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<u32>,
    /// 사람이 손써야 풀리는 사유인가([`commit_needs_human`]).
    #[serde(default)]
    pub needs_human: bool,
    /// 그 거절 사건의 seq(타임라인 `commit_rejected`).
    pub seq: u64,
    pub at: u64,
}

/// 작업자가 다시 해 봐도 풀리지 않고 **사람이 해야 하는** 커밋 거절 — 감독 알림(`notice.rs`)도 낸다. 나머지(`head-moved` ·
/// `branch-mismatch` · `path-outside` · `nothing-to-commit` · 인자 오류 …)는 작업자가 스스로 고칠 수 있어 타임라인 · 감사만.
pub(crate) fn commit_needs_human(reason: &str) -> bool {
    matches!(reason, "filters-configured" | "no-git-identity" | "worktree-mismatch" | "commit-failed")
}

/// 작업자 CLI(1차 — 로컬 Claude · Codex 만).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkerCli {
    Claude,
    Codex,
}

impl WorkerCli {
    /// CLI 이름(실행 파일 이름 · 훅 신호의 `cli` 와 같은 글자).
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            WorkerCli::Claude => "claude",
            WorkerCli::Codex => "codex",
        }
    }
}

/// 역할 토큰의 역할(설계 C-1). 역할은 **서버 표에서만** 읽는다. 조정자 토큰은 없다 — 조정자는 프로듀서 채팅 토큰(`crate::chat_token`)에
/// 서버 표의 묶음(`Slot.coordinator`)이 붙인 역할이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    Worker,
    /// 검토자(통합 설계 3-3 — 5단계). **역할 기반 보조 검토**다 — 같은 계정 안의 이름표 토큰((가))이라 작업자가 토큰을 훔쳐 사칭하는 것은
    /// 막지 못한다(독립 진위 보증이 아니다).
    Reviewer,
}

/// 사건을 일으킨 쪽 — 타임라인 · 감사의 `actor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Actor {
    Human,
    Coordinator,
    Worker,
    Server,
    /// 검토자(5단계 — `report_review`).
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

/// 한도(설계 C-7). 기본값이 곧 상한이다 — 사람은 Run 시작 대화에서 **낮출** 수 있고 시간 한도만 늘릴 수 있다
/// ([`LimitsInput::resolve`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Limits {
    /// Run 당 Task 수.
    pub max_tasks: u32,
    /// 조율 도구 호출 분당(조정자 하나 — 읽기 · 쓰기 · 대기 모두 센다).
    pub max_calls_per_minute: u32,
    /// 동시 `wait_run` (Run 당).
    pub max_waiters: u32,
    /// 조율 한도(분) — 넘으면 paused + 사건.
    pub coordination_minutes: u32,
    /// 실행 한도 = 조율 한도 + 이만큼(분) — 넘으면 stopping.
    pub execution_grace_minutes: u32,
    /// 동시 작업자(3단계가 예약한다).
    pub max_concurrent_workers: u32,
    /// 총 작업자(3단계가 예약한다).
    pub max_total_workers: u32,
    /// 이어지는 턴 수(3차 — `send_prompt` 의 resume 턴. 2차의 "전달 횟수" 칸을 그대로 쓴다).
    pub max_deliveries: u32,
    /// 검토 총 수(통합 설계 3-4 · D6 — **작업자 한도와 따로** 센다 · 동시는 Run 당 1). 칸이 없는 옛 파일은 기본값.
    #[serde(default = "default_max_reviews")]
    pub max_reviews: u32,
    /// 턴 실행 시한(분 — 헤드리스 설계 Q4 · 맡기기 `turn_minutes`). 칸이 없는 옛 파일은 기본값(60).
    #[serde(default = "default_turn_minutes")]
    pub turn_minutes: u32,
}

/// 턴 실행 시한의 기본값(분 — 맡기기 `turn_minutes` 기본과 같다).
pub(crate) const DEFAULT_TURN_MINUTES: u32 = 60;

fn default_turn_minutes() -> u32 {
    DEFAULT_TURN_MINUTES
}

/// 검토 총 수의 기본값(통합 설계 3-4 — 3차부터 맡기기의 `max_reviews` 가 정한다).
pub(crate) const DEFAULT_MAX_REVIEWS: u32 = 6;
/// 검토 총 수의 천장(옛 시작 대화가 올릴 수 있던 끝 — 시험 전용 [`LimitsInput`]. 맡기기의 천장은 `delegation::repo` 가 따로 쥔다).
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

/// 서버 전체 동시 Run(running · paused · stopping) 상한.
pub(crate) const MAX_ACTIVE_RUNS: usize = 2;

/// 시간 한도의 천장(분) — 하루. 사람이 실수로 무한에 가깝게 두지 않게.
#[cfg(test)]
const MAX_MINUTES: u32 = 24 * 60;

/// 한도 입력(전부 선택) — [`Self::resolve`] 가 상한으로 자른다. **시험 전용**(3차 6단계 — 이것을 보내던 사람의 Run 시작 대화 · 시작 op 는
/// 걷었다. AI 가 연 Run 의 한도는 맡기기 값 이하만 — `start.rs` 의 `scoped_limits`).
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
    /// 검토 총 수 — 이것만 기본값(6)보다 **올릴** 수 있다(1..=20 — 통합 설계 3-4).
    pub max_reviews: Option<u32>,
}

#[cfg(test)]
impl LimitsInput {
    /// 개수 한도는 1..=기본값(설계 수치가 상한), 시간 한도는 1..=하루(유예는 0 도 된다). 검토 수만 1..=[`MAX_REVIEWS_CAP`].
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

/// Task — 조정자가 정의한다(설계 B). 명세 글자(goal · scope · doneWhen)는 영속 파일에는 싣지만 **감사에는 싣지 않는다**(E-2).
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
    /// 갱신마다 1 씩 — `update_task` 의 버전 비교(`conflict`).
    pub version: u64,
    pub state: TaskState,
    #[serde(default)]
    pub current_attempt: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// 마지막 통합 후보가 충돌했을 때의 구조 기록(통합 설계 4-6 — `conflict` 상태로 들어갈 때 서버가 채운다). 해결 Attempt 가 이것으로
    /// 일하므로 active · reported 동안은 남고, 그 충돌이 뜻을 잃는 전이(수락 = 통합 · 반려 · 취소)에서 걷는다(E2E 10-16 #7a — 해결자
    /// Attempt 의 `resolves` · 타임라인은 역사로 남는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict: Option<ConflictInfo>,
    /// 검토 자리(통합 설계 3-3 · R7) — **작업자 수명(`current_attempt` · Task 상태)과 따로**. 바뀌어도 Task 버전은 오르지 않는다.
    #[serde(default)]
    pub review: ReviewSlot,
    /// 되돌림 셈(헤드리스 설계 3-2a · E18) — 이 Task 가 `reported → rejected` 로 간 횟수(조정자 · 사람 반려 모두). 쓰기형을 다시 띄울 때
    /// 맡기기의 `max_rework` 와 견준다(`rework-limit`). 충돌 해결자 · `blocked` 뒤 resume 은 세지 않는다. 옛 파일은 0.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rework_count: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// Task 의 검토 자리 — 보고당 활성 검토 하나(`review-active`). `active` 는 지금 살아 있는 검토 Attempt, `target` 은 그 대상 보고
/// (판정이 서면 `active` 만 비고 `target` 은 마지막 대상으로 남는다). 무효화(보고 교체 · 반려 · 취소 · 수락)는 둘 다 비운다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSlot {
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
}

/// Attempt 의 역할(통합 설계 2-1) — 작업자(해결 Attempt 도 작업자다 — `resolves` 로 가린다) · 검토자. 칸이 없는 옛 파일은 작업자.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AttemptRole {
    #[default]
    Worker,
    Reviewer,
}

/// 검토 Attempt 의 고정 대상(통합 설계 3-3 · D7) — 띄울 때 정하고 바뀌지 않는다. 자리(`place`)는 보고 커밋의 분리 HEAD worktree
/// (읽기 자리), `cwd` 는 서버가 만든 빈 폴더(검토자 CLI 의 작업 폴더 — 작업자가 커밋한 프로젝트 설정 파일이 cwd 설정으로 읽히지 않게).
/// 둘은 서버 손이 자리를 만든 뒤 채운다.
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

/// 턴 기록의 인자 — **권한 표시 전용 구조**(헤드리스 설계 4-2 · D11): CLI · 등급 · 설정 출처 통제 · 허용 규칙 · 샌드박스 · 모델 · 강도 ·
/// 지침 해시 · resume. 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 · 대화 id 는 **없다**(`turn::args_label` 하나가 짓는다).
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
    /// 이 턴의 실효 실행 시한(분 — `roles::turn_minutes` 의 min 규칙 값 · 턴을 띄운 손이 적는다). 작업자 상세의 턴 시한 막대 — 옛 기록은 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_minutes: Option<u32>,
}

/// 턴 stdout 의 이상 입력 셈(헤드리스 설계 4-4 — 본문은 어디에도 없다).
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

/// 헤드리스 턴 하나의 기록(3차 2단계 — 지금은 검토자만 · 3a 에서 작업자도). 낱말 · 수만 — **프롬프트 · 지침 · 모델 글 · 도구 입력 · 토큰 ·
/// 대화 id 는 없다**(4-8 · D11). `outcome` = `running` · `ok` · `failed` · `timeout` · `stopped` · `stop-unconfirmed`.
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
    /// 막힌 종류 낱말(Codex stderr — `outside-write` · `policy` · `other`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub denial_kinds: Vec<String>,
    #[serde(default)]
    pub tools: u32,
    /// 마지막 도구 이름(이름만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tool: Option<String>,
    /// init 이 알린 CLI 판(Claude `claude_code_version`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    /// 실효 모델(Claude init `model` — Codex 는 `--json` 에 없다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub args: TurnArgsLabel,
    #[serde(default, skip_serializing_if = "TurnAnomalies::is_zero")]
    pub anomalies: TurnAnomalies,
}

/// Attempt 하나에 남기는 턴 기록 상한(최근 것만 — 4-8).
pub(crate) const TURNS_KEPT: usize = 50;

/// 검토 판정(`report_review{verdict}`).
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

/// 검토 보고가 받아들여진 모양 — `current`(지금 대상의 판정 — 상태에 든다) · `stale`(대상이 무효화된 뒤 — 기록만) · `late`(중단 ·
/// 세대 교체 뒤 — 기록만). 보기(`review::reports_view`)는 끝난 `current` 판정도 대상 보고가 더는 현재 보고가 아니면 `stale` 로 보인다.
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

/// 검토 찾은 것 상한(통합 설계 2-5) — 개수 · 한 줄 글자 수 · 요약 바이트.
pub(crate) const REVIEW_FINDINGS_MAX: usize = 20;
pub(crate) const REVIEW_FINDING_CHARS: usize = 500;
pub(crate) const REVIEW_SUMMARY_MAX: usize = 4 * 1024;

/// 검토 보고 하나(통합 설계 2-5) — 검토자의 `report_review` 때 서버가 만든다. 대상(`reportId` · `commitOid`)은 Attempt 의 고정 대상
/// 그대로다(검토자가 보낸 글자가 아니다). 본문(요약 · 찾은 것)은 영속 · 사람 보기 · 조정자에만 — **감사에는 길이 · 개수만**.
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

/// 충돌 기록의 영속 항목 상한(통합 설계 4-6 — 표시용). 넘으면 처음 것들만 + `more`.
pub(crate) const CONFLICT_ENTRIES_MAX: usize = 200;

/// 충돌 항목의 stage 하나(`merge-tree -z` 의 충돌 파일 정보 한 줄 — `<mode> <oid> <stage>\t<path>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictStage {
    /// 1 = base · 2 = ours(통합 머리) · 3 = theirs(보고 커밋).
    pub stage: u8,
    pub mode: String,
    pub blob: String,
    pub path: String,
}

/// 충돌 항목 하나 — 같은 경로 묶음에 온 메시지 종류들(`contents` · `binary` · `rename/delete` …)과 그 경로들의 stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictEntry {
    pub paths: Vec<String>,
    /// `CONFLICT (<종류>)` 의 종류 낱말들(한 경로에 둘 이상 올 수 있다 — 바이너리는 `binary` + `contents`).
    pub kinds: Vec<String>,
    pub stages: Vec<ConflictStage>,
}

/// 통합 후보의 충돌 구조(통합 설계 4-6 · D8 · R5) — 해결 Attempt(3b)가 이것으로 자리를 깐다. 메시지 원문은 싣지 않는다(종류 낱말만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictInfo {
    pub job_id: String,
    /// 3-way 의 ours(그때의 통합 머리).
    pub old: String,
    pub report_commit: String,
    pub merge_base: String,
    /// 충돌 트리(표식 박힌 blob)를 붙잡은 커밋(`refs/aynx/orch/<run16>/conflict/<task16>` — `integrate::refs`). 못 만들었으면 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_commit: Option<String>,
    pub entries: Vec<ConflictEntry>,
    /// [`CONFLICT_ENTRIES_MAX`] 를 넘어 버린 항목 수.
    #[serde(default)]
    pub more: u32,
    /// 자동 해결 Attempt 대상이 아니다(일반 텍스트 내용 충돌 밖 — 이름 바꿈/삭제 · 수정/삭제 · 바이너리 · 모드 · symlink · submodule).
    /// stage 구조 · 종류 낱말 · **표식 실측**(3b — git 이 표식을 실제로 박았나)의 곱. 항목이 상한을 넘었거나 충돌 트리 커밋이 없어도 사람에게.
    pub needs_human: bool,
    pub at: u64,
}

/// Attempt — 작업자 한 번(설계 B). **2단계는 정의만** — 3단계(`spawn_worker`)가 만든다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attempt {
    pub id: String,
    pub task_id: String,
    pub cli: WorkerCli,
    /// 이 Attempt 를 띄운 Run 세대.
    pub gen: u32,
    pub state: AttemptState,
    #[serde(default)]
    pub stream: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
    /// 이 Attempt 의 worktree 브랜치(Run 이 만든 것 — 3단계).
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub base_commit: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    /// 고정된 대화 id(C-6) — 대화 기록 자체는 싣지 않는다. Claude 는 서버가 정한 `--session-id`, Codex 는 첫 `start` 신호의 `session`.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 실행 줄에 **실제로** 쓴 권한 인자(보드 표시 — 설계 C-5 "실제 적용된 모드"). 토큰 · 프롬프트는 없다.
    #[serde(default)]
    pub launch_args: Option<String>,
    /// 사람이 봐야 할 까닭 — `bootstrap`(60초 안에 첫 신호 없음 — 신뢰 · 로그인 화면) · `permission`(권한 대화상자). 없으면 `None`.
    #[serde(default)]
    pub attention: Option<String>,
    pub started_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub exit_reason: Option<String>,
    /// 결과를 확인하지 못한 전달(5단계 — `pasted-unconfirmed` · `submitted-unconfirmed`)의 `requestId`. 있으면 사람이 [복구 완료] 를
    /// 누를 때까지 **어떤 자동 전달도** 받지 않는다(설계 C-4 복구 불변식 — 보고로 상태가 바뀌어도 이 칸은 남는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_recovery: Option<String>,
    /// 고정 대화(`conversation_id`)가 아닌 대화 id 의 `start` · `stop` 신호가 왔다(resume · fork · `/clear` · 바꿔치기 — 설계 C-6, 6단계).
    /// 고정은 그대로 두고(오케스트레이션 판독은 고정 대화만) 보드에 "대화 바뀜" 경고. 한 번 서면 내려가지 않는다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conversation_changed: bool,
    /// 마지막 `commit_changes` 거절(10-15) — 커밋이 서면 걷힌다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_commit_rejection: Option<CommitRejection>,
    /// 충돌 해결 Attempt(통합 설계 3b · 4-6 — Attempt `seed: conflict`)면 그 충돌의 Job id(`ConflictInfo.jobId`). 자리는 통합 머리 + 충돌 트리.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolves: Option<String>,
    /// 역할(통합 설계 2-1 — 5단계). 검토자는 Task 상태 · `current_attempt` 를 건드리지 않고 작업자 한도에 세지 않는다.
    #[serde(default)]
    pub role: AttemptRole,
    /// 검토자의 고정 대상(5단계 — 검토자만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_of: Option<ReviewOf>,
    /// 헤드리스 턴 기록(3차 — 작업자 · 해결자 · 검토자. 옛 파일 · PTY 작업자는 비어 있다). 최근 [`TURNS_KEPT`] 개.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub turns: Vec<TurnRecord>,
    /// 바탕 종류 사본(3a — 띄울 때 역할에서 · 바뀌지 않는다). **있으면 3차 헤드리스 Attempt** 다(첫 턴 전 `spawning` 도 가린다 —
    /// [`Attempt::exec_mode`]). 옛 파일은 없다(`role` 로 읽는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AttemptKind>,
    /// 띄운 역할의 id(맡기기 `[[repo.role]]` — 3a). 턴마다 이 id 로 지금 역할을 다시 찾는다(`role-removed` · `role-changed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    /// 띄울 때의 역할 이름(보기용 사본 — 역할을 지운 뒤에도 보드가 "지워진 역할 · 이름" 으로 보인다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_name: Option<String>,
    /// `blocked` 보고 표지(4-6 · D7 — 비종결). 새 턴이 서면 지운다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<Blocked>,
    /// 대화가 끊겼다(4-4 · D6 — resume 턴의 init 이 고정 id 와 다르거나 두 번 왔다). 더는 resume 하지 않는다(`send_prompt` → `conversation-broken`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conversation_broken: bool,
    /// 중단을 청했다(`stop_worker` · Run 중단 · 반려 · 취소) — 트리 종료 확인이 늦어 `stop-unconfirmed` 로 남았다가 확인될 때 `stopped`(닫힘)로
    /// 가야 하는지(아니면 턴의 자연 끝 — `idle` · `reported`)를 가른다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stop_requested: bool,
}

impl Attempt {
    pub(crate) fn is_reviewer(&self) -> bool {
        self.role == AttemptRole::Reviewer
    }

    /// 실행 방식 — 바탕 종류(`kind` — 3a 의 모든 새 Attempt)가 있거나 턴 기록이 있거나 스트림 없는 검토자(3차 2단계)면 헤드리스, 아니면
    /// PTY(v1 · v2 작업자 · 2단계 전의 PTY 검토자는 `stream` 이 있다).
    pub(crate) fn exec_mode(&self) -> ExecMode {
        if self.kind.is_some() || !self.turns.is_empty() || (self.is_reviewer() && self.stream.is_none()) {
            ExecMode::Headless
        } else {
            // 옛 파일 호환 — 3a 부터 새 Attempt 는 모두 헤드리스다.
            ExecMode::Pty
        }
    }

    /// 지금(또는 마지막) 턴 번호 — 턴 기록이 없으면 0.
    pub(crate) fn turn_no(&self) -> u32 {
        self.turns.last().map_or(0, |t| t.n)
    }

    /// 마지막 턴이 "살아 있을 수 있음" 으로 끝났나(아직 도는 중 · 트리 미확인) — 서버 재시작 잔존 판정(v3 잡 갈래 — 5절)이 쓴다.
    pub(crate) fn last_turn_may_live(&self) -> bool {
        self.turns.last().is_some_and(|t| matches!(t.outcome.as_str(), "running" | "stop-unconfirmed"))
    }

    /// [`turn_may_live`] — 이 Attempt 의 상태 · 실행 방식으로.
    pub(crate) fn turn_may_live(&self) -> bool {
        turn_may_live(self.state, self.exec_mode())
    }

    /// [`attempt_closed`].
    pub(crate) fn attempt_closed(&self) -> bool {
        attempt_closed(self.state, self.exec_mode())
    }

    /// [`owns_worktree`].
    pub(crate) fn owns_worktree(&self) -> bool {
        owns_worktree(self.state, self.exec_mode())
    }

    /// [`resumable`] + 대화가 끊기지 않았다(4-5 표 — Run running 은 부르는 쪽이 본다).
    pub(crate) fn resumable(&self) -> bool {
        resumable(self.state, self.exec_mode()) && !self.conversation_broken
    }
}

/// 전달 결과(설계 C-4 ⑤) — `rejected`(아무것도 쓰지 않음) · `writing`(쓰는 중) · `pasted-unconfirmed`(붙여넣었지만 Enter 를 못 보냈거나
/// 쓰기가 도중에 끊김) · `submitted-unconfirmed`(Enter 를 보냈지만 5초 안에 UserPromptSubmit 이 없음) · `acknowledged`(관측됨).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DeliveryState {
    Rejected,
    Writing,
    PastedUnconfirmed,
    SubmittedUnconfirmed,
    Acknowledged,
}

/// 전달 기록 한 줄(설계 C-7 영속 — **상태 · 길이 · 해시만**, 본문 없음). (3a) **옛 파일 읽기 · 보존만** — 새 Run 의 이어지는 지시는
/// 턴 기록(`Attempt.turns`)이 대신한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeliveryRecord {
    pub request_id: String,
    pub attempt_id: String,
    pub state: DeliveryState,
    /// 확인하지 못한 까닭 · 거절 까닭(짧은 낱말).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 정화한 본문의 바이트 수(머리줄 제외).
    pub len: u32,
    /// 정화한 본문의 SHA-1(hex) — 같은 지시인지 가리는 데만 쓴다(감사 E-2).
    pub sha1: String,
    pub at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    /// 사람의 [복구 완료] — `processed`(처리됨) · `not-processed`(처리 안 됨 — 조정자가 다시 보낼지 정한다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovered_at: Option<u64>,
}

/// 보고 결과(설계 C-2 `report_done`).
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

/// 보고 하나(설계 B) — 작업자의 `report_done` 때 서버가 만든다(4단계 — `report.rs`). git 칸(`commit_oid` · `dirty` ·
/// `changed_files`)은 **서버가 그 worktree 에서 읽은 것**이다(작업자가 보낸 글자가 아니다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub report_id: String,
    pub attempt_id: String,
    /// 그 Attempt 의 Task(보기 편하게 — Attempt 에서도 찾을 수 있다).
    #[serde(default)]
    pub task_id: String,
    pub outcome: ReportOutcome,
    pub summary: String,
    #[serde(default)]
    pub notes: Option<String>,
    /// 보고 때 worktree `HEAD` — 수락 대상은 늘 이 커밋이다(보고 뒤 바뀌어도).
    #[serde(default)]
    pub commit_oid: Option<String>,
    #[serde(default)]
    pub base_commit_oid: Option<String>,
    /// 보고 때 미커밋 변경(추적 안 된 파일 포함 · 무시 파일 제외)이 있었나 — 성공 보고라도 수락 불가(`dirty-report`).
    pub dirty: bool,
    /// base 이후 바뀐 파일(커밋된 것 — 상한 [`CHANGED_FILES_MAX`]).
    #[serde(default)]
    pub changed_files: Vec<String>,
    /// 상한에서 잘렸나.
    #[serde(default)]
    pub changed_files_truncated: bool,
    /// git 을 읽지 못했으면 그 까닭(짧은 한 줄) — 그 보고는 커밋이 없어 수락할 수 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_error: Option<String>,
    /// HEAD 가 기준 커밋 그대로이고 미커밋 변경도 없다(아무것도 바꾸지 않았다 — 자문 6절 표 `no_changes`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub no_changes: bool,
    /// 불일치 — `branch-changed`(worktree 가 Attempt 의 브랜치가 아니다) · `unexpected-head`(HEAD 가 기준 커밋의 후손이 아니다). 있으면
    /// 수락할 수 없다(`report-mismatch`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mismatch: Option<String>,
    pub at: u64,
    /// 중단 뒤 · 세대 교체 뒤에 온 보고(기록만 — Task 상태는 바꾸지 않는다).
    #[serde(default)]
    pub late: bool,
    /// 해결 Attempt 의 성공 보고 — 충돌 경로마다 어떻게 풀었나(통합 설계 3-2 `resolved`). 그 밖의 보고는 비어 있다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved: Vec<ResolvedPath>,
}

/// 해결 보고의 한 줄(`report_done{resolved: [{path, how}]}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedPath {
    pub path: String,
    pub how: String,
}

/// 보고의 바뀐 파일 목록 상한.
pub(crate) const CHANGED_FILES_MAX: usize = 200;

/// 수락한 사람 · 역할.
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

/// 검토 판정(수락 · 반려 — 뒤집기 포함). 판정마다 **새 줄**이다(옛 줄은 남는다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Accepted,
    Rejected,
}

/// 검토 기록 한 줄(설계 B "반려 · 뒤집기는 새 기록").
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
    /// 앞선 판정을 뒤집었나(수락 → 반려 · 반려 → 수락 — 사람만).
    #[serde(default)]
    pub flipped: bool,
    pub at: u64,
}

/// 수락 산출물에 남기는 검증 요약(통합 설계 2-5 · 5-4 — 4단계). **명령 글자는 싣지 않는다**(Run 의 `verify` 칸에만 — 해시로 묶는다).
/// 덮어쓰기로 수락했으면 `overridden` — 실패한 결과는 실패로 남는다(새 후보의 통과로 적지 않는다).
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

/// Run 의 검증 설정(통합 설계 2-1 · 5-1 · D4) — **사람이 Run 시작 대화(Tauri)에서만** 정한다. MCP 스키마 · 조정자 · 작업자 인자 어디에도
/// 없고 Run 도중 바꾸는 길도 없다(새 Run). 명령 글자는 이 칸에만 있다(감사 · 결과에는 길이 · SHA-256 만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyConfig {
    /// 사람이 친 한 줄(≤1000자 · CR · LF · NUL 없음) — `cmd.exe /d /s /v:off /c "<이 글자>"` 로 그대로 돈다(보간 없음).
    pub command: String,
    /// 명령 글자의 SHA-256(hex) — 사람 확인 · 결과를 묶는 열쇠.
    pub command_sha: String,
    /// 시한(분) — checkout · clean · 실행 · 파이프 배출을 모두 덮는다(1..=60).
    pub timeout_minutes: u32,
    /// '검증 자동 실행' — 켜면 후보마다 사람 확인 없이 돈다('전부 자동' 과 같은 위험 등급 · 시작 때 위험 확인 필수).
    pub auto_run: bool,
    /// 보존 폴더(N2 — 예 `node_modules`). 있으면 결과는 `hermetic: false`.
    #[serde(default)]
    pub keep_dirs: Vec<String>,
    /// 캐시 키 파일(N2 — 예 `package-lock.json`). 후보에서의 blob 이 지난번과 다르면 보존 폴더를 지운다.
    #[serde(default)]
    pub cache_key_files: Vec<String>,
    /// 허용 목록에 더할 환경 변수 **이름**(값은 서버 환경에서 — 영속 · 감사에는 이름만).
    #[serde(default)]
    pub extra_env_names: Vec<String>,
}

/// 검증 결과 낱말(통합 설계 2-5 · 5-4). `pass` 만 올리기로 간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum VerifyOutcome {
    Pass,
    Fail,
    Timeout,
    Cancelled,
    /// 끝난 뒤 추적 파일이 바뀌었다 — 후보가 통과했다고 말할 수 없다(실패로 친다).
    ModifiedTracked,
    /// 시작하지 못했다(`reason` — `job` · `not-clean` · `checkout` · `cmd` · `unsupported` · `server-busy` …).
    SpawnFailed,
    /// 추적 symlink 가 검증 자리 밖을 가리킨다 — 그 후보의 검증을 거절했다(9절 위험 5 확정).
    SymlinkOutside,
    /// 트리 종료(잡 비움 · 파이프 EOF)를 확인하지 못했다 — 실패로 친다.
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

/// 검증을 누가 허락했나 — 사람 확인(후보별) · Run 의 '검증 자동 실행'.
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

/// 사람 확인 · 자동 허락 한 번(통합 설계 5-1) — `{jobId, candidate, commandSha, old}` 에 묶인다. 실행 직전 같은 잠금에서 다시 대조한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyApproval {
    pub by: VerifyApprover,
    pub candidate: String,
    pub command_sha: String,
    pub old: String,
    pub at: u64,
}

/// 검증 결과(통합 설계 2-5) — 후보 OID · 명령 해시 · 환경 정책에 묶인다. 출력 본문은 **메모리만**(꼬리 — `Slot.verify_tails`),
/// 여기에는 바이트 수 · 꼬리의 SHA-256 만.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyResult {
    pub verify_id: String,
    pub job_id: String,
    pub candidate: String,
    pub command_sha: String,
    /// 허용 목록 판 + 추가 이름의 해시(`allow-v1:<sha256 앞 16>`).
    pub env_policy: String,
    /// 보존 폴더를 쓰지 않았다(N2).
    pub hermetic: bool,
    #[serde(default)]
    pub exit_code: Option<i64>,
    pub outcome: VerifyOutcome,
    /// 세부 낱말(`spawn-failed:job` 의 `job` 같은 것 — 사람 글이 아니다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub duration_ms: u64,
    /// stdout + stderr 총 바이트.
    pub out_bytes: u64,
    /// 남긴 꼬리(끝 8 KiB 보기용)의 SHA-256(hex).
    pub tail_sha256: String,
    pub approved_by: VerifyApprover,
    pub at: u64,
}

/// 사람 덮어쓰기(통합 설계 5-4 · D5) — **실패한 그 Job** 의 `{후보, 실패 검증 id, 그때 머리}` 에 묶인다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyOverride {
    /// 실패한 Job.
    pub failed_job_id: String,
    pub verify_id: String,
    pub candidate: String,
    pub old: String,
    pub by: Reviewer,
    pub at: u64,
}

/// 수락 산출물(설계 B) — 한 번 만들면 바뀌지 않는다(4단계 — `report.rs`). 뒤집기는 `revoked_at` · `revoked_by` 를 한 번 채울 뿐이고
/// 나머지 칸은 그대로 남는다. 후속 Task 는 worktree 경로가 아니라 **유효한** 기록의 `commit_oid` 를 참조한다.
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
    /// 자리만(1차는 늘 `None` — 나중의 검증 루프가 쓴다). 칸은 늘 직렬화한다(`verification: null`).
    #[serde(default)]
    pub verification: Option<Verification>,
    pub accepted_at: u64,
    /// 거둔 시각(사람의 뒤집기) — 있으면 이 기록은 더 이상 유효하지 않다.
    #[serde(default)]
    pub revoked_at: Option<u64>,
    #[serde(default)]
    pub revoked_by: Option<Reviewer>,
    /// 통합 커밋(통합 ref 에 쌓은 Task 의 squash — 통합 설계 2-5). 1차 수락 · v1 파일은 없다. 있으면 뒤집기는 `already-integrated`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_commit: Option<String>,
    /// 통합 커밋의 부모(올리기 전 통합 머리).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_parent: Option<String>,
    /// 이 수락을 만든 통합 작업.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    /// 보고 커밋을 붙잡는 보존 ref(`refs/aynx/orch/<run16>/accepted/<task16>` — 4-1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_ref: Option<String>,
    /// 수락 때 그 보고의 마지막 유효 검토(pass — 통합 설계 2-5 · 5단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// `requireReview` 인 Run 에서 유효한 pass 없이 사람이 수락했다(검토 면제 기록 — 통합 설계 D6). (3a) 새 수락은 `waived` 가 주이고, 이
    /// 칸은 면제가 있으면 함께 채운다(옛 보기와의 이음).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_waived_by: Option<Reviewer>,
    /// 사람 수락이 넘은 수락 규칙(헤드리스 설계 3-2a · E18 — 어느 규칙 · 필요 · 가진 수). 옛 파일은 비어 있다([`Self::waivers`] 가 옛 칸을 읽는다).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waived: Vec<Waiver>,
    /// 면제한 쪽(사람).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waived_by: Option<Reviewer>,
    /// 수락 규칙을 채운 판정 id 들(`ReviewReport.reviewId`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub judgments: Vec<String>,
}

impl AcceptedArtifact {
    /// 면제 목록 — 새 칸이 있으면 그것, 없고 옛 `review_waived_by` 가 있으면 `{rule: "review"}` 한 줄(옛 2차 `requireReview` 면제).
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

/// Run 통합 ref(통합 설계 2-1 · N1) — **시작 op 가 만든다**(`integrate_run.rs`). 없으면(`None` — v1 파일 · 1차 Run) 1차 동작(통합 없음 · 수락 동기).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Integration {
    /// 진실 ref(비브랜치) — `refs/aynx/orch/<run16>/int`(Run id hex 앞 16자 — `integrate::refs`).
    pub work_ref: String,
    /// 사람용 내보내기 브랜치 이름(`orch-<run8>-int`).
    pub export_branch: String,
    /// 시작 때의 기준 커밋.
    pub base_commit: String,
    /// 시작 때 주 작업 폴더가 있던 브랜치(분리 HEAD 면 없다) — 시작 대화 · 보드가 "무엇에서 시작했나" 를 보인다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    /// 서버가 마지막으로 올린 머리 — 서버는 이것만 이어 쓴다(다르면 Run 보류 — 4-5).
    pub expected_head: String,
    /// 마지막으로 내보낸 머리.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_head: Option<String>,
    /// 사람이 [정리]로 통합 ref 를 지웠다(E2E 10-16 #10 —내보낸 브랜치가 그 머리를 품을 때만 허용되는 길). 그 뒤 통합 ref 부재는
    /// **기대한 상태**다 — 재시작 복구 · 내보내기가 거짓 `integration-diverged` 를 걸지 않는다. v2 파일에 없으면 `false`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub work_ref_removed: bool,
}

impl Integration {
    /// 통합 ref 의 지금 머리가 서버가 아는 상태와 맞나 — `expectedHead` 이거나, 사람이 [정리]로 지운 뒤 없을 때.
    pub(crate) fn head_matches(&self, current: Option<&str>) -> bool {
        match current {
            Some(c) => c == self.expected_head,
            None => self.work_ref_removed,
        }
    }
}

/// Run 보류 사유(통합 설계 2-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum HoldReason {
    /// 통합 ref 가 서버가 아는 머리(`expectedHead`)와 다르다(4-5) — 사람의 [조정](3단계) 뒤에만 풀린다.
    IntegrationDiverged,
    /// 통합 의도를 디스크에 저장하지 못했다(4-3 ⑥) — 올리기(CAS)를 하지 않았다.
    PersistFailed,
    /// 서버 임시 폴더에 예상 밖 변경이 남았다(6-2 — 6단계가 건다).
    CleanupPending,
    /// 통합 Job 시작 직전 저장소 신원(경로 · git 공통 폴더 · 실체 식별)이 Run 이 처음 읽은 것과 다르다(헤드리스 설계 2-4 · 2-6 — 같은 경로에
    /// 다시 clone 한 저장소 등). 사람의 [조정]과 같은 줄 — 사람이 보고 푼다.
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

/// Run 보류(통합 설계 2-1 · 4-5) — 서 있는 동안 Run 은 paused 이고 새 Job · 새 Attempt · 조율 쓰기는 `run-on-hold`, [재개]도 막힌다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunHold {
    pub reason: HoldReason,
    pub at: u64,
    /// 짧은 낱말(사유의 세부 — 사람 글이 아니다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// 통합 작업의 단계(통합 설계 2-4). `prepared` … `verifying` 은 취소를 받고, `committing` 은 받지 않으며(같은 잠금에서 직렬화 —
/// `integration-committing`), 뒤 셋은 끝 상태다.
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

    /// 아직 끝나지 않았다 — Run 당 하나(`integration-busy`) · 중단은 이것이 0 이 될 때까지 기다린다(`settle_stopping`).
    pub(crate) fn live(self) -> bool {
        !matches!(self, JobPhase::Integrated | JobPhase::Conflict | JobPhase::Aborted)
    }

    /// 사람 [취소] · Run 중단 · 세대 교체를 받는 단계(커밋 단계 전 — 4-4).
    pub(crate) fn cancellable(self) -> bool {
        matches!(
            self,
            JobPhase::Prepared | JobPhase::Candidate | JobPhase::AwaitingApproval | JobPhase::Verifying
        )
    }
}

/// Job 의 끝 사유(짧은 낱말 — `cancelled` · `persist-failed` · `moved` · `crashed` · `ref-tx` · `stale` · `generation` …).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobOutcome {
    pub reason: String,
    pub at: u64,
}

/// 통합 작업 기록 — **영속 의도**(통합 설계 2-4 · R3). 수락 요청 하나 = Job 하나(같은 `requestId` 는 같은 Job). `committing` 은
/// 이 기록의 **영속 저장 성공이 확인된 뒤에만** ref 트랜잭션(CAS)으로 간다 — 재시작 뒤에는 이 기록과 완료 증거 ref
/// (`refs/aynx/orch/<run16>/done/<job16>`)로 통합 여부를 판정한다(`integrate.rs`). 검증 결과 · 덮어쓰기 칸은 4단계가 더한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationJob {
    pub job_id: String,
    pub task_id: String,
    /// 요청 때의 조정자 세대.
    pub gen: u32,
    /// Task 를 `integrating` 으로 둔 뒤의 버전 — 올리기 직전 재확인.
    pub task_version: u64,
    pub attempt_id: String,
    pub report_id: String,
    /// 수락 대상 보고 커밋.
    pub report_commit: String,
    /// 3-way 의 기준(그 Attempt 의 `base_commit`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_base: Option<String>,
    /// 후보를 계산할 때의 통합 머리(CAS 의 old).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    /// 후보 커밋(CAS 의 new).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_tree: Option<String>,
    pub phase: JobPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<JobOutcome>,
    pub request_id: String,
    /// 수락을 요청한 쪽.
    pub by: Reviewer,
    pub started_at: u64,
    /// `committing` 으로 넘어간 시각.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committing_at: Option<u64>,
    /// 사람 확인을 기다리기 시작한 시각(`awaiting-approval` — 30분이면 `approval-expired`, 4단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting_at: Option<u64>,
    /// 검증 허락(사람 확인 · 자동 — 4단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<VerifyApproval>,
    /// 검증 결과(4단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<VerifyResult>,
    /// 사람 덮어쓰기(4단계 — 실패한 Job 에 묶인 새 Job 에만).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "override")]
    pub override_: Option<VerifyOverride>,
    /// 관문 때 그 보고의 마지막 유효 검토(pass) id(5단계).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// `requireReview` 인데 유효한 pass 없이 사람이 수락을 시작했다(검토 면제 — 수락 산출물에 옮겨 적는다). (3a) 면제가 있으면 함께 세운다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub review_waived: bool,
    /// 사람 수락이 넘은 수락 규칙(3a — 관문 때 판정 · 수락 산출물에 옮겨 적는다).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waived: Vec<Waiver>,
    /// 관문 때 수락 규칙을 채운 판정 id 들.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub judgments: Vec<String>,
}

/// 타임라인 한 줄(메타만 — 본문 없음).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    pub seq: u64,
    pub at: u64,
    pub actor: Actor,
    /// 무엇을 — `run_started` · `task_created` · `task_updated` · `paused` · … (감사의 `event` 와 같은 낱말).
    pub action: String,
    /// 대상 id(Task · Attempt) — 없으면 Run 자신.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// 짧은 결과 낱말(`ok` · 바뀐 상태 · 한도 이름 · 거절 사유).
    pub outcome: String,
    /// 작업자 요청 id(`commit_rejected` — 10-15). 제어 문자 없음 · 128자까지.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// 파일 수(`commit_rejected` — 고른 파일 수, 이름은 없다).
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
    /// 정규화한 입력의 SHA-256(F6 — `store::request_sha`). 같은 id · 다른 입력이면 `request-id-reused`. F6 전의 영속 파일에는 없다(`None` —
    /// 그 기록은 도구만 맞춘다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_sha: Option<String>,
}

/// 앨범 병합 기록(`album_merge.rs`) — 앱이 한 병합 또는 자동 병합이 멈춘 까닭. 터미널에서 직접 한 병합은 여기 적히지 않는다(보기 칸 `mergedOutside`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunMerge {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged: Option<MergedRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped: Option<MergeStop>,
}

/// 앱이 한 병합 하나 — `by` 가 server 면 자동 병합.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergedRecord {
    /// 병합 커밋.
    pub commit: String,
    /// 넣은 내보낸 머리.
    pub head: String,
    pub target: String,
    pub by: Actor,
    pub at: u64,
}

/// 자동 병합이 멈춘 까닭 — 낱말 · 세부(수 · 브랜치 이름 · git 한 줄). 사람 보드에만 나간다(MCP · 알림은 낱말뿐).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeStop {
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: u64,
}

/// Run — 사람이 시작한다(설계 B). 산 상태는 세션 서버 메모리, 사건마다 JSON 한 파일로 영속(C-7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Run {
    /// 사람이 정한 앨범 구성. 단계 사이 맡기기 Run 과 공존하며, Some 이면 맡기기로 돌아가지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<AlbumConfig>,
    pub id: String,
    pub name: String,
    pub state: RunState,
    /// orphaned 로 올리기 전의 상태(재시작 뒤 보기용).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_state: Option<RunState>,
    /// 조정자 세대 — [이어 가기] 마다 1 씩.
    pub gen: u32,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub ended_at: Option<u64>,
    pub limits: Limits,
    /// 옛 파일 호환(2차 시작 대화의 작업자 권한 모드) — 읽고 다시 저장할 때 그대로 둔다. 새 Run 은 쓰지 않는다(3차 6단계 — 권한은 맡기기의
    /// 역할 표). 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_permission: Option<WorkerPermission>,
    /// 옛 파일 호환(10-15 작업자 타일 붙이기 방식) — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attach_mode: Option<AttachMode>,
    /// 옛 파일 호환(통합 설계 6-1 보고 뒤 자동 종료) — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_stop_reported: Option<bool>,
    /// 옛 파일 호환(2차 허용 작업자 CLI) — 위와 같다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_clis: Option<Vec<WorkerCli>>,
    pub repo: String,
    pub worktree_dir: String,
    /// 조율 한도 시각(epoch ms) — 넘으면 paused.
    pub coordination_deadline_at: u64,
    /// 실행 한도 시각(epoch ms) — 넘으면 stopping.
    pub execution_deadline_at: u64,
    /// 왜 멈췄나 — `human` · `coordination-limit`(2단계) · `coordinator-exited`(3단계).
    #[serde(default)]
    pub pause_reason: Option<String>,
    /// Run 사건마다 단조 증가.
    pub seq: u64,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub attempts: Vec<Attempt>,
    #[serde(default)]
    pub reports: Vec<Report>,
    #[serde(default)]
    pub accepted: Vec<AcceptedArtifact>,
    /// 검토 판정 기록(수락 · 반려 · 뒤집기 — 새 줄만 더한다).
    #[serde(default)]
    pub reviews: Vec<ReviewRecord>,
    /// 옛 파일 호환(2차 붙여넣기 전달 기록 — 상태 · 길이 · 해시만). 3a 부터 새 기록은 없다(이어지는 지시는 resume 턴 — `turns`). 읽고 다시
    /// 저장할 때 그대로 두며(빈 목록도 — 옛 파일의 글자 그대로) 턴 한도 셈에만 더한다([`Run::legacy_deliveries`]). 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliveries: Option<Vec<DeliveryRecord>>,
    /// 서버가 집행한 작업자 커밋(`commit_changes` — 10-15). 메시지 첫 줄 · 파일 수만.
    #[serde(default)]
    pub commits: Vec<WorkerCommit>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
    /// 최근 `requestId` 결과(멱등 — 최대 [`IDEMPOTENCY_KEEP`]).
    #[serde(default)]
    pub requests: VecDeque<IdemEntry>,
    /// 통합 ref(통합 설계 2-1 — 3단계 시작 op 가 채운다). `None` = 1차 동작(v1 파일도 이것으로 읽힌다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration: Option<Integration>,
    /// 보류(통합 설계 2-1 · 4-5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<RunHold>,
    /// 통합 작업 기록(영속 의도 — 끝난 것도 남는다).
    #[serde(default)]
    pub jobs: Vec<IntegrationJob>,
    /// 수락 전 검증(통합 설계 5절 — **사람이 시작 대화에서만**). `None` = 검증 없음(조정자가 보고만 보고 수락).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify: Option<VerifyConfig>,
    /// 옛 파일 호환(2차 수락 전 검토 필수 — 통합 설계 D6). 옛 Run 의 사람 면제 기록에만 뜻이 있다([`Run::legacy_require_review`] —
    /// `roles.rs` · `verify.rs`). 새 Run 은 쓰지 않는다(3차 — 수락 규칙은 맡기기 `[repo.accept]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_review: Option<bool>,
    /// 옛 파일 호환(2차 검토자 CLI — 시작 대화). 새 Run 은 쓰지 않는다(판정형 역할은 맡기기). 보기 · MCP 에는 싣지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer_clis: Option<Vec<WorkerCli>>,
    /// 검토 보고(통합 설계 2-5 — 새 줄만 더한다).
    #[serde(default)]
    pub review_reports: Vec<ReviewReport>,
    /// **예상 밖 변경으로 지우지 않고 남긴 서버 임시 자리**(통합 설계 6-2 — `cleanup.rs`). 사람이 [그래도 지우기] 하거나 다음 정리(재시작 ·
    /// [정리])에서 쉬는 상태로 돌아왔으면 빠진다. 경로는 사람 보기에만(감사 · 알림에는 수만).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temp_pending: Vec<TempPending>,
    /// 맡기기 신원 사본(헤드리스 설계 2-4 · 2-6 — 이 Run 이 처음 맡기기를 읽은 때: 시작 · 첫 작업자). 없으면(맡기지 않은 저장소에서 연
    /// Run · 옛 파일) 아직 읽지 않았다 — 작업자는 맡긴 저장소에서만 뜬다(E5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<RunDelegation>,
    /// 누가 열었나(헤드리스 설계 3-2 — 판 3). 칸이 없는 옛 파일은 사람이 연 Run(`human_origin`).
    #[serde(default = "human_origin")]
    pub origin: RunOrigin,
    /// **보드 자동 배치 장부**(Q3 — 5단계): 보드 자동 배치를 한 번 시도할 세대(`start_run` = 1 · `adopt_run` = 새 세대). 사람이 연 Run(옛 파일 ·
    /// 시험 길 — 사람의 시작 대화는 3차 6단계에 걷었다)은 `None`.
    /// 재전송 · 여러 창 · F5 에도 다시 시도하지 않는다. 안 열린 · 사람이 닫은 보드는 다시 열지 않는다(조정자 타일의 Run 칩 · Run 목록으로 연다).
    /// **귀속**(2단계 단계 2 — 설계 2-3 · R5): 이 Run 을 연 · 이어받은 프로듀서 채팅 id(순서대로 · ≤ [`PRODUCERS_MAX`]). 오케스트레이션 장부가
    /// 귀속의 권위 있는 자리다 — 프로세스 재시작 · 재부착 · 모델 변경 · 서버 재시작으로 지우지 않는다(채팅 하나 = 앨범 하나). 권한이 아니다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub producers: Vec<String>,
    /// **앱이 깨움의 예약 기록**(2단계 단계 4 — 설계 3-4 · 3-6): 예약한 깨움마다 한 줄(재시도 포함 · ≤ [`super::wake::RUN_MAX`] — 앨범당 누적
    /// 상한이 곧 이 길이다 · 초기화 없음). 문장은 싣지 않고 **SHA-256** 만(화면의 기록 출처 대조 — 표시용일 뿐 권한 · 커서 · 셈의 근거가 아니다).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wakes: Vec<WakeRecord>,
    /// 깨움으로 처리된 끝(seq) — 깨움 후보는 이 값과 그 자리의 확정 커서 중 큰 것 **뒤**의 장부 줄이다(Run 에 귀속 — adopt · 프로세스 재시작 무관).
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub wake_handled_to: u64,
    /// 사람이 보관한 시각(앨범 보관함 — `store/archive.rs`). `archived/` 의 파일에만 있고 복원하면 지운다. 옛 파일(칸 없음)은 `updatedAt` 으로 본다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
    /// 앨범 병합 기록(`album_merge.rs`). 옛 파일에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge: Option<RunMerge>,
}

fn is_zero_u64(v: &u64) -> bool {
    *v == 0
}

/// 깨움 하나의 예약 기록(설계 3-6 — 본문 없음).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WakeRecord {
    pub wake_id: String,
    /// 깨운 프로듀서 채팅 id(`pc-…` — 비밀 아님).
    pub chat: String,
    /// `wake_text` 가 지은 문장의 SHA-256(hex).
    pub sha: String,
    pub from_seq: u64,
    pub to_seq: u64,
    pub at: u64,
    /// 같은 범위의 재시도인가.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retry: bool,
    /// 문장의 재료 — 열거 낱말 · 그 Run 의 id 만(화면이 기록의 "앱이 깨움 · #1 보고" 알약을 짓는다 · 자유 글 없음).
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

/// 깨움 기록의 항목 하나(`orchestration::wake::WakeItem` 의 사본 — 낱말 · id).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WakeRecordItem {
    pub what: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
}

/// Run 하나의 귀속 프로듀서 채팅 수 상한(연 채팅 + 이어받은 채팅).
pub(crate) const PRODUCERS_MAX: usize = 8;

impl Run {
    /// 옛 파일 호환 — 2차 `requireReview`(새 Run 은 늘 거짓).
    pub(crate) fn legacy_require_review(&self) -> bool {
        self.require_review == Some(true)
    }

    /// 옛 파일 호환 — 2차 붙여넣기 전달 기록 수(턴 한도 셈 — 새 Run 은 0).
    pub(crate) fn legacy_deliveries(&self) -> u32 {
        self.deliveries.as_ref().map_or(0, |d| d.len() as u32)
    }

}

/// 남긴 서버 임시 자리 하나(통합 설계 6-2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempPending {
    pub path: String,
    /// `verify` · `review` · `review-cwd` · `temp`.
    pub role: String,
    /// 남긴 까닭 낱말 — `changed`(쉬는 상태와 다름) · `remove-failed` · `unreadable`.
    pub why: String,
    pub at: u64,
}

impl Run {
    pub(crate) fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }

    /// 그 Task 의 **유효한** 수락 기록(마지막 · 거둬지지 않은 것).
    pub(crate) fn valid_artifact(&self, task_id: &str) -> Option<&AcceptedArtifact> {
        self.accepted.iter().rev().find(|a| a.task_id == task_id && a.revoked_at.is_none())
    }

    /// 그 Attempt 의 보고(한 Attempt 에 하나 — 늦은 보고 포함).
    pub(crate) fn report_of(&self, attempt_id: &str) -> Option<&Report> {
        self.reports.iter().find(|r| r.attempt_id == attempt_id)
    }

    /// 턴(프로세스)이 살아 있을 수 있는 Attempt 수 — Run stopping → stopped 판정(`settle_stopping`)이 쓴다. 술어 `turn_may_live`(4-5 표 —
    /// stopped 는 프로세스 트리 종료 확인 뒤에만).
    pub(crate) fn live_attempts(&self) -> usize {
        self.attempts.iter().filter(|a| a.turn_may_live()).count()
    }


    /// 턴이 살아 있을 수 있는 **작업자** 수(동시 작업자 한도 — 검토자는 따로 센다, 통합 설계 3-4). 술어 `turn_may_live`(4-5 — 동시 한도는
    /// 도는 턴만 센다 · 3차 `idle` 은 자리를 차지하지 않는다).
    pub(crate) fn live_workers(&self) -> usize {
        self.attempts.iter().filter(|a| !a.is_reviewer() && a.turn_may_live()).count()
    }

    /// 지금까지 띄운 작업자 수(총 작업자 한도).
    pub(crate) fn worker_count(&self) -> usize {
        self.attempts.iter().filter(|a| !a.is_reviewer()).count()
    }

    /// 지금까지 띄운 검토자 수(총 검토 한도 — `maxReviews`).
    pub(crate) fn review_count(&self) -> usize {
        self.attempts.iter().filter(|a| a.is_reviewer()).count()
    }

    /// 지금까지의 이어지는 턴 수(3a — `send_prompt` 의 resume 턴 · 턴 한도 `max_deliveries`). 턴 기록은 Attempt 마다 최근 [`TURNS_KEPT`] 개라
    /// 그보다 오래된 턴은 턴 번호로 센다(첫 턴 = 1).
    pub(crate) fn resume_turns(&self) -> u32 {
        self.attempts
            .iter()
            .filter(|a| a.kind == Some(AttemptKind::Write))
            .map(|a| a.turn_no().saturating_sub(1))
            .sum()
    }

    /// 끝나지 않은 통합 작업(Run 당 하나까지).
    pub(crate) fn live_job(&self) -> Option<&IntegrationJob> {
        self.jobs.iter().find(|j| j.phase.live())
    }

    /// 끝나지 않은 통합 작업 수.
    pub(crate) fn live_jobs(&self) -> usize {
        self.jobs.iter().filter(|j| j.phase.live()).count()
    }

    /// 사건 한 줄 — seq 를 올리고 타임라인에 적는다(메모리만 — 영속 · 알림은 `store.rs` 의 `after_change`).
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

    /// 멱등 기록 한 줄(가장 오래된 것부터 버린다).
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

/// `run-`/`task-`/`att-`/`req-` + 16바이트 hex — 작업안 id(`operations::model::new_operation_id`)와 같은 틀.
/// OS 엔트로피가 없으면 `None`(예측 가능한 id 를 만들지 않는다).
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

/// 그 틀의 id 인가(`run-` + 32 hex 등) — 파일 이름 · 인자 검사.
pub(crate) fn is_id(prefix: &str, s: &str) -> bool {
    s.strip_prefix(prefix)
        .and_then(|r| r.strip_prefix('-'))
        .is_some_and(|hex| hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}
