/** 서버 JSON 모양(camelCase) — 타입만. 토큰 칸은 두지 않는다. */

export type RunState = "running" | "paused" | "stopping" | "stopped" | "done" | "orphaned";
export type TaskState = "todo" | "active" | "reported" | "accepted" | "rejected" | "cancelled" | "integrating" | "conflict";
export type WorkerCli = "claude" | "codex";
export type Actor = "human" | "coordinator" | "worker" | "server" | "reviewer";
/** 역할의 `kind` 사본 — `write` = 작업자 · 해결자, `judge` = 검토자 */
export type AttemptKind = "write" | "judge";

export interface RunLimits {
  maxTasks: number;
  maxCallsPerMinute: number;
  maxWaiters: number;
  coordinationMinutes: number;
  executionGraceMinutes: number;
  maxConcurrentWorkers: number;
  maxTotalWorkers: number;
  maxDeliveries: number;
  maxReviews?: number;
  turnMinutes?: number;
}

export interface ReviewSlotView {
  active?: string | null;
  /** 판정이 서도 마지막 대상으로 남는다 */
  target?: string | null;
}

export type ReviewVerdict = "pass" | "changes-requested";

/** `stale` · `late` 는 기록만(상태에 들지 않는다) */
export interface ReviewReportView {
  reviewId: string;
  attemptId: string;
  taskId: string;
  reportId: string;
  commitOid: string;
  verdict: ReviewVerdict;
  findings: string[];
  summary: string;
  at: number;
  state: "current" | "stale" | "late";
}

export interface ReviewStateView {
  state: "none" | "pending" | ReviewVerdict;
  reportId?: string | null;
  attemptId?: string | null;
  reviewId?: string;
  verdict?: ReviewVerdict;
  summary?: string;
  findings?: string[];
  at?: number;
}

export interface TaskView {
  id: string;
  title: string;
  goal: string;
  scope?: string;
  doneWhen?: string;
  dependsOn: string[];
  version: number;
  state: TaskState;
  currentAttempt?: string | null;
  createdAt: number;
  updatedAt: number;
  /** `state === "conflict"` 일 때 본다 */
  conflict?: ConflictInfoView | null;
  review?: ReviewSlotView;
  roleHistory?: RoleHistoryView[];
  rework?: { used: number; max: number | null };
  acceptReadiness?: AcceptReadinessView;
  /** 사람이 면제한 수락 규칙 */
  waived?: WaiverView[];
}

/** `outcome` 은 판정(pass · changes-requested) · 보고 결과 · `blocked` · Attempt 상태 중 하나 */
export interface RoleHistoryView {
  attemptId: string;
  role?: string | null;
  roleName?: string | null;
  kind: AttemptKind | string;
  outcome: string;
}

export interface UnmetRuleView {
  rule: string;
  role: string;
  roleName?: string | null;
  need: number;
  have: number;
  /** `none` · `pass` · `changes-requested` */
  last: string;
}

export interface AcceptReadinessView {
  ok: boolean;
  unmet: UnmetRuleView[];
  delegation?: string;
}

/** `rule` 은 `judgment`(필수 판정) · `review`(옛 Run 의 필수 검토) */
export interface WaiverView {
  rule: string;
  role?: string | null;
  roleName?: string | null;
  need: number;
  have: number;
}

/** 지침 본문은 오지 않는다 — 길이만 */
export interface RunRoleView {
  id: string;
  name: string;
  kind: AttemptKind | null;
  description?: string;
  cli: WorkerCli | null;
  model?: string;
  effort?: string;
  permission?: string | null;
  instructionsLen?: number;
  usable: boolean;
  unusableReason?: string | null;
}

export interface RunAcceptRulesView {
  require: { role: string; roleName?: string | null; passes: number }[];
  maxRework: number;
}

/** 1 = base · 2 = 통합 머리 · 3 = 보고 커밋 */
export interface ConflictStageView {
  stage: number;
  mode: string;
  blob: string;
  path: string;
}

/** `kinds` = `contents` · `binary` · `rename/delete` … */
export interface ConflictEntryView {
  paths: string[];
  kinds: string[];
  stages: ConflictStageView[];
}

export interface ConflictInfoView {
  jobId: string;
  old: string;
  reportCommit: string;
  mergeBase: string;
  conflictCommit?: string | null;
  entries: ConflictEntryView[];
  more: number;
  /** 일반 텍스트 내용 충돌 밖 — 사람이 합쳐야 한다 */
  needsHuman: boolean;
  at: number;
}

