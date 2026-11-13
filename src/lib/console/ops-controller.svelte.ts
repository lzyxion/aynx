// 대시보드 작업안 칸의 상태와 손잡이 — 폴링 한 바퀴 · 실행 뷰(진행·집계 이벤트) · 승인(위험 명령의 확인 상태).
// `Console.svelte` 가 옛 상태 자리에서 하나 만들고, `$effect`(폴링·이벤트 구독)는 여기 없고 Console 에 그대로 있다.
// 승인·거절·취소는 Tauri 명령(`$lib/operations`)뿐이다 — MCP 는 여기 닿지 않는다.
import {
  approveOperation,
  cancelOperation,
  execEventAction,
  listOperations,
  operationResults,
  reconcileExecState,
  rejectOperation,
  type Operation,
  type OperationProgress,
  type OperationState,
  type OperationStateEvent,
  type TargetResult,
  type TargetState,
} from "$lib/operations";
import { approvalRisk } from "$lib/review-card";
import { dismissRuns, isRunDismissed } from "$lib/console/dismissed-runs";
import { sortExecs } from "$lib/console/exec-rows";
import { settings } from "$lib/settings.svelte.js";
import type { ConsoleSession } from "$lib/console/delegation-rows";
import { listConsoleSessions } from "$lib/console/sessions";
import { auditStatus, type AuditStatus } from "$lib/context";
import { SvelteSet } from "svelte/reactivity";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import type { ExitSide } from "$lib/dock-alert-exit";

/**
 * Rust 저장소는 별도 스레드(MCP)가 채우므로 반응형이 아니다 — 대시보드이 열려 있는 동안
 * **폴링**한다(2초). `list_sessions` 폴링과 같은 값싼 왕복이다. (폴링을 거는 `$effect` 는 Console 에 있다.)
 */
export const OPERATION_POLL_MS = 2000;

/**
 * 실행/종료 상태 — 결과 행렬이 있는 작업안들(대시보드 복구가 되살릴 대상).
 * `expired`·`rejected` 는 **일부러 없다** — 실행된 적이 없어 되살릴 행렬도 없다.
 */
