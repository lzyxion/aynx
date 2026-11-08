/**
 * 서버 JSON 모양(camelCase) — Run · Task · Attempt · 턴 · 보고 · 수락 · 통합 · 검증 · 정리 · 목록 · 이벤트 몸. 타입만(값 없음 · 토큰 칸 없음).
 */

export type RunState = "running" | "paused" | "stopping" | "stopped" | "done" | "orphaned";
export type TaskState = "todo" | "active" | "reported" | "accepted" | "rejected" | "cancelled" | "integrating" | "conflict";
export type WorkerCli = "claude" | "codex";
export type Actor = "human" | "coordinator" | "worker" | "server" | "reviewer";
/** Attempt 의 바탕 종류(3a — 역할의 `kind` 사본): 쓰기형 = 작업자 · 해결자, 판정형 = 검토자 */
export type AttemptKind = "write" | "judge";
/** 맡기기 상태 낱말(서버 `roles::status_word` — Run 보기의 `delegation`) */

/** 서버 `Limits`(camelCase) */
export interface RunLimits {
  maxTasks: number;
  maxCallsPerMinute: number;
  maxWaiters: number;
  coordinationMinutes: number;
  executionGraceMinutes: number;
  maxConcurrentWorkers: number;
  maxTotalWorkers: number;
  maxDeliveries: number;
  /** 검토 총 수(통합 설계 3-4 — 작업자 한도와 따로 · 옛 서버면 없다) */
  maxReviews?: number;
  /** 턴 실행 시한(분 — 3차 맡기기 `turn_minutes` · 옛 서버면 없다) */
  turnMinutes?: number;
}

/** 검토 자리(통합 설계 3-3 — 작업자 수명과 따로) */
export interface ReviewSlotView {
  /** 지금 도는 검토 Attempt */
  active?: string | null;
  /** 그 대상 보고(판정이 서도 마지막 대상으로 남는다) */
  target?: string | null;
}

/** 검토 판정 */
export type ReviewVerdict = "pass" | "changes-requested";

/** 검토 보고 한 줄(서버 `ReviewReport`) — `stale` · `late` 는 기록만(상태에 들지 않는다) */
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

/** Task 의 현재 보고에 대한 검토 상태(서버 `reviewState` — 현재 보고의 마지막 유효 판정) */
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
  /** 마지막 통합 후보의 충돌 구조(통합 설계 4-6 — `state === "conflict"` 일 때 본다) */
  conflict?: ConflictInfoView | null;
  /** 검토 자리(통합 설계 5단계 — 옛 서버면 없다) */
  review?: ReviewSlotView;
  /** (3a) 그 Task 에 띄운 Attempt 마다 역할 · 결과 — 보드의 "거친 역할" */
  roleHistory?: RoleHistoryView[];
  /** (3a) 되돌림 `used/max` — 맡기기가 없으면 `max` 는 `null` */
  rework?: { used: number; max: number | null };
  /** (3a) 지금 수락하면 규칙에 걸리는지 — Task 가 보고됨일 때만 */
  acceptReadiness?: AcceptReadinessView;
  /** (3a) 유효한 수락이 넘은 규칙(사람 면제) */
  waived?: WaiverView[];
}

/** 서버 `roles::role_history` 한 줄 — `outcome` 은 판정(pass · changes-requested) · 보고 결과 · `blocked` · Attempt 상태 중 하나 */
export interface RoleHistoryView {
  attemptId: string;
  role?: string | null;
  roleName?: string | null;
  kind: AttemptKind | string;
  outcome: string;
}

/** 못 채운 수락 규칙 하나(서버 `roles::Unmet`) */
export interface UnmetRuleView {
  rule: string;
  role: string;
  roleName?: string | null;
  need: number;
  have: number;
  /** 그 역할의 마지막 유효 판정 — `none` · `pass` · `changes-requested` */
  last: string;
}

/** `tasks[].acceptReadiness` — 맡기기가 적용되지 않으면 `{ok: false, unmet: [], delegation: "not-active"}` */
export interface AcceptReadinessView {
  ok: boolean;
  unmet: UnmetRuleView[];
  delegation?: string;
}

