/**
 * 앨범의 맥박 — 목록 요약(`RunSummary`)만으로 정한다(뒤에 있는 앨범 탭은 상세를 읽지 않는다).
 * 런처 독 칸의 로고는 늘 헤드폰이고 상태는 배지만 말한다.
 */

import type { RunSummary } from "./types";
import { albumLive } from "./library";
import { shownRunState } from "./run";

/** `EqBars` 의 `state` 와 같은 낱말 */
export type Pulse = "logo" | "playing" | "reviewing" | "attention" | "paused" | "idle" | "done";

/** `humanNeeds` 는 상세를 읽은 화면만 넘긴다 */
export function albumPulse(s: RunSummary | null | undefined, humanNeeds = 0): Pulse {
  if (!s) return "logo";
  const state = shownRunState(s.state, s.previousState);
  if (state === "done") return "done";
  if (state === "stopped" || state === "stopping") return "idle";
  if (s.state === "paused") return "paused";
  if (
    s.orphaned ||
    s.state === "orphaned" ||
    (s.blocked ?? 0) > 0 ||
    !!s.hold ||
    !!s.persist?.failing ||
    humanNeeds > 0
  ) {
    return "attention";
  }
  if (s.running.write > 0) return "playing";
  if (s.running.judge > 0) return "reviewing";
  return "idle";
}

export interface DockPulse {
  pulse: Pulse;
  live: number;
  attention: boolean;
}

export function dockPulse(list: readonly RunSummary[]): DockPulse {
  const live = list.filter(albumLive);
  const pulses = live.map((s) => albumPulse(s));
  const has = (p: Pulse) => pulses.includes(p);
  const pulse: Pulse =
    live.length === 0
      ? "logo"
      : has("playing")
        ? "playing"
        : has("reviewing")
          ? "reviewing"
          : has("attention")
            ? "attention"
            : has("paused")
              ? "paused"
              : "idle";
  return { pulse, live: live.length, attention: has("attention") || has("paused") };
}
