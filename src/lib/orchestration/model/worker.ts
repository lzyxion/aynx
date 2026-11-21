import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { AttemptKind, AttemptState, AttemptView, CommitRejectionView, ExecModeFields, LeftoverView, RunDetail, RunState, TranscriptWatchView, TurnArgsView, WorkerActivity, WorkerCommitView } from "./types";

const COMMIT_REJECTION_HINT: Record<string, Key> = {
  "filters-configured": "orch.commitRejected.hint.filters-configured",
  "no-git-identity": "orch.commitRejected.hint.no-git-identity",
  "worktree-mismatch": "orch.commitRejected.hint.worktree-mismatch",
  "commit-failed": "orch.commitRejected.hint.commit-failed",
};

/** 사람 필요 사유만 — 나머지는 작업자가 스스로 고친다 */
export function commitRejectionHint(r: Pick<CommitRejectionView, "reason" | "needsHuman">): Key | null {
  return r.needsHuman ? (COMMIT_REJECTION_HINT[r.reason] ?? "orch.commitRejected.hint.other") : null;
}

export type ActivityWarning = "conversation-changed" | "lagging";

export interface ActivityLine {
  lastText: string | null;
  tools: { name: string; summary: string; pending: boolean }[];
  changedCount: number | null;
  changedMore: boolean;
  warnings: ActivityWarning[];
  canView: boolean;
  status: string | null;
}

export function activityLine(
  a: Pick<AttemptView, "id" | "state" | "conversationChanged" | "conversationId"> & ExecModeFields,
  act: WorkerActivity | null | undefined,
  watch: TranscriptWatchView | null | undefined,
): ActivityLine | null {
  if (!attemptOpen(a)) return null;
  const warnings: ActivityWarning[] = [];
  if (a.conversationChanged || act?.conversationChanged) warnings.push("conversation-changed");
  if (watch?.lagging || act?.lagging) warnings.push("lagging");
  const status = act?.status ?? watch?.status ?? (a.conversationId ? "pending" : "no-conversation");
  return {
    lastText: act?.recent?.lastText ?? null,
    tools: (act?.recent?.tools ?? []).slice(-3),
    changedCount: typeof act?.changedCount === "number" ? act.changedCount : null,
    changedMore: act?.changedTruncated === true,
    warnings,
    canView: status === "ok",
    status: status === "ok" ? null : status,
  };
}

export const ACTIVITY_WARN_KEY: Record<ActivityWarning, { label: Key; title: Key }> = {
  "conversation-changed": {
    label: "orch.activity.warn.conversation-changed",
    title: "orch.activity.warn.conversation-changed.title",
  },
  lagging: { label: "orch.activity.warn.lagging", title: "orch.activity.warn.lagging.title" },
};

export function activityStatusKey(status: string): Key {
  switch (status) {
    case "pending":
      return "orch.activity.status.pending";
    case "no-conversation":
      return "orch.activity.status.no-conversation";
    case "cwd-mismatch":
      return "orch.activity.status.cwd-mismatch";
    case "outside-cli-dir":
      return "orch.activity.status.outside-cli-dir";
    default:
      return "orch.activity.status.unreadable";
  }
}

/** 보일 때만 묻는다 — 폭주 금지 */
export function wantsActivity(run: Pick<RunDetail, "attempts" | "state">): boolean {
  if (run.state === "orphaned") return false;
  return (run.attempts ?? []).some((a) => attemptOpen(a));
}

export const ATTEMPT_STATE_KEY: Record<AttemptState, Key> = {
  spawning: "orch.attempt.state.spawning",
  starting: "orch.attempt.state.starting",
  ready: "orch.attempt.state.ready",
  working: "orch.attempt.state.working",
  "awaiting-human": "orch.attempt.state.awaiting-human",
  "needs-recovery": "orch.attempt.state.needs-recovery",
  running: "orch.attempt.state.running",
  idle: "orch.attempt.state.idle",
  reported: "orch.attempt.state.reported",
  exited: "orch.attempt.state.exited",
  stopping: "orch.attempt.state.stopping",
  stopped: "orch.attempt.state.stopped",
  "stop-unconfirmed": "orch.attempt.state.stop-unconfirmed",
  "exit-unconfirmed": "orch.attempt.state.exit-unconfirmed",
};