/** 수락 규칙 면제 한 줄(서버 `Waiver`) — `rule` 은 `judgment`(필수 판정) · `review`(옛 `requireReview`) */
export interface WaiverView {
  rule: string;
  role?: string | null;
  roleName?: string | null;
  need: number;
  have: number;
}

/** 지금 맡기기의 역할 하나(서버 `roles::roles_view` — 지침은 길이만) */
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

/** 지금 맡기기의 수락 규칙(서버 `roles::accept_rules_view`) */
export interface RunAcceptRulesView {
  require: { role: string; roleName?: string | null; passes: number }[];
  maxRework: number;
}

/** 충돌 항목의 stage 하나(1 = base · 2 = 통합 머리 · 3 = 보고 커밋) */
export interface ConflictStageView {
  stage: number;
  mode: string;
  blob: string;
  path: string;
}

/** 충돌 항목 — 같은 경로 묶음의 종류 낱말들(`contents` · `binary` · `rename/delete` …) */
export interface ConflictEntryView {
  paths: string[];
  kinds: string[];
  stages: ConflictStageView[];
}

/** 통합 후보의 충돌 구조(서버 `ConflictInfo`) */
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

/** Run 통합 ref(통합 설계 2-1 — 서버 `Integration`. 옛 Run 이면 없다) */
export interface IntegrationView {
  workRef: string;
  exportBranch: string;
  baseCommit: string;
  baseBranch?: string | null;
  /** 통합 머리(서버가 마지막으로 올린 것) */
  expectedHead: string;
  exportedHead?: string | null;
}

/** 앨범 병합 기록(서버 `RunMerge`) */
export interface RunMergeView {
  merged?: { commit: string; head: string; target: string; by: Actor; at: number } | null;
  stopped?: { reason: string; detail?: string | null; at: number } | null;
}

/**
 * Attempt 상태(설계 B — 서버 `AttemptState`, kebab-case). 3a 헤드리스 Attempt 는 spawning · running · idle · reported · stopping ·
 * stopped · stop-unconfirmed · exited 여덟이고, starting · ready · working · awaiting-human · needs-recovery · exit-unconfirmed 는 옛
 * 파일(2차 PTY 작업자)에서만 읽힌다.
 */
export type AttemptState =
  | "spawning"
  | "starting"
  | "ready"
  | "working"
  | "awaiting-human"
  | "needs-recovery"
  /** (3a) 턴(= 프로세스 하나)이 돈다 */
  | "running"
  /** (3a) 턴이 끝났고 열려 있다 — 같은 대화로 이어 시킬 수 있다(blocked 표지가 있을 수 있다) */
  | "idle"
  | "reported"
  | "exited"
  | "stopping"
  | "stopped"
  | "stop-unconfirmed"
  /** 스스로 끝났는데 자식 트리 종료를 아직 확인하지 못했다(리뷰 F2 — 살아 있을 수 있는 것으로 센다) */
  | "exit-unconfirmed";

/** 작업자 한 번(서버 `Attempt` — 3단계) */
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
  /** (옛 2차 PTY) 실행 줄에 실제로 쓴 권한 인자 — 3a 는 턴마다 `turns[].args` */
  launchArgs?: string | null;
  /** 사람이 봐야 할 까닭 — `stop-unconfirmed` · `exit-unconfirmed`(옛 파일은 다른 낱말이 있을 수 있다 — 모르면 보이지 않는다) */
  attention?: string | null;
  startedAt: number;
  endedAt?: number | null;
  exitReason?: string | null;
  /** 고정 대화가 아닌 대화 id 의 신호가 왔다(6단계 — resume · fork · `/clear`). 고정은 그대로 · 보드 "대화 바뀜" 경고 */
  conversationChanged?: boolean;
  /** 마지막 `commit_changes` 거절(10-15 — 커밋이 서면 걷힌다). 경로 · 메시지 본문은 없다 */
  lastCommitRejection?: CommitRejectionView | null;
  /** 충돌 해결 Attempt(통합 설계 3b)면 그 충돌의 Job id */
  resolves?: string | null;
  /** 역할(통합 설계 5단계 — 옛 서버면 없다 = 작업자) */
  role?: "worker" | "reviewer";
  /** 검토자의 고정 대상(보고 · 커밋 · 읽기 자리) */
  reviewOf?: { reportId: string; commitOid: string; baseCommit?: string | null; place?: string | null; cwd?: string | null } | null;
  /** 헤드리스 턴 기록(3차 — 작업자 · 해결자 · 검토자. 옛 PTY 작업자면 없다) — 낱말 · 수만(프롬프트 · 본문 없음) */
  turns?: TurnView[];
  /** (3a) 바탕 종류 사본 — 있으면 헤드리스 Attempt */
  kind?: AttemptKind | null;
  /** (3a) 띄운 역할의 id · 이름(이름은 띄울 때의 사본 — 역할을 지워도 남는다) */
  roleId?: string | null;
  roleName?: string | null;
  /** (3a) `blocked` 보고 표지(비종결 — 턴이 끝나면 `idle` + 이것). 새 턴이 서면 걷힌다 */
  blocked?: { need: string; at: number } | null;
  /** (3a) 대화를 잇지 못한다(resume 턴의 init 이 고정 id 와 다름) — 더는 resume 하지 않는다 */
  conversationBroken?: boolean;
  /** (3a) 중단을 청했다(트리 미확인이 풀리면 stopped 로) */
  stopRequested?: boolean;
}