export interface IntegrationView {
  workRef: string;
  exportBranch: string;
  baseCommit: string;
  baseBranch?: string | null;
  /** 통합 머리 */
  expectedHead: string;
  exportedHead?: string | null;
}

export interface RunMergeView {
  merged?: { commit: string; head: string; target: string; by: Actor; at: number } | null;
  stopped?: { reason: string; detail?: string | null; at: number } | null;
}

/**
 * 새 Attempt 는 spawning · running · idle · reported · stopping · stopped · stop-unconfirmed · exited 여덟만 쓰고,
 * starting · ready · working · awaiting-human · needs-recovery · exit-unconfirmed 는 옛 파일(PTY 작업자)에서만 읽힌다.
 */
export type AttemptState =
  | "spawning"
  | "starting"
  | "ready"
  | "working"
  | "awaiting-human"
  | "needs-recovery"
  | "running"
  /** 턴이 끝났고 열려 있다 — 같은 대화로 이어 시킬 수 있다(blocked 표지가 있을 수 있다) */
  | "idle"
  | "reported"
  | "exited"
  | "stopping"
  | "stopped"
  | "stop-unconfirmed"
  /** 스스로 끝났는데 자식 트리 종료를 아직 확인하지 못했다 — 살아 있을 수 있는 것으로 센다 */
  | "exit-unconfirmed";

export interface AttemptView {
  id: string;
  taskId: string;
  cli: WorkerCli;
  gen: number;
  state: AttemptState;
  stream?: string | null;
  worktree?: string | null;
  branch?: string | null;
  baseCommit?: string | null;
  pid?: number | null;
  conversationId?: string | null;
  /** 옛 PTY 작업자만 — 헤드리스는 턴마다 `turns[].args` */
  launchArgs?: string | null;
  /** `stop-unconfirmed` · `exit-unconfirmed`(옛 파일의 모르는 낱말은 보이지 않는다) */
  attention?: string | null;
  startedAt: number;
  endedAt?: number | null;
  exitReason?: string | null;
  /** 고정 대화가 아닌 대화 id 의 신호가 왔다(resume · fork · `/clear`) — 고정은 그대로 */
  conversationChanged?: boolean;
  /** 마지막 `commit_changes` 거절 — 커밋이 서면 걷힌다. 경로 · 메시지 본문은 없다 */
  lastCommitRejection?: CommitRejectionView | null;
  /** 충돌 해결 Attempt 면 그 충돌의 Job id */
  resolves?: string | null;
  /** 없으면 작업자 */
  role?: "worker" | "reviewer";
  reviewOf?: { reportId: string; commitOid: string; baseCommit?: string | null; place?: string | null; cwd?: string | null } | null;
  /** 헤드리스 턴 기록 — 낱말 · 수만(프롬프트 · 본문 없음) */
  turns?: TurnView[];
  /** 있으면 헤드리스 Attempt */
  kind?: AttemptKind | null;
  /** 이름은 띄울 때의 사본 — 역할을 지워도 남는다 */
  roleId?: string | null;
  roleName?: string | null;
  /** 비종결 — 턴이 끝나면 `idle` + 이것. 새 턴이 서면 걷힌다 */
  blocked?: { need: string; at: number } | null;
  /** resume 턴의 init 이 고정 id 와 다르다 — 더는 resume 하지 않는다 */
  conversationBroken?: boolean;
  stopRequested?: boolean;
}

/** 권한 표시 전용 요약 — 프롬프트 · 지침 본문 · 토큰 · 경로 · 대화 id 없음 */
export interface TurnArgsView {
  cli: string;
  /** `edit` · `full` · `read-only` */
  grade: string;
  /** `restricted` · `setting-sources-empty` · `ignore-user-config` */
  settingsControl: string;
  allowedRules?: string[];
  sandbox?: string | null;
  model?: string | null;
  effort?: string | null;
  instructionsSha?: string | null;
  resume?: boolean;
  turnMinutes?: number | null;
}