// ── Attempt 술어 ──
// 서버 `model.rs` 의 술어와 같은 판정 — 단추 · 강조에만 쓴다(서버가 다시 판정한다).

/** 서버 `exec_mode` 와 같은 판정 — 아니면 옛 PTY 작업자 */
export function isHeadless(a: ExecModeFields): boolean {
  return !!a.kind || (a.turns?.length ?? 0) > 0 || (a.role === "reviewer" && !a.stream);
}

export function turnMayLive(a: Pick<AttemptView, "state"> & ExecModeFields): boolean {
  if (!isHeadless(a)) return a.state !== "exited" && a.state !== "stopped";
  return !(a.state === "idle" || a.state === "reported" || a.state === "exited" || a.state === "stopped");
}

export function attemptClosed(a: Pick<AttemptView, "state">): boolean {
  return a.state === "reported" || a.state === "stopped" || a.state === "exited";
}

export function attemptOpen(a: Pick<AttemptView, "state"> & ExecModeFields): boolean {
  return !attemptClosed(a) || turnMayLive(a);
}

export function attemptNeedsHuman(a: Pick<AttemptView, "state" | "blocked" | "conversationBroken">): boolean {
  return (
    a.state === "stop-unconfirmed" ||
    a.state === "exit-unconfirmed" ||
    a.state === "awaiting-human" ||
    a.state === "needs-recovery" ||
    (a.state === "idle" && !!a.blocked) ||
    (a.conversationBroken === true && !attemptClosed(a))
  );
}

/** 종료 미확인 둘만 — 옛 파일의 다른 낱말은 보이지 않는다 */
export function attentionKey(a: Pick<AttemptView, "state" | "attention">): Key | null {
  if (a.state === "stop-unconfirmed") return "orch.attention.stop-unconfirmed";
  if (a.state === "exit-unconfirmed") return "orch.attention.exit-unconfirmed";
  return null;
}

// ── 헤드리스 작업자 줄 ──

export const KIND_KEY: Record<AttemptKind, Key> = {
  write: "orch.kind.write",
  judge: "orch.kind.judge",
};

/** 서버 `turn::turn_outcome` 낱말 + `running` */
export const TURN_OUTCOME_KEY: Record<string, Key> = {
  running: "orch.turn.outcome.running",
  ok: "orch.turn.outcome.ok",
  failed: "orch.turn.outcome.failed",
  timeout: "orch.turn.outcome.timeout",
  stopped: "orch.turn.outcome.stopped",
  "stop-unconfirmed": "orch.turn.outcome.stop-unconfirmed",
};

/** 서버 `turn::Grade` */
export const GRADE_KEY: Record<string, Key> = {
  edit: "orch.grade.edit",
  full: "orch.grade.full",
  "read-only": "orch.grade.read-only",
};

export interface WorkerLine {
  roleName: string | null;
  /** 옛 파일은 역할로 짐작 — 검토자 = judge */
  kind: AttemptKind;
  cli: string;
  headless: boolean;
  turnNo: number;
  turnRunning: boolean;
  /** 끝난 턴도 그 턴의 것을 보인다 */
  lastTool: string | null;
  denials: number;
  args: string | null;
  model: string | null;
  /** 도는 턴이면 그 턴, 아니면 Attempt 전체 — idle 은 마지막 턴 끝까지(쉬는 시간은 세지 않는다) */
  elapsedMs: number;
}

/** 프롬프트 · 지침 · 토큰 · 경로는 서버가 싣지 않는다 */
export function turnArgsSummary(args: TurnArgsView | null | undefined, tr: Tr): string | null {
  if (!args) return null;
  const parts = [tr("orch.turn.args.grade", { grade: keyText(GRADE_KEY, args.grade, tr) })];
  if (args.settingsControl) parts.push(args.settingsControl);
  const rules = args.allowedRules?.length ?? 0;
  if (rules > 0) parts.push(tr("orch.turn.args.rules", { n: rules }));
  if (args.sandbox) parts.push(tr("orch.turn.args.sandbox", { sandbox: args.sandbox }));
  if (args.effort) parts.push(args.effort);
  if (args.resume) parts.push(tr("orch.turn.args.resume"));
  return parts.join(" · ");
}