/** 턴 인자의 **권한 표시 전용** 요약(서버 `TurnArgsLabel` — 프롬프트 · 지침 본문 · 토큰 · 경로 · 대화 id 없음) */
export interface TurnArgsView {
  cli: string;
  /** `edit` · `full` · `read-only` */
  grade: string;
  /** 설정 출처 통제(`restricted` · `setting-sources-empty` · `ignore-user-config`) */
  settingsControl: string;
  allowedRules?: string[];
  sandbox?: string | null;
  model?: string | null;
  effort?: string | null;
  instructionsSha?: string | null;
  resume?: boolean;
  /** 이 턴의 실효 실행 시한(분 — 서버 min 규칙 값 · 옛 기록은 없다) */
  turnMinutes?: number | null;
}

/** 서버 `TurnRecord` — 헤드리스 턴 하나 */
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
  /** 막힌 종류 낱말(Codex stderr — `outside-write` · `policy` · `other`) */
  denialKinds?: string[];
  tools?: number;
  lastTool?: string | null;
  cliVersion?: string | null;
  /** 실효 모델(Claude init — Codex 는 없다) */
  model?: string | null;
  /** 이 턴의 실효 인자 요약(3a) */
  args?: TurnArgsView | null;
}

/** 서버 `CommitRejection` — 사유 낱말 · 요청 id · 파일 수만 */
export interface CommitRejectionView {
  reason: string;
  requestId?: string | null;
  files?: number | null;
  /** 사람이 손써야 풀리는 사유(`filters-configured` · `no-git-identity` · `worktree-mismatch` · `commit-failed`) */
  needsHuman: boolean;
  seq: number;
  at: number;
}

/** orphaned Run 의 잔존 자원 한 줄(서버 재시작 전의 작업자) */
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

/** 보고 결과(4단계 — 서버 `ReportOutcome`) */
export type ReportOutcome = "success" | "failure" | "blocked";
export type Reviewer = "coordinator" | "human";

/** 작업자 보고(서버 `Report` — git 칸은 서버가 그 worktree 에서 읽은 것) */
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
  /** HEAD 가 기준 그대로 + 미커밋 변경 없음(10-15) */
  noChanges?: boolean;
  /** 불일치(10-15) — `branch-changed` · `unexpected-head`. 있으면 수락할 수 없다 */
  mismatch?: string | null;
  at: number;
  late: boolean;
  /** 해결 Attempt 의 성공 보고 — 충돌 경로마다 어떻게 풀었나(통합 설계 3b `resolved`) */
  resolved?: { path: string; how: string }[];
}

/** 서버가 집행한 작업자 커밋 한 줄(10-15 `commit_changes` — 서버 `WorkerCommit`, 메시지 첫 줄 · 파일 수만) */
export interface WorkerCommitView {
  attemptId: string;
  commitOid: string;
  parentOid: string;
  branch: string;
  subject: string;
  files: number;
  at: number;
}

