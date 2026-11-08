/**
 * 작업안(execution plan) 프런트 래퍼 — 로드맵 **단계 8·9·10**
 * (docs/log/2026-09-10-execution-plans.md).
 *
 * Rust [`operations`](src-tauri/src/operations.rs) 저장소·실행 브로커를 얇게 감싼다(`context.ts`
 * 와 같은 원칙: **오류는 전부 삼킨다** — Rust 가 아직 없거나 실패해도 관리뷰가 무너지면 안 된다.
 * 단, 승인은 예외로 사유를 올린다 — [`approveOperation`] 주석 참고).
 *
 * ## 실행은 있지만 AI(MCP)는 닿지 못한다 (보안 불변 · CLAUDE.md)
 *
 * 이 모듈의 명령은 두 갈래다: **읽기(list·결과 조회)·거절·대상 수정**은 관리뷰가 늘 쓰고,
 * **승인·취소**([`approveOperation`]·[`cancelOperation`])는 단계 9 가 더한 **Tauri 전용** 실행
 * 경로다 — 사람이 앱에서 누른다. 작업안을 만들고 검토를 요청하는 것은 AI(MCP 도구)의 몫이지만,
 * **승인·실행 경로는 MCP 에 없다** — AI 는 제안까지고, 실행 방아쇠는 언제나 사람이 당긴다.
 */

import { invoke } from "./ipc";

/**
 * 작업안 상태 — Rust `OperationState`(camelCase).
 *
 * 단계 8 까지는 넷(검토 단계)뿐이었고, **단계 9(실행 브로커)가 실행 상태를 더한다**:
 * 사용자가 승인하면 `approved → running` 으로 가고, executor 가 대상별 결과를 모아
 * `succeeded`/`partial`/`failed`/`cancelled` 로 봉한다.
 */
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

/**
 * 한 대상의 실행 상태 — Rust `TargetState`(camelCase). 결과 행렬의 칸 하나.
 *
 * `"unknown"`(상태 불명)은 실행을 **시작한 뒤** 종료를 확인 못 한 경우다(취소·전송 손실) — 원격에서
 * 계속 돌 수 있어 실패로도 깨끗한 취소로도 볼 수 없다(슬라이스 A5). Rust `TargetState::Unknown` 과 동기.
 */
export type TargetState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timedOut"
  | "cancelled"
  | "unknown";

/** 한 대상의 실행 결과 — Rust `TargetResult`(camelCase). `operation-progress` 이벤트로도 온다. */
export interface TargetResult {
  state: TargetState;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** exec 가 64KB 상한에서 stdout 앞부분을 버렸는가(아직 화면에 표시하지 않는다). */
  stdoutTruncated?: boolean;
  /** stderr 쪽 같은 표시. */
  stderrTruncated?: boolean;
  startedAt: number | null;
  endedAt: number | null;
  /** 오류분류(사람이 읽는 짧은 사유) — 성공이면 null. 취소는 협력적 한계를 담는다. */
  errorClass: string | null;
  /** **DB 작업안의 결과**(쿼리 타일 3b — `db:` 대상만, 옛 서버 · 셸 대상이면 없다) — Rust `TargetResult.db` */
  db?: DbRunResult;
}

/** DB 작업안 한 번의 결과 — `committed` · `rolledBack`(사유 `error` · `cancelled` · `timedOut` · `commitFailed` · `maxAffected`) · `unknown`(커밋 답 유실 —
 * 앱은 다시 보내지 않는다) · `disconnected` · `notRun`(재판정 · 열기에서 멈춤 — 아무것도 실행하지 않았다) */
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

/** DB 작업안의 문장 하나 — Rust `DbPlanStmt` */
export interface DbPlanStmt {
  sql: string;
  keyword: string;
  /** 엔진이 영향 행을 세는 문장(`maxAffected` 가 막을 수 있다) */
  counted: boolean;
  /** 바꾸지만 영향 행을 세지 않는 문장(DDL · TRUNCATE · WITH … — `maxAffected` 가 막지 못한다) */
  uncounted: boolean;
}

