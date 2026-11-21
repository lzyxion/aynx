/**
 * 앨범 판의 순수 층 — Run = 앨범 · Task = 트랙 · 작업자 = 아티스트(화면 용어 · 코드 낱말은 그대로). 문구는 키로 돌려준다.
 * 진행 칸은 단계다(지어낸 퍼센트가 아니다).
 */

import type { Key } from "$lib/i18n/keys";
import type { AttemptView, RunDetail, TaskView } from "./types";
import { attemptNeedsHuman, attemptOpen } from "./worker";
import { awaitingVerify, liveJob, overridableVerify } from "./integration";
import { isReviewer, validAccepted } from "./review";
import { shownRunState } from "./run";

/** 프로듀서 채팅의 #번호와 맞아야 한다 */
export function trackNo(n: number): string {
  return n > 0 ? `#${n}` : "—";
}

export type TrackGlyph = "playing" | "reviewing" | "attention" | "waiting" | "number";

export type TrackTone = "playing" | "reviewing" | "attention" | "waiting" | "done" | "idle" | "faint";

export type TrackGate = "verify" | "permissions" | null;

export type TrackNeed = "blocked" | "conflict" | "verify" | "verify-failed" | "stuck";

export interface TrackRow {
  task: TaskView;
  no: number;
  glyph: TrackGlyph;
  tone: TrackTone;
  writer: AttemptView | null;
  judge: AttemptView | null;
  need: TrackNeed | null;
  gate: TrackGate;
  /** `null` 이면 부르는 쪽이 Task 상태 낱말 */
  statusKey: Key | null;
  blockedNeed: string | null;
  turnNo: number;
  lastTool: string | null;
  model: string | null;
  progress: number;
  timeMs: number | null;
}

const LIVE_JUDGE = new Set(["spawning", "starting", "ready", "working", "running", "stopping"]);

