/**
 * 상태 낱말 → 그림의 표 하나(`StatusIcon.svelte` 가 그린다) — 색만으로 가르지 않고 모양도 다르다.
 * playing · reviewing = 움직이는 이퀄라이저(파랑 · 보라) · attention = 경고 삼각형 · paused = ⏸ · waiting = 시계 ·
 * done = 체크 · failed = 원 안 ✕ · stopped = 채운 네모 · idle = 점.
 */

import type { RunDetail, RunState, RunSummary } from "./types";
import { needsHuman, turnRunning, type TrackRow } from "./album";
import { blockedCount } from "./run";
import { isReviewer } from "./review";
import type { ContinueKind } from "./library";
import { shownRunState } from "./run";

export type StatusIcon = "playing" | "reviewing" | "attention" | "paused" | "waiting" | "done" | "failed" | "stopped" | "idle";

export function statusTone(icon: StatusIcon): "accent" | "warn" | "ok" | "err" | "mute" {
  if (icon === "playing" || icon === "reviewing" || icon === "waiting") return "accent";
  if (icon === "attention" || icon === "paused") return "warn";
  if (icon === "done") return "ok";
  return icon === "failed" ? "err" : "mute";
}

export function trackStatusIcon(row: Pick<TrackRow, "need" | "glyph"> & { task: { state: string } }): StatusIcon {
  switch (row.need) {
    case "blocked":
    case "stuck":
      return "attention";
    case "conflict":
    case "verify-failed":
      return "failed";
    case "verify":
      return "waiting";
    default:
      break;
  }
  if (row.glyph === "playing") return "playing";
  if (row.glyph === "reviewing") return "reviewing";
  switch (row.task.state) {
    case "accepted":
      return "done";
    case "rejected":
    case "conflict":
      return "failed";
    case "cancelled":
      return "stopped";
    case "reported":
    case "integrating":
      return "waiting";
    default:
      return "idle";
  }
}

export function albumStatusIcon(state: RunState, live: { write: number; judge: number; attention: boolean }): StatusIcon {
  switch (state) {
    case "done":
      return "done";
    case "stopped":
    case "stopping":
    case "orphaned":
      return "stopped";
    case "paused":
      return "paused";
    default:
      break;
  }
  if (live.attention) return "attention";
  if (live.write > 0) return "playing";
  if (live.judge > 0) return "reviewing";
  return "idle";
}

export function detailStatusIcon(d: RunDetail): StatusIcon {
  const live = (d.attempts ?? []).filter((a) => turnRunning(a));
  const judge = live.filter((a) => isReviewer(a) || a.kind === "judge").length;
  return albumStatusIcon(shownRunState(d.state, d.previousState), { write: live.length - judge, judge, attention: needsHuman(d).length > 0 });
}

export function summaryStatusIcon(s: RunSummary): StatusIcon {
  return albumStatusIcon(shownRunState(s.state, s.previousState), {
    write: s.running?.write ?? 0,
    judge: s.running?.judge ?? 0,
    attention: blockedCount(s) > 0 || !!s.hold || !!s.persist?.failing,
  });
}

export function cardStatusIcon(kind: ContinueKind, s: RunSummary): StatusIcon {
  if (kind === "orphan" || kind === "reattach" || kind === "paused") return "paused";
  return summaryStatusIcon(s);
}
