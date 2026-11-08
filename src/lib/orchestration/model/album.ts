/**
 * **앨범 판의 순수 층**(2026-10-29 오케스트레이션 탭 ② — docs/log/2026-10-29-orchestration-player-tab.md 3-2 · 8절 단계 2).
 *
 * Run = 앨범 · Task = 트랙 · 작업자 = 아티스트(화면 용어 B안 — 코드 낱말은 그대로). 이 파일은 서버 보기(`RunDetail`)만 읽고 상태 ·
 * 문구를 쥐지 않는다(문구는 키로 돌려주고 부르는 쪽이 `t` 로 짓는다 — 시험 `album.test.ts`).
 *
 * - [`trackRows`] — 트랙 줄(Task 순서 고정 · 번호 = 화면 순번 1부터 — 프로듀서 채팅의 #1 과 맞게). # 칸 글리프는 [`trackGlyph`] 의 판정
 *   하나: 사람 필요(막힘 · 충돌 · 검증 실패 · 종료 미확인) → ⏸ · 사람 확인 대기(검증) → 시계 · 쓰기형 턴이 돈다 → 이퀄라이저 · 판정형만 돈다 →
 *   보라 이퀄라이저 · 그 밖 → 번호.
 * - [`nowPlaying`] — 재생 막대의 "지금 곡": 도는 쓰기형 턴 중 가장 최근에 시작한 것(없으면 도는 판정형).
 * - [`needsHuman`] — 사람 필요 배지의 항목(앨범 단위 먼저 · 그다음 트랙 순서). 배지를 누르면 첫 트랙 항목으로 간다.
 * - [`albumArtists`] — 참여 아티스트(CLI 마다 역할 이름들 — 등장 순서).
 * - 진행 칸은 **단계**다(지어낸 퍼센트가 아니다): 대기 0 · 작업 중(턴 시한에 대한 경과) · 보고됨 · 검토 · 통합 · 수락 1.
 */

import type { Key } from "$lib/i18n/keys";
import type { AttemptView, RunDetail, TaskView } from "./types";
import { attemptNeedsHuman, attemptOpen } from "./worker";
import { awaitingVerify, liveJob, overridableVerify } from "./integration";
import { isReviewer, validAccepted } from "./review";
import { shownRunState } from "./run";

/** 트랙 번호의 화면 표기 — 막대 · 판 · 상세 머리가 같은 `#n`(프로듀서 채팅의 #번호와 맞게 · 번호가 없으면 "—") */
export function trackNo(n: number): string {
  return n > 0 ? `#${n}` : "—";
}

/** # 칸의 그림 */
export type TrackGlyph = "playing" | "reviewing" | "attention" | "waiting" | "number";

/** 줄의 색조 — 그림과 같은 뜻(+ 끝남 · 흐림) */
export type TrackTone = "playing" | "reviewing" | "attention" | "waiting" | "done" | "idle" | "faint";

/** 줄의 사람 관문 하나(상태 칸의 단추) — 동작은 부르는 쪽(기존 사람 명령 그대로) */
export type TrackGate = "verify" | "permissions" | null;

/** 사람이 필요한 까닭(트랙 단위) */
export type TrackNeed = "blocked" | "conflict" | "verify" | "verify-failed" | "stuck";

/** 트랙 줄 하나 */
export interface TrackRow {
  task: TaskView;
  /** 화면 순번(1부터 — Task 순서) */
  no: number;
  glyph: TrackGlyph;
  tone: TrackTone;
  /** 이 트랙의 쓰기형 Attempt — 지금 것(`currentAttempt`)이 있으면 그것, 없으면 마지막 쓰기형 */
  writer: AttemptView | null;
  /** 지금 도는 판정형(검토자) Attempt — "feat. ‹검토자›" */
  judge: AttemptView | null;
  /** 사람 필요 까닭(없으면 `null`) */
  need: TrackNeed | null;
  /** 상태 칸의 사람 관문 단추 */
  gate: TrackGate;
  /** 상태 칸의 글 키(`orch.track.status.*` · 그 밖은 Task 상태 표 — `null` 이면 부르는 쪽이 Task 상태 낱말) */
  statusKey: Key | null;
  /** 막힘 글(blocked `need` — 작업자가 쓴 그대로) */
  blockedNeed: string | null;
  /** 도는 턴의 번호 · 마지막 도구 · 실효 모델 */
  turnNo: number;
  lastTool: string | null;
  model: string | null;
  /** 진행 단계(0..1) */
  progress: number;
  /** 시간 칸(ms — Attempt 가 없으면 `null`) */
  timeMs: number | null;
}

const LIVE_JUDGE = new Set(["spawning", "starting", "ready", "working", "running", "stopping"]);

