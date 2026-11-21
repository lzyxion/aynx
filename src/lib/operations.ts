/**
 * 작업안(execution plan) 프런트 래퍼 — 오류는 삼킨다(승인만 사유를 올린다 — [`approveOperation`]).
 * 승인 · 취소는 Tauri 명령 전용이다 — AI(MCP)는 작업안을 만들고 검토를 요청할 뿐 승인 · 실행 길이 없다.
 */

import { invoke } from "./ipc";

/** Rust `OperationState`(camelCase) */
export type OperationState =
  | "draft"
  | "awaitingApproval"
  | "rejected"
  | "expired"
  | "approved"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

/** Rust `TargetState` 와 동기. `unknown` 은 시작한 뒤 종료를 확인 못 한 것 — 원격에서 계속 돌 수 있어 실패도 취소도 아니다. */
export type TargetState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timedOut"
  | "cancelled"
  | "unknown";

/** Rust `TargetResult`(camelCase) */
export interface TargetResult {
  state: TargetState;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  startedAt: number | null;
  endedAt: number | null;
  errorClass: string | null;
  /** `db:` 대상만 */
  db?: DbRunResult;
}

/** `unknown` 은 커밋 답 유실 — 앱은 다시 보내지 않는다 */
export interface DbRunResult {
  outcome: "committed" | "rolledBack" | "unknown" | "disconnected" | "notRun";
  reason?: string;
  message?: string;
  maxAffected: number;
  totalAffected: number;
  statementCount?: number;
  elapsedMs?: number;
  statements: {
    index: number;
    keyword: string;
    affected?: number;
    elapsedMs: number;
    columns?: { name: string; type: string }[];
    rows?: unknown[][];
    truncated?: boolean;
  }[];
  failed?: { index: number; message: string };
}

/** Rust `DbPlanStmt` */
export interface DbPlanStmt {
  sql: string;
  keyword: string;
  counted: boolean;
  /** 바꾸지만 영향 행을 세지 않는 문장(DDL · TRUNCATE …) — `maxAffected` 가 막지 못한다 */
  uncounted: boolean;
}

/** Rust `DbPlan` — 주소 · 사용자 · 경유 별칭은 싣지 않는다(화면은 자기 연결 목록에서 찾는다) */
export interface DbPlan {
  connId: string;
  connName: string;
  engine: string;
  database?: string;
  throughSsh: boolean;
  statements: DbPlanStmt[];
  maxAffected: number;
  timeoutSeconds: number;
}

export interface OperationProgress {
  operationId: string;
  streamId: string;
  result: TargetResult;
}

export interface OperationStateEvent {
  operationId: string;
  state: OperationState;
}

/** Rust `Operation` 의 camelCase 계약 그대로 */
export interface Operation {
  operationId: string;
  command: string;
  /** `targets[0]` 가 canary 다 */
  targets: string[];
  cwd: string | null;
  /** canary 성공 뒤 canary 대상에서 돌아 exit 0 이어야 나머지로 번진다 */
  validate: string | null;
  /** 해석하지 않는 메타데이터 — 실행은 늘 순차 canary */
  mode: string;
  strategy: string;
  concurrency: number;
  timeoutSeconds: number;
  state: OperationState;
  createdAt: number;
  requestedAt: number | null;
  /** `null` = 만료 없음. 앱에 시계는 없다 — Rust 가 읽거나 전이할 때 그 자리에서 만료시킨다 */
  expiresAt: number | null;
  title: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  /** `"manual"` · `"auto"` — 감사 기록과 같은 값 */
  approvalMethod?: string | null;
  approveAll?: boolean;
  /** 집계는 `partial` 일 수 있어 결과 알림 · 기록이 이것을 보고 `취소됨` 으로 말한다 */
  cancelledByUser?: boolean;
  /** 있으면 `command` 는 문장들을 이은 표시용 글이고 대상은 `db:<connId>` 하나다 */
  db?: DbPlan;
  /** AI 가 쓴 승인 요약 — 믿지 않는 글자다(카드는 `AI` 표지를 붙여 그린다) */
  summary?: string | null;
  effect?: DeclaredEffect | null;
  analysis?: PlanAnalysis | null;
  mismatch?: boolean;
}

/** Rust `analysis::Effect` */
export type DeclaredEffect = "read" | "write" | "delete";

/** Rust `analysis::Computed` — `unknown` 은 비교에서 적어도 쓰기다 */
export type ComputedEffect = "read" | "write" | "unknown" | "delete";

/** Rust `StmtAnalysis` */
export interface StmtAnalysis {
  keyword: string;
  table?: string;
  whereClause?: boolean;
  effect: ComputedEffect;
}