const EXEC_STATES = new Set<OperationState>([
  "approved",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);

/** 아직 끝나지 않은 실행 — 큰 카드로 서고 [취소]가 있다(완료된 실행은 한 줄로 접히고 지울 수 있다) */
export const EXEC_ACTIVE: ReadonlySet<OperationState> = new Set<OperationState>(["approved", "running"]);

/**
 * 결과 행렬이 낡았는가 — 비었거나 아직 끝나지 않은 칸이 남아 있으면 다시 읽을 값이 있다.
 * (집계는 끝났는데 칸이 대기/실행중이면 놓친 진행 이벤트가 있다는 뜻이다.)
 */
function staleTargets(targets: Record<string, TargetResult>): boolean {
  const rows = Object.values(targets);
  return rows.length === 0 || rows.some((r) => r.state === "pending" || r.state === "running");
}

const pendingResult = (): TargetResult => ({
  state: "pending",
  exitCode: null,
  stdout: "",
  stderr: "",
  startedAt: null,
  endedAt: null,
  errorClass: null,
});

/** 한 실행의 뷰 — 승인 때 잡은 작업안 + 집계 상태 + 대상별 결과(streamId→결과) */
export interface ExecView {
  op: Operation | null;
  state: OperationState;
  targets: Record<string, TargetResult>;
}

/** 대상 상태 → 사람이 읽는 문구 키(결과 행렬 배지) */
export const TARGET_LABEL: Record<TargetState, Key> = {
  pending: "board.target.pending",
  running: "board.target.running",
  succeeded: "board.target.succeeded",
  failed: "board.target.failed",
  timedOut: "board.target.timedOut",
  cancelled: "board.target.cancelled",
  unknown: "board.target.unknown",
};

/**
 * **작업안·실행 관리(execution plan)** — 단계 8 등록·검토 + 단계 9 실행
 * (docs/log/2026-09-10-execution-plans.md · docs/log/2026-09-10-execution-broker.md).
 *
 * AI(MCP)가 저장한 작업안을 명령문·대상·방식과 ② 위험 신호(자문 배지)와 함께 보여 준다.
 * **단계 8** 에서는 사람이 할 수 있는 것이 **거절**뿐이었다(실행 경로가 앱에 없던 것이 그
 * 단계의 존재 이유). **단계 9** 에서 실행이 붙어 지금은 **승인·실행·취소**도 여기서 한다 —
 * 단, 승인/실행은 MCP 가 아니라 **Tauri 명령**이다(AI 가 스스로 실행을 트리거하지 못하게).
 *
 * ## `$effect` 는 여기 없다
 *
 * 룬 모듈에는 효과를 붙일 컴포넌트 수명이 없다(`browser/selection-controller.svelte.ts` 와 같은 규칙).
 * 폴링·이벤트 구독·`setHumanConfirming` 은 Console 이 제 자리에서 `refresh`·`onProgress`·`onOpState`
 * 를 부른다 — 효과의 순서와 수명(열린 동안만)이 나누기 전과 같다.
 */
export class OpsController {
  /**
   * 지우기(×  · 머리줄 🗑)를 마지막으로 누른 시각 — 그 직후에 빠지는 줄만 밀려 나간다(`row-exit.ts` 의 문 · 2026-11-13). 아무도 그리지 않아
   * `$state` 가 아니다. `exitSide` 는 감싸는 독이 붙은 쪽(`PlansView` 가 채운다).
   */
  lastDismissAt = 0;
  exitSide: ExitSide = "right";

  /** 끝난(치울 수 있는) 실행 수 — 머리줄 🗑 가 켜질지 본다 */
  get finishedCount(): number {
    return this.execList.filter((ex) => !EXEC_ACTIVE.has(ex.state)).length;
  }

  operations = $state<Operation[]>([]);

  /** 검토 대기 개수 — 세그먼트/헤더 배지와 빈 상태 판정에 쓴다 */
  pendingCount = $derived(this.operations.length);

  // -------------------------------------------------------------------------
  // **세션 칸의 재료** — `list_console_sessions`(앱 전역 세션 뷰 — AI 에게 보이는 창 세션 + 헤드리스 위임
  // 세션 + 아직 안 붙은 위임)이고 **폴링**으로 온다. 폴링은 작업안 폴링과 **같은 2초 왕복**에 얹는다
  // (`refresh`) — 실행 중 작업안(대상·명령)도 그 폴링이 채운다. 묶기는 Console 의 `groupSessions`.
  // -------------------------------------------------------------------------
  consoleSessions = $state<ConsoleSession[]>([]);
  /** 지금 실행 중(running·approved) 작업안의 대상 id 집합 — 헤드리스 줄의 "작업중" 판정 */
  runningTargets = $state<Set<string>>(new Set());
  /** 그 대상 → 도는 작업안의 명령문 — 작업중 줄이 lastCommand 대신 이걸 보여 준다 */
  commandByTarget = $state<Map<string, string>>(new Map());

  /** 감사 로거 상태(백로그 #8) — 대시보드 아래 한 줄로 "감사가 도는지" 를 보인다. */
  audit = $state<AuditStatus | null>(null);

  /**
   * 폴링이 한 바퀴 끝날 때마다 한 칸 — 딥링크가 "목록을 한 번 받아 본 뒤에도 그 실행이 메모리에
   * 없는가" 를 가를 때 쓴다(없으면 기록 보기로 넘긴다 · docs/log/2026-09-28-run-history.md).
   */
  refreshSeq = $state(0);

  // -------------------------------------------------------------------------
  // **긴 명령문은 발췌로 보인다** (docs/log/2026-09-20-console-fixes.md ①).
  //
  // AI 가 만든 작업안은 base64 로 감싼 스크립트 한 덩어리일 수 있다(실측 13 KB). 그걸
  // 통째로 찍던 자리가 셋이었고, `title` 툴팁마저 같은 13 KB 라 마우스만 올려도 화면이
  // 덮였다. 이제 순수 계산(`command-preview.ts`)의 발췌를 찍고, 잘린 카드에만 "전체 보기"
  // 를 내준다. 펴도 **상자 안에서만** 늘어난다(`.cmdbox` 가 240px 에서 자체 스크롤).
  //
  // 펼친 작업안 id 집합 — 창마다 하나뿐인 표시 상태라 여기 둔다(대시보드을 다시 만들면 접힌다 —
  // 보기를 오가도 남도록 목록 컴포넌트가 아니라 컨트롤러가 쥔다).
  // -------------------------------------------------------------------------
  readonly expandedCmds = new SvelteSet<string>();

  toggleCmd(operationId: string): void {
    if (this.expandedCmds.has(operationId)) this.expandedCmds.delete(operationId);
    else this.expandedCmds.add(operationId);
  }

  /**
   * 펼친 **완료된** 실행 — 완료된 실행은 한 줄(제목 · 상태 · 시각)로 접혀 있고 누르면 그 자리에서 펼친다(2026-10-27 목업
   * A안 EN7xk2SJqU5HqaJXgGYKoz). 도는 · 승인된 실행은 늘 큰 카드다.
   */
  readonly expandedExecs = new SvelteSet<string>();

  toggleExec(operationId: string): void {
    if (this.expandedExecs.has(operationId)) this.expandedExecs.delete(operationId);
    else this.expandedExecs.add(operationId);
  }

  async refresh(): Promise<void> {
    const list = await listOperations();
    this.operations = list.pending; // 카드는 대기만. 최근(이력)은 이 MVP 에선 접어 둔다.

    // 위임 로스터(A3b-1) — 앱 전역 세션 뷰를 같은 왕복에 읽는다(값싸다). 실패하면 빈 목록.
    this.consoleSessions = await listConsoleSessions();

    // 실행 중 작업안 → 위임 행의 "작업중" 판정용 집합·명령 맵. running·approved 는 승인 뒤
    // 대기(pending)에서 빠져 recent 로 가므로 둘을 함께 훑는다(방어적으로 넓게).
    const targets = new Set<string>();
    const cmdMap = new Map<string, string>();
    for (const op of [...list.pending, ...list.recent]) {
      if (op.state !== "running" && op.state !== "approved") continue;
      for (const t of op.targets) {
        targets.add(t);
        cmdMap.set(t, op.command);
      }
    }
    this.runningTargets = targets;
    this.commandByTarget = cmdMap;

    // 대시보드 복구 — 닫혀 있던 사이 **시작되거나 끝난** 실행을 목록으로 메운다. 진행·상태
    // 이벤트는 대시보드이 열려 있는 동안만 오므로, recent 의 실행/종료 작업안을 뷰와 맞춘다.
    //
    // 앞선 판은 "뷰가 이미 있으면 건너뛴다" 였고, 그것이 **끝난 실행이 영원히 '승인됨' 으로
    // 남는** 버그였다: 승인 직후 패널을 닫으면 최종 `operation-state` 를 놓치는데, 다시 열어도
    // 그 뷰는 이미 있으므로 아무도 고쳐 주지 않았다. 이제 **백엔드가 권위다** — 상태가
    // 어긋나면 목록 값으로 갈아 끼우고, 끝난 상태인데 결과 행렬이 낡았으면 다시 읽는다
    // (docs/log/2026-09-20-console-fixes.md ②).
    for (const op of list.recent) {
      if (!EXEC_STATES.has(op.state)) continue;
      if (isRunDismissed(op.operationId)) continue; // 사람이 치운 실행은 되살리지 않는다(`dismissed-runs`)
      const view = this.executions[op.operationId];
      if (!view) {
        const targets = await operationResults(op.operationId);
        this.executions = { ...this.executions, [op.operationId]: { op, state: op.state, targets } };
        continue;
      }
      const decision = reconcileExecState(view.state, op.state);
      if (decision === "keep") {
        // 상태는 맞아도 `op` 가 비었으면 채운다 — 대시보드 밖(검토 카드 팝업)에서 승인한 실행은 이벤트가 먼저
        // `op: null` 뷰를 만들고 상태까지 맞춰 두어, 여기서 건너뛰면 "(다른 창에서 시작한 실행)" 으로 영영 남았다
        // (docs/log/2026-09-30-dashboard-popup-approved-label.md).
        if (view.op === null) {
          this.executions = { ...this.executions, [op.operationId]: { ...view, op } };
        }
        continue;
      }
      const targets =
        decision === "update+refetch" && staleTargets(view.targets)
          ? await operationResults(op.operationId)
          : view.targets;
      // `op` 도 채운다 — 다른 창이 시작한 실행은 상세 없이 행렬만 그리고 있었다.
      this.executions = {
        ...this.executions,
        [op.operationId]: { op: view.op ?? op, state: op.state, targets },
      };
    }

    // 감사 상태(백로그 #8) — 대시보드이 "감사가 실제로 도는지" 를 보이게. 폴링마다 갱신(원자 로드라 값싸다).
    this.audit = await auditStatus();
    this.refreshSeq += 1;
  }

  /** 거절 — 즉시 목록에서 지우고(낙관적) 서버에 알린 뒤 다시 읽어 확정한다 */
  async reject(operationId: string): Promise<void> {
    this.operations = this.operations.filter((op) => op.operationId !== operationId);
    await rejectOperation(operationId);
    await this.refresh();
  }

  // -------------------------------------------------------------------------
  // **실행 브로커(단계 9)** — 승인·진행·취소. 승인·취소는 Tauri 명령이고 AI 는 닿지 못한다.
  // (docs/log/2026-09-10-execution-broker.md)
  //
  // 승인하면 작업안은 대기(pending)에서 빠지고 **실행 뷰**로 옮겨 간다. 진행/집계는
  // `operation-progress`·`operation-state` 이벤트로 밀려 와 대상별 **결과 행렬**을 그린다.
  // 이벤트는 app 전역이라 어느 창에서 승인해도 여기 보인다(다른 창이 시작한 실행은 op 상세가
  // 없어 행렬만 그린다). 구독은 Console 의 `$effect`(열려 있는 동안만)가 건다.
  // -------------------------------------------------------------------------
  executions = $state<Record<string, ExecView>>({});

  /**
   * 실행 뷰 배열 — 실행 · 승인 중을 늘 위에, 그 안팎은 설정의 정렬(`[plans] exec_sort` — 최근 먼저 기본 · 오래된 먼저)로.
   * 시각은 줄에 보이는 시각과 같은 값(`requestedAt ?? createdAt` — 작업안에 승인 · 시작 시각 칸은 없다). 상세가 없는 실행(다른 창이
   * 시작한 것)은 시각을 몰라 제 묶음의 끝에 들어온 차례로 선다(`sortExecs`).
   */
  execList = $derived.by<Array<{ id: string } & ExecView>>(() =>
    sortExecs(
      Object.entries(this.executions).map(([id, v]) => ({ id, ...v })),
      settings.execSort,
      (ex) => (ex.op ? (ex.op.requestedAt ?? ex.op.createdAt) : null),
      (ex) => EXEC_ACTIVE.has(ex.state),
    ),
  );

  onProgress(p: OperationProgress): void {
    if (isRunDismissed(p.operationId)) return;
    const v = this.executions[p.operationId] ?? { op: null, state: "running", targets: {} };
    this.executions = {
      ...this.executions,
      [p.operationId]: { ...v, targets: { ...v.targets, [p.streamId]: p.result } },
    };
  }

  onOpState(e: OperationStateEvent): void {
    // 만료·거부는 실행 뷰를 만들지 않는다 — 실행된 적이 없다(`execEventAction` 의 주석).
    if (isRunDismissed(e.operationId)) return;
    const action = execEventAction(e.state, e.operationId in this.executions);
    if (action === "ignore") return;
    if (action === "drop") {
      this.dropExecution(e.operationId);
      return;
    }
    const v = this.executions[e.operationId] ?? { op: null, state: e.state, targets: {} };
    this.executions = { ...this.executions, [e.operationId]: { ...v, state: e.state } };
  }

  // ── 승인 — 카드에서 바로(2026-10-27 목업 6zsCHiT4b3RcSwZaGFkiwE · 검토 카드 `ReviewCard` 와 같은 판정 `approveStep`) ──
  // 안전 명령 = [실행 승인] 한 번. 위험 명령 = 첫 누름이 **확인 상태**(경고 한 줄 + [확인했습니다 — 실행])이고 둘째가 승인.
  // 예전의 확인 패널(`PlanConfirm` — 대상 · canary · 방식 다시 보이기 + 승인하면서 자동 승인에 추가)은 걷었다: 카드 메타 줄과 같은
  // 말을 되풀이했고, AI 명령은 대개 파이프 · 리다이렉트가 섞여 "추가" 가 서는 일이 드물었다(허용 목록은 설정 › 자동 승인에서).
  /** 확인 상태인 위험 카드의 operationId — 자동 승인이 이 카드를 가로채지 않게 `setHumanConfirming` 에도 알린다 */
  confirming = $state<string | null>(null);

  /**
   * **주 동작 하나** — 채운 강조(`.btn-primary`)를 입는 [실행 승인] 은 화면에 하나뿐이다: 확인 상태인 카드가
   * 없을 때 목록 맨 위의 **위험하지 않은** 작업안. 위험 카드가 확인 상태면 그 [확인했습니다 — 실행] 이 주 동작이라
   * 나머지는 회색으로 물러난다. 위험 명령은 강조를 입지 않는다. (표시만 가른다 — 승인 논리는 그대로다.)
   */
  primaryOpId = $derived.by<string | null>(() => {
    if (this.confirming !== null) return null;
    return this.operations.find((o) => approvalRisk(o) !== "dangerous")?.operationId ?? null;
  });

  /** 위험 카드를 확인 상태로(다른 카드의 확인 상태는 푼다) */
  arm(operationId: string): void {
    this.confirming = operationId;
  }

  /** 승인 확정 — 낙관적으로 대기에서 빼고 실행 뷰를 연 뒤 서버에 승인 요청 */
  async doApprove(op: Operation): Promise<void> {
    this.confirming = null;
    const targets: Record<string, TargetResult> = {};
    for (const t of op.targets) targets[t] = pendingResult();
    this.executions = { ...this.executions, [op.operationId]: { op, state: "approved", targets } };
    this.operations = this.operations.filter((o) => o.operationId !== op.operationId);
    const r = await approveOperation(op.operationId, "manual");
    if (r.error) {
      // 승인이 거부됐다(상한 초과 등). 낙관적 실행 뷰를 걷고 사유를 알린다 — 승인된 척(유령)
      // 남기지 않는다. 작업안은 실제 상태(awaitingApproval)라 다음 폴링에 카드로 되돌아온다.
      this.dropExecution(op.operationId);
      showNotice(t("board.notice.rejected", { reason: r.error }));
    }
    await this.refresh();
  }

  /** 실행 뷰 하나를 걷어낸다(승인 거부·오류로 낙관적 표시를 되돌릴 때). */
  dropExecution(operationId: string): void {
    const next = { ...this.executions };
    delete next[operationId];
    this.executions = next;
  }

  /** 실행 중 취소(협력적) */
  async cancelExec(operationId: string): Promise<void> {
    await cancelOperation(operationId);
  }

  /**
   * 끝난 실행 뷰를 화면에서 치운다(로컬 표시만 — 서버 상태 · 기록은 그대로). 치운 id 를 남겨 다음 폴링이 서버의 최근
   * 목록에서 되살리지 않게 한다 — 남기지 않으면 2초 뒤 같은 카드가 돌아온다(`dismissed-runs`).
   */
  dismissExec(operationId: string): void {
    this.#dismiss([operationId]);
  }

  /** 완료된 실행을 모두 치운다(도는 · 승인된 실행은 남는다) */
  dismissFinished(): void {
    this.#dismiss(this.execList.filter((ex) => !EXEC_ACTIVE.has(ex.state)).map((ex) => ex.id));
  }

  #dismiss(operationIds: readonly string[]): void {
    if (operationIds.length === 0) return;
    this.lastDismissAt = Date.now();
    dismissRuns(operationIds);
    const next = { ...this.executions };
    for (const id of operationIds) {
      delete next[id];
      this.expandedExecs.delete(id);
    }
    this.executions = next;
  }
}
