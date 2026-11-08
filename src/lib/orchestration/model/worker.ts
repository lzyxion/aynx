/**
 * 작업자(Attempt) 보기 — 상태 표 · 술어 넷 · 작업자 줄 · 턴 이력 · 경고 띠 · 최근 활동 · 커밋 거절 안내 · 사람 동작.
 */

import type { Key } from "$lib/i18n/keys";
import { keyText, type Tr } from "./text";
import type { AttemptKind, AttemptState, AttemptView, CommitRejectionView, ExecModeFields, LeftoverView, RunDetail, RunState, TranscriptWatchView, TurnArgsView, WorkerActivity, WorkerCommitView } from "./types";

const COMMIT_REJECTION_HINT: Record<string, Key> = {
  "filters-configured": "orch.commitRejected.hint.filters-configured",
  "no-git-identity": "orch.commitRejected.hint.no-git-identity",
  "worktree-mismatch": "orch.commitRejected.hint.worktree-mismatch",
  "commit-failed": "orch.commitRejected.hint.commit-failed",
};

/** 사람이 해야 할 일 한 줄(사람 필요 사유만 — 나머지는 작업자가 스스로 고친다) */
export function commitRejectionHint(r: Pick<CommitRejectionView, "reason" | "needsHuman">): Key | null {
  return r.needsHuman ? (COMMIT_REJECTION_HINT[r.reason] ?? "orch.commitRejected.hint.other") : null;
}

/** 작업자 칸의 경고 — 대화 바뀜 · 기록 지연 */
export type ActivityWarning = "conversation-changed" | "lagging";

/** 작업자 칸 "최근 활동" 의 그릴 것 — 산 작업자만. 경고는 Run 상세(Attempt · transcripts)와 최근 활동 어느 쪽에서 와도 선다. */
export interface ActivityLine {
  lastText: string | null;
  tools: { name: string; summary: string; pending: boolean }[];
  changedCount: number | null;
  changedMore: boolean;
  warnings: ActivityWarning[];
  /** [기록 보기] 를 켤 수 있나(고정 대화를 읽을 수 있다) */
  canView: boolean;
  /** 읽을 수 없는 까닭(`pending` · `cwd-mismatch` …) — 읽을 수 있으면 `null` */
  status: string | null;
}

/** 최근 활동 한 칸을 짓는다(**순수** — 보드가 그린다). 닫힌 작업자면 `null`(3a — `idle` 은 열려 있어 보인다). */
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

/** 경고 → 문구 키(이름표 · 풀이) */
export const ACTIVITY_WARN_KEY: Record<ActivityWarning, { label: Key; title: Key }> = {
  "conversation-changed": {
    label: "orch.activity.warn.conversation-changed",
    title: "orch.activity.warn.conversation-changed.title",
  },
  lagging: { label: "orch.activity.warn.lagging", title: "orch.activity.warn.lagging.title" },
};

/** 고정 대화를 읽을 수 없는 까닭 → 문구 키(모르는 낱말은 `unreadable`) */
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

/** 최근 활동을 물을 Run 인가 — 살아 있는 Run 에 열린 작업자가 있을 때만(보드가 보일 때만 묻는다 — 폭주 금지) */
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

// ---------------------------------------------------------------------------
// Attempt 술어(서버 `model.rs` 의 넷 — 헤드리스 설계 4-5 · D9). 보드의 단추 · 강조 판정만 쓴다(서버가 다시 판정한다).
// ---------------------------------------------------------------------------

/** 헤드리스 Attempt 인가 — 바탕 종류가 있거나 턴 기록이 있거나 스트림 없는 검토자(서버 `exec_mode`). 아니면 옛 PTY 작업자 */
export function isHeadless(a: ExecModeFields): boolean {
  return !!a.kind || (a.turns?.length ?? 0) > 0 || (a.role === "reviewer" && !a.stream);
}

/** 술어 1 — 턴(프로세스)이 살아 있을 수 있나. 헤드리스: idle · reported · exited · stopped 가 아니면. PTY(옛): exited · stopped 가 아니면 */
export function turnMayLive(a: Pick<AttemptView, "state"> & ExecModeFields): boolean {
  if (!isHeadless(a)) return a.state !== "exited" && a.state !== "stopped";
  return !(a.state === "idle" || a.state === "reported" || a.state === "exited" || a.state === "stopped");
}