function lastTurn(a: AttemptView | null) {
  const turns = a?.turns ?? [];
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

/** 그 Attempt 의 턴이 지금 돈다(마지막 턴이 `running` — 턴 기록이 없는 옛 Attempt 는 상태로) */
export function turnRunning(a: AttemptView | null): boolean {
  if (!a) return false;
  const last = lastTurn(a);
  if (last) return last.outcome === "running";
  return a.state === "running" || a.state === "working" || a.state === "spawning";
}

/** 그 Task 의 쓰기형 Attempt(지금 것 우선) */
export function writerOf(d: Pick<RunDetail, "attempts">, task: Pick<TaskView, "id" | "currentAttempt">): AttemptView | null {
  const mine = (d.attempts ?? []).filter((a) => a.taskId === task.id && !isReviewer(a) && a.kind !== "judge");
  if (mine.length === 0) return null;
  return mine.find((a) => a.id === task.currentAttempt) ?? mine[mine.length - 1];
}

/** 그 Task 의 지금 도는 판정형 Attempt(마지막) */
export function judgeOf(d: Pick<RunDetail, "attempts">, taskId: string): AttemptView | null {
  const live = (d.attempts ?? []).filter(
    (a) => a.taskId === taskId && (isReviewer(a) || a.kind === "judge") && (turnRunning(a) || (!(a.turns?.length) && LIVE_JUDGE.has(a.state))),
  );
  return live.length > 0 ? live[live.length - 1] : null;
}

/** 트랙의 사람 필요 까닭(첫 하나 — 막힘 · 충돌 · 검증 실패 · 종료 미확인 · 검증 확인 대기 순) */
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

/** # 칸의 그림 — 사람 필요가 먼저(사람이 볼 줄을 놓치지 않게), 그다음 도는 것 */
export function trackGlyph(d: RunDetail, task: TaskView): TrackGlyph {
  const need = trackNeed(d, task);
  if (need === "verify") return "waiting";
  if (need) return "attention";
  if (d.state !== "orphaned" && turnRunning(writerOf(d, task))) return "playing";
  if (d.state !== "orphaned" && judgeOf(d, task.id)) return "reviewing";
  return "number";
}

/** 진행 단계(0..1) — 지어낸 퍼센트가 아니라 Task 가 선 단계(작업 중이면 턴 시한에 대한 경과로 그 칸 안에서 움직인다) */
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

/** 시간 칸 — 쓰기형(없으면 판정형) Attempt 의 시작부터 끝(끝나지 않았으면 도는 턴은 지금 · 쉬는 것은 마지막 턴 끝)까지 */
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

/** 트랙 줄 전부(Task 순서 고정) */
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

/** 재생 막대의 "지금 곡" */
export interface NowPlaying {
  attempt: AttemptView;
  task: TaskView | null;
  /** 트랙 순번(모르면 0) */
  no: number;
  kind: "write" | "judge";
  /** 도는 턴의 마지막 도구 */
  tool: string | null;
}

/**
 * 도구 이름 → 사람 낱말 키. Codex 헤드리스 턴의 마지막 도구는 항목 종류 낱말(`command_execution` · `file_change` …)이라 그대로 두면
 * 막대 끝에 "comman…" 으로 잘려 붙었다(실기 10-31). 그 넷만 번역하고, Claude 의 도구(`Edit src/a.rs` 등 — 이름 + 대상)는 `null`(원문 그대로)
 */
export function toolWordKey(tool: string): Key | null {
  switch (tool) {
    case "command_execution": return "orch.bar.tool.command";
    case "file_change": return "orch.bar.tool.files";
    case "mcp_tool_call": return "orch.bar.tool.mcp";
    case "web_search": return "orch.bar.tool.web";
    default: return null;
  }
}

/** 지금 곡 — 도는 쓰기형 턴 중 마지막으로 시작한 것, 없으면 도는 판정형, 둘 다 없으면 `null` */
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

/** 사람 필요 항목 하나 — `taskId` 가 없으면 앨범 단위(보류 · 프로듀서 없음 · 기록만) */
export interface HumanNeed {
  kind: "hold" | "no-producer" | "orphaned" | TrackNeed;
  taskId: string | null;
}

/** 사람 필요 항목 — 앨범 단위(보류 → 프로듀서 없음 → 기록만) 먼저, 그다음 트랙 순서 */
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

/** 참여 아티스트 한 명(CLI) — 역할 이름들(등장 순서 · 겹침 없음) */
export interface AlbumArtist {
  cli: string;
  roles: string[];
}

/** 참여 아티스트 — 띄운 Attempt 의 `(cli, 역할)` 에서, 아직 없으면 지금 맡기기의 역할(라인업)에서 */
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

/** 열린 Attempt 중 Task 표에 없는 것(옛 파일 · 지운 Task — 판 끝 "그 밖의 아티스트") */
export function strayAttempts(d: Pick<RunDetail, "attempts" | "tasks">): AttemptView[] {
  const ids = new Set(d.tasks.map((x) => x.id));
  return (d.attempts ?? []).filter((a) => !ids.has(a.taskId) && (attemptOpen(a) || !!a.worktree));
}