export interface TurnView {
  n: number;
  startedAt: number;
  endedAt?: number | null;
  /** `running` · `ok` · `failed` · `timeout` · `stopped` · `stop-unconfirmed` */
  outcome: string;
  /** 실패 낱말(`no-result` · `conversation-mismatch` …) */
  reason?: string | null;
  exitCode?: number | null;
  denials?: number;
  /** Codex stderr — `outside-write` · `policy` · `other` */
  denialKinds?: string[];
  tools?: number;
  lastTool?: string | null;
  cliVersion?: string | null;
  /** Claude init 에서만 — Codex 는 없다 */
  model?: string | null;
  args?: TurnArgsView | null;
}

/** 사유 낱말 · 요청 id · 파일 수만 */
export interface CommitRejectionView {
  reason: string;
  requestId?: string | null;
  files?: number | null;
  /** 사람이 손써야 풀리는 사유(`filters-configured` · `no-git-identity` · `worktree-mismatch` · `commit-failed`) */
  needsHuman: boolean;
  seq: number;
  at: number;
}

/** 서버 재시작 전의 작업자가 남긴 것 */
export interface LeftoverView {
  attemptId: string;
  state: AttemptState;
  cli: WorkerCli;
  pid?: number | null;
  processAlive: boolean;
  worktree?: string | null;
  worktreeExists: boolean;
  halfMade: boolean;
}

export type ReportOutcome = "success" | "failure" | "blocked";
export type Reviewer = "coordinator" | "human";

/** git 칸은 서버가 그 worktree 에서 읽은 것 */
export interface ReportView {
  reportId: string;
  attemptId: string;
  taskId: string;
  outcome: ReportOutcome;
  summary: string;
  notes?: string | null;
  commitOid?: string | null;
  baseCommitOid?: string | null;
  dirty: boolean;
  changedFiles: string[];
  changedFilesTruncated?: boolean;
  gitError?: string | null;
  /** HEAD 가 기준 그대로 + 미커밋 변경 없음 */
  noChanges?: boolean;
  /** `branch-changed` · `unexpected-head` — 있으면 수락할 수 없다 */
  mismatch?: string | null;
  at: number;
  late: boolean;
  /** 해결 Attempt 의 성공 보고 — 충돌 경로마다 푼 방법 */
  resolved?: { path: string; how: string }[];
}

/** 메시지 첫 줄 · 파일 수만 */
export interface WorkerCommitView {
  attemptId: string;
  commitOid: string;
  parentOid: string;
  branch: string;
  subject: string;
  files: number;
  at: number;
}

/** 불변 — 뒤집기는 `revokedAt` 만 채운다 */
export interface AcceptedView {
  taskId: string;
  attemptId: string;
  reportId: string;
  commitOid: string;
  baseCommitOid?: string | null;
  reviewer: Reviewer;
  /** 명령 글자 없음. 덮어쓰기면 `overridden` 이고 결과는 실패 그대로 */
  verification: { verifyId: string; jobId: string; outcome: VerifyOutcome; exitCode?: number | null; commandSha: string; hermetic: boolean; overridden: boolean } | null;
  acceptedAt: number;
  revokedAt?: number | null;
  revokedBy?: Reviewer | null;
  /** 있으면 뒤집기는 `already-integrated` */
  integrationCommit?: string | null;
  integrationParent?: string | null;
  jobId?: string | null;
  preserveRef?: string | null;
  reviewId?: string | null;
  /** 옛 Run 의 필수 검토 면제 기록 */
  reviewWaivedBy?: Reviewer | null;
  waived?: WaiverView[];
  waivedBy?: Reviewer | null;
  judgments?: string[];
}

export interface ReviewView {
  taskId: string;
  attemptId?: string | null;
  reportId?: string | null;
  decision: "accepted" | "rejected";
  reviewer: Reviewer;
  flipped: boolean;
  at: number;
}

export interface DriftView {
  attemptId: string;
  reportId: string;
  head?: string | null;
  dirty?: boolean;
  changedSinceReport: boolean;
  error?: string;
}

/** 경로 · 본문 없음 */
export interface TranscriptWatchView {
  /** `ok` · `pending` · `no-conversation` · `cwd-mismatch` · `outside-cli-dir` · `unreadable` */
  status: string;
  lastGrowthAt?: number | null;
  /** 60초 기록 증가 없음(표시만) */
  lagging: boolean;
}

export interface WorkerActivity {
  status: string;
  recent?: {
    lastText?: string | null;
    tools: { name: string; summary: string; pending: boolean }[];
    lastAt?: number | null;
  } | null;
  changedCount?: number;
  changedTruncated?: boolean;
  dirty?: boolean;
  conversationChanged?: boolean;
  lagging?: boolean;
  lastGrowthAt?: number | null;
  /** op 인자 `detail` 을 준 칸에만 */
  wip?: WipFilesView;
}

