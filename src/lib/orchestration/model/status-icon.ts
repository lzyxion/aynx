/**
 * **상태 아이콘 — 상태 낱말 앞의 작은 그림 하나**(2026-10-30 실기 다듬기 · docs/log/2026-10-29-orchestration-player-tab.md "10-30 실기 다듬기").
 *
 * 트랙 줄의 상태 칸 · 앨범 머리의 앨범 상태 · 라이브러리 카드의 상태 줄이 같은 낱말 표를 쓴다 — 그림은 `StatusIcon.svelte` 하나가 그린다.
 * 목업 `Main` 의 # 칸 기호 체계와 맞춘다: **색만으로 가르지 않고 모양도 다르다**.
 *
 * | 낱말 | 뜻 | 그림 |
 * | --- | --- | --- |
 * | `playing` | 작업 중(쓰기형 턴이 돈다) | 움직이는 이퀄라이저(파랑) |
 * | `reviewing` | 검토 중(판정형만 돈다) | 움직이는 이퀄라이저(보라) |
 * | `attention` | 막힘 · 사람 필요 | 경고 삼각형(호박) |
 * | `paused` | 조율 멈춤 | ⏸ 두 막대(호박) |
 * | `waiting` | 수락 · 확인 대기(검증 확인 · 보고됨 · 통합 중) | 시계(강조색) |
 * | `done` | 완료 · 수락 | 체크(초록) |
 * | `failed` | 실패 · 충돌 · 반려 | 원 안 ✕(빨강) |
 * | `stopped` | 중단 · 취소 · 읽기 전용 | 채운 네모(회색) |
 * | `idle` | 쉼 · 대기 | 점(회색) |
 *
 * 순수 함수만(문구 · DOM 없음 — 시험 `status-icon.test.ts`).
 */

import type { RunDetail, RunState, RunSummary } from "./types";
import { needsHuman, turnRunning, type TrackRow } from "./album";
import { blockedCount } from "./run";
import { isReviewer } from "./review";
import type { ContinueKind } from "./library";
import { shownRunState } from "./run";

/** 상태 아이콘 낱말 — `StatusIcon` 의 `icon` */
export type StatusIcon = "playing" | "reviewing" | "attention" | "paused" | "waiting" | "done" | "failed" | "stopped" | "idle";

/** 표지 카드의 둥근 상태 아이콘 면 색 — 그림의 색 갈래와 같다 */
export function statusTone(icon: StatusIcon): "accent" | "warn" | "ok" | "err" | "mute" {
  if (icon === "playing" || icon === "reviewing" || icon === "waiting") return "accent";
  if (icon === "attention" || icon === "paused") return "warn";
  if (icon === "done") return "ok";
  return icon === "failed" ? "err" : "mute";
}

/** 트랙 줄의 상태 칸 — 사람 필요 까닭이 먼저, 그다음 도는 것, 그다음 Task 상태 */
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

/** 앨범 상태 — 끝 · 멈춤이 먼저, 진행 중이면 사람 필요 → 쓰기형 → 판정형 → 쉼 */
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

/** 앨범 머리(상세를 읽은 판) — 도는 턴 수와 사람 필요(`needsHuman`)로 */
export function detailStatusIcon(d: RunDetail): StatusIcon {
  const live = (d.attempts ?? []).filter((a) => turnRunning(a));
  const judge = live.filter((a) => isReviewer(a) || a.kind === "judge").length;
  return albumStatusIcon(shownRunState(d.state, d.previousState), { write: live.length - judge, judge, attention: needsHuman(d).length > 0 });
}

/** 목록 요약 한 줄(상세 없이) — 막힘 · 보류 · 저장 실패가 사람 필요 */
export function summaryStatusIcon(s: RunSummary): StatusIcon {
  return albumStatusIcon(shownRunState(s.state, s.previousState), {
    write: s.running?.write ?? 0,
    judge: s.running?.judge ?? 0,
    attention: blockedCount(s) > 0 || !!s.hold || !!s.persist?.failing,
  });
}

/** 라이브러리 "최근" 카드 — 프로듀서 없는 멈춤(이어받기 · 다시 붙이기)도 멈춤 그림 */
export function cardStatusIcon(kind: ContinueKind, s: RunSummary): StatusIcon {
  if (kind === "orphan" || kind === "reattach" || kind === "paused") return "paused";
  return summaryStatusIcon(s);
}