/** Rust `PlanAnalysis` */
export interface PlanAnalysis {
  effect: ComputedEffect;
  cause?: string;
  programs?: string[];
  tokens?: { text: string; effect: ComputedEffect; special?: boolean }[];
  sudo?: boolean;
  statements?: StmtAnalysis[];
  lines?: CommandLine[];
}

/** 판정은 Rust `analysis` 한 곳이다 — 화면은 `over` 등을 다시 계산하지 않는다 */
export interface CommandLine {
  text: string;
  /** 이 줄 뒤의 구분자 */
  sep?: ";" | "&&" | "||" | "&" | "\n";
  effect: ComputedEffect;
  cause?: string;
  quiet?: boolean;
  /** AI 가 선언한 효과보다 세다 */
  over?: boolean;
  /** `text` 의 코드 포인트 색인 [start, end)(`Array.from(text)` 와 같은 자리) */
  marks?: CommandLineMark[];
  /** 선언과 무관하게 위험한 줄(바깥 `WHERE` 없는 `UPDATE` · `DELETE` · `DROP` · `TRUNCATE`) — `over` 와 뜻이 다르다 */
  danger?: boolean;
}

export interface CommandLineMark {
  start: number;
  end: number;
  effect: ComputedEffect;
  kind?: "sudo";
}

export function isDbTarget(id: string): boolean {
  return id.startsWith("db:");
}

export interface OperationList {
  pending: Operation[];
  recent: Operation[];
  /** 세션 서버의 자동 승인이 거부한 사유 — 작업안 id → 한 줄 */
  autoRefusals?: Record<string, string>;
  /** 곧 자동 승인될 대기(`operations/auto.rs` `auto_pending`) — 카드 · 배지 · 알림은 이것을 빼고 본다 */
  autoPending?: string[];
  /** 훑기 전에 걸러진 이유(`policy/explain.rs` 와 같은 판정) — 시도 뒤의 거부는 `autoRefusals` 다 */
  autoWhy?: Record<string, { code: string; args: Record<string, string> }>;
}

const EMPTY: OperationList = { pending: [], recent: [] };