/**
 * **DB 쓰기 작업안**(쿼리 타일 3b) — Rust `DbPlan`. 대상은 `db:<connId>` 하나, 실행은 세션 서버가 따로 연 쓰기 연결의 **한 트랜잭션**
 * (실패 · 상한 초과면 전부 되돌림). 주소 · 사용자 · 경유 별칭은 싣지 않는다 — 화면은 자기 연결 목록(`app/db-conns`)에서 찾는다.
 */
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

/** `operation-progress` 이벤트 페이로드 — 대상 칸 하나가 바뀌었다. */
export interface OperationProgress {
  operationId: string;
  streamId: string;
  result: TargetResult;
}

/** `operation-state` 이벤트 페이로드 — 작업안 집계 상태가 바뀌었다. */
export interface OperationStateEvent {
  operationId: string;
  state: OperationState;
}

/** 작업안 하나 — Rust `Operation` 의 camelCase 계약 그대로. */
export interface Operation {
  operationId: string;
  command: string;
  /** 대상 세션 id 들 (= `list_sessions` 의 id = 거울 streamId). **`targets[0]` 가 canary 다.** */
  targets: string[];
  /** 실행 작업 디렉터리(선택). 있으면 `cd -- <dir> && (명령)` 으로 그 디렉터리에서 실행. */
  cwd: string | null;
  /**
   * canary 사후 검증 명령(선택) — canary 성공 뒤 canary 대상에서 실행해 **exit 0 이어야** 나머지로
   * 번진다. exit 0 ≠ 서비스 정상이므로 이걸로 실제 상태를 확인한다. `null` 이면 검증 없이 canary
   * exit 0 만으로 번진다.
   */
  validate: string | null;
  /** 실행 방식(자유 문자열, 해석 안 되는 메타데이터 — 실행은 항상 순차 canary). */
  mode: string;
  /** 전개 전략(자유 문자열, 해석 안 되는 메타데이터). */
  strategy: string;
  concurrency: number;
  timeoutSeconds: number;
  state: OperationState;
  createdAt: number;
  /**
   * **검토를 요청한 시각**(epoch ms) — 초안(아직 요청 전)이면 `null`.
   * (docs/log/2026-09-21-approval-ttl.md)
   */
  requestedAt: number | null;
  /**
   * **이 검토 요청이 만료되는 시각**(epoch ms). `null` = 만료 없음(설정의 만료 시간이 `0`).
   *
   * 앱에 시계는 없다 — Rust 가 작업안을 **읽거나 전이할 때 그 자리에서** 이 값을 지난 대기를
   * 만료시키고 `operation-state{state:"expired"}` 를 올린다.
   */
  expiresAt: number | null;
  title: string | null;
  reason: string | null;
  /**
   * 멱등 키(선택) — AI 가 요청마다 한 번 생성하는 고유 토큰. 같은 키로 다시 부르면 새 작업안을
   * 만들지 않고 **기존 작업안을 돌려준다**(재시도로 중복 저장·중복 실행 방지).
   */
  idempotencyKey: string | null;
  /**
   * **어떻게 승인됐나** — `"manual"`(사람이 앱에서 눌렀다) · `"auto"`(자동 승인 정책). 승인 전이면
   * `null`(옛 백엔드면 칸이 없다 — 그래서 선택 칸이다). 감사 기록과 같은 값이고, 실행 결과 알림이
   * `자동` 표식을 붙이는 근거다(docs/log/2026-09-28-run-result-notify.md).
   */
  approvalMethod?: string | null;
  /**
   * **'모두 승인' 으로 자동 승인됐는가**(2026-10-23) — 대상이 전부 '모두 승인' 이라 명령을 가리지 않고 넘어갔다.
   * `approvalMethod` 는 그대로 `"auto"` 다. 참일 때만 실린다(옛 백엔드 · 보통 승인은 칸이 없다).
   */
  approveAll?: boolean;
  /**
   * **사람이 실행 도중 [취소]를 눌렀는가** — Rust `cancel_operation` 이 도는 실행에만 찍는다. 집계
   * 상태는 그대로라(일부 성공 + 나머지 시작 전 취소 = `partial`) 결과 알림·기록이 이것을 보고 `일부 실패`
   * 대신 `취소됨` 으로 말한다(docs/log/2026-09-28-run-history.md "사람의 취소"). 옛 백엔드면 칸이 없다.
   */
  cancelledByUser?: boolean;
  /** **DB 쓰기 작업안**(쿼리 타일 3b) — 있으면 `command` 는 문장들을 이은 글(표시용)이고 대상은 `db:<connId>` 하나다. 옛 서버면 없다 */
  db?: DbPlan;
  /**
   * **AI 가 쓴 설명**(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 평문(Rust 가 제어 글자를 걷고 300자에서 자름).
   * 믿지 않는 글자다: 카드는 `AI` 표지를 붙여 그린다. 옛 작업안 · 옛 서버면 없다.
   */
  summary?: string | null;
  /** AI 가 **선언한** 효과. 옛 작업안이면 없다(그때는 견주지 않는다) */
  effect?: DeclaredEffect | null;
  /** **앱 분석** — Rust 가 원문만 보고 매긴 효과와 근거(`operations/analysis.rs`). 옛 서버면 없다 */
  analysis?: PlanAnalysis | null;
  /** 선언이 분석보다 약한가 — 참이면 카드가 실패색 테두리 · 두 번 눌러 승인 */
  mismatch?: boolean;
}