export function workerLine(a: AttemptView, now: number, tr: Tr): WorkerLine {
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const running = last?.outcome === "running";
  const kind: AttemptKind = a.kind === "judge" || a.kind === "write" ? a.kind : a.role === "reviewer" ? "judge" : "write";
  const roleName = a.roleName?.trim() || (a.role === "reviewer" ? tr("orch.attempt.role.reviewer") : null);
  const endAt = a.endedAt ?? (typeof last?.endedAt === "number" ? last.endedAt : now);
  const elapsedMs = running && last ? now - last.startedAt : endAt - a.startedAt;
  return {
    roleName,
    kind,
    cli: a.cli,
    headless: isHeadless(a),
    turnNo: last?.n ?? 0,
    turnRunning: running,
    lastTool: last?.lastTool ?? null,
    denials: last?.denials ?? 0,
    args: turnArgsSummary(last?.args, tr),
    model: last?.model ?? last?.args?.model ?? null,
    elapsedMs: Math.max(0, elapsedMs),
  };
}

export interface TurnRow {
  n: number;
  outcome: string;
  text: string;
  durationMs: number | null;
  tools: number;
  denials: number;
  denialKinds: string[];
  bad: boolean;
}

export function turnRows(a: Pick<AttemptView, "turns">, tr: Tr): TurnRow[] {
  return [...(a.turns ?? [])].reverse().map((t) => {
    const base = keyText(TURN_OUTCOME_KEY, t.outcome, tr);
    return {
      n: t.n,
      outcome: t.outcome,
      text: t.reason ? `${base} · ${t.reason}` : base,
      durationMs: typeof t.endedAt === "number" ? Math.max(0, t.endedAt - t.startedAt) : null,
      tools: t.tools ?? 0,
      denials: t.denials ?? 0,
      denialKinds: t.denialKinds ?? [],
      bad: t.outcome !== "ok" && t.outcome !== "running",
    };
  });
}

export function attemptBand(
  a: Pick<AttemptView, "state" | "blocked" | "conversationBroken">,
): { blocked: { need: string; at: number } | null; broken: boolean } | null {
  const blocked = a.state === "idle" && a.blocked ? a.blocked : null;
  const broken = a.conversationBroken === true && !attemptClosed(a);
  return blocked || broken ? { blocked, broken } : null;
}

export function attemptCommits(run: Pick<RunDetail, "commits">, attemptId: string): WorkerCommitView[] {
  return (run.commits ?? []).filter((c) => c.attemptId === attemptId);
}

/**
 * [worktree 지우기] 는 서버가 다시 판정한다(그 Run 이 만든 것 · 미커밋 없음 · 병합 안 된 브랜치 거절).
 * orphaned 는 영속 상태가 옛 서버의 마지막 기록이라 믿지 않고, 서버가 OS 에 물은 `leftovers` 의 `processAlive` 로 가른다.
 */
export function attemptActions(
  a: Pick<AttemptView, "id" | "state" | "worktree"> & ExecModeFields,
  run: RunState,
  leftovers?: readonly Pick<LeftoverView, "attemptId" | "processAlive">[],
): { stop: boolean; removeWorktree: boolean } {
  if (run === "orphaned") {
    const alive = (leftovers ?? []).some((l) => l.attemptId === a.id && l.processAlive);
    return { stop: false, removeWorktree: !alive && !!a.worktree };
  }
  const open = attemptOpen(a);
  // 옛 PTY 의 reported 는 CLI 가 아직 살 수 있어 [중단] 이 선다. 헤드리스 reported 는 닫혀 있다.
  const stoppable = isHeadless(a) ? !attemptClosed(a) : turnMayLive(a);
  return {
    stop: stoppable && a.state !== "stopping" && a.state !== "stop-unconfirmed",
    removeWorktree: !open && !!a.worktree,
  };
}

/** orphaned Run 은 영속 상태를 믿지 않고 "모름" */
export function attemptChipText(a: Pick<AttemptView, "state"> & ExecModeFields, run: RunState, tr: Tr): string {
  if (run === "orphaned" && turnMayLive(a)) return tr("orch.attempt.state.unknown");
  return keyText(ATTEMPT_STATE_KEY, a.state, tr);
}