/** 기준 커밋 … 지금 작업 트리 */
export interface WipFileView {
  path: string;
  status: ReportFileView["status"];
  adds: number | null;
  dels: number | null;
  binary: boolean;
  /** 추적 안 된 새 파일 포함 */
  uncommitted: boolean;
  /** 크면 `adds` 없음 */
  untracked?: boolean;
}

export interface WipFilesView {
  files: WipFileView[];
  fileCount: number;
  truncated: boolean;
  base?: string | null;
  error?: string;
}

/** 메타만(본문 없음) */
export interface LogEntry {
  seq: number;
  at: number;
  actor: Actor;
  action: string;
  target?: string;
  outcome: string;
  /** `commit_rejected` 에만 — 파일 이름은 없다 */
  requestId?: string | null;
  files?: number | null;
}

export interface RunRemaining {
  tasks: number;
  callsThisMinute: number;
  concurrentWorkers: number;
  totalWorkers: number;
  /** 옛 서버는 `deliveries` */
  turns?: number;
  deliveries?: number;
  reviews?: number;
  coordinationSeconds: number;
  executionSeconds: number;
}

export interface RunDetail {
  worktreesLeft?: number;
  /** 지침 · 프로듀서 토큰은 포함하지 않는다 */
  album?: {
    rev: number; members: { artist: string; name: string; grade: "read" | "edit" | "full"; allowedCommands: string[]; joinedRev: number }[];
    accept: { require: { role: string; passes: number }[]; maxRework: number };
    verifyAuto: boolean; planTools: boolean; wakeMax: number; changedAt: number; riskConfirmedAt: number | null;
    autoMerge?: boolean;
  } | null;
  runId: string;
  name: string;
  state: RunState;
  previousState?: RunState | null;
  orphaned?: boolean;
  gen: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number | null;
  pauseReason?: string | null;
  /** 없으면 [재개] 는 `no-coordinator` */
  coordinatorAttached: boolean;
  repo: string;
  roles?: RunRoleView[];
  acceptRules?: RunAcceptRulesView | null;
  worktreeDir: string;
  limits: RunLimits;
  coordinationDeadlineAt: number;
  executionDeadlineAt: number;
  tasks: TaskView[];
  attempts?: AttemptView[];
  reports?: ReportView[];
  /** 불변 — 뒤집힌 것도 남는다 */
  accepted?: AcceptedView[];
  reviews?: ReviewView[];
  commits?: WorkerCommitView[];
  /** attemptId → 상태(경로 · 본문 없음) */
  transcripts?: Record<string, TranscriptWatchView>;
  hold?: RunHoldView | null;
  persist?: RunPersistView | null;
  /** 채팅 기록의 "앱이 깨움" 표지가 출처를 맞춘다(표시용) */
  wakes?: WakeRecordView[];
  integration?: IntegrationView | null;
  merge?: RunMergeView | null;
  mergedOutside?: boolean;
  jobs?: IntegrationJobView[];
  completable?: CompletableView;
  /** 사람이 정한 것만 — 없으면 검증 없음 */
  verify?: VerifyConfigView | null;
  /** 출력 꼬리는 끝 8 KiB(서버 메모리) */
  lastVerify?: Record<string, LastVerifyView>;
  verifyRunning?: string[];
  /** 옛 Run 의 면제 기록에만 — 지금은 `acceptRules` */
  requireReview?: boolean;
  /** stale · late 포함 */
  reviewReports?: ReviewReportView[];
  reviewState?: Record<string, ReviewStateView>;
  remaining: RunRemaining;
  latestSeq: number;
  log?: LogEntry[];
  leftovers?: LeftoverView[];
  tempPending?: TempPendingView[];
  cleanable?: boolean;
  coordinatorChat: string | null;
  origin: RunOrigin;
}

// ── 정리 ──

/** 남긴 서버 임시 자리(검증 · 검토 worktree · 검토자 빈 cwd · 검증 임시) */
export interface TempPendingView {
  path: string;
  role: "verify" | "review" | "review-cwd" | "temp" | string;
  /** `changed`(쉬는 상태와 다름) · `in-use` · `remove-failed` · `not-a-worktree` · `unreadable` */
  why: string;
  at: number;
}