/** AI 가 선언하는 효과 — Rust `analysis::Effect` */
export type DeclaredEffect = "read" | "write" | "delete";

/** 앱이 매긴 효과 — 선언 셋 + `unknown`(표 밖 · 해석 못 함 — 비교에서는 적어도 쓰기) · Rust `analysis::Computed` */
export type ComputedEffect = "read" | "write" | "unknown" | "delete";

/** DB 문장 하나의 앱 분석 — Rust `StmtAnalysis` */
export interface StmtAnalysis {
  keyword: string;
  table?: string;
  /** `UPDATE` · `DELETE` 의 바깥 `WHERE` 유무 — 다른 문장은 없다 */
  whereClause?: boolean;
  effect: ComputedEffect;
}

/** 작업안 하나의 앱 분석 — Rust `PlanAnalysis` */
export interface PlanAnalysis {
  effect: ComputedEffect;
  /** 그 효과를 낸 첫 근거(`rm` · `find -delete` · `>` · `DELETE users` …) — 읽기면 없다 */
  cause?: string;
  /** 셸 명령의 프로그램들(차례대로) */
  programs?: string[];
  /**
   * 칩 줄의 낱말들 — 구획마다 하나(`find -delete` 처럼 효과를 낸 꼴) + 구획 밖 근거(`>` · `$()` — `special`). 낱말마다 **그것이 낸
   * 효과**라 화면이 색을 결정적으로 고른다(Rust `ProgramToken`). 옛 서버면 없다.
   */
  tokens?: { text: string; effect: ComputedEffect; special?: boolean }[];
  sudo?: boolean;
  statements?: StmtAnalysis[];
  /**
   * **명령 나눠 보기**의 줄들(10-24 — 검토 카드 `CommandLines`) — 셸 명령을 맨 위 단계의 `;` · `&&` · `||` · `&` · 줄바꿈에서 나눈 것
   * (`|` 에서는 나누지 않는다 · heredoc 본문은 연 줄에 붙는다). 맨 위 줄이 **둘 이상**이거나, 한 줄이라도 읽기가 아니거나 `sudo` 표시가
   * 있으면 그 한 줄이 온다(옛 서버 · 그 밖의 읽기 한 줄이면 없다). DB 작업안은 문장마다 한 줄(10-24 — 동사 · 테이블 표시).
   */
  lines?: CommandLine[];
}

/**
 * 명령 나눠 보기의 한 줄 — Rust `analysis` 가 매긴다. **판정은 Rust 한 곳**이다: `over`(AI 가 선언한 효과보다 센가)를 화면이 다시
 * 계산하지 않는다(화면은 옮길 뿐).
 */
