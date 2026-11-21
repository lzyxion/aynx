// 작업안 칸의 상태와 손잡이 — `$effect`(폴링 · 이벤트 구독 · `setHumanConfirming`)는 여기 없고 `PlansView.svelte` 에 있다.
// 승인 · 거절 · 취소는 Tauri 명령(`$lib/operations`)뿐이다 — MCP 는 여기 닿지 않는다(AI 가 스스로 실행을 트리거하지 못하게).
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

/** Rust 저장소는 별도 스레드(MCP)가 채워 반응형이 아니다 — 폴링한다 */
export const OPERATION_POLL_MS = 2000;

/** 복구가 되살릴 대상 — `expired` · `rejected` 는 일부러 없다(실행된 적이 없어 되살릴 행렬도 없다) */
const EXEC_STATES = new Set<OperationState>([
  "approved",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);

export const EXEC_ACTIVE: ReadonlySet<OperationState> = new Set<OperationState>(["approved", "running"]);

/** 집계는 끝났는데 칸이 대기 · 실행중이면 놓친 진행 이벤트가 있다 — 다시 읽는다 */
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

export interface ExecView {
  op: Operation | null;
  state: OperationState;
  targets: Record<string, TargetResult>;
}

export const TARGET_LABEL: Record<TargetState, Key> = {
  pending: "board.target.pending",
  running: "board.target.running",
  succeeded: "board.target.succeeded",
  failed: "board.target.failed",
  timedOut: "board.target.timedOut",
  cancelled: "board.target.cancelled",
  unknown: "board.target.unknown",
};

export class OpsController {
  /** 지우기 직후에 빠지는 줄만 밀려 나간다(`row-exit.ts` 의 문) — 아무도 그리지 않아 `$state` 가 아니다 */
  lastDismissAt = 0;
  exitSide: ExitSide = "right";

  get finishedCount(): number {
    return this.execList.filter((ex) => !EXEC_ACTIVE.has(ex.state)).length;
  }

  operations = $state<Operation[]>([]);

  pendingCount = $derived(this.operations.length);

  // ── 세션 칸의 재료 — `list_console_sessions` 를 작업안 폴링과 같은 왕복에 읽는다 ──
  consoleSessions = $state<ConsoleSession[]>([]);
  runningTargets = $state<Set<string>>(new Set());
  commandByTarget = $state<Map<string, string>>(new Map());

  audit = $state<AuditStatus | null>(null);

  /** 딥링크가 "목록을 한 번 받아 본 뒤에도 그 실행이 메모리에 없는가" 를 가를 때 쓴다(없으면 기록 보기로) */
  refreshSeq = $state(0);

  // 펼친 작업안 id — 보기를 오가도 남도록 목록 컴포넌트가 아니라 컨트롤러가 쥔다
  readonly expandedCmds = new SvelteSet<string>();

  toggleCmd(operationId: string): void {
    if (this.expandedCmds.has(operationId)) this.expandedCmds.delete(operationId);
    else this.expandedCmds.add(operationId);
  }

  readonly expandedExecs = new SvelteSet<string>();

  toggleExec(operationId: string): void {
    if (this.expandedExecs.has(operationId)) this.expandedExecs.delete(operationId);
    else this.expandedExecs.add(operationId);
  }

  async refresh(): Promise<void> {
    const list = await listOperations();
    this.operations = list.pending;

    this.consoleSessions = await listConsoleSessions();

    // running · approved 는 승인 뒤 recent 로 가므로 둘을 함께 훑는다
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

    // 복구 — 진행 · 상태 이벤트는 보기가 열려 있는 동안만 온다. 백엔드가 권위다: 뷰가 이미 있어도 상태가 어긋나면 갈아 끼우고,
    // 끝난 상태인데 결과 행렬이 낡았으면 다시 읽는다(건너뛰면 끝난 실행이 영원히 '승인됨' 으로 남는다).
    for (const op of list.recent) {
      if (!EXEC_STATES.has(op.state)) continue;
      if (isRunDismissed(op.operationId)) continue;
      const view = this.executions[op.operationId];
      if (!view) {
        const targets = await operationResults(op.operationId);
        this.executions = { ...this.executions, [op.operationId]: { op, state: op.state, targets } };
        continue;
      }
      const decision = reconcileExecState(view.state, op.state);
      if (decision === "keep") {
        // 상태는 맞아도 `op` 가 비었으면 채운다 — 이벤트가 먼저 `op: null` 뷰를 만든 실행이 "다른 창에서 시작한 실행" 으로 남지 않게
        if (view.op === null) {
          this.executions = { ...this.executions, [op.operationId]: { ...view, op } };
        }
        continue;
      }
      const targets =
        decision === "update+refetch" && staleTargets(view.targets)
          ? await operationResults(op.operationId)
          : view.targets;
      this.executions = {
        ...this.executions,
        [op.operationId]: { op: view.op ?? op, state: op.state, targets },
      };
    }

    this.audit = await auditStatus();
    this.refreshSeq += 1;
  }

  async reject(operationId: string): Promise<void> {
    this.operations = this.operations.filter((op) => op.operationId !== operationId);
    await rejectOperation(operationId);
    await this.refresh();
  }

  // ── 실행 — 승인 · 진행 · 취소 ── 이벤트는 앱 전역이라 다른 창이 시작한 실행은 op 상세 없이 행렬만 그린다
  executions = $state<Record<string, ExecView>>({});

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

  // ── 승인 ── 검토 카드 `ReviewCard` 와 같은 판정(`approveStep`) — 위험 명령은 첫 누름이 확인 상태, 둘째가 승인
  /** 자동 승인이 이 카드를 가로채지 않게 `setHumanConfirming` 에도 알린다(`PlansView`) */
  confirming = $state<string | null>(null);

  /** 채운 강조를 입는 [실행 승인] 은 화면에 하나뿐이고 위험 명령은 입지 않는다 — 표시만 가른다(승인 논리는 그대로) */
  primaryOpId = $derived.by<string | null>(() => {
    if (this.confirming !== null) return null;
    return this.operations.find((o) => approvalRisk(o) !== "dangerous")?.operationId ?? null;
  });

  arm(operationId: string): void {
    this.confirming = operationId;
  }

  async doApprove(op: Operation): Promise<void> {
    this.confirming = null;
    const targets: Record<string, TargetResult> = {};
    for (const t of op.targets) targets[t] = pendingResult();
    this.executions = { ...this.executions, [op.operationId]: { op, state: "approved", targets } };
    this.operations = this.operations.filter((o) => o.operationId !== op.operationId);
    const r = await approveOperation(op.operationId, "manual");
    if (r.error) {
      // 승인된 척(유령) 남기지 않는다 — 작업안은 실제 상태라 다음 폴링에 카드로 되돌아온다
      this.dropExecution(op.operationId);
      showNotice(t("board.notice.rejected", { reason: r.error }));
    }
    await this.refresh();
  }

  dropExecution(operationId: string): void {
    const next = { ...this.executions };
    delete next[operationId];
    this.executions = next;
  }

  /** 협력적 취소 */
  async cancelExec(operationId: string): Promise<void> {
    await cancelOperation(operationId);
  }

  /** 로컬 표시만 치운다(서버 상태 · 기록은 그대로) — id 를 남겨야 다음 폴링이 되살리지 않는다(`dismissed-runs`) */
  dismissExec(operationId: string): void {
    this.#dismiss([operationId]);
  }

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