/** 수락 산출물(서버 `AcceptedArtifact` — 불변, 뒤집기는 `revokedAt` 만 채운다) */
export interface AcceptedView {
  taskId: string;
  attemptId: string;
  reportId: string;
  commitOid: string;
  baseCommitOid?: string | null;
  reviewer: Reviewer;
  /** 검증 요약(통합 설계 4단계 — 명령 글자 없음). 덮어쓰기면 `overridden` 이고 결과는 실패 그대로 */
  verification: { verifyId: string; jobId: string; outcome: VerifyOutcome; exitCode?: number | null; commandSha: string; hermetic: boolean; overridden: boolean } | null;
  acceptedAt: number;
  revokedAt?: number | null;
  revokedBy?: Reviewer | null;
  /** 통합 커밋(통합 ref 에 쌓은 squash — 통합 설계 2-5). 있으면 뒤집기는 `already-integrated` */
  integrationCommit?: string | null;
  integrationParent?: string | null;
  jobId?: string | null;
  preserveRef?: string | null;
  /** 수락 때의 유효 pass 검토(통합 설계 5단계) */
  reviewId?: string | null;
  /** 필수 검토를 사람이 넘었다(면제 기록 — 옛 `requireReview`) */
  reviewWaivedBy?: Reviewer | null;
  /** (3a) 사람 수락이 넘은 수락 규칙 */
  waived?: WaiverView[];
  waivedBy?: Reviewer | null;
  /** (3a) 수락 규칙을 채운 판정 id 들 */
  judgments?: string[];
}

/** 검토 기록 한 줄(서버 `ReviewRecord`) */
export interface ReviewView {
  taskId: string;
  attemptId?: string | null;
  reportId?: string | null;
  decision: "accepted" | "rejected";
  reviewer: Reviewer;
  flipped: boolean;
  at: number;
}

/** "보고 뒤 변경" 한 줄(op `orchestration_report_drift`) */
export interface DriftView {
  attemptId: string;
  reportId: string;
  head?: string | null;
  dirty?: boolean;
  changedSinceReport: boolean;
  error?: string;
}

/** 고정 대화 지켜보기(6단계 — `RunDetail.transcripts`, 경로 · 본문 없음) */
export interface TranscriptWatchView {
  /** `ok` · `pending` · `no-conversation` · `cwd-mismatch` · `outside-cli-dir` · `unreadable` */
  status: string;
  lastGrowthAt?: number | null;
  /** 일하는 중인데 60초 기록 증가 없음(표시만) */
  lagging: boolean;
}

/** 보드 최근 활동 한 칸(op `orchestration_worker_activity` — 6단계, 보드가 보일 때만) */
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
  /** 작업 중 파일 목록 — 작업자 상세가 연 칸에만(op 인자 `detail` — 오케스트레이션 탭 ③) */
  wip?: WipFilesView;
}

/** 작업 중 파일 한 줄(서버 `diff::wip_blocking`) — 기준 커밋 … 지금 작업 트리 */
export interface WipFileView {
  path: string;
  status: ReportFileView["status"];
  adds: number | null;
  dels: number | null;
  binary: boolean;
  /** 아직 커밋하지 않았다(추적 안 된 새 파일 포함) */
  uncommitted: boolean;
  /** 추적 안 된 새 파일(줄 수는 서버가 세었다 — 크면 `adds` 없음) */
  untracked?: boolean;
}

/** 작업 중 파일 목록 — 잘림을 숨기지 않는다 · 못 읽으면 `error` 한 줄 */
export interface WipFilesView {
  files: WipFileView[];
  fileCount: number;
  truncated: boolean;
  base?: string | null;
  error?: string;
}

/** 타임라인 한 줄 — 메타만(본문 없음) */
export interface LogEntry {
  seq: number;
  at: number;
  actor: Actor;
  action: string;
  target?: string;
  outcome: string;
  /** 작업자 요청 id(`commit_rejected` — 10-15) */
  requestId?: string | null;
  /** 고른 파일 수(`commit_rejected` — 이름은 없다) */
  files?: number | null;
}