export interface CommandLine {
  /** 그 줄의 원문(구분자 빼고) */
  text: string;
  /** 이 줄 **뒤**의 구분자 — 마지막 줄이면 없다. 화면은 `&&` · `||` · `&` 만 흐리게 보이고 `;` · 줄바꿈은 숨긴다 */
  sep?: ";" | "&&" | "||" | "&" | "\n";
  effect: ComputedEffect;
  /** 그 효과를 낸 근거(`openssl` · `find -delete` …) — 읽기면 없다 */
  cause?: string;
  /** `echo` 만 하는 머리 줄(구획 이름) — 흐리게, 표지 없이 */
  quiet?: boolean;
  /** AI 가 선언한 효과보다 세다 — 실패색 띠 + 끝의 표지 */
  over?: boolean;
  /**
   * 이 줄 안에서 효과를 낸 낱말들(프로그램 `rm` · 인자 `-delete` · 연산자 `>` · `$(`)의 자리 — `text` 의 **코드 포인트** 색인
   * [start, end)(`Array.from(text)` 와 같은 자리 · 차례대로 · 겹치지 않음). Rust `line_marks` 가 고른다 — 화면은 칠할 뿐(`markSegments`)
   */
  marks?: CommandLineMark[];
  /**
   * 선언과 무관하게 위험한 줄 — DB 의 바깥 `WHERE` 없는 `UPDATE` · `DELETE` · `DROP` · `TRUNCATE`(Rust `analyze_db`). 화면은 효과와
   * 무관하게 실패색으로 그린다(`over` 와 뜻이 다르다 — 그것은 "AI 선언보다 셈")
   */
  danger?: boolean;
}

/** 줄 안 표시 하나 — `kind: "sudo"` 는 권한 올리기 낱말(`sudo` · `doas` · `pkexec` · `su`): 효과와 무관하게 경고색, 줄 판은 만들지 않는다 */
export interface CommandLineMark {
  start: number;
  end: number;
  effect: ComputedEffect;
  kind?: "sudo";
}

/** DB 작업안의 대상 id 인가(`db:<connId>`) */
export function isDbTarget(id: string): boolean {
  return id.startsWith("db:");
}

/** `list_operations` 응답 — 대기(카드) + 최근(이력). */
export interface OperationList {
  /** 검토 대기(awaitingApproval) — 오래된 것부터(검토 순서) */
  pending: Operation[];
  /** 그 밖(draft·rejected·expired) — 최신순 */
  recent: Operation[];
  /**
   * 세션 서버의 사전 정책 자동 승인이 거부한 사유 — `작업안 id → 한 줄`(③-4 — 자동 승인은 서버가 돈다,
   * `src-tauri/src/server/auto_approve.rs`). GUI 가 없던 동안의 거부도 여기 실려 검토 카드가 사유를 보인다.
   * 옛 서버·실패 응답에는 없다.
   */
  autoRefusals?: Record<string, string>;
  /**
   * **곧 자동 승인될** 대기 id(10-22) — 서버의 다음 훑기가 시도할 집합(`operations/auto.rs` `auto_pending`). 검토 카드 · 배지 · 알림은
   * 이것을 빼고 본다(자동 승인될 작업안이 카드로 번쩍이지 않게). 훑기가 정하면 빠진다. 옛 서버면 없다.
   */
  autoPending?: string[];
  /**
   * 사람을 기다리는 대기가 **왜 자동으로 안 넘어가는가**(10-22) — 훑기가 시도하기 **전에** 걸러지는 이유(자동 승인 꺼짐 · 정책 밖 ·
   * 대상 수 상한). 모양은 설정 › 자동 승인 시험 칸의 이유와 같다(`{code, args}` — 같은 판정 `policy/explain.rs`). 시도 뒤의 거부는
   * `autoRefusals` 가 말한다(둘이 한 작업안에 겹치지 않는다). 옛 서버면 없다.
   */
  autoWhy?: Record<string, { code: string; args: Record<string, string> }>;
}

