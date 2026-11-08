/**
 * **앨범의 맥박 — 막대 상태 하나**(2026-10-30 오케스트레이션 탭 ⑤ · 노트 5-2 · 사용자 결정 P5 "진행 상태는 점 대신 막대").
 *
 * 탭 글리프 · 플레이어 잎 아이콘이 그리는 `EqBars` 의 상태(런처 독 칸은 배지만)를 **목록 요약(`RunSummary`)만으로** 정한다 — 뒤에 있는 앨범 탭은 상세를 읽지 않는다
 * (보드 로더는 보일 때만). 판정 순서(위가 이긴다):
 *
 * | 요약 | 막대 |
 * | --- | --- |
 * | `done` | `done`(초록 원 안의 ✓) |
 * | `stopped` · `stopping` | `idle`(회색 헤드폰) |
 * | `paused`(조율 멈춤 — 까닭 무관) | `paused`(호박 ⏸ — `attention` 과 같은 모양 · 10-31 사용자 "통일") |
 * | `orphaned` · `blocked > 0` · 보류(`hold`) · 영속 실패(`persist.failing`) · 상세의 사람 필요(`humanNeeds > 0`) | `attention`(호박 ⏸) |
 * | `running.write > 0` | `playing`(파랑 움직임) |
 * | `running.judge > 0` | `reviewing`(보라 움직임) |
 * | 그 밖(프로듀서만 대기) | `idle` |
 *
 * 주소 없는 탭(홈 · 준비 중)과 목록에 없는 앨범은 `logo`(헤드폰 — 그 자리의 글자색). 여럿을 접는 [`dockPulse`] 는 독 칸 하나 — 칸의 로고는 늘 헤드폰(목업 V3DockLogo)이고
 * 상태는 배지만 말한다: 산 앨범 수 · 사람이 필요하거나 조율이 멈춘 앨범이 있으면 호박(`attention`). `pulse` 는 접은 상태(움직임이 이긴다)로 남는다.
 */

import type { RunSummary } from "./types";
import { albumLive } from "./library";
import { shownRunState } from "./run";

/** 막대 상태 — `EqBars` 의 `state` 와 같은 낱말 */
export type Pulse = "logo" | "playing" | "reviewing" | "attention" | "paused" | "idle" | "done";

/** 앨범 하나의 맥박 — `humanNeeds` 는 상세를 읽은 화면만 넘긴다(`needsHuman(detail).length`) */
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

/** 런처 독 칸 — 막대 하나 · 배지(산 앨범 수 · 사람 필요가 있나) */
export interface DockPulse {
  pulse: Pulse;
  /** 산 앨범 수(0 이면 배지 없음) */
  live: number;
  /** 산 앨범 가운데 사람이 필요한 것이 있다(배지 호박 — 조율 멈춤 포함) */
  attention: boolean;
}

/** 여러 앨범 → 독 칸 하나(산 앨범 = 라이브러리의 [`albumLive`] — 도는 · 멈춘 · 멈추는 중). 산 앨범이 없으면 `logo` */
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