export interface RunRemaining {
  tasks: number;
  callsThisMinute: number;
  concurrentWorkers: number;
  totalWorkers: number;
  /** (3a) 남은 이어지는 턴(resume) 수 — 옛 서버는 `deliveries` */
  turns?: number;
  deliveries?: number;
  /** 남은 검토(통합 설계 3-4 — 옛 서버면 없다) */
  reviews?: number;
  coordinationSeconds: number;
  executionSeconds: number;
}

/** `orchestration_run` 의 답(사람 보기 — 타임라인 포함) */
export interface RunDetail {
  /** 끝난 앨범의 남은 작업자 worktree 수(목록 요약과 같은 판정) */
  worktreesLeft?: number;
  /** 사람이 고른 앨범 구성. 지침·프로듀서 토큰은 포함하지 않는다. */
  album?: {
    rev: number; members: { artist: string; name: string; grade: "read" | "edit" | "full"; allowedCommands: string[]; joinedRev: number }[];
    accept: { require: { role: string; passes: number }[]; maxRework: number };
    verifyAuto: boolean; planTools: boolean; wakeMax: number; changedAt: number; riskConfirmedAt: number | null;
    /** 완료되면 자동 병합(꺼져 있으면 칸 없음) */
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
  /** 지금 세대의 조정자가 묶여 있나(까닭 글자와 따로 — 없으면 [재개] 는 `no-coordinator`) */
  coordinatorAttached: boolean;
  // (3차 6단계) 2차 시작 대화의 옛 칸(workerPermission · allowedClis · reviewerClis · deliveries)은 서버 보기에 없다(영속 파일에만 — 옛 파일 호환).
  repo: string;
  /** (3a) 이 Run 저장소의 지금 맡기기 상태(옛 서버면 없다) */
  /** (3a) 지금 맡기기의 역할 목록(맡기기가 없으면 빈 목록) */
  roles?: RunRoleView[];
  /** (3a) 지금 맡기기의 수락 규칙(맡기기가 없으면 `null`) */
  acceptRules?: RunAcceptRulesView | null;
  worktreeDir: string;
  limits: RunLimits;
  coordinationDeadlineAt: number;
  executionDeadlineAt: number;
  tasks: TaskView[];
  attempts?: AttemptView[];
  /** 작업자 보고들(4단계) */
  reports?: ReportView[];
  /** 수락 산출물들(불변 — 뒤집힌 것도 남는다) */
  accepted?: AcceptedView[];
  /** 검토 판정 기록 */
  reviews?: ReviewView[];
  /** 서버가 집행한 작업자 커밋(10-15 `commit_changes`) */
  commits?: WorkerCommitView[];
  /** 고정 대화 지켜보기(6단계 — attemptId → 상태, 경로 · 본문 없음) */
  transcripts?: Record<string, TranscriptWatchView>;
  /** 보류(통합 설계 2-1 — 옛 서버면 없다) */
  hold?: RunHoldView | null;
  /** 영속 저장 상태(F7 — 옛 서버면 없다) */
  persist?: RunPersistView | null;
  /** (2단계 단계 4) 앱이 깨움 예약 기록(사람 보기 — SHA · 범위 · 채팅). 채팅 기록의 "앱이 깨움" 표지가 출처를 맞춘다(표시용) */
  wakes?: WakeRecordView[];
  /** 통합 ref(통합 설계 3단계 — 통합 ref 가 없는 옛 Run 이면 없다) */
  integration?: IntegrationView | null;
  /** 앨범 병합 기록(`album_merge.rs` — 앱이 한 병합 · 자동 병합이 멈춘 까닭) */
  merge?: RunMergeView | null;
  /** 터미널에서 직접 병합했다(내보낸 머리가 대상 브랜치에 들어 있다) */
  mergedOutside?: boolean;
  /** 통합 작업 기록(통합 설계 2-4 — 영속 의도) */
  jobs?: IntegrationJobView[];
  /** Run 완료 조건(통합 설계 3-4 — 서버 판정) */
  completable?: CompletableView;
  /** 수락 전 검증 설정(통합 설계 4단계 — 사람이 정한 것만: 3차부터 저장소 맡기기의 Run 시작 때 사본. 없으면 검증 없음) */
  verify?: VerifyConfigView | null;
  /** Task 마다 마지막 검증 결과 + 출력 꼬리(서버 메모리 — 끝 8 KiB) */
  lastVerify?: Record<string, LastVerifyView>;
  /** 지금 도는 검증의 Job id */
  verifyRunning?: string[];
  /** (옛 2차) 수락 전 검토 필수 — 옛 Run 의 면제 기록에만. 3a 부터는 맡기기의 수락 규칙(`acceptRules`) */
  requireReview?: boolean;
  /** 검토 보고(검토자의 판정 — stale · late 포함) */
  reviewReports?: ReviewReportView[];
  /** Task 마다 현재 보고의 검토 상태 */
  reviewState?: Record<string, ReviewStateView>;
  remaining: RunRemaining;
  latestSeq: number;
  log?: LogEntry[];
  leftovers?: LeftoverView[];
  /** 예상 밖 변경 · 쓰는 중이라 남긴 서버 임시 자리(통합 설계 6-2 — 옛 서버면 없다) */
  tempPending?: TempPendingView[];
  /** [정리] 를 열 수 있나(끝난 Run · orphaned — 옛 서버면 없다) */
  cleanable?: boolean;
  /** (2단계 단계 6) 지금 세대로 묶인 프로듀서 채팅 id(없으면 `null`) — 목록 요약의 같은 칸과 같다 */
  coordinatorChat: string | null;
  /** (3차 5단계) 누가 열었나 — 앨범 머리의 "AI 가 연 앨범 · 프로듀서 채팅" 한 줄 */
  origin: RunOrigin;
}

// ---------------------------------------------------------------------------
// 정리(통합 설계 6단계 — 서버 임시 자리 폐기 · Run 끝 [정리])
// ---------------------------------------------------------------------------

/** 남긴 서버 임시 자리(검증 · 검토 worktree · 검토자 빈 cwd · 검증 임시) */
export interface TempPendingView {
  path: string;
  role: "verify" | "review" | "review-cwd" | "temp" | string;
  /** `changed`(쉬는 상태와 다름) · `in-use` · `remove-failed` · `not-a-worktree` · `unreadable` */
  why: string;
  at: number;
}

/** [정리] 의 작업자 worktree 한 줄 */
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

/** [정리] 의 ref 한 줄(`refs/aynx/orch/<run16>/…` — Run id hex 앞 16자) */
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

/** `orchestration_cleanup_preview` 의 답 */
export interface CleanupPreview {
  runId: string;
  state: RunState;
  worktrees: CleanupWorktreeRow[];
  refs: CleanupRefRow[];
  tempPending: TempPendingView[];
  exportBranch?: string | null;
}

/** `orchestration_cleanup` 의 답 */
export interface CleanupResult {
  runId: string;
  /** `branchKept` — 브랜치 지우기를 원했는데 남긴 까닭(`unmerged` · `checked-out` · `preserve-ref-removed` · `delete-failed`). 실패가 아니다 */
  worktrees: { path: string; removed: boolean; branchDeleted?: boolean; branchKept?: string | null }[];
  refs: string[];
  failed: { path?: string; ref?: string; reason: string }[];
  temps: { removed: number; kept: number; busy: number };
}

/** 보류 사유(통합 설계 2-1) */
export type HoldReason = "integration-diverged" | "persist-failed" | "cleanup-pending" | "repo-identity-changed";

/**
 * Run 의 영속 저장 상태(F7 — 서버 `store::saver::PersistMark`): 마지막으로 디스크에 닿은 seq · 이어지는 실패(분류 낱말만 — 경로 · OS 문장 없음).
 * 실패 중이면 세션 서버가 지금 끝날 때 최근 변경을 잃을 수 있다.
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

/** 통합 작업의 단계(통합 설계 2-4) */
export type JobPhase =
  | "prepared"
  | "candidate"
  | "awaiting-approval"
  | "verifying"
  | "committing"
  | "integrated"
  | "conflict"
  | "aborted";

/** 통합 작업 기록 하나(영속 의도 — 서버 `IntegrationJob`) */
export interface IntegrationJobView {
  jobId: string;
  taskId: string;
  phase: JobPhase;
  candidate?: string | null;
  /** 후보를 계산할 때의 통합 머리(사람 확인이 여기에 묶인다) */
  old?: string | null;
  reportId?: string;
  outcome?: { reason: string; at: number } | null;
  startedAt: number;
  /** 사람 확인 대기 시작(통합 설계 5-1 — 30분이면 만료) */
  awaitingAt?: number | null;
  approval?: { by: "human" | "auto"; candidate: string; commandSha: string; old: string; at: number } | null;
  verify?: VerifyResultView | null;
  override?: { failedJobId: string; verifyId: string; candidate: string; old: string; at: number } | null;
  /** 관문 때의 유효 pass 검토 · 필수 검토 면제(통합 설계 5단계) */
  reviewId?: string | null;
  reviewWaived?: boolean;
}

/** 검증 결과 낱말(통합 설계 2-5) */
export type VerifyOutcome =
  | "pass"
  | "fail"
  | "timeout"
  | "cancelled"
  | "modified-tracked"
  | "spawn-failed"
  | "symlink-outside"
  | "stop-unconfirmed";

/** Run 의 검증 설정(사람이 정한 것) */
export interface VerifyConfigView {
  command: string;
  commandSha: string;
  timeoutMinutes: number;
  autoRun: boolean;
  keepDirs?: string[];
  cacheKeyFiles?: string[];
  extraEnvNames?: string[];
}

/** 검증 결과(영속 — 꼬리 본문 없음) */
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

/** Task 의 마지막 검증(보기 — 꼬리 포함) */
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

/** Run 완료 조건 — 막는 것 낱말들(서버 `integrate::completable`) */
export interface CompletableView {
  ok: boolean;
  blockers: string[];
}

/** [조정] 재료(op `orchestration_reconcile_preview`) */
export interface ReconcilePreview {
  runId: string;
  workRef: string;
  expectedHead: string;
  currentHead: string | null;
  integrated: { taskId: string; title: string; jobId?: string | null; integrationCommit: string; contained: boolean | null }[];
}

/** 보고의 바뀐 파일 한 줄(op `orchestration_report_files` — 조정자 `get_diff` 와 같은 목록) */
export interface ReportFileView {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "unmerged" | "unknown";
  adds: number | null;
  dels: number | null;
  binary: boolean;
}

/** 보고의 파일 목록 — 고정 OID(`base` … `commit`) · 잘림 */
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

/** `orchestration_snapshot` 의 한 줄 */
export interface RunSummary {
  runId: string;
  name: string;
  state: RunState;
  /** 끝난 앨범의 남은 작업자 worktree 수(디스크 기준 — [보관] 판정 재료 · 옛 서버는 칸 없음) */
  worktreesLeft?: number;
  /** 내보낸 브랜치(없으면 `null` · 옛 서버는 칸 없음) */
  exportedBranch?: string | null;
  previousState?: RunState | null;
  orphaned: boolean;
  gen: number;
  createdAt: number;
  updatedAt: number;
  pauseReason?: string | null;
  /** 지금 세대의 조정자가 묶여 있나 */
  coordinatorAttached: boolean;
  repo: string;
  latestSeq: number;
  taskCount: number;
  taskStates: Partial<Record<TaskState, number>>;
  attemptCount: number;
  /** (3a) `blocked` 로 멈춘(idle) 작업자 수 — 조정자가 사람에게 말한다. 옛 서버면 없다 */
  blocked?: number;
  /** (3차 5단계) 누가 열었나 */
  origin: RunOrigin;
  /** 영속 저장 상태(F7 — 옛 서버면 없다) */
  persist?: RunPersistView | null;
  /**
   * (2026-10-30 오케스트레이션 탭 ⑤ · 노트 D9) 턴이 살아 있을 수 있는 Attempt 수 — 종류별(쓰기형 · 판정형). 탭 · 독의 막대가 상세 없이
   * 재생 · 검토 · 쉼을 가른다([`albumPulse`])
   */
  running: { write: number; judge: number };
  /** 보류(통합 설계 2-1 — 상세에도 같은 칸) */
  hold: RunHoldView | null;
  /**
   * (2단계 단계 2) 이어받기 판정 — 서버 `adopt_verdict`(목록 · `adopt_run` 이 같은 함수). `restore` = 새 프로듀서가 귀속을 되찾을 수 있다 ·
   * `autoResume` = 되찾으면 곧바로 재생(아니면 멈춤 그대로 — 사람이 [재개]) · `why` = 못 되찾는 까닭 낱말
   */
  adoptable: RunAdoptable;
  /** (2단계 단계 2) 지금 세대로 묶인 프로듀서 채팅 id(세대 · 토큰 없음) — 묶인 프로듀서가 없으면 `null` */
  coordinatorChat: string | null;
  /** (2단계 단계 2) 이 앨범에 귀속된 프로듀서 채팅들(Run 파일 `producers` — 연 채팅 + 이어받은 채팅) */
  producers: string[];
  /** (2단계 단계 4) 앱이 깨움 — 꺼짐 까닭 · 사람 말 사이 셈 / 상한 · 앨범 누적 / 200 */
  wake: RunWakeView | null;
}

/** 앱이 깨움의 목록 칸(서버 `wake::wake_view`) */
export interface RunWakeView {
  /** `run-max` · `off`(스튜디오 상한 0) · `segment-max` · `unresponsive` · `failed` — 켜져 있으면 `null` */
  off: string | null;
  segment: number;
  cap: number;
  total: number;
  max: number;
  /** 지금 나가 있는 깨움 id */
  live: string | null;
}

/** 깨움 예약 기록 한 줄(서버 `WakeRecord` — 문장 없음 · SHA 만 · 기록 출처 대조용) */
export interface WakeRecordView {
  wakeId: string;
  chat: string;
  sha: string;
  fromSeq: number;
  toSeq: number;
  at: number;
  retry?: boolean;
  /** 문장의 재료(열거 낱말 · id) — 기록의 알약이 짓는다 */
  items?: { what: string; taskId?: string | null; attemptId?: string | null }[];
  more?: number;
  resync?: boolean;
}

/** 이어받기 판정(서버 `AdoptVerdict::view` — 노트 2-4 표) */
export interface RunAdoptable {
  restore: boolean;
  autoResume: boolean;
  why?: string | null;
}

/** 누가 Run 을 열었나(3차 5단계 — 서버 `RunOrigin`) */
export interface RunOrigin {
  by: "human" | "ai" | string;
  /** (2단계 단계 2) 그 앨범을 연 프로듀서 채팅 id — 사람이 연 Run 이면 없다 */
  producer?: string | null;
}


/** 이벤트 `orchestration-changed` 의 몸(토큰 · 본문 없음) */
export interface RunChanged {
  runId: string;
  seq: number;
  closed?: boolean;
  /** 보관 · 복원 · 영구 삭제 — 보관함 목록을 다시 읽는다 */
  archive?: boolean;
}

/** 보관함 한 줄(`orchestration_archive_list`) */
export interface ArchivedAlbum {
  runId: string;
  name: string;
  repo: string;
  state: RunState;
  previousState?: RunState | null;
  taskCount: number;
  createdAt: number;
  archivedAt: number;
  /** 내보낸 브랜치(없으면 `null`) */
  exportedBranch: string | null;
  /** 내보내지 않은 통합 결과가 있다 — 통합 머리가 시작 커밋과 다르고 내보낸 브랜치가 품지 않는다 */
  unexported: boolean;
  /** 복원하면 앨범 화면에서 내보낼 수 있다(orphaned 는 서버가 내보내지 않는다 · 저장소가 없으면 낼 곳이 없다) */
  exportable: boolean;
}

/**
 * 이벤트 `orchestration-progress` 의 몸(F4 — 토큰 · 본문 없음) — 도는 턴의 진행 칸(도구 수 · 거절 · 마지막 도구 · 모델)이 바뀌었다.
 * seq 를 올리지 않는 사건이다(`wait_run` 을 깨우지 않는다 — 서버가 Attempt 마다 2초에 한 번까지로 줄인다).
 */
export interface RunProgress {
  runId: string;
  attemptId: string;
  turn: number;
}

/** 실행 방식을 가르는 칸(서버 `Attempt::exec_mode`) */
export type ExecModeFields = Partial<Pick<AttemptView, "kind" | "turns" | "role" | "stream">>;

/** 감독 사건 한 건(서버 `Notice` — 토큰 · 본문 없음) */
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