export interface CleanupWorktreeRow {
  path: string;
  attemptId: string;
  taskId: string;
  taskTitle: string;
  taskState: TaskState;
  branch?: string | null;
  exists: boolean;
  inUse: boolean;
  dirty?: boolean | null;
  integrated: boolean;
  eligible: boolean;
  /** `missing` · `in-use` · `dirty` · `unreadable` · `task-open` */
  blocker?: string | null;
  defaultChecked: boolean;
}

/** `name` 은 `refs/aynx/orch/<run16>/…` — Run id hex 앞 16자 */
export interface CleanupRefRow {
  name: string;
  /** `int` · `done` · `accepted` · `candidate` · `conflict` · `diverged` */
  kind: string;
  oid: string;
  eligible: boolean;
  /** `not-exported` · `export-behind`(통합 ref 는 내보낸 브랜치가 품을 때만) */
  blocker?: string | null;
  defaultChecked: boolean;
}

export interface CleanupPreview {
  runId: string;
  state: RunState;
  worktrees: CleanupWorktreeRow[];
  refs: CleanupRefRow[];
  tempPending: TempPendingView[];
  exportBranch?: string | null;
}

export interface CleanupResult {
  runId: string;
  /** `branchKept` — 브랜치 지우기를 원했는데 남긴 까닭(`unmerged` · `checked-out` · `preserve-ref-removed` · `delete-failed`). 실패가 아니다 */
  worktrees: { path: string; removed: boolean; branchDeleted?: boolean; branchKept?: string | null }[];
  refs: string[];
  failed: { path?: string; ref?: string; reason: string }[];
  temps: { removed: number; kept: number; busy: number };
}

export type HoldReason = "integration-diverged" | "persist-failed" | "cleanup-pending" | "repo-identity-changed";

/**
 * 실패 낱말은 분류만(경로 · OS 문장 없음). 실패 중이면 세션 서버가 지금 끝날 때 최근 변경을 잃을 수 있다.
 */
export interface RunPersistView {
  ok: boolean;
  lastSavedSeq: number | null;
  failing?: { since: number; reason: string; count: number } | null;
}

/** Run 보류 — 서 있는 동안 Run 은 멈춰 있고 새 조율 · 새 작업자 · [재개]가 막힌다 */
export interface RunHoldView {
  reason: HoldReason;
  at: number;
  detail?: string | null;
}

export type JobPhase =
  | "prepared"
  | "candidate"
  | "awaiting-approval"
  | "verifying"
  | "committing"
  | "integrated"
  | "conflict"
  | "aborted";

export interface IntegrationJobView {
  jobId: string;
  taskId: string;
  phase: JobPhase;
  candidate?: string | null;
  /** 후보를 계산할 때의 통합 머리 — 사람 확인이 여기에 묶인다 */
  old?: string | null;
  reportId?: string;
  outcome?: { reason: string; at: number } | null;
  startedAt: number;
  /** 30분이면 만료 */
  awaitingAt?: number | null;
  approval?: { by: "human" | "auto"; candidate: string; commandSha: string; old: string; at: number } | null;
  verify?: VerifyResultView | null;
  override?: { failedJobId: string; verifyId: string; candidate: string; old: string; at: number } | null;
  reviewId?: string | null;
  reviewWaived?: boolean;
}

export type VerifyOutcome =
  | "pass"
  | "fail"
  | "timeout"
  | "cancelled"
  | "modified-tracked"
  | "spawn-failed"
  | "symlink-outside"
  | "stop-unconfirmed";

export interface VerifyConfigView {
  command: string;
  commandSha: string;
  timeoutMinutes: number;
  autoRun: boolean;
  keepDirs?: string[];
  cacheKeyFiles?: string[];
  extraEnvNames?: string[];
}

/** 꼬리 본문 없음 */
export interface VerifyResultView {
  verifyId: string;
  jobId: string;
  candidate: string;
  commandSha: string;
  envPolicy: string;
  hermetic: boolean;
  exitCode?: number | null;
  outcome: VerifyOutcome;
  reason?: string | null;
  durationMs: number;
  outBytes: number;
  tailSha256: string;
  approvedBy: "human" | "auto";
  at: number;
}

export interface LastVerifyView {
  jobId: string;
  verifyId: string;
  candidate: string;
  outcome: VerifyOutcome;
  reason?: string | null;
  exitCode?: number | null;
  durationMs: number;
  outBytes: number;
  hermetic: boolean;
  approvedBy: "human" | "auto";
  at: number;
  tail?: string | null;
}