export async function listOperations(): Promise<OperationList> {
  try {
    return (await invoke<OperationList>("list_operations")) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function operationResults(operationId: string): Promise<Record<string, TargetResult>> {
  try {
    return (await invoke<Record<string, TargetResult>>("operation_results", { operationId })) ?? {};
  } catch {
    return {};
  }
}

/** 빈 맵과 읽기 실패를 가려야 하는 자리용 — 실패면 `null` */
export async function operationResultsOrNull(
  operationId: string,
): Promise<Record<string, TargetResult> | null> {
  try {
    return (await invoke<Record<string, TargetResult>>("operation_results", { operationId })) ?? null;
  } catch {
    return null;
  }
}

export async function rejectOperation(operationId: string): Promise<Operation | null> {
  try {
    return (await invoke<Operation>("reject_operation", { operationId })) ?? null;
  } catch {
    return null;
  }
}

/** 대상을 좁히기만 한다 — 명령 · 방식은 Rust 가 못 고치게 막는다 */
export async function modifyOperationTargets(
  operationId: string,
  targets: string[],
): Promise<Operation | null> {
  try {
    return (await invoke<Operation>("modify_operation_targets", { operationId, targets })) ?? null;
  } catch {
    return null;
  }
}

// ── 실행 브로커 (승인 · 취소) — Tauri 명령 전용 ──
// 승인에 명령 문자열을 다시 넘기지 않는다 — executor 는 `operationId` 로 저장소에서 읽는다(AI 재주입 차단).

export interface ApproveResult {
  operation: Operation | null;
  error: string | null;
}

/**
 * 오류를 삼키지 않는다 — 권위 게이트의 거부를 `null` 로 뭉개면 화면이 승인된 척하는 유령 상태가 된다.
 * throw 하지 않아 폴링 루프는 안 끊긴다.
 */
export async function approveOperation(
  operationId: string,
  approvalMethod: "manual" | "auto" = "manual",
): Promise<ApproveResult> {
  try {
    const operation = (await invoke<Operation>("approve_operation", { operationId, approvalMethod })) ?? null;
    return { operation, error: null };
  } catch (e) {
    const error = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
    return { operation: null, error };
  }
}

/** 협력적 취소 — 원격에서 이미 시작된 명령은 계속 돌 수 있다 */
export async function cancelOperation(operationId: string): Promise<void> {
  try {
    await invoke("cancel_operation", { operationId });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

// ── 실행 기록 ──

/** Rust `AuditTargetResult` — 새 칸은 옛 줄에 없다 */
export interface AuditTargetResult {
  streamId: string;
  /** 모르는 값이 올 수 있어 문자열로 받는다 */
  state: string;
  exitCode?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  /** `[automation] audit_output_excerpt` 를 켠 경우 · 공유 중인 대상만 */
  stdoutTail?: string | null;
  stderrTail?: string | null;
}

/** Rust `AuditTargetLabel` — 승인 시점의 스냅샷 */
export interface AuditTargetLabel {
  id: string;
  label: string;
  code: string;
}

/** Rust `AuditRun` — `state` 가 `null` 이면 끝난 줄이 없다(도는 중이거나 앱이 먼저 닫혔다) */
export interface AuditRun {
  operationId: string;
  command: string;
  title: string | null;
  cwd: string | null;
  validate: string | null;
  summary?: string | null;
  reason?: string | null;
  /** `targets[0]` 가 canary 다 */
  targets: string[];
  targetLabels: AuditTargetLabel[];
  approvalMethod: string | null;
  approveAll?: boolean;
  approvedAt: number;
  finishedAt: number | null;
  state: string | null;
  results: AuditTargetResult[];
  cancelledByUser?: boolean;
  cancelledAt?: number | null;
}

/** 실패하면 `null` — 빈 목록과 "못 읽음" 을 화면이 가른다 */
export async function auditRuns(sinceMs: number, limit: number): Promise<AuditRun[] | null> {
  try {
    return (await invoke<AuditRun[]>("audit_runs", { sinceMs: Math.max(0, Math.floor(sinceMs)), limit })) ?? [];
  } catch {
    return null;
  }
}

// ── 실행 뷰 맞춤 ──

const TERMINAL_STATES: ReadonlySet<OperationState> = new Set<OperationState>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);

export type ExecReconcile = "keep" | "update" | "update+refetch";

/** 백엔드(목록)가 권위다 — 이벤트를 놓친 사이 끝난 실행은 결과도 다시 읽는다 */
export function reconcileExecState(
  viewState: OperationState,
  listState: OperationState,
): ExecReconcile {
  if (viewState === listState) return "keep";
  return TERMINAL_STATES.has(listState) ? "update+refetch" : "update";
}

const NEVER_RAN: ReadonlySet<OperationState> = new Set<OperationState>(["expired", "rejected"]);

/** 검토 요청 즉시 `operation-state{awaitingApproval}` 이 온다 — 돌지도 않은 작업안에 실행 뷰를 세우지 않게 무시한다 */
const NOT_RUN_YET: ReadonlySet<OperationState> = new Set<OperationState>(["awaitingApproval"]);

export type ExecEventAction = "apply" | "ignore" | "drop";

/** 만료 · 거부는 실행된 적이 없어 실행 뷰를 만들지 않는다 — 있던 뷰는 걷어 낸다 */
export function execEventAction(state: OperationState, hasView: boolean): ExecEventAction {
  if (NOT_RUN_YET.has(state)) return "ignore";
  if (!NEVER_RAN.has(state)) return "apply";
  return hasView ? "drop" : "ignore";
}

// ── 위험 신호 ──

/** 화면 배지용 자문이다 — 넓게 잡는다(오탐이 미탐보다 낫다) */
export function classifyRisk(command: string): "safe" | "dangerous" {
  return DANGEROUS.some((re) => re.test(command)) ? "dangerous" : "safe";
}

/** `src-tauri/src/policy.rs` 의 `DANGEROUS` 와 케이스가 같아야 한다 — 자동 승인 게이트가 그 목록으로 다시 판정한다 */
const DANGEROUS: readonly RegExp[] = [
  /\brm\b/,
  /\brmdir\b/,
  /\bdd\b/,
  /\bmkfs(\.\w+)?\b/,
  /\bsudo\b/,
  /\bsu\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\b(kill|killall|pkill)\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /\bsystemctl\b[^\n]*\b(restart|stop)\b/,
  />>?/,
  /\bfind\b[^\n]*-delete\b/,
  /\bgit\b[^\n]*\breset\b[^\n]*--hard\b/,
  /\btruncate\b/,
];

// ── 검토 대기 만료 ──

/** 올림이다 — 30초 남았는데 "0분" 이면 아직 승인할 수 있는 카드가 끝난 것처럼 읽힌다 */
export function expiryLabel(
  expiresAt: number | null,
  now: number,
): { minutes: number } | null {
  if (expiresAt === null || !Number.isFinite(expiresAt)) return null;
  const left = expiresAt - now;
  if (left <= 0) return { minutes: 0 };
  return { minutes: Math.ceil(left / 60_000) };
}