/** 술어 2 — Attempt 가 닫혔나(reported · stopped · exited) */
export function attemptClosed(a: Pick<AttemptView, "state">): boolean {
  return a.state === "reported" || a.state === "stopped" || a.state === "exited";
}

/** 술어 3 — worktree · 대화를 쥐고 있나(열렸거나 턴이 살 수 있다) — 보드의 "열린 작업자" */
export function attemptOpen(a: Pick<AttemptView, "state"> & ExecModeFields): boolean {
  return !attemptClosed(a) || turnMayLive(a);
}

/**
 * 사람이 봐야 하는 작업자인가 — 종료 미확인 · `blocked` 로 멈춤 · 대화 끊김(+ 옛 파일의 사람 필요 · 복구 필요). 보드가 눈에 띄게
 * 그린다.
 */
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

/** 사람이 봐야 할 까닭의 문구 키 — 종료 미확인 둘만(옛 파일의 다른 낱말은 보이지 않는다 — 그 타일이 없다) */
export function attentionKey(a: Pick<AttemptView, "state" | "attention">): Key | null {
  if (a.state === "stop-unconfirmed") return "orch.attention.stop-unconfirmed";
  if (a.state === "exit-unconfirmed") return "orch.attention.exit-unconfirmed";
  return null;
}

// ---------------------------------------------------------------------------
// 헤드리스 작업자 줄(3차 3b — 설계 4-4 보드 표시: 역할 · 종류 · CLI · 턴 · 지금 도구 · 거절 · 실효 인자 · 모델 · 경과)
// ---------------------------------------------------------------------------

/** 바탕 종류 → 문구 키 */
export const KIND_KEY: Record<AttemptKind, Key> = {
  write: "orch.kind.write",
  judge: "orch.kind.judge",
};

/** 턴 결과 낱말 → 문구 키(서버 `turn::turn_outcome` + `running`) */
export const TURN_OUTCOME_KEY: Record<string, Key> = {
  running: "orch.turn.outcome.running",
  ok: "orch.turn.outcome.ok",
  failed: "orch.turn.outcome.failed",
  timeout: "orch.turn.outcome.timeout",
  stopped: "orch.turn.outcome.stopped",
  "stop-unconfirmed": "orch.turn.outcome.stop-unconfirmed",
};

/** 권한 등급 → 문구 키(서버 `turn::Grade`) */
export const GRADE_KEY: Record<string, Key> = {
  edit: "orch.grade.edit",
  full: "orch.grade.full",
  "read-only": "orch.grade.read-only",
};

/** 작업자 줄 하나(보드가 그린다 — 순수) */
export interface WorkerLine {
  /** 역할 이름(없으면 옛 파일 — 검토자면 "검토", 아니면 `null`) */
  roleName: string | null;
  /** 바탕 종류(옛 파일은 역할로 짐작 — 검토자 = judge) */
  kind: AttemptKind;
  cli: string;
  headless: boolean;
  /** 지금(또는 마지막) 턴 번호 — 턴이 없으면 0 */
  turnNo: number;
  /** 턴이 도는 중인가(마지막 턴의 결과가 `running`) */
  turnRunning: boolean;
  /** 지금(또는 마지막) 턴의 마지막 도구 이름(이름만) — 끝난 턴도 그 턴의 것을 보인다(노트 위험 10 — 보고가 끝난 턴 줄에 안 보였다) */
  lastTool: string | null;
  /** 마지막 턴의 거절 수 */
  denials: number;
  /** 마지막 턴의 실효 인자 요약(없으면 `null`) */
  args: string | null;
  /** 실효 모델(마지막 턴 init — 없으면 인자의 모델) */
  model: string | null;
  /** 경과 ms — 도는 턴이면 그 턴, 아니면 Attempt 전체(끝났으면 끝까지 · idle 은 마지막 턴 끝까지) */
  elapsedMs: number;
}

/** 턴 인자 요약 한 줄 — 등급 · 설정 통제 · 허용 규칙 수 · 샌드박스 · resume(프롬프트 · 지침 · 토큰 · 경로는 서버가 싣지 않는다) */
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