function lastTurn(a: AttemptView | null) {
  const turns = a?.turns ?? [];
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/** 턴 기록이 없는 옛 Attempt 는 상태로 본다 */
export function turnRunning(a: AttemptView | null): boolean {
  if (!a) return false;
  const last = lastTurn(a);
  if (last) return last.outcome === "running";
  return a.state === "running" || a.state === "working" || a.state === "spawning";
}

export function writerOf(d: Pick<RunDetail, "attempts">, task: Pick<TaskView, "id" | "currentAttempt">): AttemptView | null {
  const mine = (d.attempts ?? []).filter((a) => a.taskId === task.id && !isReviewer(a) && a.kind !== "judge");
  if (mine.length === 0) return null;
  return mine.find((a) => a.id === task.currentAttempt) ?? mine[mine.length - 1];
}

export function judgeOf(d: Pick<RunDetail, "attempts">, taskId: string): AttemptView | null {
  const live = (d.attempts ?? []).filter(
    (a) => a.taskId === taskId && (isReviewer(a) || a.kind === "judge") && (turnRunning(a) || (!(a.turns?.length) && LIVE_JUDGE.has(a.state))),
  );
  return live.length > 0 ? live[live.length - 1] : null;
}

export function trackNeed(d: RunDetail, task: TaskView): TrackNeed | null {
  if (d.state === "orphaned" || d.state === "done" || d.state === "stopped") return null;
  const mine = (d.attempts ?? []).filter((a) => a.taskId === task.id);
  if (mine.some((a) => a.state === "idle" && !!a.blocked)) return "blocked";
  if (task.state === "conflict" && task.conflict?.needsHuman) return "conflict";
  if (overridableVerify(d, task)) return "verify-failed";
  if (mine.some((a) => attemptNeedsHuman(a))) return "stuck";
  if (awaitingVerify(d, task.id)) return "verify";
  return null;
}

/** 사람 필요가 먼저다 — 사람이 볼 줄을 놓치지 않게 */
export function trackGlyph(d: RunDetail, task: TaskView): TrackGlyph {
  const need = trackNeed(d, task);
  if (need === "verify") return "waiting";
  if (need) return "attention";
  if (d.state !== "orphaned" && turnRunning(writerOf(d, task))) return "playing";
  if (d.state !== "orphaned" && judgeOf(d, task.id)) return "reviewing";
  return "number";
}

export function trackProgress(d: RunDetail, task: TaskView, writer: AttemptView | null, now: number): number {
  switch (task.state) {
    case "accepted":
      return 1;
    case "integrating":
      return 0.85;
    case "conflict":
      return 0.8;
    case "reported":
      return judgeOf(d, task.id) ? 0.7 : 0.6;
    case "active": {
      const last = lastTurn(writer);
      if (!writer || !last || last.outcome !== "running") return 0.15;
      const limit = Math.max(1, (d.limits.turnMinutes ?? 60) * 60_000);
      return 0.15 + 0.4 * Math.min(1, Math.max(0, now - last.startedAt) / limit);
    }
    default:
      return 0;
  }
}

export function trackTime(writer: AttemptView | null, judge: AttemptView | null, now: number): number | null {
  const a = writer ?? judge;
  if (!a) return null;
  const last = lastTurn(a);
  const end = a.endedAt ?? (turnRunning(a) ? now : typeof last?.endedAt === "number" ? last.endedAt : now);
  return Math.max(0, end - a.startedAt);
}

const STATUS_KEY: Partial<Record<TrackNeed | "playing" | "reviewing" | "integrating", Key>> = {
  blocked: "orch.track.status.blocked",
  conflict: "orch.track.status.conflict",
  verify: "orch.track.status.verify",
  "verify-failed": "orch.track.status.verifyFailed",
  stuck: "orch.track.status.stuck",
  playing: "orch.track.status.playing",
  reviewing: "orch.track.status.reviewing",
  integrating: "orch.track.status.integrating",
};

export function trackRows(d: RunDetail, now: number): TrackRow[] {
  return d.tasks.map((task, i) => {
    const writer = writerOf(d, task);
    const judge = d.state === "orphaned" ? null : judgeOf(d, task.id);
    const need = trackNeed(d, task);
    const glyph = trackGlyph(d, task);
    const last = lastTurn(writer);
    const running = glyph === "playing";
    const done = task.state === "accepted" && validAccepted(d, task.id) !== null;
    const tone: TrackTone =
      glyph === "attention"
        ? "attention"
        : glyph === "waiting"
          ? "waiting"
          : glyph === "playing"
            ? "playing"
            : glyph === "reviewing"
              ? "reviewing"
              : done
                ? "done"
                : task.state === "cancelled" || task.state === "rejected"
                  ? "faint"
                  : "idle";
    const statusKey: Key | null = need
      ? (STATUS_KEY[need] ?? null)
      : running
        ? (STATUS_KEY.playing ?? null)
        : glyph === "reviewing"
          ? (STATUS_KEY.reviewing ?? null)
          : task.state === "integrating" && liveJob(d, task.id)
            ? (STATUS_KEY.integrating ?? null)
            : null;
    const blockedNeed = (d.attempts ?? []).find((a) => a.taskId === task.id && a.state === "idle" && a.blocked)?.blocked?.need ?? null;
    return {
      task,
      no: i + 1,
      glyph,
      tone,
      writer,
      judge,
      need,
      gate: need === "verify" ? "verify" : need === "blocked" ? "permissions" : null,
      statusKey,
      blockedNeed,
      turnNo: last?.n ?? 0,
      lastTool: running ? (last?.lastTool ?? null) : null,
      model: last?.model ?? last?.args?.model ?? null,
      progress: trackProgress(d, task, writer, now),
      timeMs: trackTime(writer, judge, now),
    };
  });
}

export interface NowPlaying {
  attempt: AttemptView;
  task: TaskView | null;
  no: number;
  kind: "write" | "judge";
  tool: string | null;
}

/** Codex 헤드리스 턴의 항목 종류 낱말만 번역한다 — Claude 의 도구(이름 + 대상)는 `null`(원문 그대로) */
export function toolWordKey(tool: string): Key | null {
  switch (tool) {
    case "command_execution": return "orch.bar.tool.command";
    case "file_change": return "orch.bar.tool.files";
    case "mcp_tool_call": return "orch.bar.tool.mcp";
    case "web_search": return "orch.bar.tool.web";
    default: return null;
  }
}

export function nowPlaying(d: RunDetail): NowPlaying | null {
  if (d.state === "orphaned") return null;
  const live = (d.attempts ?? []).filter((a) => turnRunning(a));
  const pick = (list: AttemptView[]) =>
    list.reduce<AttemptView | null>((best, a) => {
      const s = lastTurn(a)?.startedAt ?? a.startedAt;
      const b = best ? (lastTurn(best)?.startedAt ?? best.startedAt) : -Infinity;
      return s >= b ? a : best;
    }, null);
  const writers = live.filter((a) => !isReviewer(a) && a.kind !== "judge");
  const judges = live.filter((a) => isReviewer(a) || a.kind === "judge");
  const a = pick(writers) ?? pick(judges);
  if (!a) return null;
  const idx = d.tasks.findIndex((x) => x.id === a.taskId);
  return {
    attempt: a,
    task: idx >= 0 ? d.tasks[idx] : null,
    no: idx + 1,
    kind: writers.includes(a) ? "write" : "judge",
    tool: lastTurn(a)?.lastTool ?? null,
  };
}

/** `taskId` 가 없으면 앨범 단위 */
export interface HumanNeed {
  kind: "hold" | "no-producer" | "orphaned" | TrackNeed;
  taskId: string | null;
}

export function needsHuman(d: RunDetail): HumanNeed[] {
  const out: HumanNeed[] = [];
  // 끝난 앨범은 서버 재시작으로 읽기 전용이 돼도 사람이 할 일이 없다
  const state = shownRunState(d.state, d.previousState);
  if (state === "orphaned") return [{ kind: "orphaned", taskId: null }];
  if (state === "done" || state === "stopped") return out;
  if (d.hold) out.push({ kind: "hold", taskId: null });
  if (d.state === "paused" && d.coordinatorAttached === false && !d.hold) out.push({ kind: "no-producer", taskId: null });
  for (const task of d.tasks) {
    const need = trackNeed(d, task);
    if (need) out.push({ kind: need, taskId: task.id });
  }
  return out;
}

export interface AlbumArtist {
  cli: string;
  roles: string[];
}

export function albumArtists(d: Pick<RunDetail, "attempts" | "roles">): AlbumArtist[] {
  const out: AlbumArtist[] = [];
  const add = (cli: string | null | undefined, role: string | null | undefined) => {
    if (!cli) return;
    let a = out.find((x) => x.cli === cli);
    if (!a) {
      a = { cli, roles: [] };
      out.push(a);
    }
    const r = role?.trim();
    if (r && !a.roles.includes(r)) a.roles.push(r);
  };
  for (const a of d.attempts ?? []) add(a.cli, a.roleName ?? (a.role === "reviewer" ? "review" : null));
  if (out.length === 0) for (const r of d.roles ?? []) if (r.usable) add(r.cli, r.name);
  return out;
}

export function strayAttempts(d: Pick<RunDetail, "attempts" | "tasks">): AttemptView[] {
  const ids = new Set(d.tasks.map((x) => x.id));
  return (d.attempts ?? []).filter((a) => !ids.has(a.taskId) && (attemptOpen(a) || !!a.worktree));
}