export interface CompletableView {
  ok: boolean;
  blockers: string[];
}

export interface ReconcilePreview {
  runId: string;
  workRef: string;
  expectedHead: string;
  currentHead: string | null;
  integrated: { taskId: string; title: string; jobId?: string | null; integrationCommit: string; contained: boolean | null }[];
}

/** 조정자 `get_diff` 와 같은 목록 */
export interface ReportFileView {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "unmerged" | "unknown";
  adds: number | null;
  dels: number | null;
  binary: boolean;
}

export interface ReportFilesView {
  taskId: string;
  reportId: string;
  attemptId: string;
  base: string;
  commit: string;
  files: ReportFileView[];
  fileCount: number;
  truncated: boolean;
}

export interface RunSummary {
  runId: string;
  name: string;
  state: RunState;
  worktreesLeft?: number;
  exportedBranch?: string | null;
  previousState?: RunState | null;
  orphaned: boolean;
  gen: number;
  createdAt: number;
  updatedAt: number;
  pauseReason?: string | null;
  coordinatorAttached: boolean;
  repo: string;
  latestSeq: number;
  taskCount: number;
  taskStates: Partial<Record<TaskState, number>>;
  attemptCount: number;
  blocked?: number;
  origin: RunOrigin;
  persist?: RunPersistView | null;
  /** 턴이 살아 있을 수 있는 Attempt 수 — 종류별(쓰기형 · 판정형) */
  running: { write: number; judge: number };
  hold: RunHoldView | null;
  /** 서버 `adopt_verdict` — 목록과 `adopt_run` 이 같은 함수 */
  adoptable: RunAdoptable;
  /** 세대 · 토큰 없음 */
  coordinatorChat: string | null;
  /** 연 채팅 + 이어받은 채팅 */
  producers: string[];
  wake: RunWakeView | null;
}

export interface RunWakeView {
  /** `run-max` · `off`(스튜디오 상한 0) · `segment-max` · `unresponsive` · `failed` — 켜져 있으면 `null` */
  off: string | null;
  segment: number;
  cap: number;
  total: number;
  max: number;
  live: string | null;
}

/** 문장 없음 — SHA 만 */
export interface WakeRecordView {
  wakeId: string;
  chat: string;
  sha: string;
  fromSeq: number;
  toSeq: number;
  at: number;
  retry?: boolean;
  items?: { what: string; taskId?: string | null; attemptId?: string | null }[];
  more?: number;
  resync?: boolean;
}

/** `autoResume` = 되찾으면 곧바로 재생(아니면 멈춤 그대로 — 사람이 [재개]) */
export interface RunAdoptable {
  restore: boolean;
  autoResume: boolean;
  why?: string | null;
}

export interface RunOrigin {
  by: "human" | "ai" | string;
  producer?: string | null;
}


/** 토큰 · 본문 없음 */
export interface RunChanged {
  runId: string;
  seq: number;
  closed?: boolean;
  /** 보관 · 복원 · 영구 삭제 — 보관함 목록을 다시 읽는다 */
  archive?: boolean;
}

export interface ArchivedAlbum {
  runId: string;
  name: string;
  repo: string;
  state: RunState;
  previousState?: RunState | null;
  taskCount: number;
  createdAt: number;
  archivedAt: number;
  exportedBranch: string | null;
  /** 통합 머리가 시작 커밋과 다르고 내보낸 브랜치가 품지 않는다 */
  unexported: boolean;
  /** orphaned 는 서버가 내보내지 않는다 · 저장소가 없으면 낼 곳이 없다 */
  exportable: boolean;
}

/**
 * 토큰 · 본문 없음. seq 를 올리지 않는 사건이다 — `wait_run` 을 깨우지 않는다(서버가 Attempt 마다 2초에 한 번까지로 줄인다).
 */
export interface RunProgress {
  runId: string;
  attemptId: string;
  turn: number;
}

export type ExecModeFields = Partial<Pick<AttemptView, "kind" | "turns" | "role" | "stream">>;

/** 토큰 · 본문 없음 */
export interface OrchNotice {
  id: string;
  runId: string;
  runName: string;
  kind: string;
  attemptId?: string | null;
  taskTitle?: string | null;
  detail?: string | null;
  at: number;
}