/** 작업자 줄을 짓는다(**순수**) */
export function workerLine(a: AttemptView, now: number, tr: Tr): WorkerLine {
  const turns = a.turns ?? [];
  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const running = last?.outcome === "running";
  const kind: AttemptKind = a.kind === "judge" || a.kind === "write" ? a.kind : a.role === "reviewer" ? "judge" : "write";
  const roleName = a.roleName?.trim() || (a.role === "reviewer" ? tr("orch.attempt.role.reviewer") : null);
  // 도는 턴이면 그 턴, 아니면 Attempt 전체 — 끝나지 않은 idle 은 마지막 턴 끝까지(쉬는 시간은 세지 않는다)
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

/** 턴 이력 한 줄(접기 안 — 턴마다 결과 · 시간 · 도구 수 · 거절) */
export interface TurnRow {
  n: number;
  outcome: string;
  /** 결과 문구(사유가 있으면 덧붙인다 — `failed · no-result`) */
  text: string;
  /** 걸린 ms(도는 턴이면 `null`) */
  durationMs: number | null;
  tools: number;
  denials: number;
  denialKinds: string[];
  /** 결과가 실패 쪽인가(ok · running 이 아니면) */
  bad: boolean;
}

/** 턴 이력(새것이 위) */
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

/**
 * 작업자의 경고 띠(4-6 · 4-4) — `idle` + `blocked{need}` 면 need 글(사람이 맡기기를 넓히면 조정자가 이어 간다), 대화가 끊겼으면 그
 * 안내. 둘 다 아니면 `null`. 닫힌 Attempt 는 띠가 없다(보고 · 중단으로 끝났다).
 */
export function attemptBand(
  a: Pick<AttemptView, "state" | "blocked" | "conversationBroken">,
): { blocked: { need: string; at: number } | null; broken: boolean } | null {
  const blocked = a.state === "idle" && a.blocked ? a.blocked : null;
  const broken = a.conversationBroken === true && !attemptClosed(a);
  return blocked || broken ? { blocked, broken } : null;
}

/** 그 Attempt 의 서버 커밋(오래된 것부터) */
export function attemptCommits(run: Pick<RunDetail, "commits">, attemptId: string): WorkerCommitView[] {
  return (run.commits ?? []).filter((c) => c.attemptId === attemptId);
}

// (3차 6단계) 옛 붙여넣기 전달 기록(`deliveries` — 5단계)은 서버 보기에 없다 — 타임라인의 옛 `prompt_sent` 사건은 결과 낱말만 보인다.

/**
 * 작업자 칸의 사람 동작 — [중단](열려 있고 아직 중단 중이 아닐 때 — 도는 턴은 끝내고, `idle` 은 곧바로 닫는다) · [worktree 지우기]
 * (닫혔고 턴도 없고 worktree 가 남아 있을 때 — 서버가 다시 판정한다: 그 Run 이 만든 것 · 미커밋 없음 · 병합 안 된 브랜치 거절).
 * (3b) [타일로 가기] 는 걷었다 — 헤드리스 작업자에게는 타일이 없다.
 *
 * **orphaned**(서버 재시작 뒤)는 영속 상태가 옛 서버의 마지막 기록이다 — 산 것으로 보지 않고 **지금 남은 프로세스**(`leftovers` 의
 * `processAlive` — 서버가 OS 에 물은 것)로 가른다(리뷰 F12). 남은 프로세스가 없으면 worktree 를 정리할 수 있다(서버가 같은 판정으로
 * 다시 본다).
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
  // 옛 PTY 의 reported 는 CLI 가 아직 살 수 있어 [중단] 이 선다(턴이 살 수 있다). 헤드리스 reported 는 닫혀 있다.
  const stoppable = isHeadless(a) ? !attemptClosed(a) : turnMayLive(a);
  return {
    stop: stoppable && a.state !== "stopping" && a.state !== "stop-unconfirmed",
    removeWorktree: !open && !!a.worktree,
  };
}

/** 작업자 상태 칩의 문구 — orphaned Run 은 영속 상태를 믿지 않고 "모름"(리뷰 사소 — 옛 서버의 마지막 기록). 모르는 상태는 날 낱말 */
export function attemptChipText(a: Pick<AttemptView, "state"> & ExecModeFields, run: RunState, tr: Tr): string {
  if (run === "orphaned" && turnMayLive(a)) return tr("orch.attempt.state.unknown");
  return keyText(ATTEMPT_STATE_KEY, a.state, tr);
}