const EMPTY: OperationList = { pending: [], recent: [] };

/** 대기+최근 작업안을 읽는다. 실패하면 빈 목록(UI 가 계속 그려질 수 있게). */
export async function listOperations(): Promise<OperationList> {
  try {
    return (await invoke<OperationList>("list_operations")) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * 한 작업안의 **대상별 결과**를 읽는다(streamId→결과). 관제판이 열릴 때, 닫혀 있던 새 완료
 * 실행을 되살리는 데 쓴다 — 진행 이벤트는 관제판이 열려 있는 동안만 오기 때문이다.
 * 실패하면 빈 맵(UI 가 계속 그려질 수 있게).
 */
export async function operationResults(operationId: string): Promise<Record<string, TargetResult>> {
  try {
    return (await invoke<Record<string, TargetResult>>("operation_results", { operationId })) ?? {};
  } catch {
    return {};
  }
}

/**
 * [`operationResults`] 와 같되 **못 읽었으면 `null`** 이다 — 빈 맵과 "읽기 실패" 를 가려야 하는
 * 자리(실행 결과 알림: 실패면 상태만 말하는 문구로 물러선다 · `app/operation-notify.svelte.ts`).
 */
export async function operationResultsOrNull(
  operationId: string,
): Promise<Record<string, TargetResult> | null> {
  try {
    return (await invoke<Record<string, TargetResult>>("operation_results", { operationId })) ?? null;
  } catch {
    return null;
  }
}

/** 작업안을 거절한다(→rejected). 갱신된 작업안 또는 `null`(실패). **승인 짝은 없다.** */
export async function rejectOperation(operationId: string): Promise<Operation | null> {
  try {
    return (await invoke<Operation>("reject_operation", { operationId })) ?? null;
  } catch {
    return null;
  }
}

/** 검토 중 대상 목록을 좁힌다(선택 기능). 명령·방식은 못 고친다(Rust 가 강제). */
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

// ---------------------------------------------------------------------------
// 단계 9 — 실행 브로커 (승인·취소). **Tauri 명령 전용** — AI(MCP)는 이 경로에 닿지 못한다.
//
// executor 는 `operationId` 하나만 받아 저장소에서 command·targets 를 읽는다 — 승인에 명령
// 문자열을 다시 넘기지 않는다(AI 재주입 차단 · 보안 불변). 진행/결과는 `operation-progress`·
// `operation-state` 이벤트로 밀려 온다(Console 이 구독).
// ---------------------------------------------------------------------------

/** `approveOperation` 결과 — 성공이면 갱신된 작업안, 실패면 사용자에게 보여 줄 사유. */
export interface ApproveResult {
  /** 승인된 작업안(state=approved). 실패면 `null`. */
  operation: Operation | null;
  /** 거부·오류 사유(Rust `Err` 문자열). 성공이면 `null`. */
  error: string | null;
}

/**
 * 작업안을 **승인하고 실행을 시작한다**. `operationId` 하나만 넘긴다(명령 문자열 없음).
 *
 * 즉시 반환한다 — 실제 실행은 백엔드 executor 태스크가 잇고, 진행은 이벤트로 온다.
 *
 * **오류를 삼키지 않는다**: 단계 10b 권위 게이트가 정책 밖 자동 승인이나 상한 초과를 `Err` 로
 * 거부할 수 있고(예: "자동 승인 정책에 맞지 않아…"), 그걸 `null` 로 뭉개면 화면이 승인된 척
 * 보이는 유령 상태가 된다. 그래서 사유를 [`ApproveResult.error`] 로 올려 호출부가 토스트로
 * 보여 주고 작업안을 원래 상태로 되돌리게 한다. (throw 하지 않아 폴링 루프는 안 끊긴다.)
 *
 * `approvalMethod` 는 감사 로그(단계 10a)가 기록하는 **승인 방식**이다 — 사람이 앱에서 누른
 * 승인은 언제나 `"manual"`, 정책 기반 자동 승인(단계 10b)은 `"auto"`.
 */
export async function approveOperation(
  operationId: string,
  approvalMethod: "manual" | "auto" = "manual",
): Promise<ApproveResult> {
  try {
    const operation = (await invoke<Operation>("approve_operation", { operationId, approvalMethod })) ?? null;
    return { operation, error: null };
  } catch (e) {
    // Tauri 는 Rust `Err(String)` 을 그 문자열 그대로 reject 한다(대개 문자열, 방어적으로 처리).
    const error = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
    return { operation: null, error };
  }
}

/**
 * 실행을 **취소한다**(협력적). 미시작 대상은 막히고 실행 중 대상은 채널이 떨어지지만,
 * 원격에서 이미 시작된 명령은 계속 돌 수 있다(백엔드가 결과 오류분류에 정직히 남긴다).
 */
export async function cancelOperation(operationId: string): Promise<void> {
  try {
    await invoke("cancel_operation", { operationId });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

// ---------------------------------------------------------------------------
// 실행 기록 — 감사 로그를 사람이 읽는 장부로 (docs/log/2026-09-28-run-history.md)
// ---------------------------------------------------------------------------

/** 감사 로그의 대상별 결과 — Rust `AuditTargetResult`(camelCase). 새 칸은 옛 줄에 없다. */
export interface AuditTargetResult {
  streamId: string;
  /** `TargetState` 의 직렬화형(모르는 값이 올 수 있어 문자열로 받는다) */
  state: string;
  exitCode?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  /** 출력 꼬리 — `[automation] audit_output_excerpt` 를 켠 경우 · 공유 중인 대상만 */
  stdoutTail?: string | null;
  stderrTail?: string | null;
}

/** 승인 시점의 대상 이름 스냅샷 — Rust `AuditTargetLabel` */
export interface AuditTargetLabel {
  id: string;
  label: string;
  code: string;
}

/**
 * 실행 한 건 — Rust `AuditRun`(`approved` + `finished` 두 줄을 묶은 것). `state` 가 `null` 이면 끝난
 * 줄이 없다(도는 중이거나 앱이 끝나기 전에 닫혔다).
 */
export interface AuditRun {
  operationId: string;
  command: string;
  title: string | null;
  cwd: string | null;
  validate: string | null;
  /** AI 가 쓴 설명(승인 요약) — 10-22 전의 실행 · 옛 서버면 없다 */
  summary?: string | null;
  /** AI 가 적은 이유(작업안 `reason` — 선택) — 기록 상세가 "요청 배경" 으로 보인다 */
  reason?: string | null;
  /** `targets[0]` 가 canary 다 */
  targets: string[];
  targetLabels: AuditTargetLabel[];
  approvalMethod: string | null;
  /** '모두 승인' 으로 자동 승인됐다(2026-10-23) — 옛 기록 · 옛 백엔드면 없다 */
  approveAll?: boolean;
  approvedAt: number;
  finishedAt: number | null;
  state: string | null;
  results: AuditTargetResult[];
  /** 사람이 끝나기 전에 [취소]를 눌렀는가(감사의 `cancelled` 사용자 줄) — 집계는 `partial` 일 수 있다 */
  cancelledByUser?: boolean;
  cancelledAt?: number | null;
}

/**
 * 실행 기록을 읽는다 — 승인 시각이 `sinceMs` 이후인 실행, 최신순, 최대 `limit` 건.
 * 실패하면 `null`(빈 목록과 "못 읽음" 을 화면이 가른다).
 */
export async function auditRuns(sinceMs: number, limit: number): Promise<AuditRun[] | null> {
  try {
    return (await invoke<AuditRun[]>("audit_runs", { sinceMs: Math.max(0, Math.floor(sinceMs)), limit })) ?? [];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 관제판 복구 판정 — 닫혀 있던 사이 놓친 최종 상태를 목록으로 메운다.
// (docs/log/2026-09-20-console-fixes.md ②)
// ---------------------------------------------------------------------------

/** 더 바뀌지 않는 집계 상태 — 여기 닿으면 대상별 결과도 확정돼 있다. */
const TERMINAL_STATES: ReadonlySet<OperationState> = new Set<OperationState>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);

/**
 * 실행 뷰 하나를 `list_operations` 의 최근 목록과 맞출 때 **무엇을 할지**.
 *
 * - `"keep"` — 같은 상태다. 건드리지 않는다(라이브 이벤트가 최신이다).
 * - `"update"` — 상태만 목록 값으로 갈아 끼운다(아직 도는 중이라 결과는 이벤트가 잇는다).
 * - `"update+refetch"` — 상태를 갈아 끼우고 **대상별 결과를 다시 읽는다**. 끝난 실행인데
 *   뷰가 그걸 모르고 있었다는 뜻이라, 뷰가 쥔 결과 행렬은 대개 낡았다.
 */
export type ExecReconcile = "keep" | "update" | "update+refetch";

/**
 * 뷰의 상태 vs 목록의 상태 — **백엔드(목록)가 권위다**. 순수 함수.
 *
 * 이게 없던 동안 관제판은 "승인됨" 에 멈춘 카드를 영원히 보여 줬다: `operation-state` 는
 * 관제판이 열려 있는 동안만 오는데, 승인 직후 패널을 닫으면 **끝났다는 사건 자체를 놓친다**.
 * 복구 루프는 "뷰가 이미 있으면 건너뛴다" 였으므로 그 뷰는 영영 갱신되지 않았다.
 */
export function reconcileExecState(
  viewState: OperationState,
  listState: OperationState,
): ExecReconcile {
  if (viewState === listState) return "keep";
  return TERMINAL_STATES.has(listState) ? "update+refetch" : "update";
}

/** **실행된 적이 없는** 종결 상태 — 작업안이 검토 단계에서 끝났다. 결과 행렬 자체가 없다. */
const NEVER_RAN: ReadonlySet<OperationState> = new Set<OperationState>(["expired", "rejected"]);

/**
 * **아직 돌지 않은** 검토 단계 — 실행 뷰의 대상이 전혀 아니다(있던 뷰도 건드리지 않는다).
 *
 * 2026-09-22 에 `request_execution` 이 검토 요청 즉시 `operation-state{awaitingApproval}` 을
 * 내보내기 시작했다(docs/log/2026-09-22-review-request-signal.md). 그 전까지 이 상태는
 * 이벤트로 온 적이 없어 `"apply"` 로 떨어졌는데, 그대로 두면 관제판이 **돌지도 않은** 작업안에
 * "(다른 창에서 시작한 실행)" 카드를 세운다 — 만료 때 실제로 본 그 버그와 같은 모양이다.
 */
const NOT_RUN_YET: ReadonlySet<OperationState> = new Set<OperationState>(["awaitingApproval"]);

/**
 * `operation-state` 이벤트 하나를 실행 뷰에 **어떻게 반영할지**.
 *
 * - `"apply"` — 상태를 그 값으로 (뷰가 없으면 만들어서) 쓴다.
 * - `"ignore"` — 아무것도 하지 않는다.
 * - `"drop"` — 있던 실행 뷰를 걷어낸다.
 */
export type ExecEventAction = "apply" | "ignore" | "drop";

/**
 * 만료·거부는 **실행 뷰를 만들지 않는다** — 실행된 적이 없다. 순수 함수.
 *
 * 검토 대기 TTL(docs/log/2026-09-21-approval-ttl.md)이 붙은 뒤 실제로 본 버그다: 대기하던
 * 작업안이 만료되면 `operation-state{state:"expired"}` 가 오는데, 관제판의 이벤트 처리가
 * "뷰가 없으면 만든다" 였으므로 작업안 탭에 **"(다른 창에서 시작한 실행)" · `expired` 배지 ·
 * [지우기]** 카드가 생겼다. 돌지 않은 것의 결과 행렬을 보여 준 셈이다.
 *
 * 뷰가 이미 있는 채로 이 상태가 오는 일은 없어야 하지만(승인된 것은 만료되지 않는다), 오면
 * 걷어낸다 — 결과 없는 카드를 남기느니 치우는 쪽이 맞다.
 *
 * **검토 대기(`awaitingApproval`)는 뷰가 있든 없든 무시한다**([`NOT_RUN_YET`]) — 아직 돌지
 * 않았으니 만들 것도 없고, 실행 뷰가 그 상태로 되돌아가는 전이도 없다(걷어낼 이유가 없다).
 */
export function execEventAction(state: OperationState, hasView: boolean): ExecEventAction {
  if (NOT_RUN_YET.has(state)) return "ignore";
  if (!NEVER_RAN.has(state)) return "apply";
  return hasView ? "drop" : "ignore";
}

// ---------------------------------------------------------------------------
// ② 위험 신호 (자문) — 파괴적으로 보이는 명령에 경고 배지를 켜는 **순수** 판정.
// ---------------------------------------------------------------------------

/**
 * 명령이 **파괴적으로 보이는가** — `"safe"` | `"dangerous"`. **순수 함수**.
 *
 * ⚠️ **이것은 자문일 뿐 보안 경계가 아니다.** 아무것도 막지 않는다 — 검토 UI 가 배지 하나를
 * 켤 뿐이고, 자동 승인 같은 것은 애초에 없다(실행 경로가 없다). 넓게(보수적으로) 잡는다:
 * 오탐(`echo rm` 을 위험으로)이 미탐보다 낫다. 정밀한 정책은 뒤 단계(중앙 감독)의 몫이다.
 *
 * 파괴적 패턴(단어 경계로): `rm`·`rmdir`·`dd`·`mkfs`·`sudo`·`su`·`chmod`·`chown`·`kill`류·
 * `reboot`·`shutdown`·`halt`·`poweroff`·`systemctl (restart|stop)`·리다이렉트 `>`/`>>`·
 * `find … -delete`·`git … reset … --hard`·`truncate`.
 */
export function classifyRisk(command: string): "safe" | "dangerous" {
  return DANGEROUS.some((re) => re.test(command)) ? "dangerous" : "safe";
}

/**
 * 파괴적으로 보이는 패턴들 (위 doc 주석의 목록). 자문용 — 정밀함보다 넓음을 택한다.
 *
 * **`src-tauri/src/policy.rs` 의 `DANGEROUS` 와 케이스가 같아야 한다** — 자동 승인 게이트를
 * Rust 가 이 목록으로 다시 판정하므로, 여기 패턴을 바꾸면 그쪽도 함께 고친다(드리프트 방지).
 */
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
  />>?/, // 리다이렉트 — 덮어쓰기/이어쓰기
  /\bfind\b[^\n]*-delete\b/,
  /\bgit\b[^\n]*\breset\b[^\n]*--hard\b/,
  /\btruncate\b/,
];

// ---------------------------------------------------------------------------
// 검토 대기 만료 — 카드가 "얼마나 남았나" 를 말하는 한 줄 (순수 계산).
// ---------------------------------------------------------------------------

/**
 * `expiresAt` 을 **남은 시간의 열쇠 하나**로 바꾼다 — **순수 함수**.
 *
 * 돌려주는 것은 문구가 아니라 **무엇을 말할지**다(문구는 화면이 `t()` 로 만든다 —
 * 이 모듈은 사전을 몰라도 테스트를 받는다, `status-items.ts` 와 같은 나눔):
 *
 * - `null` — 만료 없음 (`expiresAt` 이 `null`).
 * - `{ minutes: 0 }` — 이미 지났다(다음 읽기에서 Rust 가 만료시킨다).
 * - `{ minutes: n }` — `n` 분 남았다. **올림**이다: 30초 남았는데 "0분" 이라 적으면 아직
 *   승인할 수 있는 카드가 끝난 것처럼 읽힌다.
 */
export function expiryLabel(
  expiresAt: number | null,
  now: number,
): { minutes: number } | null {
  if (expiresAt === null || !Number.isFinite(expiresAt)) return null;
  const left = expiresAt - now;
  if (left <= 0) return { minutes: 0 };
  return { minutes: Math.ceil(left / 60_000) };
}
